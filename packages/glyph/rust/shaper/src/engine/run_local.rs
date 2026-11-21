//! Break-independent numeric blocks and retained run-local glyph geometry.
//!
//! Rows are f32 lanes indexed by source glyph, relative to the anchor of the numeric block that
//! owns them. One kernel (`run_local_kernel`) computes every row from font-unit lanes; this
//! file owns the storage, the source-order outline index and the staged writer that feeds the
//! kernel for clients that hand over glyphs one at a time.

use alloc::vec::Vec;
use core::ops::Range;

use crate::FontGlyphExtents;

use super::cluster_state::LAYOUT_CHUNK;
use super::run_local_kernel::{
    BlockIndex, ClusterEnd, ClusterLanes, CutRule, GlyphUnits, KernelScratch, RunInput, ScaleSpan,
    layout_run,
};

pub(crate) const LOCAL_ABS_LIMIT: f64 = 8_192.0;

/// Today's cut rule for every client: source-relative chunk boundaries, identical for cold and
/// retained builds, with envelope precision splits free to subdivide each chunk.
pub(crate) const LAYOUT_CUT: CutRule = CutRule {
    clusters_per_block: LAYOUT_CHUNK,
    local_abs_limit: LOCAL_ABS_LIMIT,
};

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
    /// Rows emitted before this block and in it, in emission order.
    pub row_start: u32,
    pub row_count: u32,
    pub anchor_inline: f64,
    pub anchor_block: f64,
}

/// One glyph's row, gathered from the lanes for a reader that wants a single glyph.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RunLocalGlyph {
    #[cfg(test)]
    pub source_glyph: u32,
    #[cfg(test)]
    pub block_index: u32,
    #[cfg(test)]
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

/// The row lanes, parallel and indexed by glyph. Positions are relative to the owning block's
/// anchor; advances and extents are absolute.
#[derive(Default)]
pub(crate) struct RowLanes {
    pub(super) inline_origin: Vec<f32>,
    pub(super) block_origin: Vec<f32>,
    pub(super) inline_advance: Vec<f32>,
    pub(super) ink_inline_start: Vec<f32>,
    pub(super) ink_block_start: Vec<f32>,
    pub(super) ink_inline_extent: Vec<f32>,
    pub(super) ink_block_extent: Vec<f32>,
    /// The absolute pen before each glyph's offset, for tests of the chain.
    #[cfg(test)]
    pub(super) pen_inline: Vec<f64>,
}

/// Borrowed row lanes for readers that walk glyph ranges: index by source glyph.
// Single-glyph readers still gather a `RunLocalGlyph`; the column gather and positioning
// migrate to these lanes in their own units.
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub(crate) struct RunLocalLanes<'a> {
    pub inline_origin: &'a [f32],
    pub block_origin: &'a [f32],
    pub inline_advance: &'a [f32],
    pub ink_inline_start: &'a [f32],
    pub ink_block_start: &'a [f32],
    pub ink_inline_extent: &'a [f32],
    pub ink_block_extent: &'a [f32],
}

impl RowLanes {
    fn lanes_mut(&mut self) -> [&mut Vec<f32>; 7] {
        [
            &mut self.inline_origin,
            &mut self.block_origin,
            &mut self.inline_advance,
            &mut self.ink_inline_start,
            &mut self.ink_block_start,
            &mut self.ink_inline_extent,
            &mut self.ink_block_extent,
        ]
    }

    fn lanes(&self) -> [&Vec<f32>; 7] {
        [
            &self.inline_origin,
            &self.block_origin,
            &self.inline_advance,
            &self.ink_inline_start,
            &self.ink_block_start,
            &self.ink_inline_extent,
            &self.ink_block_extent,
        ]
    }

    pub(super) fn len(&self) -> usize {
        self.inline_origin.len()
    }

    fn clear(&mut self) {
        for lane in self.lanes_mut() {
            lane.clear();
        }
        #[cfg(test)]
        self.pen_inline.clear();
    }

    /// Extends every lane with zeroed rows up to `len`; never shrinks.
    pub(super) fn grow(&mut self, len: usize) -> Result<(), RunLocalBuildError> {
        if len <= self.len() {
            return Ok(());
        }
        for lane in self.lanes_mut() {
            reserve(lane, len - lane.len())?;
            lane.resize(len, 0.0);
        }
        #[cfg(test)]
        self.pen_inline.resize(len, 0.0);
        Ok(())
    }

