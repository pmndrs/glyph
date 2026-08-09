//! Policy-directed gather from semantic layout and normalized font bindings.

use alloc::vec::Vec;

use super::{
    font_binding::{FontRenderBinding, SelectedGlyphBinding},
    frame::{
        SEMANTIC_F32_FOREGROUND_ALPHA, SEMANTIC_F32_FOREGROUND_BLUE, SEMANTIC_F32_FOREGROUND_GREEN,
        SEMANTIC_F32_FOREGROUND_RED, SEMANTIC_F32_INVERSE_FONT_SIZE, SEMANTIC_U32_FOREGROUND_RGBA,
    },
    plan_input::{PlanGlyph, PlanInput},
    policy::{CapabilitySetId, InputScope, MAX_REGISTERS, ProgramDescriptor, ValidatedPolicy},
};

// `fontSize` and `rasterPixelRatio` can select a different baked resource.
// A replacement batch must therefore receive every input stream once even when
// the policy dependency mask would omit unchanged fields from an in-place patch.
const RESOURCE_SELECTION_CHANGES: u16 = (1 << 4) | (1 << 5);

pub const DEFAULT_GATHER_RECORD_CAPACITY: usize = 32_768;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutGlyph {
    pub stable_id: u32,
    pub content_revision: u32,
    pub binding_handle: u32,
    pub font_handle: u32,
    pub glyph_id: u32,
    pub semantic_id: u32,
    pub material_id: u32,
    pub clip_id: u32,
    pub depth_key: u32,
    pub font_size: f32,
    pub raster_pixel_ratio: f32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
}

#[derive(Clone, Copy)]
pub struct LayoutPlanInput<'a> {
    pub transform_id: u32,
    pub glyphs: &'a [LayoutGlyph],
    pub semantic_change_masks: &'a [u16],
    pub semantic_f32: &'a [&'a [f32]],
    pub semantic_u32: &'a [&'a [u32]],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GatherError {
    AllocationFailed,
    InvalidSemanticShape,
    FontBindingMissing,
    GlyphBindingMissing,
    ResourceBindingMissing,
    ProgramMissing,
    SourceFieldMissing,
}

#[derive(Default)]
pub struct PolicyGatherWorkspace {
    glyphs: Vec<PlanGlyph>,
    semantic_change_masks: Vec<u16>,
    f32_fields: Vec<AlignedField<f32>>,
    u32_fields: Vec<AlignedField<u32>>,
}

#[repr(C, align(16))]
struct AlignedBlock<T> {
    values: [T; 4],
}

struct AlignedField<T> {
    blocks: Vec<AlignedBlock<T>>,
    len: usize,
}

