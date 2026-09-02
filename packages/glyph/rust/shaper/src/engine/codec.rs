//! Validated renderer codec data and its scalar correctness executor.
//!
//! Policies are intentionally straight-line. The engine owns record iteration, so a codec cannot
//! allocate, loop, branch backward, address arbitrary memory, or mutate semantic layout.

use alloc::vec::Vec;

pub const MAX_PROGRAMS: usize = 32;
pub const MAX_CAPABILITY_SETS: usize = 8;
pub const MAX_BUFFERS_PER_PROGRAM: usize = 16;
pub const MAX_OPERATIONS_PER_PROGRAM: usize = 128;
pub const MAX_REGISTERS: usize = 32;
pub const MAX_INPUT_FIELDS_PER_PROGRAM: usize = MAX_REGISTERS * 2;
pub const MAX_VECTOR_WIDTH: u8 = 4;
const MAX_OUTPUT_LANES: usize = MAX_BUFFERS_PER_PROGRAM * MAX_VECTOR_WIDTH as usize;
const NOT_A_STORE: u8 = u8::MAX;

pub const CAP_STORAGE_BUFFERS: u32 = 1 << 0;
pub const CAP_INDIRECT_DRAWS: u32 = 1 << 1;
pub const CAP_ALIAS_VEC2: u32 = 1 << 2;
pub const CAP_ALIAS_VEC4: u32 = 1 << 3;
pub const CAP_ORDERED_DIRECT: u32 = 1 << 4;
pub const CAP_STABLE_INDIRECT: u32 = 1 << 5;
const CAPABILITY_FLAGS: u32 = CAP_STORAGE_BUFFERS
    | CAP_INDIRECT_DRAWS
    | CAP_ALIAS_VEC2
    | CAP_ALIAS_VEC4
    | CAP_ORDERED_DIRECT
    | CAP_STABLE_INDIRECT;

pub const BATCH_TECHNIQUE: u32 = 1 << 0;
pub const BATCH_RESOURCE: u32 = 1 << 1;
pub const BATCH_PROGRAM: u32 = 1 << 2;
pub const BATCH_MATERIAL: u32 = 1 << 3;
pub const BATCH_CLIP: u32 = 1 << 4;
pub const BATCH_DEPTH: u32 = 1 << 5;
pub const BATCH_ORDER: u32 = 1 << 6;
pub const BATCH_TRANSFORM: u32 = 1 << 7;
const BATCH_FIELDS: u32 = BATCH_TECHNIQUE
    | BATCH_RESOURCE
    | BATCH_PROGRAM
    | BATCH_MATERIAL
    | BATCH_CLIP
    | BATCH_DEPTH
    | BATCH_ORDER
    | BATCH_TRANSFORM;
const STORAGE_KEY_FIELDS: u32 = BATCH_FIELDS & !(BATCH_ORDER | BATCH_TRANSFORM);
const REQUIRED_STORAGE_KEYS: u32 = BATCH_TECHNIQUE | BATCH_RESOURCE | BATCH_PROGRAM;
const REQUIRED_DRAW_KEYS: u32 = REQUIRED_STORAGE_KEYS | BATCH_ORDER;

pub const BUFFER_USAGE_VERTEX: u32 = 1 << 0;
pub const BUFFER_USAGE_STORAGE: u32 = 1 << 1;
pub const BUFFER_USAGE_COPY_DST: u32 = 1 << 2;
const BUFFER_USAGE_FLAGS: u32 = BUFFER_USAGE_VERTEX | BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST;

pub const ALLOCATION_ORDERED_DIRECT: u16 = 1;
pub const ALLOCATION_STABLE_INDIRECT: u16 = 2;

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

pub const INPUT_SEMANTIC: u8 = 1;
pub const INPUT_GLYPH: u8 = 2;
pub const INPUT_RESOURCE: u8 = 3;
pub const INPUT_STRIKE: u8 = 4;

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
pub struct CapabilitySetId(pub u32);

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
    pub alignment: u16,
    pub stride: u16,
    pub usage: u32,
    pub capacity_class: u16,
}

impl BufferSchema {
    pub fn stride(self) -> usize {
        usize::from(self.stride)
    }

