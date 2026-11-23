//! Break corrections from shaping each line edge alone and comparing it with the paragraph.

use super::*;

pub(in crate::engine) struct ShapedBreakCorrections<'a, 'b> {
    pub(super) shaper: &'a RefCell<&'b mut ShaperRegistry>,
    pub(super) text: &'a [u16],
    pub(super) runs: &'a [ShapingRun],
    pub(super) styles: &'a StyleArena,
    pub(super) clusters: &'a ClusterArena,
}
impl ShapedBreakCorrections<'_, '_> {
    /// The correction on `side` (0 = L, 1 = R) of `boundary`, zero unless it needs one, priced on first use.
    /// An island too long to reshape is never corrected, as on main.
    pub(super) fn correction(
        &mut self,
        boundary: usize,
        side: usize,
    ) -> Result<Correction, EngineError> {
        const CORRECTED: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        let c = self.clusters;
        if boundary == 0 || c.flags[boundary - 1] & CORRECTED != CORRECTED {
            return Ok(Correction::ZERO);
        }
        let slots = &c.break_corrections[boundary - 1];
        if let Some(correction) = slots[side].get() {
            return Ok(correction);
        }
        let Some((start, end)) = c.reshapable_island(boundary) else {
            // Too long to reshape: uncorrected, and refused as a break.
            slots[2].set(Some(Correction::ZERO));
            return Ok(Correction::ZERO);
        };
        let range = if side == 0 {
            (start, boundary)
        } else {
            (boundary, end)
        };
        let (correction, drawn_alone) =
            self.delta(range, (side != 0, side == 0), Some((boundary, side)))?;
        slots[side].set(Some(correction));
        if side == 0 && !drawn_alone {
            slots[2].set(Some(Correction::ZERO));
        }
        Ok(correction)
    }

