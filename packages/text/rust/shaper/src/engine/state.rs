use alloc::collections::BTreeMap;

use super::{
    frame::{CommittedUpdate, PreparedUpdate, SessionRevision, UpdateRequest},
    plan_input::PlanInput,
    policy::{CapabilitySetId, ValidatedPolicy},
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
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
    ResultTooLarge,
}

#[derive(Default)]
pub struct TextEngine {
    policies: BTreeMap<u32, ValidatedPolicy>,
    sessions: BTreeMap<u32, EngineSession>,
}

#[derive(Default)]
struct EngineSession {
    revision: SessionRevision,
    acknowledged_publication_generation: u32,
    policy_binding: Option<PolicyBinding>,
    plan: RenderPlanCompiler,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PolicyBinding {
    handle: u32,
    fingerprint: u64,
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
        &mut self,
        request: UpdateRequest,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let policy = self
            .policies
            .get(&request.policy_handle)
            .ok_or(EngineError::PolicyMissing)?;
        if policy
            .capability_set(CapabilitySetId(request.capability_set))
            .is_none()
        {
            return Err(EngineError::InvalidRequest);
        }
        let policy_fingerprint = policy.fingerprint();
        let session = self
            .sessions
            .get_mut(&request.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.policy_binding.is_some_and(|binding| {
            binding.handle != request.policy_handle || binding.fingerprint != policy_fingerprint
        }) {
            return Err(EngineError::InvalidRequest);
        }
        if request.expected_engine_revision != session.revision.engine
            || request.consumed_plan_revision > session.revision.plan
            || publication_generation == 0
            || request.acknowledged_publication_generation
                < session.acknowledged_publication_generation
            || request.acknowledged_publication_generation >= publication_generation
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
        session.acknowledged_publication_generation = request.acknowledged_publication_generation;
        session
            .plan
            .prepare(
                policy,
                CapabilitySetId(request.capability_set),
                PlanInput {
                    glyphs: &[],
                    f32_fields: &[],
                    u32_fields: &[],
                },
                checkpoint,
                publication_generation,
                request.acknowledged_publication_generation,
            )
            .map_err(plan_error)?;
        Ok(PreparedUpdate {
            session_id: request.session_id,
            previous: session.revision,
            next,
            required_base_revision: if checkpoint { 0 } else { session.revision.plan },
            checkpoint,
            policy_handle: request.policy_handle,
            capability_set: request.capability_set,
            policy_fingerprint,
        })
    }

    pub(crate) fn prepared_plan(
        &self,
        prepared: PreparedUpdate,
    ) -> Result<RenderPlanView<'_>, EngineError> {
        let session = self
            .sessions
            .get(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session
            .plan
            .plan_view(
                prepared.policy_handle,
                CapabilitySetId(prepared.capability_set),
                prepared.policy_fingerprint,
            )
            .map_err(plan_error)
    }

    pub(crate) fn abort_update(&mut self, prepared: PreparedUpdate) -> Result<(), EngineError> {
        let session = self
            .sessions
            .get_mut(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session.plan.abort();
        Ok(())
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
        session.plan.commit().map_err(plan_error)?;
        session.policy_binding = Some(PolicyBinding {
            handle: prepared.policy_handle,
            fingerprint: prepared.policy_fingerprint,
        });
        session.revision = prepared.next;
        Ok(CommittedUpdate {
            session_id: prepared.session_id,
            revision: prepared.next,
            required_base_revision: prepared.required_base_revision,
            checkpoint: prepared.checkpoint,
        })
    }
}

fn plan_error(error: RenderPlanCompilerError) -> EngineError {
    if error.is_result_too_large() {
        EngineError::ResultTooLarge
    } else {
        EngineError::InvalidRequest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::policy::{
        ALLOCATION_ORDERED_DIRECT, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE,
        BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CAP_ORDERED_DIRECT,
        CapabilitySet, Operation, PolicyDescriptor, ProgramCapabilities, ProgramDescriptor,
        ProgramId, ScalarType, TechniqueId,
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

        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        let first_plan = engine.prepared_plan(first).unwrap();
        assert_eq!(first_plan.policy_handle, 9);
        assert_eq!(first_plan.capability_set, 1);
        assert_eq!(
            engine.session_revision(4).unwrap(),
            SessionRevision::default()
        );
        let first = engine.commit_update(first).unwrap();
        assert!(first.checkpoint);
        assert_eq!(first.required_base_revision, 0);
        assert_eq!(first.revision, SessionRevision { engine: 1, plan: 1 });

        let second = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        let second = engine.commit_update(second).unwrap();
        assert!(!second.checkpoint);
        assert_eq!(second.required_base_revision, 1);

        assert_eq!(
            engine.prepare_update(update(1, 2, 1), 3),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(engine.session_count(), 1);
        assert_eq!(engine.dispose_session(4), Ok(()));
        assert_eq!(engine.dispose_session(4), Err(EngineError::SessionMissing));
    }

    #[test]
    fn update_rejects_a_capability_set_outside_the_registered_policy() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        let mut request = update(0, 0, 0);
        request.capability_set = 2;
        assert_eq!(
            engine.prepare_update(request, 1),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            engine.session_revision(4).unwrap(),
            SessionRevision::default()
        );
    }

    #[test]
    fn renderer_fence_acknowledgment_is_monotonic_and_cannot_name_the_pending_publication() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(first).unwrap();
        let second = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        engine.commit_update(second).unwrap();

        assert_eq!(
            engine.prepare_update(update(2, 2, 3), 3),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(
            engine.prepare_update(update(2, 2, 0), 3),
            Err(EngineError::RevisionConflict)
        );
    }

    #[test]
    fn aborting_a_prepared_plan_preserves_revisions_and_allows_retry() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        let prepared = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.abort_update(prepared).unwrap();
        assert_eq!(
            engine.session_revision(4).unwrap(),
            SessionRevision::default()
        );
        let retry = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(retry).unwrap();
    }

    #[test]
    fn a_committed_session_rejects_rebinding_its_policy_identity() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(first).unwrap();

        engine.dispose_policy(9).unwrap();
        engine
            .register_policy(9, validated_policy(TechniqueId(2)))
            .unwrap();
        assert_eq!(
            engine.prepare_update(update(1, 1, 1), 2),
            Err(EngineError::InvalidRequest)
        );
    }

    fn validated_policy(technique: TechniqueId) -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CapabilitySetId(1),
                flags: CAP_ORDERED_DIRECT,
                max_buffer_bytes: 1024,
                update_alignment: 4,
                coalesce_gap_bytes: 0,
                range_call_penalty_bytes: 0,
                max_buffers_per_draw: 1,
                max_resources_per_draw: 1,
                max_indirect_draws: 0,
                fragmentation_budget: 1,
                whole_buffer_threshold_basis_points: 10_000,
            }],
            programs: vec![ProgramDescriptor {
                technique,
                variant: 0,
                id: ProgramId(1),
                capability_set: CapabilitySetId(0),
                resource_kind_mask: 1,
                semantic_view_mask: 0,
                storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
                draw_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE | BATCH_ORDER,
                allocation_strategy: ALLOCATION_ORDERED_DIRECT,
                f32_input_count: 1,
                u32_input_count: 0,
                capabilities: ProgramCapabilities::default(),
                buffers: vec![BufferSchema::packed(
                    BufferId(1),
                    ScalarType::F32,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                )],
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

    fn update(
        expected_engine_revision: u32,
        consumed_plan_revision: u32,
        acknowledged_publication_generation: u32,
    ) -> UpdateRequest {
        UpdateRequest {
            session_id: 4,
            expected_engine_revision,
            consumed_plan_revision,
            acknowledged_publication_generation,
            policy_handle: 9,
            capability_set: 1,
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
