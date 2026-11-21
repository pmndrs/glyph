//! One engine driven the way the Wasm boundary drives it: parse the request bytes, prepare,
//! encode the publication into a frame transport, then commit.
//!
//! The session owns its own registry, engine and transport so a cold layout shares nothing
//! with the edit history it is compared against.

use alloc::{
    collections::BTreeMap,
    format,
    rc::Rc,
    string::{String, ToString},
    vec,
    vec::Vec,
};

use crate::{
    ShaperRegistry,
    abi_contract::{ENGINE_RESULT_BYTE_LENGTH, ENGINE_RESULT_HEADER_SIZE},
    engine::{
        TextEngine,
        codec::{
            BATCH_DEPTH, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE,
            BATCH_TRANSFORM, BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, BufferSchema,
            CAP_ORDERED_DIRECT, CapabilitySet, CapabilitySetId, CodecDescriptor, InputSource,
            Operation, ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType, TechniqueId,
            ValidatedCodec,
        },
        font_binding::{
            FieldTable, FontRenderBinding, FontResource, FontStrike, MISSING_RESOURCE_INDEX,
        },
        frame::{
            SEMANTIC_F32_SHADOW_OFFSET_Y_EM, SEMANTIC_U32_PLACEMENT_SLOT,
            SEMANTIC_VIEW_BORROWED_LAYOUT, SEMANTIC_VIEW_LAYOUT_INSPECTION,
            SEMANTIC_VIEW_MEASUREMENT,
        },
        frame_wire::parse_update_request,
        render_plan::{
            BufferRecord, DrawRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_COPY, PATCH_FILL,
            PATCH_RETIRE, PATCH_WRITE, PatchRecord, PrimitiveRecord, RETIRE_BUFFER, RenderPlanView,
        },
        render_plan_wire::{publication_layout, query_layout},
        semantic_view::SemanticRecord,
        transport::FrameTransport,
    },
    wire::read_u32,
};

use super::super::{MeasuredParagraphs, PreparationTarget};
use super::{
    fonts::{FontLibrary, PreparedFont},
    model::{
        CODEC_HANDLE, FIRST_STACK_HANDLE, Model, PARAGRAPH_ID, ROOT_ID, RequestHeader, TextEdit,
        request,
    },
};

/// Every semantic view the engine can return with a publication.
pub const ALL_VIEWS: u32 =
    SEMANTIC_VIEW_MEASUREMENT | SEMANTIC_VIEW_LAYOUT_INSPECTION | SEMANTIC_VIEW_BORROWED_LAYOUT;
/// What the host asks for when it measures between publications.
const MEASURE_VIEWS: u32 = SEMANTIC_VIEW_MEASUREMENT | SEMANTIC_VIEW_BORROWED_LAYOUT;
const SEMANTIC_F32_FIELD_COUNT: u8 = SEMANTIC_F32_SHADOW_OFFSET_Y_EM + 1;
const SEMANTIC_U32_FIELD_COUNT: u8 = SEMANTIC_U32_PLACEMENT_SLOT + 1;
const FIRST_FONT_HANDLE: u32 = 1;
const FIRST_BINDING_HANDLE: u32 = 41;
const INITIAL_TRANSPORT_BYTES: u32 = 1 << 16;

/// How one step reaches the engine. A cold layout replays the same route with no history.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Route {
    /// Semantic views requested with the publication.
    pub view_mask: u32,
    /// Apply the change through a paragraph measurement first, then publish what it prepared.
    pub measure_first: bool,
    /// Measure once more after the publication, as a host reading layout back does.
    pub measure_after: bool,
}

impl Route {
    pub const FULL: Self = Self {
        view_mask: ALL_VIEWS,
        measure_first: false,
        measure_after: true,
    };
}

/// What one step returned through the boundary.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StepOutput {
    /// The encoded publication, result header included.
    pub publication: Vec<u8>,
    /// Semantic records returned with the publication.
    pub published_views: Vec<SemanticRecord>,
    /// Semantic records of the measurement that preceded the publication, if any.
    pub measured_first: Vec<SemanticRecord>,
    /// Semantic records of the measurement that followed the publication, if any.
    pub measured_after: Vec<SemanticRecord>,
}

