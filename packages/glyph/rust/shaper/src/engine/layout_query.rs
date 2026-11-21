//! Demand-shaped semantic layout views.
//!
//! These records share the immutable frame publication for lifetime and transport only. They are
//! not render-plan commands and render executors must not consume them.

use alloc::vec::Vec;
use core::iter::{Copied, Enumerate};

use super::{
    EngineError,
    cluster_state::ClusterArena,
    flow_composition::{FlowDropCap, FlowFragment, FlowLayoutArena, FlowLine},
    flow_geometry::FlowGeometryArena,
    frame::{AXIS_AT_MOST, AXIS_EXACT, AXIS_UNCONSTRAINED},
    placement_state::SegmentTranslation,
    positioning::{
        LineInk, LineInkState, PositionedSemanticGlyph, ThreadTypography, constraint_typography,
        positioned_fragment_advance,
    },
    retained_rope::{RopeCursor, RopeCursorRange, RopeIter},
    semantic_view::{
        SEMANTIC_GLYPH, SEMANTIC_LINE, SEMANTIC_PARAGRAPH_MEASUREMENT, SemanticRecord,
    },
};

pub(crate) const MEASUREMENT_FLAG_OVERFLOWED: u16 = 1;
/// The measurement's ink box was derived from positioned glyphs and is authoritative. Clear means
/// this query did not position glyphs, so the ink box is absent rather than empty — a paragraph
/// that positioned zero glyphs still sets the bit and reports a degenerate box.
pub(crate) const MEASUREMENT_FLAG_INK_BOUNDS: u16 = 2;

/// Union of glyph ink boxes in positioned space.
///
/// `joined` is what separates "no glyph contributed" from "every glyph was degenerate": the first
/// keeps the box absent, the second reports a real zero-extent box. Collapsing them would publish a
/// box at the origin for a paragraph whose ink was never measured.
#[derive(Clone, Copy, Default)]
struct InkBounds {
    inline_min: f64,
    block_min: f64,
    inline_max: f64,
    block_max: f64,
    joined: bool,
}

impl InkBounds {
    fn join_glyph(
        &mut self,
        glyph: PositionedSemanticGlyph,
        translation: SegmentTranslation,
    ) -> Result<(), EngineError> {
        let glyph = glyph.placed(translation)?;
        #[cfg(test)]
        super::work_attribution::record(|work| work.measurement_ink_glyph_visits += 1);
        let inline_min = f64::from(glyph.ink_inline_start);
        let block_min = f64::from(glyph.ink_block_start);
        let inline_max = inline_min + f64::from(glyph.ink_inline_extent);
        let block_max = block_min + f64::from(glyph.ink_block_extent);
        if self.joined {
            self.inline_min = self.inline_min.min(inline_min);
            self.block_min = self.block_min.min(block_min);
            self.inline_max = self.inline_max.max(inline_max);
            self.block_max = self.block_max.max(block_max);
        } else {
            self.inline_min = inline_min;
            self.block_min = block_min;
            self.inline_max = inline_max;
            self.block_max = block_max;
            self.joined = true;
        }
        Ok(())
    }

    /// A line's ink as positioning measured it.
    fn from_line(line: LineInk) -> Self {
        Self {
            inline_min: line.inline_min,
            block_min: line.block_min,
            inline_max: line.inline_max,
            block_max: line.block_max,
            joined: line.state == LineInkState::Joined,
        }
    }

    fn join(&mut self, other: Self) {
        if !other.joined {
            return;
        }
        if self.joined {
            self.inline_min = self.inline_min.min(other.inline_min);
            self.block_min = self.block_min.min(other.block_min);
            self.inline_max = self.inline_max.max(other.inline_max);
            self.block_max = self.block_max.max(other.block_max);
        } else {
            *self = other;
        }
    }

    /// Writes the box onto a record. An unjoined box leaves the record's zeroed default in place,
    /// which the reader reads as absent because the record's flag bit stays clear.
    fn write(self, record: &mut SemanticRecord) -> Result<(), EngineError> {
        if !self.joined {
            return Ok(());
        }
        record.ink_inline_start = finite_f32(self.inline_min)?;
        record.ink_block_start = finite_f32(self.block_min)?;
        record.ink_inline_extent = finite_nonnegative_f32(self.inline_max - self.inline_min)?;
        record.ink_block_extent = finite_nonnegative_f32(self.block_max - self.block_min)?;
        Ok(())
    }
}

