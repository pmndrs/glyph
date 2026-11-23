use alloc::vec::Vec;
use core::{
    cell::{Cell, RefCell},
    num::NonZeroU32,
};

use crate::{FontGlyphExtents, FontInkTable, FontMetrics, unicode::UnicodeAnalysis};

mod breaks;
mod build;
mod diff;
mod equality;
mod layout_runs;
mod placement;
mod rebuild;
mod splice;
mod stable_ids;
mod styles;
pub(crate) use equality::runs_canonically_equal;
use equality::*;
pub(crate) use layout_runs::intrinsic_widths_from_facts;
use layout_runs::*;
pub(crate) use stable_ids::{
    assign_stable_glyph_ids_from_view, canonical_revision_for_run, prepare_run_revision_index,
};

pub(crate) use diff::ClusterChanges;
pub(crate) use splice::{RunWindow, SourceRunSplice};

use super::{
    EngineError, FrameFault,
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    identity_index::{IdentityIndex, identity_index_error},
    line_composition::Correction,
    reserve_vec as reserve,
    run_local::{Inherited, NumericBlockSpan, RunLocalArena},
    shaping_state::{ShapeArena, ShapingRun},
    style_state::{ResolvedStyle, StyleArena, StyleSegment},
};

pub(crate) const CLUSTER_SAFE_BEFORE: u8 = 1 << 0;
pub(crate) const CLUSTER_REQUIRED_BREAK: u8 = 1 << 1;
pub(crate) const CLUSTER_HARD_BREAK: u8 = 1 << 2;
pub(crate) const CLUSTER_ALLOWED_BREAK: u8 = 1 << 3;
/// The cluster starts with U+0020 — a justifiable, shrinkable word space.
pub(crate) const CLUSTER_SPACE: u8 = 1 << 4;
/// Chunk-summary marker for a negative advance, packed above the cluster flag domain.
pub(crate) const CHUNK_NEGATIVE_ADVANCE: u8 = 1 << 5;
/// A UAX #14 optional break opportunity that ends this cluster but is not shaping-safe:
/// the glyphs on either side kern or ligate across it (#216). A line that breaks here needs
/// the boundary reshaped, so the fitter charges a break correction to lines ending or
/// starting at this cluster boundary instead of dropping the opportunity. The chunk
/// summaries exclude this bit; corrections are paid only where a break is evaluated.
pub(crate) const CLUSTER_BREAK_CORRECTION: u8 = 1 << 6;
/// The cluster flag bits a chunk summary folds; summary-only markers and the correction
/// marker live outside it.
const CHUNK_SUMMARY_FLAGS: u8 = !(CHUNK_NEGATIVE_ADVANCE | CLUSTER_BREAK_CORRECTION);

use super::shaping_state::GLYPH_FLAG_UNSAFE_TO_BREAK as GLYPH_UNSAFE_TO_BREAK;

/// Intrinsic inline extents derived from one cluster-arena scan, mirroring the
/// line breaker's own wrap-codec decisions rather than approximating them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicWidths {
    pub min_content_width: f64,
    pub max_content_width: f64,
}

/// Times one cluster-stage entry point for the stage bench; nothing without the feature.
#[cfg(feature = "stage-bench")]
use super::oracle::stage_bench::ClusterStageClock as StageClock;
#[cfg(not(feature = "stage-bench"))]
struct StageClock;
#[cfg(not(feature = "stage-bench"))]
impl StageClock {
    #[inline(always)]
    const fn start() -> Self {
        Self
    }
}

pub(crate) const NO_SOURCE_RUN: u32 = u32::MAX;
pub(super) const SHAPING_CONTEXT: usize = 5;
/// The most clusters an island may span and still be reshaped: real ones (a ligature, a contextual arrow) cover a
/// few, so a longer chain is a font that flags every boundary unsafe, and its breaks stay uncorrected, as on main.
pub(super) const ISLAND_CAP: usize = 32;
/// Cluster count per chunk summary (D-245).
pub(crate) const LAYOUT_CHUNK: usize = 64;

