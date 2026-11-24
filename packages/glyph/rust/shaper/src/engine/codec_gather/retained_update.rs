//! Updating retained sources in place and replacing retained owners.

use super::*;

impl CodecGatherWorkspace {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn update_retained_source<'codec, 'binding>(
        &mut self,
        codec: &'codec ValidatedCodec,
        capability_set: CapabilitySetId,
        input: LayoutPlanInput<'_>,
        glyph_index: usize,
        previous_source: &GatherSource,
        state: &mut RetainedGatherCursor<'codec, 'binding>,
        binding_for_font: &mut impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<RopeUpdate<GatherSource>, GatherError> {
        // Returning a callback error would discard earlier source changes while their
        // record columns are already written. Adopt that prefix before suffix rebuild.
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.gather_glyph_visits += 1);
        // Flat rows write under the caller's change mask without comparing columns.
        self.changed_inputs = ChangedInputs::ALL;
        let row = input.row(glyph_index)?;
        let glyph = row.glyph;
        let previous_source = *previous_source;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.retained_selected_rows += usize::from(previous_source.selected());
            work.retained_recordless_rows += usize::from(!previous_source.selected());
            work.retained_stable_id_matches +=
                usize::from(previous_source.stable_id == glyph.stable_id);
            work.retained_stable_id_mismatches +=
                usize::from(previous_source.stable_id != glyph.stable_id);
        });
        state.source_cursor += 1;
        let change_mask = input
            .semantic_change_masks
            .get(glyph_index)
            .copied()
            .unwrap_or(0);
        if change_mask == 0 {
            // An empty delta is the one branch that consults neither the binding nor the
            // record: it trusts `selected` to say whether this glyph owns the record under
            // the record cursor. That trust is sound for a *retained* identity, whose glyph, size, and
            // pixel ratio cannot have moved the selection, and only for it. This Flat input's
            // mask is caller-supplied; an empty delta beside a different identity means the
            // walk is reading another glyph's source row and must rebuild -- otherwise a
            // recordless row skipped here silently retires a record
            // that belongs to a glyph nobody edited.
            if previous_source.stable_id != glyph.stable_id {
                state.source_cursor -= 1;
                state.rebuild = Some(glyph_index);
                return Ok(RopeUpdate::Stop);
            }
            if previous_source.selected() {
                let Some(previous) = self.glyphs.get(state.record_cursor) else {
                    state.source_cursor -= 1;
                    state.rebuild = Some(glyph_index);
                    return Ok(RopeUpdate::Stop);
                };
                if previous.stable_id != glyph.stable_id
                    || previous.transform_id != input.transform_id
                {
                    state.source_cursor -= 1;
                    state.rebuild = Some(glyph_index);
                    return Ok(RopeUpdate::Stop);
                }
                let previous = *previous;
                let (semantic_id, [inline_start, block_start]) = plan_glyph_placement(row)?;
                self.replace_glyph(
                    state.record_cursor,
                    PlanGlyph {
                        semantic_id,
                        inline_start,
                        block_start,
                        ..previous
                    },
                );
                state.record_cursor += 1;
            }
            return Ok(RopeUpdate::Keep);
        }
        if self.update_retained_position_only(
            codec,
            capability_set,
            row,
            state.record_cursor,
            previous_source,
            change_mask,
            state,
        )? {
            state.record_cursor += usize::from(previous_source.selected());
            return Ok(RopeUpdate::Keep);
        }
        let binding = if state.cached_font_handle == Some(glyph.binding_handle) {
            state
                .cached_binding
                .ok_or(GatherError::FontBindingMissing)?
        } else {
            let binding =
                binding_for_font(glyph.binding_handle).ok_or(GatherError::FontBindingMissing)?;
            state.cached_font_handle = Some(glyph.binding_handle);
            state.cached_binding = Some(binding);
            binding
        };
        let selected = binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio);
        if selected.is_some() != previous_source.selected() {
            state.source_cursor -= 1;
            state.rebuild = Some(glyph_index);
            return Ok(RopeUpdate::Stop);
        }
        let Some(selected) = selected else {
            // A changed identity that renders nothing still owns this source position next
            // frame, and the row is what the next retained walk pairs against.
            let next = GatherSource::new(glyph.stable_id, None);
            return Ok(if next != previous_source {
                RopeUpdate::Replace(next)
            } else {
                RopeUpdate::Keep
            });
        };
        let technique = binding.technique();
        let variant = binding.program_variant();
        let program = match state.cached_program {
            Some((cached_technique, cached_variant, program))
                if cached_technique == technique && cached_variant == variant =>
            {
                program
            }
            _ => {
                let program = codec
                    .program(capability_set, technique, variant)
                    .ok_or(GatherError::ProgramMissing)?;
                state.cached_program = Some((technique, variant, program));
                program
            }
        };
        let next = plan_glyph(row, binding, selected)?;
        let Some(previous) = self.glyphs.get(state.record_cursor).copied() else {
            state.source_cursor -= 1;
            state.rebuild = Some(glyph_index);
            return Ok(RopeUpdate::Stop);
        };
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.gather_mask_bits += change_mask.count_ones() as usize;
            for bit in 0..16 {
                work.gather_mask_bit_counts[bit] += usize::from(change_mask & (1 << bit) != 0);
            }
            work.gather_all_masks += usize::from(change_mask == ALL_SEMANTIC_CHANGES);
            work.gather_identity_mismatches += usize::from(previous.stable_id != next.stable_id);
        });
        // Flat input supplies its own change mask, while retained columns are slot-relative.
        // If an identity moves to a slot occupied by another glyph, a narrow mask cannot
        // establish that the skipped registers already hold this identity's values: they
        // would keep the displaced occupant's bytes. Projected input takes a separate path
        // that compares declared columns against the accepted slot before writing them.
        //
        // A caller-supplied `ALL_SEMANTIC_CHANGES` mask is safe even at a displaced slot:
        // `input_masks_for_changes` widens it to every declared input, and `update_fields`
        // rewrites the whole record in place. A displaced identity with a narrower mask
        // requires suffix rebuild.
        if (previous.stable_id != next.stable_id && change_mask != ALL_SEMANTIC_CHANGES)
            || !same_storage_topology(previous, next)
        {
            state.source_cursor -= 1;
            state.rebuild = Some(glyph_index);
            return Ok(RopeUpdate::Stop);
        }
        let selection_changed = !previous_source.same_selection(selected);
        let (f32_inputs, u32_inputs) = if selection_changed || change_mask == ALL_SEMANTIC_CHANGES {
            (
                low_bits(program.f32_input_count),
                low_bits(program.u32_input_count),
            )
        } else {
            let plan = state.input_plan(codec, capability_set, technique, variant, change_mask)?;
            (plan.f32_inputs, plan.u32_inputs)
        };
        self.update_fields(
            state.record_cursor,
            row,
            binding,
            selected,
            program,
            f32_inputs,
            u32_inputs,
        )?;
        self.placement_slots
            .set(state.record_cursor, glyph.placement_slot)?;
        self.replace_glyph(state.record_cursor, next);
        self.write_change_mask(state.record_cursor, change_mask);
        // A substitution retained in place keeps the slot and takes a new identity, so the
        // source row has to follow it. Leaving the displaced identity here would make the next
        // frame's pairing read a glyph this frame already replaced.
        let next = GatherSource::new(glyph.stable_id, Some(selected));
        state.record_cursor += 1;
        Ok(if next != previous_source {
            RopeUpdate::Replace(next)
        } else {
            RopeUpdate::Keep
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn update_retained_position_only<'codec, 'binding>(
        &mut self,
        codec: &'codec ValidatedCodec,
        capability_set: CapabilitySetId,
        row: GatherRow<'_>,
        output_index: usize,
        previous_source: GatherSource,
        change_mask: u16,
        state: &mut RetainedGatherCursor<'codec, 'binding>,
    ) -> Result<bool, GatherError> {
        if change_mask & !POSITION_ONLY_CHANGES != 0 {
            return Ok(false);
        }
        let glyph = row.glyph;
        if previous_source.stable_id != glyph.stable_id {
            return Ok(false);
        }
        if !previous_source.selected() {
            return Ok(true);
        }
        let Some(previous) = self.glyphs.get(output_index).copied() else {
            return Ok(false);
        };
        if previous.stable_id != glyph.stable_id
            || previous.transform_id != row.input.transform_id
            || previous.material_id != glyph.material_id
            || previous.clip_id != glyph.clip_id
            || previous.depth_key != glyph.depth_key
            || previous.inline_extent.to_bits() != glyph.inline_extent.to_bits()
            || previous.block_extent.to_bits() != glyph.block_extent.to_bits()
        {
            return Ok(false);
        }
        let plan = state.input_plan(
            codec,
            capability_set,
            previous.technique,
            previous.program_variant,
            change_mask,
        )?;
        let program = plan.program;
        let (f32_inputs, u32_inputs) = (plan.f32_inputs, plan.u32_inputs);
        if !plan.position_only_eligible && !plan.legacy_semantic_field {
            return Ok(false);
        }
        // An out-of-domain custom semantic field retains the old read/error order.
        if plan.legacy_semantic_field {
            for field in 0..usize::from(program.u32_input_count) {
                if u32_inputs & (1_u32 << field) == 0 {
                    continue;
                }
                let source = program.inputs[usize::from(program.f32_input_count) + field];
                if source.scope != InputScope::Semantic
                    || source.field != SEMANTIC_U32_PLACEMENT_SLOT
                {
                    return Ok(false);
                }
            }
        }
        let mut values = [0.0_f32; MAX_REGISTERS];
        for (field, value) in values
            .iter_mut()
            .enumerate()
            .take(usize::from(program.f32_input_count))
        {
            if f32_inputs & (1 << field) == 0 {
                continue;
            }
            let source = program.inputs[field];
            if source.scope != InputScope::Semantic {
                return Ok(false);
            }
            *value = semantic_f32(source.field, row)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.gather_f32_reads += 1);
        }
        let (semantic_id, [inline_start, block_start]) = plan_glyph_placement(row)?;
        for (field, value) in values
            .iter()
            .copied()
            .enumerate()
            .take(usize::from(program.f32_input_count))
        {
            if f32_inputs & (1 << field) != 0 {
                #[cfg(test)]
                let old = self.f32_fields[field]
                    .blocks
                    .get(output_index / 4)
                    .map(|block| block.values[output_index % 4].to_bits());
                self.f32_fields[field].set(output_index, value)?;
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.gather_f32_slots_written += 1;
                    work.gather_f32_changed_slots += usize::from(old != Some(value.to_bits()));
                });
            }
        }
        for field in 0..usize::from(program.u32_input_count) {
            if u32_inputs & (1 << field) != 0 {
                #[cfg(test)]
                let old = self.u32_fields[field]
                    .blocks
                    .get(output_index / 4)
                    .map(|block| block.values[output_index % 4]);
                self.u32_fields[field].set(output_index, glyph.placement_slot)?;
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.gather_u32_reads += 1;
                    work.gather_u32_slots_written += 1;
                    work.gather_u32_changed_slots += usize::from(old != Some(glyph.placement_slot));
                });
            }
        }
        self.replace_glyph(
            output_index,
            PlanGlyph {
                content_revision: glyph.content_revision,
                semantic_id,
                inline_start,
                block_start,
                ..previous
            },
        );
        // Structural placement metadata exists even when no codec operand reads it.
        self.placement_slots
            .set(output_index, glyph.placement_slot)?;
        self.write_change_mask(output_index, change_mask);
        Ok(true)
    }

    /// The planner proves this paragraph unchanged under the current gather cache key.
    /// A preceding topology edit may shift either coordinate; then the ordinary retained
    /// walk must establish the new pairing instead of trusting these historical endpoints.
    pub(crate) fn retain_unchanged(&mut self, range: GatherRange) -> bool {
        if range.start != self.position() || range.end.source > self.sources.len() {
            return false;
        }
        if range.end.record > self.semantic_change_masks.len() {
            return false;
        }
        self.retained_source_cursor = range.end.source;
        self.retained_cursor = range.end.record;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.gather_range_skips += 1);
        true
    }

    #[cfg(test)]
    pub(super) fn replace_glyph(&mut self, index: usize, next: PlanGlyph) {
        let previous = self.glyphs[index];
        let changed = previous.semantic_id != next.semantic_id
            || previous.inline_start.to_bits() != next.inline_start.to_bits()
            || previous.block_start.to_bits() != next.block_start.to_bits()
            || previous.inline_extent.to_bits() != next.inline_extent.to_bits()
            || previous.block_extent.to_bits() != next.block_extent.to_bits();
        self.bounds_changed |= changed;
        if changed {
            self.record_changed_output(index);
        }
        self.glyphs[index] = next;
    }

    pub(crate) fn replace_retained_owners<'owner, 'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        owners: impl Iterator<Item = Result<RetainedGatherOwner<'owner>, GatherError>> + Clone,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<GatherRange, GatherError> {
        let source_len = self.sources.len();
        let record_len = self.glyphs.len();
        self.changed_inputs = ChangedInputs::ALL;
        let first = owners
            .clone()
            .next()
            .ok_or(GatherError::InvalidSemanticShape)??;
        let mut old = first.range;
        let mut previous = old.start;
        let mut appended_capacity = 0usize;
        let mut owner_count = 0usize;
        let mut dirty_index = 0usize;
        for owner in owners.clone() {
            let owner = owner?;
            let range = owner.range;
            if range.start.source < previous.source
                || range.start.record < previous.record
                || range.end.source < range.start.source
                || range.end.record < range.start.record
                || range.end.source > source_len
                || range.end.record > record_len
            {
                return Err(GatherError::InvalidSemanticShape);
            }
            while self
                .dirty_mask_ranges
                .get(dirty_index)
                .is_some_and(|mask| mask.end <= previous.record)
            {
                dirty_index += 1;
            }
            if range.start.record > previous.record
                && self
                    .dirty_mask_ranges
                    .get(dirty_index)
                    .is_some_and(|mask| mask.start < range.start.record)
            {
                return Err(GatherError::InvalidSemanticShape);
            }
            appended_capacity = appended_capacity
                .checked_add(range.start.record - previous.record)
                .and_then(|count| count.checked_add(owner.input.len()))
                .ok_or(GatherError::AllocationFailed)?;
            previous = range.end;
            owner_count += 1;
        }
        old.end = previous;
        if self
            .dirty_mask_ranges
            .iter()
            .any(|mask| mask.start < old.start.record || mask.end > old.end.record)
        {
            return Err(GatherError::InvalidSemanticShape);
        }
        self.correspondence.clear();
        reserve(
            &mut self.correspondence,
            owner_count
                .checked_mul(2)
                .ok_or(GatherError::AllocationFailed)?,
        )?;
        // Every prior write belongs to a frontier owner in this envelope. Clean gaps have no dirt.
        self.dirty_mask_ranges.clear();
        if owner_count == 1 && old.end.source == source_len && old.end.record == record_len {
            self.reserve_codec(
                codec,
                old.start
                    .record
                    .checked_add(first.input.len())
                    .ok_or(GatherError::AllocationFailed)?,
            )?;
            self.retained_source_cursor = old.start.source;
            self.retained_cursor = old.start.record;
            // The owner's leading rows are compared with its accepted records first, so every
            // record whose inputs did not change keeps its content revision and only the rows
            // from the first difference on are gathered again (typing at the end of a paragraph).
            let stop = self.append_retained_stream(
                codec,
                capability_set,
                core::iter::once(Ok(first.clone())),
                &mut binding_for_font,
            )?;
            // The retained stream counted this owner's paragraph visit.
            let source_start = stop.map_or(first.input.len(), |stop| stop.source_index);
            self.truncate_to_retained_prefix()?;
            self.append_from_source(
                codec,
                capability_set,
                first.input(),
                source_start,
                &mut binding_for_font,
            )?;
            let next = self.range_since(old.start);
            self.correspondence.push(GatherCorrespondence {
                old,
                next,
                owner: Some(first.input.transform_id()),
            });
            return Ok(next);
        }
        self.reserve_codec(
            codec,
            record_len
                .checked_add(appended_capacity)
                .ok_or(GatherError::AllocationFailed)?,
        )?;
        let old_sources = self.sources.clone();
        let destination = |position: GatherPosition| {
            position.shifted_after(
                GatherPosition {
                    source: source_len,
                    record: record_len,
                },
                old.start,
            )
        };
        previous = old.start;
        for owner in owners {
            let owner = owner?;
            let gap = GatherRange {
                start: previous,
                end: owner.range.start,
            };
            if gap.start != gap.end {
                let start = GatherPosition {
                    source: self.sources.len(),
                    record: self.glyphs.len(),
                };
                self.sources
                    .append_shared_range(&old_sources, gap.start.source..gap.end.source)
                    .map_err(|()| GatherError::AllocationFailed)?;
                let rows = gap.start.record..gap.end.record;
                self.glyphs.extend_from_within(rows.clone());
                self.placement_slots.extend_from_within(rows.clone())?;
                self.semantic_change_masks.resize(self.glyphs.len(), 0);
                for field in &mut self.f32_fields {
                    field.extend_from_within(rows.clone())?;
                }
                for field in &mut self.u32_fields {
                    field.extend_from_within(rows.clone())?;
                }
                let end = GatherPosition {
                    source: self.sources.len(),
                    record: self.glyphs.len(),
                };
                self.correspondence.push(GatherCorrespondence {
                    old: gap,
                    next: GatherRange {
                        start: destination(start)?,
                        end: destination(end)?,
                    },
                    owner: None,
                });
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.gather_retained_gap_rows += gap.end.record - gap.start.record
                });
            }
            let start = GatherPosition {
                source: self.sources.len(),
                record: self.glyphs.len(),
            };
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.gather_paragraph_visits += 1);
            self.append_from_source(
                codec,
                capability_set,
                owner.input(),
                0,
                &mut binding_for_font,
            )?;
            let end = GatherPosition {
                source: self.sources.len(),
                record: self.glyphs.len(),
            };
            self.correspondence.push(GatherCorrespondence {
                old: owner.range,
                next: GatherRange {
                    start: destination(start)?,
                    end: destination(end)?,
                },
                owner: Some(owner.input.transform_id()),
            });
            previous = owner.range.end;
        }
        let next = GatherRange {
            start: old.start,
            end: destination(GatherPosition {
                source: self.sources.len(),
                record: self.glyphs.len(),
            })?,
        };
        // Complete the fallible rope work before the one net-delta splice of initialized lanes.
        let mut sources = RetainedRope::default();
        sources
            .append_shared_range(&old_sources, 0..old.start.source)
            .map_err(|()| GatherError::AllocationFailed)?;
        sources
            .append_shared_range(&self.sources, source_len..self.sources.len())
            .map_err(|()| GatherError::AllocationFailed)?;
        sources
            .append_shared_range(&old_sources, old.end.source..source_len)
            .map_err(|()| GatherError::AllocationFailed)?;
        let rows = old.start.record..old.end.record;
        splice_appended(&mut self.glyphs, rows.clone(), record_len);
        splice_appended(&mut self.semantic_change_masks, rows.clone(), record_len);
        self.placement_slots
            .splice_appended(rows.clone(), record_len);
        for field in &mut self.f32_fields {
            field.splice_appended(rows.clone(), record_len);
        }
        for field in &mut self.u32_fields {
            field.splice_appended(rows.clone(), record_len);
        }
        for range in &mut self.dirty_mask_ranges {
            range.start = shift_offset(range.start, record_len, old.start.record)?;
            range.end = shift_offset(range.end, record_len, old.start.record)?;
        }
        self.sources = sources;
        self.retained_source_cursor = self.sources.len();
        self.retained_cursor = self.glyphs.len();
        self.retained_output_intervals = false;
        self.bounds_changed = true;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.gather_envelope_splices += 1);
        Ok(next)
    }

    pub fn truncate_to_retained_prefix(&mut self) -> Result<(), GatherError> {
        self.correspondence.clear();
        self.changed_inputs = ChangedInputs::ALL;
        self.sources
            .truncate(self.retained_source_cursor)
            .map_err(|_| GatherError::AllocationFailed)?;
        self.retained_output_intervals = false;
        self.bounds_changed = true;
        self.glyphs.truncate(self.retained_cursor);
        self.placement_slots.truncate(self.retained_cursor);
        self.semantic_change_masks.truncate(self.retained_cursor);
        while self
            .dirty_mask_ranges
            .last()
            .is_some_and(|range| range.start >= self.retained_cursor)
        {
            self.dirty_mask_ranges.pop();
        }
        if let Some(range) = self.dirty_mask_ranges.last_mut() {
            range.end = range.end.min(self.retained_cursor);
        }
        for field in &mut self.f32_fields {
            field.truncate(self.retained_cursor);
        }
        for field in &mut self.u32_fields {
            field.truncate(self.retained_cursor);
        }
        Ok(())
    }
}

