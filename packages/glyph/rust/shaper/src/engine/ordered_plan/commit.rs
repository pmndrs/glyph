//! The preflight check and commit of a prepared plan, and the pending state it resets.

use super::*;

impl OrderedPlanCompiler {
    pub fn plan_view(
        &self,
        codec_handle: u32,
        capability_set: CapabilitySetId,
        codec_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, OrderedPlanError> {
        if !self.prepared {
            return Err(OrderedPlanError::NotPrepared);
        }
        let resources = if self.publish_bindings {
            self.resources.as_slice()
        } else {
            &[]
        };
        let buffers = if self.publish_bindings {
            self.plan_buffers.as_slice()
        } else {
            &[]
        };
        let primitives = if self.publish_bindings {
            self.primitives.as_slice()
        } else {
            &[]
        };
        let draws = if self.publish_bindings {
            self.draws.as_slice()
        } else {
            &[]
        };
        Ok(RenderPlanView {
            retained_host_topology: self.retained_host_topology,
            codec_handle,
            capability_set: capability_set.0,
            codec_fingerprint,
            resources,
            buffers,
            patches: &self.patches,
            retirements: &self.retirements,
            primitives,
            draws,
            payload: &self.payload,
            ..RenderPlanView::default()
        })
    }

    pub(crate) fn preflight_commit(&mut self) -> Result<(), OrderedPlanError> {
        if !self.prepared {
            return Err(OrderedPlanError::NotPrepared);
        }
        let mut output_buffer_count = 0usize;
        for pending in &self.pending_batches {
            let buffer_count = usize::from(pending.state.buffer_count);
            if buffer_count > pending.buffer_ids.len() {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            u32::try_from(output_buffer_count).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
            output_buffer_count = output_buffer_count
                .checked_add(buffer_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;

            if pending.patch_start > pending.patch_end || pending.patch_end > self.patches.len() {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            let prior = pending
                .prior_index
                .and_then(|index| self.batches.get(index as usize));
            let allocation_end = pending
                .allocation_start
                .map(|start| {
                    start
                        .checked_add(buffer_count)
                        .ok_or(OrderedPlanError::ArithmeticOverflow)
                })
                .transpose()?;
            if allocation_end.is_some_and(|end| end > self.pending_allocations.len()) {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            if buffer_count != 0 && pending.allocation_start.is_none() && prior.is_none() {
                return Err(OrderedPlanError::InvalidIdentity);
            }
            for buffer_index in 0..buffer_count {
                let id = pending.buffer_ids[buffer_index];
                let generation = pending.buffer_generations[buffer_index];
                let target = self
                    .pending_buffer_target(pending, buffer_index)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                if target.id != id || target.generation != generation {
                    return Err(OrderedPlanError::InvalidIdentity);
                }
                if pending.buffer_ids[..buffer_index]
                    .iter()
                    .zip(&pending.buffer_generations[..buffer_index])
                    .any(|(&prior_id, &prior_generation)| {
                        prior_id == id && prior_generation == generation
                    })
                {
                    return Err(OrderedPlanError::InvalidIdentity);
                }
            }
            for patch in &self.patches[pending.patch_start..pending.patch_end] {
                if patch.opcode != PATCH_WRITE && patch.opcode != PATCH_ALLOCATE_OR_RESIZE {
                    continue;
                }
                let Some(buffer_index) = (0..buffer_count).find(|&index| {
                    pending.buffer_ids[index] == patch.buffer_id
                        && pending.buffer_generations[index] == patch.buffer_generation
                }) else {
                    return Err(OrderedPlanError::InvalidIdentity);
                };
                let target = self
                    .pending_buffer_target(pending, buffer_index)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                if patch.opcode == PATCH_ALLOCATE_OR_RESIZE {
                    if pending.allocation_start.is_none()
                        || usize::try_from(patch.byte_length)
                            .ok()
                            .is_none_or(|length| length != target.bytes.len())
                    {
                        return Err(OrderedPlanError::InvalidIdentity);
                    }
                    continue;
                }
                let source_start = usize::try_from(patch.payload_start)
                    .map_err(|_| OrderedPlanError::InvalidIdentity)?;
                let destination_start = usize::try_from(patch.destination_offset)
                    .map_err(|_| OrderedPlanError::InvalidIdentity)?;
                let length = usize::try_from(patch.byte_length)
                    .map_err(|_| OrderedPlanError::InvalidIdentity)?;
                let source_end = source_start
                    .checked_add(length)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                let destination_end = destination_start
                    .checked_add(length)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                if source_end > self.payload.len() || destination_end > target.bytes.len() {
                    return Err(OrderedPlanError::InvalidIdentity);
                }
            }
        }
        reserve(&mut self.spare_buffers, output_buffer_count)?;
        reserve(&mut self.spare_batches, self.pending_batches.len())?;
        Ok(())
    }

    pub(super) fn pending_buffer_target(
        &self,
        pending: &PendingBatch,
        buffer_index: usize,
    ) -> Option<&PhysicalBufferState> {
        if let Some(start) = pending.allocation_start {
            return self
                .pending_allocations
                .get(start.checked_add(buffer_index)?)?
                .as_ref()
                .map(|allocation| &allocation.state);
        }
        let prior = self
            .batches
            .get(usize::try_from(pending.prior_index?).ok()?)?;
        let source_index = usize::try_from(prior.buffer_start)
            .ok()?
            .checked_add(buffer_index)?;
        self.buffers.get(source_index)
    }

    pub(crate) fn commit_preflighted(&mut self) {
        mem::swap(&mut self.buffers, &mut self.spare_buffers);
        self.buffers.clear();
        let mut output_buffer_start = 0usize;
        for pending_index in 0..self.pending_batches.len() {
            let mut pending = self.pending_batches[pending_index];
            pending.state.buffer_start = u32::try_from(output_buffer_start)
                .expect("preflight checked every output buffer start");
            output_buffer_start += usize::from(pending.state.buffer_count);
            self.pending_batches[pending_index].state.buffer_start = pending.state.buffer_start;
            for buffer_index in 0..usize::from(pending.state.buffer_count) {
                if let Some(allocation_start) = pending.allocation_start {
                    let allocation = self.pending_allocations[allocation_start + buffer_index]
                        .take()
                        .expect("preflight validated staged batch allocations");
                    self.buffers.push(allocation.state);
                    continue;
                }
                let prior = self.batches[pending
                    .prior_index
                    .expect("preflight validated prior batch provenance for retained buffers")
                    as usize];
                let source_index = prior.buffer_start as usize + buffer_index;
                let source = &mut self.spare_buffers[source_index];
                apply_writes_prevalidated(
                    &mut source.bytes,
                    source.id,
                    source.generation,
                    &self.patches[pending.patch_start..pending.patch_end],
                    &self.payload,
                );
                self.buffers.push(PhysicalBufferState {
                    id: source.id,
                    generation: source.generation,
                    program_id: source.program_id,
                    schema: source.schema,
                    capacity: source.capacity,
                    bytes: mem::take(&mut source.bytes),
                });
            }
        }
        self.spare_buffers.clear();

        mem::swap(&mut self.batches, &mut self.spare_batches);
        self.batches.clear();
        for pending in &self.pending_batches {
            self.batches.push(pending.state);
        }
        self.spare_batches.clear();
        self.pending_allocations.clear();
        mem::swap(&mut self.instances, &mut self.pending_instances);
        self.pending_instances.clear();
        let retained_bindings = self.reuse_live_bindings;
        if retained_bindings {
            self.primitives.clear();
            self.draws.clear();
        } else {
            mem::swap(&mut self.live_primitives, &mut self.primitives);
            self.primitives.clear();
            mem::swap(&mut self.live_draws, &mut self.draws);
            self.draws.clear();
        }
        self.next_buffer_id = self.pending_next_buffer_id;
        self.codec_fingerprint = self.pending_codec_fingerprint;
        self.capability_set = self.pending_capability_set;
        self.committed_order_independent = self.pending_order_independent;
        if !retained_bindings {
            mem::swap(&mut self.blocks, &mut self.pending_blocks);
            self.pending_blocks.clear();
        }
        if self.committed_order_independent.is_none() {
            self.blocks.clear();
        }
        if self.mapping_state == MappingState::RebuiltPending {
            self.mapping_state = MappingState::Current;
        }
        self.reuse_live_bindings = false;
        self.pending_order_independent = None;
        self.prepared = false;
    }

    pub(super) fn reset_pending(&mut self) {
        if self.mapping_state == MappingState::RebuiltPending {
            self.mapping_state = MappingState::Invalid;
        }
        self.pending_batches.clear();
        self.pending_blocks.clear();
        self.pending_instances.clear();
        self.pending_allocations.clear();
        self.batch_cursors.clear();
        self.changed_ranges.clear();
        self.dirty_instances.clear();
        self.retained_input_slots.clear();
        self.resources.clear();
        self.plan_buffers.clear();
        self.primitives.clear();
        self.draws.clear();
        self.patches.clear();
        self.retirements.clear();
        self.payload.clear();
        self.publish_bindings = false;
        self.retained_host_topology = false;
        self.bindings_dirty = false;
        self.reuse_live_bindings = false;
        self.pending_order_independent = None;
    }
}
