//! Gathered fields: aligned storage, change masks and the per-field source reads.

use crate::cold_growth::ColdGrowth as _;

use super::*;

#[cfg(test)]
pub(super) fn known_semantic_f32(field: u8) -> bool {
    usize::from(field) < crate::engine::positioning::SEMANTIC_F32_FIELD_COUNT
        || matches!(
            field,
            SEMANTIC_F32_INLINE_ORIGIN
                | SEMANTIC_F32_BLOCK_ORIGIN
                | SEMANTIC_F32_INVERSE_FONT_SIZE
                | SEMANTIC_F32_OUTLINE_WIDTH_EM
                | SEMANTIC_F32_SHADOW_OFFSET_X_EM
                | SEMANTIC_F32_SHADOW_OFFSET_Y_EM
                | SEMANTIC_F32_FOREGROUND_RED
                | SEMANTIC_F32_FOREGROUND_GREEN
                | SEMANTIC_F32_FOREGROUND_BLUE
                | SEMANTIC_F32_FOREGROUND_ALPHA
        )
}
impl CodecGatherWorkspace {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn gather_fields(
        &mut self,
        row: GatherRow<'_>,
        binding: &FontRenderBinding,
        selected: SelectedGlyphBinding,
        program: &ProgramDescriptor,
        required_f32: u32,
        required_u32: u32,
    ) -> Result<(), GatherError> {
        let f32_count = usize::from(program.f32_input_count);
        let u32_count = usize::from(program.u32_input_count);
        for field in 0..self.f32_fields.len() {
            let value = if field < f32_count && required_f32 & (1 << field) != 0 {
                let source = program.inputs[field];
                source_f32(source.scope, source.field, row, binding, selected)?
            } else {
                0.0
            };
            self.f32_fields[field].push(value)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_f32_reads +=
                    usize::from(field < f32_count && required_f32 & (1 << field) != 0);
                work.gather_f32_default_fills +=
                    usize::from(field >= f32_count || required_f32 & (1 << field) == 0);
                work.gather_f32_slots_written += 1;
            });
        }
        for field in 0..self.u32_fields.len() {
            let value = if field < u32_count && required_u32 & (1 << field) != 0 {
                let source = program.inputs[f32_count + field];
                source_u32(source.scope, source.field, row, binding, selected)?
            } else {
                0
            };
            self.u32_fields[field].push(value)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_u32_reads +=
                    usize::from(field < u32_count && required_u32 & (1 << field) != 0);
                work.gather_u32_default_fills +=
                    usize::from(field >= u32_count || required_u32 & (1 << field) == 0);
                work.gather_u32_slots_written += 1;
            });
        }
        Ok(())
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn update_fields(
        &mut self,
        output_index: usize,
        row: GatherRow<'_>,
        binding: &FontRenderBinding,
        selected: SelectedGlyphBinding,
        program: &ProgramDescriptor,
        required_f32: u32,
        required_u32: u32,
    ) -> Result<(), GatherError> {
        let f32_count = usize::from(program.f32_input_count);
        let u32_count = usize::from(program.u32_input_count);
        for field in 0..f32_count {
            if required_f32 & (1 << field) == 0 {
                continue;
            }
            let source = program.inputs[field];
            let value = source_f32(source.scope, source.field, row, binding, selected)?;
            #[cfg(test)]
            let old = self.f32_fields[field]
                .blocks
                .get(output_index / 4)
                .map(|block| block.values[output_index % 4].to_bits());
            self.f32_fields[field].set(output_index, value)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_f32_reads += 1;
                work.gather_f32_slots_written += 1;
                work.gather_f32_changed_slots += usize::from(old != Some(value.to_bits()));
            });
        }
        for field in 0..u32_count {
            if required_u32 & (1 << field) == 0 {
                continue;
            }
            let source = program.inputs[f32_count + field];
            let value = source_u32(source.scope, source.field, row, binding, selected)?;
            #[cfg(test)]
            let old = self.u32_fields[field]
                .blocks
                .get(output_index / 4)
                .map(|block| block.values[output_index % 4]);
            self.u32_fields[field].set(output_index, value)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_u32_reads += 1;
                work.gather_u32_slots_written += 1;
                work.gather_u32_changed_slots += usize::from(old != Some(value));
            });
        }
        Ok(())
    }

    /// Selected output rows can only merge the input's nonzero runs, including when
    /// recordless sources disappear. Reserve that upper bound before touching any row.
    #[inline(never)]
    pub(super) fn reserve_mask_ranges(
        &mut self,
        masks: &[u16],
        start: usize,
        end: usize,
        default: u16,
    ) -> Result<(), GatherError> {
        let mut runs = 0;
        let mut dirty = false;
        if masks.is_empty() {
            runs = usize::from(start < end && default != 0);
        } else {
            for index in start..end {
                let next = masks.get(index).copied().unwrap_or(default) != 0;
                runs += usize::from(next && !dirty);
                dirty = next;
            }
        }
        self.dirty_mask_ranges
            .try_reserve_cold(runs)
            .map_err(|_| GatherError::AllocationFailed)
    }

    pub(super) fn write_change_mask(&mut self, index: usize, mask: u16) {
        if index == self.semantic_change_masks.len() {
            self.semantic_change_masks.push(mask);
        } else {
            self.semantic_change_masks[index] = mask;
        }
        if mask != 0 {
            self.record_changed_output(index);
        }
    }
}