#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn semantic_line_record(
    paragraph_id: u32,
    index: usize,
    text_start: u32,
    text_end: u32,
    item_start: u32,
    item_count: u32,
    line: FlowLine,
    drop_cap: Option<&FlowDropCap>,
    advance: f64,
    ink: InkBounds,
) -> Result<SemanticRecord, EngineError> {
    let mut record = SemanticRecord {
        id: u32::try_from(index.checked_add(1).ok_or(EngineError::ResultTooLarge)?)
            .map_err(|_| EngineError::ResultTooLarge)?,
        kind: SEMANTIC_LINE,
        flags: u16::from(line.typography.height_fallbacks),
        parent_id: paragraph_id,
        text_start,
        text_end,
        item_start,
        item_count,
        block_start: finite_f32(line.block_start + line.baseline)?,
        inline_extent: finite_nonnegative_f32(advance)?,
        block_extent: finite_nonnegative_f32(line.height)?,
        ascent: finite_nonnegative_f32(line.baseline)?,
        inline_start: finite_nonnegative_f32(line.typography.ascent)?,
        inline_advance: finite_nonnegative_f32(line.typography.descent)?,
        min_content_width: finite_nonnegative_f32(line.typography.cap_height)?,
        max_content_width: finite_nonnegative_f32(line.typography.x_height)?,
        cap_height_top: finite_f32(line.block_start + line.baseline - line.typography.cap_over)?,
        x_height_top: finite_f32(line.block_start + line.baseline - line.typography.x_over)?,
        ..SemanticRecord::default()
    };
    if let Some(cap) = drop_cap {
        // The initial belongs to the first logical line, but its baseline is independent of
        // the body strut. Merge absolute height references without inflating body line boxes.
        let typography = cap.line.typography;
        let baseline = cap.line.block_start + cap.line.baseline;
        record.flags |= u16::from(typography.height_fallbacks);
        record.min_content_width = record
            .min_content_width
            .max(finite_nonnegative_f32(typography.cap_height)?);
        record.max_content_width = record
            .max_content_width
            .max(finite_nonnegative_f32(typography.x_height)?);
        record.cap_height_top = record
            .cap_height_top
            .min(finite_f32(baseline - typography.cap_over)?);
        record.x_height_top = record
            .x_height_top
            .min(finite_f32(baseline - typography.x_over)?);
    }
    ink.write(&mut record)?;
    Ok(record)
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LayoutExtents {
    pub width: f64,
    pub height: f64,
    pub consumed_clusters: usize,
}

/// The query serializer consumes already prepared layout facts. General retains its rope
/// traversal and cluster-derived fallback width; an admitted Inline leaf owns exactly one
/// ordinary line and its precomputed semantic width.
#[derive(Clone, Copy)]
enum MeasurementSource<'a> {
    General {
        flow: &'a FlowLayoutArena,
        clusters: &'a ClusterArena,
    },
    Inline {
        line: &'a FlowLine,
        fragment: &'a FlowFragment,
        line_inline_extent: f64,
    },
}

// Keeping the rope iterator inline avoids allocating on every measurement query.
#[allow(clippy::large_enum_variant)]
enum MeasurementLines<'a> {
    General(Enumerate<Copied<RopeIter<'a, FlowLine>>>),
    Inline(Option<(usize, FlowLine)>),
}

impl Iterator for MeasurementLines<'_> {
    type Item = (usize, FlowLine);

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::General(lines) => lines.next(),
            Self::Inline(line) => line.take(),
        }
    }
}

// The general rope cursor is borrowed scratch; boxing it would add a query allocation.
#[allow(clippy::large_enum_variant)]
enum MeasurementFragmentCursor<'a> {
    General(RopeCursor<'a, FlowFragment>),
    Inline(Option<&'a FlowFragment>),
}

enum MeasurementFragments<'a> {
    General(RopeCursorRange<'a, FlowFragment>),
    Inline(&'a FlowFragment),
}

impl MeasurementFragments<'_> {
    fn is_empty(&self) -> bool {
        match self {
            Self::General(fragments) => fragments.is_empty(),
            Self::Inline(_) => false,
        }
    }

    fn first(&self) -> Option<&FlowFragment> {
        match self {
            Self::General(fragments) => fragments.first(),
            Self::Inline(fragment) => Some(*fragment),
        }
    }

    fn last(&self) -> Option<&FlowFragment> {
        match self {
            Self::General(fragments) => fragments.last(),
            Self::Inline(fragment) => Some(*fragment),
        }
    }
}

impl<'a> MeasurementFragmentCursor<'a> {
    fn take(&mut self, line: FlowLine) -> Result<MeasurementFragments<'a>, EngineError> {
        match self {
            Self::General(cursor) => {
                next_line_fragments(line, cursor).map(MeasurementFragments::General)
            }
            Self::Inline(fragment) => {
                if line.fragment_count != 1 {
                    return Err(EngineError::InvalidRequest);
                }
                fragment
                    .take()
                    .map(MeasurementFragments::Inline)
                    .ok_or(EngineError::InvalidRequest)
            }
        }
    }

    fn require_complete(&self) -> Result<(), EngineError> {
        match self {
            Self::General(cursor) => require_complete_fragment_traversal(cursor),
            Self::Inline(fragment) => fragment
                .is_none()
                .then_some(())
                .ok_or(EngineError::InvalidRequest),
        }
    }
}

impl<'a> MeasurementSource<'a> {
    fn line_len(self) -> usize {
        match self {
            Self::General { flow, .. } => flow.lines.len(),
            Self::Inline { .. } => 1,
        }
    }

    fn lines(self) -> MeasurementLines<'a> {
        match self {
            Self::General { flow, .. } => {
                MeasurementLines::General(flow.lines.iter().copied().enumerate())
            }
            Self::Inline { line, .. } => MeasurementLines::Inline(Some((0, *line))),
        }
    }

    fn fragment_cursor(self) -> Result<MeasurementFragmentCursor<'a>, EngineError> {
        match self {
            Self::General { flow, .. } => flow
                .fragments
                .cursor_from(0)
                .map(MeasurementFragmentCursor::General)
                .ok_or(EngineError::InvalidRequest),
            Self::Inline { fragment, .. } => Ok(MeasurementFragmentCursor::Inline(Some(fragment))),
        }
    }

    fn line_advance(
        self,
        line: FlowLine,
        fragments: &MeasurementFragments<'_>,
        first_thread_line: bool,
        final_line: bool,
        constraint: &super::semantic_wire::FlowConstraint,
    ) -> Result<f64, EngineError> {
        match (self, fragments) {
            (Self::General { flow, clusters }, MeasurementFragments::General(fragments)) => {
                line_inline_extent(
                    flow,
                    line,
                    fragments,
                    first_thread_line,
                    final_line,
                    clusters,
                    constraint_typography(constraint),
                )
            }
            (
                Self::Inline {
                    line_inline_extent, ..
                },
                MeasurementFragments::Inline(_),
            ) => Ok(line_inline_extent),
            _ => Err(EngineError::InvalidRequest),
        }
    }

    fn drop_cap(self, flow_thread_id: u32) -> Option<&'a FlowDropCap> {
        match self {
            Self::General { flow, .. } => flow
                .drop_caps
                .iter()
                .find(|cap| cap.line.flow_thread_id == flow_thread_id),
            Self::Inline { .. } => None,
        }
    }
}

