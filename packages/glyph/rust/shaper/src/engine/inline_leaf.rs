//! Bounded shape facts retained by an inline prepared paragraph.
//!
//! Local placed rows cannot reconstruct HarfRust's integer positions or full glyph flags. An
//! inline owner therefore stores each original shaped glyph exactly once beside its local row.

use alloc::vec::Vec;

use crate::{FontGlyphExtents, FontMetrics, unicode::UnicodeAnalysis};

use super::{
    cluster_state::{
        CLUSTER_ALLOWED_BREAK, CLUSTER_HARD_BREAK, CLUSTER_REQUIRED_BREAK, CLUSTER_SAFE_BEFORE,
        CLUSTER_SPACE, CanonicalCluster, CanonicalClusterView, CanonicalGlyph, IntrinsicWidths,
        LAYOUT_CHUNK, LayoutRun, LayoutRunSourceKind, RunCanonicalInput, RunCanonicalSubject,
        assign_stable_glyph_ids_from_view, canonical_revision_for_run, intrinsic_widths_from_facts,
        prepare_run_revision_index,
    },
    flow_composition::{
        FlowFragment, FlowLine, NO_BOUNDARY, constraint_word_space_shrink, inline_line_extents,
    },
    flow_geometry::{FlowGeometryArena, InlineSlotArena},
    frame::{
        ALIGN_JUSTIFY, AXIS_EXACT, OVERFLOW_ELLIPSIS, SHAPE_RECTANGLE, UpdateLimits,
        WRITING_HORIZONTAL_TB,
    },
    identity_index::IdentityIndex,
    line_composition::{
        ClusterLineFacts, LineCursor, NoCorrections, layout_next_line_integer_facts,
    },
    placement_slot_arena::PlacementHandle,
    placement_state::{
        GlyphSource, LayoutRunOwner, PlacementIdentity, PlacementSegment, PlacementState,
        SegmentTranslation,
    },
    positioning::{
        PositionedSemanticGlyph, ProjectedRowOwner, ProjectedSourceRow, SourceLineFacts,
        fragment_pen_origin, projected_semantic_row, style_has_text_effects,
    },
    run_local::{CompactRun, RunLocalBuildError, RunLocalCompact, RunLocalGlyph, ink_units},
    run_local_kernel::{GlyphUnits, ScaleSpan},
    shaping_state::{ShapeArena, ShapedRun},
    state::EngineError,
    style_state::StyleSegment,
};

/// The accepted paragraph owns exactly one prepared representation. General's existing arenas
/// remain the General payload during migration; `Inline` must leave their glyph lanes empty.
#[derive(Default)]
// The Inline payload is deliberately stored in place and recycled between preparations.
// Boxing it would add an allocation to the small-label setter this owner is meant to serve.
#[allow(clippy::large_enum_variant)]
pub(crate) enum PreparedLayout {
    #[default]
    General,
    Inline(InlineLeaf),
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LeafCluster {
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
    pub binding_handle: u32,
    pub font_handle: u32,
    pub shaped: bool,
    pub unsafe_before: bool,
}

/// One final local semantic row plus the exact outline admission fact. The row is written by
/// RunLocalCompact's block sink, and placement fills its segment index afterward in place.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct InlineRow {
    pub semantic: PositionedSemanticGlyph,
    pub has_outline: bool,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct InlineGlyphMeta {
    pub stable_id: u32,
    pub font_handle: u32,
    pub cluster: u32,
    pub glyph_id: u16,
    pub flags: u16,
    pub bidi_level: u8,
    pub font_size: f32,
}

impl InlineRow {
    pub(crate) fn from_local(meta: InlineGlyphMeta, local: RunLocalGlyph) -> Self {
        Self {
            semantic: PositionedSemanticGlyph {
                stable_id: meta.stable_id,
                font_handle: meta.font_handle,
                cluster: meta.cluster,
                glyph_id: meta.glyph_id,
                flags: meta.flags,
                bidi_level: meta.bidi_level,
                font_size: meta.font_size,
                inline_origin: local.inline_origin,
                block_origin: local.block_origin,
                inline_advance: local.inline_advance,
                ink_inline_start: local.ink_inline_start,
                ink_block_start: local.ink_block_start,
                ink_inline_extent: local.ink_inline_extent,
                ink_block_extent: local.ink_block_extent,
                placement_segment: u32::MAX,
            },
            has_outline: local.has_outline,
        }
    }
}

#[derive(Default)]
pub(crate) struct InlineLeaf {
    pub shape: InlineShape,
    pub clusters: Vec<LeafCluster>,
    /// This is the final row storage, not a RunLocal intermediate copied into another glyph Vec.
    pub rows: RunLocalCompact<InlineRow>,
    /// At most one machine word for the existing 64-glyph admission bound.
    pub outline_mask: u64,
    /// Changed outlined ordinals since renderer publication. A bounded rebuilt leaf owns one
    /// complete interval; General's rope keeps its finer sparse ranges.
    pub unpublished_source_interval: Option<core::ops::Range<usize>>,
    pub line: Option<FlowLine>,
    pub fragment: Option<FlowFragment>,
    pub intrinsics: IntrinsicWidths,
    pub layout_run: Option<LayoutRun>,
    pub inline_extent: f64,
    /// Uses the same placement binding and segment validation owner as General.
    pub placement: PlacementState,
}

impl InlineLeaf {
    pub(crate) fn clear(&mut self) {
        self.shape.clear();
        self.clusters.clear();
        self.rows.clear();
        self.outline_mask = 0;
        self.unpublished_source_interval = None;
        self.line = None;
        self.fragment = None;
        self.intrinsics = IntrinsicWidths::default();
        self.layout_run = None;
        self.inline_extent = 0.0;
        self.placement.clear();
    }

