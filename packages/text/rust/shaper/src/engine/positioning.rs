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
    shaping_state::{ShapeArena, ShapingRun},
    style_state::StyleSegment,
};

pub(crate) const SEMANTIC_F32_FIELD_COUNT: usize = 6;
pub(crate) const SEMANTIC_U32_FIELD_COUNT: usize = 4;

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

#[derive(Default)]
pub(crate) struct PositionedGlyphArena {
    glyphs: Vec<LayoutGlyph>,
    semantic_f32: [Vec<f32>; SEMANTIC_F32_FIELD_COUNT],
    semantic_u32: [Vec<u32>; SEMANTIC_U32_FIELD_COUNT],
    visual_clusters: Vec<u32>,
    visual_levels: Vec<u8>,
    line_levels: Vec<u8>,
}

impl PositionedGlyphArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.glyphs, capacity)?;
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
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        identity_index: &mut IdentityIndex,
        next_content_revision: &mut u32,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.clear();
        self.reserve(shape.glyph_ids.len())?;
        for (line_index, line) in flow.lines.iter().copied().enumerate() {
            let fragments = line_fragments(flow, line)?;
            let Some(first) = fragments.first() else {
                continue;
            };
            let Some(last) = fragments.last() else {
                continue;
            };
            prepare_line_levels(
                &mut self.line_levels,
                bidi,
                first.line.text_start,
                last.line.text_end,
            )?;
            let final_line = flow
                .lines
                .get(line_index + 1)
                .is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
            for fragment in fragments.iter().copied() {
                self.position_fragment(
                    line,
                    fragment,
                    final_line,
                    text,
                    clusters,
                    runs,
                    shape,
                    styles,
                    bidi,
                    metrics_for,
                    extents_for,
                )?;
            }
        }
        self.assign_content_revisions(previous, identity_index, next_content_revision)
    }

    pub(crate) fn clear(&mut self) {
        self.glyphs.clear();
        for field in &mut self.semantic_f32 {
            field.clear();
        }
        for field in &mut self.semantic_u32 {
            field.clear();
        }
        self.visual_clusters.clear();
        self.visual_levels.clear();
        self.line_levels.clear();
    }

    pub(crate) fn glyphs(&self) -> &[LayoutGlyph] {
        &self.glyphs
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
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end = usize::try_from(fragment.line.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?;
        let visual_start = self.visual_clusters.len();
        for cluster in cluster_start..cluster_end {
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

        let available = (fragment.slot_end - fragment.slot_start - fragment.line.advance).max(0.0);
        let paragraph_level = paragraph_level_at(bidi, fragment.line.text_start);
        let justify_spaces = if line.align == ALIGN_JUSTIFY
            && !fragment.line.hard_break
            && !final_line
        {
            count_justification_spaces(text, clusters, cluster_start, cluster_end)
        } else {
            0
        };
        let per_space = if justify_spaces == 0 {
            0.0
        } else {
            available / f64::from(justify_spaces)
        };
        let offset = if per_space == 0.0 {
            alignment_offset(line.align, paragraph_level, available)
        } else {
            0.0
        };
        let mut cursor = fragment.slot_start + offset;
        let baseline = line.block_start + line.baseline;
        for visual in visual_start..self.visual_clusters.len() {
            let cluster = usize::try_from(self.visual_clusters[visual])
                .map_err(|_| EngineError::InvalidRequest)?;
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
                if let Some(extents) = extents_for(font_handle, glyph_id) {
                    let origin_inline = cursor + x_offset;
                    let origin_block = baseline - y_offset - f64::from(style.baseline_shift);
                    let inline_start = origin_inline + f64::from(extents.x_min) * scale;
                    let block_start = origin_block - f64::from(extents.y_max) * scale;
                    let inline_extent = f64::from(extents.x_max - extents.x_min) * scale;
                    let block_extent = f64::from(extents.y_max - extents.y_min) * scale;
                    self.push_glyph(
                        LayoutGlyph {
                            stable_id: *clusters
                                .glyph_stable_ids
                                .get(adjacency)
                                .ok_or(EngineError::InvalidRequest)?,
                            content_revision: 0,
                            font_handle,
                            glyph_id,
                            semantic_id: clusters.stable_ids[cluster],
                            material_id: style.material_id,
                            clip_id: line.region_id,
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
                    );
                }
                cursor += x_advance;
            }
            cursor = cluster_origin + clusters.advances[cluster];
            if per_space != 0.0 && cluster_is_space(text, clusters, cluster) {
                cursor += per_space;
            }
        }
        Ok(())
    }

    fn push_glyph(
        &mut self,
        glyph: LayoutGlyph,
        foreground: u32,
        cluster: u32,
        region: u32,
        flow_thread: u32,
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
        let u32_values = [foreground, cluster, region, flow_thread];
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
            let revision = if let Some(previous_slot) = previous_slot
                .filter(|&previous_slot| self.same_content(slot, previous, previous_slot))
            {
                previous.glyphs[previous_slot].content_revision
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
        }
        Ok(())
    }

    fn same_content(&self, slot: usize, previous: &Self, previous_slot: usize) -> bool {
        let next = self.glyphs[slot];
        let old = previous.glyphs[previous_slot];
        next.stable_id == old.stable_id
            && next.font_handle == old.font_handle
            && next.glyph_id == old.glyph_id
            && next.semantic_id == old.semantic_id
            && next.material_id == old.material_id
            && next.clip_id == old.clip_id
            && next.depth_key == old.depth_key
            && next.font_size.to_bits() == old.font_size.to_bits()
            && next.raster_pixel_ratio.to_bits() == old.raster_pixel_ratio.to_bits()
            && next.inline_start.to_bits() == old.inline_start.to_bits()
            && next.block_start.to_bits() == old.block_start.to_bits()
            && next.inline_extent.to_bits() == old.inline_extent.to_bits()
            && next.block_extent.to_bits() == old.block_extent.to_bits()
            && (0..SEMANTIC_F32_FIELD_COUNT).all(|field| {
                self.semantic_f32[field][slot].to_bits()
                    == previous.semantic_f32[field][previous_slot].to_bits()
            })
            && (0..SEMANTIC_U32_FIELD_COUNT).all(|field| {
                self.semantic_u32[field][slot] == previous.semantic_u32[field][previous_slot]
            })
    }
}

fn line_fragments(
    flow: &FlowLayoutArena,
    line: FlowLine,
) -> Result<&[FlowFragment], EngineError> {
    let start = usize::try_from(line.fragment_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::from(line.fragment_count))
        .ok_or(EngineError::InvalidRequest)?;
    flow.fragments
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)
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
    let source = usize::try_from(clusters.source_runs[cluster])
        .map_err(|_| EngineError::InvalidRequest)?;
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
        cluster_state::CLUSTER_SAFE_BEFORE,
        line_composition::ComposedLine,
        style_state::ResolvedStyle,
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
    fn positions_once_and_revisions_only_exact_content_changes() {
        let text = vec![0x61, 0x62];
        let style = ResolvedStyle::test_typography(10.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
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
            starts: vec![0, 1],
            ends: vec![1, 2],
            advances: vec![6.0, 6.0],
            flags: vec![CLUSTER_SAFE_BEFORE; 2],
            style_indexes: vec![0, 0],
            source_runs: vec![0, 0],
            font_handles: vec![1, 1],
            stable_ids: vec![10, 20],
            glyph_starts: vec![0, 1],
            glyph_counts: vec![1, 1],
            glyph_indices: vec![0, 1],
            glyph_stable_ids: vec![100, 200],
            index_at: vec![0, 1, 2],
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
            levels: vec![0, 0],
            classes: vec![0, 0],
            paragraph_starts: vec![0],
            paragraph_ends: vec![2],
            paragraph_levels: vec![0],
            runs: vec![],
        };
        let mut flow = FlowLayoutArena {
            lines: vec![FlowLine {
                flow_thread_id: 7,
                region_id: 9,
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
                    cluster_end: 2,
                    text_start: 0,
                    text_end: 2,
                    advance: 12.0,
                    hard_break: false,
                },
                slot_start: 0.0,
                slot_end: 20.0,
            }],
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
    }
}
