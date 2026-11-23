//! Candidate text assembled before preparation: its buffers and the Unicode facts it can reuse.

use super::*;

/// The retained buffers a preflight text candidate may write into instead of its own.
pub(super) struct PreflightTextSources<'a> {
    /// The paragraph the candidate edits, when it exists.
    pub(super) paragraph: Option<&'a mut RetainedParagraph>,
    pub(super) spare_paragraph: &'a mut Option<ParagraphState>,
    pub(super) spare_text_candidate_id: Option<u32>,
}
impl PreflightTextSources<'_> {
    /// Builds the candidate text of `paragraph_id`, records its edits against the committed
    /// text, and analyses its Unicode unless committed analysis can be reused. Returns the
    /// candidate's index.
    pub(super) fn prepare_candidate(
        &mut self,
        paragraph_id: u32,
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
        candidates: &mut Vec<PreflightTextCandidate>,
        edit_scratch: &mut Vec<TextEdit>,
    ) -> Result<usize, EngineError> {
        candidates
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        let index = candidates.len();
        candidates.push(PreflightTextCandidate::default());
        let candidate = &mut candidates[index];
        candidate.paragraph_id = paragraph_id;
        candidate.buffers = self.candidate_buffers(paragraph_id);
        self.populate_candidate_text(candidate, text_mutations)?;
        candidate.unicode_state = CandidateUnicode::ReuseCommitted;
        candidate.reused_ascii_facts = None;
        let edit_start = edit_scratch.len();
        let committed_len = self.committed_text().len();
        let reconciliation = text_reconciliation(text_mutations, committed_len);
        let text_changed = {
            let committed_text = self.committed_text();
            let candidate_text = self.candidate_text(candidate)?;
            if let Some(reconciliation) = reconciliation {
                collect_text_edits(
                    committed_text,
                    candidate_text,
                    reconciliation,
                    edit_scratch,
                    edit_start,
                )?;
                edit_scratch.len() != edit_start
            } else {
                candidate_text != committed_text
            }
        };
        candidate.edit_start = edit_start;
        candidate.edit_end = edit_scratch.len();
        if text_changed {
            self.prepare_candidate_unicode(
                candidate,
                &edit_scratch[edit_start..],
                reconciliation,
                text_mutations,
            )?;
        }
        Ok(index)
    }

    pub(super) fn spare_text_capacity(&self) -> usize {
        self.spare_paragraph.as_ref().map_or(0, text_capacity)
    }

    /// The capacity an owned candidate keeps so a later commit need not grow it.
    pub(super) fn preserved_capacity(&self) -> usize {
        self.paragraph
            .as_deref()
            .map_or(0, |paragraph| text_capacity(&paragraph.state))
            .max(self.spare_text_capacity())
    }

    pub(super) fn committed_text(&self) -> &[u16] {
        self.paragraph.as_deref().map_or(&[][..], |paragraph| {
            paragraph.state.text.committed().units.as_slice()
        })
    }

    pub(super) fn candidate_buffers(&self, paragraph_id: u32) -> CandidateBuffers {
        if self.paragraph.as_deref().is_some_and(|paragraph| {
            !paragraph.state.text.is_prepared() && !paragraph.state.unicode.is_prepared()
        }) {
            CandidateBuffers::ExistingPending {
                unit_ids_mirror_committed: false,
            }
        } else if self.spare_text_candidate_id == Some(paragraph_id)
            && self.spare_paragraph.is_some()
        {
            CandidateBuffers::SparePending
        } else {
            CandidateBuffers::Owned
        }
    }

    pub(super) fn populate_candidate_text(
        &mut self,
        candidate: &mut PreflightTextCandidate,
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    ) -> Result<(), EngineError> {
        match candidate.buffers {
            CandidateBuffers::ExistingPending { .. } => {
                let paragraph = self
                    .paragraph
                    .as_deref_mut()
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
                )
            }
            CandidateBuffers::SparePending => {
                let spare = self
                    .spare_paragraph
                    .as_mut()
                    .ok_or(EngineError::InvalidRequest)?;
                let pending = spare.text.pending_mut();
                pending.units.clear();
                pending.unit_ids.clear();
                pending.next_unit_id = 0;
                spare.pending_text_mirrors_committed = false;
                spare.unicode.pending_mut().clear();
                populate_preflight_text(&mut pending.units, &[], text_mutations, false, 0)
            }
            CandidateBuffers::Owned => {
                let preserved_capacity = self.preserved_capacity();
                candidate.text.clear();
                populate_preflight_text(
                    &mut candidate.text,
                    self.committed_text(),
                    text_mutations,
                    true,
                    preserved_capacity,
                )
            }
        }
    }

    pub(super) fn candidate_text<'s>(
        &'s self,
        candidate: &'s PreflightTextCandidate,
    ) -> Result<&'s [u16], EngineError> {
        Ok(match candidate.buffers {
            CandidateBuffers::ExistingPending { .. } => self
                .paragraph
                .as_deref()
                .ok_or(EngineError::InvalidRequest)?
                .state
                .text
                .pending()
                .units
                .as_slice(),
            CandidateBuffers::SparePending => self
                .spare_paragraph
                .as_ref()
                .ok_or(EngineError::InvalidRequest)?
                .text
                .pending()
                .units
                .as_slice(),
            CandidateBuffers::Owned => candidate.text.as_slice(),
        })
    }

    /// A changed candidate reuses the committed printable-ASCII facts when every edit is a
    /// letter edit they survive; otherwise its Unicode is analysed in its own buffers.
    pub(super) fn prepare_candidate_unicode(
        &mut self,
        candidate: &mut PreflightTextCandidate,
        candidate_edits: &[TextEdit],
        reconciliation: Option<TextReconciliation>,
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
    ) -> Result<(), EngineError> {
        #[cfg(feature = "stage-bench")]
        let _clock = oracle::stage_bench::clock::UNICODE.guard();
        if let Some(facts) = self.reused_ascii_facts(candidate, candidate_edits)? {
            candidate.unicode_state = CandidateUnicode::ReuseCommitted;
            candidate.reused_ascii_facts = Some(facts);
            return Ok(());
        }
        match candidate.buffers {
            CandidateBuffers::ExistingPending { .. } => {
                let paragraph = self
                    .paragraph
                    .as_deref_mut()
                    .ok_or(EngineError::InvalidRequest)?;
                let created = paragraph.created;
                let state = &mut paragraph.state;
                let candidate_text = state.text.pending().units.as_slice();
                let (committed, pending) = state.unicode.pair_mut();
                match local_unicode_edit(candidate_edits, reconciliation, text_mutations) {
                    Some((start, removed, inserted)) if !created => {
                        pending.analyze_edited(committed, candidate_text, start, removed, inserted)
                    }
                    _ => pending.analyze(candidate_text),
                }
                .map_err(unicode_error)?;
            }
            CandidateBuffers::SparePending => {
                let spare = self
                    .spare_paragraph
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
                candidate
                    .unicode
                    .reserve(self.preserved_capacity())
                    .map_err(unicode_error)?;
                candidate
                    .unicode
                    .analyze(&candidate.text)
                    .map_err(unicode_error)?;
            }
        }
        candidate.unicode_state = CandidateUnicode::Prepared;
        Ok(())
    }

    pub(super) fn reused_ascii_facts(
        &self,
        candidate: &PreflightTextCandidate,
        candidate_edits: &[TextEdit],
    ) -> Result<Option<PrintableAsciiFacts>, EngineError> {
        let committed_text = self.committed_text();
        let candidate_text = self.candidate_text(candidate)?;
        Ok(self.paragraph.as_deref().and_then(|paragraph| {
            if paragraph.created || candidate_edits.is_empty() {
                return None;
            }
            let unicode = paragraph.state.unicode.committed();
            let mut facts = unicode.printable_ascii_facts();
            for edit in candidate_edits.iter().copied() {
                facts = unicode.reusable_ascii_facts_for_letter_edit(
                    committed_text,
                    candidate_text,
                    edit.old_start,
                    edit.old_end,
                    edit.new_end,
                    facts,
                )?;
            }
            Some(facts)
        }))
    }
}

/// One edit of an analysed text is analysed around the edit alone: the one a reconciliation
/// found, or the request's only mutation. Returns `(start, removed, inserted)`.
pub(super) fn local_unicode_edit(
    candidate_edits: &[TextEdit],
    reconciliation: Option<TextReconciliation>,
    text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
) -> Option<(usize, usize, usize)> {
    match *candidate_edits {
        [edit] => Some((
            edit.new_start,
            edit.old_end - edit.old_start,
            edit.new_end - edit.new_start,
        )),
        [] if reconciliation.is_none() && text_mutations.len() == 1 => {
            text_mutations.get(0).and_then(|mutation| {
                Some((
                    usize::try_from(mutation.text_start).ok()?,
                    usize::try_from(mutation.delete_count).ok()?,
                    mutation.insert_utf16_le.len() / 2,
                ))
            })
        }
        _ => None,
    }
}
