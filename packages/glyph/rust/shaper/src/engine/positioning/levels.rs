//! Bidi levels and layout-run lookup for a line: rule L2 reordering, cuts and hanging clusters.

use super::*;

pub(in crate::engine) fn is_trivially_ltr(bidi: &BidiAnalysis, runs: &[ShapingRun]) -> bool {
    bidi.levels.iter().all(|level| level & 1 == 0)
        && runs.iter().all(|run| !run.style.bidi_override)
}

pub(super) fn prepare_line_levels(
    target: &mut Vec<u8>,
    bidi: &BidiAnalysis,
    start: u32,
    end: u32,
) -> Result<(), EngineError> {
    target.clear();
    let start = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(end).map_err(|_| EngineError::InvalidRequest)?;
    let levels = bidi
        .levels
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)?;
    reserve(target, levels.len())?;
    target.extend_from_slice(levels);
    let paragraph = paragraph_level_at(bidi, u32::try_from(start).unwrap_or(u32::MAX));
    let classes = bidi
        .classes
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)?;
    let mut reset_from = Some(0usize);
    let mut reset_to = None;
    let mut previous_level = paragraph;
    for index in 0..target.len() {
        match classes[index] {
            BIDI_B | BIDI_S => {
                reset_to = Some(index + 1);
                reset_from.get_or_insert(index);
            }
            BIDI_WS | BIDI_FSI | BIDI_LRI | BIDI_RLI | BIDI_PDI => {
                reset_from.get_or_insert(index);
            }
            BIDI_RLE | BIDI_LRE | BIDI_RLO | BIDI_LRO | BIDI_PDF | BIDI_BN => {
                reset_from.get_or_insert(index);
                target[index] = previous_level;
            }
            _ => reset_from = None,
        }
        if let (Some(from), Some(to)) = (reset_from, reset_to) {
            target[from..to].fill(paragraph);
            reset_from = None;
            reset_to = None;
        }
        previous_level = target[index];
    }
    if let Some(from) = reset_from {
        target[from..].fill(paragraph);
    }
    Ok(())
}

pub(super) fn cluster_level(
    cluster: usize,
    line_start: u32,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    line_levels: &[u8],
) -> Result<u8, EngineError> {
    let source =
        usize::try_from(clusters.source_runs[cluster]).map_err(|_| EngineError::InvalidRequest)?;
    let run = runs.get(source).ok_or(EngineError::InvalidRequest)?;
    let local = clusters.starts[cluster]
        .checked_sub(line_start)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(EngineError::InvalidRequest)?;
    let resolved = line_levels.get(local).copied().unwrap_or(run.bidi_level);
    if run.style.bidi_override {
        Ok(if resolved & 1 == run.direction & 1 {
            resolved
        } else {
            resolved.saturating_add(1)
        })
    } else {
        Ok(resolved)
    }
}

pub(super) fn layout_run_direction(run: LayoutRun, runs: &[ShapingRun]) -> Result<u8, EngineError> {
    usize::try_from(run.source_run)
        .ok()
        .and_then(|source| runs.get(source))
        .map(|run| run.direction)
        .or_else(|| (run.glyph_count == 0).then_some(0))
        .ok_or(EngineError::InvalidRequest)
}

/// The fragment's cut record, an ellipsis cut or a corrected line end: either way the
/// paragraph's clusters stop at the record.
pub(super) fn fragment_cut(
    fragment: FlowFragment,
    boundary_shape: &BoundaryShapeArena,
) -> Result<(u32, Option<BoundaryShape>), EngineError> {
    let cut_index = if fragment.boundary_index == crate::engine::flow_composition::NO_BOUNDARY {
        fragment.tail_index
    } else {
        fragment.boundary_index
    };
    if cut_index == crate::engine::flow_composition::NO_BOUNDARY {
        return Ok((cut_index, None));
    }
    let boundary = boundary_shape
        .record(cut_index)
        .ok_or(EngineError::InvalidRequest)?;
    Ok((cut_index, Some(boundary)))
}

