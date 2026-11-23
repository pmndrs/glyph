use alloc::vec::Vec;
use core::ops::Range;

use crate::{FontMetrics, bidi::BidiAnalysis};

use super::{
    EngineError, FrameFault,
    cluster_state::{CLUSTER_HARD_BREAK, CLUSTER_SAFE_BEFORE, CLUSTER_SPACE, ClusterArena},
    flow_geometry::{
        ExclusionDirtyBand, FlowGeometryArena, InlineCut, InlineSlotArena, polygon_projection,
    },
    frame::{
        ALIGN_JUSTIFY, ALIGN_START, AXIS_AT_MOST, AXIS_EXACT, DROP_CAP_ALIGN_BASELINE,
        DROP_CAP_ALIGN_TEXT_TOP, DROP_CAP_SIDE_INLINE_START, EXCLUSION_WRAP_INLINE_END,
        EXCLUSION_WRAP_INLINE_START, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, WRAP_WORD,
        WRITING_HORIZONTAL_TB,
    },
    layout_units::scaled_from_layout_units,
    line_composition::{
        BreakCorrections, ClusterLineFacts, ComposedLine, Correction, FitWitness, LineCursor,
        layout_next_line_witnessed, repeat_line,
    },
    positioning::paragraph_level_at,
    retained_rope::{
        RetainedRope, RopeCursorRange, RopeEditError, RopeRange, RopeRecord, RopeSummary,
    },
    semantic_wire::FlowConstraint,
    shaping_state::ShapingRun,
    style_state::{ResolvedStyle, StyleSegment},
};

mod band;
mod build;
mod convergence;
mod drop_cap;
mod ellipsis;
mod exclusion;
mod extents;
mod threads;
use convergence::*;
use drop_cap::*;
pub(crate) use extents::inline_line_extents;
use extents::*;
pub(crate) use threads::constraint_word_space_shrink;
use threads::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowLine {
    pub flow_thread_id: u32,
    pub region_id: u32,
    pub transform_index: u32,
    pub clip_id: u32,
    pub fragment_count: u16,
    pub align: u8,
    pub block_start: f64,
    pub baseline: f64,
    pub height: f64,
    pub typography: LineTypography,
}

impl RopeRecord for FlowLine {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            fragments: usize::from(self.fragment_count),
            ..RopeSummary::default()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowFragment {
    pub line: ComposedLine,
    pub slot_start: f64,
    pub slot_end: f64,
    /// This slot reached a flexible region end and is resolved to the
    /// thread's chosen inline end after every line has composed.
    pub flexible_end: bool,
    pub boundary_index: u32,
    /// The record shaping the island this fragment starts, when a break correction moved its glyphs.
    pub lead_index: u32,
    /// The record shaping the island this fragment ends, when a break correction moved its glyphs.
    pub tail_index: u32,
}

impl RopeRecord for FlowFragment {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            fragments: 1,
            source_start: self.line.text_start,
            source_end: self
                .line
                .text_end
                .max(self.line.text_start.saturating_add(1)),
            has_source: true,
        }
    }
}

pub(crate) const NO_BOUNDARY: u32 = u32::MAX;

