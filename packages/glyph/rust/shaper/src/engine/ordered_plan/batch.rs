//! Batches: preparing each batch's records, its changed ranges and the batches removed.

use super::*;

impl OrderedPlanCompiler {
    pub(super) fn prepare_batch(
        &mut self,
        context: PrepareContext<'_>,
        batch_index: usize,
    ) -> Result<(), OrderedPlanError> {
        let PrepareContext {
            codec,
            capability_set,
            capability,
            input,
            checkpoint,
            changed_inputs,
            ..
        } = context;
        let pending = self.pending_batches[batch_index];
        let patch_start = self.patches.len();
        let key = pending.state.key;
        let program = codec
            .program(capability_set, key.technique, key.program_variant)
            .ok_or(OrderedPlanError::ProgramMissing)?;
        let prior = pending
            .prior_index
            .map(|index| self.batches[index as usize]);
        let required = pending.state.instance_count;
        let prior_capacity = prior
            .and_then(|batch| self.buffers.get(batch.buffer_start as usize))
            .map_or(0, |buffer| buffer.capacity);
        let capacity = if prior_capacity >= required {
            prior_capacity
        } else {
            grown_capacity(prior_capacity.max(1), required)?
        };
        let capacity = align_up(
            capacity,
            record_alignment(program, capability.update_alignment)?,
        )?;
        for schema in &program.buffers {
            let byte_length = capacity
                .checked_mul(u32::from(schema.stride))
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            if byte_length > capability.max_buffer_bytes {
                return Err(OrderedPlanError::CapacityExceeded);
            }
        }
        self.pending_batches[batch_index].capacity = capacity;

        let new_or_resized = prior.is_none() || capacity != prior_capacity;
        let allocation_start =
            (checkpoint || new_or_resized).then_some(self.pending_allocations.len());
        self.pending_batches[batch_index].allocation_start = allocation_start;
        self.pending_batches[batch_index].patch_start = patch_start;
        self.changed_ranges.clear();
        if required != 0 && (checkpoint || new_or_resized) {
            reserve(&mut self.changed_ranges, 1)?;
            self.changed_ranges.push(RecordRange {
                start: 0,
                end: required,
            });
        } else {
            let start = pending.state.instance_start;
            let end = start
                .checked_add(required)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let first = self.dirty_instances.partition_point(|slot| *slot < start);
            let last = self.dirty_instances.partition_point(|slot| *slot < end);
            for run in coalesced_slot_ranges(&self.dirty_instances[first..last]) {
                reserve(&mut self.changed_ranges, 1)?;
                self.changed_ranges.push(RecordRange {
                    start: run.start - start,
                    end: run.end - start,
                });
            }
        }
        for (schema_index, schema) in program.buffers.iter().copied().enumerate() {
            let previous = prior
                .and_then(|batch| self.buffers.get(batch.buffer_start as usize + schema_index))
                .map(|buffer| (buffer.id, buffer.generation, buffer.bytes.len()));
            let (id, generation) = if let Some((previous_id, previous_generation, _)) = previous {
                (
                    previous_id,
                    if new_or_resized {
                        previous_generation
                            .checked_add(1)
                            .ok_or(OrderedPlanError::IdentifierExhausted)?
                    } else {
                        previous_generation
                    },
                )
            } else {
                if self.buffer_id_limit != 0 && self.pending_next_buffer_id >= self.buffer_id_limit
                {
                    return Err(OrderedPlanError::IdentifierExhausted);
                }
                self.pending_next_buffer_id = self
                    .pending_next_buffer_id
                    .checked_add(1)
                    .ok_or(OrderedPlanError::IdentifierExhausted)?;
                (self.pending_next_buffer_id, 1)
            };
            if checkpoint || new_or_resized {
                reserve(&mut self.patches, 1)?;
                self.patches.push(PatchRecord {
                    opcode: PATCH_ALLOCATE_OR_RESIZE,
                    buffer_id: id,
                    buffer_generation: generation,
                    byte_length: capacity
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                    ..PatchRecord::default()
                });
                push_pending_allocation(
                    &mut self.pending_allocations,
                    id,
                    generation,
                    key.program_id,
                    schema,
                    capacity,
                )?;
                if new_or_resized
                    && let Some((previous_id, previous_generation, previous_length)) = previous
                {
                    reserve(&mut self.retirements, 1)?;
                    self.retirements.push(RetirementRecord {
                        kind: RETIRE_BUFFER,
                        id: previous_id,
                        generation: previous_generation,
                        byte_length: previous_length as u32,
                        ..RetirementRecord::default()
                    });
                }
            }
            self.pending_batches[batch_index].buffer_ids[schema_index] = id;
            self.pending_batches[batch_index].buffer_generations[schema_index] = generation;
        }

        self.write_changed_ranges(
            codec,
            capability_set,
            capability,
            input,
            program,
            prior,
            self.pending_batches[batch_index],
            changed_inputs
                .and_then(|inputs| {
                    codec.buffers_without_inputs(
                        capability_set,
                        key.technique,
                        key.program_variant,
                        inputs.f32_fields,
                        inputs.u32_fields,
                    )
                })
                .unwrap_or(0),
        )?;
        if let Some(prior) = prior
            && required < prior.instance_count
        {
            reserve(&mut self.retirements, usize::from(prior.buffer_count))?;
            for buffer in &self.buffers[range(prior.buffer_start, u32::from(prior.buffer_count))?] {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_SLOT_RANGE,
                    id: buffer.id,
                    generation: buffer.generation,
                    byte_offset: required
                        .checked_mul(u32::from(buffer.schema.stride))
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                    byte_length: (prior.instance_count - required)
                        .checked_mul(u32::from(buffer.schema.stride))
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                    ..RetirementRecord::default()
                });
            }
        }
        self.pending_batches[batch_index].patch_end = self.patches.len();
        self.pending_batches[batch_index].state.buffer_count = u16::try_from(program.buffers.len())
            .map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn write_changed_ranges(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        capability: &crate::engine::codec::CapabilitySet,
        input: OrderedPlanInput<'_>,
        program: &crate::engine::codec::ProgramDescriptor,
        prior: Option<BatchState>,
        pending: PendingBatch,
        unchanged_buffers: u32,
    ) -> Result<(), OrderedPlanError> {
        let next_instances = self
            .pending_instances
            .range(range(
                pending.state.instance_start,
                pending.state.instance_count,
            )?)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let prior_instances = match prior {
            Some(batch) => self
                .instances
                .range(range(batch.instance_start, batch.instance_count)?)
                .ok_or(OrderedPlanError::InvalidIdentity)?,
            None => self
                .instances
                .range(0..0)
                .ok_or(OrderedPlanError::InvalidIdentity)?,
        };
        let batch = BatchWrite {
            codec,
            capability_set,
            capability,
            input,
            program,
            prior,
            pending,
            replace: pending.allocation_start.is_some(),
            unchanged_buffers,
            comparable_codec: self.codec_fingerprint == codec.fingerprint()
                && self.capability_set == capability_set.0,
            old_buffers: &self.buffers,
            retained_input_slots: &self.retained_input_slots,
            prior_instances: &prior_instances,
            next_instances: &next_instances,
        };
        batch.collect_buffer_ranges(&self.changed_ranges, &mut self.buffer_ranges)?;
        collect_range_jobs(
            &mut self.range_jobs,
            &self.buffer_ranges,
            program.buffers.len(),
            &mut self.sort_pairs,
        )?;
        let mut output = BatchWriteOutput {
            payload: &mut self.payload,
            patches: &mut self.patches,
            pending_allocations: &mut self.pending_allocations,
        };
        for job in self.range_jobs.iter().copied() {
            batch.write_job(job, &mut output)?;
        }
        Ok(())
    }

    pub(super) fn prepare_removed_batches(&mut self) -> Result<(), OrderedPlanError> {
        for batch in &self.batches {
            if self
                .pending_batches
                .iter()
                .any(|pending| pending.state.key == batch.key)
            {
                continue;
            }
            reserve(&mut self.retirements, usize::from(batch.buffer_count) + 1)?;
            let resource_remains = self.pending_batches.iter().any(|pending| {
                pending.state.key.resource_id == batch.key.resource_id
                    && pending.state.key.resource_generation == batch.key.resource_generation
            });
            let resource_retired = self.retirements.iter().any(|retirement| {
                retirement.kind == RETIRE_RESOURCE
                    && retirement.id == batch.key.resource_id
                    && retirement.generation == batch.key.resource_generation
            });
            // Decoration batches are resource-free and publish no resource lifecycle
            // (see the matching guard on the publication path), so they have no
            // resource to retire either. Emitting one anyway produces a retirement
            // record with id 0, which the plan wire rejects as malformed.
            if batch.key.resource_id != 0 && !resource_remains && !resource_retired {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_RESOURCE,
                    id: batch.key.resource_id,
                    generation: batch.key.resource_generation,
                    ..RetirementRecord::default()
                });
            }
            for buffer in &self.buffers[range(batch.buffer_start, u32::from(batch.buffer_count))?] {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_BUFFER,
                    id: buffer.id,
                    generation: buffer.generation,
                    byte_length: buffer.bytes.len() as u32,
                    ..RetirementRecord::default()
                });
            }
        }
        Ok(())
    }
}

