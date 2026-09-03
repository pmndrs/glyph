//! Fixed-width Codec wire decoding.
//!
//! Rust compiler-derived offsets in `abi_contract` are the only layout authority. This decoder
//! performs one bounded registration-time pass over direct Wasm memory and retains typed codec
//! data; frame updates never revisit these records.

use alloc::vec::Vec;

use super::render_plan::{PRIMITIVE_DECORATION, PRIMITIVE_GLYPH};
use crate::{
    STATUS_INVALID_REQUEST,
    abi_contract::{
        CODEC_BUFFER_ALIGNMENT, CODEC_BUFFER_CAPACITY_CLASS, CODEC_BUFFER_COUNT, CODEC_BUFFER_ID,
        CODEC_BUFFER_RECORD_ALIGNMENT, CODEC_BUFFER_RECORD_SIZE, CODEC_BUFFER_RESERVED0,
        CODEC_BUFFER_SCALAR, CODEC_BUFFER_STRIDE, CODEC_BUFFER_USAGE, CODEC_BUFFER_VECTOR_WIDTH,
        CODEC_BUFFERS_OFFSET, CODEC_BYTE_LENGTH, CODEC_CAPABILITY_SET_COALESCE_GAP_BYTES,
        CODEC_CAPABILITY_SET_COUNT, CODEC_CAPABILITY_SET_FLAGS,
        CODEC_CAPABILITY_SET_FRAGMENTATION_BUDGET, CODEC_CAPABILITY_SET_ID,
        CODEC_CAPABILITY_SET_MAX_BUFFER_BYTES, CODEC_CAPABILITY_SET_MAX_BUFFERS_PER_DRAW,
        CODEC_CAPABILITY_SET_MAX_INDIRECT_DRAWS, CODEC_CAPABILITY_SET_MAX_RESOURCES_PER_DRAW,
        CODEC_CAPABILITY_SET_RANGE_CALL_PENALTY_BYTES, CODEC_CAPABILITY_SET_RECORD_ALIGNMENT,
        CODEC_CAPABILITY_SET_RECORD_SIZE, CODEC_CAPABILITY_SET_RESERVED,
        CODEC_CAPABILITY_SET_UPDATE_ALIGNMENT,
        CODEC_CAPABILITY_SET_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS, CODEC_CAPABILITY_SETS_OFFSET,
        CODEC_INPUT_COUNT, CODEC_INPUT_FIELD, CODEC_INPUT_RECORD_ALIGNMENT,
        CODEC_INPUT_RECORD_SIZE, CODEC_INPUT_RESERVED, CODEC_INPUT_SCOPE, CODEC_INPUTS_OFFSET,
        CODEC_OPERATION_COUNT, CODEC_OPERATION_IMMEDIATE0, CODEC_OPERATION_IMMEDIATE1,
        CODEC_OPERATION_IMMEDIATE2, CODEC_OPERATION_OPCODE, CODEC_OPERATION_OPERAND0,
        CODEC_OPERATION_OPERAND1, CODEC_OPERATION_RECORD_ALIGNMENT, CODEC_OPERATION_RECORD_SIZE,
        CODEC_OPERATION_TARGET, CODEC_OPERATIONS_OFFSET, CODEC_PROGRAM_ALLOCATION_STRATEGY,
        CODEC_PROGRAM_BUFFER_COUNT, CODEC_PROGRAM_BUFFER_START, CODEC_PROGRAM_CAPABILITY_SET_ID,
        CODEC_PROGRAM_COMPOSITING_CAPABILITIES, CODEC_PROGRAM_COUNT, CODEC_PROGRAM_DRAW_KEY_MASK,
        CODEC_PROGRAM_F32_INPUT_COUNT, CODEC_PROGRAM_ID, CODEC_PROGRAM_INPUT_COUNT,
        CODEC_PROGRAM_INPUT_START, CODEC_PROGRAM_OPERATION_COUNT, CODEC_PROGRAM_OPERATION_START,
        CODEC_PROGRAM_PAINT_CAPABILITIES, CODEC_PROGRAM_PRIMITIVE_KIND,
        CODEC_PROGRAM_RECORD_ALIGNMENT, CODEC_PROGRAM_RECORD_SIZE, CODEC_PROGRAM_RESERVED1,
        CODEC_PROGRAM_RESOURCE_KIND_MASK, CODEC_PROGRAM_SEMANTIC_VIEW_MASK,
        CODEC_PROGRAM_STORAGE_KEY_MASK, CODEC_PROGRAM_TECHNIQUE_ID, CODEC_PROGRAM_U32_INPUT_COUNT,
        CODEC_PROGRAM_VARIANT, CODEC_PROGRAMS_OFFSET, CODEC_REQUEST_HEADER_SIZE,
    },
    engine::codec::{
        BufferId, BufferSchema, CapabilitySet, CapabilitySetId, CodecDescriptor, INPUT_GLYPH,
        INPUT_RESOURCE, INPUT_SEMANTIC, INPUT_STRIKE, InputScope, InputSource,
        MAX_BUFFERS_PER_PROGRAM, MAX_CAPABILITY_SETS, MAX_INPUT_FIELDS_PER_PROGRAM,
        MAX_OPERATIONS_PER_PROGRAM, MAX_PROGRAMS, OP_ADD_F32, OP_CONSTANT_F32, OP_CONSTANT_U32,
        OP_CONVERT_U32_TO_F32, OP_LESS_THAN_F32, OP_LOAD_F32, OP_LOAD_U32, OP_MULTIPLY_F32,
        OP_SELECT_F32, OP_STORE_F32, OP_STORE_U16, OP_STORE_U32, OP_SUBTRACT_F32, Operation,
        ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType, TechniqueId, ValidatedCodec,
    },
    wire::{array, read_u16, read_u32},
};