    pub(crate) fn semantic_count(&self) -> usize {
        self.shape.glyphs().len()
    }

    pub(crate) fn outlined_count(&self) -> usize {
        self.outline_mask.count_ones() as usize
    }

    pub(crate) fn outlined_sources(&self) -> InlineOutlinedCursor {
        InlineOutlinedCursor {
            remaining: self.outline_mask,
        }
    }

    pub(crate) fn refresh_outline_mask(&mut self) -> Result<(), EngineError> {
        let mut mask = 0u64;
        for (index, row) in self.rows.source_rows().iter().enumerate() {
            let row = row.ok_or(EngineError::InvalidRequest)?;
            if row.has_outline {
                mask |= 1u64
                    .checked_shl(u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?)
                    .ok_or(EngineError::InvalidRequest)?;
            }
        }
        if self.rows.source_rows().len() != self.shape.glyphs().len() {
            return Err(EngineError::InvalidRequest);
        }
        self.outline_mask = mask;
        self.unpublished_source_interval = Some(0..mask.count_ones() as usize);
        Ok(())
    }

    pub(crate) fn unpublished_source_intervals(&self) -> Option<&[core::ops::Range<usize>]> {
        self.unpublished_source_interval
            .as_ref()
            .map(core::slice::from_ref)
    }

    pub(crate) fn mark_published(&mut self) {
        self.unpublished_source_interval = None;
    }

    pub(crate) fn row(&self, source: u32) -> Option<InlineRow> {
        self.rows.row_for_source_glyph(source).copied()
    }

    pub(crate) fn placement_translations(&self) -> &[SegmentTranslation] {
        self.placement.translations()
    }

    pub(crate) fn placement_handle(&self, segment_index: usize) -> Option<PlacementHandle> {
        self.placement.placement_handle(segment_index)
    }

