//! Staging and validating the semantic inputs of one update before any paragraph is prepared.

use super::*;

pub(super) fn route_paragraph_records(
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
impl PlannerState {
    pub(super) fn prepare_semantic_inputs(
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

    pub(super) fn validate_style_topology_for_inputs(
        &mut self,
        paragraph_id: u32,
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
        style_mutations: crate::engine::semantic_wire::StyleMutationBatch<'_>,
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
        let mut paragraph = paragraphs
            .binary_search_by_key(&paragraph_id, |paragraph| paragraph.id)
            .ok()
            .and_then(|index| paragraphs.get_mut(index))
            .map(|paragraph| &mut **paragraph);
        let mut empty_styles = StyleArena::default();

        let candidate_index = if text_mutations.len() == 0 {
            None
        } else {
            let mut sources = PreflightTextSources {
                paragraph: paragraph.as_deref_mut(),
                spare_paragraph: &mut *spare_paragraph,
                spare_text_candidate_id,
            };
            Some(sources.prepare_candidate(
                paragraph_id,
                text_mutations,
                preflight_text_candidates,
                preflight_edit_scratch,
            )?)
        };
        let paragraph = paragraph.as_deref();
        let committed_boundaries = || {
            paragraph.map_or(&[0][..], |paragraph| {
                paragraph.state.unicode.committed().grapheme_boundaries()
            })
        };
        let grapheme_boundaries =
            match candidate_index.map(|index| &preflight_text_candidates[index]) {
                Some(candidate) if candidate.unicode_state == CandidateUnicode::Prepared => {
                    match candidate.buffers {
                        CandidateBuffers::ExistingPending { .. } => paragraph
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
                }
                _ => committed_boundaries(),
            };
        let committed_styles = paragraph.map(|paragraph| &paragraph.state.styles.committed().arena);
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

    pub(super) fn semantic_input_spans(&self, paragraph_id: u32) -> ParagraphInputSpans {
        self.semantic_input_spans
            .binary_search_by_key(&paragraph_id, |spans| spans.id)
            .map(|index| self.semantic_input_spans[index])
            .unwrap_or(ParagraphInputSpans {
                id: paragraph_id,
                ..ParagraphInputSpans::default()
            })
    }
}

/// What a preparation keeps from validating a request's lifecycle and semantic inputs.
pub(super) struct StagedInputs {
    pub(super) implicit_paragraph: Option<u32>,
    pub(super) lifecycle_plan: LifecyclePlan,
    pub(super) spare_text_candidate_id: Option<u32>,
    pub(super) preflight_text_candidates: Vec<PreflightTextCandidate>,
    pub(super) preflight_edit_scratch: Vec<TextEdit>,
}

/// Plans the request's paragraph lifecycle, validates its text and style inputs against it,
/// and stages its semantic inputs for `scope`. A single created paragraph with text and no
/// other lifecycle change may write its candidate into the spare paragraph's buffers.
pub(super) fn stage_planner_inputs(
    planner: &mut PlannerState,
    request: UpdateRequest<'_>,
    scope: ParagraphInputScope,
    font_stacks: &[RegisteredFontStack],
) -> Result<StagedInputs, EngineError> {
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
        scope,
        font_stacks,
        spare_text_candidate_id,
        &mut preflight_text_candidates,
        &mut preflight_edit_scratch,
    )?;
    planner.prepare_semantic_inputs(request, scope)?;
    Ok(StagedInputs {
        implicit_paragraph,
        lifecycle_plan,
        spare_text_candidate_id,
        preflight_text_candidates,
        preflight_edit_scratch,
    })
}

pub(super) fn validate_planner_inputs(
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
            .span(crate::engine::semantic_wire::RecordSpan {
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
            .span(crate::engine::semantic_wire::RecordSpan {
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