pub struct GatheredPlanInput<'a> {
    glyphs: &'a [PlanGlyph],
    semantic_change_masks: &'a [u16],
    f32_fields: [&'a [f32]; MAX_REGISTERS],
    u32_fields: [&'a [u32]; MAX_REGISTERS],
    f32_field_count: usize,
    u32_field_count: usize,
}

impl PolicyGatherWorkspace {
    pub fn reserve_records(&mut self, record_capacity: usize) -> Result<(), GatherError> {
        reserve(&mut self.glyphs, record_capacity)?;
        reserve(&mut self.semantic_change_masks, record_capacity)
    }

    pub fn reserve_policy(
        &mut self,
        policy: &ValidatedPolicy,
        record_capacity: usize,
    ) -> Result<(), GatherError> {
        let f32_fields = policy
            .programs()
            .iter()
            .map(|program| usize::from(program.f32_input_count))
            .max()
            .unwrap_or(0);
        let u32_fields = policy
            .programs()
            .iter()
            .map(|program| usize::from(program.u32_input_count))
            .max()
            .unwrap_or(0);
        reserve_fields(&mut self.f32_fields, f32_fields, record_capacity)?;
        reserve_fields(&mut self.u32_fields, u32_fields, record_capacity)?;
        self.reserve_records(record_capacity)?;
        Ok(())
    }

    pub fn gather<'binding>(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        force_all_inputs: bool,
        binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        self.begin(policy, input.glyphs.len())?;
        self.append(
            policy,
            capability_set,
            input,
            force_all_inputs,
            binding_for_font,
        )
    }

    pub fn begin(
        &mut self,
        policy: &ValidatedPolicy,
        record_capacity: usize,
    ) -> Result<(), GatherError> {
        self.reserve_policy(policy, record_capacity)?;
        self.clear();
        Ok(())
    }

    pub fn append<'binding>(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        force_all_inputs: bool,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        validate_semantic_shape(input)?;
        let required = self.glyphs.len().saturating_add(input.glyphs.len());
        if self.glyphs.capacity() < required
            || self.semantic_change_masks.capacity() < required
            || self
                .f32_fields
                .iter()
                .any(|field| field.capacity() < required)
            || self
                .u32_fields
                .iter()
                .any(|field| field.capacity() < required)
        {
            return Err(GatherError::AllocationFailed);
        }
        let semantic_changes = if input.semantic_change_masks.len() == input.glyphs.len() {
            input
                .semantic_change_masks
                .iter()
                .copied()
                .fold(0_u16, |union, mask| union | mask)
        } else {
            super::positioning::ALL_SEMANTIC_CHANGES
        };
        let selection_changed = semantic_changes & RESOURCE_SELECTION_CHANGES != 0;
        let mut cached_font_handle = None;
        let mut cached_binding = None;
        let mut cached_program = None;
        for glyph_index in 0..input.glyphs.len() {
            let glyph = input.glyphs[glyph_index];
            let binding = if cached_font_handle == Some(glyph.binding_handle) {
                cached_binding.ok_or(GatherError::FontBindingMissing)?
            } else {
                let binding = binding_for_font(glyph.binding_handle)
                    .ok_or(GatherError::FontBindingMissing)?;
                cached_font_handle = Some(glyph.binding_handle);
                cached_binding = Some(binding);
                binding
            };
            let Some(selected) =
                binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
            else {
                continue;
            };
            let technique = binding.technique();
            let variant = binding.program_variant();
            let (program, f32_inputs, u32_inputs) = match cached_program {
                Some((cached_technique, cached_variant, program, f32_inputs, u32_inputs))
                    if cached_technique == technique && cached_variant == variant =>
                {
                    (program, f32_inputs, u32_inputs)
                }
                _ => {
                    let program = policy
                        .program(capability_set, technique, variant)
                        .ok_or(GatherError::ProgramMissing)?;
                    let (f32_inputs, u32_inputs) = policy
                        .input_masks_for_changes(
                            capability_set,
                            technique,
                            variant,
                            semantic_changes,
                            force_all_inputs || selection_changed,
                        )
                        .ok_or(GatherError::ProgramMissing)?;
                    cached_program = Some((technique, variant, program, f32_inputs, u32_inputs));
                    (program, f32_inputs, u32_inputs)
                }
            };
            self.gather_fields(
                input,
                glyph_index,
                binding,
                selected,
                program,
                f32_inputs,
                u32_inputs,
            )?;
            let resource = binding
                .resources()
                .get(
                    usize::try_from(selected.resource)
                        .map_err(|_| GatherError::ResourceBindingMissing)?,
                )
                .ok_or(GatherError::ResourceBindingMissing)?;
            self.glyphs.push(PlanGlyph {
                stable_id: glyph.stable_id,
                content_revision: glyph.content_revision,
                technique: binding.technique(),
                program_variant: binding.program_variant(),
                resource_id: resource.id,
                resource_generation: resource.generation,
                resource_kind: resource.kind,
                resource_reference: resource.reference,
                semantic_id: glyph.semantic_id,
                transform_id: input.transform_id,
                material_id: glyph.material_id,
                clip_id: glyph.clip_id,
                depth_key: glyph.depth_key,
                inline_start: glyph.inline_start,
                block_start: glyph.block_start,
                inline_extent: glyph.inline_extent,
                block_extent: glyph.block_extent,
            });
            self.semantic_change_masks.push(
                input
                    .semantic_change_masks
                    .get(glyph_index)
                    .copied()
                    .unwrap_or(super::positioning::ALL_SEMANTIC_CHANGES),
            );
        }
        Ok(())
    }

    pub fn view(&self) -> GatheredPlanInput<'_> {
        let mut f32_fields = [&[][..]; MAX_REGISTERS];
        let mut u32_fields = [&[][..]; MAX_REGISTERS];
        for (target, field) in f32_fields.iter_mut().zip(&self.f32_fields) {
            *target = field.as_slice();
        }
        for (target, field) in u32_fields.iter_mut().zip(&self.u32_fields) {
            *target = field.as_slice();
        }
        GatheredPlanInput {
            glyphs: &self.glyphs,
            semantic_change_masks: &self.semantic_change_masks,
            f32_fields,
            u32_fields,
            f32_field_count: self.f32_fields.len(),
            u32_field_count: self.u32_fields.len(),
        }
    }

    fn gather_fields(
        &mut self,
        input: LayoutPlanInput<'_>,
        glyph_index: usize,
        binding: &FontRenderBinding,
        selected: SelectedGlyphBinding,
        program: &ProgramDescriptor,
        required_f32: u32,
        required_u32: u32,
    ) -> Result<(), GatherError> {
        let f32_count = usize::from(program.f32_input_count);
        let u32_count = usize::from(program.u32_input_count);
        for field in 0..self.f32_fields.len() {
            let value = if field < f32_count && required_f32 & (1 << field) != 0 {
                let source = program.inputs[field];
                source_f32(
                    source.scope,
                    source.field,
                    input,
                    glyph_index,
                    binding,
                    selected,
                )?
            } else {
                0.0
            };
            self.f32_fields[field].push(value)?;
        }
        for field in 0..self.u32_fields.len() {
            let value = if field < u32_count && required_u32 & (1 << field) != 0 {
                let source = program.inputs[f32_count + field];
                source_u32(
                    source.scope,
                    source.field,
                    input,
                    glyph_index,
                    binding,
                    selected,
                )?
            } else {
                0
            };
            self.u32_fields[field].push(value)?;
        }
        Ok(())
    }

    fn clear(&mut self) {
        self.glyphs.clear();
        self.semantic_change_masks.clear();
        for field in &mut self.f32_fields {
            field.clear();
        }
        for field in &mut self.u32_fields {
            field.clear();
        }
    }
}

