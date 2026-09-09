use alloc::vec::Vec;
use core::num::NonZeroU32;

use crate::{FontGlyphExtents, FontMetrics, unicode::UnicodeAnalysis};

use super::{
    EngineError, FrameFault,
    frame::{WRAP_CHARACTER, WRAP_NONE, WRAP_WORD},
    identity_index::{IdentityIndex, IdentityIndexError},
    run_local::{NumericBlockSpan, RunLocalArena},
    run_slot::RunHandle,
    shaping_state::{ShapeArena, ShapingRun},
    style_state::{StyleArena, StyleSegment},
};

use super::run_local::{ClusterFinish, RunLocalBuildError, RunLocalGlyphInput};

pub(crate) const CLUSTER_SAFE_BEFORE: u8 = 1 << 0;
pub(crate) const CLUSTER_REQUIRED_BREAK: u8 = 1 << 1;
pub(crate) const CLUSTER_HARD_BREAK: u8 = 1 << 2;
pub(crate) const CLUSTER_ALLOWED_BREAK: u8 = 1 << 3;
/// The cluster starts with U+0020 — a justifiable, shrinkable word space.
pub(crate) const CLUSTER_SPACE: u8 = 1 << 4;
/// Chunk-summary marker for a negative advance, packed above the cluster flag domain.
pub(crate) const CHUNK_NEGATIVE_ADVANCE: u8 = 1 << 5;

use super::shaping_state::GLYPH_FLAG_UNSAFE_TO_BREAK as GLYPH_UNSAFE_TO_BREAK;

/// Intrinsic inline extents derived from one cluster-arena scan, mirroring the
/// line breaker's own wrap-codec decisions rather than approximating them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct IntrinsicWidths {
    pub min_content_width: f64,
    pub max_content_width: f64,
}

const NO_SOURCE_RUN: u32 = u32::MAX;
/// Cluster count per chunk summary (D-245).
pub(crate) const LAYOUT_CHUNK: usize = 64;

