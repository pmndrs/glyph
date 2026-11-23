//! Layout runs: their ownership of clusters, run-local geometry and intrinsic widths.

use super::*;

pub(super) fn summarize_unit_chunks(
    units: &[i64],
    flags: &[u8],
    chunk_advance_sums: &mut Vec<i64>,
    chunk_auxiliary_sums: &mut Vec<i64>,
    chunk_flags_or: &mut Vec<u8>,
) {
    for (advances, flags) in units.chunks(LAYOUT_CHUNK).zip(flags.chunks(LAYOUT_CHUNK)) {
        let advance_sum = sum_advance_units(advances);
        let mut space_sum = 0_i64;
        let mut flags_or = 0_u8;
        for (advance, flag) in advances.iter().zip(flags) {
            space_sum =
                space_sum.saturating_add(*advance & -i64::from((*flag & CLUSTER_SPACE) >> 4));
            flags_or |= *flag & CHUNK_SUMMARY_FLAGS;
            flags_or |= CHUNK_NEGATIVE_ADVANCE * u8::from(*advance < 0);
        }
        // Flags tag this auxiliary as a space sum or a negative space-free maximum prefix;
        // ordinary chunks keep zero so the summary needs no additional lane.
        let auxiliary_sum =
            if flags_or & (CHUNK_NEGATIVE_ADVANCE | CLUSTER_SPACE) == CHUNK_NEGATIVE_ADVANCE {
                let mut prefix = 0_i64;
                let mut maximum = 0_i64;
                for &advance in advances {
                    // A chunk contains at most 64 values bounded to +/-2^53, so
                    // this exact prefix remains within +/-2^59.
                    prefix += advance;
                    maximum = maximum.max(prefix);
                }
                maximum
            } else {
                space_sum
            };
        chunk_advance_sums.push(advance_sum);
        chunk_auxiliary_sums.push(auxiliary_sum);
        chunk_flags_or.push(flags_or);
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
pub(super) fn sum_advance_units(advances: &[i64]) -> i64 {
    use core::arch::wasm32::{i64x2_add, i64x2_extract_lane, i64x2_splat, v128, v128_load};

    // A summary contains at most LAYOUT_CHUNK layout-unit values bounded to ±2^53, so every lane
    // and the final reduction remain within ±2^59 and cannot overflow i64.
    const ACCUMULATORS: usize = 4;
    const VALUES_PER_GROUP: usize = ACCUMULATORS * 2;
    let completed = advances.len() / VALUES_PER_GROUP * VALUES_PER_GROUP;
    let mut sums = [i64x2_splat(0); ACCUMULATORS];
    for start in (0..completed).step_by(VALUES_PER_GROUP) {
        for (accumulator, sum) in sums.iter_mut().enumerate() {
            // SAFETY: `completed` contains only complete eight-value groups.
            let values = unsafe {
                v128_load(
                    advances
                        .as_ptr()
                        .add(start + accumulator * 2)
                        .cast::<v128>(),
                )
            };
            *sum = i64x2_add(*sum, values);
        }
    }
    let vector_sum = sums.into_iter().fold(0_i64, |total, sum| {
        total + i64x2_extract_lane::<0>(sum) + i64x2_extract_lane::<1>(sum)
    });
    advances[completed..]
        .iter()
        .fold(vector_sum, |total, advance| total + *advance)
}

/// Shared intrinsic scan for the General SoA and the bounded leaf facts. Keeping the same
/// operation order preserves exact min/max width bits across prepared representations.
pub(crate) fn intrinsic_widths_from_facts(
    count: usize,
    wrap: u8,
    at: impl Fn(usize) -> (f64, u8),
) -> IntrinsicWidths {
    let mut min_run = 0.0_f64;
    let mut max_run = 0.0_f64;
    let mut space_tail = 0.0_f64;
    let mut min_content = 0.0_f64;
    let mut max_content = 0.0_f64;
    for index in 0..count {
        let (advance, flags) = at(index);
        if flags & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0 {
            if flags & CLUSTER_REQUIRED_BREAK != 0 {
                min_run += advance;
                max_run += advance;
                if flags & CLUSTER_SPACE != 0 {
                    space_tail += advance;
                }
            }
            min_content = min_content.max(min_run - space_tail);
            max_content = max_content.max(max_run - space_tail);
            min_run = 0.0;
            max_run = 0.0;
            space_tail = 0.0;
            continue;
        }
        min_run += advance;
        max_run += advance;
        space_tail = if flags & CLUSTER_SPACE != 0 {
            space_tail + advance
        } else {
            0.0
        };
        let can_break_after = match wrap {
            WRAP_WORD => {
                flags & CLUSTER_ALLOWED_BREAK != 0
                    && flags & (CLUSTER_BREAK_CORRECTION | CLUSTER_SPACE)
                        != CLUSTER_BREAK_CORRECTION
            }
            WRAP_CHARACTER => index + 1 == count || at(index + 1).1 & CLUSTER_SAFE_BEFORE != 0,
            WRAP_NONE => false,
            _ => false,
        };
        if can_break_after {
            min_content = min_content.max(min_run - space_tail);
            min_run = 0.0;
            space_tail = 0.0;
        }
    }
    min_content = min_content.max(min_run - space_tail);
    max_content = max_content.max(max_run - space_tail);
    IntrinsicWidths {
        min_content_width: min_content.max(0.0),
        max_content_width: max_content.max(0.0),
    }
}
impl ClusterArena {
    /// Derives minimum-content and maximum-content inline extents from one scan over
    /// the cluster arena, mirroring `line_composition`'s own break decisions so the
    /// published intrinsics agree with what a zero-width and an unconstrained probe
    /// would measure — without paying either probe.
    ///
    /// - `max_content_width`: the widest run between forced breaks (`REQUIRED_BREAK`
    ///   or `HARD_BREAK`), with trailing spaces trimmed the way line ends trim them.
    /// - `min_content_width`: the widest run that remains when soft breaks are also
    ///   taken under `wrap`: after clusters flagged `ALLOWED_BREAK` for word wrap,
    ///   before every `SAFE_BEFORE` boundary for character wrap, never under none.
    ///
    /// Widths come from the paragraph shaping, uncorrected at unsafe-to-break
    /// boundaries, like Blink's fast min-content path; line layout is exact at the
    /// breaks it takes.
    pub(crate) fn intrinsic_widths(&self, wrap: u8) -> IntrinsicWidths {
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.measurement_intrinsic_cluster_visits += self.starts.len();
        });
        intrinsic_widths_from_facts(self.starts.len(), wrap, |index| {
            (self.advances[index], self.flags[index])
        })
    }

    /// `rebuild_run_local_geometry`, starting from what `previous` proves this arena would
    /// lay out again: after a splice, the geometry of every run or whole chunk the splice
    /// kept; otherwise the geometry before the first cluster the kernel reads differently.
    pub(crate) fn rebuild_run_local_geometry_from(
        &mut self,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
        previous: Option<crate::engine::run_local_paragraph::PreviousGeometry<'_>>,
    ) -> Result<(), EngineError> {
        // The kernel borrows this arena's lanes while it writes these two.
        let mut run_local = core::mem::take(&mut self.run_local);
        let mut layout_runs = core::mem::take(&mut self.layout_runs.runs);
        let result = match (self.run_local_splice.take(), previous) {
            (Some(splice), Some(previous)) => {
                #[cfg(test)]
                let mut full = {
                    let mut full = RunLocalArena::default();
                    full.inherit(&run_local, Inherited::Ink)
                        .expect("the spliced ink copies");
                    if !run_local.inherits_ink() {
                        full.take_inherited();
                    }
                    (full, layout_runs.clone())
                };
                let result = crate::engine::run_local_paragraph::rebuild_spliced(
                    &mut run_local,
                    &mut layout_runs,
                    self,
                    previous,
                    &splice,
                    runs,
                    styles,
                    extents_for,
                );
                #[cfg(test)]
                if result.is_ok() {
                    crate::engine::run_local_paragraph::rebuild(
                        &mut full.0,
                        &mut full.1,
                        self,
                        runs,
                        styles,
                        extents_for,
                        None,
                    )
                    .expect("the full rebuild of a spliced arena");
                    run_local.assert_geometry_equals(&full.0);
                    assert!(layout_runs == full.1, "spliced layout run blocks");
                }
                result
            }
            (_, previous) => crate::engine::run_local_paragraph::rebuild(
                &mut run_local,
                &mut layout_runs,
                self,
                runs,
                styles,
                extents_for,
                previous,
            ),
        };
        self.layout_runs.runs = layout_runs;
        self.run_local = run_local;
        result
    }

    pub(super) fn rebuild_layout_runs_for_shaping(
        &mut self,
        runs: &[ShapingRun],
    ) -> Result<(), EngineError> {
        self.rebuild_layout_runs_with(|left, right| {
            match (
                usize::try_from(left).ok().and_then(|index| runs.get(index)),
                usize::try_from(right)
                    .ok()
                    .and_then(|index| runs.get(index)),
            ) {
                (Some(left), Some(right)) => {
                    left.direction == right.direction
                        && left.bidi_level == right.bidi_level
                        && run_layout_compatible(left.style, right.style)
                }
                (None, None) => left == NO_SOURCE_RUN && right == NO_SOURCE_RUN,
                _ => false,
            }
        })
    }

    pub(super) fn rebuild_layout_runs_with(
        &mut self,
        compatible_source_runs: impl Fn(u32, u32) -> bool,
    ) -> Result<(), EngineError> {
        self.layout_runs.clear();
        let mut cluster_start = 0usize;
        while cluster_start < self.starts.len() {
            let source_run = self.source_runs[cluster_start];
            let font_handle = self.font_handles[cluster_start];
            // Owner lanes are constant over long stretches, so the compatibility of two source
            // runs is asked once per stretch, not once per cluster.
            let mut stretch_source = source_run;
            let mut cluster_end = cluster_start + 1;
            loop {
                cluster_end += self.source_runs[cluster_end..]
                    .iter()
                    .zip(&self.font_handles[cluster_end..])
                    .position(|(source, font)| *source != stretch_source || *font != font_handle)
                    .unwrap_or(self.starts.len() - cluster_end);
                if cluster_end == self.starts.len()
                    || self.font_handles[cluster_end] != font_handle
                    || !compatible_source_runs(source_run, self.source_runs[cluster_end])
                {
                    break;
                }
                stretch_source = self.source_runs[cluster_end];
                cluster_end += 1;
            }
            let glyph_start = self.glyph_starts[cluster_start];
            let final_cluster = cluster_end - 1;
            let glyph_end = self.glyph_starts[final_cluster]
                .checked_add(self.glyph_counts[final_cluster])
                .ok_or(EngineError::ResultTooLarge)?;
            self.layout_runs.push(LayoutRun {
                source_kind: LayoutRunSourceKind::Paragraph,
                cluster_start: u32::try_from(cluster_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                cluster_end: u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?,
                glyph_start,
                glyph_count: glyph_end
                    .checked_sub(glyph_start)
                    .ok_or(EngineError::InvalidRequest)?,
                source_run,
                font_handle,
                numeric_blocks: NumericBlockSpan::default(),
                canonical_revision: None,
            })?;
            cluster_start = cluster_end;
        }
        Ok(())
    }

    pub(super) fn assign_cluster_ownership(
        &mut self,
        cluster: usize,
        shaped_run: crate::engine::shaping_state::ShapedRun,
    ) -> Result<(), EngineError> {
        let source_slot = &mut self.source_runs[cluster];
        let binding_slot = &mut self.binding_handles[cluster];
        let font_slot = &mut self.font_handles[cluster];
        if *source_slot == NO_SOURCE_RUN {
            *source_slot = shaped_run.source_run;
            *binding_slot = shaped_run.binding_handle;
            *font_slot = shaped_run.font_handle;
        } else if *source_slot != shaped_run.source_run
            || *binding_slot != shaped_run.binding_handle
            || *font_slot != shaped_run.font_handle
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    /// Claims the clusters a shaped run covers but produced no glyphs for.
    ///
    /// A ligature absorbs its trailing graphemes: `fi` shapes to one glyph reported at
    /// the first grapheme, so the second grapheme's cluster ends the glyph loop with no
    /// owner. Positioning still walks that cluster and derives a scale from the owning
    /// font, so the run's units-per-em is recorded here alongside the handles — ownership
    /// and the scale it implies are established together, never one without the other.
    pub(super) fn fill_glyphless_run_ownership(
        &mut self,
        runs: &[ShapingRun],
        shaped_run: crate::engine::shaping_state::ShapedRun,
        units_per_em: f64,
        allowed_start: usize,
        allowed_end: usize,
    ) -> Result<(), EngineError> {
        let source_index =
            usize::try_from(shaped_run.source_run).map_err(|_| EngineError::InvalidRequest)?;
        let source = runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
        if shaped_run.text_start < source.text_start
            || shaped_run.text_end > source.text_end
            || shaped_run.text_start >= shaped_run.text_end
        {
            return Err(EngineError::InvalidRequest);
        }
        let cluster_start = self
            .ends
            .partition_point(|end| *end <= shaped_run.text_start);
        let cluster_end = self
            .starts
            .partition_point(|start| *start < shaped_run.text_end);
        if cluster_start < allowed_start
            || cluster_end > allowed_end
            || cluster_start >= cluster_end
        {
            return Err(EngineError::InvalidRequest);
        }
        for cluster in cluster_start..cluster_end {
            if self.source_runs[cluster] != NO_SOURCE_RUN {
                continue;
            }
            self.source_runs[cluster] = shaped_run.source_run;
            self.binding_handles[cluster] = shaped_run.binding_handle;
            self.font_handles[cluster] = shaped_run.font_handle;
            self.units_per_em[cluster] = units_per_em;
        }
        Ok(())
    }
}
