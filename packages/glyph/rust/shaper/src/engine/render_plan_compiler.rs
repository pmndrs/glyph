//! Ordered retained render-plan compilation with one session placement buffer.

use super::{
    codec::{CapabilitySet, CapabilitySetId, CodecExecutionError, ValidatedCodec},
    ordered_plan::OrderedPlanCompiler,
    plan_error::PlanError,
    plan_input::{PlanInput, PlanInputError},
    render_plan::RenderPlanView,
    session_placement::{SessionPlacementCompiler, SessionPlacementError, SessionPlacementInput},
};

const CODEC_BUFFER_ID_LIMIT: u32 = 0x7fff_fffe;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderPlanCompilerError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    CapabilitySetMissing,
    ProgramMissing,
    InvalidInputShape,
    InvalidIdentity,
    InvalidResource,
    InvalidPlan,
    ArithmeticOverflow,
    Plan(PlanError),
}

impl From<PlanInputError> for RenderPlanCompilerError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
        }
    }
}

impl From<PlanError> for RenderPlanCompilerError {
    fn from(error: PlanError) -> Self {
        Self::Plan(error)
    }
}

impl From<SessionPlacementError> for RenderPlanCompilerError {
    fn from(error: SessionPlacementError) -> Self {
        match error {
            SessionPlacementError::AllocationFailed => Self::AllocationFailed,
            SessionPlacementError::AlreadyPrepared => Self::AlreadyPrepared,
            SessionPlacementError::InvalidInput => Self::InvalidPlan,
            SessionPlacementError::ArithmeticOverflow => Self::ArithmeticOverflow,
            SessionPlacementError::GenerationExhausted => Self::InvalidIdentity,
        }
    }
}

impl RenderPlanCompilerError {
    pub(crate) fn is_result_too_large(self) -> bool {
        match self {
            Self::AllocationFailed | Self::ArithmeticOverflow => true,
            Self::AlreadyPrepared
            | Self::NotPrepared
            | Self::CapabilitySetMissing
            | Self::ProgramMissing
            | Self::InvalidInputShape
            | Self::InvalidIdentity
            | Self::InvalidResource
            | Self::InvalidPlan => false,
            Self::Plan(error) => plan_result_too_large(error),
        }
    }
}

fn codec_result_too_large(error: CodecExecutionError) -> bool {
    match error {
        CodecExecutionError::OutputCapacity => true,
        CodecExecutionError::CapabilitySetMissing
        | CodecExecutionError::ProgramMissing
        | CodecExecutionError::InputFieldCount
        | CodecExecutionError::InputLength
        | CodecExecutionError::OutputBufferCount
        | CodecExecutionError::OutputSchema
        | CodecExecutionError::NonFiniteOutput => false,
    }
}

