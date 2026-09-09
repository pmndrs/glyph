#![cfg_attr(not(test), allow(dead_code))]

use super::*;
use crate::engine::{flow_composition, frame, layout_units, line_composition};
use alloc::vec::Vec;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ShadowJustifySite {
    cluster: u32,
    space_ordinal: Option<u32>,
    gap_ordinal: Option<u32>,
    adjustment_units: i64,
}

#[derive(Debug, PartialEq)]
struct ShadowFragmentPlan {
    source_ordinal: u32,
    physical_slot: u32,
    visual_clusters: Vec<u32>,
    visual_levels: Vec<u8>,
    hanging_clusters: Option<core::ops::Range<u32>>,
    pen_origin: f64,
    justify: JustifyDistribution,
    justify_sites: Vec<ShadowJustifySite>,
}

fn shadow_compose_character_fragments(
    physical_slots: &[(f64, f64)],
    paragraph_level: u8,
    clusters: &ClusterArena,
) -> Result<Vec<FlowFragment>, EngineError> {
    let mut preceding_end = None;
    for &(start, end) in physical_slots {
        if !start.is_finite()
            || !end.is_finite()
            || start > end
            || preceding_end.is_some_and(|preceding| preceding > start)
        {
            return Err(EngineError::InvalidRequest);
        }
        preceding_end = Some(end);
    }

    let mut cursor = line_composition::LineCursor::at_cluster(0);
    let mut fragments = Vec::new();
    reserve(&mut fragments, physical_slots.len())?;
    for source_ordinal in 0..physical_slots.len() {
        if cursor.is_complete(clusters.starts.len()) {
            break;
        }
        let physical_slot = if paragraph_level & 1 == 0 {
            source_ordinal
        } else {
            physical_slots.len() - 1 - source_ordinal
        };
        let (slot_start, slot_end) = physical_slots[physical_slot];
        let Some(line) = line_composition::layout_next_line_integer(
            clusters,
            &mut cursor,
            Some(layout_units::layout_units_from_scaled(
                slot_end - slot_start,
            )),
            frame::WRAP_CHARACTER,
            0.0,
        )?
        else {
            break;
        };
        fragments.push(FlowFragment {
            line,
            slot_start,
            slot_end,
            flexible_end: false,
            boundary_index: flow_composition::NO_BOUNDARY,
        });
    }
    if !cursor.is_complete(clusters.starts.len()) {
        return Err(EngineError::InvalidRequest);
    }
    Ok(fragments)
}

