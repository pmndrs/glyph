//! Instance topology: the complete and retained layouts of pending instances in their slots.

use super::*;

impl OrderedPlanCompiler {
    pub(super) fn prepare_complete_topology(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        replacement: Option<&[GatherCorrespondence]>,
    ) -> Result<bool, OrderedPlanError> {
        let prefix = replacement
            .and_then(|entries| entries.first())
            .map_or(0, |entry| entry.old.record_start());
        if let Some(correspondence) = replacement
            && !self.admit_replacement(codec, capability_set, input, correspondence, prefix)?
        {
            return Ok(false);
        }
        // These mappings are speculative until commit. An aborted full fallback must
        // repair through complete admission before they can authorize retained work.
        self.mapping_state = MappingState::Invalid;
        reserve(&mut self.input_batches, input.glyphs.len())?;
        reserve(&mut self.input_slots, input.glyphs.len())?;
        self.input_batches.resize(input.glyphs.len(), NONE);
        self.input_batches[prefix..].fill(NONE);
        self.input_slots.resize(input.glyphs.len(), 0);
        if !self.assign_input_batches(
            codec,
            capability_set,
            input,
            prefix,
            replacement.is_some(),
        )? {
            return Ok(false);
        }
        if replacement.is_some()
            && self
                .pending_batches
                .iter()
                .any(|batch| batch.state.instance_count == 0)
        {
            return Ok(false);
        }
        self.layout_pending_instances(input, prefix)?;
        // A changed source tail can keep emitted/batch counts while changing draw
        // identity or extrema (for example, one glyph replaced by a ligature).
        // Retaining storage alone cannot authorize retention of renderer bindings.
        self.bindings_dirty |= replacement.is_some();
        self.mapping_state = MappingState::RebuiltPending;
        Ok(true)
    }

    /// Admits a replacement gather against the current mapping: maps every unchanged record's
    /// input slot and seeds each prior batch with its retained instances. Returns `false` when
    /// the correspondence does not describe the current plan.
    #[inline(always)]
    fn admit_replacement(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        correspondence: &[GatherCorrespondence],
        prefix: usize,
    ) -> Result<bool, OrderedPlanError> {
        if correspondence.is_empty() {
            return Ok(false);
        }
        if self.mapping_state != MappingState::Current
            || self.codec_fingerprint != codec.fingerprint()
            || self.capability_set != capability_set.0
            || prefix > input.glyphs.len()
            || prefix > self.instances.len()
            || self.input_batches.len() != self.instances.len()
            || self.input_slots.len() != self.instances.len()
        {
            return Ok(false);
        }
        reserve(&mut self.retained_input_slots, input.glyphs.len())?;
        self.retained_input_slots.resize(input.glyphs.len(), NONE);
        self.retain_input_slots(0..prefix, 0)?;
        let Some((old_end, next_end)) =
            self.retain_corresponding_slots(input, correspondence, prefix)?
        else {
            return Ok(false);
        };
        if self.instances.len() - old_end != input.glyphs.len() - next_end {
            return Ok(false);
        }
        self.retain_input_slots(old_end..self.instances.len(), next_end)?;
        reserve(&mut self.pending_batches, self.batches.len())?;
        for (index, batch) in self.batches.iter().copied().enumerate() {
            self.pending_batches.push(PendingBatch::unallocated(
                batch,
                Some(index as u32),
                batch.instance_count,
                self.patches.len(),
            ));
        }
        for &batch_index in &self.input_batches[prefix..] {
            let Some(batch) = self.pending_batches.get_mut(batch_index as usize) else {
                return Ok(false);
            };
            let Some(count) = batch.retained_count.checked_sub(1) else {
                return Ok(false);
            };
            batch.retained_count = count;
            batch.state.instance_count = count;
        }
        Ok(true)
    }