impl<T: Copy + Default> AlignedField<T> {
    pub(super) fn reserve(&mut self, record_capacity: usize) -> Result<(), GatherError> {
        let block_capacity = record_capacity.div_ceil(4);
        if self.blocks.capacity() < block_capacity {
            self.blocks
                .try_reserve_exact_cold(block_capacity.saturating_sub(self.blocks.len()))
                .map_err(|_| GatherError::AllocationFailed)?;
        }
        Ok(())
    }

    pub(super) fn push(&mut self, value: T) -> Result<(), GatherError> {
        let lane = self.len % 4;
        if lane == 0 {
            if self.blocks.len() == self.blocks.capacity() {
                return Err(GatherError::AllocationFailed);
            }
            self.blocks.push(AlignedBlock {
                values: [T::default(); 4],
            });
        }
        let block = self
            .blocks
            .last_mut()
            .ok_or(GatherError::AllocationFailed)?;
        block.values[lane] = value;
        self.len += 1;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn set(&mut self, index: usize, value: T) -> Result<(), GatherError> {
        if index >= self.len {
            return Err(GatherError::InvalidSemanticShape);
        }
        self.blocks[index / 4].values[index % 4] = value;
        Ok(())
    }

    /// Appends `count` rows within the reserved capacity and returns them for the caller
    /// to write. A partly used last block may hold stale lanes, so every row is written.
    pub(super) fn extend(&mut self, count: usize) -> Result<&mut [T], GatherError> {
        let start = self.len;
        let len = start
            .checked_add(count)
            .ok_or(GatherError::AllocationFailed)?;
        let blocks = len.div_ceil(4);
        if blocks > self.blocks.capacity() {
            return Err(GatherError::AllocationFailed);
        }
        if blocks > self.blocks.len() {
            self.blocks.resize_with(blocks, || AlignedBlock {
                values: [T::default(); 4],
            });
        }
        self.len = len;
        Ok(&mut self.as_mut_slice()[start..])
    }

    pub(super) fn truncate(&mut self, len: usize) {
        self.blocks.truncate(len.div_ceil(4));
        self.len = self.len.min(len);
    }

    pub(super) fn clear(&mut self) {
        self.blocks.clear();
        self.len = 0;
    }

    pub(super) fn extend_from_within(&mut self, range: Range<usize>) -> Result<(), GatherError> {
        if range.start > range.end || range.end > self.len {
            return Err(GatherError::InvalidSemanticShape);
        }
        let previous_len = self.len;
        let len = previous_len
            .checked_add(range.len())
            .ok_or(GatherError::AllocationFailed)?;
        self.reserve(len)?;
        self.blocks.resize_with(len.div_ceil(4), || AlignedBlock {
            values: [T::default(); 4],
        });
        // SAFETY: only 32-bit scalars instantiate this field. Every block is initialized;
        // exclusive access prevents aliases or relocation, and both ranges are within len.
        let values =
            unsafe { core::slice::from_raw_parts_mut(self.blocks.as_mut_ptr().cast::<T>(), len) };
        values.copy_within(range, previous_len);
        self.len = len;
        Ok(())
    }

    pub(super) fn splice_appended(&mut self, old: Range<usize>, previous_len: usize) {
        debug_assert_eq!(
            core::mem::size_of::<AlignedBlock<T>>(),
            core::mem::size_of::<T>() * 4
        );
        // SAFETY: the only instantiated scalar types are 32-bit. Initialized blocks
        // contain exactly four contiguous values; exclusive self access prevents aliases
        // or relocation while this view exists, and len bounds initialized storage.
        let values = unsafe {
            core::slice::from_raw_parts_mut(self.blocks.as_mut_ptr().cast::<T>(), self.len)
        };
        let len = move_appended(values, old, previous_len);
        self.truncate(len);
    }

    pub(super) fn as_slice(&self) -> &[T] {
        debug_assert_eq!(
            core::mem::size_of::<AlignedBlock<T>>(),
            core::mem::size_of::<T>() * 4
        );
        // SAFETY: `AlignedBlock<T>` is exactly four contiguous `T` values with no trailing
        // padding for the only instantiated 32-bit scalar types. `len` never exceeds the
        // initialized block prefix, and blocks cannot move while this shared slice exists.
        unsafe { core::slice::from_raw_parts(self.blocks.as_ptr().cast::<T>(), self.len) }
    }

    pub(super) fn as_mut_slice(&mut self) -> &mut [T] {
        debug_assert_eq!(
            core::mem::size_of::<AlignedBlock<T>>(),
            core::mem::size_of::<T>() * 4
        );
        // SAFETY: as `as_slice`; exclusive access to `self` makes the view unique, and
        // `len` never exceeds the initialized block prefix.
        unsafe { core::slice::from_raw_parts_mut(self.blocks.as_mut_ptr().cast::<T>(), self.len) }
    }

    pub(super) fn capacity(&self) -> usize {
        self.blocks.capacity() * 4
    }
}

#[cfg(test)]
pub(super) fn plan_glyph(
    row: GatherRow<'_>,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<PlanGlyph, GatherError> {
    let resource = binding
        .resources()
        .get(usize::try_from(selected.resource).map_err(|_| GatherError::ResourceBindingMissing)?)
        .ok_or(GatherError::ResourceBindingMissing)?;
    let glyph = row.glyph;
    let (semantic_id, [inline_start, block_start]) = plan_glyph_placement(row)?;
    Ok(PlanGlyph {
        stable_id: glyph.stable_id,
        content_revision: glyph.content_revision,
        technique: binding.technique(),
        program_variant: binding.program_variant(),
        resource_id: resource.id,
        resource_generation: resource.generation,
        resource_kind: resource.kind,
        resource_reference: resource.reference,
        semantic_id,
        transform_id: row.input.transform_id,
        material_id: glyph.material_id,
        clip_id: glyph.clip_id,
        depth_key: glyph.depth_key,
        inline_start,
        block_start,
        inline_extent: glyph.inline_extent,
        block_extent: glyph.block_extent,
    })
}

#[cfg(test)]
pub(super) fn plan_glyph_placement(row: GatherRow<'_>) -> Result<(u32, [f32; 2]), GatherError> {
    let glyph = row.glyph;
    let semantic = row
        .input
        .semantic_glyphs
        .get(
            usize::try_from(glyph.semantic_glyph_index)
                .map_err(|_| GatherError::SourceFieldMissing)?,
        )
        .ok_or(GatherError::InvalidSemanticShape)?;
    let translation = row
        .input
        .placement_translations
        .get(
            usize::try_from(semantic.placement_segment)
                .map_err(|_| GatherError::SourceFieldMissing)?,
        )
        .ok_or(GatherError::InvalidSemanticShape)?;
    let inline_start = crate::engine::positioning::placed_f32(
        semantic.ink_inline_start,
        translation.translation_inline as f32,
    )
    .map_err(|_| GatherError::InvalidSemanticShape)?;
    let block_start = crate::engine::positioning::placed_f32(
        semantic.ink_block_start,
        translation.translation_block as f32,
    )
    .map_err(|_| GatherError::InvalidSemanticShape)?;
    Ok((semantic.cluster, [inline_start, block_start]))
}

pub(super) fn same_storage_topology(previous: PlanGlyph, next: PlanGlyph) -> bool {
    previous.technique == next.technique
        && previous.program_variant == next.program_variant
        && previous.resource_id == next.resource_id
        && previous.resource_generation == next.resource_generation
        && previous.resource_kind == next.resource_kind
        && previous.resource_reference == next.resource_reference
        && previous.transform_id == next.transform_id
        && previous.material_id == next.material_id
        && previous.clip_id == next.clip_id
        && previous.depth_key == next.depth_key
}

#[cfg(test)]
pub(super) fn source_f32(
    scope: InputScope,
    field: u8,
    row: GatherRow<'_>,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<f32, GatherError> {
    let (table, source_row) = match scope {
        InputScope::Semantic => return semantic_f32(field, row),
        InputScope::Glyph => (binding.glyph_f32(), binding_row(row.glyph.glyph_id)?),
        InputScope::Strike => (binding.strike_f32(), binding_row(selected.strike_row)?),
        InputScope::Resource => (binding.resource_f32(), binding_row(selected.resource)?),
    };
    table
        .field(field)
        .and_then(|values| values.get(source_row))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)
}

