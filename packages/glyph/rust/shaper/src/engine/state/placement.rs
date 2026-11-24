//! Placement slots for a root's paragraphs and the commit that adopts every prepared paragraph.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl PlannerState {
    pub(super) fn placement_work_id(&self, index: usize, sparse: bool) -> u32 {
        if sparse {
            self.order_sort_scratch[index].1
        } else {
            self.active_order()[index].id
        }
    }

    pub(super) fn prepare_placement_slots(
        &mut self,
        publication_generation: u32,
        preparation_changed: bool,
        checkpoint: bool,
    ) -> Result<(), EngineError> {
        let sparse = !checkpoint && self.prepare_retained_order(RetainedOrderPurpose::Placement)?;
        let mut desired = core::mem::take(&mut self.desired_placements);
        let mut rows = core::mem::take(&mut self.session_placement_rows);
        desired.clear();
        rows.clear();
        let result = self.prepare_placement_slots_into(
            &mut desired,
            &mut rows,
            publication_generation,
            preparation_changed,
            checkpoint,
            sparse,
        );
        self.desired_placements = desired;
        self.session_placement_rows = rows;
        result
    }

    #[inline(always)]
    fn prepare_placement_slots_into(
        &mut self,
        desired: &mut Vec<PlacementLogicalKey>,
        rows: &mut Vec<SessionPlacementRow>,
        publication_generation: u32,
        preparation_changed: bool,
        checkpoint: bool,
        sparse: bool,
    ) -> Result<(), EngineError> {
        let sparse =
            self.reconcile_placement_slots(desired, rows, publication_generation, sparse)?;
        self.pending_placement_ranges_refresh = !sparse;
        let assignments = self
            .placement_slots
            .assignments()
            .map_err(placement_slot_error)?;
        let assignment_count = assignments.len();
        if assignment_count != desired.len() {
            return Err(EngineError::InvalidRequest);
        }
        self.pending_placement_slot_count = self
            .placement_slots
            .required_slots()
            .map_err(placement_slot_error)?;
        let work_count = if sparse {
            self.order_sort_scratch.len()
        } else {
            self.active_order().len()
        };
        let active_order = if self.lifecycle_prepared {
            &self.pending_ordered_paragraphs
        } else {
            &self.ordered_paragraphs
        };
        let paragraphs = &mut self.paragraphs;
        let mut owners = PreparationOwners {
            pending: &mut self.pending_preparation_ids,
            unpublished: &mut self.unpublished_preparation_ids,
        };
        let mut assignment_start = 0usize;
        let work_ids = (0..work_count).map(|index| {
            if sparse {
                self.order_sort_scratch[index].1
            } else {
                active_order[index].id
            }
        });
        for id in work_ids {
            let paragraph_index = paragraphs
                .binary_search_by_key(&id, |paragraph| paragraph.id)
                .map_err(|_| EngineError::InvalidRequest)?;
            let paragraph = &mut paragraphs[paragraph_index];
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.placement_binding_owner_visits += 1
            });
            let segment_count = paragraph.state.active_placement_segments().len();
            let assignment_end = assignment_start
                .checked_add(segment_count)
                .ok_or(EngineError::ResultTooLarge)?;
            let assigned = &assignments[assignment_start..assignment_end];
            push_placement_rows(rows, &paragraph.state, assigned)?;
            bind_paragraph_placements(paragraph, id, assigned, preparation_changed, &mut owners)?;
            assignment_start = assignment_end;
        }
        if sparse
            && self
                .plan
                .requires_complete_placement_rows(self.pending_placement_slot_count, checkpoint)
        {
            complete_placement_rows(rows, active_order, paragraphs)?;
        }
        sort_session_placement_rows(rows, &mut self.rank_sort_scratch)?;
        if assignment_start != assignment_count {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    /// Prepares the slot arena for the desired placements: the retained subset when `sparse`
    /// admits it, otherwise the complete reconciliation. Returns whether the subset held.
    #[inline(always)]
    fn reconcile_placement_slots(
        &mut self,
        desired: &mut Vec<PlacementLogicalKey>,
        rows: &mut Vec<SessionPlacementRow>,
        publication_generation: u32,
        mut sparse: bool,
    ) -> Result<bool, EngineError> {
        loop {
            self.desired_placement_keys(desired, rows, sparse)?;
            if !sparse {
                self.placement_slots
                    .prepare(desired, publication_generation)
                    .map_err(placement_slot_error)?;
                return Ok(false);
            }
            let paragraphs = &self.paragraphs;
            let ranges = self.order_sort_scratch.iter().map(|(_, id)| {
                paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                    .ok()
                    .map(|index| paragraphs[index].placement_range)
                    .map(|range| range.start..range.end)
            });
            if self
                .placement_slots
                .prepare_retained_subset(desired, ranges, publication_generation)
                .map_err(placement_slot_error)?
            {
                return Ok(true);
            }
            // Changed logical placement topology uses the same complete reconciliation.
            sparse = false;
        }
    }

    /// The logical keys of every placement segment of the work order, in order, with room
    /// reserved for their session rows.
    #[inline(always)]
    fn desired_placement_keys(
        &self,
        desired: &mut Vec<PlacementLogicalKey>,
        rows: &mut Vec<SessionPlacementRow>,
        sparse: bool,
    ) -> Result<(), EngineError> {
        desired.clear();
        let work_count = if sparse {
            self.order_sort_scratch.len()
        } else {
            self.active_order().len()
        };
        let required = (0..work_count).try_fold(0usize, |total, index| {
            let id = self.placement_work_id(index, sparse);
            let paragraph = self.paragraph(id).ok_or(EngineError::InvalidRequest)?;
            total
                .checked_add(paragraph.state.active_placement_segments().len())
                .ok_or(EngineError::ResultTooLarge)
        })?;
        desired
            .try_reserve_cold(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        rows.try_reserve_cold(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        for index in 0..work_count {
            let paragraph = self
                .paragraph(self.placement_work_id(index, sparse))
                .ok_or(EngineError::InvalidRequest)?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.placement_key_owner_visits += 1);
            push_placement_keys(desired, paragraph)?;
        }
        Ok(())
    }

    pub(super) fn commit_paragraphs(&mut self, publishing: bool) {
        if publishing {
            self.commit_published_preparations();
        } else {
            self.commit_measured_preparations();
        }
        self.pending_preparation_ids.clear();
        if !self.lifecycle_prepared {
            return;
        }
        // A measure-time lifecycle adoption changes renderer order without replacing the
        // gathered workspace. Its old interval endpoints cannot authorize bulk skipping.
        if !publishing && self.lifecycle_changed {
            self.gathered_source_count = None;
            self.placement_ranges_current = false;
        }
        self.adopt_lifecycle();
    }

    /// A publication commits every paragraph it prepared and settles every one a read prepared
    /// since the last publication.
    #[inline(always)]
    fn commit_published_preparations(&mut self) {
        for id in &self.pending_preparation_ids {
            let Ok(index) = self
                .paragraphs
                .binary_search_by_key(id, |paragraph| paragraph.id)
            else {
                continue;
            };
            let paragraph = &mut self.paragraphs[index];
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.publication_commit_visits += 1);
            paragraph.commit_preparation(true);
        }
        for id in &self.unpublished_preparation_ids {
            // The pending frontier settled this owner, including a newer candidate.
            if self.pending_preparation_ids.binary_search(id).is_ok() {
                continue;
            }
            let Ok(index) = self
                .paragraphs
                .binary_search_by_key(id, |paragraph| paragraph.id)
            else {
                continue;
            };
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.publication_commit_visits += 1);
            let paragraph = &mut self.paragraphs[index];
            if !paragraph.state.has_pending_preparation()
                && !paragraph.state.clipped_inspection.is_prepared()
                && !paragraph.positioned_changed
            {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.publication_ack_only_visits += 1
                });
                paragraph.acknowledge_committed_preparation();
            } else {
                paragraph.commit_preparation(true);
            }
        }
        self.unpublished_preparation_ids.clear();
    }

    /// A read commits the paragraphs it prepared and remembers the ones its commit left
    /// unpublished.
    #[inline(always)]
    fn commit_measured_preparations(&mut self) {
        // Paragraph IDs survive lifecycle ordering changes. Resolve only the prepared nodes;
        // lifecycle adoption below independently owns creation, removal and ordering.
        for id in &self.pending_preparation_ids {
            let Ok(index) = self
                .paragraphs
                .binary_search_by_key(id, |paragraph| paragraph.id)
            else {
                continue;
            };
            let paragraph = &mut self.paragraphs[index];
            let was_unpublished = paragraph.preparation_changed_since_publication;
            paragraph.commit_preparation(false);
            if !was_unpublished && paragraph.preparation_changed_since_publication {
                // Admission reserved the worst-case union before any pending state changed.
                self.unpublished_preparation_ids.push(*id);
            }
        }
    }

    /// Adopts the prepared lifecycle: removes retired paragraphs, adopts pending placements and
    /// the pending renderer order.
    #[inline(always)]
    fn adopt_lifecycle(&mut self) {
        let mut index = 0;
        while index < self.paragraphs.len() {
            if self.paragraphs[index].pending_remove {
                let paragraph = self.paragraphs.remove(index);
                // Measurement may adopt removal before publication. Retire its identity before reuse.
                self.unpublished_preparation_ids
                    .retain(|id| *id != paragraph.id);
                if self.spare_paragraph.is_none() {
                    self.spare_paragraph = Some(paragraph.state);
                }
            } else {
                let paragraph = &mut self.paragraphs[index];
                if let Some(placement) = paragraph.pending_placement.take() {
                    paragraph.placement = placement;
                }
                paragraph.created = false;
                index += 1;
            }
        }
        core::mem::swap(
            &mut self.ordered_paragraphs,
            &mut self.pending_ordered_paragraphs,
        );
        for index in 0..self.ordered_paragraphs.len() {
            let id = self.ordered_paragraphs[index].id;
            if let Some(paragraph) = self.paragraph_mut(id) {
                paragraph.renderer_order_index = index;
            }
        }
        self.next_paragraph_incarnation = self.pending_next_paragraph_incarnation;
        self.pending_next_paragraph_incarnation = 0;
        self.pending_ordered_paragraphs.clear();
        self.rank_sort_scratch.clear();
        self.ranked_paragraphs.clear();
        self.lifecycle_prepared = false;
        self.lifecycle_changed = false;
    }
}

