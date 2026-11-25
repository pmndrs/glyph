//! Retained horizontal glyph positioning and canonical occurrence spans.

use alloc::vec::Vec;

use crate::{FontGlyphExtents, FontMetrics, bidi::BidiAnalysis};

use super::placement_state::{
    GlyphSource, LayoutRunOwner, PlacementIdentity, PlacementState, RetainedLinePlacement,
    RetainedRunCorrespondence, RetainedSegmentRemap, SegmentTranslation,
};

use super::{
    EngineError, FrameFault,
    cluster_state::{
        BoundaryRunRole, CLUSTER_HARD_BREAK, CLUSTER_SPACE, ClusterArena, LayoutRun,
        LayoutRunSourceKind, PlacementCluster, RunCanonicalRevision,
    },
    codec_gather::{LayoutGlyph, PAINT_LAYER_GLYPH},
    flow_composition::{FlowDropCap, FlowFragment, FlowLayoutArena, FlowLine},
    frame::{ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START},
    placement_slot_arena::PlacementHandle,
    reserve_vec as reserve,
    retained_rope::{RopeCursor, RopeCursorRange},
    run_local::{
        ClusterFinish, RunLocalArena, RunLocalBuildError, RunLocalGlyphInput, RunLocalWriter,
    },
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapingRun},
    sort::{pack2, sort_keys},
    style_state::{ResolvedStyle, StyleSegment},
};

#[cfg(test)]
use super::identity_index::IdentityIndex;

mod boundary_runs;
mod boundary_source;
mod build;
mod fragment;
mod ink;
mod layout_run;
mod levels;
mod line_match;
mod occurrence;
mod pen;
mod retained_proof;
mod segments;
use boundary_runs::*;
use levels::*;
pub(super) use levels::{is_trivially_ltr, paragraph_level_at};
pub(crate) use line_match::flow_positioning_equivalent;
#[cfg(test)]
use line_match::*;
pub(crate) use occurrence::projected_semantic_row;
use occurrence::*;
use pen::*;
pub(crate) use pen::{
    constraint_typography, fragment_pen_origin, placed_f32, positioned_fragment_advance,
    style_has_text_effects,
};
#[cfg(test)]
use retained_proof::*;

#[cfg(test)]
pub(crate) const SEMANTIC_F32_BASE_FIELD_COUNT: usize = 6;
#[cfg(test)]
pub(crate) const SEMANTIC_F32_FIELD_COUNT: usize = 9;
#[cfg(test)]
pub(crate) const SEMANTIC_U32_FIELD_COUNT: usize = 8;
pub(crate) const SEMANTIC_EFFECTS_CHANGE: u16 = 1 << 14;
pub(crate) const SEMANTIC_PLACEMENT_SLOT_CHANGE: u16 = 1 << 15;
pub(crate) const ALL_SEMANTIC_CHANGES: u16 = u16::MAX;
const PLAN_BINDING_INDEPENDENT_CHANGES: u16 =
    (1 << 8) | (1 << 10) | (1 << 11) | (1 << 12) | SEMANTIC_EFFECTS_CHANGE;

pub(crate) const fn semantic_changes_preserve_plan_bindings(changes: u16) -> bool {
    changes & !PLAN_BINDING_INDEPENDENT_CHANGES == 0
}
const BIDI_BN: u8 = 9;
const BIDI_B: u8 = 10;
const BIDI_S: u8 = 11;
const BIDI_WS: u8 = 12;
const BIDI_LRE: u8 = 14;
const BIDI_LRO: u8 = 15;
const BIDI_RLE: u8 = 16;
const BIDI_RLO: u8 = 17;
const BIDI_PDF: u8 = 18;
const BIDI_LRI: u8 = 19;
const BIDI_RLI: u8 = 20;
const BIDI_FSI: u8 = 21;
const BIDI_PDI: u8 = 22;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SemanticGlyph {
    pub stable_id: u32,
    pub font_handle: u32,
    pub cluster: u32,
    pub glyph_id: u16,
    pub flags: u16,
    pub bidi_level: u8,
    pub font_size: f32,
    pub inline_origin: f32,
    pub block_origin: f32,
    /// Shaped advance for this glyph, already scaled to layout units. Positioning consumes the same
    /// value to move the pen, so a caret or selection rectangle derived from it agrees with the pen
    /// by construction rather than by a second derivation.
    pub inline_advance: f32,
    /// Ink box in positioned space. Zero-extent at the glyph origin when the font supplies no
    /// outline for the id, which is the same condition that skips the render record below.
    pub ink_inline_start: f32,
    pub ink_block_start: f32,
    pub ink_inline_extent: f32,
    pub ink_block_extent: f32,
}

const _: () = assert!(core::mem::size_of::<SemanticGlyph>() == 52);

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct PositionedSemanticGlyph {
    pub stable_id: u32,
    pub font_handle: u32,
    pub cluster: u32,
    pub glyph_id: u16,
    pub flags: u16,
    pub bidi_level: u8,
    pub font_size: f32,
    pub inline_origin: f32,
    pub block_origin: f32,
    pub inline_advance: f32,
    pub ink_inline_start: f32,
    pub ink_block_start: f32,
    pub ink_inline_extent: f32,
    pub ink_block_extent: f32,
    pub placement_segment: u32,
}

const _: () = assert!(core::mem::size_of::<PositionedSemanticGlyph>() == 56);

impl PositionedSemanticGlyph {
    pub(crate) fn placed(
        self,
        translation: SegmentTranslation,
    ) -> Result<SemanticGlyph, EngineError> {
        Ok(SemanticGlyph {
            stable_id: self.stable_id,
            font_handle: self.font_handle,
            cluster: self.cluster,
            glyph_id: self.glyph_id,
            flags: self.flags,
            bidi_level: self.bidi_level,
            font_size: self.font_size,
            inline_origin: placed_f32(self.inline_origin, translation.translation_inline as f32)?,
            block_origin: placed_f32(self.block_origin, translation.translation_block as f32)?,
            inline_advance: self.inline_advance,
            ink_inline_start: placed_f32(
                self.ink_inline_start,
                translation.translation_inline as f32,
            )?,
            ink_block_start: placed_f32(
                self.ink_block_start,
                translation.translation_block as f32,
            )?,
            ink_inline_extent: self.ink_inline_extent,
            ink_block_extent: self.ink_block_extent,
        })
    }
}

/// One solid decoration line for a contiguous decorated visual run: underline,
/// overline, or line-through geometry in positioned space, colored by the style's
/// decoration paint. Non-solid line styles carry their style bits for later paint work
/// and render as solid geometry until then.
///
/// A record also says which glyphs it runs under, for a material that moves glyphs by their
/// layout index or origin. A line's glyphs stand in visual order, so the index only grows
/// along the inline axis: `glyph_start` is the glyph at the rectangle's inline start and
/// `glyph_end` the glyph at its inline end, whatever the direction of the text. The pen
/// origin of the first of them is `(inline_start, baseline)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecorationRecord {
    pub flags: u32,
    pub style: u8,
    pub color: u32,
    pub material_id: u32,
    pub inline_start: f32,
    pub inline_extent: f32,
    pub block_start: f32,
    pub block_extent: f32,
    /// The line's baseline, which the decorated glyphs' pen origins stand on.
    pub baseline: f32,
    /// Layout index of the first decorated glyph: the index `glyphs()` reports it at.
    pub glyph_start: u32,
    /// Layout index of the last decorated glyph. Equal to `glyph_start` under one glyph, and
    /// under a run whose clusters own no glyph.
    pub glyph_end: u32,
    pub clip_id: u32,
    pub region_id: u32,
    pub flow_thread_id: u32,
    pub transform_index: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceLine {
    Body(u32),
    DropCap(u32),
}

impl Default for SourceLine {
    fn default() -> Self {
        Self::Body(0)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SourceLineFacts {
    pub clip_id: u32,
    pub region_id: u32,
    pub flow_thread_id: u32,
    pub transform_index: u32,
}

impl From<FlowLine> for SourceLineFacts {
    fn from(line: FlowLine) -> Self {
        Self {
            clip_id: line.clip_id,
            region_id: line.region_id,
            flow_thread_id: line.flow_thread_id,
            transform_index: line.transform_index,
        }
    }
}

#[derive(Clone, Copy)]
struct RetainedSourceLine {
    index: usize,
    line: FlowLine,
}

#[derive(Clone, Copy)]
struct RetainedLineTarget {
    body: RetainedSourceLine,
    drop_cap: Option<RetainedSourceLine>,
}

struct RetainedOccurrenceProof<'a> {
    previous: &'a PositionedGlyphArena,
    clusters: &'a ClusterArena,
    previous_clusters: &'a ClusterArena,
    boundary: &'a BoundaryShapeArena,
    previous_boundary: &'a BoundaryShapeArena,
    replacement_runs: &'a [LayoutRun],
    replacement_run_boundary_indices: &'a [u32],
    replacement_local: &'a RunLocalArena,
    line_index: usize,
    target: RetainedLineTarget,
    clean_line: bool,
    spans: &'a mut Vec<OccurrenceSpan>,
    semantic_count: &'a mut u32,
    outlined_count: &'a mut u32,
}

/// A visual-order source interval. Body spans may merge adjacent clusters, but
/// glyphs within each cluster always retain source order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct OccurrenceSpan {
    pub source: GlyphSource,
    pub run_owner: LayoutRunOwner,
    pub run_index: u32,
    pub source_glyph_start: u32,
    pub source_glyph_count: u32,
    pub cluster_order: ClusterOrder,
    pub cluster_count: u32,
    pub owner_cluster: u32,
    pub cluster_override: Option<u32>,
    pub semantic_start: u32,
    pub outlined_start: u32,
    pub outlined_count: u32,
    pub placement_segment: u32,
    pub line: SourceLine,
    pub line_facts: SourceLineFacts,
    pub font_handle: u32,
    pub binding_handle: u32,
    pub font_size: f32,
    pub bidi_level: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClusterOrder {
    Single,
    Forward,
    Reverse,
}

pub(crate) struct OccurrenceCursor<'a> {
    positioned: &'a PositionedGlyphArena,
    clusters: &'a ClusterArena,
    boundary: &'a BoundaryShapeArena,
    span_index: usize,
    offset: u32,
    source_glyph: Option<u32>,
    owner_cluster: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct OutlinedOccurrenceMark {
    pub span_index: usize,
    pub source_glyph: u32,
    pub owner_cluster: u32,
    pub semantic_index: u32,
}

pub(crate) struct OutlinedOccurrenceCursor<'a> {
    positioned: &'a PositionedGlyphArena,
    clusters: &'a ClusterArena,
    boundary: &'a BoundaryShapeArena,
    span_index: usize,
    cluster_offset: u32,
    source_next: u32,
    semantic_base: u32,
    outlined_index: u32,
}

#[allow(dead_code)] // Additional provenance is checked by the proof oracle; queries use semantic.
pub(crate) struct ProjectedOccurrence<'a> {
    pub semantic: PositionedSemanticGlyph,
    pub has_outline: bool,
    pub span: &'a OccurrenceSpan,
    pub owner_cluster: u32,
    /// Index of the glyph in its source stream: the cluster arena's, or the boundary shape's.
    pub source_glyph: u32,
}

#[derive(Clone, Copy)]
pub(crate) struct PositionedSourceContext<'a> {
    pub styles: &'a [StyleSegment],
    pub clusters: &'a ClusterArena,
}

#[derive(Clone, Copy)]
pub(crate) struct ProjectedSourceRow<'a> {
    pub glyph: LayoutGlyph,
    pub(crate) semantic: PositionedSemanticGlyph,
    style: &'a ResolvedStyle,
    line_facts: SourceLineFacts,
    stable_cluster: u32,
    text_effects: bool,
}

/// One renderer-neutral projection for both prepared owners. The caller supplies the
/// occurrence's owner/style and local semantic row; every declared Codec input then comes from
/// this same result, so Inline cannot silently omit a color, effect, or line provenance field.
/// Binding, style, line, and effect facts belong to one source occurrence.
pub(crate) struct ProjectedRowOwner<'a> {
    pub binding_handle: u32,
    pub style: &'a ResolvedStyle,
    pub line_facts: SourceLineFacts,
    pub stable_cluster: u32,
    pub text_effects: bool,
}

#[derive(Default)]
pub(crate) struct PositionedGlyphArena {
    current_source_line: SourceLine,
    line_glyph_starts: Vec<u32>,
    line_glyph_counts: Vec<u32>,
    line_decoration_starts: Vec<u32>,
    line_decoration_counts: Vec<u32>,
    occurrence_spans: Vec<OccurrenceSpan>,
    occurrence_semantic_count: u32,
    occurrence_outlined_count: u32,
    semantic_line_glyph_starts: Vec<u32>,
    semantic_line_glyph_counts: Vec<u32>,
    semantic_line_inline_extents: Vec<f64>,
    visual_clusters: Vec<u32>,
    visual_levels: Vec<u8>,
    line_levels: Vec<u8>,
    // Candidate-owned scratch keeps capacity when complete preparation revokes its proof.
    recomposed_glyphs: Vec<core::ops::Range<usize>>,
    recomposed_glyphs_retained: bool,
    /// Every line retained since the last publication kept the layout index of its first
    /// glyph, so the glyphs outside the recomposed windows kept theirs.
    layout_indices_retained: bool,
    decorations: Vec<DecorationRecord>,
    replacement_runs: Vec<LayoutRun>,
    replacement_run_boundary_indices: Vec<u32>,
    replacement_run_local: RunLocalArena,
    replacement_run_indices: Vec<[Option<u32>; 2]>,
    replacement_current_order: Vec<u64>,
    replacement_previous_order: Vec<u64>,
    placement: PlacementState,
    placement_fragment_index: u32,
    text_effects: bool,
    /// Some style declares a decoration, so the pen chain tracks decorated runs per cluster.
    decorated: bool,
    // Line topology: content-only lanes read by the numeric repass of an unchanged line.
    pen_steps: Vec<PenStep>,
    /// One entry per flow fragment, in flow order.
    fragment_topology: Vec<FragmentTopology>,
    line_step_starts: Vec<u32>,
    line_span_starts: Vec<u32>,
    /// Whether the line's pen steps describe all of it: no edge record, drop cap or decoration.
    line_repositionable: Vec<bool>,
    numeric_translations: Vec<SegmentTranslation>,
    /// Scratch: the retained flow's edge record and this flow's, per edge of the line in hand.
    edge_pairs: Vec<(u32, u32)>,
    /// Scratch: this build's replacement run for each retained boundary segment.
    edge_runs: Vec<u32>,
    // Line ink: written in the pass that places the line, read by measurement.
    line_ink: Vec<LineInk>,
    line_missing_glyphs: Vec<u32>,
    line_ink_complete: bool,
}

/// Two resolved styles share one decoration line when every declared decoration field
/// matches: the CSS decorating-box group.
fn same_decoration_group(left: &ResolvedStyle, right: &ResolvedStyle) -> bool {
    left.decoration_flags == right.decoration_flags
        && left.decoration_rgba == right.decoration_rgba
        && left.decoration_style == right.decoration_style
        && left.material_id == right.material_id
        && left.decoration_thickness.to_bits() == right.decoration_thickness.to_bits()
        && left.decoration_offset.to_bits() == right.decoration_offset.to_bits()
        && left.decoration_font_size.to_bits() == right.decoration_font_size.to_bits()
}

#[derive(Clone, Copy)]
struct DecoratedRun {
    style: ResolvedStyle,
    font_handle: u32,
    start: f64,
    end: f64,
    /// Layout indices of the run's glyphs, as `glyph_start..glyph_limit`.
    glyph_start: u32,
    glyph_limit: u32,
}

struct FragmentPositionState {
    cursor: f64,
    baseline: f64,
    decorated_run: Option<DecoratedRun>,
    space_ordinal: i64,
    gap_ordinal: i64,
}

#[derive(Clone, Copy)]
struct PlacementOccurrence {
    segment_index: u32,
    translation_inline: f32,
    translation_block: f32,
}

/// The two things a line's cut draws besides the retained clusters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CutUnit {
    /// The clusters before the cut, reshaped alone.
    Island,
    /// The glyphs the cut inserts: an ellipsis.
    Marker,
}

/// A line's cut record and what drawing its units reads.
#[derive(Clone, Copy)]
struct CutRecord<'a> {
    line: FlowLine,
    index: u32,
    boundary: BoundaryShape,
    text: &'a [u16],
    clusters: &'a ClusterArena,
    runs: &'a [ShapingRun],
    styles: &'a [StyleSegment],
    shape: &'a BoundaryShapeArena,
    justify: JustifyDistribution,
}