    /// Maps the input slots of every unchanged correspondence entry. Returns the old and next
    /// record ends the entries reach, or `None` when they are not contiguous and in bounds.
    #[inline(always)]
    fn retain_corresponding_slots(
        &mut self,
        input: OrderedPlanInput<'_>,
        correspondence: &[GatherCorrespondence],
        prefix: usize,
    ) -> Result<Option<(usize, usize)>, OrderedPlanError> {
        let mut old_end = prefix;
        let mut next_end = prefix;
        for entry in correspondence {
            let old = entry.old.record_start()..entry.old.record_end();
            let next = entry.next.record_start()..entry.next.record_end();
            if old.start != old_end
                || next.start != next_end
                || old.end < old.start
                || next.end < next.start
                || old.end > self.instances.len()
                || next.end > input.glyphs.len()
                || (entry.owner.is_none() && old.len() != next.len())
            {
                return Ok(None);
            }
            if entry.owner.is_none() {
                self.retain_input_slots(old.clone(), next.start)?;
            }
            old_end = old.end;
            next_end = next.end;
        }
        Ok(Some((old_end, next_end)))
    }

    /// Assigns every input glyph after `prefix` to a pending batch: a retained instance to the
    /// batch that holds its slot, a new one to the batch of its program and resource. Returns
    /// `false` when a replacement would need a batch the plan does not have.
    #[inline(always)]
    fn assign_input_batches(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        prefix: usize,
        replacement: bool,
    ) -> Result<bool, OrderedPlanError> {
        let mut cached_kind_program = None;
        for (input_index, glyph) in input.glyphs.iter().copied().enumerate().skip(prefix) {
            if let Some(&source) = self.retained_input_slots.get(input_index)
                && source != NONE
            {
                self.input_batches[input_index] = self.count_retained_instance(source)?;
                continue;
            }
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.ordered_admission_visits += 1);
            let program = match cached_kind_program {
                Some((technique, variant, program))
                    if technique == glyph.technique && variant == glyph.program_variant =>
                {
                    program
                }
                _ => {
                    let program = codec
                        .program(capability_set, glyph.technique, glyph.program_variant)
                        .ok_or(OrderedPlanError::ProgramMissing)?;
                    cached_kind_program = Some((glyph.technique, glyph.program_variant, program));
                    program
                }
            };
            check_program_resource(program, glyph)?;
            let key = batch_key(program, glyph);
            let Some(batch_index) = self.pending_batch_for(key, replacement)? else {
                return Ok(false);
            };
            self.pending_batches[batch_index].state.instance_count = self.pending_batches
                [batch_index]
                .state
                .instance_count
                .checked_add(1)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            self.input_batches[input_index] =
                u32::try_from(batch_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        }
        Ok(true)
    }

    /// Counts a retained instance into the pending batch that holds its slot and returns that
    /// batch's index.
    #[inline]
    fn count_retained_instance(&mut self, source: u32) -> Result<u32, OrderedPlanError> {
        let batch_index = self.batches.partition_point(|batch| {
            u64::from(batch.instance_start) + u64::from(batch.instance_count) <= u64::from(source)
        });
        let batch = self
            .pending_batches
            .get_mut(batch_index)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        batch.state.instance_count = batch
            .state
            .instance_count
            .checked_add(1)
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        u32::try_from(batch_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)
    }

    /// The pending batch for `key`, opened when the plan has none. A replacement never opens a
    /// batch: `None` sends it to the complete path.
    #[inline]
    fn pending_batch_for(
        &mut self,
        key: BatchKey,
        replacement: bool,
    ) -> Result<Option<usize>, OrderedPlanError> {
        if let Some(index) = self
            .pending_batches
            .iter()
            .position(|batch| batch.state.key == key)
        {
            return Ok(Some(index));
        }
        if replacement {
            return Ok(None);
        }
        reserve(&mut self.pending_batches, 1)?;
        let prior_index = self
            .batches
            .iter()
            .position(|batch| batch.key == key)
            .map(|index| index as u32);
        self.pending_batches.push(PendingBatch::unallocated(
            BatchState {
                key,
                instance_start: 0,
                instance_count: 0,
                buffer_start: 0,
                buffer_count: 0,
            },
            prior_index,
            0,
            self.patches.len(),
        ));
        Ok(Some(self.pending_batches.len() - 1))
    }

