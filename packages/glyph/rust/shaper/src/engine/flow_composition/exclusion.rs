//! Rebuilding the lines of one region after its exclusions changed, until the flow converges.

use super::*;

impl FlowLayoutArena {
    pub(super) fn append_converged_suffix(
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
    pub(crate) fn rebuild_after_exclusion_change_until_state_converges(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        dirty: ExclusionDirtyBand,
        (bidi, previous_bidi): (&BidiAnalysis, &BidiAnalysis),
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<bool, EngineError> {
        let paragraph_level = first_paragraph_level(bidi);
        self.clear();
        if !reading_order_retained(geometry, previous_bidi, bidi) {
            return Ok(false);
        }
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
            previous
                .line_fragments(line_index)?
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
        let block = if let Some(line) = last_prefix_line {
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
        // The line the new flow rejoins the previous one at: the first composed at or below
        // the dirty band that is, record for record, the previous line of its index.
        let mut converged_line = None;
        let mut rejoins = |flow: &Self, composed_block: f64| -> Result<bool, EngineError> {
            if composed_block < dirty.block_end {
                return Ok(false);
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
                return Ok(false);
            };
            let new_line_index = flow
                .lines
                .len()
                .checked_sub(1)
                .ok_or(EngineError::InvalidRequest)?;
            let new_line = flow
                .lines
                .iter()
                .next_back()
                .copied()
                .ok_or(EngineError::InvalidRequest)?;
            let new_fragment_start = flow
                .fragments
                .len()
                .checked_sub(usize::from(new_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            let new_fragments = flow
                .fragments
                .range(new_fragment_start..flow.fragments.len())
                .ok_or(EngineError::InvalidRequest)?;
            if *old_line_index != new_line_index
                || !same_flow_line_records(new_line, &new_fragments, *old_line, old_fragments)
            {
                return Ok(false);
            }
            converged_line = Some(*old_line_index);
            Ok(true)
        };
        self.compose_region_bands(
            geometry,
            region_index,
            &constraint,
            clusters,
            bidi,
            styles,
            slots,
            &mut cursor,
            block,
            &mut drop_cap,
            thread_line_start,
            constraint_line_limit.min(max_lines.saturating_sub(thread_line_start)),
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
            corrections,
            None,
            Some(&mut rejoins),
        )?;
        if let Some(old_line_index) = converged_line {
            self.append_converged_suffix(
                previous,
                geometry,
                constraint.flow_thread_id,
                drop_cap,
                old_line_index,
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
}

pub(super) fn same_flow_line_records(
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
        || !same_line_typography(left_line.typography, right_line.typography)
    {
        return false;
    }
    left_fragments.len() == right_fragments.len()
        && left_fragments
            .iter()
            .zip(right_fragments.iter())
            .all(|(left, right)| same_flow_fragment_state(*left, *right))
}

pub(super) fn same_line_typography(left: LineTypography, right: LineTypography) -> bool {
    left.ascent.to_bits() == right.ascent.to_bits()
        && left.descent.to_bits() == right.descent.to_bits()
        && left.cap_height.to_bits() == right.cap_height.to_bits()
        && left.x_height.to_bits() == right.x_height.to_bits()
        && left.cap_over.to_bits() == right.cap_over.to_bits()
        && left.x_over.to_bits() == right.x_over.to_bits()
        && left.height_fallbacks == right.height_fallbacks
        && left.present == right.present
}

pub(super) fn same_flow_fragment_state(left: FlowFragment, right: FlowFragment) -> bool {
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