// Stage aggregation: each argument is one explicit input threaded through the
// pipeline rather than hidden mutable state, and D-244 measured outlining these
// bodies as size-neutral. Arity is the shape, not a smell.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn append_measurement(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    flow: &FlowLayoutArena,
    positioned_glyphs: &[PositionedSemanticGlyph],
    placement_translations: &[SegmentTranslation],
    semantic_line_glyph_starts: &[u32],
    semantic_line_glyph_counts: &[u32],
    semantic_line_inline_extents: Option<&[f64]>,
    clusters: &ClusterArena,
    intrinsic_extents: Option<LayoutExtents>,
    intrinsics: super::cluster_state::IntrinsicWidths,
    include_glyph_spans: bool,
    include_glyphs: bool,
) -> Result<(), EngineError> {
    // Flat hand-authored rows are test inputs to the one production serializer.
    let derived_starts = semantic_line_glyph_starts
        .is_empty()
        .then(|| alloc::vec![0; flow.lines.len()]);
    let derived_counts = semantic_line_glyph_counts
        .is_empty()
        .then(|| alloc::vec![0; flow.lines.len()]);
    let starts = derived_starts
        .as_deref()
        .unwrap_or(semantic_line_glyph_starts);
    let counts = derived_counts
        .as_deref()
        .unwrap_or(semantic_line_glyph_counts);
    let mut rows = positioned_glyphs.iter().copied();
    append_measurement_from_occurrences(
        target,
        paragraph_id,
        text_length,
        cluster_count,
        geometry,
        flow,
        positioned_glyphs.len(),
        || rows.next().ok_or(EngineError::InvalidRequest),
        placement_translations,
        None,
        starts,
        counts,
        semantic_line_inline_extents,
        clusters,
        intrinsic_extents,
        intrinsics,
        include_glyph_spans,
        include_glyphs,
    )
}

#[inline(never)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn append_measurement_from_occurrences(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    flow: &FlowLayoutArena,
    positioned_count: usize,
    next_glyph: impl FnMut() -> Result<PositionedSemanticGlyph, EngineError>,
    placement_translations: &[SegmentTranslation],
    line_ink: Option<(&[LineInk], &[u32])>,
    semantic_line_glyph_starts: &[u32],
    semantic_line_glyph_counts: &[u32],
    semantic_line_inline_extents: Option<&[f64]>,
    clusters: &ClusterArena,
    intrinsic_extents: Option<LayoutExtents>,
    intrinsics: super::cluster_state::IntrinsicWidths,
    include_glyph_spans: bool,
    include_glyphs: bool,
) -> Result<(), EngineError> {
    append_measurement_from_occurrences_source(
        target,
        paragraph_id,
        text_length,
        cluster_count,
        geometry,
        MeasurementSource::General { flow, clusters },
        positioned_count,
        next_glyph,
        placement_translations,
        line_ink,
        semantic_line_glyph_starts,
        semantic_line_glyph_counts,
        semantic_line_inline_extents,
        intrinsic_extents,
        intrinsics,
        include_glyph_spans,
        include_glyphs,
    )
}

/// Serialize an admitted single-line Inline leaf with the same record writer as General.
/// The caller supplies the final semantic line width computed synchronously by preparation.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn append_measurement_from_inline_occurrences(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    line: &FlowLine,
    fragment: &FlowFragment,
    line_inline_extent: f64,
    positioned_count: usize,
    next_glyph: impl FnMut() -> Result<PositionedSemanticGlyph, EngineError>,
    placement_translations: &[SegmentTranslation],
    semantic_line_glyph_starts: &[u32],
    semantic_line_glyph_counts: &[u32],
    intrinsic_extents: Option<LayoutExtents>,
    intrinsics: super::cluster_state::IntrinsicWidths,
    include_glyph_spans: bool,
    include_glyphs: bool,
) -> Result<(), EngineError> {
    append_measurement_from_occurrences_source(
        target,
        paragraph_id,
        text_length,
        cluster_count,
        geometry,
        MeasurementSource::Inline {
            line,
            fragment,
            line_inline_extent,
        },
        positioned_count,
        next_glyph,
        placement_translations,
        None,
        semantic_line_glyph_starts,
        semantic_line_glyph_counts,
        None,
        intrinsic_extents,
        intrinsics,
        include_glyph_spans,
        include_glyphs,
    )
}

