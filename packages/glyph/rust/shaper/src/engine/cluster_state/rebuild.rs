//! Re-deriving an arena's layout units, and copying an arena.

use super::*;

impl ClusterArena {
    /// Re-derives the F16.16 advance stream from the f64 advances. Both public build
    /// paths end here, so the streams can never disagree outside the rounding
    /// contract.
    pub(crate) fn refresh_layout_units(&mut self) -> Result<(), EngineError> {
        self.advance_units.clear();
        reserve(&mut self.advance_units, self.advances.len())?;
        self.advance_units.extend(
            self.advances
                .iter()
                .map(|advance| crate::engine::layout_units::layout_units_from_scaled(*advance)),
        );
        // Chunk-64 summaries (D-245): per 64-cluster chunk, the total advance, the
        // tagged auxiliary described on `chunk_auxiliary_sums`, and the OR of every
        // cluster flag plus summary-only markers.
        // The fit skips whole fitting chunks through these sums — exact, because
        // integer addition is associative — and resolves the last break position
        // inside a chunk only when a break is actually needed. The tail chunk is
        // summarized too; consumers gate on full-chunk availability themselves.
        let chunk_count = self.advance_units.len().div_ceil(LAYOUT_CHUNK);
        self.chunk_advance_sums.clear();
        self.chunk_auxiliary_sums.clear();
        self.chunk_flags_or.clear();
        reserve(&mut self.chunk_advance_sums, chunk_count)?;
        reserve(&mut self.chunk_auxiliary_sums, chunk_count)?;
        reserve(&mut self.chunk_flags_or, chunk_count)?;
        summarize_unit_chunks(
            &self.advance_units,
            &self.flags,
            &mut self.chunk_advance_sums,
            &mut self.chunk_auxiliary_sums,
            &mut self.chunk_flags_or,
        );
        self.word_breaks.clear();
        self.word_sidecar_mode = WordSidecarMode::Unbuilt;
        self.placement_segment_anchors.clear();
        Ok(())
    }

    pub(super) fn copy_from(
        &mut self,
        source: &Self,
        preserve_layout: bool,
    ) -> Result<(), EngineError> {
        self.clear();
        self.reserve(source.starts.len())?;
        reserve(&mut self.glyph_ids, source.glyph_ids.len())?;
        reserve(&mut self.glyph_clusters, source.glyph_clusters.len())?;
        reserve(&mut self.glyph_x_advances, source.glyph_x_advances.len())?;
        reserve(&mut self.glyph_x_offsets, source.glyph_x_offsets.len())?;
        reserve(&mut self.glyph_y_offsets, source.glyph_y_offsets.len())?;
        reserve(&mut self.glyph_shape_flags, source.glyph_shape_flags.len())?;
        reserve(&mut self.glyph_stable_ids, source.glyph_stable_ids.len())?;
        reserve(&mut self.index_at, source.index_at.len())?;
        macro_rules! copy_lane {
            ($field:ident) => {
                self.$field.extend_from_slice(&source.$field);
            };
        }
        copy_lane!(starts);
        copy_lane!(ends);
        copy_lane!(advances);
        copy_lane!(units_per_em);
        copy_lane!(flags);
        copy_lane!(style_indexes);
        copy_lane!(source_runs);
        copy_lane!(binding_handles);
        copy_lane!(font_handles);
        copy_lane!(stable_ids);
        copy_lane!(glyph_starts);
        copy_lane!(glyph_counts);
        copy_lane!(glyph_ids);
        copy_lane!(glyph_clusters);
        copy_lane!(glyph_x_advances);
        copy_lane!(glyph_x_offsets);
        copy_lane!(glyph_y_offsets);
        copy_lane!(glyph_shape_flags);
        copy_lane!(glyph_stable_ids);
        copy_lane!(index_at);
        copy_lane!(shaped);
        copy_lane!(unsafe_before);
        copy_lane!(break_corrections);
        if preserve_layout {
            copy_lane!(advance_units);
            reserve(
                &mut self.chunk_advance_sums,
                source.chunk_advance_sums.len(),
            )?;
            reserve(
                &mut self.chunk_auxiliary_sums,
                source.chunk_auxiliary_sums.len(),
            )?;
            reserve(&mut self.chunk_flags_or, source.chunk_flags_or.len())?;
            reserve(&mut self.word_breaks, source.word_breaks.len())?;
            copy_lane!(chunk_advance_sums);
            copy_lane!(chunk_auxiliary_sums);
            copy_lane!(chunk_flags_or);
            copy_lane!(word_breaks);
            copy_lane!(placement_segment_anchors);
            self.word_sidecar_mode = source.word_sidecar_mode;
            let source_islands = source
                .islands
                .try_borrow()
                .map_err(|_| EngineError::InvalidRequest)?;
            let islands = self.islands.get_mut();
            for (target, previous) in [
                (&mut islands.shape, &source_islands.shape),
                (&mut islands.once, &source_islands.once),
            ] {
                for index in 0..previous.runs.len() {
                    target.append_from(previous, index)?;
                }
            }
            reserve(&mut islands.slots, source_islands.slots.len())?;
            islands.slots.extend_from_slice(&source_islands.slots);
        }
        self.ltr = source.ltr;
        self.layout_runs.reserve(source.layout_runs.runs.len())?;
        self.layout_runs
            .runs
            .extend_from_slice(&source.layout_runs.runs);
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.cluster_copied_old_rows += source.starts.len()
        });
        Ok(())
    }
}
