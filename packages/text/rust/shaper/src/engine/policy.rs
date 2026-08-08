//! Validated renderer policy data and its scalar correctness executor.
//!
//! Policies are intentionally straight-line. The engine owns record iteration, so a policy cannot
//! allocate, loop, branch backward, address arbitrary memory, or mutate semantic layout.

use alloc::vec::Vec;

pub const MAX_PROGRAMS: usize = 32;
pub const MAX_BUFFERS_PER_PROGRAM: usize = 16;
pub const MAX_OPERATIONS_PER_PROGRAM: usize = 128;
pub const MAX_REGISTERS: usize = 32;
pub const MAX_VECTOR_WIDTH: u8 = 4;
const MAX_OUTPUT_LANES: usize = MAX_BUFFERS_PER_PROGRAM * MAX_VECTOR_WIDTH as usize;
const NOT_A_STORE: u8 = u8::MAX;

pub const OP_LOAD_F32: u8 = 1;
pub const OP_LOAD_U32: u8 = 2;
pub const OP_CONSTANT_F32: u8 = 3;
pub const OP_CONSTANT_U32: u8 = 4;
pub const OP_ADD_F32: u8 = 5;
pub const OP_SUBTRACT_F32: u8 = 6;
pub const OP_MULTIPLY_F32: u8 = 7;
pub const OP_LESS_THAN_F32: u8 = 8;
pub const OP_SELECT_F32: u8 = 9;
pub const OP_CONVERT_U32_TO_F32: u8 = 10;
pub const OP_STORE_F32: u8 = 11;
pub const OP_STORE_U32: u8 = 12;
pub const OP_STORE_U16: u8 = 13;

const UNINITIALIZED: u8 = 0;
const F32_REGISTER: u8 = 1;
const U32_REGISTER: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct TechniqueId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct ProgramId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct BufferId(pub u16);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ScalarType {
    F32 = 1,
    U32 = 2,
    U16 = 3,
}