#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn append_measurement_from_occurrences_source(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    source: MeasurementSource<'_>,
    positioned_count: usize,
    mut next_glyph: impl FnMut() -> Result<PositionedSemanticGlyph, EngineError>,
    placement_translations: &[SegmentTranslation],
    line_ink: Option<(&[LineInk], &[u32])>,
    semantic_line_glyph_starts: &[u32],
    semantic_line_glyph_counts: &[u32],
    semantic_line_inline_extents: Option<&[f64]>,
    intrinsic_extents: Option<LayoutExtents>,
    intrinsics: super::cluster_state::IntrinsicWidths,
    include_glyph_spans: bool,
    include_glyphs: bool,
) -> Result<(), EngineError> {
    #[cfg(feature = "stage-bench")]
    let _clock = super::state::oracle::stage_bench::clock::MEASUREMENT.guard();
    let constraint = geometry
        .constraints
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    if constraint.paragraph_id != paragraph_id {
        return Err(EngineError::InvalidRequest);
    }
    if include_glyph_spans
        && (semantic_line_glyph_starts.len() != source.line_len()
            || semantic_line_glyph_counts.len() != source.line_len())
        || semantic_line_inline_extents.is_some_and(|extents| extents.len() != source.line_len())
    {
        return Err(EngineError::InvalidRequest);
    }
    // Glyph records need every glyph; a measurement alone unions the lines positioning measured.
    let line_ink_lanes = line_ink.filter(|(ink, missing)| {
        !include_glyphs && ink.len() == source.line_len() && missing.len() == source.line_len()
    });
    let mut line_count = 0_usize;
    let mut fragment_cursor = source.fragment_cursor()?;
    for (_, line) in source.lines() {
        let fragments = fragment_cursor.take(line)?;
        if line.flow_thread_id == constraint.flow_thread_id && !fragments.is_empty() {
            line_count = line_count
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
        }
    }
    fragment_cursor.require_complete()?;
    let reserve = line_count
        .checked_add(1)
        .and_then(|count| count.checked_add(if include_glyphs { positioned_count } else { 0 }))
        .ok_or(EngineError::ResultTooLarge)?;
    target
        .try_reserve(reserve)
        .map_err(|_| EngineError::ResultTooLarge)?;

    let summary_index = target.len();
    let line_start = u32::try_from(
        summary_index
            .checked_add(1)
            .ok_or(EngineError::ResultTooLarge)?,
    )
    .map_err(|_| EngineError::ResultTooLarge)?;
    let glyph_record_start = summary_index
        .checked_add(1)
        .and_then(|value| value.checked_add(line_count))
        .ok_or(EngineError::ResultTooLarge)?;
    target.resize(glyph_record_start, SemanticRecord::default());
    let mut glyph_cursor = 0_usize;
    let mut missing_glyph_count = 0_usize;
    let mut content_width = 0.0_f64;
    let mut content_height = 0.0_f64;
    let mut paragraph_ink = InkBounds::default();
    let mut first_ascent = 0.0_f64;
    let mut line_count_emitted = 0_usize;
    let mut consumed_clusters =
        usize::try_from(constraint.resume_cluster).map_err(|_| EngineError::InvalidRequest)?;

    fragment_cursor = source.fragment_cursor()?;
    let mut lines = source.lines().peekable();
    let mut previous_flow_thread_id = None;
    while let Some((index, line)) = lines.next() {
        let next_line = lines.peek().map(|(_, line)| line);
        let fragments = fragment_cursor.take(line)?;
        let first_thread_line = previous_flow_thread_id != Some(line.flow_thread_id);
        previous_flow_thread_id = Some(line.flow_thread_id);
        let span_start = usize::try_from(
            *semantic_line_glyph_starts
                .get(index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let span_count = usize::try_from(
            *semantic_line_glyph_counts
                .get(index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        if span_start != glyph_cursor {
            return Err(EngineError::InvalidRequest);
        }
        let mut line_ink = InkBounds::default();
        if let Some((ink, missing)) = line_ink_lanes {
            missing_glyph_count += missing[index] as usize;
            if line.flow_thread_id == constraint.flow_thread_id && !fragments.is_empty() {
                line_ink = InkBounds::from_line(ink[index]);
            }
            glyph_cursor += span_count;
        }
        for _ in 0..if line_ink_lanes.is_some() {
            0
        } else {
            span_count
        } {
            let glyph = next_glyph()?;
            missing_glyph_count += usize::from(glyph.glyph_id == 0);
            let translation = *placement_translations
                .get(
                    usize::try_from(glyph.placement_segment)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            if line.flow_thread_id == constraint.flow_thread_id && !fragments.is_empty() {
                line_ink.join_glyph(glyph, translation)?;
            }
            if include_glyphs {
                let glyph = glyph.placed(translation)?;
                target.push(SemanticRecord {
                    id: glyph.stable_id,
                    kind: SEMANTIC_GLYPH,
                    flags: glyph.flags,
                    parent_id: paragraph_id,
                    text_start: glyph.cluster,
                    text_end: glyph.font_handle,
                    item_start: u32::from(glyph.glyph_id),
                    item_count: u32::from(glyph.bidi_level),
                    inline_start: glyph.inline_origin,
                    block_start: glyph.block_origin,
                    inline_extent: glyph.font_size,
                    inline_advance: glyph.inline_advance,
                    ink_inline_start: glyph.ink_inline_start,
                    ink_block_start: glyph.ink_block_start,
                    ink_inline_extent: glyph.ink_inline_extent,
                    ink_block_extent: glyph.ink_block_extent,
                    ..SemanticRecord::default()
                });
            }
            glyph_cursor += 1;
        }
        if line.flow_thread_id != constraint.flow_thread_id {
            continue;
        }
        let Some(first) = fragments.first() else {
            continue;
        };
        let Some(last) = fragments.last() else {
            continue;
        };
        let advance = if let Some(extents) = semantic_line_inline_extents {
            extents[index]
        } else {
            source.line_advance(
                line,
                &fragments,
                first_thread_line,
                next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id),
                constraint,
            )?
        };
        content_width = content_width.max(advance);
        content_height = content_height.max(line.block_start + line.height);
        let drop_cap = first_thread_line
            .then(|| source.drop_cap(line.flow_thread_id))
            .flatten();
        if let Some(cap) = drop_cap {
            content_height = content_height.max(cap.line.block_start + cap.line.height);
        }
        consumed_clusters = consumed_clusters
            .max(usize::try_from(last.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?);
        let item_start = if include_glyph_spans {
            u32::try_from(glyph_record_start)
                .map_err(|_| EngineError::ResultTooLarge)?
                .checked_add(semantic_line_glyph_starts[index])
                .ok_or(EngineError::ResultTooLarge)?
        } else {
            0
        };
        let item_count = if include_glyph_spans {
            semantic_line_glyph_counts[index]
        } else {
            0
        };
        target[summary_index + 1 + line_count_emitted] = semantic_line_record(
            paragraph_id,
            index,
            drop_cap.map_or(first.line.text_start, |cap| cap.fragment.line.text_start),
            last.line.text_end,
            item_start,
            item_count,
            line,
            drop_cap,
            advance,
            line_ink,
        )?;
        // The paragraph's ascent is the distance from its box top to the FIRST baseline, which is
        // the first emitted line's absolute baseline, not that line's own ascent.
        if line_count_emitted == 0 {
            first_ascent = line.block_start + line.baseline;
        }
        line_count_emitted += 1;
        paragraph_ink.join(line_ink);
    }
    fragment_cursor.require_complete()?;

    let expected_record_count = glyph_record_start
        .checked_add(if include_glyphs { positioned_count } else { 0 })
        .ok_or(EngineError::ResultTooLarge)?;
    if glyph_cursor != positioned_count || target.len() != expected_record_count {
        return Err(EngineError::InvalidRequest);
    }

    // A composed paragraph carries its trailing space-after in every block
    // measurement, so consumers stack paragraphs from the reported extents.
    if line_count > 0 {
        content_height += f64::from(constraint.space_after);
    }
    let intrinsic = intrinsic_extents.unwrap_or(LayoutExtents {
        width: content_width,
        height: content_height,
        consumed_clusters,
    });
    let full_content_width = content_width.max(intrinsic.width);
    let full_content_height = content_height.max(intrinsic.height);
    let width = resolve_axis(constraint.width_mode, constraint.width, content_width)?;
    let height = resolve_axis(constraint.height_mode, constraint.height, content_height)?;
    let overflowed = consumed_clusters < cluster_count
        || intrinsic.consumed_clusters < cluster_count
        || axis_overflowed(constraint.width_mode, constraint.width, full_content_width)?
        || axis_overflowed(
            constraint.height_mode,
            constraint.height,
            full_content_height,
        )?;
    // Totals and ink derive from the same positioned result supplied by preparation.
    let visible_glyph_count = positioned_count;
    // Ink is authoritative exactly when this query positioned the glyphs it measured. A paragraph
    // that positioned zero glyphs still reports authoritatively — its ink box is genuinely empty —
    // so the bit tracks whether positioning ran, not whether any ink was found.
    let ink_measured = positioned_count != 0 || (include_glyph_spans && line_count == 0);
    target[summary_index] = SemanticRecord {
        id: paragraph_id,
        kind: SEMANTIC_PARAGRAPH_MEASUREMENT,
        flags: if overflowed {
            MEASUREMENT_FLAG_OVERFLOWED
        } else {
            0
        } | if ink_measured {
            MEASUREMENT_FLAG_INK_BOUNDS
        } else {
            0
        },
        parent_id: u32::try_from(visible_glyph_count).map_err(|_| EngineError::ResultTooLarge)?,
        text_start: u32::try_from(missing_glyph_count).map_err(|_| EngineError::ResultTooLarge)?,
        text_end: u32::try_from(text_length).map_err(|_| EngineError::ResultTooLarge)?,
        item_start: line_start,
        item_count: u32::try_from(line_count).map_err(|_| EngineError::ResultTooLarge)?,
        inline_start: width,
        block_start: height,
        inline_extent: finite_nonnegative_measure_f32(full_content_width)?,
        block_extent: finite_nonnegative_measure_f32(full_content_height)?,
        ascent: finite_nonnegative_f32(first_ascent)?,
        min_content_width: finite_nonnegative_measure_f32(intrinsics.min_content_width)?,
        max_content_width: finite_nonnegative_measure_f32(intrinsics.max_content_width)?,
        ..SemanticRecord::default()
    };
    paragraph_ink.write(&mut target[summary_index])?;
    Ok(())
}

pub(crate) fn flow_extents(
    flow_thread_id: u32,
    flow: &FlowLayoutArena,
    clusters: &ClusterArena,
    typography: ThreadTypography,
) -> Result<LayoutExtents, EngineError> {
    let mut extents = LayoutExtents::default();
    let mut fragment_cursor = flow
        .fragments
        .cursor_from(0)
        .ok_or(EngineError::InvalidRequest)?;
    let mut lines = flow.lines.iter().copied().peekable();
    let mut previous_flow_thread_id = None;
    while let Some(line) = lines.next() {
        let next_line = lines.peek();
        let fragments = next_line_fragments(line, &mut fragment_cursor)?;
        let first_thread_line = previous_flow_thread_id != Some(line.flow_thread_id);
        previous_flow_thread_id = Some(line.flow_thread_id);
        if line.flow_thread_id != flow_thread_id {
            continue;
        }
        if fragments.is_empty() {
            continue;
        }
        let Some(last) = fragments.last() else {
            continue;
        };
        extents.width = extents.width.max(line_inline_extent(
            flow,
            line,
            &fragments,
            first_thread_line,
            next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id),
            clusters,
            typography,
        )?);
        extents.height = extents.height.max(line.block_start + line.height);
        if first_thread_line
            && let Some(cap) = flow
                .drop_caps
                .iter()
                .find(|cap| cap.line.flow_thread_id == line.flow_thread_id)
        {
            extents.height = extents.height.max(cap.line.block_start + cap.line.height);
        }
        extents.consumed_clusters = extents
            .consumed_clusters
            .max(usize::try_from(last.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?);
    }
    require_complete_fragment_traversal(&fragment_cursor)?;
    Ok(extents)
}

fn line_inline_extent(
    flow: &FlowLayoutArena,
    line: FlowLine,
    fragments: &RopeCursorRange<'_, FlowFragment>,
    first_thread_line: bool,
    final_line: bool,
    clusters: &ClusterArena,
    typography: ThreadTypography,
) -> Result<f64, EngineError> {
    if fragments.is_empty() {
        return Ok(0.0);
    }
    let mut inline_start = fragments
        .iter()
        .map(|fragment| fragment.slot_start)
        .fold(f64::INFINITY, f64::min);
    let mut inline_end = f64::NEG_INFINITY;
    if first_thread_line
        && let Some(cap) = flow
            .drop_caps
            .iter()
            .find(|cap| cap.line.flow_thread_id == line.flow_thread_id)
    {
        inline_start = inline_start.min(cap.fragment.slot_start);
        inline_end = inline_end.max(cap.fragment.slot_start + cap.fragment.line.advance);
    }
    for fragment in fragments.iter().copied() {
        let indent = if fragment.line.cluster_start == 0 {
            typography.first_line_indent
        } else {
            0.0
        };
        inline_end = inline_end.max(
            fragment.slot_start
                + positioned_fragment_advance(
                    line,
                    fragment,
                    final_line,
                    clusters,
                    indent,
                    typography.justify,
                )?,
        );
    }
    Ok((inline_end - inline_start).max(0.0))
}

fn next_line_fragments<'a>(
    line: FlowLine,
    cursor: &mut RopeCursor<'a, FlowFragment>,
) -> Result<RopeCursorRange<'a, FlowFragment>, EngineError> {
    cursor
        .take(usize::from(line.fragment_count))
        .ok_or(EngineError::InvalidRequest)
}

fn require_complete_fragment_traversal(
    cursor: &RopeCursor<'_, FlowFragment>,
) -> Result<(), EngineError> {
    cursor
        .is_empty()
        .then_some(())
        .ok_or(EngineError::InvalidRequest)
}

fn resolve_axis(mode: u8, requested: f32, content: f64) -> Result<f32, EngineError> {
    match mode {
        AXIS_UNCONSTRAINED => finite_nonnegative_measure_f32(content),
        AXIS_AT_MOST => finite_nonnegative_measure_f32(content.min(f64::from(requested))),
        AXIS_EXACT => Ok(requested),
        _ => Err(EngineError::InvalidRequest),
    }
}

fn axis_overflowed(mode: u8, requested: f32, content: f64) -> Result<bool, EngineError> {
    match mode {
        AXIS_UNCONSTRAINED => Ok(false),
        AXIS_AT_MOST | AXIS_EXACT => Ok(content > f64::from(requested)),
        _ => Err(EngineError::InvalidRequest),
    }
}

fn finite_f32(value: f64) -> Result<f32, EngineError> {
    let narrowed = value as f32;
    if narrowed.is_finite() {
        Ok(narrowed)
    } else {
        Err(EngineError::ResultTooLarge)
    }
}

fn finite_nonnegative_f32(value: f64) -> Result<f32, EngineError> {
    if !value.is_finite() || value < 0.0 {
        return Err(EngineError::InvalidRequest);
    }
    finite_f32(value)
}

fn finite_nonnegative_measure_f32(value: f64) -> Result<f32, EngineError> {
    let narrowed = finite_nonnegative_f32(value)?;
    if f64::from(narrowed) >= value {
        return Ok(narrowed);
    }
    let rounded_up = f32::from_bits(narrowed.to_bits().saturating_add(1));
    rounded_up
        .is_finite()
        .then_some(rounded_up)
        .ok_or(EngineError::ResultTooLarge)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        flow_composition::{FlowFragment, FlowLine, NO_BOUNDARY},
        line_composition::{ComposedLine, Correction},
        semantic_wire::FlowConstraint,
    };

    #[test]
    fn measurement_carries_space_after_and_first_line_indent() {
        let mut spaced = constraint(AXIS_AT_MOST, 40.0, AXIS_AT_MOST, 30.0);
        spaced.space_after = 6.0;
        spaced.first_line_indent = 4.0;
        let geometry = FlowGeometryArena {
            constraints: vec![spaced],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 7.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut records = vec![];
        append_measurement(
            &mut records,
            7,
            2,
            2,
            &geometry,
            &flow,
            &[layout_glyph(3), layout_glyph(0)],
            &[SegmentTranslation::default()],
            &[0],
            &[2],
            None,
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            true,
            false,
        )
        .unwrap();
        // The first line occupies indent + advance inline, and the paragraph's
        // block extent carries the trailing space-after.
        assert_eq!(records[1].inline_extent, 11.0);
        assert_eq!(
            records.len(),
            2,
            "line spans do not require serialized glyph records"
        );
        assert_eq!(records[1].item_start, 2);
        assert_eq!(records[1].item_count, 2);
        assert_eq!(records[0].inline_extent, 11.0);
        assert_eq!(records[0].block_extent, 11.0);
        super::super::work_attribution::reset();
        let extents = flow_extents(
            11,
            &flow,
            &ClusterArena::default(),
            constraint_typography(&spaced),
        )
        .unwrap();
        assert_eq!(extents.width, 11.0);
        assert_eq!(extents.height, 5.0);
        assert_eq!(extents.consumed_clusters, 2);
        assert_eq!(
            super::super::work_attribution::snapshot().rope_iterator_starts,
            4,
            "one line traversal, one fragment cursor, and two fragment extent scans",
        );
    }

    #[test]
    fn measurement_is_demand_shaped_from_retained_lines_without_glyph_arrays() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_EXACT, 20.0, AXIS_EXACT, 10.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 7.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut records = vec![];
        let positioned = [layout_glyph(3), layout_glyph(0)];
        append_measurement(
            &mut records,
            7,
            2,
            2,
            &geometry,
            &flow,
            &positioned,
            &[SegmentTranslation::default()],
            &[0],
            &[2],
            Some(&[7.0]),
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            false,
            false,
        )
        .unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].kind, SEMANTIC_PARAGRAPH_MEASUREMENT);
        assert_eq!(records[0].id, 7);
        // Positioned glyphs were supplied, so the ink box is authoritative even though this
        // query emits no glyph records.
        assert_eq!(records[0].flags, MEASUREMENT_FLAG_INK_BOUNDS);
        assert_eq!(records[0].parent_id, 2);
        assert_eq!(records[0].text_start, 1);
        assert_eq!(records[0].item_start, 1);
        assert_eq!(records[0].item_count, 1);
        assert_eq!(records[0].inline_start, 20.0);
        assert_eq!(records[0].block_start, 10.0);
        assert_eq!(records[0].inline_extent, 7.0);
        assert_eq!(records[0].block_extent, 5.0);
        assert_eq!(records[1].kind, SEMANTIC_LINE);
        assert_eq!(records[1].parent_id, 7);
        assert_eq!(records[1].block_start, 4.0);
        assert_eq!(records[1].inline_extent, 7.0);

        let mut inspected = vec![];
        append_measurement(
            &mut inspected,
            7,
            2,
            2,
            &geometry,
            &flow,
            &positioned,
            &[SegmentTranslation::default()],
            &[0],
            &[2],
            Some(&[7.0]),
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            true,
            true,
        )
        .unwrap();
        assert_eq!(inspected.len(), 4);
        assert_eq!(inspected[1].item_start, 2);
        assert_eq!(inspected[1].item_count, 2);
        assert_eq!(inspected[2].kind, SEMANTIC_GLYPH);
        assert_eq!(inspected[2].item_start, 3);
        assert_eq!(inspected[3].kind, SEMANTIC_GLYPH);
        assert_eq!(inspected[3].item_start, 0);

        // A leaf supplies the identical prepared facts without a FlowLayoutArena or ClusterArena.
        // Compare both the compact measurement and the demanded glyph stream, including the
        // missing-glyph count, line span indices, summary flags, and all published glyph fields.
        let line = *flow.lines.iter().next().unwrap();
        let fragment = *flow.fragments.iter().next().unwrap();
        for (include_spans, include_glyphs, expected) in
            [(false, false, &records), (true, true, &inspected)]
        {
            let mut inline_records = vec![];
            let mut rows = positioned.iter().copied();
            append_measurement_from_inline_occurrences(
                &mut inline_records,
                7,
                2,
                2,
                &geometry,
                &line,
                &fragment,
                7.0,
                positioned.len(),
                || rows.next().ok_or(EngineError::InvalidRequest),
                &[SegmentTranslation::default()],
                &[0],
                &[2],
                None,
                crate::engine::cluster_state::IntrinsicWidths::default(),
                include_spans,
                include_glyphs,
            )
            .unwrap();
            assert_eq!(&inline_records, expected);
        }
    }

    #[test]
    fn constrained_measurement_preserves_demanded_intrinsic_content_extents() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_AT_MOST, 6.0, AXIS_AT_MOST, 4.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 1,
                    text_start: 0,
                    text_end: 1,
                    advance: 7.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 6.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut records = vec![];
        append_measurement(
            &mut records,
            7,
            2,
            2,
            &geometry,
            &flow,
            &[],
            &[],
            &[0],
            &[0],
            Some(&[7.0]),
            &ClusterArena::default(),
            Some(LayoutExtents {
                width: 9.0,
                height: 8.0,
                consumed_clusters: 2,
            }),
            crate::engine::cluster_state::IntrinsicWidths::default(),
            false,
            false,
        )
        .unwrap();

        assert_eq!(records[0].flags, MEASUREMENT_FLAG_OVERFLOWED);
        assert_eq!(records[0].inline_start, 6.0);
        assert_eq!(records[0].block_start, 4.0);
        assert_eq!(records[0].inline_extent, 9.0);
        assert_eq!(records[0].block_extent, 8.0);
    }

    #[test]
    fn unconstrained_content_does_not_overflow_after_single_precision_publication() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_UNCONSTRAINED, 0.0, AXIS_UNCONSTRAINED, 0.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 100.0,
                height: 140.64,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 1,
                    text_start: 0,
                    text_end: 1,
                    advance: 140.64,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 140.64,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut records = vec![];
        append_measurement(
            &mut records,
            7,
            1,
            1,
            &geometry,
            &flow,
            &[],
            &[],
            &[0],
            &[0],
            Some(&[140.64]),
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            false,
            false,
        )
        .unwrap();

        assert_eq!(records[0].flags, 0);
        assert!(f64::from(records[0].inline_start) >= 140.64);
        assert!(f64::from(records[0].block_start) >= 140.64);
    }

    #[test]
    fn measured_extent_rounds_outward_across_the_fixed_point_boundary() {
        use super::super::layout_units::{layout_units_from_scaled, scaled_from_layout_units};

        let content_units = 39_000_001_i64;
        let content = scaled_from_layout_units(content_units);
        let nearest = content as f32;
        assert!(layout_units_from_scaled(f64::from(nearest)) < content_units);

        let published = finite_nonnegative_measure_f32(content).unwrap();
        assert!(f64::from(published) >= content);
        assert!(layout_units_from_scaled(f64::from(published)) >= content_units);
        assert_eq!(finite_nonnegative_measure_f32(600.0).unwrap(), 600.0);

        for units in (1_i64..=1_000_000).step_by(97).chain([
            16_777_215,
            16_777_216,
            39_000_001,
            1_i64 << 40,
            (1_i64 << 52) - 1,
        ]) {
            let published =
                finite_nonnegative_measure_f32(scaled_from_layout_units(units)).unwrap();
            assert!(layout_units_from_scaled(f64::from(published)) >= units);
        }
    }

    fn constraint(width_mode: u8, width: f32, height_mode: u8, height: f32) -> FlowConstraint {
        FlowConstraint {
            paragraph_id: 7,
            flow_thread_id: 11,
            width,
            height,
            viewport_block_start: 0.0,
            viewport_block_end: height,
            resume_block_offset: 0.0,
            max_lines: 8,
            region_start: 0,
            resume_cluster: 0,
            region_count: 1,
            resume_region: 0,
            width_mode,
            height_mode,
            wrap: 2,
            align: 1,
            overflow: 1,
            block_align: 1,
            first_line_indent: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            justify_min_word_space_ratio: 0.0,
            justify_max_word_space_ratio: 0.0,
            justify_letter_space_expansion: 0.0,
            last_line: 1,
            drop_cap_lines: 0,
            drop_cap_alignment: 0,
            drop_cap_side: 0,
            drop_cap_margin_inline: 0.0,
            drop_cap_margin_block: 0.0,
            drop_cap_vertices_offset: 0,
            drop_cap_vertex_count: 0,
        }
    }

    fn layout_glyph(glyph_id: u16) -> PositionedSemanticGlyph {
        PositionedSemanticGlyph {
            stable_id: u32::from(glyph_id) + 1,
            font_handle: 1,
            glyph_id,
            cluster: 0,
            flags: 0,
            font_size: 16.0,
            inline_origin: 0.0,
            block_origin: 0.0,
            ..PositionedSemanticGlyph::default()
        }
    }

    fn inked_glyph(glyph_id: u16, inline_start: f32, block_start: f32) -> PositionedSemanticGlyph {
        PositionedSemanticGlyph {
            ink_inline_start: inline_start,
            ink_block_start: block_start,
            ink_inline_extent: 3.0,
            ink_block_extent: 6.0,
            inline_advance: 4.0,
            ..layout_glyph(glyph_id)
        }
    }

    /// Ascent and descent decompose the line box, and the ink union is a real union rather than the
    /// advance box. Both are what a positioning caller needs and neither existed before.
    #[test]
    fn line_and_paragraph_metrics_carry_ascent_and_a_true_ink_union() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_EXACT, 20.0, AXIS_EXACT, 10.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 7.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        // The second glyph overhangs the first on both axes, which is the case an advance-derived
        // extent gets wrong.
        let positioned = [inked_glyph(3, -1.0, -2.0), inked_glyph(4, 5.0, 1.0)];
        let placement = [SegmentTranslation {
            translation_inline: 10.0,
            translation_block: 20.0,
        }];
        let mut records = vec![];
        append_measurement(
            &mut records,
            7,
            2,
            2,
            &geometry,
            &flow,
            &positioned,
            &placement,
            &[0],
            &[2],
            Some(&[7.0]),
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            true,
            true,
        )
        .unwrap();

        let paragraph = records[0];
        let line = records[1];
        assert_eq!(line.kind, SEMANTIC_LINE);
        // block_start is the absolute baseline; ascent splits the box around it.
        assert_eq!(line.block_start, 4.0);
        assert_eq!(line.ascent, 4.0);
        assert_eq!(line.block_extent - line.ascent, 1.0);
        // Local ink spans [-1, 8) inline and [-2, 7) block. The query composes the retained
        // placement once while preserving its 9x9 union.
        assert_eq!(line.ink_inline_start, 9.0);
        assert_eq!(line.ink_inline_extent, 9.0);
        assert_eq!(line.ink_block_start, 18.0);
        assert_eq!(line.ink_block_extent, 9.0);
        assert!(line.ink_inline_extent > line.inline_extent);
        assert_eq!(records[2].inline_start, 10.0);
        assert_eq!(records[2].block_start, 20.0);

        assert_eq!(
            paragraph.flags & MEASUREMENT_FLAG_INK_BOUNDS,
            MEASUREMENT_FLAG_INK_BOUNDS
        );
        assert_eq!(paragraph.ascent, 4.0);
        assert_eq!(paragraph.ink_inline_start, line.ink_inline_start);
        assert_eq!(paragraph.ink_inline_extent, line.ink_inline_extent);
        assert_eq!(paragraph.ink_block_start, line.ink_block_start);
        assert_eq!(paragraph.ink_block_extent, line.ink_block_extent);
        assert_eq!(records[2].inline_advance, 4.0);
        assert_eq!(records[2].ink_inline_start, 9.0);
    }

    /// A query that positioned nothing must not publish an ink box at the origin.
    #[test]
    fn a_measurement_without_positioned_glyphs_withholds_the_ink_box() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_EXACT, 20.0, AXIS_EXACT, 10.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 7.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut records = vec![];
        append_measurement(
            &mut records,
            7,
            2,
            2,
            &geometry,
            &flow,
            &[],
            &[],
            &[],
            &[],
            Some(&[7.0]),
            &ClusterArena::default(),
            None,
            crate::engine::cluster_state::IntrinsicWidths::default(),
            false,
            false,
        )
        .unwrap();

        assert_eq!(records[0].flags & MEASUREMENT_FLAG_INK_BOUNDS, 0);
        assert_eq!(records[0].ink_inline_extent, 0.0);
        assert_eq!(records[0].ink_block_extent, 0.0);
        // The line box still decomposes; only ink needed positioning.
        assert_eq!(records[1].ascent, 4.0);
        assert_eq!(records[1].block_extent, 5.0);
    }
}
