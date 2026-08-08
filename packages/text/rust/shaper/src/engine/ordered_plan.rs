//! Retained ordered-direct physical storage and invalidation-directed patch planning.
//!
//! The planner compares stable semantic identities and caller-owned content revisions. It never
//! scans physical buffers to discover changes. Preparation writes only scratch state and can be
//! aborted; committed CPU mirrors change only after the immutable plan has been serialized.

use alloc::vec::Vec;
use core::mem;

use super::{
    plan_input::{PlanInputError, span_bounds, validate_glyph, validate_input},
    plan_packing::{
        MAX_PHYSICAL_BUFFERS, PackingError, PendingAllocation, PhysicalBufferState, RecordRange,
        align_record_range, align_up, apply_writes, coalesce_ranges, execute_run, grown_capacity,
        record_alignment, take_allocation,
    },
    policy::{
        ALLOCATION_ORDERED_DIRECT, BATCH_MATERIAL, BufferSchema, CapabilitySetId,
        PolicyExecutionError, TechniqueId, ValidatedPolicy,
    },
    render_plan::{
        BUFFER_ORDERED_DIRECT, BufferRecord, DrawRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_WRITE,
        PRIMITIVE_GLYPH, PatchRecord, PrimitiveRecord, RESOURCE_ACTION_CREATE,
        RESOURCE_ACTION_RETAIN, RETIRE_BUFFER, RETIRE_RESOURCE, RETIRE_SLOT_RANGE, RenderPlanView,
        ResourceRecord, RetirementRecord,
    },
};

pub use super::plan_input::{PlanGlyph as OrderedGlyph, PlanInput as OrderedPlanInput};

const NONE: u32 = u32::MAX;

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

impl From<PlanInputError> for OrderedPlanError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
            PlanInputError::InvalidIdentity => Self::InvalidIdentity,
            PlanInputError::InvalidResource => Self::InvalidResource,
        }
    }
}

