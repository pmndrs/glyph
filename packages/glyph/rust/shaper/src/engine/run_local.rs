//! Break-independent numeric blocks and retained run-local glyph geometry.
//!

use alloc::vec::Vec;

use crate::FontGlyphExtents;

use super::cluster_state::LAYOUT_CHUNK;

pub(crate) const LOCAL_ABS_LIMIT: f64 = 8_192.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunLocalBuildError {
    AllocationFailed,
    InvalidSource,
    LocalGeometryOutOfRange,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct NumericBlockSpan {
    pub start: u32,
    pub count: u32,
    pub cluster_start: u32,
    pub cluster_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NumericBlock {
    pub source_glyph_start: u32,
    pub source_glyph_count: u32,
    pub row_start: u32,
    pub row_count: u32,
    pub anchor_inline: f64,
    pub anchor_block: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RunLocalGlyph {
    #[cfg(any(test, feature = "kernel-lab"))]
    pub source_glyph: u32,
    #[cfg(any(test, feature = "kernel-lab"))]
    pub block_index: u32,
    #[cfg(any(test, feature = "kernel-lab"))]
    pub pen_inline: f64,
    pub inline_origin: f32,
    pub block_origin: f32,
    pub inline_advance: f32,
    pub ink_inline_start: f32,
    pub ink_block_start: f32,
    pub ink_inline_extent: f32,
    pub ink_block_extent: f32,
    pub has_outline: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct RunLocalGlyphInput {
    pub source_glyph: u32,
    pub x_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub baseline_shift: f32,
    pub scale: f64,
    pub outline: Option<FontGlyphExtents>,
}

#[derive(Clone, Copy)]
pub(crate) enum ClusterFinish {
    Resync(f64),
    Continue {
        letter_spacing: f32,
        word_spacing: Option<f32>,
    },
}

#[derive(Default)]
pub(crate) struct RunLocalArena {
    blocks: Vec<NumericBlock>,
    rows: Vec<RunLocalGlyph>,
    source_rows: Vec<u32>,
    source_words: Vec<SourceWord>,
    source_prefix: Vec<SourceWordPrefix>,
    cluster_blocks: Vec<u32>,
    cluster_prefixes: Vec<f64>,
    pending_block_rows: Vec<PendingGlyph>,
    pending_cluster_rows: Vec<RawGlyph>,
    pending_block_clusters: Vec<PendingCluster>,
}

#[derive(Clone, Copy, Default)]
struct SourceWord {
    covered: u64,
    outlined: u64,
}

#[derive(Clone, Copy, Default)]
struct SourceWordPrefix {
    covered: u32,
    outlined: u32,
}

impl RunLocalArena {
    pub(crate) fn clear(&mut self) {
        self.blocks.clear();
        self.rows.clear();
        self.source_rows.clear();
        self.source_words.clear();
        self.source_prefix.clear();
        self.cluster_blocks.clear();
        self.cluster_prefixes.clear();
        self.pending_block_rows.clear();
        self.pending_cluster_rows.clear();
        self.pending_block_clusters.clear();
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn blocks(&self) -> &[NumericBlock] {
        &self.blocks
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn rows(&self) -> &[RunLocalGlyph] {
        &self.rows
    }

    pub(crate) fn row_for_source_glyph(&self, source_glyph: u32) -> Option<&RunLocalGlyph> {
        let row = *self.source_rows.get(usize::try_from(source_glyph).ok()?)?;
        self.rows.get(usize::try_from(row).ok()?)
    }

    /// Finds the next outlined source glyph in a proven covered interval. The
    /// caller advances monotonically, so every empty word is visited at most once.
    pub(crate) fn next_outlined_source(&self, start: u32, end: u32) -> Option<u32> {
        let mut cursor = start;
        while cursor < end {
            let word_index = usize::try_from(cursor / 64).ok()?;
            let word = self.source_words.get(word_index)?.outlined;
            let remaining = word & (u64::MAX << (cursor % 64));
            if remaining != 0 {
                let source = u32::try_from(word_index)
                    .ok()?
                    .checked_mul(64)?
                    .checked_add(remaining.trailing_zeros())?;
                if source < end {
                    return Some(source);
                }
                return None;
            }
            cursor = u32::try_from(word_index)
                .ok()?
                .checked_add(1)?
                .checked_mul(64)?;
        }
        None
    }

    /// Selects one outlined source position within a covered interval. Used only
    /// at an actual retained-range seek, never for sequential outlined records.
    pub(crate) fn select_outlined_source(&self, start: u32, end: u32, ordinal: u32) -> Option<u32> {
        let mut low = start;
        let mut high = end;
        while low < high {
            let middle = low + (high - low) / 2;
            let count = self
                .source_range_counts(start, middle.checked_add(1)? - start)?
                .1;
            if count <= ordinal {
                low = middle.checked_add(1)?;
            } else {
                high = middle;
            }
        }
        (low < end).then_some(low)
    }

    /// Counts covered and outlined source glyphs without revisiting their local rows.
    /// The producer finalizes the prefix after all runs, including reverse-order runs.
    pub(crate) fn source_range_counts(&self, start: u32, count: u32) -> Option<(u32, u32)> {
        let end = start.checked_add(count)?;
        let before = self.source_rank(start)?;
        let after = self.source_rank(end)?;
        Some((
            after.0.checked_sub(before.0)?,
            after.1.checked_sub(before.1)?,
        ))
    }

    /// Compares outline admission in source order, including ranges with different
    /// absolute starts. One word comparison covers up to 64 glyphs.
    pub(crate) fn same_outline_pattern(
        &self,
        start: u32,
        other: &Self,
        other_start: u32,
        count: u32,
    ) -> Option<bool> {
        let self_end = start.checked_add(count)?;
        let other_end = other_start.checked_add(count)?;
        if self.source_range_counts(start, count)?.0 != count
            || other.source_range_counts(other_start, count)?.0 != count
            || self_end > u32::try_from(self.source_rows.len()).ok()?
            || other_end > u32::try_from(other.source_rows.len()).ok()?
        {
            return Some(false);
        }
        let mut visited = 0_u32;
        while visited < count {
            #[cfg(test)]
            super::work_attribution::record(|work| work.retained_outline_word_comparisons += 1);
            let width = (count - visited).min(64);
            if self.outline_bits(start + visited, width)?
                != other.outline_bits(other_start + visited, width)?
            {
                return Some(false);
            }
            visited += width;
        }
        Some(true)
    }

    fn outline_bits(&self, start: u32, width: u32) -> Option<u64> {
        let word = usize::try_from(start / 64).ok()?;
        let offset = start % 64;
        let low = self.source_words.get(word)?.outlined >> offset;
        let bits = if offset + width > 64 {
            low | (self.source_words.get(word + 1)?.outlined << (64 - offset))
        } else {
            low
        };
        Some(if width == 64 {
            bits
        } else {
            bits & ((1_u64 << width) - 1)
        })
    }

    fn source_rank(&self, end: u32) -> Option<(u32, u32)> {
        let word = usize::try_from(end / 64).ok()?;
        let prefix = self.source_prefix.get(word)?;
        let bits = end % 64;
        if bits == 0 {
            return Some((prefix.covered, prefix.outlined));
        }
        let source = self.source_words.get(word)?;
        let mask = (1_u64 << bits) - 1;
        Some((
            prefix
                .covered
                .checked_add((source.covered & mask).count_ones())?,
            prefix
                .outlined
                .checked_add((source.outlined & mask).count_ones())?,
        ))
    }

    pub(crate) fn finalize_source_ranks(&mut self) -> Result<(), RunLocalBuildError> {
        self.source_prefix.clear();
        let prefix_count = self
            .source_words
            .len()
            .checked_add(1)
            .ok_or(RunLocalBuildError::AllocationFailed)?;
        reserve(&mut self.source_prefix, prefix_count)?;
        let mut total = SourceWordPrefix::default();
        self.source_prefix.push(total);
        for word in &self.source_words {
            total.covered = total
                .covered
                .checked_add(word.covered.count_ones())
                .ok_or(RunLocalBuildError::AllocationFailed)?;
            total.outlined = total
                .outlined
                .checked_add(word.outlined.count_ones())
                .ok_or(RunLocalBuildError::AllocationFailed)?;
            self.source_prefix.push(total);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn row_for_source_order_glyph(&self, source_glyph: u32) -> Option<&RunLocalGlyph> {
        let index = usize::try_from(source_glyph).ok()?;
        let row = self.rows.get(index)?;
        debug_assert_eq!(self.source_rows.get(index), Some(&source_glyph));
        Some(row)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn cluster_blocks(&self) -> &[u32] {
        &self.cluster_blocks
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn cluster_prefixes(&self) -> &[f64] {
        &self.cluster_prefixes
    }

    pub(crate) fn begin_run(&mut self) -> RunLocalBlockWriter<GeneralSink<'_>> {
        RunLocalBlockWriter::new(GeneralSink(self))
    }
}

/// Storage-only operations for the exact shared numeric block writer.
pub(crate) trait RunLocalBlockSink {
    fn block_len(&self) -> usize;
    fn cluster_len(&self) -> usize;
    fn row_len(&self) -> usize;
    fn take_pending(&mut self) -> (Vec<PendingGlyph>, Vec<RawGlyph>, Vec<PendingCluster>);
    fn recycle_pending(
        &mut self,
        rows: Vec<PendingGlyph>,
        raw: Vec<RawGlyph>,
        clusters: Vec<PendingCluster>,
    );
    fn detached_cluster(&mut self) -> Result<(), RunLocalBuildError>;
    fn block(
        &mut self,
        rows: &mut Vec<PendingGlyph>,
        clusters: &mut Vec<PendingCluster>,
        envelope: Envelope,
    ) -> Result<(), RunLocalBuildError>;
}

pub(crate) struct GeneralSink<'a>(&'a mut RunLocalArena);

/// The bounded producer stores final local rows at source indices. It carries no
/// General row-order map, source bitsets, or rank prefix.
pub(crate) struct RunLocalCompact<T> {
    blocks: Vec<NumericBlock>,
    rows: Vec<Option<T>>,
    cluster_blocks: Vec<u32>,
    cluster_prefixes: Vec<f64>,
    row_count: u32,
    pending_block_rows: Vec<PendingGlyph>,
    pending_cluster_rows: Vec<RawGlyph>,
    pending_block_clusters: Vec<PendingCluster>,
}

impl<T> Default for RunLocalCompact<T> {
    fn default() -> Self {
        Self {
            blocks: Vec::new(),
            rows: Vec::new(),
            cluster_blocks: Vec::new(),
            cluster_prefixes: Vec::new(),
            row_count: 0,
            pending_block_rows: Vec::new(),
            pending_cluster_rows: Vec::new(),
            pending_block_clusters: Vec::new(),
        }
    }
}

impl<T> RunLocalCompact<T> {
    pub(crate) fn clear(&mut self) {
        self.blocks.clear();
        self.rows.clear();
        self.cluster_blocks.clear();
        self.cluster_prefixes.clear();
        self.row_count = 0;
        self.pending_block_rows.clear();
        self.pending_cluster_rows.clear();
        self.pending_block_clusters.clear();
    }

    /// The mapper writes the final leaf row at numeric block closure. The compact store itself
    /// is that row owner; production must not make a RunLocalGlyph array and copy it afterward.
    pub(crate) fn begin_run<F>(&mut self, map: F) -> RunLocalBlockWriter<CompactSink<'_, T, F>>
    where
        F: FnMut(u32, u32, RunLocalGlyph) -> Result<T, RunLocalBuildError>,
    {
        RunLocalBlockWriter::new(CompactSink { compact: self, map })
    }

    pub(crate) fn blocks(&self) -> &[NumericBlock] {
        &self.blocks
    }

    pub(crate) fn cluster_blocks(&self) -> &[u32] {
        &self.cluster_blocks
    }

    pub(crate) fn cluster_prefixes(&self) -> &[f64] {
        &self.cluster_prefixes
    }

    pub(crate) fn row_for_source_glyph(&self, source_glyph: u32) -> Option<&T> {
        self.rows.get(usize::try_from(source_glyph).ok()?)?.as_ref()
    }

    pub(crate) fn row_for_source_glyph_mut(&mut self, source_glyph: u32) -> Option<&mut T> {
        self.rows
            .get_mut(usize::try_from(source_glyph).ok()?)?
            .as_mut()
    }

    pub(crate) fn source_rows(&self) -> &[Option<T>] {
        &self.rows
    }
}

pub(crate) struct CompactSink<'a, T, F> {
    compact: &'a mut RunLocalCompact<T>,
    map: F,
}

pub(crate) type RunLocalWriter<'a> = RunLocalBlockWriter<GeneralSink<'a>>;

pub(crate) struct RunLocalBlockWriter<S: RunLocalBlockSink> {
    sink: S,
    first_block: usize,
    first_cluster: usize,
    pending_block_rows: Vec<PendingGlyph>,
    pending_cluster_rows: Vec<RawGlyph>,
    pending_block_clusters: Vec<PendingCluster>,
    block_cursor: f64,
    block_envelope: Option<Envelope>,
    cluster_open: bool,
}

impl<S: RunLocalBlockSink> RunLocalBlockWriter<S> {
    fn new(mut sink: S) -> Self {
        let first_block = sink.block_len();
        let first_cluster = sink.cluster_len();
        let (pending_block_rows, pending_cluster_rows, pending_block_clusters) =
            sink.take_pending();
        Self {
            sink,
            first_block,
            first_cluster,
            pending_block_rows,
            pending_cluster_rows,
            pending_block_clusters,
            block_cursor: 0.0,
            block_envelope: None,
            cluster_open: false,
        }
    }

    pub(crate) fn begin_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if !self.pending_cluster_rows.is_empty() || self.cluster_open {
            return Err(RunLocalBuildError::InvalidSource);
        }
        // Source-relative chunk boundaries are identical for cold and retained builds.
        // Envelope precision splits remain free to subdivide each chunk.
        let ordinal = self
            .sink
            .cluster_len()
            .checked_sub(self.first_cluster)
            .and_then(|count| count.checked_add(self.pending_block_clusters.len()))
            .ok_or(RunLocalBuildError::AllocationFailed)?;
        if ordinal != 0 && ordinal % LAYOUT_CHUNK == 0 {
            self.finalize_block()?;
        }
        self.cluster_open = true;
        Ok(())
    }

    pub(crate) fn push_detached_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if self.cluster_open || !self.pending_cluster_rows.is_empty() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.finalize_block()?;
        self.sink.detached_cluster()
    }

    pub(crate) fn push_glyph(
        &mut self,
        input: RunLocalGlyphInput,
    ) -> Result<(), RunLocalBuildError> {
        if !self.cluster_open || !input.scale.is_finite() || input.scale <= 0.0 {
            return Err(RunLocalBuildError::InvalidSource);
        }
        let advance = f64::from(input.x_advance).abs() * input.scale;
        let x_offset = f64::from(input.x_offset) * input.scale;
        let y_offset = f64::from(input.y_offset) * input.scale;
        let block_origin = 0.0 - y_offset - f64::from(input.baseline_shift);
        let (ink_inline_offset, ink_block_start, ink_inline_extent, ink_block_extent) =
            match input.outline {
                Some(extents) => (
                    f64::from(extents.x_min) * input.scale,
                    block_origin - f64::from(extents.y_max) * input.scale,
                    (f64::from(extents.x_max) - f64::from(extents.x_min)) * input.scale,
                    (f64::from(extents.y_max) - f64::from(extents.y_min)) * input.scale,
                ),
                None => (0.0, block_origin, 0.0, 0.0),
            };
        reserve(&mut self.pending_cluster_rows, 1)?;
        self.pending_cluster_rows.push(RawGlyph {
            source_glyph: input.source_glyph,
            raw_advance: advance,
            x_offset,
            block_origin,
            ink_inline_offset,
            ink_block_start,
            ink_inline_extent,
            ink_block_extent,
            has_outline: input.outline.is_some(),
        });
        Ok(())
    }

    pub(crate) fn finish_cluster(
        &mut self,
        finish: ClusterFinish,
    ) -> Result<(), RunLocalBuildError> {
        // Clusters are indivisible admission atoms; an oversized cluster rejects the run.
        if !core::mem::replace(&mut self.cluster_open, false) {
            return Err(RunLocalBuildError::InvalidSource);
        }
        let shifted = self.replay_cluster_envelope(self.block_cursor, finish)?;
        let combined = self
            .block_envelope
            .map_or(shifted, |current| current.union(shifted));
        if self.pending_cluster_rows.is_empty() {
            if combined.admitted() {
                self.block_envelope = Some(combined);
                reserve(&mut self.pending_block_clusters, 1)?;
                self.pending_block_clusters.push(PendingCluster {
                    block_local_prefix: self.block_cursor,
                });
                self.block_cursor =
                    replay_finish_cursor(self.block_cursor, self.block_cursor, finish)?;
            } else if self.pending_block_rows.is_empty() {
                self.block_envelope = None;
                self.block_cursor = 0.0;
                self.push_detached_cluster()?;
            } else {
                self.finalize_block()?;
                self.push_detached_cluster()?;
            }
            return Ok(());
        }
        if !combined.admitted() {
            self.finalize_block()?;
            let envelope = self.replay_cluster_envelope(0.0, finish)?;
            if !envelope.admitted() {
                return Err(RunLocalBuildError::LocalGeometryOutOfRange);
            }
            self.block_cursor = 0.0;
            self.block_envelope = Some(envelope);
        } else {
            self.block_envelope = Some(combined);
        }
        reserve(&mut self.pending_block_clusters, 1)?;
        self.pending_block_clusters.push(PendingCluster {
            block_local_prefix: self.block_cursor,
        });
        reserve(
            &mut self.pending_block_rows,
            self.pending_cluster_rows.len(),
        )?;
        let cluster_root = self.block_cursor;
        let mut replay_cursor = cluster_root;
        for row in self.pending_cluster_rows.drain(..) {
            self.pending_block_rows.push(row.place(&mut replay_cursor)?);
        }
        self.block_cursor = replay_finish_cursor(cluster_root, replay_cursor, finish)?;
        if !self.block_cursor.is_finite() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        Ok(())
    }

    fn replay_cluster_envelope(
        &self,
        root: f64,
        finish: ClusterFinish,
    ) -> Result<Envelope, RunLocalBuildError> {
        let mut cursor = root;
        let mut envelope = Envelope::point(root);
        for row in &self.pending_cluster_rows {
            let origin = cursor + row.x_offset;
            let ink_start = origin + row.ink_inline_offset;
            envelope.include_inline(cursor)?;
            envelope.include_inline(origin)?;
            envelope.include_inline(ink_start)?;
            envelope.include_inline(ink_start + row.ink_inline_extent)?;
            envelope.include_block(row.block_origin)?;
            envelope.include_block(row.ink_block_start)?;
            envelope.include_block(row.ink_block_start + row.ink_block_extent)?;
            cursor += row.raw_advance;
            envelope.include_inline(cursor)?;
        }
        envelope.include_inline(replay_finish_cursor(root, cursor, finish)?)?;
        Ok(envelope)
    }

    pub(crate) fn finish(mut self) -> Result<NumericBlockSpan, RunLocalBuildError> {
        if !self.pending_cluster_rows.is_empty() || self.cluster_open {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.finalize_block()?;
        let count = self
            .sink
            .block_len()
            .checked_sub(self.first_block)
            .ok_or(RunLocalBuildError::InvalidSource)?;
        Ok(NumericBlockSpan {
            start: u32::try_from(self.first_block)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?,
            count: u32::try_from(count).map_err(|_| RunLocalBuildError::AllocationFailed)?,
            cluster_start: u32::try_from(self.first_cluster)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?,
            cluster_count: u32::try_from(
                self.sink
                    .cluster_len()
                    .checked_sub(self.first_cluster)
                    .ok_or(RunLocalBuildError::InvalidSource)?,
            )
            .map_err(|_| RunLocalBuildError::AllocationFailed)?,
        })
    }

    fn finalize_block(&mut self) -> Result<(), RunLocalBuildError> {
        let Some(envelope) = self.block_envelope.take() else {
            return Ok(());
        };
        if self.pending_block_rows.is_empty() {
            for _ in self.pending_block_clusters.drain(..) {
                self.sink.detached_cluster()?;
            }
            self.block_cursor = 0.0;
            return Ok(());
        }
        if !envelope.admitted() {
            return Err(RunLocalBuildError::LocalGeometryOutOfRange);
        }
        self.sink.block(
            &mut self.pending_block_rows,
            &mut self.pending_block_clusters,
            envelope,
        )?;
        self.block_cursor = 0.0;
        Ok(())
    }
}

impl<S: RunLocalBlockSink> Drop for RunLocalBlockWriter<S> {
    fn drop(&mut self) {
        self.sink.recycle_pending(
            core::mem::take(&mut self.pending_block_rows),
            core::mem::take(&mut self.pending_cluster_rows),
            core::mem::take(&mut self.pending_block_clusters),
        );
    }
}

impl RunLocalBlockSink for GeneralSink<'_> {
    fn block_len(&self) -> usize {
        self.0.blocks.len()
    }
    fn cluster_len(&self) -> usize {
        self.0.cluster_blocks.len()
    }
    fn row_len(&self) -> usize {
        self.0.rows.len()
    }

    fn take_pending(&mut self) -> (Vec<PendingGlyph>, Vec<RawGlyph>, Vec<PendingCluster>) {
        (
            core::mem::take(&mut self.0.pending_block_rows),
            core::mem::take(&mut self.0.pending_cluster_rows),
            core::mem::take(&mut self.0.pending_block_clusters),
        )
    }

    fn recycle_pending(
        &mut self,
        mut rows: Vec<PendingGlyph>,
        mut raw: Vec<RawGlyph>,
        mut clusters: Vec<PendingCluster>,
    ) {
        rows.clear();
        raw.clear();
        clusters.clear();
        self.0.pending_block_rows = rows;
        self.0.pending_cluster_rows = raw;
        self.0.pending_block_clusters = clusters;
    }

    fn detached_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        reserve(&mut self.0.cluster_blocks, 1)?;
        reserve(&mut self.0.cluster_prefixes, 1)?;
        self.0.cluster_blocks.push(u32::MAX);
        self.0.cluster_prefixes.push(0.0);
        Ok(())
    }

    fn block(
        &mut self,
        rows: &mut Vec<PendingGlyph>,
        clusters: &mut Vec<PendingCluster>,
        envelope: Envelope,
    ) -> Result<(), RunLocalBuildError> {
        let anchor_inline = envelope.midpoint_inline()?;
        let anchor_block = envelope.midpoint_block()?;
        let block_index =
            u32::try_from(self.block_len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
        let row_start =
            u32::try_from(self.row_len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
        reserve(&mut self.0.rows, rows.len())?;
        let mut source_glyph_start = u32::MAX;
        let mut source_glyph_end = 0_u32;
        for row in rows.drain(..) {
            source_glyph_start = source_glyph_start.min(row.source_glyph);
            source_glyph_end = source_glyph_end.max(
                row.source_glyph
                    .checked_add(1)
                    .ok_or(RunLocalBuildError::AllocationFailed)?,
            );
            let source_index = usize::try_from(row.source_glyph)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?;
            if self.0.source_rows.len() <= source_index {
                let additional = source_index + 1 - self.0.source_rows.len();
                reserve(&mut self.0.source_rows, additional)?;
                self.0.source_rows.resize(source_index + 1, u32::MAX);
            }
            if self.0.source_rows[source_index] != u32::MAX {
                return Err(RunLocalBuildError::InvalidSource);
            }
            let word_index = source_index / 64;
            if self.0.source_words.len() <= word_index {
                let additional = word_index + 1 - self.0.source_words.len();
                reserve(&mut self.0.source_words, additional)?;
                self.0
                    .source_words
                    .resize(word_index + 1, SourceWord::default());
            }
            let row_index = u32::try_from(self.0.rows.len())
                .map_err(|_| RunLocalBuildError::AllocationFailed)?;
            let source_bit = 1_u64 << (row.source_glyph % 64);
            let local = row.finish(block_index, anchor_inline, anchor_block)?;
            let word = &mut self.0.source_words[word_index];
            word.covered |= source_bit;
            if local.has_outline {
                word.outlined |= source_bit;
            }
            self.0.source_rows[source_index] = row_index;
            self.0.rows.push(local);
        }
        let row_count = u32::try_from(self.0.rows.len())
            .map_err(|_| RunLocalBuildError::AllocationFailed)?
            .checked_sub(row_start)
            .ok_or(RunLocalBuildError::InvalidSource)?;
        reserve(&mut self.0.cluster_blocks, clusters.len())?;
        reserve(&mut self.0.cluster_prefixes, clusters.len())?;
        for cluster in clusters.drain(..) {
            self.0.cluster_blocks.push(block_index);
            self.0.cluster_prefixes.push(cluster.block_local_prefix);
        }
        reserve(&mut self.0.blocks, 1)?;
        self.0.blocks.push(NumericBlock {
            source_glyph_start,
            source_glyph_count: source_glyph_end
                .checked_sub(source_glyph_start)
                .ok_or(RunLocalBuildError::InvalidSource)?,
            row_start,
            row_count,
            anchor_inline,
            anchor_block,
        });
        Ok(())
    }
}

impl<T, F> RunLocalBlockSink for CompactSink<'_, T, F>
where
    F: FnMut(u32, u32, RunLocalGlyph) -> Result<T, RunLocalBuildError>,
{
    fn block_len(&self) -> usize {
        self.compact.blocks.len()
    }
    fn cluster_len(&self) -> usize {
        self.compact.cluster_blocks.len()
    }
    fn row_len(&self) -> usize {
        self.compact.row_count as usize
    }

    fn take_pending(&mut self) -> (Vec<PendingGlyph>, Vec<RawGlyph>, Vec<PendingCluster>) {
        (
            core::mem::take(&mut self.compact.pending_block_rows),
            core::mem::take(&mut self.compact.pending_cluster_rows),
            core::mem::take(&mut self.compact.pending_block_clusters),
        )
    }

    fn recycle_pending(
        &mut self,
        mut rows: Vec<PendingGlyph>,
        mut raw: Vec<RawGlyph>,
        mut clusters: Vec<PendingCluster>,
    ) {
        rows.clear();
        raw.clear();
        clusters.clear();
        self.compact.pending_block_rows = rows;
        self.compact.pending_cluster_rows = raw;
        self.compact.pending_block_clusters = clusters;
    }

    fn detached_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if self.cluster_len() >= LAYOUT_CHUNK {
            return Err(RunLocalBuildError::InvalidSource);
        }
        reserve(&mut self.compact.cluster_blocks, 1)?;
        reserve(&mut self.compact.cluster_prefixes, 1)?;
        self.compact.cluster_blocks.push(u32::MAX);
        self.compact.cluster_prefixes.push(0.0);
        Ok(())
    }

    fn block(
        &mut self,
        rows: &mut Vec<PendingGlyph>,
        clusters: &mut Vec<PendingCluster>,
        envelope: Envelope,
    ) -> Result<(), RunLocalBuildError> {
        let anchor_inline = envelope.midpoint_inline()?;
        let anchor_block = envelope.midpoint_block()?;
        let block_index =
            u32::try_from(self.block_len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
        let row_start = self.compact.row_count;
        let row_count =
            u32::try_from(rows.len()).map_err(|_| RunLocalBuildError::AllocationFailed)?;
        let end_count = row_start
            .checked_add(row_count)
            .ok_or(RunLocalBuildError::AllocationFailed)?;
        if end_count > LAYOUT_CHUNK as u32
            || self
                .cluster_len()
                .checked_add(clusters.len())
                .ok_or(RunLocalBuildError::AllocationFailed)?
                > LAYOUT_CHUNK
        {
            return Err(RunLocalBuildError::InvalidSource);
        }
        let mut source_glyph_start = u32::MAX;
        let mut source_glyph_end = 0_u32;
        for row in rows.drain(..) {
            source_glyph_start = source_glyph_start.min(row.source_glyph);
            source_glyph_end = source_glyph_end.max(
                row.source_glyph
                    .checked_add(1)
                    .ok_or(RunLocalBuildError::AllocationFailed)?,
            );
            let source_index = usize::try_from(row.source_glyph)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?;
            if source_index >= LAYOUT_CHUNK {
                return Err(RunLocalBuildError::InvalidSource);
            }
            if self.compact.rows.len() <= source_index {
                let additional = source_index + 1 - self.compact.rows.len();
                reserve(&mut self.compact.rows, additional)?;
                self.compact.rows.resize_with(source_index + 1, || None);
            }
            if self.compact.rows[source_index].is_some() {
                return Err(RunLocalBuildError::InvalidSource);
            }
            let local = row.finish(block_index, anchor_inline, anchor_block)?;
            self.compact.rows[source_index] =
                Some((self.map)(row.source_glyph, block_index, local)?);
        }
        reserve(&mut self.compact.cluster_blocks, clusters.len())?;
        reserve(&mut self.compact.cluster_prefixes, clusters.len())?;
        for cluster in clusters.drain(..) {
            self.compact.cluster_blocks.push(block_index);
            self.compact
                .cluster_prefixes
                .push(cluster.block_local_prefix);
        }
        reserve(&mut self.compact.blocks, 1)?;
        self.compact.blocks.push(NumericBlock {
            source_glyph_start,
            source_glyph_count: source_glyph_end
                .checked_sub(source_glyph_start)
                .ok_or(RunLocalBuildError::InvalidSource)?,
            row_start,
            row_count,
            anchor_inline,
            anchor_block,
        });
        self.compact.row_count = end_count;
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(crate) struct RawGlyph {
    source_glyph: u32,
    raw_advance: f64,
    x_offset: f64,
    block_origin: f64,
    ink_inline_offset: f64,
    ink_block_start: f64,
    ink_inline_extent: f64,
    ink_block_extent: f64,
    has_outline: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct PendingGlyph {
    source_glyph: u32,
    #[cfg(any(test, feature = "kernel-lab"))]
    pen_inline: f64,
    inline_origin: f64,
    block_origin: f64,
    inline_advance: f64,
    ink_inline_start: f64,
    ink_block_start: f64,
    ink_inline_extent: f64,
    ink_block_extent: f64,
    has_outline: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct PendingCluster {
    block_local_prefix: f64,
}

impl RawGlyph {
    fn place(self, cursor: &mut f64) -> Result<PendingGlyph, RunLocalBuildError> {
        let pen_inline = *cursor;
        let inline_origin = pen_inline + self.x_offset;
        let ink_inline_start = inline_origin + self.ink_inline_offset;
        *cursor += self.raw_advance;
        if !pen_inline.is_finite()
            || !inline_origin.is_finite()
            || !ink_inline_start.is_finite()
            || !cursor.is_finite()
        {
            return Err(RunLocalBuildError::InvalidSource);
        }
        Ok(PendingGlyph {
            source_glyph: self.source_glyph,
            #[cfg(any(test, feature = "kernel-lab"))]
            pen_inline,
            inline_origin,
            block_origin: self.block_origin,
            inline_advance: self.raw_advance,
            ink_inline_start,
            ink_block_start: self.ink_block_start,
            ink_inline_extent: self.ink_inline_extent,
            ink_block_extent: self.ink_block_extent,
            has_outline: self.has_outline,
        })
    }
}

impl PendingGlyph {
    fn finish(
        self,
        block_index: u32,
        anchor_inline: f64,
        anchor_block: f64,
    ) -> Result<RunLocalGlyph, RunLocalBuildError> {
        #[cfg(not(any(test, feature = "kernel-lab")))]
        let _ = block_index;
        Ok(RunLocalGlyph {
            #[cfg(any(test, feature = "kernel-lab"))]
            source_glyph: self.source_glyph,
            #[cfg(any(test, feature = "kernel-lab"))]
            block_index,
            #[cfg(any(test, feature = "kernel-lab"))]
            pen_inline: self.pen_inline,
            inline_origin: local_f32(self.inline_origin - anchor_inline)?,
            block_origin: local_f32(self.block_origin - anchor_block)?,
            inline_advance: nonnegative_f32(self.inline_advance)?,
            ink_inline_start: local_f32(self.ink_inline_start - anchor_inline)?,
            ink_block_start: local_f32(self.ink_block_start - anchor_block)?,
            ink_inline_extent: nonnegative_f32(self.ink_inline_extent)?,
            ink_block_extent: nonnegative_f32(self.ink_block_extent)?,
            has_outline: self.has_outline,
        })
    }
}

fn replay_finish_cursor(
    root: f64,
    mut cursor: f64,
    finish: ClusterFinish,
) -> Result<f64, RunLocalBuildError> {
    match finish {
        ClusterFinish::Resync(advance) => cursor = root + advance,
        ClusterFinish::Continue {
            letter_spacing,
            word_spacing,
        } => {
            cursor += f64::from(letter_spacing);
            if let Some(word_spacing) = word_spacing {
                cursor += f64::from(word_spacing);
            }
        }
    }
    cursor
        .is_finite()
        .then_some(cursor)
        .ok_or(RunLocalBuildError::InvalidSource)
}

#[derive(Clone, Copy)]
pub(crate) struct Envelope {
    min_inline: f64,
    max_inline: f64,
    block: Option<(f64, f64)>,
}

impl Envelope {
    fn point(inline: f64) -> Self {
        Self {
            min_inline: inline,
            max_inline: inline,
            block: None,
        }
    }

    fn include_inline(&mut self, value: f64) -> Result<(), RunLocalBuildError> {
        if !value.is_finite() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.min_inline = self.min_inline.min(value);
        self.max_inline = self.max_inline.max(value);
        Ok(())
    }

    fn include_block(&mut self, value: f64) -> Result<(), RunLocalBuildError> {
        if !value.is_finite() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.block = Some(self.block.map_or((value, value), |(minimum, maximum)| {
            (minimum.min(value), maximum.max(value))
        }));
        Ok(())
    }

    fn union(self, other: Self) -> Self {
        Self {
            min_inline: self.min_inline.min(other.min_inline),
            max_inline: self.max_inline.max(other.max_inline),
            block: match (self.block, other.block) {
                (Some((left_min, left_max)), Some((right_min, right_max))) => {
                    Some((left_min.min(right_min), left_max.max(right_max)))
                }
                (Some(block), None) | (None, Some(block)) => Some(block),
                (None, None) => None,
            },
        }
    }

    fn admitted(self) -> bool {
        self.max_inline - self.min_inline <= LOCAL_ABS_LIMIT * 2.0
            && self
                .block
                .is_none_or(|(minimum, maximum)| maximum - minimum <= LOCAL_ABS_LIMIT * 2.0)
    }

    fn midpoint_inline(self) -> Result<f64, RunLocalBuildError> {
        midpoint(self.min_inline, self.max_inline)
    }

    fn midpoint_block(self) -> Result<f64, RunLocalBuildError> {
        self.block
            .map_or(Ok(0.0), |(minimum, maximum)| midpoint(minimum, maximum))
    }
}

fn midpoint(minimum: f64, maximum: f64) -> Result<f64, RunLocalBuildError> {
    let midpoint = minimum + (maximum - minimum) * 0.5;
    midpoint
        .is_finite()
        .then_some(midpoint)
        .ok_or(RunLocalBuildError::InvalidSource)
}

fn local_f32(value: f64) -> Result<f32, RunLocalBuildError> {
    if !value.is_finite() || value.abs() > LOCAL_ABS_LIMIT {
        return Err(RunLocalBuildError::LocalGeometryOutOfRange);
    }
    let narrowed = value as f32;
    narrowed
        .is_finite()
        .then_some(narrowed)
        .ok_or(RunLocalBuildError::LocalGeometryOutOfRange)
}

fn nonnegative_f32(value: f64) -> Result<f32, RunLocalBuildError> {
    let narrowed = value as f32;
    (value.is_finite() && value >= 0.0 && narrowed.is_finite())
        .then_some(narrowed)
        .ok_or(RunLocalBuildError::InvalidSource)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), RunLocalBuildError> {
    values
        .try_reserve(additional)
        .map_err(|_| RunLocalBuildError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_sink_matches_general_bits_through_precision_split_and_source_reorder() {
        fn feed<S: RunLocalBlockSink>(mut writer: RunLocalBlockWriter<S>) -> NumericBlockSpan {
            for (ordinal, source) in [2, 0, 3, 1].into_iter().enumerate() {
                writer.begin_cluster().unwrap();
                let mut input = glyph(source, if ordinal == 0 { 8_000 } else { 1_000 });
                if ordinal == 1 {
                    input.x_offset = -1_000;
                }
                if ordinal == 2 {
                    input.baseline_shift = -0.5;
                    input.y_offset = -3;
                    input.scale = 0.25;
                    input.outline = None;
                }
                if ordinal == 3 {
                    input.x_offset = 1;
                    input.scale = 0.5;
                }
                writer.push_glyph(input).unwrap();
                writer
                    .finish_cluster(ClusterFinish::Resync(if ordinal == 0 {
                        -8_000.0
                    } else {
                        1_000.0
                    }))
                    .unwrap();
            }
            writer.finish().unwrap()
        }

        let mut general = RunLocalArena::default();
        let mut compact = RunLocalCompact::<RunLocalGlyph>::default();
        assert_eq!(
            feed(general.begin_run()),
            feed(compact.begin_run(|_, _, local| Ok(local)))
        );
        assert_eq!(general.blocks().len(), 2);
        assert_eq!(general.blocks().len(), compact.blocks().len());
        for (left, right) in general.blocks().iter().zip(compact.blocks()) {
            assert_eq!(left.source_glyph_start, right.source_glyph_start);
            assert_eq!(left.source_glyph_count, right.source_glyph_count);
            assert_eq!(left.row_start, right.row_start);
            assert_eq!(left.row_count, right.row_count);
            assert_eq!(left.anchor_inline.to_bits(), right.anchor_inline.to_bits());
            assert_eq!(left.anchor_block.to_bits(), right.anchor_block.to_bits());
        }
        assert_eq!(general.cluster_blocks(), compact.cluster_blocks());
        for (left, right) in general
            .cluster_prefixes()
            .iter()
            .zip(compact.cluster_prefixes())
        {
            assert_eq!(left.to_bits(), right.to_bits());
        }
        for source in 0..4 {
            let left = general.row_for_source_glyph(source).unwrap();
            let right = compact.row_for_source_glyph(source).unwrap();
            assert_eq!(left.inline_origin.to_bits(), right.inline_origin.to_bits());
            assert_eq!(left.block_origin.to_bits(), right.block_origin.to_bits());
            assert_eq!(
                left.inline_advance.to_bits(),
                right.inline_advance.to_bits()
            );
            assert_eq!(
                left.ink_inline_start.to_bits(),
                right.ink_inline_start.to_bits()
            );
            assert_eq!(
                left.ink_block_start.to_bits(),
                right.ink_block_start.to_bits()
            );
            assert_eq!(
                left.ink_inline_extent.to_bits(),
                right.ink_inline_extent.to_bits()
            );
            assert_eq!(
                left.ink_block_extent.to_bits(),
                right.ink_block_extent.to_bits()
            );
            assert_eq!(left.has_outline, right.has_outline);
        }
        assert!(compact.row_for_source_glyph(4).is_none());
    }

    fn glyph(source_glyph: u32, advance: i32) -> RunLocalGlyphInput {
        RunLocalGlyphInput {
            source_glyph,
            x_advance: advance,
            x_offset: 0,
            y_offset: 0,
            baseline_shift: 0.0,
            scale: 1.0,
            outline: Some(FontGlyphExtents {
                x_min: 0,
                y_min: -1,
                x_max: advance.abs(),
                y_max: 1,
            }),
        }
    }

    #[test]
    fn numeric_blocks_obey_source_chunk_boundaries_with_detached_and_precision_splits() {
        for count in [63, 64, 65, 128] {
            for variant in 0..3 {
                let mut arena = RunLocalArena::default();
                let mut writer = arena.begin_run();
                for ordinal in 0..count {
                    if variant == 1 && ordinal == 4 {
                        writer.push_detached_cluster().unwrap();
                        continue;
                    }
                    writer.begin_cluster().unwrap();
                    if variant != 1 || ordinal != 6 {
                        let advance = if variant == 2 && ordinal == 0 {
                            8_000
                        } else {
                            10
                        };
                        let mut row = glyph(ordinal as u32, advance);
                        if variant == 2 && ordinal == 1 {
                            row.x_offset = -1_000;
                        }
                        writer.push_glyph(row).unwrap();
                    }
                    let advance = if variant == 2 && ordinal == 0 {
                        -8_000.0
                    } else {
                        10.0
                    };
                    writer
                        .finish_cluster(ClusterFinish::Resync(advance))
                        .unwrap();
                }
                let span = writer.finish().unwrap();
                assert_eq!(span.cluster_count as usize, count);
                assert_eq!(arena.cluster_blocks().len(), count);
                if variant == 0 {
                    assert_eq!(span.count as usize, count.div_ceil(LAYOUT_CHUNK));
                }
                if variant == 2 {
                    assert!(span.count as usize > count.div_ceil(LAYOUT_CHUNK));
                }
                let mut block_first = vec![None; arena.blocks().len()];
                let mut block_clusters = vec![0; arena.blocks().len()];
                for (ordinal, &block) in arena.cluster_blocks().iter().enumerate() {
                    if block == u32::MAX {
                        continue;
                    }
                    let first = block_first[block as usize].get_or_insert(ordinal);
                    assert_eq!(*first / LAYOUT_CHUNK, ordinal / LAYOUT_CHUNK);
                    block_clusters[block as usize] += 1;
                }
                assert!(block_clusters.iter().all(|&count| count <= LAYOUT_CHUNK));
                assert!(
                    arena
                        .rows()
                        .iter()
                        .all(|row| row.inline_origin.abs() <= LOCAL_ABS_LIMIT as f32)
                );
            }
        }
    }

    #[test]
    fn fixed_blocks_split_on_the_full_resynchronized_envelope() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer.push_glyph(glyph(0, 8_000)).unwrap();
        writer
            .finish_cluster(ClusterFinish::Resync(-8_000.0))
            .unwrap();
        writer.begin_cluster().unwrap();
        let mut second = glyph(1, 1_000);
        second.x_offset = -1_000;
        writer.push_glyph(second).unwrap();
        writer
            .finish_cluster(ClusterFinish::Resync(1_000.0))
            .unwrap();
        let span = writer.finish().unwrap();

        assert_eq!(
            span,
            NumericBlockSpan {
                start: 0,
                count: 2,
                cluster_start: 0,
                cluster_count: 2,
            }
        );
        assert_eq!(arena.blocks().len(), 2);
        assert_eq!(arena.rows().len(), 2);
        assert_eq!(
            [arena.rows()[0].pen_inline, arena.rows()[1].pen_inline],
            [0.0, 0.0]
        );
        assert!(arena.rows().iter().all(|row| {
            row.inline_origin.abs() <= LOCAL_ABS_LIMIT as f32
                && row.ink_inline_start.abs() <= LOCAL_ABS_LIMIT as f32
        }));
    }

    #[test]
    fn block_geometry_preserves_offsets_baseline_and_extents() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer
            .push_glyph(RunLocalGlyphInput {
                source_glyph: 7,
                x_advance: -4,
                x_offset: 3,
                y_offset: -2,
                baseline_shift: 0.5,
                scale: 0.5,
                outline: Some(FontGlyphExtents {
                    x_min: -2,
                    y_min: -4,
                    x_max: 6,
                    y_max: 8,
                }),
            })
            .unwrap();
        writer.finish_cluster(ClusterFinish::Resync(2.0)).unwrap();
        writer.finish().unwrap();

        let block = arena.blocks()[0];
        let row = arena.rows()[0];
        assert_eq!(row.source_glyph, 7);
        assert_eq!(row.inline_advance, 2.0);
        assert_eq!(row.inline_origin, (1.5 - block.anchor_inline) as f32);
        assert_eq!(row.block_origin, (0.5 - block.anchor_block) as f32);
        assert_eq!(row.ink_inline_extent, 4.0);
        assert_eq!(row.ink_block_extent, 6.0);
    }

    #[test]
    fn oversized_single_cluster_is_rejected_without_a_fallback() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer.push_glyph(glyph(0, 20_000)).unwrap();
        assert_eq!(
            writer.finish_cluster(ClusterFinish::Resync(20_000.0)),
            Err(RunLocalBuildError::LocalGeometryOutOfRange),
        );
    }

    #[test]
    fn boundary_continuation_applies_spacing_in_current_order() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer.push_glyph(glyph(0, 3)).unwrap();
        writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: 0.25,
                word_spacing: Some(0.5),
            })
            .unwrap();
        writer.begin_cluster().unwrap();
        writer.push_glyph(glyph(1, 2)).unwrap();
        writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: 0.0,
                word_spacing: None,
            })
            .unwrap();
        writer.finish().unwrap();

        assert_eq!(arena.rows()[1].pen_inline, 3.75);
    }

    #[test]
    fn glyphless_cluster_advance_precedes_the_next_glyph() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer.finish_cluster(ClusterFinish::Resync(2.0)).unwrap();
        writer.begin_cluster().unwrap();
        writer.push_glyph(glyph(0, 1)).unwrap();
        writer.finish_cluster(ClusterFinish::Resync(1.0)).unwrap();
        writer.finish().unwrap();

        assert_eq!(arena.rows()[0].pen_inline, 2.0);
        assert_eq!(arena.cluster_blocks(), [0, 0]);
        assert_eq!(arena.cluster_prefixes(), [0.0, 2.0]);
    }

    #[test]
    fn detached_hard_break_locator_does_not_create_a_block() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.push_detached_cluster().unwrap();
        let span = writer.finish().unwrap();

        assert_eq!(span.count, 0);
        assert_eq!(span.cluster_count, 1);
        assert!(arena.blocks().is_empty());
        assert_eq!(arena.cluster_blocks(), [u32::MAX]);
    }

    #[test]
    fn multi_glyph_replay_preserves_shipping_parenthesization() {
        let tiny_offset = f64::EPSILON;
        let raw = |raw_advance, x_offset| RawGlyph {
            source_glyph: 0,
            raw_advance,
            x_offset,
            block_origin: 0.0,
            ink_inline_offset: 0.0,
            ink_block_start: 0.0,
            ink_inline_extent: 0.0,
            ink_block_extent: 0.0,
            has_outline: false,
        };
        let first = raw(8_192.0, 0.0);
        let second = raw(0.0, tiny_offset);
        let mut cursor = -8_192.0;
        first.place(&mut cursor).unwrap();
        let placed = second.place(&mut cursor).unwrap();
        let regrouped = (8_192.0 + tiny_offset) + -8_192.0;

        assert_eq!(regrouped, 0.0);
        assert_eq!(placed.inline_origin, tiny_offset);
    }

    #[test]
    fn distant_block_axis_geometry_anchors_without_origin_zero() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        let mut input = glyph(0, 1);
        input.baseline_shift = 20_000.0;
        writer.push_glyph(input).unwrap();
        writer.finish_cluster(ClusterFinish::Resync(1.0)).unwrap();
        writer.finish().unwrap();

        assert_eq!(arena.blocks().len(), 1);
        assert!(arena.rows()[0].block_origin.abs() < 2.0);
    }

    #[test]
    fn extents_subtract_after_widening() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        writer.begin_cluster().unwrap();
        writer
            .push_glyph(RunLocalGlyphInput {
                source_glyph: 0,
                x_advance: 0,
                x_offset: 0,
                y_offset: 0,
                baseline_shift: 0.0,
                scale: 0.000_001,
                outline: Some(FontGlyphExtents {
                    x_min: i32::MIN,
                    y_min: i32::MIN,
                    x_max: i32::MAX,
                    y_max: i32::MAX,
                }),
            })
            .unwrap();
        writer.finish_cluster(ClusterFinish::Resync(0.0)).unwrap();
        writer.finish().unwrap();

        assert!(arena.rows()[0].ink_inline_extent > 4_294.0);
        assert!(arena.rows()[0].ink_block_extent > 4_294.0);
    }

    #[test]
    fn dense_cjk_run_retains_all_four_thousand_ninety_six_rows() {
        let mut arena = RunLocalArena::default();
        let mut writer = arena.begin_run();
        for source_glyph in 0..4_096 {
            writer.begin_cluster().unwrap();
            writer.push_glyph(glyph(source_glyph, 1)).unwrap();
            writer.finish_cluster(ClusterFinish::Resync(1.0)).unwrap();
        }
        let span = writer.finish().unwrap();

        assert_eq!(
            span,
            NumericBlockSpan {
                start: 0,
                count: 64,
                cluster_start: 0,
                cluster_count: 4_096,
            }
        );
        assert!(arena.blocks().iter().all(|block| block.row_count == 64));
        assert_eq!(arena.rows().len(), 4_096);
        assert_eq!(arena.rows()[4_095].source_glyph, 4_095);
        let last_block = arena.blocks().last().unwrap();
        assert_eq!(
            f64::from(arena.rows()[4_095].inline_origin) + last_block.anchor_inline + 4_032.0,
            4_095.0
        );
    }

    #[test]
    fn source_order_rows_remain_direct_after_a_reversed_run() {
        let mut arena = RunLocalArena::default();
        let mut reversed = arena.begin_run();
        for source_glyph in [1, 0] {
            reversed.begin_cluster().unwrap();
            reversed.push_glyph(glyph(source_glyph, 1)).unwrap();
            reversed.finish_cluster(ClusterFinish::Resync(1.0)).unwrap();
        }
        reversed.finish().unwrap();

        let mut source_order = arena.begin_run();
        for source_glyph in [2, 3] {
            source_order.begin_cluster().unwrap();
            let mut row = glyph(source_glyph, 1);
            if source_glyph == 2 {
                row.outline = None;
            }
            source_order.push_glyph(row).unwrap();
            source_order
                .finish_cluster(ClusterFinish::Resync(1.0))
                .unwrap();
        }
        source_order.finish().unwrap();
        arena.finalize_source_ranks().unwrap();

        assert_eq!(arena.row_for_source_glyph(0).unwrap().source_glyph, 0);
        assert_eq!(arena.row_for_source_glyph(1).unwrap().source_glyph, 1);
        assert_eq!(arena.row_for_source_order_glyph(2).unwrap().source_glyph, 2);
        assert_eq!(arena.row_for_source_order_glyph(3).unwrap().source_glyph, 3);
        assert_eq!(arena.source_range_counts(0, 2), Some((2, 2)));
        assert_eq!(arena.source_range_counts(1, 3), Some((3, 2)));
        assert_eq!(arena.source_range_counts(2, 1), Some((1, 0)));
        assert_eq!(arena.source_range_counts(4, 1), Some((0, 0)));
        assert_eq!(arena.same_outline_pattern(0, &arena, 0, 4), Some(true));
        assert_eq!(arena.same_outline_pattern(0, &arena, 1, 3), Some(false));
    }

    #[test]
    fn source_rank_covers_sparse_out_of_order_rows_across_word_edges() {
        let build = |order: [u32; 3], absent: u32| {
            let mut arena = RunLocalArena::default();
            let mut writer = arena.begin_run();
            for source_glyph in order {
                writer.begin_cluster().unwrap();
                let mut row = glyph(source_glyph, 1);
                if source_glyph == absent {
                    row.outline = None;
                }
                writer.push_glyph(row).unwrap();
                writer.finish_cluster(ClusterFinish::Resync(1.0)).unwrap();
            }
            writer.finish().unwrap();
            arena.finalize_source_ranks().unwrap();
            arena
        };
        let old = build([65, 63, 64], 64);
        let shifted = build([66, 64, 65], 65);
        let changed = build([66, 64, 65], 66);
        assert_eq!(old.source_range_counts(0, 63), Some((0, 0)));
        assert_eq!(old.source_range_counts(63, 3), Some((3, 2)));
        assert_eq!(old.source_range_counts(62, 3), Some((2, 1)));
        assert_eq!(old.source_range_counts(64, 3), Some((2, 1)));
        assert_eq!(old.same_outline_pattern(63, &shifted, 64, 3), Some(true));
        assert_eq!(old.same_outline_pattern(63, &changed, 64, 3), Some(false));
    }
}
