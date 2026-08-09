use alloc::vec::Vec;

use crate::FontMetrics;

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, ClusterArena},
    flow_geometry::{FlowGeometryArena, InlineSlotArena},
    frame::{OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE, WRITING_HORIZONTAL_TB},
    line_composition::{ComposedLine, LineCursor, layout_next_line},
    style_state::StyleSegment,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowLine {
    pub flow_thread_id: u32,
    pub region_id: u32,
    pub transform_index: u32,
    pub clip_id: u32,
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
    pub boundary_index: u32,
}

pub(crate) const NO_BOUNDARY: u32 = u32::MAX;

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
    pub(crate) ellipsis_threads: Vec<u32>,
    pub(crate) recomposed_lines: Option<(usize, usize)>,
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
        )?;
        reserve(&mut self.ellipsis_threads, line_capacity)
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
                        region.record.transform_index,
                        if constraint.overflow == OVERFLOW_VISIBLE {
                            0
                        } else {
                            region.record.id
                        },
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
            if constraint.overflow == OVERFLOW_ELLIPSIS {
                let final_fragment_overflows = self.lines.last().is_some_and(|line| {
                    line.flow_thread_id == constraint.flow_thread_id
                        && usize::try_from(line.fragment_start)
                            .ok()
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
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn rebuild_one_line_if_state_converges(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        previous_clusters: &ClusterArena,
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        edit_offset: u32,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
    ) -> Result<bool, EngineError> {
        self.clear();
        if !previous.ellipsis_threads.is_empty()
            || previous.lines.is_empty()
            || previous.lines.len() > max_lines
            || previous.lines.iter().any(|line| {
                usize::try_from(line.fragment_count)
                    .map_or(true, |count| count > max_slots_per_band)
            })
            || previous_clusters.starts.len() != clusters.starts.len()
        {
            return Ok(false);
        }
        let Some(line_index) = previous.lines.iter().position(|line| {
            line_fragments(previous, *line).is_ok_and(|fragments| {
                fragments.iter().any(|fragment| {
                    fragment.line.text_start <= edit_offset
                        && edit_offset
                            < fragment
                                .line
                                .text_end
                                .max(fragment.line.text_start.saturating_add(1))
                })
            })
        }) else {
            return Ok(false);
        };
        let old_line = previous.lines[line_index];
        let old_fragments = line_fragments(previous, old_line)?;
        let Some(first_fragment) = old_fragments.first() else {
            return Ok(false);
        };
        let Some(last_fragment) = old_fragments.last() else {
            return Ok(false);
        };
        let cluster_start = usize::try_from(first_fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let old_cluster_end = usize::try_from(last_fragment.line.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?;
        if previous_clusters.stable_ids.get(cluster_start) != clusters.stable_ids.get(cluster_start)
            || (old_cluster_end < clusters.stable_ids.len()
                && previous_clusters.stable_ids.get(old_cluster_end)
                    != clusters.stable_ids.get(old_cluster_end))
        {
            return Ok(false);
        }
        let Some(region_index) = geometry
            .regions
            .iter()
            .position(|region| region.record.id == old_line.region_id)
        else {
            return Ok(false);
        };
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?;
        for prefix in 0..line_index {
            self.append_retained_line(previous, prefix)?;
        }
        let mut cursor = LineCursor::at_cluster(cluster_start);
        let composed_start = self.fragments.len();
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
            wrapping_for_flow_thread(geometry, old_line.flow_thread_id)?,
            old_line.align,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
        )?
        else {
            self.clear();
            return Ok(false);
        };
        let new_line = *self.lines.last().ok_or(EngineError::InvalidRequest)?;
        let new_fragments = self
            .fragments
            .get(composed_start..)
            .ok_or(EngineError::InvalidRequest)?;
        let converged = cursor.cluster() == old_cluster_end
            && height == old_line.height
            && new_line.baseline == old_line.baseline
            && new_fragments.len() == old_fragments.len()
            && new_fragments.iter().zip(old_fragments).all(|(new, old)| {
                new.slot_start == old.slot_start
                    && new.slot_end == old.slot_end
                    && new.line.cluster_start == old.line.cluster_start
                    && new.line.cluster_end == old.line.cluster_end
                    && new.line.text_start == old.line.text_start
                    && new.line.text_end == old.line.text_end
                    && new.line.hard_break == old.line.hard_break
            });
        if !converged {
            self.clear();
            return Ok(false);
        }
        for suffix in line_index + 1..previous.lines.len() {
            self.append_retained_line(previous, suffix)?;
        }
        self.recomposed_lines = Some((line_index, line_index + 1));
        Ok(true)
    }

    fn append_retained_line(
        &mut self,
        source: &Self,
        line_index: usize,
    ) -> Result<(), EngineError> {
        let mut line = *source
            .lines
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let fragments = line_fragments(source, line)?;
        line.fragment_start =
            u32::try_from(self.fragments.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.fragments.extend_from_slice(fragments);
        self.lines.push(line);
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
                    boundary_index: NO_BOUNDARY,
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
                transform_index,
                clip_id,
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
        self.ellipsis_threads.clear();
        self.recomposed_lines = None;
    }

    pub(crate) fn recomposed_line_range(&self) -> Option<(usize, usize)> {
        self.recomposed_lines
    }

    pub(crate) fn ellipsis_threads(&self) -> &[u32] {
        &self.ellipsis_threads
    }

    pub(crate) fn truncate_for_ellipsis(
        &mut self,
        flow_thread_id: u32,
        clusters: &ClusterArena,
        mut replacement_at: impl FnMut(usize, u32) -> Result<EllipsisReplacement, EngineError>,
    ) -> Result<Option<EllipsisTarget>, EngineError> {
        let Some(line) = self
            .lines
            .iter()
            .rev()
            .find(|line| line.flow_thread_id == flow_thread_id)
            .copied()
        else {
            return Ok(None);
        };
        let fragment_start =
            usize::try_from(line.fragment_start).map_err(|_| EngineError::InvalidRequest)?;
        let fragment_end = fragment_start
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_index = fragment_end
            .checked_sub(1)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment = self
            .fragments
            .get_mut(fragment_index)
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
        fragment.line.cluster_end =
            u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?;
        fragment.line.text_end = text_end;
        fragment.line.advance = (source_advance + replacement.advance_adjustment).max(0.0);
        fragment.line.hard_break = false;
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

fn line_fragments(flow: &FlowLayoutArena, line: FlowLine) -> Result<&[FlowFragment], EngineError> {
    let start = usize::try_from(line.fragment_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::from(line.fragment_count))
        .ok_or(EngineError::InvalidRequest)?;
    flow.fragments
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)
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
            OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE, SHAPE_RECTANGLE, WRAP_CHARACTER, WRAP_NONE,
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

    #[test]
    fn localized_edit_recomposes_one_line_and_reuses_converged_prefix_and_suffix() {
        let make_clusters = |advances: Vec<f64>| ClusterArena {
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
                descender: -200,
                line_gap: 0,
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
                .rebuild_one_line_if_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    2,
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                )
                .unwrap()
        );
        assert_eq!(changed.lines.len(), 3);
        assert_eq!(changed.fragments[0], retained_prefix);
        assert_eq!(changed.fragments[1].line.advance, 3.0);
        assert_eq!(changed.fragments[2], retained_suffix);
    }

    #[test]
    fn localized_edit_clears_partial_layout_when_line_state_does_not_converge() {
        let make_clusters = |advances: Vec<f64>| ClusterArena {
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
                descender: -200,
                line_gap: 0,
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
                .rebuild_one_line_if_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    2,
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                )
                .unwrap()
        );
        assert!(changed.lines.is_empty());
        assert!(changed.fragments.is_empty());
        assert_eq!(changed.recomposed_line_range(), None);
    }

    #[test]
    fn ellipsis_truncation_reuses_the_final_slot_and_removes_only_required_clusters() {
        let clusters = ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            ..ClusterArena::default()
        };
        let mut layout = FlowLayoutArena {
            lines: vec![FlowLine {
                flow_thread_id: 7,
                region_id: 1,
                transform_index: 0,
                clip_id: 1,
                fragment_start: 0,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 6.0,
                    hard_break: false,
                },
                slot_start: 0.0,
                slot_end: 10.0,
                boundary_index: NO_BOUNDARY,
            }],
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
    }

    #[test]
    fn complete_no_wrap_line_still_requests_ellipsis_when_its_slot_overflows() {
        let clusters = ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![3.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE; 3],
            style_indexes: vec![0; 3],
            source_runs: vec![0; 3],
            font_handles: vec![1; 3],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
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
                        descender: -200,
                        line_gap: 0,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(layout.fragments[0].line.cluster_end, 3);
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
