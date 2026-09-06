use alloc::{collections::BTreeMap, vec::Vec};

use crate::{
    STATUS_RESULT_TOO_LARGE, ShapeRangeRef, ShapeRunRef, ShaperRegistry,
    bidi::{BidiAnalysis, BidiError, DIRECTION_AUTO, analyze_into as analyze_bidi_into},
    unicode::{UnicodeAnalysis, UnicodeError},
};

use super::{
    cluster_state::{ClusterArena, ClusterBuildInput},
    codec::{ALLOCATION_ORDERED_DIRECT, CapabilitySetId, ValidatedCodec},
    codec_gather::{
        CodecGatherWorkspace, DEFAULT_GATHER_RECORD_CAPACITY, GatherError, LayoutPlanInput,
        RetainedGather,
    },
    flow_composition::{EllipsisReplacement, FlowLayoutArena},
    flow_geometry::FlowGeometryArena,
    font_binding::FontRenderBinding,
    frame::{
        CommittedUpdate, MeasuredParagraph, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
        PreparedUpdate, RootRevision, UpdateRequest,
    },
    identity_index::IdentityIndex,
    positioning::{PositionedGlyphArena, SEMANTIC_F32_FIELD_COUNT, SEMANTIC_U32_FIELD_COUNT},
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapeArena, ShapingRun, ShapingRunArena},
    sort,
    staged::{Staged, StyleStage, TextStage},
    style_state::{
        DEFAULT_STYLE_CAPACITY, MutationKey, ResolutionScope, StyleArena, StyleInvalidation,
    },
};

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
    gather: CodecGatherWorkspace,
    gather_cache: Option<GatherCacheKey>,
    prepared_gather_cache: Option<GatherCacheKey>,
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
    new_end: usize,
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

/// One retained speculative measure transaction. It extends across sequential
/// paragraph queries while the committed revision and lifecycle input still match,
/// reserving identities linearly from its high-water marks; any ordinary frame drops
/// it leave-committed before preparing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SpeculativeTransaction {
    revision: RootRevision,
    /// Increments whenever a queried paragraph's semantic prefix (text/style) or the
    /// lifecycle input rebuilds cold; geometry-only extension keeps the generation.
    generation: u32,
    lifecycle_fingerprint: u64,
    next_glyph_id: u32,
    next_content_revision: u32,
}

#[derive(Default)]
struct PlannerState {
    revision: RootRevision,
    acknowledged_publication_generation: u32,
    codec_binding: Option<CodecBinding>,
    speculative: Option<SpeculativeTransaction>,
    plan: RenderPlanCompiler,
    semantic_records: Vec<super::semantic_view::SemanticRecord>,
    next_glyph_id: u32,
    pending_next_glyph_id: u32,
    next_content_revision: u32,
    pending_next_content_revision: u32,
    spare_paragraph: Option<ParagraphState>,
    paragraphs: Vec<RetainedParagraph>,
    ordered_paragraphs: Vec<ParagraphOrder>,
    pending_ordered_paragraphs: Vec<ParagraphOrder>,
    order_sort_scratch: Vec<(u64, u32)>,
    lifecycle_prepared: bool,
    lifecycle_changed: bool,
    compositing_independent: bool,
    pending_compositing_independent: bool,
}

struct RetainedParagraph {
    id: u32,
    order: u32,
    pending_order: Option<u32>,
    /// Batch segment this paragraph occupies. Paragraphs sharing one may merge their draws.
    segment: u32,
    pending_segment: Option<u32>,
    pending_remove: bool,
    created: bool,
    positioned_changed: bool,
    state: ParagraphState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ParagraphOrder {
    order: u32,
    id: u32,
}

#[derive(Default)]
struct ParagraphState {
    text: Staged<TextStage>,
    /// Whether the pending buffers are a byte-identical copy of the committed ones, so a
    /// mutation batch can skip re-seeding them.
    pending_text_mirrors_committed: bool,
    text_edit: Option<TextEdit>,
    styles: Staged<StyleStage>,
    unicode: Staged<UnicodeAnalysis>,
    unicode_reused_for_text_edit: bool,
    bidi: Staged<BidiAnalysis>,
    shaping_runs: Staged<ShapingRunArena>,
    shape: Staged<ShapeArena>,
    incremental_shape_source_run: Option<u32>,
    clusters: Staged<ClusterArena>,
    glyph_identity_index: IdentityIndex,
    geometry: Staged<FlowGeometryArena>,
    flow_layout: Staged<FlowLayoutArena>,
    intrinsic_geometry_scratch: FlowGeometryArena,
    intrinsic_flow_layout_scratch: FlowLayoutArena,
    intrinsic_flow_slot_scratch: super::flow_geometry::InlineSlotArena,
    intrinsic_positioned_scratch: PositionedGlyphArena,
    intrinsic_identity_scratch: IdentityIndex,
    boundary_shape: BoundaryShapeArena,
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
    geometry_fingerprint: u64,
    pending_geometry_fingerprint: u64,
    speculative_text_fingerprint: u64,
    speculative_style_fingerprint: u64,
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
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if self.planners.contains_key(&handle) {
            return Err(EngineError::RootConflict);
        }
        let mut planner = PlannerState::default();
        let mut spare = ParagraphState::default();
        spare.initialize()?;
        planner.spare_paragraph = Some(spare);
        self.planners.insert(handle, planner);
        Ok(())
    }