    pub(super) fn retain_input_slots(
        &mut self,
        old: Range<usize>,
        next_start: usize,
    ) -> Result<(), OrderedPlanError> {
        // Capture committed physical provenance before speculative input mappings are overwritten.
        for (offset, input_index) in old.enumerate() {
            let batch = self
                .batches
                .get(self.input_batches[input_index] as usize)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            let slot = self.input_slots[input_index];
            if slot >= batch.instance_count {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            self.retained_input_slots[next_start + offset] = batch
                .instance_start
                .checked_add(slot)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        }
        Ok(())
    }

    pub(super) fn retained_physical_index(
        &self,
        input: OrderedPlanInput<'_>,
        input_position: usize,
    ) -> Result<Option<u32>, OrderedPlanError> {
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.ordered_admission_visits += 1);
        let glyph = input.glyphs[input_position];
        let batch_index = self.input_batches[input_position];
        if batch_index == NONE {
            return Ok(None);
        }
        let batch_index =
            usize::try_from(batch_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        let Some(batch) = self.batches.get(batch_index).copied() else {
            return Ok(None);
        };
        if !batch_key_matches(batch.key, glyph) {
            return Ok(None);
        }
        let slot = self.input_slots[input_position];
        if slot >= batch.instance_count {
            return Ok(None);
        }
        batch
            .instance_start
            .checked_add(slot)
            .map(Some)
            .ok_or(OrderedPlanError::ArithmeticOverflow)
    }

    pub(super) fn compare_retained_instance(
        &mut self,
        input: OrderedPlanInput<'_>,
        input_position: usize,
        physical_index: u32,
        instance: &InstanceState,
    ) -> Result<Option<crate::engine::retained_rope::RopeUpdate<InstanceState>>, OrderedPlanError>
    {
        if instance.input_index
            != u32::try_from(input_position).map_err(|_| OrderedPlanError::ArithmeticOverflow)?
        {
            return Ok(None);
        }
        let glyph = input.glyphs[input_position];
        let semantic_changes = input
            .semantic_change_masks
            .get(input_position)
            .copied()
            .unwrap_or(crate::engine::positioning::ALL_SEMANTIC_CHANGES);
        self.bindings_dirty |= instance.stable_id != glyph.stable_id
            || (instance.content_revision != glyph.content_revision && semantic_changes == 0)
            || !crate::engine::positioning::semantic_changes_preserve_plan_bindings(
                semantic_changes,
            );
        let next = instance_state(input, input_position)?;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.ordered_instance_comparisons += 1);
        if *instance == next {
            return Ok(Some(crate::engine::retained_rope::RopeUpdate::Keep));
        }
        reserve(&mut self.dirty_instances, 1)?;
        self.dirty_instances.push(physical_index);
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.ordered_instance_rewrites += 1);
        Ok(Some(crate::engine::retained_rope::RopeUpdate::Replace(
            next,
        )))
    }

    pub(super) fn prepare_retained_topology(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        output_intervals: Option<&[Range<usize>]>,
    ) -> Result<bool, OrderedPlanError> {
        if self.mapping_state != MappingState::Current
            || self.codec_fingerprint != codec.fingerprint()
            || self.capability_set != capability_set.0
            || self.input_batches.len() != input.glyphs.len()
            || self.input_slots.len() != input.glyphs.len()
            || self.instances.len() != input.glyphs.len()
        {
            return Ok(false);
        }
        // Exact complete dirt needs no sparse input-to-physical lookup. Both scopes
        // retain the same admission body and canonical physical instance order.
        let output_intervals =
            output_intervals.and_then(|ranges| sparse_output_intervals(ranges, input.glyphs.len()));
        let retained_instances = self.instances.clone();
        let mut pending_instances = retained_instances.clone();
        if let Some(intervals) = output_intervals {
            let mut instance_cursor = retained_instances
                .cursor_from(0)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            let mut cursor_position = 0;
            for input_position in intervals.iter().flat_map(|interval| interval.clone()) {
                let Some(physical_index) = self.retained_physical_index(input, input_position)?
                else {
                    return Ok(false);
                };
                if cursor_position != physical_index {
                    instance_cursor = retained_instances
                        .cursor_from(physical_index as usize)
                        .ok_or(OrderedPlanError::InvalidIdentity)?;
                }
                let instance = instance_cursor
                    .next_record()
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                cursor_position = physical_index
                    .checked_add(1)
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                if self
                    .compare_retained_instance(input, input_position, physical_index, instance)?
                    .is_none()
                {
                    return Ok(false);
                }
            }
            self.dirty_instances.sort_unstable();
            pending_instances
                .update_ordered_ranges(
                    coalesced_slot_ranges(&self.dirty_instances)
                        .map(|range| Ok(range.start as usize..range.end as usize)),
                    |_, previous| {
                        instance_state(input, previous.input_index as usize)
                            .map(crate::engine::retained_rope::RopeUpdate::Replace)
                    },
                )
                .map_err(|error| match error {
                    RopeEditError::Storage => OrderedPlanError::AllocationFailed,
                    RopeEditError::Callback(error) => error,
                })?;
        } else {
            let count = retained_instances.len();
            let update = pending_instances.update_ordered(0..count, |physical_index, previous| {
                let input_position = previous.input_index as usize;
                let admitted =
                    self.retained_physical_index(input, input_position)
                        .and_then(|slot| match slot {
                            Some(slot) if slot as usize == physical_index => self
                                .compare_retained_instance(input, input_position, slot, previous),
                            _ => Ok(None),
                        });
                match admitted {
                    Ok(Some(update)) => Ok(update),
                    Ok(None) => Err(RetainedAdmissionError::Miss),
                    Err(error) => Err(RetainedAdmissionError::Plan(error)),
                }
            });
            match update {
                Ok(_) => {}
                Err(RopeEditError::Storage) => return Err(OrderedPlanError::AllocationFailed),
                Err(RopeEditError::Callback(RetainedAdmissionError::Miss)) => return Ok(false),
                Err(RopeEditError::Callback(RetainedAdmissionError::Plan(error))) => {
                    return Err(error);
                }
            }
            if count != 0
                && self.dirty_instances.len() == count
                && !retained_instances.is_exact_shape()
            {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| work.ordered_repacks += 1);
                let compact = {
                    let mut computed = pending_instances.iter();
                    RetainedRope::try_from_exact(count, |_| {
                        computed
                            .next()
                            .copied()
                            .ok_or(OrderedPlanError::InvalidIdentity)
                    })
                    .map_err(|error| match error {
                        RopeEditError::Storage => OrderedPlanError::AllocationFailed,
                        RopeEditError::Callback(error) => error,
                    })?
                };
                pending_instances = compact;
            }
        }

        reserve(&mut self.pending_batches, self.batches.len())?;
        for (batch_index, batch) in self.batches.iter().copied().enumerate() {
            let buffers = self
                .buffers
                .get(range(batch.buffer_start, u32::from(batch.buffer_count))?)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            let mut pending = PendingBatch {
                retained_count: 0,
                state: batch,
                prior_index: Some(
                    u32::try_from(batch_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                ),
                allocation_start: None,
                patch_start: self.patches.len(),
                patch_end: self.patches.len(),
                capacity: buffers.first().map_or(0, |buffer| buffer.capacity),
                buffer_ids: [0; MAX_PHYSICAL_BUFFERS],
                buffer_generations: [0; MAX_PHYSICAL_BUFFERS],
            };
            for (buffer_index, buffer) in buffers.iter().enumerate() {
                pending.buffer_ids[buffer_index] = buffer.id;
                pending.buffer_generations[buffer_index] = buffer.generation;
            }
            self.pending_batches.push(pending);
        }
        self.pending_instances = pending_instances;
        Ok(true)
    }

    pub(super) fn layout_pending_instances(
        &mut self,
        input: OrderedPlanInput<'_>,
        unchanged_prefix: usize,
    ) -> Result<(), OrderedPlanError> {
        reserve(&mut self.batch_cursors, self.pending_batches.len())?;
        let mut cursor = 0_u32;
        for batch in &mut self.pending_batches {
            batch.state.instance_start = cursor;
            cursor = cursor
                .checked_add(batch.state.instance_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            self.batch_cursors
                .push(batch.state.instance_start + batch.retained_count);
        }
        self.sort_pairs.clear();
        reserve(&mut self.sort_pairs, input.glyphs.len() - unchanged_prefix)?;
        for input_index in unchanged_prefix..input.glyphs.len() {
            if self.input_batches[input_index] == NONE {
                continue;
            }
            let batch = self.input_batches[input_index] as usize;
            let destination = self.batch_cursors[batch];
            self.sort_pairs
                .push((u64::from(destination), input_index as u32));
            self.input_slots[input_index] =
                destination - self.pending_batches[batch].state.instance_start;
            self.batch_cursors[batch] = destination
                .checked_add(1)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        }
        if self.sort_pairs.windows(2).any(|pair| pair[0].0 > pair[1].0) {
            sort::sort_pairs(&mut self.sort_pairs);
        }
        let mut chunk = [InstanceState::default(); LEAF_CAPACITY];
        let mut chunk_len = 0;
        let mut pair_index = 0;
        for batch in &self.pending_batches {
            let previous_range = batch
                .prior_index
                .and_then(|index| self.batches.get(index as usize))
                .map(|prior| range(prior.instance_start, prior.instance_count))
                .transpose()?
                .unwrap_or(0..0);
            let retained_end = previous_range.start + batch.retained_count as usize;
            if batch.retained_count != 0 {
                self.pending_instances
                    .append_records(&chunk[..chunk_len])
                    .map_err(|_| OrderedPlanError::AllocationFailed)?;
                chunk_len = 0;
                if !self
                    .pending_instances
                    .append_shared_range(&self.instances, previous_range.start..retained_end)
                    .map_err(|_| OrderedPlanError::AllocationFailed)?
                {
                    return Err(OrderedPlanError::InvalidIdentity);
                }
            }
            let previous_range = self
                .instances
                .range(retained_end..previous_range.end)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            let mut previous = previous_range.iter();
            for ordinal in range(
                batch.state.instance_start + batch.retained_count,
                batch.state.instance_count - batch.retained_count,
            )? {
                let input_index = self.sort_pairs[pair_index].1 as usize;
                pair_index += 1;
                let source = self
                    .retained_input_slots
                    .get(input_index)
                    .copied()
                    .unwrap_or(NONE);
                let previous = previous.next();
                let next = instance_state(input, input_index)?;
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.ordered_instance_comparisons += 1;
                    work.ordered_instance_rewrites += 1;
                });
                let moved = source != NONE
                    && source as usize
                        != ordinal - batch.state.instance_start as usize + retained_end
                            - batch.retained_count as usize;
                if moved || (source == NONE && previous != Some(&next)) {
                    reserve(&mut self.dirty_instances, 1)?;
                    self.dirty_instances.push(ordinal as u32);
                }
                chunk[chunk_len] = next;
                chunk_len += 1;
                if chunk_len == LEAF_CAPACITY {
                    self.pending_instances
                        .append_records(&chunk)
                        .map_err(|_| OrderedPlanError::AllocationFailed)?;
                    chunk_len = 0;
                }
            }
        }
        self.pending_instances
            .append_records(&chunk[..chunk_len])
            .map_err(|_| OrderedPlanError::AllocationFailed)?;
        Ok(())
    }
}

