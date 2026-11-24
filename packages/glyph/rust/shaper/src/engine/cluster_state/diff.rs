//! What a rebuilt cluster arena kept from the arena before it: glyph identities, layout-run
//! revisions, and the cluster ranges whose lanes changed.
//!
//! All three read the two arenas lane against lane. Clusters are paired by stable text id, so a
//! pairing is a list of segments, each a stretch of clusters that kept their ids in order; the
//! lanes of a segment are compared at a constant shift, 64 clusters at a time, with every
//! compare of a chunk folded into one answer. Only a chunk that differs is walked cluster by
//! cluster. The hash index over previous clusters is built only for what a common prefix and
//! suffix do not pair: nothing for an edit at one place, the span between the first and last
//! edit otherwise.

use crate::cold_growth::ColdGrowth as _;

use alloc::vec::Vec;
use core::ops::Range;

use super::{
    CLUSTER_BREAK_CORRECTION, ClusterArena, ClusterComparison, EngineError, IdentityIndex,
    LAYOUT_CHUNK, LayoutDirtyRanges, LayoutRun, NO_SOURCE_RUN, RunCanonicalInput,
    RunCanonicalRevision, ShapingRun, clusters_canonically_equal, geometric_style_equal,
    identity_index_error, prepare_run_revision_index,
};
use crate::engine::style_state::{ResolvedStyle, StyleArena};

/// A stretch of clusters that kept their stable text ids, in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) struct Segment {
    new_start: u32,
    old_start: u32,
    len: u32,
}

/// Clusters `new` of the rebuilt arena replace clusters `old` of the arena before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChangedClusters {
    pub new: Range<u32>,
    pub old: Range<u32>,
}

/// The difference between a rebuilt cluster arena and the arena it replaces, as the caches
/// keyed on cluster lanes need it.
///
/// `ranges` ascend in both arenas and never touch. Every cluster of the rebuilt arena outside
/// them has a counterpart in the old arena -- at the same index before the first range, and
/// after a range at its index plus `old.end - new.end` of that range -- with the same stable
/// text id, text length, glyph ids, glyph advances and offsets, glyph flags, advance, font em,
/// cluster flags (break opportunities and corrections among them), `unsafe_before`, binding and
/// font, and with the same layout style and shaping-run direction, level and script.
///
/// `everything` withdraws that: the arenas are not comparable cluster by cluster (there was no
/// previous cluster arena, the paragraph-wide left-to-right flag changed, or a run's font
/// stack, language, features or direction changed under clusters that otherwise pair), and
/// nothing keyed on the old arena may be kept.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ClusterChanges {
    pub everything: bool,
    pub ranges: Vec<ChangedClusters>,
}

impl Default for ClusterChanges {
    fn default() -> Self {
        Self {
            everything: true,
            ranges: Vec::new(),
        }
    }
}

impl ClusterChanges {
    /// Until a comparison says otherwise, nothing is known to be kept.
    pub(super) fn reset(&mut self) {
        self.everything = true;
        self.ranges.clear();
    }

    fn push(&mut self, new: Range<u32>, old: Range<u32>) -> Result<(), EngineError> {
        if let Some(last) = self.ranges.last_mut()
            && last.new.end == new.start
            && last.old.end == old.start
        {
            last.new.end = new.end;
            last.old.end = old.end;
            return Ok(());
        }
        self.ranges
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.ranges.push(ChangedClusters { new, old });
        Ok(())
    }
}

/// Whether two lanes hold the same values. The compare is folded so the loop has no exit, and
/// each element type has one copy of it however many lanes are compared.
trait Lane {
    fn same(&self, other: &Self) -> bool;
}

macro_rules! lane {
    ($($element:ty),*) => {$(
        impl Lane for [$element] {
            #[inline(never)]
            fn same(&self, other: &Self) -> bool {
                self.len() == other.len()
                    && self
                        .iter()
                        .zip(other)
                        .fold(true, |equal, (left, right)| equal & (left == right))
            }
        }
    )*};
}

lane!(u8, u16, u32, i32, i64);

macro_rules! lanes_equal {
    ($left:expr, $right:expr) => {
        Lane::same($left, $right)
    };
}

/// The f64 twin: equal bits, compared as integers.
#[inline(never)]
fn bits_equal(left: &[f64], right: &[f64]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0_u64, |difference, (left, right)| {
                difference | (left.to_bits() ^ right.to_bits())
            })
            == 0
}

/// How many leading values two id lanes share.
#[inline(never)]
fn common_prefix(left: &[u32], right: &[u32]) -> usize {
    let limit = left.len().min(right.len());
    let mut shared = 0;
    for (left, right) in left[..limit]
        .chunks(LAYOUT_CHUNK)
        .zip(right[..limit].chunks(LAYOUT_CHUNK))
    {
        if !lanes_equal!(left, right) {
            return shared
                + left
                    .iter()
                    .zip(right)
                    .position(|(left, right)| left != right)
                    .unwrap_or(left.len());
        }
        shared += left.len();
    }
    shared
}

