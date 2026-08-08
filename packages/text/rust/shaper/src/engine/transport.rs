use alloc::vec::Vec;
use core::slice;

use crate::{
    STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE,
    abi_contract::{
        ABI_VERSION, ENGINE_RESULT_ABI_VERSION, ENGINE_RESULT_BUFFER_COUNT,
        ENGINE_RESULT_BUFFERS_OFFSET, ENGINE_RESULT_BYTE_LENGTH, ENGINE_RESULT_DIAGNOSTIC_COUNT,
        ENGINE_RESULT_DIAGNOSTICS_OFFSET, ENGINE_RESULT_DRAW_COUNT, ENGINE_RESULT_DRAWS_OFFSET,
        ENGINE_RESULT_ENGINE_REVISION, ENGINE_RESULT_FLAGS, ENGINE_RESULT_HEADER_ALIGNMENT,
        ENGINE_RESULT_HEADER_SIZE, ENGINE_RESULT_OUTPUT_SLOT, ENGINE_RESULT_PATCH_COUNT,
        ENGINE_RESULT_PATCHES_OFFSET, ENGINE_RESULT_PLAN_REVISION, ENGINE_RESULT_PRIMITIVE_COUNT,
        ENGINE_RESULT_PRIMITIVES_OFFSET, ENGINE_RESULT_PUBLICATION_GENERATION,
        ENGINE_RESULT_REQUEST_CAPACITY, ENGINE_RESULT_REQUIRED_BASE_REVISION,
        ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY, ENGINE_RESULT_REQUIRED_RESULT_CAPACITY,
        ENGINE_RESULT_RESOURCE_COUNT, ENGINE_RESULT_RESOURCES_OFFSET,
        ENGINE_RESULT_RESULT_CAPACITY, ENGINE_RESULT_RETIREMENT_COUNT,
        ENGINE_RESULT_RETIREMENTS_OFFSET, ENGINE_RESULT_SEMANTICS_COUNT,
        ENGINE_RESULT_SEMANTICS_OFFSET, ENGINE_RESULT_SESSION_ID, ENGINE_RESULT_STATUS,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    },
    engine::frame::{CommittedUpdate, RESULT_FLAG_CHECKPOINT, SessionRevision},
    wire::write_u32,
};

