//! The Unicode, bidi and shaping-run stages of one paragraph.

use super::*;

impl ParagraphState {
    pub(super) fn prepare_unicode(
        &mut self,
        preflight_candidate: Option<&mut PreflightTextCandidate>,
    ) -> Result<(), EngineError> {
        self.discard_unicode_candidate();
        if !self.text.is_prepared() {
            return Ok(());
        }
        let Some(preflight_candidate) = preflight_candidate else {
            return Err(EngineError::InvalidRequest);
        };
        if preflight_candidate.unicode_state == CandidateUnicode::ReuseCommitted {
            self.unicode_reused_for_text_edit = true;
            self.pending_reused_ascii_facts = preflight_candidate.reused_ascii_facts;
            self.carry_boundary_lanes(false);
            return Ok(());
        }
        if preflight_candidate.uses_pending_buffers() {
            // The preflight analysis already occupies the inactive buffer. It remains
            // invisible until this point, after every caller-authored input has passed.
        } else {
            core::mem::swap(self.unicode.pending_mut(), &mut preflight_candidate.unicode);
        }
        self.unicode.mark_prepared();
        self.carry_boundary_lanes(true);
        Ok(())
    }

    /// Keeps the word and sentence lanes an editing query filled across this text edit: they
    /// are told what changed and recompute only a window around it when next queried. A
    /// paragraph nobody asked about has no lane and pays one branch; one that is only typed
    /// into stops being maintained after `BOUNDARY_LANE_IDLE_EDITS` edits without a query.
    pub(super) fn carry_boundary_lanes(&mut self, analysed_anew: bool) {
        let idle = self.boundary_lane_idle_edits >= BOUNDARY_LANE_IDLE_EDITS;
        if analysed_anew {
            let (committed, pending) = self.unicode.pair_mut();
            let Some(mut lanes) = committed.take_computed_boundary_lanes() else {
                return;
            };
            if idle {
                return;
            }
            for edit in &self.text_edits {
                lanes.splice(
                    edit.new_start,
                    edit.old_end - edit.old_start,
                    edit.new_end - edit.new_start,
                );
            }
            pending.adopt_boundary_lanes(lanes);
        } else {
            // The analysis is kept, and its lanes describe the text before the edit: a
            // sentence boundary depends on a letter's case.
            let kept = self.unicode.active_mut();
            if !kept.has_computed_boundary_lanes() {
                return;
            }
            if idle {
                kept.invalidate_boundary_lanes();
                return;
            }
            for edit in &self.text_edits {
                kept.boundary_lanes_mut().splice(
                    edit.new_start,
                    edit.old_end - edit.old_start,
                    edit.new_end - edit.new_start,
                );
            }
        }
        self.boundary_lane_idle_edits += 1;
    }

    pub(super) fn discard_unicode_candidate(&mut self) {
        self.unicode.discard_candidate();
        self.unicode_reused_for_text_edit = false;
        self.pending_reused_ascii_facts = None;
    }

    pub(super) fn commit_unicode(&mut self) {
        if self.unicode.is_prepared() {
            self.unicode.commit();
        } else if let Some(facts) = self.pending_reused_ascii_facts.take() {
            // Only the accepted transaction reaches this point. The arrays
            // were reused; their derived small fact is committed in place.
            self.unicode.active_mut().accept_reused_ascii_facts(facts);
        }
        self.discard_unicode_candidate();
    }

    pub(super) fn prepare_bidi(&mut self) -> Result<(), EngineError> {
        self.discard_bidi_candidate();
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
        #[cfg(feature = "stage-bench")]
        let _clock = oracle::stage_bench::clock::BIDI.guard();
        analyze_bidi_into(text, direction, self.bidi.pending_mut()).map_err(bidi_error)?;
        self.bidi.mark_prepared();
        Ok(())
    }

    pub(super) fn discard_bidi_candidate(&mut self) {
        self.bidi.discard_candidate();
    }

    pub(super) fn commit_bidi(&mut self) {
        if self.bidi.is_prepared() {
            self.bidi.commit();
        }
        self.discard_bidi_candidate();
    }

    pub(super) fn prepare_shaping_runs(&mut self) -> Result<(), EngineError> {
        self.discard_shaping_runs_candidate();
        // The Unicode reuse certificate changes only equal-length ASCII letters, so it
        // preserves script ranges and every hard-break position consumed by the run builder.
        if (!self.text.is_prepared() || self.unicode_reused_for_text_edit)
            && !self.style_invalidation.shaping
            && !self.style_invalidation.metrics
            && !self.bidi.is_prepared()
            && !self.styles.is_prepared()
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

    pub(super) fn discard_shaping_runs_candidate(&mut self) {
        self.shaping_runs.pending_mut().clear();
        self.shaping_runs.discard_candidate();
    }

    pub(super) fn commit_shaping_runs(&mut self) {
        if self.shaping_runs.is_prepared() {
            self.shaping_runs.commit();
        }
        self.discard_shaping_runs_candidate();
    }
}