/// The adjacency-order glyph stream is one equal-length column family, admitted once
/// per fragment so every segment indexes the columns directly.
pub(super) fn admit_glyph_stream(clusters: &ClusterArena) -> Result<(), EngineError> {
    let stream_len = clusters.glyph_ids.len();
    if clusters.glyph_clusters.len() != stream_len
        || clusters.glyph_x_advances.len() != stream_len
        || clusters.glyph_x_offsets.len() != stream_len
        || clusters.glyph_y_offsets.len() != stream_len
        || clusters.glyph_shape_flags.len() != stream_len
        || clusters.glyph_stable_ids.len() != stream_len
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

/// The run geometry of `cluster`, cached for the layout run that last asked.
pub(super) fn cached_run_geometry(
    cache: &mut Option<(usize, RunGeometry)>,
    run_index: usize,
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    cluster: usize,
) -> Result<RunGeometry, EngineError> {
    if let Some((cached_run, geometry)) = *cache
        && cached_run == run_index
    {
        return Ok(geometry);
    }
    let style_index = usize::try_from(clusters.style_indexes[cluster])
        .map_err(|_| EngineError::InvalidRequest)?;
    let style = styles
        .get(style_index)
        .ok_or(EngineError::InvalidRequest)?
        .style;
    let geometry = RunGeometry::for_values(
        clusters.font_handles[cluster],
        clusters.units_per_em[cluster],
        style.font_size,
    )?;
    *cache = Some((run_index, geometry));
    Ok(geometry)
}

pub(super) fn fragment_topology_flags(
    layout_run_order: bool,
    justify: JustifyDistribution,
    hung_leads: bool,
) -> u8 {
    let adjusts_spaces = justify.per_space_units != 0 || justify.extra_space_units != 0;
    let adjusts_gaps = justify.per_gap_units != 0 || justify.extra_gap_units != 0;
    let mut flags = 0;
    if !layout_run_order {
        flags |= FRAGMENT_VISUAL_ORDER;
    }
    if adjusts_spaces {
        flags |= FRAGMENT_ADJUSTS_SPACES;
    }
    if adjusts_gaps {
        flags |= FRAGMENT_ADJUSTS_GAPS;
    }
    if hung_leads {
        flags |= FRAGMENT_HUNG_LEADS;
    }
    flags
}

pub(super) fn layout_run_for_cluster(
    clusters: &ClusterArena,
    cluster: usize,
    cached: &mut Option<(usize, LayoutRun)>,
) -> Result<(usize, LayoutRun), EngineError> {
    let cluster = u32::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
    if let Some((index, run)) = *cached
        && run.cluster_start <= cluster
        && cluster < run.cluster_end
    {
        return Ok((index, run));
    }
    let index = clusters
        .layout_runs()
        .partition_point(|run| run.cluster_end <= cluster);
    let run = *clusters
        .layout_runs()
        .get(index)
        .filter(|run| run.cluster_start <= cluster)
        .ok_or(EngineError::InvalidRequest)?;
    *cached = Some((index, run));
    Ok((index, run))
}

pub(super) fn reorder_l2(indices: &mut [u32], levels: &mut [u8], start: usize) {
    let range = &levels[start..];
    let maximum = range.iter().copied().max().unwrap_or(0);
    let Some(lowest_odd) = range.iter().copied().filter(|level| level & 1 != 0).min() else {
        return;
    };
    for level in (lowest_odd..=maximum).rev() {
        let mut run_start = start;
        while run_start < levels.len() {
            while run_start < levels.len() && levels[run_start] < level {
                run_start += 1;
            }
            let mut run_end = run_start;
            while run_end < levels.len() && levels[run_end] >= level {
                run_end += 1;
            }
            indices[run_start..run_end].reverse();
            levels[run_start..run_end].reverse();
            run_start = run_end;
        }
    }
}

pub(in crate::engine) fn paragraph_level_at(bidi: &BidiAnalysis, offset: u32) -> u8 {
    // Paragraphs are pushed in text order and do not overlap, so the last one starting at or
    // before the offset is the only one that can hold it.
    if let Some(index) = bidi
        .paragraph_starts
        .partition_point(|start| *start <= offset)
        .checked_sub(1)
        && bidi
            .paragraph_ends
            .get(index)
            .is_some_and(|end| offset < *end)
        && let Some(level) = bidi.paragraph_levels.get(index)
    {
        return *level;
    }
    bidi.paragraph_starts
        .iter()
        .zip(&bidi.paragraph_ends)
        .zip(&bidi.paragraph_levels)
        .find_map(|((&start, &end), &level)| (start <= offset && offset < end).then_some(level))
        .or_else(|| bidi.paragraph_levels.last().copied())
        .unwrap_or(0)
}

pub(super) fn hanging_cluster_start(
    fragment: FlowFragment,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
) -> Result<usize, EngineError> {
    if fragment.line.hung_advance == 0.0 {
        return Ok(cluster_end);
    }
    let mut hanging_end = cluster_end;
    if hanging_end > cluster_start && clusters.flags[hanging_end - 1] & CLUSTER_HARD_BREAK != 0 {
        hanging_end -= 1;
    }
    let mut start = hanging_end;
    let mut units = 0_i64;
    while start > cluster_start && clusters.flags[start - 1] & CLUSTER_SPACE != 0 {
        start -= 1;
        units = units
            .checked_add(clusters.advance_units[start])
            .ok_or(EngineError::ResultTooLarge)?;
    }
    if crate::engine::layout_units::scaled_from_layout_units(units).to_bits()
        != fragment.line.hung_advance.to_bits()
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start)
}