fn common_suffix(left: &[u32], right: &[u32]) -> usize {
    let limit = left.len().min(right.len());
    let (left, right) = (&left[left.len() - limit..], &right[right.len() - limit..]);
    let mut shared = 0;
    for (left, right) in left.rchunks(LAYOUT_CHUNK).zip(right.rchunks(LAYOUT_CHUNK)) {
        if !lanes_equal!(left, right) {
            return shared
                + left
                    .iter()
                    .rev()
                    .zip(right.iter().rev())
                    .position(|(left, right)| left != right)
                    .unwrap_or(left.len());
        }
        shared += left.len();
    }
    shared
}

fn push_segment(
    segments: &mut Vec<Segment>,
    new_start: usize,
    old_start: usize,
    len: usize,
) -> Result<(), EngineError> {
    if len == 0 {
        return Ok(());
    }
    segments
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    segments.push(Segment {
        new_start: new_start as u32,
        old_start: old_start as u32,
        len: len as u32,
    });
    Ok(())
}

/// Pairs the clusters of two arenas by stable text id. A new cluster outside every segment has
/// no previous cluster.
fn align(
    new: &[u32],
    old: &[u32],
    index: &mut IdentityIndex,
    segments: &mut Vec<Segment>,
) -> Result<(), EngineError> {
    segments.clear();
    let prefix = common_prefix(new, old);
    let suffix = common_suffix(&new[prefix..], &old[prefix..]);
    push_segment(segments, 0, 0, prefix)?;
    let new_middle = &new[prefix..new.len() - suffix];
    let old_middle = &old[prefix..old.len() - suffix];
    if !new_middle.is_empty() && !old_middle.is_empty() {
        // Ids are unique in each arena, so an id of the new middle can only be in the old one.
        index
            .prepare(old_middle.len())
            .map_err(identity_index_error)?;
        for (offset, id) in old_middle.iter().enumerate() {
            index
                .insert(*id, offset as u32)
                .map_err(identity_index_error)?;
        }
        let mut at = 0;
        while at < new_middle.len() {
            let Some(found) = index.get(new_middle[at]) else {
                at += 1;
                continue;
            };
            let found = found as usize;
            let len = 1 + common_prefix(&new_middle[at + 1..], &old_middle[found + 1..]);
            push_segment(segments, prefix + at, prefix + found, len)?;
            at += len;
        }
    }
    push_segment(segments, new.len() - suffix, old.len() - suffix, suffix)
}

/// Fresh ids for `slots`, in order.
#[inline(never)]
fn allocate(slots: &mut [u32], next_id: &mut u32) -> Result<(), EngineError> {
    let count = u32::try_from(slots.len()).map_err(|_| EngineError::ResultTooLarge)?;
    let end = next_id
        .checked_add(count)
        .ok_or(EngineError::ResultTooLarge)?;
    for (slot, id) in slots.iter_mut().zip(*next_id..end) {
        *slot = id;
    }
    *next_id = end;
    Ok(())
}

/// The glyphs of clusters `[start, end)`.
#[inline(never)]
fn glyph_span(arena: &ClusterArena, start: usize, end: usize) -> Range<usize> {
    let first = arena.glyph_starts.get(start).copied();
    let last = match end.checked_sub(1) {
        Some(last) if end > start => arena.glyph_starts[last] + arena.glyph_counts[last],
        _ => first.unwrap_or(0),
    };
    first.unwrap_or(last) as usize..last as usize
}

impl ClusterArena {
    /// Gives every glyph the stable id of the glyph at the same place in the previous cluster
    /// with its stable text id, and a fresh id otherwise.
    pub(super) fn assign_stable_glyph_ids_from_arena(
        &mut self,
        previous: &Self,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        let mut segments = core::mem::take(&mut self.alignment);
        let result = align(&self.stable_ids, &previous.stable_ids, index, &mut segments)
            .and_then(|()| self.copy_glyph_ids(previous, &segments, next_id));
        self.alignment = segments;
        self.aligned = result.is_ok();
        result
    }

