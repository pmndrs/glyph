use alloc::vec::Vec;

use super::{
    EngineError,
    cluster_state::{LayoutRun, LayoutRunSourceKind, RunCanonicalRevision},
    placement_slot_arena::PlacementHandle,
};

#[cfg(any(test, feature = "kernel-lab"))]
macro_rules! define_arena {
    (
        $arena:ident, $row:ident,
        $first_lane:ident => $first_field:ident: $first_type:ty
        $(, $lane:ident => $field:ident: $field_type:ty)* $(,)?
    ) => {
        #[derive(Default)]
        pub(crate) struct $arena {
            $first_lane: Vec<$first_type>,
            $($lane: Vec<$field_type>,)*
        }

        impl $arena {
            pub(crate) fn len(&self) -> usize {
                self.$first_lane.len()
            }

            pub(crate) fn get(&self, index: usize) -> Option<$row> {
                Some($row {
                    $first_field: *self.$first_lane.get(index)?,
                    $($field: *self.$lane.get(index)?,)*
                })
            }

            fn row(&self, index: usize) -> $row {
                $row {
                    $first_field: self.$first_lane[index],
                    $($field: self.$lane[index],)*
                }
            }

            fn is_valid(&self) -> bool {
                let len = self.len();
                true $(&& self.$lane.len() == len)*
            }

            fn reserve(&mut self, additional: usize) -> Result<(), EngineError> {
                self.$first_lane
                    .try_reserve(additional)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                $(
                    self.$lane
                        .try_reserve(additional)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                )*
                Ok(())
            }

            fn push(&mut self, row: $row) {
                self.$first_lane.push(row.$first_field);
                $(self.$lane.push(row.$field);)*
            }

            fn truncate(&mut self, len: usize) {
                self.$first_lane.truncate(len);
                $(self.$lane.truncate(len);)*
            }

            fn clear(&mut self) {
                self.truncate(0);
            }
        }
    };
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[allow(dead_code)]
pub(crate) enum SliceRole {
    Ordinary,
    HangingSpace,
    CharacterFallback,
    BoundaryReplacement,
}

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

#[cfg(any(test, feature = "kernel-lab"))]
pub(crate) type LayoutRunSlice = PlacementSegment;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg(any(test, feature = "kernel-lab"))]
pub(crate) struct VisualInstanceSpan {
    pub instance_start: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
    pub glyph_source: GlyphSource,
    pub segment_index: u32,
    pub visual_span_id: u32,
    pub resolved_level: u8,
    pub role: SliceRole,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SegmentTranslation {
    pub translation_inline: f64,
    pub translation_block: f64,
}

#[derive(Default)]
pub(crate) struct PlacementSegmentArena {
    rows: Vec<PlacementSegment>,
}

impl PlacementSegmentArena {
    pub(crate) fn len(&self) -> usize {
        self.rows.len()
    }

    pub(crate) fn get(&self, index: usize) -> Option<PlacementSegment> {
        self.rows.get(index).copied()
    }

    fn row(&self, index: usize) -> PlacementSegment {
        self.rows[index]
    }

    fn is_valid(&self) -> bool {
        true
    }

    fn reserve(&mut self, additional: usize) -> Result<(), EngineError> {
        self.rows
            .try_reserve(additional)
            .map_err(|_| EngineError::ResultTooLarge)
    }

    fn push(&mut self, row: PlacementSegment) {
        self.rows.push(row);
    }

    fn truncate(&mut self, len: usize) {
        self.rows.truncate(len);
    }

    fn clear(&mut self) {
        self.rows.clear();
    }
}

#[derive(Default)]
pub(crate) struct SegmentTranslationArena {
    rows: Vec<SegmentTranslation>,
}

impl SegmentTranslationArena {
    pub(crate) fn len(&self) -> usize {
        self.rows.len()
    }

    pub(crate) fn get(&self, index: usize) -> Option<SegmentTranslation> {
        self.rows.get(index).copied()
    }

    fn row(&self, index: usize) -> SegmentTranslation {
        self.rows[index]
    }

    fn is_valid(&self) -> bool {
        true
    }

    fn reserve(&mut self, additional: usize) -> Result<(), EngineError> {
        self.rows
            .try_reserve(additional)
            .map_err(|_| EngineError::ResultTooLarge)
    }

    fn push(&mut self, row: SegmentTranslation) {
        self.rows.push(row);
    }

