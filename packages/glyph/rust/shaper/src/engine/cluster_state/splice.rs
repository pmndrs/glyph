//! The cluster build of edited source runs, spliced between the previous arena's clusters.
//!
//! An edit that changes how many clusters or glyphs a source run has cannot keep the previous
//! arena's topology, but the incremental shape stage still reshaped the edited source runs
//! alone: every other source run's glyphs are the previous ones, moved by the edits before
//! them. So the clusters between the edited runs are the previous arena's rows, renumbered,
//! and only the edited runs' own clusters are built, by the same passes the full build runs.
//! What a row reads from outside its run is checked rather than assumed:
//!
//! - grapheme boundaries after an edited run, which a run can share context with (a regional
//!   indicator pair, for one); those before the first depend only on unchanged text;
//! - the style segments and shaping runs, which must be the previous ones moved by the edits;
//! - line breaks, which UAX #14 can move outside a run: the clusters a changed break touches,
//!   and the cluster before each run whose break reads the run's first cluster, are flagged
//!   again.
//!
//! The result equals the full build of the same inputs, lane for lane; anything the splice
//! cannot prove declines it, and the caller builds in full.

use alloc::vec::Vec;
use core::ops::Range;

use crate::{FontInkTable, FontMetrics, unicode::UnicodeAnalysis};

use super::super::run_local_paragraph::{RunLocalSplice, RunLocalWindow};

use super::{
    CLUSTER_ALLOWED_BREAK, CLUSTER_BREAK_CORRECTION, CLUSTER_REQUIRED_BREAK, ClusterArena,
    ClusterBuildInput, EngineError, LAYOUT_CHUNK, ShapingRun, StyleSegment, all_ltr,
    build::ShapeScope, reserve, summarize_unit_chunks,
};

/// The shaping runs the incremental shape stage reshaped, and what the previous arena was
/// built from.
#[derive(Clone, Copy)]
pub(crate) struct SourceRunSplice<'a> {
    /// Ascending and disjoint; every edit of the request lies in one of them.
    pub windows: &'a [RunWindow],
    pub previous_unicode: &'a UnicodeAnalysis,
    pub previous_styles: &'a [StyleSegment],
    pub previous_runs: &'a [ShapingRun],
}

/// Shaping runs `new` replaced the previous runs `old`: one run reshaped in place, or the runs
/// an edit split or merged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RunWindow {
    pub new: Range<u32>,
    pub old: Range<u32>,
}

const BREAK_BITS: u8 = CLUSTER_REQUIRED_BREAK | CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;

/// Where one edited run's clusters and glyphs sit in the previous arena and in this one.
struct Window {
    /// The shaping runs of the window here, and how many fewer the previous arena had.
    source_runs: Range<u32>,
    added_runs: i64,
    /// Clusters of the run here and in the previous arena.
    clusters: Range<usize>,
    old_clusters: Range<usize>,
    /// Text of the run here and in the previous text.
    text: Range<usize>,
    old_text: Range<usize>,
    /// Glyphs of the run in the previous arena, and how many it has here.
    old_glyphs: Range<usize>,
    glyphs: usize,
}

/// The edited runs and, for the stretch before each and after the last, how far it moved.
struct Plan {
    windows: Vec<Window>,
}

impl Plan {
    /// How many shaping runs the windows before window `index` added.
    fn run_shift(&self, index: usize) -> i64 {
        self.windows[..index]
            .iter()
            .map(|window| window.added_runs)
            .sum()
    }

    /// How far the stretch before window `index` (or after the last, at `windows.len()`)
    /// moved: in text units, clusters and glyphs.
    fn shift(&self, index: usize) -> (i64, i64, i64) {
        self.windows[..index]
            .iter()
            .fold((0, 0, 0), |(text, clusters, glyphs), window| {
                (
                    text + window.text.len() as i64 - window.old_text.len() as i64,
                    clusters + window.clusters.len() as i64 - window.old_clusters.len() as i64,
                    glyphs + window.glyphs as i64 - window.old_glyphs.len() as i64,
                )
            })
    }