pub struct Session {
    pub(super) registry: ShaperRegistry,
    pub(super) engine: TextEngine,
    transport: FrameTransport,
    geometry_revision: u32,
    model: Option<Model>,
    /// What a renderer holds after applying every publication so far.
    pub(super) host_buffers: HostBuffers,
}

impl Session {
    /// `stacks` lists font keys per font stack; a style names a stack by index.
    pub fn new(library: &FontLibrary, stacks: &[&[&str]]) -> Result<Self, String> {
        let mut registry = ShaperRegistry::default();
        registry.initialize().map_err(status)?;
        let mut engine = TextEngine::default();
        engine.initialize().map_err(debug)?;
        engine
            .register_codec(CODEC_HANDLE, every_field_codec()?)
            .map_err(debug)?;
        let mut keys: Vec<&str> = Vec::new();
        for (stack_index, stack) in stacks.iter().enumerate() {
            let mut bindings = Vec::new();
            for key in *stack {
                let index = match keys.iter().position(|known| known == key) {
                    Some(index) => index,
                    None => {
                        let font = library
                            .get(key)
                            .ok_or_else(|| format!("font {key} is not loaded"))?;
                        register_font(&mut registry, &mut engine, keys.len() as u32, &font)?;
                        keys.push(key);
                        keys.len() - 1
                    }
                };
                bindings.push(FIRST_BINDING_HANDLE + index as u32);
            }
            engine
                .register_font_stack(FIRST_STACK_HANDLE + stack_index as u32, &bindings)
                .map_err(debug)?;
        }
        engine.create_root(ROOT_ID).map_err(debug)?;
        Ok(Self {
            registry,
            engine,
            transport: FrameTransport::new(INITIAL_TRANSPORT_BYTES, INITIAL_TRANSPORT_BYTES)
                .map_err(status)?,
            geometry_revision: 0,
            model: None,
            host_buffers: HostBuffers::default(),
        })
    }

    pub fn model(&self) -> Option<&Model> {
        self.model.as_ref()
    }

    /// Moves the engine to `next`. `edits` are the text difference from the current model, in
    /// application order, and are ignored on the first step, which inserts the whole text.
    pub fn step(
        &mut self,
        next: &Model,
        edits: &[TextEdit],
        route: Route,
    ) -> Result<StepOutput, String> {
        if self.model.is_none() {
            self.engine
                .reserve_root_text(ROOT_ID, next.text.len().max(1) as u32)
                .map_err(debug)?;
        }
        if self
            .model
            .as_ref()
            .is_none_or(|model| model.layout != next.layout)
        {
            self.geometry_revision += 1;
        }
        let mut output = StepOutput::default();
        if route.measure_first {
            let change = self.request(next, edits, MEASURE_VIEWS, true);
            output.measured_first = self.measure(&change)?;
            self.model = Some(next.clone());
            let publish = self.request(next, &[], route.view_mask, false);
            self.publish(&publish, &mut output)?;
        } else {
            let change = self.request(next, edits, route.view_mask, true);
            self.publish(&change, &mut output)?;
            self.model = Some(next.clone());
        }
        if route.measure_after {
            let query = self.request(next, &[], MEASURE_VIEWS, false);
            output.measured_after = self.measure(&query)?;
        }
        Ok(output)
    }

    /// `changes` false asks for the current model again: a header-only request.
    fn request(&self, next: &Model, edits: &[TextEdit], view_mask: u32, changes: bool) -> Vec<u8> {
        let revision = self.engine.root_revision(ROOT_ID).unwrap_or_default();
        let header = RequestHeader {
            engine_revision: revision.engine,
            root_revision: revision.root,
            acknowledged_generation: self
                .transport
                .next_publication_generation()
                .map_or(0, |next| next - 1),
            view_mask,
            geometry_revision: self.geometry_revision,
        };
        let previous = if changes {
            self.model.as_ref()
        } else {
            Some(next)
        };
        request(header, previous, next, edits)
    }