/// The part of a boundary slice one numeric block holds, placed.
#[derive(Clone, Copy)]
struct BoundarySlice {
    occurrence: PlacementOccurrence,
    glyph_count: u32,
    cluster_count: u32,
}

#[derive(Clone, Copy)]
struct ActiveFallbackPlacement {
    layout_run_index: usize,
    cluster: usize,
    direction: u8,
    placement_cluster: PlacementCluster,
    occurrence: PlacementOccurrence,
}

/// Where a line's cut units are drawn among its visual clusters, and the next one to draw.
struct CutStops {
    stops: [Option<(usize, CutUnit)>; 2],
    next: usize,
}

/// A fragment body walked in visual order: `count` clusters from `body_start` when the
/// line is visually left-to-right, otherwise the reordered clusters from `visual_start`.
#[derive(Clone, Copy)]
struct VisualSpan {
    visually_ltr: bool,
    body_start: usize,
    visual_start: usize,
    count: usize,
}

struct PositionedCluster {
    style: ResolvedStyle,
    font_handle: u32,
    cluster_origin: f64,
    /// Layout indices of the cluster's glyphs; empty for a cluster that owns none.
    glyphs: core::ops::Range<u32>,
}

/// One line's ink in positioned space: what a union of its glyphs' placed ink boxes gives.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LineInk {
    pub inline_min: f64,
    pub block_min: f64,
    pub inline_max: f64,
    pub block_max: f64,
    pub state: LineInkState,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum LineInkState {
    /// The line placed no glyph.
    #[default]
    Empty,
    Joined,
    /// Positioning could not answer for the line; measurement walks its glyphs.
    Unmeasured,
}

/// One step of a line's pen: clusters positioned from one translation, in visual order.
/// Steps are content. They name which segments a line has and where the pen may have to
/// test a merge, so a line whose breaks are unchanged repeats only the arithmetic.
#[derive(Clone, Copy)]
struct PenStep {
    /// First cluster in visual order; later ones descend when `STEP_REVERSE` is set.
    first: u32,
    count: u32,
    /// Run-local lane of `first` (`cluster_prefixes`), or `NO_LANE` for a glyphless break.
    lane: u32,
    /// Index into the paragraph's numeric blocks.
    block: u32,
    flags: u8,
}

const NO_LANE: u32 = u32::MAX;
const STEP_REVERSE: u8 = 1;
/// The step joined the segment before it: its translation published the same f32.
const STEP_JOINED: u8 = 1 << 1;
/// The step could have joined the segment before it had the translations agreed.
const STEP_MERGEABLE: u8 = 1 << 2;
/// Every cluster after the first stayed in the step because its own translation published
/// the step's f32.
const STEP_CHECKED: u8 = 1 << 3;

/// The pen facts of one body fragment that depend on content alone.
#[derive(Clone, Copy, Default)]
struct FragmentTopology {
    steps: u32,
    flags: u8,
}

const FRAGMENT_VISUAL_ORDER: u8 = 1;
const FRAGMENT_ADJUSTS_SPACES: u8 = 1 << 1;
const FRAGMENT_ADJUSTS_GAPS: u8 = 1 << 2;
const FRAGMENT_HUNG_LEADS: u8 = 1 << 3;

/// What every body segment of one fragment shares.
#[derive(Clone, Copy)]
struct BodyLine<'a> {
    line: FlowLine,
    text_start: u32,
    clusters: &'a ClusterArena,
    runs: &'a [ShapingRun],
    styles: &'a [StyleSegment],
    justify: JustifyDistribution,
}

/// One segment's clusters in visual order: `count` clusters from `first`, descending when the
/// run is right-to-left. `levels` indexes the reordered line's levels at `first`.
#[derive(Clone, Copy)]
struct SegmentWalk {
    segment_index: u32,
    first: usize,
    count: usize,
    reverse: bool,
    levels: Option<usize>,
}

#[derive(Clone, Copy)]
struct BoundaryRunSpec {
    source_kind: LayoutRunSourceKind,
    cluster_start: u32,
    cluster_end: u32,
    glyph_start: u32,
    glyph_count: u32,
    source_run: u32,
    font_handle: u32,
}

#[derive(PartialEq, Eq)]
struct BoundaryShapeSpan<'a> {
    glyph_ids: &'a [u16],
    x_advances: &'a [i32],
    y_advances: &'a [i32],
    x_offsets: &'a [i32],
    y_offsets: &'a [i32],
    glyph_flags: &'a [u16],
    stable_ids: &'a [u32],
}

#[derive(Clone, Copy)]
struct RunGeometry {
    font_handle: u32,
    font_size: f32,
}

// Count completed payload copies, including field columns, at the native test target's layout.
// This excludes allocation capacity, line metadata, and zero-filled effect columns.

impl PositionedGlyphArena {
    pub(crate) fn decorations(&self) -> &[DecorationRecord] {
        &self.decorations
    }

    #[cfg(test)]
    pub(crate) fn retains_recomposed_glyph_ranges(&self) -> bool {
        self.recomposed_glyphs_retained
    }

    pub(crate) fn replacement_runs(&self) -> &[LayoutRun] {
        &self.replacement_runs
    }

    #[cfg(any(test, feature = "oracle"))]
    pub(crate) fn replacement_run_local(&self) -> &RunLocalArena {
        &self.replacement_run_local
    }

    pub(crate) fn placement_segments(&self) -> &[super::placement_state::PlacementSegment] {
        self.placement.segment_rows()
    }

    pub(crate) fn placement_translations(&self) -> &[SegmentTranslation] {
        self.placement.translations()
    }

    pub(crate) fn placement_instance_count(&self) -> Result<usize, EngineError> {
        self.placement.instance_count()
    }

    pub(crate) fn placement_handle(&self, segment_index: usize) -> Option<PlacementHandle> {
        self.placement.placement_handle(segment_index)
    }

    /// Bind placement by segment. The outlined span owns the segment index,
    /// so no per-glyph slot writes or revision allocation occur at setter time.
    pub(crate) fn bind_placement_handles(
        &mut self,
        handles: &[PlacementHandle],
    ) -> Result<(), EngineError> {
        let counts = self.placement.segment_instance_counts();
        if handles.len() != self.placement.segment_rows().len() || handles.len() != counts.len() {
            return Err(EngineError::InvalidRequest);
        }
        let total = counts.iter().try_fold(0usize, |total, count| {
            total
                .checked_add(*count as usize)
                .ok_or(EngineError::ResultTooLarge)
        })?;
        if total != self.outlined_count() {
            return Err(EngineError::InvalidRequest);
        }
        let mut instance_start = 0usize;
        for (segment_index, handle) in handles.iter().enumerate() {
            let count = self.placement.segment_instance_counts()[segment_index];
            let instance_end = instance_start
                .checked_add(count as usize)
                .ok_or(EngineError::ResultTooLarge)?;
            if self.placement.placement_handle(segment_index) != Some(*handle) {
                if self.recomposed_glyphs_retained
                    && !self
                        .recomposed_glyphs
                        .iter()
                        .any(|range| range.start <= instance_start && instance_end <= range.end)
                {
                    self.recomposed_glyphs_retained = false;
                }
                self.placement
                    .set_placement_handle(segment_index, Some(*handle));
            }
            instance_start = instance_end;
        }
        Ok(())
    }

    pub(crate) fn semantic_line_glyph_spans(&self) -> (&[u32], &[u32]) {
        (
            &self.semantic_line_glyph_starts,
            &self.semantic_line_glyph_counts,
        )
    }

    pub(crate) fn semantic_line_inline_extents(&self) -> &[f64] {
        &self.semantic_line_inline_extents
    }

    /// Each line's ink and missing-glyph count, when positioning measured every line.
    pub(crate) fn line_ink(&self) -> Option<(&[LineInk], &[u32])> {
        self.line_ink_complete.then_some((
            self.line_ink.as_slice(),
            self.line_missing_glyphs.as_slice(),
        ))
    }

    pub(crate) fn mark_published(&mut self) {
        self.recomposed_glyphs.clear();
        self.recomposed_glyphs_retained = true;
        self.layout_indices_retained = true;
    }

    /// The outlined ordinals whose rows may differ from the published ones, when the rest are
    /// proved unchanged. `layout_indices` asks that proof to cover each row's layout index,
    /// which a blank or boundary glyph added before a retained line moves.
    pub(crate) fn unpublished_source_intervals(
        &self,
        layout_indices: bool,
    ) -> Option<&[core::ops::Range<usize>]> {
        (self.recomposed_glyphs_retained && (!layout_indices || self.layout_indices_retained))
            .then_some(self.recomposed_glyphs.as_slice())
    }

    /// Declares every source row unpublished without repositioning any: a paint-only change
    /// alters what a row projects, not where it sits.
    pub(crate) fn mark_unpublished(&mut self) {
        self.recomposed_glyphs.clear();
        self.recomposed_glyphs_retained = false;
    }
}

/// What one positioning build reads. The callbacks are read per line, per decoration and per
/// island glyph, never per body glyph, so every caller shares one build behind trait objects.
#[derive(Clone, Copy)]
struct PositioningSource<'a> {
    previous: &'a PositionedGlyphArena,
    flow: &'a FlowLayoutArena,
    retained_flow: Option<&'a FlowLayoutArena>,
    recomposed_lines: Option<&'a [core::ops::Range<usize>]>,
    text: &'a [u16],
    clusters: &'a ClusterArena,
    previous_clusters: &'a ClusterArena,
    runs: &'a [ShapingRun],
    previous_runs: &'a [ShapingRun],
    boundary_shape: &'a BoundaryShapeArena,
    previous_boundary_shape: &'a BoundaryShapeArena,
    styles: &'a [StyleSegment],
    bidi: &'a BidiAnalysis,
    typography_for: &'a dyn Fn(u32) -> ThreadTypography,
    retained_typography_for: &'a dyn Fn(u32) -> ThreadTypography,
    metrics_for: &'a dyn Fn(u32) -> Option<FontMetrics>,
    extents_for: &'a dyn Fn(u32, u32) -> Option<FontGlyphExtents>,
}

/// The cursors a positioning build advances line by line.
struct LineBuildWalk<'a> {
    source_coordinates_retained: bool,
    layout_indices_retained: bool,
    retained_cursor: Option<RetainedFlowLineCursor<'a>>,
    recomposed_line_index: usize,
    drop_cap_cursor: usize,
    fragment_cursor: usize,
    previous_flow_thread_id: Option<u32>,
}

/// One flow line's position in the build before it is retained or positioned.
#[derive(Clone, Copy)]
struct LineBuildHead {
    line_index: usize,
    line: FlowLine,
    fragment_start: u32,
    first_thread_line: bool,
    final_line: bool,
    drop_cap: Option<FlowDropCap>,
    previous_drop_cap: Option<FlowDropCap>,
    line_span_start: usize,
    line_step_start: usize,
}

/// Where a line's glyphs, decorations and occurrences begin.
#[derive(Clone, Copy)]
struct LineGlyphStarts {
    glyph: usize,
    decoration: usize,
    semantic: usize,
}

/// A line matched against the previous build.
enum MatchedLine {
    /// The previous line was appended whole.
    Appended,
    /// The previous line `(index, fragment start, edges)` to repeat numerically, if any.
    Reposition(Option<(usize, usize, bool)>),
}

struct RetainedFlowLineCursor<'a> {
    lines: core::iter::Peekable<core::iter::Copied<super::retained_rope::RopeIter<'a, FlowLine>>>,
    fragments: RopeCursor<'a, FlowFragment>,
    line_index: usize,
    fragment_index: usize,
}

/// A line of the retained flow holding the same clusters in the same fragments. `exact` adds
/// that every positioning input is bit-equal, so the line's numbers are retained as well. A
/// line with edge records matches only exactly.
struct RetainedLineMatch {
    index: usize,
    line: FlowLine,
    exact: bool,
    /// The line has edge records, each equal in content to the retained line's.
    edges: bool,
}

// Each argument is one independently compared positioning input. Packing them
// into a context would hide the proof boundary without reducing caller state.

// Stage aggregation: each argument is one explicit input threaded through the
// pipeline rather than hidden mutable state, and D-244 measured outlining these
// bodies as size-neutral. Arity is the shape, not a smell.

/// One flow thread's typography, resolved from its constraint record.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct ThreadTypography {
    pub first_line_indent: f64,
    pub justify: JustifyControls,
}

/// Per-thread justification controls carried by the constraint record. Zero
/// ratio fields mean unbounded on that side; the default reproduces the
/// pre-tier equal-space distribution exactly.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct JustifyControls {
    pub minimum_word_space_ratio: f32,
    pub maximum_word_space_ratio: f32,
    pub letter_space_expansion: f32,
    pub last_line_justify: bool,
}

/// One line's resolved justification in F16.16 layout units (integer-units plan,
/// slice 4): a uniform per-space delta with a euclidean remainder spread one unit
/// at a time over the leading spaces, the bounded letter-gap equivalent, and the
/// trimmed cluster bound the gaps apply within. The euclidean split makes the
/// distributed total exact — `per * count + extra` reproduces the admitted growth
/// or shrink to the unit — so measurement and positioning agree bit-for-bit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct JustifyDistribution {
    pub spaces: u32,
    pub per_space_units: i64,
    pub extra_space_units: i64,
    pub gaps: u32,
    pub per_gap_units: i64,
    pub extra_gap_units: i64,
    pub gap_end: usize,
}

struct JustifiableSpan {
    spaces: u32,
    space_advance_units: i64,
    trimmed_end: usize,
}

#[cfg(test)]
mod tests {
    use super::super::{
        cluster_state::{ClusterBuildInput, RunCanonicalInput},
        line_composition::Correction,
        placement_slot_arena::PlacementSlotArena,
        shaping_state::{ShapeArena, ShapedRun},
        style_state::StyleArena,
    };
    use super::*;
    use crate::unicode::UnicodeAnalysis;

    fn one_range(range: core::ops::Range<usize>) -> Vec<core::ops::Range<usize>> {
        core::iter::once(range).collect()
    }

    #[test]
    fn recomposed_range_merge_matches_covered_indices() {
        for (mut current, previous, expected) in [
            (vec![], vec![], vec![]),
            (one_range(1..3), vec![], one_range(1..3)),
            (vec![], one_range(2..4), one_range(2..4)),
            (vec![1..3, 7..9], one_range(3..7), one_range(1..9)),
            (one_range(1..10), one_range(3..5), one_range(1..10)),
            (vec![1..2, 8..9], one_range(4..5), vec![1..2, 4..5, 8..9]),
            (one_range(2..2), one_range(2..4), one_range(2..4)),
        ] {
            merge_recomposed_glyphs(&mut current, &previous).unwrap();
            assert_eq!(current, expected);
        }

        let mut seed = 0x5b7u32;
        for _ in 0..512 {
            let mut lists = [Vec::new(), Vec::new()];
            let mut covered = [false; 64];
            for list in &mut lists {
                let count = (seed & 7) as usize;
                for _ in 0..count {
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    let start = (seed % 48) as usize;
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    let end = start + 1 + (seed % 12) as usize;
                    list.push(start..end);
                    covered[start..end].fill(true);
                }
                list.sort_unstable_by_key(|range| range.start);
            }
            let [mut current, previous] = lists;
            merge_recomposed_glyphs(&mut current, &previous).unwrap();
            assert!(current.windows(2).all(|pair| pair[0].end < pair[1].start));
            let mut actual = [false; 64];
            for range in current {
                actual[range].fill(true);
            }
            assert_eq!(actual, covered);
        }
    }

    fn boundary_record(flow_thread_id: u32, glyph_start: u32) -> BoundaryShape {
        BoundaryShape {
            flow_thread_id,
            source_run: 0,
            cluster_start: 0,
            cluster_end: 1,
            text_end: 1,
            source_binding_handle: 1,
            source_font_handle: 1,
            ellipsis_binding_handle: 0,
            ellipsis_font_handle: 0,
            source_glyph_start: glyph_start,
            source_glyph_count: 1,
            ellipsis_glyph_start: 0,
            ellipsis_glyph_count: 0,
            line_start: false,
        }
    }

    fn boundary_arena(records: Vec<BoundaryShape>, clusters: Vec<u32>) -> BoundaryShapeArena {
        let count = clusters.len();
        BoundaryShapeArena {
            records,
            shape: ShapeArena {
                runs: Vec::new(),
                glyph_ids: vec![7; count],
                clusters,
                x_advances: vec![64; count],
                y_advances: vec![0; count],
                x_offsets: vec![0; count],
                y_offsets: vec![0; count],
                glyph_flags: vec![0; count],
                beyond_pairs: Vec::new(),
            },
            stable_ids: vec![11; count],
        }
    }