impl From<PackingError> for OrderedPlanError {
    fn from(error: PackingError) -> Self {
        match error {
            PackingError::AllocationFailed => Self::AllocationFailed,
            PackingError::ArithmeticOverflow => Self::ArithmeticOverflow,
            PackingError::CapacityExceeded => Self::CapacityExceeded,
            PackingError::InvalidIdentity => Self::InvalidIdentity,
            PackingError::Policy(error) => Self::PolicyExecution(error),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatchKey {
    technique: TechniqueId,
    program_variant: u16,
    program_id: u32,
    resource_id: u32,
    resource_generation: u32,
    resource_kind: u16,
    resource_reference: u32,
    material_id: u32,
    clip_id: u32,
    depth_key: u32,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingBatch {
    state: BatchState,
    prior_index: Option<u32>,
    capacity: u32,
    buffer_ids: [u32; MAX_PHYSICAL_BUFFERS],
    buffer_generations: [u32; MAX_PHYSICAL_BUFFERS],
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
    input_slots: Vec<u32>,
    identity_keys: Vec<u32>,
    identity_epochs: Vec<u32>,
    identity_epoch: u32,
    batch_cursors: Vec<u32>,
    changed_ranges: Vec<RecordRange>,
    resources: Vec<ResourceRecord>,
    plan_buffers: Vec<BufferRecord>,
    primitives: Vec<PrimitiveRecord>,
    draws: Vec<DrawRecord>,
    live_primitives: Vec<PrimitiveRecord>,
    live_draws: Vec<DrawRecord>,
    patches: Vec<PatchRecord>,
    retirements: Vec<RetirementRecord>,
    payload: Vec<u8>,
    next_buffer_id: u32,
    pending_next_buffer_id: u32,
    buffer_id_limit: u32,
    publish_bindings: bool,
    prepared: bool,
}

impl OrderedPlanCompiler {
    pub(crate) fn with_buffer_id_limit(buffer_id_limit: u32) -> Self {
        Self {
            buffer_id_limit,
            ..Self::default()
        }
    }

    pub fn prepare(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
    ) -> Result<(), OrderedPlanError> {
        self.prepare_internal(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            true,
        )
    }

    pub(crate) fn prepare_filtered(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
    ) -> Result<(), OrderedPlanError> {
        self.prepare_internal(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            false,
        )
    }

    fn prepare_internal(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        strict_strategy: bool,
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
        reserve(&mut self.input_slots, input.glyphs.len())?;
        reserve(&mut self.pending_instances, input.glyphs.len())?;
        self.input_batches.resize(input.glyphs.len(), NONE);
        self.input_batches.fill(NONE);
        self.input_slots.resize(input.glyphs.len(), 0);
        self.prepare_identity_set(input.glyphs.len())?;

        for (input_index, glyph) in input.glyphs.iter().copied().enumerate() {
            validate_glyph(glyph)?;
            if !self.insert_identity(glyph.stable_id) {
                return Err(OrderedPlanError::DuplicateIdentity);
            }
            let program = policy
                .program(capability_set, glyph.technique, glyph.program_variant)
                .ok_or(OrderedPlanError::ProgramMissing)?;
            if program.allocation_strategy != ALLOCATION_ORDERED_DIRECT {
                if strict_strategy {
                    return Err(OrderedPlanError::UnsupportedStrategy);
                }
                continue;
            }
            let resource_bit = 1_u32
                .checked_shl(u32::from(glyph.resource_kind - 1))
                .ok_or(OrderedPlanError::InvalidResource)?;
            if program.resource_kind_mask & resource_bit == 0 {
                return Err(OrderedPlanError::InvalidResource);
            }
            let key = BatchKey {
                technique: glyph.technique,
                program_variant: glyph.program_variant,
                program_id: program.id.0,
                resource_id: glyph.resource_id,
                resource_generation: glyph.resource_generation,
                resource_kind: glyph.resource_kind,
                resource_reference: glyph.resource_reference,
                material_id: if program.storage_key_mask & BATCH_MATERIAL != 0 {
                    glyph.material_id
                } else {
                    0
                },
                clip_id: if program.storage_key_mask & super::policy::BATCH_CLIP != 0 {
                    glyph.clip_id
                } else {
                    0
                },
                depth_key: if program.storage_key_mask & super::policy::BATCH_DEPTH != 0 {
                    glyph.depth_key
                } else {
                    0
                },
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
                        capacity: 0,
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
        self.compile_bindings(context)?;
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn has_state(&self) -> bool {
        !self.batches.is_empty()
    }

    pub(crate) fn publishes_bindings(&self) -> bool {
        self.publish_bindings
    }

    pub fn plan_view(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, OrderedPlanError> {
        self.plan_view_internal(policy_handle, capability_set, policy_fingerprint, false)
    }

    pub(crate) fn plan_view_forced(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, OrderedPlanError> {
        self.plan_view_internal(policy_handle, capability_set, policy_fingerprint, true)
    }

    fn plan_view_internal(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
        force_bindings: bool,
    ) -> Result<RenderPlanView<'_>, OrderedPlanError> {
        if !self.prepared {
            return Err(OrderedPlanError::NotPrepared);
        }
        let resources = if self.publish_bindings || force_bindings {
            self.resources.as_slice()
        } else {
            &[]
        };
        let buffers = if self.publish_bindings || force_bindings {
            self.plan_buffers.as_slice()
        } else {
            &[]
        };
        let primitives = if self.publish_bindings || force_bindings {
            self.primitives.as_slice()
        } else {
            &[]
        };
        let draws = if self.publish_bindings || force_bindings {
            self.draws.as_slice()
        } else {
            &[]
        };
        Ok(RenderPlanView {
            policy_handle,
            capability_set: capability_set.0,
            policy_fingerprint,
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
        mem::swap(&mut self.live_primitives, &mut self.primitives);
        self.primitives.clear();
        mem::swap(&mut self.live_draws, &mut self.draws);
        self.draws.clear();
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
        self.primitives.clear();
        self.draws.clear();
        self.patches.clear();
        self.retirements.clear();
        self.payload.clear();
        self.publish_bindings = false;
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
            .resize(cursor as usize, InstanceState::default());
        for (input_index, glyph) in input.glyphs.iter().enumerate() {
            if self.input_batches[input_index] == NONE {
                continue;
            }
            let batch = self.input_batches[input_index] as usize;
            let destination = self.batch_cursors[batch] as usize;
            self.pending_instances[destination] = InstanceState {
                stable_id: glyph.stable_id,
                content_revision: glyph.content_revision,
                input_index: input_index as u32,
            };
            self.input_slots[input_index] = u32::try_from(destination)
                .map_err(|_| OrderedPlanError::ArithmeticOverflow)?
                - self.pending_batches[batch].state.instance_start;
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
            self.pending_batches[batch_index],
            checkpoint || new_or_resized,
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
                let buffer_id = pending.buffer_ids[schema_index];
                let buffer_generation = pending.buffer_generations[schema_index];
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
                    buffer_id,
                    buffer_generation,
                    destination_offset,
                    byte_length,
                    payload_start: u32::try_from(payload_starts[schema_index])
                        .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                    ..PatchRecord::default()
                });
                if let Some(allocation) = self.pending_allocations.iter_mut().find(|allocation| {
                    allocation.state.id == buffer_id
                        && allocation.state.generation == buffer_generation
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
        reserve(&mut self.pending_allocations, 1)?;
        self.pending_allocations.push(PendingAllocation {
            state: PhysicalBufferState::new(id, generation, program_id, schema, capacity)?,
        });
        Ok(())
    }

    fn compile_bindings(&mut self, context: PrepareContext<'_>) -> Result<(), OrderedPlanError> {
        for batch_index in 0..self.pending_batches.len() {
            let batch = self.pending_batches[batch_index];
            let program = context
                .policy
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
                    policy_buffer_id: schema.id.0,
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
                    order_buffer_id: 0,
                });
            }
            self.pending_batches[batch_index].state.buffer_start =
                u32::try_from(buffer_start).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        }

        for (input_index, glyph) in context.input.glyphs.iter().copied().enumerate() {
            if self.input_batches[input_index] == NONE {
                continue;
            }
            if let Some(resource) = self.resources.iter().find(|resource| {
                resource.id == glyph.resource_id && resource.generation == glyph.resource_generation
            }) {
                if resource.technique_id != glyph.technique.0
                    || resource.resource_kind != glyph.resource_kind
                    || resource.reference_id != glyph.resource_reference
                {
                    return Err(OrderedPlanError::InvalidResource);
                }
                continue;
            }
            reserve(&mut self.resources, 1)?;
            let existing = self.batches.iter().any(|batch| {
                batch.key.resource_id == glyph.resource_id
                    && batch.key.resource_generation == glyph.resource_generation
            });
            self.resources.push(ResourceRecord {
                id: glyph.resource_id,
                generation: glyph.resource_generation,
                technique_id: glyph.technique.0,
                resource_kind: glyph.resource_kind,
                action: if context.checkpoint || !existing {
                    RESOURCE_ACTION_CREATE
                } else {
                    RESOURCE_ACTION_RETAIN
                },
                reference_id: glyph.resource_reference,
                ..ResourceRecord::default()
            });
        }

        if context.capability.max_resources_per_draw < 1 {
            return Err(OrderedPlanError::CapacityExceeded);
        }
        let mut input_index = 0_usize;
        while input_index < context.input.glyphs.len() {
            if self.input_batches[input_index] == NONE {
                input_index += 1;
                continue;
            }
            let first = context.input.glyphs[input_index];
            let batch_index = self.input_batches[input_index] as usize;
            let first_slot = self.input_slots[input_index];
            let program = context
                .policy
                .program(
                    context.capability_set,
                    first.technique,
                    first.program_variant,
                )
                .ok_or(OrderedPlanError::ProgramMissing)?;
            let split_material = program.draw_key_mask & BATCH_MATERIAL != 0;
            let mut end = input_index + 1;
            while end < context.input.glyphs.len()
                && end - input_index < usize::from(u16::MAX)
                && self.same_draw_span(
                    context.input.glyphs,
                    input_index,
                    end,
                    batch_index,
                    first_slot,
                    split_material,
                )
            {
                end += 1;
            }
            let count = u16::try_from(end - input_index)
                .map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
            let (inline_start, block_start, inline_extent, block_extent) =
                span_bounds(&context.input.glyphs[input_index..end])?;
            let batch = self.pending_batches[batch_index];
            let resource_start = self
                .resources
                .iter()
                .position(|resource| {
                    resource.id == first.resource_id
                        && resource.generation == first.resource_generation
                })
                .ok_or(OrderedPlanError::InvalidResource)?;
            let primitive_start = self.primitives.len();
            reserve(&mut self.primitives, 1)?;
            self.primitives.push(PrimitiveRecord {
                id: first.stable_id,
                kind: PRIMITIVE_GLYPH,
                technique_id: first.technique.0,
                resource_id: first.resource_id,
                resource_generation: first.resource_generation,
                program_id: batch.state.key.program_id,
                program_variant: first.program_variant,
                record_count: count,
                buffer_id: batch.buffer_ids[0],
                record_index: first_slot,
                logical_order: u32::try_from(input_index)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                clip_id: first.clip_id,
                semantic_id: first.semantic_id,
                inline_start,
                block_start,
                inline_extent,
                block_extent,
                ..PrimitiveRecord::default()
            });
            reserve(&mut self.draws, 1)?;
            self.draws.push(DrawRecord {
                id: first.stable_id,
                program_id: batch.state.key.program_id,
                program_variant: first.program_variant,
                material_id: if split_material { first.material_id } else { 0 },
                clip_id: first.clip_id,
                depth_key: first.depth_key,
                primitive_start: u32::try_from(primitive_start)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                primitive_count: 1,
                buffer_start: batch.state.buffer_start,
                buffer_count: u32::from(batch.state.buffer_count),
                resource_start: u32::try_from(resource_start)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                resource_count: 1,
                order_token: u32::try_from(input_index)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                ..DrawRecord::default()
            });
            input_index = end;
        }
        self.publish_bindings = context.checkpoint
            || !self.patches.is_empty()
            || !self.retirements.is_empty()
            || self.primitives != self.live_primitives
            || self.draws != self.live_draws;
        Ok(())
    }

    fn same_draw_span(
        &self,
        glyphs: &[OrderedGlyph],
        start: usize,
        next: usize,
        batch_index: usize,
        first_slot: u32,
        split_material: bool,
    ) -> bool {
        let first = glyphs[start];
        let glyph = glyphs[next];
        self.input_batches[next] as usize == batch_index
            && self.input_slots[next] == first_slot + (next - start) as u32
            && glyph.technique == first.technique
            && glyph.program_variant == first.program_variant
            && glyph.resource_id == first.resource_id
            && glyph.resource_generation == first.resource_generation
            && (!split_material || glyph.material_id == first.material_id)
            && glyph.clip_id == first.clip_id
            && glyph.depth_key == first.depth_key
            && glyph.semantic_id == first.semantic_id
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
        BATCH_MATERIAL, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE,
        BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, CAP_ORDERED_DIRECT, CapabilitySet,
        Operation, PolicyDescriptor, ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType,
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
        assert_eq!(first.primitives.len(), 1);
        assert_eq!(first.primitives[0].record_count, 3);
        assert_eq!(first.draws.len(), 1);
        assert_eq!(first.draws[0].buffer_count, 1);
        assert_eq!(first.draws[0].resource_count, 1);
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
        assert_eq!(delta.primitives, first_span(3).as_slice());
        assert_eq!(delta.draws.len(), 1);
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
        assert!(no_op.primitives.is_empty());
        assert!(no_op.draws.is_empty());
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
    fn interleaved_resources_compile_to_ordered_spans_with_shared_bindings() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        prepare(&mut compiler, &policy, &glyphs, &[1.0, 2.0, 3.0, 4.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(plan.resources.len(), 2);
        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(plan.primitives.len(), 3);
        assert_eq!(plan.draws.len(), 3);
        assert_eq!(plan.primitives[0].record_count, 2);
        assert_eq!(plan.primitives[0].record_index, 0);
        assert_eq!(plan.primitives[1].resource_id, 12);
        assert_eq!(plan.primitives[2].resource_id, 11);
        assert_eq!(plan.primitives[2].record_index, 2);
        assert_eq!(plan.draws[0].order_token, 0);
        assert_eq!(plan.draws[1].order_token, 2);
        assert_eq!(plan.draws[2].order_token, 3);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn material_identity_splits_draws_without_splitting_physical_storage() {
        let policy = policy();
        let mut compiler = OrderedPlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &policy, &glyphs, &[1.0, 2.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(plan.buffers.len(), 1);
        assert_eq!(plan.primitives.len(), 2);
        assert_eq!(plan.draws.len(), 2);
        assert_eq!(plan.draws[0].material_id, 1);
        assert_eq!(plan.draws[1].material_id, 2);
        assert_eq!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn policy_can_partition_physical_storage_by_material() {
        let policy = policy_with_material_storage(true);
        let mut compiler = OrderedPlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &policy, &glyphs, &[1.0, 2.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(plan.draws.len(), 2);
        assert_ne!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn glyph_spans_split_at_the_wire_record_limit() {
        let policy = policy_with_limits(false, 512 * 1024);
        let mut compiler = OrderedPlanCompiler::default();
        let glyphs: Vec<_> = (1..=u32::from(u16::MAX) + 1)
            .map(|stable_id| glyph(stable_id, 1))
            .collect();
        let x = vec![0.0; glyphs.len()];
        prepare(&mut compiler, &policy, &glyphs, &x, true);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(plan.primitives.len(), 2);
        assert_eq!(plan.primitives[0].record_count, u16::MAX);
        assert_eq!(plan.primitives[1].record_count, 1);
        assert_eq!(plan.primitives[1].record_index, u32::from(u16::MAX));
        assert_eq!(plan.draws.len(), 2);
        assert!(plan_layout(plan).is_ok());
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
            program_variant: 0,
            resource_id: 11,
            resource_generation: 1,
            resource_kind: 1,
            resource_reference: 99,
            semantic_id: 1,
            material_id: 1,
            clip_id: 0,
            depth_key: 0,
            inline_start: stable_id as f32,
            block_start: 0.0,
            inline_extent: 1.0,
            block_extent: 1.0,
        }
    }

    fn policy() -> ValidatedPolicy {
        policy_with_material_storage(false)
    }

    fn policy_with_material_storage(partition_materials: bool) -> ValidatedPolicy {
        policy_with_limits(partition_materials, 1024)
    }

    fn policy_with_limits(partition_materials: bool, max_buffer_bytes: u32) -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CAPABILITY,
                flags: CAP_ORDERED_DIRECT,
                max_buffer_bytes,
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
                storage_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | if partition_materials {
                        BATCH_MATERIAL
                    } else {
                        0
                    },
                draw_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | BATCH_MATERIAL
                    | BATCH_ORDER,
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

    fn first_span(record_count: u16) -> [PrimitiveRecord; 1] {
        [PrimitiveRecord {
            id: 1,
            kind: PRIMITIVE_GLYPH,
            technique_id: TECHNIQUE.0,
            resource_id: 11,
            resource_generation: 1,
            program_id: 5,
            program_variant: 0,
            record_count,
            buffer_id: 1,
            record_index: 0,
            logical_order: 0,
            clip_id: 0,
            semantic_id: 1,
            inline_start: 1.0,
            block_start: 0.0,
            inline_extent: record_count as f32,
            block_extent: 1.0,
            ..PrimitiveRecord::default()
        }]
    }

    fn capacities(compiler: &OrderedPlanCompiler) -> [usize; 18] {
        [
            compiler.pending_batches.capacity(),
            compiler.pending_instances.capacity(),
            compiler.pending_allocations.capacity(),
            compiler.input_batches.capacity(),
            compiler.input_slots.capacity(),
            compiler.identity_keys.capacity(),
            compiler.identity_epochs.capacity(),
            compiler.batch_cursors.capacity(),
            compiler.changed_ranges.capacity(),
            compiler.resources.capacity(),
            compiler.plan_buffers.capacity(),
            compiler.primitives.capacity(),
            compiler.draws.capacity(),
            compiler.live_primitives.capacity(),
            compiler.live_draws.capacity(),
            compiler.patches.capacity(),
            compiler.retirements.capacity(),
            compiler.payload.capacity(),
        ]
    }
}
