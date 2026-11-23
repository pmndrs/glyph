//! The cluster and geometry stages of one paragraph.

use super::*;

impl ParagraphState {
    /// Returns whether cluster geometry changed and flow needs preparation.
    #[inline(never)]
    pub(super) fn prepare_clusters(
        &mut self,
        shaper: &ShaperRegistry,
        next_glyph_id: &mut u32,
    ) -> Result<bool, EngineError> {
        self.discard_clusters_candidate();
        if !self.shape.is_prepared()
            && !self.style_invalidation.metrics
            && !self.style_invalidation.cluster_mapping
        {
            return Ok(false);
        }
        let text = self.text.active().units.as_slice();
        let text_unit_ids = self.text.active().unit_ids.as_slice();
        let unicode = self.unicode.active();
        let styles = self.styles.active().resolved.segments();
        let runs = self.shaping_runs.active().runs();
        if runs.is_empty() && styles.is_empty() {
            self.clusters.pending_mut().clear();
            return self.finish_cluster_preparation(shaper).map(|()| true);
        }
        // Retained run ordinals require stable topology. Refresh style mappings
        // and, for metric edits, advances; uncovered clusters use the full build.
        let run_topology_stable = !self.shaping_runs.is_prepared()
            || shaping_run_topology_stable(self.shaping_runs.committed().runs(), runs);
        if !self.shape.is_prepared() && run_topology_stable && {
            let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
            pending_clusters
                .refresh_styles_from_stream(
                    committed_clusters,
                    styles,
                    runs,
                    // Line height alone leaves advances and run-local geometry as they are.
                    self.style_invalidation.run_geometry,
                )?
                .is_some()
        } {
            let geometry_changed = self.style_invalidation.metrics;
            return self
                .finish_cluster_preparation(shaper)
                .map(|()| geometry_changed);
        }
        let shape = self.shape.active();
        let build_input = || ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        };
        // The sole source run owns every cluster. Direct construction avoids copying old
        // flat columns before replacing them, while equal grapheme/text cardinality keeps
        // the existing full builder's reserve at the retained cluster granularity.
        let full_source_run = self.incremental_shape_source_run == Some(0)
            && runs.len() == 1
            && self.shaping_runs.committed().runs().len() == 1
            && runs[0].text_start == 0
            && usize::try_from(runs[0].text_end).ok() == Some(text.len())
            && self.shaping_runs.committed().runs()[0].text_start == 0
            && usize::try_from(self.shaping_runs.committed().runs()[0].text_end).ok()
                == Some(self.text.committed().units.len())
            && unicode.grapheme_boundaries().len().saturating_sub(1) == text.len();
        if let Some(source_run) = self.incremental_shape_source_run
            && !full_source_run
            && let Some((cluster_start, cluster_end)) = {
                let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
                pending_clusters.rebuild_source_run_if_topology_is_stable(
                    committed_clusters,
                    build_input(),
                    source_run,
                    self.styles.is_prepared(),
                    |handle| shaper.font_metrics(handle),
                )?
            }
        {
            let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
            if let Err(error) = pending_clusters.assign_stable_glyph_ids_in_range(
                committed_clusters,
                cluster_start,
                cluster_end,
                &mut self.glyph_identity_index,
                next_glyph_id,
            ) {
                self.discard_clusters_candidate();
                return Err(error);
            }
            return self.finish_cluster_preparation(shaper).map(|()| true);
        }
        // One edit that changed the reshaped run's topology: rebuild that run's clusters
        // between the previous rows. The full build stays the authority for every error.
        // The source runs the shape stage reshaped alone: rebuild their clusters between the
        // previous rows. The full build stays the authority for every error.
        let mut windows: Vec<RunWindow> = Vec::new();
        if let Some(run) = self.incremental_shape_source_run {
            windows.push(RunWindow {
                new: run..run + 1,
                old: run..run + 1,
            });
        } else if let Some((new, old)) = self.incremental_shape_replaced.clone() {
            windows.push(RunWindow { new, old });
        } else {
            windows.extend(
                self.incremental_shape_source_runs
                    .iter()
                    .map(|run| RunWindow {
                        new: *run..*run + 1,
                        old: *run..*run + 1,
                    }),
            );
        }
        let spliced = !windows.is_empty()
            && !full_source_run
            && matches!(self.prepared_layout.committed(), PreparedLayout::General)
            && {
                let splice = SourceRunSplice {
                    windows: &windows,
                    previous_unicode: self.unicode.committed(),
                    previous_styles: self.styles.committed().resolved.segments(),
                    previous_runs: self.shaping_runs.committed().runs(),
                };
                let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
                pending_clusters
                    .splice_source_run(
                        committed_clusters,
                        build_input(),
                        splice,
                        |handle| shaper.font_metrics(handle),
                        |handle| shaper.font_ink_table(handle),
                    )
                    .unwrap_or(false)
            };
        #[cfg(test)]
        if spliced {
            self.clusters.pending().assert_splice_equals_full_build(
                build_input(),
                |handle| shaper.font_metrics(handle),
                |handle| shaper.font_ink_table(handle),
            );
        }
        if !spliced {
            self.clusters.pending_mut().build_with_ink(
                build_input(),
                |handle| shaper.font_metrics(handle),
                |handle| shaper.font_ink_table(handle),
            )?;
        }
        let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
        let previous: &dyn CanonicalClusterView = match self.prepared_layout.committed() {
            PreparedLayout::Inline(leaf) => leaf,
            PreparedLayout::General => committed_clusters,
        };
        if let Err(error) = pending_clusters.assign_stable_glyph_ids(
            previous,
            &mut self.glyph_identity_index,
            next_glyph_id,
        ) {
            self.discard_clusters_candidate();
            return Err(error);
        }
        self.finish_cluster_preparation(shaper).map(|()| true)
    }

    /// Completes every cluster-producing path through one exact retained-run comparison.
    /// Width-only updates never reach this method because they prepare no cluster stage.
    pub(super) fn finish_cluster_preparation(
        &mut self,
        shaper: &ShaperRegistry,
    ) -> Result<(), EngineError> {
        let general = matches!(self.prepared_layout.committed(), PreparedLayout::General);
        let committed_styles = self.styles.committed().resolved.segments();
        let (pending_clusters, committed_clusters) = self.clusters.derive_mut();
        // The committed arena's geometry is the kernel's output for its own lanes; the rebuild
        // copies the part it proves it would write again.
        let previous = general.then_some(crate::engine::run_local_paragraph::PreviousGeometry {
            clusters: committed_clusters,
            styles: committed_styles,
        });
        if let Err(error) = pending_clusters.rebuild_run_local_geometry_from(
            self.shaping_runs.active().runs(),
            self.styles.active().resolved.segments(),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
            previous,
        ) {
            self.discard_clusters_candidate();
            return Err(error);
        }
        let current = RunCanonicalInput {
            text: &self.text.active().units,
            text_unit_ids: &self.text.active().unit_ids,
            style_arena: &self.styles.active().arena,
            styles: self.styles.active().resolved.segments(),
            shaping_runs: self.shaping_runs.active().runs(),
        };
        let committed = RunCanonicalInput {
            text: &self.text.committed().units,
            text_unit_ids: &self.text.committed().unit_ids,
            style_arena: &self.styles.committed().arena,
            styles: self.styles.committed().resolved.segments(),
            shaping_runs: self.shaping_runs.committed().runs(),
        };
        self.layout_dirty.clear();
        let mut next_revision = self.next_run_canonical_revision;
        let result = {
            let (pending, committed_clusters) = self.clusters.derive_mut();
            let previous: &dyn CanonicalClusterView = match self.prepared_layout.committed() {
                PreparedLayout::Inline(leaf) => leaf,
                PreparedLayout::General => committed_clusters,
            };
            pending.finalize_layout_run_revisions(
                previous,
                current,
                committed,
                &mut self.layout_run_identity_index,
                &mut next_revision,
                (!self.text_edits.is_empty() && !self.style_invalidation.metrics)
                    .then_some((&mut self.layout_dirty, true)),
            )
        };
        match result {
            Ok(()) => {
                self.pending_source_run_canonical_revision = next_revision;
                self.pending_next_run_canonical_revision = next_revision;
                self.clusters.mark_prepared();
                Ok(())
            }
            Err(error) => {
                self.discard_clusters_candidate();
                Err(error)
            }
        }
    }

    pub(super) fn discard_clusters_candidate(&mut self) {
        self.layout_dirty.clear();
        self.clusters.pending_mut().clear();
        self.clusters.discard_candidate();
        self.pending_source_run_canonical_revision = self.next_run_canonical_revision;
        self.pending_next_run_canonical_revision = self.next_run_canonical_revision;
    }

    pub(super) fn commit_clusters(&mut self) {
        if self.clusters.is_prepared() {
            self.clusters.commit();
        }
        // The shared cursor also includes replacement runs prepared after the cluster stage.
        self.next_run_canonical_revision = self.pending_next_run_canonical_revision;
        self.discard_clusters_candidate();
    }

    pub(super) fn prepare_geometry(
        &mut self,
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
    ) -> Result<(), EngineError> {
        Self::prepare_geometry_stage(&mut self.geometry, geometry)
    }

    pub(super) fn prepare_geometry_stage(
        stage: &mut Staged<FlowGeometryArena>,
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
    ) -> Result<(), EngineError> {
        stage.pending_mut().clear();
        stage.discard_candidate();
        if geometry.is_empty() {
            return Ok(());
        }
        stage.pending_mut().build(geometry)?;
        if geometry.inline_object_count() == 0 && stage.pending() == stage.committed() {
            stage.pending_mut().clear();
            return Ok(());
        }
        stage.mark_prepared();
        Ok(())
    }

    pub(super) fn discard_geometry_candidate(&mut self) {
        self.geometry.pending_mut().clear();
        self.geometry.discard_candidate();
    }

    pub(super) fn commit_geometry(&mut self) {
        if self.geometry.is_prepared() {
            self.geometry.commit();
        }
        self.discard_geometry_candidate();
    }
}

