//! Policy-directed gather from semantic layout and normalized font bindings.

use alloc::vec::Vec;

use super::{
    font_binding::{FontRenderBinding, SelectedGlyphBinding},
    frame::{
        SEMANTIC_F32_BLOCK_ORIGIN, SEMANTIC_F32_FOREGROUND_ALPHA, SEMANTIC_F32_FOREGROUND_BLUE,
        SEMANTIC_F32_FOREGROUND_GREEN, SEMANTIC_F32_FOREGROUND_RED, SEMANTIC_F32_INLINE_ORIGIN,
        SEMANTIC_F32_INVERSE_FONT_SIZE, SEMANTIC_U32_CLUSTER_ID, SEMANTIC_U32_FOREGROUND_RGBA,
    },
    plan_input::{PlanGlyph, PlanInput},
    policy::{CapabilitySetId, InputScope, MAX_REGISTERS, ProgramDescriptor, ValidatedPolicy},
    positioning::SemanticGlyph,
};

// `fontSize` and `rasterPixelRatio` can select a different baked resource.
// A replacement batch must therefore receive every input stream once even when
// the policy dependency mask would omit unchanged fields from an in-place patch.
const RESOURCE_SELECTION_CHANGES: u16 = (1 << 4) | (1 << 5);

// Exact Float32 results of the IEC 61966-2-1 sRGB transfer for every byte value.
// Foreground colors stay one compact u32 per glyph while policy output reproduces
// the renderer's prior linear Float32 instance records without a hot-path powf.
const SRGB8_TO_LINEAR_BITS: [u32; 256] = [
    0x00000000, 0x399f22b4, 0x3a1f22b4, 0x3a6eb40e, 0x3a9f22b4, 0x3ac6eb61, 0x3aeeb40e, 0x3b0b3e5d,
    0x3b1f22b4, 0x3b33070a, 0x3b46eb61, 0x3b5b518e, 0x3b70f18f, 0x3b83e1c6, 0x3b8fe616, 0x3b9c87fd,
    0x3ba9c9b6, 0x3bb7ad6f, 0x3bc6354a, 0x3bd56360, 0x3be539c1, 0x3bf5ba71, 0x3c0373b6, 0x3c0c6153,
    0x3c15a705, 0x3c1f45be, 0x3c293e6b, 0x3c3391f7, 0x3c3e4149, 0x3c494d44, 0x3c54b6c9, 0x3c607eb4,
    0x3c6ca5df, 0x3c792d22, 0x3c830aa9, 0x3c89af9f, 0x3c9085dc, 0x3c978dc6, 0x3c9ec7c2, 0x3ca63433,
    0x3cadd37d, 0x3cb5a602, 0x3cbdac21, 0x3cc5e63a, 0x3cce54ac, 0x3cd6f7d5, 0x3cdfd010, 0x3ce8ddba,
    0x3cf2212d, 0x3cfb9ac3, 0x3d02a56a, 0x3d0798dd, 0x3d0ca7e6, 0x3d11d2af, 0x3d171964, 0x3d1c7c30,
    0x3d21fb3c, 0x3d2796b2, 0x3d2d4ebb, 0x3d332381, 0x3d39152b, 0x3d3f23e4, 0x3d454fd2, 0x3d4b991d,
    0x3d51ffec, 0x3d588468, 0x3d5f26b6, 0x3d65e6fd, 0x3d6cc563, 0x3d73c20e, 0x3d7add24, 0x3d810b65,
    0x3d84b793, 0x3d88732e, 0x3d8c3e48, 0x3d9018f4, 0x3d940344, 0x3d97fd49, 0x3d9c0715, 0x3da020ba,
    0x3da44a4a, 0x3da883d6, 0x3daccd6f, 0x3db12727, 0x3db5910f, 0x3dba0b38, 0x3dbe95b3, 0x3dc33090,
    0x3dc7dbe0, 0x3dcc97b4, 0x3dd1641d, 0x3dd6412b, 0x3ddb2eee, 0x3de02d76, 0x3de53cd4, 0x3dea5d18,
    0x3def8e51, 0x3df4d090, 0x3dfa23e5, 0x3dff885e, 0x3e027f06, 0x3e05427f, 0x3e080ea2, 0x3e0ae377,
    0x3e0dc104, 0x3e10a753, 0x3e13966a, 0x3e168e51, 0x3e198f0f, 0x3e1c98ac, 0x3e1fab30, 0x3e22c6a1,
    0x3e25eb07, 0x3e29186a, 0x3e2c4ed0, 0x3e2f8e42, 0x3e32d6c5, 0x3e362862, 0x3e39831f, 0x3e3ce703,
    0x3e405417, 0x3e43ca60, 0x3e4749e6, 0x3e4ad2af, 0x3e4e64c3, 0x3e520029, 0x3e55a4e7, 0x3e595305,
    0x3e5d0a89, 0x3e60cb7a, 0x3e6495df, 0x3e6869be, 0x3e6c471f, 0x3e702e07, 0x3e741e7e, 0x3e78188b,
    0x3e7c1c33, 0x3e8014bf, 0x3e822039, 0x3e84308b, 0x3e8645b8, 0x3e885fc3, 0x3e8a7eb0, 0x3e8ca281,
    0x3e8ecb3b, 0x3e90f8df, 0x3e932b72, 0x3e9562f6, 0x3e979f6f, 0x3e99e0e0, 0x3e9c274c, 0x3e9e72b6,
    0x3ea0c321, 0x3ea31890, 0x3ea57307, 0x3ea7d288, 0x3eaa3716, 0x3eaca0b6, 0x3eaf0f68, 0x3eb18332,
    0x3eb3fc15, 0x3eb67a14, 0x3eb8fd34, 0x3ebb8576, 0x3ebe12de, 0x3ec0a56e, 0x3ec33d2a, 0x3ec5da14,
    0x3ec87c30, 0x3ecb2380, 0x3ecdd008, 0x3ed081ca, 0x3ed338c9, 0x3ed5f508, 0x3ed8b68a, 0x3edb7d52,
    0x3ede4963, 0x3ee11abf, 0x3ee3f169, 0x3ee6cd65, 0x3ee9aeb5, 0x3eec955b, 0x3eef815c, 0x3ef272b8,
    0x3ef56974, 0x3ef86593, 0x3efb6716, 0x3efe6e00, 0x3f00bd2b, 0x3f02460c, 0x3f03d1a5, 0x3f055ff7,
    0x3f06f104, 0x3f0884cd, 0x3f0a1b54, 0x3f0bb499, 0x3f0d509f, 0x3f0eef65, 0x3f1090ef, 0x3f12353d,
    0x3f13dc50, 0x3f15862a, 0x3f1732cc, 0x3f18e237, 0x3f1a946e, 0x3f1c4970, 0x3f1e0140, 0x3f1fbbde,
    0x3f21794d, 0x3f23398c, 0x3f24fc9f, 0x3f26c285, 0x3f288b41, 0x3f2a56d2, 0x3f2c253c, 0x3f2df67f,
    0x3f2fca9c, 0x3f31a194, 0x3f337b6a, 0x3f35581d, 0x3f3737b0, 0x3f391a24, 0x3f3aff7a, 0x3f3ce7b2,
    0x3f3ed2cf, 0x3f40c0d2, 0x3f42b1bc, 0x3f44a58e, 0x3f469c49, 0x3f4895ef, 0x3f4a9280, 0x3f4c91ff,
    0x3f4e946c, 0x3f5099c9, 0x3f52a216, 0x3f54ad56, 0x3f56bb88, 0x3f58ccaf, 0x3f5ae0cc, 0x3f5cf7df,
    0x3f5f11ea, 0x3f612eef, 0x3f634eee, 0x3f6571e9, 0x3f6797e0, 0x3f69c0d5, 0x3f6becca, 0x3f6e1bbf,
    0x3f704db5, 0x3f7282ae, 0x3f74baab, 0x3f76f5ae, 0x3f7933b6, 0x3f7b74c6, 0x3f7db8de, 0x3f800000,
];

