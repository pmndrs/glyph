//! Test and kernel-lab proof for mapping retained layout-run slices into visual instances.

use alloc::vec::Vec;

pub(crate) use super::placement_state::SliceRole;

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, CLUSTER_SAFE_BEFORE, LayoutRun},
    flow_composition::{FlowFragment, NO_BOUNDARY},
    placement_state::{LayoutRunOwner, LayoutRunSlice, VisualInstanceSpan},
};

#[cfg(test)]
use super::cluster_state::LayoutRunSourceKind;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct VisualClusterOccurrence {
    pub slice_index: u32,
    pub cluster_index: u32,
    pub visual_span_id: u32,
    pub resolved_level: u8,
    pub role: SliceRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct VisualMappingCounts {
    pub layout_run_count: usize,
    pub slice_count: usize,
    pub visual_cluster_count: usize,
    pub glyphless_cluster_count: usize,
    pub copy_span_count: usize,
    pub visual_instance_count: usize,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct VisualInstanceMap {
    pub layout_run_count: usize,
    pub visual_cluster_count: usize,
    pub glyphless_cluster_count: usize,
    pub slices: Vec<LayoutRunSlice>,
    pub spans: Vec<VisualInstanceSpan>,
    pub glyph_indices: Vec<u32>,
    pub occurrence_slots: Vec<u32>,
}

impl VisualInstanceMap {
    pub(crate) fn counts(&self) -> VisualMappingCounts {
        VisualMappingCounts {
            layout_run_count: self.layout_run_count,
            slice_count: self.slices.len(),
            visual_cluster_count: self.visual_cluster_count,
            glyphless_cluster_count: self.glyphless_cluster_count,
            copy_span_count: self.spans.len(),
            visual_instance_count: self.glyph_indices.len(),
        }
    }
}

/// Source-monotone fragments let one run cursor build slices in O(runs + slices).
/// The resolved cluster stream preserves L1/L2 order and internal glyph order in O(clusters + glyphs).
pub(crate) fn build_visual_instance_map(
    layout_runs: &[LayoutRun],
    cluster_glyph_starts: &[u32],
    cluster_glyph_counts: &[u32],
    cluster_flags: &[u8],
    cluster_stable_ids: &[u32],
    fragments: &[FlowFragment],
    visual_clusters: &[VisualClusterOccurrence],
) -> Result<VisualInstanceMap, EngineError> {
    if cluster_glyph_starts.len() != cluster_glyph_counts.len()
        || cluster_glyph_starts.len() != cluster_flags.len()
        || cluster_glyph_starts.len() != cluster_stable_ids.len()
    {
        return Err(EngineError::InvalidRequest);
    }
    let cluster_count =
        u32::try_from(cluster_glyph_starts.len()).map_err(|_| EngineError::ResultTooLarge)?;
    let mut glyph_count = 0_u32;
    for (&glyph_start, &glyph_span) in cluster_glyph_starts.iter().zip(cluster_glyph_counts) {
        if glyph_start != glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        glyph_count = glyph_count
            .checked_add(glyph_span)
            .ok_or(EngineError::ResultTooLarge)?;
    }
    validate_layout_runs(
        layout_runs,
        cluster_count,
        usize::try_from(glyph_count).map_err(|_| EngineError::ResultTooLarge)?,
    )?;

    let mut slices = Vec::new();
    reserve(
        &mut slices,
        layout_runs.len().saturating_add(fragments.len()),
    )?;
    let mut run_index = 0usize;
    let mut previous_fragment_end = 0_u32;
    for (fragment_index, fragment) in fragments.iter().enumerate() {
        let cluster_start = fragment.line.cluster_start;
        let cluster_end = fragment.line.cluster_end;
        if cluster_start > cluster_end
            || cluster_end > cluster_count
            || cluster_start < previous_fragment_end
            || fragment.boundary_index != NO_BOUNDARY
            || (cluster_start > 0
                && cluster_start < cluster_count
                && cluster_flags
                    [usize::try_from(cluster_start).map_err(|_| EngineError::InvalidRequest)?]
                    & CLUSTER_SAFE_BEFORE
                    == 0)
            || (cluster_end < cluster_count
                && cluster_flags
                    [usize::try_from(cluster_end).map_err(|_| EngineError::InvalidRequest)?]
                    & CLUSTER_SAFE_BEFORE
                    == 0)
        {
            return Err(EngineError::InvalidRequest);
        }
        previous_fragment_end = cluster_end;
        while layout_runs
            .get(run_index)
            .is_some_and(|run| run.cluster_end <= cluster_start)
        {
            run_index += 1;
        }
        let mut covered = cluster_start;
        while covered < cluster_end {
            let run = layout_runs
                .get(run_index)
                .ok_or(EngineError::InvalidRequest)?;
            if run.cluster_start > covered || run.cluster_end <= covered {
                return Err(EngineError::InvalidRequest);
            }
            let slice_end = run.cluster_end.min(cluster_end);
            let glyph_start = *cluster_glyph_starts
                .get(usize::try_from(covered).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            let final_cluster =
                usize::try_from(slice_end - 1).map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = cluster_glyph_starts[final_cluster]
                .checked_add(cluster_glyph_counts[final_cluster])
                .ok_or(EngineError::ResultTooLarge)?;
            let run_glyph_end = run
                .glyph_start
                .checked_add(run.glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            if glyph_start < run.glyph_start || glyph_end < glyph_start || glyph_end > run_glyph_end
            {
                return Err(EngineError::InvalidRequest);
            }
            slices.push(LayoutRunSlice {
                fragment_index: u32::try_from(fragment_index)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                layout_run_owner: LayoutRunOwner::Paragraph,
                layout_run_index: u32::try_from(run_index)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                run_handle: None,
                placement_handle: None,
                canonical_revision: None,
                identity: super::placement_state::PlacementIdentity::StableSource {
                    segment_anchor: cluster_stable_ids
                        [usize::try_from(covered).map_err(|_| EngineError::InvalidRequest)?],
                    source_anchor: cluster_stable_ids
                        [usize::try_from(covered).map_err(|_| EngineError::InvalidRequest)?],
                },
                segment_anchor: cluster_stable_ids
                    [usize::try_from(covered).map_err(|_| EngineError::InvalidRequest)?],
                source_anchor: cluster_stable_ids
                    [usize::try_from(covered).map_err(|_| EngineError::InvalidRequest)?],
                numeric_block_ordinal: u32::MAX,
                run_cluster_start: covered - run.cluster_start,
                run_cluster_count: slice_end - covered,
                glyph_source: super::placement_state::GlyphSource::LayoutRun,
                source_glyph_start: glyph_start - run.glyph_start,
                source_glyph_count: glyph_end - glyph_start,
            });
            covered = slice_end;
            if covered == run.cluster_end {
                run_index += 1;
            }
        }
    }
    let mut paint_cluster_count = 0usize;
    for slice in &slices {
        let run = layout_runs
            .get(usize::try_from(slice.layout_run_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let start = usize::try_from(
            run.cluster_start
                .checked_add(slice.run_cluster_start)
                .ok_or(EngineError::ResultTooLarge)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(
                usize::try_from(slice.run_cluster_count)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::ResultTooLarge)?;
        for &flags in &cluster_flags[start..end] {
            paint_cluster_count = paint_cluster_count
                .checked_add(usize::from(flags & CLUSTER_HARD_BREAK == 0))
                .ok_or(EngineError::ResultTooLarge)?;
        }
    }
    if visual_clusters.len() != paint_cluster_count {
        return Err(EngineError::InvalidRequest);
    }

    let mut seen_clusters = Vec::new();
    reserve(&mut seen_clusters, cluster_glyph_starts.len())?;
    seen_clusters.resize(cluster_glyph_starts.len(), false);
    let visual_instance_count = slices.iter().try_fold(0usize, |total, slice| {
        total
            .checked_add(
                usize::try_from(slice.source_glyph_count)
                    .map_err(|_| EngineError::ResultTooLarge)?,
            )
            .ok_or(EngineError::ResultTooLarge)
    })?;
    let mut map = VisualInstanceMap {
        layout_run_count: layout_runs.len(),
        visual_cluster_count: visual_clusters.len(),
        glyphless_cluster_count: 0,
        slices,
        spans: Vec::new(),
        glyph_indices: Vec::new(),
        occurrence_slots: Vec::new(),
    };
    reserve(&mut map.spans, map.slices.len())?;
    reserve(&mut map.glyph_indices, visual_instance_count)?;
    reserve(&mut map.occurrence_slots, visual_instance_count)?;
    for occurrence in visual_clusters {
        let slice_index =
            usize::try_from(occurrence.slice_index).map_err(|_| EngineError::InvalidRequest)?;
        let slice = *map
            .slices
            .get(slice_index)
            .ok_or(EngineError::InvalidRequest)?;
        let run = layout_runs
            .get(usize::try_from(slice.layout_run_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let slice_cluster_start = run
            .cluster_start
            .checked_add(slice.run_cluster_start)
            .ok_or(EngineError::ResultTooLarge)?;
        let slice_cluster_end = slice_cluster_start
            .checked_add(slice.run_cluster_count)
            .ok_or(EngineError::ResultTooLarge)?;
        if occurrence.cluster_index < slice_cluster_start
            || occurrence.cluster_index >= slice_cluster_end
        {
            return Err(EngineError::InvalidRequest);
        }
        let cluster_index =
            usize::try_from(occurrence.cluster_index).map_err(|_| EngineError::InvalidRequest)?;
        if cluster_flags[cluster_index] & CLUSTER_HARD_BREAK != 0
            || core::mem::replace(&mut seen_clusters[cluster_index], true)
        {
            return Err(EngineError::InvalidRequest);
        }
        let glyph_start = cluster_glyph_starts[cluster_index];
        let glyph_count = cluster_glyph_counts[cluster_index];
        if glyph_count == 0 {
            map.glyphless_cluster_count += 1;
            continue;
        }
        append_visual_cluster(
            &mut map,
            *occurrence,
            occurrence.slice_index,
            glyph_start,
            glyph_count,
        )?;
    }
    Ok(map)
}

fn append_visual_cluster(
    map: &mut VisualInstanceMap,
    occurrence: VisualClusterOccurrence,
    segment_index: u32,
    glyph_start: u32,
    glyph_count: u32,
) -> Result<(), EngineError> {
    if let Some(span) = map.spans.last_mut()
        && span.segment_index == segment_index
        && span.visual_span_id == occurrence.visual_span_id
        && span.resolved_level == occurrence.resolved_level
        && span.role == occurrence.role
        && span.glyph_start.checked_add(span.glyph_count) == Some(glyph_start)
    {
        span.glyph_count = span
            .glyph_count
            .checked_add(glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
    } else {
        if map.spans.len() == map.spans.capacity() {
            map.spans
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
        }
        let instance_start =
            u32::try_from(map.glyph_indices.len()).map_err(|_| EngineError::ResultTooLarge)?;
        map.spans.push(VisualInstanceSpan {
            instance_start,
            glyph_start,
            glyph_count,
            glyph_source: super::placement_state::GlyphSource::LayoutRun,
            segment_index: occurrence.slice_index,
            visual_span_id: occurrence.visual_span_id,
            resolved_level: occurrence.resolved_level,
            role: occurrence.role,
        });
    }
    let glyph_end = glyph_start
        .checked_add(glyph_count)
        .ok_or(EngineError::ResultTooLarge)?;
    map.glyph_indices.extend(glyph_start..glyph_end);
    let glyph_count = usize::try_from(glyph_count).map_err(|_| EngineError::ResultTooLarge)?;
    map.occurrence_slots
        .extend(core::iter::repeat_n(segment_index, glyph_count));
    Ok(())
}

fn validate_layout_runs(
    layout_runs: &[LayoutRun],
    cluster_count: u32,
    glyph_count: usize,
) -> Result<(), EngineError> {
    let mut previous_cluster_end = 0_u32;
    let mut previous_glyph_end = 0_u32;
    for run in layout_runs {
        let glyph_end = run
            .glyph_start
            .checked_add(run.glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        if run.cluster_start != previous_cluster_end
            || run.cluster_start >= run.cluster_end
            || run.cluster_end > cluster_count
            || run.glyph_start != previous_glyph_end
        {
            return Err(EngineError::InvalidRequest);
        }
        previous_cluster_end = run.cluster_end;
        previous_glyph_end = glyph_end;
    }
    if previous_cluster_end != cluster_count
        || usize::try_from(previous_glyph_end).map_err(|_| EngineError::ResultTooLarge)?
            != glyph_count
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), EngineError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{flow_composition::NO_BOUNDARY, line_composition::ComposedLine};
    use alloc::vec;

    fn fragment(cluster_start: u32, cluster_end: u32) -> FlowFragment {
        FlowFragment {
            line: ComposedLine {
                cluster_start,
                cluster_end,
                text_start: cluster_start,
                text_end: cluster_end,
                advance: 0.0,
                hung_advance: 0.0,
                hard_break: false,
            },
            slot_start: 0.0,
            slot_end: 100.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
        }
    }

    fn run(
        cluster_start: u32,
        cluster_end: u32,
        glyph_start: u32,
        glyph_count: u32,
        source_run: u32,
    ) -> LayoutRun {
        LayoutRun {
            source_kind: LayoutRunSourceKind::Paragraph,
            cluster_start,
            cluster_end,
            glyph_start,
            glyph_count,
            source_run,
            font_handle: 17,
            numeric_blocks: Default::default(),
            canonical_revision: None,
            run_handle: None,
        }
    }

    fn visual(
        slice_index: u32,
        cluster_index: u32,
        visual_span_id: u32,
        resolved_level: u8,
        role: SliceRole,
    ) -> VisualClusterOccurrence {
        VisualClusterOccurrence {
            slice_index,
            cluster_index,
            visual_span_id,
            resolved_level,
            role,
        }
    }

    fn ordinary(slice_index: u32, cluster_index: u32) -> VisualClusterOccurrence {
        visual(
            slice_index,
            cluster_index,
            slice_index,
            0,
            SliceRole::Ordinary,
        )
    }

    fn safe_flags<const COUNT: usize>() -> [u8; COUNT] {
        [CLUSTER_SAFE_BEFORE; COUNT]
    }

    fn stable_ids<const COUNT: usize>() -> [u32; COUNT] {
        core::array::from_fn(|index| u32::try_from(index + 1).unwrap())
    }

    #[test]
    fn maps_multiglyph_combining_and_glyphless_ligature_continuations_exactly() {
        let runs = [run(0, 4, 0, 4, 0), run(4, 7, 4, 4, 1), run(7, 9, 8, 2, 2)];
        let glyph_starts = [0, 2, 2, 3, 4, 5, 5, 8, 9];
        let glyph_counts = [2, 0, 1, 1, 1, 0, 3, 1, 1];
        let fragments = [fragment(0, 3), fragment(3, 6), fragment(6, 9)];
        let visual_clusters = [
            ordinary(0, 0),
            ordinary(0, 1),
            ordinary(0, 2),
            ordinary(1, 3),
            ordinary(2, 4),
            ordinary(2, 5),
            ordinary(3, 6),
            ordinary(4, 7),
            ordinary(4, 8),
        ];

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &safe_flags::<9>(),
            &stable_ids::<9>(),
            &fragments,
            &visual_clusters,
        )
        .unwrap();

        assert_eq!(
            map.slices
                .iter()
                .map(|slice| (
                    slice.fragment_index,
                    slice.layout_run_index,
                    slice.run_cluster_start,
                    slice.run_cluster_count,
                    slice.source_glyph_start,
                    slice.source_glyph_count,
                ))
                .collect::<Vec<_>>(),
            [
                (0, 0, 0, 3, 0, 3),
                (1, 0, 3, 1, 3, 1),
                (1, 1, 0, 2, 0, 1),
                (2, 1, 2, 1, 1, 3),
                (2, 2, 0, 2, 0, 2),
            ]
        );
        assert_eq!(map.glyph_indices, (0..10).collect::<Vec<_>>());
        assert_eq!(map.occurrence_slots, [0, 0, 0, 1, 2, 3, 3, 3, 4, 4]);
        assert_eq!(map.slices[0].segment_anchor, 1);
        assert_eq!(map.slices[1].segment_anchor, 4);
    }

    #[test]
    fn glyphless_slice_retains_cluster_ownership_without_an_instance_span() {
        let runs = [run(0, 3, 0, 3, 0)];
        let glyph_starts = [0, 1, 1];
        let glyph_counts = [1, 0, 2];
        let fragments = [fragment(0, 1), fragment(1, 2), fragment(2, 3)];

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &safe_flags::<3>(),
            &stable_ids::<3>(),
            &fragments,
            &[ordinary(2, 2), ordinary(1, 1), ordinary(0, 0)],
        )
        .unwrap();

        assert_eq!(map.slices[1].run_cluster_start, 1);
        assert_eq!(map.slices[1].run_cluster_count, 1);
        assert_eq!(map.slices[1].source_glyph_start, 1);
        assert_eq!(map.slices[1].source_glyph_count, 0);
        assert_eq!(map.spans.len(), 2);
        assert_eq!(map.glyph_indices, [1, 2, 0]);
        assert_eq!(map.occurrence_slots, [2, 2, 0]);
    }

    #[test]
    fn rtl_visual_slice_permutation_preserves_exact_glyph_order() {
        let runs = [run(0, 4, 0, 4, 0), run(4, 7, 4, 4, 1), run(7, 9, 8, 2, 2)];
        let glyph_starts = [0, 2, 2, 3, 4, 5, 5, 8, 9];
        let glyph_counts = [2, 0, 1, 1, 1, 0, 3, 1, 1];
        let fragments = [fragment(0, 3), fragment(3, 6), fragment(6, 9)];
        let visual_clusters = [
            visual(4, 8, 4, 1, SliceRole::Ordinary),
            visual(4, 7, 4, 1, SliceRole::Ordinary),
            visual(3, 6, 3, 1, SliceRole::Ordinary),
            visual(2, 5, 2, 1, SliceRole::Ordinary),
            visual(2, 4, 2, 1, SliceRole::Ordinary),
            visual(1, 3, 1, 1, SliceRole::Ordinary),
            visual(0, 2, 0, 1, SliceRole::Ordinary),
            visual(0, 1, 0, 1, SliceRole::Ordinary),
            visual(0, 0, 0, 1, SliceRole::Ordinary),
        ];

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &safe_flags::<9>(),
            &stable_ids::<9>(),
            &fragments,
            &visual_clusters,
        )
        .unwrap();
        let counts = map.counts();

        assert_eq!(map.glyph_indices, [9, 8, 5, 6, 7, 4, 3, 2, 0, 1]);
        assert_eq!(map.occurrence_slots, [4, 4, 3, 3, 3, 2, 1, 0, 0, 0]);
        assert_eq!(counts.visual_cluster_count, 9);
        assert_eq!(counts.glyphless_cluster_count, 2);
        assert_eq!(counts.copy_span_count, 7);
    }

    #[test]
    fn rtl_slice_reverses_clusters_but_preserves_multiglyph_cluster_order() {
        let runs = [run(0, 3, 0, 4, 0)];
        let glyph_starts = [0, 1, 3];
        let glyph_counts = [1, 2, 1];

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &safe_flags::<3>(),
            &stable_ids::<3>(),
            &[fragment(0, 3)],
            &[
                visual(0, 2, 0, 1, SliceRole::Ordinary),
                visual(0, 1, 0, 1, SliceRole::Ordinary),
                visual(0, 0, 0, 1, SliceRole::Ordinary),
            ],
        )
        .unwrap();

        assert_eq!(map.glyph_indices, [3, 1, 2, 0]);
        assert_eq!(
            map.spans
                .iter()
                .map(|span| span.glyph_count)
                .collect::<Vec<_>>(),
            [1, 2, 1]
        );
        assert!(map.spans.iter().all(|span| span.segment_index == 0));
    }

    #[test]
    fn mixed_l1_l2_stream_keeps_trailing_space_in_a_distinct_hanging_span() {
        let runs = [run(0, 6, 0, 5, 0)];
        let glyph_starts = [0, 1, 2, 3, 4, 5];
        let glyph_counts = [1, 1, 1, 1, 1, 0];
        let visual_clusters = [
            visual(0, 0, 0, 0, SliceRole::Ordinary),
            visual(0, 3, 1, 1, SliceRole::Ordinary),
            visual(0, 2, 1, 1, SliceRole::Ordinary),
            visual(0, 1, 1, 1, SliceRole::Ordinary),
            visual(0, 4, 2, 0, SliceRole::HangingSpace),
            visual(0, 5, 2, 0, SliceRole::HangingSpace),
        ];

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &safe_flags::<6>(),
            &stable_ids::<6>(),
            &[fragment(0, 6)],
            &visual_clusters,
        )
        .unwrap();

        assert_eq!(map.glyph_indices, [0, 3, 2, 1, 4]);
        assert_eq!(map.glyphless_cluster_count, 1);
        assert_eq!(map.spans.last().unwrap().visual_span_id, 2);
        assert_eq!(map.spans.last().unwrap().resolved_level, 0);
        assert_eq!(map.spans.last().unwrap().role, SliceRole::HangingSpace);
        assert_eq!(map.slices.len(), 1);
        assert_eq!(map.layout_run_count, 1);
    }

    #[test]
    fn hard_break_stays_slice_owned_but_is_not_a_visual_occurrence() {
        let runs = [
            run(0, 2, 0, 2, 0),
            run(2, 3, 2, 0, u32::MAX),
            run(3, 5, 2, 2, 1),
        ];
        let glyph_starts = [0, 1, 2, 2, 3];
        let glyph_counts = [1, 1, 0, 1, 1];
        let mut cluster_flags = safe_flags::<5>();
        cluster_flags[2] |= CLUSTER_HARD_BREAK;

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &cluster_flags,
            &stable_ids::<5>(),
            &[fragment(0, 5)],
            &[
                ordinary(0, 0),
                ordinary(0, 1),
                ordinary(2, 3),
                ordinary(2, 4),
            ],
        )
        .unwrap();

        assert_eq!(
            (
                map.slices[1].run_cluster_start,
                map.slices[1].run_cluster_count
            ),
            (0, 1)
        );
        assert_eq!(map.slices[1].source_glyph_count, 0);
        assert_eq!(map.counts().visual_cluster_count, 4);
        assert_eq!(map.glyph_indices, [0, 1, 2, 3]);
        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &cluster_flags,
                &stable_ids::<5>(),
                &[fragment(0, 5)],
                &[
                    ordinary(0, 0),
                    ordinary(0, 1),
                    ordinary(1, 2),
                    ordinary(2, 4)
                ],
            ),
            Err(EngineError::InvalidRequest)
        ));
    }

    #[test]
    fn rejects_unsafe_fragment_cuts_and_boundary_replacements() {
        let runs = [run(0, 4, 0, 4, 0)];
        let glyph_starts = [0, 1, 2, 3];
        let glyph_counts = [1, 1, 1, 1];
        let mut unsafe_flags = safe_flags::<4>();
        unsafe_flags[2] = 0;
        let visual_clusters = [
            ordinary(0, 0),
            ordinary(0, 1),
            ordinary(1, 2),
            ordinary(1, 3),
        ];

        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &unsafe_flags,
                &stable_ids::<4>(),
                &[fragment(0, 2), fragment(2, 4)],
                &visual_clusters,
            ),
            Err(EngineError::InvalidRequest)
        ));

        let mut boundary = fragment(0, 4);
        boundary.boundary_index = 7;
        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &safe_flags::<4>(),
                &stable_ids::<4>(),
                &[boundary],
                &[
                    ordinary(0, 0),
                    ordinary(0, 1),
                    ordinary(0, 2),
                    ordinary(0, 3)
                ],
            ),
            Err(EngineError::InvalidRequest)
        ));
    }

    #[test]
    fn dense_cjk_partial_slices_keep_one_run_and_coalesce_per_slice() {
        const CLUSTERS: usize = 4_096;
        const FIRST: u32 = 17;
        const END: u32 = 4_091;
        const CLUSTERS_PER_LINE: u32 = 37;
        let cluster_count = u32::try_from(CLUSTERS).unwrap();
        let runs = [run(0, cluster_count, 0, cluster_count, 0)];
        let glyph_starts = (0..cluster_count).collect::<Vec<_>>();
        let glyph_counts = vec![1; CLUSTERS];
        let cluster_flags = vec![CLUSTER_SAFE_BEFORE; CLUSTERS];
        let mut fragments = Vec::new();
        let mut start = FIRST;
        while start < END {
            let end = (start + CLUSTERS_PER_LINE).min(END);
            fragments.push(fragment(start, end));
            start = end;
        }
        let mut visual_clusters = Vec::new();
        for (slice_index, fragment) in fragments.iter().enumerate() {
            visual_clusters.extend(
                (fragment.line.cluster_start..fragment.line.cluster_end).map(|cluster_index| {
                    ordinary(u32::try_from(slice_index).unwrap(), cluster_index)
                }),
            );
        }

        let map = build_visual_instance_map(
            &runs,
            &glyph_starts,
            &glyph_counts,
            &cluster_flags,
            &(1..=u32::try_from(CLUSTERS).unwrap()).collect::<Vec<_>>(),
            &fragments,
            &visual_clusters,
        )
        .unwrap();
        let counts = map.counts();

        assert_eq!(counts.layout_run_count, 1);
        assert_eq!(counts.slice_count, fragments.len());
        assert_eq!(counts.copy_span_count, fragments.len());
        assert_eq!(
            counts.visual_instance_count,
            usize::try_from(END - FIRST).unwrap()
        );
        assert_eq!(map.glyph_indices.first(), Some(&FIRST));
        assert_eq!(map.glyph_indices.last(), Some(&(END - 1)));
    }

    #[test]
    fn rejects_overlapping_fragments_and_incomplete_visual_cluster_coverage() {
        let runs = [run(0, 4, 0, 4, 0)];
        let glyph_starts = [0, 1, 2, 3];
        let glyph_counts = [1, 1, 1, 1];

        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &safe_flags::<4>(),
                &stable_ids::<4>(),
                &[fragment(0, 3), fragment(2, 4)],
                &[
                    ordinary(0, 0),
                    ordinary(0, 1),
                    ordinary(0, 2),
                    ordinary(1, 3)
                ],
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &safe_flags::<4>(),
                &stable_ids::<4>(),
                &[fragment(0, 2), fragment(2, 4)],
                &[
                    ordinary(0, 0),
                    ordinary(0, 1),
                    ordinary(0, 0),
                    ordinary(1, 3)
                ],
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &glyph_starts,
                &glyph_counts,
                &safe_flags::<4>(),
                &stable_ids::<4>(),
                &[fragment(0, 2), fragment(2, 4)],
                &[ordinary(0, 0), ordinary(0, 1), ordinary(1, 2)],
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert!(matches!(
            build_visual_instance_map(
                &runs,
                &[0, 1, 3, 4],
                &glyph_counts,
                &safe_flags::<4>(),
                &stable_ids::<4>(),
                &[fragment(0, 4)],
                &[
                    ordinary(0, 0),
                    ordinary(0, 1),
                    ordinary(0, 2),
                    ordinary(0, 3)
                ],
            ),
            Err(EngineError::InvalidRequest)
        ));
    }
}
