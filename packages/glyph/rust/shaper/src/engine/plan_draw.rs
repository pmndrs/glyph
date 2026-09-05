//! Shared glyph primitive and draw-record emission.

use alloc::vec::Vec;

use super::{
    plan_input::PlanGlyph,
    render_plan::{DrawRecord, PRIMITIVE_DECORATION, PrimitiveRecord},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanDrawError {
    AllocationFailed,
    ArithmeticOverflow,
}

/// Stable sort key for display-list draws whose caller permits independent compositing.
/// Paint layer is the primary key; encounter order remains deterministic within a layer.
#[inline]
pub fn independent_draw_sort_key(draw: &DrawRecord) -> u64 {
    // The batch segment is planner-private and must never order draws: it says what may merge,
    // not what draws first. Sorting the raw key would let a segmentation decision reorder the
    // page, so the paint layer is masked out of it here.
    (u64::from(super::codec_gather::depth_key_paint(draw.depth_key)) << 32)
        | u64::from(draw.order_token)
}

#[derive(Clone, Copy)]
pub struct GlyphDraw {
    pub glyph: PlanGlyph,
    pub primitive_kind: u16,
    pub program_id: u32,
    pub record_count: u16,
    pub buffer_id: u32,
    pub record_index: u32,
    pub logical_order: usize,
    pub semantic_id: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
    pub material_id: u32,
    pub transform_id: u32,
    pub buffer_start: u32,
    pub buffer_count: u32,
    pub resource_start: usize,
    pub indirect: bool,
}

/// This deliberately remains one out-of-line implementation. Both storage planners emit the
/// same command records after resolving their different physical address spaces.
#[inline(never)]
pub fn push_glyph_draw(
    primitives: &mut Vec<PrimitiveRecord>,
    draws: &mut Vec<DrawRecord>,
    emission: GlyphDraw,
) -> Result<(), PlanDrawError> {
    let primitive_start =
        u32::try_from(primitives.len()).map_err(|_| PlanDrawError::ArithmeticOverflow)?;
    let logical_order =
        u32::try_from(emission.logical_order).map_err(|_| PlanDrawError::ArithmeticOverflow)?;
    let resource_start =
        u32::try_from(emission.resource_start).map_err(|_| PlanDrawError::ArithmeticOverflow)?;
    let indirect_offset = if emission.indirect {
        emission
            .record_index
            .checked_mul(4)
            .ok_or(PlanDrawError::ArithmeticOverflow)?
    } else {
        0
    };

    primitives
        .try_reserve(1)
        .map_err(|_| PlanDrawError::AllocationFailed)?;
    primitives.push(PrimitiveRecord {
        id: emission.glyph.stable_id,
        kind: emission.primitive_kind,
        technique_id: emission.glyph.technique.0,
        resource_id: emission.glyph.resource_id,
        resource_generation: emission.glyph.resource_generation,
        program_id: emission.program_id,
        program_variant: emission.glyph.program_variant,
        record_count: emission.record_count,
        buffer_id: emission.buffer_id,
        record_index: emission.record_index,
        logical_order,
        clip_id: emission.glyph.clip_id,
        semantic_id: emission.semantic_id,
        inline_start: emission.inline_start,
        block_start: emission.block_start,
        inline_extent: emission.inline_extent,
        block_extent: emission.block_extent,
        ..PrimitiveRecord::default()
    });

    draws
        .try_reserve(1)
        .map_err(|_| PlanDrawError::AllocationFailed)?;
    draws.push(DrawRecord {
        id: emission.glyph.stable_id,
        program_id: emission.program_id,
        program_variant: emission.glyph.program_variant,
        material_id: emission.material_id,
        clip_id: emission.glyph.clip_id,
        depth_key: super::codec_gather::depth_key_paint(emission.glyph.depth_key),
        transform_id: emission.transform_id,
        primitive_start,
        primitive_count: 1,
        buffer_start: emission.buffer_start,
        buffer_count: emission.buffer_count,
        resource_start,
        resource_count: u32::from(emission.primitive_kind != PRIMITIVE_DECORATION),
        order_token: logical_order,
        indirect_buffer_id: if emission.indirect {
            emission.buffer_id
        } else {
            0
        },
        indirect_offset,
        ..DrawRecord::default()
    });
    Ok(())
}
