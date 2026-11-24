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
            SEMANTIC_VIEW_BORROWED_LAYOUT, SEMANTIC_VIEW_GLYPH_FACTS,
            SEMANTIC_VIEW_LAYOUT_INSPECTION, SEMANTIC_VIEW_MEASUREMENT,
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
        CODEC_HANDLE, Change, Document, FIRST_STACK_HANDLE, Lifecycle, Limits, Model, PARAGRAPH_ID,
        Paragraph, ROOT_ID, RequestHeader, TextEdit, request,
    },
};

/// Every semantic view the engine can return with a publication.
pub const ALL_VIEWS: u32 =
    SEMANTIC_VIEW_MEASUREMENT | SEMANTIC_VIEW_LAYOUT_INSPECTION | SEMANTIC_VIEW_BORROWED_LAYOUT;
/// What the host asks for when it measures between publications.
const MEASURE_VIEWS: u32 = SEMANTIC_VIEW_MEASUREMENT | SEMANTIC_VIEW_BORROWED_LAYOUT;
/// What a host reading layout back after a publication asks for: the summary with its glyph
/// facts, which a summary-only read leaves to a later read.
const READ_BACK_VIEWS: u32 = MEASURE_VIEWS | SEMANTIC_VIEW_GLYPH_FACTS;
const SEMANTIC_F32_FIELD_COUNT: u8 = SEMANTIC_F32_SHADOW_OFFSET_Y_EM + 1;
const SEMANTIC_U32_FIELD_COUNT: u8 = SEMANTIC_U32_PLACEMENT_SLOT + 1;
const FIRST_FONT_HANDLE: u32 = 1;
/// The binding handle of the first font a session registers; the n-th font registered has this plus n.
pub const FIRST_BINDING_HANDLE: u32 = 41;
const INITIAL_TRANSPORT_BYTES: u32 = 1 << 16;

/// How a step that prepares before publishing splits its preparation across requests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Split {
    /// One request prepares every changed paragraph: the frame's batch.
    #[default]
    Batch,
    /// One request per changed paragraph, each a read of that paragraph while its changed
    /// siblings wait.
    Each,
    /// A read of the first changed paragraph, then one batch for the rest.
    OneThenBatch,
}

/// How one step reaches the engine. A cold layout replays the same route with no history.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Route {
    /// Semantic views requested with the publication.
    pub view_mask: u32,
    /// Apply the change through preparation first, then publish what it prepared.
    pub measure_first: bool,
    /// Measure every paragraph once more after the publication, as a host reading layout
    /// back does.
    pub measure_after: bool,
    /// With `measure_first`, how the preparation is split.
    pub split: Split,
}

impl Route {
    pub const FULL: Self = Self {
        view_mask: ALL_VIEWS,
        measure_first: false,
        measure_after: true,
        split: Split::Batch,
    };
}

/// What one step returned through the boundary.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StepOutput {
    /// The encoded publication, result header included.
    pub publication: Vec<u8>,
    /// Semantic records returned with the publication.
    pub published_views: Vec<SemanticRecord>,
    /// Semantic records of the preparation that preceded the publication, if any.
    pub measured_first: Vec<SemanticRecord>,
    /// Semantic records of the read of each paragraph that followed the publication, if any.
    pub measured_after: Vec<(u32, Vec<SemanticRecord>)>,
}

pub struct Session {
    pub(super) registry: ShaperRegistry,
    pub(super) engine: TextEngine,
    transport: FrameTransport,
    /// The document the engine holds, and the geometry revision last sent per paragraph.
    document: Option<Document>,
    geometry_revisions: BTreeMap<u32, u32>,
    /// What a renderer holds after applying every publication so far.
    pub(super) host_buffers: HostBuffers,
}

