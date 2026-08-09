//! Demand-shaped semantic layout views.
//!
//! These records share the immutable frame publication for lifetime and transport only. They are
//! not render-plan commands and render executors must not consume them.

use alloc::vec::Vec;

use super::{
    EngineError,
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    flow_geometry::FlowGeometryArena,
    frame::{AXIS_AT_MOST, AXIS_EXACT, AXIS_UNCONSTRAINED},
    semantic_view::{SEMANTIC_LINE, SEMANTIC_PARAGRAPH_MEASUREMENT, SemanticRecord},
};

pub(crate) const MEASUREMENT_FLAG_OVERFLOWED: u16 = 1;

pub(crate) fn append_measurement(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    flow: &FlowLayoutArena,
) -> Result<(), EngineError> {
    let constraint = geometry
        .constraints
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    if constraint.paragraph_id != paragraph_id {
        return Err(EngineError::InvalidRequest);
    }
    target
        .try_reserve(flow.lines.len().saturating_add(1))
        .map_err(|_| EngineError::ResultTooLarge)?;

    let summary_index = target.len();
    let line_start =
        u32::try_from(summary_index.saturating_add(1)).map_err(|_| EngineError::ResultTooLarge)?;
    target.push(SemanticRecord::default());
    let mut content_width = 0.0_f64;
    let mut content_height = 0.0_f64;
    let mut consumed_clusters =
        usize::try_from(constraint.resume_cluster).map_err(|_| EngineError::InvalidRequest)?;

    for (index, line) in flow.lines.iter().copied().enumerate() {
        if line.flow_thread_id != constraint.flow_thread_id {
            continue;
        }
        let fragments = line_fragments(flow, line)?;
        let Some(first) = fragments.first() else {
            continue;
        };
        let Some(last) = fragments.last() else {
            continue;
        };
        let inline_start = fragments
            .iter()
            .map(|fragment| fragment.slot_start)
            .fold(f64::INFINITY, f64::min);
        let inline_end = fragments
            .iter()
            .map(|fragment| fragment.slot_start + fragment.line.advance)
            .fold(f64::NEG_INFINITY, f64::max);
        let advance = (inline_end - inline_start).max(0.0);
        content_width = content_width.max(advance);
        content_height = content_height.max(line.block_start + line.height);
        consumed_clusters = consumed_clusters
            .max(usize::try_from(last.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?);
        target.push(SemanticRecord {
            id: u32::try_from(index.saturating_add(1)).map_err(|_| EngineError::ResultTooLarge)?,
            kind: SEMANTIC_LINE,
            parent_id: paragraph_id,
            text_start: first.line.text_start,
            text_end: last.line.text_end,
            block_start: finite_f32(line.block_start + line.baseline)?,
            inline_extent: finite_nonnegative_f32(advance)?,
            block_extent: finite_nonnegative_f32(line.height)?,
            ..SemanticRecord::default()
        });
    }

    let width = resolve_axis(constraint.width_mode, constraint.width, content_width)?;
    let height = resolve_axis(constraint.height_mode, constraint.height, content_height)?;
    let overflowed = consumed_clusters < cluster_count
        || content_width > f64::from(width)
        || content_height > f64::from(height);
    let line_count = target.len().saturating_sub(summary_index + 1);
    target[summary_index] = SemanticRecord {
        id: paragraph_id,
        kind: SEMANTIC_PARAGRAPH_MEASUREMENT,
        flags: if overflowed {
            MEASUREMENT_FLAG_OVERFLOWED
        } else {
            0
        },
        text_end: u32::try_from(text_length).map_err(|_| EngineError::ResultTooLarge)?,
        item_start: line_start,
        item_count: u32::try_from(line_count).map_err(|_| EngineError::ResultTooLarge)?,
        inline_start: width,
        block_start: height,
        inline_extent: finite_nonnegative_f32(content_width)?,
        block_extent: finite_nonnegative_f32(content_height)?,
        ..SemanticRecord::default()
    };
    Ok(())
}

fn line_fragments(flow: &FlowLayoutArena, line: FlowLine) -> Result<&[FlowFragment], EngineError> {
    let start = usize::try_from(line.fragment_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::from(line.fragment_count))
        .ok_or(EngineError::InvalidRequest)?;
    flow.fragments
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)
}

fn resolve_axis(mode: u8, requested: f32, content: f64) -> Result<f32, EngineError> {
    match mode {
        AXIS_UNCONSTRAINED => finite_nonnegative_f32(content),
        AXIS_AT_MOST => finite_nonnegative_f32(content.min(f64::from(requested))),
        AXIS_EXACT => Ok(requested),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        flow_composition::{FlowFragment, FlowLine},
        line_composition::ComposedLine,
        semantic_wire::FlowConstraint,
    };

    #[test]
    fn measurement_is_demand_shaped_from_retained_lines_without_glyph_arrays() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_EXACT, 20.0, AXIS_EXACT, 10.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_start: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 7.0,
                    hard_break: false,
                },
                slot_start: 0.0,
                slot_end: 20.0,
            }],
        };
        let mut records = vec![];
        append_measurement(&mut records, 7, 2, 2, &geometry, &flow).unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].kind, SEMANTIC_PARAGRAPH_MEASUREMENT);
        assert_eq!(records[0].id, 7);
        assert_eq!(records[0].flags, 0);
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
    }

    #[test]
    fn constrained_measurement_reports_content_overflow_independently_of_box_size() {
        let geometry = FlowGeometryArena {
            constraints: vec![constraint(AXIS_AT_MOST, 6.0, AXIS_AT_MOST, 4.0)],
            ..FlowGeometryArena::default()
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_start: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 4.0,
                height: 5.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 1,
                    text_start: 0,
                    text_end: 1,
                    advance: 7.0,
                    hard_break: false,
                },
                slot_start: 0.0,
                slot_end: 6.0,
            }],
        };
        let mut records = vec![];
        append_measurement(&mut records, 7, 2, 2, &geometry, &flow).unwrap();

        assert_eq!(records[0].flags, MEASUREMENT_FLAG_OVERFLOWED);
        assert_eq!(records[0].inline_start, 6.0);
        assert_eq!(records[0].block_start, 4.0);
        assert_eq!(records[0].inline_extent, 7.0);
        assert_eq!(records[0].block_extent, 5.0);
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
        }
    }
}
