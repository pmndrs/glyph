//! Column-major projection of prepared owners into codec inputs.
//!
//! A chunk of at most [`CHUNK`] source glyphs is read into per-glyph lanes and two small
//! tables: one row per placement span and one per style range. Every codec input is then
//! one kernel over the chunk -- a lane copy, a table lookup by span or style, or a lookup
//! in a binding table by glyph, strike row or resource -- so no per-glyph row is
//! assembled and no field is interpreted per glyph.

use super::super::{
    cluster_state::ClusterArena,
    codec::{InputSource, MAX_REGISTERS},
    font_binding::MISSING_RESOURCE_INDEX,
    frame::{
        SEMANTIC_F32_BLOCK_EXTENT, SEMANTIC_F32_BLOCK_START, SEMANTIC_F32_FONT_SIZE,
        SEMANTIC_F32_INLINE_EXTENT, SEMANTIC_F32_INLINE_START, SEMANTIC_F32_RASTER_PIXEL_RATIO,
        SEMANTIC_U32_CLUSTER_ID, SEMANTIC_U32_FLOW_THREAD_ID, SEMANTIC_U32_REGION_ID,
        SEMANTIC_U32_STABLE_GLYPH_ID, SEMANTIC_U32_TRANSFORM_INDEX,
    },
    inline_leaf::LeafCluster,
    placement_state::GlyphSource,
    positioning::{ClusterOrder, OccurrenceSpan, SourceLineFacts},
    run_local::RunLocalLanes,
};
use super::*;

/// Source glyphs per chunk. One 64-bit selection word covers a chunk, the lanes of a
/// chunk stay in the first-level cache, and an Inline leaf never exceeds it.
pub(super) const CHUNK: usize = 64;
const LANE: usize = CHUNK - 1;

const LOCAL_INLINE_ORIGIN: usize = 0;
const LOCAL_BLOCK_ORIGIN: usize = 1;
const LOCAL_INK_INLINE_START: usize = 2;
const LOCAL_INK_BLOCK_START: usize = 3;
const LOCAL_INK_INLINE_EXTENT: usize = 4;
const LOCAL_INK_BLOCK_EXTENT: usize = 5;
const LOCAL_LANES: usize = 6;

/// What one placement span contributes to every glyph it holds.
struct SpanFacts {
    font_size: f32,
    placement_slot: u32,
    translation: Option<SegmentTranslation>,
    line: SourceLineFacts,
}

/// Facts shared by every glyph of one placement span.
struct SpanTable {
    len: usize,
    font_size: [f32; CHUNK],
    placement_slot: [u32; CHUNK],
    translation_inline: [f32; CHUNK],
    translation_block: [f32; CHUNK],
    clip_id: [u32; CHUNK],
    region_id: [u32; CHUNK],
    flow_thread_id: [u32; CHUNK],
    transform_index: [u32; CHUNK],
}

/// Facts shared by every glyph of one style range.
struct StyleTable {
    len: usize,
    material_id: [u32; CHUNK],
    raster_pixel_ratio: [f32; CHUNK],
    foreground: [u32; CHUNK],
    outline_rgba: [u32; CHUNK],
    shadow_rgba: [u32; CHUNK],
    outline_width_em: [f32; CHUNK],
    shadow_offset_x_em: [f32; CHUNK],
    shadow_offset_y_em: [f32; CHUNK],
}

/// The per-glyph lanes of one source glyph.
struct GlyphLanes {
    stable_id: u32,
    glyph_id: u32,
    semantic_id: u32,
    stable_cluster: u32,
    /// Inline and block origin, ink start and ink extent, all in run-local space.
    local: [f32; LOCAL_LANES],
}

impl GlyphLanes {
    fn positioned(semantic: PositionedSemanticGlyph, stable_cluster: u32) -> Self {
        Self {
            stable_id: semantic.stable_id,
            glyph_id: u32::from(semantic.glyph_id),
            semantic_id: semantic.cluster,
            stable_cluster,
            local: [
                semantic.inline_origin,
                semantic.block_origin,
                semantic.ink_inline_start,
                semantic.ink_block_start,
                semantic.ink_inline_extent,
                semantic.ink_block_extent,
            ],
        }
    }
}

/// What a retained record takes from its glyph when the storage topology is unchanged.
pub(super) struct RecordGeometry {
    pub(super) stable_id: u32,
    pub(super) semantic_id: u32,
    pub(super) inline_start: f32,
    pub(super) block_start: f32,
    pub(super) inline_extent: f32,
    pub(super) block_extent: f32,
}

/// One chunk of source glyphs in gather order, selected or not.
pub(super) struct SourceChunk {
    pub(super) len: usize,
    pub(super) binding_handle: u32,
    /// The glyphs whose lanes were read from the paragraph's runs, one bit per source glyph.
    run_glyphs: u64,
    pub(super) stable_id: [u32; CHUNK],
    glyph_id: [u32; CHUNK],
    semantic_id: [u32; CHUNK],
    stable_cluster: [u32; CHUNK],
    local: [[f32; CHUNK]; LOCAL_LANES],
    span: [u8; CHUNK],
    style: [u8; CHUNK],
    spans: SpanTable,
    styles: StyleTable,
    /// Binding selection per source glyph: resource index, strike row and rope key.
    resource: [u32; CHUNK],
    strike_row: [u32; CHUNK],
    pub(super) selection: [u32; CHUNK],
}

impl SourceChunk {
    pub(super) fn new() -> Self {
        Self {
            len: 0,
            binding_handle: 0,
            run_glyphs: 0,
            stable_id: [0; CHUNK],
            glyph_id: [0; CHUNK],
            semantic_id: [0; CHUNK],
            stable_cluster: [0; CHUNK],
            local: [[0.0; CHUNK]; LOCAL_LANES],
            span: [0; CHUNK],
            style: [0; CHUNK],
            spans: SpanTable {
                len: 0,
                font_size: [0.0; CHUNK],
                placement_slot: [0; CHUNK],
                translation_inline: [0.0; CHUNK],
                translation_block: [0.0; CHUNK],
                clip_id: [0; CHUNK],
                region_id: [0; CHUNK],
                flow_thread_id: [0; CHUNK],
                transform_index: [0; CHUNK],
            },
            styles: StyleTable {
                len: 0,
                material_id: [0; CHUNK],
                raster_pixel_ratio: [0.0; CHUNK],
                foreground: [0; CHUNK],
                outline_rgba: [0; CHUNK],
                shadow_rgba: [0; CHUNK],
                outline_width_em: [0.0; CHUNK],
                shadow_offset_x_em: [0.0; CHUNK],
                shadow_offset_y_em: [0.0; CHUNK],
            },
            resource: [MISSING_RESOURCE_INDEX; CHUNK],
            strike_row: [0; CHUNK],
            selection: [u32::MAX; CHUNK],
        }
    }

    fn reset(&mut self) {
        self.len = 0;
        self.run_glyphs = 0;
        self.spans.len = 0;
        self.styles.len = 0;
    }

