//! Shared policy execution and capacity arithmetic for retained plan compilers.

use core::{mem, slice};

use super::{
    plan_input::PlanInput,
    policy::{
        CapabilitySetId, PhysicalBufferMut, PolicyExecutionError, SemanticInputBatch,
        ValidatedPolicy,
    },
    render_plan::{PATCH_WRITE, PatchRecord},
};

pub const MAX_PHYSICAL_BUFFERS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackingError {
    AllocationFailed,
    ArithmeticOverflow,
    CapacityExceeded,
    InvalidIdentity,
    Policy(PolicyExecutionError),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecordRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RangeJob {
    pub range: RecordRange,
    pub active_buffers: u32,
}

pub struct PhysicalBufferState {
    pub id: u32,
    pub generation: u32,
    pub program_id: u32,
    pub schema: super::policy::BufferSchema,
    pub capacity: u32,
    pub bytes: alloc::vec::Vec<u8>,
}

pub struct PendingAllocation {
    pub state: PhysicalBufferState,
}

impl PhysicalBufferState {
    pub fn new(
        id: u32,
        generation: u32,
        program_id: u32,
        schema: super::policy::BufferSchema,
        capacity: u32,
    ) -> Result<Self, PackingError> {
        let length = usize::try_from(capacity)
            .ok()
            .and_then(|value| value.checked_mul(schema.stride()))
            .ok_or(PackingError::ArithmeticOverflow)?;
        let mut bytes = alloc::vec::Vec::new();
        bytes
            .try_reserve_exact(length)
            .map_err(|_| PackingError::AllocationFailed)?;
        bytes.resize(length, 0);
        Ok(Self {
            id,
            generation,
            program_id,
            schema,
            capacity,
            bytes,
        })
    }
}

pub fn apply_writes(
    buffer: &mut PhysicalBufferState,
    patches: &[PatchRecord],
    payload: &[u8],
) -> Result<(), PackingError> {
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
            .ok_or(PackingError::InvalidIdentity)?;
        let source = payload
            .get(source..source + length)
            .ok_or(PackingError::InvalidIdentity)?;
        destination.copy_from_slice(source);
    }
    Ok(())
}

