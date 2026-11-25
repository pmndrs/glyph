//! Positioning the clusters of one layout run: pen steps, cut units and decorated runs.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl CutUnit {
    /// The unit's stand-in among a line's cluster indices while the line is reordered. A
    /// paragraph cannot hold this many clusters: its text offsets are `u32` too.
    pub(super) const fn sentinel(self) -> u32 {
        match self {
            Self::Island => u32::MAX - 1,
            Self::Marker => u32::MAX,
        }
    }

    pub(super) const fn from_sentinel(cluster: u32) -> Option<Self> {
        if cluster == Self::Island.sentinel() {
            Some(Self::Island)
        } else if cluster == Self::Marker.sentinel() {
            Some(Self::Marker)
        } else {
            None
        }
    }
}

impl ActiveFallbackPlacement {
    /// Whether `next` continues this placement's segment: the adjacent cluster of the same
    /// run in its direction, in the same block and anchor, publishing the same translation.
    pub(super) fn continues_with(&self, next: &Self) -> bool {
        self.layout_run_index == next.layout_run_index
            && if next.direction & 1 == 0 {
                self.cluster.checked_add(1) == Some(next.cluster)
            } else {
                next.cluster.checked_add(1) == Some(self.cluster)
            }
            && self.direction == next.direction
            && self.placement_cluster.segment_anchor == next.placement_cluster.segment_anchor
            && self.placement_cluster.dense == next.placement_cluster.dense
            && self.placement_cluster.numeric_block_ordinal
                == next.placement_cluster.numeric_block_ordinal
            && self.occurrence.translation_inline.to_bits()
                == next.occurrence.translation_inline.to_bits()
            && self.occurrence.translation_block.to_bits()
                == next.occurrence.translation_block.to_bits()
    }
}

impl CutStops {
    /// The cut's island and marker follow the retained clusters in logical order. Where
    /// they are drawn is the line's visual order: the island is one unit at its run's
    /// level, and the marker ends the line at the paragraph's level, so it sits at the
    /// line's end edge -- the right of a left-to-right paragraph, the left of a
    /// right-to-left one -- whatever the direction of the text it follows.
    pub(super) fn logical(has_cut: bool, paragraph_level: u8) -> Self {
        let stops = match (has_cut, paragraph_level & 1 == 0) {
            (false, _) => [None; 2],
            (true, true) => [
                Some((usize::MAX, CutUnit::Island)),
                Some((usize::MAX, CutUnit::Marker)),
            ],
            (true, false) => [
                Some((0, CutUnit::Marker)),
                Some((usize::MAX, CutUnit::Island)),
            ],
        };
        Self { stops, next: 0 }
    }

    pub(super) fn peek(&self) -> Option<(usize, CutUnit)> {
        self.stops.get(self.next).copied().flatten()
    }
}

impl SegmentWalk {
    #[inline(always)]
    pub(super) fn cluster(self, offset: usize) -> usize {
        if self.reverse {
            self.first - offset
        } else {
            self.first + offset
        }
    }
}

