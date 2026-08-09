use alloc::{collections::BTreeMap, vec::Vec};

use crate::{
    STATUS_RESULT_TOO_LARGE, ShapeRunRef, ShaperRegistry,
    bidi::{BidiAnalysis, BidiError, DIRECTION_AUTO, analyze_into as analyze_bidi_into},
    unicode::{UnicodeAnalysis, UnicodeError},
};

use super::{
    cluster_state::{ClusterArena, ClusterBuildInput},
    flow_composition::FlowLayoutArena,
    flow_geometry::FlowGeometryArena,
    font_binding::FontRenderBinding,
    frame::{CommittedUpdate, PreparedUpdate, SessionRevision, UpdateRequest},
    identity_index::IdentityIndex,
    policy::{ALLOCATION_ORDERED_DIRECT, CapabilitySetId, ValidatedPolicy},
    policy_gather::{
        DEFAULT_GATHER_RECORD_CAPACITY, GatherError, LayoutPlanInput, PolicyGatherWorkspace,
    },
    positioning::PositionedGlyphArena,
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
    shaping_state::{ShapeArena, ShapingRunArena},
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

#[derive(Default)]
struct EngineSession {
    revision: SessionRevision,
    acknowledged_publication_generation: u32,
    policy_binding: Option<PolicyBinding>,
    plan: RenderPlanCompiler,
    next_glyph_id: u32,
    pending_next_glyph_id: u32,
    next_content_revision: u32,
    pending_next_content_revision: u32,
    text_capacity: usize,
    spare_paragraph: Option<ParagraphState>,
    paragraphs: Vec<RetainedParagraph>,
    ordered_paragraphs: Vec<ParagraphOrder>,
    pending_ordered_paragraphs: Vec<ParagraphOrder>,
    lifecycle_prepared: bool,
    lifecycle_changed: bool,
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
    next_text_unit_id: u32,
    pending_next_text_unit_id: u32,
    text_prepared: bool,
    styles: StyleArena,
    pending_styles: StyleArena,
    resolved_styles: ResolvedStyleArena,
    pending_resolved_styles: ResolvedStyleArena,
    unicode: UnicodeAnalysis,
    pending_unicode: UnicodeAnalysis,
    bidi: BidiAnalysis,
    pending_bidi: BidiAnalysis,
    shaping_runs: ShapingRunArena,
    pending_shaping_runs: ShapingRunArena,
    shape: ShapeArena,
    pending_shape: ShapeArena,
    clusters: ClusterArena,
    pending_clusters: ClusterArena,
    glyph_identity_index: IdentityIndex,
    geometry: FlowGeometryArena,
    pending_geometry: FlowGeometryArena,
    flow_layout: FlowLayoutArena,
    pending_flow_layout: FlowLayoutArena,
    positioned: PositionedGlyphArena,
    pending_positioned: PositionedGlyphArena,
    flow_slot_scratch: super::flow_geometry::InlineSlotArena,
    fallback_spans: Vec<FallbackSpan>,
    pending_fallback_spans: Vec<FallbackSpan>,
    fallback_span_scratch: Vec<FallbackSpan>,
    fallback_cluster_scratch: Vec<ClusterRecord>,
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

impl TextEngine {
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
        Ok(())
    }

    pub fn dispose_font_binding(&mut self, handle: u32) {
        if let Some(index) = self
            .font_bindings
            .iter()
            .position(|binding| binding.handle == handle)
        {
            self.font_bindings.swap_remove(index);
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
        self.font_bindings
            .retain(|binding| binding.shaping_handle != shaping_handle);
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
            .map(|_| ())
            .ok_or(EngineError::SessionMissing)
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
        for paragraph in &mut session.paragraphs {
            paragraph.state.reserve_text(capacity)?;
        }
        session.text_capacity = session.text_capacity.max(capacity);
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
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
        let gather = &mut self.gather;
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
        let preparation = (|| {
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
                && policy
                    .programs()
                    .iter()
                    .all(|program| program.allocation_strategy == ALLOCATION_ORDERED_DIRECT);
            if reuse_ordered_plan {
                session.plan.prepare_reuse().map_err(plan_error)?;
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
                gather.begin(policy, record_count).map_err(gather_error)?;
                for order_index in 0..session.active_order().len() {
                    let paragraph_id = session.active_order()[order_index].id;
                    let paragraph = session
                        .paragraph(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?;
                    let positioned = if paragraph.state.positioned_prepared {
                        &paragraph.state.pending_positioned
                    } else {
                        &paragraph.state.positioned
                    };
                    let semantic_f32 = positioned.semantic_f32();
                    let semantic_u32 = positioned.semantic_u32();
                    gather
                        .append(
                            policy,
                            CapabilitySetId(request.capability_set),
                            LayoutPlanInput {
                                transform_id: paragraph_id,
                                glyphs: positioned.glyphs(),
                                semantic_change_masks: positioned.semantic_change_masks(),
                                semantic_f32: &semantic_f32,
                                semantic_u32: &semantic_u32,
                            },
                            checkpoint || !paragraph.positioned_changed,
                            |handle| {
                                font_bindings
                                    .iter()
                                    .find(|binding| binding.handle == handle)
                                    .map(|binding| &binding.binding)
                            },
                        )
                        .map_err(gather_error)?;
                }
                let gathered = gather.view();
                session
                    .plan
                    .prepare(
                        policy,
                        CapabilitySetId(request.capability_set),
                        gathered.plan_input(),
                        checkpoint,
                        publication_generation,
                        request.acknowledged_publication_generation,
                    )
                    .map_err(plan_error)?;
            }
            session.pending_next_glyph_id = next_glyph_id;
            session.pending_next_content_revision = next_content_revision;
            Ok(())
        })();
        if let Err(error) = preparation {
            session.abort_pending();
            return Err(error);
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

    pub(crate) fn abort_update(&mut self, prepared: PreparedUpdate) -> Result<(), EngineError> {
        let session = self
            .sessions
            .get_mut(&prepared.session_id)
            .ok_or(EngineError::SessionMissing)?;
        if session.revision != prepared.previous {
            return Err(EngineError::RevisionConflict);
        }
        session.abort_pending();
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
        session.commit_paragraphs();
        session.next_glyph_id = session.pending_next_glyph_id;
        session.next_content_revision = session.pending_next_content_revision;
        session.pending_next_glyph_id = 0;
        session.pending_next_content_revision = 0;
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
            self.pending_ordered_paragraphs
                .sort_unstable_by_key(|paragraph| (paragraph.order, paragraph.id));
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
                let mut state = if let Some(spare) = self.spare_paragraph.take() {
                    spare
                } else {
                    let mut state = ParagraphState::default();
                    state.initialize()?;
                    state
                };
                if let Err(error) = state.reserve_text(self.text_capacity) {
                    if self.spare_paragraph.is_none() {
                        self.spare_paragraph = Some(state);
                    }
                    return Err(error);
                }
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
        for paragraph in &mut self.paragraphs {
            paragraph.state.abort_all();
            paragraph.positioned_changed = false;
        }
        self.abort_lifecycle();
        self.pending_next_glyph_id = 0;
        self.pending_next_content_revision = 0;
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
        self.positioned.reserve(glyph_capacity)?;
        self.pending_positioned.reserve(glyph_capacity)?;
        self.glyph_identity_index
            .prepare(glyph_capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        reserve_vec(&mut self.fallback_spans, capacity)?;
        reserve_vec(&mut self.pending_fallback_spans, capacity)?;
        reserve_vec(&mut self.fallback_span_scratch, capacity)?;
        reserve_vec(&mut self.fallback_cluster_scratch, glyph_capacity)
    }

    fn prepare_text(
        &mut self,
        mutations: super::semantic_wire::TextMutationBatch<'_>,
    ) -> Result<(), EngineError> {
        self.abort_text();
        if mutations.len() == 0 {
            return Ok(());
        }
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
        self.pending_text.extend_from_slice(&self.text);
        self.pending_text_unit_ids
            .extend_from_slice(&self.text_unit_ids);
        self.pending_next_text_unit_id = self.next_text_unit_id.max(1);
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
        self.text_prepared = true;
        Ok(())
    }

    fn abort_text(&mut self) {
        self.pending_text.clear();
        self.pending_text_unit_ids.clear();
        self.pending_next_text_unit_id = 0;
        self.text_prepared = false;
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
            );
        }
        self.pending_styles.prepare_from(
            &self.styles,
            mutations,
            &mut self.style_mutation_scratch,
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
            core::mem::swap(&mut self.text, &mut self.pending_text);
            core::mem::swap(&mut self.text_unit_ids, &mut self.pending_text_unit_ids);
            self.next_text_unit_id = self.pending_next_text_unit_id;
        }
        self.abort_text();
    }

    fn prepare_unicode(&mut self) -> Result<(), EngineError> {
        self.abort_unicode();
        if !self.text_prepared {
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
    }

    fn commit_unicode(&mut self) {
        if self.unicode_prepared {
            core::mem::swap(&mut self.unicode, &mut self.pending_unicode);
        }
        self.abort_unicode();
    }

    fn prepare_bidi(&mut self) -> Result<(), EngineError> {
        self.abort_bidi();
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
        if !self.text_prepared && !self.style_invalidation.shaping && !self.bidi_prepared {
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
            .build(text, styles, unicode, bidi)?;
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
        if !self.shaping_runs_prepared {
            return Ok(());
        }
        let text = if self.text_prepared {
            self.pending_text.as_slice()
        } else {
            self.text.as_slice()
        };
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
            collect_cluster_records(&self.pending_shape, &mut self.fallback_cluster_scratch)?;
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

    fn abort_shape(&mut self) {
        self.pending_shape.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
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
        self.pending_clusters.build(
            ClusterBuildInput {
                text,
                text_unit_ids,
                unicode,
                styles,
                runs,
                shape: if self.shape_prepared {
                    &self.pending_shape
                } else {
                    &self.shape
                },
            },
            |handle| shaper.font_metrics(handle),
        )?;
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
        shaper: &ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
    ) -> Result<(), EngineError> {
        self.abort_flow_layout();
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
        let geometry = if self.geometry_prepared {
            &self.pending_geometry
        } else {
            &self.geometry
        };
        self.pending_flow_layout.build(
            geometry,
            clusters,
            styles,
            &mut self.flow_slot_scratch,
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
        )?;
        self.flow_layout_prepared = true;
        Ok(())
    }

    fn abort_flow_layout(&mut self) {
        self.pending_flow_layout.clear();
        self.flow_layout_prepared = false;
    }

    fn commit_flow_layout(&mut self) {
        if self.flow_layout_prepared {
            core::mem::swap(&mut self.flow_layout, &mut self.pending_flow_layout);
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
        self.pending_positioned.build(
            &self.positioned,
            flow,
            text,
            clusters,
            runs,
            shape,
            styles,
            bidi,
            &mut self.glyph_identity_index,
            next_content_revision,
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
    records.sort_unstable_by_key(|record| (record.source_run, record.cluster));
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
    use super::*;
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
        collect_cluster_records(&shape, &mut records).unwrap();
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
        engine.abort_update(prepared).unwrap();
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
