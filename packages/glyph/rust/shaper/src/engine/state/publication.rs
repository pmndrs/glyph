//! Reading and committing a prepared update: the plan, its semantic views and the commit that publishes them.

use super::*;

impl TextEngine {
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
    ) -> Result<&[crate::engine::semantic_view::SemanticRecord], EngineError> {
        let planner = self
            .planners
            .get(&prepared.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != prepared.previous {
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
                    let end = start + paragraph.state.active_placement_segments().len();
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

pub(super) fn prepared_gather_key(
    prepared: PreparedUpdate,
    revision: RootRevision,
) -> GatherCacheKey {
    GatherCacheKey {
        root_id: prepared.root_id,
        revision,
        codec_handle: prepared.codec_handle,
        codec_fingerprint: prepared.codec_fingerprint,
        capability_set: prepared.capability_set,
    }
}