    /// Whether the glyph read its lanes from the paragraph's runs. A boundary glyph and the
    /// rows an Inline leaf projects do not.
    pub(super) fn paragraph_run(&self, index: usize) -> bool {
        self.run_glyphs & (1 << (index & LANE)) != 0
    }

    /// Whether every glyph of the chunk is a [`Self::paragraph_run`].
    pub(super) fn paragraph_runs_only(&self) -> bool {
        self.run_glyphs == u64::MAX >> (CHUNK - self.len.clamp(1, CHUNK))
    }

    pub(super) fn clip_id(&self, index: usize) -> u32 {
        self.spans.clip_id[usize::from(self.span[index & LANE]) & LANE]
    }

    /// A chunk holds the glyphs of one font binding: the first glyph names it.
    fn admits_binding(&mut self, handle: u32) -> bool {
        if self.len == 0 {
            self.binding_handle = handle;
        }
        self.binding_handle == handle
    }

    fn push_span(&mut self, span: SpanFacts) {
        let index = self.spans.len & LANE;
        let spans = &mut self.spans;
        spans.font_size[index] = span.font_size;
        spans.placement_slot[index] = span.placement_slot;
        // A span without a translation cannot place a record; the non-finite origin fails
        // the same placement check a non-finite sum does, and only if a record needs it.
        let (inline, block) = span
            .translation
            .map_or((f32::NAN, f32::NAN), |translation| {
                (
                    translation.translation_inline as f32,
                    translation.translation_block as f32,
                )
            });
        spans.translation_inline[index] = inline;
        spans.translation_block[index] = block;
        spans.clip_id[index] = span.line.clip_id;
        spans.region_id[index] = span.line.region_id;
        spans.flow_thread_id[index] = span.line.flow_thread_id;
        spans.transform_index[index] = span.line.transform_index;
        spans.len += 1;
    }

    /// Style facts come from the one canonical row projection, taken once per style
    /// range instead of once per glyph.
    fn push_style(&mut self, row: &ProjectedSourceRow<'_>) -> Result<(), GatherError> {
        let index = self.styles.len;
        let styles = &mut self.styles;
        styles.material_id[index & LANE] = row.glyph.material_id;
        styles.raster_pixel_ratio[index & LANE] = row.glyph.raster_pixel_ratio;
        styles.foreground[index & LANE] = projected_u32(row, SEMANTIC_U32_FOREGROUND_RGBA)?;
        styles.outline_rgba[index & LANE] = projected_u32(row, SEMANTIC_U32_OUTLINE_RGBA)?;
        styles.shadow_rgba[index & LANE] = projected_u32(row, SEMANTIC_U32_SHADOW_RGBA)?;
        styles.outline_width_em[index & LANE] = projected_f32(row, 6)?;
        styles.shadow_offset_x_em[index & LANE] = projected_f32(row, 7)?;
        styles.shadow_offset_y_em[index & LANE] = projected_f32(row, 8)?;
        styles.len = index + 1;
        Ok(())
    }

    /// Appends one source glyph under the span and style opened last.
    fn push_glyph(&mut self, glyph: GlyphLanes) {
        let index = self.len & LANE;
        self.stable_id[index] = glyph.stable_id;
        self.glyph_id[index] = glyph.glyph_id;
        self.semantic_id[index] = glyph.semantic_id;
        self.stable_cluster[index] = glyph.stable_cluster;
        self.span[index] = self.spans.len.wrapping_sub(1) as u8;
        self.style[index] = self.styles.len.wrapping_sub(1) as u8;
        let [
            inline_origin,
            block_origin,
            ink_inline,
            ink_block,
            extent_inline,
            extent_block,
        ] = glyph.local;
        self.local[LOCAL_INLINE_ORIGIN][index] = inline_origin;
        self.local[LOCAL_BLOCK_ORIGIN][index] = block_origin;
        self.local[LOCAL_INK_INLINE_START][index] = ink_inline;
        self.local[LOCAL_INK_BLOCK_START][index] = ink_block;
        self.local[LOCAL_INK_INLINE_EXTENT][index] = extent_inline;
        self.local[LOCAL_INK_BLOCK_EXTENT][index] = extent_block;
        self.len += 1;
    }

    /// Resolves the binding selection of every source glyph. The strike depends on the
    /// span's size and the style's pixel ratio only, so it is resolved once per range.
    pub(super) fn select(&mut self, binding: &FontRenderBinding) {
        let glyph_count = binding.glyph_count();
        let mut range = (u8::MAX, u8::MAX);
        let mut strike = None;
        for index in 0..self.len {
            let next = (self.span[index], self.style[index]);
            if next != range {
                range = next;
                strike = binding
                    .strike_for(
                        self.spans.font_size[usize::from(next.0) & LANE],
                        self.styles.raster_pixel_ratio[usize::from(next.1) & LANE],
                    )
                    .and_then(|strike| {
                        Some((
                            strike,
                            strike.checked_mul(glyph_count)?,
                            binding.strike_resource_indices(strike)?,
                        ))
                    });
            }
            let glyph = self.glyph_id[index];
            let (resource, strike_row, selection) = match strike {
                Some((strike, base, resources)) => {
                    let resource = resources
                        .get(glyph as usize)
                        .copied()
                        .unwrap_or(MISSING_RESOURCE_INDEX);
                    let selected = resource != MISSING_RESOURCE_INDEX;
                    (
                        resource,
                        base.wrapping_add(glyph),
                        if selected {
                            (strike << 16) | resource
                        } else {
                            u32::MAX
                        },
                    )
                }
                None => (MISSING_RESOURCE_INDEX, 0, u32::MAX),
            };
            self.resource[index] = resource;
            self.strike_row[index] = strike_row;
            self.selection[index] = selection;
        }
    }

    pub(super) fn selected(&self, index: usize) -> bool {
        self.resource[index & LANE] != MISSING_RESOURCE_INDEX
    }

    pub(super) fn placement_slots(&self, rows: Rows<'_>, out: &mut [u32]) {
        table_lane(
            &self.spans.placement_slot,
            self.spans.len,
            &self.span,
            rows,
            out,
        );
    }

    pub(super) fn placement_slot(&self, index: usize) -> u32 {
        self.spans.placement_slot[usize::from(self.span[index & LANE]) & LANE]
    }

    /// Identity and placed ink of one selected source glyph. The origin of a span without
    /// a translation, or one that overflows, is not finite and is refused.
    pub(super) fn record_geometry(&self, index: usize) -> Result<RecordGeometry, GatherError> {
        let index = index & LANE;
        let span = usize::from(self.span[index]) & LANE;
        let inline_start =
            self.local[LOCAL_INK_INLINE_START][index] + self.spans.translation_inline[span];
        let block_start =
            self.local[LOCAL_INK_BLOCK_START][index] + self.spans.translation_block[span];
        if !inline_start.is_finite() || !block_start.is_finite() {
            return Err(GatherError::InvalidSemanticShape);
        }
        Ok(RecordGeometry {
            stable_id: self.stable_id[index],
            semantic_id: self.semantic_id[index],
            inline_start,
            block_start,
            inline_extent: self.local[LOCAL_INK_INLINE_EXTENT][index],
            block_extent: self.local[LOCAL_INK_BLOCK_EXTENT][index],
        })
    }

