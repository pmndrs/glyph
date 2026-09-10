//! Retained horizontal glyph positioning and exact content revision assignment.

use alloc::vec::Vec;

use crate::{FontGlyphExtents, FontMetrics, bidi::BidiAnalysis};

use super::placement_state::{
    GlyphSource, LayoutRunOwner, PlacementIdentity, PlacementState, RetainedLinePlacement,
    SegmentTranslation, SliceRole,
};

use super::{
    EngineError, FrameFault,
    cluster_state::{
        BoundaryRunRole, CLUSTER_HARD_BREAK, CLUSTER_SPACE, ClusterArena, LayoutRun,
        LayoutRunSourceKind, PlacementCluster, RunCanonicalRevision,
    },
    codec_gather::{LayoutGlyph, PAINT_LAYER_GLYPH},
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    frame::{ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START},
    identity_index::{IdentityIndex, IdentityIndexError},
    run_local::{
        ClusterFinish, RunLocalArena, RunLocalBuildError, RunLocalGlyph, RunLocalGlyphInput,
        RunLocalWriter,
    },
    run_slot::RunHandle,
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapingRun},
    style_state::{ResolvedStyle, StyleSegment},
};

pub(crate) const SEMANTIC_F32_BASE_FIELD_COUNT: usize = 6;
pub(crate) const SEMANTIC_F32_FIELD_COUNT: usize = 9;
pub(crate) const SEMANTIC_F32_CHANGE_FIELD_COUNT: usize = 8;
pub(crate) const SEMANTIC_U32_BASE_FIELD_COUNT: usize = 6;
pub(crate) const SEMANTIC_U32_FIELD_COUNT: usize = 8;
pub(crate) const SEMANTIC_EFFECTS_CHANGE: u16 = 1 << 14;
pub(crate) const SEMANTIC_PLACEMENT_CHANGE: u16 = 1 << 15;
pub(crate) const ALL_SEMANTIC_CHANGES: u16 = u16::MAX;
const CAPTURE_RUN_PLACEMENT: bool = true;

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

/// The ink box the render record and the semantic record must agree on, derived once per glyph.
#[cfg(any(test, feature = "kernel-lab"))]
#[derive(Clone, Copy)]
struct GlyphInkBox {
    inline_start: f64,
    block_start: f64,
    inline_extent: f64,
    block_extent: f64,
}

#[cfg(any(test, feature = "kernel-lab"))]
impl GlyphInkBox {
    /// A glyph with no outline still occupies its origin. Reporting the degenerate box there keeps
    /// every semantic glyph's ink box in one coordinate space instead of leaving a hole.
    fn empty_at(origin_inline: f64, origin_block: f64) -> Self {
        Self {
            inline_start: origin_inline,
            block_start: origin_block,
            inline_extent: 0.0,
            block_extent: 0.0,
        }
    }

    fn from_extents(
        extents: &FontGlyphExtents,
        origin_inline: f64,
        origin_block: f64,
        scale: f64,
    ) -> Self {
        Self {
            inline_start: origin_inline + f64::from(extents.x_min) * scale,
            block_start: origin_block - f64::from(extents.y_max) * scale,
            inline_extent: f64::from(extents.x_max - extents.x_min) * scale,
            block_extent: f64::from(extents.y_max - extents.y_min) * scale,
        }
    }
}

#[cfg(any(test, feature = "kernel-lab"))]
#[derive(Clone, Copy)]
struct ShadowGlyphGeometry {
    inline_origin: f64,
    block_origin: f64,
    inline_advance: f64,
    ink: GlyphInkBox,
}

#[cfg(any(test, feature = "kernel-lab"))]
#[allow(clippy::too_many_arguments)]
fn shadow_glyph_geometry(
    cursor: f64,
    baseline: f64,
    baseline_shift: f32,
    scale: f64,
    x_advance: i32,
    x_offset: i32,
    y_offset: i32,
    outline: Option<&FontGlyphExtents>,
) -> ShadowGlyphGeometry {
    let inline_advance = f64::from(x_advance).abs() * scale;
    let inline_offset = f64::from(x_offset) * scale;
    let block_offset = f64::from(y_offset) * scale;
    let inline_origin = cursor + inline_offset;
    let block_origin = baseline - block_offset - f64::from(baseline_shift);
    let ink = match outline {
        Some(extents) => GlyphInkBox::from_extents(extents, inline_origin, block_origin, scale),
        None => GlyphInkBox::empty_at(inline_origin, block_origin),
    };
    ShadowGlyphGeometry {
        inline_origin,
        block_origin,
        inline_advance,
        ink,
    }
}

#[cfg(any(test, feature = "kernel-lab"))]
#[derive(Clone, Copy, Debug, PartialEq)]
struct ShadowRunGlyph {
    stable_id: u32,
    inline_origin: f32,
    block_origin: f32,
    inline_advance: f32,
    ink_inline_start: f32,
    ink_block_start: f32,
    ink_inline_extent: f32,
    ink_block_extent: f32,
}