pub(super) fn batch_key(
    program: &crate::engine::codec::ProgramDescriptor,
    glyph: OrderedGlyph,
) -> BatchKey {
    BatchKey {
        technique: glyph.technique,
        program_variant: glyph.program_variant,
        program_id: program.id.0,
        resource_id: glyph.resource_id,
        resource_generation: glyph.resource_generation,
        resource_kind: glyph.resource_kind,
        storage_key_mask: program.storage_key_mask,
        resource_reference: glyph.resource_reference,
        material_id: if program.storage_key_mask & BATCH_MATERIAL != 0 {
            glyph.material_id
        } else {
            0
        },
        clip_id: if program.storage_key_mask & crate::engine::codec::BATCH_CLIP != 0 {
            glyph.clip_id
        } else {
            0
        },
        depth_key: if program.storage_key_mask & crate::engine::codec::BATCH_DEPTH != 0 {
            glyph.depth_key
        } else {
            0
        },
    }
}

pub(super) fn batch_key_matches(key: BatchKey, glyph: OrderedGlyph) -> bool {
    key.technique == glyph.technique
        && key.program_variant == glyph.program_variant
        && key.resource_id == glyph.resource_id
        && key.resource_generation == glyph.resource_generation
        && key.resource_kind == glyph.resource_kind
        && key.resource_reference == glyph.resource_reference
        && (key.storage_key_mask & BATCH_MATERIAL == 0 || key.material_id == glyph.material_id)
        && (key.storage_key_mask & crate::engine::codec::BATCH_CLIP == 0
            || key.clip_id == glyph.clip_id)
        && (key.storage_key_mask & crate::engine::codec::BATCH_DEPTH == 0
            || key.depth_key == glyph.depth_key)
}
