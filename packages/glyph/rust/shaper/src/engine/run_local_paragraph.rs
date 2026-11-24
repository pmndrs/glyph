//! The paragraph's client of the run-local kernel.
//!
//! The cluster arena already holds everything the kernel reads, in cluster order: the glyph
//! stream in font units, the cluster lanes and, here, the font-unit ink beside them. A build
//! therefore hands the kernel borrowed lanes; nothing is copied or looked up per glyph except
//! the ink of a glyph stream this arena has not seen.
//!
//! Three change classes reach `rebuild`:
//!
//! - a new glyph stream (cold build, edit, reshape): ink is read from the font once, then the
//!   kernel runs;
//! - a metric change (font size, letter or word spacing, baseline shift) over the same glyph
//!   stream: the arena inherited its ink, so the kernel reruns from font units and the font
//!   registry is never asked. The result is the cold build's, bit for bit, because it is the
//!   same kernel over the same lanes;
//! - a change that touches no run-local input (line height, span boundaries): the arena
//!   inherited the geometry itself and nothing runs.
//!
//! A new glyph stream that keeps a leading stretch of the previous one (an edit) also starts
//! from the previous geometry: every block before the first cluster the kernel would read
//! differently, cut back to a block boundary, is copied, and the kernel resumes there.

use crate::cold_growth::ColdGrowth as _;

use alloc::vec::Vec;

use crate::FontGlyphExtents;

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, ClusterArena, LayoutRun},
    run_local::{
        GeometryPrefix, Inherited, InkUnitLanes, LAYOUT_CUT, NumericBlockSpan, RunLocalArena,
        RunLocalBuildError, RunRecord,
    },
    run_local_kernel::{
        ClusterEnd, ClusterLanes, GlyphUnits, RunInput, RunResume, ScaleSpan, layout_run_from,
    },
    shaping_state::ShapingRun,
    style_state::StyleSegment,
};

/// The arena a rebuild may start from: the committed clusters, their geometry and the styles
/// they were laid out with.
#[derive(Clone, Copy)]
pub(crate) struct PreviousGeometry<'a> {
    pub clusters: &'a ClusterArena,
    pub styles: &'a [StyleSegment],
}

/// Rebuilds `run_local` for `clusters` and records each layout run's block span. On failure
/// the arena is left empty and no run names a block.
pub(crate) fn rebuild(
    run_local: &mut RunLocalArena,
    layout_runs: &mut [LayoutRun],
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    previous: Option<PreviousGeometry<'_>>,
) -> Result<(), EngineError> {
    let glyphs = clusters.glyph_ids.len();
    let inherited = run_local.take_inherited();
    if inherited == Some(Inherited::Geometry)
        && inherit_geometry(run_local, layout_runs, runs, glyphs)
    {
        return Ok(());
    }
    let keep_ink = inherited == Some(Inherited::Ink) && run_local.ink.units().len() == glyphs;
    run_local.clear_geometry();
    for run in layout_runs.iter_mut() {
        run.numeric_blocks = NumericBlockSpan::default();
    }
    let result = (|| {
        if !keep_ink {
            fill_ink(&mut run_local.ink, clusters, extents_for)?;
        }
        run_local.rows.grow(glyphs).map_err(error)?;
        let start = match previous {
            Some(previous) => {
                adopt_prefix(run_local, layout_runs, clusters, runs, styles, previous)?
            }
            None => Start::default(),
        };
        for (index, run) in layout_runs.iter_mut().enumerate().skip(start.run) {
            let resume = (index == start.run).then_some(start.resume).flatten();
            run.numeric_blocks = layout(run_local, *run, clusters, runs, styles, resume)?;
        }
        run_local.finalize_paragraph_ranks().map_err(error)
    })();
    if result.is_err() {
        run_local.clear();
        for run in layout_runs.iter_mut() {
            run.numeric_blocks = NumericBlockSpan::default();
        }
    }
    result
}

