//! Retained ordered-direct physical storage and invalidation-directed patch planning.
//!
//! The planner compares stable semantic identities and caller-owned content revisions. It never
//! scans physical buffers to discover changes. Preparation writes only scratch state and can be
//! aborted; committed CPU mirrors change only after the immutable plan has been serialized.

use alloc::vec::Vec;
use core::{mem, slice};

use super::{
    policy::{
        ALLOCATION_ORDERED_DIRECT, BufferSchema, CapabilitySetId, PhysicalBufferMut,
        PolicyExecutionError, SemanticInputBatch, TechniqueId, ValidatedPolicy,
    },
    render_plan::{
        BUFFER_ORDERED_DIRECT, BufferRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_WRITE, PatchRecord,
        RESOURCE_ACTION_CREATE, RESOURCE_ACTION_RETAIN, RETIRE_BUFFER, RETIRE_RESOURCE,
        RETIRE_SLOT_RANGE, RenderPlanView, ResourceRecord, RetirementRecord,
    },
};

const MAX_PHYSICAL_BUFFERS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrderedGlyph {
    pub stable_id: u32,
    pub content_revision: u32,
    pub technique: TechniqueId,
    pub variant: u16,
    pub resource_id: u32,
    pub resource_generation: u32,
    pub resource_kind: u16,
    pub resource_reference: u32,
}

