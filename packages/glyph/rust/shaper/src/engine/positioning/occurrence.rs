//! Walking positioned occurrences: the row, outlined and source cursors and the rows they project.

use super::*;

/// A span may cross clusters only when visual order maps to a contiguous source
/// interval in one direction and every coarse projection/placement fact agrees.
pub(super) fn append_occurrence_span(
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
            crate::engine::work_attribution::record(|work| work.outlined_seek_cluster_probes += 1);
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
            crate::engine::work_attribution::record(|work| work.outlined_cluster_visits += 1);
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
                crate::engine::work_attribution::record(|work| work.outlined_cluster_visits += 1);
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
                crate::engine::work_attribution::record(|work| work.outlined_mark_visits += 1);
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
pub(super) fn project_occurrence_source<'a>(
    positioned: &'a PositionedGlyphArena,
    clusters: &'a ClusterArena,
    boundary: &'a BoundaryShapeArena,
    span: &'a OccurrenceSpan,
    source_glyph: u32,
    owner_cluster: u32,
) -> Result<ProjectedOccurrence<'a>, EngineError> {
    #[cfg(test)]
    crate::engine::work_attribution::record(|work| work.occurrence_projection_rows += 1);
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
        source_glyph,
    })
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
impl PositionedGlyphArena {
    pub(super) fn push_occurrence_span(
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

    pub(super) fn push_occurrence_span_with_counts(
        &mut self,
        span: OccurrenceSpan,
        outlined: u32,
    ) -> Result<(), EngineError> {
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.occurrence_span_append_attempts += 1);
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
    pub(super) fn assert_occurrence_expansion(
        &self,
        clusters: &ClusterArena,
        boundary: &BoundaryShapeArena,
    ) {
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
}