    pub(crate) fn projected_source_row<'a>(
        &self,
        source: u32,
        semantic_index: u32,
        slot: u32,
        styles: &'a [StyleSegment],
    ) -> Result<ProjectedSourceRow<'a>, EngineError> {
        let row = self
            .row(source)
            .ok_or(EngineError::InvalidRequest)?
            .semantic;
        let index = self
            .clusters
            .partition_point(|cluster| cluster.glyph_start + cluster.glyph_count <= source);
        let cluster = self
            .clusters
            .get(index)
            .filter(|cluster| source >= cluster.glyph_start)
            .ok_or(EngineError::InvalidRequest)?;
        let style = &styles
            .get(cluster.style_index as usize)
            .ok_or(EngineError::InvalidRequest)?
            .style;
        let line = self.line.ok_or(EngineError::InvalidRequest)?;
        Ok(projected_semantic_row(
            row,
            semantic_index,
            slot,
            ProjectedRowOwner {
                binding_handle: cluster.binding_handle,
                style,
                line_facts: SourceLineFacts::from(line),
                stable_cluster: cluster.stable_text_id,
                text_effects: style_has_text_effects(*style),
            },
        ))
    }

    /// Builds the single-run cluster facts straight from the captured shape. The raw glyphs
    /// remain in their source order; a source order that would require the General scatter is
    /// ineligible and can be transferred to General from `InlineShape` without reshaping.
    pub(crate) fn build_clusters(
        &mut self,
        text: &[u16],
        text_unit_ids: &[u32],
        unicode: &UnicodeAnalysis,
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<bool, EngineError> {
        let Some(run) = self.shape.run() else {
            return Ok(false);
        };
        if run.source_run != 0
            || run.text_start != 0
            || usize::try_from(run.text_end).ok() != Some(text.len())
            || text.len() != text_unit_ids.len()
            || text_unit_ids.contains(&0)
            || self.shape.glyphs().len() > LAYOUT_CHUNK
            || self
                .shape
                .glyphs()
                .windows(2)
                .any(|pair| pair[0].cluster > pair[1].cluster)
        {
            return Ok(false);
        }
        let boundaries = unicode.grapheme_boundaries();
        if boundaries.len().saturating_sub(1) > LAYOUT_CHUNK {
            return Ok(false);
        }
        self.clusters.clear();
        self.clusters
            .try_reserve(boundaries.len().saturating_sub(1))
            .map_err(|_| EngineError::ResultTooLarge)?;
        let metrics = metrics_for(run.font_handle)
            .ok_or(EngineError::FontMetricsMissing(super::FrameFault::default()))?;
        if metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let upem = f64::from(metrics.units_per_em);
        let mut style_index = 0usize;
        for pair in boundaries.windows(2) {
            let (start, end) = (pair[0], pair[1]);
            while styles
                .get(style_index)
                .is_some_and(|style| style.text_end <= start)
            {
                style_index += 1;
            }
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            if style.text_start > start || style.text_end < end {
                return Err(EngineError::StyleSplitsCluster(super::FrameFault::default()));
            }
            let offset = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
            let unit = *text.get(offset).ok_or(EngineError::InvalidRequest)?;
            let hard_break = matches!(unit, 0x0a | 0x0b | 0x0c | 0x0d | 0x85 | 0x2028 | 0x2029);
            // The bounded leaf is a single visible line. General owns required and hard breaks.
            if hard_break {
                return Ok(false);
            }
            let space = unit == 0x20;
            let word_spacing = if space { style.style.word_spacing } else { 0.0 };
            self.clusters.push(LeafCluster {
                text_start: start,
                text_end: end,
                stable_text_id: *text_unit_ids
                    .get(offset)
                    .ok_or(EngineError::InvalidRequest)?,
                glyph_start: 0,
                glyph_count: 0,
                advance: f64::from(style.style.letter_spacing + word_spacing),
                advance_units: 0,
                units_per_em: upem,
                flags: if space { CLUSTER_SPACE } else { 0 },
                style_index: u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?,
                source_run: 0,
                binding_handle: run.binding_handle,
                font_handle: run.font_handle,
                shaped: false,
                unsafe_before: false,
            });
        }
        let mut last_cluster = 0usize;
        for raw in self.shape.glyphs() {
            let index = self
                .clusters
                .partition_point(|cluster| cluster.text_end <= raw.cluster);
            let cluster = self
                .clusters
                .get_mut(index)
                .ok_or(EngineError::InvalidRequest)?;
            if raw.cluster < cluster.text_start
                || raw.cluster >= cluster.text_end
                || index < last_cluster
            {
                return Ok(false);
            }
            last_cluster = index;
            let style = styles
                .get(cluster.style_index as usize)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            cluster.glyph_count = cluster
                .glyph_count
                .checked_add(1)
                .ok_or(EngineError::ResultTooLarge)?;
            cluster.shaped = true;
            cluster.unsafe_before |=
                raw.flags & super::shaping_state::GLYPH_FLAG_UNSAFE_TO_BREAK != 0;
            cluster.advance +=
                f64::from(raw.x_advance.unsigned_abs()) * (f64::from(style.font_size) / upem);
        }
        let mut glyph_start = 0u32;
        for cluster in &mut self.clusters {
            cluster.glyph_start = glyph_start;
            glyph_start = glyph_start
                .checked_add(cluster.glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            if cluster.shaped && !cluster.unsafe_before {
                cluster.flags |= CLUSTER_SAFE_BEFORE;
            }
            cluster.advance_units = super::layout_units::layout_units_from_scaled(cluster.advance);
        }
        if usize::try_from(glyph_start).ok() != Some(self.shape.glyphs().len()) {
            return Err(EngineError::InvalidRequest);
        }
        // A glyphless trailing grapheme needs General's detached-cluster placement path.
        if self.clusters.iter().any(|cluster| cluster.glyph_count == 0) {
            return Ok(false);
        }
        for line_break in unicode.line_breaks() {
            let index = self
                .clusters
                .partition_point(|cluster| cluster.text_end < line_break.position);
            let Some(cluster) = self.clusters.get(index) else {
                continue;
            };
            if cluster.text_end != line_break.position && !line_break.required {
                continue;
            }
            if line_break.required {
                // Unicode emits a required EOT break for every nonempty paragraph. General
                // retains that flag on the last cluster; only an interior required break
                // requires its multi-line path.
                if line_break.position != text.len() as u32 {
                    return Ok(false);
                }
                self.clusters[index].flags |= CLUSTER_REQUIRED_BREAK;
                continue;
            }
            let safe = self
                .clusters
                .get(index + 1)
                .is_none_or(|next| next.flags & CLUSTER_SAFE_BEFORE != 0);
            // Unsafe soft breaks need island reshaping; transfer the captured source shape.
            if !safe {
                return Ok(false);
            }
            self.clusters[index].flags |= CLUSTER_ALLOWED_BREAK;
        }
        self.layout_run = Some(LayoutRun {
            source_kind: LayoutRunSourceKind::Paragraph,
            cluster_start: 0,
            cluster_end: u32::try_from(self.clusters.len())
                .map_err(|_| EngineError::ResultTooLarge)?,
            glyph_start: 0,
            glyph_count: glyph_start,
            source_run: 0,
            font_handle: run.font_handle,
            numeric_blocks: Default::default(),
            canonical_revision: None,
        });
        Ok(true)
    }

    /// Mirrors General's stable cluster-ID plus ordinal rule without a General glyph lane.
    /// The returned bounded IDs feed the final-row mapper directly at numeric block closure.
    pub(crate) fn assign_glyph_ids(
        &self,
        previous: &dyn CanonicalClusterView,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<[u32; LAYOUT_CHUNK], EngineError> {
        let mut ids = [0; LAYOUT_CHUNK];
        assign_stable_glyph_ids_from_view(
            previous,
            self.clusters.len(),
            |cluster| {
                self.clusters.get(cluster).map(|cluster| {
                    (
                        cluster.stable_text_id,
                        cluster.glyph_start,
                        cluster.glyph_count,
                    )
                })
            },
            &mut ids,
            index,
            next_id,
        )?;
        Ok(ids)
    }

    /// Writes exact local numeric values straight into final semantic row slots. The leaf's
    /// glyphs and clusters become the run-local kernel's lanes on the stack; the kernel alone
    /// owns the midpoint and rounding arithmetic.
    pub(crate) fn build_numeric_rows(
        &mut self,
        ids: &[u32; LAYOUT_CHUNK],
        styles: &[StyleSegment],
        bidi_level: u8,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        let raw = self.shape.glyphs();
        if raw.len() > LAYOUT_CHUNK || self.clusters.len() > LAYOUT_CHUNK {
            return Err(EngineError::InvalidRequest);
        }
        let mut metadata = [InlineGlyphMeta::default(); LAYOUT_CHUNK];
        let mut inline_advance = [0_i32; LAYOUT_CHUNK];
        let mut inline_offset = [0_i32; LAYOUT_CHUNK];
        let mut block_offset = [0_i32; LAYOUT_CHUNK];
        let mut ink = [[0_i16; 4]; LAYOUT_CHUNK];
        let mut outlined = 0_u64;
        let mut glyph_starts = [0_u32; LAYOUT_CHUNK];
        let mut glyph_counts = [0_u32; LAYOUT_CHUNK];
        let mut advances = [0.0_f64; LAYOUT_CHUNK];
        let mut spans = [ScaleSpan {
            glyph_end: 0,
            scale: 0.0,
            baseline_shift: 0.0,
        }; LAYOUT_CHUNK];
        let mut span_count = 0;
        for (index, cluster) in self.clusters.iter().enumerate() {
            let style = styles
                .get(cluster.style_index as usize)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            let glyph_end = cluster.glyph_start + cluster.glyph_count;
            glyph_starts[index] = cluster.glyph_start;
            glyph_counts[index] = cluster.glyph_count;
            advances[index] = cluster.advance;
            let span = ScaleSpan {
                glyph_end,
                scale: f64::from(style.font_size) / cluster.units_per_em,
                baseline_shift: f64::from(style.baseline_shift),
            };
            match spans[..span_count].last_mut() {
                Some(last)
                    if last.scale.to_bits() == span.scale.to_bits()
                        && last.baseline_shift.to_bits() == span.baseline_shift.to_bits() =>
                {
                    last.glyph_end = glyph_end;
                }
                _ => {
                    spans[span_count] = span;
                    span_count += 1;
                }
            }
            for source in cluster.glyph_start..glyph_end {
                let index = source as usize;
                let glyph = *raw.get(index).ok_or(EngineError::InvalidRequest)?;
                metadata[index] = InlineGlyphMeta {
                    stable_id: ids[index],
                    font_handle: cluster.font_handle,
                    cluster: glyph.cluster,
                    glyph_id: glyph.glyph_id,
                    flags: glyph.flags,
                    bidi_level,
                    font_size: style.font_size,
                };
                inline_advance[index] = glyph.x_advance;
                inline_offset[index] = glyph.x_offset;
                block_offset[index] = glyph.y_offset;
                if let Some(extents) = extents_for(cluster.font_handle, u32::from(glyph.glyph_id)) {
                    ink[index] = ink_units(extents).map_err(run_local_error)?;
                    outlined |= 1 << index;
                }
            }
        }
        let clusters = self.clusters.len();
        self.rows.clear();
        let span = self
            .rows
            .layout(
                CompactRun {
                    units: GlyphUnits {
                        inline_advance: &inline_advance[..raw.len()],
                        inline_offset: &inline_offset[..raw.len()],
                        block_offset: &block_offset[..raw.len()],
                        ink: &ink[..raw.len()],
                    },
                    outlined,
                    spans: &spans[..span_count],
                    glyph_starts: &glyph_starts[..clusters],
                    glyph_counts: &glyph_counts[..clusters],
                    advances: &advances[..clusters],
                },
                |source, local| InlineRow::from_local(metadata[source as usize], local),
            )
            .map_err(run_local_error)?;
        self.layout_run
            .as_mut()
            .ok_or(EngineError::InvalidRequest)?
            .numeric_blocks = span;
        self.refresh_outline_mask()?;
        Ok(())
    }

    /// The leaf carries the same revision token as an equivalent General layout run. The
    /// comparison uses the shared canonical view and the final numeric rows' stable glyph IDs.
    pub(crate) fn finalize_revision(
        &mut self,
        previous: &dyn CanonicalClusterView,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        prepare_run_revision_index(previous, index)?;
        let run = self.layout_run.ok_or(EngineError::InvalidRequest)?;
        let revision = canonical_revision_for_run(
            RunCanonicalSubject {
                view: self,
                run,
                input: current,
            },
            previous,
            committed,
            index,
            next_revision,
            None,
        )?;
        self.layout_run
            .as_mut()
            .ok_or(EngineError::InvalidRequest)?
            .canonical_revision = Some(revision);
        Ok(())
    }

    /// Admit only an ordinary complete one-slot line. General remains authoritative for
    /// clipping, ellipsis, exclusions, flexible sizing, decoration, and multiple styles.
    /// The same slot resolver and integer fitter produce this line's exact layout facts.
    pub(crate) fn build_one_line_flow(
        &mut self,
        geometry: &FlowGeometryArena,
        styles: &[StyleSegment],
        slots: &mut InlineSlotArena,
        limits: UpdateLimits,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        first_font_for_stack: impl Fn(u32) -> Option<u32>,
    ) -> Result<bool, EngineError> {
        let (Some(constraint), Some(region)) =
            (geometry.constraints.first(), geometry.regions.first())
        else {
            return Ok(false);
        };
        if geometry.constraints.len() != 1
            || geometry.regions.len() != 1
            || !geometry.exclusions.is_empty()
            || styles.len() != 1
            || self.clusters.is_empty()
            || limits.max_lines == 0
            || limits.max_slots_per_band == 0
            || constraint.region_start != 0
            || constraint.region_count != 1
            || constraint.resume_region != 0
            || constraint.resume_cluster != 0
            || constraint.width_mode != AXIS_EXACT
            || constraint.drop_cap_lines != 0
            || matches!(
                constraint.overflow,
                super::frame::OVERFLOW_CLIP | OVERFLOW_ELLIPSIS
            )
            || constraint.align == ALIGN_JUSTIFY
            || region.record.shape != SHAPE_RECTANGLE
            || region.record.writing_mode != WRITING_HORIZONTAL_TB
            || styles[0].style.decoration_flags != 0
            || self.clusters.iter().enumerate().any(|(index, cluster)| {
                cluster.flags & CLUSTER_HARD_BREAK != 0
                    || (index + 1 != self.clusters.len()
                        && cluster.flags & CLUSTER_REQUIRED_BREAK != 0)
            })
        {
            return Ok(false);
        }
        let extents = inline_line_extents(styles[0].style, metrics_for, first_font_for_stack)?;
        let block = f64::from(region.record.block_start)
            + f64::from(constraint.resume_block_offset)
            + f64::from(constraint.space_before);
        if block.partial_cmp(&f64::from(region.record.block_end)) != Some(core::cmp::Ordering::Less)
            || block + extents.height() > f64::from(region.record.block_end)
        {
            return Ok(false);
        }
        let available = slots.resolve_band_with_cut(
            geometry,
            0,
            block,
            block + extents.height(),
            limits.max_slots_per_band as usize,
            None,
        )?;
        if available.len() != 1 {
            return Ok(false);
        }
        let slot = available[0];
        let scratch =
            LeafLineScratch::from_clusters(&self.clusters).ok_or(EngineError::InvalidRequest)?;
        let mut cursor = LineCursor::at_cluster(0);
        let width_units = super::layout_units::layout_units_from_scaled(
            (slot.end - slot.start - f64::from(constraint.first_line_indent)).max(0.0),
        );
        let Some(composed) = layout_next_line_integer_facts(
            &scratch.facts(),
            &mut cursor,
            Some(width_units),
            constraint.wrap,
            constraint_word_space_shrink(constraint),
            &mut NoCorrections,
        )?
        else {
            return Ok(false);
        };
        if !cursor.is_complete(self.clusters.len())
            || composed.hard_break
            || super::layout_units::layout_units_from_scaled(composed.advance) > width_units
        {
            return Ok(false);
        }
        let line = FlowLine {
            flow_thread_id: constraint.flow_thread_id,
            region_id: region.record.id,
            transform_index: region.record.transform_index,
            clip_id: 0,
            fragment_count: 1,
            align: constraint.align,
            block_start: block,
            baseline: extents.above,
            height: extents.height(),
            typography: extents.typography,
        };
        self.intrinsics =
            intrinsic_widths_from_facts(self.clusters.len(), constraint.wrap, |index| {
                let cluster = self.clusters[index];
                (cluster.advance, cluster.flags)
            });
        self.line = Some(line);
        self.fragment = Some(FlowFragment {
            line: composed,
            slot_start: slot.start,
            slot_end: slot.end,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
            lead_index: NO_BOUNDARY,
            tail_index: NO_BOUNDARY,
        });
        self.inline_extent = f64::from(constraint.first_line_indent) + composed.advance;
        Ok(true)
    }

    /// The simple LTR/no-justification line uses the same placement translation formula and
    /// PlacementState segment validation as General. Word anchors, numeric blocks, and the
    /// terminating hung-space run all bound segments independently.
    pub(crate) fn build_one_line_placement(
        &mut self,
        geometry: &FlowGeometryArena,
    ) -> Result<(), EngineError> {
        let line = self.line.ok_or(EngineError::InvalidRequest)?;
        let fragment = self.fragment.ok_or(EngineError::InvalidRequest)?;
        let constraint = geometry
            .constraints
            .first()
            .ok_or(EngineError::InvalidRequest)?;
        let run = self.layout_run.ok_or(EngineError::InvalidRequest)?;
        let indent = f64::from(constraint.first_line_indent);
        let mut cursor = fragment_pen_origin(line, fragment, indent, 0, false, false);
        let baseline = line.block_start + line.baseline;
        self.placement.clear();
        self.placement.prepare_run_resolution(&[run], &[])?;
        let line_start = self.placement.begin_line();
        let dense_words = self.clusters.len() == LAYOUT_CHUNK
            && self
                .clusters
                .iter()
                .filter(|cluster| {
                    cluster.flags
                        & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK)
                        != 0
                })
                .count()
                .saturating_mul(2)
                >= self.clusters.len();
        let mut hanging_start = self.clusters.len();
        if fragment.line.hung_advance != 0.0 {
            let mut units = 0_i64;
            while hanging_start > 0 && self.clusters[hanging_start - 1].flags & CLUSTER_SPACE != 0 {
                hanging_start -= 1;
                units = units
                    .checked_add(self.clusters[hanging_start].advance_units)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
            if super::layout_units::scaled_from_layout_units(units).to_bits()
                != fragment.line.hung_advance.to_bits()
            {
                return Err(EngineError::InvalidRequest);
            }
        }
        let run_anchor = self.clusters[0].stable_text_id;
        let mut word_anchor = run_anchor;
        let mut cluster_index = 0usize;
        while cluster_index < self.clusters.len() {
            let block_index = *self
                .rows
                .cluster_blocks()
                .get(cluster_index)
                .filter(|index| **index != u32::MAX)
                .ok_or(EngineError::InvalidRequest)?;
            let block = *self
                .rows
                .blocks()
                .get(block_index as usize)
                .ok_or(EngineError::InvalidRequest)?;
            let start = cluster_index;
            let source_start = self.clusters[start].glyph_start;
            let local_prefix = *self
                .rows
                .cluster_prefixes()
                .get(start)
                .ok_or(EngineError::InvalidRequest)?;
            let segment_anchor = if dense_words { run_anchor } else { word_anchor };
            // General's monotone segment scan stops when the next cluster changes word root
            // or numeric block. Its hanging-start check makes the final spaces a separate
            // segment even when their word root remains the same.
            loop {
                let cluster = self.clusters[cluster_index];
                cluster_index += 1;
                if !dense_words
                    && cluster.flags
                        & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK)
                        != 0
                    && cluster_index < self.clusters.len()
                {
                    word_anchor = self.clusters[cluster_index].stable_text_id;
                }
                if cluster_index >= self.clusters.len()
                    || self.rows.cluster_blocks().get(cluster_index) != Some(&block_index)
                    || (!dense_words && word_anchor != segment_anchor)
                    || (start < hanging_start && cluster_index == hanging_start)
                {
                    break;
                }
            }
            let last = self.clusters[cluster_index - 1];
            let source_end = last
                .glyph_start
                .checked_add(last.glyph_count)
                .ok_or(EngineError::ResultTooLarge)?;
            let count = source_end
                .checked_sub(source_start)
                .ok_or(EngineError::InvalidRequest)?;
            let translation = SegmentTranslation {
                translation_inline: cursor - local_prefix + block.anchor_inline,
                translation_block: baseline + block.anchor_block,
            };
            let segment = self.placement.push_segment(
                PlacementSegment {
                    fragment_index: 0,
                    layout_run_owner: LayoutRunOwner::Paragraph,
                    layout_run_index: 0,
                    placement_handle: None,
                    canonical_revision: run.canonical_revision,
                    identity: if dense_words {
                        PlacementIdentity::Dense
                    } else {
                        PlacementIdentity::StableSource
                    },
                    segment_anchor,
                    source_anchor: self.clusters[start].stable_text_id,
                    numeric_block_ordinal: block_index
                        .checked_sub(run.numeric_blocks.start)
                        .ok_or(EngineError::InvalidRequest)?,
                    run_cluster_start: u32::try_from(start)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    run_cluster_count: u32::try_from(cluster_index - start)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    glyph_source: GlyphSource::LayoutRun,
                    source_glyph_start: source_start,
                    source_glyph_count: count,
                },
                translation,
            )?;
            let outlined = (source_start..source_end)
                .filter(|source| self.outline_mask & (1u64 << source) != 0)
                .count();
            self.placement.push_segment_instances(
                segment,
                u32::try_from(outlined).map_err(|_| EngineError::ResultTooLarge)?,
            )?;
            for source in source_start..source_end {
                self.rows
                    .row_for_source_glyph_mut(source)
                    .ok_or(EngineError::InvalidRequest)?
                    .semantic
                    .placement_segment = segment;
            }
            for cluster in &self.clusters[start..cluster_index] {
                cursor += cluster.advance;
            }
        }
        self.placement.finish_line(line_start)?;
        Ok(())
    }
}

fn run_local_error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
    }
}

