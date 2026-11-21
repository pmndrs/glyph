//! The dense cluster build: the passes behind `ClusterArena::build`.
//!
//! Every pass is an outer loop over what makes clusters differ -- style segments, shaped runs,
//! stretches of clusters one shaped run owns -- around an inner loop over lanes that makes no
//! decision per element. Inputs are checked once per run or per lane, so no inner loop returns.
//!
//! The lanes this writes equal what a per-glyph aggregation writes, in bits: a cluster's advance
//! still accumulates its glyphs in shaping order, one product at a time.

use crate::{FontInkTable, FontMetrics};

use super::{
    CLUSTER_HARD_BREAK, CLUSTER_SAFE_BEFORE, CLUSTER_SPACE, ClusterArena, EngineError, FrameFault,
    GLYPH_UNSAFE_TO_BREAK, NO_SOURCE_RUN, ShapeArena, ShapingRun, StyleSegment, reserve,
    scatter_is_identity,
};
use crate::engine::shaping_state::ShapedRun;

/// U+000A..U+000D, U+0085, U+2028 and U+2029 end a line where they stand.
#[inline]
pub(super) const fn is_hard_break_unit(unit: u16) -> bool {
    (unit.wrapping_sub(0x0a) < 4) | (unit == 0x85) | (unit.wrapping_sub(0x2028) < 2)
}

/// What one shaped run contributes to every cluster it owns.
#[derive(Clone, Copy)]
pub(in crate::engine) struct RunScale {
    /// Font size over the font's em.
    scale: f64,
    units_per_em: f64,
}

/// The clusters `[start, end)` whose text a shaped run covers.
fn covered_clusters(arena: &ClusterArena, run: ShapedRun) -> (usize, usize) {
    (
        arena.ends.partition_point(|end| *end <= run.text_start),
        arena.starts.partition_point(|start| *start < run.text_end),
    )
}

fn glyph_range(run: ShapedRun, stream_len: usize) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
        .filter(|end| *end <= stream_len)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(start..end)
}

impl ClusterArena {
    /// One row per grapheme cluster: text range, identity, style, and the flags and spacing its
    /// first unit decides. A style segment is resolved once for all the clusters inside it.
    pub(super) fn build_headers(
        &mut self,
        text: &[u16],
        text_unit_ids: &[u32],
        boundaries: &[u32],
        styles: &[StyleSegment],
    ) -> Result<(), EngineError> {
        let count = boundaries.len().saturating_sub(1);
        if count == 0 {
            return Ok(());
        }
        // Strictly increasing boundaries inside the text make every cluster non-empty and every
        // start a unit of the text, which is all the lanes below index by.
        let ordered = boundaries
            .windows(2)
            .fold(true, |ordered, pair| ordered & (pair[0] < pair[1]));
        if !ordered || boundaries[count] as usize > text.len() {
            return Err(EngineError::InvalidRequest);
        }
        self.starts.extend_from_slice(&boundaries[..count]);
        self.ends.extend_from_slice(&boundaries[1..]);
        self.stable_ids.extend(
            self.starts
                .iter()
                .map(|start| text_unit_ids[*start as usize]),
        );
        self.units_per_em.resize(count, 0.0);
        self.source_runs.resize(count, NO_SOURCE_RUN);
        self.binding_handles.resize(count, 0);
        self.font_handles.resize(count, 0);
        self.glyph_starts.resize(count, 0);
        self.glyph_counts.resize(count, 0);
        self.shaped.resize(count, 0);
        self.unsafe_before.resize(count, 0);

        let mut style_index = 0usize;
        let mut cluster = 0usize;
        while cluster < count {
            let start = self.starts[cluster];
            while styles
                .get(style_index)
                .is_some_and(|style| style.text_end <= start)
            {
                style_index += 1;
            }
            let segment = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            let inside = self.ends[cluster..].partition_point(|end| *end <= segment.text_end);
            // A resolved segment is the merge of every style covering the same run of text, so no
            // single style id owns the boundary that lands inside this cluster. The paragraph the
            // per-paragraph loop attaches is the whole attribution this cause carries.
            if segment.text_start > start || inside == 0 {
                return Err(EngineError::StyleSplitsCluster(FrameFault::default()));
            }
            let segment_end = cluster + inside;
            let style = segment.style;
            // The sums are taken in f32, as the style states them.
            let plain = f64::from(style.letter_spacing + 0.0);
            let spaced = f64::from(style.letter_spacing + style.word_spacing);
            self.style_indexes.resize(
                segment_end,
                u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?,
            );
            let first_units = self.starts[cluster..segment_end]
                .iter()
                .map(|start| text[*start as usize]);
            for unit in first_units {
                let hard_break = is_hard_break_unit(unit);
                let space = unit == 0x20;
                self.flags.push(
                    u8::from(hard_break) * CLUSTER_HARD_BREAK | u8::from(space) * CLUSTER_SPACE,
                );
                self.advances.push(if hard_break {
                    0.0
                } else if space {
                    spaced
                } else {
                    plain
                });
            }
            cluster = segment_end;
        }
        Ok(())
    }

