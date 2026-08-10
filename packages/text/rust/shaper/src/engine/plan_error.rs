//! Error contract shared by render-plan storage strategies.

use super::{
    identity_index::IdentitySetError, plan_draw::PlanDrawError, plan_input::PlanInputError,
    plan_packing::PackingError, policy::PolicyExecutionError,
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
    PolicyExecution(PolicyExecutionError),
}

impl From<PlanInputError> for PlanError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
            PlanInputError::InvalidIdentity => Self::InvalidIdentity,
            PlanInputError::InvalidResource => Self::InvalidResource,
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
            PackingError::Policy(error) => Self::PolicyExecution(error),
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

impl From<IdentitySetError> for PlanError {
    fn from(error: IdentitySetError) -> Self {
        match error {
            IdentitySetError::AllocationFailed => Self::AllocationFailed,
            IdentitySetError::ArithmeticOverflow => Self::ArithmeticOverflow,
        }
    }
}
