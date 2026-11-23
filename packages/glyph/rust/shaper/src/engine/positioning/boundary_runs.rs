//! Replacement runs recomposed across line boundaries and their run-local layouts.

use super::*;

pub(super) fn boundary_shape_span<'a>(
    arena: &'a BoundaryShapeArena,
    spec: BoundaryRunSpec,
) -> Result<BoundaryShapeSpan<'a>, EngineError> {
    let start = usize::try_from(spec.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::try_from(spec.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(BoundaryShapeSpan {
        glyph_ids: arena
            .shape
            .glyph_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        x_advances: arena
            .shape
            .x_advances
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        y_advances: arena
            .shape
            .y_advances
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        x_offsets: arena
            .shape
            .x_offsets
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        y_offsets: arena
            .shape
            .y_offsets
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        glyph_flags: arena
            .shape
            .glyph_flags
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
        stable_ids: arena
            .stable_ids
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)?,
    })
}

pub(super) fn merge_recomposed_glyphs(
    current: &mut Vec<core::ops::Range<usize>>,
    previous: &[core::ops::Range<usize>],
) -> Result<(), EngineError> {
    let current_len = current.len();
    let merged_len = current_len
        .checked_add(previous.len())
        .ok_or(EngineError::ResultTooLarge)?;
    current
        .try_reserve(previous.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    current.resize(merged_len, 0..0);
    let (mut left, mut right) = (current_len, previous.len());
    // Both producers order by start. Filling backward never overwrites the unread
    // current prefix: the destination is at or after its last unread element.
    for write in (0..merged_len).rev() {
        if right == 0 || (left != 0 && current[left - 1].start >= previous[right - 1].start) {
            left -= 1;
            current[write] = current[left].clone();
        } else {
            right -= 1;
            current[write] = previous[right].clone();
        }
    }
    let mut write = 0;
    for read in 0..merged_len {
        let range = current[read].clone();
        if write != 0 && current[write - 1].end >= range.start {
            current[write - 1].end = current[write - 1].end.max(range.end);
        } else {
            current[write] = range;
            write += 1;
        }
    }
    current.truncate(write);
    Ok(())
}

pub(super) fn replacement_index(key: u64) -> usize {
    // pack2 stores the checked u32 source index in the low word.
    (key as u32) as usize
}

pub(super) fn same_boundary_run(
    current: BoundaryRunSpec,
    previous: BoundaryRunSpec,
    current_shape: &BoundaryShapeArena,
    previous_shape: &BoundaryShapeArena,
    current_runs: &[ShapingRun],
    previous_runs: &[ShapingRun],
) -> Result<bool, EngineError> {
    if current.source_kind != previous.source_kind
        || current.font_handle != previous.font_handle
        || current.glyph_count != previous.glyph_count
    {
        return Ok(false);
    }
    let current_run = current_runs
        .get(usize::try_from(current.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let previous_run = previous_runs
        .get(usize::try_from(previous.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let same_metrics = current_run.bidi_level == previous_run.bidi_level
        && current_run.style.font_size.to_bits() == previous_run.style.font_size.to_bits()
        && current_run.style.letter_spacing.to_bits()
            == previous_run.style.letter_spacing.to_bits()
        && current_run.style.word_spacing.to_bits() == previous_run.style.word_spacing.to_bits()
        && current_run.style.baseline_shift.to_bits()
            == previous_run.style.baseline_shift.to_bits();
    Ok(same_metrics
        && same_relative_boundary_clusters(current_shape, current, previous_shape, previous)?
        && boundary_shape_span(current_shape, current)?
            == boundary_shape_span(previous_shape, previous)?)
}

pub(super) fn same_relative_boundary_clusters(
    current_shape: &BoundaryShapeArena,
    current: BoundaryRunSpec,
    previous_shape: &BoundaryShapeArena,
    previous: BoundaryRunSpec,
) -> Result<bool, EngineError> {
    fn clusters(arena: &BoundaryShapeArena, spec: BoundaryRunSpec) -> Result<&[u32], EngineError> {
        let start = usize::try_from(spec.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let end = start
            .checked_add(
                usize::try_from(spec.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
            )
            .ok_or(EngineError::InvalidRequest)?;
        arena
            .shape
            .clusters
            .get(start..end)
            .ok_or(EngineError::InvalidRequest)
    }
    let current = clusters(current_shape, current)?;
    let previous = clusters(previous_shape, previous)?;
    let current_base = current.first().copied().unwrap_or(0);
    let previous_base = previous.first().copied().unwrap_or(0);
    Ok(current.len() == previous.len()
        && current.iter().zip(previous).all(|(left, right)| {
            i64::from(*left) - i64::from(current_base)
                == i64::from(*right) - i64::from(previous_base)
        }))
}
impl BoundaryRunSpec {
    pub(super) fn from_boundary(boundary: BoundaryShape, role: BoundaryRunRole) -> Option<Self> {
        let (glyph_start, glyph_count, font_handle) = match role {
            BoundaryRunRole::BoundarySource => (
                boundary.source_glyph_start,
                boundary.source_glyph_count,
                boundary.source_font_handle,
            ),
            BoundaryRunRole::Ellipsis => (
                boundary.ellipsis_glyph_start,
                boundary.ellipsis_glyph_count,
                boundary.ellipsis_font_handle,
            ),
        };
        (glyph_count != 0).then_some(Self {
            source_kind: LayoutRunSourceKind::Boundary {
                flow_thread_id: boundary.flow_thread_id,
                role,
            },
            cluster_start: boundary.cluster_start,
            cluster_end: boundary.cluster_end,
            glyph_start,
            glyph_count,
            source_run: boundary.source_run,
            font_handle,
        })
    }
}

impl RunGeometry {
    pub(super) fn for_cluster(
        clusters: &ClusterArena,
        styles: &[StyleSegment],
        cluster: usize,
    ) -> Result<Self, EngineError> {
        let style_index = usize::try_from(clusters.style_indexes[cluster])
            .map_err(|_| EngineError::InvalidRequest)?;
        let style = styles
            .get(style_index)
            .ok_or(EngineError::InvalidRequest)?
            .style;
        Self::for_values(
            clusters.font_handles[cluster],
            clusters.units_per_em[cluster],
            style.font_size,
        )
    }

    pub(super) fn for_values(
        font_handle: u32,
        units_per_em: f64,
        font_size: f32,
    ) -> Result<Self, EngineError> {
        if font_handle == 0 || units_per_em == 0.0 {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Self {
            font_handle,
            font_size,
        })
    }
}

impl PositionedGlyphArena {
    pub(super) fn rebuild_replacement_runs(
        &mut self,
        previous: &Self,
        current_shape: &BoundaryShapeArena,
        previous_shape: &BoundaryShapeArena,
        current_runs: &[ShapingRun],
        previous_runs: &[ShapingRun],
        next_revision: &mut u32,
    ) -> Result<(), EngineError> {
        let capacity = current_shape
            .records
            .len()
            .checked_mul(2)
            .ok_or(EngineError::ResultTooLarge)?;
        self.replacement_runs
            .try_reserve(capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_run_boundary_indices
            .try_reserve(capacity)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_run_indices
            .try_reserve(current_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_current_order
            .try_reserve(current_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.replacement_previous_order
            .try_reserve(previous_shape.records.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for index in 0..current_shape.records.len() {
            let index = u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?;
            self.replacement_current_order.push(pack2(
                current_shape.records[index as usize].flow_thread_id,
                index,
            ));
        }
        for index in
            (0..previous_shape.records.len()).filter(|i| !previous_shape.records[*i].line_start)
        {
            let index = u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?;
            self.replacement_previous_order.push(pack2(
                previous_shape.records[index as usize].flow_thread_id,
                index,
            ));
        }
        sort_keys(&mut self.replacement_current_order);
        sort_keys(&mut self.replacement_previous_order);
        if self.replacement_current_order.windows(2).any(|pair| {
            let (left, right) = (
                current_shape.records[replacement_index(pair[0])],
                current_shape.records[replacement_index(pair[1])],
            );
            left.flow_thread_id == right.flow_thread_id && !(left.line_start || right.line_start)
        }) || self
            .replacement_previous_order
            .windows(2)
            .any(|pair| pair[0] >> 32 == pair[1] >> 32)
        {
            return Err(EngineError::InvalidRequest);
        }
        self.replacement_run_indices
            .resize(current_shape.records.len(), [None; 2]);
        let mut revision_cursor = *next_revision;
        let mut previous_order_index = 0usize;
        for current_boundary_key in self.replacement_current_order.iter().copied() {
            let current_boundary_index = replacement_index(current_boundary_key);
            let boundary = current_shape.records[current_boundary_index];
            while self
                .replacement_previous_order
                .get(previous_order_index)
                .is_some_and(|key| (*key >> 32) < u64::from(boundary.flow_thread_id))
            {
                previous_order_index += 1;
            }
            let previous_boundary_index = self
                .replacement_previous_order
                .get(previous_order_index)
                .copied()
                .filter(|key| {
                    !boundary.line_start && (*key >> 32) == u64::from(boundary.flow_thread_id)
                })
                .map(replacement_index);
            let previous_boundary =
                previous_boundary_index.map(|index| previous_shape.records[index]);
            let mut run_indices = [None; 2];
            for role in [BoundaryRunRole::BoundarySource, BoundaryRunRole::Ellipsis] {
                let Some(spec) = BoundaryRunSpec::from_boundary(boundary, role) else {
                    continue;
                };
                let role_index = boundary_role_index(role);
                let previous_run = previous_boundary_index
                    .and_then(|index| previous.replacement_run_indices.get(index))
                    .and_then(|indices| indices[role_index])
                    .and_then(|index| previous.replacement_runs.get(index as usize))
                    .filter(|run| run.source_kind == spec.source_kind);
                let previous_spec = previous_boundary
                    .and_then(|candidate| BoundaryRunSpec::from_boundary(candidate, role))
                    .filter(|candidate| candidate.source_kind == spec.source_kind);
                let retained =
                    if let (Some(run), Some(previous_spec)) = (previous_run, previous_spec) {
                        same_boundary_run(
                            spec,
                            previous_spec,
                            current_shape,
                            previous_shape,
                            current_runs,
                            previous_runs,
                        )?
                        .then_some(run.canonical_revision)
                        .flatten()
                    } else {
                        None
                    };
                let canonical_revision = retained
                    .map(Ok)
                    .unwrap_or_else(|| RunCanonicalRevision::allocate(&mut revision_cursor))?;
                let run_index = u32::try_from(self.replacement_runs.len())
                    .map_err(|_| EngineError::ResultTooLarge)?;
                self.replacement_runs.push(LayoutRun {
                    source_kind: spec.source_kind,
                    cluster_start: spec.cluster_start,
                    cluster_end: spec.cluster_end,
                    glyph_start: spec.glyph_start,
                    glyph_count: spec.glyph_count,
                    source_run: spec.source_run,
                    font_handle: spec.font_handle,
                    numeric_blocks: Default::default(),
                    canonical_revision: Some(canonical_revision),
                });
                self.replacement_run_boundary_indices.push(
                    u32::try_from(current_boundary_index)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                );
                run_indices[role_index] = Some(run_index);
            }
            self.replacement_run_indices[current_boundary_index] = run_indices;
            if previous_boundary.is_some() {
                previous_order_index += 1;
            }
        }
        *next_revision = revision_cursor;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn rebuild_replacement_run_local(
        &mut self,
        boundary_shape: &BoundaryShapeArena,
        text: &[u16],
        clusters: &ClusterArena,
        runs: &[ShapingRun],
        styles: &[StyleSegment],
        metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
        extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
    ) -> Result<(), EngineError> {
        let mut run_local = core::mem::take(&mut self.replacement_run_local);
        run_local.clear();
        let result = (|| {
            for (boundary_index, boundary) in boundary_shape.records.iter().copied().enumerate() {
                for role in [BoundaryRunRole::BoundarySource, BoundaryRunRole::Ellipsis] {
                    let Some(run_index) = self
                        .replacement_run_indices
                        .get(boundary_index)
                        .and_then(|indices| indices[boundary_role_index(role)])
                    else {
                        continue;
                    };
                    let run_index =
                        usize::try_from(run_index).map_err(|_| EngineError::InvalidRequest)?;
                    let run = self
                        .replacement_runs
                        .get(run_index)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?;
                    let mut writer = run_local.begin_run();
                    append_boundary_run_local(
                        &mut writer,
                        run,
                        role,
                        boundary,
                        boundary_shape,
                        text,
                        clusters,
                        runs,
                        styles,
                        metrics_for,
                        extents_for,
                    )?;
                    self.replacement_runs[run_index].numeric_blocks =
                        writer.finish().map_err(run_local_build_error)?;
                }
            }
            run_local
                .finalize_source_ranks()
                .map_err(run_local_build_error)?;
            Ok(())
        })();
        if result.is_err() {
            run_local.clear();
            for run in &mut self.replacement_runs {
                run.numeric_blocks = Default::default();
            }
        }
        self.replacement_run_local = run_local;
        result
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn append_boundary_run_local(
    writer: &mut RunLocalWriter<'_>,
    run: LayoutRun,
    role: BoundaryRunRole,
    boundary: BoundaryShape,
    arena: &BoundaryShapeArena,
    text: &[u16],
    clusters: &ClusterArena,
    runs: &[ShapingRun],
    styles: &[StyleSegment],
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    let shaping_run = runs
        .get(usize::try_from(run.source_run).map_err(|_| EngineError::InvalidRequest)?)
        .copied()
        .ok_or(EngineError::InvalidRequest)?;
    let start = usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    let source_cluster =
        usize::try_from(boundary.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let ellipsis_cluster = usize::try_from(boundary.cluster_end)
        .map_err(|_| EngineError::InvalidRequest)?
        .saturating_sub(1)
        .max(source_cluster)
        .min(clusters.starts.len().saturating_sub(1));
    if role == BoundaryRunRole::Ellipsis {
        let style = boundary_cluster_style(styles, clusters, ellipsis_cluster)?;
        writer.begin_cluster().map_err(run_local_build_error)?;
        for glyph in start..end {
            push_boundary_run_local_glyph(
                writer,
                arena,
                glyph,
                run.font_handle,
                style,
                metrics_for,
                extents_for,
            )?;
        }
        return writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: 0.0,
                word_spacing: None,
            })
            .map_err(run_local_build_error);
    }

    let fallback_cluster = source_cluster.min(clusters.starts.len().saturating_sub(1));
    let mut mapping_cluster = if shaping_run.direction & 1 == 0 {
        fallback_cluster
    } else {
        ellipsis_cluster
    };
    let mut glyph = start;
    while glyph < end {
        let shaped_cluster = *arena
            .shape
            .clusters
            .get(glyph)
            .ok_or(EngineError::InvalidRequest)?;
        if shaping_run.direction & 1 == 0 {
            while clusters
                .starts
                .get(mapping_cluster)
                .is_some_and(|start| *start < shaped_cluster)
                && mapping_cluster + 1 < clusters.starts.len()
            {
                mapping_cluster += 1;
            }
        } else {
            while clusters
                .starts
                .get(mapping_cluster)
                .is_some_and(|start| *start > shaped_cluster)
                && mapping_cluster != 0
            {
                mapping_cluster -= 1;
            }
        }
        let cluster = clusters
            .starts
            .get(mapping_cluster)
            .filter(|start| **start == shaped_cluster)
            .map_or(fallback_cluster, |_| mapping_cluster);
        let style = boundary_cluster_style(styles, clusters, cluster)?;
        writer.begin_cluster().map_err(run_local_build_error)?;
        loop {
            push_boundary_run_local_glyph(
                writer,
                arena,
                glyph,
                run.font_handle,
                style,
                metrics_for,
                extents_for,
            )?;
            glyph += 1;
            if glyph == end || arena.shape.clusters.get(glyph).copied() != Some(shaped_cluster) {
                break;
            }
        }
        let word_spacing = clusters
            .starts
            .get(cluster)
            .and_then(|start| usize::try_from(*start).ok())
            .and_then(|start| text.get(start))
            .filter(|unit| **unit == 0x20)
            .map(|_| style.word_spacing);
        writer
            .finish_cluster(ClusterFinish::Continue {
                letter_spacing: style.letter_spacing,
                word_spacing,
            })
            .map_err(run_local_build_error)?;
    }
    Ok(())
}

pub(super) fn boundary_cluster_style(
    styles: &[StyleSegment],
    clusters: &ClusterArena,
    cluster: usize,
) -> Result<ResolvedStyle, EngineError> {
    styles
        .get(
            clusters
                .style_indexes
                .get(cluster)
                .copied()
                .and_then(|index| usize::try_from(index).ok())
                .ok_or(EngineError::InvalidRequest)?,
        )
        .map(|segment| segment.style)
        .ok_or(EngineError::InvalidRequest)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn push_boundary_run_local_glyph(
    writer: &mut RunLocalWriter<'_>,
    arena: &BoundaryShapeArena,
    glyph: usize,
    font_handle: u32,
    style: ResolvedStyle,
    metrics_for: impl Fn(u32) -> Option<FontMetrics> + Copy,
    extents_for: impl Fn(u32, u32) -> Option<FontGlyphExtents> + Copy,
) -> Result<(), EngineError> {
    let metrics =
        metrics_for(font_handle).ok_or(EngineError::FontMetricsMissing(FrameFault::default()))?;
    if metrics.units_per_em == 0 {
        return Err(EngineError::InvalidRequest);
    }
    let glyph_id = u32::from(
        *arena
            .shape
            .glyph_ids
            .get(glyph)
            .ok_or(EngineError::InvalidRequest)?,
    );
    writer
        .push_glyph(RunLocalGlyphInput {
            source_glyph: u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?,
            x_advance: *arena
                .shape
                .x_advances
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            x_offset: *arena
                .shape
                .x_offsets
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            y_offset: *arena
                .shape
                .y_offsets
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?,
            baseline_shift: style.baseline_shift,
            scale: f64::from(style.font_size) / f64::from(metrics.units_per_em),
            outline: extents_for(font_handle, glyph_id),
        })
        .map_err(run_local_build_error)
}

pub(super) fn run_local_build_error(error: RunLocalBuildError) -> EngineError {
    match error {
        RunLocalBuildError::AllocationFailed => EngineError::ResultTooLarge,
        RunLocalBuildError::InvalidSource | RunLocalBuildError::LocalGeometryOutOfRange => {
            EngineError::InvalidRequest
        }
    }
}

pub(super) const fn boundary_role_index(role: BoundaryRunRole) -> usize {
    match role {
        BoundaryRunRole::BoundarySource => 0,
        BoundaryRunRole::Ellipsis => 1,
    }
}
