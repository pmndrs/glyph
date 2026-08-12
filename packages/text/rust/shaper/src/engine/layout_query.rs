//! Demand-shaped semantic layout views.
//!
//! These records share the immutable frame publication for lifetime and transport only. They are
//! not render-plan commands and render executors must not consume them.

use alloc::vec::Vec;

use super::{
    EngineError,
    cluster_state::ClusterArena,
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    flow_geometry::FlowGeometryArena,
    frame::{AXIS_AT_MOST, AXIS_EXACT, AXIS_UNCONSTRAINED},
    positioning::{SemanticGlyph, positioned_fragment_advance},
    semantic_view::{
        SEMANTIC_GLYPH, SEMANTIC_LINE, SEMANTIC_PARAGRAPH_MEASUREMENT, SemanticRecord,
    },
};

pub(crate) const MEASUREMENT_FLAG_OVERFLOWED: u16 = 1;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LayoutExtents {
    pub width: f64,
    pub height: f64,
    pub consumed_clusters: usize,
}

pub(crate) fn append_measurement(
    target: &mut Vec<SemanticRecord>,
    paragraph_id: u32,
    text_length: usize,
    cluster_count: usize,
    geometry: &FlowGeometryArena,
    flow: &FlowLayoutArena,
    positioned_glyphs: &[SemanticGlyph],
    semantic_line_glyph_starts: &[u32],
    semantic_line_glyph_counts: &[u32],
    semantic_line_inline_extents: Option<&[f64]>,
    text: &[u16],
    clusters: &ClusterArena,
    intrinsic_extents: Option<LayoutExtents>,
    include_glyphs: bool,
) -> Result<(), EngineError> {
    let constraint = geometry
        .constraints
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    if constraint.paragraph_id != paragraph_id {
        return Err(EngineError::InvalidRequest);
    }
    if include_glyphs
        && (semantic_line_glyph_starts.len() != flow.lines.len()
            || semantic_line_glyph_counts.len() != flow.lines.len())
        || semantic_line_inline_extents.is_some_and(|extents| extents.len() != flow.lines.len())
    {
        return Err(EngineError::InvalidRequest);
    }
    let mut line_count = 0_usize;
    for line in flow.lines.iter().copied() {
        if line.flow_thread_id == constraint.flow_thread_id
            && !line_fragments(flow, line)?.is_empty()
        {
            line_count = line_count
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
        }
    }
    let reserve = line_count
        .saturating_add(1)
        .saturating_add(if include_glyphs {
            positioned_glyphs.len()
        } else {
            0
        });
    target
        .try_reserve(reserve)
        .map_err(|_| EngineError::ResultTooLarge)?;

    let summary_index = target.len();
    let line_start =
        u32::try_from(summary_index.saturating_add(1)).map_err(|_| EngineError::ResultTooLarge)?;
    let glyph_record_start = summary_index
        .checked_add(1)
        .and_then(|value| value.checked_add(line_count))
        .ok_or(EngineError::ResultTooLarge)?;
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
        let advance = if let Some(extents) = semantic_line_inline_extents {
            extents[index]
        } else {
            line_inline_extent(flow, line, index, text, clusters)?
        };
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
            item_start: if include_glyphs {
                u32::try_from(glyph_record_start)
                    .map_err(|_| EngineError::ResultTooLarge)?
                    .checked_add(semantic_line_glyph_starts[index])
                    .ok_or(EngineError::ResultTooLarge)?
            } else {
                0
            },
            item_count: if include_glyphs {
                semantic_line_glyph_counts[index]
            } else {
                0
            },
            block_start: finite_f32(line.block_start + line.baseline)?,
            inline_extent: finite_nonnegative_f32(advance)?,
            block_extent: finite_nonnegative_f32(line.height)?,
            ..SemanticRecord::default()
        });
    }

    if include_glyphs {
        if target.len() != glyph_record_start {
            return Err(EngineError::InvalidRequest);
        }
        for glyph in positioned_glyphs {
            target.push(SemanticRecord {
                id: glyph.stable_id,
                kind: SEMANTIC_GLYPH,
                flags: glyph.flags,
                parent_id: paragraph_id,
                text_start: glyph.cluster,
                text_end: glyph.font_handle,
                item_start: u32::from(glyph.glyph_id),
                inline_start: glyph.inline_origin,
                block_start: glyph.block_origin,
                inline_extent: glyph.font_size,
                ..SemanticRecord::default()
            });
        }
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
    let missing_glyph_count = positioned_glyphs
        .iter()
        .filter(|glyph| glyph.glyph_id == 0)
        .count();
    target[summary_index] = SemanticRecord {
        id: paragraph_id,
        kind: SEMANTIC_PARAGRAPH_MEASUREMENT,
        flags: if overflowed {
            MEASUREMENT_FLAG_OVERFLOWED
        } else {
            0
        },
        parent_id: u32::try_from(positioned_glyphs.len())
            .map_err(|_| EngineError::ResultTooLarge)?,
        text_start: u32::try_from(missing_glyph_count).map_err(|_| EngineError::ResultTooLarge)?,
        text_end: u32::try_from(text_length).map_err(|_| EngineError::ResultTooLarge)?,
        item_start: line_start,
        item_count: u32::try_from(line_count).map_err(|_| EngineError::ResultTooLarge)?,
        inline_start: width,
        block_start: height,
        inline_extent: finite_nonnegative_f32(full_content_width)?,
        block_extent: finite_nonnegative_f32(full_content_height)?,
        ..SemanticRecord::default()
    };
    Ok(())
}