/// One cumulative word-wrap opportunity in the sparse-prose sidecar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WordBreakRecord {
    pub cluster_end: u32,
    pub advance_units: i32,
    pub space_units: i32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum WordSidecarMode {
    #[default]
    Unbuilt,
    Short,
    Sparse,
    Dense,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlacementCluster {
    pub segment_anchor: u32,
    pub dense: bool,
    pub numeric_block_ordinal: u32,
    pub block_local_prefix: f64,
    pub block_anchor_inline: f64,
    pub block_anchor_block: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct RunCanonicalRevision(NonZeroU32);

impl RunCanonicalRevision {
    pub(crate) const fn get(self) -> u32 {
        self.0.get()
    }

    pub(crate) fn allocate(next: &mut u32) -> Result<Self, EngineError> {
        let value = (*next).max(1);
        let revision = NonZeroU32::new(value).ok_or(EngineError::RevisionExhausted)?;
        *next = value.checked_add(1).ok_or(EngineError::RevisionExhausted)?;
        Ok(Self(revision))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BoundaryRunRole {
    BoundarySource,
    Ellipsis,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LayoutRunSourceKind {
    Paragraph,
    Boundary {
        flow_thread_id: u32,
        role: BoundaryRunRole,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LayoutRun {
    pub source_kind: LayoutRunSourceKind,
    pub cluster_start: u32,
    pub cluster_end: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
    /// First shaping run in this geometry run. Adjacent script runs may merge when direction,
    /// bidi level, selected font, and layout geometry agree.
    pub source_run: u32,
    pub font_handle: u32,
    pub numeric_blocks: NumericBlockSpan,
    /// Exact retained local-content token. `None` exists only while a pending cluster arena is
    /// being built; every committed run has a revision assigned by the shared finalizer.
    pub canonical_revision: Option<RunCanonicalRevision>,
}

/// Exact normalized facts consumed by stable-ID and run-revision comparison. The view is sealed
/// to this engine: General borrows its SoA lanes, Inline borrows its compact cluster/raw rows.
/// Neither transition rebuilds the other owner's glyph arena merely to compare identities.
#[derive(Clone, Copy)]
pub(crate) struct CanonicalCluster {
    pub text_start: u32,
    pub text_end: u32,
    pub stable_text_id: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
    pub advance: f64,
    pub advance_units: i64,
    pub units_per_em: f64,
    pub flags: u8,
    pub style_index: u32,
    pub source_run: u32,
    pub font_handle: u32,
    pub shaped: u8,
    pub unsafe_before: u8,
}

#[derive(Clone, Copy)]
pub(crate) struct CanonicalGlyph {
    pub stable_id: u32,
    pub glyph_id: u16,
    pub x_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub flags: u16,
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) trait CanonicalClusterView {
    fn cluster_count(&self) -> usize;
    fn cluster(&self, index: usize) -> Option<CanonicalCluster>;
    fn glyph(&self, index: usize) -> Option<CanonicalGlyph>;
    fn layout_run_count(&self) -> usize;
    fn layout_run(&self, index: usize) -> Option<LayoutRun>;

    // Identity assignment and run lookup only need these lanes. A General arena can
    // carry them before its full canonical cluster and glyph facts are populated.
    fn identity_cluster_count(&self) -> usize {
        self.cluster_count()
    }

    fn stable_text_id(&self, index: usize) -> Option<u32> {
        self.cluster(index).map(|cluster| cluster.stable_text_id)
    }

    fn glyph_span(&self, index: usize) -> Option<(u32, u32)> {
        self.cluster(index)
            .map(|cluster| (cluster.glyph_start, cluster.glyph_count))
    }

    fn stable_glyph_id(&self, index: usize) -> Option<u32> {
        self.glyph(index).map(|glyph| glyph.stable_id)
    }

    /// The cluster arena behind this view, whose lanes can be compared directly.
    fn cluster_arena(&self) -> Option<&ClusterArena> {
        None
    }
}

/// The run and its source facts must come from the same prepared owner.
pub(crate) struct RunCanonicalSubject<'a> {
    pub view: &'a dyn CanonicalClusterView,
    pub run: LayoutRun,
    pub input: RunCanonicalInput<'a>,
}

/// Candidate-only source-coordinate proof, reused across preparations without dropping capacity.
#[derive(Default)]
pub(crate) struct LayoutDirtyRanges {
    pub ranges: Vec<core::ops::Range<u32>>,
    pub valid: bool,
}

impl LayoutDirtyRanges {
    pub fn clear(&mut self) {
        self.ranges.clear();
        self.valid = false;
    }

    fn record(&mut self, range: core::ops::Range<u32>) -> Result<(), EngineError> {
        if let Some(last) = self.ranges.last_mut()
            && last.end == range.start
        {
            last.end = range.end;
        } else {
            self.ranges
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.ranges.push(range);
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(crate) struct RunCanonicalInput<'a> {
    pub text: &'a [u16],
    pub text_unit_ids: &'a [u32],
    pub style_arena: &'a StyleArena,
    pub styles: &'a [StyleSegment],
    pub shaping_runs: &'a [ShapingRun],
}

#[derive(Default)]
pub(super) struct LayoutRunArena {
    runs: Vec<LayoutRun>,
}

impl LayoutRunArena {
    fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.runs, capacity)
    }

    fn clear(&mut self) {
        self.runs.clear();
    }

    fn push(&mut self, run: LayoutRun) -> Result<(), EngineError> {
        self.runs
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.runs.push(run);
        Ok(())
    }
}

#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    // LAYOUT_CHUNK bounds this sum to 64 layout-unit values, each bounded to ±2^53.
    advances.iter().sum()
}

/// One run of `shape` per boundary side that was shaped: `slots[boundary - 1]` holds the `[L, R]` run index + 1, or 0.
#[derive(Default)]
pub(super) struct IslandShapes {
    pub(super) shape: ShapeArena,
    /// The island of a range that is no boundary's own, shaped for one use.
    pub(super) once: ShapeArena,
    pub(super) slots: Vec<[u32; 2]>,
}

#[derive(Default)]
pub(crate) struct ClusterArena {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub advances: Vec<f64>,
    /// F16.16 quantization of `advances` under the layout-unit rounding contract,
    /// refreshed at the end of every build. Slice 2a keeps the f64 stream
    /// authoritative; the integer fit consumes this stream and must match.
    pub advance_units: Vec<i64>,
    /// Chunk-64 summaries over `advance_units`/`flags`, refreshed with them: total
    /// advance, OR-folded flags, and a tagged space-sum or negative-prefix auxiliary per chunk.
    pub chunk_advance_sums: Vec<i64>,
    pub chunk_auxiliary_sums: Vec<i64>,
    pub chunk_flags_or: Vec<u8>,
    pub word_breaks: Vec<WordBreakRecord>,
    pub(crate) word_sidecar_mode: WordSidecarMode,
    // Stable word/run root per cluster. Positioning reads this directly instead of
    // rediscovering roots while every changed line is traversed.
    pub(super) placement_segment_anchors: Vec<u32>,
    /// Per-cluster `units_per_em` of the owning shaped font (0 while unshaped),
    /// resolved once at cluster build. Positioning derives its scale from the
    /// CURRENT style's font size and this column, so font-size-only style changes
    /// stay correct while the per-cluster registry lookup disappears.
    pub units_per_em: Vec<f64>,
    pub flags: Vec<u8>,
    pub style_indexes: Vec<u32>,
    pub source_runs: Vec<u32>,
    pub binding_handles: Vec<u32>,
    pub font_handles: Vec<u32>,
    pub stable_ids: Vec<u32>,
    pub glyph_starts: Vec<u32>,
    pub glyph_counts: Vec<u32>,
    /// Adjacency-order glyph stream: the shape-arena payload scattered into
    /// cluster order at build, so positioning walks these columns sequentially
    /// instead of gathering the shape arrays through a permutation. Refreshed
    /// only when a build re-shapes; geometry changes reuse the stream as-is.
    pub glyph_ids: Vec<u16>,
    pub glyph_clusters: Vec<u32>,
    pub glyph_x_advances: Vec<i32>,
    pub glyph_x_offsets: Vec<i32>,
    pub glyph_y_offsets: Vec<i32>,
    pub glyph_shape_flags: Vec<u16>,
    pub glyph_stable_ids: Vec<u32>,
    pub index_at: Vec<u32>,
    pub(super) shaped: Vec<u8>,
    pub(super) unsafe_before: Vec<u8>,
    /// `[L, R, S]` for the boundary after each cluster, filled lazily by the fitter: the corrections (#216), and `S`
    /// set when L's shaping drew other glyphs than the paragraph, so the font shapes the break as one unit.
    pub(super) break_corrections: Vec<[Cell<Option<Correction>>; 3]>,
    /// The glyphs the islands behind `break_corrections` shape alone, kept for the line edges that draw them. Like
    /// the corrections it is a cache, but only a build or a derived copy empties it, so a relayout shapes nothing.
    pub(super) islands: RefCell<IslandShapes>,
    /// No run is right-to-left or overridden: only then do line edges shape alone, so only then are breaks corrected.
    pub(super) ltr: bool,
    pub(super) layout_runs: LayoutRunArena,
    pub(super) run_local: RunLocalArena,
    /// Build scratch: what each shaped run scales its clusters by.
    pub(super) run_scales: Vec<build::RunScale>,
    /// How these clusters pair with the previous arena's by stable text id, kept from glyph
    /// identity assignment for the lane comparison that follows it while `aligned`.
    pub(super) alignment: Vec<diff::Segment>,
    pub(super) aligned: bool,
    /// Which clusters differ from the arena this one replaces; see `ClusterChanges`.
    pub(super) changes: ClusterChanges,
    /// The clusters the last build spliced, until run-local geometry reads it.
    pub(super) run_local_splice: Option<super::run_local_paragraph::RunLocalSplice>,
    /// What the last build spliced, until the revision pass reads it.
    pub(super) spliced: Option<diff::Spliced>,
}

impl CanonicalClusterView for ClusterArena {
    fn cluster_count(&self) -> usize {
        self.starts.len()
    }

    fn identity_cluster_count(&self) -> usize {
        self.stable_ids.len()
    }

    fn stable_text_id(&self, index: usize) -> Option<u32> {
        self.stable_ids.get(index).copied()
    }

    fn glyph_span(&self, index: usize) -> Option<(u32, u32)> {
        Some((
            *self.glyph_starts.get(index)?,
            *self.glyph_counts.get(index)?,
        ))
    }

    fn stable_glyph_id(&self, index: usize) -> Option<u32> {
        self.glyph_stable_ids.get(index).copied()
    }

    fn cluster(&self, index: usize) -> Option<CanonicalCluster> {
        Some(CanonicalCluster {
            text_start: *self.starts.get(index)?,
            text_end: *self.ends.get(index)?,
            stable_text_id: *self.stable_ids.get(index)?,
            glyph_start: *self.glyph_starts.get(index)?,
            glyph_count: *self.glyph_counts.get(index)?,
            advance: *self.advances.get(index)?,
            advance_units: *self.advance_units.get(index)?,
            units_per_em: *self.units_per_em.get(index)?,
            flags: *self.flags.get(index)?,
            style_index: *self.style_indexes.get(index)?,
            source_run: *self.source_runs.get(index)?,
            font_handle: *self.font_handles.get(index)?,
            shaped: *self.shaped.get(index)?,
            unsafe_before: *self.unsafe_before.get(index)?,
        })
    }

    fn glyph(&self, index: usize) -> Option<CanonicalGlyph> {
        Some(CanonicalGlyph {
            stable_id: *self.glyph_stable_ids.get(index)?,
            glyph_id: *self.glyph_ids.get(index)?,
            x_advance: *self.glyph_x_advances.get(index)?,
            x_offset: *self.glyph_x_offsets.get(index)?,
            y_offset: *self.glyph_y_offsets.get(index)?,
            flags: *self.glyph_shape_flags.get(index)?,
        })
    }

    fn layout_run_count(&self) -> usize {
        self.layout_runs.runs.len()
    }

    fn layout_run(&self, index: usize) -> Option<LayoutRun> {
        self.layout_runs.runs.get(index).copied()
    }

    fn cluster_arena(&self) -> Option<&ClusterArena> {
        Some(self)
    }
}

pub(crate) struct ClusterBuildInput<'a> {
    pub text: &'a [u16],
    pub text_unit_ids: &'a [u32],
    pub unicode: &'a UnicodeAnalysis,
    pub styles: &'a [StyleSegment],
    pub runs: &'a [ShapingRun],
    pub shape: &'a ShapeArena,
}

fn all_ltr(runs: &[ShapingRun]) -> bool {
    runs.iter()
        .all(|run| run.bidi_level & 1 == 0 && !run.style.bidi_override)
}

impl ClusterArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.starts, capacity)?;
        reserve(&mut self.ends, capacity)?;
        reserve(&mut self.advances, capacity)?;
        reserve(&mut self.advance_units, capacity)?;
        reserve(&mut self.placement_segment_anchors, capacity)?;
        reserve(&mut self.units_per_em, capacity)?;
        reserve(&mut self.flags, capacity)?;
        reserve(&mut self.style_indexes, capacity)?;
        reserve(&mut self.source_runs, capacity)?;
        reserve(&mut self.binding_handles, capacity)?;
        reserve(&mut self.font_handles, capacity)?;
        reserve(&mut self.stable_ids, capacity)?;
        reserve(&mut self.glyph_starts, capacity)?;
        reserve(&mut self.glyph_counts, capacity)?;
        reserve(&mut self.glyph_ids, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_clusters, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_x_advances, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_x_offsets, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_y_offsets, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_shape_flags, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_stable_ids, capacity.saturating_mul(2))?;
        reserve(&mut self.index_at, capacity.saturating_add(1))?;
        reserve(&mut self.shaped, capacity)?;
        reserve(&mut self.unsafe_before, capacity)?;
        reserve(&mut self.break_corrections, capacity)?;
        Ok(())
    }

    fn same_owner(&self, a: usize, b: usize) -> bool {
        [&self.source_runs, &self.binding_handles, &self.font_handles]
            .iter()
            .all(|lane| lane[a] == lane[b])
    }

    /// The clusters `[start, end)` around `boundary` between shaping-safe boundaries and font owners.
    pub(super) fn island(&self, boundary: usize) -> (usize, usize) {
        let (mut start, mut end) = (boundary, boundary + 1);
        // Each walk stops one cluster past the cap, which is all it takes to see an island is too long.
        let (lowest, highest) = (
            boundary.saturating_sub(ISLAND_CAP + 1),
            (boundary + ISLAND_CAP + 1).min(self.starts.len()),
        );
        let unsafe_before = |i: usize| self.flags[i] & CLUSTER_SAFE_BEFORE == 0;
        while start > lowest && self.same_owner(start - 1, boundary) && unsafe_before(start) {
            start -= 1;
        }
        while end < highest && self.same_owner(end, boundary) && unsafe_before(end) {
            end += 1;
        }
        (start, end)
    }

    /// The island around `boundary`, unless it is too long to reshape.
    pub(super) fn reshapable_island(&self, boundary: usize) -> Option<(usize, usize)> {
        let (start, end) = self.island(boundary);
        (end - start <= ISLAND_CAP).then_some((start, end))
    }

    fn reset_break_corrections(&self, start: usize, end: usize) {
        let end = end.min(self.break_corrections.len());
        let slots = self.break_corrections[start.min(end)..end].iter();
        slots.flatten().for_each(|slot| slot.set(None));
    }

    /// Builds every lane from the shaped paragraph. Run-local ink is left to the next
    /// geometry rebuild; `build_with_ink`, which the engine calls, fills it here.
    #[cfg(test)]
    pub(crate) fn build(
        &mut self,
        input: ClusterBuildInput<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        self.build_with_ink(input, metrics_for, |_| None)
    }

    /// `build`, and the font-unit ink of every glyph beside the glyph stream, so the geometry
    /// rebuild that follows asks no font. `ink_for` is asked once per stretch of clusters one
    /// font owns.
    pub(crate) fn build_with_ink<'ink>(
        &mut self,
        input: ClusterBuildInput<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) -> Result<(), EngineError> {
        let _clock = StageClock::start();
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        self.clear();
        self.ltr = all_ltr(runs);
        if text.len() != text_unit_ids.len() || text_unit_ids.contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        let boundaries = unicode.grapheme_boundaries();
        let count = boundaries.len().saturating_sub(1);
        self.reserve(text.len().max(count))?;
        self.build_headers(text, text_unit_ids, boundaries, styles)?;
        self.build_index(text.len())?;
        self.run_local
            .ink
            .reset(shape.glyph_ids.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        let scope = build::ShapeScope {
            clusters: 0..count,
            source_runs: None,
            glyph_base: 0,
        };
        if self.aggregate_shape(runs, shape, scope, metrics_for, ink_for)? {
            self.run_local.keep_ink();
        }
        self.rebuild_layout_runs_for_shaping(runs)?;
        self.apply_break_flags(unicode)?;
        self.refresh_layout_units()?;
        #[cfg(test)]
        super::work_attribution::record(|work| work.cluster_full_builds += 1);
        Ok(())
    }

    #[inline(never)]
    pub(crate) fn clear(&mut self) {
        self.starts.clear();
        self.ends.clear();
        self.advances.clear();
        self.advance_units.clear();
        self.chunk_advance_sums.clear();
        self.chunk_auxiliary_sums.clear();
        self.chunk_flags_or.clear();
        self.word_breaks.clear();
        self.word_sidecar_mode = WordSidecarMode::Unbuilt;
        self.placement_segment_anchors.clear();
        self.units_per_em.clear();
        self.flags.clear();
        self.style_indexes.clear();
        self.source_runs.clear();
        self.binding_handles.clear();
        self.font_handles.clear();
        self.stable_ids.clear();
        self.glyph_starts.clear();
        self.glyph_counts.clear();
        self.glyph_ids.clear();
        self.glyph_clusters.clear();
        self.glyph_x_advances.clear();
        self.glyph_x_offsets.clear();
        self.glyph_y_offsets.clear();
        self.glyph_shape_flags.clear();
        self.glyph_stable_ids.clear();
        self.index_at.clear();
        self.shaped.clear();
        self.unsafe_before.clear();
        self.break_corrections.clear();
        let islands = self.islands.get_mut();
        islands.shape.clear();
        islands.once.clear();
        islands.slots.clear();
        self.layout_runs.clear();
        self.run_local.clear();
        self.aligned = false;
        self.changes.reset();
        self.run_local_splice = None;
        self.spliced = None;
        // An arena with no clusters answers like a fresh one, whatever it held before.
        self.ltr = false;
    }

    /// Which clusters differ from the arena this one replaced, as of the last
    /// `finalize_layout_run_revisions`. Nothing in the engine reads it yet: cache retention
    /// across an edit is bounded by these ranges.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn changes(&self) -> &ClusterChanges {
        &self.changes
    }

    pub(crate) fn layout_runs(&self) -> &[LayoutRun] {
        &self.layout_runs.runs
    }

    pub(crate) fn run_local(&self) -> &RunLocalArena {
        &self.run_local
    }

    pub(crate) fn placement_cluster(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
    ) -> Result<PlacementCluster, EngineError> {
        self.placement_cluster_at(run, direction, cluster)
    }

    #[cfg(any(test, feature = "stage-bench"))]
    pub(crate) fn rebuild_run_local_geometry(
        &mut self,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.rebuild_run_local_geometry_from(runs, styles, extents_for, None)
    }

    #[cfg(test)]
    pub(super) fn rebuild_layout_runs(&mut self) -> Result<(), EngineError> {
        self.rebuild_layout_runs_with(|left, right| left == right)
    }

    /// Whether a line may break after cluster `preceding` without reshaping: it is the last
    /// cluster, or its successor shaped with no glyph flagged unsafe-to-break against it.
    fn boundary_is_shaping_safe(&self, preceding: usize) -> bool {
        self.flags
            .get(preceding + 1)
            .is_none_or(|flags| flags & CLUSTER_SAFE_BEFORE != 0)
    }
}

