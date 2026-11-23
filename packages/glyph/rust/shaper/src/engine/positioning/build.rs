//! Building a positioned arena from flow lines, line by line.

use super::*;

impl PositionedGlyphArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.visual_clusters, capacity)?;
        reserve(&mut self.visual_levels, capacity)?;
        reserve(&mut self.line_levels, capacity)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        text: &[u16],
        clusters: &ClusterArena,
        previous_clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        _identity_index: &mut IdentityIndex,
        _next_content_revision: &mut u32,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.build_with_previous(
            previous,
            flow,
            retained_flow,
            recomposed_lines,
            text,
            clusters,
            previous_clusters,
            runs,
            previous_runs,
            boundary_shape,
            previous_boundary_shape,
            styles,
            bidi,
            next_run_canonical_revision,
            typography_for,
            retained_typography_for,
            metrics_for,
            extents_for,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_with_previous(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        text: &[u16],
        clusters: &ClusterArena,
        previous_clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        #[cfg(feature = "stage-bench")]
        let _clock = crate::engine::state::oracle::stage_bench::clock::POSITIONING.guard();
        // The callbacks are read per line, per decoration and per island glyph, never per
        // body glyph, so every caller shares one copy of the build behind trait objects.
        let typography_for: &dyn Fn(u32) -> ThreadTypography = &typography_for;
        let retained_typography_for: &dyn Fn(u32) -> ThreadTypography = &retained_typography_for;
        let metrics_for: &dyn Fn(u32) -> Option<FontMetrics> = &metrics_for;
        let extents_for: &dyn Fn(u32, u32) -> Option<FontGlyphExtents> = &extents_for;
        self.build_lines(
            PositioningSource {
                previous,
                flow,
                retained_flow,
                recomposed_lines,
                text,
                clusters,
                previous_clusters,
                runs,
                previous_runs,
                boundary_shape,
                previous_boundary_shape,
                styles,
                bidi,
                typography_for,
                retained_typography_for,
                metrics_for,
                extents_for,
            },
            next_run_canonical_revision,
        )
    }

    pub(super) fn build_lines(
        &mut self,
        src: PositioningSource<'_>,
        next_run_canonical_revision: &mut u32,
    ) -> Result<(), EngineError> {
        self.prepare_build(src, next_run_canonical_revision)?;
        let flow = src.flow;
        // Flow admission authorizes reuse, but the actual positioning executor owns dirt:
        // numeric correspondence can reject an otherwise unchanged flow line.
        let mut walk = LineBuildWalk {
            source_coordinates_retained: src.recomposed_lines.is_some(),
            // The canonical span stream is the only source representation. Static
            // geometry reuses clean lines through the placement/occurrence proof;
            // dirty lines are emitted from their current run-local rows.
            retained_cursor: src.retained_flow.and_then(RetainedFlowLineCursor::new),
            recomposed_line_index: 0,
            drop_cap_cursor: 0,
            fragment_cursor: 0,
            previous_flow_thread_id: None,
        };
        let visually_ltr = is_trivially_ltr(src.bidi, src.runs);
        let mut fragment_ranges = flow
            .fragments
            .cursor_from(0)
            .ok_or(EngineError::InvalidRequest)?;
        let mut lines = flow.lines.iter().copied().enumerate().peekable();
        while let Some((line_index, line)) = lines.next() {
            let next_line = lines.peek().map(|(_, line)| *line);
            let mut head = walk.line_head(line_index, line, next_line)?;
            let fragments = fragment_ranges
                .take(usize::from(line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            head.drop_cap = walk.drop_cap(flow, line, head.first_thread_line);
            head.previous_drop_cap = src
                .retained_flow
                .and_then(|previous| walk.drop_cap(previous, line, head.first_thread_line));
            let placement_line_start = Some(self.placement.begin_line());
            head.line_span_start = self.occurrence_spans.len();
            head.line_step_start = self.pen_steps.len();
            let retained_line = walk.is_retained_line(src.recomposed_lines, line_index);
            if head.previous_drop_cap == head.drop_cap
                && retained_line
                && self.append_clean_retained_line(src, &head, &mut walk)?
            {
                continue;
            }
            // The line that owns a drop cap is positioned in full; the lines beside it are not
            // special, since the cap reaches them only through their slots.
            let numeric_source = match walk.retained_cursor.as_mut() {
                Some(retained_cursor) if head.drop_cap.is_none() => {
                    match self.retain_matched_line(
                        src,
                        &head,
                        &fragments,
                        retained_cursor,
                        &mut walk.source_coordinates_retained,
                    )? {
                        MatchedLine::Appended => continue,
                        MatchedLine::Reposition(source) => source,
                    }
                }
                _ => None,
            };
            let starts = LineGlyphStarts {
                glyph: self.outlined_count(),
                decoration: self.decorations.len(),
                semantic: self.occurrence_count(),
            };
            if fragments.is_empty() {
                self.push_empty_line(src, &head, starts)?;
            } else {
                if head.drop_cap.is_some() {
                    walk.drop_cap_cursor += 1;
                }
                let inline_extent = self.position_line(
                    src,
                    &head,
                    &fragments,
                    numeric_source,
                    visually_ltr,
                    walk.drop_cap_cursor,
                )?;
                self.finish_positioned_line(
                    src,
                    &head,
                    starts,
                    inline_extent,
                    walk.source_coordinates_retained,
                )?;
            }
            if let Some(placement_line_start) = placement_line_start {
                self.placement.finish_line(placement_line_start)?;
            }
        }
        if walk.drop_cap_cursor != flow.drop_caps.len() {
            return Err(EngineError::InvalidRequest);
        }
        if walk.fragment_cursor != flow.fragments.len() || !fragment_ranges.is_empty() {
            return Err(EngineError::InvalidRequest);
        }
        self.finish_build(src.previous, walk.source_coordinates_retained)
    }

    /// Clears the arena, rebuilds the replacement runs the boundary shapes need, and reserves
    /// every per-line table for the flow.
    pub(super) fn prepare_build(
        &mut self,
        src: PositioningSource<'_>,
        next_run_canonical_revision: &mut u32,
    ) -> Result<(), EngineError> {
        self.clear();
        self.rebuild_replacement_runs(
            src.previous,
            src.boundary_shape,
            src.previous_boundary_shape,
            src.runs,
            src.previous_runs,
            next_run_canonical_revision,
        )?;
        self.rebuild_replacement_run_local(
            src.boundary_shape,
            src.text,
            src.clusters,
            src.runs,
            src.styles,
            src.metrics_for,
            src.extents_for,
        )?;
        self.text_effects = src
            .styles
            .iter()
            .any(|segment| style_has_text_effects(segment.style));
        self.decorated = src
            .styles
            .iter()
            .any(|segment| segment.style.decoration_flags != 0);
        let glyph_capacity = src
            .clusters
            .glyph_ids
            .len()
            .checked_add(src.boundary_shape.shape.glyph_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.reserve(glyph_capacity)?;
        let line_count = src.flow.lines.len();
        reserve(&mut self.line_glyph_starts, line_count)?;
        reserve(&mut self.line_glyph_counts, line_count)?;
        reserve(&mut self.line_decoration_starts, line_count)?;
        reserve(&mut self.line_decoration_counts, line_count)?;
        reserve(&mut self.semantic_line_glyph_starts, line_count)?;
        reserve(&mut self.semantic_line_glyph_counts, line_count)?;
        reserve(&mut self.semantic_line_inline_extents, line_count)?;
        reserve(&mut self.line_step_starts, line_count)?;
        reserve(&mut self.line_span_starts, line_count)?;
        reserve(&mut self.line_repositionable, line_count)?;
        reserve(&mut self.fragment_topology, src.flow.fragments.len())?;
        reserve(&mut self.line_ink, line_count)?;
        reserve(&mut self.line_missing_glyphs, line_count)?;
        if src.recomposed_lines.is_some() {
            reserve(&mut self.recomposed_glyphs, line_count)?;
        }
        Ok(())
    }

    pub(super) fn push_empty_line(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        starts: LineGlyphStarts,
    ) -> Result<(), EngineError> {
        self.line_glyph_starts
            .push(u32::try_from(starts.glyph).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_glyph_counts.push(0);
        self.line_decoration_starts
            .push(u32::try_from(starts.decoration).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_decoration_counts.push(0);
        self.semantic_line_glyph_starts
            .push(u32::try_from(starts.semantic).map_err(|_| EngineError::ResultTooLarge)?);
        self.semantic_line_glyph_counts.push(0);
        self.semantic_line_inline_extents.push(0.0);
        self.push_line_topology((head.line_span_start, head.line_step_start), 0, false)?;
        self.push_line_ink(head.line_span_start, src.clusters, src.boundary_shape);
        Ok(())
    }

    /// Positions one line with fragments: its drop cap, then either the numeric repeat of a
    /// retained line or every fragment in full. Returns the line's inline extent.
    pub(super) fn position_line(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        fragments: &RopeCursorRange<'_, FlowFragment>,
        numeric_source: Option<(usize, usize, bool)>,
        visually_ltr: bool,
        drop_cap_cursor: usize,
    ) -> Result<f64, EngineError> {
        let (line_index, line) = (head.line_index, head.line);
        let mut inline_start = fragments
            .iter()
            .map(|fragment| fragment.slot_start)
            .fold(f64::INFINITY, f64::min);
        let mut inline_end = f64::NEG_INFINITY;
        if let Some(cap) = head.drop_cap {
            self.current_source_line = SourceLine::DropCap(
                u32::try_from(drop_cap_cursor - 1).map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.placement_fragment_index = head.fragment_start;
            let cap_advance = self.position_drop_cap(
                cap,
                src.text,
                src.clusters,
                src.runs,
                src.boundary_shape,
                src.styles,
                src.bidi,
                visually_ltr,
                src.metrics_for,
            )?;
            inline_start = inline_start.min(cap.fragment.slot_start);
            inline_end = inline_end.max(cap.fragment.slot_start + cap_advance);
        }
        let typography = (src.typography_for)(line.flow_thread_id);
        self.current_source_line =
            SourceLine::Body(u32::try_from(line_index).map_err(|_| EngineError::ResultTooLarge)?);
        self.placement_fragment_index = head.fragment_start;
        // A line holding the clusters it held before repeats only its arithmetic.
        let repositioned = match numeric_source {
            Some((previous_line, previous_fragment_start, false)) => self
                .reposition_retained_line(
                    src.previous,
                    (previous_line, previous_fragment_start),
                    (line_index, line),
                    fragments,
                    head.final_line,
                    typography,
                    src.clusters,
                    src.bidi,
                    head.fragment_start,
                )?,
            Some((previous_line, previous_fragment_start, true)) => self.retain_edge_line(
                src.previous,
                (previous_line, previous_fragment_start),
                (line_index, line),
                fragments,
                head.final_line,
                typography,
                src.clusters,
                head.fragment_start,
            )?,
            None => None,
        };
        let line_steps = (head.line_span_start, head.line_step_start);
        if let Some(end) = repositioned {
            inline_end = end;
            let edges = numeric_source.is_some_and(|(_, _, edges)| edges);
            let copied_fragments = if edges {
                usize::from(line.fragment_count)
            } else {
                0
            };
            self.push_line_topology(line_steps, copied_fragments, !edges)?;
        } else {
            inline_end = self.position_line_fragments(
                src,
                head,
                fragments,
                typography,
                visually_ltr,
                inline_end,
            )?;
            let repositionable = head.drop_cap.is_none()
                && !self.decorated
                && fragments.iter().all(|fragment| {
                    fragment.boundary_index == crate::engine::flow_composition::NO_BOUNDARY
                        && fragment.lead_index == crate::engine::flow_composition::NO_BOUNDARY
                        && fragment.tail_index == crate::engine::flow_composition::NO_BOUNDARY
                });
            self.push_line_topology(line_steps, 0, repositionable)?;
        }
        Ok((inline_end - inline_start).max(0.0))
    }

    /// Positions every fragment of a line in full and returns the furthest end reached, from
    /// `inline_end` on.
    pub(super) fn position_line_fragments(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        fragments: &RopeCursorRange<'_, FlowFragment>,
        typography: ThreadTypography,
        visually_ltr: bool,
        mut inline_end: f64,
    ) -> Result<f64, EngineError> {
        let first = fragments.first().ok_or(EngineError::InvalidRequest)?;
        let last = fragments.last().ok_or(EngineError::InvalidRequest)?;
        if !visually_ltr {
            prepare_line_levels(
                &mut self.line_levels,
                src.bidi,
                first.line.text_start,
                last.line.text_end,
            )?;
        }
        for fragment in fragments.iter().copied() {
            let indent = if fragment.line.cluster_start == 0 {
                typography.first_line_indent
            } else {
                0.0
            };
            let fragment_advance = self.position_fragment(
                head.line,
                fragment,
                head.final_line,
                src.text,
                src.clusters,
                src.runs,
                src.boundary_shape,
                src.styles,
                src.bidi,
                visually_ltr,
                indent,
                typography.justify,
                src.metrics_for,
            )?;
            inline_end = inline_end.max(fragment.slot_start + fragment_advance);
            self.placement_fragment_index = self
                .placement_fragment_index
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
        }
        Ok(inline_end)
    }

    /// Records a positioned line's glyph, occurrence and decoration ranges, its ink, and
    /// its glyphs as recomposed when source coordinates are still retained.
    pub(super) fn finish_positioned_line(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        starts: LineGlyphStarts,
        inline_extent: f64,
        source_coordinates_retained: bool,
    ) -> Result<(), EngineError> {
        self.semantic_line_glyph_starts
            .push(u32::try_from(starts.semantic).map_err(|_| EngineError::ResultTooLarge)?);
        self.semantic_line_glyph_counts.push(
            u32::try_from(self.occurrence_count().saturating_sub(starts.semantic))
                .map_err(|_| EngineError::ResultTooLarge)?,
        );
        self.semantic_line_inline_extents.push(inline_extent);
        self.line_glyph_starts
            .push(u32::try_from(starts.glyph).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_glyph_counts.push(
            u32::try_from(self.outlined_count().saturating_sub(starts.glyph))
                .map_err(|_| EngineError::ResultTooLarge)?,
        );
        self.push_line_ink(head.line_span_start, src.clusters, src.boundary_shape);
        let line_glyph_end = self.outlined_count();
        if source_coordinates_retained && starts.glyph != line_glyph_end {
            if let Some(last) = self.recomposed_glyphs.last_mut()
                && last.end == starts.glyph
            {
                last.end = line_glyph_end;
            } else {
                self.recomposed_glyphs.push(starts.glyph..line_glyph_end);
            }
        }
        self.line_decoration_starts
            .push(u32::try_from(starts.decoration).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_decoration_counts.push(
            u32::try_from(self.decorations.len().saturating_sub(starts.decoration))
                .map_err(|_| EngineError::ResultTooLarge)?,
        );
        Ok(())
    }

    /// Validates the built occurrences and carries forward the unpublished recomposition
    /// windows when every glyph kept its source coordinates.
    pub(super) fn finish_build(
        &mut self,
        previous: &Self,
        source_coordinates_retained: bool,
    ) -> Result<(), EngineError> {
        self.recomposed_glyphs_retained = source_coordinates_retained
            && previous.outlined_count() == self.outlined_count()
            && previous.line_glyph_counts.len() == self.line_glyph_counts.len();
        self.placement.validate_occurrences(self.outlined_count())?;
        // The current positioning preparation has consumed its recomposition windows. This
        // storage now carries all unpublished windows in the preserved source coordinates.
        if self.recomposed_glyphs_retained && previous.recomposed_glyphs_retained {
            merge_recomposed_glyphs(&mut self.recomposed_glyphs, &previous.recomposed_glyphs)?;
        } else {
            self.recomposed_glyphs_retained = false;
        }
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.positioned_semantic_occurrences += self.occurrence_count();
            work.positioned_outlined_occurrences += self.outlined_count();
            work.positioned_occurrence_spans += self.occurrence_spans.len();
            work.positioned_occurrence_span_payload_bytes +=
                self.occurrence_spans.len() * core::mem::size_of::<OccurrenceSpan>();
            work.positioned_occurrence_span_capacity_bytes +=
                self.occurrence_spans.capacity() * core::mem::size_of::<OccurrenceSpan>();
        });
        Ok(())
    }

    /// Closes one line's topology lanes. `empty_fragments` stands in for fragments the line
    /// did not position itself.
    pub(super) fn push_line_topology(
        &mut self,
        (span_start, step_start): (usize, usize),
        empty_fragments: usize,
        repositionable: bool,
    ) -> Result<(), EngineError> {
        self.line_span_starts
            .push(u32::try_from(span_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_step_starts
            .push(u32::try_from(step_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_repositionable.push(repositionable);
        reserve(&mut self.fragment_topology, empty_fragments)?;
        self.fragment_topology.extend(core::iter::repeat_n(
            FragmentTopology::default(),
            empty_fragments,
        ));
        Ok(())
    }

    /// Carries a retained line's pen steps over: its clusters kept their indexes.
    pub(super) fn copy_line_topology(
        &mut self,
        previous: &Self,
        (previous_line, previous_fragment_start): (usize, usize),
        starts: (usize, usize),
        fragment_count: usize,
    ) -> Result<(), EngineError> {
        if previous.line_repositionable.get(previous_line) != Some(&true) {
            return self.push_line_topology(starts, fragment_count, false);
        }
        let steps = previous.line_steps(previous_line)?;
        let topology = previous
            .fragment_topology
            .get(previous_fragment_start..previous_fragment_start + fragment_count)
            .ok_or(EngineError::InvalidRequest)?;
        reserve(&mut self.pen_steps, steps.len())?;
        self.pen_steps.extend_from_slice(steps);
        reserve(&mut self.fragment_topology, topology.len())?;
        self.fragment_topology.extend_from_slice(topology);
        self.push_line_topology(starts, 0, true)
    }

    pub(super) fn line_steps(&self, line: usize) -> Result<&[PenStep], EngineError> {
        let start = *self
            .line_step_starts
            .get(line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let end = self
            .line_step_starts
            .get(line + 1)
            .map_or(self.pen_steps.len(), |end| *end as usize);
        self.pen_steps
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }

    pub(super) fn line_spans(&self, line: usize) -> Result<&[OccurrenceSpan], EngineError> {
        let start = *self
            .line_span_starts
            .get(line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let end = self
            .line_span_starts
            .get(line + 1)
            .map_or(self.occurrence_spans.len(), |end| *end as usize);
        self.occurrence_spans
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }

    #[inline(never)]
    pub(crate) fn clear(&mut self) {
        self.decorations.clear();
        self.replacement_runs.clear();
        self.replacement_run_boundary_indices.clear();
        self.replacement_run_local.clear();
        self.replacement_run_indices.clear();
        self.replacement_current_order.clear();
        self.replacement_previous_order.clear();
        self.line_glyph_starts.clear();
        self.line_glyph_counts.clear();
        self.line_decoration_starts.clear();
        self.line_decoration_counts.clear();
        self.occurrence_spans.clear();
        self.occurrence_semantic_count = 0;
        self.occurrence_outlined_count = 0;
        self.semantic_line_glyph_starts.clear();
        self.semantic_line_glyph_counts.clear();
        self.semantic_line_inline_extents.clear();
        self.visual_clusters.clear();
        self.visual_levels.clear();
        self.line_levels.clear();
        self.placement.clear();
        self.recomposed_glyphs.clear();
        self.recomposed_glyphs_retained = false;
        self.text_effects = false;
        self.decorated = false;
        self.pen_steps.clear();
        self.fragment_topology.clear();
        self.line_step_starts.clear();
        self.line_span_starts.clear();
        self.line_repositionable.clear();
        self.numeric_translations.clear();
        self.edge_pairs.clear();
        self.edge_runs.clear();
        self.line_ink.clear();
        self.line_missing_glyphs.clear();
        self.line_ink_complete = true;
    }
}
