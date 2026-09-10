use alloc::vec::Vec;

use super::EngineError;

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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PlacementClass {
    Ordinary,
    Justified,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum SliceRole {
    Ordinary,
    HangingSpace,
    CharacterFallback,
    BoundaryReplacement,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LayoutRunSlice {
    pub fragment_index: u32,
    pub layout_run_index: u32,
    pub run_identity_anchor: u32,
    pub run_cluster_start: u32,
    pub run_cluster_count: u32,
    pub run_glyph_start: u32,
    pub run_glyph_count: u32,
    pub placement_slot: u32,
    pub role: SliceRole,
    pub class: PlacementClass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct VisualInstanceSpan {
    pub instance_start: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
    pub slice_index: u32,
    pub placement_slot: u32,
    pub visual_span_id: u32,
    pub resolved_level: u8,
    pub role: SliceRole,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SlicePlacement {
    pub local_prefix: f64,
    pub translation_inline: f64,
    pub translation_block: f64,
    pub space_ordinal_start: u32,
    pub gap_ordinal_start: u32,
    pub spaces: u32,
    pub gaps: u32,
    pub gap_cluster_count: u32,
    pub per_space_units: i64,
    pub extra_space_units: i64,
    pub per_gap_units: i64,
    pub extra_gap_units: i64,
}

define_arena!(
    LayoutRunSliceArena,
    LayoutRunSlice,
    fragment_indices => fragment_index: u32,
    layout_run_indices => layout_run_index: u32,
    run_identity_anchors => run_identity_anchor: u32,
    run_cluster_starts => run_cluster_start: u32,
    run_cluster_counts => run_cluster_count: u32,
    run_glyph_starts => run_glyph_start: u32,
    run_glyph_counts => run_glyph_count: u32,
    placement_slots => placement_slot: u32,
    roles => role: SliceRole,
    classes => class: PlacementClass,
);

define_arena!(
    VisualSpanArena,
    VisualInstanceSpan,
    instance_starts => instance_start: u32,
    glyph_starts => glyph_start: u32,
    glyph_counts => glyph_count: u32,
    slice_indices => slice_index: u32,
    placement_slots => placement_slot: u32,
    visual_span_ids => visual_span_id: u32,
    resolved_levels => resolved_level: u8,
    roles => role: SliceRole,
);

define_arena!(
    SlicePlacementArena,
    SlicePlacement,
    local_prefixes => local_prefix: f64,
    translation_inlines => translation_inline: f64,
    translation_blocks => translation_block: f64,
    space_ordinal_starts => space_ordinal_start: u32,
    gap_ordinal_starts => gap_ordinal_start: u32,
    space_counts => spaces: u32,
    gap_counts => gaps: u32,
    gap_cluster_counts => gap_cluster_count: u32,
    per_space_units => per_space_units: i64,
    extra_space_units => extra_space_units: i64,
    per_gap_units => per_gap_units: i64,
    extra_gap_units => extra_gap_units: i64,
);

#[derive(Default)]
pub(crate) struct PlacementState {
    slices: LayoutRunSliceArena,
    visual_spans: VisualSpanArena,
    placements: SlicePlacementArena,
    ordinary_slices: Vec<u32>,
    justified_slices: Vec<u32>,
    line_slice_starts: Vec<u32>,
    line_slice_counts: Vec<u32>,
    line_visual_span_starts: Vec<u32>,
    line_visual_span_counts: Vec<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlacementCheckpoint {
    slices: usize,
    visual_spans: usize,
    placements: usize,
    ordinary_slices: usize,
    justified_slices: usize,
    lines: usize,
}

impl PlacementState {
    pub(crate) fn clear(&mut self) {
        self.slices.clear();
        self.visual_spans.clear();
        self.placements.clear();
        self.ordinary_slices.clear();
        self.justified_slices.clear();
        self.line_slice_starts.clear();
        self.line_slice_counts.clear();
        self.line_visual_span_starts.clear();
        self.line_visual_span_counts.clear();
    }

    pub(crate) fn begin_line(&self) -> (usize, usize) {
        (self.slices.len(), self.visual_spans.len())
    }

    pub(crate) fn finish_line(&mut self, start: (usize, usize)) -> Result<(), EngineError> {
        let slices = span_record(start.0, self.slices.len())?;
        let visual_spans = span_record(start.1, self.visual_spans.len())?;
        self.reserve_line_record()?;
        self.push_line_record(slices, visual_spans);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn push_admitted_slice(
        &mut self,
        fragment_index: u32,
        layout_run_index: u32,
        run_identity_anchor: u32,
        run_cluster_start: u32,
        run_cluster_count: u32,
        run_glyph_start: u32,
        run_glyph_count: u32,
        placement: SlicePlacement,
        class: PlacementClass,
    ) -> Result<(u32, u32), EngineError> {
        let slice_index =
            u32::try_from(self.slices.len()).map_err(|_| EngineError::ResultTooLarge)?;
        let placement_slot =
            u32::try_from(self.placements.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.slices.reserve(1)?;
        self.placements.reserve(1)?;
        reserve_queue(
            &mut self.ordinary_slices,
            &mut self.justified_slices,
            1,
            class,
        )?;
        self.slices.push(LayoutRunSlice {
            fragment_index,
            layout_run_index,
            run_identity_anchor,
            run_cluster_start,
            run_cluster_count,
            run_glyph_start,
            run_glyph_count,
            placement_slot,
            role: SliceRole::Ordinary,
            class,
        });
        self.placements.push(placement);
        push_queue(
            &mut self.ordinary_slices,
            &mut self.justified_slices,
            slice_index,
            class,
        );
        Ok((slice_index, placement_slot))
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn push_admitted_occurrence(
        &mut self,
        fragment_index: u32,
        layout_run_index: u32,
        run_identity_anchor: u32,
        run_cluster_start: u32,
        run_cluster_count: u32,
        run_glyph_start: u32,
        run_glyph_count: u32,
        absolute_glyph_start: u32,
        placement: SlicePlacement,
        class: PlacementClass,
    ) -> Result<(), EngineError> {
        let checkpoint = self.checkpoint();
        let result = (|| {
            let (slice, placement) = self.push_admitted_slice(
                fragment_index,
                layout_run_index,
                run_identity_anchor,
                run_cluster_start,
                run_cluster_count,
                run_glyph_start,
                run_glyph_count,
                placement,
                class,
            )?;
            if run_glyph_count != 0 {
                self.push_visual_span(slice, placement, absolute_glyph_start, run_glyph_count)?;
            }
            Ok(())
        })();
        if result.is_err() {
            self.restore(checkpoint);
        }
        result
    }

    pub(crate) fn push_visual_span(
        &mut self,
        slice_index: u32,
        placement_slot: u32,
        glyph_start: u32,
        glyph_count: u32,
    ) -> Result<(), EngineError> {
        let instance_start = self.next_instance_start()?;
        self.visual_spans.reserve(1)?;
        self.visual_spans.push(VisualInstanceSpan {
            instance_start,
            glyph_start,
            glyph_count,
            slice_index,
            placement_slot,
            visual_span_id: slice_index,
            resolved_level: 0,
            role: SliceRole::Ordinary,
        });
        Ok(())
    }

    pub(crate) fn append_retained_line(
        &mut self,
        previous: &Self,
        line_index: usize,
        old_fragment_start: u32,
        new_fragment_start: u32,
    ) -> Result<(), EngineError> {
        let checkpoint = self.checkpoint();
        let result = self.append_retained_line_inner(
            previous,
            line_index,
            old_fragment_start,
            new_fragment_start,
        );
        if result.is_err() {
            self.restore(checkpoint);
        }
        result
    }

    fn append_retained_line_inner(
        &mut self,
        previous: &Self,
        line_index: usize,
        old_fragment_start: u32,
        new_fragment_start: u32,
    ) -> Result<(), EngineError> {
        if !self.is_valid() || !previous.is_valid() {
            return Err(EngineError::InvalidRequest);
        }
        let (slice_start, slice_end) = line_span(
            &previous.line_slice_starts,
            &previous.line_slice_counts,
            line_index,
            previous.slices.len(),
        )?;
        let (visual_start, visual_end) = line_span(
            &previous.line_visual_span_starts,
            &previous.line_visual_span_counts,
            line_index,
            previous.visual_spans.len(),
        )?;
        let line_start = self.begin_line();
        let next_slice_start = self.slices.len();
        let slice_count = slice_end - slice_start;
        let visual_count = visual_end - visual_start;
        let next_slice_end = checked_grow(next_slice_start, slice_count)?;
        let next_visual_end = checked_grow(self.visual_spans.len(), visual_count)?;
        checked_grow(self.placements.len(), slice_count)?;
        let slice_line_span = span_record(line_start.0, next_slice_end)?;
        let visual_line_span = span_record(line_start.1, next_visual_end)?;
        let next_instance_start = self.next_instance_start()?;
        let old_instance_start = previous
            .visual_spans
            .get(visual_start)
            .map_or(0, |span| span.instance_start);
        let mut ordinary_count = 0usize;
        let mut justified_count = 0usize;

        for index in slice_start..slice_end {
            let slice = previous
                .slices
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            if previous
                .placements
                .get(slice.placement_slot as usize)
                .is_none()
            {
                return Err(EngineError::InvalidRequest);
            }
            let fragment_offset = slice
                .fragment_index
                .checked_sub(old_fragment_start)
                .ok_or(EngineError::InvalidRequest)?;
            new_fragment_start
                .checked_add(fragment_offset)
                .ok_or(EngineError::ResultTooLarge)?;
            match slice.class {
                PlacementClass::Ordinary => ordinary_count += 1,
                PlacementClass::Justified => justified_count += 1,
            }
        }
        for index in visual_start..visual_end {
            let span = previous
                .visual_spans
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            next_instance_start
                .checked_add(
                    span.instance_start
                        .checked_sub(old_instance_start)
                        .ok_or(EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            let old_slice = span.slice_index as usize;
            let relative_slice = old_slice
                .checked_sub(slice_start)
                .filter(|offset| *offset < slice_count)
                .ok_or(EngineError::InvalidRequest)?;
            let slice = previous.slices.row(slice_start + relative_slice);
            if span.placement_slot != slice.placement_slot {
                return Err(EngineError::InvalidRequest);
            }
        }

        self.slices.reserve(slice_count)?;
        self.placements.reserve(slice_count)?;
        self.visual_spans.reserve(visual_count)?;
        self.ordinary_slices
            .try_reserve(ordinary_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.justified_slices
            .try_reserve(justified_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.reserve_line_record()?;

        for relative in 0..slice_count {
            let mut slice = previous.slices.row(slice_start + relative);
            let placement = previous.placements.row(slice.placement_slot as usize);
            let next_slice = (next_slice_start + relative) as u32;
            slice.fragment_index = new_fragment_start + (slice.fragment_index - old_fragment_start);
            slice.placement_slot = self.placements.len() as u32;
            self.slices.push(slice);
            self.placements.push(placement);
            push_queue(
                &mut self.ordinary_slices,
                &mut self.justified_slices,
                next_slice,
                slice.class,
            );
        }
        for relative in 0..visual_count {
            let mut span = previous.visual_spans.row(visual_start + relative);
            span.instance_start = next_instance_start + (span.instance_start - old_instance_start);
            let old_slice = span.slice_index as usize;
            let next_slice = next_slice_start + (old_slice - slice_start);
            span.slice_index = next_slice as u32;
            span.placement_slot = self.slices.row(next_slice).placement_slot;
            self.visual_spans.push(span);
        }
        self.push_line_record(slice_line_span, visual_line_span);
        Ok(())
    }

    pub(crate) fn slices(&self) -> &LayoutRunSliceArena {
        &self.slices
    }

    pub(crate) fn visual_spans(&self) -> &VisualSpanArena {
        &self.visual_spans
    }

    pub(crate) fn placements(&self) -> &SlicePlacementArena {
        &self.placements
    }

    pub(crate) fn queues(&self) -> (&[u32], &[u32]) {
        (&self.ordinary_slices, &self.justified_slices)
    }

    fn checkpoint(&self) -> PlacementCheckpoint {
        PlacementCheckpoint {
            slices: self.slices.len(),
            visual_spans: self.visual_spans.len(),
            placements: self.placements.len(),
            ordinary_slices: self.ordinary_slices.len(),
            justified_slices: self.justified_slices.len(),
            lines: self.line_slice_starts.len(),
        }
    }

    fn restore(&mut self, checkpoint: PlacementCheckpoint) {
        self.slices.truncate(checkpoint.slices);
        self.visual_spans.truncate(checkpoint.visual_spans);
        self.placements.truncate(checkpoint.placements);
        self.ordinary_slices.truncate(checkpoint.ordinary_slices);
        self.justified_slices.truncate(checkpoint.justified_slices);
        self.line_slice_starts.truncate(checkpoint.lines);
        self.line_slice_counts.truncate(checkpoint.lines);
        self.line_visual_span_starts.truncate(checkpoint.lines);
        self.line_visual_span_counts.truncate(checkpoint.lines);
    }

    fn is_valid(&self) -> bool {
        self.slices.is_valid()
            && self.visual_spans.is_valid()
            && self.placements.is_valid()
            && self.slices.len() == self.placements.len()
            && self.line_slice_starts.len() == self.line_slice_counts.len()
            && self.line_visual_span_starts.len() == self.line_visual_span_counts.len()
    }

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

    fn reserve_line_record(&mut self) -> Result<(), EngineError> {
        self.line_slice_starts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.line_slice_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.line_visual_span_starts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.line_visual_span_counts
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)
    }

    fn push_line_record(&mut self, slices: (u32, u32), visual_spans: (u32, u32)) {
        self.line_slice_starts.push(slices.0);
        self.line_slice_counts.push(slices.1);
        self.line_visual_span_starts.push(visual_spans.0);
        self.line_visual_span_counts.push(visual_spans.1);
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

fn reserve_queue(
    ordinary: &mut Vec<u32>,
    justified: &mut Vec<u32>,
    additional: usize,
    class: PlacementClass,
) -> Result<(), EngineError> {
    let queue = match class {
        PlacementClass::Ordinary => ordinary,
        PlacementClass::Justified => justified,
    };
    queue
        .try_reserve(additional)
        .map_err(|_| EngineError::ResultTooLarge)
}

fn push_queue(
    ordinary: &mut Vec<u32>,
    justified: &mut Vec<u32>,
    slice: u32,
    class: PlacementClass,
) {
    match class {
        PlacementClass::Ordinary => ordinary.push(slice),
        PlacementClass::Justified => justified.push(slice),
    }
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

    #[test]
    fn one_slice_can_own_multiple_visual_spans_and_one_class_queue() {
        let mut state = PlacementState::default();
        let line = state.begin_line();
        let (slice, placement) = state
            .push_admitted_slice(
                3,
                5,
                101,
                7,
                4,
                11,
                6,
                SlicePlacement {
                    local_prefix: 19.0,
                    translation_inline: 23.0,
                    translation_block: 29.0,
                    space_ordinal_start: 0,
                    gap_ordinal_start: 0,
                    spaces: 3,
                    gaps: 2,
                    gap_cluster_count: 4,
                    per_space_units: 17,
                    extra_space_units: 1,
                    per_gap_units: 5,
                    extra_gap_units: 1,
                },
                PlacementClass::Justified,
            )
            .unwrap();
        state.push_visual_span(slice, placement, 11, 2).unwrap();
        state.push_visual_span(slice, placement, 15, 2).unwrap();
        state.finish_line(line).unwrap();

        assert_eq!(state.slices().len(), 1);
        assert_eq!(state.visual_spans().len(), 2);
        assert_eq!(state.queues(), (&[][..], &[0][..]));
        assert_eq!(state.line_slice_counts, [1]);
        assert_eq!(state.line_visual_span_counts, [2]);
    }

    #[test]
    fn retained_line_remaps_fragments_and_invalid_source_rolls_back() {
        let mut previous = PlacementState::default();
        let line = previous.begin_line();
        previous
            .push_admitted_occurrence(
                4,
                2,
                71,
                0,
                2,
                0,
                2,
                8,
                SlicePlacement {
                    local_prefix: 0.0,
                    translation_inline: 40.0,
                    translation_block: 12.0,
                    space_ordinal_start: 0,
                    gap_ordinal_start: 0,
                    spaces: 0,
                    gaps: 0,
                    gap_cluster_count: 0,
                    per_space_units: 0,
                    extra_space_units: 0,
                    per_gap_units: 0,
                    extra_gap_units: 0,
                },
                PlacementClass::Ordinary,
            )
            .unwrap();
        previous.finish_line(line).unwrap();

        let mut state = PlacementState::default();
        state.append_retained_line(&previous, 0, 4, 9).unwrap();
        assert_eq!(state.slices().get(0).unwrap().fragment_index, 9);

        previous.slices.placement_slots[0] = 99;
        let checkpoint = state.checkpoint();
        assert!(matches!(
            state.append_retained_line(&previous, 0, 4, 9),
            Err(EngineError::InvalidRequest)
        ));
        assert_eq!(state.checkpoint(), checkpoint);
    }
}