#[cfg(test)]
pub(super) fn derived_semantic_f32(
    field: u8,
    row: GatherRow<'_>,
) -> Result<Option<f32>, GatherError> {
    if field == SEMANTIC_F32_INLINE_ORIGIN || field == SEMANTIC_F32_BLOCK_ORIGIN {
        return Ok(Some(if field == SEMANTIC_F32_INLINE_ORIGIN {
            row.glyph.inline_start
        } else {
            row.glyph.block_start
        }));
    }
    if field == SEMANTIC_F32_INVERSE_FONT_SIZE {
        return Ok(Some(1.0 / row.glyph.font_size));
    }
    if field == SEMANTIC_F32_OUTLINE_WIDTH_EM {
        return optional_semantic_f32(row, 6).map(Some);
    }
    if field == SEMANTIC_F32_SHADOW_OFFSET_X_EM {
        return optional_semantic_f32(row, 7).map(Some);
    }
    if field == SEMANTIC_F32_SHADOW_OFFSET_Y_EM {
        return optional_semantic_f32(row, 8).map(Some);
    }
    let (shift, srgb) = match field {
        SEMANTIC_F32_FOREGROUND_RED => (0, true),
        SEMANTIC_F32_FOREGROUND_GREEN => (8, true),
        SEMANTIC_F32_FOREGROUND_BLUE => (16, true),
        SEMANTIC_F32_FOREGROUND_ALPHA => (24, false),
        _ => return Ok(None),
    };
    let packed = row.semantic_u32(usize::from(SEMANTIC_U32_FOREGROUND_RGBA))?;
    let channel = (packed >> shift) & 0xff;
    Ok(Some(if srgb {
        f32::from_bits(SRGB8_TO_LINEAR_BITS[channel as usize])
    } else {
        (f64::from(channel) / 255.0) as f32
    }))
}

