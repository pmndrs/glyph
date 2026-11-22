//! The cluster build of one edited source run, spliced between the previous arena's clusters.
//!
//! An edit that changes how many clusters or glyphs a source run has cannot keep the previous
//! arena's topology, but the incremental shape stage still reshaped that one source run alone:
//! every other source run's glyphs are the previous ones, moved by the edit. So the clusters
//! before the run and after it are the previous arena's rows, renumbered, and only the run's
//! own clusters are built, by the same passes the full build runs. What a row reads from
//! outside its run is checked rather than assumed:
//!
//! - grapheme boundaries after the run, which a run can share context with (a regional
//!   indicator pair, for one); those before it depend only on unchanged text before them;
//! - the style segments and shaping runs, which must be the previous ones moved by the edit;
//! - line breaks, which UAX #14 can move outside the run: the clusters a changed break
//!   touches, and the cluster before the run whose break reads the run's first cluster, are
//!   flagged again.
//!
//! The result equals the full build of the same inputs, lane for lane; anything the splice
//! cannot prove declines it, and the caller builds in full.

use core::ops::Range;

use crate::{FontInkTable, FontMetrics, unicode::UnicodeAnalysis};

use super::super::run_local_paragraph::RunLocalSplice;

use super::{
    CLUSTER_ALLOWED_BREAK, CLUSTER_BREAK_CORRECTION, CLUSTER_REQUIRED_BREAK, ClusterArena,
    ClusterBuildInput, EngineError, LAYOUT_CHUNK, ShapingRun, StyleSegment, all_ltr,
    build::ShapeScope, reserve, summarize_unit_chunks,
};

/// The one text edit of a request and what the previous arena was built from.
#[derive(Clone, Copy)]
pub(crate) struct SourceRunSplice<'a> {
    /// The shaping run the incremental shape stage reshaped; it contains the edit.
    pub source_run: u32,
    /// Units `[edit_start, old_end)` of the previous text became `[edit_start, new_end)`.
    pub edit_start: usize,
    pub old_end: usize,
    pub new_end: usize,
    pub previous_unicode: &'a UnicodeAnalysis,
    pub previous_styles: &'a [StyleSegment],
    pub previous_runs: &'a [ShapingRun],
}

const BREAK_BITS: u8 = CLUSTER_REQUIRED_BREAK | CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;

impl SourceRunSplice<'_> {
    /// Whether previous text offset `old` became `new`: offsets before the replaced units
    /// stay, offsets after them move by `delta`, and an insertion point (an edit that removed
    /// nothing) is both, since the inserted units join the segment on either side of it.
    fn moved(&self, old: u32, new: u32, delta: i64) -> bool {
        let old_usize = old as usize;
        let after = i64::from(old) + delta == i64::from(new);
        (old_usize <= self.edit_start && old == new) || (old_usize >= self.old_end && after)
    }
}

/// Where the edited run's clusters and glyphs sit in the previous arena and in this one.
struct Window {
    /// Clusters of the run: `[start, end)` here, `[start, old_end)` in the previous arena.
    start: usize,
    end: usize,
    old_end: usize,
    /// Text of the run here and in the previous text.
    text: Range<usize>,
    old_text_end: usize,
    /// Glyphs before the run, the run's previous glyphs end, and its glyph count here.
    glyph_start: usize,
    old_glyph_end: usize,
    glyphs: usize,
}