/// Clusters a cluster splice rebuilt: `[start, end)` here. The clusters and glyphs after it,
/// up to the next window, moved by `cluster_delta` and `glyph_delta` from the previous arena.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RunLocalWindow {
    pub start: usize,
    pub end: usize,
    pub cluster_delta: i64,
    pub glyph_delta: i64,
}

/// The windows of a cluster splice, ascending.
#[derive(Clone, Debug)]
pub(crate) struct RunLocalSplice {
    pub windows: Vec<RunLocalWindow>,
}

impl RunLocalSplice {
    /// How far the clusters and glyphs before window `index` moved.
    fn shift_before(&self, index: usize) -> (i64, i64) {
        index
            .checked_sub(1)
            .and_then(|before| self.windows.get(before))
            .map_or((0, 0), |window| (window.cluster_delta, window.glyph_delta))
    }
}

/// `rebuild` after a cluster splice, reusing `previous`'s geometry where its inputs are
/// unchanged. A block's rows depend only on its own clusters, and blocks are cut at multiples
/// of the cut rule's cluster count from their run's first cluster, so a run before the rebuilt
/// clusters keeps its blocks, a run after them keeps its blocks moved, and a left-to-right run
/// that starts before them keeps the blocks of every whole chunk before them. The rest is laid
/// out by the kernel, exactly as `rebuild` lays it out.
#[allow(clippy::too_many_arguments)]
pub(crate) fn rebuild_spliced(
    run_local: &mut RunLocalArena,
    layout_runs: &mut [LayoutRun],
    clusters: &ClusterArena,
    previous: PreviousGeometry<'_>,
    splice: &RunLocalSplice,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    let glyphs = clusters.glyph_ids.len();
    if !run_local.inherits_ink() || run_local.ink.units().len() != glyphs {
        return rebuild(
            run_local,
            layout_runs,
            clusters,
            runs,
            styles,
            extents_for,
            Some(previous),
        );
    }
    let previous = &previous.clusters.run_local;
    run_local.take_inherited();
    run_local.clear_geometry();
    for run in layout_runs.iter_mut() {
        run.numeric_blocks = NumericBlockSpan::default();
    }
    let result = (|| {
        run_local.rows.grow(glyphs).map_err(error)?;
        for run in layout_runs.iter_mut() {
            run.numeric_blocks =
                layout_retained(run_local, *run, clusters, previous, splice, runs, styles)?;
        }
        run_local.finalize_paragraph_ranks().map_err(error)
    })();
    if result.is_err() {
        run_local.clear();
        for run in layout_runs.iter_mut() {
            run.numeric_blocks = NumericBlockSpan::default();
        }
    }
    result
}