impl<T> Default for AlignedField<T> {
    fn default() -> Self {
        Self {
            blocks: Vec::new(),
            len: 0,
        }
    }
}

impl<T: Copy + Default> AlignedField<T> {
    fn reserve(&mut self, record_capacity: usize) -> Result<(), GatherError> {
        let block_capacity = record_capacity.div_ceil(4);
        if self.blocks.capacity() < block_capacity {
            self.blocks
                .try_reserve_exact(block_capacity.saturating_sub(self.blocks.len()))
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        Ok(())
    }

    fn push(&mut self, value: T) -> Result<(), GatherError> {
        let lane = self.len % 4;
        if lane == 0 {
            if self.blocks.len() == self.blocks.capacity() {
                return Err(GatherError::AllocationFailed);
            }
            self.blocks.push(AlignedBlock {
                values: [T::default(); 4],
            });
        }
        let block = self
            .blocks
            .last_mut()
            .ok_or(GatherError::AllocationFailed)?;
        block.values[lane] = value;
        self.len += 1;
        Ok(())
    }

    fn clear(&mut self) {
        self.blocks.clear();
        self.len = 0;
    }

    fn as_slice(&self) -> &[T] {
        debug_assert_eq!(
            core::mem::size_of::<AlignedBlock<T>>(),
            core::mem::size_of::<T>() * 4
        );
        // SAFETY: `AlignedBlock<T>` is exactly four contiguous `T` values with no trailing
        // padding for the only instantiated 32-bit scalar types. `len` never exceeds the
        // initialized block prefix, and blocks cannot move while this shared slice exists.
        unsafe { core::slice::from_raw_parts(self.blocks.as_ptr().cast::<T>(), self.len) }
    }

    fn capacity(&self) -> usize {
        self.blocks.capacity() * 4
    }
}

impl GatheredPlanInput<'_> {
    pub fn plan_input(&self) -> PlanInput<'_> {
        PlanInput {
            glyphs: self.glyphs,
            semantic_change_masks: self.semantic_change_masks,
            f32_fields: &self.f32_fields[..self.f32_field_count],
            u32_fields: &self.u32_fields[..self.u32_field_count],
            order_independent: false,
        }
    }
}