pub(crate) struct InlineOutlinedCursor {
    remaining: u64,
}

impl Iterator for InlineOutlinedCursor {
    type Item = u32;

    fn next(&mut self) -> Option<Self::Item> {
        (self.remaining != 0).then(|| {
            let source = self.remaining.trailing_zeros();
            self.remaining &= self.remaining - 1;
            source
        })
    }
}

impl CanonicalClusterView for InlineLeaf {
    fn cluster_count(&self) -> usize {
        self.clusters.len()
    }

    fn cluster(&self, index: usize) -> Option<CanonicalCluster> {
        let cluster = *self.clusters.get(index)?;
        Some(CanonicalCluster {
            text_start: cluster.text_start,
            text_end: cluster.text_end,
            stable_text_id: cluster.stable_text_id,
            glyph_start: cluster.glyph_start,
            glyph_count: cluster.glyph_count,
            advance: cluster.advance,
            advance_units: cluster.advance_units,
            units_per_em: cluster.units_per_em,
            flags: cluster.flags,
            style_index: cluster.style_index,
            source_run: cluster.source_run,
            font_handle: cluster.font_handle,
            shaped: u8::from(cluster.shaped),
            unsafe_before: u8::from(cluster.unsafe_before),
        })
    }

    fn glyph(&self, index: usize) -> Option<CanonicalGlyph> {
        let raw = *self.shape.glyphs().get(index)?;
        let semantic = self
            .rows
            .row_for_source_glyph(u32::try_from(index).ok()?)?
            .semantic;
        Some(CanonicalGlyph {
            stable_id: semantic.stable_id,
            glyph_id: raw.glyph_id,
            x_advance: raw.x_advance,
            x_offset: raw.x_offset,
            y_offset: raw.y_offset,
            flags: raw.flags,
        })
    }

