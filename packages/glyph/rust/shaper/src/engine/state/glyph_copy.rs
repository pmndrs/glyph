//! Copying one paragraph's positioned glyphs and decorations out for a caller.

use super::*;

impl TextEngine {
    /// Builds a complete independent render plan for selected current glyph records.
    ///
    /// This query leaves planner revisions, publication generation, and the acknowledgement fence
    /// untouched. The returned compiler owns compacted codec buffers that
    /// the transport can encode as a one-shot checkpoint for a renderer to import.
    pub(crate) fn copy_glyphs(
        &self,
        root_id: u32,
        paragraph_id: u32,
        codec_handle: u32,
        capability_set_id: u32,
        stable_ids: &[u32],
    ) -> Result<RenderPlanCompiler, EngineError> {
        if stable_ids.is_empty() || stable_ids.contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        let mut requested = stable_ids.to_vec();
        requested.sort_unstable();
        if requested.windows(2).any(|ids| ids[0] == ids[1]) {
            return Err(EngineError::InvalidRequest);
        }
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let binding = planner.codec_binding.ok_or(EngineError::InvalidRequest)?;
        if binding.handle != codec_handle {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if binding.fingerprint != codec.fingerprint() {
            return Err(EngineError::InvalidRequest);
        }
        let capability_set = CapabilitySetId(capability_set_id);
        if codec.capability_set(capability_set).is_none() {
            return Err(EngineError::InvalidRequest);
        }

        let mut gather = CodecGatherWorkspace::default();
        gather.begin(codec, requested.len()).map_err(gather_error)?;
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        if paragraph.state.positioning_owed() {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(leaf) = paragraph.state.committed_inline() {
            let mut selected_sources = Vec::new();
            let mut selected_placement_slots = Vec::new();
            selected_sources
                .try_reserve(requested.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            selected_placement_slots
                .try_reserve(requested.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            for source in leaf.outlined_sources() {
                let row = leaf
                    .row(source)
                    .ok_or(EngineError::InvalidRequest)?
                    .semantic;
                if requested.binary_search(&row.stable_id).is_ok() {
                    selected_sources.push(source);
                    selected_placement_slots.push(row.placement_segment);
                }
            }
            if selected_sources.len() != requested.len() {
                return Err(EngineError::InvalidRequest);
            }
            selected_placement_slots.sort_unstable();
            selected_placement_slots.dedup();
            let mut placement_rows = Vec::new();
            placement_rows
                .try_reserve(selected_placement_slots.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            for (slot, source_slot) in selected_placement_slots.iter().copied().enumerate() {
                let translation = leaf
                    .placement_translations()
                    .get(source_slot as usize)
                    .ok_or(EngineError::InvalidRequest)?;
                placement_rows.push(SessionPlacementRow {
                    slot: u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
                    inline: translation.translation_inline as f32,
                    block: translation.translation_block as f32,
                });
            }
            gather
                .append_from_source(
                    codec,
                    capability_set,
                    InlinePlanInput {
                        transform_id: paragraph_id,
                        leaf,
                        styles: paragraph.state.styles.committed().resolved.segments(),
                        selection: Some(&selected_sources),
                        copied_placement_segments: Some(&selected_placement_slots),
                    }
                    .into(),
                    0,
                    |handle| {
                        self.font_bindings
                            .iter()
                            .find(|registered| registered.handle == handle)
                            .map(|registered| &registered.binding)
                    },
                )
                .map_err(gather_error)?;
            let mut compiler = RenderPlanCompiler::default();
            compiler
                .prepare(
                    codec,
                    capability_set,
                    gather.view().plan_input(),
                    true,
                    1,
                    0,
                )
                .map_err(plan_error)?;
            compiler
                .prepare_session(
                    SessionPlacementInput {
                        placement_rows: &placement_rows,
                        placement_capacity: u32::try_from(selected_placement_slots.len())
                            .map_err(|_| EngineError::ResultTooLarge)?,
                    },
                    codec
                        .capability_set(capability_set)
                        .ok_or(EngineError::InvalidRequest)?,
                    1,
                    true,
                )
                .map_err(plan_error)?;
            return Ok(compiler);
        }
        let positioned = paragraph.state.positioned.committed();
        let source_context = PositionedSourceContext {
            styles: paragraph.state.styles.committed().resolved.segments(),
            clusters: paragraph.state.clusters.committed(),
        };
        let mut selected_marks = Vec::new();
        let mut selected_placement_slots = Vec::new();
        selected_marks
            .try_reserve(requested.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        selected_placement_slots
            .try_reserve(requested.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        let mut outlined =
            positioned.outlined_cursor(source_context.clusters, &paragraph.state.boundary_shape);
        while let Some(mark) = outlined.next_mark()? {
            let stable_id = positioned.outlined_mark_stable_id(
                mark,
                source_context.clusters,
                &paragraph.state.boundary_shape,
            )?;
            if requested.binary_search(&stable_id).is_err() {
                continue;
            }
            selected_marks.push(mark);
            selected_placement_slots.push(positioned.outlined_mark_segment(mark)?);
        }
        if selected_marks.len() != requested.len() {
            return Err(EngineError::InvalidRequest);
        }
        selected_placement_slots.sort_unstable();
        selected_placement_slots.dedup();
        let mut placement_rows = Vec::new();
        placement_rows
            .try_reserve(selected_placement_slots.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for (slot, source_slot) in selected_placement_slots.iter().copied().enumerate() {
            let translation = positioned
                .placement_translations()
                .get(usize::try_from(source_slot).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            placement_rows.push(SessionPlacementRow {
                slot: u32::try_from(slot).map_err(|_| EngineError::ResultTooLarge)?,
                inline: translation.translation_inline as f32,
                block: translation.translation_block as f32,
            });
        }
        gather
            .append_from_source(
                codec,
                capability_set,
                ProjectedPlanInput {
                    transform_id: paragraph_id,
                    positioned,
                    context: source_context,
                    boundary: &paragraph.state.boundary_shape,
                    selection: Some(&selected_marks),
                    copied_placement_segments: Some(&selected_placement_slots),
                }
                .into(),
                0,
                |handle| {
                    self.font_bindings
                        .iter()
                        .find(|registered| registered.handle == handle)
                        .map(|registered| &registered.binding)
                },
            )
            .map_err(gather_error)?;
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare(
                codec,
                capability_set,
                gather.view().plan_input(),
                true,
                1,
                0,
            )
            .map_err(plan_error)?;
        compiler
            .prepare_session(
                SessionPlacementInput {
                    placement_rows: &placement_rows,
                    placement_capacity: u32::try_from(selected_placement_slots.len())
                        .map_err(|_| EngineError::ResultTooLarge)?,
                },
                codec
                    .capability_set(capability_set)
                    .ok_or(EngineError::InvalidRequest)?,
                1,
                true,
            )
            .map_err(plan_error)?;
        Ok(compiler)
    }

    /// Builds a complete independent plan for one current paragraph's decorations.
    pub(crate) fn copy_decorations(
        &self,
        root_id: u32,
        codec_handle: u32,
        capability_set_id: u32,
        paragraph_id: u32,
    ) -> Result<RenderPlanCompiler, EngineError> {
        let planner = self
            .planners
            .get(&root_id)
            .ok_or(EngineError::RootMissing)?;
        let binding = planner.codec_binding.ok_or(EngineError::InvalidRequest)?;
        if binding.handle != codec_handle {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if binding.fingerprint != codec.fingerprint() {
            return Err(EngineError::InvalidRequest);
        }
        let capability_set = CapabilitySetId(capability_set_id);
        if codec.capability_set(capability_set).is_none() {
            return Err(EngineError::InvalidRequest);
        }
        let paragraph = planner
            .paragraph(paragraph_id)
            .ok_or(EngineError::InvalidRequest)?;
        if paragraph.state.positioning_owed() {
            return Err(EngineError::InvalidRequest);
        }
        let positioned = paragraph.state.positioned.committed();

        let mut gather = CodecGatherWorkspace::default();
        gather
            .begin(codec, positioned.decorations().len())
            .map_err(gather_error)?;
        let content_revision = planner.revision.engine.max(1);
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                paragraph_id,
                content_revision,
                crate::engine::codec_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                paragraph_id,
                content_revision,
                crate::engine::codec_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
        let mut compiler = RenderPlanCompiler::default();
        compiler
            .prepare(
                codec,
                capability_set,
                gather.view().plan_input(),
                true,
                1,
                0,
            )
            .map_err(plan_error)?;
        Ok(compiler)
    }
}
