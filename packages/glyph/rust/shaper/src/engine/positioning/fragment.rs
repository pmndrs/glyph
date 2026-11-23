//! Positioning one line fragment: the drop cap, visual body reordering and cluster segments.

use super::*;

impl PositionedGlyphArena {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_drop_cap(
        &mut self,
        cap: FlowDropCap,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        visually_ltr: bool,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<f64, EngineError> {
        if !visually_ltr {
            prepare_line_levels(
                &mut self.line_levels,
                bidi,
                cap.fragment.line.text_start,
                cap.fragment.line.text_end,
            )?;
        }
        self.position_fragment(
            cap.line,
            cap.fragment,
            false,
            text,
            clusters,
            runs,
            boundary_shape,
            styles,
            bidi,
            visually_ltr,
            0.0,
            JustifyControls::default(),
            metrics_for,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_fragment(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        final_line: bool,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        visually_ltr: bool,
        indent: f64,
        controls: JustifyControls,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<f64, EngineError> {
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end =
            usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let (cut_index, boundary) = fragment_cut(fragment, boundary_shape)?;
        let retained_cluster_end = boundary.map_or(cluster_end, |boundary| {
            usize::try_from(boundary.cluster_start).unwrap_or(usize::MAX)
        });
        if retained_cluster_end > cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        // A corrected line start draws its island shaped alone; the paragraph's clusters resume after it.
        let lead = (fragment.lead_index != crate::engine::flow_composition::NO_BOUNDARY)
            .then(|| boundary_shape.record(fragment.lead_index))
            .map(|lead| lead.ok_or(EngineError::InvalidRequest))
            .transpose()?;
        let body_start = lead.map_or(cluster_start, |lead| lead.cluster_end as usize);
        let hanging_start = hanging_cluster_start(fragment, clusters, cluster_start, cluster_end)?;
        let step_start = self.pen_steps.len();
        let visual_start = self.visual_clusters.len();
        let paragraph_level = paragraph_level_at(bidi, fragment.line.text_start);
        let mut cut_stops = CutStops::logical(boundary.is_some(), paragraph_level);
        if !visually_ltr {
            self.reorder_fragment_clusters(
                fragment.line.text_start,
                cluster_start..retained_cluster_end,
                boundary,
                paragraph_level,
                clusters,
                runs,
            )?;
            if boundary.is_some() {
                cut_stops.stops = self.take_cut_stops(visual_start)?;
            }
        }

        let hung_leads = fragment.line.hung_advance != 0.0
            && self.terminating_cluster_is_rtl(
                fragment,
                clusters,
                runs,
                cluster_start,
                cluster_end,
            )?;
        let (justify, pen_origin) = fragment_pen(
            line,
            fragment,
            final_line,
            clusters,
            cluster_start,
            cluster_end,
            indent,
            controls,
            paragraph_level,
            hung_leads,
        );
        let baseline = line.block_start + line.baseline;
        admit_glyph_stream(clusters)?;
        let mut state = FragmentPositionState {
            cursor: pen_origin,
            baseline,
            decorated_run: None,
            space_ordinal: 0,
            gap_ordinal: 0,
        };
        let cut = boundary.map(|boundary| CutRecord {
            line,
            index: cut_index,
            boundary,
            text,
            clusters,
            runs,
            styles,
            shape: boundary_shape,
            justify,
        });
        // A unit that precedes every retained cluster precedes the lead island too: the lead is
        // the line's first clusters, and exists only where every cluster is left-to-right, so
        // this is the marker of a right-to-left paragraph.
        while let (Some(cut), Some((0, unit))) = (cut, cut_stops.peek()) {
            self.position_cut_unit(cut, unit, &mut state, metrics_for)?;
            cut_stops.next += 1;
        }
        if let Some(lead) = lead {
            state.cursor = self.position_boundary_source(
                line,
                fragment.lead_index,
                lead,
                state.cursor,
                baseline,
                text,
                clusters,
                runs,
                styles,
                boundary_shape,
                metrics_for,
                (justify, &mut state),
            )?;
        }
        let layout_run_order = visually_ltr && paragraph_level & 1 == 0;
        if layout_run_order {
            self.position_layout_run_fragment(
                line,
                fragment,
                body_start,
                retained_cluster_end,
                hanging_start,
                clusters,
                runs,
                styles,
                justify,
                &mut state,
                metrics_for,
            )?;
            if let Some(cut) = cut {
                for (_, unit) in cut_stops.stops.into_iter().skip(cut_stops.next).flatten() {
                    self.position_cut_unit(cut, unit, &mut state, metrics_for)?;
                }
            }
        } else {
            let span = VisualSpan {
                visually_ltr,
                body_start,
                visual_start,
                count: if visually_ltr {
                    retained_cluster_end.saturating_sub(body_start)
                } else {
                    self.visual_clusters.len().saturating_sub(visual_start)
                },
            };
            let body = BodyLine {
                line,
                text_start: fragment.line.text_start,
                clusters,
                runs,
                styles,
                justify,
            };
            let mut layout_run_cache = None;
            self.position_visual_body(
                body,
                span,
                cut,
                &mut cut_stops,
                &mut layout_run_cache,
                &mut state,
                metrics_for,
            )?;
            if !visually_ltr {
                self.record_hard_break_segments(
                    body,
                    cluster_start..retained_cluster_end,
                    &mut layout_run_cache,
                    &state,
                )?;
            }
        }
        if state.decorated_run.is_some() {
            self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
        }
        if matches!(self.current_source_line, SourceLine::Body(_)) {
            self.fragment_topology.push(FragmentTopology {
                steps: u32::try_from(self.pen_steps.len() - step_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                flags: fragment_topology_flags(layout_run_order, justify, hung_leads),
            });
        }
        Ok(indent
            + fragment.line.advance
            + crate::engine::layout_units::scaled_from_layout_units(justify.total_units()))
    }

    /// Appends the fragment's retained clusters (hard breaks excluded) and, after a cut, its
    /// island and marker stand-ins to the visual order with their levels, then reorders them
    /// (UAX #9 L2).
    pub(super) fn reorder_fragment_clusters(
        &mut self,
        text_start: u32,
        retained: core::ops::Range<usize>,
        boundary: Option<BoundaryShape>,
        paragraph_level: u8,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
    ) -> Result<(), EngineError> {
        let visual_start = self.visual_clusters.len();
        let retained_cluster_end = retained.end;
        for cluster in retained {
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                continue;
            }
            self.visual_clusters
                .push(u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?);
            self.visual_levels.push(cluster_level(
                cluster,
                text_start,
                clusters,
                runs,
                &self.line_levels,
            )?);
        }
        if let Some(boundary) = boundary {
            let island_level = if boundary.cluster_start < boundary.cluster_end {
                cluster_level(
                    retained_cluster_end,
                    text_start,
                    clusters,
                    runs,
                    &self.line_levels,
                )?
            } else {
                paragraph_level
            };
            self.visual_clusters.push(CutUnit::Island.sentinel());
            self.visual_levels.push(island_level);
            self.visual_clusters.push(CutUnit::Marker.sentinel());
            self.visual_levels.push(paragraph_level);
        }
        reorder_l2(
            &mut self.visual_clusters,
            &mut self.visual_levels,
            visual_start,
        );
        Ok(())
    }

    /// Whether the line's last content cluster (before a hard break) is right-to-left, which
    /// is when its hung advance leads the line.
    pub(super) fn terminating_cluster_is_rtl(
        &self,
        fragment: FlowFragment,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        cluster_start: usize,
        cluster_end: usize,
    ) -> Result<bool, EngineError> {
        let hanging_end = if cluster_end > cluster_start
            && clusters.flags[cluster_end - 1] & CLUSTER_HARD_BREAK != 0
        {
            cluster_end - 1
        } else {
            cluster_end
        };
        let terminating = hanging_end
            .checked_sub(1)
            .filter(|cluster| *cluster >= cluster_start)
            .ok_or(EngineError::InvalidRequest)?;
        Ok(cluster_level(
            terminating,
            fragment.line.text_start,
            clusters,
            runs,
            &self.line_levels,
        )? & 1
            != 0)
    }

    /// Positions a fragment body cluster by cluster in visual order, drawing the cut's units
    /// at their stops and joining each cluster's segment with the clusters that follow it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_visual_body(
        &mut self,
        body: BodyLine<'_>,
        span: VisualSpan,
        cut: Option<CutRecord<'_>>,
        cut_stops: &mut CutStops,
        layout_run_cache: &mut Option<(usize, LayoutRun)>,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        let mut geometry_cache = None;
        let mut active_placement = None;
        let mut ordinal = 0;
        loop {
            while let Some((at, unit)) = cut_stops.peek()
                && at.min(span.count) == ordinal
            {
                let cut = cut.ok_or(EngineError::InvalidRequest)?;
                self.position_cut_unit(cut, unit, state, metrics_for)?;
                // The unit moved the pen, so the cluster after it opens its own segment.
                active_placement = None;
                cut_stops.next += 1;
            }
            if ordinal >= span.count {
                break;
            }
            // Clusters join a segment only up to the next unit drawn between them.
            let stretch_end = cut_stops
                .peek()
                .map_or(span.count, |(at, _)| at.min(span.count));
            let cluster = self.visual_cluster(span, ordinal)?;
            let (layout_run, active) = self.open_or_join_cluster_segment(
                body,
                cluster,
                active_placement,
                layout_run_cache,
                state,
            )?;
            active_placement = Some(active);
            ordinal += 1;
            if body.clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                continue;
            }
            let geometry = cached_run_geometry(
                &mut geometry_cache,
                active.layout_run_index,
                body.clusters,
                body.styles,
                cluster,
            )?;
            // The clusters that follow in visual order join this segment while they stay in
            // its run, block and anchor and their own translation publishes the same f32:
            // the test the per-cluster walk applied to each of them in turn.
            let count = self.visual_segment_reach(
                body.clusters,
                layout_run,
                active.direction,
                cluster,
                (
                    span.visually_ltr,
                    span.visual_start + ordinal,
                    stretch_end - ordinal,
                ),
                active.occurrence.translation_inline,
                active.placement_cluster,
                body.justify,
                state,
            );
            if count > 1 {
                active_placement =
                    Some(self.join_visual_reach(body.clusters, layout_run, active, count)?);
            }
            self.position_segment(
                body,
                SegmentWalk {
                    segment_index: active.occurrence.segment_index,
                    first: cluster,
                    count,
                    reverse: active.direction & 1 != 0,
                    levels: (!span.visually_ltr).then_some(span.visual_start + ordinal - 1),
                },
                geometry,
                true,
                state,
                metrics_for,
            )?;
            ordinal += count - 1;
        }
        Ok(())
    }

    pub(super) fn visual_cluster(
        &self,
        span: VisualSpan,
        ordinal: usize,
    ) -> Result<usize, EngineError> {
        if span.visually_ltr {
            Ok(span.body_start + ordinal)
        } else {
            usize::try_from(self.visual_clusters[span.visual_start + ordinal])
                .map_err(|_| EngineError::InvalidRequest)
        }
    }

    /// Places `cluster` and either joins it to the active segment (same run, block, anchor
    /// and published translation, with no justification) or opens a new segment for it.
    pub(super) fn open_or_join_cluster_segment(
        &mut self,
        body: BodyLine<'_>,
        cluster: usize,
        active_placement: Option<ActiveFallbackPlacement>,
        layout_run_cache: &mut Option<(usize, LayoutRun)>,
        state: &FragmentPositionState,
    ) -> Result<(LayoutRun, ActiveFallbackPlacement), EngineError> {
        let clusters = body.clusters;
        let (run_index, layout_run) = layout_run_for_cluster(clusters, cluster, layout_run_cache)?;
        let direction = layout_run_direction(layout_run, body.runs)?;
        let placement_cluster = clusters.placement_cluster(layout_run, direction, cluster)?;
        let translation_inline = finite_f32(
            state.cursor - placement_cluster.block_local_prefix
                + placement_cluster.block_anchor_inline,
        )?;
        let translation_block = finite_f32(state.baseline + placement_cluster.block_anchor_block)?;
        let candidate = ActiveFallbackPlacement {
            layout_run_index: run_index,
            cluster,
            direction,
            placement_cluster,
            occurrence: PlacementOccurrence {
                segment_index: 0,
                translation_inline,
                translation_block,
            },
        };
        let adjacent = active_placement.is_some_and(|active| active.continues_with(&candidate));
        let occurrence = if body.justify.is_zero() && adjacent {
            let occurrence = active_placement
                .ok_or(EngineError::InvalidRequest)?
                .occurrence;
            self.extend_layout_run_segment(
                occurrence.segment_index,
                &layout_run,
                cluster,
                1,
                clusters,
            )?;
            self.push_pen_step(
                &layout_run,
                direction,
                cluster..cluster + 1,
                placement_cluster,
                STEP_MERGEABLE | STEP_JOINED,
            )?;
            occurrence
        } else {
            self.record_layout_run_segment(
                self.placement_fragment_index,
                run_index,
                &layout_run,
                cluster,
                cluster + 1,
                clusters,
                placement_cluster,
                (false, direction),
                state.cursor,
                state.baseline,
            )?
        };
        Ok((
            layout_run,
            ActiveFallbackPlacement {
                occurrence,
                ..candidate
            },
        ))
    }

    /// Joins the `count - 1` clusters after `active.cluster` in visual order to its segment
    /// and pen step, returning the placement that ends at the last joined cluster.
    pub(super) fn join_visual_reach(
        &mut self,
        clusters: &ClusterArena,
        layout_run: LayoutRun,
        active: ActiveFallbackPlacement,
        count: usize,
    ) -> Result<ActiveFallbackPlacement, EngineError> {
        let cluster = active.cluster;
        let reverse = active.direction & 1 != 0;
        let step = self
            .pen_steps
            .last_mut()
            .ok_or(EngineError::InvalidRequest)?;
        step.count = u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?;
        step.flags |= STEP_CHECKED | if reverse { STEP_REVERSE } else { 0 };
        let joined = if reverse {
            cluster + 1 - count
        } else {
            cluster + 1
        };
        self.extend_layout_run_segment(
            active.occurrence.segment_index,
            &layout_run,
            joined,
            count - 1,
            clusters,
        )?;
        Ok(ActiveFallbackPlacement {
            cluster: if reverse {
                cluster + 1 - count
            } else {
                cluster + count - 1
            },
            ..active
        })
    }

    /// A reordered line leaves its hard breaks out of the visual order; each still records
    /// its own glyphless segment at the final pen.
    pub(super) fn record_hard_break_segments(
        &mut self,
        body: BodyLine<'_>,
        retained: core::ops::Range<usize>,
        layout_run_cache: &mut Option<(usize, LayoutRun)>,
        state: &FragmentPositionState,
    ) -> Result<(), EngineError> {
        let clusters = body.clusters;
        for cluster in retained {
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                continue;
            }
            let (run_index, layout_run) =
                layout_run_for_cluster(clusters, cluster, layout_run_cache)?;
            let direction = layout_run_direction(layout_run, body.runs)?;
            let placement_cluster = clusters.placement_cluster(layout_run, direction, cluster)?;
            self.record_layout_run_segment(
                self.placement_fragment_index,
                run_index,
                &layout_run,
                cluster,
                cluster + 1,
                clusters,
                placement_cluster,
                (false, direction),
                state.cursor,
                state.baseline,
            )?;
        }
        Ok(())
    }
}