#[allow(clippy::too_many_arguments)]
fn shadow_multifragment_line_plan(
    line: FlowLine,
    source_fragments: &[FlowFragment],
    physical_slots: &[(f64, f64)],
    final_line: bool,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    bidi: &BidiAnalysis,
    controls: JustifyControls,
) -> Result<Vec<ShadowFragmentPlan>, EngineError> {
    if source_fragments.is_empty() || source_fragments.len() != physical_slots.len() {
        return Err(EngineError::InvalidRequest);
    }
    let first = source_fragments
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    let last = source_fragments.last().ok_or(EngineError::InvalidRequest)?;
    let line_text_start = first.line.text_start;
    let line_text_end = last.line.text_end;
    let paragraph_level = paragraph_level_at(bidi, line_text_start);
    let mut line_levels = Vec::new();
    prepare_line_levels(&mut line_levels, bidi, line_text_start, line_text_end)?;

    let mut plans = Vec::new();
    reserve(&mut plans, source_fragments.len())?;
    let mut preceding_cluster_end = None;
    for (source_ordinal, source_fragment) in source_fragments.iter().copied().enumerate() {
        let cluster_start = usize::try_from(source_fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end = usize::try_from(source_fragment.line.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?;
        if cluster_start > cluster_end
            || cluster_end > clusters.starts.len()
            || preceding_cluster_end.is_some_and(|end| end != cluster_start)
        {
            return Err(EngineError::InvalidRequest);
        }
        preceding_cluster_end = Some(cluster_end);

        let physical_slot = if paragraph_level & 1 == 0 {
            source_ordinal
        } else {
            physical_slots.len() - 1 - source_ordinal
        };
        let (slot_start, slot_end) = physical_slots[physical_slot];
        if !slot_start.is_finite() || !slot_end.is_finite() || slot_start > slot_end {
            return Err(EngineError::InvalidRequest);
        }
        let fragment = FlowFragment {
            slot_start,
            slot_end,
            ..source_fragment
        };

        let mut visual_clusters = Vec::new();
        let mut visual_levels = Vec::new();
        reserve(
            &mut visual_clusters,
            cluster_end.saturating_sub(cluster_start),
        )?;
        reserve(
            &mut visual_levels,
            cluster_end.saturating_sub(cluster_start),
        )?;
        for cluster in cluster_start..cluster_end {
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                continue;
            }
            visual_clusters.push(u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?);
            visual_levels.push(cluster_level(
                cluster,
                line_text_start,
                clusters,
                runs,
                &line_levels,
            )?);
        }
        reorder_l2(&mut visual_clusters, &mut visual_levels, 0);

        let mut hanging_end = cluster_end;
        if hanging_end > cluster_start && clusters.flags[hanging_end - 1] & CLUSTER_HARD_BREAK != 0
        {
            hanging_end -= 1;
        }
        let mut hanging_start = hanging_end;
        let mut hanging_units = 0_i64;
        while hanging_start > cluster_start
            && clusters.flags[hanging_start - 1] & CLUSTER_SPACE != 0
        {
            hanging_start -= 1;
            hanging_units = hanging_units.saturating_add(clusters.advance_units[hanging_start]);
        }
        if layout_units::scaled_from_layout_units(hanging_units).to_bits()
            != fragment.line.hung_advance.to_bits()
        {
            return Err(EngineError::InvalidRequest);
        }
        let hanging_clusters = if hanging_start == hanging_end {
            None
        } else {
            Some(
                u32::try_from(hanging_start).map_err(|_| EngineError::ResultTooLarge)?
                    ..u32::try_from(hanging_end).map_err(|_| EngineError::ResultTooLarge)?,
            )
        };
        let hung_leads = hanging_clusters
            .as_ref()
            .and_then(|range| {
                let cluster = range.end.checked_sub(1)?;
                visual_clusters
                    .iter()
                    .position(|candidate| *candidate == cluster)
            })
            .is_some_and(|visual| visual_levels[visual] & 1 != 0);
        let (justify, pen_origin) = fragment_pen(
            line,
            fragment,
            final_line,
            clusters,
            cluster_start,
            cluster_end,
            0.0,
            controls,
            paragraph_level,
            hung_leads,
        );

        let mut space_ordinal = 0_u32;
        let mut gap_ordinal = 0_u32;
        let mut justify_sites = Vec::new();
        reserve(&mut justify_sites, visual_clusters.len())?;
        for &cluster in &visual_clusters {
            let cluster = usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
            let space_site = clusters.flags[cluster] & CLUSTER_SPACE != 0
                && cluster < justify.gap_end
                && space_ordinal < justify.spaces
                && (justify.per_space_units != 0 || justify.extra_space_units != 0);
            let gap_site = cluster < justify.gap_end
                && gap_ordinal < justify.gaps
                && (justify.per_gap_units != 0 || justify.extra_gap_units != 0);
            let mut adjustment_units = 0_i64;
            let admitted_space_ordinal = space_site.then_some(space_ordinal);
            if space_site {
                adjustment_units += justify.per_space_units
                    + i64::from(i64::from(space_ordinal) < justify.extra_space_units);
                space_ordinal += 1;
            }
            let admitted_gap_ordinal = gap_site.then_some(gap_ordinal);
            if gap_site {
                adjustment_units += justify.per_gap_units
                    + i64::from(i64::from(gap_ordinal) < justify.extra_gap_units);
                gap_ordinal += 1;
            }
            justify_sites.push(ShadowJustifySite {
                cluster: u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                space_ordinal: admitted_space_ordinal,
                gap_ordinal: admitted_gap_ordinal,
                adjustment_units,
            });
        }

        plans.push(ShadowFragmentPlan {
            source_ordinal: u32::try_from(source_ordinal)
                .map_err(|_| EngineError::ResultTooLarge)?,
            physical_slot: u32::try_from(physical_slot).map_err(|_| EngineError::ResultTooLarge)?,
            visual_clusters,
            visual_levels,
            hanging_clusters,
            pen_origin,
            justify,
            justify_sites,
        });
    }
    Ok(plans)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        cluster_state::CLUSTER_SAFE_BEFORE, flow_composition::NO_BOUNDARY,
        line_composition::ComposedLine,
    };
    use alloc::{vec, vec::Vec};

    fn shadow_multifragment_fixture(
        text: &[u16],
        paragraph_level: u8,
    ) -> (ClusterArena, Vec<ShapingRun>) {
        let cluster_count = text.len();
        let mut flags = vec![CLUSTER_SAFE_BEFORE; cluster_count];
        for (index, code_unit) in text.iter().copied().enumerate() {
            if code_unit == 0x20 {
                flags[index] |= CLUSTER_SPACE;
            }
        }
        let style = ResolvedStyle::test_typography(1.0, 0.0, 0.0);
        let clusters = ClusterArena {
            starts: (0..u32::try_from(cluster_count).unwrap()).collect(),
            ends: (1..=u32::try_from(cluster_count).unwrap()).collect(),
            advances: vec![1.0; cluster_count],
            advance_units: vec![65_536; cluster_count],
            flags,
            source_runs: vec![0; cluster_count],
            index_at: (0..=u32::try_from(cluster_count).unwrap()).collect(),
            ..ClusterArena::default()
        };
        let runs = vec![ShapingRun {
            text_start: 0,
            text_end: u32::try_from(cluster_count).unwrap(),
            script: u32::from_be_bytes(*b"Latn"),
            direction: paragraph_level & 1,
            bidi_level: paragraph_level,
            style,
        }];
        (clusters, runs)
    }

    fn shadow_source_fragment(
        cluster_start: u32,
        cluster_end: u32,
        advance: f64,
        hung_advance: f64,
    ) -> FlowFragment {
        FlowFragment {
            line: ComposedLine {
                cluster_start,
                cluster_end,
                text_start: cluster_start,
                text_end: cluster_end,
                advance,
                hung_advance,
                hard_break: false,
            },
            slot_start: 0.0,
            slot_end: 0.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
        }
    }

    fn shadow_multifragment_line(align: u8) -> FlowLine {
        FlowLine {
            flow_thread_id: 1,
            region_id: 1,
            transform_index: 0,
            clip_id: 0,
            fragment_start: 0,
            fragment_count: 2,
            align,
            block_start: 0.0,
            baseline: 1.0,
            height: 1.0,
        }
    }

    #[test]
    fn multifragment_composition_consumes_unequal_slots_in_paragraph_order() {
        let text = "abcdefg".encode_utf16().collect::<Vec<_>>();
        let (clusters, _) = shadow_multifragment_fixture(&text, 0);
        let slots = [(0.0, 2.0), (10.0, 15.0)];

        for (paragraph_level, expected) in [
            (0_u8, [(0_u32, 2_u32, 0_usize), (2, 7, 1)]),
            (1_u8, [(0_u32, 5_u32, 1_usize), (5, 7, 0)]),
        ] {
            let fragments =
                shadow_compose_character_fragments(&slots, paragraph_level, &clusters).unwrap();
            assert_eq!(fragments.len(), 2);
            for (fragment, (cluster_start, cluster_end, physical_slot)) in
                fragments.iter().zip(expected)
            {
                assert_eq!(
                    (fragment.line.cluster_start, fragment.line.cluster_end),
                    (cluster_start, cluster_end),
                );
                assert_eq!(
                    (fragment.slot_start, fragment.slot_end),
                    slots[physical_slot],
                );
                assert!(fragment.line.advance <= fragment.slot_end - fragment.slot_start);
            }
        }
    }

    #[test]
    fn multifragment_bidi_matches_upstream_l1_and_fragment_local_l2() {
        let text = "ab אבג cd  ".encode_utf16().collect::<Vec<_>>();
        let split = 3_u32;
        let source_fragments = [
            shadow_source_fragment(0, split, 2.0, 1.0),
            shadow_source_fragment(split, u32::try_from(text.len()).unwrap(), 6.0, 2.0),
        ];
        let slots = [(10.0, 20.0), (30.0, 40.0)];

        for (direction, paragraph_level) in [
            (crate::bidi::DIRECTION_LTR, 0_u8),
            (crate::bidi::DIRECTION_RTL, 1_u8),
        ] {
            let bidi = crate::bidi::analyze(&text, direction).unwrap();
            let (clusters, runs) = shadow_multifragment_fixture(&text, paragraph_level);
            let plans = shadow_multifragment_line_plan(
                shadow_multifragment_line(ALIGN_START),
                &source_fragments,
                &slots,
                false,
                &clusters,
                &runs,
                &bidi,
                JustifyControls::default(),
            )
            .unwrap();

            let upstream = unicode_bidi::utf16::BidiInfo::new_with_data_source(
                &crate::bidi::Unicode17BidiData,
                &text,
                Some(unicode_bidi::Level::new(paragraph_level).unwrap()),
            );
            let upstream_levels =
                upstream.reordered_levels(upstream.paragraphs.first().unwrap(), 0..text.len());
            let upstream_numbers = upstream_levels
                .iter()
                .map(|level| level.number())
                .collect::<Vec<_>>();
            let mut prepared = Vec::new();
            prepare_line_levels(&mut prepared, &bidi, 0, u32::try_from(text.len()).unwrap())
                .unwrap();
            assert_eq!(prepared, upstream_numbers, "full-line L1 diverged");
            assert_eq!(prepared.last().copied(), Some(paragraph_level));

            for (plan, source) in plans.iter().zip(&source_fragments) {
                let start = usize::try_from(source.line.cluster_start).unwrap();
                let end = usize::try_from(source.line.cluster_end).unwrap();
                let local_levels = upstream_levels[start..end].to_vec();
                let visual = unicode_bidi::utf16::BidiInfo::reorder_visual(&local_levels);
                let expected_clusters = visual
                    .iter()
                    .map(|ordinal| u32::try_from(start + ordinal).unwrap())
                    .collect::<Vec<_>>();
                let expected_levels = visual
                    .iter()
                    .map(|ordinal| local_levels[*ordinal].number())
                    .collect::<Vec<_>>();
                assert_eq!(plan.visual_clusters, expected_clusters);
                assert_eq!(plan.visual_levels, expected_levels);
            }

            let later_level = plans[1]
                .visual_clusters
                .iter()
                .position(|cluster| *cluster == split)
                .map(|visual| plans[1].visual_levels[visual])
                .unwrap();
            let wrong_fragment_base = cluster_level(
                usize::try_from(split).unwrap(),
                source_fragments[1].line.text_start,
                &clusters,
                &runs,
                &prepared,
            )
            .unwrap();
            assert_ne!(later_level, wrong_fragment_base);

            let source_to_slot = plans
                .iter()
                .map(|plan| plan.physical_slot)
                .collect::<Vec<_>>();
            let expected_slots = if paragraph_level == 0 {
                vec![0, 1]
            } else {
                vec![1, 0]
            };
            assert_eq!(source_to_slot, expected_slots);
            let mut physical_paint_order = plans.iter().collect::<Vec<_>>();
            physical_paint_order.sort_unstable_by_key(|plan| plan.physical_slot);
            let painted_sources = physical_paint_order
                .iter()
                .map(|plan| plan.source_ordinal)
                .collect::<Vec<_>>();
            let expected_paint = if paragraph_level == 0 {
                vec![0, 1]
            } else {
                vec![1, 0]
            };
            assert_eq!(painted_sources, expected_paint);
            assert_eq!(plans[0].hanging_clusters, Some(2..3));
            assert_eq!(plans[1].hanging_clusters, Some(9..11));
            let hanging_visual = plans[1]
                .visual_clusters
                .iter()
                .position(|cluster| *cluster == 10)
                .unwrap();
            assert_eq!(plans[1].visual_levels[hanging_visual], paragraph_level);
            if paragraph_level == 0 {
                assert_eq!(hanging_visual, plans[1].visual_clusters.len() - 1);
                assert_eq!(plans[1].pen_origin, 30.0);
            } else {
                assert_eq!(hanging_visual, 0);
                assert_eq!(plans[1].pen_origin, 12.0);
            }
        }
    }

    #[test]
    fn multifragment_bidi_indexes_multiunit_clusters_from_nonzero_line_start() {
        let text = "xxA😀 אב  \n".encode_utf16().collect::<Vec<_>>();
        let starts = vec![0, 1, 2, 3, 5, 6, 7, 8, 9, 10];
        let ends = vec![1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
        let mut flags = vec![CLUSTER_SAFE_BEFORE; starts.len()];
        flags[4] |= CLUSTER_SPACE;
        flags[7] |= CLUSTER_SPACE;
        flags[8] |= CLUSTER_SPACE;
        flags[9] |= CLUSTER_HARD_BREAK;
        let mut advances = vec![1.0; starts.len()];
        let mut advance_units = vec![65_536; starts.len()];
        advances[9] = 0.0;
        advance_units[9] = 0;
        let clusters = ClusterArena {
            starts,
            ends,
            advances,
            advance_units,
            flags,
            source_runs: vec![0; 10],
            index_at: vec![0; text.len() + 1],
            ..ClusterArena::default()
        };
        let runs = vec![ShapingRun {
            text_start: 0,
            text_end: u32::try_from(text.len()).unwrap(),
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style: ResolvedStyle::test_typography(1.0, 0.0, 0.0),
        }];
        let mut fragments = [
            shadow_source_fragment(2, 5, 2.0, 1.0),
            shadow_source_fragment(5, 10, 2.0, 2.0),
        ];
        fragments[0].line.text_start = 2;
        fragments[0].line.text_end = 6;
        fragments[1].line.text_start = 6;
        fragments[1].line.text_end = 10;
        fragments[1].line.hard_break = true;
        let bidi = crate::bidi::analyze(&text, crate::bidi::DIRECTION_LTR).unwrap();
        let plans = shadow_multifragment_line_plan(
            shadow_multifragment_line(ALIGN_START),
            &fragments,
            &[(0.0, 5.0), (10.0, 15.0)],
            false,
            &clusters,
            &runs,
            &bidi,
            JustifyControls::default(),
        )
        .unwrap();

        let upstream = unicode_bidi::utf16::BidiInfo::new_with_data_source(
            &crate::bidi::Unicode17BidiData,
            &text,
            Some(unicode_bidi::Level::ltr()),
        );
        let levels = upstream.reordered_levels(upstream.paragraphs.first().unwrap(), 2..10);
        for (plan, fragment) in plans.iter().zip(&fragments) {
            let cluster_start = usize::try_from(fragment.line.cluster_start).unwrap();
            let cluster_end = usize::try_from(fragment.line.cluster_end).unwrap();
            let logical_clusters = (cluster_start..cluster_end)
                .filter(|cluster| clusters.flags[*cluster] & CLUSTER_HARD_BREAK == 0)
                .collect::<Vec<_>>();
            let cluster_levels = logical_clusters
                .iter()
                .map(|cluster| levels[usize::try_from(clusters.starts[*cluster]).unwrap()])
                .collect::<Vec<_>>();
            let visual = unicode_bidi::utf16::BidiInfo::reorder_visual(&cluster_levels);
            assert_eq!(
                plan.visual_clusters,
                visual
                    .iter()
                    .map(|ordinal| u32::try_from(logical_clusters[*ordinal]).unwrap())
                    .collect::<Vec<_>>(),
            );
        }
        assert_eq!(plans[0].hanging_clusters, Some(4..5));
        assert_eq!(plans[1].hanging_clusters, Some(7..9));
    }

    #[derive(Debug, PartialEq, Eq)]
    struct ShadowJustifiedGeometry {
        origins: Vec<(u32, i64)>,
        ink_bounds: Option<(i64, i64)>,
    }

    fn shadow_justified_geometry_units(
        plan: &ShadowFragmentPlan,
        clusters: &ClusterArena,
    ) -> ShadowJustifiedGeometry {
        let mut cursor = crate::engine::layout_units::layout_units_from_scaled(plan.pen_origin);
        let mut origins = Vec::new();
        let mut ink_bounds: Option<(i64, i64)> = None;
        for site in &plan.justify_sites {
            origins.push((site.cluster, cursor));
            let cluster = usize::try_from(site.cluster).unwrap();
            let advance = clusters.advance_units[cluster];
            if clusters.flags[cluster] & CLUSTER_SPACE == 0 {
                let ink_end = cursor.saturating_add(advance);
                ink_bounds = Some(match ink_bounds {
                    Some((start, end)) => (start.min(cursor), end.max(ink_end)),
                    None => (cursor, ink_end),
                });
            }
            cursor = cursor
                .saturating_add(advance)
                .saturating_add(site.adjustment_units);
        }
        ShadowJustifiedGeometry {
            origins,
            ink_bounds,
        }
    }

    #[test]
    fn multifragment_justification_places_complete_mixed_bidi_site_vectors() {
        let text = "a אב b c ".encode_utf16().collect::<Vec<_>>();
        let deficit_units = 2 * 65_536 + 1;
        let deficit = crate::engine::layout_units::scaled_from_layout_units(deficit_units);
        let fragments = [
            shadow_source_fragment(0, 5, 4.0, 1.0),
            shadow_source_fragment(5, 9, 3.0, 1.0),
        ];
        let controls = JustifyControls {
            minimum_word_space_ratio: 0.0,
            maximum_word_space_ratio: 2.0,
            letter_space_expansion: 1.0,
            last_line_justify: false,
        };
        let site = |cluster, space_ordinal, gap_ordinal, adjustment_units| ShadowJustifySite {
            cluster,
            space_ordinal,
            gap_ordinal,
            adjustment_units,
        };
        for (direction, paragraph_level, slots) in [
            (
                crate::bidi::DIRECTION_LTR,
                0_u8,
                [(0.0, 4.0 + deficit), (10.0, 13.0 + deficit)],
            ),
            (
                crate::bidi::DIRECTION_RTL,
                1_u8,
                [(0.0, 3.0 + deficit), (10.0, 14.0 + deficit)],
            ),
        ] {
            let bidi = crate::bidi::analyze(&text, direction).unwrap();
            let (clusters, runs) = shadow_multifragment_fixture(&text, paragraph_level);
            let plans = shadow_multifragment_line_plan(
                shadow_multifragment_line(ALIGN_JUSTIFY),
                &fragments,
                &slots,
                false,
                &clusters,
                &runs,
                &bidi,
                controls,
            )
            .unwrap();
            let (expected_sites, expected_geometry) = if paragraph_level == 0 {
                (
                    [
                        vec![
                            site(0, None, Some(0), 21_846),
                            site(1, Some(0), Some(1), 87_382),
                            site(3, None, Some(2), 21_845),
                            site(2, None, None, 0),
                            site(4, None, None, 0),
                        ],
                        vec![
                            site(5, None, Some(0), 32_769),
                            site(6, Some(0), Some(1), 98_304),
                            site(7, None, None, 0),
                            site(8, None, None, 0),
                        ],
                    ],
                    [
                        ShadowJustifiedGeometry {
                            origins: vec![
                                (0, 0),
                                (1, 87_382),
                                (3, 240_300),
                                (2, 327_681),
                                (4, 393_217),
                            ],
                            ink_bounds: Some((0, 393_217)),
                        },
                        ShadowJustifiedGeometry {
                            origins: vec![(5, 655_360), (6, 753_665), (7, 917_505), (8, 983_041)],
                            ink_bounds: Some((655_360, 983_041)),
                        },
                    ],
                )
            } else {
                (
                    [
                        vec![
                            site(4, None, None, 0),
                            site(3, None, Some(0), 21_846),
                            site(2, None, Some(1), 21_846),
                            site(1, Some(0), Some(2), 87_381),
                            site(0, None, None, 0),
                        ],
                        vec![
                            site(8, None, None, 0),
                            site(5, None, Some(0), 32_769),
                            site(6, Some(0), Some(1), 98_304),
                            site(7, None, None, 0),
                        ],
                    ],
                    [
                        ShadowJustifiedGeometry {
                            origins: vec![
                                (4, 589_824),
                                (3, 655_360),
                                (2, 742_742),
                                (1, 830_124),
                                (0, 983_041),
                            ],
                            ink_bounds: Some((655_360, 1_048_577)),
                        },
                        ShadowJustifiedGeometry {
                            origins: vec![(8, -65_536), (5, 0), (6, 98_305), (7, 262_145)],
                            ink_bounds: Some((0, 327_681)),
                        },
                    ],
                )
            };
            for ((plan, expected_sites), expected_geometry) in
                plans.iter().zip(&expected_sites).zip(&expected_geometry)
            {
                assert_eq!(plan.justify.total_units(), deficit_units);
                assert_eq!(&plan.justify_sites, expected_sites);
                assert_eq!(
                    shadow_justified_geometry_units(plan, &clusters),
                    *expected_geometry
                );
            }
        }
    }

    #[test]
    fn multifragment_justification_resets_ordinals_and_uses_logical_final_line() {
        let text = "a bcd ef ".encode_utf16().collect::<Vec<_>>();
        let (clusters, runs) = shadow_multifragment_fixture(&text, 0);
        let bidi = crate::bidi::analyze(&text, crate::bidi::DIRECTION_LTR).unwrap();
        let fragments = [
            shadow_source_fragment(0, 4, 4.0, 0.0),
            shadow_source_fragment(4, 9, 4.0, 1.0),
        ];
        let slots = [(0.0, 6.0), (10.0, 16.0)];
        let controls = JustifyControls {
            minimum_word_space_ratio: 0.0,
            maximum_word_space_ratio: 2.0,
            letter_space_expansion: 1.0,
            last_line_justify: false,
        };
        let nonfinal = shadow_multifragment_line_plan(
            shadow_multifragment_line(ALIGN_JUSTIFY),
            &fragments,
            &slots,
            false,
            &clusters,
            &runs,
            &bidi,
            controls,
        )
        .unwrap();
        assert!(nonfinal.iter().all(|plan| !plan.justify.is_zero()));
        assert!(
            nonfinal
                .iter()
                .all(|plan| plan.justify.total_units() == 2 * 65_536)
        );
        for plan in &nonfinal {
            assert_eq!(
                plan.justify_sites
                    .iter()
                    .find_map(|site| site.space_ordinal),
                Some(0),
            );
            assert_eq!(
                plan.justify_sites.iter().find_map(|site| site.gap_ordinal),
                Some(0),
            );
            assert_eq!(
                plan.justify_sites
                    .iter()
                    .map(|site| site.adjustment_units)
                    .sum::<i64>(),
                plan.justify.total_units(),
            );
        }
        assert_eq!(nonfinal[0].hanging_clusters, None);
        assert_eq!(nonfinal[1].hanging_clusters, Some(8..9));

        let final_auto = shadow_multifragment_line_plan(
            shadow_multifragment_line(ALIGN_JUSTIFY),
            &fragments,
            &slots,
            true,
            &clusters,
            &runs,
            &bidi,
            controls,
        )
        .unwrap();
        assert!(final_auto.iter().all(|plan| plan.justify.is_zero()));

        let justify_last = JustifyControls {
            last_line_justify: true,
            ..controls
        };
        let final_justified = shadow_multifragment_line_plan(
            shadow_multifragment_line(ALIGN_JUSTIFY),
            &fragments,
            &slots,
            true,
            &clusters,
            &runs,
            &bidi,
            justify_last,
        )
        .unwrap();
        assert!(final_justified.iter().all(|plan| !plan.justify.is_zero()));

        let malformed_non_space_hanging_suffix = [
            shadow_source_fragment(0, 4, 3.0, 1.0),
            shadow_source_fragment(4, 9, 5.0, 0.0),
        ];
        assert!(matches!(
            shadow_multifragment_line_plan(
                shadow_multifragment_line(ALIGN_JUSTIFY),
                &malformed_non_space_hanging_suffix,
                &slots,
                false,
                &clusters,
                &runs,
                &bidi,
                controls,
            ),
            Err(EngineError::InvalidRequest)
        ));

        let malformed_hanging_terminal = [
            shadow_source_fragment(0, 4, 4.0, 0.0),
            shadow_source_fragment(4, 8, 3.0, 1.0),
        ];
        assert!(matches!(
            shadow_multifragment_line_plan(
                shadow_multifragment_line(ALIGN_JUSTIFY),
                &malformed_hanging_terminal,
                &slots,
                false,
                &clusters,
                &runs,
                &bidi,
                controls,
            ),
            Err(EngineError::InvalidRequest)
        ));
    }

    #[test]
    fn multifragment_plan_maps_safe_visual_clusters_and_rejects_invalid_cuts() {
        use crate::engine::{
            cluster_state::LayoutRun,
            visual_span_proof::{SliceRole, VisualClusterOccurrence, build_visual_instance_map},
        };

        let text = "ab אב \n".encode_utf16().collect::<Vec<_>>();
        let split = 3_u32;
        let mut fragments = [
            shadow_source_fragment(0, split, 2.0, 1.0),
            shadow_source_fragment(split, u32::try_from(text.len()).unwrap(), 3.0, 1.0),
        ];
        fragments[1].line.hard_break = true;
        let (mut clusters, runs) = shadow_multifragment_fixture(&text, 0);
        let hard_break = clusters.starts.len() - 1;
        clusters.flags[hard_break] |= CLUSTER_HARD_BREAK;
        clusters.advances[hard_break] = 0.0;
        clusters.advance_units[hard_break] = 0;
        let bidi = crate::bidi::analyze(&text, crate::bidi::DIRECTION_LTR).unwrap();
        let plans = shadow_multifragment_line_plan(
            shadow_multifragment_line(ALIGN_START),
            &fragments,
            &[(0.0, 8.0), (10.0, 18.0)],
            false,
            &clusters,
            &runs,
            &bidi,
            JustifyControls::default(),
        )
        .unwrap();

        let mut occurrences = Vec::new();
        let mut visual_span_id = 0_u32;
        for (slice_index, plan) in plans.iter().enumerate() {
            let mut preceding = None;
            for (&cluster_index, &resolved_level) in
                plan.visual_clusters.iter().zip(&plan.visual_levels)
            {
                let role = if plan
                    .hanging_clusters
                    .as_ref()
                    .is_some_and(|range| range.contains(&cluster_index))
                {
                    SliceRole::HangingSpace
                } else {
                    SliceRole::Ordinary
                };
                let identity = (resolved_level, role);
                if preceding.is_some_and(|previous| previous != identity) {
                    visual_span_id += 1;
                }
                preceding = Some(identity);
                occurrences.push(VisualClusterOccurrence {
                    slice_index: u32::try_from(slice_index).unwrap(),
                    cluster_index,
                    visual_span_id,
                    resolved_level,
                    role,
                });
            }
            visual_span_id += 1;
        }

        let cluster_count = clusters.starts.len();
        let glyph_starts = (0..cluster_count)
            .map(|cluster| u32::try_from(cluster.min(hard_break)).unwrap())
            .collect::<Vec<_>>();
        let mut glyph_counts = vec![1; cluster_count];
        glyph_counts[hard_break] = 0;
        let layout_runs = [LayoutRun {
            cluster_start: 0,
            cluster_end: u32::try_from(cluster_count).unwrap(),
            glyph_start: 0,
            glyph_count: u32::try_from(hard_break).unwrap(),
            source_run: 0,
            font_handle: 17,
        }];
        let map = build_visual_instance_map(
            &layout_runs,
            &glyph_starts,
            &glyph_counts,
            &clusters.flags,
            &fragments,
            &occurrences,
        )
        .unwrap();

        assert_eq!(map.counts().visual_cluster_count, hard_break);
        assert_eq!(map.glyph_indices.len(), hard_break);
        assert!(
            occurrences
                .iter()
                .all(|occurrence| occurrence.cluster_index != u32::try_from(hard_break).unwrap())
        );

        let mut unsafe_flags = clusters.flags.clone();
        unsafe_flags[usize::try_from(split).unwrap()] = 0;
        assert!(matches!(
            build_visual_instance_map(
                &layout_runs,
                &glyph_starts,
                &glyph_counts,
                &unsafe_flags,
                &fragments,
                &occurrences,
            ),
            Err(EngineError::InvalidRequest)
        ));

        let mut boundary_fragments = fragments;
        boundary_fragments[1].boundary_index = 7;
        assert!(matches!(
            build_visual_instance_map(
                &layout_runs,
                &glyph_starts,
                &glyph_counts,
                &clusters.flags,
                &boundary_fragments,
                &occurrences,
            ),
            Err(EngineError::InvalidRequest)
        ));
    }
}
