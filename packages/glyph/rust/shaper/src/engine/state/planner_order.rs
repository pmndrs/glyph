//! Ordering retained paragraphs: the replacement, retained and semantic work orders of a root.

use super::*;

pub(super) fn sort_session_placement_rows(
    rows: &mut [SessionPlacementRow],
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    if rows.windows(2).any(|pair| pair[0].slot >= pair[1].slot) {
        sort::prepare_pairs(sort_pairs, rows.len())?;
        for (index, row) in rows.iter().enumerate() {
            sort_pairs.push((u64::from(row.slot), index as u32));
        }
        sort::sort_pairs(sort_pairs);
        sort::apply_pair_order(rows, sort_pairs);
    }
    Ok(())
}

pub(super) fn placement_logical_key(
    paragraph: ParagraphIncarnation,
    segment: PlacementSegment,
    run_source: LayoutRunSourceKind,
) -> PlacementLogicalKey {
    PlacementLogicalKey {
        paragraph,
        run_owner: segment.layout_run_owner,
        run_source,
        identity: segment.identity,
        segment_anchor: segment.segment_anchor,
        source_anchor: segment.source_anchor,
        numeric_block_ordinal: segment.numeric_block_ordinal,
        glyph_source: segment.glyph_source,
    }
}
impl PlannerState {
    /// A count-changing frontier shares one envelope and a clean cached suffix.
    pub(super) fn prepare_replacement_gather_order(
        &mut self,
    ) -> Result<Option<usize>, EngineError> {
        let Some(mut count) = self.gathered_source_count else {
            return Ok(None);
        };
        if !self.prepare_retained_order(RetainedOrderPurpose::ReplacementGather)? {
            return Ok(None);
        }
        if self.order_sort_scratch.is_empty() {
            return Ok(None);
        }
        let mut changed_count = false;
        for entry in &self.order_sort_scratch {
            let paragraph = self.paragraph(entry.1).ok_or(EngineError::InvalidRequest)?;
            let range = paragraph.gather_range.ok_or(EngineError::InvalidRequest)?;
            let next_count = paragraph.state.active_outlined_count();
            changed_count |= range.source_count() != next_count;
            count = count
                .checked_sub(range.source_count())
                .and_then(|count| count.checked_add(next_count))
                .ok_or(EngineError::ResultTooLarge)?;
        }
        Ok(changed_count.then_some(count))
    }

    /// Reuse renderer order and the preparation frontier without inspecting clean owners.
    pub(super) fn prepare_retained_order(
        &mut self,
        purpose: RetainedOrderPurpose,
    ) -> Result<bool, EngineError> {
        if self.lifecycle_changed
            || match purpose {
                RetainedOrderPurpose::Gather | RetainedOrderPurpose::ReplacementGather => {
                    self.gathered_source_count.is_none()
                }
                RetainedOrderPurpose::Placement => !self.placement_ranges_current,
            }
        {
            return Ok(false);
        }
        self.order_sort_scratch.clear();
        let required = self
            .pending_preparation_ids
            .len()
            .checked_add(self.unpublished_preparation_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.order_sort_scratch
            .try_reserve(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        for id in self
            .pending_preparation_ids
            .iter()
            .chain(&self.unpublished_preparation_ids)
        {
            let paragraph = self.paragraph(*id).ok_or(EngineError::InvalidRequest)?;
            if !matches!(purpose, RetainedOrderPurpose::Placement)
                && paragraph.gather_range.is_some()
                && paragraph.published_owner_inline
                    != Some(paragraph.state.active_inline().is_some())
            {
                return Ok(false);
            }
            let positioned = paragraph.state.positioned.active();
            let reusable = match purpose {
                RetainedOrderPurpose::Gather => {
                    (paragraph.state.active_inline().is_some()
                        || positioned.decorations().is_empty())
                        && paragraph.gather_range.is_some_and(|range| {
                            range.source_count() == paragraph.state.active_outlined_count()
                        })
                }
                RetainedOrderPurpose::ReplacementGather => {
                    (paragraph.state.active_inline().is_some()
                        || positioned.decorations().is_empty())
                        && paragraph.gather_range.is_some()
                }
                RetainedOrderPurpose::Placement => {
                    paragraph.placement_range.end - paragraph.placement_range.start
                        == paragraph.state.active_placement_segments().len()
                }
            };
            if !reusable
                || paragraph.pending_remove
                || self
                    .active_order()
                    .get(paragraph.renderer_order_index)
                    .is_none_or(|ordered| ordered.id != *id)
            {
                return Ok(false);
            }
            let index = u64::try_from(paragraph.renderer_order_index)
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.order_sort_scratch.push((index, *id));
        }
        sort::sort_pairs(&mut self.order_sort_scratch);
        self.order_sort_scratch.dedup();
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.retained_owner_admissions += self.order_sort_scratch.len();
        });
        Ok(true)
    }

