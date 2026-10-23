//! Allocation-strategy-neutral glyph input for render-plan compilation.

use super::codec::TechniqueId;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlanGlyph {
    pub stable_id: u32,
    pub content_revision: u32,
    pub technique: TechniqueId,
    pub program_variant: u16,
    pub resource_id: u32,
    pub resource_generation: u32,
    pub resource_kind: u16,
    pub resource_reference: u32,
    pub semantic_id: u32,
    pub transform_id: u32,
    pub material_id: u32,
    pub clip_id: u32,
    pub depth_key: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
}

#[derive(Clone, Copy)]
pub struct PlanInput<'a> {
    pub glyphs: &'a [PlanGlyph],
    pub placement_slots: &'a [u32],
    pub semantic_change_masks: &'a [u16],
    pub f32_fields: &'a [&'a [f32]],
    pub u32_fields: &'a [&'a [u32]],
    /// The caller guarantees that reordering compatible draws cannot change compositing.
    pub order_independent: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanInputError {
    InvalidShape,
}

impl PlanInput<'_> {
    pub(crate) fn placement_slot(self, index: usize) -> Result<u32, PlanInputError> {
        self.placement_slots
            .get(index)
            .copied()
            .ok_or(PlanInputError::InvalidShape)
    }
}

pub fn span_bounds(glyphs: &[PlanGlyph]) -> Result<(f32, f32, f32, f32), PlanInputError> {
    let first = glyphs.first().ok_or(PlanInputError::InvalidShape)?;
    let mut summary = DrawSpanSummary::new(*first);
    for glyph in &glyphs[1..] {
        summary.push(*glyph);
    }
    summary.bounds()
}

pub fn indexed_span_bounds(
    glyphs: &[PlanGlyph],
    mut indices: impl Iterator<Item = usize>,
) -> Result<(f32, f32, f32, f32), PlanInputError> {
    let first = glyphs
        .get(indices.next().ok_or(PlanInputError::InvalidShape)?)
        .ok_or(PlanInputError::InvalidShape)?;
    let mut summary = DrawSpanSummary::new(*first);
    for index in indices {
        let glyph = glyphs.get(index).ok_or(PlanInputError::InvalidShape)?;
        summary.push(*glyph);
    }
    summary.bounds()
}

#[derive(Clone, Copy)]
pub(crate) struct DrawSpanSummary {
    inline_start: f32,
    block_start: f32,
    inline_end: f32,
    block_end: f32,
    pub(crate) semantic_id: u32,
    zero_signs: [u8; 4],
    nonfinite: bool,
}

impl DrawSpanSummary {
    pub(crate) fn new(first: PlanGlyph) -> Self {
        let inline_end = first.inline_start + first.inline_extent;
        let block_end = first.block_start + first.block_extent;
        let values = [first.inline_start, first.block_start, inline_end, block_end];
        Self {
            inline_start: values[0],
            block_start: values[1],
            inline_end: values[2],
            block_end: values[3],
            semantic_id: first.semantic_id,
            zero_signs: values.map(zero_sign),
            nonfinite: values.iter().any(|value| !value.is_finite()),
        }
    }

    pub(crate) fn push(&mut self, glyph: PlanGlyph) {
        let inline_end = glyph.inline_start + glyph.inline_extent;
        let block_end = glyph.block_start + glyph.block_extent;
        let values = [glyph.inline_start, glyph.block_start, inline_end, block_end];
        self.inline_start = self.inline_start.min(values[0]);
        self.block_start = self.block_start.min(values[1]);
        self.inline_end = self.inline_end.max(values[2]);
        self.block_end = self.block_end.max(values[3]);
        if glyph.semantic_id != self.semantic_id {
            self.semantic_id = 0;
        }
        for (mask, value) in self.zero_signs.iter_mut().zip(values) {
            *mask |= zero_sign(value);
            self.nonfinite |= !value.is_finite();
        }
    }

    pub(crate) fn combine(&mut self, next: Self) {
        self.inline_start = self.inline_start.min(next.inline_start);
        self.block_start = self.block_start.min(next.block_start);
        self.inline_end = self.inline_end.max(next.inline_end);
        self.block_end = self.block_end.max(next.block_end);
        if self.semantic_id != next.semantic_id {
            self.semantic_id = 0;
        }
        for (mask, next_mask) in self.zero_signs.iter_mut().zip(next.zero_signs) {
            *mask |= next_mask;
        }
        self.nonfinite |= next.nonfinite;
    }

    /// Regrouping is bit-exact only if every final zero extremum has one sign.
    pub(crate) fn needs_sequential_replay(&self) -> bool {
        self.nonfinite
            || [
                self.inline_start,
                self.block_start,
                self.inline_end,
                self.block_end,
            ]
            .iter()
            .zip(self.zero_signs)
            .any(|(value, mask)| *value == 0.0 && mask == 3)
    }

    pub(crate) fn bounds(&self) -> Result<(f32, f32, f32, f32), PlanInputError> {
        let inline_extent = self.inline_end - self.inline_start;
        let block_extent = self.block_end - self.block_start;
        if !inline_extent.is_finite() || !block_extent.is_finite() {
            return Err(PlanInputError::InvalidShape);
        }
        Ok((
            self.inline_start,
            self.block_start,
            inline_extent,
            block_extent,
        ))
    }
}

fn zero_sign(value: f32) -> u8 {
    if value == 0.0 {
        if value.is_sign_negative() { 2 } else { 1 }
    } else {
        0
    }
}

#[derive(Clone, Copy)]
pub(crate) struct DrawFields {
    material_id: u32,
    transform_id: u32,
    clip_id: u32,
    depth_key: u32,
}

impl From<PlanGlyph> for DrawFields {
    fn from(glyph: PlanGlyph) -> Self {
        Self {
            material_id: glyph.material_id,
            transform_id: glyph.transform_id,
            clip_id: glyph.clip_id,
            depth_key: glyph.depth_key,
        }
    }
}

impl DrawFields {
    pub(crate) fn matches(
        self,
        glyph: PlanGlyph,
        split_material: bool,
        split_transform: bool,
    ) -> bool {
        (!split_material || self.material_id == glyph.material_id)
            && (!split_transform || self.transform_id == glyph.transform_id)
            && self.clip_id == glyph.clip_id
            && self.depth_key == glyph.depth_key
    }
}

pub fn draw_fields_compatible(
    first: PlanGlyph,
    next: PlanGlyph,
    split_material: bool,
    split_transform: bool,
) -> bool {
    DrawFields::from(first).matches(next, split_material, split_transform)
}

/// Tests the shared logical and renderer-key invariants for extending a physical draw span.
///
/// Storage planners resolve batch membership and physical contiguity differently, so those two
/// facts remain caller-owned. This stays inline because it runs once per candidate glyph.
#[inline(always)]
pub fn draw_span_compatible(
    first: PlanGlyph,
    next: PlanGlyph,
    same_batch: bool,
    contiguous: bool,
    split_material: bool,
    split_transform: bool,
) -> bool {
    same_batch
        && contiguous
        && next.technique == first.technique
        && next.program_variant == first.program_variant
        && next.resource_id == first.resource_id
        && next.resource_generation == first.resource_generation
        && draw_fields_compatible(first, next, split_material, split_transform)
}
