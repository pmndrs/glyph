//! Per-line ink, measured by positioning with the placement measurement would apply.
//!
//! A glyph's ink box is its run-local row placed by its segment's published f32 translation,
//! exactly as `PositionedSemanticGlyph::placed` does it; a line's ink is the union of its
//! glyphs' boxes, including island, ellipsis and drop-cap glyphs, which reach the line through
//! its occurrence spans like every other glyph. `measure()` then unions lines, not glyphs.
//!
//! The union is compare-select (`f64::min/max` cost 3.3x in wasm) and its result must not
//! depend on the order glyphs are visited in, so two inputs are kept out of it:
//!
//! - **Signed zero.** A placed start is `-0.0` only when both the row and the translation are
//!   `-0.0`: an f32 sum is otherwise `+0.0` or nonzero. A line with a segment whose published
//!   translation is `-0.0` on either axis is therefore left unmeasured; with no `-0.0`
//!   candidate, equal candidates are bit-equal and every order selects the same bits.
//! - **Non-finite placements.** Measurement rejects them per glyph; a line holding one is left
//!   unmeasured so that rejection still happens where it did.
//!
//! An unmeasured line makes `line_ink` answer `None`, and measurement walks glyphs as before.

use super::{
    ClusterArena, GlyphSource, LineInk, LineInkState, OccurrenceSpan, PositionedGlyphArena,
};
use crate::engine::shaping_state::BoundaryShapeArena;

const NEGATIVE_ZERO: u32 = 0x8000_0000;

impl PositionedGlyphArena {
    /// Measures the line whose spans start at `span_start` and closes its ink lanes.
    pub(super) fn push_line_ink(
        &mut self,
        span_start: usize,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
    ) {
        let (ink, missing) = line_ink(
            self,
            self.occurrence_spans.get(span_start..).unwrap_or(&[]),
            clusters,
            boundary,
        );
        self.line_ink_complete &= ink.state != LineInkState::Unmeasured;
        self.line_ink.push(ink);
        self.line_missing_glyphs.push(missing);
    }
}

fn line_ink(
    positioned: &PositionedGlyphArena,
    spans: &[OccurrenceSpan],
    clusters: &ClusterArena,
    boundary: &BoundaryShapeArena,
) -> (LineInk, u32) {
    let translations = positioned.placement.translations();
    let mut inline_min = f64::INFINITY;
    let mut block_min = f64::INFINITY;
    let mut inline_max = f64::NEG_INFINITY;
    let mut block_max = f64::NEG_INFINITY;
    // Zero while every placed origin is finite: `x * 0.0` is NaN for an infinity or a NaN.
    let mut residue = 0.0_f32;
    let mut glyphs = 0_usize;
    let mut missing = 0_u32;
    let mut measured = true;
    for span in spans {
        let (lanes, glyph_ids) = match span.source {
            GlyphSource::LayoutRun => (clusters.run_local().lanes(), clusters.glyph_ids.as_slice()),
            GlyphSource::Boundary => (
                positioned.replacement_run_local.lanes(),
                boundary.shape.glyph_ids.as_slice(),
            ),
        };
        let start = span.source_glyph_start as usize;
        let range = start..start + span.source_glyph_count as usize;
        let (
            Some(translation),
            Some(glyph_ids),
            Some(inline_origin),
            Some(block_origin),
            Some(ink_inline_start),
            Some(ink_block_start),
            Some(ink_inline_extent),
            Some(ink_block_extent),
        ) = (
            translations.get(span.placement_segment as usize),
            glyph_ids.get(range.clone()),
            lanes.inline_origin.get(range.clone()),
            lanes.block_origin.get(range.clone()),
            lanes.ink_inline_start.get(range.clone()),
            lanes.ink_block_start.get(range.clone()),
            lanes.ink_inline_extent.get(range.clone()),
            lanes.ink_block_extent.get(range),
        )
        else {
            measured = false;
            continue;
        };
        missing += glyph_ids.iter().filter(|glyph| **glyph == 0).count() as u32;
        let inline = translation.translation_inline as f32;
        let block = translation.translation_block as f32;
        measured &= inline.to_bits() != NEGATIVE_ZERO && block.to_bits() != NEGATIVE_ZERO;
        glyphs += glyph_ids.len();
        // Lanes are finite and so is the translation, so a placed value is non-finite only as
        // an infinity. An infinite ink start shows in the corner it reaches; a placed origin
        // is not part of the box and is tested by its residue.
        for ((origin, start), extent) in inline_origin
            .iter()
            .zip(ink_inline_start)
            .zip(ink_inline_extent)
        {
            let origin = origin + inline;
            residue += origin * 0.0;
            let min = f64::from(start + inline);
            let max = min + f64::from(*extent);
            inline_min = if min < inline_min { min } else { inline_min };
            inline_max = if max > inline_max { max } else { inline_max };
        }
        for ((origin, start), extent) in block_origin
            .iter()
            .zip(ink_block_start)
            .zip(ink_block_extent)
        {
            let origin = origin + block;
            residue += origin * 0.0;
            let min = f64::from(start + block);
            let max = min + f64::from(*extent);
            block_min = if min < block_min { min } else { block_min };
            block_max = if max > block_max { max } else { block_max };
        }
    }
    measured &= glyphs == 0
        || (inline_min.is_finite()
            && inline_max.is_finite()
            && block_min.is_finite()
            && block_max.is_finite());
    #[cfg(test)]
    crate::engine::work_attribution::record(|work| work.measurement_ink_glyph_visits += glyphs);
    let state = if !measured || residue != 0.0 || residue.is_nan() {
        LineInkState::Unmeasured
    } else if glyphs == 0 {
        LineInkState::Empty
    } else {
        LineInkState::Joined
    };
    let ink = if state == LineInkState::Joined {
        LineInk {
            inline_min,
            block_min,
            inline_max,
            block_max,
            state,
        }
    } else {
        LineInk {
            state,
            ..LineInk::default()
        }
    };
    (ink, missing)
}
