//! Body positioning by placement segment.
//!
//! A segment is positioned in two dense passes over its clusters in visual order: occurrence
//! spans are cut where a content lane changes (binding, bidi level, glyph adjacency), and the
//! pen runs the same serial f64 chain the per-cluster walk ran. Neither pass builds a span or
//! tests a merge per cluster.

use crate::{FontMetrics, bidi::BidiAnalysis};

use super::{
    BodyLine, CLUSTER_HARD_BREAK, ClusterArena, ClusterOrder, EngineError, FRAGMENT_ADJUSTS_GAPS,
    FRAGMENT_ADJUSTS_SPACES, FRAGMENT_HUNG_LEADS, FRAGMENT_VISUAL_ORDER, FlowFragment, FlowLine,
    FragmentPositionState, GlyphSource, JustifyDistribution, LayoutRun, LayoutRunOwner,
    LayoutRunSourceKind, NO_LANE, OccurrenceSpan, PenStep, PlacementCluster, PositionedCluster,
    PositionedGlyphArena, RopeCursorRange, RunGeometry, STEP_CHECKED, STEP_JOINED, STEP_MERGEABLE,
    STEP_REVERSE, SegmentTranslation, SegmentWalk, SourceLine, SourceLineFacts, ThreadTypography,
    apply_justification, boundary_role_index, cluster_level, finite_f32, fragment_pen,
    paragraph_level_at, positioned_fragment_advance, reserve,
};

/// Whether a retained fragment's steps still cut where its justification now does, and if so
/// whether its pen must adjust per cluster. Layout-run order cuts its steps by what is
/// justified; visual order always steps cluster by cluster.
fn step_adjustment(flags: u8, justify: JustifyDistribution) -> Option<bool> {
    let adjusts_spaces = justify.per_space_units != 0 || justify.extra_space_units != 0;
    let adjusts_gaps = justify.per_gap_units != 0 || justify.extra_gap_units != 0;
    let visual_order = flags & FRAGMENT_VISUAL_ORDER != 0;
    if !visual_order
        && ((flags & FRAGMENT_ADJUSTS_SPACES != 0) != adjusts_spaces
            || (flags & FRAGMENT_ADJUSTS_GAPS != 0) != adjusts_gaps)
    {
        return None;
    }
    Some(visual_order || adjusts_spaces || adjusts_gaps)
}

/// The run-local columns a retained line's numeric pen chain reads.
#[derive(Clone, Copy)]
struct NumericChain<'a> {
    clusters: &'a ClusterArena,
    prefixes: &'a [f64],
    blocks: &'a [super::super::run_local::NumericBlock],
    advances: &'a [f64],
    flags: &'a [u8],
    baseline: f64,
}

/// The serial pen of one retained fragment.
struct NumericPen {
    cursor: f64,
    space_ordinal: i64,
    gap_ordinal: i64,
    justify: JustifyDistribution,
    /// Justification applies per cluster.
    adjust: bool,
}

impl NumericPen {
    #[inline(always)]
    fn advance(&mut self, chain: NumericChain<'_>, cluster: usize, advance: f64, adjust: bool) {
        self.cursor += advance;
        if adjust {
            apply_justification(
                cluster,
                chain.clusters,
                self.justify,
                &mut self.cursor,
                &mut self.space_ordinal,
                &mut self.gap_ordinal,
            );
        }
    }
}