pub const DEFAULT_GATHER_RECORD_CAPACITY: usize = 32_768;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutGlyph {
    pub stable_id: u32,
    pub content_revision: u32,
    pub semantic_glyph_index: u32,
    pub binding_handle: u32,
    pub font_handle: u32,
    pub glyph_id: u32,
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
    pub(crate) semantic_glyphs: &'a [SemanticGlyph],
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetainedGather {
    Complete,
    RebuildFrom(usize),
}

/// Decoration rows use the top identity bit; session glyph identities stay below it.
pub const DECORATION_STABLE_ID_BASE: u32 = 0x8000_0000;

/// CSS paint order for decoration appends: underline and overline draw under the text,
/// line-through draws over it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecorationPass {
    Under,
    Over,
}

impl DecorationPass {
    fn admits(self, flags: u32) -> bool {
        let over = flags & super::frame::DECORATION_LINE_THROUGH != 0;
        match self {
            Self::Under => !over,
            Self::Over => over,
        }
    }
}

#[derive(Default)]
pub struct PolicyGatherWorkspace {
    glyphs: Vec<PlanGlyph>,
    source_selected: Vec<u8>,
    semantic_change_masks: Vec<u16>,
    f32_fields: Vec<AlignedField<f32>>,
    u32_fields: Vec<AlignedField<u32>>,
    retained_cursor: usize,
    retained_source_cursor: usize,
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
        reserve(&mut self.source_selected, record_capacity)?;
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

