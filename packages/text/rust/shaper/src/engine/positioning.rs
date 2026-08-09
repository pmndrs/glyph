//! Retained horizontal glyph positioning and exact content revision assignment.

use alloc::vec::Vec;

use crate::{FontGlyphExtents, FontMetrics, bidi::BidiAnalysis};

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, ClusterArena},
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    frame::{ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START},
    identity_index::{IdentityIndex, IdentityIndexError},
    policy_gather::LayoutGlyph,
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapeArena, ShapingRun},
    style_state::StyleSegment,
};

pub(crate) const SEMANTIC_F32_FIELD_COUNT: usize = 6;
pub(crate) const SEMANTIC_U32_FIELD_COUNT: usize = 6;
pub(crate) const ALL_SEMANTIC_CHANGES: u16 =
    (1 << (SEMANTIC_F32_FIELD_COUNT + SEMANTIC_U32_FIELD_COUNT)) - 1;

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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SemanticGlyph {
    pub stable_id: u32,
    pub font_handle: u32,
    pub cluster: u32,
    pub glyph_id: u16,
    pub flags: u16,
    pub font_size: f32,
    pub inline_origin: f32,
    pub block_origin: f32,
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
        shape: &ShapeArena,
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        identity_index: &mut IdentityIndex,
        next_content_revision: &mut u32,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.clear();
        self.reserve(shape.glyph_ids.len())?;
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
            let mut inline_end = f64::NEG_INFINITY;
            for fragment in fragments.iter().copied() {
                let fragment_advance = self.position_fragment(
                    line,
                    fragment,
                    final_line,
                    text,
                    clusters,
                    runs,
                    shape,
                    boundary_shape,
                    styles,
                    bidi,
                    visually_ltr,
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
        self.glyphs.extend_from_slice(
            previous
                .glyphs
                .get(glyph_start..glyph_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
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
        shape: &ShapeArena,
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        visually_ltr: bool,
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

        let available = (fragment.slot_end - fragment.slot_start - fragment.line.advance).max(0.0);
        let paragraph_level = paragraph_level_at(bidi, fragment.line.text_start);
        let (justify_spaces, per_space) = justification_adjustment(
            line,
            fragment,
            final_line,
            text,
            clusters,
            cluster_start,
            cluster_end,
        );
        let offset = if per_space == 0.0 {
            alignment_offset(line.align, paragraph_level, available)
        } else {
            0.0
        };
        let mut cursor = fragment.slot_start + offset;
        let baseline = line.block_start + line.baseline;
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
            let metrics = metrics_for(font_handle).ok_or(EngineError::InvalidRequest)?;
            if font_handle == 0 || metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
            let cluster_origin = cursor;
            let glyph_start = usize::try_from(clusters.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let glyph_count = usize::try_from(clusters.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            for ordinal in 0..glyph_count {
                let adjacency = glyph_start + ordinal;
                let shaped = usize::try_from(
                    *clusters
                        .glyph_indices
                        .get(adjacency)
                        .ok_or(EngineError::InvalidRequest)?,
                )
                .map_err(|_| EngineError::InvalidRequest)?;
                let glyph_id = u32::from(
                    *shape
                        .glyph_ids
                        .get(shaped)
                        .ok_or(EngineError::InvalidRequest)?,
                );
                let x_advance = f64::from(
                    shape
                        .x_advances
                        .get(shaped)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?,
                )
                .abs()
                    * scale;
                let x_offset = f64::from(
                    shape
                        .x_offsets
                        .get(shaped)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?,
                ) * scale;
                let y_offset = f64::from(
                    shape
                        .y_offsets
                        .get(shaped)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?,
                ) * scale;
                let stable_id = *clusters
                    .glyph_stable_ids
                    .get(adjacency)
                    .ok_or(EngineError::InvalidRequest)?;
                let flags = *shape
                    .glyph_flags
                    .get(shaped)
                    .ok_or(EngineError::InvalidRequest)?;
                let origin_inline = cursor + x_offset;
                let origin_block = baseline - y_offset - f64::from(style.baseline_shift);
                self.semantic_glyphs.push(SemanticGlyph {
                    stable_id,
                    font_handle,
                    cluster: *shape
                        .clusters
                        .get(shaped)
                        .ok_or(EngineError::InvalidRequest)?,
                    glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                    flags,
                    font_size: style.font_size,
                    inline_origin: finite_f32(origin_inline)?,
                    block_origin: finite_f32(origin_block)?,
                });
                if let Some(extents) = extents_for(font_handle, glyph_id) {
                    let inline_start = origin_inline + f64::from(extents.x_min) * scale;
                    let block_start = origin_block - f64::from(extents.y_max) * scale;
                    let inline_extent = f64::from(extents.x_max - extents.x_min) * scale;
                    let block_extent = f64::from(extents.y_max - extents.y_min) * scale;
                    self.push_glyph(
                        LayoutGlyph {
                            stable_id,
                            content_revision: 0,
                            binding_handle,
                            font_handle,
                            glyph_id,
                            semantic_id: clusters.stable_ids[cluster],
                            material_id: style.material_id,
                            clip_id: line.clip_id,
                            depth_key: 0,
                            font_size: style.font_size,
                            raster_pixel_ratio: style.raster_pixel_ratio,
                            inline_start: finite_f32(inline_start)?,
                            block_start: finite_f32(block_start)?,
                            inline_extent: nonnegative_f32(inline_extent)?,
                            block_extent: nonnegative_f32(block_extent)?,
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
            if per_space != 0.0 && cluster_is_space(text, clusters, cluster) {
                cursor += per_space;
            }
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
                boundary_shape,
                metrics_for,
                extents_for,
            )?;
        }
        Ok(fragment.line.advance + per_space * f64::from(justify_spaces))
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
        arena: &BoundaryShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<f64, EngineError> {
        let run = *runs
            .get(usize::try_from(boundary.source_run).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let style = run.style;
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
            style,
            arena,
            text,
            clusters,
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
            style,
            arena,
            text,
            clusters,
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
        style: super::style_state::ResolvedStyle,
        arena: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<f64, EngineError> {
        let metrics = metrics_for(font_handle).ok_or(EngineError::InvalidRequest)?;
        if font_handle == 0 || metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let scale = f64::from(style.font_size) / f64::from(metrics.units_per_em);
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
            self.semantic_glyphs.push(SemanticGlyph {
                stable_id,
                font_handle,
                cluster,
                glyph_id: u16::try_from(glyph_id).map_err(|_| EngineError::ResultTooLarge)?,
                flags,
                font_size: style.font_size,
                inline_origin: finite_f32(origin_inline)?,
                block_origin: finite_f32(origin_block)?,
            });
            if let Some(extents) = extents_for(font_handle, glyph_id) {
                let inline_start = origin_inline + f64::from(extents.x_min) * scale;
                let block_start = origin_block - f64::from(extents.y_max) * scale;
                let inline_extent = f64::from(extents.x_max - extents.x_min) * scale;
                let block_extent = f64::from(extents.y_max - extents.y_min) * scale;
                self.push_glyph(
                    LayoutGlyph {
                        stable_id,
                        content_revision: 0,
                        binding_handle,
                        font_handle,
                        glyph_id,
                        semantic_id,
                        material_id: style.material_id,
                        clip_id: line.clip_id,
                        depth_key: 0,
                        font_size: style.font_size,
                        raster_pixel_ratio: style.raster_pixel_ratio,
                        inline_start: finite_f32(inline_start)?,
                        block_start: finite_f32(block_start)?,
                        inline_extent: nonnegative_f32(inline_extent)?,
                        block_extent: nonnegative_f32(block_extent)?,
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
            || next.semantic_id != old.semantic_id
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
        for field in 0..SEMANTIC_U32_FIELD_COUNT {
            if self.semantic_u32[field][slot] != previous.semantic_u32[field][previous_slot] {
                mask |= 1 << (SEMANTIC_F32_FIELD_COUNT + field);
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

fn count_justification_spaces(
    text: &[u16],
    clusters: &ClusterArena,
    start: usize,
    mut end: usize,
) -> u32 {
    while end > start && cluster_is_space(text, clusters, end - 1) {
        end -= 1;
    }
    clusters.starts[start..end]
        .iter()
        .filter(|&&offset| text.get(offset as usize) == Some(&0x20))
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

#[allow(clippy::too_many_arguments)]
fn justification_adjustment(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    text: &[u16],
    clusters: &ClusterArena,
    cluster_start: usize,
    cluster_end: usize,
) -> (u32, f64) {
    let spaces = if line.align == ALIGN_JUSTIFY && !fragment.line.hard_break && !final_line {
        count_justification_spaces(text, clusters, cluster_start, cluster_end)
    } else {
        0
    };
    let available = (fragment.slot_end - fragment.slot_start - fragment.line.advance).max(0.0);
    (spaces, justification_space_advance(available, spaces))
}

pub(crate) fn positioned_fragment_advance(
    line: FlowLine,
    fragment: FlowFragment,
    final_line: bool,
    text: &[u16],
    clusters: &ClusterArena,
) -> Result<f64, EngineError> {
    let cluster_start =
        usize::try_from(fragment.line.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let cluster_end =
        usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    let (spaces, per_space) = justification_adjustment(
        line,
        fragment,
        final_line,
        text,
        clusters,
        cluster_start,
        cluster_end,
    );
    Ok(fragment.line.advance + per_space * f64::from(spaces))
}

fn justification_space_advance(available: f64, space_count: u32) -> f64 {
    if space_count == 0 {
        0.0
    } else {
        available / f64::from(space_count)
    }
}

fn cluster_is_space(text: &[u16], clusters: &ClusterArena, cluster: usize) -> bool {
    clusters
        .starts
        .get(cluster)
        .and_then(|offset| usize::try_from(*offset).ok())
        .and_then(|offset| text.get(offset))
        == Some(&0x20)
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
    use super::*;
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
    fn justification_expands_only_lines_with_expandable_spaces() {
        assert_eq!(justification_space_advance(22.0, 2), 11.0);
        assert_eq!(justification_space_advance(22.0, 0), 0.0);
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
            flags: vec![CLUSTER_SAFE_BEFORE, CLUSTER_SAFE_BEFORE, CLUSTER_HARD_BREAK],
            style_indexes: vec![0, 0, 0],
            source_runs: vec![0, 0, u32::MAX],
            binding_handles: vec![11, 11, 0],
            font_handles: vec![1, 1, 0],
            stable_ids: vec![10, 20, 30],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 0],
            glyph_indices: vec![0, 1],
            glyph_stable_ids: vec![100, 200],
            index_at: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
        let shape = ShapeArena {
            runs: vec![],
            glyph_ids: vec![1, 2],
            clusters: vec![0, 1],
            x_advances: vec![500, 500],
            y_advances: vec![0, 0],
            x_offsets: vec![0, 0],
            y_offsets: vec![0, 0],
            glyph_flags: vec![0, 0],
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
                &shape,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
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
                &shape,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
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
                &shape,
                &BoundaryShapeArena::default(),
                &styles,
                &bidi,
                &mut index,
                &mut next_revision,
                metrics,
                extents,
            )
            .unwrap();
        assert_eq!(pending.glyphs[0].content_revision, 3);
        assert_eq!(pending.glyphs[1].content_revision, 4);
        assert_eq!(next_revision, 5);

        let mut reordered = PositionedGlyphArena::default();
        reordered.glyphs.extend(active.glyphs.iter().rev().copied());
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
            binding_handle: 1,
            font_handle: 1,
            glyph_id: stable_id,
            semantic_id: stable_id,
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