    /// The placed origin of one selected source glyph under the identity and extent of its
    /// accepted record, for a chunk that read [`Lanes::Placed`].
    pub(super) fn record_placement(
        &self,
        index: usize,
        accepted: &PlanGlyph,
    ) -> Result<RecordGeometry, GatherError> {
        let index = index & LANE;
        let span = usize::from(self.span[index]) & LANE;
        let inline_start =
            self.local[LOCAL_INK_INLINE_START][index] + self.spans.translation_inline[span];
        let block_start =
            self.local[LOCAL_INK_BLOCK_START][index] + self.spans.translation_block[span];
        if !inline_start.is_finite() || !block_start.is_finite() {
            return Err(GatherError::InvalidSemanticShape);
        }
        Ok(RecordGeometry {
            stable_id: accepted.stable_id,
            semantic_id: accepted.semantic_id,
            inline_start,
            block_start,
            inline_extent: accepted.inline_extent,
            block_extent: accepted.block_extent,
        })
    }

    /// The storage topology of one selected source glyph: everything of its plan record
    /// that decides where the record is stored and drawn.
    pub(super) fn record_topology(
        &self,
        index: usize,
        binding: &FontRenderBinding,
        transform_id: u32,
    ) -> Result<PlanGlyph, GatherError> {
        let index = index & LANE;
        let resource = binding
            .resources()
            .get(self.resource[index] as usize)
            .ok_or(GatherError::ResourceBindingMissing)?;
        Ok(PlanGlyph {
            stable_id: 0,
            content_revision: 0,
            technique: binding.technique(),
            program_variant: binding.program_variant(),
            resource_id: resource.id,
            resource_generation: resource.generation,
            resource_kind: resource.kind,
            resource_reference: resource.reference,
            semantic_id: 0,
            transform_id,
            material_id: self.styles.material_id[usize::from(self.style[index]) & LANE],
            clip_id: self.spans.clip_id[usize::from(self.span[index]) & LANE],
            depth_key: PAINT_LAYER_GLYPH,
            inline_start: 0.0,
            block_start: 0.0,
            inline_extent: 0.0,
            block_extent: 0.0,
        })
    }

    /// The plan record of one selected source glyph.
    pub(super) fn plan_glyph(
        &self,
        index: usize,
        binding: &FontRenderBinding,
        transform_id: u32,
        content_revision: u32,
    ) -> Result<PlanGlyph, GatherError> {
        let geometry = self.record_geometry(index)?;
        Ok(PlanGlyph {
            stable_id: geometry.stable_id,
            content_revision,
            semantic_id: geometry.semantic_id,
            inline_start: geometry.inline_start,
            block_start: geometry.block_start,
            inline_extent: geometry.inline_extent,
            block_extent: geometry.block_extent,
            ..self.record_topology(index, binding, transform_id)?
        })
    }
}

fn projected_f32(row: &ProjectedSourceRow<'_>, field: usize) -> Result<f32, GatherError> {
    row.f32(field).ok_or(GatherError::SourceFieldMissing)
}

fn projected_u32(row: &ProjectedSourceRow<'_>, field: u8) -> Result<u32, GatherError> {
    row.u32(usize::from(field))
        .ok_or(GatherError::SourceFieldMissing)
}

/// Which per-glyph lanes a chunk reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Lanes {
    All,
    /// Identity and ink origin of a paragraph-run glyph, with its placement span: what a
    /// retained record whose glyph row did not change is paired and re-placed by. A boundary
    /// glyph still reads every lane.
    Placed,
}

/// Streams the outlined source glyphs of one prepared owner into chunks.
pub(super) enum RowSource<'a> {
    Projected(ProjectedRows<'a>),
    Inline(InlineRows<'a>),
}

impl<'a> RowSource<'a> {
    /// Flat input keeps its caller-authored rows and never takes the column path.
    pub(super) fn new(input: GatherInput<'a>) -> Option<Self> {
        match input {
            #[cfg(test)]
            GatherInput::Flat(_) => None,
            GatherInput::Projected(input) => Some(Self::Projected(ProjectedRows::new(input))),
            GatherInput::Inline(input) => Some(Self::Inline(InlineRows {
                input,
                remaining: input.leaf.outline_mask,
                next_index: 0,
            })),
        }
    }

    /// Fills `chunk` with up to `limit` source glyphs starting at outlined ordinal `start`.
    /// A chunk ends early where the font binding changes or the owner runs out.
    pub(super) fn fill(
        &mut self,
        chunk: &mut SourceChunk,
        start: usize,
        limit: usize,
        lanes: Lanes,
    ) -> Result<(), GatherError> {
        chunk.reset();
        let limit = limit.min(CHUNK);
        match self {
            Self::Projected(rows) => {
                rows.lanes = lanes;
                rows.fill(chunk, start, limit)
            }
            // An Inline leaf projects its own rows and always reads every lane.
            Self::Inline(rows) => rows.fill(chunk, start, limit),
        }
    }
}

pub(super) struct ProjectedRows<'a> {
    input: ProjectedPlanInput<'a>,
    cursor: Option<OutlinedOccurrenceCursor<'a>>,
    /// The cursor fell behind a span walk and seeks to `next_index` before its next mark.
    cursor_stale: bool,
    next_index: usize,
    lanes: Lanes,
    /// A mark read past a binding change; it opens the next chunk.
    pending: Option<OutlinedOccurrenceMark>,
    span: Option<(usize, &'a OccurrenceSpan)>,
    walk: Option<SpanWalk<'a>>,
}

/// A paragraph-run span being read without the cursor: its clusters in visual order, and
/// within a cluster the outlined source glyphs in source order.
struct SpanWalk<'a> {
    span_index: usize,
    span: &'a OccurrenceSpan,
    cluster_offset: u32,
    /// Next source glyph to test in the current cluster; `None` opens the cluster.
    source_next: Option<u32>,
    remaining: usize,
}

/// The span and style last pushed into the chunk being filled.
#[derive(Default)]
struct ChunkRanges {
    span: Option<usize>,
    style: Option<u32>,
}

impl<'a> ProjectedRows<'a> {
    fn new(input: ProjectedPlanInput<'a>) -> Self {
        Self {
            input,
            cursor: input.selection.is_none().then(|| {
                input
                    .positioned
                    .outlined_cursor(input.context.clusters, input.boundary)
            }),
            cursor_stale: false,
            next_index: 0,
            lanes: Lanes::All,
            pending: None,
            span: None,
            walk: None,
        }
    }

    fn seek(&mut self, index: usize) {
        if index != self.next_index {
            self.pending = None;
            self.walk = None;
            self.cursor_stale = true;
            self.next_index = index;
        }
    }

    fn next_mark(&mut self) -> Result<Option<OutlinedOccurrenceMark>, GatherError> {
        if let Some(mark) = self.pending.take() {
            return Ok(Some(mark));
        }
        match (self.input.selection, self.cursor.as_mut()) {
            (Some(selection), _) => Ok(selection.get(self.next_index).copied()),
            (None, Some(cursor)) => {
                if self.cursor_stale {
                    cursor
                        .seek(self.next_index)
                        .map_err(|_| GatherError::InvalidSemanticShape)?;
                    self.cursor_stale = false;
                }
                cursor
                    .next_mark()
                    .map_err(|_| GatherError::InvalidSemanticShape)
            }
            (None, None) => Err(GatherError::InvalidSemanticShape),
        }
    }