fn validate_semantic_shape(input: LayoutPlanInput<'_>) -> Result<(), GatherError> {
    if (!input.semantic_change_masks.is_empty()
        && input.semantic_change_masks.len() != input.glyphs.len())
        || input.semantic_f32.iter().any(|field| {
            field.len() != input.glyphs.len() || field.iter().any(|value| !value.is_finite())
        })
        || input
            .semantic_u32
            .iter()
            .any(|field| field.len() != input.glyphs.len())
    {
        return Err(GatherError::InvalidSemanticShape);
    }
    Ok(())
}

fn source_f32(
    scope: InputScope,
    field: u8,
    input: LayoutPlanInput<'_>,
    glyph_index: usize,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<f32, GatherError> {
    let (table, row) = match scope {
        InputScope::Semantic => {
            if let Some(value) = derived_semantic_f32(field, input, glyph_index)? {
                return Ok(value);
            }
            return input
                .semantic_f32
                .get(usize::from(field))
                .and_then(|values| values.get(glyph_index))
                .copied()
                .ok_or(GatherError::SourceFieldMissing);
        }
        InputScope::Glyph => (
            binding.glyph_f32(),
            binding_row(input.glyphs[glyph_index].glyph_id)?,
        ),
        InputScope::Strike => (binding.strike_f32(), binding_row(selected.strike_row)?),
        InputScope::Resource => (binding.resource_f32(), binding_row(selected.resource)?),
    };
    table
        .field(field)
        .and_then(|values| values.get(row))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)
}

fn derived_semantic_f32(
    field: u8,
    input: LayoutPlanInput<'_>,
    glyph_index: usize,
) -> Result<Option<f32>, GatherError> {
    if field == SEMANTIC_F32_INVERSE_FONT_SIZE {
        let font_size = input
            .glyphs
            .get(glyph_index)
            .map(|glyph| glyph.font_size)
            .ok_or(GatherError::SourceFieldMissing)?;
        return Ok(Some(1.0 / font_size));
    }
    let shift = match field {
        SEMANTIC_F32_FOREGROUND_RED => 24,
        SEMANTIC_F32_FOREGROUND_GREEN => 16,
        SEMANTIC_F32_FOREGROUND_BLUE => 8,
        SEMANTIC_F32_FOREGROUND_ALPHA => 0,
        _ => return Ok(None),
    };
    let packed = input
        .semantic_u32
        .get(usize::from(SEMANTIC_U32_FOREGROUND_RGBA))
        .and_then(|values| values.get(glyph_index))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)?;
    let channel = (packed >> shift) & 0xff;
    Ok(Some((f64::from(channel) / 255.0) as f32))
}

fn source_u32(
    scope: InputScope,
    field: u8,
    input: LayoutPlanInput<'_>,
    glyph_index: usize,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<u32, GatherError> {
    let (table, row) = match scope {
        InputScope::Semantic => {
            return input
                .semantic_u32
                .get(usize::from(field))
                .and_then(|values| values.get(glyph_index))
                .copied()
                .ok_or(GatherError::SourceFieldMissing);
        }
        InputScope::Glyph => (
            binding.glyph_u32(),
            binding_row(input.glyphs[glyph_index].glyph_id)?,
        ),
        InputScope::Strike => (binding.strike_u32(), binding_row(selected.strike_row)?),
        InputScope::Resource => (binding.resource_u32(), binding_row(selected.resource)?),
    };
    table
        .field(field)
        .and_then(|values| values.get(row))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)
}

fn binding_row(row: u32) -> Result<usize, GatherError> {
    usize::try_from(row).map_err(|_| GatherError::SourceFieldMissing)
}

