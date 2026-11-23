//! Per-thread layout settings read from the flow geometry, and cluster lookups by text offset.

use super::*;

/// The text offset the line at `cursor` begins at; the end of the text for the empty line
/// after a final hard break.
pub(super) fn line_text_start(clusters: &ClusterArena, cursor: LineCursor) -> u32 {
    clusters
        .starts
        .get(cursor.cluster())
        .or(clusters.ends.last())
        .copied()
        .unwrap_or(0)
}

pub(super) fn wrapping_for_flow_thread(
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

pub(super) fn flexible_for_flow_thread(
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

pub(super) fn inline_limit_for_flow_thread(
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

pub(super) fn indent_for_flow_thread(
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
pub(crate) fn constraint_word_space_shrink(constraint: &FlowConstraint) -> f64 {
    if constraint.align == ALIGN_JUSTIFY && constraint.justify_min_word_space_ratio > 0.0 {
        1.0 - f64::from(constraint.justify_min_word_space_ratio)
    } else {
        0.0
    }
}

pub(super) fn shrink_for_flow_thread(
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

pub(super) fn cluster_for_offset(
    clusters: &ClusterArena,
    offset: u32,
) -> Result<usize, EngineError> {
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