fn plan_result_too_large(error: PlanError) -> bool {
    match error {
        PlanError::AllocationFailed
        | PlanError::CapacityExceeded
        | PlanError::IdentifierExhausted
        | PlanError::ArithmeticOverflow => true,
        PlanError::AlreadyPrepared
        | PlanError::NotPrepared
        | PlanError::CapabilitySetMissing
        | PlanError::ProgramMissing
        | PlanError::InvalidInputShape
        | PlanError::InvalidIdentity
        | PlanError::DuplicateIdentity
        | PlanError::InvalidResource => false,
        PlanError::CodecExecution(error) => codec_result_too_large(error),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum PreparedStrategy {
    #[default]
    None,
    Empty,
    Ordered,
}

pub(crate) struct OwnedOutputScope<'a> {
    pub previous_revision: u32,
    pub scope: super::ordered_plan::RetainedOutputScope<'a>,
}

pub struct RenderPlanCompiler {
    ordered: OrderedPlanCompiler,
    session: SessionPlacementCompiler,
    prepared_strategy: PreparedStrategy,
    canonical_owner_revision: Option<u32>,
}

impl Default for RenderPlanCompiler {
    fn default() -> Self {
        Self {
            ordered: OrderedPlanCompiler::with_buffer_id_limit(CODEC_BUFFER_ID_LIMIT),
            session: SessionPlacementCompiler::default(),
            prepared_strategy: PreparedStrategy::None,
            canonical_owner_revision: None,
        }
    }
}

impl RenderPlanCompiler {
    pub(crate) fn requires_complete_placement_rows(
        &self,
        live_records: u32,
        checkpoint: bool,
    ) -> bool {
        self.session
            .requires_complete_rows(live_records, checkpoint)
    }

    pub(crate) fn prepare_reuse(&mut self) -> Result<(), RenderPlanCompilerError> {
        if self.prepared_strategy != PreparedStrategy::None {
            return Err(RenderPlanCompilerError::AlreadyPrepared);
        }
        self.session.prepare_reuse()?;
        self.prepared_strategy = PreparedStrategy::Empty;
        Ok(())
    }

    pub(crate) fn prepare_reorder(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        stable_ids: &[u32],
        publication_generation: u32,
    ) -> Result<bool, RenderPlanCompilerError> {
        if self.prepared_strategy != PreparedStrategy::None {
            return Err(RenderPlanCompilerError::AlreadyPrepared);
        }
        if !self.ordered.prepare_reorder(
            codec,
            capability_set,
            stable_ids,
            publication_generation,
        )? {
            return Ok(false);
        }
        self.session.prepare_reuse()?;
        self.prepared_strategy = PreparedStrategy::Ordered;
        Ok(true)
    }

    pub(crate) fn prepare_session(
        &mut self,
        input: SessionPlacementInput<'_>,
        capability: &CapabilitySet,
        publication_generation: u32,
        checkpoint: bool,
    ) -> Result<(), RenderPlanCompilerError> {
        self.session
            .prepare(input, capability, publication_generation, checkpoint)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: PlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) -> Result<(), RenderPlanCompilerError> {
        self.prepare_owned(
            codec,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            acknowledged_publication_generation,
            None,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_owned(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: PlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
        output_scope: Option<OwnedOutputScope<'_>>,
        bounds_changed: bool,
    ) -> Result<(), RenderPlanCompilerError> {
        if self.prepared_strategy != PreparedStrategy::None {
            return Err(RenderPlanCompilerError::AlreadyPrepared);
        }
        if publication_generation == 0
            || acknowledged_publication_generation >= publication_generation
        {
            return Err(RenderPlanCompilerError::InvalidIdentity);
        }
        if codec.capability_set(capability_set).is_none() {
            return Err(RenderPlanCompilerError::CapabilitySetMissing);
        }
        if input.glyphs.is_empty() && !self.ordered.has_state() {
            self.prepared_strategy = PreparedStrategy::Empty;
            return Ok(());
        }
        let placement = self.session.view();
        let bounds_changed = bounds_changed
            || !placement.patches.is_empty()
            || !placement.buffers.is_empty()
            || !placement.retirements.is_empty();
        self.ordered.prepare_scoped(
            codec,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            output_scope
                .filter(|scope| self.canonical_owner_revision == Some(scope.previous_revision))
                .map(|scope| scope.scope),
            bounds_changed,
        )?;
        self.prepared_strategy = PreparedStrategy::Ordered;
        Ok(())
    }

    pub fn plan_view(
        &self,
        codec_handle: u32,
        capability_set: CapabilitySetId,
        codec_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, RenderPlanCompilerError> {
        let mut view = match self.prepared_strategy {
            PreparedStrategy::None => Err(RenderPlanCompilerError::NotPrepared),
            PreparedStrategy::Empty => Ok(RenderPlanView {
                codec_handle,
                capability_set: capability_set.0,
                codec_fingerprint,
                ..RenderPlanView::default()
            }),
            PreparedStrategy::Ordered => self
                .ordered
                .plan_view(codec_handle, capability_set, codec_fingerprint)
                .map_err(Into::into),
        }?;
        let session = self.session.view();
        // Session storage is a draw binding too: replacement invalidates captured shader storage.
        view.retained_host_topology &= session.buffers.is_empty() && session.retirements.is_empty();
        view.session_buffers = session.buffers;
        view.session_patches = session.patches;
        view.session_retirements = session.retirements;
        view.session_payload = session.payload;
        Ok(view)
    }

    pub(crate) fn commit_owned(&mut self, revision: u32) -> Result<(), RenderPlanCompilerError> {
        self.commit()?;
        self.canonical_owner_revision = Some(revision);
        Ok(())
    }

    pub fn commit(&mut self) -> Result<(), RenderPlanCompilerError> {
        match self.prepared_strategy {
            PreparedStrategy::None => return Err(RenderPlanCompilerError::NotPrepared),
            PreparedStrategy::Empty => {}
            PreparedStrategy::Ordered => self.ordered.commit()?,
        }
        self.session.commit();
        self.canonical_owner_revision = None;
        self.prepared_strategy = PreparedStrategy::None;
        Ok(())
    }

    pub fn abort(&mut self) {
        match self.prepared_strategy {
            PreparedStrategy::Ordered => self.ordered.abort(),
            PreparedStrategy::None | PreparedStrategy::Empty => {}
        }
        self.session.abort();
        self.prepared_strategy = PreparedStrategy::None;
    }

    pub fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        self.session
            .buffer_bytes(id)
            .or_else(|| self.ordered.buffer_bytes(id))
    }

    #[cfg(test)]
    pub(crate) fn retained_binding_compilation_skips(&self) -> u32 {
        self.ordered.retained_binding_compilation_skips()
    }
}

#[cfg(test)]
mod tests {
    use alloc::vec;

    use super::*;
    use crate::engine::{
        codec::{
            BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE, BUFFER_USAGE_COPY_DST,
            BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CAP_ORDERED_DIRECT, CapabilitySet,
            CodecDescriptor, Operation, ProgramCapabilities, ProgramDescriptor, ProgramId,
            ScalarType, TechniqueId,
        },
        plan_input::PlanGlyph,
        render_plan::BUFFER_ORDERED_DIRECT,
    };

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const ORDERED: TechniqueId = TechniqueId(1);

    #[test]
    fn homogeneous_frames_delegate_without_allocating_merge_tables() {
        let codec = codec();
        let glyphs = [glyph(1, ORDERED, 0)];
        let x = [1.0];
        let mut compiler = RenderPlanCompiler::default();
        prepare(&mut compiler, &codec, &glyphs, &x, true, 1, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(compiler.prepared_strategy, PreparedStrategy::Ordered);
        assert_eq!(plan.buffers[0].strategy, BUFFER_ORDERED_DIRECT);
        assert_eq!(plan.draws.len(), 1);
    }

    #[test]
    fn accepted_session_translation_proves_bounds_dirt_after_abort() {
        use crate::engine::render_plan::SESSION_PLACEMENT_BUFFER_ID;
        use crate::engine::session_placement::SessionPlacementRow;
        let codec = codec();
        let original = [glyph(1, ORDERED, 0)];
        let mut shifted = original;
        shifted[0].inline_start -= 3.0;
        shifted[0].block_start += 11.0;
        let old_rows = [SessionPlacementRow {
            slot: 0,
            inline: 0.0,
            block: 0.0,
        }];
        let next_rows = [SessionPlacementRow {
            slot: 0,
            inline: -3.0,
            block: 11.0,
        }];
        fn input(glyphs: &[PlanGlyph]) -> PlanInput<'_> {
            PlanInput {
                glyphs,
                placement_slots: &[0],
                semantic_change_masks: &[0],
                f32_fields: &[&[1.0]],
                u32_fields: &[],
                order_independent: false,
            }
        }
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &old_rows,
                    placement_capacity: 1,
                },
                &capability(),
                1,
                true,
            )
            .unwrap();
        compiler
            .prepare_owned(
                &codec,
                CAPABILITY,
                input(&original),
                true,
                1,
                0,
                None,
                false,
            )
            .unwrap();
        compiler.commit_owned(1).unwrap();
        let accepted = compiler
            .buffer_bytes(SESSION_PLACEMENT_BUFFER_ID)
            .unwrap()
            .to_vec();
        let mut cold = RenderPlanCompiler::default();
        cold.prepare_session(
            SessionPlacementInput {
                placement_rows: &next_rows,
                placement_capacity: 1,
            },
            &capability(),
            2,
            true,
        )
        .unwrap();
        cold.prepare_owned(&codec, CAPABILITY, input(&shifted), true, 2, 1, None, false)
            .unwrap();
        let expected = cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap();
        let expected_primitives = expected.primitives.to_vec();
        let expected_draws = expected.draws.to_vec();
        cold.commit_owned(2).unwrap();
        for reject in [true, false] {
            compiler
                .prepare_session(
                    SessionPlacementInput {
                        placement_rows: &next_rows,
                        placement_capacity: 1,
                    },
                    &capability(),
                    2,
                    false,
                )
                .unwrap();
            compiler
                .prepare_owned(
                    &codec,
                    CAPABILITY,
                    input(&shifted),
                    false,
                    2,
                    1,
                    Some(OwnedOutputScope {
                        previous_revision: 1,
                        scope: super::super::ordered_plan::RetainedOutputScope::ChangedIntervals(
                            &[],
                        ),
                    }),
                    false,
                )
                .unwrap();
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();
            assert_eq!(plan.primitives, expected_primitives);
            assert_eq!(plan.draws, expected_draws);
            assert!(plan.patches.is_empty());
            assert!(plan.payload.is_empty());
            assert!(!plan.session_patches.is_empty());
            if reject {
                compiler.abort();
                assert_eq!(
                    compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID).unwrap(),
                    accepted
                );
            } else {
                compiler.commit_owned(2).unwrap();
            }
        }
        assert_eq!(
            compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID),
            cold.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID)
        );
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &next_rows,
                    placement_capacity: 1,
                },
                &capability(),
                3,
                false,
            )
            .unwrap();
        compiler
            .prepare_owned(
                &codec,
                CAPABILITY,
                input(&shifted),
                false,
                3,
                2,
                Some(OwnedOutputScope {
                    previous_revision: 2,
                    scope: super::super::ordered_plan::RetainedOutputScope::ChangedIntervals(&[]),
                }),
                false,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(plan.primitives.is_empty());
        assert!(plan.draws.is_empty());
        assert!(plan.session_patches.is_empty());
        compiler.commit_owned(3).unwrap();
        // Ordered preparation can fail after session preparation; abort must release that
        // pending state without changing accepted placement bytes or blocking a later prepare.
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &old_rows,
                    placement_capacity: 1,
                },
                &capability(),
                4,
                false,
            )
            .unwrap();
        assert!(matches!(
            compiler.prepare_owned(
                &codec,
                CAPABILITY,
                input(&original),
                false,
                0,
                3,
                None,
                false
            ),
            Err(RenderPlanCompilerError::InvalidIdentity)
        ));
        compiler.abort();
        assert_eq!(
            compiler.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID),
            cold.buffer_bytes(SESSION_PLACEMENT_BUFFER_ID)
        );
        compiler.prepare_reuse().unwrap();
        compiler.abort();
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &next_rows,
                    placement_capacity: 1,
                },
                &capability(),
                4,
                false,
            )
            .unwrap();
        compiler.abort();
    }

    #[test]
    fn acknowledged_ordered_state_can_publish_an_empty_reuse_transaction() {
        let codec = codec();
        let glyphs = [glyph(1, ORDERED, 0)];
        let x = [1.0];
        let mut compiler = RenderPlanCompiler::default();
        prepare(&mut compiler, &codec, &glyphs, &x, true, 1, 0);
        let buffer = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap()
            .buffers[0]
            .id;
        compiler.commit_owned(1).unwrap();
        assert_eq!(compiler.canonical_owner_revision, Some(1));

        compiler.prepare_reuse().unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(plan.buffers.is_empty());
        assert!(plan.patches.is_empty());
        compiler.abort();
        assert_eq!(compiler.canonical_owner_revision, Some(1));
        compiler.prepare_reuse().unwrap();
        compiler.commit_owned(2).unwrap();
        assert_eq!(compiler.canonical_owner_revision, Some(2));
        assert!(compiler.buffer_bytes(buffer).is_some());
        compiler.prepare_reuse().unwrap();
        compiler.commit().unwrap();
        assert_eq!(compiler.canonical_owner_revision, None);
    }

    #[test]
    fn empty_owner_commit_does_not_authorize_aborted_input_mappings() {
        let codec = codec();
        let mut compiler = RenderPlanCompiler::default();
        let mut control = RenderPlanCompiler::default();
        let initial: alloc::vec::Vec<_> = (1..=6)
            .map(|id| {
                let mut value = glyph(id, ORDERED, 0);
                value.resource_id += id % 2;
                value
            })
            .collect();
        let x = [1.0; 6];
        for owner in [&mut compiler, &mut control] {
            prepare(owner, &codec, &initial, &x, true, 1, 0);
            owner.commit_owned(1).unwrap();
        }
        let mut rejected = initial.clone();
        rejected.swap(0, 1);
        prepare(&mut compiler, &codec, &rejected, &x, true, 2, 1);
        compiler.abort();
        // Empty publications advance the owning Rust revision, but do not rebuild
        // the aborted ordered compiler's speculative input mappings.
        for owner in [&mut compiler, &mut control] {
            owner.prepare_reuse().unwrap();
            owner.commit_owned(2).unwrap();
        }
        let mut next = initial.clone();
        next[4].stable_id = 70;
        next[5].stable_id = 71;
        next[4].inline_extent = 10.0;
        let input = PlanInput {
            glyphs: &next,
            placement_slots: &[0; 6],
            semantic_change_masks: &[u16::MAX; 6],
            f32_fields: &[&x],
            u32_fields: &[],
            order_independent: false,
        };
        super::super::work_attribution::reset();
        compiler
            .prepare_owned(
                &codec,
                CAPABILITY,
                input,
                false,
                3,
                2,
                Some(OwnedOutputScope {
                    previous_revision: 2,
                    scope: super::super::ordered_plan::RetainedOutputScope::ReplaceTail {
                        unchanged_prefix: 4,
                    },
                }),
                false,
            )
            .unwrap();
        assert_eq!(
            super::super::work_attribution::snapshot().ordered_admission_visits,
            6
        );
        control
            .prepare(&codec, CAPABILITY, input, false, 3, 2)
            .unwrap();
        let actual = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        let expected = control
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(actual.resources, expected.resources);
        assert_eq!(actual.buffers, expected.buffers);
        assert_eq!(actual.primitives, expected.primitives);
        assert_eq!(actual.draws, expected.draws);
        let buffers: alloc::vec::Vec<_> = actual.buffers.iter().map(|buffer| buffer.id).collect();
        assert!(!buffers.is_empty());
        compiler.commit_owned(3).unwrap();
        control.commit_owned(3).unwrap();
        for buffer in buffers {
            assert_eq!(compiler.buffer_bytes(buffer), control.buffer_bytes(buffer));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare(
        compiler: &mut RenderPlanCompiler,
        codec: &ValidatedCodec,
        glyphs: &[PlanGlyph],
        x: &[f32],
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) {
        let placement_slots = vec![0; glyphs.len()];
        compiler
            .prepare(
                codec,
                CAPABILITY,
                PlanInput {
                    glyphs,
                    placement_slots: &placement_slots,
                    semantic_change_masks: &[],
                    f32_fields: &[x],
                    u32_fields: &[],
                    order_independent: false,
                },
                checkpoint,
                publication_generation,
                acknowledged_publication_generation,
            )
            .unwrap();
    }

    fn glyph(stable_id: u32, technique: TechniqueId, variant: u16) -> PlanGlyph {
        PlanGlyph {
            stable_id,
            content_revision: 1,
            technique,
            program_variant: variant,
            resource_id: technique.0 + 10,
            resource_generation: 1,
            resource_kind: 1,
            resource_reference: technique.0 + 90,
            semantic_id: 1,
            transform_id: 1,
            material_id: 1,
            clip_id: 0,
            depth_key: 0,
            inline_start: stable_id as f32,
            block_start: 0.0,
            inline_extent: 1.0,
            block_extent: 1.0,
        }
    }

    fn codec() -> ValidatedCodec {
        ValidatedCodec::new(CodecDescriptor {
            capability_sets: vec![capability()],
            programs: vec![program(ORDERED, 0, ProgramId(1))],
        })
        .unwrap()
    }

    fn capability() -> CapabilitySet {
        CapabilitySet {
            id: CAPABILITY,
            flags: CAP_ORDERED_DIRECT,
            max_buffer_bytes: 4096,
            update_alignment: 4,
            coalesce_gap_bytes: 0,
            range_call_penalty_bytes: 0,
            max_buffers_per_draw: 2,
            max_resources_per_draw: 1,
            max_indirect_draws: 0,
            fragmentation_budget: 8,
            whole_buffer_threshold_basis_points: 10_000,
        }
    }

    fn program(technique: TechniqueId, variant: u16, id: ProgramId) -> ProgramDescriptor {
        ProgramDescriptor {
            primitive_kind: 1,
            technique,
            variant,
            id,
            capability_set: CapabilitySetId(0),
            resource_kind_mask: 1,
            semantic_view_mask: 0,
            storage_key_mask: BATCH_TECHNIQUE
                | BATCH_PROGRAM
                | BATCH_RESOURCE
                | crate::engine::codec::BATCH_DEPTH,
            draw_key_mask: BATCH_TECHNIQUE
                | BATCH_PROGRAM
                | BATCH_RESOURCE
                | crate::engine::codec::BATCH_DEPTH
                | BATCH_ORDER
                | crate::engine::codec::BATCH_TRANSFORM,
            f32_input_count: 1,
            u32_input_count: 0,
            inputs: vec![crate::engine::codec::InputSource::semantic(0)],
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
        }
    }
}