impl ScalarType {
    const fn byte_width(self) -> usize {
        match self {
            Self::F32 | Self::U32 => 4,
            Self::U16 => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BufferSchema {
    pub id: BufferId,
    pub scalar: ScalarType,
    pub vector_width: u8,
}

impl BufferSchema {
    pub fn stride(self) -> usize {
        self.scalar.byte_width() * usize::from(self.vector_width)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProgramCapabilities {
    pub paint: u32,
    pub compositing: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    LoadF32 {
        target: u8,
        field: u8,
    },
    LoadU32 {
        target: u8,
        field: u8,
    },
    ConstantF32 {
        target: u8,
        bits: u32,
    },
    ConstantU32 {
        target: u8,
        value: u32,
    },
    AddF32 {
        target: u8,
        left: u8,
        right: u8,
    },
    SubtractF32 {
        target: u8,
        left: u8,
        right: u8,
    },
    MultiplyF32 {
        target: u8,
        left: u8,
        right: u8,
    },
    LessThanF32 {
        target: u8,
        left: u8,
        right: u8,
    },
    SelectF32 {
        target: u8,
        condition: u8,
        when_true: u8,
        when_false: u8,
    },
    ConvertU32ToF32 {
        target: u8,
        source: u8,
    },
    StoreF32 {
        source: u8,
        buffer: BufferId,
        lane: u8,
    },
    StoreU32 {
        source: u8,
        buffer: BufferId,
        lane: u8,
    },
    StoreU16 {
        source: u8,
        buffer: BufferId,
        lane: u8,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProgramDescriptor {
    pub technique: TechniqueId,
    pub variant: u16,
    pub id: ProgramId,
    pub f32_input_count: u8,
    pub u32_input_count: u8,
    pub capabilities: ProgramCapabilities,
    pub buffers: Vec<BufferSchema>,
    pub operations: Vec<Operation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PolicyDescriptor {
    pub programs: Vec<ProgramDescriptor>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidatedPolicy {
    programs: Vec<ProgramDescriptor>,
    execution: Vec<ExecutableProgram>,
}

impl ValidatedPolicy {
    pub fn new(descriptor: PolicyDescriptor) -> Result<Self, PolicyError> {
        validate_policy(&descriptor)?;
        let mut execution = Vec::new();
        execution
            .try_reserve_exact(descriptor.programs.len())
            .map_err(|_| PolicyError::AllocationFailed)?;
        for program in &descriptor.programs {
            execution.push(ExecutableProgram::new(program)?);
        }
        Ok(Self {
            programs: descriptor.programs,
            execution,
        })
    }

    pub fn programs(&self) -> &[ProgramDescriptor] {
        &self.programs
    }

    pub fn program(&self, technique: TechniqueId, variant: u16) -> Option<&ProgramDescriptor> {
        self.programs
            .iter()
            .find(|program| program.technique == technique && program.variant == variant)
    }

    pub fn execute(
        &self,
        technique: TechniqueId,
        variant: u16,
        inputs: SemanticInputBatch<'_>,
        output_start: usize,
        outputs: &mut [PhysicalBufferMut<'_>],
    ) -> Result<(), PolicyExecutionError> {
        let program_index = self
            .programs
            .iter()
            .position(|program| program.technique == technique && program.variant == variant)
            .ok_or(PolicyExecutionError::ProgramMissing)?;
        let program = self
            .programs
            .get(program_index)
            .ok_or(PolicyExecutionError::ProgramMissing)?;
        let execution = self
            .execution
            .get(program_index)
            .ok_or(PolicyExecutionError::ProgramMissing)?;
        execute_program(program, execution, inputs, output_start, outputs)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExecutableProgram {
    store_buffer_indices: Vec<u8>,
}

impl ExecutableProgram {
    fn new(program: &ProgramDescriptor) -> Result<Self, PolicyError> {
        let mut store_buffer_indices = Vec::new();
        store_buffer_indices
            .try_reserve_exact(program.operations.len())
            .map_err(|_| PolicyError::AllocationFailed)?;
        for operation in &program.operations {
            let index = match store_buffer(operation) {
                Some(buffer) => program
                    .buffers
                    .iter()
                    .position(|schema| schema.id == buffer)
                    .ok_or(PolicyError::UnknownBuffer)?
                    .try_into()
                    .map_err(|_| PolicyError::TooManyBuffers)?,
                None => NOT_A_STORE,
            };
            store_buffer_indices.push(index);
        }
        Ok(Self {
            store_buffer_indices,
        })
    }
}

#[derive(Clone, Copy)]
pub struct SemanticInputBatch<'a> {
    pub f32_fields: &'a [&'a [f32]],
    pub u32_fields: &'a [&'a [u32]],
    pub record_count: usize,
}

pub struct PhysicalBufferMut<'a> {
    pub schema: BufferSchema,
    pub bytes: &'a mut [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyExecutionError {
    ProgramMissing,
    InputFieldCount,
    InputLength,
    OutputBufferCount,
    OutputSchema,
    OutputCapacity,
    NonFiniteOutput,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
    AllocationFailed,
    EmptyPolicy,
    TooManyPrograms,
    InvalidTechniqueId,
    InvalidProgramId,
    DuplicateTechniqueVariant,
    DuplicateProgramId,
    EmptyBuffers,
    TooManyBuffers,
    InvalidBufferId,
    DuplicateBufferId,
    InvalidVectorWidth,
    EmptyOperations,
    TooManyOperations,
    InvalidRegister,
    UninitializedRegister,
    RegisterTypeMismatch,
    InvalidInputField,
    NonFiniteConstant,
    UnknownBuffer,
    StoreTypeMismatch,
    InvalidStoreLane,
    DuplicateStore,
    IncompleteBuffer,
}

fn execute_program(
    program: &ProgramDescriptor,
    execution: &ExecutableProgram,
    inputs: SemanticInputBatch<'_>,
    output_start: usize,
    outputs: &mut [PhysicalBufferMut<'_>],
) -> Result<(), PolicyExecutionError> {
    validate_execution(program, inputs, output_start, outputs)?;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    let completed =
        unsafe { execute_simd_records(program, execution, inputs, output_start, outputs)? };
    #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
    let completed = 0;
    for record in completed..inputs.record_count {
        execute_record(
            program,
            execution,
            inputs,
            output_start + record,
            record,
            outputs,
        )?;
    }
    Ok(())
}

fn validate_execution(
    program: &ProgramDescriptor,
    inputs: SemanticInputBatch<'_>,
    output_start: usize,
    outputs: &[PhysicalBufferMut<'_>],
) -> Result<(), PolicyExecutionError> {
    if inputs.f32_fields.len() != usize::from(program.f32_input_count)
        || inputs.u32_fields.len() != usize::from(program.u32_input_count)
    {
        return Err(PolicyExecutionError::InputFieldCount);
    }
    if inputs
        .f32_fields
        .iter()
        .any(|field| field.len() != inputs.record_count)
        || inputs
            .u32_fields
            .iter()
            .any(|field| field.len() != inputs.record_count)
    {
        return Err(PolicyExecutionError::InputLength);
    }
    if outputs.len() != program.buffers.len() {
        return Err(PolicyExecutionError::OutputBufferCount);
    }
    let output_end = output_start
        .checked_add(inputs.record_count)
        .ok_or(PolicyExecutionError::OutputCapacity)?;
    for (output, schema) in outputs.iter().zip(&program.buffers) {
        if output.schema != *schema {
            return Err(PolicyExecutionError::OutputSchema);
        }
        let required = output_end
            .checked_mul(schema.stride())
            .ok_or(PolicyExecutionError::OutputCapacity)?;
        if output.bytes.len() < required {
            return Err(PolicyExecutionError::OutputCapacity);
        }
    }
    Ok(())
}

fn execute_record(
    program: &ProgramDescriptor,
    execution: &ExecutableProgram,
    inputs: SemanticInputBatch<'_>,
    output_record: usize,
    input_record: usize,
    outputs: &mut [PhysicalBufferMut<'_>],
) -> Result<(), PolicyExecutionError> {
    let mut registers = [0_u32; MAX_REGISTERS];
    let mut values = [0_u32; MAX_OUTPUT_LANES];
    for (operation_index, operation) in program.operations.iter().enumerate() {
        match *operation {
            Operation::LoadF32 { target, field } => {
                registers[usize::from(target)] =
                    inputs.f32_fields[usize::from(field)][input_record].to_bits();
            }
            Operation::LoadU32 { target, field } => {
                registers[usize::from(target)] =
                    inputs.u32_fields[usize::from(field)][input_record];
            }
            Operation::ConstantF32 { target, bits } => registers[usize::from(target)] = bits,
            Operation::ConstantU32 { target, value } => registers[usize::from(target)] = value,
            Operation::AddF32 {
                target,
                left,
                right,
            } => {
                registers[usize::from(target)] =
                    (register_f32(&registers, left) + register_f32(&registers, right)).to_bits();
            }
            Operation::SubtractF32 {
                target,
                left,
                right,
            } => {
                registers[usize::from(target)] =
                    (register_f32(&registers, left) - register_f32(&registers, right)).to_bits();
            }
            Operation::MultiplyF32 {
                target,
                left,
                right,
            } => {
                registers[usize::from(target)] =
                    (register_f32(&registers, left) * register_f32(&registers, right)).to_bits();
            }
            Operation::LessThanF32 {
                target,
                left,
                right,
            } => {
                registers[usize::from(target)] =
                    u32::from(register_f32(&registers, left) < register_f32(&registers, right));
            }
            Operation::SelectF32 {
                target,
                condition,
                when_true,
                when_false,
            } => {
                registers[usize::from(target)] = if registers[usize::from(condition)] != 0 {
                    registers[usize::from(when_true)]
                } else {
                    registers[usize::from(when_false)]
                };
            }
            Operation::ConvertU32ToF32 { target, source } => {
                registers[usize::from(target)] = (registers[usize::from(source)] as f32).to_bits();
            }
            Operation::StoreF32 { source, lane, .. } => {
                let bits = registers[usize::from(source)];
                if !f32::from_bits(bits).is_finite() {
                    return Err(PolicyExecutionError::NonFiniteOutput);
                }
                values[store_slot(execution, operation_index, lane)] = bits;
            }
            Operation::StoreU32 { source, lane, .. } | Operation::StoreU16 { source, lane, .. } => {
                values[store_slot(execution, operation_index, lane)] =
                    registers[usize::from(source)];
            }
        }
    }
    for (buffer_index, (schema, output)) in program.buffers.iter().zip(outputs).enumerate() {
        let record_offset = output_record * schema.stride();
        for lane in 0..schema.vector_width {
            let value = values[buffer_index * MAX_VECTOR_WIDTH as usize + usize::from(lane)];
            let lane_offset = record_offset + usize::from(lane) * schema.scalar.byte_width();
            match schema.scalar {
                ScalarType::F32 | ScalarType::U32 => {
                    output.bytes[lane_offset..lane_offset + 4]
                        .copy_from_slice(&value.to_le_bytes());
                }
                ScalarType::U16 => {
                    output.bytes[lane_offset..lane_offset + 2]
                        .copy_from_slice(&(value as u16).to_le_bytes());
                }
            }
        }
    }
    Ok(())
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn execute_simd_records(
    program: &ProgramDescriptor,
    execution: &ExecutableProgram,
    inputs: SemanticInputBatch<'_>,
    output_start: usize,
    outputs: &mut [PhysicalBufferMut<'_>],
) -> Result<usize, PolicyExecutionError> {
    use core::arch::wasm32::{
        f32x4_add, f32x4_convert_u32x4, f32x4_lt, f32x4_mul, f32x4_sub, i32x4_ne, u32x4_splat,
        v128, v128_and, v128_bitselect, v128_load,
    };

    let completed = inputs.record_count & !3;
    for input_record in (0..completed).step_by(4) {
        let mut registers = [u32x4_splat(0); MAX_REGISTERS];
        let mut values = [u32x4_splat(0); MAX_OUTPUT_LANES];
        for (operation_index, operation) in program.operations.iter().enumerate() {
            match *operation {
                Operation::LoadF32 { target, field } => {
                    // SAFETY: validation proves this field contains four records from `input_record`.
                    registers[usize::from(target)] = unsafe {
                        v128_load(
                            inputs.f32_fields[usize::from(field)]
                                .as_ptr()
                                .add(input_record)
                                .cast::<v128>(),
                        )
                    };
                }
                Operation::LoadU32 { target, field } => {
                    // SAFETY: validation proves this field contains four records from `input_record`.
                    registers[usize::from(target)] = unsafe {
                        v128_load(
                            inputs.u32_fields[usize::from(field)]
                                .as_ptr()
                                .add(input_record)
                                .cast::<v128>(),
                        )
                    };
                }
                Operation::ConstantF32 { target, bits } => {
                    registers[usize::from(target)] = u32x4_splat(bits);
                }
                Operation::ConstantU32 { target, value } => {
                    registers[usize::from(target)] = u32x4_splat(value);
                }
                Operation::AddF32 {
                    target,
                    left,
                    right,
                } => {
                    registers[usize::from(target)] =
                        f32x4_add(registers[usize::from(left)], registers[usize::from(right)]);
                }
                Operation::SubtractF32 {
                    target,
                    left,
                    right,
                } => {
                    registers[usize::from(target)] =
                        f32x4_sub(registers[usize::from(left)], registers[usize::from(right)]);
                }
                Operation::MultiplyF32 {
                    target,
                    left,
                    right,
                } => {
                    registers[usize::from(target)] =
                        f32x4_mul(registers[usize::from(left)], registers[usize::from(right)]);
                }
                Operation::LessThanF32 {
                    target,
                    left,
                    right,
                } => {
                    registers[usize::from(target)] = v128_and(
                        f32x4_lt(registers[usize::from(left)], registers[usize::from(right)]),
                        u32x4_splat(1),
                    );
                }
                Operation::SelectF32 {
                    target,
                    condition,
                    when_true,
                    when_false,
                } => {
                    let mask = i32x4_ne(registers[usize::from(condition)], u32x4_splat(0));
                    registers[usize::from(target)] = v128_bitselect(
                        registers[usize::from(when_true)],
                        registers[usize::from(when_false)],
                        mask,
                    );
                }
                Operation::ConvertU32ToF32 { target, source } => {
                    registers[usize::from(target)] =
                        f32x4_convert_u32x4(registers[usize::from(source)]);
                }
                Operation::StoreF32 { source, lane, .. } => {
                    let value = registers[usize::from(source)];
                    if !simd_f32_is_finite(value) {
                        return Err(PolicyExecutionError::NonFiniteOutput);
                    }
                    values[store_slot(execution, operation_index, lane)] = value;
                }
                Operation::StoreU32 { source, lane, .. }
                | Operation::StoreU16 { source, lane, .. } => {
                    values[store_slot(execution, operation_index, lane)] =
                        registers[usize::from(source)];
                }
            }
        }
        write_simd_outputs(program, &values, output_start + input_record, outputs);
    }
    Ok(completed)
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn write_simd_outputs(
    program: &ProgramDescriptor,
    values: &[core::arch::wasm32::v128; MAX_OUTPUT_LANES],
    output_start: usize,
    outputs: &mut [PhysicalBufferMut<'_>],
) {
    for (buffer_index, (schema, output)) in program.buffers.iter().zip(outputs).enumerate() {
        for lane in 0..schema.vector_width {
            let lanes = simd_u32_lanes(
                values[buffer_index * MAX_VECTOR_WIDTH as usize + usize::from(lane)],
            );
            for (record, value) in lanes.into_iter().enumerate() {
                let lane_offset = (output_start + record) * schema.stride()
                    + usize::from(lane) * schema.scalar.byte_width();
                match schema.scalar {
                    ScalarType::F32 | ScalarType::U32 => {
                        output.bytes[lane_offset..lane_offset + 4]
                            .copy_from_slice(&value.to_le_bytes());
                    }
                    ScalarType::U16 => {
                        output.bytes[lane_offset..lane_offset + 2]
                            .copy_from_slice(&(value as u16).to_le_bytes());
                    }
                }
            }
        }
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn simd_f32_is_finite(value: core::arch::wasm32::v128) -> bool {
    simd_u32_lanes(value)
        .into_iter()
        .all(|bits| f32::from_bits(bits).is_finite())
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn simd_u32_lanes(value: core::arch::wasm32::v128) -> [u32; 4] {
    // SAFETY: `v128` and four `u32` lanes are both exactly 128 bits; this preserves their bits.
    unsafe { core::mem::transmute(value) }
}

fn register_f32(registers: &[u32; MAX_REGISTERS], register: u8) -> f32 {
    f32::from_bits(registers[usize::from(register)])
}

fn store_slot(execution: &ExecutableProgram, operation_index: usize, lane: u8) -> usize {
    usize::from(execution.store_buffer_indices[operation_index]) * MAX_VECTOR_WIDTH as usize
        + usize::from(lane)
}

fn store_buffer(operation: &Operation) -> Option<BufferId> {
    match operation {
        Operation::StoreF32 { buffer, .. }
        | Operation::StoreU32 { buffer, .. }
        | Operation::StoreU16 { buffer, .. } => Some(*buffer),
        _ => None,
    }
}

fn validate_policy(descriptor: &PolicyDescriptor) -> Result<(), PolicyError> {
    if descriptor.programs.is_empty() {
        return Err(PolicyError::EmptyPolicy);
    }
    if descriptor.programs.len() > MAX_PROGRAMS {
        return Err(PolicyError::TooManyPrograms);
    }
    for (index, program) in descriptor.programs.iter().enumerate() {
        if program.technique.0 == 0 {
            return Err(PolicyError::InvalidTechniqueId);
        }
        if program.id.0 == 0 {
            return Err(PolicyError::InvalidProgramId);
        }
        for previous in &descriptor.programs[..index] {
            if previous.technique == program.technique && previous.variant == program.variant {
                return Err(PolicyError::DuplicateTechniqueVariant);
            }
            if previous.id == program.id {
                return Err(PolicyError::DuplicateProgramId);
            }
        }
        validate_program(program)?;
    }
    Ok(())
}

fn validate_program(program: &ProgramDescriptor) -> Result<(), PolicyError> {
    if program.buffers.is_empty() {
        return Err(PolicyError::EmptyBuffers);
    }
    if program.buffers.len() > MAX_BUFFERS_PER_PROGRAM {
        return Err(PolicyError::TooManyBuffers);
    }
    for (index, buffer) in program.buffers.iter().enumerate() {
        if buffer.id.0 == 0 {
            return Err(PolicyError::InvalidBufferId);
        }
        if buffer.vector_width == 0 || buffer.vector_width > MAX_VECTOR_WIDTH {
            return Err(PolicyError::InvalidVectorWidth);
        }
        if program.buffers[..index]
            .iter()
            .any(|previous| previous.id == buffer.id)
        {
            return Err(PolicyError::DuplicateBufferId);
        }
    }
    if program.operations.is_empty() {
        return Err(PolicyError::EmptyOperations);
    }
    if program.operations.len() > MAX_OPERATIONS_PER_PROGRAM {
        return Err(PolicyError::TooManyOperations);
    }

    let mut registers = [UNINITIALIZED; MAX_REGISTERS];
    let mut stored_lanes = [0_u8; MAX_BUFFERS_PER_PROGRAM];
    for operation in &program.operations {
        validate_operation(program, operation, &mut registers, &mut stored_lanes)?;
    }
    for (index, buffer) in program.buffers.iter().enumerate() {
        let required = (1_u8 << buffer.vector_width) - 1;
        if stored_lanes[index] != required {
            return Err(PolicyError::IncompleteBuffer);
        }
    }
    Ok(())
}

fn validate_operation(
    program: &ProgramDescriptor,
    operation: &Operation,
    registers: &mut [u8; MAX_REGISTERS],
    stored_lanes: &mut [u8; MAX_BUFFERS_PER_PROGRAM],
) -> Result<(), PolicyError> {
    match *operation {
        Operation::LoadF32 { target, field } => {
            if field >= program.f32_input_count {
                return Err(PolicyError::InvalidInputField);
            }
            initialize(registers, target, F32_REGISTER)
        }
        Operation::LoadU32 { target, field } => {
            if field >= program.u32_input_count {
                return Err(PolicyError::InvalidInputField);
            }
            initialize(registers, target, U32_REGISTER)
        }
        Operation::ConstantF32 { target, bits } => {
            if !f32::from_bits(bits).is_finite() {
                return Err(PolicyError::NonFiniteConstant);
            }
            initialize(registers, target, F32_REGISTER)
        }
        Operation::ConstantU32 { target, .. } => initialize(registers, target, U32_REGISTER),
        Operation::AddF32 {
            target,
            left,
            right,
        }
        | Operation::SubtractF32 {
            target,
            left,
            right,
        }
        | Operation::MultiplyF32 {
            target,
            left,
            right,
        } => {
            require(registers, left, F32_REGISTER)?;
            require(registers, right, F32_REGISTER)?;
            initialize(registers, target, F32_REGISTER)
        }
        Operation::LessThanF32 {
            target,
            left,
            right,
        } => {
            require(registers, left, F32_REGISTER)?;
            require(registers, right, F32_REGISTER)?;
            initialize(registers, target, U32_REGISTER)
        }
        Operation::SelectF32 {
            target,
            condition,
            when_true,
            when_false,
        } => {
            require(registers, condition, U32_REGISTER)?;
            require(registers, when_true, F32_REGISTER)?;
            require(registers, when_false, F32_REGISTER)?;
            initialize(registers, target, F32_REGISTER)
        }
        Operation::ConvertU32ToF32 { target, source } => {
            require(registers, source, U32_REGISTER)?;
            initialize(registers, target, F32_REGISTER)
        }
        Operation::StoreF32 {
            source,
            buffer,
            lane,
        } => {
            require(registers, source, F32_REGISTER)?;
            validate_store(program, buffer, lane, ScalarType::F32, stored_lanes)
        }
        Operation::StoreU32 {
            source,
            buffer,
            lane,
        } => {
            require(registers, source, U32_REGISTER)?;
            validate_store(program, buffer, lane, ScalarType::U32, stored_lanes)
        }
        Operation::StoreU16 {
            source,
            buffer,
            lane,
        } => {
            require(registers, source, U32_REGISTER)?;
            validate_store(program, buffer, lane, ScalarType::U16, stored_lanes)
        }
    }
}

fn initialize(
    registers: &mut [u8; MAX_REGISTERS],
    target: u8,
    register_type: u8,
) -> Result<(), PolicyError> {
    let slot = registers
        .get_mut(usize::from(target))
        .ok_or(PolicyError::InvalidRegister)?;
    *slot = register_type;
    Ok(())
}

fn require(
    registers: &[u8; MAX_REGISTERS],
    register: u8,
    register_type: u8,
) -> Result<(), PolicyError> {
    let actual = *registers
        .get(usize::from(register))
        .ok_or(PolicyError::InvalidRegister)?;
    if actual == UNINITIALIZED {
        return Err(PolicyError::UninitializedRegister);
    }
    if actual != register_type {
        return Err(PolicyError::RegisterTypeMismatch);
    }
    Ok(())
}

fn validate_store(
    program: &ProgramDescriptor,
    buffer: BufferId,
    lane: u8,
    scalar: ScalarType,
    stored_lanes: &mut [u8; MAX_BUFFERS_PER_PROGRAM],
) -> Result<(), PolicyError> {
    let index = program
        .buffers
        .iter()
        .position(|candidate| candidate.id == buffer)
        .ok_or(PolicyError::UnknownBuffer)?;
    let schema = program.buffers[index];
    if schema.scalar != scalar {
        return Err(PolicyError::StoreTypeMismatch);
    }
    if lane >= schema.vector_width {
        return Err(PolicyError::InvalidStoreLane);
    }
    let mask = 1_u8 << lane;
    if stored_lanes[index] & mask != 0 {
        return Err(PolicyError::DuplicateStore);
    }
    stored_lanes[index] |= mask;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const BITMAP: TechniqueId = TechniqueId(1);
    const PROGRAM: ProgramId = ProgramId(1);
    const ORIGINS: BufferId = BufferId(1);

    fn valid_program() -> ProgramDescriptor {
        ProgramDescriptor {
            technique: BITMAP,
            variant: 0,
            id: PROGRAM,
            f32_input_count: 2,
            u32_input_count: 0,
            capabilities: ProgramCapabilities::default(),
            buffers: vec![BufferSchema {
                id: ORIGINS,
                scalar: ScalarType::F32,
                vector_width: 2,
            }],
            operations: vec![
                Operation::LoadF32 {
                    target: 0,
                    field: 0,
                },
                Operation::LoadF32 {
                    target: 1,
                    field: 1,
                },
                Operation::StoreF32 {
                    source: 0,
                    buffer: ORIGINS,
                    lane: 0,
                },
                Operation::StoreF32 {
                    source: 1,
                    buffer: ORIGINS,
                    lane: 1,
                },
            ],
        }
    }

    #[test]
    fn accepts_complete_straight_line_program() {
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![valid_program()],
        })
        .unwrap();
        assert_eq!(
            policy.program(BITMAP, 0).map(|value| value.id),
            Some(PROGRAM)
        );
        assert_eq!(policy.program(BITMAP, 1), None);
    }

    #[test]
    fn rejects_uninitialized_and_wrong_type_registers() {
        let mut uninitialized = valid_program();
        uninitialized.operations[2] = Operation::StoreF32 {
            source: 4,
            buffer: ORIGINS,
            lane: 0,
        };
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![uninitialized],
            }),
            Err(PolicyError::UninitializedRegister)
        );

        let mut wrong_type = valid_program();
        wrong_type.operations[0] = Operation::ConstantU32 {
            target: 0,
            value: 1,
        };
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![wrong_type],
            }),
            Err(PolicyError::RegisterTypeMismatch)
        );
    }

    #[test]
    fn rejects_partial_duplicate_and_out_of_range_stores() {
        let mut partial = valid_program();
        partial.operations.pop();
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![partial],
            }),
            Err(PolicyError::IncompleteBuffer)
        );

        let mut duplicate = valid_program();
        duplicate.operations[3] = Operation::StoreF32 {
            source: 1,
            buffer: ORIGINS,
            lane: 0,
        };
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![duplicate],
            }),
            Err(PolicyError::DuplicateStore)
        );

        let mut out_of_range = valid_program();
        out_of_range.operations[3] = Operation::StoreF32 {
            source: 1,
            buffer: ORIGINS,
            lane: 2,
        };
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![out_of_range],
            }),
            Err(PolicyError::InvalidStoreLane)
        );
    }

    #[test]
    fn rejects_duplicate_technique_variants_and_program_ids() {
        let first = valid_program();
        let mut same_variant = valid_program();
        same_variant.id = ProgramId(2);
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![first.clone(), same_variant],
            }),
            Err(PolicyError::DuplicateTechniqueVariant)
        );

        let mut duplicate_id = valid_program();
        duplicate_id.technique = TechniqueId(2);
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![first, duplicate_id],
            }),
            Err(PolicyError::DuplicateProgramId)
        );
    }

    #[test]
    fn accepts_same_technique_with_distinct_variants() {
        let first = valid_program();
        let mut second = valid_program();
        second.variant = 1;
        second.id = ProgramId(2);
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![first, second],
        })
        .unwrap();
        assert_eq!(policy.programs().len(), 2);
    }

    #[test]
    fn scalar_executor_writes_a_bounded_record_range_without_touching_spares() {
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![valid_program()],
        })
        .unwrap();
        let x = [1.25, -2.5, 8.0];
        let y = [4.0, 6.5, -9.0];
        let fields: [&[f32]; 2] = [&x, &y];
        let schema = policy.program(BITMAP, 0).unwrap().buffers[0];
        let mut bytes = [0x7f_u8; 5 * 8];
        {
            let mut outputs = [PhysicalBufferMut {
                schema,
                bytes: &mut bytes,
            }];
            policy
                .execute(
                    BITMAP,
                    0,
                    SemanticInputBatch {
                        f32_fields: &fields,
                        u32_fields: &[],
                        record_count: x.len(),
                    },
                    1,
                    &mut outputs,
                )
                .unwrap();
        }
        assert_eq!(&bytes[..8], &[0x7f; 8]);
        assert_eq!(&bytes[32..], &[0x7f; 8]);
        for (record, expected) in x.into_iter().zip(y).enumerate() {
            let offset = (record + 1) * 8;
            assert_eq!(read_f32(&bytes, offset).to_bits(), expected.0.to_bits());
            assert_eq!(read_f32(&bytes, offset + 4).to_bits(), expected.1.to_bits());
        }
    }

    #[test]
    fn scalar_executor_preserves_typed_arithmetic_selection_and_narrowing() {
        let color = BufferId(1);
        let object = BufferId(2);
        let page = BufferId(3);
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![ProgramDescriptor {
                technique: BITMAP,
                variant: 0,
                id: PROGRAM,
                f32_input_count: 1,
                u32_input_count: 1,
                capabilities: ProgramCapabilities::default(),
                buffers: vec![
                    BufferSchema {
                        id: color,
                        scalar: ScalarType::F32,
                        vector_width: 2,
                    },
                    BufferSchema {
                        id: object,
                        scalar: ScalarType::U32,
                        vector_width: 1,
                    },
                    BufferSchema {
                        id: page,
                        scalar: ScalarType::U16,
                        vector_width: 1,
                    },
                ],
                operations: vec![
                    Operation::LoadF32 {
                        target: 0,
                        field: 0,
                    },
                    Operation::ConstantF32 {
                        target: 1,
                        bits: 0.0_f32.to_bits(),
                    },
                    Operation::LessThanF32 {
                        target: 2,
                        left: 0,
                        right: 1,
                    },
                    Operation::ConstantF32 {
                        target: 3,
                        bits: (-1.0_f32).to_bits(),
                    },
                    Operation::SelectF32 {
                        target: 4,
                        condition: 2,
                        when_true: 3,
                        when_false: 0,
                    },
                    Operation::LoadU32 {
                        target: 5,
                        field: 0,
                    },
                    Operation::ConvertU32ToF32 {
                        target: 6,
                        source: 5,
                    },
                    Operation::AddF32 {
                        target: 7,
                        left: 4,
                        right: 6,
                    },
                    Operation::ConstantF32 {
                        target: 8,
                        bits: 2.0_f32.to_bits(),
                    },
                    Operation::MultiplyF32 {
                        target: 9,
                        left: 0,
                        right: 8,
                    },
                    Operation::StoreF32 {
                        source: 7,
                        buffer: color,
                        lane: 0,
                    },
                    Operation::StoreF32 {
                        source: 9,
                        buffer: color,
                        lane: 1,
                    },
                    Operation::StoreU32 {
                        source: 5,
                        buffer: object,
                        lane: 0,
                    },
                    Operation::StoreU16 {
                        source: 5,
                        buffer: page,
                        lane: 0,
                    },
                ],
            }],
        })
        .unwrap();
        let signed = [-2.0, 3.0];
        let identifiers = [70_000, 42];
        let f32_fields: [&[f32]; 1] = [&signed];
        let u32_fields: [&[u32]; 1] = [&identifiers];
        let mut colors = [0_u8; 16];
        let mut objects = [0_u8; 8];
        let mut pages = [0_u8; 4];
        let program = policy.program(BITMAP, 0).unwrap();
        let mut outputs = [
            PhysicalBufferMut {
                schema: program.buffers[0],
                bytes: &mut colors,
            },
            PhysicalBufferMut {
                schema: program.buffers[1],
                bytes: &mut objects,
            },
            PhysicalBufferMut {
                schema: program.buffers[2],
                bytes: &mut pages,
            },
        ];
        policy
            .execute(
                BITMAP,
                0,
                SemanticInputBatch {
                    f32_fields: &f32_fields,
                    u32_fields: &u32_fields,
                    record_count: 2,
                },
                0,
                &mut outputs,
            )
            .unwrap();
        assert_eq!(read_f32(&colors, 0), 69_999.0);
        assert_eq!(read_f32(&colors, 4), -4.0);
        assert_eq!(read_f32(&colors, 8), 45.0);
        assert_eq!(read_f32(&colors, 12), 6.0);
        assert_eq!(read_u32(&objects, 0), 70_000);
        assert_eq!(read_u32(&objects, 4), 42);
        assert_eq!(read_u16(&pages, 0), 70_000_u32 as u16);
        assert_eq!(read_u16(&pages, 2), 42);
    }

    #[test]
    fn scalar_executor_rejects_invalid_shapes_before_writing() {
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![valid_program()],
        })
        .unwrap();
        let x = [1.0, 2.0];
        let short_y = [3.0];
        let fields: [&[f32]; 2] = [&x, &short_y];
        let mut bytes = [0xa5_u8; 16];
        let mut outputs = [PhysicalBufferMut {
            schema: policy.program(BITMAP, 0).unwrap().buffers[0],
            bytes: &mut bytes,
        }];
        assert_eq!(
            policy.execute(
                BITMAP,
                0,
                SemanticInputBatch {
                    f32_fields: &fields,
                    u32_fields: &[],
                    record_count: 2,
                },
                0,
                &mut outputs,
            ),
            Err(PolicyExecutionError::InputLength)
        );
        assert_eq!(bytes, [0xa5; 16]);
    }

    #[test]
    fn policy_and_executor_reject_nonfinite_physical_values() {
        let mut constant = valid_program();
        constant.operations[0] = Operation::ConstantF32 {
            target: 0,
            bits: f32::INFINITY.to_bits(),
        };
        assert_eq!(
            ValidatedPolicy::new(PolicyDescriptor {
                programs: vec![constant],
            }),
            Err(PolicyError::NonFiniteConstant)
        );

        let mut overflow = valid_program();
        overflow.operations.insert(
            2,
            Operation::MultiplyF32 {
                target: 0,
                left: 0,
                right: 1,
            },
        );
        let policy = ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![overflow],
        })
        .unwrap();
        let values = [f32::MAX];
        let fields: [&[f32]; 2] = [&values, &values];
        let mut bytes = [0x5a_u8; 8];
        let mut outputs = [PhysicalBufferMut {
            schema: policy.program(BITMAP, 0).unwrap().buffers[0],
            bytes: &mut bytes,
        }];
        assert_eq!(
            policy.execute(
                BITMAP,
                0,
                SemanticInputBatch {
                    f32_fields: &fields,
                    u32_fields: &[],
                    record_count: 1,
                },
                0,
                &mut outputs,
            ),
            Err(PolicyExecutionError::NonFiniteOutput)
        );
        assert_eq!(bytes, [0x5a; 8]);
    }

    fn read_f32(bytes: &[u8], offset: usize) -> f32 {
        f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn read_u16(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap())
    }
}
