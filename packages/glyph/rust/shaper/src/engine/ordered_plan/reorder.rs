//! The reorder fast path: a new order over unchanged instances, without rebuilding batches.

use super::*;

impl OrderedPlanCompiler {
    /// Reorders one unchanged aggregate draw by copying committed records into their next physical
    /// order. Multi-draw batches fall back because changing their physical spans requires
    /// republishing renderer bindings.
    pub(crate) fn prepare_reorder(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        stable_ids: &[u32],
        publication_generation: u32,
    ) -> Result<bool, OrderedPlanError> {
        if self.prepared {
            return Err(OrderedPlanError::AlreadyPrepared);
        }
        if publication_generation == 0 {
            return Err(OrderedPlanError::InvalidIdentity);
        }
        if self.codec_fingerprint != codec.fingerprint()
            || self.capability_set != capability_set.0
            || self.batches.len() != 1
            || self.live_primitives.len() != 1
            || self.live_draws.len() != 1
            || self.instances.len() != stable_ids.len()
            || self.input_batches.len() != stable_ids.len()
            || self.input_slots.len() != stable_ids.len()
        {
            return Ok(false);
        }
        let batch = self.batches[0];
        let batch_buffer_id = self
            .buffers
            .get(batch.buffer_start as usize)
            .map_or(0, |buffer| buffer.id);
        if batch.instance_start != 0
            || usize::try_from(batch.instance_count).ok() != Some(stable_ids.len())
            || self
                .live_primitives
                .iter()
                .any(|primitive| primitive.buffer_id != batch_buffer_id)
        {
            return Ok(false);
        }
        let mut primitive_cursor = 0_u32;
        for draw in &self.live_draws {
            if draw.primitive_start != primitive_cursor
                || draw.buffer_start != batch.buffer_start
                || draw.buffer_count != u32::from(batch.buffer_count)
            {
                return Ok(false);
            }
            primitive_cursor = primitive_cursor
                .checked_add(draw.primitive_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        }
        if usize::try_from(primitive_cursor).ok() != Some(self.live_primitives.len()) {
            return Ok(false);
        }
        codec
            .capability_set(capability_set)
            .ok_or(OrderedPlanError::CapabilitySetMissing)?;
        let program = codec
            .program(
                capability_set,
                batch.key.technique,
                batch.key.program_variant,
            )
            .ok_or(OrderedPlanError::ProgramMissing)?;
        if program.buffers.len() != usize::from(batch.buffer_count) {
            return Ok(false);
        }

        self.reset_pending();
        self.sort_pairs.clear();
        reserve(&mut self.sort_pairs, self.instances.len())?;
        for (slot, instance) in self.instances.iter().enumerate() {
            self.sort_pairs.push((
                u64::from(instance.stable_id),
                u32::try_from(slot).map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
            ));
        }
        sort::sort_pairs(&mut self.sort_pairs);
        // Duplicate committed identities mean the retained compiler state is corrupt. Requested
        // identities below may legitimately stop matching after raster admission changes, so
        // those fall back to ordinary compilation instead of becoming an engine error.
        if self
            .sort_pairs
            .windows(2)
            .any(|pair| pair[0].0 == pair[1].0)
        {
            return Err(OrderedPlanError::DuplicateIdentity);
        }

        let buffers = self
            .buffers
            .get(range(batch.buffer_start, u32::from(batch.buffer_count))?)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let mut pending = PendingBatch {
            retained_count: 0,
            state: batch,
            prior_index: Some(0),
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
        reserve(&mut self.pending_batches, 1)?;
        self.pending_batches.push(pending);
        reserve(&mut self.batch_cursors, stable_ids.len())?;

        let mut reordered = false;
        let mut chunk = [InstanceState::default(); LEAF_CAPACITY];
        let mut chunk_len = 0;
        for (next_slot, &stable_id) in stable_ids.iter().enumerate() {
            let Ok(found) = self
                .sort_pairs
                .binary_search_by_key(&u64::from(stable_id), |pair| pair.0)
            else {
                return Ok(false);
            };
            let old_slot = self.sort_pairs[found].1;
            reordered |= old_slot as usize != next_slot;
            let mut instance = *self
                .instances
                .get(old_slot as usize)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            instance.input_index =
                u32::try_from(next_slot).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
            chunk[chunk_len] = instance;
            chunk_len += 1;
            if chunk_len == LEAF_CAPACITY {
                self.pending_instances
                    .append_records(&chunk)
                    .map_err(|_| OrderedPlanError::AllocationFailed)?;
                chunk_len = 0;
            }
            self.batch_cursors.push(old_slot);
        }
        if !reordered {
            self.pending_instances.clear();
            self.pending_batches.clear();
            return Ok(false);
        }
        self.pending_instances
            .append_records(&chunk[..chunk_len])
            .map_err(|_| OrderedPlanError::AllocationFailed)?;
        self.sort_pairs.clear();
        reserve(&mut self.sort_pairs, self.batch_cursors.len())?;
        for &old_slot in &self.batch_cursors {
            self.sort_pairs.push((u64::from(old_slot), 0));
        }
        sort::sort_pairs(&mut self.sort_pairs);
        if self
            .sort_pairs
            .windows(2)
            .any(|pair| pair[0].0 == pair[1].0)
        {
            return Ok(false);
        }

        let first_id = *stable_ids
            .first()
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        reserve(&mut self.primitives, 1)?;
        let mut primitive = self.live_primitives[0];
        primitive.id = first_id;
        primitive.record_index = 0;
        primitive.logical_order = 0;
        self.primitives.push(primitive);
        reserve(&mut self.draws, 1)?;
        let mut draw = self.live_draws[0];
        draw.id = first_id;
        draw.primitive_start = 0;
        draw.order_token = 0;
        self.draws.push(draw);

        reserve(&mut self.patches, program.buffers.len())?;
        for (schema_index, schema) in program.buffers.iter().enumerate() {
            let buffer = &buffers[schema_index];
            let live_bytes = stable_ids
                .len()
                .checked_mul(schema.stride())
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            if live_bytes > buffer.bytes.len() {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            let payload_start = self.payload.len();
            let payload_end = payload_start
                .checked_add(live_bytes)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            reserve(&mut self.payload, live_bytes)?;
            self.payload.resize(payload_end, 0);
            for next_slot in 0..stable_ids.len() {
                let old_slot = self.batch_cursors[next_slot] as usize;
                let source = old_slot
                    .checked_mul(schema.stride())
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                let destination = payload_start + next_slot * schema.stride();
                let source_end = source
                    .checked_add(schema.stride())
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                let destination_end = destination + schema.stride();
                let source = buffer
                    .bytes
                    .get(source..source_end)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                let destination = self
                    .payload
                    .get_mut(destination..destination_end)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                destination.copy_from_slice(source);
            }
            self.patches.push(PatchRecord {
                opcode: PATCH_WRITE,
                buffer_id: buffer.id,
                buffer_generation: buffer.generation,
                byte_length: u32::try_from(live_bytes)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                payload_start: u32::try_from(payload_start)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                ..PatchRecord::default()
            });
        }
        self.pending_batches[0].patch_end = self.patches.len();
        self.mapping_state = MappingState::Invalid;
        self.input_batches.fill(0);
        for (input_index, slot) in self.input_slots.iter_mut().enumerate() {
            *slot = u32::try_from(input_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        }
        self.mapping_state = MappingState::RebuiltPending;
        self.pending_next_buffer_id = self.next_buffer_id;
        self.pending_codec_fingerprint = self.codec_fingerprint;
        self.pending_capability_set = self.capability_set;
        // The reorder shortcut has no gathered draw key to certify a future span reuse.
        self.pending_order_independent = None;
        self.prepared = true;
        Ok(true)
    }
}