    fn publish(&mut self, bytes: &[u8], output: &mut StepOutput) -> Result<(), String> {
        let request = parse_update_request(bytes, ROOT_ID).map_err(status)?;
        let generation = self
            .transport
            .next_publication_generation()
            .map_err(status)?;
        let prepared = self
            .engine
            .prepare_update_with_shaper(&mut self.registry, request, generation)
            .map_err(|error| format!("prepare: {error:?}"))?;
        let replace_bindings = self
            .engine
            .planners
            .get(&ROOT_ID)
            .is_some_and(|planner| planner.plan.publishes_bindings());
        let staged = (|| {
            let plan = self.engine.prepared_plan(prepared).map_err(debug)?;
            let views = self
                .engine
                .prepared_semantic_views(prepared)
                .map_err(debug)?;
            let layout = publication_layout(plan, views).map_err(status)?;
            self.transport
                .reserve_publish_capacity(layout.byte_length)
                .map_err(status)?;
            output.published_views = views.to_vec();
            self.host_buffers.apply(plan, replace_bindings)?;
            self.transport
                .stage_publication(plan, views, layout)
                .map_err(status)
        })();
        let staged = match staged {
            Ok(staged) => staged,
            Err(error) => {
                let _ = self.engine.invalidate_after_publication_failure(prepared);
                return Err(error);
            }
        };
        let commit = self
            .engine
            .commit_update(prepared)
            .map_err(|error| format!("commit: {error:?}"))?;
        self.transport.publish_success(commit, staged);
        output.publication = self.result_bytes()?;
        Ok(())
    }

    fn measure(&mut self, bytes: &[u8]) -> Result<Vec<SemanticRecord>, String> {
        let request = parse_update_request(bytes, ROOT_ID).map_err(status)?;
        let revision = self.engine.root_revision(ROOT_ID).map_err(debug)?;
        // A request that carries input takes the frame's batch entry, which prepares every
        // paragraph with input; a pure read takes the single-paragraph entry. Both must stage
        // the same candidates and the same records.
        let carries_input = request.text_mutations.len() != 0
            || request.style_mutations.len() != 0
            || request.geometry.constraint_count() != 0
            || request.geometry.inline_object_count() != 0;
        let target = if carries_input {
            PreparationTarget::Dirty(MeasuredParagraphs::All)
        } else {
            PreparationTarget::One(PARAGRAPH_ID)
        };
        let measured = self
            .engine
            .prepare_paragraphs_with_shaper(&mut self.registry, request, target)
            .map_err(|error| format!("measure: {error:?}"))?;
        if let Some((_, error)) = measured.refused {
            self.engine
                .commit_measure(measured.witness)
                .map_err(debug)?;
            return Err(format!("measure: {error:?}"));
        }
        let measured = measured.witness;
        let staged = (|| {
            let views = self
                .engine
                .measured_semantic_views(measured)
                .map_err(debug)?;
            let layout = query_layout(views).map_err(status)?;
            self.transport
                .reserve_publish_capacity(layout.byte_length)
                .map_err(status)?;
            self.transport
                .stage_query(ROOT_ID, revision, views)
                .map_err(status)?;
            Ok::<_, String>(views.to_vec())
        })();
        match staged {
            Ok(views) => {
                self.engine.commit_measure(measured).map_err(debug)?;
                Ok(views)
            }
            Err(error) => {
                let _ = self.engine.invalidate_after_measure_failure(measured);
                Err(error)
            }
        }
    }

    fn result_bytes(&self) -> Result<Vec<u8>, String> {
        let bytes = self.transport.result_bytes();
        let length = read_u32(bytes, ENGINE_RESULT_BYTE_LENGTH).map_err(status)? as usize;
        bytes
            .get(..length.max(ENGINE_RESULT_HEADER_SIZE as usize))
            .map(<[u8]>::to_vec)
            .ok_or_else(|| "publication length exceeds the transport".to_string())
    }
}

/// The renderer's side of the publication contract: buffers that exist only as the sum of the
/// patches published so far, and the draw structure last published. Comparing what these draw,
/// not the patch stream, is what lets a gather that writes whole fields be proven equal to one
/// that diffs.
#[derive(Default)]
pub struct HostBuffers {
    /// Bytes by `(buffer id, generation)`.
    buffers: BTreeMap<(u32, u32), Vec<u8>>,
    bindings: Vec<BufferRecord>,
    draws: Vec<DrawRecord>,
    primitives: Vec<PrimitiveRecord>,
}