    fn copy_row(&mut self, to: usize, source: &Self, from: usize) {
        for (lane, source) in self.lanes_mut().into_iter().zip(source.lanes()) {
            lane[to] = source[from];
        }
        #[cfg(test)]
        {
            self.pen_inline[to] = source.pen_inline[from];
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    fn view(&self) -> RunLocalLanes<'_> {
        RunLocalLanes {
            inline_origin: &self.inline_origin,
            block_origin: &self.block_origin,
            inline_advance: &self.inline_advance,
            ink_inline_start: &self.ink_inline_start,
            ink_block_start: &self.ink_block_start,
            ink_inline_extent: &self.ink_inline_extent,
            ink_block_extent: &self.ink_block_extent,
        }
    }

    /// The row at `glyph`; test builds also say where it came from.
    fn row(&self, glyph: usize, has_outline: bool, origin: RowOrigin) -> Option<RunLocalGlyph> {
        #[cfg(not(test))]
        let _ = origin;
        Some(RunLocalGlyph {
            #[cfg(test)]
            source_glyph: origin.source_glyph,
            #[cfg(test)]
            block_index: origin.block_index,
            #[cfg(test)]
            pen_inline: *self.pen_inline.get(glyph)?,
            inline_origin: *self.inline_origin.get(glyph)?,
            block_origin: *self.block_origin.get(glyph)?,
            inline_advance: *self.inline_advance.get(glyph)?,
            ink_inline_start: *self.ink_inline_start.get(glyph)?,
            ink_block_start: *self.ink_block_start.get(glyph)?,
            ink_inline_extent: *self.ink_inline_extent.get(glyph)?,
            ink_block_extent: *self.ink_block_extent.get(glyph)?,
            has_outline,
        })
    }
}

/// Test-only provenance of a gathered row.
#[derive(Clone, Copy)]
struct RowOrigin {
    #[cfg(test)]
    source_glyph: u32,
    #[cfg(test)]
    block_index: u32,
}

/// Font-unit ink boxes in cluster (source glyph) order, beside the glyph stream they describe:
/// the kernel's fourth glyph lane, and what a metric change will rescale from.
#[derive(Default)]
pub(crate) struct InkUnitLanes {
    /// `[inline_min, block_min, inline_max, block_max]`, block axis up; zero without an outline.
    units: Vec<[i16; 4]>,
    /// One bit per glyph: the font has an outline for it.
    outlined: Vec<u64>,
}

impl InkUnitLanes {
    fn clear(&mut self) {
        self.units.clear();
        self.outlined.clear();
    }

    /// Sizes the lanes for `glyphs` glyphs, all without an outline.
    pub(crate) fn reset(&mut self, glyphs: usize) -> Result<(), RunLocalBuildError> {
        self.clear();
        reserve(&mut self.units, glyphs)?;
        self.units.resize(glyphs, [0; 4]);
        let words = glyphs.div_ceil(64);
        reserve(&mut self.outlined, words)?;
        self.outlined.resize(words, 0);
        Ok(())
    }

    /// Records one glyph's ink. The registry stores i16 extents; anything wider is not a font
    /// this engine registered.
    pub(crate) fn set(
        &mut self,
        glyph: usize,
        extents: FontGlyphExtents,
    ) -> Result<(), RunLocalBuildError> {
        let units = ink_units(extents)?;
        *self
            .units
            .get_mut(glyph)
            .ok_or(RunLocalBuildError::InvalidSource)? = units;
        self.outlined[glyph / 64] |= 1 << (glyph % 64);
        Ok(())
    }

    pub(crate) fn units(&self) -> &[[i16; 4]] {
        &self.units
    }
}

fn ink_units(extents: FontGlyphExtents) -> Result<[i16; 4], RunLocalBuildError> {
    let narrow = |value: i32| i16::try_from(value).map_err(|_| RunLocalBuildError::InvalidSource);
    Ok([
        narrow(extents.x_min)?,
        narrow(extents.y_min)?,
        narrow(extents.x_max)?,
        narrow(extents.y_max)?,
    ])
}

/// What a derived arena took from the arena it was copied from, valid for one rebuild.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Inherited {
    /// The glyph stream is the same: font-unit ink is reused and the kernel reruns.
    Ink,
    /// Every run-local input is the same: the geometry itself is reused.
    Geometry,
}

/// One laid-out paragraph run: what inherited geometry must still match, and its blocks.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct RunRecord {
    pub cluster_start: u32,
    pub cluster_end: u32,
    pub reverse: bool,
    pub blocks: NumericBlockSpan,
}