    pub fn dispose_root(&mut self, handle: u32) -> Result<(), EngineError> {
        self.planners
            .remove(&handle)
            .ok_or(EngineError::RootMissing)?;
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

    pub fn root_count(&self) -> u32 {
        self.planners.len().try_into().unwrap_or(u32::MAX)
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

    /// Builds a complete independent render plan for selected committed glyph records.
    ///
    /// This query leaves the planner revisions, publication generation, active output slot, and
    /// acknowledgement fence untouched. The returned compiler owns compacted codec buffers that
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
            glyphs.push(glyph);
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
        let semantic_f32_refs: Vec<&[f32]> = semantic_f32.iter().map(Vec::as_slice).collect();
        let semantic_u32_refs: Vec<&[u32]> = semantic_u32.iter().map(Vec::as_slice).collect();
        gather
            .append(
                codec,
                capability_set,
                LayoutPlanInput {
                    transform_id: paragraph_id,
                    segment: super::plan_input::DEFAULT_BATCH_SEGMENT,
                    glyphs: &glyphs,
                    semantic_glyphs: &semantic_glyphs,
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
        Ok(compiler)
    }

    /// Builds a complete independent plan for one committed paragraph's decorations.
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
                super::plan_input::DEFAULT_BATCH_SEGMENT,
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
                super::plan_input::DEFAULT_BATCH_SEGMENT,
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

    /// Answers a paragraph-scoped measurement synchronously: validation and speculative
    /// preparation run for the queried paragraph only, no revision advances, no renderer
    /// fence is acknowledged, and no gather or plan compilation happens. The prepared
    /// pending state is retained as one speculative transaction that sequential queries
    /// extend while the committed revision and per-paragraph input fingerprints still
    /// match; an ordinary frame drops it leave-committed at entry.
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
            return Err(EngineError::InvalidRequest);
        }
        if request.expected_engine_revision != planner.revision.engine
            || request.consumed_revision > planner.revision.root
        {
            return Err(EngineError::RevisionConflict);
        }
        // The lifecycle describes the desired retained plan so creations and replacements can share one
        // candidate, while semantic mutations still belong only to the queried paragraph.
        let mut queried_paragraph_present = request.paragraph_mutations.len() == 0;
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
                super::semantic_wire::ParagraphMutation::Remove { .. } => {}
            }
        }
        if !queried_paragraph_present {
            return Err(EngineError::InvalidRequest);
        }
        let lifecycle_fingerprint = speculative_lifecycle_fingerprint(planner, request)?;
        let prior_generation = planner
            .speculative
            .map_or(0, |transaction| transaction.generation);
        let transaction = planner.speculative.filter(|transaction| {
            transaction.revision == planner.revision
                && transaction.lifecycle_fingerprint == lifecycle_fingerprint
        });
        if planner.speculative.is_some() && transaction.is_none() {
            planner.abort_pending();
        }
        let (mut next_glyph_id, mut next_content_revision) = match transaction {
            Some(transaction) => (transaction.next_glyph_id, transaction.next_content_revision),
            None => (
                planner.next_glyph_id.max(1),
                planner.next_content_revision.max(1),
            ),
        };
        let mut generation = match transaction {
            Some(transaction) => transaction.generation,
            None => prior_generation.wrapping_add(1),
        };
        let implicit_paragraph =
            if request.paragraph_mutations.len() == 0 && planner.paragraphs.is_empty() {
                request_semantic_paragraph_id(request)?
            } else {
                None
            };
        let preparation = (|| {
            planner.semantic_records.clear();
            if transaction.is_none() {
                planner.prepare_lifecycle(
                    request.paragraph_mutations,
                    implicit_paragraph,
                    request.limits.max_paragraphs,
                )?;
            }
            let (mut text_cursor, mut style_cursor) = (0, 0);
            let (mut constraint_cursor, mut inline_object_cursor) = (0, 0);
            let text = request
                .text_mutations
                .take_paragraph(paragraph_id, &mut text_cursor)
                .map_err(|_| EngineError::InvalidRequest)?;
            let styles = request
                .style_mutations
                .take_paragraph(paragraph_id, &mut style_cursor)
                .map_err(|_| EngineError::InvalidRequest)?;
            let geometry = request
                .geometry
                .take_paragraph(
                    paragraph_id,
                    &mut constraint_cursor,
                    &mut inline_object_cursor,
                )
                .map_err(|_| EngineError::InvalidRequest)?;
            if text_cursor != request.text_mutations.len()
                || style_cursor != request.style_mutations.len()
                || constraint_cursor != request.geometry.constraint_count()
                || inline_object_cursor != request.geometry.inline_object_count()
            {
                return Err(EngineError::InvalidRequest);
            }
            let paragraph = planner
                .paragraph_mut(paragraph_id)
                .ok_or(EngineError::InvalidRequest)?;
            let (prefix_retained, geometry_retained) = if transaction.is_some() {
                paragraph.state.speculative_match(text, styles, geometry)
            } else {
                (false, false)
            };
            // Measurement answers at line level from flow and clusters; only a
            // layout-inspection query needs the per-glyph positioning tail.
            let position =
                request.semantic_view_mask & super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION != 0;
            if prefix_retained {
                if !geometry_retained {
                    paragraph.positioned_changed = paragraph.state.prepare_geometry_and_layout(
                        shaper.as_deref_mut(),
                        font_stacks,
                        font_bindings,
                        geometry,
                        request.limits,
                        position,
                        &mut next_glyph_id,
                        &mut next_content_revision,
                    )?;
                } else if position
                    && paragraph.state.flow_layout.is_prepared()
                    && !paragraph.state.positioned.is_prepared()
                {
                    // An inspection query re-using a measurement-only transaction
                    // runs just the missing positioning tail.
                    if let Some(shaper) = shaper.as_deref_mut() {
                        paragraph
                            .state
                            .prepare_positioned(shaper, &mut next_content_revision)?;
                    }
                }
            } else {
                generation = prior_generation.wrapping_add(1);
                paragraph.positioned_changed = paragraph.state.prepare(
                    shaper.as_deref_mut(),
                    font_stacks,
                    font_bindings,
                    text,
                    styles,
                    geometry,
                    request.limits,
                    position,
                    &mut next_glyph_id,
                    &mut next_content_revision,
                )?;
                paragraph.state.speculative_text_fingerprint = text.fingerprint();
                paragraph.state.speculative_style_fingerprint = styles.fingerprint();
            }
            if request.semantic_view_mask
                & (super::frame::SEMANTIC_VIEW_MEASUREMENT
                    | super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
                != 0
            {
                let include_layout_inspection =
                    request.semantic_view_mask & super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION != 0;
                let mut records = core::mem::take(&mut planner.semantic_records);
                let query = append_paragraph_measurement(
                    &mut records,
                    &mut planner
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?
                        .state,
                    paragraph_id,
                    shaper.as_deref(),
                    font_stacks,
                    font_bindings,
                    request.limits,
                    include_layout_inspection,
                );
                planner.semantic_records = records;
                query?;
            }
            Ok(())
        })();
        if let Err(error) = preparation {
            planner.abort_pending();
            return Err(error.in_paragraph(paragraph_id));
        }
        planner.speculative = Some(SpeculativeTransaction {
            revision: planner.revision,
            generation,
            lifecycle_fingerprint,
            next_glyph_id,
            next_content_revision,
        });
        Ok(MeasuredParagraph {
            root_id: request.root_id,
            revision: planner.revision,
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
        // Candidate adoption: a retained speculative transaction whose committed
        // revision and lifecycle input match this frame hands its pending state and
        // reserved identities to the commit; per-paragraph adoption is
        // fingerprint-gated inside the preparation loop. Any other transaction drops
        // leave-committed, so the frame proceeds exactly from committed state.
        let adopted = match planner.speculative {
            Some(transaction)
                if transaction.revision == planner.revision
                    && transaction.lifecycle_fingerprint
                        == speculative_lifecycle_fingerprint(planner, request)? =>
            {
                Some(transaction)
            }
            Some(_) => {
                planner.abort_pending();
                None
            }
            None => None,
        };
        planner.speculative = None;
        let next = RootRevision {
            engine: planner
                .revision
                .engine
                .checked_add(1)
                .ok_or(EngineError::RevisionExhausted)?,
            root: planner
                .revision
                .root
                .checked_add(1)
                .ok_or(EngineError::RevisionExhausted)?,
        };
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
        // A completed renderer fence is external monotonic state. It remains accepted even if
        // plan preparation or publication later aborts.
        planner.acknowledged_publication_generation = request.acknowledged_publication_generation;
        let (mut next_glyph_id, mut next_content_revision) = match adopted {
            Some(transaction) => (
                transaction.next_glyph_id.max(1),
                transaction.next_content_revision.max(1),
            ),
            None => (
                planner.next_glyph_id.max(1),
                planner.next_content_revision.max(1),
            ),
        };
        let implicit_paragraph =
            if request.paragraph_mutations.len() == 0 && planner.paragraphs.is_empty() {
                request_semantic_paragraph_id(request)?
            } else {
                None
            };
        let mut gather_output_matches_next = false;
        let preparation = (|| {
            planner.semantic_records.clear();
            if adopted.is_none() {
                planner.prepare_lifecycle(
                    request.paragraph_mutations,
                    implicit_paragraph,
                    request.limits.max_paragraphs,
                )?;
            }
            let (mut text_cursor, mut style_cursor) = (0, 0);
            let (mut constraint_cursor, mut inline_object_cursor) = (0, 0);
            for order_index in 0..planner.active_order().len() {
                let paragraph_id = planner.active_order()[order_index].id;
                let text = request
                    .text_mutations
                    .take_paragraph(paragraph_id, &mut text_cursor)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let styles = request
                    .style_mutations
                    .take_paragraph(paragraph_id, &mut style_cursor)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let geometry = request
                    .geometry
                    .take_paragraph(
                        paragraph_id,
                        &mut constraint_cursor,
                        &mut inline_object_cursor,
                    )
                    .map_err(|_| EngineError::InvalidRequest)?;
                let paragraph = planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                let (prefix_adopted, geometry_adopted) = if adopted.is_some() {
                    paragraph.state.speculative_match(text, styles, geometry)
                } else {
                    (false, false)
                };
                paragraph.positioned_changed = if geometry_adopted {
                    // Adopting a measurement-only transaction: the flow tail is
                    // retained but positioning was deliberately skipped, so the
                    // committing frame runs exactly that missing tail once.
                    if paragraph.state.flow_layout.is_prepared()
                        && !paragraph.state.positioned.is_prepared()
                        && let Some(shaper) = shaper.as_deref_mut()
                    {
                        paragraph
                            .state
                            .prepare_positioned(shaper, &mut next_content_revision)
                            .map_err(|error| error.in_paragraph(paragraph_id))?;
                    }
                    paragraph.state.speculative_positioned_changed()
                } else if prefix_adopted {
                    paragraph
                        .state
                        .prepare_geometry_and_layout(
                            shaper.as_deref_mut(),
                            font_stacks,
                            font_bindings,
                            geometry,
                            request.limits,
                            true,
                            &mut next_glyph_id,
                            &mut next_content_revision,
                        )
                        .map_err(|error| error.in_paragraph(paragraph_id))?
                } else {
                    paragraph
                        .state
                        .prepare(
                            shaper.as_deref_mut(),
                            font_stacks,
                            font_bindings,
                            text,
                            styles,
                            geometry,
                            request.limits,
                            true,
                            &mut next_glyph_id,
                            &mut next_content_revision,
                        )
                        .map_err(|error| error.in_paragraph(paragraph_id))?
                };
            }
            if text_cursor != request.text_mutations.len()
                || style_cursor != request.style_mutations.len()
                || constraint_cursor != request.geometry.constraint_count()
                || inline_object_cursor != request.geometry.inline_object_count()
            {
                return Err(EngineError::InvalidRequest);
            }
            let positioned_changed = planner.lifecycle_changed
                || planner
                    .paragraphs
                    .iter()
                    .any(|paragraph| paragraph.positioned_changed);
            let reuse_ordered_plan = !checkpoint
                && !positioned_changed
                && request.compositing_independent == planner.compositing_independent
                && codec
                    .programs()
                    .iter()
                    .all(|program| program.allocation_strategy == ALLOCATION_ORDERED_DIRECT);
            if reuse_ordered_plan {
                planner.plan.prepare_reuse().map_err(plan_error)?;
                gather_output_matches_next = cached_gather == Some(current_gather_key);
            } else {
                let record_count =
                    planner
                        .active_order()
                        .iter()
                        .try_fold(0usize, |total, ordered| {
                            let paragraph = planner
                                .paragraph(ordered.id)
                                .ok_or(EngineError::InvalidRequest)?;
                            let positioned = paragraph.state.positioned.active();
                            total
                                .checked_add(positioned.glyphs().len())
                                .ok_or(EngineError::ResultTooLarge)
                        })?;
                *gather_cache = None;
                *prepared_gather_cache = None;
                let capability_set = CapabilitySetId(request.capability_set);
                // Decoration rows bypass the retained gather cursor arithmetic, so a retained plan with
                // any decorated paragraph must rebuild from a reset workspace; entering the
                // retained path and falling back mid-append would stack fresh rows onto the
                // previous update's buffers.
                let attempted_retained =
                    cached_gather == Some(current_gather_key) && !planner_has_decorations(planner);
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
                    )?;
                }
                let gathered = gather.view();
                let mut plan_input = gathered.plan_input();
                // A Text always batches: draw order inside one paragraph is shaping's
                // business, deterministic and never promised. Paragraphs stay apart through
                // their batch segment rather than by refusing to batch at all.
                plan_input.order_independent = true;
                planner
                    .plan
                    .prepare(
                        codec,
                        CapabilitySetId(request.capability_set),
                        plan_input,
                        checkpoint,
                        publication_generation,
                        request.acknowledged_publication_generation,
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
                        let paragraph = planner
                            .paragraph_mut(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?;
                        append_paragraph_measurement(
                            &mut records,
                            &mut paragraph.state,
                            paragraph_id,
                            shaper.as_deref(),
                            font_stacks,
                            font_bindings,
                            request.limits,
                            include_layout_inspection,
                        )
                        .map_err(|error| error.in_paragraph(paragraph_id))?;
                    }
                    Ok(())
                })();
                planner.semantic_records = records;
                query?;
            }
            planner.pending_next_glyph_id = next_glyph_id;
            planner.pending_next_content_revision = next_content_revision;
            planner.pending_compositing_independent = request.compositing_independent;
            Ok(())
        })();
        if let Err(error) = preparation {
            planner.abort_pending();
            return Err(error);
        }
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