/// What one step sends, worked out from the document the engine holds and the one it is to
/// hold next.
struct Plan<'a> {
    changes: Vec<Change<'a>>,
    /// Paragraphs the engine has not seen: `(paragraph, order)`.
    created: Vec<(u32, u32)>,
    /// Paragraphs it has seen whose order changed.
    reordered: Vec<(u32, u32)>,
    removed: Vec<u32>,
    ranked: Vec<(u32, u32, f64)>,
}

impl Plan<'_> {
    /// Records where `paragraph` sorts if that is new or has changed.
    fn place(&mut self, paragraph: &Paragraph, sent: Option<&Paragraph>) {
        match sent {
            None => self.created.push((paragraph.id, paragraph.order)),
            Some(sent) if sent.order != paragraph.order => {
                self.reordered.push((paragraph.id, paragraph.order));
            }
            Some(_) => {}
        }
        let ranked = sent.map_or((0, 0.0), |sent| (sent.scope, sent.rank));
        if (paragraph.scope, paragraph.rank.to_bits()) != (ranked.0, ranked.1.to_bits()) {
            self.ranked
                .push((paragraph.id, paragraph.scope, paragraph.rank));
        }
    }

    /// The order a new paragraph is created at by a preparation request. Its own order may
    /// still belong to a paragraph the publication is about to move or remove, so it is
    /// created at a temporary one counted down from the top, as the host does, and the
    /// publication restates it.
    fn preparation_order(&self, previous: Option<&Document>, id: u32, order: u32) -> u32 {
        let held = previous.is_some_and(|previous| {
            previous
                .paragraphs
                .iter()
                .any(|sent| sent.order == order && !self.removed.contains(&sent.id))
        });
        if !held {
            return order;
        }
        let index = self.created.iter().position(|(created, _)| *created == id);
        u32::MAX - index.unwrap_or(0) as u32
    }

    /// New paragraphs that a preparation created away from their own order.
    fn displaced(&self, previous: Option<&Document>) -> Vec<(u32, u32)> {
        self.created
            .iter()
            .copied()
            .filter(|(id, order)| self.preparation_order(previous, *id, *order) != *order)
            .collect()
    }
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
            document: None,
            geometry_revisions: BTreeMap::new(),
            host_buffers: HostBuffers::default(),
        })
    }

    /// The engine and its font registry, for reads over the layout the last step prepared.
    pub fn engine(&self) -> (&TextEngine, &ShaperRegistry) {
        (&self.engine, &self.registry)
    }

    /// The engine alone, for the one editing call that fills a lazy lane.
    pub fn engine_mut(&mut self) -> &mut TextEngine {
        &mut self.engine
    }

    pub fn document(&self) -> Option<&Document> {
        self.document.as_ref()
    }

    /// Moves a root that holds one implicit paragraph to `next`. `edits` are the text
    /// difference from the current model, in application order, and are ignored on the first
    /// step, which inserts the whole text.
    pub fn step(
        &mut self,
        next: &Model,
        edits: &[TextEdit],
        route: Route,
    ) -> Result<StepOutput, String> {
        self.step_document(
            &Document::single(next.clone()),
            &[(PARAGRAPH_ID, edits.to_vec())],
            route,
        )
    }

    /// Moves the engine to `next`. `edits` are each paragraph's text difference from the
    /// current document, in application order; a paragraph new to the engine ignores them and
    /// inserts its whole text.
    pub fn step_document(
        &mut self,
        next: &Document,
        edits: &[(u32, Vec<TextEdit>)],
        route: Route,
    ) -> Result<StepOutput, String> {
        let previous = self.document.take();
        if previous.is_none() {
            let units: usize = next.paragraphs.iter().map(|p| p.model.text.len()).sum();
            self.engine
                .reserve_root_text(ROOT_ID, units.max(1) as u32)
                .map_err(debug)?;
        }
        self.advance_geometry(previous.as_ref(), next);
        let plan = self.plan(previous.as_ref(), next, edits);
        // A single implicit paragraph declares the bounds of the text it is given, as it
        // always has; a document declares bounds that also cover what the step removes.
        let limits = match (&previous, next.explicit) {
            (Some(previous), true) => Limits::of(next).covering(Limits::of(previous)),
            _ => Limits::of(next),
        };
        let mut output = StepOutput::default();
        // The engine holds `next` from the first request that carries it, whatever follows.
        let sent = (|| {
            if route.measure_first {
                let preparations =
                    self.preparations(&plan, limits, (previous.as_ref(), next), route.split);
                // Removals ride in the first preparation request. With nothing to prepare and
                // no paragraph left to read there is none, and the publication carries them.
                let unsent = if preparations.is_empty() {
                    plan.removed.clone()
                } else {
                    Vec::new()
                };
                for (bytes, target) in preparations {
                    output.measured_first.extend(self.measure(&bytes, target)?);
                }
                // A paragraph created at a temporary order is restated at its own here.
                let lifecycle = Lifecycle {
                    removes: unsent,
                    upserts: [plan.reordered.clone(), plan.displaced(previous.as_ref())].concat(),
                    orders: plan.ranked.clone(),
                };
                let publish = request(self.header(route.view_mask), limits, &lifecycle, &[]);
                self.publish(&publish, &mut output)
            } else {
                let lifecycle = Lifecycle {
                    removes: plan.removed.clone(),
                    upserts: [plan.created.clone(), plan.reordered.clone()].concat(),
                    orders: plan.ranked.clone(),
                };
                let change = request(
                    self.header(route.view_mask),
                    limits,
                    &lifecycle,
                    &plan.changes,
                );
                self.publish(&change, &mut output)
            }
        })();
        drop(plan);
        match sent {
            Ok(()) => self.document = Some(next.clone()),
            Err(error) => {
                self.document = previous;
                return Err(error);
            }
        }
        if route.measure_after {
            for id in next.ids() {
                let query = request(
                    self.header(READ_BACK_VIEWS),
                    limits,
                    &Lifecycle::default(),
                    &[],
                );
                let views = self.measure(&query, Some(id))?;
                output.measured_after.push((id, views));
            }
        }
        Ok(output)
    }

    /// A paragraph's geometry revision advances each time its geometry is sent.
    fn advance_geometry(&mut self, previous: Option<&Document>, next: &Document) {
        for paragraph in &next.paragraphs {
            let unchanged = previous
                .and_then(|previous| previous.paragraph(paragraph.id))
                .is_some_and(|sent| !paragraph.model.geometry_differs(&sent.model));
            if !unchanged {
                *self.geometry_revisions.entry(paragraph.id).or_insert(0) += 1;
            }
        }
    }

    fn plan<'a>(
        &self,
        previous: Option<&'a Document>,
        next: &'a Document,
        edits: &'a [(u32, Vec<TextEdit>)],
    ) -> Plan<'a> {
        let mut plan = Plan {
            changes: Vec::new(),
            created: Vec::new(),
            reordered: Vec::new(),
            removed: Vec::new(),
            ranked: Vec::new(),
        };
        for id in next.ids() {
            let Some(paragraph) = next.paragraph(id) else {
                continue;
            };
            let sent = previous.and_then(|previous| previous.paragraph(id));
            let edits = edits
                .iter()
                .find(|(edited, _)| *edited == id)
                .map_or(&[][..], |(_, edits)| edits.as_slice());
            // An edit that leaves the text as it was is still sent: the host sends what the
            // caller set.
            if sent.is_none_or(|sent| sent.model != paragraph.model) || !edits.is_empty() {
                plan.changes.push(Change {
                    id,
                    previous: sent.map(|sent| &sent.model),
                    next: &paragraph.model,
                    edits,
                    geometry_revision: self.geometry_revisions.get(&id).copied().unwrap_or(1),
                });
            }
            if next.explicit {
                plan.place(paragraph, sent);
            }
        }
        if let (true, Some(previous)) = (next.explicit, previous) {
            plan.removed = previous
                .ids()
                .into_iter()
                .filter(|id| next.paragraph(*id).is_none())
                .collect();
        }
        plan
    }

    /// The preparation requests of a step that prepares before publishing, each with the
    /// paragraph it reads, or `None` for the batch. Removals ride in the first request, and a
    /// new paragraph's creation rides with its own input, as the host sends them.
    fn preparations(
        &self,
        plan: &Plan<'_>,
        limits: Limits,
        (previous, next): (Option<&Document>, &Document),
        split: Split,
    ) -> Vec<(Vec<u8>, Option<u32>)> {
        let groups: Vec<(&[Change<'_>], Option<u32>)> = match (split, plan.changes.as_slice()) {
            // Nothing changed: the host still reads, and reads the first paragraph. A root
            // with no paragraph has nothing to read.
            (_, []) => next
                .ids()
                .first()
                .map(|first| (&[][..], Some(*first)))
                .into_iter()
                .collect(),
            (Split::Batch, changes) => alloc::vec![(changes, None)],
            (Split::Each, changes) => changes
                .chunks(1)
                .rev()
                .map(|change| (change, Some(change[0].id)))
                .collect(),
            (Split::OneThenBatch, [first, rest @ ..]) => {
                let mut groups = alloc::vec![(core::slice::from_ref(first), Some(first.id))];
                if !rest.is_empty() {
                    groups.push((rest, None));
                }
                groups
            }
        };
        groups
            .into_iter()
            .enumerate()
            .map(|(index, (changes, target))| {
                let lifecycle = Lifecycle {
                    removes: if index == 0 {
                        plan.removed.clone()
                    } else {
                        Vec::new()
                    },
                    upserts: plan
                        .created
                        .iter()
                        .filter(|(id, _)| changes.iter().any(|change| change.id == *id))
                        .map(|(id, order)| (*id, plan.preparation_order(previous, *id, *order)))
                        .collect(),
                    orders: Vec::new(),
                };
                let bytes = request(self.header(MEASURE_VIEWS), limits, &lifecycle, changes);
                (bytes, target)
            })
            .collect()
    }

    fn header(&self, view_mask: u32) -> RequestHeader {
        let revision = self.engine.root_revision(ROOT_ID).unwrap_or_default();
        RequestHeader {
            engine_revision: revision.engine,
            root_revision: revision.root,
            acknowledged_generation: self
                .transport
                .next_publication_generation()
                .map_or(0, |next| next - 1),
            view_mask,
        }
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

    /// Prepares without publishing. `read` names the paragraph a read asks about; without one
    /// the request is the frame's batch when it carries input, and a read of the first
    /// paragraph when it does not.
    fn measure(&mut self, bytes: &[u8], read: Option<u32>) -> Result<Vec<SemanticRecord>, String> {
        let request = parse_update_request(bytes, ROOT_ID).map_err(status)?;
        let revision = self.engine.root_revision(ROOT_ID).map_err(debug)?;
        // A request that carries input takes the frame's batch entry, which prepares every
        // paragraph with input; a pure read takes the single-paragraph entry. Both must stage
        // the same candidates and the same records.
        let carries_input = request.text_mutations.len() != 0
            || request.style_mutations.len() != 0
            || request.geometry.constraint_count() != 0
            || request.geometry.inline_object_count() != 0;
        let target = match read {
            Some(paragraph) => PreparationTarget::One(paragraph),
            None if carries_input => {
                PreparationTarget::Dirty(MeasuredParagraphs::All, MeasuredParagraphs::Only(&[]))
            }
            None => PreparationTarget::One(PARAGRAPH_ID),
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

    /// The draw packets the renderer holds, in draw order.
    pub fn draws(&self) -> &[DrawRecord] {
        &self.draws
    }

    /// The primitive spans the draw packets index.
    pub fn primitives(&self) -> &[PrimitiveRecord] {
        &self.primitives
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