#[derive(Clone, Copy)]
pub struct OrderedPlanInput<'a> {
    pub glyphs: &'a [OrderedGlyph],
    pub f32_fields: &'a [&'a [f32]],
    pub u32_fields: &'a [&'a [u32]],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderedPlanError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    CapabilitySetMissing,
    ProgramMissing,
    UnsupportedStrategy,
    InvalidInputShape,
    InvalidIdentity,
    DuplicateIdentity,
    InvalidResource,
    CapacityExceeded,
    IdentifierExhausted,
    ArithmeticOverflow,
    PolicyExecution(PolicyExecutionError),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatchKey {
    technique: TechniqueId,
    variant: u16,
    program_id: u32,
    resource_id: u32,
    resource_generation: u32,
    resource_kind: u16,
    resource_reference: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct InstanceState {
    stable_id: u32,
    content_revision: u32,
    input_index: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatchState {
    key: BatchKey,
    instance_start: u32,
    instance_count: u32,
    buffer_start: u32,
    buffer_count: u16,
}

struct PhysicalBufferState {
    id: u32,
    generation: u32,
    program_id: u32,
    schema: BufferSchema,
    capacity: u32,
    bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingBatch {
    state: BatchState,
    prior_index: Option<u32>,
    changed: bool,
    buffer_ids: [u32; MAX_PHYSICAL_BUFFERS],
    buffer_generations: [u32; MAX_PHYSICAL_BUFFERS],
}

struct PendingAllocation {
    state: PhysicalBufferState,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RecordRange {
    start: u32,
    end: u32,
}

#[derive(Clone, Copy)]
struct PrepareContext<'a> {
    policy: &'a ValidatedPolicy,
    capability_set: CapabilitySetId,
    capability: &'a super::policy::CapabilitySet,
    input: OrderedPlanInput<'a>,
    checkpoint: bool,
    publication_generation: u32,
}

#[derive(Default)]
pub struct OrderedPlanCompiler {
    batches: Vec<BatchState>,
    instances: Vec<InstanceState>,
    buffers: Vec<PhysicalBufferState>,
    spare_batches: Vec<BatchState>,
    spare_buffers: Vec<PhysicalBufferState>,
    pending_batches: Vec<PendingBatch>,
    pending_instances: Vec<InstanceState>,
    pending_allocations: Vec<PendingAllocation>,
    input_batches: Vec<u32>,
    identity_keys: Vec<u32>,
    identity_epochs: Vec<u32>,
    identity_epoch: u32,
    batch_cursors: Vec<u32>,
    changed_ranges: Vec<RecordRange>,
    resources: Vec<ResourceRecord>,
    plan_buffers: Vec<BufferRecord>,
    patches: Vec<PatchRecord>,
    retirements: Vec<RetirementRecord>,
    payload: Vec<u8>,
    next_buffer_id: u32,
    pending_next_buffer_id: u32,
    prepared: bool,
}

impl OrderedPlanCompiler {
    pub fn prepare(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
    ) -> Result<(), OrderedPlanError> {
        if self.prepared {
            return Err(OrderedPlanError::AlreadyPrepared);
        }
        if publication_generation == 0 {
            return Err(OrderedPlanError::InvalidIdentity);
        }
        let capability = policy
            .capability_set(capability_set)
            .ok_or(OrderedPlanError::CapabilitySetMissing)?;
        validate_input(input)?;
        self.reset_pending();
        reserve(&mut self.input_batches, input.glyphs.len())?;
        reserve(&mut self.pending_instances, input.glyphs.len())?;
        self.input_batches.resize(input.glyphs.len(), 0);
        self.prepare_identity_set(input.glyphs.len())?;

        for (input_index, glyph) in input.glyphs.iter().copied().enumerate() {
            validate_glyph(glyph)?;
            if !self.insert_identity(glyph.stable_id) {
                return Err(OrderedPlanError::DuplicateIdentity);
            }
            let program = policy
                .program(capability_set, glyph.technique, glyph.variant)
                .ok_or(OrderedPlanError::ProgramMissing)?;
            if program.allocation_strategy != ALLOCATION_ORDERED_DIRECT {
                return Err(OrderedPlanError::UnsupportedStrategy);
            }
            let resource_bit = 1_u32
                .checked_shl(u32::from(glyph.resource_kind - 1))
                .ok_or(OrderedPlanError::InvalidResource)?;
            if program.resource_kind_mask & resource_bit == 0 {
                return Err(OrderedPlanError::InvalidResource);
            }
            let key = BatchKey {
                technique: glyph.technique,
                variant: glyph.variant,
                program_id: program.id.0,
                resource_id: glyph.resource_id,
                resource_generation: glyph.resource_generation,
                resource_kind: glyph.resource_kind,
                resource_reference: glyph.resource_reference,
            };
            let batch_index = match self
                .pending_batches
                .iter()
                .position(|batch| batch.state.key == key)
            {
                Some(index) => index,
                None => {
                    reserve(&mut self.pending_batches, 1)?;
                    let prior_index = self
                        .batches
                        .iter()
                        .position(|batch| batch.key == key)
                        .map(|index| index as u32);
                    self.pending_batches.push(PendingBatch {
                        state: BatchState {
                            key,
                            instance_start: 0,
                            instance_count: 0,
                            buffer_start: 0,
                            buffer_count: 0,
                        },
                        prior_index,
                        changed: checkpoint || prior_index.is_none(),
                        buffer_ids: [0; MAX_PHYSICAL_BUFFERS],
                        buffer_generations: [0; MAX_PHYSICAL_BUFFERS],
                    });
                    self.pending_batches.len() - 1
                }
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

        self.layout_pending_instances(input)?;
        self.pending_next_buffer_id = self.next_buffer_id;
        let context = PrepareContext {
            policy,
            capability_set,
            capability,
            input,
            checkpoint,
            publication_generation,
        };
        for batch_index in 0..self.pending_batches.len() {
            self.prepare_batch(context, batch_index)?;
        }
        self.prepare_removed_batches(publication_generation)?;
        self.prepared = true;
        Ok(())
    }

    pub fn plan_view(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, OrderedPlanError> {
        if !self.prepared {
            return Err(OrderedPlanError::NotPrepared);
        }
        Ok(RenderPlanView {
            policy_handle,
            capability_set: capability_set.0,
            policy_fingerprint,
            resources: &self.resources,
            buffers: &self.plan_buffers,
            patches: &self.patches,
            retirements: &self.retirements,
            payload: &self.payload,
            ..RenderPlanView::default()
        })
    }

    pub fn commit(&mut self) -> Result<(), OrderedPlanError> {
        if !self.prepared {
            return Err(OrderedPlanError::NotPrepared);
        }
        mem::swap(&mut self.buffers, &mut self.spare_buffers);
        self.buffers.clear();
        for pending_index in 0..self.pending_batches.len() {
            let pending = self.pending_batches[pending_index];
            for buffer_index in 0..usize::from(pending.state.buffer_count) {
                let id = pending.buffer_ids[buffer_index];
                let generation = pending.buffer_generations[buffer_index];
                if let Some(allocation) =
                    take_allocation(&mut self.pending_allocations, id, generation)
                {
                    self.buffers.push(allocation.state);
                    continue;
                }
                let position = self
                    .spare_buffers
                    .iter()
                    .position(|buffer| buffer.id == id && buffer.generation == generation)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                let mut buffer = self.spare_buffers.swap_remove(position);
                apply_writes(&mut buffer, &self.patches, &self.payload)?;
                self.buffers.push(buffer);
            }
        }
        self.spare_buffers.clear();

        mem::swap(&mut self.batches, &mut self.spare_batches);
        self.batches.clear();
        for pending in &self.pending_batches {
            let mut state = pending.state;
            state.buffer_start = u32::try_from(self.batches_buffer_start(self.batches.len()))
                .map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
            self.batches.push(state);
        }
        self.spare_batches.clear();
        mem::swap(&mut self.instances, &mut self.pending_instances);
        self.pending_instances.clear();
        self.next_buffer_id = self.pending_next_buffer_id;
        self.prepared = false;
        Ok(())
    }

    pub fn abort(&mut self) {
        self.prepared = false;
        self.pending_allocations.clear();
    }

    pub fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        self.buffers
            .iter()
            .find(|buffer| buffer.id == id)
            .map(|buffer| buffer.bytes.as_slice())
    }

    pub fn buffer_schema(&self, id: u32) -> Option<(u32, BufferSchema)> {
        self.buffers
            .iter()
            .find(|buffer| buffer.id == id)
            .map(|buffer| (buffer.program_id, buffer.schema))
    }

    fn reset_pending(&mut self) {
        self.pending_batches.clear();
        self.pending_instances.clear();
        self.pending_allocations.clear();
        self.batch_cursors.clear();
        self.changed_ranges.clear();
        self.resources.clear();
        self.plan_buffers.clear();
        self.patches.clear();
        self.retirements.clear();
        self.payload.clear();
    }

    fn prepare_identity_set(&mut self, count: usize) -> Result<(), OrderedPlanError> {
        let required = count
            .checked_mul(2)
            .and_then(|value| value.checked_next_power_of_two())
            .unwrap_or(usize::MAX)
            .max(8);
        if required == usize::MAX {
            return Err(OrderedPlanError::ArithmeticOverflow);
        }
        if self.identity_keys.len() < required {
            let additional_keys = required - self.identity_keys.len();
            let additional_epochs = required - self.identity_epochs.len();
            reserve(&mut self.identity_keys, additional_keys)?;
            reserve(&mut self.identity_epochs, additional_epochs)?;
            self.identity_keys.resize(required, 0);
            self.identity_epochs.resize(required, 0);
        }
        self.identity_epoch = match self.identity_epoch.checked_add(1) {
            Some(epoch) => epoch,
            None => {
                self.identity_epochs.fill(0);
                1
            }
        };
        Ok(())
    }

    fn insert_identity(&mut self, identity: u32) -> bool {
        let mask = self.identity_keys.len() - 1;
        let mut slot = (identity.wrapping_mul(0x9e37_79b1) as usize) & mask;
        loop {
            if self.identity_epochs[slot] != self.identity_epoch {
                self.identity_epochs[slot] = self.identity_epoch;
                self.identity_keys[slot] = identity;
                return true;
            }
            if self.identity_keys[slot] == identity {
                return false;
            }
            slot = (slot + 1) & mask;
        }
    }

    fn layout_pending_instances(
        &mut self,
        input: OrderedPlanInput<'_>,
    ) -> Result<(), OrderedPlanError> {
        reserve(&mut self.batch_cursors, self.pending_batches.len())?;
        let mut cursor = 0_u32;
        for batch in &mut self.pending_batches {
            batch.state.instance_start = cursor;
            cursor = cursor
                .checked_add(batch.state.instance_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            self.batch_cursors.push(batch.state.instance_start);
        }
        self.pending_instances
            .resize(input.glyphs.len(), InstanceState::default());
        for (input_index, glyph) in input.glyphs.iter().enumerate() {
            let batch = self.input_batches[input_index] as usize;
            let destination = self.batch_cursors[batch] as usize;
            self.pending_instances[destination] = InstanceState {
                stable_id: glyph.stable_id,
                content_revision: glyph.content_revision,
                input_index: input_index as u32,
            };
            self.batch_cursors[batch] = self.batch_cursors[batch]
                .checked_add(1)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        }
        Ok(())
    }

    fn prepare_batch(
        &mut self,
        context: PrepareContext<'_>,
        batch_index: usize,
    ) -> Result<(), OrderedPlanError> {
        let PrepareContext {
            policy,
            capability_set,
            capability,
            input,
            checkpoint,
            publication_generation,
        } = context;
        let pending = self.pending_batches[batch_index];
        let key = pending.state.key;
        let program = policy
            .program(capability_set, key.technique, key.variant)
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

        let buffer_start = self.plan_buffers.len();
        let new_or_resized = prior.is_none() || capacity != prior_capacity;
        let prior_instances = match prior {
            Some(batch) => self
                .instances
                .get(range(batch.instance_start, batch.instance_count)?)
                .ok_or(OrderedPlanError::InvalidIdentity)?,
            None => &[],
        };
        let next_instances = &self.pending_instances
            [range(pending.state.instance_start, pending.state.instance_count)?];
        collect_changed_ranges(
            &mut self.changed_ranges,
            prior_instances,
            next_instances,
            checkpoint || new_or_resized,
        )?;
        coalesce_ranges(&mut self.changed_ranges, program, capability, required)?;
        if !self.changed_ranges.is_empty()
            || prior.is_some_and(|old| old.instance_count != required)
        {
            self.pending_batches[batch_index].changed = true;
        }

        if self.pending_batches[batch_index].changed {
            let existing_resource = self.batches.iter().any(|batch| {
                batch.key.resource_id == key.resource_id
                    && batch.key.resource_generation == key.resource_generation
            });
            if !self.resources.iter().any(|resource| {
                resource.id == key.resource_id && resource.generation == key.resource_generation
            }) {
                reserve(&mut self.resources, 1)?;
                self.resources.push(ResourceRecord {
                    id: key.resource_id,
                    generation: key.resource_generation,
                    technique_id: key.technique.0,
                    resource_kind: key.resource_kind,
                    action: if checkpoint || !existing_resource {
                        RESOURCE_ACTION_CREATE
                    } else {
                        RESOURCE_ACTION_RETAIN
                    },
                    reference_id: key.resource_reference,
                    ..ResourceRecord::default()
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
                self.pending_next_buffer_id = self
                    .pending_next_buffer_id
                    .checked_add(1)
                    .ok_or(OrderedPlanError::IdentifierExhausted)?;
                (self.pending_next_buffer_id, 1)
            };
            if self.pending_batches[batch_index].changed {
                reserve(&mut self.plan_buffers, 1)?;
                self.plan_buffers.push(BufferRecord {
                    id,
                    generation,
                    program_id: key.program_id,
                    policy_buffer_id: schema.id.0,
                    scalar_type: schema.scalar as u8,
                    vector_width: schema.vector_width,
                    strategy: BUFFER_ORDERED_DIRECT,
                    flags: schema.usage as u16,
                    live_records: required,
                    capacity_records: capacity,
                    byte_length: capacity
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                    order_buffer_id: 0,
                });
            }
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
                self.prepare_allocation(id, generation, key.program_id, schema, capacity)?;
                if new_or_resized
                    && let Some((previous_id, previous_generation, previous_length)) = previous
                {
                    reserve(&mut self.retirements, 1)?;
                    self.retirements.push(RetirementRecord {
                        kind: RETIRE_BUFFER,
                        id: previous_id,
                        generation: previous_generation,
                        after_publication_generation: publication_generation,
                        byte_length: previous_length as u32,
                        ..RetirementRecord::default()
                    });
                }
            }
            self.pending_batches[batch_index].buffer_ids[schema_index] = id;
            self.pending_batches[batch_index].buffer_generations[schema_index] = generation;
        }

        self.write_changed_ranges(
            policy,
            capability_set,
            capability,
            input,
            program,
            prior,
            pending,
            checkpoint || new_or_resized,
            buffer_start,
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
                    after_publication_generation: publication_generation,
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
        self.pending_batches[batch_index].state.buffer_start =
            u32::try_from(buffer_start).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        self.pending_batches[batch_index].state.buffer_count = u16::try_from(program.buffers.len())
            .map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn write_changed_ranges(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        capability: &super::policy::CapabilitySet,
        input: OrderedPlanInput<'_>,
        program: &super::policy::ProgramDescriptor,
        prior: Option<BatchState>,
        pending: PendingBatch,
        replace: bool,
        plan_buffer_start: usize,
    ) -> Result<(), OrderedPlanError> {
        let record_alignment = record_alignment(program, capability.update_alignment)?;
        let next_instances = &self.pending_instances
            [range(pending.state.instance_start, pending.state.instance_count)?];
        let prior_instances = match prior {
            Some(batch) => self
                .instances
                .get(range(batch.instance_start, batch.instance_count)?)
                .ok_or(OrderedPlanError::InvalidIdentity)?,
            None => &[],
        };
        for range_index in 0..self.changed_ranges.len() {
            let changed = self.changed_ranges[range_index];
            let aligned = align_record_range(changed, record_alignment)?;
            let count = aligned.end - aligned.start;
            let mut payload_starts = [0_usize; MAX_PHYSICAL_BUFFERS];
            for (schema_index, schema) in program.buffers.iter().enumerate() {
                let byte_count = usize::try_from(count)
                    .ok()
                    .and_then(|value| value.checked_mul(schema.stride()))
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                let payload_start = self.payload.len();
                reserve(&mut self.payload, byte_count)?;
                self.payload.resize(payload_start + byte_count, 0);
                payload_starts[schema_index] = payload_start;
                if !replace && let Some(prior) = prior {
                    let old_buffer = self
                        .buffers
                        .get(prior.buffer_start as usize + schema_index)
                        .ok_or(OrderedPlanError::InvalidIdentity)?;
                    let source_start = aligned.start as usize * schema.stride();
                    let source_end = source_start + byte_count;
                    if source_end <= old_buffer.bytes.len() {
                        self.payload[payload_start..payload_start + byte_count]
                            .copy_from_slice(&old_buffer.bytes[source_start..source_end]);
                    }
                }
            }

            let mut slot = aligned.start;
            while slot < aligned.end.min(pending.state.instance_count) {
                if instance_unchanged(prior_instances, next_instances, slot, replace) {
                    slot += 1;
                    continue;
                }
                let input_start = next_instances[slot as usize].input_index;
                let run_start = slot;
                slot += 1;
                while slot < aligned.end.min(pending.state.instance_count)
                    && !instance_unchanged(prior_instances, next_instances, slot, replace)
                    && next_instances[slot as usize].input_index == input_start + (slot - run_start)
                {
                    slot += 1;
                }
                execute_run(
                    policy,
                    capability_set,
                    program,
                    input,
                    input_start as usize,
                    slot - run_start,
                    run_start - aligned.start,
                    &mut self.payload,
                    &payload_starts,
                    count,
                )?;
            }

            for (schema_index, schema) in program.buffers.iter().enumerate() {
                let record = self
                    .plan_buffers
                    .get(plan_buffer_start + schema_index)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                let byte_length = count
                    .checked_mul(u32::from(schema.stride))
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                let destination_offset = aligned
                    .start
                    .checked_mul(u32::from(schema.stride))
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                reserve(&mut self.patches, 1)?;
                self.patches.push(PatchRecord {
                    opcode: PATCH_WRITE,
                    buffer_id: record.id,
                    buffer_generation: record.generation,
                    destination_offset,
                    byte_length,
                    payload_start: u32::try_from(payload_starts[schema_index])
                        .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                    ..PatchRecord::default()
                });
                if let Some(allocation) = self.pending_allocations.iter_mut().find(|allocation| {
                    allocation.state.id == record.id
                        && allocation.state.generation == record.generation
                }) {
                    let destination = destination_offset as usize;
                    let source = payload_starts[schema_index];
                    let destination = allocation
                        .state
                        .bytes
                        .get_mut(destination..destination + byte_length as usize)
                        .ok_or(OrderedPlanError::InvalidIdentity)?;
                    let source = self
                        .payload
                        .get(source..source + byte_length as usize)
                        .ok_or(OrderedPlanError::InvalidIdentity)?;
                    destination.copy_from_slice(source);
                }
            }
        }
        Ok(())
    }

    fn prepare_allocation(
        &mut self,
        id: u32,
        generation: u32,
        program_id: u32,
        schema: BufferSchema,
        capacity: u32,
    ) -> Result<(), OrderedPlanError> {
        let length = usize::try_from(capacity)
            .ok()
            .and_then(|value| value.checked_mul(schema.stride()))
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(length)
            .map_err(|_| OrderedPlanError::AllocationFailed)?;
        bytes.resize(length, 0);
        reserve(&mut self.pending_allocations, 1)?;
        self.pending_allocations.push(PendingAllocation {
            state: PhysicalBufferState {
                id,
                generation,
                program_id,
                schema,
                capacity,
                bytes,
            },
        });
        Ok(())
    }

    fn prepare_removed_batches(
        &mut self,
        publication_generation: u32,
    ) -> Result<(), OrderedPlanError> {
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
            if !resource_remains && !resource_retired {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_RESOURCE,
                    id: batch.key.resource_id,
                    generation: batch.key.resource_generation,
                    after_publication_generation: publication_generation,
                    ..RetirementRecord::default()
                });
            }
            for buffer in &self.buffers[range(batch.buffer_start, u32::from(batch.buffer_count))?] {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_BUFFER,
                    id: buffer.id,
                    generation: buffer.generation,
                    after_publication_generation: publication_generation,
                    byte_length: buffer.bytes.len() as u32,
                    ..RetirementRecord::default()
                });
            }
        }
        Ok(())
    }

    fn batches_buffer_start(&self, batch_count: usize) -> usize {
        self.pending_batches[..batch_count]
            .iter()
            .map(|batch| usize::from(batch.state.buffer_count))
            .sum()
    }
}

fn validate_input(input: OrderedPlanInput<'_>) -> Result<(), OrderedPlanError> {
    if u32::try_from(input.glyphs.len()).is_err() {
        return Err(OrderedPlanError::InvalidInputShape);
    }
    if input
        .f32_fields
        .iter()
        .any(|field| field.len() != input.glyphs.len())
        || input
            .u32_fields
            .iter()
            .any(|field| field.len() != input.glyphs.len())
    {
        return Err(OrderedPlanError::InvalidInputShape);
    }
    Ok(())
}

fn validate_glyph(glyph: OrderedGlyph) -> Result<(), OrderedPlanError> {
    if glyph.stable_id == 0 || glyph.content_revision == 0 {
        return Err(OrderedPlanError::InvalidIdentity);
    }
    if glyph.resource_id == 0
        || glyph.resource_generation == 0
        || !(1..=32).contains(&glyph.resource_kind)
    {
        return Err(OrderedPlanError::InvalidResource);
    }
    Ok(())
}

fn collect_changed_ranges(
    ranges: &mut Vec<RecordRange>,
    previous: &[InstanceState],
    next: &[InstanceState],
    replace: bool,
) -> Result<(), OrderedPlanError> {
    ranges.clear();
    if next.is_empty() {
        return Ok(());
    }
    if replace {
        ranges.push(RecordRange {
            start: 0,
            end: next.len() as u32,
        });
        return Ok(());
    }
    let mut start = None;
    for (slot, next) in next.iter().enumerate() {
        let changed = previous.get(slot).is_none_or(|previous| {
            previous.stable_id != next.stable_id
                || previous.content_revision != next.content_revision
        });
        match (start, changed) {
            (None, true) => start = Some(slot as u32),
            (Some(first), false) => {
                reserve(ranges, 1)?;
                ranges.push(RecordRange {
                    start: first,
                    end: slot as u32,
                });
                start = None;
            }
            _ => {}
        }
    }
    if let Some(start) = start {
        reserve(ranges, 1)?;
        ranges.push(RecordRange {
            start,
            end: next.len() as u32,
        });
    }
    Ok(())
}

fn instance_unchanged(
    previous: &[InstanceState],
    next: &[InstanceState],
    slot: u32,
    replace: bool,
) -> bool {
    !replace
        && previous.get(slot as usize).is_some_and(|previous| {
            let next = next[slot as usize];
            previous.stable_id == next.stable_id
                && previous.content_revision == next.content_revision
        })
}

fn coalesce_ranges(
    ranges: &mut Vec<RecordRange>,
    program: &super::policy::ProgramDescriptor,
    capability: &super::policy::CapabilitySet,
    live_records: u32,
) -> Result<(), OrderedPlanError> {
    if ranges.is_empty() {
        return Ok(());
    }
    let bytes_per_record = program.buffers.iter().try_fold(0_u32, |total, schema| {
        total
            .checked_add(u32::from(schema.stride))
            .ok_or(OrderedPlanError::ArithmeticOverflow)
    })?;
    let accepted_gap = capability
        .coalesce_gap_bytes
        .max(capability.range_call_penalty_bytes);
    if ranges.len() > 1 {
        let mut write = 0;
        for read in 1..ranges.len() {
            let gap = ranges[read]
                .start
                .saturating_sub(ranges[write].end)
                .saturating_mul(bytes_per_record);
            if gap <= accepted_gap {
                ranges[write].end = ranges[read].end;
            } else {
                write += 1;
                ranges[write] = ranges[read];
            }
        }
        ranges.truncate(write + 1);
    }
    if ranges.len() > usize::from(capability.fragmentation_budget) {
        let first = ranges[0].start;
        let last = ranges.last().ok_or(OrderedPlanError::InvalidIdentity)?.end;
        ranges.clear();
        ranges.push(RecordRange {
            start: first,
            end: last,
        });
    }
    let upload_records = ranges.iter().try_fold(0_u32, |total, range| {
        total
            .checked_add(range.end - range.start)
            .ok_or(OrderedPlanError::ArithmeticOverflow)
    })?;
    let upload_cost = upload_records
        .checked_mul(bytes_per_record)
        .and_then(|bytes| {
            bytes.checked_add(
                (ranges.len() as u32).saturating_mul(capability.range_call_penalty_bytes),
            )
        })
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    let full_bytes = live_records
        .checked_mul(bytes_per_record)
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    if upload_cost.saturating_mul(10_000)
        >= full_bytes.saturating_mul(u32::from(capability.whole_buffer_threshold_basis_points))
    {
        ranges.clear();
        ranges.push(RecordRange {
            start: 0,
            end: live_records,
        });
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn execute_run(
    policy: &ValidatedPolicy,
    capability_set: CapabilitySetId,
    program: &super::policy::ProgramDescriptor,
    input: OrderedPlanInput<'_>,
    input_index: usize,
    record_count: u32,
    output_record: u32,
    payload: &mut [u8],
    payload_starts: &[usize; MAX_PHYSICAL_BUFFERS],
    output_records: u32,
) -> Result<(), OrderedPlanError> {
    let input_end = input_index
        .checked_add(record_count as usize)
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    let mut f32_fields: [&[f32]; super::policy::MAX_REGISTERS] =
        [&[]; super::policy::MAX_REGISTERS];
    let mut u32_fields: [&[u32]; super::policy::MAX_REGISTERS] =
        [&[]; super::policy::MAX_REGISTERS];
    for (target, field) in f32_fields
        .iter_mut()
        .zip(input.f32_fields.iter())
        .take(usize::from(program.f32_input_count))
    {
        *target = &field[input_index..input_end];
    }
    for (target, field) in u32_fields
        .iter_mut()
        .zip(input.u32_fields.iter())
        .take(usize::from(program.u32_input_count))
    {
        *target = &field[input_index..input_end];
    }

    let mut outputs: [mem::MaybeUninit<PhysicalBufferMut<'_>>; MAX_PHYSICAL_BUFFERS] =
        [const { mem::MaybeUninit::uninit() }; MAX_PHYSICAL_BUFFERS];
    let base = payload.as_mut_ptr();
    for (index, schema) in program.buffers.iter().copied().enumerate() {
        let length = output_records as usize * schema.stride();
        // SAFETY: all payload segments were sized before this call, are mutually disjoint, and
        // `payload` cannot reallocate while these temporary views exist.
        let bytes = unsafe { slice::from_raw_parts_mut(base.add(payload_starts[index]), length) };
        outputs[index].write(PhysicalBufferMut { schema, bytes });
    }
    // SAFETY: the prefix contains exactly one initialized value per declared program buffer.
    let outputs = unsafe {
        slice::from_raw_parts_mut(
            outputs.as_mut_ptr().cast::<PhysicalBufferMut<'_>>(),
            program.buffers.len(),
        )
    };
    policy
        .execute(
            capability_set,
            program.technique,
            program.variant,
            SemanticInputBatch {
                f32_fields: &f32_fields[..usize::from(program.f32_input_count)],
                u32_fields: &u32_fields[..usize::from(program.u32_input_count)],
                record_count: record_count as usize,
            },
            output_record as usize,
            outputs,
        )
        .map_err(OrderedPlanError::PolicyExecution)
}

fn apply_writes(
    buffer: &mut PhysicalBufferState,
    patches: &[PatchRecord],
    payload: &[u8],
) -> Result<(), OrderedPlanError> {
    for patch in patches.iter().filter(|patch| {
        patch.opcode == PATCH_WRITE
            && patch.buffer_id == buffer.id
            && patch.buffer_generation == buffer.generation
    }) {
        let destination = patch.destination_offset as usize;
        let source = patch.payload_start as usize;
        let length = patch.byte_length as usize;
        let destination = buffer
            .bytes
            .get_mut(destination..destination + length)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let source = payload
            .get(source..source + length)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        destination.copy_from_slice(source);
    }
    Ok(())
}

fn take_allocation(
    allocations: &mut Vec<PendingAllocation>,
    id: u32,
    generation: u32,
) -> Option<PendingAllocation> {
    allocations
        .iter()
        .position(|allocation| {
            allocation.state.id == id && allocation.state.generation == generation
        })
        .map(|index| allocations.swap_remove(index))
}

fn grown_capacity(mut capacity: u32, required: u32) -> Result<u32, OrderedPlanError> {
    while capacity < required {
        capacity = capacity
            .checked_mul(2)
            .ok_or(OrderedPlanError::CapacityExceeded)?;
    }
    Ok(capacity)
}

fn record_alignment(
    program: &super::policy::ProgramDescriptor,
    byte_alignment: u32,
) -> Result<u32, OrderedPlanError> {
    program.buffers.iter().try_fold(1_u32, |records, schema| {
        let stride = u32::from(schema.stride);
        let divisor = gcd(byte_alignment, stride);
        lcm(records, byte_alignment / divisor)
    })
}

fn align_record_range(range: RecordRange, alignment: u32) -> Result<RecordRange, OrderedPlanError> {
    let start = range.start / alignment * alignment;
    let end = range
        .end
        .checked_add(alignment - 1)
        .map(|value| value / alignment * alignment)
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    Ok(RecordRange { start, end })
}

fn align_up(value: u32, alignment: u32) -> Result<u32, OrderedPlanError> {
    value
        .checked_add(alignment - 1)
        .map(|value| value / alignment * alignment)
        .ok_or(OrderedPlanError::ArithmeticOverflow)
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

fn lcm(left: u32, right: u32) -> Result<u32, OrderedPlanError> {
    left.checked_div(gcd(left, right))
        .and_then(|value| value.checked_mul(right))
        .ok_or(OrderedPlanError::ArithmeticOverflow)
}

fn range(start: u32, count: u32) -> Result<core::ops::Range<usize>, OrderedPlanError> {
    let end = start
        .checked_add(count)
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    Ok(start as usize..end as usize)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), OrderedPlanError> {
    values
        .try_reserve(additional)
        .map_err(|_| OrderedPlanError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::policy::{
        BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE,
        BufferId, CAP_ORDERED_DIRECT, CapabilitySet, Operation, PolicyDescriptor,
        ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType,
    };
    use crate::engine::render_plan_wire::plan_layout;
    use alloc::vec;

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const TECHNIQUE: TechniqueId = TechniqueId(1);

    #[test]
    fn ordered_direct_uses_identity_revisions_instead_of_scanning_physical_bytes() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let x = [1.0, 2.0, 3.0];
        let glyphs = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &policy, &glyphs, &x, true);
        let first = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(first.buffers.len(), 1);
        assert_eq!(first.patches.len(), 2);
        assert!(plan_layout(first).unwrap().byte_length > 144);
        compiler.commit().unwrap();

        let changed_x = [1.0, 20.0, 3.0];
        let changed = [glyph(1, 1), glyph(2, 2), glyph(3, 1)];
        prepare(&mut compiler, &policy, &changed, &changed_x, false);
        let delta = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 1);
        assert_eq!(delta.patches[0].destination_offset, 4);
        assert_eq!(delta.patches[0].byte_length, 4);
        assert_eq!(delta.payload.len(), 4);
        compiler.commit().unwrap();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 20.0);
    }

    #[test]
    fn insertion_rewrites_only_the_ordered_batch_suffix_and_abort_preserves_state() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &policy, &initial, &[1.0, 2.0, 3.0], true);
        compiler.commit().unwrap();

        let inserted = [glyph(1, 1), glyph(4, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &policy,
            &inserted,
            &[1.0, 4.0, 2.0, 3.0],
            false,
        );
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.patches[0].opcode, PATCH_WRITE);
        assert_eq!(plan.patches[0].destination_offset, 4);
        compiler.abort();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 2.0);
    }

    #[test]
    fn no_op_emits_nothing_and_tail_deletion_updates_only_live_metadata() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &policy, &initial, &[1.0, 2.0, 3.0], true);
        compiler.commit().unwrap();

        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[999.0, 999.0, 999.0],
            false,
        );
        let no_op = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert!(no_op.resources.is_empty());
        assert!(no_op.buffers.is_empty());
        assert!(no_op.patches.is_empty());
        assert!(no_op.payload.is_empty());
        compiler.commit().unwrap();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 0), 1.0);

        prepare(&mut compiler, &policy, &initial[..2], &[1.0, 2.0], false);
        let shrink = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(shrink.buffers[0].live_records, 2);
        assert!(shrink.patches.is_empty());
        assert_eq!(shrink.retirements.len(), 1);
        assert_eq!(shrink.retirements[0].byte_offset, 8);
        assert_eq!(shrink.retirements[0].byte_length, 4);
    }

    #[test]
    fn repeated_warm_updates_keep_every_glyph_scaled_scratch_capacity() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[1.0, 2.0, 3.0, 4.0],
            true,
        );
        compiler.commit().unwrap();
        let changed = [glyph(1, 1), glyph(2, 2), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &changed,
            &[1.0, 20.0, 3.0, 4.0],
            false,
        );
        compiler.commit().unwrap();
        let settled = capacities(&compiler);
        let changed_again = [glyph(1, 1), glyph(2, 3), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &changed_again,
            &[1.0, 21.0, 3.0, 4.0],
            false,
        );
        compiler.commit().unwrap();
        assert_eq!(capacities(&compiler), settled);
    }

    fn prepare(
        compiler: &mut OrderedPlanCompiler,
        policy: &ValidatedPolicy,
        glyphs: &[OrderedGlyph],
        x: &[f32],
        checkpoint: bool,
    ) {
        compiler
            .prepare(
                policy,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs,
                    f32_fields: &[x],
                    u32_fields: &[],
                },
                checkpoint,
                1,
            )
            .unwrap();
    }

    fn glyph(stable_id: u32, content_revision: u32) -> OrderedGlyph {
        OrderedGlyph {
            stable_id,
            content_revision,
            technique: TECHNIQUE,
            variant: 0,
            resource_id: 11,
            resource_generation: 1,
            resource_kind: 1,
            resource_reference: 99,
        }
    }

    fn policy() -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CAPABILITY,
                flags: CAP_ORDERED_DIRECT,
                max_buffer_bytes: 1024,
                update_alignment: 4,
                coalesce_gap_bytes: 0,
                range_call_penalty_bytes: 0,
                max_buffers_per_draw: 1,
                max_resources_per_draw: 1,
                max_indirect_draws: 0,
                fragmentation_budget: 8,
                whole_buffer_threshold_basis_points: 10_000,
            }],
            programs: vec![ProgramDescriptor {
                technique: TECHNIQUE,
                variant: 0,
                id: ProgramId(5),
                capability_set: CapabilitySetId(0),
                resource_kind_mask: 1,
                semantic_view_mask: 0,
                batch_key_mask: BATCH_PROGRAM | BATCH_RESOURCE | BATCH_ORDER,
                allocation_strategy: ALLOCATION_ORDERED_DIRECT,
                f32_input_count: 1,
                u32_input_count: 0,
                capabilities: ProgramCapabilities::default(),
                buffers: vec![BufferSchema::packed(
                    BufferId(1),
                    ScalarType::F32,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                )],
                operations: vec![
                    Operation::LoadF32 {
                        target: 0,
                        field: 0,
                    },
                    Operation::StoreF32 {
                        source: 0,
                        buffer: BufferId(1),
                        lane: 0,
                    },
                ],
            }],
        })
        .unwrap()
    }

    fn read_f32(bytes: &[u8], offset: usize) -> f32 {
        f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn capacities(compiler: &OrderedPlanCompiler) -> [usize; 13] {
        [
            compiler.pending_batches.capacity(),
            compiler.pending_instances.capacity(),
            compiler.pending_allocations.capacity(),
            compiler.input_batches.capacity(),
            compiler.identity_keys.capacity(),
            compiler.identity_epochs.capacity(),
            compiler.batch_cursors.capacity(),
            compiler.changed_ranges.capacity(),
            compiler.resources.capacity(),
            compiler.plan_buffers.capacity(),
            compiler.patches.capacity(),
            compiler.retirements.capacity(),
            compiler.payload.capacity(),
        ]
    }
}
