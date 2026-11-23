//! Line extents and metrics from cluster styles and fonts.

use super::*;

impl LineTypography {
    pub(super) fn include(&mut self, other: Self) {
        if !other.present {
            return;
        }
        if !self.present {
            *self = other;
            return;
        }
        self.ascent = self.ascent.max(other.ascent);
        self.descent = self.descent.max(other.descent);
        self.cap_height = self.cap_height.max(other.cap_height);
        self.x_height = self.x_height.max(other.x_height);
        self.cap_over = self.cap_over.max(other.cap_over);
        self.x_over = self.x_over.max(other.x_over);
        self.height_fallbacks |= other.height_fallbacks;
    }
}

impl LineExtents {
    pub(crate) fn height(self) -> f64 {
        self.above + self.below
    }

    pub(super) fn include(&mut self, other: Self) {
        self.above = self.above.max(other.above);
        self.below = self.below.max(other.below);
        self.typography.include(other.typography);
    }
}

pub(super) fn include_range_extents(
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

pub(super) fn extents_for_cluster(
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

pub(super) fn line_metrics_for_cluster(
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    index: usize,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    first_font_for_stack: impl Fn(u32) -> Option<u32>,
) -> Result<ClusterLineMetrics, EngineError> {
    line_metrics_for_style(
        line_style(clusters, styles, index)?,
        metrics_for,
        first_font_for_stack,
    )
}

/// The style a line at cluster `index` takes its strut from. A text with no cluster has no
/// cluster to ask, and its one style segment is the style its empty line is set in.
pub(super) fn line_style(
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    index: usize,
) -> Result<ResolvedStyle, EngineError> {
    let segment = if clusters.starts.is_empty() {
        styles.first()
    } else {
        clusters
            .style_indexes
            .get(index)
            .and_then(|style_index| usize::try_from(*style_index).ok())
            .and_then(|style_index| styles.get(style_index))
    };
    segment
        .map(|segment| segment.style)
        .ok_or(EngineError::InvalidRequest)
}

/// The same authored-stack strut formula serves General's cluster walk and the one-run leaf.
pub(crate) fn inline_line_extents(
    style: ResolvedStyle,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    first_font_for_stack: impl Fn(u32) -> Option<u32>,
) -> Result<LineExtents, EngineError> {
    let natural = line_metrics_for_style(style, metrics_for, first_font_for_stack)?.extents;
    let estimate = positive_extents_for_style(natural, style)?;
    // compose_band seeds its measurement from the positive estimate, then includes the
    // actual range extents. A single-style leaf has this same range on both attempts.
    let mut measured = estimate;
    measured.include(natural);
    Ok(if measured.height() > estimate.height() {
        measured
    } else {
        estimate
    })
}

pub(super) fn line_metrics_for_style(
    style: ResolvedStyle,
    metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    first_font_for_stack: impl Fn(u32) -> Option<u32>,
) -> Result<ClusterLineMetrics, EngineError> {
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
            typography: LineTypography {
                ascent,
                descent,
                cap_height: f64::from(metrics.cap_height) * scale,
                x_height: f64::from(metrics.x_height) * scale,
                cap_over: f64::from(metrics.cap_height) * scale + shift,
                x_over: f64::from(metrics.x_height) * scale + shift,
                height_fallbacks: metrics.height_fallbacks,
                present: true,
            },
        },
        cap_height: f64::from(metrics.cap_height) * scale,
        baseline_shift: shift,
    })
}

pub(super) fn cap_over_alignment_for_cluster(
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

pub(super) fn positive_extents(
    extents: LineExtents,
    styles: &[StyleSegment],
    clusters: &ClusterArena,
    index: usize,
) -> Result<LineExtents, EngineError> {
    if extents.height().is_finite() && extents.height() > 0.0 {
        return Ok(extents);
    }
    let index = index.min(clusters.starts.len().saturating_sub(1));
    positive_extents_for_style(extents, line_style(clusters, styles, index)?)
}

pub(super) fn positive_extents_for_style(
    extents: LineExtents,
    style: ResolvedStyle,
) -> Result<LineExtents, EngineError> {
    if extents.height().is_finite() && extents.height() > 0.0 {
        return Ok(extents);
    }
    let fallback = f64::from(style.font_size);
    if !fallback.is_finite() || fallback <= 0.0 {
        return Err(EngineError::InvalidRequest);
    }
    Ok(LineExtents {
        above: fallback,
        below: 0.0,
        typography: extents.typography,
    })
}
