//! Matching new flow lines against the previous arena's lines so unchanged lines are retained.

use super::*;

impl PositionedGlyphArena {
    /// Appends a line whose flow and drop cap are unchanged from the previous build, when its
    /// placement and occurrences still prove out; `false` sends it to repositioning.
    pub(super) fn append_clean_retained_line(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        walk: &mut LineBuildWalk<'_>,
    ) -> Result<bool, EngineError> {
        let previous = src.previous;
        let line_index = head.line_index;
        let previous_glyph_count = *previous
            .line_glyph_counts
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let target = RetainedLineTarget {
            body: RetainedSourceLine {
                index: line_index,
                line: head.line,
            },
            drop_cap: head.drop_cap.map(|cap| RetainedSourceLine {
                index: walk.drop_cap_cursor,
                line: cap.line,
            }),
        };
        let proof = RetainedOccurrenceProof {
            previous,
            clusters: src.clusters,
            previous_clusters: src.previous_clusters,
            boundary: src.boundary_shape,
            previous_boundary: src.previous_boundary_shape,
            replacement_runs: &self.replacement_runs,
            replacement_run_boundary_indices: &self.replacement_run_boundary_indices,
            replacement_local: &self.replacement_run_local,
            line_index,
            target,
            clean_line: true,
            spans: &mut self.occurrence_spans,
            semantic_count: &mut self.occurrence_semantic_count,
            outlined_count: &mut self.occurrence_outlined_count,
        };
        let remap = match self.placement.append_retained_line_validated(
            &previous.placement,
            RetainedLinePlacement {
                line_index,
                old_fragment_start: previous.placement.line_fragment_start(line_index)?,
                new_fragment_start: head.fragment_start,
                instance_count: previous_glyph_count,
            },
            src.clusters.layout_runs(),
            &self.replacement_runs,
            Some(RetainedRunCorrespondence {
                previous_clusters: src.previous_clusters,
                clusters: src.clusters,
                previous_runs: src.previous_runs,
                runs: src.runs,
            }),
            |placement, remap| proof.append(placement, remap),
        ) {
            Ok((remap, ())) => remap,
            Err(EngineError::InvalidRequest) => return Ok(false),
            Err(error) => return Err(error),
        };
        walk.source_coordinates_retained &= self.retained_line_keeps_ordinals(previous, line_index);
        self.append_retained_line(previous, line_index, target, Some(remap))?;
        // An edit moved cluster indexes under the retained steps.
        self.push_line_topology(
            (head.line_span_start, head.line_step_start),
            usize::from(head.line.fragment_count),
            false,
        )?;
        if head.drop_cap.is_some() {
            walk.drop_cap_cursor += 1;
        }
        Ok(true)
    }