#[cfg(test)]
pub(super) fn optional_semantic_f32(row: GatherRow<'_>, field: usize) -> Result<f32, GatherError> {
    if row
        .input
        .semantic_f32
        .get(field)
        .is_some_and(|values| values.is_empty())
    {
        return Ok(0.0);
    }
    row.semantic_f32(field)
}

#[cfg(test)]
pub(super) fn source_u32(
    scope: InputScope,
    field: u8,
    row: GatherRow<'_>,
    binding: &FontRenderBinding,
    selected: SelectedGlyphBinding,
) -> Result<u32, GatherError> {
    if scope == InputScope::Semantic {
        if field == SEMANTIC_U32_PLACEMENT_SLOT {
            return Ok(row.glyph.placement_slot);
        }
        if row
            .input
            .semantic_u32
            .get(usize::from(field))
            .is_some_and(|values| values.is_empty())
            && (field == SEMANTIC_U32_OUTLINE_RGBA || field == SEMANTIC_U32_SHADOW_RGBA)
        {
            return Ok(0);
        }
        return row.semantic_u32(usize::from(field));
    }
    let (table, source_row) = match scope {
        InputScope::Glyph => (binding.glyph_u32(), binding_row(row.glyph.glyph_id)?),
        InputScope::Strike => (binding.strike_u32(), binding_row(selected.strike_row)?),
        InputScope::Resource => (binding.resource_u32(), binding_row(selected.resource)?),
        InputScope::Semantic => return Err(GatherError::InvalidSemanticShape),
    };
    table
        .field(field)
        .and_then(|values| values.get(source_row))
        .copied()
        .ok_or(GatherError::SourceFieldMissing)
}

pub(super) fn reserve_fields<T: Copy + Default>(
    fields: &mut Vec<AlignedField<T>>,
    field_count: usize,
    record_capacity: usize,
) -> Result<(), GatherError> {
    reserve(fields, field_count)?;
    while fields.len() < field_count {
        fields.push(AlignedField::default());
    }
    for field in fields {
        field.reserve(record_capacity)?;
    }
    Ok(())
}
