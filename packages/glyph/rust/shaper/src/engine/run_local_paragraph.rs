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

use alloc::vec::Vec;

use crate::FontGlyphExtents;

use super::{
    EngineError,
    cluster_state::{CLUSTER_HARD_BREAK, ClusterArena, LayoutRun},
    run_local::{
        Inherited, InkUnitLanes, LAYOUT_CUT, NumericBlockSpan, RunLocalArena, RunLocalBuildError,
        RunRecord,
    },
    run_local_kernel::{ClusterEnd, ClusterLanes, GlyphUnits, RunInput, ScaleSpan, layout_run},
    shaping_state::ShapingRun,
    style_state::StyleSegment,
};

/// Rebuilds `run_local` for `clusters` and records each layout run's block span. On failure
/// the arena is left empty and no run names a block.
pub(crate) fn rebuild(
    run_local: &mut RunLocalArena,
    layout_runs: &mut [LayoutRun],
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
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
        for run in layout_runs.iter_mut() {
            run.numeric_blocks = layout(run_local, *run, clusters, runs, styles)?;
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
    let span = layout_run(
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
    )
    .map_err(error)?;
    #[cfg(test)]
    super::work_attribution::record(|work| {
        work.run_local_glyph_visits += (run_local.index.row_count - first_row) as usize;
    });
    run_local.cover_blocks(first_block).map_err(error)?;
    run_local
        .runs
        .try_reserve(1)
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
                .try_reserve(1)
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

fn error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
    }
}