impl ClusterArena {
    /// Builds this arena as `previous` with the edited source run's clusters rebuilt. Returns
    /// `false`, with this arena in no defined state, when the splice does not apply; the
    /// caller then runs the full build, which also reports any error of the inputs.
    pub(crate) fn splice_source_run<'ink>(
        &mut self,
        previous: &Self,
        input: ClusterBuildInput<'_>,
        splice: SourceRunSplice<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) -> Result<bool, EngineError> {
        let _clock = super::StageClock::start();
        let Some(window) = self.splice_window(previous, &input, &splice) else {
            return Ok(false);
        };
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        let boundaries = unicode.grapheme_boundaries();
        let count = boundaries.len() - 1;
        let text_delta = text.len() as i64 - (previous.index_at.len() as i64 - 1);
        let cluster_delta = count as i64 - previous.starts.len() as i64;
        let old_glyphs = previous.glyph_ids.len();
        let glyph_count = window.glyph_start + window.glyphs + (old_glyphs - window.old_glyph_end);
        let glyph_delta = glyph_count as i64 - old_glyphs as i64;

        self.clear();
        self.ltr = all_ltr(runs);
        self.reserve(count)?;
        for lane in [
            &mut self.glyph_ids as &mut dyn GlyphLane,
            &mut self.glyph_clusters,
            &mut self.glyph_x_advances,
            &mut self.glyph_x_offsets,
            &mut self.glyph_y_offsets,
            &mut self.glyph_shape_flags,
        ] {
            lane.reserve_to(glyph_count)?;
        }
        reserve(&mut self.index_at, text.len() + 1)?;

        // The clusters before the run, as they were.
        let before = ..window.start;
        self.starts.extend_from_slice(&previous.starts[before]);
        self.ends.extend_from_slice(&previous.ends[before]);
        self.advances.extend_from_slice(&previous.advances[before]);
        self.units_per_em
            .extend_from_slice(&previous.units_per_em[before]);
        self.flags.extend_from_slice(&previous.flags[before]);
        self.style_indexes
            .extend_from_slice(&previous.style_indexes[before]);
        self.source_runs
            .extend_from_slice(&previous.source_runs[before]);
        self.binding_handles
            .extend_from_slice(&previous.binding_handles[before]);
        self.font_handles
            .extend_from_slice(&previous.font_handles[before]);
        self.stable_ids
            .extend_from_slice(&previous.stable_ids[before]);
        self.glyph_starts
            .extend_from_slice(&previous.glyph_starts[before]);
        self.glyph_counts
            .extend_from_slice(&previous.glyph_counts[before]);
        self.shaped.extend_from_slice(&previous.shaped[before]);
        self.unsafe_before
            .extend_from_slice(&previous.unsafe_before[before]);
        let glyphs_before = ..window.glyph_start;
        self.glyph_ids
            .extend_from_slice(&previous.glyph_ids[glyphs_before]);
        self.glyph_clusters
            .extend_from_slice(&previous.glyph_clusters[glyphs_before]);
        self.glyph_x_advances
            .extend_from_slice(&previous.glyph_x_advances[glyphs_before]);
        self.glyph_x_offsets
            .extend_from_slice(&previous.glyph_x_offsets[glyphs_before]);
        self.glyph_y_offsets
            .extend_from_slice(&previous.glyph_y_offsets[glyphs_before]);
        self.glyph_shape_flags
            .extend_from_slice(&previous.glyph_shape_flags[glyphs_before]);
        self.index_at
            .extend_from_slice(&previous.index_at[..window.text.start]);

        // The previous ink of the glyphs outside the run, at their new indices.
        let ink = &mut self.run_local.ink;
        ink.reset(glyph_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        ink.copy_from(&previous.run_local.ink, 0, 0, window.glyph_start);
        ink.copy_from(
            &previous.run_local.ink,
            window.old_glyph_end,
            window.glyph_start + window.glyphs,
            old_glyphs - window.old_glyph_end,
        );

        // The run's clusters, by the full build's passes.
        self.build_headers(
            text,
            text_unit_ids,
            &boundaries[window.start..=window.end],
            styles,
        )?;
        if text_unit_ids[window.text.clone()].contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        self.index_at.resize(window.text.end, 0);
        for cluster in window.start..window.end {
            let (start, end) = (self.starts[cluster] as usize, self.ends[cluster] as usize);
            self.index_at[start..end].fill(cluster as u32);
        }
        let scope = ShapeScope {
            clusters: window.start..window.end,
            source_run: Some(splice.source_run),
            glyph_base: window.glyph_start,
        };
        let ink_is_whole = self.aggregate_shape(runs, shape, scope, metrics_for, ink_for)?;
        if self.glyph_ids.len() != window.glyph_start + window.glyphs {
            return Err(EngineError::InvalidRequest);
        }

        // The clusters after the run, moved by the edit.
        let after = window.old_end..;
        let shift = |value: u32, delta: i64| (i64::from(value) + delta) as u32;
        self.starts.extend(
            previous.starts[after.clone()]
                .iter()
                .map(|start| shift(*start, text_delta)),
        );
        self.ends.extend(
            previous.ends[after.clone()]
                .iter()
                .map(|end| shift(*end, text_delta)),
        );
        self.advances
            .extend_from_slice(&previous.advances[after.clone()]);
        self.units_per_em
            .extend_from_slice(&previous.units_per_em[after.clone()]);
        self.flags.extend_from_slice(&previous.flags[after.clone()]);
        self.style_indexes
            .extend_from_slice(&previous.style_indexes[after.clone()]);
        self.source_runs
            .extend_from_slice(&previous.source_runs[after.clone()]);
        self.binding_handles
            .extend_from_slice(&previous.binding_handles[after.clone()]);
        self.font_handles
            .extend_from_slice(&previous.font_handles[after.clone()]);
        self.stable_ids
            .extend_from_slice(&previous.stable_ids[after.clone()]);
        self.glyph_starts.extend(
            previous.glyph_starts[after.clone()]
                .iter()
                .map(|start| shift(*start, glyph_delta)),
        );
        self.glyph_counts
            .extend_from_slice(&previous.glyph_counts[after.clone()]);
        self.shaped
            .extend_from_slice(&previous.shaped[after.clone()]);
        self.unsafe_before
            .extend_from_slice(&previous.unsafe_before[after]);
        let glyphs_after = window.old_glyph_end..;
        self.glyph_ids
            .extend_from_slice(&previous.glyph_ids[glyphs_after.clone()]);
        self.glyph_clusters.extend(
            previous.glyph_clusters[glyphs_after.clone()]
                .iter()
                .map(|cluster| shift(*cluster, text_delta)),
        );
        self.glyph_x_advances
            .extend_from_slice(&previous.glyph_x_advances[glyphs_after.clone()]);
        self.glyph_x_offsets
            .extend_from_slice(&previous.glyph_x_offsets[glyphs_after.clone()]);
        self.glyph_y_offsets
            .extend_from_slice(&previous.glyph_y_offsets[glyphs_after.clone()]);
        self.glyph_shape_flags
            .extend_from_slice(&previous.glyph_shape_flags[glyphs_after]);
        self.index_at.extend(
            previous.index_at[window.old_text_end..]
                .iter()
                .map(|cluster| shift(*cluster, cluster_delta)),
        );

        self.rebuild_layout_runs_for_shaping(runs)?;
        let flagged = self.reflag_breaks(&window, unicode, &splice, text_delta);
        if self
            .flags
            .iter()
            .any(|flags| flags & CLUSTER_BREAK_CORRECTION != 0)
        {
            self.break_corrections.resize_with(count, Default::default);
        }

        // Layout units are per cluster; the chunk summaries from the first changed cluster's
        // chunk on, because the clusters after it moved between chunks.
        self.advance_units
            .extend_from_slice(&previous.advance_units[before]);
        self.advance_units.extend(
            self.advances[window.start..window.end]
                .iter()
                .map(|advance| crate::engine::layout_units::layout_units_from_scaled(*advance)),
        );
        self.advance_units
            .extend_from_slice(&previous.advance_units[window.old_end..]);
        let first_chunk = flagged.start / LAYOUT_CHUNK;
        let chunk_count = count.div_ceil(LAYOUT_CHUNK);
        reserve(&mut self.chunk_advance_sums, chunk_count)?;
        reserve(&mut self.chunk_auxiliary_sums, chunk_count)?;
        reserve(&mut self.chunk_flags_or, chunk_count)?;
        self.chunk_advance_sums
            .extend_from_slice(&previous.chunk_advance_sums[..first_chunk]);
        self.chunk_auxiliary_sums
            .extend_from_slice(&previous.chunk_auxiliary_sums[..first_chunk]);
        self.chunk_flags_or
            .extend_from_slice(&previous.chunk_flags_or[..first_chunk]);
        summarize_unit_chunks(
            &self.advance_units[first_chunk * LAYOUT_CHUNK..],
            &self.flags[first_chunk * LAYOUT_CHUNK..],
            &mut self.chunk_advance_sums,
            &mut self.chunk_auxiliary_sums,
            &mut self.chunk_flags_or,
        );
        if ink_is_whole {
            self.run_local.keep_ink();
        }
        let cluster_delta_u = |cluster: usize| (cluster as i64 - cluster_delta) as u32;
        self.spliced = Some(super::diff::Spliced {
            changed: super::diff::ChangedClusters {
                new: flagged.start as u32..flagged.end as u32,
                old: flagged.start as u32..cluster_delta_u(flagged.end),
            },
        });
        self.run_local_splice = Some(RunLocalSplice {
            start: window.start,
            end: window.end,
            cluster_delta,
            glyph_delta,
        });
        #[cfg(test)]
        super::super::work_attribution::record(|work| work.cluster_source_run_splices += 1);
        Ok(true)
    }

    /// The edited run's clusters and glyphs here and in `previous`, or `None` when the clusters
    /// outside the run are not the previous ones moved by the edit.
    fn splice_window(
        &self,
        previous: &Self,
        input: &ClusterBuildInput<'_>,
        splice: &SourceRunSplice<'_>,
    ) -> Option<Window> {
        let text = input.text;
        let old_length = previous.index_at.len().checked_sub(1)?;
        let text_delta = text.len() as i64 - old_length as i64;
        let SourceRunSplice {
            edit_start,
            old_end,
            new_end,
            ..
        } = *splice;
        if edit_start > old_end
            || old_end > old_length
            || edit_start > new_end
            || new_end as i64 - old_end as i64 != text_delta
            || input.text_unit_ids.len() != text.len()
            || previous.run_local.ink.units().len() != previous.glyph_ids.len()
            || previous.chunk_advance_sums.len() != previous.starts.len().div_ceil(LAYOUT_CHUNK)
            || previous.advance_units.len() != previous.starts.len()
        {
            return None;
        }
        let moved = |old: u32, new: u32| splice.moved(old, new, text_delta);
        // Styles and shaping runs outside the edit are the previous ones, moved.
        let segments_moved = |new: &[StyleSegment], old: &[StyleSegment]| {
            new.len() == old.len()
                && new.iter().zip(old).all(|(new, old)| {
                    new.style == old.style
                        && moved(old.text_start, new.text_start)
                        && moved(old.text_end, new.text_end)
                })
        };
        if !segments_moved(input.styles, splice.previous_styles)
            || input.runs.len() != splice.previous_runs.len()
            || !input
                .runs
                .iter()
                .zip(splice.previous_runs)
                .all(|(new, old)| {
                    ShapingRun {
                        text_start: new.text_start,
                        text_end: new.text_end,
                        ..*old
                    } == *new
                        && moved(old.text_start, new.text_start)
                        && moved(old.text_end, new.text_end)
                })
        {
            return None;
        }
        let run = *input.runs.get(splice.source_run as usize)?;
        let (run_start, run_end) = (run.text_start as usize, run.text_end as usize);
        if edit_start < run_start || new_end > run_end || run_start >= run_end {
            return None;
        }
        let old_run_end = (run_end as i64 - text_delta) as usize;

        let boundaries = input.unicode.grapheme_boundaries();
        let start = boundaries.binary_search(&run.text_start).ok()?;
        let end = boundaries.binary_search(&run.text_end).ok()?;
        let old_end_cluster = match previous.ends.binary_search(&(old_run_end as u32)) {
            Ok(index) => index + 1,
            Err(_) => return None,
        };
        let old_count = previous.starts.len();
        // The clusters before the run end where it starts in both texts; those after it start
        // where the previous ones did, moved.
        if previous.starts.get(start).copied() != Some(run.text_start)
            || end - start == 0
            || boundaries.len() - 1 - end != old_count - old_end_cluster
            || !boundaries[end..boundaries.len() - 1]
                .iter()
                .zip(&previous.starts[old_end_cluster..])
                .all(|(new, old)| i64::from(*old) + text_delta == i64::from(*new))
        {
            return None;
        }
        let glyph_start = *previous.glyph_starts.get(start)? as usize;
        let old_glyph_end = previous
            .glyph_starts
            .get(old_end_cluster)
            .map_or(previous.glyph_ids.len(), |start| *start as usize);
        let glyphs = input
            .shape
            .runs
            .iter()
            .filter(|shaped| shaped.source_run == splice.source_run)
            .map(|shaped| shaped.glyph_count as usize)
            .sum();
        let glyph_count = glyph_start + glyphs + (previous.glyph_ids.len() - old_glyph_end);
        if glyph_count != input.shape.glyph_ids.len() {
            return None;
        }
        // The line breaks the splice compares were the previous arena's.
        if splice.previous_unicode.grapheme_boundaries().len() != old_count + 1 {
            return None;
        }
        Some(Window {
            start,
            end,
            old_end: old_end_cluster,
            text: run_start..run_end,
            old_text_end: old_run_end,
            glyph_start,
            old_glyph_end,
            glyphs,
        })
    }

    /// Recomputes the break flags of every cluster a changed line break or the rebuilt run can
    /// change, and returns those clusters. The flags outside them are the previous ones.
    fn reflag_breaks(
        &mut self,
        window: &Window,
        unicode: &UnicodeAnalysis,
        splice: &SourceRunSplice<'_>,
        text_delta: i64,
    ) -> Range<usize> {
        let new = unicode.line_breaks();
        let old = splice.previous_unicode.line_breaks();
        let same_before = new
            .iter()
            .zip(old)
            .take_while(|(new, old)| new == old)
            .count();
        let same_after = new
            .iter()
            .rev()
            .zip(old.iter().rev())
            .take_while(|(new, old)| {
                new.required == old.required
                    && i64::from(new.position) == i64::from(old.position) + text_delta
            })
            .count()
            .min(new.len() - same_before)
            .min(old.len() - same_before);
        // The cluster before the run reads the run's first cluster.
        let mut first = window.start.saturating_sub(1);
        let mut last = window.end;
        for line_break in &new[same_before..new.len() - same_after] {
            if let Some(target) = self.break_target(line_break.position, line_break.required) {
                first = first.min(target);
                last = last.max(target + 1);
            }
        }
        for line_break in &old[same_before..old.len() - same_after] {
            // Where the previous arena held that break's flags, renumbered.
            let position = line_break.position as usize;
            let target = if position <= window.text.start {
                position.saturating_sub(1)
            } else if position >= window.old_text_end {
                (position as i64 + text_delta - 1) as usize
            } else {
                continue;
            };
            let cluster = self.index_at[target] as usize;
            first = first.min(cluster);
            last = last.max(cluster + 1);
        }
        let last = last.min(self.starts.len());
        for flags in &mut self.flags[first..last] {
            *flags &= !BREAK_BITS;
        }
        let text_from = if first == 0 { 0 } else { self.starts[first] };
        let text_to = if last == 0 { 0 } else { self.ends[last - 1] };
        let from = new.partition_point(|line_break| line_break.position < text_from);
        let to = new.partition_point(|line_break| line_break.position <= text_to);
        for line_break in &new[from..to] {
            let end = line_break.position;
            if self.ends.is_empty() && end == 0 {
                continue;
            }
            let Some(preceding) = self.break_target(end, line_break.required) else {
                continue;
            };
            if preceding < first || preceding >= last {
                continue;
            }
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
            } else {
                self.mark_optional_break(preceding);
            }
        }
        first..last
    }
}