    pub fn begin_retained(
        &mut self,
        policy: &ValidatedPolicy,
        record_capacity: usize,
    ) -> Result<bool, GatherError> {
        self.reserve_policy(policy, record_capacity)?;
        self.retained_cursor = 0;
        self.retained_source_cursor = 0;
        let retained_len = self.glyphs.len();
        Ok(self.semantic_change_masks.len() == retained_len
            && self
                .f32_fields
                .iter()
                .all(|field| field.len == retained_len)
            && self
                .u32_fields
                .iter()
                .all(|field| field.len == retained_len))
    }

    pub fn append_retained<'binding>(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<RetainedGather, GatherError> {
        validate_semantic_shape(input)?;
        let mut cursor = self.retained_cursor;
        let mut source_cursor = self.retained_source_cursor;
        let mut cached_font_handle = None;
        let mut cached_binding = None;
        let mut cached_program = None;
        for glyph_index in 0..input.glyphs.len() {
            let glyph = input.glyphs[glyph_index];
            let Some(was_selected) = self.source_selected.get(source_cursor).copied() else {
                self.retained_cursor = cursor;
                self.retained_source_cursor = source_cursor;
                return Ok(RetainedGather::RebuildFrom(glyph_index));
            };
            source_cursor += 1;
            let change_mask = input
                .semantic_change_masks
                .get(glyph_index)
                .copied()
                .unwrap_or(0);
            if change_mask == 0 {
                if was_selected != 0 {
                    let Some(previous) = self.glyphs.get(cursor) else {
                        self.retained_cursor = cursor;
                        self.retained_source_cursor = source_cursor - 1;
                        return Ok(RetainedGather::RebuildFrom(glyph_index));
                    };
                    if previous.stable_id != glyph.stable_id
                        || previous.transform_id != input.transform_id
                    {
                        self.retained_cursor = cursor;
                        self.retained_source_cursor = source_cursor - 1;
                        return Ok(RetainedGather::RebuildFrom(glyph_index));
                    }
                    self.semantic_change_masks[cursor] = 0;
                    cursor += 1;
                }
                continue;
            }
            let binding = if cached_font_handle == Some(glyph.binding_handle) {
                cached_binding.ok_or(GatherError::FontBindingMissing)?
            } else {
                let binding = binding_for_font(glyph.binding_handle)
                    .ok_or(GatherError::FontBindingMissing)?;
                cached_font_handle = Some(glyph.binding_handle);
                cached_binding = Some(binding);
                binding
            };
            let selected =
                binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio);
            if selected.is_some() != (was_selected != 0) {
                self.retained_cursor = cursor;
                self.retained_source_cursor = source_cursor - 1;
                return Ok(RetainedGather::RebuildFrom(glyph_index));
            }
            let Some(selected) = selected else {
                continue;
            };
            let technique = binding.technique();
            let variant = binding.program_variant();
            let program = match cached_program {
                Some((cached_technique, cached_variant, program))
                    if cached_technique == technique && cached_variant == variant =>
                {
                    program
                }
                _ => {
                    let program = policy
                        .program(capability_set, technique, variant)
                        .ok_or(GatherError::ProgramMissing)?;
                    cached_program = Some((technique, variant, program));
                    program
                }
            };
            let next = plan_glyph(input, glyph_index, glyph, binding, selected)?;
            let Some(previous) = self.glyphs.get(cursor).copied() else {
                self.retained_cursor = cursor;
                self.retained_source_cursor = source_cursor - 1;
                return Ok(RetainedGather::RebuildFrom(glyph_index));
            };
            if !same_storage_topology(previous, next) {
                self.retained_cursor = cursor;
                self.retained_source_cursor = source_cursor - 1;
                return Ok(RetainedGather::RebuildFrom(glyph_index));
            }
            let selection_changed = change_mask & RESOURCE_SELECTION_CHANGES != 0;
            let (f32_inputs, u32_inputs) = policy
                .input_masks_for_changes(
                    capability_set,
                    technique,
                    variant,
                    change_mask,
                    selection_changed,
                )
                .ok_or(GatherError::ProgramMissing)?;
            self.update_fields(
                cursor,
                input,
                glyph_index,
                binding,
                selected,
                program,
                f32_inputs,
                u32_inputs,
            )?;
            self.glyphs[cursor] = next;
            self.semantic_change_masks[cursor] = change_mask;
            cursor += 1;
        }
        self.retained_cursor = cursor;
        self.retained_source_cursor = source_cursor;
        Ok(RetainedGather::Complete)
    }

    pub fn finish_retained(&self) -> bool {
        self.retained_cursor == self.glyphs.len()
            && self.retained_source_cursor == self.source_selected.len()
    }

    pub fn truncate_to_retained_prefix(&mut self) {
        self.glyphs.truncate(self.retained_cursor);
        self.source_selected.truncate(self.retained_source_cursor);
        self.semantic_change_masks.truncate(self.retained_cursor);
        for field in &mut self.f32_fields {
            field.truncate(self.retained_cursor);
        }
        for field in &mut self.u32_fields {
            field.truncate(self.retained_cursor);
        }
    }

    pub fn append<'binding>(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        force_all_inputs: bool,
        binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        self.append_from(
            policy,
            capability_set,
            input,
            0,
            force_all_inputs,
            binding_for_font,
        )
    }

    pub fn append_from<'binding>(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        source_start: usize,
        force_all_inputs: bool,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        validate_semantic_shape(input)?;
        let remaining = input.glyphs.len().saturating_sub(source_start);
        if source_start > input.glyphs.len() {
            return Err(GatherError::InvalidSemanticShape);
        }
        let required = self.glyphs.len().saturating_add(remaining);
        let source_required = self.source_selected.len().saturating_add(remaining);
        if self.glyphs.capacity() < required
            || self.source_selected.capacity() < source_required
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
        for glyph_index in source_start..input.glyphs.len() {
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
            let selected =
                binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio);
            self.source_selected.push(u8::from(selected.is_some()));
            let Some(selected) = selected else {
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
            self.glyphs
                .push(plan_glyph(input, glyph_index, glyph, binding, selected)?);
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

    /// Appends resource-free decoration records around glyph gather. Rows carry the
    /// decoration program's technique, a dedicated identity namespace (top bit set), and
    /// a fixed lane convention mirroring the first-party u32 prefix: f32 lanes 0-3 hold
    /// the decoration rectangle; u32 lanes hold transform index, stable identity, color,
    /// then flags with the line style in bits 8-15. `pass` selects CSS paint order:
    /// underline and overline records append before the paragraph's glyphs and
    /// line-through records after, so draw order tokens place them under and over the
    /// text respectively. Returns false when the policy declares no decoration program,
    /// leaving the gather output untouched.
    pub fn append_decorations(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        decorations: &[super::positioning::DecorationRecord],
        transform_id: u32,
        content_revision: u32,
        pass: DecorationPass,
    ) -> Result<bool, GatherError> {
        let Some(program) = policy.decoration_program(capability_set) else {
            return Ok(false);
        };
        let decorations: alloc::vec::Vec<&super::positioning::DecorationRecord> = decorations
            .iter()
            .filter(|record| pass.admits(record.flags))
            .collect();
        if decorations.is_empty() {
            return Ok(true);
        }
        let base = self.glyphs.len();
        reserve(&mut self.glyphs, decorations.len())?;
        reserve(&mut self.semantic_change_masks, decorations.len())?;
        for field in &mut self.f32_fields {
            field
                .reserve(decorations.len())
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        for field in &mut self.u32_fields {
            field
                .reserve(decorations.len())
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        for (ordinal, &record) in decorations.iter().enumerate() {
            let stable_id = DECORATION_STABLE_ID_BASE
                | u32::try_from(base + ordinal).map_err(|_| GatherError::AllocationFailed)?;
            for (index, field) in self.f32_fields.iter_mut().enumerate() {
                let value = match index {
                    0 => record.inline_start,
                    1 => record.block_start,
                    2 => record.inline_extent,
                    3 => record.block_extent,
                    _ => 0.0,
                };
                field.push(value)?;
            }
            for (index, field) in self.u32_fields.iter_mut().enumerate() {
                let value = match index {
                    0 => transform_id,
                    1 => stable_id,
                    2 => record.color,
                    3 => record.flags | (u32::from(record.style) << 8),
                    _ => 0,
                };
                field.push(value)?;
            }
            self.glyphs.push(PlanGlyph {
                stable_id,
                content_revision,
                technique: program.technique,
                program_variant: program.variant,
                resource_id: 0,
                resource_generation: 0,
                resource_kind: 0,
                resource_reference: 0,
                semantic_id: stable_id,
                transform_id,
                material_id: record.color,
                clip_id: record.clip_id,
                depth_key: 0,
                inline_start: record.inline_start,
                block_start: record.block_start,
                inline_extent: record.inline_extent,
                block_extent: record.block_extent,
            });
            self.semantic_change_masks
                .push(super::positioning::ALL_SEMANTIC_CHANGES);
        }
        Ok(true)
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

    #[allow(clippy::too_many_arguments)]
    fn update_fields(
        &mut self,
        output_index: usize,
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
        for field in 0..f32_count {
            if required_f32 & (1 << field) == 0 {
                continue;
            }
            let source = program.inputs[field];
            let value = source_f32(
                source.scope,
                source.field,
                input,
                glyph_index,
                binding,
                selected,
            )?;
            self.f32_fields[field].set(output_index, value)?;
        }
        for field in 0..u32_count {
            if required_u32 & (1 << field) == 0 {
                continue;
            }
            let source = program.inputs[f32_count + field];
            let value = source_u32(
                source.scope,
                source.field,
                input,
                glyph_index,
                binding,
                selected,
            )?;
            self.u32_fields[field].set(output_index, value)?;
        }
        Ok(())
    }

    fn clear(&mut self) {
        self.retained_cursor = 0;
        self.retained_source_cursor = 0;
        self.glyphs.clear();
        self.source_selected.clear();
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

    fn set(&mut self, index: usize, value: T) -> Result<(), GatherError> {
        if index >= self.len {
            return Err(GatherError::InvalidSemanticShape);
        }
        self.blocks[index / 4].values[index % 4] = value;
        Ok(())
    }

    fn truncate(&mut self, len: usize) {
        self.blocks.truncate(len.div_ceil(4));
        self.len = self.len.min(len);
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
        || (!input.semantic_glyphs.is_empty()
            && input.glyphs.iter().any(|glyph| {
                usize::try_from(glyph.semantic_glyph_index)
                    .ok()
                    .and_then(|index| input.semantic_glyphs.get(index))
                    .is_none_or(|semantic| semantic.stable_id != glyph.stable_id)
            }))
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

fn plan_glyph(
    input: LayoutPlanInput<'_>,
    glyph_index: usize,
    glyph: LayoutGlyph,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<PlanGlyph, GatherError> {
    let resource = binding
        .resources()
        .get(usize::try_from(selected.resource).map_err(|_| GatherError::ResourceBindingMissing)?)
        .ok_or(GatherError::ResourceBindingMissing)?;
    let semantic_id = match input
        .semantic_u32
        .get(usize::from(SEMANTIC_U32_CLUSTER_ID))
        .and_then(|values| values.get(glyph_index))
        .copied()
    {
        Some(value) => value,
        None if input.semantic_glyphs.is_empty() => glyph.stable_id,
        None => return Err(GatherError::SourceFieldMissing),
    };
    Ok(PlanGlyph {
        stable_id: glyph.stable_id,
        content_revision: glyph.content_revision,
        technique: binding.technique(),
        program_variant: binding.program_variant(),
        resource_id: resource.id,
        resource_generation: resource.generation,
        resource_kind: resource.kind,
        resource_reference: resource.reference,
        semantic_id,
        transform_id: input.transform_id,
        material_id: glyph.material_id,
        clip_id: glyph.clip_id,
        depth_key: glyph.depth_key,
        inline_start: glyph.inline_start,
        block_start: glyph.block_start,
        inline_extent: glyph.inline_extent,
        block_extent: glyph.block_extent,
    })
}

fn same_storage_topology(previous: PlanGlyph, next: PlanGlyph) -> bool {
    previous.technique == next.technique
        && previous.program_variant == next.program_variant
        && previous.resource_id == next.resource_id
        && previous.resource_generation == next.resource_generation
        && previous.resource_kind == next.resource_kind
        && previous.resource_reference == next.resource_reference
        && previous.transform_id == next.transform_id
        && previous.material_id == next.material_id
        && previous.clip_id == next.clip_id
        && previous.depth_key == next.depth_key
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
    if field == SEMANTIC_F32_INLINE_ORIGIN || field == SEMANTIC_F32_BLOCK_ORIGIN {
        let semantic_index = input
            .glyphs
            .get(glyph_index)
            .and_then(|glyph| usize::try_from(glyph.semantic_glyph_index).ok())
            .ok_or(GatherError::SourceFieldMissing)?;
        let glyph = input
            .semantic_glyphs
            .get(semantic_index)
            .ok_or(GatherError::SourceFieldMissing)?;
        return Ok(Some(if field == SEMANTIC_F32_INLINE_ORIGIN {
            glyph.inline_origin
        } else {
            glyph.block_origin
        }));
    }
    if field == SEMANTIC_F32_INVERSE_FONT_SIZE {
        let font_size = input
            .glyphs
            .get(glyph_index)
            .map(|glyph| glyph.font_size)
            .ok_or(GatherError::SourceFieldMissing)?;
        return Ok(Some(1.0 / font_size));
    }
    let (shift, srgb) = match field {
        SEMANTIC_F32_FOREGROUND_RED => (0, true),
        SEMANTIC_F32_FOREGROUND_GREEN => (8, true),
        SEMANTIC_F32_FOREGROUND_BLUE => (16, true),
        SEMANTIC_F32_FOREGROUND_ALPHA => (24, false),
        _ => return Ok(None),
    };
    let packed = input
        .semantic_u32
        .get(usize::from(SEMANTIC_U32_FOREGROUND_RGBA))
        .and_then(|values| values.get(glyph_index))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)?;
    let channel = (packed >> shift) & 0xff;
    Ok(Some(if srgb {
        f32::from_bits(SRGB8_TO_LINEAR_BITS[channel as usize])
    } else {
        (f64::from(channel) / 255.0) as f32
    }))
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
        let mut glyphs = [layout_glyph(1, 0)];
        glyphs[0].semantic_glyph_index = 1;
        let semantic_glyphs = [
            SemanticGlyph {
                stable_id: 99,
                font_handle: 1,
                cluster: 0,
                glyph_id: 99,
                flags: 0,
                font_size: 16.0,
                inline_origin: 500.0,
                block_origin: 500.0,
            },
            SemanticGlyph {
                stable_id: 1,
                font_handle: 1,
                cluster: 0,
                glyph_id: 1,
                flags: 0,
                font_size: 16.0,
                inline_origin: 12.5,
                block_origin: -3.25,
            },
        ];
        let foreground = [0xff20_4080];
        let input = LayoutPlanInput {
            transform_id: 1,
            glyphs: &glyphs,
            semantic_glyphs: &semantic_glyphs,
            semantic_change_masks: &[],
            semantic_f32: &[],
            semantic_u32: &[&foreground],
        };
        assert_eq!(validate_semantic_shape(input), Ok(()));
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_RED, input, 0),
            Ok(Some(f32::from_bits(SRGB8_TO_LINEAR_BITS[128])))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_GREEN, input, 0),
            Ok(Some(f32::from_bits(SRGB8_TO_LINEAR_BITS[64])))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_BLUE, input, 0),
            Ok(Some(f32::from_bits(SRGB8_TO_LINEAR_BITS[32])))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_FOREGROUND_ALPHA, input, 0),
            Ok(Some(1.0))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_INVERSE_FONT_SIZE, input, 0),
            Ok(Some(1.0 / 16.0))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_INLINE_ORIGIN, input, 0),
            Ok(Some(12.5))
        );
        assert_eq!(
            derived_semantic_f32(SEMANTIC_F32_BLOCK_ORIGIN, input, 0),
            Ok(Some(-3.25))
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
                    semantic_glyphs: &[],
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
    fn retained_gather_updates_changed_fields_and_rejects_storage_topology_changes() {
        let binding = binding();
        let policy = policy();
        let glyphs = [layout_glyph(1, 0), layout_glyph(2, 1)];
        let initial_x = [10.0, 20.0];
        let semantic_kind = [100, 200];
        let mut workspace = PolicyGatherWorkspace::default();
        workspace
            .gather(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &glyphs,
                    semantic_glyphs: &[],
                    semantic_change_masks: &[],
                    semantic_f32: &[&initial_x],
                    semantic_u32: &[&semantic_kind],
                },
                true,
                |_| Some(&binding),
            )
            .unwrap();

        let changed_x = [999.0, 25.0];
        let mut changed_glyphs = glyphs;
        changed_glyphs[1].stable_id = 3;
        changed_glyphs[1].content_revision = 2;
        assert!(workspace.begin_retained(&policy, 2).unwrap());
        assert_eq!(
            workspace
                .append_retained(
                    &policy,
                    CAPABILITY,
                    LayoutPlanInput {
                        transform_id: 1,
                        glyphs: &changed_glyphs,
                        semantic_glyphs: &[],
                        semantic_change_masks: &[0, 1],
                        semantic_f32: &[&changed_x],
                        semantic_u32: &[&semantic_kind],
                    },
                    |_| Some(&binding),
                )
                .unwrap(),
            RetainedGather::Complete
        );
        assert!(workspace.finish_retained());
        let gathered = workspace.view();
        let input = gathered.plan_input();
        assert_eq!(input.glyphs[1].stable_id, 3);
        assert_eq!(input.f32_fields[0], [10.0, 25.0]);
        assert_eq!(input.f32_fields[1], [1.0, 2.0]);

        let mut changed_topology = changed_glyphs;
        changed_topology[1].material_id = 7;
        assert!(workspace.begin_retained(&policy, 2).unwrap());
        assert_eq!(
            workspace
                .append_retained(
                    &policy,
                    CAPABILITY,
                    LayoutPlanInput {
                        transform_id: 1,
                        glyphs: &changed_topology,
                        semantic_glyphs: &[],
                        semantic_change_masks: &[
                            0,
                            super::super::positioning::ALL_SEMANTIC_CHANGES
                        ],
                        semantic_f32: &[&changed_x],
                        semantic_u32: &[&semantic_kind],
                    },
                    |_| Some(&binding),
                )
                .unwrap(),
            RetainedGather::RebuildFrom(1)
        );
        workspace.truncate_to_retained_prefix();
        workspace
            .append_from(
                &policy,
                CAPABILITY,
                LayoutPlanInput {
                    transform_id: 1,
                    glyphs: &changed_topology,
                    semantic_glyphs: &[],
                    semantic_change_masks: &[0, crate::engine::positioning::ALL_SEMANTIC_CHANGES],
                    semantic_f32: &[&changed_x],
                    semantic_u32: &[&semantic_kind],
                },
                1,
                true,
                |_| Some(&binding),
            )
            .unwrap();
        let gathered = workspace.view();
        let input = gathered.plan_input();
        assert_eq!(input.glyphs.len(), 2);
        assert_eq!(input.glyphs[1].material_id, 7);
        assert_eq!(input.f32_fields[0], [10.0, 25.0]);
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
                semantic_glyphs: &[],
                semantic_change_masks: &[],
                semantic_f32: &[&first_x],
                semantic_u32: &[&first_kind],
            },
            LayoutPlanInput {
                transform_id: 2,
                glyphs: &second,
                semantic_glyphs: &[],
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
                    semantic_glyphs: &[],
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
                    semantic_glyphs: &[],
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
                    semantic_glyphs: &[],
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
                    semantic_glyphs: &[],
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
                    semantic_glyphs: &[],
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
            semantic_glyph_index: glyph_id,
            binding_handle: 9,
            font_handle: 9,
            glyph_id,
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
        ValidatedPolicy::new(base_descriptor()).unwrap()
    }

    fn policy_with_decorations() -> ValidatedPolicy {
        let mut descriptor = base_descriptor();
        let mut program = descriptor.programs[0].clone();
        program.primitive_kind = 2;
        program.technique = TechniqueId(99);
        program.variant = 0;
        program.id = ProgramId(9);
        program.resource_kind_mask = 0;
        program.buffers[0].id = BufferId(9);
        for operation in &mut program.operations {
            if let Operation::StoreF32 { buffer, .. } = operation {
                *buffer = BufferId(9);
            }
        }
        descriptor.programs.push(program);
        ValidatedPolicy::new(descriptor).unwrap()
    }

    #[test]
    fn append_decorations_appends_resource_free_rows_with_lane_convention() {
        let record = crate::engine::positioning::DecorationRecord {
            flags: 1,
            style: 3,
            color: 0xff00_00ff,
            inline_start: 4.0,
            inline_extent: 12.0,
            block_start: 9.0,
            block_extent: 0.5,
            clip_id: 9,
            region_id: 9,
            flow_thread_id: 7,
            transform_index: 9,
        };
        let decorated = policy_with_decorations();
        let mut workspace = PolicyGatherWorkspace::default();
        workspace.begin(&decorated, 4).unwrap();
        assert!(
            workspace
                .append_decorations(
                    &decorated,
                    CAPABILITY,
                    &[record],
                    3,
                    5,
                    DecorationPass::Under
                )
                .unwrap()
        );
        let view = workspace.view();
        assert_eq!(view.glyphs.len(), 1);
        let row = view.glyphs[0];
        assert_eq!(row.stable_id, DECORATION_STABLE_ID_BASE);
        assert_eq!(row.technique, TechniqueId(99));
        assert_eq!(row.content_revision, 5);
        assert_eq!(row.transform_id, 3);
        assert_eq!(row.resource_id, 0);
        assert_eq!(row.resource_generation, 0);
        assert_eq!(row.resource_kind, 0);
        assert_eq!(row.clip_id, 9);
        assert_eq!(view.f32_fields[0][0], 4.0);
        assert_eq!(view.f32_fields[1][0], 9.0);
        assert_eq!(view.f32_fields[2][0], 12.0);
        assert_eq!(view.f32_fields[3][0], 0.5);
        assert_eq!(view.u32_fields[0][0], 3);
        assert_eq!(view.u32_fields[1][0], DECORATION_STABLE_ID_BASE);
        assert_eq!(view.u32_fields[2][0], 0xff00_00ff);
        assert_eq!(view.u32_fields[3][0], 1 | (3 << 8));
        // The under pass rejects line-through records and the over pass accepts them.
        let mut line_through = record;
        line_through.flags = crate::engine::frame::DECORATION_LINE_THROUGH;
        assert!(
            workspace
                .append_decorations(
                    &decorated,
                    CAPABILITY,
                    &[line_through],
                    3,
                    5,
                    DecorationPass::Under
                )
                .unwrap()
        );
        assert_eq!(workspace.view().glyphs.len(), 1);
        assert!(
            workspace
                .append_decorations(
                    &decorated,
                    CAPABILITY,
                    &[line_through],
                    3,
                    5,
                    DecorationPass::Over
                )
                .unwrap()
        );
        assert_eq!(workspace.view().glyphs.len(), 2);

        let plain = policy();
        let mut plain_workspace = PolicyGatherWorkspace::default();
        plain_workspace.begin(&plain, 4).unwrap();
        assert!(
            !plain_workspace
                .append_decorations(&plain, CAPABILITY, &[record], 3, 5, DecorationPass::Under)
                .unwrap()
        );
        assert_eq!(plain_workspace.view().glyphs.len(), 0);
    }

    fn base_descriptor() -> PolicyDescriptor {
        PolicyDescriptor {
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
                primitive_kind: 1,
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
        }
    }
}
