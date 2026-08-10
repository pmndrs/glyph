//! Retained stable-indirect physical storage and chunked logical-order plan compilation.
//!
//! Semantic identities retain physical record slots across edits. Logical order is a separate
//! fixed-chunk `u32` index buffer, so an insertion writes one new physical record and only the
//! affected order chunks. Deleted storage remains quarantined until the renderer acknowledges the
//! publication fence that made it unreachable.

use alloc::vec::Vec;
use core::mem;

use super::{
    plan_input::{
        PlanInputError, draw_fields_compatible, indexed_span_bounds, span_bounds, validate_glyph,
        validate_input,
    },
    plan_packing::{
        MAX_PHYSICAL_BUFFERS, PackingError, PendingAllocation, PhysicalBufferState, RangeJob,
        RecordRange, align_record_range, align_up, apply_writes, buffer_record_alignment,
        coalesce_buffer_ranges, collect_range_jobs, execute_run, grown_capacity, record_alignment,
        take_allocation,
    },
    policy::{
        ALLOCATION_STABLE_INDIRECT, BATCH_MATERIAL, BATCH_TRANSFORM, BUFFER_USAGE_COPY_DST,
        BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CapabilitySetId, PolicyExecutionError,
        ScalarType, TechniqueId, ValidatedPolicy,
    },
    render_plan::{
        BUFFER_STABLE_INDIRECT, BufferRecord, DrawRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_WRITE,
        POLICY_BUFFER_ORDER, PRIMITIVE_GLYPH, PatchRecord, PrimitiveRecord, RESOURCE_ACTION_CREATE,
        RESOURCE_ACTION_RETAIN, RETIRE_BUFFER, RETIRE_RESOURCE, RETIRE_SLOT_RANGE, RenderPlanView,
        ResourceRecord, RetirementRecord,
    },
    stable_order::{
        ChunkedOrder, ChunkedOrderError, ORDER_CHUNK_RECORDS, OrderEntry, PendingChunk,
    },
    stable_pool::{SlotIdentity, StablePoolError, StableSlotPool},
};

pub use super::plan_input::{PlanGlyph as StableGlyph, PlanInput as StablePlanInput};

const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StablePlanError {
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

impl From<PlanInputError> for StablePlanError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
            PlanInputError::InvalidIdentity => Self::InvalidIdentity,
            PlanInputError::InvalidResource => Self::InvalidResource,
        }
    }
}