/// The preparation owner sets a placement binding admits a paragraph into.
struct PreparationOwners<'a> {
    pending: &'a mut Vec<u32>,
    unpublished: &'a mut Vec<u32>,
}

impl PreparationOwners<'_> {
    #[inline(always)]
    fn admit(&mut self, paragraph_id: u32) -> Result<(), EngineError> {
        admit_preparation_owner(self.pending, self.unpublished, paragraph_id)
    }
}

/// Pushes the logical key of each of the paragraph's placement segments.
#[inline(always)]
fn push_placement_keys(
    desired: &mut Vec<PlacementLogicalKey>,
    paragraph: &RetainedParagraph,
) -> Result<(), EngineError> {
    let positioned = paragraph.state.positioned.active();
    for segment in paragraph.state.active_placement_segments() {
        let run_index =
            usize::try_from(segment.layout_run_index).map_err(|_| EngineError::InvalidRequest)?;
        let run_source = match segment.layout_run_owner {
            LayoutRunOwner::Paragraph => {
                if let Some(leaf) = paragraph.state.active_inline() {
                    (run_index == 0).then_some(leaf.layout_run).flatten()
                } else {
                    paragraph
                        .state
                        .clusters
                        .active()
                        .layout_runs()
                        .get(run_index)
                        .copied()
                }
            }
            LayoutRunOwner::Replacement => positioned.replacement_runs().get(run_index).copied(),
        }
        .map(|run| run.source_kind)
        .ok_or(EngineError::InvalidRequest)?;
        desired.push(placement_logical_key(
            paragraph.incarnation,
            *segment,
            run_source,
        ));
    }
    Ok(())
}

