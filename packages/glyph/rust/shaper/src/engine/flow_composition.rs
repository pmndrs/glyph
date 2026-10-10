use alloc::vec::Vec;
use core::ops::Range;

use crate::FontMetrics;

use super::{
    EngineError, FrameFault,
    cluster_state::{CLUSTER_HARD_BREAK, CLUSTER_SAFE_BEFORE, CLUSTER_SPACE, ClusterArena},
    flow_geometry::{
        ExclusionDirtyBand, FlowGeometryArena, InlineCut, InlineSlotArena, polygon_projection,
    },
    frame::{
        ALIGN_JUSTIFY, ALIGN_START, AXIS_AT_MOST, AXIS_EXACT, DROP_CAP_ALIGN_BASELINE,
        DROP_CAP_ALIGN_TEXT_TOP, DROP_CAP_SIDE_INLINE_START, EXCLUSION_WRAP_INLINE_END,
        EXCLUSION_WRAP_INLINE_START, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, WRAP_WORD,
        WRITING_HORIZONTAL_TB,
    },
    line_composition::{
        BreakCorrections, ComposedLine, Correction, LineCursor, layout_next_line_integer,
    },
    retained_rope::{
        RetainedRope, RopeCursorRange, RopeEditError, RopeRange, RopeRecord, RopeSummary,
    },
    semantic_wire::FlowConstraint,
    shaping_state::ShapingRun,
    style_state::StyleSegment,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowLine {
    pub flow_thread_id: u32,
    pub region_id: u32,
    pub transform_index: u32,
    pub clip_id: u32,
    pub fragment_count: u16,
    pub align: u8,
    pub block_start: f64,
    pub baseline: f64,
    pub height: f64,
}

impl RopeRecord for FlowLine {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            fragments: usize::from(self.fragment_count),
            ..RopeSummary::default()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowFragment {
    pub line: ComposedLine,
    pub slot_start: f64,
    pub slot_end: f64,
    /// This slot reached a flexible region end and is resolved to the
    /// thread's chosen inline end after every line has composed.
    pub flexible_end: bool,
    pub boundary_index: u32,
    /// The record shaping the island this fragment starts, when a break correction moved its glyphs.
    pub lead_index: u32,
    /// The record shaping the island this fragment ends, when a break correction moved its glyphs.
    pub tail_index: u32,
}

impl RopeRecord for FlowFragment {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            fragments: 1,
            source_start: self.line.text_start,
            source_end: self
                .line
                .text_end
                .max(self.line.text_start.saturating_add(1)),
            has_source: true,
        }
    }
}

pub(crate) const NO_BOUNDARY: u32 = u32::MAX;

const DROP_CAP_MAX_CLUSTERS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowDropCap {
    pub body_resume_cluster: u32,
    pub line: FlowLine,
    pub fragment: FlowFragment,
    cut: InlineCut,
    cut_block_start: f64,
    cut_block_end: f64,
    lines: u8,
    alignment: u8,
    ink_block_start: f64,
    ink_block_end: f64,
    margin_block: f64,
    contour_start: u32,
    contour_count: u16,
}

impl FlowDropCap {
    fn cut_for_band(
        self,
        geometry: &FlowGeometryArena,
        line_ordinal: usize,
        block_start: f64,
        block_end: f64,
    ) -> Result<Option<InlineCut>, EngineError> {
        if line_ordinal >= usize::from(self.lines)
            && (self.cut_block_start >= block_end || block_start >= self.cut_block_end)
        {
            return Ok(None);
        }
        if self.contour_count == 0 {
            return Ok(Some(self.cut));
        }
        let block_extent = self.cut_block_end - self.cut_block_start;
        if !block_extent.is_finite() || block_extent <= 0.0 {
            return Err(EngineError::InvalidRequest);
        }
        let normalized_start =
            ((block_start - self.cut_block_start) / block_extent).clamp(0.0, 1.0);
        let normalized_end = ((block_end - self.cut_block_start) / block_extent).clamp(0.0, 1.0);
        if normalized_start >= normalized_end {
            return Ok(None);
        }
        let contour = geometry.retained_vertices(self.contour_start, self.contour_count)?;
        let Some(projection) = polygon_projection(contour, normalized_start, normalized_end)?
        else {
            return Ok(None);
        };
        let inline_extent = self.cut.end - self.cut.start;
        Ok(Some(InlineCut {
            start: self.cut.start + projection.start * inline_extent,
            end: self.cut.start + projection.end * inline_extent,
            wrap_side: self.cut.wrap_side,
        }))
    }

