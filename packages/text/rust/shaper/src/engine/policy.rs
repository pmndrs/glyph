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
}

impl ValidatedPolicy {
    pub fn new(descriptor: PolicyDescriptor) -> Result<Self, PolicyError> {
        validate_policy(&descriptor)?;
        Ok(Self {
            programs: descriptor.programs,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
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
    UnknownBuffer,
    StoreTypeMismatch,
    InvalidStoreLane,
    DuplicateStore,
    IncompleteBuffer,
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
        Operation::ConstantF32 { target, .. } => initialize(registers, target, F32_REGISTER),
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
}
