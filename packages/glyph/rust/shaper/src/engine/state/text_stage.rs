//! The text and style stages of one paragraph.

use super::*;

impl ParagraphState {
    pub(super) fn reserve_text(&mut self, capacity: usize) -> Result<(), EngineError> {
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
    pub(super) fn prepare_text(
        &mut self,
        mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
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
        self.text_edit_parts.clear();
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
                if mutations.len() > 1 {
                    split_identity_edit(
                        &committed.unit_ids,
                        &pending.unit_ids,
                        committed.next_unit_id,
                        edit,
                        &mut self.text_edit_parts,
                    )?;
                }
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

    pub(super) fn discard_text_candidate(&mut self) {
        if self.text.is_prepared() {
            // The pending candidate is disposable; the committed buffer remains the source for
            // the next edit, which seeds the reusable destination only when it is needed.
            self.pending_text_mirrors_committed = false;
        }
        self.clear_text_preparation();
    }

    pub(super) fn clear_text_preparation(&mut self) {
        self.text.pending_mut().next_unit_id = 0;
        self.text.discard_candidate();
        self.text_edits.clear();
        self.text_edit_parts.clear();
    }

    #[inline(never)]
    pub(super) fn prepare_styles(
        &mut self,
        mutations: crate::engine::semantic_wire::StyleMutationBatch<'_>,
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

    pub(super) fn discard_style_candidate(&mut self) {
        self.styles.pending_mut().arena.clear();
        self.styles.pending_mut().resolved.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.styles.discard_candidate();
        self.style_invalidation = StyleInvalidation::default();
    }

    pub(super) fn commit_styles(&mut self) {
        // One swap publishes both buffers, because they are one stage.
        self.styles.commit();
        self.discard_style_candidate();
    }

    pub(super) fn commit_text(&mut self) {
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
}

/// The largest text buffer a paragraph state already holds.
pub(super) fn text_capacity(state: &ParagraphState) -> usize {
    state
        .text
        .pending()
        .units
        .capacity()
        .max(state.text.committed().units.capacity())
}

pub(super) fn reserve_text_buffer(text: &mut Vec<u16>, capacity: usize) -> Result<(), EngineError> {
    if text.capacity() < capacity {
        text.try_reserve_exact(capacity.saturating_sub(text.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}