impl HostBuffers {
    /// Every buffer the renderer holds, by id; a rebound buffer shows its live generation.
    pub fn iter(&self) -> impl Iterator<Item = (u32, &[u8])> {
        self.buffers
            .iter()
            .filter(|((id, generation), _)| {
                self.bindings
                    .iter()
                    .find(|binding| binding.id == *id)
                    .is_none_or(|binding| binding.generation == *generation)
            })
            .map(|((id, _), bytes)| (*id, bytes.as_slice()))
    }

    /// The records the renderer draws, in draw order: buffer layout, slack and capacity drop
    /// out, and what is left is what reaches the screen.
    pub fn drawn(&self) -> Result<Vec<u8>, String> {
        let mut drawn = Vec::new();
        for draw in &self.draws {
            let start = draw.primitive_start as usize;
            let primitives = self
                .primitives
                .get(start..start + draw.primitive_count as usize)
                .ok_or("draw names primitives the host does not hold")?;
            for primitive in primitives {
                let binding = self
                    .bindings
                    .iter()
                    .find(|binding| binding.id == primitive.buffer_id)
                    .ok_or("primitive names an unbound buffer")?;
                let stride = binding
                    .byte_length
                    .checked_div(binding.capacity_records)
                    .unwrap_or(0) as usize;
                let from = primitive.record_index as usize * stride;
                let records = self
                    .buffers
                    .get(&(binding.id, binding.generation))
                    .and_then(|bytes| {
                        bytes.get(from..from + usize::from(primitive.record_count) * stride)
                    })
                    .ok_or("primitive reads outside its buffer")?;
                drawn.extend_from_slice(records);
            }
        }
        Ok(drawn)
    }

    fn apply(&mut self, plan: RenderPlanView<'_>, replace_bindings: bool) -> Result<(), String> {
        if replace_bindings {
            self.bindings = plan.buffers.to_vec();
            self.primitives = plan.primitives.to_vec();
            self.draws = plan.draws.to_vec();
        }
        for (patches, payload) in [
            (plan.patches, plan.payload),
            (plan.session_patches, plan.session_payload),
        ] {
            for patch in patches {
                self.patch(*patch, payload)?;
            }
        }
        for retirement in plan.retirements.iter().chain(plan.session_retirements) {
            if retirement.kind == RETIRE_BUFFER {
                self.buffers.remove(&(retirement.id, retirement.generation));
            }
        }
        Ok(())
    }

    fn patch(&mut self, patch: PatchRecord, payload: &[u8]) -> Result<(), String> {
        let key = (patch.buffer_id, patch.buffer_generation);
        let start = patch.destination_offset as usize;
        let length = patch.byte_length as usize;
        let range = start..start + length;
        match patch.opcode {
            PATCH_ALLOCATE_OR_RESIZE => {
                self.buffers.entry(key).or_default().resize(length, 0);
            }
            PATCH_RETIRE => {
                self.buffers.remove(&key);
            }
            PATCH_WRITE => {
                let source = payload
                    .get(patch.payload_start as usize..patch.payload_start as usize + length)
                    .ok_or("patch payload out of range")?;
                self.target(key, range)?.copy_from_slice(source);
            }
            PATCH_FILL => {
                for word in self.target(key, range)?.chunks_exact_mut(4) {
                    word.copy_from_slice(&patch.fill_value.to_le_bytes());
                }
            }
            PATCH_COPY => {
                let from = patch.source_offset as usize;
                let source = self
                    .buffers
                    .iter()
                    .rev()
                    .find(|((id, _), _)| *id == patch.source_buffer_id)
                    .and_then(|(_, bytes)| bytes.get(from..from + length))
                    .ok_or("copy source out of range")?
                    .to_vec();
                self.target(key, range)?.copy_from_slice(&source);
            }
            opcode => return Err(format!("unknown patch opcode {opcode}")),
        }
        Ok(())
    }