    fn copy_glyph_ids(
        &mut self,
        previous: &Self,
        segments: &[Segment],
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        *next_id = (*next_id).max(1);
        let mut ids = core::mem::take(&mut self.glyph_stable_ids);
        let mut unpaired = 0usize;
        let mut result = Ok(());
        for segment in segments {
            let (new_start, old_start, len) = (
                segment.new_start as usize,
                segment.old_start as usize,
                segment.len as usize,
            );
            result =
                allocate(&mut ids[glyph_span(self, unpaired, new_start)], next_id).and_then(|()| {
                    self.copy_segment_glyph_ids(
                        previous, &mut ids, new_start, old_start, len, next_id,
                    )
                });
            if result.is_err() {
                break;
            }
            unpaired = new_start + len;
        }
        if result.is_ok() {
            let rest = glyph_span(self, unpaired, self.starts.len());
            result = allocate(&mut ids[rest], next_id);
        }
        self.glyph_stable_ids = ids;
        result
    }

    fn copy_segment_glyph_ids(
        &self,
        previous: &Self,
        ids: &mut [u32],
        new_start: usize,
        old_start: usize,
        len: usize,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        for offset in (0..len).step_by(LAYOUT_CHUNK) {
            let chunk = LAYOUT_CHUNK.min(len - offset);
            let (new, old) = (new_start + offset, old_start + offset);
            let new_glyphs = glyph_span(self, new, new + chunk);
            let old_glyphs = glyph_span(previous, old, old + chunk);
            if lanes_equal!(
                &self.glyph_counts[new..new + chunk],
                &previous.glyph_counts[old..old + chunk]
            ) {
                let kept = &previous.glyph_stable_ids[old_glyphs];
                if kept.iter().fold(false, |zero, id| zero | (*id == 0)) {
                    return Err(EngineError::InvalidRequest);
                }
                ids[new_glyphs].copy_from_slice(kept);
                continue;
            }
            // A cluster that changed its glyph count keeps the ids of the glyphs it still has.
            for cluster in 0..chunk {
                let slots = &mut ids[glyph_span(self, new + cluster, new + cluster + 1)];
                let kept = &previous.glyph_stable_ids
                    [glyph_span(previous, old + cluster, old + cluster + 1)];
                let shared = slots.len().min(kept.len());
                if kept[..shared].contains(&0) {
                    return Err(EngineError::InvalidRequest);
                }
                slots[..shared].copy_from_slice(&kept[..shared]);
                allocate(&mut slots[shared..], next_id)?;
            }
        }
        Ok(())
    }

    /// `finalize_layout_run_revisions` against a previous cluster arena: a run keeps its
    /// revision when the run that started at the same stable text id is canonically equal.
    pub(super) fn finalize_revisions_from_arena(
        &mut self,
        previous: &Self,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
        layout_dirty: Option<(&mut LayoutDirtyRanges, bool)>,
    ) -> Result<(), EngineError> {
        let styles_proven = layout_dirty.as_ref().is_some_and(|(_, proven)| *proven);
        let mut layout_dirty = layout_dirty.map(|(dirty, _)| dirty);
        prepare_run_revision_index(previous, index)?;
        // After a splice, a run outside the clusters it rebuilt is its previous run moved, so
        // it keeps that run's revision without a comparison; the dirty proof needs every run
        // compared, so it takes the walk.
        let spliced = self
            .spliced
            .take()
            .filter(|_| !layout_dirty.as_ref().is_some_and(|dirty| dirty.valid));
        for run_index in 0..self.layout_runs.runs.len() {
            let run = self.layout_runs.runs[run_index];
            if let Some(revision) = spliced
                .as_ref()
                .and_then(|spliced| spliced.kept_revision(run, previous))
            {
                self.layout_runs.runs[run_index].canonical_revision = Some(revision);
                continue;
            }
            let anchor = self
                .stable_ids
                .get(run.cluster_start as usize)
                .copied()
                .filter(|anchor| *anchor != 0)
                .ok_or(EngineError::InvalidRequest)?;
            let previous_run = index
                .get(anchor)
                .and_then(|slot| previous.layout_runs.runs.get(slot as usize))
                .copied();
            let mut retained = None;
            match previous_run {
                Some(candidate) => {
                    let pair = RunPair {
                        new: self,
                        old: previous,
                        new_input: current,
                        old_input: committed,
                    };
                    if pair.canonically_equal(
                        run,
                        candidate,
                        layout_dirty.as_deref_mut(),
                        styles_proven,
                    )? {
                        retained = candidate.canonical_revision;
                    }
                }
                None => {
                    if let Some(dirty) = layout_dirty.as_deref_mut() {
                        dirty.valid = false;
                    }
                }
            }
            let revision = match retained {
                Some(revision) => revision,
                None => RunCanonicalRevision::allocate(next_revision)?,
            };
            self.layout_runs.runs[run_index].canonical_revision = Some(revision);
        }
        if let Some(spliced) = spliced {
            self.changes.reset();
            self.aligned = false;
            for range in spliced.changed {
                if !range.new.is_empty() || !range.old.is_empty() {
                    self.changes.push(range.new, range.old)?;
                }
            }
            self.changes.everything = false;
            return Ok(());
        }
        let mut changes = core::mem::take(&mut self.changes);
        let result = self.changes_from_arena(previous, current, committed, index, &mut changes);
        if result.is_err() {
            changes.reset();
        }
        self.changes = changes;
        result
    }

