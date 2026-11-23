//! Compiling resource bindings for the plan's batches.

use super::*;

impl OrderedPlanCompiler {
    pub(super) fn compile_bindings(
        &mut self,
        context: PrepareContext<'_>,
        retained_topology: bool,
    ) -> Result<(), OrderedPlanError> {
        if retained_topology
            && self.committed_order_independent == Some(context.input.order_independent)
            && !self.bindings_dirty
            && self.retained_storage_bindings_match()?
        {
            self.reuse_live_bindings = true;
            self.retained_host_topology = !context.checkpoint;
            #[cfg(test)]
            {
                self.retained_binding_compilation_skips += 1;
            }
            return Ok(());
        }
        for batch_index in 0..self.pending_batches.len() {
            let batch = self.pending_batches[batch_index];
            let program = context
                .codec
                .program(
                    context.capability_set,
                    batch.state.key.technique,
                    batch.state.key.program_variant,
                )
                .ok_or(OrderedPlanError::ProgramMissing)?;
            if usize::from(batch.state.buffer_count)
                > usize::from(context.capability.max_buffers_per_draw)
            {
                return Err(OrderedPlanError::CapacityExceeded);
            }
            let buffer_start = self.plan_buffers.len();
            reserve(&mut self.plan_buffers, program.buffers.len())?;
            for (schema_index, schema) in program.buffers.iter().copied().enumerate() {
                self.plan_buffers.push(BufferRecord {
                    id: batch.buffer_ids[schema_index],
                    generation: batch.buffer_generations[schema_index],
                    program_id: batch.state.key.program_id,
                    codec_buffer_id: schema.id.0,
                    scalar_type: schema.scalar as u8,
                    vector_width: schema.vector_width,
                    strategy: BUFFER_ORDERED_DIRECT,
                    flags: schema.usage as u16,
                    live_records: batch.state.instance_count,
                    capacity_records: batch.capacity,
                    byte_length: batch
                        .capacity
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                });
            }
            self.pending_batches[batch_index].state.buffer_start =
                u32::try_from(buffer_start).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        }

        // Admission preserves first-occurrence batch order; every row in a batch shares
        // this resource identity, including the metadata checked for conflicting uses.
        for batch in &self.pending_batches {
            let key = batch.state.key;
            // Decoration records are resource-free and publish no resource lifecycle.
            if key.resource_id == 0 && key.resource_kind == 0 {
                continue;
            }
            if let Some(resource) = self.resources.iter().find(|resource| {
                resource.id == key.resource_id && resource.generation == key.resource_generation
            }) {
                if resource.technique_id != key.technique.0
                    || resource.resource_kind != key.resource_kind
                    || resource.reference_id != key.resource_reference
                {
                    return Err(OrderedPlanError::InvalidResource);
                }
                continue;
            }
            reserve(&mut self.resources, 1)?;
            let existing = self.batches.iter().any(|batch| {
                batch.key.resource_id == key.resource_id
                    && batch.key.resource_generation == key.resource_generation
            });
            self.resources.push(ResourceRecord {
                id: key.resource_id,
                generation: key.resource_generation,
                technique_id: key.technique.0,
                resource_kind: key.resource_kind,
                action: if context.checkpoint || !existing {
                    RESOURCE_ACTION_CREATE
                } else {
                    RESOURCE_ACTION_RETAIN
                },
                reference_id: key.resource_reference,
                ..ResourceRecord::default()
            });
        }

        if context.capability.max_resources_per_draw < 1 {
            return Err(OrderedPlanError::CapacityExceeded);
        }
        let reuse_eligible = retained_topology
            && !context.checkpoint
            && context.changed_intervals.is_some()
            && self.committed_order_independent == Some(context.input.order_independent);
        let retained_storage = if reuse_eligible {
            Some(self.retained_storage_bindings_match()?)
        } else {
            None
        };
        let reuse_clean_spans = retained_storage == Some(true);
        self.compile_draw_spans(context, reuse_clean_spans)?;
        let retained_storage = match retained_storage {
            Some(matches) => matches,
            None => self.retained_storage_bindings_match()?,
        };
        let retained_draws = retained_storage
            && self.draws.len() == self.live_draws.len()
            && self.draws.iter().zip(&self.live_draws).all(|(next, live)| {
                DrawRecord {
                    id: next.id,
                    ..*live
                } == *next
            });
        self.retained_host_topology = !context.checkpoint
            && retained_draws
            && self.primitives.len() == self.live_primitives.len()
            && self
                .primitives
                .iter()
                .zip(&self.live_primitives)
                .all(|(next, live)| {
                    // Identity, semantic inspection and bounds do not alter physical draw bindings.
                    PrimitiveRecord {
                        id: next.id,
                        semantic_id: next.semantic_id,
                        inline_start: next.inline_start,
                        block_start: next.block_start,
                        inline_extent: next.inline_extent,
                        block_extent: next.block_extent,
                        ..*live
                    } == *next
                });
        self.publish_bindings = context.checkpoint
            || !retained_draws
            || self.draws != self.live_draws
            || self.primitives != self.live_primitives;
        Ok(())
    }

    pub(super) fn retained_storage_bindings_match(&self) -> Result<bool, OrderedPlanError> {
        if !self.retirements.is_empty() || self.pending_batches.len() != self.batches.len() {
            return Ok(false);
        }
        for (batch_index, pending) in self.pending_batches.iter().enumerate() {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.retained_storage_match_batch_visits += 1
            });
            let Some(committed) = self.batches.get(batch_index) else {
                return Ok(false);
            };
            if pending.prior_index != Some(batch_index as u32)
                || pending.state != *committed
                || usize::from(committed.buffer_count)
                    > pending
                        .buffer_ids
                        .len()
                        .min(pending.buffer_generations.len())
            {
                return Ok(false);
            }
            let buffers = self
                .buffers
                .get(range(
                    committed.buffer_start,
                    u32::from(committed.buffer_count),
                )?)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            if buffers.iter().enumerate().any(|(buffer_index, buffer)| {
                pending.buffer_ids[buffer_index] != buffer.id
                    || pending.buffer_generations[buffer_index] != buffer.generation
                    || pending.capacity != buffer.capacity
            }) {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
