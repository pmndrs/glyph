//! Transactional root-level occurrence and x/y placement buffers.

use alloc::vec::Vec;

use super::{
    codec::{BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, CapabilitySet, ScalarType},
    plan_packing::{
        PackingError, RecordRange, align_record_range, coalesce_buffer_ranges, grown_capacity,
        record_alignment_for_stride,
    },
    render_plan::{
        BUFFER_SESSION_SHARED, BufferRecord, CODEC_BUFFER_PLACEMENT, PATCH_ALLOCATE_OR_RESIZE,
        PATCH_WRITE, PatchRecord, RETIRE_BUFFER, RenderPlanView, RetirementRecord,
        SESSION_PLACEMENT_BUFFER_ID,
    },
};

const MIN_CAPACITY: u32 = 16;
const PLACEMENT_STRIDE: u32 = 8;
const PLACEMENT_STRIDE_BYTES: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SessionPlacementRow {
    pub slot: u32,
    pub inline: f32,
    pub block: f32,
}

#[derive(Clone, Copy)]
pub(crate) struct SessionPlacementInput<'a> {
    pub placement_rows: &'a [SessionPlacementRow],
    pub placement_capacity: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SessionPlacementError {
    AllocationFailed,
    AlreadyPrepared,
    InvalidInput,
    ArithmeticOverflow,
    GenerationExhausted,
}

struct SessionBuffer {
    id: u32,
    generation: u32,
    vector_width: u8,
    capacity: u32,
    live_records: u32,
    bytes: Vec<u8>,
}

#[derive(Clone, Copy, Default)]
struct PendingBuffer {
    replace: bool,
    remove: bool,
    live_records: u32,
}

#[derive(Default)]
pub(crate) struct SessionPlacementCompiler {
    placement: Option<SessionBuffer>,
    pending_placement: PendingBuffer,
    placement_allocation: Option<SessionBuffer>,
    buffers: Vec<BufferRecord>,
    patches: Vec<PatchRecord>,
    retirements: Vec<RetirementRecord>,
    payload: Vec<u8>,
    dirty_ranges: Vec<RecordRange>,
    publication_generation: u32,
    prepared: bool,
}

impl SessionPlacementCompiler {
    pub(crate) fn prepare(
        &mut self,
        input: SessionPlacementInput<'_>,
        capability: &CapabilitySet,
        publication_generation: u32,
        checkpoint: bool,
    ) -> Result<(), SessionPlacementError> {
        if self.prepared {
            return Err(SessionPlacementError::AlreadyPrepared);
        }
        if publication_generation == 0 {
            return Err(SessionPlacementError::InvalidInput);
        }
        validate_input(input)?;
        self.clear_pending();
        self.publication_generation = publication_generation;
        let result = self.prepare_placement(
            input.placement_rows,
            input.placement_capacity,
            capability,
            checkpoint,
        );
        if result.is_err() {
            self.clear_pending();
            return result;
        }
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn prepare_reuse(&mut self) -> Result<(), SessionPlacementError> {
        if self.prepared {
            return Err(SessionPlacementError::AlreadyPrepared);
        }
        self.clear_pending();
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn view(&self) -> RenderPlanView<'_> {
        RenderPlanView {
            buffers: &self.buffers,
            patches: &self.patches,
            retirements: &self.retirements,
            payload: &self.payload,
            ..RenderPlanView::default()
        }
    }

    pub(crate) fn commit(&mut self) {
        if !self.prepared {
            return;
        }
        commit_buffer(
            &mut self.placement,
            &mut self.placement_allocation,
            self.pending_placement,
            &self.patches,
            &self.payload,
        );
        self.finish();
    }

    pub(crate) fn abort(&mut self) {
        self.finish();
    }

    pub(crate) fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        self.placement
            .as_ref()
            .filter(|buffer| buffer.id == id)
            .map(|buffer| buffer.bytes.as_slice())
    }