impl NumericChain<'_> {
    /// A step's lane prefix and block anchor; a glyphless break has neither.
    fn step_anchor(self, step: PenStep) -> Result<(f64, f64, f64), EngineError> {
        if step.lane == NO_LANE {
            return Ok((0.0, 0.0, 0.0));
        }
        let block = self
            .blocks
            .get(step.block as usize)
            .ok_or(EngineError::InvalidRequest)?;
        Ok((
            *self
                .prefixes
                .get(step.lane as usize)
                .ok_or(EngineError::InvalidRequest)?,
            block.anchor_inline,
            block.anchor_block,
        ))
    }

    /// Runs the pen over one step's clusters. A checked step re-tests that every cluster after
    /// its first still publishes `segment_inline`; `false` when one no longer does.
    fn advance_step(
        self,
        step: PenStep,
        anchor_inline: f64,
        segment_inline: u32,
        pen: &mut NumericPen,
    ) -> Result<bool, EngineError> {
        let first = step.first as usize;
        let count = step.count as usize;
        if step.flags & STEP_CHECKED == 0 {
            let step_advances = self
                .advances
                .get(first..first + count)
                .ok_or(EngineError::InvalidRequest)?;
            let step_flags = self
                .flags
                .get(first..first + count)
                .ok_or(EngineError::InvalidRequest)?;
            let adjust = pen.adjust;
            for (offset, (advance, flags)) in step_advances.iter().zip(step_flags).enumerate() {
                if flags & CLUSTER_HARD_BREAK == 0 {
                    pen.advance(self, first + offset, *advance, adjust);
                }
            }
            return Ok(true);
        }
        let lane = step.lane as usize;
        let step_prefixes = self
            .prefixes
            .get(lane..lane + count)
            .ok_or(EngineError::InvalidRequest)?;
        let reverse = step.flags & STEP_REVERSE != 0;
        if (reverse && first + 1 < count) || (!reverse && first + count > self.flags.len()) {
            return Err(EngineError::InvalidRequest);
        }
        for (offset, prefix) in step_prefixes.iter().enumerate() {
            let cluster = if reverse {
                first - offset
            } else {
                first + offset
            };
            if offset != 0
                && ((pen.cursor - prefix + anchor_inline) as f32).to_bits() != segment_inline
            {
                return Ok(false);
            }
            if self.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                pen.advance(self, cluster, self.advances[cluster], true);
            }
        }
        Ok(true)
    }
}

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

impl OpenSpan {
    /// The merge rule of `append_occurrence_span`, applied to neighbours: `next` (one cluster)
    /// joins when it shares binding and level and its cluster and glyphs are adjacent in the
    /// level's direction.
    #[inline]
    fn absorb(&mut self, next: OpenSpan) -> bool {
        if self.binding != next.binding || self.level != next.level {
            return false;
        }
        if next.level & 1 == 0 {
            if self.owner.checked_add(self.clusters) == Some(next.owner)
                && self.glyph_start.checked_add(self.glyph_count) == Some(next.glyph_start)
            {
                self.clusters += 1;
                self.glyph_count += next.glyph_count;
                return true;
            }
        } else if next.owner.checked_add(self.clusters) == Some(self.owner)
            && next.glyph_start.checked_add(next.glyph_count) == Some(self.glyph_start)
        {
            self.clusters += 1;
            self.glyph_start = next.glyph_start;
            self.glyph_count += next.glyph_count;
            return true;
        }
        false
    }
}

