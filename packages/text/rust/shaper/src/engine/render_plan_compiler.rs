//! Allocation-strategy dispatcher for retained render-plan compilation.
//!
//! Homogeneous frames delegate directly to one compiler. Mixed frames let both compilers filter
//! the same borrowed semantic inputs, then merge only renderer-facing plan records. No glyph or
//! policy input is copied into a strategy-specific partition.

use alloc::vec::Vec;

use super::{
    ordered_plan::{OrderedPlanCompiler, OrderedPlanError},
    plan_input::{PlanInput, PlanInputError, validate_input},
    policy::{
        ALLOCATION_ORDERED_DIRECT, ALLOCATION_STABLE_INDIRECT, CapabilitySetId,
        PolicyExecutionError, ValidatedPolicy,
    },
    render_plan::{
        BufferRecord, DrawRecord, PATCH_WRITE, PatchRecord, PrimitiveRecord,
        RESOURCE_ACTION_RETAIN, RESOURCE_ACTION_UPDATE, RETIRE_RESOURCE, RenderPlanView,
        ResourceRecord, RetirementRecord,
    },
    stable_plan::{StablePlanCompiler, StablePlanError},
};

const ORDERED_BUFFER_ID_LIMIT: u32 = 0x7fff_ffff;
const STABLE_BUFFER_ID_FLOOR: u32 = ORDERED_BUFFER_ID_LIMIT;

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
    Ordered(OrderedPlanError),
    Stable(StablePlanError),
}

impl From<PlanInputError> for RenderPlanCompilerError {
    fn from(error: PlanInputError) -> Self {
        match error {
            PlanInputError::InvalidShape => Self::InvalidInputShape,
            PlanInputError::InvalidIdentity => Self::InvalidIdentity,
            PlanInputError::InvalidResource => Self::InvalidResource,
        }
    }
}

impl From<OrderedPlanError> for RenderPlanCompilerError {
    fn from(error: OrderedPlanError) -> Self {
        Self::Ordered(error)
    }
}

impl From<StablePlanError> for RenderPlanCompilerError {
    fn from(error: StablePlanError) -> Self {
        Self::Stable(error)
    }
}

