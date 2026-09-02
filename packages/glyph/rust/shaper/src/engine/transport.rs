use alloc::vec::Vec;
use core::slice;

use crate::{
    STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE,
    abi_contract::{
        ABI_VERSION, ENGINE_RESULT_ABI_VERSION, ENGINE_RESULT_BUFFER_COUNT,
        ENGINE_RESULT_BUFFERS_OFFSET, ENGINE_RESULT_BYTE_LENGTH, ENGINE_RESULT_CAPABILITY_SET,
        ENGINE_RESULT_DIAGNOSTIC_COUNT, ENGINE_RESULT_DIAGNOSTICS_OFFSET, ENGINE_RESULT_DRAW_COUNT,
        ENGINE_RESULT_DRAWS_OFFSET, ENGINE_RESULT_ENGINE_REVISION,
        ENGINE_RESULT_FAULT_PARAGRAPH_ID, ENGINE_RESULT_FAULT_STYLE_ID, ENGINE_RESULT_FLAGS,
        ENGINE_RESULT_HEADER_ALIGNMENT, ENGINE_RESULT_HEADER_SIZE, ENGINE_RESULT_OUTPUT_SLOT,
        ENGINE_RESULT_PATCH_COUNT, ENGINE_RESULT_PATCHES_OFFSET, ENGINE_RESULT_PLAN_REVISION,
        ENGINE_RESULT_PLANNER_ID, ENGINE_RESULT_POLICY_FINGERPRINT_HIGH,
        ENGINE_RESULT_POLICY_FINGERPRINT_LOW, ENGINE_RESULT_POLICY_HANDLE,
        ENGINE_RESULT_PRIMITIVE_COUNT, ENGINE_RESULT_PRIMITIVES_OFFSET,
        ENGINE_RESULT_PUBLICATION_GENERATION, ENGINE_RESULT_REQUEST_CAPACITY,
        ENGINE_RESULT_REQUIRED_BASE_REVISION, ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY,
        ENGINE_RESULT_REQUIRED_RESULT_CAPACITY, ENGINE_RESULT_RESOURCE_COUNT,
        ENGINE_RESULT_RESOURCES_OFFSET, ENGINE_RESULT_RESULT_CAPACITY,
        ENGINE_RESULT_RETIREMENT_COUNT, ENGINE_RESULT_RETIREMENTS_OFFSET,
        ENGINE_RESULT_SEMANTICS_COUNT, ENGINE_RESULT_SEMANTICS_OFFSET, ENGINE_RESULT_STATUS,
        ENGINE_UPDATE_BATCH_ENTRY_SIZE, ENGINE_UPDATE_BATCH_PLANNER_ID,
        ENGINE_UPDATE_BATCH_REQUEST_LENGTH, ENGINE_UPDATE_BATCH_RESULT_POINTER,
        ENGINE_UPDATE_BATCH_STATUS, ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    },
    engine::{
        frame::{CommittedUpdate, PlannerRevision, RESULT_FLAG_CHECKPOINT},
        render_plan::RenderPlanView,
        render_plan_wire::{EncodedPlanLayout, encode_publication, encode_query},
        semantic_view::SemanticRecord,
        state::FrameFault,
    },
    wire::{read_u32, write_u32},
};

const ARENA_ALIGNMENT: usize = 16;
const MAX_ARENA_BYTES: u32 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UpdateBatchResult {
    pub result_pointer: u32,
    pub status: u32,
}

#[derive(Default)]
pub(crate) struct UpdateBatchTransport {
    arena: AlignedArena,
    planner_ids: Vec<u32>,
}

impl UpdateBatchTransport {
    pub fn reserve(&mut self, count: u32) -> Result<(), u32> {
        let required = count
            .checked_mul(ENGINE_UPDATE_BATCH_ENTRY_SIZE)
            .ok_or(STATUS_RESULT_TOO_LARGE)?;
        let target = growth_capacity(self.arena.capacity(), required)?;
        let target_count = usize::try_from(target / ENGINE_UPDATE_BATCH_ENTRY_SIZE)
            .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
        if target_count > self.planner_ids.capacity() {
            self.planner_ids
                .try_reserve_exact(target_count - self.planner_ids.len())
                .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
        }
        self.arena.reserve(required)
    }

    pub fn pointer(&self) -> usize {
        if self.arena.capacity() == 0 {
            0
        } else {
            self.arena.pointer()
        }
    }

    pub fn capacity(&self) -> u32 {
        self.arena.capacity() / ENGINE_UPDATE_BATCH_ENTRY_SIZE
    }