    fn prepare_placement(
        &mut self,
        rows: &[SessionPlacementRow],
        live_records: u32,
        capability: &CapabilitySet,
        checkpoint: bool,
    ) -> Result<(), SessionPlacementError> {
        if live_records == 0 {
            prepare_removal(
                &self.placement,
                &mut self.pending_placement,
                &mut self.retirements,
                self.publication_generation,
            )?;
            return Ok(());
        }
        let replaced = self
            .placement
            .as_ref()
            .is_none_or(|buffer| buffer.capacity < live_records);
        let (id, generation) = if replaced {
            let record_alignment =
                record_alignment_for_stride(PLACEMENT_STRIDE, capability.update_alignment);
            let capacity = grown_capacity(
                self.placement
                    .as_ref()
                    .map_or(MIN_CAPACITY.max(record_alignment), |buffer| buffer.capacity),
                live_records,
            )
            .map_err(packing_error)?;
            let generation = next_generation(self.placement.as_ref())?;
            let allocation = allocate_buffer(
                SESSION_PLACEMENT_BUFFER_ID,
                generation,
                2,
                capacity,
                live_records,
            )?;
            push_binding_and_allocation(
                &mut self.buffers,
                &mut self.patches,
                &allocation,
                CODEC_BUFFER_PLACEMENT,
                ScalarType::F32,
            )?;
            push_retirement(
                &self.placement,
                &mut self.retirements,
                self.publication_generation,
            )?;
            self.placement_allocation = Some(allocation);
            (SESSION_PLACEMENT_BUFFER_ID, generation)
        } else {
            let buffer = self
                .placement
                .as_ref()
                .ok_or(SessionPlacementError::InvalidInput)?;
            if checkpoint {
                push_binding_and_allocation(
                    &mut self.buffers,
                    &mut self.patches,
                    buffer,
                    CODEC_BUFFER_PLACEMENT,
                    ScalarType::F32,
                )?;
            }
            (buffer.id, buffer.generation)
        };
        write_placement_ranges(
            if replaced || checkpoint {
                None
            } else {
                self.placement.as_ref()
            },
            rows,
            id,
            generation,
            &mut PlacementWriteOutput {
                capability,
                live_records,
                dirty_ranges: &mut self.dirty_ranges,
                patches: &mut self.patches,
                payload: &mut self.payload,
            },
        )?;
        self.pending_placement = PendingBuffer {
            replace: replaced,
            remove: false,
            live_records,
        };
        Ok(())
    }

    fn clear_pending(&mut self) {
        self.pending_placement = PendingBuffer::default();
        self.placement_allocation = None;
        self.buffers.clear();
        self.patches.clear();
        self.retirements.clear();
        self.payload.clear();
        self.dirty_ranges.clear();
        self.publication_generation = 0;
    }

    fn finish(&mut self) {
        self.clear_pending();
        self.prepared = false;
    }
}

fn validate_input(input: SessionPlacementInput<'_>) -> Result<(), SessionPlacementError> {
    let mut previous = None;
    for row in input.placement_rows {
        if row.slot >= input.placement_capacity
            || !row.inline.is_finite()
            || !row.block.is_finite()
            || previous.is_some_and(|slot| slot >= row.slot)
        {
            return Err(SessionPlacementError::InvalidInput);
        }
        previous = Some(row.slot);
    }
    Ok(())
}

fn next_generation(buffer: Option<&SessionBuffer>) -> Result<u32, SessionPlacementError> {
    buffer.map_or(Ok(1), |buffer| {
        buffer
            .generation
            .checked_add(1)
            .ok_or(SessionPlacementError::GenerationExhausted)
    })
}

fn allocate_buffer(
    id: u32,
    generation: u32,
    vector_width: u8,
    capacity: u32,
    live_records: u32,
) -> Result<SessionBuffer, SessionPlacementError> {
    let length = usize::try_from(capacity)
        .ok()
        .and_then(|capacity| capacity.checked_mul(usize::from(vector_width) * 4))
        .ok_or(SessionPlacementError::ArithmeticOverflow)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length)
        .map_err(|_| SessionPlacementError::AllocationFailed)?;
    bytes.resize(length, 0);
    Ok(SessionBuffer {
        id,
        generation,
        vector_width,
        capacity,
        live_records,
        bytes,
    })
}

