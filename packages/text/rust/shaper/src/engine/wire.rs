//! Fixed-width policy wire decoding.
//!
//! Rust compiler-derived offsets in `abi_contract` are the only layout authority. This decoder
//! performs one bounded registration-time pass over direct Wasm memory and retains typed policy
//! data; frame updates never revisit these records.

use alloc::vec::Vec;

use crate::{
    STATUS_INVALID_REQUEST,
    abi_contract::{
        POLICY_BUFFER_COUNT, POLICY_BUFFER_ID, POLICY_BUFFER_RECORD_ALIGNMENT,
        POLICY_BUFFER_RECORD_SIZE, POLICY_BUFFER_SCALAR, POLICY_BUFFER_VECTOR_WIDTH,
        POLICY_BUFFERS_OFFSET, POLICY_BYTE_LENGTH, POLICY_OPERATION_COUNT,
        POLICY_OPERATION_IMMEDIATE0, POLICY_OPERATION_IMMEDIATE1, POLICY_OPERATION_IMMEDIATE2,
        POLICY_OPERATION_OPCODE, POLICY_OPERATION_OPERAND0, POLICY_OPERATION_OPERAND1,
        POLICY_OPERATION_RECORD_ALIGNMENT, POLICY_OPERATION_RECORD_SIZE, POLICY_OPERATION_TARGET,
        POLICY_OPERATIONS_OFFSET, POLICY_PROGRAM_BUFFER_COUNT, POLICY_PROGRAM_BUFFER_START,
        POLICY_PROGRAM_COMPOSITING_CAPABILITIES, POLICY_PROGRAM_COUNT,
        POLICY_PROGRAM_F32_INPUT_COUNT, POLICY_PROGRAM_ID, POLICY_PROGRAM_OPERATION_COUNT,
        POLICY_PROGRAM_OPERATION_START, POLICY_PROGRAM_PAINT_CAPABILITIES,
        POLICY_PROGRAM_RECORD_ALIGNMENT, POLICY_PROGRAM_RECORD_SIZE, POLICY_PROGRAM_RESERVED0,
        POLICY_PROGRAM_RESERVED1, POLICY_PROGRAM_TECHNIQUE_ID, POLICY_PROGRAM_U32_INPUT_COUNT,
        POLICY_PROGRAM_VARIANT, POLICY_PROGRAMS_OFFSET, POLICY_REQUEST_HEADER_SIZE,
    },
    engine::policy::{
        BufferId, BufferSchema, MAX_BUFFERS_PER_PROGRAM, MAX_OPERATIONS_PER_PROGRAM, MAX_PROGRAMS,
        OP_ADD_F32, OP_CONSTANT_F32, OP_CONSTANT_U32, OP_CONVERT_U32_TO_F32, OP_LESS_THAN_F32,
        OP_LOAD_F32, OP_LOAD_U32, OP_MULTIPLY_F32, OP_SELECT_F32, OP_STORE_F32, OP_STORE_U16,
        OP_STORE_U32, OP_SUBTRACT_F32, Operation, PolicyDescriptor, ProgramCapabilities,
        ProgramDescriptor, ProgramId, ScalarType, TechniqueId, ValidatedPolicy,
    },
    wire::{array, read_u16, read_u32},
};

