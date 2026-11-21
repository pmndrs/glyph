//! Preparation without publication: the one entry behind a read and behind the frame's batch.
//!
//! A read prepares exactly the paragraph it asks about. The frame prepares every paragraph the
//! request carries input for, in one call. Both stage the same candidates and commit through
//! `commit_measure`; neither touches the renderer plan, its revision or its acknowledgement.

use super::*;

/// Which paragraphs one preparation request covers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PreparationTarget {
    /// The paragraph a read asks about. It is measured even when the request changes nothing.
    One(u32),
    /// Every paragraph the request carries text, style or geometry input for.
    Dirty,
}

impl TextEngine {
    pub(crate) fn prepare_paragraphs_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        target: PreparationTarget,
    ) -> Result<MeasuredParagraph, EngineError> {
        self.prepare_paragraphs(Some(shaper), request, target)
    }

    pub(super) fn prepare_paragraphs(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        target: PreparationTarget,
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
        if let PreparationTarget::One(paragraph_id) = target {
            require_queried_paragraph(planner, request, paragraph_id)?;
        }
        let scope = match target {
            PreparationTarget::One(paragraph_id) => ParagraphInputScope::Single(paragraph_id),
            PreparationTarget::Dirty => ParagraphInputScope::Indexed,
        };
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
        let next_measure_generation = planner
            .measure_generation
            .checked_add(1)
            .ok_or(EngineError::RevisionExhausted)?;
        let mut next_glyph_id = planner.next_glyph_id.max(1);
        let measured = request.semantic_view_mask
            & (super::super::frame::SEMANTIC_VIEW_MEASUREMENT
                | super::super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
            != 0;
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
            let count = match target {
                PreparationTarget::One(_) => 1,
                PreparationTarget::Dirty => planner.semantic_input_spans.len(),
            };
            for index in 0..count {
                let (paragraph_id, text, styles, geometry) =
                    paragraph_input(planner, request, target, index)?;
                // Reserve ownership before any semantic stage mutates its candidate state. Each
                // successful preparation is accepted before the call returns.
                admit_preparation_owner(
                    &mut planner.pending_preparation_ids,
                    &mut planner.unpublished_preparation_ids,
                    paragraph_id,
                )?;
                let preflight_candidate =
                    preflight_text_candidate_mut(&mut preflight_text_candidates, paragraph_id);
                // Preparation is durable independently of the result sidecar the host requested,
                // so it always includes positioning. A semantic mask controls serialization, not
                // which stage becomes the current retained preparation.
                let paragraph = planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                paragraph.positioned_changed = paragraph
                    .state
                    .prepare(
                        shaper.as_deref_mut(),
                        font_stacks,
                        font_bindings,
                        text,
                        styles,
                        geometry,
                        request.limits,
                        &mut next_glyph_id,
                        preflight_candidate,
                        &preflight_edit_scratch,
                    )
                    .map_err(|error| error.in_paragraph(paragraph_id))?;
                if measured {
                    let mut records = core::mem::take(&mut planner.semantic_records);
                    let query = append_paragraph_measurement(
                        &mut records,
                        &mut planner
                            .paragraph_mut(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?
                            .state,
                        paragraph_id,
                        shaper.as_deref_mut(),
                        font_stacks,
                        font_bindings,
                        request.limits,
                        request.semantic_view_mask
                            & super::super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
                            != 0,
                        request.semantic_view_mask
                            & super::super::frame::SEMANTIC_VIEW_BORROWED_LAYOUT
                            != 0,
                    );
                    planner.semantic_records = records;
                    query.map_err(|error| error.in_paragraph(paragraph_id))?;
                }
            }
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
        // Reserve identities when they become observable, even if result encoding later fails.
        planner.next_glyph_id = planner.next_glyph_id.max(next_glyph_id);
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
}

type ParagraphInput<'request> = (
    u32,
    super::super::semantic_wire::TextMutationBatch<'request>,
    super::super::semantic_wire::StyleMutationBatch<'request>,
    super::super::semantic_wire::GeometryBatch<'request>,
);

/// The records one paragraph of the request owns: all of them for a read, its routed spans for
/// the `index`-th paragraph of a batch.
fn paragraph_input<'request>(
    planner: &PlannerState,
    request: UpdateRequest<'request>,
    target: PreparationTarget,
    index: usize,
) -> Result<ParagraphInput<'request>, EngineError> {
    let PreparationTarget::One(paragraph_id) = target else {
        let spans = planner.semantic_input_spans[index];
        return Ok((
            spans.id,
            request
                .text_mutations
                .span(spans.text)
                .map_err(|_| EngineError::InvalidRequest)?,
            request
                .style_mutations
                .span(spans.styles)
                .map_err(|_| EngineError::InvalidRequest)?,
            request
                .geometry
                .spans(spans.constraints, spans.inline_objects)
                .map_err(|_| EngineError::InvalidRequest)?,
        ));
    };
    Ok((
        paragraph_id,
        request.text_mutations,
        request.style_mutations,
        request.geometry,
    ))
}

/// A read names a paragraph the request leaves alive: one the committed plan retains, or one this
/// request creates. The lifecycle may remove its siblings in the same call.
fn require_queried_paragraph(
    planner: &PlannerState,
    request: UpdateRequest<'_>,
    paragraph_id: u32,
) -> Result<(), EngineError> {
    let mut present = request.paragraph_mutations.len() == 0
        || planner
            .paragraph(paragraph_id)
            .is_some_and(|paragraph| !paragraph.created);
    for index in 0..request.paragraph_mutations.len() {
        match request
            .paragraph_mutations
            .get(index)
            .ok_or(EngineError::InvalidRequest)?
        {
            super::super::semantic_wire::ParagraphMutation::Upsert {
                paragraph_id: mutated,
                ..
            } => present |= mutated == paragraph_id,
            super::super::semantic_wire::ParagraphMutation::Remove {
                paragraph_id: mutated,
            } => {
                if mutated == paragraph_id {
                    return Err(EngineError::InvalidRequest);
                }
            }
        }
    }
    if present {
        Ok(())
    } else {
        Err(EngineError::InvalidRequest)
    }
}