impl PositionedGlyphArena {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_layout_run_fragment(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        cluster_start: usize,
        cluster_end: usize,
        hanging_start: usize,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        justify: JustifyDistribution,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        if cluster_start > cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        if cluster_start == cluster_end {
            return Ok(());
        }
        let layout_runs = clusters.layout_runs();
        let first = layout_runs.partition_point(|run| run.cluster_end as usize <= cluster_start);
        let adjusts_spaces = justify.per_space_units != 0 || justify.extra_space_units != 0;
        let adjusts_gaps = justify.per_gap_units != 0 || justify.extra_gap_units != 0;
        let adjust = adjusts_spaces || adjusts_gaps;
        let mut covered = cluster_start;
        for (layout_run_index, layout_run) in (first..).zip(&layout_runs[first..]) {
            let run_start = usize::try_from(layout_run.cluster_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            if run_start >= cluster_end {
                break;
            }
            let run_end =
                usize::try_from(layout_run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
            let overlap_start = run_start.max(cluster_start);
            let overlap_end = run_end.min(cluster_end);
            if overlap_start != covered || overlap_start >= overlap_end {
                return Err(EngineError::InvalidRequest);
            }
            let direction = layout_run_direction(*layout_run, runs)?;
            let Some(geometry_cluster) = (overlap_start..overlap_end)
                .find(|cluster| clusters.flags[*cluster] & CLUSTER_HARD_BREAK == 0)
            else {
                for cluster in overlap_start..overlap_end {
                    let placement_cluster =
                        clusters.placement_cluster(*layout_run, direction, cluster)?;
                    self.record_layout_run_segment(
                        self.placement_fragment_index,
                        layout_run_index,
                        layout_run,
                        cluster,
                        cluster + 1,
                        clusters,
                        placement_cluster,
                        (true, direction),
                        state.cursor,
                        state.baseline,
                    )?;
                }
                covered = overlap_end;
                continue;
            };
            let geometry = RunGeometry::for_cluster(clusters, styles, geometry_cluster)?;
            debug_assert_eq!(layout_run.font_handle, geometry.font_handle);
            let body = BodyLine {
                line,
                text_start: fragment.line.text_start,
                clusters,
                runs,
                styles,
                justify,
            };
            let mut cluster = overlap_start;
            while cluster < overlap_end {
                let segment_start = cluster;
                let (placement_cluster, stable_segment_end) = if adjusts_gaps {
                    (
                        clusters.placement_cluster(*layout_run, direction, segment_start)?,
                        segment_start + 1,
                    )
                } else {
                    clusters.placement_segment_monotone(
                        *layout_run,
                        direction,
                        segment_start,
                        adjusts_spaces,
                        overlap_end,
                    )?
                };
                let mut segment_end = segment_start + 1;
                if !adjusts_gaps
                    && direction & 1 == 0
                    && clusters.flags[segment_start] & CLUSTER_HARD_BREAK == 0
                {
                    segment_end = stable_segment_end.min(overlap_end);
                    if segment_start < hanging_start {
                        segment_end = segment_end.min(hanging_start);
                    }
                }
                let occurrence = self.record_layout_run_segment(
                    self.placement_fragment_index,
                    layout_run_index,
                    layout_run,
                    segment_start,
                    segment_end,
                    clusters,
                    placement_cluster,
                    (true, direction),
                    state.cursor,
                    state.baseline,
                )?;
                self.position_segment(
                    body,
                    SegmentWalk {
                        segment_index: occurrence.segment_index,
                        first: segment_start,
                        count: segment_end - segment_start,
                        reverse: false,
                        levels: None,
                    },
                    geometry,
                    adjust,
                    state,
                    metrics_for,
                )?;
                cluster = segment_end;
            }
            covered = overlap_end;
        }
        if covered != cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_layout_run_segment(
        &mut self,
        fragment_index: u32,
        layout_run_index: usize,
        layout_run: &crate::engine::cluster_state::LayoutRun,
        overlap_start: usize,
        overlap_end: usize,
        clusters: &ClusterArena,
        placement_cluster: PlacementCluster,
        (allow_dense_identity, direction): (bool, u8),
        cursor: f64,
        baseline: f64,
    ) -> Result<PlacementOccurrence, EngineError> {
        let run_start =
            usize::try_from(layout_run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let glyph_start = clusters.glyph_starts[overlap_start];
        let final_cluster = overlap_end - 1;
        let glyph_end = clusters.glyph_starts[final_cluster]
            .checked_add(clusters.glyph_counts[final_cluster])
            .ok_or(EngineError::ResultTooLarge)?;
        let source_glyph_start = glyph_start
            .checked_sub(layout_run.glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let source_glyph_count = glyph_end
            .checked_sub(glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let local_prefix = placement_cluster.block_local_prefix;
        let translation = SegmentTranslation {
            translation_inline: cursor - local_prefix + placement_cluster.block_anchor_inline,
            translation_block: baseline + placement_cluster.block_anchor_block,
        };
        let translation_inline = finite_f32(translation.translation_inline)?;
        let translation_block = finite_f32(translation.translation_block)?;
        let segment = crate::engine::placement_state::PlacementSegment {
            fragment_index,
            layout_run_owner: LayoutRunOwner::Paragraph,
            layout_run_index: u32::try_from(layout_run_index)
                .map_err(|_| EngineError::ResultTooLarge)?,
            placement_handle: None,
            canonical_revision: layout_run.canonical_revision,
            identity: if allow_dense_identity && placement_cluster.dense {
                PlacementIdentity::Dense
            } else {
                PlacementIdentity::StableSource
            },
            segment_anchor: placement_cluster.segment_anchor,
            source_anchor: clusters.stable_ids[overlap_start],
            numeric_block_ordinal: placement_cluster.numeric_block_ordinal,
            run_cluster_start: u32::try_from(overlap_start - run_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            run_cluster_count: u32::try_from(overlap_end - overlap_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            glyph_source: GlyphSource::LayoutRun,
            source_glyph_start,
            source_glyph_count,
        };
        let mergeable = self.placement.joins_last(segment);
        let segments_before = self.placement.segment_rows().len();
        let segment_index = self.placement.push_segment(segment, translation)?;
        let joined = self.placement.segment_rows().len() == segments_before;
        self.push_pen_step(
            layout_run,
            direction,
            overlap_start..overlap_end,
            placement_cluster,
            if mergeable { STEP_MERGEABLE } else { 0 } | if joined { STEP_JOINED } else { 0 },
        )?;
        Ok(PlacementOccurrence {
            segment_index,
            translation_inline,
            translation_block,
        })
    }

    pub(super) fn push_pen_step(
        &mut self,
        layout_run: &LayoutRun,
        direction: u8,
        range: core::ops::Range<usize>,
        placement_cluster: PlacementCluster,
        flags: u8,
    ) -> Result<(), EngineError> {
        let (lane, block) = if placement_cluster.numeric_block_ordinal == u32::MAX {
            (NO_LANE, 0)
        } else {
            let run_offset = if direction & 1 == 0 {
                range.start - layout_run.cluster_start as usize
            } else {
                layout_run.cluster_end as usize - range.start - 1
            };
            (
                u32::try_from(layout_run.numeric_blocks.cluster_start as usize + run_offset)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                layout_run
                    .numeric_blocks
                    .start
                    .checked_add(placement_cluster.numeric_block_ordinal)
                    .ok_or(EngineError::ResultTooLarge)?,
            )
        };
        reserve(&mut self.pen_steps, 1)?;
        self.pen_steps.push(PenStep {
            first: u32::try_from(range.start).map_err(|_| EngineError::ResultTooLarge)?,
            count: u32::try_from(range.len()).map_err(|_| EngineError::ResultTooLarge)?,
            lane,
            block,
            flags,
        });
        Ok(())
    }

    /// Joins `count` clusters from `first` (ascending) to the segment recorded last.
    pub(super) fn extend_layout_run_segment(
        &mut self,
        segment_index: u32,
        layout_run: &LayoutRun,
        first: usize,
        count: usize,
        clusters: &ClusterArena,
    ) -> Result<(), EngineError> {
        let run_start =
            usize::try_from(layout_run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let last = first + count - 1;
        let glyph_start = clusters.glyph_starts[first];
        let glyph_end = clusters.glyph_starts[last]
            .checked_add(clusters.glyph_counts[last])
            .ok_or(EngineError::ResultTooLarge)?;
        self.placement.extend_last_segment(
            segment_index,
            u32::try_from(first - run_start).map_err(|_| EngineError::ResultTooLarge)?,
            u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?,
            glyph_start
                .checked_sub(layout_run.glyph_start)
                .ok_or(EngineError::InvalidRequest)?,
            glyph_end
                .checked_sub(glyph_start)
                .ok_or(EngineError::InvalidRequest)?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    pub(super) fn finish_positioned_cluster(
        &mut self,
        line: FlowLine,
        cluster: usize,
        clusters: &ClusterArena,
        positioned: PositionedCluster,
        justify: JustifyDistribution,
        adjust: bool,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        if adjust {
            apply_justification(
                cluster,
                clusters,
                justify,
                &mut state.cursor,
                &mut state.space_ordinal,
                &mut state.gap_ordinal,
            );
        }
        let PositionedCluster {
            style,
            font_handle,
            cluster_origin,
            glyphs,
        } = positioned;
        if style.decoration_flags == 0 {
            if state.decorated_run.is_some() {
                self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
            }
        } else {
            match state.decorated_run {
                Some(ref mut run)
                    if run.font_handle == font_handle
                        && same_decoration_group(&run.style, &style) =>
                {
                    run.end = state.cursor;
                    run.glyph_limit = glyphs.end;
                }
                _ => {
                    self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
                    state.decorated_run = Some(DecoratedRun {
                        style,
                        font_handle,
                        start: cluster_origin,
                        end: state.cursor,
                        glyph_start: glyphs.start,
                        glyph_limit: glyphs.end,
                    });
                }
            }
        }
        Ok(())
    }

    pub(super) fn flush_decorated_run(
        &mut self,
        run: &mut Option<DecoratedRun>,
        line: FlowLine,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        let Some(run) = run.take() else {
            return Ok(());
        };
        let metrics = metrics_for(run.font_handle)
            .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
        if metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let decoration_font_size = if run.style.decoration_font_size > 0.0 {
            run.style.decoration_font_size
        } else {
            run.style.font_size
        };
        let scale = f64::from(decoration_font_size) / f64::from(metrics.units_per_em);
        let baseline = line.block_start + line.baseline;
        let inline_start = finite_f32(run.start)?;
        let inline_extent = nonnegative_f32((run.end - run.start).max(0.0))?;
        if inline_extent == 0.0 {
            return Ok(());
        }
        let style = run.style;
        let baseline_origin = finite_f32(baseline)?;
        // A run of clusters that own no glyph names the glyph the pen meets next.
        let glyph_end = run.glyph_limit.saturating_sub(1).max(run.glyph_start);
        let overrides = (style.decoration_offset, style.decoration_thickness);
        let emit = |flag: u32, position: i16, size: i16, arena: &mut Vec<DecorationRecord>| {
            if style.decoration_flags & flag == 0 {
                return Ok(());
            }
            let block_position = baseline - f64::from(position) * scale + f64::from(overrides.0);
            let thickness = if overrides.1 > 0.0 {
                f64::from(overrides.1)
            } else {
                f64::from(size) * scale
            };
            arena
                .try_reserve_cold(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            arena.push(DecorationRecord {
                flags: flag,
                style: style.decoration_style,
                color: style.decoration_rgba,
                material_id: style.material_id,
                inline_start,
                inline_extent,
                block_start: finite_f32(block_position)?,
                block_extent: nonnegative_f32(thickness.max(0.0))?,
                baseline: baseline_origin,
                glyph_start: run.glyph_start,
                glyph_end,
                clip_id: line.clip_id,
                region_id: line.region_id,
                flow_thread_id: line.flow_thread_id,
                transform_index: line.transform_index,
            });
            Ok(())
        };
        emit(
            crate::engine::frame::DECORATION_UNDERLINE,
            metrics.underline_position,
            metrics.underline_thickness,
            &mut self.decorations,
        )?;
        emit(
            crate::engine::frame::DECORATION_OVERLINE,
            metrics.ascender,
            metrics.underline_thickness,
            &mut self.decorations,
        )?;
        emit(
            crate::engine::frame::DECORATION_LINE_THROUGH,
            metrics.strikeout_position,
            metrics.strikeout_size,
            &mut self.decorations,
        )?;
        Ok(())
    }

    /// Removes the cut's two units from the visual order [`reorder_l2`] gave the line from
    /// `visual_start` and returns them in drawing order, each with the number of retained
    /// clusters drawn before it.
    pub(super) fn take_cut_stops(
        &mut self,
        visual_start: usize,
    ) -> Result<[Option<(usize, CutUnit)>; 2], EngineError> {
        let mut stops = [None; 2];
        let mut found = 0;
        let mut kept = visual_start;
        for index in visual_start..self.visual_clusters.len() {
            let cluster = self.visual_clusters[index];
            match CutUnit::from_sentinel(cluster) {
                Some(unit) => {
                    *stops.get_mut(found).ok_or(EngineError::InvalidRequest)? =
                        Some((kept - visual_start, unit));
                    found += 1;
                }
                None => {
                    self.visual_clusters[kept] = cluster;
                    self.visual_levels[kept] = self.visual_levels[index];
                    kept += 1;
                }
            }
        }
        if found != stops.len() {
            return Err(EngineError::InvalidRequest);
        }
        self.visual_clusters.truncate(kept);
        self.visual_levels.truncate(kept);
        Ok(stops)
    }

    /// Draws one unit of the line's cut at the pen and advances the pen past it.
    pub(super) fn position_cut_unit(
        &mut self,
        cut: CutRecord<'_>,
        unit: CutUnit,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        state.cursor = match unit {
            CutUnit::Island => self.position_boundary_source(
                cut.line,
                cut.index,
                cut.boundary,
                state.cursor,
                state.baseline,
                cut.text,
                cut.clusters,
                cut.runs,
                cut.styles,
                cut.shape,
                metrics_for,
                (cut.justify, state),
            )?,
            CutUnit::Marker => self.position_boundary_marker(
                cut.line,
                cut.index,
                cut.boundary,
                state.cursor,
                state.baseline,
                cut.text,
                cut.clusters,
                cut.runs,
                cut.styles,
                cut.shape,
                metrics_for,
            )?,
        };
        Ok(())
    }
}