pub(crate) fn parse_policy(bytes: &[u8]) -> Result<ValidatedPolicy, u32> {
    if bytes.len() < POLICY_REQUEST_HEADER_SIZE as usize
        || read_u32(bytes, POLICY_BYTE_LENGTH)?
            != u32::try_from(bytes.len()).map_err(|_| STATUS_INVALID_REQUEST)?
    {
        return Err(STATUS_INVALID_REQUEST);
    }

    let program_count = read_u32(bytes, POLICY_PROGRAM_COUNT)?;
    let buffer_count = read_u32(bytes, POLICY_BUFFER_COUNT)?;
    let operation_count = read_u32(bytes, POLICY_OPERATION_COUNT)?;
    if usize::try_from(program_count).map_err(|_| STATUS_INVALID_REQUEST)? > MAX_PROGRAMS
        || usize::try_from(buffer_count).map_err(|_| STATUS_INVALID_REQUEST)?
            > MAX_PROGRAMS * MAX_BUFFERS_PER_PROGRAM
        || usize::try_from(operation_count).map_err(|_| STATUS_INVALID_REQUEST)?
            > MAX_PROGRAMS * MAX_OPERATIONS_PER_PROGRAM
    {
        return Err(STATUS_INVALID_REQUEST);
    }

    let programs = table(
        bytes,
        read_u32(bytes, POLICY_PROGRAMS_OFFSET)?,
        program_count,
        POLICY_PROGRAM_RECORD_SIZE,
        POLICY_PROGRAM_RECORD_ALIGNMENT,
    )?;
    let buffers_offset = read_u32(bytes, POLICY_BUFFERS_OFFSET)?;
    let buffers = table(
        bytes,
        buffers_offset,
        buffer_count,
        POLICY_BUFFER_RECORD_SIZE,
        POLICY_BUFFER_RECORD_ALIGNMENT,
    )?;
    let operations_offset = read_u32(bytes, POLICY_OPERATIONS_OFFSET)?;
    let operations = table(
        bytes,
        operations_offset,
        operation_count,
        POLICY_OPERATION_RECORD_SIZE,
        POLICY_OPERATION_RECORD_ALIGNMENT,
    )?;
    reject_overlaps(bytes, programs, buffers, operations)?;

    let mut decoded = Vec::new();
    decoded
        .try_reserve_exact(usize::try_from(program_count).map_err(|_| STATUS_INVALID_REQUEST)?)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in programs.chunks_exact(POLICY_PROGRAM_RECORD_SIZE as usize) {
        if read_u16(record, POLICY_PROGRAM_RESERVED0)? != 0
            || read_u16(record, POLICY_PROGRAM_RESERVED1)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let selected_buffers = indexed_records(
            buffers,
            read_u32(record, POLICY_PROGRAM_BUFFER_START)?,
            read_u16(record, POLICY_PROGRAM_BUFFER_COUNT)?,
            POLICY_BUFFER_RECORD_SIZE,
        )?;
        let selected_operations = indexed_records(
            operations,
            read_u32(record, POLICY_PROGRAM_OPERATION_START)?,
            read_u16(record, POLICY_PROGRAM_OPERATION_COUNT)?,
            POLICY_OPERATION_RECORD_SIZE,
        )?;
        decoded.push(ProgramDescriptor {
            technique: TechniqueId(read_u32(record, POLICY_PROGRAM_TECHNIQUE_ID)?),
            variant: read_u16(record, POLICY_PROGRAM_VARIANT)?,
            id: ProgramId(read_u32(record, POLICY_PROGRAM_ID)?),
            f32_input_count: byte(record, POLICY_PROGRAM_F32_INPUT_COUNT)?,
            u32_input_count: byte(record, POLICY_PROGRAM_U32_INPUT_COUNT)?,
            capabilities: ProgramCapabilities {
                paint: read_u32(record, POLICY_PROGRAM_PAINT_CAPABILITIES)?,
                compositing: read_u32(record, POLICY_PROGRAM_COMPOSITING_CAPABILITIES)?,
            },
            buffers: decode_buffers(selected_buffers)?,
            operations: decode_operations(selected_operations)?,
        });
    }
    ValidatedPolicy::new(PolicyDescriptor { programs: decoded }).map_err(|_| STATUS_INVALID_REQUEST)
}

fn table(bytes: &[u8], offset: u32, count: u32, stride: u32, alignment: u32) -> Result<&[u8], u32> {
    if offset < POLICY_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    array(bytes, offset, count, stride, alignment)
}