    /// Fills `changes` with the cluster ranges that differ from `previous`.
    fn changes_from_arena(
        &mut self,
        previous: &Self,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        index: &mut IdentityIndex,
        changes: &mut ClusterChanges,
    ) -> Result<(), EngineError> {
        changes.reset();
        if self.ltr != previous.ltr {
            return Ok(());
        }
        let mut segments = core::mem::take(&mut self.alignment);
        let aligned = if self.aligned {
            Ok(())
        } else {
            align(&self.stable_ids, &previous.stable_ids, index, &mut segments)
        };
        let pair = RunPair {
            new: self,
            old: previous,
            new_input: current,
            old_input: committed,
        };
        let result = aligned.and_then(|()| pair.changes(&segments, changes));
        self.alignment = segments;
        self.aligned = false;
        result
    }
}

/// What a splice proved: clusters outside `changed` are the previous arena's, moved by the
/// edits -- the same text, identity, lanes, glyphs, styles and shaping runs.
#[derive(Clone, Debug)]
pub(in crate::engine) struct Spliced {
    /// Ascending; a range's old clusters follow from the clusters the ranges before it added.
    pub changed: Vec<ChangedClusters>,
}

impl Spliced {
    /// The revision of a layout run that lies outside the changed clusters and covers exactly
    /// the clusters of a previous run, which is then canonically equal to it. Its shaping run
    /// may have moved to another index when a window split or merged runs; the splice proved it
    /// the previous one.
    fn kept_revision(
        &self,
        run: LayoutRun,
        previous: &ClusterArena,
    ) -> Option<RunCanonicalRevision> {
        let mut shift = 0_i64;
        for range in &self.changed {
            if run.cluster_end <= range.new.start {
                break;
            }
            if run.cluster_start < range.new.end {
                return None;
            }
            shift += i64::from(range.new.end - range.new.start)
                - i64::from(range.old.end - range.old.start);
        }
        let start = u32::try_from(i64::from(run.cluster_start) - shift).ok()?;
        let end = u32::try_from(i64::from(run.cluster_end) - shift).ok()?;
        let runs = &previous.layout_runs.runs;
        let candidate = runs.get(runs.partition_point(|old| old.cluster_start < start))?;
        (candidate.cluster_start == start
            && candidate.cluster_end == end
            && candidate.glyph_count == run.glyph_count
            && candidate.font_handle == run.font_handle
            && candidate.source_kind == run.source_kind)
            .then_some(candidate.canonical_revision)
            .flatten()
    }
}

/// Two arenas and the inputs each was built from.
#[derive(Clone, Copy)]
struct RunPair<'a> {
    new: &'a ClusterArena,
    old: &'a ClusterArena,
    new_input: RunCanonicalInput<'a>,
    old_input: RunCanonicalInput<'a>,
}

/// What the layout of a stretch of clusters reads besides the cluster lanes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Sources {
    Same,
    /// Metrics differ: the clusters changed, the pairing stands.
    Metrics,
    /// A shaping input differs: the pairing itself means nothing.
    Shaping,
}