    fn span_facts(&self, span: &OccurrenceSpan) -> Result<SpanFacts, GatherError> {
        let positioned = self.input.positioned;
        let segment = span.placement_segment as usize;
        let placement_slot = if let Some(segments) = self.input.copied_placement_segments {
            u32::try_from(
                segments
                    .binary_search(&span.placement_segment)
                    .map_err(|_| GatherError::InvalidSemanticShape)?,
            )
            .map_err(|_| GatherError::AllocationFailed)?
        } else {
            positioned
                .placement_handle(segment)
                .ok_or(GatherError::InvalidSemanticShape)?
                .slot()
                .get()
        };
        Ok(SpanFacts {
            font_size: span.font_size,
            placement_slot,
            translation: positioned.placement_translations().get(segment).copied(),
            line: span.line_facts,
        })
    }

    fn open_span(
        &self,
        chunk: &mut SourceChunk,
        ranges: &mut ChunkRanges,
        span_index: usize,
        span: &OccurrenceSpan,
    ) -> Result<(), GatherError> {
        if ranges.span != Some(span_index) {
            chunk.push_span(self.span_facts(span)?);
            ranges.span = Some(span_index);
        }
        Ok(())
    }

    /// Opens the span and style ranges a glyph starts. A span's facts are its own; a
    /// style's come from the canonical row projection of the glyph that opens it. A
    /// boundary glyph also takes its per-glyph lanes from that projection.
    fn open_ranges(
        &self,
        chunk: &mut SourceChunk,
        ranges: &mut ChunkRanges,
        span: &OccurrenceSpan,
        mark: OutlinedOccurrenceMark,
        style_index: u32,
    ) -> Result<Option<PositionedSemanticGlyph>, GatherError> {
        self.open_span(chunk, ranges, mark.span_index, span)?;
        let new_style = ranges.style != Some(style_index);
        if !new_style && span.source != GlyphSource::Boundary {
            return Ok(None);
        }
        let input = self.input;
        let occurrence = input
            .positioned
            .project_outlined_mark(mark, input.context.clusters, input.boundary)
            .map_err(|_| GatherError::InvalidSemanticShape)?;
        let semantic = occurrence.semantic;
        if new_style {
            let row = input
                .positioned
                .projected_occurrence_row(occurrence, mark.semantic_index, 0, input.context)
                .map_err(|_| GatherError::InvalidSemanticShape)?;
            chunk.push_style(&row)?;
            ranges.style = Some(style_index);
        }
        Ok(Some(semantic))
    }

    fn fill(
        &mut self,
        chunk: &mut SourceChunk,
        start: usize,
        limit: usize,
    ) -> Result<(), GatherError> {
        self.seek(start);
        let mut ranges = ChunkRanges::default();
        while chunk.len < limit {
            if let Some(walk) = self.walk.take() {
                if !chunk.admits_binding(walk.span.binding_handle) {
                    self.walk = Some(walk);
                    break;
                }
                self.walk = self.fill_walk(chunk, &mut ranges, walk, limit)?;
                continue;
            }
            let Some(mark) = self.next_mark()? else {
                break;
            };
            let span = self.span_of(mark)?;
            if !chunk.admits_binding(span.binding_handle) {
                self.pending = Some(mark);
                break;
            }
            if span.source == GlyphSource::LayoutRun && self.input.selection.is_none() {
                self.walk = Some(SpanWalk::at(mark, span, self.next_index));
                self.cursor_stale = true;
                continue;
            }
            self.push_mark(chunk, &mut ranges, span, mark)?;
            self.next_index += 1;
        }
        Ok(())
    }

    /// The span a mark names. Positioning hands a span out with a projected occurrence.
    fn span_of(&mut self, mark: OutlinedOccurrenceMark) -> Result<&'a OccurrenceSpan, GatherError> {
        if let Some((index, span)) = self.span
            && index == mark.span_index
        {
            return Ok(span);
        }
        let input = self.input;
        let span = input
            .positioned
            .project_outlined_mark(mark, input.context.clusters, input.boundary)
            .map_err(|_| GatherError::InvalidSemanticShape)?
            .span;
        self.span = Some((mark.span_index, span));
        Ok(span)
    }

    /// One glyph named by a cursor or selection mark.
    fn push_mark(
        &self,
        chunk: &mut SourceChunk,
        ranges: &mut ChunkRanges,
        span: &OccurrenceSpan,
        mark: OutlinedOccurrenceMark,
    ) -> Result<(), GatherError> {
        let clusters = self.input.context.clusters;
        let (style_index, stable_cluster) = cluster_facts(clusters, mark.owner_cluster)?;
        let boundary = self.open_ranges(chunk, ranges, span, mark, style_index)?;
        if let Some(semantic) = boundary.filter(|_| span.source == GlyphSource::Boundary) {
            chunk.push_glyph(GlyphLanes::positioned(semantic, stable_cluster));
            return Ok(());
        }
        push_run_glyph(
            chunk,
            clusters,
            clusters.run_local().lanes(),
            mark.source_glyph,
            stable_cluster,
        )
    }

    /// Reads the walked span cluster by cluster until the chunk is full or the span is
    /// read, and returns the walk that continues: the rest of this span, the next
    /// paragraph-run span, or none when the cursor has to take over.
    fn fill_walk(
        &mut self,
        chunk: &mut SourceChunk,
        ranges: &mut ChunkRanges,
        mut walk: SpanWalk<'a>,
        limit: usize,
    ) -> Result<Option<SpanWalk<'a>>, GatherError> {
        self.open_span(chunk, ranges, walk.span_index, walk.span)?;
        while chunk.len < limit && walk.remaining != 0 {
            let cluster = walk.cluster(self.input.context.clusters)?;
            self.fill_cluster(chunk, ranges, &mut walk, cluster, limit)?;
        }
        Ok(if walk.remaining != 0 {
            Some(walk)
        } else {
            self.following_walk(walk.span_index)
        })
    }

    /// Reads the outlined glyphs of one cluster in source order and returns the last one.
    fn fill_cluster(
        &mut self,
        chunk: &mut SourceChunk,
        ranges: &mut ChunkRanges,
        walk: &mut SpanWalk<'a>,
        cluster: WalkCluster,
        limit: usize,
    ) -> Result<Option<u32>, GatherError> {
        let clusters = self.input.context.clusters;
        let local = clusters.run_local();
        let rows = local.lanes();
        let mut source_next = walk.source_next.unwrap_or(cluster.start);
        let mut last_source = None;
        // One style covers a cluster, so only its first glyph can open a style range. A
        // chunk of placed lanes reads no style.
        let placed = self.lanes == Lanes::Placed;
        let mut style_open = placed || ranges.style == Some(cluster.style_index);
        while let Some(source) = local.next_outlined_source(source_next, cluster.end) {
            if chunk.len >= limit || walk.remaining == 0 {
                // The chunk ends inside this cluster; the next chunk resumes here.
                walk.source_next = Some(source_next);
                return Ok(last_source);
            }
            if !style_open {
                let mark = OutlinedOccurrenceMark {
                    span_index: walk.span_index,
                    source_glyph: source,
                    owner_cluster: cluster.index,
                    semantic_index: 0,
                };
                self.open_ranges(chunk, ranges, walk.span, mark, cluster.style_index)?;
                style_open = true;
            }
            if placed {
                push_placed_glyph(chunk, clusters, rows, source)?;
            } else {
                push_run_glyph(chunk, clusters, rows, source, cluster.stable_id)?;
            }
            self.next_index += 1;
            walk.remaining -= 1;
            last_source = Some(source);
            source_next = source.wrapping_add(1);
            if source_next >= cluster.end {
                // The cluster's last glyph: no second scan to learn that it ended.
                break;
            }
        }
        walk.cluster_offset += 1;
        walk.source_next = None;
        Ok(last_source)
    }

    /// The paragraph-run span after `span_index`, if the walk can continue without the
    /// cursor: the next span with an outlined glyph, used only when it starts exactly where
    /// the walk stands. Anything else -- a boundary span, the end of the owner -- leaves the
    /// cursor to resume from `next_index`.
    fn following_walk(&self, span_index: usize) -> Option<SpanWalk<'a>> {
        let spans = self.input.positioned.occurrence_spans();
        let mut span_index = span_index;
        loop {
            span_index += 1;
            let span = spans.get(span_index)?;
            if span.outlined_count == 0 {
                continue;
            }
            return (span.source == GlyphSource::LayoutRun
                && span.outlined_start as usize == self.next_index)
                .then_some(SpanWalk {
                    span_index,
                    span,
                    cluster_offset: 0,
                    source_next: None,
                    remaining: span.outlined_count as usize,
                });
        }
    }
}

