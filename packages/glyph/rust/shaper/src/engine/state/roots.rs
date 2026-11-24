//! Root lifecycle (create, reset, invalidate, dispose) and the read-only views of one root's planner.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl TextEngine {
    pub(super) fn invalidate_gather_cache(&mut self) {
        self.gather_cache = None;
        self.prepared_gather_cache = None;
    }

    pub fn create_root(&mut self, handle: u32) -> Result<(), EngineError> {
        let high_water = self
            .invalidated_roots
            .get(&handle)
            .copied()
            .unwrap_or_default();
        self.create_root_with_high_water(handle, high_water)?;
        self.invalidated_roots.remove(&handle);
        Ok(())
    }

    pub(super) fn create_root_with_high_water(
        &mut self,
        handle: u32,
        high_water: RootHighWater,
    ) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        if self.planners.contains_key(&handle) {
            return Err(EngineError::RootConflict);
        }
        let planner = Self::new_planner(high_water)?;
        self.planners.insert(handle, planner);
        Ok(())
    }

    pub(super) fn new_planner(high_water: RootHighWater) -> Result<PlannerState, EngineError> {
        let mut planner = PlannerState {
            next_glyph_id: high_water.next_glyph_id,
            next_content_revision: high_water.next_content_revision,
            acknowledged_publication_generation: high_water.acknowledged_publication_generation,
            placement_acknowledgement_rebased: high_water.acknowledged_publication_generation != 0,
            ..PlannerState::default()
        };
        let mut spare = ParagraphState::empty();
        spare.initialize()?;
        planner.spare_paragraph = Some(spare);
        Ok(planner)
    }

    /// Replaces one planner's derived state while retaining the caller-owned root transport.
    /// Used only after an unexpected failure crossed the Wasm/TypeScript commit boundary.
    pub fn reset_root(&mut self, handle: u32) -> Result<(), EngineError> {
        if handle == 0 {
            return Err(EngineError::InvalidHandle);
        }
        let high_water = self
            .invalidated_roots
            .get(&handle)
            .copied()
            .or_else(|| {
                self.planners.get(&handle).map(|planner| RootHighWater {
                    next_glyph_id: planner.next_glyph_id.max(planner.pending_next_glyph_id),
                    next_content_revision: planner
                        .next_content_revision
                        .max(planner.pending_next_content_revision),
                    acknowledged_publication_generation: planner
                        .acknowledged_publication_generation,
                })
            })
            .ok_or(EngineError::RootMissing)?;
        let mut replacement = Self::new_planner(high_water)?;
        // The renderer may have accepted a generation that the invalidated planner never
        // observed. Its replacement placement arena starts empty, so the next renderer
        // acknowledgement must be treated as a fence from the previous arena.
        replacement.placement_acknowledgement_rebased = true;
        self.planners.insert(handle, replacement);
        self.invalidated_roots.remove(&handle);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub(super) fn invalidate_root(&mut self, handle: u32) -> Result<(), EngineError> {
        let planner = self
            .planners
            .remove(&handle)
            .ok_or(EngineError::RootMissing)?;
        let high_water = RootHighWater {
            next_glyph_id: planner.next_glyph_id.max(planner.pending_next_glyph_id),
            next_content_revision: planner
                .next_content_revision
                .max(planner.pending_next_content_revision),
            acknowledged_publication_generation: planner.acknowledged_publication_generation,
        };
        self.invalidated_roots.insert(handle, high_water);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub fn dispose_root(&mut self, handle: u32) -> Result<(), EngineError> {
        if self.planners.remove(&handle).is_none()
            && self.invalidated_roots.remove(&handle).is_none()
        {
            return Err(EngineError::RootMissing);
        }
        self.invalidated_roots.remove(&handle);
        if self
            .gather_cache
            .is_some_and(|cache| cache.root_id == handle)
            || self
                .prepared_gather_cache
                .is_some_and(|cache| cache.root_id == handle)
        {
            self.invalidate_gather_cache();
        }
        Ok(())
    }

    pub fn reserve_root_text(&mut self, handle: u32, capacity: u32) -> Result<(), EngineError> {
        let capacity = usize::try_from(capacity).map_err(|_| EngineError::ResultTooLarge)?;
        let planner = self
            .planners
            .get_mut(&handle)
            .ok_or(EngineError::RootMissing)?;
        planner
            .preflight_text_candidates
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        planner
            .preflight_edit_scratch
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        if let Some(paragraph) = planner.spare_paragraph.as_mut() {
            paragraph.reserve_text(capacity)?;
        }
        Ok(())
    }

    pub(crate) fn root_revision(&self, handle: u32) -> Result<RootRevision, EngineError> {
        self.planners
            .get(&handle)
            .map(|planner| planner.revision)
            .ok_or(EngineError::RootMissing)
    }

    pub(crate) fn borrowed_paragraph_layout(
        &self,
        root_id: u32,
        paragraph_id: u32,
    ) -> Result<usize, EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        if let Some(leaf) = paragraph.state.active_inline() {
            return Ok(leaf.semantic_count());
        }
        // Owed positioning is settled at the read's entry (`settle_paragraph_positioning`).
        if paragraph.state.positioning_owed() {
            return Err(EngineError::InvalidRequest);
        }
        Ok(paragraph.state.positioned.active().occurrence_count())
    }

    pub(crate) fn borrowed_paragraph_glyphs(
        &self,
        root_id: u32,
        paragraph_id: u32,
        start: usize,
        output: &mut [crate::engine::positioning::SemanticGlyph],
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        if let Some(leaf) = paragraph.state.active_inline() {
            start
                .checked_add(output.len())
                .filter(|end| *end <= leaf.semantic_count())
                .ok_or(EngineError::InvalidRequest)?;
            for (offset, record) in output.iter_mut().enumerate() {
                let row = leaf
                    .row(u32::try_from(start + offset).map_err(|_| EngineError::ResultTooLarge)?)
                    .ok_or(EngineError::InvalidRequest)?
                    .semantic;
                let translation = *leaf
                    .placement_translations()
                    .get(row.placement_segment as usize)
                    .ok_or(EngineError::InvalidRequest)?;
                *record = row.placed(translation)?;
            }
            return Ok(());
        }
        if paragraph.state.positioning_owed() {
            return Err(EngineError::InvalidRequest);
        }
        let positioned = paragraph.state.positioned.active();
        let boundary = paragraph.state.visible_boundary_shape();
        let clusters = paragraph.state.clusters.active();
        start
            .checked_add(output.len())
            .filter(|&end| end <= positioned.occurrence_count())
            .ok_or(EngineError::InvalidRequest)?;
        let mut cursor = positioned.occurrence_cursor(start, clusters, boundary)?;
        for record in output {
            let row = cursor.next_row()?.ok_or(EngineError::InvalidRequest)?;
            *record = positioned.placed_occurrence(row.semantic)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn root_text(&self, handle: u32) -> Result<&[u16], EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.text.committed().units.as_slice())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_style_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.styles.committed().arena.len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_style_segment_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.styles.committed().resolved.segments().len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(crate) fn planner_shaping_run_count(&self, handle: u32) -> Result<usize, EngineError> {
        self.planners
            .get(&handle)
            .and_then(PlannerState::first_paragraph_state)
            .map(|paragraph| paragraph.shaping_runs.committed().runs().len())
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(super) fn planner_paragraph_preparation_count(
        &self,
        root: u32,
        paragraph: u32,
    ) -> Result<usize, EngineError> {
        self.planners
            .get(&root)
            .and_then(|planner| planner.paragraph(paragraph))
            .map(|paragraph| paragraph.state.preparation_count)
            .ok_or(EngineError::RootMissing)
    }

    #[cfg(test)]
    pub(super) fn planner_preparation_revision(&self, root: u32) -> Result<u32, EngineError> {
        self.planners
            .get(&root)
            .map(|planner| planner.preparation_revision)
            .ok_or(EngineError::RootMissing)
    }

    pub fn root_count(&self) -> u32 {
        self.planners.len().try_into().unwrap_or(u32::MAX)
    }

    #[cfg(test)]
    pub(super) fn retained_binding_compilation_skips(
        &self,
        handle: u32,
    ) -> Result<u32, EngineError> {
        self.planners
            .get(&handle)
            .map(|planner| planner.plan.retained_binding_compilation_skips())
            .ok_or(EngineError::RootMissing)
    }
}