    /// The previous arena's stretch of clusters before window `index`, and of glyphs and text.
    fn old_gap(
        &self,
        index: usize,
        previous: &ClusterArena,
    ) -> (Range<usize>, Range<usize>, Range<usize>) {
        let (clusters, glyphs, text) =
            match index.checked_sub(1).map(|before| &self.windows[before]) {
                Some(window) => (
                    window.old_clusters.end,
                    window.old_glyphs.end,
                    window.old_text.end,
                ),
                None => (0, 0, 0),
            };
        match self.windows.get(index) {
            Some(window) => (
                clusters..window.old_clusters.start,
                glyphs..window.old_glyphs.start,
                text..window.old_text.start,
            ),
            None => (
                clusters..previous.starts.len(),
                glyphs..previous.glyph_ids.len(),
                text..previous.index_at.len() - 1,
            ),
        }
    }
}

fn moved(value: u32, delta: i64) -> u32 {
    (i64::from(value) + delta) as u32
}

impl ClusterArena {
    /// Builds this arena as `previous` with the edited source runs' clusters rebuilt. Returns
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
        let Some(plan) = self.splice_plan(previous, &input, &splice) else {
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
        let glyph_count = shape.glyph_ids.len();

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
        self.run_local
            .ink
            .reset(glyph_count)
            .map_err(|_| EngineError::ResultTooLarge)?;

        let mut ink_is_whole = true;
        for index in 0..=plan.windows.len() {
            // The previous clusters before this window (or after the last), moved.
            let (text_delta, cluster_delta, glyph_delta) = plan.shift(index);
            let (clusters, glyphs, old_text) = plan.old_gap(index, previous);
            let run_delta = plan.run_shift(index);
            self.copy_clusters(
                previous,
                clusters,
                glyphs,
                text_delta,
                glyph_delta,
                run_delta,
            );
            let last = index == plan.windows.len();
            let text_end = if last { old_text.end + 1 } else { old_text.end };
            self.index_at.extend(
                previous.index_at[old_text.start..text_end]
                    .iter()
                    .map(|cluster| moved(*cluster, cluster_delta)),
            );
            let Some(window) = plan.windows.get(index) else {
                break;
            };
            // The run's clusters, by the full build's passes.
            self.build_headers(
                text,
                text_unit_ids,
                &boundaries[window.clusters.start..=window.clusters.end],
                styles,
            )?;
            if text_unit_ids[window.text.clone()].contains(&0) {
                return Err(EngineError::InvalidRequest);
            }
            if self.index_at.len() != window.text.start {
                return Err(EngineError::InvalidRequest);
            }
            for cluster in window.clusters.clone() {
                let (start, end) = (self.starts[cluster] as usize, self.ends[cluster] as usize);
                self.index_at.resize(start, 0);
                self.index_at.resize(end, cluster as u32);
            }
            let glyph_base = self.glyph_ids.len();
            let scope = ShapeScope {
                clusters: window.clusters.clone(),
                source_runs: Some(window.source_runs.clone()),
                glyph_base,
            };
            ink_is_whole &= self.aggregate_shape(runs, shape, scope, &metrics_for, &ink_for)?;
            if self.glyph_ids.len() != glyph_base + window.glyphs {
                return Err(EngineError::InvalidRequest);
            }
        }
        if self.starts.len() != count
            || self.glyph_ids.len() != glyph_count
            || self.index_at.len() != text.len() + 1
        {
            return Err(EngineError::InvalidRequest);
        }

        self.rebuild_layout_runs_for_shaping(runs)?;
        let flagged = self.reflag_breaks(&plan, previous, unicode, &splice);
        if self
            .flags
            .iter()
            .any(|flags| flags & CLUSTER_BREAK_CORRECTION != 0)
        {
            self.break_corrections.resize_with(count, Default::default);
        }

        // Layout units are per cluster; the chunk summaries from the first changed cluster's
        // chunk on, because the clusters after it moved between chunks.
        for index in 0..=plan.windows.len() {
            let (clusters, _, _) = plan.old_gap(index, previous);
            self.advance_units
                .extend_from_slice(&previous.advance_units[clusters]);
            let Some(window) = plan.windows.get(index) else {
                break;
            };
            self.advance_units.extend(
                self.advances[window.clusters.clone()]
                    .iter()
                    .map(|advance| crate::engine::layout_units::layout_units_from_scaled(*advance)),
            );
        }
        let first_chunk = flagged.first().map_or(0, |range| range.start) / LAYOUT_CHUNK;
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
        // What the revision pass and later caches may keep: everything outside the flagged
        // clusters, which map back through the clusters the windows before them added.
        let mut changed = Vec::new();
        changed
            .try_reserve(flagged.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for range in &flagged {
            let old = |cluster: usize| moved(cluster as u32, -plan.cluster_shift_at(cluster));
            changed.push(super::diff::ChangedClusters {
                new: range.start as u32..range.end as u32,
                old: old(range.start)..old(range.end),
            });
        }
        self.spliced = Some(super::diff::Spliced { changed });
        let mut windows = Vec::new();
        windows
            .try_reserve(plan.windows.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for (index, window) in plan.windows.iter().enumerate() {
            let (_, cluster_delta, glyph_delta) = plan.shift(index + 1);
            windows.push(RunLocalWindow {
                start: window.clusters.start,
                end: window.clusters.end,
                cluster_delta,
                glyph_delta,
            });
        }
        self.run_local_splice = Some(RunLocalSplice { windows });
        #[cfg(test)]
        super::super::work_attribution::record(|work| work.cluster_source_run_splices += 1);
        Ok(true)
    }

    /// Appends the previous clusters `clusters`, which own glyphs `glyphs`, moved by
    /// `text_delta` units and `glyph_delta` glyphs.
    fn copy_clusters(
        &mut self,
        previous: &Self,
        clusters: Range<usize>,
        glyphs: Range<usize>,
        text_delta: i64,
        glyph_delta: i64,
        run_delta: i64,
    ) {
        let c = clusters;
        self.starts.extend(
            previous.starts[c.clone()]
                .iter()
                .map(|start| moved(*start, text_delta)),
        );
        self.ends.extend(
            previous.ends[c.clone()]
                .iter()
                .map(|end| moved(*end, text_delta)),
        );
        self.advances
            .extend_from_slice(&previous.advances[c.clone()]);
        self.units_per_em
            .extend_from_slice(&previous.units_per_em[c.clone()]);
        self.flags.extend_from_slice(&previous.flags[c.clone()]);
        self.style_indexes
            .extend_from_slice(&previous.style_indexes[c.clone()]);
        self.source_runs
            .extend(previous.source_runs[c.clone()].iter().map(|run| {
                if *run == super::NO_SOURCE_RUN {
                    *run
                } else {
                    moved(*run, run_delta)
                }
            }));
        self.binding_handles
            .extend_from_slice(&previous.binding_handles[c.clone()]);
        self.font_handles
            .extend_from_slice(&previous.font_handles[c.clone()]);
        self.stable_ids
            .extend_from_slice(&previous.stable_ids[c.clone()]);
        self.glyph_starts.extend(
            previous.glyph_starts[c.clone()]
                .iter()
                .map(|start| moved(*start, glyph_delta)),
        );
        self.glyph_counts
            .extend_from_slice(&previous.glyph_counts[c.clone()]);
        self.shaped.extend_from_slice(&previous.shaped[c.clone()]);
        self.unsafe_before
            .extend_from_slice(&previous.unsafe_before[c]);
        let to = self.glyph_ids.len();
        let g = glyphs;
        self.glyph_ids
            .extend_from_slice(&previous.glyph_ids[g.clone()]);
        self.glyph_clusters.extend(
            previous.glyph_clusters[g.clone()]
                .iter()
                .map(|cluster| moved(*cluster, text_delta)),
        );
        self.glyph_x_advances
            .extend_from_slice(&previous.glyph_x_advances[g.clone()]);
        self.glyph_x_offsets
            .extend_from_slice(&previous.glyph_x_offsets[g.clone()]);
        self.glyph_y_offsets
            .extend_from_slice(&previous.glyph_y_offsets[g.clone()]);
        self.glyph_shape_flags
            .extend_from_slice(&previous.glyph_shape_flags[g.clone()]);
        self.run_local
            .ink
            .copy_from(&previous.run_local.ink, g.start, to, g.len());
    }

    /// The edited runs' clusters and glyphs here and in `previous`, or `None` when the
    /// clusters between them are not the previous ones moved by the edits.
    fn splice_plan(
        &self,
        previous: &Self,
        input: &ClusterBuildInput<'_>,
        splice: &SourceRunSplice<'_>,
    ) -> Option<Plan> {
        let text = input.text;
        let old_length = previous.index_at.len().checked_sub(1)?;
        let (new_runs, old_runs) = (input.runs, splice.previous_runs);
        if splice.windows.is_empty()
            || input.text_unit_ids.len() != text.len()
            || previous.run_local.ink.units().len() != previous.glyph_ids.len()
            || previous.chunk_advance_sums.len() != previous.starts.len().div_ceil(LAYOUT_CHUNK)
            || previous.advance_units.len() != previous.starts.len()
            || splice.previous_unicode.grapheme_boundaries().len() != previous.starts.len() + 1
        {
            return None;
        }
        // Between the windows every shaping run is the previous one moved by the windows
        // before it, in text and in index. A window's runs tile the same place in both texts.
        let same = |new: &ShapingRun, old: &ShapingRun, delta: i64| {
            ShapingRun {
                text_start: new.text_start,
                text_end: new.text_end,
                ..*old
            } == *new
                && i64::from(old.text_start) + delta == i64::from(new.text_start)
                && i64::from(old.text_end) + delta == i64::from(new.text_end)
        };
        // (old text, new text) of every window.
        let mut texts: Vec<(Range<u32>, Range<u32>)> = Vec::new();
        texts.try_reserve(splice.windows.len()).ok()?;
        let (mut old_at, mut new_at, mut delta) = (0u32, 0u32, 0i64);
        for window in splice.windows {
            let (new, old) = (&window.new, &window.old);
            if new.is_empty()
                || old.is_empty()
                || old.start < old_at
                || i64::from(new.start) - i64::from(old.start)
                    != i64::from(new_at) - i64::from(old_at)
            {
                return None;
            }
            for (old_run, new_run) in old_runs
                .get(old_at as usize..old.start as usize)?
                .iter()
                .zip(new_runs.get(new_at as usize..new.start as usize)?)
            {
                if !same(new_run, old_run, delta) {
                    return None;
                }
            }
            let new_text = new_runs.get(new.start as usize)?.text_start
                ..new_runs.get(new.end as usize - 1)?.text_end;
            let old_text = old_runs.get(old.start as usize)?.text_start
                ..old_runs.get(old.end as usize - 1)?.text_end;
            if i64::from(old_text.start) + delta != i64::from(new_text.start)
                || new_text.start >= new_text.end
            {
                return None;
            }
            delta +=
                i64::from(new_text.end - new_text.start) - i64::from(old_text.end - old_text.start);
            texts.push((old_text, new_text));
            (old_at, new_at) = (old.end, new.end);
        }
        let old_rest = old_runs.get(old_at as usize..)?;
        let new_rest = new_runs.get(new_at as usize..)?;
        if old_rest.len() != new_rest.len()
            || !old_rest
                .iter()
                .zip(new_rest)
                .all(|(old_run, new_run)| same(new_run, old_run, delta))
            || text.len() as i64 != old_length as i64 + delta
        {
            return None;
        }
        // A previous style boundary moves by the windows wholly before it when it starts a
        // segment, and by those that started before it when it ends one; none lies inside one.
        let grown = |window: &(Range<u32>, Range<u32>)| {
            i64::from(window.1.end - window.1.start) - i64::from(window.0.end - window.0.start)
        };
        let shift_start = |offset: u32| -> i64 {
            texts
                .iter()
                .filter(|window| window.0.end <= offset)
                .map(grown)
                .sum()
        };
        let shift_end = |offset: u32| -> i64 {
            texts
                .iter()
                .filter(|window| window.0.start < offset)
                .map(grown)
                .sum()
        };
        let inside = |offset: u32| {
            texts
                .iter()
                .any(|window| window.0.start < offset && offset < window.0.end)
        };
        if input.styles.len() != splice.previous_styles.len()
            || !input
                .styles
                .iter()
                .zip(splice.previous_styles)
                .all(|(new, old)| {
                    new.style == old.style
                        && !inside(old.text_start)
                        && !inside(old.text_end)
                        && moved(old.text_start, shift_start(old.text_start)) == new.text_start
                        && moved(old.text_end, shift_end(old.text_end)) == new.text_end
                })
        {
            return None;
        }

        let boundaries = input.unicode.grapheme_boundaries();
        let old_count = previous.starts.len();
        let mut windows: Vec<Window> = Vec::new();
        windows.try_reserve(splice.windows.len()).ok()?;
        for (window, (old_text, new_text)) in splice.windows.iter().zip(&texts) {
            let start = boundaries.binary_search(&new_text.start).ok()?;
            let end = boundaries.binary_search(&new_text.end).ok()?;
            let old_start = match previous.starts.binary_search(&old_text.start) {
                Ok(index) => index,
                Err(index) if index == old_count && old_text.start as usize == old_length => index,
                Err(_) => return None,
            };
            let old_end = if old_text.end == old_text.start {
                old_start
            } else {
                previous.ends.binary_search(&old_text.end).ok()? + 1
            };
            // The clusters since the previous window are as many as before.
            let (gap_start, old_gap_start) = windows.last().map_or((0, 0), |window| {
                (window.clusters.end, window.old_clusters.end)
            });
            if start - gap_start != old_start.checked_sub(old_gap_start)? || end == start {
                return None;
            }
            let old_glyph = |cluster: usize| {
                previous
                    .glyph_starts
                    .get(cluster)
                    .map_or(previous.glyph_ids.len(), |start| *start as usize)
            };
            let glyphs = input
                .shape
                .runs
                .iter()
                .filter(|shaped| window.new.contains(&shaped.source_run))
                .map(|shaped| shaped.glyph_count as usize)
                .sum();
            windows.push(Window {
                source_runs: window.new.clone(),
                added_runs: i64::from(window.new.end - window.new.start)
                    - i64::from(window.old.end - window.old.start),
                clusters: start..end,
                old_clusters: old_start..old_end,
                text: new_text.start as usize..new_text.end as usize,
                old_text: old_text.start as usize..old_text.end as usize,
                old_glyphs: old_glyph(old_start)..old_glyph(old_end),
                glyphs,
            });
        }
        let plan = Plan { windows };
        // Grapheme boundaries after each edited run are the previous ones, moved: a run can
        // change the segmentation of the text after it.
        for index in 1..=plan.windows.len() {
            let (text_delta, _, _) = plan.shift(index);
            let (old_clusters, _, _) = plan.old_gap(index, previous);
            let start = plan.windows[index - 1].clusters.end;
            if !boundaries[start..start + old_clusters.len()]
                .iter()
                .zip(&previous.starts[old_clusters.clone()])
                .all(|(new, old)| i64::from(*old) + text_delta == i64::from(*new))
            {
                return None;
            }
            if index == plan.windows.len() && start + old_clusters.len() != boundaries.len() - 1 {
                return None;
            }
        }
        let (_, _, glyph_delta) = plan.shift(plan.windows.len());
        if previous.glyph_ids.len() as i64 + glyph_delta != input.shape.glyph_ids.len() as i64 {
            return None;
        }
        Some(plan)
    }

    /// Recomputes the break flags of every cluster a changed line break or a rebuilt run can
    /// change, and returns those clusters, ascending. The flags outside them are the previous
    /// ones.
    fn reflag_breaks(
        &mut self,
        plan: &Plan,
        previous: &Self,
        unicode: &UnicodeAnalysis,
        splice: &SourceRunSplice<'_>,
    ) -> Vec<Range<usize>> {
        let new = unicode.line_breaks();
        let old = splice.previous_unicode.line_breaks();
        // Each run's clusters, and the cluster before it, whose break reads the run's first.
        let mut dirty: Vec<Range<usize>> = plan
            .windows
            .iter()
            .map(|window| window.clusters.start.saturating_sub(1)..window.clusters.end)
            .collect();
        // Breaks outside the runs, compared at the shift of the stretch they are in.
        for index in 0..=plan.windows.len() {
            let (text_delta, _, _) = plan.shift(index);
            let (_, _, old_text) = plan.old_gap(index, previous);
            let new_text =
                moved(old_text.start as u32, text_delta)..moved(old_text.end as u32, text_delta);
            // Breaks at a run's own edges belong to its clusters or the one before it; the
            // text's own end belongs to the stretch after the last run.
            let last = index == plan.windows.len();
            let inside = |range: &Range<u32>, position: u32| {
                range.start < position && (position < range.end || (last && position == range.end))
            };
            let new_breaks = new
                .iter()
                .filter(|line_break| inside(&new_text, line_break.position));
            let old_range = old_text.start as u32..old_text.end as u32;
            let mut old_breaks = old
                .iter()
                .filter(|line_break| inside(&old_range, line_break.position))
                .peekable();
            let mut new_breaks = new_breaks.peekable();
            let mark = |dirty: &mut Vec<Range<usize>>, position: u32, required: bool| {
                if let Some(target) = self.break_target(position, required) {
                    dirty.push(target..target + 1);
                }
            };
            loop {
                let new_at = new_breaks
                    .peek()
                    .map(|line_break| (i64::from(line_break.position), line_break.required));
                let old_at = old_breaks.peek().map(|line_break| {
                    (
                        i64::from(line_break.position) + text_delta,
                        line_break.required,
                    )
                });
                match (new_at, old_at) {
                    (None, None) => break,
                    (Some(new), Some(old)) if new.0 == old.0 => {
                        if new.1 != old.1 {
                            mark(&mut dirty, new.0 as u32, true);
                        }
                        new_breaks.next();
                        old_breaks.next();
                    }
                    (Some(new), None) => {
                        mark(&mut dirty, new.0 as u32, new.1);
                        new_breaks.next();
                    }
                    (Some(new), Some(old)) if new.0 < old.0 => {
                        mark(&mut dirty, new.0 as u32, new.1);
                        new_breaks.next();
                    }
                    (_, Some(old)) => {
                        mark(&mut dirty, old.0 as u32, true);
                        old_breaks.next();
                    }
                }
            }
        }
        dirty.sort_unstable_by_key(|range| range.start);
        let mut merged: Vec<Range<usize>> = Vec::new();
        for range in dirty {
            match merged.last_mut() {
                Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
                _ => merged.push(range),
            }
        }
        for range in &merged {
            for flags in &mut self.flags[range.clone()] {
                *flags &= !BREAK_BITS;
            }
            let text_from = if range.start == 0 {
                0
            } else {
                self.starts[range.start]
            };
            let text_to = self.ends[range.end - 1];
            let from = new.partition_point(|line_break| line_break.position < text_from);
            let to = new.partition_point(|line_break| line_break.position <= text_to);
            for line_break in &new[from..to] {
                let Some(preceding) = self.break_target(line_break.position, line_break.required)
                else {
                    continue;
                };
                if !range.contains(&preceding) {
                    continue;
                }
                if line_break.required {
                    self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
                } else {
                    self.mark_optional_break(preceding);
                }
            }
        }
        merged
    }
}

impl Plan {
    /// How many clusters the windows wholly before `cluster` added.
    fn cluster_shift_at(&self, cluster: usize) -> i64 {
        self.windows
            .iter()
            .take_while(|window| window.clusters.end <= cluster)
            .map(|window| window.clusters.len() as i64 - window.old_clusters.len() as i64)
            .sum()
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