    fn truncate(&mut self, len: usize) {
        self.rows.truncate(len);
    }

    fn clear(&mut self) {
        self.rows.clear();
    }
}

#[cfg(any(test, feature = "kernel-lab"))]
define_arena!(
    VisualSpanArena,
    VisualInstanceSpan,
    instance_starts => instance_start: u32,
    glyph_starts => glyph_start: u32,
    glyph_counts => glyph_count: u32,
    glyph_sources => glyph_source: GlyphSource,
    segment_indices => segment_index: u32,
    visual_span_ids => visual_span_id: u32,
    resolved_levels => resolved_level: u8,
    roles => role: SliceRole,
);

#[derive(Default)]
pub(crate) struct PlacementState {
    segments: PlacementSegmentArena,
    #[cfg(any(test, feature = "kernel-lab"))]
    visual_spans: VisualSpanArena,
    translations: SegmentTranslationArena,
    line_segment_starts: Vec<u32>,
    line_segment_counts: Vec<u32>,
    #[cfg(any(test, feature = "kernel-lab"))]
    line_visual_span_starts: Vec<u32>,
    #[cfg(any(test, feature = "kernel-lab"))]
    line_visual_span_counts: Vec<u32>,
    segment_instance_counts: Vec<u32>,
    paragraph_run_lookup: Vec<(RunCanonicalRevision, u32)>,
    replacement_run_lookup: Vec<(RunCanonicalRevision, u32)>,
    last_segment: Option<(u32, PlacementSegment, SegmentTranslation)>,
    #[cfg(any(test, feature = "kernel-lab"))]
    last_visual_span: Option<VisualInstanceSpan>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlacementCheckpoint {
    segments: usize,
    #[cfg(any(test, feature = "kernel-lab"))]
    visual_spans: usize,
    translations: usize,
    lines: usize,
    segment_instance_counts: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct RetainedLinePlacement {
    pub line_index: usize,
    pub old_fragment_start: u32,
    pub new_fragment_start: u32,
    #[cfg(any(test, feature = "kernel-lab"))]
    pub old_instance_start: u32,
    pub instance_count: u32,
    pub new_instance_start: u32,
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
        #[cfg(any(test, feature = "kernel-lab"))]
        self.visual_spans.clear();
        self.translations.clear();
        self.line_segment_starts.clear();
        self.line_segment_counts.clear();
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_starts.clear();
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_counts.clear();
        self.segment_instance_counts.clear();
        self.paragraph_run_lookup.clear();
        self.replacement_run_lookup.clear();
        self.last_segment = None;
        #[cfg(any(test, feature = "kernel-lab"))]
        {
            self.last_visual_span = None;
        }
    }

    pub(crate) fn prepare_run_resolution(
        &mut self,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
    ) -> Result<(), EngineError> {
        prepare_run_lookup(&mut self.paragraph_run_lookup, layout_runs)?;
        prepare_run_lookup(&mut self.replacement_run_lookup, replacement_runs)
    }

    pub(crate) fn begin_line(&self) -> (usize, usize) {
        #[cfg(any(test, feature = "kernel-lab"))]
        let visual_span_start = self.visual_spans.len();
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let visual_span_start = 0;
        (self.segments.len(), visual_span_start)
    }

    #[cfg(test)]
    pub(crate) fn glyph_translation(&self, glyph_index: usize) -> Option<SegmentTranslation> {
        let mut instance_start = 0usize;
        for (segment, &count) in self.segment_instance_counts.iter().enumerate() {
            let instance_end = instance_start.checked_add(usize::try_from(count).ok()?)?;
            if glyph_index < instance_end {
                return self.translations.get(segment);
            }
            instance_start = instance_end;
        }
        None
    }

    pub(crate) fn finish_line(&mut self, start: (usize, usize)) -> Result<(), EngineError> {
        let segments = span_record(start.0, self.segments.len())?;
        #[cfg(any(test, feature = "kernel-lab"))]
        let visual_spans = span_record(start.1, self.visual_spans.len())?;
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let visual_spans = (0, 0);
        self.reserve_line_record()?;
        self.push_line_record(segments, visual_spans);
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
            let stored = &mut self.segments.rows[index];
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
                    ..previous
                },
                previous_placement,
            ));
            return Ok(last_index);
        }
        let index = u32::try_from(self.segments.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.segments.reserve(1)?;
        self.translations.reserve(1)?;
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
            .rows
            .get_mut(index)
            .ok_or(EngineError::InvalidRequest)?;
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
                ..previous
            },
            placement,
        ));
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub(crate) fn push_admitted_slice(
        &mut self,
        fragment_index: u32,
        layout_run_owner: LayoutRunOwner,
        layout_run_index: u32,
        segment_anchor: u32,
        run_cluster_start: u32,
        run_cluster_count: u32,
        glyph_source: GlyphSource,
        source_glyph_start: u32,
        source_glyph_count: u32,
        placement: SegmentTranslation,
    ) -> Result<u32, EngineError> {
        let segment_index =
            u32::try_from(self.segments.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.segments.reserve(1)?;
        self.translations.reserve(1)?;
        self.segment_instance_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.segments.push(PlacementSegment {
            fragment_index,
            layout_run_owner,
            layout_run_index,
            placement_handle: None,
            canonical_revision: None,
            identity: PlacementIdentity::StableSource,
            segment_anchor,
            source_anchor: segment_anchor,
            numeric_block_ordinal: u32::MAX,
            run_cluster_start,
            run_cluster_count,
            glyph_source,
            source_glyph_start,
            source_glyph_count,
        });
        self.translations.push(placement);
        self.segment_instance_counts.push(0);
        Ok(segment_index)
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub(crate) fn push_admitted_occurrence(
        &mut self,
        fragment_index: u32,
        layout_run_index: u32,
        segment_anchor: u32,
        run_cluster_start: u32,
        run_cluster_count: u32,
        source_glyph_start: u32,
        source_glyph_count: u32,
        absolute_glyph_start: u32,
        placement: SegmentTranslation,
    ) -> Result<(), EngineError> {
        let checkpoint = self.checkpoint();
        let result = (|| {
            let segment = self.push_admitted_slice(
                fragment_index,
                LayoutRunOwner::Paragraph,
                layout_run_index,
                segment_anchor,
                run_cluster_start,
                run_cluster_count,
                GlyphSource::LayoutRun,
                source_glyph_start,
                source_glyph_count,
                placement,
            )?;
            if source_glyph_count != 0 {
                self.push_visual_span(segment, absolute_glyph_start, source_glyph_count)?;
            }
            Ok(())
        })();
        if result.is_err() {
            self.restore(checkpoint);
        }
        result
    }

    #[cfg(test)]
    pub(crate) fn push_visual_span(
        &mut self,
        segment_index: u32,
        glyph_start: u32,
        glyph_count: u32,
    ) -> Result<(), EngineError> {
        let instance_start = self.next_instance_start()?;
        self.push_emitted_span(
            segment_index,
            instance_start,
            GlyphSource::LayoutRun,
            glyph_start,
            glyph_count,
            0,
            SliceRole::Ordinary,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn push_emitted_span(
        &mut self,
        segment_index: u32,
        instance_start: u32,
        glyph_source: GlyphSource,
        glyph_start: u32,
        glyph_count: u32,
        resolved_level: u8,
        role: SliceRole,
    ) -> Result<(), EngineError> {
        if glyph_count == 0 {
            return Ok(());
        }
        let segment = usize::try_from(segment_index).map_err(|_| EngineError::InvalidRequest)?;
        let next_instance_count = self
            .segment_instance_counts
            .get(segment)
            .copied()
            .ok_or(EngineError::InvalidRequest)?
            .checked_add(glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        #[cfg(not(any(test, feature = "kernel-lab")))]
        {
            let _ = (
                instance_start,
                glyph_source,
                glyph_start,
                resolved_level,
                role,
            );
            self.segment_instance_counts[segment] = next_instance_count;
            Ok(())
        }
        #[cfg(any(test, feature = "kernel-lab"))]
        {
            if let Some(last) = self.last_visual_span
                && self.visual_spans.len().checked_sub(1) == Some(last.visual_span_id as usize)
                && last.segment_index == segment_index
                && last.glyph_source == glyph_source
                && last.resolved_level == resolved_level
                && last.role == role
                && last.instance_start.checked_add(last.glyph_count) == Some(instance_start)
                && last.glyph_start.checked_add(last.glyph_count) == Some(glyph_start)
            {
                let count = last
                    .glyph_count
                    .checked_add(glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.segment_instance_counts[segment] = next_instance_count;
                let final_index = self.visual_spans.len() - 1;
                self.visual_spans.glyph_counts[final_index] = count;
                self.last_visual_span = Some(VisualInstanceSpan {
                    glyph_count: count,
                    ..last
                });
                return Ok(());
            }
            self.visual_spans.reserve(1)?;
            let span = VisualInstanceSpan {
                instance_start,
                glyph_start,
                glyph_count,
                glyph_source,
                segment_index,
                visual_span_id: u32::try_from(self.visual_spans.len())
                    .map_err(|_| EngineError::ResultTooLarge)?,
                resolved_level,
                role,
            };
            self.segment_instance_counts[segment] = next_instance_count;
            self.visual_spans.push(span);
            self.last_visual_span = Some(span);
            Ok(())
        }
    }

    pub(crate) fn append_retained_line(
        &mut self,
        previous: &Self,
        retained: RetainedLinePlacement,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
    ) -> Result<RetainedSegmentRemap, EngineError> {
        let (segment_start, segment_end) = line_span(
            &previous.line_segment_starts,
            &previous.line_segment_counts,
            retained.line_index,
            previous.segments.len(),
        )?;
        if (segment_start..segment_end).any(|index| {
            previous
                .segments
                .get(index)
                .is_none_or(|segment| !hinted_run_matches(segment, layout_runs, replacement_runs))
        }) {
            self.prepare_run_resolution(layout_runs, replacement_runs)?;
        }
        let checkpoint = self.checkpoint();
        let result =
            self.append_retained_line_inner(previous, retained, layout_runs, replacement_runs);
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
    ) -> Result<RetainedSegmentRemap, EngineError> {
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let _ = retained.new_instance_start;
        if !self.has_aligned_lanes() || !previous.has_aligned_lanes() {
            return Err(EngineError::InvalidRequest);
        }
        let (slice_start, slice_end) = line_span(
            &previous.line_segment_starts,
            &previous.line_segment_counts,
            retained.line_index,
            previous.segments.len(),
        )?;
        #[cfg(any(test, feature = "kernel-lab"))]
        let (visual_start, visual_end) = line_span(
            &previous.line_visual_span_starts,
            &previous.line_visual_span_counts,
            retained.line_index,
            previous.visual_spans.len(),
        )?;
        let line_start = self.begin_line();
        let next_slice_start = self.segments.len();
        let slice_count = slice_end - slice_start;
        #[cfg(any(test, feature = "kernel-lab"))]
        let visual_count = visual_end - visual_start;
        let next_slice_end = checked_grow(next_slice_start, slice_count)?;
        #[cfg(any(test, feature = "kernel-lab"))]
        let next_visual_end = checked_grow(self.visual_spans.len(), visual_count)?;
        let slice_line_span = span_record(line_start.0, next_slice_end)?;
        #[cfg(any(test, feature = "kernel-lab"))]
        let visual_line_span = span_record(line_start.1, next_visual_end)?;
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let visual_line_span = (0, 0);
        let retained_instance_count = previous.segment_instance_counts[slice_start..slice_end]
            .iter()
            .try_fold(0u32, |total, count| total.checked_add(*count))
            .ok_or(EngineError::ResultTooLarge)?;
        if retained_instance_count != retained.instance_count {
            return Err(EngineError::InvalidRequest);
        }
        for index in slice_start..slice_end {
            let slice = previous
                .segments
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            if previous.translations.get(index).is_none() {
                return Err(EngineError::InvalidRequest);
            }
            let fragment_offset = slice
                .fragment_index
                .checked_sub(retained.old_fragment_start)
                .ok_or(EngineError::InvalidRequest)?;
            retained
                .new_fragment_start
                .checked_add(fragment_offset)
                .ok_or(EngineError::ResultTooLarge)?;
            self.resolve_run(slice, layout_runs, replacement_runs)?;
        }
        #[cfg(any(test, feature = "kernel-lab"))]
        for index in visual_start..visual_end {
            let span = previous
                .visual_spans
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            retained
                .new_instance_start
                .checked_add(
                    span.instance_start
                        .checked_sub(retained.old_instance_start)
                        .ok_or(EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            let old_slice = span.segment_index as usize;
            old_slice
                .checked_sub(slice_start)
                .filter(|offset| *offset < slice_count)
                .ok_or(EngineError::InvalidRequest)?;
        }
        self.segments.reserve(slice_count)?;
        self.translations.reserve(slice_count)?;
        self.segment_instance_counts
            .try_reserve(slice_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        #[cfg(any(test, feature = "kernel-lab"))]
        self.visual_spans.reserve(visual_count)?;
        self.reserve_line_record()?;

        for relative in 0..slice_count {
            let mut slice = previous.segments.row(slice_start + relative);
            slice.fragment_index =
                retained.new_fragment_start + (slice.fragment_index - retained.old_fragment_start);
            slice.layout_run_index = self.resolve_run(slice, layout_runs, replacement_runs)?.0;
            slice.placement_handle = None;
            let placement = previous.translations.row(slice_start + relative);
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
        #[cfg(any(test, feature = "kernel-lab"))]
        for relative in 0..visual_count {
            let mut span = previous.visual_spans.row(visual_start + relative);
            span.instance_start =
                retained.new_instance_start + (span.instance_start - retained.old_instance_start);
            let old_slice = span.segment_index as usize;
            let next_slice = next_slice_start + (old_slice - slice_start);
            span.segment_index = next_slice as u32;
            self.visual_spans.push(span);
            self.last_visual_span = Some(span);
        }
        self.push_line_record(slice_line_span, visual_line_span);
        Ok(RetainedSegmentRemap {
            previous_start: u32::try_from(slice_start).map_err(|_| EngineError::ResultTooLarge)?,
            next_start: u32::try_from(next_slice_start).map_err(|_| EngineError::ResultTooLarge)?,
            count: u32::try_from(slice_count).map_err(|_| EngineError::ResultTooLarge)?,
        })
    }

    #[cfg(test)]
    pub(crate) fn segments(&self) -> &PlacementSegmentArena {
        &self.segments
    }

    #[cfg(test)]
    pub(crate) fn visual_spans(&self) -> &VisualSpanArena {
        &self.visual_spans
    }

    pub(crate) fn validate_occurrences(
        &self,
        instance_count: usize,
        layout_runs: &[LayoutRun],
        replacement_runs: &[LayoutRun],
    ) -> Result<(), EngineError> {
        if !self.is_valid() {
            return Err(EngineError::InvalidRequest);
        }
        #[cfg(not(any(test, feature = "kernel-lab")))]
        {
            let _ = (layout_runs, replacement_runs);
            (self.instance_count()? == instance_count)
                .then_some(())
                .ok_or(EngineError::InvalidRequest)
        }
        #[cfg(any(test, feature = "kernel-lab"))]
        {
            let mut instance_cursor = 0_u32;
            let mut counted_segment = 0usize;
            let mut counted_instances = 0u32;
            for index in 0..self.visual_spans.len() {
                let span = self.visual_spans.row(index);
                let segment_index =
                    usize::try_from(span.segment_index).map_err(|_| EngineError::InvalidRequest)?;
                while counted_segment < segment_index {
                    if self.segment_instance_counts.get(counted_segment).copied()
                        != Some(counted_instances)
                    {
                        return Err(EngineError::InvalidRequest);
                    }
                    counted_segment += 1;
                    counted_instances = 0;
                }
                if counted_segment != segment_index {
                    return Err(EngineError::InvalidRequest);
                }
                counted_instances = counted_instances
                    .checked_add(span.glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                let segment = self
                    .segments
                    .get(segment_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let run = self.resolve_run(segment, layout_runs, replacement_runs)?.1;
                let source_start = run
                    .glyph_start
                    .checked_add(segment.source_glyph_start)
                    .ok_or(EngineError::ResultTooLarge)?;
                let source_end = source_start
                    .checked_add(segment.source_glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                let span_end = span
                    .glyph_start
                    .checked_add(span.glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                if span.instance_start != instance_cursor
                    || span.glyph_source != segment.glyph_source
                    || span.glyph_start < source_start
                    || span_end > source_end
                {
                    return Err(EngineError::InvalidRequest);
                }
                instance_cursor = instance_cursor
                    .checked_add(span.glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
            while counted_segment < self.segment_instance_counts.len() {
                if self.segment_instance_counts[counted_segment] != counted_instances {
                    return Err(EngineError::InvalidRequest);
                }
                counted_segment += 1;
                counted_instances = 0;
            }
            if usize::try_from(instance_cursor).map_err(|_| EngineError::ResultTooLarge)?
                != instance_count
                || self.instance_count()? != instance_count
            {
                return Err(EngineError::InvalidRequest);
            }
            Ok(())
        }
    }

    pub(crate) fn segment_rows(&self) -> &[PlacementSegment] {
        &self.segments.rows
    }

    pub(crate) fn translations(&self) -> &[SegmentTranslation] {
        &self.translations.rows
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

    pub(crate) fn bind_placement_handles(
        &mut self,
        handles: &[PlacementHandle],
    ) -> Result<(), EngineError> {
        if handles.len() != self.segments.len() {
            return Err(EngineError::InvalidRequest);
        }
        for (segment, handle) in self.segments.rows.iter_mut().zip(handles) {
            segment.placement_handle = Some(*handle);
        }
        Ok(())
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
        self.translations.get(index)
    }

    fn checkpoint(&self) -> PlacementCheckpoint {
        PlacementCheckpoint {
            segments: self.segments.len(),
            #[cfg(any(test, feature = "kernel-lab"))]
            visual_spans: self.visual_spans.len(),
            translations: self.translations.len(),
            lines: self.line_segment_starts.len(),
            segment_instance_counts: self.segment_instance_counts.len(),
        }
    }

    fn restore(&mut self, checkpoint: PlacementCheckpoint) {
        self.segments.truncate(checkpoint.segments);
        #[cfg(any(test, feature = "kernel-lab"))]
        self.visual_spans.truncate(checkpoint.visual_spans);
        self.translations.truncate(checkpoint.translations);
        self.line_segment_starts.truncate(checkpoint.lines);
        self.line_segment_counts.truncate(checkpoint.lines);
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_starts.truncate(checkpoint.lines);
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_counts.truncate(checkpoint.lines);
        self.segment_instance_counts
            .truncate(checkpoint.segment_instance_counts);
        self.last_segment = self.segments.len().checked_sub(1).map(|index| {
            (
                u32::try_from(index).expect("placement segment index already fit u32"),
                self.segments.row(index),
                self.translations.row(index),
            )
        });
        #[cfg(any(test, feature = "kernel-lab"))]
        {
            self.last_visual_span = self
                .visual_spans
                .len()
                .checked_sub(1)
                .map(|index| self.visual_spans.row(index));
        }
    }

    fn is_valid(&self) -> bool {
        self.has_aligned_lanes()
    }

    fn has_aligned_lanes(&self) -> bool {
        self.segments.is_valid()
            && {
                #[cfg(any(test, feature = "kernel-lab"))]
                {
                    self.visual_spans.is_valid()
                        && self.line_visual_span_starts.len() == self.line_visual_span_counts.len()
                }
                #[cfg(not(any(test, feature = "kernel-lab")))]
                {
                    true
                }
            }
            && self.translations.is_valid()
            && self.segments.len() == self.translations.len()
            && self.segments.len() == self.segment_instance_counts.len()
            && self.line_segment_starts.len() == self.line_segment_counts.len()
    }

    #[cfg(test)]
    fn next_instance_start(&self) -> Result<u32, EngineError> {
        match self
            .visual_spans
            .get(self.visual_spans.len().saturating_sub(1))
        {
            Some(span) => span
                .instance_start
                .checked_add(span.glyph_count)
                .ok_or(EngineError::ResultTooLarge),
            None => Ok(0),
        }
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
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_starts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        #[cfg(any(test, feature = "kernel-lab"))]
        self.line_visual_span_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        Ok(())
    }

    fn push_line_record(&mut self, segments: (u32, u32), visual_spans: (u32, u32)) {
        self.line_segment_starts.push(segments.0);
        self.line_segment_counts.push(segments.1);
        #[cfg(any(test, feature = "kernel-lab"))]
        {
            self.line_visual_span_starts.push(visual_spans.0);
            self.line_visual_span_counts.push(visual_spans.1);
        }
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let _ = visual_spans;
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
    use crate::engine::cluster_state::BoundaryRunRole;

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
        assert_eq!(state.segments().len(), 1);
        assert_eq!(state.segments().get(0).unwrap().run_cluster_count, 2);
        assert_eq!(state.segments().get(0).unwrap().source_glyph_count, 2);
    }

    #[test]
    fn one_segment_can_own_multiple_visual_spans() {
        let mut state = PlacementState::default();
        let line = state.begin_line();
        let segment = state
            .push_admitted_slice(
                3,
                LayoutRunOwner::Paragraph,
                5,
                107,
                7,
                4,
                GlyphSource::LayoutRun,
                11,
                6,
                SegmentTranslation {
                    translation_inline: 23.0,
                    translation_block: 29.0,
                },
            )
            .unwrap();
        state.push_visual_span(segment, 11, 2).unwrap();
        state.push_visual_span(segment, 15, 2).unwrap();
        state.finish_line(line).unwrap();

        assert_eq!(state.segments().len(), 1);
        assert_eq!(state.segments().get(0).unwrap().segment_anchor, 107);
        assert_eq!(state.visual_spans().len(), 2);
        assert_eq!(state.line_segment_counts, [1]);
        assert_eq!(state.line_visual_span_counts, [2]);
        assert_eq!(state.segment_instance_counts, [4]);
        assert_eq!(state.instance_count().unwrap(), 4);
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
        previous
            .push_admitted_occurrence(
                4,
                2,
                73,
                0,
                2,
                0,
                2,
                8,
                SegmentTranslation {
                    translation_inline: 40.0,
                    translation_block: 12.0,
                },
            )
            .unwrap();
        previous.segments.rows[0].canonical_revision = Some(revisions[2]);
        previous.finish_line(line).unwrap();

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
                    old_instance_start: 0,
                    instance_count: 2,
                    new_instance_start: 0,
                },
                &runs,
                &[],
            )
            .unwrap();
        assert_eq!(state.segments().get(0).unwrap().fragment_index, 9);

        let reordered = [runs[2], runs[0], runs[1]];
        let mut rebound = PlacementState::default();
        rebound.prepare_run_resolution(&reordered, &[]).unwrap();
        rebound
            .append_retained_line(
                &previous,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 4,
                    new_fragment_start: 9,
                    old_instance_start: 0,
                    instance_count: 2,
                    new_instance_start: 0,
                },
                &reordered,
                &[],
            )
            .unwrap();
        assert_eq!(rebound.segments().get(0).unwrap().layout_run_index, 0);

        previous.segments.rows[0].canonical_revision =
            Some(RunCanonicalRevision::allocate(&mut next_revision).unwrap());
        let checkpoint = state.checkpoint();
        assert!(matches!(
            state.append_retained_line(
                &previous,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 4,
                    new_fragment_start: 9,
                    old_instance_start: 0,
                    instance_count: 2,
                    new_instance_start: 0,
                },
                &runs,
                &[],
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert_eq!(state.checkpoint(), checkpoint);
    }

    #[test]
    fn replacement_segments_validate_distinct_owners_and_partial_outline_spans() {
        let placement = SegmentTranslation {
            translation_inline: 0.0,
            translation_block: 0.0,
        };
        let replacement_runs = [
            LayoutRun {
                source_kind: LayoutRunSourceKind::Boundary {
                    flow_thread_id: 7,
                    role: BoundaryRunRole::BoundarySource,
                },
                cluster_start: 0,
                cluster_end: 1,
                glyph_start: 4,
                glyph_count: 2,
                source_run: 0,
                font_handle: 1,
                numeric_blocks: Default::default(),
                canonical_revision: None,
            },
            LayoutRun {
                source_kind: LayoutRunSourceKind::Boundary {
                    flow_thread_id: 7,
                    role: BoundaryRunRole::Ellipsis,
                },
                cluster_start: 0,
                cluster_end: 1,
                glyph_start: 8,
                glyph_count: 1,
                source_run: 0,
                font_handle: 1,
                numeric_blocks: Default::default(),
                canonical_revision: None,
            },
        ];
        let mut state = PlacementState::default();
        for (run_index, glyph_count, glyph_start) in [(0, 2, 4), (1, 1, 8)] {
            let segment = state
                .push_admitted_slice(
                    0,
                    LayoutRunOwner::Replacement,
                    run_index,
                    11,
                    0,
                    0,
                    GlyphSource::Boundary,
                    0,
                    glyph_count,
                    placement,
                )
                .unwrap();
            state
                .push_emitted_span(
                    segment,
                    run_index,
                    GlyphSource::Boundary,
                    glyph_start,
                    1,
                    0,
                    SliceRole::BoundaryReplacement,
                )
                .unwrap();
        }
        state
            .validate_occurrences(2, &[], &replacement_runs)
            .unwrap();
        assert_ne!(
            state.segments().get(0).unwrap().layout_run_index,
            state.segments().get(1).unwrap().layout_run_index,
        );

        state.visual_spans.glyph_starts[1] = 7;
        assert!(matches!(
            state.validate_occurrences(2, &[], &replacement_runs),
            Err(EngineError::InvalidRequest)
        ));
    }
}