    /// Only authored mutations and already-staged owners need preparation. Preserve
    /// authored order for identity allocation using the existing lifecycle sort scratch.
    pub(super) fn prepare_semantic_work_order(&mut self) -> Result<(), EngineError> {
        self.order_sort_scratch.clear();
        let required = self
            .semantic_input_spans
            .len()
            .checked_add(self.pending_preparation_ids.len())
            .ok_or(EngineError::ResultTooLarge)?;
        self.order_sort_scratch
            .try_reserve(required)
            .map_err(|_| EngineError::ResultTooLarge)?;
        for id in self
            .semantic_input_spans
            .iter()
            .map(|spans| spans.id)
            .chain(self.pending_preparation_ids.iter().copied().filter(|id| {
                self.semantic_input_spans
                    .binary_search_by_key(id, |spans| spans.id)
                    .is_err()
            }))
        {
            let paragraph = self.paragraph(id).ok_or(EngineError::InvalidRequest)?;
            if paragraph.pending_remove {
                continue;
            }
            let order = paragraph
                .pending_placement
                .unwrap_or(paragraph.placement)
                .order;
            self.order_sort_scratch.push((sort::pack2(order, id), id));
        }
        sort::sort_pairs(&mut self.order_sort_scratch);
        Ok(())
    }

    pub(super) fn prepare_order(
        &mut self,
        id: u32,
        scope: u32,
        rank: f64,
    ) -> Result<(), EngineError> {
        let paragraph = self.paragraph_mut(id).ok_or(EngineError::InvalidRequest)?;
        let mut placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
        placement.scope = scope;
        placement.rank = rank;
        paragraph.pending_placement = Some(placement);
        Ok(())
    }

    pub(super) fn active_order(&self) -> &[ParagraphOrder] {
        if self.lifecycle_prepared {
            &self.pending_ordered_paragraphs
        } else {
            &self.ordered_paragraphs
        }
    }
}

pub(super) fn planned_paragraph_rank(
    planner: &PlannerState,
    mutations: crate::engine::semantic_wire::ParagraphOrderMutationBatch<'_>,
    mutation_indices: &[(u64, u32)],
    paragraph_id: u32,
) -> Result<(u32, f64), EngineError> {
    if let Ok(index) =
        mutation_indices.binary_search_by_key(&u64::from(paragraph_id), |entry| entry.0)
    {
        let mutation_index =
            usize::try_from(mutation_indices[index].1).map_err(|_| EngineError::InvalidRequest)?;
        let mutation = mutations
            .get(mutation_index)
            .ok_or(EngineError::InvalidRequest)?;
        return Ok((mutation.scope, mutation.rank));
    }

    Ok(planner
        .paragraph(paragraph_id)
        .map_or((0, 0.0), |paragraph| {
            let placement = paragraph.pending_placement.unwrap_or(paragraph.placement);
            (placement.scope, placement.rank)
        }))
}
