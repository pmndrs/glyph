//! Positioning a summary-only read leaves for later, and the predecessor it keeps for it.
//!
//! A read that asks only for a paragraph's summary needs flow layout, not per-glyph positions:
//! widths, heights, line count and baselines come from the flow. Preparation is still durable
//! (the read commits every stage it ran), so the positioning it skipped is owed against the
//! values the committed positioned arena was built from. Positioning compares the new flow with
//! that predecessor to retain lines and to mint canonical revisions, so those values are kept,
//! not overwritten: a commit swaps each stage's accepted value in and leaves the one it replaced
//! in the stage's pending slot, and a deferred commit simply does not clear that slot.
//!
//! The owed positioning runs exactly once, before anything reads positions: the publication that
//! follows, a glyph, ink, copy or editing read, or the next preparation of the same paragraph.
//! It restores each kept pair to the shape it had before the commit and runs the one positioning
//! implementation, so retention and revisions are those an eager positioning would have produced.
//! A paragraph therefore holds at most one extra generation of clusters, shaping runs, geometry
//! and flow, and only while its positioning is owed.

use super::*;

/// Whether a preparation may leave positioning for later.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PositioningDemand {
    /// Publication, an inspection read, or a read that asks for glyph facts: position now.
    Now,
    /// A summary-only read or the frame's batch ahead of publication.
    Deferrable,
}

/// The facts of a positioning run that depend on which stages its preparation staged, captured
/// when the preparation decided to defer it: they cannot be recovered once those stages commit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct PositioningPlan {
    /// Only geometry changed, so the committed flow's lines are candidates for retention.
    pub retains_flow: bool,
    /// The new flow names the lines it recomposed, and nothing else invalidates the rest.
    pub recomposed_lines: bool,
}

/// Which stages' pending slots hold the value the committed positioned arena was built from.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct RetainedInputs {
    clusters: bool,
    shaping_runs: bool,
    geometry: bool,
    /// The flow and, beside it, the boundary shape that is its own output.
    flow: bool,
}

/// Whether the positioned arena describes the paragraph's current flow.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum PositioningState {
    #[default]
    Current,
    /// A read staged new layout and did not position it; every input positioning reads is
    /// still staged beside its committed predecessor.
    Skipped(PositioningPlan),
    /// That read committed. Its predecessors wait in the pending slots `RetainedInputs` names.
    Deferred(PositioningPlan, RetainedInputs),
}

impl ParagraphState {
    /// Whether positions must be brought up to date before anything reads them.
    pub(super) fn positioning_owed(&self) -> bool {
        self.positioning != PositioningState::Current
    }

    /// The plan positioning would follow if it ran now, from the stages this preparation staged.
    pub(super) fn positioning_plan(&self) -> PositioningPlan {
        PositioningPlan {
            retains_flow: self.geometry.is_prepared()
                && !self.clusters.is_prepared()
                && !self.text.is_prepared()
                && !self.styles.is_prepared()
                && !self.unicode.is_prepared()
                && !self.bidi.is_prepared()
                && !self.shape.is_prepared()
                && !self.shaping_runs.is_prepared()
                && !self.style_invalidation.metrics
                && !self.style_invalidation.positioning,
            recomposed_lines: self.flow_layout.is_prepared()
                && !self.style_invalidation.positioning,
        }
    }

    /// Leaves the staged layout unpositioned. The layout changed, so the derived clipped
    /// inspection retires exactly as positioning retires it.
    pub(super) fn skip_positioning(&mut self) {
        self.discard_positioned_candidate();
        self.positioning = PositioningState::Skipped(self.positioning_plan());
        self.clipped_inspection.pending_mut().mode = IntrinsicInspection::None;
        self.clipped_inspection.mark_prepared();
    }