fn reserve_fields<T: Copy + Default>(
    fields: &mut Vec<AlignedField<T>>,
    field_count: usize,
    record_capacity: usize,
) -> Result<(), GatherError> {
    reserve(fields, field_count)?;
    while fields.len() < field_count {
        fields.push(AlignedField::default());
    }
    for field in fields {
        field.reserve(record_capacity)?;
    }
    Ok(())
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), GatherError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| GatherError::AllocationFailed)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        font_binding::{FieldTable, FontResource, FontStrike},
        policy::{
            ALLOCATION_ORDERED_DIRECT, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE,
            BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, BufferSchema,
            CAP_ORDERED_DIRECT, CAP_STORAGE_BUFFERS, CapabilitySet, InputSource, Operation,
            PolicyDescriptor, ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType,
            TechniqueId,
        },
        render_plan_compiler::RenderPlanCompiler,
    };
    use alloc::vec;

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);

    #[test]
    fn derives_policy_color_channels_and_inverse_font_size_without_retained_arrays() {
        let glyphs = [layout_glyph(1, 0)];
        let foreground = [0x8040_20ff];
        let input = LayoutPlanInput {
            transform_id: 1,
            glyphs: &glyphs,
            semantic_change_masks: &[],
            semantic_f32: &[],
            semantic_u32: &[&foreground],
        };
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_RED, input, 0),
            Ok(Some((128.0_f64 / 255.0) as f32))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_GREEN, input, 0),
            Ok(Some((64.0_f64 / 255.0) as f32))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_BLUE, input, 0),
            Ok(Some((32.0_f64 / 255.0) as f32))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_ALPHA, input, 0),
            Ok(Some(1.0))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_INVERSE_FONT_SIZE, input, 0),
            Ok(Some(1.0 / 16.0))
        );
    }

    #[test]
    fn gathers_program_specific_sources_without_a_union_record() {
        let binding = binding();
        let policy = policy();
        let glyphs = [layout_glyph(1, 0), layout_glyph(2, 1)];
        let semantic_x = [10.0, 20.0];
        let semantic_kind = [100, 200];
        let mut workspace = PolicyGatherWorkspace::default();
        workspace.reserve_policy(&policy, 8).unwrap();
        let capacities = workspace.capacities();
        workspace
            .gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[],
                    semantic_f32: &[&semantic_x],
                    semantic_u32: &[&semantic_kind],
                },
                true,
                |handle| (handle == 9).then_some(&binding),
            )
            .unwrap();
        {
            let gathered = workspace.view();
            let input = gathered.plan_input();
            assert_eq!(core::mem::size_of::<PlanGlyph>(), 64);
            assert!(
                input
                    .f32_fields
                    .iter()
                    .all(|field| (field.as_ptr() as usize).is_multiple_of(16))
            );
            assert!(
                input
                    .u32_fields
                    .iter()
                    .all(|field| (field.as_ptr() as usize).is_multiple_of(16))
            );
            assert_eq!(input.glyphs[0].resource_id, 71);
            assert_eq!(input.glyphs[1].resource_reference, 901);
            assert_eq!(input.f32_fields[0], &[10.0, 20.0]);
            assert_eq!(input.f32_fields[1], &[1.0, 2.0]);
            assert_eq!(input.f32_fields[2], &[3.0, 4.0]);
            assert_eq!(input.f32_fields[3], &[5.0, 5.0]);
            assert_eq!(input.u32_fields[0], &[100, 200]);
            assert_eq!(input.u32_fields[1], &[11, 12]);
            assert_eq!(input.u32_fields[2], &[13, 14]);
            assert_eq!(input.u32_fields[3], &[15, 15]);

            let mut compiler = RenderPlanCompiler::default();
            compiler
                .prepare(&policy, CAPABILITY, input, true, 1, 0)
                .unwrap();
            let plan = compiler
                .plan_view(3, CAPABILITY, policy.fingerprint())
                .unwrap();
            assert_eq!(plan.draws.len(), 1);
            assert_eq!(plan.draws[0].transform_id, 1);
            assert_eq!(plan.primitives[0].record_count, 2);
            assert_eq!(plan.primitives[0].semantic_id, 0);
            assert_eq!(plan.patches.len(), 2);
            assert_eq!(
                &plan.payload[..8],
                &[10.0_f32.to_le_bytes(), 20.0_f32.to_le_bytes(),].concat(),
            );
        }
        assert_eq!(workspace.capacities(), capacities);
    }

    #[test]
    fn appends_independent_layouts_into_one_plan_input() {
        let binding = binding();
        let policy = policy();
        let first = [layout_glyph(1, 0)];
        let second = [layout_glyph(2, 1)];
        let first_x = [10.0];
        let second_x = [20.0];
        let first_kind = [100];
        let second_kind = [200];
        let mut workspace = PolicyGatherWorkspace::default();
        workspace.begin(&policy, 2).unwrap();
        for input in [
            LayoutPlanInput {
                transform_id: 1,
                glyphs: &first,
                semantic_change_masks: &[],
                semantic_f32: &[&first_x],
                semantic_u32: &[&first_kind],
            },
            LayoutPlanInput {
                transform_id: 2,
                glyphs: &second,
                semantic_change_masks: &[],
                semantic_f32: &[&second_x],
                semantic_u32: &[&second_kind],
            },
        ] {
            workspace
                .append(&policy, CAPABILITY, input, true, |_| Some(&binding))
                .unwrap();
        }
        let gathered = workspace.view();
        let input = gathered.plan_input();
        assert_eq!(input.glyphs.len(), 2);
        assert_eq!(input.glyphs[0].stable_id, 1);
        assert_eq!(input.glyphs[1].stable_id, 2);
        assert_eq!(input.glyphs[0].transform_id, 1);
        assert_eq!(input.glyphs[1].transform_id, 2);
        assert_eq!(input.f32_fields[0], &[10.0, 20.0]);
        assert_eq!(input.u32_fields[0], &[100, 200]);
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare(&policy, CAPABILITY, input, true, 1, 0)
            .unwrap();
        let plan = compiler
            .plan_view(3, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(
            plan.draws
                .iter()
                .map(|draw| draw.transform_id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
    }

    #[test]
    fn changed_gather_reads_only_inputs_reaching_changed_buffers() {
        let binding = binding();
        let policy = policy();
        let glyphs = [layout_glyph(1, 0), layout_glyph(2, 1)];
        let semantic_x = [10.0, 20.0];
        let semantic_kind = [100, 200];
        let mut workspace = PolicyGatherWorkspace::default();
        workspace
            .gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[1, 1],
                    semantic_f32: &[&semantic_x],
                    semantic_u32: &[&semantic_kind],
                },
                false,
                |_| Some(&binding),
            )
            .unwrap();
        let gathered = workspace.view();
        let input = gathered.plan_input();
        assert_eq!(input.f32_fields[0], &[10.0, 20.0]);
        assert!(
            input.f32_fields[1..]
                .iter()
                .all(|field| *field == [0.0, 0.0])
        );
        assert!(input.u32_fields.iter().all(|field| *field == [0, 0]));
    }

    #[test]
    fn font_selection_changes_retain_inputs_needed_to_initialize_a_new_resource_batch() {
        let binding = binding();
        let policy = policy();
        let glyphs = [layout_glyph(1, 0), layout_glyph(2, 1)];
        let semantic_x = [10.0, 20.0];
        let semantic_kind = [100, 200];
        let mut workspace = PolicyGatherWorkspace::default();
        workspace
            .gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[
                        RESOURCE_SELECTION_CHANGES,
                        RESOURCE_SELECTION_CHANGES,
                    ],
                    semantic_f32: &[&semantic_x],
                    semantic_u32: &[&semantic_kind],
                },
                false,
                |_| Some(&binding),
            )
            .unwrap();

        let gathered = workspace.view();
        let input = gathered.plan_input();
        assert_eq!(input.f32_fields[0], semantic_x);
        assert_eq!(input.u32_fields[0], semantic_kind);
    }

    #[test]
    fn missing_program_binding_and_source_are_explicit() {
        let binding = binding();
        let policy = policy();
        let glyphs = [layout_glyph(1, 0)];
        let mut workspace = PolicyGatherWorkspace::default();
        assert_eq!(
            workspace.gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[],
                    semantic_f32: &[],
                    semantic_u32: &[],
                },
                true,
                |_| None,
            ),
            Err(GatherError::FontBindingMissing)
        );
        assert_eq!(
            workspace.gather(
                &policy,
                CapabilitySetId(2),
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[],
                    semantic_f32: &[],
                    semantic_u32: &[],
                },
                true,
                |_| Some(&binding),
            ),
            Err(GatherError::ProgramMissing)
        );
        assert_eq!(
            workspace.gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_change_masks: &[],
                    semantic_f32: &[],
                    semantic_u32: &[],
                },
                true,
                |_| Some(&binding),
            ),
            Err(GatherError::SourceFieldMissing)
        );
    }

    impl PolicyGatherWorkspace {
        fn capacities(&self) -> (usize, Vec<usize>, Vec<usize>) {
            (
                self.glyphs.capacity(),
                self.f32_fields.iter().map(AlignedField::capacity).collect(),
                self.u32_fields.iter().map(AlignedField::capacity).collect(),
            )
        }
    }

    fn layout_glyph(stable_id: u32, glyph_id: u32) -> LayoutGlyph {
        LayoutGlyph {
            stable_id,
            content_revision: 1,
            binding_handle: 9,
            font_handle: 9,
            glyph_id,
            semantic_id: stable_id,
            material_id: 6,
            clip_id: 0,
            depth_key: 0,
            font_size: 16.0,
            raster_pixel_ratio: 2.0,
            inline_start: glyph_id as f32 * 10.0,
            block_start: 0.0,
            inline_extent: 8.0,
            block_extent: 16.0,
        }
    }

    fn binding() -> FontRenderBinding {
        FontRenderBinding::new(
            TechniqueId(7),
            2,
            2,
            vec![FontStrike { ppem: 0 }],
            vec![FontResource {
                id: 71,
                generation: 3,
                kind: 2,
                reference: 901,
            }],
            vec![0, 0],
            FieldTable::new(2, 1, vec![1.0, 2.0]).unwrap(),
            FieldTable::new(2, 1, vec![11, 12]).unwrap(),
            FieldTable::new(2, 1, vec![3.0, 4.0]).unwrap(),
            FieldTable::new(2, 1, vec![13, 14]).unwrap(),
            FieldTable::new(1, 1, vec![5.0]).unwrap(),
            FieldTable::new(1, 1, vec![15]).unwrap(),
        )
        .unwrap()
    }

    fn policy() -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CAPABILITY,
                flags: CAP_ORDERED_DIRECT | CAP_STORAGE_BUFFERS,
                max_buffer_bytes: 1 << 20,
                update_alignment: 4,
                coalesce_gap_bytes: 0,
                range_call_penalty_bytes: 1,
                max_buffers_per_draw: 16,
                max_resources_per_draw: 1,
                max_indirect_draws: 0,
                fragmentation_budget: 8,
                whole_buffer_threshold_basis_points: 7_500,
            }],
            programs: vec![ProgramDescriptor {
                technique: TechniqueId(7),
                variant: 2,
                id: ProgramId(1),
                capability_set: CAPABILITY,
                resource_kind_mask: 1 << 1,
                semantic_view_mask: 0,
                storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
                draw_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | BATCH_ORDER
                    | crate::engine::policy::BATCH_TRANSFORM,
                allocation_strategy: ALLOCATION_ORDERED_DIRECT,
                f32_input_count: 4,
                u32_input_count: 4,
                inputs: vec![
                    InputSource::semantic(0),
                    InputSource {
                        scope: InputScope::Glyph,
                        field: 0,
                    },
                    InputSource {
                        scope: InputScope::Strike,
                        field: 0,
                    },
                    InputSource {
                        scope: InputScope::Resource,
                        field: 0,
                    },
                    InputSource::semantic(0),
                    InputSource {
                        scope: InputScope::Glyph,
                        field: 0,
                    },
                    InputSource {
                        scope: InputScope::Strike,
                        field: 0,
                    },
                    InputSource {
                        scope: InputScope::Resource,
                        field: 0,
                    },
                ],
                capabilities: ProgramCapabilities::default(),
                buffers: vec![BufferSchema {
                    id: BufferId(1),
                    scalar: ScalarType::F32,
                    vector_width: 1,
                    alignment: 4,
                    stride: 4,
                    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    capacity_class: 1,
                }],
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
        .unwrap()
    }
}