impl From<PackingError> for StablePlanError {
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

impl From<StablePoolError> for StablePlanError {
    fn from(error: StablePoolError) -> Self {
        match error {
            StablePoolError::AllocationFailed => Self::AllocationFailed,
            StablePoolError::AlreadyPrepared => Self::AlreadyPrepared,
            StablePoolError::NotPrepared => Self::NotPrepared,
            StablePoolError::InvalidIdentity => Self::InvalidIdentity,
            StablePoolError::DuplicateIdentity => Self::DuplicateIdentity,
            StablePoolError::IdentifierExhausted => Self::IdentifierExhausted,
            StablePoolError::ArithmeticOverflow => Self::ArithmeticOverflow,
        }
    }
}

impl From<ChunkedOrderError> for StablePlanError {
    fn from(error: ChunkedOrderError) -> Self {
        match error {
            ChunkedOrderError::AllocationFailed => Self::AllocationFailed,
            ChunkedOrderError::AlreadyPrepared => Self::AlreadyPrepared,
            ChunkedOrderError::NotPrepared => Self::NotPrepared,
            ChunkedOrderError::ArithmeticOverflow => Self::ArithmeticOverflow,
            ChunkedOrderError::InvalidIdentity => Self::InvalidIdentity,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QuarantinedChunk {
    slot: u32,
    after_publication_generation: u32,
}

struct StableBatch {
    key: BatchKey,
    slots: StableSlotPool,
    order: ChunkedOrder,
    buffers: Vec<PhysicalBufferState>,
    spare_buffers: Vec<PhysicalBufferState>,
    order_buffer: Option<PhysicalBufferState>,
    quarantined_chunks: Vec<QuarantinedChunk>,
    pending_retired_chunks: Vec<u32>,
    reclaim_scratch: Vec<u32>,
    active: bool,
}

impl StableBatch {
    fn new(key: BatchKey) -> Self {
        Self {
            key,
            slots: StableSlotPool::default(),
            order: ChunkedOrder::default(),
            buffers: Vec::new(),
            spare_buffers: Vec::new(),
            order_buffer: None,
            quarantined_chunks: Vec::new(),
            pending_retired_chunks: Vec::new(),
            reclaim_scratch: Vec::new(),
            active: false,
        }
    }

    fn acknowledge(&mut self, through_generation: u32) -> Result<(), StablePlanError> {
        self.slots.acknowledge(through_generation)?;
        self.reclaim_scratch.clear();
        let count = self
            .quarantined_chunks
            .iter()
            .filter(|entry| entry.after_publication_generation <= through_generation)
            .count();
        reserve(&mut self.reclaim_scratch, count)?;
        self.reclaim_scratch.extend(
            self.quarantined_chunks
                .iter()
                .filter(|entry| entry.after_publication_generation <= through_generation)
                .map(|entry| entry.slot),
        );
        self.order.reclaim_chunks(&self.reclaim_scratch)?;
        self.quarantined_chunks
            .retain(|entry| entry.after_publication_generation > through_generation);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingBatch {
    batch_index: u32,
    item_start: u32,
    item_count: u32,
    cursor: u32,
    capacity: u32,
    buffer_start: u32,
    buffer_count: u16,
    buffer_ids: [u32; MAX_PHYSICAL_BUFFERS],
    buffer_generations: [u32; MAX_PHYSICAL_BUFFERS],
    order_buffer_id: u32,
    order_buffer_generation: u32,
    order_capacity: u32,
}

impl PendingBatch {
    fn new(batch_index: u32) -> Self {
        Self {
            batch_index,
            item_start: 0,
            item_count: 0,
            cursor: 0,
            capacity: 0,
            buffer_start: 0,
            buffer_count: 0,
            buffer_ids: [0; MAX_PHYSICAL_BUFFERS],
            buffer_generations: [0; MAX_PHYSICAL_BUFFERS],
            order_buffer_id: 0,
            order_buffer_generation: 0,
            order_capacity: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SlotWrite {
    slot: u32,
    input_index: u32,
    changed: bool,
}

#[derive(Clone, Copy)]
struct PrepareContext<'a> {
    policy: &'a ValidatedPolicy,
    capability_set: CapabilitySetId,
    capability: &'a super::policy::CapabilitySet,
    input: StablePlanInput<'a>,
    checkpoint: bool,
    publication_generation: u32,
}

#[derive(Default)]
pub struct StablePlanCompiler {
    batches: Vec<StableBatch>,
    committed_batch_count: usize,
    pending_batches: Vec<PendingBatch>,
    batch_pending_indices: Vec<u32>,
    input_batches: Vec<u32>,
    input_slots: Vec<u32>,
    input_order_records: Vec<u32>,
    batch_input_indices: Vec<u32>,
    batch_identities: Vec<SlotIdentity>,
    order_entries: Vec<OrderEntry>,
    order_chunk_scratch: Vec<PendingChunk>,
    slot_writes: Vec<SlotWrite>,
    changed_ranges: Vec<RecordRange>,
    buffer_ranges: [Vec<RecordRange>; MAX_PHYSICAL_BUFFERS],
    range_jobs: Vec<RangeJob>,
    identity_keys: Vec<u32>,
    identity_epochs: Vec<u32>,
    identity_epoch: u32,
    pending_allocations: Vec<PendingAllocation>,
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
    pending_publication_generation: u32,
    publish_bindings: bool,
    prepared: bool,
}

impl StablePlanCompiler {
    pub(crate) fn with_buffer_id_floor(last_assigned_id: u32) -> Self {
        Self {
            next_buffer_id: last_assigned_id,
            pending_next_buffer_id: last_assigned_id,
            ..Self::default()
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: StablePlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) -> Result<(), StablePlanError> {
        self.prepare_with_strategy_filter(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            acknowledged_publication_generation,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_filtered(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: StablePlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) -> Result<(), StablePlanError> {
        self.prepare_with_strategy_filter(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            acknowledged_publication_generation,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_with_strategy_filter(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: StablePlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
        strict_strategy: bool,
    ) -> Result<(), StablePlanError> {
        if self.prepared {
            return Err(StablePlanError::AlreadyPrepared);
        }
        if publication_generation == 0
            || acknowledged_publication_generation >= publication_generation
        {
            return Err(StablePlanError::InvalidIdentity);
        }
        self.committed_batch_count = self.batches.len();
        let result = self.prepare_inner(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            acknowledged_publication_generation,
            strict_strategy,
        );
        if result.is_err() {
            self.abort();
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_inner(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: StablePlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
        strict_strategy: bool,
    ) -> Result<(), StablePlanError> {
        let capability = policy
            .capability_set(capability_set)
            .ok_or(StablePlanError::CapabilitySetMissing)?;
        validate_input(input)?;
        for batch in &mut self.batches {
            // GPU completion is external monotonic state, not part of the publication transaction.
            // Reclamation therefore intentionally survives a later prepare failure or abort.
            batch.acknowledge(acknowledged_publication_generation)?;
        }
        self.reset_pending();
        self.pending_publication_generation = publication_generation;
        self.prepare_identity_set(input.glyphs.len())?;
        reserve(&mut self.input_batches, input.glyphs.len())?;
        reserve(&mut self.input_slots, input.glyphs.len())?;
        reserve(&mut self.input_order_records, input.glyphs.len())?;
        self.input_batches.resize(input.glyphs.len(), NONE);
        self.input_batches.fill(NONE);
        self.input_slots.resize(input.glyphs.len(), 0);
        self.input_order_records.resize(input.glyphs.len(), 0);
        self.batch_pending_indices.resize(self.batches.len(), NONE);

        for (input_index, glyph) in input.glyphs.iter().copied().enumerate() {
            validate_glyph(glyph)?;
            if !self.insert_identity(glyph.stable_id) {
                return Err(StablePlanError::DuplicateIdentity);
            }
            let program = policy
                .program(capability_set, glyph.technique, glyph.program_variant)
                .ok_or(StablePlanError::ProgramMissing)?;
            if program.allocation_strategy != ALLOCATION_STABLE_INDIRECT {
                if strict_strategy {
                    return Err(StablePlanError::UnsupportedStrategy);
                }
                continue;
            }
            let resource_bit = 1_u32
                .checked_shl(u32::from(glyph.resource_kind - 1))
                .ok_or(StablePlanError::InvalidResource)?;
            if program.resource_kind_mask & resource_bit == 0 {
                return Err(StablePlanError::InvalidResource);
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
            let batch_index = match self.batches.iter().position(|batch| batch.key == key) {
                Some(index) => index,
                None => {
                    reserve(&mut self.batches, 1)?;
                    self.batches.push(StableBatch::new(key));
                    reserve(&mut self.batch_pending_indices, 1)?;
                    self.batch_pending_indices.push(NONE);
                    self.batches.len() - 1
                }
            };
            let pending_index = if self.batch_pending_indices[batch_index] == NONE {
                reserve(&mut self.pending_batches, 1)?;
                let index = self.pending_batches.len();
                self.pending_batches.push(PendingBatch::new(
                    u32::try_from(batch_index).map_err(|_| StablePlanError::ArithmeticOverflow)?,
                ));
                self.batch_pending_indices[batch_index] =
                    u32::try_from(index).map_err(|_| StablePlanError::ArithmeticOverflow)?;
                index
            } else {
                self.batch_pending_indices[batch_index] as usize
            };
            self.pending_batches[pending_index].item_count = self.pending_batches[pending_index]
                .item_count
                .checked_add(1)
                .ok_or(StablePlanError::ArithmeticOverflow)?;
            self.input_batches[input_index] =
                u32::try_from(pending_index).map_err(|_| StablePlanError::ArithmeticOverflow)?;
        }

        self.layout_batch_inputs(input)?;
        let context = PrepareContext {
            policy,
            capability_set,
            capability,
            input,
            checkpoint,
            publication_generation,
        };
        self.pending_next_buffer_id = self.next_buffer_id;
        for batch_index in 0..self.batches.len() {
            self.prepare_batch_identity(
                batch_index,
                publication_generation,
                capability.fragmentation_budget,
            )?;
            if self.batch_pending_indices[batch_index] != NONE {
                let pending_index = self.batch_pending_indices[batch_index] as usize;
                self.prepare_batch_storage(context, pending_index)?;
            } else if self.batches[batch_index].active {
                self.prepare_removed_batch(batch_index, publication_generation)?;
            }
        }
        self.compile_bindings(context)?;
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn has_state(&self) -> bool {
        self.batches.iter().any(|batch| {
            batch.active
                || batch.slots.has_quarantined_slots()
                || !batch.quarantined_chunks.is_empty()
        })
    }

    pub(crate) fn publishes_bindings(&self) -> bool {
        self.publish_bindings
    }

    pub fn plan_view(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, StablePlanError> {
        self.plan_view_internal(policy_handle, capability_set, policy_fingerprint, false)
    }

    pub(crate) fn plan_view_forced(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, StablePlanError> {
        self.plan_view_internal(policy_handle, capability_set, policy_fingerprint, true)
    }

    fn plan_view_internal(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
        force_bindings: bool,
    ) -> Result<RenderPlanView<'_>, StablePlanError> {
        if !self.prepared {
            return Err(StablePlanError::NotPrepared);
        }
        Ok(RenderPlanView {
            policy_handle,
            capability_set: capability_set.0,
            policy_fingerprint,
            resources: if self.publish_bindings || force_bindings {
                &self.resources
            } else {
                &[]
            },
            buffers: if self.publish_bindings || force_bindings {
                &self.plan_buffers
            } else {
                &[]
            },
            patches: &self.patches,
            retirements: &self.retirements,
            primitives: if self.publish_bindings || force_bindings {
                &self.primitives
            } else {
                &[]
            },
            draws: if self.publish_bindings || force_bindings {
                &self.draws
            } else {
                &[]
            },
            payload: &self.payload,
            ..RenderPlanView::default()
        })
    }

    pub fn commit(&mut self) -> Result<(), StablePlanError> {
        if !self.prepared {
            return Err(StablePlanError::NotPrepared);
        }
        for batch_index in 0..self.batches.len() {
            let pending_index = self.batch_pending_indices[batch_index];
            self.commit_batch_storage(batch_index, pending_index)?;
            let batch = &mut self.batches[batch_index];
            batch.slots.commit()?;
            let order_rebased = batch.order.rebased()?;
            if order_rebased {
                batch.quarantined_chunks.clear();
            }
            batch
                .quarantined_chunks
                .extend(
                    batch
                        .pending_retired_chunks
                        .iter()
                        .map(|&slot| QuarantinedChunk {
                            slot,
                            after_publication_generation: self.pending_publication_generation,
                        }),
                );
            batch.pending_retired_chunks.clear();
            batch.order.commit()?;
            batch.active = pending_index != NONE;
        }
        mem::swap(&mut self.live_primitives, &mut self.primitives);
        self.primitives.clear();
        mem::swap(&mut self.live_draws, &mut self.draws);
        self.draws.clear();
        self.next_buffer_id = self.pending_next_buffer_id;
        self.prepared = false;
        Ok(())
    }

    pub fn abort(&mut self) {
        for batch in &mut self.batches {
            batch.slots.abort();
            batch.order.abort();
            batch.pending_retired_chunks.clear();
        }
        self.batches.truncate(self.committed_batch_count);
        self.pending_allocations.clear();
        self.prepared = false;
    }

    pub fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        self.batches.iter().find_map(|batch| {
            batch
                .buffers
                .iter()
                .find(|buffer| buffer.id == id)
                .or_else(|| batch.order_buffer.as_ref().filter(|buffer| buffer.id == id))
                .map(|buffer| buffer.bytes.as_slice())
        })
    }

    fn reset_pending(&mut self) {
        self.pending_batches.clear();
        self.batch_pending_indices.clear();
        self.batch_input_indices.clear();
        self.batch_identities.clear();
        self.order_entries.clear();
        self.order_chunk_scratch.clear();
        self.slot_writes.clear();
        self.changed_ranges.clear();
        self.pending_allocations.clear();
        self.resources.clear();
        self.plan_buffers.clear();
        self.primitives.clear();
        self.draws.clear();
        self.patches.clear();
        self.retirements.clear();
        self.payload.clear();
        self.publish_bindings = false;
    }

    fn layout_batch_inputs(&mut self, input: StablePlanInput<'_>) -> Result<(), StablePlanError> {
        reserve(&mut self.batch_input_indices, input.glyphs.len())?;
        reserve(&mut self.batch_identities, input.glyphs.len())?;
        let item_count = self
            .pending_batches
            .iter()
            .try_fold(0_usize, |total, pending| {
                total.checked_add(pending.item_count as usize)
            })
            .ok_or(StablePlanError::ArithmeticOverflow)?;
        self.batch_input_indices.resize(item_count, 0);
        self.batch_identities.resize(
            item_count,
            SlotIdentity {
                stable_id: 0,
                content_revision: 0,
            },
        );
        let mut cursor = 0_u32;
        for pending in &mut self.pending_batches {
            pending.item_start = cursor;
            pending.cursor = cursor;
            cursor = cursor
                .checked_add(pending.item_count)
                .ok_or(StablePlanError::ArithmeticOverflow)?;
        }
        for (input_index, glyph) in input.glyphs.iter().copied().enumerate() {
            if self.input_batches[input_index] == NONE {
                continue;
            }
            let pending_index = self.input_batches[input_index] as usize;
            let destination = self.pending_batches[pending_index].cursor as usize;
            self.batch_input_indices[destination] =
                u32::try_from(input_index).map_err(|_| StablePlanError::ArithmeticOverflow)?;
            self.batch_identities[destination] = SlotIdentity {
                stable_id: glyph.stable_id,
                content_revision: glyph.content_revision,
            };
            self.pending_batches[pending_index].cursor = self.pending_batches[pending_index]
                .cursor
                .checked_add(1)
                .ok_or(StablePlanError::ArithmeticOverflow)?;
        }
        Ok(())
    }

    fn prepare_batch_identity(
        &mut self,
        batch_index: usize,
        publication_generation: u32,
        fragmentation_budget: u16,
    ) -> Result<(), StablePlanError> {
        let pending_index = self.batch_pending_indices[batch_index];
        let identities = if pending_index == NONE {
            &[][..]
        } else {
            let pending = self.pending_batches[pending_index as usize];
            self.batch_identities
                .get(range(pending.item_start, pending.item_count)?)
                .ok_or(StablePlanError::InvalidIdentity)?
        };
        let batch = &mut self.batches[batch_index];
        if !batch
            .slots
            .prepare_retained(identities, publication_generation)?
        {
            batch.slots.prepare(identities, publication_generation)?;
        }
        let assignments = batch.slots.assignments()?;
        self.order_entries.clear();
        reserve(&mut self.order_entries, assignments.len())?;
        for assignment in assignments {
            self.order_entries.push(OrderEntry {
                stable_id: assignment.stable_id,
                record_slot: assignment.slot,
            });
        }
        batch.order.prepare(&self.order_entries)?;
        if batch.order.span_count()? > u32::from(fragmentation_budget) {
            batch.order.rebase(&self.order_entries)?;
        }
        batch.pending_retired_chunks.clear();
        reserve(
            &mut batch.pending_retired_chunks,
            batch.order.retired_chunks()?.len(),
        )?;
        batch
            .pending_retired_chunks
            .extend_from_slice(batch.order.retired_chunks()?);
        reserve(
            &mut batch.quarantined_chunks,
            batch.pending_retired_chunks.len(),
        )?;

        if pending_index != NONE {
            let pending = self.pending_batches[pending_index as usize];
            for (offset, assignment) in assignments.iter().enumerate() {
                let item = pending.item_start as usize + offset;
                let input_index = self.batch_input_indices[item] as usize;
                self.input_slots[input_index] = assignment.slot;
            }
            let mut item_offset = 0_usize;
            for chunk in batch.order.pending_chunks()?.iter().copied() {
                for offset in 0..usize::from(chunk.len) {
                    let input_index =
                        self.batch_input_indices[pending.item_start as usize + item_offset];
                    self.input_order_records[input_index as usize] = chunk
                        .record_start()
                        .checked_add(offset as u32)
                        .ok_or(StablePlanError::ArithmeticOverflow)?;
                    item_offset += 1;
                }
            }
            if item_offset != assignments.len() {
                return Err(StablePlanError::InvalidIdentity);
            }
        }
        Ok(())
    }

    fn prepare_batch_storage(
        &mut self,
        context: PrepareContext<'_>,
        pending_index: usize,
    ) -> Result<(), StablePlanError> {
        let pending = self.pending_batches[pending_index];
        let batch_index = pending.batch_index as usize;
        let key = self.batches[batch_index].key;
        let program = context
            .policy
            .program(context.capability_set, key.technique, key.program_variant)
            .ok_or(StablePlanError::ProgramMissing)?;
        let required_slots = self.batches[batch_index].slots.required_slots()?;
        let previous_capacity = self.batches[batch_index]
            .buffers
            .first()
            .map_or(0, |buffer| buffer.capacity);
        let capacity = align_up(
            if previous_capacity >= required_slots {
                previous_capacity
            } else {
                grown_capacity(previous_capacity.max(1), required_slots)?
            },
            record_alignment(program, context.capability.update_alignment)?,
        )?;
        for schema in &program.buffers {
            if capacity
                .checked_mul(u32::from(schema.stride))
                .ok_or(StablePlanError::ArithmeticOverflow)?
                > context.capability.max_buffer_bytes
            {
                return Err(StablePlanError::CapacityExceeded);
            }
        }
        self.pending_batches[pending_index].capacity = capacity;
        let resized = self.batches[batch_index].buffers.is_empty() || capacity != previous_capacity;
        let replace = context.checkpoint || resized;
        reserve(
            &mut self.batches[batch_index].spare_buffers,
            program.buffers.len(),
        )?;
        for (schema_index, schema) in program.buffers.iter().copied().enumerate() {
            let previous = self.batches[batch_index]
                .buffers
                .get(schema_index)
                .map(|buffer| (buffer.id, buffer.generation, buffer.bytes.len()));
            let (id, generation) = self.next_buffer_identity(previous, resized)?;
            self.pending_batches[pending_index].buffer_ids[schema_index] = id;
            self.pending_batches[pending_index].buffer_generations[schema_index] = generation;
            if replace {
                self.allocate_buffer(id, generation, key.program_id, schema, capacity)?;
                reserve(&mut self.patches, 1)?;
                self.patches.push(PatchRecord {
                    opcode: PATCH_ALLOCATE_OR_RESIZE,
                    buffer_id: id,
                    buffer_generation: generation,
                    byte_length: capacity
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    ..PatchRecord::default()
                });
                if let Some((old_id, old_generation, old_length)) = previous
                    && (generation != old_generation || id != old_id)
                {
                    self.retire_buffer(
                        old_id,
                        old_generation,
                        old_length,
                        context.publication_generation,
                    )?;
                }
            }
        }
        self.pending_batches[pending_index].buffer_count = u16::try_from(program.buffers.len())
            .map_err(|_| StablePlanError::ArithmeticOverflow)?;
        self.write_physical_records(context, pending_index, program, replace)?;
        self.prepare_order_buffer(context, pending_index)?;
        self.retire_removed_slots(context, pending_index)?;
        Ok(())
    }

    fn write_physical_records(
        &mut self,
        context: PrepareContext<'_>,
        pending_index: usize,
        program: &super::policy::ProgramDescriptor,
        replace: bool,
    ) -> Result<(), StablePlanError> {
        let pending = self.pending_batches[pending_index];
        let batch = &self.batches[pending.batch_index as usize];
        let assignments = batch.slots.assignments()?;
        self.slot_writes.clear();
        reserve(&mut self.slot_writes, assignments.len())?;
        for (offset, assignment) in assignments.iter().copied().enumerate() {
            self.slot_writes.push(SlotWrite {
                slot: assignment.slot,
                input_index: self.batch_input_indices[pending.item_start as usize + offset],
                changed: assignment.changed,
            });
        }
        self.slot_writes.sort_unstable_by_key(|write| write.slot);
        self.changed_ranges.clear();
        reserve(&mut self.changed_ranges, self.slot_writes.len())?;
        for write in &self.slot_writes {
            if replace || write.changed {
                self.changed_ranges.push(RecordRange {
                    start: write.slot,
                    end: write
                        .slot
                        .checked_add(1)
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                });
            }
        }
        let required_slots = batch.slots.required_slots()?;
        for ranges in &mut self.buffer_ranges {
            ranges.clear();
        }
        for changed in self.changed_ranges.iter().copied() {
            let active_buffers = stable_active_buffers(
                context.policy,
                context.capability_set,
                program,
                context.input,
                &self.slot_writes,
                changed,
                replace,
            )?;
            for (schema_index, schema) in program.buffers.iter().enumerate() {
                if active_buffers & (1 << schema_index) == 0 {
                    continue;
                }
                reserve(&mut self.buffer_ranges[schema_index], 1)?;
                self.buffer_ranges[schema_index].push(align_record_range(
                    changed,
                    buffer_record_alignment(schema, context.capability.update_alignment),
                )?);
            }
        }
        for (schema_index, schema) in program.buffers.iter().enumerate() {
            coalesce_buffer_ranges(
                &mut self.buffer_ranges[schema_index],
                u32::from(schema.stride),
                context.capability,
                required_slots,
            )?;
        }
        collect_range_jobs(
            &mut self.range_jobs,
            &self.buffer_ranges,
            program.buffers.len(),
        )?;
        for job_index in 0..self.range_jobs.len() {
            let RangeJob {
                range: changed,
                active_buffers,
            } = self.range_jobs[job_index];
            let count = changed.end - changed.start;
            let mut payload_starts = [0_usize; MAX_PHYSICAL_BUFFERS];
            for (schema_index, schema) in program.buffers.iter().enumerate() {
                if active_buffers & (1 << schema_index) == 0 {
                    continue;
                }
                let byte_count = count as usize * schema.stride();
                let payload_start = self.payload.len();
                reserve(&mut self.payload, byte_count)?;
                self.payload.resize(payload_start + byte_count, 0);
                payload_starts[schema_index] = payload_start;
                if !replace {
                    let old = self.batches[pending.batch_index as usize]
                        .buffers
                        .get(schema_index)
                        .ok_or(StablePlanError::InvalidIdentity)?;
                    let source_start = changed.start as usize * schema.stride();
                    let source_end = source_start + byte_count;
                    let source = old
                        .bytes
                        .get(source_start..source_end)
                        .ok_or(StablePlanError::InvalidIdentity)?;
                    self.payload[payload_start..payload_start + byte_count].copy_from_slice(source);
                }
            }
            let mut write_index = self
                .slot_writes
                .partition_point(|write| write.slot < changed.start);
            while write_index < self.slot_writes.len()
                && self.slot_writes[write_index].slot < changed.end
            {
                if !replace && !self.slot_writes[write_index].changed {
                    write_index += 1;
                    continue;
                }
                let first = self.slot_writes[write_index];
                let mut end = write_index + 1;
                while end < self.slot_writes.len()
                    && self.slot_writes[end].slot == first.slot + (end - write_index) as u32
                    && self.slot_writes[end].input_index
                        == first.input_index + (end - write_index) as u32
                    && (replace || self.slot_writes[end].changed)
                    && self.slot_writes[end].slot < changed.end
                {
                    end += 1;
                }
                execute_run(
                    context.policy,
                    context.capability_set,
                    program,
                    context.input,
                    first.input_index as usize,
                    (end - write_index) as u32,
                    first.slot - changed.start,
                    &mut self.payload,
                    &payload_starts,
                    count,
                    active_buffers,
                )?;
                write_index = end;
            }
            for (schema_index, schema) in program.buffers.iter().enumerate() {
                if active_buffers & (1 << schema_index) == 0 {
                    continue;
                }
                reserve(&mut self.patches, 1)?;
                self.patches.push(PatchRecord {
                    opcode: PATCH_WRITE,
                    buffer_id: pending.buffer_ids[schema_index],
                    buffer_generation: pending.buffer_generations[schema_index],
                    destination_offset: changed
                        .start
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    byte_length: count
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    payload_start: u32::try_from(payload_starts[schema_index])
                        .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                    ..PatchRecord::default()
                });
            }
        }
        Ok(())
    }

    fn prepare_order_buffer(
        &mut self,
        context: PrepareContext<'_>,
        pending_index: usize,
    ) -> Result<(), StablePlanError> {
        let pending = self.pending_batches[pending_index];
        let batch_index = pending.batch_index as usize;
        let order_capacity = self.batches[batch_index].order.capacity_records()?;
        if order_capacity
            .checked_mul(4)
            .ok_or(StablePlanError::ArithmeticOverflow)?
            > context.capability.max_buffer_bytes
        {
            return Err(StablePlanError::CapacityExceeded);
        }
        let previous = self.batches[batch_index]
            .order_buffer
            .as_ref()
            .map(|buffer| {
                (
                    buffer.id,
                    buffer.generation,
                    buffer.capacity,
                    buffer.bytes.len(),
                )
            });
        let regenerated = previous.is_none_or(|(_, _, capacity, _)| capacity != order_capacity)
            || self.batches[batch_index].order.rebased()?;
        let replace = context.checkpoint || regenerated;
        let identity = previous.map(|(id, generation, _, length)| (id, generation, length));
        let (id, generation) = self.next_buffer_identity(identity, regenerated)?;
        self.pending_batches[pending_index].order_buffer_id = id;
        self.pending_batches[pending_index].order_buffer_generation = generation;
        self.pending_batches[pending_index].order_capacity = order_capacity;
        if replace {
            let key = self.batches[batch_index].key;
            self.allocate_buffer(
                id,
                generation,
                key.program_id,
                order_schema(),
                order_capacity,
            )?;
            reserve(&mut self.patches, 1)?;
            self.patches.push(PatchRecord {
                opcode: PATCH_ALLOCATE_OR_RESIZE,
                buffer_id: id,
                buffer_generation: generation,
                byte_length: order_capacity
                    .checked_mul(4)
                    .ok_or(StablePlanError::ArithmeticOverflow)?,
                ..PatchRecord::default()
            });
            if let Some((old_id, old_generation, _, old_length)) = previous
                && generation != old_generation
            {
                self.retire_buffer(
                    old_id,
                    old_generation,
                    old_length,
                    context.publication_generation,
                )?;
            }
        }
        self.order_chunk_scratch.clear();
        let chunk_count = self.batches[batch_index].order.pending_chunks()?.len();
        reserve(&mut self.order_chunk_scratch, chunk_count)?;
        self.order_chunk_scratch.extend(
            self.batches[batch_index]
                .order
                .pending_chunks()?
                .iter()
                .copied()
                .filter(|chunk| replace || chunk.changed()),
        );
        self.changed_ranges.clear();
        reserve(&mut self.changed_ranges, self.order_chunk_scratch.len())?;
        let order_alignment =
            buffer_record_alignment(&order_schema(), context.capability.update_alignment);
        for chunk in self.order_chunk_scratch.iter().copied() {
            self.changed_ranges.push(align_record_range(
                RecordRange {
                    start: chunk.record_start(),
                    end: chunk
                        .record_start()
                        .checked_add(u32::from(chunk.len))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                },
                order_alignment,
            )?);
        }
        self.changed_ranges
            .sort_unstable_by_key(|range| range.start);
        coalesce_buffer_ranges(
            &mut self.changed_ranges,
            4,
            context.capability,
            order_capacity,
        )?;
        for range_index in 0..self.changed_ranges.len() {
            let range = self.changed_ranges[range_index];
            let payload_start = self.payload.len();
            let byte_length = usize::try_from(range.end - range.start)
                .ok()
                .and_then(|count| count.checked_mul(4))
                .ok_or(StablePlanError::ArithmeticOverflow)?;
            reserve(&mut self.payload, byte_length)?;
            self.payload.resize(payload_start + byte_length, 0);
            if !replace {
                let source_start = usize::try_from(range.start)
                    .ok()
                    .and_then(|start| start.checked_mul(4))
                    .ok_or(StablePlanError::ArithmeticOverflow)?;
                let source_end = source_start
                    .checked_add(byte_length)
                    .ok_or(StablePlanError::ArithmeticOverflow)?;
                let source = self.batches[batch_index]
                    .order_buffer
                    .as_ref()
                    .and_then(|buffer| buffer.bytes.get(source_start..source_end))
                    .ok_or(StablePlanError::InvalidIdentity)?;
                self.payload[payload_start..payload_start + byte_length].copy_from_slice(source);
            }
            for chunk_index in 0..self.order_chunk_scratch.len() {
                let chunk = self.order_chunk_scratch[chunk_index];
                let chunk_start = chunk.record_start();
                if chunk_start < range.start || chunk_start >= range.end {
                    continue;
                }
                let destination = payload_start
                    + usize::try_from(chunk_start - range.start)
                        .ok()
                        .and_then(|start| start.checked_mul(4))
                        .ok_or(StablePlanError::ArithmeticOverflow)?;
                let entries = self.batches[batch_index].order.entries(chunk)?;
                for (entry_index, entry) in entries.iter().enumerate() {
                    let start = destination + entry_index * 4;
                    self.payload[start..start + 4]
                        .copy_from_slice(&entry.record_slot.to_le_bytes());
                }
            }
            reserve(&mut self.patches, 1)?;
            self.patches.push(PatchRecord {
                opcode: PATCH_WRITE,
                buffer_id: id,
                buffer_generation: generation,
                destination_offset: range
                    .start
                    .checked_mul(4)
                    .ok_or(StablePlanError::ArithmeticOverflow)?,
                byte_length: u32::try_from(byte_length)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                payload_start: u32::try_from(payload_start)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                ..PatchRecord::default()
            });
        }
        Ok(())
    }

    fn retire_removed_slots(
        &mut self,
        context: PrepareContext<'_>,
        pending_index: usize,
    ) -> Result<(), StablePlanError> {
        let pending = self.pending_batches[pending_index];
        let batch = &self.batches[pending.batch_index as usize];
        let slot_retirements = batch
            .slots
            .retired_slots()?
            .len()
            .checked_mul(batch.buffers.len())
            .ok_or(StablePlanError::ArithmeticOverflow)?;
        let order_retirements = if batch.order_buffer.is_some() {
            batch.order.retired_chunks()?.len()
        } else {
            0
        };
        let retirement_count = slot_retirements
            .checked_add(order_retirements)
            .ok_or(StablePlanError::ArithmeticOverflow)?;
        reserve(&mut self.retirements, retirement_count)?;
        for &slot in batch.slots.retired_slots()? {
            for buffer in &batch.buffers {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_SLOT_RANGE,
                    id: buffer.id,
                    generation: buffer.generation,
                    after_publication_generation: context.publication_generation,
                    byte_offset: slot
                        .checked_mul(u32::from(buffer.schema.stride))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    byte_length: u32::from(buffer.schema.stride),
                    ..RetirementRecord::default()
                });
            }
        }
        if let Some(order_buffer) = &batch.order_buffer {
            for &slot in batch.order.retired_chunks()? {
                self.retirements.push(RetirementRecord {
                    kind: RETIRE_SLOT_RANGE,
                    id: order_buffer.id,
                    generation: order_buffer.generation,
                    after_publication_generation: context.publication_generation,
                    byte_offset: slot
                        .checked_mul(ORDER_CHUNK_RECORDS)
                        .and_then(|value| value.checked_mul(4))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    byte_length: ORDER_CHUNK_RECORDS * 4,
                    ..RetirementRecord::default()
                });
            }
        }
        Ok(())
    }

    fn prepare_removed_batch(
        &mut self,
        batch_index: usize,
        publication_generation: u32,
    ) -> Result<(), StablePlanError> {
        let key = self.batches[batch_index].key;
        if !self.batches.iter().enumerate().any(|(index, candidate)| {
            index != batch_index
                && self.batch_pending_indices[index] != NONE
                && candidate.key.resource_id == key.resource_id
                && candidate.key.resource_generation == key.resource_generation
        }) && !self.retirements.iter().any(|retirement| {
            retirement.kind == RETIRE_RESOURCE
                && retirement.id == key.resource_id
                && retirement.generation == key.resource_generation
        }) {
            reserve(&mut self.retirements, 1)?;
            self.retirements.push(RetirementRecord {
                kind: RETIRE_RESOURCE,
                id: key.resource_id,
                generation: key.resource_generation,
                after_publication_generation: publication_generation,
                ..RetirementRecord::default()
            });
        }
        for buffer_index in 0..self.batches[batch_index].buffers.len() {
            let buffer = &self.batches[batch_index].buffers[buffer_index];
            let (id, generation, byte_length) = (buffer.id, buffer.generation, buffer.bytes.len());
            self.retire_buffer(id, generation, byte_length, publication_generation)?;
        }
        if let Some((id, generation, byte_length)) = self.batches[batch_index]
            .order_buffer
            .as_ref()
            .map(|buffer| (buffer.id, buffer.generation, buffer.bytes.len()))
        {
            self.retire_buffer(id, generation, byte_length, publication_generation)?;
        }
        Ok(())
    }

    fn compile_bindings(&mut self, context: PrepareContext<'_>) -> Result<(), StablePlanError> {
        for pending_index in 0..self.pending_batches.len() {
            let mut pending = self.pending_batches[pending_index];
            let batch = &self.batches[pending.batch_index as usize];
            let program = context
                .policy
                .program(
                    context.capability_set,
                    batch.key.technique,
                    batch.key.program_variant,
                )
                .ok_or(StablePlanError::ProgramMissing)?;
            let binding_count = program.buffers.len() + 1;
            if binding_count > usize::from(context.capability.max_buffers_per_draw) {
                return Err(StablePlanError::CapacityExceeded);
            }
            pending.buffer_start = u32::try_from(self.plan_buffers.len())
                .map_err(|_| StablePlanError::ArithmeticOverflow)?;
            reserve(&mut self.plan_buffers, binding_count)?;
            for (schema_index, schema) in program.buffers.iter().copied().enumerate() {
                self.plan_buffers.push(BufferRecord {
                    id: pending.buffer_ids[schema_index],
                    generation: pending.buffer_generations[schema_index],
                    program_id: batch.key.program_id,
                    policy_buffer_id: schema.id.0,
                    scalar_type: schema.scalar as u8,
                    vector_width: schema.vector_width,
                    strategy: BUFFER_STABLE_INDIRECT,
                    flags: schema.usage as u16,
                    live_records: pending.item_count,
                    capacity_records: pending.capacity,
                    byte_length: pending
                        .capacity
                        .checked_mul(u32::from(schema.stride))
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    order_buffer_id: pending.order_buffer_id,
                });
            }
            self.plan_buffers.push(BufferRecord {
                id: pending.order_buffer_id,
                generation: pending.order_buffer_generation,
                program_id: batch.key.program_id,
                policy_buffer_id: POLICY_BUFFER_ORDER,
                scalar_type: ScalarType::U32 as u8,
                vector_width: 1,
                strategy: BUFFER_STABLE_INDIRECT,
                flags: (BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST) as u16,
                live_records: pending.item_count,
                capacity_records: pending.order_capacity,
                byte_length: pending
                    .order_capacity
                    .checked_mul(4)
                    .ok_or(StablePlanError::ArithmeticOverflow)?,
                order_buffer_id: 0,
            });
            pending.buffer_count =
                u16::try_from(binding_count).map_err(|_| StablePlanError::ArithmeticOverflow)?;
            self.pending_batches[pending_index] = pending;
        }
        self.compile_resources(context)?;
        self.compile_draws(context)?;
        self.publish_bindings = context.checkpoint
            || !self.patches.is_empty()
            || !self.retirements.is_empty()
            || self.primitives != self.live_primitives
            || self.draws != self.live_draws;
        Ok(())
    }

    fn compile_resources(&mut self, context: PrepareContext<'_>) -> Result<(), StablePlanError> {
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
                    return Err(StablePlanError::InvalidResource);
                }
                continue;
            }
            let existing = self.batches.iter().any(|batch| {
                batch.active
                    && batch.key.resource_id == glyph.resource_id
                    && batch.key.resource_generation == glyph.resource_generation
            });
            reserve(&mut self.resources, 1)?;
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
        Ok(())
    }

    fn compile_draws(&mut self, context: PrepareContext<'_>) -> Result<(), StablePlanError> {
        if context.capability.max_resources_per_draw < 1 {
            return Err(StablePlanError::CapacityExceeded);
        }
        if context.input.order_independent {
            self.compile_independent_draws(context)
        } else {
            self.compile_ordered_draws(context)
        }
    }

    fn compile_ordered_draws(
        &mut self,
        context: PrepareContext<'_>,
    ) -> Result<(), StablePlanError> {
        let mut input_index = 0_usize;
        while input_index < context.input.glyphs.len() {
            if self.input_batches[input_index] == NONE {
                input_index += 1;
                continue;
            }
            let first = context.input.glyphs[input_index];
            let pending_index = self.input_batches[input_index] as usize;
            let pending = self.pending_batches[pending_index];
            let batch = &self.batches[pending.batch_index as usize];
            let program = context
                .policy
                .program(
                    context.capability_set,
                    first.technique,
                    first.program_variant,
                )
                .ok_or(StablePlanError::ProgramMissing)?;
            let split_material = program.draw_key_mask & BATCH_MATERIAL != 0;
            let split_transform = program.draw_key_mask & BATCH_TRANSFORM != 0;
            let first_record = self.input_order_records[input_index];
            let mut end = input_index + 1;
            while end < context.input.glyphs.len()
                && end - input_index < usize::from(u16::MAX)
                && self.same_draw_span(
                    context.input.glyphs,
                    input_index,
                    end,
                    pending_index,
                    first_record,
                    split_material,
                    split_transform,
                )
            {
                end += 1;
            }
            let count = u16::try_from(end - input_index)
                .map_err(|_| StablePlanError::ArithmeticOverflow)?;
            let (inline_start, block_start, inline_extent, block_extent) =
                span_bounds(&context.input.glyphs[input_index..end])?;
            let resource_start = self
                .resources
                .iter()
                .position(|resource| {
                    resource.id == first.resource_id
                        && resource.generation == first.resource_generation
                })
                .ok_or(StablePlanError::InvalidResource)?;
            let primitive_start = self.primitives.len();
            reserve(&mut self.primitives, 1)?;
            self.primitives.push(PrimitiveRecord {
                id: first.stable_id,
                kind: PRIMITIVE_GLYPH,
                technique_id: first.technique.0,
                resource_id: first.resource_id,
                resource_generation: first.resource_generation,
                program_id: batch.key.program_id,
                program_variant: first.program_variant,
                record_count: count,
                buffer_id: pending.order_buffer_id,
                record_index: first_record,
                logical_order: u32::try_from(input_index)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                clip_id: first.clip_id,
                semantic_id: if context.input.glyphs[input_index..end]
                    .iter()
                    .all(|glyph| glyph.semantic_id == first.semantic_id)
                {
                    first.semantic_id
                } else {
                    0
                },
                inline_start,
                block_start,
                inline_extent,
                block_extent,
                ..PrimitiveRecord::default()
            });
            reserve(&mut self.draws, 1)?;
            self.draws.push(DrawRecord {
                id: first.stable_id,
                program_id: batch.key.program_id,
                program_variant: first.program_variant,
                material_id: if split_material { first.material_id } else { 0 },
                clip_id: first.clip_id,
                depth_key: first.depth_key,
                transform_id: if split_transform {
                    first.transform_id
                } else {
                    0
                },
                primitive_start: u32::try_from(primitive_start)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                primitive_count: 1,
                buffer_start: pending.buffer_start,
                buffer_count: u32::from(pending.buffer_count),
                resource_start: u32::try_from(resource_start)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                resource_count: 1,
                order_token: u32::try_from(input_index)
                    .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                indirect_buffer_id: pending.order_buffer_id,
                indirect_offset: first_record
                    .checked_mul(4)
                    .ok_or(StablePlanError::ArithmeticOverflow)?,
                ..DrawRecord::default()
            });
            input_index = end;
        }
        Ok(())
    }

    fn compile_independent_draws(
        &mut self,
        context: PrepareContext<'_>,
    ) -> Result<(), StablePlanError> {
        for pending_index in 0..self.pending_batches.len() {
            let pending = self.pending_batches[pending_index];
            let key = self.batches[pending.batch_index as usize].key;
            let program = context
                .policy
                .program(context.capability_set, key.technique, key.program_variant)
                .ok_or(StablePlanError::ProgramMissing)?;
            let split_material = program.draw_key_mask & BATCH_MATERIAL != 0;
            let split_transform = program.draw_key_mask & BATCH_TRANSFORM != 0;
            let input_indices =
                &self.batch_input_indices[range(pending.item_start, pending.item_count)?];
            let mut start = 0_usize;
            while start < input_indices.len() {
                let first_input = input_indices[start] as usize;
                let first = context.input.glyphs[first_input];
                let first_record = self.input_order_records[first_input];
                let mut end = start + 1;
                while end < input_indices.len() && end - start < usize::from(u16::MAX) {
                    let input_index = input_indices[end] as usize;
                    let glyph = context.input.glyphs[input_index];
                    if self.input_order_records[input_index] == first_record + (end - start) as u32
                        && draw_fields_compatible(first, glyph, split_material, split_transform)
                    {
                        end += 1;
                    } else {
                        break;
                    }
                }
                let count =
                    u16::try_from(end - start).map_err(|_| StablePlanError::ArithmeticOverflow)?;
                let (inline_start, block_start, inline_extent, block_extent) = indexed_span_bounds(
                    context.input.glyphs,
                    input_indices[start..end]
                        .iter()
                        .map(|input_index| *input_index as usize),
                )?;
                let resource_start = self
                    .resources
                    .iter()
                    .position(|resource| {
                        resource.id == first.resource_id
                            && resource.generation == first.resource_generation
                    })
                    .ok_or(StablePlanError::InvalidResource)?;
                let semantic_id = if input_indices[start..end].iter().all(|input_index| {
                    context.input.glyphs[*input_index as usize].semantic_id == first.semantic_id
                }) {
                    first.semantic_id
                } else {
                    0
                };
                let primitive_start = self.primitives.len();
                reserve(&mut self.primitives, 1)?;
                self.primitives.push(PrimitiveRecord {
                    id: first.stable_id,
                    kind: PRIMITIVE_GLYPH,
                    technique_id: first.technique.0,
                    resource_id: first.resource_id,
                    resource_generation: first.resource_generation,
                    program_id: key.program_id,
                    program_variant: first.program_variant,
                    record_count: count,
                    buffer_id: pending.order_buffer_id,
                    record_index: first_record,
                    logical_order: input_indices[start],
                    clip_id: first.clip_id,
                    semantic_id,
                    inline_start,
                    block_start,
                    inline_extent,
                    block_extent,
                    ..PrimitiveRecord::default()
                });
                reserve(&mut self.draws, 1)?;
                self.draws.push(DrawRecord {
                    id: first.stable_id,
                    program_id: key.program_id,
                    program_variant: first.program_variant,
                    material_id: if split_material { first.material_id } else { 0 },
                    clip_id: first.clip_id,
                    depth_key: first.depth_key,
                    transform_id: if split_transform {
                        first.transform_id
                    } else {
                        0
                    },
                    primitive_start: u32::try_from(primitive_start)
                        .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                    primitive_count: 1,
                    buffer_start: pending.buffer_start,
                    buffer_count: u32::from(pending.buffer_count),
                    resource_start: u32::try_from(resource_start)
                        .map_err(|_| StablePlanError::ArithmeticOverflow)?,
                    resource_count: 1,
                    order_token: input_indices[start],
                    indirect_buffer_id: pending.order_buffer_id,
                    indirect_offset: first_record
                        .checked_mul(4)
                        .ok_or(StablePlanError::ArithmeticOverflow)?,
                    ..DrawRecord::default()
                });
                start = end;
            }
        }
        self.draws.sort_unstable_by_key(|draw| draw.order_token);
        Ok(())
    }

    fn same_draw_span(
        &self,
        glyphs: &[StableGlyph],
        start: usize,
        next: usize,
        pending_index: usize,
        first_record: u32,
        split_material: bool,
        split_transform: bool,
    ) -> bool {
        let first = glyphs[start];
        let glyph = glyphs[next];
        self.input_batches[next] as usize == pending_index
            && self.input_order_records[next] == first_record + (next - start) as u32
            && glyph.technique == first.technique
            && glyph.program_variant == first.program_variant
            && glyph.resource_id == first.resource_id
            && glyph.resource_generation == first.resource_generation
            && draw_fields_compatible(first, glyph, split_material, split_transform)
    }

    fn next_buffer_identity(
        &mut self,
        previous: Option<(u32, u32, usize)>,
        replace: bool,
    ) -> Result<(u32, u32), StablePlanError> {
        if let Some((id, generation, _)) = previous {
            return Ok((
                id,
                if replace {
                    generation
                        .checked_add(1)
                        .ok_or(StablePlanError::IdentifierExhausted)?
                } else {
                    generation
                },
            ));
        }
        self.pending_next_buffer_id = self
            .pending_next_buffer_id
            .checked_add(1)
            .ok_or(StablePlanError::IdentifierExhausted)?;
        Ok((self.pending_next_buffer_id, 1))
    }

    fn allocate_buffer(
        &mut self,
        id: u32,
        generation: u32,
        program_id: u32,
        schema: BufferSchema,
        capacity: u32,
    ) -> Result<(), StablePlanError> {
        reserve(&mut self.pending_allocations, 1)?;
        self.pending_allocations.push(PendingAllocation {
            state: PhysicalBufferState::new(id, generation, program_id, schema, capacity)?,
        });
        Ok(())
    }

    fn retire_buffer(
        &mut self,
        id: u32,
        generation: u32,
        byte_length: usize,
        publication_generation: u32,
    ) -> Result<(), StablePlanError> {
        reserve(&mut self.retirements, 1)?;
        self.retirements.push(RetirementRecord {
            kind: RETIRE_BUFFER,
            id,
            generation,
            after_publication_generation: publication_generation,
            byte_length: u32::try_from(byte_length)
                .map_err(|_| StablePlanError::ArithmeticOverflow)?,
            ..RetirementRecord::default()
        });
        Ok(())
    }

    fn commit_batch_storage(
        &mut self,
        batch_index: usize,
        pending_index: u32,
    ) -> Result<(), StablePlanError> {
        if pending_index == NONE {
            self.batches[batch_index].buffers.clear();
            self.batches[batch_index].order_buffer = None;
            return Ok(());
        }
        let pending = self.pending_batches[pending_index as usize];
        let batch = &mut self.batches[batch_index];
        mem::swap(&mut batch.buffers, &mut batch.spare_buffers);
        batch.buffers.clear();
        for index in 0..usize::from(pending.buffer_count.saturating_sub(1)) {
            let id = pending.buffer_ids[index];
            let generation = pending.buffer_generations[index];
            let mut buffer = if let Some(allocation) =
                take_allocation(&mut self.pending_allocations, id, generation)
            {
                allocation.state
            } else {
                let position = batch
                    .spare_buffers
                    .iter()
                    .position(|buffer| buffer.id == id && buffer.generation == generation)
                    .ok_or(StablePlanError::InvalidIdentity)?;
                batch.spare_buffers.swap_remove(position)
            };
            apply_writes(&mut buffer, &self.patches, &self.payload)?;
            batch.buffers.push(buffer);
        }
        batch.spare_buffers.clear();
        let mut order_buffer = if let Some(allocation) = take_allocation(
            &mut self.pending_allocations,
            pending.order_buffer_id,
            pending.order_buffer_generation,
        ) {
            allocation.state
        } else {
            batch
                .order_buffer
                .take()
                .filter(|buffer| {
                    buffer.id == pending.order_buffer_id
                        && buffer.generation == pending.order_buffer_generation
                })
                .ok_or(StablePlanError::InvalidIdentity)?
        };
        apply_writes(&mut order_buffer, &self.patches, &self.payload)?;
        batch.order_buffer = Some(order_buffer);
        Ok(())
    }

    fn prepare_identity_set(&mut self, count: usize) -> Result<(), StablePlanError> {
        let required = count
            .checked_mul(2)
            .and_then(usize::checked_next_power_of_two)
            .unwrap_or(usize::MAX)
            .max(8);
        if required == usize::MAX {
            return Err(StablePlanError::ArithmeticOverflow);
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
}

fn stable_active_buffers(
    policy: &ValidatedPolicy,
    capability_set: CapabilitySetId,
    program: &super::policy::ProgramDescriptor,
    input: StablePlanInput<'_>,
    writes: &[SlotWrite],
    changed: RecordRange,
    replace: bool,
) -> Result<u32, StablePlanError> {
    let all = (1_u32 << program.buffers.len()) - 1;
    if replace {
        return Ok(all);
    }
    let dependencies = policy
        .buffer_dependency_masks(capability_set, program.technique, program.variant)
        .ok_or(StablePlanError::ProgramMissing)?;
    let mut active = 0_u32;
    for write in writes
        .iter()
        .filter(|write| write.changed && (changed.start..changed.end).contains(&write.slot))
    {
        let mask = input
            .semantic_change_masks
            .get(write.input_index as usize)
            .copied()
            .unwrap_or(super::positioning::ALL_SEMANTIC_CHANGES);
        if mask == super::positioning::ALL_SEMANTIC_CHANGES {
            return Ok(all);
        }
        for (index, &dependency) in dependencies.iter().enumerate() {
            if dependency & mask != 0 {
                active |= 1 << index;
            }
        }
    }
    Ok(active)
}

fn order_schema() -> BufferSchema {
    BufferSchema::packed(
        BufferId(POLICY_BUFFER_ORDER),
        ScalarType::U32,
        1,
        BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
        1,
    )
}

fn range(start: u32, count: u32) -> Result<core::ops::Range<usize>, StablePlanError> {
    let end = start
        .checked_add(count)
        .ok_or(StablePlanError::ArithmeticOverflow)?;
    Ok(start as usize..end as usize)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), StablePlanError> {
    values
        .try_reserve(additional)
        .map_err(|_| StablePlanError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::policy::{
        BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE, CAP_STABLE_INDIRECT,
        CapabilitySet, Operation, PolicyDescriptor, ProgramCapabilities, ProgramDescriptor,
        ProgramId,
    };
    use crate::engine::render_plan_wire::plan_layout;
    use alloc::vec;

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const TECHNIQUE: TechniqueId = TechniqueId(1);

    #[test]
    fn insertion_writes_one_new_physical_record_and_one_order_chunk() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[1.0, 2.0, 3.0],
            true,
            1,
            0,
        );
        let first = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(first.buffers.len(), 2);
        assert_eq!(first.patches.len(), 4);
        assert_eq!(first.primitives.len(), 1);
        assert_eq!(first.primitives[0].record_count, 3);
        assert_eq!(
            first.primitives[0].buffer_id,
            first.draws[0].indirect_buffer_id
        );
        assert_eq!(first.draws[0].buffer_count, 2);
        assert!(plan_layout(first).is_ok(), "{:?}", plan_layout(first));
        compiler.commit().unwrap();

        let inserted = [glyph(1, 1), glyph(4, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &policy,
            &inserted,
            &[1.0, 4.0, 2.0, 3.0],
            false,
            2,
            0,
        );
        let delta = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 2);
        assert_eq!(delta.patches[0].destination_offset, 12);
        assert_eq!(delta.patches[0].byte_length, 4);
        assert_eq!(delta.patches[1].destination_offset, 0);
        assert_eq!(delta.patches[1].byte_length, 16);
        assert_eq!(delta.payload.len(), 20);
        assert_eq!(compiler.input_slots, [0, 3, 1, 2]);
        compiler.commit().unwrap();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 12), 4.0);
        assert_eq!(read_u32(compiler.buffer_bytes(2).unwrap(), 4), 3);
    }

    #[test]
    fn stable_semantic_dependencies_suppress_unrelated_physical_buffer_writes() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        prepare(&mut compiler, &policy, &[glyph(1, 1)], &[1.0], true, 1, 0);
        compiler.commit().unwrap();

        let mut block_changed = glyph(1, 2);
        block_changed.block_start = 4.0;
        compiler
            .prepare(
                &policy,
                CAPABILITY,
                StablePlanInput {
                    glyphs: &[block_changed],
                    semantic_change_masks: &[1 << 1],
                    f32_fields: &[&[1.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                2,
                0,
            )
            .unwrap();
        assert!(
            compiler
                .plan_view(7, CAPABILITY, policy.fingerprint())
                .unwrap()
                .patches
                .is_empty()
        );
        compiler.commit().unwrap();

        compiler
            .prepare(
                &policy,
                CAPABILITY,
                StablePlanInput {
                    glyphs: &[glyph(1, 3)],
                    semantic_change_masks: &[1],
                    f32_fields: &[&[2.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                3,
                0,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.patches.len(), 1);
        assert_eq!(plan.payload, 2.0_f32.to_le_bytes());
    }

    #[test]
    fn reorder_changes_only_the_indirection_buffer() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[1.0, 2.0, 3.0],
            true,
            1,
            0,
        );
        compiler.commit().unwrap();
        let reordered = [glyph(3, 1), glyph(1, 1), glyph(2, 1)];
        prepare(
            &mut compiler,
            &policy,
            &reordered,
            &[3.0, 1.0, 2.0],
            false,
            2,
            0,
        );
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.patches.len(), 1);
        assert_eq!(plan.patches[0].buffer_id, 2);
        assert_eq!(plan.payload.len(), 12);
    }

    #[test]
    fn no_op_publishes_nothing_and_abort_preserves_physical_bytes() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1)];
        prepare(&mut compiler, &policy, &initial, &[1.0, 2.0], true, 1, 0);
        compiler.commit().unwrap();
        prepare(&mut compiler, &policy, &initial, &[99.0, 99.0], false, 2, 0);
        let no_op = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert!(no_op.resources.is_empty());
        assert!(no_op.buffers.is_empty());
        assert!(no_op.patches.is_empty());
        assert!(no_op.primitives.is_empty());
        assert!(no_op.draws.is_empty());
        compiler.commit().unwrap();

        let changed = [glyph(1, 2), glyph(2, 1)];
        prepare(&mut compiler, &policy, &changed, &[10.0, 2.0], false, 3, 0);
        compiler.abort();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 0), 1.0);
    }

    #[test]
    fn deleted_slots_wait_for_an_explicit_renderer_fence() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[1.0, 2.0, 3.0],
            true,
            1,
            0,
        );
        compiler.commit().unwrap();
        prepare(
            &mut compiler,
            &policy,
            &initial[..2],
            &[1.0, 2.0],
            false,
            2,
            0,
        );
        assert!(
            compiler
                .plan_view(7, CAPABILITY, policy.fingerprint())
                .unwrap()
                .retirements
                .iter()
                .any(|retirement| retirement.kind == RETIRE_SLOT_RANGE)
        );
        compiler.commit().unwrap();

        let added = [glyph(1, 1), glyph(2, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &added,
            &[1.0, 2.0, 4.0],
            false,
            3,
            0,
        );
        assert_eq!(compiler.input_slots[2], 3);
        compiler.abort();
        prepare(
            &mut compiler,
            &policy,
            &added,
            &[1.0, 2.0, 4.0],
            false,
            3,
            2,
        );
        assert_eq!(compiler.input_slots[2], 2);
    }

    #[test]
    fn an_inactive_batch_stays_live_only_until_its_quarantine_is_acknowledged() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1)];
        prepare(&mut compiler, &policy, &initial, &[1.0], true, 1, 0);
        compiler.commit().unwrap();

        prepare(&mut compiler, &policy, &[], &[], false, 2, 0);
        compiler.commit().unwrap();
        assert!(compiler.has_state());

        prepare(&mut compiler, &policy, &[], &[], false, 3, 2);
        compiler.commit().unwrap();
        assert!(!compiler.has_state());
    }

    #[test]
    fn interleaved_resources_keep_ordered_draws_over_separate_stable_pools() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        prepare(
            &mut compiler,
            &policy,
            &glyphs,
            &[1.0, 2.0, 3.0, 4.0],
            true,
            1,
            0,
        );
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.resources.len(), 2);
        assert_eq!(plan.buffers.len(), 4);
        assert_eq!(plan.primitives.len(), 3);
        assert_eq!(plan.draws.len(), 3);
        assert_eq!(plan.primitives[0].record_count, 2);
        assert_eq!(plan.draws[0].order_token, 0);
        assert_eq!(plan.draws[1].order_token, 2);
        assert_eq!(plan.draws[2].order_token, 3);
        assert!(plan_layout(plan).is_ok(), "{:?}", plan_layout(plan));
    }

    #[test]
    fn independent_compositing_batches_interleaved_stable_resources() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        compiler
            .prepare(
                &policy,
                CAPABILITY,
                StablePlanInput {
                    glyphs: &glyphs,
                    semantic_change_masks: &[],
                    f32_fields: &[&[1.0, 2.0, 3.0, 4.0]],
                    u32_fields: &[],
                    order_independent: true,
                },
                true,
                1,
                0,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(plan.draws.len(), 2);
        assert_eq!(plan.primitives.len(), 2);
        assert_eq!(plan.primitives[0].resource_id, 11);
        assert_eq!(plan.primitives[0].record_count, 3);
        assert_eq!(plan.primitives[1].resource_id, 12);
        assert_eq!(plan.primitives[1].record_count, 1);
        assert_eq!(plan.draws[0].order_token, 0);
        assert_eq!(plan.draws[1].order_token, 2);
        assert!(plan_layout(plan).is_ok(), "{:?}", plan_layout(plan));
    }

    #[test]
    fn material_splits_draws_without_splitting_stable_storage() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &policy, &glyphs, &[1.0, 2.0], true, 1, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(plan.draws.len(), 2);
        assert_eq!(plan.draws[0].material_id, 1);
        assert_eq!(plan.draws[1].material_id, 2);
        assert_eq!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
    }

    #[test]
    fn policy_can_partition_stable_storage_by_material() {
        let policy = policy(true);
        let mut compiler = StablePlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &policy, &glyphs, &[1.0, 2.0], true, 1, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.buffers.len(), 4);
        assert_eq!(plan.draws.len(), 2);
        assert_ne!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
    }