    /// Finds the previous build's line holding this line's clusters. An exact match without
    /// edge pairs is appended whole when its occurrences prove out; any other match is the
    /// numeric source repositioning repeats.
    pub(super) fn retain_matched_line(
        &mut self,
        src: PositioningSource<'_>,
        head: &LineBuildHead,
        fragments: &RopeCursorRange<'_, FlowFragment>,
        retained_cursor: &mut RetainedFlowLineCursor<'_>,
        source_coordinates_retained: &mut bool,
    ) -> Result<MatchedLine, EngineError> {
        let line = head.line;
        let Some(matched) = matching_retained_line(
            line,
            fragments,
            head.final_line,
            retained_cursor,
            src.clusters,
            src.bidi,
            (src.typography_for)(line.flow_thread_id),
            (src.retained_typography_for)(line.flow_thread_id),
            (
                src.boundary_shape,
                src.previous_boundary_shape,
                &mut self.edge_pairs,
            ),
        )?
        else {
            return Ok(MatchedLine::Reposition(None));
        };
        let (previous_line_index, previous_line) = (matched.index, matched.line);
        let previous_fragment_start = retained_cursor
            .fragment_index
            .checked_sub(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        if !matched.exact || matched.edges {
            return Ok(MatchedLine::Reposition(Some((
                previous_line_index,
                previous_fragment_start,
                matched.edges,
            ))));
        }
        let previous = src.previous;
        let previous_glyph_count = *previous
            .line_glyph_counts
            .get(previous_line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let target = RetainedLineTarget {
            body: RetainedSourceLine {
                index: head.line_index,
                line,
            },
            drop_cap: None,
        };
        let proof = RetainedOccurrenceProof {
            previous,
            clusters: src.clusters,
            previous_clusters: src.previous_clusters,
            boundary: src.boundary_shape,
            previous_boundary: src.previous_boundary_shape,
            replacement_runs: &self.replacement_runs,
            replacement_run_boundary_indices: &self.replacement_run_boundary_indices,
            replacement_local: &self.replacement_run_local,
            line_index: previous_line_index,
            target,
            clean_line: false,
            spans: &mut self.occurrence_spans,
            semantic_count: &mut self.occurrence_semantic_count,
            outlined_count: &mut self.occurrence_outlined_count,
        };
        let remap = match self.placement.append_retained_line_validated(
            &previous.placement,
            RetainedLinePlacement {
                line_index: previous_line_index,
                old_fragment_start: u32::try_from(previous_fragment_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                new_fragment_start: head.fragment_start,
                instance_count: previous_glyph_count,
            },
            src.clusters.layout_runs(),
            &self.replacement_runs,
            None,
            |placement, remap| proof.append(placement, remap),
        ) {
            Ok((remap, ())) => remap,
            Err(EngineError::InvalidRequest) => return Ok(MatchedLine::Reposition(None)),
            Err(error) => return Err(error),
        };
        *source_coordinates_retained &=
            self.retained_line_keeps_ordinals(previous, previous_line_index);
        self.append_retained_line(previous, previous_line_index, target, Some(remap))?;
        self.copy_line_topology(
            previous,
            (previous_line_index, previous_fragment_start),
            (head.line_span_start, head.line_step_start),
            usize::from(line.fragment_count),
        )?;
        Ok(MatchedLine::Appended)
    }

    /// Whether the retained line just admitted starts at the outlined ordinal and the layout
    /// index it had in `previous`. Gather skips a retained line's records only while both
    /// hold: a record is addressed by its outlined ordinal and publishes its layout index.
    fn retained_line_keeps_ordinals(&self, previous: &Self, line_index: usize) -> bool {
        let start = |starts: &[u32], counts: &[u32], total: usize| {
            matches!(
                (starts.get(line_index), counts.get(line_index)),
                (Some(&start), Some(&count))
                    if total.checked_sub(count as usize) == Some(start as usize)
            )
        };
        start(
            &previous.line_glyph_starts,
            &previous.line_glyph_counts,
            self.outlined_count(),
        ) && start(
            &previous.semantic_line_glyph_starts,
            &previous.semantic_line_glyph_counts,
            self.occurrence_count(),
        )
    }

    pub(super) fn append_retained_line(
        &mut self,
        previous: &Self,
        line_index: usize,
        _target: RetainedLineTarget,
        _segment_remap: Option<RetainedSegmentRemap>,
    ) -> Result<(), EngineError> {
        // Placement and occurrence spans were admitted together inside the
        // preceding checkpoint. Only per-line summaries and decorations remain.
        let outlined = *previous
            .line_glyph_counts
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic = *previous
            .semantic_line_glyph_counts
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let outlined_start = self
            .outlined_count()
            .checked_sub(outlined as usize)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic_start = self
            .occurrence_count()
            .checked_sub(semantic as usize)
            .ok_or(EngineError::InvalidRequest)?;
        self.line_glyph_starts
            .push(u32::try_from(outlined_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_glyph_counts.push(outlined);
        self.semantic_line_glyph_starts
            .push(u32::try_from(semantic_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.semantic_line_glyph_counts.push(semantic);
        self.semantic_line_inline_extents.push(
            *previous
                .semantic_line_inline_extents
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        );
        // The retained glyphs keep their rows and their translations, so their ink is the same.
        let ink = *previous
            .line_ink
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        self.line_ink_complete &= ink.state != LineInkState::Unmeasured;
        self.line_ink.push(ink);
        self.line_missing_glyphs.push(
            *previous
                .line_missing_glyphs
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        );
        let decoration_start = usize::try_from(
            *previous
                .line_decoration_starts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let decoration_count = usize::try_from(
            *previous
                .line_decoration_counts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let decoration_end = decoration_start
            .checked_add(decoration_count)
            .ok_or(EngineError::InvalidRequest)?;
        reserve(&mut self.decorations, decoration_count)?;
        self.line_decoration_starts
            .push(u32::try_from(self.decorations.len()).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_decoration_counts
            .push(u32::try_from(decoration_count).map_err(|_| EngineError::ResultTooLarge)?);
        self.decorations.extend_from_slice(
            previous
                .decorations
                .get(decoration_start..decoration_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        #[cfg(test)]
        record_positioned_copy(decoration_count);
        Ok(())
    }
}

impl LineBuildWalk<'_> {
    pub(super) fn line_head(
        &mut self,
        line_index: usize,
        line: FlowLine,
        next_line: Option<FlowLine>,
    ) -> Result<LineBuildHead, EngineError> {
        let first_thread_line = self.previous_flow_thread_id != Some(line.flow_thread_id);
        self.previous_flow_thread_id = Some(line.flow_thread_id);
        let fragment_start_usize = self.fragment_cursor;
        self.fragment_cursor = self
            .fragment_cursor
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::ResultTooLarge)?;
        let fragment_start =
            u32::try_from(fragment_start_usize).map_err(|_| EngineError::ResultTooLarge)?;
        Ok(LineBuildHead {
            line_index,
            line,
            fragment_start,
            first_thread_line,
            final_line: next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id),
            drop_cap: None,
            previous_drop_cap: None,
            line_span_start: 0,
            line_step_start: 0,
        })
    }

    /// The flow's next drop cap when this is its thread's first line and the cap is that
    /// thread's.
    pub(super) fn drop_cap(
        &self,
        flow: &FlowLayoutArena,
        line: FlowLine,
        first_thread_line: bool,
    ) -> Option<FlowDropCap> {
        first_thread_line
            .then(|| flow.drop_caps.get(self.drop_cap_cursor).copied())
            .flatten()
            .filter(|cap| cap.line.flow_thread_id == line.flow_thread_id)
    }

    /// Whether `line_index` lies outside every recomposed range, advancing past ranges that
    /// end before it.
    pub(super) fn is_retained_line(
        &mut self,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        line_index: usize,
    ) -> bool {
        recomposed_lines.is_some_and(|ranges| {
            while ranges
                .get(self.recomposed_line_index)
                .is_some_and(|range| range.end <= line_index)
            {
                self.recomposed_line_index += 1;
            }
            ranges
                .get(self.recomposed_line_index)
                .is_none_or(|range| !range.contains(&line_index))
        })
    }
}

impl<'a> RetainedFlowLineCursor<'a> {
    pub(super) fn new(flow: &'a FlowLayoutArena) -> Option<Self> {
        Some(Self {
            lines: flow.lines.iter().copied().peekable(),
            fragments: flow.fragments.cursor_from(0)?,
            line_index: 0,
            fragment_index: 0,
        })
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn matching_retained_line(
    line: FlowLine,
    fragments: &RopeCursorRange<'_, FlowFragment>,
    final_line: bool,
    cursor: &mut RetainedFlowLineCursor<'_>,
    clusters: &ClusterArena,
    bidi: &BidiAnalysis,
    typography: ThreadTypography,
    previous_typography: ThreadTypography,
    (boundary, previous_boundary, edge_pairs): (
        &BoundaryShapeArena,
        &BoundaryShapeArena,
        &mut Vec<(u32, u32)>,
    ),
) -> Result<Option<RetainedLineMatch>, EngineError> {
    let Some(first) = fragments.first() else {
        return Ok(None);
    };
    let cluster_start = first.line.cluster_start;
    while let Some(previous_line) = cursor.lines.peek().copied() {
        let previous_fragment_end = cursor
            .fragment_index
            .checked_add(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::ResultTooLarge)?;
        let previous_fragments = cursor
            .fragments
            .peek(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let Some(previous_first) = previous_fragments.first() else {
            cursor.lines.next();
            cursor.line_index = cursor
                .line_index
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            cursor
                .fragments
                .advance(usize::from(previous_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            cursor.fragment_index = previous_fragment_end;
            continue;
        };
        if previous_line.flow_thread_id != line.flow_thread_id
            || previous_first.line.cluster_start < cluster_start
        {
            cursor.lines.next();
            cursor.line_index = cursor
                .line_index
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            cursor
                .fragments
                .advance(usize::from(previous_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            cursor.fragment_index = previous_fragment_end;
            continue;
        }
        if previous_first.line.cluster_start > cluster_start {
            return Ok(None);
        }
        let previous_index = cursor.line_index;
        cursor.lines.next();
        cursor.line_index = cursor
            .line_index
            .checked_add(1)
            .ok_or(EngineError::ResultTooLarge)?;
        cursor
            .fragments
            .advance(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        cursor.fragment_index = previous_fragment_end;
        // Content: the same clusters in the same fragments, with an edge record wherever the
        // retained line had one.
        if fragments.len() != previous_fragments.len() {
            return Ok(None);
        }
        edge_pairs.clear();
        for (next, old) in fragments.iter().zip(previous_fragments.iter()) {
            if next.line != old.line {
                return Ok(None);
            }
            for (next, old) in [
                (next.lead_index, old.lead_index),
                (next.tail_index, old.tail_index),
                (next.boundary_index, old.boundary_index),
            ] {
                let absent = crate::engine::flow_composition::NO_BOUNDARY;
                match (next == absent, old == absent) {
                    (true, true) => {}
                    (false, false) => {
                        reserve(edge_pairs, 1)?;
                        edge_pairs.push((old, next));
                    }
                    _ => return Ok(None),
                }
            }
        }
        let previous_final_line = cursor
            .lines
            .peek()
            .is_none_or(|next| next.flow_thread_id != previous_line.flow_thread_id);
        // Whether hung spaces lead is content, so it resolves alike on both sides and any
        // one predicate compares the two pens soundly; visual levels are not needed here.
        let inputs = |source_line: FlowLine,
                      fragment: &FlowFragment,
                      typography: ThreadTypography,
                      final_line: bool| {
            let indent = if fragment.line.cluster_start == 0 {
                typography.first_line_indent
            } else {
                0.0
            };
            let (distribution, origin) = fragment_pen(
                source_line,
                *fragment,
                final_line,
                clusters,
                usize::try_from(fragment.line.cluster_start).unwrap_or(0),
                usize::try_from(fragment.line.cluster_end).unwrap_or(0),
                indent,
                typography.justify,
                paragraph_level_at(bidi, fragment.line.text_start),
                false,
            );
            (distribution, origin.to_bits(), indent.to_bits())
        };
        let exact = previous_line.region_id == line.region_id
            && previous_line.transform_index == line.transform_index
            && previous_line.clip_id == line.clip_id
            && previous_line.align == line.align
            && previous_line.block_start.to_bits() == line.block_start.to_bits()
            && previous_line.baseline.to_bits() == line.baseline.to_bits()
            && previous_line.height.to_bits() == line.height.to_bits()
            && final_line == previous_final_line
            && fragments
                .iter()
                .zip(previous_fragments.iter())
                .all(|(next, old)| {
                    next.slot_start.to_bits() == old.slot_start.to_bits()
                        && inputs(line, next, typography, final_line)
                            == inputs(previous_line, old, previous_typography, previous_final_line)
                });
        let edges = !edge_pairs.is_empty();
        if edges {
            // An island advances the pen by its own content, so only a line whose numbers and
            // edge content are both unchanged is retained.
            if !exact {
                return Ok(None);
            }
            for (old, next) in edge_pairs.iter().copied() {
                if !same_edge_record(boundary, next, previous_boundary, old)? {
                    return Ok(None);
                }
            }
        }
        return Ok(Some(RetainedLineMatch {
            index: previous_index,
            line: previous_line,
            exact,
            edges,
        }));
    }
    Ok(None)
}

/// Whether two edge records shape the same glyphs over the same clusters. Where the records
/// sit in their arenas, and the stable ids their glyphs were given, are not content.
pub(super) fn same_edge_record(
    current: &BoundaryShapeArena,
    current_index: u32,
    previous: &BoundaryShapeArena,
    previous_index: u32,
) -> Result<bool, EngineError> {
    let next = current
        .record(current_index)
        .ok_or(EngineError::InvalidRequest)?;
    let old = previous
        .record(previous_index)
        .ok_or(EngineError::InvalidRequest)?;
    let unplaced = |record: BoundaryShape| BoundaryShape {
        source_glyph_start: 0,
        ellipsis_glyph_start: 0,
        ..record
    };
    if unplaced(next) != unplaced(old) {
        return Ok(false);
    }
    for (next_start, old_start, count) in [
        (
            next.source_glyph_start,
            old.source_glyph_start,
            next.source_glyph_count,
        ),
        (
            next.ellipsis_glyph_start,
            old.ellipsis_glyph_start,
            next.ellipsis_glyph_count,
        ),
    ] {
        let next = next_start as usize..next_start as usize + count as usize;
        let old = old_start as usize..old_start as usize + count as usize;
        fn lane<'a, T>(
            lane: &'a [T],
            range: &core::ops::Range<usize>,
        ) -> Result<&'a [T], EngineError> {
            lane.get(range.clone()).ok_or(EngineError::InvalidRequest)
        }
        let (a, b) = (&current.shape, &previous.shape);
        if lane(&a.glyph_ids, &next)? != lane(&b.glyph_ids, &old)?
            || lane(&a.clusters, &next)? != lane(&b.clusters, &old)?
            || lane(&a.x_advances, &next)? != lane(&b.x_advances, &old)?
            || lane(&a.y_advances, &next)? != lane(&b.y_advances, &old)?
            || lane(&a.x_offsets, &next)? != lane(&b.x_offsets, &old)?
            || lane(&a.y_offsets, &next)? != lane(&b.y_offsets, &old)?
            || lane(&a.glyph_flags, &next)? != lane(&b.glyph_flags, &old)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Whether a freshly composed flow would position EXACTLY as the committed
/// flow — the geometry-only resize short-circuit (the resize analogue of the
/// D-253 measure adoption). Positioning is a deterministic function of each
/// fragment's cluster range, pen origin, and justify distribution once text,
/// styles, clusters, and bidi are unchanged (the caller's precondition), so
/// bit-equality of those computed inputs proves output equality without
/// running the positioning, gather, or publication tail. Edge records and drop
/// caps are admitted when their records are bit-equal (edges: the same index into
/// an equal boundary arena); ellipsis flows fall through to the full path.
pub(crate) fn flow_positioning_equivalent(
    pending: &FlowLayoutArena,
    committed: &FlowLayoutArena,
    clusters: &ClusterArena,
    bidi: &BidiAnalysis,
    pending_typography: impl Fn(u32) -> ThreadTypography + Copy,
    committed_typography: impl Fn(u32) -> ThreadTypography + Copy,
    (pending_boundary, committed_boundary): (&BoundaryShapeArena, &BoundaryShapeArena),
) -> Result<bool, EngineError> {
    if pending.lines.len() != committed.lines.len()
        || pending.drop_caps.len() != committed.drop_caps.len()
        || !pending.ellipsis_threads().is_empty()
        || !committed.ellipsis_threads().is_empty()
    {
        return Ok(false);
    }
    // A drop cap is positioned from its own line and fragment alone, like a body fragment
    // with no indent or justification.
    for (cap, previous) in pending.drop_caps.iter().zip(&committed.drop_caps) {
        if cap != previous
            || !same_line_numbers(cap.line, previous.line)
            || cap.fragment.slot_start.to_bits() != previous.fragment.slot_start.to_bits()
            || cap.fragment.slot_end.to_bits() != previous.fragment.slot_end.to_bits()
            || [
                cap.fragment.lead_index,
                cap.fragment.tail_index,
                cap.fragment.boundary_index,
            ]
            .iter()
            .any(|index| *index != crate::engine::flow_composition::NO_BOUNDARY)
        {
            return Ok(false);
        }
    }
    // Edge records are positioned from the boundary arena by index. When the new flow's
    // arena equals the committed one, the same index names the same island, glyphs and
    // stable ids, so committing either arena leaves the committed positioning true.
    let mut boundary_compared = None;
    let mut fragment_cursor = pending
        .fragments
        .cursor_from(0)
        .ok_or(EngineError::InvalidRequest)?;
    let mut previous_fragment_cursor = committed
        .fragments
        .cursor_from(0)
        .ok_or(EngineError::InvalidRequest)?;
    let mut lines = pending.lines.iter().zip(committed.lines.iter()).peekable();
    while let Some((line, previous)) = lines.next() {
        let next_line = lines.peek().map(|(line, _)| *line);
        if !same_line_numbers(*line, *previous) {
            return Ok(false);
        }
        let final_line = next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
        let fragments = fragment_cursor
            .take(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let previous_fragments = previous_fragment_cursor
            .take(usize::from(previous.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        if fragments.len() != previous_fragments.len() {
            return Ok(false);
        }
        for (fragment, previous_fragment) in fragments.iter().zip(previous_fragments.iter()) {
            if fragment.line != previous_fragment.line
                || fragment.boundary_index != previous_fragment.boundary_index
                || fragment.lead_index != previous_fragment.lead_index
                || fragment.tail_index != previous_fragment.tail_index
            {
                return Ok(false);
            }
            // `NO_BOUNDARY` is all ones, so the three indexes are absent exactly when their
            // conjunction is.
            if fragment.boundary_index & fragment.lead_index & fragment.tail_index
                != crate::engine::flow_composition::NO_BOUNDARY
                && !same_boundary(pending_boundary, committed_boundary, &mut boundary_compared)
            {
                return Ok(false);
            }
            let inputs = |fragment: &FlowFragment, typography: ThreadTypography| {
                let indent = if fragment.line.cluster_start == 0 {
                    typography.first_line_indent
                } else {
                    0.0
                };
                let (distribution, origin) = fragment_pen(
                    *line,
                    *fragment,
                    final_line,
                    clusters,
                    usize::try_from(fragment.line.cluster_start).unwrap_or(0),
                    usize::try_from(fragment.line.cluster_end).unwrap_or(0),
                    indent,
                    typography.justify,
                    paragraph_level_at(bidi, fragment.line.text_start),
                    // This compares two pens rather than placing glyphs, and the caller's
                    // precondition is that text, styles, clusters, and bidi are unchanged --
                    // so the real predicate resolves identically on both sides. Any predicate
                    // applied to both therefore yields the same equality answer, and shaping
                    // runs are not in scope here to resolve the true one.
                    paragraph_level_at(bidi, fragment.line.text_start) & 1 != 0,
                );
                (distribution, origin.to_bits(), indent.to_bits())
            };
            let next = inputs(fragment, pending_typography(line.flow_thread_id));
            let prior = inputs(
                previous_fragment,
                committed_typography(previous.flow_thread_id),
            );
            if next != prior {
                return Ok(false);
            }
        }
    }
    if !fragment_cursor.is_empty() || !previous_fragment_cursor.is_empty() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(true)
}

/// The arena comparison, run at most once per proof and only for a flow with edge records.
#[cold]
pub(super) fn same_boundary(
    pending: &BoundaryShapeArena,
    committed: &BoundaryShapeArena,
    compared: &mut Option<bool>,
) -> bool {
    *compared.get_or_insert_with(|| pending.same_as(committed))
}

/// Whether two lines carry the same numbers positioning reads, bit for bit.
#[inline(always)]
pub(super) fn same_line_numbers(line: FlowLine, previous: FlowLine) -> bool {
    line.flow_thread_id == previous.flow_thread_id
        && line.region_id == previous.region_id
        && line.transform_index == previous.transform_index
        && line.clip_id == previous.clip_id
        && line.fragment_count == previous.fragment_count
        && line.align == previous.align
        && line.block_start.to_bits() == previous.block_start.to_bits()
        && line.baseline.to_bits() == previous.baseline.to_bits()
        && line.height.to_bits() == previous.height.to_bits()
}