fn push_binding_and_allocation(
    buffers: &mut Vec<BufferRecord>,
    patches: &mut Vec<PatchRecord>,
    buffer: &SessionBuffer,
    codec_buffer_id: u16,
    scalar_type: ScalarType,
) -> Result<(), SessionPlacementError> {
    reserve(buffers, 1)?;
    reserve(patches, 1)?;
    let length = byte_length(buffer)?;
    buffers.push(BufferRecord {
        id: buffer.id,
        generation: buffer.generation,
        program_id: 0,
        codec_buffer_id,
        scalar_type: scalar_type as u8,
        vector_width: buffer.vector_width,
        strategy: BUFFER_SESSION_SHARED,
        flags: (BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST) as u16,
        live_records: buffer.live_records,
        capacity_records: buffer.capacity,
        byte_length: length,
        order_buffer_id: 0,
    });
    patches.push(PatchRecord {
        opcode: PATCH_ALLOCATE_OR_RESIZE,
        buffer_id: buffer.id,
        buffer_generation: buffer.generation,
        byte_length: length,
        ..PatchRecord::default()
    });
    Ok(())
}

fn prepare_removal(
    buffer: &Option<SessionBuffer>,
    pending: &mut PendingBuffer,
    retirements: &mut Vec<RetirementRecord>,
    publication_generation: u32,
) -> Result<(), SessionPlacementError> {
    if buffer.is_some() {
        push_retirement(buffer, retirements, publication_generation)?;
        pending.remove = true;
    }
    Ok(())
}

fn push_retirement(
    buffer: &Option<SessionBuffer>,
    retirements: &mut Vec<RetirementRecord>,
    publication_generation: u32,
) -> Result<(), SessionPlacementError> {
    let Some(buffer) = buffer else {
        return Ok(());
    };
    reserve(retirements, 1)?;
    retirements.push(RetirementRecord {
        kind: RETIRE_BUFFER,
        id: buffer.id,
        generation: buffer.generation,
        after_publication_generation: publication_generation,
        byte_length: byte_length(buffer)?,
        ..RetirementRecord::default()
    });
    Ok(())
}

struct PlacementWriteOutput<'a> {
    capability: &'a CapabilitySet,
    live_records: u32,
    dirty_ranges: &'a mut Vec<RecordRange>,
    patches: &'a mut Vec<PatchRecord>,
    payload: &'a mut Vec<u8>,
}