    /// `index_at[offset]` is the cluster holding text unit `offset`; past the last cluster it
    /// is the cluster count.
    pub(super) fn build_index(&mut self, text_length: usize) -> Result<(), EngineError> {
        let count = u32::try_from(self.starts.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.index_at.resize(text_length + 1, count);
        // Text before the first cluster has no cluster before it to belong to.
        let first = self.starts.first().map_or(0, |start| *start as usize);
        self.index_at[..first.min(text_length)].fill(0);
        for (cluster, (start, end)) in self.starts.iter().zip(&self.ends).enumerate() {
            self.index_at[*start as usize..*end as usize].fill(cluster as u32);
        }
        Ok(())
    }

    /// Folds the shaped glyphs into the cluster lanes and scatters the glyph stream into
    /// cluster order.
    pub(super) fn aggregate_shape<'ink>(
        &mut self,
        runs: &[ShapingRun],
        shape: &ShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) -> Result<(), EngineError> {
        let stream_len = shape.glyph_ids.len();
        if [
            shape.clusters.len(),
            shape.x_advances.len(),
            shape.x_offsets.len(),
            shape.y_offsets.len(),
            shape.glyph_flags.len(),
        ]
        .iter()
        .any(|length| *length != stream_len)
        {
            return Err(EngineError::InvalidRequest);
        }
        let mut scales = core::mem::take(&mut self.run_scales);
        let result = self.aggregate_shape_with(runs, shape, &mut scales, metrics_for, ink_for);
        self.run_scales = scales;
        result
    }