/// One cluster of a walked span: its source glyph range and the facts its glyphs share.
struct WalkCluster {
    index: u32,
    start: u32,
    end: u32,
    style_index: u32,
    stable_id: u32,
}

impl<'a> SpanWalk<'a> {
    /// A walk that starts at the glyph a cursor mark names.
    fn at(mark: OutlinedOccurrenceMark, span: &'a OccurrenceSpan, next_index: usize) -> Self {
        Self {
            span_index: mark.span_index,
            span,
            cluster_offset: match span.cluster_order {
                ClusterOrder::Single => 0,
                ClusterOrder::Forward => mark.owner_cluster.wrapping_sub(span.owner_cluster),
                ClusterOrder::Reverse => span.owner_cluster.wrapping_sub(mark.owner_cluster),
            },
            source_next: Some(mark.source_glyph),
            remaining: (span.outlined_start as usize + span.outlined_count as usize)
                .saturating_sub(next_index),
        }
    }

    /// The cluster the walk stands in, in the span's visual order. A span that is one
    /// cluster owns its whole source range.
    fn cluster(&self, clusters: &ClusterArena) -> Result<WalkCluster, GatherError> {
        let span = self.span;
        if self.cluster_offset >= span.cluster_count {
            return Err(GatherError::InvalidSemanticShape);
        }
        let index = match span.cluster_order {
            ClusterOrder::Single => span.owner_cluster,
            ClusterOrder::Forward => span.owner_cluster.wrapping_add(self.cluster_offset),
            ClusterOrder::Reverse => span.owner_cluster.wrapping_sub(self.cluster_offset),
        };
        let (start, count) = if span.cluster_order == ClusterOrder::Single {
            (span.source_glyph_start, span.source_glyph_count)
        } else {
            let (Some(&start), Some(&count)) = (
                clusters.glyph_starts.get(index as usize),
                clusters.glyph_counts.get(index as usize),
            ) else {
                return Err(GatherError::InvalidSemanticShape);
            };
            (start, count)
        };
        let (style_index, stable_id) = cluster_facts(clusters, index)?;
        Ok(WalkCluster {
            index,
            start,
            end: start.wrapping_add(count),
            style_index,
            stable_id,
        })
    }
}

/// The style range and stable identity of one cluster.
fn cluster_facts(clusters: &ClusterArena, cluster: u32) -> Result<(u32, u32), GatherError> {
    match (
        clusters.style_indexes.get(cluster as usize),
        clusters.stable_ids.get(cluster as usize),
    ) {
        (Some(&style_index), Some(&stable_id)) => Ok((style_index, stable_id)),
        _ => Err(GatherError::InvalidSemanticShape),
    }
}

/// A paragraph-run glyph reads the cluster-order lanes directly: identity from the cluster
/// arena, geometry from the run-local row lanes, both indexed by source glyph. The walk only
/// yields glyphs a block covers, so the row lanes need no second coverage test.
fn push_run_glyph(
    chunk: &mut SourceChunk,
    clusters: &ClusterArena,
    rows: RunLocalLanes<'_>,
    source_glyph: u32,
    stable_cluster: u32,
) -> Result<(), GatherError> {
    let source = source_glyph as usize;
    let (
        Some(&stable_id),
        Some(&glyph_id),
        Some(&semantic_id),
        Some(&inline_origin),
        Some(&block_origin),
        Some(&ink_inline_start),
        Some(&ink_block_start),
        Some(&ink_inline_extent),
        Some(&ink_block_extent),
    ) = (
        clusters.glyph_stable_ids.get(source),
        clusters.glyph_ids.get(source),
        clusters.glyph_clusters.get(source),
        rows.inline_origin.get(source),
        rows.block_origin.get(source),
        rows.ink_inline_start.get(source),
        rows.ink_block_start.get(source),
        rows.ink_inline_extent.get(source),
        rows.ink_block_extent.get(source),
    )
    else {
        return Err(GatherError::InvalidSemanticShape);
    };
    chunk.run_glyphs |= 1 << (chunk.len & LANE);
    chunk.push_glyph(GlyphLanes {
        stable_id,
        glyph_id: u32::from(glyph_id),
        semantic_id,
        stable_cluster,
        local: [
            inline_origin,
            block_origin,
            ink_inline_start,
            ink_block_start,
            ink_inline_extent,
            ink_block_extent,
        ],
    });
    Ok(())
}

/// The placed lanes of a paragraph-run glyph: its identity and ink origin.
fn push_placed_glyph(
    chunk: &mut SourceChunk,
    clusters: &ClusterArena,
    rows: RunLocalLanes<'_>,
    source_glyph: u32,
) -> Result<(), GatherError> {
    let source = source_glyph as usize;
    let (Some(&stable_id), Some(&ink_inline_start), Some(&ink_block_start)) = (
        clusters.glyph_stable_ids.get(source),
        rows.ink_inline_start.get(source),
        rows.ink_block_start.get(source),
    ) else {
        return Err(GatherError::InvalidSemanticShape);
    };
    let index = chunk.len & LANE;
    chunk.run_glyphs |= 1 << index;
    chunk.stable_id[index] = stable_id;
    chunk.span[index] = chunk.spans.len.wrapping_sub(1) as u8;
    chunk.local[LOCAL_INK_INLINE_START][index] = ink_inline_start;
    chunk.local[LOCAL_INK_BLOCK_START][index] = ink_block_start;
    chunk.len += 1;
    Ok(())
}