    fn align_to_body_baseline(&mut self, baseline: f64) {
        if self.alignment != DROP_CAP_ALIGN_BASELINE {
            return;
        }
        self.line.block_start = baseline + self.ink_block_start;
        self.line.baseline = -self.ink_block_start;
        self.cut_block_start = baseline + self.ink_block_start - self.margin_block;
        self.cut_block_end = self
            .cut_block_end
            .max(baseline + self.ink_block_end + self.margin_block);
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EllipsisTarget {
    pub fragment_index: u32,
    pub line_cluster_start: u32,
    pub boundary_cluster_start: u32,
    pub cluster_end: u32,
    pub text_end: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EllipsisReplacement {
    pub cluster_start: usize,
    pub advance_adjustment: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct LineExtents {
    above: f64,
    below: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct ClusterLineMetrics {
    extents: LineExtents,
    cap_height: f64,
    baseline_shift: f64,
}

impl LineExtents {
    fn height(self) -> f64 {
        self.above + self.below
    }

    fn include(&mut self, other: Self) {
        self.above = self.above.max(other.above);
        self.below = self.below.max(other.below);
    }
}

#[derive(Clone, Copy)]
struct DropCapEnvelope {
    inline_start: f64,
    inline_end: f64,
    block_start: f64,
    block_end: f64,
    advance: f64,
}

#[allow(clippy::too_many_arguments)]
fn prepare_drop_cap(
    constraint: FlowConstraint,
    region: super::semantic_wire::FlowRegion,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    paragraph_level: u8,
    body_block_start: f64,
    styles: &[StyleSegment],
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
) -> Result<Option<FlowDropCap>, EngineError> {
    if constraint.drop_cap_lines == 0
        || constraint.resume_cluster != 0
        || constraint.resume_region != 0
        || clusters.starts.len() < 2
        || clusters.flags[0] & (CLUSTER_HARD_BREAK | CLUSTER_SPACE) != 0
        || region.writing_mode != WRITING_HORIZONTAL_TB
    {
        return Ok(None);
    }
    let search_end = clusters
        .starts
        .len()
        .saturating_sub(1)
        .min(DROP_CAP_MAX_CLUSTERS);
    let Some(cluster_end) =
        (1..=search_end).find(|cluster| clusters.flags[*cluster] & CLUSTER_SAFE_BEFORE != 0)
    else {
        return Ok(None);
    };
    if clusters.flags[..cluster_end]
        .iter()
        .any(|flags| flags & CLUSTER_HARD_BREAK != 0)
    {
        return Ok(None);
    }
    let envelope = drop_cap_envelope(clusters, runs, cluster_end)?;
    if envelope.advance <= 0.0 {
        return Ok(None);
    }
    let body_metrics = line_metrics_for_cluster(
        clusters,
        styles,
        cluster_end,
        metrics_for,
        first_font_for_stack,
    )?;
    let body_extents = positive_extents(body_metrics.extents, styles, clusters, cluster_end)?;
    let cap_over = cap_over_alignment_for_cluster(clusters, styles, 0, metrics_for)?;
    let inline_start = f64::from(region.inline_start);
    let inline_end = f64::from(region.inline_end);
    let margin_inline = f64::from(constraint.drop_cap_margin_inline);
    let margin_block = f64::from(constraint.drop_cap_margin_block);
    let logical_start = constraint.drop_cap_side == DROP_CAP_SIDE_INLINE_START;
    let physical_start = logical_start == (paragraph_level & 1 == 0);
    let pen = if physical_start {
        inline_start - envelope.inline_start
    } else {
        inline_end - envelope.inline_end
    };
    let cut = if physical_start {
        InlineCut {
            start: inline_start,
            end: pen + envelope.inline_end + margin_inline,
            wrap_side: EXCLUSION_WRAP_INLINE_END,
        }
    } else {
        InlineCut {
            start: pen + envelope.inline_start - margin_inline,
            end: inline_end,
            wrap_side: EXCLUSION_WRAP_INLINE_START,
        }
    };
    if !pen.is_finite()
        || !cut.start.is_finite()
        || !cut.end.is_finite()
        || cut.start >= cut.end
        || cut.end - cut.start >= inline_end - inline_start
    {
        return Ok(None);
    }
    let baseline = match constraint.drop_cap_alignment {
        DROP_CAP_ALIGN_TEXT_TOP => {
            let body_cap_start = body_block_start + body_extents.above
                - body_metrics.baseline_shift
                - body_metrics.cap_height;
            body_cap_start + cap_over
        }
        DROP_CAP_ALIGN_BASELINE => body_block_start + body_extents.above,
        _ => return Err(EngineError::InvalidRequest),
    };
    let line_height = envelope.block_end - envelope.block_start;
    let minimum_block_end =
        body_block_start + body_extents.height() * f64::from(constraint.drop_cap_lines);
    let line = FlowLine {
        flow_thread_id: constraint.flow_thread_id,
        region_id: region.id,
        transform_index: region.transform_index,
        clip_id: if constraint.overflow == OVERFLOW_CLIP {
            region.id
        } else {
            0
        },
        fragment_count: 1,
        align: ALIGN_START,
        block_start: baseline + envelope.block_start,
        baseline: -envelope.block_start,
        height: line_height,
    };
    let fragment = FlowFragment {
        line: ComposedLine {
            cluster_start: 0,
            cluster_end: u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?,
            text_start: clusters.starts[0],
            text_end: clusters.ends[cluster_end - 1],
            advance: envelope.advance,
            hung_advance: 0.0,
            hard_break: false,
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        },
        slot_start: pen,
        slot_end: pen + envelope.advance,
        flexible_end: false,
        boundary_index: NO_BOUNDARY,
        lead_index: NO_BOUNDARY,
        tail_index: NO_BOUNDARY,
    };
    Ok(Some(FlowDropCap {
        body_resume_cluster: fragment.line.cluster_end,
        line,
        fragment,
        cut,
        cut_block_start: line.block_start - margin_block,
        cut_block_end: (line.block_start + line.height + margin_block).max(minimum_block_end),
        lines: constraint.drop_cap_lines,
        alignment: constraint.drop_cap_alignment,
        ink_block_start: envelope.block_start,
        ink_block_end: envelope.block_end,
        margin_block,
        contour_start: constraint.drop_cap_vertices_offset,
        contour_count: constraint.drop_cap_vertex_count,
    }))
}

fn drop_cap_envelope(
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    cluster_end: usize,
) -> Result<DropCapEnvelope, EngineError> {
    let mut inline_start = 0.0_f64;
    let mut inline_end = 0.0_f64;
    let mut block_start = f64::INFINITY;
    let mut block_end = f64::NEG_INFINITY;
    let mut negative_prefix = 0.0_f64;
    let mut positive_prefix = 0.0_f64;
    let layout_runs = clusters.layout_runs();
    for cluster in 0..cluster_end {
        let run_index = layout_runs.partition_point(|run| run.cluster_end <= cluster as u32);
        let run = *layout_runs
            .get(run_index)
            .filter(|run| run.cluster_start <= cluster as u32)
            .ok_or(EngineError::InvalidRequest)?;
        let direction = runs
            .get(usize::try_from(run.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .map(|run| run.direction)
            .ok_or(EngineError::InvalidRequest)?;
        let placement = clusters.placement_cluster(run, direction, cluster)?;
        let advance = clusters.advances[cluster];
        let mut cluster_inline_start = 0.0_f64.min(advance);
        let mut cluster_inline_end = 0.0_f64.max(advance);
        let glyph_start = usize::try_from(clusters.glyph_starts[cluster])
            .map_err(|_| EngineError::InvalidRequest)?;
        let glyph_end = glyph_start
            .checked_add(
                usize::try_from(clusters.glyph_counts[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::ResultTooLarge)?;
        for source_glyph in glyph_start..glyph_end {
            let row = clusters
                .run_local()
                .row_for_source_glyph(
                    u32::try_from(source_glyph).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            let origin = f64::from(row.inline_origin) + placement.block_anchor_inline
                - placement.block_local_prefix;
            cluster_inline_start = cluster_inline_start.min(origin);
            cluster_inline_end = cluster_inline_end.max(origin + f64::from(row.inline_advance));
            let origin_block = f64::from(row.block_origin) + placement.block_anchor_block;
            block_start = block_start.min(origin_block);
            block_end = block_end.max(origin_block);
            if row.has_outline {
                let ink_inline = f64::from(row.ink_inline_start) + placement.block_anchor_inline
                    - placement.block_local_prefix;
                cluster_inline_start = cluster_inline_start.min(ink_inline);
                cluster_inline_end =
                    cluster_inline_end.max(ink_inline + f64::from(row.ink_inline_extent));
                let ink_block = f64::from(row.ink_block_start) + placement.block_anchor_block;
                block_start = block_start.min(ink_block);
                block_end = block_end.max(ink_block + f64::from(row.ink_block_extent));
            }
        }
        inline_start = inline_start.min(negative_prefix + cluster_inline_start);
        inline_end = inline_end.max(positive_prefix + cluster_inline_end);
        negative_prefix += advance.min(0.0);
        positive_prefix += advance.max(0.0);
    }
    let advance = clusters.advances[..cluster_end]
        .iter()
        .copied()
        .sum::<f64>();
    if !inline_start.is_finite()
        || !inline_end.is_finite()
        || !block_start.is_finite()
        || !block_end.is_finite()
        || !advance.is_finite()
        || inline_start > inline_end
        || block_start > block_end
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(DropCapEnvelope {
        inline_start,
        inline_end,
        block_start,
        block_end,
        advance,
    })
}

#[derive(Default)]
pub(crate) struct FlowLayoutArena {
    pub lines: RetainedRope<FlowLine>,
    pub fragments: RetainedRope<FlowFragment>,
    pub drop_caps: Vec<FlowDropCap>,
    pub(crate) ellipsis_threads: Vec<u32>,
    // Candidate-owned scratch; retained=false revokes authority without dropping capacity.
    pub(crate) recomposed_lines: Vec<Range<usize>>,
    pub(crate) recomposed_lines_retained: bool,
}

impl FlowLayoutArena {
    pub(crate) fn reserve(
        &mut self,
        line_capacity: usize,
        _fragment_capacity: usize,
    ) -> Result<(), EngineError> {
        reserve(&mut self.drop_caps, 1)?;
        reserve(&mut self.ellipsis_threads, line_capacity)
    }

    fn append_reconciled_drop_caps(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        flow_thread_id: u32,
        replacement: Option<FlowDropCap>,
    ) -> Result<(), EngineError> {
        if !self.drop_caps.is_empty() {
            return Err(EngineError::InvalidRequest);
        }
        let previous_has_replacement = previous
            .drop_caps
            .iter()
            .any(|cap| cap.line.flow_thread_id == flow_thread_id);
        let capacity = previous
            .drop_caps
            .len()
            .checked_add(usize::from(
                replacement.is_some() && !previous_has_replacement,
            ))
            .ok_or(EngineError::ResultTooLarge)?;
        reserve(&mut self.drop_caps, capacity)?;

        let mut previous_index = 0;
        for constraint in &geometry.constraints {
            let previous_cap = previous
                .drop_caps
                .get(previous_index)
                .copied()
                .filter(|cap| cap.line.flow_thread_id == constraint.flow_thread_id);
            if constraint.flow_thread_id == flow_thread_id {
                previous_index += usize::from(previous_cap.is_some());
                if let Some(cap) = replacement {
                    self.drop_caps.push(cap);
                }
            } else if let Some(cap) = previous_cap {
                self.drop_caps.push(cap);
                previous_index += 1;
            }
        }
        if previous_index != previous.drop_caps.len() {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        &mut self,
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
    ) -> Result<(), EngineError> {
        self.build_with_drop_cap_context(
            geometry,
            clusters,
            &[],
            styles,
            slots,
            0,
            max_lines,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
            &mut super::line_composition::NoCorrections,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_with_drop_cap_context(
        &mut self,
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        paragraph_level: u8,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<(), EngineError> {
        self.clear();
        if clusters.starts.is_empty() || geometry.constraints.is_empty() {
            return Ok(());
        }
        // Limits reject excess work; they are not allocation requests. A line consumes at
        // least one cluster, and ordinary lines need one fragment. Exceptional flows grow.
        let likely_lines = clusters.starts.len().min(max_lines);
        self.reserve(likely_lines, likely_lines)?;
        for constraint in geometry.constraints.iter().copied() {
            let region_start = usize::try_from(constraint.region_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let first_region = region_start
                .checked_add(usize::from(constraint.resume_region))
                .ok_or(EngineError::InvalidRequest)?;
            let region_end = region_start
                .checked_add(usize::from(constraint.region_count))
                .ok_or(EngineError::InvalidRequest)?;
            let first_region_record = geometry
                .regions
                .get(first_region)
                .ok_or(EngineError::InvalidRequest)?
                .record;
            let mut first_block = f64::from(first_region_record.block_start);
            first_block += f64::from(constraint.resume_block_offset);
            if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
                first_block += f64::from(constraint.space_before);
            }
            let mut drop_cap = prepare_drop_cap(
                constraint,
                first_region_record,
                clusters,
                runs,
                paragraph_level,
                first_block,
                styles,
                metrics_for,
                first_font_for_stack,
            )?;
            let resume = if let Some(cap) = drop_cap.as_ref() {
                usize::try_from(cap.body_resume_cluster).map_err(|_| EngineError::InvalidRequest)?
            } else {
                cluster_for_offset(clusters, constraint.resume_cluster)?
            };
            let mut cursor = LineCursor::at_cluster(resume);
            if constraint.wrap == WRAP_WORD {
                cursor.start_correction = corrections.right(resume)?;
            }
            let constraint_line_limit = if constraint.max_lines == 0 {
                max_lines
            } else {
                usize::try_from(constraint.max_lines)
                    .map_err(|_| EngineError::ResultTooLarge)?
                    .min(max_lines)
            };
            let thread_line_start = self.lines.len();
            for region_index in first_region..region_end {
                if cursor.is_complete(clusters.starts.len())
                    || self.lines.len().saturating_sub(thread_line_start) >= constraint_line_limit
                {
                    break;
                }
                let region = geometry
                    .regions
                    .get(region_index)
                    .ok_or(EngineError::InvalidRequest)?;
                if region.record.writing_mode != WRITING_HORIZONTAL_TB {
                    return Err(EngineError::InvalidRequest);
                }
                let mut block = f64::from(region.record.block_start);
                if region_index == first_region {
                    block += f64::from(constraint.resume_block_offset);
                    // Paragraph space-before applies once, where the thread truly
                    // starts; a resumed thread or a region break swallows it.
                    if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
                        block += f64::from(constraint.space_before);
                    }
                }
                let block_end = f64::from(region.record.block_end);
                while !cursor.is_complete(clusters.starts.len())
                    && self.lines.len().saturating_sub(thread_line_start) < constraint_line_limit
                    && self.lines.len() < max_lines
                    && block < block_end
                {
                    let estimate = extents_for_cluster(
                        clusters,
                        styles,
                        cursor
                            .cluster()
                            .min(clusters.starts.len().saturating_sub(1)),
                        metrics_for,
                        first_font_for_stack,
                    )?;
                    let estimate = positive_extents(estimate, styles, clusters, cursor.cluster())?;
                    match self.compose_band(
                        geometry,
                        region_index,
                        constraint.flow_thread_id,
                        region.record.id,
                        region.record.transform_index,
                        if constraint.overflow == OVERFLOW_CLIP {
                            region.record.id
                        } else {
                            0
                        },
                        clusters,
                        styles,
                        slots,
                        &mut cursor,
                        block,
                        block_end,
                        estimate,
                        match drop_cap.as_ref() {
                            Some(cap) => cap.cut_for_band(
                                geometry,
                                self.lines.len().saturating_sub(thread_line_start),
                                block,
                                block + estimate.height(),
                            )?,
                            None => None,
                        },
                        constraint.wrap,
                        constraint.align,
                        constraint.width_mode != AXIS_EXACT,
                        f64::from(constraint.first_line_indent),
                        constraint_word_space_shrink(&constraint),
                        max_slots_per_band,
                        metrics_for,
                        first_font_for_stack,
                        corrections,
                    )? {
                        Some(height) => {
                            if self.lines.len() == thread_line_start + 1
                                && let (Some(cap), Some(line)) =
                                    (drop_cap.as_mut(), self.lines.iter().next_back())
                            {
                                cap.align_to_body_baseline(line.block_start + line.baseline);
                            }
                            block += height;
                        }
                        None => block += estimate.height(),
                    }
                }
            }
            if constraint.overflow == OVERFLOW_ELLIPSIS {
                let final_fragment_overflows = self.lines.iter().next_back().is_some_and(|line| {
                    line.flow_thread_id == constraint.flow_thread_id
                        && self
                            .line_fragment_start(self.lines.len().saturating_sub(1))
                            .and_then(|start| start.checked_add(usize::from(line.fragment_count)))
                            .and_then(|end| end.checked_sub(1))
                            .and_then(|index| self.fragments.get(index))
                            .is_some_and(|fragment| {
                                fragment.line.advance > fragment.slot_end - fragment.slot_start
                            })
                });
                if (!cursor.is_complete(clusters.starts.len()) || final_fragment_overflows)
                    && self.lines.len() > thread_line_start
                {
                    self.ellipsis_threads.push(constraint.flow_thread_id);
                }
            }
            if constraint.width_mode != AXIS_EXACT {
                self.resolve_flexible_inline_end(
                    constraint.flow_thread_id,
                    f64::from(constraint.first_line_indent),
                    flexible_inline_limit(&constraint),
                )?;
            }
            if self.lines.len() > thread_line_start
                && let Some(cap) = drop_cap
            {
                self.drop_caps.push(cap);
            }
        }
        Ok(())
    }

    fn supports_local_convergence(
        previous: &Self,
        max_lines: usize,
        max_slots_per_band: usize,
    ) -> bool {
        previous.ellipsis_threads.is_empty()
            && !previous.lines.is_empty()
            && previous.lines.len() <= max_lines
            && previous
                .lines
                .iter()
                .all(|line| usize::from(line.fragment_count) <= max_slots_per_band)
    }

    #[allow(clippy::too_many_arguments)]
    fn convergence_context(
        previous: &Self,
        geometry: &FlowGeometryArena,
        constraint: FlowConstraint,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        paragraph_level: u8,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
    ) -> Result<(Option<FlowDropCap>, Option<FlowDropCap>, usize), EngineError> {
        let region_start =
            usize::try_from(constraint.region_start).map_err(|_| EngineError::InvalidRequest)?;
        let first_region_index = region_start
            .checked_add(usize::from(constraint.resume_region))
            .ok_or(EngineError::InvalidRequest)?;
        let first_region = geometry
            .regions
            .get(first_region_index)
            .ok_or(EngineError::InvalidRequest)?
            .record;
        let mut first_block =
            f64::from(first_region.block_start) + f64::from(constraint.resume_block_offset);
        if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
            first_block += f64::from(constraint.space_before);
        }
        let drop_cap = prepare_drop_cap(
            constraint,
            first_region,
            clusters,
            runs,
            paragraph_level,
            first_block,
            styles,
            metrics_for,
            first_font_for_stack,
        )?;
        let previous_cap = previous
            .drop_caps
            .iter()
            .copied()
            .find(|cap| cap.line.flow_thread_id == constraint.flow_thread_id);
        let thread_line_start = previous
            .lines
            .iter()
            .position(|line| line.flow_thread_id == constraint.flow_thread_id)
            .ok_or(EngineError::InvalidRequest)?;
        Ok((drop_cap, previous_cap, thread_line_start))
    }

    fn append_converged_suffix(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        flow_thread_id: u32,
        replacement_cap: Option<FlowDropCap>,
        converged_line: usize,
    ) -> Result<(), EngineError> {
        self.append_retained_range(previous, converged_line + 1..previous.lines.len())?;
        self.append_reconciled_drop_caps(previous, geometry, flow_thread_id, replacement_cap)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn rebuild_until_state_converges(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        previous_clusters: &ClusterArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        dirty_ranges: impl IntoIterator<Item = Range<u32>>,
        paragraph_level: u8,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<bool, EngineError> {
        self.clear();
        if !Self::supports_local_convergence(previous, max_lines, max_slots_per_band)
            || previous_clusters.starts.len() != clusters.starts.len()
        {
            return Ok(false);
        }
        let mut dirty_ranges = dirty_ranges.into_iter().peekable();
        let Some(mut dirty) = dirty_ranges.next() else {
            return Ok(false);
        };
        if dirty.start >= dirty.end {
            return Ok(false);
        }
        let edited_cap = previous.drop_caps.iter().copied().find(|cap| {
            cap.fragment.line.text_start <= dirty.start
                && dirty.start
                    < cap
                        .fragment
                        .line
                        .text_end
                        .max(cap.fragment.line.text_start.saturating_add(1))
        });
        let edited_line = previous.source_restart_line(dirty.start);
        let Some(mut line_index) = edited_cap
            .and_then(|cap| {
                previous
                    .lines
                    .iter()
                    .position(|line| line.flow_thread_id == cap.line.flow_thread_id)
            })
            .or(edited_line)
        else {
            return Ok(false);
        };
        let flow_thread_id = edited_cap
            .map(|cap| cap.line.flow_thread_id)
            .unwrap_or(previous.lines[line_index].flow_thread_id);
        let constraint = *geometry
            .constraints
            .iter()
            .find(|constraint| constraint.flow_thread_id == flow_thread_id)
            .ok_or(EngineError::InvalidRequest)?;
        let (mut drop_cap, previous_cap, thread_line_start) = Self::convergence_context(
            previous,
            geometry,
            constraint,
            clusters,
            runs,
            styles,
            paragraph_level,
            metrics_for,
            first_font_for_stack,
        )?;
        if edited_cap.is_some() || previous_cap != drop_cap {
            line_index = thread_line_start;
        }
        let mut retained_line_cursor = 0usize;
        loop {
            if previous.lines[line_index].flow_thread_id != flow_thread_id {
                self.clear();
                return Ok(false);
            }
            let first_fragments = line_fragments(previous, line_index)?;
            let Some(first_fragment) = first_fragments.first() else {
                self.clear();
                return Ok(false);
            };
            let cluster_start = if line_index == thread_line_start {
                match drop_cap.as_ref() {
                    Some(cap) => usize::try_from(cap.body_resume_cluster)
                        .map_err(|_| EngineError::InvalidRequest)?,
                    None => cluster_for_offset(clusters, constraint.resume_cluster)?,
                }
            } else {
                usize::try_from(first_fragment.line.cluster_start)
                    .map_err(|_| EngineError::InvalidRequest)?
            };
            if previous_cap == drop_cap
                && previous_clusters.stable_ids.get(cluster_start)
                    != clusters.stable_ids.get(cluster_start)
            {
                self.clear();
                return Ok(false);
            }
            self.append_retained_range(previous, retained_line_cursor..line_index)?;
            let mut cursor = LineCursor::at_cluster(cluster_start);
            if constraint.wrap == WRAP_WORD {
                cursor.start_correction = corrections.right(cluster_start)?;
            }
            let mut converged_line = None;
            let candidate_lines = previous
                .lines
                .range(line_index..previous.lines.len())
                .ok_or(EngineError::InvalidRequest)?;
            let next_lines = candidate_lines
                .iter()
                .copied()
                .skip(1)
                .map(Some)
                .chain(core::iter::once(None));
            let previous_fragment_start = previous
                .line_fragment_start(line_index)
                .ok_or(EngineError::InvalidRequest)?;
            let mut previous_fragment_cursor = previous
                .fragments
                .cursor_from(previous_fragment_start)
                .ok_or(EngineError::InvalidRequest)?;
            for (offset, (old_line, next_line)) in
                candidate_lines.iter().copied().zip(next_lines).enumerate()
            {
                let candidate = line_index
                    .checked_add(offset)
                    .ok_or(EngineError::ResultTooLarge)?;
                if old_line.flow_thread_id != flow_thread_id {
                    self.clear();
                    return Ok(false);
                }
                let old_fragments = previous_fragment_cursor
                    .take(usize::from(old_line.fragment_count))
                    .ok_or(EngineError::InvalidRequest)?;
                let old_last = old_fragments.last().ok_or(EngineError::InvalidRequest)?;
                let old_cluster_end = usize::try_from(old_last.line.cluster_end)
                    .map_err(|_| EngineError::InvalidRequest)?;
                while dirty_ranges
                    .peek()
                    .is_some_and(|next| next.start <= old_last.line.text_end)
                {
                    let next = dirty_ranges.next().ok_or(EngineError::InvalidRequest)?;
                    if next.start < dirty.end || next.start >= next.end {
                        self.clear();
                        return Ok(false);
                    }
                    dirty.end = dirty.end.max(next.end);
                }
                let Some(region_index) = geometry
                    .regions
                    .iter()
                    .position(|region| region.record.id == old_line.region_id)
                else {
                    self.clear();
                    return Ok(false);
                };
                let region = geometry
                    .regions
                    .get(region_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let Some(height) = self.compose_band(
                    geometry,
                    region_index,
                    old_line.flow_thread_id,
                    old_line.region_id,
                    old_line.transform_index,
                    old_line.clip_id,
                    clusters,
                    styles,
                    slots,
                    &mut cursor,
                    old_line.block_start,
                    f64::from(region.record.block_end),
                    LineExtents {
                        above: old_line.baseline,
                        below: old_line.height - old_line.baseline,
                    },
                    match drop_cap.as_ref() {
                        Some(cap) => cap.cut_for_band(
                            geometry,
                            candidate.saturating_sub(thread_line_start),
                            old_line.block_start,
                            old_line.block_start + old_line.height,
                        )?,
                        None => None,
                    },
                    wrapping_for_flow_thread(geometry, old_line.flow_thread_id)?,
                    old_line.align,
                    flexible_for_flow_thread(geometry, old_line.flow_thread_id)?,
                    indent_for_flow_thread(geometry, old_line.flow_thread_id)?,
                    shrink_for_flow_thread(geometry, old_line.flow_thread_id)?,
                    max_slots_per_band,
                    metrics_for,
                    first_font_for_stack,
                    corrections,
                )?
                else {
                    self.clear();
                    return Ok(false);
                };
                let new_line = *self
                    .lines
                    .iter()
                    .next_back()
                    .ok_or(EngineError::InvalidRequest)?;
                if candidate == thread_line_start
                    && let Some(cap) = drop_cap.as_mut()
                {
                    cap.align_to_body_baseline(new_line.block_start + new_line.baseline);
                }
                let metrics_stable =
                    height == old_line.height && new_line.baseline == old_line.baseline;
                let next_cap_affected = if let Some(next) = next_line {
                    let ordinal = candidate + 1 - thread_line_start;
                    let previous_affected = if let Some(cap) = previous_cap {
                        cap.cut_for_band(
                            geometry,
                            ordinal,
                            next.block_start,
                            next.block_start + next.height,
                        )?
                        .is_some()
                    } else {
                        false
                    };
                    let pending_affected = if let Some(cap) = drop_cap {
                        cap.cut_for_band(
                            geometry,
                            ordinal,
                            next.block_start,
                            next.block_start + next.height,
                        )?
                        .is_some()
                    } else {
                        false
                    };
                    previous_affected || pending_affected
                } else {
                    false
                };
                let old_start = previous_clusters
                    .break_corrections
                    .get(old_cluster_end.wrapping_sub(1));
                let unmoved = cursor.start_correction
                    == old_start
                        .and_then(|state| state[1].get())
                        .unwrap_or_default();
                #[cfg(test)]
                super::work_attribution::record(|work| {
                    work.flow_convergence_checks += 1;
                    work.flow_dirty_end_blocks += usize::from(old_last.line.text_end < dirty.end);
                    work.flow_cursor_mismatches += usize::from(cursor.cluster() != old_cluster_end);
                    work.flow_correction_mismatches += usize::from(!unmoved);
                    work.flow_metric_mismatches += usize::from(!metrics_stable);
                    work.flow_drop_cap_blocks += usize::from(next_cap_affected);
                });
                if old_last.line.text_end >= dirty.end
                    && metrics_stable
                    && cursor.cluster() == old_cluster_end
                    && unmoved
                    && !next_cap_affected
                {
                    converged_line = Some(candidate);
                    break;
                }
                if !metrics_stable {
                    self.clear();
                    return Ok(false);
                }
            }
            let Some(candidate) = converged_line else {
                self.clear();
                return Ok(false);
            };
            self.mark_recomposed_lines(line_index..candidate + 1)?;
            retained_line_cursor = candidate + 1;
            let Some(next_dirty) = dirty_ranges.next() else {
                self.append_retained_range(previous, retained_line_cursor..previous.lines.len())?;
                self.append_reconciled_drop_caps(previous, geometry, flow_thread_id, drop_cap)?;
                let previous_flexible_end = previous.flexible_inline_end(flow_thread_id);
                let next_flexible_end = if flexible_for_flow_thread(geometry, flow_thread_id)? {
                    self.resolve_flexible_inline_end(
                        flow_thread_id,
                        indent_for_flow_thread(geometry, flow_thread_id)?,
                        inline_limit_for_flow_thread(geometry, flow_thread_id)?,
                    )?
                } else {
                    None
                };
                if previous_flexible_end.map(f64::to_bits) != next_flexible_end.map(f64::to_bits) {
                    self.recomposed_lines.clear();
                    self.recomposed_lines_retained = false;
                    if let Some((start, end)) = self.flow_thread_line_range(flow_thread_id) {
                        self.mark_recomposed_lines(start..end)?;
                    }
                }
                return Ok(true);
            };
            if next_dirty.start < dirty.end || next_dirty.start >= next_dirty.end {
                self.clear();
                return Ok(false);
            }
            dirty = next_dirty;
            let Some(next_line) = previous.source_restart_line(dirty.start) else {
                self.clear();
                return Ok(false);
            };
            if next_line < retained_line_cursor
                || previous.lines[next_line].flow_thread_id != flow_thread_id
            {
                self.clear();
                return Ok(false);
            }
            line_index = next_line;
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn rebuild_after_exclusion_change_until_state_converges(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        dirty: ExclusionDirtyBand,
        paragraph_level: u8,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<bool, EngineError> {
        self.clear();
        if !Self::supports_local_convergence(previous, max_lines, max_slots_per_band) {
            return Ok(false);
        }
        let Some(region_index) = geometry
            .regions
            .iter()
            .position(|region| region.record.id == dirty.region_id)
        else {
            return Ok(false);
        };
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?;
        let Some(constraint) = geometry.constraints.iter().copied().find(|constraint| {
            let Ok(start) = usize::try_from(constraint.region_start) else {
                return false;
            };
            start <= region_index
                && region_index < start.saturating_add(usize::from(constraint.region_count))
        }) else {
            return Ok(false);
        };
        if constraint.width_mode != AXIS_EXACT || constraint.overflow == OVERFLOW_ELLIPSIS {
            return Ok(false);
        }
        let (mut drop_cap, _, thread_line_start) = Self::convergence_context(
            previous,
            geometry,
            constraint,
            clusters,
            runs,
            styles,
            paragraph_level,
            metrics_for,
            first_font_for_stack,
        )?;
        let Some(region_line_start) = previous
            .lines
            .iter()
            .position(|line| line.region_id == dirty.region_id)
        else {
            return Ok(false);
        };
        let region_line_end = previous
            .lines
            .iter()
            .rposition(|line| line.region_id == dirty.region_id)
            .ok_or(EngineError::InvalidRequest)?
            .checked_add(1)
            .ok_or(EngineError::ResultTooLarge)?;
        if previous
            .lines
            .range(region_line_start..region_line_end)
            .ok_or(EngineError::InvalidRequest)?
            .iter()
            .any(|line| {
                line.region_id != dirty.region_id
                    || line.flow_thread_id != constraint.flow_thread_id
            })
        {
            return Ok(false);
        }
        let mut prefix_end = region_line_start;
        let mut last_prefix_line = None;
        for line in previous
            .lines
            .range(region_line_start..region_line_end)
            .ok_or(EngineError::InvalidRequest)?
            .iter()
            .copied()
        {
            if line.region_id != dirty.region_id
                || line.block_start + line.height > dirty.block_start
            {
                break;
            }
            prefix_end = prefix_end
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            last_prefix_line = Some(line);
        }
        self.reserve(previous.lines.len(), previous.fragments.len())?;
        reserve(&mut self.drop_caps, previous.drop_caps.len().max(1))?;
        self.append_retained_range(previous, 0..prefix_end)?;
        if let Some(cap) = drop_cap.as_mut()
            && let Some(first_line) = self
                .lines
                .iter()
                .find(|line| line.flow_thread_id == constraint.flow_thread_id)
        {
            cap.align_to_body_baseline(first_line.block_start + first_line.baseline);
        }
        let previous_thread_line = previous
            .lines
            .range(0..prefix_end)
            .ok_or(EngineError::InvalidRequest)?
            .iter()
            .rposition(|line| line.flow_thread_id == constraint.flow_thread_id);
        let cursor_start = if let Some(line_index) = previous_thread_line {
            line_fragments(previous, line_index)?
                .last()
                .and_then(|fragment| usize::try_from(fragment.line.cluster_end).ok())
                .ok_or(EngineError::InvalidRequest)?
        } else {
            if let Some(cap) = drop_cap.as_ref() {
                usize::try_from(cap.body_resume_cluster).map_err(|_| EngineError::InvalidRequest)?
            } else {
                cluster_for_offset(clusters, constraint.resume_cluster)?
            }
        };
        let mut cursor = LineCursor::at_cluster(cursor_start);
        if constraint.wrap == WRAP_WORD {
            cursor.start_correction = corrections.right(cursor_start)?;
        }
        let mut block = if let Some(line) = last_prefix_line {
            line.block_start + line.height
        } else {
            let constraint_region_start = usize::try_from(constraint.region_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let first_region = constraint_region_start
                .checked_add(usize::from(constraint.resume_region))
                .ok_or(EngineError::InvalidRequest)?;
            let mut start = f64::from(region.record.block_start);
            if region_index == first_region {
                start += f64::from(constraint.resume_block_offset);
                if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
                    start += f64::from(constraint.space_before);
                }
            }
            start
        };
        let constraint_line_limit = if constraint.max_lines == 0 {
            max_lines
        } else {
            usize::try_from(constraint.max_lines)
                .map_err(|_| EngineError::ResultTooLarge)?
                .min(max_lines)
        };
        let previous_fragment_start = previous
            .line_fragment_start(prefix_end)
            .ok_or(EngineError::InvalidRequest)?;
        let mut old_line_search = previous
            .lines
            .cursor_from(prefix_end)
            .ok_or(EngineError::InvalidRequest)?;
        let mut old_fragment_search = previous
            .fragments
            .cursor_from(previous_fragment_start)
            .ok_or(EngineError::InvalidRequest)?;
        let mut next_old_index = prefix_end;
        let mut old_candidate = None;
        let block_end = f64::from(region.record.block_end);
        while !cursor.is_complete(clusters.starts.len())
            && self.lines.len().saturating_sub(thread_line_start) < constraint_line_limit
            && self.lines.len() < max_lines
            && block < block_end
        {
            let estimate = extents_for_cluster(
                clusters,
                styles,
                cursor
                    .cluster()
                    .min(clusters.starts.len().saturating_sub(1)),
                metrics_for,
                first_font_for_stack,
            )?;
            let estimate = positive_extents(estimate, styles, clusters, cursor.cluster())?;
            let composed_block = block;
            let Some(height) = self.compose_band(
                geometry,
                region_index,
                constraint.flow_thread_id,
                region.record.id,
                region.record.transform_index,
                if constraint.overflow == OVERFLOW_CLIP {
                    region.record.id
                } else {
                    0
                },
                clusters,
                styles,
                slots,
                &mut cursor,
                block,
                block_end,
                estimate,
                match drop_cap.as_ref() {
                    Some(cap) => cap.cut_for_band(
                        geometry,
                        self.lines.len().saturating_sub(thread_line_start),
                        block,
                        block + estimate.height(),
                    )?,
                    None => None,
                },
                constraint.wrap,
                constraint.align,
                false,
                f64::from(constraint.first_line_indent),
                constraint_word_space_shrink(&constraint),
                max_slots_per_band,
                metrics_for,
                first_font_for_stack,
                corrections,
            )?
            else {
                block += estimate.height();
                continue;
            };
            if self.lines.len() == thread_line_start + 1
                && let (Some(cap), Some(line)) = (drop_cap.as_mut(), self.lines.iter().next_back())
            {
                cap.align_to_body_baseline(line.block_start + line.baseline);
            }
            block += height;
            if composed_block < dirty.block_end {
                continue;
            }
            loop {
                if old_candidate.is_none() && next_old_index < region_line_end {
                    let old_line = old_line_search
                        .take(1)
                        .and_then(|line| line.first().copied())
                        .ok_or(EngineError::InvalidRequest)?;
                    let old_fragments = old_fragment_search
                        .take(usize::from(old_line.fragment_count))
                        .ok_or(EngineError::InvalidRequest)?;
                    old_candidate = Some((next_old_index, old_line, old_fragments));
                    next_old_index = next_old_index
                        .checked_add(1)
                        .ok_or(EngineError::ResultTooLarge)?;
                }
                if old_candidate
                    .as_ref()
                    .is_some_and(|(_, line, _)| line.block_start < composed_block)
                {
                    old_candidate = None;
                    continue;
                }
                break;
            }
            let Some((old_line_index, old_line, old_fragments)) = old_candidate.as_ref() else {
                continue;
            };
            let new_line_index = self
                .lines
                .len()
                .checked_sub(1)
                .ok_or(EngineError::InvalidRequest)?;
            let new_line = self
                .lines
                .iter()
                .next_back()
                .copied()
                .ok_or(EngineError::InvalidRequest)?;
            let new_fragment_start = self
                .fragments
                .len()
                .checked_sub(usize::from(new_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            let new_fragments = self
                .fragments
                .range(new_fragment_start..self.fragments.len())
                .ok_or(EngineError::InvalidRequest)?;
            if *old_line_index != new_line_index
                || !same_flow_line_records(new_line, &new_fragments, *old_line, old_fragments)
            {
                continue;
            }
            self.append_converged_suffix(
                previous,
                geometry,
                constraint.flow_thread_id,
                drop_cap,
                *old_line_index,
            )?;
            self.mark_recomposed_lines(
                prefix_end
                    ..old_line_index
                        .checked_add(1)
                        .ok_or(EngineError::ResultTooLarge)?,
            )?;
            return Ok(true);
        }
        self.clear();
        Ok(false)
    }

    fn append_retained_range(
        &mut self,
        source: &Self,
        lines: core::ops::Range<usize>,
    ) -> Result<(), EngineError> {
        let fragment_start = source
            .line_fragment_start(lines.start)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_end = source
            .line_fragment_start(lines.end)
            .ok_or(EngineError::InvalidRequest)?;
        if !self
            .lines
            .append_shared_range(&source.lines, lines.clone())
            .map_err(|()| EngineError::ResultTooLarge)?
            || !self
                .fragments
                .append_shared_range(&source.fragments, fragment_start..fragment_end)
                .map_err(|()| EngineError::ResultTooLarge)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn compose_band(
        &mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        flow_thread_id: u32,
        region_id: u32,
        transform_index: u32,
        clip_id: u32,
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        slot_arena: &mut InlineSlotArena,
        cursor: &mut LineCursor,
        block_start: f64,
        region_block_end: f64,
        initial_extents: LineExtents,
        extra_cut: Option<InlineCut>,
        wrap: u8,
        align: u8,
        flexible_width: bool,
        first_line_indent: f64,
        word_space_shrink: f64,
        max_slots: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<Option<f64>, EngineError> {
        let saved_cursor = *cursor;
        let fragment_start = self.fragments.len();
        let mut extents = initial_extents;
        for attempt in 0..2 {
            let height = extents.height();
            if block_start + height > region_block_end {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                *cursor = saved_cursor;
                return Ok(None);
            }
            let available = slot_arena.resolve_band_with_cut(
                geometry,
                region_index,
                block_start,
                block_start + height,
                max_slots,
                extra_cut,
            )?;
            let region_inline_end = f64::from(
                geometry
                    .regions
                    .get(region_index)
                    .ok_or(EngineError::InvalidRequest)?
                    .record
                    .inline_end,
            );
            if available.is_empty() {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                *cursor = saved_cursor;
                return Ok(None);
            }
            // Seed from the estimate so valid negative half-leading is not clamped against zero.
            let mut measured = initial_extents;
            let mut composed = false;
            for slot in available.iter().copied() {
                // The paragraph's first line composes against an indented width;
                // positioning shifts the pen by the same amount on the
                // paragraph-direction side.
                let indent = if cursor.cluster() == 0 {
                    first_line_indent
                } else {
                    0.0
                };
                // Slice 2b of the integer-layout-units plan: the available width
                // quantizes to F16.16 once at this boundary and the integer fit is
                // authoritative; the f64 twin remains only as the parity reference.
                let Some(line) = layout_next_line_integer(
                    clusters,
                    cursor,
                    Some(super::layout_units::layout_units_from_scaled(
                        (slot.end - slot.start - indent).max(0.0),
                    )),
                    wrap,
                    word_space_shrink,
                    &mut *corrections,
                )?
                else {
                    break;
                };
                include_range_extents(
                    &mut measured,
                    clusters,
                    styles,
                    line,
                    metrics_for,
                    first_font_for_stack,
                )?;
                self.fragments
                    .push(FlowFragment {
                        line,
                        slot_start: slot.start,
                        slot_end: slot.end,
                        flexible_end: flexible_width && slot.end == region_inline_end,
                        boundary_index: NO_BOUNDARY,
                        lead_index: NO_BOUNDARY,
                        tail_index: NO_BOUNDARY,
                    })
                    .map_err(|()| EngineError::ResultTooLarge)?;
                composed = true;
                if line.hard_break || cursor.is_complete(clusters.starts.len()) {
                    break;
                }
            }
            if !composed {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                *cursor = saved_cursor;
                return Ok(None);
            }
            if attempt == 0 && measured.height() > height {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                *cursor = saved_cursor;
                extents = measured;
                continue;
            }
            let fragment_count = self.fragments.len() - fragment_start;
            self.lines
                .push(FlowLine {
                    flow_thread_id,
                    region_id,
                    transform_index,
                    clip_id,
                    fragment_count: u16::try_from(fragment_count)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    align,
                    block_start,
                    baseline: extents.above,
                    height: extents.height(),
                })
                .map_err(|()| EngineError::ResultTooLarge)?;
            return Ok(Some(extents.height()));
        }
        Err(EngineError::InvalidRequest)
    }

    fn resolve_flexible_inline_end(
        &mut self,
        flow_thread_id: u32,
        first_line_indent: f64,
        inline_limit: Option<f64>,
    ) -> Result<Option<f64>, EngineError> {
        let mut content_end = f64::NEG_INFINITY;
        let mut found = false;
        let mut fragment_cursor = self
            .fragments
            .cursor_from(0)
            .ok_or(EngineError::InvalidRequest)?;
        for line in self.lines.iter().copied() {
            let fragments = fragment_cursor
                .take(usize::from(line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            if line.flow_thread_id != flow_thread_id {
                continue;
            }
            for fragment in fragments.iter() {
                found |= fragment.flexible_end;
                let indent = if fragment.line.cluster_start == 0 {
                    first_line_indent
                } else {
                    0.0
                };
                content_end = content_end.max(fragment.slot_start + indent + fragment.line.advance);
            }
        }
        if !fragment_cursor.is_empty() {
            return Err(EngineError::InvalidRequest);
        }
        if !found || !content_end.is_finite() {
            return Ok(None);
        }
        let resolved_end = inline_limit.map_or(content_end, |limit| content_end.min(limit));
        let mut fragment_lines = self.lines.iter().copied().flat_map(|line| {
            core::iter::repeat_n(line.flow_thread_id, usize::from(line.fragment_count))
        });
        let fragment_count = self.fragments.len();
        self.fragments
            .update_ordered(0..fragment_count, |_, fragment| {
                let fragment_thread = fragment_lines.next().ok_or(EngineError::InvalidRequest)?;
                if fragment_thread != flow_thread_id || !fragment.flexible_end {
                    return Ok(super::retained_rope::RopeUpdate::Keep);
                }
                let slot_end = resolved_end.max(fragment.slot_start);
                if slot_end.to_bits() == fragment.slot_end.to_bits() {
                    return Ok(super::retained_rope::RopeUpdate::Keep);
                }
                Ok(super::retained_rope::RopeUpdate::Replace(FlowFragment {
                    slot_end,
                    ..*fragment
                }))
            })
            .map_err(|error| match error {
                RopeEditError::Storage => EngineError::ResultTooLarge,
                RopeEditError::Callback(error) => error,
            })?;
        if fragment_lines.next().is_some() {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Some(resolved_end))
    }

    fn flexible_inline_end(&self, flow_thread_id: u32) -> Option<f64> {
        let mut fragment_cursor = self.fragments.cursor_from(0)?;
        let mut inline_end = None;
        for line in self.lines.iter().copied() {
            let fragments = fragment_cursor.take(usize::from(line.fragment_count))?;
            if line.flow_thread_id != flow_thread_id {
                continue;
            }
            if let Some(fragment) = fragments.iter().find(|fragment| fragment.flexible_end) {
                inline_end.get_or_insert(fragment.slot_end);
            }
        }
        if fragment_cursor.is_empty() {
            inline_end
        } else {
            None
        }
    }

    fn flow_thread_line_range(&self, flow_thread_id: u32) -> Option<(usize, usize)> {
        let start = self
            .lines
            .iter()
            .position(|line| line.flow_thread_id == flow_thread_id)?;
        let end = self
            .lines
            .iter()
            .rposition(|line| line.flow_thread_id == flow_thread_id)?
            + 1;
        Some((start, end))
    }

    pub(crate) fn clear(&mut self) {
        self.lines.clear();
        self.fragments.clear();
        self.drop_caps.clear();
        self.ellipsis_threads.clear();
        self.recomposed_lines.clear();
        self.recomposed_lines_retained = false;
    }

    pub(crate) fn recomposed_line_ranges(&self) -> Option<&[Range<usize>]> {
        self.recomposed_lines_retained
            .then_some(self.recomposed_lines.as_slice())
    }

    fn mark_recomposed_lines(&mut self, range: Range<usize>) -> Result<(), EngineError> {
        let ranges = &mut self.recomposed_lines;
        if let Some(last) = ranges.last_mut()
            && last.end >= range.start
        {
            last.end = last.end.max(range.end);
        } else {
            ranges
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            ranges.push(range);
        }
        self.recomposed_lines_retained = true;
        Ok(())
    }

    pub(crate) fn ellipsis_threads(&self) -> &[u32] {
        &self.ellipsis_threads
    }

    pub(crate) fn line_fragment_start(&self, line_index: usize) -> Option<usize> {
        self.lines
            .prefix_summary(line_index)
            .map(|summary| summary.fragments)
    }

    fn source_restart_line(&self, offset: u32) -> Option<usize> {
        let containing = self
            .fragments
            .find_source(offset, |fragment, offset| {
                fragment.line.text_start <= offset
                    && offset
                        < fragment
                            .line
                            .text_end
                            .max(fragment.line.text_start.saturating_add(1))
            })
            .and_then(|fragment| self.lines.index_for_fragment(fragment))?;
        let flow_thread_id = self.lines.get(containing)?.flow_thread_id;
        let Some(previous) = containing.checked_sub(1) else {
            return Some(containing);
        };
        if self.lines.get(previous)?.flow_thread_id == flow_thread_id {
            // A narrower first cluster can move backward across its old line boundary.
            Some(previous)
        } else {
            Some(containing)
        }
    }

    pub(crate) fn line_fragments(
        &self,
        line_index: usize,
    ) -> Result<RopeRange<'_, FlowFragment>, EngineError> {
        let line = self
            .lines
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let start = self
            .line_fragment_start(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        self.fragments
            .range(start..end)
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn truncate_for_ellipsis(
        &mut self,
        flow_thread_id: u32,
        clusters: &ClusterArena,
        mut replacement_at: impl FnMut(usize, u32) -> Result<EllipsisReplacement, EngineError>,
    ) -> Result<Option<EllipsisTarget>, EngineError> {
        let Some(line_index) = self
            .lines
            .iter()
            .rposition(|line| line.flow_thread_id == flow_thread_id)
        else {
            return Ok(None);
        };
        let line = self.lines[line_index];
        let fragment_start = self
            .line_fragment_start(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_end = fragment_start
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_index = fragment_end
            .checked_sub(1)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment = *self
            .fragments
            .get(fragment_index)
            .ok_or(EngineError::InvalidRequest)?;
        let cluster_count = clusters.starts.len();
        let consumed =
            usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let available = fragment.slot_end - fragment.slot_start;
        if consumed >= cluster_count && fragment.line.advance <= available {
            return Ok(None);
        }
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let mut cluster_end = consumed.min(cluster_count);
        let mut source_advance = fragment.line.advance;
        while cluster_end > cluster_start
            && clusters.flags[cluster_end - 1] & CLUSTER_HARD_BREAK != 0
        {
            cluster_end -= 1;
            source_advance -= clusters.advances[cluster_end];
        }
        let mut text_end = cluster_text_end(clusters, cluster_end);
        let mut replacement = replacement_at(cluster_end, text_end)?;
        if replacement.cluster_start < cluster_start
            || replacement.cluster_start > cluster_end
            || !replacement.advance_adjustment.is_finite()
        {
            return Err(EngineError::InvalidRequest);
        }
        while cluster_end > cluster_start
            && source_advance + replacement.advance_adjustment > available
        {
            cluster_end -= 1;
            source_advance -= clusters.advances[cluster_end];
            text_end = cluster_text_end(clusters, cluster_end);
            replacement = replacement_at(cluster_end, text_end)?;
            if replacement.cluster_start < cluster_start
                || replacement.cluster_start > cluster_end
                || !replacement.advance_adjustment.is_finite()
            {
                return Err(EngineError::InvalidRequest);
            }
        }
        let cluster_end_record =
            u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?;
        let replacement_advance = (source_advance + replacement.advance_adjustment).max(0.0);
        // The replacement now terminates the line, so nothing hangs off its end any more:
        // whatever the fit trimmed is either gone with the truncated suffix or interior to
        // the ellipsis. Leaving the fitted value here would make RTL positioning discount a
        // space the retained range no longer contains.
        if !self
            .fragments
            .update(fragment_index, |fragment| {
                fragment.line.cluster_end = cluster_end_record;
                fragment.line.text_end = text_end;
                fragment.line.advance = replacement_advance;
                fragment.line.hung_advance = 0.0;
                fragment.line.hard_break = false;
            })
            .map_err(|()| EngineError::ResultTooLarge)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Some(EllipsisTarget {
            fragment_index: u32::try_from(fragment_index)
                .map_err(|_| EngineError::ResultTooLarge)?,
            line_cluster_start: u32::try_from(cluster_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            boundary_cluster_start: u32::try_from(replacement.cluster_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            cluster_end: u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?,
            text_end,
        }))
    }
}

fn wrapping_for_flow_thread(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> Result<u8, EngineError> {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map(|constraint| constraint.wrap)
        .ok_or(EngineError::InvalidRequest)
}

fn flexible_for_flow_thread(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> Result<bool, EngineError> {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map(|constraint| constraint.width_mode != AXIS_EXACT)
        .ok_or(EngineError::InvalidRequest)
}

fn inline_limit_for_flow_thread(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> Result<Option<f64>, EngineError> {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map(flexible_inline_limit)
        .ok_or(EngineError::InvalidRequest)
}

fn flexible_inline_limit(constraint: &FlowConstraint) -> Option<f64> {
    (constraint.width_mode == AXIS_AT_MOST).then(|| f64::from(constraint.width))
}

fn indent_for_flow_thread(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> Result<f64, EngineError> {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map(|constraint| f64::from(constraint.first_line_indent))
        .ok_or(EngineError::InvalidRequest)
}

/// The breaker's shrink fraction: only a justified thread with a declared
/// minimum word-space ratio may compress spaces to admit one more word.
fn constraint_word_space_shrink(constraint: &FlowConstraint) -> f64 {
    if constraint.align == ALIGN_JUSTIFY && constraint.justify_min_word_space_ratio > 0.0 {
        1.0 - f64::from(constraint.justify_min_word_space_ratio)
    } else {
        0.0
    }
}

fn shrink_for_flow_thread(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> Result<f64, EngineError> {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map(constraint_word_space_shrink)
        .ok_or(EngineError::InvalidRequest)
}

fn line_fragments(
    flow: &FlowLayoutArena,
    line_index: usize,
) -> Result<RopeRange<'_, FlowFragment>, EngineError> {
    flow.line_fragments(line_index)
}

fn same_flow_line_records(
    left_line: FlowLine,
    left_fragments: &RopeRange<'_, FlowFragment>,
    right_line: FlowLine,
    right_fragments: &RopeCursorRange<'_, FlowFragment>,
) -> bool {
    if left_line.flow_thread_id != right_line.flow_thread_id
        || left_line.region_id != right_line.region_id
        || left_line.transform_index != right_line.transform_index
        || left_line.clip_id != right_line.clip_id
        || left_line.fragment_count != right_line.fragment_count
        || left_line.align != right_line.align
        || left_line.block_start.to_bits() != right_line.block_start.to_bits()
        || left_line.baseline.to_bits() != right_line.baseline.to_bits()
        || left_line.height.to_bits() != right_line.height.to_bits()
    {
        return false;
    }
    left_fragments.len() == right_fragments.len()
        && left_fragments
            .iter()
            .zip(right_fragments.iter())
            .all(|(left, right)| same_flow_fragment_state(*left, *right))
}

fn same_flow_fragment_state(left: FlowFragment, right: FlowFragment) -> bool {
    left.line.cluster_start == right.line.cluster_start
        && left.line.cluster_end == right.line.cluster_end
        && left.line.text_start == right.line.text_start
        && left.line.text_end == right.line.text_end
        && left.line.advance.to_bits() == right.line.advance.to_bits()
        && left.line.hung_advance.to_bits() == right.line.hung_advance.to_bits()
        && left.line.hard_break == right.line.hard_break
        && left.slot_start.to_bits() == right.slot_start.to_bits()
        && left.slot_end.to_bits() == right.slot_end.to_bits()
        && left.flexible_end == right.flexible_end
        && left.boundary_index == right.boundary_index
}

fn cluster_text_end(clusters: &ClusterArena, cluster_end: usize) -> u32 {
    clusters
        .starts
        .get(cluster_end)
        .copied()
        .or_else(|| clusters.ends.last().copied())
        .unwrap_or(0)
}

fn cluster_for_offset(clusters: &ClusterArena, offset: u32) -> Result<usize, EngineError> {
    let offset = usize::try_from(offset).map_err(|_| EngineError::InvalidRequest)?;
    let index = usize::try_from(
        *clusters
            .index_at
            .get(offset)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    if offset != 0
        && index < clusters.starts.len()
        && clusters.starts[index]
            != u32::try_from(offset).map_err(|_| EngineError::InvalidRequest)?
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(index)
}

fn include_range_extents(
    target: &mut LineExtents,
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    line: ComposedLine,
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
) -> Result<(), EngineError> {
    let start = usize::try_from(line.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    if start == end {
        let fallback = start
            .saturating_sub(1)
            .min(clusters.starts.len().saturating_sub(1));
        target.include(extents_for_cluster(
            clusters,
            styles,
            fallback,
            metrics_for,
            first_font_for_stack,
        )?);
        return Ok(());
    }
    let runs = clusters.layout_runs();
    let first = runs.partition_point(|run| run.cluster_end <= line.cluster_start);
    let mut covered = start;
    for run in &runs[first..] {
        let run_start =
            usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        if run_start >= end {
            break;
        }
        let run_end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let overlap_start = run_start.max(start);
        let overlap_end = run_end.min(end);
        if overlap_start != covered || overlap_start >= overlap_end {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(index) = (overlap_start..overlap_end)
            .find(|index| clusters.flags[*index] & CLUSTER_HARD_BREAK == 0)
        {
            target.include(extents_for_cluster(
                clusters,
                styles,
                index,
                metrics_for,
                first_font_for_stack,
            )?);
        }
        covered = overlap_end;
    }
    if covered != end {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

fn extents_for_cluster(
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    index: usize,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    first_font_for_stack: impl Fn(u32) -> Option<u32>,
) -> Result<LineExtents, EngineError> {
    Ok(
        line_metrics_for_cluster(clusters, styles, index, metrics_for, first_font_for_stack)?
            .extents,
    )
}

fn line_metrics_for_cluster(
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    index: usize,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    first_font_for_stack: impl Fn(u32) -> Option<u32>,
) -> Result<ClusterLineMetrics, EngineError> {
    let style_index = usize::try_from(
        *clusters
            .style_indexes
            .get(index)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let style = styles
        .get(style_index)
        .ok_or(EngineError::InvalidRequest)?
        .style;
    // Line boxes belong to the authored stack, not whichever fallback face happened to draw one
    // cluster. Using the primary face removes mixed-script leading jitter.
    let font_handle =
        first_font_for_stack(style.font_stack_handle).ok_or(EngineError::FontStackMissing)?;
    let metrics =
        metrics_for(font_handle).ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
    let ascent = (f64::from(metrics.ascender) * scale).max(0.0);
    let descent = (-f64::from(metrics.descender) * scale).max(0.0);
    let natural = (f64::from(metrics.ascender) - f64::from(metrics.descender)
        + f64::from(metrics.line_gap))
        * scale;
    let leading = if style.has_line_height {
        // Explicit line height is authoritative, including tight values whose half-leading is
        // negative. Ink may exceed that box just as it can in CSS.
        f64::from(style.font_size * style.line_height) - ascent - descent
    } else {
        (natural - ascent - descent).max(0.0)
    };
    let shift = f64::from(style.baseline_shift);
    Ok(ClusterLineMetrics {
        extents: LineExtents {
            // Preserve negative half-leading; clamping either side makes tight line boxes too tall.
            above: ascent + leading * 0.5 + shift,
            below: descent + leading * 0.5 - shift,
        },
        cap_height: f64::from(metrics.cap_height) * scale,
        baseline_shift: shift,
    })
}

fn cap_over_alignment_for_cluster(
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    index: usize,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
) -> Result<f64, EngineError> {
    let style_index = usize::try_from(
        *clusters
            .style_indexes
            .get(index)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let style = styles
        .get(style_index)
        .ok_or(EngineError::InvalidRequest)?
        .style;
    // Initial-letter alignment follows the face that actually shaped the cap, unlike the body
    // line box, whose metrics intentionally come from the authored stack's primary face.
    let font_handle = *clusters
        .font_handles
        .get(index)
        .ok_or(EngineError::InvalidRequest)?;
    let metrics =
        metrics_for(font_handle).ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
    Ok(f64::from(style.baseline_shift) + f64::from(metrics.cap_height) * scale)
}

fn positive_extents(
    extents: LineExtents,
    styles: &[StyleSegment],
    clusters: &ClusterArena,
    index: usize,
) -> Result<LineExtents, EngineError> {
    if extents.height().is_finite() && extents.height() > 0.0 {
        return Ok(extents);
    }
    let style_index = usize::try_from(
        *clusters
            .style_indexes
            .get(index.min(clusters.starts.len().saturating_sub(1)))
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let fallback = f64::from(
        styles
            .get(style_index)
            .ok_or(EngineError::InvalidRequest)?
            .style
            .font_size,
    );
    if !fallback.is_finite() || fallback <= 0.0 {
        return Err(EngineError::InvalidRequest);
    }
    Ok(LineExtents {
        above: fallback,
        below: 0.0,
    })
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), EngineError> {
    if values.capacity().saturating_sub(values.len()) < additional {
        values
            .try_reserve_exact(additional)
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::line_composition::NoCorrections;
    use crate::engine::{
        cluster_state::{CLUSTER_SAFE_BEFORE, ClusterBuildInput},
        flow_geometry::{LocalizedGeometryChange, RetainedExclusion, RetainedRegion},
        frame::{
            ALIGN_START, AXIS_EXACT, BLOCK_ALIGN_START, DROP_CAP_ALIGN_BASELINE,
            DROP_CAP_ALIGN_TEXT_TOP, DROP_CAP_SIDE_INLINE_START, EXCLUSION_WRAP_BOTH,
            LAST_LINE_AUTO, ORIENTATION_MIXED, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
            SHAPE_RECTANGLE, WRAP_CHARACTER, WRAP_NONE,
        },
        semantic_wire::{FlowConstraint, FlowExclusion, FlowRegion, FlowVertex},
        shaping_state::{ShapeArena, ShapedRun, ShapingRun},
        style_state::ResolvedStyle,
    };
    use crate::unicode::UnicodeAnalysis;
    use alloc::vec;
    use core::cell::Cell;

    fn fixture_metrics(_: u32) -> Option<FontMetrics> {
        Some(FontMetrics {
            units_per_em: 1_000,
            ascender: 800,
            cap_height: 700,
            descender: -200,
            line_gap: 100,
            underline_position: -100,
            underline_thickness: 50,
            strikeout_position: 300,
            strikeout_size: 50,
        })
    }

    fn retained_clusters(
        text: &str,
        styles: &[StyleSegment],
        runs: &[ShapingRun],
        shaped: &[(u32, u32, u32, u32)],
    ) -> ClusterArena {
        let text: Vec<u16> = text.encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let mut shape = ShapeArena::default();
        for &(source_run, font_handle, text_start, text_end) in shaped {
            let glyph_start = u32::try_from(shape.glyph_ids.len()).unwrap();
            for cluster in text_start..text_end {
                shape.glyph_ids.push(u16::try_from(cluster + 1).unwrap());
                shape.clusters.push(cluster);
                shape.x_advances.push(500);
                shape.y_advances.push(0);
                shape.x_offsets.push(0);
                shape.y_offsets.push(0);
                shape.glyph_flags.push(0);
            }
            shape.runs.push(ShapedRun {
                source_run,
                binding_handle: source_run + 1,
                font_handle,
                text_start,
                text_end,
                glyph_start,
                glyph_count: text_end - text_start,
            });
        }
        let text_unit_ids = (1..=u32::try_from(text.len()).unwrap()).collect::<Vec<_>>();
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &text_unit_ids,
                    unicode: &unicode,
                    styles,
                    runs,
                    shape: &shape,
                },
                fixture_metrics,
            )
            .unwrap();
        clusters
    }

    fn composed_range(start: u32, end: u32) -> ComposedLine {
        ComposedLine {
            cluster_start: start,
            cluster_end: end,
            text_start: start,
            text_end: end,
            advance: 0.0,
            hung_advance: 0.0,
            hard_break: false,
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        }
    }

    fn scalar_range_extents(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        line: ComposedLine,
    ) -> LineExtents {
        let start = usize::try_from(line.cluster_start).unwrap();
        let end = usize::try_from(line.cluster_end).unwrap();
        let mut extents = LineExtents::default();
        if start == end {
            let fallback = start
                .saturating_sub(1)
                .min(clusters.starts.len().saturating_sub(1));
            extents.include(
                extents_for_cluster(clusters, styles, fallback, fixture_metrics, |_| Some(1))
                    .unwrap(),
            );
            return extents;
        }
        for index in start..end {
            if clusters.flags[index] & CLUSTER_HARD_BREAK == 0 {
                extents.include(
                    extents_for_cluster(clusters, styles, index, fixture_metrics, |_| Some(1))
                        .unwrap(),
                );
            }
        }
        extents
    }

    fn retained_range_extents(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        line: ComposedLine,
    ) -> LineExtents {
        let mut extents = LineExtents::default();
        include_range_extents(
            &mut extents,
            clusters,
            styles,
            line,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap();
        extents
    }

    #[test]
    fn layout_run_extents_ignore_paint_only_style_boundaries() {
        let base = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut painted = base;
        painted.material_id = 17;
        painted.raster_pixel_ratio = 2.0;
        painted.decoration_flags = 1;
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 2,
                style: base,
            },
            StyleSegment {
                text_start: 2,
                text_end: 4,
                style: painted,
            },
        ];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style: base,
        }];
        let clusters = retained_clusters("abcd", &styles, &runs, &[(0, 9, 0, 4)]);
        let calls = Cell::new(0usize);
        let mut actual = LineExtents::default();
        include_range_extents(
            &mut actual,
            &clusters,
            &styles,
            composed_range(0, 4),
            |handle| {
                calls.set(calls.get() + 1);
                fixture_metrics(handle)
            },
            |_| Some(1),
        )
        .unwrap();

        assert_eq!(clusters.layout_runs().len(), 1);
        assert_eq!(clusters.style_indexes, [0, 0, 1, 1]);
        assert_eq!(
            actual,
            scalar_range_extents(&clusters, &styles, composed_range(0, 4))
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn same_source_drop_cap_resumes_body_at_safe_boundary_and_cuts_first_lines() {
        let cap_style = ResolvedStyle::test_typography(30.0, 0.0, 0.0);
        let body_style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style: cap_style,
            },
            StyleSegment {
                text_start: 1,
                text_end: 7,
                style: body_style,
            },
        ];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 1,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: cap_style,
            },
            ShapingRun {
                text_start: 1,
                text_end: 7,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: body_style,
            },
        ];
        let mut clusters =
            retained_clusters("Abc def", &styles, &runs, &[(0, 9, 0, 1), (1, 9, 1, 7)]);
        clusters
            .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                Some(crate::FontGlyphExtents {
                    x_min: 0,
                    y_min: -200,
                    x_max: 500,
                    y_max: 800,
                })
            })
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters.ensure_placement_segment_anchors().unwrap();
        let mut drop_cap_constraint = constraint();
        drop_cap_constraint.drop_cap_lines = 3;
        drop_cap_constraint.drop_cap_alignment = DROP_CAP_ALIGN_TEXT_TOP;
        drop_cap_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        drop_cap_constraint.drop_cap_margin_inline = 2.0;
        let mut wide_region = region();
        wide_region.inline_end = 40.0;
        wide_region.clip_inline_end = 40.0;
        wide_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        assert!(
            prepare_drop_cap(
                drop_cap_constraint,
                wide_region,
                &clusters,
                &runs,
                0,
                0.0,
                &styles,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap()
            .is_some(),
        );
        let mut layout = FlowLayoutArena::default();
        layout
            .build_with_drop_cap_context(
                &geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                0,
                8,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();

        assert_eq!(layout.drop_caps.len(), 1);
        let cap = layout.drop_caps[0];
        // The cap's 700-unit alignment height meets the body's cap-height even though the
        // fixture glyph deliberately carries another 100 units of ink above it.
        assert_eq!(cap.line.block_start, -1.5);
        assert_eq!(cap.fragment.line.cluster_start, 0);
        assert_eq!(cap.fragment.line.cluster_end, 1);
        assert_eq!(cap.body_resume_cluster, 1);
        assert_eq!(layout.fragments[0].line.cluster_start, 1);
        assert!(layout.fragments[0].slot_start > wide_region.inline_start.into());
        assert_eq!(
            usize::try_from(cap.fragment.line.cluster_end).unwrap()
                + layout
                    .fragments
                    .iter()
                    .map(|fragment| {
                        usize::try_from(fragment.line.cluster_end - fragment.line.cluster_start)
                            .unwrap()
                    })
                    .sum::<usize>(),
            clusters.starts.len(),
        );

        let rtl_cap = prepare_drop_cap(
            drop_cap_constraint,
            wide_region,
            &clusters,
            &runs,
            1,
            0.0,
            &styles,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap()
        .unwrap();
        assert_eq!(rtl_cap.cut.end, f64::from(wide_region.inline_end));
        assert!(rtl_cap.cut.start > f64::from(wide_region.inline_start));
        assert!(rtl_cap.fragment.slot_start > layout.fragments[0].slot_start);

        let mut contour_constraint = drop_cap_constraint;
        contour_constraint.drop_cap_vertices_offset = 0;
        contour_constraint.drop_cap_vertex_count = 3;
        let contour_geometry = FlowGeometryArena {
            constraints: vec![contour_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            vertices: vec![
                FlowVertex {
                    inline: 0.0,
                    block: 0.0,
                },
                FlowVertex {
                    inline: 1.0,
                    block: 0.0,
                },
                FlowVertex {
                    inline: 0.0,
                    block: 1.0,
                },
            ],
            ..FlowGeometryArena::default()
        };
        let contour_cap = prepare_drop_cap(
            contour_constraint,
            wide_region,
            &clusters,
            &runs,
            0,
            0.0,
            &styles,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap()
        .unwrap();
        let contour_middle = contour_cap.cut_block_start
            + (contour_cap.cut_block_end - contour_cap.cut_block_start) * 0.5;
        let contour_top = contour_cap
            .cut_for_band(
                &contour_geometry,
                0,
                contour_cap.cut_block_start,
                contour_middle,
            )
            .unwrap()
            .unwrap();
        let contour_bottom = contour_cap
            .cut_for_band(
                &contour_geometry,
                1,
                contour_middle,
                contour_cap.cut_block_end,
            )
            .unwrap()
            .unwrap();
        assert_eq!(contour_top.start, contour_bottom.start);
        assert!(contour_top.end > contour_bottom.end);

        let safe_flags = clusters.flags.clone();
        for flags in &mut clusters.flags[1..] {
            *flags &= !CLUSTER_SAFE_BEFORE;
        }
        assert!(
            prepare_drop_cap(
                drop_cap_constraint,
                wide_region,
                &clusters,
                &runs,
                0,
                0.0,
                &styles,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap()
            .is_none(),
            "a cap must disable rather than split an unsafe shaping prefix",
        );
        clusters.flags.copy_from_slice(&safe_flags);

        let mut region_with_object = wide_region;
        region_with_object.exclusion_count = 1;
        let object = FlowExclusion {
            id: 11,
            region_id: wide_region.id,
            geometry_revision: 1,
            vertices_offset: 0,
            vertex_count: 0,
            shape: SHAPE_RECTANGLE,
            wrap_side: EXCLUSION_WRAP_BOTH,
            inline_start: 30.0,
            block_start: 0.0,
            inline_end: 32.0,
            block_end: 60.0,
            margin_inline: 0.0,
            margin_block: 0.0,
        };
        let combined_geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint],
            regions: vec![RetainedRegion {
                record: region_with_object,
                vertex_start: 0,
            }],
            exclusions: vec![RetainedExclusion {
                record: object,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let mut combined = FlowLayoutArena::default();
        combined
            .build_with_drop_cap_context(
                &combined_geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                0,
                8,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
        assert_eq!(combined.drop_caps.len(), 1);
        assert!(!combined.lines.is_empty());
        assert!(
            combined
                .fragments
                .iter()
                .any(|fragment| fragment.slot_start >= 32.0)
        );

        let mut later_cap = cap;
        later_cap.line.flow_thread_id = 2;
        let previous = FlowLayoutArena {
            drop_caps: vec![later_cap],
            ..FlowLayoutArena::default()
        };
        let mut later_constraint = drop_cap_constraint;
        later_constraint.flow_thread_id = 2;
        let ordered_geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint, later_constraint],
            ..FlowGeometryArena::default()
        };
        let mut reconciled = FlowLayoutArena::default();
        reconciled
            .append_reconciled_drop_caps(
                &previous,
                &ordered_geometry,
                drop_cap_constraint.flow_thread_id,
                Some(cap),
            )
            .unwrap();
        assert_eq!(
            reconciled
                .drop_caps
                .iter()
                .map(|cap| cap.line.flow_thread_id)
                .collect::<Vec<_>>(),
            [1, 2],
        );
    }

    #[test]
    fn layout_run_extents_cover_partial_geometry_runs() {
        let base = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut larger = base;
        larger.font_size = 20.0;
        let mut tight = larger;
        tight.has_line_height = true;
        tight.line_height = 0.7;
        let mut shifted = tight;
        shifted.baseline_shift = 3.0;
        let values = [base, larger, tight, shifted];
        let styles: [StyleSegment; 4] = core::array::from_fn(|index| StyleSegment {
            text_start: (index * 2) as u32,
            text_end: (index * 2 + 2) as u32,
            style: values[index],
        });
        let runs: [ShapingRun; 4] = core::array::from_fn(|index| ShapingRun {
            text_start: (index * 2) as u32,
            text_end: (index * 2 + 2) as u32,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style: values[index],
        });
        let clusters = retained_clusters(
            "abcdefgh",
            &styles,
            &runs,
            &[(0, 9, 0, 2), (1, 9, 2, 4), (2, 9, 4, 6), (3, 9, 6, 8)],
        );
        let line = composed_range(1, 7);

        assert_eq!(clusters.layout_runs().len(), 4);
        assert_eq!(
            retained_range_extents(&clusters, &styles, line),
            scalar_range_extents(&clusters, &styles, line)
        );
    }

    #[test]
    fn layout_run_extents_preserve_hard_break_and_empty_line_behavior() {
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 5,
            style,
        }];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 2,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 3,
                text_end: 5,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            },
        ];
        let clusters = retained_clusters("ab\ncd", &styles, &runs, &[(0, 9, 0, 2), (1, 9, 3, 5)]);

        for line in [composed_range(0, 5), composed_range(3, 3)] {
            assert_eq!(
                retained_range_extents(&clusters, &styles, line),
                scalar_range_extents(&clusters, &styles, line)
            );
        }
        assert_eq!(clusters.layout_runs().len(), 3);
    }

    #[test]
    fn dense_cjk_extents_visit_one_layout_run() {
        const COUNT: usize = 4_096;
        let text = "界".repeat(COUNT);
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: COUNT as u32,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: COUNT as u32,
            script: u32::from_be_bytes(*b"Hani"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let clusters = retained_clusters(&text, &styles, &runs, &[(0, 9, 0, COUNT as u32)]);
        let calls = Cell::new(0usize);
        let mut actual = LineExtents::default();
        include_range_extents(
            &mut actual,
            &clusters,
            &styles,
            composed_range(127, 4_000),
            |handle| {
                calls.set(calls.get() + 1);
                fixture_metrics(handle)
            },
            |_| Some(1),
        )
        .unwrap();

        assert_eq!(clusters.layout_runs().len(), 1);
        assert_eq!(
            actual,
            scalar_range_extents(&clusters, &styles, composed_range(127, 4_000))
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn one_update_flows_fragments_around_a_hole_and_retries_for_tall_text() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![2.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0, 0, 1, 1],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        });
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 2,
                style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
            },
            StyleSegment {
                text_start: 2,
                text_end: 4,
                style: ResolvedStyle::test_typography(20.0, 0.0, 0.0),
            },
        ];
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: region(),
                vertex_start: 0,
            }],
            exclusions: vec![RetainedExclusion {
                record: exclusion(),
                vertex_start: 0,
            }],
            vertices: vec![],
        };
        let mut layout = FlowLayoutArena::default();
        let mut slots = InlineSlotArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut slots,
                8,
                4,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.fragments.len(), 2);
        assert_eq!(layout.lines[0].height, 20.0);
        assert_eq!(layout.lines[0].baseline, 16.0);
        assert_eq!(layout.lines[0].fragment_count, 2);
        assert_eq!(layout.fragments[0].slot_start, 0.0);
        assert_eq!(layout.fragments[0].slot_end, 4.0);
        assert_eq!(layout.fragments[0].line.cluster_end, 2);
        assert_eq!(layout.fragments[1].slot_start, 6.0);
        assert_eq!(layout.fragments[1].line.cluster_end, 4);
    }

    #[test]
    fn space_before_shifts_the_first_line_and_never_repeats_on_resume() {
        let clusters = uniform_clusters(4, 1.0);
        let styles = [uniform_style(4)];
        let mut spaced = constraint();
        spaced.space_before = 7.0;
        let geometry = plain_geometry(spaced);
        let layout = composed(&geometry, &clusters, &styles);
        assert_eq!(layout.lines[0].block_start, 7.0);

        let mut resumed = spaced;
        resumed.resume_cluster = 2;
        let resumed_layout = composed(&plain_geometry(resumed), &clusters, &styles);
        assert_eq!(resumed_layout.lines[0].block_start, 0.0);
    }

    #[test]
    fn first_line_indent_narrows_only_the_paragraph_first_line() {
        let clusters = uniform_clusters(10, 1.0);
        let styles = [uniform_style(10)];
        let mut indented = constraint();
        indented.first_line_indent = 4.0;
        indented.wrap = WRAP_CHARACTER;
        // The slot is 10 wide (region minus no exclusions): the first line takes
        // 10 - 4 = 6 clusters, the second line the remaining 4.
        let geometry = plain_geometry(indented);
        let layout = composed(&geometry, &clusters, &styles);
        assert_eq!(layout.lines.len(), 2);
        assert_eq!(layout.fragments[0].line.cluster_end, 6);
        assert_eq!(layout.fragments[1].line.cluster_end, 10);
    }

    #[test]
    fn flexible_inline_end_updates_shared_multileaf_storage_in_one_ordered_walk() {
        let mut lines = Vec::new();
        let mut fragments = Vec::new();
        for index in 0..257u32 {
            lines.push(FlowLine {
                flow_thread_id: 1,
                region_id: 7,
                transform_index: 0,
                clip_id: 0,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: f64::from(index),
                baseline: 1.0,
                height: 1.0,
            });
            fragments.push(FlowFragment {
                line: ComposedLine {
                    advance: f64::from(index % 11 + 1),
                    ..composed_range(index, index + 1)
                },
                slot_start: 0.0,
                slot_end: 100.0,
                flexible_end: true,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            });
        }
        let committed_fragments = RetainedRope::from(fragments.clone());
        let mut layout = FlowLayoutArena {
            lines: RetainedRope::from(lines),
            fragments: committed_fragments.clone(),
            ..FlowLayoutArena::default()
        };

        crate::engine::retained_rope::reset_work_counters();
        assert_eq!(
            layout.resolve_flexible_inline_end(1, 0.0, None),
            Ok(Some(11.0))
        );
        let (traversals, leaf_visits, record_visits) =
            crate::engine::retained_rope::ordered_work_counters();
        assert_eq!(crate::engine::retained_rope::index_lookups(), 0);
        assert_eq!(traversals, 1);
        assert_eq!(record_visits, fragments.len());
        assert!(leaf_visits < record_visits / 4);
        assert_eq!(committed_fragments, RetainedRope::from(fragments));
        assert!(
            layout
                .fragments
                .iter()
                .all(|fragment| fragment.slot_end == 11.0)
        );
    }

    #[test]
    fn safety_limits_do_not_preallocate_their_full_bound() {
        let clusters = uniform_clusters(8, 1.0);
        let styles = [uniform_style(8)];
        let geometry = plain_geometry(constraint());
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                65_536,
                8,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();

        assert!(layout.lines.retained_capacity() < 64);
        assert!(layout.fragments.retained_capacity() < 64);
        assert!(layout.ellipsis_threads.capacity() < 64);
    }

    fn uniform_clusters(count: usize, advance: f64) -> ClusterArena {
        quantized(ClusterArena {
            starts: (0..count as u32).collect(),
            ends: (1..=count as u32).collect(),
            advances: vec![advance; count],
            flags: vec![CLUSTER_SAFE_BEFORE; count],
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            font_handles: vec![1; count],
            index_at: (0..=count as u32).collect(),
            ..ClusterArena::default()
        })
    }

    /// Mirrors the production build-path invariant for literal test arenas: every
    /// consumer of the integer fit sees an F16.16 stream coherent with the f64
    /// advances under the rounding contract.
    fn quantized(mut clusters: ClusterArena) -> ClusterArena {
        let count = clusters.starts.len();
        if clusters.source_runs.len() == count && clusters.font_handles.len() == count {
            if clusters.glyph_starts.is_empty() {
                clusters.glyph_starts.resize(count, 0);
                clusters.glyph_counts.resize(count, 0);
            }
            clusters.rebuild_layout_runs().unwrap();
        }
        clusters.refresh_layout_units().unwrap();
        clusters
    }

    fn uniform_style(text_end: u32) -> StyleSegment {
        StyleSegment {
            text_start: 0,
            text_end,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }
    }

    #[test]
    fn explicit_line_height_uses_the_stack_primary_and_publishes_tight_flow() {
        let clusters = quantized(ClusterArena {
            starts: vec![0],
            ends: vec![1],
            advances: vec![1.0],
            flags: vec![CLUSTER_SAFE_BEFORE],
            style_indexes: vec![0],
            source_runs: vec![0],
            // The fallback face that drew this cluster has deliberately taller metrics.
            font_handles: vec![2],
            index_at: vec![0, 1],
            ..ClusterArena::default()
        });
        let mut style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        style.font_stack_handle = 7;
        style.has_line_height = true;
        style.line_height = 0.92;
        let metrics = |handle| match handle {
            1 => Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 360,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            }),
            2 => panic!("selected fallback metrics must not determine the line box"),
            _ => None,
        };
        let primary_font = |stack| (stack == 7).then_some(1);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 1,
            style,
        }];
        let extents = extents_for_cluster(&clusters, &styles, 0, metrics, primary_font).unwrap();
        assert!((extents.height() - 9.2).abs() < 1e-5);
        assert!((extents.above - 7.6).abs() < 1e-5);
        assert!((extents.below - 1.6).abs() < 1e-5);

        let mut tight_style = style;
        tight_style.line_height = 0.5;
        let tight_styles = [StyleSegment {
            text_start: 0,
            text_end: 1,
            style: tight_style,
        }];
        let tight =
            extents_for_cluster(&clusters, &tight_styles, 0, metrics, primary_font).unwrap();
        assert!((tight.height() - 5.0).abs() < 1e-5);
        assert!((tight.above - 5.5).abs() < 1e-5);
        assert!((tight.below + 0.5).abs() < 1e-5);

        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &plain_geometry(constraint()),
                &clusters,
                &tight_styles,
                &mut InlineSlotArena::default(),
                8,
                4,
                metrics,
                primary_font,
            )
            .unwrap();

        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.lines[0].baseline, 5.5);
        assert_eq!(layout.lines[0].height, 5.0);
    }

    fn plain_geometry(constraint: FlowConstraint) -> FlowGeometryArena {
        let mut record = region();
        record.exclusion_count = 0;
        record.inline_end = 10.0;
        record.block_end = 100.0;
        record.clip_inline_end = 10.0;
        record.clip_block_end = 100.0;
        FlowGeometryArena {
            constraints: vec![constraint],
            regions: vec![RetainedRegion {
                record,
                vertex_start: 0,
            }],
            exclusions: vec![],
            vertices: vec![],
        }
    }

    fn composed(
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        styles: &[StyleSegment],
    ) -> FlowLayoutArena {
        let mut layout = FlowLayoutArena::default();
        let mut slots = InlineSlotArena::default();
        layout
            .build(
                geometry,
                clusters,
                styles,
                &mut slots,
                8,
                4,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        layout
    }

    #[test]
    fn overflowing_text_continues_through_ordered_regions_without_balancing() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0; 4],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut first = region();
        first.id = 1;
        first.inline_end = 4.0;
        first.clip_inline_end = 4.0;
        first.block_end = 10.0;
        first.clip_block_end = 10.0;
        first.exclusion_count = 0;
        let mut second = first;
        second.id = 2;
        second.block_end = 30.0;
        second.clip_block_end = 30.0;
        let mut flow = constraint();
        flow.region_count = 2;
        let geometry = FlowGeometryArena {
            constraints: vec![flow],
            regions: vec![
                RetainedRegion {
                    record: first,
                    vertex_start: 0,
                },
                RetainedRegion {
                    record: second,
                    vertex_start: 0,
                },
            ],
            exclusions: vec![],
            vertices: vec![],
        };
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                2,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(
            layout
                .lines
                .iter()
                .map(|line| line.region_id)
                .collect::<Vec<_>>(),
            [1, 2, 2, 2]
        );
        assert_eq!(
            layout
                .fragments
                .iter()
                .next_back()
                .unwrap()
                .line
                .cluster_end,
            4
        );
    }

    #[test]
    fn only_clip_overflow_assigns_a_clip_id_to_lines() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![2.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE; 3],
            style_indexes: vec![0; 3],
            source_runs: vec![0; 3],
            font_handles: vec![1; 3],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };

        for (overflow, expected_clip_id) in [
            (OVERFLOW_VISIBLE, 0),
            (OVERFLOW_ELLIPSIS, 0),
            (OVERFLOW_CLIP, 7),
        ] {
            let mut flow = constraint();
            flow.overflow = overflow;
            let mut flow_region = region();
            flow_region.exclusion_count = 0;
            let geometry = FlowGeometryArena {
                constraints: vec![flow],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                ..FlowGeometryArena::default()
            };
            let mut layout = FlowLayoutArena::default();
            layout
                .build(
                    &geometry,
                    &clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                )
                .unwrap();
            assert_eq!(layout.lines[0].clip_id, expected_clip_id);
        }
    }

    #[test]
    fn localized_edit_recomposes_one_line_and_reuses_converged_prefix_and_suffix() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: vec![0, 1, 2, 3, 4, 5],
                ends: vec![1, 2, 3, 4, 5, 6],
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 6],
                style_indexes: vec![0; 6],
                source_runs: vec![0; 6],
                font_handles: vec![1; 6],
                stable_ids: vec![1, 2, 3, 4, 5, 6],
                index_at: vec![0, 1, 2, 3, 4, 5, 6],
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 6]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 1.0, 2.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 6,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 4.0;
        narrow_region.clip_inline_end = 4.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let retained_prefix = previous.fragments[0];
        let retained_suffix = previous.fragments[2];
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(2..3),
                    0,
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert_eq!(changed.lines.len(), 3);
        assert_eq!(changed.fragments[0], retained_prefix);
        assert_eq!(changed.fragments[1].line.advance, 3.0);
        assert_eq!(changed.fragments[2], retained_suffix);
    }

    #[test]
    fn localized_edit_splices_a_long_suffix_without_walking_or_copying_its_records() {
        let previous_clusters = uniform_clusters(8_192, 1.0);
        let mut changed_clusters = uniform_clusters(8_192, 1.0);
        changed_clusters.advances[4] = 0.75;
        changed_clusters.refresh_layout_units().unwrap();
        let styles = [uniform_style(8_192)];
        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 2_048;
        let mut flow_region = region();
        flow_region.inline_end = 8.0;
        flow_region.clip_inline_end = 8.0;
        flow_region.block_end = 20_000.0;
        flow_region.clip_block_end = 20_000.0;
        flow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: flow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build(
                &geometry,
                clusters,
                &styles,
                &mut InlineSlotArena::default(),
                2_048,
                1,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_clusters);
        let cold = build(&changed_clusters);
        assert!(previous.lines.len() > 1_000);

        crate::engine::retained_rope::reset_work_counters();
        let mut incremental = FlowLayoutArena::default();
        assert!(
            incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(4..5),
                    0,
                    2_048,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let (copied_records, source_records_visited) =
            crate::engine::retained_rope::work_counters();
        let index_lookups = crate::engine::retained_rope::index_lookups();
        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(
            incremental.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(0..1)))
        );
        assert!(
            copied_records < previous.lines.len() / 4,
            "copied {copied_records} records for {} retained lines",
            previous.lines.len()
        );
        assert!(
            source_records_visited <= 32,
            "visited {source_records_visited} source fragments"
        );
        assert!(
            index_lookups <= 32,
            "performed {index_lookups} root index lookups"
        );
    }

    #[test]
    fn scattered_edits_reconverge_between_islands_and_retain_middle_chunks() {
        let previous_clusters = uniform_clusters(8_192, 1.0);
        let mut changed_clusters = uniform_clusters(8_192, 1.0);
        let edited = [4usize, 4_096, 8_004];
        for cluster in edited {
            changed_clusters.advances[cluster] = 0.75;
        }
        changed_clusters.refresh_layout_units().unwrap();
        let styles = [uniform_style(8_192)];
        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 2_048;
        let mut flow_region = region();
        flow_region.inline_end = 8.0;
        flow_region.clip_inline_end = 8.0;
        flow_region.block_end = 20_000.0;
        flow_region.clip_block_end = 20_000.0;
        flow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: flow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build(
                &geometry,
                clusters,
                &styles,
                &mut InlineSlotArena::default(),
                2_048,
                1,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_clusters);
        let cold = build(&changed_clusters);
        crate::engine::retained_rope::reset_work_counters();
        let mut incremental = FlowLayoutArena::default();
        assert!(
            incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    edited.map(|cluster| {
                        let start = u32::try_from(cluster).unwrap();
                        start..start + 1
                    }),
                    0,
                    2_048,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let (copied_records, source_records_visited) =
            crate::engine::retained_rope::work_counters();
        let index_lookups = crate::engine::retained_rope::index_lookups();
        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        let ranges = incremental.recomposed_line_ranges().unwrap();
        assert_eq!(ranges.len(), 3);
        assert!(ranges.windows(2).all(|pair| pair[0].end < pair[1].start));
        assert!(ranges.iter().map(|range| range.len()).sum::<usize>() < previous.lines.len() / 8);
        let capacity = incremental.recomposed_lines.capacity();
        incremental.clear();
        assert!(incremental.recomposed_line_ranges().is_none());
        assert_eq!(incremental.recomposed_lines.capacity(), capacity);

        assert!(
            copied_records <= 32 * 24,
            "copied {copied_records} records across three dirty islands"
        );
        assert!(
            source_records_visited <= edited.len() * 32,
            "visited {source_records_visited} source fragments"
        );
        assert!(
            index_lookups <= edited.len() * 32,
            "performed {index_lookups} root index lookups across three dirty islands"
        );
    }

    #[test]
    fn seeded_unicode_and_hard_break_edits_match_complete_recomposition() {
        let make_clusters = |seed: u32| {
            let mut starts = Vec::new();
            let mut ends = Vec::new();
            let mut advances = Vec::new();
            let mut flags = Vec::new();
            let mut offset = 0u32;
            for cluster in 0..256u32 {
                starts.push(offset);
                let units = if cluster % 17 == 0 || cluster % 23 == 0 {
                    2
                } else {
                    1
                };
                offset += units;
                ends.push(offset);
                let hard_break = cluster % 31 == 30;
                advances.push(if hard_break {
                    0.0
                } else {
                    0.75 + f64::from((cluster.wrapping_add(seed)) % 5) * 0.25
                });
                flags.push(CLUSTER_SAFE_BEFORE | if hard_break { CLUSTER_HARD_BREAK } else { 0 });
            }
            let mut index_at = vec![0u32; usize::try_from(offset).unwrap() + 1];
            for (cluster, (&start, &end)) in starts.iter().zip(&ends).enumerate() {
                for text_offset in start..end {
                    index_at[usize::try_from(text_offset).unwrap()] =
                        u32::try_from(cluster).unwrap();
                }
                index_at[usize::try_from(end).unwrap()] = u32::try_from(cluster + 1).unwrap();
            }
            quantized(ClusterArena {
                starts,
                ends,
                advances,
                flags,
                style_indexes: vec![0; 256],
                source_runs: vec![0; 256],
                font_handles: vec![1; 256],
                stable_ids: (1..=256).collect(),
                index_at,
                ..ClusterArena::default()
            })
        };
        let mut reused = 0usize;
        let mut seed = 0x91e1_0da5u32;
        for case in 0..64u32 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let previous_clusters = make_clusters(case);
            let mut changed_clusters = make_clusters(case);
            let styles = [uniform_style(
                previous_clusters.ends.last().copied().unwrap_or_default(),
            )];
            let first = usize::try_from(seed % 180 + 8).unwrap();
            let last = (first + usize::try_from((seed >> 24) % 48).unwrap()).min(247);
            changed_clusters.advances[first] += 0.25;
            changed_clusters.advances[last] = (changed_clusters.advances[last] - 0.25).max(0.0);
            if case % 7 == 0 {
                changed_clusters.flags[last] ^= CLUSTER_HARD_BREAK;
            }
            changed_clusters.refresh_layout_units().unwrap();

            let mut flow_constraint = constraint();
            flow_constraint.max_lines = 512;
            let mut flow_region = region();
            flow_region.inline_end = 7.0 + (case % 5) as f32;
            flow_region.clip_inline_end = flow_region.inline_end;
            flow_region.block_end = 5_000.0;
            flow_region.clip_block_end = 5_000.0;
            flow_region.exclusion_count = 0;
            let geometry = FlowGeometryArena {
                constraints: vec![flow_constraint],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                ..FlowGeometryArena::default()
            };
            let build = |clusters: &ClusterArena| {
                let mut flow = FlowLayoutArena::default();
                flow.build(
                    &geometry,
                    clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    512,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                )
                .unwrap();
                flow
            };
            let previous = build(&previous_clusters);
            let cold = build(&changed_clusters);
            let mut incremental = FlowLayoutArena::default();
            let mut dirty = Vec::with_capacity(usize::from(first != last) + 1);
            dirty.push(previous_clusters.starts[first]..previous_clusters.ends[first]);
            if first != last {
                dirty.push(previous_clusters.starts[last]..previous_clusters.ends[last]);
            }
            if incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    dirty,
                    0,
                    512,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
            {
                reused += 1;
            } else {
                incremental = build(&changed_clusters);
            }
            assert_eq!(incremental.lines, cold.lines, "case {case} lines");
            assert_eq!(
                incremental.fragments, cold.fragments,
                "case {case} fragments"
            );
        }
        assert!(
            reused > 0,
            "the seeded corpus must exercise retained splicing"
        );
    }

    #[test]
    fn localized_drop_cap_source_edit_recomposes_cap_bands_and_reuses_suffix() {
        let text = "Abc def ghi jkl mno pqr";
        let text_end = u32::try_from(text.encode_utf16().count()).unwrap();
        let cap_style = ResolvedStyle::test_typography(30.0, 0.0, 0.0);
        let body_style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style: cap_style,
            },
            StyleSegment {
                text_start: 1,
                text_end,
                style: body_style,
            },
        ];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 1,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: cap_style,
            },
            ShapingRun {
                text_start: 1,
                text_end,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: body_style,
            },
        ];
        let shaped = [(0, 9, 0, 1), (1, 9, 1, text_end)];
        let prepare_clusters = |cap_advance: i32| {
            let mut clusters = retained_clusters(text, &styles, &runs, &shaped);
            clusters.glyph_x_advances[0] = cap_advance;
            clusters.advances[0] =
                f64::from(cap_advance) * f64::from(cap_style.font_size) / 1_000.0;
            clusters
                .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                    Some(crate::FontGlyphExtents {
                        x_min: 0,
                        y_min: -200,
                        x_max: 500,
                        y_max: 800,
                    })
                })
                .unwrap();
            clusters.ensure_word_breaks().unwrap();
            clusters.ensure_placement_segment_anchors().unwrap();
            clusters
        };
        let previous_clusters = prepare_clusters(500);
        let changed_clusters = prepare_clusters(520);
        let mut flow_constraint = constraint();
        flow_constraint.drop_cap_lines = 3;
        flow_constraint.drop_cap_alignment = DROP_CAP_ALIGN_TEXT_TOP;
        flow_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        flow_constraint.drop_cap_margin_inline = 2.0;
        let mut wide_region = region();
        wide_region.inline_end = 40.0;
        wide_region.clip_inline_end = 40.0;
        wide_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut layout = FlowLayoutArena::default();
            layout
                .build_with_drop_cap_context(
                    &geometry,
                    clusters,
                    &runs,
                    &styles,
                    &mut InlineSlotArena::default(),
                    0,
                    8,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap();
            layout
        };
        let previous = build(&previous_clusters);
        assert!(previous.lines.len() > usize::from(flow_constraint.drop_cap_lines));
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &runs,
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(0..1),
                    0,
                    8,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let cold = build(&changed_clusters);
        assert_eq!(changed.lines, cold.lines);
        assert_eq!(changed.fragments, cold.fragments);
        assert_eq!(changed.drop_caps, cold.drop_caps);
        assert_eq!(
            changed.recomposed_line_ranges(),
            Some(core::slice::from_ref(
                &(0..usize::from(flow_constraint.drop_cap_lines))
            ))
        );
        let suffix_start = usize::from(flow_constraint.drop_cap_lines);
        assert!(
            changed
                .lines
                .range(suffix_start..changed.lines.len())
                .unwrap()
                .iter()
                .eq(previous
                    .lines
                    .range(suffix_start..previous.lines.len())
                    .unwrap()
                    .iter())
        );
    }

    #[test]
    fn localized_edit_recomposes_multiple_lines_until_cursor_state_converges() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: (0..9).collect(),
                ends: (1..10).collect(),
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 9],
                style_indexes: vec![0; 9],
                source_runs: vec![0; 9],
                font_handles: vec![1; 9],
                stable_ids: (1..10).collect(),
                index_at: (0..10).collect(),
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 9]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 2.0, 3.0, 3.0, 1.0, 1.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 9,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 6.0;
        narrow_region.clip_inline_end = 6.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(
            previous
                .fragments
                .iter()
                .map(|fragment| fragment.line.cluster_end)
                .collect::<Vec<_>>(),
            [3, 6, 9]
        );

        let retained_prefix = previous.fragments[0];
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(3..7),
                    0,
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert_eq!(changed.fragments[0], retained_prefix);
        assert_eq!(
            changed
                .fragments
                .iter()
                .map(|fragment| (fragment.line.cluster_start, fragment.line.cluster_end))
                .collect::<Vec<_>>(),
            [(0, 3), (3, 5), (5, 9)]
        );
        // The dirty range begins at an old line boundary. Rewind one line because a
        // replacement may become narrow enough to move across that boundary; the
        // continuation proof may then reconverge and retain the remaining suffix.
        assert_eq!(
            changed.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(0..3)))
        );
    }

    #[test]
    fn localized_edit_clears_partial_layout_when_line_state_does_not_converge() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: vec![0, 1, 2, 3, 4, 5],
                ends: vec![1, 2, 3, 4, 5, 6],
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 6],
                style_indexes: vec![0; 6],
                source_runs: vec![0; 6],
                font_handles: vec![1; 6],
                stable_ids: vec![1, 2, 3, 4, 5, 6],
                index_at: vec![0, 1, 2, 3, 4, 5, 6],
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 6]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 3.0, 2.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 6,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 4.0;
        narrow_region.clip_inline_end = 4.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let mut changed = FlowLayoutArena::default();
        assert!(
            !changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(2..3),
                    0,
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert!(changed.lines.is_empty());
        assert!(changed.fragments.is_empty());
        assert_eq!(changed.recomposed_line_ranges(), None);
    }

    #[test]
    fn localized_exclusion_move_recomposes_through_the_dirty_band_and_matches_cold() {
        let clusters = uniform_clusters(30, 2.0);
        let styles = [uniform_style(30)];
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let geometry_at = |block_start: f32, revision: u32| {
            let mut record = exclusion();
            record.geometry_revision = revision;
            record.block_start = block_start;
            record.block_end = block_start + 10.0;
            FlowGeometryArena {
                constraints: vec![constraint()],
                regions: vec![RetainedRegion {
                    record: region(),
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record,
                    vertex_start: 0,
                }],
                vertices: vec![],
            }
        };
        let previous_geometry = geometry_at(10.0, 1);
        let next_geometry = geometry_at(20.0, 2);
        let LocalizedGeometryChange::ExclusionBand(dirty) = next_geometry
            .localized_change_from(&previous_geometry)
            .unwrap()
        else {
            panic!("moving one retained exclusion must yield one dirty band");
        };
        assert_eq!(dirty.region_id, 7);
        assert_eq!(dirty.block_start, 10.0);
        assert_eq!(dirty.block_end, 30.0);

        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &previous_geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                16,
                4,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let mut cold = FlowLayoutArena::default();
        cold.build(
            &next_geometry,
            &clusters,
            &styles,
            &mut InlineSlotArena::default(),
            16,
            4,
            metrics,
            |_| Some(1),
        )
        .unwrap();
        let retained_prefix = previous.fragments[0];
        let retained_suffix = previous
            .fragments
            .range(5..previous.fragments.len())
            .unwrap()
            .to_vec();

        let mut incremental = FlowLayoutArena::default();
        crate::engine::retained_rope::reset_work_counters();
        assert!(
            incremental
                .rebuild_after_exclusion_change_until_state_converges(
                    &previous,
                    &next_geometry,
                    &clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    dirty,
                    0,
                    16,
                    4,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert!(
            crate::engine::retained_rope::index_lookups() <= 4,
            "exclusion convergence must carry ordered cursors instead of indexing old lines"
        );

        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(incremental.fragments[0], retained_prefix);
        assert_eq!(
            incremental
                .fragments
                .range(5..incremental.fragments.len())
                .unwrap()
                .to_vec(),
            retained_suffix
        );
        assert_eq!(
            incremental.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(1..4)))
        );
    }

    #[test]
    fn localized_exclusion_move_preserves_a_drop_cap_and_matches_cold() {
        let text = "aaaaaaaaaa\n".repeat(15);
        let text_end = u32::try_from(text.len()).unwrap();
        let style = ResolvedStyle::test_typography(2.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let mut clusters = retained_clusters(&text, &styles, &runs, &[(0, 9, 0, text_end)]);
        clusters
            .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                Some(crate::FontGlyphExtents {
                    x_min: 0,
                    y_min: -200,
                    x_max: 500,
                    y_max: 800,
                })
            })
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters.ensure_placement_segment_anchors().unwrap();

        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 64;
        flow_constraint.drop_cap_lines = 3;
        flow_constraint.drop_cap_alignment = DROP_CAP_ALIGN_BASELINE;
        flow_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        flow_constraint.drop_cap_margin_inline = 0.5;
        let flow_region = region();
        let geometry_at = |block_start: f32, revision: u32| {
            let mut record = exclusion();
            record.geometry_revision = revision;
            record.block_start = block_start;
            record.block_end = block_start + 10.0;
            FlowGeometryArena {
                constraints: vec![flow_constraint],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record,
                    vertex_start: 0,
                }],
                vertices: vec![],
            }
        };
        let previous_geometry = geometry_at(10.0, 1);
        let next_geometry = geometry_at(20.0, 2);
        let LocalizedGeometryChange::ExclusionBand(dirty) = next_geometry
            .localized_change_from(&previous_geometry)
            .unwrap()
        else {
            panic!("moving the retained exclusion must yield one dirty band");
        };

        let build = |geometry: &FlowGeometryArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build_with_drop_cap_context(
                geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                0,
                64,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_geometry);
        let cold = build(&next_geometry);
        let mut incremental = FlowLayoutArena::default();
        let retained = incremental
            .rebuild_after_exclusion_change_until_state_converges(
                &previous,
                &next_geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                dirty,
                0,
                64,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
        assert!(
            retained,
            "the moved exclusion must converge past its dirty band"
        );

        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(incremental.drop_caps, cold.drop_caps);
        assert!(incremental.recomposed_line_ranges().is_some());
    }

    #[test]
    fn ellipsis_truncation_reuses_the_final_slot_and_removes_only_required_clusters() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            ..ClusterArena::default()
        });
        let mut layout = FlowLayoutArena {
            lines: vec![FlowLine {
                flow_thread_id: 7,
                region_id: 1,
                transform_index: 0,
                clip_id: 1,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 6.0,
                    hung_advance: 3.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 10.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };

        let target = layout
            .truncate_for_ellipsis(7, &clusters, |cluster_end, _| {
                Ok(EllipsisReplacement {
                    cluster_start: cluster_end,
                    advance_adjustment: 5.0,
                })
            })
            .unwrap()
            .unwrap();
        assert_eq!(target.line_cluster_start, 0);
        assert_eq!(target.boundary_cluster_start, 1);
        assert_eq!(target.cluster_end, 1);
        assert_eq!(target.text_end, 1);
        assert_eq!(layout.fragments[0].line.cluster_end, 1);
        assert_eq!(layout.fragments[0].line.text_end, 1);
        assert_eq!(layout.fragments[0].line.advance, 8.0);
        assert_eq!(
            layout.fragments[0].line.hung_advance, 0.0,
            "the ellipsis terminates the line, so nothing hangs off its end",
        );
    }

    #[test]
    fn complete_no_wrap_line_still_requests_ellipsis_when_its_slot_overflows() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![3.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE; 3],
            style_indexes: vec![0; 3],
            source_runs: vec![0; 3],
            font_handles: vec![1; 3],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut constraint = constraint();
        constraint.overflow = OVERFLOW_ELLIPSIS;
        constraint.wrap = WRAP_NONE;
        let mut constrained_region = region();
        constrained_region.inline_end = 4.0;
        constrained_region.clip_inline_end = 4.0;
        constrained_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint],
            regions: vec![RetainedRegion {
                record: constrained_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                4,
                1,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(layout.fragments[0].line.cluster_end, 3);
        assert_eq!(layout.lines[0].clip_id, 0);
        assert_eq!(layout.ellipsis_threads(), [constraint.flow_thread_id]);
    }

    fn constraint() -> FlowConstraint {
        FlowConstraint {
            paragraph_id: 1,
            flow_thread_id: 1,
            width: 10.0,
            height: 100.0,
            viewport_block_start: 0.0,
            viewport_block_end: 100.0,
            resume_block_offset: 0.0,
            max_lines: 8,
            region_start: 0,
            resume_cluster: 0,
            region_count: 1,
            resume_region: 0,
            width_mode: AXIS_EXACT,
            height_mode: AXIS_EXACT,
            wrap: WRAP_CHARACTER,
            align: ALIGN_START,
            overflow: OVERFLOW_VISIBLE,
            block_align: BLOCK_ALIGN_START,
            first_line_indent: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            justify_min_word_space_ratio: 0.0,
            justify_max_word_space_ratio: 0.0,
            justify_letter_space_expansion: 0.0,
            last_line: LAST_LINE_AUTO,
            drop_cap_lines: 0,
            drop_cap_alignment: 0,
            drop_cap_side: 0,
            drop_cap_margin_inline: 0.0,
            drop_cap_margin_block: 0.0,
            drop_cap_vertices_offset: 0,
            drop_cap_vertex_count: 0,
        }
    }

    fn region() -> FlowRegion {
        FlowRegion {
            id: 7,
            geometry_revision: 1,
            transform_index: 7,
            vertices_offset: 0,
            vertex_count: 0,
            exclusion_start: 0,
            exclusion_count: 1,
            shape: SHAPE_RECTANGLE,
            writing_mode: WRITING_HORIZONTAL_TB,
            text_orientation: ORIENTATION_MIXED,
            inline_start: 0.0,
            block_start: 0.0,
            inline_end: 10.0,
            block_end: 100.0,
            clip_inline_start: 0.0,
            clip_block_start: 0.0,
            clip_inline_end: 10.0,
            clip_block_end: 100.0,
        }
    }

    fn exclusion() -> FlowExclusion {
        FlowExclusion {
            id: 9,
            region_id: 7,
            geometry_revision: 1,
            vertices_offset: 0,
            vertex_count: 0,
            shape: SHAPE_RECTANGLE,
            wrap_side: EXCLUSION_WRAP_BOTH,
            inline_start: 4.0,
            block_start: 0.0,
            inline_end: 6.0,
            block_end: 40.0,
            margin_inline: 0.0,
            margin_block: 0.0,
        }
    }
}