/// One run of a spliced rebuild: copied, moved, completed after a copied prefix, or laid out.
fn layout_retained(
    run_local: &mut RunLocalArena,
    run: LayoutRun,
    clusters: &ClusterArena,
    previous: &RunLocalArena,
    splice: &RunLocalSplice,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
) -> Result<NumericBlockSpan, EngineError> {
    let reverse = direction(run, runs)? & 1 != 0;
    let (start, end) = (run.cluster_start as usize, run.cluster_end as usize);
    let record = |cluster_start: i64| {
        let at = previous
            .runs
            .partition_point(|record| i64::from(record.cluster_start) < cluster_start);
        previous
            .runs
            .get(at)
            .filter(|record| {
                i64::from(record.cluster_start) == cluster_start && record.reverse == reverse
            })
            .copied()
    };
    // The first window the run reaches, and the last one it touches.
    let first = splice.windows.partition_point(|window| window.end <= start);
    let last = splice.windows.partition_point(|window| window.start < end);
    let (cluster_delta, glyph_delta) = splice.shift_before(first);
    if first >= last {
        // Between two windows: the previous run, moved.
        let moved = record(start as i64 - cluster_delta)
            .filter(|record| i64::from(record.cluster_end) + cluster_delta == end as i64);
        if let Some(record) = moved {
            let first_block = run_local.blocks().len();
            let first_cluster = run_local.index.cluster_blocks.len();
            copy_blocks(
                run_local,
                previous,
                record,
                record.blocks.cluster_count as usize,
                glyph_delta,
            )?;
            let glyph_start = run.glyph_start as usize;
            let old_start = (glyph_start as i64 - glyph_delta) as usize;
            run_local.rows.copy_rows(
                glyph_start,
                &previous.rows,
                old_start,
                run.glyph_count as usize,
            );
            #[cfg(test)]
            super::work_attribution::record(|work| {
                if glyph_delta == 0 {
                    work.run_local_adopted_glyphs += run.glyph_count as usize;
                } else {
                    work.run_local_moved_glyphs += run.glyph_count as usize;
                }
            });
            return push_record(run_local, run, reverse, first_block, first_cluster);
        }
        return layout(run_local, run, clusters, runs, styles, None);
    }
    // Whole chunks the run visits before it reaches a rebuilt cluster: from its start when it
    // runs left to right, from its end when it runs right to left. Those clusters are the
    // previous ones, moved by the windows before them.
    let chunk = LAYOUT_CUT.clusters_per_block;
    let (after_clusters, after_glyphs) = splice.shift_before(last);
    let (kept, kept_glyph_delta) = if reverse {
        (
            end.saturating_sub(splice.windows[last - 1].end) / chunk * chunk,
            after_glyphs,
        )
    } else {
        (
            splice.windows[first].start.saturating_sub(start) / chunk * chunk,
            glyph_delta,
        )
    };
    let Some(record) = record(start as i64 - cluster_delta).filter(|record| {
        kept > 0
            && start <= splice.windows[first].start
            && (!reverse || i64::from(record.cluster_end) + after_clusters == end as i64)
    }) else {
        return layout(run_local, run, clusters, runs, styles, None);
    };
    let first_block = run_local.blocks().len();
    let first_cluster = run_local.index.cluster_blocks.len();
    copy_blocks(run_local, previous, record, kept, kept_glyph_delta)?;
    let run_glyph_end = run.glyph_start as usize + run.glyph_count as usize;
    let glyphs = if reverse {
        clusters.glyph_starts[end - kept] as usize..run_glyph_end
    } else {
        run.glyph_start as usize..clusters.glyph_starts[start + kept] as usize
    };
    let old_start = (glyphs.start as i64 - kept_glyph_delta) as usize;
    run_local
        .rows
        .copy_rows(glyphs.start, &previous.rows, old_start, glyphs.len());
    #[cfg(test)]
    super::work_attribution::record(|work| {
        work.run_local_adopted_glyphs += glyphs.len();
    });
    let resume = RunResume {
        ordinal: kept,
        first_block,
        first_cluster,
    };
    layout(run_local, run, clusters, runs, styles, Some(resume))
}