const ARENA_ALIGNMENT: usize = 16;
const MAX_ARENA_BYTES: u32 = 64 * 1024 * 1024;

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

    pub fn request_at(&self, pointer: usize, length: u32) -> Result<&[u8], u32> {
        if pointer != self.request.pointer() || length > self.request.capacity() {
            return Err(STATUS_INVALID_REQUEST);
        }
        self.request
            .bytes()
            .get(..usize::try_from(length).map_err(|_| STATUS_INVALID_REQUEST)?)
            .ok_or(STATUS_INVALID_REQUEST)
    }

    pub fn ensure_publish_capacity(&self, byte_length: u32) -> Result<(), u32> {
        if byte_length <= self.result_capacity() {
            Ok(())
        } else {
            Err(STATUS_RESULT_TOO_LARGE)
        }
    }

    pub fn next_publication_generation(&self) -> Result<u32, u32> {
        self.publication_generation
            .checked_add(1)
            .ok_or(STATUS_RESULT_TOO_LARGE)
    }

    pub fn publish_success(&mut self, commit: CommittedUpdate) -> usize {
        let slot = self.inactive_slot();
        let generation = self.publication_generation + 1;
        self.write_header(
            slot,
            HeaderValues {
                status: 0,
                flags: if commit.checkpoint {
                    RESULT_FLAG_CHECKPOINT
                } else {
                    0
                },
                session_id: commit.session_id,
                revision: commit.revision,
                required_base_revision: commit.required_base_revision,
                publication_generation: generation,
                required_request_capacity: 0,
                required_result_capacity: 0,
            },
        );
        self.active_slot = Some(slot);
        self.publication_generation = generation;
        self.outputs[slot].pointer()
    }

    pub fn publish_failure(
        &mut self,
        session_id: u32,
        revision: SessionRevision,
        status: u32,
        required_request_capacity: u32,
        required_result_capacity: u32,
    ) -> usize {
        let slot = self.inactive_slot();
        self.write_header(
            slot,
            HeaderValues {
                status,
                flags: 0,
                session_id,
                revision,
                required_base_revision: revision.plan,
                publication_generation: self.publication_generation,
                required_request_capacity,
                required_result_capacity,
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
        write_u32(bytes, ENGINE_RESULT_BYTE_LENGTH, ENGINE_RESULT_HEADER_SIZE);
        write_u32(bytes, ENGINE_RESULT_STATUS, values.status);
        write_u32(bytes, ENGINE_RESULT_FLAGS, values.flags);
        write_u32(bytes, ENGINE_RESULT_SESSION_ID, values.session_id);
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
        for offset in [
            ENGINE_RESULT_SEMANTICS_OFFSET,
            ENGINE_RESULT_SEMANTICS_COUNT,
            ENGINE_RESULT_RESOURCES_OFFSET,
            ENGINE_RESULT_RESOURCE_COUNT,
            ENGINE_RESULT_BUFFERS_OFFSET,
            ENGINE_RESULT_BUFFER_COUNT,
            ENGINE_RESULT_PATCHES_OFFSET,
            ENGINE_RESULT_PATCH_COUNT,
            ENGINE_RESULT_PRIMITIVES_OFFSET,
            ENGINE_RESULT_PRIMITIVE_COUNT,
            ENGINE_RESULT_DRAWS_OFFSET,
            ENGINE_RESULT_DRAW_COUNT,
            ENGINE_RESULT_RETIREMENTS_OFFSET,
            ENGINE_RESULT_RETIREMENT_COUNT,
            ENGINE_RESULT_DIAGNOSTICS_OFFSET,
            ENGINE_RESULT_DIAGNOSTIC_COUNT,
        ] {
            write_u32(bytes, offset, 0);
        }
    }
}

struct HeaderValues {
    status: u32,
    flags: u32,
    session_id: u32,
    revision: SessionRevision,
    required_base_revision: u32,
    publication_generation: u32,
    required_request_capacity: u32,
    required_result_capacity: u32,
}

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
        let required = aligned_capacity(required)?;
        let current = self.capacity();
        if required <= current {
            return Ok(());
        }
        let doubled = current.checked_mul(2).unwrap_or(MAX_ARENA_BYTES);
        let target = required.max(doubled).min(MAX_ARENA_BYTES);
        if target < required {
            return Err(STATUS_RESULT_TOO_LARGE);
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
    use crate::wire::read_u32;

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
    fn successful_publications_alternate_and_failures_preserve_the_active_slot() {
        let mut transport = FrameTransport::new(256, 256).unwrap();
        let first = transport.publish_success(commit(1));
        let first_bytes = transport.outputs[0].bytes();
        assert_eq!(read_u32(first_bytes, ENGINE_RESULT_OUTPUT_SLOT).unwrap(), 0);
        assert_eq!(
            read_u32(first_bytes, ENGINE_RESULT_PUBLICATION_GENERATION).unwrap(),
            1
        );

        let failure = transport.publish_failure(
            3,
            SessionRevision { engine: 1, plan: 1 },
            STATUS_INVALID_REQUEST,
            512,
            0,
        );
        assert_ne!(failure, first);
        assert_eq!(transport.active_slot, Some(0));
        assert_eq!(transport.publication_generation, 1);

        let second = transport.publish_success(commit(2));
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

    fn commit(revision: u32) -> CommittedUpdate {
        CommittedUpdate {
            session_id: 3,
            revision: SessionRevision {
                engine: revision,
                plan: revision,
            },
            required_base_revision: revision - 1,
            checkpoint: revision == 1,
        }
    }
}