#[derive(Default)]
pub(crate) struct RunLocalArena {
    pub(super) index: BlockIndex,
    pub(super) rows: RowLanes,
    source_words: Vec<SourceWord>,
    source_prefix: Vec<SourceWordPrefix>,
    pub(super) ink: InkUnitLanes,
    /// The paragraph's runs in layout order; empty for an arena filled by the staged writer.
    pub(super) runs: Vec<RunRecord>,
    inherited: Option<Inherited>,
    pub(super) scratch: KernelScratch,
    /// Scale spans of the paragraph run being laid out.
    pub(super) spans: Vec<ScaleSpan>,
    staged: StagedRun,
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
        self.clear_geometry();
        self.ink.clear();
        self.inherited = None;
    }

    /// Takes the inheritance recorded by `inherit`, so it serves exactly one rebuild.
    pub(super) fn take_inherited(&mut self) -> Option<Inherited> {
        self.inherited.take()
    }

    /// Copies from the arena this one's owner was derived from: the font-unit ink, and for
    /// `Geometry` everything else. The next rebuild checks that what was copied still fits.
    pub(crate) fn inherit(
        &mut self,
        previous: &Self,
        inherited: Inherited,
    ) -> Result<(), RunLocalBuildError> {
        self.clear();
        copy_lane(&mut self.ink.units, &previous.ink.units)?;
        copy_lane(&mut self.ink.outlined, &previous.ink.outlined)?;
        if inherited == Inherited::Geometry {
            copy_lane(&mut self.index.blocks, &previous.index.blocks)?;
            copy_lane(
                &mut self.index.cluster_blocks,
                &previous.index.cluster_blocks,
            )?;
            copy_lane(
                &mut self.index.cluster_prefixes,
                &previous.index.cluster_prefixes,
            )?;
            self.index.row_count = previous.index.row_count;
            #[cfg(any(test, feature = "oracle"))]
            self.index.row_order.clone_from(&previous.index.row_order);
            for (lane, from) in self.rows.lanes_mut().into_iter().zip(previous.rows.lanes()) {
                copy_lane(lane, from)?;
            }
            #[cfg(test)]
            self.rows.pen_inline.clone_from(&previous.rows.pen_inline);
            copy_lane(&mut self.source_words, &previous.source_words)?;
            copy_lane(&mut self.source_prefix, &previous.source_prefix)?;
            copy_lane(&mut self.runs, &previous.runs)?;
        }
        self.inherited = Some(inherited);
        Ok(())
    }

    /// Drops blocks, rows and the outline index; font-unit ink stays.
    pub(super) fn clear_geometry(&mut self) {
        self.index.clear();
        self.rows.clear();
        self.source_words.clear();
        self.source_prefix.clear();
        self.runs.clear();
    }

    pub(crate) fn blocks(&self) -> &[NumericBlock] {
        &self.index.blocks
    }

    /// The row lanes, indexed by source glyph. A glyph no block covers reads as zeros; ask
    /// `source_range_counts` or `next_outlined_source` which glyphs are covered.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn lanes(&self) -> RunLocalLanes<'_> {
        self.rows.view()
    }

    /// Every row in emission order, as the capture and tests read them.
    #[cfg(any(test, feature = "oracle"))]
    pub(crate) fn rows(&self) -> Vec<RunLocalGlyph> {
        self.index
            .row_order
            .iter()
            .filter_map(|source| self.row_for_source_glyph(*source))
            .collect()
    }

    pub(crate) fn row_for_source_glyph(&self, source_glyph: u32) -> Option<RunLocalGlyph> {
        let glyph = usize::try_from(source_glyph).ok()?;
        let word = self.source_words.get(glyph / 64)?;
        let bit = 1_u64 << (glyph % 64);
        if word.covered & bit == 0 {
            return None;
        }
        let origin = RowOrigin {
            #[cfg(test)]
            source_glyph,
            #[cfg(test)]
            block_index: self.index.blocks.iter().position(|block| {
                (block.source_glyph_start..block.source_glyph_start + block.source_glyph_count)
                    .contains(&source_glyph)
            })? as u32,
        };
        self.rows.row(glyph, word.outlined & bit != 0, origin)
    }

    /// Marks `count` glyphs from `start` as owned by a block. A glyph owned twice is a broken
    /// producer.
    fn cover(&mut self, start: usize, count: usize) -> Result<(), RunLocalBuildError> {
        let end = start + count;
        let words = end.div_ceil(64);
        if self.source_words.len() < words {
            let missing = words - self.source_words.len();
            reserve(&mut self.source_words, missing)?;
            self.source_words.resize(words, SourceWord::default());
        }
        let mut cursor = start;
        while cursor < end {
            let offset = cursor % 64;
            let width = (64 - offset).min(end - cursor);
            let mask = (u64::MAX >> (64 - width)) << offset;
            let word = &mut self.source_words[cursor / 64];
            if word.covered & mask != 0 {
                return Err(RunLocalBuildError::InvalidSource);
            }
            word.covered |= mask;
            cursor += width;
        }
        Ok(())
    }

    /// Covers the glyph range of every block from `first_block`: the paragraph's rows are
    /// already at their source index.
    pub(super) fn cover_blocks(&mut self, first_block: usize) -> Result<(), RunLocalBuildError> {
        for block in first_block..self.index.blocks.len() {
            let NumericBlock {
                source_glyph_start,
                source_glyph_count,
                ..
            } = self.index.blocks[block];
            self.cover(source_glyph_start as usize, source_glyph_count as usize)?;
        }
        Ok(())
    }

    /// Finishes a paragraph build: a covered glyph is outlined when the font-unit ink says so.
    pub(super) fn finalize_paragraph_ranks(&mut self) -> Result<(), RunLocalBuildError> {
        for (word, outlined) in self.source_words.iter_mut().zip(&self.ink.outlined) {
            word.outlined = word.covered & outlined;
        }
        self.finalize_source_ranks()
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
            || self_end > u32::try_from(self.rows.len()).ok()?
            || other_end > u32::try_from(other.rows.len()).ok()?
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

    pub(crate) fn cluster_blocks(&self) -> &[u32] {
        &self.index.cluster_blocks
    }

    pub(crate) fn cluster_prefixes(&self) -> &[f64] {
        &self.index.cluster_prefixes
    }

    pub(crate) fn begin_run(&mut self) -> RunLocalBlockWriter<GeneralSink<'_>> {
        RunLocalBlockWriter::new(GeneralSink(self))
    }
}

