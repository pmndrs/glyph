//! Preparation without publication: the one entry behind a read and behind the frame's batch.
//!
//! A read prepares exactly the paragraph it asks about. The frame prepares every paragraph the
//! request carries input for, in one call. Both stage the same candidates and commit through
//! `commit_measure`; neither touches the renderer plan, its revision or its acknowledgement.

use super::deferred_positioning::PositioningDemand;
use super::*;

/// Which paragraphs one preparation request covers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PreparationTarget<'request> {
    /// The paragraph a read asks about. It is measured even when the request changes nothing.
    One(u32),
    /// Every paragraph the request carries text, style or geometry input for. Only the listed
    /// ones have their summary serialized when the request asks for measurement views.
    Dirty(MeasuredParagraphs<'request>),
}

/// The paragraphs of a batch whose summary someone will read: an anchor, an explicit
/// `prepare()`, or a caller that read the previous summary. Serializing a summary nobody reads
/// is the cost one read used to impose on every sibling in its root.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MeasuredParagraphs<'request> {
    All,
    /// Ascending little-endian `u32` paragraph ids.
    Only(&'request [u8]),
}

impl<'request> MeasuredParagraphs<'request> {
    /// Reads the trailer a batch writes after its request: a `u32` count, then that many
    /// ascending paragraph ids. A count of `u32::MAX` asks for every prepared paragraph.
    pub(crate) fn parse(trailer: &'request [u8]) -> Result<Self, EngineError> {
        let count = trailer
            .get(..4)
            .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .ok_or(EngineError::InvalidRequest)?;
        if count == u32::MAX {
            return Ok(Self::All);
        }
        let ids = usize::try_from(count)
            .ok()
            .and_then(|count| count.checked_mul(4))
            .and_then(|length| trailer.get(4..4 + length))
            .ok_or(EngineError::InvalidRequest)?;
        let id = |index: usize| {
            u32::from_le_bytes([
                ids[index * 4],
                ids[index * 4 + 1],
                ids[index * 4 + 2],
                ids[index * 4 + 3],
            ])
        };
        if (1..ids.len() / 4).any(|index| id(index - 1) >= id(index)) {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Self::Only(ids))
    }

    fn contains(self, paragraph_id: u32) -> bool {
        let Self::Only(ids) = self else {
            return true;
        };
        let (mut low, mut high) = (0, ids.len() / 4);
        while low < high {
            let middle = low + (high - low) / 2;
            let id = u32::from_le_bytes([
                ids[middle * 4],
                ids[middle * 4 + 1],
                ids[middle * 4 + 2],
                ids[middle * 4 + 3],
            ]);
            match id.cmp(&paragraph_id) {
                core::cmp::Ordering::Equal => return true,
                core::cmp::Ordering::Less => low = middle + 1,
                core::cmp::Ordering::Greater => high = middle,
            }
        }
        false
    }
}

/// The outcome of one preparation request: a witness to commit, and the one paragraph, if any,
/// whose preparation was refused.
///
/// A refusal is local to its paragraph. That paragraph is reset to empty and stays in the root;
/// every paragraph prepared before it in the request commits with the witness, and the ones after
/// it were not started. Nothing else in the root is disturbed, so a host restates the refused
/// paragraph from scratch once its input changes, or removes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PreparedParagraphs {
    pub witness: MeasuredParagraph,
    /// The refused paragraph and why. Most failures carry no paragraph of their own, so it is
    /// named here.
    pub refused: Option<(u32, EngineError)>,
}