pub fn take_allocation(
    allocations: &mut alloc::vec::Vec<PendingAllocation>,
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

#[allow(clippy::too_many_arguments)]
pub fn execute_run(
    policy: &ValidatedPolicy,
    capability_set: CapabilitySetId,
    program: &super::policy::ProgramDescriptor,
    input: PlanInput<'_>,
    input_index: usize,
    record_count: u32,
    output_record: u32,
    payload: &mut [u8],
    payload_starts: &[usize; MAX_PHYSICAL_BUFFERS],
    output_records: u32,
    active_buffers: u32,
) -> Result<(), PackingError> {
    let input_end = input_index
        .checked_add(record_count as usize)
        .ok_or(PackingError::ArithmeticOverflow)?;
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
        let length = if active_buffers & (1 << index) == 0 {
            0
        } else {
            output_records as usize * schema.stride()
        };
        // SAFETY: the caller sizes mutually disjoint payload segments before this call, and the
        // payload cannot reallocate while these temporary views exist.
        let start = if length == 0 {
            0
        } else {
            payload_starts[index]
        };
        let bytes = unsafe { slice::from_raw_parts_mut(base.add(start), length) };
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
        .execute_buffers(
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
            active_buffers,
        )
        .map_err(PackingError::Policy)
}

pub fn grown_capacity(mut capacity: u32, required: u32) -> Result<u32, PackingError> {
    while capacity < required {
        capacity = capacity
            .checked_mul(2)
            .ok_or(PackingError::CapacityExceeded)?;
    }
    Ok(capacity)
}

pub fn record_alignment(
    program: &super::policy::ProgramDescriptor,
    byte_alignment: u32,
) -> Result<u32, PackingError> {
    program.buffers.iter().try_fold(1_u32, |records, schema| {
        lcm(records, buffer_record_alignment(schema, byte_alignment))
    })
}

pub fn buffer_record_alignment(schema: &super::policy::BufferSchema, byte_alignment: u32) -> u32 {
    byte_alignment / gcd(byte_alignment, u32::from(schema.stride))
}

pub fn align_up(value: u32, alignment: u32) -> Result<u32, PackingError> {
    value
        .checked_add(alignment - 1)
        .map(|value| value / alignment * alignment)
        .ok_or(PackingError::ArithmeticOverflow)
}

pub fn align_record_range(range: RecordRange, alignment: u32) -> Result<RecordRange, PackingError> {
    let start = range.start / alignment * alignment;
    let end = range
        .end
        .checked_add(alignment - 1)
        .map(|value| value / alignment * alignment)
        .ok_or(PackingError::ArithmeticOverflow)?;
    Ok(RecordRange { start, end })
}

pub fn coalesce_buffer_ranges(
    ranges: &mut alloc::vec::Vec<RecordRange>,
    bytes_per_record: u32,
    capability: &super::policy::CapabilitySet,
    live_records: u32,
) -> Result<(), PackingError> {
    if ranges.is_empty() {
        return Ok(());
    }
    if bytes_per_record == 0 {
        return Err(PackingError::InvalidIdentity);
    }
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
        let last = ranges.last().ok_or(PackingError::InvalidIdentity)?.end;
        ranges.clear();
        ranges.push(RecordRange {
            start: first,
            end: last,
        });
    }
    let upload_records = ranges.iter().try_fold(0_u32, |total, range| {
        total
            .checked_add(range.end - range.start)
            .ok_or(PackingError::ArithmeticOverflow)
    })?;
    let upload_cost = upload_records
        .checked_mul(bytes_per_record)
        .and_then(|bytes| {
            bytes.checked_add(
                (ranges.len() as u32).saturating_mul(capability.range_call_penalty_bytes),
            )
        })
        .ok_or(PackingError::ArithmeticOverflow)?;
    let full_bytes = live_records
        .checked_mul(bytes_per_record)
        .ok_or(PackingError::ArithmeticOverflow)?;
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

pub fn collect_range_jobs(
    jobs: &mut alloc::vec::Vec<RangeJob>,
    buffer_ranges: &[alloc::vec::Vec<RecordRange>; MAX_PHYSICAL_BUFFERS],
    buffer_count: usize,
) -> Result<(), PackingError> {
    jobs.clear();
    let range_count = buffer_ranges[..buffer_count]
        .iter()
        .try_fold(0_usize, |total, ranges| total.checked_add(ranges.len()))
        .ok_or(PackingError::ArithmeticOverflow)?;
    jobs.try_reserve(range_count)
        .map_err(|_| PackingError::AllocationFailed)?;
    for (buffer_index, ranges) in buffer_ranges[..buffer_count].iter().enumerate() {
        for range in ranges.iter().copied() {
            if let Some(job) = jobs.iter_mut().find(|job| job.range == range) {
                job.active_buffers |= 1 << buffer_index;
            } else {
                jobs.push(RangeJob {
                    range,
                    active_buffers: 1 << buffer_index,
                });
            }
        }
    }
    jobs.sort_unstable_by_key(|job| (job.range.start, job.range.end));
    Ok(())
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

fn lcm(left: u32, right: u32) -> Result<u32, PackingError> {
    left.checked_div(gcd(left, right))
        .and_then(|value| value.checked_mul(right))
        .ok_or(PackingError::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use alloc::vec;

    use super::{
        MAX_PHYSICAL_BUFFERS, PackingError, RangeJob, RecordRange, coalesce_buffer_ranges,
        collect_range_jobs,
    };
    use crate::engine::policy::{CapabilitySet, CapabilitySetId};

    fn capability() -> CapabilitySet {
        CapabilitySet {
            id: CapabilitySetId(1),
            flags: 0,
            max_buffer_bytes: u32::MAX,
            update_alignment: 4,
            coalesce_gap_bytes: 128,
            range_call_penalty_bytes: 256,
            max_buffers_per_draw: 16,
            max_resources_per_draw: 16,
            max_indirect_draws: 1,
            fragmentation_budget: 8,
            whole_buffer_threshold_basis_points: 7_500,
        }
    }

    #[test]
    fn physical_buffer_stride_controls_gap_coalescing() {
        let mut narrow = vec![
            RecordRange { start: 0, end: 1 },
            RecordRange { start: 10, end: 11 },
        ];
        let mut wide = narrow.clone();

        coalesce_buffer_ranges(&mut narrow, 16, &capability(), 100).unwrap();
        coalesce_buffer_ranges(&mut wide, 64, &capability(), 100).unwrap();

        assert_eq!(narrow, [RecordRange { start: 0, end: 11 }]);
        assert_eq!(
            wide,
            [
                RecordRange { start: 0, end: 1 },
                RecordRange { start: 10, end: 11 },
            ]
        );
    }

    #[test]
    fn physical_buffer_cost_promotes_fragmented_and_expensive_updates() {
        let mut fragmented = (0..9)
            .map(|index| RecordRange {
                start: index * 10,
                end: index * 10 + 1,
            })
            .collect();
        let mut expensive = vec![RecordRange { start: 0, end: 80 }];

        coalesce_buffer_ranges(&mut fragmented, 16, &capability(), 100).unwrap();
        coalesce_buffer_ranges(&mut expensive, 16, &capability(), 100).unwrap();

        assert_eq!(fragmented, [RecordRange { start: 0, end: 100 }]);
        assert_eq!(expensive, [RecordRange { start: 0, end: 100 }]);
    }

    #[test]
    fn physical_buffer_cost_rejects_zero_stride_and_arithmetic_overflow() {
        let mut range = vec![RecordRange { start: 0, end: 1 }];
        assert_eq!(
            coalesce_buffer_ranges(&mut range, 0, &capability(), 1),
            Err(PackingError::InvalidIdentity)
        );

        let mut overflow = vec![RecordRange {
            start: 0,
            end: u32::MAX,
        }];
        assert_eq!(
            coalesce_buffer_ranges(&mut overflow, 2, &capability(), u32::MAX),
            Err(PackingError::ArithmeticOverflow)
        );
    }

    #[test]
    fn identical_per_buffer_ranges_share_one_packing_job() {
        let mut ranges: [alloc::vec::Vec<RecordRange>; MAX_PHYSICAL_BUFFERS] =
            core::array::from_fn(|_| alloc::vec::Vec::new());
        ranges[0].extend([
            RecordRange { start: 0, end: 10 },
            RecordRange { start: 20, end: 21 },
        ]);
        ranges[1].push(RecordRange { start: 0, end: 10 });
        let mut jobs = alloc::vec::Vec::new();

        collect_range_jobs(&mut jobs, &ranges, 2).unwrap();

        assert_eq!(
            jobs,
            [
                RangeJob {
                    range: RecordRange { start: 0, end: 10 },
                    active_buffers: 0b11,
                },
                RangeJob {
                    range: RecordRange { start: 20, end: 21 },
                    active_buffers: 0b01,
                },
            ]
        );
    }
}
