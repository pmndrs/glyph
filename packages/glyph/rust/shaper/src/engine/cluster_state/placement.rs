//! Placement segment anchors: the clusters a placement segment starts at.

use super::*;

impl ClusterArena {
    pub(crate) fn ensure_placement_segment_anchors(&mut self) -> Result<(), EngineError> {
        if self.placement_segment_anchors.len() == self.starts.len() {
            return Ok(());
        }
        if self.word_sidecar_mode == WordSidecarMode::Unbuilt {
            return Err(EngineError::InvalidRequest);
        }
        self.placement_segment_anchors.clear();
        reserve(&mut self.placement_segment_anchors, self.starts.len())?;
        let mut covered = 0usize;
        for run in &self.layout_runs.runs {
            let run_start =
                usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
            let run_end =
                usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
            if run_start != covered || run_start >= run_end || run_end > self.starts.len() {
                return Err(EngineError::InvalidRequest);
            }
            let run_anchor = *self
                .stable_ids
                .get(run_start)
                .filter(|anchor| **anchor != 0)
                .ok_or(EngineError::InvalidRequest)?;
            let mut word_anchor = run_anchor;
            for cluster in run_start..run_end {
                let hard_break = self.flags[cluster] & CLUSTER_HARD_BREAK != 0
                    && self.glyph_counts[cluster] == 0;
                let anchor = if hard_break {
                    self.stable_ids[cluster]
                } else if self.word_sidecar_mode == WordSidecarMode::Dense {
                    run_anchor
                } else {
                    word_anchor
                };
                if anchor == 0 {
                    return Err(EngineError::InvalidRequest);
                }
                self.placement_segment_anchors.push(anchor);
                if self.word_sidecar_mode != WordSidecarMode::Dense
                    && self.flags[cluster]
                        & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK)
                        != 0
                    && cluster + 1 < run_end
                {
                    word_anchor = self.stable_ids[cluster + 1];
                }
            }
            covered = run_end;
        }
        (covered == self.starts.len())
            .then_some(())
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn placement_segment_monotone(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
        stop_after_space: bool,
        limit: usize,
    ) -> Result<(PlacementCluster, usize), EngineError> {
        let placement = self.placement_cluster_at(run, direction, cluster)?;
        if direction & 1 != 0 || self.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
            return Ok((placement, cluster + 1));
        }
        let run_end = usize::try_from(run.cluster_end)
            .map_err(|_| EngineError::InvalidRequest)?
            .min(limit);
        if run_end <= cluster {
            return Err(EngineError::InvalidRequest);
        }
        let run_start =
            usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let block_lane_start = usize::try_from(run.numeric_blocks.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let block_lane = block_lane_start
            .checked_add(cluster - run_start)
            .ok_or(EngineError::ResultTooLarge)?;
        let block = *self
            .run_local
            .cluster_blocks()
            .get(block_lane)
            .ok_or(EngineError::InvalidRequest)?;
        let mut block_end = cluster + 1;
        while block_end < run_end
            && self.placement_segment_anchors[block_end] == placement.segment_anchor
            && (!stop_after_space || self.flags[block_end - 1] & CLUSTER_SPACE == 0)
            && self
                .run_local
                .cluster_blocks()
                .get(block_lane_start + (block_end - run_start))
                == Some(&block)
        {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.placement_segment_validation_visits += 1
            });
            block_end += 1;
        }
        Ok((placement, block_end))
    }

    pub(super) fn placement_cluster_at(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
    ) -> Result<PlacementCluster, EngineError> {
        let run_start =
            usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        let run_end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        if cluster < run_start
            || cluster >= run_end
            || self.word_sidecar_mode == WordSidecarMode::Unbuilt
        {
            return Err(EngineError::InvalidRequest);
        }
        let run_offset = if direction & 1 == 0 {
            cluster - run_start
        } else {
            run_end - cluster - 1
        };
        if self.flags[cluster] & CLUSTER_HARD_BREAK != 0 && self.glyph_counts[cluster] == 0 {
            return Ok(PlacementCluster {
                segment_anchor: self.stable_ids[cluster],
                dense: false,
                numeric_block_ordinal: u32::MAX,
                block_local_prefix: 0.0,
                block_anchor_inline: 0.0,
                block_anchor_block: 0.0,
            });
        }
        let block_lane = usize::try_from(run.numeric_blocks.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?
            .checked_add(run_offset)
            .ok_or(EngineError::ResultTooLarge)?;
        let block_index = *self
            .run_local
            .cluster_blocks()
            .get(block_lane)
            .filter(|index| **index != u32::MAX)
            .ok_or(EngineError::InvalidRequest)?;
        let block = *self
            .run_local
            .blocks()
            .get(usize::try_from(block_index).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let numeric_block_ordinal = block_index
            .checked_sub(run.numeric_blocks.start)
            .filter(|ordinal| *ordinal < run.numeric_blocks.count)
            .ok_or(EngineError::InvalidRequest)?;
        let segment_anchor = *self
            .placement_segment_anchors
            .get(cluster)
            .filter(|anchor| **anchor != 0)
            .ok_or(EngineError::InvalidRequest)?;
        Ok(PlacementCluster {
            segment_anchor,
            dense: self.word_sidecar_mode == WordSidecarMode::Dense,
            numeric_block_ordinal,
            block_local_prefix: *self
                .run_local
                .cluster_prefixes()
                .get(block_lane)
                .ok_or(EngineError::InvalidRequest)?,
            block_anchor_inline: block.anchor_inline,
            block_anchor_block: block.anchor_block,
        })
    }
}