/// Where a staged run's rows go once the kernel has laid them out.
pub(crate) trait RunLocalBlockSink {
    fn take_staged(&mut self) -> StagedRun;
    fn recycle_staged(&mut self, staged: StagedRun);
    fn kernel(&mut self) -> (&mut BlockIndex, &mut KernelScratch);
    /// Moves the rows of the blocks from `first_block` out of `staged` and rewrites those
    /// blocks' glyph ranges from staged order to source glyphs.
    fn commit(&mut self, staged: &StagedRun, first_block: usize) -> Result<(), RunLocalBuildError>;
}

pub(crate) struct GeneralSink<'a>(&'a mut RunLocalArena);

/// The bounded producer stores final local rows at source indices. It carries no
/// General source bitsets or rank prefix.
pub(crate) struct RunLocalCompact<T> {
    index: BlockIndex,
    rows: Vec<Option<T>>,
    scratch: KernelScratch,
    staged: StagedRun,
}

impl<T> Default for RunLocalCompact<T> {
    fn default() -> Self {
        Self {
            index: BlockIndex::default(),
            rows: Vec::new(),
            scratch: KernelScratch::default(),
            staged: StagedRun::default(),
        }
    }
}

impl<T> RunLocalCompact<T> {
    pub(crate) fn clear(&mut self) {
        self.index.clear();
        self.rows.clear();
    }

    /// The mapper writes the final leaf row from the kernel's lanes. The compact store itself
    /// is that row owner; production must not keep a second row array beside it.
    pub(crate) fn begin_run<F>(&mut self, map: F) -> RunLocalBlockWriter<CompactSink<'_, T, F>>
    where
        F: FnMut(u32, u32, RunLocalGlyph) -> Result<T, RunLocalBuildError>,
    {
        RunLocalBlockWriter::new(CompactSink { compact: self, map })
    }

    pub(crate) fn blocks(&self) -> &[NumericBlock] {
        &self.index.blocks
    }

    pub(crate) fn cluster_blocks(&self) -> &[u32] {
        &self.index.cluster_blocks
    }

