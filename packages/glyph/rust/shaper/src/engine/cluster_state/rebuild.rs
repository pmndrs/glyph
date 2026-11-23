//! Rebuilding one source run in place when its topology is stable, and copying an arena.

use super::*;
use core::ops::Range;

impl ClusterArena {
    pub(crate) fn rebuild_source_run_if_topology_is_stable(
        &mut self,
        previous: &Self,
        input: ClusterBuildInput<'_>,
        source_run: u32,
        styles_changed: bool,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<Option<(usize, usize)>, EngineError> {
        let _clock = StageClock::start();
        let (runs, shape) = (input.runs, input.shape);
        if !previous.same_cluster_topology(input.text, input.text_unit_ids, input.unicode, shape) {
            return Ok(None);
        }
        let source_index = usize::try_from(source_run).map_err(|_| EngineError::InvalidRequest)?;
        let source = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
        let cluster_start = previous
            .starts
            .binary_search(&source.text_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end = previous
            .ends
            .binary_search(&source.text_end)
            .map(|index| index + 1)
            .map_err(|_| EngineError::InvalidRequest)?;
        if cluster_start >= cluster_end
            || shape.runs.iter().any(|run| {
                shaped_glyph_range(*run).is_none_or(|range| range.end > shape.glyph_ids.len())
            })
        {
            return Ok(None);
        }
        self.copy_from(previous, false)?;
        self.ltr = all_ltr(runs);
        let clusters = cluster_start..cluster_end;
        let rebuilt = self.rebuild_run_clusters(
            previous,
            input,
            source_run,
            source,
            clusters.clone(),
            styles_changed,
            &metrics_for,
        )?;
        if !rebuilt {
            self.clear();
            return Ok(None);
        }
        Ok(Some((cluster_start, cluster_end)))
    }

    /// Whether the new text, unit identities, graphemes and shape arrays have the shape of this
    /// arena's, so one source run can be rebuilt in place.
    fn same_cluster_topology(
        &self,
        text: &[u16],
        text_unit_ids: &[u32],
        unicode: &UnicodeAnalysis,
        shape: &ShapeArena,
    ) -> bool {
        let boundaries = unicode.grapheme_boundaries();
        text.len() == text_unit_ids.len()
            && !text_unit_ids.contains(&0)
            && self.index_at.len() == text.len().saturating_add(1)
            && boundaries.len().saturating_sub(1) == self.starts.len()
            && !boundaries
                .windows(2)
                .zip(&self.starts)
                .any(|(pair, start)| pair[0] != *start)
            && !boundaries
                .windows(2)
                .zip(&self.ends)
                .any(|(pair, end)| pair[1] != *end)
            && shape.glyph_ids.len() == self.glyph_ids.len()
            && [
                shape.clusters.len(),
                shape.x_advances.len(),
                shape.y_advances.len(),
                shape.x_offsets.len(),
                shape.y_offsets.len(),
                shape.glyph_flags.len(),
            ]
            .iter()
            .all(|length| *length == shape.glyph_ids.len())
    }

    /// Rebuilds the clusters of one source run over a copy of `previous`: their advances and
    /// flags, their glyphs in the previous glyph window, and the breaks they carry. Returns
    /// `false` when a style no longer covers a cluster or the run's glyphs no longer fill the
    /// window.
    #[allow(clippy::too_many_arguments)]
    fn rebuild_run_clusters(
        &mut self,
        previous: &Self,
        input: ClusterBuildInput<'_>,
        source_run: u32,
        source: ShapingRun,
        clusters: Range<usize>,
        styles_changed: bool,
        metrics_for: &impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<bool, EngineError> {
        // A style change in the same request renumbers the resolved segments of the whole
        // paragraph, not only those of the reshaped run.
        if styles_changed && !self.remap_style_indexes(input.styles)? {
            return Ok(false);
        }
        if !self.reset_run_clusters(
            input.text,
            input.text_unit_ids,
            input.styles,
            clusters.clone(),
        )? {
            return Ok(false);
        }
        self.accumulate_run_glyphs(
            input.shape,
            source_run,
            source,
            clusters.clone(),
            metrics_for,
        )?;
        for shaped_run in input
            .shape
            .runs
            .iter()
            .filter(|run| run.source_run == source_run)
        {
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            self.fill_glyphless_run_ownership(
                input.runs,
                *shaped_run,
                f64::from(metrics.units_per_em),
                clusters.start,
                clusters.end,
            )?;
        }
        if !self.place_run_glyph_starts(previous, clusters.clone())? {
            return Ok(false);
        }
        self.copy_run_glyphs(input.shape, source_run)?;
        for cluster in clusters.clone() {
            if self.shaped[cluster] != 0 && self.unsafe_before[cluster] == 0 {
                self.flags[cluster] |= CLUSTER_SAFE_BEFORE;
            }
        }
        self.rebuild_layout_runs_for_shaping(input.runs)?;
        self.mark_run_line_breaks(input.unicode, clusters.clone());
        // A correction reshapes an island plus SHAPING_CONTEXT clusters either side of its boundary.
        let first = self.island(clusters.start.max(1) - 1).0;
        let last = self.island(clusters.end.min(self.starts.len() - 1)).1;
        self.reset_break_corrections(
            first.saturating_sub(SHAPING_CONTEXT),
            last + SHAPING_CONTEXT,
        );
        self.refresh_layout_units()?;
        Ok(true)
    }

    /// Resets each cluster of the run to its unshaped state: spacing advance, hard-break and
    /// space flags, and its first unit's identity. Returns `false` when a cluster's style no
    /// longer covers it.
    fn reset_run_clusters(
        &mut self,
        text: &[u16],
        text_unit_ids: &[u32],
        styles: &[StyleSegment],
        clusters: Range<usize>,
    ) -> Result<bool, EngineError> {
        for cluster in clusters {
            let start = self.starts[cluster];
            let end = self.ends[cluster];
            let style_index = usize::try_from(self.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            if style.text_start > start || style.text_end < end {
                return Ok(false);
            }
            let hard_break = is_hard_break(text, start)?;
            let space = text.get(start as usize) == Some(&0x20);
            let word_spacing = if space { style.style.word_spacing } else { 0.0 };
            self.advances[cluster] = if hard_break {
                0.0
            } else {
                f64::from(style.style.letter_spacing + word_spacing)
            };
            self.flags[cluster] = match (hard_break, space) {
                (true, _) => CLUSTER_HARD_BREAK,
                (false, true) => CLUSTER_SPACE,
                (false, false) => 0,
            };
            self.units_per_em[cluster] = 0.0;
            self.source_runs[cluster] = NO_SOURCE_RUN;
            self.binding_handles[cluster] = 0;
            self.font_handles[cluster] = 0;
            self.stable_ids[cluster] = *text_unit_ids
                .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            self.glyph_counts[cluster] = 0;
            self.shaped[cluster] = 0;
            self.unsafe_before[cluster] = 0;
        }
        Ok(true)
    }

    /// Counts the run's glyphs into their clusters and adds their scaled advances.
    fn accumulate_run_glyphs(
        &mut self,
        shape: &ShapeArena,
        source_run: u32,
        source: ShapingRun,
        clusters: Range<usize>,
        metrics_for: &impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(source.style.font_size) / f64::from(metrics.units_per_em);
            for glyph in shaped_glyph_range(*shaped_run).ok_or(EngineError::InvalidRequest)? {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.cluster_retained_glyph_loop_visits += 1
                });
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                if !clusters.contains(&cluster) {
                    return Err(EngineError::InvalidRequest);
                }
                self.assign_cluster_ownership(cluster, *shaped_run)?;
                self.shaped[cluster] = 1;
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.unsafe_before[cluster] |=
                    u8::from(shape.glyph_flags[glyph] & GLYPH_UNSAFE_TO_BREAK != 0);
                self.advances[cluster] += f64::from(shape.x_advances[glyph].unsigned_abs()) * scale;
                self.units_per_em[cluster] = f64::from(metrics.units_per_em);
            }
        }
        Ok(())
    }

    /// Lays the run's clusters' glyph starts out from the previous window's start. Returns
    /// `false` when their glyphs no longer fill exactly the previous window.
    fn place_run_glyph_starts(
        &mut self,
        previous: &Self,
        clusters: Range<usize>,
    ) -> Result<bool, EngineError> {
        let adjacency_start = usize::try_from(previous.glyph_starts[clusters.start])
            .map_err(|_| EngineError::InvalidRequest)?;
        let adjacency_end = usize::try_from(previous.glyph_starts[clusters.end - 1])
            .ok()
            .and_then(|start| {
                usize::try_from(previous.glyph_counts[clusters.end - 1])
                    .ok()
                    .and_then(|count| start.checked_add(count))
            })
            .ok_or(EngineError::InvalidRequest)?;
        let mut cursor = adjacency_start;
        for cluster in clusters {
            self.glyph_starts[cluster] =
                u32::try_from(cursor).map_err(|_| EngineError::ResultTooLarge)?;
            cursor = cursor
                .checked_add(
                    usize::try_from(self.glyph_counts[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            self.glyph_counts[cluster] = 0;
        }
        Ok(cursor == adjacency_end)
    }

    /// Copies the run's glyphs into their clusters' slots, in shaped order within each cluster.
    fn copy_run_glyphs(&mut self, shape: &ShapeArena, source_run: u32) -> Result<(), EngineError> {
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            for glyph in shaped_glyph_range(*shaped_run).ok_or(EngineError::InvalidRequest)? {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.cluster_retained_glyph_loop_visits += 1
                });
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                let ordinal = usize::try_from(self.glyph_counts[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?;
                let destination = usize::try_from(self.glyph_starts[cluster])
                    .ok()
                    .and_then(|start| start.checked_add(ordinal))
                    .ok_or(EngineError::ResultTooLarge)?;
                self.glyph_ids[destination] = shape.glyph_ids[glyph];
                self.glyph_clusters[destination] = shape.clusters[glyph];
                self.glyph_x_advances[destination] = shape.x_advances[glyph];
                self.glyph_x_offsets[destination] = shape.x_offsets[glyph];
                self.glyph_y_offsets[destination] = shape.y_offsets[glyph];
                self.glyph_shape_flags[destination] = shape.glyph_flags[glyph];
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
        }
        Ok(())
    }

    /// Marks the line breaks that fall in or just before the rebuilt run, after clearing the
    /// allowed break the cluster before it carried.
    fn mark_run_line_breaks(&mut self, unicode: &UnicodeAnalysis, clusters: Range<usize>) {
        if clusters.start > 0 {
            self.flags[clusters.start - 1] &= !(CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION);
        }
        for line_break in unicode.line_breaks() {
            let Some(preceding) = self.break_target(line_break.position, line_break.required)
            else {
                continue;
            };
            if preceding < clusters.start.saturating_sub(1) || preceding >= clusters.end {
                continue;
            }
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
            } else {
                self.mark_optional_break(preceding);
            }
        }
    }

    /// Re-derives the F16.16 advance stream from the f64 advances. Both public build
    /// paths end here, so the streams can never disagree outside the rounding
    /// contract.
    pub(crate) fn refresh_layout_units(&mut self) -> Result<(), EngineError> {
        self.advance_units.clear();
        reserve(&mut self.advance_units, self.advances.len())?;
        self.advance_units.extend(
            self.advances
                .iter()
                .map(|advance| crate::engine::layout_units::layout_units_from_scaled(*advance)),
        );
        // Chunk-64 summaries (D-245): per 64-cluster chunk, the total advance, the
        // tagged auxiliary described on `chunk_auxiliary_sums`, and the OR of every
        // cluster flag plus summary-only markers.
        // The fit skips whole fitting chunks through these sums — exact, because
        // integer addition is associative — and resolves the last break position
        // inside a chunk only when a break is actually needed. The tail chunk is
        // summarized too; consumers gate on full-chunk availability themselves.
        let chunk_count = self.advance_units.len().div_ceil(LAYOUT_CHUNK);
        self.chunk_advance_sums.clear();
        self.chunk_auxiliary_sums.clear();
        self.chunk_flags_or.clear();
        reserve(&mut self.chunk_advance_sums, chunk_count)?;
        reserve(&mut self.chunk_auxiliary_sums, chunk_count)?;
        reserve(&mut self.chunk_flags_or, chunk_count)?;
        summarize_unit_chunks(
            &self.advance_units,
            &self.flags,
            &mut self.chunk_advance_sums,
            &mut self.chunk_auxiliary_sums,
            &mut self.chunk_flags_or,
        );
        self.word_breaks.clear();
        self.word_sidecar_mode = WordSidecarMode::Unbuilt;
        self.placement_segment_anchors.clear();
        Ok(())
    }

    pub(super) fn copy_from(
        &mut self,
        source: &Self,
        preserve_layout: bool,
    ) -> Result<(), EngineError> {
        self.clear();
        self.reserve(source.starts.len())?;
        reserve(&mut self.glyph_ids, source.glyph_ids.len())?;
        reserve(&mut self.glyph_clusters, source.glyph_clusters.len())?;
        reserve(&mut self.glyph_x_advances, source.glyph_x_advances.len())?;
        reserve(&mut self.glyph_x_offsets, source.glyph_x_offsets.len())?;
        reserve(&mut self.glyph_y_offsets, source.glyph_y_offsets.len())?;
        reserve(&mut self.glyph_shape_flags, source.glyph_shape_flags.len())?;
        reserve(&mut self.glyph_stable_ids, source.glyph_stable_ids.len())?;
        reserve(&mut self.index_at, source.index_at.len())?;
        macro_rules! copy_lane {
            ($field:ident) => {
                self.$field.extend_from_slice(&source.$field);
            };
        }
        copy_lane!(starts);
        copy_lane!(ends);
        copy_lane!(advances);
        copy_lane!(units_per_em);
        copy_lane!(flags);
        copy_lane!(style_indexes);
        copy_lane!(source_runs);
        copy_lane!(binding_handles);
        copy_lane!(font_handles);
        copy_lane!(stable_ids);
        copy_lane!(glyph_starts);
        copy_lane!(glyph_counts);
        copy_lane!(glyph_ids);
        copy_lane!(glyph_clusters);
        copy_lane!(glyph_x_advances);
        copy_lane!(glyph_x_offsets);
        copy_lane!(glyph_y_offsets);
        copy_lane!(glyph_shape_flags);
        copy_lane!(glyph_stable_ids);
        copy_lane!(index_at);
        copy_lane!(shaped);
        copy_lane!(unsafe_before);
        copy_lane!(break_corrections);
        if preserve_layout {
            copy_lane!(advance_units);
            reserve(
                &mut self.chunk_advance_sums,
                source.chunk_advance_sums.len(),
            )?;
            reserve(
                &mut self.chunk_auxiliary_sums,
                source.chunk_auxiliary_sums.len(),
            )?;
            reserve(&mut self.chunk_flags_or, source.chunk_flags_or.len())?;
            reserve(&mut self.word_breaks, source.word_breaks.len())?;
            copy_lane!(chunk_advance_sums);
            copy_lane!(chunk_auxiliary_sums);
            copy_lane!(chunk_flags_or);
            copy_lane!(word_breaks);
            copy_lane!(placement_segment_anchors);
            self.word_sidecar_mode = source.word_sidecar_mode;
            let source_islands = source
                .islands
                .try_borrow()
                .map_err(|_| EngineError::InvalidRequest)?;
            let islands = self.islands.get_mut();
            for (target, previous) in [
                (&mut islands.shape, &source_islands.shape),
                (&mut islands.once, &source_islands.once),
            ] {
                for index in 0..previous.runs.len() {
                    target.append_from(previous, index)?;
                }
            }
            reserve(&mut islands.slots, source_islands.slots.len())?;
            islands.slots.extend_from_slice(&source_islands.slots);
        }
        self.ltr = source.ltr;
        self.layout_runs.reserve(source.layout_runs.runs.len())?;
        self.layout_runs
            .runs
            .extend_from_slice(&source.layout_runs.runs);
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.cluster_copied_old_rows += source.starts.len()
        });
        Ok(())
    }
}

/// The glyph range of a shaped run, or `None` when it does not fit `usize`.
fn shaped_glyph_range(run: crate::engine::shaping_state::ShapedRun) -> Option<Range<usize>> {
    let start = usize::try_from(run.glyph_start).ok()?;
    let end = start.checked_add(usize::try_from(run.glyph_count).ok()?)?;
    Some(start..end)
}