fn write_placement_ranges(
    previous: Option<&SessionBuffer>,
    rows: &[SessionPlacementRow],
    id: u32,
    generation: u32,
    output: &mut PlacementWriteOutput<'_>,
) -> Result<(), SessionPlacementError> {
    output.dirty_ranges.clear();
    let record_alignment =
        record_alignment_for_stride(PLACEMENT_STRIDE, output.capability.update_alignment);
    for row in rows {
        if previous.is_some_and(|buffer| same_placement(buffer, *row)) {
            continue;
        }
        reserve(output.dirty_ranges, 1)?;
        output.dirty_ranges.push(
            align_record_range(
                RecordRange {
                    start: row.slot,
                    end: row
                        .slot
                        .checked_add(1)
                        .ok_or(SessionPlacementError::ArithmeticOverflow)?,
                },
                record_alignment,
            )
            .map_err(packing_error)?,
        );
    }
    coalesce_buffer_ranges(
        output.dirty_ranges,
        PLACEMENT_STRIDE,
        output.capability,
        output.live_records,
    )
    .map_err(packing_error)?;

    let mut row_index = 0usize;
    for range in output.dirty_ranges.iter().copied() {
        while rows
            .get(row_index)
            .is_some_and(|row| row.slot < range.start)
        {
            row_index += 1;
        }
        let payload_start = output.payload.len();
        let count = usize::try_from(
            range
                .end
                .checked_sub(range.start)
                .ok_or(SessionPlacementError::ArithmeticOverflow)?,
        )
        .map_err(|_| SessionPlacementError::ArithmeticOverflow)?;
        reserve(
            output.payload,
            count
                .checked_mul(PLACEMENT_STRIDE_BYTES)
                .ok_or(SessionPlacementError::ArithmeticOverflow)?,
        )?;
        for offset in 0..count {
            let slot = range
                .start
                .checked_add(
                    u32::try_from(offset).map_err(|_| SessionPlacementError::ArithmeticOverflow)?,
                )
                .ok_or(SessionPlacementError::ArithmeticOverflow)?;
            if rows.get(row_index).is_some_and(|row| row.slot == slot) {
                let row = rows[row_index];
                output.payload.extend_from_slice(&row.inline.to_le_bytes());
                output.payload.extend_from_slice(&row.block.to_le_bytes());
                row_index += 1;
            } else if let Some(buffer) = previous {
                let start = usize::try_from(slot)
                    .ok()
                    .and_then(|slot| slot.checked_mul(PLACEMENT_STRIDE_BYTES))
                    .ok_or(SessionPlacementError::ArithmeticOverflow)?;
                let end = start
                    .checked_add(PLACEMENT_STRIDE_BYTES)
                    .ok_or(SessionPlacementError::ArithmeticOverflow)?;
                output.payload.extend_from_slice(
                    buffer
                        .bytes
                        .get(start..end)
                        .ok_or(SessionPlacementError::InvalidInput)?,
                );
            } else {
                output
                    .payload
                    .extend_from_slice(&[0; PLACEMENT_STRIDE_BYTES]);
            }
        }
        push_write(
            id,
            generation,
            usize::try_from(range.start).map_err(|_| SessionPlacementError::ArithmeticOverflow)?,
            count,
            payload_start,
            PLACEMENT_STRIDE_BYTES,
            output.patches,
        )?;
    }
    Ok(())
}

fn packing_error(error: PackingError) -> SessionPlacementError {
    match error {
        PackingError::AllocationFailed => SessionPlacementError::AllocationFailed,
        PackingError::ArithmeticOverflow | PackingError::CapacityExceeded => {
            SessionPlacementError::ArithmeticOverflow
        }
        PackingError::InvalidIdentity | PackingError::Codec(_) => {
            SessionPlacementError::InvalidInput
        }
    }
}

fn push_write(
    buffer_id: u32,
    buffer_generation: u32,
    record_start: usize,
    record_count: usize,
    payload_start: usize,
    stride: usize,
    patches: &mut Vec<PatchRecord>,
) -> Result<(), SessionPlacementError> {
    reserve(patches, 1)?;
    patches.push(PatchRecord {
        opcode: PATCH_WRITE,
        buffer_id,
        buffer_generation,
        destination_offset: u32::try_from(
            record_start
                .checked_mul(stride)
                .ok_or(SessionPlacementError::ArithmeticOverflow)?,
        )
        .map_err(|_| SessionPlacementError::ArithmeticOverflow)?,
        byte_length: u32::try_from(
            record_count
                .checked_mul(stride)
                .ok_or(SessionPlacementError::ArithmeticOverflow)?,
        )
        .map_err(|_| SessionPlacementError::ArithmeticOverflow)?,
        payload_start: u32::try_from(payload_start)
            .map_err(|_| SessionPlacementError::ArithmeticOverflow)?,
        ..PatchRecord::default()
    });
    Ok(())
}

fn same_placement(buffer: &SessionBuffer, row: SessionPlacementRow) -> bool {
    let Some(start) = usize::try_from(row.slot)
        .ok()
        .and_then(|slot| slot.checked_mul(8))
    else {
        return false;
    };
    let Some(end) = start.checked_add(8) else {
        return false;
    };
    buffer.bytes.get(start..end).is_some_and(|bytes| {
        bytes[..4] == row.inline.to_le_bytes() && bytes[4..] == row.block.to_le_bytes()
    })
}

