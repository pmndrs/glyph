//! Proving a retained line's occurrences still hold and copying them into the new arena.

use super::*;
use crate::engine::placement_state::PlacementSegment;

#[cfg(test)]
pub(super) fn record_positioned_copy(decorations: usize) {
    crate::engine::work_attribution::record(|work| {
        work.copied_positioned_bytes += decorations * core::mem::size_of::<DecorationRecord>();
    });
}
impl RetainedOccurrenceProof<'_> {
    /// Admission happens inside PlacementState's checkpoint, before retaining spans
    /// and copying the line's decoration records.
    /// The dirty-range producer marks every changed cluster and flow recomposes its line;
    /// an admitted clean body span therefore retains its shaped glyph inputs. Placement
    /// correspondence separately proves the same numeric block, prefix, and anchor.
    /// The equivalent-line path has no dirty-range proof and requires the exact run token.
    pub(super) fn append(
        mut self,
        placement: &PlacementState,
        remap: RetainedSegmentRemap,
    ) -> Result<(), EngineError> {
        let checkpoint = (
            self.spans.len(),
            self.spans.last().copied(),
            *self.semantic_count,
            *self.outlined_count,
        );
        let result = self.append_inner(placement, remap);
        if result.is_err() {
            self.spans.truncate(checkpoint.0);
            if let Some(last) = checkpoint.1 {
                self.spans[checkpoint.0 - 1] = last;
            }
            *self.semantic_count = checkpoint.2;
            *self.outlined_count = checkpoint.3;
        }
        result
    }

    pub(super) fn append_inner(
        &mut self,
        placement: &PlacementState,
        remap: RetainedSegmentRemap,
    ) -> Result<(), EngineError> {
        let start = *self
            .previous
            .semantic_line_glyph_starts
            .get(self.line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let count = *self
            .previous
            .semantic_line_glyph_counts
            .get(self.line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let end = start
            .checked_add(count)
            .ok_or(EngineError::ResultTooLarge)?;
        let first = self
            .previous
            .occurrence_spans
            .partition_point(|span| span.semantic_start + span.source_glyph_count <= start);
        let last = self
            .previous
            .occurrence_spans
            .partition_point(|span| span.semantic_start < end);
        self.spans
            .try_reserve(last - first)
            .map_err(|_| EngineError::ResultTooLarge)?;
        let mut covered = 0_u32;
        let mut outlined_total = 0_u32;
        for old in self.previous.occurrence_spans[first..last].iter().copied() {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.retained_occurrence_span_visits += 1
            });
            if old.semantic_start < start
                || old
                    .semantic_start
                    .checked_add(old.source_glyph_count)
                    .is_none_or(|value| value > end)
            {
                return Err(EngineError::InvalidRequest);
            }
            let outlined = self.retain_span(placement, remap, old)?;
            covered = covered
                .checked_add(old.source_glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            outlined_total = outlined_total
                .checked_add(outlined)
                .ok_or(EngineError::ResultTooLarge)?;
        }
        if covered != count
            || outlined_total
                != *self
                    .previous
                    .line_glyph_counts
                    .get(self.line_index)
                    .ok_or(EngineError::InvalidRequest)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    /// Proves one previous occurrence span still names the same glyphs under its new placement
    /// and appends it re-targeted. Returns its outlined count.
    fn retain_span(
        &mut self,
        placement: &PlacementState,
        remap: RetainedSegmentRemap,
        old: OccurrenceSpan,
    ) -> Result<u32, EngineError> {
        let segment_offset = old
            .placement_segment
            .checked_sub(remap.previous_start)
            .filter(|offset| *offset < remap.count)
            .ok_or(EngineError::InvalidRequest)?;
        let next_segment = remap
            .next_start
            .checked_add(segment_offset)
            .ok_or(EngineError::ResultTooLarge)?;
        let next_placement = *placement
            .segment_rows()
            .get(usize::try_from(next_segment).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let old_placement = *self
            .previous
            .placement
            .segment_rows()
            .get(usize::try_from(old.placement_segment).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        if old.source != next_placement.glyph_source
            || old.run_owner != next_placement.layout_run_owner
            || old.run_index != old_placement.layout_run_index
        {
            return Err(EngineError::InvalidRequest);
        }
        // Both sides read one cluster arena, so a paragraph span over the same run token
        // names the same glyphs: the line moves as a unit and only its placement is new.
        if core::ptr::eq(self.clusters, self.previous_clusters)
            && old.run_owner == LayoutRunOwner::Paragraph
            && old.run_index == next_placement.layout_run_index
            && old_placement.canonical_revision.is_some()
            && old_placement.canonical_revision == next_placement.canonical_revision
        {
            let (line, target_line) = self.target_line(old.line)?;
            append_occurrence_span(
                self.spans,
                self.semantic_count,
                self.outlined_count,
                OccurrenceSpan {
                    placement_segment: next_segment,
                    line,
                    line_facts: SourceLineFacts::from(target_line.line),
                    ..old
                },
                old.outlined_count,
            )?;
            return Ok(old.outlined_count);
        }
        self.retain_moved_span(old, old_placement, next_placement, next_segment)
    }

    /// Retains a span whose run token moved: the runs on both sides must carry the same
    /// canonical glyphs, and the span is re-based onto the new run.
    fn retain_moved_span(
        &mut self,
        old: OccurrenceSpan,
        old_placement: PlacementSegment,
        next_placement: PlacementSegment,
        next_segment: u32,
    ) -> Result<u32, EngineError> {
        let (previous_runs, next_runs, previous_local, next_local) = match old.run_owner {
            LayoutRunOwner::Paragraph => (
                self.previous_clusters.layout_runs(),
                self.clusters.layout_runs(),
                self.previous_clusters.run_local(),
                self.clusters.run_local(),
            ),
            LayoutRunOwner::Replacement => (
                self.previous.replacement_runs.as_slice(),
                self.replacement_runs,
                &self.previous.replacement_run_local,
                self.replacement_local,
            ),
        };
        let old_run = *previous_runs
            .get(usize::try_from(old.run_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let next_run = *next_runs
            .get(
                usize::try_from(next_placement.layout_run_index)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::InvalidRequest)?;
        if old_run.canonical_revision.is_none()
            || old_run.canonical_revision != old_placement.canonical_revision
            || next_run.canonical_revision != next_placement.canonical_revision
            || old_run.source_kind != next_run.source_kind
            || old_run.cluster_start != next_run.cluster_start
            || old_run.font_handle != next_run.font_handle
            || old.font_handle != next_run.font_handle
            || (!self.clean_line && old_run.canonical_revision != next_run.canonical_revision)
        {
            return Err(EngineError::InvalidRequest);
        }
        if old.source == GlyphSource::Boundary {
            self.check_boundary_span(old, old_run, next_run, next_placement)?;
        }
        let source_offset = old
            .source_glyph_start
            .checked_sub(old_run.glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let source_glyph_start = next_run
            .glyph_start
            .checked_add(source_offset)
            .ok_or(EngineError::ResultTooLarge)?;
        let source_end = source_offset
            .checked_add(old.source_glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        if source_end > next_run.glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        let (source_covered, outlined) = next_local
            .source_range_counts(source_glyph_start, old.source_glyph_count)
            .ok_or(EngineError::InvalidRequest)?;
        if source_covered != old.source_glyph_count
            || outlined != old.outlined_count
            || !previous_local
                .same_outline_pattern(
                    old.source_glyph_start,
                    next_local,
                    source_glyph_start,
                    old.source_glyph_count,
                )
                .ok_or(EngineError::InvalidRequest)?
        {
            return Err(EngineError::InvalidRequest);
        }
        let (line, target_line) = self.target_line(old.line)?;
        let owner_cluster = if old.source == GlyphSource::Boundary {
            // Ellipsis fallback ownership may sit just outside the replacement
            // run's (possibly empty) source-cluster interval.
            old.owner_cluster
        } else {
            let owner_offset = old
                .owner_cluster
                .checked_sub(old_run.cluster_start)
                .ok_or(EngineError::InvalidRequest)?;
            next_run
                .cluster_start
                .checked_add(owner_offset)
                .filter(|index| *index < next_run.cluster_end)
                .ok_or(EngineError::InvalidRequest)?
        };
        append_occurrence_span(
            self.spans,
            self.semantic_count,
            self.outlined_count,
            OccurrenceSpan {
                source_glyph_start,
                owner_cluster,
                run_index: next_placement.layout_run_index,
                placement_segment: next_segment,
                line,
                line_facts: SourceLineFacts::from(target_line.line),
                ..old
            },
            outlined,
        )?;
        Ok(outlined)
    }

    /// Replacement tokens come from same_boundary_run. Its relative cluster comparison needs
    /// the absolute base too when projecting retained occurrences: both boundary records must
    /// stay mid-line in this thread with the same binding, override and shaped first cluster.
    fn check_boundary_span(
        &self,
        old: OccurrenceSpan,
        old_run: LayoutRun,
        next_run: LayoutRun,
        next_placement: PlacementSegment,
    ) -> Result<(), EngineError> {
        let current_boundary_index = *self
            .replacement_run_boundary_indices
            .get(
                usize::try_from(next_placement.layout_run_index)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::InvalidRequest)?;
        let previous_boundary_index = *self
            .previous
            .replacement_run_boundary_indices
            .get(usize::try_from(old.run_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let current = self
            .boundary
            .records
            .get(usize::try_from(current_boundary_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let previous = self
            .previous_boundary
            .records
            .get(
                usize::try_from(previous_boundary_index)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::InvalidRequest)?;
        if current.line_start
            || previous.line_start
            || current.flow_thread_id != self.target.body.line.flow_thread_id
            || current.flow_thread_id != previous.flow_thread_id
        {
            return Err(EngineError::InvalidRequest);
        }
        let (binding, override_cluster) = match old_run.source_kind {
            LayoutRunSourceKind::Boundary {
                role: BoundaryRunRole::BoundarySource,
                ..
            } => (current.source_binding_handle, None),
            LayoutRunSourceKind::Boundary {
                role: BoundaryRunRole::Ellipsis,
                ..
            } => (current.ellipsis_binding_handle, Some(current.text_end)),
            _ => return Err(EngineError::InvalidRequest),
        };
        if old_run.canonical_revision != next_run.canonical_revision
            || old.binding_handle != binding
            || old.cluster_override != override_cluster
            || previous.text_end != current.text_end
            || self
                .previous_boundary
                .shape
                .clusters
                .get(old_run.glyph_start as usize)
                != self
                    .boundary
                    .shape
                    .clusters
                    .get(next_run.glyph_start as usize)
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    /// The line a retained span of `line`'s kind lands on.
    pub(super) fn target_line(
        &self,
        line: SourceLine,
    ) -> Result<(SourceLine, RetainedSourceLine), EngineError> {
        let target = match line {
            SourceLine::Body(_) => self.target.body,
            SourceLine::DropCap(_) => self.target.drop_cap.ok_or(EngineError::InvalidRequest)?,
        };
        let index = u32::try_from(target.index).map_err(|_| EngineError::ResultTooLarge)?;
        Ok((
            match line {
                SourceLine::Body(_) => SourceLine::Body(index),
                SourceLine::DropCap(_) => SourceLine::DropCap(index),
            },
            target,
        ))
    }
}