    #[test]
    fn repeated_warm_updates_keep_all_glyph_scaled_scratch_capacity() {
        let policy = policy(false);
        let mut compiler = StablePlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &initial,
            &[1.0, 2.0, 3.0, 4.0],
            true,
            1,
            0,
        );
        compiler.commit().unwrap();
        let changed = [glyph(1, 1), glyph(2, 2), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &policy,
            &changed,
            &[1.0, 20.0, 3.0, 4.0],
            false,
            2,
            0,
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
            3,
            0,
        );
        compiler.commit().unwrap();
        assert_eq!(capacities(&compiler), settled);
    }

    #[test]
    fn fragmentation_budget_rebases_only_the_order_buffer() {
        let policy = policy_with_budget(false, 1);
        let mut compiler = StablePlanCompiler::default();
        let seeded: Vec<_> = (1..=129).map(|id| glyph(id, 1)).collect();
        let seeded_x: Vec<_> = seeded.iter().map(|glyph| glyph.stable_id as f32).collect();
        prepare(&mut compiler, &policy, &seeded, &seeded_x, true, 1, 0);
        compiler.commit().unwrap();
        let initial = &seeded[..127];
        let initial_x = &seeded_x[..127];
        prepare(&mut compiler, &policy, initial, initial_x, false, 2, 0);
        compiler.commit().unwrap();

        let mut inserted = initial.to_vec();
        inserted.insert(64, glyph(200, 1));
        let inserted_x: Vec<_> = inserted
            .iter()
            .map(|glyph| glyph.stable_id as f32)
            .collect();
        prepare(&mut compiler, &policy, &inserted, &inserted_x, false, 3, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert_eq!(plan.primitives.len(), 1);
        assert_eq!(plan.primitives[0].record_count, 128);
        assert_eq!(plan.buffers[0].generation, 1);
        assert_eq!(plan.buffers[1].generation, 2);
        assert!(plan.retirements.iter().any(|retirement| {
            retirement.kind == RETIRE_BUFFER
                && retirement.id == plan.buffers[1].id
                && retirement.generation == 1
        }));
        assert!(!plan.patches.iter().any(|patch| {
            patch.opcode == PATCH_ALLOCATE_OR_RESIZE && patch.buffer_id == plan.buffers[0].id
        }));
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare(
        compiler: &mut StablePlanCompiler,
        policy: &ValidatedPolicy,
        glyphs: &[StableGlyph],
        x: &[f32],
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) {
        compiler
            .prepare(
                policy,
                CAPABILITY,
                StablePlanInput {
                    glyphs,
                    semantic_change_masks: &[],
                    f32_fields: &[x],
                    u32_fields: &[],
                    order_independent: false,
                },
                checkpoint,
                publication_generation,
                acknowledged_publication_generation,
            )
            .unwrap();
    }

    fn glyph(stable_id: u32, content_revision: u32) -> StableGlyph {
        StableGlyph {
            stable_id,
            content_revision,
            technique: TECHNIQUE,
            program_variant: 0,
            resource_id: 11,
            resource_generation: 1,
            resource_kind: 1,
            resource_reference: 99,
            semantic_id: 1,
            transform_id: 1,
            material_id: 1,
            clip_id: 0,
            depth_key: 0,
            inline_start: stable_id as f32,
            block_start: 0.0,
            inline_extent: 1.0,
            block_extent: 1.0,
        }
    }

    fn policy(partition_materials: bool) -> ValidatedPolicy {
        policy_with_budget(partition_materials, 8)
    }

    fn policy_with_budget(partition_materials: bool, fragmentation_budget: u16) -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CAPABILITY,
                flags: CAP_STABLE_INDIRECT,
                max_buffer_bytes: 1024,
                update_alignment: 4,
                coalesce_gap_bytes: 0,
                range_call_penalty_bytes: 0,
                max_buffers_per_draw: 2,
                max_resources_per_draw: 1,
                max_indirect_draws: 0,
                fragmentation_budget,
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
                    | BATCH_ORDER
                    | crate::engine::policy::BATCH_TRANSFORM,
                allocation_strategy: ALLOCATION_STABLE_INDIRECT,
                f32_input_count: 1,
                u32_input_count: 0,
                inputs: vec![crate::engine::policy::InputSource::semantic(0)],
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

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn capacities(compiler: &StablePlanCompiler) -> Vec<usize> {
        let mut values = vec![
            compiler.batches.capacity(),
            compiler.pending_batches.capacity(),
            compiler.batch_pending_indices.capacity(),
            compiler.input_batches.capacity(),
            compiler.input_slots.capacity(),
            compiler.input_order_records.capacity(),
            compiler.batch_input_indices.capacity(),
            compiler.batch_identities.capacity(),
            compiler.order_entries.capacity(),
            compiler.order_chunk_scratch.capacity(),
            compiler.slot_writes.capacity(),
            compiler.changed_ranges.capacity(),
            compiler.identity_keys.capacity(),
            compiler.identity_epochs.capacity(),
            compiler.pending_allocations.capacity(),
            compiler.resources.capacity(),
            compiler.plan_buffers.capacity(),
            compiler.primitives.capacity(),
            compiler.draws.capacity(),
            compiler.live_primitives.capacity(),
            compiler.live_draws.capacity(),
            compiler.patches.capacity(),
            compiler.retirements.capacity(),
            compiler.payload.capacity(),
        ];
        for batch in &compiler.batches {
            values.extend_from_slice(&batch.slots.scratch_capacities());
            values.extend_from_slice(&batch.order.scratch_capacities());
            values.extend_from_slice(&[
                batch.buffers.capacity(),
                batch.spare_buffers.capacity(),
                batch.quarantined_chunks.capacity(),
                batch.pending_retired_chunks.capacity(),
                batch.reclaim_scratch.capacity(),
            ]);
        }
        values
    }
}
