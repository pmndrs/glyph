use alloc::vec::Vec;

use crate::{FontMetrics, unicode::UnicodeAnalysis};

use super::{
    EngineError, FrameFault,
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    identity_index::{IdentityIndex, IdentityIndexError},
    shaping_state::{ShapeArena, ShapingRun},
    style_state::StyleSegment,
};

pub(crate) const CLUSTER_SAFE_BEFORE: u8 = 1 << 0;
pub(crate) const CLUSTER_REQUIRED_BREAK: u8 = 1 << 1;
pub(crate) const CLUSTER_HARD_BREAK: u8 = 1 << 2;
pub(crate) const CLUSTER_ALLOWED_BREAK: u8 = 1 << 3;
/// The cluster starts with U+0020 — a justifiable, shrinkable word space.
pub(crate) const CLUSTER_SPACE: u8 = 1 << 4;

use super::shaping_state::GLYPH_FLAG_UNSAFE_TO_BREAK as GLYPH_UNSAFE_TO_BREAK;

/// Intrinsic inline extents derived from one cluster-arena scan, mirroring the
/// line breaker's own wrap-policy decisions rather than approximating them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicWidths {
    pub min_content_width: f64,
    pub max_content_width: f64,
}

const NO_SOURCE_RUN: u32 = u32::MAX;
/// Cluster count per chunk summary (D-245).
pub(crate) const LAYOUT_CHUNK: usize = 64;

fn summarize_unit_chunks(
    units: &[i64],
    flags: &[u8],
    chunk_advance_sums: &mut Vec<i64>,
    chunk_space_sums: &mut Vec<i64>,
    chunk_flags_or: &mut Vec<u8>,
) {
    for (advances, flags) in units.chunks(LAYOUT_CHUNK).zip(flags.chunks(LAYOUT_CHUNK)) {
        let advance_sum = sum_advance_units(advances);
        let mut space_sum = 0_i64;
        let mut flags_or = 0_u8;
        for (advance, flag) in advances.iter().zip(flags) {
            space_sum += *advance & -i64::from((*flag & CLUSTER_SPACE) >> 4);
            flags_or |= *flag;
        }
        chunk_advance_sums.push(advance_sum);
        chunk_space_sums.push(space_sum);
        chunk_flags_or.push(flags_or);
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    use core::arch::wasm32::{i64x2_add, i64x2_extract_lane, i64x2_splat, v128, v128_load};

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

#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    advances.iter().sum()
}

#[derive(Default)]
pub(crate) struct ClusterArena {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub advances: Vec<f64>,
    /// F16.16 quantization of `advances` under the layout-unit rounding contract,
    /// refreshed at the end of every build. Slice 2a keeps the f64 stream
    /// authoritative; the integer fit consumes this stream and must match.
    pub advance_units: Vec<i64>,
    /// Chunk-64 summaries over `advance_units`/`flags`, refreshed with them: total
    /// advance, shrinkable-space advance, and OR-folded flags per chunk.
    pub chunk_advance_sums: Vec<i64>,
    pub chunk_space_sums: Vec<i64>,
    pub chunk_flags_or: Vec<u8>,
    /// Per-cluster `units_per_em` of the owning shaped font (0 while unshaped),
    /// resolved once at cluster build. Positioning derives its scale from the
    /// CURRENT style's font size and this column, so font-size-only style changes
    /// stay correct while the per-cluster registry lookup disappears.
    pub units_per_em: Vec<f64>,
    pub flags: Vec<u8>,
    pub style_indexes: Vec<u32>,
    pub source_runs: Vec<u32>,
    pub binding_handles: Vec<u32>,
    pub font_handles: Vec<u32>,
    pub stable_ids: Vec<u32>,
    pub glyph_starts: Vec<u32>,
    pub glyph_counts: Vec<u32>,
    /// Adjacency-order glyph stream: the shape-arena payload scattered into
    /// cluster order at build, so positioning walks these columns sequentially
    /// instead of gathering the shape arrays through a permutation. Refreshed
    /// only when a build re-shapes; geometry changes reuse the stream as-is.
    pub glyph_ids: Vec<u16>,
    pub glyph_clusters: Vec<u32>,
    pub glyph_x_advances: Vec<i32>,
    pub glyph_x_offsets: Vec<i32>,
    pub glyph_y_offsets: Vec<i32>,
    pub glyph_shape_flags: Vec<u16>,
    pub glyph_stable_ids: Vec<u32>,
    pub index_at: Vec<u32>,
    pub(super) shaped: Vec<u8>,
    pub(super) unsafe_before: Vec<u8>,
}

pub(crate) struct ClusterBuildInput<'a> {
    pub text: &'a [u16],
    pub text_unit_ids: &'a [u32],
    pub unicode: &'a UnicodeAnalysis,
    pub styles: &'a [StyleSegment],
    pub runs: &'a [ShapingRun],
    pub shape: &'a ShapeArena,
}