pub(super) struct InlineRows<'a> {
    input: InlinePlanInput<'a>,
    /// Outline bits not yet read; unused when the input carries a selection.
    remaining: u64,
    next_index: usize,
}

impl InlineRows<'_> {
    fn seek(&mut self, index: usize) {
        if index == self.next_index {
            return;
        }
        let mut remaining = self.input.leaf.outline_mask;
        for _ in 0..index.min(CHUNK) {
            remaining &= remaining.wrapping_sub(1);
        }
        self.remaining = remaining;
        self.next_index = index;
    }

    /// The source glyph at the next outlined ordinal, without consuming it.
    fn next_source(&self) -> Option<u32> {
        match self.input.selection {
            Some(selection) => selection.get(self.next_index).copied(),
            None => (self.remaining != 0).then(|| self.remaining.trailing_zeros()),
        }
    }

    fn fill(
        &mut self,
        chunk: &mut SourceChunk,
        start: usize,
        limit: usize,
    ) -> Result<(), GatherError> {
        self.seek(start);
        let leaf = self.input.leaf;
        let mut ranges = InlineRanges::default();
        let mut cluster_index = 0;
        while chunk.len < limit {
            let Some(source) = self.next_source() else {
                break;
            };
            let semantic = leaf
                .rows
                .row_for_source_glyph(source)
                .filter(|row| row.has_outline)
                .ok_or(GatherError::InvalidSemanticShape)?
                .semantic;
            let cluster = owning_cluster(&leaf.clusters, source, &mut cluster_index)?;
            if !chunk.admits_binding(cluster.binding_handle) {
                break;
            }
            self.open_ranges(chunk, &mut ranges, source, semantic, cluster.style_index)?;
            chunk.push_glyph(GlyphLanes::positioned(semantic, cluster.stable_text_id));
            self.remaining &= self.remaining.wrapping_sub(1);
            self.next_index += 1;
        }
        Ok(())
    }

    /// Opens the span and style ranges a glyph starts, both from the leaf's canonical row
    /// projection of that glyph.
    fn open_ranges(
        &self,
        chunk: &mut SourceChunk,
        ranges: &mut InlineRanges,
        source: u32,
        semantic: PositionedSemanticGlyph,
        style_index: u32,
    ) -> Result<(), GatherError> {
        let span = (semantic.placement_segment, semantic.font_size.to_bits());
        let new_span = ranges.span != Some(span);
        let new_style = ranges.style != Some(style_index);
        if !new_span && !new_style {
            return Ok(());
        }
        let leaf = self.input.leaf;
        let segment = semantic.placement_segment as usize;
        let placement_slot = if let Some(segments) = self.input.copied_placement_segments {
            u32::try_from(
                segments
                    .binary_search(&semantic.placement_segment)
                    .map_err(|_| GatherError::InvalidSemanticShape)?,
            )
            .map_err(|_| GatherError::AllocationFailed)?
        } else {
            leaf.placement_handle(segment)
                .ok_or(GatherError::InvalidSemanticShape)?
                .slot()
                .get()
        };
        // Inline admission proves LTR source order equals semantic occurrence order.
        let projected = leaf
            .projected_source_row(source, source, placement_slot, self.input.styles)
            .map_err(|_| GatherError::InvalidSemanticShape)?;
        if new_span {
            chunk.push_span(SpanFacts {
                font_size: projected.glyph.font_size,
                placement_slot,
                translation: leaf.placement_translations().get(segment).copied(),
                line: SourceLineFacts {
                    clip_id: projected.glyph.clip_id,
                    region_id: projected_u32(&projected, SEMANTIC_U32_REGION_ID)?,
                    flow_thread_id: projected_u32(&projected, SEMANTIC_U32_FLOW_THREAD_ID)?,
                    transform_index: projected_u32(&projected, SEMANTIC_U32_TRANSFORM_INDEX)?,
                },
            });
            ranges.span = Some(span);
        }
        if new_style {
            chunk.push_style(&projected)?;
            ranges.style = Some(style_index);
        }
        Ok(())
    }
}

/// The placement segment and size, and the style, last pushed into the chunk being filled.
#[derive(Default)]
struct InlineRanges {
    span: Option<(u32, u32)>,
    style: Option<u32>,
}

/// The leaf cluster that owns a source glyph. Sources ascend within a leaf, so the search
/// resumes from the cluster the previous glyph used.
fn owning_cluster<'a>(
    clusters: &'a [LeafCluster],
    source: u32,
    index: &mut usize,
) -> Result<&'a LeafCluster, GatherError> {
    if clusters
        .get(*index)
        .is_none_or(|cluster| source < cluster.glyph_start)
    {
        *index = 0;
    }
    while clusters
        .get(*index)
        .is_some_and(|cluster| cluster.glyph_start + cluster.glyph_count <= source)
    {
        *index += 1;
    }
    clusters
        .get(*index)
        .filter(|cluster| source >= cluster.glyph_start)
        .ok_or(GatherError::InvalidSemanticShape)
}