    /// Drops a measure query's speculative transaction leave-committed. Used when
    /// staging the query result fails terminally: a query the caller only observed
    /// as failed must not leave an adoptable transaction behind.
    pub(crate) fn abort_measure(&mut self, measured: MeasuredParagraph) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get_mut(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision {
            return Err(EngineError::RevisionConflict);
        }
        planner.abort_pending();
        Ok(())
    }

    pub(crate) fn measured_semantic_views(
        &self,
        measured: MeasuredParagraph,
    ) -> Result<&[super::semantic_view::SemanticRecord], EngineError> {
        let planner = self
            .planners
            .get(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&planner.semantic_records)
    }

    pub(crate) fn abort_update(&mut self, prepared: PreparedUpdate) -> Result<(), EngineError> {
        let next_gather_key = prepared_gather_key(prepared, prepared.next);
        let planner = self
            .planners
            .get_mut(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        planner.abort_pending();
        if self.prepared_gather_cache == Some(next_gather_key) {
            self.prepared_gather_cache = None;
        }
        Ok(())
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
        planner.plan.commit().map_err(plan_error)?;
        planner.commit_paragraphs();
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

/// Emits the measurement (and optional layout-inspection) semantic records for one
/// paragraph, preparing intrinsic layouts on demand. Every stage reads pending state
/// when prepared and committed state otherwise, so the same emission serves the full
/// update path and the paragraph-scoped measure query.
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

// Stage aggregation: each argument is one explicit input threaded through the
// pipeline rather than hidden mutable state, and D-244 measured outlining these
// bodies as size-neutral. Arity is the shape, not a smell.
#[allow(clippy::too_many_arguments)]
fn append_paragraph_measurement(
    records: &mut Vec<super::semantic_view::SemanticRecord>,
    state: &mut ParagraphState,
    paragraph_id: u32,
    shaper: Option<&ShaperRegistry>,
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    limits: super::frame::UpdateLimits,
    include_layout_inspection: bool,
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
    // Intrinsic extents ride the same measurement pass: one scan over the cluster
    // arena, mirroring the breaker's wrap decisions (see `ClusterArena::
    // intrinsic_widths`), so hosts never re-measure at zero width to size a
    // flex item.
    let intrinsics = state.clusters.active().intrinsic_widths(constraint.wrap);
    let needs_intrinsic = visible_extents.consumed_clusters < cluster_count || has_ellipsis;
    if needs_intrinsic {
        state.prepare_intrinsic_flow_layout(
            shaper.ok_or(EngineError::InvalidRequest)?,
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
    if inspect_full_clipped_layout {
        state.prepare_intrinsic_positioned(shaper.ok_or(EngineError::InvalidRequest)?)?;
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
        &state.intrinsic_positioned_scratch
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
    // A measurement-only query deliberately skips the positioning tail, so the
    // positioned arena still describes the COMMITTED flow; its cached per-line
    // lanes must not be read against the speculative flow. The measurement
    // falls back to append_measurement's own line-level derivation, which is
    // the same line arithmetic positioning caches.
    // The positioned arena describes the measured flow in every pairing except
    // one: a re-prepared flow whose positioning tail was deliberately skipped.
    // A pending positioning over a committed flow (a positioning-only restyle)
    // is a VALID pairing — positioning re-ran over exactly that flow.
    let positioned_matches_flow = inspect_full_clipped_layout
        || !(state.flow_layout.is_prepared() && !state.positioned.is_prepared());
    let (line_glyph_starts, line_glyph_counts) = if positioned_matches_flow {
        positioned.semantic_line_glyph_spans()
    } else {
        (&[][..], &[][..])
    };
    let boundary_shape = if state.flow_layout.is_prepared() {
        &state.pending_boundary_shape
    } else {
        &state.boundary_shape
    };
    // Glyph totals: the positioned arena's lanes when they describe this flow,
    // the flow-level derivation otherwise — the integration suite asserts the
    // two agree, so a measurement-only query reports positioned-identical
    // counts without the positioning tail.
    let visible_glyphs = if positioned_matches_flow {
        (
            positioned.semantic_glyphs().len(),
            positioned
                .semantic_glyphs()
                .iter()
                .filter(|glyph| glyph.glyph_id == 0)
                .count(),
        )
    } else {
        super::layout_query::visible_glyph_counts(flow, clusters, boundary_shape)?
    };
    super::layout_query::append_measurement(
        records,
        paragraph_id,
        text.len(),
        clusters.starts.len(),
        visible_glyphs,
        geometry,
        flow,
        if positioned_matches_flow {
            positioned.semantic_glyphs()
        } else {
            &[]
        },
        line_glyph_starts,
        line_glyph_counts,
        positioned_matches_flow.then(|| positioned.semantic_line_inline_extents()),
        clusters,
        intrinsic_extents,
        intrinsics,
        include_layout_inspection && positioned_matches_flow,
    )
}

fn append_planner_gather(
    gather: &mut CodecGatherWorkspace,
    planner: &PlannerState,
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
    retained: bool,
) -> Result<(), EngineError> {
    let mut retaining = retained;
    for ordered in planner.active_order() {
        let paragraph = planner
            .paragraph(ordered.id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = paragraph.state.positioned.active();
        let semantic_f32 = positioned.semantic_f32();
        let semantic_u32 = positioned.semantic_u32();
        let semantic_change_masks = if retaining && !paragraph.positioned_changed {
            &[][..]
        } else {
            positioned.semantic_change_masks()
        };
        let input = LayoutPlanInput {
            transform_id: ordered.id,
            // The gather runs inside the update that stated this segment, before the commit
            // settles it, which is exactly how `active_order` already resolves a pending order.
            // Reading the committed field here would plan the previous grouping.
            segment: paragraph.pending_segment.unwrap_or(paragraph.segment),
            glyphs: positioned.glyphs(),
            semantic_glyphs: positioned.semantic_glyphs(),
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
                paragraph.pending_segment.unwrap_or(paragraph.segment),
                planner.revision.engine.max(1),
                super::codec_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        if retaining {
            match gather
                .append_retained(codec, capability_set, input, binding_for_font)
                .map_err(gather_error)?
            {
                RetainedGather::Complete => {}
                RetainedGather::RebuildFrom(source_start) => {
                    gather.truncate_to_retained_prefix();
                    gather
                        .append_from(codec, capability_set, input, source_start, binding_for_font)
                        .map_err(gather_error)?;
                    retaining = false;
                }
            }
        } else {
            gather
                .append(codec, capability_set, input, binding_for_font)
                .map_err(gather_error)?;
        }
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                ordered.id,
                paragraph.pending_segment.unwrap_or(paragraph.segment),
                planner.revision.engine.max(1),
                super::codec_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
    }
    if retaining && !gather.finish_retained() {
        gather.truncate_to_retained_prefix();
    }
    Ok(())
}

impl PlannerState {
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

    fn prepare_lifecycle(
        &mut self,
        mutations: super::semantic_wire::ParagraphMutationBatch<'_>,
        implicit_paragraph: Option<u32>,
        max_paragraphs: u32,
    ) -> Result<(), EngineError> {
        if self.lifecycle_prepared {
            return Err(EngineError::InvalidRequest);
        }
        if mutations.len() == 0 && implicit_paragraph.is_none() {
            return Ok(());
        }
        self.lifecycle_prepared = true;
        let result = (|| {
            let mut creates =
                usize::from(implicit_paragraph.is_some_and(|id| self.paragraph(id).is_none()));
            let mut removals = 0usize;
            for index in 0..mutations.len() {
                match mutations.get(index).ok_or(EngineError::InvalidRequest)? {
                    super::semantic_wire::ParagraphMutation::Upsert { paragraph_id, .. } => {
                        creates += usize::from(self.paragraph(paragraph_id).is_none());
                    }
                    super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                        if self.paragraph(paragraph_id).is_none() {
                            return Err(EngineError::InvalidRequest);
                        }
                        removals += 1;
                    }
                }
            }
            let final_count = self
                .paragraphs
                .len()
                .checked_add(creates)
                .and_then(|count| count.checked_sub(removals))
                .ok_or(EngineError::InvalidRequest)?;
            if final_count
                > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)?
            {
                return Err(EngineError::InvalidRequest);
            }
            self.paragraphs
                .try_reserve(creates)
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.pending_ordered_paragraphs
                .try_reserve(final_count)
                .map_err(|_| EngineError::ResultTooLarge)?;

            for index in 0..mutations.len() {
                match mutations.get(index).ok_or(EngineError::InvalidRequest)? {
                    super::semantic_wire::ParagraphMutation::Upsert {
                        paragraph_id,
                        order,
                        segment,
                    } => self.prepare_upsert(paragraph_id, order, segment)?,
                    super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                        self.paragraph_mut(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?
                            .pending_remove = true;
                    }
                }
            }
            if let Some(paragraph_id) = implicit_paragraph
                && self.paragraph(paragraph_id).is_none()
            {
                self.prepare_upsert(paragraph_id, 0, super::plan_input::DEFAULT_BATCH_SEGMENT)?;
            }

            self.pending_ordered_paragraphs.clear();
            for paragraph in &self.paragraphs {
                if paragraph.pending_remove {
                    continue;
                }
                self.pending_ordered_paragraphs.push(ParagraphOrder {
                    order: paragraph.pending_order.unwrap_or(paragraph.order),
                    id: paragraph.id,
                });
            }
            sort::prepare_pairs(
                &mut self.order_sort_scratch,
                self.pending_ordered_paragraphs.len(),
            )?;
            for (index, paragraph) in self.pending_ordered_paragraphs.iter().enumerate() {
                self.order_sort_scratch
                    .push((sort::pack2(paragraph.order, paragraph.id), index as u32));
            }
            sort::sort_pairs(&mut self.order_sort_scratch);
            for (paragraph, &(key, _)) in self
                .pending_ordered_paragraphs
                .iter_mut()
                .zip(self.order_sort_scratch.iter())
            {
                *paragraph = ParagraphOrder {
                    order: (key >> 32) as u32,
                    id: key as u32,
                };
            }
            if self
                .pending_ordered_paragraphs
                .windows(2)
                .any(|pair| pair[0].order == pair[1].order)
            {
                return Err(EngineError::InvalidRequest);
            }
            self.lifecycle_changed = self.pending_ordered_paragraphs != self.ordered_paragraphs;
            Ok(())
        })();
        if result.is_err() {
            self.abort_lifecycle();
        }
        result
    }

    fn prepare_upsert(&mut self, id: u32, order: u32, segment: u32) -> Result<(), EngineError> {
        match self
            .paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
        {
            Ok(index) => {
                self.paragraphs[index].pending_order = Some(order);
                self.paragraphs[index].pending_segment = Some(segment);
                Ok(())
            }
            Err(index) => {
                let state = if let Some(spare) = self.spare_paragraph.take() {
                    let mut spare = spare;
                    spare.reset_for_reuse();
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
                        order,
                        pending_order: Some(order),
                        segment,
                        pending_segment: Some(segment),
                        pending_remove: false,
                        created: true,
                        positioned_changed: false,
                        state,
                    },
                );
                Ok(())
            }
        }
    }

    fn active_order(&self) -> &[ParagraphOrder] {
        if self.lifecycle_prepared {
            &self.pending_ordered_paragraphs
        } else {
            &self.ordered_paragraphs
        }
    }

    fn abort_pending(&mut self) {
        self.speculative = None;
        self.plan.abort();
        self.semantic_records.clear();
        for paragraph in &mut self.paragraphs {
            paragraph.state.abort_all();
            paragraph.positioned_changed = false;
        }
        self.abort_lifecycle();
        self.pending_next_glyph_id = 0;
        self.pending_next_content_revision = 0;
        self.pending_compositing_independent = self.compositing_independent;
    }

    fn abort_lifecycle(&mut self) {
        let mut index = 0;
        while index < self.paragraphs.len() {
            if self.paragraphs[index].created {
                let mut paragraph = self.paragraphs.remove(index);
                paragraph.state.abort_all();
                if self.spare_paragraph.is_none() {
                    self.spare_paragraph = Some(paragraph.state);
                }
            } else {
                let paragraph = &mut self.paragraphs[index];
                paragraph.pending_order = None;
                paragraph.pending_segment = None;
                paragraph.pending_remove = false;
                paragraph.positioned_changed = false;
                index += 1;
            }
        }
        self.pending_ordered_paragraphs.clear();
        self.lifecycle_prepared = false;
        self.lifecycle_changed = false;
    }

    fn commit_paragraphs(&mut self) {
        for paragraph in &mut self.paragraphs {
            paragraph.state.commit_all();
            paragraph.positioned_changed = false;
        }
        if !self.lifecycle_prepared {
            return;
        }
        let mut index = 0;
        while index < self.paragraphs.len() {
            if self.paragraphs[index].pending_remove {
                let paragraph = self.paragraphs.remove(index);
                if self.spare_paragraph.is_none() {
                    self.spare_paragraph = Some(paragraph.state);
                }
            } else {
                let paragraph = &mut self.paragraphs[index];
                if let Some(segment) = paragraph.pending_segment.take() {
                    paragraph.segment = segment;
                }
                if let Some(order) = paragraph.pending_order.take() {
                    paragraph.order = order;
                }
                paragraph.created = false;
                index += 1;
            }
        }
        core::mem::swap(
            &mut self.ordered_paragraphs,
            &mut self.pending_ordered_paragraphs,
        );
        self.pending_ordered_paragraphs.clear();
        self.lifecycle_prepared = false;
        self.lifecycle_changed = false;
    }
}

impl ParagraphState {
    /// Clears paragraph identity and committed/pending semantics while retaining every allocation.
    #[inline(never)]
    fn reset_for_reuse(&mut self) {
        {
            let (committed, pending) = self.text.pair_mut();
            committed.units.clear();
            committed.unit_ids.clear();
            pending.units.clear();
            pending.unit_ids.clear();
        }
        self.pending_text_mirrors_committed = true;
        {
            let (committed, pending) = self.text.pair_mut();
            committed.next_unit_id = 0;
            pending.next_unit_id = 0;
        }
        self.text.abort();
        self.text_edit = None;
        {
            let (committed, pending) = self.styles.pair_mut();
            committed.arena.clear();
            committed.resolved.clear();
            pending.arena.clear();
            pending.resolved.clear();
        }
        self.styles.abort();
        {
            let (committed, pending) = self.unicode.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.unicode.abort();
        self.unicode_reused_for_text_edit = false;
        {
            let (committed, pending) = self.bidi.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.bidi.abort();
        {
            let (committed, pending) = self.shaping_runs.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shaping_runs.abort();
        {
            let (committed, pending) = self.shape.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shape.abort();
        self.incremental_shape_source_run = None;
        {
            let (committed, pending) = self.clusters.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.clusters.abort();
        {
            let (committed, pending) = self.geometry.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.geometry.abort();
        {
            let (committed, pending) = self.flow_layout.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.flow_layout.abort();
        self.intrinsic_geometry_scratch.clear();
        self.intrinsic_flow_layout_scratch.clear();
        self.intrinsic_positioned_scratch.clear();
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
        self.positioned.abort();
        self.fallback_spans.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles.abort();
        self.style_invalidation = StyleInvalidation::default();
        self.unicode.abort();
        self.bidi.abort();
        self.shaping_runs.abort();
        self.shape.abort();
        self.clusters.abort();
        self.geometry_fingerprint = 0;
        self.pending_geometry_fingerprint = 0;
        self.speculative_text_fingerprint = 0;
        self.speculative_style_fingerprint = 0;
        self.geometry.abort();
        self.flow_layout.abort();
        self.positioned.abort();
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
        position: bool,
        next_glyph_id: &mut u32,
        next_content_revision: &mut u32,
    ) -> Result<bool, EngineError> {
        self.prepare_text(text_mutations)?;
        self.prepare_styles(style_mutations, |handle| {
            font_stacks
                .binary_search_by_key(&handle, |stack| stack.handle)
                .is_ok()
        })?;
        self.prepare_unicode()?;
        self.prepare_bidi()?;
        self.prepare_shaping_runs()?;
        if let Some(shaper) = shaper.as_deref_mut() {
            self.prepare_shape(shaper, font_stacks, font_bindings)?;
            self.prepare_clusters(shaper, next_glyph_id)?;
        }
        self.prepare_geometry_and_layout(
            shaper,
            font_stacks,
            font_bindings,
            geometry,
            limits,
            position,
            next_glyph_id,
            next_content_revision,
        )
    }

    /// Compares this paragraph's retained speculative prefix against incoming inputs.
    /// The first value reports a text/style fingerprint match; the second additionally
    /// reports that the applied geometry (pending when prepared, committed otherwise)
    /// matches the incoming constraints, so no preparation at all is required.
    fn speculative_match(
        &self,
        text: super::semantic_wire::TextMutationBatch<'_>,
        styles: super::semantic_wire::StyleMutationBatch<'_>,
        geometry: super::semantic_wire::GeometryBatch<'_>,
    ) -> (bool, bool) {
        let prefix = self.speculative_text_fingerprint == text.fingerprint()
            && self.speculative_style_fingerprint == styles.fingerprint();
        if !prefix {
            return (false, false);
        }
        let geometry_fingerprint = if geometry.is_empty() {
            0
        } else {
            geometry.fingerprint()
        };
        let applied_geometry_fingerprint = if self.geometry.is_prepared() {
            self.pending_geometry_fingerprint
        } else if geometry_fingerprint == 0 {
            0
        } else {
            self.geometry_fingerprint
        };
        (true, geometry_fingerprint == applied_geometry_fingerprint)
    }

    /// The `positioned_changed` answer for a fully adopted speculative paragraph:
    /// exactly the formula [`ParagraphState::prepare`] would have reported for the
    /// pending state this paragraph already carries.
    fn speculative_positioned_changed(&self) -> bool {
        self.clusters.is_prepared()
            || self.geometry.is_prepared()
            || self.style_invalidation.metrics
            || self.style_invalidation.positioning
    }

    /// The geometry-and-layout tail of [`ParagraphState::prepare`]: applied alone by a
    /// retained measure query whose semantic prefix (text/style/shaping) fingerprints
    /// still match the speculative transaction.
    #[allow(clippy::too_many_arguments)]
    fn prepare_geometry_and_layout(
        &mut self,
        shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        geometry: super::semantic_wire::GeometryBatch<'_>,
        limits: super::frame::UpdateLimits,
        position: bool,
        next_glyph_id: &mut u32,
        next_content_revision: &mut u32,
    ) -> Result<bool, EngineError> {
        self.prepare_geometry(geometry)?;
        let flow_changed = self.clusters.is_prepared()
            || self.geometry.is_prepared()
            || self.style_invalidation.metrics;
        let positioned_changed = flow_changed || self.style_invalidation.positioning;
        // Reverting to committed geometry must also revert the speculative layout
        // tail: without this, a query at the committed constraint after a query at a
        // different one reads (and a matching frame would commit) flow and
        // positioning prepared for the earlier speculative geometry.
        if !flow_changed && (self.flow_layout.is_prepared() || self.positioned.is_prepared()) {
            self.abort_flow_layout();
            self.abort_positioned();
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
                    self.abort_flow_layout();
                    self.abort_positioned();
                    return Ok(false);
                }
            }
            // Paragraph measurement derives at line level from flow and clusters,
            // so a measurement-only query skips the per-glyph positioning tail
            // entirely; the committing frame (or an inspection query) runs it
            // over the retained flow instead.
            // A measurement-only query leaves positioning unprepared. It cannot leave a
            // STALE one behind: staging a flow drops the positioning that described the
            // previous flow, so there is nothing here to repair.
            if positioned_changed && position {
                self.prepare_positioned(shaper, next_content_revision)?;
            }
        }
        Ok(positioned_changed)
    }

    fn abort_all(&mut self) {
        self.abort_text();
        self.abort_styles();
        self.abort_unicode();
        self.abort_bidi();
        self.abort_shaping_runs();
        self.abort_shape();
        self.abort_clusters();
        self.abort_geometry();
        self.abort_flow_layout();
        self.abort_positioned();
        self.speculative_text_fingerprint = 0;
        self.speculative_style_fingerprint = 0;
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
        self.speculative_text_fingerprint = 0;
        self.speculative_style_fingerprint = 0;
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
        self.intrinsic_positioned_scratch.reserve(glyph_capacity)?;
        self.glyph_identity_index
            .prepare(glyph_capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        reserve_vec(&mut self.fallback_spans, capacity)?;
        reserve_vec(&mut self.pending_fallback_spans, capacity)?;
        reserve_vec(&mut self.fallback_span_scratch, capacity)?;
        reserve_vec(&mut self.fallback_cluster_scratch, glyph_capacity)?;
        reserve_vec(&mut self.sort_pair_scratch, glyph_capacity)
    }

    fn prepare_text(
        &mut self,
        mutations: super::semantic_wire::TextMutationBatch<'_>,
    ) -> Result<(), EngineError> {
        self.abort_text();
        if mutations.len() == 0 {
            return Ok(());
        }
        if !self.pending_text_mirrors_committed {
            let (pending, committed) = self.text.derive_mut();
            if pending.units.try_reserve(committed.units.len()).is_err()
                || pending
                    .unit_ids
                    .try_reserve(committed.unit_ids.len())
                    .is_err()
            {
                return Err(EngineError::ResultTooLarge);
            }
            pending.units.clear();
            pending.units.extend_from_slice(&committed.units);
            pending.unit_ids.clear();
            pending.unit_ids.extend_from_slice(&committed.unit_ids);
            self.pending_text_mirrors_committed = true;
        }
        let seed_next_unit_id = self.text.committed().next_unit_id.max(1);
        self.text.pending_mut().next_unit_id = seed_next_unit_id;
        self.text.mark_prepared();
        self.pending_text_mirrors_committed = false;
        for index in 0..mutations.len() {
            let Some(mutation) = mutations.get(index) else {
                self.abort_text();
                return Err(EngineError::InvalidRequest);
            };
            if let Err(error) = apply_text_mutation(&mut self.text.pending_mut().units, mutation) {
                self.abort_text();
                return Err(match error {
                    TextMutationError::Invalid => EngineError::InvalidRequest,
                    TextMutationError::Allocation => EngineError::ResultTooLarge,
                });
            }
            let TextStage {
                unit_ids: pending_unit_ids,
                next_unit_id: pending_next_unit_id,
                ..
            } = self.text.pending_mut();
            if let Err(error) =
                apply_text_identity_mutation(pending_unit_ids, pending_next_unit_id, mutation)
            {
                self.abort_text();
                return Err(error);
            }
        }
        if self.text.pending().units.len() != self.text.pending().unit_ids.len() {
            self.abort_text();
            return Err(EngineError::InvalidRequest);
        }
        self.text_edit = {
            let (pending, committed) = self.text.derive_mut();
            changed_identity_range(&committed.unit_ids, &pending.unit_ids)
        };
        Ok(())
    }

    fn abort_text(&mut self) {
        if self.text.is_prepared() {
            // Restore the pending buffers to mirror the committed ones, so the next
            // mutation batch can skip re-seeding them.
            let (pending, committed) = self.text.derive_mut();
            pending.units.clear();
            pending.units.extend_from_slice(&committed.units);
            pending.unit_ids.clear();
            pending.unit_ids.extend_from_slice(&committed.unit_ids);
            self.pending_text_mirrors_committed = true;
        }
        self.clear_text_preparation();
    }

    fn clear_text_preparation(&mut self) {
        self.text.pending_mut().next_unit_id = 0;
        self.text.abort();
        self.text_edit = None;
    }

    fn prepare_styles(
        &mut self,
        mutations: super::semantic_wire::StyleMutationBatch<'_>,
        font_stack_exists: impl FnMut(u32) -> bool,
    ) -> Result<(), EngineError> {
        self.abort_styles();
        if mutations.len() == 0 {
            if !self.text.is_prepared() || self.styles.committed().arena.len() == 0 {
                return Ok(());
            }
            return self.styles.committed().arena.validate(
                self.text.pending().units.as_slice(),
                font_stack_exists,
                &mut self.style_order_scratch,
                &mut self.style_nesting_scratch,
                &mut self.sort_pair_scratch,
                &mut self.style_sort_pair_scratch,
            );
        }
        {
            let (pending_styles, committed_styles) = self.styles.derive_mut();
            pending_styles.arena.prepare_from(
                &committed_styles.arena,
                mutations,
                &mut self.style_mutation_scratch,
                &mut self.sort_pair_scratch,
            )?;
        }
        if self.styles.committed().arena.len() != 0 && self.styles.pending().arena.len() == 0 {
            self.abort_styles();
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
            self.abort_styles();
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
            self.abort_styles();
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

    fn abort_styles(&mut self) {
        self.styles.pending_mut().arena.clear();
        self.styles.pending_mut().resolved.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles.abort();
        self.style_invalidation = StyleInvalidation::default();
    }

    fn commit_styles(&mut self) {
        // One swap publishes both buffers, because they are one stage.
        self.styles.commit();
        self.abort_styles();
    }

    fn commit_text(&mut self) {
        if self.text.is_prepared() {
            let retains_mirror =
                self.text.pending().units.len() == self.text.committed().units.len();
            let edit = self.text_edit;
            // One swap publishes units, identities, and the counter together. The
            // counter swaps rather than being assigned, which the original did by hand;
            // the difference is erased because `clear_text_preparation` zeroes the
            // pending counter immediately below.
            self.text.commit();
            if retains_mirror {
                if let Some(edit) = edit {
                    let (pending, committed) = self.text.derive_mut();
                    pending.units[edit.old_start..edit.new_end]
                        .copy_from_slice(&committed.units[edit.old_start..edit.new_end]);
                    pending.unit_ids[edit.old_start..edit.new_end]
                        .copy_from_slice(&committed.unit_ids[edit.old_start..edit.new_end]);
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

    fn prepare_unicode(&mut self) -> Result<(), EngineError> {
        self.abort_unicode();
        if !self.text.is_prepared() {
            return Ok(());
        }
        if let Some(edit) = self.text_edit
            && self.unicode.committed().reusable_for_ascii_letter_edit(
                &self.text.committed().units,
                &self.text.pending().units,
                edit.old_start,
                edit.old_end,
                edit.new_end,
            )
        {
            self.unicode_reused_for_text_edit = true;
            return Ok(());
        }
        self.unicode
            .pending_mut()
            .analyze(&self.text.pending().units)
            .map_err(unicode_error)?;
        self.unicode.mark_prepared();
        Ok(())
    }

    fn abort_unicode(&mut self) {
        self.unicode.abort();
        self.unicode_reused_for_text_edit = false;
    }

    fn commit_unicode(&mut self) {
        if self.unicode.is_prepared() {
            self.unicode.commit();
        }
        self.abort_unicode();
    }

    fn prepare_bidi(&mut self) -> Result<(), EngineError> {
        self.abort_bidi();
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

    fn abort_bidi(&mut self) {
        self.bidi.abort();
    }

    fn commit_bidi(&mut self) {
        if self.bidi.is_prepared() {
            self.bidi.commit();
        }
        self.abort_bidi();
    }

    fn prepare_shaping_runs(&mut self) -> Result<(), EngineError> {
        self.abort_shaping_runs();
        if !self.text.is_prepared()
            && !self.style_invalidation.shaping
            && !self.style_invalidation.metrics
            && !self.bidi.is_prepared()
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

    fn abort_shaping_runs(&mut self) {
        self.shaping_runs.pending_mut().clear();
        self.shaping_runs.abort();
    }

    fn commit_shaping_runs(&mut self) {
        if self.shaping_runs.is_prepared() {
            self.shaping_runs.commit();
        }
        self.abort_shaping_runs();
    }

    fn prepare_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
    ) -> Result<(), EngineError> {
        self.abort_shape();
        // Metric-only styles must refresh the retained run values consumed by cluster aggregation, but the underlying
        // HarfRust result remains valid. Keeping those two invalidations distinct avoids reshaping on size, tracking,
        // word-spacing, line-height, or baseline changes while still rebuilding advances from the new run styles.
        // One exception: a metric change can MERGE adjacent runs whose layout styles became identical, and the
        // retained shaped runs then index a run list that no longer exists — the shape must re-run whenever the
        // rebuilt run list breaks positional topology with the committed one.
        if !self.shaping_runs.is_prepared()
            || (!self.text.is_prepared()
                && !self.style_invalidation.shaping
                && !self.bidi.is_prepared()
                && shaping_run_topology_stable(
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
        let runs = self.shaping_runs.pending_mut().runs();
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
        let Some(edit) = self.text_edit else {
            return Ok(false);
        };
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.pending().runs();
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
            || !same_edit_run_topology(old_runs, new_runs, edit, old_run_index)?
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
        if self
            .shape
            .committed()
            .runs
            .iter()
            .filter(|run| run.source_run == affected_source_run)
            .count()
            != 1
        {
            return Ok(false);
        }
        let delta = edit_delta(edit)?;
        let styles = &self.styles.active().arena;
        self.boundary_shape_scratch.clear();
        let scratch = &mut self.boundary_shape_scratch;
        shaper
            .with_shaped_run(
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
                |shaped| {
                    scratch.append(
                        old_run_index,
                        fallback.font_handle,
                        fallback.binding_handle,
                        new_run.text_start,
                        new_run.text_end,
                        shaped,
                    )
                },
            )
            .map_err(shaper_error)?;
        if self.boundary_shape_scratch.glyph_ids.contains(&0) {
            self.boundary_shape_scratch.clear();
            return Ok(false);
        }
        // One split borrow for the whole scatter: the committed runs are read while the
        // pending arena is appended to, which is exactly the shape `derive_mut` exists for.
        // Copying the run list to satisfy the borrow checker instead would allocate on the
        // incremental edit path this function exists to keep cheap.
        let boundary_scratch = &self.boundary_shape_scratch;
        let (pending_shape, committed_shape) = self.shape.derive_mut();
        for (shape_run_index, shaped_run) in committed_shape.runs.iter().copied().enumerate() {
            if shaped_run.source_run == affected_source_run {
                pending_shape.append_text_range_from(
                    boundary_scratch,
                    0,
                    affected_source_run,
                    new_run.text_start,
                    new_run.text_end,
                    0,
                )?;
                continue;
            }
            let run_delta = if shaped_run.text_start >= old_run.text_end {
                delta
            } else {
                0
            };
            pending_shape.append_text_range_from(
                committed_shape,
                shape_run_index,
                shaped_run.source_run,
                shaped_run.text_start,
                shaped_run.text_end,
                run_delta,
            )?;
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

    fn abort_shape(&mut self) {
        self.shape.pending_mut().clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.incremental_shape_source_run = None;
        self.shape.abort();
    }

    fn commit_shape(&mut self) {
        if self.shape.is_prepared() {
            self.shape.commit();
            core::mem::swap(&mut self.fallback_spans, &mut self.pending_fallback_spans);
        }
        self.abort_shape();
    }

    fn prepare_clusters(
        &mut self,
        shaper: &ShaperRegistry,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        self.abort_clusters();
        if !self.shape.is_prepared() && !self.style_invalidation.metrics {
            return Ok(());
        }
        let text = self.text.active().units.as_slice();
        let text_unit_ids = self.text.active().unit_ids.as_slice();
        let unicode = self.unicode.active();
        let styles = self.styles.active().resolved.segments();
        let runs = self.shaping_runs.active().runs();
        if runs.is_empty() {
            self.clusters.pending_mut().clear();
            self.clusters.mark_prepared();
            return Ok(());
        }
        // A metrics-only restyle retains the shape, so the cluster arena needs
        // only its advance lanes re-derived from the retained adjacency stream
        // — no topology walk, no scatter, and the stable glyph identities
        // carry over. The retained arena indexes shaped runs by position, and a
        // metrics-only restyle can still MERGE adjacent runs whose layout
        // styles became identical, so the refresh additionally requires the
        // rebuilt run list to keep the previous topology. Any admission
        // failure falls back to the full build.
        let run_topology_stable = !self.shaping_runs.is_prepared()
            || shaping_run_topology_stable(self.shaping_runs.committed().runs(), runs);
        if !self.shape.is_prepared() && run_topology_stable && {
            let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
            pending_clusters
                .refresh_scales_from_stream(committed_clusters, styles)?
                .is_some()
        } {
            self.clusters.mark_prepared();
            return Ok(());
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
        if let Some(source_run) = self.incremental_shape_source_run
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
                self.abort_clusters();
                return Err(error);
            }
            self.clusters.mark_prepared();
            return Ok(());
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
            self.abort_clusters();
            return Err(error);
        }
        self.clusters.mark_prepared();
        Ok(())
    }

    fn abort_clusters(&mut self) {
        self.clusters.pending_mut().clear();
        self.clusters.abort();
    }

    fn commit_clusters(&mut self) {
        if self.clusters.is_prepared() {
            self.clusters.commit();
        }
        self.abort_clusters();
    }

    fn prepare_geometry(
        &mut self,
        geometry: super::semantic_wire::GeometryBatch<'_>,
    ) -> Result<(), EngineError> {
        self.abort_geometry();
        if geometry.is_empty() {
            return Ok(());
        }
        self.geometry.pending_mut().build(geometry)?;
        self.pending_geometry_fingerprint = geometry.fingerprint();
        if geometry.inline_object_count() == 0
            && self.geometry.pending() == self.geometry.committed()
        {
            self.geometry.pending_mut().clear();
            self.pending_geometry_fingerprint = 0;
            return Ok(());
        }
        self.geometry.mark_prepared();
        Ok(())
    }

    fn abort_geometry(&mut self) {
        self.geometry.pending_mut().clear();
        self.pending_geometry_fingerprint = 0;
        self.geometry.abort();
    }

    fn commit_geometry(&mut self) {
        if self.geometry.is_prepared() {
            self.geometry_fingerprint = self.pending_geometry_fingerprint;
            self.geometry.commit();
        }
        self.abort_geometry();
    }

    fn prepare_flow_layout(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        self.abort_flow_layout();
        // Positioning is derived from one specific flow: its per-line lanes describe the
        // lines that flow composed. Re-running the flow therefore invalidates any pending
        // positioning by construction, so dropping it here — at the single place a new
        // flow is staged — is what makes "positioning that describes a superseded flow"
        // unrepresentable rather than something each caller has to remember to repair.
        self.abort_positioned();
        self.pending_boundary_shape.clear();
        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        let style_storage = &self.styles.active().arena;
        let runs = self.shaping_runs.active().runs();
        let text = self.text.active().units.as_slice();
        let geometry = self.geometry.active();
        let max_slots_per_band =
            usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?;
        let max_lines = usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?;
        if !self.geometry.is_prepared()
            && !self.style_invalidation.metrics
            && self.boundary_shape.records.is_empty()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && let Some(edit) = self.text_edit
            && edit.old_end.saturating_sub(edit.old_start)
                == edit.new_end.saturating_sub(edit.old_start)
            && {
                let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
                pending_flow.rebuild_until_state_converges(
                    committed_flow,
                    geometry,
                    self.clusters.committed(),
                    clusters,
                    styles,
                    &mut self.flow_slot_scratch,
                    u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?,
                    max_lines,
                    max_slots_per_band,
                    |handle| shaper.font_metrics(handle),
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
                )?
            }
        {
            self.flow_layout.mark_prepared();
            return Ok(());
        }
        self.flow_layout.pending_mut().build(
            geometry,
            clusters,
            styles,
            &mut self.flow_slot_scratch,
            max_lines,
            max_slots_per_band,
            |handle| shaper.font_metrics(handle),
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
        )?;
        let mut ellipsis_index = 0usize;
        while ellipsis_index < self.flow_layout.pending_mut().ellipsis_threads().len() {
            let flow_thread_id = self.flow_layout.pending_mut().ellipsis_threads()[ellipsis_index];
            let line = self
                .flow_layout
                .pending_mut()
                .lines
                .iter()
                .rev()
                .find(|line| line.flow_thread_id == flow_thread_id)
                .copied()
                .ok_or(EngineError::InvalidRequest)?;
            let fragment_index = usize::try_from(line.fragment_start)
                .map_err(|_| EngineError::InvalidRequest)?
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
                source_shape,
                clusters,
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
            });
            self.flow_layout.pending_mut().fragments[fragment_index].boundary_index =
                boundary_index;
            ellipsis_index += 1;
        }
        self.flow_layout.mark_prepared();
        Ok(())
    }

    fn prepare_intrinsic_flow_layout(
        &mut self,
        shaper: &ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
    ) -> Result<(), EngineError> {
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
        region.record.block_end = INTRINSIC_BLOCK_END;

        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        self.intrinsic_flow_layout_scratch.build(
            &self.intrinsic_geometry_scratch,
            clusters,
            styles,
            &mut self.intrinsic_flow_slot_scratch,
            usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?,
            usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?,
            |handle| shaper.font_metrics(handle),
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
        )
    }

    fn prepare_intrinsic_positioned(&mut self, shaper: &ShaperRegistry) -> Result<(), EngineError> {
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let previous = self.positioned.active();
        let mut next_content_revision = 1;
        let geometry = &self.intrinsic_geometry_scratch;
        self.intrinsic_positioned_scratch.build(
            previous,
            &self.intrinsic_flow_layout_scratch,
            text,
            clusters,
            runs,
            &BoundaryShapeArena::default(),
            styles,
            bidi,
            &mut self.intrinsic_identity_scratch,
            &mut next_content_revision,
            |thread| thread_typography(geometry, thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )
    }

    fn abort_flow_layout(&mut self) {
        self.flow_layout.pending_mut().clear();
        self.pending_boundary_shape.clear();
        self.flow_layout.abort();
    }

    fn commit_flow_layout(&mut self) {
        if self.flow_layout.is_prepared() {
            // The boundary shape is the flow's own output and commits with it.
            core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
        }
        self.flow_layout.commit();
        self.abort_flow_layout();
    }

    fn prepare_positioned(
        &mut self,
        shaper: &ShaperRegistry,
        next_content_revision: &mut u32,
    ) -> Result<(), EngineError> {
        self.abort_positioned();
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let flow = self.flow_layout.active();
        let boundary_shape = if self.flow_layout.is_prepared() {
            &self.pending_boundary_shape
        } else {
            &self.boundary_shape
        };
        let geometry = self.geometry.active();
        let (committed_positioned, pending_positioned) = self.positioned.pair_mut();
        pending_positioned.build(
            committed_positioned,
            flow,
            text,
            clusters,
            runs,
            boundary_shape,
            styles,
            bidi,
            &mut self.glyph_identity_index,
            next_content_revision,
            |thread| thread_typography(geometry, thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )?;
        self.positioned.mark_prepared();
        Ok(())
    }

    fn abort_positioned(&mut self) {
        self.positioned.pending_mut().clear();
        self.positioned.abort();
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
    let start = usize::try_from(mutation.text_start).map_err(|_| TextMutationError::Invalid)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| TextMutationError::Invalid)?;
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(TextMutationError::Invalid)?;
    if delete_end > text.len() || !mutation.insert_utf16_le.len().is_multiple_of(2) {
        return Err(TextMutationError::Invalid);
    }
    let insert_count = mutation.insert_utf16_le.len() / 2;
    let old_len = text.len();
    let new_len = old_len
        .checked_sub(delete_count)
        .and_then(|length| length.checked_add(insert_count))
        .ok_or(TextMutationError::Invalid)?;
    if u32::try_from(new_len).is_err() {
        return Err(TextMutationError::Invalid);
    }
    if new_len > old_len {
        text.try_reserve(new_len - old_len)
            .map_err(|_| TextMutationError::Allocation)?;
        text.resize(new_len, 0);
    }
    text.copy_within(delete_end..old_len, start + insert_count);
    if new_len < old_len {
        text.truncate(new_len);
    }
    for (unit, bytes) in text[start..start + insert_count]
        .iter_mut()
        .zip(mutation.insert_utf16_le.chunks_exact(2))
    {
        *unit = u16::from_le_bytes([bytes[0], bytes[1]]);
    }
    Ok(())
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
        new_end: next_end,
    })
}

fn apply_text_identity_mutation(
    identities: &mut Vec<u32>,
    next_identity: &mut u32,
    mutation: super::semantic_wire::TextMutation<'_>,
) -> Result<(), EngineError> {
    let start = usize::try_from(mutation.text_start).map_err(|_| EngineError::InvalidRequest)?;
    let delete_count =
        usize::try_from(mutation.delete_count).map_err(|_| EngineError::InvalidRequest)?;
    let delete_end = start
        .checked_add(delete_count)
        .ok_or(EngineError::InvalidRequest)?;
    let insert_count = mutation.insert_utf16_le.len() / 2;
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
        if *next_identity == 0 {
            return Err(EngineError::RevisionExhausted);
        }
        *identity = *next_identity;
        *next_identity = next_identity
            .checked_add(1)
            .ok_or(EngineError::RevisionExhausted)?;
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
        run.text_start <= start
            && end <= run.text_end
            && (start < end || (run.text_start < start && start < run.text_end))
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
) -> Result<bool, EngineError> {
    for (index, (&old, &new)) in old_runs.iter().zip(new_runs).enumerate() {
        if !same_shaping_properties(old, new) {
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

fn append_boundary_source_ids(
    output: &mut Vec<u32>,
    source: &ShapeArena,
    clusters: &ClusterArena,
    next_glyph_id: &mut u32,
) -> Result<(), EngineError> {
    let mut previous_cluster = None;
    let mut ordinal = 0usize;
    for &text_cluster in &source.clusters {
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
                let start = usize::try_from(*clusters.glyph_starts.get(cluster)?).ok()?;
                let count = usize::try_from(*clusters.glyph_counts.get(cluster)?).ok()?;
                (ordinal < count)
                    .then(|| clusters.glyph_stable_ids.get(start + ordinal).copied())
                    .flatten()
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

/// Identity of a request's structure-changing lifecycle input relative to committed
/// planner state. Upserts that restate an existing paragraph at its committed order
/// are lifecycle-neutral and do not participate — queries routed at different
/// existing paragraphs therefore share one transaction, which is what makes the
/// multi-paragraph retained story reachable. Creations, removals, reorders, and the
/// implicit creation of a missing semantic paragraph all fold; a request with no
/// structure-changing content fingerprints to the neutral 0 sentinel. Committed
/// structure cannot change without a revision advance, and the transaction already
/// requires revision equality, so neutrality is stable for the transaction's life.
fn speculative_lifecycle_fingerprint(
    planner: &PlannerState,
    request: UpdateRequest<'_>,
) -> Result<u64, EngineError> {
    let mut hash = 0_u64;
    let mut mixed = false;
    for index in 0..request.paragraph_mutations.len() {
        let mutation = request
            .paragraph_mutations
            .get(index)
            .ok_or(EngineError::InvalidRequest)?;
        let (opcode, paragraph_id, order) = match mutation {
            super::semantic_wire::ParagraphMutation::Upsert {
                paragraph_id,
                order,
                segment,
            } => {
                if planner.paragraph(paragraph_id).is_some_and(|paragraph| {
                    !paragraph.created && paragraph.order == order && paragraph.segment == segment
                }) {
                    continue;
                }
                (1_u64, paragraph_id, order)
            }
            super::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                (2_u64, paragraph_id, 0)
            }
        };
        if !mixed {
            hash = 0xcbf2_9ce4_8422_2325;
            mixed = true;
        }
        for value in [opcode, u64::from(paragraph_id), u64::from(order)] {
            for byte in value.to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
    }
    if request.paragraph_mutations.len() == 0
        && let Some(paragraph_id) = request_semantic_paragraph_id(request)?
        && !planner
            .paragraph(paragraph_id)
            .is_some_and(|paragraph| !paragraph.created)
    {
        hash ^= 0x9e37_79b9_7f4a_7c15 ^ u64::from(paragraph_id);
    }
    Ok(hash)
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
mod tests {
    use crate::engine::style_state::ResolvedStyle;

    use super::*;

    #[test]
    fn retained_edit_range_and_run_topology_track_insertions_without_crossing_run_boundaries() {
        let edit = changed_identity_range(&[1, 2, 3, 4], &[1, 5, 6, 2, 3, 4]).unwrap();
        assert_eq!(
            edit,
            TextEdit {
                old_start: 1,
                old_end: 1,
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
        assert!(same_edit_run_topology(&old, &new, edit, 0).unwrap());
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
                ALLOCATION_ORDERED_DIRECT, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE,
                BATCH_TECHNIQUE, BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId,
                BufferSchema, CAP_ORDERED_DIRECT, CapabilitySet, CodecDescriptor, Operation,
                ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType, TechniqueId,
            },
            font_binding::{
                FieldTable, FontRenderBinding, FontResource, FontStrike, MISSING_RESOURCE_INDEX,
            },
            frame::{
                PARAGRAPH_MUTATION_REMOVE, PARAGRAPH_MUTATION_UPSERT, STYLE_FIELD_DIRECTION,
                STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK, STYLE_FIELD_LINE_HEIGHT,
                STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE,
                STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16,
            },
            semantic_wire::{
                parse_paragraph_mutations, parse_style_mutations, parse_text_mutations,
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
    fn aborting_a_prepared_plan_preserves_revisions_and_allows_retry() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        let prepared = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        assert!(engine.prepared_gather_cache.is_some());
        engine.abort_update(prepared).unwrap();
        assert!(engine.gather_cache.is_none());
        assert!(engine.prepared_gather_cache.is_none());
        assert_eq!(engine.root_revision(4).unwrap(), RootRevision::default());
        let retry = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(retry).unwrap();
    }

    #[test]
    fn sequential_measure_queries_extend_one_retained_speculative_transaction() {
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

        // A speculative append prepares pending state that outlives the query while
        // committed text stays untouched (leave-committed retention).
        let edit_bytes = text_mutation_bytes(&[(4, 0, &[0x58, 0x59])]);
        let mut query = update(1, 1, 1);
        query.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        engine.measure_paragraph(query, 1).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        let planner = engine.planners.get(&4).unwrap();
        let state = planner.first_paragraph_state().unwrap();
        assert!(state.text.is_prepared());
        assert_eq!(
            state.text.pending().units,
            [0x61, 0x62, 0x63, 0x64, 0x58, 0x59]
        );
        let transaction = planner.speculative.unwrap();
        assert_eq!(transaction.revision, planner.revision);

        // The same speculative input extends the transaction instead of rebuilding it.
        let mut repeat = update(1, 1, 1);
        repeat.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        engine.measure_paragraph(repeat, 1).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert_eq!(
            planner.speculative.unwrap().generation,
            transaction.generation
        );

        // A different speculative input rebuilds the paragraph prefix cold, and the
        // rebuilt transaction is retained in its place.
        let changed_bytes = text_mutation_bytes(&[(4, 0, &[0x5a])]);
        let mut changed = update(1, 1, 1);
        changed.text_mutations =
            parse_text_mutations(&changed_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        engine.measure_paragraph(changed, 1).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.speculative.unwrap().generation > transaction.generation);
        assert_eq!(
            planner
                .first_paragraph_state()
                .unwrap()
                .text
                .pending()
                .units,
            [0x61, 0x62, 0x63, 0x64, 0x5a]
        );
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);

        // An ordinary frame drops the transaction leave-committed at entry and
        // proceeds exactly as if no query had happened.
        let follow = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        assert!(engine.planners.get(&4).unwrap().speculative.is_none());
        let committed = engine.commit_update(follow).unwrap();
        assert_eq!(committed.revision, RootRevision { engine: 2, root: 2 });
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
    }

    #[test]
    fn text_fingerprints_delimit_mutation_boundaries() {
        // The Sol review's aliasing construction: one six-unit replacement whose
        // twelve payload bytes spell the little-endian fields of a second mutation
        // must not fingerprint like the two-mutation batch it imitates.
        let paragraph = 1_u32;
        let mut payload = [0_u16; 6];
        payload[0] = paragraph as u16;
        let aliased_bytes = text_mutation_bytes(&[(0, 6, &payload)]);
        let aliased =
            parse_text_mutations(&aliased_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let pair_bytes = text_mutation_bytes(&[(0, 6, &[]), (0, 0, &[])]);
        let pair = parse_text_mutations(&pair_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        assert_ne!(aliased.fingerprint(), pair.fingerprint());
        assert_ne!(aliased.fingerprint(), 0);
        assert_ne!(pair.fingerprint(), 0);
    }

    #[test]
    fn one_transaction_retains_queries_for_different_existing_paragraphs() {
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

        // Measure paragraph 1 with a lifecycle-neutral upsert (its committed order),
        // speculating a text edit onto it.
        let edit_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62])]);
        let first_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 1, 1)]);
        let mut first = update(1, 1, 1);
        first.limits.max_paragraphs = 2;
        first.paragraph_mutations =
            parse_paragraph_mutations(&first_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        first.text_mutations =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        engine.measure_paragraph(first, 1).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(1).unwrap().state.text.is_prepared());
        let generation = planner.speculative.unwrap().generation;

        // Measuring paragraph 2 extends the SAME transaction: a lifecycle-neutral
        // upsert of a different existing paragraph must not abort paragraph 1's
        // retained speculative state.
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
        engine.measure_paragraph(second, 2).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        let _ = generation;
        assert!(
            planner.speculative.is_some(),
            "a query for a second existing paragraph extends the transaction"
        );
        assert!(
            planner.paragraph(1).unwrap().state.text.is_prepared(),
            "the first paragraph's speculative state survives the second query"
        );
        assert!(planner.paragraph(2).unwrap().state.text.is_prepared());
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
    fn one_lifecycle_retains_queries_for_different_new_paragraphs() {
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
        engine.measure_paragraph(first, 1).unwrap();

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
        engine.measure_paragraph(second, 2).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.speculative.is_some());
        assert!(planner.paragraph(1).unwrap().state.text.is_prepared());
        assert!(planner.paragraph(2).unwrap().state.text.is_prepared());
    }

    #[test]
    fn replacement_lifecycle_retains_queries_after_a_paragraph_removal() {
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
        engine.measure_paragraph(first, 4).unwrap();

        let mut second = update(1, 1, 1);
        second.limits.max_paragraphs = 3;
        second.paragraph_mutations =
            parse_paragraph_mutations(&replacement_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 4)
                .unwrap();
        engine.measure_paragraph(second, 3).unwrap();

        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.speculative.is_some());
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
    fn a_speculative_candidate_paragraph_survives_queries_and_yields_to_the_frame() {
        let mut engine = TextEngine::default();
        engine
            .register_codec(9, validated_codec(TechniqueId(1)))
            .unwrap();
        engine.create_root(4).unwrap();
        engine.reserve_root_text(4, 8).unwrap();
        let prepared = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(prepared).unwrap();

        // Measure a paragraph the retained plan has never committed: the query owns the
        // candidate speculatively.
        let lifecycle_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 7, 1)]);
        let mut query = update(1, 1, 1);
        query.limits.max_paragraphs = 2;
        query.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        engine.measure_paragraph(query, 7).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.paragraph(7).is_some());
        assert!(planner.speculative.is_some());

        // A repeated identical lifecycle extends the transaction without recreating
        // the candidate.
        let mut repeat = update(1, 1, 1);
        repeat.limits.max_paragraphs = 2;
        repeat.paragraph_mutations =
            parse_paragraph_mutations(&lifecycle_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        engine.measure_paragraph(repeat, 7).unwrap();
        let generation = engine
            .planners
            .get(&4)
            .unwrap()
            .speculative
            .unwrap()
            .generation;
        assert_eq!(generation, 1);

        // An ordinary frame reclaims the candidate: committed state never saw it.
        let follow = engine.prepare_update(update(1, 1, 1), 2).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        assert!(planner.speculative.is_none());
        assert!(planner.paragraph(7).is_none());
        engine.commit_update(follow).unwrap();
        assert!(engine.planners.get(&4).unwrap().paragraph(7).is_none());
    }

    #[test]
    fn ordered_utf16_replacements_commit_and_abort_with_the_planner_transaction() {
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

        let edit_bytes = text_mutation_bytes(&[(1, 1, &[0x58, 0x59]), (5, 0, &[0x21])]);
        let edit_batch =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut edit = update(1, 1, 1);
        edit.text_mutations = edit_batch;
        let prepared = engine.prepare_update(edit, 2).unwrap();
        engine.abort_update(prepared).unwrap();
        assert_eq!(engine.root_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        let planner = engine.planners.get(&4).unwrap();
        let paragraph = planner.first_paragraph_state().unwrap();
        assert_eq!(paragraph.text.committed().unit_ids, [1, 2, 3, 4]);
        assert_eq!(paragraph.text.committed().next_unit_id, 5);

        let retry = engine.prepare_update(edit, 2).unwrap();
        engine.commit_update(retry).unwrap();
        assert_eq!(
            engine.root_text(4).unwrap(),
            &[0x61, 0x58, 0x59, 0x63, 0x64, 0x21]
        );
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
            [1, 5, 6, 3, 4, 7]
        );

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
    fn invalid_utf16_aborts_text_and_unicode_analysis_together() {
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
        let planner = engine.planners.get(&4).unwrap();
        let paragraph = planner.first_paragraph_state().unwrap();
        assert!(paragraph.text.committed().units.is_empty());
        assert!(paragraph.unicode.active().grapheme_boundaries().is_empty());
        assert!(paragraph.bidi.active().levels.is_empty());
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
        paragraph.text_edit = Some(TextEdit {
            old_start: 1,
            old_end: 2,
            new_end: 2,
        });
        paragraph.style_invalidation.bidi = true;
        paragraph
            .unicode
            .pending_mut()
            .analyze(&paragraph.text.committed().units)
            .unwrap();

        paragraph.prepare_unicode().unwrap();
        assert!(paragraph.unicode_reused_for_text_edit);
        paragraph.prepare_bidi().unwrap();
        assert!(paragraph.bidi.is_prepared());
        assert_eq!(paragraph.bidi.pending().paragraph_levels, [0]);
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
        assert_eq!(
            engine.dispose_font_stack(7),
            Err(EngineError::RegistrationInUse)
        );
        engine.dispose_root(4).unwrap();
        assert_eq!(engine.dispose_font_stack(7), Ok(()));
    }

    #[test]
    fn retained_style_upserts_commit_and_root_removal_aborts_transactionally() {
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
        let bytes = text_mutation_bytes(&[(0, 0, &[0x61]), (9, 0, &[0x62])]);
        let batch = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut request = update(0, 0, 0);
        request.text_mutations = batch;
        assert_eq!(
            engine.prepare_update(request, 1),
            Err(EngineError::InvalidRequest)
        );
        assert!(engine.root_text(4).unwrap().is_empty());
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
        let replacement_lifecycle = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_UPSERT, 3, 1)]);
        let replacement_text = paragraph_text_mutation_bytes(&[(3, 0, 0, &[0x7a])]);
        let mut replacement = update(3, 3, 3);
        replacement.limits.max_paragraphs = 2;
        replacement.paragraph_mutations =
            parse_paragraph_mutations(&replacement_lifecycle, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        replacement.text_mutations =
            parse_text_mutations(&replacement_text, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(replacement, 4).unwrap();
        engine.commit_update(prepared).unwrap();
        let recycled = &engine.planners.get(&4).unwrap().paragraph(3).unwrap().state;
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
    fn a_later_paragraph_failure_rolls_back_every_child_and_lifecycle_change() {
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
        let mut invalid = update(1, 1, 1);
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

    fn validated_codec(technique: TechniqueId) -> ValidatedCodec {
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
                allocation_strategy: ALLOCATION_ORDERED_DIRECT,
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
            text_mutations: super::super::semantic_wire::TextMutationBatch::empty(),
            style_mutations: super::super::semantic_wire::StyleMutationBatch::empty(),
            geometry: super::super::semantic_wire::GeometryBatch::empty(),
        }
    }

    fn root_style_bytes(font_stack_handle: u32) -> Vec<u8> {
        root_style_bytes_inner(font_stack_handle, None)
    }

    fn root_style_bytes_with_direction(font_stack_handle: u32, direction: u8) -> Vec<u8> {
        root_style_bytes_inner(font_stack_handle, Some(direction))
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
