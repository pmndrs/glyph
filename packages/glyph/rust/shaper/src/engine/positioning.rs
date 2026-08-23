//! Retained horizontal glyph positioning and exact content revision assignment.

use alloc::vec::Vec;

use crate::{FontGlyphExtents, FontMetrics, bidi::BidiAnalysis};

use super::{
    EngineError, FrameFault,
    cluster_state::{CLUSTER_HARD_BREAK, CLUSTER_SPACE, ClusterArena},
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    frame::{ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START},
    identity_index::{IdentityIndex, IdentityIndexError},
    policy_gather::LayoutGlyph,
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapingRun},
    style_state::{ResolvedStyle, StyleSegment},
};

pub(crate) const SEMANTIC_F32_FIELD_COUNT: usize = 6;
pub(crate) const SEMANTIC_F32_CHANGE_FIELD_COUNT: usize = 8;
pub(crate) const SEMANTIC_U32_FIELD_COUNT: usize = 6;
pub(crate) const ALL_SEMANTIC_CHANGES: u16 =
    (1 << (SEMANTIC_F32_CHANGE_FIELD_COUNT + SEMANTIC_U32_FIELD_COUNT)) - 1;

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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SemanticGlyph {
    pub stable_id: u32,
    pub font_handle: u32,
    pub cluster: u32,
    pub glyph_id: u16,
    pub flags: u16,
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

/// The ink box the render record and the semantic record must agree on, derived once per glyph.
#[derive(Clone, Copy)]
struct GlyphInkBox {
    inline_start: f64,
    block_start: f64,
    inline_extent: f64,
    block_extent: f64,
}

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

/// One solid decoration line for a contiguous decorated visual run: underline,
/// overline, or line-through geometry in positioned space, colored by the style's
/// decoration paint. Non-solid line styles carry their style bits for later paint work
/// and render as solid geometry until then.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecorationRecord {
    pub flags: u32,
    pub style: u8,
    pub color: u32,
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
}