/// Where one F32 codec input comes from, decided once per program and binding.
#[derive(Clone, Copy)]
enum F32Source<'b> {
    Local(usize),
    FontSize,
    InverseFontSize,
    RasterPixelRatio,
    OutlineWidthEm,
    ShadowOffsetXEm,
    ShadowOffsetYEm,
    ForegroundLinear(u32),
    ForegroundAlpha,
    Glyph(&'b [f32]),
    Strike(&'b [f32]),
    Resource(&'b [f32]),
    Missing,
}

/// Where one U32 codec input comes from, decided once per program and binding.
#[derive(Clone, Copy)]
enum U32Source<'b> {
    PlacementSlot,
    Foreground,
    StableCluster,
    RegionId,
    FlowThreadId,
    TransformIndex,
    StableGlyph,
    OutlineRgba,
    ShadowRgba,
    Glyph(&'b [u32]),
    Strike(&'b [u32]),
    Resource(&'b [u32]),
    Missing,
}

/// One program's inputs classified into source kernels for one font binding.
pub(super) struct ColumnPlan<'c, 'b> {
    program: &'c ProgramDescriptor,
    f32_sources: [F32Source<'b>; MAX_REGISTERS],
    u32_sources: [U32Source<'b>; MAX_REGISTERS],
    f32_dependencies: [u16; MAX_REGISTERS],
    u32_dependencies: [u16; MAX_REGISTERS],
}

impl<'c, 'b> ColumnPlan<'c, 'b> {
    pub(super) fn new(binding: &'b FontRenderBinding, program: &'c ProgramDescriptor) -> Self {
        let mut plan = Self {
            program,
            f32_sources: [F32Source::Missing; MAX_REGISTERS],
            u32_sources: [U32Source::Missing; MAX_REGISTERS],
            f32_dependencies: [0; MAX_REGISTERS],
            u32_dependencies: [0; MAX_REGISTERS],
        };
        let f32_count = usize::from(program.f32_input_count);
        for (field, source) in program.inputs.iter().take(f32_count).enumerate() {
            if field < MAX_REGISTERS {
                plan.f32_sources[field] = f32_source(*source, binding);
                plan.f32_dependencies[field] = change_dependency(f32_input_dependency(*source));
            }
        }
        let u32_inputs = program
            .inputs
            .iter()
            .skip(f32_count)
            .take(usize::from(program.u32_input_count));
        for (field, source) in u32_inputs.enumerate() {
            if field < MAX_REGISTERS {
                plan.u32_sources[field] = u32_source(*source, binding);
                plan.u32_dependencies[field] = change_dependency(u32_input_dependency(*source));
            }
        }
        plan
    }

    pub(super) fn f32_count(&self) -> usize {
        usize::from(self.program.f32_input_count).min(MAX_REGISTERS)
    }

    pub(super) fn u32_count(&self) -> usize {
        usize::from(self.program.u32_input_count).min(MAX_REGISTERS)
    }

    pub(super) fn f32_dependency(&self, field: usize) -> u16 {
        self.f32_dependencies[field % MAX_REGISTERS]
    }

    pub(super) fn u32_dependency(&self, field: usize) -> u16 {
        self.u32_dependencies[field % MAX_REGISTERS]
    }

    /// Whether a placement span decides this input, so a glyph that keeps its identity can
    /// still change it by moving to another line or segment.
    pub(super) fn f32_follows_placement(&self, field: usize) -> bool {
        matches!(
            self.f32_sources[field % MAX_REGISTERS],
            F32Source::FontSize | F32Source::InverseFontSize | F32Source::Missing
        )
    }

    /// The U32 counterpart of [`Self::f32_follows_placement`].
    pub(super) fn u32_follows_placement(&self, field: usize) -> bool {
        matches!(
            self.u32_sources[field % MAX_REGISTERS],
            U32Source::PlacementSlot
                | U32Source::RegionId
                | U32Source::FlowThreadId
                | U32Source::TransformIndex
                | U32Source::Missing
        )
    }

    /// Writes one F32 input for the selected rows. `false` means the source is missing.
    pub(super) fn f32_column(
        &self,
        field: usize,
        chunk: &SourceChunk,
        rows: Rows<'_>,
        out: &mut [f32],
    ) -> bool {
        f32_column(self.f32_sources[field % MAX_REGISTERS], chunk, rows, out)
    }

    /// Writes one U32 input for the selected rows. `false` means the source is missing.
    pub(super) fn u32_column(
        &self,
        field: usize,
        chunk: &SourceChunk,
        rows: Rows<'_>,
        out: &mut [u32],
    ) -> bool {
        u32_column(self.u32_sources[field % MAX_REGISTERS], chunk, rows, out)
    }
}

/// An input no semantic change bit names can change with anything.
fn change_dependency(dependency: u16) -> u16 {
    if dependency == 0 {
        ALL_SEMANTIC_CHANGES
    } else {
        dependency
    }
}

fn f32_source<'b>(source: InputSource, binding: &'b FontRenderBinding) -> F32Source<'b> {
    let table = match source.scope {
        InputScope::Semantic => {
            return match source.field {
                SEMANTIC_F32_INLINE_START => F32Source::Local(LOCAL_INK_INLINE_START),
                SEMANTIC_F32_BLOCK_START => F32Source::Local(LOCAL_INK_BLOCK_START),
                SEMANTIC_F32_INLINE_EXTENT => F32Source::Local(LOCAL_INK_INLINE_EXTENT),
                SEMANTIC_F32_BLOCK_EXTENT => F32Source::Local(LOCAL_INK_BLOCK_EXTENT),
                SEMANTIC_F32_FONT_SIZE => F32Source::FontSize,
                SEMANTIC_F32_RASTER_PIXEL_RATIO => F32Source::RasterPixelRatio,
                SEMANTIC_F32_INLINE_ORIGIN => F32Source::Local(LOCAL_INLINE_ORIGIN),
                SEMANTIC_F32_BLOCK_ORIGIN => F32Source::Local(LOCAL_BLOCK_ORIGIN),
                SEMANTIC_F32_FOREGROUND_RED => F32Source::ForegroundLinear(0),
                SEMANTIC_F32_FOREGROUND_GREEN => F32Source::ForegroundLinear(8),
                SEMANTIC_F32_FOREGROUND_BLUE => F32Source::ForegroundLinear(16),
                SEMANTIC_F32_FOREGROUND_ALPHA => F32Source::ForegroundAlpha,
                SEMANTIC_F32_INVERSE_FONT_SIZE => F32Source::InverseFontSize,
                SEMANTIC_F32_OUTLINE_WIDTH_EM => F32Source::OutlineWidthEm,
                SEMANTIC_F32_SHADOW_OFFSET_X_EM => F32Source::ShadowOffsetXEm,
                SEMANTIC_F32_SHADOW_OFFSET_Y_EM => F32Source::ShadowOffsetYEm,
                _ => F32Source::Missing,
            };
        }
        InputScope::Glyph => binding
            .glyph_f32()
            .field(source.field)
            .map(F32Source::Glyph),
        InputScope::Strike => binding
            .strike_f32()
            .field(source.field)
            .map(F32Source::Strike),
        InputScope::Resource => binding
            .resource_f32()
            .field(source.field)
            .map(F32Source::Resource),
    };
    table.unwrap_or(F32Source::Missing)
}

fn u32_source<'b>(source: InputSource, binding: &'b FontRenderBinding) -> U32Source<'b> {
    let table = match source.scope {
        InputScope::Semantic => {
            return match source.field {
                SEMANTIC_U32_FOREGROUND_RGBA => U32Source::Foreground,
                SEMANTIC_U32_CLUSTER_ID => U32Source::StableCluster,
                SEMANTIC_U32_REGION_ID => U32Source::RegionId,
                SEMANTIC_U32_FLOW_THREAD_ID => U32Source::FlowThreadId,
                SEMANTIC_U32_TRANSFORM_INDEX => U32Source::TransformIndex,
                SEMANTIC_U32_STABLE_GLYPH_ID => U32Source::StableGlyph,
                SEMANTIC_U32_OUTLINE_RGBA => U32Source::OutlineRgba,
                SEMANTIC_U32_SHADOW_RGBA => U32Source::ShadowRgba,
                SEMANTIC_U32_PLACEMENT_SLOT => U32Source::PlacementSlot,
                _ => U32Source::Missing,
            };
        }
        InputScope::Glyph => binding
            .glyph_u32()
            .field(source.field)
            .map(U32Source::Glyph),
        InputScope::Strike => binding
            .strike_u32()
            .field(source.field)
            .map(U32Source::Strike),
        InputScope::Resource => binding
            .resource_u32()
            .field(source.field)
            .map(U32Source::Resource),
    };
    table.unwrap_or(U32Source::Missing)
}

/// The selected rows of a chunk, in record order. A dense chunk selects every source
/// glyph, so row `i` is glyph `i` and lanes are read in place.
#[derive(Clone, Copy)]
pub(super) struct Rows<'a> {
    rows: &'a [u8],
    dense: bool,
}

impl<'a> Rows<'a> {
    pub(super) fn new(rows: &'a [u8], chunk: &SourceChunk) -> Self {
        Self {
            rows,
            dense: rows.len() == chunk.len,
        }
    }

    pub(super) fn len(self) -> usize {
        self.rows.len()
    }
}

/// Copies one per-glyph lane for the selected rows.
#[inline(never)]
fn copy_lane<T: Copy>(lane: &[T; CHUNK], rows: Rows<'_>, out: &mut [T]) {
    if rows.dense {
        out.copy_from_slice(&lane[..out.len()]);
        return;
    }
    for (out, &row) in out.iter_mut().zip(rows.rows) {
        *out = lane[usize::from(row) & LANE];
    }
}

/// Reads a span or style table through the per-glyph range index. A chunk inside one
/// range is a fill.
#[inline(never)]
fn table_lane<T: Copy>(
    table: &[T; CHUNK],
    table_len: usize,
    ranges: &[u8; CHUNK],
    rows: Rows<'_>,
    out: &mut [T],
) {
    if table_len == 1 {
        out.fill(table[0]);
    } else if rows.dense {
        for (out, &range) in out.iter_mut().zip(ranges) {
            *out = table[usize::from(range) & LANE];
        }
    } else {
        for (out, &row) in out.iter_mut().zip(rows.rows) {
            *out = table[usize::from(ranges[usize::from(row) & LANE]) & LANE];
        }
    }
}

/// Reads a binding table by a per-glyph key. A selected glyph's key is in range by the
/// binding's construction; the fold reports a table that is shorter than that.
#[inline(never)]
fn binding_lane<T: Copy + Default>(
    table: &[T],
    keys: &[u32; CHUNK],
    rows: Rows<'_>,
    out: &mut [T],
) -> bool {
    let mut complete = true;
    let mut read = |out: &mut T, key: u32| {
        let value = table.get(key as usize).copied();
        complete &= value.is_some();
        *out = value.unwrap_or_default();
    };
    if rows.dense {
        for (out, &key) in out.iter_mut().zip(keys) {
            read(out, key);
        }
    } else {
        for (out, &row) in out.iter_mut().zip(rows.rows) {
            read(out, keys[usize::from(row) & LANE]);
        }
    }
    complete
}

fn f32_column(source: F32Source<'_>, chunk: &SourceChunk, rows: Rows<'_>, out: &mut [f32]) -> bool {
    let spans = &chunk.spans;
    let styles = &chunk.styles;
    let span = |table: &[f32; CHUNK], out: &mut [f32]| {
        table_lane(table, spans.len, &chunk.span, rows, out);
    };
    let style = |table: &[f32; CHUNK], out: &mut [f32]| {
        table_lane(table, styles.len, &chunk.style, rows, out);
    };
    match source {
        F32Source::Local(lane) => copy_lane(&chunk.local[lane % LOCAL_LANES], rows, out),
        F32Source::FontSize => span(&spans.font_size, out),
        F32Source::InverseFontSize => {
            span(&spans.font_size, out);
            for value in out.iter_mut() {
                *value = 1.0 / *value;
            }
        }
        F32Source::RasterPixelRatio => style(&styles.raster_pixel_ratio, out),
        F32Source::OutlineWidthEm => style(&styles.outline_width_em, out),
        F32Source::ShadowOffsetXEm => style(&styles.shadow_offset_x_em, out),
        F32Source::ShadowOffsetYEm => style(&styles.shadow_offset_y_em, out),
        F32Source::ForegroundLinear(shift) => {
            let mut linear = [0.0; CHUNK];
            for (linear, packed) in linear.iter_mut().zip(&styles.foreground[..styles.len]) {
                *linear = f32::from_bits(SRGB8_TO_LINEAR_BITS[((packed >> shift) & 0xff) as usize]);
            }
            style(&linear, out);
        }
        F32Source::ForegroundAlpha => {
            let mut alpha = [0.0; CHUNK];
            for (alpha, packed) in alpha.iter_mut().zip(&styles.foreground[..styles.len]) {
                *alpha = (f64::from(packed >> 24) / 255.0) as f32;
            }
            style(&alpha, out);
        }
        F32Source::Glyph(table) => return binding_lane(table, &chunk.glyph_id, rows, out),
        F32Source::Strike(table) => return binding_lane(table, &chunk.strike_row, rows, out),
        F32Source::Resource(table) => return binding_lane(table, &chunk.resource, rows, out),
        F32Source::Missing => return out.is_empty(),
    }
    true
}

fn u32_column(source: U32Source<'_>, chunk: &SourceChunk, rows: Rows<'_>, out: &mut [u32]) -> bool {
    let spans = &chunk.spans;
    let styles = &chunk.styles;
    let span = |table: &[u32; CHUNK], out: &mut [u32]| {
        table_lane(table, spans.len, &chunk.span, rows, out);
    };
    let style = |table: &[u32; CHUNK], out: &mut [u32]| {
        table_lane(table, styles.len, &chunk.style, rows, out);
    };
    match source {
        U32Source::PlacementSlot => span(&spans.placement_slot, out),
        U32Source::Foreground => style(&styles.foreground, out),
        U32Source::StableCluster => copy_lane(&chunk.stable_cluster, rows, out),
        U32Source::RegionId => span(&spans.region_id, out),
        U32Source::FlowThreadId => span(&spans.flow_thread_id, out),
        U32Source::TransformIndex => span(&spans.transform_index, out),
        U32Source::StableGlyph => copy_lane(&chunk.stable_id, rows, out),
        U32Source::OutlineRgba => style(&styles.outline_rgba, out),
        U32Source::ShadowRgba => style(&styles.shadow_rgba, out),
        U32Source::Glyph(table) => return binding_lane(table, &chunk.glyph_id, rows, out),
        U32Source::Strike(table) => return binding_lane(table, &chunk.strike_row, rows, out),
        U32Source::Resource(table) => return binding_lane(table, &chunk.resource, rows, out),
        U32Source::Missing => return out.is_empty(),
    }
    true
}

/// A 32-bit codec scalar compared by its bits, so `-0.0` and `0.0` differ and a NaN
/// equals itself.
pub(super) trait Scalar: Copy {
    fn bits(self) -> u32;
}

impl Scalar for f32 {
    fn bits(self) -> u32 {
        self.to_bits()
    }
}

impl Scalar for u32 {
    fn bits(self) -> u32 {
        self
    }
}

/// Stores `next` over the accepted lane and ORs `dependency` into the mask of every row
/// whose bits changed; returns how many did. The store is unconditional: an equal value
/// rewrites equal bits.
pub(super) fn store_changes<T: Scalar>(
    accepted: &mut [T],
    next: &[T],
    dependency: u16,
    masks: &mut [u16],
) -> usize {
    let mut changed = 0;
    for ((accepted, &next), mask) in accepted.iter_mut().zip(next).zip(masks) {
        let differs = accepted.bits() != next.bits();
        *mask |= if differs { dependency } else { 0 };
        changed += usize::from(differs);
        *accepted = next;
    }
    changed
}