/// Appends the blocks and cluster lanes of `record`'s first `cluster_count` clusters from
/// `previous`, with their glyphs moved by `glyph_delta`. Blocks never cross a chunk, so the
/// blocks of whole chunks are whole.
fn copy_blocks(
    run_local: &mut RunLocalArena,
    previous: &RunLocalArena,
    record: RunRecord,
    cluster_count: usize,
    glyph_delta: i64,
) -> Result<(), EngineError> {
    let old_clusters =
        record.blocks.cluster_start as usize..record.blocks.cluster_start as usize + cluster_count;
    let old_first = record.blocks.start;
    let blocks = previous.index.cluster_blocks[old_clusters.clone()]
        .iter()
        .rev()
        .find(|block| **block != u32::MAX)
        .map_or(0, |last| (last - old_first + 1) as usize);
    let old_blocks = &previous.index.blocks[old_first as usize..old_first as usize + blocks];
    let new_first =
        u32::try_from(run_local.index.blocks.len()).map_err(|_| EngineError::ResultTooLarge)?;
    let old_row_base = old_blocks.first().map_or(0, |block| block.row_start);
    let row_base = run_local.index.row_count;
    let index = &mut run_local.index;
    index
        .blocks
        .try_reserve_cold(blocks)
        .map_err(|_| EngineError::ResultTooLarge)?;
    index
        .cluster_blocks
        .try_reserve_cold(cluster_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    index
        .cluster_prefixes
        .try_reserve_cold(cluster_count)
        .map_err(|_| EngineError::ResultTooLarge)?;
    let shift = |glyph: u32| (i64::from(glyph) + glyph_delta) as u32;
    for block in old_blocks {
        index.blocks.push(super::run_local::NumericBlock {
            source_glyph_start: shift(block.source_glyph_start),
            row_start: block.row_start - old_row_base + row_base,
            ..*block
        });
    }
    let rows = old_blocks
        .last()
        .map_or(0, |block| block.row_start + block.row_count - old_row_base);
    index.row_count += rows;
    index.cluster_blocks.extend(
        previous.index.cluster_blocks[old_clusters.clone()]
            .iter()
            .map(|block| {
                if *block == u32::MAX {
                    u32::MAX
                } else {
                    block - old_first + new_first
                }
            }),
    );
    index
        .cluster_prefixes
        .extend_from_slice(&previous.index.cluster_prefixes[old_clusters]);
    #[cfg(any(test, feature = "oracle"))]
    {
        let old_rows = old_row_base as usize..(old_row_base + rows) as usize;
        index.row_order.extend(
            previous.index.row_order[old_rows]
                .iter()
                .map(|glyph| shift(*glyph)),
        );
    }
    run_local.cover_blocks(new_first as usize).map_err(error)
}

fn push_record(
    run_local: &mut RunLocalArena,
    run: LayoutRun,
    reverse: bool,
    first_block: usize,
    first_cluster: usize,
) -> Result<NumericBlockSpan, EngineError> {
    let count = |len: usize, first: usize| {
        u32::try_from(len - first).map_err(|_| EngineError::ResultTooLarge)
    };
    let span = NumericBlockSpan {
        start: u32::try_from(first_block).map_err(|_| EngineError::ResultTooLarge)?,
        count: count(run_local.index.blocks.len(), first_block)?,
        cluster_start: u32::try_from(first_cluster).map_err(|_| EngineError::ResultTooLarge)?,
        cluster_count: count(run_local.index.cluster_blocks.len(), first_cluster)?,
    };
    run_local
        .runs
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    run_local.runs.push(RunRecord {
        cluster_start: run.cluster_start,
        cluster_end: run.cluster_end,
        reverse,
        blocks: span,
    });
    Ok(span)
}

/// Gives each layout run the blocks of the inherited run it equals. The caller inherits only
/// from the arena its lanes were copied from with no run-local input changed, so what can
/// still differ is how the clusters are cut into runs; any difference declines the geometry.
fn inherit_geometry(
    run_local: &RunLocalArena,
    layout_runs: &mut [LayoutRun],
    runs: &[ShapingRun],
    glyphs: usize,
) -> bool {
    let fits = run_local.lanes().inline_origin.len() == glyphs
        && run_local.ink.units().len() == glyphs
        && run_local.runs.len() == layout_runs.len()
        && layout_runs
            .iter()
            .zip(&run_local.runs)
            .all(|(run, record)| {
                run.cluster_start == record.cluster_start
                    && run.cluster_end == record.cluster_end
                    && direction(*run, runs)
                        .is_ok_and(|direction| (direction & 1 != 0) == record.reverse)
            });
    if fits {
        for (run, record) in layout_runs.iter_mut().zip(&run_local.runs) {
            run.numeric_blocks = record.blocks;
        }
    }
    fits
}

fn direction(run: LayoutRun, runs: &[ShapingRun]) -> Result<u8, EngineError> {
    usize::try_from(run.source_run)
        .ok()
        .and_then(|source| runs.get(source))
        .map(|run| run.direction)
        .or_else(|| (run.glyph_count == 0).then_some(0))
        .ok_or(EngineError::InvalidRequest)
}

/// The adapter from the font registry's per-glyph lookup to ink lanes. A producer that already
/// has the extents in cluster order can fill `InkUnitLanes` itself and skip this.
fn fill_ink(
    ink: &mut InkUnitLanes,
    clusters: &ClusterArena,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    ink.reset(clusters.glyph_ids.len()).map_err(error)?;
    for cluster in 0..clusters.glyph_starts.len() {
        // A hard break is detached: it has no rows, so its glyph is never measured.
        if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
            continue;
        }
        let font_handle = clusters.font_handles[cluster];
        let start = clusters.glyph_starts[cluster] as usize;
        let glyph_ids = clusters
            .glyph_ids
            .get(start..start + clusters.glyph_counts[cluster] as usize)
            .ok_or(EngineError::InvalidRequest)?;
        for (offset, glyph_id) in glyph_ids.iter().enumerate() {
            if let Some(extents) = extents_for(font_handle, u32::from(*glyph_id)) {
                ink.set(start + offset, extents).map_err(error)?;
            }
        }
    }
    Ok(())
}

