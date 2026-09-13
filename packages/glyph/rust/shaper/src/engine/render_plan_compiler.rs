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
    UnsupportedStrategy,
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
            | Self::UnsupportedStrategy
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
        | PlanError::UnsupportedStrategy
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

pub struct RenderPlanCompiler {
    ordered: OrderedPlanCompiler,
    session: SessionPlacementCompiler,
    prepared_strategy: PreparedStrategy,
}

impl Default for RenderPlanCompiler {
    fn default() -> Self {
        Self {
            ordered: OrderedPlanCompiler::with_buffer_id_limit(CODEC_BUFFER_ID_LIMIT),
            session: SessionPlacementCompiler::default(),
            prepared_strategy: PreparedStrategy::None,
        }
    }
}

impl RenderPlanCompiler {
    pub(crate) fn prepare_reuse(&mut self) -> Result<(), RenderPlanCompilerError> {
        if self.prepared_strategy != PreparedStrategy::None {
            return Err(RenderPlanCompilerError::AlreadyPrepared);
        }
        self.session.prepare_reuse()?;
        self.prepared_strategy = PreparedStrategy::Empty;
        Ok(())
    }

    pub(crate) fn prepare_session(
        &mut self,
        input: SessionPlacementInput<'_>,
        capability: &CapabilitySet,
        publication_generation: u32,
        checkpoint: bool,
    ) -> Result<(), RenderPlanCompilerError> {
        if self.prepared_strategy == PreparedStrategy::None {
            return Err(RenderPlanCompilerError::NotPrepared);
        }
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
        self.ordered.prepare(
            codec,
            capability_set,
            input,
            checkpoint,
            publication_generation,
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
        view.session_buffers = session.buffers;
        view.session_patches = session.patches;
        view.session_retirements = session.retirements;
        view.session_payload = session.payload;
        Ok(view)
    }

    pub fn commit(&mut self) -> Result<(), RenderPlanCompilerError> {
        match self.prepared_strategy {
            PreparedStrategy::None => return Err(RenderPlanCompilerError::NotPrepared),
            PreparedStrategy::Empty => {}
            PreparedStrategy::Ordered => self.ordered.commit()?,
        }
        self.session.commit();
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
        compiler.commit().unwrap();

        compiler.prepare_reuse().unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(plan.buffers.is_empty());
        assert!(plan.patches.is_empty());
        compiler.commit().unwrap();
        assert!(compiler.buffer_bytes(buffer).is_some());
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
