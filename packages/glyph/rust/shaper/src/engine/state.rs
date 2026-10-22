use alloc::{collections::BTreeMap, vec::Vec};
use core::{cell::RefCell, num::NonZeroU32};

use crate::{
    STATUS_RESULT_TOO_LARGE, ShapeRangeRef, ShapeRunRef, ShaperRegistry,
    bidi::{BidiAnalysis, BidiError, DIRECTION_AUTO, analyze_into as analyze_bidi_into},
    unicode::{UnicodeAnalysis, UnicodeError},
    valid_utf16_boundary,
};

use super::{
    cluster_state::{
        CLUSTER_ALLOWED_BREAK, CLUSTER_BREAK_CORRECTION, CLUSTER_SPACE, ClusterArena,
        ClusterBuildInput, LayoutDirtyRanges, LayoutRunSourceKind, RunCanonicalInput,
        SHAPING_CONTEXT,
    },
    codec::{CapabilitySetId, ValidatedCodec},
    codec_gather::{
        CodecGatherWorkspace, DEFAULT_GATHER_RECORD_CAPACITY, GatherError, LayoutPlanInput,
        RetainedGather, RetainedGatherOwner,
    },
    flow_composition::{EllipsisReplacement, FlowFragment, FlowLayoutArena, NO_BOUNDARY},
    flow_geometry::{FlowGeometryArena, LocalizedGeometryChange},
    font_binding::FontRenderBinding,
    frame::{
        CommittedUpdate, MeasuredParagraph, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
        PreparedUpdate, RootRevision, UpdateRequest, WRAP_WORD,
    },
    identity_index::IdentityIndex,
    line_composition::{BreakCorrections, Correction},
    placement_slot_arena::{PlacementSlotArena, PlacementSlotError},
    placement_state::{GlyphSource, LayoutRunOwner, PlacementIdentity, PlacementSegment},
    positioning::{PositionedGlyphArena, SEMANTIC_F32_FIELD_COUNT, SEMANTIC_U32_FIELD_COUNT},
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
    retained_rope::RopeEditError,
    semantic_wire::RecordSpan,
    session_placement::{SessionPlacementInput, SessionPlacementRow},
    shaping_state::{
        BoundaryShape, BoundaryShapeArena, GLYPH_FLAG_UNSAFE_TO_CONCAT, ShapeArena, ShapedRun,
        ShapingRun, ShapingRunArena,
    },
    sort,
    staged::{Staged, StyleStage, TextStage},
    style_state::{
        DEFAULT_STYLE_CAPACITY, MutationKey, MutationTopologyScratch, ResolutionScope, StyleArena,
        StyleInvalidation, StyleTopologyRecord,
    },
};

#[cfg(test)]
use super::cluster_state::{BoundaryRunRole, RunCanonicalRevision};

/// What a rejected frame can name about its own cause.
///
/// Both identifiers are the ones the REQUEST used, so a host can map them straight back to the
/// paragraph and style it authored. Zero means "not attributed": a rejection raised inside the
/// per-paragraph pipeline learns its paragraph only when the paragraph loop attaches it, and not
/// every cause names a style. Neither identifier is ever legitimately zero -- paragraph ids are
/// allocated from one and the style compiler numbers the root style one -- so zero is free to mean
/// absent without colliding with a real record.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FrameFault {
    pub paragraph_id: u32,
    pub style_id: u32,
}

impl FrameFault {
    pub(crate) const fn style(style_id: u32) -> Self {
        Self {
            paragraph_id: 0,
            style_id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineError {
    InvalidHandle,
    HandleConflict,
    CodecMissing,
    FontStackMissing,
    RootConflict,
    RootMissing,
    RevisionConflict,
    RevisionExhausted,
    /// The request was rejected for a cause the engine does not classify further: a malformed
    /// request encoding, or an arena invariant the caller cannot select through the public API.
    /// Every cause a caller can act on has its own variant below; this one never names one.
    InvalidRequest,
    ResultTooLarge,
    /// A renderer tried to dispose a codec or font stack still named by committed root state.
    RegistrationInUse,
    /// A style's `[start, end)` is inverted, reaches past the end of the paragraph's text, or lands
    /// inside a UTF-16 surrogate pair.
    StyleRangeInvalid(FrameFault),
    /// A style boundary falls inside an extended grapheme cluster. The engine resolves exactly one
    /// style per cluster, so it cannot honour the split.
    StyleSplitsCluster(FrameFault),
    /// Two styles partially overlap. Styles must be disjoint or fully nested.
    StyleNestingInvalid(FrameFault),
    /// The paragraph does not carry exactly one root style spanning its whole text with every
    /// root-required field stated.
    StyleRootInvalid(FrameFault),
    /// A style names a font stack handle that is not registered.
    StyleFontStackMissing(FrameFault),
    /// A font referenced by the laid-out text has no registered metrics.
    FontMetricsMissing(FrameFault),
}

impl EngineError {
    /// Attaches the paragraph a rejection belongs to, when the rejection names one and the pipeline
    /// stage that raised it could not know which paragraph it was working on.
    pub(crate) fn in_paragraph(self, paragraph_id: u32) -> Self {
        self.map_fault(|fault| FrameFault {
            paragraph_id: if fault.paragraph_id == 0 {
                paragraph_id
            } else {
                fault.paragraph_id
            },
            style_id: fault.style_id,
        })
    }

    /// The identifiers this rejection names, all zero when it names none.
    pub fn fault(self) -> FrameFault {
        match self {
            Self::StyleRangeInvalid(fault)
            | Self::StyleSplitsCluster(fault)
            | Self::StyleNestingInvalid(fault)
            | Self::StyleRootInvalid(fault)
            | Self::StyleFontStackMissing(fault)
            | Self::FontMetricsMissing(fault) => fault,
            _ => FrameFault::default(),
        }
    }

    fn map_fault(self, attach: impl FnOnce(FrameFault) -> FrameFault) -> Self {
        match self {
            Self::StyleRangeInvalid(fault) => Self::StyleRangeInvalid(attach(fault)),
            Self::StyleSplitsCluster(fault) => Self::StyleSplitsCluster(attach(fault)),
            Self::StyleNestingInvalid(fault) => Self::StyleNestingInvalid(attach(fault)),
            Self::StyleRootInvalid(fault) => Self::StyleRootInvalid(attach(fault)),
            Self::StyleFontStackMissing(fault) => Self::StyleFontStackMissing(attach(fault)),
            Self::FontMetricsMissing(fault) => Self::FontMetricsMissing(attach(fault)),
            other => other,
        }
    }
}

#[derive(Default)]
pub struct TextEngine {
    codecs: BTreeMap<u32, ValidatedCodec>,
    font_bindings: Vec<RegisteredFontBinding>,
    font_stacks: Vec<RegisteredFontStack>,
    planners: BTreeMap<u32, PlannerState>,
    invalidated_roots: BTreeMap<u32, RootHighWater>,
    gather: CodecGatherWorkspace,
    gather_cache: Option<GatherCacheKey>,
    prepared_gather_cache: Option<GatherCacheKey>,
}

#[derive(Clone, Copy, Default)]
struct RootHighWater {
    next_glyph_id: u32,
    next_content_revision: u32,
    acknowledged_publication_generation: u32,
}

struct RegisteredFontBinding {
    handle: u32,
    shaping_handle: u32,
    binding: FontRenderBinding,
}

struct RegisteredFontStack {
    handle: u32,
    fonts: Vec<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FallbackSpan {
    source_run: u32,
    text_start: u32,
    text_end: u32,
    font_index: u16,
    binding_handle: u32,
    font_handle: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ClusterRecord {
    source_run: u32,
    cluster: u32,
    missing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TextEdit {
    old_start: usize,
    old_end: usize,
    new_start: usize,
    new_end: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ShapeWindow {
    old_start: u32,
    old_end: u32,
    new_start: u32,
    new_end: u32,
    probe_end: u32,
    old_glyph_start: usize,
    old_glyph_end: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShapeAttempt {
    Prepared,
    RetryWholeRun,
    NeedsFallback,
}

impl TextEdit {
    fn is_same_length(self) -> bool {
        self.old_end.saturating_sub(self.old_start) == self.new_end.saturating_sub(self.new_start)
    }
}

#[derive(Clone, Copy)]
struct BoundaryCandidate {
    source_run: usize,
    cluster_start: usize,
    source_binding_handle: u32,
    source_font_handle: u32,
    ellipsis_binding_handle: u32,
    ellipsis_font_handle: u32,
    source_advance: f64,
    ellipsis_advance: f64,
}

#[derive(Default)]
struct PlannerState {
    revision: RootRevision,
    preparation_revision: u32,
    published_preparation_revision: u32,
    acknowledged_publication_generation: u32,
    placement_acknowledgement_rebased: bool,
    measure_generation: u32,
    codec_binding: Option<CodecBinding>,
    /// Stable keys of semantic nodes owned by the current preparation transaction.
    pending_preparation_ids: Vec<u32>,
    /// Successfully prepared owners awaiting publication; membership is the paragraph's dirty flag.
    unpublished_preparation_ids: Vec<u32>,
    plan: RenderPlanCompiler,
    semantic_records: Vec<super::semantic_view::SemanticRecord>,
    next_glyph_id: u32,
    pending_next_glyph_id: u32,
    next_content_revision: u32,
    pending_next_content_revision: u32,
    next_paragraph_incarnation: u32,
    pending_next_paragraph_incarnation: u32,
    placement_slots: PlacementSlotArena<PlacementLogicalKey>,
    desired_placements: Vec<PlacementLogicalKey>,
    session_placement_rows: Vec<SessionPlacementRow>,
    placement_slot_count: u32,
    pending_placement_slot_count: u32,
    spare_paragraph: Option<ParagraphState>,
    paragraphs: Vec<RetainedParagraph>,
    ordered_paragraphs: Vec<ParagraphOrder>,
    pending_ordered_paragraphs: Vec<ParagraphOrder>,
    /// Source count from the last undecorated gather; authorized only by its exact cache key.
    gathered_source_count: Option<usize>,
    /// Occurrence ranges are tied to the arena's Rust-canonical committed order.
    placement_ranges_current: bool,
    pending_placement_ranges_refresh: bool,
    semantic_input_spans: Vec<ParagraphInputSpans>,
    order_sort_scratch: Vec<(u64, u32)>,
    rank_sort_scratch: Vec<(u64, u32)>,
    lifecycle_id_scratch: Vec<(u64, u32)>,
    lifecycle_membership_scratch: Vec<u32>,
    /// Reused when validating styles for a paragraph not yet retained by this planner.
    style_validation_mutation_scratch: Vec<MutationKey>,
    style_validation_sort_pair_scratch: Vec<(u64, u32)>,
    style_validation_topology_scratch: Vec<StyleTopologyRecord>,
    /// Sorted request-local metadata; owned buffers exist only when an accepted pending value
    /// must remain intact during full caller preflight.
    preflight_text_candidates: Vec<PreflightTextCandidate>,
    preflight_edit_scratch: Vec<TextEdit>,
    style_validation_order_scratch: Vec<usize>,
    style_validation_nesting_scratch: Vec<u32>,
    style_validation_sort_pairs_pass: Vec<(u64, u32)>,
    ranked_paragraphs: Vec<RankedParagraph>,
    reorder_stable_ids: Vec<u32>,
    lifecycle_prepared: bool,
    lifecycle_changed: bool,
    compositing_independent: bool,
    pending_compositing_independent: bool,
}

/// Request-scoped routing for text and its Unicode prefix. Most candidates live directly in the
/// paragraph's inactive buffers; this owns buffers only when those buffers already hold a valid
/// pending candidate that must survive until full caller preflight succeeds.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum CandidateBuffers {
    #[default]
    Owned,
    ExistingPending {
        unit_ids_mirror_committed: bool,
    },
    SparePending,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum CandidateUnicode {
    #[default]
    ReuseCommitted,
    Prepared,
}

#[derive(Default)]
struct PreflightTextCandidate {
    paragraph_id: u32,
    buffers: CandidateBuffers,
    unicode_state: CandidateUnicode,
    edit_start: usize,
    edit_end: usize,
    text: Vec<u16>,
    unicode: UnicodeAnalysis,
}

impl PreflightTextCandidate {
    fn uses_pending_buffers(&self) -> bool {
        matches!(
            self.buffers,
            CandidateBuffers::ExistingPending { .. } | CandidateBuffers::SparePending
        )
    }

    fn pending_unit_ids_are_mirrored(&self) -> bool {
        matches!(
            self.buffers,
            CandidateBuffers::ExistingPending {
                unit_ids_mirror_committed: true
            }
        )
    }
}

fn preflight_text_candidate_mut(
    candidates: &mut [PreflightTextCandidate],
    paragraph_id: u32,
) -> Option<&mut PreflightTextCandidate> {
    let index = candidates
        .binary_search_by_key(&paragraph_id, |candidate| candidate.paragraph_id)
        .ok()?;
    candidates.get_mut(index)
}

fn clear_preflight_text_candidates(candidates: &mut Vec<PreflightTextCandidate>) {
    // Candidates are request-owned; dropping their rows releases any old pending capacity
    // swapped out during preparation while retaining the outer vector's metadata capacity.
    candidates.clear();
}

struct RetainedParagraph {
    id: u32,
    incarnation: ParagraphIncarnation,
    placement: ParagraphPlacement,
    pending_placement: Option<ParagraphPlacement>,
    pending_remove: bool,
    created: bool,
    positioned_changed: bool,
    preparation_changed_since_publication: bool,
    gather_range: Option<super::codec_gather::GatherRange>,
    /// Renderer-order index adopted with lifecycle order, never authored preparation order.
    renderer_order_index: usize,
    placement_range: RecordSpan,
    state: ParagraphState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ParagraphIncarnation(NonZeroU32);

impl ParagraphIncarnation {
    fn allocate(next: &mut u32) -> Result<Self, EngineError> {
        let value = (*next).max(1);
        let incarnation = NonZeroU32::new(value).ok_or(EngineError::RevisionExhausted)?;
        *next = value.checked_add(1).ok_or(EngineError::RevisionExhausted)?;
        Ok(Self(incarnation))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct PlacementLogicalKey {
    paragraph: ParagraphIncarnation,
    run_owner: LayoutRunOwner,
    run_source: LayoutRunSourceKind,
    identity: PlacementIdentity,
    segment_anchor: u32,
    source_anchor: u32,
    numeric_block_ordinal: u32,
    glyph_source: GlyphSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ParagraphOrder {
    order: u32,
    id: u32,
}

enum RetainedOrderPurpose {
    Gather,
    ReplacementGather,
    Placement,
}

struct LifecyclePlan {
    creates: usize,
    removals: usize,
    placement_changes: usize,
    ordered: Vec<ParagraphOrder>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ParagraphPlacement {
    order: u32,
    scope: u32,
    rank: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RankedParagraph {
    scope: u32,
    id: u32,
    rank: f64,
    slot: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ParagraphInputSpans {
    id: u32,
    text: RecordSpan,
    styles: RecordSpan,
    constraints: RecordSpan,
    inline_objects: RecordSpan,
}

#[derive(Clone, Copy)]
enum ParagraphInputKind {
    Text,
    Style,
    Constraint,
    InlineObject,
}

#[derive(Clone, Copy)]
enum ParagraphInputScope {
    Single(u32),
    Indexed,
}

impl ParagraphInputSpans {
    fn is_empty(self) -> bool {
        self.text.is_empty()
            && self.styles.is_empty()
            && self.constraints.is_empty()
            && self.inline_objects.is_empty()
    }

    fn span_mut(&mut self, kind: ParagraphInputKind) -> &mut RecordSpan {
        match kind {
            ParagraphInputKind::Text => &mut self.text,
            ParagraphInputKind::Style => &mut self.styles,
            ParagraphInputKind::Constraint => &mut self.constraints,
            ParagraphInputKind::InlineObject => &mut self.inline_objects,
        }
    }
}

fn route_paragraph_records(
    paragraphs: &mut Vec<ParagraphInputSpans>,
    lifecycle_membership: &[u32],
    record_count: usize,
    paragraph_id: impl Fn(usize) -> Option<u32>,
    kind: ParagraphInputKind,
    scope: ParagraphInputScope,
) -> Result<(), EngineError> {
    let mut start = 0;
    while start < record_count {
        let id = paragraph_id(start).ok_or(EngineError::InvalidRequest)?;
        let mut end = start + 1;
        while end < record_count && paragraph_id(end) == Some(id) {
            end += 1;
        }
        if lifecycle_membership.binary_search(&id).is_err() {
            return Err(EngineError::InvalidRequest);
        }
        match scope {
            ParagraphInputScope::Single(selected) => {
                if id != selected {
                    return Err(EngineError::InvalidRequest);
                }
            }
            ParagraphInputScope::Indexed => {
                paragraphs
                    .try_reserve(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                let mut spans = ParagraphInputSpans {
                    id,
                    ..ParagraphInputSpans::default()
                };
                *spans.span_mut(kind) = RecordSpan { start, end };
                paragraphs.push(spans);
            }
        }
        start = end;
    }
    Ok(())
}

/// Full clipped inspection is derived during preparation and adopted with that same
/// revision. Its buffers survive candidate discards without exposing a rejected candidate.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum IntrinsicInspection {
    #[default]
    None,
    Flow,
    Positioned,
}

#[derive(Default)]
struct ClippedLayoutInspection {
    mode: IntrinsicInspection,
    positioned: PositionedGlyphArena,
}

#[derive(Default)]
struct ParagraphState {
    #[cfg(test)]
    preparation_count: usize,
    #[cfg(test)]
    text_mutation_apply_count: usize,
    text: Staged<TextStage>,
    /// Whether the pending buffers are a byte-identical copy of the committed ones, so a
    /// mutation batch can skip re-seeding them.
    pending_text_mirrors_committed: bool,
    text_edits: Vec<TextEdit>,
    styles: Staged<StyleStage>,
    unicode: Staged<UnicodeAnalysis>,
    unicode_reused_for_text_edit: bool,
    bidi: Staged<BidiAnalysis>,
    shaping_runs: Staged<ShapingRunArena>,
    shape: Staged<ShapeArena>,
    shape_window_scratch: Vec<ShapeWindow>,
    layout_dirty: LayoutDirtyRanges,
    incremental_shape_source_run: Option<u32>,
    clusters: Staged<ClusterArena>,
    glyph_identity_index: IdentityIndex,
    layout_run_identity_index: IdentityIndex,
    next_run_canonical_revision: u32,
    pending_source_run_canonical_revision: u32,
    pending_next_run_canonical_revision: u32,
    geometry: Staged<FlowGeometryArena>,
    flow_layout: Staged<FlowLayoutArena>,
    intrinsic_geometry_scratch: FlowGeometryArena,
    intrinsic_flow_layout_scratch: FlowLayoutArena,
    intrinsic_widths_cache: Option<(u8, super::cluster_state::IntrinsicWidths)>,
    intrinsic_flow_slot_scratch: super::flow_geometry::InlineSlotArena,
    clipped_inspection: Staged<ClippedLayoutInspection>,
    intrinsic_boundary_shape: BoundaryShapeArena,
    intrinsic_identity_scratch: IdentityIndex,
    boundary_shape: BoundaryShapeArena,
    /// The committed boundary glyphs' stable ids, indexed for the flow being prepared.
    previous_edge_ids: Vec<EdgeId>,
    pending_boundary_shape: BoundaryShapeArena,
    boundary_shape_scratch: ShapeArena,
    ellipsis_shape_scratch: ShapeArena,
    ellipsis_text_scratch: Vec<u16>,
    positioned: Staged<PositionedGlyphArena>,
    flow_slot_scratch: super::flow_geometry::InlineSlotArena,
    fallback_spans: Vec<FallbackSpan>,
    pending_fallback_spans: Vec<FallbackSpan>,
    fallback_span_scratch: Vec<FallbackSpan>,
    fallback_cluster_scratch: Vec<ClusterRecord>,
    sort_pair_scratch: Vec<(u64, u32)>,
    style_sort_pair_scratch: Vec<(u64, u32)>,
    style_mutation_scratch: Vec<MutationKey>,
    style_order_scratch: Vec<usize>,
    style_nesting_scratch: Vec<u32>,
    style_resolution_scratch: Vec<ResolutionScope>,
    style_invalidation: StyleInvalidation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CodecBinding {
    handle: u32,
    fingerprint: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GatherCacheKey {
    root_id: u32,
    revision: RootRevision,
    codec_handle: u32,
    codec_fingerprint: u64,
    capability_set: u32,
}

impl TextEngine {
    fn invalidate_gather_cache(&mut self) {
        self.gather_cache = None;
        self.prepared_gather_cache = None;
    }

    pub fn initialize(&mut self) -> Result<(), EngineError> {
        self.gather
            .reserve_records(DEFAULT_GATHER_RECORD_CAPACITY)
            .map_err(gather_error)
    }

    pub fn register_font_binding(
        &mut self,
        handle: u32,
        shaping_handle: u32,
        shaping_glyph_count: u32,
        binding: FontRenderBinding,
    ) -> Result<(), EngineError> {
        if handle == 0 || shaping_handle == 0 || binding.glyph_count() != shaping_glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(existing) = self
            .font_bindings
            .iter()
            .find(|registered| registered.handle == handle)
        {
            return if existing.shaping_handle == shaping_handle && existing.binding == binding {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.font_bindings
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.font_bindings.push(RegisteredFontBinding {
            handle,
            shaping_handle,
            binding,
        });
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn dispose_font_binding(&mut self, handle: u32) {
        if let Some(index) = self
            .font_bindings
            .iter()
            .position(|binding| binding.handle == handle)
        {
            self.font_bindings.swap_remove(index);
            self.invalidate_gather_cache();
        }
    }

    pub fn font_binding(&self, handle: u32) -> Option<&FontRenderBinding> {
        self.font_bindings
            .iter()
            .find(|binding| binding.handle == handle)
            .map(|binding| &binding.binding)
    }

    fn registered_font_binding(&self, handle: u32) -> Option<&RegisteredFontBinding> {
        self.font_bindings
            .iter()
            .find(|binding| binding.handle == handle)
    }

    pub fn shaping_handle_for_binding(&self, handle: u32) -> Option<u32> {
        self.registered_font_binding(handle)
            .map(|binding| binding.shaping_handle)
    }

    pub fn dispose_bindings_for_shaping_font(&mut self, shaping_handle: u32) {
        let previous_len = self.font_bindings.len();
        self.font_bindings
            .retain(|binding| binding.shaping_handle != shaping_handle);
        if self.font_bindings.len() != previous_len {
            self.invalidate_gather_cache();
        }
    }

    pub fn font_binding_count(&self) -> u32 {
        self.font_bindings.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn register_font_stack(&mut self, handle: u32, fonts: &[u32]) -> Result<(), EngineError> {
        if handle == 0
            || fonts.is_empty()
            || fonts.len() > usize::from(u16::MAX)
            || fonts.contains(&0)
            || fonts
                .iter()
                .enumerate()
                .any(|(index, font)| fonts[..index].contains(font))
        {
            return Err(EngineError::InvalidRequest);
        }
        let insertion = match self
            .font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
        {
            Ok(index) => {
                return if self.font_stacks[index].fonts == fonts {
                    Ok(())
                } else {
                    Err(EngineError::HandleConflict)
                };
            }
            Err(index) => index,
        };
        let mut retained = Vec::new();
        retained
            .try_reserve_exact(fonts.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        retained.extend_from_slice(fonts);
        self.font_stacks
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.font_stacks.insert(
            insertion,
            RegisteredFontStack {
                handle,
                fonts: retained,
            },
        );
        Ok(())
    }

    pub fn dispose_font_stack(&mut self, handle: u32) -> Result<(), EngineError> {
        let index = self
            .font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
            .map_err(|_| EngineError::FontStackMissing)?;
        if self
            .planners
            .values()
            .any(|planner| planner.references_font_stack(handle))
        {
            return Err(EngineError::RegistrationInUse);
        }
        self.font_stacks.remove(index);
        Ok(())
    }

    pub fn font_stack(&self, handle: u32) -> Result<&[u32], EngineError> {
        self.font_stacks
            .binary_search_by_key(&handle, |stack| stack.handle)
            .ok()
            .map(|index| self.font_stacks[index].fonts.as_slice())
            .ok_or(EngineError::FontStackMissing)
    }

    pub fn font_stack_count(&self) -> u32 {
        self.font_stacks.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn references_binding(&self, handle: u32) -> bool {
        self.font_stacks
            .iter()
            .any(|stack| stack.fonts.contains(&handle))
    }

    pub fn references_shaping_font(&self, shaping_handle: u32) -> bool {
        self.font_stacks.iter().any(|stack| {
            stack
                .fonts
                .iter()
                .any(|handle| self.shaping_handle_for_binding(*handle) == Some(shaping_handle))
        })
    }

    pub fn register_codec(
        &mut self,
        handle: u32,
        codec: ValidatedCodec,
    ) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if let Some(existing) = self.codecs.get(&handle) {
            return if existing == &codec {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.gather
            .reserve_codec(&codec, DEFAULT_GATHER_RECORD_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.codecs.insert(handle, codec);
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn dispose_codec(&mut self, handle: u32) -> Result<(), EngineError> {
        if self.planners.values().any(|planner| {
            planner
                .codec_binding
                .is_some_and(|binding| binding.handle == handle)
        }) {
            return Err(EngineError::RegistrationInUse);
        }
        self.codecs
            .remove(&handle)
            .ok_or(EngineError::CodecMissing)?;
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn codec(&self, handle: u32) -> Result<&ValidatedCodec, EngineError> {
        self.codecs.get(&handle).ok_or(EngineError::CodecMissing)
    }

    pub fn codec_count(&self) -> u32 {
        self.codecs.len().try_into().unwrap_or(u32::MAX)
    }

    pub fn create_root(&mut self, handle: u32) -> Result<(), EngineError> {
        let high_water = self
            .invalidated_roots
            .get(&handle)
            .copied()
            .unwrap_or_default();
        self.create_root_with_high_water(handle, high_water)?;
        self.invalidated_roots.remove(&handle);
        Ok(())
    }

    fn create_root_with_high_water(
        &mut self,
        handle: u32,
        high_water: RootHighWater,
    ) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if self.planners.contains_key(&handle) {
            return Err(EngineError::RootConflict);
        }
        let planner = Self::new_planner(high_water)?;
        self.planners.insert(handle, planner);
        Ok(())
    }

    fn new_planner(high_water: RootHighWater) -> Result<PlannerState, EngineError> {
        let mut planner = PlannerState {
            next_glyph_id: high_water.next_glyph_id,
            next_content_revision: high_water.next_content_revision,
            acknowledged_publication_generation: high_water.acknowledged_publication_generation,
            placement_acknowledgement_rebased: high_water.acknowledged_publication_generation != 0,
            ..PlannerState::default()
        };
        let mut spare = ParagraphState::default();
        spare.initialize()?;
        planner.spare_paragraph = Some(spare);
        Ok(planner)
    }

    /// Replaces one planner's derived state while retaining the caller-owned root transport.
    /// Used only after an unexpected failure crossed the Wasm/TypeScript commit boundary.
    pub fn reset_root(&mut self, handle: u32) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        let high_water = self
            .invalidated_roots
            .get(&handle)
            .copied()
            .or_else(|| {
                self.planners.get(&handle).map(|planner| RootHighWater {
                    next_glyph_id: planner.next_glyph_id.max(planner.pending_next_glyph_id),
                    next_content_revision: planner
                        .next_content_revision
                        .max(planner.pending_next_content_revision),
                    acknowledged_publication_generation: planner
                        .acknowledged_publication_generation,
                })
            })
            .ok_or(EngineError::RootMissing)?;
        let mut replacement = Self::new_planner(high_water)?;
        // The renderer may have accepted a generation that the invalidated planner never
        // observed. Its replacement placement arena starts empty, so the next renderer
        // acknowledgement must be treated as a fence from the previous arena.
        replacement.placement_acknowledgement_rebased = true;
        self.planners.insert(handle, replacement);
        self.invalidated_roots.remove(&handle);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    fn invalidate_root(&mut self, handle: u32) -> Result<(), EngineError> {
        let planner = self
            .planners
            .remove(&handle)
            .ok_or(EngineError::RootMissing)?;
        let high_water = RootHighWater {
            next_glyph_id: planner.next_glyph_id.max(planner.pending_next_glyph_id),
            next_content_revision: planner
                .next_content_revision
                .max(planner.pending_next_content_revision),
            acknowledged_publication_generation: planner.acknowledged_publication_generation,
        };
        self.invalidated_roots.insert(handle, high_water);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub fn dispose_root(&mut self, handle: u32) -> Result<(), EngineError> {
        if self.planners.remove(&handle).is_none()
            && self.invalidated_roots.remove(&handle).is_none()
        {
            return Err(EngineError::RootMissing);
        }
        self.invalidated_roots.remove(&handle);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub fn reserve_root_text(&mut self, handle: u32, capacity: u32) -> Result<(), EngineError> {
        let capacity = usize::try_from(capacity).map_err(|_| EngineError::ResultTooLarge)?;
        let planner = self
            .planners
            .get_mut(&handle)
            .ok_or(EngineError::RootMissing)?;
        planner
            .preflight_text_candidates
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        planner
            .preflight_edit_scratch
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        if let Some(paragraph) = planner.spare_paragraph.as_mut() {
            paragraph.reserve_text(capacity)?;
        }
        Ok(())
    }

    pub(crate) fn root_revision(&self, handle: u32) -> Result<RootRevision, EngineError> {
        self.planners
            .get(&handle)
            .map(|planner| planner.revision)
            .ok_or(EngineError::RootMissing)
    }

    pub(crate) fn borrowed_paragraph_layout(
        &self,
        root_id: u32,
        paragraph_id: u32,
    ) -> Result<usize, EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = paragraph.state.inspection_positioned();
        Ok(positioned.semantic_glyphs().len())
    }

    pub(crate) fn borrowed_paragraph_glyphs(
        &self,
        root_id: u32,
        paragraph_id: u32,
        start: usize,
        output: &mut [super::positioning::SemanticGlyph],
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = paragraph.state.inspection_positioned();
        let end = start
            .checked_add(output.len())
            .filter(|&end| end <= positioned.semantic_glyphs().len())
            .ok_or(EngineError::InvalidRequest)?;
        for (record, index) in output.iter_mut().zip(start..end) {
            *record = positioned.placed_semantic_glyph(index)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn root_text(&self, handle: u32) -> Result<&[u16], EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.text.committed().units.as_slice())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_style_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.styles.committed().arena.len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_style_segment_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.styles.committed().resolved.segments().len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_shaping_run_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.shaping_runs.committed().runs().len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    fn planner_paragraph_preparation_count(
        &self,
        root: u32,
        paragraph: u32,
    ) -> Result<usize, EngineError> {
        self.planners
            .get(&root)
            .and_then(|planner| planner.paragraph(paragraph))
            .map(|paragraph| paragraph.state.preparation_count)
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    fn planner_preparation_revision(&self, root: u32) -> Result<u32, EngineError> {
        self.planners
            .get(&root)
            .map(|planner| planner.preparation_revision)
            .ok_or(EngineError::RootMissing)
    }

    pub fn root_count(&self) -> u32 {
        self.planners.len().try_into().unwrap_or(u32::MAX)
    }

    #[cfg(test)]
    fn retained_binding_compilation_skips(&self, handle: u32) -> Result<u32, EngineError> {
        self.planners
            .get(&handle)
            .map(|planner| planner.plan.retained_binding_compilation_skips())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn prepare_update(
        &mut self,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        self.prepare_update_inner(None, request, publication_generation)
    }

    pub(crate) fn prepare_update_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        self.prepare_update_inner(Some(shaper), request, publication_generation)
    }

    /// Builds a complete independent render plan for selected current glyph records.
    ///
    /// This query leaves planner revisions, publication generation, and the acknowledgement fence
    /// untouched. The returned compiler owns compacted codec buffers that
    /// the transport can encode as a one-shot checkpoint for a renderer to import.
    pub(crate) fn copy_glyphs(
        &self,
        root_id: u32,
        paragraph_id: u32,
        codec_handle: u32,
        capability_set_id: u32,
        stable_ids: &[u32],
    ) -> Result<RenderPlanCompiler, EngineError> {
        if stable_ids.is_empty() || stable_ids.contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        let mut requested = stable_ids.to_vec();
        requested.sort_unstable();
        if requested.windows(2).any(|ids| ids[0] == ids[1]) {
            return Err(EngineError::InvalidRequest);
        }
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let binding = planner.codec_binding.ok_or(EngineError::InvalidRequest)?;
        if binding.handle != codec_handle {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if binding.fingerprint != codec.fingerprint() {
            return Err(EngineError::InvalidRequest);
        }
        let capability_set = CapabilitySetId(capability_set_id);
        if codec.capability_set(capability_set).is_none() {
            return Err(EngineError::InvalidRequest);
        }

        let mut gather = CodecGatherWorkspace::default();
        gather.begin(codec, requested.len()).map_err(gather_error)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = paragraph.state.positioned.committed();
        let source_glyphs = positioned.glyphs();
        let source_semantic = positioned.semantic_glyphs();
        let source_f32 = positioned.semantic_f32();
        let source_u32 = positioned.semantic_u32();
        let mut glyphs = Vec::new();
        let mut semantic_glyphs = Vec::new();
        let mut semantic_f32: [Vec<f32>; SEMANTIC_F32_FIELD_COUNT] =
            core::array::from_fn(|_| Vec::new());
        let mut semantic_u32: [Vec<u32>; SEMANTIC_U32_FIELD_COUNT] =
            core::array::from_fn(|_| Vec::new());
        let mut selected_placement_slots = Vec::new();
        let mut found = 0usize;
        for (glyph_index, source) in source_glyphs.iter().enumerate() {
            if requested.binary_search(&source.stable_id).is_err() {
                continue;
            }
            let mut glyph = *source;
            // Detached decoration plans use 0/2 for CSS under/over passes. Keep copied glyphs in
            // the middle so renderers can restore the original paint order across both objects.
            glyph.depth_key = super::codec_gather::PAINT_LAYER_GLYPH;
            let semantic_index = usize::try_from(source.semantic_glyph_index)
                .map_err(|_| EngineError::InvalidRequest)?;
            let semantic = source_semantic
                .get(semantic_index)
                .ok_or(EngineError::InvalidRequest)?;
            glyph.semantic_glyph_index = semantic_glyphs
                .len()
                .try_into()
                .map_err(|_| EngineError::ResultTooLarge)?;
            semantic_glyphs.push(*semantic);
            // Copies own their placement slots; segment indices are valid before root publication too.
            glyph.placement_slot = semantic.placement_segment;
            glyphs.push(glyph);
            selected_placement_slots.push(semantic.placement_segment);
            for (destination, values) in semantic_f32.iter_mut().zip(source_f32.iter()) {
                if values.is_empty() {
                    continue;
                }
                destination.push(*values.get(glyph_index).ok_or(EngineError::InvalidRequest)?);
            }
            for (destination, values) in semantic_u32.iter_mut().zip(source_u32.iter()) {
                if values.is_empty() {
                    continue;
                }
                destination.push(*values.get(glyph_index).ok_or(EngineError::InvalidRequest)?);
            }
            found += 1;
        }
        if found != requested.len() {
            return Err(EngineError::InvalidRequest);
        }
        selected_placement_slots.sort_unstable();
        selected_placement_slots.dedup();
        let mut placement_rows = Vec::new();
        placement_rows
            .try_reserve(selected_placement_slots.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for (slot, source_slot) in selected_placement_slots.iter().copied().enumerate() {
            let translation = positioned
                .placement_translations()
                .get(usize::try_from(source_slot).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            placement_rows.push(SessionPlacementRow {
                slot: u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
                inline: translation.translation_inline as f32,
                block: translation.translation_block as f32,
            });
        }
        for glyph in &mut glyphs {
            glyph.placement_slot = u32::try_from(
                selected_placement_slots
                    .binary_search(&glyph.placement_slot)
                    .map_err(|_| EngineError::InvalidRequest)?,
            )
            .map_err(|_| EngineError::ResultTooLarge)?;
        }
        let semantic_f32_refs: Vec<&[f32]> = semantic_f32.iter().map(Vec::as_slice).collect();
        let semantic_u32_refs: Vec<&[u32]> = semantic_u32.iter().map(Vec::as_slice).collect();
        gather
            .append(
                codec,
                capability_set,
                LayoutPlanInput {
                    transform_id: paragraph_id,
                    glyphs: &glyphs,
                    semantic_glyphs: &semantic_glyphs,
                    placement_translations: positioned.placement_translations(),
                    semantic_change_masks: &[],
                    semantic_f32: &semantic_f32_refs,
                    semantic_u32: &semantic_u32_refs,
                },
                |handle| {
                    self.font_bindings
                        .iter()
                        .find(|registered| registered.handle == handle)
                        .map(|registered| &registered.binding)
                },
            )
            .map_err(gather_error)?;
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare(
                codec,
                capability_set,
                gather.view().plan_input(),
                true,
                1,
                0,
            )
            .map_err(plan_error)?;
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &placement_rows,
                    placement_capacity: u32::try_from(selected_placement_slots.len())
                        .map_err(|_| EngineError::ResultTooLarge)?,
                },
                codec
                    .capability_set(capability_set)
                    .ok_or(EngineError::InvalidRequest)?,
                1,
                true,
            )
            .map_err(plan_error)?;
        Ok(compiler)
    }

    /// Builds a complete independent plan for one current paragraph's decorations.
    pub(crate) fn copy_decorations(
        &self,
        root_id: u32,
        codec_handle: u32,
        capability_set_id: u32,
        paragraph_id: u32,
    ) -> Result<RenderPlanCompiler, EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let binding = planner.codec_binding.ok_or(EngineError::InvalidRequest)?;
        if binding.handle != codec_handle {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if binding.fingerprint != codec.fingerprint() {
            return Err(EngineError::InvalidRequest);
        }
        let capability_set = CapabilitySetId(capability_set_id);
        if codec.capability_set(capability_set).is_none() {
            return Err(EngineError::InvalidRequest);
        }
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = paragraph.state.positioned.committed();

        let mut gather = CodecGatherWorkspace::default();
        gather
            .begin(codec, positioned.decorations().len())
            .map_err(gather_error)?;
        let content_revision = planner.revision.engine.max(1);
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                paragraph_id,
                content_revision,
                super::codec_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                paragraph_id,
                content_revision,
                super::codec_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare(
                codec,
                capability_set,
                gather.view().plan_input(),
                true,
                1,
                0,
            )
            .map_err(plan_error)?;
        Ok(compiler)
    }

    /// Stages one paragraph-scoped synchronous preparation. Validation, shaping, flow, and
    /// positioning run for the selected paragraph without advancing renderer-plan revision,
    /// acknowledging a renderer fence, gathering, or compiling a plan. The Wasm boundary commits
    /// this transaction only after its requested semantic result has encoded successfully.
    pub(crate) fn measure_paragraph_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        self.measure_paragraph_inner(Some(shaper), request, paragraph_id)
    }

    #[cfg(test)]
    pub(crate) fn measure_paragraph(
        &mut self,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        self.measure_paragraph_inner(None, request, paragraph_id)
    }

    fn measure_paragraph_inner(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&request.codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if codec
            .capability_set(CapabilitySetId(request.capability_set))
            .is_none()
        {
            return Err(EngineError::InvalidRequest);
        }
        let codec_fingerprint = codec.fingerprint();
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
        let planner = self
            .planners
            .get_mut(&request.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.codec_binding.is_some_and(|binding| {
            binding.handle != request.codec_handle || binding.fingerprint != codec_fingerprint
        }) {
            return Err(EngineError::HandleConflict);
        }
        if request.expected_engine_revision != planner.revision.engine
            || request.consumed_revision > planner.revision.root
        {
            return Err(EngineError::RevisionConflict);
        }
        // The lifecycle describes the desired retained plan so creations and replacements can share one
        // candidate, while semantic mutations still belong only to the queried paragraph. A paragraph
        // the committed plan retains stays queryable while the lifecycle removes its siblings.
        let mut queried_paragraph_present = request.paragraph_mutations.len() == 0
            || planner
                .paragraph(paragraph_id)
                .is_some_and(|paragraph| !paragraph.created);
        for index in 0..request.paragraph_mutations.len() {
            match request
                .paragraph_mutations
                .get(index)
                .ok_or(EngineError::InvalidRequest)?
            {
                super::semantic_wire::ParagraphMutation::Upsert {
                    paragraph_id: mutated,
                    ..
                } => queried_paragraph_present |= mutated == paragraph_id,
                super::semantic_wire::ParagraphMutation::Remove {
                    paragraph_id: mutated,
                } => {
                    if mutated == paragraph_id {
                        return Err(EngineError::InvalidRequest);
                    }
                }
            }
        }
        if !queried_paragraph_present {
            return Err(EngineError::InvalidRequest);
        }
        let implicit_paragraph = implicit_paragraph_id(planner, request)?;
        let lifecycle_plan = validate_lifecycle_input(
            planner,
            request.paragraph_mutations,
            request.paragraph_order_mutations,
            implicit_paragraph,
            request.limits.max_paragraphs,
        )?;
        let spare_text_candidate_id = (lifecycle_plan.creates == 1
            && lifecycle_plan.removals == 0
            && request.paragraph_mutations.len() == 0
            && request.paragraph_order_mutations.len() == 0)
            .then_some(implicit_paragraph)
            .flatten()
            .filter(|id| {
                planner.paragraph(*id).is_none()
                    && planner.spare_paragraph.is_some()
                    && has_text_mutations_for(request.text_mutations, *id)
            });
        let mut preflight_text_candidates = core::mem::take(&mut planner.preflight_text_candidates);
        let mut preflight_edit_scratch = core::mem::take(&mut planner.preflight_edit_scratch);
        validate_planner_inputs(
            planner,
            request,
            ParagraphInputScope::Single(paragraph_id),
            font_stacks,
            spare_text_candidate_id,
            &mut preflight_text_candidates,
            &mut preflight_edit_scratch,
        )?;
        planner.prepare_semantic_inputs(request, ParagraphInputScope::Single(paragraph_id))?;
        let text = request.text_mutations;
        let styles = request.style_mutations;
        let geometry = request.geometry;
        let next_measure_generation = planner
            .measure_generation
            .checked_add(1)
            .ok_or(EngineError::RevisionExhausted)?;
        let (mut next_glyph_id, mut next_content_revision) = (
            planner.next_glyph_id.max(1),
            planner.next_content_revision.max(1),
        );
        let preparation: Result<(), EngineError> = (|| {
            planner.semantic_records.clear();
            planner.prepare_lifecycle(
                request.paragraph_mutations,
                request.paragraph_order_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
                lifecycle_plan,
                spare_text_candidate_id,
            )?;
            // Reserve ownership before any semantic stage mutates its candidate state. Each
            // successful query accepts that preparation before returning.
            admit_preparation_owner(
                &mut planner.pending_preparation_ids,
                &mut planner.unpublished_preparation_ids,
                paragraph_id,
            )?;
            let preflight_candidate =
                preflight_text_candidate_mut(&mut preflight_text_candidates, paragraph_id);
            // Preparation is durable independently of the result sidecar the host requested, so
            // it always includes positioning. A semantic mask controls serialization, not which
            // stage becomes the current retained preparation.
            let prepared = {
                let paragraph = planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                paragraph.state.prepare(
                    shaper.as_deref_mut(),
                    font_stacks,
                    font_bindings,
                    text,
                    styles,
                    geometry,
                    request.limits,
                    &mut next_glyph_id,
                    &mut next_content_revision,
                    preflight_candidate,
                    &preflight_edit_scratch,
                )
            };
            planner
                .paragraph_mut(paragraph_id)
                .ok_or(EngineError::InvalidRequest)?
                .positioned_changed = prepared?;
            if request.semantic_view_mask
                & (super::frame::SEMANTIC_VIEW_MEASUREMENT
                    | super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
                != 0
            {
                let include_layout_inspection =
                    request.semantic_view_mask & super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION != 0;
                let include_borrowed_layout =
                    request.semantic_view_mask & super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT != 0;
                let mut records = core::mem::take(&mut planner.semantic_records);
                let query = append_paragraph_measurement(
                    &mut records,
                    &mut planner
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?
                        .state,
                    paragraph_id,
                    shaper,
                    font_stacks,
                    font_bindings,
                    request.limits,
                    include_layout_inspection,
                    include_borrowed_layout,
                );
                planner.semantic_records = records;
                query?;
            }
            Ok(())
        })();
        if let Err(error) = preparation {
            self.invalidate_root(request.root_id)?;
            return Err(error.in_paragraph(paragraph_id));
        }
        clear_preflight_text_candidates(&mut preflight_text_candidates);
        planner.preflight_text_candidates = preflight_text_candidates;
        preflight_edit_scratch.clear();
        planner.preflight_edit_scratch = preflight_edit_scratch;
        // Reserve identities when they become observable, even if result encoding later fails.
        planner.next_glyph_id = planner.next_glyph_id.max(next_glyph_id);
        planner.next_content_revision = planner.next_content_revision.max(next_content_revision);
        planner.measure_generation = next_measure_generation;
        Ok(MeasuredParagraph {
            root_id: request.root_id,
            revision: planner.revision,
            preparation_revision: planner.preparation_revision,
            measure_generation: next_measure_generation,
            codec_handle: request.codec_handle,
            codec_fingerprint,
        })
    }

    fn prepare_update_inner(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&request.codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if codec
            .capability_set(CapabilitySetId(request.capability_set))
            .is_none()
        {
            return Err(EngineError::InvalidRequest);
        }
        let codec_fingerprint = codec.fingerprint();
        let cached_gather = self.gather_cache;
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
        let gather = &mut self.gather;
        let gather_cache = &mut self.gather_cache;
        let prepared_gather_cache = &mut self.prepared_gather_cache;
        let planner = self
            .planners
            .get_mut(&request.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.codec_binding.is_some_and(|binding| {
            binding.handle != request.codec_handle || binding.fingerprint != codec_fingerprint
        }) {
            return Err(EngineError::InvalidRequest);
        }
        if request.expected_engine_revision != planner.revision.engine
            || request.consumed_revision > planner.revision.root
            || publication_generation == 0
            || request.acknowledged_publication_generation
                < planner.acknowledged_publication_generation
            || request.acknowledged_publication_generation >= publication_generation
        {
            return Err(EngineError::RevisionConflict);
        }
        let implicit_paragraph = implicit_paragraph_id(planner, request)?;
        let lifecycle_plan = validate_lifecycle_input(
            planner,
            request.paragraph_mutations,
            request.paragraph_order_mutations,
            implicit_paragraph,
            request.limits.max_paragraphs,
        )?;
        let spare_text_candidate_id = (lifecycle_plan.creates == 1
            && lifecycle_plan.removals == 0
            && request.paragraph_mutations.len() == 0
            && request.paragraph_order_mutations.len() == 0)
            .then_some(implicit_paragraph)
            .flatten()
            .filter(|id| {
                planner.paragraph(*id).is_none()
                    && planner.spare_paragraph.is_some()
                    && has_text_mutations_for(request.text_mutations, *id)
            });
        let mut preflight_text_candidates = core::mem::take(&mut planner.preflight_text_candidates);
        let mut preflight_edit_scratch = core::mem::take(&mut planner.preflight_edit_scratch);
        validate_planner_inputs(
            planner,
            request,
            ParagraphInputScope::Indexed,
            font_stacks,
            spare_text_candidate_id,
            &mut preflight_text_candidates,
            &mut preflight_edit_scratch,
        )?;
        planner.prepare_semantic_inputs(request, ParagraphInputScope::Indexed)?;
        let next = match (
            planner.revision.engine.checked_add(1),
            planner.revision.root.checked_add(1),
        ) {
            (Some(engine), Some(root)) => RootRevision { engine, root },
            _ => return Err(EngineError::RevisionExhausted),
        };
        // Accept the renderer's monotonic fence before preparing. Failure recovery preserves
        // this fence when it rebuilds the derived root.
        if !planner.placement_acknowledgement_rebased {
            planner
                .placement_slots
                .acknowledge(request.acknowledged_publication_generation)
                .map_err(placement_slot_error)?;
        }
        planner.acknowledged_publication_generation = request.acknowledged_publication_generation;
        let current_gather_key = GatherCacheKey {
            root_id: request.root_id,
            revision: planner.revision,
            codec_handle: request.codec_handle,
            codec_fingerprint,
            capability_set: request.capability_set,
        };
        let next_gather_key = GatherCacheKey {
            revision: next,
            ..current_gather_key
        };
        let checkpoint =
            planner.revision.root == 0 || request.consumed_revision != planner.revision.root;
        let preparation_changed =
            planner.preparation_revision != planner.published_preparation_revision;
        #[cfg(test)]
        super::work_attribution::record(|work| {
            work.prepare_checkpoints += usize::from(checkpoint);
            work.prepare_changed += usize::from(preparation_changed);
        });
        let (mut next_glyph_id, mut next_content_revision) = (
            planner.next_glyph_id.max(1),
            planner.next_content_revision.max(1),
        );
        let mut gather_output_matches_next = false;
        let preparation = (|| {
            planner.semantic_records.clear();
            planner.prepare_lifecycle(
                request.paragraph_mutations,
                request.paragraph_order_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
                lifecycle_plan,
                spare_text_candidate_id,
            )?;
            if !checkpoint
                && !preparation_changed
                && planner.lifecycle_changed
                && order_only_request(request)
                && request.compositing_independent == planner.compositing_independent
                && !planner_has_decorations(planner)
            {
                let mut stable_ids = core::mem::take(&mut planner.reorder_stable_ids);
                stable_ids.clear();
                let stable_id_result = (|| {
                    let required =
                        planner
                            .active_order()
                            .iter()
                            .try_fold(0usize, |total, ordered| {
                                let paragraph = planner
                                    .paragraph(ordered.id)
                                    .ok_or(EngineError::InvalidRequest)?;
                                total
                                    .checked_add(paragraph.state.positioned.active().glyphs().len())
                                    .ok_or(EngineError::ResultTooLarge)
                            })?;
                    stable_ids
                        .try_reserve(required)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    for ordered in planner.active_order() {
                        let paragraph = planner
                            .paragraph(ordered.id)
                            .ok_or(EngineError::InvalidRequest)?;
                        for glyph in paragraph.state.positioned.active().glyphs() {
                            let binding = font_bindings
                                .iter()
                                .find(|binding| binding.handle == glyph.binding_handle)
                                .ok_or_else(|| gather_error(GatherError::FontBindingMissing))?;
                            if binding
                                .binding
                                .select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
                                .is_none()
                            {
                                continue;
                            }
                            if glyph.stable_id == 0 {
                                return Err(EngineError::InvalidRequest);
                            }
                            stable_ids.push(glyph.stable_id);
                        }
                    }
                    Ok(())
                })();
                let reorder_prepared = match stable_id_result {
                    Ok(()) => planner.plan.prepare_reorder(
                        codec,
                        CapabilitySetId(request.capability_set),
                        &stable_ids,
                        publication_generation,
                    ),
                    Err(error) => {
                        planner.reorder_stable_ids = stable_ids;
                        return Err(error);
                    }
                };
                planner.reorder_stable_ids = stable_ids;
                if reorder_prepared.map_err(plan_error)? {
                    planner
                        .placement_slots
                        .prepare_reuse(publication_generation)
                        .map_err(placement_slot_error)?;
                    planner.pending_placement_slot_count = planner.placement_slot_count;
                    planner.session_placement_rows.clear();
                    planner.pending_next_glyph_id = next_glyph_id;
                    planner.pending_next_content_revision = next_content_revision;
                    planner.pending_compositing_independent = request.compositing_independent;
                    *gather_cache = None;
                    *prepared_gather_cache = None;
                    return Ok(());
                }
            }
            planner.prepare_semantic_work_order()?;
            for order_index in 0..planner.order_sort_scratch.len() {
                let paragraph_id = planner.order_sort_scratch[order_index].1;
                let spans = planner.semantic_input_spans(paragraph_id);
                let text = request
                    .text_mutations
                    .span(spans.text)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let styles = request
                    .style_mutations
                    .span(spans.styles)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let geometry = request
                    .geometry
                    .spans(spans.constraints, spans.inline_objects)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let paragraph = planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                if spans.is_empty() && !paragraph.state.has_pending_preparation() {
                    paragraph.positioned_changed = false;
                    continue;
                }
                admit_preparation_owner(
                    &mut planner.pending_preparation_ids,
                    &mut planner.unpublished_preparation_ids,
                    paragraph_id,
                )?;
                let preflight_candidate =
                    preflight_text_candidate_mut(&mut preflight_text_candidates, paragraph_id);
                let prepared = {
                    let paragraph = planner
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?;
                    paragraph.state.prepare(
                        shaper.as_deref_mut(),
                        font_stacks,
                        font_bindings,
                        text,
                        styles,
                        geometry,
                        request.limits,
                        &mut next_glyph_id,
                        &mut next_content_revision,
                        preflight_candidate,
                        &preflight_edit_scratch,
                    )
                };
                planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?
                    .positioned_changed =
                    prepared.map_err(|error| error.in_paragraph(paragraph_id))?;
            }
            let positioned_changed = preparation_changed
                || planner.lifecycle_changed
                || !planner.unpublished_preparation_ids.is_empty()
                || planner.pending_preparation_ids.iter().any(|id| {
                    planner
                        .paragraph(*id)
                        .is_some_and(|paragraph| paragraph.positioned_changed)
                });
            if positioned_changed || checkpoint {
                planner.prepare_placement_slots(
                    publication_generation,
                    preparation_changed,
                    checkpoint,
                    &mut next_content_revision,
                )?;
            } else {
                planner
                    .placement_slots
                    .prepare_reuse(publication_generation)
                    .map_err(placement_slot_error)?;
                planner.pending_placement_slot_count = planner.placement_slot_count;
                planner.session_placement_rows.clear();
            }
            let reuse_ordered_plan = !checkpoint
                && !positioned_changed
                && request.compositing_independent == planner.compositing_independent;
            if reuse_ordered_plan {
                planner.plan.prepare_reuse().map_err(plan_error)?;
                #[cfg(test)]
                super::work_attribution::record(|work| work.prepare_reuse_modes += 1);
                gather_output_matches_next = cached_gather == Some(current_gather_key);
            } else {
                let sparse = cached_gather == Some(current_gather_key)
                    && !checkpoint
                    && planner.prepare_retained_order(RetainedOrderPurpose::Gather)?;
                let replacement =
                    if cached_gather == Some(current_gather_key) && !checkpoint && !sparse {
                        planner.prepare_replacement_gather_order()?
                    } else {
                        None
                    };
                let record_count = if let Some(count) = replacement {
                    count
                } else if sparse {
                    planner
                        .gathered_source_count
                        .ok_or(EngineError::InvalidRequest)?
                } else {
                    planner
                        .active_order()
                        .iter()
                        .try_fold(0usize, |total, ordered| {
                            let paragraph = planner
                                .paragraph(ordered.id)
                                .ok_or(EngineError::InvalidRequest)?;
                            total
                                .checked_add(paragraph.state.positioned.active().glyphs().len())
                                .ok_or(EngineError::ResultTooLarge)
                        })?
                };
                *gather_cache = None;
                *prepared_gather_cache = None;
                let capability_set = CapabilitySetId(request.capability_set);
                // Decoration rows bypass the retained gather cursor arithmetic, so a retained plan with
                // any decorated paragraph must rebuild from a reset workspace; entering the
                // retained path and falling back mid-append would stack fresh rows onto the
                // previous update's buffers.
                let ranges_reusable =
                    sparse || replacement.is_some() || !planner_has_decorations(planner);
                let attempted_retained =
                    cached_gather == Some(current_gather_key) && ranges_reusable;
                let retained = attempted_retained
                    && gather
                        .begin_retained(codec, record_count)
                        .map_err(gather_error)?;
                if retained {
                    append_planner_gather(
                        gather,
                        planner,
                        codec,
                        capability_set,
                        font_bindings,
                        true,
                        sparse || replacement.is_some(),
                        replacement.is_some(),
                    )?;
                }
                if !retained {
                    gather.begin(codec, record_count).map_err(gather_error)?;
                    append_planner_gather(
                        gather,
                        planner,
                        codec,
                        capability_set,
                        font_bindings,
                        false,
                        false,
                        false,
                    )?;
                }
                #[cfg(test)]
                super::work_attribution::record(|work| {
                    if retained && sparse {
                        work.prepare_retained_sparse_modes += 1;
                    } else if retained && replacement.is_some() {
                        work.prepare_retained_replacement_modes += 1;
                    } else {
                        work.prepare_fresh_modes += 1;
                    }
                    work.gather_output_source_rows += gather.diagnostic_source_count();
                    work.gather_output_selected_rows += gather.view().plan_input().glyphs.len();
                    work.prepared_positioned_source_rows += record_count;
                });
                planner.gathered_source_count = if ranges_reusable {
                    Some(record_count)
                } else {
                    None
                };
                let output_scope = if sparse {
                    gather.changed_output_intervals().map(|ranges| {
                        super::render_plan_compiler::OwnedOutputScope {
                            previous_revision: planner.revision.root,
                            scope: super::ordered_plan::RetainedOutputScope::ChangedIntervals(
                                ranges,
                            ),
                        }
                    })
                } else {
                    None
                }
                .or_else(|| {
                    gather
                        .correspondence()
                        .first()
                        .filter(|_| retained)
                        .map(|_| super::render_plan_compiler::OwnedOutputScope {
                            previous_revision: planner.revision.root,
                            scope: super::ordered_plan::RetainedOutputScope::Replacement(
                                gather.correspondence(),
                            ),
                        })
                });
                let gathered = gather.view();
                let mut plan_input = gathered.plan_input();
                plan_input.order_independent = request.compositing_independent;
                planner
                    .plan
                    .prepare_session(
                        SessionPlacementInput {
                            placement_rows: &planner.session_placement_rows,
                            placement_capacity: planner.pending_placement_slot_count,
                        },
                        codec
                            .capability_set(capability_set)
                            .ok_or(EngineError::InvalidRequest)?,
                        publication_generation,
                        checkpoint,
                    )
                    .map_err(plan_error)?;
                planner
                    .plan
                    .prepare_owned(
                        codec,
                        CapabilitySetId(request.capability_set),
                        plan_input,
                        checkpoint,
                        publication_generation,
                        request.acknowledged_publication_generation,
                        output_scope,
                        gather.bounds_changed(),
                    )
                    .map_err(plan_error)?;
                gather_output_matches_next = true;
            }
            let include_layout_inspection =
                request.semantic_view_mask & super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION != 0;
            if request.semantic_view_mask
                & (super::frame::SEMANTIC_VIEW_MEASUREMENT
                    | super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
                != 0
            {
                let mut records = core::mem::take(&mut planner.semantic_records);
                let query = (|| {
                    for order_index in 0..planner.active_order().len() {
                        let paragraph_id = planner.active_order()[order_index].id;
                        let input_unchanged = planner.semantic_input_spans(paragraph_id).is_empty();
                        let paragraph = planner
                            .paragraph(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?;
                        let positioned_changed = paragraph.positioned_changed
                            || paragraph.preparation_changed_since_publication;
                        if input_unchanged && !positioned_changed && !preparation_changed {
                            continue;
                        }
                        admit_preparation_owner(
                            &mut planner.pending_preparation_ids,
                            &mut planner.unpublished_preparation_ids,
                            paragraph_id,
                        )?;
                        let paragraph = planner
                            .paragraph_mut(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?;
                        append_paragraph_measurement(
                            &mut records,
                            &mut paragraph.state,
                            paragraph_id,
                            shaper.as_deref_mut(),
                            font_stacks,
                            font_bindings,
                            request.limits,
                            include_layout_inspection,
                            request.semantic_view_mask
                                & super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT
                                != 0,
                        )
                        .map_err(|error| error.in_paragraph(paragraph_id))?;
                    }
                    Ok(())
                })();
                planner.semantic_records = records;
                query?;
            }
            planner.semantic_input_spans.clear();
            planner.pending_next_glyph_id = next_glyph_id;
            planner.pending_next_content_revision = next_content_revision;
            planner.pending_compositing_independent = request.compositing_independent;
            Ok(())
        })();
        if let Err(error) = preparation {
            self.invalidate_root(request.root_id)?;
            return Err(error);
        }
        clear_preflight_text_candidates(&mut preflight_text_candidates);
        planner.preflight_text_candidates = preflight_text_candidates;
        preflight_edit_scratch.clear();
        planner.preflight_edit_scratch = preflight_edit_scratch;
        if gather_output_matches_next {
            *prepared_gather_cache = Some(next_gather_key);
        }
        Ok(PreparedUpdate {
            root_id: request.root_id,
            previous: planner.revision,
            next,
            required_base_revision: if checkpoint { 0 } else { planner.revision.root },
            checkpoint,
            codec_handle: request.codec_handle,
            capability_set: request.capability_set,
            codec_fingerprint,
            preparation_revision: planner.preparation_revision,
        })
    }

    pub(crate) fn prepared_plan(
        &self,
        prepared: PreparedUpdate,
    ) -> Result<RenderPlanView<'_>, EngineError> {
        let planner = self
            .planners
            .get(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        planner
            .plan
            .plan_view(
                prepared.codec_handle,
                CapabilitySetId(prepared.capability_set),
                prepared.codec_fingerprint,
            )
            .map_err(plan_error)
    }

    pub(crate) fn prepared_semantic_views(
        &self,
        prepared: PreparedUpdate,
    ) -> Result<&[super::semantic_view::SemanticRecord], EngineError> {
        let planner = self
            .planners
            .get(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&planner.semantic_records)
    }

    /// Discards the derived root when a prepared query cannot be delivered.
    /// The caller-owned text remains authoritative and can be replayed after reset.
    pub(crate) fn invalidate_after_measure_failure(
        &mut self,
        measured: MeasuredParagraph,
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision
            || planner.preparation_revision != measured.preparation_revision
            || planner.measure_generation != measured.measure_generation
        {
            self.invalidate_root(measured.root_id)?;
            return Err(EngineError::RevisionConflict);
        }
        self.invalidate_root(measured.root_id)
    }

    /// Commits one successfully encoded paragraph preparation without advancing renderer-plan
    /// revision or publication acknowledgement. The renderer plan remains independently
    /// committed; a later publication compiles it from this preparation revision.
    pub(crate) fn commit_measure(
        &mut self,
        measured: MeasuredParagraph,
    ) -> Result<u32, EngineError> {
        let validation = self.planners.get(&measured.root_id).map(|planner| {
            if planner.revision != measured.revision
                || planner.preparation_revision != measured.preparation_revision
                || planner.measure_generation != measured.measure_generation
            {
                return Err(EngineError::RevisionConflict);
            }
            let preparation_changed = planner.lifecycle_changed
                || planner.pending_preparation_ids.iter().any(|id| {
                    planner
                        .paragraph(*id)
                        .is_some_and(|paragraph| paragraph.state.has_pending_preparation())
                });
            let revision = if preparation_changed {
                planner
                    .preparation_revision
                    .checked_add(1)
                    .ok_or(EngineError::RevisionExhausted)?
            } else {
                planner.preparation_revision
            };
            Ok(revision)
        });
        let revision = match validation {
            None => return Err(EngineError::RootMissing),
            Some(Ok(validated)) => validated,
            Some(Err(error)) => {
                // Encoding succeeded, so a failed adoption is an internal contract breach.
                // Retire the derived root and let the host rebuild it from accepted authored data.
                self.invalidate_root(measured.root_id)?;
                return Err(error);
            }
        };
        let planner = self
            .planners
            .get_mut(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        planner.codec_binding = Some(CodecBinding {
            handle: measured.codec_handle,
            fingerprint: measured.codec_fingerprint,
        });
        planner.commit_paragraphs(false);
        planner.preparation_revision = revision;
        planner.semantic_input_spans.clear();
        // Preparation changes no gathered rows or renderer revision. The published gather key
        // remains the comparison baseline until publication consumes the accumulated deltas.
        Ok(revision)
    }

    pub(crate) fn measured_semantic_views(
        &self,
        measured: MeasuredParagraph,
    ) -> Result<&[super::semantic_view::SemanticRecord], EngineError> {
        let planner = self
            .planners
            .get(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision
            || planner.preparation_revision != measured.preparation_revision
            || planner.measure_generation != measured.measure_generation
        {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&planner.semantic_records)
    }

    pub(crate) fn invalidate_after_publication_failure(
        &mut self,
        prepared: PreparedUpdate,
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        let revision_matches = planner.revision == prepared.previous;
        self.invalidate_root(prepared.root_id)?;
        if revision_matches {
            Ok(())
        } else {
            Err(EngineError::RevisionConflict)
        }
    }

    pub(crate) fn commit_update(
        &mut self,
        prepared: PreparedUpdate,
    ) -> Result<CommittedUpdate, EngineError> {
        let previous_gather_key = prepared_gather_key(prepared, prepared.previous);
        let next_gather_key = prepared_gather_key(prepared, prepared.next);
        let planner = self
            .planners
            .get_mut(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        if planner.preparation_revision != prepared.preparation_revision {
            return Err(EngineError::RevisionConflict);
        }
        planner
            .plan
            .commit_owned(prepared.next.root)
            .map_err(plan_error)?;
        planner.placement_slots.commit();
        planner.placement_acknowledgement_rebased = false;
        planner.desired_placements.clear();
        planner.session_placement_rows.clear();
        planner.placement_slot_count = planner.pending_placement_slot_count;
        planner.pending_placement_slot_count = 0;
        planner.commit_paragraphs(true);
        if planner.pending_placement_ranges_refresh {
            let mut start = 0;
            for index in 0..planner.ordered_paragraphs.len() {
                let id = planner.ordered_paragraphs[index].id;
                if let Some(paragraph) = planner.paragraph_mut(id) {
                    // Full preparation already proved the aggregate occurrence count fits usize.
                    let end = start
                        + paragraph
                            .state
                            .positioned
                            .committed()
                            .placement_segments()
                            .len();
                    paragraph.placement_range = RecordSpan { start, end };
                    start = end;
                }
            }
            planner.placement_ranges_current = true;
        }
        planner.pending_placement_ranges_refresh = false;
        planner.next_glyph_id = planner.pending_next_glyph_id;
        planner.next_content_revision = planner.pending_next_content_revision;
        planner.pending_next_glyph_id = 0;
        planner.pending_next_content_revision = 0;
        planner.compositing_independent = planner.pending_compositing_independent;
        planner.codec_binding = Some(CodecBinding {
            handle: prepared.codec_handle,
            fingerprint: prepared.codec_fingerprint,
        });
        planner.revision = prepared.next;
        planner.published_preparation_revision = prepared.preparation_revision;
        if self.prepared_gather_cache == Some(next_gather_key) {
            self.gather_cache = Some(next_gather_key);
            self.prepared_gather_cache = None;
        } else if self.gather_cache == Some(previous_gather_key) {
            self.gather_cache = Some(next_gather_key);
        }
        Ok(CommittedUpdate {
            root_id: prepared.root_id,
            revision: prepared.next,
            required_base_revision: prepared.required_base_revision,
            checkpoint: prepared.checkpoint,
        })
    }
}

fn prepared_gather_key(prepared: PreparedUpdate, revision: RootRevision) -> GatherCacheKey {
    GatherCacheKey {
        root_id: prepared.root_id,
        revision,
        codec_handle: prepared.codec_handle,
        codec_fingerprint: prepared.codec_fingerprint,
        capability_set: prepared.capability_set,
    }
}

fn sort_session_placement_rows(
    rows: &mut [SessionPlacementRow],
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    if rows.windows(2).any(|pair| pair[0].slot >= pair[1].slot) {
        sort::prepare_pairs(sort_pairs, rows.len())?;
        for (index, row) in rows.iter().enumerate() {
            sort_pairs.push((u64::from(row.slot), index as u32));
        }
        sort::sort_pairs(sort_pairs);
        sort::apply_pair_order(rows, sort_pairs);
    }
    Ok(())
}

fn placement_logical_key(
    paragraph: ParagraphIncarnation,
    segment: PlacementSegment,
    run_source: LayoutRunSourceKind,
) -> PlacementLogicalKey {
    PlacementLogicalKey {
        paragraph,
        run_owner: segment.layout_run_owner,
        run_source,
        identity: segment.identity,
        segment_anchor: segment.segment_anchor,
        source_anchor: segment.source_anchor,
        numeric_block_ordinal: segment.numeric_block_ordinal,
        glyph_source: segment.glyph_source,
    }
}

/// Whether any live paragraph carries decoration records, using pending state when prepared —
/// the same view `append_planner_gather` reads.
fn planner_has_decorations(planner: &PlannerState) -> bool {
    planner.active_order().iter().any(|ordered| {
        planner.paragraph(ordered.id).is_some_and(|paragraph| {
            let positioned = paragraph.state.positioned.active();
            !positioned.decorations().is_empty()
        })
    })
}

fn order_only_request(request: UpdateRequest<'_>) -> bool {
    request.paragraph_mutations.len() == 0
        && request.paragraph_order_mutations.len() != 0
        && request.text_mutations.len() == 0
        && request.style_mutations.len() == 0
        && request.geometry.constraint_count() == 0
        && request.geometry.region_count() == 0
        && request.geometry.exclusion_count() == 0
        && request.geometry.inline_object_count() == 0
        && request.semantic_view_mask == 0
}

/// Whether a rebuilt shaping-run list keeps the previous list's positional
/// topology: same count and, per index, the same text span and shaping
/// identity. Style VALUES may differ — that is what a metrics-only refresh
/// re-derives — but a merged, split, or re-spanned run list invalidates the
/// retained cluster arena's run indices.
fn shaping_run_topology_stable(
    previous: &[super::shaping_state::ShapingRun],
    next: &[super::shaping_state::ShapingRun],
) -> bool {
    previous.len() == next.len()
        && previous.iter().zip(next).all(|(before, after)| {
            before.text_start == after.text_start
                && before.text_end == after.text_end
                && before.script == after.script
                && before.direction == after.direction
                && before.bidi_level == after.bidi_level
        })
}

/// Emits prepared measurements and optional inspection, building missing intrinsic layout in the shared pipeline.
// D-244 found outlining this stage size-neutral; keep its inputs explicit.
#[allow(clippy::too_many_arguments)]
fn append_paragraph_measurement(
    records: &mut Vec<super::semantic_view::SemanticRecord>,
    state: &mut ParagraphState,
    paragraph_id: u32,
    mut shaper: Option<&mut ShaperRegistry>,
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    limits: super::frame::UpdateLimits,
    include_layout_inspection: bool,
    include_borrowed_layout: bool,
) -> Result<(), EngineError> {
    let visible_extents = {
        let clusters = state.clusters.active();
        let geometry = state.geometry.active();
        let flow = state.flow_layout.active();
        let flow_thread_id = geometry
            .constraints
            .first()
            .ok_or(EngineError::InvalidRequest)?
            .flow_thread_id;
        super::layout_query::flow_extents(
            flow_thread_id,
            flow,
            clusters,
            thread_typography(geometry, flow_thread_id),
        )?
    };
    let active_flow = state.flow_layout.active();
    let active_line_count = active_flow.lines.len();
    let has_ellipsis = !active_flow.ellipsis_threads().is_empty();
    let cluster_count = state.clusters.active().starts.len();
    let constraint = state
        .geometry
        .active()
        .constraints
        .first()
        .copied()
        .ok_or(EngineError::InvalidRequest)?;
    // Intrinsic widths depend on cluster advances/breaks and wrap; unchanged reads reuse them.
    let intrinsics = state
        .intrinsic_widths_cache
        .filter(|(wrap, _)| *wrap == constraint.wrap)
        .map(|(_, widths)| widths)
        .unwrap_or_else(|| {
            let widths = state.clusters.active().intrinsic_widths(constraint.wrap);
            state.intrinsic_widths_cache = Some((constraint.wrap, widths));
            widths
        });
    let needs_intrinsic = visible_extents.consumed_clusters < cluster_count || has_ellipsis;
    let reuse_intrinsic = !state.has_pending_preparation()
        && state.clipped_inspection.active().mode != IntrinsicInspection::None;
    if needs_intrinsic && !reuse_intrinsic {
        state.prepare_intrinsic_flow_layout(
            shaper.as_deref_mut().ok_or(EngineError::InvalidRequest)?,
            font_stacks,
            font_bindings,
            limits.max_lines,
            limits.max_slots_per_band,
        )?;
    }
    let max_lines_truncated = constraint.max_lines != 0
        && active_line_count
            >= usize::try_from(constraint.max_lines).map_err(|_| EngineError::ResultTooLarge)?;
    let inspect_full_clipped_layout =
        needs_intrinsic && constraint.overflow == OVERFLOW_CLIP && !max_lines_truncated;
    if inspect_full_clipped_layout && !reuse_intrinsic {
        state
            .prepare_intrinsic_positioned(shaper.as_deref().ok_or(EngineError::InvalidRequest)?)?;
    }
    let text = &state.text.active().units;
    let clusters = state.clusters.active();
    let geometry = state.geometry.active();
    let active_flow = state.flow_layout.active();
    let active_positioned = state.positioned.active();
    let flow = if inspect_full_clipped_layout {
        &state.intrinsic_flow_layout_scratch
    } else {
        active_flow
    };
    let positioned = if inspect_full_clipped_layout {
        if reuse_intrinsic {
            &state.clipped_inspection.active().positioned
        } else {
            &state.clipped_inspection.pending().positioned
        }
    } else {
        active_positioned
    };
    let intrinsic_extents = if needs_intrinsic {
        let flow_thread_id = geometry
            .constraints
            .first()
            .ok_or(EngineError::InvalidRequest)?
            .flow_thread_id;
        Some(super::layout_query::flow_extents(
            flow_thread_id,
            &state.intrinsic_flow_layout_scratch,
            clusters,
            thread_typography(geometry, flow_thread_id),
        )?)
    } else {
        None
    };
    let (line_glyph_starts, line_glyph_counts) = positioned.semantic_line_glyph_spans();
    let visible_glyphs = (
        positioned.semantic_glyphs().len(),
        positioned
            .semantic_glyphs()
            .iter()
            .filter(|glyph| glyph.glyph_id == 0)
            .count(),
    );
    super::layout_query::append_measurement_with_glyph_spans(
        records,
        paragraph_id,
        text.len(),
        clusters.starts.len(),
        visible_glyphs,
        geometry,
        flow,
        positioned.semantic_glyphs(),
        positioned.placement_translations(),
        line_glyph_starts,
        line_glyph_counts,
        Some(positioned.semantic_line_inline_extents()),
        clusters,
        intrinsic_extents,
        intrinsics,
        include_layout_inspection || include_borrowed_layout,
        include_layout_inspection,
    )?;
    if !reuse_intrinsic {
        state.clipped_inspection.pending_mut().mode = if inspect_full_clipped_layout {
            IntrinsicInspection::Positioned
        } else if needs_intrinsic {
            IntrinsicInspection::Flow
        } else {
            IntrinsicInspection::None
        };
        state.clipped_inspection.mark_prepared();
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_planner_gather(
    gather: &mut CodecGatherWorkspace,
    planner: &mut PlannerState,
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
    retained: bool,
    sparse: bool,
    replacement: bool,
) -> Result<(), EngineError> {
    if retained && replacement {
        return replace_planner_gather(gather, planner, codec, capability_set, font_bindings);
    }
    let mut retaining = retained;
    let mut order_index = 0;
    if retaining && sparse {
        let owners = planner_gather_owners(planner);
        let stop = gather
            .append_retained_stream(codec, capability_set, owners, |handle| {
                font_bindings
                    .iter()
                    .find(|binding| binding.handle == handle)
                    .map(|binding| &binding.binding)
            })
            .map_err(gather_error)?;
        if stop.is_some() {
            return replace_planner_gather(gather, planner, codec, capability_set, font_bindings);
        } else {
            order_index = planner.order_sort_scratch.last().map_or(Ok(0), |entry| {
                usize::try_from(entry.0)
                    .map(|index| index + 1)
                    .map_err(|_| EngineError::InvalidRequest)
            })?;
            if order_index < planner.active_order().len() {
                let first = planner
                    .paragraph(planner.active_order()[order_index].id)
                    .and_then(|p| p.gather_range);
                let last = planner
                    .active_order()
                    .last()
                    .and_then(|ordered| planner.paragraph(ordered.id))
                    .and_then(|p| p.gather_range);
                if first
                    .zip(last)
                    .is_some_and(|(first, last)| gather.retain_unchanged(first.through(last)))
                {
                    order_index = planner.active_order().len();
                }
            }
            if order_index == planner.active_order().len() && gather.finish_retained() {
                return Ok(());
            }
        }
        gather.truncate_to_retained_prefix().map_err(gather_error)?;
        retaining = false;
    }
    while order_index < planner.active_order().len() {
        let ordered = planner.active_order()[order_index];
        let paragraph_index = planner
            .paragraphs
            .binary_search_by_key(&ordered.id, |paragraph| paragraph.id)
            .map_err(|_| EngineError::InvalidRequest)?;
        let paragraph = &planner.paragraphs[paragraph_index];
        // The exact workspace cache key is checked before entering this retained walk.
        // Pending binding/preparation owners and lifecycle changes cannot borrow old ranges.
        if retaining
            && !planner.lifecycle_changed
            && !paragraph.positioned_changed
            && !paragraph.preparation_changed_since_publication
            && planner
                .pending_preparation_ids
                .binary_search(&ordered.id)
                .is_err()
            && paragraph
                .gather_range
                .is_some_and(|range| gather.retain_unchanged(range))
        {
            #[cfg(test)]
            super::work_attribution::record(|work| work.gather_paragraph_visits += 1);
            order_index += 1;
            continue;
        }
        let start = gather.position();
        let positioned = paragraph.state.positioned.active();
        let semantic_f32 = positioned.semantic_f32();
        let semantic_u32 = positioned.semantic_u32();
        let semantic_change_masks = if retaining
            && !paragraph.positioned_changed
            && !paragraph.preparation_changed_since_publication
        {
            &[][..]
        } else {
            positioned.semantic_change_masks()
        };
        let input = LayoutPlanInput {
            transform_id: ordered.id,
            glyphs: positioned.glyphs(),
            semantic_glyphs: positioned.semantic_glyphs(),
            placement_translations: positioned.placement_translations(),
            semantic_change_masks,
            semantic_f32: &semantic_f32,
            semantic_u32: &semantic_u32,
        };
        let binding_for_font = |handle| {
            font_bindings
                .iter()
                .find(|binding| binding.handle == handle)
                .map(|binding| &binding.binding)
        };
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                ordered.id,
                planner.revision.engine.max(1),
                super::codec_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        if retaining {
            match gather
                .append_retained_scoped(
                    codec,
                    capability_set,
                    input,
                    paragraph
                        .gather_range
                        .filter(|range| {
                            sparse
                                && (paragraph.positioned_changed
                                    || paragraph.preparation_changed_since_publication)
                                && range.source_count() == input.glyphs.len()
                        })
                        .and_then(|_| positioned.unpublished_source_intervals()),
                    binding_for_font,
                )
                .map_err(gather_error)?
            {
                RetainedGather::Complete => {}
                RetainedGather::RebuildFrom(source_start) => {
                    gather.truncate_to_retained_prefix().map_err(gather_error)?;
                    gather
                        .append_from(codec, capability_set, input, source_start, binding_for_font)
                        .map_err(gather_error)?;
                    retaining = false;
                }
            }
        } else {
            #[cfg(test)]
            super::work_attribution::record(|work| work.gather_paragraph_visits += 1);
            gather
                .append_from(codec, capability_set, input, 0, binding_for_font)
                .map_err(gather_error)?;
        }
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                ordered.id,
                planner.revision.engine.max(1),
                super::codec_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
        let range = gather.range_since(start);
        planner.paragraphs[paragraph_index].gather_range = Some(range);
        order_index += 1;
    }
    if retaining && !gather.finish_retained() {
        gather.truncate_to_retained_prefix().map_err(gather_error)?;
    }
    Ok(())
}

fn planner_gather_owners(
    planner: &PlannerState,
) -> impl Iterator<Item = Result<RetainedGatherOwner<'_>, GatherError>> + Clone {
    planner.order_sort_scratch.iter().map(|entry| {
        let paragraph = planner
            .paragraph(entry.1)
            .ok_or(GatherError::InvalidSemanticShape)?;
        let positioned = paragraph.state.positioned.active();
        let range = paragraph
            .gather_range
            .ok_or(GatherError::InvalidSemanticShape)?;
        let masks =
            if !paragraph.positioned_changed && !paragraph.preparation_changed_since_publication {
                &[][..]
            } else {
                positioned.semantic_change_masks()
            };
        Ok(RetainedGatherOwner::positioned(
            range,
            entry.1,
            positioned,
            masks,
            (paragraph.positioned_changed || paragraph.preparation_changed_since_publication)
                .then(|| positioned.unpublished_source_intervals())
                .flatten(),
        ))
    })
}

fn replace_planner_gather(
    gather: &mut CodecGatherWorkspace,
    planner: &mut PlannerState,
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
) -> Result<(), EngineError> {
    let owners = planner_gather_owners(planner);
    gather
        .replace_retained_owners(codec, capability_set, owners, |handle| {
            font_bindings
                .iter()
                .find(|binding| binding.handle == handle)
                .map(|binding| &binding.binding)
        })
        .map_err(gather_error)?;
    let mut owners = gather
        .correspondence()
        .iter()
        .filter(|entry| entry.owner.is_some());
    let mut current = owners.next();
    let mut shift = None;
    let first = planner
        .order_sort_scratch
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    let first = usize::try_from(first.0).map_err(|_| EngineError::InvalidRequest)?;
    // Prefix coordinates do not move. Reconcile owner and suffix offsets once in renderer order.
    for index in first..planner.active_order().len() {
        let id = planner.active_order()[index].id;
        let paragraph = planner
            .paragraph_mut(id)
            .ok_or(EngineError::InvalidRequest)?;
        let old = paragraph.gather_range.ok_or(EngineError::InvalidRequest)?;
        paragraph.gather_range = Some(
            if let Some(entry) = current.filter(|entry| entry.owner == Some(id)) {
                if entry.old != old {
                    return Err(EngineError::InvalidRequest);
                }
                shift = Some((entry.old, entry.next));
                current = owners.next();
                entry.next
            } else if let Some((previous, next)) = shift {
                old.shifted_after(previous, next).map_err(gather_error)?
            } else {
                old
            },
        );
    }
    if current.is_some() || !gather.finish_retained() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

impl PlannerState {
    /// A count-changing frontier shares one envelope and a clean cached suffix.
    fn prepare_replacement_gather_order(&mut self) -> Result<Option<usize>, EngineError> {
        let Some(mut count) = self.gathered_source_count else {
            return Ok(None);
        };
        if !self.prepare_retained_order(RetainedOrderPurpose::ReplacementGather)? {
            return Ok(None);
        }
        if self.order_sort_scratch.is_empty() {
            return Ok(None);
        }
        let mut changed_count = false;
        for entry in &self.order_sort_scratch {
            let paragraph = self.paragraph(entry.1).ok_or(EngineError::InvalidRequest)?;
            let range = paragraph.gather_range.ok_or(EngineError::InvalidRequest)?;
            let next_count = paragraph.state.positioned.active().glyphs().len();
            changed_count |= range.source_count() != next_count;
            count = count
                .checked_sub(range.source_count())
                .and_then(|count| count.checked_add(next_count))
                .ok_or(EngineError::ResultTooLarge)?;
        }
        Ok(changed_count.then_some(count))
    }

    /// Reuse renderer order and the preparation frontier without inspecting clean owners.
    fn prepare_retained_order(
        &mut self,
        purpose: RetainedOrderPurpose,
    ) -> Result<bool, EngineError> {
        if self.lifecycle_changed
            || match purpose {
                RetainedOrderPurpose::Gather | RetainedOrderPurpose::ReplacementGather => {
                    self.gathered_source_count.is_none()
                }
                RetainedOrderPurpose::Placement => !self.placement_ranges_current,
            }
        {
            return Ok(false);
        }
        self.order_sort_scratch.clear();
        let required = self
            .pending_preparation_ids
            .len()
            .checked_add(self.unpublished_preparation_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.order_sort_scratch
            .try_reserve(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        for id in self
            .pending_preparation_ids
            .iter()
            .chain(&self.unpublished_preparation_ids)
        {
            let paragraph = self.paragraph(*id).ok_or(EngineError::InvalidRequest)?;
            let positioned = paragraph.state.positioned.active();
            let reusable = match purpose {
                RetainedOrderPurpose::Gather => {
                    positioned.decorations().is_empty()
                        && paragraph
                            .gather_range
                            .is_some_and(|range| range.source_count() == positioned.glyphs().len())
                }
                RetainedOrderPurpose::ReplacementGather => {
                    positioned.decorations().is_empty() && paragraph.gather_range.is_some()
                }
                RetainedOrderPurpose::Placement => {
                    paragraph.placement_range.end - paragraph.placement_range.start
                        == positioned.placement_segments().len()
                }
            };
            if !reusable
                || paragraph.pending_remove
                || self
                    .active_order()
                    .get(paragraph.renderer_order_index)
                    .is_none_or(|ordered| ordered.id != *id)
            {
                return Ok(false);
            }
            let index = u64::try_from(paragraph.renderer_order_index)
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.order_sort_scratch.push((index, *id));
        }
        sort::sort_pairs(&mut self.order_sort_scratch);
        self.order_sort_scratch.dedup();
        #[cfg(test)]
        super::work_attribution::record(|work| {
            work.retained_owner_admissions += self.order_sort_scratch.len();
        });
        Ok(true)
    }

    /// Only authored mutations and already-staged owners need preparation. Preserve
    /// authored order for identity allocation using the existing lifecycle sort scratch.
    fn prepare_semantic_work_order(&mut self) -> Result<(), EngineError> {
        self.order_sort_scratch.clear();
        let required = self
            .semantic_input_spans
            .len()
            .checked_add(self.pending_preparation_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.order_sort_scratch
            .try_reserve(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        for id in self
            .semantic_input_spans
            .iter()
            .map(|spans| spans.id)
            .chain(self.pending_preparation_ids.iter().copied().filter(|id| {
                self.semantic_input_spans
                    .binary_search_by_key(id, |spans| spans.id)
                    .is_err()
            }))
        {
            let paragraph = self.paragraph(id).ok_or(EngineError::InvalidRequest)?;
            if paragraph.pending_remove {
                continue;
            }
            let order = paragraph
                .pending_placement
                .unwrap_or(paragraph.placement)
                .order;
            self.order_sort_scratch.push((sort::pack2(order, id), id));
        }
        sort::sort_pairs(&mut self.order_sort_scratch);
        Ok(())
    }

    fn references_font_stack(&self, handle: u32) -> bool {
        self.paragraphs.iter().any(|paragraph| {
            paragraph
                .state
                .styles
                .active()
                .arena
                .references_font_stack(handle)
        })
    }

    #[cfg(test)]
    fn first_paragraph_state(&self) -> Option<&ParagraphState> {
        self.ordered_paragraphs
            .first()
            .and_then(|ordered| self.paragraph(ordered.id))
            .map(|paragraph| &paragraph.state)
            .or_else(|| self.paragraphs.first().map(|paragraph| &paragraph.state))
            .or(self.spare_paragraph.as_ref())
    }

    fn paragraph(&self, id: u32) -> Option<&RetainedParagraph> {
        self.paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
            .ok()
            .map(|index| &self.paragraphs[index])
    }

    fn paragraph_mut(&mut self, id: u32) -> Option<&mut RetainedParagraph> {
        self.paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
            .ok()
            .map(|index| &mut self.paragraphs[index])
    }

    fn prepare_semantic_inputs(
        &mut self,
        request: UpdateRequest<'_>,
        scope: ParagraphInputScope,
    ) -> Result<(), EngineError> {
        self.semantic_input_spans.clear();
        if request.text_mutations.len() == 0
            && request.style_mutations.len() == 0
            && request.geometry.constraint_count() == 0
            && request.geometry.inline_object_count() == 0
        {
            return Ok(());
        }

        // The single-owner preflight has already checked every text/style group against
        // the selected owner and lifecycle membership. Indexed requests still need spans.
        if matches!(scope, ParagraphInputScope::Indexed) {
            route_paragraph_records(
                &mut self.semantic_input_spans,
                &self.lifecycle_membership_scratch,
                request.text_mutations.len(),
                |index| request.text_mutations.paragraph_id(index),
                ParagraphInputKind::Text,
                scope,
            )?;
            route_paragraph_records(
                &mut self.semantic_input_spans,
                &self.lifecycle_membership_scratch,
                request.style_mutations.len(),
                |index| request.style_mutations.paragraph_id(index),
                ParagraphInputKind::Style,
                scope,
            )?;
        }
        route_paragraph_records(
            &mut self.semantic_input_spans,
            &self.lifecycle_membership_scratch,
            request.geometry.constraint_count(),
            |index| request.geometry.paragraph_id(index),
            ParagraphInputKind::Constraint,
            scope,
        )?;
        let constraint_count = request.geometry.constraint_count();
        route_paragraph_records(
            &mut self.semantic_input_spans,
            &self.lifecycle_membership_scratch,
            request.geometry.inline_object_count(),
            |index| {
                constraint_count
                    .checked_add(index)
                    .and_then(|index| request.geometry.paragraph_id(index))
            },
            ParagraphInputKind::InlineObject,
            scope,
        )?;
        if matches!(scope, ParagraphInputScope::Single(_)) {
            return Ok(());
        }
        if self.semantic_input_spans.len() > 1 {
            sort::prepare_pairs(
                &mut self.style_validation_sort_pair_scratch,
                self.semantic_input_spans.len(),
            )?;
            for (index, spans) in self.semantic_input_spans.iter().enumerate() {
                self.style_validation_sort_pair_scratch
                    .push((u64::from(spans.id), index as u32));
            }
            sort::sort_pairs(&mut self.style_validation_sort_pair_scratch);
            sort::apply_pair_order(
                &mut self.semantic_input_spans,
                &mut self.style_validation_sort_pair_scratch,
            );
        }
        let mut count = 0;
        for index in 0..self.semantic_input_spans.len() {
            let mut next = self.semantic_input_spans[index];
            if count == 0 || self.semantic_input_spans[count - 1].id != next.id {
                self.semantic_input_spans[count] = next;
                count += 1;
                continue;
            }
            let previous = &mut self.semantic_input_spans[count - 1];
            for kind in [
                ParagraphInputKind::Text,
                ParagraphInputKind::Style,
                ParagraphInputKind::Constraint,
                ParagraphInputKind::InlineObject,
            ] {
                let incoming = *next.span_mut(kind);
                if incoming.is_empty() {
                    continue;
                }
                let target = previous.span_mut(kind);
                if !target.is_empty() {
                    return Err(EngineError::InvalidRequest);
                }
                *target = incoming;
            }
        }
        self.semantic_input_spans.truncate(count);
        Ok(())
    }

    fn validate_style_topology_for_inputs(
        &mut self,
        paragraph_id: u32,
        text_mutations: super::semantic_wire::TextMutationBatch<'_>,
        style_mutations: super::semantic_wire::StyleMutationBatch<'_>,
        spare_text_candidate_id: Option<u32>,
        preflight_text_candidates: &mut Vec<PreflightTextCandidate>,
        preflight_edit_scratch: &mut Vec<TextEdit>,
    ) -> Result<(), EngineError> {
        let PlannerState {
            paragraphs,
            spare_paragraph,
            style_validation_mutation_scratch,
            style_validation_sort_pair_scratch,
            style_validation_topology_scratch,
            style_validation_order_scratch,
            style_validation_nesting_scratch,
            style_validation_sort_pairs_pass,
            ..
        } = self;
        let spare_text_capacity = spare_paragraph.as_ref().map_or(0, |paragraph| {
            paragraph
                .text
                .pending()
                .units
                .capacity()
                .max(paragraph.text.committed().units.capacity())
        });
        let paragraph_index = paragraphs
            .binary_search_by_key(&paragraph_id, |paragraph| paragraph.id)
            .ok();
        let mut empty_styles = StyleArena::default();

        let candidate_index = if text_mutations.len() == 0 {
            None
        } else {
            preflight_text_candidates
                .try_reserve(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            let index = preflight_text_candidates.len();
            preflight_text_candidates.push(PreflightTextCandidate::default());
            let candidate = &mut preflight_text_candidates[index];
            candidate.paragraph_id = paragraph_id;
            candidate.buffers = if paragraph_index
                .and_then(|index| paragraphs.get(index))
                .is_some_and(|paragraph| {
                    !paragraph.state.text.is_prepared() && !paragraph.state.unicode.is_prepared()
                }) {
                CandidateBuffers::ExistingPending {
                    unit_ids_mirror_committed: false,
                }
            } else if spare_text_candidate_id == Some(paragraph_id) && spare_paragraph.is_some() {
                CandidateBuffers::SparePending
            } else {
                CandidateBuffers::Owned
            };
            match candidate.buffers {
                CandidateBuffers::ExistingPending { .. } => {
                    let paragraph = paragraph_index
                        .and_then(|index| paragraphs.get_mut(index))
                        .ok_or(EngineError::InvalidRequest)?;
                    let was_mirrored = paragraph.state.pending_text_mirrors_committed;
                    candidate.buffers = CandidateBuffers::ExistingPending {
                        unit_ids_mirror_committed: was_mirrored,
                    };
                    let (pending, committed) = paragraph.state.text.derive_mut();
                    // A valid mirror already contains the accepted text and avoids a full copy.
                    // Clear the fact before any write so errors cannot leave a false mirror.
                    paragraph.state.pending_text_mirrors_committed = false;
                    populate_preflight_text(
                        &mut pending.units,
                        &committed.units,
                        text_mutations,
                        !was_mirrored,
                        0,
                    )?;
                }
                CandidateBuffers::SparePending => {
                    let spare = spare_paragraph
                        .as_mut()
                        .ok_or(EngineError::InvalidRequest)?;
                    let pending = spare.text.pending_mut();
                    pending.units.clear();
                    pending.unit_ids.clear();
                    pending.next_unit_id = 0;
                    spare.pending_text_mirrors_committed = false;
                    spare.unicode.pending_mut().clear();
                    populate_preflight_text(&mut pending.units, &[], text_mutations, false, 0)?;
                }
                CandidateBuffers::Owned => {
                    let committed_text = paragraph_index
                        .and_then(|index| paragraphs.get(index))
                        .map_or(&[][..], |paragraph| {
                            paragraph.state.text.committed().units.as_slice()
                        });
                    candidate.text.clear();
                    let preserved_capacity = paragraph_index
                        .and_then(|index| paragraphs.get(index))
                        .map_or(0, |paragraph| {
                            paragraph
                                .state
                                .text
                                .pending()
                                .units
                                .capacity()
                                .max(paragraph.state.text.committed().units.capacity())
                        })
                        .max(spare_text_capacity);
                    populate_preflight_text(
                        &mut candidate.text,
                        committed_text,
                        text_mutations,
                        true,
                        preserved_capacity,
                    )?;
                }
            }
            let committed_text = paragraph_index
                .and_then(|index| paragraphs.get(index))
                .map_or(&[][..], |paragraph| {
                    paragraph.state.text.committed().units.as_slice()
                });
            let candidate_text = match candidate.buffers {
                CandidateBuffers::ExistingPending { .. } => paragraph_index
                    .and_then(|index| paragraphs.get(index))
                    .ok_or(EngineError::InvalidRequest)?
                    .state
                    .text
                    .pending()
                    .units
                    .as_slice(),
                CandidateBuffers::SparePending => spare_paragraph
                    .as_ref()
                    .ok_or(EngineError::InvalidRequest)?
                    .text
                    .pending()
                    .units
                    .as_slice(),
                CandidateBuffers::Owned => candidate.text.as_slice(),
            };
            candidate.unicode_state = CandidateUnicode::ReuseCommitted;
            let edit_start = preflight_edit_scratch.len();
            let reconciliation = text_reconciliation(text_mutations, committed_text.len());
            if let Some(reconciliation) = reconciliation {
                collect_text_edits(
                    committed_text,
                    candidate_text,
                    reconciliation,
                    preflight_edit_scratch,
                    edit_start,
                )?;
            }
            let edit_end = preflight_edit_scratch.len();
            candidate.edit_start = edit_start;
            candidate.edit_end = edit_end;
            let candidate_edits = &preflight_edit_scratch[edit_start..edit_end];
            let text_changed = if reconciliation.is_some() {
                !candidate_edits.is_empty()
            } else {
                candidate_text != committed_text
            };
            if text_changed {
                let unicode_reusable = paragraph_index
                    .and_then(|index| paragraphs.get(index))
                    .is_some_and(|paragraph| {
                        !paragraph.created
                            && !candidate_edits.is_empty()
                            && candidate_edits.iter().copied().all(|edit| {
                                paragraph
                                    .state
                                    .unicode
                                    .committed()
                                    .reusable_for_ascii_letter_edit(
                                        committed_text,
                                        candidate_text,
                                        edit.old_start,
                                        edit.old_end,
                                        edit.new_end,
                                    )
                            })
                    });
                if unicode_reusable {
                    candidate.unicode_state = CandidateUnicode::ReuseCommitted;
                } else {
                    match candidate.buffers {
                        CandidateBuffers::ExistingPending { .. } => {
                            let state = &mut paragraph_index
                                .and_then(|index| paragraphs.get_mut(index))
                                .ok_or(EngineError::InvalidRequest)?
                                .state;
                            let candidate_text = state.text.pending().units.as_slice();
                            state
                                .unicode
                                .pending_mut()
                                .analyze(candidate_text)
                                .map_err(unicode_error)?;
                        }
                        CandidateBuffers::SparePending => {
                            let spare = spare_paragraph
                                .as_mut()
                                .ok_or(EngineError::InvalidRequest)?;
                            let candidate_text = spare.text.pending().units.as_slice();
                            spare
                                .unicode
                                .pending_mut()
                                .analyze(candidate_text)
                                .map_err(unicode_error)?;
                        }
                        CandidateBuffers::Owned => {
                            let preserved_capacity = paragraph_index
                                .and_then(|index| paragraphs.get(index))
                                .map_or(0, |paragraph| {
                                    paragraph
                                        .state
                                        .text
                                        .pending()
                                        .units
                                        .capacity()
                                        .max(paragraph.state.text.committed().units.capacity())
                                })
                                .max(spare_text_capacity);
                            candidate
                                .unicode
                                .reserve(preserved_capacity)
                                .map_err(unicode_error)?;
                            candidate
                                .unicode
                                .analyze(candidate_text)
                                .map_err(unicode_error)?;
                        }
                    }
                    candidate.unicode_state = CandidateUnicode::Prepared;
                }
            }
            Some(index)
        };
        let grapheme_boundaries = if let Some(index) = candidate_index {
            let candidate = &preflight_text_candidates[index];
            if candidate.unicode_state == CandidateUnicode::Prepared {
                match candidate.buffers {
                    CandidateBuffers::ExistingPending { .. } => paragraph_index
                        .and_then(|index| paragraphs.get(index))
                        .ok_or(EngineError::InvalidRequest)?
                        .state
                        .unicode
                        .pending()
                        .grapheme_boundaries(),
                    CandidateBuffers::SparePending => spare_paragraph
                        .as_ref()
                        .ok_or(EngineError::InvalidRequest)?
                        .unicode
                        .pending()
                        .grapheme_boundaries(),
                    CandidateBuffers::Owned => candidate.unicode.grapheme_boundaries(),
                }
            } else {
                paragraph_index
                    .and_then(|index| paragraphs.get(index))
                    .map_or(&[0][..], |paragraph| {
                        paragraph.state.unicode.committed().grapheme_boundaries()
                    })
            }
        } else {
            paragraph_index
                .and_then(|index| paragraphs.get(index))
                .map_or(&[0][..], |paragraph| {
                    paragraph.state.unicode.committed().grapheme_boundaries()
                })
        };
        let committed_styles = paragraph_index
            .and_then(|index| paragraphs.get(index))
            .map(|paragraph| &paragraph.state.styles.committed().arena);
        let mut scratch = MutationTopologyScratch {
            topology: style_validation_topology_scratch,
            mutations: style_validation_mutation_scratch,
            sort_pairs: style_validation_sort_pair_scratch,
            order: style_validation_order_scratch,
            nesting: style_validation_nesting_scratch,
            sort_pairs_pass: style_validation_sort_pairs_pass,
        };
        StyleArena::validate_mutation_topology(
            committed_styles.unwrap_or(&empty_styles),
            style_mutations,
            grapheme_boundaries,
            &mut scratch,
        )?;
        empty_styles.clear();
        Ok(())
    }

    fn semantic_input_spans(&self, paragraph_id: u32) -> ParagraphInputSpans {
        self.semantic_input_spans
            .binary_search_by_key(&paragraph_id, |spans| spans.id)
            .map(|index| self.semantic_input_spans[index])
            .unwrap_or(ParagraphInputSpans {
                id: paragraph_id,
                ..ParagraphInputSpans::default()
            })
    }

    fn prepare_lifecycle(
        &mut self,
        mutations: super::semantic_wire::ParagraphMutationBatch<'_>,
        order_mutations: super::semantic_wire::ParagraphOrderMutationBatch<'_>,
        implicit_paragraph: Option<u32>,
        max_paragraphs: u32,
        plan: LifecyclePlan,
        spare_text_candidate_id: Option<u32>,
    ) -> Result<(), EngineError> {
        if self.lifecycle_prepared {
            return Err(EngineError::InvalidRequest);
        }
        if mutations.len() == 0 && order_mutations.len() == 0 && implicit_paragraph.is_none() {
            return Ok(());
        }
        let LifecyclePlan {
            creates,
            removals,
            placement_changes,
            ordered,
        } = plan;
        if placement_changes == 0 && removals == 0 {
            return Ok(());
        }
        self.lifecycle_prepared = true;
        self.pending_next_paragraph_incarnation = self.next_paragraph_incarnation.max(1);
        let final_count = self
            .paragraphs
            .len()
            .checked_add(creates)
            .and_then(|count| count.checked_sub(removals))
            .ok_or(EngineError::InvalidRequest)?;
        if final_count > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)? {
            return Err(EngineError::InvalidRequest);
        }
        self.paragraphs
            .try_reserve(creates)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.pending_ordered_paragraphs = ordered;
        if self.pending_ordered_paragraphs.len() != final_count {
            return Err(EngineError::InvalidRequest);
        }
        self.rank_sort_scratch
            .try_reserve(final_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.ranked_paragraphs
            .try_reserve(final_count)
            .map_err(|_| EngineError::ResultTooLarge)?;

        for index in 0..mutations.len() {
            match mutations.get(index).ok_or(EngineError::InvalidRequest)? {
                super::semantic_wire::ParagraphMutation::Upsert {
                    paragraph_id,
                    order,
                } => self.prepare_upsert(paragraph_id, order, false)?,
                super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                    self.paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?
                        .pending_remove = true;
                }
            }
        }
        for index in 0..order_mutations.len() {
            let mutation = order_mutations
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            self.prepare_order(mutation.paragraph_id, mutation.scope, mutation.rank)?;
        }
        if let Some(paragraph_id) = implicit_paragraph
            && self.paragraph(paragraph_id).is_none()
        {
            self.prepare_upsert(
                paragraph_id,
                0,
                spare_text_candidate_id == Some(paragraph_id),
            )?;
        }

        self.ranked_paragraphs.clear();
        for (slot, ordered) in self.pending_ordered_paragraphs.iter().enumerate() {
            let paragraph = self
                .paragraph(ordered.id)
                .ok_or(EngineError::InvalidRequest)?;
            let placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
            if placement.scope == 0 {
                continue;
            }
            self.ranked_paragraphs.push(RankedParagraph {
                scope: placement.scope,
                id: paragraph.id,
                rank: placement.rank,
                slot: u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
            });
        }
        sort::prepare_pairs(&mut self.rank_sort_scratch, self.ranked_paragraphs.len())?;
        for (index, ranked) in self.ranked_paragraphs.iter().enumerate() {
            self.rank_sort_scratch
                .push((sort::f64_key(ranked.rank), index as u32));
        }
        sort::sort_pairs(&mut self.rank_sort_scratch);
        let one_scope = self.ranked_paragraphs.first().is_none_or(|first| {
            self.ranked_paragraphs
                .iter()
                .all(|ranked| ranked.scope == first.scope)
        });
        if one_scope {
            for (destination, &(_, source)) in
                self.ranked_paragraphs.iter().zip(&self.rank_sort_scratch)
            {
                let source = usize::try_from(source).map_err(|_| EngineError::InvalidRequest)?;
                self.pending_ordered_paragraphs[destination.slot as usize].id =
                    self.ranked_paragraphs[source].id;
            }
        } else {
            sort::apply_pair_order(&mut self.ranked_paragraphs, &mut self.rank_sort_scratch);
            sort::prepare_pairs(&mut self.rank_sort_scratch, self.ranked_paragraphs.len())?;
            for (index, ranked) in self.ranked_paragraphs.iter().enumerate() {
                self.rank_sort_scratch
                    .push((u64::from(ranked.scope), index as u32));
            }
            sort::sort_pairs(&mut self.rank_sort_scratch);
            sort::apply_pair_order(&mut self.ranked_paragraphs, &mut self.rank_sort_scratch);
            sort::prepare_pairs(&mut self.order_sort_scratch, self.ranked_paragraphs.len())?;
            for ranked in &self.ranked_paragraphs {
                self.order_sort_scratch
                    .push((sort::pack2(ranked.scope, ranked.slot), ranked.slot));
            }
            sort::sort_pairs(&mut self.order_sort_scratch);
            for (&(_, destination), ranked) in
                self.order_sort_scratch.iter().zip(&self.ranked_paragraphs)
            {
                let destination =
                    usize::try_from(destination).map_err(|_| EngineError::InvalidRequest)?;
                self.pending_ordered_paragraphs[destination].id = ranked.id;
            }
        }
        self.lifecycle_changed = self.pending_ordered_paragraphs != self.ordered_paragraphs;
        Ok(())
    }

    fn prepare_upsert(
        &mut self,
        id: u32,
        order: u32,
        preserve_spare_text_candidate: bool,
    ) -> Result<(), EngineError> {
        match self
            .paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
        {
            Ok(index) => {
                let mut placement = self.paragraphs[index]
                    .pending_placement
                    .unwrap_or(self.paragraphs[index].placement);
                placement.order = order;
                self.paragraphs[index].pending_placement = Some(placement);
                Ok(())
            }
            Err(index) => {
                let incarnation =
                    ParagraphIncarnation::allocate(&mut self.pending_next_paragraph_incarnation)?;
                let state = if let Some(spare) = self.spare_paragraph.take() {
                    let mut spare = spare;
                    if preserve_spare_text_candidate {
                        spare.reset_for_reuse_preserving_text_candidate();
                    } else {
                        spare.reset_for_reuse();
                    }
                    spare
                } else {
                    // Only the reusable spare is prewarmed. New retained paragraphs grow
                    // each arena from their actual content instead of paying planner defaults.
                    ParagraphState::default()
                };
                self.paragraphs.insert(
                    index,
                    RetainedParagraph {
                        id,
                        incarnation,
                        placement: ParagraphPlacement {
                            order,
                            scope: 0,
                            rank: 0.0,
                        },
                        pending_placement: Some(ParagraphPlacement {
                            order,
                            scope: 0,
                            rank: 0.0,
                        }),
                        pending_remove: false,
                        created: true,
                        positioned_changed: false,
                        preparation_changed_since_publication: false,
                        gather_range: None,
                        renderer_order_index: usize::MAX,
                        placement_range: RecordSpan::default(),
                        state,
                    },
                );
                Ok(())
            }
        }
    }

    fn prepare_order(&mut self, id: u32, scope: u32, rank: f64) -> Result<(), EngineError> {
        let paragraph = self.paragraph_mut(id).ok_or(EngineError::InvalidRequest)?;
        let mut placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
        placement.scope = scope;
        placement.rank = rank;
        paragraph.pending_placement = Some(placement);
        Ok(())
    }

    fn active_order(&self) -> &[ParagraphOrder] {
        if self.lifecycle_prepared {
            &self.pending_ordered_paragraphs
        } else {
            &self.ordered_paragraphs
        }
    }

    fn placement_work_id(&self, index: usize, sparse: bool) -> u32 {
        if sparse {
            self.order_sort_scratch[index].1
        } else {
            self.active_order()[index].id
        }
    }

    fn prepare_placement_slots(
        &mut self,
        publication_generation: u32,
        preparation_changed: bool,
        checkpoint: bool,
        next_content_revision: &mut u32,
    ) -> Result<(), EngineError> {
        let mut sparse =
            !checkpoint && self.prepare_retained_order(RetainedOrderPurpose::Placement)?;
        let mut desired = core::mem::take(&mut self.desired_placements);
        let mut rows = core::mem::take(&mut self.session_placement_rows);
        desired.clear();
        rows.clear();
        let result = (|| {
            loop {
                desired.clear();
                let work_count = if sparse {
                    self.order_sort_scratch.len()
                } else {
                    self.active_order().len()
                };
                let required = (0..work_count).try_fold(0usize, |total, index| {
                    let id = self.placement_work_id(index, sparse);
                    let paragraph = self.paragraph(id).ok_or(EngineError::InvalidRequest)?;
                    total
                        .checked_add(
                            paragraph
                                .state
                                .positioned
                                .active()
                                .placement_segments()
                                .len(),
                        )
                        .ok_or(EngineError::ResultTooLarge)
                })?;
                desired
                    .try_reserve(required)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                rows.try_reserve(required)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                for index in 0..work_count {
                    let paragraph = self
                        .paragraph(self.placement_work_id(index, sparse))
                        .ok_or(EngineError::InvalidRequest)?;
                    #[cfg(test)]
                    super::work_attribution::record(|work| work.placement_key_owner_visits += 1);
                    let positioned = paragraph.state.positioned.active();
                    for segment in positioned.placement_segments() {
                        let run_index = usize::try_from(segment.layout_run_index)
                            .map_err(|_| EngineError::InvalidRequest)?;
                        let run_source = match segment.layout_run_owner {
                            LayoutRunOwner::Paragraph => paragraph
                                .state
                                .clusters
                                .active()
                                .layout_runs()
                                .get(run_index),
                            LayoutRunOwner::Replacement => {
                                positioned.replacement_runs().get(run_index)
                            }
                        }
                        .map(|run| run.source_kind)
                        .ok_or(EngineError::InvalidRequest)?;
                        desired.push(placement_logical_key(
                            paragraph.incarnation,
                            *segment,
                            run_source,
                        ));
                    }
                }
                if !sparse {
                    self.placement_slots
                        .prepare(&desired, publication_generation)
                        .map_err(placement_slot_error)?;
                    break;
                }
                let paragraphs = &self.paragraphs;
                let ranges = self.order_sort_scratch.iter().map(|(_, id)| {
                    paragraphs
                        .binary_search_by_key(id, |paragraph| paragraph.id)
                        .ok()
                        .map(|index| paragraphs[index].placement_range)
                        .map(|range| range.start..range.end)
                });
                if self
                    .placement_slots
                    .prepare_retained_subset(&desired, ranges, publication_generation)
                    .map_err(placement_slot_error)?
                {
                    break;
                }
                // Changed logical placement topology uses the same complete reconciliation.
                sparse = false;
            }
            self.pending_placement_ranges_refresh = !sparse;
            let assignments = self
                .placement_slots
                .assignments()
                .map_err(placement_slot_error)?;
            let assignment_count = assignments.len();
            if assignment_count != desired.len() {
                return Err(EngineError::InvalidRequest);
            }
            self.pending_placement_slot_count = self
                .placement_slots
                .required_slots()
                .map_err(placement_slot_error)?;
            let work_count = if sparse {
                self.order_sort_scratch.len()
            } else {
                self.active_order().len()
            };
            let active_order = if self.lifecycle_prepared {
                &self.pending_ordered_paragraphs
            } else {
                &self.ordered_paragraphs
            };
            let paragraphs = &mut self.paragraphs;
            let mut assignment_start = 0usize;
            let work_ids = (0..work_count).map(|index| {
                if sparse {
                    self.order_sort_scratch[index].1
                } else {
                    active_order[index].id
                }
            });
            for id in work_ids {
                let paragraph_index = paragraphs
                    .binary_search_by_key(&id, |paragraph| paragraph.id)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let paragraph = &mut paragraphs[paragraph_index];
                #[cfg(test)]
                super::work_attribution::record(|work| work.placement_binding_owner_visits += 1);
                let segment_count = paragraph
                    .state
                    .positioned
                    .active()
                    .placement_segments()
                    .len();
                let assignment_end = assignment_start
                    .checked_add(segment_count)
                    .ok_or(EngineError::ResultTooLarge)?;
                for relative in 0..segment_count {
                    let translation = paragraph
                        .state
                        .positioned
                        .active()
                        .placement_translations()
                        .get(relative)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?;
                    rows.push(SessionPlacementRow {
                        slot: assignments[assignment_start + relative].slot().get(),
                        inline: translation.translation_inline as f32,
                        block: translation.translation_block as f32,
                    });
                }
                if paragraph.state.positioned.is_prepared() {
                    admit_preparation_owner(
                        &mut self.pending_preparation_ids,
                        &mut self.unpublished_preparation_ids,
                        id,
                    )?;
                    let (pending, committed) = paragraph.state.positioned.derive_mut();
                    pending.bind_placement_handles(
                        &assignments[assignment_start..assignment_end],
                        Some(committed),
                        next_content_revision,
                    )?;
                } else if preparation_changed {
                    let assigned = &assignments[assignment_start..assignment_end];
                    let requires_binding = {
                        let positioned = paragraph.state.positioned.committed();
                        (0..segment_count).any(|relative| {
                            positioned.placement_handle(relative) != Some(assigned[relative])
                        })
                    };
                    if requires_binding {
                        admit_preparation_owner(
                            &mut self.pending_preparation_ids,
                            &mut self.unpublished_preparation_ids,
                            id,
                        )?;
                        let state = &mut paragraph.state;
                        state.positioned.active_mut().bind_placement_handles(
                            assigned,
                            None,
                            next_content_revision,
                        )?;
                        paragraph.positioned_changed = true;
                    } else if paragraph
                        .state
                        .positioned
                        .committed()
                        .placement_instance_count()?
                        != paragraph.state.positioned.committed().glyphs().len()
                    {
                        return Err(EngineError::InvalidRequest);
                    }
                } else {
                    let positioned = paragraph.state.positioned.committed();
                    for relative in 0..segment_count {
                        if positioned.placement_handle(relative)
                            != Some(assignments[assignment_start + relative])
                        {
                            return Err(EngineError::InvalidRequest);
                        }
                    }
                    if positioned.placement_instance_count()? != positioned.glyphs().len() {
                        return Err(EngineError::InvalidRequest);
                    }
                }
                assignment_start = assignment_end;
            }
            if sparse
                && self
                    .plan
                    .requires_complete_placement_rows(self.pending_placement_slot_count, checkpoint)
            {
                rows.clear();
                for entry in active_order {
                    let paragraph_index = paragraphs
                        .binary_search_by_key(&entry.id, |paragraph| paragraph.id)
                        .map_err(|_| EngineError::InvalidRequest)?;
                    let positioned = paragraphs[paragraph_index].state.positioned.active();
                    rows.try_reserve(positioned.placement_segments().len())
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    for (relative, translation) in
                        positioned.placement_translations().iter().enumerate()
                    {
                        let handle = positioned
                            .placement_handle(relative)
                            .ok_or(EngineError::InvalidRequest)?;
                        rows.push(SessionPlacementRow {
                            slot: handle.slot().get(),
                            inline: translation.translation_inline as f32,
                            block: translation.translation_block as f32,
                        });
                    }
                }
            }
            sort_session_placement_rows(&mut rows, &mut self.rank_sort_scratch)?;
            if assignment_start != assignment_count {
                return Err(EngineError::InvalidRequest);
            }
            Ok(())
        })();
        self.desired_placements = desired;
        self.session_placement_rows = rows;
        result
    }

    fn commit_paragraphs(&mut self, publishing: bool) {
        if publishing {
            for id in &self.pending_preparation_ids {
                let Ok(index) = self
                    .paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                else {
                    continue;
                };
                let paragraph = &mut self.paragraphs[index];
                #[cfg(test)]
                super::work_attribution::record(|work| work.publication_commit_visits += 1);
                paragraph.commit_preparation(true);
            }
            for id in &self.unpublished_preparation_ids {
                // The pending frontier settled this owner, including a newer candidate.
                if self.pending_preparation_ids.binary_search(id).is_ok() {
                    continue;
                }
                if let Ok(index) = self
                    .paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                {
                    #[cfg(test)]
                    super::work_attribution::record(|work| work.publication_commit_visits += 1);
                    let paragraph = &mut self.paragraphs[index];
                    if !paragraph.state.has_pending_preparation()
                        && !paragraph.state.clipped_inspection.is_prepared()
                        && !paragraph.positioned_changed
                    {
                        #[cfg(test)]
                        super::work_attribution::record(|work| {
                            work.publication_ack_only_visits += 1
                        });
                        paragraph.acknowledge_committed_preparation();
                    } else {
                        paragraph.commit_preparation(true);
                    }
                }
            }
            self.unpublished_preparation_ids.clear();
        } else {
            // Paragraph IDs survive lifecycle ordering changes. Resolve only the prepared nodes;
            // lifecycle adoption below independently owns creation, removal and ordering.
            for id in &self.pending_preparation_ids {
                if let Ok(index) = self
                    .paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                {
                    let paragraph = &mut self.paragraphs[index];
                    let was_unpublished = paragraph.preparation_changed_since_publication;
                    paragraph.commit_preparation(false);
                    if !was_unpublished && paragraph.preparation_changed_since_publication {
                        // Admission reserved the worst-case union before any pending state changed.
                        self.unpublished_preparation_ids.push(*id);
                    }
                }
            }
        }
        self.pending_preparation_ids.clear();
        if !self.lifecycle_prepared {
            return;
        }
        // A measure-time lifecycle adoption changes renderer order without replacing the
        // gathered workspace. Its old interval endpoints cannot authorize bulk skipping.
        if !publishing && self.lifecycle_changed {
            self.gathered_source_count = None;
            self.placement_ranges_current = false;
        }
        let mut index = 0;
        while index < self.paragraphs.len() {
            if self.paragraphs[index].pending_remove {
                let paragraph = self.paragraphs.remove(index);
                // Measurement may adopt removal before publication. Retire its identity before reuse.
                self.unpublished_preparation_ids
                    .retain(|id| *id != paragraph.id);
                if self.spare_paragraph.is_none() {
                    self.spare_paragraph = Some(paragraph.state);
                }
            } else {
                let paragraph = &mut self.paragraphs[index];
                if let Some(placement) = paragraph.pending_placement.take() {
                    paragraph.placement = placement;
                }
                paragraph.created = false;
                index += 1;
            }
        }
        core::mem::swap(
            &mut self.ordered_paragraphs,
            &mut self.pending_ordered_paragraphs,
        );
        for index in 0..self.ordered_paragraphs.len() {
            let id = self.ordered_paragraphs[index].id;
            if let Some(paragraph) = self.paragraph_mut(id) {
                paragraph.renderer_order_index = index;
            }
        }
        self.next_paragraph_incarnation = self.pending_next_paragraph_incarnation;
        self.pending_next_paragraph_incarnation = 0;
        self.pending_ordered_paragraphs.clear();
        self.rank_sort_scratch.clear();
        self.ranked_paragraphs.clear();
        self.lifecycle_prepared = false;
        self.lifecycle_changed = false;
    }
}

/// Stage ownership once, reserving publication-frontier growth before semantic mutation.
/// Measurement commits append at most one unpublished identity per staged owner and never allocate.
fn admit_preparation_owner(
    staged: &mut Vec<u32>,
    unpublished: &mut Vec<u32>,
    id: u32,
) -> Result<(), EngineError> {
    let Err(index) = staged.binary_search(&id) else {
        return Ok(());
    };
    let additional = staged
        .len()
        .checked_add(1)
        .ok_or(EngineError::ResultTooLarge)?;
    unpublished
        .try_reserve(additional)
        .map_err(|_| EngineError::ResultTooLarge)?;
    staged
        .try_reserve(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    staged.insert(index, id);
    Ok(())
}

impl RetainedParagraph {
    fn acknowledge_committed_preparation(&mut self) {
        if self.preparation_changed_since_publication {
            self.state.positioned.active_mut().mark_published();
            self.preparation_changed_since_publication = false;
        }
    }

    fn commit_preparation(&mut self, publishing: bool) {
        let published_changes =
            publishing && (self.positioned_changed || self.preparation_changed_since_publication);
        if publishing {
            self.preparation_changed_since_publication = false;
        } else if self.positioned_changed || self.state.has_pending_preparation() {
            self.preparation_changed_since_publication = true;
        }
        self.state.commit_all();
        if published_changes {
            self.state.positioned.active_mut().mark_published();
        }
        self.positioned_changed = false;
    }
}

impl ParagraphState {
    fn has_pending_preparation(&self) -> bool {
        self.text.is_prepared()
            || self.styles.is_prepared()
            || self.unicode.is_prepared()
            || self.bidi.is_prepared()
            || self.shaping_runs.is_prepared()
            || self.shape.is_prepared()
            || self.clusters.is_prepared()
            || self.geometry.is_prepared()
            || self.flow_layout.is_prepared()
            || self.positioned.is_prepared()
    }

    /// Clears paragraph identity and committed/pending semantics while retaining every allocation.
    #[inline(never)]
    fn reset_for_reuse(&mut self) {
        self.reset_for_reuse_inner(false);
    }

    fn reset_for_reuse_preserving_text_candidate(&mut self) {
        self.reset_for_reuse_inner(true);
    }

    fn reset_for_reuse_inner(&mut self, preserve_text_candidate: bool) {
        self.intrinsic_widths_cache = None;
        {
            let (committed, pending) = self.text.pair_mut();
            committed.units.clear();
            committed.unit_ids.clear();
            if !preserve_text_candidate {
                pending.units.clear();
            }
            pending.unit_ids.clear();
        }
        self.pending_text_mirrors_committed = !preserve_text_candidate;
        {
            let (committed, pending) = self.text.pair_mut();
            committed.next_unit_id = 0;
            pending.next_unit_id = 0;
        }
        self.text.discard_candidate();
        self.text_edits.clear();
        {
            let (committed, pending) = self.styles.pair_mut();
            committed.arena.clear();
            committed.resolved.clear();
            pending.arena.clear();
            pending.resolved.clear();
        }
        self.styles.discard_candidate();
        {
            let (committed, pending) = self.unicode.pair_mut();
            committed.clear();
            if !preserve_text_candidate {
                pending.clear();
            }
        }
        self.unicode.discard_candidate();
        self.unicode_reused_for_text_edit = false;
        {
            let (committed, pending) = self.bidi.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.bidi.discard_candidate();
        {
            let (committed, pending) = self.shaping_runs.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shaping_runs.discard_candidate();
        {
            let (committed, pending) = self.shape.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shape.discard_candidate();
        self.shape_window_scratch.clear();
        self.incremental_shape_source_run = None;
        {
            let (committed, pending) = self.clusters.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.clusters.discard_candidate();
        self.layout_dirty.clear();
        self.next_run_canonical_revision = 0;
        self.pending_source_run_canonical_revision = 0;
        self.pending_next_run_canonical_revision = 0;
        {
            let (committed, pending) = self.geometry.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.geometry.discard_candidate();
        {
            let (committed, pending) = self.flow_layout.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.flow_layout.discard_candidate();
        self.intrinsic_geometry_scratch.clear();
        self.intrinsic_flow_layout_scratch.clear();
        {
            let (committed, pending) = self.clipped_inspection.pair_mut();
            committed.mode = IntrinsicInspection::None;
            committed.positioned.clear();
            pending.mode = IntrinsicInspection::None;
            pending.positioned.clear();
        }
        self.clipped_inspection.discard_candidate();
        self.intrinsic_boundary_shape.clear();
        self.boundary_shape.clear();
        self.pending_boundary_shape.clear();
        self.boundary_shape_scratch.clear();
        self.ellipsis_shape_scratch.clear();
        self.ellipsis_text_scratch.clear();
        {
            let (committed, pending) = self.positioned.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.positioned.discard_candidate();
        self.fallback_spans.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.style_invalidation = StyleInvalidation::default();
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        text_mutations: super::semantic_wire::TextMutationBatch<'_>,
        style_mutations: super::semantic_wire::StyleMutationBatch<'_>,
        geometry: super::semantic_wire::GeometryBatch<'_>,
        limits: super::frame::UpdateLimits,
        next_glyph_id: &mut u32,
        next_content_revision: &mut u32,
        mut preflight_candidate: Option<&mut PreflightTextCandidate>,
        preflight_edits: &[TextEdit],
    ) -> Result<bool, EngineError> {
        #[cfg(test)]
        {
            self.preparation_count += 1;
        }
        self.prepare_text(
            text_mutations,
            preflight_candidate.as_deref_mut(),
            preflight_edits,
        )?;
        self.prepare_unicode(preflight_candidate)?;
        self.prepare_styles(style_mutations, |handle| {
            font_stacks
                .binary_search_by_key(&handle, |stack| stack.handle)
                .is_ok()
        })?;
        self.prepare_bidi()?;
        self.prepare_shaping_runs()?;
        let mut cluster_geometry_changed = self.clusters.is_prepared();
        if let Some(shaper) = shaper.as_deref_mut() {
            self.prepare_shape(shaper, font_stacks, font_bindings)?;
            cluster_geometry_changed = self.prepare_clusters(shaper, next_glyph_id)?;
        }
        let positioned_changed = self.prepare_geometry_and_layout(
            shaper,
            font_stacks,
            font_bindings,
            geometry,
            limits,
            next_glyph_id,
            next_content_revision,
            cluster_geometry_changed,
        )?;
        if cluster_geometry_changed {
            self.intrinsic_widths_cache = None;
        }
        Ok(positioned_changed)
    }

    /// Prepares geometry, flow and positioning after the shared semantic prefix.
    #[allow(clippy::too_many_arguments)]
    fn prepare_geometry_and_layout(
        &mut self,
        shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        geometry: super::semantic_wire::GeometryBatch<'_>,
        limits: super::frame::UpdateLimits,
        next_glyph_id: &mut u32,
        next_content_revision: &mut u32,
        cluster_geometry_changed: bool,
    ) -> Result<bool, EngineError> {
        self.prepare_geometry(geometry)?;
        let flow_changed = cluster_geometry_changed
            || self.geometry.is_prepared()
            || self.style_invalidation.metrics;
        let positioned_changed = flow_changed || self.style_invalidation.positioning;
        // Reverting to accepted geometry must also revert the derived layout tail;
        // otherwise it would publish flow and positioning prepared for the prior width.
        if !flow_changed && (self.flow_layout.is_prepared() || self.positioned.is_prepared()) {
            self.discard_flow_layout_candidate();
            self.discard_positioned_candidate();
        }
        if let Some(shaper) = shaper {
            if flow_changed {
                self.prepare_flow_layout(
                    shaper,
                    font_stacks,
                    font_bindings,
                    limits.max_lines,
                    limits.max_slots_per_band,
                    next_glyph_id,
                )?;
                // Geometry-only resize equivalence: a third of alternating-width
                // resizes compose the exact lines the committed flow already
                // holds and would position bit-identically — the fit is cheap
                // and chunk-skipped, so proving input-equality here retires the
                // positioning, gather, diff, and publication tail for those
                // frames entirely (the resize analogue of the D-253 measure
                // adoption). The pending geometry still commits: it is real
                // planner state, and the equivalence proof is exactly the
                // statement that the retained flow and positioning answer it.
                if !self.clusters.is_prepared()
                    && !self.text.is_prepared()
                    && !self.styles.is_prepared()
                    && !self.unicode.is_prepared()
                    && !self.bidi.is_prepared()
                    && !self.shape.is_prepared()
                    && !self.shaping_runs.is_prepared()
                    && !self.style_invalidation.metrics
                    && !self.style_invalidation.positioning
                    && super::positioning::flow_positioning_equivalent(
                        self.flow_layout.pending(),
                        self.flow_layout.committed(),
                        self.clusters.committed(),
                        self.bidi.committed(),
                        |thread| thread_typography(self.geometry.pending(), thread),
                        |thread| thread_typography(self.geometry.committed(), thread),
                    )?
                {
                    self.discard_flow_layout_candidate();
                    self.discard_positioned_candidate();
                    return Ok(false);
                }
            }
            if positioned_changed {
                self.prepare_positioned(shaper, next_content_revision)?;
            }
        }
        Ok(positioned_changed)
    }

    fn commit_all(&mut self) {
        self.commit_text();
        self.commit_styles();
        self.commit_unicode();
        self.commit_bidi();
        self.commit_shaping_runs();
        self.commit_shape();
        self.commit_clusters();
        self.commit_geometry();
        self.commit_flow_layout();
        self.commit_positioned();
        self.clipped_inspection.commit();
    }

    fn initialize(&mut self) -> Result<(), EngineError> {
        {
            let (committed, pending) = self.styles.pair_mut();
            committed.arena.reserve_default()?;
            committed.resolved.reserve_default()?;
            pending.arena.reserve_default()?;
            pending.resolved.reserve_default()?;
        }
        reserve_vec(&mut self.style_mutation_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_order_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_sort_pair_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_nesting_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_resolution_scratch, DEFAULT_STYLE_CAPACITY)
    }

    fn reserve_text(&mut self, capacity: usize) -> Result<(), EngineError> {
        {
            let (committed, pending) = self.text.pair_mut();
            reserve_text_buffer(&mut committed.units, capacity)?;
            reserve_text_buffer(&mut pending.units, capacity)?;
            reserve_vec(&mut committed.unit_ids, capacity)?;
            reserve_vec(&mut pending.unit_ids, capacity)?;
        }
        {
            let (committed, pending) = self.unicode.pair_mut();
            committed.reserve(capacity).map_err(unicode_error)?;
            pending.reserve(capacity).map_err(unicode_error)?;
        }
        {
            let (committed, pending) = self.bidi.pair_mut();
            committed.reserve(capacity).map_err(bidi_error)?;
            pending.reserve(capacity).map_err(bidi_error)?;
        }
        {
            let (committed, pending) = self.shaping_runs.pair_mut();
            committed.reserve(capacity)?;
            pending.reserve(capacity)?;
        }
        let glyph_capacity = capacity.saturating_mul(2);
        {
            let (committed, pending) = self.shape.pair_mut();
            committed.reserve(glyph_capacity)?;
            pending.reserve(glyph_capacity)?;
        }
        {
            let (committed, pending) = self.clusters.pair_mut();
            committed.reserve(capacity)?;
            pending.reserve(capacity)?;
        }
        self.layout_run_identity_index
            .prepare(capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        {
            let (committed, pending) = self.flow_layout.pair_mut();
            committed.reserve(capacity, capacity)?;
            pending.reserve(capacity, capacity)?;
        }
        self.intrinsic_flow_layout_scratch
            .reserve(capacity, capacity)?;
        self.boundary_shape.reserve(capacity.min(64))?;
        self.pending_boundary_shape.reserve(capacity.min(64))?;
        self.boundary_shape_scratch.reserve(glyph_capacity)?;
        self.ellipsis_shape_scratch.reserve(4)?;
        if self.ellipsis_text_scratch.capacity() == 0 {
            self.ellipsis_text_scratch
                .try_reserve_exact(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
        }
        {
            let (committed, pending) = self.positioned.pair_mut();
            committed.reserve(glyph_capacity)?;
            pending.reserve(glyph_capacity)?;
        }
        self.glyph_identity_index
            .prepare(glyph_capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        reserve_vec(&mut self.fallback_spans, capacity)?;
        reserve_vec(&mut self.pending_fallback_spans, capacity)?;
        reserve_vec(&mut self.fallback_span_scratch, capacity)?;
        reserve_vec(&mut self.fallback_cluster_scratch, glyph_capacity)?;
        reserve_vec(&mut self.sort_pair_scratch, glyph_capacity)
    }

    #[inline(never)]
    fn prepare_text(
        &mut self,
        mutations: super::semantic_wire::TextMutationBatch<'_>,
        preflight_candidate: Option<&mut PreflightTextCandidate>,
        preflight_edits: &[TextEdit],
    ) -> Result<(), EngineError> {
        // Preflight may have filled the inactive text buffer, but it has not marked that
        // stage prepared. This is where stable unit identities join the validated text.
        let unit_ids_mirrored = preflight_candidate
            .as_ref()
            .is_some_and(|candidate| candidate.pending_unit_ids_are_mirrored());
        self.discard_text_candidate();
        if mutations.len() == 0 {
            return Ok(());
        }
        let Some(preflight_candidate) = preflight_candidate else {
            return Err(EngineError::InvalidRequest);
        };
        let (pending, committed) = self.text.derive_mut();
        if !unit_ids_mirrored {
            pending
                .unit_ids
                .try_reserve(committed.unit_ids.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            pending.unit_ids.clear();
            pending.unit_ids.extend_from_slice(&committed.unit_ids);
        }
        if preflight_candidate.buffers == CandidateBuffers::Owned {
            core::mem::swap(&mut pending.units, &mut preflight_candidate.text);
        }
        self.pending_text_mirrors_committed = false;
        let seed_next_unit_id = self.text.committed().next_unit_id.max(1);
        self.text.pending_mut().next_unit_id = seed_next_unit_id;
        self.text.mark_prepared();
        let reconciliation = text_reconciliation(mutations, self.text.committed().units.len());
        self.text_edits.clear();
        for index in 0..mutations.len() {
            let Some(mutation) = mutations.get(index) else {
                self.discard_text_candidate();
                return Err(EngineError::InvalidRequest);
            };
            #[cfg(test)]
            {
                self.text_mutation_apply_count += 1;
            }
            if reconciliation.is_none() {
                let TextStage {
                    unit_ids: pending_unit_ids,
                    next_unit_id: pending_next_unit_id,
                    ..
                } = self.text.pending_mut();
                if let Err(error) =
                    apply_text_identity_mutation(pending_unit_ids, pending_next_unit_id, mutation)
                {
                    self.discard_text_candidate();
                    return Err(error);
                }
            }
        }
        let reconciliation_result = (|| {
            if reconciliation.is_some() {
                copy_preflight_text_edits(
                    &mut self.text_edits,
                    preflight_edits,
                    preflight_candidate.edit_start,
                    preflight_candidate.edit_end,
                )?;
            }
            let text_edits = &mut self.text_edits;
            let (pending, committed) = self.text.derive_mut();
            if reconciliation.is_none()
                && let Some(edit) = changed_identity_range(&committed.unit_ids, &pending.unit_ids)
            {
                text_edits
                    .try_reserve(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                text_edits.push(edit);
            }
            reconcile_text_identities(committed, pending, text_edits, reconciliation)
        })();
        if let Err(error) = reconciliation_result {
            self.discard_text_candidate();
            return Err(error);
        }
        if reconciliation.is_some() && self.text_edits.is_empty() {
            self.discard_text_candidate();
        }
        Ok(())
    }

    fn discard_text_candidate(&mut self) {
        if self.text.is_prepared() {
            // The pending candidate is disposable; the committed buffer remains the source for
            // the next edit, which seeds the reusable destination only when it is needed.
            self.pending_text_mirrors_committed = false;
        }
        self.clear_text_preparation();
    }

    fn clear_text_preparation(&mut self) {
        self.text.pending_mut().next_unit_id = 0;
        self.text.discard_candidate();
        self.text_edits.clear();
    }

    #[inline(never)]
    fn prepare_styles(
        &mut self,
        mutations: super::semantic_wire::StyleMutationBatch<'_>,
        font_stack_exists: impl FnMut(u32) -> bool,
    ) -> Result<(), EngineError> {
        self.discard_style_candidate();
        if mutations.len() == 0 {
            if !self.text.is_prepared() || self.styles.committed().arena.len() == 0 {
                return Ok(());
            }
            let grapheme_boundaries = self.unicode.active().grapheme_boundaries();
            if !self
                .styles
                .committed()
                .arena
                .needs_range_realign(grapheme_boundaries)
            {
                // Planner preflight validated retained ranges and features against this text; rooted
                // font stacks remain registered while committed planner state references them.
                return Ok(());
            }
        }
        {
            let (pending_styles, committed_styles) = self.styles.derive_mut();
            pending_styles.arena.prepare_from(
                &committed_styles.arena,
                mutations,
                self.unicode.active().grapheme_boundaries(),
                &mut self.style_mutation_scratch,
                &mut self.sort_pair_scratch,
            )?;
        }
        if self.styles.committed().arena.len() != 0 && self.styles.pending().arena.len() == 0 {
            self.discard_style_candidate();
            return Err(EngineError::InvalidRequest);
        }
        let text = self.text.active().units.as_slice();
        if let Err(error) = self.styles.pending_mut().arena.validate(
            text,
            font_stack_exists,
            &mut self.style_order_scratch,
            &mut self.style_nesting_scratch,
            &mut self.sort_pair_scratch,
            &mut self.style_sort_pair_scratch,
        ) {
            self.discard_style_candidate();
            return Err(error);
        }
        let StyleStage {
            arena: pending_arena,
            resolved: pending_resolved,
        } = self.styles.pending_mut();
        if let Err(error) = pending_arena.resolve(
            &self.style_order_scratch,
            pending_resolved,
            &mut self.style_resolution_scratch,
        ) {
            self.discard_style_candidate();
            return Err(error);
        }
        let (pending_styles, committed_styles) = self.styles.derive_mut();
        self.style_invalidation = committed_styles.resolved.invalidation_against(
            &committed_styles.arena,
            &pending_styles.resolved,
            &pending_styles.arena,
        );
        self.styles.mark_prepared();
        Ok(())
    }

    fn discard_style_candidate(&mut self) {
        self.styles.pending_mut().arena.clear();
        self.styles.pending_mut().resolved.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles.discard_candidate();
        self.style_invalidation = StyleInvalidation::default();
    }

    fn commit_styles(&mut self) {
        // One swap publishes both buffers, because they are one stage.
        self.styles.commit();
        self.discard_style_candidate();
    }

    fn commit_text(&mut self) {
        if self.text.is_prepared() {
            let retains_mirror = self.text.pending().units.len()
                == self.text.committed().units.len()
                && self
                    .text_edits
                    .iter()
                    .copied()
                    .all(TextEdit::is_same_length);
            // One swap publishes units, identities, and the counter together. The
            // counter swaps rather than being assigned, which the original did by hand;
            // the difference is erased because `clear_text_preparation` zeroes the
            // pending counter immediately below.
            self.text.commit();
            if retains_mirror {
                let (pending, committed) = self.text.derive_mut();
                for edit in &self.text_edits {
                    pending.units[edit.new_start..edit.new_end]
                        .copy_from_slice(&committed.units[edit.new_start..edit.new_end]);
                    pending.unit_ids[edit.new_start..edit.new_end]
                        .copy_from_slice(&committed.unit_ids[edit.new_start..edit.new_end]);
                }
                self.pending_text_mirrors_committed = true;
            } else {
                self.text.pending_mut().units.clear();
                self.text.pending_mut().unit_ids.clear();
                self.pending_text_mirrors_committed = false;
            }
        }
        self.clear_text_preparation();
    }

    fn prepare_unicode(
        &mut self,
        preflight_candidate: Option<&mut PreflightTextCandidate>,
    ) -> Result<(), EngineError> {
        self.discard_unicode_candidate();
        if !self.text.is_prepared() {
            return Ok(());
        }
        let Some(preflight_candidate) = preflight_candidate else {
            return Err(EngineError::InvalidRequest);
        };
        if preflight_candidate.unicode_state == CandidateUnicode::ReuseCommitted {
            self.unicode_reused_for_text_edit = true;
            return Ok(());
        }
        if preflight_candidate.uses_pending_buffers() {
            // The preflight analysis already occupies the inactive buffer. It remains
            // invisible until this point, after every caller-authored input has passed.
        } else {
            core::mem::swap(self.unicode.pending_mut(), &mut preflight_candidate.unicode);
        }
        self.unicode.mark_prepared();
        Ok(())
    }

    fn discard_unicode_candidate(&mut self) {
        self.unicode.discard_candidate();
        self.unicode_reused_for_text_edit = false;
    }

    fn commit_unicode(&mut self) {
        if self.unicode.is_prepared() {
            self.unicode.commit();
        }
        self.discard_unicode_candidate();
    }

    fn prepare_bidi(&mut self) -> Result<(), EngineError> {
        self.discard_bidi_candidate();
        if self.unicode_reused_for_text_edit && !self.style_invalidation.bidi {
            return Ok(());
        }
        if !self.text.is_prepared() && !self.style_invalidation.bidi {
            return Ok(());
        }
        let text = self.text.active().units.as_slice();
        let styles = if self.styles.is_prepared() {
            &self.styles.pending_mut().resolved
        } else {
            &self.styles.committed().resolved
        };
        let direction = styles
            .segments()
            .first()
            .map_or(DIRECTION_AUTO, |segment| segment.style.direction);
        analyze_bidi_into(text, direction, self.bidi.pending_mut()).map_err(bidi_error)?;
        self.bidi.mark_prepared();
        Ok(())
    }

    fn discard_bidi_candidate(&mut self) {
        self.bidi.discard_candidate();
    }

    fn commit_bidi(&mut self) {
        if self.bidi.is_prepared() {
            self.bidi.commit();
        }
        self.discard_bidi_candidate();
    }

    fn prepare_shaping_runs(&mut self) -> Result<(), EngineError> {
        self.discard_shaping_runs_candidate();
        // The Unicode reuse certificate changes only equal-length ASCII letters, so it
        // preserves script ranges and every hard-break position consumed by the run builder.
        if (!self.text.is_prepared() || self.unicode_reused_for_text_edit)
            && !self.style_invalidation.shaping
            && !self.style_invalidation.metrics
            && !self.bidi.is_prepared()
            && !self.styles.is_prepared()
        {
            return Ok(());
        }
        let text = self.text.active().units.as_slice();
        let styles = self.styles.active().resolved.segments();
        let style_storage = &self.styles.active().arena;
        let unicode = self.unicode.active();
        let bidi = self.bidi.active();
        self.shaping_runs
            .pending_mut()
            .build(text, styles, style_storage, unicode, bidi)?;
        self.shaping_runs.mark_prepared();
        Ok(())
    }

    fn discard_shaping_runs_candidate(&mut self) {
        self.shaping_runs.pending_mut().clear();
        self.shaping_runs.discard_candidate();
    }

    fn commit_shaping_runs(&mut self) {
        if self.shaping_runs.is_prepared() {
            self.shaping_runs.commit();
        }
        self.discard_shaping_runs_candidate();
    }

    #[inline(never)]
    fn prepare_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
    ) -> Result<(), EngineError> {
        self.discard_shape_candidate();
        // Metric-only styles must refresh the retained run values consumed by cluster aggregation, but the underlying
        // HarfRust result remains valid. Keeping those two invalidations distinct avoids reshaping on size, tracking,
        // word-spacing, line-height, or baseline changes while still rebuilding advances from the new run styles.
        // One exception: a metric change can MERGE adjacent runs whose layout styles became identical, and the
        // retained shaped runs then index a run list that no longer exists — the shape must re-run whenever the
        // rebuilt run list breaks positional topology with the committed one.
        if !self.text.is_prepared()
            && !self.style_invalidation.shaping
            && !self.bidi.is_prepared()
            && (!self.shaping_runs.is_prepared()
                || shaping_run_topology_stable(
                    self.shaping_runs.committed().runs(),
                    self.shaping_runs.pending().runs(),
                ))
        {
            return Ok(());
        }
        if self.try_prepare_incremental_shape(shaper)? {
            self.shape.mark_prepared();
            return Ok(());
        }
        let text = self.text.active().units.as_slice();
        if text.is_empty() {
            self.shape.mark_prepared();
            return Ok(());
        }
        let styles = &self.styles.active().arena;
        let runs = self.shaping_runs.active().runs();
        let mut max_stack_depth = 0usize;
        for (index, run) in runs.iter().copied().enumerate() {
            let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
            let binding_handle = *stack.fonts.first().ok_or(EngineError::FontStackMissing)?;
            let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
            max_stack_depth = max_stack_depth.max(stack.fonts.len());
            push_fallback_span(
                &mut self.pending_fallback_spans,
                FallbackSpan {
                    source_run: u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
                    text_start: run.text_start,
                    text_end: run.text_end,
                    font_index: 0,
                    binding_handle,
                    font_handle,
                },
            )?;
        }
        for _ in 0..max_stack_depth.max(1) {
            self.shape.pending_mut().clear();
            for span in self.pending_fallback_spans.iter().copied() {
                let source_index =
                    usize::try_from(span.source_run).map_err(|_| EngineError::InvalidRequest)?;
                let run = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
                let output = self.shape.pending_mut();
                shaper
                    .with_shaped_run(
                        span.font_handle,
                        text,
                        ShapeRunRef {
                            text_start: span.text_start,
                            text_end: span.text_end,
                            script: run.script,
                            language: styles.resolved_language(run.style),
                            features: styles.resolved_features(run.style),
                            direction: run.direction,
                            cluster_level: 0,
                            flags: 0x40,
                        },
                        |shaped| {
                            output.append(
                                source_index,
                                span.font_handle,
                                span.binding_handle,
                                span.text_start,
                                span.text_end,
                                shaped,
                            )
                        },
                    )
                    .map_err(shaper_error)?;
            }
            collect_cluster_records(
                self.shape.pending_mut(),
                &mut self.fallback_cluster_scratch,
                &mut self.sort_pair_scratch,
            )?;
            self.fallback_span_scratch.clear();
            let mut changed = false;
            let mut cluster_index = 0usize;
            for span in self.pending_fallback_spans.iter().copied() {
                while self
                    .fallback_cluster_scratch
                    .get(cluster_index)
                    .is_some_and(|record| {
                        record.source_run < span.source_run
                            || (record.source_run == span.source_run
                                && record.cluster < span.text_start)
                    })
                {
                    cluster_index += 1;
                }
                let stack_handle = runs
                    .get(span.source_run as usize)
                    .ok_or(EngineError::InvalidRequest)?
                    .style
                    .font_stack_handle;
                let stack = find_font_stack(font_stacks, stack_handle)?;
                let next_font_index = span.font_index.checked_add(1);
                let next_binding =
                    next_font_index.and_then(|index| stack.fonts.get(usize::from(index)).copied());
                let mut cursor = span.text_start;
                let mut record_index = cluster_index;
                while let Some(record) = self.fallback_cluster_scratch.get(record_index).copied() {
                    if record.source_run != span.source_run || record.cluster >= span.text_end {
                        break;
                    }
                    if record.missing
                        && let (Some(font_index), Some(binding_handle)) =
                            (next_font_index, next_binding)
                    {
                        let font_handle =
                            find_font_binding(font_bindings, binding_handle)?.shaping_handle;
                        let cluster_start = record.cluster.max(cursor);
                        let cluster_end = self
                            .fallback_cluster_scratch
                            .get(record_index + 1)
                            .filter(|next| next.source_run == span.source_run)
                            .map_or_else(
                                || {
                                    runs.get(span.source_run as usize)
                                        .map_or(span.text_end, |run| run.text_end)
                                },
                                |next| next.cluster,
                            )
                            .min(span.text_end);
                        if cursor < cluster_start {
                            push_fallback_span(
                                &mut self.fallback_span_scratch,
                                FallbackSpan {
                                    text_start: cursor,
                                    text_end: cluster_start,
                                    ..span
                                },
                            )?;
                        }
                        if cluster_start < cluster_end {
                            push_fallback_span(
                                &mut self.fallback_span_scratch,
                                FallbackSpan {
                                    text_start: cluster_start,
                                    text_end: cluster_end,
                                    font_index,
                                    binding_handle,
                                    font_handle,
                                    ..span
                                },
                            )?;
                            cursor = cluster_end;
                            changed = true;
                        }
                    }
                    record_index += 1;
                }
                if cursor < span.text_end || span.text_start == span.text_end {
                    push_fallback_span(
                        &mut self.fallback_span_scratch,
                        FallbackSpan {
                            text_start: cursor,
                            ..span
                        },
                    )?;
                }
            }
            if !changed {
                self.shape.mark_prepared();
                return Ok(());
            }
            core::mem::swap(
                &mut self.pending_fallback_spans,
                &mut self.fallback_span_scratch,
            );
        }
        Err(EngineError::InvalidRequest)
    }

    fn try_prepare_incremental_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
    ) -> Result<bool, EngineError> {
        let Some(edit) = bounding_text_edit(&self.text_edits) else {
            return Ok(false);
        };
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.active().runs();
        if old_runs.len() != new_runs.len() || old_runs.is_empty() {
            return Ok(false);
        }
        let Some(old_run_index) = containing_run(old_runs, edit.old_start, edit.old_end) else {
            return Ok(false);
        };
        let Some(new_run_index) = containing_run(new_runs, edit.old_start, edit.new_end) else {
            return Ok(false);
        };
        if old_run_index != new_run_index
            || !same_edit_run_topology(
                old_runs,
                new_runs,
                edit,
                old_run_index,
                self.style_invalidation
                    .shaping
                    .then_some((&self.styles.committed().arena, &self.styles.active().arena)),
            )?
        {
            return Ok(false);
        }
        let old_run = old_runs[old_run_index];
        let new_run = new_runs[new_run_index];
        let affected_source_run =
            u32::try_from(old_run_index).map_err(|_| EngineError::ResultTooLarge)?;
        let mut affected_fallbacks = self
            .fallback_spans
            .iter()
            .copied()
            .filter(|span| span.source_run == affected_source_run);
        let Some(fallback) = affected_fallbacks.next() else {
            return Ok(false);
        };
        if affected_fallbacks.next().is_some()
            || fallback.font_index != 0
            || fallback.text_start != old_run.text_start
            || fallback.text_end != old_run.text_end
        {
            return Ok(false);
        }
        let mut affected_shapes = self
            .shape
            .committed()
            .runs
            .iter()
            .copied()
            .enumerate()
            .filter(|(_, run)| run.source_run == affected_source_run);
        let Some((affected_shape_index, affected_shape)) = affected_shapes.next() else {
            return Ok(false);
        };
        if affected_shapes.next().is_some() {
            return Ok(false);
        }
        let sparse_scope = build_sparse_shape_windows(
            &self.text_edits,
            self.shape.committed(),
            affected_shape,
            old_run,
            &mut self.shape_window_scratch,
        )?;
        if !sparse_scope {
            set_whole_shape_window(
                &mut self.shape_window_scratch,
                affected_shape,
                old_run,
                new_run,
            )?;
        }
        let mut verify_boundaries = sparse_scope;
        loop {
            match self.prepare_incremental_shape_scope(
                shaper,
                old_run_index,
                old_run,
                new_run,
                affected_shape_index,
                affected_shape,
                fallback,
                verify_boundaries,
            )? {
                ShapeAttempt::Prepared => break,
                ShapeAttempt::RetryWholeRun if verify_boundaries => {
                    set_whole_shape_window(
                        &mut self.shape_window_scratch,
                        affected_shape,
                        old_run,
                        new_run,
                    )?;
                    verify_boundaries = false;
                }
                ShapeAttempt::RetryWholeRun | ShapeAttempt::NeedsFallback => return Ok(false),
            }
        }
        for span in self.fallback_spans.iter().copied() {
            let (text_start, text_end) = if span.source_run == affected_source_run {
                (new_run.text_start, new_run.text_end)
            } else {
                (
                    map_old_offset(span.text_start, edit)?,
                    map_old_offset(span.text_end, edit)?,
                )
            };
            self.pending_fallback_spans.push(FallbackSpan {
                text_start,
                text_end,
                ..span
            });
        }
        self.boundary_shape_scratch.clear();
        self.incremental_shape_source_run = Some(affected_source_run);
        Ok(true)
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_incremental_shape_scope(
        &mut self,
        shaper: &mut ShaperRegistry,
        source_run_index: usize,
        old_run: ShapingRun,
        new_run: ShapingRun,
        affected_shape_index: usize,
        affected_shape: ShapedRun,
        fallback: FallbackSpan,
        verify_boundaries: bool,
    ) -> Result<ShapeAttempt, EngineError> {
        self.shape.pending_mut().clear();
        let source_run =
            u32::try_from(source_run_index).map_err(|_| EngineError::ResultTooLarge)?;
        let run_count = self.shape.committed().runs.len();
        let delta = i64::from(new_run.text_end) - i64::from(old_run.text_end);
        for shape_index in 0..run_count {
            let shaped_run = *self
                .shape
                .committed()
                .runs
                .get(shape_index)
                .ok_or(EngineError::InvalidRequest)?;
            if shape_index != affected_shape_index {
                let run_delta = if shaped_run.text_start >= old_run.text_end {
                    delta
                } else {
                    0
                };
                let (pending, committed) = self.shape.derive_mut();
                pending.append_text_range_from(
                    committed,
                    shape_index,
                    shaped_run.source_run,
                    shaped_run.text_start,
                    shaped_run.text_end,
                    run_delta,
                )?;
                continue;
            }
            let rtl = old_run.direction == 1;
            let (run_glyph_start, run_glyph_end) =
                shaped_run_glyph_range(self.shape.committed(), affected_shape)?;
            let appended_run_start = self.shape.pending().runs.len();
            let mut cursor_text = if rtl {
                old_run.text_end
            } else {
                old_run.text_start
            };
            let mut cursor_glyph = run_glyph_start;
            for ordinal in 0..self.shape_window_scratch.len() {
                let window_index = if rtl {
                    self.shape_window_scratch.len() - ordinal - 1
                } else {
                    ordinal
                };
                let window = self.shape_window_scratch[window_index];
                let (retained_start, retained_end, retained_glyph_end) = if rtl {
                    (window.old_end, cursor_text, window.old_glyph_start)
                } else {
                    (cursor_text, window.old_start, window.old_glyph_start)
                };
                if retained_start < retained_end {
                    let (pending, committed) = self.shape.derive_mut();
                    pending.append_glyph_range_from(
                        committed,
                        affected_shape_index,
                        source_run,
                        retained_start,
                        retained_end,
                        cursor_glyph,
                        retained_glyph_end,
                        0,
                    )?;
                }
                self.boundary_shape_scratch.clear();
                let scratch = &mut self.boundary_shape_scratch;
                let styles = &self.styles.active().arena;
                shaper
                    .with_shaped_range(
                        fallback.font_handle,
                        &self.text.pending().units,
                        ShapeRunRef {
                            text_start: new_run.text_start,
                            text_end: new_run.text_end,
                            script: new_run.script,
                            language: styles.resolved_language(new_run.style),
                            features: styles.resolved_features(new_run.style),
                            direction: new_run.direction,
                            cluster_level: 0,
                            flags: 0x40,
                        },
                        ShapeRangeRef {
                            item_start: window.new_start,
                            item_end: window.probe_end,
                            context_start: new_run.text_start,
                            context_end: new_run.text_end,
                            flags: 0x40,
                        },
                        |shaped| {
                            scratch.append(
                                source_run_index,
                                fallback.font_handle,
                                fallback.binding_handle,
                                window.new_start,
                                window.probe_end,
                                shaped,
                            )
                        },
                    )
                    .map_err(shaper_error)?;
                if self.boundary_shape_scratch.glyph_ids.contains(&0) {
                    self.shape.pending_mut().clear();
                    self.boundary_shape_scratch.clear();
                    return Ok(ShapeAttempt::NeedsFallback);
                }
                if verify_boundaries
                    && !sparse_shape_boundaries_are_safe(
                        &self.boundary_shape_scratch,
                        window,
                        new_run.text_start,
                        new_run.text_end,
                    )
                {
                    self.shape.pending_mut().clear();
                    self.boundary_shape_scratch.clear();
                    return Ok(ShapeAttempt::RetryWholeRun);
                }
                // A complete sole run is already shaped in its final coordinates. Move its
                // owned columns into pending; the old empty pending arena becomes reusable
                // scratch, while committed shape remains available for reconciliation.
                if source_run_index == 0
                    && self.shaping_runs.committed().runs().len() == 1
                    && self.shaping_runs.active().runs().len() == 1
                    && run_count == 1
                    && affected_shape_index == 0
                    && self.shape_window_scratch.len() == 1
                    && old_run.text_start == 0
                    && new_run.text_start == 0
                    && usize::try_from(old_run.text_end).ok()
                        == Some(self.text.committed().units.len())
                    && usize::try_from(new_run.text_end).ok()
                        == Some(self.text.active().units.len())
                    && affected_shape.text_start == old_run.text_start
                    && affected_shape.text_end == old_run.text_end
                    && run_glyph_start == 0
                    && run_glyph_end == self.shape.committed().glyph_ids.len()
                    && window.old_start == old_run.text_start
                    && window.old_end == old_run.text_end
                    && window.old_glyph_start == run_glyph_start
                    && window.old_glyph_end == run_glyph_end
                    && window.new_start == new_run.text_start
                    && window.new_end == new_run.text_end
                    && window.probe_end == window.new_end
                {
                    #[cfg(test)]
                    super::work_attribution::record(|work| {
                        work.shape_scratch_arena_moves += 1;
                        work.shape_scratch_moved_glyphs +=
                            self.boundary_shape_scratch.glyph_ids.len();
                    });
                    core::mem::swap(&mut self.boundary_shape_scratch, self.shape.pending_mut());
                    return Ok(ShapeAttempt::Prepared);
                }
                {
                    let scratch = &self.boundary_shape_scratch;
                    self.shape.pending_mut().append_text_range_from(
                        scratch,
                        0,
                        source_run,
                        window.new_start,
                        window.new_end,
                        0,
                    )?;
                }
                cursor_text = if rtl {
                    window.old_start
                } else {
                    window.old_end
                };
                cursor_glyph = window.old_glyph_end;
            }
            let (retained_start, retained_end) = if rtl {
                (old_run.text_start, cursor_text)
            } else {
                (cursor_text, old_run.text_end)
            };
            if retained_start < retained_end {
                let (pending, committed) = self.shape.derive_mut();
                pending.append_glyph_range_from(
                    committed,
                    affected_shape_index,
                    source_run,
                    retained_start,
                    retained_end,
                    cursor_glyph,
                    run_glyph_end,
                    0,
                )?;
            }
            self.shape.pending_mut().collapse_appended_runs(
                appended_run_start,
                new_run.text_start,
                new_run.text_end,
            )?;
        }
        self.boundary_shape_scratch.clear();
        Ok(ShapeAttempt::Prepared)
    }

    fn discard_shape_candidate(&mut self) {
        self.shape.pending_mut().clear();
        self.shape_window_scratch.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.incremental_shape_source_run = None;
        self.shape.discard_candidate();
    }

    fn commit_shape(&mut self) {
        if self.shape.is_prepared() {
            self.shape.commit();
            core::mem::swap(&mut self.fallback_spans, &mut self.pending_fallback_spans);
        }
        self.discard_shape_candidate();
    }

    /// Returns whether cluster geometry changed and flow needs preparation.
    #[inline(never)]
    fn prepare_clusters(
        &mut self,
        shaper: &ShaperRegistry,
        next_glyph_id: &mut u32,
    ) -> Result<bool, EngineError> {
        self.discard_clusters_candidate();
        if !self.shape.is_prepared()
            && !self.style_invalidation.metrics
            && !self.style_invalidation.cluster_mapping
        {
            return Ok(false);
        }
        let text = self.text.active().units.as_slice();
        let text_unit_ids = self.text.active().unit_ids.as_slice();
        let unicode = self.unicode.active();
        let styles = self.styles.active().resolved.segments();
        let runs = self.shaping_runs.active().runs();
        if runs.is_empty() {
            self.clusters.pending_mut().clear();
            return self.finish_cluster_preparation(shaper).map(|()| true);
        }
        // Retained run ordinals require stable topology. Refresh style mappings
        // and, for metric edits, advances; uncovered clusters use the full build.
        let run_topology_stable = !self.shaping_runs.is_prepared()
            || shaping_run_topology_stable(self.shaping_runs.committed().runs(), runs);
        if !self.shape.is_prepared() && run_topology_stable && {
            let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
            pending_clusters
                .refresh_styles_from_stream(
                    committed_clusters,
                    styles,
                    self.style_invalidation.metrics,
                )?
                .is_some()
        } {
            let geometry_changed = self.style_invalidation.metrics;
            return self
                .finish_cluster_preparation(shaper)
                .map(|()| geometry_changed);
        }
        let shape = self.shape.active();
        let build_input = || ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        };
        // The sole source run owns every cluster. Direct construction avoids copying old
        // flat columns before replacing them, while equal grapheme/text cardinality keeps
        // the existing full builder's reserve at the retained cluster granularity.
        let full_source_run = self.incremental_shape_source_run == Some(0)
            && runs.len() == 1
            && self.shaping_runs.committed().runs().len() == 1
            && runs[0].text_start == 0
            && usize::try_from(runs[0].text_end).ok() == Some(text.len())
            && self.shaping_runs.committed().runs()[0].text_start == 0
            && usize::try_from(self.shaping_runs.committed().runs()[0].text_end).ok()
                == Some(self.text.committed().units.len())
            && unicode.grapheme_boundaries().len().saturating_sub(1) == text.len();
        if let Some(source_run) = self.incremental_shape_source_run
            && !full_source_run
            && let Some((cluster_start, cluster_end)) = {
                let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
                pending_clusters.rebuild_source_run_if_topology_is_stable(
                    committed_clusters,
                    build_input(),
                    source_run,
                    |handle| shaper.font_metrics(handle),
                )?
            }
        {
            let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
            if let Err(error) = pending_clusters.assign_stable_glyph_ids_in_range(
                committed_clusters,
                cluster_start,
                cluster_end,
                &mut self.glyph_identity_index,
                next_glyph_id,
            ) {
                self.discard_clusters_candidate();
                return Err(error);
            }
            return self.finish_cluster_preparation(shaper).map(|()| true);
        }
        self.clusters
            .pending_mut()
            .build(build_input(), |handle| shaper.font_metrics(handle))?;
        let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
        if let Err(error) = pending_clusters.assign_stable_glyph_ids(
            committed_clusters,
            &mut self.glyph_identity_index,
            next_glyph_id,
        ) {
            self.discard_clusters_candidate();
            return Err(error);
        }
        self.finish_cluster_preparation(shaper).map(|()| true)
    }

    /// Completes every cluster-producing path through one exact retained-run comparison.
    /// Width-only updates never reach this method because they prepare no cluster stage.
    fn finish_cluster_preparation(&mut self, shaper: &ShaperRegistry) -> Result<(), EngineError> {
        if let Err(error) = self.clusters.pending_mut().rebuild_run_local_geometry(
            self.shaping_runs.active().runs(),
            self.styles.active().resolved.segments(),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        ) {
            self.discard_clusters_candidate();
            return Err(error);
        }
        let current = RunCanonicalInput {
            text: &self.text.active().units,
            text_unit_ids: &self.text.active().unit_ids,
            style_arena: &self.styles.active().arena,
            styles: self.styles.active().resolved.segments(),
            shaping_runs: self.shaping_runs.active().runs(),
        };
        let committed = RunCanonicalInput {
            text: &self.text.committed().units,
            text_unit_ids: &self.text.committed().unit_ids,
            style_arena: &self.styles.committed().arena,
            styles: self.styles.committed().resolved.segments(),
            shaping_runs: self.shaping_runs.committed().runs(),
        };
        self.layout_dirty.clear();
        let mut next_revision = self.next_run_canonical_revision;
        let result = {
            let (pending, previous) = self.clusters.derive_mut();
            pending.finalize_layout_run_revisions(
                previous,
                current,
                committed,
                &mut self.layout_run_identity_index,
                &mut next_revision,
                (!self.text_edits.is_empty() && !self.style_invalidation.metrics)
                    .then_some((&mut self.layout_dirty, true)),
            )
        };
        match result {
            Ok(()) => {
                self.pending_source_run_canonical_revision = next_revision;
                self.pending_next_run_canonical_revision = next_revision;
                self.clusters.mark_prepared();
                Ok(())
            }
            Err(error) => {
                self.discard_clusters_candidate();
                Err(error)
            }
        }
    }

    fn discard_clusters_candidate(&mut self) {
        self.layout_dirty.clear();
        self.clusters.pending_mut().clear();
        self.clusters.discard_candidate();
        self.pending_source_run_canonical_revision = self.next_run_canonical_revision;
        self.pending_next_run_canonical_revision = self.next_run_canonical_revision;
    }

    fn commit_clusters(&mut self) {
        if self.clusters.is_prepared() {
            self.clusters.commit();
        }
        // The shared cursor also includes replacement runs prepared after the cluster stage.
        self.next_run_canonical_revision = self.pending_next_run_canonical_revision;
        self.discard_clusters_candidate();
    }

    fn prepare_geometry(
        &mut self,
        geometry: super::semantic_wire::GeometryBatch<'_>,
    ) -> Result<(), EngineError> {
        self.discard_geometry_candidate();
        if geometry.is_empty() {
            return Ok(());
        }
        self.geometry.pending_mut().build(geometry)?;
        if geometry.inline_object_count() == 0
            && self.geometry.pending() == self.geometry.committed()
        {
            self.geometry.pending_mut().clear();
            return Ok(());
        }
        self.geometry.mark_prepared();
        Ok(())
    }

    fn discard_geometry_candidate(&mut self) {
        self.geometry.pending_mut().clear();
        self.geometry.discard_candidate();
    }

    fn commit_geometry(&mut self) {
        if self.geometry.is_prepared() {
            self.geometry.commit();
        }
        self.discard_geometry_candidate();
    }

    #[inline(never)]
    fn prepare_flow_layout(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        self.prepare_flow_lines(
            shaper,
            font_stacks,
            font_bindings,
            max_lines,
            max_slots_per_band,
            next_glyph_id,
        )?;
        // Every fragment, retained or composed, gets its line edges shaped alone (or none).
        let geometry = self.geometry.active();
        let shaper = RefCell::new(shaper);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper,
            text: self.text.active().units.as_slice(),
            runs: self.shaping_runs.active().runs(),
            styles: &self.styles.active().arena,
            clusters: self.clusters.active(),
        };
        attach_line_edges(
            &mut corrections,
            geometry,
            self.flow_layout.pending_mut(),
            (&mut self.pending_boundary_shape, &self.previous_edge_ids),
            next_glyph_id,
        )?;
        Ok(())
    }

    fn prepare_flow_lines(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        self.discard_flow_layout_candidate();
        // Positioning is derived from one specific flow: its per-line lanes describe the
        // lines that flow composed. Re-running the flow therefore invalidates any pending
        // positioning by construction, so dropping it here — at the single place a new
        // flow is staged — is what makes "positioning that describes a superseded flow"
        // unrepresentable rather than something each caller has to remember to repair.
        self.discard_positioned_candidate();
        self.pending_boundary_shape.clear();
        previous_edge_ids(
            &mut self.previous_edge_ids,
            self.clusters.committed(),
            &self.boundary_shape,
        );
        self.clusters.active_mut().ensure_word_breaks()?;
        self.clusters
            .active_mut()
            .ensure_placement_segment_anchors()?;
        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        let style_storage = &self.styles.active().arena;
        let runs = self.shaping_runs.active().runs();
        let text = self.text.active().units.as_slice();
        let localized_geometry_change = if self.geometry.is_prepared() {
            self.geometry
                .pending()
                .localized_change_from(self.geometry.committed())?
        } else {
            LocalizedGeometryChange::Unchanged
        };
        let geometry = self.geometry.active();
        let max_slots_per_band =
            usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?;
        let max_lines = usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?;
        let paragraph_level = self
            .bidi
            .active()
            .paragraph_levels
            .first()
            .copied()
            .unwrap_or(0);
        let shaper_cell = RefCell::new(&mut *shaper);
        let metrics_for = |handle| shaper_cell.borrow().font_metrics(handle);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper_cell,
            text,
            runs,
            styles: style_storage,
            clusters,
        };
        let first_font_for_stack = |stack_handle| {
            font_stacks
                .binary_search_by_key(&stack_handle, |stack| stack.handle)
                .ok()
                .and_then(|index| font_stacks[index].fonts.first().copied())
                .and_then(|handle| {
                    font_bindings
                        .iter()
                        .find(|binding| binding.handle == handle)
                        .map(|binding| binding.shaping_handle)
                })
        };
        if !self.style_invalidation.metrics
            && !self.clusters.is_prepared()
            && self.text_edits.is_empty()
            && !self.boundary_shape.has_ellipsis()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && let LocalizedGeometryChange::ExclusionBand(dirty) = localized_geometry_change
            && {
                let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
                pending_flow.rebuild_after_exclusion_change_until_state_converges(
                    committed_flow,
                    geometry,
                    clusters,
                    runs,
                    styles,
                    &mut self.flow_slot_scratch,
                    dirty,
                    paragraph_level,
                    max_lines,
                    max_slots_per_band,
                    metrics_for,
                    first_font_for_stack,
                    &mut corrections,
                )?
            }
        {
            self.flow_layout.mark_prepared();
            return Ok(());
        }
        if !self.geometry.is_prepared()
            && !self.style_invalidation.metrics
            && !self.boundary_shape.has_ellipsis()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && self.layout_dirty.valid
            && !self.layout_dirty.ranges.is_empty()
            && self.bidi.active().paragraph_levels.first()
                == self.bidi.committed().paragraph_levels.first()
            && {
                #[cfg(test)]
                super::work_attribution::record(|work| {
                    work.flow_shape_windows += self.shape_window_scratch.len();
                    work.flow_shape_window_units += self
                        .shape_window_scratch
                        .iter()
                        .map(|window| (window.old_end - window.old_start) as usize)
                        .sum::<usize>();
                    work.flow_shape_window_first_start = self
                        .shape_window_scratch
                        .first()
                        .map_or(0, |window| window.old_start as usize);
                    work.flow_shape_window_last_end = self
                        .shape_window_scratch
                        .last()
                        .map_or(0, |window| window.old_end as usize);
                });
                let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
                pending_flow.rebuild_until_state_converges(
                    committed_flow,
                    geometry,
                    self.clusters.committed(),
                    clusters,
                    runs,
                    styles,
                    &mut self.flow_slot_scratch,
                    self.layout_dirty.ranges.iter().cloned(),
                    paragraph_level,
                    max_lines,
                    max_slots_per_band,
                    metrics_for,
                    first_font_for_stack,
                    &mut corrections,
                )?
            }
        {
            self.flow_layout.mark_prepared();
            return Ok(());
        }
        self.flow_layout.pending_mut().build_with_drop_cap_context(
            geometry,
            clusters,
            runs,
            styles,
            &mut self.flow_slot_scratch,
            paragraph_level,
            max_lines,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
            &mut corrections,
        )?;
        let mut ellipsis_index = 0usize;
        while ellipsis_index < self.flow_layout.pending_mut().ellipsis_threads().len() {
            let flow_thread_id = self.flow_layout.pending_mut().ellipsis_threads()[ellipsis_index];
            let line_index = self
                .flow_layout
                .pending_mut()
                .lines
                .iter()
                .rposition(|line| line.flow_thread_id == flow_thread_id)
                .ok_or(EngineError::InvalidRequest)?;
            let line = self.flow_layout.pending().lines[line_index];
            let fragment_index = self
                .flow_layout
                .pending()
                .line_fragment_start(line_index)
                .ok_or(EngineError::InvalidRequest)?
                .checked_add(usize::from(line.fragment_count))
                .and_then(|end| end.checked_sub(1))
                .ok_or(EngineError::InvalidRequest)?;
            let fragment = *self
                .flow_layout
                .pending_mut()
                .fragments
                .get(fragment_index)
                .ok_or(EngineError::InvalidRequest)?;
            let line_cluster_start = usize::try_from(fragment.line.cluster_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let line_text_start = fragment.line.text_start;
            let source_shape = &mut self.boundary_shape_scratch;
            let ellipsis_shape = &mut self.ellipsis_shape_scratch;
            let ellipsis_text = &mut self.ellipsis_text_scratch;
            let mut final_candidate = None;
            let target = self
                .flow_layout
                .pending_mut()
                .truncate_for_ellipsis(flow_thread_id, clusters, |cluster_end, text_end| {
                    let candidate = prepare_boundary_candidate(
                        shaper,
                        text,
                        ellipsis_text,
                        source_shape,
                        ellipsis_shape,
                        clusters,
                        runs,
                        style_storage,
                        font_stacks,
                        font_bindings,
                        line_cluster_start,
                        line_text_start,
                        cluster_end,
                        text_end,
                    )?;
                    let retained_advance = clusters.advances[candidate.cluster_start..cluster_end]
                        .iter()
                        .copied()
                        .sum::<f64>();
                    final_candidate = Some(candidate);
                    Ok(EllipsisReplacement {
                        cluster_start: candidate.cluster_start,
                        advance_adjustment: candidate.source_advance + candidate.ellipsis_advance
                            - retained_advance,
                    })
                })?
                .ok_or(EngineError::InvalidRequest)?;
            let candidate = final_candidate.ok_or(EngineError::InvalidRequest)?;
            if usize::try_from(target.boundary_cluster_start).ok() != Some(candidate.cluster_start)
            {
                return Err(EngineError::InvalidRequest);
            }
            let source_span = if source_shape.runs.is_empty() {
                (
                    u32::try_from(self.pending_boundary_shape.shape.glyph_ids.len())
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    0,
                )
            } else {
                self.pending_boundary_shape
                    .shape
                    .append_from(source_shape, 0)?
            };
            let ellipsis_span = self
                .pending_boundary_shape
                .shape
                .append_from(ellipsis_shape, 0)?;
            append_boundary_source_ids(
                &mut self.pending_boundary_shape.stable_ids,
                &source_shape.clusters,
                (clusters, &self.previous_edge_ids),
                next_glyph_id,
            )?;
            let previous = self
                .boundary_shape
                .records
                .iter()
                .find(|record| record.flow_thread_id == flow_thread_id)
                .copied();
            let previous_ellipsis_ids = previous
                .and_then(|record| {
                    let start = usize::try_from(record.ellipsis_glyph_start).ok()?;
                    let end =
                        start.checked_add(usize::try_from(record.ellipsis_glyph_count).ok()?)?;
                    self.boundary_shape.stable_ids.get(start..end)
                })
                .unwrap_or(&[]);
            let ellipsis_count =
                usize::try_from(ellipsis_span.1).map_err(|_| EngineError::InvalidRequest)?;
            for ordinal in 0..ellipsis_count {
                let stable_id = previous_ellipsis_ids
                    .get(ordinal)
                    .copied()
                    .filter(|id| *id != 0)
                    .map_or_else(|| allocate_glyph_id(next_glyph_id), Ok)?;
                self.pending_boundary_shape.stable_ids.push(stable_id);
            }
            let boundary_index = u32::try_from(self.pending_boundary_shape.records.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.pending_boundary_shape.records.push(BoundaryShape {
                flow_thread_id,
                source_run: u32::try_from(candidate.source_run)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                cluster_start: target.boundary_cluster_start,
                cluster_end: target.cluster_end,
                text_end: target.text_end,
                source_binding_handle: candidate.source_binding_handle,
                source_font_handle: candidate.source_font_handle,
                ellipsis_binding_handle: candidate.ellipsis_binding_handle,
                ellipsis_font_handle: candidate.ellipsis_font_handle,
                source_glyph_start: source_span.0,
                source_glyph_count: source_span.1,
                ellipsis_glyph_start: ellipsis_span.0,
                ellipsis_glyph_count: ellipsis_span.1,
                line_start: false,
            });
            if !self
                .flow_layout
                .pending_mut()
                .fragments
                .update(fragment_index, |fragment| {
                    fragment.boundary_index = boundary_index;
                })
                .map_err(|()| EngineError::ResultTooLarge)?
            {
                return Err(EngineError::InvalidRequest);
            }
            ellipsis_index += 1;
        }
        self.flow_layout.mark_prepared();
        Ok(())
    }

    fn prepare_intrinsic_flow_layout(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
    ) -> Result<(), EngineError> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.intrinsic_flow_preparations += 1);
        let source_geometry = self.geometry.active();
        self.intrinsic_geometry_scratch.clone_from(source_geometry);
        let constraint = self
            .intrinsic_geometry_scratch
            .constraints
            .first_mut()
            .ok_or(EngineError::InvalidRequest)?;
        let region_start =
            usize::try_from(constraint.region_start).map_err(|_| EngineError::InvalidRequest)?;
        let final_region = region_start
            .checked_add(usize::from(constraint.region_count))
            .and_then(|end| end.checked_sub(1))
            .ok_or(EngineError::InvalidRequest)?;
        let region = self
            .intrinsic_geometry_scratch
            .regions
            .get_mut(final_region)
            .ok_or(EngineError::InvalidRequest)?;
        const INTRINSIC_BLOCK_END: f32 = 16_777_216.0;
        constraint.max_lines = 0;
        constraint.viewport_block_end = INTRINSIC_BLOCK_END;
        constraint.overflow = OVERFLOW_VISIBLE;
        constraint.drop_cap_lines = 0;
        constraint.drop_cap_alignment = 0;
        constraint.drop_cap_side = 0;
        constraint.drop_cap_margin_inline = 0.0;
        constraint.drop_cap_margin_block = 0.0;
        region.record.block_end = INTRINSIC_BLOCK_END;

        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        let shaper = RefCell::new(shaper);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper,
            text: self.text.active().units.as_slice(),
            runs: self.shaping_runs.active().runs(),
            styles: &self.styles.active().arena,
            clusters,
        };
        self.intrinsic_flow_layout_scratch
            .build_with_drop_cap_context(
                &self.intrinsic_geometry_scratch,
                clusters,
                &[],
                styles,
                &mut self.intrinsic_flow_slot_scratch,
                0,
                usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?,
                usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?,
                |handle| shaper.borrow().font_metrics(handle),
                |stack_handle| {
                    font_stacks
                        .binary_search_by_key(&stack_handle, |stack| stack.handle)
                        .ok()
                        .and_then(|index| font_stacks[index].fonts.first().copied())
                        .and_then(|handle| {
                            font_bindings
                                .iter()
                                .find(|binding| binding.handle == handle)
                                .map(|binding| binding.shaping_handle)
                        })
                },
                &mut corrections,
            )?;
        // Throwaway identities for the unpublished inspection flow.
        self.intrinsic_boundary_shape.clear();
        attach_line_edges(
            &mut corrections,
            &self.intrinsic_geometry_scratch,
            &mut self.intrinsic_flow_layout_scratch,
            (&mut self.intrinsic_boundary_shape, &[]),
            &mut (1 << 30),
        )
    }

    fn inspection_positioned(&self) -> &PositionedGlyphArena {
        let clipped = self.clipped_inspection.active();
        if clipped.mode == IntrinsicInspection::Positioned {
            &clipped.positioned
        } else {
            self.positioned.active()
        }
    }

    fn prepare_intrinsic_positioned(&mut self, shaper: &ShaperRegistry) -> Result<(), EngineError> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.intrinsic_positioning_preparations += 1);
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let previous = self.positioned.active();
        let mut next_content_revision = 1;
        let mut next_run_canonical_revision = 1;
        let boundary_shape = &self.intrinsic_boundary_shape;
        let geometry = &self.intrinsic_geometry_scratch;
        self.clipped_inspection.pending_mut().positioned.build(
            previous,
            &self.intrinsic_flow_layout_scratch,
            None,
            None,
            text,
            clusters,
            clusters,
            runs,
            runs,
            boundary_shape,
            boundary_shape,
            styles,
            bidi,
            &mut self.intrinsic_identity_scratch,
            &mut next_content_revision,
            &mut next_run_canonical_revision,
            |thread| thread_typography(geometry, thread),
            |thread| thread_typography(geometry, thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )
    }

    fn discard_flow_layout_candidate(&mut self) {
        self.flow_layout.pending_mut().clear();
        self.pending_boundary_shape.clear();
        self.flow_layout.discard_candidate();
    }

    fn commit_flow_layout(&mut self) {
        if self.flow_layout.is_prepared() {
            // The boundary shape is the flow's own output and commits with it.
            core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
        }
        self.flow_layout.commit();
        self.discard_flow_layout_candidate();
    }

    #[inline(never)]
    fn prepare_positioned(
        &mut self,
        shaper: &ShaperRegistry,
        next_content_revision: &mut u32,
    ) -> Result<(), EngineError> {
        self.discard_positioned_candidate();
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let previous_runs = self.shaping_runs.committed().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let flow = self.flow_layout.active();
        let boundary_shape = if self.flow_layout.is_prepared() {
            &self.pending_boundary_shape
        } else {
            &self.boundary_shape
        };
        let geometry = self.geometry.active();
        let retained_flow = (self.geometry.is_prepared()
            && !self.clusters.is_prepared()
            && !self.text.is_prepared()
            && !self.styles.is_prepared()
            && !self.unicode.is_prepared()
            && !self.bidi.is_prepared()
            && !self.shape.is_prepared()
            && !self.shaping_runs.is_prepared()
            && !self.style_invalidation.metrics
            && !self.style_invalidation.positioning)
            .then(|| self.flow_layout.committed());
        // Layout islands authorize semantic reuse only within this preparation.
        // Paint/effects invalidate positioning even when layout itself is unchanged.
        let recomposed_lines =
            if self.flow_layout.is_prepared() && !self.style_invalidation.positioning {
                flow.recomposed_line_ranges()
            } else {
                None
            };
        let (committed_positioned, pending_positioned) = self.positioned.pair_mut();
        pending_positioned.build(
            committed_positioned,
            flow,
            retained_flow,
            recomposed_lines,
            text,
            clusters,
            self.clusters.committed(),
            runs,
            previous_runs,
            boundary_shape,
            &self.boundary_shape,
            styles,
            bidi,
            &mut self.glyph_identity_index,
            next_content_revision,
            &mut self.pending_next_run_canonical_revision,
            |thread| thread_typography(geometry, thread),
            |thread| thread_typography(self.geometry.committed(), thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )?;
        self.positioned.mark_prepared();
        // A changed visible layout retires the prior derived inspection. Measurement
        // replaces this selection with full clipped positioning when requested.
        self.clipped_inspection.pending_mut().mode = IntrinsicInspection::None;
        self.clipped_inspection.mark_prepared();
        Ok(())
    }

    fn discard_positioned_candidate(&mut self) {
        self.positioned.pending_mut().clear();
        self.positioned.discard_candidate();
        self.pending_next_run_canonical_revision = self.pending_source_run_canonical_revision;
    }

    fn commit_positioned(&mut self) {
        self.positioned.commit();
        self.positioned.pending_mut().clear();
    }
}

fn apply_text_mutation(
    text: &mut Vec<u16>,
    mutation: super::semantic_wire::TextMutation<'_>,
) -> Result<(), TextMutationError> {
    let old_len = text.len();
    let CheckedTextMutation {
        start,
        delete_end,
        insert_count,
        new_len,
    } = check_text_mutation(old_len, mutation)?;
    if new_len > old_len {
        text.try_reserve(new_len - old_len)
            .map_err(|_| TextMutationError::Allocation)?;
        text.resize(new_len, 0);
    }
    text.copy_within(delete_end..old_len, start + insert_count);
    if new_len < old_len {
        text.truncate(new_len);
    }
    for (unit, decoded) in text[start..start + insert_count]
        .iter_mut()
        .zip(decoded_inserted_units(mutation.insert_utf16_le))
    {
        *unit = decoded;
    }
    Ok(())
}

fn decoded_inserted_units(utf16_le: &[u8]) -> impl Iterator<Item = u16> + '_ {
    utf16_le
        .chunks_exact(2)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Preflight has already validated every mutation against the accepted text. A single
/// complete replacement can write directly into the reused destination without seeding
/// or shifting old units; ordered and partial edits retain the shared mutation path.
fn populate_preflight_text(
    destination: &mut Vec<u16>,
    committed: &[u16],
    mutations: super::semantic_wire::TextMutationBatch<'_>,
    seed_committed: bool,
    preserved_capacity: usize,
) -> Result<(), EngineError> {
    if mutations.len() == 1 {
        let mutation = mutations.get(0).ok_or(EngineError::InvalidRequest)?;
        if mutation.text_start == 0
            && usize::try_from(mutation.delete_count).ok() == Some(committed.len())
        {
            let insert_count = mutation.insert_utf16_le.len() / 2;
            destination.clear();
            destination
                .try_reserve(insert_count.max(preserved_capacity))
                .map_err(|_| EngineError::ResultTooLarge)?;
            destination.extend(decoded_inserted_units(mutation.insert_utf16_le));
            return Ok(());
        }
    }
    if seed_committed {
        destination.clear();
        destination
            .try_reserve(committed.len().max(preserved_capacity))
            .map_err(|_| EngineError::ResultTooLarge)?;
        destination.extend_from_slice(committed);
        #[cfg(test)]
        super::work_attribution::record(|work| work.preflight_seeded_old_units += committed.len());
    }
    apply_text_mutations(destination, mutations)
}

fn apply_text_mutations(
    text: &mut Vec<u16>,
    mutations: super::semantic_wire::TextMutationBatch<'_>,
) -> Result<(), EngineError> {
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        apply_text_mutation(text, mutation).map_err(|error| match error {
            TextMutationError::Invalid => EngineError::InvalidRequest,
            TextMutationError::Allocation => EngineError::ResultTooLarge,
        })?;
    }
    Ok(())
}

fn copy_preflight_text_edits(
    destination: &mut Vec<TextEdit>,
    source: &[TextEdit],
    start: usize,
    end: usize,
) -> Result<(), EngineError> {
    let edits = source.get(start..end).ok_or(EngineError::InvalidRequest)?;
    destination.clear();
    destination
        .try_reserve(edits.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    destination.extend_from_slice(edits);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CheckedTextMutation {
    start: usize,
    delete_end: usize,
    insert_count: usize,
    new_len: usize,
}

fn check_text_mutation(
    old_len: usize,
    mutation: super::semantic_wire::TextMutation<'_>,
) -> Result<CheckedTextMutation, TextMutationError> {
    let start = usize::try_from(mutation.text_start).map_err(|_| TextMutationError::Invalid)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| TextMutationError::Invalid)?;
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(TextMutationError::Invalid)?;
    if delete_end > old_len || !mutation.insert_utf16_le.len().is_multiple_of(2) {
        return Err(TextMutationError::Invalid);
    }
    let insert_count = mutation.insert_utf16_le.len() / 2;
    let new_len = old_len
        .checked_sub(delete_count)
        .and_then(|length| length.checked_add(insert_count))
        .ok_or(TextMutationError::Invalid)?;
    if u32::try_from(new_len).is_err() {
        return Err(TextMutationError::Invalid);
    }
    Ok(CheckedTextMutation {
        start,
        delete_end,
        insert_count,
        new_len,
    })
}

fn validate_text_mutations(
    committed: &[u16],
    mutations: super::semantic_wire::TextMutationBatch<'_>,
) -> Result<usize, EngineError> {
    let mut text_len = committed.len();
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        let checked =
            check_text_mutation(text_len, mutation).map_err(|_| EngineError::InvalidRequest)?;
        let left = checked
            .start
            .checked_sub(1)
            .and_then(|unit| text_unit_before_mutation(committed, mutations, index, unit));
        let start_right = text_unit_before_mutation(committed, mutations, index, checked.start);
        let end_left = checked
            .delete_end
            .checked_sub(1)
            .and_then(|unit| text_unit_before_mutation(committed, mutations, index, unit));
        let right = text_unit_before_mutation(committed, mutations, index, checked.delete_end);
        if !valid_utf16_boundary_pair(left, start_right)
            || !valid_utf16_boundary_pair(end_left, right)
        {
            return Err(EngineError::InvalidRequest);
        }

        let inserted_units = mutation
            .insert_utf16_le
            .chunks_exact(2)
            .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]));
        if core::char::decode_utf16(inserted_units).any(|decoded| decoded.is_err()) {
            return Err(EngineError::InvalidRequest);
        }
        let first = inserted_unit(mutation, 0);
        let last = checked
            .insert_count
            .checked_sub(1)
            .and_then(|index| inserted_unit(mutation, index));
        let seam_valid = if checked.insert_count == 0 {
            valid_utf16_join(left, right)
        } else {
            valid_utf16_join(left, first) && valid_utf16_join(last, right)
        };
        if !seam_valid {
            return Err(EngineError::InvalidRequest);
        }
        text_len = checked.new_len;
    }
    Ok(text_len)
}

fn has_text_mutations_for(
    mutations: super::semantic_wire::TextMutationBatch<'_>,
    paragraph_id: u32,
) -> bool {
    (0..mutations.len()).any(|index| mutations.paragraph_id(index) == Some(paragraph_id))
}

fn validate_planner_inputs(
    planner: &mut PlannerState,
    request: UpdateRequest<'_>,
    scope: ParagraphInputScope,
    font_stacks: &[RegisteredFontStack],
    spare_text_candidate_id: Option<u32>,
    preflight_text_candidates: &mut Vec<PreflightTextCandidate>,
    preflight_edit_scratch: &mut Vec<TextEdit>,
) -> Result<(), EngineError> {
    let text_mutations = request.text_mutations;
    let style_mutations = request.style_mutations;
    // Each adjacent text-record group can produce one candidate. Group IDs are
    // not required to be contiguous, so record count is the safe upper bound.
    // Reserve before preflight can write pending text/Unicode state.
    if text_mutations.len() > 1 {
        sort::prepare_pairs(
            &mut planner.style_validation_sort_pairs_pass,
            text_mutations.len(),
        )?;
    }
    let (mut text_cursor, mut style_cursor) = (0, 0);
    while text_cursor < text_mutations.len() || style_cursor < style_mutations.len() {
        let paragraph_id = match (
            text_mutations.paragraph_id(text_cursor),
            style_mutations.paragraph_id(style_cursor),
        ) {
            (Some(text), Some(style)) => text.min(style),
            (Some(text), None) => text,
            (None, Some(style)) => style,
            (None, None) => return Err(EngineError::InvalidRequest),
        };
        if let ParagraphInputScope::Single(selected) = scope
            && paragraph_id != selected
        {
            return Err(EngineError::InvalidRequest);
        }
        if !planner_contains_after_lifecycle(planner, paragraph_id) {
            return Err(EngineError::InvalidRequest);
        }

        let text_start = text_cursor;
        while text_cursor < text_mutations.len()
            && text_mutations.paragraph_id(text_cursor) == Some(paragraph_id)
        {
            text_cursor += 1;
        }
        let paragraph_text = text_mutations
            .span(super::semantic_wire::RecordSpan {
                start: text_start,
                end: text_cursor,
            })
            .map_err(|_| EngineError::InvalidRequest)?;
        let style_start = style_cursor;
        while style_cursor < style_mutations.len()
            && style_mutations.paragraph_id(style_cursor) == Some(paragraph_id)
        {
            style_cursor += 1;
        }
        let paragraph_styles = style_mutations
            .span(super::semantic_wire::RecordSpan {
                start: style_start,
                end: style_cursor,
            })
            .map_err(|_| EngineError::InvalidRequest)?;

        if let Some(paragraph) = planner.paragraph_mut(paragraph_id) {
            let committed_text = if paragraph.created {
                &[][..]
            } else {
                paragraph.state.text.committed().units.as_slice()
            };
            let text_length = validate_text_mutations(committed_text, paragraph_text)
                .map_err(|error| error.in_paragraph(paragraph_id))?;
            let text_length =
                u32::try_from(text_length).map_err(|_| EngineError::InvalidRequest)?;
            let mut is_boundary = |offset| {
                utf16_boundary_after_mutations(committed_text, paragraph_text, text_length, offset)
            };
            paragraph
                .state
                .styles
                .committed()
                .arena
                .validate_retained_ranges_for_text(
                    paragraph_styles,
                    text_length,
                    &mut is_boundary,
                    &mut paragraph.state.style_mutation_scratch,
                    &mut paragraph.state.style_sort_pair_scratch,
                )
                .map_err(|error| error.in_paragraph(paragraph_id))?;
            if paragraph_styles.len() != 0 {
                let mut font_stack_exists = |handle| {
                    font_stacks
                        .binary_search_by_key(&handle, |stack| stack.handle)
                        .is_ok()
                };
                paragraph
                    .state
                    .styles
                    .committed()
                    .arena
                    .validate_mutations_for_text(
                        paragraph_styles,
                        text_length,
                        &mut is_boundary,
                        &mut font_stack_exists,
                        &mut paragraph.state.style_mutation_scratch,
                        &mut paragraph.state.style_sort_pair_scratch,
                    )
                    .map_err(|error| error.in_paragraph(paragraph_id))?;
            }
        } else {
            let text_length = validate_text_mutations(&[], paragraph_text)
                .map_err(|error| error.in_paragraph(paragraph_id))?;
            if paragraph_styles.len() != 0 {
                let text_length =
                    u32::try_from(text_length).map_err(|_| EngineError::InvalidRequest)?;
                let mut is_boundary = |offset| {
                    utf16_boundary_after_mutations(&[], paragraph_text, text_length, offset)
                };
                let mut font_stack_exists = |handle| {
                    font_stacks
                        .binary_search_by_key(&handle, |stack| stack.handle)
                        .is_ok()
                };
                StyleArena::default()
                    .validate_mutations_for_text(
                        paragraph_styles,
                        text_length,
                        &mut is_boundary,
                        &mut font_stack_exists,
                        &mut planner.style_validation_mutation_scratch,
                        &mut planner.style_validation_sort_pair_scratch,
                    )
                    .map_err(|error| error.in_paragraph(paragraph_id))?;
            }
        }

        planner
            .validate_style_topology_for_inputs(
                paragraph_id,
                paragraph_text,
                paragraph_styles,
                spare_text_candidate_id,
                preflight_text_candidates,
                preflight_edit_scratch,
            )
            .map_err(|error| error.in_paragraph(paragraph_id))?;
    }
    if preflight_text_candidates.len() > 1 {
        // The preflight reservation covers one candidate per adjacent text group.
        planner.style_validation_sort_pairs_pass.clear();
        for (index, candidate) in preflight_text_candidates.iter().enumerate() {
            planner
                .style_validation_sort_pairs_pass
                .push((u64::from(candidate.paragraph_id), index as u32));
        }
        sort::sort_pairs(&mut planner.style_validation_sort_pairs_pass);
        sort::apply_pair_order(
            preflight_text_candidates,
            &mut planner.style_validation_sort_pairs_pass,
        );
    }
    Ok(())
}

fn inserted_unit(mutation: super::semantic_wire::TextMutation<'_>, index: usize) -> Option<u16> {
    let offset = index.checked_mul(2)?;
    Some(u16::from_le_bytes([
        *mutation.insert_utf16_le.get(offset)?,
        *mutation.insert_utf16_le.get(offset + 1)?,
    ]))
}

fn text_unit_before_mutation(
    committed: &[u16],
    mutations: super::semantic_wire::TextMutationBatch<'_>,
    mutation_index: usize,
    mut unit_index: usize,
) -> Option<u16> {
    for prior_index in (0..mutation_index).rev() {
        let prior = mutations.get(prior_index)?;
        let start = usize::try_from(prior.text_start).ok()?;
        let deleted = usize::try_from(prior.delete_count).ok()?;
        let inserted = prior.insert_utf16_le.len() / 2;
        let inserted_end = start.checked_add(inserted)?;
        if unit_index < start {
            continue;
        }
        if unit_index < inserted_end {
            let offset = (unit_index - start).checked_mul(2)?;
            return Some(u16::from_le_bytes([
                *prior.insert_utf16_le.get(offset)?,
                *prior.insert_utf16_le.get(offset + 1)?,
            ]));
        }
        unit_index = unit_index.checked_sub(inserted)?.checked_add(deleted)?;
    }
    committed.get(unit_index).copied()
}

fn utf16_boundary_after_mutations(
    committed: &[u16],
    mutations: super::semantic_wire::TextMutationBatch<'_>,
    length: u32,
    offset: u32,
) -> bool {
    if offset > length {
        return false;
    }
    if offset == 0 || offset == length {
        return true;
    }
    // Both callers pass the final length returned by validate_text_mutations
    // for this same committed text and mutation batch.
    let Ok(offset) = usize::try_from(offset) else {
        return false;
    };
    let Some(left) = text_unit_before_mutation(committed, mutations, mutations.len(), offset - 1)
    else {
        return false;
    };
    let Some(right) = text_unit_before_mutation(committed, mutations, mutations.len(), offset)
    else {
        return false;
    };
    valid_utf16_boundary_pair(Some(left), Some(right))
}

fn valid_utf16_join(left: Option<u16>, right: Option<u16>) -> bool {
    let left_high = left.is_some_and(|unit| (0xd800..=0xdbff).contains(&unit));
    let right_low = right.is_some_and(|unit| (0xdc00..=0xdfff).contains(&unit));
    left_high == right_low
}

fn valid_utf16_boundary_pair(left: Option<u16>, right: Option<u16>) -> bool {
    !(left.is_some_and(|unit| (0xd800..=0xdbff).contains(&unit))
        && right.is_some_and(|unit| (0xdc00..=0xdfff).contains(&unit)))
}

fn implicit_paragraph_id(
    planner: &PlannerState,
    request: UpdateRequest<'_>,
) -> Result<Option<u32>, EngineError> {
    if request.paragraph_mutations.len() == 0 && planner.paragraphs.is_empty() {
        request_semantic_paragraph_id(request)
    } else {
        Ok(None)
    }
}

fn planner_contains_after_lifecycle(planner: &PlannerState, paragraph_id: u32) -> bool {
    planner
        .lifecycle_membership_scratch
        .binary_search(&paragraph_id)
        .is_ok()
}

fn validate_lifecycle_input(
    planner: &mut PlannerState,
    mutations: super::semantic_wire::ParagraphMutationBatch<'_>,
    order_mutations: super::semantic_wire::ParagraphOrderMutationBatch<'_>,
    implicit_paragraph: Option<u32>,
    max_paragraphs: u32,
) -> Result<LifecyclePlan, EngineError> {
    if mutations.len() == 0 && order_mutations.len() == 0 && implicit_paragraph.is_none() {
        if planner.ordered_paragraphs.len()
            > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)?
        {
            return Err(EngineError::InvalidRequest);
        }
        return Ok(LifecyclePlan {
            creates: 0,
            removals: 0,
            placement_changes: 0,
            ordered: Vec::new(),
        });
    }

    planner.lifecycle_id_scratch.clear();
    planner
        .lifecycle_id_scratch
        .try_reserve(mutations.len().max(order_mutations.len()))
        .map_err(|_| EngineError::ResultTooLarge)?;
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        let paragraph_id = match mutation {
            super::semantic_wire::ParagraphMutation::Upsert { paragraph_id, .. }
            | super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => paragraph_id,
        };
        planner.lifecycle_id_scratch.push((
            u64::from(paragraph_id),
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(&mut planner.lifecycle_id_scratch);
    if planner
        .lifecycle_id_scratch
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0)
    {
        return Err(EngineError::InvalidRequest);
    }

    planner.lifecycle_membership_scratch.clear();
    planner
        .lifecycle_membership_scratch
        .try_reserve(planner.ordered_paragraphs.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    planner
        .lifecycle_membership_scratch
        .extend(planner.ordered_paragraphs.iter().map(|item| item.id));
    planner.lifecycle_membership_scratch.sort_unstable();

    let mut creates = usize::from(implicit_paragraph.is_some_and(|id| {
        planner
            .lifecycle_membership_scratch
            .binary_search(&id)
            .is_err()
    }));
    let mut removals = 0usize;
    let mut placement_changes = creates;
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        match mutation {
            super::semantic_wire::ParagraphMutation::Upsert {
                paragraph_id,
                order,
            } => {
                let current = planner
                    .paragraph(paragraph_id)
                    .filter(|paragraph| !paragraph.created);
                creates += usize::from(current.is_none());
                placement_changes += current.map_or(1, |paragraph| {
                    usize::from(paragraph.placement.order != order)
                });
            }
            super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                if planner
                    .lifecycle_membership_scratch
                    .binary_search(&paragraph_id)
                    .is_err()
                {
                    return Err(EngineError::InvalidRequest);
                }
                removals += 1;
            }
        }
    }
    let final_count = planner
        .ordered_paragraphs
        .len()
        .checked_add(creates)
        .and_then(|count| count.checked_sub(removals))
        .ok_or(EngineError::InvalidRequest)?;
    if final_count > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)? {
        return Err(EngineError::InvalidRequest);
    }
    planner.pending_ordered_paragraphs.clear();
    planner
        .pending_ordered_paragraphs
        .try_reserve(final_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    for current in &planner.ordered_paragraphs {
        let mutation_index = planner
            .lifecycle_id_scratch
            .binary_search_by_key(&u64::from(current.id), |entry| entry.0)
            .ok()
            .map(|position| planner.lifecycle_id_scratch[position].1);
        let mutation = mutation_index
            .map(|index| {
                mutations
                    .get(usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)
            })
            .transpose()?;
        match mutation {
            Some(super::semantic_wire::ParagraphMutation::Remove { .. }) => {}
            Some(super::semantic_wire::ParagraphMutation::Upsert { order, .. }) => {
                planner.pending_ordered_paragraphs.push(ParagraphOrder {
                    order,
                    id: current.id,
                });
            }
            None => {
                planner.pending_ordered_paragraphs.push(*current);
            }
        }
    }
    for index in 0..mutations.len() {
        if let Some(super::semantic_wire::ParagraphMutation::Upsert {
            paragraph_id,
            order,
        }) = mutations.get(index)
            && planner
                .lifecycle_membership_scratch
                .binary_search(&paragraph_id)
                .is_err()
        {
            planner.pending_ordered_paragraphs.push(ParagraphOrder {
                order,
                id: paragraph_id,
            });
        }
    }
    if let Some(paragraph_id) = implicit_paragraph
        && planner
            .lifecycle_membership_scratch
            .binary_search(&paragraph_id)
            .is_err()
        && planner
            .lifecycle_id_scratch
            .binary_search_by_key(&u64::from(paragraph_id), |entry| entry.0)
            .is_err()
    {
        planner.pending_ordered_paragraphs.push(ParagraphOrder {
            order: 0,
            id: paragraph_id,
        });
    }
    if planner.pending_ordered_paragraphs.len() != final_count {
        return Err(EngineError::InvalidRequest);
    }
    if planner.pending_ordered_paragraphs.len() > 1 {
        sort::prepare_pairs(
            &mut planner.rank_sort_scratch,
            planner.pending_ordered_paragraphs.len(),
        )?;
        for (index, paragraph) in planner.pending_ordered_paragraphs.iter().enumerate() {
            planner
                .rank_sort_scratch
                .push((sort::pack2(paragraph.order, paragraph.id), index as u32));
        }
        sort::sort_pairs(&mut planner.rank_sort_scratch);
        sort::apply_pair_order(
            &mut planner.pending_ordered_paragraphs,
            &mut planner.rank_sort_scratch,
        );
    }
    planner.lifecycle_membership_scratch.clear();
    planner
        .lifecycle_membership_scratch
        .try_reserve(final_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    planner.lifecycle_membership_scratch.extend(
        planner
            .pending_ordered_paragraphs
            .iter()
            .map(|paragraph| paragraph.id),
    );
    planner.lifecycle_membership_scratch.sort_unstable();
    if planner
        .lifecycle_membership_scratch
        .windows(2)
        .any(|pair| pair[0] == pair[1])
    {
        return Err(EngineError::InvalidRequest);
    }
    planner.lifecycle_id_scratch.clear();
    planner
        .lifecycle_id_scratch
        .try_reserve(order_mutations.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    for index in 0..order_mutations.len() {
        let mutation = order_mutations
            .get(index)
            .ok_or(EngineError::InvalidRequest)?;
        planner.lifecycle_id_scratch.push((
            u64::from(mutation.paragraph_id),
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(&mut planner.lifecycle_id_scratch);
    if planner
        .lifecycle_id_scratch
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0)
    {
        return Err(EngineError::InvalidRequest);
    }
    for &(_, index) in planner.lifecycle_id_scratch.iter() {
        let mutation = order_mutations
            .get(usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        if !mutation.rank.is_finite() {
            return Err(EngineError::InvalidRequest);
        }
        if planner
            .lifecycle_membership_scratch
            .binary_search(&mutation.paragraph_id)
            .is_err()
        {
            return Err(EngineError::InvalidRequest);
        }
        placement_changes += planner
            .paragraph(mutation.paragraph_id)
            .filter(|paragraph| !paragraph.created)
            .map_or(1, |paragraph| {
                usize::from(
                    paragraph.placement.scope != mutation.scope
                        || paragraph.placement.rank != mutation.rank,
                )
            });
    }
    for pair in planner.pending_ordered_paragraphs.windows(2) {
        if pair[0].order != pair[1].order {
            continue;
        }
        let left = planned_paragraph_rank(
            planner,
            order_mutations,
            &planner.lifecycle_id_scratch,
            pair[0].id,
        )?;
        let right = planned_paragraph_rank(
            planner,
            order_mutations,
            &planner.lifecycle_id_scratch,
            pair[1].id,
        )?;
        if left.0 == right.0 && left.1 == right.1 {
            return Err(EngineError::InvalidRequest);
        }
    }
    if placement_changes == 0 && removals == 0 {
        return Ok(LifecyclePlan {
            creates,
            removals,
            placement_changes,
            ordered: Vec::new(),
        });
    }
    if planner.lifecycle_prepared {
        return Err(EngineError::InvalidRequest);
    }
    Ok(LifecyclePlan {
        creates,
        removals,
        placement_changes,
        ordered: core::mem::take(&mut planner.pending_ordered_paragraphs),
    })
}

fn planned_paragraph_rank(
    planner: &PlannerState,
    mutations: super::semantic_wire::ParagraphOrderMutationBatch<'_>,
    mutation_indices: &[(u64, u32)],
    paragraph_id: u32,
) -> Result<(u32, f64), EngineError> {
    if let Ok(index) =
        mutation_indices.binary_search_by_key(&u64::from(paragraph_id), |entry| entry.0)
    {
        let mutation_index =
            usize::try_from(mutation_indices[index].1).map_err(|_| EngineError::InvalidRequest)?;
        let mutation = mutations
            .get(mutation_index)
            .ok_or(EngineError::InvalidRequest)?;
        return Ok((mutation.scope, mutation.rank));
    }

    Ok(planner
        .paragraph(paragraph_id)
        .map_or((0, 0.0), |paragraph| {
            let placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
            (placement.scope, placement.rank)
        }))
}

fn changed_identity_range(previous: &[u32], next: &[u32]) -> Option<TextEdit> {
    let shared = previous.len().min(next.len());
    let mut start = 0usize;
    while start < shared && previous[start] == next[start] {
        start += 1;
    }
    if start == previous.len() && start == next.len() {
        return None;
    }
    let mut previous_end = previous.len();
    let mut next_end = next.len();
    while previous_end > start
        && next_end > start
        && previous[previous_end - 1] == next[next_end - 1]
    {
        previous_end -= 1;
        next_end -= 1;
    }
    Some(TextEdit {
        old_start: start,
        old_end: previous_end,
        new_start: start,
        new_end: next_end,
    })
}

fn bounding_text_edit(edits: &[TextEdit]) -> Option<TextEdit> {
    let first = edits.first().copied()?;
    let last = edits.last().copied()?;
    Some(TextEdit {
        old_start: first.old_start,
        old_end: last.old_end,
        new_start: first.new_start,
        new_end: last.new_end,
    })
}

fn build_sparse_shape_windows(
    edits: &[TextEdit],
    shape: &ShapeArena,
    shaped_run: ShapedRun,
    source_run: ShapingRun,
    windows: &mut Vec<ShapeWindow>,
) -> Result<bool, EngineError> {
    windows.clear();
    if edits.is_empty()
        || shaped_run.text_start != source_run.text_start
        || shaped_run.text_end != source_run.text_end
    {
        return Ok(false);
    }
    let mut previous_end =
        usize::try_from(source_run.text_start).map_err(|_| EngineError::ResultTooLarge)?;
    let run_end = usize::try_from(source_run.text_end).map_err(|_| EngineError::ResultTooLarge)?;
    for edit in edits.iter().copied() {
        if !edit.is_same_length()
            || edit.old_start != edit.new_start
            || edit.old_start == edit.old_end
            || edit.old_start < previous_end
            || edit.old_end > run_end
        {
            return Ok(false);
        }
        previous_end = edit.old_end;
    }
    windows
        .try_reserve(edits.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    let (glyph_start, glyph_end) = shaped_run_glyph_range(shape, shaped_run)?;
    let rtl = match source_run.direction {
        0 => false,
        1 => true,
        _ => return Ok(false),
    };
    let run_start_boundary = if rtl { glyph_end } else { glyph_start };
    let mut builder = SparseWindowBuilder {
        edits,
        next_edit: 0,
        previous_safe: (source_run.text_start, run_start_boundary),
        window_start: (source_run.text_start, run_start_boundary),
        rtl,
        windows,
    };
    let mut previous_cluster = None;
    if rtl {
        let mut glyph = glyph_end;
        while glyph > glyph_start {
            let group_end = glyph;
            let cluster = shape.clusters[glyph - 1];
            let mut group_start = glyph - 1;
            let mut safe = shape.glyph_flags[group_start] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            while group_start > glyph_start && shape.clusters[group_start - 1] == cluster {
                group_start -= 1;
                safe &= shape.glyph_flags[group_start] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            }
            if cluster < source_run.text_start
                || cluster >= source_run.text_end
                || previous_cluster.is_some_and(|previous| cluster < previous)
            {
                windows.clear();
                return Ok(false);
            }
            #[cfg(test)]
            crate::SPARSE_BOUNDARY_VISITS.with(|count| count.set(count.get() + 1));
            builder.visit(cluster, group_end, safe)?;
            previous_cluster = Some(cluster);
            glyph = group_start;
        }
    } else {
        let mut glyph = glyph_start;
        while glyph < glyph_end {
            let group_start = glyph;
            let cluster = shape.clusters[glyph];
            let mut group_end = glyph + 1;
            let mut safe = shape.glyph_flags[glyph] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            while group_end < glyph_end && shape.clusters[group_end] == cluster {
                safe &= shape.glyph_flags[group_end] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
                group_end += 1;
            }
            if cluster < source_run.text_start
                || cluster >= source_run.text_end
                || previous_cluster.is_some_and(|previous| cluster < previous)
            {
                windows.clear();
                return Ok(false);
            }
            #[cfg(test)]
            crate::SPARSE_BOUNDARY_VISITS.with(|count| count.set(count.get() + 1));
            builder.visit(cluster, group_start, safe)?;
            previous_cluster = Some(cluster);
            glyph = group_end;
        }
    }
    let run_end_boundary = if rtl { glyph_start } else { glyph_end };
    builder.visit(source_run.text_end, run_end_boundary, true)?;
    if builder.next_edit != edits.len() {
        windows.clear();
        return Ok(false);
    }
    if let Some(window) = windows.last_mut()
        && window.probe_end == 0
    {
        window.probe_end = source_run.text_end;
    }
    Ok(!windows.is_empty())
}

struct SparseWindowBuilder<'a> {
    edits: &'a [TextEdit],
    next_edit: usize,
    previous_safe: (u32, usize),
    window_start: (u32, usize),
    rtl: bool,
    windows: &'a mut Vec<ShapeWindow>,
}

impl SparseWindowBuilder<'_> {
    fn visit(
        &mut self,
        boundary: u32,
        glyph_boundary: usize,
        safe: bool,
    ) -> Result<(), EngineError> {
        if let Some(window) = self.windows.last_mut()
            && window.probe_end == 0
            && boundary > window.new_end
        {
            window.probe_end = boundary;
        }
        if !safe {
            return Ok(());
        }
        while let Some(edit) = self.edits.get(self.next_edit).copied() {
            let edit_start =
                u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            let edit_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
            if boundary <= edit_start {
                self.window_start = (boundary, glyph_boundary);
                break;
            }
            if boundary < edit_end {
                break;
            }
            self.push_window(boundary, glyph_boundary)?;
            self.next_edit += 1;
            let Some(next) = self.edits.get(self.next_edit) else {
                break;
            };
            let next_start =
                u32::try_from(next.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            if boundary <= next_start {
                self.window_start = (boundary, glyph_boundary);
                break;
            }
            self.window_start = self.previous_safe;
        }
        self.previous_safe = (boundary, glyph_boundary);
        Ok(())
    }

    fn push_window(&mut self, end: u32, end_glyph: usize) -> Result<(), EngineError> {
        let (start, start_glyph) = self.window_start;
        if start >= end {
            return Err(EngineError::InvalidRequest);
        }
        let (old_glyph_start, old_glyph_end) = if self.rtl {
            (end_glyph, start_glyph)
        } else {
            (start_glyph, end_glyph)
        };
        if old_glyph_start > old_glyph_end {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(previous) = self.windows.last_mut()
            && start <= previous.old_end
        {
            previous.old_end = previous.old_end.max(end);
            previous.new_end = previous.new_end.max(end);
            previous.old_glyph_start = previous.old_glyph_start.min(old_glyph_start);
            previous.old_glyph_end = previous.old_glyph_end.max(old_glyph_end);
            previous.probe_end = 0;
            return Ok(());
        }
        self.windows
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.windows.push(ShapeWindow {
            old_start: start,
            old_end: end,
            new_start: start,
            new_end: end,
            probe_end: 0,
            old_glyph_start,
            old_glyph_end,
        });
        Ok(())
    }
}

fn set_whole_shape_window(
    windows: &mut Vec<ShapeWindow>,
    shaped_run: ShapedRun,
    old_run: ShapingRun,
    new_run: ShapingRun,
) -> Result<(), EngineError> {
    let old_glyph_start =
        usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let old_glyph_end = old_glyph_start
        .checked_add(
            usize::try_from(shaped_run.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?;
    windows.clear();
    windows
        .try_reserve(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    windows.push(ShapeWindow {
        old_start: old_run.text_start,
        old_end: old_run.text_end,
        new_start: new_run.text_start,
        new_end: new_run.text_end,
        probe_end: new_run.text_end,
        old_glyph_start,
        old_glyph_end,
    });
    Ok(())
}

fn shaped_run_glyph_range(
    shape: &ShapeArena,
    shaped_run: ShapedRun,
) -> Result<(usize, usize), EngineError> {
    let start = usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(
            usize::try_from(shaped_run.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?;
    if end > shape.glyph_ids.len() || end > shape.clusters.len() || end > shape.glyph_flags.len() {
        return Err(EngineError::InvalidRequest);
    }
    Ok((start, end))
}

fn sparse_shape_boundaries_are_safe(
    shape: &ShapeArena,
    window: ShapeWindow,
    run_start: u32,
    run_end: u32,
) -> bool {
    (window.new_start == run_start || concat_boundary_is_safe(shape, window.new_start))
        && (window.new_end == run_end || concat_boundary_is_safe(shape, window.new_end))
}

fn concat_boundary_is_safe(shape: &ShapeArena, boundary: u32) -> bool {
    let mut found = false;
    for (cluster, flags) in shape.clusters.iter().zip(&shape.glyph_flags) {
        if *cluster == boundary {
            found = true;
            if flags & GLYPH_FLAG_UNSAFE_TO_CONCAT != 0 {
                return false;
            }
        }
    }
    found
}

#[derive(Clone, Copy)]
enum TextReconciliation {
    SameLength { start: usize, end: usize },
    FullReplacement,
}

fn text_reconciliation(
    mutations: super::semantic_wire::TextMutationBatch<'_>,
    committed_len: usize,
) -> Option<TextReconciliation> {
    if mutations.len() != 1 {
        return None;
    }
    let mutation = mutations.get(0)?;
    let start = usize::try_from(mutation.text_start).ok()?;
    let delete_count = usize::try_from(mutation.delete_count).ok()?;
    if !mutation.insert_utf16_le.len().is_multiple_of(2) {
        return None;
    }
    let insert_count = mutation.insert_utf16_le.len() / 2;
    if delete_count == insert_count {
        return start
            .checked_add(delete_count)
            .map(|end| TextReconciliation::SameLength { start, end });
    }
    (start == 0 && delete_count == committed_len).then_some(TextReconciliation::FullReplacement)
}

fn collect_text_edits(
    committed: &[u16],
    pending: &[u16],
    reconciliation: TextReconciliation,
    edits: &mut Vec<TextEdit>,
    append_start: usize,
) -> Result<(), EngineError> {
    if append_start > edits.len() {
        return Err(EngineError::InvalidRequest);
    }
    match reconciliation {
        TextReconciliation::SameLength { start, end } => {
            for_each_changed_utf16_unit(
                &committed[start..end],
                &pending[start..end],
                |relative_offset| {
                    let offset = start + relative_offset;
                    if let Some(last_index) = edits.len().checked_sub(1)
                        && last_index >= append_start
                        && edits[last_index].old_end == offset
                    {
                        let edit = &mut edits[last_index];
                        edit.old_end += 1;
                        edit.new_end += 1;
                        return Ok(());
                    }
                    edits
                        .try_reserve(1)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    edits.push(TextEdit {
                        old_start: offset,
                        old_end: offset + 1,
                        new_start: offset,
                        new_end: offset + 1,
                    });
                    Ok(())
                },
            )?;
            align_same_length_edits_to_utf16_scalars(committed, pending, edits, append_start);
        }
        TextReconciliation::FullReplacement => {
            let mut start = packed_common_utf16_prefix(committed, pending);
            while start > 0
                && (!valid_utf16_boundary(committed, u32::try_from(start).unwrap_or(u32::MAX))
                    || !valid_utf16_boundary(pending, u32::try_from(start).unwrap_or(u32::MAX)))
            {
                start -= 1;
            }
            let suffix = packed_common_utf16_suffix(&committed[start..], &pending[start..]);
            let mut old_end = committed.len() - suffix;
            let mut new_end = pending.len() - suffix;
            while old_end < committed.len()
                && new_end < pending.len()
                && (!valid_utf16_boundary(committed, u32::try_from(old_end).unwrap_or(u32::MAX))
                    || !valid_utf16_boundary(pending, u32::try_from(new_end).unwrap_or(u32::MAX)))
            {
                old_end += 1;
                new_end += 1;
            }
            if start != old_end || start != new_end {
                edits
                    .try_reserve(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                edits.push(TextEdit {
                    old_start: start,
                    old_end,
                    new_start: start,
                    new_end,
                });
            }
        }
    }
    Ok(())
}

fn align_same_length_edits_to_utf16_scalars(
    old: &[u16],
    new: &[u16],
    edits: &mut Vec<TextEdit>,
    start: usize,
) {
    let mut written = start;
    for read in start..edits.len() {
        let mut edit = edits[read];
        while edit.old_start > 0
            && (!valid_utf16_boundary(old, u32::try_from(edit.old_start).unwrap_or(u32::MAX))
                || !valid_utf16_boundary(new, u32::try_from(edit.new_start).unwrap_or(u32::MAX)))
        {
            edit.old_start -= 1;
            edit.new_start -= 1;
        }
        while edit.old_end < old.len()
            && (!valid_utf16_boundary(old, u32::try_from(edit.old_end).unwrap_or(u32::MAX))
                || !valid_utf16_boundary(new, u32::try_from(edit.new_end).unwrap_or(u32::MAX)))
        {
            edit.old_end += 1;
            edit.new_end += 1;
        }
        if written > start && edits[written - 1].old_end >= edit.old_start {
            let previous = &mut edits[written - 1];
            previous.old_end = previous.old_end.max(edit.old_end);
            previous.new_end = previous.new_end.max(edit.new_end);
        } else {
            edits[written] = edit;
            written += 1;
        }
    }
    edits.truncate(written);
}

fn reconcile_text_identities(
    committed: &TextStage,
    pending: &mut TextStage,
    edits: &[TextEdit],
    reconciliation: Option<TextReconciliation>,
) -> Result<(), EngineError> {
    let expected_pending_ids =
        if matches!(reconciliation, Some(TextReconciliation::FullReplacement)) {
            committed.units.len()
        } else {
            pending.units.len()
        };
    if pending.unit_ids.len() != expected_pending_ids {
        return Err(EngineError::InvalidRequest);
    }
    match reconciliation {
        Some(TextReconciliation::SameLength { .. }) => {
            for edit in edits {
                let identities = pending
                    .unit_ids
                    .get_mut(edit.new_start..edit.new_end)
                    .ok_or(EngineError::InvalidRequest)?;
                for identity in identities {
                    *identity = take_next_unit_identity(&mut pending.next_unit_id)?;
                }
            }
        }
        Some(TextReconciliation::FullReplacement) => {
            if let Some(edit) = edits.first().copied() {
                apply_text_identity_edit(
                    &mut pending.unit_ids,
                    &mut pending.next_unit_id,
                    edit.new_start,
                    edit.old_end - edit.old_start,
                    edit.new_end - edit.new_start,
                )?;
            }
        }
        None => (),
    }
    if pending.unit_ids.len() != pending.units.len() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

fn packed_common_utf16_prefix(left: &[u16], right: &[u16]) -> usize {
    let shared = left.len().min(right.len());
    let paired = shared & !1;
    let mut offset = 0usize;
    while offset < paired {
        let left_word = u32::from(left[offset]) | (u32::from(left[offset + 1]) << 16);
        let right_word = u32::from(right[offset]) | (u32::from(right[offset + 1]) << 16);
        if left_word != right_word {
            return offset + usize::from(left[offset] == right[offset]);
        }
        offset += 2;
    }
    offset + usize::from(offset < shared && left[offset] == right[offset])
}

fn packed_common_utf16_suffix(left: &[u16], right: &[u16]) -> usize {
    let shared = left.len().min(right.len());
    let paired = shared & !1;
    let mut suffix = 0usize;
    while suffix < paired {
        let left_at = left.len() - suffix - 2;
        let right_at = right.len() - suffix - 2;
        let left_word = u32::from(left[left_at]) | (u32::from(left[left_at + 1]) << 16);
        let right_word = u32::from(right[right_at]) | (u32::from(right[right_at + 1]) << 16);
        if left_word != right_word {
            return suffix + usize::from(left[left_at + 1] == right[right_at + 1]);
        }
        suffix += 2;
    }
    suffix
        + usize::from(
            suffix < shared && left[left.len() - suffix - 1] == right[right.len() - suffix - 1],
        )
}

fn for_each_changed_utf16_unit(
    accepted: &[u16],
    candidate: &[u16],
    mut changed: impl FnMut(usize) -> Result<(), EngineError>,
) -> Result<(), EngineError> {
    if accepted.len() != candidate.len() {
        return Err(EngineError::InvalidRequest);
    }
    let paired_len = accepted.len() & !1;
    let mut offset = 0usize;
    while offset < paired_len {
        let accepted_word = u32::from(accepted[offset]) | (u32::from(accepted[offset + 1]) << 16);
        let candidate_word =
            u32::from(candidate[offset]) | (u32::from(candidate[offset + 1]) << 16);
        let different_lanes = accepted_word ^ candidate_word;
        if different_lanes & 0xffff != 0 {
            changed(offset)?;
        }
        if different_lanes >> 16 != 0 {
            changed(offset + 1)?;
        }
        offset += 2;
    }
    if paired_len != accepted.len() && accepted[paired_len] != candidate[paired_len] {
        changed(paired_len)?;
    }
    Ok(())
}

fn take_next_unit_identity(next_identity: &mut u32) -> Result<u32, EngineError> {
    let identity = *next_identity;
    if identity == 0 {
        return Err(EngineError::RevisionExhausted);
    }
    *next_identity = next_identity
        .checked_add(1)
        .ok_or(EngineError::RevisionExhausted)?;
    Ok(identity)
}

fn apply_text_identity_mutation(
    identities: &mut Vec<u32>,
    next_identity: &mut u32,
    mutation: super::semantic_wire::TextMutation<'_>,
) -> Result<(), EngineError> {
    let start = usize::try_from(mutation.text_start).map_err(|_| EngineError::InvalidRequest)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| EngineError::InvalidRequest)?;
    let insert_count = mutation.insert_utf16_le.len() / 2;
    apply_text_identity_edit(identities, next_identity, start, delete_count, insert_count)
}

fn apply_text_identity_edit(
    identities: &mut Vec<u32>,
    next_identity: &mut u32,
    start: usize,
    delete_count: usize,
    insert_count: usize,
) -> Result<(), EngineError> {
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(EngineError::InvalidRequest)?;
    let old_len = identities.len();
    let new_len = old_len
        .checked_sub(delete_count)
        .and_then(|length| length.checked_add(insert_count))
        .ok_or(EngineError::InvalidRequest)?;
    if delete_end > old_len {
        return Err(EngineError::InvalidRequest);
    }
    if new_len > old_len {
        identities
            .try_reserve(new_len - old_len)
            .map_err(|_| EngineError::ResultTooLarge)?;
        identities.resize(new_len, 0);
    }
    identities.copy_within(delete_end..old_len, start + insert_count);
    if new_len < old_len {
        identities.truncate(new_len);
    }
    for identity in &mut identities[start..start + insert_count] {
        *identity = take_next_unit_identity(next_identity)?;
    }
    Ok(())
}

fn reserve_text_buffer(text: &mut Vec<u16>, capacity: usize) -> Result<(), EngineError> {
    if text.capacity() < capacity {
        text.try_reserve_exact(capacity.saturating_sub(text.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

fn unicode_error(error: UnicodeError) -> EngineError {
    match error {
        UnicodeError::InvalidUtf16 => EngineError::InvalidRequest,
        UnicodeError::ResultTooLarge => EngineError::ResultTooLarge,
    }
}

fn same_shaping_properties(left: ShapingRun, right: ShapingRun) -> bool {
    left.script == right.script
        && left.direction == right.direction
        && left.bidi_level == right.bidi_level
        && left.style.same_layout_sources(right.style)
}

fn containing_run(runs: &[ShapingRun], start: usize, end: usize) -> Option<usize> {
    let start = u32::try_from(start).ok()?;
    let end = u32::try_from(end).ok()?;
    runs.iter().position(|run| {
        run.text_start <= start && end <= run.text_end && run.text_start < run.text_end
    })
}

fn edit_delta(edit: TextEdit) -> Result<i64, EngineError> {
    i64::try_from(edit.new_end)
        .and_then(|new_end| i64::try_from(edit.old_end).map(|old_end| new_end - old_end))
        .map_err(|_| EngineError::ResultTooLarge)
}

fn map_old_offset(offset: u32, edit: TextEdit) -> Result<u32, EngineError> {
    let old_start = u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
    let old_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
    if offset <= old_start {
        Ok(offset)
    } else if offset >= old_end {
        shifted_text_offset(offset, edit_delta(edit)?)
    } else {
        Err(EngineError::InvalidRequest)
    }
}

fn same_edit_run_topology(
    old_runs: &[ShapingRun],
    new_runs: &[ShapingRun],
    edit: TextEdit,
    affected: usize,
    styles: Option<(&StyleArena, &StyleArena)>,
) -> Result<bool, EngineError> {
    for (index, (&old, &new)) in old_runs.iter().zip(new_runs).enumerate() {
        if !same_shaping_properties(old, new)
            || styles.is_some_and(|(previous, next)| {
                previous.resolved_language(old.style) != next.resolved_language(new.style)
                    || previous.resolved_features(old.style) != next.resolved_features(new.style)
            })
        {
            return Ok(false);
        }
        let expected_start = map_old_offset(old.text_start, edit);
        let expected_end = map_old_offset(old.text_end, edit);
        if index == affected {
            let delta = edit_delta(edit)?;
            let old_start =
                u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            let old_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
            let start = if old.text_start <= old_start {
                old.text_start
            } else {
                shifted_text_offset(old.text_start, delta)?
            };
            let end = if old.text_end >= old_end {
                shifted_text_offset(old.text_end, delta)?
            } else {
                old.text_end
            };
            if new.text_start != start || new.text_end != end {
                return Ok(false);
            }
        } else if expected_start.ok() != Some(new.text_start)
            || expected_end.ok() != Some(new.text_end)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn shifted_text_offset(value: u32, delta: i64) -> Result<u32, EngineError> {
    let shifted = i64::from(value)
        .checked_add(delta)
        .ok_or(EngineError::ResultTooLarge)?;
    u32::try_from(shifted).map_err(|_| EngineError::ResultTooLarge)
}

fn bidi_error(error: BidiError) -> EngineError {
    match error {
        BidiError::InvalidDirection => EngineError::InvalidRequest,
        BidiError::ResultTooLarge => EngineError::ResultTooLarge,
    }
}

fn shaper_error(status: u32) -> EngineError {
    if status == STATUS_RESULT_TOO_LARGE {
        EngineError::ResultTooLarge
    } else {
        EngineError::InvalidRequest
    }
}

fn find_font_stack(
    font_stacks: &[RegisteredFontStack],
    handle: u32,
) -> Result<&RegisteredFontStack, EngineError> {
    font_stacks
        .binary_search_by_key(&handle, |stack| stack.handle)
        .ok()
        .and_then(|index| font_stacks.get(index))
        .ok_or(EngineError::FontStackMissing)
}

fn find_font_binding(
    font_bindings: &[RegisteredFontBinding],
    handle: u32,
) -> Result<&RegisteredFontBinding, EngineError> {
    font_bindings
        .iter()
        .find(|binding| binding.handle == handle)
        .ok_or(EngineError::FontStackMissing)
}

#[allow(clippy::too_many_arguments)]
fn prepare_boundary_candidate(
    shaper: &mut ShaperRegistry,
    text: &[u16],
    ellipsis_text: &mut Vec<u16>,
    source_shape: &mut ShapeArena,
    ellipsis_shape: &mut ShapeArena,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &StyleArena,
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    line_cluster_start: usize,
    line_text_start: u32,
    cluster_end: usize,
    text_end: u32,
) -> Result<BoundaryCandidate, EngineError> {
    let anchor = cluster_end
        .checked_sub(1)
        .filter(|index| *index >= line_cluster_start)
        .or_else(|| (cluster_end < clusters.starts.len()).then_some(cluster_end))
        .ok_or(EngineError::InvalidRequest)?;
    let source_run = usize::try_from(
        *clusters
            .source_runs
            .get(anchor)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let run = *runs.get(source_run).ok_or(EngineError::InvalidRequest)?;
    let source_binding_handle = *clusters
        .binding_handles
        .get(anchor)
        .ok_or(EngineError::InvalidRequest)?;
    let source_font_handle = *clusters
        .font_handles
        .get(anchor)
        .ok_or(EngineError::InvalidRequest)?;
    if source_binding_handle == 0 || source_font_handle == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let mut cluster_start = cluster_end;
    while cluster_start > line_cluster_start {
        let previous = cluster_start - 1;
        if clusters.source_runs.get(previous) != Some(&(source_run as u32))
            || clusters.binding_handles.get(previous) != Some(&source_binding_handle)
            || clusters.font_handles.get(previous) != Some(&source_font_handle)
        {
            break;
        }
        cluster_start = previous;
    }

    source_shape.clear();
    let mut source_advance = 0.0;
    if cluster_start < cluster_end {
        let item_start = *clusters
            .starts
            .get(cluster_start)
            .ok_or(EngineError::InvalidRequest)?;
        shaper
            .with_shaped_range(
                source_font_handle,
                text,
                ShapeRunRef {
                    text_start: run.text_start,
                    text_end: run.text_end,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                ShapeRangeRef {
                    item_start,
                    item_end: text_end,
                    context_start: line_text_start.max(run.text_start).min(item_start),
                    context_end: text_end,
                    flags: 0x40 | 0x02 | u32::from(item_start == line_text_start),
                },
                |shaped| {
                    source_shape.append(
                        source_run,
                        source_font_handle,
                        source_binding_handle,
                        item_start,
                        text_end,
                        shaped,
                    )
                },
            )
            .map_err(shaper_error)?;
        let metrics = shaper
            .font_metrics(source_font_handle)
            .ok_or(EngineError::InvalidRequest)?;
        if metrics.units_per_em == 0 {
            return Err(EngineError::InvalidRequest);
        }
        let scale = f64::from(run.style.font_size) / f64::from(metrics.units_per_em);
        source_advance = source_shape
            .x_advances
            .iter()
            .try_fold(0.0, |advance, value| {
                let next = advance + f64::from(value.unsigned_abs()) * scale;
                next.is_finite()
                    .then_some(next)
                    .ok_or(EngineError::InvalidRequest)
            })?;
        for cluster in cluster_start..cluster_end {
            source_advance += f64::from(run.style.letter_spacing);
            if clusters
                .starts
                .get(cluster)
                .and_then(|start| usize::try_from(*start).ok())
                .and_then(|start| text.get(start))
                == Some(&0x20)
            {
                source_advance += f64::from(run.style.word_spacing);
            }
        }
    }

    ellipsis_text.clear();
    ellipsis_text.push(0x2026);
    let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
    let mut selected = None;
    for (font_index, binding_handle) in stack.fonts.iter().copied().enumerate() {
        let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
        ellipsis_shape.clear();
        let missing = shaper
            .with_shaped_run(
                font_handle,
                ellipsis_text,
                ShapeRunRef {
                    text_start: 0,
                    text_end: 1,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: &[],
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                |shaped| {
                    let missing = shaped.glyph_infos().iter().any(|info| info.glyph_id == 0);
                    ellipsis_shape.append(source_run, font_handle, binding_handle, 0, 1, shaped)?;
                    Ok(missing)
                },
            )
            .map_err(shaper_error)?;
        if !missing || font_index + 1 == stack.fonts.len() {
            selected = Some((binding_handle, font_handle));
            break;
        }
    }
    let (ellipsis_binding_handle, ellipsis_font_handle) =
        selected.ok_or(EngineError::FontStackMissing)?;
    let metrics = shaper
        .font_metrics(ellipsis_font_handle)
        .ok_or(EngineError::InvalidRequest)?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let scale = f64::from(run.style.font_size) / f64::from(metrics.units_per_em);
    let ellipsis_advance = ellipsis_shape
        .x_advances
        .iter()
        .try_fold(0.0, |advance, value| {
            let next = advance + f64::from(value.unsigned_abs()) * scale;
            next.is_finite()
                .then_some(next)
                .ok_or(EngineError::InvalidRequest)
        })?;
    Ok(BoundaryCandidate {
        source_run,
        cluster_start,
        source_binding_handle,
        source_font_handle,
        ellipsis_binding_handle,
        ellipsis_font_handle,
        source_advance,
        ellipsis_advance,
    })
}

pub(super) struct ShapedBreakCorrections<'a, 'b> {
    shaper: &'a RefCell<&'b mut ShaperRegistry>,
    text: &'a [u16],
    runs: &'a [ShapingRun],
    styles: &'a StyleArena,
    clusters: &'a ClusterArena,
}

impl ShapedBreakCorrections<'_, '_> {
    /// The correction on `side` (0 = L, 1 = R) of `boundary`, zero unless it needs one, priced on first use.
    /// An island too long to reshape is never corrected, as on main.
    fn correction(&mut self, boundary: usize, side: usize) -> Result<Correction, EngineError> {
        const CORRECTED: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        let c = self.clusters;
        if boundary == 0 || c.flags[boundary - 1] & CORRECTED != CORRECTED {
            return Ok(Correction::ZERO);
        }
        let slots = &c.break_corrections[boundary - 1];
        if let Some(correction) = slots[side].get() {
            return Ok(correction);
        }
        let Some((start, end)) = c.reshapable_island(boundary) else {
            // Too long to reshape: uncorrected, and refused as a break.
            slots[2].set(Some(Correction::ZERO));
            return Ok(Correction::ZERO);
        };
        let range = if side == 0 {
            (start, boundary)
        } else {
            (boundary, end)
        };
        let (correction, drawn_alone) =
            self.delta(range, (side != 0, side == 0), Some((boundary, side)))?;
        slots[side].set(Some(correction));
        if side == 0 && !drawn_alone {
            slots[2].set(Some(Correction::ZERO));
        }
        Ok(correction)
    }

    /// Shapes clusters `[start, end)` and hands the glyphs to `consume`. `lead`/`trail` say the
    /// range begins/ends its line; any other edge shapes with [`SHAPING_CONTEXT`] clusters of context.
    fn shape_range(
        &mut self,
        (start, end): (usize, usize),
        (lead, trail): (bool, bool),
        consume: &mut dyn FnMut(&harfrust::GlyphBuffer) -> Result<(), u32>,
    ) -> Result<(), EngineError> {
        let c = self.clusters;
        let run = self.runs[c.source_runs[start] as usize];
        let (item_start, item_end) = (c.starts[start], c.ends[end - 1]);
        let before = c.starts[start.saturating_sub(SHAPING_CONTEXT)].max(run.text_start);
        let after = c.ends[(end + SHAPING_CONTEXT).min(c.starts.len()) - 1].min(run.text_end);
        self.shaper
            .borrow_mut()
            .with_shaped_range(
                c.font_handles[start],
                self.text,
                ShapeRunRef {
                    text_start: run.text_start,
                    text_end: run.text_end,
                    script: run.script,
                    language: self.styles.resolved_language(run.style),
                    features: self.styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                ShapeRangeRef {
                    item_start,
                    item_end,
                    context_start: if lead { item_start } else { before },
                    context_end: if trail { item_end } else { after },
                    flags: 0x40
                        | u32::from(lead || start == 0)
                        | (u32::from(trail || end == c.starts.len()) << 1),
                },
                consume,
            )
            .map_err(shaper_error)
    }

    /// Hands `consume` the arena and run holding clusters `[start, end)` shaped alone with `edges`. A corrected
    /// boundary's own island, `slot` = (boundary, side), is shaped once per cluster build and kept, so the fitter
    /// that prices it and every line edge that draws it, on any relayout, share one shaping.
    fn with_island(
        &mut self,
        (start, end): (usize, usize),
        edges: (bool, bool),
        slot: Option<(usize, usize)>,
        consume: &mut dyn FnMut(&ShapeArena, usize) -> Result<(), EngineError>,
    ) -> Result<(), EngineError> {
        let c = self.clusters;
        let mut islands = c.islands.borrow_mut();
        let islands = &mut *islands;
        let kept =
            slot.and_then(|(boundary, side)| islands.slots.get(boundary - 1)?[side].checked_sub(1));
        if let Some(run) = kept {
            return consume(&islands.shape, run as usize);
        }
        let arena = if slot.is_some() {
            &mut islands.shape
        } else {
            islands.once.clear();
            &mut islands.once
        };
        let run = arena.runs.len();
        let (source_run, binding, font) = (
            c.source_runs[start],
            c.binding_handles[start],
            c.font_handles[start],
        );
        self.shape_range((start, end), edges, &mut |shaped| {
            arena.append(
                source_run as usize,
                font,
                binding,
                c.starts[start],
                c.ends[end - 1],
                shaped,
            )
        })?;
        if let Some((boundary, side)) = slot {
            islands.slots.resize(c.starts.len(), [0; 2]);
            islands.slots[boundary - 1][side] =
                u32::try_from(run + 1).map_err(|_| EngineError::ResultTooLarge)?;
        }
        consume(arena, run)
    }

    /// The records shaping the islands a corrected line opens and closes (`NO_BOUNDARY` when that edge is
    /// uncorrected), alone as [`Self::delta`] priced them, so the line draws what it would shaped by itself.
    /// As Chromium reshapes line ends, a space ending the line leaves its end as is, and islands that meet
    /// shape the whole line once. An ellipsis keeps only the clusters before its cut.
    fn line_edge_records(
        &mut self,
        fragment: FlowFragment,
        flow_thread_id: u32,
        (out, previous): (&mut BoundaryShapeArena, &[EdgeId]),
        next_glyph_id: &mut u32,
    ) -> Result<(u32, u32), EngineError> {
        const CORRECTED: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        let c = self.clusters;
        let index =
            |cluster: u32| usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest);
        let (line_start, line_end) = (
            index(fragment.line.cluster_start)?,
            index(fragment.line.cluster_end)?,
        );
        // The island a line edge at `boundary` reshapes, when that boundary is a corrected break.
        let island = |boundary: usize| {
            let corrected = boundary > 0 && c.flags[boundary - 1] & CORRECTED == CORRECTED;
            corrected.then(|| c.reshapable_island(boundary)).flatten()
        };
        if line_start >= c.starts.len() {
            return Ok((NO_BOUNDARY, NO_BOUNDARY));
        }
        let cut = out.record(fragment.boundary_index);
        let island_end = island(line_start).map(|(_, end)| end);
        // As Chromium reshapes line ends, a space ends the line as is.
        let tail_island = island(line_end)
            .filter(|_| c.flags[line_end - 1] & CLUSTER_SPACE == 0 && cut.is_none());
        let tail_start = tail_island.map(|(start, _)| start.max(line_start));
        let whole = island_end
            .zip(tail_start)
            .is_some_and(|(lead, tail)| lead > tail);
        // Each edge: its clusters, how it shapes, and the boundary side whose island it is exactly, which that
        // boundary's pricing already shaped.
        let lead = match island_end {
            Some(island_end) => {
                let cut_end = cut.map_or(Ok(line_end), |cut| index(cut.cluster_start))?;
                let end = if whole {
                    line_end
                } else {
                    island_end.min(cut_end)
                };
                let edges = (true, whole || end < island_end);
                Some((
                    (line_start, end),
                    edges,
                    (!edges.1).then_some((line_start, 1)),
                ))
            }
            None => None,
        };
        let tail = tail_start.filter(|_| !whole).map(|start| {
            let exact = tail_island.is_some_and(|(first, _)| first == start);
            (
                (start, line_end),
                (false, true),
                exact.then_some((line_end, 0)),
            )
        });
        let mut record = |edge: Option<LineEdge>| {
            let Some(((start, end), edges, slot)) = edge.filter(|edge| edge.0.0 < edge.0.1) else {
                return Ok(NO_BOUNDARY);
            };
            let (source_run, binding, font) = (
                c.source_runs[start],
                c.binding_handles[start],
                c.font_handles[start],
            );
            let text_end = c.ends[end - 1];
            let mut glyphs = (0, 0);
            self.with_island((start, end), edges, slot, &mut |shaped, run| {
                glyphs = out.shape.append_from(shaped, run)?;
                let run = shaped.runs[run];
                let range = run.glyph_start as usize..(run.glyph_start + run.glyph_count) as usize;
                append_boundary_source_ids(
                    &mut out.stable_ids,
                    &shaped.clusters[range],
                    (c, previous),
                    next_glyph_id,
                )
            })?;
            let (glyph_start, glyph_count) = glyphs;
            let record =
                u32::try_from(out.records.len()).map_err(|_| EngineError::ResultTooLarge)?;
            out.records.push(BoundaryShape {
                flow_thread_id,
                source_run,
                cluster_start: u32::try_from(start).map_err(|_| EngineError::ResultTooLarge)?,
                cluster_end: u32::try_from(end).map_err(|_| EngineError::ResultTooLarge)?,
                text_end,
                source_binding_handle: binding,
                source_font_handle: font,
                ellipsis_binding_handle: binding,
                ellipsis_font_handle: font,
                source_glyph_start: glyph_start,
                source_glyph_count: glyph_count,
                ellipsis_glyph_start: glyph_start + glyph_count,
                ellipsis_glyph_count: 0,
                line_start: true,
            });
            Ok::<_, EngineError>(record)
        };
        Ok((record(lead)?, record(tail)?))
    }

    /// How far reshaping clusters `[start, end)` moves their base sums, and whether the paragraph's glyphs
    /// there are the ones it draws.
    fn delta(
        &mut self,
        (start, end): (usize, usize),
        edges: (bool, bool),
        slot: Option<(usize, usize)>,
    ) -> Result<(Correction, bool), EngineError> {
        let trail = edges.1;
        let c = self.clusters;
        let style = self.runs[c.source_runs[start] as usize].style;
        let scale = f64::from(style.font_size) / c.units_per_em[start];
        let paragraph = &c.glyph_ids[c.glyph_starts[start] as usize
            ..(c.glyph_starts[end - 1] + c.glyph_counts[end - 1]) as usize];
        // Spacing first, then glyphs in order, as the arena sums: unchanged shapes correct by zero.
        let mut advances: Vec<f64> = (start..end)
            .map(|i| {
                let space = c.flags[i] & CLUSTER_SPACE != 0;
                f64::from(style.letter_spacing + if space { style.word_spacing } else { 0.0 })
            })
            .collect();
        let mut same = true;
        self.with_island((start, end), edges, slot, &mut |shaped, run| {
            let run = shaped.runs[run];
            let glyphs = run.glyph_start as usize..(run.glyph_start + run.glyph_count) as usize;
            let ids = &shaped.glyph_ids[glyphs.clone()];
            same = same_glyphs(ids.iter().map(|id| u32::from(*id)), paragraph);
            for (cluster, advance) in shaped.clusters[glyphs.clone()]
                .iter()
                .zip(&shaped.x_advances[glyphs])
            {
                let owner = c.starts.partition_point(|s| *s <= *cluster) - 1;
                advances[owner - start] += f64::from(advance.unsigned_abs()) * scale;
            }
            Ok(())
        })?;
        // Terminating spaces hang, laid at base width until shaping substitutes glyphs: skipped.
        let (mut advance, mut space, mut hung) = (0_i64, 0_i64, trail);
        for (i, shaped) in (start..end).zip(&advances).rev() {
            let is_space = c.flags[i] & CLUSTER_SPACE != 0;
            hung &= is_space;
            let change =
                super::layout_units::layout_units_from_scaled(*shaped) - c.advance_units[i];
            advance += change * i64::from(!hung);
            space += change * i64::from(!hung && is_space);
        }
        let unit = |value: i64| i32::try_from(value).map_err(|_| EngineError::ResultTooLarge);
        let correction = Correction {
            advance: unit(advance)?,
            space: unit(space)?,
            trailing: 0,
        };
        Ok((correction, same))
    }
}

impl BreakCorrections for ShapedBreakCorrections<'_, '_> {
    fn left(&mut self, boundary: usize) -> Result<Correction, EngineError> {
        self.correction(boundary, 0)
    }

    fn right(&mut self, boundary: usize) -> Result<Correction, EngineError> {
        self.correction(boundary, 1)
    }

    fn whole_line(&mut self, start: usize, end: usize) -> Result<Option<Correction>, EngineError> {
        let c = self.clusters;
        let tail = if end < c.starts.len() {
            c.reshapable_island(end)
        } else {
            Some((end, end))
        };
        // Only islands that meet, and each short enough to reshape.
        match (c.reshapable_island(start), tail) {
            (Some(head), Some(tail)) if head.1 > tail.0 => self
                .delta((start, end), (true, true), None)
                .map(|(whole, _)| Some(whole)),
            _ => Ok(None),
        }
    }

    /// A corrected break not after a space that the font shapes as one unit, or whose island is too long to
    /// tell: `left` found the paragraph's glyphs there differ from those the island draws as a line end.
    fn refused(&self, boundary: usize) -> bool {
        let c = self.clusters;
        c.flags[boundary - 1] & CLUSTER_SPACE == 0
            && c.break_corrections[boundary - 1][2].get().is_some()
    }
}

/// Whether the glyphs `alone` draws are the `paragraph` ones, in order: a ligature or a contextual form
/// changes the ids, and a reorder or a repeat changes the sequence while keeping every id present.
fn same_glyphs(alone: impl ExactSizeIterator<Item = u32>, paragraph: &[u16]) -> bool {
    alone.len() == paragraph.len()
        && alone
            .zip(paragraph)
            .all(|(id, &drawn)| id == u32::from(drawn))
}

/// Gives every fragment of `flow` the records shaping its corrected line start and end alone (or none),
/// so the ordinary and the intrinsic flow draw the same edge glyphs.
fn attach_line_edges(
    corrections: &mut ShapedBreakCorrections<'_, '_>,
    geometry: &FlowGeometryArena,
    flow: &mut FlowLayoutArena,
    out: (&mut BoundaryShapeArena, &[EdgeId]),
    next_glyph_id: &mut u32,
) -> Result<(), EngineError> {
    let (out, previous) = out;
    // A paragraph with no correctable boundary has no edge to shape.
    let corrected = !corrections.clusters.break_corrections.is_empty();
    let mut fragment_lines = flow
        .lines
        .iter()
        .copied()
        .flat_map(|line| core::iter::repeat_n(line, usize::from(line.fragment_count)));
    let fragment_count = flow.fragments.len();
    flow.fragments
        .update_ordered(0..fragment_count, |_, current| {
            let line = fragment_lines.next().ok_or(EngineError::InvalidRequest)?;
            let words = corrected
                && geometry.constraints.iter().any(|constraint| {
                    constraint.flow_thread_id == line.flow_thread_id && constraint.wrap == WRAP_WORD
                });
            let edges = if words {
                corrections.line_edge_records(
                    *current,
                    line.flow_thread_id,
                    (out, previous),
                    next_glyph_id,
                )?
            } else {
                (NO_BOUNDARY, NO_BOUNDARY)
            };
            if (current.lead_index, current.tail_index) == edges {
                return Ok(super::retained_rope::RopeUpdate::Keep);
            }
            let mut replacement = *current;
            (replacement.lead_index, replacement.tail_index) = edges;
            Ok(super::retained_rope::RopeUpdate::Replace(replacement))
        })
        .map_err(|error| match error {
            RopeEditError::Storage => EngineError::ResultTooLarge,
            RopeEditError::Callback(error) => error,
        })?;
    if fragment_lines.next().is_some() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

/// A line edge's clusters, how they shape, and the boundary side whose island they are exactly, if any.
type LineEdge = ((usize, usize), (bool, bool), Option<(usize, usize)>);

/// A previous layout's boundary glyph id under `pack2(text unit of its cluster, glyph index)`: an edit moves
/// offsets but leaves a retained unit's id, so an offset is no key. A unit's glyphs sort in ordinal order.
type EdgeId = (u64, u32);

fn previous_edge_ids(
    ids: &mut Vec<EdgeId>,
    clusters: &ClusterArena,
    previous: &BoundaryShapeArena,
) {
    ids.clear();
    for record in &previous.records {
        let glyphs =
            record.source_glyph_start..record.source_glyph_start + record.source_glyph_count;
        for glyph in glyphs {
            let offset = previous.shape.clusters[glyph as usize];
            if let Ok(cluster) = clusters.starts.binary_search(&offset) {
                let key = sort::pack2(clusters.stable_ids[cluster], glyph);
                ids.push((key, previous.stable_ids[glyph as usize]));
            }
        }
    }
    sort::sort_pairs(ids);
}

fn append_boundary_source_ids(
    output: &mut Vec<u32>,
    source_clusters: &[u32],
    (clusters, previous): (&ClusterArena, &[EdgeId]),
    next_glyph_id: &mut u32,
) -> Result<(), EngineError> {
    let mut previous_cluster = None;
    let mut ordinal = 0u32;
    for &text_cluster in source_clusters {
        if previous_cluster == Some(text_cluster) {
            ordinal += 1;
        } else {
            previous_cluster = Some(text_cluster);
            ordinal = 0;
        }
        let stable_id = clusters
            .starts
            .binary_search(&text_cluster)
            .ok()
            .and_then(|cluster| {
                let (start, count) = (
                    clusters.glyph_starts[cluster],
                    clusters.glyph_counts[cluster],
                );
                let own = (ordinal < count)
                    .then(|| clusters.glyph_stable_ids.get((start + ordinal) as usize))
                    .flatten();
                own.copied().filter(|id| *id != 0).or_else(|| {
                    let unit = clusters.stable_ids[cluster];
                    let at = previous.partition_point(|id| id.0 < sort::pack2(unit, 0));
                    let id = previous.get(at + ordinal as usize)?;
                    (id.0 >> 32 == u64::from(unit)).then_some(id.1)
                })
            })
            .filter(|id| *id != 0)
            .map_or_else(|| allocate_glyph_id(next_glyph_id), Ok)?;
        output.push(stable_id);
    }
    Ok(())
}

fn allocate_glyph_id(next_glyph_id: &mut u32) -> Result<u32, EngineError> {
    let stable_id = (*next_glyph_id).max(1);
    *next_glyph_id = stable_id
        .checked_add(1)
        .ok_or(EngineError::ResultTooLarge)?;
    Ok(stable_id)
}

fn push_fallback_span(
    spans: &mut Vec<FallbackSpan>,
    span: FallbackSpan,
) -> Result<(), EngineError> {
    if let Some(previous) = spans.last_mut()
        && previous.source_run == span.source_run
        && previous.text_end == span.text_start
        && previous.font_index == span.font_index
        && previous.binding_handle == span.binding_handle
        && previous.font_handle == span.font_handle
    {
        previous.text_end = span.text_end;
        return Ok(());
    }
    spans
        .try_reserve(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    spans.push(span);
    Ok(())
}

fn collect_cluster_records(
    shape: &ShapeArena,
    records: &mut Vec<ClusterRecord>,
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    records.clear();
    reserve_vec(records, shape.glyph_ids.len())?;
    for run in &shape.runs {
        let start = usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let clusters = shape
            .clusters
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?;
        let glyph_ids = shape
            .glyph_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?;
        for (&cluster, &glyph_id) in clusters.iter().zip(glyph_ids) {
            records.push(ClusterRecord {
                source_run: run.source_run,
                cluster,
                missing: glyph_id == 0,
            });
        }
    }
    sort::prepare_pairs(sort_pairs, records.len())?;
    for (index, record) in records.iter().enumerate() {
        sort_pairs.push((sort::pack2(record.source_run, record.cluster), index as u32));
    }
    sort::sort_pairs(sort_pairs);
    sort::apply_pair_order(records, sort_pairs);
    let mut write_index = 0usize;
    for read_index in 0..records.len() {
        let record = records[read_index];
        if write_index > 0
            && records[write_index - 1].source_run == record.source_run
            && records[write_index - 1].cluster == record.cluster
        {
            records[write_index - 1].missing |= record.missing;
        } else {
            records[write_index] = record;
            write_index += 1;
        }
    }
    records.truncate(write_index);
    Ok(())
}

fn reserve_vec<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), EngineError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

fn request_semantic_paragraph_id(request: UpdateRequest<'_>) -> Result<Option<u32>, EngineError> {
    let mut paragraph_id = None;
    for index in 0..request.text_mutations.len() {
        merge_paragraph_id(
            &mut paragraph_id,
            request.text_mutations.paragraph_id(index),
        )?;
    }
    for index in 0..request.style_mutations.len() {
        merge_paragraph_id(
            &mut paragraph_id,
            request.style_mutations.paragraph_id(index),
        )?;
    }
    let geometry_count = request
        .geometry
        .constraint_count()
        .checked_add(request.geometry.inline_object_count())
        .ok_or(EngineError::InvalidRequest)?;
    for index in 0..geometry_count {
        merge_paragraph_id(&mut paragraph_id, request.geometry.paragraph_id(index))?;
    }
    Ok(paragraph_id)
}

fn merge_paragraph_id(
    current: &mut Option<u32>,
    candidate: Option<u32>,
) -> Result<(), EngineError> {
    let candidate = candidate.ok_or(EngineError::InvalidRequest)?;
    if current.is_some_and(|value| value != candidate) {
        return Err(EngineError::InvalidRequest);
    }
    *current = Some(candidate);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TextMutationError {
    Invalid,
    Allocation,
}

fn plan_error(error: RenderPlanCompilerError) -> EngineError {
    if error.is_result_too_large() {
        EngineError::ResultTooLarge
    } else {
        EngineError::InvalidRequest
    }
}

fn placement_slot_error(error: PlacementSlotError) -> EngineError {
    match error {
        PlacementSlotError::GenerationExhausted | PlacementSlotError::SlotExhausted => {
            EngineError::RevisionExhausted
        }
        PlacementSlotError::AllocationFailed | PlacementSlotError::ArithmeticOverflow => {
            EngineError::ResultTooLarge
        }
        PlacementSlotError::InvalidPublicationGeneration
        | PlacementSlotError::AcknowledgementRegressed => EngineError::RevisionConflict,
        PlacementSlotError::AlreadyPrepared
        | PlacementSlotError::NotPrepared
        | PlacementSlotError::DuplicateLogicalKey => EngineError::InvalidRequest,
    }
}

/// The typography for one flow thread; absent threads carry defaults so
/// retained lines from removed constraints position unchanged.
fn thread_typography(
    geometry: &FlowGeometryArena,
    flow_thread_id: u32,
) -> super::positioning::ThreadTypography {
    geometry
        .constraints
        .iter()
        .find(|constraint| constraint.flow_thread_id == flow_thread_id)
        .map_or_else(Default::default, super::positioning::constraint_typography)
}

fn gather_error(error: GatherError) -> EngineError {
    match error {
        GatherError::AllocationFailed => EngineError::ResultTooLarge,
        GatherError::InvalidSemanticShape
        | GatherError::FontBindingMissing
        | GatherError::GlyphBindingMissing
        | GatherError::ResourceBindingMissing
        | GatherError::ProgramMissing
        | GatherError::SourceFieldMissing => EngineError::InvalidRequest,
    }
}

#[cfg(test)]
mod unsafe_break_tests;

#[cfg(test)]
mod tests {
    use super::super::semantic_wire::ParagraphOrderMutationBatch;
    use crate::engine::style_state::ResolvedStyle;
    use read_fonts::TableProvider;

    use super::*;

    #[test]
    fn placement_identity_survives_run_geometry_revisions_but_distinguishes_boundary_roles() {
        let mut next_revision = 1;
        let first_revision = RunCanonicalRevision::allocate(&mut next_revision).unwrap();
        let second_revision = RunCanonicalRevision::allocate(&mut next_revision).unwrap();
        let segment = PlacementSegment {
            fragment_index: 0,
            layout_run_owner: LayoutRunOwner::Replacement,
            layout_run_index: 0,
            placement_handle: None,
            canonical_revision: Some(first_revision),
            identity: PlacementIdentity::StableSource,
            segment_anchor: 17,
            source_anchor: 17,
            numeric_block_ordinal: 0,
            run_cluster_start: 0,
            run_cluster_count: 1,
            glyph_source: GlyphSource::Boundary,
            source_glyph_start: 0,
            source_glyph_count: 1,
        };
        let paragraph = ParagraphIncarnation(NonZeroU32::new(3).unwrap());
        let source = LayoutRunSourceKind::Boundary {
            flow_thread_id: 9,
            role: BoundaryRunRole::BoundarySource,
        };
        let ellipsis = LayoutRunSourceKind::Boundary {
            flow_thread_id: 9,
            role: BoundaryRunRole::Ellipsis,
        };

        let first = placement_logical_key(paragraph, segment, source);
        let revised = placement_logical_key(
            paragraph,
            PlacementSegment {
                canonical_revision: Some(second_revision),
                ..segment
            },
            source,
        );
        assert_eq!(first, revised);
        assert_ne!(first, placement_logical_key(paragraph, segment, ellipsis));
    }

    #[test]
    fn width_only_cluster_prepare_skips_canonical_comparison() {
        let mut paragraph = ParagraphState {
            next_run_canonical_revision: 17,
            pending_next_run_canonical_revision: 17,
            ..ParagraphState::default()
        };
        let mut next_glyph_id = 23;

        paragraph
            .prepare_clusters(&ShaperRegistry::default(), &mut next_glyph_id)
            .unwrap();

        assert!(!paragraph.clusters.is_prepared());
        assert_eq!(paragraph.next_run_canonical_revision, 17);
        assert_eq!(paragraph.pending_source_run_canonical_revision, 17);
        assert_eq!(paragraph.pending_next_run_canonical_revision, 17);
        assert_eq!(next_glyph_id, 23);
    }

    #[test]
    fn discarded_positioning_candidate_preserves_source_revision_checkpoint() {
        let mut paragraph = ParagraphState {
            next_run_canonical_revision: 17,
            pending_source_run_canonical_revision: 23,
            pending_next_run_canonical_revision: 29,
            ..ParagraphState::default()
        };

        paragraph.discard_positioned_candidate();

        assert_eq!(paragraph.next_run_canonical_revision, 17);
        assert_eq!(paragraph.pending_source_run_canonical_revision, 23);
        assert_eq!(paragraph.pending_next_run_canonical_revision, 23);
    }

    #[test]
    fn positioned_revision_commits_without_a_pending_cluster_stage() {
        let mut paragraph = ParagraphState {
            next_run_canonical_revision: 17,
            pending_source_run_canonical_revision: 17,
            pending_next_run_canonical_revision: 18,
            ..ParagraphState::default()
        };

        paragraph.commit_clusters();

        assert_eq!(paragraph.next_run_canonical_revision, 18);
        assert_eq!(paragraph.pending_source_run_canonical_revision, 18);
        assert_eq!(paragraph.pending_next_run_canonical_revision, 18);
    }

    #[test]
    fn packed_utf16_change_scan_matches_a_scalar_reference() {
        let mut random = 0x2475_a11c_u32;
        for len in 0..=65usize {
            let mut accepted = Vec::with_capacity(len);
            for offset in 0..len {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let unit = match offset % 11 {
                    0 => 0xd83d,
                    1 => 0xde00,
                    2 | 3 => b'a' as u16,
                    _ => random as u16,
                };
                accepted.push(unit);
            }
            let mut candidate = accepted.clone();
            for (offset, unit) in candidate.iter_mut().enumerate() {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                if random & 7 == 0 || offset == len.saturating_sub(1) {
                    *unit ^= 0x0021;
                }
            }
            let expected = accepted
                .iter()
                .zip(&candidate)
                .enumerate()
                .filter_map(|(offset, (left, right))| (left != right).then_some(offset))
                .collect::<Vec<_>>();
            let mut actual = Vec::new();
            for_each_changed_utf16_unit(&accepted, &candidate, |offset| {
                actual.push(offset);
                Ok(())
            })
            .unwrap();
            assert_eq!(actual, expected, "UTF-16 length {len}");
        }
    }

    #[test]
    fn full_replacement_discovers_scalar_aligned_insertions_and_removals_in_rust() {
        let committed = TextStage {
            units: vec![b'a' as u16, b'b' as u16, b'c' as u16, b'd' as u16],
            unit_ids: vec![1, 2, 3, 4],
            next_unit_id: 5,
        };
        let mut inserted = TextStage {
            units: vec![
                b'a' as u16,
                b'b' as u16,
                b'X' as u16,
                b'Y' as u16,
                b'c' as u16,
                b'd' as u16,
            ],
            unit_ids: committed.unit_ids.clone(),
            next_unit_id: committed.next_unit_id,
        };
        let mut edits = Vec::new();
        collect_text_edits(
            &committed.units,
            &inserted.units,
            TextReconciliation::FullReplacement,
            &mut edits,
            0,
        )
        .unwrap();
        reconcile_text_identities(
            &committed,
            &mut inserted,
            &edits,
            Some(TextReconciliation::FullReplacement),
        )
        .unwrap();
        assert_eq!(inserted.unit_ids, [1, 2, 5, 6, 3, 4]);
        assert_eq!(edits.len(), 1);
        assert_eq!(
            (
                edits[0].old_start,
                edits[0].old_end,
                edits[0].new_start,
                edits[0].new_end
            ),
            (2, 2, 2, 4)
        );

        let mut removed = TextStage {
            units: committed.units.clone(),
            unit_ids: inserted.unit_ids,
            next_unit_id: inserted.next_unit_id,
        };
        let removed_from = TextStage {
            units: vec![
                b'a' as u16,
                b'b' as u16,
                b'X' as u16,
                b'Y' as u16,
                b'c' as u16,
                b'd' as u16,
            ],
            unit_ids: vec![1, 2, 5, 6, 3, 4],
            next_unit_id: 7,
        };
        edits.clear();
        collect_text_edits(
            &removed_from.units,
            &removed.units,
            TextReconciliation::FullReplacement,
            &mut edits,
            0,
        )
        .unwrap();
        reconcile_text_identities(
            &removed_from,
            &mut removed,
            &edits,
            Some(TextReconciliation::FullReplacement),
        )
        .unwrap();
        assert_eq!(removed.unit_ids, [1, 2, 3, 4]);
        assert_eq!(
            (
                edits[0].old_start,
                edits[0].old_end,
                edits[0].new_start,
                edits[0].new_end
            ),
            (2, 4, 2, 2)
        );

        let emoji = TextStage {
            units: vec![0xd83d, 0xde00],
            unit_ids: vec![11, 12],
            next_unit_id: 13,
        };
        let mut same_length_emoji = TextStage {
            units: vec![0xd83d, 0xde01],
            unit_ids: emoji.unit_ids.clone(),
            next_unit_id: emoji.next_unit_id,
        };
        let same_length = TextReconciliation::SameLength { start: 0, end: 2 };
        edits.clear();
        collect_text_edits(
            &emoji.units,
            &same_length_emoji.units,
            same_length,
            &mut edits,
            0,
        )
        .unwrap();
        reconcile_text_identities(&emoji, &mut same_length_emoji, &edits, Some(same_length))
            .unwrap();
        assert_eq!(same_length_emoji.unit_ids, [13, 14]);
        assert_eq!(
            (
                edits[0].old_start,
                edits[0].old_end,
                edits[0].new_start,
                edits[0].new_end
            ),
            (0, 2, 0, 2),
            "a packed low-surrogate difference invalidates the complete scalar"
        );

        let mut changed_emoji = TextStage {
            units: vec![0xd83d, 0xde01, b'!' as u16],
            unit_ids: emoji.unit_ids.clone(),
            next_unit_id: emoji.next_unit_id,
        };
        edits.clear();
        collect_text_edits(
            &emoji.units,
            &changed_emoji.units,
            TextReconciliation::FullReplacement,
            &mut edits,
            0,
        )
        .unwrap();
        reconcile_text_identities(
            &emoji,
            &mut changed_emoji,
            &edits,
            Some(TextReconciliation::FullReplacement),
        )
        .unwrap();
        assert_eq!((edits[0].old_start, edits[0].new_start), (0, 0));
        assert_eq!(changed_emoji.unit_ids, [13, 14, 15]);
    }

    #[test]
    fn retained_edit_range_and_run_topology_track_insertions_without_crossing_run_boundaries() {
        let edit = changed_identity_range(&[1, 2, 3, 4], &[1, 5, 6, 2, 3, 4]).unwrap();
        assert_eq!(
            edit,
            TextEdit {
                old_start: 1,
                old_end: 1,
                new_start: 1,
                new_end: 3,
            }
        );
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let old = [
            ShapingRun {
                text_start: 0,
                text_end: 4,
                script: 1,
                direction: 0,
                bidi_level: 0,
                style,
            },
            ShapingRun {
                text_start: 5,
                text_end: 9,
                script: 1,
                direction: 0,
                bidi_level: 0,
                style,
            },
        ];
        let new = [
            ShapingRun {
                text_end: 6,
                ..old[0]
            },
            ShapingRun {
                text_start: 7,
                text_end: 11,
                ..old[1]
            },
        ];
        assert_eq!(containing_run(&old, edit.old_start, edit.old_end), Some(0));
        assert_eq!(containing_run(&new, edit.old_start, edit.new_end), Some(0));
        assert!(same_edit_run_topology(&old, &new, edit, 0, None).unwrap());
        assert_eq!(containing_run(&old, 4, 4), Some(0));
        assert_eq!(
            containing_run(
                &[ShapingRun {
                    text_end: 0,
                    ..old[0]
                }],
                0,
                0
            ),
            None
        );
        let changed_neighbor = [
            new[0],
            ShapingRun {
                script: 2,
                ..new[1]
            },
        ];
        assert!(!same_edit_run_topology(&old, &changed_neighbor, edit, 0, None).unwrap());
    }
    use crate::{
        abi_contract::{
            self as abi, ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
            ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
            ENGINE_TEXT_MUTATION_RECORD_SIZE, ENGINE_TEXT_MUTATION_TEXT_START,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
        },
        bidi::DIRECTION_RTL,
        engine::{
            codec::{
                BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE, BUFFER_USAGE_COPY_DST,
                BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CAP_ORDERED_DIRECT, CapabilitySet,
                CodecDescriptor, Operation, ProgramCapabilities, ProgramDescriptor, ProgramId,
                ScalarType, TechniqueId,
            },
            font_binding::{
                FieldTable, FontRenderBinding, FontResource, FontStrike, MISSING_RESOURCE_INDEX,
            },
            frame::{
                ALIGN_START, AXIS_EXACT, BLOCK_ALIGN_START, DECORATION_SOLID, DECORATION_UNDERLINE,
                DROP_CAP_ALIGN_BASELINE, DROP_CAP_SIDE_INLINE_START, EXCLUSION_WRAP_BOTH,
                LAST_LINE_AUTO, ORIENTATION_MIXED, PARAGRAPH_MUTATION_REMOVE,
                PARAGRAPH_MUTATION_UPSERT, SHAPE_RECTANGLE, STYLE_FIELD_DECORATION,
                STYLE_FIELD_DIRECTION, STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK,
                STYLE_FIELD_FOREGROUND, STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MATERIAL,
                STYLE_FIELD_OUTLINE, STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FLAG_ROOT,
                STYLE_MUTATION_REMOVE, STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE,
                TEXT_MUTATION_REPLACE_UTF16, WRITING_HORIZONTAL_TB,
            },
            semantic_wire::{
                parse_geometry, parse_paragraph_mutations, parse_paragraph_order_mutations,
                parse_style_mutations, parse_text_mutations,
            },
        },
        wire::write_u32,
    };
    use alloc::vec;

    #[test]
    fn registration_is_idempotent_but_rejects_handle_conflicts() {
        let first = validated_codec(TechniqueId(1));
        let mut engine = TextEngine::default();
        assert_eq!(engine.register_codec(1, first.clone()), Ok(()));
        assert_eq!(engine.register_codec(1, first), Ok(()));
        assert_eq!(engine.codec_count(), 1);
        assert_eq!(
            engine.register_codec(1, validated_codec(TechniqueId(2))),
            Err(EngineError::HandleConflict)
        );
        assert_eq!(
            engine.codec(1).unwrap().programs()[0].technique,
            TechniqueId(1)
        );
    }

    #[test]
    fn font_stacks_retain_exact_order_and_reject_ambiguous_identity() {
        let mut engine = TextEngine::default();
        assert_eq!(
            engine.register_font_stack(0, &[1]),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            engine.register_font_stack(1, &[]),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            engine.register_font_stack(1, &[1, 1]),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.register_font_stack(7, &[9, 4, 12]), Ok(()));
        assert_eq!(engine.register_font_stack(7, &[9, 4, 12]), Ok(()));
        assert_eq!(engine.font_stack(7), Ok(&[9, 4, 12][..]));
        assert!(engine.references_binding(4));
        assert_eq!(engine.font_stack_count(), 1);
        assert_eq!(
            engine.register_font_stack(7, &[9, 12]),
            Err(EngineError::HandleConflict)
        );
        assert_eq!(engine.dispose_font_stack(7), Ok(()));
        assert!(!engine.references_binding(4));
        assert_eq!(
            engine.dispose_font_stack(7),
            Err(EngineError::FontStackMissing)
        );
    }

    #[test]
    fn fallback_clusters_restore_logical_order_and_merge_missing_glyphs() {
        let shape = ShapeArena {
            runs: vec![crate::engine::shaping_state::ShapedRun {
                source_run: 7,
                binding_handle: 11,
                font_handle: 11,
                text_start: 0,
                text_end: 6,
                glyph_start: 0,
                glyph_count: 4,
            }],
            glyph_ids: vec![3, 0, 2, 0],
            clusters: vec![4, 4, 2, 0],
            x_advances: vec![],
            y_advances: vec![],
            x_offsets: vec![],
            y_offsets: vec![],
            glyph_flags: vec![],
        };
        let mut records = Vec::new();
        collect_cluster_records(&shape, &mut records, &mut Vec::new()).unwrap();
        assert_eq!(
            records,
            vec![
                ClusterRecord {
                    source_run: 7,
                    cluster: 0,
                    missing: true,
                },
                ClusterRecord {
                    source_run: 7,
                    cluster: 2,
                    missing: false,
                },
                ClusterRecord {
                    source_run: 7,
                    cluster: 4,
                    missing: true,
                },
            ]
        );
    }

    #[test]
    fn binding_identity_is_distinct_from_shared_shaping_font_identity() {
        let mut engine = TextEngine::default();
        let binding = render_binding(3, 7);
        assert_eq!(
            engine.register_font_binding(11, 101, 4, binding.clone()),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            engine.register_font_binding(11, 101, 3, binding.clone()),
            Ok(())
        );
        assert_eq!(engine.register_font_binding(11, 101, 3, binding), Ok(()));
        assert_eq!(engine.font_binding_count(), 1);
        assert_eq!(engine.font_binding(11).unwrap().technique(), TechniqueId(7));
        assert_eq!(
            engine.register_font_binding(12, 101, 3, render_binding(3, 8)),
            Ok(())
        );
        assert_eq!(engine.font_binding_count(), 2);
        assert_eq!(
            engine
                .registered_font_binding(12)
                .map(|binding| binding.shaping_handle),
            Some(101)
        );
        assert_eq!(
            engine.register_font_binding(11, 101, 3, render_binding(3, 8)),
            Err(EngineError::HandleConflict)
        );
        assert_eq!(
            engine.register_font_binding(11, 102, 3, render_binding(3, 7)),
            Err(EngineError::HandleConflict)
        );
        engine.dispose_font_binding(11);
        assert_eq!(engine.font_binding_count(), 1);
    }

    #[test]
    fn disposal_is_exact_and_missing_handles_are_observable() {
        let mut engine = TextEngine::default();
        assert_eq!(
            engine.register_codec(0, validated_codec(TechniqueId(1))),
            Err(EngineError::InvalidHandle)
        );
        assert_eq!(engine.dispose_codec(1), Err(EngineError::CodecMissing));
        engine
            .register_codec(1, validated_codec(TechniqueId(1)))
            .unwrap();
        assert_eq!(engine.dispose_codec(1), Ok(()));
        assert_eq!(engine.dispose_codec(1), Err(EngineError::CodecMissing));
    }

    #[test]
    fn update_preparation_is_revisioned_and_commit_is_explicit() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        let first_plan = engine.prepared_plan(first).unwrap();
        assert_eq!(first_plan.codec_handle, 9);
        assert_eq!(first_plan.capability_set, 1);
        assert_eq!(engine.root_revision(4).unwrap(), RootRevision::default());
        let first = engine.commit_update(first).unwrap();
        assert!(first.checkpoint);
        assert_eq!(first.required_base_revision, 0);
        assert_eq!(first.revision, RootRevision { engine: 1, root: 1 });
        assert_eq!(
            engine.gather_cache.map(|cache| cache.revision),
            Some(first.revision)
        );

        let second = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        assert_eq!(
            engine.gather_cache.map(|cache| cache.revision),
            Some(first.revision)
        );
        assert_eq!(
            engine.prepared_gather_cache.map(|cache| cache.revision),
            Some(RootRevision { engine: 2, root: 2 })
        );
        let second = engine.commit_update(second).unwrap();
        assert!(!second.checkpoint);
        assert_eq!(second.required_base_revision, 1);
        assert_eq!(
            engine.gather_cache.map(|cache| cache.revision),
            Some(second.revision)
        );

        assert_eq!(
            engine.prepare_update(update(1, 2, 1), 3),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(engine.root_count(), 1);
        assert_eq!(engine.dispose_root(4), Ok(()));
        assert_eq!(engine.dispose_root(4), Err(EngineError::RootMissing));
    }

    #[test]
    fn unchanged_paragraphs_skip_real_shaper_preparation_across_lifecycle_transitions() {
        const INTER: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        const GLYPH_COUNT: u32 = 2937;

        let mut shaper = ShaperRegistry::default();
        let extents = vec![0; GLYPH_COUNT as usize * 8];
        let availability = vec![0; (GLYPH_COUNT as usize).div_ceil(8)];
        assert_eq!(
            shaper.register_font(101, INTER, &extents, &availability, 0, 0),
            crate::STATUS_OK
        );

        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine
            .register_font_binding(20, 101, GLYPH_COUNT, render_binding(GLYPH_COUNT, 1))
            .unwrap();
        engine.register_font_stack(7, &[20]).unwrap();
        engine.create_root(4).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 2),
            (PARAGRAPH_MUTATION_UPSERT, 3, 3),
        ]);
        let text = paragraph_text_mutation_bytes(&[
            (1, 0, 0, &[0x61]),
            (2, 0, 0, &[0x62]),
            (3, 0, 0, &[0x63]),
        ]);
        let styles = paragraph_root_style_bytes(&[(1, 1), (2, 1), (3, 1)]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 3;
        initial.limits.max_clusters = 8;
        initial.limits.max_lines = 8;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3).unwrap();
        initial.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3).unwrap();
        initial.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        for paragraph_id in 1..=3 {
            assert_eq!(
                engine.planner_paragraph_preparation_count(4, paragraph_id),
                Ok(1)
            );
            assert_eq!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .paragraph(paragraph_id)
                    .unwrap()
                    .state
                    .shape
                    .active()
                    .glyph_ids
                    .len(),
                1
            );
        }

        let sibling_text = paragraph_text_mutation_bytes(&[(2, 0, 1, &[0x79])]);
        let mut sibling = update(1, 1, 1);
        sibling.limits.max_paragraphs = 3;
        sibling.limits.max_clusters = 8;
        sibling.limits.max_lines = 8;
        sibling.text_mutations =
            parse_text_mutations(&sibling_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, sibling, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.planner_paragraph_preparation_count(4, 1), Ok(1));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 2), Ok(2));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 3), Ok(1));
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(2)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x79]
        );

        let candidate_text = paragraph_text_mutation_bytes(&[(1, 0, 1, &[0x71])]);
        let mut query = update(2, 2, 2);
        query.limits.max_paragraphs = 3;
        query.limits.max_clusters = 8;
        query.limits.max_lines = 8;
        query.text_mutations =
            parse_text_mutations(&candidate_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        engine
            .measure_paragraph_with_shaper(&mut shaper, query, 1)
            .unwrap();
        assert_eq!(engine.planner_paragraph_preparation_count(4, 1), Ok(2));
        assert!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .has_pending_preparation()
        );
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x61]
        );
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .text
                .pending()
                .units,
            [0x71]
        );

        let next_sibling_text = paragraph_text_mutation_bytes(&[(2, 0, 1, &[0x7a])]);
        let mut next_sibling = update(2, 2, 2);
        next_sibling.limits.max_paragraphs = 3;
        next_sibling.limits.max_clusters = 8;
        next_sibling.limits.max_lines = 8;
        next_sibling.text_mutations =
            parse_text_mutations(&next_sibling_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, next_sibling, 3)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.planner_paragraph_preparation_count(4, 1), Ok(3));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 2), Ok(3));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 3), Ok(1));
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x61]
        );

        let retry_text = paragraph_text_mutation_bytes(&[(3, 0, 1, &[0x64])]);
        let mut retry_request = update(3, 3, 3);
        retry_request.limits.max_paragraphs = 3;
        retry_request.limits.max_clusters = 8;
        retry_request.limits.max_lines = 8;
        retry_request.text_mutations =
            parse_text_mutations(&retry_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, retry_request, 4)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.planner_paragraph_preparation_count(4, 1), Ok(3));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 2), Ok(3));
        assert_eq!(engine.planner_paragraph_preparation_count(4, 3), Ok(2));
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(3)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x64]
        );

        engine.dispose_root(4).unwrap();
        engine.create_root(4).unwrap();
        let recreated_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 4, 1)]);
        let recreated_text = paragraph_text_mutation_bytes(&[(4, 0, 0, &[0x65])]);
        let recreated_style = paragraph_root_style_bytes(&[(4, 1)]);
        let mut recreated = update(0, 0, 0);
        recreated.paragraph_mutations =
            parse_paragraph_mutations(&recreated_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        recreated.text_mutations =
            parse_text_mutations(&recreated_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        recreated.style_mutations =
            parse_style_mutations(&recreated_style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, recreated, 5)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.planner_paragraph_preparation_count(4, 4), Ok(1));
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(4)
                .unwrap()
                .state
                .shape
                .active()
                .glyph_ids
                .len(),
            1
        );
    }

    #[test]
    fn production_independent_paint_update_skips_accepted_binding_compilation() {
        const GLYPH_COUNT: u32 = 2_937;
        const INTER: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");

        let mut shaper = ShaperRegistry::default();
        let extents = vec![0; GLYPH_COUNT as usize * 8];
        let mut availability = vec![u8::MAX; (GLYPH_COUNT as usize).div_ceil(8)];
        *availability.last_mut().unwrap() = (1 << (GLYPH_COUNT % 8)) - 1;
        assert_eq!(
            shaper.register_font(42, INTER, &extents, &availability, 0, 0),
            0
        );

        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_paint_codec(TechniqueId(1)))
            .unwrap();
        engine
            .register_font_binding(42, 42, GLYPH_COUNT, render_binding(GLYPH_COUNT, 1))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();

        let text_bytes = text_mutation_bytes(&[(0, 0, &[0x41])]);
        let initial_style_bytes = paragraph_root_style_with_foreground(0xff00_00ff);
        let geometry_bytes = root_geometry_bytes();
        let mut initial = update(0, 0, 0);
        initial.compositing_independent = true;
        initial.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        initial.style_mutations =
            parse_style_mutations(&initial_style_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        initial.geometry = parse_root_geometry(&geometry_bytes, initial.limits);
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        let positioned_glyphs = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .positioned
            .active()
            .glyphs()
            .len();
        assert_eq!(
            positioned_glyphs, 1,
            "the production pipeline must position the authored glyph"
        );
        let initial_plan = engine.prepared_plan(prepared).unwrap();
        assert!(!initial_plan.buffers.is_empty());
        assert!(!initial_plan.draws.is_empty());
        engine.commit_update(prepared).unwrap();

        let changed_style_bytes = paragraph_root_style_with_foreground(0x00ff_00ff);
        let mut changed = update(1, 1, 1);
        changed.compositing_independent = true;
        changed.style_mutations =
            parse_style_mutations(&changed_style_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, changed, 2)
            .unwrap();
        let delta = engine.prepared_plan(prepared).unwrap();
        assert!(!delta.patches.is_empty());
        assert!(delta.resources.is_empty());
        assert!(delta.buffers.is_empty());
        assert!(delta.primitives.is_empty());
        assert!(delta.draws.is_empty());
        assert_eq!(engine.retained_binding_compilation_skips(4), Ok(1));
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.retained_binding_compilation_skips(4), Ok(1));
    }

    #[test]
    fn update_rejects_a_capability_set_outside_the_registered_codec() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let mut request = update(0, 0, 0);
        request.capability_set = 3;
        assert_eq!(
            engine.prepare_update(request, 1),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4).unwrap(), RootRevision::default());
    }

    #[test]
    fn revision_exhaustion_does_not_advance_the_acknowledgement_fence() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(first).unwrap();

        let planner = engine.planners.get_mut(&4).unwrap();
        planner.revision.engine = u32::MAX;
        let request = update(u32::MAX, planner.revision.root, 1);
        assert_eq!(
            engine.prepare_update(request, 2),
            Err(EngineError::RevisionExhausted)
        );
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .acknowledged_publication_generation,
            0
        );
    }

    #[test]
    fn failed_text_preparation_discards_the_derived_root_until_reset() {
        let (mut engine, mut shaper) = shaped_inter_engine("A");
        let replacement = utf16("BC");
        let bytes = text_mutation_bytes(&[(0, 1, &replacement)]);
        let styles = root_style_bytes_for_text(7, replacement.len() as u32);
        let mut request = update(1, 1, 1);
        request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION;
        request.limits.max_clusters = 1;
        request.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        request.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        assert!(
            engine
                .prepare_update_with_shaper(&mut shaper, request, 2)
                .is_err()
        );
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));

        engine.reset_root(4).unwrap();
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        let empty = engine.prepare_update(update(0, 0, 1), 2).unwrap();
        engine.commit_update(empty).unwrap();
        assert_eq!(
            engine.root_revision(4),
            Ok(RootRevision { engine: 1, root: 1 })
        );
    }

    #[test]
    fn reset_preserves_publication_generation_high_water() {
        let mut engine = TextEngine::default();
        engine.create_root(4).unwrap();
        engine
            .planners
            .get_mut(&4)
            .unwrap()
            .acknowledged_publication_generation = 17;

        engine.reset_root(4).unwrap();

        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .acknowledged_publication_generation,
            17
        );
    }

    #[test]
    fn reset_rejects_unknown_and_disposed_roots() {
        let mut engine = TextEngine::default();

        assert_eq!(engine.reset_root(4), Err(EngineError::RootMissing));

        engine.create_root(5).unwrap();
        engine.dispose_root(5).unwrap();

        assert_eq!(engine.reset_root(5), Err(EngineError::RootMissing));
    }

    #[test]
    fn reset_replay_publishes_after_renderer_acknowledgement() {
        let (mut engine, mut shaper) = shaped_inter_engine("A");
        {
            let planner = engine.planners.get_mut(&4).unwrap();
            assert_eq!(planner.acknowledged_publication_generation, 0);
        }
        engine.invalidate_root(4).unwrap();
        engine.reset_root(4).unwrap();
        assert!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .placement_acknowledgement_rebased
        );

        let units = utf16("A");
        let text_bytes = text_mutation_bytes(&[(0, 0, &units)]);
        let styles = root_style_bytes_for_text(7, units.len() as u32);
        let lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 0)]);
        let mut replay = update(0, 0, 1);
        replay.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        replay.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        replay.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, replay, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();

        let mut publication = update(0, 0, 1);
        publication.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, publication, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
    }

    #[test]
    fn reset_keeps_the_high_water_record_until_replacement_creation_succeeds() {
        let mut engine = TextEngine::default();
        engine.invalidated_roots.insert(
            0,
            RootHighWater {
                next_glyph_id: 12,
                next_content_revision: 8,
                acknowledged_publication_generation: 6,
            },
        );

        assert_eq!(engine.reset_root(0), Err(EngineError::InvalidHandle));
        assert_eq!(
            engine
                .invalidated_roots
                .get(&0)
                .copied()
                .unwrap()
                .next_glyph_id,
            12
        );
    }

    #[test]
    fn deleting_half_of_a_surrogate_pair_is_rejected_before_text_writes() {
        let (mut engine, _shaper) = shaped_inter_engine("😀");
        let revision = engine.root_revision(4).unwrap();
        let bytes = text_mutation_bytes(&[(0, 1, &[])]);
        let mut request = update(revision.engine, revision.root, 0);
        request.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        assert_eq!(
            engine.prepare_update(request, 2),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4), Ok(revision));
        assert_eq!(engine.root_text(4).unwrap(), &[0xd83d, 0xde00]);
    }

    #[test]
    fn validated_mutation_boundaries_match_materialized_utf16() {
        let committed = [0x41, 0xd83d, 0xde00, 0x42, 0x43];
        let bytes = text_mutation_bytes(&[
            (3, 1, &[0x44, 0x45]),
            (1, 2, &[0xd83c, 0xdf0d]),
            (0, 0, &[0x5a]),
        ]);
        let mutations = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3).unwrap();
        let length = validate_text_mutations(&committed, mutations).unwrap() as u32;
        let materialized = [0x5a, 0x41, 0xd83c, 0xdf0d, 0x44, 0x45, 0x43];
        assert_eq!(length as usize, materialized.len());
        for offset in 0..=length + 1 {
            assert_eq!(
                utf16_boundary_after_mutations(&committed, mutations, length, offset),
                valid_utf16_boundary(&materialized, offset),
                "offset {offset}",
            );
        }
    }

    #[test]
    fn preflight_complete_replacement_avoids_old_units_and_preserves_ordered_edits() {
        let committed = [0x61, 0xd83d, 0xde00, 0x62];
        let replacement = [0x63, 0xd83c, 0xdf0d];
        let bytes = text_mutation_bytes(&[(0, committed.len() as u32, &replacement)]);
        let mutations = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            validate_text_mutations(&committed, mutations),
            Ok(replacement.len())
        );
        let mut destination = vec![0xffff; committed.len()];
        super::super::work_attribution::reset();
        populate_preflight_text(&mut destination, &committed, mutations, true, 0).unwrap();
        assert_eq!(destination, replacement);
        assert_eq!(
            super::super::work_attribution::snapshot().preflight_seeded_old_units,
            0
        );

        let empty = text_mutation_bytes(&[(0, committed.len() as u32, &[])]);
        let mutations = parse_text_mutations(&empty, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(validate_text_mutations(&committed, mutations), Ok(0));
        populate_preflight_text(&mut destination, &committed, mutations, true, 0).unwrap();
        assert!(destination.is_empty());
        assert_eq!(
            super::super::work_attribution::snapshot().preflight_seeded_old_units,
            0
        );

        let partial = text_mutation_bytes(&[(1, 2, &[0x78])]);
        let mutations =
            parse_text_mutations(&partial, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(validate_text_mutations(&committed, mutations), Ok(3));
        populate_preflight_text(&mut destination, &committed, mutations, true, 0).unwrap();
        assert_eq!(destination, [0x61, 0x78, 0x62]);
        assert_eq!(
            super::super::work_attribution::snapshot().preflight_seeded_old_units,
            committed.len()
        );

        let ordered = text_mutation_bytes(&[(0, 0, &[0x79]), (4, 1, &[0x7a])]);
        let mutations =
            parse_text_mutations(&ordered, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        assert_eq!(validate_text_mutations(&committed, mutations), Ok(5));
        populate_preflight_text(&mut destination, &committed, mutations, true, 0).unwrap();
        assert_eq!(destination, [0x79, 0x61, 0xd83d, 0xde00, 0x7a]);
        assert_eq!(
            super::super::work_attribution::snapshot().preflight_seeded_old_units,
            committed.len() * 2
        );

        let malformed = text_mutation_bytes(&[(0, committed.len() as u32, &[0xd800])]);
        let mutations =
            parse_text_mutations(&malformed, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            validate_text_mutations(&committed, mutations),
            Err(EngineError::InvalidRequest)
        );
    }

    #[test]
    fn style_preflight_rejects_missing_lifecycle_target_and_stale_root_range() {
        let (mut engine, _shaper) = shaped_inter_engine("abcd");
        let revision = engine.root_revision(4).unwrap();

        let mut missing_target = root_style_bytes_for_text(7, 4);
        write_u32(
            &mut missing_target,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            99,
        );
        let mut request = update(revision.engine, revision.root, 0);
        request.style_mutations =
            parse_style_mutations(&missing_target, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(request, 2),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4), Ok(revision));

        let stale_root = root_style_bytes_for_text(7, 3);
        let mut request = update(revision.engine, revision.root, 0);
        request.style_mutations =
            parse_style_mutations(&stale_root, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(request, 2),
            Err(EngineError::StyleRootInvalid(FrameFault {
                paragraph_id: 1,
                style_id: 1,
            }))
        );
        assert_eq!(engine.root_revision(4), Ok(revision));
    }

    #[test]
    fn a_committed_planner_accepts_another_capability_set_from_the_same_codec() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(first).unwrap();

        let mut request = update(1, 1, 1);
        request.capability_set = 2;
        let second = engine.prepare_update(request, 2).unwrap();
        assert_eq!(engine.prepared_plan(second).unwrap().capability_set, 2);
        engine.commit_update(second).unwrap();
    }

    #[test]
    fn renderer_fence_acknowledgment_is_monotonic_and_cannot_name_the_pending_publication() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
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
    fn publication_failure_invalidates_the_root_until_reset() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 0)]);
        let mut request = update(0, 0, 0);
        request.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(request, 1).unwrap();
        assert!(engine.prepared_gather_cache.is_some());
        engine
            .invalidate_after_publication_failure(prepared)
            .unwrap();
        assert!(engine.gather_cache.is_none());
        assert!(engine.prepared_gather_cache.is_none());
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));
        engine.reset_root(4).unwrap();
        let retry = engine.prepare_update(request, 1).unwrap();
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_some());
        engine.commit_update(retry).unwrap();
    }

    #[test]
    fn stale_publication_failure_still_discards_derived_state() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let stale = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(stale).unwrap();
        let current = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        engine.commit_update(current).unwrap();

        assert_eq!(
            engine.invalidate_after_publication_failure(stale),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));
    }

    #[test]
    fn sequential_measurements_accept_each_edit_before_render_publication() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        // The query result must encode successfully before its prepared text becomes accepted.
        let edit_bytes = text_mutation_bytes(&[(4, 0, &[0x58, 0x59])]);
        let mut query = update(1, 1, 1);
        query.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(query, 1).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        assert_eq!(engine.commit_measure(measured), Ok(1));
        assert_eq!(
            engine.root_text(4).unwrap(),
            &[0x61, 0x62, 0x63, 0x64, 0x58, 0x59]
        );

        // A later edit starts from accepted query state and commits independently.
        let changed_bytes = text_mutation_bytes(&[(4, 2, &[0x5a])]);
        let mut changed = update(1, 1, 1);
        changed.text_mutations =
            parse_text_mutations(&changed_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(changed, 1).unwrap();
        assert_eq!(engine.commit_measure(measured), Ok(2));
        assert_eq!(
            engine.root_text(4).unwrap(),
            &[0x61, 0x62, 0x63, 0x64, 0x5a]
        );

        // Rendering publishes the already accepted preparation without replaying text edits.
        let follow = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        let committed = engine.commit_update(follow).unwrap();
        assert_eq!(committed.revision, RootRevision { engine: 2, root: 2 });
        assert_eq!(
            engine.root_text(4).unwrap(),
            &[0x61, 0x62, 0x63, 0x64, 0x5a]
        );
    }

    #[test]
    fn intrinsic_width_cache_reuses_geometry_and_tracks_text_metrics_and_wrap() {
        const INTER: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        let original = "alpha beta gamma";
        let mut geometry = root_geometry_bytes();
        let mut styles = root_style_bytes_for_text(7, original.encode_utf16().count() as u32);
        let (mut engine, mut shaper) = shaped_engine_with_font_styles_and_geometry(
            original,
            INTER,
            2_937,
            &styles,
            1,
            Some((&geometry, 0)),
        );
        let mut query = update(1, 1, 1);
        query.limits.max_clusters = 256;
        query.limits.max_lines = 256;
        query.limits.max_output_bytes = 1 << 20;
        query.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT;
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, query, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        let mut previous_text = original;
        let mut previous_size = 16.0;
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        for (text, size, width, wrap, rescans) in [
            (original, 16.0, 54.0, WRAP_WORD, false),
            ("longestword tiny", 16.0, 54.0, WRAP_WORD, true),
            ("longestword tiny", 20.0, 54.0, WRAP_WORD, true),
            (
                "longestword tiny",
                20.0,
                54.0,
                super::super::frame::WRAP_CHARACTER,
                true,
            ),
            (
                "longestword tiny",
                20.0,
                112.0,
                super::super::frame::WRAP_CHARACTER,
                false,
            ),
        ] {
            write_f32(
                &mut geometry,
                constraint + abi::ENGINE_CONSTRAINT_WIDTH,
                width,
            );
            write_f32(&mut geometry, region + abi::ENGINE_REGION_INLINE_END, width);
            write_f32(
                &mut geometry,
                region + abi::ENGINE_REGION_CLIP_INLINE_END,
                width,
            );
            geometry[constraint + abi::ENGINE_CONSTRAINT_WRAP] = wrap;
            let units = utf16(text);
            styles = root_style_bytes_for_text(7, units.len() as u32);
            write_f32(
                &mut styles,
                constraint + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
                size,
            );
            let text_bytes =
                text_mutation_bytes(&[(0, previous_text.encode_utf16().count() as u32, &units)]);
            let mut change = query;
            change.geometry = parse_root_geometry(&geometry, change.limits);
            if text != previous_text {
                change.text_mutations =
                    parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                        .unwrap();
            }
            if text != previous_text || size != previous_size {
                change.style_mutations =
                    parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            }
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, change, 1)
                .unwrap();
            let visits =
                super::super::work_attribution::snapshot().measurement_intrinsic_cluster_visits;
            assert_eq!(
                visits > 0,
                rescans,
                "intrinsic scan for {text}, size {size}, wrap {wrap}, width {width}"
            );
            let retained = *engine
                .measured_semantic_views(measured)
                .unwrap()
                .iter()
                .find(|record| {
                    record.kind == super::super::semantic_view::SEMANTIC_PARAGRAPH_MEASUREMENT
                })
                .unwrap();
            engine.commit_measure(measured).unwrap();
            let (mut cold, mut cold_shaper) = shaped_engine_with_font_styles_and_geometry(
                text,
                INTER,
                2_937,
                &styles,
                1,
                Some((&geometry, 0)),
            );
            let measured = cold
                .measure_paragraph_with_shaper(&mut cold_shaper, query, 1)
                .unwrap();
            let recomputed = cold
                .measured_semantic_views(measured)
                .unwrap()
                .iter()
                .find(|record| {
                    record.kind == super::super::semantic_view::SEMANTIC_PARAGRAPH_MEASUREMENT
                })
                .unwrap();
            assert_eq!(
                &retained, recomputed,
                "cold measurement for {text}, size {size}, wrap {wrap}, width {width}"
            );
            previous_text = text;
            previous_size = size;
        }
    }

    #[test]
    fn clipped_inspection_follows_measure_commit_and_failure() {
        const INTER: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        const GLYPH_COUNT: u32 = 2937;
        let mut shaper = ShaperRegistry::default();
        assert_eq!(
            shaper.register_font(
                101,
                INTER,
                &vec![0; GLYPH_COUNT as usize * 8],
                &vec![0; (GLYPH_COUNT as usize).div_ceil(8)],
                0,
                0
            ),
            crate::STATUS_OK
        );
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine
            .register_font_binding(20, 101, GLYPH_COUNT, render_binding(GLYPH_COUNT, 1))
            .unwrap();
        engine.register_font_stack(7, &[20]).unwrap();
        engine.create_root(4).unwrap();

        let units: Vec<u16> = "first line\nsecond line\nthird line"
            .encode_utf16()
            .collect();
        let lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 0)]);
        let text = paragraph_text_mutation_bytes(&[(1, 0, 0, &units)]);
        let styles = root_style_bytes_for_text(7, units.len() as u32);
        let mut geometry = multiline_root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_u32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_MAX_LINES,
            0,
        );
        for field in [
            abi::ENGINE_CONSTRAINT_HEIGHT,
            abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
        ] {
            write_f32(&mut geometry, constraint + field, 20.0);
        }
        for field in [
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut geometry, region + field, 20.0);
        }
        let mut initial = update(0, 0, 0);
        initial.limits.max_clusters = 128;
        initial.limits.max_lines = 128;
        initial.limits.max_output_bytes = 16384;
        initial.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
            | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        initial.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        initial.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        initial.geometry = parse_root_geometry(&geometry, initial.limits);
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        super::super::work_attribution::reset();
        let mut repeated_read = update(0, 0, 0);
        repeated_read.limits = initial.limits;
        repeated_read.semantic_view_mask = initial.semantic_view_mask;
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, repeated_read, 1)
            .unwrap();
        assert!(
            !engine.measured_semantic_views(measured).unwrap().is_empty(),
            "the cached intrinsic widths still serve the measurement"
        );
        engine.commit_measure(measured).unwrap();
        assert_eq!(
            super::super::work_attribution::snapshot().measurement_intrinsic_cluster_visits,
            0,
            "reading one prepared revision must not rescan its clusters for intrinsic widths"
        );
        assert_eq!(
            super::super::work_attribution::snapshot().intrinsic_flow_preparations,
            0
        );
        assert_eq!(
            super::super::work_attribution::snapshot().intrinsic_positioning_preparations,
            0
        );
        let accepted_count = engine.borrowed_paragraph_layout(4, 1).unwrap();
        let visible_count = engine
            .planners
            .get(&4)
            .unwrap()
            .paragraph(1)
            .unwrap()
            .state
            .positioned
            .active()
            .semantic_glyphs()
            .len();
        assert!(
            accepted_count > visible_count,
            "clipping must retain full inspection"
        );
        let replacement: Vec<u16> = "new first\nnew second\nnew third\nnew fourth"
            .encode_utf16()
            .collect();
        let edited = paragraph_text_mutation_bytes(&[(1, 0, units.len() as u32, &replacement)]);
        let restyled = root_style_bytes_for_text(7, replacement.len() as u32);
        let mut candidate = update(0, 0, 0);
        candidate.limits = initial.limits;
        candidate.semantic_view_mask = initial.semantic_view_mask;
        candidate.text_mutations =
            parse_text_mutations(&edited, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        candidate.style_mutations =
            parse_style_mutations(&restyled, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let rejected = engine
            .measure_paragraph_with_shaper(&mut shaper, candidate, 1)
            .unwrap();
        assert_ne!(
            engine.borrowed_paragraph_layout(4, 1).unwrap(),
            accepted_count
        );
        engine.invalidate_after_measure_failure(rejected).unwrap();
        assert_eq!(
            engine.borrowed_paragraph_layout(4, 1),
            Err(EngineError::RootMissing),
            "failed query delivery discards derived state instead of restoring it"
        );
        engine.reset_root(4).unwrap();
        let replayed = engine
            .measure_paragraph_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        engine.commit_measure(replayed).unwrap();
        let retry = engine
            .measure_paragraph_with_shaper(&mut shaper, candidate, 1)
            .unwrap();
        let retry_count = engine.borrowed_paragraph_layout(4, 1).unwrap();
        engine.commit_measure(retry).unwrap();
        assert_eq!(engine.borrowed_paragraph_layout(4, 1).unwrap(), retry_count);
        assert_ne!(retry_count, accepted_count);
        let mut inspection = repeated_read;
        inspection.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
            | super::super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION;
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, inspection, 1)
            .unwrap();
        let expected = engine.measured_semantic_views(measured).unwrap().to_vec();
        engine.commit_measure(measured).unwrap();
        let (mut cold, mut cold_shaper) = shaped_engine_with_font_styles_and_geometry(
            "new first\nnew second\nnew third\nnew fourth",
            INTER,
            GLYPH_COUNT,
            &restyled,
            1,
            Some((&geometry, 0)),
        );
        let mut cold_query = update(1, 1, 1);
        cold_query.limits = inspection.limits;
        cold_query.semantic_view_mask = inspection.semantic_view_mask;
        let cold_measure = cold
            .measure_paragraph_with_shaper(&mut cold_shaper, cold_query, 1)
            .unwrap();
        let without_runtime_identity =
            |records: &[super::super::semantic_view::SemanticRecord]| {
                records
                    .iter()
                    .copied()
                    .map(|mut record| {
                        if record.kind == super::super::semantic_view::SEMANTIC_GLYPH {
                            record.id = 0;
                            record.text_end = 0; // Font handles are local to each independently constructed engine.
                        }
                        record
                    })
                    .collect::<Vec<_>>()
            };
        assert_eq!(
            without_runtime_identity(&expected),
            without_runtime_identity(cold.measured_semantic_views(cold_measure).unwrap()),
            "prepared clipped records must match independently cold layout apart from runtime identities"
        );
        let publication = inspection;
        super::super::work_attribution::reset();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, publication, 1)
            .unwrap();
        assert_eq!(engine.prepared_semantic_views(prepared).unwrap(), expected);
        assert_eq!(
            super::super::work_attribution::snapshot().intrinsic_flow_preparations,
            0
        );
        assert_eq!(
            super::super::work_attribution::snapshot().intrinsic_positioning_preparations,
            0
        );
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.borrowed_paragraph_layout(4, 1).unwrap(), retry_count);
        for (width, height, max_lines, overflow, mode) in [
            (
                54.0,
                20.0,
                0,
                OVERFLOW_CLIP,
                IntrinsicInspection::Positioned,
            ),
            (54.0, 20.0, 1, OVERFLOW_CLIP, IntrinsicInspection::Flow),
            (54.0, 20.0, 1, OVERFLOW_ELLIPSIS, IntrinsicInspection::Flow),
            (200.0, 1000.0, 0, OVERFLOW_CLIP, IntrinsicInspection::None),
        ] {
            for (offset, value) in [
                (constraint + abi::ENGINE_CONSTRAINT_WIDTH, width),
                (region + abi::ENGINE_REGION_INLINE_END, width),
                (region + abi::ENGINE_REGION_CLIP_INLINE_END, width),
                (constraint + abi::ENGINE_CONSTRAINT_HEIGHT, height),
                (
                    constraint + abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
                    height,
                ),
                (region + abi::ENGINE_REGION_BLOCK_END, height),
                (region + abi::ENGINE_REGION_CLIP_BLOCK_END, height),
            ] {
                write_f32(&mut geometry, offset, value);
            }
            write_u32(
                &mut geometry,
                constraint + abi::ENGINE_CONSTRAINT_MAX_LINES,
                max_lines,
            );
            geometry[constraint + abi::ENGINE_CONSTRAINT_OVERFLOW] = overflow;
            let mut changed = update(1, 1, 1);
            changed.limits = inspection.limits;
            changed.semantic_view_mask = inspection.semantic_view_mask;
            changed.geometry = parse_root_geometry(&geometry, changed.limits);
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, changed, 1)
                .unwrap();
            let expected = engine.measured_semantic_views(measured).unwrap().to_vec();
            let work = super::super::work_attribution::snapshot();
            assert_eq!(
                work.intrinsic_flow_preparations,
                usize::from(mode != IntrinsicInspection::None)
            );
            assert_eq!(
                work.intrinsic_positioning_preparations,
                usize::from(mode == IntrinsicInspection::Positioned)
            );
            engine.commit_measure(measured).unwrap();
            assert!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .paragraph(1)
                    .unwrap()
                    .state
                    .clipped_inspection
                    .active()
                    .mode
                    == mode
            );
            let (mut cold, mut cold_shaper) = shaped_engine_with_font_styles_and_geometry(
                "new first\nnew second\nnew third\nnew fourth",
                INTER,
                GLYPH_COUNT,
                &restyled,
                1,
                Some((&geometry, 0)),
            );
            let cold_measure = cold
                .measure_paragraph_with_shaper(&mut cold_shaper, cold_query, 1)
                .unwrap();
            assert_eq!(
                without_runtime_identity(&expected),
                without_runtime_identity(cold.measured_semantic_views(cold_measure).unwrap())
            );
            let mut cached = update(1, 1, 1);
            cached.limits = inspection.limits;
            cached.semantic_view_mask = inspection.semantic_view_mask;
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, cached, 1)
                .unwrap();
            assert_eq!(engine.measured_semantic_views(measured).unwrap(), expected);
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.intrinsic_flow_preparations, 0);
            assert_eq!(work.intrinsic_positioning_preparations, 0);
            engine.commit_measure(measured).unwrap();
        }

        let published_text = "new first\nnew second\nnew third\nnew fourth";
        let setter_text = "new first\nnew second\nnew third\nnew fifth";
        let setter_units = utf16(setter_text);
        let setter_text_bytes = paragraph_text_mutation_bytes(&[(
            1,
            0,
            published_text.encode_utf16().count() as u32,
            &setter_units,
        )]);
        let setter_styles = root_style_bytes_for_text(7, setter_units.len() as u32);
        let mut setter_geometry = geometry.clone();
        for (offset, value) in [
            (constraint + abi::ENGINE_CONSTRAINT_WIDTH, 54.0),
            (region + abi::ENGINE_REGION_INLINE_END, 54.0),
            (region + abi::ENGINE_REGION_CLIP_INLINE_END, 54.0),
            (constraint + abi::ENGINE_CONSTRAINT_HEIGHT, 20.0),
            (constraint + abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END, 20.0),
            (region + abi::ENGINE_REGION_BLOCK_END, 20.0),
            (region + abi::ENGINE_REGION_CLIP_BLOCK_END, 20.0),
        ] {
            write_f32(&mut setter_geometry, offset, value);
        }
        write_u32(
            &mut setter_geometry,
            constraint + abi::ENGINE_CONSTRAINT_MAX_LINES,
            1,
        );
        setter_geometry[constraint + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_ELLIPSIS;
        let root_revision_before_setter = engine.root_revision(4).unwrap();
        let preparation_revision_before_setter = engine.planner_preparation_revision(4).unwrap();
        let mut setter = update(1, 1, 1);
        setter.limits = inspection.limits;
        let query_limits = setter.limits;
        setter.semantic_view_mask = 0;
        setter.text_mutations =
            parse_text_mutations(&setter_text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        setter.style_mutations =
            parse_style_mutations(&setter_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        setter.geometry = parse_root_geometry(&setter_geometry, setter.limits);
        super::super::work_attribution::reset();
        let setter = engine
            .measure_paragraph_with_shaper(&mut shaper, setter, 1)
            .unwrap();
        assert!(
            engine.measured_semantic_views(setter).unwrap().is_empty(),
            "the mask-zero setter prepares durable text without building query records"
        );
        let setter_shape_calls = crate::SHAPINGS.with(core::cell::Cell::get);
        let setter_work = super::super::work_attribution::snapshot();
        assert_eq!(setter_work.intrinsic_flow_preparations, 0);
        assert_eq!(setter_work.intrinsic_positioning_preparations, 0);
        engine.commit_measure(setter).unwrap();
        let setter_preparation_revision = engine.planner_preparation_revision(4).unwrap();
        assert!(
            setter_shape_calls > 0,
            "the changed text is shaped by its setter"
        );
        assert_eq!(
            setter_preparation_revision,
            preparation_revision_before_setter + 1
        );
        assert_eq!(
            engine.root_revision(4).unwrap(),
            root_revision_before_setter
        );

        let mut borrowed_query = update(1, 1, 1);
        borrowed_query.limits = query_limits;
        borrowed_query.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
            | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
        super::super::work_attribution::reset();
        let before_query_shape_calls = crate::SHAPINGS.with(core::cell::Cell::get);
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, borrowed_query, 1)
            .unwrap();
        let expected = engine.measured_semantic_views(measured).unwrap().to_vec();
        let first_query_work = super::super::work_attribution::snapshot();
        let first_query_shape_calls =
            crate::SHAPINGS.with(core::cell::Cell::get) - before_query_shape_calls;
        assert!(expected.iter().any(|record| {
            record.kind == super::super::semantic_view::SEMANTIC_PARAGRAPH_MEASUREMENT
        }));
        assert!(
            expected
                .iter()
                .any(|record| { record.kind == super::super::semantic_view::SEMANTIC_LINE })
        );
        assert!(
            engine.borrowed_paragraph_layout(4, 1).unwrap() > 0,
            "borrowed layout is available through its dedicated accessor"
        );
        assert_eq!(first_query_work.intrinsic_flow_preparations, 1);
        assert_eq!(first_query_work.intrinsic_positioning_preparations, 0);
        assert_eq!(first_query_work.measurement_intrinsic_cluster_visits, 40);
        assert_eq!(first_query_work.measurement_ink_glyph_visits, 5);
        assert_eq!(first_query_shape_calls, 0);
        engine.commit_measure(measured).unwrap();
        assert_eq!(
            engine.planner_preparation_revision(4).unwrap(),
            setter_preparation_revision,
            "query-only clipped inspection does not advance the durable preparation revision"
        );
        assert_eq!(
            engine.root_revision(4).unwrap(),
            root_revision_before_setter
        );

        let (mut cold, mut cold_shaper) = shaped_engine_with_font_styles_and_geometry(
            setter_text,
            INTER,
            GLYPH_COUNT,
            &setter_styles,
            1,
            Some((&setter_geometry, 0)),
        );
        let cold_measure = cold
            .measure_paragraph_with_shaper(&mut cold_shaper, borrowed_query, 1)
            .unwrap();
        assert_eq!(engine.root_text(4).unwrap(), cold.root_text(4).unwrap());
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .styles
                .active()
                .resolved
                .segments(),
            cold.planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .styles
                .active()
                .resolved
                .segments()
        );
        assert_eq!(engine.font_binding(20), cold.font_binding(42));
        assert!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .geometry
                .active()
                == cold
                    .planners
                    .get(&4)
                    .unwrap()
                    .paragraph(1)
                    .unwrap()
                    .state
                    .geometry
                    .active(),
            "retained and cold geometry fixtures match"
        );
        assert_eq!(
            without_runtime_identity(&expected),
            without_runtime_identity(cold.measured_semantic_views(cold_measure).unwrap()),
            "first-demand ellipsis measurement and lines match a cold query"
        );
        let borrowed_glyphs = |engine: &TextEngine| {
            let count = engine.borrowed_paragraph_layout(4, 1).unwrap();
            let mut glyphs = vec![super::super::positioning::SemanticGlyph::default(); count];
            for (chunk_index, chunk) in glyphs
                .chunks_mut(super::super::layout_borrow::BORROWED_GLYPH_CAPACITY)
                .enumerate()
            {
                engine
                    .borrowed_paragraph_glyphs(
                        4,
                        1,
                        chunk_index * super::super::layout_borrow::BORROWED_GLYPH_CAPACITY,
                        chunk,
                    )
                    .unwrap();
            }
            glyphs
        };
        // Both fixtures were built with the same authenticated INTER bytes, glyph count, binding,
        // and stack by `shaped_engine_with_font_styles_and_geometry`; only runtime handles differ.
        let without_glyph_runtime_identity =
            |glyphs: &[super::super::positioning::SemanticGlyph]| {
                glyphs
                    .iter()
                    .copied()
                    .map(|mut glyph| {
                        glyph.stable_id = 0;
                        glyph.font_handle = 0;
                        glyph
                    })
                    .collect::<Vec<_>>()
            };
        assert_eq!(
            without_glyph_runtime_identity(&borrowed_glyphs(&engine)),
            without_glyph_runtime_identity(&borrowed_glyphs(&cold)),
            "borrowed renderer glyphs match the cold ellipsis output"
        );
        super::super::work_attribution::reset();
        let before_repeat_shape_calls = crate::SHAPINGS.with(core::cell::Cell::get);
        let repeated = engine
            .measure_paragraph_with_shaper(&mut shaper, borrowed_query, 1)
            .unwrap();
        assert_eq!(engine.measured_semantic_views(repeated).unwrap(), expected);
        let repeated_work = super::super::work_attribution::snapshot();
        assert_eq!(
            crate::SHAPINGS.with(core::cell::Cell::get) - before_repeat_shape_calls,
            0
        );
        assert_eq!(repeated_work.intrinsic_flow_preparations, 0);
        assert_eq!(repeated_work.intrinsic_positioning_preparations, 0);
        engine.commit_measure(repeated).unwrap();
        let prepared_revision = engine.planner_preparation_revision(4).unwrap();
        assert_eq!(prepared_revision, setter_preparation_revision);

        super::super::work_attribution::reset();
        let before_publication_shape_calls = crate::SHAPINGS.with(core::cell::Cell::get);
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, borrowed_query, 2)
            .unwrap();
        assert_eq!(engine.prepared_semantic_views(prepared).unwrap(), expected);
        let publication_work = super::super::work_attribution::snapshot();
        assert_eq!(
            crate::SHAPINGS.with(core::cell::Cell::get) - before_publication_shape_calls,
            0
        );
        assert_eq!(publication_work.intrinsic_flow_preparations, 0);
        assert_eq!(publication_work.intrinsic_positioning_preparations, 0);
        let committed = engine.commit_update(prepared).unwrap();
        assert_eq!(committed.revision, RootRevision { engine: 2, root: 2 });
        assert_eq!(engine.root_revision(4).unwrap(), committed.revision);
        assert_eq!(
            engine.planner_preparation_revision(4).unwrap(),
            prepared_revision
        );
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.published_preparation_revision,
            planner.preparation_revision
        );
        assert_visible_shape_equal(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            cold.planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            "mask-zero setter followed by ellipsis query and publication",
        );
        assert_eq!(
            without_glyph_runtime_identity(&borrowed_glyphs(&engine)),
            without_glyph_runtime_identity(&borrowed_glyphs(&cold)),
            "published borrowed glyphs remain cold-equivalent"
        );
    }

    #[test]
    fn committed_measure_is_durable_and_failed_publication_delivery_discards_root() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 0)]);
        let text = paragraph_text_mutation_bytes(&[(7, 0, 0, &[0x61, 0x62, 0x63])]);
        let mut styles = paragraph_root_style_bytes(&[(7, 1)]);
        write_u32(
            &mut styles,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            3,
        );
        let mut assignment = update(0, 0, 0);
        assignment.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assignment.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assignment.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        let measured = engine.measure_paragraph(assignment, 7).unwrap();
        assert_eq!(engine.root_revision(4).unwrap(), RootRevision::default());
        assert_eq!(engine.planners.get(&4).unwrap().measure_generation, 1);
        assert_eq!(engine.commit_measure(measured), Ok(1));
        assert_eq!(engine.planner_preparation_revision(4), Ok(1));
        assert_eq!(engine.root_revision(4).unwrap(), RootRevision::default());
        assert!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(7)
                .unwrap()
                .preparation_changed_since_publication
        );
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(7)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x61, 0x62, 0x63]
        );

        let invalid_text = paragraph_text_mutation_bytes(&[(7, 9, 1, &[0x7a])]);
        let mut invalid = update(0, 0, 0);
        invalid.text_mutations =
            parse_text_mutations(&invalid_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.measure_paragraph(invalid, 7),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.planner_preparation_revision(4), Ok(1));
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(7)
                .unwrap()
                .state
                .text
                .committed()
                .units,
            [0x61, 0x62, 0x63],
            "a rejected preparation leaves the last accepted paragraph intact"
        );

        let rejected_publication = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine
            .invalidate_after_publication_failure(rejected_publication)
            .unwrap();
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));
        engine.reset_root(4).unwrap();

        let replayed = engine.measure_paragraph(assignment, 7).unwrap();
        assert_eq!(engine.commit_measure(replayed), Ok(1));

        let prepared = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        assert_eq!(prepared.preparation_revision, 1);
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(planner.published_preparation_revision, 1);
        assert_eq!(planner.preparation_revision, 1);
        assert!(
            !planner
                .paragraph(7)
                .unwrap()
                .preparation_changed_since_publication
        );
    }

    #[test]
    fn stale_measure_result_invalidates_the_derived_root() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let edit_bytes = text_mutation_bytes(&[(1, 1, &[0x78])]);
        let mut query = update(1, 1, 1);
        query.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(query, 1).unwrap();

        // A result must belong to the latest measured preparation. A mismatched witness is an
        // internal contract breach, so discard the derived root rather than restoring it.
        engine.planners.get_mut(&4).unwrap().measure_generation += 1;
        assert_eq!(
            engine.commit_measure(measured),
            Err(EngineError::RevisionConflict)
        );
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));
        assert!(engine.invalidated_roots.contains_key(&4));
    }

    #[test]
    fn failed_measure_delivery_does_not_recycle_queried_glyph_identities() {
        let (mut engine, mut shaper) = shaped_inter_engine("A");
        let replacement = utf16("BB");
        let bytes = text_mutation_bytes(&[(0, 1, &replacement)]);
        let styles = root_style_bytes_for_text(7, replacement.len() as u32);
        let mut query = update(1, 1, 1);
        query.limits.max_clusters = 8;
        query.limits.max_lines = 8;
        query.limits.max_output_bytes = 1 << 20;
        query.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        query.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, query, 1)
            .unwrap();
        let reserved = engine.planners.get(&4).unwrap().next_glyph_id;
        engine.invalidate_after_measure_failure(measured).unwrap();
        assert_eq!(engine.root_revision(4), Err(EngineError::RootMissing));
        engine.reset_root(4).unwrap();
        assert!(engine.planners.get(&4).unwrap().next_glyph_id >= reserved);
    }

    #[test]
    fn sequential_measure_queries_commit_independent_existing_paragraphs() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        // Commit two paragraphs.
        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 2),
        ]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        // Measure paragraph 1 with a lifecycle-neutral upsert (its committed order).
        let edit_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62])]);
        let first_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 1)]);
        let mut first = update(1, 1, 1);
        first.limits.max_paragraphs = 2;
        first.paragraph_mutations =
            parse_paragraph_mutations(&first_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        first.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(first, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(!planner.paragraph(1).unwrap().state.text.is_prepared());
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61, 0x62]
        );

        // The next query independently commits paragraph 2 without disturbing paragraph 1.
        let second_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 2, 2)]);
        let second_edit = text_mutation_bytes(&[(0, 0, &[0x63])]);
        let mut second = update(1, 1, 1);
        second.limits.max_paragraphs = 2;
        second.paragraph_mutations =
            parse_paragraph_mutations(&second_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        // Route the second edit at paragraph 2.
        let mut second_edit_bytes = second_edit.clone();
        {
            use crate::wire::write_u32;
            let record = &mut second_edit_bytes[ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize..];
            write_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID, 2);
        }
        second.text_mutations =
            parse_text_mutations(&second_edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(second, 2).unwrap();
        engine.commit_measure(measured).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.pending_preparation_ids.is_empty());
        for (id, expected) in [(1, &[0x61_u16, 0x62][..]), (2, &[0x63_u16][..])] {
            let paragraph = planner.paragraph(id).unwrap();
            assert!(!paragraph.state.has_pending_preparation());
            assert_eq!(paragraph.state.text.committed().units, expected);
            assert!(paragraph.preparation_changed_since_publication);
        }

        // A read against the already retained revision must not manufacture a newer
        // preparation revision merely because its measurement transaction was accepted.
        let retained_revision = engine.planner_preparation_revision(4).unwrap();
        let mut unchanged = update(1, 1, 1);
        unchanged.limits.max_paragraphs = 2;
        let measured = engine.measure_paragraph(unchanged, 1).unwrap();
        assert_eq!(engine.commit_measure(measured), Ok(retained_revision));
        assert_eq!(
            engine.planner_preparation_revision(4),
            Ok(retained_revision)
        );
    }

    #[test]
    fn unpublished_frontier_deduplicates_owners_and_retires_removed_identity() {
        let mut planner = PlannerState::default();
        for id in 1..=3 {
            planner.prepare_upsert(id, id, false).unwrap();
        }
        planner.lifecycle_prepared = true;
        planner.commit_paragraphs(true);
        for id in [3, 1, 3, 2] {
            admit_preparation_owner(
                &mut planner.pending_preparation_ids,
                &mut planner.unpublished_preparation_ids,
                id,
            )
            .unwrap();
            planner.paragraph_mut(id).unwrap().positioned_changed = true;
            let capacity = planner.unpublished_preparation_ids.capacity();
            planner.commit_paragraphs(false);
            assert!(planner.pending_preparation_ids.is_empty());
            assert_eq!(planner.unpublished_preparation_ids.capacity(), capacity);
        }
        assert_eq!(planner.unpublished_preparation_ids, [3, 1, 2]);

        // Successful measurement can adopt removal before renderer publication.
        let removed_incarnation = planner.paragraph(3).unwrap().incarnation;
        planner.paragraph_mut(3).unwrap().pending_remove = true;
        planner.pending_next_paragraph_incarnation = planner.next_paragraph_incarnation;
        planner.lifecycle_prepared = true;
        planner.commit_paragraphs(false);
        assert_eq!(planner.unpublished_preparation_ids, [1, 2]);
        planner.pending_next_paragraph_incarnation = planner.next_paragraph_incarnation;
        planner.prepare_upsert(3, 3, false).unwrap();
        assert_ne!(
            planner.paragraph(3).unwrap().incarnation,
            removed_incarnation
        );
        admit_preparation_owner(
            &mut planner.pending_preparation_ids,
            &mut planner.unpublished_preparation_ids,
            3,
        )
        .unwrap();
        planner.paragraph_mut(3).unwrap().positioned_changed = true;
        planner.lifecycle_prepared = true;
        planner.commit_paragraphs(false);
        assert_eq!(planner.unpublished_preparation_ids, [1, 2, 3]);

        // A staged edit of an already-unpublished owner must settle once, not in both passes.
        admit_preparation_owner(
            &mut planner.pending_preparation_ids,
            &mut planner.unpublished_preparation_ids,
            1,
        )
        .unwrap();
        planner.paragraph_mut(1).unwrap().positioned_changed = true;
        {
            let inspection = &mut planner.paragraph_mut(1).unwrap().state.clipped_inspection;
            inspection.pending_mut().mode = IntrinsicInspection::Flow;
            inspection.mark_prepared();
        }
        super::super::work_attribution::reset();
        planner.commit_paragraphs(true);
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.publication_commit_visits, 3);
        assert_eq!(work.publication_ack_only_visits, 2);
        assert!(
            planner
                .paragraph(1)
                .unwrap()
                .state
                .clipped_inspection
                .active()
                .mode
                == IntrinsicInspection::Flow
        );
        assert!(planner.unpublished_preparation_ids.is_empty());
        assert!(planner.pending_preparation_ids.is_empty());
        assert!(
            planner
                .paragraphs
                .iter()
                .all(|p| !p.preparation_changed_since_publication)
        );
    }

    #[test]
    fn a_planner_prewarms_only_its_reusable_paragraph() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
            (PARAGRAPH_MUTATION_UPSERT, 3, 2),
        ]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 3;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert!(
            planner
                .paragraph(1)
                .unwrap()
                .state
                .style_mutation_scratch
                .capacity()
                >= DEFAULT_STYLE_CAPACITY
        );
        assert_eq!(
            planner
                .paragraph(2)
                .unwrap()
                .state
                .style_mutation_scratch
                .capacity(),
            0,
            "cold paragraphs must grow from authored content rather than planner defaults"
        );
        assert_eq!(
            planner
                .paragraph(3)
                .unwrap()
                .state
                .style_mutation_scratch
                .capacity(),
            0
        );
    }

    #[test]
    fn spare_reset_discards_all_stage_candidates_in_both_text_modes() {
        for preserve_text in [false, true] {
            let mut state = ParagraphState::default();
            state.initialize().unwrap();
            state.reserve_text(8).unwrap();
            state.text.pending_mut().units.push(0x61);
            state.unicode.pending_mut().analyze(&[0x61]).unwrap();
            let text_capacity = state.text.pending().units.capacity();
            let boundaries = state.unicode.pending().grapheme_boundaries().to_vec();
            state.text.mark_prepared();
            state.styles.mark_prepared();
            state.unicode.mark_prepared();
            state.bidi.mark_prepared();
            state.shaping_runs.mark_prepared();
            state.shape.mark_prepared();
            state.clusters.mark_prepared();
            state.geometry.mark_prepared();
            state.flow_layout.mark_prepared();
            state.clipped_inspection.mark_prepared();
            state.positioned.mark_prepared();

            if preserve_text {
                state.reset_for_reuse_preserving_text_candidate();
            } else {
                state.reset_for_reuse();
            }
            assert!(
                [
                    state.text.is_prepared(),
                    state.styles.is_prepared(),
                    state.unicode.is_prepared(),
                    state.bidi.is_prepared(),
                    state.shaping_runs.is_prepared(),
                    state.shape.is_prepared(),
                    state.clusters.is_prepared(),
                    state.geometry.is_prepared(),
                    state.flow_layout.is_prepared(),
                    state.clipped_inspection.is_prepared(),
                    state.positioned.is_prepared(),
                ]
                .into_iter()
                .all(|prepared| !prepared)
            );
            assert_eq!(state.text.pending().units.capacity(), text_capacity);
            assert_eq!(
                state.text.pending().units.as_slice(),
                if preserve_text { &[0x61][..] } else { &[] }
            );
            assert_eq!(
                state.unicode.pending().grapheme_boundaries(),
                if preserve_text {
                    boundaries.as_slice()
                } else {
                    &[]
                },
            );
        }
    }

    #[test]
    fn first_measurement_commits_full_lifecycle_for_later_queries() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 2),
        ]);
        let edit_bytes = text_mutation_bytes(&[(0, 0, &[0x61])]);
        let mut first = update(0, 0, 0);
        first.limits.max_paragraphs = 2;
        first.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        first.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(first, 1).unwrap();
        engine.commit_measure(measured).unwrap();

        let mut second_edit_bytes = edit_bytes.clone();
        {
            use crate::wire::write_u32;
            let record = &mut second_edit_bytes[ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize..];
            write_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID, 2);
        }
        let mut second = update(0, 0, 0);
        second.limits.max_paragraphs = 2;
        second.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        second.text_mutations =
            parse_text_mutations(&second_edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(second, 2).unwrap();
        engine.commit_measure(measured).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(planner.measure_generation, 2);
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x61]
        );
    }

    #[test]
    fn replacement_lifecycle_commits_removal_before_following_query() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
            (PARAGRAPH_MUTATION_UPSERT, 3, 2),
        ]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 3;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let replacement_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_REMOVE, 2, 0),
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 3, 1),
            (PARAGRAPH_MUTATION_UPSERT, 4, 2),
        ]);
        let mut first = update(1, 1, 1);
        first.limits.max_paragraphs = 3;
        first.paragraph_mutations =
            parse_paragraph_mutations(&replacement_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 4)
                .unwrap();
        let measured = engine.measure_paragraph(first, 4).unwrap();
        engine.commit_measure(measured).unwrap();

        let remaining_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 3, 1),
            (PARAGRAPH_MUTATION_UPSERT, 4, 2),
        ]);
        let mut second = update(1, 1, 1);
        second.limits.max_paragraphs = 3;
        second.paragraph_mutations =
            parse_paragraph_mutations(&remaining_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let measured = engine.measure_paragraph(second, 3).unwrap();
        engine.commit_measure(measured).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .active_order()
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [1, 3, 4]
        );
    }

    #[test]
    fn measure_commits_sibling_removal_before_renderer_publication() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        // The query carries only the sibling's removal: the committed paragraph 1 needs no
        // upsert to stay queryable.
        let removal_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 2, 0)]);
        let mut query = update(1, 1, 1);
        query.limits.max_paragraphs = 2;
        query.paragraph_mutations =
            parse_paragraph_mutations(&removal_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let measured = engine.measure_paragraph(query, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .active_order()
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [1]
        );

        // Rendering consumes the accepted removal without replaying that mutation.
        let prepared = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(1).is_some());
        assert!(planner.paragraph(2).is_none());
    }

    #[test]
    fn measure_rejects_foreign_semantic_rows_before_preparation() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61]), (2, 0, 0, &[0x62])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let revision_before = engine.root_revision(4).unwrap();
        let preparation_revision_before = engine.planner_preparation_revision(4).unwrap();
        let committed_text_before = [1, 2].map(|id| {
            (
                id,
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .paragraph(id)
                    .unwrap()
                    .state
                    .text
                    .committed()
                    .units
                    .clone(),
            )
        });
        for (input, label) in [
            (ParagraphInputKind::Text, "text"),
            (ParagraphInputKind::Style, "style"),
            (ParagraphInputKind::Constraint, "constraint"),
            (ParagraphInputKind::InlineObject, "inline object"),
        ] {
            let mut query = update(1, 1, 1);
            query.limits.max_paragraphs = 2;
            let mut bytes: Vec<u8>;
            match input {
                ParagraphInputKind::Text => {
                    bytes =
                        paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x78]), (2, 0, 0, &[0x79])]);
                    query.text_mutations =
                        parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
                }
                ParagraphInputKind::Style => {
                    bytes = root_style_bytes_for_text(7, 1);
                    write_u32(
                        &mut bytes,
                        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                            + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                        2,
                    );
                    query.style_mutations =
                        parse_style_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                            .unwrap();
                }
                ParagraphInputKind::Constraint => {
                    bytes = geometry_with_constraint_owners(&[2]);
                    query.geometry = parse_test_geometry(&bytes, 1, 0, query.limits);
                }
                ParagraphInputKind::InlineObject => {
                    bytes = geometry_with_inline_object_owners(&[2]);
                    query.geometry = parse_test_geometry(&bytes, 0, 1, query.limits);
                }
            }
            assert_eq!(
                engine.measure_paragraph(query, 1),
                Err(EngineError::InvalidRequest),
                "foreign {label} rows cannot be applied while measuring paragraph 1"
            );
            assert_eq!(engine.root_revision(4), Ok(revision_before));
            assert_eq!(
                engine.planner_preparation_revision(4),
                Ok(preparation_revision_before)
            );
            for (id, expected) in &committed_text_before {
                assert_eq!(
                    engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .paragraph(*id)
                        .unwrap()
                        .state
                        .text
                        .committed()
                        .units
                        .as_slice(),
                    expected.as_slice()
                );
            }
        }

        // Empty semantic input remains a valid query, and a sibling lifecycle removal is
        // allowed because lifecycle rows are separate from the single-paragraph input index.
        let mut empty_query = update(1, 1, 1);
        empty_query.limits.max_paragraphs = 2;
        let measured = engine.measure_paragraph(empty_query, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        let removal = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 2, 0)]);
        let mut sibling_removal = update(1, 1, 1);
        sibling_removal.limits.max_paragraphs = 2;
        sibling_removal.paragraph_mutations =
            parse_paragraph_mutations(&removal, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(sibling_removal, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        assert!(engine.planners.get(&4).unwrap().paragraph(2).is_none());

        let prepared = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine.root_revision(4),
            Ok(RootRevision { engine: 2, root: 2 })
        );
        assert_eq!(engine.planners.get(&4).unwrap().active_order().len(), 1);
    }

    #[test]
    fn a_query_cannot_measure_the_paragraph_its_lifecycle_removes() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let removal_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 2, 0)]);
        let mut query = update(1, 1, 1);
        query.limits.max_paragraphs = 2;
        query.paragraph_mutations =
            parse_paragraph_mutations(&removal_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        assert_eq!(
            engine.measure_paragraph(query, 2),
            Err(EngineError::InvalidRequest)
        );
        assert!(engine.planners.get(&4).unwrap().paragraph(2).is_some());
    }

    #[test]
    fn a_measured_candidate_paragraph_is_accepted_and_published_by_the_next_frame() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();
        let prepared = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(prepared).unwrap();

        // A successful measurement accepts the previously absent paragraph in the
        // synchronous engine state, while renderer publication remains pending.
        let lifecycle_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 1)]);
        let mut query = update(1, 1, 1);
        query.limits.max_paragraphs = 2;
        query.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let measured = engine.measure_paragraph(query, 7).unwrap();
        engine.commit_measure(measured).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(7).is_some());

        // The accepted lifecycle can be restated by a later query without duplicating
        // the paragraph or replaying its text edit.
        let mut repeat = update(1, 1, 1);
        repeat.limits.max_paragraphs = 2;
        repeat.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let measured = engine.measure_paragraph(repeat, 7).unwrap();
        engine.commit_measure(measured).unwrap();

        // The ordinary frame publishes the already accepted candidate.
        let follow = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        engine.commit_update(follow).unwrap();
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_some());
    }

    #[test]
    fn ordered_utf16_replacements_commit_with_the_planner_candidate() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let initial_batch =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut initial = update(0, 0, 0);
        initial.text_mutations = initial_batch;
        let prepared = engine.prepare_update(initial, 1).unwrap();
        assert!(engine.root_text(4).unwrap().is_empty());
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text
                .committed()
                .unit_ids,
            [1, 2, 3, 4]
        );
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .unicode
                .active()
                .grapheme_boundaries(),
            &[0, 1, 2, 3, 4]
        );

        // The second edit starts at the end of the intermediate five-unit string; preflight must
        // carry the first edit's resulting length forward rather than validate both against four.
        let edit_bytes = text_mutation_bytes(&[(1, 1, &[0x58, 0x59]), (5, 0, &[0x21])]);
        let edit_batch =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut edit = update(1, 1, 1);
        edit.text_mutations = edit_batch;
        let prepared = engine.prepare_update(edit, 2).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine.root_text(4).unwrap(),
            &[0x61, 0x58, 0x59, 0x63, 0x64, 0x21]
        );
        let planner = engine.planners.get(&4).unwrap();
        let paragraph = planner.first_paragraph_state().unwrap();
        assert_eq!(paragraph.text.committed().unit_ids, [1, 5, 6, 3, 4, 7]);

        let settled_capacities = {
            let planner = engine.planners.get(&4).unwrap();
            let paragraph = planner.first_paragraph_state().unwrap();
            [
                paragraph.text.committed().units.capacity(),
                paragraph.text.pending().units.capacity(),
            ]
        };
        let warm_bytes = text_mutation_bytes(&[(0, 1, &[0x7a])]);
        let warm_batch =
            parse_text_mutations(&warm_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut warm = update(2, 2, 2);
        warm.text_mutations = warm_batch;
        let prepared = engine.prepare_update(warm, 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        let paragraph = planner.first_paragraph_state().unwrap();
        assert_eq!(paragraph.text.committed().unit_ids, [8, 5, 6, 3, 4, 7]);
        assert!(paragraph.pending_text_mirrors_committed);
        assert_eq!(
            paragraph.text.pending().units,
            paragraph.text.committed().units
        );
        assert_eq!(
            paragraph.text.pending().unit_ids,
            paragraph.text.committed().unit_ids
        );
        assert_eq!(
            [
                paragraph.text.pending().units.capacity(),
                paragraph.text.committed().units.capacity(),
            ],
            settled_capacities
        );
    }

    #[test]
    fn discarded_text_candidate_reseeds_the_next_edit_from_committed_text() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let first_bytes = text_mutation_bytes(&[(1, 1, &[0x78])]);
        let first =
            parse_text_mutations(&first_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let paragraph = &mut engine
            .planners
            .get_mut(&4)
            .unwrap()
            .paragraph_mut(1)
            .unwrap()
            .state;
        let (mut candidate, edits) =
            test_preflight_candidate(paragraph.text.committed().units.as_slice(), first);
        paragraph
            .prepare_text(first, Some(&mut candidate), &edits)
            .unwrap();
        paragraph.discard_text_candidate();

        assert_eq!(paragraph.text.active().units, [0x61, 0x62, 0x63]);
        assert_eq!(paragraph.text.pending().units, [0x61, 0x78, 0x63]);
        assert!(!paragraph.pending_text_mirrors_committed);

        let next_bytes = text_mutation_bytes(&[(1, 1, &[0x79])]);
        let next = parse_text_mutations(&next_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let (mut candidate, edits) =
            test_preflight_candidate(paragraph.text.committed().units.as_slice(), next);
        paragraph
            .prepare_text(next, Some(&mut candidate), &edits)
            .unwrap();
        assert_eq!(paragraph.text.pending().units, [0x61, 0x79, 0x63]);
        assert_eq!(paragraph.text.committed().units, [0x61, 0x62, 0x63]);
    }

    #[test]
    fn distant_replacements_preserve_middle_unit_identities_across_discard_and_commit() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 16).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &utf16("aaaaaaaaaa"))]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let replacement = utf16("AaaaaaaA");
        let edit_bytes = text_mutation_bytes(&[(1, 8, replacement.as_slice())]);
        let mut edit = update(1, 1, 1);
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(edit, 2).unwrap();
        {
            let paragraph = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_eq!(
                paragraph.text_edits,
                [
                    TextEdit {
                        old_start: 1,
                        old_end: 2,
                        new_start: 1,
                        new_end: 2,
                    },
                    TextEdit {
                        old_start: 8,
                        old_end: 9,
                        new_start: 8,
                        new_end: 9,
                    },
                ]
            );
            assert!(paragraph.unicode_reused_for_text_edit);
            assert_eq!(paragraph.text.pending().unit_ids[2..8], [3, 4, 5, 6, 7, 8]);
            assert_eq!(paragraph.text.pending().unit_ids[1], 11);
            assert_eq!(paragraph.text.pending().unit_ids[8], 12);
            assert_eq!(paragraph.text.pending().next_unit_id, 13);
        }
        engine.commit_update(prepared).unwrap();
        let paragraph = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_eq!(
            paragraph.text.committed().unit_ids[2..8],
            [3, 4, 5, 6, 7, 8]
        );
        assert_eq!(paragraph.text.committed().unit_ids[1], 11);
        assert_eq!(paragraph.text.committed().unit_ids[8], 12);
        assert_eq!(paragraph.text.committed().next_unit_id, 13);
        assert!(paragraph.pending_text_mirrors_committed);
        assert_eq!(
            paragraph.text.pending().units,
            paragraph.text.committed().units
        );
        assert_eq!(
            paragraph.text.pending().unit_ids,
            paragraph.text.committed().unit_ids
        );
    }

    #[test]
    fn many_sparse_windows_visit_each_retained_cluster_once_in_both_directions() {
        const UNIT_COUNT: usize = 128;
        let edits = (1..UNIT_COUNT)
            .step_by(2)
            .map(|offset| TextEdit {
                old_start: offset,
                old_end: offset + 1,
                new_start: offset,
                new_end: offset + 1,
            })
            .collect::<Vec<_>>();
        let source_run = |direction| ShapingRun {
            text_start: 0,
            text_end: UNIT_COUNT as u32,
            script: 0,
            direction,
            bidi_level: direction,
            style: ResolvedStyle::default(),
        };
        let shaped_run = ShapedRun {
            source_run: 0,
            binding_handle: 1,
            font_handle: 1,
            text_start: 0,
            text_end: UNIT_COUNT as u32,
            glyph_start: 0,
            glyph_count: UNIT_COUNT as u32,
        };

        for rtl in [false, true] {
            let clusters = if rtl {
                (0..UNIT_COUNT as u32).rev().collect()
            } else {
                (0..UNIT_COUNT as u32).collect()
            };
            let shape = ShapeArena {
                runs: vec![shaped_run],
                glyph_ids: vec![1; UNIT_COUNT],
                clusters,
                x_advances: vec![1; UNIT_COUNT],
                y_advances: vec![0; UNIT_COUNT],
                x_offsets: vec![0; UNIT_COUNT],
                y_offsets: vec![0; UNIT_COUNT],
                glyph_flags: vec![0; UNIT_COUNT],
            };
            let before = crate::SPARSE_BOUNDARY_VISITS.with(core::cell::Cell::get);
            let mut windows = Vec::new();
            assert!(
                build_sparse_shape_windows(
                    &edits,
                    &shape,
                    shaped_run,
                    source_run(u8::from(rtl)),
                    &mut windows,
                )
                .unwrap()
            );
            let visits = crate::SPARSE_BOUNDARY_VISITS.with(core::cell::Cell::get) - before;
            assert_eq!(visits, UNIT_COUNT, "one traversal for rtl={rtl}");
            assert_eq!(windows.len(), edits.len());
            for (window, edit) in windows.iter().zip(&edits) {
                let start = edit.old_start as u32;
                let end = edit.old_end as u32;
                assert_eq!((window.old_start, window.old_end), (start, end));
                assert_eq!((window.new_start, window.new_end), (start, end));
                assert_eq!(window.probe_end, (end + 1).min(UNIT_COUNT as u32));
                let expected_glyphs = if rtl {
                    (UNIT_COUNT - edit.old_end, UNIT_COUNT - edit.old_start)
                } else {
                    (edit.old_start, edit.old_end)
                };
                assert_eq!(
                    (window.old_glyph_start, window.old_glyph_end),
                    expected_glyphs
                );
            }
        }
    }

    #[test]
    fn complete_retained_preparation_and_publication_avoid_per_fragment_root_descent() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let original = "a ".repeat(100);
        let edited = alloc::format!("b{}", &original[1..]);
        let styles = root_style_bytes_for_text(7, u32::try_from(original.len()).unwrap());
        let mut geometry = root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_WIDTH,
            20.0,
        );
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
        ] {
            write_f32(&mut geometry, region + field, 20.0);
        }
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_HEIGHT,
            5_000.0,
        );
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
            5_000.0,
        );
        write_u32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_MAX_LINES,
            256,
        );
        for field in [
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut geometry, region + field, 5_000.0);
        }

        let (mut engine, mut shaper) = shaped_engine_with_font_styles_geometry_and_extents(
            &original,
            FONT,
            9_362,
            &styles,
            1,
            Some((&geometry, 0)),
            true,
        );
        let previous_fragment_count = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .flow_layout
            .committed()
            .fragments
            .len();
        assert!(
            previous_fragment_count > 64,
            "fixture must span at least three rope leaves, got {previous_fragment_count} fragments"
        );

        let replacement = utf16(&edited);
        let edit_bytes = text_mutation_bytes(&[(
            0,
            u32::try_from(replacement.len()).unwrap(),
            replacement.as_slice(),
        )]);
        let mut edit = update(1, 1, 1);
        edit.limits.max_clusters = 256;
        edit.limits.max_lines = 256;
        edit.limits.max_output_bytes = 1 << 20;
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        crate::engine::retained_rope::reset_work_counters();
        super::super::work_attribution::reset();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, edit, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        let preparation_work = super::super::work_attribution::snapshot();
        assert_eq!(preparation_work.gather_paragraph_visits, 0);
        assert_eq!(preparation_work.gather_glyph_visits, 0);
        assert_eq!(preparation_work.publication_commit_visits, 0);
        assert!(preparation_work.newly_positioned_glyphs > 0);
        assert!(
            preparation_work.newly_positioned_glyphs + preparation_work.copied_positioned_records
                <= original.len()
        );
        super::super::work_attribution::reset();
        let mut publication = update(1, 1, 1);
        publication.limits = edit.limits;
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, publication, 2)
            .unwrap();
        let _publication = engine.prepared_plan(prepared).unwrap();
        let root_descents = crate::engine::retained_rope::index_lookups();
        let (ordered_traversals, _, ordered_records) =
            crate::engine::retained_rope::ordered_work_counters();
        assert!(ordered_traversals >= 1);
        assert!(ordered_records >= previous_fragment_count);
        assert!(
            root_descents <= 32,
            "complete preparation/publication performed {root_descents} indexed rope lookups"
        );
        engine.commit_update(prepared).unwrap();
        let publication_work = super::super::work_attribution::snapshot();
        assert_eq!(publication_work.newly_positioned_glyphs, 0);
        assert_eq!(publication_work.copied_positioned_records, 0);
        assert_eq!(publication_work.copied_positioned_bytes, 0);
        assert_eq!(publication_work.gather_paragraph_visits, 1);
        assert_eq!(publication_work.publication_commit_visits, 1);
        let rendered_count = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .positioned
            .committed()
            .glyphs()
            .len();
        assert!(publication_work.gather_glyph_visits >= rendered_count);
        std::eprintln!(
            "sparse wrapped paragraph: preparation={preparation_work:?}, publication={publication_work:?}"
        );

        let (cold_engine, _) = shaped_engine_with_font_styles_geometry_and_extents(
            &edited,
            FONT,
            9_362,
            &styles,
            1,
            Some((&geometry, 0)),
            true,
        );
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_visible_shape_equal(warm, cold, "complete retained preparation/publication");

        // Geometry-only reflow exercises the existing static-payload retention owner.
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_WIDTH,
            40.0,
        );
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
        ] {
            write_f32(&mut geometry, region + field, 40.0);
        }
        let mut reflow = update(2, 2, 2);
        reflow.limits = edit.limits;
        reflow.geometry = parse_root_geometry(&geometry, reflow.limits);
        super::super::work_attribution::reset();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, reflow, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        let geometry_work = super::super::work_attribution::snapshot();
        assert_eq!(geometry_work.newly_positioned_glyphs, 0);
        assert_eq!(geometry_work.copied_positioned_records, rendered_count);
        assert!(geometry_work.copied_positioned_bytes > 0);
        assert_eq!(geometry_work.gather_paragraph_visits, 0);
        assert_eq!(geometry_work.gather_glyph_visits, 0);
        assert_eq!(geometry_work.publication_commit_visits, 0);
        std::eprintln!("geometry-only reflow: preparation={geometry_work:?}");
        let (cold_engine, _) = shaped_engine_with_font_styles_geometry_and_extents(
            &edited,
            FONT,
            9_362,
            &styles,
            1,
            Some((&geometry, 0)),
            true,
        );
        assert_visible_shape_equal(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            "geometry-only attributed reflow",
        );
    }

    #[test]
    fn measured_first_label_edit_attributes_ordered_binding_expansion() {
        const INITIAL: &str = "ticker 000";
        const CHANGED: &str = "quote! 000";
        let initial_units = utf16(INITIAL);
        let changed_units = utf16(CHANGED);
        assert_eq!(initial_units.len(), changed_units.len());

        let mut template = root_geometry_bytes();
        write_u32(
            &mut template,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_CONSTRAINT_MAX_LINES,
            0,
        );
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        for (paragraph_count, compositing_independent, split_transform) in [
            (100_u32, false, true),
            (100, true, true),
            (1_000, false, true),
            (1_000, true, true),
            (100, false, false),
            (100, true, false),
            (1_000, false, false),
            (1_000, true, false),
        ] {
            // This native structural discriminator uses the repository's DotGothic fixture;
            // the named publication profile uses Inter and has a separate artifact receipt.
            let (mut engine, mut shaper) =
                shaped_outlined_engine_with_draw_transform(INITIAL, split_transform);
            let draw_key_mode = if split_transform { "direct" } else { "indexed" };
            let draw_key_mask = engine.codec(9).unwrap().programs()[0].draw_key_mask;
            assert_eq!(
                draw_key_mask & crate::engine::codec::BATCH_TRANSFORM != 0,
                split_transform
            );
            let lifecycle_records: Vec<_> = (2..=paragraph_count)
                .map(|id| (PARAGRAPH_MUTATION_UPSERT, id, id - 1))
                .collect();
            let text_records: Vec<_> = (2..=paragraph_count)
                .map(|id| (id, 0, 0, initial_units.as_slice()))
                .collect();
            let style_records: Vec<_> = (2..=paragraph_count).map(|id| (id, 0)).collect();
            let lifecycle = paragraph_mutation_bytes(&lifecycle_records);
            let texts = paragraph_text_mutation_bytes(&text_records);
            let mut styles = paragraph_root_style_bytes(&style_records);
            for index in 0..style_records.len() {
                write_u32(
                    &mut styles,
                    header
                        + index * abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize
                        + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                    initial_units.len() as u32,
                );
            }
            let region_offset = header + paragraph_count as usize * stride;
            let mut geometry = vec![0; region_offset + abi::ENGINE_REGION_RECORD_SIZE as usize];
            for id in 1..=paragraph_count {
                let offset = header + (id as usize - 1) * stride;
                geometry[offset..offset + stride]
                    .copy_from_slice(&template[header..header + stride]);
                write_u32(
                    &mut geometry,
                    offset + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
                    id,
                );
            }
            geometry[region_offset..].copy_from_slice(&template[header + stride..]);

            let mut initial = update(1, 1, 1);
            initial.compositing_independent = compositing_independent;
            initial.limits.max_paragraphs = paragraph_count;
            initial.limits.max_regions = paragraph_count;
            initial.limits.max_clusters = paragraph_count * initial_units.len() as u32;
            initial.limits.max_lines = paragraph_count;
            initial.limits.max_output_bytes = 1 << 24;
            initial.paragraph_mutations = parse_paragraph_mutations(
                &lifecycle,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            initial.text_mutations = parse_text_mutations(
                &texts,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            initial.style_mutations = parse_style_mutations(
                &styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            initial.geometry = parse_geometry(
                &geometry,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count,
                region_offset as u32,
                1,
                0,
                0,
                0,
                0,
                initial.limits,
            )
            .unwrap();
            let limits = initial.limits;
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, initial, 2)
                .unwrap();
            let initial_plan = engine.prepared_plan(prepared).unwrap();
            assert_eq!(
                initial_plan.primitives.len(),
                if split_transform {
                    paragraph_count as usize
                } else {
                    1
                }
            );
            assert_eq!(
                initial_plan.draws.len(),
                if split_transform {
                    paragraph_count as usize
                } else {
                    1
                }
            );
            engine.commit_update(prepared).unwrap();

            let before = engine.gather.view().plan_input().glyphs.to_vec();
            let glyphs_per_owner = engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .positioned
                .committed()
                .glyphs()
                .len();
            assert_eq!(glyphs_per_owner, 10);
            assert_eq!(before.len(), paragraph_count as usize * glyphs_per_owner);
            let bytes = paragraph_text_mutation_bytes(&[(
                1,
                0,
                initial_units.len() as u32,
                changed_units.as_slice(),
            )]);
            let mut edit = update(2, 2, 2);
            edit.compositing_independent = compositing_independent;
            edit.limits = limits;
            edit.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT;
            edit.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, edit, 1)
                .unwrap();
            assert!(!engine.measured_semantic_views(measured).unwrap().is_empty());
            engine.commit_measure(measured).unwrap();

            let binding_skips_before = engine.retained_binding_compilation_skips(4).unwrap();
            super::super::work_attribution::reset();
            let mut publication = update(2, 2, 2);
            publication.compositing_independent = compositing_independent;
            publication.limits = limits;
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, publication, 3)
                .unwrap();
            let plan = engine.prepared_plan(prepared).unwrap();
            let primitive_count = plan.primitives.len();
            let changed_draw_glyphs = usize::from(plan.primitives.first().unwrap().record_count);
            let draw_count = plan.draws.len();
            let retained_host_topology = plan.retained_host_topology;
            let warm_host: Vec<_> = plan
                .primitives
                .iter()
                .map(|primitive| {
                    (
                        primitive.record_count,
                        primitive.logical_order,
                        primitive.record_index,
                        primitive.inline_start.to_bits(),
                        primitive.block_start.to_bits(),
                        primitive.inline_extent.to_bits(),
                        primitive.block_extent.to_bits(),
                    )
                })
                .collect();
            engine.commit_update(prepared).unwrap();
            let work = super::super::work_attribution::snapshot();
            let after = engine.gather.view().plan_input().glyphs.to_vec();
            let changed_glyphs = engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(1)
                .unwrap()
                .state
                .positioned
                .committed()
                .glyphs()
                .len();
            assert_eq!(changed_glyphs, 10);
            assert_eq!(
                after.len(),
                (paragraph_count as usize - 1) * glyphs_per_owner + changed_glyphs
            );
            assert_ne!(after[0].stable_id, before[0].stable_id);
            assert!((1..=changed_glyphs).contains(&work.ordered_admission_visits));
            assert!((1..=work.ordered_admission_visits).contains(&work.ordered_instance_rewrites));
            assert_eq!(
                changed_draw_glyphs,
                if split_transform {
                    changed_glyphs
                } else {
                    after.len()
                }
            );
            let (block_size, block_bytes, retained_blocks, block_capacity) =
                engine.planners.get(&4).unwrap().plan.block_stats();
            assert_eq!(block_size, 32);
            assert!(block_bytes > 0);
            if split_transform || !compositing_independent {
                assert_eq!(
                    work.draw_reduced_glyphs,
                    if split_transform {
                        changed_glyphs
                    } else {
                        after.len()
                    }
                );
                assert_eq!(work.draw_folded_blocks, 0);
                assert_eq!((retained_blocks, block_capacity), (0, 0));
            } else {
                assert!(work.draw_reduced_glyphs <= 2 * block_size + changed_glyphs);
                assert!(work.draw_folded_blocks >= after.len() / block_size - 2);
                assert_eq!(retained_blocks, after.len() / block_size);
                assert!(block_capacity >= retained_blocks);
            }
            assert_eq!(
                engine.retained_binding_compilation_skips(4),
                Ok(binding_skips_before)
            );
            assert_eq!(
                primitive_count,
                if split_transform {
                    paragraph_count as usize
                } else {
                    1
                }
            );
            assert_eq!(
                draw_count,
                if split_transform {
                    paragraph_count as usize
                } else {
                    1
                }
            );
            assert_gather_matches_full(&mut engine);
            let (mut cold, mut cold_shaper) =
                shaped_outlined_engine_with_draw_transform(CHANGED, split_transform);
            let mut cold_initial = update(1, 1, 1);
            cold_initial.compositing_independent = compositing_independent;
            cold_initial.limits = limits;
            cold_initial.paragraph_mutations = parse_paragraph_mutations(
                &lifecycle,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            cold_initial.text_mutations = parse_text_mutations(
                &texts,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            cold_initial.style_mutations = parse_style_mutations(
                &styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            cold_initial.geometry = parse_geometry(
                &geometry,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count,
                region_offset as u32,
                1,
                0,
                0,
                0,
                0,
                limits,
            )
            .unwrap();
            let cold_prepared = cold
                .prepare_update_with_shaper(&mut cold_shaper, cold_initial, 2)
                .unwrap();
            let cold_plan = cold.prepared_plan(cold_prepared).unwrap();
            assert_eq!(cold_plan.primitives.len(), primitive_count);
            assert_eq!(cold_plan.draws.len(), draw_count);
            let cold_host: Vec<_> = cold_plan
                .primitives
                .iter()
                .map(|primitive| {
                    (
                        primitive.record_count,
                        primitive.logical_order,
                        primitive.record_index,
                        primitive.inline_start.to_bits(),
                        primitive.block_start.to_bits(),
                        primitive.inline_extent.to_bits(),
                        primitive.block_extent.to_bits(),
                    )
                })
                .collect();
            assert_eq!(warm_host, cold_host);
            assert_eq!(
                cold_plan
                    .primitives
                    .iter()
                    .map(|primitive| u32::from(primitive.record_count))
                    .sum::<u32>(),
                after.len() as u32
            );
            cold.commit_update(cold_prepared).unwrap();
            assert_gather_matches_full(&mut cold);
            let cold_gather = cold.gather.view();
            let cold_output = cold_gather.plan_input();
            assert_eq!(cold_output.glyphs.len(), after.len());
            for (warm_glyph, cold_glyph) in after.iter().zip(cold_output.glyphs) {
                let mut expected = *cold_glyph;
                expected.stable_id = warm_glyph.stable_id;
                expected.content_revision = warm_glyph.content_revision;
                expected.semantic_id = warm_glyph.semantic_id;
                assert_eq!(*warm_glyph, expected);
            }
            let warm_output = engine.gather.view();
            let warm_output = warm_output.plan_input();
            assert_eq!(
                warm_output.placement_slots.len(),
                cold_output.placement_slots.len()
            );
            let warm_placements = engine
                .planners
                .get(&4)
                .unwrap()
                .plan
                .buffer_bytes(super::super::render_plan::SESSION_PLACEMENT_BUFFER_ID)
                .unwrap();
            let cold_placements = cold
                .planners
                .get(&4)
                .unwrap()
                .plan
                .buffer_bytes(super::super::render_plan::SESSION_PLACEMENT_BUFFER_ID)
                .unwrap();
            for (warm_slot, cold_slot) in warm_output
                .placement_slots
                .iter()
                .zip(cold_output.placement_slots)
            {
                assert_ne!(*warm_slot, u32::MAX);
                assert_ne!(*cold_slot, u32::MAX);
                let warm_offset = usize::try_from(*warm_slot).unwrap().checked_mul(8).unwrap();
                let cold_offset = usize::try_from(*cold_slot).unwrap().checked_mul(8).unwrap();
                assert_eq!(
                    warm_placements.get(warm_offset..warm_offset + 8).unwrap(),
                    cold_placements.get(cold_offset..cold_offset + 8).unwrap()
                );
            }
            assert_eq!(warm_output.f32_fields, cold_output.f32_fields);
            assert_eq!(warm_output.u32_fields, cold_output.u32_fields);
            let warm_planner = engine.planners.get(&4).unwrap();
            let cold_planner = cold.planners.get(&4).unwrap();
            for id in 1..=paragraph_count {
                assert_visible_shape_equal(
                    &warm_planner.paragraph(id).unwrap().state,
                    &cold_planner.paragraph(id).unwrap().state,
                    "draw-key cold scene",
                );
            }
            std::eprintln!(
                "binding discriminator {paragraph_count} owners, compositing_independent={compositing_independent}, draw_key_mode={draw_key_mode}: glyphs={}, admission={}, rewrites={}, draw_reduced={}, primitives={primitive_count}, draws={draw_count}, retained_host_topology={retained_host_topology}",
                after.len(),
                work.ordered_admission_visits,
                work.ordered_instance_rewrites,
                work.draw_reduced_glyphs,
            );
        }
    }

    #[test]
    fn sparse_edit_work_attribution_separates_preparation_from_root_publication() {
        // Reuse the shaped cold oracle, real font and wire encoders. Counter assertions describe
        // work, not elapsed time; each phase resets after fixture setup/cold construction.
        let mut template = root_geometry_bytes();
        write_u32(
            &mut template,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_CONSTRAINT_MAX_LINES,
            0,
        );
        let template_region = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
            + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        for (start, clip_start, end, clip_end, offset) in [
            (
                abi::ENGINE_REGION_INLINE_START,
                abi::ENGINE_REGION_CLIP_INLINE_START,
                abi::ENGINE_REGION_INLINE_END,
                abi::ENGINE_REGION_CLIP_INLINE_END,
                7.0,
            ),
            (
                abi::ENGINE_REGION_BLOCK_START,
                abi::ENGINE_REGION_CLIP_BLOCK_START,
                abi::ENGINE_REGION_BLOCK_END,
                abi::ENGINE_REGION_CLIP_BLOCK_END,
                11.0,
            ),
        ] {
            write_f32(&mut template, template_region + start, offset);
            write_f32(&mut template, template_region + clip_start, offset);
            write_f32(&mut template, template_region + end, 100.0 + offset);
            write_f32(&mut template, template_region + clip_end, 100.0 + offset);
        }
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let cold_styles = root_style_bytes_for_text(7, 1);
        let (cold_changed, _) = shaped_engine_with_font_styles_geometry_and_extents(
            "b",
            FONT,
            9_362,
            &cold_styles,
            1,
            Some((&template, 0)),
            true,
        );
        let cold_changed = cold_changed.planners.get(&4).unwrap();
        for paragraph_count in [10_u32, 16, 100, 1_000, 1_024] {
            let (mut engine, mut shaper) = shaped_outlined_engine("a");
            let lifecycle_records: Vec<_> = (2..=paragraph_count)
                .map(|id| (PARAGRAPH_MUTATION_UPSERT, id, id - 1))
                .collect();
            let units = [0x61_u16];
            let text_records: Vec<_> = (2..=paragraph_count)
                .map(|id| (id, 0, 0, units.as_slice()))
                .collect();
            let style_records: Vec<_> = (2..=paragraph_count).map(|id| (id, 0)).collect();
            let lifecycle = paragraph_mutation_bytes(&lifecycle_records);
            let texts = paragraph_text_mutation_bytes(&text_records);
            let styles = paragraph_root_style_bytes(&style_records);
            let mut initial = update(1, 1, 1);
            initial.limits.max_paragraphs = paragraph_count;
            initial.limits.max_regions = paragraph_count;
            initial.limits.max_clusters = paragraph_count;
            initial.limits.max_lines = paragraph_count;
            initial.limits.max_output_bytes = 1 << 24;
            initial.paragraph_mutations = parse_paragraph_mutations(
                &lifecycle,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            initial.text_mutations = parse_text_mutations(
                &texts,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            initial.style_mutations = parse_style_mutations(
                &styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count - 1,
            )
            .unwrap();
            // Share the existing region while assigning its constraint to every label.
            let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
            let stride = abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
            let region_offset = header + paragraph_count as usize * stride;
            let mut geometry = vec![0; region_offset + abi::ENGINE_REGION_RECORD_SIZE as usize];
            for id in 1..=paragraph_count {
                let offset = header + (id as usize - 1) * stride;
                geometry[offset..offset + stride]
                    .copy_from_slice(&template[header..header + stride]);
                write_u32(
                    &mut geometry,
                    offset + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
                    id,
                );
            }
            geometry[region_offset..].copy_from_slice(&template[header + stride..]);
            initial.geometry = parse_geometry(
                &geometry,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                paragraph_count,
                region_offset as u32,
                1,
                0,
                0,
                0,
                0,
                initial.limits,
            )
            .unwrap();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, initial, 2)
                .unwrap();
            let buffer_id = super::super::render_plan::SESSION_PLACEMENT_BUFFER_ID;
            let initial_plan = engine.prepared_plan(prepared).unwrap();
            let initial_generation = initial_plan
                .session_buffers
                .iter()
                .find(|buffer| buffer.id == buffer_id)
                .map(|buffer| buffer.generation)
                .or_else(|| {
                    initial_plan
                        .session_patches
                        .iter()
                        .find(|patch| patch.buffer_id == buffer_id)
                        .map(|patch| patch.buffer_generation)
                })
                .unwrap();
            engine.commit_update(prepared).unwrap();
            if paragraph_count == 1_024 {
                // Ten real shaped glyphs distinguish per-owner from per-glyph traversal.
                // The first cycle establishes that state outside the attributed intervals.
                // Font/geometry remain this cold fixture's, not the Inter Labs environment.
                let bulk_styles = root_style_bytes_for_text(7, 10);
                let (cold_original, _) = shaped_engine_with_font_styles_geometry_and_extents(
                    "aaaaaaaaaa",
                    FONT,
                    9_362,
                    &bulk_styles,
                    1,
                    Some((&template, 0)),
                    true,
                );
                let (cold_bulk_changed, _) = shaped_engine_with_font_styles_geometry_and_extents(
                    "bbbbbbbbbb",
                    FONT,
                    9_362,
                    &bulk_styles,
                    1,
                    Some((&template, 0)),
                    true,
                );
                let cold_original = cold_original.planners.get(&4).unwrap();
                let cold_bulk_changed = cold_bulk_changed.planners.get(&4).unwrap();
                assert_eq!(
                    cold_original
                        .first_paragraph_state()
                        .unwrap()
                        .positioned
                        .committed()
                        .glyphs()
                        .len(),
                    10
                );
                assert_eq!(
                    cold_bulk_changed
                        .first_paragraph_state()
                        .unwrap()
                        .positioned
                        .committed()
                        .glyphs()
                        .len(),
                    10
                );
                initial.limits.max_clusters = paragraph_count * 10;
                for (step, unit) in [0x61_u16, 0x62, 0x61].into_iter().enumerate() {
                    let revision = 2 + u32::try_from(step).unwrap();
                    super::super::work_attribution::reset();
                    for id in 1..=paragraph_count {
                        let units = [unit; 10];
                        let bytes = paragraph_text_mutation_bytes(&[(
                            id,
                            0,
                            if step == 0 { 1 } else { 10 },
                            units.as_slice(),
                        )]);
                        let mut styles = paragraph_root_style_bytes(&[(id, 0)]);
                        write_u32(
                            &mut styles,
                            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                                + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                            10,
                        );
                        let mut edit = update(revision, revision, revision);
                        edit.limits = initial.limits;
                        edit.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT
                            | super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT;
                        edit.text_mutations =
                            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                                .unwrap();
                        if step == 0 {
                            edit.style_mutations = parse_style_mutations(
                                &styles,
                                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                                1,
                            )
                            .unwrap();
                        }
                        let measured = engine
                            .measure_paragraph_with_shaper(&mut shaper, edit, id)
                            .unwrap();
                        let records = engine.measured_semantic_views(measured).unwrap();
                        assert!(!records.is_empty());
                        // Use the actual Wasm setter serializer, not estimated byte counts.
                        let layout = super::super::render_plan_wire::query_layout(records).unwrap();
                        let mut output = vec![0; usize::try_from(layout.byte_length).unwrap()];
                        let encoded =
                            super::super::render_plan_wire::encode_query(records, &mut output)
                                .unwrap();
                        assert_eq!(encoded.byte_length, layout.byte_length);
                        engine.commit_measure(measured).unwrap();
                    }
                    let preparation = super::super::work_attribution::snapshot();
                    if step != 0 {
                        assert_eq!(preparation.gather_glyph_visits, 0);
                        assert_eq!(preparation.ordered_admission_visits, 0);
                        assert_eq!(preparation.draw_reduced_glyphs, 0);
                        assert_eq!(
                            preparation.measurement_ink_glyph_visits,
                            paragraph_count as usize * 10
                        );
                        assert_eq!(
                            preparation.measurement_intrinsic_cluster_visits,
                            paragraph_count as usize * 10
                        );
                        assert!(preparation.query_serialized_records >= paragraph_count as usize);
                        assert!(preparation.query_serialized_bytes > 0);
                    }
                    super::super::work_attribution::reset();
                    let mut publication = update(revision, revision, revision);
                    publication.limits = initial.limits;
                    assert_eq!(publication.semantic_view_mask, 0);
                    let prepared = engine
                        .prepare_update_with_shaper(&mut shaper, publication, revision + 1)
                        .unwrap();
                    engine.commit_update(prepared).unwrap();
                    let publication = super::super::work_attribution::snapshot();
                    if step != 0 {
                        assert_eq!(publication.newly_positioned_glyphs, 0);
                        assert_eq!(publication.copied_positioned_records, 0);
                        assert_eq!(publication.measurement_ink_glyph_visits, 0);
                        assert_eq!(publication.measurement_intrinsic_cluster_visits, 0);
                        assert_eq!(publication.query_serialized_records, 0);
                        assert_eq!(publication.query_serialized_bytes, 0);
                        assert_eq!(
                            publication.publication_commit_visits,
                            paragraph_count as usize
                        );
                        // Only the first mismatched placement-key retained attempt remains.
                        // Exact full output dirt uses sequential physical admission; the former
                        // per-glyph fetches were leaf-local, not whole-tree descents.
                        assert_eq!(publication.rope_point_queries, 1);
                        std::eprintln!(
                            "bulk {paragraph_count}x10 step{step}: preparation={preparation:?}, publication={publication:?}"
                        );
                    }
                    // Observe cold shape/full gather outside the attributed phases.
                    let cold = if unit == 0x62 {
                        cold_bulk_changed
                    } else {
                        cold_original
                    };
                    for id in 1..=paragraph_count {
                        assert_visible_shape_equal(
                            &engine
                                .planners
                                .get(&4)
                                .unwrap()
                                .paragraph(id)
                                .unwrap()
                                .state,
                            cold.first_paragraph_state().unwrap(),
                            "bulk setter/measurement cold parity",
                        );
                    }
                    assert_gather_matches_full(&mut engine);
                }
                continue;
            }
            let clean = engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(2)
                .unwrap()
                .state
                .positioned
                .committed();
            let clean_handle = clean.placement_handle(0).unwrap();
            let clean_translation = clean.placement_translations()[0];
            assert_ne!(clean_translation.translation_inline, 0.0);
            assert_ne!(clean_translation.translation_block, 0.0);
            let clean_offset = clean_handle.slot().get() as usize * 8;
            let clean_bytes = engine
                .planners
                .get(&4)
                .unwrap()
                .plan
                .buffer_bytes(buffer_id)
                .unwrap()[clean_offset..clean_offset + 8]
                .to_vec();
            let untouched: Vec<_> = (2..=paragraph_count)
                .map(|id| {
                    let paragraph = engine.planners.get(&4).unwrap().paragraph(id).unwrap();
                    (id, paragraph.state.positioned.committed().glyphs().to_vec())
                })
                .collect();

            let text = text_mutation_bytes(&[(0, 1, &[0x62])]);
            let mut edit = update(2, 2, 2);
            edit.limits = initial.limits;
            edit.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, edit, 1)
                .unwrap();
            engine.commit_measure(measured).unwrap();
            let preparation = super::super::work_attribution::snapshot();
            assert_eq!(preparation.newly_positioned_glyphs, 1);
            assert_eq!(preparation.copied_positioned_records, 0);
            assert_eq!(preparation.copied_positioned_bytes, 0);

            assert_eq!(preparation.gather_paragraph_visits, 0);
            assert_eq!(preparation.gather_glyph_visits, 0);
            assert_eq!(preparation.publication_commit_visits, 0);

            let mut publication = update(2, 2, 2);
            publication.limits = initial.limits;
            super::super::work_attribution::reset();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, publication, 3)
                .unwrap();
            if paragraph_count == 16 {
                // Exact-capacity cold root: one changed anchor adds slot16, requiring17 live
                // records before its retired slot can be acknowledged. Clean rows must survive.
                let replacement = engine
                    .prepared_plan(prepared)
                    .unwrap()
                    .session_buffers
                    .iter()
                    .find(|buffer| buffer.id == buffer_id)
                    .unwrap();
                assert!(replacement.generation > initial_generation);
                assert!(replacement.capacity_records > 16);
            }
            engine.commit_update(prepared).unwrap();
            let clean = engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(2)
                .unwrap()
                .state
                .positioned
                .committed();
            assert_eq!(clean.placement_handle(0), Some(clean_handle));
            assert_eq!(
                &engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .plan
                    .buffer_bytes(buffer_id)
                    .unwrap()[clean_offset..clean_offset + 8],
                clean_bytes
            );
            let publication = super::super::work_attribution::snapshot();
            assert_eq!(publication.newly_positioned_glyphs, 0);
            assert_eq!(publication.copied_positioned_records, 0);
            assert_eq!(publication.copied_positioned_bytes, 0);
            assert_eq!(publication.gather_paragraph_visits, 1);
            assert_eq!(publication.gather_range_skips, 1);
            assert_eq!(publication.placement_key_owner_visits, 1);
            assert_eq!(publication.placement_binding_owner_visits, 1);
            assert_eq!(publication.placement_slot_checks, 1);
            assert_eq!(publication.placement_reconciled_key_groups, 2);
            assert_eq!(publication.ordered_admission_visits, 1);
            assert_eq!(publication.ordered_instance_rewrites, 1);
            assert_eq!(publication.ordered_instance_comparisons, 1);
            assert_eq!(publication.publication_commit_visits, 1);
            // Include a retained-gather attempt followed by suffix rebuild if needed.
            assert!(publication.gather_glyph_visits >= 1);
            assert!(publication.gather_glyph_visits <= 2);
            std::eprintln!(
                "{paragraph_count} paragraphs: preparation={preparation:?}, publication={publication:?}"
            );

            let planner = engine.planners.get(&4).unwrap();
            assert_visible_shape_equal(
                &planner.paragraph(1).unwrap().state,
                cold_changed.first_paragraph_state().unwrap(),
                "sparse root edit attribution",
            );
            for (id, glyphs) in &untouched {
                assert_eq!(
                    planner
                        .paragraph(*id)
                        .unwrap()
                        .state
                        .positioned
                        .committed()
                        .glyphs(),
                    glyphs,
                );
                assert_eq!(engine.planner_paragraph_preparation_count(4, *id), Ok(1));
            }
            assert_gather_matches_full(&mut engine);

            // First/middle/last dirty owners and separated islands must jump whole clean
            // intervals. Count changes and recordless selection changes use the same fallback.
            let mut order_revision = 3;
            for (ids, units, sparse_expected) in [
                (vec![1], vec![0x63], true),
                (vec![paragraph_count / 2], vec![0x64], true),
                (vec![paragraph_count], vec![0x65], true),
                (
                    vec![1, paragraph_count / 2, paragraph_count],
                    vec![0x66],
                    true,
                ),
                (vec![paragraph_count / 2], vec![0x61, 0x62], false),
                (vec![paragraph_count / 2], vec![0x61], false),
                (vec![paragraph_count / 2], vec![0xffff], false),
                (vec![paragraph_count / 2], vec![0x61], false),
                (vec![paragraph_count], vec![0x61, 0x62], false),
                (vec![paragraph_count], vec![0x61], false),
                (vec![paragraph_count], vec![0xffff], false),
                (vec![paragraph_count], vec![0x61], false),
                // Separated growing/shrinking owners exercise cumulative range offsets.
                (vec![1, paragraph_count / 2], vec![0x61, 0x62], false),
                (vec![1, paragraph_count / 2], vec![0x61], false),
            ] {
                let revision = order_revision;
                order_revision += 1;
                let mut count_changed = false;
                for id in &ids {
                    let count = engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .paragraph(*id)
                        .unwrap()
                        .state
                        .text
                        .committed()
                        .units
                        .len();
                    count_changed |= count != units.len();
                    let bytes = paragraph_text_mutation_bytes(&[(
                        *id,
                        0,
                        u32::try_from(count).unwrap(),
                        units.as_slice(),
                    )]);
                    let mut styles = paragraph_root_style_bytes(&[(*id, 0)]);
                    write_u32(
                        &mut styles,
                        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                            + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                        u32::try_from(units.len()).unwrap(),
                    );
                    let mut edit = update(revision, revision, revision);
                    edit.limits = initial.limits;
                    edit.text_mutations =
                        parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
                    // Root styles explicitly cover the text range; resizing text also resizes
                    // that authored range, exactly as a valid public assignment does.
                    if count != units.len() {
                        edit.style_mutations =
                            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                                .unwrap();
                    }
                    let measured = engine
                        .measure_paragraph_with_shaper(&mut shaper, edit, *id)
                        .unwrap();
                    engine.commit_measure(measured).unwrap();
                    if count != units.len() {
                        let repeated_bytes = paragraph_text_mutation_bytes(&[(
                            *id,
                            0,
                            u32::try_from(units.len()).unwrap(),
                            units.as_slice(),
                        )]);
                        let mut repeated = update(revision, revision, revision);
                        repeated.limits = initial.limits;
                        repeated.text_mutations = parse_text_mutations(
                            &repeated_bytes,
                            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                            1,
                        )
                        .unwrap();
                        let measured = engine
                            .measure_paragraph_with_shaper(&mut shaper, repeated, *id)
                            .unwrap();
                        engine.commit_measure(measured).unwrap();
                    }
                }
                let mut publication = update(revision, revision, revision);
                publication.limits = initial.limits;
                let placement_ranges_unchanged = ids.iter().all(|id| {
                    let paragraph = engine.planners.get(&4).unwrap().paragraph(*id).unwrap();
                    paragraph.placement_range.end - paragraph.placement_range.start
                        == paragraph
                            .state
                            .positioned
                            .active()
                            .placement_segments()
                            .len()
                });
                super::super::work_attribution::reset();
                let prepared = engine
                    .prepare_update_with_shaper(&mut shaper, publication, revision + 1)
                    .unwrap();
                engine.commit_update(prepared).unwrap();
                let work = super::super::work_attribution::snapshot();
                if placement_ranges_unchanged {
                    assert_eq!(work.placement_key_owner_visits, ids.len());
                    assert_eq!(work.placement_binding_owner_visits, ids.len());
                }
                if count_changed && ids.len() > 1 {
                    assert_eq!(work.gather_paragraph_visits, ids.len());
                    assert!(work.gather_glyph_visits <= ids.len() * (units.len() + 1));
                    assert_eq!(work.gather_envelope_splices, 1);
                    assert!(work.gather_retained_gap_rows > 0);
                }
                if count_changed && ids == [paragraph_count / 2] {
                    assert_eq!(work.gather_paragraph_visits, 1);
                    assert!(work.gather_glyph_visits <= units.len() + 1);
                }
                if !sparse_expected && ids == [paragraph_count] && units != [0xffff] {
                    // Count growth/shrink and recordless-to-selected tail preserve every
                    // preceding paragraph's physical instance records.
                    assert_eq!(work.gather_paragraph_visits, 1);
                    assert_eq!(work.ordered_admission_visits, units.len());
                    assert_eq!(work.ordered_instance_rewrites, units.len());
                    assert_eq!(work.ordered_instance_comparisons, units.len());
                }
                if sparse_expected {
                    assert_eq!(work.gather_paragraph_visits, ids.len());
                    assert_eq!(work.placement_key_owner_visits, ids.len());
                    assert_eq!(work.placement_binding_owner_visits, ids.len());
                    // The exact-key attempt stops at the first changed anchor. The shared
                    // structural union independently visits one old and one new key per owner.
                    assert!((1..=ids.len()).contains(&work.placement_slot_checks));
                    assert_eq!(work.placement_reconciled_key_groups, 2 * ids.len());
                    assert_eq!(work.ordered_admission_visits, ids.len());
                    assert_eq!(work.ordered_instance_rewrites, ids.len());
                    assert_eq!(work.ordered_instance_comparisons, ids.len());
                    let intervals = if ids.len() == 3 {
                        2
                    } else if ids[0] == 1 || ids[0] == paragraph_count {
                        1
                    } else {
                        2
                    };
                    assert_eq!(work.gather_range_skips, intervals);
                }
                assert_gather_matches_full(&mut engine);
            }

            let middle = paragraph_count / 2;
            for (first_text, middle_text, segment_counts, sparse, decorate) in [
                ("aa", "a\na", [1, 3], false, false),
                ("a\na", "aa", [3, 1], false, false),
                ("b\nb", "aa", [3, 1], true, false),
                ("b\nb", "aa", [3, 1], true, true),
                ("c\nc", "aa", [3, 1], true, true),
            ] {
                for (id, value) in [(1, first_text), (middle, middle_text)] {
                    let units: Vec<_> = value.encode_utf16().collect();
                    let old = &engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .paragraph(id)
                        .unwrap()
                        .state;
                    if old.text.committed().units == units && !(decorate && id == 1) {
                        continue;
                    }
                    let bytes = paragraph_text_mutation_bytes(&[(
                        id,
                        0,
                        u32::try_from(old.text.committed().units.len()).unwrap(),
                        units.as_slice(),
                    )]);
                    let mut styles = if decorate && id == 1 {
                        decorated_root_style_bytes_for_text(7, u32::try_from(units.len()).unwrap())
                    } else {
                        paragraph_root_style_bytes(&[(id, 0)])
                    };
                    write_u32(
                        &mut styles,
                        ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                            + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                        u32::try_from(units.len()).unwrap(),
                    );
                    let mut edit = update(order_revision, order_revision, order_revision);
                    edit.limits = initial.limits;
                    edit.text_mutations =
                        parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
                    edit.style_mutations =
                        parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                            .unwrap();
                    let measured = engine
                        .measure_paragraph_with_shaper(&mut shaper, edit, id)
                        .unwrap();
                    engine.commit_measure(measured).unwrap();
                }
                let planner = engine.planners.get(&4).unwrap();
                assert_eq!(
                    [1, middle].map(|id| planner
                        .paragraph(id)
                        .unwrap()
                        .state
                        .positioned
                        .active()
                        .placement_segments()
                        .len()),
                    segment_counts,
                    "balanced segment changes preserve the total, not per-owner ranges",
                );
                let mut publication = update(order_revision, order_revision, order_revision);
                publication.limits = initial.limits;
                super::super::work_attribution::reset();
                let prepared = engine
                    .prepare_update_with_shaper(&mut shaper, publication, order_revision + 1)
                    .unwrap();
                engine.commit_update(prepared).unwrap();
                let work = super::super::work_attribution::snapshot();
                let owners = if sparse { 1 } else { paragraph_count as usize };
                assert_eq!(work.placement_key_owner_visits, owners);
                assert_eq!(work.placement_binding_owner_visits, owners);
                assert_gather_matches_full(&mut engine);
                for (id, value) in [(1, first_text), (middle, middle_text)] {
                    let styles = if decorate && id == 1 {
                        decorated_root_style_bytes_for_text(7, value.len() as u32)
                    } else {
                        root_style_bytes_for_text(7, value.len() as u32)
                    };
                    let (cold, _) = shaped_engine_with_font_styles_geometry_and_extents(
                        value,
                        FONT,
                        9_362,
                        &styles,
                        1,
                        Some((&template, 0)),
                        true,
                    );
                    let warm = &engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .paragraph(id)
                        .unwrap()
                        .state;
                    let cold = cold
                        .planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap();
                    assert_visible_shape_equal(warm, cold, "balanced placement cold parity");
                }
                if decorate {
                    assert!(
                        engine
                            .planners
                            .get(&4)
                            .unwrap()
                            .gathered_source_count
                            .is_none()
                    );
                }
                order_revision += 1;
            }

            // Synchronous measurement can adopt an interior order change while the old
            // gathered workspace still exists. Bulk ranges must not borrow those endpoints.
            let lifecycle = paragraph_mutation_bytes(&[
                (PARAGRAPH_MUTATION_UPSERT, middle, middle),
                (PARAGRAPH_MUTATION_UPSERT, middle + 1, middle - 1),
            ]);
            let mut reordered = update(order_revision, order_revision, order_revision);
            reordered.limits = initial.limits;
            reordered.paragraph_mutations =
                parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                    .unwrap();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, reordered, 1)
                .unwrap();
            engine.commit_measure(measured).unwrap();
            assert!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .gathered_source_count
                    .is_none()
            );
            let mut publication = update(order_revision, order_revision, order_revision);
            publication.limits = initial.limits;
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, publication, order_revision + 1)
                .unwrap();
            assert_gather_matches_full(&mut engine);
            engine.commit_update(prepared).unwrap();
            assert_gather_matches_full(&mut engine);
            // A renderer that has not accepted the Rust-canonical revision requests a
            // checkpoint. Sparse occurrence metadata must not suppress full retransmission.
            let mut checkpoint = update(order_revision + 1, order_revision, order_revision);
            checkpoint.limits = initial.limits;
            super::super::work_attribution::reset();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, checkpoint, order_revision + 2)
                .unwrap();
            assert!(prepared.checkpoint);
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.placement_key_owner_visits, paragraph_count as usize);
            assert_eq!(
                work.placement_binding_owner_visits,
                paragraph_count as usize
            );
            let plan = engine.prepared_plan(prepared).unwrap();
            assert!(!plan.session_buffers.is_empty());
            assert!(!plan.session_payload.is_empty());
            engine.commit_update(prepared).unwrap();
            assert!(engine.planners.get(&4).unwrap().placement_ranges_current);
            assert!(
                !engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .pending_placement_ranges_refresh
            );
            assert_gather_matches_full(&mut engine);
            let clean = engine
                .planners
                .get(&4)
                .unwrap()
                .paragraph(2)
                .unwrap()
                .state
                .positioned
                .committed();
            assert_eq!(clean.placement_handle(0), Some(clean_handle));
            assert_eq!(
                &engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .plan
                    .buffer_bytes(buffer_id)
                    .unwrap()[clean_offset..clean_offset + 8],
                clean_bytes
            );
        }
    }

    #[test]
    fn codec_run_accounting_respects_active_mask() {
        let codec = validated_codec(TechniqueId(1));
        let program = &codec.programs()[0];
        let field = [1.0_f32, 2.0, 3.0, 4.0, 5.0];
        let fields: [&[f32]; 1] = [&field];
        let input = super::super::plan_input::PlanInput {
            glyphs: &[],
            placement_slots: &[],
            semantic_change_masks: &[],
            f32_fields: &fields,
            u32_fields: &[],
            order_independent: false,
        };
        let starts = [0; super::super::plan_packing::MAX_PHYSICAL_BUFFERS];
        let mut payload = [0_u8; 20];
        super::super::work_attribution::reset();
        for active_buffers in [0, 1] {
            super::super::plan_packing::execute_run(
                &codec,
                CapabilitySetId(1),
                program,
                input,
                0,
                5,
                0,
                &mut payload,
                &starts,
                5,
                active_buffers,
            )
            .unwrap();
        }
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.codec_successful_runs, 2);
        assert_eq!(work.codec_run_count_bins[0].records, 5);
        assert_eq!(work.codec_run_count_bins[0].invocations, 2);
        assert_eq!(work.codec_simd_eligible_groups, 2);
        assert_eq!(work.codec_eligible_scalar_tails, 2);
        assert_eq!(work.codec_repeated_group_steps, 0);
        assert_eq!(work.codec_repeated_scalar_tail_steps, 0);
        assert_eq!(work.codec_active_f32_store_group_operations, 1);
    }

    #[test]
    fn dense_inter_setter_publication_attributes_actual_work() {
        const INTER: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        const OWNERS: u32 = 1_024;
        let alpha: Vec<Vec<u16>> = (0..OWNERS)
            .map(|index| utf16(&alloc::format!("alpha {index:04}")))
            .collect();
        let bravo: Vec<Vec<u16>> = (0..OWNERS)
            .map(|index| utf16(&alloc::format!("bravo {index:04}")))
            .collect();
        assert!(alpha.iter().chain(&bravo).all(|text| text.len() == 10));
        let style = root_style_bytes_for_text(7, 10);
        let mut template = root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_f32(
            &mut template,
            constraint + abi::ENGINE_CONSTRAINT_WIDTH,
            160.0,
        );
        write_f32(&mut template, region + abi::ENGINE_REGION_INLINE_END, 160.0);
        write_f32(
            &mut template,
            region + abi::ENGINE_REGION_CLIP_INLINE_END,
            160.0,
        );
        let (mut engine, mut shaper) = shaped_engine_with_font_styles_geometry_and_extents(
            "alpha 0000",
            INTER,
            2_937,
            &style,
            1,
            Some((&template, 0)),
            true,
        );
        let lifecycle_records: Vec<_> = (2..=OWNERS)
            .map(|id| (PARAGRAPH_MUTATION_UPSERT, id, id - 1))
            .collect();
        let text_records: Vec<_> = (2..=OWNERS)
            .map(|id| (id, 0, 0, alpha[(id - 1) as usize].as_slice()))
            .collect();
        let style_records: Vec<_> = (2..=OWNERS).map(|id| (id, 0)).collect();
        let lifecycle = paragraph_mutation_bytes(&lifecycle_records);
        let texts = paragraph_text_mutation_bytes(&text_records);
        let mut styles = paragraph_root_style_bytes(&style_records);
        let style_stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        for index in 0..style_records.len() {
            write_u32(
                &mut styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                    + index * style_stride
                    + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                10,
            );
        }
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let constraint_stride = abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        let region_offset = header + OWNERS as usize * constraint_stride;
        let mut geometry = vec![0; region_offset + abi::ENGINE_REGION_RECORD_SIZE as usize];
        for id in 1..=OWNERS {
            let offset = header + (id as usize - 1) * constraint_stride;
            geometry[offset..offset + constraint_stride]
                .copy_from_slice(&template[header..header + constraint_stride]);
            write_u32(
                &mut geometry,
                offset + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
                id,
            );
        }
        geometry[region_offset..].copy_from_slice(&template[header + constraint_stride..]);
        let mut limits = update(1, 1, 1).limits;
        limits.max_paragraphs = OWNERS;
        limits.max_regions = OWNERS;
        limits.max_clusters = OWNERS * 10;
        limits.max_lines = OWNERS;
        limits.max_output_bytes = 1 << 24;
        let mut added = update(1, 1, 1);
        added.limits = limits;
        added.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, OWNERS - 1)
                .unwrap();
        added.text_mutations =
            parse_text_mutations(&texts, ENGINE_UPDATE_REQUEST_HEADER_SIZE, OWNERS - 1).unwrap();
        added.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, OWNERS - 1).unwrap();
        added.geometry = parse_geometry(
            &geometry,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
            OWNERS,
            region_offset as u32,
            1,
            0,
            0,
            0,
            0,
            limits,
        )
        .unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, added, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();

        for (cycle, target) in [&bravo, &alpha].into_iter().enumerate() {
            let revision = 2 + cycle as u32;
            let before_view = engine.gather.view();
            let before_output = before_view.plan_input();
            let before = before_output.glyphs.to_vec();
            let before_f32: Vec<Vec<u32>> = before_output
                .f32_fields
                .iter()
                .map(|field| field.iter().map(|value| value.to_bits()).collect())
                .collect();
            let before_u32: Vec<Vec<u32>> = before_output
                .u32_fields
                .iter()
                .map(|field| field.to_vec())
                .collect();
            super::super::work_attribution::reset();
            for id in 1..=OWNERS {
                let bytes = paragraph_text_mutation_bytes(&[(
                    id,
                    0,
                    10,
                    target[(id - 1) as usize].as_slice(),
                )]);
                let mut edit = update(revision, revision, revision);
                edit.limits = limits;
                edit.semantic_view_mask = 0;
                edit.text_mutations =
                    parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
                let measured = engine
                    .measure_paragraph_with_shaper(&mut shaper, edit, id)
                    .unwrap();
                engine.commit_measure(measured).unwrap();
            }
            let preparation = super::super::work_attribution::snapshot();
            assert_eq!(preparation.harfrust_calls, OWNERS as usize);
            assert_eq!(preparation.harfrust_utf16_units, OWNERS as usize * 10);
            assert_eq!(preparation.query_serialized_records, 0);
            assert_eq!(preparation.query_serialized_bytes, 0);
            super::super::work_attribution::reset();
            let mut publication = update(revision, revision, revision);
            publication.limits = limits;
            assert_eq!(publication.text_mutations.len(), 0);
            assert_eq!(publication.style_mutations.len(), 0);
            assert_eq!(publication.semantic_view_mask, 0);
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, publication, revision + 1)
                .unwrap();
            engine.commit_update(prepared).unwrap();
            let published = super::super::work_attribution::snapshot();
            assert_eq!(published.harfrust_calls, 0);
            assert_eq!(published.recomposed_flow_lines, 0);
            assert_eq!(published.newly_positioned_glyphs, 0);
            assert_eq!(published.query_serialized_records, 0);
            assert_eq!(published.query_serialized_bytes, 0);
            let run_bins: Vec<_> = published
                .codec_run_count_bins
                .iter()
                .filter(|bin| bin.invocations != 0)
                .map(|bin| (bin.records, bin.invocations))
                .collect();
            assert_eq!(published.codec_run_count_bin_overflow, 0);
            assert_eq!(
                run_bins.iter().map(|(_, count)| count).sum::<usize>(),
                published.codec_successful_runs
            );
            assert_eq!(
                run_bins
                    .iter()
                    .map(|(records, count)| *records as usize * count)
                    .sum::<usize>(),
                published.codec_executed_records
            );
            assert_eq!(
                published.codec_simd_eligible_groups,
                run_bins
                    .iter()
                    .map(|(records, count)| (*records as usize / 4) * count)
                    .sum::<usize>()
            );
            assert_eq!(
                published.codec_eligible_scalar_tails,
                run_bins
                    .iter()
                    .map(|(records, count)| (*records as usize % 4) * count)
                    .sum::<usize>()
            );
            // This fixture's validated program has exactly one active F32 store.
            assert_eq!(
                published.codec_active_f32_store_group_operations,
                published.codec_simd_eligible_groups
            );
            std::eprintln!(
                "dense Inter codec cycle{cycle}: successful_runs={}, record_count_histogram={run_bins:?}, simd_eligible_groups={}, eligible_scalar_tails={}, repeated_group_steps={}, repeated_scalar_tail_steps={}, active_f32_store_group_operations={}",
                published.codec_successful_runs,
                published.codec_simd_eligible_groups,
                published.codec_eligible_scalar_tails,
                published.codec_repeated_group_steps,
                published.codec_repeated_scalar_tail_steps,
                published.codec_active_f32_store_group_operations
            );
            let after_view = engine.gather.view();
            let after_output = after_view.plan_input();
            let after = after_output.glyphs.to_vec();
            let after_f32: Vec<Vec<u32>> = after_output
                .f32_fields
                .iter()
                .map(|field| field.iter().map(|value| value.to_bits()).collect())
                .collect();
            let after_u32: Vec<Vec<u32>> = after_output
                .u32_fields
                .iter()
                .map(|field| field.to_vec())
                .collect();
            let masks = after_output.semantic_change_masks;
            assert_eq!(before.len(), OWNERS as usize * 10);
            assert_eq!(after.len(), before.len());
            for (old_owner, new_owner) in before.chunks_exact(10).zip(after.chunks_exact(10)) {
                for (old_glyph, new_glyph) in old_owner[5..].iter().zip(&new_owner[5..]) {
                    assert_eq!(old_glyph.stable_id, new_glyph.stable_id);
                }
            }
            assert_eq!(masks.len(), after.len());
            assert_eq!(
                published.gather_mask_bit_counts.iter().sum::<usize>(),
                published.gather_mask_bits
            );
            assert_eq!(
                published.gather_all_masks,
                published.gather_identity_mismatches
            );
            let changed_id = before
                .iter()
                .zip(&after)
                .filter(|(a, b)| a.stable_id != b.stable_id)
                .count();
            let changed_material = before
                .iter()
                .zip(&after)
                .filter(|(a, b)| a.material_id != b.material_id)
                .count();
            let changed_position = before
                .iter()
                .zip(&after)
                .filter(|(a, b)| {
                    a.inline_start.to_bits() != b.inline_start.to_bits()
                        || a.block_start.to_bits() != b.block_start.to_bits()
                })
                .count();
            let changed_extent = before
                .iter()
                .zip(&after)
                .filter(|(a, b)| {
                    a.inline_extent.to_bits() != b.inline_extent.to_bits()
                        || a.block_extent.to_bits() != b.block_extent.to_bits()
                })
                .count();
            let f32_changed: Vec<usize> = before_f32
                .iter()
                .zip(&after_f32)
                .map(|(old, new)| old.iter().zip(new).filter(|(a, b)| a != b).count())
                .collect();
            let u32_changed: Vec<usize> = before_u32
                .iter()
                .zip(&after_u32)
                .map(|(old, new)| old.iter().zip(new).filter(|(a, b)| a != b).count())
                .collect();
            let all_mask_rows = masks.iter().filter(|&&mask| mask == u16::MAX).count();
            assert_eq!(all_mask_rows, published.gather_all_masks);
            let all_mask_unchanged_f32: Vec<usize> = before_f32
                .iter()
                .zip(&after_f32)
                .map(|(old, new)| {
                    old.iter()
                        .zip(new)
                        .zip(masks)
                        .filter(|((a, b), mask)| **mask == u16::MAX && a == b)
                        .count()
                })
                .collect();
            let all_mask_unchanged_u32: Vec<usize> = before_u32
                .iter()
                .zip(&after_u32)
                .map(|(old, new)| {
                    old.iter()
                        .zip(new)
                        .zip(masks)
                        .filter(|((a, b), mask)| **mask == u16::MAX && a == b)
                        .count()
                })
                .collect();
            std::eprintln!(
                "dense Inter {OWNERS}x10 cycle{cycle}: preparation={preparation:?}; publication={published:?}; output_changed={{stable_id:{changed_id},material_id:{changed_material},position:{changed_position},extent:{changed_extent},f32:{f32_changed:?},u32:{u32_changed:?}}}; all_mask_rows={all_mask_rows}; all_mask_unchanged={{f32:{all_mask_unchanged_f32:?},u32:{all_mask_unchanged_u32:?}}}"
            );
            for id in 1..=OWNERS {
                let index = id - 1;
                let cold_text =
                    alloc::format!("{} {index:04}", if cycle == 0 { "bravo" } else { "alpha" });
                assert_eq!(target[index as usize], utf16(&cold_text));
                let (cold, _) = shaped_engine_with_font_styles_geometry_and_extents(
                    &cold_text,
                    INTER,
                    2_937,
                    &style,
                    1,
                    Some((&template, 0)),
                    true,
                );
                let cold_view = cold.gather.view();
                let cold_output = cold_view.plan_input();
                let start = index as usize * 10;
                let end = start + 10;
                assert_eq!(cold_output.glyphs.len(), 10);
                for (warm_glyph, cold_glyph) in after[start..end].iter().zip(cold_output.glyphs) {
                    let mut expected = *cold_glyph;
                    expected.stable_id = warm_glyph.stable_id;
                    expected.content_revision = warm_glyph.content_revision;
                    expected.semantic_id = warm_glyph.semantic_id;
                    expected.transform_id = warm_glyph.transform_id;
                    assert_eq!(*warm_glyph, expected);
                }
                assert_eq!(cold_output.f32_fields.len(), after_f32.len());
                for (field, warm) in cold_output.f32_fields.iter().zip(&after_f32) {
                    let expected: Vec<_> = field.iter().map(|value| value.to_bits()).collect();
                    assert_eq!(&warm[start..end], expected.as_slice());
                }
                assert_eq!(cold_output.u32_fields.len(), after_u32.len());
                for (field, warm) in cold_output.u32_fields.iter().zip(&after_u32) {
                    assert_eq!(&warm[start..end], *field);
                }
                assert_visible_shape_equal(
                    &engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .paragraph(id)
                        .unwrap()
                        .state,
                    cold.planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap(),
                    "dense Inter setter cold parity",
                );
            }
            assert_gather_matches_full(&mut engine);
        }
    }

    fn assert_gather_matches_full(engine: &mut TextEngine) {
        let warm = engine.gather.view();
        let warm = warm.plan_input();
        let glyphs = warm.glyphs.to_vec();
        let placements = warm.placement_slots.to_vec();
        let f32_fields: Vec<_> = warm.f32_fields.iter().map(|field| field.to_vec()).collect();
        let u32_fields: Vec<_> = warm.u32_fields.iter().map(|field| field.to_vec()).collect();
        let mut full = CodecGatherWorkspace::default();
        let codec = engine.codecs.get(&9).unwrap();
        let planner = engine.planners.get_mut(&4).unwrap();
        if planner.placement_ranges_current
            && !planner.pending_placement_ranges_refresh
            && planner
                .plan
                .plan_view(9, CapabilitySetId(1), codec.fingerprint())
                .is_err()
        {
            for ordered in planner.active_order() {
                let paragraph = planner.paragraph(ordered.id).unwrap();
                let positioned = paragraph.state.positioned.active();
                assert_eq!(
                    paragraph.placement_range.end - paragraph.placement_range.start,
                    positioned.placement_segments().len()
                );
                for (relative, segment) in positioned.placement_segments().iter().enumerate() {
                    let run = match segment.layout_run_owner {
                        LayoutRunOwner::Paragraph => {
                            paragraph.state.clusters.active().layout_runs()
                        }
                        LayoutRunOwner::Replacement => positioned.replacement_runs(),
                    }[segment.layout_run_index as usize];
                    let key =
                        placement_logical_key(paragraph.incarnation, *segment, run.source_kind);
                    assert_eq!(
                        planner
                            .placement_slots
                            .committed_assignment(paragraph.placement_range.start + relative, key)
                            .unwrap(),
                        positioned.placement_handle(relative)
                    );
                }
            }
        }
        // After Rust adoption, verify actual session buffer bytes, not only handle metadata.
        // A prepared candidate is checked by the gather oracle below; its payload has not committed.
        if planner
            .plan
            .plan_view(9, CapabilitySetId(1), codec.fingerprint())
            .is_err()
        {
            for ordered in planner.active_order() {
                let positioned = planner
                    .paragraph(ordered.id)
                    .unwrap()
                    .state
                    .positioned
                    .active();
                for (relative, translation) in
                    positioned.placement_translations().iter().enumerate()
                {
                    let handle = positioned.placement_handle(relative).unwrap();
                    let bytes = planner
                        .plan
                        .buffer_bytes(super::super::render_plan::SESSION_PLACEMENT_BUFFER_ID)
                        .unwrap();
                    let offset = handle.slot().get() as usize * 8;
                    assert_eq!(
                        &bytes[offset..offset + 4],
                        &(translation.translation_inline as f32).to_le_bytes()
                    );
                    assert_eq!(
                        &bytes[offset + 4..offset + 8],
                        &(translation.translation_block as f32).to_le_bytes()
                    );
                }
            }
        }
        let count = planner
            .active_order()
            .iter()
            .map(|order| {
                planner
                    .paragraph(order.id)
                    .unwrap()
                    .state
                    .positioned
                    .active()
                    .glyphs()
                    .len()
            })
            .sum();
        let ranges: Vec<_> = planner
            .paragraphs
            .iter()
            .map(|paragraph| paragraph.gather_range)
            .collect();
        full.begin(codec, count).unwrap();
        append_planner_gather(
            &mut full,
            planner,
            codec,
            CapabilitySetId(1),
            &engine.font_bindings,
            false,
            false,
            false,
        )
        .unwrap();
        for (paragraph, range) in planner.paragraphs.iter_mut().zip(ranges) {
            paragraph.gather_range = range;
        }
        let view = full.view();
        let input = view.plan_input();
        assert_eq!(input.glyphs.len(), glyphs.len());
        for (index, (actual, expected)) in input.glyphs.iter().zip(glyphs).enumerate() {
            assert_eq!(*actual, expected, "gather glyph at record {index}");
        }
        assert_eq!(input.placement_slots.len(), placements.len());
        for (index, (actual, expected)) in input.placement_slots.iter().zip(placements).enumerate()
        {
            assert_eq!(*actual, expected, "placement slot at record {index}");
        }
        assert_eq!(input.f32_fields.len(), f32_fields.len());
        assert_eq!(input.u32_fields.len(), u32_fields.len());
        for (field, expected) in input.f32_fields.iter().zip(f32_fields) {
            assert_eq!(*field, expected);
        }
        for (field, expected) in input.u32_fields.iter().zip(u32_fields) {
            assert_eq!(*field, expected);
        }
    }

    #[test]
    fn retained_first_line_consumes_drop_cap_across_exclusion_update() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let text = alloc::format!("Aabcdefghij\n{}", "klmnopqrst\n".repeat(12));
        let styles = decorated_root_style_bytes_for_text(
            7,
            u32::try_from(text.encode_utf16().count()).unwrap(),
        );
        let previous_geometry = drop_cap_exclusion_geometry_bytes(100.0, 1);
        let next_geometry = drop_cap_exclusion_geometry_bytes(140.0, 2);
        let (mut engine, mut shaper) = shaped_engine_with_font_styles_and_geometry(
            &text,
            FONT,
            9_362,
            &styles,
            1,
            Some((&previous_geometry, 1)),
        );
        let accepted = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let accepted_first_line = accepted.flow_layout.committed().lines[0];

        let mut moved = update(1, 1, 1);
        moved.limits.max_clusters = 256;
        moved.limits.max_lines = 256;
        moved.limits.max_slots_per_band = 4;
        moved.limits.max_output_bytes = 1 << 20;
        moved.geometry = parse_root_geometry_with_exclusions(&next_geometry, 1, moved.limits);
        crate::engine::retained_rope::reset_work_counters();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, moved, 2)
            .unwrap();
        let pending = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let recomposed = pending
            .flow_layout
            .active()
            .recomposed_line_ranges()
            .expect("localized exclusion move must retain a prefix");
        assert!(recomposed[0].start > 0);
        assert_eq!(pending.flow_layout.active().lines[0], accepted_first_line);
        assert!(!pending.positioned.active().retained_static_geometry());
        assert!(!pending.positioned.active().decorations().is_empty());
        let _publication = engine.prepared_plan(prepared).unwrap();
        assert!(
            crate::engine::retained_rope::index_lookups() <= 16,
            "complete exclusion preparation must not index each retained line"
        );
        engine.commit_update(prepared).unwrap();

        let (cold_engine, _) = shaped_engine_with_font_styles_and_geometry(
            &text,
            FONT,
            9_362,
            &styles,
            1,
            Some((&next_geometry, 1)),
        );
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_visible_shape_equal(warm, cold, "retained drop cap exclusion move");
        assert_eq!(
            warm.positioned.committed().decorations(),
            cold.positioned.committed().decorations()
        );
    }

    #[test]
    fn sparse_real_font_shaping_matches_cold_shape_and_shapes_only_safe_windows() {
        let original = "alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet";
        let edited = "Alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|JulieT";
        assert_eq!(
            original.encode_utf16().count(),
            edited.encode_utf16().count()
        );
        let (mut engine, mut shaper) = shaped_engine(original);
        let original_state = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let original_ids = original_state.text.committed().unit_ids.clone();

        let replacement = utf16(edited);
        let mutations = [(
            0,
            u32::try_from(replacement.len()).unwrap(),
            replacement.as_slice(),
        )];
        let edit_bytes = text_mutation_bytes(&mutations);
        let mut edit = update(1, 1, 1);
        edit.limits.max_clusters = 256;
        edit.limits.max_lines = 256;
        edit.limits.max_output_bytes = 1 << 20;
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, edit, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        let sparse_units = crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units;
        assert_eq!(sparse_units, 5, "three distant edits reshape five units");

        let (cold, _) = shaped_engine(edited);
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_visible_shape_equal(warm, cold, "three distant edits");
        assert_eq!(warm.text.committed().unit_ids[1..56], original_ids[1..56]);

        let replacement = utf16(original);
        let mutations = [(
            0,
            u32::try_from(replacement.len()).unwrap(),
            replacement.as_slice(),
        )];
        let edit_bytes = text_mutation_bytes(&mutations);
        let mut edit = update(2, 2, 2);
        edit.limits.max_clusters = 256;
        edit.limits.max_lines = 256;
        edit.limits.max_output_bytes = 1 << 20;
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, edit, 3)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        let sparse_units = crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units;
        assert_eq!(
            sparse_units, 5,
            "the next assignment must reuse the retained shaped run"
        );
        let (cold, _) = shaped_engine(original);
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_visible_shape_equal(warm, cold, "second sparse assignment");
        assert_eq!(warm.shape.committed().runs.len(), 1);

        assert_local_length_edits_match_cold(
            &mut engine,
            &mut shaper,
            original,
            3,
            |length| (root_style_bytes_for_text(7, length), 1),
            shaped_engine,
        );
    }

    #[test]
    fn short_inter_label_assignments_use_incremental_shape_and_match_cold_output() {
        let (mut engine, mut shaper) = shaped_inter_engine("alpha 0000");

        for next in ["bravo 0000", "alpha 0000"] {
            let replacement = utf16(next);
            let bytes = text_mutation_bytes(&[(0, replacement.len() as u32, &replacement)]);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = 256;
            request.limits.max_lines = 256;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

            let old_pending_capacity = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .shape
                .pending()
                .glyph_ids
                .capacity();
            super::super::work_attribution::reset();
            let before_calls = crate::SHAPINGS.with(core::cell::Cell::get);
            let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, request, 1)
                .unwrap();
            let candidate = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let source_run = candidate.incremental_shape_source_run;
            let windows = candidate.shape_window_scratch.clone();
            let work = super::super::work_attribution::snapshot();
            assert_eq!(work.shape_scratch_arena_moves, 1);
            assert_eq!(work.shape_range_copied_glyphs, 0);
            assert_eq!(work.cluster_full_builds, 1);
            assert_eq!(work.cluster_copied_old_rows, 0);
            assert_eq!(
                work.shape_scratch_moved_glyphs,
                candidate.shape.pending().glyph_ids.len()
            );
            assert_eq!(
                candidate.boundary_shape_scratch.glyph_ids.capacity(),
                old_pending_capacity
            );
            let pending_shape = candidate.shape.pending();
            let mut appended_shape = ShapeArena::default();
            appended_shape
                .append_text_range_from(pending_shape, 0, 0, 0, 10, 0)
                .unwrap();
            appended_shape.collapse_appended_runs(0, 0, 10).unwrap();
            assert_eq!(pending_shape.runs, appended_shape.runs);
            assert_eq!(pending_shape.glyph_ids, appended_shape.glyph_ids);
            assert_eq!(pending_shape.clusters, appended_shape.clusters);
            assert_eq!(pending_shape.x_advances, appended_shape.x_advances);
            assert_eq!(pending_shape.y_advances, appended_shape.y_advances);
            assert_eq!(pending_shape.x_offsets, appended_shape.x_offsets);
            assert_eq!(pending_shape.y_offsets, appended_shape.y_offsets);
            assert_eq!(pending_shape.glyph_flags, appended_shape.glyph_flags);
            engine.commit_measure(measured).unwrap();

            let calls = crate::SHAPINGS.with(core::cell::Cell::get) - before_calls;
            let units = crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units;
            assert_eq!(
                source_run,
                Some(0),
                "short label replacement keeps the existing incremental shape path"
            );
            assert_eq!(windows.len(), 1, "the selected window remains observable");
            assert_eq!((windows[0].new_start, windows[0].new_end), (0, 10));
            assert_eq!(calls, 1, "one selected window invokes the shaper once");
            assert_eq!(units, 10, "the selected window covers the full short label");

            let (cold_engine, _) = shaped_inter_engine(next);
            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_eq!(warm.shape.committed().runs, cold.shape.committed().runs);
            assert_visible_shape_equal(warm, cold, "short Inter label assignment");
        }
    }

    #[test]
    fn combining_cluster_keeps_retained_cluster_rebuild() {
        let (mut engine, mut shaper) = shaped_inter_engine("a\u{301}bc");
        let replacement = utf16("e");
        let bytes = text_mutation_bytes(&[(0, 1, &replacement)]);
        let mut request = update(1, 1, 1);
        request.limits.max_clusters = 256;
        request.limits.max_lines = 256;
        request.limits.max_output_bytes = 1 << 20;
        request.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        super::super::work_attribution::reset();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, request, 1)
            .unwrap();
        let candidate = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_eq!(candidate.incremental_shape_source_run, Some(0));
        assert!(
            candidate.unicode.active().grapheme_boundaries().len() - 1
                < candidate.text.active().units.len()
        );
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.cluster_copied_old_rows, 3);
        assert_eq!(work.cluster_full_builds, 0);
        engine.commit_measure(measured).unwrap();
        let (cold_engine, _) = shaped_inter_engine("e\u{301}bc");
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_visible_shape_equal(warm, cold, "combining-cluster retained rebuild");
    }

    #[test]
    fn inter_4000_glyph_midpoint_isolates_whole_affected_run_and_matches_cold() {
        const FONT: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        fn benchmark_styles(length: u32) -> (Vec<u8>, u32) {
            let mut styles = root_style_bytes_for_text(7, length);
            write_f32(
                &mut styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
                24.0,
            );
            (styles, 1)
        }
        fn benchmark_engine(text: &str) -> (TextEngine, ShaperRegistry) {
            let (styles, _) = benchmark_styles(text.encode_utf16().count() as u32);
            let mut geometry = multiline_root_geometry_bytes();
            let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
            let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
            write_f32(
                &mut geometry,
                constraint + abi::ENGINE_CONSTRAINT_WIDTH,
                600.0,
            );
            for field in [
                abi::ENGINE_REGION_INLINE_END,
                abi::ENGINE_REGION_CLIP_INLINE_END,
            ] {
                write_f32(&mut geometry, region + field, 600.0);
            }
            // The large codec capacity admits every output record; shaping still uses Inter.
            shaped_engine_with_font_styles_geometry_and_extents(
                text,
                FONT,
                2_937,
                &styles,
                1,
                Some((&geometry, 0)),
                true,
            )
        }
        // Exact paragraphSource and copy count of paragraphTextForGlyphs(4_000).
        let source = concat!(
            "Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs ",
            "while a responsive panel changes the space around them. ",
            "A practical interface mixes prose with 0123456789, prices such as 24.50, ",
            "ranges from 8-512 px, and punctuation. ",
            "Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, ",
            "and ffl shaping candidates."
        );
        assert_eq!(source.len(), 350);
        let original = [source; 14].join("\n");
        assert_eq!(original.encode_utf16().count(), 4_913);
        let middle = original.len() >> 1;
        assert_eq!(middle, 2_456);
        assert_eq!(original.as_bytes()[middle], b'\n');
        let grown = alloc::format!("{}x{}", &original[..middle], &original[middle..]);
        let (mut engine, mut shaper) = benchmark_engine(&original);
        for (index, (value, old_end, new_end, shaped_units)) in [
            (grown.as_str(), 2_456, 2_457, 351),
            (original.as_str(), 2_457, 2_456, 350),
        ]
        .into_iter()
        .enumerate()
        {
            let previous = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let old_later_runs = previous
                .shape
                .committed()
                .runs
                .iter()
                .filter(|run| run.source_run > 6)
                .copied()
                .collect::<Vec<_>>();
            let previous_len = previous.text.committed().units.len();
            let units = utf16(value);
            let text = text_mutation_bytes(&[(0, previous_len as u32, units.as_slice())]);
            let (styles, style_count) = benchmark_styles(units.len() as u32);
            let revision = index as u32 + 1;
            let mut request = update(revision, revision, revision);
            request.limits.max_clusters = units.len() as u32;
            request.limits.max_lines = units.len() as u32;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            request.style_mutations =
                parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, style_count)
                    .unwrap();
            let before_calls = crate::SHAPINGS.with(core::cell::Cell::get);
            let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, request, revision + 1)
                .unwrap();
            let candidate = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let edit = bounding_text_edit(&candidate.text_edits).unwrap();
            assert_eq!(
                containing_run(
                    candidate.shaping_runs.committed().runs(),
                    edit.old_start,
                    edit.old_end
                ),
                Some(6),
            );
            assert_eq!(
                containing_run(
                    candidate.shaping_runs.pending().runs(),
                    edit.old_start,
                    edit.new_end
                ),
                Some(6),
            );
            assert_eq!(candidate.incremental_shape_source_run, Some(6));
            assert_eq!(candidate.shape_window_scratch.len(), 1);
            let window = candidate.shape_window_scratch[0];
            assert_eq!((window.old_start, window.old_end), (2_106, old_end));
            assert_eq!((window.new_start, window.new_end), (2_106, new_end));
            assert_eq!(window.probe_end, new_end);
            engine.commit_update(prepared).unwrap();
            assert_eq!(
                crate::SHAPINGS.with(core::cell::Cell::get) - before_calls,
                1
            );
            assert_eq!(
                crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units,
                shaped_units,
            );
            let (cold, _) = benchmark_engine(value);
            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, "Inter 4,000-glyph midpoint edit");
            assert_eq!(warm.shape.committed().runs, cold.shape.committed().runs);
            let shifted_later = warm
                .shape
                .committed()
                .runs
                .iter()
                .filter(|run| run.source_run > 6)
                .collect::<Vec<_>>();
            assert_eq!(shifted_later.len(), old_later_runs.len());
            let delta = i64::from(new_end) - i64::from(old_end);
            for (before, after) in old_later_runs.iter().zip(shifted_later) {
                assert_eq!(
                    after.text_start,
                    shifted_text_offset(before.text_start, delta).unwrap()
                );
                assert_eq!(
                    after.text_end,
                    shifted_text_offset(before.text_end, delta).unwrap()
                );
            }
        }
    }

    #[test]
    fn empty_old_run_and_whole_deletion_use_broad_cold_equivalent_shape() {
        let (mut engine, mut shaper) = shaped_engine("alpha");
        for (index, value) in ["", "x"].into_iter().enumerate() {
            let previous_len = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text
                .committed()
                .units
                .len();
            let units = utf16(value);
            let text = text_mutation_bytes(&[(0, previous_len as u32, units.as_slice())]);
            let styles = root_style_bytes_for_text(7, units.len() as u32);
            let revision = index as u32 + 1;
            let mut request = update(revision, revision, revision);
            request.limits.max_clusters = 256;
            request.limits.max_lines = 256;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            request.style_mutations =
                parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, request, revision + 1)
                .unwrap();
            assert_eq!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .incremental_shape_source_run,
                None,
            );
            engine.commit_update(prepared).unwrap();
            let (cold, _) = shaped_engine(value);
            assert_visible_shape_equal(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                cold.planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                "empty old run or whole deletion",
            );
        }
    }

    #[test]
    fn changed_resolved_dependencies_reject_copying_other_shaping_runs() {
        const FONT: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        fn dependency_style(
            text_end: u32,
            language: Option<&[u8]>,
            feature: Option<u32>,
        ) -> Vec<u8> {
            let mut bytes = root_style_bytes_for_text(7, text_end);
            let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
            let mut mask =
                crate::wire::read_u32(&bytes, record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK)
                    .unwrap();
            if let Some(language) = language {
                mask |= crate::engine::frame::STYLE_FIELD_LANGUAGE;
                let offset = bytes.len();
                write_u32(
                    &mut bytes,
                    record + abi::ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
                    offset as u32,
                );
                bytes[record + abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH
                    ..record + abi::ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH + 2]
                    .copy_from_slice(&(language.len() as u16).to_le_bytes());
                bytes.extend_from_slice(language);
            }
            if let Some(value) = feature {
                mask |= crate::engine::frame::STYLE_FIELD_FEATURES;
                let offset = bytes.len();
                bytes.resize(offset + abi::FEATURE_RECORD_SIZE as usize, 0);
                bytes[record + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT
                    ..record + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT + 2]
                    .copy_from_slice(&1_u16.to_le_bytes());
                write_u32(
                    &mut bytes,
                    record + abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
                    offset as u32,
                );
                write_u32(
                    &mut bytes,
                    offset + abi::FEATURE_TAG,
                    u32::from_be_bytes(*b"kern"),
                );
                write_u32(&mut bytes, offset + abi::FEATURE_VALUE, value);
                write_u32(&mut bytes, offset + abi::FEATURE_START, 0);
                write_u32(&mut bytes, offset + abi::FEATURE_END, 1);
            }
            write_u32(
                &mut bytes,
                record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                mask,
            );
            bytes
        }

        let original = "alpha|bravo|charlie|delta|ΩΩΩΩ|echo";
        let edited = original.replacen("charlie", "charliX", 1);
        for (old_language, new_language, old_feature, new_feature) in [
            (Some(&b"en"[..]), Some(&b"tr"[..]), None, None),
            (None, None, Some(0), Some(1)),
        ] {
            let initial_style =
                dependency_style(utf16(original).len() as u32, old_language, old_feature);
            let (mut engine, mut shaper) =
                shaped_engine_with_font_and_styles(original, FONT, 2_937, &initial_style, 1);
            let old_runs = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .shaping_runs
                .committed()
                .runs()
                .len();
            assert!(old_runs > 1, "the dependency must also affect a copied run");
            let units = utf16(&edited);
            let text = text_mutation_bytes(&[(0, utf16(original).len() as u32, &units)]);
            let next_style = dependency_style(units.len() as u32, new_language, new_feature);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = 256;
            request.limits.max_lines = 256;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            request.style_mutations =
                parse_style_mutations(&next_style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, request, 2)
                .unwrap();
            assert!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .unicode_reused_for_text_edit,
                "the text edit must satisfy the Unicode reuse certificate"
            );
            assert!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .shaping_runs
                    .is_prepared(),
                "changed shaping feature or language must rebuild run metadata"
            );
            assert_eq!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .incremental_shape_source_run,
                None
            );
            engine.commit_update(prepared).unwrap();
            let (cold, _) =
                shaped_engine_with_font_and_styles(&edited, FONT, 2_937, &next_style, 1);
            assert_visible_shape_equal(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                cold.planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                "changed shaping dependency",
            );
        }
    }

    #[test]
    fn inter_assignment_labs_discriminator_matches_cold_preparation_and_gather() {
        // Independent local-column evidence, not a production invalidation policy. Snapshot
        // values, not reductions/hashes; canonical run tokens and cumulative numeric bases
        // are deliberately separate from local shaping/layout inputs. Full styles (including
        // paint) and temporary source/glyph ordinals make this conservative evidence only.
        let local_columns = |paragraph: &ParagraphState| {
            let clusters = paragraph.clusters.committed();
            let text = paragraph.text.committed();
            let styles = paragraph.styles.committed();
            let runs = paragraph.shaping_runs.committed().runs();
            let breaks = paragraph.unicode.committed().line_breaks();
            (0..clusters.starts.len())
                .map(|index| {
                    let start = clusters.starts[index] as usize;
                    let end = clusters.ends[index] as usize;
                    let glyph_start = clusters.glyph_starts[index] as usize;
                    let glyph_end = glyph_start + clusters.glyph_counts[index] as usize;
                    let style =
                        styles.resolved.segments()[clusters.style_indexes[index] as usize].style;
                    let direction = runs
                        .get(clusters.source_runs[index] as usize)
                        .map(|run| (run.direction, run.bidi_level, run.script));
                    let glyphs = (glyph_start..glyph_end)
                        .map(|glyph| {
                            (
                                clusters.glyph_ids[glyph],
                                clusters.glyph_clusters[glyph],
                                clusters.glyph_x_advances[glyph],
                                clusters.glyph_x_offsets[glyph],
                                clusters.glyph_y_offsets[glyph],
                                clusters.glyph_shape_flags[glyph],
                                clusters.glyph_stable_ids[glyph],
                            )
                        })
                        .collect::<Vec<_>>();
                    let break_start =
                        breaks.partition_point(|record| record.position <= start as u32);
                    let break_end = breaks.partition_point(|record| record.position <= end as u32);
                    (
                        (
                            clusters.starts[index],
                            clusters.ends[index],
                            clusters.stable_ids[index],
                            clusters.advances[index].to_bits(),
                            clusters.advance_units[index],
                            clusters.units_per_em[index].to_bits(),
                            clusters.flags[index],
                            clusters.binding_handles[index],
                            clusters.font_handles[index],
                            clusters.glyph_starts[index],
                            clusters.glyph_counts[index],
                        ),
                        (
                            clusters.shaped[index],
                            clusters.unsafe_before[index],
                            clusters.source_runs[index],
                            style,
                            styles.arena.resolved_language(style).map(<[u8]>::to_vec),
                            styles.arena.resolved_features(style).to_vec(),
                            direction,
                            text.units[start..end].to_vec(),
                            text.unit_ids[start..end].to_vec(),
                        ),
                        glyphs,
                        breaks[break_start..break_end]
                            .iter()
                            .map(|record| (record.position, record.required))
                            .collect::<Vec<_>>(),
                    )
                })
                .collect::<Vec<_>>()
        };
        const FONT: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        let original = "ab cd ef gh ij kl ".repeat(1_024);
        let original_units = utf16(&original);
        assert_eq!(original_units.len(), 18_432);
        let mut scattered = original_units.clone();
        for offset in (1..scattered.len()).step_by(1_021) {
            if scattered[offset] != 0x20 {
                scattered[offset] = 0x78;
            }
        }
        let broad = original_units
            .iter()
            .map(|unit| if *unit == 0x20 { 0x20 } else { 0x78 })
            .collect::<Vec<_>>();
        let mut styles = root_style_bytes_for_text(7, original_units.len() as u32);
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        write_f32(
            &mut styles,
            header + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            24.0,
        );
        for index in 0..8_192 {
            let offset = styles.len();
            styles.resize(offset + stride, 0);
            let record = &mut styles[offset..];
            record[abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
            write_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID, index + 2);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID, 1);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER, index + 1);
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                STYLE_FIELD_FOREGROUND,
            );
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_TEXT_START,
                18_432 * index / 8_192,
            );
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_TEXT_END,
                18_432 * (index + 1) / 8_192,
            );
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
                if index % 2 == 0 {
                    0xff2f00ff
                } else {
                    0x2f7fffff
                },
            );
        }
        let mut geometry = multiline_root_geometry_bytes();
        let region = header + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_f32(&mut geometry, header + abi::ENGINE_CONSTRAINT_WIDTH, 600.0);
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
        ] {
            write_f32(&mut geometry, region + field, 600.0);
        }
        for (kind, alternate) in [
            ("unchanged", &original_units),
            ("scattered", &scattered),
            ("broad", &broad),
        ] {
            let (mut warm_engine, mut warm_shaper) =
                shaped_engine_with_font_styles_geometry_and_extents(
                    &original,
                    FONT,
                    2_937,
                    &styles,
                    8_193,
                    Some((&geometry, 0)),
                    true,
                );
            let initial = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(initial.flow_layout.committed().lines.len() > 100);
            assert!(initial.positioned.committed().glyphs().len() > original_units.len() / 2);
            for (step, desired) in [alternate, &original_units].into_iter().enumerate() {
                let before_columns = local_columns(
                    warm_engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap(),
                );
                let mutation = text_mutation_bytes(&[(0, original_units.len() as u32, desired)]);
                let revision = step as u32 + 1;
                let mut request = update(revision, revision, revision);
                request.limits.max_clusters = original_units.len() as u32;
                request.limits.max_lines = original_units.len() as u32;
                request.limits.max_output_bytes = 1 << 20;
                request.text_mutations =
                    parse_text_mutations(&mutation, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
                request.style_mutations =
                    parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 8_193)
                        .unwrap();
                super::super::work_attribution::reset();
                let measured = warm_engine
                    .measure_paragraph_with_shaper(&mut warm_shaper, request, 1)
                    .unwrap();
                if kind == "scattered" {
                    let candidate = warm_engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap();
                    assert!(candidate.layout_dirty.valid);
                    assert!(candidate.layout_dirty.ranges.len() > 1);
                    assert!(
                        candidate
                            .layout_dirty
                            .ranges
                            .iter()
                            .map(|range| range.len())
                            .sum::<usize>()
                            < desired.len() / 2
                    );
                }
                warm_engine.commit_measure(measured).unwrap();
                let preparation = super::super::work_attribution::snapshot();
                let warm = warm_engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap();

                let after_columns = local_columns(warm);
                assert_eq!(before_columns.len(), after_columns.len());
                let retained_cluster_ids = before_columns
                    .iter()
                    .zip(&after_columns)
                    .filter(|(old, next)| old.0.2 == next.0.2)
                    .count();
                let retained_glyph_ids = before_columns
                    .iter()
                    .zip(&after_columns)
                    .filter(|(old, next)| {
                        old.2.len() == next.2.len()
                            && old.2.iter().zip(&next.2).all(|(a, b)| a.6 == b.6)
                    })
                    .count();
                let mut equal_clusters = 0;
                let mut unequal_intervals: Vec<core::ops::Range<u32>> = Vec::new();
                for (old, next) in before_columns.iter().zip(&after_columns) {
                    if old == next {
                        equal_clusters += 1;
                    } else if let Some(last) = unequal_intervals.last_mut()
                        && last.end == next.0.0
                    {
                        last.end = next.0.1;
                    } else {
                        unequal_intervals.push(next.0.0..next.0.1);
                    }
                }
                let unequal_units = unequal_intervals
                    .iter()
                    .map(|range| range.len())
                    .sum::<usize>();
                if kind == "unchanged" {
                    assert_eq!(equal_clusters, after_columns.len());
                    assert_eq!(retained_cluster_ids, after_columns.len());
                    assert_eq!(retained_glyph_ids, after_columns.len());
                    assert!(unequal_intervals.is_empty());
                } else if kind == "scattered" {
                    assert!(equal_clusters > after_columns.len() / 2);
                    assert!(retained_cluster_ids > after_columns.len() / 2);
                    assert!(retained_glyph_ids > after_columns.len() / 2);
                    assert!(unequal_units < desired.len() / 2);
                    assert!(unequal_intervals.len() > 1);
                }
                eprintln!(
                    "Inter {kind} step{step}: clusters={}, retained_cluster_ids={retained_cluster_ids}, retained_glyph_ids={retained_glyph_ids}, local_equal_clusters={equal_clusters}, local_unequal_intervals={}, local_unequal_units={unequal_units}",
                    after_columns.len(),
                    unequal_intervals.len(),
                );
                // This fixture has one LTR run, so source cluster ordinals directly index
                // the existing run-local block column. Distinct blocks are not segments.
                let mut dirty_blocks = before_columns
                    .iter()
                    .zip(&after_columns)
                    .enumerate()
                    .filter(|(_, (old, next))| old != next)
                    .filter_map(|(index, _)| {
                        warm.clusters
                            .committed()
                            .run_local()
                            .cluster_blocks()
                            .get(index)
                            .copied()
                    })
                    .filter(|&block| block != u32::MAX)
                    .collect::<Vec<_>>();
                dirty_blocks.sort_unstable();
                dirty_blocks.dedup();
                eprintln!(
                    "Inter {kind} step{step}: numeric_blocks={}, unique_dirty_blocks={}, placement_segments={}",
                    warm.clusters.committed().run_local().blocks().len(),
                    dirty_blocks.len(),
                    warm.positioned.committed().placement_segments().len()
                );
                assert_eq!(
                    preparation.placement_remap_numeric_rejections,
                    preparation.placement_remap_numeric_prefix_only
                        + preparation.placement_remap_numeric_anchor_only
                        + preparation.placement_remap_numeric_prefix_and_anchor
                        + preparation.placement_remap_numeric_partition
                        + preparation.placement_remap_numeric_identity
                        + preparation.placement_remap_numeric_other
                );
                assert_eq!(preparation.canonical_style_resolutions, 0);
                if kind == "scattered" {
                    assert_eq!(preparation.canonical_text_validations, 1);
                    assert_eq!(
                        preparation.canonical_cluster_comparisons,
                        original_units.len()
                    );
                } else if kind == "unchanged" {
                    assert_eq!(preparation.canonical_text_validations, 0);
                    assert_eq!(preparation.canonical_cluster_comparisons, 0);
                }
                let flow = warm.flow_layout.committed();
                let composed = flow
                    .recomposed_line_ranges()
                    .map(|ranges| ranges.iter().map(|range| range.len()).sum::<usize>());
                if kind == "scattered" {
                    assert!(composed.is_some_and(|count| count < flow.lines.len()));
                    assert!(preparation.copied_positioned_records > 0);
                    assert!(preparation.newly_positioned_glyphs < original_units.len());
                    assert!(preparation.flow_dirty_end_blocks < flow.lines.len() / 2);
                    let source_intervals = warm
                        .positioned
                        .committed()
                        .unpublished_source_intervals()
                        .expect("actual retained lines preserve source scope");
                    let source_count = source_intervals
                        .iter()
                        .map(|range| range.len())
                        .sum::<usize>();
                    assert!(
                        source_count > 0
                            && source_count < warm.positioned.committed().glyphs().len()
                    );
                }
                eprintln!(
                    "Inter {kind} step{step}: shaped_runs={}, layout_runs={}, lines={}, recomposed={composed:?}, preparation={preparation:?}",
                    warm.shape.committed().runs.len(),
                    warm.clusters.committed().layout_runs().len(),
                    flow.lines.len()
                );
                let text = alloc::string::String::from_utf16(desired).unwrap();
                let (cold, _) = shaped_engine_with_font_styles_geometry_and_extents(
                    &text,
                    FONT,
                    2_937,
                    &styles,
                    8_193,
                    Some((&geometry, 0)),
                    true,
                );
                assert_visible_shape_equal(
                    warm,
                    cold.planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap(),
                    kind,
                );
                let cold_positioned = cold
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .positioned
                    .committed();
                assert_eq!(
                    warm.positioned.committed().semantic_f32(),
                    cold_positioned.semantic_f32()
                );
                assert_eq!(
                    warm.positioned.committed().semantic_u32()
                        [super::super::frame::SEMANTIC_U32_FOREGROUND_RGBA as usize],
                    cold_positioned.semantic_u32()
                        [super::super::frame::SEMANTIC_U32_FOREGROUND_RGBA as usize],
                );
                if kind == "scattered" {
                    // Multiple synchronous reads must preserve the accumulated source scope.
                    let first_scope = warm
                        .positioned
                        .committed()
                        .unpublished_source_intervals()
                        .unwrap()
                        .to_vec();
                    let mut intermediate = desired.clone();
                    intermediate[original_units.len() - 4] = 0x79;
                    for units in [&intermediate, desired] {
                        let mutations =
                            text_mutation_bytes(&[(0, original_units.len() as u32, units)]);
                        let mut measured_request = request;
                        measured_request.text_mutations =
                            parse_text_mutations(&mutations, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                                .unwrap();
                        let measured = warm_engine
                            .measure_paragraph_with_shaper(&mut warm_shaper, measured_request, 1)
                            .unwrap();
                        warm_engine.commit_measure(measured).unwrap();
                    }
                    let final_paragraph = warm_engine
                        .planners
                        .get(&4)
                        .unwrap()
                        .first_paragraph_state()
                        .unwrap();
                    let final_scope = final_paragraph
                        .positioned
                        .committed()
                        .unpublished_source_intervals()
                        .expect("measured edits retain source scope");
                    assert!(first_scope.iter().all(|old| {
                        final_scope
                            .iter()
                            .any(|next| next.start <= old.start && next.end >= old.end)
                    }));
                    assert_eq!(
                        final_paragraph.positioned.committed().semantic_f32(),
                        cold_positioned.semantic_f32()
                    );
                }
                request.text_mutations = parse_text_mutations(&[], 0, 0).unwrap();
                request.style_mutations = parse_style_mutations(&[], 0, 0).unwrap();
                super::super::work_attribution::reset();
                super::super::retained_rope::reset_work_counters();
                let candidate = warm_engine
                    .prepare_update_with_shaper(&mut warm_shaper, request, revision + 1)
                    .unwrap();
                let publication = super::super::work_attribution::snapshot();
                let rope_work = super::super::retained_rope::work_counters();
                let rope_ordered = super::super::retained_rope::ordered_work_counters();
                eprintln!(
                    "Inter {kind} step{step}: publication={publication:?}, rope_copied_records={}, rope_source_visits={}, rope_ordered_traversals={}, rope_ordered_leaves={}, rope_ordered_records={}",
                    rope_work.0, rope_work.1, rope_ordered.0, rope_ordered.1, rope_ordered.2
                );
                if kind == "scattered" {
                    assert!(publication.gather_glyph_visits > 0);
                    assert!(publication.gather_glyph_visits < original_units.len());
                }
                assert_gather_matches_full(&mut warm_engine);
                warm_engine.commit_update(candidate).unwrap();
                assert_gather_matches_full(&mut warm_engine);
            }
        }
    }

    #[test]
    fn scattered_multi_run_setter_does_not_rebuild_run_lookup_per_clean_line() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let original = "ab cd ef gh ij kl ".repeat(128);
        let geometry = multiline_root_geometry_bytes();
        let mut styles = root_style_bytes_for_text(7, original.len() as u32);
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        for index in 0..16 {
            let start = styles.len();
            styles.resize(start + stride, 0);
            let record = &mut styles[start..];
            record[abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
            write_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID, index + 2);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID, 1);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER, index + 1);
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                STYLE_FIELD_FONT_SIZE,
            );
            write_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_START, index * 144);
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_TEXT_END,
                (index + 1) * 144,
            );
            write_f32(
                record,
                abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
                16.0 + (index % 2) as f32,
            );
        }
        assert_eq!(styles.len(), header + stride * 17);
        let (mut engine, mut shaper) = shaped_engine_with_font_styles_geometry_and_extents(
            &original,
            FONT,
            9_362,
            &styles,
            17,
            Some((&geometry, 0)),
            true,
        );
        let initial = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert!(initial.clusters.committed().layout_runs().len() >= 16);
        assert!(initial.flow_layout.committed().lines.len() > 100);
        let mut desired = utf16(&original);
        desired[4] = 0x78;
        let mutation = text_mutation_bytes(&[(0, desired.len() as u32, &desired)]);
        let mut request = update(1, 1, 1);
        request.limits.max_clusters = desired.len() as u32;
        request.limits.max_lines = desired.len() as u32;
        request.limits.max_output_bytes = 1 << 20;
        request.text_mutations =
            parse_text_mutations(&mutation, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        super::super::work_attribution::reset();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, request, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        let work = super::super::work_attribution::snapshot();
        assert_eq!(work.placement_run_lookup_visits, 0, "{work:?}");
        assert!(
            work.copied_positioned_records > desired.len() / 2,
            "{work:?}"
        );
        assert!(work.newly_positioned_glyphs < desired.len() / 2, "{work:?}");
        let text = alloc::string::String::from_utf16(&desired).unwrap();
        let (cold, _) = shaped_engine_with_font_styles_geometry_and_extents(
            &text,
            FONT,
            9_362,
            &styles,
            17,
            Some((&geometry, 0)),
            true,
        );
        assert_visible_shape_equal(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            cold.planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            "scattered multi-run assignment",
        );
        request.text_mutations = parse_text_mutations(&[], 0, 0).unwrap();
        let publication = engine
            .prepare_update_with_shaper(&mut shaper, request, 2)
            .unwrap();
        assert_gather_matches_full(&mut engine);
        engine.commit_update(publication).unwrap();
        assert_gather_matches_full(&mut engine);
    }

    #[test]
    fn scattered_setters_retain_middle_line_positioning_before_publication() {
        let original = "ab cd ef gh ij kl ".repeat(128);
        let geometry = multiline_root_geometry_bytes();
        let initial_styles = root_style_bytes_for_text(7, original.len() as u32);
        let (mut engine, mut shaper) =
            shaped_outlined_engine_with_styles_geometry(&original, &initial_styles, &geometry);
        let initial = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert!(initial.flow_layout.committed().lines.len() > 100);
        assert!(initial.positioned.committed().glyphs().len() > original.len() / 2);
        for offset in [4, 1_102, 2_200] {
            assert!(
                initial
                    .positioned
                    .committed()
                    .semantic_glyphs()
                    .iter()
                    .any(|glyph| glyph.cluster == offset)
            );
        }
        let mut desired = utf16(&original);
        for offset in [4, 1_102, 2_200] {
            desired[offset] = 0x78;
        }
        for revision in 1..=2 {
            if revision == 2 {
                desired[700] = 0x79;
            }
            let text = text_mutation_bytes(&[(0, desired.len() as u32, &desired)]);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = desired.len() as u32;
            request.limits.max_lines = desired.len() as u32;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, request, 1)
                .unwrap();
            engine.commit_measure(measured).unwrap();
            let work = super::super::work_attribution::snapshot();
            assert!(
                work.newly_positioned_glyphs > 0
                    && work.newly_positioned_glyphs < desired.len() / 2,
                "{work:?}"
            );
            assert!(
                work.positioned_revision_visits > 0
                    && work.positioned_revision_visits < desired.len() / 2,
                "{work:?}"
            );
            assert!(
                work.placement_segment_validation_visits <= desired.len() * 4,
                "{work:?}"
            );
            let text = alloc::string::String::from_utf16(&desired).unwrap();
            let styles = root_style_bytes_for_text(7, text.len() as u32);
            let (cold, _) = shaped_outlined_engine_with_styles_geometry(&text, &styles, &geometry);
            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, "multiple scattered setters before publication");
            if revision == 1 {
                assert_eq!(
                    warm.flow_layout
                        .committed()
                        .recomposed_line_ranges()
                        .unwrap()
                        .len(),
                    3
                );
            }
        }
        let pending = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .positioned
            .committed();
        // Both measured assignments must remain dirty until publication, including islands
        // absent from the last preparation's recomposed-line journal.
        for offset in [4, 700, 1_102, 2_200] {
            let index = pending
                .semantic_glyphs()
                .iter()
                .position(|glyph| glyph.cluster == offset)
                .unwrap();
            assert_ne!(pending.semantic_change_masks()[index], 0);
            assert!(
                pending
                    .unpublished_source_intervals()
                    .unwrap()
                    .iter()
                    .any(|range| range.contains(&index))
            );
        }
        let paragraph = engine.planners.get(&4).unwrap().paragraph(1).unwrap();
        assert!(!paragraph.positioned_changed);
        assert!(paragraph.preparation_changed_since_publication);
        let source_visits = pending
            .unpublished_source_intervals()
            .unwrap()
            .iter()
            .map(core::ops::Range::len)
            .sum::<usize>();
        assert!(source_visits > 0 && source_visits < pending.glyphs().len() / 2);
        let mut publication = update(1, 1, 1);
        publication.limits.max_clusters = desired.len() as u32;
        publication.limits.max_lines = desired.len() as u32;
        publication.limits.max_output_bytes = 1 << 20;
        super::super::work_attribution::reset();
        let candidate = engine
            .prepare_update_with_shaper(&mut shaper, publication, 2)
            .unwrap();
        let work = super::super::work_attribution::snapshot();
        let dirty_records = engine
            .gather
            .view()
            .plan_input()
            .semantic_change_masks
            .iter()
            .filter(|mask| **mask != 0)
            .count();
        assert!(dirty_records > 0 && dirty_records < desired.len() / 2);
        assert_eq!(work.gather_glyph_visits, source_visits, "{work:?}");
        let output_visits = engine
            .gather
            .changed_output_intervals()
            .unwrap()
            .iter()
            .map(core::ops::Range::len)
            .sum::<usize>();
        assert!(output_visits >= dirty_records && output_visits < desired.len() / 2);
        assert_eq!(work.ordered_admission_visits, output_visits, "{work:?}");
        assert_gather_matches_full(&mut engine);
        engine.commit_update(candidate).unwrap();
        assert_gather_matches_full(&mut engine);

        // A length-changing assignment cannot reuse same-coordinate interval authority.
        let old_len = desired.len();
        desired.push(0x7a);
        let text = text_mutation_bytes(&[(0, old_len as u32, &desired)]);
        let styles = root_style_bytes_for_text(7, desired.len() as u32);
        let mut request = update(2, 2, 2);
        request.limits = publication.limits;
        request.limits.max_clusters = desired.len() as u32;
        request.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        request.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine
            .measure_paragraph_with_shaper(&mut shaper, request, 1)
            .unwrap();
        engine.commit_measure(measured).unwrap();
        let text = alloc::string::String::from_utf16(&desired).unwrap();
        let styles = root_style_bytes_for_text(7, text.len() as u32);
        let (cold, _) = shaped_outlined_engine_with_styles_geometry(&text, &styles, &geometry);
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert!(
            !warm
                .positioned
                .committed()
                .retains_recomposed_glyph_ranges()
        );
        assert_visible_shape_equal(warm, cold, "count change revokes line-island authority");
    }

    #[test]
    fn scattered_line_islands_match_cold_after_wrap_and_numeric_basis_changes() {
        let original = "ab cd ef gh ij kl ".repeat(128);
        let mut geometry = multiline_root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_WIDTH,
            1010.0,
        );
        write_f32(
            &mut geometry,
            region + abi::ENGINE_REGION_INLINE_END,
            1010.0,
        );
        write_f32(
            &mut geometry,
            region + abi::ENGINE_REGION_CLIP_INLINE_END,
            1010.0,
        );
        let styles = root_style_bytes_for_text(7, original.len() as u32);
        // Joining two words can reconverge. An interior full-width Latin glyph
        // preserves a clean layout suffix but changes numeric prefixes/block boundaries.
        for (offset, replacement) in [(1_100, 0x78), (4, 0xff21)] {
            let (mut engine, mut shaper) =
                shaped_outlined_engine_with_styles_geometry(&original, &styles, &geometry);
            let initial = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let old_ink = (0..initial.positioned.committed().glyphs().len())
                .map(|index| {
                    initial
                        .positioned
                        .committed()
                        .placed_semantic_glyph(index)
                        .unwrap()
                        .ink_inline_start
                })
                .collect::<Vec<_>>();
            let old_blocks = initial.clusters.committed().run_local().blocks().to_vec();
            let mut desired = utf16(&original);
            desired[offset] = replacement;
            let bytes = text_mutation_bytes(&[(0, desired.len() as u32, &desired)]);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = desired.len() as u32;
            request.limits.max_lines = desired.len() as u32;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, request, 1)
                .unwrap();
            engine.commit_measure(measured).unwrap();
            let work = super::super::work_attribution::snapshot();
            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let desired = alloc::string::String::from_utf16(&desired).unwrap();
            let (cold, _) =
                shaped_outlined_engine_with_styles_geometry(&desired, &styles, &geometry);
            let cold = cold
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(
                warm,
                cold,
                "wrap reconvergence and numeric basis cold equivalence",
            );
            if offset == 4 {
                let ranges = warm
                    .flow_layout
                    .committed()
                    .recomposed_line_ranges()
                    .unwrap();
                assert_eq!(ranges.len(), 1);
                assert!(ranges[0].end < warm.flow_layout.committed().lines.len());
                assert_ne!(warm.clusters.committed().run_local().blocks(), old_blocks);
                let mut moved = 0;
                for (index, old) in old_ink.iter().enumerate() {
                    if warm
                        .positioned
                        .committed()
                        .placed_semantic_glyph(index)
                        .unwrap()
                        .ink_inline_start
                        .to_bits()
                        != old.to_bits()
                    {
                        moved += 1;
                    }
                }
                assert!(moved > 0);
                assert_eq!(
                    warm.positioned.committed().semantic_f32(),
                    cold.positioned.committed().semantic_f32()
                );
                assert!(
                    warm.positioned
                        .committed()
                        .retains_recomposed_glyph_ranges()
                );
            }
            assert!(work.newly_positioned_glyphs > 0 && work.newly_positioned_glyphs < 2304);
            assert!(work.positioned_revision_visits > 0 && work.positioned_revision_visits < 2304);
            let mut publication = update(1, 1, 1);
            publication.limits = request.limits;
            let candidate = engine
                .prepare_update_with_shaper(&mut shaper, publication, 2)
                .unwrap();
            if offset == 4 {
                let plan = engine.prepared_plan(candidate).unwrap();
                assert!(
                    !plan.primitives.is_empty(),
                    "changed placed bounds require fresh primitive metadata"
                );
                assert!(!plan.draws.is_empty());
            }
            assert_gather_matches_full(&mut engine);
            engine.commit_update(candidate).unwrap();
            assert_gather_matches_full(&mut engine);
        }
    }

    #[test]
    fn scattered_line_islands_do_not_retain_changed_paint_or_effects() {
        let original = "ab cd ef gh ij kl ".repeat(128);
        let mut desired = utf16(&original);
        for offset in [4, 1_102, 2_200] {
            desired[offset] = 0x78;
        }
        let text = text_mutation_bytes(&[(0, desired.len() as u32, &desired)]);
        let mut styles = decorated_root_style_bytes_for_text(7, desired.len() as u32);
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        write_u32(
            &mut styles,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO
                | STYLE_FIELD_DECORATION
                | STYLE_FIELD_FOREGROUND
                | STYLE_FIELD_OUTLINE,
        );
        write_u32(
            &mut styles,
            record + abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
            0xff3366ff,
        );
        write_u32(
            &mut styles,
            record + abi::ENGINE_STYLE_MUTATION_OUTLINE_RGBA,
            0x33ff66ff,
        );
        write_f32(
            &mut styles,
            record + abi::ENGINE_STYLE_MUTATION_OUTLINE_WIDTH,
            2.0,
        );
        let final_text = alloc::string::String::from_utf16(&desired).unwrap();
        let geometry = multiline_root_geometry_bytes();
        let initial_styles = root_style_bytes_for_text(7, original.len() as u32);
        for mixed in [false, true] {
            let (mut engine, mut shaper) =
                shaped_outlined_engine_with_styles_geometry(&original, &initial_styles, &geometry);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = desired.len() as u32;
            request.limits.max_lines = desired.len() as u32;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            if !mixed {
                let measured = engine
                    .measure_paragraph_with_shaper(&mut shaper, request, 1)
                    .unwrap();
                engine.commit_measure(measured).unwrap();
                let paragraph = engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap();
                assert_eq!(
                    paragraph
                        .flow_layout
                        .committed()
                        .recomposed_line_ranges()
                        .unwrap()
                        .len(),
                    3
                );
                request = update(1, 1, 1);
                request.limits.max_clusters = desired.len() as u32;
                request.limits.max_lines = desired.len() as u32;
                request.limits.max_output_bytes = 1 << 20;
            }
            request.style_mutations =
                parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            super::super::work_attribution::reset();
            let measured = engine
                .measure_paragraph_with_shaper(&mut shaper, request, 1)
                .unwrap();
            let paragraph = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(paragraph.style_invalidation.positioning);
            assert!(!paragraph.style_invalidation.metrics);
            assert_eq!(paragraph.flow_layout.is_prepared(), mixed);
            engine.commit_measure(measured).unwrap();
            let work = super::super::work_attribution::snapshot();
            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let (cold_engine, _) =
                shaped_outlined_engine_with_styles_geometry(&final_text, &styles, &geometry);
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, "scattered text with changed paint/effects");
            let warm = warm.positioned.committed();
            let cold = cold.positioned.committed();
            assert!(!warm.retains_recomposed_glyph_ranges());
            assert_eq!(
                work.newly_positioned_glyphs,
                warm.glyphs().len(),
                "{work:?}"
            );
            assert_eq!(
                work.positioned_revision_visits,
                warm.glyphs().len(),
                "{work:?}"
            );
            assert_eq!(warm.semantic_f32(), cold.semantic_f32());
            // Retained glyph/cluster IDs legitimately differ between warm and cold histories.
            for (index, (warm_field, cold_field)) in warm
                .semantic_u32()
                .into_iter()
                .zip(cold.semantic_u32())
                .enumerate()
            {
                if index != usize::from(super::super::frame::SEMANTIC_U32_STABLE_GLYPH_ID)
                    && index != usize::from(super::super::frame::SEMANTIC_U32_CLUSTER_ID)
                {
                    assert_eq!(
                        warm_field, cold_field,
                        "semantic field {index}, mixed={mixed}"
                    );
                }
            }
            assert!(!warm.decorations().is_empty());
            assert_eq!(warm.decorations(), cold.decorations());
        }
    }

    #[test]
    fn sparse_rtl_windows_match_cold_shape_in_logical_order() {
        let original = "alpha|bravo|charlie|delta|echo|foxtrot";
        let edited = "Alpha|bravo|charlie|delta|echo|foxtroT";
        let (mut engine, mut shaper) = shaped_rtl_engine(original);
        let replacement = utf16(edited);
        let mutations = [(
            0,
            u32::try_from(replacement.len()).unwrap(),
            replacement.as_slice(),
        )];
        let edit_bytes = text_mutation_bytes(&mutations);
        let mut edit = update(1, 1, 1);
        edit.limits.max_clusters = 256;
        edit.limits.max_lines = 256;
        edit.limits.max_output_bytes = 1 << 20;
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, edit, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        let shaped_units = crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units;
        assert!(
            shaped_units < replacement.len(),
            "RTL assignment must execute bounded shaping scopes"
        );

        let (cold, _) = shaped_rtl_engine(edited);
        let warm = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let cold = cold
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        assert_eq!(warm.shaping_runs.committed().runs()[0].direction, 1);
        assert_visible_shape_equal(warm, cold, "RTL sparse assignment");
        assert_local_length_edits_match_cold(
            &mut engine,
            &mut shaper,
            edited,
            2,
            |length| (override_style_bytes_for_text(7, length, DIRECTION_RTL), 2),
            shaped_rtl_engine,
        );
    }

    #[test]
    fn retained_styles_text_only_measurement_preserves_nesting_and_rejects_invalid_endpoints() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let mut styles = override_style_bytes_for_text(7, 4, DIRECTION_RTL);
        let child = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
            + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        write_u32(
            &mut styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            1,
        );
        write_u32(&mut styles, child + abi::ENGINE_STYLE_MUTATION_TEXT_END, 3);
        let feature_offset = styles.len();
        let feature_offset_u32 = u32::try_from(feature_offset).unwrap();
        styles.resize(feature_offset + abi::FEATURE_RECORD_SIZE as usize, 0);
        let field_mask =
            crate::wire::read_u32(&styles, child + abi::ENGINE_STYLE_MUTATION_FIELD_MASK).unwrap();
        write_u32(
            &mut styles,
            child + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            field_mask | crate::engine::frame::STYLE_FIELD_FEATURES,
        );
        styles[child + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT
            ..child + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT + 2]
            .copy_from_slice(&1_u16.to_le_bytes());
        write_u32(
            &mut styles,
            child + abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
            feature_offset_u32,
        );
        write_u32(
            &mut styles,
            feature_offset + abi::FEATURE_TAG,
            u32::from_be_bytes(*b"kern"),
        );
        write_u32(&mut styles, feature_offset + abi::FEATURE_VALUE, 1);
        write_u32(&mut styles, feature_offset + abi::FEATURE_START, 1);
        write_u32(&mut styles, feature_offset + abi::FEATURE_END, 2);
        let geometry = root_geometry_bytes();
        let (mut engine, mut shaper) = shaped_engine_with_font_styles_and_geometry(
            "abcd",
            FONT,
            9_362,
            &styles,
            2,
            Some((&geometry, 0)),
        );
        let span_error = EngineError::StyleRangeInvalid(FrameFault {
            paragraph_id: 1,
            style_id: 2,
        });
        let root_error = EngineError::StyleRootInvalid(FrameFault {
            paragraph_id: 1,
            style_id: 1,
        });
        for (text, expected_error) in [
            ("wxyz", None),
            ("😀ab", Some(span_error)),
            ("abcde", Some(root_error)),
            ("a😀d", Some(span_error)),
            ("abcd", None),
        ] {
            let units = utf16(text);
            let bytes = text_mutation_bytes(&[(0, 4, &units)]);
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = 256;
            request.limits.max_lines = 256;
            request.limits.max_output_bytes = 1 << 20;
            request.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT;
            request.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let preparation_count = engine.planner_paragraph_preparation_count(4, 1).unwrap();
            let result = engine.measure_paragraph_with_shaper(&mut shaper, request, 1);
            if let Some(expected_error) = expected_error {
                assert_eq!(result.as_ref().err().copied(), Some(expected_error));
                assert_eq!(
                    engine.planner_paragraph_preparation_count(4, 1),
                    Ok(preparation_count)
                );
            } else {
                let measured = result.unwrap();
                let state = engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap();
                assert!(!state.styles.is_prepared());
                assert!(state.style_order_scratch.is_empty());
                assert!(state.style_nesting_scratch.is_empty());
                engine.commit_measure(measured).unwrap();
            }
            let state = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_eq!(
                state.text.committed().units,
                utf16(if expected_error.is_none() {
                    text
                } else {
                    "wxyz"
                })
            );
            assert_eq!(state.styles.committed().arena.len(), 2);
            assert!(!state.styles.is_prepared());
        }
    }

    fn topology_style_upsert_bytes(text_start: u32, text_end: u32) -> Vec<u8> {
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let record = header;
        let mut bytes = vec![0; header + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize];
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 3);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            2,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_DIRECTION,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            text_start,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            text_end,
        );
        bytes[record + abi::ENGINE_STYLE_MUTATION_DIRECTION] = DIRECTION_RTL;
        bytes
    }

    #[test]
    fn crossing_style_update_is_rejected_before_measure_preparation() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let mut initial_styles = override_style_bytes_for_text(7, 4, DIRECTION_RTL);
        let child = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
            + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            0,
        );
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            2,
        );
        let (mut engine, mut shaper) =
            shaped_engine_with_font_and_styles("abcd", FONT, 9_362, &initial_styles, 2);
        let revision = engine.root_revision(4).unwrap();
        let preparation_count = engine.planner_paragraph_preparation_count(4, 1).unwrap();
        let text = utf16("wxyz");
        let text_bytes = text_mutation_bytes(&[(0, 4, &text)]);
        let crossing_bytes = topology_style_upsert_bytes(1, 3);
        let mut crossing = update(revision.engine, revision.root, 1);
        crossing.limits.max_clusters = 256;
        crossing.limits.max_lines = 256;
        crossing.limits.max_output_bytes = 1 << 20;
        crossing.semantic_view_mask = super::super::frame::SEMANTIC_VIEW_MEASUREMENT;
        crossing.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        crossing.style_mutations =
            parse_style_mutations(&crossing_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        assert!(matches!(
            engine.measure_paragraph_with_shaper(&mut shaper, crossing, 1),
            Err(EngineError::StyleNestingInvalid(FrameFault {
                paragraph_id: 1,
                style_id: 3,
            }))
        ));
        assert_eq!(engine.root_revision(4), Ok(revision));
        assert_eq!(engine.root_text(4).unwrap(), utf16("abcd"));
        assert_eq!(
            engine.planner_paragraph_preparation_count(4, 1),
            Ok(preparation_count)
        );
        assert!(engine.planners.contains_key(&4));

        let valid_bytes = topology_style_upsert_bytes(1, 2);
        crossing.style_mutations =
            parse_style_mutations(&valid_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        crossing.semantic_view_mask = 0;
        let measured = engine.measure_paragraph_with_shaper(&mut shaper, crossing, 1);
        assert!(
            measured.is_ok(),
            "valid nested update failed: {:?}",
            measured.err()
        );
        let measured = measured.unwrap();
        engine.commit_measure(measured).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), utf16("wxyz"));
    }

    #[test]
    fn crossing_style_update_is_rejected_before_publication_preparation() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let mut initial_styles = override_style_bytes_for_text(7, 4, DIRECTION_RTL);
        let child = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
            + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            0,
        );
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            2,
        );
        let (mut engine, mut shaper) =
            shaped_engine_with_font_and_styles("abcd", FONT, 9_362, &initial_styles, 2);
        let revision = engine.root_revision(4).unwrap();
        let preparation_count = engine.planner_paragraph_preparation_count(4, 1).unwrap();
        let text = utf16("wxyz");
        let text_bytes = text_mutation_bytes(&[(0, 4, &text)]);
        let crossing_bytes = topology_style_upsert_bytes(1, 3);
        let mut crossing = update(revision.engine, revision.root, 1);
        crossing.limits.max_clusters = 256;
        crossing.limits.max_lines = 256;
        crossing.limits.max_output_bytes = 1 << 20;
        crossing.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        crossing.style_mutations =
            parse_style_mutations(&crossing_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();

        assert!(matches!(
            engine.prepare_update_with_shaper(&mut shaper, crossing, 2),
            Err(EngineError::StyleNestingInvalid(FrameFault {
                paragraph_id: 1,
                style_id: 3,
            }))
        ));
        assert_eq!(engine.root_revision(4), Ok(revision));
        assert_eq!(engine.root_text(4).unwrap(), utf16("abcd"));
        assert_eq!(
            engine.planner_paragraph_preparation_count(4, 1),
            Ok(preparation_count)
        );
        assert!(engine.planners.contains_key(&4));

        let valid_bytes = topology_style_upsert_bytes(1, 2);
        crossing.style_mutations =
            parse_style_mutations(&valid_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, crossing, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), utf16("wxyz"));
    }

    #[test]
    fn text_preflight_validates_the_resulting_style_set_before_applying_edits() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let mut initial_styles = override_style_bytes_for_text(7, 4, DIRECTION_RTL);
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let child = header + stride;
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            1,
        );
        write_u32(
            &mut initial_styles,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            4,
        );
        let third = initial_styles.len();
        initial_styles.extend_from_within(child..child + stride);
        write_u32(
            &mut initial_styles,
            third + abi::ENGINE_STYLE_MUTATION_STYLE_ID,
            3,
        );
        write_u32(
            &mut initial_styles,
            third + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            2,
        );
        write_u32(
            &mut initial_styles,
            third + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            2,
        );
        write_u32(
            &mut initial_styles,
            third + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            3,
        );
        let (mut engine, _) =
            shaped_engine_with_font_and_styles("abcd", FONT, 9_362, &initial_styles, 3);

        // An unrelated incoming upsert cannot hide two retained ranges invalidated by the edit.
        let text = text_mutation_bytes(&[(2, 2, &[])]);
        let mut unrelated_style = override_style_bytes_for_text(7, 2, DIRECTION_RTL);
        let unrelated = header + stride;
        write_u32(
            &mut unrelated_style,
            unrelated + abi::ENGINE_STYLE_MUTATION_STYLE_ID,
            4,
        );
        write_u32(
            &mut unrelated_style,
            unrelated + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            1,
        );
        let text_batch = parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let style_batch =
            parse_style_mutations(&unrelated_style, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let apply_count = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .text_mutation_apply_count;
        let revision = engine.root_revision(4).unwrap();
        let mut invalid = update(revision.engine, revision.root, 1);
        invalid.text_mutations = text_batch;
        invalid.style_mutations = style_batch;
        assert_eq!(
            engine.prepare_update(invalid, 2),
            Err(EngineError::StyleRangeInvalid(FrameFault {
                paragraph_id: 1,
                style_id: 2,
            }))
        );
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text_mutation_apply_count,
            apply_count
        );

        // Replacing style 2 and removing style 3 makes the same text edit valid. The preflight
        // must validate the resulting set, not reject stale committed ranges being retired.
        let mut replacement_and_removal = override_style_bytes_for_text(7, 2, DIRECTION_RTL);
        write_u32(
            &mut replacement_and_removal,
            child + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            1,
        );
        let remove = remove_style_bytes(3);
        replacement_and_removal.extend_from_slice(&remove[header..]);
        let mut valid = update(1, 1, 1);
        valid.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        valid.style_mutations = parse_style_mutations(
            &replacement_and_removal,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
            3,
        )
        .unwrap();
        let prepared = engine.prepare_update(valid, 2).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62]);
        assert_eq!(engine.planner_style_count(4), Ok(2));
    }

    #[test]
    fn text_only_edit_rejects_retained_ranges_that_collapse_after_grapheme_normalization() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let mut styles = override_style_bytes_for_text(7, 4, DIRECTION_RTL);
        let first = header + stride;
        write_u32(
            &mut styles,
            first + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            1,
        );
        write_u32(&mut styles, first + abi::ENGINE_STYLE_MUTATION_TEXT_END, 4);
        let second = styles.len();
        styles.extend_from_within(first..first + stride);
        write_u32(&mut styles, second + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 3);
        write_u32(
            &mut styles,
            second + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            2,
        );
        write_u32(&mut styles, second + abi::ENGINE_STYLE_MUTATION_TEXT_END, 4);
        let (mut engine, _) = shaped_engine_with_font_and_styles("abcd", FONT, 9_362, &styles, 3);
        let revision = engine.root_revision(4).unwrap();
        let preparation_count = engine.planner_paragraph_preparation_count(4, 1).unwrap();

        // Both accepted style ranges are nested and valid for ASCII. Adding two combining
        // marks makes their grapheme-normalized ranges identical, which shares one cascade
        // order and therefore cannot produce a deterministic style topology.
        let combining_text = utf16("a\u{301}\u{302}d");
        let bytes = text_mutation_bytes(&[(0, 3, &combining_text[..3])]);
        let mut invalid = update(revision.engine, revision.root, 1);
        invalid.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert!(matches!(
            engine.prepare_update(invalid, 2),
            Err(EngineError::StyleNestingInvalid(_))
        ));
        assert_eq!(engine.root_revision(4), Ok(revision));
        assert_eq!(engine.root_text(4).unwrap(), utf16("abcd"));
        assert_eq!(
            engine.planner_paragraph_preparation_count(4, 1),
            Ok(preparation_count)
        );

        let replacement = utf16("xyz");
        let bytes = text_mutation_bytes(&[(0, 3, &replacement)]);
        let mut valid = update(revision.engine, revision.root, 1);
        valid.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(valid, 2).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), utf16("xyzd"));
    }

    #[test]
    fn sparse_edit_fuzz_matches_cold_real_font_recomputation() {
        let original = "alpha bravo charlie delta echo foxtrot golf hotel india juliet ".repeat(32);
        let mut text = utf16(&original);
        let styles = root_style_bytes_for_text(7, text.len() as u32);
        let geometry = multiline_root_geometry_bytes();
        let (mut warm_engine, mut warm_shaper) =
            shaped_outlined_engine_with_styles_geometry(&original, &styles, &geometry);
        assert!(
            warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .flow_layout
                .committed()
                .lines
                .len()
                > 100
        );
        let mut retained_steps = 0;
        let eligible = text
            .iter()
            .enumerate()
            .filter_map(|(index, unit)| {
                ((b'a' as u16..=b'z' as u16).contains(unit)
                    || (b'A' as u16..=b'Z' as u16).contains(unit))
                .then_some(index)
            })
            .collect::<Vec<_>>();
        let mut random = 0x2475_1a9b_u32;
        for step in 0..32_u32 {
            let mut positions = Vec::new();
            for _ in 0..3 {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                positions.push(eligible[random as usize % eligible.len()]);
            }
            positions.sort_unstable();
            positions.dedup();
            let payloads = positions
                .iter()
                .map(|position| {
                    [if (b'a' as u16..=b'z' as u16).contains(&text[*position]) {
                        text[*position] - 32
                    } else {
                        text[*position] + 32
                    }]
                })
                .collect::<Vec<_>>();
            for (position, payload) in positions.iter().zip(&payloads) {
                text[*position] = payload[0];
            }
            let records = [(0, text.len() as u32, text.as_slice())];
            let bytes = text_mutation_bytes(&records);
            let mut update = update(step + 1, step + 1, step + 1);
            update.limits.max_clusters = text.len() as u32;
            update.limits.max_lines = text.len() as u32;
            update.limits.max_output_bytes = 1 << 20;
            update.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            super::super::work_attribution::reset();
            let prepared = warm_engine
                .prepare_update_with_shaper(&mut warm_shaper, update, step + 2)
                .unwrap();
            let candidate = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(candidate.unicode_reused_for_text_edit);
            assert!(!candidate.shaping_runs.is_prepared());
            assert!(candidate.shape.is_prepared());
            retained_steps += usize::from(
                super::super::work_attribution::snapshot().copied_positioned_records > 0,
            );
            assert_gather_matches_full(&mut warm_engine);
            warm_engine.commit_update(prepared).unwrap();
            assert_gather_matches_full(&mut warm_engine);

            let current = String::from_utf16(&text).unwrap();
            let (cold_engine, _) =
                shaped_outlined_engine_with_styles_geometry(&current, &styles, &geometry);
            let warm = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, &alloc::format!("seeded step {step}"));
            assert_eq!(
                warm.shape.committed().runs.len(),
                1,
                "seeded step {step} must retain one canonical shaped run"
            );
        }
        assert!(
            retained_steps > 0,
            "seed must exercise clean-line retention"
        );
    }

    #[test]
    fn run_metadata_retained_for_ascii_letter_edit_while_shaped_output_refreshes() {
        const FONT: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        let original = "alpha bravo";
        let edited = "omega bravx";
        for nested_style in [false, true] {
            let styles = if nested_style {
                let mut styles = override_style_bytes_for_text(7, 11, DIRECTION_RTL);
                let child = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                    + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
                write_u32(
                    &mut styles,
                    child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
                    6,
                );
                styles
            } else {
                root_style_bytes_for_text(7, 11)
            };
            let style_count = if nested_style { 2 } else { 1 };
            let (mut warm_engine, mut shaper) =
                shaped_engine_with_font_and_styles(original, FONT, 2_937, &styles, style_count);
            let before = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let old_glyphs = before.shape.committed().glyph_ids.clone();
            let old_runs = before.shaping_runs.committed().runs().to_vec();
            let units = utf16(edited);
            let bytes = text_mutation_bytes(&[(0, 11, units.as_slice())]);
            let mut request = update(1, 1, 1);
            request.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let prepared = warm_engine
                .prepare_update_with_shaper(&mut shaper, request, 2)
                .unwrap();
            let pending = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(pending.unicode_reused_for_text_edit);
            assert!(!pending.shaping_runs.is_prepared());
            assert_eq!(pending.shaping_runs.active().runs(), old_runs);
            assert!(pending.shape.is_prepared());
            warm_engine.commit_update(prepared).unwrap();
            let (cold_engine, _) =
                shaped_engine_with_font_and_styles(edited, FONT, 2_937, &styles, style_count);
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_ne!(old_glyphs, cold.shape.committed().glyph_ids);
            let warm = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, "retained ASCII run metadata");

            let same_bytes = text_mutation_bytes(&[(0, 11, units.as_slice())]);
            let mut same = update(2, 2, 2);
            same.text_mutations =
                parse_text_mutations(&same_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let prepared = warm_engine
                .prepare_update_with_shaper(&mut shaper, same, 3)
                .unwrap();
            let same = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(!same.shaping_runs.is_prepared());
            assert!(!same.shape.is_prepared());
            warm_engine.commit_update(prepared).unwrap();
        }
    }

    #[test]
    fn run_metadata_rebuilds_when_text_loses_the_ascii_letter_certificate() {
        for (original, edited) in [
            ("alphaXbravo", "alpha\nbravo"),
            ("alpha\nbravo", "alphaXbravo"),
            ("alphaXbravo", "alpha.bravo"),
            ("alphaXbravo", "alphaΩbravo"),
            ("alphaXbravo", "alphaXYbravo"),
        ] {
            let (mut warm_engine, mut shaper) = shaped_inter_engine(original);
            let units = utf16(edited);
            let bytes = text_mutation_bytes(&[(0, utf16(original).len() as u32, units.as_slice())]);
            let styles = (utf16(original).len() != units.len())
                .then(|| root_style_bytes_for_text(7, units.len() as u32));
            let mut request = update(1, 1, 1);
            request.limits.max_clusters = 256;
            request.limits.max_lines = 256;
            request.limits.max_output_bytes = 1 << 20;
            request.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            if let Some(styles) = &styles {
                request.style_mutations =
                    parse_style_mutations(styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            }
            let prepared = warm_engine
                .prepare_update_with_shaper(&mut shaper, request, 2)
                .unwrap();
            let pending = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(
                !pending.unicode_reused_for_text_edit,
                "{original} → {edited}"
            );
            assert!(pending.shaping_runs.is_prepared(), "{original} → {edited}");
            warm_engine.commit_update(prepared).unwrap();
            let (cold_engine, _) = shaped_inter_engine(edited);
            let warm = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, "uncertified text edit");
        }
    }

    #[test]
    fn unsafe_ligature_combining_bidi_and_length_edits_match_cold_recomputation() {
        let mut text = utf16("office a\u{301} שלום 😀 affine");
        let (mut warm_engine, mut warm_shaper) =
            shaped_inter_engine(&String::from_utf16(&text).unwrap());
        for step in 0..7_u32 {
            let edits = match step {
                0 => vec![
                    (0usize, 1usize, vec![b'O' as u16]),
                    (text.len() - 1, 1, vec![b'E' as u16]),
                ],
                1 => vec![(3, 0, vec![b'X' as u16])],
                2 => vec![(3, 1, vec![])],
                3 => vec![(
                    text.iter().position(|unit| *unit == 0x0301).unwrap(),
                    1,
                    vec![0x0300],
                )],
                4 => vec![(
                    text.iter().position(|unit| *unit == 0x05e9).unwrap(),
                    1,
                    vec![0x05e8],
                )],
                5 => vec![(
                    text.windows(2)
                        .position(|pair| pair == [0xd83d, 0xde00])
                        .unwrap(),
                    2,
                    utf16("😃"),
                )],
                6 => vec![(0, 6, utf16("אבגדהו"))],
                _ => unreachable!(),
            };
            let records = edits
                .iter()
                .map(|(start, delete, insert)| {
                    (
                        u32::try_from(*start).unwrap(),
                        u32::try_from(*delete).unwrap(),
                        insert.as_slice(),
                    )
                })
                .collect::<Vec<_>>();
            let bytes = text_mutation_bytes(&records);
            for (start, delete, insert) in &edits {
                text.splice(*start..*start + *delete, insert.iter().copied());
            }
            let styles = root_style_bytes_for_text(7, u32::try_from(text.len()).unwrap());
            let mut update = update(step + 1, step + 1, step + 1);
            update.limits.max_clusters = 256;
            update.limits.max_lines = 256;
            update.limits.max_output_bytes = 1 << 20;
            update.text_mutations = parse_text_mutations(
                &bytes,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                u32::try_from(records.len()).unwrap(),
            )
            .unwrap();
            update.style_mutations =
                parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
            let prepared = warm_engine
                .prepare_update_with_shaper(&mut warm_shaper, update, step + 2)
                .unwrap();
            if step == 6 {
                let candidate = warm_engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap();
                assert_eq!(
                    candidate.bidi.committed().paragraph_levels.first(),
                    Some(&0)
                );
                assert_eq!(candidate.bidi.active().paragraph_levels.first(), Some(&1));
                assert!(!candidate.layout_dirty.valid);
                assert!(
                    candidate
                        .flow_layout
                        .active()
                        .recomposed_line_ranges()
                        .is_none()
                );
            }
            warm_engine.commit_update(prepared).unwrap();
            let shaped_units = crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units;
            if step == 0 {
                assert!(
                    shaped_units >= text.len(),
                    "Inter's unsafe concat chain must select broad shaping"
                );
            }

            let current = String::from_utf16(&text).unwrap();
            let (cold_engine, _) = shaped_inter_engine(&current);
            let warm = warm_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, &alloc::format!("fallback step {step}"));
        }
    }

    #[test]
    fn invalid_utf16_rejects_text_and_unicode_analysis_together() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let invalid_bytes = text_mutation_bytes(&[(0, 0, &[0xd800])]);
        let mut invalid = update(0, 0, 0);
        invalid.text_mutations =
            parse_text_mutations(&invalid_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(invalid, 1),
            Err(EngineError::InvalidRequest)
        );
        assert!(engine.root_revision(4).is_ok());

        let valid_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62])]);
        let mut valid = update(0, 0, 0);
        valid.text_mutations =
            parse_text_mutations(&valid_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(valid, 1).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62]);
    }

    #[test]
    fn ascii_text_reuse_does_not_suppress_an_independent_bidi_invalidation() {
        let mut paragraph = ParagraphState::default();
        {
            let (committed, pending) = paragraph.text.pair_mut();
            committed.units = "abc".encode_utf16().collect();
            pending.units = "axc".encode_utf16().collect();
        }
        paragraph.text.mark_prepared();
        paragraph.text_edits.push(TextEdit {
            old_start: 1,
            old_end: 2,
            new_start: 1,
            new_end: 2,
        });
        paragraph.style_invalidation.bidi = true;
        paragraph
            .unicode
            .pending_mut()
            .analyze(&paragraph.text.committed().units)
            .unwrap();

        let mut candidate = PreflightTextCandidate {
            unicode_state: CandidateUnicode::ReuseCommitted,
            ..PreflightTextCandidate::default()
        };
        paragraph.prepare_unicode(Some(&mut candidate)).unwrap();
        assert!(paragraph.unicode_reused_for_text_edit);
        paragraph.prepare_bidi().unwrap();
        assert!(paragraph.bidi.is_prepared());
        assert_eq!(paragraph.bidi.pending().paragraph_levels, [0]);
    }

    #[test]
    fn text_batch_returning_to_committed_units_keeps_identity_edits_and_reuses_unicode() {
        let committed = utf16("ab");
        let bytes = text_mutation_bytes(&[(1, 1, &[]), (1, 0, &[0x62])]);
        let mutations = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut paragraph = ParagraphState::default();
        {
            let (committed_text, _) = paragraph.text.pair_mut();
            committed_text.units = committed.clone();
            committed_text.unit_ids = [1, 2].to_vec();
            committed_text.next_unit_id = 3;
        }
        paragraph.unicode.pair_mut().0.analyze(&committed).unwrap();
        let committed_boundaries = paragraph.unicode.committed().grapheme_boundaries().to_vec();
        let (mut candidate, edits) = test_preflight_candidate(&committed, mutations);
        candidate.unicode_state = CandidateUnicode::ReuseCommitted;

        paragraph
            .prepare_text(mutations, Some(&mut candidate), &edits)
            .unwrap();
        paragraph.prepare_unicode(Some(&mut candidate)).unwrap();

        assert_eq!(paragraph.text.pending().units, committed);
        assert_ne!(
            paragraph.text.pending().unit_ids,
            paragraph.text.committed().unit_ids
        );
        assert!(paragraph.unicode_reused_for_text_edit);
        assert_eq!(
            paragraph.unicode.active().grapheme_boundaries(),
            committed_boundaries
        );
    }

    #[test]
    fn changed_text_preflight_analysis_is_transferred_without_reanalysis() {
        let committed = utf16("abc");
        let bytes = text_mutation_bytes(&[(1, 1, &[0x78])]);
        let mutations = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut paragraph = ParagraphState::default();
        {
            let (committed_text, _) = paragraph.text.pair_mut();
            committed_text.units = committed.clone();
            committed_text.unit_ids = [1, 2, 3].to_vec();
            committed_text.next_unit_id = 4;
            paragraph.unicode.pair_mut().0.analyze(&committed).unwrap();
        }
        let (mut candidate, edits) = test_preflight_candidate(&committed, mutations);
        assert_eq!(candidate.unicode.analysis_count(), 1);
        paragraph
            .prepare_text(mutations, Some(&mut candidate), &edits)
            .unwrap();
        paragraph.prepare_unicode(Some(&mut candidate)).unwrap();

        let mut cold = UnicodeAnalysis::default();
        cold.analyze(&paragraph.text.pending().units).unwrap();
        assert_eq!(paragraph.unicode.pending().analysis_count(), 1);
        assert_eq!(
            paragraph.unicode.pending().grapheme_boundaries(),
            cold.grapheme_boundaries()
        );
        assert_eq!(
            paragraph.unicode.pending().line_breaks(),
            cold.line_breaks()
        );
    }

    #[test]
    fn real_text_preflight_analyzes_once_and_queries_and_publication_reuse_it() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let initial_text = utf16("abc");
        let initial_bytes = text_mutation_bytes(&[(0, 0, &initial_text)]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let changed_text = utf16("a\u{301}b");
        let changed_bytes = text_mutation_bytes(&[(0, 3, &changed_text)]);
        let mut changed = update(1, 1, 1);
        changed.text_mutations =
            parse_text_mutations(&changed_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(changed, 1).unwrap();
        let paragraph = engine.planners.get(&4).unwrap().paragraph(1).unwrap();
        assert_eq!(paragraph.state.unicode.pending().analysis_count(), 1);
        engine.commit_measure(measured).unwrap();

        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        let mut cold = UnicodeAnalysis::default();
        cold.analyze(&changed_text).unwrap();
        assert_eq!(state.unicode.active().analysis_count(), 1);
        assert_eq!(
            state.unicode.active().grapheme_boundaries(),
            cold.grapheme_boundaries()
        );
        assert_eq!(state.unicode.active().line_breaks(), cold.line_breaks());
        let analysis_total =
            state.unicode.committed().analysis_count() + state.unicode.pending().analysis_count();

        let query = update(1, 1, 1);
        let measured = engine.measure_paragraph(query, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_eq!(
            state.unicode.committed().analysis_count() + state.unicode.pending().analysis_count(),
            analysis_total
        );

        let prepared = engine.prepare_update(update(1, 1, 1), 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let state = &engine.planners.get(&4).unwrap().paragraph(1).unwrap().state;
        assert_eq!(
            state.unicode.committed().analysis_count() + state.unicode.pending().analysis_count(),
            analysis_total
        );
    }

    #[test]
    fn root_direction_reanalyzes_bidi_without_a_text_mutation() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();

        let text_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let mut text = update(0, 0, 0);
        text.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(text, 1).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
                .committed()
                .paragraph_levels,
            &[0]
        );

        let root_bytes = root_style_bytes_with_direction(7, DIRECTION_RTL);
        let mut root = update(1, 1, 1);
        root.style_mutations =
            parse_style_mutations(&root_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(root, 2).unwrap();
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
                .committed()
                .paragraph_levels,
            &[0]
        );
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
                .committed()
                .paragraph_levels,
            &[1]
        );
        let revision = engine.root_revision(4).unwrap();
        let edit_bytes = text_mutation_bytes(&[(0, 4, &utf16("wxyz"))]);
        let mut edit = update(revision.engine, revision.root, 1);
        edit.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let measured = engine.measure_paragraph(edit, 1).unwrap();
        engine.commit_measure(measured).unwrap();
        for publication_generation in [None, Some(3)] {
            if let Some(generation) = publication_generation {
                let follow = engine
                    .prepare_update(update(revision.engine, revision.root, 1), generation)
                    .unwrap();
                engine.commit_update(follow).unwrap();
            }
            assert_eq!(engine.root_text(4).unwrap(), utf16("wxyz"));
            assert_eq!(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .bidi
                    .committed()
                    .paragraph_levels,
                &[1]
            );
            assert_eq!(
                engine.dispose_font_stack(7),
                Err(EngineError::RegistrationInUse)
            );
        }
        engine.dispose_root(4).unwrap();
        assert_eq!(engine.dispose_font_stack(7), Ok(()));
    }

    #[test]
    fn paint_only_style_partition_remaps_clusters_without_reflow_or_reshaping() {
        fn paint_partition_bytes(
            root_style: &[u8],
            start: u32,
            end: u32,
            feature: Option<(u32, u32, u32, u32)>,
        ) -> Vec<u8> {
            let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
            let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
            let feature_offset = header + stride * 2;
            let mut bytes = vec![
                0;
                feature_offset
                    + usize::from(feature.is_some())
                        * abi::FEATURE_RECORD_SIZE as usize
            ];
            bytes[header..header + stride].copy_from_slice(&root_style[header..header + stride]);
            if let Some((tag, value, feature_start, feature_end)) = feature {
                let mask =
                    crate::wire::read_u32(&bytes, header + abi::ENGINE_STYLE_MUTATION_FIELD_MASK)
                        .unwrap();
                write_u32(
                    &mut bytes,
                    header + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                    mask | crate::engine::frame::STYLE_FIELD_FEATURES,
                );
                bytes[header + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT
                    ..header + abi::ENGINE_STYLE_MUTATION_FEATURE_COUNT + 2]
                    .copy_from_slice(&1_u16.to_le_bytes());
                write_u32(
                    &mut bytes,
                    header + abi::ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
                    feature_offset as u32,
                );
                write_u32(&mut bytes, feature_offset + abi::FEATURE_TAG, tag);
                write_u32(&mut bytes, feature_offset + abi::FEATURE_VALUE, value);
                write_u32(
                    &mut bytes,
                    feature_offset + abi::FEATURE_START,
                    feature_start,
                );
                write_u32(&mut bytes, feature_offset + abi::FEATURE_END, feature_end);
            }
            let child = header + stride;
            bytes[child + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
            write_u32(&mut bytes, child + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 2);
            write_u32(
                &mut bytes,
                child + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                1,
            );
            write_u32(
                &mut bytes,
                child + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
                1,
            );
            write_u32(
                &mut bytes,
                child + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                STYLE_FIELD_FOREGROUND,
            );
            write_u32(
                &mut bytes,
                child + abi::ENGINE_STYLE_MUTATION_TEXT_START,
                start,
            );
            write_u32(&mut bytes, child + abi::ENGINE_STYLE_MUTATION_TEXT_END, end);
            write_u32(
                &mut bytes,
                child + abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
                0xff00_00ff,
            );
            bytes
        }

        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        const GLYPH_COUNT: u32 = 9_362;
        let text = "abcdefg";
        let text_end = u32::try_from(text.encode_utf16().count()).unwrap();
        let root_style = root_style_bytes_for_text(7, text_end);
        let split = paint_partition_bytes(&root_style, 1, 4, None);
        let moved = paint_partition_bytes(&root_style, 2, 5, None);
        let root_only = root_style_bytes_for_text(7, text_end);
        let steps = [
            (split.clone(), 2, split, 2, vec![0, 1, 1, 1, 2, 2, 2]),
            (moved.clone(), 2, moved, 2, vec![0, 0, 1, 1, 1, 2, 2]),
            (
                remove_style_bytes(2),
                1,
                root_only,
                1,
                vec![0, 0, 0, 0, 0, 0, 0],
            ),
        ];
        let (mut engine, mut shaper) = shaped_engine(text);

        for (
            step,
            (mutation_bytes, mutation_count, cold_bytes, cold_count, expected_style_indexes),
        ) in steps.into_iter().enumerate()
        {
            let mut request = update(step as u32 + 1, step as u32 + 1, step as u32 + 1);
            request.style_mutations = parse_style_mutations(
                &mutation_bytes,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                mutation_count,
            )
            .unwrap();
            let before_calls = crate::SHAPINGS.with(core::cell::Cell::get);
            let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
            let before_lines = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .flow_layout
                .committed()
                .lines
                .clone();
            let before_corrections = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .clusters
                .committed()
                .break_corrections
                .iter()
                .map(|slots| slots.iter().map(|slot| slot.get()).collect::<Vec<_>>())
                .collect::<Vec<_>>();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, request, step as u32 + 2)
                .unwrap();
            let staged = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert!(!staged.style_invalidation.bidi);
            assert!(!staged.style_invalidation.shaping);
            assert!(!staged.style_invalidation.metrics);
            assert!(staged.style_invalidation.positioning);
            assert!(staged.style_invalidation.cluster_mapping);
            assert!(!staged.bidi.is_prepared());
            assert!(!staged.shape.is_prepared());
            assert!(!staged.flow_layout.is_prepared());
            engine.commit_update(prepared).unwrap();
            assert_eq!(
                crate::SHAPINGS.with(core::cell::Cell::get) - before_calls,
                0,
                "paint-only partition step {step} must retain HarfRust output"
            );
            assert_eq!(
                crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units,
                0,
                "paint-only partition step {step} must not shape text"
            );

            let warm = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_eq!(warm.shaping_runs.committed().runs().len(), 1);
            assert_eq!(
                warm.clusters.committed().style_indexes,
                expected_style_indexes,
                "style-index remapping for paint-only partition step {step}"
            );
            assert_eq!(warm.flow_layout.committed().lines, before_lines);
            assert_eq!(
                warm.clusters
                    .committed()
                    .break_corrections
                    .iter()
                    .map(|slots| slots.iter().map(|slot| slot.get()).collect::<Vec<_>>())
                    .collect::<Vec<_>>(),
                before_corrections,
                "mapping-only updates preserve cached boundary corrections"
            );

            let (cold_engine, _) = shaped_engine_with_font_and_styles(
                text,
                FONT,
                GLYPH_COUNT,
                &cold_bytes,
                cold_count,
            );
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, &alloc::format!("paint partition step {step}"));
            assert_eq!(
                warm.clusters.committed().style_indexes,
                cold.clusters.committed().style_indexes,
                "warm/cold style-index lanes at paint partition step {step}"
            );
        }

        // Amiri's `liga=1` glyph stream is shorter than its `liga=0` control below;
        // the combining mark also remains one grapheme range. Moving paint coverage
        // between them must remap current styles without reshaping either sequence.
        const AMIRI: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf"
        );
        let amiri_glyph_count = u32::from(
            read_fonts::FontRef::new(AMIRI)
                .unwrap()
                .maxp()
                .unwrap()
                .num_glyphs(),
        );
        let unicode_text = "office a\u{301} office";
        let unicode_text_end = u32::try_from(unicode_text.encode_utf16().count()).unwrap();
        let unicode_root_style = root_style_bytes_for_text(7, unicode_text_end);
        let liga = u32::from_be_bytes(*b"liga");
        let unicode_initial_styles = paint_partition_bytes(
            &unicode_root_style,
            0,
            6,
            Some((liga, 1, 0, unicode_text_end)),
        );
        let unicode_moved_styles = paint_partition_bytes(
            &unicode_root_style,
            7,
            9,
            Some((liga, 1, 0, unicode_text_end)),
        );
        let (mut unicode_engine, mut unicode_shaper) = shaped_engine_with_font_and_styles(
            unicode_text,
            AMIRI,
            amiri_glyph_count,
            &unicode_initial_styles,
            2,
        );
        let unicode_initial = unicode_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let initial_clusters = unicode_initial.clusters.committed();
        let ligated_glyph_count = unicode_initial.shape.committed().glyph_ids.len();
        assert!(
            initial_clusters
                .starts
                .iter()
                .zip(&initial_clusters.ends)
                .any(|(&start, &end)| (start, end) == (7, 9)),
            "combining acute must remain one grapheme cluster"
        );
        let mut unicode_update = update(1, 1, 1);
        unicode_update.style_mutations =
            parse_style_mutations(&unicode_moved_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let unicode_before_calls = crate::SHAPINGS.with(core::cell::Cell::get);
        let unicode_before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
        let prepared = unicode_engine
            .prepare_update_with_shaper(&mut unicode_shaper, unicode_update, 2)
            .unwrap();
        unicode_engine.commit_update(prepared).unwrap();
        assert_eq!(
            crate::SHAPINGS.with(core::cell::Cell::get) - unicode_before_calls,
            0,
            "Unicode paint remapping must reuse HarfRust output"
        );
        assert_eq!(
            crate::SHAPED_UNITS.with(core::cell::Cell::get) - unicode_before_units,
            0,
            "Unicode paint remapping must not reshape ligatures or combining text"
        );
        let unicode_warm = unicode_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let (unicode_cold_engine, _) = shaped_engine_with_font_and_styles(
            unicode_text,
            AMIRI,
            amiri_glyph_count,
            &unicode_moved_styles,
            2,
        );
        let (plain_engine, _) = shaped_engine_with_font_and_styles(
            unicode_text,
            AMIRI,
            amiri_glyph_count,
            &paint_partition_bytes(
                &unicode_root_style,
                0,
                6,
                Some((liga, 0, 0, unicode_text_end)),
            ),
            2,
        );
        assert!(
            ligated_glyph_count
                < plain_engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .shape
                    .committed()
                    .glyph_ids
                    .len(),
            "Amiri's liga feature must reduce the glyph count for the authenticated `office` fixture"
        );
        assert_visible_shape_equal(
            unicode_warm,
            unicode_cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            "ligature and combining-grapheme paint remapping",
        );

        // The Fredoka #216 fixture exercises actual wrapped unsafe-boundary corrections and
        // their cached island shapes while paint-only segments move across the paragraph.
        const FREDOKA: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/fredoka-issue-216/Fredoka-Regular.ttf"
        );
        let fredoka_glyph_count = u32::from(
            read_fonts::FontRef::new(FREDOKA)
                .unwrap()
                .maxp()
                .unwrap()
                .num_glyphs(),
        );
        let wrapped_text = "Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end.";
        let wrapped_text_end = u32::try_from(wrapped_text.encode_utf16().count()).unwrap();
        let mut wrapped_root_style = root_style_bytes_for_text(7, wrapped_text_end);
        write_f32(
            &mut wrapped_root_style,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            24.0,
        );
        let wrapped_initial_styles = paint_partition_bytes(&wrapped_root_style, 0, 7, None);
        let moved_start = u32::try_from(wrapped_text.find("Layout").unwrap()).unwrap();
        let wrapped_moved_styles =
            paint_partition_bytes(&wrapped_root_style, moved_start, moved_start + 6, None);
        let wrapped_root_only_styles = wrapped_root_style.clone();
        let mut wrapped_geometry = multiline_root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        for (offset, value) in [
            (constraint + abi::ENGINE_CONSTRAINT_WIDTH, 420.0),
            (region + abi::ENGINE_REGION_INLINE_END, 420.0),
            (region + abi::ENGINE_REGION_CLIP_INLINE_END, 420.0),
        ] {
            write_f32(&mut wrapped_geometry, offset, value);
        }
        let (mut wrapped_engine, mut wrapped_shaper) =
            shaped_engine_with_font_styles_geometry_and_extents(
                wrapped_text,
                FREDOKA,
                fredoka_glyph_count,
                &wrapped_initial_styles,
                2,
                Some((&wrapped_geometry, 0)),
                false,
            );
        let wrapped_initial = wrapped_engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap();
        let wrapped_line_count = wrapped_initial.flow_layout.committed().lines.len();
        assert!(
            wrapped_line_count > 1,
            "fixture must wrap across multiple lines"
        );
        let initial_corrections = wrapped_initial
            .clusters
            .committed()
            .break_corrections
            .iter()
            .map(|slots| slots.iter().map(|slot| slot.get()).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        assert!(
            initial_corrections.iter().flatten().any(Option::is_some),
            "Fredoka wrapping must populate unsafe-boundary corrections"
        );
        let initial_islands = wrapped_initial
            .clusters
            .committed()
            .islands
            .borrow()
            .shape
            .runs
            .len();
        assert!(
            initial_islands > 0,
            "fixture must cache boundary island shapes"
        );

        for (step, (mutation_bytes, cold_bytes, mutation_count, cold_count)) in [
            (wrapped_moved_styles.clone(), wrapped_moved_styles, 2, 2),
            (
                remove_style_bytes(2),
                wrapped_root_only_styles.clone(),
                1,
                1,
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let before = wrapped_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            let before_corrections = before
                .clusters
                .committed()
                .break_corrections
                .iter()
                .map(|slots| slots.iter().map(|slot| slot.get()).collect::<Vec<_>>())
                .collect::<Vec<_>>();
            let before_island_runs = before
                .clusters
                .committed()
                .islands
                .borrow()
                .shape
                .runs
                .len();
            let mut request = update(step as u32 + 1, step as u32 + 1, step as u32 + 1);
            request.style_mutations = parse_style_mutations(
                &mutation_bytes,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                mutation_count,
            )
            .unwrap();
            let before_calls = crate::SHAPINGS.with(core::cell::Cell::get);
            let before_units = crate::SHAPED_UNITS.with(core::cell::Cell::get);
            let prepared = wrapped_engine
                .prepare_update_with_shaper(&mut wrapped_shaper, request, step as u32 + 2)
                .unwrap();
            wrapped_engine.commit_update(prepared).unwrap();
            assert_eq!(
                crate::SHAPINGS.with(core::cell::Cell::get) - before_calls,
                0,
                "paint-only wrapped update {step} must reuse boundary shaping"
            );
            assert_eq!(
                crate::SHAPED_UNITS.with(core::cell::Cell::get) - before_units,
                0,
                "paint-only wrapped update {step} must not reshape paragraph text"
            );
            let warm = wrapped_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_eq!(warm.flow_layout.committed().lines.len(), wrapped_line_count);
            assert_eq!(
                warm.clusters
                    .committed()
                    .break_corrections
                    .iter()
                    .map(|slots| slots.iter().map(|slot| slot.get()).collect::<Vec<_>>())
                    .collect::<Vec<_>>(),
                before_corrections,
                "paint-only wrapped updates preserve boundary corrections"
            );
            assert_eq!(
                warm.clusters.committed().islands.borrow().shape.runs.len(),
                before_island_runs,
                "paint-only wrapped updates preserve cached island shapes"
            );
            let (cold_engine, _) = shaped_engine_with_font_styles_geometry_and_extents(
                wrapped_text,
                FREDOKA,
                fredoka_glyph_count,
                &cold_bytes,
                cold_count,
                Some((&wrapped_geometry, 0)),
                false,
            );
            let cold = cold_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap();
            assert_visible_shape_equal(warm, cold, &alloc::format!("wrapped paint step {step}"));
        }

        // A later width edit must rebuild the geometry from the retained mapping and still
        // match an independent cold layout after the paint-only refreshes.
        let mut narrower_geometry = wrapped_geometry.clone();
        for (offset, value) in [
            (constraint + abi::ENGINE_CONSTRAINT_WIDTH, 380.0),
            (region + abi::ENGINE_REGION_INLINE_END, 380.0),
            (region + abi::ENGINE_REGION_CLIP_INLINE_END, 380.0),
        ] {
            write_f32(&mut narrower_geometry, offset, value);
        }
        let mut width_edit = update(3, 3, 3);
        width_edit.limits.max_clusters = wrapped_text_end.max(256);
        width_edit.limits.max_lines = wrapped_text_end.max(256);
        width_edit.limits.max_output_bytes = 1 << 20;
        width_edit.geometry = parse_root_geometry(&narrower_geometry, width_edit.limits);
        let prepared = wrapped_engine
            .prepare_update_with_shaper(&mut wrapped_shaper, width_edit, 4)
            .unwrap();
        wrapped_engine.commit_update(prepared).unwrap();
        let (cold_width_engine, _) = shaped_engine_with_font_styles_geometry_and_extents(
            wrapped_text,
            FREDOKA,
            fredoka_glyph_count,
            &wrapped_root_only_styles,
            1,
            Some((&narrower_geometry, 0)),
            false,
        );
        assert_visible_shape_equal(
            wrapped_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            cold_width_engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap(),
            "width edit after wrapped paint-only refresh",
        );
    }

    #[test]
    fn retained_style_upserts_commit_and_root_removal_clears_retained_state() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let root_bytes = root_style_bytes(7);
        let mut root = update(1, 1, 1);
        root.style_mutations =
            parse_style_mutations(&root_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(root, 2).unwrap();
        assert_eq!(engine.planner_style_count(4), Ok(0));
        assert_eq!(engine.planner_style_segment_count(4), Ok(0));
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.planner_style_count(4), Ok(1));
        assert_eq!(engine.planner_style_segment_count(4), Ok(1));
        assert_eq!(engine.planner_shaping_run_count(4), Ok(1));

        let remove_bytes = remove_style_bytes(1);
        let mut remove = update(2, 2, 2);
        remove.style_mutations =
            parse_style_mutations(&remove_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(remove, 3),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.planner_style_count(4), Ok(1));

        let missing_stack_bytes = root_style_bytes(99);
        let mut missing_stack = update(2, 2, 2);
        missing_stack.style_mutations =
            parse_style_mutations(&missing_stack_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        // A style naming an unregistered font stack is caller-actionable, so it reports its own
        // status and names the paragraph and the style id the request assigned.
        assert_eq!(
            engine.prepare_update(missing_stack, 3),
            Err(EngineError::StyleFontStackMissing(FrameFault {
                paragraph_id: 1,
                style_id: 1,
            }))
        );
        assert_eq!(engine.planner_style_count(4), Ok(1));
    }

    #[test]
    fn an_invalid_later_replacement_cannot_partially_mutate_committed_text() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let apply_count = engine
            .planners
            .get(&4)
            .unwrap()
            .first_paragraph_state()
            .unwrap()
            .text_mutation_apply_count;
        // The first edit grows the retained text to six units. The later offset is outside that
        // intermediate text, so the batch must fail before applying its valid prefix.
        let bytes = text_mutation_bytes(&[(1, 0, &[0x58, 0x59]), (7, 0, &[0x62])]);
        let batch = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut request = update(1, 1, 1);
        request.text_mutations = batch;
        assert_eq!(
            engine.prepare_update(request, 2),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text_mutation_apply_count,
            apply_count,
            "preflight must reject the full batch before applying its first mutation"
        );
    }

    #[test]
    fn ordered_paragraphs_commit_reorder_and_remove_as_one_planner() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
        ]);
        let text_bytes =
            paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61, 0x62]), (2, 0, 0, &[0x63, 0x64])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        initial.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61, 0x62]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x63, 0x64]
        );
        let original_first_incarnation = planner.paragraph(1).unwrap().incarnation;
        let original_second_incarnation = planner.paragraph(2).unwrap().incarnation;
        assert_ne!(original_first_incarnation, original_second_incarnation);

        let reorder_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 0),
        ]);
        let mut reorder = update(1, 1, 1);
        reorder.limits.max_paragraphs = 2;
        reorder.paragraph_mutations =
            parse_paragraph_mutations(&reorder_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let prepared = engine.prepare_update(reorder, 2).unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [2, 1]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61, 0x62]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x63, 0x64]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().incarnation,
            original_first_incarnation
        );
        assert_eq!(
            planner.paragraph(2).unwrap().incarnation,
            original_second_incarnation
        );

        let remove_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 1, 0)]);
        let mut remove = update(2, 2, 2);
        remove.limits.max_paragraphs = 2;
        remove.paragraph_mutations =
            parse_paragraph_mutations(&remove_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(remove, 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.ordered_paragraphs,
            [ParagraphOrder { order: 0, id: 2 }]
        );
        assert!(planner.paragraph(1).is_none());
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x63, 0x64]
        );
        assert!(planner.spare_paragraph.is_some());

        let spare_text_capacity = planner
            .spare_paragraph
            .as_ref()
            .unwrap()
            .text
            .committed()
            .units
            .capacity();
        let replacement_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 1)]);
        let replacement_text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x7a])]);
        let mut replacement = update(3, 3, 3);
        replacement.limits.max_paragraphs = 2;
        replacement.paragraph_mutations =
            parse_paragraph_mutations(&replacement_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        replacement.text_mutations =
            parse_text_mutations(&replacement_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(replacement, 4).unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        let replacement = planner.paragraph(1).unwrap();
        assert_ne!(replacement.incarnation, original_first_incarnation);
        let recycled = &replacement.state;
        assert_eq!(
            recycled.text.committed().units,
            [0x7a],
            "a recycled paragraph must begin semantically empty"
        );
        assert_eq!(
            recycled.text.committed().units.capacity(),
            spare_text_capacity,
            "paragraph recycling must retain its reserved text allocation"
        );
    }

    #[test]
    fn explicit_rank_edits_allow_temporary_duplicate_base_orders() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let initial_lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
            (PARAGRAPH_MUTATION_UPSERT, 3, 2),
        ]);
        let initial_order =
            paragraph_order_mutation_bytes(&[(1, 7, 0.0), (2, 7, 1.0), (3, 7, 2.0)]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 3;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&initial_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        initial.paragraph_order_mutations =
            parse_paragraph_order_mutations(&initial_order, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let accepted_revision = engine.planners.get(&4).unwrap().revision;
        for rank in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let bytes = paragraph_order_mutation_bytes(&[(1, 7, rank)]);
            let mut invalid_update = update(1, 1, 1);
            invalid_update.limits.max_paragraphs = 3;
            invalid_update.paragraph_order_mutations =
                parse_paragraph_order_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                    .unwrap();
            assert_eq!(
                engine.prepare_update(invalid_update, 2),
                Err(EngineError::InvalidRequest)
            );
            let mut invalid_measure = update(1, 1, 1);
            invalid_measure.limits.max_paragraphs = 3;
            invalid_measure.paragraph_order_mutations =
                parse_paragraph_order_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                    .unwrap();
            assert_eq!(
                engine.measure_paragraph(invalid_measure, 1),
                Err(EngineError::InvalidRequest)
            );
            let planner = engine.planners.get(&4).unwrap();
            assert_eq!(planner.revision, accepted_revision);
            assert!(!planner.lifecycle_prepared);
            assert_eq!(planner.paragraph(1).unwrap().placement.rank, 0.0);
        }

        // A later query with no lifecycle edit must preserve valid duplicate base orders using
        // their already-committed scoped ranks.
        let mut retained_query = update(1, 1, 1);
        retained_query.limits.max_paragraphs = 3;
        let measured = engine.measure_paragraph(retained_query, 2).unwrap();
        engine.commit_measure(measured).unwrap();

        let partial_lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 2),
        ]);
        let explicit_order =
            paragraph_order_mutation_bytes(&[(1, 7, 0.0), (2, 7, 1.0), (3, 7, 2.0)]);
        let mut partial_update = update(1, 1, 1);
        partial_update.limits.max_paragraphs = 3;
        partial_update.paragraph_mutations =
            parse_paragraph_mutations(&partial_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        partial_update.paragraph_order_mutations =
            parse_paragraph_order_mutations(&explicit_order, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let prepared = engine.prepare_update(partial_update, 2).unwrap();
        engine.commit_update(prepared).unwrap();

        assert_eq!(
            engine
                .planners
                .get(&4)
                .unwrap()
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2, 3]
        );
    }

    #[test]
    fn semantic_mutations_follow_authored_order_after_a_scoped_rank_commit() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let scoped_order = paragraph_order_mutation_bytes(&[(1, 7, 1.0), (2, 7, 0.0)]);
        let initial_text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61]), (2, 0, 0, &[0x62])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.paragraph_order_mutations =
            parse_paragraph_order_mutations(&scoped_order, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        initial.text_mutations =
            parse_text_mutations(&initial_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [2, 1],
            "the scoped rank controls renderer order"
        );
        assert_eq!(
            planner
                .paragraphs
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [1, 2],
            "semantic records retain authored order"
        );

        let replacement = paragraph_text_mutation_bytes(&[(1, 0, 1, &[0x63]), (2, 0, 1, &[0x64])]);
        let mut next = update(1, 1, 1);
        next.limits.max_paragraphs = 2;
        next.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        next.text_mutations =
            parse_text_mutations(&replacement, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(next, 2).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x63]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x64]
        );
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [2, 1]
        );
    }

    #[test]
    fn sparse_preparation_owners_preserve_authored_order_without_root_entries() {
        let mut planner = PlannerState::default();
        for id in 1..=1_000 {
            planner.prepare_upsert(id, 1_000 - id, false).unwrap();
        }
        let bytes = paragraph_text_mutation_bytes(&[(7, 0, 0, &[0x61])]);
        let mut request = update(0, 0, 0);
        request.text_mutations =
            parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let lifecycle_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 0)]);
        let lifecycle =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        validate_lifecycle_input(
            &mut planner,
            lifecycle,
            ParagraphOrderMutationBatch::empty(),
            None,
            10_000,
        )
        .unwrap();
        planner
            .prepare_semantic_inputs(request, ParagraphInputScope::Indexed)
            .unwrap();
        assert_eq!(planner.semantic_input_spans.len(), 1);
        planner.pending_preparation_ids.extend_from_slice(&[7, 990]);
        planner.prepare_semantic_work_order().unwrap();
        assert_eq!(
            planner
                .order_sort_scratch
                .iter()
                .map(|entry| entry.1)
                .collect::<Vec<_>>(),
            [990, 7]
        );
        assert!(planner.semantic_input_spans(500).is_empty());
        planner.paragraph_mut(990).unwrap().pending_remove = true;
        planner.prepare_semantic_work_order().unwrap();
        assert_eq!(planner.order_sort_scratch.len(), 1);
        let removal_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 7, 0)]);
        let removal =
            parse_paragraph_mutations(&removal_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        assert!(
            validate_lifecycle_input(
                &mut planner,
                removal,
                ParagraphOrderMutationBatch::empty(),
                None,
                10_000,
            )
            .is_err()
        );
    }

    #[test]
    fn session_placement_row_order_keeps_translation_with_its_slot() {
        let mut sort_pairs = vec![(42, 7)];
        let mut empty: [SessionPlacementRow; 0] = [];
        sort_session_placement_rows(&mut empty, &mut sort_pairs).unwrap();
        let mut single = [SessionPlacementRow {
            slot: 4,
            inline: 8.0,
            block: -8.0,
        }];
        sort_session_placement_rows(&mut single, &mut sort_pairs).unwrap();
        assert_eq!(sort_pairs, [(42, 7)]);

        let mut rows = [
            SessionPlacementRow {
                slot: 9,
                inline: 1.0,
                block: -1.0,
            },
            SessionPlacementRow {
                slot: 2,
                inline: 2.0,
                block: -2.0,
            },
            SessionPlacementRow {
                slot: 7,
                inline: 3.0,
                block: -3.0,
            },
        ];
        sort_session_placement_rows(&mut rows, &mut sort_pairs).unwrap();
        assert_eq!(
            rows,
            [
                SessionPlacementRow {
                    slot: 2,
                    inline: 2.0,
                    block: -2.0,
                },
                SessionPlacementRow {
                    slot: 7,
                    inline: 3.0,
                    block: -3.0,
                },
                SessionPlacementRow {
                    slot: 9,
                    inline: 1.0,
                    block: -1.0,
                },
            ]
        );
    }

    #[test]
    fn lifecycle_pair_order_preserves_source_lookup_and_rejects_duplicate_ids() {
        let bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 9, 2),
            (PARAGRAPH_MUTATION_UPSERT, 2, 0),
            (PARAGRAPH_MUTATION_UPSERT, 7, 1),
        ]);
        let mutations =
            parse_paragraph_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3).unwrap();
        let order_bytes =
            paragraph_order_mutation_bytes(&[(7, 5, 0.5), (9, 6, 0.75), (2, 4, 0.25)]);
        let order_mutations =
            parse_paragraph_order_mutations(&order_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 3)
                .unwrap();
        let mut planner = PlannerState::default();
        let plan =
            validate_lifecycle_input(&mut planner, mutations, order_mutations, None, 3).unwrap();
        assert_eq!(
            plan.ordered
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [2, 7, 9]
        );
        // The lifecycle ID scratch is reused for order mutations before return.
        assert_eq!(planner.lifecycle_id_scratch, [(2, 2), (7, 0), (9, 1)]);
        for (id, expected) in [(2, (4, 0.25)), (7, (5, 0.5)), (9, (6, 0.75))] {
            assert_eq!(
                planned_paragraph_rank(
                    &planner,
                    order_mutations,
                    &planner.lifecycle_id_scratch,
                    id,
                )
                .unwrap(),
                expected
            );
        }
        assert_eq!(core::mem::size_of::<(u32, u32)>(), 8);
        assert_eq!(core::mem::size_of::<(u64, u32)>(), 16);

        let duplicate = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 7, 0),
            (PARAGRAPH_MUTATION_UPSERT, 7, 1),
        ]);
        let duplicate =
            parse_paragraph_mutations(&duplicate, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        assert!(matches!(
            validate_lifecycle_input(
                &mut PlannerState::default(),
                duplicate,
                ParagraphOrderMutationBatch::empty(),
                None,
                3,
            ),
            Err(EngineError::InvalidRequest)
        ));
    }

    #[test]
    fn unchanged_lifecycle_preserves_retained_order_and_scratch() {
        let mut planner = PlannerState {
            ordered_paragraphs: (1..=1_000)
                .map(|id| ParagraphOrder { order: id, id })
                .collect(),
            pending_ordered_paragraphs: vec![ParagraphOrder { order: 9, id: 9 }],
            lifecycle_id_scratch: vec![(17, 4)],
            lifecycle_membership_scratch: vec![17],
            ..PlannerState::default()
        };

        assert!(
            validate_lifecycle_input(
                &mut planner,
                super::super::semantic_wire::ParagraphMutationBatch::empty(),
                ParagraphOrderMutationBatch::empty(),
                None,
                999,
            )
            .is_err()
        );
        assert_eq!(planner.lifecycle_id_scratch, [(17, 4)]);
        assert_eq!(planner.lifecycle_membership_scratch, [17]);

        let plan = validate_lifecycle_input(
            &mut planner,
            super::super::semantic_wire::ParagraphMutationBatch::empty(),
            ParagraphOrderMutationBatch::empty(),
            None,
            10_000,
        )
        .unwrap();

        assert_eq!(plan.creates, 0);
        assert_eq!(plan.removals, 0);
        assert_eq!(plan.placement_changes, 0);
        assert!(plan.ordered.is_empty());
        assert_eq!(planner.ordered_paragraphs.len(), 1_000);
        assert_eq!(
            planner.pending_ordered_paragraphs,
            [ParagraphOrder { order: 9, id: 9 }]
        );
        assert_eq!(planner.lifecycle_id_scratch, [(17, 4)]);
        assert_eq!(planner.lifecycle_membership_scratch, [17]);
    }

    #[test]
    fn geometry_owner_preflight_rejects_before_lifecycle_writes_and_keeps_root_usable() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 7, 0),
            (PARAGRAPH_MUTATION_UPSERT, 8, 1),
        ]);
        let lifecycle =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let mut publication = update(0, 0, 0);
        publication.limits.max_paragraphs = 2;
        publication.limits.max_regions = 3;
        publication.paragraph_mutations = lifecycle;
        let constraints = geometry_with_constraint_owners(&[7, 8, 7]);
        publication.geometry = parse_test_geometry(&constraints, 3, 0, publication.limits);

        assert_eq!(
            engine.prepare_update(publication, 1),
            Err(EngineError::InvalidRequest),
            "noncontiguous repeated constraint owners must fail during preflight"
        );
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(7).is_none());
        assert!(planner.paragraph(8).is_none());
        assert!(!planner.lifecycle_prepared);

        // An invalid inline-object owner is rejected through the same shared preflight.
        let inline_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 0)]);
        let inline_lifecycle =
            parse_paragraph_mutations(&inline_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let inline_bytes = geometry_with_inline_object_owners(&[99]);
        let mut invalid_inline = update(0, 0, 0);
        invalid_inline.limits.max_paragraphs = 2;
        invalid_inline.paragraph_mutations = inline_lifecycle;
        invalid_inline.geometry = parse_test_geometry(&inline_bytes, 0, 1, invalid_inline.limits);
        assert_eq!(
            engine.prepare_update(invalid_inline, 1),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_none());

        let inline_group_lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 7, 0),
            (PARAGRAPH_MUTATION_UPSERT, 8, 1),
        ]);
        let inline_group_lifecycle = parse_paragraph_mutations(
            &inline_group_lifecycle_bytes,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
            2,
        )
        .unwrap();
        let inline_group_bytes = geometry_with_inline_object_owners(&[7, 8, 7]);
        let mut invalid_inline_group = update(0, 0, 0);
        invalid_inline_group.limits.max_paragraphs = 2;
        invalid_inline_group.limits.max_inline_objects = 3;
        invalid_inline_group.paragraph_mutations = inline_group_lifecycle;
        invalid_inline_group.geometry =
            parse_test_geometry(&inline_group_bytes, 0, 3, invalid_inline_group.limits);
        assert_eq!(
            engine.prepare_update(invalid_inline_group, 1),
            Err(EngineError::InvalidRequest),
            "noncontiguous repeated inline-object owners must fail during preflight"
        );
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_none());
        assert!(engine.planners.get(&4).unwrap().paragraph(8).is_none());

        // The rejected inputs did not poison the root or retain the proposed lifecycle.
        let mut valid = update(0, 0, 0);
        valid.limits.max_paragraphs = 2;
        valid.paragraph_mutations = inline_lifecycle;
        let prepared = engine.prepare_update(valid, 1).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine.root_revision(4),
            Ok(RootRevision { engine: 1, root: 1 })
        );
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_some());

        // Geometry for a paragraph removed by this request is also outside the projected set,
        // even though that paragraph is retained in the committed plan.
        let removal_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 7, 0)]);
        let removal =
            parse_paragraph_mutations(&removal_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let removed_owner_bytes = geometry_with_inline_object_owners(&[7]);
        let mut removed_owner = update(1, 1, 1);
        removed_owner.paragraph_mutations = removal;
        removed_owner.geometry =
            parse_test_geometry(&removed_owner_bytes, 0, 1, removed_owner.limits);
        assert_eq!(
            engine.prepare_update(removed_owner, 2),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(
            engine.root_revision(4),
            Ok(RootRevision { engine: 1, root: 1 })
        );
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_some());
    }

    #[test]
    fn measurement_geometry_owner_preflight_preserves_root_after_rejection() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 0)]);
        let lifecycle =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        let geometry_bytes = geometry_with_inline_object_owners(&[99]);
        let mut invalid = update(0, 0, 0);
        invalid.paragraph_mutations = lifecycle;
        invalid.geometry = parse_test_geometry(&geometry_bytes, 0, 1, invalid.limits);
        assert_eq!(
            engine.measure_paragraph(invalid, 7),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(7).is_none());
        assert!(!planner.lifecycle_prepared);

        let mut valid = update(0, 0, 0);
        valid.paragraph_mutations = lifecycle;
        let measured = engine.measure_paragraph(valid, 7).unwrap();
        engine.commit_measure(measured).unwrap();
        assert_eq!(engine.root_revision(4), Ok(RootRevision::default()));
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_some());
    }

    #[test]
    fn semantic_mutation_groups_are_keyed_independent_of_planner_insertion_order() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let initial_text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61]), (2, 0, 0, &[0x62])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.text_mutations =
            parse_text_mutations(&initial_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();
        let semantic_input_capacity = engine
            .planners
            .get(&4)
            .unwrap()
            .semantic_input_spans
            .capacity();
        assert!(semantic_input_capacity >= 2);

        let reverse_insertion =
            paragraph_text_mutation_bytes(&[(2, 0, 1, &[0x64]), (1, 0, 1, &[0x63])]);
        let reverse_styles = paragraph_root_style_bytes(&[(2, 12), (1, 11)]);
        let mut next = update(1, 1, 1);
        next.limits.max_paragraphs = 2;
        next.text_mutations =
            parse_text_mutations(&reverse_insertion, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        next.style_mutations =
            parse_style_mutations(&reverse_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(next, 2).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.semantic_input_spans.capacity(),
            semantic_input_capacity,
            "a populated retained update must reuse the paragraph-index capacity"
        );
        assert_eq!(
            planner
                .paragraphs
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x63]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x64]
        );
        assert_eq!(
            planner
                .paragraph(1)
                .unwrap()
                .state
                .styles
                .committed()
                .resolved
                .segments()[0]
                .style
                .material_id,
            11
        );
        assert_eq!(
            planner
                .paragraph(2)
                .unwrap()
                .state
                .styles
                .committed()
                .resolved
                .segments()[0]
                .style
                .material_id,
            12
        );
    }

    #[test]
    fn existing_paragraphs_accept_content_only_mutations_without_lifecycle_upserts() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();

        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let initial_text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61]), (2, 0, 0, &[0x62])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.text_mutations =
            parse_text_mutations(&initial_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let replacement = paragraph_text_mutation_bytes(&[(1, 0, 1, &[0x63]), (2, 0, 1, &[0x64])]);
        let mut next = update(1, 1, 1);
        next.limits.max_paragraphs = 2;
        next.text_mutations =
            parse_text_mutations(&replacement, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(next, 2).unwrap();
        engine.commit_update(prepared).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x63]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x64]
        );
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|paragraph| paragraph.id)
                .collect::<Vec<_>>(),
            [1, 2],
            "content-only mutations must not imply lifecycle reordering"
        );
    }

    #[test]
    fn retained_gather_tracks_multi_owner_empty_output_transitions() {
        let (mut engine, mut shaper) = shaped_outlined_engine("aa");
        let lifecycle = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
            (PARAGRAPH_MUTATION_UPSERT, 3, 2),
        ]);
        let text =
            paragraph_text_mutation_bytes(&[(2, 0, 0, &[0x62, 0x62]), (3, 0, 0, &[0x63, 0x63])]);
        let mut styles = paragraph_root_style_bytes(&[(2, 2), (3, 3)]);
        for index in 0..2 {
            write_u32(
                &mut styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                    + index * abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize
                    + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                2,
            );
        }
        let mut initial = update(1, 1, 1);
        initial.limits.max_paragraphs = 3;
        initial.limits.max_regions = 3;
        let template = root_geometry_bytes();
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let constraint_stride = abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        let region_offset = header + 3 * constraint_stride;
        let mut geometry = vec![0; region_offset + abi::ENGINE_REGION_RECORD_SIZE as usize];
        for id in 1..=3 {
            let offset = header + (id as usize - 1) * constraint_stride;
            geometry[offset..offset + constraint_stride]
                .copy_from_slice(&template[header..header + constraint_stride]);
            write_u32(
                &mut geometry,
                offset + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
                id,
            );
        }
        geometry[region_offset..].copy_from_slice(&template[header + constraint_stride..]);
        initial.geometry = parse_geometry(
            &geometry,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE,
            3,
            region_offset as u32,
            1,
            0,
            0,
            0,
            0,
            initial.limits,
        )
        .unwrap();
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.text_mutations =
            parse_text_mutations(&text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.style_mutations =
            parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, initial, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        assert_gather_matches_full(&mut engine);

        for (revision, records, style_records, expected_counts) in [
            (
                2,
                vec![(2, 0, 2, vec![]), (3, 0, 2, vec![0x64, 0x64, 0x64])],
                vec![(2, 2, 0), (3, 3, 3)],
                [2, 0, 3],
            ),
            (3, vec![(3, 0, 3, vec![])], vec![(3, 3, 0)], [2, 0, 0]),
            (
                4,
                vec![(2, 0, 0, vec![0x66, 0x66, 0x66]), (3, 0, 0, vec![0x67])],
                vec![(2, 2, 3), (3, 3, 1)],
                [2, 3, 1],
            ),
        ] {
            let records: Vec<_> = records
                .iter()
                .map(|(id, start, delete, units)| (*id, *start, *delete, units.as_slice()))
                .collect();
            let bytes = paragraph_text_mutation_bytes(&records);
            let mut request = update(revision, revision, revision);
            request.limits.max_paragraphs = 3;
            request.text_mutations = parse_text_mutations(
                &bytes,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                u32::try_from(records.len()).unwrap(),
            )
            .unwrap();
            let style_pairs: Vec<_> = style_records
                .iter()
                .map(|(id, material, _)| (*id, *material))
                .collect();
            let mut styles = paragraph_root_style_bytes(&style_pairs);
            for (index, (_, _, end)) in style_records.iter().enumerate() {
                write_u32(
                    &mut styles,
                    ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize
                        + index * abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize
                        + abi::ENGINE_STYLE_MUTATION_TEXT_END,
                    *end,
                );
            }
            request.style_mutations = parse_style_mutations(
                &styles,
                ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                u32::try_from(style_records.len()).unwrap(),
            )
            .unwrap();
            let prepared = engine
                .prepare_update_with_shaper(&mut shaper, request, revision + 1)
                .unwrap();
            engine.commit_update(prepared).unwrap();

            let planner = engine.planners.get(&4).unwrap();
            for (id, expected) in (1..=3).zip(expected_counts) {
                let paragraph = planner.paragraph(id).unwrap();
                assert_eq!(
                    paragraph.gather_range.unwrap().source_count(),
                    expected,
                    "paragraph {id} source range at revision {revision}"
                );
            }
            let expected_total: usize = expected_counts.into_iter().sum();
            assert_eq!(
                engine.gather.view().plan_input().glyphs.len(),
                expected_total
            );
            assert_gather_matches_full(&mut engine);
        }
    }

    #[test]
    fn invalid_later_paragraph_is_preflighted_before_any_child_or_lifecycle_commit() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let initial_text = paragraph_text_mutation_bytes(&[(1, 0, 0, &[0x61]), (2, 0, 0, &[0x62])]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        initial.text_mutations =
            parse_text_mutations(&initial_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let reorder_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 0),
        ]);
        let invalid_text = paragraph_text_mutation_bytes(&[(1, 0, 1, &[0x78]), (2, 9, 0, &[0x79])]);
        let revision = engine.root_revision(4).unwrap();
        let mut invalid = update(revision.engine, revision.root, 1);
        invalid.limits.max_paragraphs = 2;
        invalid.paragraph_mutations =
            parse_paragraph_mutations(&reorder_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        invalid.text_mutations =
            parse_text_mutations(&invalid_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        assert_eq!(
            engine.prepare_update(invalid, 2),
            Err(EngineError::InvalidRequest)
        );

        // The invalid range is rejected before preparation begins. No rollback is needed: the
        // accepted paragraph text and committed ordering were never changed.
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(planner.revision, RootRevision { engine: 1, root: 1 });
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            [0x62]
        );
        assert!(!planner.lifecycle_prepared);
    }

    #[test]
    fn late_grapheme_topology_failure_keeps_earlier_text_and_root_reusable() {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let mut shaper = ShaperRegistry::default();
        let extents = vec![0; 9_362 * 8];
        let availability = vec![0; 9_362_usize.div_ceil(8)];
        assert_eq!(
            shaper.register_font(1, FONT, &extents, &availability, 0, 0),
            0
        );
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine
            .register_font_binding(42, 1, 9_362, render_binding(9_362, 1))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();
        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let initial_text = paragraph_text_mutation_bytes(&[
            (1, 0, 0, &[0x61]),
            (2, 0, 0, &utf16("a\u{301}\u{300}bc")),
        ]);
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut initial_styles = root_style_bytes_for_text(7, 1);
        let mut paragraph_two_styles = override_style_bytes_for_text(7, 5, DIRECTION_RTL);
        write_u32(
            &mut paragraph_two_styles,
            header + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            2,
        );
        write_u32(
            &mut paragraph_two_styles,
            header + stride + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            2,
        );
        write_u32(
            &mut paragraph_two_styles,
            header + stride + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            0,
        );
        write_u32(
            &mut paragraph_two_styles,
            header + stride + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            3,
        );
        let mut second_child = paragraph_two_styles[header + stride..header + stride * 2].to_vec();
        write_u32(&mut second_child, abi::ENGINE_STYLE_MUTATION_STYLE_ID, 3);
        write_u32(
            &mut second_child,
            abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            2,
        );
        write_u32(&mut second_child, abi::ENGINE_STYLE_MUTATION_TEXT_START, 2);
        write_u32(&mut second_child, abi::ENGINE_STYLE_MUTATION_TEXT_END, 5);
        initial_styles.extend_from_slice(&paragraph_two_styles[header..]);
        initial_styles.extend_from_slice(&second_child);
        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.limits.max_clusters = 256;
        initial.limits.max_lines = 256;
        initial.limits.max_output_bytes = 1 << 20;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        initial.text_mutations =
            parse_text_mutations(&initial_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        initial.style_mutations =
            parse_style_mutations(&initial_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 4).unwrap();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        engine.commit_update(prepared).unwrap();

        let normalized_crossing = utf16("abc\u{301}d");
        let attempted_text =
            paragraph_text_mutation_bytes(&[(1, 0, 1, &[0x78]), (2, 0, 5, &normalized_crossing)]);
        let sibling_creation = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 3, 2)]);
        let revision = engine.root_revision(4).unwrap();
        let mut invalid = update(revision.engine, revision.root, 1);
        invalid.limits.max_paragraphs = 3;
        invalid.paragraph_mutations =
            parse_paragraph_mutations(&sibling_creation, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        invalid.text_mutations =
            parse_text_mutations(&attempted_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        invalid.style_mutations = super::super::semantic_wire::StyleMutationBatch::empty();
        let (planner_revision, accepted_ack) = {
            let planner = engine.planners.get(&4).unwrap();
            (
                planner.revision,
                planner.acknowledged_publication_generation,
            )
        };
        let rejection = engine
            .prepare_update_with_shaper(&mut shaper, invalid, 2)
            .unwrap_err();
        assert!(
            matches!(
                rejection,
                EngineError::StyleNestingInvalid(FrameFault {
                    paragraph_id: 2,
                    style_id: 3,
                })
            ),
            "unexpected rejection: {rejection:?}; revision={revision:?}, planner={:?}, consumed={}, ack={}, accepted_ack={}",
            planner_revision,
            invalid.consumed_revision,
            invalid.acknowledged_publication_generation,
            accepted_ack
        );

        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(planner.revision, revision);
        assert!(planner.paragraph(3).is_none());
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|item| (item.order, item.id))
                .collect::<Vec<_>>(),
            [(0, 1), (1, 2)]
        );
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x61]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            utf16("a\u{301}\u{300}bc")
        );
        assert!(!planner.lifecycle_prepared);

        write_u32(
            &mut paragraph_two_styles,
            header + stride + abi::ENGINE_STYLE_MUTATION_TEXT_START,
            0,
        );
        write_u32(
            &mut paragraph_two_styles,
            header + stride + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            1,
        );
        write_u32(&mut second_child, abi::ENGINE_STYLE_MUTATION_TEXT_START, 4);
        write_u32(&mut second_child, abi::ENGINE_STYLE_MUTATION_TEXT_END, 5);
        let mut recovered_styles = root_style_bytes_for_text(7, 1);
        recovered_styles.extend_from_slice(&paragraph_two_styles[header..]);
        recovered_styles.extend_from_slice(&second_child);
        invalid.style_mutations =
            parse_style_mutations(&recovered_styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 4).unwrap();
        invalid.paragraph_mutations = super::super::semantic_wire::ParagraphMutationBatch::empty();
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, invalid, 2)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.paragraph(1).unwrap().state.text.committed().units,
            [0x78]
        );
        assert_eq!(
            planner.paragraph(2).unwrap().state.text.committed().units,
            normalized_crossing
        );
    }

    #[test]
    fn paragraph_limits_unknown_semantics_and_order_collisions_are_atomic() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let lifecycle_bytes = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 0),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let mut too_many = update(0, 0, 0);
        too_many.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        assert_eq!(
            engine.prepare_update(too_many, 1),
            Err(EngineError::InvalidRequest)
        );
        assert!(engine.planners.get(&4).unwrap().paragraphs.is_empty());

        let mut initial = update(0, 0, 0);
        initial.limits.max_paragraphs = 2;
        initial.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let collision_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 1)]);
        let mut collision = update(1, 1, 1);
        collision.limits.max_paragraphs = 2;
        collision.paragraph_mutations =
            parse_paragraph_mutations(&collision_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        assert_eq!(
            engine.prepare_update(collision, 2),
            Err(EngineError::InvalidRequest)
        );

        let duplicate_base_order = paragraph_mutation_bytes(&[
            (PARAGRAPH_MUTATION_UPSERT, 1, 1),
            (PARAGRAPH_MUTATION_UPSERT, 2, 1),
        ]);
        let duplicate_rank = paragraph_order_mutation_bytes(&[(1, 7, 0.0), (2, 7, 0.0)]);
        let mut ambiguous = update(1, 1, 1);
        ambiguous.limits.max_paragraphs = 2;
        ambiguous.paragraph_mutations =
            parse_paragraph_mutations(&duplicate_base_order, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        ambiguous.paragraph_order_mutations =
            parse_paragraph_order_mutations(&duplicate_rank, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2)
                .unwrap();
        assert_eq!(
            engine.prepare_update(ambiguous, 2),
            Err(EngineError::InvalidRequest),
            "duplicate base order needs distinct explicit ranks within its scope"
        );

        let unknown_text = paragraph_text_mutation_bytes(&[(3, 0, 0, &[0x61])]);
        let mut unknown = update(1, 1, 1);
        unknown.limits.max_paragraphs = 2;
        unknown.text_mutations =
            parse_text_mutations(&unknown_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(unknown, 2),
            Err(EngineError::InvalidRequest)
        );
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
    }

    #[test]
    fn single_paragraph_planner_rejects_mixed_and_rebound_paragraph_ids() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();

        let mut mixed_bytes = text_mutation_bytes(&[(0, 0, &[0x61]), (1, 0, &[0x62])]);
        let second =
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        write_u32(
            &mut mixed_bytes,
            second + ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
            2,
        );
        let mixed =
            parse_text_mutations(&mixed_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut request = update(0, 0, 0);
        request.text_mutations = mixed;
        assert_eq!(
            engine.prepare_update(request, 1),
            Err(EngineError::InvalidRequest)
        );

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61])]);
        let mut initial = update(0, 0, 0);
        initial.text_mutations =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(initial, 1).unwrap();
        engine.commit_update(prepared).unwrap();

        let mut rebound_bytes = text_mutation_bytes(&[(1, 0, &[0x62])]);
        write_u32(
            &mut rebound_bytes,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
            2,
        );
        let mut rebound = update(1, 1, 1);
        rebound.text_mutations =
            parse_text_mutations(&rebound_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(rebound, 2),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.root_text(4).unwrap(), &[0x61]);
    }

    #[test]
    fn a_committed_planner_retains_its_codec_registration() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let first = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(first).unwrap();

        assert_eq!(engine.dispose_codec(9), Err(EngineError::RegistrationInUse));
        engine.dispose_root(4).unwrap();
        engine.dispose_codec(9).unwrap();
        engine
            .register_codec(9, validated_codec(TechniqueId(2)))
            .unwrap();
    }

    fn utf16(value: &str) -> Vec<u16> {
        value.encode_utf16().collect()
    }

    fn assert_visible_shape_equal(warm: &ParagraphState, cold: &ParagraphState, context: &str) {
        let (warm_shape, cold_shape) = (warm.shape.committed(), cold.shape.committed());
        assert_eq!(
            warm_shape.glyph_ids, cold_shape.glyph_ids,
            "{context}: glyph IDs"
        );
        assert_eq!(
            warm_shape.clusters, cold_shape.clusters,
            "{context}: shape clusters"
        );
        assert_eq!(
            warm_shape.x_advances, cold_shape.x_advances,
            "{context}: x advances"
        );
        assert_eq!(
            warm_shape.y_advances, cold_shape.y_advances,
            "{context}: y advances"
        );
        assert_eq!(
            warm_shape.x_offsets, cold_shape.x_offsets,
            "{context}: x offsets"
        );
        assert_eq!(
            warm_shape.y_offsets, cold_shape.y_offsets,
            "{context}: y offsets"
        );
        assert_eq!(
            warm_shape.glyph_flags, cold_shape.glyph_flags,
            "{context}: glyph flags"
        );
        let (warm_clusters, cold_clusters) = (warm.clusters.committed(), cold.clusters.committed());
        assert_eq!(
            warm_clusters.starts, cold_clusters.starts,
            "{context}: starts"
        );
        assert_eq!(warm_clusters.ends, cold_clusters.ends, "{context}: ends");
        assert_eq!(
            warm_clusters.advances, cold_clusters.advances,
            "{context}: advances"
        );
        assert_eq!(
            warm_clusters.flags, cold_clusters.flags,
            "{context}: cluster flags"
        );
        assert_eq!(
            warm_clusters.source_runs, cold_clusters.source_runs,
            "{context}: source runs"
        );
        assert_eq!(
            warm_clusters.glyph_ids, cold_clusters.glyph_ids,
            "{context}: cluster glyph IDs"
        );
        assert_eq!(
            warm_clusters.glyph_clusters, cold_clusters.glyph_clusters,
            "{context}: glyph clusters"
        );
        assert_eq!(
            warm_clusters.glyph_x_advances, cold_clusters.glyph_x_advances,
            "{context}: cluster x advances"
        );
        assert_eq!(
            warm_clusters.glyph_shape_flags, cold_clusters.glyph_shape_flags,
            "{context}: cluster shape flags"
        );
        let (warm_flow, cold_flow) = (warm.flow_layout.committed(), cold.flow_layout.committed());
        assert_eq!(warm_flow.lines, cold_flow.lines, "{context}: flow lines");
        assert_eq!(
            warm_flow.fragments, cold_flow.fragments,
            "{context}: flow fragments"
        );
        assert_eq!(
            warm_flow.drop_caps, cold_flow.drop_caps,
            "{context}: flow drop caps"
        );
        let warm_glyphs = warm.positioned.committed().glyphs();
        let cold_glyphs = cold.positioned.committed().glyphs();
        assert_eq!(
            warm_glyphs.len(),
            cold_glyphs.len(),
            "{context}: glyph count"
        );
        for (warm_glyph, cold_glyph) in warm_glyphs.iter().zip(cold_glyphs) {
            let (mut warm_glyph, mut cold_glyph) = (*warm_glyph, *cold_glyph);
            warm_glyph.stable_id = 0;
            warm_glyph.content_revision = 0;
            warm_glyph.placement_slot = 0;
            cold_glyph.stable_id = 0;
            cold_glyph.content_revision = 0;
            cold_glyph.placement_slot = 0;
            assert_eq!(warm_glyph, cold_glyph, "{context}: positioned glyph");
        }
    }

    fn assert_local_length_edits_match_cold(
        engine: &mut TextEngine,
        shaper: &mut ShaperRegistry,
        original: &str,
        first_revision: u32,
        styles_for_text: fn(u32) -> (Vec<u8>, u32),
        cold_engine: fn(&str) -> (TextEngine, ShaperRegistry),
    ) {
        let grown = original.replacen("charlie", "charliex", 1);
        for (index, value) in [grown.as_str(), original].into_iter().enumerate() {
            let revision = first_revision + index as u32;
            let previous_len = engine
                .planners
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text
                .committed()
                .units
                .len();
            let units = utf16(value);
            let bytes = text_mutation_bytes(&[(0, previous_len as u32, units.as_slice())]);
            let (styles, style_count) = styles_for_text(units.len() as u32);
            let mut edit = update(revision, revision, revision);
            edit.limits.max_clusters = 256;
            edit.limits.max_lines = 256;
            edit.limits.max_output_bytes = 1 << 20;
            edit.text_mutations =
                parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            edit.style_mutations =
                parse_style_mutations(&styles, ENGINE_UPDATE_REQUEST_HEADER_SIZE, style_count)
                    .unwrap();
            let prepared = engine
                .prepare_update_with_shaper(shaper, edit, revision + 1)
                .unwrap();
            engine.commit_update(prepared).unwrap();
            let (cold, _) = cold_engine(value);
            assert_visible_shape_equal(
                engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                cold.planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap(),
                "retained insertion/deletion",
            );
        }
    }

    #[test]
    fn borrowed_glyph_ranges_fill_only_valid_requested_records() {
        let text = "x".repeat(65);
        let styles = root_style_bytes_for_text(7, 65);
        let mut geometry = root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_f32(
            &mut geometry,
            constraint + abi::ENGINE_CONSTRAINT_WIDTH,
            2_000.0,
        );
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
        ] {
            write_f32(&mut geometry, region + field, 2_000.0);
        }
        let (engine, _) = shaped_outlined_engine_with_styles_geometry(&text, &styles, &geometry);
        assert_eq!(engine.borrowed_paragraph_layout(4, 1).unwrap(), 65);
        let mut records = [super::super::positioning::SemanticGlyph::default(); 32];
        for (start, count) in [(0, 1), (0, 31), (0, 32), (31, 32), (32, 32), (64, 1)] {
            engine
                .borrowed_paragraph_glyphs(4, 1, start, &mut records[..count])
                .unwrap();
            for (offset, glyph) in records[..count].iter().enumerate() {
                assert_eq!(glyph.cluster as usize, start + offset);
            }
        }
        let before = records;
        for start in [65, usize::MAX] {
            assert_eq!(
                engine.borrowed_paragraph_glyphs(4, 1, start, &mut records[..1]),
                Err(EngineError::InvalidRequest)
            );
            assert_eq!(records, before, "invalid ranges must not write scratch");
        }
        assert_eq!(
            engine.borrowed_paragraph_glyphs(4, 1, 64, &mut records[..2]),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(records, before);
    }

    fn shaped_engine(text: &str) -> (TextEngine, ShaperRegistry) {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        shaped_engine_with_font(text, FONT, 9_362)
    }

    fn shaped_inter_engine(text: &str) -> (TextEngine, ShaperRegistry) {
        const FONT: &[u8] =
            include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
        shaped_engine_with_font(text, FONT, 2_937)
    }

    fn shaped_rtl_engine(text: &str) -> (TextEngine, ShaperRegistry) {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        let styles = override_style_bytes_for_text(
            7,
            u32::try_from(text.encode_utf16().count()).unwrap(),
            DIRECTION_RTL,
        );
        shaped_engine_with_font_and_styles(text, FONT, 9_362, &styles, 2)
    }

    fn shaped_engine_with_font(
        text: &str,
        font: &[u8],
        glyph_count: u32,
    ) -> (TextEngine, ShaperRegistry) {
        let styles = root_style_bytes_for_text(7, text.encode_utf16().count() as u32);
        shaped_engine_with_font_and_styles(text, font, glyph_count, &styles, 1)
    }

    fn shaped_engine_with_font_and_styles(
        text: &str,
        font: &[u8],
        glyph_count: u32,
        style_bytes: &[u8],
        style_count: u32,
    ) -> (TextEngine, ShaperRegistry) {
        shaped_engine_with_font_styles_and_geometry(
            text,
            font,
            glyph_count,
            style_bytes,
            style_count,
            None,
        )
    }

    fn shaped_engine_with_font_styles_and_geometry(
        text: &str,
        font: &[u8],
        glyph_count: u32,
        style_bytes: &[u8],
        style_count: u32,
        geometry: Option<(&[u8], u32)>,
    ) -> (TextEngine, ShaperRegistry) {
        shaped_engine_with_font_styles_geometry_and_extents(
            text,
            font,
            glyph_count,
            style_bytes,
            style_count,
            geometry,
            false,
        )
    }

    fn shaped_outlined_engine(text: &str) -> (TextEngine, ShaperRegistry) {
        shaped_outlined_engine_with_draw_transform(text, true)
    }

    fn shaped_outlined_engine_with_styles_geometry(
        text: &str,
        styles: &[u8],
        geometry: &[u8],
    ) -> (TextEngine, ShaperRegistry) {
        shaped_outlined_engine_with_styles_geometry_and_draw_transform(text, styles, geometry, true)
    }

    fn shaped_engine_with_font_styles_geometry_and_extents(
        text: &str,
        font: &[u8],
        glyph_count: u32,
        style_bytes: &[u8],
        style_count: u32,
        geometry: Option<(&[u8], u32)>,
        outlined: bool,
    ) -> (TextEngine, ShaperRegistry) {
        shaped_engine_with_font_styles_geometry_extents_and_draw_transform(
            text,
            font,
            glyph_count,
            style_bytes,
            style_count,
            geometry,
            outlined,
            true,
        )
    }

    fn shaped_outlined_engine_with_draw_transform(
        text: &str,
        split_transform: bool,
    ) -> (TextEngine, ShaperRegistry) {
        let styles = root_style_bytes_for_text(7, text.encode_utf16().count() as u32);
        shaped_outlined_engine_with_styles_geometry_and_draw_transform(
            text,
            &styles,
            &root_geometry_bytes(),
            split_transform,
        )
    }

    fn shaped_outlined_engine_with_styles_geometry_and_draw_transform(
        text: &str,
        styles: &[u8],
        geometry: &[u8],
        split_transform: bool,
    ) -> (TextEngine, ShaperRegistry) {
        const FONT: &[u8] = include_bytes!(
            "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
        );
        shaped_engine_with_font_styles_geometry_extents_and_draw_transform(
            text,
            FONT,
            9_362,
            styles,
            1,
            Some((geometry, 0)),
            true,
            split_transform,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn shaped_engine_with_font_styles_geometry_extents_and_draw_transform(
        text: &str,
        font: &[u8],
        glyph_count: u32,
        style_bytes: &[u8],
        style_count: u32,
        geometry: Option<(&[u8], u32)>,
        outlined: bool,
        split_transform: bool,
    ) -> (TextEngine, ShaperRegistry) {
        let mut shaper = ShaperRegistry::default();
        let mut extents = vec![0; glyph_count as usize * 8];
        let mut availability = vec![0; (glyph_count as usize).div_ceil(8)];
        if outlined {
            // Controlled registration data for the authentic shaping font, not baked goldens:
            // every valid nonmissing glyph ID has a small rectangle and an available resource.
            for glyph in 1..glyph_count as usize {
                availability[glyph >> 3] |= 1 << (glyph & 7);
                extents[glyph * 8 + 4..glyph * 8 + 6].copy_from_slice(&500_i16.to_le_bytes());
                extents[glyph * 8 + 6..glyph * 8 + 8].copy_from_slice(&1_000_i16.to_le_bytes());
            }
        }
        assert_eq!(
            shaper.register_font(1, font, &extents, &availability, 0, 0),
            0
        );
        let mut engine = TextEngine::default();
        let mut codec = validated_codec(TechniqueId(1));
        if outlined {
            // Preserve the existing program while admitting the broad root in one buffer.
            let mut capability_sets = codec.capability_sets().to_vec();
            for capabilities in &mut capability_sets {
                capabilities.max_buffer_bytes = 1 << 20;
            }
            codec = ValidatedCodec::new(CodecDescriptor {
                capability_sets,
                programs: codec.programs().to_vec(),
            })
            .unwrap();
        }
        if !split_transform {
            let capability_sets = codec.capability_sets().to_vec();
            let mut programs = codec.programs().to_vec();
            for program in &mut programs {
                program.draw_key_mask &= !crate::engine::codec::BATCH_TRANSFORM;
            }
            codec = ValidatedCodec::new(CodecDescriptor {
                capability_sets,
                programs,
            })
            .unwrap();
        }
        engine.register_codec(9, codec).unwrap();
        engine
            .register_font_binding(42, 1, glyph_count, render_binding(glyph_count, 1))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_root(4).unwrap();
        engine
            .reserve_root_text(4, u32::try_from(text.encode_utf16().count()).unwrap())
            .unwrap();

        let units = utf16(text);
        let text_bytes = text_mutation_bytes(&[(0, 0, &units)]);
        let mut initial = update(0, 0, 0);
        initial.limits.max_clusters = u32::try_from(units.len()).unwrap().max(256);
        initial.limits.max_lines = u32::try_from(units.len()).unwrap().max(256);
        initial.limits.max_output_bytes = 1 << 20;
        if geometry.is_some_and(|(_, exclusion_count)| exclusion_count != 0) {
            initial.limits.max_slots_per_band = 4;
        }
        initial.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        initial.style_mutations =
            parse_style_mutations(style_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, style_count)
                .unwrap();
        if let Some((geometry_bytes, exclusion_count)) = geometry {
            initial.geometry = parse_root_geometry_with_exclusions(
                geometry_bytes,
                exclusion_count,
                initial.limits,
            );
        }
        let prepared = engine
            .prepare_update_with_shaper(&mut shaper, initial, 1)
            .unwrap();
        engine.commit_update(prepared).unwrap();
        (engine, shaper)
    }

    fn validated_codec(technique: TechniqueId) -> ValidatedCodec {
        validated_codec_with_input(technique, 0)
    }

    fn validated_paint_codec(technique: TechniqueId) -> ValidatedCodec {
        // The paint fixture changes blue while preserving red and green.
        validated_codec_with_input(technique, super::super::frame::SEMANTIC_F32_FOREGROUND_BLUE)
    }

    fn validated_codec_with_input(technique: TechniqueId, semantic_field: u8) -> ValidatedCodec {
        ValidatedCodec::new(CodecDescriptor {
            capability_sets: vec![
                CapabilitySet {
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
                },
                CapabilitySet {
                    id: CapabilitySetId(2),
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
                },
            ],
            programs: vec![ProgramDescriptor {
                primitive_kind: 1,
                technique,
                variant: 0,
                id: ProgramId(1),
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
                inputs: vec![crate::engine::codec::InputSource::semantic(semantic_field)],
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

    fn render_binding(glyph_count: u32, technique: u32) -> FontRenderBinding {
        FontRenderBinding::new(
            TechniqueId(technique),
            0,
            glyph_count,
            vec![FontStrike { ppem: 0 }],
            vec![FontResource {
                id: 1,
                generation: 1,
                kind: 1,
                reference: 0,
            }],
            (0..glyph_count)
                .map(|glyph| {
                    if glyph == 0 {
                        MISSING_RESOURCE_INDEX
                    } else {
                        0
                    }
                })
                .collect(),
            FieldTable::new(glyph_count, 0, vec![]).unwrap(),
            FieldTable::new(glyph_count, 0, vec![]).unwrap(),
            FieldTable::new(glyph_count, 0, vec![]).unwrap(),
            FieldTable::new(glyph_count, 0, vec![]).unwrap(),
            FieldTable::new(1, 0, vec![]).unwrap(),
            FieldTable::new(1, 0, vec![]).unwrap(),
        )
        .unwrap()
    }

    fn update(
        expected_engine_revision: u32,
        consumed_revision: u32,
        acknowledged_publication_generation: u32,
    ) -> UpdateRequest<'static> {
        UpdateRequest {
            root_id: 4,
            expected_engine_revision,
            consumed_revision,
            acknowledged_publication_generation,
            codec_handle: 9,
            capability_set: 1,
            semantic_view_mask: 0,
            compositing_independent: false,
            limits: super::super::frame::UpdateLimits {
                max_paragraphs: 1,
                max_clusters: 1,
                max_lines: 1,
                max_regions: 1,
                max_exclusions: 1,
                max_inline_objects: 1,
                max_slots_per_band: 1,
                max_output_bytes: 128,
            },
            paragraph_mutations: super::super::semantic_wire::ParagraphMutationBatch::empty(),
            paragraph_order_mutations:
                super::super::semantic_wire::ParagraphOrderMutationBatch::empty(),
            text_mutations: super::super::semantic_wire::TextMutationBatch::empty(),
            style_mutations: super::super::semantic_wire::StyleMutationBatch::empty(),
            geometry: super::super::semantic_wire::GeometryBatch::empty(),
        }
    }

    fn root_style_bytes(font_stack_handle: u32) -> Vec<u8> {
        root_style_bytes_inner(font_stack_handle, None)
    }

    fn root_style_bytes_for_text(font_stack_handle: u32, text_end: u32) -> Vec<u8> {
        let mut bytes = root_style_bytes(font_stack_handle);
        write_u32(
            &mut bytes,
            ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            text_end,
        );
        bytes
    }

    fn decorated_root_style_bytes_for_text(font_stack_handle: u32, text_end: u32) -> Vec<u8> {
        let mut bytes = root_style_bytes_for_text(font_stack_handle, text_end);
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO
                | STYLE_FIELD_DECORATION,
        );
        bytes[record + abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE] = DECORATION_SOLID;
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
            DECORATION_UNDERLINE,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA,
            u32::MAX,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS,
            1.0,
        );
        bytes
    }

    fn root_style_bytes_with_direction(font_stack_handle: u32, direction: u8) -> Vec<u8> {
        root_style_bytes_inner(font_stack_handle, Some(direction))
    }

    fn override_style_bytes_for_text(
        font_stack_handle: u32,
        text_end: u32,
        direction: u8,
    ) -> Vec<u8> {
        let root = root_style_bytes_for_text(font_stack_handle, text_end);
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let record_size = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; header + record_size * 2];
        bytes[header..header + record_size].copy_from_slice(&root[header..]);
        let record = header + record_size;
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 2);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_DIRECTION,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_TEXT_END,
            text_end,
        );
        bytes[record + abi::ENGINE_STYLE_MUTATION_DIRECTION] = direction;
        bytes
    }

    fn root_style_bytes_inner(font_stack_handle: u32, direction: Option<u8>) -> Vec<u8> {
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut bytes = vec![0; record + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize];
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        bytes[record + abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 1);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO
                | direction.map_or(0, |_| STYLE_FIELD_DIRECTION),
        );
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_TEXT_END, 4);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
            font_stack_handle,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
            16.0,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT,
            1.2,
        );
        write_f32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
            1.0,
        );
        if let Some(direction) = direction {
            bytes[record + abi::ENGINE_STYLE_MUTATION_DIRECTION] = direction;
        }
        bytes
    }

    fn write_f32(bytes: &mut [u8], offset: usize, value: f32) {
        write_u32(bytes, offset, value.to_bits());
    }

    fn remove_style_bytes(style_id: u32) -> Vec<u8> {
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut bytes = vec![0; record + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize];
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_REMOVE;
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_STYLE_ID,
            style_id,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
            1,
        );
        bytes
    }

    fn paragraph_mutation_bytes(records: &[(u8, u32, u32)]) -> Vec<u8> {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut bytes =
            vec![
                0;
                record_offset + records.len() * abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize
            ];
        for (index, &(opcode, paragraph_id, order)) in records.iter().enumerate() {
            let start = record_offset + index * abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize;
            let record =
                &mut bytes[start..start + abi::ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE as usize];
            record[abi::ENGINE_PARAGRAPH_MUTATION_OPCODE] = opcode;
            write_u32(
                record,
                abi::ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
                paragraph_id,
            );
            write_u32(record, abi::ENGINE_PARAGRAPH_MUTATION_ORDER, order);
        }
        bytes
    }

    fn paragraph_order_mutation_bytes(records: &[(u32, u32, f64)]) -> Vec<u8> {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut bytes = vec![
            0;
            record_offset
                + records.len()
                    * abi::ENGINE_PARAGRAPH_ORDER_MUTATION_RECORD_SIZE as usize
        ];
        for (index, &(paragraph_id, scope, rank)) in records.iter().enumerate() {
            let start =
                record_offset + index * abi::ENGINE_PARAGRAPH_ORDER_MUTATION_RECORD_SIZE as usize;
            let record = &mut bytes
                [start..start + abi::ENGINE_PARAGRAPH_ORDER_MUTATION_RECORD_SIZE as usize];
            write_u32(
                record,
                abi::ENGINE_PARAGRAPH_ORDER_MUTATION_PARAGRAPH_ID,
                paragraph_id,
            );
            write_u32(
                record,
                abi::ENGINE_PARAGRAPH_ORDER_MUTATION_ORDER_SCOPE,
                scope,
            );
            record[abi::ENGINE_PARAGRAPH_ORDER_MUTATION_ORDER_RANK
                ..abi::ENGINE_PARAGRAPH_ORDER_MUTATION_ORDER_RANK + 8]
                .copy_from_slice(&rank.to_le_bytes());
        }
        bytes
    }

    fn paragraph_text_mutation_bytes(records: &[(u32, u32, u32, &[u16])]) -> Vec<u8> {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let records_length = records.len() * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let payload_length = records
            .iter()
            .map(|(_, _, _, insert)| insert.len() * 2)
            .sum::<usize>();
        let mut bytes = vec![0; record_offset + records_length + payload_length];
        let mut payload_offset = record_offset + records_length;
        for (index, &(paragraph_id, text_start, delete_count, insert)) in records.iter().enumerate()
        {
            let start = record_offset + index * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
            let record = &mut bytes[start..start + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize];
            record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
            record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
            write_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID, paragraph_id);
            write_u32(record, ENGINE_TEXT_MUTATION_TEXT_START, text_start);
            write_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT, delete_count);
            if !insert.is_empty() {
                write_u32(
                    record,
                    ENGINE_TEXT_MUTATION_INSERT_OFFSET,
                    u32::try_from(payload_offset).unwrap(),
                );
                write_u32(
                    record,
                    ENGINE_TEXT_MUTATION_INSERT_COUNT,
                    u32::try_from(insert.len()).unwrap(),
                );
                for &unit in insert {
                    bytes[payload_offset..payload_offset + 2].copy_from_slice(&unit.to_le_bytes());
                    payload_offset += 2;
                }
            }
        }
        bytes
    }

    fn paragraph_root_style_bytes(records: &[(u32, u32)]) -> Vec<u8> {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; record_offset + records.len() * stride];
        for (index, &(paragraph_id, material_id)) in records.iter().enumerate() {
            let start = record_offset + index * stride;
            let record = &mut bytes[start..start + stride];
            record[abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
            record[abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
            write_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID, 1);
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
                paragraph_id,
            );
            write_u32(
                record,
                abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
                STYLE_FIELD_FONT_STACK
                    | STYLE_FIELD_MATERIAL
                    | STYLE_FIELD_FONT_SIZE
                    | STYLE_FIELD_LINE_HEIGHT
                    | STYLE_FIELD_RASTER_PIXEL_RATIO,
            );
            write_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_END, 1);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE, 7);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_MATERIAL_ID, material_id);
            write_f32(record, abi::ENGINE_STYLE_MUTATION_FONT_SIZE, 16.0);
            write_f32(record, abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT, 1.2);
            write_f32(record, abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO, 1.0);
        }
        bytes
    }

    fn paragraph_root_style_with_foreground(foreground_rgba: u32) -> Vec<u8> {
        let mut bytes = paragraph_root_style_bytes(&[(1, 1)]);
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_MATERIAL
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO
                | STYLE_FIELD_FOREGROUND,
        );
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
            foreground_rgba,
        );
        bytes
    }

    fn root_geometry_bytes() -> Vec<u8> {
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        let mut bytes = vec![0; region + abi::ENGINE_REGION_RECORD_SIZE as usize];
        write_u32(
            &mut bytes,
            constraint + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
            1,
        );
        write_u32(
            &mut bytes,
            constraint + abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID,
            1,
        );
        for field in [
            abi::ENGINE_CONSTRAINT_WIDTH,
            abi::ENGINE_CONSTRAINT_HEIGHT,
            abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
        ] {
            write_f32(&mut bytes, constraint + field, 100.0);
        }
        write_u32(&mut bytes, constraint + abi::ENGINE_CONSTRAINT_MAX_LINES, 1);
        bytes[constraint + abi::ENGINE_CONSTRAINT_REGION_COUNT
            ..constraint + abi::ENGINE_CONSTRAINT_REGION_COUNT + 2]
            .copy_from_slice(&1_u16.to_le_bytes());
        bytes[constraint + abi::ENGINE_CONSTRAINT_WIDTH_MODE] = AXIS_EXACT;
        bytes[constraint + abi::ENGINE_CONSTRAINT_HEIGHT_MODE] = AXIS_EXACT;
        bytes[constraint + abi::ENGINE_CONSTRAINT_WRAP] = WRAP_WORD;
        bytes[constraint + abi::ENGINE_CONSTRAINT_ALIGN] = ALIGN_START;
        bytes[constraint + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_CLIP;
        bytes[constraint + abi::ENGINE_CONSTRAINT_BLOCK_ALIGN] = BLOCK_ALIGN_START;
        bytes[constraint + abi::ENGINE_CONSTRAINT_LAST_LINE] = LAST_LINE_AUTO;

        write_u32(&mut bytes, region + abi::ENGINE_REGION_ID, 1);
        write_u32(&mut bytes, region + abi::ENGINE_REGION_GEOMETRY_REVISION, 1);
        write_u32(&mut bytes, region + abi::ENGINE_REGION_TRANSFORM_INDEX, 1);
        bytes[region + abi::ENGINE_REGION_SHAPE] = SHAPE_RECTANGLE;
        bytes[region + abi::ENGINE_REGION_WRITING_MODE] = WRITING_HORIZONTAL_TB;
        bytes[region + abi::ENGINE_REGION_TEXT_ORIENTATION] = ORIENTATION_MIXED;
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut bytes, region + field, 100.0);
        }
        bytes
    }

    fn geometry_with_constraint_owners(owners: &[u32]) -> Vec<u8> {
        let template = root_geometry_bytes();
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let constraint_stride = abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        let region_stride = abi::ENGINE_REGION_RECORD_SIZE as usize;
        let region_template = header + constraint_stride;
        let regions_offset = header + owners.len() * constraint_stride;
        let mut bytes = vec![0; regions_offset + region_stride];
        for (index, &owner) in owners.iter().enumerate() {
            let start = header + index * constraint_stride;
            bytes[start..start + constraint_stride]
                .copy_from_slice(&template[header..header + constraint_stride]);
            write_u32(
                &mut bytes,
                start + abi::ENGINE_CONSTRAINT_PARAGRAPH_ID,
                owner,
            );
        }
        bytes[regions_offset..regions_offset + region_stride]
            .copy_from_slice(&template[region_template..region_template + region_stride]);
        bytes
    }

    fn geometry_with_inline_object_owners(owners: &[u32]) -> Vec<u8> {
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let stride = abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize;
        let mut bytes = vec![0; header + owners.len() * stride];
        for (index, &owner) in owners.iter().enumerate() {
            let start = header + index * stride;
            write_u32(
                &mut bytes,
                start + abi::ENGINE_INLINE_OBJECT_PARAGRAPH_ID,
                owner,
            );
            bytes[start + abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT] = 1;
        }
        bytes
    }

    fn parse_test_geometry(
        bytes: &[u8],
        constraint_count: u32,
        inline_object_count: u32,
        limits: super::super::frame::UpdateLimits,
    ) -> super::super::semantic_wire::GeometryBatch<'_> {
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let constraints_length = constraint_count * abi::ENGINE_CONSTRAINT_RECORD_SIZE;
        let regions_offset = if constraint_count == 0 {
            0
        } else {
            header + constraints_length
        };
        let inline_objects_offset = if inline_object_count == 0 {
            0
        } else {
            header + constraints_length
        };
        parse_geometry(
            bytes,
            if constraint_count == 0 { 0 } else { header },
            constraint_count,
            regions_offset,
            u32::from(constraint_count != 0),
            0,
            0,
            inline_objects_offset,
            inline_object_count,
            limits,
        )
        .unwrap()
    }

    fn multiline_root_geometry_bytes() -> Vec<u8> {
        let mut bytes = root_geometry_bytes();
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        write_u32(&mut bytes, constraint + abi::ENGINE_CONSTRAINT_MAX_LINES, 0);
        for field in [
            abi::ENGINE_CONSTRAINT_HEIGHT,
            abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
        ] {
            write_f32(&mut bytes, constraint + field, 20_000.0);
        }
        for field in [
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut bytes, region + field, 20_000.0);
        }
        bytes
    }

    fn drop_cap_exclusion_geometry_bytes(block_start: f32, revision: u32) -> Vec<u8> {
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
        let exclusion = region + abi::ENGINE_REGION_RECORD_SIZE as usize;
        let mut bytes = root_geometry_bytes();
        bytes.resize(exclusion + abi::ENGINE_EXCLUSION_RECORD_SIZE as usize, 0);
        for field in [
            abi::ENGINE_CONSTRAINT_HEIGHT,
            abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
        ] {
            write_f32(&mut bytes, constraint + field, 2_000.0);
        }
        write_u32(
            &mut bytes,
            constraint + abi::ENGINE_CONSTRAINT_MAX_LINES,
            256,
        );
        bytes[constraint + abi::ENGINE_CONSTRAINT_DROP_CAP_LINES] = 3;
        bytes[constraint + abi::ENGINE_CONSTRAINT_DROP_CAP_ALIGNMENT] = DROP_CAP_ALIGN_BASELINE;
        bytes[constraint + abi::ENGINE_CONSTRAINT_DROP_CAP_SIDE] = DROP_CAP_SIDE_INLINE_START;
        bytes[region + abi::ENGINE_REGION_EXCLUSION_COUNT
            ..region + abi::ENGINE_REGION_EXCLUSION_COUNT + 2]
            .copy_from_slice(&1_u16.to_le_bytes());
        for field in [
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut bytes, region + field, 2_000.0);
        }

        write_u32(&mut bytes, exclusion + abi::ENGINE_EXCLUSION_ID, 2);
        write_u32(&mut bytes, exclusion + abi::ENGINE_EXCLUSION_REGION_ID, 1);
        write_u32(
            &mut bytes,
            exclusion + abi::ENGINE_EXCLUSION_GEOMETRY_REVISION,
            revision,
        );
        bytes[exclusion + abi::ENGINE_EXCLUSION_SHAPE] = SHAPE_RECTANGLE;
        bytes[exclusion + abi::ENGINE_EXCLUSION_WRAP_SIDE] = EXCLUSION_WRAP_BOTH;
        write_f32(
            &mut bytes,
            exclusion + abi::ENGINE_EXCLUSION_INLINE_START,
            20.0,
        );
        write_f32(
            &mut bytes,
            exclusion + abi::ENGINE_EXCLUSION_INLINE_END,
            60.0,
        );
        write_f32(
            &mut bytes,
            exclusion + abi::ENGINE_EXCLUSION_BLOCK_START,
            block_start,
        );
        write_f32(
            &mut bytes,
            exclusion + abi::ENGINE_EXCLUSION_BLOCK_END,
            block_start + 40.0,
        );
        bytes
    }

    fn parse_root_geometry(
        bytes: &[u8],
        limits: super::super::frame::UpdateLimits,
    ) -> super::super::semantic_wire::GeometryBatch<'_> {
        parse_root_geometry_with_exclusions(bytes, 0, limits)
    }

    fn parse_root_geometry_with_exclusions(
        bytes: &[u8],
        exclusion_count: u32,
        limits: super::super::frame::UpdateLimits,
    ) -> super::super::semantic_wire::GeometryBatch<'_> {
        let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE;
        let exclusions = if exclusion_count == 0 {
            0
        } else {
            region + abi::ENGINE_REGION_RECORD_SIZE
        };
        parse_geometry(
            bytes,
            constraint,
            1,
            region,
            1,
            exclusions,
            exclusion_count,
            0,
            0,
            limits,
        )
        .unwrap()
    }

    fn test_preflight_candidate(
        committed: &[u16],
        mutations: super::super::semantic_wire::TextMutationBatch<'_>,
    ) -> (PreflightTextCandidate, Vec<TextEdit>) {
        let mut candidate = PreflightTextCandidate::default();
        candidate.text.extend_from_slice(committed);
        for index in 0..mutations.len() {
            apply_text_mutation(
                &mut candidate.text,
                mutations.get(index).expect("test mutation exists"),
            )
            .expect("test mutation applies");
        }
        let mut edits = Vec::new();
        if let Some(reconciliation) = text_reconciliation(mutations, committed.len()) {
            collect_text_edits(committed, &candidate.text, reconciliation, &mut edits, 0).unwrap();
        }
        candidate.edit_end = edits.len();
        candidate.unicode.analyze(&candidate.text).unwrap();
        candidate.unicode_state = CandidateUnicode::Prepared;
        (candidate, edits)
    }

    fn text_mutation_bytes(records: &[(u32, u32, &[u16])]) -> Vec<u8> {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let records_length = records.len() * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let payload_length = records
            .iter()
            .map(|(_, _, insert)| insert.len() * 2)
            .sum::<usize>();
        let mut bytes = vec![0; record_offset + records_length + payload_length];
        let mut payload_offset = record_offset + records_length;
        for (index, &(text_start, delete_count, insert)) in records.iter().enumerate() {
            let start = record_offset + index * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
            let end = start + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
            let record = &mut bytes[start..end];
            record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
            record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
            write_u32(record, ENGINE_TEXT_MUTATION_PARAGRAPH_ID, 1);
            write_u32(record, ENGINE_TEXT_MUTATION_TEXT_START, text_start);
            write_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT, delete_count);
            if !insert.is_empty() {
                write_u32(
                    record,
                    ENGINE_TEXT_MUTATION_INSERT_OFFSET,
                    u32::try_from(payload_offset).unwrap(),
                );
                write_u32(
                    record,
                    ENGINE_TEXT_MUTATION_INSERT_COUNT,
                    u32::try_from(insert.len()).unwrap(),
                );
                for &unit in insert {
                    bytes[payload_offset..payload_offset + 2].copy_from_slice(&unit.to_le_bytes());
                    payload_offset += 2;
                }
            }
        }
        bytes
    }
}
