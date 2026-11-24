//! Composing one band: fitting a line between the band's cuts, with fit reuse across attempts.

use super::*;

impl FitReuse<'_> {
    /// The line the old flow fitted from `cursor`, when a fit at `max_width_units` repeats it.
    pub(super) fn repeated(
        &mut self,
        cursor: LineCursor,
        max_width_units: Option<i64>,
        wrap: u8,
        word_space_shrink: f64,
    ) -> Option<(ComposedLine, FitWitness)> {
        let start = cursor.cluster();
        while self
            .witnesses
            .get(self.next)
            .is_some_and(|(line, _)| (line.cluster_start as usize) < start)
        {
            self.next += 1;
        }
        // The match stays current: a band that retries asks for it again.
        self.witnesses
            .get(self.next)
            .copied()
            .filter(|(line, witness)| {
                line.cluster_start as usize == start
                    && witness.repeats(cursor, max_width_units, wrap, word_space_shrink)
            })
    }
}

impl FlowLayoutArena {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn compose_band(
        &mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        flow_thread_id: u32,
        region_id: u32,
        transform_index: u32,
        clusters: &ClusterArena,
        bidi: &BidiAnalysis,
        styles: &[StyleSegment],
        slot_arena: &mut InlineSlotArena,
        cursor: &mut LineCursor,
        block_start: f64,
        region_block_end: f64,
        initial_extents: LineExtents,
        extra_cut: Option<InlineCut>,
        wrap: u8,
        align: u8,
        flexible_width: bool,
        first_line_indent: f64,
        word_space_shrink: f64,
        max_slots: usize,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        first_font_for_stack: impl Fn(u32) -> Option<u32> + Copy,
        corrections: &mut impl BreakCorrections,
        mut reuse: Option<&mut FitReuse<'_>>,
    ) -> Result<Option<f64>, EngineError> {
        let saved_cursor = *cursor;
        let fragment_start = self.fragments.len();
        let witness_start = self.fit_witnesses.len();
        let mut extents = initial_extents;
        for attempt in 0..2 {
            let height = extents.height();
            if block_start + height > region_block_end {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                self.fit_witnesses.truncate(witness_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            let available = slot_arena.resolve_band_with_cut(
                geometry,
                region_index,
                block_start,
                block_start + height,
                max_slots,
                extra_cut,
            )?;
            let region_inline_end = f64::from(
                geometry
                    .regions
                    .get(region_index)
                    .ok_or(EngineError::InvalidRequest)?
                    .record
                    .inline_end,
            );
            if available.is_empty() {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                self.fit_witnesses.truncate(witness_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            // Seed from the estimate so valid negative half-leading is not clamped against zero.
            let mut measured = LineExtents {
                typography: LineTypography::default(),
                ..initial_extents
            };
            let mut composed = false;
            // A line fills its slots in reading order: from the left in a left-to-right
            // paragraph, from the right in a right-to-left one. The paragraph is the one
            // the line begins in; the direction of the text inside it does not matter.
            let from_right = paragraph_level_at(bidi, line_text_start(clusters, *cursor)) & 1 != 0;
            for ordinal in 0..available.len() {
                let slot = available[if from_right {
                    available.len() - 1 - ordinal
                } else {
                    ordinal
                }];
                // The paragraph's first line composes against an indented width;
                // positioning shifts the pen by the same amount on the
                // paragraph-direction side.
                let indent = if cursor.cluster() == 0 {
                    first_line_indent
                } else {
                    0.0
                };
                // Slice 2b of the integer-layout-units plan: the available width
                // quantizes to F16.16 once at this boundary and the integer fit is
                // authoritative; the f64 twin remains only as the parity reference.
                let measure = Some(crate::engine::layout_units::layout_units_from_scaled(
                    (slot.end - slot.start - indent).max(0.0),
                ));
                let fitted = match reuse
                    .as_deref_mut()
                    .and_then(|reuse| reuse.repeated(*cursor, measure, wrap, word_space_shrink))
                {
                    Some(repeated) => {
                        repeat_line(clusters, cursor, &repeated.0, wrap, &mut *corrections)?;
                        Some(repeated)
                    }
                    None => layout_next_line_witnessed(
                        &ClusterLineFacts::from(clusters),
                        cursor,
                        measure,
                        wrap,
                        word_space_shrink,
                        &mut *corrections,
                    )?,
                };
                let Some((line, witness)) = fitted else {
                    break;
                };
                reserve_amortized(&mut self.fit_witnesses)?;
                self.fit_witnesses.push((line, witness));
                include_range_extents(
                    &mut measured,
                    clusters,
                    styles,
                    line,
                    metrics_for,
                    first_font_for_stack,
                )?;
                self.fragments
                    .push(FlowFragment {
                        line,
                        slot_start: slot.start,
                        slot_end: slot.end,
                        flexible_end: flexible_width && slot.end == region_inline_end,
                        boundary_index: NO_BOUNDARY,
                        lead_index: NO_BOUNDARY,
                        tail_index: NO_BOUNDARY,
                    })
                    .map_err(|()| EngineError::ResultTooLarge)?;
                composed = true;
                if line.hard_break || cursor.is_complete(clusters.starts.len()) {
                    break;
                }
            }
            if !composed {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                self.fit_witnesses.truncate(witness_start);
                *cursor = saved_cursor;
                return Ok(None);
            }
            if attempt == 0 && measured.height() > height {
                self.fragments
                    .truncate(fragment_start)
                    .map_err(|()| EngineError::ResultTooLarge)?;
                self.fit_witnesses.truncate(witness_start);
                *cursor = saved_cursor;
                extents = measured;
                continue;
            }
            // A line containing only a hard break still inherits its authored font's strut.
            if !measured.typography.present {
                measured.typography = initial_extents.typography;
            }
            let fragment_count = self.fragments.len() - fragment_start;
            self.lines
                .push(FlowLine {
                    flow_thread_id,
                    region_id,
                    transform_index,
                    // No overflow mode draws outside its box, so no line marks a clip
                    // boundary; the field survives because primitives still publish it.
                    clip_id: 0,
                    fragment_count: u16::try_from(fragment_count)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    align,
                    block_start,
                    baseline: extents.above,
                    height: extents.height(),
                    typography: measured.typography,
                })
                .map_err(|()| EngineError::ResultTooLarge)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.recomposed_flow_lines += 1);
            return Ok(Some(extents.height()));
        }
        Err(EngineError::InvalidRequest)
    }
}