    pub const fn packed(
        id: BufferId,
        scalar: ScalarType,
        vector_width: u8,
        usage: u32,
        capacity_class: u16,
    ) -> Self {
        let byte_width = scalar.byte_width() as u16 * vector_width as u16;
        Self {
            id,
            scalar,
            vector_width,
            alignment: scalar.byte_width() as u16,
            stride: byte_width,
            usage,
            capacity_class,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilitySet {
    pub id: CapabilitySetId,
    pub flags: u32,
    pub max_buffer_bytes: u32,
    pub update_alignment: u32,
    pub coalesce_gap_bytes: u32,
    pub range_call_penalty_bytes: u32,
    pub max_buffers_per_draw: u16,
    pub max_resources_per_draw: u16,
    pub max_indirect_draws: u16,
    pub fragmentation_budget: u16,
    pub whole_buffer_threshold_basis_points: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProgramCapabilities {
    pub paint: u32,
    pub compositing: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum InputScope {
    Semantic = INPUT_SEMANTIC,
    Glyph = INPUT_GLYPH,
    Resource = INPUT_RESOURCE,
    Strike = INPUT_STRIKE,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputSource {
    pub scope: InputScope,
    pub field: u8,
}

impl InputSource {
    pub const fn semantic(field: u8) -> Self {
        Self {
            scope: InputScope::Semantic,
            field,
        }
    }
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
    /// `PRIMITIVE_GLYPH` or `PRIMITIVE_DECORATION`: the plan primitive kind this
    /// program's records publish as.
    pub primitive_kind: u16,
    pub technique: TechniqueId,
    pub variant: u16,
    pub id: ProgramId,
    /// Zero makes a program valid for every capability set in this codec.
    pub capability_set: CapabilitySetId,
    pub resource_kind_mask: u32,
    pub semantic_view_mask: u32,
    pub storage_key_mask: u32,
    pub draw_key_mask: u32,
    pub allocation_strategy: u16,
    pub f32_input_count: u8,
    pub u32_input_count: u8,
    /// Ordered F32 sources followed by ordered U32 sources.
    pub inputs: Vec<InputSource>,
    pub capabilities: ProgramCapabilities,
    pub buffers: Vec<BufferSchema>,
    pub operations: Vec<Operation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodecDescriptor {
    pub capability_sets: Vec<CapabilitySet>,
    pub programs: Vec<ProgramDescriptor>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidatedCodec {
    capability_sets: Vec<CapabilitySet>,
    programs: Vec<ProgramDescriptor>,
    execution: Vec<ExecutableProgram>,
    fingerprint: u64,
}

impl ValidatedCodec {
    /// The decoration program admitted for this capability set, if the codec declares one.
    pub fn decoration_program(
        &self,
        capability_set: CapabilitySetId,
    ) -> Option<&ProgramDescriptor> {
        self.programs.iter().find(|program| {
            program.primitive_kind == super::render_plan::PRIMITIVE_DECORATION
                && (program.capability_set.0 == 0 || program.capability_set == capability_set)
        })
    }

    pub fn new(descriptor: CodecDescriptor) -> Result<Self, CodecError> {
        validate_codec(&descriptor)?;
        let mut execution = Vec::new();
        execution
            .try_reserve_exact(descriptor.programs.len())
            .map_err(|_| CodecError::AllocationFailed)?;
        for program in &descriptor.programs {
            execution.push(ExecutableProgram::new(program)?);
        }
        Ok(Self {
            fingerprint: codec_fingerprint(&descriptor),
            capability_sets: descriptor.capability_sets,
            programs: descriptor.programs,
            execution,
        })
    }

    pub fn programs(&self) -> &[ProgramDescriptor] {
        &self.programs
    }

    pub fn capability_sets(&self) -> &[CapabilitySet] {
        &self.capability_sets
    }

    pub fn fingerprint(&self) -> u64 {
        self.fingerprint
    }

    pub fn capability_set(&self, id: CapabilitySetId) -> Option<&CapabilitySet> {
        self.capability_sets.iter().find(|set| set.id == id)
    }

    pub fn program(
        &self,
        capability_set: CapabilitySetId,
        technique: TechniqueId,
        variant: u16,
    ) -> Option<&ProgramDescriptor> {
        self.programs
            .iter()
            .find(|program| {
                program.capability_set == capability_set
                    && program.technique == technique
                    && program.variant == variant
            })
            .or_else(|| {
                self.programs.iter().find(|program| {
                    program.capability_set.0 == 0
                        && program.technique == technique
                        && program.variant == variant
                })
            })
    }

    pub(crate) fn uniform_allocation_strategy(
        &self,
        capability_set: CapabilitySetId,
    ) -> Option<u16> {
        let mut strategy = None;
        for program in self.programs.iter().filter(|program| {
            program.capability_set == capability_set || program.capability_set.0 == 0
        }) {
            match strategy {
                Some(existing) if existing != program.allocation_strategy => return None,
                Some(_) => {}
                None => strategy = Some(program.allocation_strategy),
            }
        }
        strategy
    }

    pub fn execute(
        &self,
        capability_set: CapabilitySetId,
        technique: TechniqueId,
        variant: u16,
        inputs: SemanticInputBatch<'_>,
        output_start: usize,
        outputs: &mut [PhysicalBufferMut<'_>],
    ) -> Result<(), CodecExecutionError> {
        if self.capability_set(capability_set).is_none() {
            return Err(CodecExecutionError::CapabilitySetMissing);
        }
        let program_index = self
            .programs
            .iter()
            .position(|program| {
                program.capability_set == capability_set
                    && program.technique == technique
                    && program.variant == variant
            })
            .or_else(|| {
                self.programs.iter().position(|program| {
                    program.capability_set.0 == 0
                        && program.technique == technique
                        && program.variant == variant
                })
            })
            .ok_or(CodecExecutionError::ProgramMissing)?;
        let program = self
            .programs
            .get(program_index)
            .ok_or(CodecExecutionError::ProgramMissing)?;
        let execution = self
            .execution
            .get(program_index)
            .ok_or(CodecExecutionError::ProgramMissing)?;
        let active_buffers = (1_u32 << program.buffers.len()) - 1;
        execute_program(
            program,
            execution,
            inputs,
            output_start,
            outputs,
            active_buffers,
        )
    }

    // Stage aggregation: each argument is one explicit input threaded through the
    // pipeline rather than hidden mutable state, and D-244 measured outlining these
    // bodies as size-neutral. Arity is the shape, not a smell.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn execute_buffers(
        &self,
        capability_set: CapabilitySetId,
        technique: TechniqueId,
        variant: u16,
        inputs: SemanticInputBatch<'_>,
        output_start: usize,
        outputs: &mut [PhysicalBufferMut<'_>],
        active_buffers: u32,
    ) -> Result<(), CodecExecutionError> {
        if self.capability_set(capability_set).is_none() {
            return Err(CodecExecutionError::CapabilitySetMissing);
        }
        let program_index = self
            .programs
            .iter()
            .position(|program| {
                program.capability_set == capability_set
                    && program.technique == technique
                    && program.variant == variant
            })
            .or_else(|| {
                self.programs.iter().position(|program| {
                    program.capability_set.0 == 0
                        && program.technique == technique
                        && program.variant == variant
                })
            })
            .ok_or(CodecExecutionError::ProgramMissing)?;
        execute_program(
            &self.programs[program_index],
            &self.execution[program_index],
            inputs,
            output_start,
            outputs,
            active_buffers,
        )
    }

    pub(crate) fn buffer_dependency_masks(
        &self,
        capability_set: CapabilitySetId,
        technique: TechniqueId,
        variant: u16,
    ) -> Option<&[u16]> {
        let index = self
            .programs
            .iter()
            .position(|program| {
                program.capability_set == capability_set
                    && program.technique == technique
                    && program.variant == variant
            })
            .or_else(|| {
                self.programs.iter().position(|program| {
                    program.capability_set.0 == 0
                        && program.technique == technique
                        && program.variant == variant
                })
            })?;
        Some(&self.execution.get(index)?.buffer_dependency_masks)
    }

    pub(crate) fn input_masks_for_changes(
        &self,
        capability_set: CapabilitySetId,
        technique: TechniqueId,
        variant: u16,
        semantic_changes: u16,
        force_all: bool,
    ) -> Option<(u32, u32)> {
        let index = self
            .programs
            .iter()
            .position(|program| {
                program.capability_set == capability_set
                    && program.technique == technique
                    && program.variant == variant
            })
            .or_else(|| {
                self.programs.iter().position(|program| {
                    program.capability_set.0 == 0
                        && program.technique == technique
                        && program.variant == variant
                })
            })?;
        let execution = self.execution.get(index)?;
        let program = self.programs.get(index)?;
        if force_all || semantic_changes == super::positioning::ALL_SEMANTIC_CHANGES {
            return Some((
                low_bits(program.f32_input_count),
                low_bits(program.u32_input_count),
            ));
        }
        let all_buffers = (1_u32 << execution.buffer_dependency_masks.len()) - 1;
        let active_buffers = execution.buffer_dependency_masks.iter().enumerate().fold(
            0_u32,
            |active, (buffer, dependency)| {
                active | (u32::from(dependency & semantic_changes != 0) << buffer)
            },
        ) & all_buffers;
        let mut f32_inputs = 0_u32;
        let mut u32_inputs = 0_u32;
        for buffer in 0..execution.buffer_dependency_masks.len() {
            if active_buffers & (1 << buffer) != 0 {
                f32_inputs |= execution.buffer_f32_input_masks[buffer];
                u32_inputs |= execution.buffer_u32_input_masks[buffer];
            }
        }
        Some((f32_inputs, u32_inputs))
    }
}

fn low_bits(count: u8) -> u32 {
    if count == 0 {
        0
    } else {
        u32::MAX >> (32 - u32::from(count))
    }
}

fn codec_fingerprint(descriptor: &CodecDescriptor) -> u64 {
    let mut fingerprint = 0xcbf2_9ce4_8422_2325_u64;
    mix_u32(&mut fingerprint, descriptor.capability_sets.len() as u32);
    for set in &descriptor.capability_sets {
        mix_u32(&mut fingerprint, set.id.0);
        mix_u32(&mut fingerprint, set.flags);
        mix_u32(&mut fingerprint, set.max_buffer_bytes);
        mix_u32(&mut fingerprint, set.update_alignment);
        mix_u32(&mut fingerprint, set.coalesce_gap_bytes);
        mix_u32(&mut fingerprint, set.range_call_penalty_bytes);
        mix_u32(&mut fingerprint, u32::from(set.max_buffers_per_draw));
        mix_u32(&mut fingerprint, u32::from(set.max_resources_per_draw));
        mix_u32(&mut fingerprint, u32::from(set.max_indirect_draws));
        mix_u32(&mut fingerprint, u32::from(set.fragmentation_budget));
        mix_u32(
            &mut fingerprint,
            u32::from(set.whole_buffer_threshold_basis_points),
        );
    }
    mix_u32(&mut fingerprint, descriptor.programs.len() as u32);
    for program in &descriptor.programs {
        mix_u32(&mut fingerprint, program.technique.0);
        mix_u32(&mut fingerprint, program.id.0);
        mix_u32(&mut fingerprint, program.capability_set.0);
        mix_u32(&mut fingerprint, program.resource_kind_mask);
        mix_u32(&mut fingerprint, program.semantic_view_mask);
        mix_u32(&mut fingerprint, program.storage_key_mask);
        mix_u32(&mut fingerprint, program.draw_key_mask);
        mix_u32(&mut fingerprint, u32::from(program.allocation_strategy));
        mix_u32(&mut fingerprint, u32::from(program.variant));
        mix_u32(&mut fingerprint, u32::from(program.f32_input_count));
        mix_u32(&mut fingerprint, u32::from(program.u32_input_count));
        mix_u32(&mut fingerprint, program.inputs.len() as u32);
        for input in &program.inputs {
            mix_u32(&mut fingerprint, input.scope as u32);
            mix_u32(&mut fingerprint, u32::from(input.field));
        }
        mix_u32(&mut fingerprint, program.capabilities.paint);
        mix_u32(&mut fingerprint, program.capabilities.compositing);
        mix_u32(&mut fingerprint, program.buffers.len() as u32);
        for buffer in &program.buffers {
            mix_u32(&mut fingerprint, u32::from(buffer.id.0));
            mix_u32(&mut fingerprint, buffer.scalar as u32);
            mix_u32(&mut fingerprint, u32::from(buffer.vector_width));
            mix_u32(&mut fingerprint, u32::from(buffer.alignment));
            mix_u32(&mut fingerprint, u32::from(buffer.stride));
            mix_u32(&mut fingerprint, buffer.usage);
            mix_u32(&mut fingerprint, u32::from(buffer.capacity_class));
        }
        mix_u32(&mut fingerprint, program.operations.len() as u32);
        for operation in &program.operations {
            fingerprint_operation(&mut fingerprint, operation);
        }
    }
    fingerprint
}

fn fingerprint_operation(fingerprint: &mut u64, operation: &Operation) {
    let (opcode, target, operand0, operand1, immediate0, immediate1, immediate2) = match *operation
    {
        Operation::LoadF32 { target, field } => (OP_LOAD_F32, target, field, 0, 0, 0, 0),
        Operation::LoadU32 { target, field } => (OP_LOAD_U32, target, field, 0, 0, 0, 0),
        Operation::ConstantF32 { target, bits } => (OP_CONSTANT_F32, target, 0, 0, bits, 0, 0),
        Operation::ConstantU32 { target, value } => (OP_CONSTANT_U32, target, 0, 0, value, 0, 0),
        Operation::AddF32 {
            target,
            left,
            right,
        } => (OP_ADD_F32, target, left, right, 0, 0, 0),
        Operation::SubtractF32 {
            target,
            left,
            right,
        } => (OP_SUBTRACT_F32, target, left, right, 0, 0, 0),
        Operation::MultiplyF32 {
            target,
            left,
            right,
        } => (OP_MULTIPLY_F32, target, left, right, 0, 0, 0),
        Operation::LessThanF32 {
            target,
            left,
            right,
        } => (OP_LESS_THAN_F32, target, left, right, 0, 0, 0),
        Operation::SelectF32 {
            target,
            condition,
            when_true,
            when_false,
        } => (
            OP_SELECT_F32,
            target,
            condition,
            when_true,
            u32::from(when_false),
            0,
            0,
        ),
        Operation::ConvertU32ToF32 { target, source } => {
            (OP_CONVERT_U32_TO_F32, target, source, 0, 0, 0, 0)
        }
        Operation::StoreF32 {
            source,
            buffer,
            lane,
        } => (OP_STORE_F32, 0, source, lane, u32::from(buffer.0), 0, 0),
        Operation::StoreU32 {
            source,
            buffer,
            lane,
        } => (OP_STORE_U32, 0, source, lane, u32::from(buffer.0), 0, 0),
        Operation::StoreU16 {
            source,
            buffer,
            lane,
        } => (OP_STORE_U16, 0, source, lane, u32::from(buffer.0), 0, 0),
    };
    mix_u32(
        fingerprint,
        u32::from_le_bytes([opcode, target, operand0, operand1]),
    );
    mix_u32(fingerprint, immediate0);
    mix_u32(fingerprint, immediate1);
    mix_u32(fingerprint, immediate2);
}

fn mix_u32(fingerprint: &mut u64, value: u32) {
    for byte in value.to_le_bytes() {
        *fingerprint ^= u64::from(byte);
        *fingerprint = fingerprint.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExecutableProgram {
    store_buffer_indices: Vec<u8>,
    buffer_dependency_masks: Vec<u16>,
    buffer_f32_input_masks: Vec<u32>,
    buffer_u32_input_masks: Vec<u32>,
    operation_buffer_masks: Vec<u32>,
}

impl ExecutableProgram {
    fn new(program: &ProgramDescriptor) -> Result<Self, CodecError> {
        let operation_buffer_masks = operation_buffer_masks(program)?;
        let mut store_buffer_indices = Vec::new();
        let mut buffer_dependency_masks = Vec::new();
        let mut buffer_f32_input_masks = Vec::new();
        let mut buffer_u32_input_masks = Vec::new();
        store_buffer_indices
            .try_reserve_exact(program.operations.len())
            .map_err(|_| CodecError::AllocationFailed)?;
        buffer_dependency_masks
            .try_reserve_exact(program.buffers.len())
            .map_err(|_| CodecError::AllocationFailed)?;
        buffer_f32_input_masks
            .try_reserve_exact(program.buffers.len())
            .map_err(|_| CodecError::AllocationFailed)?;
        buffer_u32_input_masks
            .try_reserve_exact(program.buffers.len())
            .map_err(|_| CodecError::AllocationFailed)?;
        buffer_dependency_masks.resize(program.buffers.len(), 0);
        buffer_f32_input_masks.resize(program.buffers.len(), 0);
        buffer_u32_input_masks.resize(program.buffers.len(), 0);
        let mut register_dependencies = [0_u16; MAX_REGISTERS];
        let mut register_f32_inputs = [0_u32; MAX_REGISTERS];
        let mut register_u32_inputs = [0_u32; MAX_REGISTERS];
        for operation in &program.operations {
            let index = match store_buffer(operation) {
                Some(buffer) => program
                    .buffers
                    .iter()
                    .position(|schema| schema.id == buffer)
                    .ok_or(CodecError::UnknownBuffer)?
                    .try_into()
                    .map_err(|_| CodecError::TooManyBuffers)?,
                None => NOT_A_STORE,
            };
            store_buffer_indices.push(index);
            propagate_dependencies(
                program,
                operation,
                &mut register_dependencies,
                &mut buffer_dependency_masks,
            )?;
            propagate_input_dependencies(
                program,
                operation,
                &mut register_f32_inputs,
                &mut register_u32_inputs,
                &mut buffer_f32_input_masks,
                &mut buffer_u32_input_masks,
            )?;
        }
        Ok(Self {
            store_buffer_indices,
            buffer_dependency_masks,
            buffer_f32_input_masks,
            buffer_u32_input_masks,
            operation_buffer_masks,
        })
    }
}

fn operation_buffer_masks(program: &ProgramDescriptor) -> Result<Vec<u32>, CodecError> {
    let mut masks = Vec::new();
    masks
        .try_reserve_exact(program.operations.len())
        .map_err(|_| CodecError::AllocationFailed)?;
    masks.resize(program.operations.len(), 0);
    let mut register_consumers = [0_u32; MAX_REGISTERS];
    for (operation_index, operation) in program.operations.iter().enumerate().rev() {
        if let Some(buffer) = store_buffer(operation) {
            let buffer_index = program
                .buffers
                .iter()
                .position(|schema| schema.id == buffer)
                .ok_or(CodecError::UnknownBuffer)?;
            let mask = 1_u32 << buffer_index;
            masks[operation_index] = mask;
            register_consumers[usize::from(operation_sources(operation)[0])] |= mask;
            continue;
        }
        let Some(target) = operation_target(operation) else {
            continue;
        };
        let mask = register_consumers[usize::from(target)];
        masks[operation_index] = mask;
        register_consumers[usize::from(target)] = 0;
        for source in operation_sources(operation) {
            if source != u8::MAX {
                register_consumers[usize::from(source)] |= mask;
            }
        }
    }
    Ok(masks)
}

fn operation_target(operation: &Operation) -> Option<u8> {
    match *operation {
        Operation::LoadF32 { target, .. }
        | Operation::LoadU32 { target, .. }
        | Operation::ConstantF32 { target, .. }
        | Operation::ConstantU32 { target, .. }
        | Operation::AddF32 { target, .. }
        | Operation::SubtractF32 { target, .. }
        | Operation::MultiplyF32 { target, .. }
        | Operation::LessThanF32 { target, .. }
        | Operation::SelectF32 { target, .. }
        | Operation::ConvertU32ToF32 { target, .. } => Some(target),
        Operation::StoreF32 { .. } | Operation::StoreU32 { .. } | Operation::StoreU16 { .. } => {
            None
        }
    }
}

fn operation_sources(operation: &Operation) -> [u8; 3] {
    match *operation {
        Operation::AddF32 { left, right, .. }
        | Operation::SubtractF32 { left, right, .. }
        | Operation::MultiplyF32 { left, right, .. }
        | Operation::LessThanF32 { left, right, .. } => [left, right, u8::MAX],
        Operation::SelectF32 {
            condition,
            when_true,
            when_false,
            ..
        } => [condition, when_true, when_false],
        Operation::ConvertU32ToF32 { source, .. }
        | Operation::StoreF32 { source, .. }
        | Operation::StoreU32 { source, .. }
        | Operation::StoreU16 { source, .. } => [source, u8::MAX, u8::MAX],
        Operation::LoadF32 { .. }
        | Operation::LoadU32 { .. }
        | Operation::ConstantF32 { .. }
        | Operation::ConstantU32 { .. } => [u8::MAX; 3],
    }
}

fn propagate_input_dependencies(
    program: &ProgramDescriptor,
    operation: &Operation,
    f32_registers: &mut [u32; MAX_REGISTERS],
    u32_registers: &mut [u32; MAX_REGISTERS],
    f32_buffers: &mut [u32],
    u32_buffers: &mut [u32],
) -> Result<(), CodecError> {
    match *operation {
        Operation::LoadF32 { target, field } => {
            f32_registers[usize::from(target)] = 1_u32 << field;
            u32_registers[usize::from(target)] = 0;
        }
        Operation::LoadU32 { target, field } => {
            f32_registers[usize::from(target)] = 0;
            u32_registers[usize::from(target)] = 1_u32 << field;
        }
        Operation::ConstantF32 { target, .. } | Operation::ConstantU32 { target, .. } => {
            f32_registers[usize::from(target)] = 0;
            u32_registers[usize::from(target)] = 0;
        }
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
        }
        | Operation::LessThanF32 {
            target,
            left,
            right,
        } => {
            f32_registers[usize::from(target)] =
                f32_registers[usize::from(left)] | f32_registers[usize::from(right)];
            u32_registers[usize::from(target)] =
                u32_registers[usize::from(left)] | u32_registers[usize::from(right)];
        }
        Operation::SelectF32 {
            target,
            condition,
            when_true,
            when_false,
        } => {
            f32_registers[usize::from(target)] = f32_registers[usize::from(condition)]
                | f32_registers[usize::from(when_true)]
                | f32_registers[usize::from(when_false)];
            u32_registers[usize::from(target)] = u32_registers[usize::from(condition)]
                | u32_registers[usize::from(when_true)]
                | u32_registers[usize::from(when_false)];
        }
        Operation::ConvertU32ToF32 { target, source } => {
            f32_registers[usize::from(target)] = f32_registers[usize::from(source)];
            u32_registers[usize::from(target)] = u32_registers[usize::from(source)];
        }
        Operation::StoreF32 { source, buffer, .. }
        | Operation::StoreU32 { source, buffer, .. }
        | Operation::StoreU16 { source, buffer, .. } => {
            let index = program
                .buffers
                .iter()
                .position(|schema| schema.id == buffer)
                .ok_or(CodecError::UnknownBuffer)?;
            f32_buffers[index] |= f32_registers[usize::from(source)];
            u32_buffers[index] |= u32_registers[usize::from(source)];
        }
    }
    Ok(())
}

fn propagate_dependencies(
    program: &ProgramDescriptor,
    operation: &Operation,
    registers: &mut [u16; MAX_REGISTERS],
    buffers: &mut [u16],
) -> Result<(), CodecError> {
    match *operation {
        Operation::LoadF32 { target, field } => {
            registers[usize::from(target)] =
                f32_input_dependency(program.inputs[usize::from(field)]);
        }
        Operation::LoadU32 { target, field } => {
            let input = usize::from(program.f32_input_count) + usize::from(field);
            registers[usize::from(target)] = u32_input_dependency(program.inputs[input]);
        }
        Operation::ConstantF32 { target, .. } | Operation::ConstantU32 { target, .. } => {
            registers[usize::from(target)] = 0;
        }
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
        }
        | Operation::LessThanF32 {
            target,
            left,
            right,
        } => {
            registers[usize::from(target)] =
                registers[usize::from(left)] | registers[usize::from(right)];
        }
        Operation::SelectF32 {
            target,
            condition,
            when_true,
            when_false,
        } => {
            registers[usize::from(target)] = registers[usize::from(condition)]
                | registers[usize::from(when_true)]
                | registers[usize::from(when_false)];
        }
        Operation::ConvertU32ToF32 { target, source } => {
            registers[usize::from(target)] = registers[usize::from(source)];
        }
        Operation::StoreF32 { source, buffer, .. }
        | Operation::StoreU32 { source, buffer, .. }
        | Operation::StoreU16 { source, buffer, .. } => {
            let index = program
                .buffers
                .iter()
                .position(|schema| schema.id == buffer)
                .ok_or(CodecError::UnknownBuffer)?;
            buffers[index] |= registers[usize::from(source)];
        }
    }
    Ok(())
}

fn f32_input_dependency(source: InputSource) -> u16 {
    if source.scope != InputScope::Semantic {
        return 0;
    }
    match source.field {
        0..=7 => 1 << source.field,
        8..=11 => 1 << 8,
        12 => 1 << 4,
        13..=15 => super::positioning::SEMANTIC_EFFECTS_CHANGE,
        _ => 0,
    }
}

fn u32_input_dependency(source: InputSource) -> u16 {
    if source.scope != InputScope::Semantic {
        return 0;
    }
    match source.field {
        0..=5 => 1 << (8 + source.field),
        6..=7 => super::positioning::SEMANTIC_EFFECTS_CHANGE,
        _ => 0,
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
pub enum CodecExecutionError {
    CapabilitySetMissing,
    ProgramMissing,
    InputFieldCount,
    InputLength,
    OutputBufferCount,
    OutputSchema,
    OutputCapacity,
    NonFiniteOutput,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodecError {
    AllocationFailed,
    EmptyCapabilitySets,
    TooManyCapabilitySets,
    InvalidCapabilitySetId,
    DuplicateCapabilitySetId,
    InvalidCapabilityFlags,
    InvalidCapabilityLimits,
    InvalidUpdateAlignment,
    InvalidUploadCostModel,
    EmptyCodec,
    TooManyPrograms,
    InvalidTechniqueId,
    InvalidProgramId,
    DuplicateTechniqueVariant,
    DuplicateProgramId,
    UnknownCapabilitySet,
    InvalidResourceKinds,
    InvalidBatchKey,
    UnsupportedAllocationStrategy,
    TooManyInputFields,
    InvalidInputSources,
    EmptyBuffers,
    TooManyBuffers,
    InvalidBufferId,
    DuplicateBufferId,
    InvalidVectorWidth,
    InvalidBufferAlignment,
    InvalidBufferStride,
    InvalidBufferUsage,
    InvalidCapacityClass,
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
    active_buffers: u32,
) -> Result<(), CodecExecutionError> {
    validate_execution(program, inputs, output_start, outputs, active_buffers)?;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    let completed = unsafe {
        execute_simd_records(
            program,
            execution,
            inputs,
            output_start,
            outputs,
            active_buffers,
        )?
    };
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
            active_buffers,
        )?;
    }
    Ok(())
}

fn validate_execution(
    program: &ProgramDescriptor,
    inputs: SemanticInputBatch<'_>,
    output_start: usize,
    outputs: &[PhysicalBufferMut<'_>],
    active_buffers: u32,
) -> Result<(), CodecExecutionError> {
    if inputs.f32_fields.len() != usize::from(program.f32_input_count)
        || inputs.u32_fields.len() != usize::from(program.u32_input_count)
    {
        return Err(CodecExecutionError::InputFieldCount);
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
        return Err(CodecExecutionError::InputLength);
    }
    if outputs.len() != program.buffers.len() {
        return Err(CodecExecutionError::OutputBufferCount);
    }
    let output_end = output_start
        .checked_add(inputs.record_count)
        .ok_or(CodecExecutionError::OutputCapacity)?;
    for (index, (output, schema)) in outputs.iter().zip(&program.buffers).enumerate() {
        if output.schema != *schema {
            return Err(CodecExecutionError::OutputSchema);
        }
        if active_buffers & (1 << index) == 0 {
            continue;
        }
        let required = output_end
            .checked_mul(schema.stride())
            .ok_or(CodecExecutionError::OutputCapacity)?;
        if output.bytes.len() < required {
            return Err(CodecExecutionError::OutputCapacity);
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
    active_buffers: u32,
) -> Result<(), CodecExecutionError> {
    let mut registers = [0_u32; MAX_REGISTERS];
    let mut values = [0_u32; MAX_OUTPUT_LANES];
    for (operation_index, operation) in program.operations.iter().enumerate() {
        if execution.operation_buffer_masks[operation_index] & active_buffers == 0 {
            continue;
        }
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
                    return Err(CodecExecutionError::NonFiniteOutput);
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
        if active_buffers & (1 << buffer_index) == 0 {
            continue;
        }
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
    active_buffers: u32,
) -> Result<usize, CodecExecutionError> {
    use core::arch::wasm32::{
        f32x4_add, f32x4_convert_u32x4, f32x4_lt, f32x4_mul, f32x4_sub, i32x4_ne, u32x4_splat,
        v128, v128_and, v128_bitselect, v128_load,
    };

    let completed = inputs.record_count & !3;
    for input_record in (0..completed).step_by(4) {
        let mut registers = [u32x4_splat(0); MAX_REGISTERS];
        let mut values = [u32x4_splat(0); MAX_OUTPUT_LANES];
        for (operation_index, operation) in program.operations.iter().enumerate() {
            if execution.operation_buffer_masks[operation_index] & active_buffers == 0 {
                continue;
            }
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
                        return Err(CodecExecutionError::NonFiniteOutput);
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
        write_simd_outputs(
            program,
            &values,
            output_start + input_record,
            outputs,
            active_buffers,
        );
    }
    Ok(completed)
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn write_simd_outputs(
    program: &ProgramDescriptor,
    values: &[core::arch::wasm32::v128; MAX_OUTPUT_LANES],
    output_start: usize,
    outputs: &mut [PhysicalBufferMut<'_>],
    active_buffers: u32,
) {
    use core::arch::wasm32::{i32x4_shuffle, v128_store};

    for (buffer_index, (schema, output)) in program.buffers.iter().zip(outputs).enumerate() {
        if active_buffers & (1 << buffer_index) == 0 {
            continue;
        }
        let first = buffer_index * MAX_VECTOR_WIDTH as usize;
        if matches!(schema.scalar, ScalarType::F32 | ScalarType::U32)
            && schema.stride() == usize::from(schema.vector_width) * 4
        {
            let destination = output_start * schema.stride();
            match schema.vector_width {
                1 => {
                    // SAFETY: execution validation proves four tightly packed records fit.
                    unsafe {
                        v128_store(
                            output.bytes.as_mut_ptr().add(destination).cast(),
                            values[first],
                        );
                    }
                    continue;
                }
                2 => {
                    let first_pair = i32x4_shuffle::<0, 4, 1, 5>(values[first], values[first + 1]);
                    let second_pair = i32x4_shuffle::<2, 6, 3, 7>(values[first], values[first + 1]);
                    // SAFETY: execution validation proves four tightly packed records fit.
                    unsafe {
                        v128_store(
                            output.bytes.as_mut_ptr().add(destination).cast(),
                            first_pair,
                        );
                        v128_store(
                            output.bytes.as_mut_ptr().add(destination + 16).cast(),
                            second_pair,
                        );
                    }
                    continue;
                }
                4 => {
                    let low01 = i32x4_shuffle::<0, 4, 1, 5>(values[first], values[first + 1]);
                    let low23 = i32x4_shuffle::<0, 4, 1, 5>(values[first + 2], values[first + 3]);
                    let high01 = i32x4_shuffle::<2, 6, 3, 7>(values[first], values[first + 1]);
                    let high23 = i32x4_shuffle::<2, 6, 3, 7>(values[first + 2], values[first + 3]);
                    let records = [
                        i32x4_shuffle::<0, 1, 4, 5>(low01, low23),
                        i32x4_shuffle::<2, 3, 6, 7>(low01, low23),
                        i32x4_shuffle::<0, 1, 4, 5>(high01, high23),
                        i32x4_shuffle::<2, 3, 6, 7>(high01, high23),
                    ];
                    for (record, value) in records.into_iter().enumerate() {
                        // SAFETY: execution validation proves four tightly packed records fit.
                        unsafe {
                            v128_store(
                                output
                                    .bytes
                                    .as_mut_ptr()
                                    .add(destination + record * 16)
                                    .cast(),
                                value,
                            );
                        }
                    }
                    continue;
                }
                _ => {}
            }
        }
        for lane in 0..schema.vector_width {
            let lanes = simd_u32_lanes(values[first + usize::from(lane)]);
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

fn validate_codec(descriptor: &CodecDescriptor) -> Result<(), CodecError> {
    validate_capability_sets(&descriptor.capability_sets)?;
    if descriptor.programs.is_empty() {
        return Err(CodecError::EmptyCodec);
    }
    if descriptor.programs.len() > MAX_PROGRAMS {
        return Err(CodecError::TooManyPrograms);
    }
    for (index, program) in descriptor.programs.iter().enumerate() {
        if program.technique.0 == 0 {
            return Err(CodecError::InvalidTechniqueId);
        }
        if program.id.0 == 0 {
            return Err(CodecError::InvalidProgramId);
        }
        if program.capability_set.0 != 0
            && !descriptor
                .capability_sets
                .iter()
                .any(|set| set.id == program.capability_set)
        {
            return Err(CodecError::UnknownCapabilitySet);
        }
        // Decoration programs draw without raster resources; every other program must
        // declare the resource kinds it accepts.
        if program.resource_kind_mask == 0
            && program.primitive_kind != super::render_plan::PRIMITIVE_DECORATION
        {
            return Err(CodecError::InvalidResourceKinds);
        }
        if program.storage_key_mask & !STORAGE_KEY_FIELDS != 0
            || program.storage_key_mask & REQUIRED_STORAGE_KEYS != REQUIRED_STORAGE_KEYS
            || program.draw_key_mask & !BATCH_FIELDS != 0
            || program.draw_key_mask & REQUIRED_DRAW_KEYS != REQUIRED_DRAW_KEYS
        {
            return Err(CodecError::InvalidBatchKey);
        }
        if !matches!(
            program.allocation_strategy,
            ALLOCATION_ORDERED_DIRECT | ALLOCATION_STABLE_INDIRECT
        ) {
            return Err(CodecError::UnsupportedAllocationStrategy);
        }
        let required_capability = if program.allocation_strategy == ALLOCATION_ORDERED_DIRECT {
            CAP_ORDERED_DIRECT
        } else {
            CAP_STABLE_INDIRECT
        };
        if descriptor.capability_sets.iter().any(|set| {
            (program.capability_set.0 == 0 || program.capability_set == set.id)
                && set.flags & required_capability == 0
        }) {
            return Err(CodecError::UnsupportedAllocationStrategy);
        }
        for previous in &descriptor.programs[..index] {
            if previous.capability_set == program.capability_set
                && previous.technique == program.technique
                && previous.variant == program.variant
            {
                return Err(CodecError::DuplicateTechniqueVariant);
            }
            if previous.id == program.id {
                return Err(CodecError::DuplicateProgramId);
            }
        }
        validate_program(program)?;
    }
    if descriptor.capability_sets.iter().any(|set| {
        !descriptor
            .programs
            .iter()
            .any(|program| program.capability_set.0 == 0 || program.capability_set == set.id)
    }) {
        return Err(CodecError::UnknownCapabilitySet);
    }
    Ok(())
}

fn validate_capability_sets(capability_sets: &[CapabilitySet]) -> Result<(), CodecError> {
    if capability_sets.is_empty() {
        return Err(CodecError::EmptyCapabilitySets);
    }
    if capability_sets.len() > MAX_CAPABILITY_SETS {
        return Err(CodecError::TooManyCapabilitySets);
    }
    for (index, set) in capability_sets.iter().enumerate() {
        if set.id.0 == 0 {
            return Err(CodecError::InvalidCapabilitySetId);
        }
        if capability_sets[..index]
            .iter()
            .any(|previous| previous.id == set.id)
        {
            return Err(CodecError::DuplicateCapabilitySetId);
        }
        if set.flags & !CAPABILITY_FLAGS != 0
            || set.flags & (CAP_ORDERED_DIRECT | CAP_STABLE_INDIRECT) == 0
        {
            return Err(CodecError::InvalidCapabilityFlags);
        }
        if set.max_buffer_bytes == 0
            || set.max_buffers_per_draw == 0
            || usize::from(set.max_buffers_per_draw) > MAX_BUFFERS_PER_PROGRAM
            || set.max_resources_per_draw == 0
            || set.fragmentation_budget == 0
        {
            return Err(CodecError::InvalidCapabilityLimits);
        }
        if !set.update_alignment.is_power_of_two() || set.update_alignment > 256 {
            return Err(CodecError::InvalidUpdateAlignment);
        }
        if set.coalesce_gap_bytes > set.max_buffer_bytes
            || set.range_call_penalty_bytes > set.max_buffer_bytes
            || !(1..=10_000).contains(&set.whole_buffer_threshold_basis_points)
        {
            return Err(CodecError::InvalidUploadCostModel);
        }
        if (set.flags & CAP_INDIRECT_DRAWS == 0) != (set.max_indirect_draws == 0) {
            return Err(CodecError::InvalidCapabilityLimits);
        }
    }
    Ok(())
}

fn validate_program(program: &ProgramDescriptor) -> Result<(), CodecError> {
    if usize::from(program.f32_input_count) > MAX_REGISTERS
        || usize::from(program.u32_input_count) > MAX_REGISTERS
    {
        return Err(CodecError::TooManyInputFields);
    }
    if program.inputs.len()
        != usize::from(program.f32_input_count) + usize::from(program.u32_input_count)
    {
        return Err(CodecError::InvalidInputSources);
    }
    if program.buffers.is_empty() {
        return Err(CodecError::EmptyBuffers);
    }
    if program.buffers.len() > MAX_BUFFERS_PER_PROGRAM {
        return Err(CodecError::TooManyBuffers);
    }
    for (index, buffer) in program.buffers.iter().enumerate() {
        if buffer.id.0 == 0 {
            return Err(CodecError::InvalidBufferId);
        }
        if buffer.vector_width == 0 || buffer.vector_width > MAX_VECTOR_WIDTH {
            return Err(CodecError::InvalidVectorWidth);
        }
        if buffer.alignment == 0 || !buffer.alignment.is_power_of_two() || buffer.alignment > 256 {
            return Err(CodecError::InvalidBufferAlignment);
        }
        let packed_width = buffer
            .scalar
            .byte_width()
            .checked_mul(usize::from(buffer.vector_width))
            .ok_or(CodecError::InvalidBufferStride)?;
        if usize::from(buffer.stride) < packed_width
            || usize::from(buffer.stride) % usize::from(buffer.alignment) != 0
        {
            return Err(CodecError::InvalidBufferStride);
        }
        if buffer.usage == 0
            || buffer.usage & !BUFFER_USAGE_FLAGS != 0
            || buffer.usage & BUFFER_USAGE_COPY_DST == 0
        {
            return Err(CodecError::InvalidBufferUsage);
        }
        if buffer.capacity_class == 0 {
            return Err(CodecError::InvalidCapacityClass);
        }
        if program.buffers[..index]
            .iter()
            .any(|previous| previous.id == buffer.id)
        {
            return Err(CodecError::DuplicateBufferId);
        }
    }
    if program.operations.is_empty() {
        return Err(CodecError::EmptyOperations);
    }
    if program.operations.len() > MAX_OPERATIONS_PER_PROGRAM {
        return Err(CodecError::TooManyOperations);
    }

    let mut registers = [UNINITIALIZED; MAX_REGISTERS];
    let mut stored_lanes = [0_u8; MAX_BUFFERS_PER_PROGRAM];
    for operation in &program.operations {
        validate_operation(program, operation, &mut registers, &mut stored_lanes)?;
    }
    for (index, buffer) in program.buffers.iter().enumerate() {
        let required = (1_u8 << buffer.vector_width) - 1;
        if stored_lanes[index] != required {
            return Err(CodecError::IncompleteBuffer);
        }
    }
    Ok(())
}

fn validate_operation(
    program: &ProgramDescriptor,
    operation: &Operation,
    registers: &mut [u8; MAX_REGISTERS],
    stored_lanes: &mut [u8; MAX_BUFFERS_PER_PROGRAM],
) -> Result<(), CodecError> {
    match *operation {
        Operation::LoadF32 { target, field } => {
            if field >= program.f32_input_count {
                return Err(CodecError::InvalidInputField);
            }
            initialize(registers, target, F32_REGISTER)
        }
        Operation::LoadU32 { target, field } => {
            if field >= program.u32_input_count {
                return Err(CodecError::InvalidInputField);
            }
            initialize(registers, target, U32_REGISTER)
        }
        Operation::ConstantF32 { target, bits } => {
            if !f32::from_bits(bits).is_finite() {
                return Err(CodecError::NonFiniteConstant);
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
) -> Result<(), CodecError> {
    let slot = registers
        .get_mut(usize::from(target))
        .ok_or(CodecError::InvalidRegister)?;
    *slot = register_type;
    Ok(())
}

fn require(
    registers: &[u8; MAX_REGISTERS],
    register: u8,
    register_type: u8,
) -> Result<(), CodecError> {
    let actual = *registers
        .get(usize::from(register))
        .ok_or(CodecError::InvalidRegister)?;
    if actual == UNINITIALIZED {
        return Err(CodecError::UninitializedRegister);
    }
    if actual != register_type {
        return Err(CodecError::RegisterTypeMismatch);
    }
    Ok(())
}

fn validate_store(
    program: &ProgramDescriptor,
    buffer: BufferId,
    lane: u8,
    scalar: ScalarType,
    stored_lanes: &mut [u8; MAX_BUFFERS_PER_PROGRAM],
) -> Result<(), CodecError> {
    let index = program
        .buffers
        .iter()
        .position(|candidate| candidate.id == buffer)
        .ok_or(CodecError::UnknownBuffer)?;
    let schema = program.buffers[index];
    if schema.scalar != scalar {
        return Err(CodecError::StoreTypeMismatch);
    }
    if lane >= schema.vector_width {
        return Err(CodecError::InvalidStoreLane);
    }
    let mask = 1_u8 << lane;
    if stored_lanes[index] & mask != 0 {
        return Err(CodecError::DuplicateStore);
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
    const COLORS: BufferId = BufferId(2);
    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);

    fn valid_capability_set() -> CapabilitySet {
        CapabilitySet {
            id: CAPABILITY,
            flags: CAP_STORAGE_BUFFERS | CAP_ORDERED_DIRECT | CAP_STABLE_INDIRECT,
            max_buffer_bytes: 64 * 1024 * 1024,
            update_alignment: 4,
            coalesce_gap_bytes: 128,
            range_call_penalty_bytes: 256,
            max_buffers_per_draw: MAX_BUFFERS_PER_PROGRAM as u16,
            max_resources_per_draw: 16,
            max_indirect_draws: 0,
            fragmentation_budget: 8,
            whole_buffer_threshold_basis_points: 7_500,
        }
    }

    fn descriptor(programs: Vec<ProgramDescriptor>) -> CodecDescriptor {
        CodecDescriptor {
            capability_sets: vec![valid_capability_set()],
            programs,
        }
    }

    fn valid_program() -> ProgramDescriptor {
        ProgramDescriptor {
            primitive_kind: 1,
            technique: BITMAP,
            variant: 0,
            id: PROGRAM,
            capability_set: CapabilitySetId(0),
            resource_kind_mask: 1,
            semantic_view_mask: 0,
            storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
            draw_key_mask: BATCH_TECHNIQUE
                | BATCH_PROGRAM
                | BATCH_RESOURCE
                | BATCH_ORDER
                | BATCH_TRANSFORM,
            allocation_strategy: ALLOCATION_ORDERED_DIRECT,
            f32_input_count: 2,
            u32_input_count: 0,
            inputs: vec![InputSource::semantic(0), InputSource::semantic(1)],
            capabilities: ProgramCapabilities::default(),
            buffers: vec![BufferSchema::packed(
                ORIGINS,
                ScalarType::F32,
                2,
                BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                1,
            )],
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
        let codec = ValidatedCodec::new(descriptor(vec![valid_program()])).unwrap();
        assert_eq!(
            codec.program(CAPABILITY, BITMAP, 0).map(|value| value.id),
            Some(PROGRAM)
        );
        assert_eq!(codec.program(CAPABILITY, BITMAP, 1), None);
        assert_eq!(
            codec.buffer_dependency_masks(CAPABILITY, BITMAP, 0),
            Some([0b11].as_slice())
        );
    }

    #[test]
    fn effect_inputs_follow_the_effect_change_bit() {
        let effect = super::super::positioning::SEMANTIC_EFFECTS_CHANGE;
        assert_eq!(f32_input_dependency(InputSource::semantic(13)), effect);
        assert_eq!(f32_input_dependency(InputSource::semantic(15)), effect);
        assert_eq!(f32_input_dependency(InputSource::semantic(16)), 0);
        assert_eq!(u32_input_dependency(InputSource::semantic(6)), effect);
        assert_eq!(u32_input_dependency(InputSource::semantic(7)), effect);
        assert_eq!(u32_input_dependency(InputSource::semantic(8)), 0);
    }

    #[test]
    fn reports_only_a_truly_uniform_allocation_strategy() {
        let ordered = valid_program();
        let uniform = ValidatedCodec::new(descriptor(vec![ordered.clone()])).unwrap();
        assert_eq!(
            uniform.uniform_allocation_strategy(CAPABILITY),
            Some(ALLOCATION_ORDERED_DIRECT)
        );

        let mut stable = ordered;
        stable.technique = TechniqueId(2);
        stable.id = ProgramId(2);
        stable.allocation_strategy = ALLOCATION_STABLE_INDIRECT;
        let mixed = ValidatedCodec::new(descriptor(vec![valid_program(), stable])).unwrap();
        assert_eq!(mixed.uniform_allocation_strategy(CAPABILITY), None);
    }

    #[test]
    fn compiles_each_operation_to_only_its_reachable_buffers() {
        let mut program = valid_program();
        program.buffers.push(BufferSchema::packed(
            COLORS,
            ScalarType::U32,
            1,
            BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
            1,
        ));
        program.operations.extend([
            Operation::ConstantU32 {
                target: 2,
                value: 0xff00_00ff,
            },
            Operation::StoreU32 {
                source: 2,
                buffer: COLORS,
                lane: 0,
            },
        ]);
        let codec = ValidatedCodec::new(descriptor(vec![program])).unwrap();

        assert_eq!(
            codec.execution[0].operation_buffer_masks,
            [1, 1, 1, 1, 2, 2]
        );
    }

    #[test]
    fn input_sources_are_exact_and_participate_in_codec_identity() {
        let program = valid_program();
        let first = ValidatedCodec::new(descriptor(vec![program.clone()])).unwrap();
        let mut changed = program.clone();
        changed.inputs[1] = InputSource {
            scope: InputScope::Glyph,
            field: 0,
        };
        let second = ValidatedCodec::new(descriptor(vec![changed])).unwrap();
        assert_ne!(first.fingerprint(), second.fingerprint());

        let mut missing = program;
        missing.inputs.pop();
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![missing])),
            Err(CodecError::InvalidInputSources)
        );
    }

    #[test]
    fn fingerprints_exact_validated_codec_content() {
        let first = ValidatedCodec::new(descriptor(vec![valid_program()])).unwrap();
        let same = ValidatedCodec::new(descriptor(vec![valid_program()])).unwrap();
        let mut changed_program = valid_program();
        changed_program.technique = TechniqueId(2);
        let changed = ValidatedCodec::new(descriptor(vec![changed_program])).unwrap();
        assert_eq!(first.fingerprint(), same.fingerprint());
        assert_ne!(first.fingerprint(), changed.fingerprint());
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
            ValidatedCodec::new(descriptor(vec![uninitialized])),
            Err(CodecError::UninitializedRegister)
        );

        let mut wrong_type = valid_program();
        wrong_type.operations[0] = Operation::ConstantU32 {
            target: 0,
            value: 1,
        };
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![wrong_type])),
            Err(CodecError::RegisterTypeMismatch)
        );
    }

    #[test]
    fn rejects_partial_duplicate_and_out_of_range_stores() {
        let mut partial = valid_program();
        partial.operations.pop();
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![partial])),
            Err(CodecError::IncompleteBuffer)
        );

        let mut duplicate = valid_program();
        duplicate.operations[3] = Operation::StoreF32 {
            source: 1,
            buffer: ORIGINS,
            lane: 0,
        };
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![duplicate])),
            Err(CodecError::DuplicateStore)
        );

        let mut out_of_range = valid_program();
        out_of_range.operations[3] = Operation::StoreF32 {
            source: 1,
            buffer: ORIGINS,
            lane: 2,
        };
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![out_of_range])),
            Err(CodecError::InvalidStoreLane)
        );
    }

    #[test]
    fn rejects_duplicate_technique_variants_and_program_ids() {
        let first = valid_program();
        let mut same_variant = valid_program();
        same_variant.id = ProgramId(2);
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![first.clone(), same_variant])),
            Err(CodecError::DuplicateTechniqueVariant)
        );

        let mut duplicate_id = valid_program();
        duplicate_id.technique = TechniqueId(2);
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![first, duplicate_id])),
            Err(CodecError::DuplicateProgramId)
        );
    }

    #[test]
    fn accepts_same_technique_with_distinct_variants() {
        let first = valid_program();
        let mut second = valid_program();
        second.variant = 1;
        second.id = ProgramId(2);
        let codec = ValidatedCodec::new(descriptor(vec![first, second])).unwrap();
        assert_eq!(codec.programs().len(), 2);
    }

    #[test]
    fn storage_and_draw_keys_validate_independently() {
        let mut missing_storage_resource = valid_program();
        missing_storage_resource.storage_key_mask = BATCH_TECHNIQUE | BATCH_PROGRAM;
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![missing_storage_resource])).unwrap_err(),
            CodecError::InvalidBatchKey,
        );

