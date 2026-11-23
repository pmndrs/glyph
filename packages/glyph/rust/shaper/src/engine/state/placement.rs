//! Placement slots for a root's paragraphs and the commit that adopts every prepared paragraph.

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
        let mut sparse =
            !checkpoint && self.prepare_retained_order(RetainedOrderPurpose::Placement)?;
        let mut desired = core::mem::take(&mut self.desired_placements);
        let mut rows = core::mem::take(&mut self.session_placement_rows);
        desired.clear();
        rows.clear();
        let result = (|| {
            loop {
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
                    .try_reserve(required)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                rows.try_reserve(required)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                for index in 0..work_count {
                    let paragraph = self
                        .paragraph(self.placement_work_id(index, sparse))
                        .ok_or(EngineError::InvalidRequest)?;
                    #[cfg(test)]
                    crate::engine::work_attribution::record(|work| {
                        work.placement_key_owner_visits += 1
                    });
                    let positioned = paragraph.state.positioned.active();
                    for segment in paragraph.state.active_placement_segments() {
                        let run_index = usize::try_from(segment.layout_run_index)
                            .map_err(|_| EngineError::InvalidRequest)?;
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
                            LayoutRunOwner::Replacement => {
                                positioned.replacement_runs().get(run_index).copied()
                            }
                        }
                        .map(|run| run.source_kind)
                        .ok_or(EngineError::InvalidRequest)?;
                        desired.push(placement_logical_key(
                            paragraph.incarnation,
                            *segment,
                            run_source,
                        ));
                    }
                }
                if !sparse {
                    self.placement_slots
                        .prepare(&desired, publication_generation)
                        .map_err(placement_slot_error)?;
                    break;
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
                    .prepare_retained_subset(&desired, ranges, publication_generation)
                    .map_err(placement_slot_error)?
                {
                    break;
                }
                // Changed logical placement topology uses the same complete reconciliation.
                sparse = false;
            }
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
                for relative in 0..segment_count {
                    let translation = paragraph
                        .state
                        .active_placement_translations()
                        .get(relative)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?;
                    rows.push(SessionPlacementRow {
                        slot: assignments[assignment_start + relative].slot().get(),
                        inline: translation.translation_inline as f32,
                        block: translation.translation_block as f32,
                    });
                }
                if paragraph.state.active_inline().is_some() {
                    let assigned = &assignments[assignment_start..assignment_end];
                    let needs_binding = (0..segment_count).any(|relative| {
                        paragraph.state.active_placement_handle(relative)
                            != Some(assigned[relative])
                    });
                    if needs_binding {
                        admit_preparation_owner(
                            &mut self.pending_preparation_ids,
                            &mut self.unpublished_preparation_ids,
                            id,
                        )?;
                        paragraph.state.bind_inline_placement_handles(assigned)?;
                        paragraph.positioned_changed = true;
                    } else if paragraph.state.active_placement_instance_count()?
                        != paragraph.state.active_outlined_count()
                    {
                        return Err(EngineError::InvalidRequest);
                    }
                } else if paragraph.state.positioned.is_prepared() {
                    admit_preparation_owner(
                        &mut self.pending_preparation_ids,
                        &mut self.unpublished_preparation_ids,
                        id,
                    )?;
                    let (pending, _) = paragraph.state.positioned.derive_mut();
                    pending
                        .bind_placement_handles(&assignments[assignment_start..assignment_end])?;
                } else if preparation_changed {
                    let assigned = &assignments[assignment_start..assignment_end];
                    let requires_binding = {
                        let positioned = paragraph.state.positioned.committed();
                        (0..segment_count).any(|relative| {
                            positioned.placement_handle(relative) != Some(assigned[relative])
                        })
                    };
                    if requires_binding {
                        admit_preparation_owner(
                            &mut self.pending_preparation_ids,
                            &mut self.unpublished_preparation_ids,
                            id,
                        )?;
                        let state = &mut paragraph.state;
                        state
                            .positioned
                            .active_mut()
                            .bind_placement_handles(assigned)?;
                        paragraph.positioned_changed = true;
                    } else if paragraph
                        .state
                        .positioned
                        .committed()
                        .placement_instance_count()?
                        != paragraph.state.positioned.committed().outlined_count()
                    {
                        return Err(EngineError::InvalidRequest);
                    }
                } else {
                    let positioned = paragraph.state.positioned.committed();
                    for relative in 0..segment_count {
                        if positioned.placement_handle(relative)
                            != Some(assignments[assignment_start + relative])
                        {
                            return Err(EngineError::InvalidRequest);
                        }
                    }
                    if positioned.placement_instance_count()? != positioned.outlined_count() {
                        return Err(EngineError::InvalidRequest);
                    }
                }
                assignment_start = assignment_end;
            }
            if sparse
                && self
                    .plan
                    .requires_complete_placement_rows(self.pending_placement_slot_count, checkpoint)
            {
                rows.clear();
                for entry in active_order {
                    let paragraph_index = paragraphs
                        .binary_search_by_key(&entry.id, |paragraph| paragraph.id)
                        .map_err(|_| EngineError::InvalidRequest)?;
                    let state = &paragraphs[paragraph_index].state;
                    rows.try_reserve(state.active_placement_segments().len())
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    for (relative, translation) in
                        state.active_placement_translations().iter().enumerate()
                    {
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
            }
            sort_session_placement_rows(&mut rows, &mut self.rank_sort_scratch)?;
            if assignment_start != assignment_count {
                return Err(EngineError::InvalidRequest);
            }
            Ok(())
        })();
        self.desired_placements = desired;
        self.session_placement_rows = rows;
        result
    }

    pub(super) fn commit_paragraphs(&mut self, publishing: bool) {
        if publishing {
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
                if let Ok(index) = self
                    .paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                {
                    #[cfg(test)]
                    crate::engine::work_attribution::record(|work| {
                        work.publication_commit_visits += 1
                    });
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
            }
            self.unpublished_preparation_ids.clear();
        } else {
            // Paragraph IDs survive lifecycle ordering changes. Resolve only the prepared nodes;
            // lifecycle adoption below independently owns creation, removal and ordering.
            for id in &self.pending_preparation_ids {
                if let Ok(index) = self
                    .paragraphs
                    .binary_search_by_key(id, |paragraph| paragraph.id)
                {
                    let paragraph = &mut self.paragraphs[index];
                    let was_unpublished = paragraph.preparation_changed_since_publication;
                    paragraph.commit_preparation(false);
                    if !was_unpublished && paragraph.preparation_changed_since_publication {
                        // Admission reserved the worst-case union before any pending state changed.
                        self.unpublished_preparation_ids.push(*id);
                    }
                }
            }
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
