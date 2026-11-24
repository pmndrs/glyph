//! Retained ordered-direct physical storage and invalidation-directed patch planning.
//!
//! The planner compares stable semantic identities and caller-owned content revisions. It never
//! scans physical buffers to discover changes. Preparation writes only scratch state and can be
//! aborted; committed CPU mirrors change only after the immutable plan has been serialized.

use crate::cold_growth::ColdGrowth as _;

use super::retained_rope::{
    LEAF_CAPACITY, RetainedRope, RopeCursor, RopeEditError, RopeRange, RopeRecord, RopeSummary,
};
use alloc::vec::Vec;
use core::{mem, ops::Range};

use super::{
    codec::{
        BATCH_MATERIAL, BATCH_TRANSFORM, BufferSchema, CapabilitySetId, TechniqueId, ValidatedCodec,
    },
    codec_gather::{ChangedInputs, GatherCorrespondence},
    plan_draw::{GlyphDraw, independent_draw_sort_key, push_glyph_draw},
    plan_input::{DrawSpanSummary, draw_fields_compatible, draw_span_compatible},
    plan_packing::{
        MAX_PHYSICAL_BUFFERS, PendingAllocation, PhysicalBufferState, RangeJob, RecordRange,
        align_record_range, align_up, apply_writes_prevalidated, buffer_record_alignment,
        coalesce_buffer_ranges, collect_range_jobs, execute_run, grown_capacity,
        push_pending_allocation, record_alignment,
    },
    render_plan::{
        BUFFER_ORDERED_DIRECT, BufferRecord, DrawRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_WRITE,
        PatchRecord, PrimitiveRecord, RESOURCE_ACTION_CREATE, RESOURCE_ACTION_RETAIN,
        RETIRE_BUFFER, RETIRE_RESOURCE, RETIRE_SLOT_RANGE, RenderPlanView, ResourceRecord,
        RetirementRecord,
    },
    sort,
};

pub use super::plan_error::PlanError as OrderedPlanError;

use super::render_plan::PRIMITIVE_DECORATION;

mod batch;
mod batch_write;
mod bindings;
mod commit;
mod draw_spans;
mod reorder;
mod topology;
use batch::*;
use batch_write::*;

pub use super::plan_input::{PlanGlyph as OrderedGlyph, PlanInput as OrderedPlanInput};

const DRAW_BLOCK_SLOTS: usize = 32;

#[derive(Clone, Copy)]
struct DrawBlock {
    batch: u32,
    slot: u32,
    summary: DrawSpanSummary,
}

const NONE: u32 = u32::MAX;

enum RetainedAdmissionError {
    Miss,
    Plan(OrderedPlanError),
}

