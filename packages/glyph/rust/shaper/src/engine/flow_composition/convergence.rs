//! Rebuilding only the lines a text edit dirtied, until the new flow converges with the previous one.

use super::*;

impl FlowLayoutArena {
    pub(super) fn supports_local_convergence(
        previous: &Self,
        max_lines: usize,
        max_slots_per_band: usize,
    ) -> bool {
        previous.ellipsis_threads.is_empty()
            && !previous.lines.is_empty()
            && previous.lines.len() <= max_lines
            && previous
                .lines
                .iter()
                .all(|line| usize::from(line.fragment_count) <= max_slots_per_band)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn convergence_context(
        previous: &Self,
        geometry: &FlowGeometryArena,
        constraint: FlowConstraint,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        paragraph_level: u8,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
    ) -> Result<(Option<FlowDropCap>, Option<FlowDropCap>, usize), EngineError> {
        let region_start =
            usize::try_from(constraint.region_start).map_err(|_| EngineError::InvalidRequest)?;
        let first_region_index = region_start
            .checked_add(usize::from(constraint.resume_region))
            .ok_or(EngineError::InvalidRequest)?;
        let first_region = geometry
            .regions
            .get(first_region_index)
            .ok_or(EngineError::InvalidRequest)?
            .record;
        let mut first_block =
            f64::from(first_region.block_start) + f64::from(constraint.resume_block_offset);
        if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
            first_block += f64::from(constraint.space_before);
        }
        let drop_cap = prepare_drop_cap(
            constraint,
            first_region,
            clusters,
            runs,
            paragraph_level,
            first_block,
            styles,
            metrics_for,
            first_font_for_stack,
        )?;
        let previous_cap = previous
            .drop_caps
            .iter()
            .copied()
            .find(|cap| cap.line.flow_thread_id == constraint.flow_thread_id);
        let thread_line_start = previous
            .lines
            .iter()
            .position(|line| line.flow_thread_id == constraint.flow_thread_id)
            .ok_or(EngineError::InvalidRequest)?;
        Ok((drop_cap, previous_cap, thread_line_start))
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn rebuild_until_state_converges(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        previous_clusters: &ClusterArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        dirty_ranges: impl IntoIterator<Item = Range<u32>>,
        (bidi, previous_bidi): (&BidiAnalysis, &BidiAnalysis),
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<bool, EngineError> {
        let paragraph_level = first_paragraph_level(bidi);
        self.clear();
        if !reading_order_retained(geometry, previous_bidi, bidi)
            || !Self::supports_local_convergence(previous, max_lines, max_slots_per_band)
            || previous_clusters.starts.len() != clusters.starts.len()
        {
            return Ok(false);
        }
        let mut dirty_ranges = dirty_ranges.into_iter().peekable();
        let Some(dirty) = dirty_ranges.next().filter(|dirty| dirty.start < dirty.end) else {
            return Ok(false);
        };
        let Some((edited_cap, line_index, constraint)) =
            previous.convergence_start(geometry, dirty.start)?
        else {
            return Ok(false);
        };
        let (drop_cap, previous_cap, thread_line_start) = Self::convergence_context(
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
        let line_index = if edited_cap || previous_cap != drop_cap {
            thread_line_start
        } else {
            line_index
        };
        let convergence = Convergence {
            previous,
            geometry,
            previous_clusters,
            clusters,
            styles,
            bidi,
            constraint,
            thread_line_start,
            previous_cap,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
        };
        let converged = self.converge_dirty_ranges(
            &convergence,
            slots,
            &mut dirty_ranges,
            dirty,
            line_index,
            drop_cap,
            corrections,
        )?;
        // A rebuild that does not converge leaves nothing behind for the caller to misread.
        if !converged {
            self.clear();
        }
        Ok(converged)
    }

    /// Where a convergence rebuild for the dirty range starting at `dirty_start` begins: whether
    /// the edit touches a drop cap, the first line to recompose and the edited thread's constraint.
    #[inline(always)]
    pub(super) fn convergence_start(
        &self,
        geometry: &FlowGeometryArena,
        dirty_start: u32,
    ) -> Result<Option<(bool, usize, FlowConstraint)>, EngineError> {
        let edited_cap = self.drop_caps.iter().copied().find(|cap| {
            cap.fragment.line.text_start <= dirty_start
                && dirty_start
                    < cap
                        .fragment
                        .line
                        .text_end
                        .max(cap.fragment.line.text_start.saturating_add(1))
        });
        let edited_line = self.source_restart_line(dirty_start);
        let Some(line_index) = edited_cap
            .and_then(|cap| {
                self.lines
                    .iter()
                    .position(|line| line.flow_thread_id == cap.line.flow_thread_id)
            })
            .or(edited_line)
        else {
            return Ok(None);
        };
        let flow_thread_id = edited_cap
            .map(|cap| cap.line.flow_thread_id)
            .unwrap_or(self.lines[line_index].flow_thread_id);
        let constraint = *geometry
            .constraints
            .iter()
            .find(|constraint| constraint.flow_thread_id == flow_thread_id)
            .ok_or(EngineError::InvalidRequest)?;
        Ok(Some((edited_cap.is_some(), line_index, constraint)))
    }

    /// Recomposes each dirty range from its restart line until the new lines converge with the
    /// previous ones, retaining every line in between. Returns whether every range converged.
    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    pub(super) fn converge_dirty_ranges<M, F>(
        &mut self,
        convergence: &Convergence<'_, M, F>,
        slots: &mut InlineSlotArena,
        dirty_ranges: &mut core::iter::Peekable<impl Iterator<Item = Range<u32>>>,
        mut dirty: Range<u32>,
        mut line_index: usize,
        mut drop_cap: Option<FlowDropCap>,
        corrections: &mut impl BreakCorrections,
    ) -> Result<bool, EngineError>
    where
        M: Fn(u32) -> Option<FontMetrics> + Copy,
        F: Fn(u32) -> Option<u32> + Copy,
    {
        let previous = convergence.previous;
        let flow_thread_id = convergence.constraint.flow_thread_id;
        let mut retained_line_cursor = 0usize;
        loop {
            let Some(cluster_start) = convergence.restart_cluster(line_index, drop_cap.as_ref())?
            else {
                return Ok(false);
            };
            self.append_retained_range(previous, retained_line_cursor..line_index)?;
            let mut cursor = LineCursor::at_cluster(cluster_start);
            if convergence.constraint.wrap == WRAP_WORD {
                cursor.start_correction = corrections.right(cluster_start)?;
            }
            let Some(candidate) = self.recompose_until_converged(
                convergence,
                slots,
                dirty_ranges,
                &mut dirty,
                line_index,
                &mut cursor,
                &mut drop_cap,
                corrections,
            )?
            else {
                return Ok(false);
            };
            self.mark_recomposed_lines(line_index..candidate + 1)?;
            retained_line_cursor = candidate + 1;
            let Some(next_dirty) = dirty_ranges.next() else {
                self.finish_converged_thread(
                    previous,
                    convergence.geometry,
                    flow_thread_id,
                    drop_cap,
                    retained_line_cursor,
                )?;
                return Ok(true);
            };
            if next_dirty.start < dirty.end || next_dirty.start >= next_dirty.end {
                return Ok(false);
            }
            dirty = next_dirty;
            let Some(next_line) = previous.source_restart_line(dirty.start) else {
                return Ok(false);
            };
            if next_line < retained_line_cursor
                || previous.lines[next_line].flow_thread_id != flow_thread_id
            {
                return Ok(false);
            }
            line_index = next_line;
        }
    }

    /// Recomposes previous lines from `line_index` until one ends where its predecessor did, with
    /// the same metrics and break state, past the dirty range. Returns that line, or `None` when
    /// the rebuild diverges.
    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    pub(super) fn recompose_until_converged<M, F>(
        &mut self,
        convergence: &Convergence<'_, M, F>,
        slots: &mut InlineSlotArena,
        dirty_ranges: &mut core::iter::Peekable<impl Iterator<Item = Range<u32>>>,
        dirty: &mut Range<u32>,
        line_index: usize,
        cursor: &mut LineCursor,
        drop_cap: &mut Option<FlowDropCap>,
        corrections: &mut impl BreakCorrections,
    ) -> Result<Option<usize>, EngineError>
    where
        M: Fn(u32) -> Option<FontMetrics> + Copy,
        F: Fn(u32) -> Option<u32> + Copy,
    {
        let previous = convergence.previous;
        let candidate_lines = previous
            .lines
            .range(line_index..previous.lines.len())
            .ok_or(EngineError::InvalidRequest)?;
        let mut candidate_lines = candidate_lines.iter().copied().enumerate().peekable();
        let previous_fragment_start = previous
            .line_fragment_start(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let mut previous_fragment_cursor = previous
            .fragments
            .cursor_from(previous_fragment_start)
            .ok_or(EngineError::InvalidRequest)?;
        while let Some((offset, old_line)) = candidate_lines.next() {
            let next_line = candidate_lines.peek().map(|(_, line)| *line);
            let candidate = line_index
                .checked_add(offset)
                .ok_or(EngineError::ResultTooLarge)?;
            if old_line.flow_thread_id != convergence.constraint.flow_thread_id {
                return Ok(None);
            }
            let old_fragments = previous_fragment_cursor
                .take(usize::from(old_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            let old_last = old_fragments.last().ok_or(EngineError::InvalidRequest)?;
            if !extend_dirty_range(dirty_ranges, dirty, old_last.line.text_end)? {
                return Ok(None);
            }
            let Some(height) = self.recompose_line(
                convergence,
                slots,
                old_line,
                candidate,
                cursor,
                drop_cap.as_ref(),
                corrections,
            )?
            else {
                return Ok(None);
            };
            let new_line = *self
                .lines
                .iter()
                .next_back()
                .ok_or(EngineError::InvalidRequest)?;
            if candidate == convergence.thread_line_start
                && let Some(cap) = drop_cap.as_mut()
            {
                cap.align_to_body_baseline(new_line.block_start + new_line.baseline);
            }
            let metrics_stable =
                height == old_line.height && new_line.baseline == old_line.baseline;
            let next_cap_affected =
                convergence.next_cap_affected(next_line, candidate, drop_cap.as_ref())?;
            let old_cluster_end = usize::try_from(old_last.line.cluster_end)
                .map_err(|_| EngineError::InvalidRequest)?;
            let unmoved = cursor.start_correction
                == convergence
                    .previous_clusters
                    .break_corrections
                    .get(old_cluster_end.wrapping_sub(1))
                    .and_then(|state| state[1].get())
                    .unwrap_or_default();
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.flow_convergence_checks += 1;
                work.flow_dirty_end_blocks += usize::from(old_last.line.text_end < dirty.end);
                work.flow_cursor_mismatches += usize::from(cursor.cluster() != old_cluster_end);
                work.flow_correction_mismatches += usize::from(!unmoved);
                work.flow_metric_mismatches += usize::from(!metrics_stable);
                work.flow_drop_cap_blocks += usize::from(next_cap_affected);
            });
            // The cursor also carries the empty line a final hard break still owes. The old
            // flow continues in this thread exactly when its cursor was not complete here,
            // so the new one must agree before the old tail can stand for its own.
            let old_continues = next_line
                .is_some_and(|next| next.flow_thread_id == convergence.constraint.flow_thread_id);
            if old_last.line.text_end >= dirty.end
                && metrics_stable
                && cursor.cluster() == old_cluster_end
                && cursor.is_complete(convergence.clusters.starts.len()) != old_continues
                && unmoved
                && !next_cap_affected
            {
                return Ok(Some(candidate));
            }
            if !metrics_stable {
                return Ok(None);
            }
        }
        Ok(None)
    }

    /// Composes the band of one previous line again, in its region and at its block offset.
    /// Returns the new band's height, or `None` when its region is gone or the band composes
    /// nothing.
    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    pub(super) fn recompose_line<M, F>(
        &mut self,
        convergence: &Convergence<'_, M, F>,
        slots: &mut InlineSlotArena,
        old_line: FlowLine,
        candidate: usize,
        cursor: &mut LineCursor,
        drop_cap: Option<&FlowDropCap>,
        corrections: &mut impl BreakCorrections,
    ) -> Result<Option<f64>, EngineError>
    where
        M: Fn(u32) -> Option<FontMetrics> + Copy,
        F: Fn(u32) -> Option<u32> + Copy,
    {
        let geometry = convergence.geometry;
        let Some(region_index) = geometry
            .regions
            .iter()
            .position(|region| region.record.id == old_line.region_id)
        else {
            return Ok(None);
        };
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?;
        let drop_cap_cut = match drop_cap {
            Some(cap) => cap.cut_for_band(
                geometry,
                candidate.saturating_sub(convergence.thread_line_start),
                old_line.block_start,
                old_line.block_start + old_line.height,
            )?,
            None => None,
        };
        self.compose_band(
            geometry,
            region_index,
            old_line.flow_thread_id,
            old_line.region_id,
            old_line.transform_index,
            old_line.clip_id,
            convergence.clusters,
            convergence.bidi,
            convergence.styles,
            slots,
            cursor,
            old_line.block_start,
            f64::from(region.record.block_end),
            LineExtents {
                above: old_line.baseline,
                below: old_line.height - old_line.baseline,
                typography: old_line.typography,
            },
            drop_cap_cut,
            wrapping_for_flow_thread(geometry, old_line.flow_thread_id)?,
            old_line.align,
            flexible_for_flow_thread(geometry, old_line.flow_thread_id)?,
            indent_for_flow_thread(geometry, old_line.flow_thread_id)?,
            shrink_for_flow_thread(geometry, old_line.flow_thread_id)?,
            convergence.max_slots_per_band,
            convergence.metrics_for,
            convergence.first_font_for_stack,
            corrections,
            None,
        )
    }

    /// Retains the lines after the last converged one, reconciles the thread's drop caps and
    /// marks the whole thread recomposed when its flexible inline end moved.
    #[inline(always)]
    pub(super) fn finish_converged_thread(
        &mut self,
        previous: &Self,
        geometry: &FlowGeometryArena,
        flow_thread_id: u32,
        drop_cap: Option<FlowDropCap>,
        retained_line_cursor: usize,
    ) -> Result<(), EngineError> {
        self.append_retained_range(previous, retained_line_cursor..previous.lines.len())?;
        self.append_reconciled_drop_caps(previous, geometry, flow_thread_id, drop_cap)?;
        let previous_flexible_end = previous.flexible_inline_end(flow_thread_id);
        let next_flexible_end = if flexible_for_flow_thread(geometry, flow_thread_id)? {
            self.resolve_flexible_inline_end(
                flow_thread_id,
                indent_for_flow_thread(geometry, flow_thread_id)?,
                inline_limit_for_flow_thread(geometry, flow_thread_id)?,
            )?
        } else {
            None
        };
        if previous_flexible_end.map(f64::to_bits) != next_flexible_end.map(f64::to_bits) {
            self.recomposed_lines.clear();
            self.recomposed_lines_retained = false;
            if let Some((start, end)) = self.flow_thread_line_range(flow_thread_id) {
                self.mark_recomposed_lines(start..end)?;
            }
        }
        Ok(())
    }
}

/// Whether every line `previous_bidi` ordered still fills its slots in the order `bidi` asks
/// for, so a retained line needs no recomposition on that account. A band has more than one
/// slot only around an exclusion or a drop cap; there, lines are retained only while every
/// paragraph, before and after, reads the same way.
pub(super) fn reading_order_retained(
    geometry: &FlowGeometryArena,
    previous_bidi: &BidiAnalysis,
    bidi: &BidiAnalysis,
) -> bool {
    let from_right = |bidi: &BidiAnalysis| {
        let mut levels = bidi.paragraph_levels.iter().map(|level| level & 1 != 0);
        let first = levels.next().unwrap_or(false);
        levels.all(|level| level == first).then_some(first)
    };
    let one_slot_bands = geometry.exclusions.is_empty()
        && geometry
            .constraints
            .iter()
            .all(|constraint| constraint.drop_cap_lines == 0);
    one_slot_bands || from_right(bidi).is_some_and(|side| from_right(previous_bidi) == Some(side))
}

/// The fixed inputs of one convergence rebuild of a flow thread.
pub(super) struct Convergence<'a, M, F> {
    pub(super) previous: &'a FlowLayoutArena,
    pub(super) geometry: &'a FlowGeometryArena,
    pub(super) previous_clusters: &'a ClusterArena,
    pub(super) clusters: &'a ClusterArena,
    pub(super) styles: &'a [StyleSegment],
    pub(super) bidi: &'a BidiAnalysis,
    pub(super) constraint: FlowConstraint,
    pub(super) thread_line_start: usize,
    pub(super) previous_cap: Option<FlowDropCap>,
    pub(super) max_slots_per_band: usize,
    pub(super) metrics_for: M,
    pub(super) first_font_for_stack: F,
}
impl<M, F> Convergence<'_, M, F> {
    /// The cluster the recomposition from `line_index` starts at, or `None` when that line left
    /// the thread, has no fragment, or its cluster's identity changed under an unchanged cap.
    #[inline(always)]
    pub(super) fn restart_cluster(
        &self,
        line_index: usize,
        drop_cap: Option<&FlowDropCap>,
    ) -> Result<Option<usize>, EngineError> {
        let previous = self.previous;
        if previous.lines[line_index].flow_thread_id != self.constraint.flow_thread_id {
            return Ok(None);
        }
        let first_fragments = previous.line_fragments(line_index)?;
        let Some(first_fragment) = first_fragments.first() else {
            return Ok(None);
        };
        let cluster_start = if line_index == self.thread_line_start {
            match drop_cap {
                Some(cap) => usize::try_from(cap.body_resume_cluster)
                    .map_err(|_| EngineError::InvalidRequest)?,
                None => cluster_for_offset(self.clusters, self.constraint.resume_cluster)?,
            }
        } else {
            usize::try_from(first_fragment.line.cluster_start)
                .map_err(|_| EngineError::InvalidRequest)?
        };
        if self.previous_cap.as_ref() == drop_cap
            && self.previous_clusters.stable_ids.get(cluster_start)
                != self.clusters.stable_ids.get(cluster_start)
        {
            return Ok(None);
        }
        Ok(Some(cluster_start))
    }

    /// Whether either the previous or the pending drop cap cuts the band of the line after
    /// `candidate`.
    #[inline(always)]
    pub(super) fn next_cap_affected(
        &self,
        next_line: Option<FlowLine>,
        candidate: usize,
        drop_cap: Option<&FlowDropCap>,
    ) -> Result<bool, EngineError> {
        let Some(next) = next_line else {
            return Ok(false);
        };
        let ordinal = candidate + 1 - self.thread_line_start;
        let cuts = |cap: Option<&FlowDropCap>| -> Result<bool, EngineError> {
            match cap {
                Some(cap) => Ok(cap
                    .cut_for_band(
                        self.geometry,
                        ordinal,
                        next.block_start,
                        next.block_start + next.height,
                    )?
                    .is_some()),
                None => Ok(false),
            }
        };
        let previous_affected = cuts(self.previous_cap.as_ref())?;
        let pending_affected = cuts(drop_cap)?;
        Ok(previous_affected || pending_affected)
    }
}

/// Folds every queued dirty range that starts by `text_end` into `dirty`. Returns `false` when a
/// queued range overlaps the current one or is empty.
#[inline(always)]
pub(super) fn extend_dirty_range(
    dirty_ranges: &mut core::iter::Peekable<impl Iterator<Item = Range<u32>>>,
    dirty: &mut Range<u32>,
    text_end: u32,
) -> Result<bool, EngineError> {
    while dirty_ranges
        .peek()
        .is_some_and(|next| next.start <= text_end)
    {
        let next = dirty_ranges.next().ok_or(EngineError::InvalidRequest)?;
        if next.start < dirty.end || next.start >= next.end {
            return Ok(false);
        }
        dirty.end = dirty.end.max(next.end);
    }
    Ok(true)
}