    fn target(
        &mut self,
        key: (u32, u32),
        range: core::ops::Range<usize>,
    ) -> Result<&mut [u8], String> {
        self.buffers
            .get_mut(&key)
            .and_then(|bytes| bytes.get_mut(range))
            .ok_or_else(|| format!("patch outside buffer {} generation {}", key.0, key.1))
    }
}

fn register_font(
    registry: &mut ShaperRegistry,
    engine: &mut TextEngine,
    index: u32,
    font: &Rc<PreparedFont>,
) -> Result<(), String> {
    let handle = FIRST_FONT_HANDLE + index;
    let registered =
        registry.register_font(handle, &font.sfnt, &font.extents, &font.availability, 0, 0);
    if registered != 0 {
        return Err(status(registered));
    }
    engine
        .register_font_binding(
            FIRST_BINDING_HANDLE + index,
            handle,
            font.glyph_count,
            render_binding(font.glyph_count)?,
        )
        .map_err(debug)
}

fn render_binding(glyph_count: u32) -> Result<FontRenderBinding, String> {
    fn empty<T>(rows: u32) -> Result<FieldTable<T>, String> {
        FieldTable::new(rows, 0, vec![]).map_err(debug)
    }
    FontRenderBinding::new(
        TechniqueId(1),
        0,
        glyph_count,
        vec![FontStrike { ppem: 0 }],
        vec![FontResource {
            id: 1,
            generation: 1,
            kind: 1,
            reference: 0,
        }],
        (0..glyph_count)
            .map(|glyph| {
                if glyph == 0 {
                    MISSING_RESOURCE_INDEX
                } else {
                    0
                }
            })
            .collect(),
        empty(glyph_count)?,
        empty(glyph_count)?,
        empty(glyph_count)?,
        empty(glyph_count)?,
        empty(1)?,
        empty(1)?,
    )
    .map_err(debug)
}

/// A codec whose one program declares every semantic field as an input, so the gather
/// materializes every column the engine can project and the oracle can capture all of them.
fn every_field_codec() -> Result<ValidatedCodec, String> {
    let capability_set = |id| CapabilitySet {
        id: CapabilitySetId(id),
        flags: CAP_ORDERED_DIRECT,
        max_buffer_bytes: 1 << 24,
        update_alignment: 4,
        coalesce_gap_bytes: 0,
        range_call_penalty_bytes: 0,
        max_buffers_per_draw: 1,
        max_resources_per_draw: 1,
        max_indirect_draws: 0,
        fragmentation_budget: 1,
        whole_buffer_threshold_basis_points: 10_000,
    };
    let storage_key = BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE | BATCH_DEPTH;
    ValidatedCodec::new(CodecDescriptor {
        capability_sets: vec![capability_set(1)],
        programs: vec![ProgramDescriptor {
            primitive_kind: 1,
            technique: TechniqueId(1),
            variant: 0,
            id: ProgramId(1),
            capability_set: CapabilitySetId(0),
            resource_kind_mask: 1,
            semantic_view_mask: 0,
            storage_key_mask: storage_key,
            draw_key_mask: storage_key | BATCH_ORDER | BATCH_TRANSFORM,
            f32_input_count: SEMANTIC_F32_FIELD_COUNT,
            u32_input_count: SEMANTIC_U32_FIELD_COUNT,
            inputs: (0..SEMANTIC_F32_FIELD_COUNT)
                .chain(0..SEMANTIC_U32_FIELD_COUNT)
                .map(InputSource::semantic)
                .collect(),
            capabilities: ProgramCapabilities::default(),
            buffers: vec![BufferSchema::packed(
                BufferId(1),
                ScalarType::F32,
                1,
                BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                1,
            )],
            operations: vec![
                Operation::LoadF32 {
                    target: 0,
                    field: 0,
                },
                Operation::StoreF32 {
                    source: 0,
                    buffer: BufferId(1),
                    lane: 0,
                },
            ],
        }],
    })
    .map_err(debug)
}

fn status(code: u32) -> String {
    format!("status {code}")
}

fn debug(error: impl core::fmt::Debug) -> String {
    format!("{error:?}")
}
