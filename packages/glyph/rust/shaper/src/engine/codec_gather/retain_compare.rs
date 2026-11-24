//! Pairing retained rows with new ones, comparing their columns and adopting the changes.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl CodecGatherWorkspace {
    /// Pairs chunk rows with the accepted source rows and records. Returns how many source
    /// rows keep their pairing, how many of those own a record, and which chunk rows took
    /// a new identity. The first row that breaks the pairing ends the retained walk.
    pub(super) fn pair_retained_chunk<'codec, 'binding>(
        &self,
        codec: &'codec ValidatedCodec,
        capability_set: CapabilitySetId,
        transform_id: u32,
        state: &RetainedGatherCursor<'codec, 'binding>,
        bound: &mut ColumnBinding<'codec, 'binding>,
        scratch: &mut ColumnScratch,
    ) -> Result<(usize, usize, u64), GatherError> {
        let chunk = &scratch.chunk;
        let previous = self
            .sources
            .range(state.source_cursor..state.source_cursor + chunk.len)
            .ok_or(GatherError::InvalidSemanticShape)?;
        let mut accepted = 0;
        let mut selected = 0;
        let mut replaced = 0_u64;
        for (index, previous) in previous.iter().enumerate() {
            let is_selected = chunk.selected(index);
            if is_selected != previous.selected() {
                break;
            }
            let identity_changed = previous.stable_id != chunk.stable_id[index % CHUNK];
            // The source row follows a glyph that keeps its identity but is now read from
            // the other shape.
            let source_changed = previous.paragraph_run != chunk.paragraph_run(index);
            if !is_selected {
                if identity_changed {
                    break;
                }
                replaced |= u64::from(source_changed) << (index % CHUNK);
                accepted += 1;
                continue;
            }
            // The occupied record must still belong to the accepted source row. A new
            // stable ID may replace it only after this pairing and topology are proved.
            let Some(old) = self.glyphs.get(state.record_cursor + selected) else {
                break;
            };
            if old.stable_id != previous.stable_id {
                break;
            }
            if selected == 0 {
                bound.plan(codec, capability_set)?;
            }
            if !same_storage_topology(
                *old,
                chunk.record_topology(index, bound.binding, transform_id)?,
            ) || previous.selection != chunk.selection[index % CHUNK]
            {
                break;
            }
            scratch.rows[selected % CHUNK] = index as u8;
            replaced |= u64::from(identity_changed || source_changed) << (index % CHUNK);
            selected += 1;
            accepted += 1;
        }
        Ok((accepted, selected, replaced))
    }

    /// Pairs a chunk whose owner declared [`RowChange::Placement`] with the accepted rows.
    /// Returns how many rows own a record when every row is a paragraph-run glyph, now and
    /// when it was accepted, that keeps its identity, its record and the record's transform
    /// and clip: such a chunk can differ from the accepted records only in what its placement
    /// spans decide.
    pub(super) fn pair_placed_chunk(
        &self,
        transform_id: u32,
        state: &RetainedGatherCursor<'_, '_>,
        scratch: &mut ColumnScratch,
    ) -> Option<usize> {
        let chunk = &scratch.chunk;
        if !chunk.paragraph_runs_only() {
            return None;
        }
        let previous = self
            .sources
            .range(state.source_cursor..state.source_cursor + chunk.len)?;
        let mut selected = 0;
        let mut paired = 0;
        for (index, previous) in previous.iter().enumerate() {
            if previous.stable_id != chunk.stable_id[index % CHUNK] || !previous.paragraph_run {
                return None;
            }
            paired += 1;
            if !previous.selected() {
                continue;
            }
            let old = self.glyphs.get(state.record_cursor + selected)?;
            if old.stable_id != previous.stable_id
                || old.transform_id != transform_id
                || old.clip_id != chunk.clip_id(index)
            {
                return None;
            }
            scratch.rows[selected % CHUNK] = index as u8;
            selected += 1;
        }
        (paired == chunk.len).then_some(selected)
    }

    /// Compares the inputs a placement span decides and leaves every other accepted lane
    /// alone: [`Self::pair_placed_chunk`] proved those rows unchanged.
    pub(super) fn compare_placement_columns(
        &mut self,
        plan: &ColumnPlan<'_, '_>,
        record: usize,
        count: usize,
        scratch: &mut ColumnScratch,
    ) -> Result<(), GatherError> {
        let rows = Rows::new(&scratch.rows[..count], &scratch.chunk);
        let masks = &mut scratch.masks[..count];
        masks.fill(0);
        for field in 0..plan.f32_count() {
            let accepted = self
                .f32_fields
                .get_mut(field)
                .and_then(|lane| lane.as_mut_slice().get_mut(record..record + count))
                .ok_or(GatherError::InvalidSemanticShape)?;
            let follows = plan.f32_follows_placement(field);
            // A test build projects the skipped inputs too and holds the declaration to them.
            if !follows && !cfg!(test) {
                continue;
            }
            let values = &mut scratch.f32_values[..count];
            if !plan.f32_column(field, &scratch.chunk, rows, values) {
                return Err(GatherError::SourceFieldMissing);
            }
            if !follows {
                assert!(
                    accepted
                        .iter()
                        .zip(values.iter())
                        .all(|(accepted, next)| accepted.to_bits() == next.to_bits()),
                    "an input no placement span decides changed under RowChange::Placement"
                );
                continue;
            }
            if columns::store_changes(accepted, values, plan.f32_dependency(field), masks) != 0 {
                self.changed_inputs.f32_fields |= 1 << field;
            }
        }
        for field in 0..plan.u32_count() {
            let accepted = self
                .u32_fields
                .get_mut(field)
                .and_then(|lane| lane.as_mut_slice().get_mut(record..record + count))
                .ok_or(GatherError::InvalidSemanticShape)?;
            let follows = plan.u32_follows_placement(field);
            if !follows && !cfg!(test) {
                continue;
            }
            let values = &mut scratch.u32_values[..count];
            if !plan.u32_column(field, &scratch.chunk, rows, values) {
                return Err(GatherError::SourceFieldMissing);
            }
            if !follows {
                assert!(
                    accepted == values,
                    "an input no placement span decides changed under RowChange::Placement"
                );
                continue;
            }
            if columns::store_changes(accepted, values, plan.u32_dependency(field), masks) != 0 {
                self.changed_inputs.u32_fields |= 1 << field;
            }
        }
        Ok(())
    }

    /// Writes every declared input of the paired records as one column each and folds the
    /// rows whose bits changed into the chunk's staged change masks.
    pub(super) fn compare_retained_columns(
        &mut self,
        plan: &ColumnPlan<'_, '_>,
        record: usize,
        count: usize,
        scratch: &mut ColumnScratch,
    ) -> Result<(), GatherError> {
        let rows = Rows::new(&scratch.rows[..count], &scratch.chunk);
        let masks = &mut scratch.masks[..count];
        masks.fill(0);
        #[cfg(test)]
        let mut changed = (0, 0);
        for field in 0..plan.f32_count() {
            let values = &mut scratch.f32_values[..count];
            if !plan.f32_column(field, &scratch.chunk, rows, values) {
                return Err(GatherError::SourceFieldMissing);
            }
            let accepted = self
                .f32_fields
                .get_mut(field)
                .and_then(|lane| lane.as_mut_slice().get_mut(record..record + count))
                .ok_or(GatherError::InvalidSemanticShape)?;
            let _changed =
                columns::store_changes(accepted, values, plan.f32_dependency(field), masks);
            self.changed_inputs.f32_fields |= u32::from(_changed != 0) << field;
            #[cfg(test)]
            {
                changed.0 += _changed;
            }
        }
        for field in 0..plan.u32_count() {
            let values = &mut scratch.u32_values[..count];
            if !plan.u32_column(field, &scratch.chunk, rows, values) {
                return Err(GatherError::SourceFieldMissing);
            }
            let accepted = self
                .u32_fields
                .get_mut(field)
                .and_then(|lane| lane.as_mut_slice().get_mut(record..record + count))
                .ok_or(GatherError::InvalidSemanticShape)?;
            let _changed =
                columns::store_changes(accepted, values, plan.u32_dependency(field), masks);
            self.changed_inputs.u32_fields |= u32::from(_changed != 0) << field;
            #[cfg(test)]
            {
                changed.1 += _changed;
            }
        }
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.gather_f32_reads += plan.f32_count() * count;
            work.gather_u32_reads += plan.u32_count() * count;
            work.gather_projected_register_compares +=
                (plan.f32_count() + plan.u32_count()) * count;
            work.gather_f32_changed_slots += changed.0;
            work.gather_f32_slots_written += changed.0;
            work.gather_u32_changed_slots += changed.1;
            work.gather_u32_slots_written += changed.1;
        });
        Ok(())
    }

    /// Adopts the compared records: a record whose inputs, origin, slot or identity moved
    /// takes a new revision and its change mask; an unchanged record is left untouched.
    pub(super) fn adopt_retained_changes(
        &mut self,
        record: usize,
        count: usize,
        scratch: &ColumnScratch,
        lanes: Lanes,
    ) -> Result<(), GatherError> {
        let records = record..record + count;
        let (Some(glyphs), Some(slots), Some(masks)) = (
            self.glyphs.get_mut(records.clone()),
            self.placement_slots.as_mut_slice().get_mut(records.clone()),
            self.semantic_change_masks.get_mut(records),
        ) else {
            return Err(GatherError::InvalidSemanticShape);
        };
        let mut revision = self.projected_revision_cursor.max(1);
        let mut exhausted = false;
        let mut bounds_changed = false;
        // Consecutive changed records extend one output interval.
        let mut changed_from = None;
        for (offset, ((previous, accepted_slot), mask)) in
            glyphs.iter_mut().zip(slots).zip(masks).enumerate()
        {
            let row = usize::from(scratch.rows[offset % CHUNK]);
            // Pairing proved the storage topology equal: only identity and bounds can move.
            let next = match lanes {
                Lanes::All => scratch.chunk.record_geometry(row)?,
                Lanes::Placed => scratch.chunk.record_placement(row, previous)?,
            };
            let slot = scratch.chunk.placement_slot(row);
            let (changes, moved) = retained_record_changes(
                previous,
                &next,
                scratch.masks[offset % CHUNK],
                *accepted_slot != slot,
            );
            #[cfg(test)]
            let identity_changed = previous.stable_id != next.stable_id;
            if changes == 0 {
                if let Some(start) = changed_from.take() {
                    merge_changed_outputs(&mut self.dirty_mask_ranges, start..record + offset);
                }
                continue;
            }
            // Column deltas above are staged only. A failed revision mint discards
            // the whole pending gather and burns prior minted high water.
            let Some(following) = revision.checked_add(1) else {
                exhausted = true;
                break;
            };
            previous.stable_id = next.stable_id;
            previous.content_revision = revision;
            previous.semantic_id = next.semantic_id;
            previous.inline_start = next.inline_start;
            previous.block_start = next.block_start;
            previous.inline_extent = next.inline_extent;
            previous.block_extent = next.block_extent;
            revision = following;
            *accepted_slot = slot;
            *mask = changes;
            bounds_changed |= moved;
            changed_from.get_or_insert(record + offset);
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_mask_bits += changes.count_ones() as usize;
                for bit in 0..16 {
                    work.gather_mask_bit_counts[bit] += usize::from(changes & (1 << bit) != 0);
                }
                work.gather_all_masks += usize::from(changes == ALL_SEMANTIC_CHANGES);
                work.gather_identity_mismatches += usize::from(identity_changed);
            });
        }
        if let Some(start) = changed_from {
            merge_changed_outputs(&mut self.dirty_mask_ranges, start..record + count);
        }
        self.projected_revision_cursor = revision;
        self.bounds_changed |= bounds_changed;
        if exhausted {
            // The existing size/capacity error maps to ResultTooLarge at the
            // engine boundary. Keep the native GatherError surface stable.
            return Err(GatherError::AllocationFailed);
        }
        Ok(())
    }

    /// A record retained in place under a new identity moves its source row with it, or
    /// the next retained walk would pair against a glyph this one already replaced. The
    /// rows are staged in source order and adopted by one rope traversal per stream.
    pub(super) fn stage_source_identities(
        &mut self,
        source: usize,
        mut replaced: u64,
        chunk: &SourceChunk,
    ) -> Result<(), GatherError> {
        self.source_identities
            .try_reserve_cold(replaced.count_ones() as usize)
            .map_err(|_| GatherError::AllocationFailed)?;
        while replaced != 0 {
            let row = replaced.trailing_zeros() as usize;
            replaced &= replaced - 1;
            self.source_identities.push((
                source + row,
                GatherSource {
                    stable_id: chunk.stable_id[row % CHUNK],
                    selection: chunk.selection[row % CHUNK],
                    paragraph_run: chunk.paragraph_run(row),
                },
            ));
        }
        Ok(())
    }

    pub(super) fn adopt_source_identities(&mut self) -> Result<(), GatherError> {
        if self.source_identities.is_empty() {
            return Ok(());
        }
        let identities = core::mem::take(&mut self.source_identities);
        let mut staged = identities.iter();
        let result = self.sources.update_ordered_ranges(
            StagedSourceRanges {
                identities: &identities,
                cursor: 0,
            },
            |index, _| match staged.next() {
                Some(&(source, identity)) if source == index => Ok(RopeUpdate::Replace(identity)),
                _ => Err(GatherError::InvalidSemanticShape),
            },
        );
        self.source_identities = identities;
        self.source_identities.clear();
        match result {
            Ok(_) => Ok(()),
            Err(crate::engine::retained_rope::RopeEditError::Storage) => {
                Err(GatherError::AllocationFailed)
            }
            Err(crate::engine::retained_rope::RopeEditError::Callback(error)) => Err(error),
        }
    }
}