    pub(crate) fn cluster_prefixes(&self) -> &[f64] {
        &self.index.cluster_prefixes
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

/// One run handed over glyph by glyph, staged as the kernel's lanes: glyphs in push order with
/// their source glyph, clusters in visit order.
#[derive(Default)]
pub(crate) struct StagedRun {
    source: Vec<u32>,
    inline_advance: Vec<i32>,
    inline_offset: Vec<i32>,
    block_offset: Vec<i32>,
    ink: Vec<[i16; 4]>,
    outlined: Vec<bool>,
    spans: Vec<ScaleSpan>,
    glyph_starts: Vec<u32>,
    glyph_counts: Vec<u32>,
    detached: Vec<u8>,
    /// The resync advance, or the letter spacing of a continuing cluster.
    end_first: Vec<f64>,
    /// The word spacing of a continuing cluster; zero when it has none.
    end_second: Vec<f64>,
    /// Whether the run's clusters resynchronize; one run ends its clusters one way.
    resync: Option<bool>,
    /// First staged glyph of the open cluster.
    open_cluster: Option<u32>,
    /// The kernel's rows for the staged glyphs, in push order.
    rows: RowLanes,
}

impl StagedRun {
    fn clear(&mut self) {
        self.source.clear();
        self.inline_advance.clear();
        self.inline_offset.clear();
        self.block_offset.clear();
        self.ink.clear();
        self.outlined.clear();
        self.spans.clear();
        self.glyph_starts.clear();
        self.glyph_counts.clear();
        self.detached.clear();
        self.end_first.clear();
        self.end_second.clear();
        self.resync = None;
        self.open_cluster = None;
        self.rows.clear();
    }

    fn glyph_count(&self) -> Result<u32, RunLocalBuildError> {
        u32::try_from(self.source.len()).map_err(|_| RunLocalBuildError::AllocationFailed)
    }

    fn push_cluster(
        &mut self,
        glyph_start: u32,
        detached: bool,
        (end_first, end_second): (f64, f64),
    ) -> Result<(), RunLocalBuildError> {
        let glyph_count = self.glyph_count()? - glyph_start;
        if self.glyph_starts.len() == self.glyph_starts.capacity() {
            // One growth decision for the five cluster lanes, which fill together.
            let more = self.glyph_starts.len().max(LAYOUT_CHUNK);
            reserve(&mut self.glyph_starts, more)?;
            reserve(&mut self.glyph_counts, more)?;
            reserve(&mut self.detached, more)?;
            reserve(&mut self.end_first, more)?;
            reserve(&mut self.end_second, more)?;
        }
        self.glyph_starts.push(glyph_start);
        self.glyph_counts.push(glyph_count);
        self.detached.push(u8::from(detached));
        self.end_first.push(end_first);
        self.end_second.push(end_second);
        Ok(())
    }

    fn push_glyph(&mut self, input: RunLocalGlyphInput) -> Result<(), RunLocalBuildError> {
        let ink = input.outline.map(ink_units).transpose()?;
        if self.source.len() == self.source.capacity() {
            // One growth decision for the six glyph lanes, which fill together.
            let more = self.source.len().max(LAYOUT_CHUNK);
            reserve(&mut self.source, more)?;
            reserve(&mut self.inline_advance, more)?;
            reserve(&mut self.inline_offset, more)?;
            reserve(&mut self.block_offset, more)?;
            reserve(&mut self.ink, more)?;
            reserve(&mut self.outlined, more)?;
        }
        self.source.push(input.source_glyph);
        self.inline_advance.push(input.x_advance);
        self.inline_offset.push(input.x_offset);
        self.block_offset.push(input.y_offset);
        self.ink.push(ink.unwrap_or_default());
        self.outlined.push(ink.is_some());
        let glyph_end = self.glyph_count()?;
        let baseline_shift = f64::from(input.baseline_shift);
        match self.spans.last_mut() {
            Some(span)
                if span.scale.to_bits() == input.scale.to_bits()
                    && span.baseline_shift.to_bits() == baseline_shift.to_bits() =>
            {
                span.glyph_end = glyph_end;
            }
            _ => {
                reserve(&mut self.spans, 1)?;
                self.spans.push(ScaleSpan {
                    glyph_end,
                    scale: input.scale,
                    baseline_shift,
                });
            }
        }
        Ok(())
    }

    /// Runs the kernel over the staged lanes into `self.rows`.
    fn layout(
        &mut self,
        index: &mut BlockIndex,
        scratch: &mut KernelScratch,
    ) -> Result<NumericBlockSpan, RunLocalBuildError> {
        let mut rows = core::mem::take(&mut self.rows);
        let result = rows.grow(self.source.len()).and_then(|()| {
            layout_run(
                index,
                &mut rows,
                scratch,
                &RunInput {
                    units: GlyphUnits {
                        inline_advance: &self.inline_advance,
                        inline_offset: &self.inline_offset,
                        block_offset: &self.block_offset,
                        ink: &self.ink,
                    },
                    spans: &self.spans,
                    clusters: ClusterLanes {
                        glyph_starts: &self.glyph_starts,
                        glyph_counts: &self.glyph_counts,
                        flags: &self.detached,
                        detached_mask: 1,
                        end: if self.resync == Some(false) {
                            ClusterEnd::Continue {
                                letter: &self.end_first,
                                word: &self.end_second,
                            }
                        } else {
                            ClusterEnd::Resync(&self.end_first)
                        },
                    },
                    cluster_start: 0,
                    cluster_end: self.glyph_starts.len(),
                    reverse: false,
                    cut: LAYOUT_CUT,
                },
            )
        });
        self.rows = rows;
        result
    }

    /// The staged rows of `block`, whose glyph range is still in staged order.
    fn block_rows(block: &NumericBlock) -> Range<usize> {
        let start = block.source_glyph_start as usize;
        start..start + block.source_glyph_count as usize
    }

    fn row(&self, staged: usize, block_index: usize) -> Option<RunLocalGlyph> {
        #[cfg(not(test))]
        let _ = block_index;
        self.rows.row(
            staged,
            *self.outlined.get(staged)?,
            RowOrigin {
                #[cfg(test)]
                source_glyph: *self.source.get(staged)?,
                #[cfg(test)]
                block_index: block_index as u32,
            },
        )
    }
}

/// Rewrites a block's glyph range from staged order to the source glyphs its rows landed on.
fn rebase_block(block: &mut NumericBlock, sources: &[u32]) -> Result<(), RunLocalBuildError> {
    let start = sources.iter().copied().min().unwrap_or(0);
    let end = sources
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or(RunLocalBuildError::AllocationFailed)?;
    block.source_glyph_start = start;
    block.source_glyph_count = end - start;
    Ok(())
}

pub(crate) struct RunLocalBlockWriter<S: RunLocalBlockSink> {
    sink: S,
    staged: StagedRun,
}

impl<S: RunLocalBlockSink> RunLocalBlockWriter<S> {
    fn new(mut sink: S) -> Self {
        let mut staged = sink.take_staged();
        staged.clear();
        Self { sink, staged }
    }

    pub(crate) fn begin_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if self.staged.open_cluster.is_some() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.staged.open_cluster = Some(self.staged.glyph_count()?);
        Ok(())
    }

    /// Production detaches clusters through the paragraph's flag lane; tests stage them.
    #[cfg(test)]
    pub(crate) fn push_detached_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if self.staged.open_cluster.is_some() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        let glyph_start = self.staged.glyph_count()?;
        self.staged.push_cluster(glyph_start, true, (0.0, 0.0))
    }