    /// Validates the complete descriptor table before invoking any entry. This makes duplicate
    /// planner IDs and malformed table bounds batch-level errors with no planner mutation.
    pub fn process(
        &mut self,
        entries_pointer: usize,
        count: u32,
        mut update: impl FnMut(u32, u32) -> UpdateBatchResult,
    ) -> u32 {
        let Some(byte_length) = count.checked_mul(ENGINE_UPDATE_BATCH_ENTRY_SIZE) else {
            return STATUS_INVALID_REQUEST;
        };
        if entries_pointer != self.pointer() || count > self.capacity() {
            return STATUS_INVALID_REQUEST;
        }
        let Ok(byte_length) = usize::try_from(byte_length) else {
            return STATUS_INVALID_REQUEST;
        };
        let Some(entries) = self.arena.bytes().get(..byte_length) else {
            return STATUS_INVALID_REQUEST;
        };
        self.planner_ids.clear();
        for index in 0..count as usize {
            let Some(planner_id) = entry_u32(entries, index, ENGINE_UPDATE_BATCH_PLANNER_ID) else {
                return STATUS_INVALID_REQUEST;
            };
            if planner_id == 0 {
                return STATUS_INVALID_REQUEST;
            }
            if self.planner_ids.len() == self.planner_ids.capacity() {
                return STATUS_RESULT_TOO_LARGE;
            }
            self.planner_ids.push(planner_id);
        }
        self.planner_ids.sort_unstable();
        if self.planner_ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return STATUS_INVALID_REQUEST;
        }
        for index in 0..count as usize {
            let planner_id =
                match entry_u32(self.arena.bytes(), index, ENGINE_UPDATE_BATCH_PLANNER_ID) {
                    Some(value) => value,
                    None => return STATUS_INVALID_REQUEST,
                };
            let request_length = match entry_u32(
                self.arena.bytes(),
                index,
                ENGINE_UPDATE_BATCH_REQUEST_LENGTH,
            ) {
                Some(value) => value,
                None => return STATUS_INVALID_REQUEST,
            };
            let result = update(planner_id, request_length);
            let Some(entry) = entry_mut(self.arena.bytes_mut(), index) else {
                return STATUS_INVALID_REQUEST;
            };
            write_u32(
                entry,
                ENGINE_UPDATE_BATCH_RESULT_POINTER,
                result.result_pointer,
            );
            write_u32(entry, ENGINE_UPDATE_BATCH_STATUS, result.status);
        }
        0
    }

    #[cfg(test)]
    fn entries_mut(&mut self) -> &mut [u8] {
        self.arena.bytes_mut()
    }
}

fn entry_u32(bytes: &[u8], index: usize, field: usize) -> Option<u32> {
    let entry = entry(bytes, index)?;
    read_u32(entry, field).ok()
}

fn entry(bytes: &[u8], index: usize) -> Option<&[u8]> {
    let size = ENGINE_UPDATE_BATCH_ENTRY_SIZE as usize;
    let start = index.checked_mul(size)?;
    bytes.get(start..start.checked_add(size)?)
}