/// The semantic change mask of a retained record and whether its bounds moved. `staged`
/// holds the inputs whose lanes changed; pairing proved the storage topology equal, so
/// the record itself can differ only in identity, origin and extent.
pub(super) fn retained_record_changes(
    previous: &PlanGlyph,
    next: &columns::RecordGeometry,
    staged: u16,
    slot_changed: bool,
) -> (u16, bool) {
    let inline_moved = previous.inline_start.to_bits() != next.inline_start.to_bits();
    let block_moved = previous.block_start.to_bits() != next.block_start.to_bits();
    let moved = inline_moved
        || block_moved
        || previous.semantic_id != next.semantic_id
        || previous.inline_extent.to_bits() != next.inline_extent.to_bits()
        || previous.block_extent.to_bits() != next.block_extent.to_bits();
    if previous.stable_id != next.stable_id {
        // The accepted slot belonged to another identity. Every declared input was
        // compared; a new revision and full semantic dirt also retire old plan bindings
        // when the values happen to be bitwise equal.
        return (ALL_SEMANTIC_CHANGES, moved);
    }
    let mut changes = staged;
    changes |= u16::from(inline_moved) << 6;
    changes |= u16::from(block_moved) << 7;
    if slot_changed {
        changes |= SEMANTIC_PLACEMENT_SLOT_CHANGE;
    }
    if moved {
        changes |= crate::engine::positioning::SEMANTIC_EFFECTS_CHANGE;
    }
    (changes, moved)
}

/// Changed records arrive in ascending order; touching runs share one interval.
pub(super) fn merge_changed_outputs(ranges: &mut Vec<Range<usize>>, records: Range<usize>) {
    if let Some(range) = ranges.last_mut()
        && range.end >= records.start
    {
        range.end = range.end.max(records.end);
    } else {
        ranges.push(records);
    }
}

pub(super) fn move_appended<T: Copy>(
    values: &mut [T],
    old: Range<usize>,
    previous_len: usize,
) -> usize {
    let appended = values.len() - previous_len;
    if appended <= old.len() {
        // The replacement fits the removed range, so moving the suffix cannot overwrite it.
        values.copy_within(previous_len.., old.start);
        if appended != old.len() {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_suffix_copy_bytes +=
                    (previous_len - old.end) * core::mem::size_of::<T>();
            });
            values.copy_within(old.end..previous_len, old.start + appended);
        }
    } else {
        values[old.start..].rotate_right(appended);
        // [prefix, new, old, suffix] -> [prefix, new, suffix]; old rows are discarded.
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.gather_suffix_copy_bytes += (previous_len - old.end) * core::mem::size_of::<T>();
        });
        values.copy_within(old.end + appended.., old.start + appended);
    }
    values.len() - old.len()
}