pub(crate) fn parse_codec(bytes: &[u8]) -> Result<ValidatedCodec, u32> {
    if bytes.len() < CODEC_REQUEST_HEADER_SIZE as usize
        || read_u32(bytes, CODEC_BYTE_LENGTH)?
            != u32::try_from(bytes.len()).map_err(|_| STATUS_INVALID_REQUEST)?
    {
        return Err(STATUS_INVALID_REQUEST);
    }

    let capability_set_count = read_u32(bytes, CODEC_CAPABILITY_SET_COUNT)?;
    let program_count = read_u32(bytes, CODEC_PROGRAM_COUNT)?;
    let buffer_count = read_u32(bytes, CODEC_BUFFER_COUNT)?;
    let operation_count = read_u32(bytes, CODEC_OPERATION_COUNT)?;
    let input_count = read_u32(bytes, CODEC_INPUT_COUNT)?;
    if usize::try_from(capability_set_count).map_err(|_| STATUS_INVALID_REQUEST)?
        > MAX_CAPABILITY_SETS
        || usize::try_from(program_count).map_err(|_| STATUS_INVALID_REQUEST)? > MAX_PROGRAMS
        || usize::try_from(buffer_count).map_err(|_| STATUS_INVALID_REQUEST)?
            > MAX_PROGRAMS * MAX_BUFFERS_PER_PROGRAM
        || usize::try_from(operation_count).map_err(|_| STATUS_INVALID_REQUEST)?
            > MAX_PROGRAMS * MAX_OPERATIONS_PER_PROGRAM
        || usize::try_from(input_count).map_err(|_| STATUS_INVALID_REQUEST)?
            > MAX_PROGRAMS * MAX_INPUT_FIELDS_PER_PROGRAM
    {
        return Err(STATUS_INVALID_REQUEST);
    }

    let capability_sets = table(
        bytes,
        read_u32(bytes, CODEC_CAPABILITY_SETS_OFFSET)?,
        capability_set_count,
        CODEC_CAPABILITY_SET_RECORD_SIZE,
        CODEC_CAPABILITY_SET_RECORD_ALIGNMENT,
    )?;
    let programs = table(
        bytes,
        read_u32(bytes, CODEC_PROGRAMS_OFFSET)?,
        program_count,
        CODEC_PROGRAM_RECORD_SIZE,
        CODEC_PROGRAM_RECORD_ALIGNMENT,
    )?;
    let buffers_offset = read_u32(bytes, CODEC_BUFFERS_OFFSET)?;
    let buffers = table(
        bytes,
        buffers_offset,
        buffer_count,
        CODEC_BUFFER_RECORD_SIZE,
        CODEC_BUFFER_RECORD_ALIGNMENT,
    )?;
    let operations_offset = read_u32(bytes, CODEC_OPERATIONS_OFFSET)?;
    let operations = table(
        bytes,
        operations_offset,
        operation_count,
        CODEC_OPERATION_RECORD_SIZE,
        CODEC_OPERATION_RECORD_ALIGNMENT,
    )?;
    let inputs = table(
        bytes,
        read_u32(bytes, CODEC_INPUTS_OFFSET)?,
        input_count,
        CODEC_INPUT_RECORD_SIZE,
        CODEC_INPUT_RECORD_ALIGNMENT,
    )?;
    reject_overlaps(
        bytes,
        capability_sets,
        programs,
        buffers,
        operations,
        inputs,
    )?;

    let capability_sets = decode_capability_sets(capability_sets)?;

    let mut decoded = Vec::new();
    decoded
        .try_reserve_exact(usize::try_from(program_count).map_err(|_| STATUS_INVALID_REQUEST)?)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in programs.chunks_exact(CODEC_PROGRAM_RECORD_SIZE as usize) {
        let primitive_kind = match read_u16(record, CODEC_PROGRAM_PRIMITIVE_KIND)? {
            0 | PRIMITIVE_GLYPH => PRIMITIVE_GLYPH,
            PRIMITIVE_DECORATION => PRIMITIVE_DECORATION,
            _ => return Err(STATUS_INVALID_REQUEST),
        };
        if read_u16(record, CODEC_PROGRAM_RESERVED1)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        let selected_buffers = indexed_records(
            buffers,
            read_u32(record, CODEC_PROGRAM_BUFFER_START)?,
            read_u16(record, CODEC_PROGRAM_BUFFER_COUNT)?,
            CODEC_BUFFER_RECORD_SIZE,
        )?;
        let selected_operations = indexed_records(
            operations,
            read_u32(record, CODEC_PROGRAM_OPERATION_START)?,
            read_u16(record, CODEC_PROGRAM_OPERATION_COUNT)?,
            CODEC_OPERATION_RECORD_SIZE,
        )?;
        let selected_inputs = indexed_records(
            inputs,
            read_u32(record, CODEC_PROGRAM_INPUT_START)?,
            read_u16(record, CODEC_PROGRAM_INPUT_COUNT)?,
            CODEC_INPUT_RECORD_SIZE,
        )?;
        decoded.push(ProgramDescriptor {
            primitive_kind,
            technique: TechniqueId(read_u32(record, CODEC_PROGRAM_TECHNIQUE_ID)?),
            variant: read_u16(record, CODEC_PROGRAM_VARIANT)?,
            id: ProgramId(read_u32(record, CODEC_PROGRAM_ID)?),
            capability_set: CapabilitySetId(read_u32(record, CODEC_PROGRAM_CAPABILITY_SET_ID)?),
            resource_kind_mask: read_u32(record, CODEC_PROGRAM_RESOURCE_KIND_MASK)?,
            semantic_view_mask: read_u32(record, CODEC_PROGRAM_SEMANTIC_VIEW_MASK)?,
            storage_key_mask: read_u32(record, CODEC_PROGRAM_STORAGE_KEY_MASK)?,
            draw_key_mask: read_u32(record, CODEC_PROGRAM_DRAW_KEY_MASK)?,
            allocation_strategy: read_u16(record, CODEC_PROGRAM_ALLOCATION_STRATEGY)?,
            f32_input_count: byte(record, CODEC_PROGRAM_F32_INPUT_COUNT)?,
            u32_input_count: byte(record, CODEC_PROGRAM_U32_INPUT_COUNT)?,
            inputs: decode_inputs(selected_inputs)?,
            capabilities: ProgramCapabilities {
                paint: read_u32(record, CODEC_PROGRAM_PAINT_CAPABILITIES)?,
                compositing: read_u32(record, CODEC_PROGRAM_COMPOSITING_CAPABILITIES)?,
            },
            buffers: decode_buffers(selected_buffers)?,
            operations: decode_operations(selected_operations)?,
        });
    }
    ValidatedCodec::new(CodecDescriptor {
        capability_sets,
        programs: decoded,
    })
    .map_err(|_| STATUS_INVALID_REQUEST)
}