/// Two resolved styles share one decoration line when every declared decoration field
/// matches: the CSS decorating-box group.
fn same_decoration_group(left: &ResolvedStyle, right: &ResolvedStyle) -> bool {
    left.decoration_flags == right.decoration_flags
        && left.decoration_rgba == right.decoration_rgba
        && left.decoration_style == right.decoration_style
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
        for field in &mut self.semantic_f32 {
            reserve(field, capacity)?;
        }
        for field in &mut self.semantic_u32 {
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
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        identity_index: &mut IdentityIndex,
        next_content_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.clear();
        self.reserve(clusters.glyph_ids.len())?;
        reserve(&mut self.line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_inline_extents, flow.lines.len())?;
        let visually_ltr = is_trivially_ltr(bidi, runs);
        for (line_index, line) in flow.lines.iter().copied().enumerate() {
            if flow
                .recomposed_line_range()
                .is_some_and(|(start, end)| line_index < start || line_index >= end)
            {
                self.append_retained_line(previous, line_index)?;
                continue;
            }
            let line_glyph_start = self.glyphs.len();
            let semantic_line_start = self.semantic_glyphs.len();
            let fragments = line_fragments(flow, line)?;
            if fragments.is_empty() {
                self.line_glyph_starts.push(
                    u32::try_from(line_glyph_start).map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.line_glyph_counts.push(0);
                self.semantic_line_glyph_starts.push(
                    u32::try_from(semantic_line_start).map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.semantic_line_glyph_counts.push(0);
                self.semantic_line_inline_extents.push(0.0);
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
            for fragment in fragments.iter().copied() {
                let fragment_advance = self.position_fragment(
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
                    if fragment.line.cluster_start == 0 {
                        typography.first_line_indent
                    } else {
                        0.0
                    },
                    typography.justify,
                    metrics_for,
                    extents_for,
                )?;
                inline_end = inline_end.max(fragment.slot_start + fragment_advance);
            }
            self.semantic_line_glyph_starts
                .push(u32::try_from(semantic_line_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.semantic_line_glyph_counts.push(
                u32::try_from(
                    self.semantic_glyphs
                        .len()
                        .saturating_sub(semantic_line_start),
                )
                .map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.semantic_line_inline_extents
                .push((inline_end - inline_start).max(0.0));
            self.line_glyph_starts
                .push(u32::try_from(line_glyph_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.line_glyph_counts.push(
                u32::try_from(self.glyphs.len().saturating_sub(line_glyph_start))
                    .map_err(|_| EngineError::ResultTooLarge)?,
            );
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
        self.assign_content_revisions(previous, identity_index, next_content_revision)
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
        for (target, source) in self.semantic_f32.iter_mut().zip(&previous.semantic_f32) {
            target.extend_from_slice(
                source
                    .get(glyph_start..glyph_end)
                    .ok_or(EngineError::InvalidRequest)?,
            );
        }
        for (target, source) in self.semantic_u32.iter_mut().zip(&previous.semantic_u32) {
            target.extend_from_slice(
                source
                    .get(glyph_start..glyph_end)
                    .ok_or(EngineError::InvalidRequest)?,
            );
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

    pub(crate) fn clear(&mut self) {
        self.decorations.clear();
        self.glyphs.clear();
        self.line_glyph_starts.clear();
        self.line_glyph_counts.clear();
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
        self.recomposed_glyphs = None;
    }

    pub(crate) fn decorations(&self) -> &[DecorationRecord] {
        &self.decorations
    }

    pub(crate) fn glyphs(&self) -> &[LayoutGlyph] {
        &self.glyphs
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
    fn position_fragment(
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
        // Whether the hung suffix lands visually FIRST is a property of that cluster's own
        // resolved level, not of the paragraph: a span-level bidi override can give the
        // terminating space the opposite parity to the paragraph it sits in. Alignment and
        // indent deliberately keep asking the paragraph, because CSS resolves `start`/`end`
        // against the inline base direction; only visual order asks the cluster.
        let hung_leads = if fragment.line.hung_advance == 0.0 {
            false
        } else {
            let terminating = retained_cluster_end.saturating_sub(1).max(cluster_start);
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
        let mut cursor = pen_origin;
        let baseline = line.block_start + line.baseline;
        let mut decorated_run: Option<DecoratedRun> = None;
        let mut space_ordinal = 0_i64;
        let mut gap_ordinal = 0_i64;
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
        let stream_ids = &clusters.glyph_ids[..stream_len];
        let stream_clusters = &clusters.glyph_clusters[..stream_len];
        let stream_x_advances = &clusters.glyph_x_advances[..stream_len];
        let stream_x_offsets = &clusters.glyph_x_offsets[..stream_len];
        let stream_y_offsets = &clusters.glyph_y_offsets[..stream_len];
        let stream_shape_flags = &clusters.glyph_shape_flags[..stream_len];
        let stream_stable_ids = &clusters.glyph_stable_ids[..stream_len];
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
            let binding_handle = clusters.binding_handles[cluster];
            // The owning font's units-per-em rides the cluster arena (it can only
            // change on re-shape), so the hot loop derives its scale from the
            // CURRENT style without a per-cluster registry resolution.
            let units_per_em = clusters.units_per_em[cluster];
            if font_handle == 0 || units_per_em == 0.0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(style.font_size) / units_per_em;
            let cluster_origin = cursor;
            let glyph_start = usize::try_from(clusters.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let glyph_count = usize::try_from(clusters.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let adjacency_end = glyph_start
                .checked_add(glyph_count)
                .ok_or(EngineError::InvalidRequest)?;
            // The cluster's adjacency range is admitted once; the walk below
            // reads the stream columns sequentially without further checks.
            if adjacency_end > stream_len {
                return Err(EngineError::InvalidRequest);
            }
            for adjacency in glyph_start..adjacency_end {
                let stable_id = stream_stable_ids[adjacency];
                let glyph_id = u32::from(stream_ids[adjacency]);
                let x_advance = f64::from(stream_x_advances[adjacency]).abs() * scale;
                let x_offset = f64::from(stream_x_offsets[adjacency]) * scale;
                let y_offset = f64::from(stream_y_offsets[adjacency]) * scale;
                let flags = stream_shape_flags[adjacency];
                let origin_inline = cursor + x_offset;
                let origin_block = baseline - y_offset - f64::from(style.baseline_shift);
                let outline = extents_for(font_handle, glyph_id);
                let ink = match outline.as_ref() {
                    Some(extents) => {
                        GlyphInkBox::from_extents(extents, origin_inline, origin_block, scale)
                    }
                    None => GlyphInkBox::empty_at(origin_inline, origin_block),
                };
                self.semantic_glyphs.push(SemanticGlyph {
                    stable_id,
                    font_handle,
                    cluster: stream_clusters[adjacency],
                    glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                    flags,
                    font_size: style.font_size,
                    inline_origin: finite_f32(origin_inline)?,
                    block_origin: finite_f32(origin_block)?,
                    inline_advance: nonnegative_f32(x_advance)?,
                    ink_inline_start: finite_f32(ink.inline_start)?,
                    ink_block_start: finite_f32(ink.block_start)?,
                    ink_inline_extent: nonnegative_f32(ink.inline_extent)?,
                    ink_block_extent: nonnegative_f32(ink.block_extent)?,
                });
                if outline.is_some() {
                    let semantic_glyph_index = u32::try_from(self.semantic_glyphs.len() - 1)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    self.push_glyph(
                        LayoutGlyph {
                            stable_id,
                            content_revision: 0,
                            semantic_glyph_index,
                            binding_handle,
                            font_handle,
                            glyph_id,
                            material_id: style.material_id,
                            clip_id: line.clip_id,
                            depth_key: 0,
                            font_size: style.font_size,
                            raster_pixel_ratio: style.raster_pixel_ratio,
                            inline_start: finite_f32(ink.inline_start)?,
                            block_start: finite_f32(ink.block_start)?,
                            inline_extent: nonnegative_f32(ink.inline_extent)?,
                            block_extent: nonnegative_f32(ink.block_extent)?,
                        },
                        style.foreground_rgba,
                        clusters.stable_ids[cluster],
                        line.region_id,
                        line.flow_thread_id,
                        line.transform_index,
                    );
                }
                cursor += x_advance;
            }
            cursor = cluster_origin + clusters.advances[cluster];
            // Adjustments are span-bounded and count-limited in visual encounter
            // order: exactly the `spaces` counted word spaces and `gaps` gaps
            // inside the trimmed span receive units — trailing logical spaces
            // (outside `gap_end`) and any visual cluster beyond the counted set
            // never absorb uncounted adjustments, in either direction, so the
            // applied cursor sum equals the measured distribution total. Each
            // unit count converts through the dyadic 1/64 exactly, and the
            // leading encounters carry the euclidean remainder one unit at a
            // time.
            if clusters.flags[cluster] & CLUSTER_SPACE != 0
                && cluster < justify.gap_end
                && space_ordinal < i64::from(justify.spaces)
                && (justify.per_space_units != 0 || justify.extra_space_units != 0)
            {
                let units =
                    justify.per_space_units + i64::from(space_ordinal < justify.extra_space_units);
                cursor += super::layout_units::scaled_from_layout_units(units);
                space_ordinal += 1;
            }
            if cluster < justify.gap_end
                && gap_ordinal < i64::from(justify.gaps)
                && (justify.per_gap_units != 0 || justify.extra_gap_units != 0)
            {
                let units =
                    justify.per_gap_units + i64::from(gap_ordinal < justify.extra_gap_units);
                cursor += super::layout_units::scaled_from_layout_units(units);
                gap_ordinal += 1;
            }
            if style.decoration_flags == 0 {
                if decorated_run.is_some() {
                    self.flush_decorated_run(&mut decorated_run, line, metrics_for)?;
                }
            } else {
                match decorated_run {
                    // One continuous line per CSS decorating box: nested spans that inherit
                    // the same declared decoration extend the run across style changes.
                    Some(ref mut run)
                        if run.font_handle == font_handle
                            && same_decoration_group(&run.style, &style) =>
                    {
                        run.end = cursor
                    }
                    _ => {
                        self.flush_decorated_run(&mut decorated_run, line, metrics_for)?;
                        decorated_run = Some(DecoratedRun {
                            style,
                            font_handle,
                            start: cluster_origin,
                            end: cursor,
                        });
                    }
                }
            }
        }
        if decorated_run.is_some() {
            self.flush_decorated_run(&mut decorated_run, line, metrics_for)?;
        }
        if let Some(boundary) = boundary {
            let _ = self.position_boundary(
                line,
                boundary,
                cursor,
                baseline,
                text,
                clusters,
                runs,
                styles,
                boundary_shape,
                metrics_for,
                extents_for,
            )?;
        }
        Ok(indent
            + fragment.line.advance
            + super::layout_units::scaled_from_layout_units(justify.total_units()))
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
    fn position_boundary(
        &mut self,
        line: FlowLine,
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
    ) -> Result<f64, EngineError> {
        runs.get(usize::try_from(boundary.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let source_cluster =
            usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let ellipsis_cluster = usize::try_from(boundary.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?
            .saturating_sub(1)
            .max(source_cluster)
            .min(clusters.starts.len().saturating_sub(1));
        cursor = self.position_boundary_span(
            line,
            cursor,
            baseline,
            boundary.source_glyph_start,
            boundary.source_glyph_count,
            boundary.source_binding_handle,
            boundary.source_font_handle,
            None,
            source_cluster,
            arena,
            text,
            clusters,
            styles,
            metrics_for,
            extents_for,
        )?;
        self.position_boundary_span(
            line,
            cursor,
            baseline,
            boundary.ellipsis_glyph_start,
            boundary.ellipsis_glyph_count,
            boundary.ellipsis_binding_handle,
            boundary.ellipsis_font_handle,
            Some(boundary.text_end),
            ellipsis_cluster,
            arena,
            text,
            clusters,
            styles,
            metrics_for,
            extents_for,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn position_boundary_span(
        &mut self,
        line: FlowLine,
        mut cursor: f64,
        baseline: f64,
        glyph_start: u32,
        glyph_count: u32,
        binding_handle: u32,
        font_handle: u32,
        cluster_override: Option<u32>,
        fallback_cluster: usize,
        arena: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
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
            let x_offset = f64::from(
                arena
                    .shape
                    .x_offsets
                    .get(glyph)
                    .copied()
                    .ok_or(EngineError::InvalidRequest)?,
            ) * scale;
            let y_offset = f64::from(
                arena
                    .shape
                    .y_offsets
                    .get(glyph)
                    .copied()
                    .ok_or(EngineError::InvalidRequest)?,
            ) * scale;
            let stable_id = *arena
                .stable_ids
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            let flags = *arena
                .shape
                .glyph_flags
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            let origin_inline = cursor + x_offset;
            let origin_block = baseline - y_offset - f64::from(style.baseline_shift);
            let outline = extents_for(font_handle, glyph_id);
            let ink = match outline.as_ref() {
                Some(extents) => {
                    GlyphInkBox::from_extents(extents, origin_inline, origin_block, scale)
                }
                None => GlyphInkBox::empty_at(origin_inline, origin_block),
            };
            self.semantic_glyphs.push(SemanticGlyph {
                stable_id,
                font_handle,
                cluster,
                glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                flags,
                font_size: style.font_size,
                inline_origin: finite_f32(origin_inline)?,
                block_origin: finite_f32(origin_block)?,
                inline_advance: nonnegative_f32(x_advance)?,
                ink_inline_start: finite_f32(ink.inline_start)?,
                ink_block_start: finite_f32(ink.block_start)?,
                ink_inline_extent: nonnegative_f32(ink.inline_extent)?,
                ink_block_extent: nonnegative_f32(ink.block_extent)?,
            });
            if outline.is_some() {
                let semantic_glyph_index = u32::try_from(self.semantic_glyphs.len() - 1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                self.push_glyph(
                    LayoutGlyph {
                        stable_id,
                        content_revision: 0,
                        semantic_glyph_index,
                        binding_handle,
                        font_handle,
                        glyph_id,
                        material_id: style.material_id,
                        clip_id: line.clip_id,
                        depth_key: 0,
                        font_size: style.font_size,
                        raster_pixel_ratio: style.raster_pixel_ratio,
                        inline_start: finite_f32(ink.inline_start)?,
                        block_start: finite_f32(ink.block_start)?,
                        inline_extent: nonnegative_f32(ink.inline_extent)?,
                        block_extent: nonnegative_f32(ink.block_extent)?,
                    },
                    style.foreground_rgba,
                    semantic_id,
                    line.region_id,
                    line.flow_thread_id,
                    line.transform_index,
                );
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

    fn push_glyph(
        &mut self,
        glyph: LayoutGlyph,
        foreground: u32,
        cluster: u32,
        region: u32,
        flow_thread: u32,
        transform_index: u32,
    ) {
        self.glyphs.push(glyph);
        let f32_values = [
            glyph.inline_start,
            glyph.block_start,
            glyph.inline_extent,
            glyph.block_extent,
            glyph.font_size,
            glyph.raster_pixel_ratio,
        ];
        for (field, value) in self.semantic_f32.iter_mut().zip(f32_values) {
            field.push(value);
        }
        let u32_values = [
            foreground,
            cluster,
            region,
            flow_thread,
            transform_index,
            glyph.stable_id,
        ];
        for (field, value) in self.semantic_u32.iter_mut().zip(u32_values) {
            field.push(value);
        }
    }

    fn assign_content_revisions(
        &mut self,
        previous: &Self,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
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
            for slot in 0..self.glyphs.len() {
                self.assign_content_revision(slot, previous, Some(slot), next_revision)?;
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
        for field in 0..SEMANTIC_F32_FIELD_COUNT {
            if self.semantic_f32[field][slot].to_bits()
                != previous.semantic_f32[field][previous_slot].to_bits()
            {
                mask |= 1 << field;
            }
        }
        let next_semantic = self.semantic_glyphs[self.glyphs[slot].semantic_glyph_index as usize];
        let previous_semantic =
            previous.semantic_glyphs[previous.glyphs[previous_slot].semantic_glyph_index as usize];
        if next_semantic.inline_origin.to_bits() != previous_semantic.inline_origin.to_bits() {
            mask |= 1 << 6;
        }
        if next_semantic.block_origin.to_bits() != previous_semantic.block_origin.to_bits() {
            mask |= 1 << 7;
        }
        for field in 0..SEMANTIC_U32_FIELD_COUNT {
            if self.semantic_u32[field][slot] != previous.semantic_u32[field][previous_slot] {
                mask |= 1 << (SEMANTIC_F32_CHANGE_FIELD_COUNT + field);
            }
        }
        mask
    }
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

/// One line's resolved justification in F26.6 layout units (integer-units plan,
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
        space_advance_units += i64::from(clusters.advances_f26[cluster]);
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
    let deficit_units = i64::from(super::layout_units::layout_units_from_scaled(
        fragment.slot_end - fragment.slot_start - indent - fragment.line.advance,
    ));
    if deficit_units >= 0 {
        // Expansion: word spaces grow up to the declared cap — the excess ratio
        // applied by Q16 mul/shift like the fit applies its shrink budget — then
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
                i64::from(super::layout_units::layout_units_from_scaled(f64::from(
                    controls.letter_space_expansion,
                )))
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
    use super::super::shaping_state::ShapeArena;
    use super::*;

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
        // End alignment derives the pen origin from the slot end: not a no-op.
        assert!(!equivalent(
            &arena(ALIGN_END, 17.0),
            &arena(ALIGN_END, 25.0)
        ));
        assert!(!equivalent(
            &arena(ALIGN_CENTER, 17.0),
            &arena(ALIGN_CENTER, 25.0)
        ));
        // A final line under the auto last-line policy never justifies, so a
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
        // Deficit 10.015625px = 641 units over 2 spaces: euclidean split gives
        // 320 units + one extra leading unit, and the fragment advance fills
        // the slot exactly.
        fragment.slot_end = 17.015_625;
        let controls = JustifyControls::default();
        let distribution =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, controls);
        assert_eq!(distribution.spaces, 2);
        assert_eq!(distribution.per_space_units, 320);
        assert_eq!(distribution.extra_space_units, 1);
        assert_eq!(distribution.total_units(), 641);
        let advance =
            positioned_fragment_advance(line, fragment, false, &clusters, 0.0, controls).unwrap();
        assert_eq!(advance, 17.015_625);
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
            advances_f26: vec![64; 7],
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
        assert_eq!(distribution.per_space_units, 128);
        assert_eq!(distribution.extra_space_units, 0);
        assert_eq!(distribution.gaps, 6);
        assert_eq!(distribution.per_gap_units, 48);
        assert_eq!(distribution.extra_gap_units, 0);

        // Unbounded controls reproduce the pre-tier distribution exactly.
        let unbounded = JustifyControls::default();
        let plain =
            justification_adjustment(line, fragment, false, &clusters, 0, 7, 0.0, unbounded);
        assert_eq!(plain.per_space_units, 320);
        assert_eq!(plain.per_gap_units, 0);
    }

    #[test]
    fn last_line_policy_justifies_final_and_hard_broken_lines() {
        let (_text, clusters, line, fragment) = justify_fixture();
        let auto = JustifyControls::default();
        let final_auto = justification_adjustment(line, fragment, true, &clusters, 0, 7, 0.0, auto);
        assert_eq!(final_auto.per_space_units, 0);
        let policy = JustifyControls {
            last_line_justify: true,
            ..JustifyControls::default()
        };
        let final_justified =
            justification_adjustment(line, fragment, true, &clusters, 0, 7, 0.0, policy);
        assert_eq!(final_justified.per_space_units, 320);
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
        assert_eq!(shrunk.per_space_units, -16);
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
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 0,
            bidi_level: 0,
            style: declaring,
        }];
        let clusters = ClusterArena {
            starts: vec![0, 1, 2],
            ends: vec![1, 2, 3],
            advances: vec![6.0, 4.2, 0.0],
            units_per_em: vec![1_000.0; 3],
            flags: vec![CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE, CLUSTER_HARD_BREAK],
            style_indexes: vec![0, 1, 0],
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
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
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
        let clusters = ClusterArena {
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
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

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
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &plain_styles,
                &bidi,
                &mut index,
                &mut next_revision,
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
        let clusters = ClusterArena {
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
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                &text,
                &clusters,
                &runs,
                &boundary,
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();

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
        let clusters = ClusterArena {
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
        let mut index = IdentityIndex::default();
        let mut active = PositionedGlyphArena::default();
        let mut next_revision = 1;
        active
            .build(
                &PositionedGlyphArena::default(),
                &flow,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(active.glyphs.len(), 2);
        assert_eq!(active.glyphs[0].content_revision, 1);
        assert_eq!(active.glyphs[1].content_revision, 2);
        assert_eq!(active.glyphs[0].inline_start, 4.0);
        assert_eq!(active.glyphs[1].inline_start, 10.0);
        assert_eq!(active.glyphs[0].block_start, 1.0);
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
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(pending.glyphs[0].content_revision, 1);
        assert_eq!(pending.glyphs[1].content_revision, 2);
        assert_eq!(next_revision, 3);

        flow.fragments[0].slot_start = 1.0;
        flow.fragments[0].slot_end = 21.0;
        pending
            .build(
                &active,
                &flow,
                &text,
                &clusters,
                &runs,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                |_| ThreadTypography::default(),
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(pending.glyphs[0].content_revision, 3);
        assert_eq!(pending.glyphs[1].content_revision, 4);
        assert_eq!(next_revision, 5);

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
            .assign_content_revisions(&active, &mut index, &mut next_revision)
            .unwrap();
        assert_eq!(reordered.glyphs[0].content_revision, 2);
        assert_eq!(reordered.glyphs[1].content_revision, 1);
        assert_eq!(reordered.semantic_change_masks, [0, 0]);
        assert_eq!(next_revision, 5);
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
        next.assign_content_revisions(&previous, &mut IdentityIndex::default(), &mut next_revision)
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
}
