//! Break-independent numeric blocks and retained run-local glyph geometry.

use alloc::vec::Vec;

use crate::FontGlyphExtents;

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
    pub source_glyph: u32,
    pub block_index: u32,
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
    cluster_blocks: Vec<u32>,
    cluster_prefixes: Vec<f64>,
    pending_block_rows: Vec<PendingGlyph>,
    pending_cluster_rows: Vec<RawGlyph>,
    pending_block_clusters: Vec<PendingCluster>,
}

impl RunLocalArena {
    pub(crate) fn clear(&mut self) {
        self.blocks.clear();
        self.rows.clear();
        self.source_rows.clear();
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

    pub(crate) fn row_for_source_glyph(&self, source_glyph: u32) -> Option<RunLocalGlyph> {
        let row = *self.source_rows.get(usize::try_from(source_glyph).ok()?)?;
        self.rows.get(usize::try_from(row).ok()?).copied()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn cluster_blocks(&self) -> &[u32] {
        &self.cluster_blocks
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn cluster_prefixes(&self) -> &[f64] {
        &self.cluster_prefixes
    }

    pub(crate) fn begin_run(&mut self) -> RunLocalWriter<'_> {
        self.pending_block_rows.clear();
        self.pending_cluster_rows.clear();
        self.pending_block_clusters.clear();
        let first_block = self.blocks.len();
        let first_cluster = self.cluster_blocks.len();
        RunLocalWriter {
            arena: self,
            first_block,
            first_cluster,
            block_cursor: 0.0,
            block_envelope: None,
            cluster_open: false,
        }
    }
}

pub(crate) struct RunLocalWriter<'a> {
    arena: &'a mut RunLocalArena,
    first_block: usize,
    first_cluster: usize,
    block_cursor: f64,
    block_envelope: Option<Envelope>,
    cluster_open: bool,
}

impl RunLocalWriter<'_> {
    pub(crate) fn begin_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if !self.arena.pending_cluster_rows.is_empty() || self.cluster_open {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.cluster_open = true;
        Ok(())
    }