pub(crate) fn flow_extents(
    flow_thread_id: u32,
    flow: &FlowLayoutArena,
    text: &[u16],
    clusters: &ClusterArena,
) -> Result<LayoutExtents, EngineError> {
    let mut extents = LayoutExtents::default();
    for (index, line) in flow.lines.iter().copied().enumerate() {
        if line.flow_thread_id != flow_thread_id {
            continue;
        }
        let fragments = line_fragments(flow, line)?;
        if fragments.is_empty() {
            continue;
        }
        let Some(last) = fragments.last() else {
            continue;
        };
        extents.width = extents
            .width
            .max(line_inline_extent(flow, line, index, text, clusters)?);
        extents.height = extents.height.max(line.block_start + line.height);
        extents.consumed_clusters = extents
            .consumed_clusters
            .max(usize::try_from(last.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?);
    }
    Ok(extents)
}

fn line_inline_extent(
    flow: &FlowLayoutArena,
    line: FlowLine,
    index: usize,
    text: &[u16],
    clusters: &ClusterArena,
) -> Result<f64, EngineError> {
    let fragments = line_fragments(flow, line)?;
    if fragments.is_empty() {
        return Ok(0.0);
    }
    let final_line = flow
        .lines
        .get(index + 1)
        .is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
    let inline_start = fragments
        .iter()
        .map(|fragment| fragment.slot_start)
        .fold(f64::INFINITY, f64::min);
    let mut inline_end = f64::NEG_INFINITY;
    for fragment in fragments.iter().copied() {
        inline_end = inline_end.max(
            fragment.slot_start
                + positioned_fragment_advance(line, fragment, final_line, text, clusters)?,
        );
    }
    Ok((inline_end - inline_start).max(0.0))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        flow_composition::{FlowFragment, FlowLine, NO_BOUNDARY},
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
                boundary_index: NO_BOUNDARY,
            }],
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
            &[0],
            &[2],
            Some(&[7.0]),
            &[],
            &ClusterArena::default(),
            None,
            false,
        )
        .unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].kind, SEMANTIC_PARAGRAPH_MEASUREMENT);
        assert_eq!(records[0].id, 7);
        assert_eq!(records[0].flags, 0);
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
            &[0],
            &[2],
            Some(&[7.0]),
            &[],
            &ClusterArena::default(),
            None,
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
    }

    #[test]
    fn constrained_measurement_preserves_demanded_intrinsic_content_extents() {
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
                boundary_index: NO_BOUNDARY,
            }],
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
            &[0],
            &[0],
            Some(&[7.0]),
            &[],
            &ClusterArena::default(),
            Some(LayoutExtents {
                width: 9.0,
                height: 8.0,
                consumed_clusters: 2,
            }),
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
                flow_thread_id: 11,
                region_id: 3,
                transform_index: 1,
                clip_id: 0,
                fragment_start: 0,
                fragment_count: 1,
                align: 1,
                block_start: 0.0,
                baseline: 100.0,
                height: 140.64,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 1,
                    text_start: 0,
                    text_end: 1,
                    advance: 140.64,
                    hard_break: false,
                },
                slot_start: 0.0,
                slot_end: 140.64,
                boundary_index: NO_BOUNDARY,
            }],
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
            &[0],
            &[0],
            Some(&[140.64]),
            &[],
            &ClusterArena::default(),
            None,
            false,
        )
        .unwrap();

        assert_eq!(records[0].flags, 0);
        assert_eq!(records[0].inline_start, 140.64_f32);
        assert_eq!(records[0].block_start, 140.64_f32);
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
        }
    }

    fn layout_glyph(glyph_id: u16) -> SemanticGlyph {
        SemanticGlyph {
            stable_id: u32::from(glyph_id) + 1,
            font_handle: 1,
            glyph_id,
            cluster: 0,
            flags: 0,
            font_size: 16.0,
            inline_origin: 0.0,
            block_origin: 0.0,
        }
    }
}