    /// Commits a preparation whose positioning is owed. Every stage commits as `commit_all`
    /// commits it, except that the stages positioning compares against keep their retired value
    /// in the pending slot instead of clearing it.
    pub(super) fn commit_deferring_positioning(&mut self, plan: PositioningPlan) {
        let retained = RetainedInputs {
            clusters: self.clusters.is_prepared(),
            shaping_runs: self.shaping_runs.is_prepared(),
            geometry: self.geometry.is_prepared(),
            flow: self.flow_layout.is_prepared(),
        };
        self.commit_text();
        self.commit_styles();
        self.commit_unicode();
        self.commit_bidi();
        self.shaping_runs.commit();
        self.commit_shape();
        self.clusters.commit();
        // The cluster commit's bookkeeping, minus clearing the retired arena.
        self.next_run_canonical_revision = self.pending_next_run_canonical_revision;
        self.layout_dirty.clear();
        self.pending_source_run_canonical_revision = self.next_run_canonical_revision;
        self.geometry.commit();
        if retained.flow {
            core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
        }
        self.flow_layout.commit();
        self.commit_positioned();
        self.prepared_layout.commit();
        self.clipped_inspection.commit();
        self.positioning = PositioningState::Deferred(plan, retained);
    }

    /// Runs positioning that a read left owed, so positions describe the current flow.
    /// Positioning that is current costs a comparison.
    pub(super) fn settle_positioning(
        &mut self,
        shaper: &ShaperRegistry,
    ) -> Result<(), EngineError> {
        match self.positioning {
            PositioningState::Current => Ok(()),
            // The read is still in flight: its stages are staged as positioning expects.
            PositioningState::Skipped(plan) => self.position(shaper, plan),
            PositioningState::Deferred(plan, retained) => {
                if retained.clusters {
                    self.clusters.restore_candidate();
                }
                if retained.shaping_runs {
                    self.shaping_runs.restore_candidate();
                }
                if retained.geometry {
                    self.geometry.restore_candidate();
                }
                if retained.flow {
                    self.flow_layout.restore_candidate();
                    core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
                }
                let positioned = self.position(shaper, plan);
                // Whether or not it positioned, the restored stages are accepted again; a failed
                // positioning leaves the paragraph as a failed read would, for the caller to refuse.
                self.commit_shaping_runs();
                self.commit_clusters();
                self.commit_geometry();
                self.commit_flow_layout();
                self.commit_positioned();
                positioned
            }
        }
    }
}

impl TextEngine {
    /// Brings one paragraph's positions up to date before a read of glyphs, ink, copies or
    /// editing geometry. A failure is the root's: it is invalidated, as a failed publication
    /// invalidates it.
    pub(crate) fn settle_paragraph_positioning(
        &mut self,
        shaper: &ShaperRegistry,
        root_id: u32,
        paragraph_id: u32,
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get_mut(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let Some(paragraph) = planner.paragraph_mut(paragraph_id) else {
            // An unknown paragraph is the read's own error to report.
            return Ok(());
        };
        if let Err(error) = paragraph.state.settle_positioning(shaper) {
            self.invalidate_root(root_id)?;
            return Err(error);
        }
        Ok(())
    }

    /// Brings every paragraph of a root up to date, for a read that spans the root.
    pub(crate) fn settle_root_positioning(
        &mut self,
        shaper: &ShaperRegistry,
        root_id: u32,
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get_mut(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let settled = planner.settle_owed_positioning(shaper);
        if let Err(error) = settled {
            self.invalidate_root(root_id)?;
            return Err(error);
        }
        Ok(())
    }
}

impl PlannerState {
    /// Positions every paragraph a read left owed. Only a paragraph prepared since the last
    /// publication can owe positioning, so the unpublished frontier bounds the walk.
    pub(super) fn settle_owed_positioning(
        &mut self,
        shaper: &ShaperRegistry,
    ) -> Result<(), EngineError> {
        for index in 0..self.unpublished_preparation_ids.len() {
            let id = self.unpublished_preparation_ids[index];
            if let Some(paragraph) = self.paragraph_mut(id) {
                paragraph.state.settle_positioning(shaper)?;
            }
        }
        Ok(())
    }
}