const DROP_CAP_MAX_CLUSTERS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FlowDropCap {
    pub body_resume_cluster: u32,
    pub line: FlowLine,
    pub fragment: FlowFragment,
    cut: InlineCut,
    cut_block_start: f64,
    cut_block_end: f64,
    lines: u8,
    alignment: u8,
    ink_block_start: f64,
    ink_block_end: f64,
    margin_block: f64,
    contour_start: u32,
    contour_count: u16,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EllipsisTarget {
    pub fragment_index: u32,
    pub line_cluster_start: u32,
    pub boundary_cluster_start: u32,
    pub cluster_end: u32,
    pub text_end: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EllipsisReplacement {
    pub cluster_start: usize,
    pub advance_adjustment: f64,
}

/// Primary authored-face metrics, aggregated once per line rather than per glyph.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LineTypography {
    pub ascent: f64,
    pub descent: f64,
    pub cap_height: f64,
    pub x_height: f64,
    pub cap_over: f64,
    pub x_over: f64,
    pub height_fallbacks: u8,
    present: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LineExtents {
    pub above: f64,
    pub below: f64,
    pub typography: LineTypography,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct ClusterLineMetrics {
    extents: LineExtents,
    cap_height: f64,
    baseline_shift: f64,
}

#[derive(Default)]
pub(crate) struct FlowLayoutArena {
    pub lines: RetainedRope<FlowLine>,
    pub fragments: RetainedRope<FlowFragment>,
    pub drop_caps: Vec<FlowDropCap>,
    pub(crate) ellipsis_threads: Vec<u32>,
    // Candidate-owned scratch; retained=false revokes authority without dropping capacity.
    pub(crate) recomposed_lines: Vec<Range<usize>>,
    pub(crate) recomposed_lines_retained: bool,
    /// Every fit this flow ran, in the order it ran them, with the line each composed. They
    /// are facts about the fitter over this flow's clusters, not about the fragments, which
    /// later stages may truncate or retarget.
    pub(crate) fit_witnesses: Vec<(ComposedLine, FitWitness)>,
}

/// A flow's fits, offered to a new build over the same clusters. The new build asks in
/// cluster order, as the old one fitted, so one forward walk answers every line.
struct FitReuse<'a> {
    witnesses: &'a [(ComposedLine, FitWitness)],
    next: usize,
}

impl FlowLayoutArena {
    pub(crate) fn reserve(
        &mut self,
        line_capacity: usize,
        _fragment_capacity: usize,
    ) -> Result<(), EngineError> {
        reserve(&mut self.drop_caps, 1)?;
        reserve(&mut self.ellipsis_threads, line_capacity)
    }

    fn append_retained_range(
        &mut self,
        source: &Self,
        lines: core::ops::Range<usize>,
    ) -> Result<(), EngineError> {
        let fragment_start = source
            .line_fragment_start(lines.start)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_end = source
            .line_fragment_start(lines.end)
            .ok_or(EngineError::InvalidRequest)?;
        if !self
            .lines
            .append_shared_range(&source.lines, lines.clone())
            .map_err(|()| EngineError::ResultTooLarge)?
            || !self
                .fragments
                .append_shared_range(&source.fragments, fragment_start..fragment_end)
                .map_err(|()| EngineError::ResultTooLarge)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    fn resolve_flexible_inline_end(
        &mut self,
        flow_thread_id: u32,
        first_line_indent: f64,
        inline_limit: Option<f64>,
    ) -> Result<Option<f64>, EngineError> {
        let mut content_end = f64::NEG_INFINITY;
        let mut found = false;
        let mut fragment_cursor = self
            .fragments
            .cursor_from(0)
            .ok_or(EngineError::InvalidRequest)?;
        for line in self.lines.iter().copied() {
            let fragments = fragment_cursor
                .take(usize::from(line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            if line.flow_thread_id != flow_thread_id {
                continue;
            }
            for fragment in fragments.iter() {
                found |= fragment.flexible_end;
                let indent = if fragment.line.cluster_start == 0 {
                    first_line_indent
                } else {
                    0.0
                };
                content_end = content_end.max(fragment.slot_start + indent + fragment.line.advance);
            }
        }
        if !fragment_cursor.is_empty() {
            return Err(EngineError::InvalidRequest);
        }
        if !found || !content_end.is_finite() {
            return Ok(None);
        }
        let resolved_end = inline_limit.map_or(content_end, |limit| content_end.min(limit));
        let mut fragment_lines = self.lines.iter().copied().flat_map(|line| {
            core::iter::repeat_n(line.flow_thread_id, usize::from(line.fragment_count))
        });
        let fragment_count = self.fragments.len();
        self.fragments
            .update_ordered(0..fragment_count, |_, fragment| {
                let fragment_thread = fragment_lines.next().ok_or(EngineError::InvalidRequest)?;
                if fragment_thread != flow_thread_id || !fragment.flexible_end {
                    return Ok(super::retained_rope::RopeUpdate::Keep);
                }
                let slot_end = resolved_end.max(fragment.slot_start);
                if slot_end.to_bits() == fragment.slot_end.to_bits() {
                    return Ok(super::retained_rope::RopeUpdate::Keep);
                }
                Ok(super::retained_rope::RopeUpdate::Replace(FlowFragment {
                    slot_end,
                    ..*fragment
                }))
            })
            .map_err(|error| match error {
                RopeEditError::Storage => EngineError::ResultTooLarge,
                RopeEditError::Callback(error) => error,
            })?;
        if fragment_lines.next().is_some() {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Some(resolved_end))
    }

    fn flexible_inline_end(&self, flow_thread_id: u32) -> Option<f64> {
        let mut fragment_cursor = self.fragments.cursor_from(0)?;
        let mut inline_end = None;
        for line in self.lines.iter().copied() {
            let fragments = fragment_cursor.take(usize::from(line.fragment_count))?;
            if line.flow_thread_id != flow_thread_id {
                continue;
            }
            if let Some(fragment) = fragments.iter().find(|fragment| fragment.flexible_end) {
                inline_end.get_or_insert(fragment.slot_end);
            }
        }
        if fragment_cursor.is_empty() {
            inline_end
        } else {
            None
        }
    }

    fn flow_thread_line_range(&self, flow_thread_id: u32) -> Option<(usize, usize)> {
        let start = self
            .lines
            .iter()
            .position(|line| line.flow_thread_id == flow_thread_id)?;
        let end = self
            .lines
            .iter()
            .rposition(|line| line.flow_thread_id == flow_thread_id)?
            + 1;
        Some((start, end))
    }

    pub(crate) fn clear(&mut self) {
        self.lines.clear();
        self.fragments.clear();
        self.drop_caps.clear();
        self.ellipsis_threads.clear();
        self.recomposed_lines.clear();
        self.recomposed_lines_retained = false;
        self.fit_witnesses.clear();
    }

    pub(crate) fn recomposed_line_ranges(&self) -> Option<&[Range<usize>]> {
        self.recomposed_lines_retained
            .then_some(self.recomposed_lines.as_slice())
    }

    fn mark_recomposed_lines(&mut self, range: Range<usize>) -> Result<(), EngineError> {
        let ranges = &mut self.recomposed_lines;
        if let Some(last) = ranges.last_mut()
            && last.end >= range.start
        {
            last.end = last.end.max(range.end);
        } else {
            ranges
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            ranges.push(range);
        }
        self.recomposed_lines_retained = true;
        Ok(())
    }

    pub(crate) fn ellipsis_threads(&self) -> &[u32] {
        &self.ellipsis_threads
    }

    pub(crate) fn line_fragment_start(&self, line_index: usize) -> Option<usize> {
        self.lines
            .prefix_summary(line_index)
            .map(|summary| summary.fragments)
    }

    fn source_restart_line(&self, offset: u32) -> Option<usize> {
        let containing = self
            .fragments
            .find_source(offset, |fragment, offset| {
                fragment.line.text_start <= offset
                    && offset
                        < fragment
                            .line
                            .text_end
                            .max(fragment.line.text_start.saturating_add(1))
            })
            .and_then(|fragment| self.lines.index_for_fragment(fragment))?;
        let flow_thread_id = self.lines.get(containing)?.flow_thread_id;
        let Some(previous) = containing.checked_sub(1) else {
            return Some(containing);
        };
        if self.lines.get(previous)?.flow_thread_id == flow_thread_id {
            // A narrower first cluster can move backward across its old line boundary.
            Some(previous)
        } else {
            Some(containing)
        }
    }

    pub(crate) fn line_fragments(
        &self,
        line_index: usize,
    ) -> Result<RopeRange<'_, FlowFragment>, EngineError> {
        let line = self
            .lines
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let start = self
            .line_fragment_start(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        self.fragments
            .range(start..end)
            .ok_or(EngineError::InvalidRequest)
    }
}

/// The level of the text's first paragraph: the side a drop cap's inline start is on.
fn first_paragraph_level(bidi: &BidiAnalysis) -> u8 {
    bidi.paragraph_levels.first().copied().unwrap_or(0)
}

fn flexible_inline_limit(constraint: &FlowConstraint) -> Option<f64> {
    (constraint.width_mode == AXIS_AT_MOST).then(|| f64::from(constraint.width))
}

/// Room for one more record, growing geometrically.
fn reserve_amortized<T>(values: &mut Vec<T>) -> Result<(), EngineError> {
    values
        .try_reserve(1)
        .map_err(|_| EngineError::ResultTooLarge)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), EngineError> {
    if values.capacity().saturating_sub(values.len()) < additional {
        values
            .try_reserve_exact(additional)
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::line_composition::NoCorrections;
    use crate::engine::{
        cluster_state::{CLUSTER_SAFE_BEFORE, ClusterBuildInput},
        flow_geometry::{LocalizedGeometryChange, RetainedExclusion, RetainedRegion},
        frame::{
            ALIGN_START, AXIS_EXACT, BLOCK_ALIGN_START, DROP_CAP_ALIGN_BASELINE,
            DROP_CAP_ALIGN_TEXT_TOP, DROP_CAP_SIDE_INLINE_START, EXCLUSION_WRAP_BOTH,
            LAST_LINE_AUTO, ORIENTATION_MIXED, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
            SHAPE_RECTANGLE, WRAP_CHARACTER, WRAP_NONE,
        },
        semantic_wire::{FlowConstraint, FlowExclusion, FlowRegion, FlowVertex},
        shaping_state::{ShapeArena, ShapedRun, ShapingRun},
        style_state::ResolvedStyle,
    };
    use crate::unicode::UnicodeAnalysis;
    use alloc::vec;
    use core::cell::Cell;

    fn fixture_metrics(_: u32) -> Option<FontMetrics> {
        Some(FontMetrics {
            units_per_em: 1_000,
            ascender: 800,
            cap_height: 700,
            x_height: 500,
            height_fallbacks: 0,
            descender: -200,
            line_gap: 100,
            underline_position: -100,
            underline_thickness: 50,
            strikeout_position: 300,
            strikeout_size: 50,
        })
    }

    fn retained_clusters(
        text: &str,
        styles: &[StyleSegment],
        runs: &[ShapingRun],
        shaped: &[(u32, u32, u32, u32)],
    ) -> ClusterArena {
        let text: Vec<u16> = text.encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let mut shape = ShapeArena::default();
        for &(source_run, font_handle, text_start, text_end) in shaped {
            let glyph_start = u32::try_from(shape.glyph_ids.len()).unwrap();
            for cluster in text_start..text_end {
                shape.glyph_ids.push(u16::try_from(cluster + 1).unwrap());
                shape.clusters.push(cluster);
                shape.x_advances.push(500);
                shape.y_advances.push(0);
                shape.x_offsets.push(0);
                shape.y_offsets.push(0);
                shape.glyph_flags.push(0);
            }
            shape.runs.push(ShapedRun {
                source_run,
                binding_handle: source_run + 1,
                font_handle,
                text_start,
                text_end,
                glyph_start,
                glyph_count: text_end - text_start,
            });
        }
        let text_unit_ids = (1..=u32::try_from(text.len()).unwrap()).collect::<Vec<_>>();
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &text_unit_ids,
                    unicode: &unicode,
                    styles,
                    runs,
                    shape: &shape,
                },
                fixture_metrics,
            )
            .unwrap();
        clusters
    }

    fn composed_range(start: u32, end: u32) -> ComposedLine {
        ComposedLine {
            cluster_start: start,
            cluster_end: end,
            text_start: start,
            text_end: end,
            advance: 0.0,
            hung_advance: 0.0,
            hard_break: false,
            start_correction: Correction::ZERO,
            end_correction: Correction::ZERO,
        }
    }

    fn scalar_range_extents(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        line: ComposedLine,
    ) -> LineExtents {
        let start = usize::try_from(line.cluster_start).unwrap();
        let end = usize::try_from(line.cluster_end).unwrap();
        let mut extents = LineExtents::default();
        if start == end {
            let fallback = start
                .saturating_sub(1)
                .min(clusters.starts.len().saturating_sub(1));
            extents.include(
                extents_for_cluster(clusters, styles, fallback, fixture_metrics, |_| Some(1))
                    .unwrap(),
            );
            return extents;
        }
        for index in start..end {
            if clusters.flags[index] & CLUSTER_HARD_BREAK == 0 {
                extents.include(
                    extents_for_cluster(clusters, styles, index, fixture_metrics, |_| Some(1))
                        .unwrap(),
                );
            }
        }
        extents
    }

    fn retained_range_extents(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        line: ComposedLine,
    ) -> LineExtents {
        let mut extents = LineExtents::default();
        include_range_extents(
            &mut extents,
            clusters,
            styles,
            line,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap();
        extents
    }

    #[test]
    fn layout_run_extents_ignore_paint_only_style_boundaries() {
        let base = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut painted = base;
        painted.material_id = 17;
        painted.raster_pixel_ratio = 2.0;
        painted.decoration_flags = 1;
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 2,
                style: base,
            },
            StyleSegment {
                text_start: 2,
                text_end: 4,
                style: painted,
            },
        ];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style: base,
        }];
        let clusters = retained_clusters("abcd", &styles, &runs, &[(0, 9, 0, 4)]);
        let calls = Cell::new(0usize);
        let mut actual = LineExtents::default();
        include_range_extents(
            &mut actual,
            &clusters,
            &styles,
            composed_range(0, 4),
            |handle| {
                calls.set(calls.get() + 1);
                fixture_metrics(handle)
            },
            |_| Some(1),
        )
        .unwrap();

        assert_eq!(clusters.layout_runs().len(), 1);
        assert_eq!(clusters.style_indexes, [0, 0, 1, 1]);
        assert_eq!(
            actual,
            scalar_range_extents(&clusters, &styles, composed_range(0, 4))
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn same_source_drop_cap_resumes_body_at_safe_boundary_and_cuts_first_lines() {
        let cap_style = ResolvedStyle::test_typography(30.0, 0.0, 0.0);
        let body_style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style: cap_style,
            },
            StyleSegment {
                text_start: 1,
                text_end: 7,
                style: body_style,
            },
        ];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 1,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: cap_style,
            },
            ShapingRun {
                text_start: 1,
                text_end: 7,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: body_style,
            },
        ];
        let mut clusters =
            retained_clusters("Abc def", &styles, &runs, &[(0, 9, 0, 1), (1, 9, 1, 7)]);
        clusters
            .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                Some(crate::FontGlyphExtents {
                    x_min: 0,
                    y_min: -200,
                    x_max: 500,
                    y_max: 800,
                })
            })
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters.ensure_placement_segment_anchors().unwrap();
        let mut drop_cap_constraint = constraint();
        drop_cap_constraint.drop_cap_lines = 3;
        drop_cap_constraint.drop_cap_alignment = DROP_CAP_ALIGN_TEXT_TOP;
        drop_cap_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        drop_cap_constraint.drop_cap_margin_inline = 2.0;
        let mut wide_region = region();
        wide_region.inline_end = 40.0;
        wide_region.clip_inline_end = 40.0;
        wide_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        assert!(
            prepare_drop_cap(
                drop_cap_constraint,
                wide_region,
                &clusters,
                &runs,
                0,
                0.0,
                &styles,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap()
            .is_some(),
        );
        let mut layout = FlowLayoutArena::default();
        layout
            .build_with_drop_cap_context(
                None,
                &geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                &BidiAnalysis::default(),
                8,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();

        assert_eq!(layout.drop_caps.len(), 1);
        let cap = layout.drop_caps[0];
        // The cap's 700-unit alignment height meets the body's cap-height even though the
        // fixture glyph deliberately carries another 100 units of ink above it.
        assert_eq!(cap.line.block_start, -1.5);
        assert_eq!(cap.fragment.line.cluster_start, 0);
        assert_eq!(cap.fragment.line.cluster_end, 1);
        assert_eq!(cap.body_resume_cluster, 1);
        assert_eq!(layout.fragments[0].line.cluster_start, 1);
        assert!(layout.fragments[0].slot_start > wide_region.inline_start.into());
        assert_eq!(
            usize::try_from(cap.fragment.line.cluster_end).unwrap()
                + layout
                    .fragments
                    .iter()
                    .map(|fragment| {
                        usize::try_from(fragment.line.cluster_end - fragment.line.cluster_start)
                            .unwrap()
                    })
                    .sum::<usize>(),
            clusters.starts.len(),
        );

        let rtl_cap = prepare_drop_cap(
            drop_cap_constraint,
            wide_region,
            &clusters,
            &runs,
            1,
            0.0,
            &styles,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap()
        .unwrap();
        assert_eq!(rtl_cap.cut.end, f64::from(wide_region.inline_end));
        assert!(rtl_cap.cut.start > f64::from(wide_region.inline_start));
        assert!(rtl_cap.fragment.slot_start > layout.fragments[0].slot_start);

        let mut contour_constraint = drop_cap_constraint;
        contour_constraint.drop_cap_vertices_offset = 0;
        contour_constraint.drop_cap_vertex_count = 3;
        let contour_geometry = FlowGeometryArena {
            constraints: vec![contour_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            vertices: vec![
                FlowVertex {
                    inline: 0.0,
                    block: 0.0,
                },
                FlowVertex {
                    inline: 1.0,
                    block: 0.0,
                },
                FlowVertex {
                    inline: 0.0,
                    block: 1.0,
                },
            ],
            ..FlowGeometryArena::default()
        };
        let contour_cap = prepare_drop_cap(
            contour_constraint,
            wide_region,
            &clusters,
            &runs,
            0,
            0.0,
            &styles,
            fixture_metrics,
            |_| Some(1),
        )
        .unwrap()
        .unwrap();
        let contour_middle = contour_cap.cut_block_start
            + (contour_cap.cut_block_end - contour_cap.cut_block_start) * 0.5;
        let contour_top = contour_cap
            .cut_for_band(
                &contour_geometry,
                0,
                contour_cap.cut_block_start,
                contour_middle,
            )
            .unwrap()
            .unwrap();
        let contour_bottom = contour_cap
            .cut_for_band(
                &contour_geometry,
                1,
                contour_middle,
                contour_cap.cut_block_end,
            )
            .unwrap()
            .unwrap();
        assert_eq!(contour_top.start, contour_bottom.start);
        assert!(contour_top.end > contour_bottom.end);

        let safe_flags = clusters.flags.clone();
        for flags in &mut clusters.flags[1..] {
            *flags &= !CLUSTER_SAFE_BEFORE;
        }
        assert!(
            prepare_drop_cap(
                drop_cap_constraint,
                wide_region,
                &clusters,
                &runs,
                0,
                0.0,
                &styles,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap()
            .is_none(),
            "a cap must disable rather than split an unsafe shaping prefix",
        );
        clusters.flags.copy_from_slice(&safe_flags);

        let mut region_with_object = wide_region;
        region_with_object.exclusion_count = 1;
        let object = FlowExclusion {
            id: 11,
            region_id: wide_region.id,
            geometry_revision: 1,
            vertices_offset: 0,
            vertex_count: 0,
            shape: SHAPE_RECTANGLE,
            wrap_side: EXCLUSION_WRAP_BOTH,
            inline_start: 30.0,
            block_start: 0.0,
            inline_end: 32.0,
            block_end: 60.0,
            margin_inline: 0.0,
            margin_block: 0.0,
        };
        let combined_geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint],
            regions: vec![RetainedRegion {
                record: region_with_object,
                vertex_start: 0,
            }],
            exclusions: vec![RetainedExclusion {
                record: object,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let mut combined = FlowLayoutArena::default();
        combined
            .build_with_drop_cap_context(
                None,
                &combined_geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                &BidiAnalysis::default(),
                8,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
        assert_eq!(combined.drop_caps.len(), 1);
        assert!(!combined.lines.is_empty());
        assert!(
            combined
                .fragments
                .iter()
                .any(|fragment| fragment.slot_start >= 32.0)
        );

        let mut later_cap = cap;
        later_cap.line.flow_thread_id = 2;
        let previous = FlowLayoutArena {
            drop_caps: vec![later_cap],
            ..FlowLayoutArena::default()
        };
        let mut later_constraint = drop_cap_constraint;
        later_constraint.flow_thread_id = 2;
        let ordered_geometry = FlowGeometryArena {
            constraints: vec![drop_cap_constraint, later_constraint],
            ..FlowGeometryArena::default()
        };
        let mut reconciled = FlowLayoutArena::default();
        reconciled
            .append_reconciled_drop_caps(
                &previous,
                &ordered_geometry,
                drop_cap_constraint.flow_thread_id,
                Some(cap),
            )
            .unwrap();
        assert_eq!(
            reconciled
                .drop_caps
                .iter()
                .map(|cap| cap.line.flow_thread_id)
                .collect::<Vec<_>>(),
            [1, 2],
        );
    }

    #[test]
    fn layout_run_extents_cover_partial_geometry_runs() {
        let base = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut larger = base;
        larger.font_size = 20.0;
        let mut tight = larger;
        tight.has_line_height = true;
        tight.line_height = 0.7;
        let mut shifted = tight;
        shifted.baseline_shift = 3.0;
        let values = [base, larger, tight, shifted];
        let styles: [StyleSegment; 4] = core::array::from_fn(|index| StyleSegment {
            text_start: (index * 2) as u32,
            text_end: (index * 2 + 2) as u32,
            style: values[index],
        });
        let runs: [ShapingRun; 4] = core::array::from_fn(|index| ShapingRun {
            text_start: (index * 2) as u32,
            text_end: (index * 2 + 2) as u32,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style: values[index],
        });
        let clusters = retained_clusters(
            "abcdefgh",
            &styles,
            &runs,
            &[(0, 9, 0, 2), (1, 9, 2, 4), (2, 9, 4, 6), (3, 9, 6, 8)],
        );
        let line = composed_range(1, 7);

        assert_eq!(clusters.layout_runs().len(), 4);
        assert_eq!(
            retained_range_extents(&clusters, &styles, line),
            scalar_range_extents(&clusters, &styles, line)
        );
    }

    #[test]
    fn layout_run_extents_preserve_hard_break_and_empty_line_behavior() {
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 5,
            style,
        }];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 2,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 3,
                text_end: 5,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            },
        ];
        let clusters = retained_clusters("ab\ncd", &styles, &runs, &[(0, 9, 0, 2), (1, 9, 3, 5)]);

        for line in [composed_range(0, 5), composed_range(3, 3)] {
            assert_eq!(
                retained_range_extents(&clusters, &styles, line),
                scalar_range_extents(&clusters, &styles, line)
            );
        }
        assert_eq!(clusters.layout_runs().len(), 3);
    }

    #[test]
    fn dense_cjk_extents_visit_one_layout_run() {
        const COUNT: usize = 4_096;
        let text = "界".repeat(COUNT);
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: COUNT as u32,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: COUNT as u32,
            script: u32::from_be_bytes(*b"Hani"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let clusters = retained_clusters(&text, &styles, &runs, &[(0, 9, 0, COUNT as u32)]);
        let calls = Cell::new(0usize);
        let mut actual = LineExtents::default();
        include_range_extents(
            &mut actual,
            &clusters,
            &styles,
            composed_range(127, 4_000),
            |handle| {
                calls.set(calls.get() + 1);
                fixture_metrics(handle)
            },
            |_| Some(1),
        )
        .unwrap();

        assert_eq!(clusters.layout_runs().len(), 1);
        assert_eq!(
            actual,
            scalar_range_extents(&clusters, &styles, composed_range(127, 4_000))
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn one_update_flows_fragments_around_a_hole_and_retries_for_tall_text() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![2.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0, 0, 1, 1],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        });
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 2,
                style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
            },
            StyleSegment {
                text_start: 2,
                text_end: 4,
                style: ResolvedStyle::test_typography(20.0, 0.0, 0.0),
            },
        ];
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: region(),
                vertex_start: 0,
            }],
            exclusions: vec![RetainedExclusion {
                record: exclusion(),
                vertex_start: 0,
            }],
            vertices: vec![],
        };
        let mut layout = FlowLayoutArena::default();
        let mut slots = InlineSlotArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut slots,
                8,
                4,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        x_height: 500,
                        height_fallbacks: 0,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.fragments.len(), 2);
        assert_eq!(layout.lines[0].height, 20.0);
        assert_eq!(layout.lines[0].baseline, 16.0);
        assert_eq!(layout.lines[0].fragment_count, 2);
        assert_eq!(layout.fragments[0].slot_start, 0.0);
        assert_eq!(layout.fragments[0].slot_end, 4.0);
        assert_eq!(layout.fragments[0].line.cluster_end, 2);
        assert_eq!(layout.fragments[1].slot_start, 6.0);
        assert_eq!(layout.fragments[1].line.cluster_end, 4);
    }

    /// A hole from 4 to 6 leaves two slots, 0..4 and 6..10, and four clusters of advance 2
    /// fill them two apiece. Reading order is the paragraph's: a left-to-right paragraph
    /// begins in the left slot and a right-to-left one in the right slot, whatever the
    /// direction of the text inside it. Each line asks the paragraph it begins in.
    #[test]
    fn a_line_fills_the_slots_around_a_hole_in_its_paragraphs_reading_order() {
        fn slots_in_reading_order(bidi: &BidiAnalysis) -> Vec<(f64, f64, u32, u32)> {
            // Eight clusters in two paragraphs of four; the fourth is a hard break.
            let mut flags = vec![CLUSTER_SAFE_BEFORE; 8];
            flags[3] |= CLUSTER_HARD_BREAK | super::super::cluster_state::CLUSTER_REQUIRED_BREAK;
            let mut advances = vec![2.0; 8];
            advances[3] = 0.0;
            let clusters = quantized(ClusterArena {
                starts: (0..8).collect(),
                ends: (1..=8).collect(),
                advances,
                flags,
                style_indexes: vec![0; 8],
                source_runs: vec![0; 8],
                font_handles: vec![1; 8],
                index_at: (0..=8).collect(),
                ..ClusterArena::default()
            });
            let styles = [uniform_style(8)];
            let geometry = FlowGeometryArena {
                constraints: vec![constraint()],
                regions: vec![RetainedRegion {
                    record: region(),
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record: exclusion(),
                    vertex_start: 0,
                }],
                vertices: vec![],
            };
            let mut layout = FlowLayoutArena::default();
            layout
                .build_with_drop_cap_context(
                    None,
                    &geometry,
                    &clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    bidi,
                    8,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut super::super::line_composition::NoCorrections,
                )
                .unwrap();
            assert_eq!(
                layout
                    .lines
                    .iter()
                    .map(|line| line.fragment_count)
                    .collect::<Vec<_>>(),
                [2, 2]
            );
            layout
                .fragments
                .iter()
                .map(|fragment| {
                    (
                        fragment.slot_start,
                        fragment.slot_end,
                        fragment.line.cluster_start,
                        fragment.line.cluster_end,
                    )
                })
                .collect()
        }
        let paragraphs = |levels: [u8; 2]| BidiAnalysis {
            paragraph_starts: vec![0, 4],
            paragraph_ends: vec![4, 8],
            paragraph_levels: levels.to_vec(),
            ..BidiAnalysis::default()
        };
        let (left, right) = ((0.0, 4.0), (6.0, 10.0));
        let line = |first: (f64, f64), second: (f64, f64), start: u32, middle: u32, end: u32| {
            [
                (first.0, first.1, start, middle),
                (second.0, second.1, middle, end),
            ]
        };
        // The first paragraph's line holds clusters 0..2 and 2..4, ending at the break; the
        // second paragraph's holds 4..6 and 6..8.
        assert_eq!(
            slots_in_reading_order(&paragraphs([0, 0])),
            [line(left, right, 0, 2, 4), line(left, right, 4, 6, 8)].concat()
        );
        assert_eq!(
            slots_in_reading_order(&paragraphs([1, 1])),
            [line(right, left, 0, 2, 4), line(right, left, 4, 6, 8)].concat()
        );
        assert_eq!(
            slots_in_reading_order(&paragraphs([0, 1])),
            [line(left, right, 0, 2, 4), line(right, left, 4, 6, 8)].concat()
        );
        assert_eq!(
            slots_in_reading_order(&paragraphs([1, 0])),
            [line(right, left, 0, 2, 4), line(left, right, 4, 6, 8)].concat()
        );
    }

    #[test]
    fn space_before_shifts_the_first_line_and_never_repeats_on_resume() {
        let clusters = uniform_clusters(4, 1.0);
        let styles = [uniform_style(4)];
        let mut spaced = constraint();
        spaced.space_before = 7.0;
        let geometry = plain_geometry(spaced);
        let layout = composed(&geometry, &clusters, &styles);
        assert_eq!(layout.lines[0].block_start, 7.0);

        let mut resumed = spaced;
        resumed.resume_cluster = 2;
        let resumed_layout = composed(&plain_geometry(resumed), &clusters, &styles);
        assert_eq!(resumed_layout.lines[0].block_start, 0.0);
    }

    #[test]
    fn first_line_indent_narrows_only_the_paragraph_first_line() {
        let clusters = uniform_clusters(10, 1.0);
        let styles = [uniform_style(10)];
        let mut indented = constraint();
        indented.first_line_indent = 4.0;
        indented.wrap = WRAP_CHARACTER;
        // The slot is 10 wide (region minus no exclusions): the first line takes
        // 10 - 4 = 6 clusters, the second line the remaining 4.
        let geometry = plain_geometry(indented);
        let layout = composed(&geometry, &clusters, &styles);
        assert_eq!(layout.lines.len(), 2);
        assert_eq!(layout.fragments[0].line.cluster_end, 6);
        assert_eq!(layout.fragments[1].line.cluster_end, 10);
    }

    #[test]
    fn flexible_inline_end_updates_shared_multileaf_storage_in_one_ordered_walk() {
        let mut lines = Vec::new();
        let mut fragments = Vec::new();
        for index in 0..257u32 {
            lines.push(FlowLine {
                flow_thread_id: 1,
                region_id: 7,
                transform_index: 0,
                clip_id: 0,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: f64::from(index),
                baseline: 1.0,
                height: 1.0,
                typography: LineTypography::default(),
            });
            fragments.push(FlowFragment {
                line: ComposedLine {
                    advance: f64::from(index % 11 + 1),
                    ..composed_range(index, index + 1)
                },
                slot_start: 0.0,
                slot_end: 100.0,
                flexible_end: true,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            });
        }
        let committed_fragments = RetainedRope::from(fragments.clone());
        let mut layout = FlowLayoutArena {
            lines: RetainedRope::from(lines),
            fragments: committed_fragments.clone(),
            ..FlowLayoutArena::default()
        };

        crate::engine::retained_rope::reset_work_counters();
        assert_eq!(
            layout.resolve_flexible_inline_end(1, 0.0, None),
            Ok(Some(11.0))
        );
        let (traversals, leaf_visits, record_visits) =
            crate::engine::retained_rope::ordered_work_counters();
        assert_eq!(crate::engine::retained_rope::index_lookups(), 0);
        assert_eq!(traversals, 1);
        assert_eq!(record_visits, fragments.len());
        assert!(leaf_visits < record_visits / 4);
        assert_eq!(committed_fragments, RetainedRope::from(fragments));
        assert!(
            layout
                .fragments
                .iter()
                .all(|fragment| fragment.slot_end == 11.0)
        );
    }

    #[test]
    fn safety_limits_do_not_preallocate_their_full_bound() {
        let clusters = uniform_clusters(8, 1.0);
        let styles = [uniform_style(8)];
        let geometry = plain_geometry(constraint());
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                65_536,
                8,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        x_height: 500,
                        height_fallbacks: 0,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();

        assert!(layout.lines.retained_capacity() < 64);
        assert!(layout.fragments.retained_capacity() < 64);
        assert!(layout.ellipsis_threads.capacity() < 64);
    }

    fn uniform_clusters(count: usize, advance: f64) -> ClusterArena {
        quantized(ClusterArena {
            starts: (0..count as u32).collect(),
            ends: (1..=count as u32).collect(),
            advances: vec![advance; count],
            flags: vec![CLUSTER_SAFE_BEFORE; count],
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            font_handles: vec![1; count],
            index_at: (0..=count as u32).collect(),
            ..ClusterArena::default()
        })
    }

    /// Mirrors the production build-path invariant for literal test arenas: every
    /// consumer of the integer fit sees an F16.16 stream coherent with the f64
    /// advances under the rounding contract.
    fn quantized(mut clusters: ClusterArena) -> ClusterArena {
        let count = clusters.starts.len();
        if clusters.source_runs.len() == count && clusters.font_handles.len() == count {
            if clusters.glyph_starts.is_empty() {
                clusters.glyph_starts.resize(count, 0);
                clusters.glyph_counts.resize(count, 0);
            }
            clusters.rebuild_layout_runs().unwrap();
        }
        clusters.refresh_layout_units().unwrap();
        clusters
    }

    fn uniform_style(text_end: u32) -> StyleSegment {
        StyleSegment {
            text_start: 0,
            text_end,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }
    }

    #[test]
    fn explicit_line_height_uses_the_stack_primary_and_publishes_tight_flow() {
        let clusters = quantized(ClusterArena {
            starts: vec![0],
            ends: vec![1],
            advances: vec![1.0],
            flags: vec![CLUSTER_SAFE_BEFORE],
            style_indexes: vec![0],
            source_runs: vec![0],
            // The fallback face that drew this cluster has deliberately taller metrics.
            font_handles: vec![2],
            index_at: vec![0, 1],
            ..ClusterArena::default()
        });
        let mut style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        style.font_stack_handle = 7;
        style.has_line_height = true;
        style.line_height = 0.92;
        let metrics = |handle| match handle {
            1 => Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 360,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            }),
            2 => panic!("selected fallback metrics must not determine the line box"),
            _ => None,
        };
        let primary_font = |stack| (stack == 7).then_some(1);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 1,
            style,
        }];
        let extents = extents_for_cluster(&clusters, &styles, 0, metrics, primary_font).unwrap();
        assert!((extents.height() - 9.2).abs() < 1e-5);
        assert!((extents.above - 7.6).abs() < 1e-5);
        assert!((extents.below - 1.6).abs() < 1e-5);

        let mut tight_style = style;
        tight_style.line_height = 0.5;
        let tight_styles = [StyleSegment {
            text_start: 0,
            text_end: 1,
            style: tight_style,
        }];
        let tight =
            extents_for_cluster(&clusters, &tight_styles, 0, metrics, primary_font).unwrap();
        assert!((tight.height() - 5.0).abs() < 1e-5);
        assert!((tight.above - 5.5).abs() < 1e-5);
        assert!((tight.below + 0.5).abs() < 1e-5);

        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &plain_geometry(constraint()),
                &clusters,
                &tight_styles,
                &mut InlineSlotArena::default(),
                8,
                4,
                metrics,
                primary_font,
            )
            .unwrap();

        assert_eq!(layout.lines.len(), 1);
        assert_eq!(layout.lines[0].baseline, 5.5);
        assert_eq!(layout.lines[0].height, 5.0);
    }

    fn plain_geometry(constraint: FlowConstraint) -> FlowGeometryArena {
        let mut record = region();
        record.exclusion_count = 0;
        record.inline_end = 10.0;
        record.block_end = 100.0;
        record.clip_inline_end = 10.0;
        record.clip_block_end = 100.0;
        FlowGeometryArena {
            constraints: vec![constraint],
            regions: vec![RetainedRegion {
                record,
                vertex_start: 0,
            }],
            exclusions: vec![],
            vertices: vec![],
        }
    }

    fn composed(
        geometry: &FlowGeometryArena,
        clusters: &ClusterArena,
        styles: &[StyleSegment],
    ) -> FlowLayoutArena {
        let mut layout = FlowLayoutArena::default();
        let mut slots = InlineSlotArena::default();
        layout
            .build(
                geometry,
                clusters,
                styles,
                &mut slots,
                8,
                4,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        x_height: 500,
                        height_fallbacks: 0,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        layout
    }

    /// A text with no cluster is one paragraph and so one line; each hard break ends a line
    /// and the paragraph after the last one is a line too. None of these lines has a glyph,
    /// so each is zero wide and takes its box from the authored face: at size 10 an ascender
    /// of 800 and a descender of 200 in a 1000-unit em are a baseline at 8 and a height of 10.
    #[test]
    fn empty_text_and_newline_only_text_compose_empty_lines_with_the_font_strut() {
        /// A line's block start, baseline and height.
        type LineBox = (f64, f64, f64);
        /// A line's cluster range, its text range, and whether a hard break ends it.
        type LineSpan = (u32, u32, u32, u32, bool);
        fn lines_of(hard_breaks: u32) -> (Vec<LineBox>, Vec<LineSpan>) {
            let count = hard_breaks as usize;
            let clusters = quantized(ClusterArena {
                starts: (0..hard_breaks).collect(),
                ends: (1..=hard_breaks).collect(),
                advances: vec![0.0; count],
                flags: vec![
                    CLUSTER_HARD_BREAK | super::super::cluster_state::CLUSTER_REQUIRED_BREAK;
                    count
                ],
                style_indexes: vec![0; count],
                source_runs: vec![0; count],
                font_handles: vec![1; count],
                index_at: (0..=hard_breaks).collect(),
                ..ClusterArena::default()
            });
            let layout = composed(
                &plain_geometry(constraint()),
                &clusters,
                &[uniform_style(hard_breaks)],
            );
            assert!(
                layout.fragments.iter().all(|fragment| {
                    fragment.line.advance == 0.0
                        && fragment.line.hung_advance == 0.0
                        && fragment.slot_start == 0.0
                        && fragment.slot_end == 10.0
                }),
                "an empty line is zero wide in the whole slot"
            );
            assert!(layout.lines.iter().all(|line| line.fragment_count == 1));
            (
                layout
                    .lines
                    .iter()
                    .map(|line| (line.block_start, line.baseline, line.height))
                    .collect(),
                layout
                    .fragments
                    .iter()
                    .map(|fragment| {
                        (
                            fragment.line.cluster_start,
                            fragment.line.cluster_end,
                            fragment.line.text_start,
                            fragment.line.text_end,
                            fragment.line.hard_break,
                        )
                    })
                    .collect(),
            )
        }
        // "": one line.
        assert_eq!(
            lines_of(0),
            (vec![(0.0, 8.0, 10.0)], vec![(0, 0, 0, 0, false)])
        );
        // "\n": the line the break ends, and the empty paragraph after it.
        assert_eq!(
            lines_of(1),
            (
                vec![(0.0, 8.0, 10.0), (10.0, 8.0, 10.0)],
                vec![(0, 1, 0, 0, true), (1, 1, 1, 1, false)]
            )
        );
        // "\n\n": three.
        assert_eq!(
            lines_of(2),
            (
                vec![(0.0, 8.0, 10.0), (10.0, 8.0, 10.0), (20.0, 8.0, 10.0)],
                vec![(0, 1, 0, 0, true), (1, 2, 1, 1, true), (2, 2, 2, 2, false)]
            )
        );
    }

    #[test]
    fn overflowing_text_continues_through_ordered_regions_without_balancing() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            style_indexes: vec![0; 4],
            source_runs: vec![0; 4],
            font_handles: vec![1; 4],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut first = region();
        first.id = 1;
        first.inline_end = 4.0;
        first.clip_inline_end = 4.0;
        first.block_end = 10.0;
        first.clip_block_end = 10.0;
        first.exclusion_count = 0;
        let mut second = first;
        second.id = 2;
        second.block_end = 30.0;
        second.clip_block_end = 30.0;
        let mut flow = constraint();
        flow.region_count = 2;
        let geometry = FlowGeometryArena {
            constraints: vec![flow],
            regions: vec![
                RetainedRegion {
                    record: first,
                    vertex_start: 0,
                },
                RetainedRegion {
                    record: second,
                    vertex_start: 0,
                },
            ],
            exclusions: vec![],
            vertices: vec![],
        };
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                2,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        x_height: 500,
                        height_fallbacks: 0,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(
            layout
                .lines
                .iter()
                .map(|line| line.region_id)
                .collect::<Vec<_>>(),
            [1, 2, 2, 2]
        );
        assert_eq!(
            layout
                .fragments
                .iter()
                .next_back()
                .unwrap()
                .line
                .cluster_end,
            4
        );
    }

    #[test]
    fn only_clip_overflow_assigns_a_clip_id_to_lines() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![2.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE; 3],
            style_indexes: vec![0; 3],
            source_runs: vec![0; 3],
            font_handles: vec![1; 3],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };

        for (overflow, expected_clip_id) in [
            (OVERFLOW_VISIBLE, 0),
            (OVERFLOW_ELLIPSIS, 0),
            (OVERFLOW_CLIP, 7),
        ] {
            let mut flow = constraint();
            flow.overflow = overflow;
            let mut flow_region = region();
            flow_region.exclusion_count = 0;
            let geometry = FlowGeometryArena {
                constraints: vec![flow],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                ..FlowGeometryArena::default()
            };
            let mut layout = FlowLayoutArena::default();
            layout
                .build(
                    &geometry,
                    &clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                )
                .unwrap();
            assert_eq!(layout.lines[0].clip_id, expected_clip_id);
        }
    }

    #[test]
    fn localized_edit_recomposes_one_line_and_reuses_converged_prefix_and_suffix() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: vec![0, 1, 2, 3, 4, 5],
                ends: vec![1, 2, 3, 4, 5, 6],
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 6],
                style_indexes: vec![0; 6],
                source_runs: vec![0; 6],
                font_handles: vec![1; 6],
                stable_ids: vec![1, 2, 3, 4, 5, 6],
                index_at: vec![0, 1, 2, 3, 4, 5, 6],
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 6]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 1.0, 2.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 6,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 4.0;
        narrow_region.clip_inline_end = 4.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let retained_prefix = previous.fragments[0];
        let retained_suffix = previous.fragments[2];
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(2..3),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert_eq!(changed.lines.len(), 3);
        assert_eq!(changed.fragments[0], retained_prefix);
        assert_eq!(changed.fragments[1].line.advance, 3.0);
        assert_eq!(changed.fragments[2], retained_suffix);

        // Change only the primary face's cap/x references on the middle line. Its line box and
        // baseline remain identical, so retained convergence must still publish fresh references.
        let mut reference_clusters = make_clusters(vec![2.0, 2.0, 1.0, 2.0, 2.0, 2.0]);
        reference_clusters.style_indexes[2] = 1;
        reference_clusters.style_indexes[3] = 1;
        reference_clusters.style_indexes[4] = 2;
        reference_clusters.style_indexes[5] = 2;
        let mut alternate_style = styles[0].style;
        alternate_style.font_stack_handle = 2;
        let reference_styles = [
            StyleSegment {
                text_start: 0,
                text_end: 2,
                style: styles[0].style,
            },
            StyleSegment {
                text_start: 2,
                text_end: 4,
                style: alternate_style,
            },
            StyleSegment {
                text_start: 4,
                text_end: 6,
                style: styles[0].style,
            },
        ];
        let reference_metrics = |font_handle| {
            metrics(font_handle).map(|mut value| {
                if font_handle == 2 {
                    value.cap_height = 600;
                    value.x_height = 400;
                    value.height_fallbacks = 3;
                }
                value
            })
        };
        let first_font = |stack| Some(if stack == 2 { 2 } else { 1 });
        let mut cold = FlowLayoutArena::default();
        cold.build(
            &geometry,
            &reference_clusters,
            &reference_styles,
            &mut InlineSlotArena::default(),
            8,
            1,
            reference_metrics,
            first_font,
        )
        .unwrap();
        let mut incremental = FlowLayoutArena::default();
        assert!(
            incremental
                .rebuild_until_state_converges(
                    &changed,
                    &geometry,
                    &changed_clusters,
                    &reference_clusters,
                    &[],
                    &reference_styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(2..3),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    8,
                    1,
                    reference_metrics,
                    first_font,
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let cold_lines: Vec<_> = cold.lines.iter().copied().collect();
        let incremental_lines: Vec<_> = incremental.lines.iter().copied().collect();
        assert_eq!(incremental_lines, cold_lines);
        assert_eq!(incremental_lines[1].height, changed.lines[1].height);
        assert_eq!(incremental_lines[1].baseline, changed.lines[1].baseline);
        assert_eq!(incremental_lines[1].typography.cap_height, 6.0);
        assert_eq!(incremental_lines[1].typography.x_height, 4.0);
        assert_eq!(incremental_lines[1].typography.height_fallbacks, 3);
        assert_eq!(incremental.fragments[2], retained_suffix);
    }

    #[test]
    fn localized_edit_splices_a_long_suffix_without_walking_or_copying_its_records() {
        let previous_clusters = uniform_clusters(8_192, 1.0);
        let mut changed_clusters = uniform_clusters(8_192, 1.0);
        changed_clusters.advances[4] = 0.75;
        changed_clusters.refresh_layout_units().unwrap();
        let styles = [uniform_style(8_192)];
        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 2_048;
        let mut flow_region = region();
        flow_region.inline_end = 8.0;
        flow_region.clip_inline_end = 8.0;
        flow_region.block_end = 20_000.0;
        flow_region.clip_block_end = 20_000.0;
        flow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: flow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build(
                &geometry,
                clusters,
                &styles,
                &mut InlineSlotArena::default(),
                2_048,
                1,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_clusters);
        let cold = build(&changed_clusters);
        assert!(previous.lines.len() > 1_000);

        crate::engine::retained_rope::reset_work_counters();
        let mut incremental = FlowLayoutArena::default();
        assert!(
            incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(4..5),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    2_048,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let (copied_records, source_records_visited) =
            crate::engine::retained_rope::work_counters();
        let index_lookups = crate::engine::retained_rope::index_lookups();
        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(
            incremental.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(0..1)))
        );
        assert!(
            copied_records < previous.lines.len() / 4,
            "copied {copied_records} records for {} retained lines",
            previous.lines.len()
        );
        assert!(
            source_records_visited <= 32,
            "visited {source_records_visited} source fragments"
        );
        assert!(
            index_lookups <= 32,
            "performed {index_lookups} root index lookups"
        );
    }

    #[test]
    fn scattered_edits_reconverge_between_islands_and_retain_middle_chunks() {
        let previous_clusters = uniform_clusters(8_192, 1.0);
        let mut changed_clusters = uniform_clusters(8_192, 1.0);
        let edited = [4usize, 4_096, 8_004];
        for cluster in edited {
            changed_clusters.advances[cluster] = 0.75;
        }
        changed_clusters.refresh_layout_units().unwrap();
        let styles = [uniform_style(8_192)];
        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 2_048;
        let mut flow_region = region();
        flow_region.inline_end = 8.0;
        flow_region.clip_inline_end = 8.0;
        flow_region.block_end = 20_000.0;
        flow_region.clip_block_end = 20_000.0;
        flow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: flow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build(
                &geometry,
                clusters,
                &styles,
                &mut InlineSlotArena::default(),
                2_048,
                1,
                fixture_metrics,
                |_| Some(1),
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_clusters);
        let cold = build(&changed_clusters);
        crate::engine::retained_rope::reset_work_counters();
        let mut incremental = FlowLayoutArena::default();
        assert!(
            incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    edited.map(|cluster| {
                        let start = u32::try_from(cluster).unwrap();
                        start..start + 1
                    }),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    2_048,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let (copied_records, source_records_visited) =
            crate::engine::retained_rope::work_counters();
        let index_lookups = crate::engine::retained_rope::index_lookups();
        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        let ranges = incremental.recomposed_line_ranges().unwrap();
        assert_eq!(ranges.len(), 3);
        assert!(ranges.windows(2).all(|pair| pair[0].end < pair[1].start));
        assert!(ranges.iter().map(|range| range.len()).sum::<usize>() < previous.lines.len() / 8);
        let capacity = incremental.recomposed_lines.capacity();
        incremental.clear();
        assert!(incremental.recomposed_line_ranges().is_none());
        assert_eq!(incremental.recomposed_lines.capacity(), capacity);

        assert!(
            copied_records <= 32 * 24,
            "copied {copied_records} records across three dirty islands"
        );
        assert!(
            source_records_visited <= edited.len() * 32,
            "visited {source_records_visited} source fragments"
        );
        assert!(
            index_lookups <= edited.len() * 32,
            "performed {index_lookups} root index lookups across three dirty islands"
        );
    }

    #[test]
    fn seeded_unicode_and_hard_break_edits_match_complete_recomposition() {
        let make_clusters = |seed: u32| {
            let mut starts = Vec::new();
            let mut ends = Vec::new();
            let mut advances = Vec::new();
            let mut flags = Vec::new();
            let mut offset = 0u32;
            for cluster in 0..256u32 {
                starts.push(offset);
                let units = if cluster % 17 == 0 || cluster % 23 == 0 {
                    2
                } else {
                    1
                };
                offset += units;
                ends.push(offset);
                let hard_break = cluster % 31 == 30;
                advances.push(if hard_break {
                    0.0
                } else {
                    0.75 + f64::from((cluster.wrapping_add(seed)) % 5) * 0.25
                });
                flags.push(CLUSTER_SAFE_BEFORE | if hard_break { CLUSTER_HARD_BREAK } else { 0 });
            }
            let mut index_at = vec![0u32; usize::try_from(offset).unwrap() + 1];
            for (cluster, (&start, &end)) in starts.iter().zip(&ends).enumerate() {
                for text_offset in start..end {
                    index_at[usize::try_from(text_offset).unwrap()] =
                        u32::try_from(cluster).unwrap();
                }
                index_at[usize::try_from(end).unwrap()] = u32::try_from(cluster + 1).unwrap();
            }
            quantized(ClusterArena {
                starts,
                ends,
                advances,
                flags,
                style_indexes: vec![0; 256],
                source_runs: vec![0; 256],
                font_handles: vec![1; 256],
                stable_ids: (1..=256).collect(),
                index_at,
                ..ClusterArena::default()
            })
        };
        let mut reused = 0usize;
        let mut seed = 0x91e1_0da5u32;
        for case in 0..64u32 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let previous_clusters = make_clusters(case);
            let mut changed_clusters = make_clusters(case);
            let styles = [uniform_style(
                previous_clusters.ends.last().copied().unwrap_or_default(),
            )];
            let first = usize::try_from(seed % 180 + 8).unwrap();
            let last = (first + usize::try_from((seed >> 24) % 48).unwrap()).min(247);
            changed_clusters.advances[first] += 0.25;
            changed_clusters.advances[last] = (changed_clusters.advances[last] - 0.25).max(0.0);
            if case % 7 == 0 {
                changed_clusters.flags[last] ^= CLUSTER_HARD_BREAK;
            }
            changed_clusters.refresh_layout_units().unwrap();

            let mut flow_constraint = constraint();
            flow_constraint.max_lines = 512;
            let mut flow_region = region();
            flow_region.inline_end = 7.0 + (case % 5) as f32;
            flow_region.clip_inline_end = flow_region.inline_end;
            flow_region.block_end = 5_000.0;
            flow_region.clip_block_end = 5_000.0;
            flow_region.exclusion_count = 0;
            let geometry = FlowGeometryArena {
                constraints: vec![flow_constraint],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                ..FlowGeometryArena::default()
            };
            let build = |clusters: &ClusterArena| {
                let mut flow = FlowLayoutArena::default();
                flow.build(
                    &geometry,
                    clusters,
                    &styles,
                    &mut InlineSlotArena::default(),
                    512,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                )
                .unwrap();
                flow
            };
            let previous = build(&previous_clusters);
            let cold = build(&changed_clusters);
            let mut incremental = FlowLayoutArena::default();
            let mut dirty = Vec::with_capacity(usize::from(first != last) + 1);
            dirty.push(previous_clusters.starts[first]..previous_clusters.ends[first]);
            if first != last {
                dirty.push(previous_clusters.starts[last]..previous_clusters.ends[last]);
            }
            if incremental
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    dirty,
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    512,
                    1,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
            {
                reused += 1;
            } else {
                incremental = build(&changed_clusters);
            }
            assert_eq!(incremental.lines, cold.lines, "case {case} lines");
            assert_eq!(
                incremental.fragments, cold.fragments,
                "case {case} fragments"
            );
        }
        assert!(
            reused > 0,
            "the seeded corpus must exercise retained splicing"
        );
    }

    #[test]
    fn localized_drop_cap_source_edit_recomposes_cap_bands_and_reuses_suffix() {
        let text = "Abc def ghi jkl mno pqr";
        let text_end = u32::try_from(text.encode_utf16().count()).unwrap();
        let cap_style = ResolvedStyle::test_typography(30.0, 0.0, 0.0);
        let body_style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style: cap_style,
            },
            StyleSegment {
                text_start: 1,
                text_end,
                style: body_style,
            },
        ];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 1,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: cap_style,
            },
            ShapingRun {
                text_start: 1,
                text_end,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style: body_style,
            },
        ];
        let shaped = [(0, 9, 0, 1), (1, 9, 1, text_end)];
        let prepare_clusters = |cap_advance: i32| {
            let mut clusters = retained_clusters(text, &styles, &runs, &shaped);
            clusters.glyph_x_advances[0] = cap_advance;
            clusters.advances[0] =
                f64::from(cap_advance) * f64::from(cap_style.font_size) / 1_000.0;
            clusters
                .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                    Some(crate::FontGlyphExtents {
                        x_min: 0,
                        y_min: -200,
                        x_max: 500,
                        y_max: 800,
                    })
                })
                .unwrap();
            clusters.ensure_word_breaks().unwrap();
            clusters.ensure_placement_segment_anchors().unwrap();
            clusters
        };
        let previous_clusters = prepare_clusters(500);
        let changed_clusters = prepare_clusters(520);
        let mut flow_constraint = constraint();
        flow_constraint.drop_cap_lines = 3;
        flow_constraint.drop_cap_alignment = DROP_CAP_ALIGN_TEXT_TOP;
        flow_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        flow_constraint.drop_cap_margin_inline = 2.0;
        let mut wide_region = region();
        wide_region.inline_end = 40.0;
        wide_region.clip_inline_end = 40.0;
        wide_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![flow_constraint],
            regions: vec![RetainedRegion {
                record: wide_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let build = |clusters: &ClusterArena| {
            let mut layout = FlowLayoutArena::default();
            layout
                .build_with_drop_cap_context(
                    None,
                    &geometry,
                    clusters,
                    &runs,
                    &styles,
                    &mut InlineSlotArena::default(),
                    &BidiAnalysis::default(),
                    8,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap();
            layout
        };
        let previous = build(&previous_clusters);
        assert!(previous.lines.len() > usize::from(flow_constraint.drop_cap_lines));
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &runs,
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(0..1),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    8,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        let cold = build(&changed_clusters);
        assert_eq!(changed.lines, cold.lines);
        assert_eq!(changed.fragments, cold.fragments);
        assert_eq!(changed.drop_caps, cold.drop_caps);
        assert_eq!(
            changed.recomposed_line_ranges(),
            Some(core::slice::from_ref(
                &(0..usize::from(flow_constraint.drop_cap_lines))
            ))
        );
        let suffix_start = usize::from(flow_constraint.drop_cap_lines);
        assert!(
            changed
                .lines
                .range(suffix_start..changed.lines.len())
                .unwrap()
                .iter()
                .eq(previous
                    .lines
                    .range(suffix_start..previous.lines.len())
                    .unwrap()
                    .iter())
        );
    }

    #[test]
    fn localized_edit_recomposes_multiple_lines_until_cursor_state_converges() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: (0..9).collect(),
                ends: (1..10).collect(),
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 9],
                style_indexes: vec![0; 9],
                source_runs: vec![0; 9],
                font_handles: vec![1; 9],
                stable_ids: (1..10).collect(),
                index_at: (0..10).collect(),
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 9]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 2.0, 3.0, 3.0, 1.0, 1.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 9,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 6.0;
        narrow_region.clip_inline_end = 6.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(
            previous
                .fragments
                .iter()
                .map(|fragment| fragment.line.cluster_end)
                .collect::<Vec<_>>(),
            [3, 6, 9]
        );

        let retained_prefix = previous.fragments[0];
        let mut changed = FlowLayoutArena::default();
        assert!(
            changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(3..7),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert_eq!(changed.fragments[0], retained_prefix);
        assert_eq!(
            changed
                .fragments
                .iter()
                .map(|fragment| (fragment.line.cluster_start, fragment.line.cluster_end))
                .collect::<Vec<_>>(),
            [(0, 3), (3, 5), (5, 9)]
        );
        // The dirty range begins at an old line boundary. Rewind one line because a
        // replacement may become narrow enough to move across that boundary; the
        // continuation proof may then reconverge and retain the remaining suffix.
        assert_eq!(
            changed.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(0..3)))
        );
    }

    #[test]
    fn localized_edit_clears_partial_layout_when_line_state_does_not_converge() {
        let make_clusters = |advances: Vec<f64>| {
            quantized(ClusterArena {
                starts: vec![0, 1, 2, 3, 4, 5],
                ends: vec![1, 2, 3, 4, 5, 6],
                advances,
                flags: vec![CLUSTER_SAFE_BEFORE; 6],
                style_indexes: vec![0; 6],
                source_runs: vec![0; 6],
                font_handles: vec![1; 6],
                stable_ids: vec![1, 2, 3, 4, 5, 6],
                index_at: vec![0, 1, 2, 3, 4, 5, 6],
                ..ClusterArena::default()
            })
        };
        let previous_clusters = make_clusters(vec![2.0; 6]);
        let changed_clusters = make_clusters(vec![2.0, 2.0, 3.0, 2.0, 2.0, 2.0]);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 6,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut narrow_region = region();
        narrow_region.inline_end = 4.0;
        narrow_region.clip_inline_end = 4.0;
        narrow_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint()],
            regions: vec![RetainedRegion {
                record: narrow_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &geometry,
                &previous_clusters,
                &styles,
                &mut InlineSlotArena::default(),
                8,
                1,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let mut changed = FlowLayoutArena::default();
        assert!(
            !changed
                .rebuild_until_state_converges(
                    &previous,
                    &geometry,
                    &previous_clusters,
                    &changed_clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    core::iter::once(2..3),
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    8,
                    1,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert!(changed.lines.is_empty());
        assert!(changed.fragments.is_empty());
        assert_eq!(changed.recomposed_line_ranges(), None);
    }

    #[test]
    fn localized_exclusion_move_recomposes_through_the_dirty_band_and_matches_cold() {
        let clusters = uniform_clusters(30, 2.0);
        let styles = [uniform_style(30)];
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                cap_height: 700,
                x_height: 500,
                height_fallbacks: 0,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let geometry_at = |block_start: f32, revision: u32| {
            let mut record = exclusion();
            record.geometry_revision = revision;
            record.block_start = block_start;
            record.block_end = block_start + 10.0;
            FlowGeometryArena {
                constraints: vec![constraint()],
                regions: vec![RetainedRegion {
                    record: region(),
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record,
                    vertex_start: 0,
                }],
                vertices: vec![],
            }
        };
        let previous_geometry = geometry_at(10.0, 1);
        let next_geometry = geometry_at(20.0, 2);
        let LocalizedGeometryChange::ExclusionBand(dirty) = next_geometry
            .localized_change_from(&previous_geometry)
            .unwrap()
        else {
            panic!("moving one retained exclusion must yield one dirty band");
        };
        assert_eq!(dirty.region_id, 7);
        assert_eq!(dirty.block_start, 10.0);
        assert_eq!(dirty.block_end, 30.0);

        let mut previous = FlowLayoutArena::default();
        previous
            .build(
                &previous_geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                16,
                4,
                metrics,
                |_| Some(1),
            )
            .unwrap();
        let mut cold = FlowLayoutArena::default();
        cold.build(
            &next_geometry,
            &clusters,
            &styles,
            &mut InlineSlotArena::default(),
            16,
            4,
            metrics,
            |_| Some(1),
        )
        .unwrap();
        let retained_prefix = previous.fragments[0];
        let retained_suffix = previous
            .fragments
            .range(5..previous.fragments.len())
            .unwrap()
            .to_vec();

        let mut incremental = FlowLayoutArena::default();
        crate::engine::retained_rope::reset_work_counters();
        assert!(
            incremental
                .rebuild_after_exclusion_change_until_state_converges(
                    &previous,
                    &next_geometry,
                    &clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    dirty,
                    (&BidiAnalysis::default(), &BidiAnalysis::default()),
                    16,
                    4,
                    metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap()
        );
        assert!(
            crate::engine::retained_rope::index_lookups() <= 4,
            "exclusion convergence must carry ordered cursors instead of indexing old lines"
        );

        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(incremental.fragments[0], retained_prefix);
        assert_eq!(
            incremental
                .fragments
                .range(5..incremental.fragments.len())
                .unwrap()
                .to_vec(),
            retained_suffix
        );
        assert_eq!(
            incremental.recomposed_line_ranges(),
            Some(core::slice::from_ref(&(1..4)))
        );
    }

    /// Lines kept across a localized recomposition were composed in the old reading order.
    /// Where a band can hold several slots they are kept only while every paragraph reads
    /// the way it did; otherwise the caller composes the flow whole.
    #[test]
    fn a_changed_reading_order_recomposes_a_flow_with_exclusions_whole() {
        let clusters = uniform_clusters(30, 2.0);
        let styles = [uniform_style(30)];
        let geometry_at = |block_start: f32, revision: u32| {
            let mut record = exclusion();
            record.geometry_revision = revision;
            record.block_start = block_start;
            record.block_end = block_start + 10.0;
            FlowGeometryArena {
                constraints: vec![constraint()],
                regions: vec![RetainedRegion {
                    record: region(),
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record,
                    vertex_start: 0,
                }],
                vertices: vec![],
            }
        };
        let previous_geometry = geometry_at(10.0, 1);
        let next_geometry = geometry_at(20.0, 2);
        let LocalizedGeometryChange::ExclusionBand(dirty) = next_geometry
            .localized_change_from(&previous_geometry)
            .unwrap()
        else {
            panic!("moving one retained exclusion must yield one dirty band");
        };
        let paragraph = |level: u8| BidiAnalysis {
            paragraph_starts: vec![0],
            paragraph_ends: vec![30],
            paragraph_levels: vec![level],
            ..BidiAnalysis::default()
        };
        let cold = |geometry: &FlowGeometryArena, bidi: &BidiAnalysis| {
            let mut flow = FlowLayoutArena::default();
            flow.build_with_drop_cap_context(
                None,
                geometry,
                &clusters,
                &[],
                &styles,
                &mut InlineSlotArena::default(),
                bidi,
                16,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
            flow
        };
        let incremental = |previous: &FlowLayoutArena, bidi: (&BidiAnalysis, &BidiAnalysis)| {
            let mut flow = FlowLayoutArena::default();
            let converged = flow
                .rebuild_after_exclusion_change_until_state_converges(
                    previous,
                    &next_geometry,
                    &clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    dirty,
                    bidi,
                    16,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap();
            (converged, flow)
        };
        let (ltr, rtl) = (paragraph(0), paragraph(1));

        // Right-to-left before and after: the kept lines are right-first, as cold composes them.
        let previous = cold(&previous_geometry, &rtl);
        let (converged, flow) = incremental(&previous, (&rtl, &rtl));
        assert!(converged);
        let expected = cold(&next_geometry, &rtl);
        assert_eq!(flow.lines, expected.lines);
        assert_eq!(flow.fragments, expected.fragments);
        assert!(
            flow.fragments
                .iter()
                .any(|fragment| fragment.slot_start == 6.0 && fragment.line.cluster_start == 5),
            "the first line beside the hole begins in the right slot"
        );

        // The base direction changed under the kept lines: nothing is reused.
        let (converged, flow) = incremental(&previous, (&ltr, &rtl));
        assert!(!converged);
        assert!(flow.lines.is_empty());
        let mixed = BidiAnalysis {
            paragraph_starts: vec![0, 10],
            paragraph_ends: vec![10, 30],
            paragraph_levels: vec![1, 0],
            ..BidiAnalysis::default()
        };
        assert!(!incremental(&previous, (&mixed, &mixed)).0);
    }

    #[test]
    fn localized_exclusion_move_preserves_a_drop_cap_and_matches_cold() {
        let text = "aaaaaaaaaa\n".repeat(15);
        let text_end = u32::try_from(text.len()).unwrap();
        let style = ResolvedStyle::test_typography(2.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let mut clusters = retained_clusters(&text, &styles, &runs, &[(0, 9, 0, text_end)]);
        clusters
            .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                Some(crate::FontGlyphExtents {
                    x_min: 0,
                    y_min: -200,
                    x_max: 500,
                    y_max: 800,
                })
            })
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters.ensure_placement_segment_anchors().unwrap();

        let mut flow_constraint = constraint();
        flow_constraint.max_lines = 64;
        flow_constraint.drop_cap_lines = 3;
        flow_constraint.drop_cap_alignment = DROP_CAP_ALIGN_BASELINE;
        flow_constraint.drop_cap_side = DROP_CAP_SIDE_INLINE_START;
        flow_constraint.drop_cap_margin_inline = 0.5;
        let flow_region = region();
        let geometry_at = |block_start: f32, revision: u32| {
            let mut record = exclusion();
            record.geometry_revision = revision;
            record.block_start = block_start;
            record.block_end = block_start + 10.0;
            FlowGeometryArena {
                constraints: vec![flow_constraint],
                regions: vec![RetainedRegion {
                    record: flow_region,
                    vertex_start: 0,
                }],
                exclusions: vec![RetainedExclusion {
                    record,
                    vertex_start: 0,
                }],
                vertices: vec![],
            }
        };
        let previous_geometry = geometry_at(10.0, 1);
        let next_geometry = geometry_at(20.0, 2);
        let LocalizedGeometryChange::ExclusionBand(dirty) = next_geometry
            .localized_change_from(&previous_geometry)
            .unwrap()
        else {
            panic!("moving the retained exclusion must yield one dirty band");
        };

        let build = |geometry: &FlowGeometryArena| {
            let mut flow = FlowLayoutArena::default();
            flow.build_with_drop_cap_context(
                None,
                geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                &BidiAnalysis::default(),
                64,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
            flow
        };
        let previous = build(&previous_geometry);
        let cold = build(&next_geometry);
        let mut incremental = FlowLayoutArena::default();
        let retained = incremental
            .rebuild_after_exclusion_change_until_state_converges(
                &previous,
                &next_geometry,
                &clusters,
                &runs,
                &styles,
                &mut InlineSlotArena::default(),
                dirty,
                (&BidiAnalysis::default(), &BidiAnalysis::default()),
                64,
                4,
                fixture_metrics,
                |_| Some(1),
                &mut NoCorrections,
            )
            .unwrap();
        assert!(
            retained,
            "the moved exclusion must converge past its dirty band"
        );

        assert_eq!(incremental.lines, cold.lines);
        assert_eq!(incremental.fragments, cold.fragments);
        assert_eq!(incremental.drop_caps, cold.drop_caps);
        assert!(incremental.recomposed_line_ranges().is_some());
    }

    #[test]
    fn ellipsis_truncation_reuses_the_final_slot_and_removes_only_required_clusters() {
        // Three clusters of advance 3; the third is the space the fitted line hung, so the
        // line is charged 6 for all three. With a marker costing 5 in a slot of 10 the whole
        // line would be 9 + 5, without the space 6 + 5, and one cluster and the marker fit
        // at 3 + 5 = 8.
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![3.0; 4],
            flags: vec![CLUSTER_SAFE_BEFORE; 4],
            ..ClusterArena::default()
        });
        let line = |hung_advance: f64, slot_end: f64| FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 1,
                transform_index: 0,
                clip_id: 1,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 3,
                    text_start: 0,
                    text_end: 3,
                    advance: 9.0 - hung_advance,
                    hung_advance,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let truncated = |mut layout: FlowLayoutArena| {
            let target = layout
                .truncate_for_ellipsis(7, &clusters, |cluster_end, _| {
                    Ok(EllipsisReplacement {
                        cluster_start: cluster_end,
                        advance_adjustment: 5.0,
                    })
                })
                .unwrap()
                .unwrap();
            assert_eq!(target.line_cluster_start, 0);
            assert_eq!(target.boundary_cluster_start, target.cluster_end);
            assert_eq!(layout.fragments[0].line.cluster_end, target.cluster_end);
            assert_eq!(layout.fragments[0].line.text_end, target.text_end);
            assert_eq!(
                layout.fragments[0].line.hung_advance, 0.0,
                "the ellipsis terminates the line, so nothing hangs off its end",
            );
            (target.cluster_end, layout.fragments[0].line.advance)
        };
        assert_eq!(truncated(line(3.0, 10.0)), (1, 8.0));
        // The space is charged whether or not the fit hung it.
        assert_eq!(truncated(line(0.0, 10.0)), (1, 8.0));
        // A slot of 11 holds two clusters and the marker, and still not the space.
        assert_eq!(truncated(line(3.0, 11.0)), (2, 11.0));
        // A slot of 14 holds the space too, drawn ahead of the marker and charged for.
        assert_eq!(truncated(line(3.0, 14.0)), (3, 14.0));
    }

    #[test]
    fn complete_no_wrap_line_still_requests_ellipsis_when_its_slot_overflows() {
        let clusters = quantized(ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![3.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE; 3],
            style_indexes: vec![0; 3],
            source_runs: vec![0; 3],
            font_handles: vec![1; 3],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        });
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        let mut constraint = constraint();
        constraint.overflow = OVERFLOW_ELLIPSIS;
        constraint.wrap = WRAP_NONE;
        let mut constrained_region = region();
        constrained_region.inline_end = 4.0;
        constrained_region.clip_inline_end = 4.0;
        constrained_region.exclusion_count = 0;
        let geometry = FlowGeometryArena {
            constraints: vec![constraint],
            regions: vec![RetainedRegion {
                record: constrained_region,
                vertex_start: 0,
            }],
            ..FlowGeometryArena::default()
        };
        let mut layout = FlowLayoutArena::default();
        layout
            .build(
                &geometry,
                &clusters,
                &styles,
                &mut InlineSlotArena::default(),
                4,
                1,
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        cap_height: 700,
                        x_height: 500,
                        height_fallbacks: 0,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
                |_| Some(1),
            )
            .unwrap();
        assert_eq!(layout.fragments[0].line.cluster_end, 3);
        assert_eq!(layout.lines[0].clip_id, 0);
        assert_eq!(layout.ellipsis_threads(), [constraint.flow_thread_id]);
    }

    /// One cluster per character at advance 1: a space is a soft break that hangs, a newline
    /// a hard break.
    fn prose_clusters(text: &str) -> ClusterArena {
        use crate::engine::cluster_state::{
            CLUSTER_ALLOWED_BREAK, CLUSTER_HARD_BREAK, CLUSTER_REQUIRED_BREAK, CLUSTER_SPACE,
        };
        let count = text.len();
        let mut clusters = quantized(ClusterArena {
            starts: (0..count as u32).collect(),
            ends: (1..=count as u32).collect(),
            advances: text
                .bytes()
                .map(|byte| if byte == b'\n' { 0.0 } else { 1.0 })
                .collect(),
            flags: text
                .bytes()
                .map(|byte| match byte {
                    b' ' => CLUSTER_SAFE_BEFORE | CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK,
                    b'\n' => CLUSTER_SAFE_BEFORE | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK,
                    _ => CLUSTER_SAFE_BEFORE,
                })
                .collect(),
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            font_handles: vec![1; count],
            index_at: (0..=count as u32).collect(),
            ..ClusterArena::default()
        });
        clusters.ensure_word_breaks().unwrap();
        clusters
    }

    /// A width change reuses every line whose fit the new measure cannot change, runs the
    /// fitter for the rest, and composes exactly the flow a build without the old one does.
    #[test]
    fn a_width_change_reuses_the_fits_it_cannot_change_and_matches_a_whole_build() {
        use crate::engine::{frame::WRAP_WORD, line_composition::fits_run};
        let text = "aaaa bbb cc dddd eee ff\nggg hhhh ii jjj kkkk l mm\nnnn ooo pppp qq rrr ssss tt uuu\n\nvv wwww xxx yy zzzz\n";
        let clusters = prose_clusters(text);
        let styles = [uniform_style(text.len() as u32)];
        let build = |width: f32, wrap: u8, previous: Option<&FlowLayoutArena>| {
            let mut geometry = plain_geometry(FlowConstraint {
                width,
                height: 1_000.0,
                viewport_block_end: 1_000.0,
                max_lines: 0,
                wrap,
                ..constraint()
            });
            let region = &mut geometry.regions[0].record;
            (region.inline_end, region.clip_inline_end) = (width, width);
            (region.block_end, region.clip_block_end) = (1_000.0, 1_000.0);
            let mut layout = FlowLayoutArena::default();
            let fits = fits_run();
            layout
                .build_with_drop_cap_context(
                    previous,
                    &geometry,
                    &clusters,
                    &[],
                    &styles,
                    &mut InlineSlotArena::default(),
                    &BidiAnalysis::default(),
                    64,
                    4,
                    fixture_metrics,
                    |_| Some(1),
                    &mut NoCorrections,
                )
                .unwrap();
            (layout, fits_run() - fits)
        };
        for wrap in [WRAP_WORD, WRAP_CHARACTER] {
            let (mut previous, _) = build(12.0, wrap, None);
            let mut reused = 0_usize;
            for width in [
                12.5, 12.0, 11.0, 10.5, 7.0, 7.25, 20.0, 19.0, 3.0, 40.0, 12.0,
            ] {
                let (whole, whole_fits) = build(width, wrap, None);
                let (next, fits) = build(width, wrap, Some(&previous));
                assert_eq!(next.lines, whole.lines, "wrap {wrap} width {width}");
                assert_eq!(next.fragments, whole.fragments, "wrap {wrap} width {width}");
                assert_eq!(next.fit_witnesses.len(), whole.fit_witnesses.len());
                assert!(fits <= whole_fits, "wrap {wrap} width {width}");
                reused += whole_fits - fits;
                previous = next;
            }
            // 12 to 12.5 moves no break, so no line is fitted at all there; the narrower and
            // wider steps keep the lines a hard break ends early.
            let (_, unchanged_fits) = build(12.5, wrap, Some(&build(12.0, wrap, None).0));
            assert_eq!(unchanged_fits, 0, "wrap {wrap}");
            assert!(reused > 20, "wrap {wrap} reused {reused}");
        }
    }

    fn constraint() -> FlowConstraint {
        FlowConstraint {
            paragraph_id: 1,
            flow_thread_id: 1,
            width: 10.0,
            height: 100.0,
            viewport_block_start: 0.0,
            viewport_block_end: 100.0,
            resume_block_offset: 0.0,
            max_lines: 8,
            region_start: 0,
            resume_cluster: 0,
            region_count: 1,
            resume_region: 0,
            width_mode: AXIS_EXACT,
            height_mode: AXIS_EXACT,
            wrap: WRAP_CHARACTER,
            align: ALIGN_START,
            overflow: OVERFLOW_VISIBLE,
            block_align: BLOCK_ALIGN_START,
            first_line_indent: 0.0,
            space_before: 0.0,
            space_after: 0.0,
            justify_min_word_space_ratio: 0.0,
            justify_max_word_space_ratio: 0.0,
            justify_letter_space_expansion: 0.0,
            last_line: LAST_LINE_AUTO,
            drop_cap_lines: 0,
            drop_cap_alignment: 0,
            drop_cap_side: 0,
            drop_cap_margin_inline: 0.0,
            drop_cap_margin_block: 0.0,
            drop_cap_vertices_offset: 0,
            drop_cap_vertex_count: 0,
        }
    }

    fn region() -> FlowRegion {
        FlowRegion {
            id: 7,
            geometry_revision: 1,
            transform_index: 7,
            vertices_offset: 0,
            vertex_count: 0,
            exclusion_start: 0,
            exclusion_count: 1,
            shape: SHAPE_RECTANGLE,
            writing_mode: WRITING_HORIZONTAL_TB,
            text_orientation: ORIENTATION_MIXED,
            inline_start: 0.0,
            block_start: 0.0,
            inline_end: 10.0,
            block_end: 100.0,
            clip_inline_start: 0.0,
            clip_block_start: 0.0,
            clip_inline_end: 10.0,
            clip_block_end: 100.0,
        }
    }

    fn exclusion() -> FlowExclusion {
        FlowExclusion {
            id: 9,
            region_id: 7,
            geometry_revision: 1,
            vertices_offset: 0,
            vertex_count: 0,
            shape: SHAPE_RECTANGLE,
            wrap_side: EXCLUSION_WRAP_BOTH,
            inline_start: 4.0,
            block_start: 0.0,
            inline_end: 6.0,
            block_end: 40.0,
            margin_inline: 0.0,
            margin_block: 0.0,
        }
    }
}
