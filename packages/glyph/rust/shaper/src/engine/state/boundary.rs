//! The boundary candidate: shaping across a paragraph's line edges to correct unsafe breaks.

use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn prepare_boundary_candidate(
    shaper: &mut ShaperRegistry,
    text: &[u16],
    ellipsis_text: &mut Vec<u16>,
    source_shape: &mut ShapeArena,
    ellipsis_shape: &mut ShapeArena,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &StyleArena,
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    line_cluster_start: usize,
    line_text_start: u32,
    cluster_end: usize,
    text_end: u32,
) -> Result<BoundaryCandidate, EngineError> {
    // The marker follows the last retained cluster. A line that keeps none -- an empty line,
    // or one cut to nothing -- takes the first drawn cluster it hides; a hard break has no
    // run and is not drawn. Hiding none, it takes the last drawn cluster before it.
    let drawn = |index: &usize| clusters.source_runs[*index] != NO_SOURCE_RUN;
    let anchor = cluster_end
        .checked_sub(1)
        .filter(|index| *index >= line_cluster_start)
        .or_else(|| (cluster_end..clusters.starts.len()).find(drawn))
        .or_else(|| (0..line_cluster_start).rev().find(drawn))
        .ok_or(EngineError::InvalidRequest)?;
    let source_run = usize::try_from(
        *clusters
            .source_runs
            .get(anchor)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let run = *runs.get(source_run).ok_or(EngineError::InvalidRequest)?;
    let source_binding_handle = *clusters
        .binding_handles
        .get(anchor)
        .ok_or(EngineError::InvalidRequest)?;
    let source_font_handle = *clusters
        .font_handles
        .get(anchor)
        .ok_or(EngineError::InvalidRequest)?;
    if source_binding_handle == 0 || source_font_handle == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let mut cluster_start = cluster_end;
    while cluster_start > line_cluster_start {
        let previous = cluster_start - 1;
        if clusters.source_runs.get(previous) != Some(&(source_run as u32))
            || clusters.binding_handles.get(previous) != Some(&source_binding_handle)
            || clusters.font_handles.get(previous) != Some(&source_font_handle)
        {
            break;
        }
        cluster_start = previous;
    }

    source_shape.clear();
    let mut source_advance = 0.0;
    if cluster_start < cluster_end {
        let item_start = *clusters
            .starts
            .get(cluster_start)
            .ok_or(EngineError::InvalidRequest)?;
        shaper
            .with_shaped_range(
                source_font_handle,
                text,
                ShapeRunRef {
                    text_start: run.text_start,
                    text_end: run.text_end,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                ShapeRangeRef {
                    item_start,
                    item_end: text_end,
                    context_start: line_text_start.max(run.text_start).min(item_start),
                    context_end: text_end,
                    flags: 0x40 | 0x02 | u32::from(item_start == line_text_start),
                },
                |shaped| {
                    source_shape.append(
                        source_run,
                        source_font_handle,
                        source_binding_handle,
                        item_start,
                        text_end,
                        shaped,
                    )
                },
            )
            .map_err(shaper_error)?;
        let metrics = shaper
            .font_metrics(source_font_handle)
            .ok_or(EngineError::InvalidRequest)?;
        if metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let scale = f64::from(run.style.font_size) / f64::from(metrics.units_per_em);
        source_advance = source_shape
            .x_advances
            .iter()
            .try_fold(0.0, |advance, value| {
                let next = advance + f64::from(value.unsigned_abs()) * scale;
                next.is_finite()
                    .then_some(next)
                    .ok_or(EngineError::InvalidRequest)
            })?;
        for cluster in cluster_start..cluster_end {
            source_advance += f64::from(run.style.letter_spacing);
            if clusters
                .starts
                .get(cluster)
                .and_then(|start| usize::try_from(*start).ok())
                .and_then(|start| text.get(start))
                == Some(&0x20)
            {
                source_advance += f64::from(run.style.word_spacing);
            }
        }
    }

    ellipsis_text.clear();
    ellipsis_text.push(0x2026);
    let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
    let mut selected = None;
    for (font_index, binding_handle) in stack.fonts.iter().copied().enumerate() {
        let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
        ellipsis_shape.clear();
        let missing = shaper
            .with_shaped_run(
                font_handle,
                ellipsis_text,
                ShapeRunRef {
                    text_start: 0,
                    text_end: 1,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: &[],
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                |shaped| {
                    let missing = shaped.glyph_infos().iter().any(|info| info.glyph_id == 0);
                    ellipsis_shape.append(source_run, font_handle, binding_handle, 0, 1, shaped)?;
                    Ok(missing)
                },
            )
            .map_err(shaper_error)?;
        if !missing || font_index + 1 == stack.fonts.len() {
            selected = Some((binding_handle, font_handle));
            break;
        }
    }
    let (ellipsis_binding_handle, ellipsis_font_handle) =
        selected.ok_or(EngineError::FontStackMissing)?;
    let metrics = shaper
        .font_metrics(ellipsis_font_handle)
        .ok_or(EngineError::InvalidRequest)?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let scale = f64::from(run.style.font_size) / f64::from(metrics.units_per_em);
    let ellipsis_advance = ellipsis_shape
        .x_advances
        .iter()
        .try_fold(0.0, |advance, value| {
            let next = advance + f64::from(value.unsigned_abs()) * scale;
            next.is_finite()
                .then_some(next)
                .ok_or(EngineError::InvalidRequest)
        })?;
    Ok(BoundaryCandidate {
        source_run,
        cluster_start,
        source_binding_handle,
        source_font_handle,
        ellipsis_binding_handle,
        ellipsis_font_handle,
        source_advance,
        ellipsis_advance,
    })
}

/// Whether the glyphs `alone` draws are the `paragraph` ones, in order: a ligature or a contextual form
/// changes the ids, and a reorder or a repeat changes the sequence while keeping every id present.
pub(super) fn same_glyphs(alone: impl ExactSizeIterator<Item = u32>, paragraph: &[u16]) -> bool {
    alone.len() == paragraph.len()
        && alone
            .zip(paragraph)
            .all(|(id, &drawn)| id == u32::from(drawn))
}

/// Gives every fragment of `flow` the records shaping its corrected line start and end alone (or none),
/// so the ordinary and the intrinsic flow draw the same edge glyphs.
pub(super) fn attach_line_edges(
    corrections: &mut ShapedBreakCorrections<'_, '_>,
    geometry: &FlowGeometryArena,
    flow: &mut FlowLayoutArena,
    out: (&mut BoundaryShapeArena, &[EdgeId]),
    next_glyph_id: &mut u32,
) -> Result<(), EngineError> {
    let (out, previous) = out;
    // A paragraph with no correctable boundary has no edge to shape.
    let corrected = !corrections.clusters.break_corrections.is_empty();
    let mut fragment_lines = flow
        .lines
        .iter()
        .copied()
        .flat_map(|line| core::iter::repeat_n(line, usize::from(line.fragment_count)));
    let fragment_count = flow.fragments.len();
    flow.fragments
        .update_ordered(0..fragment_count, |_, current| {
            let line = fragment_lines.next().ok_or(EngineError::InvalidRequest)?;
            let words = corrected
                && geometry.constraints.iter().any(|constraint| {
                    constraint.flow_thread_id == line.flow_thread_id && constraint.wrap == WRAP_WORD
                });
            let edges = if words {
                corrections.line_edge_records(
                    *current,
                    line.flow_thread_id,
                    (out, previous),
                    next_glyph_id,
                )?
            } else {
                (NO_BOUNDARY, NO_BOUNDARY)
            };
            if (current.lead_index, current.tail_index) == edges {
                return Ok(crate::engine::retained_rope::RopeUpdate::Keep);
            }
            let mut replacement = *current;
            (replacement.lead_index, replacement.tail_index) = edges;
            Ok(crate::engine::retained_rope::RopeUpdate::Replace(
                replacement,
            ))
        })
        .map_err(|error| match error {
            RopeEditError::Storage => EngineError::ResultTooLarge,
            RopeEditError::Callback(error) => error,
        })?;
    if fragment_lines.next().is_some() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

/// A line edge's clusters, how they shape, and the boundary side whose island they are exactly, if any.
pub(super) type LineEdge = ((usize, usize), (bool, bool), Option<(usize, usize)>);

/// A previous layout's boundary glyph id under `pack2(text unit of its cluster, glyph index)`: an edit moves
/// offsets but leaves a retained unit's id, so an offset is no key. A unit's glyphs sort in ordinal order.
pub(super) type EdgeId = (u64, u32);

pub(super) fn previous_edge_ids(
    ids: &mut Vec<EdgeId>,
    clusters: &ClusterArena,
    previous: &BoundaryShapeArena,
) {
    ids.clear();
    for record in &previous.records {
        let glyphs =
            record.source_glyph_start..record.source_glyph_start + record.source_glyph_count;
        for glyph in glyphs {
            let offset = previous.shape.clusters[glyph as usize];
            if let Ok(cluster) = clusters.starts.binary_search(&offset) {
                let key = sort::pack2(clusters.stable_ids[cluster], glyph);
                ids.push((key, previous.stable_ids[glyph as usize]));
            }
        }
    }
    sort::sort_pairs(ids);
}

pub(super) fn append_boundary_source_ids(
    output: &mut Vec<u32>,
    source_clusters: &[u32],
    (clusters, previous): (&ClusterArena, &[EdgeId]),
    next_glyph_id: &mut u32,
) -> Result<(), EngineError> {
    let mut previous_cluster = None;
    let mut ordinal = 0u32;
    for &text_cluster in source_clusters {
        if previous_cluster == Some(text_cluster) {
            ordinal += 1;
        } else {
            previous_cluster = Some(text_cluster);
            ordinal = 0;
        }
        let stable_id = clusters
            .starts
            .binary_search(&text_cluster)
            .ok()
            .and_then(|cluster| {
                let (start, count) = (
                    clusters.glyph_starts[cluster],
                    clusters.glyph_counts[cluster],
                );
                let own = (ordinal < count)
                    .then(|| clusters.glyph_stable_ids.get((start + ordinal) as usize))
                    .flatten();
                own.copied().filter(|id| *id != 0).or_else(|| {
                    let unit = clusters.stable_ids[cluster];
                    let at = previous.partition_point(|id| id.0 < sort::pack2(unit, 0));
                    let id = previous.get(at + ordinal as usize)?;
                    (id.0 >> 32 == u64::from(unit)).then_some(id.1)
                })
            })
            .filter(|id| *id != 0)
            .map_or_else(|| allocate_glyph_id(next_glyph_id), Ok)?;
        output.push(stable_id);
    }
    Ok(())
}
