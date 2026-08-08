//! Shared policy execution and capacity arithmetic for retained plan compilers.

use core::{mem, slice};

use super::{
    plan_input::PlanInput,
    policy::{
        CapabilitySetId, PhysicalBufferMut, PolicyExecutionError, SemanticInputBatch,
        ValidatedPolicy,
    },
};

pub const MAX_PHYSICAL_BUFFERS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackingError {
    ArithmeticOverflow,
    CapacityExceeded,
    Policy(PolicyExecutionError),
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
        let length = output_records as usize * schema.stride();
        // SAFETY: the caller sizes mutually disjoint payload segments before this call, and the
        // payload cannot reallocate while these temporary views exist.
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
        let stride = u32::from(schema.stride);
        let divisor = gcd(byte_alignment, stride);
        lcm(records, byte_alignment / divisor)
    })
}

pub fn align_up(value: u32, alignment: u32) -> Result<u32, PackingError> {
    value
        .checked_add(alignment - 1)
        .map(|value| value / alignment * alignment)
        .ok_or(PackingError::ArithmeticOverflow)
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