impl TextEngine {
    pub(crate) fn prepare_paragraphs_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        target: PreparationTarget<'_>,
    ) -> Result<PreparedParagraphs, EngineError> {
        self.prepare_paragraphs(Some(shaper), request, target)
    }

    pub(super) fn prepare_paragraphs(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        target: PreparationTarget<'_>,
    ) -> Result<PreparedParagraphs, EngineError> {
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
            PreparationTarget::Dirty(_) => ParagraphInputScope::Indexed,
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
        // A read that asks for no glyph, ink or inspection answers from flow layout; positioning
        // is owed until something reads positions (`deferred_positioning`).
        let positioning = if request.semantic_view_mask
            & (super::super::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
                | super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS)
            == 0
        {
            PositioningDemand::Deferrable
        } else {
            PositioningDemand::Now
        };
        let mut refused = None;
        // Everything up to here either validated without writing or wrote only scratch. From
        // here a failure of the lifecycle still discards the derived root; a failure inside one
        // paragraph's own stages is confined to that paragraph.
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
                PreparationTarget::Dirty(_) => planner.semantic_input_spans.len(),
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
                let serialized = match target {
                    PreparationTarget::One(_) => measured,
                    PreparationTarget::Dirty(interest) => {
                        measured && interest.contains(paragraph_id)
                    }
                };
                let stages = (|| {
                    let preflight_candidate =
                        preflight_text_candidate_mut(&mut preflight_text_candidates, paragraph_id);
                    let paragraph = planner
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?;
                    // Every lane whose size follows the text is reserved before the first stage
                    // writes, so running out of memory refuses this paragraph with nothing to
                    // undo instead of failing halfway through a stage.
                    paragraph
                        .state
                        .reserve_text(prepared_text_length(&paragraph.state, text)?)?;
                    // Preparation is durable independently of the result sidecar the host
                    // requested: every stage it runs commits. Positioning alone may be owed,
                    // against a kept predecessor, until something reads positions.
                    paragraph.positioned_changed = paragraph.state.prepare(
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
                        positioning,
                    )?;
                    if !serialized {
                        return Ok(());
                    }
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
                        request.semantic_view_mask & super::super::frame::SEMANTIC_VIEW_GLYPH_FACTS
                            != 0,
                    );
                    planner.semantic_records = records;
                    query
                })();
                if let Err(error) = stages {
                    refuse_paragraph(planner, paragraph_id)?;
                    refused = Some((paragraph_id, error.in_paragraph(paragraph_id)));
                    break;
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
        Ok(PreparedParagraphs {
            witness: MeasuredParagraph {
                root_id: request.root_id,
                revision: planner.revision,
                preparation_revision: planner.preparation_revision,
                measure_generation: next_measure_generation,
                codec_handle: request.codec_handle,
                codec_fingerprint,
            },
            refused,
        })
    }
}

/// The UTF-16 length a paragraph's text will have once the request's replacements apply.
fn prepared_text_length(
    state: &ParagraphState,
    mutations: super::super::semantic_wire::TextMutationBatch<'_>,
) -> Result<usize, EngineError> {
    let mut length = state.text.committed().units.len();
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        let deleted =
            usize::try_from(mutation.delete_count).map_err(|_| EngineError::InvalidRequest)?;
        length = length
            .checked_sub(deleted)
            .and_then(|length| length.checked_add(mutation.insert_utf16_le.len() / 2))
            .ok_or(EngineError::InvalidRequest)?;
    }
    Ok(length)
}

/// Confines a failed preparation to its paragraph: the paragraph is emptied and its memory released,
/// it keeps its place in the root, and it is marked changed so the next publication withdraws what
/// it drew.
fn refuse_paragraph(planner: &mut PlannerState, paragraph_id: u32) -> Result<(), EngineError> {
    let paragraph = planner
        .paragraph_mut(paragraph_id)
        .ok_or(EngineError::InvalidRequest)?;
    // Dropped, not cleared: a refusal is usually memory, and a cleared paragraph keeps every lane it
    // had grown, which would leave its siblings as short of memory as it was.
    paragraph.state = ParagraphState::default();
    paragraph.positioned_changed = true;
    Ok(())
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
    target: PreparationTarget<'_>,
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

#[cfg(test)]
mod measured_paragraph_tests {
    use super::MeasuredParagraphs;
    use crate::engine::EngineError;
    use alloc::vec::Vec;

    fn trailer(words: &[u32]) -> Vec<u8> {
        words.iter().flat_map(|word| word.to_le_bytes()).collect()
    }

    #[test]
    fn a_trailer_names_exactly_the_paragraphs_to_measure() {
        let bytes = trailer(&[3, 2, 7, 40, 0xdead_beef]);
        let interest = MeasuredParagraphs::parse(&bytes).unwrap();
        for id in [2, 7, 40] {
            assert!(interest.contains(id));
        }
        for id in [0, 1, 3, 39, 41, 0xdead_beef] {
            assert!(!interest.contains(id));
        }
        let none = trailer(&[0]);
        assert!(!MeasuredParagraphs::parse(&none).unwrap().contains(1));
        let all = trailer(&[u32::MAX]);
        assert_eq!(MeasuredParagraphs::parse(&all), Ok(MeasuredParagraphs::All));
        assert!(MeasuredParagraphs::All.contains(9));
    }

    #[test]
    fn a_short_or_unordered_trailer_is_rejected() {
        for words in [&[][..], &[2, 5][..], &[2, 5, 5][..], &[2, 9, 4][..]] {
            assert_eq!(
                MeasuredParagraphs::parse(&trailer(words)),
                Err(EngineError::InvalidRequest)
            );
        }
    }
}