fn entry_mut(bytes: &mut [u8], index: usize) -> Option<&mut [u8]> {
    let size = ENGINE_UPDATE_BATCH_ENTRY_SIZE as usize;
    let start = index.checked_mul(size)?;
    bytes.get_mut(start..start.checked_add(size)?)
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
struct ArenaBlock([u8; ARENA_ALIGNMENT]);

pub(crate) struct FrameTransport {
    request: AlignedArena,
    outputs: [AlignedArena; 2],
    active_slot: Option<usize>,
    publication_generation: u32,
}

impl FrameTransport {
    pub fn new(request_capacity: u32, result_capacity: u32) -> Result<Self, u32> {
        if request_capacity < ENGINE_UPDATE_REQUEST_HEADER_SIZE
            || result_capacity < ENGINE_RESULT_HEADER_SIZE
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        Ok(Self {
            request: AlignedArena::new(request_capacity)?,
            outputs: [
                AlignedArena::new(result_capacity)?,
                AlignedArena::new(result_capacity)?,
            ],
            active_slot: None,
            publication_generation: 0,
        })
    }

    pub fn reserve(&mut self, request_capacity: u32, result_capacity: u32) -> Result<(), u32> {
        if request_capacity < ENGINE_UPDATE_REQUEST_HEADER_SIZE
            || result_capacity < ENGINE_RESULT_HEADER_SIZE
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        self.request.reserve(request_capacity)?;
        self.outputs[0].reserve(result_capacity)?;
        self.outputs[1].reserve(result_capacity)
    }

    pub fn request_pointer(&self) -> usize {
        self.request.pointer()
    }

    pub fn request_capacity(&self) -> u32 {
        self.request.capacity()
    }

    pub fn result_capacity(&self) -> u32 {
        self.outputs[0].capacity().min(self.outputs[1].capacity())
    }

    pub fn result_status(&self, pointer: usize) -> Option<u32> {
        self.outputs
            .iter()
            .find(|output| output.pointer() == pointer)
            .and_then(|output| read_u32(output.bytes(), ENGINE_RESULT_STATUS).ok())
    }

    pub fn request_at(&self, pointer: usize, length: u32) -> Result<&[u8], u32> {
        if pointer != self.request.pointer() || length > self.request.capacity() {
            return Err(STATUS_INVALID_REQUEST);
        }
        self.request
            .bytes()
            .get(..usize::try_from(length).map_err(|_| STATUS_INVALID_REQUEST)?)
            .ok_or(STATUS_INVALID_REQUEST)
    }

    pub fn request_at_current(&self, length: u32) -> Result<&[u8], u32> {
        self.request_at(self.request.pointer(), length)
    }

    pub fn ensure_publish_capacity(&self, byte_length: u32) -> Result<(), u32> {
        if byte_length <= self.result_capacity() {
            Ok(())
        } else {
            Err(STATUS_RESULT_TOO_LARGE)
        }
    }

    /// Grows only the inactive output. The currently published pointer remains valid until the
    /// normal next successful publication for this planner switches A/B ownership.
    pub fn reserve_publish_capacity(&mut self, byte_length: u32) -> Result<(), u32> {
        let slot = self.inactive_slot();
        self.outputs[slot].reserve(byte_length)
    }

    pub fn next_publication_generation(&self) -> Result<u32, u32> {
        self.publication_generation
            .checked_add(1)
            .ok_or(STATUS_RESULT_TOO_LARGE)
    }

    #[cfg(test)]
    pub fn stage_plan(&mut self, plan: RenderPlanView<'_>) -> Result<StagedPlan, u32> {
        self.stage_publication(plan, &[])
    }

    pub fn stage_publication(
        &mut self,
        plan: RenderPlanView<'_>,
        semantic_views: &[SemanticRecord],
    ) -> Result<StagedPlan, u32> {
        let slot = self.inactive_slot();
        let layout = encode_publication(plan, semantic_views, self.outputs[slot].bytes_mut())?;
        Ok(StagedPlan {
            slot,
            policy_handle: plan.policy_handle,
            capability_set: plan.capability_set,
            policy_fingerprint: plan.policy_fingerprint,
            layout,
        })
    }

    /// Encodes a complete detached checkpoint without advancing publication state.
    pub fn stage_detached_plan(
        &mut self,
        planner_id: u32,
        revision: PlannerRevision,
        plan: RenderPlanView<'_>,
        max_output_bytes: u32,
    ) -> Result<usize, u32> {
        let slot = self.inactive_slot();
        let layout = encode_publication(plan, &[], self.outputs[slot].bytes_mut())?;
        if layout.byte_length > max_output_bytes {
            return Err(STATUS_RESULT_TOO_LARGE);
        }
        self.write_header(
            slot,
            HeaderValues {
                status: 0,
                fault: FrameFault::default(),
                flags: RESULT_FLAG_CHECKPOINT,
                planner_id,
                revision,
                required_base_revision: 0,
                publication_generation: self.publication_generation,
                required_request_capacity: 0,
                required_result_capacity: 0,
                policy_handle: plan.policy_handle,
                capability_set: plan.capability_set,
                policy_fingerprint: plan.policy_fingerprint,
                layout,
            },
        );
        Ok(self.outputs[slot].pointer())
    }

    pub fn publish_success(&mut self, commit: CommittedUpdate, staged: StagedPlan) -> usize {
        debug_assert_eq!(staged.slot, self.inactive_slot());
        let generation = self.publication_generation + 1;
        self.write_header(
            staged.slot,
            HeaderValues {
                status: 0,
                flags: if commit.checkpoint {
                    RESULT_FLAG_CHECKPOINT
                } else {
                    0
                },
                planner_id: commit.planner_id,
                revision: commit.revision,
                required_base_revision: commit.required_base_revision,
                publication_generation: generation,
                required_request_capacity: 0,
                fault: FrameFault::default(),
                required_result_capacity: 0,
                policy_handle: staged.policy_handle,
                capability_set: staged.capability_set,
                policy_fingerprint: staged.policy_fingerprint,
                layout: staged.layout,
            },
        );
        self.active_slot = Some(staged.slot);
        self.publication_generation = generation;
        self.outputs[staged.slot].pointer()
    }

    /// Stages a query result in the inactive slot without publishing: the header and
    /// semantic table are written for the host to copy out before its next update call
    /// (host lease), while the active slot, publication generation, and A/B
    /// alternation stay untouched.
    pub fn stage_query(
        &mut self,
        planner_id: u32,
        revision: PlannerRevision,
        semantic_views: &[SemanticRecord],
    ) -> Result<usize, u32> {
        let slot = self.inactive_slot();
        let layout = encode_query(semantic_views, self.outputs[slot].bytes_mut())?;
        self.write_header(
            slot,
            HeaderValues {
                status: 0,
                fault: FrameFault::default(),
                flags: 0,
                planner_id,
                revision,
                required_base_revision: revision.plan,
                publication_generation: self.publication_generation,
                required_request_capacity: 0,
                required_result_capacity: 0,
                policy_handle: 0,
                capability_set: 0,
                policy_fingerprint: 0,
                layout,
            },
        );
        Ok(self.outputs[slot].pointer())
    }

    pub fn publish_failure(
        &mut self,
        planner_id: u32,
        revision: PlannerRevision,
        status: u32,
        fault: FrameFault,
        required_request_capacity: u32,
        required_result_capacity: u32,
    ) -> usize {
        let slot = self.inactive_slot();
        self.write_header(
            slot,
            HeaderValues {
                status,
                fault,
                flags: 0,
                planner_id,
                revision,
                required_base_revision: revision.plan,
                publication_generation: self.publication_generation,
                required_request_capacity,
                required_result_capacity,
                policy_handle: 0,
                capability_set: 0,
                policy_fingerprint: 0,
                layout: EncodedPlanLayout {
                    byte_length: ENGINE_RESULT_HEADER_SIZE,
                    ..EncodedPlanLayout::default()
                },
            },
        );
        self.outputs[slot].pointer()
    }

    fn inactive_slot(&self) -> usize {
        self.active_slot.map_or(0, |slot| slot ^ 1)
    }

    fn write_header(&mut self, slot: usize, values: HeaderValues) {
        let result_capacity = self.outputs[slot].capacity();
        let request_capacity = self.request.capacity();
        let bytes = self.outputs[slot].bytes_mut();
        bytes[..ENGINE_RESULT_HEADER_SIZE as usize].fill(0);
        write_u32(bytes, ENGINE_RESULT_ABI_VERSION, ABI_VERSION);
        write_u32(bytes, ENGINE_RESULT_BYTE_LENGTH, values.layout.byte_length);
        write_u32(bytes, ENGINE_RESULT_STATUS, values.status);
        write_u32(bytes, ENGINE_RESULT_FLAGS, values.flags);
        write_u32(bytes, ENGINE_RESULT_PLANNER_ID, values.planner_id);
        write_u32(bytes, ENGINE_RESULT_ENGINE_REVISION, values.revision.engine);
        write_u32(bytes, ENGINE_RESULT_PLAN_REVISION, values.revision.plan);
        write_u32(
            bytes,
            ENGINE_RESULT_REQUIRED_BASE_REVISION,
            values.required_base_revision,
        );
        write_u32(
            bytes,
            ENGINE_RESULT_PUBLICATION_GENERATION,
            values.publication_generation,
        );
        write_u32(bytes, ENGINE_RESULT_OUTPUT_SLOT, [0, 1][slot]);
        write_u32(bytes, ENGINE_RESULT_REQUEST_CAPACITY, request_capacity);
        write_u32(
            bytes,
            ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY,
            values.required_request_capacity,
        );
        write_u32(bytes, ENGINE_RESULT_RESULT_CAPACITY, result_capacity);
        write_u32(
            bytes,
            ENGINE_RESULT_REQUIRED_RESULT_CAPACITY,
            values.required_result_capacity,
        );
        write_u32(
            bytes,
            ENGINE_RESULT_FAULT_PARAGRAPH_ID,
            values.fault.paragraph_id,
        );
        write_u32(bytes, ENGINE_RESULT_FAULT_STYLE_ID, values.fault.style_id);
        write_u32(bytes, ENGINE_RESULT_POLICY_HANDLE, values.policy_handle);
        write_u32(bytes, ENGINE_RESULT_CAPABILITY_SET, values.capability_set);
        write_u32(
            bytes,
            ENGINE_RESULT_POLICY_FINGERPRINT_LOW,
            values.policy_fingerprint as u32,
        );
        write_u32(
            bytes,
            ENGINE_RESULT_POLICY_FINGERPRINT_HIGH,
            (values.policy_fingerprint >> 32) as u32,
        );
        write_span(
            bytes,
            ENGINE_RESULT_SEMANTICS_OFFSET,
            ENGINE_RESULT_SEMANTICS_COUNT,
            values.layout.semantic_views,
        );
        write_span(
            bytes,
            ENGINE_RESULT_RESOURCES_OFFSET,
            ENGINE_RESULT_RESOURCE_COUNT,
            values.layout.resources,
        );
        write_span(
            bytes,
            ENGINE_RESULT_BUFFERS_OFFSET,
            ENGINE_RESULT_BUFFER_COUNT,
            values.layout.buffers,
        );
        write_span(
            bytes,
            ENGINE_RESULT_PATCHES_OFFSET,
            ENGINE_RESULT_PATCH_COUNT,
            values.layout.patches,
        );
        write_span(
            bytes,
            ENGINE_RESULT_PRIMITIVES_OFFSET,
            ENGINE_RESULT_PRIMITIVE_COUNT,
            values.layout.primitives,
        );
        write_span(
            bytes,
            ENGINE_RESULT_DRAWS_OFFSET,
            ENGINE_RESULT_DRAW_COUNT,
            values.layout.draws,
        );
        write_span(
            bytes,
            ENGINE_RESULT_RETIREMENTS_OFFSET,
            ENGINE_RESULT_RETIREMENT_COUNT,
            values.layout.retirements,
        );
        write_span(
            bytes,
            ENGINE_RESULT_DIAGNOSTICS_OFFSET,
            ENGINE_RESULT_DIAGNOSTIC_COUNT,
            values.layout.diagnostics,
        );
    }
}

struct HeaderValues {
    status: u32,
    /// Identifiers the status names, all zero for a success and for a status that names none.
    fault: FrameFault,
    flags: u32,
    planner_id: u32,
    revision: PlannerRevision,
    required_base_revision: u32,
    publication_generation: u32,
    required_request_capacity: u32,
    required_result_capacity: u32,
    policy_handle: u32,
    capability_set: u32,
    policy_fingerprint: u64,
    layout: EncodedPlanLayout,
}

pub(crate) struct StagedPlan {
    slot: usize,
    policy_handle: u32,
    capability_set: u32,
    policy_fingerprint: u64,
    layout: EncodedPlanLayout,
}

fn write_span(
    bytes: &mut [u8],
    offset_field: usize,
    count_field: usize,
    span: super::render_plan_wire::TableSpan,
) {
    write_u32(bytes, offset_field, span.offset);
    write_u32(bytes, count_field, span.count);
}

#[derive(Default)]
struct AlignedArena {
    blocks: Vec<ArenaBlock>,
}

impl AlignedArena {
    fn new(required: u32) -> Result<Self, u32> {
        let mut arena = Self { blocks: Vec::new() };
        arena.reserve(required)?;
        Ok(arena)
    }

    fn reserve(&mut self, required: u32) -> Result<(), u32> {
        let current = self.capacity();
        let target = growth_capacity(current, required)?;
        if target == current {
            return Ok(());
        }
        let target_blocks =
            usize::try_from(target).map_err(|_| STATUS_RESULT_TOO_LARGE)? / ARENA_ALIGNMENT;
        self.blocks
            .try_reserve_exact(target_blocks - self.blocks.len())
            .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
        self.blocks
            .resize(target_blocks, ArenaBlock([0; ARENA_ALIGNMENT]));
        Ok(())
    }

    fn capacity(&self) -> u32 {
        u32::try_from(self.blocks.len() * ARENA_ALIGNMENT).unwrap_or(MAX_ARENA_BYTES)
    }

    fn pointer(&self) -> usize {
        self.blocks.as_ptr() as usize
    }

    fn bytes(&self) -> &[u8] {
        // SAFETY: `ArenaBlock` is exactly 16 initialized bytes with no padding, and the returned
        // slice shares the lifetime and immutability of the source block slice.
        unsafe {
            slice::from_raw_parts(
                self.blocks.as_ptr().cast::<u8>(),
                self.blocks.len() * ARENA_ALIGNMENT,
            )
        }
    }

    fn bytes_mut(&mut self) -> &mut [u8] {
        // SAFETY: `ArenaBlock` is exactly 16 initialized bytes with no padding, and the returned
        // slice is the sole mutable borrow of the source block slice.
        unsafe {
            slice::from_raw_parts_mut(
                self.blocks.as_mut_ptr().cast::<u8>(),
                self.blocks.len() * ARENA_ALIGNMENT,
            )
        }
    }
}

fn growth_capacity(current: u32, required: u32) -> Result<u32, u32> {
    let required = aligned_capacity(required)?;
    if required <= current {
        return Ok(current);
    }
    let doubled = current.checked_mul(2).unwrap_or(MAX_ARENA_BYTES);
    let target = required.max(doubled).min(MAX_ARENA_BYTES);
    if target < required {
        Err(STATUS_RESULT_TOO_LARGE)
    } else {
        Ok(target)
    }
}

fn aligned_capacity(required: u32) -> Result<u32, u32> {
    if required > MAX_ARENA_BYTES {
        return Err(STATUS_RESULT_TOO_LARGE);
    }
    required
        .checked_add((ARENA_ALIGNMENT - 1) as u32)
        .map(|value| value & !((ARENA_ALIGNMENT - 1) as u32))
        .filter(|value| *value <= MAX_ARENA_BYTES)
        .ok_or(STATUS_RESULT_TOO_LARGE)
}

const _: () = assert!(core::mem::size_of::<ArenaBlock>() == ARENA_ALIGNMENT);
const _: () = assert!(core::mem::align_of::<ArenaBlock>() == ARENA_ALIGNMENT);
const _: () = assert!(ENGINE_RESULT_HEADER_ALIGNMENT as usize == ARENA_ALIGNMENT);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        STATUS_PLANNER_MISSING,
        abi_contract::{
            ENGINE_RESULT_POLICY_HANDLE, ENGINE_UPDATE_BATCH_PLANNER_ID,
            ENGINE_UPDATE_BATCH_REQUEST_LENGTH, ENGINE_UPDATE_BATCH_RESULT_POINTER,
            ENGINE_UPDATE_BATCH_STATUS, PATCH_PAYLOAD_OFFSET,
        },
        engine::render_plan::{BUFFER_ORDERED_DIRECT, BufferRecord, PATCH_WRITE, PatchRecord},
    };

    #[test]
    fn arenas_are_aligned_and_double_without_losing_request_bytes() {
        let mut transport =
            FrameTransport::new(ENGINE_UPDATE_REQUEST_HEADER_SIZE, ENGINE_RESULT_HEADER_SIZE)
                .unwrap();
        assert_eq!(transport.request_pointer() % ARENA_ALIGNMENT, 0);
        transport.request.bytes_mut()[0] = 7;
        let initial = transport.request_capacity();
        transport
            .reserve(initial + 1, ENGINE_RESULT_HEADER_SIZE)
            .unwrap();
        assert_eq!(transport.request_capacity(), initial * 2);
        assert_eq!(transport.request.bytes()[0], 7);
    }

    #[test]
    fn update_batch_processes_every_unique_planner_and_isolates_entry_failures() {
        let mut batch = UpdateBatchTransport::default();
        batch.reserve(2).unwrap();
        write_batch_entry(batch.entries_mut(), 0, 3, 80, 0xaaaa_aaaa, 0xbbbb_bbbb);
        write_batch_entry(batch.entries_mut(), 1, 7, 96, 0xcccc_cccc, 0xdddd_dddd);
        let pointer = batch.pointer();
        let mut visited = Vec::new();

        assert_eq!(
            batch.process(pointer, 2, |planner_id, request_length| {
                visited.push((planner_id, request_length));
                if planner_id == 3 {
                    UpdateBatchResult {
                        result_pointer: 0x1000,
                        status: 0,
                    }
                } else {
                    UpdateBatchResult {
                        result_pointer: 0,
                        status: STATUS_PLANNER_MISSING,
                    }
                }
            }),
            0
        );
        assert_eq!(visited, [(3, 80), (7, 96)]);
        assert_eq!(
            entry_u32(batch.arena.bytes(), 0, ENGINE_UPDATE_BATCH_RESULT_POINTER),
            Some(0x1000)
        );
        assert_eq!(
            entry_u32(batch.arena.bytes(), 0, ENGINE_UPDATE_BATCH_STATUS),
            Some(0)
        );
        assert_eq!(
            entry_u32(batch.arena.bytes(), 1, ENGINE_UPDATE_BATCH_RESULT_POINTER),
            Some(0)
        );
        assert_eq!(
            entry_u32(batch.arena.bytes(), 1, ENGINE_UPDATE_BATCH_STATUS),
            Some(STATUS_PLANNER_MISSING)
        );
    }

    #[test]
    fn update_batch_reserves_duplicate_scratch_for_its_full_advertised_capacity() {
        let mut batch = UpdateBatchTransport::default();
        batch.reserve(2).unwrap();
        batch.reserve(3).unwrap();
        assert_eq!(
            batch.capacity(),
            4,
            "arena doubling is visible as entry capacity"
        );
        for index in 0..batch.capacity() as usize {
            write_batch_entry(
                batch.entries_mut(),
                index,
                index as u32 + 1,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                0,
                0,
            );
        }
        let pointer = batch.pointer();
        let capacity = batch.capacity();
        let mut calls = 0;

        assert_eq!(
            batch.process(pointer, capacity, |_, _| {
                calls += 1;
                UpdateBatchResult {
                    result_pointer: 1,
                    status: 0,
                }
            }),
            0
        );
        assert_eq!(calls, 4);
    }

    #[test]
    fn rejected_update_batch_growth_and_bounds_preserve_the_owned_arena() {
        let mut batch = UpdateBatchTransport::default();
        batch.reserve(2).unwrap();
        let pointer = batch.pointer();
        let capacity = batch.capacity();
        let mut calls = 0;

        assert_eq!(batch.reserve(u32::MAX), Err(STATUS_RESULT_TOO_LARGE));
        assert_eq!(batch.pointer(), pointer);
        assert_eq!(batch.capacity(), capacity);
        assert_eq!(
            batch.process(pointer + ARENA_ALIGNMENT, 1, |_, _| {
                calls += 1;
                UpdateBatchResult {
                    result_pointer: 0,
                    status: 0,
                }
            }),
            STATUS_INVALID_REQUEST
        );
        assert_eq!(
            batch.process(pointer, capacity + 1, |_, _| {
                calls += 1;
                UpdateBatchResult {
                    result_pointer: 0,
                    status: 0,
                }
            }),
            STATUS_INVALID_REQUEST
        );
        assert_eq!(calls, 0);
    }

    #[test]
    fn update_batch_keeps_each_planner_output_pointer_live() {
        let mut batch = UpdateBatchTransport::default();
        batch.reserve(2).unwrap();
        write_batch_entry(batch.entries_mut(), 0, 3, 80, 0, 0);
        write_batch_entry(batch.entries_mut(), 1, 7, 96, 0, 0);
        let pointer = batch.pointer();
        let mut transports = [
            (3, FrameTransport::new(256, 256).unwrap()),
            (7, FrameTransport::new(256, 256).unwrap()),
        ];
        let mut published = Vec::new();

        assert_eq!(
            batch.process(pointer, 2, |planner_id, _| {
                let transport = transports
                    .iter_mut()
                    .find(|(id, _)| *id == planner_id)
                    .map(|(_, transport)| transport)
                    .unwrap();
                let staged = transport.stage_plan(plan()).unwrap();
                let native_pointer = transport.publish_success(commit_for(planner_id, 1), staged);
                published.push((planner_id, native_pointer));
                UpdateBatchResult {
                    // Native pointers do not fit the Wasm32 wire field. The token proves each
                    // descriptor keeps its own returned identity; `published` verifies that the
                    // actual arena pointers and bytes remain live after the complete batch.
                    result_pointer: 0x1000 + planner_id,
                    status: 0,
                }
            }),
            0
        );

        for (index, (planner_id, transport)) in transports.iter().enumerate() {
            let result_pointer = entry_u32(
                batch.arena.bytes(),
                index,
                ENGINE_UPDATE_BATCH_RESULT_POINTER,
            )
            .unwrap();
            assert_eq!(result_pointer, 0x1000 + planner_id);
            let native_pointer = published
                .iter()
                .find(|(id, _)| id == planner_id)
                .map(|(_, pointer)| *pointer)
                .unwrap();
            assert_eq!(transport.result_status(native_pointer), Some(0));
            let output = transport
                .outputs
                .iter()
                .find(|output| output.pointer() == native_pointer)
                .unwrap();
            assert_eq!(
                read_u32(output.bytes(), ENGINE_RESULT_PLANNER_ID).unwrap(),
                *planner_id
            );
        }
    }

    #[test]
    fn duplicate_update_batch_planners_are_rejected_before_outputs_or_planners_mutate() {
        let mut batch = UpdateBatchTransport::default();
        batch.reserve(2).unwrap();
        write_batch_entry(batch.entries_mut(), 0, 3, 80, 0xaaaa_aaaa, 0xbbbb_bbbb);
        write_batch_entry(batch.entries_mut(), 1, 3, 96, 0xcccc_cccc, 0xdddd_dddd);
        let before = batch.arena.bytes().to_vec();
        let pointer = batch.pointer();
        let mut calls = 0;

        assert_eq!(
            batch.process(pointer, 2, |_, _| {
                calls += 1;
                UpdateBatchResult {
                    result_pointer: 0,
                    status: 0,
                }
            }),
            STATUS_INVALID_REQUEST
        );
        assert_eq!(calls, 0);
        assert_eq!(batch.arena.bytes(), before);
    }

    #[test]
    fn growing_an_inactive_output_preserves_the_active_publication_pointer() {
        let mut transport = FrameTransport::new(256, 256).unwrap();
        let first_plan = transport.stage_plan(plan()).unwrap();
        let first = transport.publish_success(commit(1), first_plan);
        let first_header =
            transport.outputs[0].bytes()[..ENGINE_RESULT_HEADER_SIZE as usize].to_vec();

        transport.reserve_publish_capacity(1024).unwrap();

        assert_eq!(first, transport.outputs[0].pointer());
        assert_eq!(
            &transport.outputs[0].bytes()[..ENGINE_RESULT_HEADER_SIZE as usize],
            first_header
        );
        assert!(transport.outputs[1].capacity() >= 1024);
    }

    #[test]
    fn successful_publications_alternate_and_failures_preserve_the_active_slot() {
        let mut transport = FrameTransport::new(256, 256).unwrap();
        let first_plan = transport.stage_plan(plan()).unwrap();
        let first = transport.publish_success(commit(1), first_plan);
        let first_bytes = transport.outputs[0].bytes();
        assert_eq!(read_u32(first_bytes, ENGINE_RESULT_OUTPUT_SLOT).unwrap(), 0);
        assert_eq!(
            read_u32(first_bytes, ENGINE_RESULT_PUBLICATION_GENERATION).unwrap(),
            1
        );

        let failure = transport.publish_failure(
            3,
            PlannerRevision { engine: 1, plan: 1 },
            STATUS_INVALID_REQUEST,
            FrameFault::default(),
            512,
            0,
        );
        assert_ne!(failure, first);
        assert_eq!(transport.active_slot, Some(0));
        assert_eq!(transport.publication_generation, 1);

        let second_plan = transport.stage_plan(plan()).unwrap();
        let second = transport.publish_success(commit(2), second_plan);
        assert_eq!(second, failure);
        let second_bytes = transport.outputs[1].bytes();
        assert_eq!(
            read_u32(second_bytes, ENGINE_RESULT_OUTPUT_SLOT).unwrap(),
            1
        );
        assert_eq!(
            read_u32(second_bytes, ENGINE_RESULT_PUBLICATION_GENERATION).unwrap(),
            2
        );
    }

    #[test]
    fn detached_checkpoints_do_not_advance_or_alternate_source_publication_state() {
        let mut transport = FrameTransport::new(256, 1024).unwrap();
        let first_plan = transport.stage_plan(plan()).unwrap();
        transport.publish_success(commit(1), first_plan);

        let revision = PlannerRevision { engine: 7, plan: 5 };
        let detached = transport
            .stage_detached_plan(3, revision, plan(), 1024)
            .unwrap();
        assert_eq!(detached, transport.outputs[1].pointer());
        assert_eq!(transport.active_slot, Some(0));
        assert_eq!(transport.publication_generation, 1);
        assert_eq!(transport.next_publication_generation().unwrap(), 2);

        let bytes = transport.outputs[1].bytes();
        assert_eq!(
            read_u32(bytes, ENGINE_RESULT_FLAGS).unwrap(),
            RESULT_FLAG_CHECKPOINT
        );
        assert_eq!(read_u32(bytes, ENGINE_RESULT_ENGINE_REVISION).unwrap(), 7);
        assert_eq!(read_u32(bytes, ENGINE_RESULT_PLAN_REVISION).unwrap(), 5);
        assert_eq!(
            read_u32(bytes, ENGINE_RESULT_REQUIRED_BASE_REVISION).unwrap(),
            0
        );
        assert_eq!(
            read_u32(bytes, ENGINE_RESULT_PUBLICATION_GENERATION).unwrap(),
            1
        );

        let second_plan = transport.stage_plan(plan()).unwrap();
        let second = transport.publish_success(commit(2), second_plan);
        assert_eq!(
            second, detached,
            "the next source publication still uses the inactive slot"
        );
        assert_eq!(transport.active_slot, Some(1));
        assert_eq!(transport.publication_generation, 2);
    }

    #[test]
    fn publication_header_addresses_the_exact_plan_tables_and_payload() {
        let buffers = [BufferRecord {
            id: 1,
            generation: 2,
            program_id: 3,
            policy_buffer_id: 4,
            scalar_type: 1,
            vector_width: 4,
            strategy: BUFFER_ORDERED_DIRECT,
            live_records: 1,
            capacity_records: 8,
            byte_length: 128,
            ..BufferRecord::default()
        }];
        let patches = [PatchRecord {
            opcode: PATCH_WRITE,
            buffer_id: 1,
            buffer_generation: 2,
            byte_length: 4,
            ..PatchRecord::default()
        }];
        let plan = RenderPlanView {
            policy_handle: 9,
            capability_set: 10,
            policy_fingerprint: 0x1122_3344_5566_7788,
            buffers: &buffers,
            patches: &patches,
            payload: &[1, 2, 3, 4],
            ..RenderPlanView::default()
        };
        let mut transport = FrameTransport::new(256, 1024).unwrap();
        let staged = transport.stage_plan(plan).unwrap();
        transport.publish_success(commit(1), staged);
        let bytes = transport.outputs[0].bytes();
        let patch_offset = read_u32(bytes, ENGINE_RESULT_PATCHES_OFFSET).unwrap() as usize;
        let payload_offset = read_u32(bytes, patch_offset + PATCH_PAYLOAD_OFFSET).unwrap() as usize;
        assert_eq!(read_u32(bytes, ENGINE_RESULT_POLICY_HANDLE).unwrap(), 9);
        assert_eq!(read_u32(bytes, ENGINE_RESULT_BUFFER_COUNT).unwrap(), 1);
        assert_eq!(read_u32(bytes, ENGINE_RESULT_PATCH_COUNT).unwrap(), 1);
        assert_eq!(&bytes[payload_offset..payload_offset + 4], &[1, 2, 3, 4]);
    }

    fn commit(revision: u32) -> CommittedUpdate {
        commit_for(3, revision)
    }

    fn commit_for(planner_id: u32, revision: u32) -> CommittedUpdate {
        CommittedUpdate {
            planner_id,
            revision: PlannerRevision {
                engine: revision,
                plan: revision,
            },
            required_base_revision: revision - 1,
            checkpoint: revision == 1,
        }
    }

    fn plan() -> RenderPlanView<'static> {
        RenderPlanView {
            policy_handle: 1,
            ..RenderPlanView::default()
        }
    }

    fn write_batch_entry(
        bytes: &mut [u8],
        index: usize,
        planner_id: u32,
        request_length: u32,
        result_pointer: u32,
        status: u32,
    ) {
        let entry = entry_mut(bytes, index).unwrap();
        write_u32(entry, ENGINE_UPDATE_BATCH_PLANNER_ID, planner_id);
        write_u32(entry, ENGINE_UPDATE_BATCH_REQUEST_LENGTH, request_length);
        write_u32(entry, ENGINE_UPDATE_BATCH_RESULT_POINTER, result_pointer);
        write_u32(entry, ENGINE_UPDATE_BATCH_STATUS, status);
    }
}