impl RunPair<'_> {
    fn run_clusters(arena: &ClusterArena, run: LayoutRun) -> Result<Range<usize>, EngineError> {
        let (start, end) = (run.cluster_start as usize, run.cluster_end as usize);
        if start >= end || end > arena.starts.len() {
            return Err(EngineError::InvalidRequest);
        }
        let glyphs = glyph_span(arena, start, end);
        if glyphs.start != run.glyph_start as usize || glyphs.len() != run.glyph_count as usize {
            return Err(EngineError::InvalidRequest);
        }
        Ok(start..end)
    }

    fn text_range(arena: &ClusterArena, clusters: Range<usize>) -> Range<usize> {
        arena.starts[clusters.start] as usize..arena.ends[clusters.end - 1] as usize
    }

    /// Whether the text and the unit ids under two cluster ranges are the same.
    fn text_equal(&self, new: Range<usize>, old: Range<usize>) -> Result<bool, EngineError> {
        let (new, old) = (
            Self::text_range(self.new, new),
            Self::text_range(self.old, old),
        );
        fn slices(
            input: RunCanonicalInput<'_>,
            range: Range<usize>,
        ) -> Result<(&[u16], &[u32]), EngineError> {
            input
                .text
                .get(range.clone())
                .zip(input.text_unit_ids.get(range))
                .ok_or(EngineError::InvalidRequest)
        }
        let (new_text, new_ids) = slices(self.new_input, new)?;
        let (old_text, old_ids) = slices(self.old_input, old)?;
        Ok(lanes_equal!(new_text, old_text) && lanes_equal!(new_ids, old_ids))
    }

    fn style(input: RunCanonicalInput<'_>, index: u32) -> Result<ResolvedStyle, EngineError> {
        input
            .styles
            .get(index as usize)
            .map(|segment| segment.style)
            .ok_or(EngineError::InvalidRequest)
    }

    fn shaping_run(input: RunCanonicalInput<'_>, index: u32) -> Result<ShapingRun, EngineError> {
        input
            .shaping_runs
            .get(index as usize)
            .copied()
            .ok_or(EngineError::InvalidRequest)
    }

    /// Compares what `len` paired clusters read through their style and source-run indexes,
    /// resolving each distinct pair of indexes once.
    fn sources(&self, new: usize, old: usize, len: usize) -> Result<Sources, EngineError> {
        let mut worst = Sources::Same;
        let lanes = (
            &self.new.style_indexes[new..new + len],
            &self.old.style_indexes[old..old + len],
            &self.new.source_runs[new..new + len],
            &self.old.source_runs[old..old + len],
        );
        let mut at = 0;
        while at < len {
            let styles = (lanes.0[at], lanes.1[at]);
            let runs = (lanes.2[at], lanes.3[at]);
            let next = at
                + lanes.0[at..]
                    .iter()
                    .zip(&lanes.1[at..])
                    .zip(lanes.2[at..].iter().zip(&lanes.3[at..]))
                    .position(|(pair, sources)| {
                        (*pair.0, *pair.1) != styles || (*sources.0, *sources.1) != runs
                    })
                    .unwrap_or(len - at);
            let (new_style, old_style) = (
                Self::style(self.new_input, styles.0)?,
                Self::style(self.old_input, styles.1)?,
            );
            let stretch = match runs {
                (NO_SOURCE_RUN, NO_SOURCE_RUN) => Sources::Same,
                (NO_SOURCE_RUN, _) | (_, NO_SOURCE_RUN) => Sources::Shaping,
                (new_run, old_run) => {
                    let new_run = Self::shaping_run(self.new_input, new_run)?;
                    let old_run = Self::shaping_run(self.old_input, old_run)?;
                    if new_run.direction == old_run.direction
                        && new_run.bidi_level == old_run.bidi_level
                        && new_run.script == old_run.script
                    {
                        Sources::Same
                    } else {
                        Sources::Shaping
                    }
                }
            };
            let stretch = if stretch == Sources::Shaping
                || !shaping_inputs_equal(
                    new_style,
                    self.new_input.style_arena,
                    old_style,
                    self.old_input.style_arena,
                ) {
                Sources::Shaping
            } else if geometric_style_equal(
                new_style,
                self.new_input.style_arena,
                old_style,
                self.old_input.style_arena,
            ) {
                Sources::Same
            } else {
                Sources::Metrics
            };
            worst = match (worst, stretch) {
                (Sources::Shaping, _) | (_, Sources::Shaping) => Sources::Shaping,
                (Sources::Metrics, _) | (_, Sources::Metrics) => Sources::Metrics,
                _ => Sources::Same,
            };
            at = next;
        }
        Ok(worst)
    }

    /// Whether `len` paired clusters have the same layout lanes and the same glyphs. Stable
    /// glyph ids are identity, not layout, and are compared only when `identity` asks.
    fn lanes_equal(&self, new: usize, old: usize, len: usize, identity: bool) -> bool {
        let (a, b) = (self.new, self.old);
        let (n, o) = (new..new + len, old..old + len);
        // Clusters tile the text, so equal lengths are equal ends at one shift of the starts.
        let lengths = a.starts[n.clone()]
            .iter()
            .zip(&a.ends[n.clone()])
            .zip(b.starts[o.clone()].iter().zip(&b.ends[o.clone()]))
            .fold(
                true,
                |equal, ((new_start, new_end), (old_start, old_end))| {
                    equal & (new_end - new_start == old_end - old_start)
                },
            );
        if !(lengths
            & lanes_equal!(&a.stable_ids[n.clone()], &b.stable_ids[o.clone()])
            & lanes_equal!(&a.glyph_counts[n.clone()], &b.glyph_counts[o.clone()])
            & lanes_equal!(&a.flags[n.clone()], &b.flags[o.clone()])
            & lanes_equal!(&a.font_handles[n.clone()], &b.font_handles[o.clone()])
            & lanes_equal!(&a.shaped[n.clone()], &b.shaped[o.clone()])
            & lanes_equal!(&a.unsafe_before[n.clone()], &b.unsafe_before[o.clone()])
            & lanes_equal!(&a.advance_units[n.clone()], &b.advance_units[o.clone()])
            & bits_equal(&a.advances[n.clone()], &b.advances[o.clone()])
            & bits_equal(&a.units_per_em[n.clone()], &b.units_per_em[o.clone()]))
        {
            return false;
        }
        // Equal glyph counts make the two glyph spans the same length, cluster for cluster.
        let (n, o) = (glyph_span(a, new, new + len), glyph_span(b, old, old + len));
        lanes_equal!(&a.glyph_ids[n.clone()], &b.glyph_ids[o.clone()])
            & lanes_equal!(
                &a.glyph_x_advances[n.clone()],
                &b.glyph_x_advances[o.clone()]
            )
            & lanes_equal!(&a.glyph_x_offsets[n.clone()], &b.glyph_x_offsets[o.clone()])
            & lanes_equal!(&a.glyph_y_offsets[n.clone()], &b.glyph_y_offsets[o.clone()])
            & lanes_equal!(
                &a.glyph_shape_flags[n.clone()],
                &b.glyph_shape_flags[o.clone()]
            )
            & (!identity || lanes_equal!(&a.glyph_stable_ids[n], &b.glyph_stable_ids[o]))
    }

    /// Whether a layout run is canonically equal to the run it is paired with, recording in
    /// `dirty` the text of each cluster that is not while `dirty` stays valid. While it does
    /// and the caller has proven the styles unchanged, the walk does not compare them.
    fn canonically_equal(
        &self,
        new_run: LayoutRun,
        old_run: LayoutRun,
        mut dirty: Option<&mut LayoutDirtyRanges>,
        styles_proven: bool,
    ) -> Result<bool, EngineError> {
        let new = Self::run_clusters(self.new, new_run)?;
        let old = Self::run_clusters(self.old, old_run)?;
        if new.len() != old.len()
            || new_run.glyph_count != old_run.glyph_count
            || new_run.font_handle != old_run.font_handle
        {
            if let Some(dirty) = dirty {
                dirty.valid = false;
            }
            return Ok(false);
        }
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.canonical_text_validations += 1);
        let text_equal = self.text_equal(new.clone(), old.clone())?;
        let valid =
            |dirty: &Option<&mut LayoutDirtyRanges>| dirty.as_ref().is_some_and(|d| d.valid);
        if !text_equal && !valid(&dirty) {
            return Ok(false);
        }
        let mut equal = text_equal;
        for offset in (0..new.len()).step_by(LAYOUT_CHUNK) {
            let len = LAYOUT_CHUNK.min(new.len() - offset);
            let (new, old) = (new.start + offset, old.start + offset);
            // The whole comparison, styles included: a chunk that passes it is equal whether
            // or not the walk below would have skipped the styles.
            if self.lanes_equal(new, old, len, true)
                && (text_equal || self.text_equal(new..new + len, old..old + len)?)
                && self.sources(new, old, len)? == Sources::Same
            {
                if let Some(dirty) = dirty.as_deref_mut() {
                    dirty.valid &= self.coordinates_kept(new, old, len);
                }
                continue;
            }
            let Some(dirty) = dirty.as_deref_mut().filter(|dirty| dirty.valid) else {
                return Ok(false);
            };
            for cluster in 0..len {
                let (new, old) = (new + cluster, old + cluster);
                dirty.valid &= self.coordinates_kept(new, old, 1);
                let cluster_equal = clusters_canonically_equal(
                    self.new,
                    new,
                    self.new_input,
                    self.old,
                    old,
                    self.old_input,
                    ClusterComparison {
                        text_equal,
                        styles_unchanged: styles_proven && dirty.valid,
                    },
                )?;
                if !cluster_equal {
                    if dirty.valid {
                        dirty.record(self.new.starts[new]..self.new.ends[new])?;
                    }
                    equal = false;
                    if !dirty.valid {
                        return Ok(false);
                    }
                }
            }
        }
        Ok(equal)
    }

    /// Whether paired clusters sit at the same index and text offsets with the same glyph
    /// counts and no break correction: what a source-coordinate dirty range relies on.
    fn coordinates_kept(&self, new: usize, old: usize, len: usize) -> bool {
        let (a, b) = (self.new, self.old);
        let (n, o) = (new..new + len, old..old + len);
        let corrected = a.flags[n.clone()]
            .iter()
            .zip(&b.flags[o.clone()])
            .fold(0, |flags, (new, old)| flags | new | old)
            & CLUSTER_BREAK_CORRECTION
            != 0;
        new == old
            && !corrected
            && lanes_equal!(&a.starts[n.clone()], &b.starts[o.clone()])
            && lanes_equal!(&a.ends[n.clone()], &b.ends[o.clone()])
            && lanes_equal!(&a.glyph_counts[n], &b.glyph_counts[o])
    }

    /// The changed ranges under a pairing: what no segment pairs, and inside a segment every
    /// cluster whose lanes differ.
    fn changes(
        &self,
        segments: &[Segment],
        changes: &mut ClusterChanges,
    ) -> Result<(), EngineError> {
        let (mut new_at, mut old_at) = (0_u32, 0_u32);
        let gap = |changes: &mut ClusterChanges, new: Range<u32>, old: Range<u32>| {
            if new.is_empty() && old.is_empty() {
                Ok(())
            } else {
                changes.push(new, old)
            }
        };
        for segment in segments {
            if segment.new_start < new_at || segment.old_start < old_at {
                // Ids never pass each other under edits; a pairing that says so pairs nothing.
                changes.ranges.clear();
                return Ok(());
            }
            gap(
                changes,
                new_at..segment.new_start,
                old_at..segment.old_start,
            )?;
            for offset in (0..segment.len).step_by(LAYOUT_CHUNK) {
                let len = (LAYOUT_CHUNK as u32).min(segment.len - offset);
                let (new, old) = (segment.new_start + offset, segment.old_start + offset);
                if !self.chunk_changes(new, old, len, changes)? {
                    changes.ranges.clear();
                    return Ok(());
                }
            }
            new_at = segment.new_start + segment.len;
            old_at = segment.old_start + segment.len;
        }
        gap(
            changes,
            new_at..self.new.starts.len() as u32,
            old_at..self.old.starts.len() as u32,
        )?;
        changes.everything = false;
        Ok(())
    }

    /// Records the changed clusters of one chunk. `false` when a shaping input changed under
    /// it, which withdraws the whole comparison.
    fn chunk_changes(
        &self,
        new: u32,
        old: u32,
        len: u32,
        changes: &mut ClusterChanges,
    ) -> Result<bool, EngineError> {
        let (new_at, old_at, count) = (new as usize, old as usize, len as usize);
        let bindings = |new: usize, old: usize, len: usize| {
            lanes_equal!(
                &self.new.binding_handles[new..new + len],
                &self.old.binding_handles[old..old + len]
            )
        };
        let sources = self.sources(new_at, old_at, count)?;
        if sources == Sources::Shaping {
            return Ok(false);
        }
        if sources == Sources::Same
            && self.lanes_equal(new_at, old_at, count, false)
            && bindings(new_at, old_at, count)
        {
            return Ok(true);
        }
        for cluster in 0..len {
            let (new_at, old_at) = ((new + cluster) as usize, (old + cluster) as usize);
            if !(self.lanes_equal(new_at, old_at, 1, false)
                && bindings(new_at, old_at, 1)
                && self.sources(new_at, old_at, 1)? == Sources::Same)
            {
                changes.push(
                    new + cluster..new + cluster + 1,
                    old + cluster..old + cluster + 1,
                )?;
            }
        }
        Ok(true)
    }
}

