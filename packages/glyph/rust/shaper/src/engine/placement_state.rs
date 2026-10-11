use alloc::vec::Vec;

use super::{
    EngineError,
    cluster_state::{ClusterArena, LayoutRun, LayoutRunSourceKind, RunCanonicalRevision},
    placement_slot_arena::PlacementHandle,
    shaping_state::ShapingRun,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum PlacementIdentity {
    StableSource,
    Dense,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum GlyphSource {
    LayoutRun,
    Boundary,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LayoutRunOwner {
    Paragraph,
    Replacement,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PlacementSegment {
    pub fragment_index: u32,
    pub layout_run_owner: LayoutRunOwner,
    pub layout_run_index: u32,
    pub placement_handle: Option<PlacementHandle>,
    pub canonical_revision: Option<RunCanonicalRevision>,
    pub identity: PlacementIdentity,
    pub segment_anchor: u32,
    pub source_anchor: u32,
    pub numeric_block_ordinal: u32,
    pub run_cluster_start: u32,
    pub run_cluster_count: u32,
    pub glyph_source: GlyphSource,
    pub source_glyph_start: u32,
    pub source_glyph_count: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SegmentTranslation {
    pub translation_inline: f64,
    pub translation_block: f64,
}

#[derive(Default)]
pub(crate) struct PlacementState {
    segments: Vec<PlacementSegment>,
    translations: Vec<SegmentTranslation>,
    line_segment_starts: Vec<u32>,
    line_segment_counts: Vec<u32>,
    segment_instance_counts: Vec<u32>,
    paragraph_run_lookup: Vec<(RunCanonicalRevision, u32)>,
    replacement_run_lookup: Vec<(RunCanonicalRevision, u32)>,
    last_segment: Option<(u32, PlacementSegment, SegmentTranslation)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlacementCheckpoint {
    segments: usize,
    translations: usize,
    lines: usize,
    segment_instance_counts: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct RetainedLinePlacement {
    pub line_index: usize,
    pub old_fragment_start: u32,
    pub new_fragment_start: u32,
    pub instance_count: u32,
}

/// Current preparation's clean-line proof, admitted by positioning after style validation.
#[derive(Clone, Copy)]
pub(crate) struct RetainedRunCorrespondence<'a> {
    pub previous_clusters: &'a ClusterArena,
    pub clusters: &'a ClusterArena,
    pub previous_runs: &'a [ShapingRun],
    pub runs: &'a [ShapingRun],
}

impl RetainedRunCorrespondence<'_> {
    fn remap(self, mut segment: PlacementSegment) -> Result<PlacementSegment, EngineError> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.placement_remap_attempts += 1);
        if segment.layout_run_owner != LayoutRunOwner::Paragraph
            || segment.glyph_source != GlyphSource::LayoutRun
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_remap_run_rejections += 1);
            return Err(EngineError::InvalidRequest);
        }
        let index =
            usize::try_from(segment.layout_run_index).map_err(|_| EngineError::InvalidRequest)?;
        let old = *self
            .previous_clusters
            .layout_runs()
            .get(index)
            .ok_or(EngineError::InvalidRequest)?;
        let new = *self
            .clusters
            .layout_runs()
            .get(index)
            .ok_or(EngineError::InvalidRequest)?;
        if old.canonical_revision != segment.canonical_revision
            || new.canonical_revision.is_none()
            || old.source_kind != LayoutRunSourceKind::Paragraph
            || new.source_kind != old.source_kind
            || new.cluster_start != old.cluster_start
            || new.cluster_end != old.cluster_end
            || new.glyph_start != old.glyph_start
            || new.glyph_count != old.glyph_count
            || new.font_handle != old.font_handle
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_remap_run_rejections += 1);
            return Err(EngineError::InvalidRequest);
        }
        let direction = self
            .runs
            .get(new.source_run as usize)
            .ok_or(EngineError::InvalidRequest)?
            .direction;
        if self
            .previous_runs
            .get(old.source_run as usize)
            .ok_or(EngineError::InvalidRequest)?
            .direction
            != direction
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_remap_direction_rejections += 1);
            return Err(EngineError::InvalidRequest);
        }
        let start = new
            .cluster_start
            .checked_add(segment.run_cluster_start)
            .ok_or(EngineError::InvalidRequest)?;
        let end = start
            .checked_add(segment.run_cluster_count)
            .filter(|end| *end <= new.cluster_end && *end > start)
            .ok_or(EngineError::InvalidRequest)?;
        let start = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
        let end = usize::try_from(end).map_err(|_| EngineError::InvalidRequest)?;
        if self.clusters.stable_ids.get(start).copied() != Some(segment.source_anchor)
            || self.previous_clusters.stable_ids.get(start).copied() != Some(segment.source_anchor)
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_remap_anchor_rejections += 1);
            return Err(EngineError::InvalidRequest);
        }
        let (numeric, block_end) = self
            .clusters
            .placement_segment_monotone(new, direction, start, false, end)?;
        let old_numeric = self
            .previous_clusters
            .placement_cluster(old, direction, start)?;
        // Copied semantic columns use the old local coordinates. A changed numeric
        // prefix/block requires normal positioning, rather than retagging those rows.
        if numeric != old_numeric
            || block_end < end
            || numeric.segment_anchor != segment.segment_anchor
            || numeric.numeric_block_ordinal != segment.numeric_block_ordinal
            || numeric.dense != (segment.identity == PlacementIdentity::Dense)
        {
            #[cfg(test)]
            {
                // Diagnostic categories have priority: partition, identity, then overlapping
                // numeric causes. Metadata reads do not add another validation traversal.
                let block_span = |clusters: &ClusterArena, run: LayoutRun, ordinal: u32| {
                    run.numeric_blocks
                        .start
                        .checked_add(ordinal)
                        .and_then(|index| clusters.run_local().blocks().get(index as usize))
                        .map(|block| {
                            (
                                block.source_glyph_start,
                                block.source_glyph_count,
                                block.row_count,
                            )
                        })
                };
                let partition = block_end < end
                    || numeric.numeric_block_ordinal != old_numeric.numeric_block_ordinal
                    || block_span(self.clusters, new, numeric.numeric_block_ordinal)
                        != block_span(
                            self.previous_clusters,
                            old,
                            old_numeric.numeric_block_ordinal,
                        );
                let identity = numeric.segment_anchor != old_numeric.segment_anchor
                    || numeric.segment_anchor != segment.segment_anchor
                    || numeric.dense != old_numeric.dense
                    || numeric.dense != (segment.identity == PlacementIdentity::Dense)
                    || numeric.numeric_block_ordinal != segment.numeric_block_ordinal;
                let prefix = numeric.block_local_prefix != old_numeric.block_local_prefix;
                let anchor = numeric.block_anchor_inline != old_numeric.block_anchor_inline
                    || numeric.block_anchor_block != old_numeric.block_anchor_block;
                super::work_attribution::record(|work| {
                    work.placement_remap_numeric_rejections += 1;
                    if partition {
                        work.placement_remap_numeric_partition += 1;
                    } else if identity {
                        work.placement_remap_numeric_identity += 1;
                    } else {
                        match (prefix, anchor) {
                            (true, false) => work.placement_remap_numeric_prefix_only += 1,
                            (false, true) => work.placement_remap_numeric_anchor_only += 1,
                            (true, true) => work.placement_remap_numeric_prefix_and_anchor += 1,
                            (false, false) => work.placement_remap_numeric_other += 1,
                        }
                    }
                });
            }
            return Err(EngineError::InvalidRequest);
        }
        let glyph_start = *self
            .clusters
            .glyph_starts
            .get(start)
            .ok_or(EngineError::InvalidRequest)?;
        let glyph_end = self
            .clusters
            .glyph_starts
            .get(end - 1)
            .copied()
            .and_then(|start| {
                self.clusters
                    .glyph_counts
                    .get(end - 1)
                    .and_then(|count| start.checked_add(*count))
            })
            .ok_or(EngineError::InvalidRequest)?;
        if glyph_start.checked_sub(new.glyph_start) != Some(segment.source_glyph_start)
            || glyph_end.checked_sub(glyph_start) != Some(segment.source_glyph_count)
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_remap_glyph_rejections += 1);
            return Err(EngineError::InvalidRequest);
        }
        segment.canonical_revision = new.canonical_revision;
        #[cfg(test)]
        super::work_attribution::record(|work| work.placement_remap_successes += 1);
        Ok(segment)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RetainedSegmentRemap {
    pub previous_start: u32,
    pub next_start: u32,
    pub count: u32,
}

