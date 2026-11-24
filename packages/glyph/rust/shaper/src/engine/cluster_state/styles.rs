//! Refreshing cluster styles from a resolved style stream.

use super::*;

impl ClusterArena {
    /// Remaps retained clusters to current styles. Metric dirt also re-derives
    /// advances in shaping order; mapping-only dirt preserves line corrections.
    /// Uncovered clusters fall back to the existing full build.
    pub(crate) fn refresh_styles_from_stream(
        &mut self,
        previous: &Self,
        styles: &[StyleSegment],
        runs: &[ShapingRun],
        metrics_changed: bool,
    ) -> Result<Option<()>, EngineError> {
        let _clock = StageClock::start();
        self.copy_from(previous, !metrics_changed)?;
        let stream_len = self.glyph_ids.len();
        if self.glyph_x_advances.len() != stream_len {
            self.clear();
            return Ok(None);
        }
        let mut style_index = 0;
        for cluster in 0..self.starts.len() {
            while styles
                .get(style_index)
                .is_some_and(|segment| segment.text_end <= self.starts[cluster])
            {
                style_index += 1;
            }
            let Some(segment) = styles.get(style_index) else {
                self.clear();
                return Ok(None);
            };
            if segment.text_start > self.starts[cluster] || segment.text_end < self.ends[cluster] {
                self.clear();
                return Ok(None);
            }
            self.style_indexes[cluster] =
                u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?;
            if !metrics_changed {
                continue;
            }
            let flags = self.flags[cluster];
            let word_spacing = if flags & CLUSTER_SPACE != 0 {
                segment.style.word_spacing
            } else {
                0.0
            };
            let mut advance = if flags & CLUSTER_HARD_BREAK != 0 {
                0.0
            } else {
                f64::from(segment.style.letter_spacing + word_spacing)
            };
            let glyph_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(self.glyph_counts[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            if glyph_end > stream_len {
                self.clear();
                return Ok(None);
            }
            if glyph_end > glyph_start {
                let units_per_em = self.units_per_em[cluster];
                if units_per_em == 0.0 {
                    self.clear();
                    return Ok(None);
                }
                let scale = f64::from(segment.style.font_size) / units_per_em;
                for adjacency in glyph_start..glyph_end {
                    advance += f64::from(self.glyph_x_advances[adjacency].unsigned_abs()) * scale;
                }
            }
            self.advances[cluster] = advance;
        }
        // Adjacent script runs share a layout run only while their styles agree on layout, so a
        // restyle can split or merge runs without reshaping anything; a direction override
        // arrives the same way.
        self.ltr = all_ltr(runs);
        self.rebuild_layout_runs_for_shaping(runs)?;
        // The glyph stream is the previous one, so its font-unit ink is too; with no metric
        // change every run-local input is, and the geometry carries over where the runs agree.
        let inherited = if metrics_changed {
            Inherited::Ink
        } else {
            Inherited::Geometry
        };
        self.run_local
            .inherit(&previous.run_local, inherited)
            .map_err(|_| EngineError::ResultTooLarge)?;
        if metrics_changed {
            self.reset_break_corrections(0, self.starts.len());
            self.refresh_layout_units()?;
        }
        Ok(Some(()))
    }
}