fn layout(
    run_local: &mut RunLocalArena,
    run: LayoutRun,
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    resume: Option<RunResume>,
) -> Result<NumericBlockSpan, EngineError> {
    let reverse = direction(run, runs)? & 1 != 0;
    let cluster_start = run.cluster_start as usize;
    let cluster_end = run.cluster_end as usize;
    if cluster_start > cluster_end || cluster_end > clusters.glyph_starts.len() {
        return Err(EngineError::InvalidRequest);
    }
    scale_spans(
        &mut run_local.spans,
        clusters,
        styles,
        cluster_start..cluster_end,
    )?;
    let first_block = run_local.blocks().len();
    #[cfg(test)]
    let first_row = run_local.index.row_count;
    let resume = resume.unwrap_or(RunResume {
        ordinal: 0,
        first_block,
        first_cluster: run_local.index.cluster_blocks.len(),
    });
    let span = layout_run_from(
        &mut run_local.index,
        &mut run_local.rows,
        &mut run_local.scratch,
        &RunInput {
            units: GlyphUnits {
                inline_advance: &clusters.glyph_x_advances,
                inline_offset: &clusters.glyph_x_offsets,
                block_offset: &clusters.glyph_y_offsets,
                ink: run_local.ink.units(),
            },
            spans: &run_local.spans,
            clusters: ClusterLanes {
                glyph_starts: &clusters.glyph_starts,
                glyph_counts: &clusters.glyph_counts,
                flags: &clusters.flags,
                detached_mask: CLUSTER_HARD_BREAK,
                end: ClusterEnd::Resync(&clusters.advances),
            },
            cluster_start,
            cluster_end,
            reverse,
            cut: LAYOUT_CUT,
        },
        resume,
    )
    .map_err(error)?;
    #[cfg(test)]
    super::work_attribution::record(|work| {
        work.run_local_glyph_visits += (run_local.index.row_count - first_row) as usize;
    });
    run_local.cover_blocks(first_block).map_err(error)?;
    run_local
        .runs
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    run_local.runs.push(RunRecord {
        cluster_start: run.cluster_start,
        cluster_end: run.cluster_end,
        reverse,
        blocks: span,
    });
    Ok(span)
}