    pub(crate) fn push_detached_cluster(&mut self) -> Result<(), RunLocalBuildError> {
        if self.cluster_open || !self.arena.pending_cluster_rows.is_empty() {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.finalize_block()?;
        reserve(&mut self.arena.cluster_blocks, 1)?;
        reserve(&mut self.arena.cluster_prefixes, 1)?;
        self.arena.cluster_blocks.push(u32::MAX);
        self.arena.cluster_prefixes.push(0.0);
        Ok(())
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
        reserve(&mut self.arena.pending_cluster_rows, 1)?;
        self.arena.pending_cluster_rows.push(RawGlyph {
            source_glyph: input.source_glyph,
            raw_advance: advance,
            x_offset,
            block_origin,
            inline_advance: advance,
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
        if self.arena.pending_cluster_rows.is_empty() {
            if combined.admitted() {
                self.block_envelope = Some(combined);
                reserve(&mut self.arena.pending_block_clusters, 1)?;
                self.arena.pending_block_clusters.push(PendingCluster {
                    block_local_prefix: self.block_cursor,
                });
                self.block_cursor =
                    replay_finish_cursor(self.block_cursor, self.block_cursor, finish)?;
            } else if self.arena.pending_block_rows.is_empty() {
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
        reserve(&mut self.arena.pending_block_clusters, 1)?;
        self.arena.pending_block_clusters.push(PendingCluster {
            block_local_prefix: self.block_cursor,
        });
        reserve(
            &mut self.arena.pending_block_rows,
            self.arena.pending_cluster_rows.len(),
        )?;
        let cluster_root = self.block_cursor;
        let mut replay_cursor = cluster_root;
        for row in self.arena.pending_cluster_rows.drain(..) {
            self.arena
                .pending_block_rows
                .push(row.place(&mut replay_cursor)?);
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
        for row in &self.arena.pending_cluster_rows {
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
        if !self.arena.pending_cluster_rows.is_empty() || self.cluster_open {
            return Err(RunLocalBuildError::InvalidSource);
        }
        self.finalize_block()?;
        let count = self
            .arena
            .blocks
            .len()
            .checked_sub(self.first_block)
            .ok_or(RunLocalBuildError::InvalidSource)?;
        Ok(NumericBlockSpan {
            start: u32::try_from(self.first_block)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?,
            count: u32::try_from(count).map_err(|_| RunLocalBuildError::AllocationFailed)?,
            cluster_start: u32::try_from(self.first_cluster)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?,
            cluster_count: u32::try_from(
                self.arena
                    .cluster_blocks
                    .len()
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
        if self.arena.pending_block_rows.is_empty() {
            for _ in self.arena.pending_block_clusters.drain(..) {
                reserve(&mut self.arena.cluster_blocks, 1)?;
                reserve(&mut self.arena.cluster_prefixes, 1)?;
                self.arena.cluster_blocks.push(u32::MAX);
                self.arena.cluster_prefixes.push(0.0);
            }
            self.block_cursor = 0.0;
            return Ok(());
        }
        if !envelope.admitted() {
            return Err(RunLocalBuildError::LocalGeometryOutOfRange);
        }
        let anchor_inline = envelope.midpoint_inline()?;
        let anchor_block = envelope.midpoint_block()?;
        let block_index = u32::try_from(self.arena.blocks.len())
            .map_err(|_| RunLocalBuildError::AllocationFailed)?;
        let row_start = u32::try_from(self.arena.rows.len())
            .map_err(|_| RunLocalBuildError::AllocationFailed)?;
        reserve(&mut self.arena.rows, self.arena.pending_block_rows.len())?;
        let mut source_glyph_start = u32::MAX;
        let mut source_glyph_end = 0_u32;
        for row in self.arena.pending_block_rows.drain(..) {
            source_glyph_start = source_glyph_start.min(row.source_glyph);
            source_glyph_end = source_glyph_end.max(
                row.source_glyph
                    .checked_add(1)
                    .ok_or(RunLocalBuildError::AllocationFailed)?,
            );
            let source_glyph = usize::try_from(row.source_glyph)
                .map_err(|_| RunLocalBuildError::AllocationFailed)?;
            if self.arena.source_rows.len() <= source_glyph {
                let additional = source_glyph + 1 - self.arena.source_rows.len();
                reserve(&mut self.arena.source_rows, additional)?;
                self.arena.source_rows.resize(source_glyph + 1, u32::MAX);
            }
            if self.arena.source_rows[source_glyph] != u32::MAX {
                return Err(RunLocalBuildError::InvalidSource);
            }
            let row_index = u32::try_from(self.arena.rows.len())
                .map_err(|_| RunLocalBuildError::AllocationFailed)?;
            self.arena.source_rows[source_glyph] = row_index;
            self.arena
                .rows
                .push(row.finish(block_index, anchor_inline, anchor_block)?);
        }
        let row_count = u32::try_from(self.arena.rows.len())
            .map_err(|_| RunLocalBuildError::AllocationFailed)?
            .checked_sub(row_start)
            .ok_or(RunLocalBuildError::InvalidSource)?;
        reserve(
            &mut self.arena.cluster_blocks,
            self.arena.pending_block_clusters.len(),
        )?;
        reserve(
            &mut self.arena.cluster_prefixes,
            self.arena.pending_block_clusters.len(),
        )?;
        for cluster in self.arena.pending_block_clusters.drain(..) {
            self.arena.cluster_blocks.push(block_index);
            self.arena.cluster_prefixes.push(cluster.block_local_prefix);
        }
        reserve(&mut self.arena.blocks, 1)?;
        self.arena.blocks.push(NumericBlock {
            source_glyph_start,
            source_glyph_count: source_glyph_end
                .checked_sub(source_glyph_start)
                .ok_or(RunLocalBuildError::InvalidSource)?,
            row_start,
            row_count,
            anchor_inline,
            anchor_block,
        });
        self.block_cursor = 0.0;
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct RawGlyph {
    source_glyph: u32,
    raw_advance: f64,
    x_offset: f64,
    block_origin: f64,
    inline_advance: f64,
    ink_inline_offset: f64,
    ink_block_start: f64,
    ink_inline_extent: f64,
    ink_block_extent: f64,
    has_outline: bool,
}

#[derive(Clone, Copy)]
struct PendingGlyph {
    source_glyph: u32,
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
struct PendingCluster {
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
            pen_inline,
            inline_origin,
            block_origin: self.block_origin,
            inline_advance: self.inline_advance,
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
        Ok(RunLocalGlyph {
            source_glyph: self.source_glyph,
            block_index,
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
struct Envelope {
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
            inline_advance: raw_advance,
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
                count: 1,
                cluster_start: 0,
                cluster_count: 4_096,
            }
        );
        assert_eq!(arena.blocks()[0].row_count, 4_096);
        assert_eq!(arena.rows().len(), 4_096);
        assert_eq!(arena.rows()[4_095].source_glyph, 4_095);
        assert_eq!(arena.rows()[4_095].pen_inline, 4_095.0);
    }
}