fn byte_length(buffer: &SessionBuffer) -> Result<u32, SessionPlacementError> {
    u32::try_from(buffer.bytes.len()).map_err(|_| SessionPlacementError::ArithmeticOverflow)
}

fn commit_buffer(
    committed: &mut Option<SessionBuffer>,
    allocation: &mut Option<SessionBuffer>,
    pending: PendingBuffer,
    patches: &[PatchRecord],
    payload: &[u8],
) {
    if pending.remove {
        *committed = None;
        return;
    }
    let target = if pending.replace {
        let Some(target) = allocation.as_mut() else {
            debug_assert!(false, "prepared replacement is missing its allocation");
            return;
        };
        target
    } else if let Some(buffer) = committed.as_mut() {
        buffer
    } else {
        return;
    };
    for patch in patches.iter().filter(|patch| {
        patch.opcode == PATCH_WRITE
            && patch.buffer_id == target.id
            && patch.buffer_generation == target.generation
    }) {
        let source_start = patch.payload_start as usize;
        let length = patch.byte_length as usize;
        let Some(source_end) = source_start.checked_add(length) else {
            debug_assert!(false, "prepared source range overflowed");
            return;
        };
        let Some(source) = payload.get(source_start..source_end) else {
            debug_assert!(false, "prepared source range is invalid");
            return;
        };
        let destination_start = patch.destination_offset as usize;
        let Some(destination_end) = destination_start.checked_add(length) else {
            debug_assert!(false, "prepared destination range overflowed");
            return;
        };
        let Some(destination) = target.bytes.get_mut(destination_start..destination_end) else {
            debug_assert!(false, "prepared destination range is invalid");
            return;
        };
        destination.copy_from_slice(source);
    }
    target.live_records = pending.live_records;
    if pending.replace {
        *committed = allocation.take();
    }
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), SessionPlacementError> {
    values
        .try_reserve(additional)
        .map_err(|_| SessionPlacementError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::codec::CapabilitySetId;

    fn capability() -> CapabilitySet {
        CapabilitySet {
            id: CapabilitySetId(0),
            flags: 0,
            max_buffer_bytes: 4096,
            update_alignment: 4,
            coalesce_gap_bytes: 128,
            range_call_penalty_bytes: 0,
            max_buffers_per_draw: 8,
            max_resources_per_draw: 8,
            max_indirect_draws: 0,
            fragmentation_budget: 8,
            whole_buffer_threshold_basis_points: 10_000,
        }
    }

    fn row(slot: u32, inline: f32, block: f32) -> SessionPlacementRow {
        SessionPlacementRow {
            slot,
            inline,
            block,
        }
    }

    fn f32_pair(bytes: &[u8], slot: usize) -> (f32, f32) {
        let start = slot * 8;
        (
            f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap()),
            f32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()),
        )
    }

    #[test]
    fn allocates_and_patches_only_changed_xy_rows() {
        let mut compiler = SessionPlacementCompiler::default();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 1.0, 2.0), row(2, 3.0, 4.0)],
                    placement_capacity: 3,
                },
                &capability(),
                1,
                false,
            )
            .unwrap();
        let view = compiler.view();
        assert_eq!(view.buffers.len(), 1);
        assert_eq!(view.buffers[0].vector_width, 2);
        assert_eq!(view.patches[0].opcode, PATCH_ALLOCATE_OR_RESIZE);
        assert_eq!(
            view.patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            1
        );
        let write = view
            .patches
            .iter()
            .find(|patch| patch.opcode == PATCH_WRITE)
            .unwrap();
        assert_eq!(write.destination_offset, 0);
        assert_eq!(write.byte_length, 24);
        compiler.commit();
        let bytes = compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).unwrap();
        assert_eq!(f32_pair(bytes, 0), (1.0, 2.0));
        assert_eq!(f32_pair(bytes, 2), (3.0, 4.0));

        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 1.0, 2.0), row(2, 5.0, 4.0)],
                    placement_capacity: 3,
                },
                &capability(),
                2,
                false,
            )
            .unwrap();
        let view = compiler.view();
        assert!(view.buffers.is_empty());
        assert_eq!(view.patches.len(), 1);
        assert_eq!(view.patches[0].destination_offset, 16);
        assert_eq!(view.patches[0].byte_length, 8);
        compiler.commit();
        assert_eq!(
            f32_pair(
                compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).unwrap(),
                2,
            ),
            (5.0, 4.0),
        );
    }

    #[test]
    fn resize_rewrites_every_live_row_and_retires_the_old_generation() {
        let mut compiler = SessionPlacementCompiler::default();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 1.0, 2.0)],
                    placement_capacity: 1,
                },
                &capability(),
                1,
                false,
            )
            .unwrap();
        compiler.commit();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 1.0, 2.0), row(16, 7.0, 8.0)],
                    placement_capacity: 17,
                },
                &capability(),
                2,
                false,
            )
            .unwrap();
        let view = compiler.view();
        assert_eq!(view.buffers[0].generation, 2);
        assert_eq!(view.buffers[0].capacity_records, 32);
        assert_eq!(view.retirements.len(), 1);
        assert_eq!(view.retirements[0].generation, 1);
        assert_eq!(
            view.patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            1
        );
        let write = view
            .patches
            .iter()
            .find(|patch| patch.opcode == PATCH_WRITE)
            .unwrap();
        assert_eq!(write.destination_offset, 0);
        assert_eq!(write.byte_length, 136);
        compiler.commit();
        let bytes = compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).unwrap();
        assert_eq!(f32_pair(bytes, 0), (1.0, 2.0));
        assert_eq!(f32_pair(bytes, 16), (7.0, 8.0));
    }

    #[test]
    fn checkpoint_republishes_the_committed_table_without_changing_identity() {
        let mut compiler = SessionPlacementCompiler::default();
        let input = SessionPlacementInput {
            placement_rows: &[row(0, 1.0, 2.0), row(2, 3.0, 4.0)],
            placement_capacity: 3,
        };
        compiler.prepare(input, &capability(), 1, false).unwrap();
        compiler.commit();

        compiler.prepare(input, &capability(), 2, true).unwrap();
        let view = compiler.view();
        assert_eq!(view.buffers.len(), 1);
        assert_eq!(view.buffers[0].generation, 1);
        assert_eq!(view.patches[0].opcode, PATCH_ALLOCATE_OR_RESIZE);
        assert_eq!(
            view.patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            1,
        );
        let write = view
            .patches
            .iter()
            .find(|patch| patch.opcode == PATCH_WRITE)
            .unwrap();
        assert_eq!(write.destination_offset, 0);
        assert_eq!(write.byte_length, 24);
        assert!(view.retirements.is_empty());
    }

    #[test]
    fn coalescing_preserves_committed_gap_bytes_and_respects_the_limit() {
        let mut compiler = SessionPlacementCompiler::default();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 1.0, 2.0), row(1, 9.0, 10.0), row(2, 3.0, 4.0)],
                    placement_capacity: 21,
                },
                &capability(),
                1,
                false,
            )
            .unwrap();
        compiler.commit();

        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(0, 5.0, 6.0), row(2, 7.0, 8.0), row(20, 11.0, 12.0)],
                    placement_capacity: 21,
                },
                &capability(),
                2,
                false,
            )
            .unwrap();
        let writes: Vec<_> = compiler
            .view()
            .patches
            .iter()
            .filter(|patch| patch.opcode == PATCH_WRITE)
            .collect();
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[0].destination_offset, 0);
        assert_eq!(writes[0].byte_length, 24);
        assert_eq!(writes[1].destination_offset, 160);
        assert_eq!(writes[1].byte_length, 8);

        compiler.commit();
        let bytes = compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).unwrap();
        assert_eq!(f32_pair(bytes, 0), (5.0, 6.0));
        assert_eq!(f32_pair(bytes, 1), (9.0, 10.0));
        assert_eq!(f32_pair(bytes, 2), (7.0, 8.0));
        assert_eq!(f32_pair(bytes, 20), (11.0, 12.0));
    }

    #[test]
    fn placement_writes_follow_the_selected_capability_policy() {
        let rows = [
            row(0, 1.0, 2.0),
            row(1, 3.0, 4.0),
            row(2, 5.0, 6.0),
            row(20, 7.0, 8.0),
        ];
        for (gap, expected_writes, expected_first_bytes) in [(0, 2, 8), (8, 1, 24)] {
            let mut selected = capability();
            selected.coalesce_gap_bytes = gap;
            let mut compiler = SessionPlacementCompiler::default();
            compiler
                .prepare(
                    SessionPlacementInput {
                        placement_rows: &rows,
                        placement_capacity: 21,
                    },
                    &selected,
                    1,
                    false,
                )
                .unwrap();
            compiler.commit();

            let changed = [
                row(0, 9.0, 2.0),
                row(1, 3.0, 4.0),
                row(2, 11.0, 6.0),
                row(20, 7.0, 8.0),
            ];
            compiler
                .prepare(
                    SessionPlacementInput {
                        placement_rows: &changed,
                        placement_capacity: 21,
                    },
                    &selected,
                    2,
                    false,
                )
                .unwrap();
            let writes: Vec<_> = compiler
                .view()
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .collect();
            assert_eq!(writes.len(), expected_writes);
            assert_eq!(writes[0].byte_length, expected_first_bytes);
        }

        let mut aligned = capability();
        aligned.update_alignment = 32;
        let mut compiler = SessionPlacementCompiler::default();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[row(1, 1.0, 2.0)],
                    placement_capacity: 2,
                },
                &aligned,
                1,
                false,
            )
            .unwrap();
        let write = compiler
            .view()
            .patches
            .iter()
            .find(|patch| patch.opcode == PATCH_WRITE)
            .unwrap();
        assert_eq!(write.destination_offset, 0);
        assert_eq!(write.byte_length, 32);
    }

    #[test]
    fn abort_retry_is_deterministic_and_removal_is_explicit() {
        let mut compiler = SessionPlacementCompiler::default();
        let input = SessionPlacementInput {
            placement_rows: &[row(1, -3.0, 9.0)],
            placement_capacity: 2,
        };
        compiler.prepare(input, &capability(), 1, false).unwrap();
        let first = (
            compiler.view().buffers.to_vec(),
            compiler.view().patches.to_vec(),
            compiler.view().payload.to_vec(),
        );
        compiler.abort();
        compiler.prepare(input, &capability(), 1, false).unwrap();
        assert_eq!(compiler.view().buffers, first.0);
        assert_eq!(compiler.view().patches, first.1);
        assert_eq!(compiler.view().payload, first.2);
        compiler.commit();
        compiler
            .prepare(
                SessionPlacementInput {
                    placement_rows: &[],
                    placement_capacity: 0,
                },
                &capability(),
                2,
                false,
            )
            .unwrap();
        assert_eq!(compiler.view().retirements.len(), 1);
        compiler.commit();
        assert!(compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).is_none());
    }

    #[test]
    fn rejects_unsorted_out_of_range_and_nonfinite_rows() {
        let mut compiler = SessionPlacementCompiler::default();
        for input in [
            [row(1, 0.0, 0.0), row(0, 0.0, 0.0)],
            [row(0, 0.0, 0.0), row(2, 0.0, 0.0)],
            [row(0, f32::NAN, 0.0), row(1, 0.0, 0.0)],
        ] {
            assert_eq!(
                compiler.prepare(
                    SessionPlacementInput {
                        placement_rows: &input,
                        placement_capacity: 2,
                    },
                    &capability(),
                    1,
                    false,
                ),
                Err(SessionPlacementError::InvalidInput),
            );
        }
    }
}