#[cfg(test)]
impl ClusterArena {
    /// The splice's contract: every lane equals the full build of the same inputs.
    pub(crate) fn assert_splice_equals_full_build<'ink>(
        &self,
        input: ClusterBuildInput<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) {
        let mut full = ClusterArena::default();
        full.build_with_ink(input, metrics_for, ink_for)
            .expect("the inputs a splice accepted build in full");
        // The shadow build is the check's, not the engine's.
        super::super::work_attribution::record(|work| work.cluster_full_builds -= 1);
        macro_rules! assert_lanes {
            ($($field:ident),+ $(,)?) => {$(
                assert!(self.$field == full.$field, concat!("spliced ", stringify!($field)));
            )+};
        }
        assert_lanes!(
            starts,
            ends,
            advance_units,
            chunk_advance_sums,
            chunk_auxiliary_sums,
            chunk_flags_or,
            flags,
            style_indexes,
            source_runs,
            binding_handles,
            font_handles,
            stable_ids,
            glyph_starts,
            glyph_counts,
            glyph_ids,
            glyph_clusters,
            glyph_x_advances,
            glyph_x_offsets,
            glyph_y_offsets,
            glyph_shape_flags,
            index_at,
            shaped,
            unsafe_before,
        );
        let bits = |lanes: &[f64]| {
            lanes
                .iter()
                .map(|value| value.to_bits())
                .collect::<alloc::vec::Vec<_>>()
        };
        assert_eq!(
            bits(&self.advances),
            bits(&full.advances),
            "spliced advances"
        );
        assert_eq!(
            bits(&self.units_per_em),
            bits(&full.units_per_em),
            "spliced units_per_em"
        );
        assert_eq!(self.ltr, full.ltr, "spliced ltr");
        assert_eq!(
            self.break_corrections.len(),
            full.break_corrections.len(),
            "spliced corrections"
        );
        assert!(
            self.layout_runs.runs == full.layout_runs.runs,
            "spliced layout runs"
        );
        let ink = |arena: &ClusterArena| {
            let units = arena.run_local.ink.units().to_vec();
            let outlined = (0..units.len())
                .map(|glyph| arena.run_local.ink.outlined(glyph))
                .collect::<alloc::vec::Vec<_>>();
            (units, outlined)
        };
        if full.run_local.ink.units().len() == full.glyph_ids.len() {
            assert!(ink(self) == ink(&full), "spliced ink");
        }
    }
}

/// A glyph lane the splice reserves before it fills.
trait GlyphLane {
    fn reserve_to(&mut self, len: usize) -> Result<(), EngineError>;
}

impl<T> GlyphLane for alloc::vec::Vec<T> {
    fn reserve_to(&mut self, len: usize) -> Result<(), EngineError> {
        reserve(self, len)
    }
}