    fn layout_run_count(&self) -> usize {
        usize::from(self.layout_run.is_some())
    }

    fn layout_run(&self, index: usize) -> Option<LayoutRun> {
        (index == 0).then_some(self.layout_run).flatten()
    }
}

/// Bounded borrowed lanes for the *same* integer fitter used by General. The leaf retains its
/// cluster facts once in `LeafCluster`; this stack scratch supplies slices without allocating a
/// General ClusterArena or a second persistent SoA. Empty optional indexes select the fitter's
/// exact scalar route, including for a full 64-cluster leaf.
pub(crate) struct LeafLineScratch {
    len: usize,
    starts: [u32; LAYOUT_CHUNK],
    ends: [u32; LAYOUT_CHUNK],
    advance_units: [i64; LAYOUT_CHUNK],
    flags: [u8; LAYOUT_CHUNK],
}

impl LeafLineScratch {
    pub(crate) fn from_clusters(clusters: &[LeafCluster]) -> Option<Self> {
        if clusters.len() > LAYOUT_CHUNK {
            return None;
        }
        let mut scratch = Self {
            len: clusters.len(),
            starts: [0; LAYOUT_CHUNK],
            ends: [0; LAYOUT_CHUNK],
            advance_units: [0; LAYOUT_CHUNK],
            flags: [0; LAYOUT_CHUNK],
        };
        for (index, cluster) in clusters.iter().enumerate() {
            scratch.starts[index] = cluster.text_start;
            scratch.ends[index] = cluster.text_end;
            scratch.advance_units[index] = cluster.advance_units;
            scratch.flags[index] = cluster.flags;
        }
        Some(scratch)
    }

