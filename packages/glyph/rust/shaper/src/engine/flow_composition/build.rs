//! Building a paragraph's flow layout from nothing, thread by thread.

use super::*;

impl FlowLayoutArena {
    #[cfg(test)]
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
        self.build_with_drop_cap_context(
            None,
            geometry,
            clusters,
            &[],
            styles,
            slots,
            &BidiAnalysis::default(),
            max_lines,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
            &mut crate::engine::line_composition::NoCorrections,
        )
    }

    #[allow(clippy::too_many_arguments)]
    /// Composes every line. `same_clusters` is a flow composed over these same clusters,
    /// runs and corrections, whatever its geometry: its fits stand for this build's wherever
    /// the measure stays inside what they tested.
    pub(crate) fn build_with_drop_cap_context(
        &mut self,
        same_clusters: Option<&Self>,
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        bidi: &BidiAnalysis,
        max_lines: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
    ) -> Result<(), EngineError> {
        let paragraph_level = first_paragraph_level(bidi);
        self.clear();
        // A text with no cluster and no style has no face to take a line box from.
        if geometry.constraints.is_empty() || (clusters.starts.is_empty() && styles.is_empty()) {
            return Ok(());
        }
        // Limits reject excess work; they are not allocation requests. A line consumes at
        // least one cluster, and ordinary lines need one fragment. Exceptional flows grow.
        let likely_lines = clusters.starts.len().min(max_lines);
        self.reserve(likely_lines, likely_lines)?;
        let mut reuse = same_clusters.map(|flow| FitReuse {
            witnesses: &flow.fit_witnesses,
            next: 0,
        });
        for constraint in geometry.constraints.iter().copied() {
            let region_start = usize::try_from(constraint.region_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let first_region = region_start
                .checked_add(usize::from(constraint.resume_region))
                .ok_or(EngineError::InvalidRequest)?;
            let region_end = region_start
                .checked_add(usize::from(constraint.region_count))
                .ok_or(EngineError::InvalidRequest)?;
            let first_region_record = geometry
                .regions
                .get(first_region)
                .ok_or(EngineError::InvalidRequest)?
                .record;
            let mut first_block = f64::from(first_region_record.block_start);
            first_block += f64::from(constraint.resume_block_offset);
            if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
                first_block += f64::from(constraint.space_before);
            }
            let mut drop_cap = prepare_drop_cap(
                constraint,
                first_region_record,
                clusters,
                runs,
                paragraph_level,
                first_block,
                styles,
                metrics_for,
                first_font_for_stack,
            )?;
            // A text with no cluster is still a paragraph: one line, empty, with its strut.
            let mut cursor = if clusters.starts.is_empty() {
                if constraint.resume_cluster != 0 {
                    return Err(EngineError::InvalidRequest);
                }
                LineCursor::empty_paragraph()
            } else {
                let resume = if let Some(cap) = drop_cap.as_ref() {
                    usize::try_from(cap.body_resume_cluster)
                        .map_err(|_| EngineError::InvalidRequest)?
                } else {
                    cluster_for_offset(clusters, constraint.resume_cluster)?
                };
                let mut cursor = LineCursor::at_cluster(resume);
                if constraint.wrap == WRAP_WORD {
                    cursor.start_correction = corrections.right(resume)?;
                }
                cursor
            };
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
                    // Paragraph space-before applies once, where the thread truly
                    // starts; a resumed thread or a region break swallows it.
                    if constraint.resume_cluster == 0 && constraint.resume_region == 0 {
                        block += f64::from(constraint.space_before);
                    }
                }
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
                    reuse.as_mut(),
                    None,
                )?;
            }
            if constraint.overflow == OVERFLOW_ELLIPSIS {
                let final_fragment_overflows = self.lines.iter().next_back().is_some_and(|line| {
                    line.flow_thread_id == constraint.flow_thread_id
                        && self
                            .line_fragment_start(self.lines.len().saturating_sub(1))
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
            if constraint.width_mode != AXIS_EXACT {
                self.resolve_flexible_inline_end(
                    constraint.flow_thread_id,
                    f64::from(constraint.first_line_indent),
                    flexible_inline_limit(&constraint),
                )?;
            }
            if self.lines.len() > thread_line_start
                && let Some(cap) = drop_cap
            {
                self.drop_caps.push(cap);
            }
        }
        Ok(())
    }
}

/// Asked after each line a region composes, with the block offset its band started at:
/// whether the flow from here on is one the caller already holds.
pub(super) type BandStop<'a> =
    &'a mut dyn FnMut(&FlowLayoutArena, f64) -> Result<bool, EngineError>;

impl FlowLayoutArena {
    /// Composes the bands of `constraint`'s thread down one region from `block`, until the
    /// text, the region or `line_limit` lines of the thread end, or `stop` says so. Returns
    /// whether `stop` ended it. Out of line and called per region: the full build and the
    /// rebuild after an exclusion change walk a region with the same loop, and only the
    /// rebuild passes a `stop`.
    #[allow(clippy::too_many_arguments)]
    #[inline(never)]
    pub(super) fn compose_region_bands(
        &mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        constraint: &FlowConstraint,
        clusters: &ClusterArena,
        bidi: &BidiAnalysis,
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        cursor: &mut LineCursor,
        mut block: f64,
        drop_cap: &mut Option<FlowDropCap>,
        thread_line_start: usize,
        line_limit: usize,
        max_slots_per_band: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
        mut reuse: Option<&mut FitReuse<'_>>,
        mut stop: Option<BandStop<'_>>,
    ) -> Result<bool, EngineError> {
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?
            .record;
        // A band starts only inside the region; `fit_end` is how far its line box may reach.
        let foot = f64::from(region.block_end);
        let fit_end = composition_block_end(constraint, region_index, region.block_end);
        while !cursor.is_complete(clusters.starts.len())
            && self.lines.len().saturating_sub(thread_line_start) < line_limit
            && block < foot
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
            let composed = self.compose_band(
                geometry,
                region_index,
                constraint.flow_thread_id,
                region.id,
                region.transform_index,
                clusters,
                bidi,
                styles,
                slots,
                cursor,
                block,
                fit_end,
                estimate,
                match drop_cap.as_ref() {
                    Some(cap) => cap.cut_for_band(
                        geometry,
                        self.lines.len().saturating_sub(thread_line_start),
                        block,
                        block + estimate.height(),
                    )?,
                    None => None,
                },
                constraint.wrap,
                constraint.align,
                constraint.width_mode != AXIS_EXACT,
                f64::from(constraint.first_line_indent),
                constraint_word_space_shrink(constraint),
                max_slots_per_band,
                metrics_for,
                first_font_for_stack,
                corrections,
                reuse.as_deref_mut(),
            )?;
            let Some(height) = composed else {
                block += estimate.height();
                continue;
            };
            if self.lines.len() == thread_line_start + 1
                && let (Some(cap), Some(line)) = (drop_cap.as_mut(), self.lines.iter().next_back())
            {
                cap.align_to_body_baseline(line.block_start + line.baseline);
            }
            let composed_block = block;
            block += height;
            if let Some(stop) = stop.as_mut()
                && stop(self, composed_block)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