        let mut missing_draw_order = valid_program();
        missing_draw_order.draw_key_mask = BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE;
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![missing_draw_order])).unwrap_err(),
            CodecError::InvalidBatchKey,
        );

        let mut material_partitioned = valid_program();
        material_partitioned.storage_key_mask |= BATCH_MATERIAL;
        material_partitioned.draw_key_mask |= BATCH_MATERIAL;
        assert!(ValidatedCodec::new(descriptor(vec![material_partitioned])).is_ok());
    }

    #[test]
    fn capability_sets_select_exact_programs_and_reject_invalid_costs() {
        let mut webgpu = valid_capability_set();
        webgpu.id = CapabilitySetId(1);
        webgpu.flags = CAP_ORDERED_DIRECT;
        let mut webgl = valid_capability_set();
        webgl.id = CapabilitySetId(2);
        webgl.flags = CAP_STABLE_INDIRECT;

        let mut direct = valid_program();
        direct.capability_set = webgpu.id;
        let mut indirect = valid_program();
        indirect.id = ProgramId(2);
        indirect.capability_set = webgl.id;
        indirect.allocation_strategy = ALLOCATION_STABLE_INDIRECT;
        let codec = ValidatedCodec::new(CodecDescriptor {
            capability_sets: vec![webgpu, webgl],
            programs: vec![direct, indirect],
        })
        .unwrap();
        assert_eq!(
            codec.program(CapabilitySetId(1), BITMAP, 0).unwrap().id,
            ProgramId(1)
        );
        assert_eq!(
            codec.program(CapabilitySetId(2), BITMAP, 0).unwrap().id,
            ProgramId(2)
        );
        assert_eq!(codec.program(CapabilitySetId(3), BITMAP, 0), None);

        let mut invalid_cost = valid_capability_set();
        invalid_cost.whole_buffer_threshold_basis_points = 10_001;
        assert_eq!(
            ValidatedCodec::new(CodecDescriptor {
                capability_sets: vec![invalid_cost],
                programs: vec![valid_program()],
            }),
            Err(CodecError::InvalidUploadCostModel)
        );
    }

    #[test]
    fn executor_honors_codec_stride_without_touching_padding() {
        let mut program = valid_program();
        program.buffers[0].alignment = 16;
        program.buffers[0].stride = 16;
        let codec = ValidatedCodec::new(descriptor(vec![program])).unwrap();
        let x = [1.0, 2.0];
        let y = [3.0, 4.0];
        let fields: [&[f32]; 2] = [&x, &y];
        let mut bytes = [0xa5_u8; 32];
        let mut outputs = [PhysicalBufferMut {
            schema: codec.program(CAPABILITY, BITMAP, 0).unwrap().buffers[0],
            bytes: &mut bytes,
        }];
        codec
            .execute(
                CAPABILITY,
                BITMAP,
                0,
                SemanticInputBatch {
                    f32_fields: &fields,
                    u32_fields: &[],
                    record_count: 2,
                },
                0,
                &mut outputs,
            )
            .unwrap();
        assert_eq!(read_f32(&bytes, 0), 1.0);
        assert_eq!(read_f32(&bytes, 4), 3.0);
        assert_eq!(&bytes[8..16], &[0xa5; 8]);
        assert_eq!(read_f32(&bytes, 16), 2.0);
        assert_eq!(read_f32(&bytes, 20), 4.0);
        assert_eq!(&bytes[24..32], &[0xa5; 8]);
    }

    #[test]
    fn scalar_executor_writes_a_bounded_record_range_without_touching_spares() {
        let codec = ValidatedCodec::new(descriptor(vec![valid_program()])).unwrap();
        let x = [1.25, -2.5, 8.0];
        let y = [4.0, 6.5, -9.0];
        let fields: [&[f32]; 2] = [&x, &y];
        let schema = codec.program(CAPABILITY, BITMAP, 0).unwrap().buffers[0];
        let mut bytes = [0x7f_u8; 5 * 8];
        {
            let mut outputs = [PhysicalBufferMut {
                schema,
                bytes: &mut bytes,
            }];
            codec
                .execute(
                    CAPABILITY,
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
        let codec = ValidatedCodec::new(descriptor(vec![ProgramDescriptor {
            primitive_kind: 1,
            technique: BITMAP,
            variant: 0,
            id: PROGRAM,
            capability_set: CapabilitySetId(0),
            resource_kind_mask: 1,
            semantic_view_mask: 0,
            storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
            draw_key_mask: BATCH_TECHNIQUE
                | BATCH_PROGRAM
                | BATCH_RESOURCE
                | BATCH_ORDER
                | BATCH_TRANSFORM,
            allocation_strategy: ALLOCATION_ORDERED_DIRECT,
            f32_input_count: 1,
            u32_input_count: 1,
            inputs: vec![InputSource::semantic(0), InputSource::semantic(0)],
            capabilities: ProgramCapabilities::default(),
            buffers: vec![
                BufferSchema::packed(
                    color,
                    ScalarType::F32,
                    2,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
                BufferSchema::packed(
                    object,
                    ScalarType::U32,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
                BufferSchema::packed(
                    page,
                    ScalarType::U16,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
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
        }]))
        .unwrap();
        let signed = [-2.0, 3.0];
        let identifiers = [70_000, 42];
        let f32_fields: [&[f32]; 1] = [&signed];
        let u32_fields: [&[u32]; 1] = [&identifiers];
        let mut colors = [0_u8; 16];
        let mut objects = [0_u8; 8];
        let mut pages = [0_u8; 4];
        let program = codec.program(CAPABILITY, BITMAP, 0).unwrap();
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
        codec
            .execute(
                CAPABILITY,
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
        let codec = ValidatedCodec::new(descriptor(vec![valid_program()])).unwrap();
        let x = [1.0, 2.0];
        let short_y = [3.0];
        let fields: [&[f32]; 2] = [&x, &short_y];
        let mut bytes = [0xa5_u8; 16];
        let mut outputs = [PhysicalBufferMut {
            schema: codec.program(CAPABILITY, BITMAP, 0).unwrap().buffers[0],
            bytes: &mut bytes,
        }];
        assert_eq!(
            codec.execute(
                CAPABILITY,
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
            Err(CodecExecutionError::InputLength)
        );
        assert_eq!(bytes, [0xa5; 16]);
    }

    #[test]
    fn codec_and_executor_reject_nonfinite_physical_values() {
        let mut constant = valid_program();
        constant.operations[0] = Operation::ConstantF32 {
            target: 0,
            bits: f32::INFINITY.to_bits(),
        };
        assert_eq!(
            ValidatedCodec::new(descriptor(vec![constant])),
            Err(CodecError::NonFiniteConstant)
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
        let codec = ValidatedCodec::new(descriptor(vec![overflow])).unwrap();
        let values = [f32::MAX];
        let fields: [&[f32]; 2] = [&values, &values];
        let mut bytes = [0x5a_u8; 8];
        let mut outputs = [PhysicalBufferMut {
            schema: codec.program(CAPABILITY, BITMAP, 0).unwrap().buffers[0],
            bytes: &mut bytes,
        }];
        assert_eq!(
            codec.execute(
                CAPABILITY,
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
            Err(CodecExecutionError::NonFiniteOutput)
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