/// One span per stretch of attached clusters that share a style and a font em: the outer loop
/// the kernel's scale pass runs under. A style or em is resolved once per span.
fn scale_spans(
    spans: &mut Vec<ScaleSpan>,
    clusters: &ClusterArena,
    styles: &[StyleSegment],
    run: core::ops::Range<usize>,
) -> Result<(), EngineError> {
    spans.clear();
    let mut current = None;
    let mut glyph_end = 0;
    for cluster in run {
        if clusters.flags[cluster] & CLUSTER_HARD_BREAK != 0 {
            continue;
        }
        let key = (
            clusters.style_indexes[cluster],
            clusters.units_per_em[cluster].to_bits(),
        );
        if current != Some(key) {
            current = Some(key);
            let style = styles
                .get(usize::try_from(key.0).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?
                .style;
            let units_per_em = clusters.units_per_em[cluster];
            if units_per_em == 0.0 {
                return Err(EngineError::InvalidRequest);
            }
            spans
                .try_reserve_cold(1)
                .map_err(|_| EngineError::ResultTooLarge)?;
            spans.push(ScaleSpan {
                glyph_end,
                scale: f64::from(style.font_size) / units_per_em,
                baseline_shift: f64::from(style.baseline_shift),
            });
        }
        let count = clusters.glyph_counts[cluster];
        if count != 0 {
            glyph_end = clusters.glyph_starts[cluster]
                .checked_add(count)
                .ok_or(EngineError::InvalidRequest)?;
            if let Some(span) = spans.last_mut() {
                span.glyph_end = glyph_end;
            }
        }
    }
    Ok(())
}

/// Where layout starts after `adopt_prefix`: the first run still to lay out and, when that run
/// was partly adopted, where in it.
#[derive(Clone, Copy, Default)]
struct Start {
    run: usize,
    resume: Option<RunResume>,
}

/// Copies the geometry of the leading clusters whose run-local inputs equal the previous
/// arena's, cut back to a block boundary, and says where layout resumes. Copies nothing when
/// the previous geometry does not describe the previous clusters' runs.
fn adopt_prefix(
    run_local: &mut RunLocalArena,
    layout_runs: &mut [LayoutRun],
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    previous: PreviousGeometry<'_>,
) -> Result<Start, EngineError> {
    let old = previous.clusters;
    let records = &old.run_local.runs;
    let old_glyphs = old.glyph_ids.len();
    if records.len() != old.layout_runs().len()
        || old.run_local.lanes().inline_origin.len() < old_glyphs
        || old.run_local.ink.units().len() != old_glyphs
        || run_local.ink.units().len() != clusters.glyph_ids.len()
        || records.iter().zip(old.layout_runs()).any(|(record, run)| {
            record.cluster_start != run.cluster_start || record.cluster_end != run.cluster_end
        })
    {
        return Ok(Start::default());
    }
    let same = equal_prefix(
        clusters,
        styles,
        run_local.ink.units(),
        old,
        previous.styles,
        old.run_local.ink.units(),
    );
    let per_block = LAYOUT_CUT.clusters_per_block;
    let mut start = Start::default();
    let mut prefix = GeometryPrefix {
        blocks: 0,
        clusters: 0,
        glyphs: 0,
        runs: 0,
    };
    for (index, run) in layout_runs.iter().enumerate() {
        let Some(record) = records.get(index) else {
            break;
        };
        let reverse = direction(*run, runs)? & 1 != 0;
        let (run_start, run_end) = (run.cluster_start as usize, run.cluster_end as usize);
        if run.cluster_start != record.cluster_start
            || reverse != record.reverse
            || same <= run_start
        {
            break;
        }
        if run.cluster_end == record.cluster_end && run_end <= same {
            prefix = GeometryPrefix {
                blocks: (record.blocks.start + record.blocks.count) as usize,
                clusters: run_end,
                glyphs: glyph_end(clusters, run_end),
                runs: index + 1,
            };
            start.run = index + 1;
            continue;
        }
        if reverse {
            break;
        }
        let limit = same.min(run_end).min(record.cluster_end as usize);
        let kept = (limit - run_start) / per_block * per_block;
        if kept == 0 {
            break;
        }
        let cut = run_start + kept;
        let glyphs = glyph_end(clusters, cut);
        let run_blocks = old
            .run_local
            .blocks()
            .get(record.blocks.start as usize..(record.blocks.start + record.blocks.count) as usize)
            .ok_or(EngineError::InvalidRequest)?;
        let kept_blocks =
            run_blocks.partition_point(|block| (block.source_glyph_start as usize) < glyphs);
        prefix = GeometryPrefix {
            blocks: record.blocks.start as usize + kept_blocks,
            clusters: cut,
            glyphs,
            runs: index,
        };
        start = Start {
            run: index,
            resume: Some(RunResume {
                ordinal: kept,
                first_block: record.blocks.start as usize,
                first_cluster: record.blocks.cluster_start as usize,
            }),
        };
        break;
    }
    if prefix.clusters == 0 {
        return Ok(Start::default());
    }
    run_local
        .adopt_prefix(&old.run_local, prefix)
        .map_err(error)?;
    for (run, record) in layout_runs.iter_mut().zip(records).take(prefix.runs) {
        run.numeric_blocks = record.blocks;
    }
    #[cfg(test)]
    super::work_attribution::record(|work| work.run_local_adopted_glyphs += prefix.glyphs);
    Ok(start)
}

/// The glyph after the first `clusters` clusters.
fn glyph_end(clusters: &ClusterArena, count: usize) -> usize {
    count.checked_sub(1).map_or(0, |last| {
        (clusters.glyph_starts[last] + clusters.glyph_counts[last]) as usize
    })
}

/// How many leading clusters the kernel reads identically in both arenas: the same glyphs at
/// the same indexes with the same font units and ink, the same cluster advance, detachment,
/// font em, and the same font size and baseline shift through their style.
fn equal_prefix(
    new: &ClusterArena,
    new_styles: &[StyleSegment],
    new_ink: &[[i16; 4]],
    old: &ClusterArena,
    old_styles: &[StyleSegment],
    old_ink: &[[i16; 4]],
) -> usize {
    let scaled_styles = new_styles
        .iter()
        .zip(old_styles)
        .take_while(|(new, old)| {
            new.style.font_size.to_bits() == old.style.font_size.to_bits()
                && new.style.baseline_shift.to_bits() == old.style.baseline_shift.to_bits()
        })
        .count();
    let same = |range: core::ops::Range<usize>| -> bool {
        let lanes = range.clone();
        let detached = |flags: &[u8]| -> u64 {
            flags.iter().enumerate().fold(0, |bits, (at, flags)| {
                bits | (u64::from(flags & CLUSTER_HARD_BREAK != 0) << (at % 64))
            })
        };
        let equal = new.glyph_starts[lanes.clone()] == old.glyph_starts[lanes.clone()]
            && new.glyph_counts[lanes.clone()] == old.glyph_counts[lanes.clone()]
            && new.style_indexes[lanes.clone()] == old.style_indexes[lanes.clone()]
            && new.style_indexes[lanes.clone()]
                .iter()
                .all(|style| (*style as usize) < scaled_styles)
            && detached(&new.flags[lanes.clone()]) == detached(&old.flags[lanes.clone()])
            && new.advances[lanes.clone()]
                .iter()
                .zip(&old.advances[lanes.clone()])
                .all(|(new, old)| new.to_bits() == old.to_bits())
            && new.units_per_em[lanes.clone()]
                .iter()
                .zip(&old.units_per_em[lanes.clone()])
                .all(|(new, old)| new.to_bits() == old.to_bits());
        if !equal {
            return false;
        }
        // Equal starts and counts give both arenas the same glyph range.
        let glyphs = new.glyph_starts[range.start] as usize..glyph_end(new, range.end);
        new.glyph_x_advances[glyphs.clone()] == old.glyph_x_advances[glyphs.clone()]
            && new.glyph_x_offsets[glyphs.clone()] == old.glyph_x_offsets[glyphs.clone()]
            && new.glyph_y_offsets[glyphs.clone()] == old.glyph_y_offsets[glyphs.clone()]
            && new_ink[glyphs.clone()] == old_ink[glyphs]
    };
    let count = new.starts.len().min(old.starts.len());
    let chunk = LAYOUT_CUT.clusters_per_block;
    let mut at = 0;
    while at < count {
        let end = (at + chunk).min(count);
        if same(at..end) {
            at = end;
            continue;
        }
        return at
            + (at..end)
                .take_while(|cluster| same(*cluster..*cluster + 1))
                .count();
    }
    count
}

fn error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
    }
}