pub(super) fn allocate_glyph_id(next_glyph_id: &mut u32) -> Result<u32, EngineError> {
    let stable_id = (*next_glyph_id).max(1);
    *next_glyph_id = stable_id
        .checked_add(1)
        .ok_or(EngineError::ResultTooLarge)?;
    Ok(stable_id)
}

pub(super) fn collect_cluster_records(
    shape: &ShapeArena,
    records: &mut Vec<ClusterRecord>,
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    records.clear();
    reserve_vec(records, shape.glyph_ids.len())?;
    for run in &shape.runs {
        let start = usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let clusters = shape
            .clusters
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?;
        let glyph_ids = shape
            .glyph_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?;
        for (&cluster, &glyph_id) in clusters.iter().zip(glyph_ids) {
            records.push(ClusterRecord {
                source_run: run.source_run,
                cluster,
                missing: glyph_id == 0,
            });
        }
    }
    sort::prepare_pairs(sort_pairs, records.len())?;
    for (index, record) in records.iter().enumerate() {
        sort_pairs.push((sort::pack2(record.source_run, record.cluster), index as u32));
    }
    sort::sort_pairs(sort_pairs);
    sort::apply_pair_order(records, sort_pairs);
    let mut write_index = 0usize;
    for read_index in 0..records.len() {
        let record = records[read_index];
        if write_index > 0
            && records[write_index - 1].source_run == record.source_run
            && records[write_index - 1].cluster == record.cluster
        {
            records[write_index - 1].missing |= record.missing;
        } else {
            records[write_index] = record;
            write_index += 1;
        }
    }
    records.truncate(write_index);
    Ok(())
}
