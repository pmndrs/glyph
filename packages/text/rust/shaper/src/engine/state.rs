use alloc::collections::BTreeMap;

use super::{
    frame::{CommittedUpdate, PreparedUpdate, SessionRevision, UpdateRequest},
    policy::ValidatedPolicy,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineError {
    InvalidHandle,
    HandleConflict,
    PolicyMissing,
    SessionConflict,
    SessionMissing,
    RevisionConflict,
    RevisionExhausted,
    InvalidRequest,
}

#[derive(Default)]
pub struct TextEngine {
    policies: BTreeMap<u32, ValidatedPolicy>,
    sessions: BTreeMap<u32, EngineSession>,
}

#[derive(Default)]
struct EngineSession {
    revision: SessionRevision,
}

impl TextEngine {
    pub fn register_policy(
        &mut self,
        handle: u32,
        policy: ValidatedPolicy,
    ) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if let Some(existing) = self.policies.get(&handle) {
            return if existing == &policy {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.policies.insert(handle, policy);
        Ok(())
    }

    pub fn dispose_policy(&mut self, handle: u32) -> Result<(), EngineError> {
        self.policies
            .remove(&handle)
            .map(|_| ())
            .ok_or(EngineError::PolicyMissing)
    }

    pub fn policy(&self, handle: u32) -> Result<&ValidatedPolicy, EngineError> {
        self.policies.get(&handle).ok_or(EngineError::PolicyMissing)
    }

    pub fn policy_count(&self) -> u32 {
        self.policies.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn create_session(&mut self, handle: u32) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if self.sessions.contains_key(&handle) {
            return Err(EngineError::SessionConflict);
        }
        self.sessions.insert(handle, EngineSession::default());
        Ok(())
    }

    pub fn dispose_session(&mut self, handle: u32) -> Result<(), EngineError> {
        self.sessions
            .remove(&handle)
            .map(|_| ())
            .ok_or(EngineError::SessionMissing)
    }

    pub(crate) fn session_revision(&self, handle: u32) -> Result<SessionRevision, EngineError> {
        self.sessions
            .get(&handle)
            .map(|session| session.revision)
            .ok_or(EngineError::SessionMissing)
    }

    pub fn session_count(&self) -> u32 {
        self.sessions.len().try_into().unwrap_or(u32::MAX)
    }

    pub(crate) fn prepare_update(
        &self,
        request: UpdateRequest,
    ) -> Result<PreparedUpdate, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let session = self
            .sessions
            .get(&request.session_id)
            .ok_or(EngineError::SessionMissing)?;
        self.policy(request.policy_handle)?;
        if request.expected_engine_revision != session.revision.engine
            || request.consumed_plan_revision > session.revision.plan
        {
            return Err(EngineError::RevisionConflict);
        }
        let next = SessionRevision {
            engine: session
                .revision
                .engine
                .checked_add(1)
                .ok_or(EngineError::RevisionExhausted)?,
            plan: session
                .revision
                .plan
                .checked_add(1)
                .ok_or(EngineError::RevisionExhausted)?,
        };
        let checkpoint =
            session.revision.plan == 0 || request.consumed_plan_revision != session.revision.plan;
        Ok(PreparedUpdate {
            session_id: request.session_id,
            previous: session.revision,
            next,
            required_base_revision: if checkpoint { 0 } else { session.revision.plan },
            checkpoint,
        })
    }

    pub(crate) fn commit_update(
        &mut self,
        prepared: PreparedUpdate,
    ) -> Result<CommittedUpdate, EngineError> {
        let session = self
            .sessions
            .get_mut(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session.revision = prepared.next;
        Ok(CommittedUpdate {
            session_id: prepared.session_id,
            revision: prepared.next,
            required_base_revision: prepared.required_base_revision,
            checkpoint: prepared.checkpoint,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::policy::{
        BufferId, BufferSchema, Operation, PolicyDescriptor, ProgramCapabilities,
        ProgramDescriptor, ProgramId, ScalarType, TechniqueId,
    };
    use alloc::vec;

    #[test]
    fn registration_is_idempotent_but_rejects_handle_conflicts() {
        let first = validated_policy(TechniqueId(1));
        let mut engine = TextEngine::default();
        assert_eq!(engine.register_policy(1, first.clone()), Ok(()));
        assert_eq!(engine.register_policy(1, first), Ok(()));
        assert_eq!(engine.policy_count(), 1);
        assert_eq!(
            engine.register_policy(1, validated_policy(TechniqueId(2))),
            Err(EngineError::HandleConflict)
        );
        assert_eq!(
            engine.policy(1).unwrap().programs()[0].technique,
            TechniqueId(1)
        );
    }

    #[test]
    fn disposal_is_exact_and_missing_handles_are_observable() {
        let mut engine = TextEngine::default();
        assert_eq!(
            engine.register_policy(0, validated_policy(TechniqueId(1))),
            Err(EngineError::InvalidHandle)
        );
        assert_eq!(engine.dispose_policy(1), Err(EngineError::PolicyMissing));
        engine
            .register_policy(1, validated_policy(TechniqueId(1)))
            .unwrap();
        assert_eq!(engine.dispose_policy(1), Ok(()));
        assert_eq!(engine.dispose_policy(1), Err(EngineError::PolicyMissing));
    }

    #[test]
    fn update_preparation_is_revisioned_and_commit_is_explicit() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();

        let first = engine.prepare_update(update(0, 0)).unwrap();
        assert_eq!(
            engine.session_revision(4).unwrap(),
            SessionRevision::default()
        );
        let first = engine.commit_update(first).unwrap();
        assert!(first.checkpoint);
        assert_eq!(first.required_base_revision, 0);
        assert_eq!(first.revision, SessionRevision { engine: 1, plan: 1 });

        let second = engine.prepare_update(update(1, 1)).unwrap();
        let second = engine.commit_update(second).unwrap();
        assert!(!second.checkpoint);
        assert_eq!(second.required_base_revision, 1);

        assert_eq!(
            engine.prepare_update(update(1, 2)),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(engine.session_count(), 1);
        assert_eq!(engine.dispose_session(4), Ok(()));
        assert_eq!(engine.dispose_session(4), Err(EngineError::SessionMissing));
    }

    fn validated_policy(technique: TechniqueId) -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            programs: vec![ProgramDescriptor {
                technique,
                variant: 0,
                id: ProgramId(1),
                f32_input_count: 1,
                u32_input_count: 0,
                capabilities: ProgramCapabilities::default(),
                buffers: vec![BufferSchema {
                    id: BufferId(1),
                    scalar: ScalarType::F32,
                    vector_width: 1,
                }],
                operations: vec![
                    Operation::LoadF32 {
                        target: 0,
                        field: 0,
                    },
                    Operation::StoreF32 {
                        source: 0,
                        buffer: BufferId(1),
                        lane: 0,
                    },
                ],
            }],
        })
        .unwrap()
    }

    fn update(expected_engine_revision: u32, consumed_plan_revision: u32) -> UpdateRequest {
        UpdateRequest {
            session_id: 4,
            expected_engine_revision,
            consumed_plan_revision,
            policy_handle: 9,
            limits: super::super::frame::UpdateLimits {
                max_clusters: 1,
                max_lines: 1,
                max_regions: 1,
                max_exclusions: 1,
                max_inline_objects: 1,
                max_slots_per_band: 1,
                max_output_bytes: 128,
            },
        }
    }
}