impl ClusterArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.starts, capacity)?;
        reserve(&mut self.ends, capacity)?;
        reserve(&mut self.advances, capacity)?;
        reserve(&mut self.advance_units, capacity)?;
        reserve(&mut self.units_per_em, capacity)?;
        reserve(&mut self.flags, capacity)?;
        reserve(&mut self.style_indexes, capacity)?;
        reserve(&mut self.source_runs, capacity)?;
        reserve(&mut self.binding_handles, capacity)?;
        reserve(&mut self.font_handles, capacity)?;
        reserve(&mut self.stable_ids, capacity)?;
        reserve(&mut self.glyph_starts, capacity)?;
        reserve(&mut self.glyph_counts, capacity)?;
        reserve(&mut self.glyph_ids, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_clusters, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_x_advances, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_x_offsets, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_y_offsets, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_shape_flags, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_stable_ids, capacity.saturating_mul(2))?;
        reserve(&mut self.index_at, capacity.saturating_add(1))?;
        reserve(&mut self.shaped, capacity)?;
        reserve(&mut self.unsafe_before, capacity)
    }

    pub(crate) fn build(
        &mut self,
        input: ClusterBuildInput<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        self.clear();
        if text.len() != text_unit_ids.len() || text_unit_ids.contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        let boundaries = unicode.grapheme_boundaries();
        let count = boundaries.len().saturating_sub(1);
        self.reserve(text.len().max(count))?;
        let mut style_index = 0usize;
        for boundaries in boundaries.windows(2) {
            let start = boundaries[0];
            let end = boundaries[1];
            while styles
                .get(style_index)
                .is_some_and(|style| style.text_end <= start)
            {
                style_index += 1;
            }
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            // A resolved segment is the merge of every style covering the same run of text, so no
            // single style id owns the boundary that lands inside this cluster. The paragraph the
            // per-paragraph loop attaches is the whole attribution this cause carries.
            if style.text_start > start || style.text_end < end {
                return Err(EngineError::StyleSplitsCluster(FrameFault::default()));
            }
            let hard_break = is_hard_break(text, start)?;
            let space = text.get(start as usize) == Some(&0x20);
            let word_spacing = if space { style.style.word_spacing } else { 0.0 };
            self.starts.push(start);
            self.ends.push(end);
            self.advances.push(if hard_break {
                0.0
            } else {
                f64::from(style.style.letter_spacing + word_spacing)
            });
            self.flags.push(match (hard_break, space) {
                (true, _) => CLUSTER_HARD_BREAK,
                (false, true) => CLUSTER_SPACE,
                (false, false) => 0,
            });
            self.units_per_em.push(0.0);
            self.style_indexes
                .push(u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?);
            self.source_runs.push(NO_SOURCE_RUN);
            self.binding_handles.push(0);
            self.font_handles.push(0);
            self.stable_ids.push(
                *text_unit_ids
                    .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)?,
            );
            self.glyph_starts.push(0);
            self.glyph_counts.push(0);
            self.shaped.push(0);
            self.unsafe_before.push(0);
        }
        self.build_index(text.len())?;
        self.aggregate_shape(runs, shape, metrics_for)?;
        self.apply_break_flags(unicode)?;
        self.refresh_layout_units()?;
        Ok(())
    }

    pub(crate) fn rebuild_source_run_if_topology_is_stable(
        &mut self,
        previous: &Self,
        input: ClusterBuildInput<'_>,
        source_run: u32,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<Option<(usize, usize)>, EngineError> {
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        let boundaries = unicode.grapheme_boundaries();
        if text.len() != text_unit_ids.len()
            || text_unit_ids.contains(&0)
            || previous.index_at.len() != text.len().saturating_add(1)
            || boundaries.len().saturating_sub(1) != previous.starts.len()
            || boundaries
                .windows(2)
                .zip(&previous.starts)
                .any(|(pair, start)| pair[0] != *start)
            || boundaries
                .windows(2)
                .zip(&previous.ends)
                .any(|(pair, end)| pair[1] != *end)
            || shape.glyph_ids.len() != previous.glyph_ids.len()
            || [
                shape.clusters.len(),
                shape.x_advances.len(),
                shape.y_advances.len(),
                shape.x_offsets.len(),
                shape.y_offsets.len(),
                shape.glyph_flags.len(),
            ]
            .iter()
            .any(|length| *length != shape.glyph_ids.len())
        {
            return Ok(None);
        }
        let source_index = usize::try_from(source_run).map_err(|_| EngineError::InvalidRequest)?;
        let source = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
        let cluster_start = previous
            .starts
            .binary_search(&source.text_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end = previous
            .ends
            .binary_search(&source.text_end)
            .map(|index| index + 1)
            .map_err(|_| EngineError::InvalidRequest)?;
        if cluster_start >= cluster_end
            || shape.runs.iter().any(|run| {
                let start = usize::try_from(run.glyph_start).ok();
                let end = start.and_then(|start| {
                    usize::try_from(run.glyph_count)
                        .ok()
                        .and_then(|count| start.checked_add(count))
                });
                start.is_none()
                    || end.is_none()
                    || end.is_some_and(|end| end > shape.glyph_ids.len())
            })
        {
            return Ok(None);
        }
        self.copy_from(previous)?;
        for cluster in cluster_start..cluster_end {
            let start = self.starts[cluster];
            let end = self.ends[cluster];
            let style_index = usize::try_from(self.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            if style.text_start > start || style.text_end < end {
                self.clear();
                return Ok(None);
            }
            let hard_break = is_hard_break(text, start)?;
            let space = text.get(start as usize) == Some(&0x20);
            let word_spacing = if space { style.style.word_spacing } else { 0.0 };
            self.advances[cluster] = if hard_break {
                0.0
            } else {
                f64::from(style.style.letter_spacing + word_spacing)
            };
            self.flags[cluster] = match (hard_break, space) {
                (true, _) => CLUSTER_HARD_BREAK,
                (false, true) => CLUSTER_SPACE,
                (false, false) => 0,
            };
            self.units_per_em[cluster] = 0.0;
            self.source_runs[cluster] = NO_SOURCE_RUN;
            self.binding_handles[cluster] = 0;
            self.font_handles[cluster] = 0;
            self.stable_ids[cluster] = *text_unit_ids
                .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            self.glyph_counts[cluster] = 0;
            self.shaped[cluster] = 0;
            self.unsafe_before[cluster] = 0;
        }
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(source.style.font_size) / f64::from(metrics.units_per_em);
            let glyph_start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in glyph_start..glyph_end {
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                if cluster < cluster_start || cluster >= cluster_end {
                    return Err(EngineError::InvalidRequest);
                }
                self.assign_cluster_ownership(cluster, *shaped_run)?;
                self.shaped[cluster] = 1;
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.unsafe_before[cluster] |=
                    u8::from(shape.glyph_flags[glyph] & GLYPH_UNSAFE_TO_BREAK != 0);
                self.advances[cluster] += f64::from(shape.x_advances[glyph].unsigned_abs()) * scale;
                self.units_per_em[cluster] = f64::from(metrics.units_per_em);
            }
        }
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            self.fill_glyphless_run_ownership(
                runs,
                *shaped_run,
                f64::from(metrics.units_per_em),
                cluster_start,
                cluster_end,
            )?;
        }
        let adjacency_start = usize::try_from(previous.glyph_starts[cluster_start])
            .map_err(|_| EngineError::InvalidRequest)?;
        let adjacency_end = usize::try_from(previous.glyph_starts[cluster_end - 1])
            .ok()
            .and_then(|start| {
                usize::try_from(previous.glyph_counts[cluster_end - 1])
                    .ok()
                    .and_then(|count| start.checked_add(count))
            })
            .ok_or(EngineError::InvalidRequest)?;
        let mut cursor = adjacency_start;
        for cluster in cluster_start..cluster_end {
            self.glyph_starts[cluster] =
                u32::try_from(cursor).map_err(|_| EngineError::ResultTooLarge)?;
            cursor = cursor
                .checked_add(
                    usize::try_from(self.glyph_counts[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            self.glyph_counts[cluster] = 0;
        }
        if cursor != adjacency_end {
            self.clear();
            return Ok(None);
        }
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let glyph_start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in glyph_start..glyph_end {
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                let ordinal = usize::try_from(self.glyph_counts[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?;
                let destination = usize::try_from(self.glyph_starts[cluster])
                    .ok()
                    .and_then(|start| start.checked_add(ordinal))
                    .ok_or(EngineError::ResultTooLarge)?;
                self.glyph_ids[destination] = shape.glyph_ids[glyph];
                self.glyph_clusters[destination] = shape.clusters[glyph];
                self.glyph_x_advances[destination] = shape.x_advances[glyph];
                self.glyph_x_offsets[destination] = shape.x_offsets[glyph];
                self.glyph_y_offsets[destination] = shape.y_offsets[glyph];
                self.glyph_shape_flags[destination] = shape.glyph_flags[glyph];
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
        }
        for cluster in cluster_start..cluster_end {
            if self.shaped[cluster] != 0 && self.unsafe_before[cluster] == 0 {
                self.flags[cluster] |= CLUSTER_SAFE_BEFORE;
            }
        }
        if cluster_start > 0 {
            self.flags[cluster_start - 1] &= !CLUSTER_ALLOWED_BREAK;
        }
        for line_break in unicode.line_breaks() {
            let Some(preceding) = self.break_target(line_break.position, line_break.required)
            else {
                continue;
            };
            if preceding < cluster_start.saturating_sub(1) || preceding >= cluster_end {
                continue;
            }
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
            } else {
                let safe = line_break.position == self.ends.last().copied().unwrap_or(0)
                    || self
                        .starts
                        .binary_search(&line_break.position)
                        .ok()
                        .is_some_and(|next| self.flags[next] & CLUSTER_SAFE_BEFORE != 0);
                if safe {
                    self.flags[preceding] |= CLUSTER_ALLOWED_BREAK;
                }
            }
        }
        self.refresh_layout_units()?;
        Ok(Some((cluster_start, cluster_end)))
    }

    /// Re-derives the F16.16 advance stream from the f64 advances. Both public build
    /// paths end here, so the streams can never disagree outside the rounding
    /// contract.
    pub(crate) fn refresh_layout_units(&mut self) -> Result<(), EngineError> {
        self.advance_units.clear();
        reserve(&mut self.advance_units, self.advances.len())?;
        self.advance_units.extend(
            self.advances
                .iter()
                .map(|advance| super::layout_units::layout_units_from_scaled(*advance)),
        );
        // Chunk-64 summaries (D-245): per 64-cluster chunk, the total advance, the
        // advance carried by shrinkable spaces, and the OR of every cluster flag.
        // The fit skips whole fitting chunks through these sums — exact, because
        // integer addition is associative — and resolves the last break position
        // inside a chunk only when a break is actually needed. The tail chunk is
        // summarized too; consumers gate on full-chunk availability themselves.
        let chunk_count = self.advance_units.len().div_ceil(LAYOUT_CHUNK);
        self.chunk_advance_sums.clear();
        self.chunk_space_sums.clear();
        self.chunk_flags_or.clear();
        reserve(&mut self.chunk_advance_sums, chunk_count)?;
        reserve(&mut self.chunk_space_sums, chunk_count)?;
        reserve(&mut self.chunk_flags_or, chunk_count)?;
        summarize_unit_chunks(
            &self.advance_units,
            &self.flags,
            &mut self.chunk_advance_sums,
            &mut self.chunk_space_sums,
            &mut self.chunk_flags_or,
        );
        Ok(())
    }

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
    pub(crate) fn intrinsic_widths(&self, wrap: u8) -> IntrinsicWidths {
        let mut min_run = 0.0_f64;
        let mut max_run = 0.0_f64;
        let mut space_tail = 0.0_f64;
        let mut min_content = 0.0_f64;
        let mut max_content = 0.0_f64;
        for index in 0..self.starts.len() {
            let flags = self.flags[index];
            if flags & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0 {
                // A forced break terminates the segment. A required-break cluster is
                // still part of its line (the breaker includes its advance); a hard
                // break is the newline glyph itself and contributes nothing.
                if flags & CLUSTER_REQUIRED_BREAK != 0 {
                    let advance = self.advances[index];
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
            let advance = self.advances[index];
            min_run += advance;
            max_run += advance;
            space_tail = if flags & CLUSTER_SPACE != 0 {
                space_tail + advance
            } else {
                0.0
            };
            let can_break_after = match wrap {
                WRAP_WORD => flags & CLUSTER_ALLOWED_BREAK != 0,
                WRAP_CHARACTER => {
                    index + 1 == self.starts.len()
                        || self.flags[index + 1] & CLUSTER_SAFE_BEFORE != 0
                }
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

    fn copy_from(&mut self, source: &Self) -> Result<(), EngineError> {
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
        Ok(())
    }

    /// Metric-only restyle over a retained shape: copies the previous arena and
    /// re-derives the advance lanes from the adjacency stream under the CURRENT
    /// styles — no topology walk, no scatter, no registry resolution, and the
    /// stable glyph identities carry over verbatim. The aggregation replays the
    /// full build exactly: same accumulation order (adjacency order preserves
    /// per-cluster shaping order), same expressions, so the result is
    /// bit-identical to a cold build under the new styles. Returns `Ok(None)`
    /// when the previous arena cannot prove the styles still align, and the
    /// caller falls back to the full build.
    pub(crate) fn refresh_scales_from_stream(
        &mut self,
        previous: &Self,
        styles: &[StyleSegment],
    ) -> Result<Option<()>, EngineError> {
        self.copy_from(previous)?;
        let stream_len = self.glyph_ids.len();
        if self.glyph_x_advances.len() != stream_len {
            self.clear();
            return Ok(None);
        }
        for cluster in 0..self.starts.len() {
            let style_index = usize::try_from(self.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let Some(segment) = styles.get(style_index) else {
                self.clear();
                return Ok(None);
            };
            if segment.text_start > self.starts[cluster] || segment.text_end < self.ends[cluster] {
                self.clear();
                return Ok(None);
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
        self.refresh_layout_units()?;
        Ok(Some(()))
    }

    pub(crate) fn assign_stable_glyph_ids_in_range(
        &mut self,
        previous: &Self,
        cluster_start: usize,
        cluster_end: usize,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        index
            .prepare(cluster_end.saturating_sub(cluster_start))
            .map_err(identity_index_error)?;
        for cluster in cluster_start..cluster_end {
            index
                .insert(
                    previous.stable_ids[cluster],
                    u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        *next_id = (*next_id).max(1);
        for cluster in cluster_start..cluster_end {
            let new_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let new_count = usize::try_from(self.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let previous_cluster = index
                .get(self.stable_ids[cluster])
                .and_then(|value| usize::try_from(value).ok());
            let previous_start = previous_cluster
                .and_then(|cluster| previous.glyph_starts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            let previous_count = previous_cluster
                .and_then(|cluster| previous.glyph_counts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            for ordinal in 0..new_count {
                self.glyph_stable_ids[new_start + ordinal] = if ordinal < previous_count {
                    previous.glyph_stable_ids[previous_start + ordinal]
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
            }
        }
        Ok(())
    }

    pub(crate) fn assign_stable_glyph_ids(
        &mut self,
        previous: &Self,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        index
            .prepare(previous.stable_ids.len())
            .map_err(identity_index_error)?;
        for (cluster, &stable_id) in previous.stable_ids.iter().enumerate() {
            index
                .insert(
                    stable_id,
                    u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        reserve(&mut self.glyph_stable_ids, self.glyph_ids.len())?;
        self.glyph_stable_ids.resize(self.glyph_ids.len(), 0);
        *next_id = (*next_id).max(1);
        for cluster in 0..self.stable_ids.len() {
            let new_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let new_count = usize::try_from(self.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let previous_cluster = index
                .get(self.stable_ids[cluster])
                .and_then(|value| usize::try_from(value).ok());
            let previous_start = previous_cluster
                .and_then(|cluster| previous.glyph_starts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            let previous_count = previous_cluster
                .and_then(|cluster| previous.glyph_counts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            for ordinal in 0..new_count {
                let stable_id = if ordinal < previous_count {
                    *previous
                        .glyph_stable_ids
                        .get(previous_start + ordinal)
                        .filter(|id| **id != 0)
                        .ok_or(EngineError::InvalidRequest)?
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
                *self
                    .glyph_stable_ids
                    .get_mut(new_start + ordinal)
                    .ok_or(EngineError::InvalidRequest)? = stable_id;
            }
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.starts.clear();
        self.ends.clear();
        self.advances.clear();
        self.advance_units.clear();
        self.chunk_advance_sums.clear();
        self.chunk_space_sums.clear();
        self.chunk_flags_or.clear();
        self.units_per_em.clear();
        self.flags.clear();
        self.style_indexes.clear();
        self.source_runs.clear();
        self.binding_handles.clear();
        self.font_handles.clear();
        self.stable_ids.clear();
        self.glyph_starts.clear();
        self.glyph_counts.clear();
        self.glyph_ids.clear();
        self.glyph_clusters.clear();
        self.glyph_x_advances.clear();
        self.glyph_x_offsets.clear();
        self.glyph_y_offsets.clear();
        self.glyph_shape_flags.clear();
        self.glyph_stable_ids.clear();
        self.index_at.clear();
        self.shaped.clear();
        self.unsafe_before.clear();
    }

    fn build_index(&mut self, text_length: usize) -> Result<(), EngineError> {
        let mut cluster = 0usize;
        for offset in 0..=text_length {
            while self
                .ends
                .get(cluster)
                .is_some_and(|end| *end <= offset as u32)
            {
                cluster += 1;
            }
            self.index_at
                .push(u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?);
        }
        Ok(())
    }

    fn aggregate_shape(
        &mut self,
        runs: &[ShapingRun],
        shape: &ShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        if [
            shape.clusters.len(),
            shape.x_advances.len(),
            shape.x_offsets.len(),
            shape.y_offsets.len(),
            shape.glyph_flags.len(),
        ]
        .iter()
        .any(|length| *length != shape.glyph_ids.len())
        {
            return Err(EngineError::InvalidRequest);
        }
        let stream_len = shape.glyph_ids.len();
        reserve(&mut self.glyph_ids, stream_len)?;
        reserve(&mut self.glyph_clusters, stream_len)?;
        reserve(&mut self.glyph_x_advances, stream_len)?;
        reserve(&mut self.glyph_x_offsets, stream_len)?;
        reserve(&mut self.glyph_y_offsets, stream_len)?;
        reserve(&mut self.glyph_shape_flags, stream_len)?;
        self.glyph_ids.resize(stream_len, 0);
        self.glyph_clusters.resize(stream_len, 0);
        self.glyph_x_advances.resize(stream_len, 0);
        self.glyph_x_offsets.resize(stream_len, 0);
        self.glyph_y_offsets.resize(stream_len, 0);
        self.glyph_shape_flags.resize(stream_len, 0);
        for shaped_run in &shape.runs {
            let source_index =
                usize::try_from(shaped_run.source_run).map_err(|_| EngineError::InvalidRequest)?;
            let source = runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(source.style.font_size) / f64::from(metrics.units_per_em);
            let start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let end = start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in start..end {
                let cluster = *shape
                    .clusters
                    .get(glyph)
                    .ok_or(EngineError::InvalidRequest)?;
                let cluster_index = self.cluster_at(cluster)?;
                self.assign_cluster_ownership(cluster_index, *shaped_run)?;
                self.shaped[cluster_index] = 1;
                self.glyph_counts[cluster_index] = self.glyph_counts[cluster_index]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.unsafe_before[cluster_index] |= u8::from(
                    shape
                        .glyph_flags
                        .get(glyph)
                        .is_some_and(|flags| flags & GLYPH_UNSAFE_TO_BREAK != 0),
                );
                self.advances[cluster_index] += f64::from(
                    shape
                        .x_advances
                        .get(glyph)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?
                        .unsigned_abs(),
                ) * scale;
                self.units_per_em[cluster_index] = f64::from(metrics.units_per_em);
            }
        }
        for shaped_run in &shape.runs {
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            self.fill_glyphless_run_ownership(
                runs,
                *shaped_run,
                f64::from(metrics.units_per_em),
                0,
                self.starts.len(),
            )?;
        }
        let mut glyph_start = 0_u32;
        for index in 0..self.glyph_starts.len() {
            self.glyph_starts[index] = glyph_start;
            glyph_start = glyph_start
                .checked_add(self.glyph_counts[index])
                .ok_or(EngineError::ResultTooLarge)?;
            self.glyph_counts[index] = 0;
        }
        if usize::try_from(glyph_start).ok() != Some(shape.glyph_ids.len()) {
            return Err(EngineError::InvalidRequest);
        }
        if scatter_is_identity(shape) {
            // The common simple-script shape leaves glyphs already in cluster
            // order — the scatter permutation is the identity — so the payload
            // columns fill by bulk copy and the counts recover from the prefix
            // sums the starts pass just produced.
            self.glyph_ids.copy_from_slice(&shape.glyph_ids);
            self.glyph_clusters.copy_from_slice(&shape.clusters);
            self.glyph_x_advances.copy_from_slice(&shape.x_advances);
            self.glyph_x_offsets.copy_from_slice(&shape.x_offsets);
            self.glyph_y_offsets.copy_from_slice(&shape.y_offsets);
            self.glyph_shape_flags.copy_from_slice(&shape.glyph_flags);
            for index in 0..self.glyph_starts.len() {
                let next = self
                    .glyph_starts
                    .get(index + 1)
                    .copied()
                    .unwrap_or(glyph_start);
                self.glyph_counts[index] = next - self.glyph_starts[index];
            }
        } else {
            for shaped_run in &shape.runs {
                let start = usize::try_from(shaped_run.glyph_start)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let end = start
                    .checked_add(
                        usize::try_from(shaped_run.glyph_count)
                            .map_err(|_| EngineError::InvalidRequest)?,
                    )
                    .ok_or(EngineError::InvalidRequest)?;
                for glyph in start..end {
                    let cluster = *shape
                        .clusters
                        .get(glyph)
                        .ok_or(EngineError::InvalidRequest)?;
                    let cluster_index = self.cluster_at(cluster)?;
                    let ordinal = self.glyph_counts[cluster_index];
                    let destination = self.glyph_starts[cluster_index]
                        .checked_add(ordinal)
                        .and_then(|value| usize::try_from(value).ok())
                        .ok_or(EngineError::ResultTooLarge)?;
                    if destination >= self.glyph_ids.len() {
                        return Err(EngineError::InvalidRequest);
                    }
                    self.glyph_ids[destination] = shape.glyph_ids[glyph];
                    self.glyph_clusters[destination] = shape.clusters[glyph];
                    self.glyph_x_advances[destination] = shape.x_advances[glyph];
                    self.glyph_x_offsets[destination] = shape.x_offsets[glyph];
                    self.glyph_y_offsets[destination] = shape.y_offsets[glyph];
                    self.glyph_shape_flags[destination] = shape.glyph_flags[glyph];
                    self.glyph_counts[cluster_index] =
                        ordinal.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                }
            }
        }
        for index in 0..self.starts.len() {
            if self.shaped[index] != 0 && self.unsafe_before[index] == 0 {
                self.flags[index] |= CLUSTER_SAFE_BEFORE;
            }
        }
        Ok(())
    }

    fn assign_cluster_ownership(
        &mut self,
        cluster: usize,
        shaped_run: super::shaping_state::ShapedRun,
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
    fn fill_glyphless_run_ownership(
        &mut self,
        runs: &[ShapingRun],
        shaped_run: super::shaping_state::ShapedRun,
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

    fn apply_break_flags(&mut self, unicode: &UnicodeAnalysis) -> Result<(), EngineError> {
        for line_break in unicode.line_breaks() {
            let end = line_break.position;
            if self.ends.is_empty() && end == 0 {
                continue;
            }
            let Some(preceding) = self.break_target(end, line_break.required) else {
                continue;
            };
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
                continue;
            }
            let safe = end == self.ends.last().copied().unwrap_or(0)
                || self
                    .starts
                    .binary_search(&end)
                    .ok()
                    .is_some_and(|next| self.flags[next] & CLUSTER_SAFE_BEFORE != 0);
            if safe {
                self.flags[preceding] |= CLUSTER_ALLOWED_BREAK;
            }
        }
        Ok(())
    }

    /// Resolve a UAX #14 opportunity to the cluster it can act on, or discard it.
    ///
    /// The two standards disagree by design: UAX #14 LB9 does not attach a combining mark to a
    /// preceding SPACE while UAX #29 GB9 does, so an opportunity can fall strictly inside a
    /// grapheme cluster. A cluster is indivisible for layout, so an OPTIONAL opportunity there is
    /// unusable and is discarded rather than promoted to the enclosing boundary -- promoting it
    /// would manufacture a break UAX #14 never offered. A REQUIRED break must never be dropped, so
    /// it acts on the cluster that contains it.
    ///
    /// `ends` is strictly increasing, so `partition_point` names the cluster ending at the offset
    /// when the offset is a boundary and the cluster containing it otherwise. Both consumers of
    /// `line_breaks()` route through here; writing the rule twice let them disagree about whether
    /// an interior required break survives.
    fn break_target(&self, position: u32, required: bool) -> Option<usize> {
        let index = self.ends.partition_point(|end| *end < position);
        let target = self.ends.get(index)?;
        (*target == position || required).then_some(index)
    }

    fn cluster_at(&self, offset: u32) -> Result<usize, EngineError> {
        let index = *self
            .index_at
            .get(usize::try_from(offset).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let index = usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?;
        if !self
            .starts
            .get(index)
            .zip(self.ends.get(index))
            .is_some_and(|(start, end)| *start <= offset && offset < *end)
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(index)
    }
}

fn is_hard_break(text: &[u16], start: u32) -> Result<bool, EngineError> {
    let unit = *text
        .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(matches!(
        unit,
        0x0a | 0x0b | 0x0c | 0x0d | 0x85 | 0x2028 | 0x2029
    ))
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), EngineError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

/// True exactly when the build scatter's destination equals every glyph's own
/// index: the shaped runs tile the glyph array in array order and the source
/// cluster ids never decrease across it, so per-cluster ordinals assign
/// sequentially. Simple-script LTR shaping satisfies this; any reordering
/// (RTL, Indic) falls back to the per-glyph scatter.
fn scatter_is_identity(shape: &ShapeArena) -> bool {
    let mut cursor = 0_u64;
    for run in &shape.runs {
        if u64::from(run.glyph_start) != cursor {
            return false;
        }
        cursor += u64::from(run.glyph_count);
    }
    cursor == shape.glyph_ids.len() as u64
        && shape.clusters.windows(2).all(|pair| pair[0] <= pair[1])
}

fn identity_index_error(error: IdentityIndexError) -> EngineError {
    match error {
        IdentityIndexError::AllocationFailed | IdentityIndexError::ArithmeticOverflow => {
            EngineError::ResultTooLarge
        }
        IdentityIndexError::DuplicateIdentity => EngineError::InvalidRequest,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        shaping_state::{ShapedRun, ShapingRun},
        style_state::{ResolvedStyle, StyleSegment},
    };
    use alloc::vec;

    #[test]
    fn aggregates_scaled_advances_spacing_and_legal_breaks() {
        let text: Vec<u16> = "a b\n".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 2.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let mut shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![3, 2, 1],
            clusters: vec![2, 1, 0],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(clusters.starts, [0, 1, 2, 3]);
        assert_eq!(clusters.ends, [1, 2, 3, 4]);
        assert_eq!(clusters.advances, [9.0, 7.0, 9.0, 0.0]);
        // The F16.16 stream must quantize the COMPLETE advances — including the
        // shape aggregation that runs after the initial spacing fill — or the
        // integer fit sees spacing-only widths and stops wrapping.
        assert_eq!(
            clusters.advance_units,
            [9 * 65_536, 7 * 65_536, 9 * 65_536, 0]
        );
        assert_eq!(clusters.style_indexes, [0; 4]);
        assert_eq!(clusters.source_runs, [0, 0, 0, NO_SOURCE_RUN]);
        assert_eq!(clusters.font_handles, [9, 9, 9, 0]);
        assert_eq!(clusters.stable_ids, [1, 2, 3, 4]);
        assert_eq!(clusters.glyph_starts, [0, 1, 2, 3]);
        assert_eq!(clusters.glyph_counts, [1, 1, 1, 0]);
        // The reversed shape order lands in the adjacency stream as cluster-order
        // payload: cluster 0 owns shape glyph 2, cluster 2 owns shape glyph 0.
        assert_eq!(clusters.glyph_ids, [1, 2, 3]);
        assert_eq!(clusters.glyph_clusters, [0, 1, 2]);
        assert_eq!(clusters.glyph_x_advances, [500, 250, 500]);
        assert_eq!(clusters.index_at, [0, 1, 2, 3, 4]);
        assert_eq!(clusters.flags[0], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[1],
            CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE
        );
        assert_eq!(clusters.flags[2], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[3],
            CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK
        );

        let capacities = (
            clusters.starts.capacity(),
            clusters.advances.capacity(),
            clusters.flags.capacity(),
            clusters.glyph_starts.capacity(),
            clusters.glyph_counts.capacity(),
            clusters.glyph_ids.capacity(),
            clusters.index_at.capacity(),
        );
        shape.glyph_flags[0] = GLYPH_UNSAFE_TO_BREAK;
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(
            capacities,
            (
                clusters.starts.capacity(),
                clusters.advances.capacity(),
                clusters.flags.capacity(),
                clusters.glyph_starts.capacity(),
                clusters.glyph_counts.capacity(),
                clusters.glyph_ids.capacity(),
                clusters.index_at.capacity(),
            )
        );
        assert_eq!(clusters.flags[1], CLUSTER_SAFE_BEFORE | CLUSTER_SPACE);
        assert_eq!(clusters.flags[2], 0);
    }

    /// A style boundary interior to an extended grapheme cluster still rejects the frame -- one
    /// style per cluster is not negotiable -- but it now reports its own status instead of the
    /// undifferentiated `InvalidRequest` that also stood for every arena invariant (D-267). No
    /// single style id owns a resolved segment boundary, so this cause names only the paragraph,
    /// which the per-paragraph loop attaches.
    #[test]
    fn a_style_boundary_inside_a_cluster_reports_its_own_cause() {
        let text: Vec<u16> = "a\u{301}b".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        // The first grapheme cluster spans [0, 2); these segments split it at 1.
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 1,
                style,
            },
            StyleSegment {
                text_start: 1,
                text_end: 3,
                style: ResolvedStyle::test_typography(24.0, 0.0, 0.0),
            },
        ];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![1, 2, 3],
            clusters: vec![0, 1, 2],
            x_advances: vec![500; 3],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut clusters = ClusterArena::default();
        assert_eq!(
            clusters.build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            ),
            Err(EngineError::StyleSplitsCluster(FrameFault::default()))
        );
    }

    /// UAX #14 LB9 does not attach a combining mark to a preceding SPACE, while UAX #29 GB9 does,
    /// so `"x \u{301}y"` offers a line break at offset 2 that falls strictly inside the grapheme
    /// cluster spanning [1, 3). A cluster is indivisible for layout, so that opportunity is
    /// unusable -- but it is well-formed input from two standards that disagree by design, and
    /// rejecting the whole frame for it made the paragraph unpublishable.
    #[test]
    fn a_line_break_inside_a_grapheme_cluster_is_ignored_rather_than_rejected() {
        let text: Vec<u16> = "x \u{301}y".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        assert!(
            unicode
                .line_breaks()
                .iter()
                .any(|entry| entry.position == 2),
            "the case rests on UAX #14 offering a break strictly inside the cluster",
        );

        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 4,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![1, 2, 3],
            clusters: vec![0, 1, 3],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .expect("a break opportunity inside a cluster must not reject the paragraph");

        assert_eq!(clusters.starts, [0, 1, 3]);
        assert_eq!(clusters.ends, [1, 3, 4]);
        // The unusable opportunity leaves no break on the cluster that contains it.
        assert_eq!(clusters.flags[1] & CLUSTER_ALLOWED_BREAK, 0);
    }

    #[test]
    fn stable_glyph_ids_follow_clusters_and_reuse_ordinals_transactionally() {
        let previous = ClusterArena {
            stable_ids: vec![10, 20],
            glyph_starts: vec![0, 2],
            glyph_counts: vec![2, 1],
            glyph_stable_ids: vec![1, 2, 3],
            ..ClusterArena::default()
        };
        let mut pending = ClusterArena {
            stable_ids: vec![30, 10, 20],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 2],
            glyph_ids: vec![0; 4],
            ..ClusterArena::default()
        };
        let mut index = IdentityIndex::default();
        let mut next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);

        let capacities = index.capacities();
        pending.glyph_stable_ids.clear();
        next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);
        assert_eq!(index.capacities(), capacities);
    }

    #[test]
    fn glyphless_ligature_continuation_inherits_shape_run_ownership() {
        let text: Vec<u16> = "ff".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 2,
                glyph_start: 0,
                glyph_count: 1,
            }],
            glyph_ids: vec![42],
            clusters: vec![0],
            x_advances: vec![1_000],
            y_advances: vec![0],
            x_offsets: vec![0],
            y_offsets: vec![0],
            glyph_flags: vec![GLYPH_UNSAFE_TO_BREAK],
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
            )
            .unwrap();

        assert_eq!(clusters.source_runs, [0, 0]);
        assert_eq!(clusters.binding_handles, [19, 19]);
        assert_eq!(clusters.font_handles, [9, 9]);
        assert_eq!(clusters.glyph_counts, [1, 0]);
        assert_eq!(clusters.advances, [16.0, 0.0]);
        assert_eq!(clusters.flags[1] & CLUSTER_SAFE_BEFORE, 0);
    }

    #[test]
    fn reordered_glyph_offset_maps_to_its_containing_grapheme() {
        let text: Vec<u16> = "त्ये".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        assert_eq!(unicode.grapheme_boundaries(), &[0, 4]);
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 4,
            script: u32::from_be_bytes(*b"Deva"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 4,
                glyph_start: 0,
                glyph_count: 1,
            }],
            glyph_ids: vec![42],
            clusters: vec![2],
            x_advances: vec![1_000],
            y_advances: vec![0],
            x_offsets: vec![0],
            y_offsets: vec![0],
            glyph_flags: vec![GLYPH_UNSAFE_TO_BREAK],
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                |_| {
                    Some(FontMetrics {
                        units_per_em: 1_000,
                        ascender: 800,
                        descender: -200,
                        line_gap: 0,
                        underline_position: -100,
                        underline_thickness: 50,
                        strikeout_position: 300,
                        strikeout_size: 50,
                    })
                },
            )
            .unwrap();

        assert_eq!(clusters.index_at, [0, 0, 0, 0, 1]);
        assert_eq!(clusters.glyph_counts, [1]);
        assert_eq!(clusters.glyph_ids, [42]);
        assert_eq!(clusters.source_runs, [0]);
    }

    #[test]
    fn retained_source_run_rebuild_matches_the_cold_cluster_oracle() {
        let old_text: Vec<u16> = "ab".encode_utf16().collect();
        let new_text: Vec<u16> = "ac".encode_utf16().collect();
        let mut old_unicode = UnicodeAnalysis::default();
        old_unicode.analyze(&old_text).unwrap();
        let mut new_unicode = UnicodeAnalysis::default();
        new_unicode.analyze(&new_text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let make_shape = |second_glyph, second_advance| ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 2,
                glyph_start: 0,
                glyph_count: 2,
            }],
            glyph_ids: vec![1, second_glyph],
            clusters: vec![0, 1],
            x_advances: vec![500, second_advance],
            y_advances: vec![0; 2],
            x_offsets: vec![0; 2],
            y_offsets: vec![0; 2],
            glyph_flags: vec![0; 2],
        };
        let old_shape = make_shape(2, 500);
        let new_shape = make_shape(3, 600);
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let mut previous = ClusterArena::default();
        previous
            .build(
                ClusterBuildInput {
                    text: &old_text,
                    text_unit_ids: &[10, 20],
                    unicode: &old_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &old_shape,
                },
                metrics,
            )
            .unwrap();
        let mut next_id = 1;
        previous
            .assign_stable_glyph_ids(
                &ClusterArena::default(),
                &mut IdentityIndex::default(),
                &mut next_id,
            )
            .unwrap();
        let mut cold = ClusterArena::default();
        cold.build(
            ClusterBuildInput {
                text: &new_text,
                text_unit_ids: &[10, 30],
                unicode: &new_unicode,
                styles: &styles,
                runs: &runs,
                shape: &new_shape,
            },
            metrics,
        )
        .unwrap();
        let mut cold_next_id = next_id;
        cold.assign_stable_glyph_ids(&previous, &mut IdentityIndex::default(), &mut cold_next_id)
            .unwrap();
        let mut retained = ClusterArena::default();
        let (cluster_start, cluster_end) = retained
            .rebuild_source_run_if_topology_is_stable(
                &previous,
                ClusterBuildInput {
                    text: &new_text,
                    text_unit_ids: &[10, 30],
                    unicode: &new_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &new_shape,
                },
                0,
                metrics,
            )
            .unwrap()
            .unwrap();
        let mut retained_next_id = next_id;
        retained
            .assign_stable_glyph_ids_in_range(
                &previous,
                cluster_start,
                cluster_end,
                &mut IdentityIndex::default(),
                &mut retained_next_id,
            )
            .unwrap();
        macro_rules! assert_lane {
            ($field:ident) => {
                assert_eq!(retained.$field, cold.$field, stringify!($field));
            };
        }
        assert_lane!(starts);
        assert_lane!(ends);
        assert_lane!(advances);
        assert_lane!(advance_units);
        assert_lane!(units_per_em);
        assert_lane!(flags);
        assert_lane!(style_indexes);
        assert_lane!(source_runs);
        assert_lane!(binding_handles);
        assert_lane!(font_handles);
        assert_lane!(stable_ids);
        assert_lane!(glyph_starts);
        assert_lane!(glyph_counts);
        assert_lane!(glyph_ids);
        assert_lane!(glyph_clusters);
        assert_lane!(glyph_x_advances);
        assert_lane!(glyph_x_offsets);
        assert_lane!(glyph_y_offsets);
        assert_lane!(glyph_shape_flags);
        assert_lane!(glyph_stable_ids);
        assert_lane!(index_at);
        assert_lane!(shaped);
        assert_lane!(unsafe_before);
        assert_eq!(retained_next_id, cold_next_id);
    }

    #[test]
    fn identity_scatter_admits_only_ordered_tiling_runs() {
        let shape = |glyph_start, clusters: Vec<u32>| ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start,
                glyph_count: u32::try_from(clusters.len()).unwrap(),
            }],
            glyph_ids: vec![1; clusters.len()],
            clusters,
            x_advances: vec![500; 3],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        assert!(scatter_is_identity(&shape(0, vec![0, 1, 2])));
        assert!(scatter_is_identity(&shape(0, vec![0, 0, 2])));
        // Reordered clusters or a run that does not tile from zero fall back.
        assert!(!scatter_is_identity(&shape(0, vec![2, 1, 0])));
        assert!(!scatter_is_identity(&shape(1, vec![0, 1, 2])));
        // The empty shape is trivially identity.
        assert!(scatter_is_identity(&ShapeArena::default()));
    }

    #[test]
    fn metrics_refresh_from_the_stream_matches_the_cold_build_oracle() {
        let text: Vec<u16> = "a b\n".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let segment = |style| {
            [StyleSegment {
                text_start: 0,
                text_end: 4,
                style,
            }]
        };
        let run = |style| {
            [ShapingRun {
                text_start: 0,
                text_end: 3,
                script: u32::from_be_bytes(*b"Latn"),
                direction: 4,
                bidi_level: 0,
                style,
            }]
        };
        let shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![3, 2, 1],
            clusters: vec![2, 1, 0],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
                underline_position: -100,
                underline_thickness: 50,
                strikeout_position: 300,
                strikeout_size: 50,
            })
        };
        let old_style = ResolvedStyle::test_typography(16.0, 1.0, 2.0);
        let new_style = ResolvedStyle::test_typography(18.0, 2.5, 3.0);
        let build = |style| {
            let mut arena = ClusterArena::default();
            arena
                .build(
                    ClusterBuildInput {
                        text: &text,
                        text_unit_ids: &[1, 2, 3, 4],
                        unicode: &unicode,
                        styles: &segment(style),
                        runs: &run(style),
                        shape: &shape,
                    },
                    metrics,
                )
                .unwrap();
            let mut next_id = 1;
            arena
                .assign_stable_glyph_ids(
                    &ClusterArena::default(),
                    &mut IdentityIndex::default(),
                    &mut next_id,
                )
                .unwrap();
            arena
        };
        let previous = build(old_style);
        let cold = build(new_style);
        let mut refreshed = ClusterArena::default();
        refreshed
            .refresh_scales_from_stream(&previous, &segment(new_style))
            .unwrap()
            .unwrap();
        macro_rules! assert_lane {
            ($field:ident) => {
                assert_eq!(refreshed.$field, cold.$field, stringify!($field));
            };
        }
        assert_lane!(starts);
        assert_lane!(ends);
        assert_lane!(advances);
        assert_lane!(advance_units);
        assert_lane!(chunk_advance_sums);
        assert_lane!(chunk_space_sums);
        assert_lane!(chunk_flags_or);
        assert_lane!(units_per_em);
        assert_lane!(flags);
        assert_lane!(style_indexes);
        assert_lane!(source_runs);
        assert_lane!(binding_handles);
        assert_lane!(font_handles);
        assert_lane!(stable_ids);
        assert_lane!(glyph_starts);
        assert_lane!(glyph_counts);
        assert_lane!(glyph_ids);
        assert_lane!(glyph_clusters);
        assert_lane!(glyph_x_advances);
        assert_lane!(glyph_x_offsets);
        assert_lane!(glyph_y_offsets);
        assert_lane!(glyph_shape_flags);
        assert_lane!(glyph_stable_ids);
        assert_lane!(index_at);
        assert_lane!(shaped);
        assert_lane!(unsafe_before);
        // The refresh must refuse styles that no longer cover the clusters.
        let mut misaligned = ClusterArena::default();
        assert!(
            misaligned
                .refresh_scales_from_stream(
                    &previous,
                    &[StyleSegment {
                        text_start: 0,
                        text_end: 2,
                        style: new_style,
                    }],
                )
                .unwrap()
                .is_none()
        );
    }

    /// A hand-built arena over "ax by c" plus a hard break, so the intrinsic scan's
    /// wrap-policy mirroring is pinned cluster by cluster without shaping.
    fn intrinsic_fixture() -> ClusterArena {
        //                 a     x     sp    b     y     sp    c
        let advances = vec![10.0, 5.0, 3.0, 7.0, 2.0, 3.0, 6.0];
        let flags = vec![
            0,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK,
            0,
            CLUSTER_ALLOWED_BREAK,
            CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK,
            0,
        ];
        let starts = vec![0, 1, 2, 3, 4, 5, 6];
        let ends = vec![1, 2, 3, 4, 5, 6, 7];
        ClusterArena {
            advances,
            flags,
            starts,
            ends,
            ..Default::default()
        }
    }

    #[test]
    fn intrinsic_widths_mirror_the_word_wrap_break_decisions() {
        let clusters = intrinsic_fixture();
        let widths = clusters.intrinsic_widths(WRAP_WORD);
        // Word runs: "ax" (15), "b y" (9), "c" (6); separating spaces trim off.
        assert_eq!(widths.min_content_width, 15.0);
        assert_eq!(widths.max_content_width, 36.0);
    }

    #[test]
    fn character_wrap_takes_every_safe_boundary_and_none_wraps_never() {
        let mut clusters = intrinsic_fixture();
        for flag in clusters.flags.iter_mut() {
            *flag |= CLUSTER_SAFE_BEFORE;
        }
        let character = clusters.intrinsic_widths(WRAP_CHARACTER);
        assert_eq!(character.min_content_width, 10.0);
        let none = clusters.intrinsic_widths(WRAP_NONE);
        assert_eq!(none.min_content_width, 36.0);
        assert_eq!(none.max_content_width, 36.0);
    }

    #[test]
    fn forced_breaks_terminate_intrinsic_segments() {
        let mut clusters = intrinsic_fixture();
        clusters.flags[4] |= CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK;
        let widths = clusters.intrinsic_widths(WRAP_NONE);
        // "ax b y" ends at the forced break (27); the trailing " c" run closes at
        // the end of text (9). No soft breaks exist under none, so both agree.
        assert_eq!(widths.max_content_width, 27.0);
        assert_eq!(widths.min_content_width, 27.0);
    }

    #[test]
    fn fixed_wide_lane_preserves_large_advances_and_chunk_summary_semantics() {
        let mut arena = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK + 1],
            flags: vec![CLUSTER_ALLOWED_BREAK; LAYOUT_CHUNK + 1],
            ..ClusterArena::default()
        };
        arena.flags[3] |= CLUSTER_SPACE;
        arena.refresh_layout_units().unwrap();
        assert_eq!(arena.chunk_advance_sums, [64 * 65_536, 65_536]);
        assert_eq!(arena.chunk_space_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );

        arena.advances[LAYOUT_CHUNK] = 32_768.0;
        arena.refresh_layout_units().unwrap();
        assert_eq!(arena.chunk_advance_sums[0], 64 * 65_536);
        assert_eq!(arena.chunk_advance_sums[1], 2_147_483_648);
        assert_eq!(arena.chunk_space_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );
    }
}
