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

#[path = "positioning_ink.rs"]
mod ink;
#[path = "positioning_segments.rs"]
mod segments;

#[cfg(test)]
pub(crate) const SEMANTIC_F32_BASE_FIELD_COUNT: usize = 6;
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

/// A span may cross clusters only when visual order maps to a contiguous source
/// interval in one direction and every coarse projection/placement fact agrees.
fn append_occurrence_span(
    spans: &mut Vec<OccurrenceSpan>,
    semantic_count: &mut u32,
    outlined_count: &mut u32,
    mut next: OccurrenceSpan,
    outlined: u32,
) -> Result<(), EngineError> {
    let semantic_end = (*semantic_count)
        .checked_add(next.source_glyph_count)
        .ok_or(EngineError::ResultTooLarge)?;
    let outlined_end = (*outlined_count)
        .checked_add(outlined)
        .ok_or(EngineError::ResultTooLarge)?;
    let merge = spans.last().is_some_and(|last| {
        last.source == GlyphSource::LayoutRun
            && next.source == GlyphSource::LayoutRun
            && last.cluster_order == next.cluster_order
            && last.cluster_order != ClusterOrder::Single
            && last.run_owner == next.run_owner
            && last.run_index == next.run_index
            && last.placement_segment == next.placement_segment
            && last.cluster_override == next.cluster_override
            && last.line == next.line
            && last.line_facts == next.line_facts
            && last.font_handle == next.font_handle
            && last.binding_handle == next.binding_handle
            && last.font_size.to_bits() == next.font_size.to_bits()
            && last.bidi_level == next.bidi_level
            && match last.cluster_order {
                ClusterOrder::Forward => {
                    last.owner_cluster.checked_add(last.cluster_count) == Some(next.owner_cluster)
                        && last.source_glyph_start.checked_add(last.source_glyph_count)
                            == Some(next.source_glyph_start)
                }
                ClusterOrder::Reverse => {
                    next.owner_cluster.checked_add(last.cluster_count) == Some(last.owner_cluster)
                        && next.source_glyph_start.checked_add(next.source_glyph_count)
                            == Some(last.source_glyph_start)
                }
                ClusterOrder::Single => false,
            }
    });
    if merge {
        let last = spans.last_mut().ok_or(EngineError::InvalidRequest)?;
        let merged_count = last
            .source_glyph_count
            .checked_add(next.source_glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        let merged_outlined = last
            .outlined_count
            .checked_add(outlined)
            .ok_or(EngineError::ResultTooLarge)?;
        let merged_clusters = last
            .cluster_count
            .checked_add(next.cluster_count)
            .ok_or(EngineError::ResultTooLarge)?;
        if last.cluster_order == ClusterOrder::Reverse {
            last.source_glyph_start = next.source_glyph_start;
        }
        last.source_glyph_count = merged_count;
        last.outlined_count = merged_outlined;
        last.cluster_count = merged_clusters;
    } else {
        next.semantic_start = *semantic_count;
        next.outlined_start = *outlined_count;
        next.outlined_count = outlined;
        reserve(spans, 1)?;
        spans.push(next);
    }
    *semantic_count = semantic_end;
    *outlined_count = outlined_end;
    Ok(())
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

impl<'a> OutlinedOccurrenceCursor<'a> {
    pub(crate) fn seek(&mut self, index: usize) -> Result<(), EngineError> {
        let index = u32::try_from(index).map_err(|_| EngineError::InvalidRequest)?;
        if index > self.positioned.occurrence_outlined_count {
            return Err(EngineError::InvalidRequest);
        }
        self.span_index = self
            .positioned
            .occurrence_spans
            .partition_point(|span| span.outlined_start + span.outlined_count <= index);
        self.cluster_offset = 0;
        self.source_next = 0;
        self.outlined_index = index;
        let Some(span) = self.positioned.occurrence_spans.get(self.span_index) else {
            return Ok(());
        };
        let rank = index - span.outlined_start;
        let local = match span.source {
            GlyphSource::LayoutRun => self.clusters.run_local(),
            GlyphSource::Boundary => &self.positioned.replacement_run_local,
        };
        let span_end = span
            .source_glyph_start
            .checked_add(span.source_glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        let mut low = 0_u32;
        let mut high = span.cluster_count;
        while low < high {
            let middle = low + (high - low) / 2;
            #[cfg(test)]
            super::work_attribution::record(|work| work.outlined_seek_cluster_probes += 1);
            let cluster = match span.cluster_order {
                ClusterOrder::Single => span.owner_cluster,
                ClusterOrder::Forward => span.owner_cluster + middle,
                ClusterOrder::Reverse => span.owner_cluster - middle,
            };
            let (start, end) = if span.cluster_order == ClusterOrder::Single {
                (span.source_glyph_start, span_end)
            } else {
                let cluster = usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
                let start = self.clusters.glyph_starts[cluster];
                (start, start + self.clusters.glyph_counts[cluster])
            };
            let through = if span.cluster_order == ClusterOrder::Reverse {
                local.source_range_counts(start, span_end - start)
            } else {
                local.source_range_counts(span.source_glyph_start, end - span.source_glyph_start)
            }
            .ok_or(EngineError::InvalidRequest)?
            .1;
            if through <= rank {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        self.cluster_offset = low;
        let cluster = match span.cluster_order {
            ClusterOrder::Single => span.owner_cluster,
            ClusterOrder::Forward => span.owner_cluster + low,
            ClusterOrder::Reverse => span.owner_cluster - low,
        };
        let (start, end) = if span.cluster_order == ClusterOrder::Single {
            (span.source_glyph_start, span_end)
        } else {
            let cluster = usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
            let start = self.clusters.glyph_starts[cluster];
            (start, start + self.clusters.glyph_counts[cluster])
        };
        let before = if span.cluster_order == ClusterOrder::Reverse {
            local.source_range_counts(end, span_end - end)
        } else {
            local.source_range_counts(span.source_glyph_start, start - span.source_glyph_start)
        }
        .ok_or(EngineError::InvalidRequest)?
        .1;
        self.source_next = local
            .select_outlined_source(start, end, rank - before)
            .ok_or(EngineError::InvalidRequest)?;
        #[cfg(test)]
        if self.source_next != 0 {
            super::work_attribution::record(|work| work.outlined_cluster_visits += 1);
        }
        self.semantic_base = span.semantic_start
            + if span.cluster_order == ClusterOrder::Reverse {
                span_end - end
            } else {
                start - span.source_glyph_start
            };
        Ok(())
    }

    /// Advancing visits spans, outline words, and clusters within mixed spans,
    /// including clusters without outlines; it does not project unoutlined glyph rows.
    /// The mark can be projected later by the same source kernel.
    pub(crate) fn next_mark(&mut self) -> Result<Option<OutlinedOccurrenceMark>, EngineError> {
        loop {
            let Some(span) = self.positioned.occurrence_spans.get(self.span_index) else {
                return Ok(None);
            };
            if span.outlined_count == 0 || self.cluster_offset == span.cluster_count {
                self.span_index += 1;
                self.cluster_offset = 0;
                self.source_next = 0;
                continue;
            }
            let cluster = match span.cluster_order {
                ClusterOrder::Single => span.owner_cluster,
                ClusterOrder::Forward => span
                    .owner_cluster
                    .checked_add(self.cluster_offset)
                    .ok_or(EngineError::ResultTooLarge)?,
                ClusterOrder::Reverse => span
                    .owner_cluster
                    .checked_sub(self.cluster_offset)
                    .ok_or(EngineError::InvalidRequest)?,
            };
            #[cfg(test)]
            if self.source_next == 0 {
                super::work_attribution::record(|work| work.outlined_cluster_visits += 1);
            }
            let (start, end) = if span.cluster_order == ClusterOrder::Single {
                (
                    span.source_glyph_start,
                    span.source_glyph_start
                        .checked_add(span.source_glyph_count)
                        .ok_or(EngineError::ResultTooLarge)?,
                )
            } else {
                let index = usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
                let start = *self
                    .clusters
                    .glyph_starts
                    .get(index)
                    .ok_or(EngineError::InvalidRequest)?;
                let count = *self
                    .clusters
                    .glyph_counts
                    .get(index)
                    .ok_or(EngineError::InvalidRequest)?;
                (
                    start,
                    start
                        .checked_add(count)
                        .ok_or(EngineError::ResultTooLarge)?,
                )
            };
            if self.source_next == 0 {
                self.source_next = start;
                self.semantic_base = if self.cluster_offset == 0 {
                    span.semantic_start
                } else {
                    self.semantic_base
                };
            }
            let local = match span.source {
                GlyphSource::LayoutRun => self.clusters.run_local(),
                GlyphSource::Boundary => &self.positioned.replacement_run_local,
            };
            if let Some(source_glyph) = local.next_outlined_source(self.source_next, end) {
                #[cfg(test)]
                super::work_attribution::record(|work| work.outlined_mark_visits += 1);
                self.source_next = source_glyph
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.outlined_index = self
                    .outlined_index
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                return Ok(Some(OutlinedOccurrenceMark {
                    span_index: self.span_index,
                    source_glyph,
                    owner_cluster: cluster,
                    semantic_index: self
                        .semantic_base
                        .checked_add(source_glyph - start)
                        .ok_or(EngineError::ResultTooLarge)?,
                }));
            }
            self.semantic_base = self
                .semantic_base
                .checked_add(end - start)
                .ok_or(EngineError::ResultTooLarge)?;
            self.cluster_offset += 1;
            self.source_next = 0;
        }
    }

    pub(crate) fn project(
        &self,
        mark: OutlinedOccurrenceMark,
    ) -> Result<ProjectedOccurrence<'a>, EngineError> {
        self.positioned
            .project_outlined_mark(mark, self.clusters, self.boundary)
    }
}

#[allow(dead_code)] // Additional provenance is checked by the proof oracle; queries use semantic.
pub(crate) struct ProjectedOccurrence<'a> {
    pub semantic: PositionedSemanticGlyph,
    pub has_outline: bool,
    pub span: &'a OccurrenceSpan,
    pub owner_cluster: u32,
}

impl<'a> OccurrenceCursor<'a> {
    pub(crate) fn next_row(&mut self) -> Result<Option<ProjectedOccurrence<'a>>, EngineError> {
        let positioned: &'a PositionedGlyphArena = self.positioned;
        let Some(span) = positioned.occurrence_spans.get(self.span_index) else {
            return Ok(None);
        };
        let source_glyph = match self.source_glyph {
            Some(source) => source,
            None if span.cluster_order == ClusterOrder::Single => {
                self.owner_cluster =
                    usize::try_from(span.owner_cluster).map_err(|_| EngineError::InvalidRequest)?;
                span.source_glyph_start
                    .checked_add(self.offset)
                    .ok_or(EngineError::ResultTooLarge)?
            }
            None if self.offset == 0 => {
                self.owner_cluster =
                    usize::try_from(span.owner_cluster).map_err(|_| EngineError::InvalidRequest)?;
                *self
                    .clusters
                    .glyph_starts
                    .get(self.owner_cluster)
                    .ok_or(EngineError::InvalidRequest)?
            }
            None => {
                let end = span
                    .source_glyph_start
                    .checked_add(span.source_glyph_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                let probe = if span.cluster_order == ClusterOrder::Forward {
                    span.source_glyph_start.checked_add(self.offset)
                } else {
                    end.checked_sub(self.offset + 1)
                }
                .ok_or(EngineError::InvalidRequest)?;
                let cluster = self
                    .clusters
                    .glyph_starts
                    .partition_point(|&start| start <= probe)
                    .checked_sub(1)
                    .ok_or(EngineError::InvalidRequest)?;
                let cluster_start = *self
                    .clusters
                    .glyph_starts
                    .get(cluster)
                    .ok_or(EngineError::InvalidRequest)?;
                let cluster_end = cluster_start
                    .checked_add(
                        *self
                            .clusters
                            .glyph_counts
                            .get(cluster)
                            .ok_or(EngineError::InvalidRequest)?,
                    )
                    .ok_or(EngineError::ResultTooLarge)?;
                if probe >= cluster_end {
                    return Err(EngineError::InvalidRequest);
                }
                self.owner_cluster = cluster;
                if span.cluster_order == ClusterOrder::Forward {
                    probe
                } else {
                    let visual_start = end
                        .checked_sub(cluster_end)
                        .ok_or(EngineError::InvalidRequest)?;
                    cluster_start
                        .checked_add(
                            self.offset
                                .checked_sub(visual_start)
                                .ok_or(EngineError::InvalidRequest)?,
                        )
                        .ok_or(EngineError::ResultTooLarge)?
                }
            }
        };
        let projection = project_occurrence_source(
            positioned,
            self.clusters,
            self.boundary,
            span,
            source_glyph,
            u32::try_from(self.owner_cluster).map_err(|_| EngineError::ResultTooLarge)?,
        )?;
        self.offset += 1;
        if self.offset == span.source_glyph_count {
            self.offset = 0;
            self.span_index += 1;
            self.source_glyph = None;
        } else if span.cluster_order == ClusterOrder::Single {
            self.source_glyph = source_glyph.checked_add(1);
        } else {
            let cluster_start = *self
                .clusters
                .glyph_starts
                .get(self.owner_cluster)
                .ok_or(EngineError::InvalidRequest)?;
            let cluster_end = cluster_start
                .checked_add(
                    *self
                        .clusters
                        .glyph_counts
                        .get(self.owner_cluster)
                        .ok_or(EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            if source_glyph
                .checked_add(1)
                .is_some_and(|next| next < cluster_end)
            {
                self.source_glyph = source_glyph.checked_add(1);
            } else {
                let next_cluster = match span.cluster_order {
                    ClusterOrder::Forward => (self.owner_cluster + 1
                        ..self.clusters.glyph_counts.len())
                        .find(|&cluster| self.clusters.glyph_counts[cluster] != 0),
                    ClusterOrder::Reverse => (0..self.owner_cluster)
                        .rev()
                        .find(|&cluster| self.clusters.glyph_counts[cluster] != 0),
                    ClusterOrder::Single => None,
                }
                .ok_or(EngineError::InvalidRequest)?;
                self.owner_cluster = next_cluster;
                self.source_glyph = self.clusters.glyph_starts.get(next_cluster).copied();
            }
        }
        Ok(Some(projection))
    }
}

/// The only source-to-occurrence projection kernel; both semantic and outlined
/// visitors pass the exact row owner rather than the first cluster of a merged span.
fn project_occurrence_source<'a>(
    positioned: &'a PositionedGlyphArena,
    clusters: &'a ClusterArena,
    boundary: &'a BoundaryShapeArena,
    span: &'a OccurrenceSpan,
    source_glyph: u32,
    owner_cluster: u32,
) -> Result<ProjectedOccurrence<'a>, EngineError> {
    #[cfg(test)]
    super::work_attribution::record(|work| work.occurrence_projection_rows += 1);
    let source_index = usize::try_from(source_glyph).map_err(|_| EngineError::InvalidRequest)?;
    let (stable_id, glyph_id, cluster, flags, local) = match span.source {
        GlyphSource::LayoutRun => (
            *clusters
                .glyph_stable_ids
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            *clusters
                .glyph_ids
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            *clusters
                .glyph_clusters
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            *clusters
                .glyph_shape_flags
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            clusters
                .run_local()
                .row_for_source_glyph(source_glyph)
                .ok_or(EngineError::InvalidRequest)?,
        ),
        GlyphSource::Boundary => (
            *boundary
                .stable_ids
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            *boundary
                .shape
                .glyph_ids
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            span.cluster_override.unwrap_or(
                *boundary
                    .shape
                    .clusters
                    .get(source_index)
                    .ok_or(EngineError::InvalidRequest)?,
            ),
            *boundary
                .shape
                .glyph_flags
                .get(source_index)
                .ok_or(EngineError::InvalidRequest)?,
            positioned
                .replacement_run_local
                .row_for_source_glyph(source_glyph)
                .ok_or(EngineError::InvalidRequest)?,
        ),
    };
    let row = PositionedSemanticGlyph {
        stable_id,
        font_handle: span.font_handle,
        cluster,
        glyph_id,
        flags,
        bidi_level: span.bidi_level,
        font_size: span.font_size,
        inline_origin: local.inline_origin,
        block_origin: local.block_origin,
        inline_advance: local.inline_advance,
        ink_inline_start: local.ink_inline_start,
        ink_block_start: local.ink_block_start,
        ink_inline_extent: local.ink_inline_extent,
        ink_block_extent: local.ink_block_extent,
        placement_segment: span.placement_segment,
    };
    Ok(ProjectedOccurrence {
        semantic: row,
        has_outline: local.has_outline,
        span,
        owner_cluster,
    })
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

impl ProjectedSourceRow<'_> {
    pub(crate) fn f32(self, field: usize) -> Option<f32> {
        let inverse_font_size = || 1.0 / self.style.font_size;
        match field {
            0 => Some(self.semantic.ink_inline_start),
            1 => Some(self.semantic.ink_block_start),
            2 => Some(self.semantic.ink_inline_extent),
            3 => Some(self.semantic.ink_block_extent),
            4 => Some(self.semantic.font_size),
            5 => Some(self.style.raster_pixel_ratio),
            6 if self.text_effects => Some(self.style.outline_width * inverse_font_size()),
            7 if self.text_effects => Some(self.style.shadow_offset_x * inverse_font_size()),
            8 if self.text_effects => Some(self.style.shadow_offset_y * inverse_font_size()),
            6..=8 => Some(0.0),
            _ => None,
        }
    }

    pub(crate) fn u32(self, field: usize) -> Option<u32> {
        match field {
            0 => Some(apply_opacity(
                self.style.foreground_rgba,
                self.style.opacity,
            )),
            1 => Some(self.stable_cluster),
            2 => Some(self.line_facts.region_id),
            3 => Some(self.line_facts.flow_thread_id),
            4 => Some(self.line_facts.transform_index),
            5 => Some(self.semantic.stable_id),
            6 if self.text_effects => {
                Some(apply_opacity(self.style.outline_rgba, self.style.opacity))
            }
            7 if self.text_effects => {
                Some(apply_opacity(self.style.shadow_rgba, self.style.opacity))
            }
            6..=7 => Some(0),
            _ => None,
        }
    }
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

pub(crate) fn projected_semantic_row<'a>(
    semantic: PositionedSemanticGlyph,
    semantic_index: u32,
    placement_slot: u32,
    owner: ProjectedRowOwner<'a>,
) -> ProjectedSourceRow<'a> {
    let ProjectedRowOwner {
        binding_handle,
        style,
        line_facts,
        stable_cluster,
        text_effects,
    } = owner;
    ProjectedSourceRow {
        glyph: LayoutGlyph {
            stable_id: semantic.stable_id,
            content_revision: 0,
            placement_slot,
            semantic_glyph_index: semantic_index,
            binding_handle,
            font_handle: semantic.font_handle,
            glyph_id: u32::from(semantic.glyph_id),
            material_id: style.material_id,
            clip_id: line_facts.clip_id,
            depth_key: PAINT_LAYER_GLYPH,
            font_size: semantic.font_size,
            raster_pixel_ratio: style.raster_pixel_ratio,
            inline_start: semantic.inline_origin,
            block_start: semantic.block_origin,
            inline_extent: semantic.ink_inline_extent,
            block_extent: semantic.ink_block_extent,
        },
        semantic,
        style,
        line_facts,
        stable_cluster,
        text_effects,
    }
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
struct ActiveFallbackPlacement {
    layout_run_index: usize,
    cluster: usize,
    direction: u8,
    placement_cluster: PlacementCluster,
    occurrence: PlacementOccurrence,
}

struct PositionedCluster {
    style: ResolvedStyle,
    font_handle: u32,
    cluster_origin: f64,
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

impl SegmentWalk {
    #[inline(always)]
    fn cluster(self, offset: usize) -> usize {
        if self.reverse {
            self.first - offset
        } else {
            self.first + offset
        }
    }
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

fn merge_recomposed_glyphs(
    current: &mut Vec<core::ops::Range<usize>>,
    previous: &[core::ops::Range<usize>],
) -> Result<(), EngineError> {
    let current_len = current.len();
    let merged_len = current_len
        .checked_add(previous.len())
        .ok_or(EngineError::ResultTooLarge)?;
    current
        .try_reserve(previous.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    current.resize(merged_len, 0..0);
    let (mut left, mut right) = (current_len, previous.len());
    // Both producers order by start. Filling backward never overwrites the unread
    // current prefix: the destination is at or after its last unread element.
    for write in (0..merged_len).rev() {
        if right == 0 || (left != 0 && current[left - 1].start >= previous[right - 1].start) {
            left -= 1;
            current[write] = current[left].clone();
        } else {
            right -= 1;
            current[write] = previous[right].clone();
        }
    }
    let mut write = 0;
    for read in 0..merged_len {
        let range = current[read].clone();
        if write != 0 && current[write - 1].end >= range.start {
            current[write - 1].end = current[write - 1].end.max(range.end);
        } else {
            current[write] = range;
            write += 1;
        }
    }
    current.truncate(write);
    Ok(())
}

fn replacement_index(key: u64) -> usize {
    // pack2 stores the checked u32 source index in the low word.
    (key as u32) as usize
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
    font_size: f32,
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
        )
    }

    fn for_values(
        font_handle: u32,
        units_per_em: f64,
        font_size: f32,
    ) -> Result<Self, EngineError> {
        if font_handle == 0 || units_per_em == 0.0 {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Self {
            font_handle,
            font_size,
        })
    }
}

// Count completed payload copies, including field columns, at the native test target's layout.
// This excludes allocation capacity, line metadata, and zero-filled effect columns.
#[cfg(test)]
fn record_positioned_copy(decorations: usize) {
    super::work_attribution::record(|work| {
        work.copied_positioned_bytes += decorations * core::mem::size_of::<DecorationRecord>();
    });
}

impl RetainedOccurrenceProof<'_> {
    /// Admission happens inside PlacementState's checkpoint, before retaining spans
    /// and copying the line's decoration records.
    /// The dirty-range producer marks every changed cluster and flow recomposes its line;
    /// an admitted clean body span therefore retains its shaped glyph inputs. Placement
    /// correspondence separately proves the same numeric block, prefix, and anchor.
    /// The equivalent-line path has no dirty-range proof and requires the exact run token.
    fn append(
        mut self,
        placement: &PlacementState,
        remap: RetainedSegmentRemap,
    ) -> Result<(), EngineError> {
        let checkpoint = (
            self.spans.len(),
            self.spans.last().copied(),
            *self.semantic_count,
            *self.outlined_count,
        );
        let result = self.append_inner(placement, remap);
        if result.is_err() {
            self.spans.truncate(checkpoint.0);
            if let Some(last) = checkpoint.1 {
                self.spans[checkpoint.0 - 1] = last;
            }
            *self.semantic_count = checkpoint.2;
            *self.outlined_count = checkpoint.3;
        }
        result
    }

    fn append_inner(
        &mut self,
        placement: &PlacementState,
        remap: RetainedSegmentRemap,
    ) -> Result<(), EngineError> {
        let start = *self
            .previous
            .semantic_line_glyph_starts
            .get(self.line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let count = *self
            .previous
            .semantic_line_glyph_counts
            .get(self.line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let end = start
            .checked_add(count)
            .ok_or(EngineError::ResultTooLarge)?;
        let first = self
            .previous
            .occurrence_spans
            .partition_point(|span| span.semantic_start + span.source_glyph_count <= start);
        let last = self
            .previous
            .occurrence_spans
            .partition_point(|span| span.semantic_start < end);
        self.spans
            .try_reserve(last - first)
            .map_err(|_| EngineError::ResultTooLarge)?;
        let mut covered = 0_u32;
        let mut outlined_total = 0_u32;
        for old in self.previous.occurrence_spans[first..last].iter().copied() {
            #[cfg(test)]
            super::work_attribution::record(|work| work.retained_occurrence_span_visits += 1);
            if old.semantic_start < start
                || old
                    .semantic_start
                    .checked_add(old.source_glyph_count)
                    .is_none_or(|value| value > end)
            {
                return Err(EngineError::InvalidRequest);
            }
            let segment_offset = old
                .placement_segment
                .checked_sub(remap.previous_start)
                .filter(|offset| *offset < remap.count)
                .ok_or(EngineError::InvalidRequest)?;
            let next_segment = remap
                .next_start
                .checked_add(segment_offset)
                .ok_or(EngineError::ResultTooLarge)?;
            let next_placement = *placement
                .segment_rows()
                .get(usize::try_from(next_segment).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            let old_placement = *self
                .previous
                .placement
                .segment_rows()
                .get(
                    usize::try_from(old.placement_segment)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            if old.source != next_placement.glyph_source
                || old.run_owner != next_placement.layout_run_owner
                || old.run_index != old_placement.layout_run_index
            {
                return Err(EngineError::InvalidRequest);
            }
            let (previous_runs, next_runs, previous_local, next_local) = match old.run_owner {
                LayoutRunOwner::Paragraph => (
                    self.previous_clusters.layout_runs(),
                    self.clusters.layout_runs(),
                    self.previous_clusters.run_local(),
                    self.clusters.run_local(),
                ),
                LayoutRunOwner::Replacement => (
                    self.previous.replacement_runs.as_slice(),
                    self.replacement_runs,
                    &self.previous.replacement_run_local,
                    self.replacement_local,
                ),
            };
            let old_run = *previous_runs
                .get(usize::try_from(old.run_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            let next_run = *next_runs
                .get(
                    usize::try_from(next_placement.layout_run_index)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            if old_run.canonical_revision.is_none()
                || old_run.canonical_revision != old_placement.canonical_revision
                || next_run.canonical_revision != next_placement.canonical_revision
                || old_run.source_kind != next_run.source_kind
                || old_run.cluster_start != next_run.cluster_start
                || old_run.font_handle != next_run.font_handle
                || old.font_handle != next_run.font_handle
                || (!self.clean_line && old_run.canonical_revision != next_run.canonical_revision)
            {
                return Err(EngineError::InvalidRequest);
            }
            if old.source == GlyphSource::Boundary {
                // Replacement tokens come from same_boundary_run. Its relative cluster
                // comparison needs the absolute base too when projecting retained occurrences.
                let current_boundary_index = *self
                    .replacement_run_boundary_indices
                    .get(
                        usize::try_from(next_placement.layout_run_index)
                            .map_err(|_| EngineError::InvalidRequest)?,
                    )
                    .ok_or(EngineError::InvalidRequest)?;
                let previous_boundary_index = *self
                    .previous
                    .replacement_run_boundary_indices
                    .get(usize::try_from(old.run_index).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)?;
                let current = self
                    .boundary
                    .records
                    .get(
                        usize::try_from(current_boundary_index)
                            .map_err(|_| EngineError::InvalidRequest)?,
                    )
                    .ok_or(EngineError::InvalidRequest)?;
                let previous = self
                    .previous_boundary
                    .records
                    .get(
                        usize::try_from(previous_boundary_index)
                            .map_err(|_| EngineError::InvalidRequest)?,
                    )
                    .ok_or(EngineError::InvalidRequest)?;
                if current.line_start
                    || previous.line_start
                    || current.flow_thread_id != self.target.body.line.flow_thread_id
                    || current.flow_thread_id != previous.flow_thread_id
                {
                    return Err(EngineError::InvalidRequest);
                }
                let (binding, override_cluster) = match old_run.source_kind {
                    LayoutRunSourceKind::Boundary {
                        role: BoundaryRunRole::BoundarySource,
                        ..
                    } => (current.source_binding_handle, None),
                    LayoutRunSourceKind::Boundary {
                        role: BoundaryRunRole::Ellipsis,
                        ..
                    } => (current.ellipsis_binding_handle, Some(current.text_end)),
                    _ => return Err(EngineError::InvalidRequest),
                };
                if old_run.canonical_revision != next_run.canonical_revision
                    || old.binding_handle != binding
                    || old.cluster_override != override_cluster
                    || previous.text_end != current.text_end
                    || self
                        .previous_boundary
                        .shape
                        .clusters
                        .get(old_run.glyph_start as usize)
                        != self
                            .boundary
                            .shape
                            .clusters
                            .get(next_run.glyph_start as usize)
                {
                    return Err(EngineError::InvalidRequest);
                }
            }
            let source_offset = old
                .source_glyph_start
                .checked_sub(old_run.glyph_start)
                .ok_or(EngineError::InvalidRequest)?;
            let source_glyph_start = next_run
                .glyph_start
                .checked_add(source_offset)
                .ok_or(EngineError::ResultTooLarge)?;
            let source_end = source_offset
                .checked_add(old.source_glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            if source_end > next_run.glyph_count {
                return Err(EngineError::InvalidRequest);
            }
            let (source_covered, outlined) = next_local
                .source_range_counts(source_glyph_start, old.source_glyph_count)
                .ok_or(EngineError::InvalidRequest)?;
            if source_covered != old.source_glyph_count
                || outlined != old.outlined_count
                || !previous_local
                    .same_outline_pattern(
                        old.source_glyph_start,
                        next_local,
                        source_glyph_start,
                        old.source_glyph_count,
                    )
                    .ok_or(EngineError::InvalidRequest)?
            {
                return Err(EngineError::InvalidRequest);
            }
            let target_line = match old.line {
                SourceLine::Body(_) => self.target.body,
                SourceLine::DropCap(_) => {
                    self.target.drop_cap.ok_or(EngineError::InvalidRequest)?
                }
            };
            let line = match old.line {
                SourceLine::Body(_) => SourceLine::Body(
                    u32::try_from(target_line.index).map_err(|_| EngineError::ResultTooLarge)?,
                ),
                SourceLine::DropCap(_) => SourceLine::DropCap(
                    u32::try_from(target_line.index).map_err(|_| EngineError::ResultTooLarge)?,
                ),
            };
            let owner_cluster = if old.source == GlyphSource::Boundary {
                // Ellipsis fallback ownership may sit just outside the replacement
                // run's (possibly empty) source-cluster interval.
                old.owner_cluster
            } else {
                let owner_offset = old
                    .owner_cluster
                    .checked_sub(old_run.cluster_start)
                    .ok_or(EngineError::InvalidRequest)?;
                next_run
                    .cluster_start
                    .checked_add(owner_offset)
                    .filter(|index| *index < next_run.cluster_end)
                    .ok_or(EngineError::InvalidRequest)?
            };
            covered = covered
                .checked_add(old.source_glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            outlined_total = outlined_total
                .checked_add(outlined)
                .ok_or(EngineError::ResultTooLarge)?;
            append_occurrence_span(
                self.spans,
                self.semantic_count,
                self.outlined_count,
                OccurrenceSpan {
                    source_glyph_start,
                    owner_cluster,
                    run_index: next_placement.layout_run_index,
                    placement_segment: next_segment,
                    line,
                    line_facts: SourceLineFacts::from(target_line.line),
                    ..old
                },
                outlined,
            )?;
        }
        if covered != count
            || outlined_total
                != *self
                    .previous
                    .line_glyph_counts
                    .get(self.line_index)
                    .ok_or(EngineError::InvalidRequest)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }
}

impl PositionedGlyphArena {
    fn push_occurrence_span(
        &mut self,
        span: OccurrenceSpan,
        run_local: &RunLocalArena,
    ) -> Result<u32, EngineError> {
        if span.source_glyph_count == 0 {
            return Ok(0);
        }
        let (covered, outlined) = run_local
            .source_range_counts(span.source_glyph_start, span.source_glyph_count)
            .ok_or(EngineError::InvalidRequest)?;
        if covered != span.source_glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        self.push_occurrence_span_with_counts(span, outlined)?;
        Ok(outlined)
    }

    fn push_occurrence_span_with_counts(
        &mut self,
        span: OccurrenceSpan,
        outlined: u32,
    ) -> Result<(), EngineError> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.occurrence_span_append_attempts += 1);
        append_occurrence_span(
            &mut self.occurrence_spans,
            &mut self.occurrence_semantic_count,
            &mut self.occurrence_outlined_count,
            span,
            outlined,
        )
    }

    pub(crate) fn occurrence_cursor<'a>(
        &'a self,
        start: usize,
        clusters: &'a ClusterArena,
        boundary: &'a BoundaryShapeArena,
    ) -> Result<OccurrenceCursor<'a>, EngineError> {
        let start = u32::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
        if start > self.occurrence_semantic_count {
            return Err(EngineError::InvalidRequest);
        }
        let span_index = self
            .occurrence_spans
            .partition_point(|span| span.semantic_start + span.source_glyph_count <= start);
        let offset = self
            .occurrence_spans
            .get(span_index)
            .map_or(0, |span| start - span.semantic_start);
        Ok(OccurrenceCursor {
            positioned: self,
            clusters,
            boundary,
            span_index,
            offset,
            source_glyph: None,
            owner_cluster: 0,
        })
    }

    pub(crate) fn outlined_count(&self) -> usize {
        self.occurrence_outlined_count as usize
    }

    pub(crate) fn outlined_cursor<'a>(
        &'a self,
        clusters: &'a ClusterArena,
        boundary: &'a BoundaryShapeArena,
    ) -> OutlinedOccurrenceCursor<'a> {
        OutlinedOccurrenceCursor {
            positioned: self,
            clusters,
            boundary,
            span_index: 0,
            cluster_offset: 0,
            source_next: 0,
            semantic_base: 0,
            outlined_index: 0,
        }
    }

    pub(crate) fn project_outlined_mark<'a>(
        &'a self,
        mark: OutlinedOccurrenceMark,
        clusters: &'a ClusterArena,
        boundary: &'a BoundaryShapeArena,
    ) -> Result<ProjectedOccurrence<'a>, EngineError> {
        let span = self
            .occurrence_spans
            .get(mark.span_index)
            .ok_or(EngineError::InvalidRequest)?;
        project_occurrence_source(
            self,
            clusters,
            boundary,
            span,
            mark.source_glyph,
            mark.owner_cluster,
        )
    }

    pub(crate) fn outlined_mark_stable_id(
        &self,
        mark: OutlinedOccurrenceMark,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
    ) -> Result<u32, EngineError> {
        let span = self
            .occurrence_spans
            .get(mark.span_index)
            .ok_or(EngineError::InvalidRequest)?;
        let index = usize::try_from(mark.source_glyph).map_err(|_| EngineError::InvalidRequest)?;
        match span.source {
            GlyphSource::LayoutRun => clusters.glyph_stable_ids.get(index).copied(),
            GlyphSource::Boundary => boundary.stable_ids.get(index).copied(),
        }
        .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn outlined_mark_segment(
        &self,
        mark: OutlinedOccurrenceMark,
    ) -> Result<u32, EngineError> {
        self.occurrence_spans
            .get(mark.span_index)
            .map(|span| span.placement_segment)
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn occurrence_spans(&self) -> &[OccurrenceSpan] {
        &self.occurrence_spans
    }

    #[cfg(test)]
    fn assert_occurrence_expansion(&self, clusters: &ClusterArena, boundary: &BoundaryShapeArena) {
        let mut cursor = self.occurrence_cursor(0, clusters, boundary).unwrap();
        let mut semantic_count = 0usize;
        let mut outlined_count = 0usize;
        while let Some(row) = cursor.next_row().unwrap() {
            semantic_count += 1;
            outlined_count += usize::from(row.has_outline);
        }
        assert_eq!(semantic_count, self.occurrence_count());
        assert_eq!(outlined_count, self.outlined_count());
        for (start, count) in self
            .semantic_line_glyph_starts
            .iter()
            .zip(&self.semantic_line_glyph_counts)
        {
            let end = start.checked_add(*count).unwrap();
            assert!(end <= self.occurrence_semantic_count);
        }
    }

    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.visual_clusters, capacity)?;
        reserve(&mut self.visual_levels, capacity)?;
        reserve(&mut self.line_levels, capacity)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        text: &[u16],
        clusters: &ClusterArena,
        previous_clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        _identity_index: &mut IdentityIndex,
        _next_content_revision: &mut u32,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.build_with_previous(
            previous,
            flow,
            retained_flow,
            recomposed_lines,
            text,
            clusters,
            previous_clusters,
            runs,
            previous_runs,
            boundary_shape,
            previous_boundary_shape,
            styles,
            bidi,
            next_run_canonical_revision,
            typography_for,
            retained_typography_for,
            metrics_for,
            extents_for,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_with_previous(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        text: &[u16],
        clusters: &ClusterArena,
        previous_clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        #[cfg(feature = "stage-bench")]
        let _clock = super::state::oracle::stage_bench::clock::POSITIONING.guard();
        // The callbacks are read per line, per decoration and per island glyph, never per
        // body glyph, so every caller shares one copy of the build behind trait objects.
        let typography_for: &dyn Fn(u32) -> ThreadTypography = &typography_for;
        let retained_typography_for: &dyn Fn(u32) -> ThreadTypography = &retained_typography_for;
        let metrics_for: &dyn Fn(u32) -> Option<FontMetrics> = &metrics_for;
        let extents_for: &dyn Fn(u32, u32) -> Option<FontGlyphExtents> = &extents_for;
        self.build_lines(
            previous,
            flow,
            retained_flow,
            recomposed_lines,
            text,
            clusters,
            previous_clusters,
            runs,
            previous_runs,
            boundary_shape,
            previous_boundary_shape,
            styles,
            bidi,
            next_run_canonical_revision,
            typography_for,
            retained_typography_for,
            metrics_for,
            extents_for,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn build_lines(
        &mut self,
        previous: &Self,
        flow: &FlowLayoutArena,
        retained_flow: Option<&FlowLayoutArena>,
        recomposed_lines: Option<&[core::ops::Range<usize>]>,
        text: &[u16],
        clusters: &ClusterArena,
        previous_clusters: &ClusterArena,
        runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        previous_boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        next_run_canonical_revision: &mut u32,
        typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        retained_typography_for: impl Fn(u32) -> ThreadTypography + Copy,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        self.clear();
        self.rebuild_replacement_runs(
            previous,
            boundary_shape,
            previous_boundary_shape,
            runs,
            previous_runs,
            next_run_canonical_revision,
        )?;
        self.rebuild_replacement_run_local(
            boundary_shape,
            text,
            clusters,
            runs,
            styles,
            metrics_for,
            extents_for,
        )?;
        self.text_effects = styles
            .iter()
            .any(|segment| style_has_text_effects(segment.style));
        self.decorated = styles
            .iter()
            .any(|segment| segment.style.decoration_flags != 0);
        let glyph_capacity = clusters
            .glyph_ids
            .len()
            .checked_add(boundary_shape.shape.glyph_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.reserve(glyph_capacity)?;
        reserve(&mut self.line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.line_decoration_starts, flow.lines.len())?;
        reserve(&mut self.line_decoration_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_starts, flow.lines.len())?;
        reserve(&mut self.semantic_line_glyph_counts, flow.lines.len())?;
        reserve(&mut self.semantic_line_inline_extents, flow.lines.len())?;
        reserve(&mut self.line_step_starts, flow.lines.len())?;
        reserve(&mut self.line_span_starts, flow.lines.len())?;
        reserve(&mut self.line_repositionable, flow.lines.len())?;
        reserve(&mut self.fragment_topology, flow.fragments.len())?;
        reserve(&mut self.line_ink, flow.lines.len())?;
        reserve(&mut self.line_missing_glyphs, flow.lines.len())?;
        if recomposed_lines.is_some() {
            reserve(&mut self.recomposed_glyphs, flow.lines.len())?;
        }
        // Flow admission authorizes reuse, but the actual positioning executor owns dirt:
        // numeric correspondence can reject an otherwise unchanged flow line.
        let mut source_coordinates_retained = recomposed_lines.is_some();
        let visually_ltr = is_trivially_ltr(bidi, runs);
        // The canonical span stream is the only source representation. Static
        // geometry reuses clean lines through the placement/occurrence proof;
        // dirty lines are emitted from their current run-local rows.
        let mut retained_cursor = retained_flow.and_then(RetainedFlowLineCursor::new);
        let mut recomposed_line_index = 0usize;
        let mut drop_cap_cursor = 0usize;
        let mut fragment_cursor = 0usize;
        let mut fragment_ranges = flow
            .fragments
            .cursor_from(0)
            .ok_or(EngineError::InvalidRequest)?;
        let mut lines = flow.lines.iter().copied().enumerate().peekable();
        let mut previous_flow_thread_id = None;
        while let Some((line_index, line)) = lines.next() {
            let next_line = lines.peek().map(|(_, line)| line);
            let first_thread_line = previous_flow_thread_id != Some(line.flow_thread_id);
            previous_flow_thread_id = Some(line.flow_thread_id);
            let fragment_start_usize = fragment_cursor;
            fragment_cursor = fragment_cursor
                .checked_add(usize::from(line.fragment_count))
                .ok_or(EngineError::ResultTooLarge)?;
            let fragment_start =
                u32::try_from(fragment_start_usize).map_err(|_| EngineError::ResultTooLarge)?;
            let fragments = fragment_ranges
                .take(usize::from(line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            let drop_cap = first_thread_line
                .then(|| flow.drop_caps.get(drop_cap_cursor).copied())
                .flatten()
                .filter(|cap| cap.line.flow_thread_id == line.flow_thread_id);
            let previous_drop_cap = first_thread_line
                .then(|| {
                    retained_flow
                        .and_then(|previous| previous.drop_caps.get(drop_cap_cursor).copied())
                })
                .flatten()
                .filter(|cap| cap.line.flow_thread_id == line.flow_thread_id);
            let placement_line_start = Some(self.placement.begin_line());
            let line_span_start = self.occurrence_spans.len();
            let line_step_start = self.pen_steps.len();
            let retained_line = recomposed_lines.is_some_and(|ranges| {
                while ranges
                    .get(recomposed_line_index)
                    .is_some_and(|range| range.end <= line_index)
                {
                    recomposed_line_index += 1;
                }
                ranges
                    .get(recomposed_line_index)
                    .is_none_or(|range| !range.contains(&line_index))
            });
            if previous_drop_cap == drop_cap && retained_line {
                let previous_glyph_count = *previous
                    .line_glyph_counts
                    .get(line_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let target = RetainedLineTarget {
                    body: RetainedSourceLine {
                        index: line_index,
                        line,
                    },
                    drop_cap: drop_cap.map(|cap| RetainedSourceLine {
                        index: drop_cap_cursor,
                        line: cap.line,
                    }),
                };
                let proof = RetainedOccurrenceProof {
                    previous,
                    clusters,
                    previous_clusters,
                    boundary: boundary_shape,
                    previous_boundary: previous_boundary_shape,
                    replacement_runs: &self.replacement_runs,
                    replacement_run_boundary_indices: &self.replacement_run_boundary_indices,
                    replacement_local: &self.replacement_run_local,
                    line_index,
                    target,
                    clean_line: true,
                    spans: &mut self.occurrence_spans,
                    semantic_count: &mut self.occurrence_semantic_count,
                    outlined_count: &mut self.occurrence_outlined_count,
                };
                match self.placement.append_retained_line_validated(
                    &previous.placement,
                    RetainedLinePlacement {
                        line_index,
                        old_fragment_start: previous.placement.line_fragment_start(line_index)?,
                        new_fragment_start: fragment_start,
                        instance_count: previous_glyph_count,
                    },
                    clusters.layout_runs(),
                    &self.replacement_runs,
                    Some(RetainedRunCorrespondence {
                        previous_clusters,
                        clusters,
                        previous_runs,
                        runs,
                    }),
                    |placement, remap| proof.append(placement, remap),
                ) {
                    Ok((remap, ())) => {
                        source_coordinates_retained &= previous.line_glyph_starts[line_index]
                            as usize
                            == self
                                .outlined_count()
                                .saturating_sub(previous_glyph_count as usize);
                        self.append_retained_line(previous, line_index, target, Some(remap))?;
                        // An edit moved cluster indexes under the retained steps.
                        self.push_line_topology(
                            (line_span_start, line_step_start),
                            usize::from(line.fragment_count),
                            false,
                        )?;
                        if drop_cap.is_some() {
                            drop_cap_cursor += 1;
                        }
                        continue;
                    }
                    Err(EngineError::InvalidRequest) => {}
                    Err(error) => return Err(error),
                }
            }
            let mut numeric_source = None;
            // The line that owns a drop cap is positioned in full; the lines beside it are not
            // special, since the cap reaches them only through their slots.
            if drop_cap.is_none()
                && let Some(retained_cursor) = retained_cursor.as_mut()
                && let Some(matched) = matching_retained_line(
                    line,
                    &fragments,
                    next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id),
                    retained_cursor,
                    clusters,
                    bidi,
                    typography_for(line.flow_thread_id),
                    retained_typography_for(line.flow_thread_id),
                    (
                        boundary_shape,
                        previous_boundary_shape,
                        &mut self.edge_pairs,
                    ),
                )?
            {
                let (previous_line_index, previous_line) = (matched.index, matched.line);
                let previous_fragment_start = retained_cursor
                    .fragment_index
                    .checked_sub(usize::from(previous_line.fragment_count))
                    .ok_or(EngineError::InvalidRequest)?;
                if !matched.exact || matched.edges {
                    numeric_source =
                        Some((previous_line_index, previous_fragment_start, matched.edges));
                } else {
                    let previous_glyph_count = *previous
                        .line_glyph_counts
                        .get(previous_line_index)
                        .ok_or(EngineError::InvalidRequest)?;
                    let target = RetainedLineTarget {
                        body: RetainedSourceLine {
                            index: line_index,
                            line,
                        },
                        drop_cap: None,
                    };
                    let proof = RetainedOccurrenceProof {
                        previous,
                        clusters,
                        previous_clusters,
                        boundary: boundary_shape,
                        previous_boundary: previous_boundary_shape,
                        replacement_runs: &self.replacement_runs,
                        replacement_run_boundary_indices: &self.replacement_run_boundary_indices,
                        replacement_local: &self.replacement_run_local,
                        line_index: previous_line_index,
                        target,
                        clean_line: false,
                        spans: &mut self.occurrence_spans,
                        semantic_count: &mut self.occurrence_semantic_count,
                        outlined_count: &mut self.occurrence_outlined_count,
                    };
                    match self.placement.append_retained_line_validated(
                        &previous.placement,
                        RetainedLinePlacement {
                            line_index: previous_line_index,
                            old_fragment_start: u32::try_from(previous_fragment_start)
                                .map_err(|_| EngineError::ResultTooLarge)?,
                            new_fragment_start: fragment_start,
                            instance_count: previous_glyph_count,
                        },
                        clusters.layout_runs(),
                        &self.replacement_runs,
                        None,
                        |placement, remap| proof.append(placement, remap),
                    ) {
                        Ok((remap, ())) => {
                            source_coordinates_retained &=
                                previous.line_glyph_starts[previous_line_index] as usize
                                    == self
                                        .outlined_count()
                                        .saturating_sub(previous_glyph_count as usize);
                            self.append_retained_line(
                                previous,
                                previous_line_index,
                                target,
                                Some(remap),
                            )?;
                            self.copy_line_topology(
                                previous,
                                (previous_line_index, previous_fragment_start),
                                (line_span_start, line_step_start),
                                usize::from(line.fragment_count),
                            )?;
                            continue;
                        }
                        Err(EngineError::InvalidRequest) => {}
                        Err(error) => return Err(error),
                    }
                }
            }
            let line_glyph_start = self.outlined_count();
            let line_decoration_start = self.decorations.len();
            let semantic_line_start = self.occurrence_count();
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
                self.push_line_topology((line_span_start, line_step_start), 0, false)?;
                self.push_line_ink(line_span_start, clusters, boundary_shape);
                if let Some(placement_line_start) = placement_line_start {
                    self.placement.finish_line(placement_line_start)?;
                }
                continue;
            }
            let first = fragments.first().ok_or(EngineError::InvalidRequest)?;
            let last = fragments.last().ok_or(EngineError::InvalidRequest)?;
            if drop_cap.is_some() {
                drop_cap_cursor += 1;
            }
            let mut inline_start = fragments
                .iter()
                .map(|fragment| fragment.slot_start)
                .fold(f64::INFINITY, f64::min);
            let mut inline_end = f64::NEG_INFINITY;
            if let Some(cap) = drop_cap {
                self.current_source_line = SourceLine::DropCap(
                    u32::try_from(drop_cap_cursor - 1).map_err(|_| EngineError::ResultTooLarge)?,
                );
                self.placement_fragment_index = fragment_start;
                let cap_advance = self.position_drop_cap(
                    cap,
                    text,
                    clusters,
                    runs,
                    boundary_shape,
                    styles,
                    bidi,
                    visually_ltr,
                    metrics_for,
                )?;
                inline_start = inline_start.min(cap.fragment.slot_start);
                inline_end = inline_end.max(cap.fragment.slot_start + cap_advance);
            }
            let final_line =
                next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
            let typography = typography_for(line.flow_thread_id);
            self.current_source_line = SourceLine::Body(
                u32::try_from(line_index).map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.placement_fragment_index = fragment_start;
            // A line holding the clusters it held before repeats only its arithmetic.
            let repositioned = match numeric_source {
                Some((previous_line, previous_fragment_start, false)) => self
                    .reposition_retained_line(
                        previous,
                        (previous_line, previous_fragment_start),
                        (line_index, line),
                        &fragments,
                        final_line,
                        typography,
                        clusters,
                        bidi,
                        fragment_start,
                    )?,
                Some((previous_line, previous_fragment_start, true)) => self.retain_edge_line(
                    previous,
                    (previous_line, previous_fragment_start),
                    (line_index, line),
                    &fragments,
                    final_line,
                    typography,
                    clusters,
                    fragment_start,
                )?,
                None => None,
            };
            if let Some(end) = repositioned {
                inline_end = end;
                let edges = numeric_source.is_some_and(|(_, _, edges)| edges);
                self.push_line_topology(
                    (line_span_start, line_step_start),
                    if edges {
                        usize::from(line.fragment_count)
                    } else {
                        0
                    },
                    !edges,
                )?;
            } else {
                if !visually_ltr {
                    prepare_line_levels(
                        &mut self.line_levels,
                        bidi,
                        first.line.text_start,
                        last.line.text_end,
                    )?;
                }
                for fragment in fragments.iter().copied() {
                    let indent = if fragment.line.cluster_start == 0 {
                        typography.first_line_indent
                    } else {
                        0.0
                    };
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
                        indent,
                        typography.justify,
                        metrics_for,
                    )?;
                    inline_end = inline_end.max(fragment.slot_start + fragment_advance);
                    self.placement_fragment_index = self
                        .placement_fragment_index
                        .checked_add(1)
                        .ok_or(EngineError::ResultTooLarge)?;
                }
                let repositionable = drop_cap.is_none()
                    && !self.decorated
                    && fragments.iter().all(|fragment| {
                        fragment.boundary_index == super::flow_composition::NO_BOUNDARY
                            && fragment.lead_index == super::flow_composition::NO_BOUNDARY
                            && fragment.tail_index == super::flow_composition::NO_BOUNDARY
                    });
                self.push_line_topology((line_span_start, line_step_start), 0, repositionable)?;
            }
            self.semantic_line_glyph_starts
                .push(u32::try_from(semantic_line_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.semantic_line_glyph_counts.push(
                u32::try_from(self.occurrence_count().saturating_sub(semantic_line_start))
                    .map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.semantic_line_inline_extents
                .push((inline_end - inline_start).max(0.0));
            self.line_glyph_starts
                .push(u32::try_from(line_glyph_start).map_err(|_| EngineError::ResultTooLarge)?);
            self.line_glyph_counts.push(
                u32::try_from(self.outlined_count().saturating_sub(line_glyph_start))
                    .map_err(|_| EngineError::ResultTooLarge)?,
            );
            self.push_line_ink(line_span_start, clusters, boundary_shape);
            let line_glyph_end = self.outlined_count();
            if source_coordinates_retained && line_glyph_start != line_glyph_end {
                if let Some(last) = self.recomposed_glyphs.last_mut()
                    && last.end == line_glyph_start
                {
                    last.end = line_glyph_end;
                } else {
                    self.recomposed_glyphs
                        .push(line_glyph_start..line_glyph_end);
                }
            }
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
        if drop_cap_cursor != flow.drop_caps.len() {
            return Err(EngineError::InvalidRequest);
        }
        if fragment_cursor != flow.fragments.len() || !fragment_ranges.is_empty() {
            return Err(EngineError::InvalidRequest);
        }
        self.recomposed_glyphs_retained = source_coordinates_retained
            && previous.outlined_count() == self.outlined_count()
            && previous.line_glyph_counts.len() == self.line_glyph_counts.len();
        self.placement.validate_occurrences(self.outlined_count())?;
        // The current positioning preparation has consumed its recomposition windows. This
        // storage now carries all unpublished windows in the preserved source coordinates.
        if self.recomposed_glyphs_retained && previous.recomposed_glyphs_retained {
            merge_recomposed_glyphs(&mut self.recomposed_glyphs, &previous.recomposed_glyphs)?;
        } else {
            self.recomposed_glyphs_retained = false;
        }
        #[cfg(test)]
        super::work_attribution::record(|work| {
            work.positioned_semantic_occurrences += self.occurrence_count();
            work.positioned_outlined_occurrences += self.outlined_count();
            work.positioned_occurrence_spans += self.occurrence_spans.len();
            work.positioned_occurrence_span_payload_bytes +=
                self.occurrence_spans.len() * core::mem::size_of::<OccurrenceSpan>();
            work.positioned_occurrence_span_capacity_bytes +=
                self.occurrence_spans.capacity() * core::mem::size_of::<OccurrenceSpan>();
        });
        Ok(())
    }

    fn append_retained_line(
        &mut self,
        previous: &Self,
        line_index: usize,
        _target: RetainedLineTarget,
        _segment_remap: Option<RetainedSegmentRemap>,
    ) -> Result<(), EngineError> {
        // Placement and occurrence spans were admitted together inside the
        // preceding checkpoint. Only per-line summaries and decorations remain.
        let outlined = *previous
            .line_glyph_counts
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic = *previous
            .semantic_line_glyph_counts
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let outlined_start = self
            .outlined_count()
            .checked_sub(outlined as usize)
            .ok_or(EngineError::InvalidRequest)?;
        let semantic_start = self
            .occurrence_count()
            .checked_sub(semantic as usize)
            .ok_or(EngineError::InvalidRequest)?;
        self.line_glyph_starts
            .push(u32::try_from(outlined_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_glyph_counts.push(outlined);
        self.semantic_line_glyph_starts
            .push(u32::try_from(semantic_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.semantic_line_glyph_counts.push(semantic);
        self.semantic_line_inline_extents.push(
            *previous
                .semantic_line_inline_extents
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        );
        // The retained glyphs keep their rows and their translations, so their ink is the same.
        let ink = *previous
            .line_ink
            .get(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        self.line_ink_complete &= ink.state != LineInkState::Unmeasured;
        self.line_ink.push(ink);
        self.line_missing_glyphs.push(
            *previous
                .line_missing_glyphs
                .get(line_index)
                .ok_or(EngineError::InvalidRequest)?,
        );
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
        reserve(&mut self.decorations, decoration_count)?;
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
        #[cfg(test)]
        record_positioned_copy(decoration_count);
        Ok(())
    }

    /// Closes one line's topology lanes. `empty_fragments` stands in for fragments the line
    /// did not position itself.
    fn push_line_topology(
        &mut self,
        (span_start, step_start): (usize, usize),
        empty_fragments: usize,
        repositionable: bool,
    ) -> Result<(), EngineError> {
        self.line_span_starts
            .push(u32::try_from(span_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_step_starts
            .push(u32::try_from(step_start).map_err(|_| EngineError::ResultTooLarge)?);
        self.line_repositionable.push(repositionable);
        reserve(&mut self.fragment_topology, empty_fragments)?;
        self.fragment_topology.extend(core::iter::repeat_n(
            FragmentTopology::default(),
            empty_fragments,
        ));
        Ok(())
    }

    /// Carries a retained line's pen steps over: its clusters kept their indexes.
    fn copy_line_topology(
        &mut self,
        previous: &Self,
        (previous_line, previous_fragment_start): (usize, usize),
        starts: (usize, usize),
        fragment_count: usize,
    ) -> Result<(), EngineError> {
        if previous.line_repositionable.get(previous_line) != Some(&true) {
            return self.push_line_topology(starts, fragment_count, false);
        }
        let steps = previous.line_steps(previous_line)?;
        let topology = previous
            .fragment_topology
            .get(previous_fragment_start..previous_fragment_start + fragment_count)
            .ok_or(EngineError::InvalidRequest)?;
        reserve(&mut self.pen_steps, steps.len())?;
        self.pen_steps.extend_from_slice(steps);
        reserve(&mut self.fragment_topology, topology.len())?;
        self.fragment_topology.extend_from_slice(topology);
        self.push_line_topology(starts, 0, true)
    }

    fn line_steps(&self, line: usize) -> Result<&[PenStep], EngineError> {
        let start = *self
            .line_step_starts
            .get(line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let end = self
            .line_step_starts
            .get(line + 1)
            .map_or(self.pen_steps.len(), |end| *end as usize);
        self.pen_steps
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }

    fn line_spans(&self, line: usize) -> Result<&[OccurrenceSpan], EngineError> {
        let start = *self
            .line_span_starts
            .get(line)
            .ok_or(EngineError::InvalidRequest)? as usize;
        let end = self
            .line_span_starts
            .get(line + 1)
            .map_or(self.occurrence_spans.len(), |end| *end as usize);
        self.occurrence_spans
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn clear(&mut self) {
        self.decorations.clear();
        self.replacement_runs.clear();
        self.replacement_run_boundary_indices.clear();
        self.replacement_run_local.clear();
        self.replacement_run_indices.clear();
        self.replacement_current_order.clear();
        self.replacement_previous_order.clear();
        self.line_glyph_starts.clear();
        self.line_glyph_counts.clear();
        self.line_decoration_starts.clear();
        self.line_decoration_counts.clear();
        self.occurrence_spans.clear();
        self.occurrence_semantic_count = 0;
        self.occurrence_outlined_count = 0;
        self.semantic_line_glyph_starts.clear();
        self.semantic_line_glyph_counts.clear();
        self.semantic_line_inline_extents.clear();
        self.visual_clusters.clear();
        self.visual_levels.clear();
        self.line_levels.clear();
        self.placement.clear();
        self.recomposed_glyphs.clear();
        self.recomposed_glyphs_retained = false;
        self.text_effects = false;
        self.decorated = false;
        self.pen_steps.clear();
        self.fragment_topology.clear();
        self.line_step_starts.clear();
        self.line_span_starts.clear();
        self.line_repositionable.clear();
        self.numeric_translations.clear();
        self.edge_pairs.clear();
        self.edge_runs.clear();
        self.line_ink.clear();
        self.line_missing_glyphs.clear();
        self.line_ink_complete = true;
    }

    pub(crate) fn decorations(&self) -> &[DecorationRecord] {
        &self.decorations
    }

    pub(crate) fn projected_occurrence_row<'a>(
        &'a self,
        occurrence: ProjectedOccurrence<'a>,
        semantic_index: u32,
        placement_slot: u32,
        context: PositionedSourceContext<'a>,
    ) -> Result<ProjectedSourceRow<'a>, EngineError> {
        let semantic = occurrence.semantic;
        let span = occurrence.span;
        let cluster =
            usize::try_from(occurrence.owner_cluster).map_err(|_| EngineError::InvalidRequest)?;
        let style_index = usize::try_from(
            *context
                .clusters
                .style_indexes
                .get(cluster)
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map_err(|_| EngineError::InvalidRequest)?;
        let style = &context
            .styles
            .get(style_index)
            .ok_or(EngineError::InvalidRequest)?
            .style;
        Ok(projected_semantic_row(
            semantic,
            semantic_index,
            placement_slot,
            ProjectedRowOwner {
                binding_handle: span.binding_handle,
                style,
                line_facts: span.line_facts,
                stable_cluster: *context
                    .clusters
                    .stable_ids
                    .get(cluster)
                    .ok_or(EngineError::InvalidRequest)?,
                text_effects: self.text_effects,
            },
        ))
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
        self.replacement_run_boundary_indices
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
            let index = u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?;
            self.replacement_current_order.push(pack2(
                current_shape.records[index as usize].flow_thread_id,
                index,
            ));
        }
        for index in
            (0..previous_shape.records.len()).filter(|i| !previous_shape.records[*i].line_start)
        {
            let index = u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?;
            self.replacement_previous_order.push(pack2(
                previous_shape.records[index as usize].flow_thread_id,
                index,
            ));
        }
        sort_keys(&mut self.replacement_current_order);
        sort_keys(&mut self.replacement_previous_order);
        if self.replacement_current_order.windows(2).any(|pair| {
            let (left, right) = (
                current_shape.records[replacement_index(pair[0])],
                current_shape.records[replacement_index(pair[1])],
            );
            left.flow_thread_id == right.flow_thread_id && !(left.line_start || right.line_start)
        }) || self
            .replacement_previous_order
            .windows(2)
            .any(|pair| pair[0] >> 32 == pair[1] >> 32)
        {
            return Err(EngineError::InvalidRequest);
        }
        self.replacement_run_indices
            .resize(current_shape.records.len(), [None; 2]);
        let mut revision_cursor = *next_revision;
        let mut previous_order_index = 0usize;
        for current_boundary_key in self.replacement_current_order.iter().copied() {
            let current_boundary_index = replacement_index(current_boundary_key);
            let boundary = current_shape.records[current_boundary_index];
            while self
                .replacement_previous_order
                .get(previous_order_index)
                .is_some_and(|key| (*key >> 32) < u64::from(boundary.flow_thread_id))
            {
                previous_order_index += 1;
            }
            let previous_boundary_index = self
                .replacement_previous_order
                .get(previous_order_index)
                .copied()
                .filter(|key| {
                    !boundary.line_start && (*key >> 32) == u64::from(boundary.flow_thread_id)
                })
                .map(replacement_index);
            let previous_boundary =
                previous_boundary_index.map(|index| previous_shape.records[index]);
            let mut run_indices = [None; 2];
            for role in [BoundaryRunRole::BoundarySource, BoundaryRunRole::Ellipsis] {
                let Some(spec) = BoundaryRunSpec::from_boundary(boundary, role) else {
                    continue;
                };
                let role_index = boundary_role_index(role);
                let previous_run = previous_boundary_index
                    .and_then(|index| previous.replacement_run_indices.get(index))
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
                });
                self.replacement_run_boundary_indices.push(
                    u32::try_from(current_boundary_index)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                );
                run_indices[role_index] = Some(run_index);
            }
            self.replacement_run_indices[current_boundary_index] = run_indices;
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
            run_local
                .finalize_source_ranks()
                .map_err(run_local_build_error)?;
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

    pub(crate) fn occurrence_count(&self) -> usize {
        self.occurrence_semantic_count as usize
    }

    pub(crate) fn placed_occurrence(
        &self,
        glyph: PositionedSemanticGlyph,
    ) -> Result<SemanticGlyph, EngineError> {
        let translation = self
            .placement
            .translations()
            .get(
                usize::try_from(glyph.placement_segment)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .copied()
            .ok_or(EngineError::InvalidRequest)?;
        glyph.placed(translation)
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
    }

    pub(crate) fn unpublished_source_intervals(&self) -> Option<&[core::ops::Range<usize>]> {
        self.recomposed_glyphs_retained
            .then_some(self.recomposed_glyphs.as_slice())
    }

    /// Declares every source row unpublished without repositioning any: a paint-only change
    /// alters what a row projects, not where it sits.
    pub(crate) fn mark_unpublished(&mut self) {
        self.recomposed_glyphs.clear();
        self.recomposed_glyphs_retained = false;
    }

    #[allow(clippy::too_many_arguments)]
    fn position_drop_cap(
        &mut self,
        cap: FlowDropCap,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        boundary_shape: &BoundaryShapeArena,
        styles: &[StyleSegment],
        bidi: &BidiAnalysis,
        visually_ltr: bool,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<f64, EngineError> {
        if !visually_ltr {
            prepare_line_levels(
                &mut self.line_levels,
                bidi,
                cap.fragment.line.text_start,
                cap.fragment.line.text_end,
            )?;
        }
        self.position_fragment(
            cap.line,
            cap.fragment,
            false,
            text,
            clusters,
            runs,
            boundary_shape,
            styles,
            bidi,
            visually_ltr,
            0.0,
            JustifyControls::default(),
            metrics_for,
        )
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
    ) -> Result<f64, EngineError> {
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end =
            usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        // An ellipsis cut or a corrected line end: either way the paragraph's clusters stop at the record.
        let cut_index = if fragment.boundary_index == super::flow_composition::NO_BOUNDARY {
            fragment.tail_index
        } else {
            fragment.boundary_index
        };
        let boundary = if cut_index == super::flow_composition::NO_BOUNDARY {
            None
        } else {
            Some(
                boundary_shape
                    .record(cut_index)
                    .ok_or(EngineError::InvalidRequest)?,
            )
        };
        let retained_cluster_end = boundary.map_or(cluster_end, |boundary| {
            usize::try_from(boundary.cluster_start).unwrap_or(usize::MAX)
        });
        if retained_cluster_end > cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        // A corrected line start draws its island shaped alone; the paragraph's clusters resume after it.
        let lead = (fragment.lead_index != super::flow_composition::NO_BOUNDARY)
            .then(|| boundary_shape.record(fragment.lead_index))
            .map(|lead| lead.ok_or(EngineError::InvalidRequest))
            .transpose()?;
        let body_start = lead.map_or(cluster_start, |lead| lead.cluster_end as usize);
        let hanging_start = hanging_cluster_start(fragment, clusters, cluster_start, cluster_end)?;
        let step_start = self.pen_steps.len();
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
        // The adjacency-order glyph stream is one equal-length column family, admitted once
        // per fragment so every segment indexes the columns directly.
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
        let mut state = FragmentPositionState {
            cursor: pen_origin,
            baseline,
            decorated_run: None,
            space_ordinal: 0,
            gap_ordinal: 0,
        };
        if let Some(lead) = lead {
            state.cursor = self.position_boundary(
                line,
                fragment.lead_index,
                lead,
                state.cursor,
                baseline,
                text,
                clusters,
                runs,
                styles,
                boundary_shape,
                metrics_for,
                (justify, &mut state),
            )?;
        }
        let layout_run_order = visually_ltr && paragraph_level & 1 == 0;
        if layout_run_order {
            self.position_layout_run_fragment(
                line,
                fragment,
                body_start,
                retained_cluster_end,
                hanging_start,
                clusters,
                runs,
                styles,
                justify,
                &mut state,
                metrics_for,
            )?;
        } else {
            let visual_count = if visually_ltr {
                retained_cluster_end.saturating_sub(body_start)
            } else {
                self.visual_clusters.len().saturating_sub(visual_start)
            };
            let mut layout_run_cache = None;
            let mut geometry_cache = None;
            let mut active_placement = None;
            let body = BodyLine {
                line,
                text_start: fragment.line.text_start,
                clusters,
                runs,
                styles,
                justify,
            };
            let visual_cluster = |arena: &Self, ordinal: usize| {
                if visually_ltr {
                    Ok(body_start + ordinal)
                } else {
                    usize::try_from(arena.visual_clusters[visual_start + ordinal])
                        .map_err(|_| EngineError::InvalidRequest)
                }
            };
            let mut ordinal = 0;
            while ordinal < visual_count {
                let cluster = visual_cluster(self, ordinal)?;
                let (run_index, layout_run) =
                    layout_run_for_cluster(clusters, cluster, &mut layout_run_cache)?;
                let direction = layout_run_direction(layout_run, runs)?;
                let placement_cluster =
                    clusters.placement_cluster(layout_run, direction, cluster)?;
                let translation_inline = finite_f32(
                    state.cursor - placement_cluster.block_local_prefix
                        + placement_cluster.block_anchor_inline,
                )?;
                let translation_block =
                    finite_f32(state.baseline + placement_cluster.block_anchor_block)?;
                let adjacent = active_placement.is_some_and(|active: ActiveFallbackPlacement| {
                    active.layout_run_index == run_index
                        && if direction & 1 == 0 {
                            active.cluster.checked_add(1) == Some(cluster)
                        } else {
                            cluster.checked_add(1) == Some(active.cluster)
                        }
                        && active.direction == direction
                        && active.placement_cluster.segment_anchor
                            == placement_cluster.segment_anchor
                        && active.placement_cluster.dense == placement_cluster.dense
                        && active.placement_cluster.numeric_block_ordinal
                            == placement_cluster.numeric_block_ordinal
                        && active.occurrence.translation_inline.to_bits()
                            == translation_inline.to_bits()
                        && active.occurrence.translation_block.to_bits()
                            == translation_block.to_bits()
                });
                let occurrence = if justify.is_zero() && adjacent {
                    let occurrence = active_placement
                        .ok_or(EngineError::InvalidRequest)?
                        .occurrence;
                    self.extend_layout_run_segment(
                        occurrence.segment_index,
                        &layout_run,
                        cluster,
                        1,
                        clusters,
                    )?;
                    self.push_pen_step(
                        &layout_run,
                        direction,
                        cluster..cluster + 1,
                        placement_cluster,
                        STEP_MERGEABLE | STEP_JOINED,
                    )?;
                    occurrence
                } else {
                    self.record_layout_run_segment(
                        self.placement_fragment_index,
                        run_index,
                        &layout_run,
                        cluster,
                        cluster + 1,
                        clusters,
                        placement_cluster,
                        (false, direction),
                        state.cursor,
                        state.baseline,
                    )?
                };
                active_placement = Some(ActiveFallbackPlacement {
                    layout_run_index: run_index,
                    cluster,
                    direction,
                    placement_cluster,
                    occurrence,
                });
                ordinal += 1;
                if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
                    continue;
                }
                let geometry = match geometry_cache {
                    Some((cached_run, geometry)) if cached_run == run_index => geometry,
                    _ => {
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
                        )?;
                        geometry_cache = Some((run_index, geometry));
                        geometry
                    }
                };
                // The clusters that follow in visual order join this segment while they stay in
                // its run, block and anchor and their own translation publishes the same f32:
                // the test the per-cluster walk applied to each of them in turn.
                let count = self.visual_segment_reach(
                    clusters,
                    layout_run,
                    direction,
                    cluster,
                    (visually_ltr, visual_start + ordinal, visual_count - ordinal),
                    occurrence.translation_inline,
                    placement_cluster,
                    justify,
                    &state,
                );
                if count > 1 {
                    let reverse = direction & 1 != 0;
                    let step = self
                        .pen_steps
                        .last_mut()
                        .ok_or(EngineError::InvalidRequest)?;
                    step.count = u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?;
                    step.flags |= STEP_CHECKED | if reverse { STEP_REVERSE } else { 0 };
                    let joined = if reverse {
                        cluster + 1 - count
                    } else {
                        cluster + 1
                    };
                    self.extend_layout_run_segment(
                        occurrence.segment_index,
                        &layout_run,
                        joined,
                        count - 1,
                        clusters,
                    )?;
                    active_placement = Some(ActiveFallbackPlacement {
                        layout_run_index: run_index,
                        cluster: if reverse {
                            cluster + 1 - count
                        } else {
                            cluster + count - 1
                        },
                        direction,
                        placement_cluster,
                        occurrence,
                    });
                }
                self.position_segment(
                    body,
                    SegmentWalk {
                        segment_index: occurrence.segment_index,
                        first: cluster,
                        count,
                        reverse: direction & 1 != 0,
                        levels: (!visually_ltr).then_some(visual_start + ordinal - 1),
                    },
                    geometry,
                    true,
                    &mut state,
                    metrics_for,
                )?;
                ordinal += count - 1;
            }
            if !visually_ltr {
                for cluster in cluster_start..retained_cluster_end {
                    if clusters.flags[cluster] & CLUSTER_HARD_BREAK == 0 {
                        continue;
                    }
                    let (run_index, layout_run) =
                        layout_run_for_cluster(clusters, cluster, &mut layout_run_cache)?;
                    let direction = layout_run_direction(layout_run, runs)?;
                    let placement_cluster =
                        clusters.placement_cluster(layout_run, direction, cluster)?;
                    self.record_layout_run_segment(
                        self.placement_fragment_index,
                        run_index,
                        &layout_run,
                        cluster,
                        cluster + 1,
                        clusters,
                        placement_cluster,
                        (false, direction),
                        state.cursor,
                        state.baseline,
                    )?;
                }
            }
        }
        if let Some(boundary) = boundary {
            let _ = self.position_boundary(
                line,
                cut_index,
                boundary,
                state.cursor,
                baseline,
                text,
                clusters,
                runs,
                styles,
                boundary_shape,
                metrics_for,
                (justify, &mut state),
            )?;
        }
        if state.decorated_run.is_some() {
            self.flush_decorated_run(&mut state.decorated_run, line, metrics_for)?;
        }
        if matches!(self.current_source_line, SourceLine::Body(_)) {
            let adjusts_spaces = justify.per_space_units != 0 || justify.extra_space_units != 0;
            let adjusts_gaps = justify.per_gap_units != 0 || justify.extra_gap_units != 0;
            self.fragment_topology.push(FragmentTopology {
                steps: u32::try_from(self.pen_steps.len() - step_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                flags: if layout_run_order {
                    0
                } else {
                    FRAGMENT_VISUAL_ORDER
                } | if adjusts_spaces {
                    FRAGMENT_ADJUSTS_SPACES
                } else {
                    0
                } | if adjusts_gaps {
                    FRAGMENT_ADJUSTS_GAPS
                } else {
                    0
                } | if hung_leads { FRAGMENT_HUNG_LEADS } else { 0 },
            });
        }
        Ok(indent
            + fragment.line.advance
            + super::layout_units::scaled_from_layout_units(justify.total_units()))
    }

    #[allow(clippy::too_many_arguments)]
    fn position_layout_run_fragment(
        &mut self,
        line: FlowLine,
        fragment: FlowFragment,
        cluster_start: usize,
        cluster_end: usize,
        hanging_start: usize,
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        justify: JustifyDistribution,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    ) -> Result<(), EngineError> {
        if cluster_start > cluster_end {
            return Err(EngineError::InvalidRequest);
        }
        if cluster_start == cluster_end {
            return Ok(());
        }
        let layout_runs = clusters.layout_runs();
        let first = layout_runs.partition_point(|run| run.cluster_end as usize <= cluster_start);
        let adjusts_spaces = justify.per_space_units != 0 || justify.extra_space_units != 0;
        let adjusts_gaps = justify.per_gap_units != 0 || justify.extra_gap_units != 0;
        let adjust = adjusts_spaces || adjusts_gaps;
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
            let direction = layout_run_direction(*layout_run, runs)?;
            let Some(geometry_cluster) = (overlap_start..overlap_end)
                .find(|cluster| clusters.flags[*cluster] & CLUSTER_HARD_BREAK == 0)
            else {
                for cluster in overlap_start..overlap_end {
                    let placement_cluster =
                        clusters.placement_cluster(*layout_run, direction, cluster)?;
                    self.record_layout_run_segment(
                        self.placement_fragment_index,
                        layout_run_index,
                        layout_run,
                        cluster,
                        cluster + 1,
                        clusters,
                        placement_cluster,
                        (true, direction),
                        state.cursor,
                        state.baseline,
                    )?;
                }
                covered = overlap_end;
                continue;
            };
            let geometry = RunGeometry::for_cluster(clusters, styles, geometry_cluster)?;
            debug_assert_eq!(layout_run.font_handle, geometry.font_handle);
            let body = BodyLine {
                line,
                text_start: fragment.line.text_start,
                clusters,
                runs,
                styles,
                justify,
            };
            let mut cluster = overlap_start;
            while cluster < overlap_end {
                let segment_start = cluster;
                let (placement_cluster, stable_segment_end) = if adjusts_gaps {
                    (
                        clusters.placement_cluster(*layout_run, direction, segment_start)?,
                        segment_start + 1,
                    )
                } else {
                    clusters.placement_segment_monotone(
                        *layout_run,
                        direction,
                        segment_start,
                        adjusts_spaces,
                        overlap_end,
                    )?
                };
                let mut segment_end = segment_start + 1;
                if !adjusts_gaps
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
                    (true, direction),
                    state.cursor,
                    state.baseline,
                )?;
                self.position_segment(
                    body,
                    SegmentWalk {
                        segment_index: occurrence.segment_index,
                        first: segment_start,
                        count: segment_end - segment_start,
                        reverse: false,
                        levels: None,
                    },
                    geometry,
                    adjust,
                    state,
                    metrics_for,
                )?;
                cluster = segment_end;
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
        (allow_dense_identity, direction): (bool, u8),
        cursor: f64,
        baseline: f64,
    ) -> Result<PlacementOccurrence, EngineError> {
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
        let segment = super::placement_state::PlacementSegment {
            fragment_index,
            layout_run_owner: LayoutRunOwner::Paragraph,
            layout_run_index: u32::try_from(layout_run_index)
                .map_err(|_| EngineError::ResultTooLarge)?,
            placement_handle: None,
            canonical_revision: layout_run.canonical_revision,
            identity: if allow_dense_identity && placement_cluster.dense {
                PlacementIdentity::Dense
            } else {
                PlacementIdentity::StableSource
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
        };
        let mergeable = self.placement.joins_last(segment);
        let segments_before = self.placement.segment_rows().len();
        let segment_index = self.placement.push_segment(segment, translation)?;
        let joined = self.placement.segment_rows().len() == segments_before;
        self.push_pen_step(
            layout_run,
            direction,
            overlap_start..overlap_end,
            placement_cluster,
            if mergeable { STEP_MERGEABLE } else { 0 } | if joined { STEP_JOINED } else { 0 },
        )?;
        Ok(PlacementOccurrence {
            segment_index,
            translation_inline,
            translation_block,
        })
    }

    fn push_pen_step(
        &mut self,
        layout_run: &LayoutRun,
        direction: u8,
        range: core::ops::Range<usize>,
        placement_cluster: PlacementCluster,
        flags: u8,
    ) -> Result<(), EngineError> {
        let (lane, block) = if placement_cluster.numeric_block_ordinal == u32::MAX {
            (NO_LANE, 0)
        } else {
            let run_offset = if direction & 1 == 0 {
                range.start - layout_run.cluster_start as usize
            } else {
                layout_run.cluster_end as usize - range.start - 1
            };
            (
                u32::try_from(layout_run.numeric_blocks.cluster_start as usize + run_offset)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                layout_run
                    .numeric_blocks
                    .start
                    .checked_add(placement_cluster.numeric_block_ordinal)
                    .ok_or(EngineError::ResultTooLarge)?,
            )
        };
        reserve(&mut self.pen_steps, 1)?;
        self.pen_steps.push(PenStep {
            first: u32::try_from(range.start).map_err(|_| EngineError::ResultTooLarge)?,
            count: u32::try_from(range.len()).map_err(|_| EngineError::ResultTooLarge)?,
            lane,
            block,
            flags,
        });
        Ok(())
    }

    /// Joins `count` clusters from `first` (ascending) to the segment recorded last.
    fn extend_layout_run_segment(
        &mut self,
        segment_index: u32,
        layout_run: &LayoutRun,
        first: usize,
        count: usize,
        clusters: &ClusterArena,
    ) -> Result<(), EngineError> {
        let run_start =
            usize::try_from(layout_run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let last = first + count - 1;
        let glyph_start = clusters.glyph_starts[first];
        let glyph_end = clusters.glyph_starts[last]
            .checked_add(clusters.glyph_counts[last])
            .ok_or(EngineError::ResultTooLarge)?;
        self.placement.extend_last_segment(
            segment_index,
            u32::try_from(first - run_start).map_err(|_| EngineError::ResultTooLarge)?,
            u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?,
            glyph_start
                .checked_sub(layout_run.glyph_start)
                .ok_or(EngineError::InvalidRequest)?,
            glyph_end
                .checked_sub(glyph_start)
                .ok_or(EngineError::InvalidRequest)?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    fn finish_positioned_cluster(
        &mut self,
        line: FlowLine,
        cluster: usize,
        clusters: &ClusterArena,
        positioned: PositionedCluster,
        justify: JustifyDistribution,
        adjust: bool,
        state: &mut FragmentPositionState,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        if adjust {
            apply_justification(
                cluster,
                clusters,
                justify,
                &mut state.cursor,
                &mut state.space_ordinal,
                &mut state.gap_ordinal,
            );
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
    fn position_boundary(
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
        (justify, state): (JustifyDistribution, &mut FragmentPositionState),
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
        let source_end = boundary
            .source_glyph_start
            .checked_add(boundary.source_glyph_count)
            .ok_or(EngineError::ResultTooLarge)?;
        // A corrected line edge lays out cluster by cluster, so each cluster keeps its own decoration and expansion.
        let split = boundary.line_start;
        let last = if split {
            boundary.cluster_end as usize
        } else {
            source_cluster + 1
        };
        let mut pieces = 0;
        let mut glyph = boundary.source_glyph_start;
        for cluster in source_cluster..last {
            let (piece_start, piece_origin) = (glyph, cursor);
            if split {
                let start = clusters.starts[cluster];
                while glyph < source_end && arena.shape.clusters[glyph as usize] == start {
                    glyph += 1;
                }
            } else {
                glyph = source_end;
            }
            if glyph > piece_start {
                let occurrence = self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::BoundarySource,
                    (cluster.min(clusters.starts.len().saturating_sub(1)), pieces),
                    (piece_start, glyph - piece_start),
                    cursor,
                    baseline,
                    clusters,
                )?;
                cursor = self.position_boundary_span(
                    line,
                    cursor,
                    piece_start,
                    glyph - piece_start,
                    boundary.source_binding_handle,
                    boundary.source_font_handle,
                    bidi_level,
                    None,
                    cluster,
                    arena,
                    text,
                    clusters,
                    styles,
                    metrics_for,
                    Some(occurrence),
                )?;
                pieces += 1;
            }
            if split {
                let style = boundary_cluster_style(styles, clusters, cluster)?;
                if glyph == piece_start {
                    // A cluster owning no glyph (a ligature's later component) still advances by its
                    // spacing, as the paragraph and the correction price it.
                    cursor += clusters.advances[cluster];
                }
                state.cursor = cursor;
                self.finish_positioned_cluster(
                    line,
                    cluster,
                    clusters,
                    PositionedCluster {
                        style,
                        font_handle: boundary.source_font_handle,
                        cluster_origin: piece_origin,
                    },
                    justify,
                    true,
                    state,
                    metrics_for,
                )?;
                cursor = state.cursor;
            }
        }
        let replacement_occurrence = (boundary.ellipsis_glyph_count != 0)
            .then(|| {
                self.record_boundary_slice(
                    _boundary_index,
                    boundary.flow_thread_id,
                    BoundaryRunRole::Ellipsis,
                    (ellipsis_cluster, 0),
                    (boundary.ellipsis_glyph_start, boundary.ellipsis_glyph_count),
                    cursor,
                    baseline,
                    clusters,
                )
            })
            .transpose()?;
        self.position_boundary_span(
            line,
            cursor,
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
            replacement_occurrence,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_boundary_slice(
        &mut self,
        boundary_index: u32,
        flow_thread_id: u32,
        run_role: BoundaryRunRole,
        (owner_cluster, ordinal): (usize, u32),
        (glyph_start, glyph_count): (u32, u32),
        cursor: f64,
        baseline: f64,
        clusters: &ClusterArena,
    ) -> Result<PlacementOccurrence, EngineError> {
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
        let whole = glyph_count == run.glyph_count;
        if glyph_start < run.glyph_start
            || glyph_start - run.glyph_start + glyph_count > run.glyph_count
        {
            return Err(EngineError::InvalidRequest);
        }
        let block_lane = usize::try_from(run.numeric_blocks.cluster_start + ordinal)
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
                placement_handle: None,
                canonical_revision: run.canonical_revision,
                identity: PlacementIdentity::StableSource,
                segment_anchor: clusters.stable_ids[owner_cluster],
                source_anchor: clusters.stable_ids[owner_cluster],
                numeric_block_ordinal: block_index
                    .checked_sub(run.numeric_blocks.start)
                    .filter(|ordinal| *ordinal < run.numeric_blocks.count)
                    .ok_or(EngineError::InvalidRequest)?,
                run_cluster_start: ordinal,
                run_cluster_count: if whole {
                    run.numeric_blocks.cluster_count
                } else {
                    1
                },
                glyph_source: GlyphSource::Boundary,
                source_glyph_start: glyph_start - run.glyph_start,
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
    #[allow(clippy::too_many_arguments)]
    fn position_boundary_span(
        &mut self,
        line: FlowLine,
        mut cursor: f64,
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
        occurrence: Option<PlacementOccurrence>,
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
            #[cfg(test)]
            super::work_attribution::record(|work| work.positioned_boundary_glyph_visits += 1);
            let shaped_cluster = *arena
                .shape
                .clusters
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
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
            let occurrence = occurrence.ok_or(EngineError::InvalidRequest)?;
            let segment = *self
                .placement
                .segment_rows()
                .get(
                    usize::try_from(occurrence.segment_index)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            let span = OccurrenceSpan {
                source: GlyphSource::Boundary,
                run_owner: segment.layout_run_owner,
                run_index: segment.layout_run_index,
                source_glyph_start: u32::try_from(glyph)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                source_glyph_count: 1,
                cluster_order: ClusterOrder::Single,
                cluster_count: 1,
                owner_cluster: u32::try_from(cluster_index)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                cluster_override,
                semantic_start: 0,
                outlined_start: 0,
                outlined_count: 0,
                placement_segment: occurrence.segment_index,
                line: self.current_source_line,
                line_facts: SourceLineFacts::from(line),
                font_handle,
                binding_handle,
                font_size: style.font_size,
                bidi_level,
            };
            // The replacement local arena is owned by `self`; rank admission is immutable
            // while positioning, so read it before mutating the span stream.
            let local_counts = self
                .replacement_run_local
                .source_range_counts(span.source_glyph_start, 1)
                .ok_or(EngineError::InvalidRequest)?;
            if local_counts.0 != 1 {
                return Err(EngineError::InvalidRequest);
            }
            self.push_occurrence_span_with_counts(span, local_counts.1)?;
            self.placement
                .push_segment_instances(occurrence.segment_index, local_counts.1)?;
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

pub(crate) fn style_has_text_effects(style: ResolvedStyle) -> bool {
    style.outline_rgba != 0
        || style.outline_width != 0.0
        || style.shadow_rgba != 0
        || style.shadow_offset_x != 0.0
        || style.shadow_offset_y != 0.0
}

struct RetainedFlowLineCursor<'a> {
    lines: core::iter::Peekable<core::iter::Copied<super::retained_rope::RopeIter<'a, FlowLine>>>,
    fragments: RopeCursor<'a, FlowFragment>,
    line_index: usize,
    fragment_index: usize,
}

impl<'a> RetainedFlowLineCursor<'a> {
    fn new(flow: &'a FlowLayoutArena) -> Option<Self> {
        Some(Self {
            lines: flow.lines.iter().copied().peekable(),
            fragments: flow.fragments.cursor_from(0)?,
            line_index: 0,
            fragment_index: 0,
        })
    }
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
#[allow(clippy::too_many_arguments)]
fn matching_retained_line(
    line: FlowLine,
    fragments: &RopeCursorRange<'_, FlowFragment>,
    final_line: bool,
    cursor: &mut RetainedFlowLineCursor<'_>,
    clusters: &ClusterArena,
    bidi: &BidiAnalysis,
    typography: ThreadTypography,
    previous_typography: ThreadTypography,
    (boundary, previous_boundary, edge_pairs): (
        &BoundaryShapeArena,
        &BoundaryShapeArena,
        &mut Vec<(u32, u32)>,
    ),
) -> Result<Option<RetainedLineMatch>, EngineError> {
    let Some(first) = fragments.first() else {
        return Ok(None);
    };
    let cluster_start = first.line.cluster_start;
    while let Some(previous_line) = cursor.lines.peek().copied() {
        let previous_fragment_end = cursor
            .fragment_index
            .checked_add(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::ResultTooLarge)?;
        let previous_fragments = cursor
            .fragments
            .peek(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let Some(previous_first) = previous_fragments.first() else {
            cursor.lines.next();
            cursor.line_index = cursor
                .line_index
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            cursor
                .fragments
                .advance(usize::from(previous_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            cursor.fragment_index = previous_fragment_end;
            continue;
        };
        if previous_line.flow_thread_id != line.flow_thread_id
            || previous_first.line.cluster_start < cluster_start
        {
            cursor.lines.next();
            cursor.line_index = cursor
                .line_index
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            cursor
                .fragments
                .advance(usize::from(previous_line.fragment_count))
                .ok_or(EngineError::InvalidRequest)?;
            cursor.fragment_index = previous_fragment_end;
            continue;
        }
        if previous_first.line.cluster_start > cluster_start {
            return Ok(None);
        }
        let previous_index = cursor.line_index;
        cursor.lines.next();
        cursor.line_index = cursor
            .line_index
            .checked_add(1)
            .ok_or(EngineError::ResultTooLarge)?;
        cursor
            .fragments
            .advance(usize::from(previous_line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        cursor.fragment_index = previous_fragment_end;
        // Content: the same clusters in the same fragments, with an edge record wherever the
        // retained line had one.
        if fragments.len() != previous_fragments.len() {
            return Ok(None);
        }
        edge_pairs.clear();
        for (next, old) in fragments.iter().zip(previous_fragments.iter()) {
            if next.line != old.line {
                return Ok(None);
            }
            for (next, old) in [
                (next.lead_index, old.lead_index),
                (next.tail_index, old.tail_index),
                (next.boundary_index, old.boundary_index),
            ] {
                let absent = super::flow_composition::NO_BOUNDARY;
                match (next == absent, old == absent) {
                    (true, true) => {}
                    (false, false) => {
                        reserve(edge_pairs, 1)?;
                        edge_pairs.push((old, next));
                    }
                    _ => return Ok(None),
                }
            }
        }
        let previous_final_line = cursor
            .lines
            .peek()
            .is_none_or(|next| next.flow_thread_id != previous_line.flow_thread_id);
        // Whether hung spaces lead is content, so it resolves alike on both sides and any
        // one predicate compares the two pens soundly; visual levels are not needed here.
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
        let exact = previous_line.region_id == line.region_id
            && previous_line.transform_index == line.transform_index
            && previous_line.clip_id == line.clip_id
            && previous_line.align == line.align
            && previous_line.block_start.to_bits() == line.block_start.to_bits()
            && previous_line.baseline.to_bits() == line.baseline.to_bits()
            && previous_line.height.to_bits() == line.height.to_bits()
            && final_line == previous_final_line
            && fragments
                .iter()
                .zip(previous_fragments.iter())
                .all(|(next, old)| {
                    next.slot_start.to_bits() == old.slot_start.to_bits()
                        && inputs(line, next, typography, final_line)
                            == inputs(previous_line, old, previous_typography, previous_final_line)
                });
        let edges = !edge_pairs.is_empty();
        if edges {
            // An island advances the pen by its own content, so only a line whose numbers and
            // edge content are both unchanged is retained.
            if !exact {
                return Ok(None);
            }
            for (old, next) in edge_pairs.iter().copied() {
                if !same_edge_record(boundary, next, previous_boundary, old)? {
                    return Ok(None);
                }
            }
        }
        return Ok(Some(RetainedLineMatch {
            index: previous_index,
            line: previous_line,
            exact,
            edges,
        }));
    }
    Ok(None)
}

/// Whether two edge records shape the same glyphs over the same clusters. Where the records
/// sit in their arenas, and the stable ids their glyphs were given, are not content.
fn same_edge_record(
    current: &BoundaryShapeArena,
    current_index: u32,
    previous: &BoundaryShapeArena,
    previous_index: u32,
) -> Result<bool, EngineError> {
    let next = current
        .record(current_index)
        .ok_or(EngineError::InvalidRequest)?;
    let old = previous
        .record(previous_index)
        .ok_or(EngineError::InvalidRequest)?;
    let unplaced = |record: BoundaryShape| BoundaryShape {
        source_glyph_start: 0,
        ellipsis_glyph_start: 0,
        ..record
    };
    if unplaced(next) != unplaced(old) {
        return Ok(false);
    }
    for (next_start, old_start, count) in [
        (
            next.source_glyph_start,
            old.source_glyph_start,
            next.source_glyph_count,
        ),
        (
            next.ellipsis_glyph_start,
            old.ellipsis_glyph_start,
            next.ellipsis_glyph_count,
        ),
    ] {
        let next = next_start as usize..next_start as usize + count as usize;
        let old = old_start as usize..old_start as usize + count as usize;
        fn lane<'a, T>(
            lane: &'a [T],
            range: &core::ops::Range<usize>,
        ) -> Result<&'a [T], EngineError> {
            lane.get(range.clone()).ok_or(EngineError::InvalidRequest)
        }
        let (a, b) = (&current.shape, &previous.shape);
        if lane(&a.glyph_ids, &next)? != lane(&b.glyph_ids, &old)?
            || lane(&a.clusters, &next)? != lane(&b.clusters, &old)?
            || lane(&a.x_advances, &next)? != lane(&b.x_advances, &old)?
            || lane(&a.y_advances, &next)? != lane(&b.y_advances, &old)?
            || lane(&a.x_offsets, &next)? != lane(&b.x_offsets, &old)?
            || lane(&a.y_offsets, &next)? != lane(&b.y_offsets, &old)?
            || lane(&a.glyph_flags, &next)? != lane(&b.glyph_flags, &old)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn is_trivially_ltr(bidi: &BidiAnalysis, runs: &[ShapingRun]) -> bool {
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

fn layout_run_direction(run: LayoutRun, runs: &[ShapingRun]) -> Result<u8, EngineError> {
    usize::try_from(run.source_run)
        .ok()
        .and_then(|source| runs.get(source))
        .map(|run| run.direction)
        .or_else(|| (run.glyph_count == 0).then_some(0))
        .ok_or(EngineError::InvalidRequest)
}

fn layout_run_for_cluster(
    clusters: &ClusterArena,
    cluster: usize,
    cached: &mut Option<(usize, LayoutRun)>,
) -> Result<(usize, LayoutRun), EngineError> {
    let cluster = u32::try_from(cluster).map_err(|_| EngineError::InvalidRequest)?;
    if let Some((index, run)) = *cached
        && run.cluster_start <= cluster
        && cluster < run.cluster_end
    {
        return Ok((index, run));
    }
    let index = clusters
        .layout_runs()
        .partition_point(|run| run.cluster_end <= cluster);
    let run = *clusters
        .layout_runs()
        .get(index)
        .filter(|run| run.cluster_start <= cluster)
        .ok_or(EngineError::InvalidRequest)?;
    *cached = Some((index, run));
    Ok((index, run))
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
    let justified = !justify.is_zero();
    (
        justify,
        fragment_pen_origin(
            line,
            fragment,
            indent,
            paragraph_level,
            justified,
            hung_leads,
        ),
    )
}

/// The exact scalar origin shared by General's fragment walk and an admitted one-line leaf.
/// Justification construction stays in `fragment_pen`; both owners use the same ordered f64
/// additions for slot start, indent, alignment and hanging-space translation.
pub(crate) fn fragment_pen_origin(
    line: FlowLine,
    fragment: FlowFragment,
    indent: f64,
    paragraph_level: u8,
    justified: bool,
    hung_leads: bool,
) -> f64 {
    let available =
        (fragment.slot_end - fragment.slot_start - indent - fragment.line.advance).max(0.0);
    let offset = if justified {
        0.0
    } else {
        alignment_offset(line.align, paragraph_level, available)
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
    fragment.slot_start + indent_shift + offset - hung_shift
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
        || !pending.drop_caps.is_empty()
        || !committed.drop_caps.is_empty()
        || !pending.ellipsis_threads().is_empty()
        || !committed.ellipsis_threads().is_empty()
    {
        return Ok(false);
    }
    let mut fragment_cursor = pending
        .fragments
        .cursor_from(0)
        .ok_or(EngineError::InvalidRequest)?;
    let mut previous_fragment_cursor = committed
        .fragments
        .cursor_from(0)
        .ok_or(EngineError::InvalidRequest)?;
    let mut lines = pending.lines.iter().zip(committed.lines.iter()).peekable();
    while let Some((line, previous)) = lines.next() {
        let next_line = lines.peek().map(|(line, _)| *line);
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
        let final_line = next_line.is_none_or(|next| next.flow_thread_id != line.flow_thread_id);
        let fragments = fragment_cursor
            .take(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let previous_fragments = previous_fragment_cursor
            .take(usize::from(previous.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        if fragments.len() != previous_fragments.len() {
            return Ok(false);
        }
        for (fragment, previous_fragment) in fragments.iter().zip(previous_fragments.iter()) {
            if fragment.line != previous_fragment.line
                || fragment.boundary_index != super::flow_composition::NO_BOUNDARY
                || previous_fragment.boundary_index != super::flow_composition::NO_BOUNDARY
                || fragment.lead_index != super::flow_composition::NO_BOUNDARY
                || previous_fragment.lead_index != super::flow_composition::NO_BOUNDARY
                || fragment.tail_index != super::flow_composition::NO_BOUNDARY
                || previous_fragment.tail_index != super::flow_composition::NO_BOUNDARY
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
    if !fragment_cursor.is_empty() || !previous_fragment_cursor.is_empty() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(true)
}

fn paragraph_level_at(bidi: &BidiAnalysis, offset: u32) -> u8 {
    // Paragraphs are pushed in text order and do not overlap, so the last one starting at or
    // before the offset is the only one that can hold it.
    if let Some(index) = bidi
        .paragraph_starts
        .partition_point(|start| *start <= offset)
        .checked_sub(1)
        && bidi
            .paragraph_ends
            .get(index)
            .is_some_and(|end| offset < *end)
        && let Some(level) = bidi.paragraph_levels.get(index)
    {
        return *level;
    }
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

pub(crate) fn alignment_offset(align: u8, paragraph_level: u8, available: f64) -> f64 {
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

pub(crate) fn placed_f32(local: f32, translation: f32) -> Result<f32, EngineError> {
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
        };
        let equivalent = |pending: &FlowLayoutArena, committed: &FlowLayoutArena| {
            flow_positioning_equivalent(
                pending, committed, &clusters, &bidi, typography, typography,
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
        // A boundary-bearing fragment always takes the full path.
        let mut with_boundary = arena(ALIGN_START, 17.0);
        assert!(
            with_boundary
                .fragments
                .update(0, |fragment| {
                    fragment.boundary_index = 0;
                })
                .unwrap()
        );
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
            next.unpublished_source_intervals(),
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
            newest.unpublished_source_intervals(),
            Some(core::slice::from_ref(&(0..5)))
        );
        newest.mark_published();
        assert_eq!(newest.unpublished_source_intervals(), Some(&[][..]));
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
        let source_intervals = positioned.unpublished_source_intervals().unwrap().to_vec();

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
            positioned.unpublished_source_intervals(),
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