    #[test]
    fn boundary_cluster_comparison_preserves_signed_relative_order() {
        let spec = |glyph_start, glyph_count| BoundaryRunSpec {
            source_kind: LayoutRunSourceKind::Boundary {
                flow_thread_id: 1,
                role: BoundaryRunRole::BoundarySource,
            },
            cluster_start: 0,
            cluster_end: 1,
            glyph_start,
            glyph_count,
            source_run: 0,
            font_handle: 1,
        };
        let ascending = boundary_arena(Vec::new(), vec![10, 12, 15]);
        let shifted_ascending = boundary_arena(Vec::new(), vec![100, 102, 105]);
        let descending = boundary_arena(Vec::new(), vec![20, 17, 11]);
        let shifted_descending = boundary_arena(Vec::new(), vec![90, 87, 81]);
        let differently_spaced_descending = boundary_arena(Vec::new(), vec![90, 86, 81]);
        let mixed = boundary_arena(Vec::new(), vec![20, 16, 23]);
        let shifted_mixed = boundary_arena(Vec::new(), vec![50, 46, 53]);
        assert!(same_relative_boundary_clusters(
            &ascending,
            spec(0, 3),
            &shifted_ascending,
            spec(0, 3),
        )
        .unwrap());
        assert!(
            same_relative_boundary_clusters(
                &descending,
                spec(0, 3),
                &shifted_descending,
                spec(0, 3),
            )
            .unwrap()
        );
        assert!(
            same_relative_boundary_clusters(&mixed, spec(0, 3), &shifted_mixed, spec(0, 3),)
                .unwrap()
        );
        assert!(
            !same_relative_boundary_clusters(&descending, spec(0, 3), &ascending, spec(0, 3),)
                .unwrap()
        );
        assert!(
            !same_relative_boundary_clusters(
                &descending,
                spec(0, 3),
                &differently_spaced_descending,
                spec(0, 3),
            )
            .unwrap()
        );
    }