pub(super) fn instance_state(
    input: OrderedPlanInput<'_>,
    input_index: usize,
) -> Result<InstanceState, OrderedPlanError> {
    #[cfg(test)]
    crate::engine::work_attribution::record(|work| work.ordered_state_derivations += 1);
    let glyph = input
        .glyphs
        .get(input_index)
        .ok_or(OrderedPlanError::InvalidIdentity)?;
    Ok(InstanceState {
        stable_id: glyph.stable_id,
        content_revision: glyph.content_revision,
        placement_slot: input.placement_slot(input_index)?,
        input_index: u32::try_from(input_index)
            .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
    })
}

/// Refuses a glyph whose resource kind its program does not accept.
#[inline]
fn check_program_resource(
    program: &crate::engine::codec::ProgramDescriptor,
    glyph: OrderedGlyph,
) -> Result<(), OrderedPlanError> {
    if program.primitive_kind != PRIMITIVE_DECORATION {
        let resource_bit = 1_u32
            .checked_shl(u32::from(glyph.resource_kind - 1))
            .ok_or(OrderedPlanError::InvalidResource)?;
        if program.resource_kind_mask & resource_bit == 0 {
            return Err(OrderedPlanError::InvalidResource);
        }
    }
    Ok(())
}

impl PendingBatch {
    /// A batch with no allocation or patches yet, its patch range empty at `patch_cursor`.
    #[inline(always)]
    fn unallocated(
        state: BatchState,
        prior_index: Option<u32>,
        retained_count: u32,
        patch_cursor: usize,
    ) -> Self {
        Self {
            retained_count,
            state,
            prior_index,
            allocation_start: None,
            patch_start: patch_cursor,
            patch_end: patch_cursor,
            capacity: 0,
            buffer_ids: [0; MAX_PHYSICAL_BUFFERS],
            buffer_generations: [0; MAX_PHYSICAL_BUFFERS],
        }
    }
}