    pub(crate) fn facts(&self) -> ClusterLineFacts<'_> {
        ClusterLineFacts {
            starts: &self.starts[..self.len],
            ends: &self.ends[..self.len],
            advance_units: &self.advance_units[..self.len],
            flags: &self.flags[..self.len],
            chunk_advance_sums: &[],
            chunk_auxiliary_sums: &[],
            chunk_flags_or: &[],
            word_breaks: &[],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RawShapedGlyph {
    pub glyph_id: u16,
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub flags: u16,
}

/// One complete source run. The shaping result is captured while `GlyphBuffer` is borrowed;
/// an ineligible candidate can subsequently transfer these facts to General without reshaping.
#[derive(Default)]
pub(crate) struct InlineShape {
    run: Option<ShapedRun>,
    glyphs: Vec<RawShapedGlyph>,
}

impl InlineShape {
    pub(crate) fn clear(&mut self) {
        self.run = None;
        self.glyphs.clear();
    }

    /// Retains the candidate's recycled allocation while copying the complete shaped carrier.
    /// A width-only Inline update can rebuild numeric and flow facts without HarfRust.
    pub(crate) fn copy_from(&mut self, other: &Self) -> Result<(), EngineError> {
        self.glyphs.clear();
        self.glyphs
            .try_reserve(other.glyphs.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.glyphs.extend_from_slice(&other.glyphs);
        self.run = other.run;
        Ok(())
    }

    /// Captures into a recycled candidate. A retained leaf's pending carrier keeps its capacity
    /// across edits, so the bounded raw facts do not allocate a fresh vector every setter.
    pub(crate) fn capture_into(
        &mut self,
        source_run: u32,
        binding_handle: u32,
        font_handle: u32,
        text_start: u32,
        text_end: u32,
        shaped: &harfrust::GlyphBuffer,
    ) -> Result<bool, u32> {
        self.clear();
        if shaped.len() > LAYOUT_CHUNK {
            return Ok(false);
        }
        let glyph_count =
            u32::try_from(shaped.len()).map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?;
        self.glyphs
            .try_reserve_exact(shaped.len())
            .map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?;
        for (info, position) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            self.glyphs.push(RawShapedGlyph {
                glyph_id: u16::try_from(info.glyph_id)
                    .map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?,
                cluster: info.cluster,
                x_advance: position.x_advance,
                y_advance: position.y_advance,
                x_offset: position.x_offset,
                y_offset: position.y_offset,
                flags: u16::try_from(info.flags().to_bits())
                    .map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?,
            });
        }
        self.run = Some(ShapedRun {
            source_run,
            binding_handle,
            font_handle,
            text_start,
            text_end,
            glyph_start: 0,
            glyph_count,
        });
        Ok(true)
    }

    pub(crate) fn run(&self) -> Option<ShapedRun> {
        self.run
    }

    pub(crate) fn glyphs(&self) -> &[RawShapedGlyph] {
        &self.glyphs
    }

    /// Reconstructs the ordinary shape stage for a leaf-to-General transition. The caller must
    /// also stage the matching FallbackSpan and mark the shape stage prepared before clusters.
    pub(crate) fn materialize_general(&self, target: &mut ShapeArena) -> Result<(), EngineError> {
        let run = self.run.ok_or(EngineError::InvalidRequest)?;
        if run.glyph_start != 0 || usize::try_from(run.glyph_count).ok() != Some(self.glyphs.len())
        {
            return Err(EngineError::InvalidRequest);
        }
        target.clear();
        target.reserve(self.glyphs.len().max(1))?;
        target.runs.push(run);
        for glyph in &self.glyphs {
            target.glyph_ids.push(glyph.glyph_id);
            target.clusters.push(glyph.cluster);
            target.x_advances.push(glyph.x_advance);
            target.y_advances.push(glyph.y_advance);
            target.x_offsets.push(glyph.x_offset);
            target.y_offsets.push(glyph.y_offset);
            target.glyph_flags.push(glyph.flags);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialization_preserves_every_original_shape_column() {
        let run = ShapedRun {
            source_run: 0,
            binding_handle: 41,
            font_handle: 17,
            text_start: 2,
            text_end: 4,
            glyph_start: 0,
            glyph_count: 2,
        };
        let source = InlineShape {
            run: Some(run),
            glyphs: alloc::vec![
                RawShapedGlyph {
                    glyph_id: 12,
                    cluster: 2,
                    x_advance: 501,
                    y_advance: -7,
                    x_offset: -3,
                    y_offset: 9,
                    flags: 1,
                },
                RawShapedGlyph {
                    glyph_id: 13,
                    cluster: 3,
                    x_advance: -201,
                    y_advance: 4,
                    x_offset: 5,
                    y_offset: -11,
                    flags: 2,
                },
            ],
        };
        let mut general = ShapeArena::default();
        source.materialize_general(&mut general).unwrap();
        assert_eq!(general.runs, [run]);
        assert_eq!(general.glyph_ids, [12, 13]);
        assert_eq!(general.clusters, [2, 3]);
        assert_eq!(general.x_advances, [501, -201]);
        assert_eq!(general.y_advances, [-7, 4]);
        assert_eq!(general.x_offsets, [-3, 5]);
        assert_eq!(general.y_offsets, [9, -11]);
        assert_eq!(general.glyph_flags, [1, 2]);
    }
}