impl PlacementState {
    pub(crate) fn clear(&mut self) {
        self.segments.clear();
        self.translations.clear();
        self.line_segment_starts.clear();
        self.line_segment_counts.clear();
        self.segment_instance_counts.clear();
        self.paragraph_run_lookup.clear();
        self.replacement_run_lookup.clear();
        self.last_segment = None;
    }

    pub(crate) fn prepare_run_resolution(
        &mut self,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
    ) -> Result<(), EngineError> {
        prepare_run_lookup(&mut self.paragraph_run_lookup, layout_runs)?;
        prepare_run_lookup(&mut self.replacement_run_lookup, replacement_runs)
    }

    pub(crate) fn begin_line(&self) -> usize {
        self.segments.len()
    }

    #[cfg(test)]
    pub(crate) fn glyph_translation(&self, glyph_index: usize) -> Option<SegmentTranslation> {
        let mut instance_start = 0usize;
        for (segment, &count) in self.segment_instance_counts.iter().enumerate() {
            let instance_end = instance_start.checked_add(usize::try_from(count).ok()?)?;
            if glyph_index < instance_end {
                return self.translations.get(segment).copied();
            }
            instance_start = instance_end;
        }
        None
    }

    pub(crate) fn finish_line(&mut self, start: usize) -> Result<(), EngineError> {
        let segments = span_record(start, self.segments.len())?;
        self.reserve_line_record()?;
        self.push_line_record(segments);
        Ok(())
    }