    pub(crate) fn push_glyph(
        &mut self,
        input: RunLocalGlyphInput,
    ) -> Result<(), RunLocalBuildError> {
        if self.staged.open_cluster.is_none() || !input.scale.is_finite() || input.scale <= 0.0 {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.staged.push_glyph(input)
    }

    pub(crate) fn finish_cluster(
        &mut self,
        finish: ClusterFinish,
    ) -> Result<(), RunLocalBuildError> {
        let glyph_start = self
            .staged
            .open_cluster
            .take()
            .ok_or(RunLocalBuildError::InvalidSource)?;
        let (resync, end) = match finish {
            ClusterFinish::Resync(advance) => (true, (advance, 0.0)),
            ClusterFinish::Continue {
                letter_spacing,
                word_spacing,
            } => (
                false,
                (
                    f64::from(letter_spacing),
                    // The pen is never negative zero, so adding no word spacing is exact.
                    word_spacing.map_or(0.0, f64::from),
                ),
            ),
        };
        if *self.staged.resync.get_or_insert(resync) != resync {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.staged.push_cluster(glyph_start, false, end)
    }

    /// Lays the staged run out. Geometry the kernel rejects is reported here, not by the call
    /// that staged it.
    pub(crate) fn finish(mut self) -> Result<NumericBlockSpan, RunLocalBuildError> {
        if self.staged.open_cluster.is_some() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        let (index, scratch) = self.sink.kernel();
        let first_block = index.blocks.len();
        let span = self.staged.layout(index, scratch)?;
        self.sink.commit(&self.staged, first_block)?;
        Ok(span)
    }
}

impl<S: RunLocalBlockSink> Drop for RunLocalBlockWriter<S> {
    fn drop(&mut self) {
        self.sink.recycle_staged(core::mem::take(&mut self.staged));
    }
}

impl RunLocalBlockSink for GeneralSink<'_> {
    fn take_staged(&mut self) -> StagedRun {
        core::mem::take(&mut self.0.staged)
    }

    fn recycle_staged(&mut self, staged: StagedRun) {
        self.0.staged = staged;
    }

    fn kernel(&mut self) -> (&mut BlockIndex, &mut KernelScratch) {
        (&mut self.0.index, &mut self.0.scratch)
    }

    fn commit(&mut self, staged: &StagedRun, first_block: usize) -> Result<(), RunLocalBuildError> {
        let arena = &mut *self.0;
        #[cfg(any(test, feature = "oracle"))]
        {
            let run_rows: usize = arena.index.blocks[first_block..]
                .iter()
                .map(|block| block.row_count as usize)
                .sum();
            let first_row = arena.index.row_order.len() - run_rows;
            for row in &mut arena.index.row_order[first_row..] {
                *row = staged.source[*row as usize];
            }
        }
        for block in first_block..arena.index.blocks.len() {
            let rows = StagedRun::block_rows(&arena.index.blocks[block]);
            for row in rows.clone() {
                let source = staged.source[row] as usize;
                arena.rows.grow(source + 1)?;
                arena.cover(source, 1)?;
                if staged.outlined[row] {
                    arena.source_words[source / 64].outlined |= 1 << (source % 64);
                }
                arena.rows.copy_row(source, &staged.rows, row);
            }
            rebase_block(&mut arena.index.blocks[block], &staged.source[rows])?;
        }
        Ok(())
    }
}

impl<T, F> RunLocalBlockSink for CompactSink<'_, T, F>
where
    F: FnMut(u32, u32, RunLocalGlyph) -> Result<T, RunLocalBuildError>,
{
    fn take_staged(&mut self) -> StagedRun {
        core::mem::take(&mut self.compact.staged)
    }

    fn recycle_staged(&mut self, staged: StagedRun) {
        self.compact.staged = staged;
    }

    fn kernel(&mut self) -> (&mut BlockIndex, &mut KernelScratch) {
        (&mut self.compact.index, &mut self.compact.scratch)
    }

    fn commit(&mut self, staged: &StagedRun, first_block: usize) -> Result<(), RunLocalBuildError> {
        let compact = &mut *self.compact;
        // The leaf is one layout chunk: more clusters or rows than that belong to General.
        if compact.index.cluster_blocks.len() > LAYOUT_CHUNK
            || compact.index.row_count as usize > LAYOUT_CHUNK
        {
            return Err(RunLocalBuildError::InvalidSource);
        }
        for block in first_block..compact.index.blocks.len() {
            let rows = StagedRun::block_rows(&compact.index.blocks[block]);
            for row in rows.clone() {
                let source = staged.source[row];
                let slot = source as usize;
                if slot >= LAYOUT_CHUNK {
                    return Err(RunLocalBuildError::InvalidSource);
                }
                if compact.rows.len() <= slot {
                    let missing = slot + 1 - compact.rows.len();
                    reserve(&mut compact.rows, missing)?;
                    compact.rows.resize_with(slot + 1, || None);
                }
                if compact.rows[slot].is_some() {
                    return Err(RunLocalBuildError::InvalidSource);
                }
                let local = staged
                    .row(row, block)
                    .ok_or(RunLocalBuildError::InvalidSource)?;
                compact.rows[slot] = Some((self.map)(source, block as u32, local)?);
            }
            rebase_block(&mut compact.index.blocks[block], &staged.source[rows])?;
        }
        Ok(())
    }
}

fn copy_lane<T: Copy>(lane: &mut Vec<T>, source: &[T]) -> Result<(), RunLocalBuildError> {
    lane.clear();
    reserve(lane, source.len())?;
    lane.extend_from_slice(source);
    Ok(())
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
        writer
            .finish_cluster(ClusterFinish::Resync(20_000.0))
            .unwrap();
        assert_eq!(
            writer.finish(),
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
                    x_min: i32::from(i16::MIN),
                    y_min: i32::from(i16::MIN),
                    x_max: i32::from(i16::MAX),
                    y_max: i32::from(i16::MAX),
                }),
            })
            .unwrap();
        writer.finish_cluster(ClusterFinish::Resync(0.0)).unwrap();
        writer.finish().unwrap();

        // 65,535 units: the difference is taken after widening, not in i16.
        assert_eq!(arena.rows()[0].ink_inline_extent, 0.065_535);
        assert_eq!(arena.rows()[0].ink_block_extent, 0.065_535);
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
        assert_eq!(arena.row_for_source_glyph(2).unwrap().source_glyph, 2);
        assert_eq!(arena.row_for_source_glyph(3).unwrap().source_glyph, 3);
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

    #[test]
    fn a_reversed_run_over_borrowed_lanes_equals_the_same_clusters_staged_in_visit_order() {
        // Three clusters owning glyphs 0..2, 2..3 and 3..5, visited last to first.
        let advances = [300, -200, 500, 250, 125];
        let offsets = [10, -20, 0, 5, -5];
        let rises = [0, 40, -30, 0, 15];
        let ink = [
            [5, -10, 280, 600],
            [0; 4],
            [-20, -200, 480, 700],
            [0, 0, 240, 500],
            [0; 4],
        ];
        let (starts, counts) = ([0, 2, 3], [2, 1, 2]);
        let cluster_advances = [12.5, 31.25, 23.0];
        let spans = [
            ScaleSpan {
                glyph_end: 3,
                scale: 23.7 / 1000.0,
                baseline_shift: 1.5,
            },
            ScaleSpan {
                glyph_end: 5,
                scale: 11.0 / 2048.0,
                baseline_shift: 0.0,
            },
        ];
        let mut borrowed = RunLocalArena::default();
        borrowed.rows.grow(5).unwrap();
        let span = layout_run(
            &mut borrowed.index,
            &mut borrowed.rows,
            &mut borrowed.scratch,
            &RunInput {
                units: GlyphUnits {
                    inline_advance: &advances,
                    inline_offset: &offsets,
                    block_offset: &rises,
                    ink: &ink,
                },
                spans: &spans,
                clusters: ClusterLanes {
                    glyph_starts: &starts,
                    glyph_counts: &counts,
                    flags: &[0; 3],
                    detached_mask: 1,
                    end: ClusterEnd::Resync(&cluster_advances),
                },
                cluster_start: 0,
                cluster_end: 3,
                reverse: true,
                cut: LAYOUT_CUT,
            },
        )
        .unwrap();
        borrowed.cover_blocks(0).unwrap();

        let mut staged = RunLocalArena::default();
        let mut writer = staged.begin_run();
        for cluster in (0..3).rev() {
            writer.begin_cluster().unwrap();
            for glyph in starts[cluster]..starts[cluster] + counts[cluster] {
                let span = spans[usize::from(glyph >= 3)];
                let [x_min, y_min, x_max, y_max] = ink[glyph as usize].map(i32::from);
                writer
                    .push_glyph(RunLocalGlyphInput {
                        source_glyph: glyph,
                        x_advance: advances[glyph as usize],
                        x_offset: offsets[glyph as usize],
                        y_offset: rises[glyph as usize],
                        baseline_shift: span.baseline_shift as f32,
                        scale: span.scale,
                        outline: (ink[glyph as usize] != [0; 4]).then_some(FontGlyphExtents {
                            x_min,
                            y_min,
                            x_max,
                            y_max,
                        }),
                    })
                    .unwrap();
            }
            writer
                .finish_cluster(ClusterFinish::Resync(cluster_advances[cluster]))
                .unwrap();
        }
        assert_eq!(writer.finish().unwrap(), span);

        assert_eq!(borrowed.blocks(), staged.blocks());
        assert_eq!(borrowed.blocks()[0].source_glyph_count, 5);
        assert_eq!(borrowed.cluster_prefixes(), staged.cluster_prefixes());
        assert_eq!(borrowed.cluster_prefixes(), [0.0, 23.0, 54.25]);
        assert_eq!(borrowed.index.row_order, [3, 4, 2, 0, 1]);
        assert_eq!(borrowed.index.row_order, staged.index.row_order);
        let lanes = borrowed.lanes();
        for glyph in 0..5 {
            let mut row = borrowed.row_for_source_glyph(glyph).unwrap();
            let staged_row = staged.row_for_source_glyph(glyph).unwrap();
            // Borrowed ink lanes carry no outline bit; the paragraph adds it when it finishes.
            row.has_outline = staged_row.has_outline;
            assert_eq!(
                format!("{row:?}"),
                format!("{staged_row:?}"),
                "glyph {glyph}"
            );
            assert_eq!(lanes.inline_origin[glyph as usize], row.inline_origin);
            assert_eq!(lanes.ink_block_extent[glyph as usize], row.ink_block_extent);
        }
    }
}
