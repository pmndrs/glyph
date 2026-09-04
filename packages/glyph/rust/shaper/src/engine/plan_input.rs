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

pub fn span_bounds(glyphs: &[PlanGlyph]) -> Result<(f32, f32, f32, f32), PlanInputError> {
    let first = glyphs.first().ok_or(PlanInputError::InvalidShape)?;
    let mut inline_start = first.inline_start;
    let mut block_start = first.block_start;
    let mut inline_end = first.inline_start + first.inline_extent;
    let mut block_end = first.block_start + first.block_extent;
    for glyph in &glyphs[1..] {
        inline_start = inline_start.min(glyph.inline_start);
        block_start = block_start.min(glyph.block_start);
        inline_end = inline_end.max(glyph.inline_start + glyph.inline_extent);
        block_end = block_end.max(glyph.block_start + glyph.block_extent);
    }
    let inline_extent = inline_end - inline_start;
    let block_extent = block_end - block_start;
    if !inline_extent.is_finite() || !block_extent.is_finite() {
        return Err(PlanInputError::InvalidShape);
    }
    Ok((inline_start, block_start, inline_extent, block_extent))
}

pub fn indexed_span_bounds(
    glyphs: &[PlanGlyph],
    mut indices: impl Iterator<Item = usize>,
) -> Result<(f32, f32, f32, f32), PlanInputError> {
    let first = glyphs
        .get(indices.next().ok_or(PlanInputError::InvalidShape)?)
        .ok_or(PlanInputError::InvalidShape)?;
    let mut inline_start = first.inline_start;
    let mut block_start = first.block_start;
    let mut inline_end = first.inline_start + first.inline_extent;
    let mut block_end = first.block_start + first.block_extent;
    for index in indices {
        let glyph = glyphs.get(index).ok_or(PlanInputError::InvalidShape)?;
        inline_start = inline_start.min(glyph.inline_start);
        block_start = block_start.min(glyph.block_start);
        inline_end = inline_end.max(glyph.inline_start + glyph.inline_extent);
        block_end = block_end.max(glyph.block_start + glyph.block_extent);
    }
    let inline_extent = inline_end - inline_start;
    let block_extent = block_end - block_start;
    if !inline_extent.is_finite() || !block_extent.is_finite() {
        return Err(PlanInputError::InvalidShape);
    }
    Ok((inline_start, block_start, inline_extent, block_extent))
}

pub fn draw_fields_compatible(
    first: PlanGlyph,
    next: PlanGlyph,
    split_material: bool,
    split_transform: bool,
) -> bool {
    (!split_material || next.material_id == first.material_id)
        && next.clip_id == first.clip_id
        && next.depth_key == first.depth_key
        && (!split_transform || next.transform_id == first.transform_id)
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
