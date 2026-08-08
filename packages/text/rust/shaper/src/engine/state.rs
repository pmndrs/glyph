use alloc::{collections::BTreeMap, vec::Vec};

use super::{
    font_binding::FontRenderBinding,
    frame::{CommittedUpdate, PreparedUpdate, SessionRevision, UpdateRequest},
    policy::{CapabilitySetId, ValidatedPolicy},
    policy_gather::{
        DEFAULT_GATHER_RECORD_CAPACITY, GatherError, LayoutPlanInput, PolicyGatherWorkspace,
    },
    render_plan::RenderPlanView,
    render_plan_compiler::{RenderPlanCompiler, RenderPlanCompilerError},
    style_state::{DEFAULT_STYLE_CAPACITY, MutationKey, StyleArena},
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
    binding: FontRenderBinding,
}

struct RegisteredFontStack {
    handle: u32,
    fonts: Vec<u32>,
}

#[derive(Default)]
struct EngineSession {
    revision: SessionRevision,
    acknowledged_publication_generation: u32,
    policy_binding: Option<PolicyBinding>,
    plan: RenderPlanCompiler,
    text: Vec<u16>,
    pending_text: Vec<u16>,
    text_prepared: bool,
    styles: StyleArena,
    pending_styles: StyleArena,
    style_mutation_scratch: Vec<MutationKey>,
    style_order_scratch: Vec<usize>,
    style_nesting_scratch: Vec<u32>,
    styles_prepared: bool,
    geometry_fingerprint: u64,
    pending_geometry_fingerprint: u64,
    geometry_prepared: bool,
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
        shaping_glyph_count: u32,
        binding: FontRenderBinding,
    ) -> Result<(), EngineError> {
        if handle == 0 || binding.glyph_count() != shaping_glyph_count {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(existing) = self
            .font_bindings
            .iter()
            .find(|registered| registered.handle == handle)
        {
            return if existing.binding == binding {
                Ok(())
            } else {
                Err(EngineError::HandleConflict)
            };
        }
        self.font_bindings
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.font_bindings
            .push(RegisteredFontBinding { handle, binding });
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

    pub fn references_font(&self, handle: u32) -> bool {
        self.font_stacks
            .iter()
            .any(|stack| stack.fonts.contains(&handle))
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
        session.styles.reserve_default()?;
        session.pending_styles.reserve_default()?;
        session
            .style_mutation_scratch
            .try_reserve_exact(DEFAULT_STYLE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        session
            .style_order_scratch
            .try_reserve_exact(DEFAULT_STYLE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
        session
            .style_nesting_scratch
            .try_reserve_exact(DEFAULT_STYLE_CAPACITY)
            .map_err(|_| EngineError::ResultTooLarge)?;
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
        reserve_text_buffer(&mut session.text, capacity)?;
        reserve_text_buffer(&mut session.pending_text, capacity)?;
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
            .map(|session| session.text.as_slice())
            .ok_or(EngineError::SessionMissing)
    }

    #[cfg(test)]
    pub(crate) fn session_style_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.sessions
            .get(&handle)
            .map(|session| session.styles.len())
            .ok_or(EngineError::SessionMissing)
    }

    pub fn session_count(&self) -> u32 {
        self.sessions.len().try_into().unwrap_or(u32::MAX)
    }

    pub(crate) fn prepare_update(
        &mut self,
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
        session.prepare_text(request.text_mutations)?;
        if let Err(error) = session.prepare_styles(request.style_mutations, |handle| {
            font_stacks
                .binary_search_by_key(&handle, |stack| stack.handle)
                .is_ok()
        }) {
            session.abort_text();
            return Err(error);
        }
        if let Err(error) = session.prepare_geometry(request.geometry) {
            session.abort_text();
            session.abort_styles();
            return Err(error);
        }
        if let Err(error) = gather.gather(
            policy,
            CapabilitySetId(request.capability_set),
            LayoutPlanInput {
                glyphs: &[],
                semantic_f32: &[],
                semantic_u32: &[],
            },
            |handle| {
                font_bindings
                    .iter()
                    .find(|binding| binding.handle == handle)
                    .map(|binding| &binding.binding)
            },
        ) {
            session.abort_text();
            session.abort_styles();
            session.abort_geometry();
            return Err(gather_error(error));
        }
        let gathered = gather.view();
        if let Err(error) = session.plan.prepare(
            policy,
            CapabilitySetId(request.capability_set),
            gathered.plan_input(),
            checkpoint,
            publication_generation,
            request.acknowledged_publication_generation,
        ) {
            session.abort_text();
            session.abort_styles();
            session.abort_geometry();
            return Err(plan_error(error));
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
        session.plan.abort();
        session.abort_text();
        session.abort_styles();
        session.abort_geometry();
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
        session.commit_text();
        session.commit_styles();
        session.commit_geometry();
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
        self.pending_text.extend_from_slice(&self.text);
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
        }
        self.text_prepared = true;
        Ok(())
    }

    fn abort_text(&mut self) {
        self.pending_text.clear();
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
        self.styles_prepared = true;
        Ok(())
    }

    fn abort_styles(&mut self) {
        self.pending_styles.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.styles_prepared = false;
    }

    fn commit_styles(&mut self) {
        if self.styles_prepared {
            core::mem::swap(&mut self.styles, &mut self.pending_styles);
        }
        self.abort_styles();
    }

    fn commit_text(&mut self) {
        if self.text_prepared {
            core::mem::swap(&mut self.text, &mut self.pending_text);
        }
        self.abort_text();
    }

    fn prepare_geometry(
        &mut self,
        geometry: super::semantic_wire::GeometryBatch<'_>,
    ) -> Result<(), EngineError> {
        self.abort_geometry();
        let text_length = if self.text_prepared {
            self.pending_text.len()
        } else {
            self.text.len()
        };
        geometry
            .validate_text_length(text_length)
            .map_err(|_| EngineError::InvalidRequest)?;
        self.pending_geometry_fingerprint = geometry.fingerprint();
        self.geometry_prepared = true;
        Ok(())
    }

    fn abort_geometry(&mut self) {
        self.pending_geometry_fingerprint = 0;
        self.geometry_prepared = false;
    }

    fn commit_geometry(&mut self) {
        if self.geometry_prepared {
            self.geometry_fingerprint = self.pending_geometry_fingerprint;
        }
        self.abort_geometry();
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

fn reserve_text_buffer(text: &mut Vec<u16>, capacity: usize) -> Result<(), EngineError> {
    if text.capacity() < capacity {
        text.try_reserve_exact(capacity.saturating_sub(text.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
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
            ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_RECORD_SIZE,
            ENGINE_TEXT_MUTATION_TEXT_START, ENGINE_UPDATE_REQUEST_HEADER_SIZE,
        },
        engine::{
            font_binding::{
                FieldTable, FontRenderBinding, FontResource, FontStrike, MISSING_RESOURCE_INDEX,
            },
            frame::{
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
            semantic_wire::{parse_style_mutations, parse_text_mutations},
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
        assert!(engine.references_font(4));
        assert_eq!(engine.font_stack_count(), 1);
        assert_eq!(
            engine.register_font_stack(7, &[9, 12]),
            Err(EngineError::HandleConflict)
        );
        assert_eq!(engine.dispose_font_stack(7), Ok(()));
        assert!(!engine.references_font(4));
        assert_eq!(
            engine.dispose_font_stack(7),
            Err(EngineError::FontStackMissing)
        );
    }

    #[test]
    fn font_bindings_are_owned_once_per_font_and_match_shaping_coverage() {
        let mut engine = TextEngine::default();
        let binding = render_binding(3, 7);
        assert_eq!(
            engine.register_font_binding(11, 4, binding.clone()),
            Err(EngineError::InvalidRequest)
        );
        assert_eq!(engine.register_font_binding(11, 3, binding.clone()), Ok(()));
        assert_eq!(engine.register_font_binding(11, 3, binding), Ok(()));
        assert_eq!(engine.font_binding_count(), 1);
        assert_eq!(engine.font_binding(11).unwrap().technique(), TechniqueId(7));
        assert_eq!(
            engine.register_font_binding(11, 3, render_binding(3, 8)),
            Err(EngineError::HandleConflict)
        );
        engine.dispose_font_binding(11);
        assert_eq!(engine.font_binding_count(), 0);
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

        let edit_bytes = text_mutation_bytes(&[(1, 2, &[0x58, 0x59]), (4, 0, &[0x21])]);
        let edit_batch =
            parse_text_mutations(&edit_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 2).unwrap();
        let mut edit = update(1, 1, 1);
        edit.text_mutations = edit_batch;
        let prepared = engine.prepare_update(edit, 2).unwrap();
        engine.abort_update(prepared).unwrap();
        assert_eq!(engine.session_text(4).unwrap(), &[0x61, 0x62, 0x63, 0x64]);

        let retry = engine.prepare_update(edit, 2).unwrap();
        engine.commit_update(retry).unwrap();
        assert_eq!(
            engine.session_text(4).unwrap(),
            &[0x61, 0x58, 0x59, 0x64, 0x21]
        );

        let settled_capacities = {
            let session = engine.sessions.get(&4).unwrap();
            [session.text.capacity(), session.pending_text.capacity()]
        };
        let warm_bytes = text_mutation_bytes(&[(0, 1, &[0x7a])]);
        let warm_batch =
            parse_text_mutations(&warm_bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
        let mut warm = update(2, 2, 2);
        warm.text_mutations = warm_batch;
        let prepared = engine.prepare_update(warm, 3).unwrap();
        engine.commit_update(prepared).unwrap();
        let session = engine.sessions.get(&4).unwrap();
        assert_eq!(
            [session.pending_text.capacity(), session.text.capacity()],
            settled_capacities
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
        engine.commit_update(prepared).unwrap();
        assert_eq!(engine.session_style_count(4), Ok(1));

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
                draw_key_mask: BATCH_TECHNIQUE | BATCH_PROGRAM | BATCH_RESOURCE | BATCH_ORDER,
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
                max_clusters: 1,
                max_lines: 1,
                max_regions: 1,
                max_exclusions: 1,
                max_inline_objects: 1,
                max_slots_per_band: 1,
                max_output_bytes: 128,
            },
            text_mutations: super::super::semantic_wire::TextMutationBatch::empty(),
            style_mutations: super::super::semantic_wire::StyleMutationBatch::empty(),
            geometry: super::super::semantic_wire::GeometryBatch::empty(),
        }
    }

    fn root_style_bytes(font_stack_handle: u32) -> Vec<u8> {
        let record = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let mut bytes = vec![0; record + abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize];
        bytes[record + abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
        bytes[record + abi::ENGINE_STYLE_MUTATION_FLAGS] = STYLE_FLAG_ROOT;
        write_u32(&mut bytes, record + abi::ENGINE_STYLE_MUTATION_STYLE_ID, 1);
        write_u32(
            &mut bytes,
            record + abi::ENGINE_STYLE_MUTATION_FIELD_MASK,
            STYLE_FIELD_FONT_STACK
                | STYLE_FIELD_FONT_SIZE
                | STYLE_FIELD_LINE_HEIGHT
                | STYLE_FIELD_RASTER_PIXEL_RATIO,
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