fn reject_overlaps(
    bytes: &[u8],
    programs: &[u8],
    buffers: &[u8],
    operations: &[u8],
) -> Result<(), u32> {
    let ranges = [
        relative_range(bytes, programs)?,
        relative_range(bytes, buffers)?,
        relative_range(bytes, operations)?,
    ];
    for index in 0..ranges.len() {
        for previous in &ranges[..index] {
            let current = ranges[index];
            if current.start < previous.end && previous.start < current.end {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct ByteRange {
    start: usize,
    end: usize,
}

fn relative_range(container: &[u8], selected: &[u8]) -> Result<ByteRange, u32> {
    let start = (selected.as_ptr() as usize)
        .checked_sub(container.as_ptr() as usize)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok(ByteRange {
        start,
        end: start
            .checked_add(selected.len())
            .ok_or(STATUS_INVALID_REQUEST)?,
    })
}

fn indexed_records(records: &[u8], start: u32, count: u16, stride: u32) -> Result<&[u8], u32> {
    let offset = start.checked_mul(stride).ok_or(STATUS_INVALID_REQUEST)?;
    array(records, offset, u32::from(count), stride, 1)
}

fn decode_buffers(records: &[u8]) -> Result<Vec<BufferSchema>, u32> {
    let mut buffers = Vec::new();
    buffers
        .try_reserve_exact(records.len() / POLICY_BUFFER_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(POLICY_BUFFER_RECORD_SIZE as usize) {
        let scalar = match byte(record, POLICY_BUFFER_SCALAR)? {
            value if value == ScalarType::F32 as u8 => ScalarType::F32,
            value if value == ScalarType::U32 as u8 => ScalarType::U32,
            value if value == ScalarType::U16 as u8 => ScalarType::U16,
            _ => return Err(STATUS_INVALID_REQUEST),
        };
        buffers.push(BufferSchema {
            id: BufferId(read_u16(record, POLICY_BUFFER_ID)?),
            scalar,
            vector_width: byte(record, POLICY_BUFFER_VECTOR_WIDTH)?,
        });
    }
    Ok(buffers)
}

fn decode_operations(records: &[u8]) -> Result<Vec<Operation>, u32> {
    let mut operations = Vec::new();
    operations
        .try_reserve_exact(records.len() / POLICY_OPERATION_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(POLICY_OPERATION_RECORD_SIZE as usize) {
        operations.push(decode_operation(record)?);
    }
    Ok(operations)
}

fn decode_operation(record: &[u8]) -> Result<Operation, u32> {
    let opcode = byte(record, POLICY_OPERATION_OPCODE)?;
    let target = byte(record, POLICY_OPERATION_TARGET)?;
    let operand0 = byte(record, POLICY_OPERATION_OPERAND0)?;
    let operand1 = byte(record, POLICY_OPERATION_OPERAND1)?;
    let immediate0 = read_u32(record, POLICY_OPERATION_IMMEDIATE0)?;
    let immediate1 = read_u32(record, POLICY_OPERATION_IMMEDIATE1)?;
    let immediate2 = read_u32(record, POLICY_OPERATION_IMMEDIATE2)?;
    let no_immediates = || {
        (immediate0 == 0 && immediate1 == 0 && immediate2 == 0)
            .then_some(())
            .ok_or(STATUS_INVALID_REQUEST)
    };
    match opcode {
        OP_LOAD_F32 | OP_LOAD_U32 => {
            if operand1 != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            no_immediates()?;
            Ok(if opcode == OP_LOAD_F32 {
                Operation::LoadF32 {
                    target,
                    field: operand0,
                }
            } else {
                Operation::LoadU32 {
                    target,
                    field: operand0,
                }
            })
        }
        OP_CONSTANT_F32 | OP_CONSTANT_U32 => {
            if operand0 != 0 || operand1 != 0 || immediate1 != 0 || immediate2 != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            Ok(if opcode == OP_CONSTANT_F32 {
                Operation::ConstantF32 {
                    target,
                    bits: immediate0,
                }
            } else {
                Operation::ConstantU32 {
                    target,
                    value: immediate0,
                }
            })
        }
        OP_ADD_F32 | OP_SUBTRACT_F32 | OP_MULTIPLY_F32 | OP_LESS_THAN_F32 => {
            no_immediates()?;
            Ok(match opcode {
                OP_ADD_F32 => Operation::AddF32 {
                    target,
                    left: operand0,
                    right: operand1,
                },
                OP_SUBTRACT_F32 => Operation::SubtractF32 {
                    target,
                    left: operand0,
                    right: operand1,
                },
                OP_MULTIPLY_F32 => Operation::MultiplyF32 {
                    target,
                    left: operand0,
                    right: operand1,
                },
                _ => Operation::LessThanF32 {
                    target,
                    left: operand0,
                    right: operand1,
                },
            })
        }
        OP_SELECT_F32 => {
            if immediate0 > u8::MAX.into() || immediate1 != 0 || immediate2 != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            Ok(Operation::SelectF32 {
                target,
                condition: operand0,
                when_true: operand1,
                when_false: immediate0 as u8,
            })
        }
        OP_CONVERT_U32_TO_F32 => {
            if operand1 != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            no_immediates()?;
            Ok(Operation::ConvertU32ToF32 {
                target,
                source: operand0,
            })
        }
        OP_STORE_F32 | OP_STORE_U32 | OP_STORE_U16 => {
            if target != 0 || immediate0 > u16::MAX.into() || immediate1 != 0 || immediate2 != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            let buffer = BufferId(immediate0 as u16);
            Ok(match opcode {
                OP_STORE_F32 => Operation::StoreF32 {
                    source: operand0,
                    buffer,
                    lane: operand1,
                },
                OP_STORE_U32 => Operation::StoreU32 {
                    source: operand0,
                    buffer,
                    lane: operand1,
                },
                _ => Operation::StoreU16 {
                    source: operand0,
                    buffer,
                    lane: operand1,
                },
            })
        }
        _ => Err(STATUS_INVALID_REQUEST),
    }
}

fn byte(bytes: &[u8], offset: usize) -> Result<u8, u32> {
    bytes.get(offset).copied().ok_or(STATUS_INVALID_REQUEST)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const PROGRAMS_OFFSET: usize = POLICY_REQUEST_HEADER_SIZE as usize;
    const BUFFERS_OFFSET: usize = PROGRAMS_OFFSET + POLICY_PROGRAM_RECORD_SIZE as usize;
    const OPERATIONS_OFFSET: usize = BUFFERS_OFFSET + POLICY_BUFFER_RECORD_SIZE as usize;
    const OPERATION_COUNT: usize = 4;
    const BYTE_LENGTH: usize =
        OPERATIONS_OFFSET + OPERATION_COUNT * POLICY_OPERATION_RECORD_SIZE as usize;

    #[test]
    fn decodes_compiler_mapped_policy_records() {
        let bytes = valid_policy_bytes();
        let policy = parse_policy(&bytes).unwrap();
        let program = policy.program(TechniqueId(1), 0).unwrap();
        assert_eq!(program.id, ProgramId(2));
        assert_eq!(program.buffers[0].stride(), 8);
        assert_eq!(program.operations.len(), OPERATION_COUNT);
    }

    #[test]
    fn rejects_forged_lengths_overlaps_and_reserved_data() {
        let mut forged_length = valid_policy_bytes();
        put_u32(&mut forged_length, POLICY_BYTE_LENGTH, u32::MAX);
        assert_eq!(parse_policy(&forged_length), Err(STATUS_INVALID_REQUEST));

        let mut overlap = valid_policy_bytes();
        put_u32(
            &mut overlap,
            POLICY_BUFFERS_OFFSET,
            u32::try_from(PROGRAMS_OFFSET).unwrap(),
        );
        assert_eq!(parse_policy(&overlap), Err(STATUS_INVALID_REQUEST));

        let mut reserved = valid_policy_bytes();
        put_u16(
            &mut reserved[PROGRAMS_OFFSET..],
            POLICY_PROGRAM_RESERVED0,
            1,
        );
        assert_eq!(parse_policy(&reserved), Err(STATUS_INVALID_REQUEST));
    }

    #[test]
    fn rejects_unknown_and_noncanonical_operations() {
        let mut unknown = valid_policy_bytes();
        unknown[OPERATIONS_OFFSET + POLICY_OPERATION_OPCODE] = u8::MAX;
        assert_eq!(parse_policy(&unknown), Err(STATUS_INVALID_REQUEST));

        let mut noncanonical = valid_policy_bytes();
        noncanonical[OPERATIONS_OFFSET + POLICY_OPERATION_OPERAND1] = 1;
        assert_eq!(parse_policy(&noncanonical), Err(STATUS_INVALID_REQUEST));
    }

    fn valid_policy_bytes() -> Vec<u8> {
        let mut bytes = vec![0; BYTE_LENGTH];
        put_u32(&mut bytes, POLICY_BYTE_LENGTH, BYTE_LENGTH as u32);
        put_u32(&mut bytes, POLICY_PROGRAMS_OFFSET, PROGRAMS_OFFSET as u32);
        put_u32(&mut bytes, POLICY_PROGRAM_COUNT, 1);
        put_u32(&mut bytes, POLICY_BUFFERS_OFFSET, BUFFERS_OFFSET as u32);
        put_u32(&mut bytes, POLICY_BUFFER_COUNT, 1);
        put_u32(
            &mut bytes,
            POLICY_OPERATIONS_OFFSET,
            OPERATIONS_OFFSET as u32,
        );
        put_u32(&mut bytes, POLICY_OPERATION_COUNT, OPERATION_COUNT as u32);

        let program = &mut bytes[PROGRAMS_OFFSET..BUFFERS_OFFSET];
        put_u32(program, POLICY_PROGRAM_TECHNIQUE_ID, 1);
        put_u32(program, POLICY_PROGRAM_ID, 2);
        program[POLICY_PROGRAM_F32_INPUT_COUNT] = 2;
        put_u16(program, POLICY_PROGRAM_BUFFER_COUNT, 1);
        put_u16(
            program,
            POLICY_PROGRAM_OPERATION_COUNT,
            OPERATION_COUNT as u16,
        );

        let buffer = &mut bytes[BUFFERS_OFFSET..OPERATIONS_OFFSET];
        put_u16(buffer, POLICY_BUFFER_ID, 1);
        buffer[POLICY_BUFFER_SCALAR] = ScalarType::F32 as u8;
        buffer[POLICY_BUFFER_VECTOR_WIDTH] = 2;

        write_operation(&mut bytes, 0, OP_LOAD_F32, 0, 0, 0, 0);
        write_operation(&mut bytes, 1, OP_LOAD_F32, 1, 1, 0, 0);
        write_operation(&mut bytes, 2, OP_STORE_F32, 0, 0, 0, 1);
        write_operation(&mut bytes, 3, OP_STORE_F32, 0, 1, 1, 1);
        bytes
    }

    fn write_operation(
        bytes: &mut [u8],
        index: usize,
        opcode: u8,
        target: u8,
        operand0: u8,
        operand1: u8,
        immediate0: u32,
    ) {
        let start = OPERATIONS_OFFSET + index * POLICY_OPERATION_RECORD_SIZE as usize;
        let record = &mut bytes[start..start + POLICY_OPERATION_RECORD_SIZE as usize];
        record[POLICY_OPERATION_OPCODE] = opcode;
        record[POLICY_OPERATION_TARGET] = target;
        record[POLICY_OPERATION_OPERAND0] = operand0;
        record[POLICY_OPERATION_OPERAND1] = operand1;
        put_u32(record, POLICY_OPERATION_IMMEDIATE0, immediate0);
    }

    fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}