fn is_hard_break(text: &[u16], start: u32) -> Result<bool, EngineError> {
    let unit = *text
        .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(matches!(
        unit,
        0x0a | 0x0b | 0x0c | 0x0d | 0x85 | 0x2028 | 0x2029
    ))
}

#[derive(Clone, Copy)]
struct ClusterComparison {
    text_equal: bool,
    styles_unchanged: bool,
}

fn cluster_style(
    cluster: CanonicalCluster,
    styles: &[StyleSegment],
) -> Result<super::style_state::ResolvedStyle, EngineError> {
    let index = usize::try_from(cluster.style_index).map_err(|_| EngineError::InvalidRequest)?;
    styles
        .get(index)
        .map(|segment| segment.style)
        .ok_or(EngineError::InvalidRequest)
}

fn run_layout_compatible(left: ResolvedStyle, right: ResolvedStyle) -> bool {
    left.same_layout_sources(right)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        shaping_state::{ShapedRun, ShapingRun},
        style_state::{ResolvedStyle, StyleSegment},
    };
    use alloc::vec;

    struct CanonicalFixture {
        arena: ClusterArena,
        text: Vec<u16>,
        text_unit_ids: Vec<u32>,
        style_arena: StyleArena,
        styles: Vec<StyleSegment>,
        shaping_runs: Vec<ShapingRun>,
    }

    fn canonical_fixture(
        text: &[u16],
        text_unit_ids: &[u32],
        source_runs: &[u32],
        style: ResolvedStyle,
    ) -> CanonicalFixture {
        assert_eq!(text.len(), text_unit_ids.len());
        assert_eq!(text.len(), source_runs.len());
        let mut arena = ClusterArena::default();
        for (index, ((&unit, &stable_id), &source_run)) in
            text.iter().zip(text_unit_ids).zip(source_runs).enumerate()
        {
            let start = u32::try_from(index).unwrap();
            arena.starts.push(start);
            arena.ends.push(start + 1);
            arena.advances.push(1.0);
            arena.advance_units.push(65_536);
            arena.units_per_em.push(1_000.0);
            arena.flags.push(CLUSTER_SAFE_BEFORE);
            arena.style_indexes.push(0);
            arena.source_runs.push(source_run);
            arena.binding_handles.push(source_run + 100);
            arena.font_handles.push(7);
            arena.stable_ids.push(stable_id);
            arena.glyph_starts.push(start);
            arena.glyph_counts.push(1);
            arena.glyph_ids.push(unit);
            arena.glyph_clusters.push(start);
            arena.glyph_x_advances.push(1_000);
            arena.glyph_x_offsets.push(0);
            arena.glyph_y_offsets.push(0);
            arena.glyph_shape_flags.push(0);
            arena.glyph_stable_ids.push(stable_id);
            arena.shaped.push(1);
            arena.unsafe_before.push(0);
        }
        arena.rebuild_layout_runs().unwrap();
        let shaping_run_count = source_runs
            .iter()
            .copied()
            .max()
            .map_or(0, |maximum| usize::try_from(maximum).unwrap() + 1);
        let text_end = u32::try_from(text.len()).unwrap();
        let shaping_runs = (0..shaping_run_count)
            .map(|_| ShapingRun {
                text_start: 0,
                text_end,
                script: 0x4c61_746e,
                direction: 0,
                bidi_level: 0,
                style,
            })
            .collect();
        CanonicalFixture {
            arena,
            text: text.to_vec(),
            text_unit_ids: text_unit_ids.to_vec(),
            style_arena: StyleArena::default(),
            styles: vec![StyleSegment {
                text_start: 0,
                text_end,
                style,
            }],
            shaping_runs,
        }
    }

    fn stamp_revisions(fixture: &mut CanonicalFixture, revisions: &[u32]) {
        assert_eq!(fixture.arena.layout_runs.runs.len(), revisions.len());
        for (run, &revision) in fixture.arena.layout_runs.runs.iter_mut().zip(revisions) {
            run.canonical_revision = Some(RunCanonicalRevision(
                NonZeroU32::new(revision).expect("test revision is nonzero"),
            ));
        }
    }

    fn finalize_fixture(
        current: &mut CanonicalFixture,
        previous: &CanonicalFixture,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
    ) {
        finalize_fixture_with_dirty(current, previous, index, next_revision, None);
    }

    fn finalize_fixture_with_dirty(
        current: &mut CanonicalFixture,
        previous: &CanonicalFixture,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
        dirty: Option<(&mut LayoutDirtyRanges, bool)>,
    ) {
        let current_input = RunCanonicalInput {
            text: &current.text,
            text_unit_ids: &current.text_unit_ids,
            style_arena: &current.style_arena,
            styles: &current.styles,
            shaping_runs: &current.shaping_runs,
        };
        let previous_input = RunCanonicalInput {
            text: &previous.text,
            text_unit_ids: &previous.text_unit_ids,
            style_arena: &previous.style_arena,
            styles: &previous.styles,
            shaping_runs: &previous.shaping_runs,
        };
        current
            .arena
            .finalize_layout_run_revisions(
                &previous.arena,
                current_input,
                previous_input,
                index,
                next_revision,
                dirty,
            )
            .unwrap();
    }

    fn revisions(fixture: &CanonicalFixture) -> Vec<u32> {
        fixture
            .arena
            .layout_runs()
            .iter()
            .map(|run| run.canonical_revision.unwrap().get())
            .collect()
    }

    fn shadow_topology(
        source_runs: &[u32],
        font_handles: &[u32],
        glyph_counts: &[u32],
    ) -> ClusterArena {
        assert_eq!(source_runs.len(), font_handles.len());
        assert_eq!(source_runs.len(), glyph_counts.len());
        let mut arena = ClusterArena::default();
        let mut glyph_start = 0_u32;
        for index in 0..source_runs.len() {
            arena.starts.push(u32::try_from(index).unwrap());
            arena.ends.push(u32::try_from(index + 1).unwrap());
            arena.advances.push(0.0);
            arena.source_runs.push(source_runs[index]);
            arena.font_handles.push(font_handles[index]);
            arena.glyph_starts.push(glyph_start);
            arena.glyph_counts.push(glyph_counts[index]);
            glyph_start = glyph_start.checked_add(glyph_counts[index]).unwrap();
        }
        arena.rebuild_layout_runs().unwrap();
        arena
    }

    fn assert_shadow_topology(arena: &ClusterArena) {
        let cluster_count = arena.starts.len();
        let mut cluster_to_run = vec![usize::MAX; cluster_count];
        let mut previous_cluster_end = 0usize;
        for (run_index, run) in arena.layout_runs().iter().enumerate() {
            let cluster_start = usize::try_from(run.cluster_start).unwrap();
            let cluster_end = usize::try_from(run.cluster_end).unwrap();
            assert_eq!(cluster_start, previous_cluster_end, "gapless clusters");
            assert!(cluster_start < cluster_end, "nonempty run");
            assert!(cluster_end <= cluster_count, "bounded run");
            let expected_glyph_start = arena.glyph_starts[cluster_start];
            let expected_glyph_end = arena.glyph_starts[cluster_end - 1]
                .checked_add(arena.glyph_counts[cluster_end - 1])
                .unwrap();
            assert_eq!(run.glyph_start, expected_glyph_start);
            assert_eq!(run.glyph_count, expected_glyph_end - expected_glyph_start);
            for slot in &mut cluster_to_run[cluster_start..cluster_end] {
                assert_eq!(*slot, usize::MAX, "clusters have one owner");
                *slot = run_index;
            }
            for cluster in cluster_start..cluster_end {
                assert_eq!(arena.source_runs[cluster], run.source_run);
                assert_eq!(arena.font_handles[cluster], run.font_handle);
            }
            previous_cluster_end = cluster_end;
        }
        assert_eq!(previous_cluster_end, cluster_count, "all clusters covered");
        for cluster in 1..cluster_count {
            let same_identity = arena.source_runs[cluster - 1] == arena.source_runs[cluster]
                && arena.font_handles[cluster - 1] == arena.font_handles[cluster];
            assert_eq!(
                cluster_to_run[cluster - 1] == cluster_to_run[cluster],
                same_identity
            );
        }
    }

    #[test]
    fn layout_runs_are_gapless_maximal_and_glyph_contiguous() {
        let source_runs = [0, 0, 0, 0, 1, 1, 1, 1];
        let font_handles = [10, 10, 20, 20, 20, 20, 10, 10];
        let arena = shadow_topology(&source_runs, &font_handles, &[1, 2, 0, 1, 3, 0, 2, 1]);

        assert_eq!(
            arena.layout_runs(),
            [
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 0,
                    cluster_end: 2,
                    glyph_start: 0,
                    glyph_count: 3,
                    source_run: 0,
                    font_handle: 10,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 2,
                    cluster_end: 4,
                    glyph_start: 3,
                    glyph_count: 1,
                    source_run: 0,
                    font_handle: 20,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 4,
                    cluster_end: 6,
                    glyph_start: 4,
                    glyph_count: 3,
                    source_run: 1,
                    font_handle: 20,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 6,
                    cluster_end: 8,
                    glyph_start: 7,
                    glyph_count: 3,
                    source_run: 1,
                    font_handle: 10,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                },
            ]
        );
        assert_shadow_topology(&arena);
    }

    #[test]
    fn paragraph_run_owns_direction_canonical_numeric_rows() {
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut fixture = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        fixture.shaping_runs[0].direction = 1;
        fixture.shaping_runs[0].bidi_level = 1;

        fixture
            .arena
            .rebuild_run_local_geometry(&fixture.shaping_runs, &fixture.styles, |_, _| {
                Some(FontGlyphExtents {
                    x_min: 0,
                    y_min: 0,
                    x_max: 500,
                    y_max: 700,
                })
            })
            .unwrap();

        assert_eq!(fixture.arena.layout_runs()[0].numeric_blocks.count, 1);
        assert_eq!(
            fixture.arena.layout_runs()[0].numeric_blocks.cluster_count,
            2
        );
        let blocks = fixture.arena.run_local().blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].source_glyph_start, 0);
        assert_eq!(blocks[0].source_glyph_count, 2);
        let rows = fixture.arena.run_local().rows();
        assert_eq!(rows.len(), 2);
        assert_eq!([rows[0].source_glyph, rows[1].source_glyph], [1, 0]);
        assert_eq!([rows[0].pen_inline, rows[1].pen_inline], [0.0, 1.0]);
        assert_eq!(fixture.arena.run_local().cluster_blocks(), [0, 0]);
        assert_eq!(fixture.arena.run_local().cluster_prefixes(), [0.0, 1.0]);
    }

    #[test]
    fn layout_dirty_ranges_require_exact_coordinates_and_safe_boundaries() {
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let previous = canonical_fixture(
            &[97, 98, 99, 100, 101],
            &[10, 11, 12, 13, 14],
            &[0; 5],
            style,
        );
        let mut dirty = LayoutDirtyRanges::default();
        let mut index = IdentityIndex::default();
        let mut next_revision = 20;
        for negative in 0..3 {
            let mut current = canonical_fixture(
                &[97, 120, 99, 121, 101],
                &[10, 21, 12, 23, 14],
                &[0; 5],
                style,
            );
            if negative == 1 {
                current.arena.starts[2] = 1;
            } else if negative == 2 {
                current.arena.flags[4] |= CLUSTER_BREAK_CORRECTION;
            }
            finalize_fixture_with_dirty(
                &mut current,
                &previous,
                &mut index,
                &mut next_revision,
                Some((&mut dirty, false)),
            );
            if negative == 0 {
                assert!(dirty.valid);
                assert_eq!(dirty.ranges, [1..2, 3..4]);
            } else {
                assert!(!dirty.valid);
            }
        }
        let capacity = dirty.ranges.capacity();
        dirty.clear();
        assert!(!dirty.valid);
        assert!(dirty.ranges.is_empty());
        assert_eq!(dirty.ranges.capacity(), capacity);
    }

    #[test]
    fn canonical_revision_reconciles_insertion_before_by_stable_anchor() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut previous =
            canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        stamp_revisions(&mut previous, &[1]);
        let mut current = canonical_fixture(
            &[b'x' as u16, b'a' as u16, b'b' as u16],
            &[9, 10, 11],
            &[1, 0, 0],
            style,
        );
        let mut index = IdentityIndex::default();
        let mut next_revision = 2;

        finalize_fixture(&mut current, &previous, &mut index, &mut next_revision);

        assert_eq!(revisions(&current), [2, 1]);
        assert_eq!(next_revision, 3);
    }

    /// A paragraph of `ids.len()` one-unit clusters in one run, each drawn as its id's glyph.
    fn changes_fixture(ids: &[u32], style: ResolvedStyle) -> CanonicalFixture {
        let text: Vec<u16> = ids.iter().map(|id| *id as u16).collect();
        let mut fixture = canonical_fixture(&text, ids, &vec![0; ids.len()], style);
        stamp_revisions(&mut fixture, &[1]);
        fixture
    }

    fn changes_between(
        current: &mut CanonicalFixture,
        previous: &CanonicalFixture,
    ) -> Vec<[u32; 4]> {
        finalize_fixture(current, previous, &mut IdentityIndex::default(), &mut 2);
        assert!(!current.arena.changes().everything);
        current
            .arena
            .changes()
            .ranges
            .iter()
            .map(|range| {
                [
                    range.new.start,
                    range.new.end,
                    range.old.start,
                    range.old.end,
                ]
            })
            .collect()
    }

    #[test]
    fn cluster_changes_are_the_edits_and_nothing_else() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let ids: Vec<u32> = (1..=300).collect();
        let previous = changes_fixture(&ids, style);

        // Nothing changed: no range, however many chunks the paragraph spans.
        let mut same = changes_fixture(&ids, style);
        assert!(changes_between(&mut same, &previous).is_empty());

        // One cluster typed after the hundredth.
        let mut typed = ids.clone();
        typed.insert(100, 900);
        let mut inserted = changes_fixture(&typed, style);
        assert_eq!(
            changes_between(&mut inserted, &previous),
            [[100, 101, 100, 100]]
        );

        // Three edits in one request: a deletion, a cluster whose glyph changed in place, and
        // an insertion. The clusters between them pair at the shift each edit leaves.
        let mut edited = ids.clone();
        edited.remove(9);
        edited.insert(250, 901);
        let mut three = changes_fixture(&edited, style);
        three.arena.glyph_ids[149] = 7;
        assert_eq!(
            changes_between(&mut three, &previous),
            [[9, 9, 9, 10], [149, 150, 150, 151], [250, 251, 251, 251]]
        );

        // The whole text replaced: one range over both arenas.
        let replaced: Vec<u32> = (1_000..1_200).collect();
        let mut all = changes_fixture(&replaced, style);
        assert_eq!(changes_between(&mut all, &previous), [[0, 200, 0, 300]]);
    }

    #[test]
    fn cluster_changes_cover_owner_break_and_advance_lanes() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let ids: Vec<u32> = (1..=130).collect();
        let previous = changes_fixture(&ids, style);
        type Change = fn(&mut ClusterArena);
        let changes: [(u32, Change); 6] = [
            // The binding is paint, which a run revision ignores and a cache does not.
            (3, |arena| arena.binding_handles[3] = 55),
            (64, |arena| arena.flags[64] |= CLUSTER_ALLOWED_BREAK),
            (65, |arena| arena.unsafe_before[65] = 1),
            (70, |arena| arena.glyph_x_offsets[70] = 12),
            (71, |arena| arena.glyph_shape_flags[71] = 1),
            (129, |arena| arena.advances[129] = 2.0),
        ];
        for (cluster, change) in changes {
            let mut current = changes_fixture(&ids, style);
            change(&mut current.arena);
            assert_eq!(
                changes_between(&mut current, &previous),
                [[cluster, cluster + 1, cluster, cluster + 1]]
            );
        }
        // A metric the lanes do not carry changes every cluster, and the pairing stands.
        let mut resized = changes_fixture(&ids, ResolvedStyle::test_typography(18.0, 0.0, 0.0));
        assert_eq!(changes_between(&mut resized, &previous), [[0, 130, 0, 130]]);
    }

    #[test]
    fn cluster_changes_withdraw_the_pairing_when_shaping_inputs_change() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let ids: Vec<u32> = (1..=70).collect();
        let previous = changes_fixture(&ids, style);
        let everything = |current: &mut CanonicalFixture| {
            finalize_fixture(current, &previous, &mut IdentityIndex::default(), &mut 2);
            let changes = current.arena.changes();
            changes.everything && changes.ranges.is_empty()
        };

        let mut redirected = changes_fixture(&ids, style);
        redirected.arena.ltr = true;
        assert!(everything(&mut redirected), "paragraph direction flag");

        let mut other_stack = style;
        other_stack.font_stack_handle = 9;
        assert!(
            everything(&mut changes_fixture(&ids, other_stack)),
            "font stack"
        );

        let mut reshaped = changes_fixture(&ids, style);
        reshaped.shaping_runs[0].script = 0x4772_656b;
        assert!(everything(&mut reshaped), "run script");

        // An arena that was never compared keeps nothing either.
        assert!(changes_fixture(&ids, style).arena.changes().everything);
    }

    #[test]
    fn canonical_revision_invalidates_split_and_merge_topology() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut merged = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        stamp_revisions(&mut merged, &[1]);
        let mut split = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 1], style);
        let mut index = IdentityIndex::default();
        let mut next_revision = 2;

        finalize_fixture(&mut split, &merged, &mut index, &mut next_revision);
        assert_eq!(revisions(&split), [2, 3]);

        let mut remerged =
            canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        finalize_fixture(&mut remerged, &split, &mut index, &mut next_revision);
        assert_eq!(revisions(&remerged), [4]);
        assert_eq!(next_revision, 5);
    }

    #[test]
    fn canonical_revision_tracks_metrics_but_ignores_paint_and_binding() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut previous = canonical_fixture(&[b'a' as u16], &[10], &[0], style);
        stamp_revisions(&mut previous, &[1]);
        let mut index = IdentityIndex::default();

        let mut paint = style;
        paint.material_id = 91;
        paint.foreground_rgba = 0x1234_5678;
        paint.opacity = 0.25;
        paint.line_height = 48.0;
        let mut paint_only = canonical_fixture(&[b'a' as u16], &[10], &[0], paint);
        paint_only.arena.binding_handles[0] = 999;
        let mut next_revision = 2;
        super::super::work_attribution::reset();
        finalize_fixture(&mut paint_only, &previous, &mut index, &mut next_revision);
        // Two arenas resolve their styles once per stretch of clusters that share them, and
        // an equal run is never walked cluster by cluster.
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.canonical_style_resolutions, 0);
        assert_eq!(work.canonical_cluster_comparisons, 0);
        assert_eq!(revisions(&paint_only), [1]);
        assert_eq!(next_revision, 2);

        let metrics = ResolvedStyle::test_typography(18.0, 0.0, 0.0);
        let mut metrics_changed = canonical_fixture(&[b'a' as u16], &[10], &[0], metrics);
        finalize_fixture(
            &mut metrics_changed,
            &previous,
            &mut index,
            &mut next_revision,
        );
        assert_eq!(revisions(&metrics_changed), [2]);
        assert_eq!(next_revision, 3);
    }

    #[test]
    fn canonical_revision_exhaustion_is_domain_specific_and_atomic() {
        let mut next_revision = u32::MAX;

        assert_eq!(
            RunCanonicalRevision::allocate(&mut next_revision),
            Err(EngineError::RevisionExhausted)
        );
        assert_eq!(next_revision, u32::MAX);
    }

    #[test]
    fn layout_run_property_matches_the_scalar_adjacency_oracle() {
        let mut state = 0x6d2b_79f5_u32;
        for length in 0..192usize {
            let mut source_runs = Vec::with_capacity(length);
            let mut font_handles = Vec::with_capacity(length);
            let mut glyph_counts = Vec::with_capacity(length);
            for _ in 0..length {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                source_runs.push((state >> 29) & 3);
                font_handles.push(((state >> 25) & 7) + 1);
                glyph_counts.push((state >> 21) & 3);
            }
            let arena = shadow_topology(&source_runs, &font_handles, &glyph_counts);
            assert_shadow_topology(&arena);
        }
    }

    #[test]
    fn dense_cjk_break_paint_and_raster_lanes_do_not_split_shadow_runs() {
        const COUNT: usize = 4_096;
        let mut arena = shadow_topology(&vec![7; COUNT], &vec![31; COUNT], &vec![1; COUNT]);
        arena.flags = (0..COUNT)
            .map(|index| CLUSTER_ALLOWED_BREAK | (u8::from(index % 2 == 0) * CLUSTER_SAFE_BEFORE))
            .collect();
        arena.style_indexes = (0..COUNT).map(|index| (index % 5) as u32).collect();
        arena.binding_handles = (0..COUNT).map(|index| (index % 3) as u32 + 1).collect();
        arena.advances = (0..COUNT)
            .map(|index| if index % 11 == 0 { -3.0 } else { 9.0 })
            .collect();
        arena.rebuild_layout_runs().unwrap();

        assert_eq!(arena.layout_runs().len(), 1);
        assert_eq!(arena.layout_runs()[0].cluster_end, COUNT as u32);
        assert_shadow_topology(&arena);
    }

    #[test]
    fn layout_runs_merge_script_boundaries_but_keep_direction_and_geometry() {
        let mut arena = shadow_topology(&[0, 1, 2, 3, 4, 5], &[9, 9, 9, 9, 9, 10], &[1; 6]);
        let mut runs = Vec::new();
        for (index, (script, direction, bidi_level, font_size)) in [
            (1, 0, 0, 16.0),
            (2, 0, 0, 16.0),
            (3, 1, 1, 16.0),
            (4, 0, 2, 16.0),
            (5, 0, 0, 20.0),
            (6, 0, 0, 20.0),
        ]
        .into_iter()
        .enumerate()
        {
            runs.push(ShapingRun {
                text_start: index as u32,
                text_end: index as u32 + 1,
                script,
                direction,
                bidi_level,
                style: ResolvedStyle::test_typography(font_size, 0.0, 0.0),
            });
        }

        arena.rebuild_layout_runs_for_shaping(&runs).unwrap();

        assert_eq!(
            arena
                .layout_runs()
                .iter()
                .map(|run| (run.cluster_start, run.cluster_end))
                .collect::<Vec<_>>(),
            [(0, 2), (2, 3), (3, 4), (4, 5), (5, 6)]
        );
    }

    #[test]
    fn latin_font_fallback_and_bidi_direction_split_shadow_runs() {
        let arena = shadow_topology(
            &[0, 0, 1, 1, 1, 2, 2],
            &[5, 5, 5, 8, 8, 8, 8],
            &[1, 1, 2, 1, 1, 1, 1],
        );

        assert_eq!(
            arena
                .layout_runs()
                .iter()
                .map(|run| {
                    (
                        run.cluster_start,
                        run.cluster_end,
                        run.source_run,
                        run.font_handle,
                    )
                })
                .collect::<Vec<_>>(),
            [(0, 2, 0, 5), (2, 3, 1, 5), (3, 5, 1, 8), (5, 7, 2, 8)]
        );
        assert_shadow_topology(&arena);
    }

    #[test]
    fn justification_and_negative_advances_do_not_split_shadow_runs() {
        let mut arena = shadow_topology(&[3; 8], &[13; 8], &[1, 2, 1, 1, 0, 1, 1, 1]);
        arena.flags = vec![CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK; 8];
        arena.advance_units = vec![-4, 8, 12, -2, 7, 9, -1, 6];
        arena.rebuild_layout_runs().unwrap();

        assert_eq!(arena.layout_runs().len(), 1);
        assert_eq!(arena.layout_runs()[0].glyph_count, 8);
        assert_shadow_topology(&arena);
    }

    #[test]
    fn aggregates_scaled_advances_spacing_and_legal_breaks() {
        let text: Vec<u16> = "a b\n".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 2.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let mut shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![3, 2, 1],
            clusters: vec![2, 1, 0],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
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
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(clusters.starts, [0, 1, 2, 3]);
        assert_eq!(clusters.ends, [1, 2, 3, 4]);
        assert_eq!(clusters.advances, [9.0, 7.0, 9.0, 0.0]);
        // The F16.16 stream must quantize the COMPLETE advances — including the
        // shape aggregation that runs after the initial spacing fill — or the
        // integer fit sees spacing-only widths and stops wrapping.
        assert_eq!(
            clusters.advance_units,
            [9 * 65_536, 7 * 65_536, 9 * 65_536, 0]
        );
        assert_eq!(clusters.style_indexes, [0; 4]);
        assert_eq!(clusters.source_runs, [0, 0, 0, NO_SOURCE_RUN]);
        assert_eq!(clusters.font_handles, [9, 9, 9, 0]);
        assert_eq!(clusters.stable_ids, [1, 2, 3, 4]);
        assert_eq!(clusters.glyph_starts, [0, 1, 2, 3]);
        assert_eq!(clusters.glyph_counts, [1, 1, 1, 0]);
        // The reversed shape order lands in the adjacency stream as cluster-order
        // payload: cluster 0 owns shape glyph 2, cluster 2 owns shape glyph 0.
        assert_eq!(clusters.glyph_ids, [1, 2, 3]);
        assert_eq!(clusters.glyph_clusters, [0, 1, 2]);
        assert_eq!(clusters.glyph_x_advances, [500, 250, 500]);
        assert_eq!(clusters.index_at, [0, 1, 2, 3, 4]);
        assert_eq!(clusters.flags[0], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[1],
            CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE
        );
        assert_eq!(clusters.flags[2], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[3],
            CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK
        );

        let capacities = (
            clusters.starts.capacity(),
            clusters.advances.capacity(),
            clusters.flags.capacity(),
            clusters.glyph_starts.capacity(),
            clusters.glyph_counts.capacity(),
            clusters.glyph_ids.capacity(),
            clusters.index_at.capacity(),
        );
        shape.glyph_flags[0] = GLYPH_UNSAFE_TO_BREAK;
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(
            capacities,
            (
                clusters.starts.capacity(),
                clusters.advances.capacity(),
                clusters.flags.capacity(),
                clusters.glyph_starts.capacity(),
                clusters.glyph_counts.capacity(),
                clusters.glyph_ids.capacity(),
                clusters.index_at.capacity(),
            )
        );
        // The legal opportunity after the space is an allowed break that carries a correction
        // (#216) when both sides share a font owner.
        assert_eq!(
            clusters.flags[1],
            CLUSTER_SAFE_BEFORE | CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION
        );
        assert_eq!(clusters.flags[2], 0);
        assert_eq!(
            clusters.chunk_flags_or,
            [CLUSTER_SAFE_BEFORE
                | CLUSTER_SPACE
                | CLUSTER_HARD_BREAK
                | CLUSTER_REQUIRED_BREAK
                | CLUSTER_ALLOWED_BREAK],
            "chunk summaries never fold the correction marker"
        );
    }

    /// A style boundary interior to an extended grapheme cluster still rejects the frame -- one
    /// style per cluster is not negotiable -- but it now reports its own status instead of the
    /// undifferentiated `InvalidRequest` that also stood for every arena invariant (D-267). No
    /// single style id owns a resolved segment boundary, so this cause names only the paragraph,
    /// which the per-paragraph loop attaches.
    #[test]
    fn a_style_boundary_inside_a_cluster_reports_its_own_cause() {
        let text: Vec<u16> = "a\u{301}b".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        // The first grapheme cluster spans [0, 2); these segments split it at 1.
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style,
            },
            StyleSegment {
                text_start: 1,
                text_end: 3,
                style: ResolvedStyle::test_typography(24.0, 0.0, 0.0),
            },
        ];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![1, 2, 3],
            clusters: vec![0, 1, 2],
            x_advances: vec![500; 3],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
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
        let mut clusters = ClusterArena::default();
        assert_eq!(
            clusters.build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            ),
            Err(EngineError::StyleSplitsCluster(FrameFault::default()))
        );
    }

    /// UAX #14 LB9 does not attach a combining mark to a preceding SPACE, while UAX #29 GB9 does,
    /// so `"x \u{301}y"` offers a line break at offset 2 that falls strictly inside the grapheme
    /// cluster spanning [1, 3). A cluster is indivisible for layout, so that opportunity is
    /// unusable -- but it is well-formed input from two standards that disagree by design, and
    /// rejecting the whole frame for it made the paragraph unpublishable.
    #[test]
    fn a_line_break_inside_a_grapheme_cluster_is_ignored_rather_than_rejected() {
        let text: Vec<u16> = "x \u{301}y".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        assert!(
            unicode
                .line_breaks()
                .iter()
                .any(|entry| entry.position == 2),
            "the case rests on UAX #14 offering a break strictly inside the cluster",
        );

        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 4,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![1, 2, 3],
            clusters: vec![0, 1, 3],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
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
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .expect("a break opportunity inside a cluster must not reject the paragraph");

        assert_eq!(clusters.starts, [0, 1, 3]);
        assert_eq!(clusters.ends, [1, 3, 4]);
        // The unusable opportunity leaves no break on the cluster that contains it.
        assert_eq!(clusters.flags[1] & CLUSTER_ALLOWED_BREAK, 0);
    }

    #[test]
    fn stable_glyph_ids_follow_clusters_and_reuse_ordinals_transactionally() {
        let previous = ClusterArena {
            stable_ids: vec![10, 20],
            glyph_starts: vec![0, 2],
            glyph_counts: vec![2, 1],
            glyph_stable_ids: vec![1, 2, 3],
            ..ClusterArena::default()
        };
        let mut pending = ClusterArena {
            stable_ids: vec![30, 10, 20],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 2],
            glyph_ids: vec![0; 4],
            ..ClusterArena::default()
        };
        let mut index = IdentityIndex::default();
        let mut next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);

        let capacities = index.capacities();
        pending.glyph_stable_ids.clear();
        next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);
        assert_eq!(index.capacities(), capacities);
    }

    #[test]
    fn glyphless_ligature_continuation_inherits_shape_run_ownership() {
        let text: Vec<u16> = "ff".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 2,
                glyph_start: 0,
                glyph_count: 1,
            }],
            glyph_ids: vec![42],
            clusters: vec![0],
            x_advances: vec![1_000],
            y_advances: vec![0],
            x_offsets: vec![0],
            y_offsets: vec![0],
            glyph_flags: vec![GLYPH_UNSAFE_TO_BREAK],
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
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
            )
            .unwrap();

        assert_eq!(clusters.source_runs, [0, 0]);
        assert_eq!(clusters.binding_handles, [19, 19]);
        assert_eq!(clusters.font_handles, [9, 9]);
        assert_eq!(clusters.glyph_counts, [1, 0]);
        assert_eq!(clusters.advances, [16.0, 0.0]);
        assert_eq!(clusters.flags[1] & CLUSTER_SAFE_BEFORE, 0);
    }

    #[test]
    fn rtl_numeric_chunks_preserve_glyphless_ownership_and_detached_breaks() {
        for count in [63usize, 64, 65] {
            for (glyphless, hard_break) in [(false, false), (true, false), (false, true)] {
                let mut text = vec![0x05d0; count];
                let middle = count / 2;
                if hard_break {
                    text[middle] = 0x000a;
                }
                let text_unit_ids: Vec<u32> = (1..=u32::try_from(count).unwrap()).collect();
                let mut unicode = UnicodeAnalysis::default();
                unicode.analyze(&text).unwrap();
                let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
                let styles = [StyleSegment {
                    text_start: 0,
                    text_end: u32::try_from(count).unwrap(),
                    style,
                }];
                let ranges = if hard_break {
                    vec![0..middle, middle + 1..count]
                } else {
                    core::iter::once(0..count).collect::<Vec<_>>()
                };
                let mut runs = Vec::new();
                let mut shape = ShapeArena::default();
                for (source_run, range) in ranges.iter().enumerate() {
                    let start = u32::try_from(range.start).unwrap();
                    let end = u32::try_from(range.end).unwrap();
                    runs.push(ShapingRun {
                        text_start: start,
                        text_end: end,
                        script: u32::from_be_bytes(*b"Hebr"),
                        direction: 5,
                        bidi_level: 1,
                        style,
                    });
                    let glyph_start = u32::try_from(shape.glyph_ids.len()).unwrap();
                    for cluster in range.clone().rev() {
                        // The neighboring unsafe glyph owns the omitted continuation, as in
                        // the ligature fixture above; newline is outside both shaped runs.
                        if glyphless && (cluster == 0 || cluster == count - 2) {
                            continue;
                        }
                        shape.glyph_ids.push(u16::try_from(cluster + 1).unwrap());
                        shape.clusters.push(u32::try_from(cluster).unwrap());
                        shape.x_advances.push(500);
                        shape.y_advances.push(0);
                        shape.x_offsets.push(0);
                        shape.y_offsets.push(0);
                        shape.glyph_flags.push(
                            if glyphless && (cluster == 1 || cluster == count - 1) {
                                GLYPH_UNSAFE_TO_BREAK
                            } else {
                                0
                            },
                        );
                    }
                    shape.runs.push(ShapedRun {
                        source_run: u32::try_from(source_run).unwrap(),
                        binding_handle: 19,
                        font_handle: 9,
                        text_start: start,
                        text_end: end,
                        glyph_start,
                        glyph_count: u32::try_from(shape.glyph_ids.len()).unwrap() - glyph_start,
                    });
                }
                let mut clusters = ClusterArena::default();
                clusters
                    .build(
                        ClusterBuildInput {
                            text: &text,
                            text_unit_ids: &text_unit_ids,
                            unicode: &unicode,
                            styles: &styles,
                            runs: &runs,
                            shape: &shape,
                        },
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
                    )
                    .unwrap();
                clusters
                    .rebuild_run_local_geometry(&runs, &styles, |_, _| {
                        Some(FontGlyphExtents {
                            x_min: 0,
                            y_min: 0,
                            x_max: 500,
                            y_max: 700,
                        })
                    })
                    .unwrap();
                assert_eq!(
                    clusters.starts,
                    (0..u32::try_from(count).unwrap()).collect::<Vec<_>>()
                );
                assert_eq!(
                    clusters.ends,
                    (1..=u32::try_from(count).unwrap()).collect::<Vec<_>>()
                );
                assert_eq!(clusters.run_local().rows().len(), shape.glyph_ids.len());
                let mut seen = vec![false; shape.glyph_ids.len()];
                for row in clusters.run_local().rows() {
                    let source = usize::try_from(row.source_glyph).unwrap();
                    assert!(!seen[source], "each shaped glyph is emitted once");
                    seen[source] = true;
                    assert_eq!(
                        clusters.run_local().row_for_source_glyph(row.source_glyph),
                        Some(row)
                    );
                }
                assert!(seen.iter().all(|value| *value));
                for run in clusters.layout_runs() {
                    let start = usize::try_from(run.cluster_start).unwrap();
                    let end = usize::try_from(run.cluster_end).unwrap();
                    let numeric_start = usize::try_from(run.numeric_blocks.cluster_start).unwrap();
                    let mut prefix = 0.0f64;
                    let mut block_prefix = 0.0f64;
                    for (ordinal, cluster) in (start..end).rev().enumerate() {
                        if ordinal % LAYOUT_CHUNK == 0 {
                            block_prefix = prefix;
                        }
                        let block = clusters.run_local().cluster_blocks()[numeric_start + ordinal];
                        if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                            assert_eq!(block, u32::MAX);
                            assert_eq!(clusters.glyph_counts[cluster], 0);
                            continue;
                        }
                        assert_eq!(clusters.font_handles[cluster], 9);
                        assert_eq!(clusters.binding_handles[cluster], 19);
                        assert_eq!(clusters.source_runs[cluster], run.source_run);
                        if block == u32::MAX {
                            // A glyphless final chunk retains shaping ownership, but the writer
                            // allocates no numeric block without rows. It is not a hard break.
                            assert_eq!(clusters.glyph_counts[cluster], 0);
                            prefix += clusters.advances[cluster];
                            continue;
                        }
                        let relative_block = block - run.numeric_blocks.start;
                        assert_eq!(
                            relative_block,
                            u32::try_from(ordinal / LAYOUT_CHUNK).unwrap()
                        );
                        for glyph in clusters.glyph_starts[cluster]
                            ..clusters.glyph_starts[cluster] + clusters.glyph_counts[cluster]
                        {
                            let row = clusters.run_local().row_for_source_glyph(glyph).unwrap();
                            let anchor = clusters.run_local().blocks()
                                [usize::try_from(block).unwrap()]
                            .anchor_inline;
                            assert_eq!(
                                block_prefix + anchor + f64::from(row.inline_origin),
                                prefix
                            );
                        }
                        prefix += clusters.advances[cluster];
                    }
                }
                if glyphless {
                    assert_eq!(clusters.glyph_counts[0], 0);
                    assert_eq!(clusters.glyph_counts[count - 2], 0);
                }
            }
        }
    }

    #[test]
    fn reordered_glyph_offset_maps_to_its_containing_grapheme() {
        let text: Vec<u16> = "त्ये".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        assert_eq!(unicode.grapheme_boundaries(), &[0, 4]);
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Deva"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 4,
                glyph_start: 0,
                glyph_count: 1,
            }],
            glyph_ids: vec![42],
            clusters: vec![2],
            x_advances: vec![1_000],
            y_advances: vec![0],
            x_offsets: vec![0],
            y_offsets: vec![0],
            glyph_flags: vec![GLYPH_UNSAFE_TO_BREAK],
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
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
            )
            .unwrap();

        assert_eq!(clusters.index_at, [0, 0, 0, 0, 1]);
        assert_eq!(clusters.glyph_counts, [1]);
        assert_eq!(clusters.glyph_ids, [42]);
        assert_eq!(clusters.source_runs, [0]);
    }

    #[test]
    fn source_run_rebuild_resets_break_corrections_only_near_the_rebuilt_run() {
        let text: Vec<u16> = "a".repeat(20).encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 20,
            style,
        }];
        let run = |text_start, text_end| ShapingRun {
            text_start,
            text_end,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        };
        let runs = [run(0, 2), run(2, 20)];
        let shaped = |source_run, text_start, text_end, glyph_start| ShapedRun {
            source_run,
            binding_handle: 19,
            font_handle: 9,
            text_start,
            text_end,
            glyph_start,
            glyph_count: text_end - text_start,
        };
        let make_shape = |first_glyph| ShapeArena {
            runs: vec![shaped(0, 0, 2, 0), shaped(1, 2, 20, 2)],
            glyph_ids: std::iter::once(first_glyph).chain([1; 19]).collect(),
            clusters: (0..20).collect(),
            x_advances: vec![500; 20],
            y_advances: vec![0; 20],
            x_offsets: vec![0; 20],
            y_offsets: vec![0; 20],
            glyph_flags: vec![0; 20],
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
        let ids: Vec<u32> = (1..=20).collect();
        let shape = make_shape(1);
        let input = |shape| ClusterBuildInput {
            text: &text,
            text_unit_ids: &ids,
            unicode: &unicode,
            styles: &styles,
            runs: &runs,
            shape,
        };
        let mut previous = ClusterArena::default();
        previous.build(input(&shape), metrics).unwrap();
        // A paragraph without a correctable boundary keeps no lane; size one as pricing would.
        previous
            .break_corrections
            .resize_with(previous.starts.len(), Default::default);
        let marker = Correction {
            advance: 7,
            space: 0,
            trailing: 0,
        };
        for slot in previous.break_corrections.iter().flatten() {
            slot.set(Some(marker));
        }
        let mut copy = ClusterArena::default();
        copy.copy_from(&previous, false).unwrap();
        assert!(
            copy.break_corrections
                .iter()
                .flatten()
                .all(|slot| slot.get().is_some())
        );

        let mut retained = ClusterArena::default();
        retained
            .rebuild_source_run_if_topology_is_stable(&previous, input(&shape), 0, false, metrics)
            .unwrap()
            .unwrap();
        // Run 0 is clusters 0..2; the island after it plus 5 clusters of context reach slot 8.
        let kept: Vec<bool> = retained
            .break_corrections
            .iter()
            .map(|slot| slot[1].get().is_some())
            .collect();
        assert!(
            kept[..8].iter().all(|kept| !kept),
            "inside the rebuilt run and its context"
        );
        assert!(
            kept[8..].iter().all(|kept| *kept),
            "beyond the context survives"
        );
        assert_eq!(retained.island(9), (9, 10));

        let mut restyled = ClusterArena::default();
        restyled
            .refresh_styles_from_stream(&previous, &styles, &runs, true)
            .unwrap()
            .unwrap();
        assert!(
            restyled
                .break_corrections
                .iter()
                .flatten()
                .all(|slot| slot.get().is_none())
        );
    }

    #[test]
    fn retained_source_run_rebuild_matches_the_cold_cluster_oracle() {
        let old_text: Vec<u16> = "ab".encode_utf16().collect();
        let new_text: Vec<u16> = "ac".encode_utf16().collect();
        let mut old_unicode = UnicodeAnalysis::default();
        old_unicode.analyze(&old_text).unwrap();
        let mut new_unicode = UnicodeAnalysis::default();
        new_unicode.analyze(&new_text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let make_shape = |second_glyph, second_advance| ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 2,
                glyph_start: 0,
                glyph_count: 2,
            }],
            glyph_ids: vec![1, second_glyph],
            clusters: vec![0, 1],
            x_advances: vec![500, second_advance],
            y_advances: vec![0; 2],
            x_offsets: vec![0; 2],
            y_offsets: vec![0; 2],
            glyph_flags: vec![0; 2],
        };
        let old_shape = make_shape(2, 500);
        let new_shape = make_shape(3, 600);
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
        let mut previous = ClusterArena::default();
        previous
            .build(
                ClusterBuildInput {
                    text: &old_text,
                    text_unit_ids: &[10, 20],
                    unicode: &old_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &old_shape,
                },
                metrics,
            )
            .unwrap();
        let mut next_id = 1;
        previous
            .assign_stable_glyph_ids(
                &ClusterArena::default(),
                &mut IdentityIndex::default(),
                &mut next_id,
            )
            .unwrap();
        let mut cold = ClusterArena::default();
        cold.build(
            ClusterBuildInput {
                text: &new_text,
                text_unit_ids: &[10, 30],
                unicode: &new_unicode,
                styles: &styles,
                runs: &runs,
                shape: &new_shape,
            },
            metrics,
        )
        .unwrap();
        let mut cold_next_id = next_id;
        cold.assign_stable_glyph_ids(&previous, &mut IdentityIndex::default(), &mut cold_next_id)
            .unwrap();
        let mut retained = ClusterArena::default();
        let (cluster_start, cluster_end) = retained
            .rebuild_source_run_if_topology_is_stable(
                &previous,
                ClusterBuildInput {
                    text: &new_text,
                    text_unit_ids: &[10, 30],
                    unicode: &new_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &new_shape,
                },
                0,
                false,
                metrics,
            )
            .unwrap()
            .unwrap();
        let mut retained_next_id = next_id;
        retained
            .assign_stable_glyph_ids_in_range(
                &previous,
                cluster_start,
                cluster_end,
                &mut IdentityIndex::default(),
                &mut retained_next_id,
            )
            .unwrap();
        macro_rules! assert_lane {
            ($field:ident) => {
                assert_eq!(retained.$field, cold.$field, stringify!($field));
            };
        }
        assert_lane!(starts);
        assert_lane!(ends);
        assert_lane!(advances);
        assert_lane!(advance_units);
        assert_lane!(units_per_em);
        assert_lane!(flags);
        assert_lane!(style_indexes);
        assert_lane!(source_runs);
        assert_lane!(binding_handles);
        assert_lane!(font_handles);
        assert_lane!(stable_ids);
        assert_lane!(glyph_starts);
        assert_lane!(glyph_counts);
        assert_lane!(glyph_ids);
        assert_lane!(glyph_clusters);
        assert_lane!(glyph_x_advances);
        assert_lane!(glyph_x_offsets);
        assert_lane!(glyph_y_offsets);
        assert_lane!(glyph_shape_flags);
        assert_lane!(glyph_stable_ids);
        assert_lane!(index_at);
        assert_lane!(shaped);
        assert_lane!(unsafe_before);
        assert_eq!(retained_next_id, cold_next_id);
    }

    #[test]
    fn identity_scatter_admits_only_ordered_tiling_runs() {
        let shape = |glyph_start, clusters: Vec<u32>| ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start,
                glyph_count: u32::try_from(clusters.len()).unwrap(),
            }],
            glyph_ids: vec![1; clusters.len()],
            clusters,
            x_advances: vec![500; 3],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        assert!(scatter_is_identity(&shape(0, vec![0, 1, 2])));
        assert!(scatter_is_identity(&shape(0, vec![0, 0, 2])));
        // Reordered clusters or a run that does not tile from zero fall back.
        assert!(!scatter_is_identity(&shape(0, vec![2, 1, 0])));
        assert!(!scatter_is_identity(&shape(1, vec![0, 1, 2])));
        // The empty shape is trivially identity.
        assert!(scatter_is_identity(&ShapeArena::default()));
    }

    #[test]
    fn metrics_refresh_from_the_stream_matches_the_cold_build_oracle() {
        let text: Vec<u16> = "a b\n".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let segment = |style| {
            [StyleSegment {
                text_start: 0,
                text_end: 4,
                style,
            }]
        };
        let run = |style| {
            [ShapingRun {
                text_start: 0,
                text_end: 3,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            }]
        };
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![3, 2, 1],
            clusters: vec![2, 1, 0],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
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
        let old_style = ResolvedStyle::test_typography(16.0, 1.0, 2.0);
        let new_style = ResolvedStyle::test_typography(18.0, 2.5, 3.0);
        let build = |style| {
            let mut arena = ClusterArena::default();
            arena
                .build(
                    ClusterBuildInput {
                        text: &text,
                        text_unit_ids: &[1, 2, 3, 4],
                        unicode: &unicode,
                        styles: &segment(style),
                        runs: &run(style),
                        shape: &shape,
                    },
                    metrics,
                )
                .unwrap();
            let mut next_id = 1;
            arena
                .assign_stable_glyph_ids(
                    &ClusterArena::default(),
                    &mut IdentityIndex::default(),
                    &mut next_id,
                )
                .unwrap();
            arena
        };
        let previous = build(old_style);
        let mut cold = build(new_style);
        let mut refreshed = ClusterArena::default();
        refreshed
            .refresh_styles_from_stream(&previous, &segment(new_style), &run(new_style), true)
            .unwrap()
            .unwrap();
        macro_rules! assert_lane {
            ($field:ident) => {
                assert_eq!(refreshed.$field, cold.$field, stringify!($field));
            };
        }
        assert_lane!(starts);
        assert_lane!(ends);
        assert_lane!(advances);
        assert_lane!(advance_units);
        assert_lane!(chunk_advance_sums);
        assert_lane!(chunk_auxiliary_sums);
        assert_lane!(chunk_flags_or);
        assert_lane!(word_breaks);
        assert_lane!(units_per_em);
        assert_lane!(flags);
        assert_lane!(style_indexes);
        assert_lane!(source_runs);
        assert_lane!(binding_handles);
        assert_lane!(font_handles);
        assert_lane!(stable_ids);
        assert_lane!(glyph_starts);
        assert_lane!(glyph_counts);
        assert_lane!(glyph_ids);
        assert_lane!(glyph_clusters);
        assert_lane!(glyph_x_advances);
        assert_lane!(glyph_x_offsets);
        assert_lane!(glyph_y_offsets);
        assert_lane!(glyph_shape_flags);
        assert_lane!(glyph_stable_ids);
        assert_lane!(index_at);
        assert_lane!(shaped);
        assert_lane!(unsafe_before);
        assert!(refreshed.ltr && cold.ltr);
        // The direction flag follows the runs handed in, not the arena copied from.
        let mut overridden = new_style;
        overridden.bidi_override = true;
        let mut redirected = ClusterArena::default();
        redirected
            .refresh_styles_from_stream(&previous, &segment(overridden), &run(overridden), true)
            .unwrap()
            .unwrap();
        assert!(!redirected.ltr);
        // An emptied arena answers like a fresh one.
        let mut emptied = build(old_style);
        emptied.clear();
        assert_eq!(emptied.ltr, ClusterArena::default().ltr);
        for arena in [&mut cold, &mut refreshed] {
            arena.ensure_word_breaks().unwrap();
            arena.ensure_placement_segment_anchors().unwrap();
            arena
                .rebuild_run_local_geometry(&run(new_style), &segment(new_style), |_, _| None)
                .unwrap();
        }
        for (cold_run, refreshed_run) in cold.layout_runs().iter().zip(refreshed.layout_runs()) {
            for cluster in cold_run.cluster_start as usize..cold_run.cluster_end as usize {
                for stop_after_space in [false, true] {
                    assert_eq!(
                        refreshed.placement_segment_monotone(
                            *refreshed_run,
                            0,
                            cluster,
                            stop_after_space,
                            text.len(),
                        ),
                        cold.placement_segment_monotone(
                            *cold_run,
                            0,
                            cluster,
                            stop_after_space,
                            text.len(),
                        ),
                    );
                }
            }
        }
        // The refresh must refuse styles that no longer cover the clusters.
        let mut misaligned = ClusterArena::default();
        assert!(
            misaligned
                .refresh_styles_from_stream(
                    &previous,
                    &[StyleSegment {
                        text_start: 0,
                        text_end: 2,
                        style: new_style,
                    }],
                    &run(new_style),
                    true,
                )
                .unwrap()
                .is_none()
        );
    }

    /// A hand-built arena over "ax by c" plus a hard break, so the intrinsic scan's
    /// wrap-codec mirroring is pinned cluster by cluster without shaping.
    fn intrinsic_fixture() -> ClusterArena {
        //                 a     x     sp    b     y     sp    c
        let advances = vec![10.0, 5.0, 3.0, 7.0, 2.0, 3.0, 6.0];
        let flags = vec![
            0,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK,
            0,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK,
            0,
        ];
        let starts = vec![0, 1, 2, 3, 4, 5, 6];
        let ends = vec![1, 2, 3, 4, 5, 6, 7];
        ClusterArena {
            advances,
            flags,
            starts,
            ends,
            ..Default::default()
        }
    }

    #[test]
    fn intrinsic_widths_mirror_the_word_wrap_break_decisions() {
        let clusters = intrinsic_fixture();
        let widths = clusters.intrinsic_widths(WRAP_WORD);
        // Word runs: "ax" (15), "b y" (9), "c" (6); separating spaces trim off.
        assert_eq!(widths.min_content_width, 15.0);
        assert_eq!(widths.max_content_width, 36.0);
    }

    #[test]
    fn intrinsic_word_width_uses_the_complete_shaped_segment() {
        let mut clusters = intrinsic_fixture();
        clusters.advances[0] = 10.0;
        clusters.advances[1] = -4.0;
        let widths = clusters.intrinsic_widths(WRAP_WORD);
        assert_eq!(widths.min_content_width, 9.0);
        assert_eq!(widths.max_content_width, 27.0);
    }

    #[test]
    fn character_wrap_takes_every_safe_boundary_and_none_wraps_never() {
        let mut clusters = intrinsic_fixture();
        for flag in clusters.flags.iter_mut() {
            *flag |= CLUSTER_SAFE_BEFORE;
        }
        let character = clusters.intrinsic_widths(WRAP_CHARACTER);
        assert_eq!(character.min_content_width, 10.0);
        let none = clusters.intrinsic_widths(WRAP_NONE);
        assert_eq!(none.min_content_width, 36.0);
        assert_eq!(none.max_content_width, 36.0);
    }

    #[test]
    fn forced_breaks_terminate_intrinsic_segments() {
        let mut clusters = intrinsic_fixture();
        clusters.flags[4] |= CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK;
        let widths = clusters.intrinsic_widths(WRAP_NONE);
        // "ax b y" ends at the forced break (27); the trailing " c" run closes at
        // the end of text (9). No soft breaks exist under none, so both agree.
        assert_eq!(widths.max_content_width, 27.0);
        assert_eq!(widths.min_content_width, 27.0);
    }

    #[test]
    fn fixed_wide_lane_preserves_large_advances_and_chunk_summary_semantics() {
        let mut arena = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK + 1],
            flags: vec![CLUSTER_ALLOWED_BREAK; LAYOUT_CHUNK + 1],
            ..ClusterArena::default()
        };
        arena.flags[3] |= CLUSTER_SPACE;
        arena.refresh_layout_units().unwrap();
        assert_eq!(arena.chunk_advance_sums, [64 * 65_536, 65_536]);
        assert_eq!(arena.chunk_auxiliary_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );

        arena.advances[LAYOUT_CHUNK] = 32_768.0;
        arena.refresh_layout_units().unwrap();
        assert_eq!(arena.chunk_advance_sums[0], 64 * 65_536);
        assert_eq!(arena.chunk_advance_sums[1], 2_147_483_648);
        assert_eq!(arena.chunk_auxiliary_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );
    }

    #[test]
    fn negative_chunk_summary_packs_its_marker_and_tagged_auxiliary() {
        let mut advances = vec![0.0; LAYOUT_CHUNK * 3];
        let mut flags = vec![CLUSTER_ALLOWED_BREAK; advances.len()];
        advances[0] = 3.0;
        advances[1] = -2.0;
        advances[2] = -2.0;
        advances[LAYOUT_CHUNK] = -2.0;
        flags[LAYOUT_CHUNK] |= CLUSTER_SPACE;
        advances[LAYOUT_CHUNK * 2] = 1.0;
        let mut arena = ClusterArena {
            advances,
            flags,
            ..ClusterArena::default()
        };
        arena.refresh_layout_units().unwrap();

        assert_eq!(arena.chunk_advance_sums, [-65_536, -131_072, 65_536]);
        assert_eq!(arena.chunk_auxiliary_sums, [196_608, -131_072, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [
                CLUSTER_ALLOWED_BREAK | CHUNK_NEGATIVE_ADVANCE,
                CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CHUNK_NEGATIVE_ADVANCE,
                CLUSTER_ALLOWED_BREAK,
            ],
        );
    }

    #[test]
    fn word_break_stream_is_compact_and_only_materialized_for_sparse_breaks() {
        assert_eq!(core::mem::size_of::<WordBreakRecord>(), 12);

        let mut sparse = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK * 2],
            flags: vec![0; LAYOUT_CHUNK * 2],
            ..ClusterArena::default()
        };
        sparse.flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        sparse.flags[6] = CLUSTER_ALLOWED_BREAK;
        sparse.refresh_layout_units().unwrap();
        assert!(
            sparse.word_breaks.is_empty(),
            "layout-unit refresh does not eagerly build word indexes"
        );
        sparse.ensure_word_breaks().unwrap();
        assert_eq!(sparse.word_breaks.len(), 3);
        assert_eq!(sparse.word_breaks[0].cluster_end, 3);
        assert_eq!(sparse.word_breaks[0].advance_units, 3 * 65_536);
        assert_eq!(sparse.word_breaks[0].space_units, 65_536);
        assert_eq!(sparse.word_breaks[1].cluster_end, 7);
        assert_eq!(sparse.word_breaks[1].advance_units, 4 * 65_536);
        assert_eq!(sparse.word_breaks[2].cluster_end, (LAYOUT_CHUNK * 2) as u32);
        assert_eq!(
            sparse.word_breaks[2].advance_units,
            (LAYOUT_CHUNK * 2 - 7) as i32 * 65_536
        );

        let mut short = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK - 1],
            flags: vec![0; LAYOUT_CHUNK - 1],
            ..ClusterArena::default()
        };
        short.flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        short.refresh_layout_units().unwrap();
        short.ensure_word_breaks().unwrap();
        assert!(
            short.word_breaks.is_empty(),
            "sub-chunk labels stay on the allocation-free scalar compositor"
        );

        let mut dense = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK * 2],
            flags: vec![CLUSTER_ALLOWED_BREAK; LAYOUT_CHUNK * 2],
            ..ClusterArena::default()
        };
        dense.advances[3] = -1.0;
        dense.refresh_layout_units().unwrap();
        dense.ensure_word_breaks().unwrap();
        assert!(dense.word_breaks.is_empty());
        assert_eq!(dense.word_breaks.capacity(), 0);
        assert_eq!(dense.word_sidecar_mode, WordSidecarMode::Dense);
        assert!(dense.chunk_flags_or[0] & CHUNK_NEGATIVE_ADVANCE != 0);
    }

    #[test]
    fn placement_segments_stop_at_the_first_boundary_with_linear_work() {
        let count = LAYOUT_CHUNK * 64;
        let text = vec![b'a' as u16; count];
        let stable_ids = (1..=u32::try_from(count).unwrap()).collect::<Vec<_>>();
        let mut fixture = canonical_fixture(
            &text,
            &stable_ids,
            &vec![0; count],
            ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        );
        fixture
            .arena
            .flags
            .fill(CLUSTER_ALLOWED_BREAK | CLUSTER_SAFE_BEFORE);
        fixture.arena.refresh_layout_units().unwrap();
        fixture.arena.ensure_word_breaks().unwrap();
        fixture.arena.ensure_placement_segment_anchors().unwrap();
        fixture
            .arena
            .rebuild_run_local_geometry(&fixture.shaping_runs, &fixture.styles, |_, _| None)
            .unwrap();
        let run = fixture.arena.layout_runs()[0];
        assert_eq!(run.numeric_blocks.count as usize, count / LAYOUT_CHUNK);
        super::super::work_attribution::reset();
        for start in (0..count).step_by(LAYOUT_CHUNK) {
            let (_, end) = fixture
                .arena
                .placement_segment_monotone(run, 0, start, false, count)
                .unwrap();
            assert_eq!(end, start + LAYOUT_CHUNK);
        }
        assert!(
            super::super::work_attribution::snapshot().placement_segment_validation_visits <= count,
            "numeric blocks must not rescan the remaining dense run",
        );
        fixture.arena.flags[7] |= CLUSTER_SPACE;
        fixture.arena.placement_segment_anchors[12..].fill(13);
        for (start, stop_after_space, limit, expected_end) in [
            (0, false, count, 12),
            (0, true, count, 8),
            (0, false, 6, 6),
            (12, false, count, LAYOUT_CHUNK),
            (LAYOUT_CHUNK, false, count, LAYOUT_CHUNK * 2),
        ] {
            assert_eq!(
                fixture
                    .arena
                    .placement_segment_monotone(run, 0, start, stop_after_space, limit)
                    .unwrap()
                    .1,
                expected_end,
            );
        }
        assert_eq!(
            fixture
                .arena
                .placement_segment_monotone(run, 1, 12, false, count)
                .unwrap()
                .1,
            13,
        );
        fixture.arena.flags[12] |= CLUSTER_HARD_BREAK;
        assert_eq!(
            fixture
                .arena
                .placement_segment_monotone(run, 0, 12, false, count)
                .unwrap()
                .1,
            13,
        );
    }

    #[test]
    fn placement_segment_anchors_are_precomputed_from_stable_word_and_run_roots() {
        let mut fixture = canonical_fixture(
            &[1, 2, 3, 4, 5, 6],
            &[11, 12, 13, 14, 15, 16],
            &[0, 0, 0, 0, 1, 1],
            ResolvedStyle::default(),
        );
        fixture.arena.flags[1] |= CLUSTER_ALLOWED_BREAK;
        fixture.arena.refresh_layout_units().unwrap();
        fixture.arena.ensure_word_breaks().unwrap();
        fixture.arena.ensure_placement_segment_anchors().unwrap();

        assert_eq!(fixture.arena.word_sidecar_mode, WordSidecarMode::Short);
        assert_eq!(
            fixture.arena.placement_segment_anchors,
            [11, 11, 13, 13, 15, 15]
        );

        let count = LAYOUT_CHUNK * 2;
        let text = vec![1; count];
        let stable_ids = (1..=u32::try_from(count).unwrap()).collect::<Vec<_>>();
        let source_runs = vec![0; count];
        let mut dense =
            canonical_fixture(&text, &stable_ids, &source_runs, ResolvedStyle::default());
        dense
            .arena
            .flags
            .fill(CLUSTER_ALLOWED_BREAK | CLUSTER_SAFE_BEFORE);
        dense.arena.refresh_layout_units().unwrap();
        dense.arena.ensure_word_breaks().unwrap();
        dense.arena.ensure_placement_segment_anchors().unwrap();

        assert_eq!(dense.arena.word_sidecar_mode, WordSidecarMode::Dense);
        assert_eq!(dense.arena.placement_segment_anchors, vec![1; count]);
    }
}
