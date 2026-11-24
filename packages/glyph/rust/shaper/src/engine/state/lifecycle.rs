//! Paragraph lifecycle requests: creation, upsert and removal, validated against the planner.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl PlannerState {
    pub(super) fn prepare_lifecycle(
        &mut self,
        mutations: crate::engine::semantic_wire::ParagraphMutationBatch<'_>,
        order_mutations: crate::engine::semantic_wire::ParagraphOrderMutationBatch<'_>,
        implicit_paragraph: Option<u32>,
        max_paragraphs: u32,
        plan: LifecyclePlan,
        spare_text_candidate_id: Option<u32>,
    ) -> Result<(), EngineError> {
        if self.lifecycle_prepared {
            return Err(EngineError::InvalidRequest);
        }
        if mutations.len() == 0 && order_mutations.len() == 0 && implicit_paragraph.is_none() {
            return Ok(());
        }
        let LifecyclePlan {
            creates,
            removals,
            placement_changes,
            ordered,
        } = plan;
        if placement_changes == 0 && removals == 0 {
            return Ok(());
        }
        self.lifecycle_prepared = true;
        self.pending_next_paragraph_incarnation = self.next_paragraph_incarnation.max(1);
        let final_count = self
            .paragraphs
            .len()
            .checked_add(creates)
            .and_then(|count| count.checked_sub(removals))
            .ok_or(EngineError::InvalidRequest)?;
        if final_count > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)? {
            return Err(EngineError::InvalidRequest);
        }
        self.paragraphs
            .try_reserve_cold(creates)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.pending_ordered_paragraphs = ordered;
        if self.pending_ordered_paragraphs.len() != final_count {
            return Err(EngineError::InvalidRequest);
        }
        self.rank_sort_scratch
            .try_reserve_cold(final_count)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.ranked_paragraphs
            .try_reserve_cold(final_count)
            .map_err(|_| EngineError::ResultTooLarge)?;

        for index in 0..mutations.len() {
            match mutations.get(index).ok_or(EngineError::InvalidRequest)? {
                crate::engine::semantic_wire::ParagraphMutation::Upsert {
                    paragraph_id,
                    order,
                } => self.prepare_upsert(paragraph_id, order, false)?,
                crate::engine::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                    self.paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?
                        .pending_remove = true;
                }
            }
        }
        for index in 0..order_mutations.len() {
            let mutation = order_mutations
                .get(index)
                .ok_or(EngineError::InvalidRequest)?;
            self.prepare_order(mutation.paragraph_id, mutation.scope, mutation.rank)?;
        }
        if let Some(paragraph_id) = implicit_paragraph
            && self.paragraph(paragraph_id).is_none()
        {
            self.prepare_upsert(
                paragraph_id,
                0,
                spare_text_candidate_id == Some(paragraph_id),
            )?;
        }

        self.ranked_paragraphs.clear();
        for (slot, ordered) in self.pending_ordered_paragraphs.iter().enumerate() {
            let paragraph = self
                .paragraph(ordered.id)
                .ok_or(EngineError::InvalidRequest)?;
            let placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
            if placement.scope == 0 {
                continue;
            }
            self.ranked_paragraphs.push(RankedParagraph {
                scope: placement.scope,
                id: paragraph.id,
                rank: placement.rank,
                slot: u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
                order: ordered.order,
            });
        }
        sort::prepare_pairs(&mut self.rank_sort_scratch, self.ranked_paragraphs.len())?;
        for (index, ranked) in self.ranked_paragraphs.iter().enumerate() {
            self.rank_sort_scratch
                .push((sort::f64_key(ranked.rank), index as u32));
        }
        sort::sort_pairs(&mut self.rank_sort_scratch);
        let one_scope = self.ranked_paragraphs.first().is_none_or(|first| {
            self.ranked_paragraphs
                .iter()
                .all(|ranked| ranked.scope == first.scope)
        });
        if one_scope {
            for (destination, &(_, source)) in
                self.ranked_paragraphs.iter().zip(&self.rank_sort_scratch)
            {
                let source = usize::try_from(source).map_err(|_| EngineError::InvalidRequest)?;
                let ranked = self.ranked_paragraphs[source];
                self.pending_ordered_paragraphs[destination.slot as usize] = ParagraphOrder {
                    order: ranked.order,
                    id: ranked.id,
                };
            }
        } else {
            sort::apply_pair_order(&mut self.ranked_paragraphs, &mut self.rank_sort_scratch);
            sort::prepare_pairs(&mut self.rank_sort_scratch, self.ranked_paragraphs.len())?;
            for (index, ranked) in self.ranked_paragraphs.iter().enumerate() {
                self.rank_sort_scratch
                    .push((u64::from(ranked.scope), index as u32));
            }
            sort::sort_pairs(&mut self.rank_sort_scratch);
            sort::apply_pair_order(&mut self.ranked_paragraphs, &mut self.rank_sort_scratch);
            sort::prepare_pairs(&mut self.order_sort_scratch, self.ranked_paragraphs.len())?;
            for ranked in &self.ranked_paragraphs {
                self.order_sort_scratch
                    .push((sort::pack2(ranked.scope, ranked.slot), ranked.slot));
            }
            sort::sort_pairs(&mut self.order_sort_scratch);
            for (&(_, destination), ranked) in
                self.order_sort_scratch.iter().zip(&self.ranked_paragraphs)
            {
                let destination =
                    usize::try_from(destination).map_err(|_| EngineError::InvalidRequest)?;
                self.pending_ordered_paragraphs[destination] = ParagraphOrder {
                    order: ranked.order,
                    id: ranked.id,
                };
            }
        }
        self.lifecycle_changed = self.pending_ordered_paragraphs != self.ordered_paragraphs;
        Ok(())
    }

    pub(super) fn prepare_upsert(
        &mut self,
        id: u32,
        order: u32,
        preserve_spare_text_candidate: bool,
    ) -> Result<(), EngineError> {
        match self
            .paragraphs
            .binary_search_by_key(&id, |paragraph| paragraph.id)
        {
            Ok(index) => {
                let mut placement = self.paragraphs[index]
                    .pending_placement
                    .unwrap_or(self.paragraphs[index].placement);
                placement.order = order;
                self.paragraphs[index].pending_placement = Some(placement);
                Ok(())
            }
            Err(index) => {
                let incarnation =
                    ParagraphIncarnation::allocate(&mut self.pending_next_paragraph_incarnation)?;
                let state = if let Some(spare) = self.spare_paragraph.take() {
                    let mut spare = spare;
                    if preserve_spare_text_candidate {
                        spare.reset_for_reuse_preserving_text_candidate();
                    } else {
                        spare.reset_for_reuse();
                    }
                    spare
                } else {
                    // Only the reusable spare is prewarmed. New retained paragraphs grow
                    // each arena from their actual content instead of paying planner defaults.
                    ParagraphState::empty()
                };
                self.paragraphs.insert(
                    index,
                    RetainedParagraph::created(id, incarnation, order, state),
                );
                Ok(())
            }
        }
    }
}

