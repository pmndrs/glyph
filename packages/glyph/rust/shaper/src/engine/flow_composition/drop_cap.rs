//! Drop caps: preparing a cap and its envelope, cutting bands around it and reconciling caps on rebuild.

use super::*;

impl FlowDropCap {
    pub(super) fn cut_for_band(
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

    pub(super) fn align_to_body_baseline(&mut self, baseline: f64) {
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

#[derive(Clone, Copy)]
pub(super) struct DropCapEnvelope {
    pub(super) inline_start: f64,
    pub(super) inline_end: f64,
    pub(super) block_start: f64,
    pub(super) block_end: f64,
    pub(super) advance: f64,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn prepare_drop_cap(
    constraint: FlowConstraint,
    region: crate::engine::semantic_wire::FlowRegion,
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
        typography: line_metrics_for_cluster(
            clusters,
            styles,
            0,
            metrics_for,
            first_font_for_stack,
        )?
        .extents
        .typography,
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

pub(super) fn drop_cap_envelope(
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
impl FlowLayoutArena {
    pub(super) fn append_reconciled_drop_caps(
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
}