impl RenderPlanCompilerError {
    pub(crate) fn is_result_too_large(self) -> bool {
        match self {
            Self::AllocationFailed | Self::ArithmeticOverflow => true,
            Self::Ordered(error) => matches!(
                error,
                OrderedPlanError::AllocationFailed
                    | OrderedPlanError::CapacityExceeded
                    | OrderedPlanError::IdentifierExhausted
                    | OrderedPlanError::ArithmeticOverflow
                    | OrderedPlanError::PolicyExecution(PolicyExecutionError::OutputCapacity)
            ),
            Self::Stable(error) => matches!(
                error,
                StablePlanError::AllocationFailed
                    | StablePlanError::CapacityExceeded
                    | StablePlanError::IdentifierExhausted
                    | StablePlanError::ArithmeticOverflow
                    | StablePlanError::PolicyExecution(PolicyExecutionError::OutputCapacity)
            ),
            _ => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum PreparedStrategy {
    #[default]
    None,
    Empty,
    Ordered,
    Stable,
    Mixed,
}

pub struct RenderPlanCompiler {
    ordered: OrderedPlanCompiler,
    stable: StablePlanCompiler,
    resources: Vec<ResourceRecord>,
    buffers: Vec<BufferRecord>,
    patches: Vec<PatchRecord>,
    primitives: Vec<PrimitiveRecord>,
    draws: Vec<DrawRecord>,
    retirements: Vec<RetirementRecord>,
    payload: Vec<u8>,
    prepared_strategy: PreparedStrategy,
}

impl Default for RenderPlanCompiler {
    fn default() -> Self {
        Self {
            ordered: OrderedPlanCompiler::with_buffer_id_limit(ORDERED_BUFFER_ID_LIMIT),
            stable: StablePlanCompiler::with_buffer_id_floor(STABLE_BUFFER_ID_FLOOR),
            resources: Vec::new(),
            buffers: Vec::new(),
            patches: Vec::new(),
            primitives: Vec::new(),
            draws: Vec::new(),
            retirements: Vec::new(),
            payload: Vec::new(),
            prepared_strategy: PreparedStrategy::None,
        }
    }
}

impl RenderPlanCompiler {
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        policy: &ValidatedPolicy,
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
        if policy.capability_set(capability_set).is_none() {
            return Err(RenderPlanCompilerError::CapabilitySetMissing);
        }
        validate_input(input)?;
        self.clear_merged_plan();

        let mut ordered_input = false;
        let mut stable_input = false;
        for glyph in input.glyphs {
            let program = policy
                .program(capability_set, glyph.technique, glyph.program_variant)
                .ok_or(RenderPlanCompilerError::ProgramMissing)?;
            match program.allocation_strategy {
                ALLOCATION_ORDERED_DIRECT => ordered_input = true,
                ALLOCATION_STABLE_INDIRECT => stable_input = true,
                _ => return Err(RenderPlanCompilerError::UnsupportedStrategy),
            }
        }

        let prepare_ordered = ordered_input || self.ordered.has_state();
        let prepare_stable = stable_input || self.stable.has_state();
        match (prepare_ordered, prepare_stable) {
            (false, false) => {
                self.prepared_strategy = PreparedStrategy::Empty;
                Ok(())
            }
            (true, false) => {
                self.ordered.prepare(
                    policy,
                    capability_set,
                    input,
                    checkpoint,
                    publication_generation,
                )?;
                self.prepared_strategy = PreparedStrategy::Ordered;
                Ok(())
            }
            (false, true) => {
                self.stable.prepare(
                    policy,
                    capability_set,
                    input,
                    checkpoint,
                    publication_generation,
                    acknowledged_publication_generation,
                )?;
                self.prepared_strategy = PreparedStrategy::Stable;
                Ok(())
            }
            (true, true) => self.prepare_mixed(
                policy,
                capability_set,
                input,
                checkpoint,
                publication_generation,
                acknowledged_publication_generation,
            ),
        }
    }

    pub fn plan_view(
        &self,
        policy_handle: u32,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<RenderPlanView<'_>, RenderPlanCompilerError> {
        match self.prepared_strategy {
            PreparedStrategy::None => Err(RenderPlanCompilerError::NotPrepared),
            PreparedStrategy::Empty => Ok(RenderPlanView {
                policy_handle,
                capability_set: capability_set.0,
                policy_fingerprint,
                ..RenderPlanView::default()
            }),
            PreparedStrategy::Ordered => self
                .ordered
                .plan_view(policy_handle, capability_set, policy_fingerprint)
                .map_err(Into::into),
            PreparedStrategy::Stable => self
                .stable
                .plan_view(policy_handle, capability_set, policy_fingerprint)
                .map_err(Into::into),
            PreparedStrategy::Mixed => Ok(RenderPlanView {
                policy_handle,
                capability_set: capability_set.0,
                policy_fingerprint,
                resources: &self.resources,
                buffers: &self.buffers,
                patches: &self.patches,
                primitives: &self.primitives,
                draws: &self.draws,
                retirements: &self.retirements,
                payload: &self.payload,
                ..RenderPlanView::default()
            }),
        }
    }

    pub fn commit(&mut self) -> Result<(), RenderPlanCompilerError> {
        match self.prepared_strategy {
            PreparedStrategy::None => return Err(RenderPlanCompilerError::NotPrepared),
            PreparedStrategy::Empty => {}
            PreparedStrategy::Ordered => self.ordered.commit()?,
            PreparedStrategy::Stable => self.stable.commit()?,
            PreparedStrategy::Mixed => {
                self.ordered.commit()?;
                self.stable.commit()?;
            }
        }
        self.prepared_strategy = PreparedStrategy::None;
        Ok(())
    }

    pub fn abort(&mut self) {
        match self.prepared_strategy {
            PreparedStrategy::Ordered => self.ordered.abort(),
            PreparedStrategy::Stable => self.stable.abort(),
            PreparedStrategy::Mixed => {
                self.ordered.abort();
                self.stable.abort();
            }
            PreparedStrategy::None | PreparedStrategy::Empty => {}
        }
        self.prepared_strategy = PreparedStrategy::None;
    }

    pub fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        if id <= ORDERED_BUFFER_ID_LIMIT {
            self.ordered.buffer_bytes(id)
        } else {
            self.stable.buffer_bytes(id)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_mixed(
        &mut self,
        policy: &ValidatedPolicy,
        capability_set: CapabilitySetId,
        input: PlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) -> Result<(), RenderPlanCompilerError> {
        if let Err(error) = self.ordered.prepare_filtered(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
        ) {
            self.ordered.abort();
            return Err(error.into());
        }
        if let Err(error) = self.stable.prepare_filtered(
            policy,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            acknowledged_publication_generation,
        ) {
            self.ordered.abort();
            self.stable.abort();
            return Err(error.into());
        }
        if let Err(error) = self.merge_prepared(capability_set, policy.fingerprint()) {
            self.ordered.abort();
            self.stable.abort();
            return Err(error);
        }
        self.prepared_strategy = PreparedStrategy::Mixed;
        Ok(())
    }

    fn merge_prepared(
        &mut self,
        capability_set: CapabilitySetId,
        policy_fingerprint: u64,
    ) -> Result<(), RenderPlanCompilerError> {
        let publish_bindings =
            self.ordered.publishes_bindings() || self.stable.publishes_bindings();
        if !publish_bindings {
            return Ok(());
        }
        let ordered = self
            .ordered
            .plan_view_forced(0, capability_set, policy_fingerprint)?;
        let stable = self
            .stable
            .plan_view_forced(0, capability_set, policy_fingerprint)?;

        append_resources(&mut self.resources, ordered.resources)?;
        append_resources(&mut self.resources, stable.resources)?;
        append_buffers(&mut self.buffers, ordered.buffers)?;
        let stable_buffer_base = self.buffers.len();
        append_buffers(&mut self.buffers, stable.buffers)?;
        append_patches(
            &mut self.patches,
            &mut self.payload,
            ordered.patches,
            ordered.payload,
        )?;
        append_patches(
            &mut self.patches,
            &mut self.payload,
            stable.patches,
            stable.payload,
        )?;
        append_retirements(&mut self.retirements, ordered.retirements)?;
        append_retirements(&mut self.retirements, stable.retirements)?;
        reconcile_live_resource_retirements(&mut self.resources, &mut self.retirements);
        merge_draws(
            &mut self.primitives,
            &mut self.draws,
            &self.resources,
            ordered,
            stable,
            stable_buffer_base,
        )?;
        Ok(())
    }

    fn clear_merged_plan(&mut self) {
        self.resources.clear();
        self.buffers.clear();
        self.patches.clear();
        self.primitives.clear();
        self.draws.clear();
        self.retirements.clear();
        self.payload.clear();
    }
}

fn append_resources(
    destination: &mut Vec<ResourceRecord>,
    source: &[ResourceRecord],
) -> Result<(), RenderPlanCompilerError> {
    reserve(destination, source.len())?;
    for &resource in source {
        if let Some(existing) = destination.iter_mut().find(|existing| {
            existing.id == resource.id && existing.generation == resource.generation
        }) {
            if !same_resource(*existing, resource) {
                return Err(RenderPlanCompilerError::InvalidResource);
            }
            existing.action = merge_resource_action(existing.action, resource.action);
        } else {
            destination.push(resource);
        }
    }
    Ok(())
}

fn same_resource(left: ResourceRecord, right: ResourceRecord) -> bool {
    ResourceRecord { action: 0, ..left } == ResourceRecord { action: 0, ..right }
}

fn merge_resource_action(left: u16, right: u16) -> u16 {
    if left == RESOURCE_ACTION_UPDATE || right == RESOURCE_ACTION_UPDATE {
        RESOURCE_ACTION_UPDATE
    } else if left == RESOURCE_ACTION_RETAIN || right == RESOURCE_ACTION_RETAIN {
        RESOURCE_ACTION_RETAIN
    } else {
        left
    }
}

fn append_buffers(
    destination: &mut Vec<BufferRecord>,
    source: &[BufferRecord],
) -> Result<(), RenderPlanCompilerError> {
    reserve(destination, source.len())?;
    for &buffer in source {
        if destination.iter().any(|existing| existing.id == buffer.id) {
            return Err(RenderPlanCompilerError::InvalidPlan);
        }
        destination.push(buffer);
    }
    Ok(())
}

fn append_patches(
    destination: &mut Vec<PatchRecord>,
    payload: &mut Vec<u8>,
    source: &[PatchRecord],
    source_payload: &[u8],
) -> Result<(), RenderPlanCompilerError> {
    let payload_base =
        u32::try_from(payload.len()).map_err(|_| RenderPlanCompilerError::ArithmeticOverflow)?;
    reserve(payload, source_payload.len())?;
    payload.extend_from_slice(source_payload);
    reserve(destination, source.len())?;
    for &patch in source {
        let mut rebased = patch;
        if patch.opcode == PATCH_WRITE {
            rebased.payload_start = patch
                .payload_start
                .checked_add(payload_base)
                .ok_or(RenderPlanCompilerError::ArithmeticOverflow)?;
        }
        destination.push(rebased);
    }
    Ok(())
}

fn append_retirements(
    destination: &mut Vec<RetirementRecord>,
    source: &[RetirementRecord],
) -> Result<(), RenderPlanCompilerError> {
    reserve(destination, source.len())?;
    for &retirement in source {
        if !destination.contains(&retirement) {
            destination.push(retirement);
        }
    }
    Ok(())
}

fn reconcile_live_resource_retirements(
    resources: &mut [ResourceRecord],
    retirements: &mut Vec<RetirementRecord>,
) {
    for resource in &mut *resources {
        let remained_live = retirements.iter().any(|retirement| {
            retirement.kind == RETIRE_RESOURCE
                && retirement.id == resource.id
                && retirement.generation == resource.generation
        });
        if remained_live && resource.action != RESOURCE_ACTION_UPDATE {
            resource.action = RESOURCE_ACTION_RETAIN;
        }
    }
    retirements.retain(|retirement| {
        retirement.kind != RETIRE_RESOURCE
            || !resources.iter().any(|resource| {
                resource.id == retirement.id && resource.generation == retirement.generation
            })
    });
}

fn merge_draws(
    primitives: &mut Vec<PrimitiveRecord>,
    draws: &mut Vec<DrawRecord>,
    resources: &[ResourceRecord],
    ordered: RenderPlanView<'_>,
    stable: RenderPlanView<'_>,
    stable_buffer_base: usize,
) -> Result<(), RenderPlanCompilerError> {
    reserve(
        primitives,
        ordered.primitives.len() + stable.primitives.len(),
    )?;
    reserve(draws, ordered.draws.len() + stable.draws.len())?;
    let mut ordered_index = 0_usize;
    let mut stable_index = 0_usize;
    while ordered_index < ordered.draws.len() || stable_index < stable.draws.len() {
        let take_ordered = match (
            ordered.draws.get(ordered_index),
            stable.draws.get(stable_index),
        ) {
            (Some(left), Some(right)) if left.order_token == right.order_token => {
                return Err(RenderPlanCompilerError::InvalidPlan);
            }
            (Some(left), Some(right)) => left.order_token < right.order_token,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        if take_ordered {
            append_draw(primitives, draws, resources, ordered, ordered_index, 0)?;
            ordered_index += 1;
        } else {
            append_draw(
                primitives,
                draws,
                resources,
                stable,
                stable_index,
                stable_buffer_base,
            )?;
            stable_index += 1;
        }
    }
    Ok(())
}

fn append_draw(
    primitives: &mut Vec<PrimitiveRecord>,
    draws: &mut Vec<DrawRecord>,
    resources: &[ResourceRecord],
    source: RenderPlanView<'_>,
    draw_index: usize,
    buffer_base: usize,
) -> Result<(), RenderPlanCompilerError> {
    let source_draw = *source
        .draws
        .get(draw_index)
        .ok_or(RenderPlanCompilerError::InvalidPlan)?;
    if source_draw.resource_count != 1 {
        return Err(RenderPlanCompilerError::InvalidPlan);
    }
    let source_resource = source
        .resources
        .get(source_draw.resource_start as usize)
        .ok_or(RenderPlanCompilerError::InvalidPlan)?;
    let resource_start = resources
        .iter()
        .position(|resource| {
            resource.id == source_resource.id && resource.generation == source_resource.generation
        })
        .ok_or(RenderPlanCompilerError::InvalidResource)?;
    let primitive_start = source_draw.primitive_start as usize;
    let primitive_end = primitive_start
        .checked_add(source_draw.primitive_count as usize)
        .ok_or(RenderPlanCompilerError::ArithmeticOverflow)?;
    let source_primitives = source
        .primitives
        .get(primitive_start..primitive_end)
        .ok_or(RenderPlanCompilerError::InvalidPlan)?;
    let destination_primitive_start =
        u32::try_from(primitives.len()).map_err(|_| RenderPlanCompilerError::ArithmeticOverflow)?;
    primitives.extend_from_slice(source_primitives);
    let buffer_start = buffer_base
        .checked_add(source_draw.buffer_start as usize)
        .ok_or(RenderPlanCompilerError::ArithmeticOverflow)?;
    let buffer_end = buffer_start
        .checked_add(source_draw.buffer_count as usize)
        .ok_or(RenderPlanCompilerError::ArithmeticOverflow)?;
    let source_buffer_end = source_draw
        .buffer_start
        .checked_add(source_draw.buffer_count)
        .ok_or(RenderPlanCompilerError::ArithmeticOverflow)?;
    if source_buffer_end as usize > source.buffers.len()
        || buffer_end > buffer_base + source.buffers.len()
    {
        return Err(RenderPlanCompilerError::InvalidPlan);
    }
    draws.push(DrawRecord {
        primitive_start: destination_primitive_start,
        buffer_start: u32::try_from(buffer_start)
            .map_err(|_| RenderPlanCompilerError::ArithmeticOverflow)?,
        resource_start: u32::try_from(resource_start)
            .map_err(|_| RenderPlanCompilerError::ArithmeticOverflow)?,
        ..source_draw
    });
    Ok(())
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), RenderPlanCompilerError> {
    values
        .try_reserve(additional)
        .map_err(|_| RenderPlanCompilerError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use alloc::{vec, vec::Vec};

    use super::*;
    use crate::engine::{
        plan_input::PlanGlyph,
        policy::{
            BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE, BUFFER_USAGE_COPY_DST,
            BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CAP_ORDERED_DIRECT, CAP_STABLE_INDIRECT,
            CapabilitySet, Operation, PolicyDescriptor, ProgramCapabilities, ProgramDescriptor,
            ProgramId, ScalarType, TechniqueId,
        },
        render_plan::{BUFFER_ORDERED_DIRECT, BUFFER_STABLE_INDIRECT},
        render_plan_wire::plan_layout,
    };

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const ORDERED: TechniqueId = TechniqueId(1);
    const STABLE: TechniqueId = TechniqueId(2);

    #[test]
    fn homogeneous_frames_delegate_without_allocating_merge_tables() {
        let policy = policy();
        let glyphs = [glyph(1, ORDERED, 0)];
        let x = [1.0];
        let mut compiler = RenderPlanCompiler::default();
        prepare(&mut compiler, &policy, &glyphs, &x, true, 1, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(compiler.prepared_strategy, PreparedStrategy::Ordered);
        assert!(compiler.resources.is_empty());
        assert_eq!(plan.buffers[0].strategy, BUFFER_ORDERED_DIRECT);
        assert_eq!(plan.draws.len(), 1);
    }

    #[test]
    fn mixed_frames_preserve_global_draw_order_and_disjoint_buffer_namespaces() {
        let policy = policy();
        let glyphs = [
            glyph(1, ORDERED, 0),
            glyph(2, STABLE, 0),
            glyph(3, ORDERED, 0),
            glyph(4, STABLE, 0),
        ];
        let x = [1.0, 2.0, 3.0, 4.0];
        let mut compiler = RenderPlanCompiler::default();
        prepare(&mut compiler, &policy, &glyphs, &x, true, 1, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(compiler.prepared_strategy, PreparedStrategy::Mixed);
        assert_eq!(plan.draws.len(), 4);
        assert_eq!(
            plan.draws
                .iter()
                .map(|draw| draw.order_token)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
        assert!(
            plan.buffers
                .iter()
                .any(|buffer| buffer.strategy == BUFFER_ORDERED_DIRECT
                    && buffer.id <= ORDERED_BUFFER_ID_LIMIT)
        );
        assert!(
            plan.buffers
                .iter()
                .filter(|buffer| buffer.strategy == BUFFER_STABLE_INDIRECT)
                .all(|buffer| buffer.id > ORDERED_BUFFER_ID_LIMIT)
        );
        assert_eq!(plan.resources.len(), 2);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn changing_allocation_strategy_keeps_a_shared_resource_live() {
        let policy = policy_with_shared_technique_variants();
        let mut compiler = RenderPlanCompiler::default();
        let first = [glyph(1, ORDERED, 1)];
        prepare(&mut compiler, &policy, &first, &[1.0], true, 1, 0);
        compiler.commit().unwrap();

        let second = [glyph(1, ORDERED, 0)];
        prepare(&mut compiler, &policy, &second, &[1.0], false, 2, 0);
        let plan = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();

        assert_eq!(compiler.prepared_strategy, PreparedStrategy::Mixed);
        assert_eq!(plan.resources.len(), 1);
        assert_eq!(plan.resources[0].action, RESOURCE_ACTION_RETAIN);
        assert!(!plan.retirements.iter().any(|retirement| {
            retirement.kind == RETIRE_RESOURCE
                && retirement.id == plan.resources[0].id
                && retirement.generation == plan.resources[0].generation
        }));
    }

    #[test]
    fn repeated_mixed_updates_publish_no_op_frames_and_settle_merge_capacity() {
        let policy = policy();
        let mut glyphs = [
            glyph(1, ORDERED, 0),
            glyph(2, STABLE, 0),
            glyph(3, ORDERED, 0),
            glyph(4, STABLE, 0),
        ];
        let mut compiler = RenderPlanCompiler::default();
        prepare(
            &mut compiler,
            &policy,
            &glyphs,
            &[1.0, 2.0, 3.0, 4.0],
            true,
            1,
            0,
        );
        compiler.commit().unwrap();

        prepare(
            &mut compiler,
            &policy,
            &glyphs,
            &[1.0, 2.0, 3.0, 4.0],
            false,
            2,
            0,
        );
        let no_op = compiler
            .plan_view(7, CAPABILITY, policy.fingerprint())
            .unwrap();
        assert!(no_op.resources.is_empty());
        assert!(no_op.buffers.is_empty());
        assert!(no_op.patches.is_empty());
        assert!(no_op.primitives.is_empty());
        assert!(no_op.draws.is_empty());
        assert!(no_op.retirements.is_empty());
        assert!(no_op.payload.is_empty());
        compiler.commit().unwrap();

        glyphs[1].content_revision = 2;
        prepare(
            &mut compiler,
            &policy,
            &glyphs,
            &[1.0, 20.0, 3.0, 4.0],
            false,
            3,
            0,
        );
        let settled = merged_capacities(&compiler);
        compiler.commit().unwrap();

        glyphs[1].content_revision = 3;
        prepare(
            &mut compiler,
            &policy,
            &glyphs,
            &[1.0, 21.0, 3.0, 4.0],
            false,
            4,
            0,
        );
        assert_eq!(merged_capacities(&compiler), settled);
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare(
        compiler: &mut RenderPlanCompiler,
        policy: &ValidatedPolicy,
        glyphs: &[PlanGlyph],
        x: &[f32],
        checkpoint: bool,
        publication_generation: u32,
        acknowledged_publication_generation: u32,
    ) {
        compiler
            .prepare(
                policy,
                CAPABILITY,
                PlanInput {
                    glyphs,
                    f32_fields: &[x],
                    u32_fields: &[],
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
            material_id: 1,
            clip_id: 0,
            depth_key: 0,
            inline_start: stable_id as f32,
            block_start: 0.0,
            inline_extent: 1.0,
            block_extent: 1.0,
        }
    }

    fn policy() -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![capability()],
            programs: vec![
                program(ORDERED, 0, ProgramId(1), ALLOCATION_ORDERED_DIRECT),
                program(STABLE, 0, ProgramId(2), ALLOCATION_STABLE_INDIRECT),
            ],
        })
        .unwrap()
    }

    fn policy_with_shared_technique_variants() -> ValidatedPolicy {
        ValidatedPolicy::new(PolicyDescriptor {
            capability_sets: vec![capability()],
            programs: vec![
                program(ORDERED, 0, ProgramId(1), ALLOCATION_ORDERED_DIRECT),
                program(ORDERED, 1, ProgramId(2), ALLOCATION_STABLE_INDIRECT),
            ],
        })
        .unwrap()
    }

    fn capability() -> CapabilitySet {
        CapabilitySet {
            id: CAPABILITY,
            flags: CAP_ORDERED_DIRECT | CAP_STABLE_INDIRECT,
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

    fn program(
        technique: TechniqueId,
        variant: u16,
        id: ProgramId,
        allocation_strategy: u16,
    ) -> ProgramDescriptor {
        ProgramDescriptor {
            technique,
            variant,
            id,
            capability_set: CapabilitySetId(0),
            resource_kind_mask: 1,
            semantic_view_mask: 0,
            storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
            draw_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE | BATCH_ORDER,
            allocation_strategy,
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
        }
    }

    fn merged_capacities(compiler: &RenderPlanCompiler) -> [usize; 7] {
        [
            compiler.resources.capacity(),
            compiler.buffers.capacity(),
            compiler.patches.capacity(),
            compiler.primitives.capacity(),
            compiler.draws.capacity(),
            compiler.retirements.capacity(),
            compiler.payload.capacity(),
        ]
    }
}
