//! Body positioning by placement segment.
//!
//! A segment is positioned in two dense passes over its clusters in visual order: occurrence
//! spans are cut where a content lane changes (binding, bidi level, glyph adjacency), and the
//! pen runs the same serial f64 chain the per-cluster walk ran. Neither pass builds a span or
//! tests a merge per cluster.

use crate::FontMetrics;

use super::{
    BodyLine, CLUSTER_HARD_BREAK, ClusterArena, ClusterOrder, EngineError, FragmentPositionState,
    GlyphSource, JustifyDistribution, LayoutRun, OccurrenceSpan, PlacementCluster,
    PositionedCluster, PositionedGlyphArena, RunGeometry, SegmentWalk, SourceLineFacts,
    apply_justification, cluster_level,
};

/// The span being grown over visually consecutive clusters of one segment.
#[derive(Clone, Copy)]
struct OpenSpan {
    /// First cluster in visual order.
    owner: u32,
    clusters: u32,
    glyph_start: u32,
    glyph_count: u32,
    binding: u32,
    level: u8,
}

impl PositionedGlyphArena {
    /// How many clusters, counted from `cluster` in visual order, the per-cluster walk would
    /// have kept in the segment `cluster` just opened or joined: the same run, block and
    /// anchor, glyphs adjacent in the run's direction, and a translation that publishes the
    /// segment's f32. The pen is advanced on a copy; `position_segment` runs it for real.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn visual_segment_reach(
        &self,
        clusters: &ClusterArena,
        layout_run: LayoutRun,
        direction: u8,
        cluster: usize,
        (visually_ltr, next_visual, remaining): (bool, usize, usize),
        translation_inline: f32,
        placement: PlacementCluster,
        justify: JustifyDistribution,
        state: &FragmentPositionState,
    ) -> usize {
        let run_start = layout_run.cluster_start as usize;
        let run_end = layout_run.cluster_end as usize;
        let reverse = direction & 1 != 0;
        let head_lane = layout_run.numeric_blocks.cluster_start as usize
            + if reverse {
                run_end - cluster - 1
            } else {
                cluster - run_start
            };
        let blocks = clusters.run_local().cluster_blocks();
        let prefixes = clusters.run_local().cluster_prefixes();
        let Some(block) = blocks.get(head_lane) else {
            return 1;
        };
        let mut cursor = state.cursor;
        let mut space_ordinal = state.space_ordinal;
        let mut gap_ordinal = state.gap_ordinal;
        let mut current = cluster;
        let mut count = 1;
        while count <= remaining {
            cursor += clusters.advances[current];
            apply_justification(
                current,
                clusters,
                justify,
                &mut cursor,
                &mut space_ordinal,
                &mut gap_ordinal,
            );
            let next = if visually_ltr {
                current + 1
            } else {
                self.visual_clusters[next_visual + count - 1] as usize
            };
            let adjacent = if reverse {
                next + 1 == current
            } else {
                next == current + 1
            };
            if !adjacent
                || next < run_start
                || next >= run_end
                || clusters.flags[next] & CLUSTER_HARD_BREAK != 0
                || clusters.placement_segment_anchors.get(next) != Some(&placement.segment_anchor)
                || blocks.get(head_lane + count) != Some(block)
            {
                break;
            }
            let glyphs_adjacent = if reverse {
                clusters.glyph_starts[next].checked_add(clusters.glyph_counts[next])
                    == Some(clusters.glyph_starts[current])
            } else {
                clusters.glyph_starts[current].checked_add(clusters.glyph_counts[current])
                    == Some(clusters.glyph_starts[next])
            };
            let Some(prefix) = prefixes.get(head_lane + count) else {
                break;
            };
            let translation = (cursor - prefix + placement.block_anchor_inline) as f32;
            if !glyphs_adjacent || translation.to_bits() != translation_inline.to_bits() {
                break;
            }
            current = next;
            count += 1;
        }
        count
    }

    /// Emits the occurrence spans of one segment's clusters and advances the pen across them.
    pub(super) fn position_segment(
        &mut self,
        body: BodyLine<'_>,
        walk: SegmentWalk,
        geometry: RunGeometry,
        adjust: bool,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        let clusters = body.clusters;
        #[cfg(test)]
        super::super::work_attribution::record(|work| {
            work.positioned_cluster_visits += (0..walk.count)
                .filter(|offset| clusters.flags[walk.cluster(*offset)] & CLUSTER_HARD_BREAK == 0)
                .count();
        });
        let mut open: Option<OpenSpan> = None;
        let mut level = 0_u8;
        let mut level_source = None;
        for offset in 0..walk.count {
            let cluster = walk.cluster(offset);
            let glyph_count = clusters.glyph_counts[cluster];
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 || glyph_count == 0 {
                continue;
            }
            if let Some(levels) = walk.levels {
                level = self.visual_levels[levels + offset];
            } else if !self.line_levels.is_empty()
                || level_source != Some(clusters.source_runs[cluster])
            {
                level = cluster_level(
                    cluster,
                    body.text_start,
                    clusters,
                    body.runs,
                    &self.line_levels,
                )?;
                level_source = Some(clusters.source_runs[cluster]);
            }
            let glyph_start = clusters.glyph_starts[cluster];
            let binding = clusters.binding_handles[cluster];
            let cluster = u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?;
            if let Some(span) = &mut open
                && span.binding == binding
                && span.level == level
            {
                // The merge rule of `append_occurrence_span`, applied to neighbours.
                if level & 1 == 0 {
                    if span.owner.checked_add(span.clusters) == Some(cluster)
                        && span.glyph_start.checked_add(span.glyph_count) == Some(glyph_start)
                    {
                        span.clusters += 1;
                        span.glyph_count += glyph_count;
                        continue;
                    }
                } else if cluster.checked_add(span.clusters) == Some(span.owner)
                    && glyph_start.checked_add(glyph_count) == Some(span.glyph_start)
                {
                    span.clusters += 1;
                    span.glyph_start = glyph_start;
                    span.glyph_count += glyph_count;
                    continue;
                }
            }
            if let Some(span) = open.take() {
                self.push_segment_span(body, walk.segment_index, geometry, span)?;
            }
            open = Some(OpenSpan {
                owner: cluster,
                clusters: 1,
                glyph_start,
                glyph_count,
                binding,
                level,
            });
        }
        if let Some(span) = open {
            self.push_segment_span(body, walk.segment_index, geometry, span)?;
        }

        if self.decorated {
            for offset in 0..walk.count {
                let cluster = walk.cluster(offset);
                if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                    continue;
                }
                let style_index = usize::try_from(clusters.style_indexes[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?;
                let style = body
                    .styles
                    .get(style_index)
                    .ok_or(EngineError::InvalidRequest)?
                    .style;
                let cluster_origin = state.cursor;
                state.cursor = cluster_origin + clusters.advances[cluster];
                self.finish_positioned_cluster(
                    body.line,
                    cluster,
                    clusters,
                    PositionedCluster {
                        style,
                        font_handle: geometry.font_handle,
                        cluster_origin,
                    },
                    body.justify,
                    adjust,
                    state,
                    metrics_for,
                )?;
            }
            return Ok(());
        }
        // The pen: one f64 add per cluster in visual order, then its justification adds.
        let mut cursor = state.cursor;
        if adjust {
            for offset in 0..walk.count {
                let cluster = walk.cluster(offset);
                if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                    cursor += clusters.advances[cluster];
                    apply_justification(
                        cluster,
                        clusters,
                        body.justify,
                        &mut cursor,
                        &mut state.space_ordinal,
                        &mut state.gap_ordinal,
                    );
                }
            }
        } else {
            let first = if walk.reverse {
                walk.first + 1 - walk.count
            } else {
                walk.first
            };
            let advances = &clusters.advances[first..first + walk.count];
            let flags = &clusters.flags[first..first + walk.count];
            if walk.reverse {
                for (advance, flags) in advances.iter().zip(flags).rev() {
                    if flags & CLUSTER_HARD_BREAK == 0 {
                        cursor += advance;
                    }
                }
            } else {
                for (advance, flags) in advances.iter().zip(flags) {
                    if flags & CLUSTER_HARD_BREAK == 0 {
                        cursor += advance;
                    }
                }
            }
        }
        state.cursor = cursor;
        Ok(())
    }

    fn push_segment_span(
        &mut self,
        body: BodyLine<'_>,
        segment_index: u32,
        geometry: RunGeometry,
        span: OpenSpan,
    ) -> Result<(), EngineError> {
        let segment = *self
            .placement
            .segment_rows()
            .get(usize::try_from(segment_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let outlined = self.push_occurrence_span(
            OccurrenceSpan {
                source: GlyphSource::LayoutRun,
                run_owner: segment.layout_run_owner,
                run_index: segment.layout_run_index,
                source_glyph_start: span.glyph_start,
                source_glyph_count: span.glyph_count,
                cluster_order: if span.level & 1 == 0 {
                    ClusterOrder::Forward
                } else {
                    ClusterOrder::Reverse
                },
                cluster_count: span.clusters,
                owner_cluster: span.owner,
                cluster_override: None,
                semantic_start: 0,
                outlined_start: 0,
                outlined_count: 0,
                placement_segment: segment_index,
                line: self.current_source_line,
                line_facts: SourceLineFacts::from(body.line),
                font_handle: geometry.font_handle,
                binding_handle: span.binding,
                font_size: geometry.font_size,
                bidi_level: span.level,
            },
            body.clusters.run_local(),
        )?;
        self.placement
            .push_segment_instances(segment_index, outlined)
    }
}
