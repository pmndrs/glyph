//! Appending fresh rows: from layout sources, as columns or flat rows, and decorations.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl CodecGatherWorkspace {
    #[cfg(test)]
    pub fn append_from<'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        source_start: usize,
        binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        self.append_from_source(
            codec,
            capability_set,
            input.into(),
            source_start,
            binding_for_font,
        )
    }

    pub(crate) fn append_from_source<'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: GatherInput<'_>,
        source_start: usize,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<(), GatherError> {
        let remaining = input.len().saturating_sub(source_start);
        if source_start > input.len() {
            return Err(GatherError::InvalidSemanticShape);
        }
        self.changed_inputs = ChangedInputs::ALL;
        self.reserve_mask_ranges(
            input.masks(),
            source_start,
            input.len(),
            ALL_SEMANTIC_CHANGES,
        )?;
        let required = self.glyphs.len().saturating_add(remaining);
        if self.glyphs.capacity() < required
            || self.placement_slots.capacity() < required
            || self.semantic_change_masks.capacity() < required
            || self
                .f32_fields
                .iter()
                .any(|field| field.capacity() < required)
            || self
                .u32_fields
                .iter()
                .any(|field| field.capacity() < required)
        {
            return Err(GatherError::AllocationFailed);
        }
        match (input, RowSource::new(input)) {
            #[cfg(test)]
            (GatherInput::Flat(input), _) => {
                self.append_flat_rows(
                    codec,
                    capability_set,
                    input,
                    source_start,
                    &mut binding_for_font,
                )?;
            }
            (_, Some(mut rows)) => {
                let mut scratch = self.take_column_scratch()?;
                let result = self.append_column_rows(
                    codec,
                    capability_set,
                    input,
                    &mut rows,
                    source_start,
                    &mut binding_for_font,
                    &mut scratch,
                );
                self.column_scratch = scratch;
                result?;
            }
            (_, None) => return Err(GatherError::InvalidSemanticShape),
        }
        self.retained_cursor = self.glyphs.len();
        self.retained_source_cursor = self.sources.len();
        Ok(())
    }

    /// Write-only gather of a prepared owner: no accepted row exists to compare with, so
    /// every declared input is written as one column per chunk.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn append_column_rows<'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: GatherInput<'_>,
        rows: &mut RowSource<'_>,
        source_start: usize,
        binding_for_font: &mut BindingLookup<'_, 'binding>,
        scratch: &mut [ColumnScratch],
    ) -> Result<(), GatherError> {
        let scratch = scratch.first_mut().ok_or(GatherError::AllocationFailed)?;
        // A root gather mints one revision per record; an independent copy has no history.
        let minted = matches!(input, GatherInput::Projected(projected) if projected.selection.is_none())
            || matches!(input, GatherInput::Inline(inline) if inline.selection.is_none());
        let transform_id = input.transform_id();
        let source_count = input.len();
        let mut bound = None;
        let mut cursor = source_start;
        while cursor < source_count {
            rows.fill(
                &mut scratch.chunk,
                cursor,
                source_count - cursor,
                Lanes::All,
            )?;
            let chunk = &mut scratch.chunk;
            let len = chunk.len;
            if len == 0 {
                return Err(GatherError::SourceFieldMissing);
            }
            let bound = ColumnBinding::resolve(&mut bound, chunk.binding_handle, binding_for_font)?;
            chunk.select(bound.binding);
            let mut count = 0;
            for index in 0..len {
                scratch.sources[index % CHUNK] = GatherSource {
                    stable_id: chunk.stable_id[index % CHUNK],
                    selection: chunk.selection[index % CHUNK],
                    paragraph_run: chunk.paragraph_run(index),
                };
                scratch.rows[count % CHUNK] = index as u8;
                count += usize::from(chunk.selected(index));
            }
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_glyph_visits += len;
                work.fresh_recordless_rows += len - count;
                work.fresh_selected_rows += count;
            });
            if count != 0 {
                let plan = bound.plan(codec, capability_set)?;
                self.append_columns(plan, chunk, Rows::new(&scratch.rows[..count], chunk))?;
                for &row in &scratch.rows[..count] {
                    let revision = if minted {
                        self.mint_projected_revision()?
                    } else {
                        1
                    };
                    self.glyphs.push(chunk.plan_glyph(
                        usize::from(row),
                        bound.binding,
                        transform_id,
                        revision,
                    )?);
                }
                let records = self.glyphs.len();
                self.semantic_change_masks
                    .resize(records, ALL_SEMANTIC_CHANGES);
                self.record_changed_outputs(records - count..records);
            }
            self.sources
                .append_records(&scratch.sources[..len])
                .map_err(|_| GatherError::AllocationFailed)?;
            cursor += len;
        }
        Ok(())
    }

    /// Appends one chunk's selected rows to every column. A column the program does not
    /// declare has no source and publishes zeros.
    pub(super) fn append_columns(
        &mut self,
        plan: &ColumnPlan<'_, '_>,
        chunk: &SourceChunk,
        rows: Rows<'_>,
    ) -> Result<(), GatherError> {
        let f32_count = plan.f32_count();
        let u32_count = plan.u32_count();
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            let (f32_fields, u32_fields) = (self.f32_fields.len(), self.u32_fields.len());
            work.gather_f32_reads += f32_count.min(f32_fields) * rows.len();
            work.gather_f32_default_fills += f32_fields.saturating_sub(f32_count) * rows.len();
            work.gather_f32_slots_written += f32_fields * rows.len();
            work.gather_u32_reads += u32_count.min(u32_fields) * rows.len();
            work.gather_u32_default_fills += u32_fields.saturating_sub(u32_count) * rows.len();
            work.gather_u32_slots_written += u32_fields * rows.len();
        });
        for (field, lane) in self.f32_fields.iter_mut().enumerate() {
            let out = lane.extend(rows.len())?;
            if field >= f32_count {
                out.fill(0.0);
            } else if !plan.f32_column(field, chunk, rows, out) {
                return Err(GatherError::SourceFieldMissing);
            }
        }
        for (field, lane) in self.u32_fields.iter_mut().enumerate() {
            let out = lane.extend(rows.len())?;
            if field >= u32_count {
                out.fill(0);
            } else if !plan.u32_column(field, chunk, rows, out) {
                return Err(GatherError::SourceFieldMissing);
            }
        }
        let slots = self.placement_slots.extend(rows.len())?;
        chunk.placement_slots(rows, slots);
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn append_flat_rows<'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        source_start: usize,
        binding_for_font: &mut BindingLookup<'_, 'binding>,
    ) -> Result<(), GatherError> {
        let mut source_chunk = [GatherSource::new(0, None); LEAF_CAPACITY];
        let mut source_chunk_len = 0;
        let mut cached_font_handle = None;
        let mut cached_binding = None;
        let mut cached_program = None;
        for glyph_index in source_start..input.glyphs.len() {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.gather_glyph_visits += 1);
            let row = input.row(glyph_index)?;
            let glyph = row.glyph;
            let binding = if cached_font_handle == Some(glyph.binding_handle) {
                cached_binding.ok_or(GatherError::FontBindingMissing)?
            } else {
                let binding = binding_for_font(glyph.binding_handle)
                    .ok_or(GatherError::FontBindingMissing)?;
                cached_font_handle = Some(glyph.binding_handle);
                cached_binding = Some(binding);
                binding
            };
            let Some(selected) =
                binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
            else {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| work.fresh_recordless_rows += 1);
                // A glyph that selects no raster still occupies a source row. The retained walk
                // pairs source rows against emitted records, so omitting the row would shift every
                // later pairing -- which is the defect this lane exists to prevent.
                self.push_source_chunk(
                    &mut source_chunk,
                    &mut source_chunk_len,
                    GatherSource::new(glyph.stable_id, None),
                )?;
                continue;
            };
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.fresh_selected_rows += 1);
            let technique = binding.technique();
            let variant = binding.program_variant();
            let program = match cached_program {
                Some((cached_technique, cached_variant, program))
                    if cached_technique == technique && cached_variant == variant =>
                {
                    program
                }
                _ => {
                    let program = codec
                        .program(capability_set, technique, variant)
                        .ok_or(GatherError::ProgramMissing)?;
                    cached_program = Some((technique, variant, program));
                    program
                }
            };
            // A pushed row has no prior value to preserve, so a change mask cannot narrow it: the
            // registers it omits would be published as zeros rather than as retained values.
            // `gather_fields` bounds these by the program's declared input counts.
            self.gather_fields(row, binding, selected, program, u32::MAX, u32::MAX)?;
            let planned = plan_glyph(row, binding, selected)?;
            self.push_source_chunk(
                &mut source_chunk,
                &mut source_chunk_len,
                GatherSource::new(glyph.stable_id, Some(selected)),
            )?;
            self.glyphs.push(planned);
            self.placement_slots.push(glyph.placement_slot)?;
            self.write_change_mask(
                self.semantic_change_masks.len(),
                input
                    .semantic_change_masks
                    .get(glyph_index)
                    .copied()
                    .unwrap_or(crate::engine::positioning::ALL_SEMANTIC_CHANGES),
            );
        }
        self.sources
            .append_records(&source_chunk[..source_chunk_len])
            .map_err(|_| GatherError::AllocationFailed)
    }

    /// Appends resource-free decorations around glyph gather in CSS paint order.
    /// Rows use the decoration program's declared lanes; false means no decoration program.
    /// A row fills its lanes by position: the rectangle in the first four F32 lanes, then the
    /// baseline and the layout indices of its first and last glyph, which a program publishes
    /// only when its host asked for glyph facts.
    pub fn append_decorations(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        decorations: &[crate::engine::positioning::DecorationRecord],
        transform_id: u32,
        content_revision: u32,
        pass: DecorationPass,
    ) -> Result<bool, GatherError> {
        if !decorations.is_empty() {
            self.retained_output_intervals = false;
            self.changed_inputs = ChangedInputs::ALL;
        }
        let Some(program) = codec.decoration_program(capability_set) else {
            return Ok(false);
        };
        let decoration_count = decorations
            .iter()
            .filter(|record| pass.admits(record.flags))
            .count();
        if decoration_count == 0 {
            return Ok(true);
        }
        self.dirty_mask_ranges
            .try_reserve_cold(1)
            .map_err(|_| GatherError::AllocationFailed)?;
        let base = self.glyphs.len();
        reserve(&mut self.glyphs, decoration_count)?;
        self.placement_slots.reserve(decoration_count)?;
        reserve(&mut self.semantic_change_masks, decoration_count)?;
        for field in &mut self.f32_fields {
            field
                .reserve(decoration_count)
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        for field in &mut self.u32_fields {
            field
                .reserve(decoration_count)
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        for (ordinal, record) in decorations
            .iter()
            .filter(|record| pass.admits(record.flags))
            .enumerate()
        {
            let stable_id = DECORATION_STABLE_ID_BASE
                | u32::try_from(base + ordinal).map_err(|_| GatherError::AllocationFailed)?;
            for (index, field) in self.f32_fields.iter_mut().enumerate() {
                let value = match index {
                    0 => record.inline_start,
                    1 => record.block_start,
                    2 => record.inline_extent,
                    3 => record.block_extent,
                    4 => record.baseline,
                    // Exact up to 2^24, like a glyph's own published index.
                    5 => record.glyph_start as f32,
                    6 => record.glyph_end as f32,
                    _ => 0.0,
                };
                field.push(value)?;
            }
            for (index, field) in self.u32_fields.iter_mut().enumerate() {
                let value = match index {
                    0 => record.transform_index,
                    1 => stable_id,
                    2 => record.color,
                    3 => record.flags | (u32::from(record.style) << 8),
                    _ => 0,
                };
                field.push(value)?;
            }
            self.glyphs.push(PlanGlyph {
                stable_id,
                content_revision,
                technique: program.technique,
                program_variant: program.variant,
                resource_id: 0,
                resource_generation: 0,
                resource_kind: 0,
                resource_reference: 0,
                semantic_id: stable_id,
                transform_id,
                material_id: record.material_id,
                clip_id: record.clip_id,
                depth_key: match pass {
                    DecorationPass::Under => PAINT_LAYER_UNDER_DECORATION,
                    DecorationPass::Over => PAINT_LAYER_OVER_DECORATION,
                },
                inline_start: record.inline_start,
                block_start: record.block_start,
                inline_extent: record.inline_extent,
                block_extent: record.block_extent,
            });
            self.placement_slots.push(u32::MAX)?;
            self.write_change_mask(self.semantic_change_masks.len(), ALL_SEMANTIC_CHANGES);
        }
        self.retained_cursor = self.glyphs.len();
        self.retained_source_cursor = self.sources.len();
        Ok(true)
    }
}