// Both retained updates and batch patches consume sorted, unique physical slots.
fn coalesced_slot_ranges(slots: &[u32]) -> impl Iterator<Item = Range<u32>> + '_ {
    slots
        .chunk_by(|left, right| *right == *left + 1)
        .map(|run| run[0]..run[run.len() - 1] + 1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatchKey {
    technique: TechniqueId,
    program_variant: u16,
    program_id: u32,
    resource_id: u32,
    resource_generation: u32,
    resource_kind: u16,
    storage_key_mask: u32,
    resource_reference: u32,
    material_id: u32,
    clip_id: u32,
    depth_key: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct InstanceState {
    stable_id: u32,
    content_revision: u32,
    placement_slot: u32,
    input_index: u32,
}

impl RopeRecord for InstanceState {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            ..RopeSummary::default()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatchState {
    key: BatchKey,
    instance_start: u32,
    instance_count: u32,
    buffer_start: u32,
    buffer_count: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingBatch {
    retained_count: u32,
    state: BatchState,
    prior_index: Option<u32>,
    allocation_start: Option<usize>,
    patch_start: usize,
    patch_end: usize,
    capacity: u32,
    buffer_ids: [u32; MAX_PHYSICAL_BUFFERS],
    buffer_generations: [u32; MAX_PHYSICAL_BUFFERS],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum MappingState {
    #[default]
    Invalid,
    Current,
    RebuiltPending,
}

#[derive(Clone, Copy)]
pub(crate) enum RetainedOutputScope<'a> {
    /// The changed records, and the codec inputs the gather changed in any of them.
    ChangedIntervals(&'a [Range<usize>], ChangedInputs),
    Replacement(&'a [GatherCorrespondence]),
}

impl<'a> RetainedOutputScope<'a> {
    fn changed_records(self) -> Option<&'a [Range<usize>]> {
        match self {
            Self::ChangedIntervals(records, _) => Some(records),
            Self::Replacement(_) => None,
        }
    }
}

fn sparse_output_intervals(ranges: &[Range<usize>], glyph_count: usize) -> Option<&[Range<usize>]> {
    (ranges.len() != 1
        || ranges[0].is_empty()
        || ranges[0].start != 0
        || ranges[0].end != glyph_count)
        .then_some(ranges)
}

#[derive(Clone, Copy)]
struct PrepareContext<'a> {
    codec: &'a ValidatedCodec,
    capability_set: CapabilitySetId,
    capability: &'a super::codec::CapabilitySet,
    input: OrderedPlanInput<'a>,
    checkpoint: bool,
    changed_intervals: Option<&'a [Range<usize>]>,
    /// Inputs the gather changed, when every instance kept its input and physical slot.
    changed_inputs: Option<ChangedInputs>,
}

#[derive(Default)]
pub struct OrderedPlanCompiler {
    batches: Vec<BatchState>,
    instances: RetainedRope<InstanceState>,
    buffers: Vec<PhysicalBufferState>,
    spare_batches: Vec<BatchState>,
    spare_buffers: Vec<PhysicalBufferState>,
    pending_batches: Vec<PendingBatch>,
    pending_instances: RetainedRope<InstanceState>,
    dirty_instances: Vec<u32>,
    pending_allocations: Vec<Option<PendingAllocation>>,
    input_batches: Vec<u32>,
    input_slots: Vec<u32>,
    retained_input_slots: Vec<u32>,
    mapping_state: MappingState,
    batch_cursors: Vec<u32>,
    changed_ranges: Vec<RecordRange>,
    buffer_ranges: [Vec<RecordRange>; MAX_PHYSICAL_BUFFERS],
    range_jobs: Vec<RangeJob>,
    resources: Vec<ResourceRecord>,
    plan_buffers: Vec<BufferRecord>,
    primitives: Vec<PrimitiveRecord>,
    draws: Vec<DrawRecord>,
    sort_pairs: Vec<(u64, u32)>,
    blocks: Vec<DrawBlock>,
    pending_blocks: Vec<DrawBlock>,
    live_primitives: Vec<PrimitiveRecord>,
    live_draws: Vec<DrawRecord>,
    patches: Vec<PatchRecord>,
    retirements: Vec<RetirementRecord>,
    payload: Vec<u8>,
    next_buffer_id: u32,
    pending_next_buffer_id: u32,
    codec_fingerprint: u64,
    pending_codec_fingerprint: u64,
    capability_set: u32,
    pending_capability_set: u32,
    buffer_id_limit: u32,
    publish_bindings: bool,
    retained_host_topology: bool,
    bindings_dirty: bool,
    reuse_live_bindings: bool,
    committed_order_independent: Option<bool>,
    pending_order_independent: Option<bool>,
    prepared: bool,
    #[cfg(test)]
    retained_topology_preparations: u32,
    #[cfg(test)]
    retained_binding_compilation_skips: u32,
}

impl OrderedPlanCompiler {
    pub(crate) fn with_buffer_id_limit(buffer_id_limit: u32) -> Self {
        Self {
            buffer_id_limit,
            ..Self::default()
        }
    }

    pub fn prepare(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
    ) -> Result<(), OrderedPlanError> {
        self.prepare_internal(
            codec,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            None,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_scoped(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        output_scope: Option<RetainedOutputScope<'_>>,
        bounds_changed: bool,
    ) -> Result<(), OrderedPlanError> {
        self.prepare_internal(
            codec,
            capability_set,
            input,
            checkpoint,
            publication_generation,
            output_scope,
            bounds_changed,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_internal(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        input: OrderedPlanInput<'_>,
        checkpoint: bool,
        publication_generation: u32,
        output_scope: Option<RetainedOutputScope<'_>>,
        bounds_changed: bool,
    ) -> Result<(), OrderedPlanError> {
        if self.prepared {
            return Err(OrderedPlanError::AlreadyPrepared);
        }
        if publication_generation == 0 {
            return Err(OrderedPlanError::InvalidIdentity);
        }
        let capability = codec
            .capability_set(capability_set)
            .ok_or(OrderedPlanError::CapabilitySetMissing)?;
        u32::try_from(input.glyphs.len()).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        self.reset_pending();
        let retained_topology = !checkpoint
            && match output_scope {
                Some(RetainedOutputScope::Replacement(correspondence)) => self
                    .prepare_complete_topology(
                        codec,
                        capability_set,
                        input,
                        Some(correspondence),
                    )?,
                Some(scope) => self.prepare_retained_topology(
                    codec,
                    capability_set,
                    input,
                    scope.changed_records(),
                )?,
                None => self.prepare_retained_topology(codec, capability_set, input, None)?,
            };
        #[cfg(test)]
        if retained_topology {
            self.retained_topology_preparations += 1;
        }
        if !retained_topology {
            self.reset_pending();
            self.prepare_complete_topology(codec, capability_set, input, None)?;
        }
        self.bindings_dirty |= bounds_changed;
        self.pending_next_buffer_id = self.next_buffer_id;
        self.pending_codec_fingerprint = codec.fingerprint();
        self.pending_capability_set = capability_set.0;
        let context = PrepareContext {
            codec,
            capability_set,
            capability,
            input,
            checkpoint,
            // Exact output intervals cover gathered glyph metadata, including bounds.
            changed_intervals: if retained_topology {
                output_scope
                    .and_then(RetainedOutputScope::changed_records)
                    .and_then(|ranges| sparse_output_intervals(ranges, input.glyphs.len()))
            } else {
                None
            },
            changed_inputs: match output_scope {
                Some(RetainedOutputScope::ChangedIntervals(_, inputs)) if retained_topology => {
                    Some(inputs)
                }
                _ => None,
            },
        };
        for batch_index in 0..self.pending_batches.len() {
            self.prepare_batch(context, batch_index)?;
        }
        self.prepare_removed_batches()?;
        self.compile_bindings(context, retained_topology)?;
        self.pending_order_independent = Some(input.order_independent);
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn has_state(&self) -> bool {
        !self.batches.is_empty()
    }

    /// Whether the prepared view replaces the renderer's draw structure or leaves it as it is.
    #[cfg(feature = "oracle")]
    pub(crate) fn publishes_bindings(&self) -> bool {
        self.publish_bindings
    }

    #[cfg(test)]
    pub fn commit(&mut self) -> Result<(), OrderedPlanError> {
        self.preflight_commit()?;
        self.commit_preflighted();
        Ok(())
    }

    pub fn abort(&mut self) {
        self.reuse_live_bindings = false;
        self.prepared = false;
        self.reset_pending();
    }

    pub fn buffer_bytes(&self, id: u32) -> Option<&[u8]> {
        self.buffers
            .iter()
            .find(|buffer| buffer.id == id)
            .map(|buffer| buffer.bytes.as_slice())
    }

    pub fn buffer_schema(&self, id: u32) -> Option<(u32, BufferSchema)> {
        self.buffers
            .iter()
            .find(|buffer| buffer.id == id)
            .map(|buffer| (buffer.program_id, buffer.schema))
    }

    #[cfg(test)]
    pub(crate) fn block_stats(&self) -> (usize, usize, usize, usize) {
        (
            DRAW_BLOCK_SLOTS,
            core::mem::size_of::<DrawBlock>(),
            self.blocks.len(),
            self.blocks.capacity() + self.pending_blocks.capacity(),
        )
    }

    #[cfg(test)]
    pub(crate) fn retained_binding_compilation_skips(&self) -> u32 {
        self.retained_binding_compilation_skips
    }
}

/// Where a batch write appends payload bytes and patches.
struct BatchWriteOutput<'a> {
    payload: &'a mut Vec<u8>,
    patches: &'a mut Vec<PatchRecord>,
    pending_allocations: &'a mut Vec<Option<PendingAllocation>>,
}

/// Compares in blocks so the common equal prefix runs as `memcmp`.
const DIFFERENCE_BLOCK: usize = 256;

fn range(start: u32, count: u32) -> Result<core::ops::Range<usize>, OrderedPlanError> {
    let end = start
        .checked_add(count)
        .ok_or(OrderedPlanError::ArithmeticOverflow)?;
    Ok(start as usize..end as usize)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), OrderedPlanError> {
    values
        .try_reserve_cold(additional)
        .map_err(|_| OrderedPlanError::AllocationFailed)
}

/// A host model for tests: it replays the emitted patch protocol only, independently of
/// the compiler's CPU mirrors, so a publication is judged by the bytes a host would hold.
#[cfg(test)]
pub(crate) mod replay {
    use super::*;
    use alloc::vec;

    /// Replays only the emitted patch protocol, independently of the compiler's CPU mirrors.
    #[derive(Default)]
    pub(crate) struct TestHost {
        pub(crate) bytes: alloc::collections::BTreeMap<(u32, u32), Vec<u8>>,
        pub(crate) resources: Vec<ResourceRecord>,
        pub(crate) bindings: Vec<BufferRecord>,
        pub(crate) primitives: Vec<PrimitiveRecord>,
        pub(crate) draws: Vec<DrawRecord>,
    }

    #[derive(Debug, PartialEq)]
    pub(crate) struct TestSnapshot {
        pub(crate) resources: Vec<ResourceRecord>,
        pub(crate) bindings: Vec<BufferRecord>,
        pub(crate) active_bytes: Vec<Vec<u8>>,
        pub(crate) primitives: Vec<PrimitiveRecord>,
        pub(crate) draws: Vec<DrawRecord>,
    }

    impl TestHost {
        pub(crate) fn accept(&mut self, plan: RenderPlanView<'_>, replace_bindings: bool) {
            for patch in plan.patches {
                match patch.opcode {
                    PATCH_ALLOCATE_OR_RESIZE => {
                        self.bytes.insert(
                            (patch.buffer_id, patch.buffer_generation),
                            vec![0; patch.byte_length as usize],
                        );
                    }
                    PATCH_WRITE => {
                        let start = patch.destination_offset as usize;
                        let length = patch.byte_length as usize;
                        let payload = patch.payload_start as usize;
                        self.bytes
                            .get_mut(&(patch.buffer_id, patch.buffer_generation))
                            .unwrap()[start..start + length]
                            .copy_from_slice(&plan.payload[payload..payload + length]);
                    }
                    opcode => panic!("unexpected test codec patch {opcode}"),
                }
            }
            for retirement in plan.retirements {
                if retirement.kind == RETIRE_BUFFER {
                    self.bytes.remove(&(retirement.id, retirement.generation));
                }
            }
            if replace_bindings {
                self.resources = plan
                    .resources
                    .iter()
                    .map(|resource| ResourceRecord {
                        action: RESOURCE_ACTION_RETAIN,
                        ..*resource
                    })
                    .collect();
                self.bindings = plan.buffers.to_vec();
                self.primitives = plan.primitives.to_vec();
                self.draws = plan.draws.to_vec();
            }
        }

        pub(crate) fn snapshot(&self) -> TestSnapshot {
            let mut bindings = self.bindings.clone();
            let mut active_bytes = Vec::with_capacity(bindings.len());
            for (index, binding) in bindings.iter_mut().enumerate() {
                let source_id = binding.id;
                let source_generation = binding.generation;
                let stride = binding
                    .byte_length
                    .checked_div(binding.capacity_records)
                    .unwrap_or(0);
                let live_bytes = binding.live_records as usize * stride as usize;
                active_bytes
                    .push(self.bytes[&(source_id, source_generation)][..live_bytes].to_vec());
                binding.id = index as u32 + 1;
                binding.generation = 1;
                binding.capacity_records = binding.live_records;
                binding.byte_length = binding.live_records * stride;
            }
            let mut primitives = self.primitives.clone();
            for primitive in &mut primitives {
                primitive.buffer_id = self
                    .bindings
                    .iter()
                    .position(|binding| binding.id == primitive.buffer_id)
                    .map_or(0, |index| index as u32 + 1);
            }
            TestSnapshot {
                resources: self.resources.clone(),
                bindings,
                active_bytes,
                primitives,
                draws: self.draws.clone(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::codec::{
        BATCH_MATERIAL, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE,
        BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, CAP_ORDERED_DIRECT, CapabilitySet,
        CodecDescriptor, Operation, ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType,
    };
    use crate::engine::plan_input::PlanGlyph;
    use crate::engine::render_plan_wire::plan_layout;
    use alloc::vec;

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const TECHNIQUE: TechniqueId = TechniqueId(1);

    use super::replay::TestHost;

    #[test]
    fn draw_aggregation_preserves_bounds_semantics_and_split_edges() {
        let codec = codec();
        for order_independent in [false, true] {
            for (ids, expected) in [([1, 2], 0), ([0, 2], 0), ([2, 2], 2)] {
                let mut compiler = OrderedPlanCompiler::default();
                let mut glyphs = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
                glyphs[0].semantic_id = ids[0];
                glyphs[0].inline_start = 10.0;
                glyphs[0].inline_extent = 4.0;
                glyphs[0].block_start = 2.0;
                glyphs[0].block_extent = 3.0;
                glyphs[1].semantic_id = ids[1];
                glyphs[1].inline_start = -5.0;
                glyphs[1].inline_extent = 2.0;
                glyphs[1].block_start = -4.0;
                glyphs[1].block_extent = 1.0;
                glyphs[2].clip_id = 7;
                glyphs[2].inline_start = 1_000.0;
                prepare_with_options(
                    &mut compiler,
                    &codec,
                    &glyphs,
                    &[1.0, 2.0, 3.0],
                    &[],
                    true,
                    order_independent,
                );
                let plan = compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap();
                assert_eq!(plan.primitives.len(), 2);
                let first = plan.primitives[0];
                assert_eq!(first.record_count, 2);
                assert_eq!(first.semantic_id, expected);
                assert_eq!(
                    (
                        first.inline_start,
                        first.block_start,
                        first.inline_extent,
                        first.block_extent
                    ),
                    (-5.0, -4.0, 19.0, 9.0),
                );
                assert_eq!(plan.primitives[1].inline_start, 1_000.0);
                compiler.commit().unwrap();

                glyphs[0].inline_extent = f32::INFINITY;
                assert_eq!(
                    compiler.prepare(
                        &codec,
                        CAPABILITY,
                        OrderedPlanInput {
                            glyphs: &glyphs,
                            placement_slots: &[0; 3],
                            semantic_change_masks: &[],
                            f32_fields: &[&[1.0, 2.0, 3.0]],
                            u32_fields: &[],
                            order_independent,
                        },
                        true,
                        2,
                    ),
                    Err(OrderedPlanError::InvalidInputShape),
                );
                compiler.abort();
                glyphs[0].inline_extent = 4.0;
                prepare_with_options(
                    &mut compiler,
                    &codec,
                    &glyphs,
                    &[1.0, 2.0, 3.0],
                    &[],
                    true,
                    order_independent,
                );
                assert_eq!(compiler.primitives[0].inline_extent, 19.0);
            }
        }
    }

    #[test]
    fn multileaf_complete_writes_and_independent_draws_traverse_sequentially() {
        let codec = paint_codec_with_material_storage(false);
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        for count in [33, 64, 65, 129, 65] {
            let glyphs: Vec<_> = (1..=count).map(|id| glyph(id, 1)).collect();
            let x: Vec<_> = (1..=count).map(|id| id as f32).collect();
            super::super::work_attribution::reset();
            prepare_with_options(&mut compiler, &codec, &glyphs, &x, &[], true, true);
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.rope_record_pushes, 0);
            assert_eq!(work.rope_bulk_records, count as usize);
            assert_eq!(
                work.rope_bulk_chunks,
                (count as usize).div_ceil(LEAF_CAPACITY)
            );
            assert_eq!(
                super::super::work_attribution::snapshot().rope_point_queries,
                0,
                "complete layout, checkpoint writes and independent draws must use borrowed traversal"
            );
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();
            assert!(!plan.draws.is_empty());
            host.accept(plan, compiler.publish_bindings);
            compiler.commit().unwrap();
            let mut cold = OrderedPlanCompiler::default();
            let mut oracle = TestHost::default();
            prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, true);
            oracle.accept(
                cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                cold.publish_bindings,
            );
            assert_eq!(host.snapshot(), oracle.snapshot());
        }
    }

    #[test]
    fn first_owner_identity_change_reuses_clean_draws_and_matches_cold_host() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        for order_independent in [false, true] {
            for one_span in [false, true] {
                for owner_count in [100_usize, 1_000] {
                    let glyph_count = owner_count * 10;
                    let expected_draws = if one_span { 1 } else { owner_count };
                    let mut compiler = OrderedPlanCompiler::default();
                    let mut host = TestHost::default();
                    let mut glyphs: Vec<_> = (0..glyph_count)
                        .map(|index| {
                            let mut value = glyph(index as u32 + 1, 1);
                            value.transform_id = if one_span { 1 } else { index as u32 / 10 + 1 };
                            value
                        })
                        .collect();
                    let mut x: Vec<_> = (0..glyph_count).map(|index| index as f32).collect();
                    prepare_with_options(
                        &mut compiler,
                        &codec,
                        &glyphs,
                        &x,
                        &[],
                        true,
                        order_independent,
                    );
                    host.accept(
                        compiler
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap(),
                        compiler.publish_bindings,
                    );
                    compiler.commit().unwrap();
                    let accepted = host.snapshot();
                    assert_eq!(compiler.batches.len(), 1);
                    assert_eq!(accepted.resources.len(), 1);
                    assert_eq!(accepted.bindings.len(), 1);
                    assert_eq!(accepted.draws.len(), expected_draws);

                    for (glyph, x) in glyphs[..10].iter_mut().zip(&mut x[..10]) {
                        glyph.stable_id += glyph_count as u32;
                        glyph.content_revision += 1;
                        glyph.inline_start += 0.25;
                        *x += 0.25;
                    }
                    let slots = vec![0; glyph_count];
                    let masks = vec![0; glyph_count];
                    let fields = [x.as_slice()];
                    let intervals = core::iter::once(0..10).collect::<Vec<_>>();
                    super::super::work_attribution::reset();
                    compiler
                        .prepare_scoped(
                            &codec,
                            CAPABILITY,
                            OrderedPlanInput {
                                glyphs: &glyphs,
                                placement_slots: &slots,
                                semantic_change_masks: &masks,
                                f32_fields: &fields,
                                u32_fields: &[],
                                order_independent,
                            },
                            false,
                            2,
                            Some(RetainedOutputScope::ChangedIntervals(
                                &intervals,
                                ChangedInputs::ALL,
                            )),
                            false,
                        )
                        .unwrap();
                    let work = super::super::work_attribution::snapshot();
                    assert_eq!(work.ordered_admission_visits, 10);
                    assert_eq!(work.ordered_instance_rewrites, 10);
                    if one_span && order_independent {
                        assert!(work.draw_reduced_glyphs <= 10 + 2 * DRAW_BLOCK_SLOTS);
                        assert!(work.draw_folded_blocks >= glyph_count / DRAW_BLOCK_SLOTS - 2);
                        assert_eq!(
                            compiler.pending_blocks.len(),
                            glyph_count / DRAW_BLOCK_SLOTS
                        );
                    } else {
                        assert_eq!(
                            work.draw_reduced_glyphs,
                            if one_span { glyph_count } else { 10 }
                        );
                        assert_eq!(work.draw_folded_blocks, 0);
                    }
                    if !one_span {
                        assert_eq!(compiler.block_stats().2, 0);
                        assert_eq!(compiler.block_stats().3, 0);
                    }
                    assert_eq!(compiler.retained_binding_compilation_skips, 0);
                    assert_eq!(compiler.pending_batches.len(), 1);
                    assert_eq!(compiler.primitives.len(), expected_draws);
                    assert_eq!(compiler.draws.len(), expected_draws);
                    host.accept(
                        compiler
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap(),
                        compiler.publish_bindings,
                    );
                    compiler.commit().unwrap();

                    let mut cold = OrderedPlanCompiler::default();
                    let mut oracle = TestHost::default();
                    prepare_with_options(
                        &mut cold,
                        &codec,
                        &glyphs,
                        &x,
                        &[],
                        true,
                        order_independent,
                    );
                    oracle.accept(
                        cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                        cold.publish_bindings,
                    );
                    let actual = host.snapshot();
                    assert_ne!(accepted.primitives[0].id, actual.primitives[0].id);
                    assert_ne!(accepted.draws[0].id, actual.draws[0].id);
                    assert_ne!(
                        accepted.primitives[0].inline_start,
                        actual.primitives[0].inline_start
                    );
                    assert_eq!(actual, oracle.snapshot());
                }
            }
        }
    }

    #[test]
    fn scoped_ordered_spans_match_cold_host_across_changed_boundaries() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        for order_independent in [false, true] {
            for case in [
                "head",
                "interior",
                "summary_inline_start",
                "summary_block_start",
                "summary_inline_extent",
                "summary_block_extent",
                "merge",
                "split",
                "resource",
            ] {
                let mut compiler = OrderedPlanCompiler::default();
                let mut host = TestHost::default();
                let mut glyphs: Vec<_> = (0..9)
                    .map(|index| {
                        let mut row = glyph(index + 1, 1);
                        row.transform_id = index / 3 + 1;
                        row
                    })
                    .collect();
                let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
                prepare_with_options(
                    &mut compiler,
                    &codec,
                    &glyphs,
                    &x,
                    &[],
                    true,
                    order_independent,
                );
                host.accept(
                    compiler
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    compiler.publish_bindings,
                );
                compiler.commit().unwrap();

                let changed = match case {
                    "head" => {
                        glyphs[0].stable_id = 100;
                        glyphs[0].inline_start = -2.0;
                        glyphs[0].semantic_id = 2;
                        0
                    }
                    "interior" => {
                        glyphs[1].inline_extent = 30.0;
                        glyphs[1].semantic_id = 0;
                        1
                    }
                    "summary_inline_start" => {
                        glyphs[1].inline_start = -30.0;
                        glyphs[1].semantic_id = 0;
                        1
                    }
                    "summary_block_start" => {
                        glyphs[1].block_start = -30.0;
                        glyphs[1].semantic_id = 0;
                        1
                    }
                    "summary_inline_extent" => {
                        glyphs[1].inline_extent = 30.0;
                        glyphs[1].semantic_id = 0;
                        1
                    }
                    "summary_block_extent" => {
                        glyphs[1].block_extent = 30.0;
                        glyphs[1].semantic_id = 0;
                        1
                    }
                    "merge" => {
                        glyphs[3].transform_id = 1;
                        3
                    }
                    "split" => {
                        glyphs[1].transform_id = 9;
                        1
                    }
                    "resource" => {
                        glyphs[0].resource_id = 12;
                        0
                    }
                    _ => unreachable!(),
                };
                if !case.starts_with("summary_") {
                    glyphs[changed].content_revision += 1;
                }
                let x = if case.starts_with("summary_") {
                    x
                } else {
                    glyphs.iter().map(|row| row.inline_start).collect()
                };
                let slots = vec![0; glyphs.len()];
                let masks = vec![0; glyphs.len()];
                let intervals = core::iter::once(changed..changed + 1).collect::<Vec<_>>();
                let prepare_changed = |compiler: &mut OrderedPlanCompiler| {
                    compiler.prepare_scoped(
                        &codec,
                        CAPABILITY,
                        OrderedPlanInput {
                            glyphs: &glyphs,
                            placement_slots: &slots,
                            semantic_change_masks: &masks,
                            f32_fields: &[&x],
                            u32_fields: &[],
                            order_independent,
                        },
                        false,
                        2,
                        Some(RetainedOutputScope::ChangedIntervals(
                            &intervals,
                            ChangedInputs::ALL,
                        )),
                        case.starts_with("summary_"),
                    )
                };
                super::super::work_attribution::reset();
                prepare_changed(&mut compiler).unwrap();
                if case == "head" {
                    compiler.abort();
                    assert_eq!(
                        compiler.committed_order_independent,
                        Some(order_independent)
                    );
                    super::super::work_attribution::reset();
                    prepare_changed(&mut compiler).unwrap();
                }
                let work = super::super::work_attribution::snapshot();
                let reduced = work.draw_reduced_glyphs;
                if case.starts_with("summary_") {
                    assert_eq!(work.ordered_instance_rewrites, 0);
                    assert_eq!(compiler.primitives[0].semantic_id, 0);
                    assert!(
                        compiler.primitives[0].inline_extent > 3.0
                            || compiler.primitives[0].block_extent > 3.0
                    );
                }
                let expected_reduced = match case {
                    "resource" => 9,
                    "merge" => 6,
                    _ => 3,
                };
                assert_eq!(reduced, expected_reduced, "{case}");
                host.accept(
                    compiler
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    compiler.publish_bindings,
                );
                compiler.commit().unwrap();
                let mut cold = OrderedPlanCompiler::default();
                let mut oracle = TestHost::default();
                prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, order_independent);
                oracle.accept(
                    cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                    cold.publish_bindings,
                );
                assert_eq!(host.snapshot(), oracle.snapshot(), "{case}");
            }
        }
        // A single broad indexed span exercises cache eligibility at boundaries inside
        // physical blocks; the ordered cases above keep their original small oracle.
        for split_transform in [false, true] {
            let codec = paint_codec_with_limits(false, 65_536, split_transform);
            for key in ["clip", "depth", "material", "transform"] {
                for changed_index in [0, 31, 32, 47] {
                    let mut compiler = OrderedPlanCompiler::default();
                    let mut host = TestHost::default();
                    let mut glyphs: Vec<_> = (0..128).map(|index| glyph(index + 1, 1)).collect();
                    let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
                    let slots = vec![0; glyphs.len()];
                    let masks = vec![0; glyphs.len()];
                    prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, true, true);
                    host.accept(
                        compiler
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap(),
                        compiler.publish_bindings,
                    );
                    compiler.commit().unwrap();
                    let (block_slots, block_bytes, block_count, block_capacity) =
                        compiler.block_stats();
                    assert_eq!((block_slots, block_bytes, block_count), (32, 36, 4));
                    assert!(block_capacity >= block_count);
                    let changed = &mut glyphs[changed_index];
                    changed.content_revision += 1;
                    match key {
                        "clip" => changed.clip_id = 2,
                        "depth" => changed.depth_key = 2,
                        "material" => changed.material_id = 2,
                        "transform" => changed.transform_id = 2,
                        _ => unreachable!(),
                    }
                    let intervals =
                        core::iter::once(changed_index..changed_index + 1).collect::<Vec<_>>();
                    super::super::work_attribution::reset();
                    compiler
                        .prepare_scoped(
                            &codec,
                            CAPABILITY,
                            OrderedPlanInput {
                                glyphs: &glyphs,
                                placement_slots: &slots,
                                semantic_change_masks: &masks,
                                f32_fields: &[&x],
                                u32_fields: &[],
                                order_independent: true,
                            },
                            false,
                            2,
                            Some(RetainedOutputScope::ChangedIntervals(
                                &intervals,
                                ChangedInputs::ALL,
                            )),
                            false,
                        )
                        .unwrap();
                    let expected_draws = if key == "depth" {
                        2
                    } else if key == "transform" && !split_transform {
                        1
                    } else if changed_index == 0 {
                        2
                    } else {
                        3
                    };
                    assert_eq!(
                        compiler.draws.len(),
                        expected_draws,
                        "{key} mask={split_transform} changed={changed_index}"
                    );
                    if key != "depth" {
                        assert!(
                            super::super::work_attribution::snapshot().draw_folded_blocks > 0,
                            "{key} mask={split_transform} changed={changed_index} should fold clean blocks",
                        );
                    }
                    host.accept(
                        compiler
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap(),
                        compiler.publish_bindings,
                    );
                    compiler.commit().unwrap();
                    let mut cold = OrderedPlanCompiler::default();
                    let mut oracle = TestHost::default();
                    prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, true);
                    oracle.accept(
                        cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                        cold.publish_bindings,
                    );
                    assert_eq!(
                        host.snapshot(),
                        oracle.snapshot(),
                        "{key} mask={split_transform} changed={changed_index}"
                    );
                    assert_eq!(compiler.live_primitives.len(), cold.primitives.len());
                    for (warm, expected) in compiler.live_primitives.iter().zip(&cold.primitives) {
                        assert_eq!(warm.inline_start.to_bits(), expected.inline_start.to_bits());
                        assert_eq!(warm.block_start.to_bits(), expected.block_start.to_bits());
                        assert_eq!(
                            warm.inline_extent.to_bits(),
                            expected.inline_extent.to_bits()
                        );
                        assert_eq!(warm.block_extent.to_bits(), expected.block_extent.to_bits());
                    }
                }
            }
        }
    }

    #[test]
    fn a_buffer_whose_inputs_the_gather_left_alone_is_not_executed() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        let initial: Vec<_> = (0..64).map(|index| glyph(index + 1, 1)).collect();
        let x: Vec<_> = initial.iter().map(|row| row.inline_start).collect();
        let slots = vec![0; initial.len()];
        // Every record moved under a new revision and full semantic dirt; its columns did not.
        let masks = vec![super::super::positioning::ALL_SEMANTIC_CHANGES; initial.len()];
        let whole = 0..initial.len();
        let intervals = std::slice::from_ref(&whole);
        for (inputs, executed) in [
            (ChangedInputs::ALL, initial.len()),
            (ChangedInputs::default(), 0),
        ] {
            let mut compiler = OrderedPlanCompiler::default();
            let mut host = TestHost::default();
            let mut glyphs = initial.clone();
            prepare_with_options(&mut compiler, &codec, &glyphs, &x, &[], true, true);
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();
            for row in &mut glyphs {
                row.content_revision += 1;
                row.block_start += 4.0;
            }
            super::super::work_attribution::reset();
            compiler
                .prepare_scoped(
                    &codec,
                    CAPABILITY,
                    OrderedPlanInput {
                        glyphs: &glyphs,
                        placement_slots: &slots,
                        semantic_change_masks: &masks,
                        f32_fields: &[&x],
                        u32_fields: &[],
                        order_independent: true,
                    },
                    false,
                    2,
                    Some(RetainedOutputScope::ChangedIntervals(intervals, inputs)),
                    true,
                )
                .unwrap();
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.codec_executed_records, executed);
            assert_eq!(work.ordered_emitted_write_bytes, 0);
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();
            let mut cold = OrderedPlanCompiler::default();
            let mut oracle = TestHost::default();
            prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, true);
            oracle.accept(
                cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                cold.publish_bindings,
            );
            assert_eq!(host.snapshot(), oracle.snapshot());
        }
    }

    #[test]
    fn a_job_whose_records_all_took_new_revisions_writes_only_the_bytes_that_moved() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        let initial: Vec<_> = (0..200).map(|index| glyph(index + 1, 1)).collect();
        let x: Vec<_> = initial.iter().map(|row| row.inline_start).collect();
        // Typing at the end: every record takes a new revision, one record is appended. A move
        // in the middle: one record changes its input.
        for (name, appended, moved) in [("append", true, None), ("move", false, Some(100))] {
            let mut compiler = OrderedPlanCompiler::default();
            let mut host = TestHost::default();
            prepare_with_options(&mut compiler, &codec, &initial, &x, &[], true, true);
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();
            let mut glyphs = initial.clone();
            let mut x = x.clone();
            for row in &mut glyphs {
                row.content_revision += 1;
            }
            if appended {
                glyphs.push(glyph(initial.len() as u32 + 1, 2));
                x.push(glyphs.last().unwrap().inline_start);
            }
            if let Some(index) = moved {
                x[index] += 0.5;
            }
            let slots = vec![0; glyphs.len()];
            let masks = vec![super::super::positioning::ALL_SEMANTIC_CHANGES; glyphs.len()];
            // One changed interval covering every record.
            #[allow(clippy::single_range_in_vec_init)]
            let intervals = [0..glyphs.len()];
            super::super::work_attribution::reset();
            compiler
                .prepare_scoped(
                    &codec,
                    CAPABILITY,
                    OrderedPlanInput {
                        glyphs: &glyphs,
                        placement_slots: &slots,
                        semantic_change_masks: &masks,
                        f32_fields: &[&x],
                        u32_fields: &[],
                        order_independent: true,
                    },
                    false,
                    2,
                    Some(RetainedOutputScope::ChangedIntervals(
                        &intervals,
                        ChangedInputs::ALL,
                    )),
                    true,
                )
                .unwrap();
            let work = super::super::work_attribution::snapshot();
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();
            assert!(
                plan.patches
                    .iter()
                    .all(|patch| patch.opcode != PATCH_ALLOCATE_OR_RESIZE),
                "{name}: the batch keeps its storage"
            );
            assert!(
                work.ordered_emitted_write_bytes > 0 && work.ordered_emitted_write_bytes <= 256,
                "{name}: wrote {} bytes",
                work.ordered_emitted_write_bytes
            );
            host.accept(plan, compiler.publish_bindings);
            compiler.commit().unwrap();
            let mut cold = OrderedPlanCompiler::default();
            let mut oracle = TestHost::default();
            prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, true);
            oracle.accept(
                cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                cold.publish_bindings,
            );
            assert_eq!(host.snapshot(), oracle.snapshot(), "{name}");
        }
    }

    #[test]
    fn rebuilt_bindings_check_retained_storage_once_after_buffer_construction() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let mut glyphs: Vec<_> = (0..64)
            .map(|index| {
                let mut row = glyph(index + 1, 1);
                row.resource_id = index + 1;
                row
            })
            .collect();
        let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
        let slots = vec![0; glyphs.len()];
        let masks = vec![0; glyphs.len()];
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, true, true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.batches.len(), 64);

        glyphs[0].stable_id = 1000;
        glyphs[0].content_revision += 1;
        glyphs[0].inline_extent += 1.0;
        let intervals = core::iter::once(0..1).collect::<Vec<_>>();
        super::super::work_attribution::reset();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &intervals,
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        assert_eq!(compiler.retained_binding_compilation_skips, 0);
        assert_eq!(
            super::super::work_attribution::snapshot().retained_storage_match_batch_visits,
            compiler.pending_batches.len(),
        );
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn independent_dirty_logical_row_hits_its_nonadjacent_physical_span() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let mut glyphs: Vec<_> = (0..256)
            .map(|index| {
                let mut row = glyph(index + 1, 1);
                row.resource_id = if index % 2 == 0 { 1 } else { 2 };
                row.transform_id = 1;
                row
            })
            .collect();
        let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &[], true, true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives.len(), 2);
        assert_eq!(compiler.live_primitives[0].record_count, 128);
        assert_eq!(compiler.live_primitives[1].record_count, 128);

        // Logical rows 2 and 130 are in separate blocks of the same physical batch.
        for index in [2, 130] {
            glyphs[index].semantic_id = 0;
            glyphs[index].inline_extent = 30.0;
        }
        let slots = vec![0; glyphs.len()];
        let masks = vec![0; glyphs.len()];
        let intervals = [2..3, 130..131];
        super::super::work_attribution::reset();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &intervals,
                    ChangedInputs::ALL,
                )),
                true,
            )
            .unwrap();
        assert_eq!(
            super::super::work_attribution::snapshot().draw_reduced_glyphs,
            64
        );
        assert_eq!(
            super::super::work_attribution::snapshot().draw_folded_blocks,
            2,
        );
        assert_eq!(compiler.pending_blocks.len(), 8);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();

        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
        for (warm, cold) in compiler.live_primitives.iter().zip(cold.primitives.iter()) {
            assert_eq!(warm.inline_start.to_bits(), cold.inline_start.to_bits());
            assert_eq!(warm.block_start.to_bits(), cold.block_start.to_bits());
            assert_eq!(warm.inline_extent.to_bits(), cold.inline_extent.to_bits());
            assert_eq!(warm.block_extent.to_bits(), cold.block_extent.to_bits());
        }
    }

    #[test]
    fn draw_mode_witness_changes_only_with_accepted_publications() {
        let codec = paint_codec_with_limits(false, 65_536, true);
        let glyphs: Vec<_> = (0..128)
            .map(|index| {
                let mut row = glyph(index + 1, 1);
                row.resource_id += index % 2;
                row
            })
            .collect();
        let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
        let masks = vec![0; glyphs.len()];
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, true, false);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.committed_order_independent, Some(false));
        assert_eq!(compiler.blocks.len(), 0);

        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, false, true);
        assert!(!compiler.reuse_live_bindings);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.committed_order_independent, Some(true));
        assert_eq!(compiler.blocks.len(), 4);
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());

        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, false, false);
        assert_eq!(compiler.pending_order_independent, Some(false));
        compiler.abort();
        assert_eq!(compiler.committed_order_independent, Some(true));
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, false, true);
        assert!(compiler.reuse_live_bindings);
        compiler.commit().unwrap();
        assert_eq!(compiler.blocks.len(), 4);
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, true, false);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.blocks.len(), 0);
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, false);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn multileaf_scattered_warm_admission_uses_physical_order() {
        let codec = paint_codec_with_limits(false, 16_384, true);
        for order_independent in [false, true] {
            for count in [65, 129, 1025] {
                let mut compiler = OrderedPlanCompiler::default();
                let mut host = TestHost::default();
                let mut glyphs: Vec<_> = (1..=count)
                    .map(|id| {
                        let mut glyph = glyph(id, 1);
                        glyph.resource_id += id % 2;
                        glyph
                    })
                    .collect();
                let mut x: Vec<_> = (1..=count).map(|id| id as f32).collect();
                prepare_with_options(
                    &mut compiler,
                    &codec,
                    &glyphs,
                    &x,
                    &[],
                    true,
                    order_independent,
                );
                host.accept(
                    compiler
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    compiler.publish_bindings,
                );
                compiler.commit().unwrap();
                for (glyph, x) in glyphs.iter_mut().zip(&mut x) {
                    glyph.content_revision += 1;
                    *x += 0.25;
                }
                let masks = vec![1 << 8; count as usize];
                super::super::work_attribution::reset();
                prepare_with_options(
                    &mut compiler,
                    &codec,
                    &glyphs,
                    &x,
                    &masks,
                    false,
                    order_independent,
                );
                let work = super::super::work_attribution::snapshot();
                assert_eq!(work.ordered_admission_visits, count as usize);
                assert_eq!(work.rope_point_queries, 0);
                assert!(
                    work.rope_iterator_starts <= 32,
                    "two scattered physical batches must not restart traversal per glyph: {work:?}"
                );
                host.accept(
                    compiler
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    compiler.publish_bindings,
                );
                compiler.commit().unwrap();
                let mut cold = OrderedPlanCompiler::default();
                let mut oracle = TestHost::default();
                prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, order_independent);
                oracle.accept(
                    cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                    cold.publish_bindings,
                );
                assert_eq!(host.snapshot(), oracle.snapshot());
                for phase in 0..3 {
                    // Input order alternates resources, while physical order groups them.
                    // The last phase scans all physical rows but leaves one unchanged.
                    // Sparse changes reach three slots in one leaf and two distant leaves.
                    let dirty_slots: Vec<usize> = if phase == 0 {
                        (0..glyphs.len()).collect()
                    } else if phase == 2 {
                        (0..glyphs.len() - 1).collect()
                    } else {
                        vec![1, 3, 5, 34, glyphs.len() - 1]
                    };
                    let mut changed_inputs: Vec<_> = compiler
                        .instances
                        .iter()
                        .enumerate()
                        .filter_map(|(slot, instance)| {
                            (phase == 0 || dirty_slots.contains(&slot))
                                .then_some(instance.input_index as usize)
                        })
                        .collect();
                    assert_eq!(changed_inputs.len(), dirty_slots.len());
                    changed_inputs.sort_unstable();
                    let intervals: Vec<_> = if phase != 1 {
                        core::iter::once(0..glyphs.len()).collect()
                    } else {
                        assert!(dirty_slots.windows(2).all(|pair| pair[0] + 1 < pair[1]));
                        changed_inputs
                            .iter()
                            .map(|&index| index..index + 1)
                            .collect()
                    };
                    for &index in &changed_inputs {
                        glyphs[index].content_revision += 1;
                        x[index] += 0.25;
                    }
                    let mut cold = OrderedPlanCompiler::default();
                    let mut oracle = TestHost::default();
                    prepare_with_options(
                        &mut cold,
                        &codec,
                        &glyphs,
                        &x,
                        &[],
                        true,
                        order_independent,
                    );
                    oracle.accept(
                        cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                        cold.publish_bindings,
                    );
                    let slots = vec![0; glyphs.len()];
                    let f32_fields = [x.as_slice()];
                    let input = OrderedPlanInput {
                        glyphs: &glyphs,
                        placement_slots: &slots,
                        semantic_change_masks: &masks,
                        f32_fields: &f32_fields,
                        u32_fields: &[],
                        order_independent,
                    };
                    let committed = compiler.instances.clone();
                    let accepted = host.snapshot();
                    let touched_leaves = dirty_slots
                        .iter()
                        .map(|slot| slot / LEAF_CAPACITY)
                        .collect::<alloc::collections::BTreeSet<_>>()
                        .len();
                    for rejected in [true, false] {
                        super::super::work_attribution::reset();
                        super::super::retained_rope::reset_work_counters();
                        let admissions = compiler.retained_topology_preparations;
                        compiler
                            .prepare_scoped(
                                &codec,
                                CAPABILITY,
                                input,
                                false,
                                2 + phase,
                                Some(RetainedOutputScope::ChangedIntervals(
                                    &intervals,
                                    ChangedInputs::ALL,
                                )),
                                false,
                            )
                            .unwrap();
                        let work = super::super::work_attribution::snapshot();
                        let (traversals, leaf_visits, record_visits) =
                            super::super::retained_rope::ordered_work_counters();
                        let (copied_records, _) = super::super::retained_rope::work_counters();
                        assert_eq!(compiler.retained_topology_preparations, admissions + 1);
                        assert_eq!(
                            work.ordered_admission_visits,
                            if phase == 1 {
                                dirty_slots.len()
                            } else {
                                glyphs.len()
                            }
                        );
                        assert_eq!(work.ordered_instance_rewrites, dirty_slots.len());
                        assert_eq!(
                            work.ordered_state_derivations,
                            if phase == 1 {
                                dirty_slots.len() * 2
                            } else {
                                glyphs.len()
                            }
                        );
                        assert_eq!(work.rope_point_queries, 0);
                        assert!(work.rope_iterator_starts <= 32);
                        if phase == 0 {
                            assert_eq!(
                                (traversals, leaf_visits, record_visits),
                                (1, glyphs.len().div_ceil(LEAF_CAPACITY), glyphs.len())
                            );
                            assert_eq!(copied_records, 0);
                            assert!(work.ordered_shape_nodes > 0);
                        } else {
                            assert_eq!(traversals, 1);
                            assert_eq!(
                                leaf_visits,
                                if phase == 1 {
                                    touched_leaves
                                } else {
                                    glyphs.len().div_ceil(LEAF_CAPACITY)
                                }
                            );
                            assert_eq!(
                                record_visits,
                                if phase == 1 {
                                    dirty_slots.len()
                                } else {
                                    glyphs.len()
                                }
                            );
                            assert_eq!(work.ordered_shape_nodes, 0);
                            assert!(copied_records <= LEAF_CAPACITY * touched_leaves);
                        }
                        assert_eq!(
                            compiler.dirty_instances,
                            dirty_slots
                                .iter()
                                .map(|slot| *slot as u32)
                                .collect::<Vec<_>>()
                        );
                        assert_eq!(compiler.instances, committed);
                        assert_eq!(compiler.pending_instances, cold.pending_instances);
                        assert_eq!(host.snapshot(), accepted);
                        if rejected {
                            compiler.abort();
                            assert_eq!(compiler.instances, committed);
                            assert_eq!(host.snapshot(), accepted);
                        } else {
                            host.accept(
                                compiler
                                    .plan_view(7, CAPABILITY, codec.fingerprint())
                                    .unwrap(),
                                compiler.publish_bindings,
                            );
                            compiler.commit().unwrap();
                        }
                    }
                    assert_eq!(host.snapshot(), oracle.snapshot());
                }
            }
        }
    }

    #[test]
    fn separated_replacements_copy_clean_batch_slots_and_match_cold_publication() {
        use super::super::codec_gather::GatherRange;

        let codec = paint_codec_with_limits(false, 16_384, true);
        for order_independent in [false, true] {
            let clean: Vec<_> = (1..=64)
                .map(|id| {
                    let mut value = glyph(id, 1);
                    value.resource_id += id % 2;
                    value
                })
                .collect();
            let mut candidate = OrderedPlanCompiler::default();
            let mut actual = TestHost::default();
            let mut old_counts = [0, 0];
            for step in 0..24 {
                let counts = [[2, 4], [70, 1], [0, 3], [3, 0], [1, 1]][step % 5];
                let mut glyphs = clean[..8].to_vec();
                let mut masks = vec![0; 8];
                for (owner, gap) in [8..32, 32..64].into_iter().enumerate() {
                    for offset in 0..counts[owner] {
                        let mut value = glyph(
                            1000 + (step * 200 + owner * 100 + offset) as u32,
                            step as u32 + 1,
                        );
                        value.resource_id += offset as u32 % 2;
                        if step % 7 == 6 {
                            value.resource_id += 10;
                        }
                        glyphs.push(value);
                        masks.push(u16::MAX);
                    }
                    glyphs.extend_from_slice(&clean[gap.clone()]);
                    masks.resize(masks.len() + gap.len(), 0);
                }
                let old_first_end = 8 + old_counts[0];
                let next_first_end = 8 + counts[0];
                let old_second_start = old_first_end + 24;
                let next_second_start = next_first_end + 24;
                let correspondence = [
                    GatherCorrespondence {
                        old: GatherRange::records_for_test(8..old_first_end),
                        next: GatherRange::records_for_test(8..next_first_end),
                        owner: Some(1),
                    },
                    GatherCorrespondence {
                        old: GatherRange::records_for_test(old_first_end..old_second_start),
                        next: GatherRange::records_for_test(next_first_end..next_second_start),
                        owner: None,
                    },
                    GatherCorrespondence {
                        old: GatherRange::records_for_test(
                            old_second_start..old_second_start + old_counts[1],
                        ),
                        next: GatherRange::records_for_test(
                            next_second_start..next_second_start + counts[1],
                        ),
                        owner: Some(2),
                    },
                ];
                let x: Vec<_> = glyphs.iter().map(|value| value.stable_id as f32).collect();
                let slots: Vec<_> = glyphs.iter().map(|value| value.stable_id).collect();
                let fields = [x.as_slice()];
                let input = OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &fields,
                    u32_fields: &[],
                    order_independent,
                };
                let checkpoint = step == 0 || step % 11 == 10;
                let scope = Some(RetainedOutputScope::Replacement(&correspondence));
                super::super::work_attribution::reset();
                candidate
                    .prepare_scoped(
                        &codec,
                        CAPABILITY,
                        input,
                        checkpoint,
                        step as u32 + 1,
                        scope,
                        true,
                    )
                    .unwrap();
                let work = super::super::work_attribution::snapshot();
                if !checkpoint && step % 7 != 6 && (step - 1) % 7 != 6 {
                    assert_eq!(work.ordered_admission_visits, counts.iter().sum::<usize>());
                    assert!(work.codec_executed_records <= counts.iter().sum::<usize>());
                    // Each batch has at most the clean prefix, middle gap and suffix.
                    assert!(work.clean_buffer_copy_runs <= candidate.pending_batches.len() * 3);
                    assert_eq!(work.rope_point_queries, 0);
                }
                if step == 5 {
                    let accepted = actual.snapshot();
                    candidate.abort();
                    assert_eq!(candidate.mapping_state, MappingState::Invalid);
                    assert_eq!(actual.snapshot(), accepted);
                    candidate
                        .prepare_scoped(
                            &codec,
                            CAPABILITY,
                            input,
                            checkpoint,
                            step as u32 + 1,
                            scope,
                            true,
                        )
                        .unwrap();
                }
                let mut cold = OrderedPlanCompiler::default();
                let mut expected = TestHost::default();
                cold.prepare(&codec, CAPABILITY, input, true, step as u32 + 1)
                    .unwrap();
                actual.accept(
                    candidate
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    candidate.publish_bindings,
                );
                expected.accept(
                    cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                    cold.publish_bindings,
                );
                assert_eq!(
                    actual.snapshot(),
                    expected.snapshot(),
                    "step {step}, independent {order_independent}"
                );
                candidate.commit().unwrap();
                for instance in candidate.instances.iter() {
                    assert_eq!(
                        instance.stable_id,
                        glyphs[instance.input_index as usize].stable_id
                    );
                }
                old_counts = counts;
            }
        }
    }

    #[test]
    fn trailing_output_replacement_retains_mixed_batch_prefix_and_matches_full() {
        let codec = paint_codec_with_limits(false, 16_384, true);
        for order_independent in [false, true] {
            let prefix = 64;
            let mut candidate = OrderedPlanCompiler::default();
            let mut control = OrderedPlanCompiler::default();
            let mut actual = TestHost::default();
            let mut expected = TestHost::default();
            let clean: Vec<_> = (1..=prefix)
                .map(|id| {
                    let mut value = glyph(id as u32, 1);
                    value.resource_id += id as u32 % 2;
                    value
                })
                .collect();
            let mut random = 0x317a_8e91_u32;
            let mut old_count = 0;
            for step in 0..32 {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let count = [1, 1, 0, 65, 2][step % 5];
                let mut glyphs = clean.clone();
                for offset in 0..count {
                    let mut value =
                        glyph(1000 + step as u32 * 100 + offset as u32, step as u32 + 1);
                    value.resource_id += if step <= 1 {
                        0
                    } else {
                        (random + offset as u32) % 2
                    };
                    // Consecutive one-record tails preserve storage counts/batch membership
                    // while changing identity and an extremum. Binding reuse would be stale.
                    value.inline_start = -100.0 - step as f32;
                    value.inline_extent = 20.0 + step as f32;
                    // A new resource invalidates stable membership; the same executor
                    // must rebuild rather than silently treating a logical prefix as physical.
                    if step % 7 == 6 {
                        value.resource_id += 10;
                    }
                    glyphs.push(value);
                }
                let x: Vec<_> = glyphs.iter().map(|glyph| glyph.stable_id as f32).collect();
                let slots: Vec<_> = glyphs.iter().map(|glyph| glyph.stable_id).collect();
                let masks = vec![u16::MAX; glyphs.len()];
                let checkpoint = step == 0 || step % 11 == 10;
                let input = OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent,
                };
                let correspondence = [GatherCorrespondence {
                    old: super::super::codec_gather::GatherRange::records_for_test(
                        prefix..prefix + old_count,
                    ),
                    next: super::super::codec_gather::GatherRange::records_for_test(
                        prefix..glyphs.len(),
                    ),
                    owner: Some(1),
                }];
                let malformed_correspondence = [GatherCorrespondence {
                    old: super::super::codec_gather::GatherRange::records_for_test(
                        prefix..prefix + old_count,
                    ),
                    // The first next range must begin at the unchanged-prefix boundary.
                    next: super::super::codec_gather::GatherRange::records_for_test(
                        prefix + 1..glyphs.len(),
                    ),
                    owner: Some(1),
                }];
                let invalid_scope_control = !checkpoint && matches!(step, 12 | 15);
                let scope = if checkpoint {
                    None
                } else if step == 12 {
                    Some(RetainedOutputScope::Replacement(&[]))
                } else if step == 15 {
                    Some(RetainedOutputScope::Replacement(&malformed_correspondence))
                } else {
                    Some(RetainedOutputScope::Replacement(&correspondence))
                };
                if step == 8 {
                    let mut rejected = glyphs.clone();
                    rejected[0].resource_id += 20;
                    candidate
                        .prepare(
                            &codec,
                            CAPABILITY,
                            OrderedPlanInput {
                                glyphs: &rejected,
                                ..input
                            },
                            false,
                            step as u32 + 1,
                        )
                        .unwrap();
                    candidate.abort();
                    assert_eq!(candidate.mapping_state, MappingState::Invalid);
                }
                super::super::work_attribution::reset();
                let retained_preparations = candidate.retained_topology_preparations;
                candidate
                    .prepare_scoped(
                        &codec,
                        CAPABILITY,
                        input,
                        checkpoint,
                        step as u32 + 1,
                        scope,
                        false,
                    )
                    .unwrap();
                let work = super::super::work_attribution::snapshot();
                if invalid_scope_control {
                    assert_eq!(work.ordered_admission_visits, glyphs.len());
                    assert_eq!(
                        candidate.retained_topology_preparations, retained_preparations,
                        "invalid replacement scope must use full topology admission at step {step}"
                    );
                } else if !checkpoint
                    && step != 8
                    && step % 7 != 6
                    && (step == 0 || (step - 1) % 7 != 6)
                {
                    assert_eq!(work.ordered_admission_visits, count);
                    assert_eq!(work.ordered_instance_rewrites, count);
                    assert_eq!(work.ordered_instance_comparisons, count);
                    assert_eq!(work.rope_bulk_records, count);
                }
                if step % 5 == 3 {
                    let accepted = actual.snapshot();
                    candidate.abort();
                    assert_eq!(actual.snapshot(), accepted);
                    candidate
                        .prepare_scoped(
                            &codec,
                            CAPABILITY,
                            input,
                            checkpoint,
                            step as u32 + 1,
                            scope,
                            false,
                        )
                        .unwrap();
                }
                control
                    .prepare(&codec, CAPABILITY, input, true, step as u32 + 1)
                    .unwrap();
                actual.accept(
                    candidate
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    candidate.publish_bindings,
                );
                expected.accept(
                    control
                        .plan_view(7, CAPABILITY, codec.fingerprint())
                        .unwrap(),
                    control.publish_bindings,
                );
                candidate.commit().unwrap();
                control.commit().unwrap();
                assert_eq!(actual.snapshot(), expected.snapshot(), "step {step}");
                assert_eq!(candidate.instances.len(), glyphs.len());
                old_count = count;
                for instance in candidate.instances.iter() {
                    assert_eq!(
                        instance.stable_id,
                        glyphs[instance.input_index as usize].stable_id
                    );
                }
            }
        }
    }

    #[test]
    fn retained_publication_mutations_match_forced_full_publications() {
        // Fixed seeds make every failure reproducible in the ordinary Rust CI lane. The
        // checkpoint oracle bypasses retained topology and binding elision on every step.
        for material_storage in [false, true] {
            let codec = paint_codec_with_material_storage(material_storage);
            for order_independent in [false, true] {
                for seed in 1_u32..=8 {
                    let mut random = seed;
                    let mut optimized = OrderedPlanCompiler::default();
                    let mut complete = OrderedPlanCompiler::default();
                    let mut host = TestHost::default();
                    let mut oracle = TestHost::default();
                    let mut glyphs = vec![glyph(1, 1), glyph(2, 1), glyph(3, 1)];
                    let mut x = vec![1.0, 2.0, 3.0];
                    let mut next_id = 4;
                    let mut skipped_bindings = 0;
                    for step in 0..128 {
                        random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        let index = (random as usize >> 8) % glyphs.len().max(1);
                        let mut changed = None;
                        let mut topology_changed = false;
                        match (random >> 24) % 12 {
                            0 => {} // An actual no-op must retain accepted bytes and bindings.
                            1 if !glyphs.is_empty() => {
                                glyphs[index].content_revision += 1;
                                x[index] += 0.25;
                                changed = Some((index, 1 << 8));
                            }
                            2 if !glyphs.is_empty() => {
                                glyphs[index].block_start += 1.0;
                                changed = Some((index, 1 << 1));
                            }
                            3 if !glyphs.is_empty() => {
                                glyphs[index].material_id = 1 + random % 3;
                                changed = Some((index, u16::MAX));
                            }
                            4 if !glyphs.is_empty() => {
                                glyphs[index].transform_id = 1 + random % 3;
                                changed = Some((index, u16::MAX));
                            }
                            5 if !glyphs.is_empty() => {
                                glyphs[index].resource_id = 100 + next_id;
                                next_id += 1;
                                glyphs[index].resource_generation += 1;
                                changed = Some((index, u16::MAX));
                            }
                            6 if !glyphs.is_empty() => {
                                glyphs[index].resource_id = 100 + next_id;
                                next_id += 1;
                                glyphs[index].resource_reference += 1;
                                changed = Some((index, u16::MAX));
                            }
                            7 if !glyphs.is_empty() => {
                                glyphs.remove(index);
                                x.remove(index);
                                topology_changed = true;
                            }
                            8 if glyphs.len() > 1 => {
                                glyphs.rotate_left(1);
                                x.rotate_left(1);
                                topology_changed = true;
                            }
                            9 if !glyphs.is_empty() => {
                                glyphs[index].semantic_id = 1 + random % 3;
                                changed = Some((index, 1 << 9));
                            }
                            10 => {
                                glyphs.clear();
                                x.clear();
                                topology_changed = true;
                            }
                            _ => {
                                // Repeated insertion exercises capacity growth and recreation.
                                for _ in 0..1 + random % 4 {
                                    glyphs.push(glyph(next_id, 1));
                                    x.push(next_id as f32);
                                    next_id += 1;
                                }
                                topology_changed = true;
                            }
                        }
                        let mut masks = vec![0; glyphs.len()];
                        if topology_changed {
                            masks.fill(u16::MAX);
                        } else if let Some((index, mask)) = changed {
                            masks[index] = mask;
                        }
                        let checkpoint = step % 17 == 0;
                        let intervals: Vec<_> = changed
                            .into_iter()
                            .map(|(index, _)| index..index + 1)
                            .collect();
                        let prepare_optimized = |compiler: &mut OrderedPlanCompiler| {
                            let placement_slots = vec![0; glyphs.len()];
                            compiler
                                .prepare_scoped(
                                    &codec,
                                    CAPABILITY,
                                    OrderedPlanInput {
                                        glyphs: &glyphs,
                                        placement_slots: &placement_slots,
                                        semantic_change_masks: &masks,
                                        f32_fields: &[&x],
                                        u32_fields: &[],
                                        order_independent,
                                    },
                                    checkpoint,
                                    1,
                                    (!topology_changed && !checkpoint).then_some(
                                        RetainedOutputScope::ChangedIntervals(
                                            intervals.as_slice(),
                                            ChangedInputs::ALL,
                                        ),
                                    ),
                                    false,
                                )
                                .unwrap();
                        };
                        prepare_optimized(&mut optimized);
                        prepare_with_options(
                            &mut complete,
                            &codec,
                            &glyphs,
                            &x,
                            &masks,
                            true,
                            order_independent,
                        );
                        if step % 7 == 0 {
                            let accepted = optimized
                                .buffers
                                .iter()
                                .map(|buffer| (buffer.id, buffer.bytes.clone()))
                                .collect::<Vec<_>>();
                            optimized.abort();
                            complete.abort();
                            assert_eq!(
                                accepted,
                                optimized
                                    .buffers
                                    .iter()
                                    .map(|buffer| (buffer.id, buffer.bytes.clone()))
                                    .collect::<Vec<_>>()
                            );
                            prepare_optimized(&mut optimized);
                            prepare_with_options(
                                &mut complete,
                                &codec,
                                &glyphs,
                                &x,
                                &masks,
                                true,
                                order_independent,
                            );
                        }
                        skipped_bindings += usize::from(!optimized.publish_bindings);
                        let delta = optimized
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap();
                        let full = complete
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap();
                        let mut cold = OrderedPlanCompiler::default();
                        prepare_with_options(
                            &mut cold,
                            &codec,
                            &glyphs,
                            &x,
                            &masks,
                            true,
                            order_independent,
                        );
                        let mut cold_host = TestHost::default();
                        cold_host.accept(
                            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                            true,
                        );
                        plan_layout(delta).unwrap();
                        plan_layout(full).unwrap();
                        host.accept(delta, optimized.publish_bindings);
                        oracle.accept(full, true);
                        assert_eq!(host.resources, oracle.resources, "seed {seed}, step {step}");
                        assert_eq!(host.bindings, oracle.bindings, "seed {seed}, step {step}");
                        assert_eq!(
                            host.primitives, oracle.primitives,
                            "seed {seed}, step {step}"
                        );
                        assert_eq!(host.draws, oracle.draws, "seed {seed}, step {step}");
                        assert_eq!(
                            host.snapshot(),
                            cold_host.snapshot(),
                            "cold seed {seed}, step {step}"
                        );
                        // Capacity slack is not rendered and may retain old bytes. Compare the
                        // active records of each buffer, plus the canonical codec's input bytes.
                        for binding in &host.bindings {
                            let live = binding.live_records as usize * 4;
                            assert_eq!(
                                &host.bytes[&(binding.id, binding.generation)][..live],
                                &oracle.bytes[&(binding.id, binding.generation)][..live],
                                "seed {seed}, step {step}"
                            );
                        }
                        optimized.commit().unwrap();
                        complete.commit().unwrap();
                        assert_eq!(optimized.live_primitives, complete.live_primitives);
                        assert_eq!(optimized.live_draws, complete.live_draws);
                    }
                    assert!(
                        skipped_bindings > 0,
                        "seed {seed}, independent {order_independent} never exercised the skip path"
                    );
                    assert!(
                        optimized.retained_binding_compilation_skips > 0,
                        "seed {seed}, independent {order_independent} never skipped accepted binding compilation"
                    );
                }
            }
        }
    }

    #[test]
    fn ordered_direct_uses_identity_revisions_instead_of_scanning_physical_bytes() {
        let codec = paint_codec_with_material_storage(false);
        let mut compiler = OrderedPlanCompiler::default();
        let x = [1.0, 2.0, 3.0];
        let glyphs = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &codec, &glyphs, &x, true);
        let first = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(first.buffers.len(), 1);
        assert_eq!(first.patches.len(), 2);
        assert_eq!(first.primitives.len(), 1);
        assert_eq!(first.primitives[0].record_count, 3);
        assert_eq!(first.draws.len(), 1);
        assert_eq!(first.draws[0].buffer_count, 1);
        assert_eq!(first.draws[0].resource_count, 1);
        assert!(plan_layout(first).unwrap().byte_length > 144);
        compiler.commit().unwrap();

        let changed_x = [1.0, 20.0, 3.0];
        let changed = [glyph(1, 1), glyph(2, 2), glyph(3, 1)];
        prepare_with_masks(
            &mut compiler,
            &codec,
            &changed,
            &changed_x,
            &[0, 1 << 8, 0],
            false,
        );
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 1);
        assert_eq!(delta.patches[0].destination_offset, 4);
        assert_eq!(delta.patches[0].byte_length, 4);
        assert_eq!(delta.payload.len(), 4);
        assert!(delta.resources.is_empty());
        assert!(delta.buffers.is_empty());
        assert!(delta.primitives.is_empty());
        assert!(delta.draws.is_empty());
        assert_eq!(compiler.retained_binding_compilation_skips, 1);
        compiler.abort();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 2.0);

        prepare_with_masks(
            &mut compiler,
            &codec,
            &changed,
            &changed_x,
            &[0, 1 << 8, 0],
            false,
        );
        let retry = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(retry.patches.len(), 1);
        assert!(retry.resources.is_empty());
        assert!(retry.buffers.is_empty());
        assert!(retry.primitives.is_empty());
        assert!(retry.draws.is_empty());
        assert_eq!(compiler.retained_binding_compilation_skips, 2);
        compiler.commit().unwrap();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 20.0);

        prepare(&mut compiler, &codec, &changed, &changed_x, true);
        let checkpoint = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(!checkpoint.buffers.is_empty());
        assert!(!checkpoint.primitives.is_empty());
        assert!(!checkpoint.draws.is_empty());
        assert_eq!(compiler.retained_binding_compilation_skips, 2);
    }

    #[test]
    fn retained_binding_skip_preserves_later_draw_entries() {
        let codec = paint_codec_with_material_storage(false);
        let mut compiler = OrderedPlanCompiler::default();
        let mut glyphs = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        glyphs[0].transform_id = 1;
        glyphs[1].transform_id = 2;
        glyphs[2].transform_id = 3;
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[0; 3],
                    semantic_change_masks: &[u16::MAX; 3],
                    f32_fields: &[&[1.0, 2.0, 3.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                true,
                1,
            )
            .unwrap();
        assert_eq!(compiler.draws.len(), 3);
        compiler.commit().unwrap();

        glyphs[2].content_revision = 2;
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[0; 3],
                    semantic_change_masks: &[0, 0, 1 << 8],
                    f32_fields: &[&[1.0, 2.0, 30.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                2,
            )
            .unwrap();

        assert_eq!(compiler.retained_binding_compilation_skips, 1);
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 1);
        assert!(delta.primitives.is_empty());
        assert!(delta.draws.is_empty());
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives.len(), 3);
        assert_eq!(compiler.live_draws.len(), 3);
        assert_eq!(compiler.live_primitives[2].id, 3);
        assert_eq!(compiler.live_draws[2].primitive_start, 2);
    }

    #[test]
    fn retained_binding_skip_does_not_scan_one_large_shared_draw() {
        const COUNT: usize = 1_000;
        let codec = paint_codec_with_limits(false, 8 * 1024, false);
        let mut compiler = OrderedPlanCompiler::default();
        let mut glyphs = (1..=COUNT as u32)
            .map(|stable_id| glyph(stable_id, 1))
            .collect::<Vec<_>>();
        let mut x = (1..=COUNT).map(|value| value as f32).collect::<Vec<_>>();
        prepare(&mut compiler, &codec, &glyphs, &x, true);
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives.len(), 1);
        assert_eq!(compiler.live_primitives[0].record_count, COUNT as u16);
        assert_eq!(compiler.live_draws.len(), 1);

        glyphs[777].content_revision = 2;
        x[777] = 7_777.0;
        let mut masks = vec![0; COUNT];
        masks[777] = 1 << 8;
        prepare_with_masks(&mut compiler, &codec, &glyphs, &x, &masks, false);

        assert_eq!(compiler.retained_binding_compilation_skips, 1);
        assert!(compiler.primitives.is_empty());
        assert!(compiler.draws.is_empty());
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 1);
        assert!(delta.primitives.is_empty());
        assert!(delta.draws.is_empty());
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives[0].record_count, COUNT as u16);
        assert_eq!(
            read_f32(compiler.buffer_bytes(1).unwrap(), 777 * 4),
            7_777.0
        );
    }

    #[test]
    fn draw_boundary_split_merge_falls_back_and_survives_abort_retry() {
        let codec = paint_codec_with_limits(false, 65_536, false);
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let mut glyphs: Vec<_> = (0..128).map(|index| glyph(index + 1, 1)).collect();
        glyphs[47].material_id = 2;
        let x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
        let slots = vec![0; glyphs.len()];
        let masks = vec![0; glyphs.len()];
        prepare_with_options(&mut compiler, &codec, &glyphs, &x, &masks, true, true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.live_draws.len(), 3);
        assert_eq!(compiler.blocks.len(), 3);

        // Merging the mid-block material boundary is speculative until accepted.
        glyphs[47].material_id = 1;
        glyphs[47].content_revision = 2;
        let merge = core::iter::once(47..48).collect::<Vec<_>>();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &merge,
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        assert_eq!(compiler.draws.len(), 1);
        assert!(compiler.pending_blocks.len() >= 3);
        compiler.abort();
        assert_eq!(compiler.live_draws.len(), 3);
        assert_eq!(compiler.blocks.len(), 3);

        // A different edit after abort splits the long tail inside a cached block.
        glyphs[47].material_id = 2;
        glyphs[47].content_revision = 1;
        glyphs[88].material_id = 3;
        glyphs[88].content_revision = 2;
        let split = core::iter::once(88..89).collect::<Vec<_>>();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &split,
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        assert_eq!(compiler.draws.len(), 5);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.live_draws.len(), 5);

        glyphs[47].material_id = 1;
        glyphs[47].content_revision = 2;
        glyphs[88].material_id = 1;
        glyphs[88].content_revision = 3;
        let merge_both = [47..48, 88..89];
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                3,
                Some(RetainedOutputScope::ChangedIntervals(
                    &merge_both,
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        assert_eq!(compiler.draws.len(), 1);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.blocks.len(), 4);
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
        for (warm, expected) in compiler.live_primitives.iter().zip(cold.primitives.iter()) {
            assert_eq!(warm.inline_start.to_bits(), expected.inline_start.to_bits());
            assert_eq!(warm.block_start.to_bits(), expected.block_start.to_bits());
            assert_eq!(
                warm.inline_extent.to_bits(),
                expected.inline_extent.to_bits()
            );
            assert_eq!(warm.block_extent.to_bits(), expected.block_extent.to_bits());
        }
    }

    #[test]
    fn independent_order_reuses_bindings_for_instance_only_changes_and_retries() {
        let codec = paint_codec_with_limits(false, 65_536, false);
        let mut compiler = OrderedPlanCompiler::default();
        let mut glyphs: Vec<_> = (0..128).map(|index| glyph(index + 1, 1)).collect();
        let placement_slots = vec![0; glyphs.len()];
        let mut x: Vec<_> = glyphs.iter().map(|row| row.inline_start).collect();
        let mut masks = vec![u16::MAX; glyphs.len()];
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &placement_slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                true,
                1,
            )
            .unwrap();
        compiler.commit().unwrap();
        assert_eq!(compiler.blocks.len(), 4);

        glyphs[1].content_revision = 2;
        x[1] = 20.0;
        masks.fill(0);
        masks[1] = 1 << 8;
        for reject in [true, false] {
            compiler
                .prepare(
                    &codec,
                    CAPABILITY,
                    OrderedPlanInput {
                        glyphs: &glyphs,
                        placement_slots: &placement_slots,
                        semantic_change_masks: &masks,
                        f32_fields: &[&x],
                        u32_fields: &[],
                        order_independent: true,
                    },
                    false,
                    2,
                )
                .unwrap();
            assert!(compiler.reuse_live_bindings);
            assert!(compiler.primitives.is_empty());
            assert!(compiler.draws.is_empty());
            if reject {
                compiler.abort();
            } else {
                compiler.commit().unwrap();
            }
            assert_eq!(compiler.blocks.len(), 4);
        }
        assert_eq!(compiler.retained_binding_compilation_skips, 2);

        glyphs[1].block_start = 3.0;
        glyphs[1].content_revision = 3;
        masks[1] = 0; // Bounds metadata is dirty even with a zero semantic mask.
        let intervals = core::iter::once(1..2).collect::<Vec<_>>();
        super::super::work_attribution::reset();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &placement_slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                3,
                Some(RetainedOutputScope::ChangedIntervals(
                    &intervals,
                    ChangedInputs::ALL,
                )),
                true,
            )
            .unwrap();
        assert_eq!(compiler.retained_binding_compilation_skips, 2);
        assert!(!compiler.reuse_live_bindings);
        assert_eq!(compiler.primitives.len(), 1);
        assert_eq!(compiler.pending_blocks.len(), 4);
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.draw_reduced_glyphs, 32);
        assert_eq!(work.draw_folded_blocks, 3);
        let mut cold = OrderedPlanCompiler::default();
        prepare_with_options(&mut cold, &codec, &glyphs, &x, &masks, true, true);
        for (warm, expected) in compiler.primitives.iter().zip(cold.primitives.iter()) {
            assert_eq!(warm.inline_start.to_bits(), expected.inline_start.to_bits());
            assert_eq!(warm.block_start.to_bits(), expected.block_start.to_bits());
            assert_eq!(
                warm.inline_extent.to_bits(),
                expected.inline_extent.to_bits()
            );
            assert_eq!(warm.block_extent.to_bits(), expected.block_extent.to_bits());
        }
    }

    #[test]
    fn semantic_dependencies_suppress_unrelated_physical_buffer_writes() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0], true);
        compiler.commit().unwrap();

        let mut block_changed = glyph(1, 2);
        block_changed.block_start = 4.0;
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &[block_changed],
                    placement_slots: &[0],
                    semantic_change_masks: &[1 << 1],
                    f32_fields: &[&[1.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                1,
            )
            .unwrap();
        let metadata_delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(metadata_delta.patches.is_empty());
        assert!(!metadata_delta.primitives.is_empty());
        assert!(!metadata_delta.draws.is_empty());
        compiler.commit().unwrap();

        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &[glyph(1, 3)],
                    placement_slots: &[0],
                    semantic_change_masks: &[1],
                    f32_fields: &[&[2.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                1,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(plan.patches.len(), 1);
        assert_eq!(plan.payload, 2.0_f32.to_le_bytes());
    }

    #[test]
    fn derived_bounds_publish_metadata_without_local_instance_changes() {
        let codec = codec();
        for order_independent in [false, true] {
            let mut compiler = OrderedPlanCompiler::default();
            let original = [glyph(1, 1)];
            let mut changed = original;
            changed[0].inline_start = -7.0;
            changed[0].block_start = 11.0;
            fn input(glyphs: &[PlanGlyph], order_independent: bool) -> OrderedPlanInput<'_> {
                OrderedPlanInput {
                    glyphs,
                    placement_slots: &[0],
                    semantic_change_masks: &[0],
                    f32_fields: &[&[1.0]],
                    u32_fields: &[],
                    order_independent,
                }
            }
            compiler
                .prepare(
                    &codec,
                    CAPABILITY,
                    input(&original, order_independent),
                    true,
                    1,
                )
                .unwrap();
            compiler.commit().unwrap();
            let mut cold = OrderedPlanCompiler::default();
            cold.prepare(
                &codec,
                CAPABILITY,
                input(&changed, order_independent),
                true,
                2,
            )
            .unwrap();
            let expected = cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap();
            let expected_primitives = expected.primitives.to_vec();
            let expected_draws = expected.draws.to_vec();
            for reject in [true, false] {
                compiler
                    .prepare_scoped(
                        &codec,
                        CAPABILITY,
                        input(&changed, order_independent),
                        false,
                        2,
                        None,
                        true,
                    )
                    .unwrap();
                let plan = compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap();
                assert!(plan.patches.is_empty());
                assert!(plan.payload.is_empty());
                assert_eq!(plan.primitives, expected_primitives);
                assert_eq!(plan.draws, expected_draws);
                assert_eq!(plan.primitives[0].inline_start, -7.0);
                assert_eq!(plan.primitives[0].block_start, 11.0);
                if reject {
                    compiler.abort();
                } else {
                    compiler.commit().unwrap();
                }
            }
            compiler
                .prepare_scoped(
                    &codec,
                    CAPABILITY,
                    input(&changed, order_independent),
                    false,
                    3,
                    Some(RetainedOutputScope::ChangedIntervals(
                        &[],
                        ChangedInputs::ALL,
                    )),
                    false,
                )
                .unwrap();
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();
            assert!(plan.primitives.is_empty());
            assert!(plan.draws.is_empty());
        }
    }

    #[test]
    fn placement_slot_changes_patch_only_the_occurrence_lane_without_changing_topology() {
        let codec = placement_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let glyphs = [glyph(1, 1)];
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[3],
                    semantic_change_masks: &[u16::MAX],
                    f32_fields: &[&[1.0]],
                    u32_fields: &[&[3]],
                    order_independent: false,
                },
                true,
                1,
            )
            .unwrap();
        let first = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        let placement_buffer = first
            .buffers
            .iter()
            .find(|buffer| buffer.codec_buffer_id == 2)
            .unwrap()
            .id;
        compiler.commit().unwrap();

        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[9],
                    semantic_change_masks: &[0],
                    f32_fields: &[&[1.0]],
                    u32_fields: &[&[9]],
                    order_independent: false,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    core::slice::from_ref(&(0..1)),
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(delta.buffers.is_empty());
        assert!(delta.primitives.is_empty());
        assert!(delta.draws.is_empty());
        assert_eq!(delta.patches.len(), 1);
        assert_eq!(delta.patches[0].buffer_id, placement_buffer);
        assert_eq!(delta.payload, 9_u32.to_le_bytes());
    }

    #[test]
    fn insertion_rewrites_only_the_ordered_batch_suffix_and_abort_preserves_state() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0], true);
        compiler.commit().unwrap();

        let inserted = [glyph(1, 1), glyph(4, 1), glyph(2, 1), glyph(3, 1)];
        prepare(
            &mut compiler,
            &codec,
            &inserted,
            &[1.0, 4.0, 2.0, 3.0],
            false,
        );
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(plan.patches[0].opcode, PATCH_WRITE);
        assert_eq!(plan.patches[0].destination_offset, 4);
        compiler.abort();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 2.0);
    }

    #[test]
    fn no_op_emits_nothing_and_tail_deletion_updates_only_live_metadata() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0], true);
        compiler.commit().unwrap();

        prepare(
            &mut compiler,
            &codec,
            &initial,
            &[999.0, 999.0, 999.0],
            false,
        );
        let no_op = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(no_op.resources.is_empty());
        assert!(no_op.buffers.is_empty());
        assert!(no_op.patches.is_empty());
        assert!(no_op.primitives.is_empty());
        assert!(no_op.draws.is_empty());
        assert!(no_op.payload.is_empty());
        compiler.commit().unwrap();
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 0), 1.0);

        prepare(&mut compiler, &codec, &initial[..2], &[1.0, 2.0], false);
        let shrink = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(shrink.buffers[0].live_records, 2);
        assert!(shrink.patches.is_empty());
        assert_eq!(shrink.retirements.len(), 1);
        assert_eq!(shrink.retirements[0].byte_offset, 8);
        assert_eq!(shrink.retirements[0].byte_length, 4);
    }

    #[test]
    fn equal_physical_patches_compact_payload_across_buffers_and_jobs() {
        let codec = placement_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare_two_fields(
            &mut compiler,
            &codec,
            &initial,
            &[1.0, 2.0, 3.0],
            &[10, 20, 30],
            true,
        );
        let cold = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            cold.patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            2
        );
        host.accept(cold, compiler.publish_bindings);
        compiler.commit().unwrap();

        let changed = [glyph(1, 2), glyph(2, 1), glyph(3, 2)];
        prepare_two_fields(
            &mut compiler,
            &codec,
            &changed,
            &[1.0, 2.0, 3.0],
            &[11, 20, 31],
            false,
        );
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            delta.patches.len(),
            2,
            "equal f32 slices omit both whole writes"
        );
        assert!(
            delta
                .patches
                .iter()
                .all(|patch| patch.opcode == PATCH_WRITE)
        );
        assert_eq!(delta.patches[0].destination_offset, 0);
        assert_eq!(delta.patches[1].destination_offset, 8);
        assert_eq!(delta.patches[0].payload_start, 0);
        assert_eq!(delta.patches[1].payload_start, 4);
        assert_eq!(
            delta.payload,
            [11_u32.to_le_bytes(), 31_u32.to_le_bytes()].concat()
        );
        let layout = plan_layout(delta).unwrap();
        let mut encoded = vec![0; layout.byte_length as usize];
        super::super::render_plan_wire::encode_publication(delta, &[], layout, &mut encoded)
            .unwrap();
        let payload_offset = layout.payload_offset as usize;
        assert_eq!(&encoded[payload_offset..payload_offset + 8], delta.payload);
        host.accept(delta, compiler.publish_bindings);
        compiler.commit().unwrap();

        let mut oracle_compiler = OrderedPlanCompiler::default();
        let mut oracle_host = TestHost::default();
        prepare_two_fields(
            &mut oracle_compiler,
            &codec,
            &changed,
            &[1.0, 2.0, 3.0],
            &[11, 20, 31],
            true,
        );
        oracle_host.accept(
            oracle_compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            oracle_compiler.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle_host.snapshot());
        assert_eq!(
            host.bytes, oracle_host.bytes,
            "capacity tails match cold output"
        );
    }

    #[test]
    fn equal_values_still_write_on_checkpoint_resize_and_regrown_live_tail() {
        let codec = placement_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        let x = [1.0, 2.0, 3.0];
        let occurrence = [10, 20, 30];
        prepare_two_fields(&mut compiler, &codec, &initial, &x, &occurrence, true);
        let cold = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            cold.patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            2
        );
        host.accept(cold, compiler.publish_bindings);
        compiler.commit().unwrap();

        let same_values = [glyph(1, 2), glyph(2, 2), glyph(3, 2)];
        prepare_two_fields(&mut compiler, &codec, &same_values, &x, &occurrence, true);
        let checkpoint = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            checkpoint
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_ALLOCATE_OR_RESIZE)
                .count(),
            2
        );
        assert_eq!(
            checkpoint
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            2
        );
        assert_eq!(checkpoint.payload.len(), 24);
        host.accept(checkpoint, compiler.publish_bindings);
        compiler.commit().unwrap();

        prepare_two_fields(
            &mut compiler,
            &codec,
            &same_values[..2],
            &x[..2],
            &occurrence[..2],
            false,
        );
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();

        prepare_two_fields(&mut compiler, &codec, &same_values, &x, &occurrence, false);
        let regrow = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            regrow.patches.len(),
            2,
            "newly live rows write even when tail bytes match"
        );
        assert_eq!(regrow.payload.len(), 8);
        host.accept(regrow, compiler.publish_bindings);
        compiler.commit().unwrap();

        let larger = [
            glyph(1, 2),
            glyph(2, 2),
            glyph(3, 2),
            glyph(4, 1),
            glyph(5, 1),
        ];
        prepare_two_fields(
            &mut compiler,
            &codec,
            &larger,
            &[1.0, 2.0, 3.0, 4.0, 5.0],
            &[10, 20, 30, 40, 50],
            false,
        );
        let resize = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            resize
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_ALLOCATE_OR_RESIZE)
                .count(),
            2
        );
        assert_eq!(
            resize
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            2
        );
        host.accept(resize, compiler.publish_bindings);
        compiler.commit().unwrap();

        let mut oracle_compiler = OrderedPlanCompiler::default();
        let mut oracle_host = TestHost::default();
        prepare_two_fields(
            &mut oracle_compiler,
            &codec,
            &larger,
            &[1.0, 2.0, 3.0, 4.0, 5.0],
            &[10, 20, 30, 40, 50],
            true,
        );
        oracle_host.accept(
            oracle_compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            oracle_compiler.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle_host.snapshot());
    }

    #[test]
    fn omitted_middle_buffer_moves_later_payload_without_touching_prior_job() {
        let codec = three_field_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let initial = [glyph(1, 1)];
        let changed = [glyph(1, 2)];
        let prepare_fields = |compiler: &mut OrderedPlanCompiler,
                              rows: &[OrderedGlyph],
                              first: &[f32],
                              middle: &[u32],
                              last: &[f32],
                              checkpoint| {
            compiler
                .prepare(
                    &codec,
                    CAPABILITY,
                    OrderedPlanInput {
                        glyphs: rows,
                        placement_slots: &[0],
                        semantic_change_masks: &[u16::MAX],
                        f32_fields: &[first, last],
                        u32_fields: &[middle],
                        order_independent: false,
                    },
                    checkpoint,
                    1,
                )
                .unwrap();
        };
        prepare_fields(&mut compiler, &initial, &[1.0], &[10], &[100.0], true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();

        prepare_fields(&mut compiler, &changed, &[2.0], &[10], &[101.0], false);
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(delta.patches.len(), 2);
        assert_eq!(delta.patches[0].buffer_id, 1);
        assert_eq!(delta.patches[1].buffer_id, 3);
        assert_eq!(delta.patches[0].payload_start, 0);
        assert_eq!(delta.patches[1].payload_start, 4);
        assert_eq!(
            delta.payload,
            [2.0_f32.to_le_bytes(), 101.0_f32.to_le_bytes()].concat()
        );
        plan_layout(delta).unwrap();
        host.accept(delta, compiler.publish_bindings);
        compiler.commit().unwrap();

        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_fields(&mut cold, &changed, &[2.0], &[10], &[101.0], true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.bytes, oracle.bytes);
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn equal_aligned_patch_crossing_live_tail_is_retained() {
        let codec = placement_codec_with_alignment(8);
        let mut compiler = OrderedPlanCompiler::default();
        let rows = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        prepare_two_fields(
            &mut compiler,
            &codec,
            &rows,
            &[1.0, 2.0, 3.0],
            &[10, 20, 30],
            true,
        );
        compiler.commit().unwrap();

        let changed = [glyph(1, 1), glyph(2, 1), glyph(3, 2)];
        prepare_two_fields(
            &mut compiler,
            &codec,
            &changed,
            &[1.0, 2.0, 3.0],
            &[10, 20, 30],
            false,
        );
        let delta = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            delta.patches.len(),
            2,
            "aligned bytes beyond live count must be written"
        );
        assert!(
            delta
                .patches
                .iter()
                .all(|patch| patch.opcode == PATCH_WRITE)
        );
        assert_eq!(delta.payload.len(), 16);
        assert!(
            delta
                .patches
                .iter()
                .all(|patch| patch.destination_offset == 8 && patch.byte_length == 8)
        );
    }

    #[test]
    fn rejected_host_publication_retries_with_checkpoint_writes() {
        let codec = placement_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let initial = [glyph(1, 1)];
        prepare_two_fields(&mut compiler, &codec, &initial, &[1.0], &[10], true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();

        let changed = [glyph(1, 2)];
        prepare_two_fields(&mut compiler, &codec, &changed, &[2.0], &[10], false);
        let rejected = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            rejected.patches.len(),
            1,
            "unchanged second field was omitted"
        );
        // Rust adopts preparation before the renderer accepts it; the host rejects this plan.
        compiler.commit().unwrap();

        prepare_two_fields(&mut compiler, &codec, &changed, &[2.0], &[10], true);
        let retry = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            retry
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_ALLOCATE_OR_RESIZE)
                .count(),
            2
        );
        assert_eq!(
            retry
                .patches
                .iter()
                .filter(|patch| patch.opcode == PATCH_WRITE)
                .count(),
            2
        );
        host.accept(retry, compiler.publish_bindings);
        compiler.commit().unwrap();

        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare_two_fields(&mut cold, &codec, &changed, &[2.0], &[10], true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn retained_host_topology_refreshes_metadata_but_rejects_structural_changes() {
        let codec = codec();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1)];
        let mut compiler = OrderedPlanCompiler::default();
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0], true);
        assert!(
            !compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap()
                .retained_host_topology
        );
        compiler.commit().unwrap();

        let mut changed = initial;
        for item in &mut changed {
            item.stable_id += 100;
            item.content_revision += 1;
            item.semantic_id = 77;
            item.inline_start += 8.0;
            item.inline_extent = 4.0;
        }
        prepare(&mut compiler, &codec, &changed, &[9.0, 10.0, 11.0], false);
        let view = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(view.retained_host_topology);
        assert!(
            !view.primitives.is_empty(),
            "fresh metadata remains observable"
        );
        let mut cold = OrderedPlanCompiler::default();
        prepare(&mut cold, &codec, &changed, &[9.0, 10.0, 11.0], true);
        let control = cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap();
        assert_eq!(view.primitives, control.primitives);
        assert_eq!(view.draws, control.draws);
        compiler.abort();
        assert_eq!(compiler.live_primitives[0].id, 1);

        for edit in 0..4 {
            let mut structural = changed;
            match edit {
                0 => structural[1].material_id = 2,
                1 => structural[1].transform_id = 2,
                2 => structural[1].clip_id = 2,
                _ => structural[1].resource_generation += 1,
            }
            prepare(
                &mut compiler,
                &codec,
                &structural,
                &[9.0, 10.0, 11.0],
                false,
            );
            assert!(
                !compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap()
                    .retained_host_topology
            );
            compiler.abort();
        }
        prepare(&mut compiler, &codec, &changed[..2], &[9.0, 10.0], false);
        assert!(
            !compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap()
                .retained_host_topology
        );
        compiler.abort();
        prepare(&mut compiler, &codec, &changed, &[9.0, 10.0, 11.0], true);
        assert!(
            !compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap()
                .retained_host_topology
        );
    }

    #[test]
    fn interleaved_resources_compile_to_ordered_spans_with_shared_bindings() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        prepare(&mut compiler, &codec, &glyphs, &[1.0, 2.0, 3.0, 4.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(plan.resources.len(), 2);
        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(plan.primitives.len(), 3);
        assert_eq!(plan.draws.len(), 3);
        assert_eq!(
            plan.primitives[plan.draws[0].primitive_start as usize].record_count,
            2
        );
        assert_eq!(plan.primitives[0].record_index, 0);
        assert_eq!(plan.primitives[1].resource_id, 12);
        assert_eq!(plan.primitives[2].resource_id, 11);
        assert_eq!(plan.primitives[2].record_index, 2);
        assert_eq!(plan.draws[0].order_token, 0);
        assert_eq!(plan.draws[1].order_token, 2);
        assert_eq!(plan.draws[2].order_token, 3);
        assert!(plan_layout(plan).is_ok());
        assert!(
            plan.resources
                .iter()
                .all(|resource| resource.action == RESOURCE_ACTION_CREATE)
        );
        let mut host = TestHost::default();
        host.accept(plan, compiler.publish_bindings);
        compiler.commit().unwrap();

        // Moving the first B before A must reject the old input-to-batch mapping and
        // publish the same resource order, draw references and bytes as a cold compiler.
        let reordered = [b, a1, a2, a3];
        let x = [3.0, 1.0, 2.0, 4.0];
        prepare(&mut compiler, &codec, &reordered, &x, false);
        assert_eq!(compiler.retained_topology_preparations, 0);
        let candidate = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(
            candidate
                .resources
                .iter()
                .map(|resource| resource.id)
                .collect::<Vec<_>>(),
            vec![12, 11]
        );
        assert!(
            candidate
                .resources
                .iter()
                .all(|resource| resource.action == RESOURCE_ACTION_RETAIN)
        );
        host.accept(candidate, compiler.publish_bindings);
        compiler.commit().unwrap();
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare(&mut cold, &codec, &reordered, &x, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        cold.commit().unwrap();
        assert_eq!(host.snapshot(), oracle.snapshot());

        let accepted = host.snapshot();
        let mut conflicting = reordered;
        conflicting[2].resource_reference += 1;
        let error = compiler.prepare(
            &codec,
            CAPABILITY,
            OrderedPlanInput {
                glyphs: &conflicting,
                placement_slots: &[0; 4],
                semantic_change_masks: &[],
                f32_fields: &[&x],
                u32_fields: &[],
                order_independent: false,
            },
            false,
            2,
        );
        assert_eq!(error, Err(OrderedPlanError::InvalidResource));
        compiler.abort();
        assert_eq!(host.snapshot(), accepted);
        // A different valid edit after the aborted conflict must not inherit scratch resources.
        let mut retry = reordered;
        retry[0].resource_generation += 1;
        prepare(&mut compiler, &codec, &retry, &x, false);
        let candidate = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(candidate.resources[0].action, RESOURCE_ACTION_CREATE);
        assert_eq!(candidate.resources[1].action, RESOURCE_ACTION_RETAIN);
        host.accept(candidate, compiler.publish_bindings);
        compiler.commit().unwrap();
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare(&mut cold, &codec, &retry, &x, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        cold.commit().unwrap();
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn independent_compositing_batches_interleaved_resources() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[0; 4],
                    semantic_change_masks: &[],
                    f32_fields: &[&[1.0, 2.0, 3.0, 4.0]],
                    u32_fields: &[],
                    order_independent: true,
                },
                true,
                1,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(plan.draws.len(), 2);
        assert_eq!(plan.primitives.len(), 2);
        assert_eq!(plan.primitives[0].resource_id, 11);
        assert_eq!(plan.primitives[0].record_count, 3);
        assert_eq!(plan.primitives[1].resource_id, 12);
        assert_eq!(plan.primitives[1].record_count, 1);
        assert_eq!(plan.draws[0].order_token, 0);
        assert_eq!(plan.draws[1].order_token, 2);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn ordered_compositing_splits_a_draw_at_every_interleaved_resource() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let a1 = glyph(1, 1);
        let a2 = glyph(2, 1);
        let mut b = glyph(3, 1);
        b.resource_id = 12;
        b.resource_reference = 100;
        let a3 = glyph(4, 1);
        let glyphs = [a1, a2, b, a3];
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[0; 4],
                    semantic_change_masks: &[],
                    f32_fields: &[&[1.0, 2.0, 3.0, 4.0]],
                    u32_fields: &[],
                    order_independent: false,
                },
                true,
                1,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        // Three draws for one face change, against two under independent compositing.
        // A stacked paragraph pays this at every face boundary.
        assert_eq!(plan.draws.len(), 3);
        assert_eq!(plan.primitives.len(), 3);
        assert_eq!(plan.primitives[0].resource_id, 11);
        assert_eq!(plan.primitives[0].record_count, 2);
        assert_eq!(plan.primitives[1].resource_id, 12);
        assert_eq!(plan.primitives[1].record_count, 1);
        assert_eq!(plan.primitives[2].resource_id, 11);
        assert_eq!(plan.primitives[2].record_count, 1);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn independent_compositing_flattens_paint_layers_and_preserves_layer_order() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut over = glyph(1, 1);
        over.depth_key = 2;
        let mut under_a = glyph(2, 1);
        under_a.depth_key = 0;
        let mut content = glyph(3, 1);
        content.depth_key = 1;
        let mut under_b = glyph(4, 1);
        under_b.depth_key = 0;
        let glyphs = [over, under_a, content, under_b];
        compiler
            .prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &glyphs,
                    placement_slots: &[0; 4],
                    semantic_change_masks: &[],
                    f32_fields: &[&[1.0, 2.0, 3.0, 4.0]],
                    u32_fields: &[],
                    order_independent: true,
                },
                true,
                1,
            )
            .unwrap();
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(plan.draws.len(), 3);
        assert_eq!(
            plan.draws
                .iter()
                .map(|draw| (draw.depth_key, draw.order_token))
                .collect::<Vec<_>>(),
            vec![(0, 1), (1, 2), (2, 0)]
        );
        assert_eq!(
            plan.primitives[plan.draws[0].primitive_start as usize].record_count,
            2
        );
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn ordered_compositing_keeps_authored_order_across_paint_layers() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut over = glyph(1, 1);
        over.depth_key = 2;
        let mut under = glyph(2, 1);
        under.depth_key = 0;
        let mut content = glyph(3, 1);
        content.depth_key = 1;
        let glyphs = [over, under, content];
        prepare(&mut compiler, &codec, &glyphs, &[1.0, 2.0, 3.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(
            plan.draws
                .iter()
                .map(|draw| (draw.depth_key, draw.order_token))
                .collect::<Vec<_>>(),
            vec![(2, 0), (0, 1), (1, 2)]
        );
    }

    #[test]
    fn material_identity_splits_draws_without_splitting_physical_storage() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &codec, &glyphs, &[1.0, 2.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(plan.buffers.len(), 1);
        assert_eq!(plan.primitives.len(), 2);
        assert_eq!(plan.draws.len(), 2);
        assert_eq!(plan.draws[0].material_id, 1);
        assert_eq!(plan.draws[1].material_id, 2);
        assert_eq!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn codec_selects_draw_split_or_instance_transform_indirection() {
        let mut glyphs = [glyph(1, 1), glyph(2, 1)];
        glyphs[1].transform_id = 2;
        for (split_transform, expected) in [(true, &[1, 2][..]), (false, &[0][..])] {
            let codec = codec_with_options(false, 1024, split_transform);
            let mut compiler = OrderedPlanCompiler::default();
            prepare(&mut compiler, &codec, &glyphs, &[1.0, 2.0], true);
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();
            assert_eq!(
                plan.draws
                    .iter()
                    .map(|draw| draw.transform_id)
                    .collect::<Vec<_>>(),
                expected
            );
            assert_eq!(
                plan.primitives
                    .iter()
                    .map(|item| item.record_count)
                    .sum::<u16>(),
                2
            );
        }
    }

    #[test]
    fn codec_can_partition_physical_storage_by_material() {
        let codec = codec_with_material_storage(true);
        let mut compiler = OrderedPlanCompiler::default();
        let first = glyph(1, 1);
        let mut second = glyph(2, 1);
        second.material_id = 2;
        let glyphs = [first, second];
        prepare(&mut compiler, &codec, &glyphs, &[1.0, 2.0], true);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(
            plan.resources.len(),
            1,
            "material batches share one resource lifecycle"
        );
        assert_eq!(plan.draws.len(), 2);
        assert_ne!(plan.draws[0].buffer_start, plan.draws[1].buffer_start);
        assert!(plan_layout(plan).is_ok());
    }

    #[test]
    fn retained_topology_requires_unchanged_physical_storage_membership() {
        let codec = codec_with_material_storage(true);
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0], true);
        compiler.commit().unwrap();

        let content_changed = [glyph(1, 2), glyph(2, 1)];
        prepare(&mut compiler, &codec, &content_changed, &[10.0, 2.0], false);
        assert_eq!(compiler.retained_topology_preparations, 1);
        compiler.commit().unwrap();

        let mut moved_material = glyph(2, 2);
        moved_material.material_id = 2;
        let storage_changed = [glyph(1, 2), moved_material];
        prepare(
            &mut compiler,
            &codec,
            &storage_changed,
            &[10.0, 20.0],
            false,
        );
        assert_eq!(compiler.retained_topology_preparations, 1);
        let plan = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(plan.buffers.len(), 2);
        assert_eq!(plan.draws.len(), 2);
    }

    #[test]
    fn late_complete_admission_miss_discards_staged_rope_and_matches_cold_host() {
        let codec = codec_with_material_storage(true);
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let mut glyphs: Vec<_> = (1..=65).map(|id| glyph(id, 1)).collect();
        let mut x: Vec<_> = (1..=65).map(|id| id as f32).collect();
        prepare(&mut compiler, &codec, &glyphs, &x, true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        let accepted_root = compiler.instances.clone();
        let retained_preparations = compiler.retained_topology_preparations;
        for (glyph, value) in glyphs[..64].iter_mut().zip(&mut x[..64]) {
            glyph.content_revision += 1;
            *value += 0.25;
        }
        glyphs[64].material_id = 2;
        x[64] += 0.5;
        super::super::work_attribution::reset();
        prepare(&mut compiler, &codec, &glyphs, &x, false);
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.ordered_admission_visits, 130);
        assert_eq!(work.ordered_instance_rewrites, 129);
        assert_eq!(compiler.dirty_instances.len(), 65);
        assert_eq!(
            compiler.retained_topology_preparations,
            retained_preparations
        );
        assert_eq!(compiler.instances, accepted_root);
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare(&mut cold, &codec, &glyphs, &x, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
        compiler.abort();
        assert_eq!(compiler.instances, accepted_root);
        prepare(&mut compiler, &codec, &glyphs, &x, false);
        compiler.commit().unwrap();
        assert_eq!(compiler.instances.len(), glyphs.len());
    }

    #[test]
    fn all_dirty_fragmented_root_repacks_computed_states_without_rederivation() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut host = TestHost::default();
        let mut glyphs: Vec<_> = (1..=65).map(|id| glyph(id, 1)).collect();
        let mut x: Vec<_> = (1..=65).map(|id| id as f32).collect();
        prepare(&mut compiler, &codec, &glyphs, &x, true);
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        let mut fragmented = RetainedRope::default();
        for state in compiler.instances.iter() {
            fragmented.push(*state).unwrap();
        }
        assert!(!fragmented.is_exact_shape());
        compiler.instances = fragmented.clone();
        for (glyph, value) in glyphs.iter_mut().zip(&mut x) {
            glyph.content_revision += 1;
            *value += 0.25;
        }
        super::super::work_attribution::reset();
        prepare(&mut compiler, &codec, &glyphs, &x, false);
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.ordered_state_derivations, glyphs.len());
        assert_eq!(work.ordered_repacks, 1);
        assert!(work.ordered_shape_nodes > 0);
        assert!(compiler.pending_instances.is_exact_shape());
        assert_eq!(compiler.instances, fragmented);
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare(&mut cold, &codec, &glyphs, &x, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn glyph_spans_split_at_the_wire_record_limit() {
        for order_independent in [false, true] {
            let codec = codec_with_limits(false, 512 * 1024);
            let mut compiler = OrderedPlanCompiler::default();
            let mut glyphs: Vec<_> = (1..=u32::from(u16::MAX) + 1)
                .map(|stable_id| glyph(stable_id, 1))
                .collect();
            let x = vec![0.0; glyphs.len()];
            prepare_with_options(
                &mut compiler,
                &codec,
                &glyphs,
                &x,
                &[],
                true,
                order_independent,
            );
            let plan = compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap();

            assert_eq!(plan.primitives.len(), 2);
            assert_eq!(plan.primitives[0].record_count, u16::MAX);
            assert_eq!(plan.primitives[1].record_count, 1);
            assert_eq!(plan.primitives[1].record_index, u32::from(u16::MAX));
            assert_eq!(plan.draws.len(), 2);
            assert!(plan_layout(plan).is_ok());
            let mut host = TestHost::default();
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();

            let glyph_count = glyphs.len();
            glyphs[0].stable_id += glyph_count as u32;
            glyphs[0].content_revision += 1;
            let slots = vec![0; glyphs.len()];
            let masks = vec![0; glyphs.len()];
            let intervals = core::iter::once(0..1).collect::<Vec<_>>();
            super::super::work_attribution::reset();
            compiler
                .prepare_scoped(
                    &codec,
                    CAPABILITY,
                    OrderedPlanInput {
                        glyphs: &glyphs,
                        placement_slots: &slots,
                        semantic_change_masks: &masks,
                        f32_fields: &[&x],
                        u32_fields: &[],
                        order_independent,
                    },
                    false,
                    2,
                    Some(RetainedOutputScope::ChangedIntervals(
                        &intervals,
                        ChangedInputs::ALL,
                    )),
                    false,
                )
                .unwrap();
            let work = super::super::work_attribution::snapshot();
            if order_independent {
                assert_eq!(work.draw_reduced_glyphs, 63);
                assert_eq!(work.draw_folded_blocks, 2046);
                assert_eq!(compiler.pending_blocks.len(), 2047);
            } else {
                assert_eq!(work.draw_reduced_glyphs, usize::from(u16::MAX));
                assert_eq!(work.draw_folded_blocks, 0);
                assert!(compiler.pending_blocks.is_empty());
            }
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();
            let mut cold = OrderedPlanCompiler::default();
            let mut oracle = TestHost::default();
            prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, order_independent);
            oracle.accept(
                cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                cold.publish_bindings,
            );
            assert_eq!(host.snapshot(), oracle.snapshot());
            for (warm, expected) in compiler.live_primitives.iter().zip(cold.primitives.iter()) {
                assert_eq!(warm.inline_start.to_bits(), expected.inline_start.to_bits());
                assert_eq!(warm.block_start.to_bits(), expected.block_start.to_bits());
                assert_eq!(
                    warm.inline_extent.to_bits(),
                    expected.inline_extent.to_bits()
                );
                assert_eq!(warm.block_extent.to_bits(), expected.block_extent.to_bits());
            }
        }
    }

    #[test]
    fn order_only_permutation_falls_back_when_one_batch_contains_multiple_draws() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        initial[2].semantic_id = 2;
        initial[3].semantic_id = 2;
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0, 4.0], true);
        compiler.commit().unwrap();
        let buffer_id = compiler.buffers[0].id;
        let mut first_primitive = compiler.live_primitives[0];
        first_primitive.record_count = 2;
        first_primitive.semantic_id = 1;
        let mut second_primitive = first_primitive;
        second_primitive.id = 3;
        second_primitive.record_index = 2;
        second_primitive.logical_order = 2;
        second_primitive.semantic_id = 2;
        compiler.live_primitives = vec![first_primitive, second_primitive];
        let mut first_draw = compiler.live_draws[0];
        first_draw.primitive_count = 1;
        let mut second_draw = first_draw;
        second_draw.id = 3;
        second_draw.primitive_start = 1;
        second_draw.order_token = 2;
        compiler.live_draws = vec![first_draw, second_draw];
        assert_eq!(compiler.live_primitives.len(), 2);
        assert_eq!(compiler.live_draws.len(), 2);

        assert!(
            !compiler
                .prepare_reorder(&codec, CAPABILITY, &[3, 4, 1, 2], 2)
                .unwrap()
        );
        assert_eq!(read_f32(compiler.buffer_bytes(buffer_id).unwrap(), 0), 1.0);
        assert_eq!(read_f32(compiler.buffer_bytes(buffer_id).unwrap(), 4), 2.0);
        assert_eq!(read_f32(compiler.buffer_bytes(buffer_id).unwrap(), 8), 3.0);
        assert_eq!(read_f32(compiler.buffer_bytes(buffer_id).unwrap(), 12), 4.0);
    }

    #[test]
    fn order_only_permutation_falls_back_for_changed_or_duplicate_requested_identities() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0, 4.0], true);
        compiler.commit().unwrap();

        assert!(
            !compiler
                .prepare_reorder(&codec, CAPABILITY, &[3, 4, 1, 5], 2)
                .unwrap()
        );
        assert!(
            !compiler
                .prepare_reorder(&codec, CAPABILITY, &[3, 3, 1, 2], 2)
                .unwrap()
        );

        prepare(
            &mut compiler,
            &codec,
            &initial,
            &[1.0, 2.0, 3.0, 4.0],
            false,
        );
        assert_eq!(compiler.retained_topology_preparations, 1);
        compiler.commit().unwrap();
    }

    #[test]
    fn multileaf_rank_reorder_packs_chunks_and_matches_cold_publication() {
        let codec = codec();
        for count in [33, 64, 65, 129] {
            let mut compiler = OrderedPlanCompiler::default();
            let mut host = TestHost::default();
            let mut glyphs: Vec<_> = (1..=count).map(|id| glyph(id, 1)).collect();
            let mut x: Vec<_> = (1..=count).map(|id| id as f32).collect();
            prepare_with_options(&mut compiler, &codec, &glyphs, &x, &[], true, true);
            host.accept(
                compiler
                    .plan_view(7, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                compiler.publish_bindings,
            );
            compiler.commit().unwrap();
            assert_eq!(compiler.blocks.len(), count as usize / DRAW_BLOCK_SLOTS);
            let accepted = host.snapshot();
            let accepted_bytes: Vec<_> = compiler
                .buffers
                .iter()
                .map(|buffer| (buffer.id, buffer.generation, buffer.bytes.clone()))
                .collect();
            glyphs.rotate_left(17);
            x.rotate_left(17);
            let ids: Vec<_> = glyphs.iter().map(|glyph| glyph.stable_id).collect();
            for abort in [true, false] {
                super::super::work_attribution::reset();
                assert!(
                    compiler
                        .prepare_reorder(&codec, CAPABILITY, &ids, 2)
                        .unwrap()
                );
                let work = super::super::work_attribution::snapshot();
                assert_eq!(work.rope_record_pushes, 0);
                assert_eq!(work.rope_bulk_records, count as usize);
                assert_eq!(
                    work.rope_bulk_chunks,
                    (count as usize).div_ceil(LEAF_CAPACITY)
                );
                if abort {
                    compiler.abort();
                    assert_eq!(host.snapshot(), accepted);
                    assert_eq!(compiler.blocks.len(), count as usize / DRAW_BLOCK_SLOTS);
                    assert_eq!(
                        compiler
                            .buffers
                            .iter()
                            .map(|buffer| (buffer.id, buffer.generation, buffer.bytes.clone()))
                            .collect::<Vec<_>>(),
                        accepted_bytes
                    );
                } else {
                    host.accept(
                        compiler
                            .plan_view(7, CAPABILITY, codec.fingerprint())
                            .unwrap(),
                        compiler.publish_bindings,
                    );
                    compiler.commit().unwrap();
                    assert!(compiler.blocks.is_empty());
                }
            }
            let mut cold = OrderedPlanCompiler::default();
            let mut oracle = TestHost::default();
            prepare_with_options(&mut cold, &codec, &glyphs, &x, &[], true, true);
            oracle.accept(
                cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
                cold.publish_bindings,
            );
            let actual = host.snapshot();
            let mut expected = oracle.snapshot();
            assert_eq!(actual.primitives.len(), 1);
            assert_eq!(actual.draws.len(), 1);
            assert_eq!(actual.primitives[0].id, accepted.primitives[0].id);
            assert_eq!(actual.draws[0].id, accepted.draws[0].id);
            assert_eq!(expected.primitives[0].id, ids[0]);
            assert_eq!(expected.draws[0].id, ids[0]);
            // The retained host keeps its aggregate binding identities; the cold
            // compiler derives them from the new first glyph. All other fields agree.
            expected.primitives[0].id = actual.primitives[0].id;
            expected.draws[0].id = actual.draws[0].id;
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn order_only_round_trip_preserves_an_aggregate_primitive_span() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0, 4.0], true);
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives.len(), 1);
        assert_eq!(compiler.live_primitives[0].record_index, 0);
        assert_eq!(compiler.live_primitives[0].record_count, 4);

        assert!(
            compiler
                .prepare_reorder(&codec, CAPABILITY, &[3, 4, 1, 2], 2)
                .unwrap()
        );
        assert_eq!(compiler.pending_order_independent, None);
        compiler.abort();
        assert_eq!(compiler.committed_order_independent, Some(false));
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 0), 1.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 2.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 8), 3.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 12), 4.0);

        assert!(
            compiler
                .prepare_reorder(&codec, CAPABILITY, &[3, 4, 1, 2], 2)
                .unwrap()
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.committed_order_independent, None);
        assert_eq!(compiler.live_primitives[0].record_index, 0);
        assert_eq!(compiler.live_primitives[0].record_count, 4);
        assert_eq!(compiler.live_primitives[0].id, 3);
        assert_eq!(compiler.live_draws[0].id, 3);

        let reordered = [glyph(3, 1), glyph(4, 1), glyph(1, 1), glyph(2, 1)];
        prepare(
            &mut compiler,
            &codec,
            &reordered,
            &[3.0, 4.0, 1.0, 2.0],
            false,
        );
        assert_eq!(compiler.retained_topology_preparations, 1);
        let retained = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert!(retained.primitives.is_empty());
        assert!(retained.draws.is_empty());
        compiler.commit().unwrap();

        assert!(
            compiler
                .prepare_reorder(&codec, CAPABILITY, &[1, 2, 3, 4], 3)
                .unwrap()
        );
        compiler.commit().unwrap();
        assert_eq!(compiler.live_primitives[0].record_index, 0);
        assert_eq!(compiler.live_primitives[0].record_count, 4);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 0), 1.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 4), 2.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 8), 3.0);
        assert_eq!(read_f32(compiler.buffer_bytes(1).unwrap(), 12), 4.0);
    }

    #[test]
    fn repeated_warm_updates_keep_every_glyph_scaled_scratch_capacity() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1), glyph(2, 1), glyph(3, 1), glyph(4, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0, 2.0, 3.0, 4.0], true);
        compiler.commit().unwrap();
        let changed = [glyph(1, 1), glyph(2, 2), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &codec,
            &changed,
            &[1.0, 20.0, 3.0, 4.0],
            false,
        );
        compiler.commit().unwrap();
        let settled = capacities(&compiler);
        let changed_again = [glyph(1, 1), glyph(2, 3), glyph(3, 1), glyph(4, 1)];
        prepare(
            &mut compiler,
            &codec,
            &changed_again,
            &[1.0, 21.0, 3.0, 4.0],
            false,
        );
        compiler.commit().unwrap();
        assert_eq!(capacities(&compiler), settled);
    }

    #[test]
    fn commit_preflight_rejects_invalid_range_and_reserves_commit_destinations() {
        let codec = codec();
        let mut compiler = OrderedPlanCompiler::default();
        let initial = [glyph(1, 1)];
        prepare(&mut compiler, &codec, &initial, &[1.0], true);
        compiler.commit().unwrap();
        let committed = compiler.buffer_bytes(1).unwrap().to_vec();

        let changed = [glyph(1, 2)];
        prepare(&mut compiler, &codec, &changed, &[2.0], false);
        let patch_index = (compiler.pending_batches[0].patch_start
            ..compiler.pending_batches[0].patch_end)
            .find(|&index| compiler.patches[index].opcode == PATCH_WRITE)
            .unwrap();
        compiler.patches[patch_index].payload_start = u32::MAX;
        assert_eq!(
            compiler.commit(),
            Err(OrderedPlanError::InvalidIdentity),
            "bad pending write range must fail before the accepted buffers are swapped"
        );
        assert_eq!(compiler.buffer_bytes(1), Some(committed.as_slice()));
        compiler.abort();

        // A later valid preparation still commits to the same output as a cold compile.
        let retried = [glyph(1, 2)];
        prepare(&mut compiler, &codec, &retried, &[2.0], true);
        compiler.preflight_commit().unwrap();
        let output_buffer_count: usize = compiler
            .pending_batches
            .iter()
            .map(|batch| usize::from(batch.state.buffer_count))
            .sum();
        assert!(compiler.spare_buffers.capacity() >= output_buffer_count);
        assert!(compiler.spare_batches.capacity() >= compiler.pending_batches.len());
        let buffer_capacity = compiler.spare_buffers.capacity();
        let batch_capacity = compiler.spare_batches.capacity();
        compiler.commit_preflighted();
        assert_eq!(compiler.buffers.capacity(), buffer_capacity);
        assert_eq!(compiler.batches.capacity(), batch_capacity);
        let mut cold = OrderedPlanCompiler::default();
        prepare(&mut cold, &codec, &retried, &[2.0], true);
        cold.commit().unwrap();
        assert_eq!(compiler.buffer_bytes(1), cold.buffer_bytes(1));
    }

    #[test]
    fn cached_physical_blocks_match_original_sequential_float_bits_and_errors() {
        fn original_bounds(rows: &[OrderedGlyph]) -> Result<[u32; 4], OrderedPlanError> {
            let first = rows[0];
            let mut inline_start = first.inline_start;
            let mut block_start = first.block_start;
            let mut inline_end = first.inline_start + first.inline_extent;
            let mut block_end = first.block_start + first.block_extent;
            for row in &rows[1..] {
                inline_start = inline_start.min(row.inline_start);
                block_start = block_start.min(row.block_start);
                inline_end = inline_end.max(row.inline_start + row.inline_extent);
                block_end = block_end.max(row.block_start + row.block_extent);
            }
            let inline_extent = inline_end - inline_start;
            let block_extent = block_end - block_start;
            if !inline_extent.is_finite() || !block_extent.is_finite() {
                return Err(OrderedPlanError::InvalidInputShape);
            }
            Ok([
                inline_start.to_bits(),
                block_start.to_bits(),
                inline_extent.to_bits(),
                block_extent.to_bits(),
            ])
        }
        fn published_bits(compiler: &OrderedPlanCompiler) -> [u32; 4] {
            let primitive = compiler.primitives[0];
            [
                primitive.inline_start.to_bits(),
                primitive.block_start.to_bits(),
                primitive.inline_extent.to_bits(),
                primitive.block_extent.to_bits(),
            ]
        }
        let codec = paint_codec_with_limits(false, 65_536, true);
        for (case, baseline, edited) in [
            ("positive_zero", (0.0, 0.0), (0.0, 0.0)),
            ("negative_zero", (-0.0, -0.0), (-0.0, -0.0)),
            ("mixed_final_zero", (0.0, 0.0), (-0.0, -0.0)),
            ("mixed_nonzero_extrema", (0.0, 0.0), (-0.0, 0.0)),
            ("nan", (0.0, 0.0), (f32::NAN, 0.0)),
            ("infinity", (0.0, 0.0), (f32::INFINITY, 0.0)),
            ("overflow_endpoint", (0.0, 0.0), (f32::MAX, f32::MAX)),
        ] {
            let mut rows: Vec<_> = (0..128)
                .map(|index| {
                    let mut row = glyph(index + 1, 1);
                    row.inline_start = baseline.0;
                    row.block_start = baseline.0;
                    row.inline_extent = baseline.1;
                    row.block_extent = baseline.1;
                    row
                })
                .collect();
            if case == "mixed_nonzero_extrema" {
                rows[0].inline_start = -5.0;
                rows[0].block_start = -5.0;
                rows[0].inline_extent = 10.0;
                rows[0].block_extent = 10.0;
            }
            let x = vec![0.0; rows.len()];
            let slots = vec![0; rows.len()];
            let masks = vec![0; rows.len()];
            let mut compiler = OrderedPlanCompiler::default();
            prepare_with_options(&mut compiler, &codec, &rows, &x, &masks, true, true);
            assert_eq!(
                published_bits(&compiler),
                original_bounds(&rows).unwrap(),
                "{case} cold"
            );
            compiler.commit().unwrap();
            assert_eq!(compiler.blocks.len(), 4, "{case} cache construction");
            rows[40].inline_start = edited.0;
            rows[40].block_start = edited.0;
            rows[40].inline_extent = edited.1;
            rows[40].block_extent = edited.1;
            rows[40].content_revision += 1;
            let intervals = core::iter::once(40..41).collect::<Vec<_>>();
            super::super::work_attribution::reset();
            let result = compiler.prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &rows,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &intervals,
                    ChangedInputs::ALL,
                )),
                true,
            );
            let expected = original_bounds(&rows);
            assert_eq!(
                result.as_ref().err(),
                expected.as_ref().err(),
                "{case} warm error"
            );
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.draw_folded_blocks, 3, "{case} cache fold");
            if let Ok(bits) = expected {
                assert_eq!(published_bits(&compiler), bits, "{case} warm bits");
            }
            if matches!(
                case,
                "mixed_final_zero" | "nan" | "infinity" | "overflow_endpoint"
            ) {
                assert_eq!(work.draw_reduced_glyphs, 32 + 128, "{case} replay");
            } else {
                assert_eq!(work.draw_reduced_glyphs, 32, "{case} row reductions");
            }
            compiler.abort();
            let mut cold = OrderedPlanCompiler::default();
            let cold_result = cold.prepare(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &rows,
                    placement_slots: &slots,
                    semantic_change_masks: &masks,
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: true,
                },
                true,
                1,
            );
            assert_eq!(
                cold_result.as_ref().err(),
                result.as_ref().err(),
                "{case} cold error"
            );
            if let Ok(bits) = original_bounds(&rows) {
                assert_eq!(published_bits(&cold), bits, "{case} cold bits");
            }
        }
    }

    fn prepare(
        compiler: &mut OrderedPlanCompiler,
        codec: &ValidatedCodec,
        glyphs: &[OrderedGlyph],
        x: &[f32],
        checkpoint: bool,
    ) {
        prepare_with_masks(compiler, codec, glyphs, x, &[], checkpoint);
    }

    fn prepare_two_fields(
        compiler: &mut OrderedPlanCompiler,
        codec: &ValidatedCodec,
        glyphs: &[OrderedGlyph],
        x: &[f32],
        occurrence: &[u32],
        checkpoint: bool,
    ) {
        let placement_slots = vec![0; glyphs.len()];
        let semantic_change_masks = vec![u16::MAX; glyphs.len()];
        compiler
            .prepare(
                codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs,
                    placement_slots: &placement_slots,
                    semantic_change_masks: &semantic_change_masks,
                    f32_fields: &[x],
                    u32_fields: &[occurrence],
                    order_independent: false,
                },
                checkpoint,
                1,
            )
            .unwrap();
    }

    fn prepare_with_masks(
        compiler: &mut OrderedPlanCompiler,
        codec: &ValidatedCodec,
        glyphs: &[OrderedGlyph],
        x: &[f32],
        semantic_change_masks: &[u16],
        checkpoint: bool,
    ) {
        prepare_with_options(
            compiler,
            codec,
            glyphs,
            x,
            semantic_change_masks,
            checkpoint,
            false,
        );
    }

    fn prepare_with_options(
        compiler: &mut OrderedPlanCompiler,
        codec: &ValidatedCodec,
        glyphs: &[OrderedGlyph],
        x: &[f32],
        semantic_change_masks: &[u16],
        checkpoint: bool,
        order_independent: bool,
    ) {
        let placement_slots = vec![0; glyphs.len()];
        compiler
            .prepare(
                codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs,
                    placement_slots: &placement_slots,
                    semantic_change_masks,
                    f32_fields: &[x],
                    u32_fields: &[],
                    order_independent,
                },
                checkpoint,
                1,
            )
            .unwrap();
    }

    fn glyph(stable_id: u32, content_revision: u32) -> OrderedGlyph {
        OrderedGlyph {
            stable_id,
            content_revision,
            technique: TECHNIQUE,
            program_variant: 0,
            resource_id: 11,
            resource_generation: 1,
            resource_kind: 1,
            resource_reference: 99,
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
        codec_with_material_storage(false)
    }

    fn placement_codec() -> ValidatedCodec {
        placement_codec_with_alignment(4)
    }

    fn placement_codec_with_alignment(update_alignment: u32) -> ValidatedCodec {
        let mut descriptor = descriptor_with_options(false, 1024, true);
        descriptor.capability_sets[0].update_alignment = update_alignment;
        let program = &mut descriptor.programs[0];
        program.capability_set = CAPABILITY;
        program.u32_input_count = 1;
        program
            .inputs
            .push(crate::engine::codec::InputSource::semantic(8));
        program.buffers.push(BufferSchema::packed(
            BufferId(2),
            ScalarType::U32,
            1,
            BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
            1,
        ));
        program.operations.extend([
            Operation::LoadU32 {
                target: 1,
                field: 0,
            },
            Operation::StoreU32 {
                source: 1,
                buffer: BufferId(2),
                lane: 0,
            },
        ]);
        descriptor.capability_sets[0].max_buffers_per_draw = 2;
        ValidatedCodec::new(descriptor).unwrap()
    }

    fn three_field_codec() -> ValidatedCodec {
        let mut descriptor = descriptor_with_options(false, 1024, true);
        let program = &mut descriptor.programs[0];
        program.capability_set = CAPABILITY;
        program.f32_input_count = 2;
        program.u32_input_count = 1;
        program
            .inputs
            .push(crate::engine::codec::InputSource::semantic(1));
        program
            .inputs
            .push(crate::engine::codec::InputSource::semantic(8));
        program.buffers.push(BufferSchema::packed(
            BufferId(2),
            ScalarType::U32,
            1,
            BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
            1,
        ));
        program.buffers.push(BufferSchema::packed(
            BufferId(3),
            ScalarType::F32,
            1,
            BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
            1,
        ));
        program.operations.extend([
            Operation::LoadU32 {
                target: 1,
                field: 0,
            },
            Operation::StoreU32 {
                source: 1,
                buffer: BufferId(2),
                lane: 0,
            },
            Operation::LoadF32 {
                target: 2,
                field: 1,
            },
            Operation::StoreF32 {
                source: 2,
                buffer: BufferId(3),
                lane: 0,
            },
        ]);
        descriptor.capability_sets[0].max_buffers_per_draw = 3;
        ValidatedCodec::new(descriptor).unwrap()
    }

    const DECORATION_TECHNIQUE: TechniqueId = TechniqueId(99);

    fn decoration_row(stable_id: u32) -> OrderedGlyph {
        OrderedGlyph {
            stable_id,
            content_revision: 1,
            technique: DECORATION_TECHNIQUE,
            program_variant: 0,
            resource_id: 0,
            resource_generation: 0,
            resource_kind: 0,
            resource_reference: 0,
            semantic_id: stable_id,
            transform_id: 1,
            material_id: 1,
            clip_id: 0,
            depth_key: 0,
            inline_start: 4.0,
            block_start: 9.0,
            inline_extent: 12.0,
            block_extent: 0.5,
        }
    }

    /// Standard descriptor plus one resource-free decoration program.
    fn decoration_codec() -> ValidatedCodec {
        let mut descriptor = descriptor_with_options(false, 1024, true);
        let mut program = descriptor.programs[0].clone();
        program.primitive_kind = PRIMITIVE_DECORATION;
        program.technique = DECORATION_TECHNIQUE;
        program.id = ProgramId(9);
        program.resource_kind_mask = 0;
        program.buffers[0].id = BufferId(9);
        for operation in &mut program.operations {
            if let Operation::StoreF32 { buffer, .. } = operation {
                *buffer = BufferId(9);
            }
        }
        descriptor.programs.push(program);
        ValidatedCodec::new(descriptor).unwrap()
    }

    #[test]
    fn decoration_rows_pack_and_draw_without_resources() {
        let codec = decoration_codec();
        let mut compiler = OrderedPlanCompiler::default();
        let mut rows = [
            glyph(1, 1),
            decoration_row(0x8000_0000),
            decoration_row(0x8000_0001),
        ];
        let x = [1.0, 4.0, 4.0];
        prepare(&mut compiler, &codec, &rows, &x, true);
        let view = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        assert_eq!(view.primitives.len(), 2);
        assert_eq!(view.resources.len(), 1);
        assert_eq!(view.resources[0].id, 11);
        let decoration = view
            .primitives
            .iter()
            .find(|primitive| primitive.kind == PRIMITIVE_DECORATION)
            .expect("decoration primitive");
        assert_eq!(decoration.technique_id, DECORATION_TECHNIQUE.0);
        assert_eq!(decoration.resource_id, 0);
        assert_eq!(view.draws.len(), 2);
        let decoration_draw = view
            .draws
            .iter()
            .find(|draw| {
                view.primitives[draw.primitive_start as usize].kind == PRIMITIVE_DECORATION
            })
            .expect("decoration draw");
        assert_eq!(decoration_draw.resource_count, 0);
        let mut host = TestHost::default();
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        rows[0].stable_id = 2;
        rows[0].content_revision += 1;
        let intervals = core::iter::once(0..1).collect::<Vec<_>>();
        super::super::work_attribution::reset();
        compiler
            .prepare_scoped(
                &codec,
                CAPABILITY,
                OrderedPlanInput {
                    glyphs: &rows,
                    placement_slots: &[0; 3],
                    semantic_change_masks: &[0; 3],
                    f32_fields: &[&x],
                    u32_fields: &[],
                    order_independent: false,
                },
                false,
                2,
                Some(RetainedOutputScope::ChangedIntervals(
                    &intervals,
                    ChangedInputs::ALL,
                )),
                false,
            )
            .unwrap();
        assert_eq!(
            super::super::work_attribution::snapshot().draw_reduced_glyphs,
            1,
        );
        host.accept(
            compiler
                .plan_view(7, CAPABILITY, codec.fingerprint())
                .unwrap(),
            compiler.publish_bindings,
        );
        compiler.commit().unwrap();
        let mut cold = OrderedPlanCompiler::default();
        let mut oracle = TestHost::default();
        prepare(&mut cold, &codec, &rows, &x, true);
        oracle.accept(
            cold.plan_view(7, CAPABILITY, codec.fingerprint()).unwrap(),
            cold.publish_bindings,
        );
        assert_eq!(host.snapshot(), oracle.snapshot());
    }

    #[test]
    fn retiring_a_resource_free_decoration_batch_emits_no_resource_retirement() {
        // A decoration batch carries resource_id 0 by construction, and the publication path
        // already skips its resource lifecycle. Retiring it must skip the same way: a
        // RETIRE_RESOURCE record with id 0 is malformed, and the plan wire rejects the whole
        // publication rather than the record, which takes the frame down with it.
        let codec = decoration_codec();
        let mut compiler = OrderedPlanCompiler::default();

        let with_decoration = [glyph(1, 1), decoration_row(0x8000_0000)];
        prepare(&mut compiler, &codec, &with_decoration, &[1.0, 4.0], true);
        compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();
        compiler.commit().unwrap();

        // Drop the decoration row: its batch is removed, which is the retirement path.
        let without_decoration = [glyph(1, 2)];
        prepare(&mut compiler, &codec, &without_decoration, &[1.0], true);
        let view = compiler
            .plan_view(7, CAPABILITY, codec.fingerprint())
            .unwrap();

        assert!(
            !view
                .retirements
                .iter()
                .any(|retirement| retirement.kind == RETIRE_RESOURCE && retirement.id == 0),
            "resource-free batch retired a resource: {:?}",
            view.retirements,
        );
        // The publication must remain encodable. Before the guard this returned Err and the
        // host surfaced it as text-engine status 6.
        plan_layout(view).expect("resource-free retirement keeps the publication valid");
    }

    fn codec_with_material_storage(partition_materials: bool) -> ValidatedCodec {
        codec_with_limits(partition_materials, 1024)
    }

    fn paint_codec_with_material_storage(partition_materials: bool) -> ValidatedCodec {
        paint_codec_with_options(partition_materials, true)
    }

    fn paint_codec_with_options(
        partition_materials: bool,
        split_transform: bool,
    ) -> ValidatedCodec {
        paint_codec_with_limits(partition_materials, 1024, split_transform)
    }

    fn paint_codec_with_limits(
        partition_materials: bool,
        max_buffer_bytes: u32,
        split_transform: bool,
    ) -> ValidatedCodec {
        let mut descriptor =
            descriptor_with_options(partition_materials, max_buffer_bytes, split_transform);
        descriptor.programs[0].inputs[0] = crate::engine::codec::InputSource::semantic(8);
        ValidatedCodec::new(descriptor).unwrap()
    }

    fn codec_with_limits(partition_materials: bool, max_buffer_bytes: u32) -> ValidatedCodec {
        codec_with_options(partition_materials, max_buffer_bytes, true)
    }

    fn codec_with_options(
        partition_materials: bool,
        max_buffer_bytes: u32,
        split_transform: bool,
    ) -> ValidatedCodec {
        ValidatedCodec::new(descriptor_with_options(
            partition_materials,
            max_buffer_bytes,
            split_transform,
        ))
        .unwrap()
    }

    fn descriptor_with_options(
        partition_materials: bool,
        max_buffer_bytes: u32,
        split_transform: bool,
    ) -> CodecDescriptor {
        CodecDescriptor {
            capability_sets: vec![CapabilitySet {
                id: CAPABILITY,
                flags: CAP_ORDERED_DIRECT,
                max_buffer_bytes,
                update_alignment: 4,
                coalesce_gap_bytes: 0,
                range_call_penalty_bytes: 0,
                max_buffers_per_draw: 1,
                max_resources_per_draw: 1,
                max_indirect_draws: 0,
                fragmentation_budget: 8,
                whole_buffer_threshold_basis_points: 10_000,
            }],
            programs: vec![ProgramDescriptor {
                primitive_kind: 1,
                technique: TECHNIQUE,
                variant: 0,
                id: ProgramId(5),
                capability_set: CapabilitySetId(0),
                resource_kind_mask: 1,
                semantic_view_mask: 0,
                storage_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | crate::engine::codec::BATCH_DEPTH
                    | if partition_materials {
                        BATCH_MATERIAL
                    } else {
                        0
                    },
                draw_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | BATCH_MATERIAL
                    | crate::engine::codec::BATCH_DEPTH
                    | BATCH_ORDER
                    | if split_transform { BATCH_TRANSFORM } else { 0 },
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
            }],
        }
    }

    fn read_f32(bytes: &[u8], offset: usize) -> f32 {
        f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn capacities(compiler: &OrderedPlanCompiler) -> [usize; 16] {
        [
            compiler.pending_batches.capacity(),
            compiler.pending_instances.retained_capacity(),
            compiler.pending_allocations.capacity(),
            compiler.input_batches.capacity(),
            compiler.input_slots.capacity(),
            compiler.batch_cursors.capacity(),
            compiler.changed_ranges.capacity(),
            compiler.resources.capacity(),
            compiler.plan_buffers.capacity(),
            compiler.primitives.capacity(),
            compiler.draws.capacity(),
            compiler.live_primitives.capacity(),
            compiler.live_draws.capacity(),
            compiler.patches.capacity(),
            compiler.retirements.capacity(),
            compiler.payload.capacity(),
        ]
    }
}