/// Whether two styles shape text the same way: font stack, direction, language and features.
fn shaping_inputs_equal(
    new: ResolvedStyle,
    new_arena: &StyleArena,
    old: ResolvedStyle,
    old_arena: &StyleArena,
) -> bool {
    new.font_stack_handle == old.font_stack_handle
        && new.direction == old.direction
        && new.bidi_override == old.bidi_override
        && new_arena.resolved_language(new) == old_arena.resolved_language(old)
        && new_arena.resolved_features(new) == old_arena.resolved_features(old)
}

/// What the per-cluster rule over canonical views gives for one comparison: each run's
/// revision, the next revision, and the dirty proof.
#[cfg(any(test, feature = "debug-validation"))]
pub(super) struct ViewRuleRevisions {
    revisions: Vec<Option<RunCanonicalRevision>>,
    next_revision: u32,
    dirty: Option<LayoutDirtyRanges>,
}

/// The lane comparisons above replace a rule stated cluster by cluster over canonical views,
/// which inline leaves still use. Tests and validation builds run both on every comparison.
#[cfg(any(test, feature = "debug-validation"))]
impl ClusterArena {
    pub(super) fn assert_glyph_ids_follow_the_view_rule(
        &self,
        previous: &Self,
        first_id: u32,
        next_id: u32,
    ) {
        let mut expected = alloc::vec![0; self.glyph_ids.len()];
        let mut expected_next = first_id;
        #[cfg(test)]
        let work = crate::engine::work_attribution::snapshot();
        let assigned = super::assign_stable_glyph_ids_from_view(
            previous,
            self.stable_ids.len(),
            |cluster| {
                Some((
                    *self.stable_ids.get(cluster)?,
                    *self.glyph_starts.get(cluster)?,
                    *self.glyph_counts.get(cluster)?,
                ))
            },
            &mut expected,
            &mut IdentityIndex::default(),
            &mut expected_next,
        );
        // The check is not the engine's work.
        #[cfg(test)]
        crate::engine::work_attribution::record(|current| *current = work);
        assert!(assigned.is_ok(), "the view rule rejects these arenas");
        assert!(
            expected == self.glyph_stable_ids,
            "glyph ids differ from the view rule"
        );
        assert_eq!(expected_next, next_id, "allocated a different id count");
    }