#[cfg(any(test, feature = "kernel-lab"))]
#[cfg_attr(not(test), allow(dead_code))]
fn shadow_base_ltr_unindented_fragment_positions(
    line: FlowLine,
    fragment: FlowFragment,
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<Vec<ShadowRunGlyph>, EngineError> {
    if line.align == ALIGN_JUSTIFY
        || fragment.boundary_index != super::flow_composition::NO_BOUNDARY
    {
        return Err(EngineError::InvalidRequest);
    }
    let cluster_start =
        usize::try_from(fragment.line.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let cluster_end =
        usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    if cluster_start > cluster_end || cluster_end > clusters.starts.len() {
        return Err(EngineError::InvalidRequest);
    }
    let (_, pen_origin) = fragment_pen(
        line,
        fragment,
        true,
        clusters,
        cluster_start,
        cluster_end,
        0.0,
        JustifyControls::default(),
        0,
        false,
    );
    let baseline = line.block_start + line.baseline;
    let mut fragment_cursor = pen_origin;
    let mut next_cluster = cluster_start;
    let mut positioned = Vec::new();

    for run in clusters.layout_runs() {
        let run_start =
            usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let run_end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let intersection_start = run_start.max(cluster_start);
        let intersection_end = run_end.min(cluster_end);
        if intersection_start >= intersection_end {
            continue;
        }
        if intersection_start != next_cluster {
            return Err(EngineError::InvalidRequest);
        }

        let mut local_cursor = 0.0;
        for cluster in run_start..intersection_start {
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                local_cursor += clusters.advances[cluster];
            }
        }
        let inline_translation = fragment_cursor - local_cursor;
        for cluster in intersection_start..intersection_end {
            if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                continue;
            }
            let style_index = usize::try_from(clusters.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles
                .get(style_index)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            let font_handle = clusters.font_handles[cluster];
            let units_per_em = clusters.units_per_em[cluster];
            if font_handle == 0 || units_per_em == 0.0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(style.font_size) / units_per_em;
            let local_cluster_origin = local_cursor;
            let fragment_cluster_origin = fragment_cursor;
            let glyph_start = usize::try_from(clusters.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(clusters.glyph_counts[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in glyph_start..glyph_end {
                let glyph_id = u32::from(
                    *clusters
                        .glyph_ids
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?,
                );
                let outline = extents_for(font_handle, glyph_id);
                let geometry = shadow_glyph_geometry(
                    local_cursor,
                    0.0,
                    style.baseline_shift,
                    scale,
                    *clusters
                        .glyph_x_advances
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?,
                    *clusters
                        .glyph_x_offsets
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?,
                    *clusters
                        .glyph_y_offsets
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?,
                    outline.as_ref(),
                );
                positioned.push(ShadowRunGlyph {
                    stable_id: *clusters
                        .glyph_stable_ids
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?,
                    inline_origin: finite_f32(geometry.inline_origin + inline_translation)?,
                    block_origin: finite_f32(geometry.block_origin + baseline)?,
                    inline_advance: nonnegative_f32(geometry.inline_advance)?,
                    ink_inline_start: finite_f32(geometry.ink.inline_start + inline_translation)?,
                    ink_block_start: finite_f32(geometry.ink.block_start + baseline)?,
                    ink_inline_extent: nonnegative_f32(geometry.ink.inline_extent)?,
                    ink_block_extent: nonnegative_f32(geometry.ink.block_extent)?,
                });
                local_cursor += geometry.inline_advance;
            }
            local_cursor = local_cluster_origin + clusters.advances[cluster];
            fragment_cursor = fragment_cluster_origin + clusters.advances[cluster];
        }
        next_cluster = intersection_end;
    }
    if next_cluster != cluster_end {
        return Err(EngineError::InvalidRequest);
    }
    Ok(positioned)
}

#[cfg(any(test, feature = "kernel-lab"))]
#[cfg_attr(not(test), allow(dead_code))]
mod layout_run_proof;

/// One solid decoration line for a contiguous decorated visual run: underline,
/// overline, or line-through geometry in positioned space, colored by the style's
/// decoration paint. Non-solid line styles carry their style bits for later paint work
/// and render as solid geometry until then.
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
    pub clip_id: u32,
    pub region_id: u32,
    pub flow_thread_id: u32,
    pub transform_index: u32,
}

#[derive(Default)]
pub(crate) struct PositionedGlyphArena {
    glyphs: Vec<LayoutGlyph>,
    line_glyph_starts: Vec<u32>,
    line_glyph_counts: Vec<u32>,
    line_decoration_starts: Vec<u32>,
    line_decoration_counts: Vec<u32>,
    semantic_glyphs: Vec<SemanticGlyph>,
    semantic_line_glyph_starts: Vec<u32>,
    semantic_line_glyph_counts: Vec<u32>,
    semantic_line_inline_extents: Vec<f64>,
    semantic_change_masks: Vec<u16>,
    semantic_f32: [Vec<f32>; SEMANTIC_F32_FIELD_COUNT],
    semantic_u32: [Vec<u32>; SEMANTIC_U32_FIELD_COUNT],
    visual_clusters: Vec<u32>,
    visual_levels: Vec<u8>,
    line_levels: Vec<u8>,
    recomposed_glyphs: Option<RecomposedGlyphRange>,
    decorations: Vec<DecorationRecord>,
    replacement_runs: Vec<LayoutRun>,
    replacement_run_local: RunLocalArena,
    replacement_run_indices: Vec<[Option<u32>; 2]>,
    replacement_current_order: Vec<u32>,
    replacement_previous_order: Vec<u32>,
    placement: PlacementState,
    placement_fragment_index: u32,
    text_effects: bool,
    #[cfg(test)]
    retained_static_geometry: bool,
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

#[derive(Clone, Copy)]
struct GlyphPublication {
    style: ResolvedStyle,
    cluster: u32,
    region: u32,
    flow_thread: u32,
    transform_index: u32,
}

struct RetainedInstanceCursor {
    semantic_next: usize,
    semantic_end: usize,
    rendered_next: usize,
    rendered_end: usize,
}

#[derive(Clone, Copy)]
struct RetainedGlyphUpdate {
    line: FlowLine,
    local: RunLocalGlyph,
    occurrence: PlacementOccurrence,
    glyph_source: GlyphSource,
    source_glyph: u32,
    bidi_level: u8,
    role: SliceRole,
    stable_id: u32,
    glyph_id: u32,
    font_handle: u32,
}

struct PositionedCluster {
    style: ResolvedStyle,
    font_handle: u32,
    cluster_origin: f64,
}

struct GlyphStreams<'a> {
    ids: &'a [u16],
    clusters: &'a [u32],
    shape_flags: &'a [u16],
    stable_ids: &'a [u32],
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

fn boundary_shape_span<'a>(
    arena: &'a BoundaryShapeArena,
    spec: BoundaryRunSpec,
) -> Result<BoundaryShapeSpan<'a>, EngineError> {
    let start = usize::try_from(spec.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::try_from(spec.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(BoundaryShapeSpan {
        glyph_ids: arena
            .shape
            .glyph_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        x_advances: arena
            .shape
            .x_advances
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        y_advances: arena
            .shape
            .y_advances
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        x_offsets: arena
            .shape
            .x_offsets
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        y_offsets: arena
            .shape
            .y_offsets
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        glyph_flags: arena
            .shape
            .glyph_flags
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        stable_ids: arena
            .stable_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
    })
}

fn same_boundary_run(
    current: BoundaryRunSpec,
    previous: BoundaryRunSpec,
    current_shape: &BoundaryShapeArena,
    previous_shape: &BoundaryShapeArena,
    current_runs: &[ShapingRun],
    previous_runs: &[ShapingRun],
) -> Result<bool, EngineError> {
    if current.source_kind != previous.source_kind
        || current.font_handle != previous.font_handle
        || current.glyph_count != previous.glyph_count
    {
        return Ok(false);
    }
    let current_run = current_runs
        .get(usize::try_from(current.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let previous_run = previous_runs
        .get(usize::try_from(previous.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let same_metrics = current_run.bidi_level == previous_run.bidi_level
        && current_run.style.font_size.to_bits() == previous_run.style.font_size.to_bits()
        && current_run.style.letter_spacing.to_bits()
            == previous_run.style.letter_spacing.to_bits()
        && current_run.style.word_spacing.to_bits() == previous_run.style.word_spacing.to_bits()
        && current_run.style.baseline_shift.to_bits()
            == previous_run.style.baseline_shift.to_bits();
    Ok(same_metrics
        && same_relative_boundary_clusters(current_shape, current, previous_shape, previous)?
        && boundary_shape_span(current_shape, current)?
            == boundary_shape_span(previous_shape, previous)?)
}

fn same_relative_boundary_clusters(
    current_shape: &BoundaryShapeArena,
    current: BoundaryRunSpec,
    previous_shape: &BoundaryShapeArena,
    previous: BoundaryRunSpec,
) -> Result<bool, EngineError> {
    fn clusters(arena: &BoundaryShapeArena, spec: BoundaryRunSpec) -> Result<&[u32], EngineError> {
        let start = usize::try_from(spec.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(
                usize::try_from(spec.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::InvalidRequest)?;
        arena
            .shape
            .clusters
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }
    let current = clusters(current_shape, current)?;
    let previous = clusters(previous_shape, previous)?;
    let current_base = current.first().copied().unwrap_or(0);
    let previous_base = previous.first().copied().unwrap_or(0);
    Ok(current.len() == previous.len()
        && current.iter().zip(previous).all(|(left, right)| {
            i64::from(*left) - i64::from(current_base)
                == i64::from(*right) - i64::from(previous_base)
        }))
}

impl BoundaryRunSpec {
    fn from_boundary(boundary: BoundaryShape, role: BoundaryRunRole) -> Option<Self> {
        let (glyph_start, glyph_count, font_handle) = match role {
            BoundaryRunRole::BoundarySource => (
                boundary.source_glyph_start,
                boundary.source_glyph_count,
                boundary.source_font_handle,
            ),
            BoundaryRunRole::Ellipsis => (
                boundary.ellipsis_glyph_start,
                boundary.ellipsis_glyph_count,
                boundary.ellipsis_font_handle,
            ),
        };
        (glyph_count != 0).then_some(Self {
            source_kind: LayoutRunSourceKind::Boundary {
                flow_thread_id: boundary.flow_thread_id,
                role,
            },
            cluster_start: boundary.cluster_start,
            cluster_end: boundary.cluster_end,
            glyph_start,
            glyph_count,
            source_run: boundary.source_run,
            font_handle,
        })
    }
}

#[derive(Clone, Copy)]
struct RunGeometry {
    font_handle: u32,
    units_per_em: f64,
    font_size: f32,
    baseline_shift: f32,
}

impl RunGeometry {
    fn for_cluster(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        cluster: usize,
    ) -> Result<Self, EngineError> {
        let style_index = usize::try_from(clusters.style_indexes[cluster])
            .map_err(|_| EngineError::InvalidRequest)?;
        let style = styles
            .get(style_index)
            .ok_or(EngineError::InvalidRequest)?
            .style;
        Self::for_values(
            clusters.font_handles[cluster],
            clusters.units_per_em[cluster],
            style.font_size,
            style.baseline_shift,
        )
    }

    fn for_values(
        font_handle: u32,
        units_per_em: f64,
        font_size: f32,
        baseline_shift: f32,
    ) -> Result<Self, EngineError> {
        if font_handle == 0 || units_per_em == 0.0 {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Self {
            font_handle,
            units_per_em,
            font_size,
            baseline_shift,
        })
    }
}

#[derive(Clone, Copy)]
struct RecomposedGlyphRange {
    previous_start: usize,
    previous_end: usize,
    next_start: usize,
    next_end: usize,
}

impl PositionedGlyphArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.glyphs, capacity)?;
        reserve(&mut self.semantic_glyphs, capacity)?;
        reserve(&mut self.semantic_change_masks, capacity)?;
        for field in &mut self.semantic_f32[..SEMANTIC_F32_BASE_FIELD_COUNT] {
            reserve(field, capacity)?;
        }
        for field in &mut self.semantic_u32[..SEMANTIC_U32_BASE_FIELD_COUNT] {
            reserve(field, capacity)?;
        }
        reserve(&mut self.visual_clusters, capacity)?;
        reserve(&mut self.visual_levels, capacity)?;
        reserve(&mut self.line_levels, capacity)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        identity_index: &mut IdentityIndex,
        next_content_revision: &mut u32,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.clear();
        if CAPTURE_RUN_PLACEMENT {
            self.rebuild_replacement_runs(
                previous,
                boundary_shape,
                previous_boundary_shape,
                runs,
                previous_runs,
                next_run_canonical_revision,
            )?;
        }
        if CAPTURE_RUN_PLACEMENT {
            self.rebuild_replacement_run_local(
                boundary_shape,
                text,
                clusters,
                runs,
                styles,
                metrics_for,
                extents_for,
            )?;
            self.placement
                .prepare_run_resolution(clusters.layout_runs(), &self.replacement_runs)?;
        }
        self.text_effects = styles
            .iter()
            .any(|segment| style_has_text_effects(segment.style));
        let glyph_capacity = clusters
            .glyph_ids
            .len()
            .checked_add(boundary_shape.shape.glyph_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.reserve(glyph_capacity)?;
        if CAPTURE_RUN_PLACEMENT {
            self.placement.reserve_glyphs(glyph_capacity)?;
        }
        if self.text_effects {
            for field in &mut self.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..] {
                reserve(field, clusters.glyph_ids.len())?;
            }
            for field in &mut self.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..] {
                reserve(field, clusters.glyph_ids.len())?;
            }
        }
        reserve(&mut self.line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.line_decoration_starts, flow.lines.len())?;
        reserve(&mut self.line_decoration_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_inline_extents, flow.lines.len())?;
        let visually_ltr = is_trivially_ltr(bidi, runs);
        let retain_static_geometry = retained_flow.is_some()
            && visually_ltr
            && boundary_shape.records.is_empty()
            && previous_boundary_shape.records.is_empty()
            && previous.replacement_runs.is_empty()
            && styles
                .iter()
                .all(|segment| segment.style.decoration_flags == 0);
        let mut retained_instances = retain_static_geometry
            .then(|| self.retain_static_glyph_state(previous))
            .transpose()?;
        #[cfg(test)]
        {
            self.retained_static_geometry = retained_instances.is_some();
        }
        let mut retained_line_cursor = 0usize;
        for (line_index, line) in flow.lines.iter().copied().enumerate() {
            let placement_line_start = CAPTURE_RUN_PLACEMENT.then(|| self.placement.begin_line());
            if retained_instances.is_none()
                && flow
                    .recomposed_line_range()
                    .is_some_and(|(start, end)| line_index < start || line_index >= end)
            {
                let previous_glyph_start = *previous
                    .line_glyph_starts
                    .get(line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let previous_glyph_count = *previous
                    .line_glyph_counts
                    .get(line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                if !CAPTURE_RUN_PLACEMENT {
                    self.append_retained_line(previous, line_index)?;
                    continue;
                }
                match self.placement.append_retained_line(
                    &previous.placement,
                    RetainedLinePlacement {
                        line_index,
                        old_fragment_start: previous.placement.line_fragment_start(line_index)?,
                        new_fragment_start: line.fragment_start,
                        old_instance_start: previous_glyph_start,
                        instance_count: previous_glyph_count,
                        new_instance_start: u32::try_from(self.glyphs.len())
                            .map_err(|_| EngineError::ResultTooLarge)?,
                    },
                    clusters.layout_runs(),
                    &self.replacement_runs,
                ) {
                    Ok(()) => {
                        self.append_retained_line(previous, line_index)?;
                        continue;
                    }
                    Err(EngineError::InvalidRequest) => {}
                    Err(error) => return Err(error),
                }
            }
            if retained_instances.is_none()
                && let Some(previous_flow) = retained_flow
                && let Some(previous_line_index) = equivalent_retained_line(
                    flow,
                    line_index,
                    line,
                    previous_flow,
                    &mut retained_line_cursor,
                    clusters,
                    bidi,
                    visually_ltr,
                    typography_for(line.flow_thread_id),
                    retained_typography_for(line.flow_thread_id),
                )?
            {
                let previous_line = previous_flow
                    .lines
                    .get(previous_line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let previous_glyph_start = *previous
                    .line_glyph_starts
                    .get(previous_line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let previous_glyph_count = *previous
                    .line_glyph_counts
                    .get(previous_line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                if !CAPTURE_RUN_PLACEMENT {
                    self.append_retained_line(previous, previous_line_index)?;
                    continue;
                }
                match self.placement.append_retained_line(
                    &previous.placement,
                    RetainedLinePlacement {
                        line_index: previous_line_index,
                        old_fragment_start: previous_line.fragment_start,
                        new_fragment_start: line.fragment_start,
                        old_instance_start: previous_glyph_start,
                        instance_count: previous_glyph_count,
                        new_instance_start: u32::try_from(self.glyphs.len())
                            .map_err(|_| EngineError::ResultTooLarge)?,
                    },
                    clusters.layout_runs(),
                    &self.replacement_runs,
                ) {
                    Ok(()) => {
                        self.append_retained_line(previous, previous_line_index)?;
                        continue;
                    }
                    Err(EngineError::InvalidRequest) => {}
                    Err(error) => return Err(error),
                }
            }
            let line_glyph_start = retained_instances
                .as_ref()
                .map_or(self.glyphs.len(), |cursor| cursor.rendered_next);
            let line_decoration_start = self.decorations.len();
            let semantic_line_start = retained_instances
                .as_ref()
                .map_or(self.semantic_glyphs.len(), |cursor| cursor.semantic_next);
            let fragments = line_fragments(flow, line)?;
            if fragments.is_empty() {
                self.line_glyph_starts.push(
                    u32::try_from(line_glyph_start).map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.line_glyph_counts.push(0);
                self.line_decoration_starts.push(
                    u32::try_from(line_decoration_start)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.line_decoration_counts.push(0);
                self.semantic_line_glyph_starts.push(
                    u32::try_from(semantic_line_start).map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.semantic_line_glyph_counts.push(0);
                self.semantic_line_inline_extents.push(0.0);
                if let Some(placement_line_start) = placement_line_start {
                    self.placement.finish_line(placement_line_start)?;
                }
                continue;
            }
            let first = fragments.first().ok_or(EngineError::InvalidRequest)?;
            let last = fragments.last().ok_or(EngineError::InvalidRequest)?;
            if !visually_ltr {
                prepare_line_levels(
                    &mut self.line_levels,
                    bidi,
                    first.line.text_start,
                    last.line.text_end,
                )?;
            }
            let final_line = flow
                .lines
                .get(line_index + 1)
                .is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
            let inline_start = fragments
                .iter()
                .map(|fragment| fragment.slot_start)
                .fold(f64::INFINITY, f64::min);
            let typography = typography_for(line.flow_thread_id);
            let mut inline_end = f64::NEG_INFINITY;
            self.placement_fragment_index = line.fragment_start;
            for fragment in fragments.iter().copied() {
                let indent = if fragment.line.cluster_start == 0 {
                    typography.first_line_indent
                } else {
                    0.0
                };
                let fragment_advance = if let Some(cursor) = retained_instances.as_mut() {
                    if self.text_effects {
                        self.position_fragment::<true>(
                            line,
                            fragment,
                            final_line,
                            text,
                            clusters,
                            runs,
                            boundary_shape,
                            styles,
                            bidi,
                            visually_ltr,
                            indent,
                            typography.justify,
                            metrics_for,
                            extents_for,
                            Some(cursor),
                        )?
                    } else {
                        self.position_fragment::<false>(
                            line,
                            fragment,
                            final_line,
                            text,
                            clusters,
                            runs,
                            boundary_shape,
                            styles,
                            bidi,
                            visually_ltr,
                            indent,
                            typography.justify,
                            metrics_for,
                            extents_for,
                            Some(cursor),
                        )?
                    }
                } else if self.text_effects {
                    self.position_fragment::<true>(
                        line,
                        fragment,
                        final_line,
                        text,
                        clusters,
                        runs,
                        boundary_shape,
                        styles,
                        bidi,
                        visually_ltr,
                        indent,
                        typography.justify,
                        metrics_for,
                        extents_for,
                        None,
                    )?
                } else {
                    self.position_fragment::<false>(
                        line,
                        fragment,
                        final_line,
                        text,
                        clusters,
                        runs,
                        boundary_shape,
                        styles,
                        bidi,
                        visually_ltr,
                        indent,
                        typography.justify,
                        metrics_for,
                        extents_for,
                        None,
                    )?
                };
                inline_end = inline_end.max(fragment.slot_start + fragment_advance);
                self.placement_fragment_index = self
                    .placement_fragment_index
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
            self.semantic_line_glyph_starts
                .push(u32::try_from(semantic_line_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.semantic_line_glyph_counts.push(
                u32::try_from(
                    retained_instances
                        .as_ref()
                        .map_or(self.semantic_glyphs.len(), |cursor| cursor.semantic_next)
                        .saturating_sub(semantic_line_start),
                )
                .map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.semantic_line_inline_extents
                .push((inline_end - inline_start).max(0.0));
            self.line_glyph_starts
                .push(u32::try_from(line_glyph_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.line_glyph_counts.push(
                u32::try_from(
                    retained_instances
                        .as_ref()
                        .map_or(self.glyphs.len(), |cursor| cursor.rendered_next)
                        .saturating_sub(line_glyph_start),
                )
                .map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.line_decoration_starts.push(
                u32::try_from(line_decoration_start).map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.line_decoration_counts.push(
                u32::try_from(self.decorations.len().saturating_sub(line_decoration_start))
                    .map_err(|_| EngineError::ResultTooLarge)?,
            );
            if let Some(placement_line_start) = placement_line_start {
                self.placement.finish_line(placement_line_start)?;
            }
        }
        if retained_instances.as_ref().is_some_and(|cursor| {
            cursor.semantic_next != cursor.semantic_end
                || cursor.rendered_next != cursor.rendered_end
        }) {
            return Err(EngineError::InvalidRequest);
        }
        self.recomposed_glyphs = flow
            .recomposed_line_range()
            .map(|(start, end)| {
                Ok(RecomposedGlyphRange {
                    previous_start: line_span_start(&previous.line_glyph_starts, start)?,
                    previous_end: line_span_end(
                        &previous.line_glyph_starts,
                        &previous.line_glyph_counts,
                        end,
                    )?,
                    next_start: line_span_start(&self.line_glyph_starts, start)?,
                    next_end: line_span_end(&self.line_glyph_starts, &self.line_glyph_counts, end)?,
                })
            })
            .transpose()?;
        if CAPTURE_RUN_PLACEMENT {
            self.placement.validate_occurrences(
                self.glyphs.len(),
                clusters.layout_runs(),
                &self.replacement_runs,
            )?;
        }
        // Retained flow proves that only geometry-authored semantic fields can differ.
        self.assign_content_revisions(
            previous,
            identity_index,
            next_content_revision,
            retained_flow.is_some(),
        )
    }

    fn append_retained_line(
        &mut self,
        previous: &Self,
        line_index: usize,
    ) -> Result<(), EngineError> {
        let glyph_start = usize::try_from(
            *previous
                .line_glyph_starts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let glyph_count = usize::try_from(
            *previous
                .line_glyph_counts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let glyph_end = glyph_start
            .checked_add(glyph_count)
            .ok_or(EngineError::InvalidRequest)?;
        let decoration_start = usize::try_from(
            *previous
                .line_decoration_starts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let decoration_count = usize::try_from(
            *previous
                .line_decoration_counts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let decoration_end = decoration_start
            .checked_add(decoration_count)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic_start = usize::try_from(
            *previous
                .semantic_line_glyph_starts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let semantic_count = usize::try_from(
            *previous
                .semantic_line_glyph_counts
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let semantic_end = semantic_start
            .checked_add(semantic_count)
            .ok_or(EngineError::InvalidRequest)?;
        self.line_glyph_starts
            .push(u32::try_from(self.glyphs.len()).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_glyph_counts
            .push(u32::try_from(glyph_count).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_decoration_starts
            .push(u32::try_from(self.decorations.len()).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_decoration_counts
            .push(u32::try_from(decoration_count).map_err(|_| EngineError::ResultTooLarge)?);
        self.decorations.extend_from_slice(
            previous
                .decorations
                .get(decoration_start..decoration_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        let next_semantic_start = self.semantic_glyphs.len();
        for previous_glyph in previous
            .glyphs
            .get(glyph_start..glyph_end)
            .ok_or(EngineError::InvalidRequest)?
        {
            let previous_semantic_index = usize::try_from(previous_glyph.semantic_glyph_index)
                .map_err(|_| EngineError::InvalidRequest)?;
            let line_semantic_index = previous_semantic_index
                .checked_sub(semantic_start)
                .filter(|index| *index < semantic_count)
                .ok_or(EngineError::InvalidRequest)?;
            let mut glyph = *previous_glyph;
            glyph.semantic_glyph_index = u32::try_from(next_semantic_start + line_semantic_index)
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.glyphs.push(glyph);
        }
        for (target, source) in self.semantic_f32[..SEMANTIC_F32_BASE_FIELD_COUNT]
            .iter_mut()
            .zip(&previous.semantic_f32[..SEMANTIC_F32_BASE_FIELD_COUNT])
        {
            target.extend_from_slice(
                source
                    .get(glyph_start..glyph_end)
                    .ok_or(EngineError::InvalidRequest)?,
            );
        }
        for (target, source) in self.semantic_u32[..SEMANTIC_U32_BASE_FIELD_COUNT]
            .iter_mut()
            .zip(&previous.semantic_u32[..SEMANTIC_U32_BASE_FIELD_COUNT])
        {
            target.extend_from_slice(
                source
                    .get(glyph_start..glyph_end)
                    .ok_or(EngineError::InvalidRequest)?,
            );
        }
        if self.text_effects {
            if previous.text_effects {
                for (target, source) in self.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..]
                    .iter_mut()
                    .zip(&previous.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..])
                {
                    target.extend_from_slice(
                        source
                            .get(glyph_start..glyph_end)
                            .ok_or(EngineError::InvalidRequest)?,
                    );
                }
                for (target, source) in self.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..]
                    .iter_mut()
                    .zip(&previous.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..])
                {
                    target.extend_from_slice(
                        source
                            .get(glyph_start..glyph_end)
                            .ok_or(EngineError::InvalidRequest)?,
                    );
                }
            } else {
                for target in &mut self.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..] {
                    target.resize(target.len() + glyph_count, 0.0);
                }
                for target in &mut self.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..] {
                    target.resize(target.len() + glyph_count, 0);
                }
            }
        }
        self.semantic_line_glyph_starts.push(
            u32::try_from(self.semantic_glyphs.len()).map_err(|_| EngineError::ResultTooLarge)?,
        );
        self.semantic_line_glyph_counts
            .push(u32::try_from(semantic_count).map_err(|_| EngineError::ResultTooLarge)?);
        self.semantic_line_inline_extents.push(
            *previous
                .semantic_line_inline_extents
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.semantic_glyphs.extend_from_slice(
            previous
                .semantic_glyphs
                .get(semantic_start..semantic_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        Ok(())
    }

    fn retain_static_glyph_state(
        &mut self,
        previous: &Self,
    ) -> Result<RetainedInstanceCursor, EngineError> {
        if !self.glyphs.is_empty()
            || !self.semantic_glyphs.is_empty()
            || previous.text_effects != self.text_effects
            || !previous.decorations.is_empty()
            || previous.semantic_f32[..SEMANTIC_F32_BASE_FIELD_COUNT]
                .iter()
                .any(|field| field.len() != previous.glyphs.len())
            || previous.semantic_u32[..SEMANTIC_U32_BASE_FIELD_COUNT]
                .iter()
                .any(|field| field.len() != previous.glyphs.len())
            || (self.text_effects
                && (previous.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..]
                    .iter()
                    .any(|field| field.len() != previous.glyphs.len())
                    || previous.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..]
                        .iter()
                        .any(|field| field.len() != previous.glyphs.len())))
        {
            return Err(EngineError::InvalidRequest);
        }
        self.glyphs.extend_from_slice(&previous.glyphs);
        self.semantic_glyphs
            .extend_from_slice(&previous.semantic_glyphs);
        for (target, source) in self.semantic_f32.iter_mut().zip(&previous.semantic_f32) {
            target.extend_from_slice(source);
        }
        for (target, source) in self.semantic_u32.iter_mut().zip(&previous.semantic_u32) {
            target.extend_from_slice(source);
        }
        Ok(RetainedInstanceCursor {
            semantic_next: 0,
            semantic_end: self.semantic_glyphs.len(),
            rendered_next: 0,
            rendered_end: self.glyphs.len(),
        })
    }

    pub(crate) fn clear(&mut self) {
        self.decorations.clear();
        self.replacement_runs.clear();
        self.replacement_run_local.clear();
        self.replacement_run_indices.clear();
        self.replacement_current_order.clear();
        self.replacement_previous_order.clear();
        self.glyphs.clear();
        self.line_glyph_starts.clear();
        self.line_glyph_counts.clear();
        self.line_decoration_starts.clear();
        self.line_decoration_counts.clear();
        self.semantic_glyphs.clear();
        self.semantic_line_glyph_starts.clear();
        self.semantic_line_glyph_counts.clear();
        self.semantic_line_inline_extents.clear();
        self.semantic_change_masks.clear();
        for field in &mut self.semantic_f32 {
            field.clear();
        }
        for field in &mut self.semantic_u32 {
            field.clear();
        }
        self.visual_clusters.clear();
        self.visual_levels.clear();
        self.line_levels.clear();
        self.placement.clear();
        self.recomposed_glyphs = None;
        self.text_effects = false;
        #[cfg(test)]
        {
            self.retained_static_geometry = false;
        }
    }

    pub(crate) fn decorations(&self) -> &[DecorationRecord] {
        &self.decorations
    }

    pub(crate) fn glyphs(&self) -> &[LayoutGlyph] {
        &self.glyphs
    }

    pub(crate) fn placement(&self) -> &PlacementState {
        &self.placement
    }

    pub(crate) fn replacement_runs(&self) -> &[LayoutRun] {
        &self.replacement_runs
    }

    #[cfg(test)]
    pub(crate) fn replacement_run_local(&self) -> &RunLocalArena {
        &self.replacement_run_local
    }

    pub(crate) fn bind_replacement_run_handle(
        &mut self,
        index: usize,
        canonical: RunCanonicalRevision,
        handle: RunHandle,
    ) -> Result<(), EngineError> {
        let run = self
            .replacement_runs
            .get_mut(index)
            .ok_or(EngineError::InvalidRequest)?;
        if matches!(run.source_kind, LayoutRunSourceKind::Paragraph)
            || run.canonical_revision != Some(canonical)
        {
            return Err(EngineError::InvalidRequest);
        }
        run.run_handle = Some(handle);
        Ok(())
    }

    pub(crate) fn bind_placement_run_handles(
        &mut self,
        layout_runs: &[LayoutRun],
    ) -> Result<(), EngineError> {
        self.placement
            .bind_run_handles(layout_runs, &self.replacement_runs)
    }

    fn rebuild_replacement_runs(
        &mut self,
        previous: &Self,
        current_shape: &BoundaryShapeArena,
        previous_shape: &BoundaryShapeArena,
        current_runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        let capacity = current_shape
            .records
            .len()
            .checked_mul(2)
            .ok_or(EngineError::ResultTooLarge)?;
        self.replacement_runs
            .try_reserve(capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_run_indices
            .try_reserve(current_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_current_order
            .try_reserve(current_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_previous_order
            .try_reserve(previous_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for index in 0..current_shape.records.len() {
            self.replacement_current_order
                .push(u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?);
        }
        for index in 0..previous_shape.records.len() {
            self.replacement_previous_order
                .push(u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?);
        }
        self.replacement_current_order
            .sort_unstable_by_key(|index| {
                (
                    current_shape.records[*index as usize].flow_thread_id,
                    *index,
                )
            });
        self.replacement_previous_order
            .sort_unstable_by_key(|index| {
                (
                    previous_shape.records[*index as usize].flow_thread_id,
                    *index,
                )
            });
        if self.replacement_current_order.windows(2).any(|pair| {
            current_shape.records[pair[0] as usize].flow_thread_id
                == current_shape.records[pair[1] as usize].flow_thread_id
        }) || self.replacement_previous_order.windows(2).any(|pair| {
            previous_shape.records[pair[0] as usize].flow_thread_id
                == previous_shape.records[pair[1] as usize].flow_thread_id
        }) {
            return Err(EngineError::InvalidRequest);
        }
        self.replacement_run_indices
            .resize(current_shape.records.len(), [None; 2]);
        let mut revision_cursor = *next_revision;
        let mut previous_order_index = 0usize;
        for current_boundary_index in self.replacement_current_order.iter().copied() {
            let boundary = current_shape.records[current_boundary_index as usize];
            while self
                .replacement_previous_order
                .get(previous_order_index)
                .is_some_and(|index| {
                    previous_shape.records[*index as usize].flow_thread_id < boundary.flow_thread_id
                })
            {
                previous_order_index += 1;
            }
            let previous_boundary_index = self
                .replacement_previous_order
                .get(previous_order_index)
                .copied()
                .filter(|index| {
                    previous_shape.records[*index as usize].flow_thread_id
                        == boundary.flow_thread_id
                });
            let previous_boundary =
                previous_boundary_index.map(|index| previous_shape.records[index as usize]);
            let mut run_indices = [None; 2];
            for role in [BoundaryRunRole::BoundarySource, BoundaryRunRole::Ellipsis] {
                let Some(spec) = BoundaryRunSpec::from_boundary(boundary, role) else {
                    continue;
                };
                let role_index = boundary_role_index(role);
                let previous_run = previous_boundary_index
                    .and_then(|index| previous.replacement_run_indices.get(index as usize))
                    .and_then(|indices| indices[role_index])
                    .and_then(|index| previous.replacement_runs.get(index as usize))
                    .filter(|run| run.source_kind == spec.source_kind);
                let previous_spec = previous_boundary
                    .and_then(|candidate| BoundaryRunSpec::from_boundary(candidate, role))
                    .filter(|candidate| candidate.source_kind == spec.source_kind);
                let retained =
                    if let (Some(run), Some(previous_spec)) = (previous_run, previous_spec) {
                        same_boundary_run(
                            spec,
                            previous_spec,
                            current_shape,
                            previous_shape,
                            current_runs,
                            previous_runs,
                        )?
                        .then_some(run.canonical_revision)
                        .flatten()
                    } else {
                        None
                    };
                let canonical_revision = retained
                    .map(Ok)
                    .unwrap_or_else(|| RunCanonicalRevision::allocate(&mut revision_cursor))?;
                let run_index = u32::try_from(self.replacement_runs.len())
                    .map_err(|_| EngineError::ResultTooLarge)?;
                self.replacement_runs.push(LayoutRun {
                    source_kind: spec.source_kind,
                    cluster_start: spec.cluster_start,
                    cluster_end: spec.cluster_end,
                    glyph_start: spec.glyph_start,
                    glyph_count: spec.glyph_count,
                    source_run: spec.source_run,
                    font_handle: spec.font_handle,
                    numeric_blocks: Default::default(),
                    canonical_revision: Some(canonical_revision),
                    run_handle: None,
                });
                run_indices[role_index] = Some(run_index);
            }
            self.replacement_run_indices[current_boundary_index as usize] = run_indices;
            if previous_boundary.is_some() {
                previous_order_index += 1;
            }
        }
        *next_revision = revision_cursor;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn rebuild_replacement_run_local(
        &mut self,
        boundary_shape: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        let mut run_local = core::mem::take(&mut self.replacement_run_local);
        run_local.clear();
        let result = (|| {
            for (boundary_index, boundary) in boundary_shape.records.iter().copied().enumerate() {
                for role in [BoundaryRunRole::BoundarySource, BoundaryRunRole::Ellipsis] {
                    let Some(run_index) = self
                        .replacement_run_indices
                        .get(boundary_index)
                        .and_then(|indices| indices[boundary_role_index(role)])
                    else {
                        continue;
                    };
                    let run_index =
                        usize::try_from(run_index).map_err(|_| EngineError::InvalidRequest)?;
                    let run = self
                        .replacement_runs
                        .get(run_index)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?;
                    let mut writer = run_local.begin_run();
                    append_boundary_run_local(
                        &mut writer,
                        run,
                        role,
                        boundary,
                        boundary_shape,
                        text,
                        clusters,
                        runs,
                        styles,
                        metrics_for,
                        extents_for,
                    )?;
                    self.replacement_runs[run_index].numeric_blocks =
                        writer.finish().map_err(run_local_build_error)?;
                }
            }
            Ok(())
        })();
        if result.is_err() {
            run_local.clear();
            for run in &mut self.replacement_runs {
                run.numeric_blocks = Default::default();
            }
        }
        self.replacement_run_local = run_local;
        result
    }

    pub(crate) fn semantic_glyphs(&self) -> &[SemanticGlyph] {
        &self.semantic_glyphs
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

    pub(crate) fn semantic_change_masks(&self) -> &[u16] {
        &self.semantic_change_masks
    }

    pub(crate) fn semantic_f32(&self) -> [&[f32]; SEMANTIC_F32_FIELD_COUNT] {
        core::array::from_fn(|index| self.semantic_f32[index].as_slice())
    }

    pub(crate) fn semantic_u32(&self) -> [&[u32]; SEMANTIC_U32_FIELD_COUNT] {
        core::array::from_fn(|index| self.semantic_u32[index].as_slice())
    }

    #[allow(clippy::too_many_arguments)]
    fn position_fragment<const TEXT_EFFECTS: bool>(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        final_line: bool,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        visually_ltr: bool,
        indent: f64,
        controls: JustifyControls,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
        mut retained: Option<&mut RetainedInstanceCursor>,
    ) -> Result<f64, EngineError> {
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end =
            usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let boundary = if fragment.boundary_index == super::flow_composition::NO_BOUNDARY {
            None
        } else {
            Some(
                boundary_shape
                    .record(fragment.boundary_index)
                    .ok_or(EngineError::InvalidRequest)?,
            )
        };
        let retained_cluster_end = boundary.map_or(cluster_end, |boundary| {
            usize::try_from(boundary.cluster_start).unwrap_or(usize::MAX)
        });
        if retained_cluster_end > cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        let hanging_start = hanging_cluster_start(fragment, clusters, cluster_start, cluster_end)?;
        let visual_start = self.visual_clusters.len();
        if !visually_ltr {
            for cluster in cluster_start..retained_cluster_end {
                if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                    continue;
                }
                self.visual_clusters
                    .push(u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?);
                self.visual_levels.push(cluster_level(
                    cluster,
                    fragment.line.text_start,
                    clusters,
                    runs,
                    &self.line_levels,
                )?);
            }
            reorder_l2(
                &mut self.visual_clusters,
                &mut self.visual_levels,
                visual_start,
            );
        }

        let paragraph_level = paragraph_level_at(bidi, fragment.line.text_start);
        let hung_leads = if fragment.line.hung_advance == 0.0 {
            false
        } else {
            let hanging_end = if cluster_end > cluster_start
                && clusters.flags[cluster_end - 1] & CLUSTER_HARD_BREAK != 0
            {
                cluster_end - 1
            } else {
                cluster_end
            };
            let terminating = hanging_end
                .checked_sub(1)
                .filter(|cluster| *cluster >= cluster_start)
                .ok_or(EngineError::InvalidRequest)?;
            cluster_level(
                terminating,
                fragment.line.text_start,
                clusters,
                runs,
                &self.line_levels,
            )? & 1
                != 0
        };
        let (justify, pen_origin) = fragment_pen(
            line,
            fragment,
            final_line,
            clusters,
            cluster_start,
            cluster_end,
            indent,
            controls,
            paragraph_level,
            hung_leads,
        );
        let baseline = line.block_start + line.baseline;
        // The adjacency-order glyph stream is one equal-length column family;
        // a single admission per fragment lets every cluster's range walk the
        // columns sequentially with direct indexing — no shape-order gather.
        let stream_len = clusters.glyph_ids.len();
        if clusters.glyph_clusters.len() != stream_len
            || clusters.glyph_x_advances.len() != stream_len
            || clusters.glyph_x_offsets.len() != stream_len
            || clusters.glyph_y_offsets.len() != stream_len
            || clusters.glyph_shape_flags.len() != stream_len
            || clusters.glyph_stable_ids.len() != stream_len
        {
            return Err(EngineError::InvalidRequest);
        }
        let streams = GlyphStreams {
            ids: &clusters.glyph_ids[..stream_len],
            clusters: &clusters.glyph_clusters[..stream_len],
            shape_flags: &clusters.glyph_shape_flags[..stream_len],
            stable_ids: &clusters.glyph_stable_ids[..stream_len],
        };
        let mut state = FragmentPositionState {
            cursor: pen_origin,
            baseline,
            decorated_run: None,
            space_ordinal: 0,
            gap_ordinal: 0,
        };
        let layout_run_order = visually_ltr && paragraph_level & 1 == 0;
        if layout_run_order {
            if justify.is_zero() {
                self.position_layout_run_fragment::<TEXT_EFFECTS, false>(
                    line,
                    fragment,
                    cluster_start,
                    retained_cluster_end,
                    hanging_start,
                    clusters,
                    runs,
                    styles,
                    &streams,
                    justify,
                    &mut state,
                    metrics_for,
                    extents_for,
                    retained.as_deref_mut(),
                )?;
            } else {
                self.position_layout_run_fragment::<TEXT_EFFECTS, true>(
                    line,
                    fragment,
                    cluster_start,
                    retained_cluster_end,
                    hanging_start,
                    clusters,
                    runs,
                    styles,
                    &streams,
                    justify,
                    &mut state,
                    metrics_for,
                    extents_for,
                    retained.as_deref_mut(),
                )?;
            }
        } else {
            let visual_count = if visually_ltr {
                retained_cluster_end.saturating_sub(cluster_start)
            } else {
                self.visual_clusters.len().saturating_sub(visual_start)
            };
            for ordinal in 0..visual_count {
                let cluster = if visually_ltr {
                    cluster_start + ordinal
                } else {
                    usize::try_from(self.visual_clusters[visual_start + ordinal])
                        .map_err(|_| EngineError::InvalidRequest)?
                };
                let role = if cluster >= hanging_start && cluster < retained_cluster_end {
                    SliceRole::HangingSpace
                } else {
                    SliceRole::Ordinary
                };
                let occurrence = if CAPTURE_RUN_PLACEMENT {
                    let run_index = clusters
                        .layout_runs()
                        .partition_point(|run| run.cluster_end <= cluster as u32);
                    let layout_run = clusters
                        .layout_runs()
                        .get(run_index)
                        .filter(|run| run.cluster_start <= cluster as u32)
                        .ok_or(EngineError::InvalidRequest)?;
                    let direction = runs[usize::try_from(layout_run.source_run)
                        .map_err(|_| EngineError::InvalidRequest)?]
                    .direction;
                    let placement_cluster =
                        clusters.placement_cluster(*layout_run, direction, cluster)?;
                    self.record_layout_run_segment(
                        self.placement_fragment_index,
                        run_index,
                        layout_run,
                        cluster,
                        cluster + 1,
                        clusters,
                        placement_cluster,
                        false,
                        state.cursor,
                        state.baseline,
                    )?
                } else {
                    PlacementOccurrence {
                        segment_index: u32::MAX,
                        translation_inline: 0.0,
                        translation_block: 0.0,
                    }
                };
                if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                    continue;
                }
                let style_index = usize::try_from(clusters.style_indexes[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?;
                let style = styles
                    .get(style_index)
                    .ok_or(EngineError::InvalidRequest)?
                    .style;
                let geometry = RunGeometry::for_values(
                    clusters.font_handles[cluster],
                    clusters.units_per_em[cluster],
                    style.font_size,
                    style.baseline_shift,
                )?;
                let positioned = self.position_cluster::<TEXT_EFFECTS>(
                    line,
                    fragment,
                    cluster,
                    clusters,
                    runs,
                    &streams,
                    geometry,
                    style,
                    &mut state,
                    occurrence,
                    role,
                    retained.as_deref_mut(),
                    extents_for,
                )?;
                self.finish_positioned_cluster::<true>(
                    line,
                    cluster,
                    clusters,
                    positioned,
                    justify,
                    &mut state,
                    metrics_for,
                    retained.is_none(),
                )?;
            }
            if !visually_ltr {
                for cluster in cluster_start..retained_cluster_end {
                    if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                        continue;
                    }
                    let run_index = clusters
                        .layout_runs()
                        .partition_point(|run| run.cluster_end <= cluster as u32);
                    let layout_run = clusters
                        .layout_runs()
                        .get(run_index)
                        .filter(|run| run.cluster_start <= cluster as u32)
                        .ok_or(EngineError::InvalidRequest)?;
                    if CAPTURE_RUN_PLACEMENT {
                        let direction = runs[usize::try_from(layout_run.source_run)
                            .map_err(|_| EngineError::InvalidRequest)?]
                        .direction;
                        let placement_cluster =
                            clusters.placement_cluster(*layout_run, direction, cluster)?;
                        self.record_layout_run_segment(
                            self.placement_fragment_index,
                            run_index,
                            layout_run,
                            cluster,
                            cluster + 1,
                            clusters,
                            placement_cluster,
                            false,
                            state.cursor,
                            state.baseline,
                        )?;
                    }
                }
            }
        }
        if state.decorated_run.is_some() {
            self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
        }
        if let Some(boundary) = boundary {
            let _ = self.position_boundary::<TEXT_EFFECTS>(
                line,
                fragment.boundary_index,
                boundary,
                state.cursor,
                baseline,
                text,
                clusters,
                runs,
                styles,
                boundary_shape,
                metrics_for,
                extents_for,
                retained,
            )?;
        }
        Ok(indent
            + fragment.line.advance
            + super::layout_units::scaled_from_layout_units(justify.total_units()))
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg_attr(
        any(test, feature = "kernel-lab"),
        allow(clippy::explicit_counter_loop)
    )]
    fn position_layout_run_fragment<const TEXT_EFFECTS: bool, const ADJUST: bool>(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        cluster_start: usize,
        cluster_end: usize,
        hanging_start: usize,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        streams: &GlyphStreams<'_>,
        justify: JustifyDistribution,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
        mut retained: Option<&mut RetainedInstanceCursor>,
    ) -> Result<(), EngineError> {
        let layout_runs = clusters.layout_runs();
        let first =
            layout_runs.partition_point(|run| run.cluster_end <= fragment.line.cluster_start);
        let mut covered = cluster_start;
        for (layout_run_index, layout_run) in (first..).zip(&layout_runs[first..]) {
            let run_start = usize::try_from(layout_run.cluster_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            if run_start >= cluster_end {
                break;
            }
            let run_end =
                usize::try_from(layout_run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
            let overlap_start = run_start.max(cluster_start);
            let overlap_end = run_end.min(cluster_end);
            if overlap_start != covered || overlap_start >= overlap_end {
                return Err(EngineError::InvalidRequest);
            }
            let direction = usize::try_from(layout_run.source_run)
                .ok()
                .and_then(|source| runs.get(source))
                .map(|run| run.direction)
                .or_else(|| (layout_run.glyph_count == 0).then_some(0))
                .ok_or(EngineError::InvalidRequest)?;
            let mut word_break_cursor = usize::MAX;
            let Some(geometry_cluster) = (overlap_start..overlap_end)
                .find(|cluster| clusters.flags[*cluster] & CLUSTER_HARD_BREAK == 0)
            else {
                if CAPTURE_RUN_PLACEMENT {
                    for cluster in overlap_start..overlap_end {
                        let (placement_cluster, _) = clusters.placement_segment_monotone(
                            *layout_run,
                            direction,
                            cluster,
                            &mut word_break_cursor,
                        )?;
                        self.record_layout_run_segment(
                            self.placement_fragment_index,
                            layout_run_index,
                            layout_run,
                            cluster,
                            cluster + 1,
                            clusters,
                            placement_cluster,
                            true,
                            state.cursor,
                            state.baseline,
                        )?;
                    }
                }
                covered = overlap_end;
                continue;
            };
            let geometry = RunGeometry::for_cluster(clusters, styles, geometry_cluster)?;
            debug_assert_eq!(layout_run.font_handle, geometry.font_handle);
            if !CAPTURE_RUN_PLACEMENT {
                for cluster in overlap_start..overlap_end {
                    if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                        continue;
                    }
                    debug_assert_eq!(clusters.font_handles[cluster], geometry.font_handle);
                    debug_assert_eq!(
                        clusters.units_per_em[cluster].to_bits(),
                        geometry.units_per_em.to_bits()
                    );
                    let style_index = usize::try_from(clusters.style_indexes[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?;
                    let style = styles
                        .get(style_index)
                        .ok_or(EngineError::InvalidRequest)?
                        .style;
                    debug_assert_eq!(style.font_size.to_bits(), geometry.font_size.to_bits());
                    debug_assert_eq!(
                        style.baseline_shift.to_bits(),
                        geometry.baseline_shift.to_bits()
                    );
                    let role = if cluster >= hanging_start {
                        SliceRole::HangingSpace
                    } else {
                        SliceRole::Ordinary
                    };
                    let positioned = self.position_cluster::<TEXT_EFFECTS>(
                        line,
                        fragment,
                        cluster,
                        clusters,
                        runs,
                        streams,
                        geometry,
                        style,
                        state,
                        PlacementOccurrence {
                            segment_index: u32::MAX,
                            translation_inline: 0.0,
                            translation_block: 0.0,
                        },
                        role,
                        retained.as_deref_mut(),
                        extents_for,
                    )?;
                    self.finish_positioned_cluster::<ADJUST>(
                        line,
                        cluster,
                        clusters,
                        positioned,
                        justify,
                        state,
                        metrics_for,
                        retained.is_none(),
                    )?;
                }
                covered = overlap_end;
                continue;
            }
            let mut cluster = overlap_start;
            while cluster < overlap_end {
                let segment_start = cluster;
                let segment_role = if segment_start >= hanging_start {
                    SliceRole::HangingSpace
                } else {
                    SliceRole::Ordinary
                };
                let (placement_cluster, stable_segment_end) = clusters.placement_segment_monotone(
                    *layout_run,
                    direction,
                    segment_start,
                    &mut word_break_cursor,
                )?;
                let mut segment_end = segment_start + 1;
                if !ADJUST
                    && direction & 1 == 0
                    && clusters.flags[segment_start] & CLUSTER_HARD_BREAK == 0
                {
                    segment_end = stable_segment_end.min(overlap_end);
                    if segment_start < hanging_start {
                        segment_end = segment_end.min(hanging_start);
                    }
                }
                let occurrence = self.record_layout_run_segment(
                    self.placement_fragment_index,
                    layout_run_index,
                    layout_run,
                    segment_start,
                    segment_end,
                    clusters,
                    placement_cluster,
                    true,
                    state.cursor,
                    state.baseline,
                )?;
                while cluster < segment_end {
                    if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                        debug_assert_eq!(clusters.font_handles[cluster], geometry.font_handle);
                        debug_assert_eq!(
                            clusters.units_per_em[cluster].to_bits(),
                            geometry.units_per_em.to_bits()
                        );
                        let style_index = usize::try_from(clusters.style_indexes[cluster])
                            .map_err(|_| EngineError::InvalidRequest)?;
                        let style = styles
                            .get(style_index)
                            .ok_or(EngineError::InvalidRequest)?
                            .style;
                        debug_assert_eq!(style.font_size.to_bits(), geometry.font_size.to_bits());
                        debug_assert_eq!(
                            style.baseline_shift.to_bits(),
                            geometry.baseline_shift.to_bits()
                        );
                        let positioned = self.position_cluster::<TEXT_EFFECTS>(
                            line,
                            fragment,
                            cluster,
                            clusters,
                            runs,
                            streams,
                            geometry,
                            style,
                            state,
                            occurrence,
                            segment_role,
                            retained.as_deref_mut(),
                            extents_for,
                        )?;
                        self.finish_positioned_cluster::<ADJUST>(
                            line,
                            cluster,
                            clusters,
                            positioned,
                            justify,
                            state,
                            metrics_for,
                            retained.is_none(),
                        )?;
                    }
                    cluster += 1;
                }
            }
            covered = overlap_end;
        }
        if covered != cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn record_layout_run_segment(
        &mut self,
        fragment_index: u32,
        layout_run_index: usize,
        layout_run: &super::cluster_state::LayoutRun,
        overlap_start: usize,
        overlap_end: usize,
        clusters: &ClusterArena,
        placement_cluster: PlacementCluster,
        allow_dense_identity: bool,
        cursor: f64,
        baseline: f64,
    ) -> Result<PlacementOccurrence, EngineError> {
        if !CAPTURE_RUN_PLACEMENT {
            return Ok(PlacementOccurrence {
                segment_index: u32::MAX,
                translation_inline: 0.0,
                translation_block: 0.0,
            });
        }
        let run_start =
            usize::try_from(layout_run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let glyph_start = clusters.glyph_starts[overlap_start];
        let final_cluster = overlap_end - 1;
        let glyph_end = clusters.glyph_starts[final_cluster]
            .checked_add(clusters.glyph_counts[final_cluster])
            .ok_or(EngineError::ResultTooLarge)?;
        let source_glyph_start = glyph_start
            .checked_sub(layout_run.glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let source_glyph_count = glyph_end
            .checked_sub(glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let local_prefix = placement_cluster.block_local_prefix;
        let translation = SegmentTranslation {
            translation_inline: cursor - local_prefix + placement_cluster.block_anchor_inline,
            translation_block: baseline + placement_cluster.block_anchor_block,
        };
        let translation_inline = finite_f32(translation.translation_inline)?;
        let translation_block = finite_f32(translation.translation_block)?;
        let segment_index = self.placement.push_segment(
            super::placement_state::PlacementSegment {
                fragment_index,
                layout_run_owner: LayoutRunOwner::Paragraph,
                layout_run_index: u32::try_from(layout_run_index)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                run_handle: layout_run.run_handle,
                canonical_revision: layout_run.canonical_revision,
                identity: if allow_dense_identity && placement_cluster.dense {
                    PlacementIdentity::Dense
                } else {
                    PlacementIdentity::StableSource {
                        segment_anchor: placement_cluster.segment_anchor,
                        source_anchor: clusters.stable_ids[overlap_start],
                    }
                },
                segment_anchor: placement_cluster.segment_anchor,
                source_anchor: clusters.stable_ids[overlap_start],
                numeric_block_ordinal: placement_cluster.numeric_block_ordinal,
                run_cluster_start: u32::try_from(overlap_start - run_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                run_cluster_count: u32::try_from(overlap_end - overlap_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                glyph_source: GlyphSource::LayoutRun,
                source_glyph_start,
                source_glyph_count,
            },
            translation,
        )?;
        Ok(PlacementOccurrence {
            segment_index,
            translation_inline,
            translation_block,
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    fn position_cluster<const TEXT_EFFECTS: bool>(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        cluster: usize,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        streams: &GlyphStreams<'_>,
        geometry: RunGeometry,
        style: ResolvedStyle,
        state: &mut FragmentPositionState,
        occurrence: PlacementOccurrence,
        role: SliceRole,
        mut retained: Option<&mut RetainedInstanceCursor>,
        _extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<PositionedCluster, EngineError> {
        let bidi_level = cluster_level(
            cluster,
            fragment.line.text_start,
            clusters,
            runs,
            &self.line_levels,
        )?;
        let binding_handle = clusters.binding_handles[cluster];
        let font_handle = geometry.font_handle;
        let cluster_origin = state.cursor;
        let glyph_start = usize::try_from(clusters.glyph_starts[cluster])
            .map_err(|_| EngineError::InvalidRequest)?;
        let glyph_count = usize::try_from(clusters.glyph_counts[cluster])
            .map_err(|_| EngineError::InvalidRequest)?;
        let adjacency_end = glyph_start
            .checked_add(glyph_count)
            .ok_or(EngineError::InvalidRequest)?;
        if adjacency_end > streams.ids.len() {
            return Err(EngineError::InvalidRequest);
        }
        for adjacency in glyph_start..adjacency_end {
            let stable_id = streams.stable_ids[adjacency];
            let glyph_id = u32::from(streams.ids[adjacency]);
            let flags = streams.shape_flags[adjacency];
            let source_glyph = u32::try_from(adjacency).map_err(|_| EngineError::ResultTooLarge)?;
            let local = *clusters
                .run_local()
                .row_for_source_glyph(source_glyph)
                .ok_or(EngineError::InvalidRequest)?;
            if let Some(cursor) = retained.as_deref_mut() {
                self.update_retained_glyph(
                    cursor,
                    RetainedGlyphUpdate {
                        line,
                        local,
                        occurrence,
                        glyph_source: GlyphSource::LayoutRun,
                        source_glyph,
                        bidi_level,
                        role,
                        stable_id,
                        glyph_id,
                        font_handle,
                    },
                )?;
            } else {
                let origin_inline = placed_f32(local.inline_origin, occurrence.translation_inline)?;
                let origin_block = placed_f32(local.block_origin, occurrence.translation_block)?;
                let ink_inline_start =
                    placed_f32(local.ink_inline_start, occurrence.translation_inline)?;
                let ink_block_start =
                    placed_f32(local.ink_block_start, occurrence.translation_block)?;
                self.semantic_glyphs.push(SemanticGlyph {
                    stable_id,
                    font_handle,
                    cluster: streams.clusters[adjacency],
                    glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                    flags,
                    bidi_level,
                    font_size: geometry.font_size,
                    inline_origin: origin_inline,
                    block_origin: origin_block,
                    inline_advance: local.inline_advance,
                    ink_inline_start,
                    ink_block_start,
                    ink_inline_extent: local.ink_inline_extent,
                    ink_block_extent: local.ink_block_extent,
                });
                if local.has_outline {
                    self.placement.push_emitted_span(
                        occurrence.segment_index,
                        u32::try_from(self.glyphs.len())
                            .map_err(|_| EngineError::ResultTooLarge)?,
                        GlyphSource::LayoutRun,
                        source_glyph,
                        1,
                        bidi_level,
                        role,
                    )?;
                    let semantic_glyph_index = u32::try_from(self.semantic_glyphs.len() - 1)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    self.push_glyph::<TEXT_EFFECTS>(
                        LayoutGlyph {
                            stable_id,
                            content_revision: 0,
                            semantic_glyph_index,
                            binding_handle,
                            font_handle,
                            glyph_id,
                            material_id: style.material_id,
                            clip_id: line.clip_id,
                            depth_key: PAINT_LAYER_GLYPH,
                            font_size: geometry.font_size,
                            raster_pixel_ratio: style.raster_pixel_ratio,
                            inline_start: local.inline_origin,
                            block_start: local.block_origin,
                            inline_extent: local.ink_inline_extent,
                            block_extent: local.ink_block_extent,
                        },
                        ink_inline_start,
                        ink_block_start,
                        GlyphPublication {
                            style,
                            cluster: clusters.stable_ids[cluster],
                            region: line.region_id,
                            flow_thread: line.flow_thread_id,
                            transform_index: line.transform_index,
                        },
                    );
                }
            }
        }
        state.cursor = cluster_origin + clusters.advances[cluster];
        Ok(PositionedCluster {
            style,
            font_handle,
            cluster_origin,
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    fn finish_positioned_cluster<const ADJUST: bool>(
        &mut self,
        line: FlowLine,
        cluster: usize,
        clusters: &ClusterArena,
        positioned: PositionedCluster,
        justify: JustifyDistribution,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        materialize_output: bool,
    ) -> Result<(), EngineError> {
        if ADJUST {
            apply_justification(
                cluster,
                clusters,
                justify,
                &mut state.cursor,
                &mut state.space_ordinal,
                &mut state.gap_ordinal,
            );
        }
        if !materialize_output {
            return Ok(());
        }
        let PositionedCluster {
            style,
            font_handle,
            cluster_origin,
        } = positioned;
        if style.decoration_flags == 0 {
            if state.decorated_run.is_some() {
                self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
            }
        } else {
            match state.decorated_run {
                Some(ref mut run)
                    if run.font_handle == font_handle
                        && same_decoration_group(&run.style, &style) =>
                {
                    run.end = state.cursor
                }
                _ => {
                    self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
                    state.decorated_run = Some(DecoratedRun {
                        style,
                        font_handle,
                        start: cluster_origin,
                        end: state.cursor,
                    });
                }
            }
        }
        Ok(())
    }

    fn flush_decorated_run(
        &mut self,
        run: &mut Option<DecoratedRun>,
        line: FlowLine,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        let Some(run) = run.take() else {
            return Ok(());
        };
        let metrics = metrics_for(run.font_handle)
            .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
        if metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let decoration_font_size = if run.style.decoration_font_size > 0.0 {
            run.style.decoration_font_size
        } else {
            run.style.font_size
        };
        let scale = f64::from(decoration_font_size) / f64::from(metrics.units_per_em);
        let baseline = line.block_start + line.baseline;
        let inline_start = finite_f32(run.start)?;
        let inline_extent = nonnegative_f32((run.end - run.start).max(0.0))?;
        if inline_extent == 0.0 {
            return Ok(());
        }
        let style = run.style;
        let overrides = (style.decoration_offset, style.decoration_thickness);
        let emit = |flag: u32, position: i16, size: i16, arena: &mut Vec<DecorationRecord>| {
            if style.decoration_flags & flag == 0 {
                return Ok(());
            }
            let block_position = baseline - f64::from(position) * scale + f64::from(overrides.0);
            let thickness = if overrides.1 > 0.0 {
                f64::from(overrides.1)
            } else {
                f64::from(size) * scale
            };
            arena
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            arena.push(DecorationRecord {
                flags: flag,
                style: style.decoration_style,
                color: style.decoration_rgba,
                material_id: style.material_id,
                inline_start,
                inline_extent,
                block_start: finite_f32(block_position)?,
                block_extent: nonnegative_f32(thickness.max(0.0))?,
                clip_id: line.clip_id,
                region_id: line.region_id,
                flow_thread_id: line.flow_thread_id,
                transform_index: line.transform_index,
            });
            Ok(())
        };
        emit(
            super::frame::DECORATION_UNDERLINE,
            metrics.underline_position,
            metrics.underline_thickness,
            &mut self.decorations,
        )?;
        emit(
            super::frame::DECORATION_OVERLINE,
            metrics.ascender,
            metrics.underline_thickness,
            &mut self.decorations,
        )?;
        emit(
            super::frame::DECORATION_LINE_THROUGH,
            metrics.strikeout_position,
            metrics.strikeout_size,
            &mut self.decorations,
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn position_boundary<const TEXT_EFFECTS: bool>(
        &mut self,
        line: FlowLine,
        _boundary_index: u32,
        boundary: BoundaryShape,
        mut cursor: f64,
        baseline: f64,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        arena: &BoundaryShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
        mut retained: Option<&mut RetainedInstanceCursor>,
    ) -> Result<f64, EngineError> {
        let bidi_level = runs
            .get(usize::try_from(boundary.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?
            .bidi_level;
        let source_cluster =
            usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let ellipsis_cluster = usize::try_from(boundary.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?
            .saturating_sub(1)
            .max(source_cluster)
            .min(clusters.starts.len().saturating_sub(1));
        let source_occurrence = (boundary.source_glyph_count != 0)
            .then(|| {
                self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::BoundarySource,
                    source_cluster.min(clusters.starts.len().saturating_sub(1)),
                    boundary.source_glyph_start,
                    boundary.source_glyph_count,
                    cursor,
                    baseline,
                    clusters,
                )
            })
            .transpose()?;
        cursor = self.position_boundary_span::<TEXT_EFFECTS>(
            line,
            cursor,
            baseline,
            boundary.source_glyph_start,
            boundary.source_glyph_count,
            boundary.source_binding_handle,
            boundary.source_font_handle,
            bidi_level,
            None,
            source_cluster,
            arena,
            text,
            clusters,
            styles,
            metrics_for,
            extents_for,
            source_occurrence,
            SliceRole::CharacterFallback,
            retained.as_deref_mut(),
        )?;
        let replacement_occurrence = (boundary.ellipsis_glyph_count != 0)
            .then(|| {
                self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::Ellipsis,
                    ellipsis_cluster,
                    boundary.ellipsis_glyph_start,
                    boundary.ellipsis_glyph_count,
                    cursor,
                    baseline,
                    clusters,
                )
            })
            .transpose()?;
        self.position_boundary_span::<TEXT_EFFECTS>(
            line,
            cursor,
            baseline,
            boundary.ellipsis_glyph_start,
            boundary.ellipsis_glyph_count,
            boundary.ellipsis_binding_handle,
            boundary.ellipsis_font_handle,
            bidi_level,
            Some(boundary.text_end),
            ellipsis_cluster,
            arena,
            text,
            clusters,
            styles,
            metrics_for,
            extents_for,
            replacement_occurrence,
            SliceRole::BoundaryReplacement,
            retained,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_boundary_slice(
        &mut self,
        boundary_index: u32,
        flow_thread_id: u32,
        run_role: BoundaryRunRole,
        owner_cluster: usize,
        glyph_start: u32,
        glyph_count: u32,
        cursor: f64,
        baseline: f64,
        clusters: &ClusterArena,
    ) -> Result<PlacementOccurrence, EngineError> {
        if !CAPTURE_RUN_PLACEMENT {
            return Ok(PlacementOccurrence {
                segment_index: u32::MAX,
                translation_inline: 0.0,
                translation_block: 0.0,
            });
        }
        let run_index = self
            .replacement_run_indices
            .get(usize::try_from(boundary_index).map_err(|_| EngineError::InvalidRequest)?)
            .and_then(|indices| indices[boundary_role_index(run_role)])
            .ok_or(EngineError::InvalidRequest)?;
        let run = self
            .replacement_runs
            .get(usize::try_from(run_index).map_err(|_| EngineError::InvalidRequest)?)
            .filter(|run| {
                run.source_kind
                    == LayoutRunSourceKind::Boundary {
                        flow_thread_id,
                        role: run_role,
                    }
            })
            .ok_or(EngineError::InvalidRequest)?;
        if run.glyph_start != glyph_start || run.glyph_count != glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        let block_lane = usize::try_from(run.numeric_blocks.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let block_index = *self
            .replacement_run_local
            .cluster_blocks()
            .get(block_lane)
            .filter(|index| **index != u32::MAX)
            .ok_or(EngineError::InvalidRequest)?;
        let block = *self
            .replacement_run_local
            .blocks()
            .get(usize::try_from(block_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let local_prefix = *self
            .replacement_run_local
            .cluster_prefixes()
            .get(block_lane)
            .ok_or(EngineError::InvalidRequest)?;
        let translation = SegmentTranslation {
            translation_inline: cursor - local_prefix + block.anchor_inline,
            translation_block: baseline + block.anchor_block,
        };
        let translation_inline = finite_f32(translation.translation_inline)?;
        let translation_block = finite_f32(translation.translation_block)?;
        let segment_index = self.placement.push_segment(
            super::placement_state::PlacementSegment {
                fragment_index: self.placement_fragment_index,
                layout_run_owner: LayoutRunOwner::Replacement,
                layout_run_index: run_index,
                run_handle: run.run_handle,
                canonical_revision: run.canonical_revision,
                identity: PlacementIdentity::StableSource {
                    segment_anchor: clusters.stable_ids[owner_cluster],
                    source_anchor: clusters.stable_ids[owner_cluster],
                },
                segment_anchor: clusters.stable_ids[owner_cluster],
                source_anchor: clusters.stable_ids[owner_cluster],
                numeric_block_ordinal: block_index
                    .checked_sub(run.numeric_blocks.start)
                    .filter(|ordinal| *ordinal < run.numeric_blocks.count)
                    .ok_or(EngineError::InvalidRequest)?,
                run_cluster_start: 0,
                run_cluster_count: run.numeric_blocks.cluster_count,
                glyph_source: GlyphSource::Boundary,
                source_glyph_start: 0,
                source_glyph_count: glyph_count,
            },
            translation,
        )?;
        Ok(PlacementOccurrence {
            segment_index,
            translation_inline,
            translation_block,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn update_retained_glyph(
        &mut self,
        cursor: &mut RetainedInstanceCursor,
        update: RetainedGlyphUpdate,
    ) -> Result<(), EngineError> {
        if cursor.semantic_next >= cursor.semantic_end {
            return Err(EngineError::InvalidRequest);
        }
        let origin_inline = placed_f32(
            update.local.inline_origin,
            update.occurrence.translation_inline,
        )?;
        let origin_block = placed_f32(
            update.local.block_origin,
            update.occurrence.translation_block,
        )?;
        let ink_inline_start = placed_f32(
            update.local.ink_inline_start,
            update.occurrence.translation_inline,
        )?;
        let ink_block_start = placed_f32(
            update.local.ink_block_start,
            update.occurrence.translation_block,
        )?;
        let semantic = self
            .semantic_glyphs
            .get(cursor.semantic_next)
            .filter(|semantic| {
                semantic.stable_id == update.stable_id
                    && u32::from(semantic.glyph_id) == update.glyph_id
                    && semantic.font_handle == update.font_handle
            })
            .ok_or(EngineError::InvalidRequest)?;
        let semantic_index = cursor.semantic_next;
        let rendered = (cursor.rendered_next < cursor.rendered_end)
            .then(|| self.glyphs.get(cursor.rendered_next))
            .flatten()
            .filter(|glyph| usize::try_from(glyph.semantic_glyph_index) == Ok(semantic_index));
        if update.local.has_outline != rendered.is_some() {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(rendered) = rendered {
            if rendered.stable_id != semantic.stable_id {
                return Err(EngineError::InvalidRequest);
            }
            self.placement.push_emitted_span(
                update.occurrence.segment_index,
                u32::try_from(cursor.rendered_next).map_err(|_| EngineError::ResultTooLarge)?,
                update.glyph_source,
                update.source_glyph,
                1,
                update.bidi_level,
                update.role,
            )?;
            let glyph = self
                .glyphs
                .get_mut(cursor.rendered_next)
                .ok_or(EngineError::InvalidRequest)?;
            glyph.clip_id = update.line.clip_id;
            self.semantic_f32[0][cursor.rendered_next] = ink_inline_start;
            self.semantic_f32[1][cursor.rendered_next] = ink_block_start;
            self.semantic_u32[2][cursor.rendered_next] = update.line.region_id;
            self.semantic_u32[3][cursor.rendered_next] = update.line.flow_thread_id;
            self.semantic_u32[4][cursor.rendered_next] = update.line.transform_index;
            cursor.rendered_next += 1;
        }
        let semantic = self
            .semantic_glyphs
            .get_mut(semantic_index)
            .ok_or(EngineError::InvalidRequest)?;
        semantic.bidi_level = update.bidi_level;
        semantic.inline_origin = origin_inline;
        semantic.block_origin = origin_block;
        semantic.ink_inline_start = ink_inline_start;
        semantic.ink_block_start = ink_block_start;
        cursor.semantic_next += 1;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn record_retained_glyph(
        &mut self,
        cursor: &mut RetainedInstanceCursor,
        occurrence: PlacementOccurrence,
        glyph_source: GlyphSource,
        source_glyph: u32,
        bidi_level: u8,
        role: SliceRole,
        stable_id: u32,
    ) -> Result<(), EngineError> {
        if cursor.semantic_next >= cursor.semantic_end {
            return Err(EngineError::InvalidRequest);
        }
        let semantic = self
            .semantic_glyphs
            .get(cursor.semantic_next)
            .filter(|semantic| semantic.stable_id == stable_id)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic_index = cursor.semantic_next;
        let rendered = (cursor.rendered_next < cursor.rendered_end)
            .then(|| self.glyphs.get(cursor.rendered_next))
            .flatten()
            .filter(|glyph| usize::try_from(glyph.semantic_glyph_index) == Ok(semantic_index));
        if let Some(rendered) = rendered {
            if rendered.stable_id != semantic.stable_id {
                return Err(EngineError::InvalidRequest);
            }
            self.placement.push_emitted_span(
                occurrence.segment_index,
                u32::try_from(cursor.rendered_next).map_err(|_| EngineError::ResultTooLarge)?,
                glyph_source,
                source_glyph,
                1,
                bidi_level,
                role,
            )?;
            cursor.rendered_next += 1;
        }
        cursor.semantic_next += 1;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn position_boundary_span<const TEXT_EFFECTS: bool>(
        &mut self,
        line: FlowLine,
        mut cursor: f64,
        _baseline: f64,
        glyph_start: u32,
        glyph_count: u32,
        binding_handle: u32,
        font_handle: u32,
        bidi_level: u8,
        cluster_override: Option<u32>,
        fallback_cluster: usize,
        arena: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        _extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
        occurrence: Option<PlacementOccurrence>,
        role: SliceRole,
        mut retained: Option<&mut RetainedInstanceCursor>,
    ) -> Result<f64, EngineError> {
        let metrics = metrics_for(font_handle)
            .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
        if font_handle == 0 || metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let start = usize::try_from(glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::try_from(glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        for glyph in start..end {
            let glyph_id = u32::from(
                *arena
                    .shape
                    .glyph_ids
                    .get(glyph)
                    .ok_or(EngineError::InvalidRequest)?,
            );
            let shaped_cluster = *arena
                .shape
                .clusters
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            let cluster = cluster_override.unwrap_or(shaped_cluster);
            let cluster_index = if cluster_override.is_some() {
                fallback_cluster
            } else {
                clusters
                    .starts
                    .binary_search(&shaped_cluster)
                    .unwrap_or(fallback_cluster)
            };
            let style_index = usize::try_from(
                *clusters
                    .style_indexes
                    .get(cluster_index)
                    .ok_or(EngineError::InvalidRequest)?,
            )
            .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles
                .get(style_index)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
            let semantic_id = *clusters
                .stable_ids
                .get(cluster_index)
                .ok_or(EngineError::InvalidRequest)?;
            let x_advance = f64::from(
                arena
                    .shape
                    .x_advances
                    .get(glyph)
                    .copied()
                    .ok_or(EngineError::InvalidRequest)?,
            )
            .abs()
                * scale;
            let stable_id = *arena
                .stable_ids
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            let flags = *arena
                .shape
                .glyph_flags
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            if retained.is_none() {
                let local = self
                    .replacement_run_local
                    .row_for_source_glyph(
                        u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
                    )
                    .ok_or(EngineError::InvalidRequest)?;
                let occurrence = occurrence.ok_or(EngineError::InvalidRequest)?;
                let origin_inline = placed_f32(local.inline_origin, occurrence.translation_inline)?;
                let origin_block = placed_f32(local.block_origin, occurrence.translation_block)?;
                let ink_inline_start =
                    placed_f32(local.ink_inline_start, occurrence.translation_inline)?;
                let ink_block_start =
                    placed_f32(local.ink_block_start, occurrence.translation_block)?;
                self.semantic_glyphs.push(SemanticGlyph {
                    stable_id,
                    font_handle,
                    cluster,
                    glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                    flags,
                    bidi_level,
                    font_size: style.font_size,
                    inline_origin: origin_inline,
                    block_origin: origin_block,
                    inline_advance: local.inline_advance,
                    ink_inline_start,
                    ink_block_start,
                    ink_inline_extent: local.ink_inline_extent,
                    ink_block_extent: local.ink_block_extent,
                });
                if local.has_outline {
                    self.placement.push_emitted_span(
                        occurrence.segment_index,
                        u32::try_from(self.glyphs.len())
                            .map_err(|_| EngineError::ResultTooLarge)?,
                        GlyphSource::Boundary,
                        u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
                        1,
                        bidi_level,
                        role,
                    )?;
                    let semantic_glyph_index = u32::try_from(self.semantic_glyphs.len() - 1)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    self.push_glyph::<TEXT_EFFECTS>(
                        LayoutGlyph {
                            stable_id,
                            content_revision: 0,
                            semantic_glyph_index,
                            binding_handle,
                            font_handle,
                            glyph_id,
                            material_id: style.material_id,
                            clip_id: line.clip_id,
                            depth_key: PAINT_LAYER_GLYPH,
                            font_size: style.font_size,
                            raster_pixel_ratio: style.raster_pixel_ratio,
                            inline_start: local.inline_origin,
                            block_start: local.block_origin,
                            inline_extent: local.ink_inline_extent,
                            block_extent: local.ink_block_extent,
                        },
                        ink_inline_start,
                        ink_block_start,
                        GlyphPublication {
                            style,
                            cluster: semantic_id,
                            region: line.region_id,
                            flow_thread: line.flow_thread_id,
                            transform_index: line.transform_index,
                        },
                    );
                }
            } else if let Some(cursor) = retained.as_deref_mut() {
                let occurrence = occurrence.ok_or(EngineError::InvalidRequest)?;
                self.record_retained_glyph(
                    cursor,
                    occurrence,
                    GlyphSource::Boundary,
                    u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
                    bidi_level,
                    role,
                    stable_id,
                )?;
            }
            cursor += x_advance;
            if cluster_override.is_none() {
                let next_cluster = (glyph + 1 < end)
                    .then(|| arena.shape.clusters.get(glyph + 1).copied())
                    .flatten();
                if next_cluster != Some(shaped_cluster) {
                    cursor += f64::from(style.letter_spacing);
                    if clusters
                        .starts
                        .get(cluster_index)
                        .and_then(|start| usize::try_from(*start).ok())
                        .and_then(|start| text.get(start))
                        == Some(&0x20)
                    {
                        cursor += f64::from(style.word_spacing);
                    }
                }
            }
        }
        Ok(cursor)
    }

    fn push_glyph<const TEXT_EFFECTS: bool>(
        &mut self,
        glyph: LayoutGlyph,
        ink_inline_start: f32,
        ink_block_start: f32,
        publication: GlyphPublication,
    ) {
        self.glyphs.push(glyph);
        let f32_values = [
            ink_inline_start,
            ink_block_start,
            glyph.inline_extent,
            glyph.block_extent,
            glyph.font_size,
            glyph.raster_pixel_ratio,
        ];
        for (field, value) in self.semantic_f32[..SEMANTIC_F32_BASE_FIELD_COUNT]
            .iter_mut()
            .zip(f32_values)
        {
            field.push(value);
        }
        let u32_values = [
            apply_opacity(publication.style.foreground_rgba, publication.style.opacity),
            publication.cluster,
            publication.region,
            publication.flow_thread,
            publication.transform_index,
            glyph.stable_id,
        ];
        for (field, value) in self.semantic_u32[..SEMANTIC_U32_BASE_FIELD_COUNT]
            .iter_mut()
            .zip(u32_values)
        {
            field.push(value);
        }
        if TEXT_EFFECTS {
            let inverse_font_size = 1.0 / publication.style.font_size;
            self.semantic_f32[6].push(publication.style.outline_width * inverse_font_size);
            self.semantic_f32[7].push(publication.style.shadow_offset_x * inverse_font_size);
            self.semantic_f32[8].push(publication.style.shadow_offset_y * inverse_font_size);
            self.semantic_u32[6].push(apply_opacity(
                publication.style.outline_rgba,
                publication.style.opacity,
            ));
            self.semantic_u32[7].push(apply_opacity(
                publication.style.shadow_rgba,
                publication.style.opacity,
            ));
        }
    }

    fn assign_content_revisions(
        &mut self,
        previous: &Self,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
        geometry_only: bool,
    ) -> Result<(), EngineError> {
        self.semantic_change_masks.resize(self.glyphs.len(), 0);
        if let Some(range) = self.recomposed_glyphs {
            *next_revision = (*next_revision).max(1);
            let previous_glyphs = previous
                .glyphs
                .get(range.previous_start..range.previous_end)
                .ok_or(EngineError::InvalidRequest)?;
            let next_glyphs = self
                .glyphs
                .get(range.next_start..range.next_end)
                .ok_or(EngineError::InvalidRequest)?;
            if previous_glyphs.len() == next_glyphs.len()
                && previous_glyphs
                    .iter()
                    .zip(next_glyphs)
                    .all(|(old, next)| old.stable_id == next.stable_id)
            {
                for offset in 0..next_glyphs.len() {
                    self.assign_content_revision(
                        range.next_start + offset,
                        previous,
                        Some(range.previous_start + offset),
                        next_revision,
                    )?;
                }
                return Ok(());
            }
            index
                .prepare(previous_glyphs.len())
                .map_err(identity_index_error)?;
            for (offset, glyph) in previous_glyphs.iter().enumerate() {
                index
                    .insert(
                        glyph.stable_id,
                        u32::try_from(range.previous_start + offset)
                            .map_err(|_| EngineError::ResultTooLarge)?,
                    )
                    .map_err(identity_index_error)?;
            }
            for slot in range.next_start..range.next_end {
                let previous_slot = index
                    .get(self.glyphs[slot].stable_id)
                    .and_then(|value| usize::try_from(value).ok());
                self.assign_content_revision(slot, previous, previous_slot, next_revision)?;
            }
            return Ok(());
        }
        if self.glyphs.len() == previous.glyphs.len()
            && self
                .glyphs
                .iter()
                .zip(&previous.glyphs)
                .all(|(next, old)| next.stable_id == old.stable_id)
        {
            *next_revision = (*next_revision).max(1);
            if geometry_only {
                self.assign_geometry_revisions(previous, next_revision)?;
            } else {
                for slot in 0..self.glyphs.len() {
                    self.assign_content_revision(slot, previous, Some(slot), next_revision)?;
                }
            }
            return Ok(());
        }
        index
            .prepare(previous.glyphs.len())
            .map_err(identity_index_error)?;
        for (slot, glyph) in previous.glyphs.iter().enumerate() {
            index
                .insert(
                    glyph.stable_id,
                    u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        *next_revision = (*next_revision).max(1);
        for slot in 0..self.glyphs.len() {
            let previous_slot = index
                .get(self.glyphs[slot].stable_id)
                .and_then(|value| usize::try_from(value).ok());
            self.assign_content_revision(slot, previous, previous_slot, next_revision)?;
        }
        Ok(())
    }

    fn assign_geometry_revisions(
        &mut self,
        previous: &Self,
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        for slot in 0..self.glyphs.len() {
            let mut mask = 0;
            for field in 0..2 {
                if self.semantic_f32[field][slot].to_bits()
                    != previous.semantic_f32[field][slot].to_bits()
                {
                    mask |= 1 << field;
                }
            }
            for field in 2..5 {
                if self.semantic_u32[field][slot] != previous.semantic_u32[field][slot] {
                    mask |= 1 << (SEMANTIC_F32_CHANGE_FIELD_COUNT + field);
                }
            }
            let next_glyph = self.glyphs[slot];
            let old_glyph = previous.glyphs[slot];
            if next_glyph.clip_id != old_glyph.clip_id {
                mask = ALL_SEMANTIC_CHANGES;
            } else {
                if next_glyph.inline_start.to_bits() != old_glyph.inline_start.to_bits() {
                    mask |= 1 << 6;
                }
                if next_glyph.block_start.to_bits() != old_glyph.block_start.to_bits() {
                    mask |= 1 << 7;
                }
                if placement_changed(&self.placement, slot, &previous.placement, slot) {
                    mask |= SEMANTIC_PLACEMENT_CHANGE;
                }
            }
            self.assign_content_revision_with_mask(
                slot,
                previous,
                Some(slot),
                next_revision,
                mask,
            )?;
        }
        Ok(())
    }

    fn assign_content_revision(
        &mut self,
        slot: usize,
        previous: &Self,
        previous_slot: Option<usize>,
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        let change_mask = previous_slot.map_or(ALL_SEMANTIC_CHANGES, |previous_slot| {
            self.semantic_change_mask(slot, previous, previous_slot)
        });
        self.assign_content_revision_with_mask(
            slot,
            previous,
            previous_slot,
            next_revision,
            change_mask,
        )
    }

    fn assign_content_revision_with_mask(
        &mut self,
        slot: usize,
        previous: &Self,
        previous_slot: Option<usize>,
        next_revision: &mut u32,
        change_mask: u16,
    ) -> Result<(), EngineError> {
        let revision = if change_mask == 0 {
            previous.glyphs[previous_slot.expect("zero change requires a previous glyph")]
                .content_revision
        } else {
            let revision = *next_revision;
            *next_revision = next_revision
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            revision
        };
        if revision == 0 {
            return Err(EngineError::ResultTooLarge);
        }
        self.glyphs[slot].content_revision = revision;
        *self
            .semantic_change_masks
            .get_mut(slot)
            .ok_or(EngineError::InvalidRequest)? = change_mask;
        Ok(())
    }

    fn semantic_change_mask(&self, slot: usize, previous: &Self, previous_slot: usize) -> u16 {
        let next = self.glyphs[slot];
        let old = previous.glyphs[previous_slot];
        if next.stable_id != old.stable_id
            || next.font_handle != old.font_handle
            || next.binding_handle != old.binding_handle
            || next.glyph_id != old.glyph_id
            || next.material_id != old.material_id
            || next.clip_id != old.clip_id
            || next.depth_key != old.depth_key
        {
            return ALL_SEMANTIC_CHANGES;
        }
        let mut mask = 0_u16;
        for field in 0..SEMANTIC_F32_BASE_FIELD_COUNT {
            if self.semantic_f32[field][slot].to_bits()
                != previous.semantic_f32[field][previous_slot].to_bits()
            {
                mask |= 1 << field;
            }
        }
        if next.inline_start.to_bits() != old.inline_start.to_bits() {
            mask |= 1 << 6;
        }
        if next.block_start.to_bits() != old.block_start.to_bits() {
            mask |= 1 << 7;
        }
        if placement_changed(&self.placement, slot, &previous.placement, previous_slot) {
            mask |= SEMANTIC_PLACEMENT_CHANGE;
        }
        for field in 0..SEMANTIC_U32_BASE_FIELD_COUNT {
            if self.semantic_u32[field][slot] != previous.semantic_u32[field][previous_slot] {
                mask |= 1 << (SEMANTIC_F32_CHANGE_FIELD_COUNT + field);
            }
        }
        if self.text_effects != previous.text_effects
            || (self.text_effects
                && (self.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..]
                    .iter()
                    .zip(&previous.semantic_f32[SEMANTIC_F32_BASE_FIELD_COUNT..])
                    .any(|(next, old)| next[slot].to_bits() != old[previous_slot].to_bits())
                    || self.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..]
                        .iter()
                        .zip(&previous.semantic_u32[SEMANTIC_U32_BASE_FIELD_COUNT..])
                        .any(|(next, old)| next[slot] != old[previous_slot])))
        {
            mask |= SEMANTIC_EFFECTS_CHANGE;
        }
        mask
    }
}

fn placement_changed(
    next: &PlacementState,
    next_glyph: usize,
    previous: &PlacementState,
    previous_glyph: usize,
) -> bool {
    match (
        next.glyph_translation(next_glyph),
        previous.glyph_translation(previous_glyph),
    ) {
        (Some(next), Some(previous)) => {
            next.translation_inline.to_bits() != previous.translation_inline.to_bits()
                || next.translation_block.to_bits() != previous.translation_block.to_bits()
        }
        (None, None) => false,
        _ => true,
    }
}

#[allow(clippy::too_many_arguments)]
fn append_boundary_run_local(
    writer: &mut RunLocalWriter<'_>,
    run: LayoutRun,
    role: BoundaryRunRole,
    boundary: BoundaryShape,
    arena: &BoundaryShapeArena,
    text: &[u16],
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    let shaping_run = runs
        .get(usize::try_from(run.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .copied()
        .ok_or(EngineError::InvalidRequest)?;
    let start = usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let source_cluster =
        usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let ellipsis_cluster = usize::try_from(boundary.cluster_end)
        .map_err(|_| EngineError::InvalidRequest)?
        .saturating_sub(1)
        .max(source_cluster)
        .min(clusters.starts.len().saturating_sub(1));
    if role == BoundaryRunRole::Ellipsis {
        let style = boundary_cluster_style(styles, clusters, ellipsis_cluster)?;
        writer.begin_cluster().map_err(run_local_build_error)?;
        for glyph in start..end {
            push_boundary_run_local_glyph(
                writer,
                arena,
                glyph,
                run.font_handle,
                style,
                metrics_for,
                extents_for,
            )?;
        }
        return writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: 0.0,
                word_spacing: None,
            })
            .map_err(run_local_build_error);
    }

    let fallback_cluster = source_cluster.min(clusters.starts.len().saturating_sub(1));
    let mut mapping_cluster = if shaping_run.direction & 1 == 0 {
        fallback_cluster
    } else {
        ellipsis_cluster
    };
    let mut glyph = start;
    while glyph < end {
        let shaped_cluster = *arena
            .shape
            .clusters
            .get(glyph)
            .ok_or(EngineError::InvalidRequest)?;
        if shaping_run.direction & 1 == 0 {
            while clusters
                .starts
                .get(mapping_cluster)
                .is_some_and(|start| *start < shaped_cluster)
                && mapping_cluster + 1 < clusters.starts.len()
            {
                mapping_cluster += 1;
            }
        } else {
            while clusters
                .starts
                .get(mapping_cluster)
                .is_some_and(|start| *start > shaped_cluster)
                && mapping_cluster != 0
            {
                mapping_cluster -= 1;
            }
        }
        let cluster = clusters
            .starts
            .get(mapping_cluster)
            .filter(|start| **start == shaped_cluster)
            .map_or(fallback_cluster, |_| mapping_cluster);
        let style = boundary_cluster_style(styles, clusters, cluster)?;
        writer.begin_cluster().map_err(run_local_build_error)?;
        loop {
            push_boundary_run_local_glyph(
                writer,
                arena,
                glyph,
                run.font_handle,
                style,
                metrics_for,
                extents_for,
            )?;
            glyph += 1;
            if glyph == end || arena.shape.clusters.get(glyph).copied() != Some(shaped_cluster) {
                break;
            }
        }
        let word_spacing = clusters
            .starts
            .get(cluster)
            .and_then(|start| usize::try_from(*start).ok())
            .and_then(|start| text.get(start))
            .filter(|unit| **unit == 0x20)
            .map(|_| style.word_spacing);
        writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: style.letter_spacing,
                word_spacing,
            })
            .map_err(run_local_build_error)?;
    }
    Ok(())
}

fn boundary_cluster_style(
    styles: &[StyleSegment],
    clusters: &ClusterArena,
    cluster: usize,
) -> Result<ResolvedStyle, EngineError> {
    styles
        .get(
            clusters
                .style_indexes
                .get(cluster)
                .copied()
                .and_then(|index| usize::try_from(index).ok())
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map(|segment| segment.style)
        .ok_or(EngineError::InvalidRequest)
}

#[allow(clippy::too_many_arguments)]
fn push_boundary_run_local_glyph(
    writer: &mut RunLocalWriter<'_>,
    arena: &BoundaryShapeArena,
    glyph: usize,
    font_handle: u32,
    style: ResolvedStyle,
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    let metrics =
        metrics_for(font_handle).ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let glyph_id = u32::from(
        *arena
            .shape
            .glyph_ids
            .get(glyph)
            .ok_or(EngineError::InvalidRequest)?,
    );
    writer
        .push_glyph(RunLocalGlyphInput {
            source_glyph: u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
            x_advance: *arena
                .shape
                .x_advances
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            x_offset: *arena
                .shape
                .x_offsets
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            y_offset: *arena
                .shape
                .y_offsets
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            baseline_shift: style.baseline_shift,
            scale: f64::from(style.font_size) / f64::from(metrics.units_per_em),
            outline: extents_for(font_handle, glyph_id),
        })
        .map_err(run_local_build_error)
}

fn run_local_build_error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
    }
}

const fn boundary_role_index(role: BoundaryRunRole) -> usize {
    match role {
        BoundaryRunRole::BoundarySource => 0,
        BoundaryRunRole::Ellipsis => 1,
    }
}

#[inline]
fn apply_justification(
    cluster: usize,
    clusters: &ClusterArena,
    justify: JustifyDistribution,
    cursor: &mut f64,
    space_ordinal: &mut i64,
    gap_ordinal: &mut i64,
) {
    if clusters.flags[cluster] & CLUSTER_SPACE != 0
        && cluster < justify.gap_end
        && *space_ordinal < i64::from(justify.spaces)
        && (justify.per_space_units != 0 || justify.extra_space_units != 0)
    {
        let units = justify.per_space_units + i64::from(*space_ordinal < justify.extra_space_units);
        *cursor += super::layout_units::scaled_from_layout_units(units);
        *space_ordinal += 1;
    }
    if cluster < justify.gap_end
        && *gap_ordinal < i64::from(justify.gaps)
        && (justify.per_gap_units != 0 || justify.extra_gap_units != 0)
    {
        let units = justify.per_gap_units + i64::from(*gap_ordinal < justify.extra_gap_units);
        *cursor += super::layout_units::scaled_from_layout_units(units);
        *gap_ordinal += 1;
    }
}

fn apply_opacity(rgba: u32, opacity: f32) -> u32 {
    let alpha = ((rgba >> 24) & 0xff) as f32;
    let resolved = (alpha * opacity + 0.5) as u32;
    (rgba & 0x00ff_ffff) | (resolved << 24)
}

fn style_has_text_effects(style: ResolvedStyle) -> bool {
    style.outline_rgba != 0
        || style.outline_width != 0.0
        || style.shadow_rgba != 0
        || style.shadow_offset_x != 0.0
        || style.shadow_offset_y != 0.0
}

fn line_span_start(starts: &[u32], line: usize) -> Result<usize, EngineError> {
    starts
        .get(line)
        .copied()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(EngineError::InvalidRequest)
}

fn line_span_end(starts: &[u32], counts: &[u32], line_end: usize) -> Result<usize, EngineError> {
    let line = line_end.checked_sub(1).ok_or(EngineError::InvalidRequest)?;
    let start = line_span_start(starts, line)?;
    let count = counts
        .get(line)
        .copied()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(EngineError::InvalidRequest)?;
    start.checked_add(count).ok_or(EngineError::InvalidRequest)
}

fn line_fragments(flow: &FlowLayoutArena, line: FlowLine) -> Result<&[FlowFragment], EngineError> {
    let start = usize::try_from(line.fragment_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::from(line.fragment_count))
        .ok_or(EngineError::InvalidRequest)?;
    flow.fragments
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)
}

// Each argument is one independently compared positioning input. Packing them
// into a context would hide the proof boundary without reducing caller state.
#[allow(clippy::too_many_arguments)]
fn equivalent_retained_line(
    flow: &FlowLayoutArena,
    line_index: usize,
    line: FlowLine,
    previous: &FlowLayoutArena,
    cursor: &mut usize,
    clusters: &ClusterArena,
    bidi: &BidiAnalysis,
    visually_ltr: bool,
    typography: ThreadTypography,
    previous_typography: ThreadTypography,
) -> Result<Option<usize>, EngineError> {
    // Nontrivial bidi needs full positioning's visual levels to decide whether hung spaces lead.
    if !visually_ltr {
        return Ok(None);
    }
    let fragments = line_fragments(flow, line)?;
    let Some(first) = fragments.first() else {
        return Ok(None);
    };
    let cluster_start = first.line.cluster_start;
    while let Some(previous_line) = previous.lines.get(*cursor).copied() {
        let previous_fragments = line_fragments(previous, previous_line)?;
        let Some(previous_first) = previous_fragments.first() else {
            *cursor += 1;
            continue;
        };
        if previous_line.flow_thread_id != line.flow_thread_id
            || previous_first.line.cluster_start < cluster_start
        {
            *cursor += 1;
            continue;
        }
        if previous_first.line.cluster_start > cluster_start {
            return Ok(None);
        }
        let previous_index = *cursor;
        *cursor += 1;
        if previous_line.region_id != line.region_id
            || previous_line.transform_index != line.transform_index
            || previous_line.clip_id != line.clip_id
            || previous_line.align != line.align
            || previous_line.block_start.to_bits() != line.block_start.to_bits()
            || previous_line.baseline.to_bits() != line.baseline.to_bits()
            || previous_line.height.to_bits() != line.height.to_bits()
            || fragments.len() != previous_fragments.len()
        {
            return Ok(None);
        }
        let final_line = flow
            .lines
            .get(line_index + 1)
            .is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
        let previous_final_line = previous
            .lines
            .get(previous_index + 1)
            .is_none_or(|next| next.flow_thread_id != previous_line.flow_thread_id);
        if final_line != previous_final_line {
            return Ok(None);
        }
        let inputs = |source_line: FlowLine,
                      fragment: &FlowFragment,
                      typography: ThreadTypography,
                      final_line: bool| {
            let indent = if fragment.line.cluster_start == 0 {
                typography.first_line_indent
            } else {
                0.0
            };
            let (distribution, origin) = fragment_pen(
                source_line,
                *fragment,
                final_line,
                clusters,
                usize::try_from(fragment.line.cluster_start).unwrap_or(0),
                usize::try_from(fragment.line.cluster_end).unwrap_or(0),
                indent,
                typography.justify,
                paragraph_level_at(bidi, fragment.line.text_start),
                false,
            );
            (distribution, origin.to_bits(), indent.to_bits())
        };
        let same = fragments.iter().zip(previous_fragments).all(|(next, old)| {
            next.line == old.line
                && next.slot_start.to_bits() == old.slot_start.to_bits()
                && next.boundary_index == super::flow_composition::NO_BOUNDARY
                && old.boundary_index == super::flow_composition::NO_BOUNDARY
                && inputs(line, next, typography, final_line)
                    == inputs(previous_line, old, previous_typography, previous_final_line)
        });
        return Ok(same.then_some(previous_index));
    }
    Ok(None)
}

fn is_trivially_ltr(bidi: &BidiAnalysis, runs: &[ShapingRun]) -> bool {
    bidi.levels.iter().all(|level| level & 1 == 0)
        && runs.iter().all(|run| !run.style.bidi_override)
}

fn prepare_line_levels(
    target: &mut Vec<u8>,
    bidi: &BidiAnalysis,
    start: u32,
    end: u32,
) -> Result<(), EngineError> {
    target.clear();
    let start = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(end).map_err(|_| EngineError::InvalidRequest)?;
    let levels = bidi
        .levels
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)?;
    reserve(target, levels.len())?;
    target.extend_from_slice(levels);
    let paragraph = paragraph_level_at(bidi, u32::try_from(start).unwrap_or(u32::MAX));
    let classes = bidi
        .classes
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)?;
    let mut reset_from = Some(0usize);
    let mut reset_to = None;
    let mut previous_level = paragraph;
    for index in 0..target.len() {
        match classes[index] {
            BIDI_B | BIDI_S => {
                reset_to = Some(index + 1);
                reset_from.get_or_insert(index);
            }
            BIDI_WS | BIDI_FSI | BIDI_LRI | BIDI_RLI | BIDI_PDI => {
                reset_from.get_or_insert(index);
            }
            BIDI_RLE | BIDI_LRE | BIDI_RLO | BIDI_LRO | BIDI_PDF | BIDI_BN => {
                reset_from.get_or_insert(index);
                target[index] = previous_level;
            }
            _ => reset_from = None,
        }
        if let (Some(from), Some(to)) = (reset_from, reset_to) {
            target[from..to].fill(paragraph);
            reset_from = None;
            reset_to = None;
        }
        previous_level = target[index];
    }
    if let Some(from) = reset_from {
        target[from..].fill(paragraph);
    }
    Ok(())
}

fn cluster_level(
    cluster: usize,
    line_start: u32,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    line_levels: &[u8],
) -> Result<u8, EngineError> {
    let source =
        usize::try_from(clusters.source_runs[cluster]).map_err(|_| EngineError::InvalidRequest)?;
    let run = runs.get(source).ok_or(EngineError::InvalidRequest)?;
    let local = clusters.starts[cluster]
        .checked_sub(line_start)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(EngineError::InvalidRequest)?;
    let resolved = line_levels.get(local).copied().unwrap_or(run.bidi_level);
    if run.style.bidi_override {
        Ok(if resolved & 1 == run.direction & 1 {
            resolved
        } else {
            resolved.saturating_add(1)
        })
    } else {
        Ok(resolved)
    }
}

fn reorder_l2(indices: &mut [u32], levels: &mut [u8], start: usize) {
    let range = &levels[start..];
    let maximum = range.iter().copied().max().unwrap_or(0);
    let Some(lowest_odd) = range.iter().copied().filter(|level| level & 1 != 0).min() else {
        return;
    };
    for level in (lowest_odd..=maximum).rev() {
        let mut run_start = start;
        while run_start < levels.len() {
            while run_start < levels.len() && levels[run_start] < level {
                run_start += 1;
            }
            let mut run_end = run_start;
            while run_end < levels.len() && levels[run_end] >= level {
                run_end += 1;
            }
            indices[run_start..run_end].reverse();
            levels[run_start..run_end].reverse();
            run_start = run_end;
        }
    }
}

// Stage aggregation: each argument is one explicit input threaded through the
// pipeline rather than hidden mutable state, and D-244 measured outlining these
// bodies as size-neutral. Arity is the shape, not a smell.
#[allow(clippy::too_many_arguments)]
/// The per-fragment pen derivation: the justify distribution and the pen's
/// starting origin (slot start plus indent shift plus alignment offset). This
/// is the ONE definition of that arithmetic — `position_fragment` walks glyphs
/// from it, and the resize equivalence proof compares it, so the proof can
/// never drift from what positioning actually computes. The indent reserves
/// inline space on the paragraph-direction start side: the LTR pen shifts
/// right; the RTL pen keeps its origin and the reduced available width moves
/// the right edge inward instead.
fn fragment_pen(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
    indent: f64,
    controls: JustifyControls,
    paragraph_level: u8,
    hung_leads: bool,
) -> (JustifyDistribution, f64) {
    let available =
        (fragment.slot_end - fragment.slot_start - indent - fragment.line.advance).max(0.0);
    let justify = justification_adjustment(
        line,
        fragment,
        final_line,
        clusters,
        cluster_start,
        cluster_end,
        indent,
        controls,
    );
    let offset = if justify.is_zero() {
        alignment_offset(line.align, paragraph_level, available)
    } else {
        0.0
    };
    let indent_shift = if paragraph_level & 1 == 0 {
        indent
    } else {
        0.0
    };
    // A line keeps its terminating spaces but does not charge them to `advance`. Visual
    // order decides whether that is free: LTR lays them last, past the end of the line,
    // where they have no ink and no consequence. RTL lays them FIRST -- they are visually
    // leftmost -- so they occupy the pen and push every visible glyph right by their
    // width. Discounting them here puts the ink back exactly where a line with no
    // terminating space would sit, which is what makes the right edge hold still while
    // text is typed.
    let hung_shift = if hung_leads {
        fragment.line.hung_advance
    } else {
        0.0
    };
    (
        justify,
        fragment.slot_start + indent_shift + offset - hung_shift,
    )
}

/// Whether a freshly composed flow would position EXACTLY as the committed
/// flow — the geometry-only resize short-circuit (the resize analogue of the
/// D-253 measure adoption). Positioning is a deterministic function of each
/// fragment's cluster range, pen origin, and justify distribution once text,
/// styles, clusters, and bidi are unchanged (the caller's precondition), so
/// bit-equality of those computed inputs proves output equality without
/// running the positioning, gather, or publication tail. Boundary-bearing
/// (ellipsis) flows fall through to the full path.
pub(crate) fn flow_positioning_equivalent(
    pending: &FlowLayoutArena,
    committed: &FlowLayoutArena,
    clusters: &ClusterArena,
    bidi: &BidiAnalysis,
    pending_typography: impl Fn(u32) -> ThreadTypography + Copy,
    committed_typography: impl Fn(u32) -> ThreadTypography + Copy,
) -> Result<bool, EngineError> {
    if pending.lines.len() != committed.lines.len()
        || !pending.ellipsis_threads().is_empty()
        || !committed.ellipsis_threads().is_empty()
    {
        return Ok(false);
    }
    for (line_index, (line, previous)) in
        pending.lines.iter().zip(committed.lines.iter()).enumerate()
    {
        if line.flow_thread_id != previous.flow_thread_id
            || line.region_id != previous.region_id
            || line.transform_index != previous.transform_index
            || line.clip_id != previous.clip_id
            || line.fragment_count != previous.fragment_count
            || line.align != previous.align
            || line.block_start.to_bits() != previous.block_start.to_bits()
            || line.baseline.to_bits() != previous.baseline.to_bits()
            || line.height.to_bits() != previous.height.to_bits()
        {
            return Ok(false);
        }
        let final_line = pending
            .lines
            .get(line_index + 1)
            .is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
        let fragments = line_fragments(pending, *line)?;
        let previous_fragments = line_fragments(committed, *previous)?;
        if fragments.len() != previous_fragments.len() {
            return Ok(false);
        }
        for (fragment, previous_fragment) in fragments.iter().zip(previous_fragments.iter()) {
            if fragment.line != previous_fragment.line
                || fragment.boundary_index != super::flow_composition::NO_BOUNDARY
                || previous_fragment.boundary_index != super::flow_composition::NO_BOUNDARY
            {
                return Ok(false);
            }
            let inputs = |fragment: &FlowFragment, typography: ThreadTypography| {
                let indent = if fragment.line.cluster_start == 0 {
                    typography.first_line_indent
                } else {
                    0.0
                };
                let (distribution, origin) = fragment_pen(
                    *line,
                    *fragment,
                    final_line,
                    clusters,
                    usize::try_from(fragment.line.cluster_start).unwrap_or(0),
                    usize::try_from(fragment.line.cluster_end).unwrap_or(0),
                    indent,
                    typography.justify,
                    paragraph_level_at(bidi, fragment.line.text_start),
                    // This compares two pens rather than placing glyphs, and the caller's
                    // precondition is that text, styles, clusters, and bidi are unchanged --
                    // so the real predicate resolves identically on both sides. Any predicate
                    // applied to both therefore yields the same equality answer, and shaping
                    // runs are not in scope here to resolve the true one.
                    paragraph_level_at(bidi, fragment.line.text_start) & 1 != 0,
                );
                (distribution, origin.to_bits(), indent.to_bits())
            };
            let next = inputs(fragment, pending_typography(line.flow_thread_id));
            let prior = inputs(
                previous_fragment,
                committed_typography(previous.flow_thread_id),
            );
            if next != prior {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn paragraph_level_at(bidi: &BidiAnalysis, offset: u32) -> u8 {
    bidi.paragraph_starts
        .iter()
        .zip(&bidi.paragraph_ends)
        .zip(&bidi.paragraph_levels)
        .find_map(|((&start, &end), &level)| (start <= offset && offset < end).then_some(level))
        .or_else(|| bidi.paragraph_levels.last().copied())
        .unwrap_or(0)
}

fn hanging_cluster_start(
    fragment: FlowFragment,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
) -> Result<usize, EngineError> {
    if fragment.line.hung_advance == 0.0 {
        return Ok(cluster_end);
    }
    let mut hanging_end = cluster_end;
    if hanging_end > cluster_start && clusters.flags[hanging_end - 1] & CLUSTER_HARD_BREAK != 0 {
        hanging_end -= 1;
    }
    let mut start = hanging_end;
    let mut units = 0_i64;
    while start > cluster_start && clusters.flags[start - 1] & CLUSTER_SPACE != 0 {
        start -= 1;
        units = units
            .checked_add(clusters.advance_units[start])
            .ok_or(EngineError::ResultTooLarge)?;
    }
    if super::layout_units::scaled_from_layout_units(units).to_bits()
        != fragment.line.hung_advance.to_bits()
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start)
}

fn alignment_offset(align: u8, paragraph_level: u8, available: f64) -> f64 {
    match align {
        ALIGN_CENTER => available * 0.5,
        ALIGN_END if paragraph_level & 1 == 0 => available,
        ALIGN_START if paragraph_level & 1 != 0 => available,
        _ => 0.0,
    }
}

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

/// Resolve one constraint's typography for positioning and measurement.
pub(crate) fn constraint_typography(
    constraint: &super::semantic_wire::FlowConstraint,
) -> ThreadTypography {
    ThreadTypography {
        first_line_indent: f64::from(constraint.first_line_indent),
        justify: JustifyControls {
            minimum_word_space_ratio: constraint.justify_min_word_space_ratio,
            maximum_word_space_ratio: constraint.justify_max_word_space_ratio,
            letter_space_expansion: constraint.justify_letter_space_expansion,
            last_line_justify: constraint.last_line == super::frame::LAST_LINE_JUSTIFY,
        },
    }
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

impl JustifyDistribution {
    pub(crate) fn is_zero(&self) -> bool {
        self.per_space_units == 0
            && self.extra_space_units == 0
            && self.per_gap_units == 0
            && self.extra_gap_units == 0
    }

    /// The exact total the distribution adds to the line, in layout units.
    pub(crate) fn total_units(&self) -> i64 {
        self.per_space_units * i64::from(self.spaces)
            + self.extra_space_units
            + self.per_gap_units * i64::from(self.gaps)
            + self.extra_gap_units
    }
}

/// Splits an exact unit total over `count` sites: every site takes the euclidean
/// quotient and the first `remainder` sites take one more unit, in either sign.
fn distribute_units(total: i64, count: u32) -> (i64, i64) {
    if count == 0 {
        return (0, 0);
    }
    let divisor = i64::from(count);
    (total.div_euclid(divisor), total.rem_euclid(divisor))
}

struct JustifiableSpan {
    spaces: u32,
    space_advance_units: i64,
    trimmed_end: usize,
}

fn justifiable_span(clusters: &ClusterArena, start: usize, mut end: usize) -> JustifiableSpan {
    // A hard break is a zero-advance sentinel that ends the line, so the spaces behind it
    // are still the line's terminating spaces. Stopping at the sentinel would leave them
    // justifiable here while the fit hangs them, and the two stages must agree on which
    // spaces exist — that disagreement is the whole subject of D-257.
    if end > start && clusters.flags[end - 1] & CLUSTER_HARD_BREAK != 0 {
        end -= 1;
    }
    while end > start && clusters.flags[end - 1] & CLUSTER_SPACE != 0 {
        end -= 1;
    }
    let mut spaces = 0_u32;
    let mut space_advance_units = 0_i64;
    // The D-245 flag-mask kernel scans sixteen cluster flags per step on
    // simd128 builds; the visit order matches the scalar loop exactly, and the
    // integer sum matches the fit's chunk-summarized space totals.
    super::line_kernels::for_each_flagged(&clusters.flags, start, end, CLUSTER_SPACE, |cluster| {
        spaces = spaces.saturating_add(1);
        space_advance_units = space_advance_units.saturating_add(clusters.advance_units[cluster]);
    });
    JustifiableSpan {
        spaces,
        space_advance_units,
        trimmed_end: end,
    }
}

#[allow(clippy::too_many_arguments)]
fn justification_adjustment(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
    indent: f64,
    controls: JustifyControls,
) -> JustifyDistribution {
    let justified = line.align == ALIGN_JUSTIFY
        && (controls.last_line_justify || (!fragment.line.hard_break && !final_line));
    if !justified {
        return JustifyDistribution::default();
    }
    let span = justifiable_span(clusters, cluster_start, cluster_end);
    if span.spaces == 0 {
        return JustifyDistribution::default();
    }
    // ONE quantization site per fragment: the signed deficit rounds half-up into
    // layout units, and every bound below is exact integer arithmetic from here.
    let deficit_units = super::layout_units::layout_units_from_scaled(
        fragment.slot_end - fragment.slot_start - indent - fragment.line.advance,
    );
    if deficit_units >= 0 {
        // Expansion: word spaces grow up to the declared cap — the excess ratio
        // is applied once with the shared half-up layout-unit contract — then
        // the remainder spills into inter-cluster gaps bounded per gap; any
        // residue stays unfilled and the line reads as under-full.
        let space_growth = if controls.maximum_word_space_ratio > 0.0 {
            deficit_units.min(super::layout_units::apply_ratio(
                span.space_advance_units,
                f64::from(controls.maximum_word_space_ratio) - 1.0,
            ))
        } else {
            deficit_units
        };
        let gaps = u32::try_from(
            span.trimmed_end
                .saturating_sub(cluster_start)
                .saturating_sub(1),
        )
        .unwrap_or(u32::MAX);
        let remainder = deficit_units - space_growth;
        let gap_growth = if controls.letter_space_expansion > 0.0 && gaps > 0 && remainder > 0 {
            remainder.min(
                super::layout_units::layout_units_from_scaled(f64::from(
                    controls.letter_space_expansion,
                ))
                .saturating_mul(i64::from(gaps)),
            )
        } else {
            0
        };
        let (per_space_units, extra_space_units) = distribute_units(space_growth, span.spaces);
        let (per_gap_units, extra_gap_units) = distribute_units(gap_growth, gaps);
        JustifyDistribution {
            spaces: span.spaces,
            per_space_units,
            extra_space_units,
            gaps,
            per_gap_units,
            extra_gap_units,
            gap_end: span.trimmed_end,
        }
    } else if controls.minimum_word_space_ratio > 0.0 {
        // Compression: an overfull line shrinks its word spaces, never below the
        // declared minimum of their natural advance sum. The capacity applies
        // the SAME exact-ratio expression the integer fit used to admit the
        // line, so positioning can always shrink what the fit promised to
        // within the rounding contract's half unit.
        let capacity = super::layout_units::apply_ratio(
            span.space_advance_units,
            1.0 - f64::from(controls.minimum_word_space_ratio),
        );
        let shrink = (-deficit_units).min(capacity);
        let (per_space_units, extra_space_units) = distribute_units(-shrink, span.spaces);
        JustifyDistribution {
            spaces: span.spaces,
            per_space_units,
            extra_space_units,
            gaps: 0,
            per_gap_units: 0,
            extra_gap_units: 0,
            gap_end: span.trimmed_end,
        }
    } else {
        JustifyDistribution::default()
    }
}

/// The inline extent one fragment occupies: its (possibly justified) advance
/// plus the paragraph first-line indent when the fragment starts the thread.
pub(crate) fn positioned_fragment_advance(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    clusters: &ClusterArena,
    indent: f64,
    controls: JustifyControls,
) -> Result<f64, EngineError> {
    let cluster_start =
        usize::try_from(fragment.line.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let cluster_end =
        usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    let distribution = justification_adjustment(
        line,
        fragment,
        final_line,
        clusters,
        cluster_start,
        cluster_end,
        indent,
        controls,
    );
    // The distributed total is exact in layout units and dyadic in f64, so this
    // advance agrees bit-for-bit with the adjustments positioning applies.
    Ok(indent
        + fragment.line.advance
        + super::layout_units::scaled_from_layout_units(distribution.total_units()))
}

fn finite_f32(value: f64) -> Result<f32, EngineError> {
    let value = value as f32;
    value
        .is_finite()
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}

fn placed_f32(local: f32, translation: f32) -> Result<f32, EngineError> {
    let value = local + translation;
    value
        .is_finite()
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}

fn nonnegative_f32(value: f64) -> Result<f32, EngineError> {
    let value = finite_f32(value)?;
    (value >= 0.0)
        .then_some(value)
        .ok_or(EngineError::InvalidRequest)
}

fn identity_index_error(error: IdentityIndexError) -> EngineError {
    match error {
        IdentityIndexError::AllocationFailed | IdentityIndexError::ArithmeticOverflow => {
            EngineError::ResultTooLarge
        }
        IdentityIndexError::DuplicateIdentity => EngineError::InvalidRequest,
    }
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
    use super::super::{
        cluster_state::{ClusterBuildInput, RunCanonicalInput},
        shaping_state::{ShapeArena, ShapedRun},
        style_state::StyleArena,
    };
    use super::*;
    use crate::unicode::UnicodeAnalysis;

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

    #[test]
    fn retained_cursor_checks_outline_less_semantic_identity() {
        let (_, mut arena) = fixture_position_results(8, 10, |_, _, _| {});
        arena.semantic_glyphs = vec![SemanticGlyph {
            stable_id: 11,
            ..SemanticGlyph::default()
        }];
        arena.glyphs.clear();
        let occurrence = PlacementOccurrence {
            segment_index: 0,
            translation_inline: 0.0,
            translation_block: 0.0,
        };
        let mut cursor = RetainedInstanceCursor {
            semantic_next: 0,
            semantic_end: 1,
            rendered_next: 0,
            rendered_end: 0,
        };
        arena
            .record_retained_glyph(
                &mut cursor,
                occurrence,
                GlyphSource::LayoutRun,
                0,
                0,
                SliceRole::Ordinary,
                11,
            )
            .unwrap();
        assert_eq!((cursor.semantic_next, cursor.rendered_next), (1, 0));

        cursor.semantic_next = 0;
        assert!(matches!(
            arena.record_retained_glyph(
                &mut cursor,
                occurrence,
                GlyphSource::LayoutRun,
                0,
                0,
                SliceRole::Ordinary,
                12,
            ),
            Err(EngineError::InvalidRequest)
        ));
    }

    fn assert_layout_plan_producer_invariants(arena: &PositionedGlyphArena) {
        let glyph_count = arena.glyphs.len();
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
        assert_eq!(arena.semantic_change_masks.len(), glyph_count);
        for (index, field) in arena.semantic_f32.iter().enumerate() {
            assert!(
                field.len() == glyph_count
                    || (index >= SEMANTIC_F32_BASE_FIELD_COUNT && field.is_empty()),
                "f32 lane {index} has {} rows for {glyph_count} glyphs",
                field.len(),
            );
            assert!(field.iter().all(|value| value.is_finite()));
        }
        for (index, field) in arena.semantic_u32.iter().enumerate() {
            assert!(
                field.len() == glyph_count
                    || (index >= SEMANTIC_U32_BASE_FIELD_COUNT && field.is_empty()),
                "u32 lane {index} has {} rows for {glyph_count} glyphs",
                field.len(),
            );
        }

        let mut stable_ids = arena
            .semantic_glyphs
            .iter()
            .map(|glyph| glyph.stable_id)
            .collect::<Vec<_>>();
        assert!(stable_ids.iter().all(|&stable_id| stable_id != 0));
        stable_ids.sort_unstable();
        assert!(stable_ids.windows(2).all(|pair| pair[0] != pair[1]));

        for glyph in &arena.glyphs {
            let semantic = &arena.semantic_glyphs[glyph.semantic_glyph_index as usize];
            assert_eq!(semantic.stable_id, glyph.stable_id);
            assert_ne!(glyph.content_revision, 0);
            assert_ne!(glyph.binding_handle, 0);
            assert_ne!(glyph.font_handle, 0);
            assert!(glyph.inline_start.is_finite());
            assert!(glyph.block_start.is_finite());
            assert!(glyph.inline_extent.is_finite() && glyph.inline_extent >= 0.0);
            assert!(glyph.block_extent.is_finite() && glyph.block_extent >= 0.0);
            assert!((glyph.inline_start + glyph.inline_extent).is_finite());
            assert!((glyph.block_start + glyph.block_extent).is_finite());
        }
        for decoration in &arena.decorations {
            assert!(decoration.inline_start.is_finite());
            assert!(decoration.block_start.is_finite());
            assert!(decoration.inline_extent.is_finite() && decoration.inline_extent >= 0.0);
            assert!(decoration.block_extent.is_finite() && decoration.block_extent >= 0.0);
            assert!((decoration.inline_start + decoration.inline_extent).is_finite());
            assert!((decoration.block_start + decoration.block_extent).is_finite());
        }
    }

    fn layout_run_positioning_fixture()
    -> (Vec<u16>, ClusterArena, Vec<ShapingRun>, Vec<StyleSegment>) {
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
        let runs = vec![
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
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
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
            )
            .unwrap();
        clusters.ensure_word_breaks().unwrap();
        clusters
            .rebuild_run_local_geometry(runs, styles, extents_for)
            .unwrap();
    }

    fn fixture_position_results(
        cluster_start: usize,
        cluster_end: usize,
        mutate: impl FnOnce(&mut ClusterArena, &mut [StyleSegment], &mut FlowLine),
    ) -> (Vec<ShadowRunGlyph>, PositionedGlyphArena) {
        let (text, mut clusters, runs, mut styles) = layout_run_positioning_fixture();
        let advance = clusters.advances[cluster_start..cluster_end]
            .iter()
            .copied()
            .sum();
        let mut line = FlowLine {
            flow_thread_id: 1,
            region_id: 2,
            transform_index: 3,
            clip_id: 4,
            fragment_start: 0,
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
            },
            slot_start: 1_000_000.125,
            slot_end: 1_000_512.125,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
        };
        let extents = |_: u32, glyph_id: u32| {
            Some(FontGlyphExtents {
                x_min: -10,
                y_min: -200,
                x_max: i32::try_from(400 + glyph_id).unwrap(),
                y_max: 700,
            })
        };
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, extents);
        let expected = shadow_base_ltr_unindented_fragment_positions(
            line, fragment, &clusters, &styles, extents,
        )
        .unwrap();
        let mut production = PositionedGlyphArena::default();
        production.placement.clear();
        production
            .position_fragment::<false>(
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
                extents,
                None,
            )
            .unwrap();

        (expected, production)
    }

    fn assert_run_positions_match_renderer_placement(cluster_start: usize, cluster_end: usize) {
        let (expected, production) =
            fixture_position_results(cluster_start, cluster_end, |_, _, _| {});
        assert_eq!(production.semantic_glyphs.len(), expected.len());
        assert_eq!(production.glyphs.len(), expected.len());
        for (index, ((semantic, layout), expected)) in production
            .semantic_glyphs
            .iter()
            .zip(&production.glyphs)
            .zip(expected)
            .enumerate()
        {
            let translation = production.placement.glyph_translation(index).unwrap();
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
            assert_eq!(semantic.stable_id, expected.stable_id);
            assert_eq!(semantic.inline_origin.to_bits(), placed_inline.to_bits());
            assert_eq!(semantic.block_origin.to_bits(), placed_block.to_bits());
            assert_eq!(
                semantic.inline_advance.to_bits(),
                expected.inline_advance.to_bits()
            );
            assert_eq!(
                semantic.ink_inline_extent.to_bits(),
                expected.ink_inline_extent.to_bits()
            );
            assert_eq!(
                semantic.ink_block_extent.to_bits(),
                expected.ink_block_extent.to_bits()
            );
            assert_eq!(
                production.semantic_f32[0][index].to_bits(),
                semantic.ink_inline_start.to_bits()
            );
            assert_eq!(
                production.semantic_f32[1][index].to_bits(),
                semantic.ink_block_start.to_bits()
            );
            assert_eq!(
                layout.inline_extent.to_bits(),
                expected.ink_inline_extent.to_bits()
            );
            assert_eq!(
                layout.block_extent.to_bits(),
                expected.ink_block_extent.to_bits()
            );
        }
    }

    #[test]
    fn base_ltr_unindented_layout_run_segments_match_renderer_placement() {
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

        let (_, positioned) = fixture_position_results(0, 12, |_, _, _| {});
        assert_eq!(positioned.placement.segments().len(), 7);
        assert_eq!(positioned.placement.segment_count(), 7);
        assert_eq!(positioned.placement.visual_spans().len(), 6);
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
        assert_eq!(
            positioned
                .placement
                .visual_spans()
                .get(1)
                .unwrap()
                .glyph_start,
            5
        );
    }

    #[test]
    fn bidi_indent_and_hanging_occurrences_cover_emitted_instances_once() {
        let (text, mut clusters, mut runs, styles) = layout_run_positioning_fixture();
        runs[1].bidi_level = 1;
        let cluster_end = 7_usize;
        clusters.flags[1] |= CLUSTER_SPACE;
        clusters.flags[cluster_end - 1] |= CLUSTER_SPACE;
        let hung_advance = clusters.advances[cluster_end - 1];
        let advance = clusters.advances[..cluster_end]
            .iter()
            .copied()
            .sum::<f64>()
            - hung_advance;
        let line = FlowLine {
            flow_thread_id: 1,
            region_id: 2,
            transform_index: 3,
            clip_id: 4,
            fragment_start: 0,
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
                advance,
                hung_advance,
                hard_break: false,
            },
            slot_start: 0.0,
            slot_end: 100.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
        };
        let mut positioned = PositionedGlyphArena::default();
        positioned.placement.clear();
        positioned
            .position_fragment::<false>(
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
                3.0,
                JustifyControls::default(),
                |_| None,
                |_, _| {
                    Some(FontGlyphExtents {
                        x_min: 0,
                        y_min: -200,
                        x_max: 500,
                        y_max: 700,
                    })
                },
                None,
            )
            .unwrap();

        positioned
            .placement
            .validate_occurrences(positioned.glyphs.len(), clusters.layout_runs(), &[])
            .unwrap();
        assert!((0..positioned.placement.visual_spans().len()).any(|index| {
            positioned
                .placement
                .visual_spans()
                .get(index)
                .is_some_and(|span| span.resolved_level & 1 != 0)
        }));
        let role_for = |glyph: u32| {
            (0..positioned.placement.visual_spans().len()).find_map(|index| {
                let span = positioned.placement.visual_spans().get(index)?;
                (span.glyph_source == GlyphSource::LayoutRun
                    && glyph >= span.glyph_start
                    && glyph < span.glyph_start + span.glyph_count)
                    .then_some(span.role)
            })
        };
        assert_eq!(
            role_for(clusters.glyph_starts[1]),
            Some(SliceRole::Ordinary)
        );
        assert_eq!(
            role_for(clusters.glyph_starts[cluster_end - 1]),
            Some(SliceRole::HangingSpace)
        );
    }

    #[test]
    fn renderer_f32_placement_is_the_numeric_authority() {
        let local = 16_777_217.0_f64 as f32;
        let translation = -16_777_216.0_f32;
        let placed = placed_f32(local, translation).unwrap();
        let legacy_absolute = 1.0_f64 as f32;

        assert_eq!(placed.to_bits(), 0.0_f32.to_bits());
        assert_eq!(legacy_absolute.to_bits(), 1.0_f32.to_bits());
        assert_ne!(placed.to_bits(), legacy_absolute.to_bits());
    }

    #[test]
    fn normal_range_block_origin_uses_renderer_f32_placement() {
        let (shadow, production) = fixture_position_results(8, 10, |clusters, styles, line| {
            styles[0].style.font_size = f32::from_bits(0x4177_65c4);
            styles[0].style.baseline_shift = f32::from_bits(0x4202_277e);
            line.block_start = 0.0;
            line.baseline = f64::from_bits(0x4004_9490_c000_0000);
            let glyph = usize::try_from(clusters.glyph_starts[8]).unwrap();
            clusters.glyph_y_offsets[glyph] = -1_938;
        });
        let placed = production.semantic_glyphs[0].block_origin;
        let legacy_absolute = shadow[0].block_origin;
        let translation = production.placement.glyph_translation(0).unwrap();
        let renderer = placed_f32(
            production.glyphs[0].block_start,
            finite_f32(translation.translation_block).unwrap(),
        )
        .unwrap();

        assert_eq!(placed.to_bits(), renderer.to_bits());
        assert_eq!(placed.to_bits(), 0.0_f32.to_bits());
        assert_eq!(legacy_absolute.to_bits(), 0xb2e5_6042);
        assert_ne!(placed.to_bits(), legacy_absolute.to_bits());
    }

    #[test]
    fn shadow_positioning_rejects_justify_and_boundary() {
        let (_, clusters, _, styles) = layout_run_positioning_fixture();
        let line = FlowLine {
            flow_thread_id: 1,
            region_id: 1,
            transform_index: 0,
            clip_id: 0,
            fragment_start: 0,
            fragment_count: 1,
            align: ALIGN_JUSTIFY,
            block_start: 0.0,
            baseline: 8.0,
            height: 10.0,
        };
        let fragment = FlowFragment {
            line: ComposedLine {
                cluster_start: 0,
                cluster_end: 1,
                text_start: 0,
                text_end: 1,
                advance: clusters.advances[0],
                hung_advance: 0.0,
                hard_break: false,
            },
            slot_start: 0.0,
            slot_end: 20.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
        };
        assert!(matches!(
            shadow_base_ltr_unindented_fragment_positions(
                line,
                fragment,
                &clusters,
                &styles,
                |_, _| None,
            ),
            Err(EngineError::InvalidRequest)
        ));
        assert!(matches!(
            shadow_base_ltr_unindented_fragment_positions(
                FlowLine {
                    align: ALIGN_START,
                    ..line
                },
                FlowFragment {
                    boundary_index: 0,
                    ..fragment
                },
                &clusters,
                &styles,
                |_, _| None,
            ),
            Err(EngineError::InvalidRequest)
        ));
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
                flow_thread_id: 1,
                region_id: 1,
                transform_index: 0,
                clip_id: 0,
                fragment_start: 0,
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
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: 0,
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
            lines: vec![FlowLine { align, ..line }],
            fragments: vec![FlowFragment {
                slot_end,
                ..fragment
            }],
            ellipsis_threads: alloc::vec::Vec::new(),
            recomposed_lines: None,
        };
        let equivalent = |pending: &FlowLayoutArena, committed: &FlowLayoutArena| {
            flow_positioning_equivalent(
                pending, committed, &clusters, &bidi, typography, typography,
            )
            .unwrap()
        };
        // A start-aligned line ignores the right edge: widening is a no-op.
        assert!(equivalent(
            &arena(ALIGN_START, 17.0),
            &arena(ALIGN_START, 25.0)
        ));
        let mut cursor = 0;
        assert_eq!(
            equivalent_retained_line(
                &arena(ALIGN_START, 17.0),
                0,
                arena(ALIGN_START, 17.0).lines[0],
                &arena(ALIGN_START, 25.0),
                &mut cursor,
                &clusters,
                &bidi,
                true,
                typography(0),
                typography(0),
            )
            .unwrap(),
            Some(0),
        );
        let mut cursor = 0;
        assert_eq!(
            equivalent_retained_line(
                &arena(ALIGN_START, 17.0),
                0,
                arena(ALIGN_START, 17.0).lines[0],
                &arena(ALIGN_START, 25.0),
                &mut cursor,
                &clusters,
                &bidi,
                false,
                typography(0),
                typography(0),
            )
            .unwrap(),
            None,
            "nontrivial bidi takes the full positioning path"
        );
        let indented = ThreadTypography {
            first_line_indent: 2.0,
            justify: JustifyControls::default(),
        };
        let mut cursor = 0;
        assert_eq!(
            equivalent_retained_line(
                &arena(ALIGN_START, 17.0),
                0,
                arena(ALIGN_START, 17.0).lines[0],
                &arena(ALIGN_START, 17.0),
                &mut cursor,
                &clusters,
                &bidi,
                true,
                indented,
                typography(0),
            )
            .unwrap(),
            None,
            "a changed first-line indent cannot reuse positioned glyphs"
        );
        // End alignment derives the pen origin from the slot end: not a no-op.
        assert!(!equivalent(
            &arena(ALIGN_END, 17.0),
            &arena(ALIGN_END, 25.0)
        ));
        let mut shifted_start = arena(ALIGN_END, 17.0);
        shifted_start.fragments[0].slot_start = -2.0;
        let mut cursor = 0;
        assert_eq!(
            equivalent_retained_line(
                &shifted_start,
                0,
                shifted_start.lines[0],
                &arena(ALIGN_END, 17.0),
                &mut cursor,
                &clusters,
                &bidi,
                true,
                typography(0),
                typography(0),
            )
            .unwrap(),
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
            flow_positioning_equivalent(pending, committed, &clusters, &bidi, justified, justified)
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
        let mut cursor = 0;
        assert_eq!(
            equivalent_retained_line(
                &arena(ALIGN_JUSTIFY, 17.0),
                0,
                arena(ALIGN_JUSTIFY, 17.0).lines[0],
                &arena(ALIGN_JUSTIFY, 17.0),
                &mut cursor,
                &clusters,
                &bidi,
                true,
                justified(0),
                typography(0),
            )
            .unwrap(),
            None,
            "changed justification controls cannot reuse a prior distribution"
        );
        // A boundary-bearing fragment always takes the full path.
        let mut with_boundary = arena(ALIGN_START, 17.0);
        with_boundary.fragments[0].boundary_index = 0;
        assert!(!equivalent(&with_boundary, &arena(ALIGN_START, 17.0)));
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
        prepare_positioning_clusters(&mut clusters, &text, &runs, &styles, |_, _| None);
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
                        false,
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
            flow_thread_id: 1,
            region_id: 1,
            transform_index: 1,
            clip_id: 0,
            fragment_start: 0,
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
            },
            slot_start: 0.0,
            slot_end: 17.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
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
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_start: 0,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 3,
                    text_start: 0,
                    text_end: 2,
                    advance: 10.2,
                    hung_advance: 0.0,
                    hard_break: true,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
            }],
            ..FlowLayoutArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
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
                &text,
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

    /// Decoration slice: a styled run with underline and line-through flags emits
    /// decoration records with geometry from the registered font's decoration metrics
    /// (fixture: underline -100/50, strikeout 300/50 at 1000 upem, font size 10).
    #[test]
    fn decorated_runs_emit_underline_and_line_through_records() {
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
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_start: 0,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 3,
                    text_start: 0,
                    text_end: 2,
                    advance: 12.0,
                    hung_advance: 0.0,
                    hard_break: true,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
            }],
            ..FlowLayoutArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
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
                &text,
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

        assert_layout_plan_producer_invariants(&active);
        assert_eq!(active.decorations.len(), 2);
        let underline = active.decorations[0];
        // Centered 12.0 advance in the 20.0 slot: run spans 4.0..16.0.
        assert_eq!(underline.flags, crate::engine::frame::DECORATION_UNDERLINE);
        assert_eq!(underline.inline_start, 4.0);
        assert_eq!(underline.inline_extent, 12.0);
        // post underline position -100 at scale 0.01 in down-positive space: 8.0 + 1.0.
        assert_eq!(underline.block_start, 9.0);
        assert_eq!(underline.block_extent, 0.5);
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
                &text,
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
                &text,
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
        assert_eq!(plain.decorations.len(), 0);
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
            },
            stable_ids: vec![777],
        };
        let lines = [
            FlowLine {
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_start: 0,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            },
            FlowLine {
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_start: 1,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 10.0,
                baseline: 8.0,
                height: 10.0,
            },
        ];
        let flow = FlowLayoutArena {
            lines: lines.to_vec(),
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
                    },
                    slot_start: 0.0,
                    slot_end: 20.0,
                    flexible_end: false,
                    boundary_index: 0,
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
                    },
                    slot_start: 0.0,
                    slot_end: 20.0,
                    flexible_end: false,
                    boundary_index: NO_BOUNDARY,
                },
            ],
            ..FlowLayoutArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
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
                &text,
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

        let boundary_span = (0..active.placement.visual_spans().len())
            .find_map(|index| {
                active
                    .placement
                    .visual_spans()
                    .get(index)
                    .filter(|span| span.role == SliceRole::BoundaryReplacement)
            })
            .unwrap();
        assert_eq!(boundary_span.glyph_source, GlyphSource::Boundary);
        assert_eq!(boundary_span.role, SliceRole::BoundaryReplacement);
        assert_eq!(active.glyphs.len(), 5);
        // Line one centers its 15.0 advance (12.0 retained + 3.0 hyphen) in the 20.0 slot.
        assert_eq!(active.semantic_glyphs[0].inline_origin, 2.5);
        assert_eq!(active.semantic_glyphs[1].inline_origin, 8.5);
        // The inserted hyphen follows the retained clusters with its own glyph identity.
        assert_eq!(active.glyphs[2].glyph_id, 45);
        assert_eq!(active.glyphs[2].stable_id, 777);
        assert_eq!(active.semantic_glyphs[2].inline_origin, 14.5);
        assert_eq!(active.semantic_glyphs[2].block_origin, 8.0);
        // The inserted glyph has no source cluster: its published cluster is the boundary
        // text position itself, while style and paint anchor to the neighbor cluster.
        assert_eq!(active.semantic_glyphs[2].cluster, 2);
        // The following line is unaffected by the inserted glyph.
        assert_eq!(active.semantic_glyphs[3].inline_origin, 4.0);
        assert_eq!(active.semantic_glyphs[4].inline_origin, 10.0);
        assert_eq!(active.semantic_glyphs[3].block_origin, 18.0);
        // Every glyph, inserted included, receives a content revision.
        assert_eq!(next_revision, 6);

        let retained = FlowLayoutArena {
            lines: flow.lines.clone(),
            fragments: flow.fragments.clone(),
            recomposed_lines: Some((1, 2)),
            ..FlowLayoutArena::default()
        };
        let mut next = PositionedGlyphArena::default();
        next.build(
            &active,
            &retained,
            Some(&flow),
            &text,
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
            .validate_occurrences(
                next.glyphs.len(),
                clusters.layout_runs(),
                &next.replacement_runs,
            )
            .unwrap();
    }

    #[test]
    fn positions_once_and_revisions_only_exact_content_changes() {
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
                flow_thread_id: 7,
                region_id: 9,
                transform_index: 9,
                clip_id: 9,
                fragment_start: 0,
                fragment_count: 1,
                align: ALIGN_CENTER,
                block_start: 0.0,
                baseline: 8.0,
                height: 10.0,
            }],
            fragments: vec![FlowFragment {
                line: ComposedLine {
                    cluster_start: 0,
                    cluster_end: 3,
                    text_start: 0,
                    text_end: 2,
                    advance: 12.0,
                    hung_advance: 0.0,
                    hard_break: true,
                },
                slot_start: 0.0,
                slot_end: 20.0,
                flexible_end: false,
                boundary_index: NO_BOUNDARY,
            }],
            ..FlowLayoutArena::default()
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
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
                &text,
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
        assert_layout_plan_producer_invariants(&active);
        assert_eq!(active.glyphs.len(), 2);
        assert_eq!(active.glyphs[0].content_revision, 1);
        assert_eq!(active.glyphs[1].content_revision, 2);
        assert_eq!(active.semantic_f32[0][0], 4.0);
        assert_eq!(active.semantic_f32[0][1], 10.0);
        assert_eq!(active.semantic_f32[1][0], 1.0);
        assert_eq!(active.semantic_glyphs[0].inline_origin, 4.0);
        assert_eq!(active.semantic_glyphs[1].inline_origin, 10.0);
        assert_eq!(active.semantic_glyphs[0].block_origin, 8.0);
        assert_ne!(
            active.semantic_f32[1][0],
            active.semantic_glyphs[0].block_origin
        );
        assert_eq!(active.semantic_u32[0], [u32::MAX, u32::MAX]);
        assert_eq!(next_revision, 3);

        let mut pending = PositionedGlyphArena::default();
        pending
            .build(
                &active,
                &flow,
                None,
                &text,
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
        assert_layout_plan_producer_invariants(&pending);
        assert_eq!(pending.glyphs[0].content_revision, 1);
        assert_eq!(pending.glyphs[1].content_revision, 2);
        assert_eq!(next_revision, 3);

        let retained_flow = FlowLayoutArena {
            lines: flow.lines.clone(),
            fragments: flow.fragments.clone(),
            ..FlowLayoutArena::default()
        };
        flow.recomposed_lines = Some((0, 1));
        flow.fragments[0].slot_start = 1.0;
        flow.fragments[0].slot_end = 21.0;
        pending
            .build(
                &active,
                &flow,
                Some(&retained_flow),
                &text,
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
        assert!(pending.retained_static_geometry);
        assert_eq!(
            pending.glyphs[0].inline_start,
            active.glyphs[0].inline_start
        );
        assert_eq!(pending.semantic_glyphs[0].inline_origin, 5.0);
        assert_eq!(pending.glyphs[0].content_revision, 3);
        assert_eq!(pending.glyphs[1].content_revision, 4);
        assert_eq!(
            pending.semantic_change_masks,
            [1 | SEMANTIC_PLACEMENT_CHANGE, 1 | SEMANTIC_PLACEMENT_CHANGE,]
        );
        assert_eq!(next_revision, 5);

        let mut metadata_flow = FlowLayoutArena {
            lines: flow.lines.clone(),
            fragments: flow.fragments.clone(),
            recomposed_lines: flow.recomposed_lines,
            ..FlowLayoutArena::default()
        };
        metadata_flow.lines[0].region_id = 19;
        metadata_flow.lines[0].flow_thread_id = 17;
        metadata_flow.lines[0].transform_index = 29;
        metadata_flow.lines[0].clip_id = 39;
        let mut metadata_pending = PositionedGlyphArena::default();
        metadata_pending
            .build(
                &active,
                &metadata_flow,
                Some(&retained_flow),
                &text,
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
        assert!(metadata_pending.retained_static_geometry);
        assert_eq!(
            metadata_pending.glyphs[0].inline_start,
            active.glyphs[0].inline_start
        );
        assert_eq!(
            metadata_pending.glyphs[0].block_start,
            active.glyphs[0].block_start
        );
        assert_eq!(
            metadata_pending.glyphs[0].inline_extent,
            active.glyphs[0].inline_extent
        );
        assert_eq!(
            metadata_pending.glyphs[0].block_extent,
            active.glyphs[0].block_extent
        );
        assert_eq!(metadata_pending.glyphs[0].clip_id, 39);
        assert_eq!(metadata_pending.semantic_u32[2], [19, 19]);
        assert_eq!(metadata_pending.semantic_u32[3], [17, 17]);
        assert_eq!(metadata_pending.semantic_u32[4], [29, 29]);
        assert_eq!(metadata_pending.semantic_change_masks, [u16::MAX, u16::MAX]);
        assert_eq!(next_revision, 7);

        active.placement.clear();
        let mut reordered = PositionedGlyphArena::default();
        reordered.glyphs.extend(active.glyphs.iter().rev().copied());
        reordered
            .semantic_glyphs
            .extend(active.semantic_glyphs.iter().rev().copied());
        for (index, glyph) in reordered.glyphs.iter_mut().enumerate() {
            glyph.semantic_glyph_index = index as u32;
        }
        for field in 0..SEMANTIC_F32_FIELD_COUNT {
            reordered.semantic_f32[field].extend(active.semantic_f32[field].iter().rev().copied());
        }
        for field in 0..SEMANTIC_U32_FIELD_COUNT {
            reordered.semantic_u32[field].extend(active.semantic_u32[field].iter().rev().copied());
        }
        reordered
            .assign_content_revisions(&active, &mut index, &mut next_revision, false)
            .unwrap();
        assert_eq!(reordered.glyphs[0].content_revision, 2);
        assert_eq!(reordered.glyphs[1].content_revision, 1);
        assert_eq!(reordered.semantic_change_masks, [0, 0]);
        assert_eq!(next_revision, 7);
    }

    #[test]
    fn converged_lines_assign_revisions_only_inside_the_recomposed_glyph_range() {
        let glyph = |stable_id, revision| LayoutGlyph {
            stable_id,
            content_revision: revision,
            semantic_glyph_index: stable_id - 1,
            binding_handle: 1,
            font_handle: 1,
            glyph_id: stable_id,
            material_id: 0,
            clip_id: 0,
            depth_key: 0,
            font_size: 16.0,
            raster_pixel_ratio: 1.0,
            inline_start: stable_id as f32,
            block_start: 0.0,
            inline_extent: 8.0,
            block_extent: 16.0,
        };
        let make_arena = || {
            let mut arena = PositionedGlyphArena {
                glyphs: vec![glyph(1, 10), glyph(2, 20), glyph(3, 30)],
                ..PositionedGlyphArena::default()
            };
            arena
                .semantic_glyphs
                .extend([1, 2, 3].map(|stable_id| SemanticGlyph {
                    stable_id,
                    font_handle: 1,
                    cluster: stable_id,
                    glyph_id: stable_id as u16,
                    flags: 0,
                    font_size: 16.0,
                    inline_origin: stable_id as f32,
                    block_origin: 0.0,
                    ..SemanticGlyph::default()
                }));
            for field in &mut arena.semantic_f32 {
                field.extend([1.0, 2.0, 3.0]);
            }
            for field in &mut arena.semantic_u32 {
                field.extend([1, 2, 3]);
            }
            arena
        };
        let previous = make_arena();
        let mut next = make_arena();
        next.semantic_f32[0][1] = 4.0;
        next.recomposed_glyphs = Some(RecomposedGlyphRange {
            previous_start: 1,
            previous_end: 2,
            next_start: 1,
            next_end: 2,
        });
        let mut next_revision = 40;
        next.assign_content_revisions(
            &previous,
            &mut IdentityIndex::default(),
            &mut next_revision,
            false,
        )
        .unwrap();
        assert_eq!(
            next.glyphs
                .iter()
                .map(|glyph| glyph.content_revision)
                .collect::<Vec<_>>(),
            [10, 40, 30]
        );
        assert_eq!(next.semantic_change_masks, [0, 1, 0]);
        assert_eq!(next_revision, 41);
    }

    #[test]
    fn geometry_revision_scan_matches_full_semantic_comparison() {
        let make_arena = |changed: bool, clip_id: u32| {
            let glyph = LayoutGlyph {
                stable_id: 1,
                content_revision: 7,
                semantic_glyph_index: 0,
                binding_handle: 2,
                font_handle: 3,
                glyph_id: 4,
                material_id: 5,
                clip_id,
                depth_key: PAINT_LAYER_GLYPH,
                font_size: 16.0,
                raster_pixel_ratio: 1.0,
                inline_start: if changed { 13.0 } else { 8.0 },
                block_start: if changed { 14.0 } else { 9.0 },
                inline_extent: 10.0,
                block_extent: 11.0,
            };
            let semantic = SemanticGlyph {
                stable_id: 1,
                font_handle: 3,
                cluster: 12,
                glyph_id: 4,
                inline_origin: if changed { 13.0 } else { 8.0 },
                block_origin: if changed { 14.0 } else { 9.0 },
                ..SemanticGlyph::default()
            };
            let mut arena = PositionedGlyphArena {
                glyphs: vec![glyph],
                semantic_glyphs: vec![semantic],
                ..PositionedGlyphArena::default()
            };
            for (field, values) in arena.semantic_f32.iter_mut().enumerate() {
                values.push(if changed && field < 2 {
                    20.0 + field as f32
                } else {
                    10.0 + field as f32
                });
            }
            for (field, values) in arena.semantic_u32.iter_mut().enumerate() {
                values.push(if changed && (2..5).contains(&field) {
                    20 + field as u32
                } else {
                    10 + field as u32
                });
            }
            arena
        };
        let assert_same_revisions =
            |previous: &PositionedGlyphArena,
             mut full: PositionedGlyphArena,
             mut geometry: PositionedGlyphArena| {
                let mut full_revision = 30;
                full.assign_content_revisions(
                    previous,
                    &mut IdentityIndex::default(),
                    &mut full_revision,
                    false,
                )
                .unwrap();
                let mut geometry_revision = 30;
                geometry
                    .assign_content_revisions(
                        previous,
                        &mut IdentityIndex::default(),
                        &mut geometry_revision,
                        true,
                    )
                    .unwrap();
                assert_eq!(
                    geometry.glyphs[0].content_revision,
                    full.glyphs[0].content_revision
                );
                assert_eq!(geometry.semantic_change_masks, full.semantic_change_masks);
                assert_eq!(geometry_revision, full_revision);
            };

        let previous = make_arena(false, 1);
        assert_same_revisions(&previous, make_arena(true, 1), make_arena(true, 1));
        assert_same_revisions(&previous, make_arena(false, 2), make_arena(false, 2));
        assert_same_revisions(&previous, make_arena(false, 1), make_arena(false, 1));
    }
}
