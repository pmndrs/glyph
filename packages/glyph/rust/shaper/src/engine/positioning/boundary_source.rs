//! Positioning boundary-shaped sources: markers, slices and spans across a line edge.

use super::*;

impl PositionedGlyphArena {
    /// Draws a boundary record's island from `cursor` and returns the pen after it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_boundary_source(
        &mut self,
        line: FlowLine,
        _boundary_index: u32,
        boundary: BoundaryShape,
        mut cursor: f64,
        baseline: f64,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        arena: &BoundaryShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        (justify, state): (JustifyDistribution, &mut FragmentPositionState),
    ) -> Result<f64, EngineError> {
        let bidi_level = runs
            .get(usize::try_from(boundary.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?
            .bidi_level;
        let source_cluster =
            usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let source_end = boundary
            .source_glyph_start
            .checked_add(boundary.source_glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        // A corrected line edge lays out cluster by cluster, so each cluster keeps its own decoration and expansion.
        let split = boundary.line_start;
        let last = if split {
            boundary.cluster_end as usize
        } else {
            source_cluster + 1
        };
        let mut pieces = 0;
        let mut glyph = boundary.source_glyph_start;
        for cluster in source_cluster..last {
            let (piece_start, piece_origin) = (glyph, cursor);
            if split {
                let start = clusters.starts[cluster];
                while glyph < source_end && arena.shape.clusters[glyph as usize] == start {
                    glyph += 1;
                }
            } else {
                glyph = source_end;
            }
            // The run-local arena cuts a long island into numeric blocks, each with its own anchor
            // and a prefix that restarts at zero, so every block is its own placed segment.
            let mut block_glyph = piece_start;
            while block_glyph < glyph {
                let owner = if block_glyph == piece_start {
                    cluster
                } else {
                    clusters
                        .starts
                        .binary_search(&arena.shape.clusters[block_glyph as usize])
                        .unwrap_or(cluster)
                };
                let slice = self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::BoundarySource,
                    (owner.min(clusters.starts.len().saturating_sub(1)), pieces),
                    (block_glyph, glyph - block_glyph),
                    cursor,
                    baseline,
                    clusters,
                )?;
                cursor = self.position_boundary_span(
                    line,
                    cursor,
                    block_glyph,
                    slice.glyph_count,
                    boundary.source_binding_handle,
                    boundary.source_font_handle,
                    bidi_level,
                    None,
                    cluster,
                    arena,
                    text,
                    clusters,
                    styles,
                    metrics_for,
                    Some(slice.occurrence),
                )?;
                block_glyph += slice.glyph_count;
                pieces += slice.cluster_count;
            }
            if split {
                let style = boundary_cluster_style(styles, clusters, cluster)?;
                if glyph == piece_start {
                    // A cluster owning no glyph (a ligature's later component) still advances by its
                    // spacing, as the paragraph and the correction price it.
                    cursor += clusters.advances[cluster];
                }
                state.cursor = cursor;
                self.finish_positioned_cluster(
                    line,
                    cluster,
                    clusters,
                    PositionedCluster {
                        style,
                        font_handle: boundary.source_font_handle,
                        cluster_origin: piece_origin,
                    },
                    justify,
                    true,
                    state,
                    metrics_for,
                )?;
                cursor = state.cursor;
            }
        }
        Ok(cursor)
    }

    /// Draws the glyphs a boundary record inserts (an ellipsis) from `cursor` and returns the
    /// pen after them.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_boundary_marker(
        &mut self,
        line: FlowLine,
        _boundary_index: u32,
        boundary: BoundaryShape,
        cursor: f64,
        baseline: f64,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        arena: &BoundaryShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<f64, EngineError> {
        let bidi_level = runs
            .get(usize::try_from(boundary.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?
            .bidi_level;
        let source_cluster =
            usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let ellipsis_cluster = usize::try_from(boundary.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?
            .saturating_sub(1)
            .max(source_cluster)
            .min(clusters.starts.len().saturating_sub(1));
        // The marker is one cluster, and a block never divides a cluster.
        let replacement_occurrence = (boundary.ellipsis_glyph_count != 0)
            .then(|| {
                self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::Ellipsis,
                    (ellipsis_cluster, 0),
                    (boundary.ellipsis_glyph_start, boundary.ellipsis_glyph_count),
                    cursor,
                    baseline,
                    clusters,
                )
                .and_then(|slice| {
                    (slice.glyph_count == boundary.ellipsis_glyph_count)
                        .then_some(slice.occurrence)
                        .ok_or(EngineError::InvalidRequest)
                })
            })
            .transpose()?;
        self.position_boundary_span(
            line,
            cursor,
            boundary.ellipsis_glyph_start,
            boundary.ellipsis_glyph_count,
            boundary.ellipsis_binding_handle,
            boundary.ellipsis_font_handle,
            bidi_level,
            Some(boundary.text_end),
            ellipsis_cluster,
            arena,
            text,
            clusters,
            styles,
            metrics_for,
            replacement_occurrence,
        )
    }

    /// Places the part of a boundary run's glyphs `glyph_start..glyph_start + glyph_count` that
    /// lies in the numeric block of the run's cluster `ordinal`, with the pen at `cursor`.
    ///
    /// A block carries its own anchor and its cluster prefixes restart at zero, so one
    /// translation is right for one block only: the caller places the rest of a longer slice
    /// with the pen where this part ended. A slice that stops inside its block is one cluster.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_boundary_slice(
        &mut self,
        boundary_index: u32,
        flow_thread_id: u32,
        run_role: BoundaryRunRole,
        (owner_cluster, ordinal): (usize, u32),
        (glyph_start, glyph_count): (u32, u32),
        cursor: f64,
        baseline: f64,
        clusters: &ClusterArena,
    ) -> Result<BoundarySlice, EngineError> {
        let run_index = self
            .replacement_run_indices
            .get(usize::try_from(boundary_index).map_err(|_| EngineError::InvalidRequest)?)
            .and_then(|indices| indices[boundary_role_index(run_role)])
            .ok_or(EngineError::InvalidRequest)?;
        let run = self
            .replacement_runs
            .get(usize::try_from(run_index).map_err(|_| EngineError::InvalidRequest)?)
            .filter(|run| {
                run.source_kind
                    == LayoutRunSourceKind::Boundary {
                        flow_thread_id,
                        role: run_role,
                    }
            })
            .ok_or(EngineError::InvalidRequest)?;
        if glyph_start < run.glyph_start
            || glyph_start - run.glyph_start + glyph_count > run.glyph_count
            || ordinal >= run.numeric_blocks.cluster_count
        {
            return Err(EngineError::InvalidRequest);
        }
        let block_lane = usize::try_from(run.numeric_blocks.cluster_start + ordinal)
            .map_err(|_| EngineError::InvalidRequest)?;
        let block_index = *self
            .replacement_run_local
            .cluster_blocks()
            .get(block_lane)
            .filter(|index| **index != u32::MAX)
            .ok_or(EngineError::InvalidRequest)?;
        let block = *self
            .replacement_run_local
            .blocks()
            .get(usize::try_from(block_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let local_prefix = *self
            .replacement_run_local
            .cluster_prefixes()
            .get(block_lane)
            .ok_or(EngineError::InvalidRequest)?;
        let block_glyph_end = block
            .source_glyph_start
            .checked_add(block.source_glyph_count)
            .ok_or(EngineError::InvalidRequest)?;
        if glyph_start < block.source_glyph_start || glyph_start >= block_glyph_end {
            return Err(EngineError::InvalidRequest);
        }
        let reaches_block_end = glyph_count >= block_glyph_end - glyph_start;
        let glyph_count = glyph_count.min(block_glyph_end - glyph_start);
        let cluster_count = if reaches_block_end {
            let run_lanes = usize::try_from(run.numeric_blocks.cluster_count - ordinal)
                .map_err(|_| EngineError::InvalidRequest)?;
            let lanes = self
                .replacement_run_local
                .cluster_blocks()
                .get(block_lane..)
                .ok_or(EngineError::InvalidRequest)?
                .iter()
                .take(run_lanes)
                .take_while(|index| **index == block_index)
                .count();
            u32::try_from(lanes).map_err(|_| EngineError::ResultTooLarge)?
        } else {
            1
        };
        let translation = SegmentTranslation {
            translation_inline: cursor - local_prefix + block.anchor_inline,
            translation_block: baseline + block.anchor_block,
        };
        let translation_inline = finite_f32(translation.translation_inline)?;
        let translation_block = finite_f32(translation.translation_block)?;
        let segment_index = self.placement.push_segment(
            crate::engine::placement_state::PlacementSegment {
                fragment_index: self.placement_fragment_index,
                layout_run_owner: LayoutRunOwner::Replacement,
                layout_run_index: run_index,
                placement_handle: None,
                canonical_revision: run.canonical_revision,
                identity: PlacementIdentity::StableSource,
                segment_anchor: clusters.stable_ids[owner_cluster],
                source_anchor: clusters.stable_ids[owner_cluster],
                numeric_block_ordinal: block_index
                    .checked_sub(run.numeric_blocks.start)
                    .filter(|ordinal| *ordinal < run.numeric_blocks.count)
                    .ok_or(EngineError::InvalidRequest)?,
                run_cluster_start: ordinal,
                run_cluster_count: cluster_count,
                glyph_source: GlyphSource::Boundary,
                source_glyph_start: glyph_start - run.glyph_start,
                source_glyph_count: glyph_count,
            },
            translation,
        )?;
        Ok(BoundarySlice {
            occurrence: PlacementOccurrence {
                segment_index,
                translation_inline,
                translation_block,
            },
            glyph_count,
            cluster_count,
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn position_boundary_span(
        &mut self,
        line: FlowLine,
        mut cursor: f64,
        glyph_start: u32,
        glyph_count: u32,
        binding_handle: u32,
        font_handle: u32,
        bidi_level: u8,
        cluster_override: Option<u32>,
        fallback_cluster: usize,
        arena: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        occurrence: Option<PlacementOccurrence>,
    ) -> Result<f64, EngineError> {
        let metrics = metrics_for(font_handle)
            .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
        if font_handle == 0 || metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let start = usize::try_from(glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::try_from(glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        for glyph in start..end {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.positioned_boundary_glyph_visits += 1
            });
            let shaped_cluster = *arena
                .shape
                .clusters
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            let cluster_index = if cluster_override.is_some() {
                fallback_cluster
            } else {
                clusters
                    .starts
                    .binary_search(&shaped_cluster)
                    .unwrap_or(fallback_cluster)
            };
            let style_index = usize::try_from(
                *clusters
                    .style_indexes
                    .get(cluster_index)
                    .ok_or(EngineError::InvalidRequest)?,
            )
            .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles
                .get(style_index)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
            let x_advance = f64::from(
                arena
                    .shape
                    .x_advances
                    .get(glyph)
                    .copied()
                    .ok_or(EngineError::InvalidRequest)?,
            )
            .abs()
                * scale;
            let occurrence = occurrence.ok_or(EngineError::InvalidRequest)?;
            let segment = *self
                .placement
                .segment_rows()
                .get(
                    usize::try_from(occurrence.segment_index)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            let span = OccurrenceSpan {
                source: GlyphSource::Boundary,
                run_owner: segment.layout_run_owner,
                run_index: segment.layout_run_index,
                source_glyph_start: u32::try_from(glyph)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                source_glyph_count: 1,
                cluster_order: ClusterOrder::Single,
                cluster_count: 1,
                owner_cluster: u32::try_from(cluster_index)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                cluster_override,
                semantic_start: 0,
                outlined_start: 0,
                outlined_count: 0,
                placement_segment: occurrence.segment_index,
                line: self.current_source_line,
                line_facts: SourceLineFacts::from(line),
                font_handle,
                binding_handle,
                font_size: style.font_size,
                bidi_level,
            };
            // The replacement local arena is owned by `self`; rank admission is immutable
            // while positioning, so read it before mutating the span stream.
            let local_counts = self
                .replacement_run_local
                .source_range_counts(span.source_glyph_start, 1)
                .ok_or(EngineError::InvalidRequest)?;
            if local_counts.0 != 1 {
                return Err(EngineError::InvalidRequest);
            }
            self.push_occurrence_span_with_counts(span, local_counts.1)?;
            self.placement
                .push_segment_instances(occurrence.segment_index, local_counts.1)?;
            cursor += x_advance;
            if cluster_override.is_none() {
                let next_cluster = (glyph + 1 < end)
                    .then(|| arena.shape.clusters.get(glyph + 1).copied())
                    .flatten();
                if next_cluster != Some(shaped_cluster) {
                    cursor += f64::from(style.letter_spacing);
                    if clusters
                        .starts
                        .get(cluster_index)
                        .and_then(|start| usize::try_from(*start).ok())
                        .and_then(|start| text.get(start))
                        == Some(&0x20)
                    {
                        cursor += f64::from(style.word_spacing);
                    }
                }
            }
        }
        Ok(cursor)
    }
}
