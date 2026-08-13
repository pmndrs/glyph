use alloc::{collections::BTreeMap, vec::Vec};

use crate::{
    STATUS_RESULT_TOO_LARGE, ShapeRangeRef, ShapeRunRef, ShaperRegistry,
    bidi::{BidiAnalysis, BidiError, DIRECTION_AUTO, analyze_into as analyze_bidi_into},
    unicode::{UnicodeAnalysis, UnicodeError},
};

use super::{
    cluster_state::{ClusterArena, ClusterBuildInput},
    flow_composition::{EllipsisReplacement, FlowLayoutArena},
    flow_geometry::FlowGeometryArena,
    font_binding::FontRenderBinding,
    frame::{
        CommittedUpdate, MeasuredParagraph, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
        PreparedUpdate, SessionRevision, UpdateRequest,
    },
    identity_index::IdentityIndex,
    policy::{ALLOCATION_ORDERED_DIRECT, CapabilitySetId, ValidatedPolicy},
    policy_gather::{
        DEFAULT_GATHER_RECORD_CAPACITY, GatherError, LayoutPlanInput, PolicyGatherWorkspace,
        RetainedGather,
    },
    positioning::PositionedGlyphArena,
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
    shaping_state::{BoundaryShape, BoundaryShapeArena, ShapeArena, ShapingRun, ShapingRunArena},
    sort,
    style_state::{
        DEFAULT_STYLE_CAPACITY, MutationKey, ResolutionScope, ResolvedStyleArena, StyleArena,
        StyleInvalidation,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineError {
    InvalidHandle,
    HandleConflict,
    PolicyMissing,
    FontStackMissing,
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
    font_bindings: Vec<RegisteredFontBinding>,
    font_stacks: Vec<RegisteredFontStack>,
    sessions: BTreeMap<u32, EngineSession>,
    gather: PolicyGatherWorkspace,
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

#[derive(Default)]
struct EngineSession {
    revision: SessionRevision,
    acknowledged_publication_generation: u32,
    policy_binding: Option<PolicyBinding>,
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
    text: Vec<u16>,
    pending_text: Vec<u16>,
    text_unit_ids: Vec<u32>,
    pending_text_unit_ids: Vec<u32>,
    pending_text_mirrors_committed: bool,
    next_text_unit_id: u32,
    pending_next_text_unit_id: u32,
    text_prepared: bool,
    text_edit: Option<TextEdit>,
    styles: StyleArena,
    pending_styles: StyleArena,
    resolved_styles: ResolvedStyleArena,
    pending_resolved_styles: ResolvedStyleArena,
    unicode: UnicodeAnalysis,
    pending_unicode: UnicodeAnalysis,
    unicode_reused_for_text_edit: bool,
    bidi: BidiAnalysis,
    pending_bidi: BidiAnalysis,
    shaping_runs: ShapingRunArena,
    pending_shaping_runs: ShapingRunArena,
    shape: ShapeArena,
    pending_shape: ShapeArena,
    incremental_shape_source_run: Option<u32>,
    clusters: ClusterArena,
    pending_clusters: ClusterArena,
    glyph_identity_index: IdentityIndex,
    geometry: FlowGeometryArena,
    pending_geometry: FlowGeometryArena,
    flow_layout: FlowLayoutArena,
    pending_flow_layout: FlowLayoutArena,
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
    positioned: PositionedGlyphArena,
    pending_positioned: PositionedGlyphArena,
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
    styles_prepared: bool,
    style_invalidation: StyleInvalidation,
    unicode_prepared: bool,
    bidi_prepared: bool,
    shaping_runs_prepared: bool,
    shape_prepared: bool,
    clusters_prepared: bool,
    geometry_fingerprint: u64,
    pending_geometry_fingerprint: u64,
    geometry_prepared: bool,
    flow_layout_prepared: bool,
    positioned_prepared: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PolicyBinding {
    handle: u32,
    fingerprint: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GatherCacheKey {
    session_id: u32,
    revision: SessionRevision,
    policy_handle: u32,
    policy_fingerprint: u64,
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
        self.gather
            .reserve_policy(&policy, DEFAULT_GATHER_RECORD_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.policies.insert(handle, policy);
        self.invalidate_gather_cache();
        Ok(())
    }

    pub fn dispose_policy(&mut self, handle: u32) -> Result<(), EngineError> {
        self.policies
            .remove(&handle)
            .ok_or(EngineError::PolicyMissing)?;
        self.invalidate_gather_cache();
        Ok(())
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
        let mut session = EngineSession::default();
        let mut spare = ParagraphState::default();
        spare.initialize()?;
        session.spare_paragraph = Some(spare);
        self.sessions.insert(handle, session);
        Ok(())
    }

    pub fn dispose_session(&mut self, handle: u32) -> Result<(), EngineError> {
        self.sessions
            .remove(&handle)
            .ok_or(EngineError::SessionMissing)?;
        if self
            .gather_cache
            .is_some_and(|cache| cache.session_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.session_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub fn reserve_session_text(&mut self, handle: u32, capacity: u32) -> Result<(), EngineError> {
        let capacity = usize::try_from(capacity).map_err(|_| EngineError::ResultTooLarge)?;
        let session = self
            .sessions
            .get_mut(&handle)
            .ok_or(EngineError::SessionMissing)?;
        if let Some(paragraph) = session.spare_paragraph.as_mut() {
            paragraph.reserve_text(capacity)?;
        }
        Ok(())
    }

    pub(crate) fn session_revision(&self, handle: u32) -> Result<SessionRevision, EngineError> {
        self.sessions
            .get(&handle)
            .map(|session| session.revision)
            .ok_or(EngineError::SessionMissing)
    }

    #[cfg(test)]
    pub(crate) fn session_text(&self, handle: u32) -> Result<&[u16], EngineError> {
        self.sessions
            .get(&handle)
            .and_then(EngineSession::first_paragraph_state)
            .map(|paragraph| paragraph.text.as_slice())
            .ok_or(EngineError::SessionMissing)
    }

    #[cfg(test)]
    pub(crate) fn session_style_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.sessions
            .get(&handle)
            .and_then(EngineSession::first_paragraph_state)
            .map(|paragraph| paragraph.styles.len())
            .ok_or(EngineError::SessionMissing)
    }

    #[cfg(test)]
    pub(crate) fn session_style_segment_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.sessions
            .get(&handle)
            .and_then(EngineSession::first_paragraph_state)
            .map(|paragraph| paragraph.resolved_styles.segments().len())
            .ok_or(EngineError::SessionMissing)
    }

    #[cfg(test)]
    pub(crate) fn session_shaping_run_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.sessions
            .get(&handle)
            .and_then(EngineSession::first_paragraph_state)
            .map(|paragraph| paragraph.shaping_runs.runs().len())
            .ok_or(EngineError::SessionMissing)
    }

    pub fn session_count(&self) -> u32 {
        self.sessions.len().try_into().unwrap_or(u32::MAX)
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

    /// Answers a paragraph-scoped measurement synchronously: validation and speculative
    /// preparation run for the queried paragraph only, no revision advances, no renderer
    /// fence is acknowledged, and no gather or plan compilation happens. The caller
    /// stages the semantic records and must end the query leave-committed through
    /// [`TextEngine::finish_measure`].
    pub(crate) fn measure_paragraph_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
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
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
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
        {
            return Err(EngineError::RevisionConflict);
        }
        // A measure query speculates content and geometry for one paragraph; lifecycle
        // beyond upserting the queried paragraph has no measurable meaning.
        for index in 0..request.paragraph_mutations.len() {
            match request
                .paragraph_mutations
                .get(index)
                .ok_or(EngineError::InvalidRequest)?
            {
                super::semantic_wire::ParagraphMutation::Upsert {
                    paragraph_id: mutated,
                    ..
                } if mutated == paragraph_id => {}
                _ => return Err(EngineError::InvalidRequest),
            }
        }
        let mut next_glyph_id = session.next_glyph_id.max(1);
        let mut next_content_revision = session.next_content_revision.max(1);
        let implicit_paragraph =
            if request.paragraph_mutations.len() == 0 && session.paragraphs.is_empty() {
                request_semantic_paragraph_id(request)?
            } else {
                None
            };
        let preparation = (|| {
            session.semantic_records.clear();
            session.prepare_lifecycle(
                request.paragraph_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
            )?;
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
            let paragraph = session
                .paragraph_mut(paragraph_id)
                .ok_or(EngineError::InvalidRequest)?;
            paragraph.positioned_changed = paragraph.state.prepare(
                Some(&mut *shaper),
                font_stacks,
                font_bindings,
                text,
                styles,
                geometry,
                request.limits,
                &mut next_glyph_id,
                &mut next_content_revision,
            )?;
            if request.semantic_view_mask
                & (super::frame::SEMANTIC_VIEW_MEASUREMENT
                    | super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
                != 0
            {
                let include_layout_inspection = request.semantic_view_mask
                    & super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
                    != 0;
                let mut records = core::mem::take(&mut session.semantic_records);
                let query = append_paragraph_measurement(
                    &mut records,
                    &mut session
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?
                        .state,
                    paragraph_id,
                    Some(&*shaper),
                    font_stacks,
                    font_bindings,
                    request.limits,
                    include_layout_inspection,
                );
                session.semantic_records = records;
                query?;
            }
            Ok(())
        })();
        if let Err(error) = preparation {
            session.abort_pending();
            return Err(error);
        }
        Ok(MeasuredParagraph {
            session_id: request.session_id,
            revision: session.revision,
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
        let cached_gather = self.gather_cache;
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
        let gather = &mut self.gather;
        let gather_cache = &mut self.gather_cache;
        let prepared_gather_cache = &mut self.prepared_gather_cache;
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
        let current_gather_key = GatherCacheKey {
            session_id: request.session_id,
            revision: session.revision,
            policy_handle: request.policy_handle,
            policy_fingerprint,
            capability_set: request.capability_set,
        };
        let next_gather_key = GatherCacheKey {
            revision: next,
            ..current_gather_key
        };
        let checkpoint =
            session.revision.plan == 0 || request.consumed_plan_revision != session.revision.plan;
        // A completed renderer fence is external monotonic state. It remains accepted even if
        // plan preparation or publication later aborts.
        session.acknowledged_publication_generation = request.acknowledged_publication_generation;
        let mut next_glyph_id = session.next_glyph_id.max(1);
        let mut next_content_revision = session.next_content_revision.max(1);
        let implicit_paragraph =
            if request.paragraph_mutations.len() == 0 && session.paragraphs.is_empty() {
                request_semantic_paragraph_id(request)?
            } else {
                None
            };
        let mut gather_output_matches_next = false;
        let preparation = (|| {
            session.semantic_records.clear();
            session.prepare_lifecycle(
                request.paragraph_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
            )?;
            let (mut text_cursor, mut style_cursor) = (0, 0);
            let (mut constraint_cursor, mut inline_object_cursor) = (0, 0);
            for order_index in 0..session.active_order().len() {
                let paragraph_id = session.active_order()[order_index].id;
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
                let paragraph = session
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                paragraph.positioned_changed = paragraph.state.prepare(
                    shaper.as_deref_mut(),
                    font_stacks,
                    font_bindings,
                    text,
                    styles,
                    geometry,
                    request.limits,
                    &mut next_glyph_id,
                    &mut next_content_revision,
                )?;
            }
            if text_cursor != request.text_mutations.len()
                || style_cursor != request.style_mutations.len()
                || constraint_cursor != request.geometry.constraint_count()
                || inline_object_cursor != request.geometry.inline_object_count()
            {
                return Err(EngineError::InvalidRequest);
            }
            let positioned_changed = session.lifecycle_changed
                || session
                    .paragraphs
                    .iter()
                    .any(|paragraph| paragraph.positioned_changed);
            let reuse_ordered_plan = !checkpoint
                && !positioned_changed
                && request.compositing_independent == session.compositing_independent
                && policy
                    .programs()
                    .iter()
                    .all(|program| program.allocation_strategy == ALLOCATION_ORDERED_DIRECT);
            if reuse_ordered_plan {
                session.plan.prepare_reuse().map_err(plan_error)?;
                gather_output_matches_next = cached_gather == Some(current_gather_key);
            } else {
                let record_count =
                    session
                        .active_order()
                        .iter()
                        .try_fold(0usize, |total, ordered| {
                            let paragraph = session
                                .paragraph(ordered.id)
                                .ok_or(EngineError::InvalidRequest)?;
                            let positioned = if paragraph.state.positioned_prepared {
                                &paragraph.state.pending_positioned
                            } else {
                                &paragraph.state.positioned
                            };
                            total
                                .checked_add(positioned.glyphs().len())
                                .ok_or(EngineError::ResultTooLarge)
                        })?;
                *gather_cache = None;
                *prepared_gather_cache = None;
                let capability_set = CapabilitySetId(request.capability_set);
                // Decoration rows bypass the retained gather cursor arithmetic, so a session with
                // any decorated paragraph must rebuild from a reset workspace; entering the
                // retained path and falling back mid-append would stack fresh rows onto the
                // previous update's buffers.
                let attempted_retained =
                    cached_gather == Some(current_gather_key) && !session_has_decorations(session);
                let retained = attempted_retained
                    && gather
                        .begin_retained(policy, record_count)
                        .map_err(gather_error)?;
                if retained {
                    append_session_gather(
                        gather,
                        session,
                        policy,
                        capability_set,
                        font_bindings,
                        true,
                        checkpoint,
                    )?;
                }
                if !retained {
                    gather.begin(policy, record_count).map_err(gather_error)?;
                    append_session_gather(
                        gather,
                        session,
                        policy,
                        capability_set,
                        font_bindings,
                        false,
                        checkpoint,
                    )?;
                }
                let gathered = gather.view();
                let mut plan_input = gathered.plan_input();
                plan_input.order_independent = request.compositing_independent;
                session
                    .plan
                    .prepare(
                        policy,
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
                let mut records = core::mem::take(&mut session.semantic_records);
                let query = (|| {
                    for order_index in 0..session.active_order().len() {
                        let paragraph_id = session.active_order()[order_index].id;
                        let paragraph = session
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
                        )?;
                    }
                    Ok(())
                })();
                session.semantic_records = records;
                query?;
            }
            session.pending_next_glyph_id = next_glyph_id;
            session.pending_next_content_revision = next_content_revision;
            session.pending_compositing_independent = request.compositing_independent;
            Ok(())
        })();
        if let Err(error) = preparation {
            session.abort_pending();
            return Err(error);
        }
        if gather_output_matches_next {
            *prepared_gather_cache = Some(next_gather_key);
        }
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

    pub(crate) fn prepared_semantic_views(
        &self,
        prepared: PreparedUpdate,
    ) -> Result<&[super::semantic_view::SemanticRecord], EngineError> {
        let session = self
            .sessions
            .get(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&session.semantic_records)
    }

    pub(crate) fn measured_semantic_views(
        &self,
        measured: MeasuredParagraph,
    ) -> Result<&[super::semantic_view::SemanticRecord], EngineError> {
        let session = self
            .sessions
            .get(&measured.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != measured.revision {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&session.semantic_records)
    }

    /// Ends a measure query leave-committed: speculative pending state is dropped while
    /// committed arenas, revisions, fences, and identity counters stay exactly as they
    /// were before the query.
    pub(crate) fn finish_measure(&mut self, measured: MeasuredParagraph) -> Result<(), EngineError> {
        let session = self
            .sessions
            .get_mut(&measured.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != measured.revision {
            return Err(EngineError::RevisionConflict);
        }
        session.abort_pending();
        Ok(())
    }

    pub(crate) fn abort_update(&mut self, prepared: PreparedUpdate) -> Result<(), EngineError> {
        let next_gather_key = prepared_gather_key(prepared, prepared.next);
        let session = self
            .sessions
            .get_mut(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session.abort_pending();
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
        let session = self
            .sessions
            .get_mut(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session.plan.commit().map_err(plan_error)?;
        session.commit_paragraphs();
        session.next_glyph_id = session.pending_next_glyph_id;
        session.next_content_revision = session.pending_next_content_revision;
        session.pending_next_glyph_id = 0;
        session.pending_next_content_revision = 0;
        session.compositing_independent = session.pending_compositing_independent;
        session.policy_binding = Some(PolicyBinding {
            handle: prepared.policy_handle,
            fingerprint: prepared.policy_fingerprint,
        });
        session.revision = prepared.next;
        if self.prepared_gather_cache == Some(next_gather_key) {
            self.gather_cache = Some(next_gather_key);
            self.prepared_gather_cache = None;
        } else if self.gather_cache == Some(previous_gather_key) {
            self.gather_cache = Some(next_gather_key);
        }
        Ok(CommittedUpdate {
            session_id: prepared.session_id,
            revision: prepared.next,
            required_base_revision: prepared.required_base_revision,
            checkpoint: prepared.checkpoint,
        })
    }
}

fn prepared_gather_key(prepared: PreparedUpdate, revision: SessionRevision) -> GatherCacheKey {
    GatherCacheKey {
        session_id: prepared.session_id,
        revision,
        policy_handle: prepared.policy_handle,
        policy_fingerprint: prepared.policy_fingerprint,
        capability_set: prepared.capability_set,
    }
}

/// Whether any live paragraph carries decoration records, using pending state when prepared —
/// the same view `append_session_gather` reads.
fn session_has_decorations(session: &EngineSession) -> bool {
    session.active_order().iter().any(|ordered| {
        session.paragraph(ordered.id).is_some_and(|paragraph| {
            let positioned = if paragraph.state.positioned_prepared {
                &paragraph.state.pending_positioned
            } else {
                &paragraph.state.positioned
            };
            !positioned.decorations().is_empty()
        })
    })
}

/// Emits the measurement (and optional layout-inspection) semantic records for one
/// paragraph, preparing intrinsic layouts on demand. Every stage reads pending state
/// when prepared and committed state otherwise, so the same emission serves the full
/// update path and the paragraph-scoped measure query.
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
        let clusters = if state.clusters_prepared {
            &state.pending_clusters
        } else {
            &state.clusters
        };
        let geometry = if state.geometry_prepared {
            &state.pending_geometry
        } else {
            &state.geometry
        };
        let flow = if state.flow_layout_prepared {
            &state.pending_flow_layout
        } else {
            &state.flow_layout
        };
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
    let active_flow = if state.flow_layout_prepared {
        &state.pending_flow_layout
    } else {
        &state.flow_layout
    };
    let active_line_count = active_flow.lines.len();
    let has_ellipsis = !active_flow.ellipsis_threads().is_empty();
    let cluster_count = if state.clusters_prepared {
        state.pending_clusters.starts.len()
    } else {
        state.clusters.starts.len()
    };
    let constraint = if state.geometry_prepared {
        state.pending_geometry.constraints.first()
    } else {
        state.geometry.constraints.first()
    }
    .copied()
    .ok_or(EngineError::InvalidRequest)?;
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
    let text = if state.text_prepared {
        &state.pending_text
    } else {
        &state.text
    };
    let clusters = if state.clusters_prepared {
        &state.pending_clusters
    } else {
        &state.clusters
    };
    let geometry = if state.geometry_prepared {
        &state.pending_geometry
    } else {
        &state.geometry
    };
    let active_flow = if state.flow_layout_prepared {
        &state.pending_flow_layout
    } else {
        &state.flow_layout
    };
    let active_positioned = if state.positioned_prepared {
        &state.pending_positioned
    } else {
        &state.positioned
    };
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
    let (line_glyph_starts, line_glyph_counts) = positioned.semantic_line_glyph_spans();
    super::layout_query::append_measurement(
        records,
        paragraph_id,
        text.len(),
        clusters.starts.len(),
        geometry,
        flow,
        positioned.semantic_glyphs(),
        line_glyph_starts,
        line_glyph_counts,
        Some(positioned.semantic_line_inline_extents()),
        clusters,
        intrinsic_extents,
        include_layout_inspection,
    )
}

fn append_session_gather(
    gather: &mut PolicyGatherWorkspace,
    session: &EngineSession,
    policy: &ValidatedPolicy,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
    retained: bool,
    checkpoint: bool,
) -> Result<(), EngineError> {
    let incremental = retained;
    let mut retaining = retained;
    for ordered in session.active_order() {
        let paragraph = session
            .paragraph(ordered.id)
            .ok_or(EngineError::InvalidRequest)?;
        let positioned = if paragraph.state.positioned_prepared {
            &paragraph.state.pending_positioned
        } else {
            &paragraph.state.positioned
        };
        let semantic_f32 = positioned.semantic_f32();
        let semantic_u32 = positioned.semantic_u32();
        let semantic_change_masks = if retaining && !paragraph.positioned_changed {
            &[][..]
        } else {
            positioned.semantic_change_masks()
        };
        let input = LayoutPlanInput {
            transform_id: ordered.id,
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
                policy,
                capability_set,
                positioned.decorations(),
                ordered.id,
                session.revision.engine.max(1),
                super::policy_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        if retaining {
            match gather
                .append_retained(policy, capability_set, input, binding_for_font)
                .map_err(gather_error)?
            {
                RetainedGather::Complete => {}
                RetainedGather::RebuildFrom(source_start) => {
                    gather.truncate_to_retained_prefix();
                    gather
                        .append_from(
                            policy,
                            capability_set,
                            input,
                            source_start,
                            true,
                            binding_for_font,
                        )
                        .map_err(gather_error)?;
                    retaining = false;
                }
            }
        } else {
            gather
                .append(
                    policy,
                    capability_set,
                    input,
                    incremental || checkpoint || !paragraph.positioned_changed,
                    binding_for_font,
                )
                .map_err(gather_error)?;
        }
        gather
            .append_decorations(
                policy,
                capability_set,
                positioned.decorations(),
                ordered.id,
                session.revision.engine.max(1),
                super::policy_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
    }
    if retaining && !gather.finish_retained() {
        gather.truncate_to_retained_prefix();
    }
    Ok(())
}

impl EngineSession {
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
                    } => self.prepare_upsert(paragraph_id, order)?,
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
                self.prepare_upsert(paragraph_id, 0)?;
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

    fn prepare_upsert(&mut self, id: u32, order: u32) -> Result<(), EngineError> {
        match self
            .paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
        {
            Ok(index) => {
                self.paragraphs[index].pending_order = Some(order);
                Ok(())
            }
            Err(index) => {
                let state = if let Some(spare) = self.spare_paragraph.take() {
                    let mut spare = spare;
                    spare.reset_for_reuse();
                    spare
                } else {
                    let mut state = ParagraphState::default();
                    state.initialize()?;
                    state
                };
                self.paragraphs.insert(
                    index,
                    RetainedParagraph {
                        id,
                        order,
                        pending_order: Some(order),
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
        self.text.clear();
        self.pending_text.clear();
        self.text_unit_ids.clear();
        self.pending_text_unit_ids.clear();
        self.pending_text_mirrors_committed = true;
        self.next_text_unit_id = 0;
        self.pending_next_text_unit_id = 0;
        self.text_prepared = false;
        self.text_edit = None;
        self.styles.clear();
        self.pending_styles.clear();
        self.resolved_styles.clear();
        self.pending_resolved_styles.clear();
        self.unicode.clear();
        self.pending_unicode.clear();
        self.unicode_reused_for_text_edit = false;
        self.bidi.clear();
        self.pending_bidi.clear();
        self.shaping_runs.clear();
        self.pending_shaping_runs.clear();
        self.shape.clear();
        self.pending_shape.clear();
        self.incremental_shape_source_run = None;
        self.clusters.clear();
        self.pending_clusters.clear();
        self.geometry.clear();
        self.pending_geometry.clear();
        self.flow_layout.clear();
        self.pending_flow_layout.clear();
        self.intrinsic_geometry_scratch.clear();
        self.intrinsic_flow_layout_scratch.clear();
        self.intrinsic_positioned_scratch.clear();
        self.boundary_shape.clear();
        self.pending_boundary_shape.clear();
        self.boundary_shape_scratch.clear();
        self.ellipsis_shape_scratch.clear();
        self.ellipsis_text_scratch.clear();
        self.positioned.clear();
        self.pending_positioned.clear();
        self.fallback_spans.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles_prepared = false;
        self.style_invalidation = StyleInvalidation::default();
        self.unicode_prepared = false;
        self.bidi_prepared = false;
        self.shaping_runs_prepared = false;
        self.shape_prepared = false;
        self.clusters_prepared = false;
        self.geometry_fingerprint = 0;
        self.pending_geometry_fingerprint = 0;
        self.geometry_prepared = false;
        self.flow_layout_prepared = false;
        self.positioned_prepared = false;
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
        self.prepare_geometry(geometry)?;
        let flow_changed =
            self.clusters_prepared || self.geometry_prepared || self.style_invalidation.metrics;
        let positioned_changed = flow_changed || self.style_invalidation.positioning;
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
            }
            if positioned_changed {
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
    }

    fn initialize(&mut self) -> Result<(), EngineError> {
        self.styles.reserve_default()?;
        self.pending_styles.reserve_default()?;
        self.resolved_styles.reserve_default()?;
        self.pending_resolved_styles.reserve_default()?;
        reserve_vec(&mut self.style_mutation_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_order_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_sort_pair_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_nesting_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_resolution_scratch, DEFAULT_STYLE_CAPACITY)
    }

    fn reserve_text(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve_text_buffer(&mut self.text, capacity)?;
        reserve_text_buffer(&mut self.pending_text, capacity)?;
        reserve_vec(&mut self.text_unit_ids, capacity)?;
        reserve_vec(&mut self.pending_text_unit_ids, capacity)?;
        self.unicode.reserve(capacity).map_err(unicode_error)?;
        self.pending_unicode
            .reserve(capacity)
            .map_err(unicode_error)?;
        self.bidi.reserve(capacity).map_err(bidi_error)?;
        self.pending_bidi.reserve(capacity).map_err(bidi_error)?;
        self.shaping_runs.reserve(capacity)?;
        self.pending_shaping_runs.reserve(capacity)?;
        let glyph_capacity = capacity.saturating_mul(2);
        self.shape.reserve(glyph_capacity)?;
        self.pending_shape.reserve(glyph_capacity)?;
        self.clusters.reserve(capacity)?;
        self.pending_clusters.reserve(capacity)?;
        self.flow_layout.reserve(capacity, 1)?;
        self.pending_flow_layout.reserve(capacity, 1)?;
        self.intrinsic_flow_layout_scratch.reserve(capacity, 1)?;
        self.boundary_shape.reserve(capacity.min(64))?;
        self.pending_boundary_shape.reserve(capacity.min(64))?;
        self.boundary_shape_scratch.reserve(glyph_capacity)?;
        self.ellipsis_shape_scratch.reserve(4)?;
        if self.ellipsis_text_scratch.capacity() == 0 {
            self.ellipsis_text_scratch
                .try_reserve_exact(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
        }
        self.positioned.reserve(glyph_capacity)?;
        self.pending_positioned.reserve(glyph_capacity)?;
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
            if self.pending_text.try_reserve(self.text.len()).is_err() {
                return Err(EngineError::ResultTooLarge);
            }
            if self
                .pending_text_unit_ids
                .try_reserve(self.text_unit_ids.len())
                .is_err()
            {
                return Err(EngineError::ResultTooLarge);
            }
            self.pending_text.clear();
            self.pending_text.extend_from_slice(&self.text);
            self.pending_text_unit_ids.clear();
            self.pending_text_unit_ids
                .extend_from_slice(&self.text_unit_ids);
            self.pending_text_mirrors_committed = true;
        }
        self.pending_next_text_unit_id = self.next_text_unit_id.max(1);
        self.text_prepared = true;
        self.pending_text_mirrors_committed = false;
        for index in 0..mutations.len() {
            let Some(mutation) = mutations.get(index) else {
                self.abort_text();
                return Err(EngineError::InvalidRequest);
            };
            if let Err(error) = apply_text_mutation(&mut self.pending_text, mutation) {
                self.abort_text();
                return Err(match error {
                    TextMutationError::Invalid => EngineError::InvalidRequest,
                    TextMutationError::Allocation => EngineError::ResultTooLarge,
                });
            }
            if let Err(error) = apply_text_identity_mutation(
                &mut self.pending_text_unit_ids,
                &mut self.pending_next_text_unit_id,
                mutation,
            ) {
                self.abort_text();
                return Err(error);
            }
        }
        if self.pending_text.len() != self.pending_text_unit_ids.len() {
            self.abort_text();
            return Err(EngineError::InvalidRequest);
        }
        self.text_edit = changed_identity_range(&self.text_unit_ids, &self.pending_text_unit_ids);
        Ok(())
    }

    fn abort_text(&mut self) {
        if self.text_prepared {
            self.pending_text.clear();
            self.pending_text.extend_from_slice(&self.text);
            self.pending_text_unit_ids.clear();
            self.pending_text_unit_ids
                .extend_from_slice(&self.text_unit_ids);
            self.pending_text_mirrors_committed = true;
        }
        self.clear_text_preparation();
    }

    fn clear_text_preparation(&mut self) {
        self.pending_next_text_unit_id = 0;
        self.text_prepared = false;
        self.text_edit = None;
    }

    fn prepare_styles(
        &mut self,
        mutations: super::semantic_wire::StyleMutationBatch<'_>,
        font_stack_exists: impl FnMut(u32) -> bool,
    ) -> Result<(), EngineError> {
        self.abort_styles();
        if mutations.len() == 0 {
            if !self.text_prepared || self.styles.len() == 0 {
                return Ok(());
            }
            return self.styles.validate(
                self.pending_text.as_slice(),
                font_stack_exists,
                &mut self.style_order_scratch,
                &mut self.style_nesting_scratch,
                &mut self.sort_pair_scratch,
                &mut self.style_sort_pair_scratch,
            );
        }
        self.pending_styles.prepare_from(
            &self.styles,
            mutations,
            &mut self.style_mutation_scratch,
            &mut self.sort_pair_scratch,
        )?;
        if self.styles.len() != 0 && self.pending_styles.len() == 0 {
            self.abort_styles();
            return Err(EngineError::InvalidRequest);
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        if let Err(error) = self.pending_styles.validate(
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
        if let Err(error) = self.pending_styles.resolve(
            &self.style_order_scratch,
            &mut self.pending_resolved_styles,
            &mut self.style_resolution_scratch,
        ) {
            self.abort_styles();
            return Err(error);
        }
        self.style_invalidation = self.resolved_styles.invalidation_against(
            &self.styles,
            &self.pending_resolved_styles,
            &self.pending_styles,
        );
        self.styles_prepared = true;
        Ok(())
    }

    fn abort_styles(&mut self) {
        self.pending_styles.clear();
        self.pending_resolved_styles.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles_prepared = false;
        self.style_invalidation = StyleInvalidation::default();
    }

    fn commit_styles(&mut self) {
        if self.styles_prepared {
            core::mem::swap(&mut self.styles, &mut self.pending_styles);
            core::mem::swap(&mut self.resolved_styles, &mut self.pending_resolved_styles);
        }
        self.abort_styles();
    }

    fn commit_text(&mut self) {
        if self.text_prepared {
            let retains_mirror = self.pending_text.len() == self.text.len();
            let edit = self.text_edit;
            core::mem::swap(&mut self.text, &mut self.pending_text);
            core::mem::swap(&mut self.text_unit_ids, &mut self.pending_text_unit_ids);
            self.next_text_unit_id = self.pending_next_text_unit_id;
            if retains_mirror {
                if let Some(edit) = edit {
                    self.pending_text[edit.old_start..edit.new_end]
                        .copy_from_slice(&self.text[edit.old_start..edit.new_end]);
                    self.pending_text_unit_ids[edit.old_start..edit.new_end]
                        .copy_from_slice(&self.text_unit_ids[edit.old_start..edit.new_end]);
                }
                self.pending_text_mirrors_committed = true;
            } else {
                self.pending_text.clear();
                self.pending_text_unit_ids.clear();
                self.pending_text_mirrors_committed = false;
            }
        }
        self.clear_text_preparation();
    }

    fn prepare_unicode(&mut self) -> Result<(), EngineError> {
        self.abort_unicode();
        if !self.text_prepared {
            return Ok(());
        }
        if let Some(edit) = self.text_edit
            && self.unicode.reusable_for_ascii_letter_edit(
                &self.text,
                &self.pending_text,
                edit.old_start,
                edit.old_end,
                edit.new_end,
            )
        {
            self.unicode_reused_for_text_edit = true;
            return Ok(());
        }
        self.pending_unicode
            .analyze(&self.pending_text)
            .map_err(unicode_error)?;
        self.unicode_prepared = true;
        Ok(())
    }

    fn abort_unicode(&mut self) {
        self.unicode_prepared = false;
        self.unicode_reused_for_text_edit = false;
    }

    fn commit_unicode(&mut self) {
        if self.unicode_prepared {
            core::mem::swap(&mut self.unicode, &mut self.pending_unicode);
        }
        self.abort_unicode();
    }

    fn prepare_bidi(&mut self) -> Result<(), EngineError> {
        self.abort_bidi();
        if self.unicode_reused_for_text_edit && !self.style_invalidation.bidi {
            return Ok(());
        }
        if !self.text_prepared && !self.style_invalidation.bidi {
            return Ok(());
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let styles = if self.styles_prepared {
            &self.pending_resolved_styles
        } else {
            &self.resolved_styles
        };
        let direction = styles
            .segments()
            .first()
            .map_or(DIRECTION_AUTO, |segment| segment.style.direction);
        analyze_bidi_into(text, direction, &mut self.pending_bidi).map_err(bidi_error)?;
        self.bidi_prepared = true;
        Ok(())
    }

    fn abort_bidi(&mut self) {
        self.bidi_prepared = false;
    }

    fn commit_bidi(&mut self) {
        if self.bidi_prepared {
            core::mem::swap(&mut self.bidi, &mut self.pending_bidi);
        }
        self.abort_bidi();
    }

    fn prepare_shaping_runs(&mut self) -> Result<(), EngineError> {
        self.abort_shaping_runs();
        if !self.text_prepared
            && !self.style_invalidation.shaping
            && !self.style_invalidation.metrics
            && !self.bidi_prepared
        {
            return Ok(());
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
        let style_storage = if self.styles_prepared {
            &self.pending_styles
        } else {
            &self.styles
        };
        let unicode = if self.unicode_prepared {
            &self.pending_unicode
        } else {
            &self.unicode
        };
        let bidi = if self.bidi_prepared {
            &self.pending_bidi
        } else {
            &self.bidi
        };
        self.pending_shaping_runs
            .build(text, styles, style_storage, unicode, bidi)?;
        self.shaping_runs_prepared = true;
        Ok(())
    }

    fn abort_shaping_runs(&mut self) {
        self.pending_shaping_runs.clear();
        self.shaping_runs_prepared = false;
    }

    fn commit_shaping_runs(&mut self) {
        if self.shaping_runs_prepared {
            core::mem::swap(&mut self.shaping_runs, &mut self.pending_shaping_runs);
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
        if !self.shaping_runs_prepared
            || (!self.text_prepared && !self.style_invalidation.shaping && !self.bidi_prepared)
        {
            return Ok(());
        }
        if self.try_prepare_incremental_shape(shaper)? {
            self.shape_prepared = true;
            return Ok(());
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        if text.is_empty() {
            self.shape_prepared = true;
            return Ok(());
        }
        let styles = if self.styles_prepared {
            &self.pending_styles
        } else {
            &self.styles
        };
        let runs = self.pending_shaping_runs.runs();
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
            self.pending_shape.clear();
            for span in self.pending_fallback_spans.iter().copied() {
                let source_index =
                    usize::try_from(span.source_run).map_err(|_| EngineError::InvalidRequest)?;
                let run = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
                let output = &mut self.pending_shape;
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
                &self.pending_shape,
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
                self.shape_prepared = true;
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
        let old_runs = self.shaping_runs.runs();
        let new_runs = self.pending_shaping_runs.runs();
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
            .runs
            .iter()
            .filter(|run| run.source_run == affected_source_run)
            .count()
            != 1
        {
            return Ok(false);
        }
        let delta = edit_delta(edit)?;
        let styles = if self.styles_prepared {
            &self.pending_styles
        } else {
            &self.styles
        };
        self.boundary_shape_scratch.clear();
        let scratch = &mut self.boundary_shape_scratch;
        shaper
            .with_shaped_run(
                fallback.font_handle,
                &self.pending_text,
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
        for (shape_run_index, shaped_run) in self.shape.runs.iter().copied().enumerate() {
            if shaped_run.source_run == affected_source_run {
                self.pending_shape.append_text_range_from(
                    &self.boundary_shape_scratch,
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
            self.pending_shape.append_text_range_from(
                &self.shape,
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
        self.pending_shape.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.incremental_shape_source_run = None;
        self.shape_prepared = false;
    }

    fn commit_shape(&mut self) {
        if self.shape_prepared {
            core::mem::swap(&mut self.shape, &mut self.pending_shape);
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
        if !self.shape_prepared && !self.style_invalidation.metrics {
            return Ok(());
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let text_unit_ids = if self.text_prepared {
            self.pending_text_unit_ids.as_slice()
        } else {
            self.text_unit_ids.as_slice()
        };
        let unicode = if self.unicode_prepared {
            &self.pending_unicode
        } else {
            &self.unicode
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
        let runs = if self.shaping_runs_prepared {
            self.pending_shaping_runs.runs()
        } else {
            self.shaping_runs.runs()
        };
        if runs.is_empty() {
            self.pending_clusters.clear();
            self.clusters_prepared = true;
            return Ok(());
        }
        let shape = if self.shape_prepared {
            &self.pending_shape
        } else {
            &self.shape
        };
        let build_input = || ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        };
        if let Some(source_run) = self.incremental_shape_source_run
            && let Some((cluster_start, cluster_end)) = self
                .pending_clusters
                .rebuild_source_run_if_topology_is_stable(
                    &self.clusters,
                    build_input(),
                    source_run,
                    |handle| shaper.font_metrics(handle),
                )?
        {
            if let Err(error) = self.pending_clusters.assign_stable_glyph_ids_in_range(
                &self.clusters,
                cluster_start,
                cluster_end,
                &mut self.glyph_identity_index,
                next_glyph_id,
            ) {
                self.abort_clusters();
                return Err(error);
            }
            self.clusters_prepared = true;
            return Ok(());
        }
        self.pending_clusters
            .build(build_input(), |handle| shaper.font_metrics(handle))?;
        if let Err(error) = self.pending_clusters.assign_stable_glyph_ids(
            &self.clusters,
            &mut self.glyph_identity_index,
            next_glyph_id,
        ) {
            self.abort_clusters();
            return Err(error);
        }
        self.clusters_prepared = true;
        Ok(())
    }

    fn abort_clusters(&mut self) {
        self.pending_clusters.clear();
        self.clusters_prepared = false;
    }

    fn commit_clusters(&mut self) {
        if self.clusters_prepared {
            core::mem::swap(&mut self.clusters, &mut self.pending_clusters);
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
        let text_length = if self.text_prepared {
            self.pending_text.len()
        } else {
            self.text.len()
        };
        geometry
            .validate_text_length(text_length)
            .map_err(|_| EngineError::InvalidRequest)?;
        self.pending_geometry.build(geometry)?;
        self.pending_geometry_fingerprint = geometry.fingerprint();
        if geometry.inline_object_count() == 0 && self.pending_geometry == self.geometry {
            self.pending_geometry.clear();
            self.pending_geometry_fingerprint = 0;
            return Ok(());
        }
        self.geometry_prepared = true;
        Ok(())
    }

    fn abort_geometry(&mut self) {
        self.pending_geometry.clear();
        self.pending_geometry_fingerprint = 0;
        self.geometry_prepared = false;
    }

    fn commit_geometry(&mut self) {
        if self.geometry_prepared {
            self.geometry_fingerprint = self.pending_geometry_fingerprint;
            core::mem::swap(&mut self.geometry, &mut self.pending_geometry);
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
        self.pending_boundary_shape.clear();
        let clusters = if self.clusters_prepared {
            &self.pending_clusters
        } else {
            &self.clusters
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
        let style_storage = if self.styles_prepared {
            &self.pending_styles
        } else {
            &self.styles
        };
        let runs = if self.shaping_runs_prepared {
            self.pending_shaping_runs.runs()
        } else {
            self.shaping_runs.runs()
        };
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let geometry = if self.geometry_prepared {
            &self.pending_geometry
        } else {
            &self.geometry
        };
        let max_slots_per_band =
            usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?;
        let max_lines = usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?;
        if !self.geometry_prepared
            && !self.style_invalidation.metrics
            && self.boundary_shape.records.is_empty()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && let Some(edit) = self.text_edit
            && edit.old_end.saturating_sub(edit.old_start)
                == edit.new_end.saturating_sub(edit.old_start)
            && self.pending_flow_layout.rebuild_until_state_converges(
                &self.flow_layout,
                geometry,
                &self.clusters,
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
        {
            self.flow_layout_prepared = true;
            return Ok(());
        }
        self.pending_flow_layout.build(
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
        while ellipsis_index < self.pending_flow_layout.ellipsis_threads().len() {
            let flow_thread_id = self.pending_flow_layout.ellipsis_threads()[ellipsis_index];
            let line = self
                .pending_flow_layout
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
                .pending_flow_layout
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
                .pending_flow_layout
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
            self.pending_flow_layout.fragments[fragment_index].boundary_index = boundary_index;
            ellipsis_index += 1;
        }
        self.flow_layout_prepared = true;
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
        let source_geometry = if self.geometry_prepared {
            &self.pending_geometry
        } else {
            &self.geometry
        };
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

        let clusters = if self.clusters_prepared {
            &self.pending_clusters
        } else {
            &self.clusters
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
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
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let clusters = if self.clusters_prepared {
            &self.pending_clusters
        } else {
            &self.clusters
        };
        let runs = if self.shaping_runs_prepared {
            self.pending_shaping_runs.runs()
        } else {
            self.shaping_runs.runs()
        };
        let shape = if self.shape_prepared {
            &self.pending_shape
        } else {
            &self.shape
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
        let bidi = if self.bidi_prepared {
            &self.pending_bidi
        } else {
            &self.bidi
        };
        let previous = if self.positioned_prepared {
            &self.pending_positioned
        } else {
            &self.positioned
        };
        let mut next_content_revision = 1;
        let geometry = &self.intrinsic_geometry_scratch;
        self.intrinsic_positioned_scratch.build(
            previous,
            &self.intrinsic_flow_layout_scratch,
            text,
            clusters,
            runs,
            shape,
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
        self.pending_flow_layout.clear();
        self.pending_boundary_shape.clear();
        self.flow_layout_prepared = false;
    }

    fn commit_flow_layout(&mut self) {
        if self.flow_layout_prepared {
            core::mem::swap(&mut self.flow_layout, &mut self.pending_flow_layout);
            core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
        }
        self.abort_flow_layout();
    }

    fn prepare_positioned(
        &mut self,
        shaper: &ShaperRegistry,
        next_content_revision: &mut u32,
    ) -> Result<(), EngineError> {
        self.abort_positioned();
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
        let clusters = if self.clusters_prepared {
            &self.pending_clusters
        } else {
            &self.clusters
        };
        let runs = if self.shaping_runs_prepared {
            self.pending_shaping_runs.runs()
        } else {
            self.shaping_runs.runs()
        };
        let shape = if self.shape_prepared {
            &self.pending_shape
        } else {
            &self.shape
        };
        let styles = if self.styles_prepared {
            self.pending_resolved_styles.segments()
        } else {
            self.resolved_styles.segments()
        };
        let bidi = if self.bidi_prepared {
            &self.pending_bidi
        } else {
            &self.bidi
        };
        let flow = if self.flow_layout_prepared {
            &self.pending_flow_layout
        } else {
            &self.flow_layout
        };
        let boundary_shape = if self.flow_layout_prepared {
            &self.pending_boundary_shape
        } else {
            &self.boundary_shape
        };
        let geometry = if self.geometry_prepared {
            &self.pending_geometry
        } else {
            &self.geometry
        };
        self.pending_positioned.build(
            &self.positioned,
            flow,
            text,
            clusters,
            runs,
            shape,
            boundary_shape,
            styles,
            bidi,
            &mut self.glyph_identity_index,
            next_content_revision,
            |thread| thread_typography(geometry, thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )?;
        self.positioned_prepared = true;
        Ok(())
    }

    fn abort_positioned(&mut self) {
        self.pending_positioned.clear();
        self.positioned_prepared = false;
    }

    fn commit_positioned(&mut self) {
        if self.positioned_prepared {
            core::mem::swap(&mut self.positioned, &mut self.pending_positioned);
        }
        self.abort_positioned();
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
            font_binding::{
                FieldTable, FontRenderBinding, FontResource, FontStrike, MISSING_RESOURCE_INDEX,
            },
            frame::{
                PARAGRAPH_MUTATION_REMOVE, PARAGRAPH_MUTATION_UPSERT, STYLE_FIELD_DIRECTION,
                STYLE_FIELD_FONT_SIZE, STYLE_FIELD_FONT_STACK, STYLE_FIELD_LINE_HEIGHT,
                STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE,
                STYLE_MUTATION_UPSERT, TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16,
            },
            policy::{
                ALLOCATION_ORDERED_DIRECT, BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE,
                BATCH_TECHNIQUE, BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId,
                BufferSchema, CAP_ORDERED_DIRECT, CapabilitySet, Operation, PolicyDescriptor,
                ProgramCapabilities, ProgramDescriptor, ProgramId, ScalarType, TechniqueId,
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
            Some(SessionRevision { engine: 2, plan: 2 })
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
        request.capability_set = 3;
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
    fn a_committed_session_accepts_another_capability_set_from_the_same_policy() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
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
        assert!(engine.prepared_gather_cache.is_some());
        engine.abort_update(prepared).unwrap();
        assert!(engine.gather_cache.is_none());
        assert!(engine.prepared_gather_cache.is_none());
        assert_eq!(
            engine.session_revision(4).unwrap(),
            SessionRevision::default()
        );
        let retry = engine.prepare_update(update(0, 0, 0), 1).unwrap();
        engine.commit_update(retry).unwrap();
    }

    #[test]
    fn ordered_utf16_replacements_commit_and_abort_with_the_session_transaction() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        engine.reserve_session_text(4, 8).unwrap();

        let initial_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let initial_batch =
            parse_text_mutations(&initial_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut initial = update(0, 0, 0);
        initial.text_mutations = initial_batch;
        let prepared = engine.prepare_update(initial, 1).unwrap();
        assert!(engine.session_text(4).unwrap().is_empty());
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.session_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        assert_eq!(
            engine
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text_unit_ids,
            [1, 2, 3, 4]
        );
        assert_eq!(
            engine
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .unicode
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
        assert_eq!(engine.session_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);
        let session = engine.sessions.get(&4).unwrap();
        let paragraph = session.first_paragraph_state().unwrap();
        assert_eq!(paragraph.text_unit_ids, [1, 2, 3, 4]);
        assert_eq!(paragraph.next_text_unit_id, 5);

        let retry = engine.prepare_update(edit, 2).unwrap();
        engine.commit_update(retry).unwrap();
        assert_eq!(
            engine.session_text(4).unwrap(),
            &[0x61, 0x58, 0x59, 0x63, 0x64, 0x21]
        );
        assert_eq!(
            engine
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .text_unit_ids,
            [1, 5, 6, 3, 4, 7]
        );

        let settled_capacities = {
            let session = engine.sessions.get(&4).unwrap();
            let paragraph = session.first_paragraph_state().unwrap();
            [paragraph.text.capacity(), paragraph.pending_text.capacity()]
        };
        let warm_bytes = text_mutation_bytes(&[(0, 1, &[0x7a])]);
        let warm_batch =
            parse_text_mutations(&warm_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut warm = update(2, 2, 2);
        warm.text_mutations = warm_batch;
        let prepared = engine.prepare_update(warm, 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let session = engine.sessions.get(&4).unwrap();
        let paragraph = session.first_paragraph_state().unwrap();
        assert_eq!(paragraph.text_unit_ids, [8, 5, 6, 3, 4, 7]);
        assert!(paragraph.pending_text_mirrors_committed);
        assert_eq!(paragraph.pending_text, paragraph.text);
        assert_eq!(paragraph.pending_text_unit_ids, paragraph.text_unit_ids);
        assert_eq!(
            [paragraph.pending_text.capacity(), paragraph.text.capacity(),],
            settled_capacities
        );
    }

    #[test]
    fn invalid_utf16_aborts_text_and_unicode_analysis_together() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();

        let invalid_bytes = text_mutation_bytes(&[(0, 0, &[0xd800])]);
        let mut invalid = update(0, 0, 0);
        invalid.text_mutations =
            parse_text_mutations(&invalid_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(invalid, 1),
            Err(EngineError::InvalidRequest)
        );
        let session = engine.sessions.get(&4).unwrap();
        let paragraph = session.first_paragraph_state().unwrap();
        assert!(paragraph.text.is_empty());
        assert!(paragraph.unicode.grapheme_boundaries().is_empty());
        assert!(paragraph.bidi.levels.is_empty());
    }

    #[test]
    fn ascii_text_reuse_does_not_suppress_an_independent_bidi_invalidation() {
        let mut paragraph = ParagraphState::default();
        paragraph.text = "abc".encode_utf16().collect();
        paragraph.pending_text = "axc".encode_utf16().collect();
        paragraph.text_prepared = true;
        paragraph.text_edit = Some(TextEdit {
            old_start: 1,
            old_end: 2,
            new_end: 2,
        });
        paragraph.style_invalidation.bidi = true;
        paragraph.unicode.analyze(&paragraph.text).unwrap();

        paragraph.prepare_unicode().unwrap();
        assert!(paragraph.unicode_reused_for_text_edit);
        paragraph.prepare_bidi().unwrap();
        assert!(paragraph.bidi_prepared);
        assert_eq!(paragraph.pending_bidi.paragraph_levels, [0]);
    }

    #[test]
    fn root_direction_reanalyzes_bidi_without_a_text_mutation() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_session(4).unwrap();

        let text_bytes = text_mutation_bytes(&[(0, 0, &[0x61, 0x62, 0x63, 0x64])]);
        let mut text = update(0, 0, 0);
        text.text_mutations =
            parse_text_mutations(&text_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(text, 1).unwrap();
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
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
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
                .paragraph_levels,
            &[0]
        );
        engine.commit_update(prepared).unwrap();
        assert_eq!(
            engine
                .sessions
                .get(&4)
                .unwrap()
                .first_paragraph_state()
                .unwrap()
                .bidi
                .paragraph_levels,
            &[1]
        );
    }

    #[test]
    fn retained_style_upserts_commit_and_root_removal_aborts_transactionally() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.register_font_stack(7, &[42]).unwrap();
        engine.create_session(4).unwrap();

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
        assert_eq!(engine.session_style_count(4), Ok(0));
        assert_eq!(engine.session_style_segment_count(4), Ok(0));
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.session_style_count(4), Ok(1));
        assert_eq!(engine.session_style_segment_count(4), Ok(1));
        assert_eq!(engine.session_shaping_run_count(4), Ok(1));

        let remove_bytes = remove_style_bytes(1);
        let mut remove = update(2, 2, 2);
        remove.style_mutations =
            parse_style_mutations(&remove_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        assert_eq!(
            engine.prepare_update(remove, 3),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.session_style_count(4), Ok(1));

        let missing_stack_bytes = root_style_bytes(99);
        let mut missing_stack = update(2, 2, 2);
        missing_stack.style_mutations =
            parse_style_mutations(&missing_stack_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1)
                .unwrap();
        assert_eq!(
            engine.prepare_update(missing_stack, 3),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.session_style_count(4), Ok(1));
    }

    #[test]
    fn an_invalid_later_replacement_cannot_partially_mutate_committed_text() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        let bytes = text_mutation_bytes(&[(0, 0, &[0x61]), (9, 0, &[0x62])]);
        let batch = parse_text_mutations(&bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut request = update(0, 0, 0);
        request.text_mutations = batch;
        assert_eq!(
            engine.prepare_update(request, 1),
            Err(EngineError::InvalidRequest)
        );
        assert!(engine.session_text(4).unwrap().is_empty());
    }

    #[test]
    fn ordered_paragraphs_commit_reorder_and_remove_as_one_session() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
        engine.reserve_session_text(4, 8).unwrap();

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

        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(
            session
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(session.paragraph(1).unwrap().state.text, [0x61, 0x62]);
        assert_eq!(session.paragraph(2).unwrap().state.text, [0x63, 0x64]);

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
        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(
            session
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [2, 1]
        );
        assert_eq!(session.paragraph(1).unwrap().state.text, [0x61, 0x62]);
        assert_eq!(session.paragraph(2).unwrap().state.text, [0x63, 0x64]);

        let remove_bytes = paragraph_mutation_bytes(&[(PARAGRAPH_MUTATION_REMOVE, 1, 0)]);
        let mut remove = update(2, 2, 2);
        remove.limits.max_paragraphs = 2;
        remove.paragraph_mutations =
            parse_paragraph_mutations(&remove_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let prepared = engine.prepare_update(remove, 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(
            session.ordered_paragraphs,
            [ParagraphOrder { order: 0, id: 2 }]
        );
        assert!(session.paragraph(1).is_none());
        assert_eq!(session.paragraph(2).unwrap().state.text, [0x63, 0x64]);
        assert!(session.spare_paragraph.is_some());

        let spare_text_capacity = session.spare_paragraph.as_ref().unwrap().text.capacity();
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
        let recycled = &engine.sessions.get(&4).unwrap().paragraph(3).unwrap().state;
        assert_eq!(
            recycled.text,
            [0x7a],
            "a recycled paragraph must begin semantically empty"
        );
        assert_eq!(
            recycled.text.capacity(),
            spare_text_capacity,
            "paragraph recycling must retain its reserved text allocation"
        );
    }

    #[test]
    fn a_later_paragraph_failure_rolls_back_every_child_and_lifecycle_change() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
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

        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(session.revision, SessionRevision { engine: 1, plan: 1 });
        assert_eq!(
            session
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert_eq!(session.paragraph(1).unwrap().state.text, [0x61]);
        assert_eq!(session.paragraph(2).unwrap().state.text, [0x62]);
        assert!(!session.lifecycle_prepared);
    }

    #[test]
    fn paragraph_limits_unknown_semantics_and_order_collisions_are_atomic() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();
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
        assert!(engine.sessions.get(&4).unwrap().paragraphs.is_empty());

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
        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(
            session
                .ordered_paragraphs
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
    }

    #[test]
    fn single_paragraph_session_rejects_mixed_and_rebound_paragraph_ids() {
        let mut engine = TextEngine::default();
        engine
            .register_policy(9, validated_policy(TechniqueId(1)))
            .unwrap();
        engine.create_session(4).unwrap();

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
        assert_eq!(engine.session_text(4).unwrap(), &[0x61]);
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
                storage_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE,
                draw_key_mask: BATCH_TECHNIQUE
                    | BATCH_PROGRAM
                    | BATCH_RESOURCE
                    | BATCH_ORDER
                    | crate::engine::policy::BATCH_TRANSFORM,
                allocation_strategy: ALLOCATION_ORDERED_DIRECT,
                f32_input_count: 1,
                u32_input_count: 0,
                inputs: vec![crate::engine::policy::InputSource::semantic(0)],
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
        consumed_plan_revision: u32,
        acknowledged_publication_generation: u32,
    ) -> UpdateRequest<'static> {
        UpdateRequest {
            session_id: 4,
            expected_engine_revision,
            consumed_plan_revision,
            acknowledged_publication_generation,
            policy_handle: 9,
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