    pub(super) fn revisions_by_the_view_rule(
        &self,
        previous: &Self,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        next_revision: u32,
        dirty: Option<(bool, bool)>,
    ) -> Option<ViewRuleRevisions> {
        #[cfg(test)]
        let work = crate::engine::work_attribution::snapshot();
        let mut index = IdentityIndex::default();
        prepare_run_revision_index(previous, &mut index).ok()?;
        let mut expected = ViewRuleRevisions {
            revisions: Vec::new(),
            next_revision,
            dirty: dirty.map(|(valid, _)| LayoutDirtyRanges {
                ranges: Vec::new(),
                valid,
            }),
        };
        let proven = dirty.is_some_and(|(_, proven)| proven);
        for run in &self.layout_runs.runs {
            let revision = super::canonical_revision_for_run(
                super::RunCanonicalSubject {
                    view: self,
                    run: *run,
                    input: current,
                },
                previous,
                committed,
                &index,
                &mut expected.next_revision,
                expected.dirty.as_mut().map(|dirty| (dirty, proven)),
            );
            expected.revisions.push(revision.ok());
        }
        #[cfg(test)]
        crate::engine::work_attribution::record(|current| *current = work);
        Some(expected)
    }

    pub(super) fn assert_revisions_follow_the_view_rule(
        &self,
        previous: &Self,
        expected: Option<ViewRuleRevisions>,
        next_revision: u32,
        dirty: Option<&LayoutDirtyRanges>,
    ) {
        let expected = expected.expect("the view rule rejects the previous runs");
        let revisions: Vec<_> = self
            .layout_runs
            .runs
            .iter()
            .map(|run| run.canonical_revision)
            .collect();
        assert!(
            revisions == expected.revisions,
            "run revisions differ from the view rule"
        );
        assert_eq!(next_revision, expected.next_revision);
        match (dirty, &expected.dirty) {
            (Some(dirty), Some(expected)) => {
                assert_eq!(dirty.valid, expected.valid, "dirty proof validity");
                // Ranges are meaningful only while the proof is valid.
                assert!(
                    !dirty.valid || dirty.ranges == expected.ranges,
                    "dirty text ranges differ from the view rule"
                );
            }
            (None, None) => {}
            _ => panic!("one rule kept a dirty proof and the other did not"),
        }
        self.assert_changes_cover_every_difference(previous);
    }