/// One cumulative word-wrap opportunity in the sparse-prose sidecar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WordBreakRecord {
    pub cluster_end: u32,
    pub advance_units: i32,
    pub space_units: i32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum WordSidecarMode {
    #[default]
    Unbuilt,
    Short,
    Sparse,
    Dense,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlacementCluster {
    pub segment_anchor: u32,
    pub numeric_block_ordinal: u32,
    pub block_local_prefix: f64,
    pub block_anchor_inline: f64,
    pub block_anchor_block: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RunCanonicalRevision(NonZeroU32);

impl RunCanonicalRevision {
    pub(crate) const fn get(self) -> u32 {
        self.0.get()
    }

    pub(crate) fn allocate(next: &mut u32) -> Result<Self, EngineError> {
        let value = (*next).max(1);
        let revision = NonZeroU32::new(value).ok_or(EngineError::RevisionExhausted)?;
        *next = value.checked_add(1).ok_or(EngineError::RevisionExhausted)?;
        Ok(Self(revision))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BoundaryRunRole {
    BoundarySource,
    Ellipsis,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LayoutRunSourceKind {
    Paragraph,
    Boundary {
        flow_thread_id: u32,
        role: BoundaryRunRole,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LayoutRun {
    pub source_kind: LayoutRunSourceKind,
    pub cluster_start: u32,
    pub cluster_end: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
    pub source_run: u32,
    pub font_handle: u32,
    pub numeric_blocks: NumericBlockSpan,
    /// Exact retained local-content token. `None` exists only while a pending cluster arena is
    /// being built; every committed run has a revision assigned by the shared finalizer.
    pub canonical_revision: Option<RunCanonicalRevision>,
    /// Planner-scoped physical identity. It is assigned only after the complete desired run set
    /// has reconciled and is promoted with this staged cluster arena.
    pub run_handle: Option<RunHandle>,
}

#[derive(Clone, Copy)]
pub(crate) struct RunCanonicalInput<'a> {
    pub text: &'a [u16],
    pub text_unit_ids: &'a [u32],
    pub style_arena: &'a StyleArena,
    pub styles: &'a [StyleSegment],
    pub shaping_runs: &'a [ShapingRun],
}

#[derive(Default)]
pub(super) struct LayoutRunArena {
    runs: Vec<LayoutRun>,
}

impl LayoutRunArena {
    fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.runs, capacity)
    }

    fn clear(&mut self) {
        self.runs.clear();
    }

    fn push(&mut self, run: LayoutRun) -> Result<(), EngineError> {
        self.runs
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.runs.push(run);
        Ok(())
    }
}

fn summarize_unit_chunks(
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
            flags_or |= *flag;
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
fn sum_advance_units(advances: &[i64]) -> i64 {
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

#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    // LAYOUT_CHUNK bounds this sum to 64 layout-unit values, each bounded to ±2^53.
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
    /// advance, OR-folded flags, and a tagged space-sum or negative-prefix auxiliary per chunk.
    pub chunk_advance_sums: Vec<i64>,
    pub chunk_auxiliary_sums: Vec<i64>,
    pub chunk_flags_or: Vec<u8>,
    pub word_breaks: Vec<WordBreakRecord>,
    pub(crate) word_sidecar_mode: WordSidecarMode,
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
    pub(super) layout_runs: LayoutRunArena,
    pub(super) run_local: RunLocalArena,
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
        reserve(&mut self.unsafe_before, capacity)?;
        Ok(())
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
        self.rebuild_layout_runs()?;
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
        self.rebuild_layout_runs()?;
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
        Ok(())
    }

    /// Derives the word-root sidecar used by wrapping and stable placement segments.
    /// Width-only reflow reuses the selected representation without another scan.
    pub(crate) fn ensure_word_breaks(&mut self) -> Result<(), EngineError> {
        if self.word_sidecar_mode != WordSidecarMode::Unbuilt {
            return Ok(());
        }
        self.word_breaks.clear();
        // Below one chunk, scalar composition is cheaper than allocating a sidecar.
        if self.flags.len() < LAYOUT_CHUNK {
            self.word_sidecar_mode = WordSidecarMode::Short;
            return Ok(());
        }
        let mut opportunity_count = 0usize;
        for &flags in &self.flags {
            opportunity_count += usize::from(
                flags & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0,
            );
        }
        // Dense break streams stay on chunk/scalar composition; sparse records would rival the
        // source lanes, while negative-prefix summaries preserve first-overflow semantics.
        if opportunity_count.saturating_mul(2) >= self.flags.len() {
            self.word_sidecar_mode = WordSidecarMode::Dense;
            return Ok(());
        }
        reserve(&mut self.word_breaks, opportunity_count.saturating_add(1))?;
        let mut advance_units = 0_i64;
        let mut space_units = 0_i64;
        for (index, (&advance, &flags)) in self.advance_units.iter().zip(&self.flags).enumerate() {
            advance_units = advance_units.saturating_add(advance);
            if flags & CLUSTER_SPACE != 0 {
                space_units = space_units.saturating_add(advance);
            }
            if flags & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0 {
                let Ok(segment_advance) = i32::try_from(advance_units) else {
                    self.word_breaks.clear();
                    self.word_sidecar_mode = WordSidecarMode::Overflow;
                    return Ok(());
                };
                let Ok(segment_space) = i32::try_from(space_units) else {
                    self.word_breaks.clear();
                    self.word_sidecar_mode = WordSidecarMode::Overflow;
                    return Ok(());
                };
                self.word_breaks.push(WordBreakRecord {
                    cluster_end: u32::try_from(index + 1)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    advance_units: segment_advance,
                    space_units: segment_space,
                });
                advance_units = 0;
                space_units = 0;
            }
        }
        let count = self.advance_units.len();
        if count > 0
            && self
                .word_breaks
                .last()
                .is_none_or(|record| record.cluster_end as usize != count)
        {
            let Ok(segment_advance) = i32::try_from(advance_units) else {
                self.word_breaks.clear();
                self.word_sidecar_mode = WordSidecarMode::Overflow;
                return Ok(());
            };
            let Ok(segment_space) = i32::try_from(space_units) else {
                self.word_breaks.clear();
                self.word_sidecar_mode = WordSidecarMode::Overflow;
                return Ok(());
            };
            self.word_breaks.push(WordBreakRecord {
                cluster_end: u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?,
                advance_units: segment_advance,
                space_units: segment_space,
            });
        }
        self.word_sidecar_mode = WordSidecarMode::Sparse;
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
        self.layout_runs.reserve(source.layout_runs.runs.len())?;
        self.layout_runs
            .runs
            .extend_from_slice(&source.layout_runs.runs);
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

    /// Assigns compact canonical tokens after every cluster-producing path has completed.
    ///
    /// The token is not a digest. A preceding token is retained only after comparing the
    /// normalized, unbounded run contents exactly; otherwise a fresh nonzero revision is minted.
    /// Absolute text/glyph offsets and temporary shaping-run ordinals are traversal cursors,
    /// never equality inputs.
    pub(crate) fn finalize_layout_run_revisions(
        &mut self,
        previous: &Self,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        index
            .prepare(previous.layout_runs.runs.len())
            .map_err(identity_index_error)?;
        for (run_index, run) in previous.layout_runs.runs.iter().copied().enumerate() {
            let anchor = previous.run_anchor(run)?;
            index
                .insert(
                    anchor,
                    u32::try_from(run_index).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }

        for run_index in 0..self.layout_runs.runs.len() {
            let run = self.layout_runs.runs[run_index];
            let anchor = self.run_anchor(run)?;
            let previous_run = index
                .get(anchor)
                .and_then(|previous_index| usize::try_from(previous_index).ok())
                .and_then(|previous_index| previous.layout_runs.runs.get(previous_index).copied());
            let retained = previous_run
                .map(|candidate| {
                    runs_canonically_equal(self, run, current, previous, candidate, committed)
                })
                .transpose()?
                .filter(|equal| *equal)
                .and_then(|_| previous_run.and_then(|candidate| candidate.canonical_revision));
            let revision = match retained {
                Some(revision) => revision,
                None => RunCanonicalRevision::allocate(next_revision)?,
            };
            debug_assert_ne!(revision.get(), 0);
            self.layout_runs.runs[run_index].canonical_revision = Some(revision);
        }

        Ok(())
    }

    fn run_anchor(&self, run: LayoutRun) -> Result<u32, EngineError> {
        let cluster =
            usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
        self.stable_ids
            .get(cluster)
            .copied()
            .filter(|anchor| *anchor != 0)
            .ok_or(EngineError::InvalidRequest)
    }

    pub(crate) fn clear(&mut self) {
        self.starts.clear();
        self.ends.clear();
        self.advances.clear();
        self.advance_units.clear();
        self.chunk_advance_sums.clear();
        self.chunk_auxiliary_sums.clear();
        self.chunk_flags_or.clear();
        self.word_breaks.clear();
        self.word_sidecar_mode = WordSidecarMode::Unbuilt;
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
        self.layout_runs.clear();
        self.run_local.clear();
    }

    pub(crate) fn layout_runs(&self) -> &[LayoutRun] {
        &self.layout_runs.runs
    }

    pub(crate) fn run_local(&self) -> &RunLocalArena {
        &self.run_local
    }

    pub(crate) fn placement_cluster(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
    ) -> Result<PlacementCluster, EngineError> {
        self.placement_cluster_at(run, direction, cluster, None)
    }

    pub(crate) fn placement_segment_monotone(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
        word_break_cursor: &mut usize,
    ) -> Result<(PlacementCluster, usize), EngineError> {
        let placement =
            self.placement_cluster_at(run, direction, cluster, Some(word_break_cursor))?;
        if direction & 1 != 0 || self.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
            return Ok((placement, cluster + 1));
        }
        let run_end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let word_end = match self.word_sidecar_mode {
            WordSidecarMode::Dense => run_end,
            WordSidecarMode::Sparse => self
                .word_breaks
                .get(*word_break_cursor)
                .and_then(|record| usize::try_from(record.cluster_end).ok())
                .ok_or(EngineError::InvalidRequest)?
                .min(run_end),
            WordSidecarMode::Short | WordSidecarMode::Overflow => {
                let mut end = cluster + 1;
                while end < run_end
                    && self.flags[end - 1]
                        & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK)
                        == 0
                {
                    end += 1;
                }
                end
            }
            WordSidecarMode::Unbuilt => return Err(EngineError::InvalidRequest),
        };
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
        while block_end < word_end
            && self
                .run_local
                .cluster_blocks()
                .get(block_lane_start + (block_end - run_start))
                == Some(&block)
        {
            block_end += 1;
        }
        Ok((placement, block_end))
    }

    fn placement_cluster_at(
        &self,
        run: LayoutRun,
        direction: u8,
        cluster: usize,
        word_break_cursor: Option<&mut usize>,
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
        let segment_root = match self.word_sidecar_mode {
            WordSidecarMode::Dense => run_start,
            WordSidecarMode::Sparse => {
                let record = match word_break_cursor {
                    Some(cursor) => {
                        if *cursor > self.word_breaks.len() {
                            *cursor = self
                                .word_breaks
                                .partition_point(|record| record.cluster_end as usize <= cluster);
                        } else {
                            while self
                                .word_breaks
                                .get(*cursor)
                                .is_some_and(|record| record.cluster_end as usize <= cluster)
                            {
                                *cursor += 1;
                            }
                        }
                        *cursor
                    }
                    None => self
                        .word_breaks
                        .partition_point(|record| record.cluster_end as usize <= cluster),
                };
                let root = if record == 0 {
                    0
                } else {
                    self.word_breaks[record - 1].cluster_end as usize
                };
                root.max(run_start)
            }
            WordSidecarMode::Short | WordSidecarMode::Overflow => {
                let mut root = cluster;
                while root > 0
                    && self.flags[root - 1]
                        & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK)
                        == 0
                {
                    root -= 1;
                }
                root
            }
            WordSidecarMode::Unbuilt => return Err(EngineError::InvalidRequest),
        };
        Ok(PlacementCluster {
            segment_anchor: if self.word_sidecar_mode == WordSidecarMode::Dense {
                self.stable_ids[run_start]
            } else {
                *self
                    .stable_ids
                    .get(segment_root)
                    .ok_or(EngineError::InvalidRequest)?
            },
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

    pub(crate) fn rebuild_run_local_geometry(
        &mut self,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        for run in &mut self.layout_runs.runs {
            run.numeric_blocks = NumericBlockSpan::default();
        }
        let mut run_local = core::mem::take(&mut self.run_local);
        run_local.clear();
        let result = (|| {
            for run_index in 0..self.layout_runs.runs.len() {
                let run = self.layout_runs.runs[run_index];
                let direction = usize::try_from(run.source_run)
                    .ok()
                    .and_then(|source| runs.get(source))
                    .map(|run| run.direction)
                    .or_else(|| (run.glyph_count == 0).then_some(0))
                    .ok_or(EngineError::InvalidRequest)?;
                let start =
                    usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
                let end =
                    usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
                let mut writer = run_local.begin_run();
                if direction & 1 == 0 {
                    for cluster in start..end {
                        append_run_local_cluster(&mut writer, self, styles, cluster, extents_for)?;
                    }
                } else {
                    for cluster in (start..end).rev() {
                        append_run_local_cluster(&mut writer, self, styles, cluster, extents_for)?;
                    }
                }
                self.layout_runs.runs[run_index].numeric_blocks =
                    writer.finish().map_err(run_local_error)?;
            }
            Ok(())
        })();
        if result.is_err() {
            run_local.clear();
            for run in &mut self.layout_runs.runs {
                run.numeric_blocks = NumericBlockSpan::default();
            }
        }
        self.run_local = run_local;
        result
    }

    pub(crate) fn bind_layout_run_handle(
        &mut self,
        run_index: usize,
        canonical_revision: RunCanonicalRevision,
        handle: RunHandle,
    ) -> Result<(), EngineError> {
        let run = self
            .layout_runs
            .runs
            .get_mut(run_index)
            .ok_or(EngineError::InvalidRequest)?;
        if run.canonical_revision != Some(canonical_revision) {
            return Err(EngineError::InvalidRequest);
        }
        run.run_handle = Some(handle);
        Ok(())
    }

    pub(super) fn rebuild_layout_runs(&mut self) -> Result<(), EngineError> {
        self.layout_runs.clear();
        let mut cluster_start = 0usize;
        while cluster_start < self.starts.len() {
            let source_run = self.source_runs[cluster_start];
            let font_handle = self.font_handles[cluster_start];
            let mut cluster_end = cluster_start + 1;
            while cluster_end < self.starts.len()
                && self.source_runs[cluster_end] == source_run
                && self.font_handles[cluster_end] == font_handle
            {
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
                run_handle: None,
            })?;
            cluster_start = cluster_end;
        }
        Ok(())
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

fn append_run_local_cluster(
    writer: &mut super::run_local::RunLocalWriter<'_>,
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    cluster: usize,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
        return writer.push_detached_cluster().map_err(run_local_error);
    }
    let style = styles
        .get(
            usize::try_from(clusters.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?
        .style;
    let units_per_em = clusters.units_per_em[cluster];
    if units_per_em == 0.0 {
        return Err(EngineError::InvalidRequest);
    }
    let font_handle = clusters.font_handles[cluster];
    let scale = f64::from(style.font_size) / units_per_em;
    let start =
        usize::try_from(clusters.glyph_starts[cluster]).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(
            usize::try_from(clusters.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?;
    writer.begin_cluster().map_err(run_local_error)?;
    for glyph in start..end {
        let glyph_id = u32::from(clusters.glyph_ids[glyph]);
        writer
            .push_glyph(RunLocalGlyphInput {
                source_glyph: u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
                x_advance: clusters.glyph_x_advances[glyph],
                x_offset: clusters.glyph_x_offsets[glyph],
                y_offset: clusters.glyph_y_offsets[glyph],
                baseline_shift: style.baseline_shift,
                scale,
                outline: extents_for(font_handle, glyph_id),
            })
            .map_err(run_local_error)?;
    }
    writer
        .finish_cluster(ClusterFinish::Resync(clusters.advances[cluster]))
        .map_err(run_local_error)
}

fn run_local_error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
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

fn runs_canonically_equal(
    current_clusters: &ClusterArena,
    current_run: LayoutRun,
    current: RunCanonicalInput<'_>,
    previous_clusters: &ClusterArena,
    previous_run: LayoutRun,
    previous: RunCanonicalInput<'_>,
) -> Result<bool, EngineError> {
    let current_clusters_range = run_cluster_range(current_clusters, current_run)?;
    let previous_clusters_range = run_cluster_range(previous_clusters, previous_run)?;
    if current_clusters_range.len() != previous_clusters_range.len()
        || current_run.glyph_count != previous_run.glyph_count
        || current_run.font_handle != previous_run.font_handle
        || !run_text_equal(
            current_clusters,
            current_clusters_range.clone(),
            current,
            previous_clusters,
            previous_clusters_range.clone(),
            previous,
        )?
        || !shaping_identity_equal(current_run, current, previous_run, previous)?
    {
        return Ok(false);
    }

    for (current_cluster, previous_cluster) in current_clusters_range.zip(previous_clusters_range) {
        let current_style = cluster_style(current_clusters, current_cluster, current.styles)?;
        let previous_style = cluster_style(previous_clusters, previous_cluster, previous.styles)?;
        if lane(&current_clusters.stable_ids, current_cluster)?
            != lane(&previous_clusters.stable_ids, previous_cluster)?
            || cluster_text_len(current_clusters, current_cluster)?
                != cluster_text_len(previous_clusters, previous_cluster)?
            || lane(&current_clusters.advances, current_cluster)?.to_bits()
                != lane(&previous_clusters.advances, previous_cluster)?.to_bits()
            || lane(&current_clusters.advance_units, current_cluster)?
                != lane(&previous_clusters.advance_units, previous_cluster)?
            || lane(&current_clusters.units_per_em, current_cluster)?.to_bits()
                != lane(&previous_clusters.units_per_em, previous_cluster)?.to_bits()
            || lane(&current_clusters.flags, current_cluster)?
                != lane(&previous_clusters.flags, previous_cluster)?
            || lane(&current_clusters.font_handles, current_cluster)?
                != lane(&previous_clusters.font_handles, previous_cluster)?
            || lane(&current_clusters.glyph_counts, current_cluster)?
                != lane(&previous_clusters.glyph_counts, previous_cluster)?
            || lane(&current_clusters.shaped, current_cluster)?
                != lane(&previous_clusters.shaped, previous_cluster)?
            || lane(&current_clusters.unsafe_before, current_cluster)?
                != lane(&previous_clusters.unsafe_before, previous_cluster)?
            || !geometric_style_equal(
                current_style,
                current.style_arena,
                previous_style,
                previous.style_arena,
            )
            || !cluster_glyphs_equal(
                current_clusters,
                current_cluster,
                previous_clusters,
                previous_cluster,
            )?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn run_cluster_range(
    clusters: &ClusterArena,
    run: LayoutRun,
) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    if start >= end || end > clusters.starts.len() {
        return Err(EngineError::InvalidRequest);
    }
    let first_glyph = lane(&clusters.glyph_starts, start)?;
    let last = end - 1;
    let glyph_end = lane(&clusters.glyph_starts, last)?
        .checked_add(lane(&clusters.glyph_counts, last)?)
        .ok_or(EngineError::InvalidRequest)?;
    if first_glyph != run.glyph_start
        || glyph_end
            .checked_sub(run.glyph_start)
            .filter(|count| *count == run.glyph_count)
            .is_none()
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start..end)
}

fn run_text_equal(
    current_clusters: &ClusterArena,
    current_range: core::ops::Range<usize>,
    current: RunCanonicalInput<'_>,
    previous_clusters: &ClusterArena,
    previous_range: core::ops::Range<usize>,
    previous: RunCanonicalInput<'_>,
) -> Result<bool, EngineError> {
    if current.text.len() != current.text_unit_ids.len()
        || previous.text.len() != previous.text_unit_ids.len()
    {
        return Err(EngineError::InvalidRequest);
    }
    let current_text = run_text_range(current_clusters, current_range)?;
    let previous_text = run_text_range(previous_clusters, previous_range)?;
    let current_units = current
        .text
        .get(current_text.clone())
        .ok_or(EngineError::InvalidRequest)?;
    let previous_units = previous
        .text
        .get(previous_text.clone())
        .ok_or(EngineError::InvalidRequest)?;
    let current_ids = current
        .text_unit_ids
        .get(current_text)
        .ok_or(EngineError::InvalidRequest)?;
    let previous_ids = previous
        .text_unit_ids
        .get(previous_text)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(current_units == previous_units && current_ids == previous_ids)
}

fn run_text_range(
    clusters: &ClusterArena,
    range: core::ops::Range<usize>,
) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(
        *clusters
            .starts
            .get(range.start)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(
        *clusters
            .ends
            .get(range.end - 1)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    if start >= end {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start..end)
}

fn cluster_text_len(clusters: &ClusterArena, cluster: usize) -> Result<u32, EngineError> {
    clusters
        .ends
        .get(cluster)
        .copied()
        .and_then(|end| end.checked_sub(*clusters.starts.get(cluster)?))
        .filter(|length| *length != 0)
        .ok_or(EngineError::InvalidRequest)
}

fn cluster_style(
    clusters: &ClusterArena,
    cluster: usize,
    styles: &[StyleSegment],
) -> Result<super::style_state::ResolvedStyle, EngineError> {
    let index = usize::try_from(
        *clusters
            .style_indexes
            .get(cluster)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    styles
        .get(index)
        .map(|segment| segment.style)
        .ok_or(EngineError::InvalidRequest)
}

fn geometric_style_equal(
    current: super::style_state::ResolvedStyle,
    current_arena: &StyleArena,
    previous: super::style_state::ResolvedStyle,
    previous_arena: &StyleArena,
) -> bool {
    current.font_stack_handle == previous.font_stack_handle
        && current.font_size.to_bits() == previous.font_size.to_bits()
        && current.letter_spacing.to_bits() == previous.letter_spacing.to_bits()
        && current.word_spacing.to_bits() == previous.word_spacing.to_bits()
        && current.baseline_shift.to_bits() == previous.baseline_shift.to_bits()
        && current.direction == previous.direction
        && current.bidi_override == previous.bidi_override
        && current_arena.resolved_language(current) == previous_arena.resolved_language(previous)
        && current_arena.resolved_features(current) == previous_arena.resolved_features(previous)
}

fn shaping_identity_equal(
    current_run: LayoutRun,
    current: RunCanonicalInput<'_>,
    previous_run: LayoutRun,
    previous: RunCanonicalInput<'_>,
) -> Result<bool, EngineError> {
    match (current_run.source_run, previous_run.source_run) {
        (NO_SOURCE_RUN, NO_SOURCE_RUN) => Ok(true),
        (NO_SOURCE_RUN, _) | (_, NO_SOURCE_RUN) => Ok(false),
        (current_index, previous_index) => {
            let current_run = current
                .shaping_runs
                .get(usize::try_from(current_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            let previous_run = previous
                .shaping_runs
                .get(usize::try_from(previous_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            Ok(current_run.script == previous_run.script
                && current_run.direction == previous_run.direction
                && current_run.bidi_level == previous_run.bidi_level)
        }
    }
}

fn cluster_glyphs_equal(
    current: &ClusterArena,
    current_cluster: usize,
    previous: &ClusterArena,
    previous_cluster: usize,
) -> Result<bool, EngineError> {
    let current_range = cluster_glyph_range(current, current_cluster)?;
    let previous_range = cluster_glyph_range(previous, previous_cluster)?;
    Ok(glyph_slice(&current.glyph_ids, current_range.clone())?
        == glyph_slice(&previous.glyph_ids, previous_range.clone())?
        && glyph_slice(&current.glyph_x_advances, current_range.clone())?
            == glyph_slice(&previous.glyph_x_advances, previous_range.clone())?
        && glyph_slice(&current.glyph_x_offsets, current_range.clone())?
            == glyph_slice(&previous.glyph_x_offsets, previous_range.clone())?
        && glyph_slice(&current.glyph_y_offsets, current_range.clone())?
            == glyph_slice(&previous.glyph_y_offsets, previous_range.clone())?
        && glyph_slice(&current.glyph_shape_flags, current_range.clone())?
            == glyph_slice(&previous.glyph_shape_flags, previous_range.clone())?
        && glyph_slice(&current.glyph_stable_ids, current_range)?
            == glyph_slice(&previous.glyph_stable_ids, previous_range)?)
}

fn cluster_glyph_range(
    clusters: &ClusterArena,
    cluster: usize,
) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(
        *clusters
            .glyph_starts
            .get(cluster)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let count = usize::try_from(
        *clusters
            .glyph_counts
            .get(cluster)
            .ok_or(EngineError::InvalidRequest)?,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(count)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(start..end)
}

fn lane<T: Copy>(values: &[T], index: usize) -> Result<T, EngineError> {
    values
        .get(index)
        .copied()
        .ok_or(EngineError::InvalidRequest)
}

fn glyph_slice<T>(values: &[T], range: core::ops::Range<usize>) -> Result<&[T], EngineError> {
    values.get(range).ok_or(EngineError::InvalidRequest)
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

    struct CanonicalFixture {
        arena: ClusterArena,
        text: Vec<u16>,
        text_unit_ids: Vec<u32>,
        style_arena: StyleArena,
        styles: Vec<StyleSegment>,
        shaping_runs: Vec<ShapingRun>,
    }

    fn canonical_fixture(
        text: &[u16],
        text_unit_ids: &[u32],
        source_runs: &[u32],
        style: ResolvedStyle,
    ) -> CanonicalFixture {
        assert_eq!(text.len(), text_unit_ids.len());
        assert_eq!(text.len(), source_runs.len());
        let mut arena = ClusterArena::default();
        for (index, ((&unit, &stable_id), &source_run)) in
            text.iter().zip(text_unit_ids).zip(source_runs).enumerate()
        {
            let start = u32::try_from(index).unwrap();
            arena.starts.push(start);
            arena.ends.push(start + 1);
            arena.advances.push(1.0);
            arena.advance_units.push(65_536);
            arena.units_per_em.push(1_000.0);
            arena.flags.push(CLUSTER_SAFE_BEFORE);
            arena.style_indexes.push(0);
            arena.source_runs.push(source_run);
            arena.binding_handles.push(source_run + 100);
            arena.font_handles.push(7);
            arena.stable_ids.push(stable_id);
            arena.glyph_starts.push(start);
            arena.glyph_counts.push(1);
            arena.glyph_ids.push(unit);
            arena.glyph_clusters.push(start);
            arena.glyph_x_advances.push(1_000);
            arena.glyph_x_offsets.push(0);
            arena.glyph_y_offsets.push(0);
            arena.glyph_shape_flags.push(0);
            arena.glyph_stable_ids.push(stable_id);
            arena.shaped.push(1);
            arena.unsafe_before.push(0);
        }
        arena.rebuild_layout_runs().unwrap();
        let shaping_run_count = source_runs
            .iter()
            .copied()
            .max()
            .map_or(0, |maximum| usize::try_from(maximum).unwrap() + 1);
        let text_end = u32::try_from(text.len()).unwrap();
        let shaping_runs = (0..shaping_run_count)
            .map(|_| ShapingRun {
                text_start: 0,
                text_end,
                script: 0x4c61_746e,
                direction: 0,
                bidi_level: 0,
                style,
            })
            .collect();
        CanonicalFixture {
            arena,
            text: text.to_vec(),
            text_unit_ids: text_unit_ids.to_vec(),
            style_arena: StyleArena::default(),
            styles: vec![StyleSegment {
                text_start: 0,
                text_end,
                style,
            }],
            shaping_runs,
        }
    }

    fn stamp_revisions(fixture: &mut CanonicalFixture, revisions: &[u32]) {
        assert_eq!(fixture.arena.layout_runs.runs.len(), revisions.len());
        for (run, &revision) in fixture.arena.layout_runs.runs.iter_mut().zip(revisions) {
            run.canonical_revision = Some(RunCanonicalRevision(
                NonZeroU32::new(revision).expect("test revision is nonzero"),
            ));
        }
    }

    fn finalize_fixture(
        current: &mut CanonicalFixture,
        previous: &CanonicalFixture,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
    ) {
        let current_input = RunCanonicalInput {
            text: &current.text,
            text_unit_ids: &current.text_unit_ids,
            style_arena: &current.style_arena,
            styles: &current.styles,
            shaping_runs: &current.shaping_runs,
        };
        let previous_input = RunCanonicalInput {
            text: &previous.text,
            text_unit_ids: &previous.text_unit_ids,
            style_arena: &previous.style_arena,
            styles: &previous.styles,
            shaping_runs: &previous.shaping_runs,
        };
        current
            .arena
            .finalize_layout_run_revisions(
                &previous.arena,
                current_input,
                previous_input,
                index,
                next_revision,
            )
            .unwrap();
    }

    fn revisions(fixture: &CanonicalFixture) -> Vec<u32> {
        fixture
            .arena
            .layout_runs()
            .iter()
            .map(|run| run.canonical_revision.unwrap().get())
            .collect()
    }

    fn shadow_topology(
        source_runs: &[u32],
        font_handles: &[u32],
        glyph_counts: &[u32],
    ) -> ClusterArena {
        assert_eq!(source_runs.len(), font_handles.len());
        assert_eq!(source_runs.len(), glyph_counts.len());
        let mut arena = ClusterArena::default();
        let mut glyph_start = 0_u32;
        for index in 0..source_runs.len() {
            arena.starts.push(u32::try_from(index).unwrap());
            arena.ends.push(u32::try_from(index + 1).unwrap());
            arena.advances.push(0.0);
            arena.source_runs.push(source_runs[index]);
            arena.font_handles.push(font_handles[index]);
            arena.glyph_starts.push(glyph_start);
            arena.glyph_counts.push(glyph_counts[index]);
            glyph_start = glyph_start.checked_add(glyph_counts[index]).unwrap();
        }
        arena.rebuild_layout_runs().unwrap();
        arena
    }

    fn assert_shadow_topology(arena: &ClusterArena) {
        let cluster_count = arena.starts.len();
        let mut cluster_to_run = vec![usize::MAX; cluster_count];
        let mut previous_cluster_end = 0usize;
        for (run_index, run) in arena.layout_runs().iter().enumerate() {
            let cluster_start = usize::try_from(run.cluster_start).unwrap();
            let cluster_end = usize::try_from(run.cluster_end).unwrap();
            assert_eq!(cluster_start, previous_cluster_end, "gapless clusters");
            assert!(cluster_start < cluster_end, "nonempty run");
            assert!(cluster_end <= cluster_count, "bounded run");
            let expected_glyph_start = arena.glyph_starts[cluster_start];
            let expected_glyph_end = arena.glyph_starts[cluster_end - 1]
                .checked_add(arena.glyph_counts[cluster_end - 1])
                .unwrap();
            assert_eq!(run.glyph_start, expected_glyph_start);
            assert_eq!(run.glyph_count, expected_glyph_end - expected_glyph_start);
            for slot in &mut cluster_to_run[cluster_start..cluster_end] {
                assert_eq!(*slot, usize::MAX, "clusters have one owner");
                *slot = run_index;
            }
            for cluster in cluster_start..cluster_end {
                assert_eq!(arena.source_runs[cluster], run.source_run);
                assert_eq!(arena.font_handles[cluster], run.font_handle);
            }
            previous_cluster_end = cluster_end;
        }
        assert_eq!(previous_cluster_end, cluster_count, "all clusters covered");
        for cluster in 1..cluster_count {
            let same_identity = arena.source_runs[cluster - 1] == arena.source_runs[cluster]
                && arena.font_handles[cluster - 1] == arena.font_handles[cluster];
            assert_eq!(
                cluster_to_run[cluster - 1] == cluster_to_run[cluster],
                same_identity
            );
        }
    }

    #[test]
    fn layout_runs_are_gapless_maximal_and_glyph_contiguous() {
        let source_runs = [0, 0, 0, 0, 1, 1, 1, 1];
        let font_handles = [10, 10, 20, 20, 20, 20, 10, 10];
        let arena = shadow_topology(&source_runs, &font_handles, &[1, 2, 0, 1, 3, 0, 2, 1]);

        assert_eq!(
            arena.layout_runs(),
            [
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 0,
                    cluster_end: 2,
                    glyph_start: 0,
                    glyph_count: 3,
                    source_run: 0,
                    font_handle: 10,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                    run_handle: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 2,
                    cluster_end: 4,
                    glyph_start: 3,
                    glyph_count: 1,
                    source_run: 0,
                    font_handle: 20,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                    run_handle: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 4,
                    cluster_end: 6,
                    glyph_start: 4,
                    glyph_count: 3,
                    source_run: 1,
                    font_handle: 20,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                    run_handle: None,
                },
                LayoutRun {
                    source_kind: LayoutRunSourceKind::Paragraph,
                    cluster_start: 6,
                    cluster_end: 8,
                    glyph_start: 7,
                    glyph_count: 3,
                    source_run: 1,
                    font_handle: 10,
                    numeric_blocks: NumericBlockSpan::default(),
                    canonical_revision: None,
                    run_handle: None,
                },
            ]
        );
        assert_shadow_topology(&arena);
    }

    #[test]
    fn paragraph_run_owns_direction_canonical_numeric_rows() {
        let style = ResolvedStyle::test_typography(10.0, 0.0, 0.0);
        let mut fixture = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        fixture.shaping_runs[0].direction = 1;
        fixture.shaping_runs[0].bidi_level = 1;

        fixture
            .arena
            .rebuild_run_local_geometry(&fixture.shaping_runs, &fixture.styles, |_, _| {
                Some(FontGlyphExtents {
                    x_min: 0,
                    y_min: 0,
                    x_max: 500,
                    y_max: 700,
                })
            })
            .unwrap();

        assert_eq!(fixture.arena.layout_runs()[0].numeric_blocks.count, 1);
        assert_eq!(
            fixture.arena.layout_runs()[0].numeric_blocks.cluster_count,
            2
        );
        let blocks = fixture.arena.run_local().blocks();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].source_glyph_start, 0);
        assert_eq!(blocks[0].source_glyph_count, 2);
        let rows = fixture.arena.run_local().rows();
        assert_eq!(rows.len(), 2);
        assert_eq!([rows[0].source_glyph, rows[1].source_glyph], [1, 0]);
        assert_eq!([rows[0].pen_inline, rows[1].pen_inline], [0.0, 1.0]);
        assert_eq!(fixture.arena.run_local().cluster_blocks(), [0, 0]);
        assert_eq!(fixture.arena.run_local().cluster_prefixes(), [0.0, 1.0]);
    }

    #[test]
    fn canonical_revision_reconciles_insertion_before_by_stable_anchor() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut previous =
            canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        stamp_revisions(&mut previous, &[1]);
        let mut current = canonical_fixture(
            &[b'x' as u16, b'a' as u16, b'b' as u16],
            &[9, 10, 11],
            &[1, 0, 0],
            style,
        );
        let mut index = IdentityIndex::default();
        let mut next_revision = 2;

        finalize_fixture(&mut current, &previous, &mut index, &mut next_revision);

        assert_eq!(revisions(&current), [2, 1]);
        assert_eq!(next_revision, 3);
    }

    #[test]
    fn canonical_revision_invalidates_split_and_merge_topology() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut merged = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        stamp_revisions(&mut merged, &[1]);
        let mut split = canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 1], style);
        let mut index = IdentityIndex::default();
        let mut next_revision = 2;

        finalize_fixture(&mut split, &merged, &mut index, &mut next_revision);
        assert_eq!(revisions(&split), [2, 3]);

        let mut remerged =
            canonical_fixture(&[b'a' as u16, b'b' as u16], &[10, 11], &[0, 0], style);
        finalize_fixture(&mut remerged, &split, &mut index, &mut next_revision);
        assert_eq!(revisions(&remerged), [4]);
        assert_eq!(next_revision, 5);
    }

    #[test]
    fn canonical_revision_tracks_metrics_but_ignores_paint_and_binding() {
        let style = ResolvedStyle::test_typography(16.0, 0.0, 0.0);
        let mut previous = canonical_fixture(&[b'a' as u16], &[10], &[0], style);
        stamp_revisions(&mut previous, &[1]);
        let mut index = IdentityIndex::default();

        let mut paint = style;
        paint.material_id = 91;
        paint.foreground_rgba = 0x1234_5678;
        paint.opacity = 0.25;
        paint.line_height = 48.0;
        let mut paint_only = canonical_fixture(&[b'a' as u16], &[10], &[0], paint);
        paint_only.arena.binding_handles[0] = 999;
        let mut next_revision = 2;
        finalize_fixture(&mut paint_only, &previous, &mut index, &mut next_revision);
        assert_eq!(revisions(&paint_only), [1]);
        assert_eq!(next_revision, 2);

        let metrics = ResolvedStyle::test_typography(18.0, 0.0, 0.0);
        let mut metrics_changed = canonical_fixture(&[b'a' as u16], &[10], &[0], metrics);
        finalize_fixture(
            &mut metrics_changed,
            &previous,
            &mut index,
            &mut next_revision,
        );
        assert_eq!(revisions(&metrics_changed), [2]);
        assert_eq!(next_revision, 3);
    }

    #[test]
    fn canonical_revision_exhaustion_is_domain_specific_and_atomic() {
        let mut next_revision = u32::MAX;

        assert_eq!(
            RunCanonicalRevision::allocate(&mut next_revision),
            Err(EngineError::RevisionExhausted)
        );
        assert_eq!(next_revision, u32::MAX);
    }

    #[test]
    fn layout_run_property_matches_the_scalar_adjacency_oracle() {
        let mut state = 0x6d2b_79f5_u32;
        for length in 0..192usize {
            let mut source_runs = Vec::with_capacity(length);
            let mut font_handles = Vec::with_capacity(length);
            let mut glyph_counts = Vec::with_capacity(length);
            for _ in 0..length {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                source_runs.push((state >> 29) & 3);
                font_handles.push(((state >> 25) & 7) + 1);
                glyph_counts.push((state >> 21) & 3);
            }
            let arena = shadow_topology(&source_runs, &font_handles, &glyph_counts);
            assert_shadow_topology(&arena);
        }
    }

    #[test]
    fn dense_cjk_break_paint_and_raster_lanes_do_not_split_shadow_runs() {
        const COUNT: usize = 4_096;
        let mut arena = shadow_topology(&vec![7; COUNT], &vec![31; COUNT], &vec![1; COUNT]);
        arena.flags = (0..COUNT)
            .map(|index| CLUSTER_ALLOWED_BREAK | (u8::from(index % 2 == 0) * CLUSTER_SAFE_BEFORE))
            .collect();
        arena.style_indexes = (0..COUNT).map(|index| (index % 5) as u32).collect();
        arena.binding_handles = (0..COUNT).map(|index| (index % 3) as u32 + 1).collect();
        arena.advances = (0..COUNT)
            .map(|index| if index % 11 == 0 { -3.0 } else { 9.0 })
            .collect();
        arena.rebuild_layout_runs().unwrap();

        assert_eq!(arena.layout_runs().len(), 1);
        assert_eq!(arena.layout_runs()[0].cluster_end, COUNT as u32);
        assert_shadow_topology(&arena);
    }

    #[test]
    fn latin_font_fallback_and_bidi_direction_split_shadow_runs() {
        let arena = shadow_topology(
            &[0, 0, 1, 1, 1, 2, 2],
            &[5, 5, 5, 8, 8, 8, 8],
            &[1, 1, 2, 1, 1, 1, 1],
        );

        assert_eq!(
            arena
                .layout_runs()
                .iter()
                .map(|run| {
                    (
                        run.cluster_start,
                        run.cluster_end,
                        run.source_run,
                        run.font_handle,
                    )
                })
                .collect::<Vec<_>>(),
            [(0, 2, 0, 5), (2, 3, 1, 5), (3, 5, 1, 8), (5, 7, 2, 8)]
        );
        assert_shadow_topology(&arena);
    }

    #[test]
    fn justification_and_negative_advances_do_not_split_shadow_runs() {
        let mut arena = shadow_topology(&[3; 8], &[13; 8], &[1, 2, 1, 1, 0, 1, 1, 1]);
        arena.flags = vec![CLUSTER_SPACE | CLUSTER_ALLOWED_BREAK; 8];
        arena.advance_units = vec![-4, 8, 12, -2, 7, 9, -1, 6];
        arena.rebuild_layout_runs().unwrap();

        assert_eq!(arena.layout_runs().len(), 1);
        assert_eq!(arena.layout_runs()[0].glyph_count, 8);
        assert_shadow_topology(&arena);
    }

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
        assert_lane!(chunk_auxiliary_sums);
        assert_lane!(chunk_flags_or);
        assert_lane!(word_breaks);
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
    /// wrap-codec mirroring is pinned cluster by cluster without shaping.
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
    fn intrinsic_word_width_uses_the_complete_shaped_segment() {
        let mut clusters = intrinsic_fixture();
        clusters.advances[0] = 10.0;
        clusters.advances[1] = -4.0;
        let widths = clusters.intrinsic_widths(WRAP_WORD);
        assert_eq!(widths.min_content_width, 9.0);
        assert_eq!(widths.max_content_width, 27.0);
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
        assert_eq!(arena.chunk_auxiliary_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );

        arena.advances[LAYOUT_CHUNK] = 32_768.0;
        arena.refresh_layout_units().unwrap();
        assert_eq!(arena.chunk_advance_sums[0], 64 * 65_536);
        assert_eq!(arena.chunk_advance_sums[1], 2_147_483_648);
        assert_eq!(arena.chunk_auxiliary_sums, [65_536, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE, CLUSTER_ALLOWED_BREAK]
        );
    }

    #[test]
    fn negative_chunk_summary_packs_its_marker_and_tagged_auxiliary() {
        let mut advances = vec![0.0; LAYOUT_CHUNK * 3];
        let mut flags = vec![CLUSTER_ALLOWED_BREAK; advances.len()];
        advances[0] = 3.0;
        advances[1] = -2.0;
        advances[2] = -2.0;
        advances[LAYOUT_CHUNK] = -2.0;
        flags[LAYOUT_CHUNK] |= CLUSTER_SPACE;
        advances[LAYOUT_CHUNK * 2] = 1.0;
        let mut arena = ClusterArena {
            advances,
            flags,
            ..ClusterArena::default()
        };
        arena.refresh_layout_units().unwrap();

        assert_eq!(arena.chunk_advance_sums, [-65_536, -131_072, 65_536]);
        assert_eq!(arena.chunk_auxiliary_sums, [196_608, -131_072, 0]);
        assert_eq!(
            arena.chunk_flags_or,
            [
                CLUSTER_ALLOWED_BREAK | CHUNK_NEGATIVE_ADVANCE,
                CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE | CHUNK_NEGATIVE_ADVANCE,
                CLUSTER_ALLOWED_BREAK,
            ],
        );
    }

    #[test]
    fn word_break_stream_is_compact_and_only_materialized_for_sparse_breaks() {
        assert_eq!(core::mem::size_of::<WordBreakRecord>(), 12);

        let mut sparse = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK * 2],
            flags: vec![0; LAYOUT_CHUNK * 2],
            ..ClusterArena::default()
        };
        sparse.flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        sparse.flags[6] = CLUSTER_ALLOWED_BREAK;
        sparse.refresh_layout_units().unwrap();
        assert!(
            sparse.word_breaks.is_empty(),
            "layout-unit refresh does not eagerly build word indexes"
        );
        sparse.ensure_word_breaks().unwrap();
        assert_eq!(sparse.word_breaks.len(), 3);
        assert_eq!(sparse.word_breaks[0].cluster_end, 3);
        assert_eq!(sparse.word_breaks[0].advance_units, 3 * 65_536);
        assert_eq!(sparse.word_breaks[0].space_units, 65_536);
        assert_eq!(sparse.word_breaks[1].cluster_end, 7);
        assert_eq!(sparse.word_breaks[1].advance_units, 4 * 65_536);
        assert_eq!(sparse.word_breaks[2].cluster_end, (LAYOUT_CHUNK * 2) as u32);
        assert_eq!(
            sparse.word_breaks[2].advance_units,
            (LAYOUT_CHUNK * 2 - 7) as i32 * 65_536
        );

        let mut short = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK - 1],
            flags: vec![0; LAYOUT_CHUNK - 1],
            ..ClusterArena::default()
        };
        short.flags[2] = CLUSTER_ALLOWED_BREAK | CLUSTER_SPACE;
        short.refresh_layout_units().unwrap();
        short.ensure_word_breaks().unwrap();
        assert!(
            short.word_breaks.is_empty(),
            "sub-chunk labels stay on the allocation-free scalar compositor"
        );

        let mut dense = ClusterArena {
            advances: vec![1.0; LAYOUT_CHUNK * 2],
            flags: vec![CLUSTER_ALLOWED_BREAK; LAYOUT_CHUNK * 2],
            ..ClusterArena::default()
        };
        dense.advances[3] = -1.0;
        dense.refresh_layout_units().unwrap();
        dense.ensure_word_breaks().unwrap();
        assert!(dense.word_breaks.is_empty());
        assert_eq!(dense.word_breaks.capacity(), 0);
        assert_eq!(dense.word_sidecar_mode, WordSidecarMode::Dense);
        assert!(dense.chunk_flags_or[0] & CHUNK_NEGATIVE_ADVANCE != 0);
    }
}