/// Pushes one session row per placement segment, at its assigned slot.
#[inline(always)]
fn push_placement_rows(
    rows: &mut Vec<SessionPlacementRow>,
    state: &ParagraphState,
    assigned: &[crate::engine::placement_slot_arena::PlacementHandle],
) -> Result<(), EngineError> {
    for (relative, handle) in assigned.iter().enumerate() {
        let translation = state
            .active_placement_translations()
            .get(relative)
            .copied()
            .ok_or(EngineError::InvalidRequest)?;
        rows.push(SessionPlacementRow {
            slot: handle.slot().get(),
            inline: translation.translation_inline as f32,
            block: translation.translation_block as f32,
        });
    }
    Ok(())
}

/// Binds the paragraph's placement handles to their assigned slots where they moved, admitting
/// the paragraph as a preparation owner when it must republish, and refuses a paragraph whose
/// committed handles disagree with an assignment it is not allowed to rebind.
#[inline(always)]
fn bind_paragraph_placements(
    paragraph: &mut RetainedParagraph,
    id: u32,
    assigned: &[crate::engine::placement_slot_arena::PlacementHandle],
    preparation_changed: bool,
    owners: &mut PreparationOwners<'_>,
) -> Result<(), EngineError> {
    let moved =
        |handle: &dyn Fn(usize) -> Option<crate::engine::placement_slot_arena::PlacementHandle>| {
            assigned
                .iter()
                .enumerate()
                .any(|(relative, assigned)| handle(relative) != Some(*assigned))
        };
    if paragraph.state.active_inline().is_some() {
        if moved(&|relative| paragraph.state.active_placement_handle(relative)) {
            owners.admit(id)?;
            paragraph.state.bind_inline_placement_handles(assigned)?;
            paragraph.positioned_changed = true;
        } else if paragraph.state.active_placement_instance_count()?
            != paragraph.state.active_outlined_count()
        {
            return Err(EngineError::InvalidRequest);
        }
        return Ok(());
    }
    if paragraph.state.positioned.is_prepared() {
        owners.admit(id)?;
        let (pending, _) = paragraph.state.positioned.derive_mut();
        return pending.bind_placement_handles(assigned);
    }
    let positioned = paragraph.state.positioned.committed();
    if preparation_changed {
        if moved(&|relative| positioned.placement_handle(relative)) {
            owners.admit(id)?;
            paragraph
                .state
                .positioned
                .active_mut()
                .bind_placement_handles(assigned)?;
            paragraph.positioned_changed = true;
        } else if positioned.placement_instance_count()? != positioned.outlined_count() {
            return Err(EngineError::InvalidRequest);
        }
        return Ok(());
    }
    if moved(&|relative| positioned.placement_handle(relative))
        || positioned.placement_instance_count()? != positioned.outlined_count()
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}

/// Replaces `rows` with one row per placement segment of every active paragraph, at its bound
/// slot: a retained subset cannot patch rows the plan must see complete.
#[inline(always)]
fn complete_placement_rows(
    rows: &mut Vec<SessionPlacementRow>,
    active_order: &[ParagraphOrder],
    paragraphs: &[Box<RetainedParagraph>],
) -> Result<(), EngineError> {
    rows.clear();
    for entry in active_order {
        let paragraph_index = paragraphs
            .binary_search_by_key(&entry.id, |paragraph| paragraph.id)
            .map_err(|_| EngineError::InvalidRequest)?;
        let state = &paragraphs[paragraph_index].state;
        rows.try_reserve_cold(state.active_placement_segments().len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for (relative, translation) in state.active_placement_translations().iter().enumerate() {
            let handle = state
                .active_placement_handle(relative)
                .ok_or(EngineError::InvalidRequest)?;
            rows.push(SessionPlacementRow {
                slot: handle.slot().get(),
                inline: translation.translation_inline as f32,
                block: translation.translation_block as f32,
            });
        }
    }
    Ok(())
}