/// The pen: one f64 add per cluster in visual order, then its justification adds.
fn advance_segment_pen(
    body: BodyLine<'_>,
    walk: SegmentWalk,
    adjust: bool,
    state: &mut FragmentPositionState,
) {
    let clusters = body.clusters;
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
        state.cursor = cursor;
        return;
    }
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
    state.cursor = cursor;
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

    /// The numeric-only repass of a line that holds the clusters `previous_line` held, in the
    /// same fragments and with no edge record: its segments and spans are content and are
    /// copied, and only the pen chain and the segment translations are recomputed. The chain
    /// is the one `position_segment` runs. A segment exists where a translation's published
    /// f32 changes, so every recorded step re-tests that: when one would now join or split
    /// differently, nothing is written and the caller positions the line in full.
    ///
    /// Returns the line's inline end.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn reposition_retained_line(
        &mut self,
        previous: &Self,
        (previous_line, previous_fragment_start): (usize, usize),
        (line_index, line): (usize, FlowLine),
        fragments: &RopeCursorRange<'_, FlowFragment>,
        final_line: bool,
        typography: ThreadTypography,
        clusters: &ClusterArena,
        bidi: &BidiAnalysis,
        fragment_start: u32,
    ) -> Result<Option<f64>, EngineError> {
        if self.decorated || previous.line_repositionable.get(previous_line) != Some(&true) {
            return Ok(None);
        }
        let steps = previous.line_steps(previous_line)?;
        let topology = previous
            .fragment_topology
            .get(previous_fragment_start..previous_fragment_start + fragments.len())
            .ok_or(EngineError::InvalidRequest)?;
        let chain = NumericChain {
            clusters,
            prefixes: clusters.run_local().cluster_prefixes(),
            blocks: clusters.run_local().blocks(),
            advances: clusters.advances.as_slice(),
            flags: clusters.flags.as_slice(),
            baseline: line.block_start + line.baseline,
        };
        self.numeric_translations.clear();
        reserve(&mut self.numeric_translations, steps.len())?;
        let mut inline_end = f64::NEG_INFINITY;
        let mut step_cursor = 0_usize;
        // The published f32 pair of the segment the pen is in.
        let mut segment = (0_u32, 0_u32);
        for (fragment, topology) in fragments.iter().zip(topology) {
            let indent = if fragment.line.cluster_start == 0 {
                typography.first_line_indent
            } else {
                0.0
            };
            let (justify, origin) = fragment_pen(
                line,
                *fragment,
                final_line,
                clusters,
                usize::try_from(fragment.line.cluster_start)
                    .map_err(|_| EngineError::InvalidRequest)?,
                usize::try_from(fragment.line.cluster_end)
                    .map_err(|_| EngineError::InvalidRequest)?,
                indent,
                typography.justify,
                paragraph_level_at(bidi, fragment.line.text_start),
                topology.flags & FRAGMENT_HUNG_LEADS != 0,
            );
            let Some(adjust) = step_adjustment(topology.flags, justify) else {
                return Ok(None);
            };
            let step_end = step_cursor + topology.steps as usize;
            let fragment_steps = steps
                .get(step_cursor..step_end)
                .ok_or(EngineError::InvalidRequest)?;
            step_cursor = step_end;
            let mut pen = NumericPen {
                cursor: origin,
                space_ordinal: 0,
                gap_ordinal: 0,
                justify,
                adjust,
            };
            for step in fragment_steps {
                let Some(anchor_inline) =
                    self.retranslate_step(chain, *step, pen.cursor, &mut segment)?
                else {
                    return Ok(None);
                };
                if !chain.advance_step(*step, anchor_inline, segment.0, &mut pen)? {
                    return Ok(None);
                }
            }
            inline_end = inline_end.max(
                fragment.slot_start
                    + (indent
                        + fragment.line.advance
                        + super::super::layout_units::scaled_from_layout_units(
                            justify.total_units(),
                        )),
            );
        }
        if step_cursor != steps.len() {
            return Err(EngineError::InvalidRequest);
        }

        let translations = core::mem::take(&mut self.numeric_translations);
        let remap = self.placement.append_retranslated_segments(
            &previous.placement,
            previous_line,
            (
                u32::try_from(previous_fragment_start).map_err(|_| EngineError::ResultTooLarge)?,
                fragment_start,
            ),
            &translations,
        );
        self.numeric_translations = translations;
        let remap = remap?;
        self.append_remapped_spans(previous, previous_line, remap, (line_index, line))?;
        reserve(&mut self.pen_steps, steps.len())?;
        self.pen_steps.extend_from_slice(steps);
        reserve(&mut self.fragment_topology, topology.len())?;
        self.fragment_topology.extend_from_slice(topology);
        Ok(Some(inline_end))
    }

    /// Recomputes one step's translation at `cursor`. A step that joined its segment must
    /// still publish the segment's f32 pair, and one that opened a segment must still differ
    /// from it when it could have merged; otherwise `None`. An opening step records its
    /// translation and becomes the segment. Returns the step's block anchor on success.
    fn retranslate_step(
        &mut self,
        chain: NumericChain<'_>,
        step: PenStep,
        cursor: f64,
        segment: &mut (u32, u32),
    ) -> Result<Option<f64>, EngineError> {
        let (prefix, anchor_inline, anchor_block) = chain.step_anchor(step)?;
        let translation = SegmentTranslation {
            translation_inline: cursor - prefix + anchor_inline,
            translation_block: chain.baseline + anchor_block,
        };
        let published = (
            finite_f32(translation.translation_inline)?.to_bits(),
            finite_f32(translation.translation_block)?.to_bits(),
        );
        if step.flags & STEP_JOINED != 0 {
            if published != *segment {
                return Ok(None);
            }
        } else {
            if step.flags & STEP_MERGEABLE != 0 && published == *segment {
                return Ok(None);
            }
            self.numeric_translations.push(translation);
            *segment = published;
        }
        Ok(Some(anchor_inline))
    }

    /// Copies `previous_line`'s occurrence spans onto the remapped placement segments of
    /// body line `line_index`.
    fn append_remapped_spans(
        &mut self,
        previous: &Self,
        previous_line: usize,
        remap: super::RetainedSegmentRemap,
        (line_index, line): (usize, FlowLine),
    ) -> Result<(), EngineError> {
        let spans = previous.line_spans(previous_line)?;
        reserve(&mut self.occurrence_spans, spans.len())?;
        let source_line =
            SourceLine::Body(u32::try_from(line_index).map_err(|_| EngineError::ResultTooLarge)?);
        let line_facts = SourceLineFacts::from(line);
        for old in spans {
            if !matches!(old.line, SourceLine::Body(_)) {
                return Err(EngineError::InvalidRequest);
            }
            let placement_segment = old
                .placement_segment
                .checked_sub(remap.previous_start)
                .filter(|offset| *offset < remap.count)
                .and_then(|offset| remap.next_start.checked_add(offset))
                .ok_or(EngineError::InvalidRequest)?;
            self.occurrence_spans.push(OccurrenceSpan {
                placement_segment,
                line: source_line,
                line_facts,
                semantic_start: self.occurrence_semantic_count,
                outlined_start: self.occurrence_outlined_count,
                ..*old
            });
            self.occurrence_semantic_count = self
                .occurrence_semantic_count
                .checked_add(old.source_glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            self.occurrence_outlined_count = self
                .occurrence_outlined_count
                .checked_add(old.outlined_count)
                .ok_or(EngineError::ResultTooLarge)?;
        }
        Ok(())
    }

    /// Retains a line with edge records whose every positioning input and every edge record's
    /// content equal `previous_line`'s. Its segments, translations, spans and decorations are
    /// what positioning it in full would write, except that an island's glyphs sit elsewhere
    /// in this flow's boundary arena under a run of this build, so boundary segments and spans
    /// are pointed at that run. The line is still published as repositioned: its islands'
    /// glyphs may carry new stable ids.
    ///
    /// Returns the line's inline end, or `None`, with nothing written, when the retained line
    /// cannot be carried over.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn retain_edge_line(
        &mut self,
        previous: &Self,
        (previous_line, previous_fragment_start): (usize, usize),
        (line_index, line): (usize, FlowLine),
        fragments: &RopeCursorRange<'_, FlowFragment>,
        final_line: bool,
        typography: ThreadTypography,
        clusters: &ClusterArena,
        fragment_start: u32,
    ) -> Result<Option<f64>, EngineError> {
        let old_segments = previous.placement.line_segment_range(previous_line)?;
        let spans = previous.line_spans(previous_line)?;
        if spans
            .iter()
            .any(|span| !matches!(span.line, SourceLine::Body(_)))
        {
            return Ok(None);
        }
        // This build's run for each retained boundary segment, before anything is written.
        self.edge_runs.clear();
        reserve(&mut self.edge_runs, old_segments.len())?;
        for segment in &previous.placement.segment_rows()[old_segments.clone()] {
            if segment.layout_run_owner != LayoutRunOwner::Replacement {
                self.edge_runs.push(u32::MAX);
                continue;
            }
            let old_run = segment.layout_run_index as usize;
            let (Some(old_record), Some(LayoutRunSourceKind::Boundary { role, .. })) = (
                previous.replacement_run_boundary_indices.get(old_run),
                previous
                    .replacement_runs
                    .get(old_run)
                    .map(|run| run.source_kind),
            ) else {
                return Ok(None);
            };
            let Some(run) = self
                .edge_pairs
                .iter()
                .find(|(old, _)| old == old_record)
                .and_then(|(_, next)| self.replacement_run_indices.get(*next as usize))
                .and_then(|indices| indices[boundary_role_index(role)])
            else {
                return Ok(None);
            };
            self.edge_runs.push(run);
        }

        let mut inline_end = f64::NEG_INFINITY;
        for fragment in fragments.iter() {
            let indent = if fragment.line.cluster_start == 0 {
                typography.first_line_indent
            } else {
                0.0
            };
            inline_end = inline_end.max(
                fragment.slot_start
                    + positioned_fragment_advance(
                        line,
                        *fragment,
                        final_line,
                        clusters,
                        indent,
                        typography.justify,
                    )?,
            );
        }

        let remap = self.placement.append_retranslated_segments(
            &previous.placement,
            previous_line,
            (
                u32::try_from(previous_fragment_start).map_err(|_| EngineError::ResultTooLarge)?,
                fragment_start,
            ),
            &previous.placement.translations()[old_segments.clone()],
        )?;
        for (offset, run) in self.edge_runs.iter().copied().enumerate() {
            if run != u32::MAX {
                let revision = self
                    .replacement_runs
                    .get(run as usize)
                    .ok_or(EngineError::InvalidRequest)?
                    .canonical_revision;
                self.placement.rebind_segment_run(
                    remap.next_start as usize + offset,
                    run,
                    revision,
                )?;
            }
        }
        reserve(&mut self.occurrence_spans, spans.len())?;
        let source_line =
            SourceLine::Body(u32::try_from(line_index).map_err(|_| EngineError::ResultTooLarge)?);
        let line_facts = SourceLineFacts::from(line);
        for old in spans {
            let offset = old
                .placement_segment
                .checked_sub(remap.previous_start)
                .filter(|offset| *offset < remap.count)
                .ok_or(EngineError::InvalidRequest)?;
            let (run_index, source_glyph_start) = if old.source == GlyphSource::Boundary {
                let run = self.edge_runs[offset as usize];
                let old_run = previous
                    .replacement_runs
                    .get(old.run_index as usize)
                    .ok_or(EngineError::InvalidRequest)?;
                let next_run = self
                    .replacement_runs
                    .get(run as usize)
                    .ok_or(EngineError::InvalidRequest)?;
                (
                    run,
                    old.source_glyph_start
                        .checked_sub(old_run.glyph_start)
                        .and_then(|offset| next_run.glyph_start.checked_add(offset))
                        .ok_or(EngineError::InvalidRequest)?,
                )
            } else {
                (old.run_index, old.source_glyph_start)
            };
            self.occurrence_spans.push(OccurrenceSpan {
                run_index,
                source_glyph_start,
                placement_segment: remap.next_start + offset,
                line: source_line,
                line_facts,
                semantic_start: self.occurrence_semantic_count,
                outlined_start: self.occurrence_outlined_count,
                ..*old
            });
            self.occurrence_semantic_count = self
                .occurrence_semantic_count
                .checked_add(old.source_glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            self.occurrence_outlined_count = self
                .occurrence_outlined_count
                .checked_add(old.outlined_count)
                .ok_or(EngineError::ResultTooLarge)?;
        }
        let decoration_start = *previous
            .line_decoration_starts
            .get(previous_line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let decoration_count = *previous
            .line_decoration_counts
            .get(previous_line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let decorations = previous
            .decorations
            .get(decoration_start..decoration_start + decoration_count)
            .ok_or(EngineError::InvalidRequest)?;
        reserve(&mut self.decorations, decorations.len())?;
        self.decorations.extend_from_slice(decorations);
        Ok(Some(inline_end))
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
        #[cfg(test)]
        super::super::work_attribution::record(|work| {
            work.positioned_cluster_visits += (0..walk.count)
                .filter(|offset| {
                    body.clusters.flags[walk.cluster(*offset)] & CLUSTER_HARD_BREAK == 0
                })
                .count();
        });
        self.emit_segment_spans(body, walk, geometry)?;
        if self.decorated {
            return self.position_decorated_segment(
                body,
                walk,
                geometry,
                adjust,
                state,
                metrics_for,
            );
        }
        advance_segment_pen(body, walk, adjust, state);
        Ok(())
    }

    /// Cuts the segment's glyph-bearing clusters into occurrence spans where the binding,
    /// bidi level or glyph adjacency changes.
    fn emit_segment_spans(
        &mut self,
        body: BodyLine<'_>,
        walk: SegmentWalk,
        geometry: RunGeometry,
    ) -> Result<(), EngineError> {
        let clusters = body.clusters;
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
            let next = OpenSpan {
                owner: u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                clusters: 1,
                glyph_start: clusters.glyph_starts[cluster],
                glyph_count,
                binding: clusters.binding_handles[cluster],
                level,
            };
            if let Some(span) = &mut open
                && span.absorb(next)
            {
                continue;
            }
            if let Some(span) = open.take() {
                self.push_segment_span(body, walk.segment_index, geometry, span)?;
            }
            open = Some(next);
        }
        if let Some(span) = open {
            self.push_segment_span(body, walk.segment_index, geometry, span)?;
        }
        Ok(())
    }

    /// A decorated line finishes each cluster on its own: decorations follow the pen.
    fn position_decorated_segment(
        &mut self,
        body: BodyLine<'_>,
        walk: SegmentWalk,
        geometry: RunGeometry,
        adjust: bool,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        let clusters = body.clusters;
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
