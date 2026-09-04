//! Error contract shared by render-plan storage strategies.

use super::{
    codec::CodecExecutionError, plan_draw::PlanDrawError, plan_input::PlanInputError,
    plan_packing::PackingError,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    CapabilitySetMissing,
    ProgramMissing,
    UnsupportedStrategy,
    InvalidInputShape,
    InvalidIdentity,
    DuplicateIdentity,
    InvalidResource,
    CapacityExceeded,
    IdentifierExhausted,
    ArithmeticOverflow,
    CodecExecution(CodecExecutionError),
}

impl From<PlanInputError> for PlanError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
        }
    }
}

impl From<PackingError> for PlanError {
    fn from(error: PackingError) -> Self {
        match error {
            PackingError::AllocationFailed => Self::AllocationFailed,
            PackingError::ArithmeticOverflow => Self::ArithmeticOverflow,
            PackingError::CapacityExceeded => Self::CapacityExceeded,
            PackingError::InvalidIdentity => Self::InvalidIdentity,
            PackingError::Codec(error) => Self::CodecExecution(error),
        }
    }
}

impl From<PlanDrawError> for PlanError {
    fn from(error: PlanDrawError) -> Self {
        match error {
            PlanDrawError::AllocationFailed => Self::AllocationFailed,
            PlanDrawError::ArithmeticOverflow => Self::ArithmeticOverflow,
        }
    }
}