    /// Shapes clusters `[start, end)` and hands the glyphs to `consume`. `lead`/`trail` say the
    /// range begins/ends its line; any other edge shapes with [`SHAPING_CONTEXT`] clusters of context.
    pub(super) fn shape_range(
        &mut self,
        (start, end): (usize, usize),
        (lead, trail): (bool, bool),
        consume: &mut dyn FnMut(&harfrust::GlyphBuffer) -> Result<(), u32>,
    ) -> Result<(), EngineError> {
        let c = self.clusters;
        let run = self.runs[c.source_runs[start] as usize];
        let (item_start, item_end) = (c.starts[start], c.ends[end - 1]);
        let before = c.starts[start.saturating_sub(SHAPING_CONTEXT)].max(run.text_start);
        let after = c.ends[(end + SHAPING_CONTEXT).min(c.starts.len()) - 1].min(run.text_end);
        self.shaper
            .borrow_mut()
            .with_shaped_range(
                c.font_handles[start],
                self.text,
                ShapeRunRef {
                    text_start: run.text_start,
                    text_end: run.text_end,
                    script: run.script,
                    language: self.styles.resolved_language(run.style),
                    features: self.styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                ShapeRangeRef {
                    item_start,
                    item_end,
                    context_start: if lead { item_start } else { before },
                    context_end: if trail { item_end } else { after },
                    flags: 0x40
                        | u32::from(lead || start == 0)
                        | (u32::from(trail || end == c.starts.len()) << 1),
                },
                consume,
            )
            .map_err(shaper_error)
    }

    /// Hands `consume` the arena and run holding clusters `[start, end)` shaped alone with `edges`. A corrected
    /// boundary's own island, `slot` = (boundary, side), is shaped once per cluster build and kept, so the fitter
    /// that prices it and every line edge that draws it, on any relayout, share one shaping.
    pub(super) fn with_island(
        &mut self,
        (start, end): (usize, usize),
        edges: (bool, bool),
        slot: Option<(usize, usize)>,
        consume: &mut dyn FnMut(&ShapeArena, usize) -> Result<(), EngineError>,
    ) -> Result<(), EngineError> {
        let c = self.clusters;
        let mut islands = c.islands.borrow_mut();
        let islands = &mut *islands;
        let kept =
            slot.and_then(|(boundary, side)| islands.slots.get(boundary - 1)?[side].checked_sub(1));
        if let Some(run) = kept {
            return consume(&islands.shape, run as usize);
        }
        let arena = if slot.is_some() {
            &mut islands.shape
        } else {
            islands.once.clear();
            &mut islands.once
        };
        let run = arena.runs.len();
        let (source_run, binding, font) = (
            c.source_runs[start],
            c.binding_handles[start],
            c.font_handles[start],
        );
        self.shape_range((start, end), edges, &mut |shaped| {
            arena.append(
                source_run as usize,
                font,
                binding,
                c.starts[start],
                c.ends[end - 1],
                shaped,
            )
        })?;
        if let Some((boundary, side)) = slot {
            islands.slots.resize(c.starts.len(), [0; 2]);
            islands.slots[boundary - 1][side] =
                u32::try_from(run + 1).map_err(|_| EngineError::ResultTooLarge)?;
        }
        consume(arena, run)
    }

    /// The records shaping the islands a corrected line opens and closes (`NO_BOUNDARY` when that edge is
    /// uncorrected), alone as [`Self::delta`] priced them, so the line draws what it would shaped by itself.
    /// As Chromium reshapes line ends, a space ending the line leaves its end as is, and islands that meet
    /// shape the whole line once. An ellipsis keeps only the clusters before its cut.
    pub(super) fn line_edge_records(
        &mut self,
        fragment: FlowFragment,
        flow_thread_id: u32,
        (out, previous): (&mut BoundaryShapeArena, &[EdgeId]),
        next_glyph_id: &mut u32,
    ) -> Result<(u32, u32), EngineError> {
        const CORRECTED: u8 = CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
        let c = self.clusters;
        let index =
            |cluster: u32| usize::try_from(cluster).map_err(|_| EngineError::InvalidRequest);
        let (line_start, line_end) = (
            index(fragment.line.cluster_start)?,
            index(fragment.line.cluster_end)?,
        );
        // The island a line edge at `boundary` reshapes, when that boundary is a corrected break.
        let island = |boundary: usize| {
            let corrected = boundary > 0 && c.flags[boundary - 1] & CORRECTED == CORRECTED;
            corrected.then(|| c.reshapable_island(boundary)).flatten()
        };
        if line_start >= c.starts.len() {
            return Ok((NO_BOUNDARY, NO_BOUNDARY));
        }
        let cut = out.record(fragment.boundary_index);
        let island_end = island(line_start).map(|(_, end)| end);
        // As Chromium reshapes line ends, a space ends the line as is.
        let tail_island = island(line_end)
            .filter(|_| c.flags[line_end - 1] & CLUSTER_SPACE == 0 && cut.is_none());
        let tail_start = tail_island.map(|(start, _)| start.max(line_start));
        let whole = island_end
            .zip(tail_start)
            .is_some_and(|(lead, tail)| lead > tail);
        // Each edge: its clusters, how it shapes, and the boundary side whose island it is exactly, which that
        // boundary's pricing already shaped.
        let lead = match island_end {
            Some(island_end) => {
                let cut_end = cut.map_or(Ok(line_end), |cut| index(cut.cluster_start))?;
                let end = if whole {
                    line_end
                } else {
                    island_end.min(cut_end)
                };
                let edges = (true, whole || end < island_end);
                Some((
                    (line_start, end),
                    edges,
                    (!edges.1).then_some((line_start, 1)),
                ))
            }
            None => None,
        };
        let tail = tail_start.filter(|_| !whole).map(|start| {
            let exact = tail_island.is_some_and(|(first, _)| first == start);
            (
                (start, line_end),
                (false, true),
                exact.then_some((line_end, 0)),
            )
        });
        let mut record = |edge: Option<LineEdge>| {
            let Some(((start, end), edges, slot)) = edge.filter(|edge| edge.0.0 < edge.0.1) else {
                return Ok(NO_BOUNDARY);
            };
            let (source_run, binding, font) = (
                c.source_runs[start],
                c.binding_handles[start],
                c.font_handles[start],
            );
            let text_end = c.ends[end - 1];
            let mut glyphs = (0, 0);
            self.with_island((start, end), edges, slot, &mut |shaped, run| {
                glyphs = out.shape.append_from(shaped, run)?;
                let run = shaped.runs[run];
                let range = run.glyph_start as usize..(run.glyph_start + run.glyph_count) as usize;
                append_boundary_source_ids(
                    &mut out.stable_ids,
                    &shaped.clusters[range],
                    (c, previous),
                    next_glyph_id,
                )
            })?;
            let (glyph_start, glyph_count) = glyphs;
            let record =
                u32::try_from(out.records.len()).map_err(|_| EngineError::ResultTooLarge)?;
            out.records.push(BoundaryShape {
                flow_thread_id,
                source_run,
                cluster_start: u32::try_from(start).map_err(|_| EngineError::ResultTooLarge)?,
                cluster_end: u32::try_from(end).map_err(|_| EngineError::ResultTooLarge)?,
                text_end,
                source_binding_handle: binding,
                source_font_handle: font,
                ellipsis_binding_handle: binding,
                ellipsis_font_handle: font,
                source_glyph_start: glyph_start,
                source_glyph_count: glyph_count,
                ellipsis_glyph_start: glyph_start + glyph_count,
                ellipsis_glyph_count: 0,
                line_start: true,
            });
            Ok::<_, EngineError>(record)
        };
        Ok((record(lead)?, record(tail)?))
    }

    /// How far reshaping clusters `[start, end)` moves their base sums, and whether the paragraph's glyphs
    /// there are the ones it draws.
    pub(super) fn delta(
        &mut self,
        (start, end): (usize, usize),
        edges: (bool, bool),
        slot: Option<(usize, usize)>,
    ) -> Result<(Correction, bool), EngineError> {
        let trail = edges.1;
        let c = self.clusters;
        let style = self.runs[c.source_runs[start] as usize].style;
        let scale = f64::from(style.font_size) / c.units_per_em[start];
        let paragraph = &c.glyph_ids[c.glyph_starts[start] as usize
            ..(c.glyph_starts[end - 1] + c.glyph_counts[end - 1]) as usize];
        // Spacing first, then glyphs in order, as the arena sums: unchanged shapes correct by zero.
        let mut advances: Vec<f64> = (start..end)
            .map(|i| {
                let space = c.flags[i] & CLUSTER_SPACE != 0;
                f64::from(style.letter_spacing + if space { style.word_spacing } else { 0.0 })
            })
            .collect();
        let mut same = true;
        self.with_island((start, end), edges, slot, &mut |shaped, run| {
            let run = shaped.runs[run];
            let glyphs = run.glyph_start as usize..(run.glyph_start + run.glyph_count) as usize;
            let ids = &shaped.glyph_ids[glyphs.clone()];
            same = same_glyphs(ids.iter().map(|id| u32::from(*id)), paragraph);
            for (cluster, advance) in shaped.clusters[glyphs.clone()]
                .iter()
                .zip(&shaped.x_advances[glyphs])
            {
                let owner = c.starts.partition_point(|s| *s <= *cluster) - 1;
                advances[owner - start] += f64::from(advance.unsigned_abs()) * scale;
            }
            Ok(())
        })?;
        // Terminating spaces hang, laid at base width until shaping substitutes glyphs: skipped.
        let (mut advance, mut space, mut hung) = (0_i64, 0_i64, trail);
        for (i, shaped) in (start..end).zip(&advances).rev() {
            let is_space = c.flags[i] & CLUSTER_SPACE != 0;
            hung &= is_space;
            let change =
                crate::engine::layout_units::layout_units_from_scaled(*shaped) - c.advance_units[i];
            advance += change * i64::from(!hung);
            space += change * i64::from(!hung && is_space);
        }
        let unit = |value: i64| i32::try_from(value).map_err(|_| EngineError::ResultTooLarge);
        let correction = Correction {
            advance: unit(advance)?,
            space: unit(space)?,
            trailing: 0,
        };
        Ok((correction, same))
    }
}

impl BreakCorrections for ShapedBreakCorrections<'_, '_> {
    fn left(&mut self, boundary: usize) -> Result<Correction, EngineError> {
        self.correction(boundary, 0)
    }

    fn right(&mut self, boundary: usize) -> Result<Correction, EngineError> {
        self.correction(boundary, 1)
    }

    fn whole_line(&mut self, start: usize, end: usize) -> Result<Option<Correction>, EngineError> {
        let c = self.clusters;
        let tail = if end < c.starts.len() {
            c.reshapable_island(end)
        } else {
            Some((end, end))
        };
        // Only islands that meet, and each short enough to reshape.
        match (c.reshapable_island(start), tail) {
            (Some(head), Some(tail)) if head.1 > tail.0 => self
                .delta((start, end), (true, true), None)
                .map(|(whole, _)| Some(whole)),
            _ => Ok(None),
        }
    }

    /// A corrected break not after a space that the font shapes as one unit, or whose island is too long to
    /// tell: `left` found the paragraph's glyphs there differ from those the island draws as a line end.
    fn refused(&self, boundary: usize) -> bool {
        let c = self.clusters;
        c.flags[boundary - 1] & CLUSTER_SPACE == 0
            && c.break_corrections[boundary - 1][2].get().is_some()
    }
}