pub(super) fn implicit_paragraph_id(
    planner: &PlannerState,
    request: UpdateRequest<'_>,
) -> Result<Option<u32>, EngineError> {
    if request.paragraph_mutations.len() == 0 && planner.paragraphs.is_empty() {
        request_semantic_paragraph_id(request)
    } else {
        Ok(None)
    }
}

pub(super) fn planner_contains_after_lifecycle(planner: &PlannerState, paragraph_id: u32) -> bool {
    planner
        .lifecycle_membership_scratch
        .binary_search(&paragraph_id)
        .is_ok()
}

pub(super) fn validate_lifecycle_input(
    planner: &mut PlannerState,
    mutations: crate::engine::semantic_wire::ParagraphMutationBatch<'_>,
    order_mutations: crate::engine::semantic_wire::ParagraphOrderMutationBatch<'_>,
    implicit_paragraph: Option<u32>,
    max_paragraphs: u32,
) -> Result<LifecyclePlan, EngineError> {
    if mutations.len() == 0 && order_mutations.len() == 0 && implicit_paragraph.is_none() {
        if planner.ordered_paragraphs.len()
            > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)?
        {
            return Err(EngineError::InvalidRequest);
        }
        return Ok(LifecyclePlan {
            creates: 0,
            removals: 0,
            placement_changes: 0,
            ordered: Vec::new(),
        });
    }

    planner.lifecycle_id_scratch.clear();
    planner
        .lifecycle_id_scratch
        .try_reserve_cold(mutations.len().max(order_mutations.len()))
        .map_err(|_| EngineError::ResultTooLarge)?;
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        let paragraph_id = match mutation {
            crate::engine::semantic_wire::ParagraphMutation::Upsert { paragraph_id, .. }
            | crate::engine::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                paragraph_id
            }
        };
        planner.lifecycle_id_scratch.push((
            u64::from(paragraph_id),
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(&mut planner.lifecycle_id_scratch);
    if planner
        .lifecycle_id_scratch
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0)
    {
        return Err(EngineError::InvalidRequest);
    }

    planner.lifecycle_membership_scratch.clear();
    planner
        .lifecycle_membership_scratch
        .try_reserve_cold(planner.ordered_paragraphs.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    planner
        .lifecycle_membership_scratch
        .extend(planner.ordered_paragraphs.iter().map(|item| item.id));
    planner.lifecycle_membership_scratch.sort_unstable();

    let mut creates = usize::from(implicit_paragraph.is_some_and(|id| {
        planner
            .lifecycle_membership_scratch
            .binary_search(&id)
            .is_err()
    }));
    let mut removals = 0usize;
    let mut placement_changes = creates;
    for index in 0..mutations.len() {
        let mutation = mutations.get(index).ok_or(EngineError::InvalidRequest)?;
        match mutation {
            crate::engine::semantic_wire::ParagraphMutation::Upsert {
                paragraph_id,
                order,
            } => {
                let current = planner
                    .paragraph(paragraph_id)
                    .filter(|paragraph| !paragraph.created);
                creates += usize::from(current.is_none());
                placement_changes += current.map_or(1, |paragraph| {
                    usize::from(paragraph.placement.order != order)
                });
            }
            crate::engine::semantic_wire::ParagraphMutation::Remove { paragraph_id } => {
                if planner
                    .lifecycle_membership_scratch
                    .binary_search(&paragraph_id)
                    .is_err()
                {
                    return Err(EngineError::InvalidRequest);
                }
                removals += 1;
            }
        }
    }
    let final_count = planner
        .ordered_paragraphs
        .len()
        .checked_add(creates)
        .and_then(|count| count.checked_sub(removals))
        .ok_or(EngineError::InvalidRequest)?;
    if final_count > usize::try_from(max_paragraphs).map_err(|_| EngineError::InvalidRequest)? {
        return Err(EngineError::InvalidRequest);
    }
    planner.pending_ordered_paragraphs.clear();
    planner
        .pending_ordered_paragraphs
        .try_reserve_cold(final_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    for current in &planner.ordered_paragraphs {
        let mutation_index = planner
            .lifecycle_id_scratch
            .binary_search_by_key(&u64::from(current.id), |entry| entry.0)
            .ok()
            .map(|position| planner.lifecycle_id_scratch[position].1);
        let mutation = mutation_index
            .map(|index| {
                mutations
                    .get(usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)
            })
            .transpose()?;
        match mutation {
            Some(crate::engine::semantic_wire::ParagraphMutation::Remove { .. }) => {}
            Some(crate::engine::semantic_wire::ParagraphMutation::Upsert { order, .. }) => {
                planner.pending_ordered_paragraphs.push(ParagraphOrder {
                    order,
                    id: current.id,
                });
            }
            None => {
                planner.pending_ordered_paragraphs.push(*current);
            }
        }
    }
    for index in 0..mutations.len() {
        if let Some(crate::engine::semantic_wire::ParagraphMutation::Upsert {
            paragraph_id,
            order,
        }) = mutations.get(index)
            && planner
                .lifecycle_membership_scratch
                .binary_search(&paragraph_id)
                .is_err()
        {
            planner.pending_ordered_paragraphs.push(ParagraphOrder {
                order,
                id: paragraph_id,
            });
        }
    }
    if let Some(paragraph_id) = implicit_paragraph
        && planner
            .lifecycle_membership_scratch
            .binary_search(&paragraph_id)
            .is_err()
        && planner
            .lifecycle_id_scratch
            .binary_search_by_key(&u64::from(paragraph_id), |entry| entry.0)
            .is_err()
    {
        planner.pending_ordered_paragraphs.push(ParagraphOrder {
            order: 0,
            id: paragraph_id,
        });
    }
    if planner.pending_ordered_paragraphs.len() != final_count {
        return Err(EngineError::InvalidRequest);
    }
    if planner.pending_ordered_paragraphs.len() > 1 {
        sort::prepare_pairs(
            &mut planner.rank_sort_scratch,
            planner.pending_ordered_paragraphs.len(),
        )?;
        for (index, paragraph) in planner.pending_ordered_paragraphs.iter().enumerate() {
            planner
                .rank_sort_scratch
                .push((sort::pack2(paragraph.order, paragraph.id), index as u32));
        }
        sort::sort_pairs(&mut planner.rank_sort_scratch);
        sort::apply_pair_order(
            &mut planner.pending_ordered_paragraphs,
            &mut planner.rank_sort_scratch,
        );
    }
    planner.lifecycle_membership_scratch.clear();
    planner
        .lifecycle_membership_scratch
        .try_reserve_cold(final_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    planner.lifecycle_membership_scratch.extend(
        planner
            .pending_ordered_paragraphs
            .iter()
            .map(|paragraph| paragraph.id),
    );
    planner.lifecycle_membership_scratch.sort_unstable();
    if planner
        .lifecycle_membership_scratch
        .windows(2)
        .any(|pair| pair[0] == pair[1])
    {
        return Err(EngineError::InvalidRequest);
    }
    planner.lifecycle_id_scratch.clear();
    planner
        .lifecycle_id_scratch
        .try_reserve_cold(order_mutations.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    for index in 0..order_mutations.len() {
        let mutation = order_mutations
            .get(index)
            .ok_or(EngineError::InvalidRequest)?;
        planner.lifecycle_id_scratch.push((
            u64::from(mutation.paragraph_id),
            u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
        ));
    }
    sort::sort_pairs(&mut planner.lifecycle_id_scratch);
    if planner
        .lifecycle_id_scratch
        .windows(2)
        .any(|pair| pair[0].0 == pair[1].0)
    {
        return Err(EngineError::InvalidRequest);
    }
    for &(_, index) in planner.lifecycle_id_scratch.iter() {
        let mutation = order_mutations
            .get(usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        if !mutation.rank.is_finite() {
            return Err(EngineError::InvalidRequest);
        }
        if planner
            .lifecycle_membership_scratch
            .binary_search(&mutation.paragraph_id)
            .is_err()
        {
            return Err(EngineError::InvalidRequest);
        }
        placement_changes += planner
            .paragraph(mutation.paragraph_id)
            .filter(|paragraph| !paragraph.created)
            .map_or(1, |paragraph| {
                usize::from(
                    paragraph.placement.scope != mutation.scope
                        || paragraph.placement.rank != mutation.rank,
                )
            });
    }
    for pair in planner.pending_ordered_paragraphs.windows(2) {
        if pair[0].order != pair[1].order {
            continue;
        }
        let left = planned_paragraph_rank(
            planner,
            order_mutations,
            &planner.lifecycle_id_scratch,
            pair[0].id,
        )?;
        let right = planned_paragraph_rank(
            planner,
            order_mutations,
            &planner.lifecycle_id_scratch,
            pair[1].id,
        )?;
        if left.0 == right.0 && left.1 == right.1 {
            return Err(EngineError::InvalidRequest);
        }
    }
    if placement_changes == 0 && removals == 0 {
        return Ok(LifecyclePlan {
            creates,
            removals,
            placement_changes,
            ordered: Vec::new(),
        });
    }
    if planner.lifecycle_prepared {
        return Err(EngineError::InvalidRequest);
    }
    Ok(LifecyclePlan {
        creates,
        removals,
        placement_changes,
        ordered: core::mem::take(&mut planner.pending_ordered_paragraphs),
    })
}