    pub(crate) fn push_segment(
        &mut self,
        segment: PlacementSegment,
        placement: SegmentTranslation,
    ) -> Result<u32, EngineError> {
        let published_inline = placement.translation_inline as f32;
        let published_block = placement.translation_block as f32;
        if (cfg!(not(test)) && segment.canonical_revision.is_none())
            || (segment.numeric_block_ordinal == u32::MAX && segment.source_glyph_count != 0)
            || !placement.translation_inline.is_finite()
            || !placement.translation_block.is_finite()
            || !published_inline.is_finite()
            || !published_block.is_finite()
        {
            return Err(EngineError::InvalidRequest);
        }
        if let Some((last_index, previous, previous_placement)) = self.last_segment
            && usize::try_from(last_index).ok() == self.segments.len().checked_sub(1)
            && same_segment_key(previous, segment)
            && (previous_placement.translation_inline as f32).to_bits()
                == published_inline.to_bits()
            && (previous_placement.translation_block as f32).to_bits() == published_block.to_bits()
            && let Some((cluster_start, cluster_count)) = joined_span(
                previous.run_cluster_start,
                previous.run_cluster_count,
                segment.run_cluster_start,
                segment.run_cluster_count,
            )
            && let Some((glyph_start, glyph_count)) = joined_span(
                previous.source_glyph_start,
                previous.source_glyph_count,
                segment.source_glyph_start,
                segment.source_glyph_count,
            )
        {
            let index = usize::try_from(last_index).map_err(|_| EngineError::InvalidRequest)?;
            let stored = &mut self.segments[index];
            stored.placement_handle = None;
            stored.run_cluster_start = cluster_start;
            stored.run_cluster_count = cluster_count;
            stored.source_glyph_start = glyph_start;
            stored.source_glyph_count = glyph_count;
            self.last_segment = Some((
                last_index,
                PlacementSegment {
                    run_cluster_start: cluster_start,
                    run_cluster_count: cluster_count,
                    source_glyph_start: glyph_start,
                    source_glyph_count: glyph_count,
                    placement_handle: None,
                    ..previous
                },
                previous_placement,
            ));
            return Ok(last_index);
        }
        let index = u32::try_from(self.segments.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.segments
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.translations
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.segment_instance_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.segments.push(segment);
        self.translations.push(placement);
        self.segment_instance_counts.push(0);
        self.last_segment = Some((index, segment, placement));
        Ok(index)
    }

    pub(crate) fn extend_last_segment(
        &mut self,
        segment_index: u32,
        run_cluster_start: u32,
        run_cluster_count: u32,
        source_glyph_start: u32,
        source_glyph_count: u32,
    ) -> Result<(), EngineError> {
        let (last_index, previous, placement) = self
            .last_segment
            .filter(|(last_index, _, _)| *last_index == segment_index)
            .ok_or(EngineError::InvalidRequest)?;
        let index = usize::try_from(last_index).map_err(|_| EngineError::InvalidRequest)?;
        if index.checked_add(1) != Some(self.segments.len()) {
            return Err(EngineError::InvalidRequest);
        }
        let (cluster_start, cluster_count) = joined_span(
            previous.run_cluster_start,
            previous.run_cluster_count,
            run_cluster_start,
            run_cluster_count,
        )
        .ok_or(EngineError::InvalidRequest)?;
        let (glyph_start, glyph_count) = joined_span(
            previous.source_glyph_start,
            previous.source_glyph_count,
            source_glyph_start,
            source_glyph_count,
        )
        .ok_or(EngineError::InvalidRequest)?;
        let stored = self
            .segments
            .get_mut(index)
            .ok_or(EngineError::InvalidRequest)?;
        stored.placement_handle = None;
        stored.run_cluster_start = cluster_start;
        stored.run_cluster_count = cluster_count;
        stored.source_glyph_start = glyph_start;
        stored.source_glyph_count = glyph_count;
        self.last_segment = Some((
            last_index,
            PlacementSegment {
                run_cluster_start: cluster_start,
                run_cluster_count: cluster_count,
                source_glyph_start: glyph_start,
                source_glyph_count: glyph_count,
                placement_handle: None,
                ..previous
            },
            placement,
        ));
        Ok(())
    }

    pub(crate) fn push_segment_instances(
        &mut self,
        segment_index: u32,
        glyph_count: u32,
    ) -> Result<(), EngineError> {
        if glyph_count == 0 {
            return Ok(());
        }
        let segment = usize::try_from(segment_index).map_err(|_| EngineError::InvalidRequest)?;
        let instance_count = self
            .segment_instance_counts
            .get_mut(segment)
            .ok_or(EngineError::InvalidRequest)?;
        *instance_count = instance_count
            .checked_add(glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        self.segments[segment].placement_handle = None;
        if let Some((index, last, _)) = &mut self.last_segment
            && usize::try_from(*index).ok() == Some(segment)
        {
            last.placement_handle = None;
        }
        Ok(())
    }

    pub(crate) fn append_retained_line(
        &mut self,
        previous: &Self,
        retained: RetainedLinePlacement,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
        correspondence: Option<RetainedRunCorrespondence<'_>>,
    ) -> Result<RetainedSegmentRemap, EngineError> {
        let checkpoint = self.checkpoint();
        let result = self.append_retained_line_inner(
            previous,
            retained,
            layout_runs,
            replacement_runs,
            correspondence,
        );
        if result.is_err() {
            self.restore(checkpoint);
        }
        result
    }

    pub(crate) fn line_fragment_start(&self, line_index: usize) -> Result<u32, EngineError> {
        let (start, end) = line_span(
            &self.line_segment_starts,
            &self.line_segment_counts,
            line_index,
            self.segments.len(),
        )?;
        if start == end {
            return Ok(0);
        }
        self.segments
            .get(start)
            .map(|segment| segment.fragment_index)
            .ok_or(EngineError::InvalidRequest)
    }

    fn append_retained_line_inner(
        &mut self,
        previous: &Self,
        retained: RetainedLinePlacement,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
        correspondence: Option<RetainedRunCorrespondence<'_>>,
    ) -> Result<RetainedSegmentRemap, EngineError> {
        if !self.has_aligned_lanes() || !previous.has_aligned_lanes() {
            return Err(EngineError::InvalidRequest);
        }
        let (slice_start, slice_end) = line_span(
            &previous.line_segment_starts,
            &previous.line_segment_counts,
            retained.line_index,
            previous.segments.len(),
        )?;
        let line_start = self.begin_line();
        let next_slice_start = self.segments.len();
        let slice_count = slice_end - slice_start;
        let next_slice_end = checked_grow(next_slice_start, slice_count)?;
        let slice_line_span = span_record(line_start, next_slice_end)?;
        let retained_instance_count = previous.segment_instance_counts[slice_start..slice_end]
            .iter()
            .try_fold(0u32, |total, count| total.checked_add(*count))
            .ok_or(EngineError::ResultTooLarge)?;
        if retained_instance_count != retained.instance_count {
            return Err(EngineError::InvalidRequest);
        }
        self.segments
            .try_reserve(slice_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.translations
            .try_reserve(slice_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.segment_instance_counts
            .try_reserve(slice_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.reserve_line_record()?;

        let mut lookup_prepared = false;
        for relative in 0..slice_count {
            let mut slice = previous.segments[slice_start + relative];
            let fragment_offset = slice
                .fragment_index
                .checked_sub(retained.old_fragment_start)
                .ok_or(EngineError::InvalidRequest)?;
            slice.fragment_index = retained
                .new_fragment_start
                .checked_add(fragment_offset)
                .ok_or(EngineError::ResultTooLarge)?;
            if !hinted_run_matches(slice, layout_runs, replacement_runs) {
                if let Some(correspondence) = correspondence {
                    // A current clean-line proof can rebind the hinted run directly. Failed
                    // correspondence recomputes this line; it cannot authorize a global lookup.
                    slice = correspondence.remap(slice)?;
                } else if !lookup_prepared {
                    self.prepare_run_resolution(layout_runs, replacement_runs)?;
                    lookup_prepared = true;
                }
            }
            slice.layout_run_index = self.resolve_run(slice, layout_runs, replacement_runs)?.0;
            let placement = previous.translations[slice_start + relative];
            self.segments.push(slice);
            self.translations.push(placement);
            self.segment_instance_counts
                .push(previous.segment_instance_counts[slice_start + relative]);
            self.last_segment = Some((
                u32::try_from(self.segments.len() - 1).map_err(|_| EngineError::ResultTooLarge)?,
                slice,
                placement,
            ));
        }
        self.push_line_record(slice_line_span);
        Ok(RetainedSegmentRemap {
            previous_start: u32::try_from(slice_start).map_err(|_| EngineError::ResultTooLarge)?,
            next_start: u32::try_from(next_slice_start).map_err(|_| EngineError::ResultTooLarge)?,
            count: u32::try_from(slice_count).map_err(|_| EngineError::ResultTooLarge)?,
        })
    }

    #[cfg(test)]
    pub(crate) fn segments(&self) -> &[PlacementSegment] {
        &self.segments
    }

    pub(crate) fn validate_occurrences(&self, instance_count: usize) -> Result<(), EngineError> {
        (self.is_valid() && self.instance_count()? == instance_count)
            .then_some(())
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn segment_rows(&self) -> &[PlacementSegment] {
        &self.segments
    }

    pub(crate) fn translations(&self) -> &[SegmentTranslation] {
        &self.translations
    }

    pub(crate) fn segment_instance_counts(&self) -> &[u32] {
        &self.segment_instance_counts
    }

    pub(crate) fn instance_count(&self) -> Result<usize, EngineError> {
        self.segment_instance_counts
            .iter()
            .try_fold(0usize, |total, count| {
                let count = usize::try_from(*count).map_err(|_| EngineError::ResultTooLarge)?;
                total.checked_add(count).ok_or(EngineError::ResultTooLarge)
            })
    }

    pub(crate) fn set_placement_handle(&mut self, index: usize, handle: Option<PlacementHandle>) {
        self.segments[index].placement_handle = handle;
        if let Some((last_index, last, _)) = &mut self.last_segment
            && usize::try_from(*last_index).ok() == Some(index)
        {
            last.placement_handle = handle;
        }
    }

    pub(crate) fn placement_handle(&self, segment_index: usize) -> Option<PlacementHandle> {
        self.segments.get(segment_index)?.placement_handle
    }

    #[cfg(test)]
    pub(crate) fn segment_count(&self) -> usize {
        self.segments.len()
    }

    #[cfg(test)]
    pub(crate) fn translation(&self, index: usize) -> Option<SegmentTranslation> {
        self.translations.get(index).copied()
    }

    fn checkpoint(&self) -> PlacementCheckpoint {
        PlacementCheckpoint {
            segments: self.segments.len(),
            translations: self.translations.len(),
            lines: self.line_segment_starts.len(),
            segment_instance_counts: self.segment_instance_counts.len(),
        }
    }

    fn restore(&mut self, checkpoint: PlacementCheckpoint) {
        self.segments.truncate(checkpoint.segments);
        self.translations.truncate(checkpoint.translations);
        self.line_segment_starts.truncate(checkpoint.lines);
        self.line_segment_counts.truncate(checkpoint.lines);
        self.segment_instance_counts
            .truncate(checkpoint.segment_instance_counts);
        self.last_segment = self.segments.len().checked_sub(1).map(|index| {
            (
                u32::try_from(index).expect("placement segment index already fit u32"),
                self.segments[index],
                self.translations[index],
            )
        });
    }

    fn is_valid(&self) -> bool {
        self.has_aligned_lanes()
    }

    fn has_aligned_lanes(&self) -> bool {
        self.segments.len() == self.translations.len()
            && self.segments.len() == self.segment_instance_counts.len()
            && self.line_segment_starts.len() == self.line_segment_counts.len()
    }

    fn resolve_run<'a>(
        &self,
        segment: PlacementSegment,
        layout_runs: &'a [LayoutRun],
        replacement_runs: &'a [LayoutRun],
    ) -> Result<(u32, &'a LayoutRun), EngineError> {
        let lookup = match segment.layout_run_owner {
            LayoutRunOwner::Paragraph => &self.paragraph_run_lookup,
            LayoutRunOwner::Replacement => &self.replacement_run_lookup,
        };
        resolve_run(segment, layout_runs, replacement_runs, lookup)
    }

    fn reserve_line_record(&mut self) -> Result<(), EngineError> {
        self.line_segment_starts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.line_segment_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        Ok(())
    }

    fn push_line_record(&mut self, segments: (u32, u32)) {
        self.line_segment_starts.push(segments.0);
        self.line_segment_counts.push(segments.1);
    }
}

fn resolve_run<'a>(
    segment: PlacementSegment,
    layout_runs: &'a [LayoutRun],
    replacement_runs: &'a [LayoutRun],
    lookup: &[(RunCanonicalRevision, u32)],
) -> Result<(u32, &'a LayoutRun), EngineError> {
    let runs = match segment.layout_run_owner {
        LayoutRunOwner::Paragraph => layout_runs,
        LayoutRunOwner::Replacement => replacement_runs,
    };
    let expected = segment.canonical_revision;
    let hinted =
        usize::try_from(segment.layout_run_index).map_err(|_| EngineError::InvalidRequest)?;
    let (index, run) = runs
        .get(hinted)
        .filter(|run| expected.is_none_or(|revision| run.canonical_revision == Some(revision)))
        .map(|run| (hinted, run))
        .or_else(|| {
            expected.and_then(|revision| {
                let lookup_index = lookup
                    .binary_search_by_key(&revision.get(), |(candidate, _)| candidate.get())
                    .ok()?;
                let run_index = usize::try_from(lookup[lookup_index].1).ok()?;
                runs.get(run_index).map(|run| (run_index, run))
            })
        })
        .ok_or(EngineError::InvalidRequest)?;
    let valid_owner = matches!(
        (
            segment.layout_run_owner,
            run.source_kind,
            segment.glyph_source
        ),
        (
            LayoutRunOwner::Paragraph,
            LayoutRunSourceKind::Paragraph,
            GlyphSource::LayoutRun
        ) | (
            LayoutRunOwner::Replacement,
            LayoutRunSourceKind::Boundary { .. },
            GlyphSource::Boundary
        )
    );
    valid_owner
        .then_some((
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
            run,
        ))
        .ok_or(EngineError::InvalidRequest)
}

fn hinted_run_matches(
    segment: PlacementSegment,
    layout_runs: &[LayoutRun],
    replacement_runs: &[LayoutRun],
) -> bool {
    let runs = match segment.layout_run_owner {
        LayoutRunOwner::Paragraph => layout_runs,
        LayoutRunOwner::Replacement => replacement_runs,
    };
    usize::try_from(segment.layout_run_index)
        .ok()
        .and_then(|index| runs.get(index))
        .is_some_and(|run| {
            segment
                .canonical_revision
                .is_none_or(|revision| run.canonical_revision == Some(revision))
        })
}

fn prepare_run_lookup(
    lookup: &mut Vec<(RunCanonicalRevision, u32)>,
    runs: &[LayoutRun],
) -> Result<(), EngineError> {
    lookup.clear();
    lookup
        .try_reserve(runs.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    for (index, run) in runs.iter().enumerate() {
        #[cfg(test)]
        super::work_attribution::record(|work| work.placement_run_lookup_visits += 1);
        let revision = run.canonical_revision.ok_or(EngineError::InvalidRequest)?;
        lookup.push((
            revision,
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    lookup.sort_unstable_by_key(|(revision, _)| revision.get());
    if lookup.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

fn same_segment_key(left: PlacementSegment, right: PlacementSegment) -> bool {
    left.fragment_index == right.fragment_index
        && left.layout_run_owner == right.layout_run_owner
        && left.layout_run_index == right.layout_run_index
        && left.canonical_revision == right.canonical_revision
        && left.identity == right.identity
        && left.segment_anchor == right.segment_anchor
        && left.numeric_block_ordinal == right.numeric_block_ordinal
        && left.glyph_source == right.glyph_source
}

fn joined_span(
    left_start: u32,
    left_count: u32,
    right_start: u32,
    right_count: u32,
) -> Option<(u32, u32)> {
    let left_end = left_start.checked_add(left_count)?;
    let right_end = right_start.checked_add(right_count)?;
    if left_end == right_start {
        Some((left_start, left_count.checked_add(right_count)?))
    } else if right_end == left_start {
        Some((right_start, left_count.checked_add(right_count)?))
    } else if left_count == 0 && right_count == 0 && left_start == right_start {
        Some((left_start, 0))
    } else {
        None
    }
}

fn checked_grow(length: usize, additional: usize) -> Result<usize, EngineError> {
    let end = length
        .checked_add(additional)
        .ok_or(EngineError::ResultTooLarge)?;
    u32::try_from(end).map_err(|_| EngineError::ResultTooLarge)?;
    Ok(end)
}

fn span_record(start: usize, end: usize) -> Result<(u32, u32), EngineError> {
    Ok((
        u32::try_from(start).map_err(|_| EngineError::ResultTooLarge)?,
        u32::try_from(end.checked_sub(start).ok_or(EngineError::InvalidRequest)?)
            .map_err(|_| EngineError::ResultTooLarge)?,
    ))
}

fn line_span(
    starts: &[u32],
    counts: &[u32],
    index: usize,
    limit: usize,
) -> Result<(usize, usize), EngineError> {
    let start = usize::try_from(*starts.get(index).ok_or(EngineError::InvalidRequest)?)
        .map_err(|_| EngineError::InvalidRequest)?;
    let count = usize::try_from(*counts.get(index).ok_or(EngineError::InvalidRequest)?)
        .map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(count)
        .filter(|end| *end <= limit)
        .ok_or(EngineError::InvalidRequest)?;
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adjacent_segment(cluster: u32) -> PlacementSegment {
        PlacementSegment {
            fragment_index: 0,
            layout_run_owner: LayoutRunOwner::Paragraph,
            layout_run_index: 0,
            placement_handle: None,
            canonical_revision: None,
            identity: PlacementIdentity::StableSource,
            segment_anchor: 1,
            source_anchor: cluster + 1,
            numeric_block_ordinal: 0,
            run_cluster_start: cluster,
            run_cluster_count: 1,
            glyph_source: GlyphSource::LayoutRun,
            source_glyph_start: cluster,
            source_glyph_count: 1,
        }
    }

    #[test]
    fn segments_merge_by_the_published_f32_translation() {
        let mut state = PlacementState::default();
        let first = state
            .push_segment(
                adjacent_segment(0),
                SegmentTranslation {
                    translation_inline: 1.0,
                    translation_block: 2.0,
                },
            )
            .unwrap();
        let mut slots = super::super::placement_slot_arena::PlacementSlotArena::default();
        slots.prepare(&[1u32], 1).unwrap();
        state.set_placement_handle(0, Some(slots.assignments().unwrap()[0]));
        let second = state
            .push_segment(
                adjacent_segment(1),
                SegmentTranslation {
                    translation_inline: 1.0 + f64::EPSILON,
                    translation_block: 2.0 + f64::EPSILON,
                },
            )
            .unwrap();

        assert_eq!((first, second), (0, 0));
        assert_eq!(state.placement_handle(0), None);
        assert_eq!(state.last_segment.unwrap().1.placement_handle, None);
        assert_eq!(state.segments().len(), 1);
        assert_eq!(state.segments().first().unwrap().run_cluster_count, 2);
        assert_eq!(state.segments().first().unwrap().source_glyph_count, 2);
    }

    #[test]
    fn extending_bound_segment_revokes_complete_span_proof() {
        let mut state = PlacementState::default();
        state
            .push_segment(
                adjacent_segment(0),
                SegmentTranslation {
                    translation_inline: 1.0,
                    translation_block: 2.0,
                },
            )
            .unwrap();
        state.push_segment_instances(0, 1).unwrap();
        let mut slots = super::super::placement_slot_arena::PlacementSlotArena::default();
        slots.prepare(&[1u32], 1).unwrap();
        state.set_placement_handle(0, Some(slots.assignments().unwrap()[0]));
        state.extend_last_segment(0, 1, 1, 1, 1).unwrap();
        assert_eq!(state.placement_handle(0), None);
        assert_eq!(state.last_segment.unwrap().1.placement_handle, None);
    }

    #[test]
    fn retained_line_remaps_fragments_and_invalid_source_rolls_back() {
        let mut next_revision = 1;
        let revisions = [
            RunCanonicalRevision::allocate(&mut next_revision).unwrap(),
            RunCanonicalRevision::allocate(&mut next_revision).unwrap(),
            RunCanonicalRevision::allocate(&mut next_revision).unwrap(),
        ];
        let mut previous = PlacementState::default();
        let line = previous.begin_line();
        let mut segment = adjacent_segment(0);
        segment.fragment_index = 4;
        segment.layout_run_index = 2;
        segment.segment_anchor = 73;
        segment.run_cluster_count = 2;
        segment.source_glyph_count = 2;
        let segment = previous
            .push_segment(
                segment,
                SegmentTranslation {
                    translation_inline: 40.0,
                    translation_block: 12.0,
                },
            )
            .unwrap();
        previous.push_segment_instances(segment, 2).unwrap();
        previous.segments[0].canonical_revision = Some(revisions[2]);
        let mut second = previous.segments[0];
        second.fragment_index = 5;
        second.layout_run_index = 0;
        second.canonical_revision = Some(revisions[0]);
        let second = previous
            .push_segment(
                second,
                SegmentTranslation {
                    translation_inline: 48.0,
                    translation_block: 12.0,
                },
            )
            .unwrap();
        previous.push_segment_instances(second, 2).unwrap();
        previous.finish_line(line).unwrap();
        let mut slots = super::super::placement_slot_arena::PlacementSlotArena::default();
        slots.prepare(&[1u32, 2], 1).unwrap();
        let handles = slots.assignments().unwrap().to_vec();
        for (index, handle) in handles.iter().enumerate() {
            previous.set_placement_handle(index, Some(*handle));
        }

        let runs = revisions.map(|canonical_revision| LayoutRun {
            source_kind: LayoutRunSourceKind::Paragraph,
            cluster_start: 0,
            cluster_end: 2,
            glyph_start: 8,
            glyph_count: 2,
            source_run: 0,
            font_handle: 1,
            numeric_blocks: Default::default(),
            canonical_revision: Some(canonical_revision),
        });

        let mut state = PlacementState::default();
        state.prepare_run_resolution(&runs, &[]).unwrap();
        state
            .append_retained_line(
                &previous,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 4,
                    new_fragment_start: 9,
                    instance_count: 4,
                },
                &runs,
                &[],
                None,
            )
            .unwrap();
        assert_eq!(state.segments().first().unwrap().fragment_index, 9);

        for (index, handle) in handles.iter().enumerate() {
            assert_eq!(state.placement_handle(index), Some(*handle));
        }
        state.push_segment_instances(1, 1).unwrap();
        assert_eq!(state.placement_handle(0), Some(handles[0]));
        assert_eq!(state.placement_handle(1), None);
        assert_eq!(state.last_segment.unwrap().1.placement_handle, None);

        let reordered = [runs[2], runs[0], runs[1]];
        let mut rebound = PlacementState::default();
        super::super::work_attribution::reset();
        rebound
            .append_retained_line(
                &previous,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 4,
                    new_fragment_start: 9,
                    instance_count: 4,
                },
                &reordered,
                &[],
                None,
            )
            .unwrap();
        assert_eq!(rebound.segments().first().unwrap().layout_run_index, 0);
        assert_eq!(rebound.segments()[1].layout_run_index, 1);
        assert_eq!(
            super::super::work_attribution::snapshot().placement_run_lookup_visits,
            reordered.len()
        );

        previous.segments[0].canonical_revision =
            Some(RunCanonicalRevision::allocate(&mut next_revision).unwrap());
        let checkpoint = state.checkpoint();
        assert!(matches!(
            state.append_retained_line(
                &previous,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 4,
                    new_fragment_start: 9,
                    instance_count: 4,
                },
                &runs,
                &[],
                None,
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert_eq!(state.checkpoint(), checkpoint);
    }
}