    fn aggregate_shape_with<'ink>(
        &mut self,
        runs: &[ShapingRun],
        shape: &ShapeArena,
        scales: &mut alloc::vec::Vec<RunScale>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) -> Result<(), EngineError> {
        let stream_len = shape.glyph_ids.len();
        scales.clear();
        reserve(scales, shape.runs.len())?;
        // The text the clusters cover: a glyph outside it belongs to no cluster.
        let covered =
            self.starts.first().copied().unwrap_or(0)..self.ends.last().copied().unwrap_or(0);
        let mut shared = false;
        // While the glyphs are counted, `source_runs` holds the shaped run that owns each
        // cluster: the first, in shaping order, with a glyph in it.
        for (index, shaped_run) in shape.runs.iter().enumerate() {
            let source = usize::try_from(shaped_run.source_run)
                .ok()
                .and_then(|source| runs.get(source))
                .ok_or(EngineError::InvalidRequest)?;
            let metrics = metrics_for(shaped_run.font_handle)
                .ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let units_per_em = f64::from(metrics.units_per_em);
            scales.push(RunScale {
                scale: f64::from(source.style.font_size) / units_per_em,
                units_per_em,
            });
            let glyphs = glyph_range(*shaped_run, stream_len)?;
            let clusters = &shape.clusters[glyphs.clone()];
            let (lowest, highest) = clusters
                .iter()
                .fold((u32::MAX, 0), |(lowest, highest), cluster| {
                    (lowest.min(*cluster), highest.max(*cluster))
                });
            if !clusters.is_empty() && (lowest < covered.start || highest >= covered.end) {
                return Err(EngineError::InvalidRequest);
            }
            let owner = u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?;
            for (cluster, flags) in clusters.iter().zip(&shape.glyph_flags[glyphs]) {
                let cluster = self.index_at[*cluster as usize] as usize;
                let previous = self.source_runs[cluster];
                shared |= (previous != NO_SOURCE_RUN) & (previous != owner);
                self.source_runs[cluster] = previous.min(owner);
                self.glyph_counts[cluster] += 1;
                self.unsafe_before[cluster] |= (flags & GLYPH_UNSAFE_TO_BREAK) as u8;
            }
        }
        if shared {
            self.check_shared_owners(shape)?;
        }
        // A ligature absorbs its trailing graphemes: `fi` shapes to one glyph reported at the
        // first grapheme, so the second grapheme's cluster has no glyph. Positioning still walks
        // that cluster and derives a scale from the owning font, so the first shaped run whose
        // text covers it owns it.
        for (index, shaped_run) in shape.runs.iter().enumerate() {
            // `scales` has an entry for this run, so its source run exists.
            let source = runs[shaped_run.source_run as usize];
            if shaped_run.text_start < source.text_start
                || shaped_run.text_end > source.text_end
                || shaped_run.text_start >= shaped_run.text_end
            {
                return Err(EngineError::InvalidRequest);
            }
            let (start, end) = covered_clusters(self, *shaped_run);
            if start >= end {
                return Err(EngineError::InvalidRequest);
            }
            for owner in &mut self.source_runs[start..end] {
                if *owner == NO_SOURCE_RUN {
                    *owner = index as u32;
                }
            }
        }

        let mut glyph_start = 0_u32;
        for (start, count) in self.glyph_starts.iter_mut().zip(&self.glyph_counts) {
            *start = glyph_start;
            glyph_start = glyph_start.wrapping_add(*count);
        }
        if glyph_start as usize != stream_len {
            return Err(EngineError::InvalidRequest);
        }
        for (((flags, shaped), count), unsafe_before) in self
            .flags
            .iter_mut()
            .zip(&mut self.shaped)
            .zip(&self.glyph_counts)
            .zip(&self.unsafe_before)
        {
            let has_glyph = *count != 0;
            *shaped = u8::from(has_glyph);
            *flags |= u8::from(has_glyph & (*unsafe_before == 0)) * CLUSTER_SAFE_BEFORE;
        }
        self.scatter_glyphs(shape)?;
        self.finish_owned_spans(shape, scales, ink_for)
    }

    /// Two shaped runs put glyphs in one cluster: that is one owner only when both shaped the
    /// same source run with the same font.
    fn check_shared_owners(&self, shape: &ShapeArena) -> Result<(), EngineError> {
        let owner_of = |run: &ShapedRun| (run.source_run, run.binding_handle, run.font_handle);
        for (index, shaped_run) in shape.runs.iter().enumerate() {
            let glyphs = glyph_range(*shaped_run, shape.clusters.len())?;
            for cluster in &shape.clusters[glyphs] {
                let owner = self.source_runs[self.index_at[*cluster as usize] as usize] as usize;
                if owner != index && owner_of(&shape.runs[owner]) != owner_of(shaped_run) {
                    return Err(EngineError::InvalidRequest);
                }
            }
        }
        Ok(())
    }

    /// Copies the shaped glyph stream into cluster order: each cluster's glyphs adjacent, in
    /// shaping order. Reordering scripts report clusters out of order and several glyphs per
    /// cluster, so each glyph goes to its cluster's next free slot.
    fn scatter_glyphs(&mut self, shape: &ShapeArena) -> Result<(), EngineError> {
        let stream_len = shape.glyph_ids.len();
        reserve(&mut self.glyph_ids, stream_len)?;
        reserve(&mut self.glyph_clusters, stream_len)?;
        reserve(&mut self.glyph_x_advances, stream_len)?;
        reserve(&mut self.glyph_x_offsets, stream_len)?;
        reserve(&mut self.glyph_y_offsets, stream_len)?;
        reserve(&mut self.glyph_shape_flags, stream_len)?;
        if scatter_is_identity(shape) {
            // Simple-script shaping leaves the glyphs in cluster order already.
            self.glyph_ids.extend_from_slice(&shape.glyph_ids);
            self.glyph_clusters.extend_from_slice(&shape.clusters);
            self.glyph_x_advances.extend_from_slice(&shape.x_advances);
            self.glyph_x_offsets.extend_from_slice(&shape.x_offsets);
            self.glyph_y_offsets.extend_from_slice(&shape.y_offsets);
            self.glyph_shape_flags.extend_from_slice(&shape.glyph_flags);
            return Ok(());
        }
        self.glyph_ids.resize(stream_len, 0);
        self.glyph_clusters.resize(stream_len, 0);
        self.glyph_x_advances.resize(stream_len, 0);
        self.glyph_x_offsets.resize(stream_len, 0);
        self.glyph_y_offsets.resize(stream_len, 0);
        self.glyph_shape_flags.resize(stream_len, 0);
        // `glyph_starts` is the next free slot of each cluster while the glyphs move, which
        // leaves it one glyph count past where it began.
        for shaped_run in &shape.runs {
            for glyph in glyph_range(*shaped_run, stream_len)? {
                let cluster = self.index_at[shape.clusters[glyph] as usize] as usize;
                let slot = self.glyph_starts[cluster] as usize;
                self.glyph_starts[cluster] += 1;
                self.glyph_ids[slot] = shape.glyph_ids[glyph];
                self.glyph_clusters[slot] = shape.clusters[glyph];
                self.glyph_x_advances[slot] = shape.x_advances[glyph];
                self.glyph_x_offsets[slot] = shape.x_offsets[glyph];
                self.glyph_y_offsets[slot] = shape.y_offsets[glyph];
                self.glyph_shape_flags[slot] = shape.glyph_flags[glyph];
            }
        }
        for (start, count) in self.glyph_starts.iter_mut().zip(&self.glyph_counts) {
            *start -= *count;
        }
        Ok(())
    }

    /// Writes what a stretch of clusters takes from the one shaped run that owns it: the owner
    /// lanes, the font em, the advances its glyphs add, and the font's ink for those glyphs.
    fn finish_owned_spans<'ink>(
        &mut self,
        shape: &ShapeArena,
        scales: &[RunScale],
        ink_for: impl Fn(u32) -> Option<FontInkTable<'ink>>,
    ) -> Result<(), EngineError> {
        let count = self.starts.len();
        let stream_len = self.glyph_ids.len();
        self.run_local
            .ink
            .reset(stream_len)
            .map_err(|_| EngineError::ResultTooLarge)?;
        let mut ink_is_whole = true;
        let mut start = 0usize;
        while start < count {
            let owner = self.source_runs[start];
            let end = start
                + self.source_runs[start..]
                    .iter()
                    .position(|other| *other != owner)
                    .unwrap_or(count - start);
            if owner == NO_SOURCE_RUN {
                start = end;
                continue;
            }
            let shaped_run = shape.runs[owner as usize];
            let RunScale {
                scale,
                units_per_em,
            } = scales[owner as usize];
            self.source_runs[start..end].fill(shaped_run.source_run);
            self.binding_handles[start..end].fill(shaped_run.binding_handle);
            self.font_handles[start..end].fill(shaped_run.font_handle);
            self.units_per_em[start..end].fill(units_per_em);

            let glyph_start = self.glyph_starts[start] as usize;
            let glyph_end = match self.glyph_starts.get(end) {
                Some(next) => *next as usize,
                None => stream_len,
            };
            let glyph_advances = &self.glyph_x_advances[glyph_start..glyph_end];
            let advances = &mut self.advances[start..end];
            if glyph_advances.len() == advances.len()
                && self.glyph_counts[start..end]
                    .iter()
                    .fold(true, |single, count| single & (*count == 1))
            {
                for (advance, glyph_advance) in advances.iter_mut().zip(glyph_advances) {
                    *advance += f64::from(glyph_advance.unsigned_abs()) * scale;
                }
            } else {
                let mut glyphs = glyph_advances.iter();
                for (advance, count) in advances.iter_mut().zip(&self.glyph_counts[start..end]) {
                    // In shaping order, one product at a time: the sum's bits depend on it.
                    for glyph_advance in glyphs.by_ref().take(*count as usize) {
                        *advance += f64::from(glyph_advance.unsigned_abs()) * scale;
                    }
                }
            }

            match ink_for(shaped_run.font_handle) {
                Some(table) => self.fill_ink(table, start, end, glyph_end),
                None => ink_is_whole = false,
            }
            start = end;
        }
        if ink_is_whole {
            self.run_local.keep_ink();
        }
        Ok(())
    }

    /// The font's ink for the glyphs of clusters `[start, end)`. A hard break is detached: it
    /// has no rows, so its glyphs are never measured and stay without ink.
    fn fill_ink(&mut self, table: FontInkTable<'_>, start: usize, end: usize, glyph_end: usize) {
        let (units, outlined) = self.run_local.ink.lanes_mut();
        let mut cluster = start;
        while cluster < end {
            let attached = self.flags[cluster..end]
                .iter()
                .position(|flags| flags & CLUSTER_HARD_BREAK != 0)
                .map_or(end, |offset| cluster + offset);
            let first = self.glyph_starts[cluster] as usize;
            let last = match self.glyph_starts.get(attached) {
                Some(next) if attached < end => *next as usize,
                _ => glyph_end,
            };
            for (offset, (glyph_id, units)) in self.glyph_ids[first..last]
                .iter()
                .zip(&mut units[first..last])
                .enumerate()
            {
                let (ink, has_outline) = table.units(*glyph_id);
                *units = ink;
                let glyph = first + offset;
                outlined[glyph / 64] |= u64::from(has_outline) << (glyph % 64);
            }
            cluster = attached + 1;
        }
    }
}