    #[test]
    fn replacement_reconciliation_ignores_record_order_and_binding() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 1,
            script: 0,
            direction: 0,
            bidi_level: 0,
            style,
        }];
        let empty = BoundaryShapeArena::default();
        let previous_shape = boundary_arena(
            vec![boundary_record(1, 0), boundary_record(2, 1)],
            vec![10, 20],
        );
        let mut previous = PositionedGlyphArena::default();
        let no_previous = PositionedGlyphArena::default();
        let mut revision = 1;
        previous
            .rebuild_replacement_runs(
                &no_previous,
                &previous_shape,
                &empty,
                &runs,
                &runs,
                &mut revision,
            )
            .unwrap();
        let previous_revisions = [
            previous.replacement_runs[previous.replacement_run_indices[0][0].unwrap() as usize]
                .canonical_revision,
            previous.replacement_runs[previous.replacement_run_indices[1][0].unwrap() as usize]
                .canonical_revision,
        ];
        let mut reordered_shape = boundary_arena(
            vec![
                boundary_record(0, 0),
                boundary_record(2, 1),
                boundary_record(1, 2),
            ],
            vec![5, 20, 10],
        );
        reordered_shape.records[1].source_binding_handle = 99;
        reordered_shape.records[2].source_binding_handle = 77;
        let mut next = PositionedGlyphArena::default();
        next.rebuild_replacement_runs(
            &previous,
            &reordered_shape,
            &previous_shape,
            &runs,
            &runs,
            &mut revision,
        )
        .unwrap();
        assert_eq!(
            next.replacement_runs[next.replacement_run_indices[1][0].unwrap() as usize]
                .canonical_revision,
            previous_revisions[1],
        );
        assert_eq!(
            next.replacement_runs[next.replacement_run_indices[2][0].unwrap() as usize]
                .canonical_revision,
            previous_revisions[0],
        );

        let mut changed_shape = boundary_arena(
            vec![boundary_record(2, 0), boundary_record(1, 1)],
            vec![20, 10],
        );
        changed_shape.records[0].source_font_handle = 2;
        changed_shape.shape.x_advances[1] += 1;
        let mut changed = PositionedGlyphArena::default();
        changed
            .rebuild_replacement_runs(
                &next,
                &changed_shape,
                &reordered_shape,
                &runs,
                &runs,
                &mut revision,
            )
            .unwrap();
        assert_ne!(
            changed.replacement_runs[changed.replacement_run_indices[0][0].unwrap() as usize]
                .canonical_revision,
            previous_revisions[1],
        );
        assert_ne!(
            changed.replacement_runs[changed.replacement_run_indices[1][0].unwrap() as usize]
                .canonical_revision,
            previous_revisions[0],
        );
    }

    fn assert_layout_plan_producer_invariants(
        arena: &PositionedGlyphArena,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
        context: PositionedSourceContext<'_>,
    ) {
        assert_eq!(
            arena.line_decoration_starts.len(),
            arena.line_glyph_starts.len()
        );
        assert_eq!(
            arena.line_decoration_counts.len(),
            arena.line_glyph_counts.len()
        );
        for (&start, &count) in arena
            .line_decoration_starts
            .iter()
            .zip(&arena.line_decoration_counts)
        {
            assert!((start as usize).saturating_add(count as usize) <= arena.decorations.len());
        }
        let mut semantic = arena.occurrence_cursor(0, clusters, boundary).unwrap();
        let mut stable_ids = Vec::new();
        for _ in 0..arena.occurrence_count() {
            stable_ids.push(semantic.next_row().unwrap().unwrap().semantic.stable_id);
        }
        assert!(semantic.next_row().unwrap().is_none());
        assert!(stable_ids.iter().all(|&stable_id| stable_id != 0));
        stable_ids.sort_unstable();
        assert!(stable_ids.windows(2).all(|pair| pair[0] != pair[1]));

        let mut outlined = arena.outlined_cursor(clusters, boundary);
        let mut outlined_count = 0;
        while let Some(mark) = outlined.next_mark().unwrap() {
            let occurrence = outlined.project(mark).unwrap();
            let expected_stable_id = occurrence.semantic.stable_id;
            let binding_handle = occurrence.span.binding_handle;
            let row = arena
                .projected_occurrence_row(occurrence, mark.semantic_index, 0, context)
                .unwrap();
            for field in 0..SEMANTIC_F32_FIELD_COUNT {
                assert!(row.f32(field).unwrap().is_finite());
            }
            for field in 0..SEMANTIC_U32_FIELD_COUNT {
                assert!(row.u32(field).is_some());
            }
            let glyph = row.glyph;
            assert_eq!(glyph.stable_id, expected_stable_id);
            assert_ne!(binding_handle, 0);
            assert_ne!(glyph.font_handle, 0);
            assert!(glyph.inline_start.is_finite());
            assert!(glyph.block_start.is_finite());
            assert!(glyph.inline_extent.is_finite() && glyph.inline_extent >= 0.0);
            assert!(glyph.block_extent.is_finite() && glyph.block_extent >= 0.0);
            assert!((glyph.inline_start + glyph.inline_extent).is_finite());
            assert!((glyph.block_start + glyph.block_extent).is_finite());
            outlined_count += 1;
        }
        assert_eq!(outlined_count, arena.outlined_count());
        for decoration in &arena.decorations {
            assert!(decoration.inline_start.is_finite());
            assert!(decoration.block_start.is_finite());
            assert!(decoration.inline_extent.is_finite() && decoration.inline_extent >= 0.0);
            assert!((decoration.block_start + decoration.block_extent).is_finite());
        }
    }

    fn semantic_row_at(
        arena: &PositionedGlyphArena,
        index: usize,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
    ) -> PositionedSemanticGlyph {
        arena
            .occurrence_cursor(index, clusters, boundary)
            .unwrap()
            .next_row()
            .unwrap()
            .unwrap()
            .semantic
    }

    fn placed_semantic_at(
        arena: &PositionedGlyphArena,
        index: usize,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
    ) -> SemanticGlyph {
        arena
            .placed_occurrence(semantic_row_at(arena, index, clusters, boundary))
            .unwrap()
    }

    fn projected_row_at<'a>(
        arena: &'a PositionedGlyphArena,
        index: usize,
        context: PositionedSourceContext<'a>,
        boundary: &'a BoundaryShapeArena,
    ) -> ProjectedSourceRow<'a> {
        let mut cursor = arena.outlined_cursor(context.clusters, boundary);
        cursor.seek(index).unwrap();
        let mark = cursor.next_mark().unwrap().unwrap();
        let occurrence = cursor.project(mark).unwrap();
        arena
            .projected_occurrence_row(occurrence, mark.semantic_index, 0, context)
            .unwrap()
    }

    fn layout_run_positioning_fixture()
    -> (Vec<u16>, ClusterArena, Vec<ShapingRun>, Vec<StyleSegment>) {
        layout_run_positioning_fixture_with_run1_direction(0)
    }

    fn layout_run_positioning_fixture_with_run1_direction(
        run1_direction: u8,
    ) -> (Vec<u16>, ClusterArena, Vec<ShapingRun>, Vec<StyleSegment>) {
        let text = "abcdefg漢字語文\n".encode_utf16().collect::<Vec<_>>();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let mut style = ResolvedStyle::test_typography(10.0, -6.0, 0.0);
        style.baseline_shift = 0.25;
        let styles = vec![StyleSegment {
            text_start: 0,
            text_end: u32::try_from(text.len()).unwrap(),
            style,
        }];
        let mut runs = vec![
            ShapingRun {
                text_start: 0,
                text_end: 3,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 3,
                text_end: 7,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 7,
                text_end: 11,
                script: u32::from_be_bytes(*b"Hani"),
                direction: 0,
                bidi_level: 0,
                style,
            },
        ];
        runs[1].direction = run1_direction;
        runs[1].bidi_level = run1_direction;
        let shape = ShapeArena {
            runs: vec![
                ShapedRun {
                    source_run: 0,
                    binding_handle: 101,
                    font_handle: 11,
                    text_start: 0,
                    text_end: 3,
                    glyph_start: 0,
                    glyph_count: 3,
                },
                ShapedRun {
                    source_run: 1,
                    binding_handle: 101,
                    font_handle: 11,
                    text_start: 3,
                    text_end: 5,
                    glyph_start: 3,
                    glyph_count: 2,
                },
                ShapedRun {
                    source_run: 1,
                    binding_handle: 202,
                    font_handle: 22,
                    text_start: 5,
                    text_end: 7,
                    glyph_start: 5,
                    glyph_count: 2,
                },
                ShapedRun {
                    source_run: 2,
                    binding_handle: 202,
                    font_handle: 22,
                    text_start: 7,
                    text_end: 11,
                    glyph_start: 7,
                    glyph_count: 4,
                },
            ],
            glyph_ids: vec![10, 11, 12, 20, 21, 30, 31, 40, 41, 42, 43],
            clusters: vec![0, 1, 1, 3, 4, 5, 6, 7, 8, 9, 10],
            x_advances: vec![-300, 200, -100, 500, -500, 500, 500, 700, -700, 700, 700],
            y_advances: vec![0; 11],
            x_offsets: vec![-17, 33, -9, 11, -13, 5, -7, 0, 19, -23, 7],
            y_offsets: vec![5, -7, 3, 9, -11, 1, -3, 0, 4, -6, 2],
            glyph_flags: vec![0; 11],
            beyond_pairs: Vec::new(),
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
                    text_unit_ids: &(1..=u32::try_from(text.len()).unwrap()).collect::<Vec<_>>(),
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        clusters.glyph_stable_ids = (1..=u32::try_from(shape.glyph_ids.len()).unwrap()).collect();
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, |_, _| {
            Some(FontGlyphExtents {
                x_min: -10,
                y_min: -200,
                x_max: 800,
                y_max: 700,
            })
        });
        (text, clusters, runs, styles)
    }

    fn prepare_positioning_clusters(
        clusters: &mut ClusterArena,
        text: &[u16],
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) {
        let text_unit_ids = (1..=u32::try_from(text.len()).unwrap()).collect::<Vec<_>>();
        let style_arena = StyleArena::default();
        let mut next_revision = 1;
        clusters
            .finalize_layout_run_revisions(
                &ClusterArena::default(),
                RunCanonicalInput {
                    text,
                    text_unit_ids: &text_unit_ids,
                    style_arena: &style_arena,
                    styles,
                    shaping_runs: runs,
                },
                RunCanonicalInput {
                    text: &[],
                    text_unit_ids: &[],
                    style_arena: &style_arena,
                    styles: &[],
                    shaping_runs: &[],
                },
                &mut IdentityIndex::default(),
                &mut next_revision,
                None,
            )
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters.ensure_placement_segment_anchors().unwrap();
        clusters
            .rebuild_run_local_geometry(runs, styles, extents_for)
            .unwrap();
    }

    struct PositioningFixture {
        arena: PositionedGlyphArena,
        clusters: ClusterArena,
        styles: Vec<StyleSegment>,
    }

    impl core::ops::Deref for PositioningFixture {
        type Target = PositionedGlyphArena;
        fn deref(&self) -> &Self::Target {
            &self.arena
        }
    }

    impl core::ops::DerefMut for PositioningFixture {
        fn deref_mut(&mut self) -> &mut Self::Target {
            &mut self.arena
        }
    }

    impl PositioningFixture {
        fn context(&self) -> PositionedSourceContext<'_> {
            PositionedSourceContext {
                clusters: &self.clusters,
                styles: &self.styles,
            }
        }
    }

    fn fixture_position_results(
        cluster_start: usize,
        cluster_end: usize,
        mutate: impl FnOnce(&mut ClusterArena, &mut [StyleSegment], &mut FlowLine),
    ) -> PositioningFixture {
        fixture_position_results_with_extents(cluster_start, cluster_end, mutate, |_, glyph_id| {
            Some(FontGlyphExtents {
                x_min: -10,
                y_min: -200,
                x_max: i32::try_from(400 + glyph_id).unwrap(),
                y_max: 700,
            })
        })
    }

    fn fixture_position_results_with_extents(
        cluster_start: usize,
        cluster_end: usize,
        mutate: impl FnOnce(&mut ClusterArena, &mut [StyleSegment], &mut FlowLine),
        extents: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> PositioningFixture {
        let (text, mut clusters, runs, mut styles) = layout_run_positioning_fixture();
        let advance = clusters.advances[cluster_start..cluster_end]
            .iter()
            .copied()
            .sum();
        let mut line = FlowLine {
            typography: Default::default(),
            flow_thread_id: 1,
            region_id: 2,
            transform_index: 3,
            clip_id: 4,
            fragment_count: 1,
            align: ALIGN_START,
            block_start: 512.125,
            baseline: 9.5,
            height: 12.0,
        };
        mutate(&mut clusters, &mut styles, &mut line);
        let fragment = FlowFragment {
            line: ComposedLine {
                cluster_start: u32::try_from(cluster_start).unwrap(),
                cluster_end: u32::try_from(cluster_end).unwrap(),
                text_start: clusters.starts[cluster_start],
                text_end: clusters.ends[cluster_end - 1],
                advance,
                hung_advance: 0.0,
                hard_break: clusters.flags[cluster_end - 1] & CLUSTER_HARD_BREAK != 0,
                start_correction: Correction::ZERO,
                end_correction: Correction::ZERO,
            },
            slot_start: 1_000_000.125,
            slot_end: 1_000_512.125,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
            lead_index: NO_BOUNDARY,
            tail_index: NO_BOUNDARY,
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let mut production = PositionedGlyphArena::default();
        production.placement.clear();
        production.current_source_line = SourceLine::Body(0);
        production
            .position_fragment(
                line,
                fragment,
                true,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &BidiAnalysis::default(),
                true,
                0.0,
                JustifyControls::default(),
                |_| None,
            )
            .unwrap();
        production.assert_occurrence_expansion(&clusters, &BoundaryShapeArena::default());
        PositioningFixture {
            arena: production,
            clusters,
            styles,
        }
    }

    #[test]
    fn occurrence_cursor_seeks_inside_a_multi_glyph_cluster() {
        let fixture = fixture_position_results(0, 3, |_, _, _| {});
        let spans = fixture.occurrence_spans();
        assert_eq!(fixture.clusters.glyph_counts[1], 2);
        assert!(spans.iter().any(|span| span.cluster_count >= 2));
        let boundary = BoundaryShapeArena::default();
        let mut cursor = fixture
            .occurrence_cursor(2, &fixture.clusters, &boundary)
            .unwrap();
        let projected = cursor.next_row().unwrap().unwrap();
        let source = fixture.clusters.glyph_starts[1] + 1;
        assert_eq!(
            source, 2,
            "the selected row is the second glyph of cluster one"
        );
        let local = fixture
            .clusters
            .run_local()
            .row_for_source_glyph(source)
            .unwrap();
        assert_eq!(
            projected.semantic.stable_id,
            fixture.clusters.glyph_stable_ids[2]
        );
        assert_eq!(projected.semantic.glyph_id, fixture.clusters.glyph_ids[2]);
        assert_eq!(
            projected.semantic.cluster,
            fixture.clusters.glyph_clusters[2]
        );
        assert_eq!(
            projected.semantic.inline_origin.to_bits(),
            local.inline_origin.to_bits()
        );
        assert_eq!(
            projected.semantic.ink_inline_start.to_bits(),
            local.ink_inline_start.to_bits()
        );
        assert_eq!(projected.owner_cluster, 1);
        assert!(projected.span.cluster_count >= 2);
        assert!(projected.span.semantic_start <= 2);
        assert!(projected.span.semantic_start + projected.span.source_glyph_count > 2);
    }

    #[test]
    fn outline_less_shaped_glyph_remains_a_semantic_occurrence() {
        let fixture = fixture_position_results_with_extents(
            0,
            2,
            |_, _, _| {},
            |_, glyph_id| {
                (glyph_id != 10).then_some(FontGlyphExtents {
                    x_min: -10,
                    y_min: -200,
                    x_max: i32::try_from(400 + glyph_id).unwrap(),
                    y_max: 700,
                })
            },
        );
        let boundary = BoundaryShapeArena::default();
        assert_eq!(
            fixture.clusters.run_local().source_range_counts(0, 3),
            Some((3, 2))
        );
        assert_eq!(fixture.occurrence_count(), 3);
        assert_eq!(fixture.outlined_count(), 2);
        let mut semantic = fixture
            .occurrence_cursor(0, &fixture.clusters, &boundary)
            .unwrap();
        let first = semantic.next_row().unwrap().unwrap();
        assert!(!first.has_outline);
        assert_eq!(first.semantic.glyph_id, 10);
        assert_eq!(
            first.semantic.stable_id,
            fixture.clusters.glyph_stable_ids[0]
        );
        assert_eq!(first.semantic.cluster, 0);
        assert_eq!(
            fixture.placed_occurrence(first.semantic).unwrap().stable_id,
            fixture.clusters.glyph_stable_ids[0]
        );
        let mut outlined = fixture.outlined_cursor(&fixture.clusters, &boundary);
        let mut outlined_ids = Vec::new();
        while let Some(mark) = outlined.next_mark().unwrap() {
            outlined_ids.push(outlined.project(mark).unwrap().semantic.stable_id);
        }
        assert_eq!(
            outlined_ids,
            fixture.clusters.glyph_stable_ids[1..3].to_vec()
        );
    }

    fn assert_run_positions_match_renderer_placement(cluster_start: usize, cluster_end: usize) {
        let production = fixture_position_results(cluster_start, cluster_end, |_, _, _| {});
        let boundary = BoundaryShapeArena::default();
        let mut cursor = production.outlined_cursor(&production.clusters, &boundary);
        let mut outlined = 0;
        while let Some(mark) = cursor.next_mark().unwrap() {
            let occurrence = cursor.project(mark).unwrap();
            let semantic = occurrence.semantic;
            let projected = production
                .projected_occurrence_row(occurrence, mark.semantic_index, 0, production.context())
                .unwrap();
            let layout = projected.glyph;
            let placed_semantic = production.placed_occurrence(semantic).unwrap();
            let translation = production
                .placement
                .translation(semantic.placement_segment as usize)
                .unwrap();
            let placed_inline = placed_f32(
                layout.inline_start,
                finite_f32(translation.translation_inline).unwrap(),
            )
            .unwrap();
            let placed_block = placed_f32(
                layout.block_start,
                finite_f32(translation.translation_block).unwrap(),
            )
            .unwrap();
            assert_eq!(semantic.stable_id, layout.stable_id);
            assert_eq!(
                placed_semantic.inline_origin.to_bits(),
                placed_inline.to_bits()
            );
            assert_eq!(
                placed_semantic.block_origin.to_bits(),
                placed_block.to_bits()
            );
            assert_eq!(
                projected.f32(0).unwrap().to_bits(),
                semantic.ink_inline_start.to_bits()
            );
            assert_eq!(
                projected.f32(1).unwrap().to_bits(),
                semantic.ink_block_start.to_bits()
            );
            assert_eq!(
                layout.inline_extent.to_bits(),
                semantic.ink_inline_extent.to_bits()
            );
            assert_eq!(
                layout.block_extent.to_bits(),
                semantic.ink_block_extent.to_bits()
            );
            outlined += 1;
        }
        assert_eq!(outlined, production.outlined_count());
    }

    #[test]
    fn layout_run_segments_match_renderer_placement_and_f32_rounding() {
        let (_, clusters, _, _) = layout_run_positioning_fixture();
        assert_eq!(
            clusters
                .layout_runs()
                .iter()
                .map(|run| (
                    run.cluster_start,
                    run.cluster_end,
                    run.source_run,
                    run.font_handle
                ))
                .collect::<Vec<_>>(),
            [(0, 5, 0, 11), (5, 11, 1, 22), (11, 12, u32::MAX, 0)]
        );
        assert_eq!(clusters.glyph_counts, [1, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
        assert!(clusters.advances[..3].iter().all(|advance| *advance < 0.0));

        assert_run_positions_match_renderer_placement(0, 12);
        assert_run_positions_match_renderer_placement(8, 10);

        let positioned = fixture_position_results(0, 12, |_, _, _| {});
        assert_eq!(positioned.placement.segments().len(), 7);
        assert_eq!(positioned.placement.segment_count(), 7);
        let hard_break = positioned.placement.segments().get(6).unwrap();
        assert_eq!(
            (hard_break.run_cluster_count, hard_break.source_glyph_count),
            (1, 0)
        );
        assert!(
            positioned
                .placement
                .translation(0)
                .unwrap()
                .translation_inline
                .is_finite()
        );
        assert_eq!(
            positioned
                .placement
                .segments()
                .get(1)
                .unwrap()
                .source_glyph_start,
            0
        );
        let local = 16_777_217.0_f64 as f32;
        let translation = -16_777_216.0_f32;
        let placed = placed_f32(local, translation).unwrap();
        let legacy_absolute = 1.0_f64 as f32;
        assert_eq!(placed.to_bits(), 0.0_f32.to_bits());
        assert_eq!(legacy_absolute.to_bits(), 1.0_f32.to_bits());
        assert_ne!(placed.to_bits(), legacy_absolute.to_bits());
    }

    #[test]
    fn bidi_fallback_records_an_unowned_hard_break() {
        let (text, clusters, runs, styles) = layout_run_positioning_fixture_with_run1_direction(1);
        let cluster_end = clusters.starts.len();
        let line = FlowLine {
            typography: Default::default(),
            flow_thread_id: 1,
            region_id: 2,
            transform_index: 3,
            clip_id: 4,
            fragment_count: 1,
            align: ALIGN_START,
            block_start: 0.0,
            baseline: 8.0,
            height: 10.0,
        };
        let fragment = FlowFragment {
            line: ComposedLine {
                cluster_start: 0,
                cluster_end: u32::try_from(cluster_end).unwrap(),
                text_start: 0,
                text_end: clusters.ends[cluster_end - 1],
                advance: clusters.advances.iter().copied().sum(),
                hung_advance: 0.0,
                hard_break: true,
                start_correction: Correction::ZERO,
                end_correction: Correction::ZERO,
            },
            slot_start: 0.0,
            slot_end: 100.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
            lead_index: NO_BOUNDARY,
            tail_index: NO_BOUNDARY,
        };
        let mut positioned = PositionedGlyphArena::default();
        positioned.placement.clear();
        positioned
            .position_fragment(
                line,
                fragment,
                true,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &BidiAnalysis::default(),
                false,
                0.0,
                JustifyControls::default(),
                |_| None,
            )
            .unwrap();

        let segment_count = positioned.placement.segment_count();
        let hard_break = positioned
            .placement
            .segments()
            .get(segment_count - 1)
            .unwrap();
        assert_eq!(hard_break.source_glyph_count, 0);
        assert_eq!(hard_break.run_cluster_count, 1);
        assert_eq!(
            hard_break.segment_anchor,
            clusters.stable_ids[cluster_end - 1]
        );
        let boundary = BoundaryShapeArena::default();
        positioned.assert_occurrence_expansion(&clusters, &boundary);
        let reverse = positioned
            .occurrence_spans
            .iter()
            .find(|span| span.cluster_order == ClusterOrder::Reverse && span.cluster_count >= 2)
            .expect("adjacent RTL clusters share a placement span");
        let mut reverse_owners = Vec::new();
        for start in reverse.semantic_start..reverse.semantic_start + reverse.source_glyph_count {
            let mut cursor = positioned
                .occurrence_cursor(start as usize, &clusters, &boundary)
                .unwrap();
            let projected = cursor.next_row().unwrap().unwrap();
            let owner = projected.owner_cluster as usize;
            reverse_owners.push(owner);
            let first = clusters.glyph_starts[owner] as usize;
            let end = first + clusters.glyph_counts[owner] as usize;
            assert!(clusters.glyph_stable_ids[first..end].contains(&projected.semantic.stable_id));
        }
        assert!(reverse_owners.windows(2).all(|pair| pair[0] >= pair[1]));
        assert!(reverse_owners[0] > *reverse_owners.last().unwrap());
        for start in [
            0,
            1,
            positioned.occurrence_count() / 2,
            positioned.occurrence_count() - 1,
        ] {
            let mut cursor = positioned
                .occurrence_cursor(start, &clusters, &boundary)
                .unwrap();
            let projected = cursor.next_row().unwrap().unwrap();
            let owner = projected.owner_cluster as usize;
            if projected.has_outline {
                let first = clusters.glyph_starts[owner] as usize;
                let end = first + clusters.glyph_counts[owner] as usize;
                assert!(
                    clusters.glyph_stable_ids[first..end].contains(&projected.semantic.stable_id)
                );
            } else {
                assert_eq!(clusters.glyph_counts[owner], 0);
            }
        }
    }

    /// A line that ends in a space keeps that space but does not charge it to `advance`.
    /// In LTR it is laid last, past the end, and costs nothing. In RTL it is laid FIRST,
    /// so without a discount it pushes every visible glyph right by its width -- which is
    /// the whole line visibly jumping right as each new character lands.
    #[test]
    fn a_hung_terminating_space_does_not_move_rtl_ink() {
        fn pen(paragraph_level: u8, hung_advance: f64) -> f64 {
            pen_with(paragraph_level, hung_advance, paragraph_level & 1 != 0)
        }

        fn pen_with(paragraph_level: u8, hung_advance: f64, hung_leads: bool) -> f64 {
            let line = FlowLine {
                typography: Default::default(),
                flow_thread_id: 1,
                region_id: 1,
                transform_index: 0,
                clip_id: 0,
                fragment_count: 1,
                align: ALIGN_START,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            };
            let fragment = FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 0,
                    text_start: 0,
                    text_end: 0,
                    advance: 10.0,
                    hung_advance,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: 0,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            };
            let clusters = ClusterArena::default();
            let (justify, origin) = fragment_pen(
                line,
                fragment,
                true,
                &clusters,
                0,
                0,
                0.0,
                JustifyControls::default(),
                paragraph_level,
                hung_leads,
            );
            assert!(justify.is_zero(), "start alignment must not justify");
            origin
        }

        // RTL start-alignment pins the ink's RIGHT edge to the slot end. The hung space is
        // laid before the ink, so the ink begins at `pen + hung` and must still end at 20.
        for hung in [0.0, 3.0] {
            let origin = pen(1, hung);
            assert_eq!(
                origin + hung + 10.0,
                20.0,
                "RTL ink right edge moved with a hung space of {hung}",
            );
        }

        // LTR start-alignment never consults the advance, so it was never affected and
        // must stay exactly where it was.
        for hung in [0.0, 3.0] {
            assert_eq!(
                pen(0, hung),
                0.0,
                "LTR pen moved with a hung space of {hung}"
            );
        }

        // The discount follows the terminating cluster's RESOLVED level, not the
        // paragraph's. A span-level bidi override can give that space the opposite parity
        // to the paragraph it sits in, and the pen has to believe the cluster.
        assert_eq!(
            pen_with(0, 3.0, true),
            -3.0,
            "an RTL-override suffix in an LTR paragraph must still be discounted",
        );
        assert_eq!(
            pen_with(1, 3.0, false),
            10.0,
            "an LTR-override suffix in an RTL paragraph must not be discounted",
        );
    }
    use crate::engine::{
        cluster_state::CLUSTER_SAFE_BEFORE, flow_composition::NO_BOUNDARY,
        line_composition::ComposedLine, style_state::ResolvedStyle,
    };
    use alloc::vec;

    #[test]
    fn l2_reorders_exact_levels_without_allocating() {
        let mut indices = Vec::with_capacity(8);
        indices.extend([0, 1, 2, 3, 4]);
        let mut levels = Vec::with_capacity(8);
        levels.extend([0, 1, 1, 2, 0]);
        let capacities = (indices.capacity(), levels.capacity());
        reorder_l2(&mut indices, &mut levels, 0);
        assert_eq!(indices, [0, 3, 2, 1, 4]);
        assert_eq!(levels, [0, 2, 1, 1, 0]);
        assert_eq!((indices.capacity(), levels.capacity()), capacities);
    }

    #[test]
    fn only_even_unoverridden_runs_skip_visual_reordering() {
        let mut bidi = BidiAnalysis {
            levels: vec![0, 2, 0],
            ..BidiAnalysis::default()
        };
        let mut run = ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style: ResolvedStyle::default(),
        };
        assert!(is_trivially_ltr(&bidi, &[run]));
        bidi.levels[1] = 1;
        assert!(!is_trivially_ltr(&bidi, &[run]));
        bidi.levels[1] = 0;
        run.style.bidi_override = true;
        assert!(!is_trivially_ltr(&bidi, &[run]));
    }

    #[test]
    fn resize_equivalence_admits_only_position_identical_flows() {
        let (_text, clusters, line, fragment) = justify_fixture();
        let bidi = BidiAnalysis::default();
        let typography = |_: u32| ThreadTypography {
            first_line_indent: 0.0,
            justify: JustifyControls::default(),
        };
        let arena = |align: u8, slot_end: f64| FlowLayoutArena {
            lines: vec![FlowLine { align, ..line }].into(),
            fragments: vec![FlowFragment {
                slot_end,
                ..fragment
            }]
            .into(),
            drop_caps: alloc::vec::Vec::new(),
            ellipsis_threads: alloc::vec::Vec::new(),
            recomposed_lines: vec![],
            recomposed_lines_retained: false,
            fit_witnesses: vec![],
        };
        let equivalent = |pending: &FlowLayoutArena, committed: &FlowLayoutArena| {
            flow_positioning_equivalent(
                pending,
                committed,
                &clusters,
                &bidi,
                typography,
                typography,
                (
                    &BoundaryShapeArena::default(),
                    &BoundaryShapeArena::default(),
                ),
            )
            .unwrap()
        };
        let retained_equivalent =
            |pending: &FlowLayoutArena,
             committed: &FlowLayoutArena,
             pending_typography: ThreadTypography,
             committed_typography: ThreadTypography| {
                let mut cursor = RetainedFlowLineCursor::new(committed).unwrap();
                let mut fragments = pending.fragments.cursor_from(0).unwrap();
                let line = pending.lines[0];
                let fragments = fragments.take(usize::from(line.fragment_count)).unwrap();
                // An inexact match keeps the line's topology and repeats its arithmetic.
                matching_retained_line(
                    line,
                    &fragments,
                    true,
                    &mut cursor,
                    &clusters,
                    &bidi,
                    pending_typography,
                    committed_typography,
                    (
                        &BoundaryShapeArena::default(),
                        &BoundaryShapeArena::default(),
                        &mut Vec::new(),
                    ),
                )
                .unwrap()
                .filter(|matched| matched.exact)
                .map(|matched| matched.index)
            };
        // A start-aligned line ignores the right edge: widening is a no-op.
        assert!(equivalent(
            &arena(ALIGN_START, 17.0),
            &arena(ALIGN_START, 25.0)
        ));
        assert_eq!(
            retained_equivalent(
                &arena(ALIGN_START, 17.0),
                &arena(ALIGN_START, 25.0),
                typography(0),
                typography(0),
            ),
            Some(0),
        );
        let indented = ThreadTypography {
            first_line_indent: 2.0,
            justify: JustifyControls::default(),
        };
        assert_eq!(
            retained_equivalent(
                &arena(ALIGN_START, 17.0),
                &arena(ALIGN_START, 17.0),
                indented,
                typography(0),
            ),
            None,
            "a changed first-line indent cannot reuse positioned glyphs"
        );
        // End alignment derives the pen origin from the slot end: not a no-op.
        assert!(!equivalent(
            &arena(ALIGN_END, 17.0),
            &arena(ALIGN_END, 25.0)
        ));
        let mut shifted_start = arena(ALIGN_END, 17.0);
        assert!(
            shifted_start
                .fragments
                .update(0, |fragment| {
                    fragment.slot_start = -2.0;
                })
                .unwrap()
        );
        assert_eq!(
            retained_equivalent(
                &shifted_start,
                &arena(ALIGN_END, 17.0),
                typography(0),
                typography(0),
            ),
            None,
            "a moved slot start changes the published semantic line extent",
        );
        assert!(!equivalent(
            &arena(ALIGN_CENTER, 17.0),
            &arena(ALIGN_CENTER, 25.0)
        ));
        // A final line under the auto last-line codec never justifies, so a
        // width change is genuinely a positioning no-op there.
        assert!(equivalent(
            &arena(ALIGN_JUSTIFY, 17.0),
            &arena(ALIGN_JUSTIFY, 25.0)
        ));
        // With the last line justified, the distribution tracks the slot span:
        // not a no-op when the span differs, a no-op when it matches exactly.
        let justified = |_: u32| ThreadTypography {
            first_line_indent: 0.0,
            justify: JustifyControls {
                last_line_justify: true,
                ..JustifyControls::default()
            },
        };
        let justified_equivalent = |pending: &FlowLayoutArena, committed: &FlowLayoutArena| {
            flow_positioning_equivalent(
                pending,
                committed,
                &clusters,
                &bidi,
                justified,
                justified,
                (
                    &BoundaryShapeArena::default(),
                    &BoundaryShapeArena::default(),
                ),
            )
            .unwrap()
        };
        assert!(!justified_equivalent(
            &arena(ALIGN_JUSTIFY, 17.0),
            &arena(ALIGN_JUSTIFY, 25.0)
        ));
        assert!(justified_equivalent(
            &arena(ALIGN_JUSTIFY, 17.0),
            &arena(ALIGN_JUSTIFY, 17.0)
        ));
        assert_eq!(
            retained_equivalent(
                &arena(ALIGN_JUSTIFY, 17.0),
                &arena(ALIGN_JUSTIFY, 17.0),
                justified(0),
                typography(0),
            ),
            None,
            "changed justification controls cannot reuse a prior distribution"
        );
        // An edge record is positioned from the boundary arena by index: the flows are
        // equivalent only when both name the same index and the arenas hold the same island.
        let with_edge = |slot_end: f64| {
            let mut flow = arena(ALIGN_START, slot_end);
            assert!(
                flow.fragments
                    .update(0, |fragment| {
                        fragment.lead_index = 0;
                    })
                    .unwrap()
            );
            flow
        };
        let island = |glyph: u16| {
            let mut boundary = BoundaryShapeArena::default();
            boundary.records.push(BoundaryShape {
                flow_thread_id: line.flow_thread_id,
                source_run: 0,
                cluster_start: 0,
                cluster_end: 1,
                text_end: 1,
                source_binding_handle: 1,
                source_font_handle: 1,
                ellipsis_binding_handle: 0,
                ellipsis_font_handle: 0,
                source_glyph_start: 0,
                source_glyph_count: 1,
                ellipsis_glyph_start: 0,
                ellipsis_glyph_count: 0,
                line_start: true,
            });
            boundary.shape.glyph_ids.push(glyph);
            boundary.shape.clusters.push(0);
            boundary.shape.x_advances.push(640);
            boundary.shape.y_advances.push(0);
            boundary.shape.x_offsets.push(0);
            boundary.shape.y_offsets.push(0);
            boundary.shape.glyph_flags.push(0);
            boundary.stable_ids.push(7);
            boundary
        };
        let edge_equivalent =
            |pending: &FlowLayoutArena,
             committed: &FlowLayoutArena,
             boundaries: (&BoundaryShapeArena, &BoundaryShapeArena)| {
                flow_positioning_equivalent(
                    pending, committed, &clusters, &bidi, typography, typography, boundaries,
                )
                .unwrap()
            };
        assert!(edge_equivalent(
            &with_edge(17.0),
            &with_edge(25.0),
            (&island(3), &island(3))
        ));
        assert!(
            !edge_equivalent(&with_edge(17.0), &with_edge(25.0), (&island(3), &island(4))),
            "a reshaped island must be positioned again"
        );
        assert!(
            !edge_equivalent(
                &with_edge(17.0),
                &arena(ALIGN_START, 17.0),
                (&island(3), &island(3))
            ),
            "a line that gained an edge record must be positioned again"
        );
        let mut restamped = island(3);
        restamped.stable_ids[0] = 8;
        assert!(
            !edge_equivalent(&with_edge(17.0), &with_edge(17.0), (&island(3), &restamped)),
            "an island whose glyphs took other stable ids must be published again"
        );
    }

    #[test]
    fn justification_distributes_exact_unit_totals_in_either_sign() {
        assert_eq!(distribute_units(1_408, 2), (704, 0));
        assert_eq!(distribute_units(22, 0), (0, 0));
        // Remainders spread one unit at a time and the totals stay exact.
        assert_eq!(distribute_units(641, 4), (160, 1));
        assert_eq!(160 * 4 + 1, 641);
        assert_eq!(distribute_units(-5, 2), (-3, 1));
        assert_eq!(-3 * 2 + 1, -5);
    }

    #[test]
    fn justification_totals_fill_the_deficit_exactly_including_remainders() {
        let (_text, clusters, line, mut fragment) = justify_fixture();
        // Deficit 10 + 1/65,536px = 655,361 units over 2 spaces: euclidean split gives
        // 327,680 units + one extra leading unit, and the fragment advance fills
        // the slot exactly.
        fragment.slot_end = 17.000_015_258_789_063;
        let controls = JustifyControls::default();
        let distribution =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, controls);
        assert_eq!(distribution.spaces, 2);
        assert_eq!(distribution.per_space_units, 327_680);
        assert_eq!(distribution.extra_space_units, 1);
        assert_eq!(distribution.total_units(), 655_361);
        let advance =
            positioned_fragment_advance(line, fragment, false, &clusters, 0.0, controls).unwrap();
        assert_eq!(advance, 17.000_015_258_789_063);
    }

    #[test]
    fn justified_segments_store_only_resolved_xy_displacements() {
        let (text, mut clusters, line, mut fragment) = justify_fixture();
        clusters.source_runs[4..].fill(1);
        clusters.stable_ids = (1..=7).collect();
        clusters.glyph_starts = (0..7).collect();
        clusters.glyph_counts = vec![1; 7];
        clusters.binding_handles = vec![1; 7];
        clusters.glyph_ids = vec![1; 7];
        clusters.glyph_clusters = (0..7).collect();
        clusters.glyph_x_advances = vec![1_000; 7];
        clusters.glyph_x_offsets = vec![0; 7];
        clusters.glyph_y_offsets = vec![0; 7];
        clusters.glyph_shape_flags = vec![0; 7];
        clusters.glyph_stable_ids = (1..=7).collect();
        clusters.rebuild_layout_runs().unwrap();
        let style = ResolvedStyle::test_typography(1.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 7,
            style,
        }];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 4,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 4,
                text_end: 7,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style,
            },
        ];
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: -1_000,
                x_max: 1_000,
                y_max: 0,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        fragment.slot_end = 17.000_015_258_789_063;
        let controls = JustifyControls {
            maximum_word_space_ratio: 3.0,
            letter_space_expansion: 0.75,
            ..JustifyControls::default()
        };
        let justify =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, controls);
        let mut positioned = PositionedGlyphArena::default();
        let mut cursor = 0.0;
        let mut space_ordinal = 0_i64;
        let mut gap_ordinal = 0_i64;
        for (run_index, run) in clusters.layout_runs().iter().enumerate() {
            for cluster in run.cluster_start as usize..run.cluster_end as usize {
                let placement_cluster = clusters.placement_cluster(*run, 0, cluster).unwrap();
                positioned
                    .record_layout_run_segment(
                        0,
                        run_index,
                        run,
                        cluster,
                        cluster + 1,
                        &clusters,
                        placement_cluster,
                        (false, 0),
                        cursor,
                        line.baseline,
                    )
                    .unwrap();
                cursor += clusters.advances[cluster];
                apply_justification(
                    cluster,
                    &clusters,
                    justify,
                    &mut cursor,
                    &mut space_ordinal,
                    &mut gap_ordinal,
                );
            }
        }
        assert_eq!(positioned.placement.segment_count(), 7);
        assert!(
            positioned
                .placement
                .translation(1)
                .unwrap()
                .translation_inline
                > positioned
                    .placement
                    .translation(0)
                    .unwrap()
                    .translation_inline
        );

        let exact_fragment = FlowFragment {
            slot_end: 7.0,
            ..fragment
        };
        let exact = justification_adjustment(
            line,
            exact_fragment,
            false,
            &clusters,
            0,
            7,
            0.0,
            JustifyControls::default(),
        );
        assert!(exact.is_zero());
        assert_eq!((exact.spaces, exact.gaps, exact.gap_end), (2, 6, 7));

        let mut gap_adjusted = PositionedGlyphArena::default();
        gap_adjusted
            .position_fragment(
                line,
                fragment,
                false,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &BidiAnalysis::default(),
                true,
                0.0,
                controls,
                |_| None,
            )
            .unwrap();
        assert_eq!(gap_adjusted.outlined_count(), 7);
        assert_eq!(gap_adjusted.placement.segment_count(), 7);

        let mut word_only = PositionedGlyphArena::default();
        word_only
            .position_fragment(
                line,
                FlowFragment {
                    slot_end: 17.0,
                    ..fragment
                },
                false,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &BidiAnalysis::default(),
                true,
                0.0,
                JustifyControls::default(),
                |_| None,
            )
            .unwrap();
        assert_eq!(word_only.outlined_count(), 7);
        assert_eq!(word_only.placement.segment_count(), 4);
        assert_eq!(core::mem::size_of::<SegmentTranslation>(), 16);
    }

    fn justify_fixture() -> (Vec<u16>, ClusterArena, FlowLine, FlowFragment) {
        // "ab cd f" — seven 1.0-advance clusters with spaces at 2 and 5.
        let text: Vec<u16> = "ab cd f".encode_utf16().collect();
        let mut flags = vec![0_u8; 7];
        flags[2] = CLUSTER_SPACE;
        flags[5] = CLUSTER_SPACE;
        let clusters = ClusterArena {
            starts: (0..7).collect(),
            ends: (1..=7).collect(),
            advances: vec![1.0; 7],
            advance_units: vec![65_536; 7],
            units_per_em: vec![1_000.0; 7],
            flags,
            style_indexes: vec![0; 7],
            source_runs: vec![0; 7],
            font_handles: vec![1; 7],
            index_at: (0..=7).collect(),
            ..ClusterArena::default()
        };
        let line = FlowLine {
            typography: Default::default(),
            flow_thread_id: 1,
            region_id: 1,
            transform_index: 1,
            clip_id: 0,
            fragment_count: 1,
            align: ALIGN_JUSTIFY,
            block_start: 0.0,
            baseline: 4.0,
            height: 5.0,
        };
        let fragment = FlowFragment {
            line: ComposedLine {
                cluster_start: 0,
                cluster_end: 7,
                text_start: 0,
                text_end: 7,
                advance: 7.0,
                hung_advance: 0.0,
                hard_break: false,
                start_correction: Correction::ZERO,
                end_correction: Correction::ZERO,
            },
            slot_start: 0.0,
            slot_end: 17.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
            lead_index: NO_BOUNDARY,
            tail_index: NO_BOUNDARY,
        };
        (text, clusters, line, fragment)
    }

    #[test]
    fn word_space_caps_spill_into_bounded_letter_expansion() {
        let (_text, clusters, line, fragment) = justify_fixture();
        // Deficit 10 over 2 spaces (natural sum 2.0): a 3x cap allows 4.0 of
        // word-space growth; 6.0 spills into six inter-cluster gaps bounded to
        // 0.75 each; the final 1.5 stays unfilled.
        let controls = JustifyControls {
            minimum_word_space_ratio: 0.0,
            maximum_word_space_ratio: 3.0,
            letter_space_expansion: 0.75,
            last_line_justify: false,
        };
        let distribution =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, controls);
        assert_eq!(distribution.spaces, 2);
        assert_eq!(distribution.per_space_units, 131_072);
        assert_eq!(distribution.extra_space_units, 0);
        assert_eq!(distribution.gaps, 6);
        assert_eq!(distribution.per_gap_units, 49_152);
        assert_eq!(distribution.extra_gap_units, 0);

        // Unbounded controls reproduce the pre-tier distribution exactly.
        let unbounded = JustifyControls::default();
        let plain =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, unbounded);
        assert_eq!(plain.per_space_units, 327_680);
        assert_eq!(plain.per_gap_units, 0);
    }

    #[test]
    fn last_line_codec_justifies_final_and_hard_broken_lines() {
        let (_text, clusters, line, fragment) = justify_fixture();
        let auto = JustifyControls::default();
        let final_auto = justification_adjustment(line, fragment, true, &clusters, 0, 7, 0.0, auto);
        assert_eq!(final_auto.per_space_units, 0);
        let codec = JustifyControls {
            last_line_justify: true,
            ..JustifyControls::default()
        };
        let final_justified =
            justification_adjustment(line, fragment, true, &clusters, 0, 7, 0.0, codec);
        assert_eq!(final_justified.per_space_units, 327_680);
    }

    #[test]
    fn word_spaces_shrink_only_to_the_declared_minimum() {
        let (_text, clusters, line, mut fragment) = justify_fixture();
        // Overfull by 1.0: a 0.75 minimum permits 0.25 shrink per space (0.5
        // total), so shrink clamps at -0.25 and the line stays 0.5 overfull.
        fragment.slot_end = 6.0;
        let controls = JustifyControls {
            minimum_word_space_ratio: 0.75,
            maximum_word_space_ratio: 0.0,
            letter_space_expansion: 0.0,
            last_line_justify: false,
        };
        let shrunk =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, controls);
        assert_eq!(shrunk.per_space_units, -16_384);
        assert_eq!(shrunk.extra_space_units, 0);
        assert_eq!(shrunk.per_gap_units, 0);
        // Without a declared minimum an overfull line never shrinks.
        let rigid = justification_adjustment(
            line,
            fragment,
            false,
            &clusters,
            0,
            7,
            0.0,
            JustifyControls::default(),
        );
        assert_eq!(rigid.per_space_units, 0);
    }

    /// CSS decorating box: a nested font-size change inside one declared decoration
    /// keeps a single continuous line at the declaring span's geometry.
    #[test]
    fn nested_size_changes_keep_one_continuous_decoration_line() {
        let text = vec![0x61, 0x62, 0x0a];
        let mut declaring = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        declaring.decoration_flags = crate::engine::frame::DECORATION_UNDERLINE;
        declaring.decoration_rgba = 0xff00_00ff;
        declaring.decoration_font_size = 10.0;
        let mut nested = declaring;
        nested.font_size = 7.0;
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style: declaring,
            },
            StyleSegment {
                text_start: 1,
                text_end: 3,
                style: nested,
            },
        ];
        let runs = [
            ShapingRun {
                text_start: 0,
                text_end: 1,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style: declaring,
            },
            ShapingRun {
                text_start: 1,
                text_end: 2,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 0,
                bidi_level: 0,
                style: nested,
            },
        ];
        let mut clusters = ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![6.0, 4.2, 0.0],
            units_per_em: vec![1_000.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE, CLUSTER_HARD_BREAK],
            style_indexes: vec![0, 1, 0],
            source_runs: vec![0, 1, u32::MAX],
            binding_handles: vec![11, 11, 0],
            font_handles: vec![1, 1, 0],
            stable_ids: vec![10, 20, 30],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 0],
            glyph_ids: vec![1, 2],
            glyph_clusters: vec![0, 1],
            glyph_x_advances: vec![500, 500],
            glyph_x_offsets: vec![0, 0],
            glyph_y_offsets: vec![0, 0],
            glyph_shape_flags: vec![0, 0],
            glyph_stable_ids: vec![100, 200],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
        clusters.rebuild_layout_runs().unwrap();
        let bidi = BidiAnalysis {
            levels: vec![0, 0, BIDI_B],
            classes: vec![0, 0, BIDI_B],
            paragraph_starts: vec![0],
            paragraph_ends: vec![3],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_count: 1,
                align: ALIGN_CENTER,
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
                    text_end: 2,
                    advance: 10.2,
                    hung_advance: 0.0,
                    hard_break: true,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

        assert_eq!(active.decorations.len(), 1);
        let underline = active.decorations[0];
        // One line spans both clusters: centered 10.2 advance in the 20.0 slot.
        assert_eq!(underline.inline_start, 4.9);
        assert_eq!(underline.inline_extent, 10.2);
        // Geometry from the declaring 10.0 size, not the nested 7.0: 8.0 + 100 * 0.01.
        assert_eq!(underline.block_start, 9.0);
        assert_eq!(underline.block_extent, 0.5);
    }

    /// A retained line's decoration records name glyphs by layout index, so a copy made after
    /// the glyphs before the line changed in number moves both ends by that much and nothing
    /// else. No edit reaches this today (a decorated paragraph repositions every line after an
    /// edit before it); the copy must not go stale when retention widens.
    #[test]
    fn retained_decorations_follow_the_glyphs_laid_out_before_their_line() {
        let record = DecorationRecord {
            flags: crate::engine::frame::DECORATION_UNDERLINE,
            style: 0,
            color: 0xff00_00ff,
            material_id: 3,
            inline_start: 4.0,
            inline_extent: 12.0,
            block_start: 9.0,
            block_extent: 0.5,
            baseline: 8.0,
            glyph_start: 16,
            glyph_end: 19,
            clip_id: 1,
            region_id: 2,
            flow_thread_id: 3,
            transform_index: 4,
        };
        let mut arena = PositionedGlyphArena::default();
        arena.extend_retained_decorations(&[record], 0).unwrap();
        // One glyph more before the line, then six fewer.
        arena.extend_retained_decorations(&[record], 1).unwrap();
        arena
            .extend_retained_decorations(&[record], 6_u32.wrapping_neg())
            .unwrap();
        assert_eq!(
            arena.decorations,
            [
                record,
                DecorationRecord {
                    glyph_start: 17,
                    glyph_end: 20,
                    ..record
                },
                DecorationRecord {
                    glyph_start: 10,
                    glyph_end: 13,
                    ..record
                },
            ]
        );
    }

    /// Decoration slice: a styled run with underline and line-through flags emits
    /// decoration records with geometry from the registered font's decoration metrics
    /// (fixture: underline -100/50, strikeout 300/50 at 1000 upem, font size 10).
    #[test]
    fn decorated_runs_emit_underline_and_line_through_records() {
        // This fixture positions against an empty boundary source throughout.
        let boundary = BoundaryShapeArena::default();
        let text = vec![0x61, 0x62, 0x0a];
        let mut style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        style.decoration_flags = crate::engine::frame::DECORATION_UNDERLINE
            | crate::engine::frame::DECORATION_LINE_THROUGH;
        style.decoration_rgba = 0xff00_00ff;
        style.material_id = 17;
        style.outline_width = 1.0;
        style.shadow_offset_x = 0.5;
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style,
        }];
        let mut clusters = ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![6.0, 6.0, 0.0],
            units_per_em: vec![1_000.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE, CLUSTER_HARD_BREAK],
            style_indexes: vec![0, 0, 0],
            source_runs: vec![0, 0, u32::MAX],
            binding_handles: vec![11, 11, 0],
            font_handles: vec![1, 1, 0],
            stable_ids: vec![10, 20, 30],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 0],
            glyph_ids: vec![1, 2],
            glyph_clusters: vec![0, 1],
            glyph_x_advances: vec![500, 500],
            glyph_x_offsets: vec![0, 0],
            glyph_y_offsets: vec![0, 0],
            glyph_shape_flags: vec![0, 0],
            glyph_stable_ids: vec![100, 200],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
        clusters.rebuild_layout_runs().unwrap();
        let bidi = BidiAnalysis {
            levels: vec![0, 0, BIDI_B],
            classes: vec![0, 0, BIDI_B],
            paragraph_starts: vec![0],
            paragraph_ends: vec![3],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_count: 1,
                align: ALIGN_CENTER,
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
                    text_end: 2,
                    advance: 12.0,
                    hung_advance: 0.0,
                    hard_break: true,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

        assert_layout_plan_producer_invariants(
            &active,
            &clusters,
            &boundary,
            PositionedSourceContext {
                styles: &styles,
                clusters: &clusters,
            },
        );
        for index in 0..active.outlined_count() {
            let row = projected_row_at(
                &active,
                index,
                PositionedSourceContext {
                    styles: &styles,
                    clusters: &clusters,
                },
                &boundary,
            );
            assert_eq!(row.f32(6), Some(0.1));
            assert_eq!(row.f32(7), Some(0.05));
            assert_eq!(row.f32(8), Some(0.0));
        }
        assert_eq!(active.decorations.len(), 2);
        let underline = active.decorations[0];
        // Centered 12.0 advance in the 20.0 slot: run spans 4.0..16.0.
        assert_eq!(underline.flags, crate::engine::frame::DECORATION_UNDERLINE);
        assert_eq!(underline.inline_start, 4.0);
        assert_eq!(underline.inline_extent, 12.0);
        // post underline position -100 at scale 0.01 in down-positive space: 8.0 + 1.0.
        assert_eq!(underline.block_start, 9.0);
        assert_eq!(underline.block_extent, 0.5);
        // Both glyphs of the run, on the line's baseline.
        assert_eq!((underline.glyph_start, underline.glyph_end), (0, 1));
        assert_eq!(underline.baseline, 8.0);
        assert_eq!(underline.color, 0xff00_00ff);
        assert_eq!(underline.material_id, 17);
        assert_eq!(underline.clip_id, 9);
        assert_eq!(underline.region_id, 9);
        assert_eq!(underline.flow_thread_id, 7);
        assert_eq!(underline.transform_index, 9);
        let line_through = active.decorations[1];
        assert_eq!(
            line_through.flags,
            crate::engine::frame::DECORATION_LINE_THROUGH
        );
        // OS/2 strikeout position 300 above the baseline: 8.0 - 3.0.
        assert_eq!(line_through.block_start, 5.0);
        assert_eq!(line_through.block_extent, 0.5);
        let expected_decorations = active.decorations.clone();
        let mut retained = PositionedGlyphArena::default();
        retained
            .build(
                &active,
                &flow,
                Some(&flow),
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(
            retained.decorations, expected_decorations,
            "a retained positioned line keeps every decoration record",
        );
        // Undecorated rebuilds emit none.
        let mut plain = PositionedGlyphArena::default();
        let plain_styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style: ResolvedStyle::test_typography(10.0, 0.0, 0.0),
        }];
        plain
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &plain_styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert!(!plain.text_effects);
        for index in 0..plain.outlined_count() {
            let row = projected_row_at(
                &plain,
                index,
                PositionedSourceContext {
                    styles: &plain_styles,
                    clusters: &clusters,
                },
                &boundary,
            );
            assert!(
                (SEMANTIC_F32_BASE_FIELD_COUNT..SEMANTIC_F32_FIELD_COUNT)
                    .all(|field| row.f32(field) == Some(0.0))
            );
        }
        assert_eq!(plain.decorations.len(), 0);
    }

    /// An ellipsis island longer than one numeric block: the run-local arena cuts a run every
    /// 64 glyphs, and each block has its own anchor and a prefix that restarts at zero. Seventy
    /// glyphs pitched 6.0 (advance 5.0, letter spacing 1.0) from a pen at 0.0 sit at 0, 6, … 414
    /// and the marker at 420; the six glyphs of the second block are the ones a single
    /// translation drew back at the pen origin.
    #[test]
    fn an_island_longer_than_one_numeric_block_is_drawn_at_its_pen() {
        const ISLAND: u32 = 70;
        let count = ISLAND as usize;
        let text = vec![0x61; count];
        let style = ResolvedStyle::test_typography(10.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: ISLAND,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: ISLAND,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style,
        }];
        let mut clusters = ClusterArena {
            starts: (0..ISLAND).collect(),
            ends: (1..=ISLAND).collect(),
            advances: vec![6.0; count],
            units_per_em: vec![1_000.0; count],
            flags: vec![CLUSTER_SAFE_BEFORE; count],
            style_indexes: vec![0; count],
            source_runs: vec![0; count],
            binding_handles: vec![11; count],
            font_handles: vec![1; count],
            stable_ids: (1..=ISLAND).collect(),
            glyph_starts: (0..ISLAND).collect(),
            glyph_counts: vec![1; count],
            glyph_ids: vec![1; count],
            glyph_clusters: (0..ISLAND).collect(),
            glyph_x_advances: vec![500; count],
            glyph_x_offsets: vec![0; count],
            glyph_y_offsets: vec![0; count],
            glyph_shape_flags: vec![0; count],
            glyph_stable_ids: (1_001..=1_000 + ISLAND).collect(),
            index_at: (0..=ISLAND).collect(),
            ..ClusterArena::default()
        };
        clusters.rebuild_layout_runs().unwrap();
        let bidi = BidiAnalysis {
            levels: vec![0; count],
            classes: vec![0; count],
            paragraph_starts: vec![0],
            paragraph_ends: vec![ISLAND],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        // The island is the whole line reshaped, then one marker glyph of advance 3.0.
        let boundary = BoundaryShapeArena {
            records: vec![BoundaryShape {
                flow_thread_id: 7,
                source_run: 0,
                cluster_start: 0,
                cluster_end: ISLAND,
                text_end: ISLAND,
                source_binding_handle: 11,
                source_font_handle: 1,
                ellipsis_binding_handle: 11,
                ellipsis_font_handle: 1,
                source_glyph_start: 0,
                source_glyph_count: ISLAND,
                ellipsis_glyph_start: ISLAND,
                ellipsis_glyph_count: 1,
                line_start: false,
            }],
            shape: ShapeArena {
                runs: vec![],
                glyph_ids: [vec![1; count], vec![45]].concat(),
                clusters: (0..ISLAND).chain([ISLAND]).collect(),
                x_advances: [vec![500; count], vec![300]].concat(),
                y_advances: vec![0; count + 1],
                x_offsets: vec![0; count + 1],
                y_offsets: vec![0; count + 1],
                glyph_flags: vec![0; count + 1],
                beyond_pairs: Vec::new(),
            },
            stable_ids: (2_001..=2_001 + ISLAND).collect(),
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
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
                    cluster_end: ISLAND,
                    text_start: 0,
                    text_end: ISLAND,
                    advance: 423.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 500.0,
                flexible_end: false,
                boundary_index: 0,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &boundary,
                &boundary,
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

        // The premise: the island's run spans two blocks, 64 glyphs and 6.
        assert_eq!(active.replacement_runs[0].numeric_blocks.count, 2);
        let blocks = active.replacement_run_local().blocks();
        assert_eq!(
            blocks
                .iter()
                .map(|block| block.source_glyph_count)
                .collect::<Vec<_>>(),
            [64, 6, 1]
        );
        assert_eq!(active.replacement_run_local().cluster_prefixes()[64], 0.0);

        assert_eq!(active.outlined_count(), count + 1);
        for glyph in 0..count {
            let placed = placed_semantic_at(&active, glyph, &clusters, &boundary);
            assert_eq!(placed.inline_origin, 6.0 * glyph as f32, "glyph {glyph}");
            assert_eq!(placed.block_origin, 8.0, "glyph {glyph}");
            assert_eq!(
                semantic_row_at(&active, glyph, &clusters, &boundary).stable_id,
                2_001 + glyph as u32
            );
        }
        assert_eq!(
            placed_semantic_at(&active, count, &clusters, &boundary).inline_origin,
            420.0
        );
        // One placed segment per block, each owning exactly its block's clusters and glyphs.
        let segments: Vec<_> = active
            .placement
            .segment_rows()
            .iter()
            .map(|segment| {
                (
                    segment.numeric_block_ordinal,
                    segment.run_cluster_start,
                    segment.run_cluster_count,
                    segment.source_glyph_start,
                    segment.source_glyph_count,
                )
            })
            .collect();
        assert_eq!(
            segments,
            [(0, 0, 64, 0, 64), (1, 64, 6, 64, 6), (0, 0, 1, 0, 1)]
        );
    }

    /// One line of one-unit clusters, each a glyph of advance 5.0, cut for an ellipsis of
    /// advance 3.0 in a slot 40.0 wide: clusters `..retained` stay the paragraph's,
    /// `retained..island_end` are the island and the rest is truncated. `runs` are
    /// `(text_end, bidi level)` in text order. Returns `(glyph id, inline origin)` in drawing
    /// order: a paragraph glyph's id is 100 + its cluster, an island glyph's 200 + its cluster,
    /// the marker's 45.
    fn cut_line_rows(
        text: &str,
        run_ends: &[(u32, u8)],
        paragraph_level: u8,
        (retained, island_end): (u32, u32),
    ) -> Vec<(u32, f32)> {
        let text = text.encode_utf16().collect::<Vec<_>>();
        let length = u32::try_from(text.len()).unwrap();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: length,
            style,
        }];
        let mut runs = Vec::new();
        let mut shaped_runs = Vec::new();
        let mut shaped_clusters = Vec::new();
        let mut levels = Vec::new();
        let mut text_start = 0;
        for (index, (text_end, level)) in run_ends.iter().copied().enumerate() {
            runs.push(ShapingRun {
                text_start,
                text_end,
                script: u32::from_be_bytes(*b"Zyyy"),
                direction: level & 1,
                bidi_level: level,
                style,
            });
            shaped_runs.push(ShapedRun {
                source_run: u32::try_from(index).unwrap(),
                binding_handle: 11,
                font_handle: 1,
                text_start,
                text_end,
                glyph_start: text_start,
                glyph_count: text_end - text_start,
            });
            // A shaper emits a right-to-left run's glyphs in visual order.
            if level & 1 == 0 {
                shaped_clusters.extend(text_start..text_end);
            } else {
                shaped_clusters.extend((text_start..text_end).rev());
            }
            levels.extend((text_start..text_end).map(|_| level));
            text_start = text_end;
        }
        assert_eq!(text_start, length);
        let count = text.len();
        let shape = ShapeArena {
            runs: shaped_runs,
            glyph_ids: shaped_clusters
                .iter()
                .map(|cluster| 100 + *cluster as u16)
                .collect(),
            clusters: shaped_clusters,
            x_advances: vec![500; count],
            y_advances: vec![0; count],
            x_offsets: vec![0; count],
            y_offsets: vec![0; count],
            glyph_flags: vec![0; count],
            beyond_pairs: Vec::new(),
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &(1..=length).collect::<Vec<_>>(),
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(clusters.starts, (0..length).collect::<Vec<_>>());
        clusters.glyph_stable_ids = (1..=length).collect();
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let bidi = BidiAnalysis {
            levels,
            classes: vec![0; count],
            paragraph_starts: vec![0],
            paragraph_ends: vec![length],
            paragraph_levels: vec![paragraph_level],
            runs: vec![],
        };
        let source_run = runs
            .iter()
            .position(|run| run.text_start <= retained && retained < run.text_end)
            .unwrap();
        let island: Vec<u32> = if runs[source_run].direction & 1 == 0 {
            (retained..island_end).collect()
        } else {
            (retained..island_end).rev().collect()
        };
        let island_count = u32::try_from(island.len()).unwrap();
        let glyphs = island.len() + 1;
        let boundary = BoundaryShapeArena {
            records: vec![BoundaryShape {
                flow_thread_id: 7,
                source_run: u32::try_from(source_run).unwrap(),
                cluster_start: retained,
                cluster_end: island_end,
                text_end: island_end,
                source_binding_handle: 11,
                source_font_handle: 1,
                ellipsis_binding_handle: 11,
                ellipsis_font_handle: 1,
                source_glyph_start: 0,
                source_glyph_count: island_count,
                ellipsis_glyph_start: island_count,
                ellipsis_glyph_count: 1,
                line_start: false,
            }],
            shape: ShapeArena {
                runs: vec![],
                glyph_ids: island
                    .iter()
                    .map(|cluster| 200 + *cluster as u16)
                    .chain([45])
                    .collect(),
                clusters: island.iter().copied().chain([island_end]).collect(),
                x_advances: [vec![500; island.len()], vec![300]].concat(),
                y_advances: vec![0; glyphs],
                x_offsets: vec![0; glyphs],
                y_offsets: vec![0; glyphs],
                glyph_flags: vec![0; glyphs],
                beyond_pairs: Vec::new(),
            },
            stable_ids: (2_001..=2_000 + u32::try_from(glyphs).unwrap()).collect(),
        };
        let flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
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
                    cluster_end: island_end,
                    text_start: 0,
                    text_end: island_end,
                    advance: 5.0 * f64::from(island_end) + 3.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 40.0,
                flexible_end: false,
                boundary_index: 0,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &boundary,
                &boundary,
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        (0..active.outlined_count())
            .map(|row| {
                (
                    u32::from(semantic_row_at(&active, row, &clusters, &boundary).glyph_id),
                    placed_semantic_at(&active, row, &clusters, &boundary).inline_origin,
                )
            })
            .collect()
    }

    /// The marker ends the line at the paragraph's level, so it is drawn at the line's end
    /// edge: the left of a right-to-left line. The island is the last text before it, so it
    /// is the next thing to its right, and the line's first cluster stays at the right edge.
    /// Four clusters and the marker are 23.0 wide and start-aligned to the right of the
    /// 40.0 slot, so the line begins at 17.0.
    #[test]
    fn a_right_to_left_line_draws_its_ellipsis_at_the_left_edge() {
        assert_eq!(
            cut_line_rows(
                "\u{5d0}\u{5d1}\u{5d2}\u{5d3}\u{5d4}\u{5d5}",
                &[(6, 1)],
                1,
                (2, 4)
            ),
            [
                (45, 17.0),
                (203, 20.0),
                (202, 25.0),
                (101, 30.0),
                (100, 35.0)
            ]
        );
        // The whole line is the island.
        assert_eq!(
            cut_line_rows(
                "\u{5d0}\u{5d1}\u{5d2}\u{5d3}\u{5d4}\u{5d5}",
                &[(6, 1)],
                1,
                (0, 4)
            ),
            [
                (45, 17.0),
                (203, 20.0),
                (202, 25.0),
                (201, 30.0),
                (200, 35.0)
            ]
        );
    }

    /// The base direction decides the marker's side, not the direction of the text it follows.
    #[test]
    fn the_ellipsis_side_follows_the_paragraph_direction_in_mixed_text() {
        // A left-to-right paragraph cut inside a right-to-left word: the marker ends the line
        // on the right, and the island, the word's last retained letters, is the leftmost
        // part of that word.
        assert_eq!(
            cut_line_rows(
                "ab\u{5d0}\u{5d1}\u{5d2}\u{5d3}",
                &[(2, 0), (6, 1)],
                0,
                (3, 4)
            ),
            [(100, 0.0), (101, 5.0), (203, 10.0), (102, 15.0), (45, 20.0)]
        );
        // A right-to-left paragraph cut inside a left-to-right word: the marker is at the
        // left edge, and the island continues that word rightwards. Six clusters and the
        // marker are 33.0 wide, so the line begins at 7.0.
        assert_eq!(
            cut_line_rows(
                "\u{5d0}\u{5d1}abcd\u{5d2}",
                &[(2, 1), (6, 2), (7, 1)],
                1,
                (4, 6)
            ),
            [
                (45, 7.0),
                (102, 10.0),
                (103, 15.0),
                (204, 20.0),
                (205, 25.0),
                (101, 30.0),
                (100, 35.0)
            ]
        );
        // A right-to-left paragraph of left-to-right text only: every cluster is at an even
        // level, the marker still ends the line on the left.
        assert_eq!(
            cut_line_rows("abcdef", &[(6, 2)], 1, (2, 4)),
            [
                (45, 17.0),
                (100, 20.0),
                (101, 25.0),
                (202, 30.0),
                (203, 35.0)
            ]
        );
        // And a left-to-right line is unchanged: clusters, island, marker.
        assert_eq!(
            cut_line_rows("abcdef", &[(6, 0)], 0, (2, 4)),
            [(100, 0.0), (101, 5.0), (202, 10.0), (203, 15.0), (45, 20.0)]
        );
    }

    /// Roadmap 11.13: the contract must represent a break-inserted hyphen glyph that has
    /// no source cluster. The proof drives a NON-final soft-wrapped fragment through a
    /// boundary record whose source span is empty and whose inserted span is one shaped
    /// hyphen: the hyphen positions at the line end with its own glyph identity from the
    /// boundary arena, cluster-level semantics anchored to the boundary neighbor, and the
    /// following line is unaffected. Nothing in the path is ellipsis-specific.
    #[test]
    fn break_inserted_hyphen_glyph_positions_without_a_source_cluster() {
        let text = vec![0x61, 0x62, 0x63, 0x64];
        let style = ResolvedStyle::test_typography(10.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style,
        }];
        let mut clusters = ClusterArena {
            starts: vec![0, 1, 2, 3],
            ends: vec![1, 2, 3, 4],
            advances: vec![6.0, 6.0, 6.0, 6.0],
            units_per_em: vec![1_000.0; 4],
            flags: vec![
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE,
                CLUSTER_SAFE_BEFORE,
            ],
            style_indexes: vec![0, 0, 0, 0],
            source_runs: vec![0, 0, 0, 0],
            binding_handles: vec![11, 11, 11, 11],
            font_handles: vec![1, 1, 1, 1],
            stable_ids: vec![10, 20, 30, 40],
            glyph_starts: vec![0, 1, 2, 3],
            glyph_counts: vec![1, 1, 1, 1],
            glyph_ids: vec![1, 2, 3, 4],
            glyph_clusters: vec![0, 1, 2, 3],
            glyph_x_advances: vec![500, 500, 500, 500],
            glyph_x_offsets: vec![0, 0, 0, 0],
            glyph_y_offsets: vec![0, 0, 0, 0],
            glyph_shape_flags: vec![0, 0, 0, 0],
            glyph_stable_ids: vec![100, 200, 300, 400],
            index_at: vec![0, 1, 2, 3, 4],
            ..ClusterArena::default()
        };
        clusters.rebuild_layout_runs().unwrap();
        let bidi = BidiAnalysis {
            levels: vec![0, 0, 0, 0],
            classes: vec![0, 0, 0, 0],
            paragraph_starts: vec![0],
            paragraph_ends: vec![4],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        let boundary = BoundaryShapeArena {
            records: vec![BoundaryShape {
                flow_thread_id: 7,
                source_run: 0,
                cluster_start: 2,
                cluster_end: 2,
                text_end: 2,
                source_binding_handle: 11,
                source_font_handle: 1,
                ellipsis_binding_handle: 11,
                ellipsis_font_handle: 1,
                source_glyph_start: 0,
                source_glyph_count: 0,
                ellipsis_glyph_start: 0,
                ellipsis_glyph_count: 1,
                line_start: false,
            }],
            shape: ShapeArena {
                runs: vec![],
                glyph_ids: vec![45],
                clusters: vec![2],
                x_advances: vec![300],
                y_advances: vec![0],
                x_offsets: vec![0],
                y_offsets: vec![0],
                glyph_flags: vec![0],
                beyond_pairs: Vec::new(),
            },
            stable_ids: vec![777],
        };
        let lines = [
            FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            },
            FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 10.0,
                baseline: 8.0,
                height: 10.0,
            },
        ];
        let flow = FlowLayoutArena {
            lines: lines.to_vec().into(),
            fragments: vec![
                FlowFragment {
                    line: ComposedLine {
                        cluster_start: 0,
                        cluster_end: 2,
                        text_start: 0,
                        text_end: 2,
                        advance: 15.0,
                        hung_advance: 0.0,
                        hard_break: false,
                        start_correction: Correction::ZERO,
                        end_correction: Correction::ZERO,
                    },
                    slot_start: 0.0,
                    slot_end: 20.0,
                    flexible_end: false,
                    boundary_index: 0,
                    lead_index: NO_BOUNDARY,
                    tail_index: NO_BOUNDARY,
                },
                FlowFragment {
                    line: ComposedLine {
                        cluster_start: 2,
                        cluster_end: 4,
                        text_start: 2,
                        text_end: 4,
                        advance: 12.0,
                        hung_advance: 0.0,
                        hard_break: false,
                        start_correction: Correction::ZERO,
                        end_correction: Correction::ZERO,
                    },
                    slot_start: 0.0,
                    slot_end: 20.0,
                    flexible_end: false,
                    boundary_index: NO_BOUNDARY,
                    lead_index: NO_BOUNDARY,
                    tail_index: NO_BOUNDARY,
                },
            ]
            .into(),
            ..FlowLayoutArena::default()
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &boundary,
                &boundary,
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

        assert_eq!(active.replacement_runs.len(), 1);
        assert_eq!(active.replacement_runs[0].numeric_blocks.count, 1);
        assert_eq!(active.replacement_run_local().blocks().len(), 1);
        assert_eq!(active.replacement_run_local().rows().len(), 1);
        assert_eq!(active.replacement_run_local().rows()[0].source_glyph, 0);
        assert_eq!(active.replacement_run_local().cluster_blocks(), [0]);
        assert_eq!(active.replacement_run_local().cluster_prefixes(), [0.0]);

        assert_eq!(active.outlined_count(), 5);
        // Line one centers its 15.0 advance (12.0 retained + 3.0 hyphen) in the 20.0 slot.
        assert_eq!(
            placed_semantic_at(&active, 0, &clusters, &boundary).inline_origin,
            2.5
        );
        assert_eq!(
            placed_semantic_at(&active, 1, &clusters, &boundary).inline_origin,
            8.5
        );
        // The inserted hyphen follows the retained clusters with its own glyph identity.
        assert_eq!(
            semantic_row_at(&active, 2, &clusters, &boundary).glyph_id,
            45
        );
        assert_eq!(
            semantic_row_at(&active, 2, &clusters, &boundary).stable_id,
            777
        );
        assert_eq!(
            placed_semantic_at(&active, 2, &clusters, &boundary).inline_origin,
            14.5
        );
        assert_eq!(
            placed_semantic_at(&active, 2, &clusters, &boundary).block_origin,
            8.0
        );
        // The inserted glyph has no source cluster: its published cluster is the boundary
        // text position itself, while style and paint anchor to the neighbor cluster.
        assert_eq!(semantic_row_at(&active, 2, &clusters, &boundary).cluster, 2);
        // The following line is unaffected by the inserted glyph.
        assert_eq!(
            placed_semantic_at(&active, 3, &clusters, &boundary).inline_origin,
            4.0
        );
        assert_eq!(
            placed_semantic_at(&active, 4, &clusters, &boundary).inline_origin,
            10.0
        );
        assert_eq!(
            placed_semantic_at(&active, 3, &clusters, &boundary).block_origin,
            18.0
        );

        let ellipsis_only_flow = FlowLayoutArena {
            lines: vec![FlowLine {
                fragment_count: 1,
                ..lines[0]
            }]
            .into(),
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 2,
                    cluster_end: 2,
                    text_start: 2,
                    text_end: 2,
                    advance: 3.0,
                    hung_advance: 0.0,
                    hard_break: false,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: 0,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
        };
        let mut ellipsis_only = PositionedGlyphArena::default();
        let mut ellipsis_index = IdentityIndex::default();
        let mut ellipsis_revision = 1;
        let mut ellipsis_run_revision = 1;
        ellipsis_only
            .build(
                &PositionedGlyphArena::default(),
                &ellipsis_only_flow,
                None,
                ellipsis_only_flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &boundary,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut ellipsis_index,
                &mut ellipsis_revision,
                &mut ellipsis_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(ellipsis_only.outlined_count(), 1);
        assert_eq!(
            semantic_row_at(&ellipsis_only, 0, &clusters, &boundary).stable_id,
            777
        );

        active.mark_published();
        let mut second_line_lines = flow.lines.iter().copied().collect::<Vec<_>>();
        second_line_lines[1].baseline += 1.0;
        let retained = FlowLayoutArena {
            lines: second_line_lines.into(),
            fragments: flow.fragments.clone(),
            recomposed_lines: core::iter::once(1..2).collect(),
            recomposed_lines_retained: true,
            ..FlowLayoutArena::default()
        };
        let mut next = PositionedGlyphArena::default();
        next.build(
            &active,
            &retained,
            Some(&flow),
            retained.recomposed_line_ranges(),
            &text,
            &clusters,
            &clusters,
            &runs,
            &runs,
            &boundary,
            &boundary,
            &styles,
            &bidi,
            &mut index,
            &mut next_revision,
            &mut next_run_revision,
            |_| ThreadTypography::default(),
            |_| ThreadTypography::default(),
            metrics,
            extents,
        )
        .unwrap();
        next.placement
            .validate_occurrences(next.outlined_count())
            .unwrap();
        assert_eq!(
            placed_semantic_at(&next, 0, &clusters, &boundary).block_origin,
            placed_semantic_at(&active, 0, &clusters, &boundary).block_origin,
        );
        assert_eq!(
            placed_semantic_at(&next, 3, &clusters, &boundary).block_origin,
            placed_semantic_at(&active, 3, &clusters, &boundary).block_origin + 1.0,
        );
        assert_eq!(
            next.unpublished_source_intervals(false),
            Some(core::slice::from_ref(&(3..5)))
        );
        // The clean first line contains the inserted boundary glyph. Its retained
        // span must still project the replacement source and explicit text-end cluster.
        assert!(next.occurrence_spans.iter().any(|span| {
            span.source == GlyphSource::Boundary
                && span.cluster_override == Some(2)
                && span.line == SourceLine::Body(0)
        }));

        let mut first_line_lines = retained.lines.iter().copied().collect::<Vec<_>>();
        first_line_lines[0].baseline += 2.0;
        let first_line_edit = FlowLayoutArena {
            lines: first_line_lines.into(),
            fragments: flow.fragments.clone(),
            recomposed_lines: core::iter::once(0..1).collect(),
            recomposed_lines_retained: true,
            ..FlowLayoutArena::default()
        };
        let mut newest = PositionedGlyphArena::default();
        newest
            .build(
                &next,
                &first_line_edit,
                Some(&retained),
                first_line_edit.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &boundary,
                &boundary,
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(
            placed_semantic_at(&newest, 0, &clusters, &boundary).block_origin,
            placed_semantic_at(&next, 0, &clusters, &boundary).block_origin + 2.0,
        );
        assert_eq!(
            placed_semantic_at(&newest, 3, &clusters, &boundary).block_origin,
            placed_semantic_at(&next, 3, &clusters, &boundary).block_origin,
        );
        assert_eq!(
            newest.unpublished_source_intervals(false),
            Some(core::slice::from_ref(&(0..5)))
        );
        newest.mark_published();
        assert_eq!(newest.unpublished_source_intervals(false), Some(&[][..]));
    }

    #[test]
    fn positioned_metadata_and_placement_match_literal_values_across_rebuilds() {
        let text = vec![0x61, 0x62, 0x0a];
        let style = ResolvedStyle::test_typography(10.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 3,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style,
        }];
        let mut clusters = ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![6.0, 6.0, 0.0],
            units_per_em: vec![1_000.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE, CLUSTER_HARD_BREAK],
            style_indexes: vec![0, 0, 0],
            source_runs: vec![0, 0, u32::MAX],
            binding_handles: vec![11, 11, 0],
            font_handles: vec![1, 1, 0],
            stable_ids: vec![10, 20, 30],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 0],
            glyph_ids: vec![1, 2],
            glyph_clusters: vec![0, 1],
            glyph_x_advances: vec![500, 500],
            glyph_x_offsets: vec![0, 0],
            glyph_y_offsets: vec![0, 0],
            glyph_shape_flags: vec![0, 0],
            glyph_stable_ids: vec![100, 200],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
        clusters.rebuild_layout_runs().unwrap();
        let bidi = BidiAnalysis {
            levels: vec![0, 0, BIDI_B],
            classes: vec![0, 0, BIDI_B],
            paragraph_starts: vec![0],
            paragraph_ends: vec![3],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        let mut flow = FlowLayoutArena {
            lines: vec![FlowLine {
                typography: Default::default(),
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_count: 1,
                align: ALIGN_CENTER,
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
                    text_end: 2,
                    advance: 12.0,
                    hung_advance: 0.0,
                    hard_break: true,
                    start_correction: Correction::ZERO,
                    end_correction: Correction::ZERO,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
                lead_index: NO_BOUNDARY,
                tail_index: NO_BOUNDARY,
            }]
            .into(),
            ..FlowLayoutArena::default()
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
        let extents = |_, _| {
            Some(FontGlyphExtents {
                x_min: 0,
                y_min: 0,
                x_max: 500,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let boundary = BoundaryShapeArena::default();
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        let mut next_run_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_layout_plan_producer_invariants(
            &active,
            &clusters,
            &boundary,
            PositionedSourceContext {
                styles: &styles,
                clusters: &clusters,
            },
        );
        assert_eq!(active.outlined_count(), 2);
        let context = PositionedSourceContext {
            styles: &styles,
            clusters: &clusters,
        };
        let active0 = projected_row_at(&active, 0, context, &boundary);
        let active1 = projected_row_at(&active, 1, context, &boundary);
        let active0_glyph = active0.glyph;
        assert_eq!(active0.f32(0), Some(-6.0));
        assert_eq!(active1.f32(0), Some(0.0));
        assert_eq!(active0.f32(1), Some(-3.5));
        assert_eq!(
            placed_semantic_at(&active, 0, &clusters, &boundary).inline_origin,
            4.0
        );
        assert_eq!(
            placed_semantic_at(&active, 1, &clusters, &boundary).inline_origin,
            10.0
        );
        assert_eq!(
            placed_semantic_at(&active, 0, &clusters, &boundary).block_origin,
            8.0
        );
        assert_ne!(
            active0.f32(1).unwrap(),
            placed_semantic_at(&active, 0, &clusters, &boundary).block_origin
        );
        assert_eq!(
            [active0.u32(0).unwrap(), active1.u32(0).unwrap()],
            [u32::MAX, u32::MAX]
        );

        active.mark_published();
        let mut pending = PositionedGlyphArena::default();
        pending
            .build(
                &active,
                &flow,
                None,
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_layout_plan_producer_invariants(
            &pending,
            &clusters,
            &boundary,
            PositionedSourceContext {
                styles: &styles,
                clusters: &clusters,
            },
        );
        assert_eq!(pending.outlined_count(), 2);

        let retained_flow = FlowLayoutArena {
            lines: flow.lines.clone(),
            fragments: flow.fragments.clone(),
            ..FlowLayoutArena::default()
        };
        flow.recomposed_lines = core::iter::once(0..1).collect();
        flow.recomposed_lines_retained = true;
        assert!(
            flow.fragments
                .update(0, |fragment| {
                    fragment.slot_start = 1.0;
                    fragment.slot_end = 21.0;
                })
                .unwrap()
        );
        pending
            .build(
                &active,
                &flow,
                Some(&retained_flow),
                flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(
            projected_row_at(&pending, 0, context, &boundary)
                .glyph
                .inline_start,
            active0_glyph.inline_start
        );
        assert_eq!(
            placed_semantic_at(&pending, 0, &clusters, &boundary).inline_origin,
            5.0
        );
        assert_eq!(
            semantic_row_at(&pending, 0, &clusters, &boundary).placement_segment,
            semantic_row_at(&active, 0, &clusters, &boundary).placement_segment
        );

        let mut metadata_flow = FlowLayoutArena {
            lines: flow.lines.clone(),
            fragments: flow.fragments.clone(),
            recomposed_lines: flow.recomposed_lines.clone(),
            recomposed_lines_retained: flow.recomposed_lines_retained,
            ..FlowLayoutArena::default()
        };
        assert!(
            metadata_flow
                .lines
                .update(0, |line| {
                    line.region_id = 19;
                    line.flow_thread_id = 17;
                    line.transform_index = 29;
                    line.clip_id = 39;
                })
                .unwrap()
        );
        let mut metadata_pending = PositionedGlyphArena::default();
        metadata_pending
            .build(
                &active,
                &metadata_flow,
                Some(&retained_flow),
                metadata_flow.recomposed_line_ranges(),
                &text,
                &clusters,
                &clusters,
                &runs,
                &runs,
                &BoundaryShapeArena::default(),
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                &mut next_run_revision,
                |_| ThreadTypography::default(),
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        let metadata0 = projected_row_at(&metadata_pending, 0, context, &boundary);
        let metadata1 = projected_row_at(&metadata_pending, 1, context, &boundary);
        assert_eq!(metadata0.glyph.inline_start, active0_glyph.inline_start);
        assert_eq!(metadata0.glyph.block_start, active0_glyph.block_start);
        assert_eq!(metadata0.glyph.inline_extent, active0_glyph.inline_extent);
        assert_eq!(metadata0.glyph.block_extent, active0_glyph.block_extent);
        assert_eq!(metadata0.glyph.clip_id, 39);
        assert_eq!(
            [metadata0.u32(2).unwrap(), metadata1.u32(2).unwrap()],
            [19, 19]
        );
        assert_eq!(
            [metadata0.u32(3).unwrap(), metadata1.u32(3).unwrap()],
            [17, 17]
        );
        assert_eq!(
            [metadata0.u32(4).unwrap(), metadata1.u32(4).unwrap()],
            [29, 29]
        );

        // The ordered producer still owns within-paragraph identity. Publication order
        // is exercised with real paragraph mutations in state.rs.
        assert_eq!(
            [metadata0.glyph.stable_id, metadata1.glyph.stable_id],
            [100, 200]
        );
    }

    #[test]
    fn placement_binding_assigns_shifted_handles_per_segment() {
        let mut previous = fixture_position_results(0, 3, |_, _, _| {});
        let segment_count = previous.placement_segments().len();
        let keys = (1..=u32::try_from(segment_count).unwrap()).collect::<Vec<_>>();
        let mut initial_slots = PlacementSlotArena::default();
        initial_slots.prepare(&keys, 1).unwrap();
        let initial_handles = initial_slots.assignments().unwrap().to_vec();
        previous.bind_placement_handles(&initial_handles).unwrap();

        let mut current = fixture_position_results(0, 3, |_, _, _| {});
        let shifted_keys = core::iter::once(0)
            .chain(keys.iter().copied())
            .collect::<Vec<_>>();
        let mut shifted_slots = PlacementSlotArena::default();
        shifted_slots.prepare(&shifted_keys, 1).unwrap();
        let shifted_handles = shifted_slots.assignments().unwrap()[1..].to_vec();
        current.bind_placement_handles(&shifted_handles).unwrap();

        assert_eq!(
            (0..segment_count)
                .map(|index| current.placement_handle(index))
                .collect::<Vec<_>>(),
            shifted_handles
                .iter()
                .copied()
                .map(Some)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            current.placement_instance_count().unwrap(),
            current.outlined_count()
        );
        assert_ne!(previous.placement_handle(0), current.placement_handle(0));
    }

    #[test]
    fn placement_binding_rejects_bad_segment_cardinality_atomically() {
        let mut positioned = fixture_position_results(0, 11, |_, _, _| {});
        let count = positioned.placement_segments().len();
        assert!(count >= 3);
        let mut keys = (1..=u32::try_from(count).unwrap()).collect::<Vec<_>>();
        let mut slots = PlacementSlotArena::default();
        slots.prepare(&keys, 1).unwrap();
        let accepted = slots.assignments().unwrap().to_vec();
        positioned.bind_placement_handles(&accepted).unwrap();
        positioned.mark_published();
        slots.commit();
        let before = (0..count)
            .map(|index| positioned.placement_handle(index))
            .collect::<Vec<_>>();
        let retained_before = positioned.recomposed_glyphs_retained;
        let source_intervals = positioned
            .unpublished_source_intervals(false)
            .unwrap()
            .to_vec();

        keys[count - 2] += 100;
        keys[count - 1] += 100;
        slots.prepare(&keys, 2).unwrap();
        let desired = slots.assignments().unwrap().to_vec();
        assert_ne!(accepted, desired);
        assert_eq!(
            positioned.bind_placement_handles(&desired[..count - 1]),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            (0..count)
                .map(|index| positioned.placement_handle(index))
                .collect::<Vec<_>>(),
            before
        );
        assert_eq!(positioned.recomposed_glyphs_retained, retained_before);
        assert_eq!(
            positioned.unpublished_source_intervals(false),
            Some(source_intervals.as_slice())
        );

        positioned.bind_placement_handles(&desired).unwrap();
        assert_eq!(
            (0..count)
                .map(|index| positioned.placement_handle(index))
                .collect::<Vec<_>>(),
            desired.iter().copied().map(Some).collect::<Vec<_>>()
        );
        assert_eq!(
            positioned.placement_instance_count().unwrap(),
            positioned.outlined_count()
        );
        // Accepted renderer revision overflow is exercised at publication in state.rs.
    }

    #[test]
    fn placement_binding_checks_generation_when_numeric_slot_is_reused() {
        let mut positioned = fixture_position_results(0, 1, |_, _, _| {});
        assert_eq!(positioned.placement_segments().len(), 1);
        let mut slots = PlacementSlotArena::default();
        slots.prepare(&[1u32], 1).unwrap();
        let old = slots.assignments().unwrap()[0];
        positioned.bind_placement_handles(&[old]).unwrap();
        assert_eq!(positioned.placement_handle(0), Some(old));
        positioned.bind_placement_handles(&[old]).unwrap();
        positioned.bind_placement_handles(&[old]).unwrap();
        positioned.mark_published();
        slots.commit();
        slots.prepare(&[], 2).unwrap();
        slots.commit();
        slots.acknowledge(2).unwrap();
        slots.prepare(&[2], 3).unwrap();
        let next = slots.assignments().unwrap()[0];
        assert_eq!(old.slot(), next.slot());
        assert_ne!(old, next);
        positioned.bind_placement_handles(&[next]).unwrap();
        assert_eq!(positioned.placement_handle(0), Some(next));
        assert_eq!(
            positioned.placement_instance_count().unwrap(),
            positioned.outlined_count()
        );
    }

    #[test]
    fn retained_placement_rejects_writer_precision_repartition_atomically() {
        let (text, mut old, runs, styles) = layout_run_positioning_fixture();
        let (_, mut next, _, _) = layout_run_positioning_fixture();
        old.glyph_x_offsets[0] = 900_000;
        next.glyph_x_offsets[0] = 900_000;
        next.glyph_x_offsets[1] = -900_000;
        next.glyph_x_offsets[2] = -900_000;
        let extents = |_: u32, glyph_id: u32| {
            Some(FontGlyphExtents {
                x_min: -10,
                y_min: -200,
                x_max: (400 + glyph_id) as i32,
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut old, &text, &runs, &styles, extents);
        prepare_positioning_clusters(&mut next, &text, &runs, &styles, extents);
        let ids = (1..=text.len() as u32).collect::<Vec<_>>();
        let style_arena = StyleArena::default();
        let canonical = RunCanonicalInput {
            text: &text,
            text_unit_ids: &ids,
            style_arena: &style_arena,
            styles: &styles,
            shaping_runs: &runs,
        };
        let mut revision = old.layout_runs().len() as u32 + 1;
        next.finalize_layout_run_revisions(
            &old,
            canonical,
            canonical,
            &mut IdentityIndex::default(),
            &mut revision,
            None,
        )
        .unwrap();
        assert_ne!(
            old.layout_runs()[0].canonical_revision,
            next.layout_runs()[0].canonical_revision
        );
        assert_eq!(old.starts, next.starts);
        assert_eq!(old.ends, next.ends);
        assert_eq!(old.glyph_counts, next.glyph_counts);
        assert_eq!(old.layout_runs()[0].numeric_blocks.count, 1);
        assert_eq!(next.layout_runs()[0].numeric_blocks.count, 2);
        let mut previous = fixture_position_results(0, 2, |clusters, _, _| {
            clusters.glyph_x_offsets[0] = 900_000;
        });
        previous.placement.finish_line(0).unwrap();
        let mut candidate = PlacementState::default();
        super::super::work_attribution::reset();
        let result = candidate.append_retained_line(
            &previous.placement,
            RetainedLinePlacement {
                line_index: 0,
                old_fragment_start: 0,
                new_fragment_start: 0,
                instance_count: previous.outlined_count() as u32,
            },
            next.layout_runs(),
            &[],
            Some(RetainedRunCorrespondence {
                previous_clusters: &old,
                clusters: &next,
                previous_runs: &runs,
                runs: &runs,
            }),
        );
        assert_eq!(result, Err(EngineError::InvalidRequest));
        assert_eq!(
            super::super::work_attribution::snapshot().placement_remap_numeric_partition,
            1
        );
        assert!(candidate.segment_rows().is_empty());
        assert!(candidate.translations().is_empty());
        assert_eq!(candidate.instance_count().unwrap(), 0);
        candidate
            .append_retained_line(
                &previous.placement,
                RetainedLinePlacement {
                    line_index: 0,
                    old_fragment_start: 0,
                    new_fragment_start: 0,
                    instance_count: previous.outlined_count() as u32,
                },
                old.layout_runs(),
                &[],
                None,
            )
            .unwrap();
        assert_eq!(candidate.segment_rows(), previous.placement.segment_rows());
        assert_eq!(candidate.translations(), previous.placement.translations());
    }

    #[test]
    fn placed_rounding_can_hide_one_local_ink_ulp_without_changing_projected_local() {
        let fixture = fixture_position_results(0, 3, |_, _, _| {});
        let boundary = BoundaryShapeArena::default();
        let semantic = semantic_row_at(&fixture, 0, &fixture.clusters, &boundary);
        let projected = projected_row_at(&fixture, 0, fixture.context(), &boundary);
        let mut nudged = semantic;
        nudged.ink_inline_start = f32::from_bits(semantic.ink_inline_start.to_bits() + 1);
        assert_ne!(
            nudged.ink_inline_start.to_bits(),
            semantic.ink_inline_start.to_bits()
        );
        assert_eq!(
            fixture
                .placed_occurrence(nudged)
                .unwrap()
                .ink_inline_start
                .to_bits(),
            fixture
                .placed_occurrence(semantic)
                .unwrap()
                .ink_inline_start
                .to_bits()
        );
        assert_eq!(
            projected.glyph.inline_start.to_bits(),
            semantic.inline_origin.to_bits()
        );
    }

    #[test]
    fn translated_ink_preserves_projected_local_codec_fields() {
        let previous = fixture_position_results(0, 3, |_, _, _| {});
        let full = fixture_position_results(0, 3, |_, _, line| line.baseline += 2.0);
        let boundary = BoundaryShapeArena::default();
        assert_eq!(previous.outlined_count(), full.outlined_count());
        for index in 0..previous.outlined_count() {
            let old = projected_row_at(&previous, index, previous.context(), &boundary).glyph;
            let next = projected_row_at(&full, index, full.context(), &boundary).glyph;
            assert_eq!(old.inline_start, next.inline_start);
            assert_eq!(old.block_start, next.block_start);
            assert_eq!(old.inline_extent, next.inline_extent);
            assert_eq!(old.block_extent, next.block_extent);
        }
        assert_ne!(
            placed_semantic_at(&previous, 0, &previous.clusters, &boundary).ink_block_start,
            placed_semantic_at(&full, 0, &full.clusters, &boundary).ink_block_start
        );
    }

    #[test]
    fn projected_instance_metadata_reads_current_style_and_line() {
        let fixture = fixture_position_results(0, 3, |_, styles, line| {
            styles[0].style.foreground_rgba = 0x1234_56ff;
            line.region_id = 31;
            line.flow_thread_id = 41;
            line.transform_index = 51;
        });
        let boundary = BoundaryShapeArena::default();
        let row = projected_row_at(&fixture, 0, fixture.context(), &boundary);
        assert_eq!(row.u32(0), Some(0x1234_56ff));
        assert_eq!(row.u32(2), Some(31));
        assert_eq!(row.u32(3), Some(41));
        assert_eq!(row.u32(4), Some(51));
        // Accepted changed-column masks and binding reuse are exercised by
        // state.rs::projected_accepted_instance_dependencies_track_declared_columns.
    }

    #[test]
    fn clip_change_preserves_projected_local_geometry() {
        let previous = fixture_position_results(0, 1, |_, _, line| line.clip_id = 1);
        let next = fixture_position_results(0, 1, |_, _, line| line.clip_id = 2);
        let boundary = BoundaryShapeArena::default();
        let old = projected_row_at(&previous, 0, previous.context(), &boundary);
        let new = projected_row_at(&next, 0, next.context(), &boundary);
        assert_eq!(old.glyph.clip_id, 1);
        assert_eq!(new.glyph.clip_id, 2);
        assert_eq!(
            old.glyph.inline_start.to_bits(),
            new.glyph.inline_start.to_bits()
        );
        assert_eq!(
            old.glyph.block_start.to_bits(),
            new.glyph.block_start.to_bits()
        );
        assert_eq!(
            old.glyph.inline_extent.to_bits(),
            new.glyph.inline_extent.to_bits()
        );
        assert_eq!(
            old.glyph.block_extent.to_bits(),
            new.glyph.block_extent.to_bits()
        );
        assert_eq!(old.glyph.stable_id, new.glyph.stable_id);
    }
}