fn table(bytes: &[u8], offset: u32, count: u32, stride: u32, alignment: u32) -> Result<&[u8], u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(&bytes[..0])
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < CODEC_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    array(bytes, offset, count, stride, alignment)
}

fn reject_overlaps(
    bytes: &[u8],
    capability_sets: &[u8],
    programs: &[u8],
    buffers: &[u8],
    operations: &[u8],
    inputs: &[u8],
) -> Result<(), u32> {
    let ranges = [
        relative_range(bytes, capability_sets)?,
        relative_range(bytes, programs)?,
        relative_range(bytes, buffers)?,
        relative_range(bytes, operations)?,
        relative_range(bytes, inputs)?,
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

fn decode_inputs(records: &[u8]) -> Result<Vec<InputSource>, u32> {
    let mut inputs = Vec::new();
    inputs
        .try_reserve_exact(records.len() / CODEC_INPUT_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(CODEC_INPUT_RECORD_SIZE as usize) {
        if read_u16(record, CODEC_INPUT_RESERVED)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        let scope = match byte(record, CODEC_INPUT_SCOPE)? {
            INPUT_SEMANTIC => InputScope::Semantic,
            INPUT_GLYPH => InputScope::Glyph,
            INPUT_RESOURCE => InputScope::Resource,
            INPUT_STRIKE => InputScope::Strike,
            _ => return Err(STATUS_INVALID_REQUEST),
        };
        inputs.push(InputSource {
            scope,
            field: byte(record, CODEC_INPUT_FIELD)?,
        });
    }
    Ok(inputs)
}

fn decode_capability_sets(records: &[u8]) -> Result<Vec<CapabilitySet>, u32> {
    let mut capability_sets = Vec::new();
    capability_sets
        .try_reserve_exact(records.len() / CODEC_CAPABILITY_SET_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(CODEC_CAPABILITY_SET_RECORD_SIZE as usize) {
        if read_u16(record, CODEC_CAPABILITY_SET_RESERVED)? != 0
            || read_u16(record, CODEC_CAPABILITY_SET_RESERVED + 2)? != 0
            || read_u16(record, CODEC_CAPABILITY_SET_RESERVED + 4)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        capability_sets.push(CapabilitySet {
            id: CapabilitySetId(read_u32(record, CODEC_CAPABILITY_SET_ID)?),
            flags: read_u32(record, CODEC_CAPABILITY_SET_FLAGS)?,
            max_buffer_bytes: read_u32(record, CODEC_CAPABILITY_SET_MAX_BUFFER_BYTES)?,
            update_alignment: read_u32(record, CODEC_CAPABILITY_SET_UPDATE_ALIGNMENT)?,
            coalesce_gap_bytes: read_u32(record, CODEC_CAPABILITY_SET_COALESCE_GAP_BYTES)?,
            range_call_penalty_bytes: read_u32(
                record,
                CODEC_CAPABILITY_SET_RANGE_CALL_PENALTY_BYTES,
            )?,
            max_buffers_per_draw: read_u16(record, CODEC_CAPABILITY_SET_MAX_BUFFERS_PER_DRAW)?,
            max_resources_per_draw: read_u16(record, CODEC_CAPABILITY_SET_MAX_RESOURCES_PER_DRAW)?,
            max_indirect_draws: read_u16(record, CODEC_CAPABILITY_SET_MAX_INDIRECT_DRAWS)?,
            fragmentation_budget: read_u16(record, CODEC_CAPABILITY_SET_FRAGMENTATION_BUDGET)?,
            whole_buffer_threshold_basis_points: read_u16(
                record,
                CODEC_CAPABILITY_SET_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS,
            )?,
        });
    }
    Ok(capability_sets)
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
        .try_reserve_exact(records.len() / CODEC_BUFFER_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(CODEC_BUFFER_RECORD_SIZE as usize) {
        if read_u16(record, CODEC_BUFFER_RESERVED0)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        let scalar = match byte(record, CODEC_BUFFER_SCALAR)? {
            value if value == ScalarType::F32 as u8 => ScalarType::F32,
            value if value == ScalarType::U32 as u8 => ScalarType::U32,
            value if value == ScalarType::U16 as u8 => ScalarType::U16,
            _ => return Err(STATUS_INVALID_REQUEST),
        };
        buffers.push(BufferSchema {
            id: BufferId(read_u16(record, CODEC_BUFFER_ID)?),
            scalar,
            vector_width: byte(record, CODEC_BUFFER_VECTOR_WIDTH)?,
            alignment: read_u16(record, CODEC_BUFFER_ALIGNMENT)?,
            stride: read_u16(record, CODEC_BUFFER_STRIDE)?,
            usage: read_u32(record, CODEC_BUFFER_USAGE)?,
            capacity_class: read_u16(record, CODEC_BUFFER_CAPACITY_CLASS)?,
        });
    }
    Ok(buffers)
}

fn decode_operations(records: &[u8]) -> Result<Vec<Operation>, u32> {
    let mut operations = Vec::new();
    operations
        .try_reserve_exact(records.len() / CODEC_OPERATION_RECORD_SIZE as usize)
        .map_err(|_| STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(CODEC_OPERATION_RECORD_SIZE as usize) {
        operations.push(decode_operation(record)?);
    }
    Ok(operations)
}

fn decode_operation(record: &[u8]) -> Result<Operation, u32> {
    let opcode = byte(record, CODEC_OPERATION_OPCODE)?;
    let target = byte(record, CODEC_OPERATION_TARGET)?;
    let operand0 = byte(record, CODEC_OPERATION_OPERAND0)?;
    let operand1 = byte(record, CODEC_OPERATION_OPERAND1)?;
    let immediate0 = read_u32(record, CODEC_OPERATION_IMMEDIATE0)?;
    let immediate1 = read_u32(record, CODEC_OPERATION_IMMEDIATE1)?;
    let immediate2 = read_u32(record, CODEC_OPERATION_IMMEDIATE2)?;
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

    const CAPABILITY_SETS_OFFSET: usize = CODEC_REQUEST_HEADER_SIZE as usize;
    const PROGRAMS_OFFSET: usize =
        CAPABILITY_SETS_OFFSET + CODEC_CAPABILITY_SET_RECORD_SIZE as usize;
    const BUFFERS_OFFSET: usize = PROGRAMS_OFFSET + CODEC_PROGRAM_RECORD_SIZE as usize;
    const OPERATIONS_OFFSET: usize = BUFFERS_OFFSET + CODEC_BUFFER_RECORD_SIZE as usize;
    const OPERATION_COUNT: usize = 4;
    const INPUTS_OFFSET: usize =
        OPERATIONS_OFFSET + OPERATION_COUNT * CODEC_OPERATION_RECORD_SIZE as usize;
    const INPUT_COUNT: usize = 2;
    const BYTE_LENGTH: usize = INPUTS_OFFSET + INPUT_COUNT * CODEC_INPUT_RECORD_SIZE as usize;

    #[test]
    fn decodes_compiler_mapped_codec_records() {
        let bytes = valid_codec_bytes();
        let codec = parse_codec(&bytes).unwrap();
        let program = codec
            .program(CapabilitySetId(1), TechniqueId(1), 0)
            .unwrap();
        assert_eq!(program.id, ProgramId(2));
        assert_eq!(program.buffers[0].stride(), 8);
        assert_eq!(program.operations.len(), OPERATION_COUNT);
        assert_eq!(
            program.inputs,
            vec![
                InputSource::semantic(0),
                InputSource {
                    scope: InputScope::Glyph,
                    field: 1,
                },
            ]
        );
    }

    #[test]
    fn rejects_forged_lengths_overlaps_and_reserved_data() {
        let mut forged_length = valid_codec_bytes();
        put_u32(&mut forged_length, CODEC_BYTE_LENGTH, u32::MAX);
        assert_eq!(parse_codec(&forged_length), Err(STATUS_INVALID_REQUEST));

        let mut overlap = valid_codec_bytes();
        put_u32(
            &mut overlap,
            CODEC_BUFFERS_OFFSET,
            u32::try_from(PROGRAMS_OFFSET).unwrap(),
        );
        assert_eq!(parse_codec(&overlap), Err(STATUS_INVALID_REQUEST));

        let mut unknown_kind = valid_codec_bytes();
        put_u16(
            &mut unknown_kind[PROGRAMS_OFFSET..],
            CODEC_PROGRAM_PRIMITIVE_KIND,
            7,
        );
        assert_eq!(parse_codec(&unknown_kind), Err(STATUS_INVALID_REQUEST));

        let mut unknown_input = valid_codec_bytes();
        unknown_input[INPUTS_OFFSET + CODEC_INPUT_SCOPE] = u8::MAX;
        assert_eq!(parse_codec(&unknown_input), Err(STATUS_INVALID_REQUEST));
    }

    #[test]
    fn rejects_unknown_and_noncanonical_operations() {
        let mut unknown = valid_codec_bytes();
        unknown[OPERATIONS_OFFSET + CODEC_OPERATION_OPCODE] = u8::MAX;
        assert_eq!(parse_codec(&unknown), Err(STATUS_INVALID_REQUEST));

        let mut noncanonical = valid_codec_bytes();
        noncanonical[OPERATIONS_OFFSET + CODEC_OPERATION_OPERAND1] = 1;
        assert_eq!(parse_codec(&noncanonical), Err(STATUS_INVALID_REQUEST));
    }

    fn valid_codec_bytes() -> Vec<u8> {
        let mut bytes = vec![0; BYTE_LENGTH];
        put_u32(&mut bytes, CODEC_BYTE_LENGTH, BYTE_LENGTH as u32);
        put_u32(
            &mut bytes,
            CODEC_CAPABILITY_SETS_OFFSET,
            CAPABILITY_SETS_OFFSET as u32,
        );
        put_u32(&mut bytes, CODEC_CAPABILITY_SET_COUNT, 1);
        put_u32(&mut bytes, CODEC_PROGRAMS_OFFSET, PROGRAMS_OFFSET as u32);
        put_u32(&mut bytes, CODEC_PROGRAM_COUNT, 1);
        put_u32(&mut bytes, CODEC_BUFFERS_OFFSET, BUFFERS_OFFSET as u32);
        put_u32(&mut bytes, CODEC_BUFFER_COUNT, 1);
        put_u32(
            &mut bytes,
            CODEC_OPERATIONS_OFFSET,
            OPERATIONS_OFFSET as u32,
        );
        put_u32(&mut bytes, CODEC_OPERATION_COUNT, OPERATION_COUNT as u32);
        put_u32(&mut bytes, CODEC_INPUTS_OFFSET, INPUTS_OFFSET as u32);
        put_u32(&mut bytes, CODEC_INPUT_COUNT, INPUT_COUNT as u32);

        let capability = &mut bytes[CAPABILITY_SETS_OFFSET..PROGRAMS_OFFSET];
        put_u32(capability, CODEC_CAPABILITY_SET_ID, 1);
        put_u32(
            capability,
            CODEC_CAPABILITY_SET_FLAGS,
            crate::engine::codec::CAP_ORDERED_DIRECT,
        );
        put_u32(capability, CODEC_CAPABILITY_SET_MAX_BUFFER_BYTES, 1024);
        put_u32(capability, CODEC_CAPABILITY_SET_UPDATE_ALIGNMENT, 4);
        put_u16(capability, CODEC_CAPABILITY_SET_MAX_BUFFERS_PER_DRAW, 1);
        put_u16(capability, CODEC_CAPABILITY_SET_MAX_RESOURCES_PER_DRAW, 1);
        put_u16(capability, CODEC_CAPABILITY_SET_FRAGMENTATION_BUDGET, 1);
        put_u16(
            capability,
            CODEC_CAPABILITY_SET_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS,
            10_000,
        );

        let program = &mut bytes[PROGRAMS_OFFSET..BUFFERS_OFFSET];
        put_u32(program, CODEC_PROGRAM_TECHNIQUE_ID, 1);
        put_u32(program, CODEC_PROGRAM_ID, 2);
        put_u32(program, CODEC_PROGRAM_RESOURCE_KIND_MASK, 1);
        put_u32(
            program,
            CODEC_PROGRAM_STORAGE_KEY_MASK,
            crate::engine::codec::BATCH_TECHNIQUE
                | crate::engine::codec::BATCH_PROGRAM
                | crate::engine::codec::BATCH_RESOURCE
                | crate::engine::codec::BATCH_DEPTH,
        );
        put_u32(
            program,
            CODEC_PROGRAM_DRAW_KEY_MASK,
            crate::engine::codec::BATCH_TECHNIQUE
                | crate::engine::codec::BATCH_PROGRAM
                | crate::engine::codec::BATCH_RESOURCE
                | crate::engine::codec::BATCH_DEPTH
                | crate::engine::codec::BATCH_ORDER
                | crate::engine::codec::BATCH_TRANSFORM,
        );
        put_u16(
            program,
            CODEC_PROGRAM_ALLOCATION_STRATEGY,
            crate::engine::codec::ALLOCATION_ORDERED_DIRECT,
        );
        program[CODEC_PROGRAM_F32_INPUT_COUNT] = 2;
        put_u16(program, CODEC_PROGRAM_BUFFER_COUNT, 1);
        put_u16(
            program,
            CODEC_PROGRAM_OPERATION_COUNT,
            OPERATION_COUNT as u16,
        );
        put_u16(program, CODEC_PROGRAM_INPUT_COUNT, INPUT_COUNT as u16);

        let buffer = &mut bytes[BUFFERS_OFFSET..OPERATIONS_OFFSET];
        put_u16(buffer, CODEC_BUFFER_ID, 1);
        buffer[CODEC_BUFFER_SCALAR] = ScalarType::F32 as u8;
        buffer[CODEC_BUFFER_VECTOR_WIDTH] = 2;
        put_u16(buffer, CODEC_BUFFER_ALIGNMENT, 4);
        put_u16(buffer, CODEC_BUFFER_STRIDE, 8);
        put_u32(
            buffer,
            CODEC_BUFFER_USAGE,
            crate::engine::codec::BUFFER_USAGE_COPY_DST,
        );
        put_u16(buffer, CODEC_BUFFER_CAPACITY_CLASS, 1);

        write_operation(&mut bytes, 0, OP_LOAD_F32, 0, 0, 0, 0);
        write_operation(&mut bytes, 1, OP_LOAD_F32, 1, 1, 0, 0);
        write_operation(&mut bytes, 2, OP_STORE_F32, 0, 0, 0, 1);
        write_operation(&mut bytes, 3, OP_STORE_F32, 0, 1, 1, 1);
        bytes[INPUTS_OFFSET + CODEC_INPUT_SCOPE] = INPUT_SEMANTIC;
        bytes[INPUTS_OFFSET + CODEC_INPUT_FIELD] = 0;
        bytes[INPUTS_OFFSET + CODEC_INPUT_RECORD_SIZE as usize + CODEC_INPUT_SCOPE] = INPUT_GLYPH;
        bytes[INPUTS_OFFSET + CODEC_INPUT_RECORD_SIZE as usize + CODEC_INPUT_FIELD] = 1;
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
        let start = OPERATIONS_OFFSET + index * CODEC_OPERATION_RECORD_SIZE as usize;
        let record = &mut bytes[start..start + CODEC_OPERATION_RECORD_SIZE as usize];
        record[CODEC_OPERATION_OPCODE] = opcode;
        record[CODEC_OPERATION_TARGET] = target;
        record[CODEC_OPERATION_OPERAND0] = operand0;
        record[CODEC_OPERATION_OPERAND1] = operand1;
        put_u32(record, CODEC_OPERATION_IMMEDIATE0, immediate0);
    }

    fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
}