    /// Every cluster outside the changed ranges has the counterpart the ranges imply, with the
    /// same identity, glyphs and advance, read here one cluster at a time.
    fn assert_changes_cover_every_difference(&self, previous: &Self) {
        if self.changes.everything {
            return;
        }
        let (mut new_at, mut old_at) = (0_usize, 0_usize);
        let glyphs = |arena: &Self, cluster: usize| {
            let span = glyph_span(arena, cluster, cluster + 1);
            (
                arena.glyph_ids[span.clone()].to_vec(),
                arena.glyph_x_advances[span.clone()].to_vec(),
                arena.glyph_x_offsets[span.clone()].to_vec(),
                arena.glyph_y_offsets[span.clone()].to_vec(),
                arena.glyph_shape_flags[span].to_vec(),
            )
        };
        let kept = |new: Range<usize>, old: Range<usize>| {
            assert_eq!(new.len(), old.len(), "kept stretches pair");
            for (new, old) in new.zip(old) {
                assert_eq!(self.stable_ids[new], previous.stable_ids[old]);
                assert_eq!(
                    self.advances[new].to_bits(),
                    previous.advances[old].to_bits()
                );
                assert_eq!(self.flags[new], previous.flags[old]);
                assert_eq!(self.unsafe_before[new], previous.unsafe_before[old]);
                assert_eq!(self.font_handles[new], previous.font_handles[old]);
                assert_eq!(self.binding_handles[new], previous.binding_handles[old]);
                assert!(glyphs(self, new) == glyphs(previous, old), "kept glyphs");
            }
        };
        for range in &self.changes.ranges {
            assert!(
                range.new.start as usize >= new_at && range.old.start as usize >= old_at,
                "ranges ascend"
            );
            kept(
                new_at..range.new.start as usize,
                old_at..range.old.start as usize,
            );
            new_at = range.new.end as usize;
            old_at = range.old.end as usize;
        }
        kept(new_at..self.starts.len(), old_at..previous.starts.len());
    }
}
