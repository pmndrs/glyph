use alloc::vec::Vec;

use crate::FontMetrics;

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, ClusterArena},
    flow_geometry::{FlowGeometryArena, InlineSlotArena},
    frame::WRITING_HORIZONTAL_TB,
    line_composition::{ComposedLine, LineCursor, layout_next_line},
    style_state::StyleSegment,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowLine {
    pub flow_thread_id: u32,
    pub region_id: u32,
    pub fragment_start: u32,
    pub fragment_count: u16,
    pub align: u8,
    pub block_start: f64,
    pub baseline: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowFragment {
    pub line: ComposedLine,
    pub slot_start: f64,
    pub slot_end: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct LineExtents {
    above: f64,
    below: f64,
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

#[derive(Default)]
pub(crate) struct FlowLayoutArena {
    pub lines: Vec<FlowLine>,
    pub fragments: Vec<FlowFragment>,
}

impl FlowLayoutArena {
    pub(crate) fn reserve(
        &mut self,
        line_capacity: usize,
        max_slots_per_band: usize,
    ) -> Result<(), EngineError> {
        reserve(&mut self.lines, line_capacity)?;
        reserve(
            &mut self.fragments,
            line_capacity.saturating_mul(max_slots_per_band),
        )
    }

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
        self.clear();
        if clusters.starts.is_empty() || geometry.constraints.is_empty() {
            return Ok(());
        }
        self.reserve(max_lines, max_slots_per_band)?;
        for constraint in geometry.constraints.iter().copied() {
            let resume = cluster_for_offset(clusters, constraint.resume_cluster)?;
            let mut cursor = LineCursor::at_cluster(resume);
            let region_start = usize::try_from(constraint.region_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let first_region = region_start
                .checked_add(usize::from(constraint.resume_region))
                .ok_or(EngineError::InvalidRequest)?;
            let region_end = region_start
                .checked_add(usize::from(constraint.region_count))
                .ok_or(EngineError::InvalidRequest)?;
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
                        clusters,
                        styles,
                        slots,
                        &mut cursor,
                        block,
                        block_end,
                        estimate,
                        constraint.wrap,
                        constraint.align,
                        max_slots_per_band,
                        metrics_for,
                        first_font_for_stack,
                    )? {
                        Some(height) => block += height,
                        None => block += estimate.height(),
                    }
                }
            }
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
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        slot_arena: &mut InlineSlotArena,
        cursor: &mut LineCursor,
        block_start: f64,
        region_block_end: f64,
        initial_extents: LineExtents,
        wrap: u8,
        align: u8,
        max_slots: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
    ) -> Result<Option<f64>, EngineError> {
        let saved_cursor = *cursor;
        let fragment_start = self.fragments.len();
        let mut extents = initial_extents;
        for attempt in 0..2 {
            let height = extents.height();
            if block_start + height > region_block_end {
                self.fragments.truncate(fragment_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            let available = slot_arena.resolve_band(
                geometry,
                region_index,
                block_start,
                block_start + height,
                max_slots,
            )?;
            if available.is_empty() {
                self.fragments.truncate(fragment_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            let mut measured = LineExtents::default();
            let mut composed = false;
            for slot in available.iter().copied() {
                let Some(line) = layout_next_line(clusters, cursor, slot.end - slot.start, wrap)?
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
                self.fragments.push(FlowFragment {
                    line,
                    slot_start: slot.start,
                    slot_end: slot.end,
                });
                composed = true;
                if line.hard_break || cursor.is_complete(clusters.starts.len()) {
                    break;
                }
            }
            if !composed {
                self.fragments.truncate(fragment_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            measured.include(initial_extents);
            if attempt == 0 && measured.height() > height {
                self.fragments.truncate(fragment_start);
                *cursor = saved_cursor;
                extents = measured;
                continue;
            }
            let fragment_count = self.fragments.len() - fragment_start;
            self.lines.push(FlowLine {
                flow_thread_id,
                region_id,
                fragment_start: u32::try_from(fragment_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                fragment_count: u16::try_from(fragment_count)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                align,
                block_start,
                baseline: extents.above,
                height: extents.height(),
            });
            return Ok(Some(extents.height()));
        }
        Err(EngineError::InvalidRequest)
    }

    pub(crate) fn clear(&mut self) {
        self.lines.clear();
        self.fragments.clear();
    }
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
    for index in start..end {
        if clusters.flags[index] & CLUSTER_HARD_BREAK == 0 {
            target.include(extents_for_cluster(
                clusters,
                styles,
                index,
                metrics_for,
                first_font_for_stack,
            )?);
        }
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
    let selected = clusters.font_handles.get(index).copied().unwrap_or(0);
    let font_handle = if selected == 0 {
        first_font_for_stack(style.font_stack_handle).ok_or(EngineError::FontStackMissing)?
    } else {
        selected
    };
    let metrics = metrics_for(font_handle).ok_or(EngineError::InvalidRequest)?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
    let ascent = (f64::from(metrics.ascender) * scale).max(0.0);
    let descent = (-f64::from(metrics.descender) * scale).max(0.0);
    let natural = (f64::from(metrics.ascender) - f64::from(metrics.descender)
        + f64::from(metrics.line_gap))
        * scale;
    let requested = if style.has_line_height {
        f64::from(style.font_size * style.line_height)
    } else {
        natural
    };
    let leading = (requested - ascent - descent).max(0.0);
    let shift = f64::from(style.baseline_shift);
    Ok(LineExtents {
        above: (ascent + leading * 0.5 + shift).max(0.0),
        below: (descent + leading * 0.5 - shift).max(0.0),
    })
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
    use crate::engine::{
        cluster_state::CLUSTER_SAFE_BEFORE,
        flow_geometry::{RetainedExclusion, RetainedRegion},
        frame::{
            ALIGN_START, AXIS_EXACT, BLOCK_ALIGN_START, EXCLUSION_WRAP_BOTH, ORIENTATION_MIXED,
            OVERFLOW_VISIBLE, SHAPE_RECTANGLE, WRAP_CHARACTER,
        },
        semantic_wire::{FlowConstraint, FlowExclusion, FlowRegion},
        style_state::ResolvedStyle,
    };
    use alloc::vec;

    #[test]
    fn one_update_flows_fragments_around_a_hole_and_retries_for_tall_text() {
        let clusters = ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![2.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0, 0, 1, 1],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        };
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
                        descender: -200,
                        line_gap: 0,
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
    fn overflowing_text_continues_through_ordered_regions_without_balancing() {
        let clusters = ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0; 4],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        };
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
                        descender: -200,
                        line_gap: 0,
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
        assert_eq!(layout.fragments.last().unwrap().line.cluster_end, 4);
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
        }
    }

    fn region() -> FlowRegion {
        FlowRegion {
            id: 7,
            geometry_revision: 1,
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
