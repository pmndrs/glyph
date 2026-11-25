//! Reads one engine's accepted state into named lanes, stage by stage.
//!
//! This file is the adapter between the engine's storage and the frozen lane names. When a
//! stage is rewritten (struct rows become SoA lanes, a rope becomes a flat table), the
//! extraction here changes and the lane names, row order and row meaning do not: that is what
//! lets the rewritten stage be compared with the reference digest for digest.

use alloc::{format, string::String, vec::Vec};

use crate::engine::{
    cluster_state::{BoundaryRunRole, ClusterArena, LayoutRun, LayoutRunSourceKind},
    flow_composition::{FlowFragment, FlowLayoutArena, FlowLine},
    inline_leaf::InlineLeaf,
    placement_state::{GlyphSource, LayoutRunOwner, PlacementIdentity, PlacementSegment},
    positioning::{DecorationRecord, PositionedGlyphArena, PositionedSemanticGlyph, SemanticGlyph},
    render_plan::SESSION_PLACEMENT_BUFFER_ID,
    run_local::{NumericBlock, RunLocalArena, RunLocalGlyph},
    semantic_view::SemanticRecord,
    shaping_state::{BoundaryShapeArena, ShapeArena},
};

use super::{
    super::{ParagraphState, PlannerState},
    lanes::{Capture, LaneClass},
    model::{Document, PARAGRAPH_ID, ROOT_ID},
    session::{Session, StepOutput},
};

use LaneClass::{Cache, Identity, Repr, Value, Wire};

/// Writes one lane per listed field of a row table: `prefix.field`, or `prefix.field_sub` for a
/// nested field.
macro_rules! columns {
    ($capture:expr, $prefix:expr, $class:expr, $rows:expr, {
        $($writer:ident: [$($field:ident $(. $sub:ident)*),* $(,)?]);* $(;)?
    }) => {
        $($(
            $capture.$writer(
                concat!($prefix, ".", stringify!($field) $(, "_", stringify!($sub))*),
                $class,
                $rows.iter().map(|row| row.$field $(. $sub)*),
            );
        )*)*
    };
}

/// Every lane of the session's current state plus what the last step returned.
pub fn capture(session: &Session, output: &StepOutput) -> Result<Capture, String> {
    let mut capture = Capture::default();
    let planner = session
        .engine
        .planners
        .get(&ROOT_ID)
        .ok_or("root is missing")?;
    let ids = session.document().map(Document::ids).unwrap_or_default();
    for id in &ids {
        let paragraph = &planner
            .paragraph(*id)
            .ok_or_else(|| format!("paragraph {id} is missing"))?
            .state;
        capture.prefix = paragraph_prefix(*id);
        let inline = paragraph.active_inline();
        capture.bools("owner.inline", Value, [inline.is_some()]);
        analysis(&mut capture, paragraph);
        match inline {
            Some(leaf) => inline_leaf(&mut capture, leaf),
            None => general(&mut capture, paragraph)?,
        }
        public_glyphs(&mut capture, session, *id)?;
    }
    capture.prefix.clear();
    views(&mut capture, output);
    gather(&mut capture, session);
    host_buffers(&mut capture, session, planner)?;
    let explicit = session.document().is_some_and(|document| document.explicit);
    document(&mut capture, planner, explicit);
    decorated_glyphs(&mut capture, planner, &ids);
    Ok(capture)
}

/// Which glyphs each decoration record of every paragraph runs under, in paragraph order.
/// The records' frozen lanes are per paragraph in `positioned.decoration`; these lanes came
/// later, so they are one extended stage that no reference freezes and every step compares.
fn decorated_glyphs(capture: &mut Capture, planner: &PlannerState, ids: &[u32]) {
    let records: Vec<DecorationRecord> = ids
        .iter()
        .filter_map(|id| planner.paragraph(*id))
        .filter(|paragraph| paragraph.state.active_inline().is_none())
        .flat_map(|paragraph| paragraph.state.positioned.active().decorations())
        .copied()
        .collect();
    columns!(capture, "decorated", Value, records, {
        u32s: [glyph_start, glyph_end];
        f32s: [baseline];
    });
}

/// The first paragraph's lanes are unprefixed, as they were when it was the only one.
pub fn paragraph_prefix(id: u32) -> String {
    if id == PARAGRAPH_ID {
        String::new()
    } else {
        format!("p{id}:")
    }
}

/// The root's paragraphs: which are live, and the order the renderer draws them in.
fn document(capture: &mut Capture, planner: &PlannerState, explicit: bool) {
    capture.bools("doc.explicit", Value, [explicit]);
    capture.u32s(
        "doc.paragraph.id",
        Value,
        planner.paragraphs.iter().map(|paragraph| paragraph.id),
    );
    capture.u32s(
        "doc.order.id",
        Value,
        planner.active_order().iter().map(|ordered| ordered.id),
    );
}

/// Text, Unicode facts, bidi levels and resolved styles: computed for both owners.
fn analysis(capture: &mut Capture, paragraph: &ParagraphState) {
    let text = paragraph.text.active();
    capture.u16s("text.units", Value, text.units.iter().copied());
    capture.u32s("text.unit_ids", Identity, text.unit_ids.iter().copied());

    // Analysing empty text yields one boundary at 0; a paragraph that was never non-empty has
    // not been analysed at all. Both mean "no facts", so empty text captures none.
    let unicode = paragraph.unicode.active();
    let analysed = !text.units.is_empty();
    let kept = |count: usize| if analysed { count } else { 0 };
    let boundaries = unicode.grapheme_boundaries();
    capture.u32s(
        "unicode.grapheme_boundaries",
        Value,
        boundaries[..kept(boundaries.len())].iter().copied(),
    );
    let items = unicode.script_items();
    columns!(capture, "unicode.script_item", Value, items[..kept(items.len())], {
        u32s: [text_start, text_end, script];
    });
    let breaks = unicode.line_breaks();
    columns!(capture, "unicode.line_break", Value, breaks[..kept(breaks.len())], {
        u32s: [position];
        bools: [required];
    });

    let bidi = paragraph.bidi.active();
    capture.u8s("bidi.levels", Value, bidi.levels.iter().copied());
    capture.u8s("bidi.classes", Value, bidi.classes.iter().copied());
    capture.u32s(
        "bidi.paragraph_starts",
        Value,
        bidi.paragraph_starts.iter().copied(),
    );
    capture.u32s(
        "bidi.paragraph_ends",
        Value,
        bidi.paragraph_ends.iter().copied(),
    );
    capture.u8s(
        "bidi.paragraph_levels",
        Value,
        bidi.paragraph_levels.iter().copied(),
    );
    columns!(capture, "bidi.run", Value, bidi.runs, {
        u32s: [text_start, text_end];
        u8s: [level];
    });

    let segments = paragraph.styles.active().resolved.segments();
    columns!(capture, "style.segment", Value, segments, {
        u32s: [
            text_start, text_end, style.font_stack_handle, style.material_id,
            style.foreground_rgba, style.outline_rgba, style.shadow_rgba,
            style.decoration_rgba, style.decoration_flags,
        ];
        f32s: [
            style.font_size, style.line_height, style.letter_spacing, style.word_spacing,
            style.baseline_shift, style.raster_pixel_ratio, style.opacity, style.outline_width,
            style.shadow_offset_x, style.shadow_offset_y, style.decoration_thickness,
            style.decoration_offset, style.decoration_font_size,
        ];
        u8s: [style.direction, style.decoration_style];
        bools: [style.bidi_override, style.has_line_height];
    });

    columns!(capture, "shaping_run", Value, paragraph.shaping_runs.active().runs(), {
        u32s: [text_start, text_end, script];
        u8s: [direction, bidi_level];
    });
}

fn general(capture: &mut Capture, paragraph: &ParagraphState) -> Result<(), String> {
    shape(capture, "shape", paragraph.shape.active());
    let clusters = paragraph.clusters.active();
    cluster_lanes(capture, clusters);
    break_caches(capture, clusters);
    layout_runs(capture, "cluster.layout_run", clusters.layout_runs());
    run_local(capture, "run_local", clusters.run_local());
    flow(capture, paragraph.flow_layout.active());
    let boundary = paragraph.visible_boundary_shape();
    boundary_shape(capture, boundary);
    positioned(capture, paragraph.positioned.active(), clusters, boundary)
}

fn shape(capture: &mut Capture, prefix: &str, shape: &ShapeArena) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    let runs = &shape.runs;
    for (lane, column) in [
        ("run.source_run", column(runs, |run| run.source_run)),
        ("run.binding_handle", column(runs, |run| run.binding_handle)),
        ("run.font_handle", column(runs, |run| run.font_handle)),
        ("run.text_start", column(runs, |run| run.text_start)),
        ("run.text_end", column(runs, |run| run.text_end)),
        ("run.glyph_start", column(runs, |run| run.glyph_start)),
        ("run.glyph_count", column(runs, |run| run.glyph_count)),
        ("glyph.cluster", shape.clusters.clone()),
    ] {
        capture.u32s(&name(lane), Value, column);
    }
    for (lane, column) in [
        ("glyph.id", &shape.glyph_ids),
        ("glyph.flags", &shape.glyph_flags),
    ] {
        capture.u16s(&name(lane), Value, column.iter().copied());
    }
    for (lane, column) in [
        ("glyph.x_advance", &shape.x_advances),
        ("glyph.y_advance", &shape.y_advances),
        ("glyph.x_offset", &shape.x_offsets),
        ("glyph.y_offset", &shape.y_offsets),
    ] {
        capture.i32s(&name(lane), Value, column.iter().copied());
    }
}

fn column<T, V>(rows: &[T], field: impl Fn(&T) -> V) -> Vec<V> {
    rows.iter().map(field).collect()
}

fn cluster_lanes(capture: &mut Capture, clusters: &ClusterArena) {
    for (lane, class, column) in [
        ("cluster.text_start", Value, &clusters.starts),
        ("cluster.text_end", Value, &clusters.ends),
        ("cluster.style_index", Value, &clusters.style_indexes),
        ("cluster.source_run", Value, &clusters.source_runs),
        ("cluster.binding_handle", Value, &clusters.binding_handles),
        ("cluster.font_handle", Value, &clusters.font_handles),
        ("cluster.glyph_start", Value, &clusters.glyph_starts),
        ("cluster.glyph_count", Value, &clusters.glyph_counts),
        ("cluster.index_at", Value, &clusters.index_at),
        ("cluster.glyph.cluster", Value, &clusters.glyph_clusters),
        ("cluster.stable_id", Identity, &clusters.stable_ids),
        (
            "cluster.glyph.stable_id",
            Identity,
            &clusters.glyph_stable_ids,
        ),
        // Anchors name stable text ids, so they follow the edit history.
        (
            "cluster.placement_segment_anchor",
            Identity,
            &clusters.placement_segment_anchors,
        ),
    ] {
        capture.u32s(lane, class, column.iter().copied());
    }
    for (lane, column) in [
        ("cluster.flags", &clusters.flags),
        ("cluster.shaped", &clusters.shaped),
        ("cluster.unsafe_before", &clusters.unsafe_before),
    ] {
        capture.u8s(lane, Value, column.iter().copied());
    }
    capture.f64s("cluster.advance", Value, clusters.advances.iter().copied());
    capture.i64s(
        "cluster.advance_units",
        Value,
        clusters.advance_units.iter().copied(),
    );
    capture.f64s(
        "cluster.units_per_em",
        Value,
        clusters.units_per_em.iter().copied(),
    );
    capture.bools("cluster.ltr", Value, [clusters.ltr]);
    capture.u16s(
        "cluster.glyph.id",
        Value,
        clusters.glyph_ids.iter().copied(),
    );
    capture.u16s(
        "cluster.glyph.shape_flags",
        Value,
        clusters.glyph_shape_flags.iter().copied(),
    );
    for (lane, column) in [
        ("cluster.glyph.x_advance", &clusters.glyph_x_advances),
        ("cluster.glyph.x_offset", &clusters.glyph_x_offsets),
        ("cluster.glyph.y_offset", &clusters.glyph_y_offsets),
    ] {
        capture.i32s(lane, Value, column.iter().copied());
    }
    // Chunk summaries and the word sidecar are derived indexes over the lanes above.
    capture.i64s(
        "cluster.chunk.advance_sum",
        Repr,
        clusters.chunk_advance_sums.iter().copied(),
    );
    capture.i64s(
        "cluster.chunk.auxiliary_sum",
        Repr,
        clusters.chunk_auxiliary_sums.iter().copied(),
    );
    capture.u8s(
        "cluster.chunk.flags_or",
        Repr,
        clusters.chunk_flags_or.iter().copied(),
    );
    capture.u8s(
        "cluster.word_sidecar_mode",
        Repr,
        [clusters.word_sidecar_mode as u8],
    );
    columns!(capture, "cluster.word_break", Repr, clusters.word_breaks, {
        u32s: [cluster_end];
        i32s: [advance_units, space_units];
    });
}

/// Line-edge break corrections `[L, R, S]` and the island shapes behind them. Both fill lazily
/// as the fitter asks, so each is a cache lane: four rows per boundary side, the first "present".
fn break_caches(capture: &mut Capture, clusters: &ClusterArena) {
    for (slot, lane) in ["left", "right", "whole"].into_iter().enumerate() {
        let rows = clusters.break_corrections.iter().flat_map(|entry| {
            entry[slot].get().map_or([0; 4], |correction| {
                [1, correction.advance, correction.space, correction.trailing]
            })
        });
        capture.i32s(&format!("cluster.break_correction.{lane}"), Cache, rows);
    }
    let islands = clusters.islands.borrow();
    for (side, lane) in ["left", "right"].into_iter().enumerate() {
        let rows = islands.slots.iter().flat_map(|slot| {
            let run = slot[side]
                .checked_sub(1)
                .and_then(|index| islands.shape.runs.get(index as usize));
            run.map_or([0; 4], |run| {
                let glyphs = run.glyph_start as usize..(run.glyph_start + run.glyph_count) as usize;
                let digest = island_digest(&islands.shape, glyphs);
                [
                    1,
                    run.glyph_count as i32,
                    digest as u32 as i32,
                    (digest >> 32) as u32 as i32,
                ]
            })
        });
        capture.i32s(&format!("cluster.island.{lane}"), Cache, rows);
    }
}

/// The glyphs an island shapes alone, without their text offsets.
fn island_digest(shape: &ShapeArena, glyphs: core::ops::Range<usize>) -> u64 {
    let mut bytes = Vec::new();
    for glyph in glyphs {
        bytes.extend_from_slice(&shape.glyph_ids[glyph].to_le_bytes());
        bytes.extend_from_slice(&shape.glyph_flags[glyph].to_le_bytes());
        for lane in [&shape.x_advances, &shape.x_offsets, &shape.y_offsets] {
            bytes.extend_from_slice(&lane[glyph].to_le_bytes());
        }
    }
    super::lanes::digest(&bytes)
}

fn layout_runs(capture: &mut Capture, prefix: &str, runs: &[LayoutRun]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    capture.u32s(
        &name("source_kind"),
        Value,
        runs.iter().map(|run| source_kind(run.source_kind)),
    );
    for (lane, class, column) in [
        (
            "cluster_start",
            Value,
            column(runs, |run| run.cluster_start),
        ),
        ("cluster_end", Value, column(runs, |run| run.cluster_end)),
        ("glyph_start", Value, column(runs, |run| run.glyph_start)),
        ("glyph_count", Value, column(runs, |run| run.glyph_count)),
        ("source_run", Value, column(runs, |run| run.source_run)),
        ("font_handle", Value, column(runs, |run| run.font_handle)),
        (
            "numeric_blocks_start",
            Repr,
            column(runs, |run| run.numeric_blocks.start),
        ),
        (
            "numeric_blocks_count",
            Repr,
            column(runs, |run| run.numeric_blocks.count),
        ),
        (
            "numeric_blocks_cluster_start",
            Repr,
            column(runs, |run| run.numeric_blocks.cluster_start),
        ),
        (
            "numeric_blocks_cluster_count",
            Repr,
            column(runs, |run| run.numeric_blocks.cluster_count),
        ),
        (
            "canonical_revision",
            Identity,
            column(runs, |run| run.canonical_revision.map_or(0, |r| r.get())),
        ),
    ] {
        capture.u32s(&name(lane), class, column);
    }
}

/// Paragraph runs are 0; a boundary run packs its role and flow thread.
fn source_kind(kind: LayoutRunSourceKind) -> u32 {
    match kind {
        LayoutRunSourceKind::Paragraph => 0,
        LayoutRunSourceKind::Boundary {
            flow_thread_id,
            role,
        } => {
            let role = match role {
                BoundaryRunRole::BoundarySource => 1,
                BoundaryRunRole::Ellipsis => 2,
            };
            role | (flow_thread_id << 2)
        }
    }
}

/// Run-local geometry is block-relative, so it is representation: a different block cut is a
/// stated difference here and must leave every positioned lane unchanged.
fn run_local(capture: &mut Capture, prefix: &str, arena: &RunLocalArena) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    let blocks: &[NumericBlock] = arena.blocks();
    for (lane, column) in [
        (
            "block.source_glyph_start",
            column(blocks, |block| block.source_glyph_start),
        ),
        (
            "block.source_glyph_count",
            column(blocks, |block| block.source_glyph_count),
        ),
        ("block.row_start", column(blocks, |block| block.row_start)),
        ("block.row_count", column(blocks, |block| block.row_count)),
        ("cluster_block", arena.cluster_blocks().to_vec()),
    ] {
        capture.u32s(&name(lane), Repr, column);
    }
    for (lane, column) in [
        (
            "block.anchor_inline",
            column(blocks, |block| block.anchor_inline),
        ),
        (
            "block.anchor_block",
            column(blocks, |block| block.anchor_block),
        ),
        ("cluster_prefix", arena.cluster_prefixes().to_vec()),
    ] {
        capture.f64s(&name(lane), Repr, column);
    }
    run_local_rows(capture, &name("row"), arena.rows().iter().copied());
}

fn run_local_rows(capture: &mut Capture, prefix: &str, rows: impl Iterator<Item = RunLocalGlyph>) {
    let rows: Vec<RunLocalGlyph> = rows.collect();
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, column) in [
        ("inline_origin", column(&rows, |row| row.inline_origin)),
        ("block_origin", column(&rows, |row| row.block_origin)),
        ("inline_advance", column(&rows, |row| row.inline_advance)),
        (
            "ink_inline_start",
            column(&rows, |row| row.ink_inline_start),
        ),
        ("ink_block_start", column(&rows, |row| row.ink_block_start)),
        (
            "ink_inline_extent",
            column(&rows, |row| row.ink_inline_extent),
        ),
        (
            "ink_block_extent",
            column(&rows, |row| row.ink_block_extent),
        ),
    ] {
        capture.f32s(&name(lane), Repr, column);
    }
    capture.bools(
        &name("has_outline"),
        Repr,
        rows.iter().map(|row| row.has_outline),
    );
}

fn flow(capture: &mut Capture, flow: &FlowLayoutArena) {
    let lines: Vec<FlowLine> = flow.lines.iter().copied().collect();
    flow_lines(capture, "flow.line", &lines);
    let fragments: Vec<FlowFragment> = flow.fragments.iter().copied().collect();
    flow_fragments(capture, "flow.fragment", &fragments);
    capture.u32s(
        "flow.drop_cap.body_resume_cluster",
        Value,
        flow.drop_caps.iter().map(|cap| cap.body_resume_cluster),
    );
    let cap_lines: Vec<FlowLine> = flow.drop_caps.iter().map(|cap| cap.line).collect();
    flow_lines(capture, "flow.drop_cap.line", &cap_lines);
    let cap_fragments: Vec<FlowFragment> = flow.drop_caps.iter().map(|cap| cap.fragment).collect();
    flow_fragments(capture, "flow.drop_cap.fragment", &cap_fragments);
    capture.u32s(
        "flow.ellipsis_threads",
        Value,
        flow.ellipsis_threads().iter().copied(),
    );
}

fn flow_lines(capture: &mut Capture, prefix: &str, lines: &[FlowLine]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, column) in [
        ("flow_thread_id", column(lines, |line| line.flow_thread_id)),
        ("region_id", column(lines, |line| line.region_id)),
        (
            "transform_index",
            column(lines, |line| line.transform_index),
        ),
        ("clip_id", column(lines, |line| line.clip_id)),
        (
            "fragment_count",
            column(lines, |line| u32::from(line.fragment_count)),
        ),
        ("align", column(lines, |line| u32::from(line.align))),
        (
            "typography_height_fallbacks",
            column(lines, |line| u32::from(line.typography.height_fallbacks)),
        ),
    ] {
        capture.u32s(&name(lane), Value, column);
    }
    for (lane, column) in [
        ("block_start", column(lines, |line| line.block_start)),
        ("baseline", column(lines, |line| line.baseline)),
        ("height", column(lines, |line| line.height)),
        (
            "typography_ascent",
            column(lines, |line| line.typography.ascent),
        ),
        (
            "typography_descent",
            column(lines, |line| line.typography.descent),
        ),
        (
            "typography_cap_height",
            column(lines, |line| line.typography.cap_height),
        ),
        (
            "typography_x_height",
            column(lines, |line| line.typography.x_height),
        ),
        (
            "typography_cap_over",
            column(lines, |line| line.typography.cap_over),
        ),
        (
            "typography_x_over",
            column(lines, |line| line.typography.x_over),
        ),
    ] {
        capture.f64s(&name(lane), Value, column);
    }
}

fn flow_fragments(capture: &mut Capture, prefix: &str, fragments: &[FlowFragment]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, column) in [
        (
            "cluster_start",
            column(fragments, |fragment| fragment.line.cluster_start),
        ),
        (
            "cluster_end",
            column(fragments, |fragment| fragment.line.cluster_end),
        ),
        (
            "text_start",
            column(fragments, |fragment| fragment.line.text_start),
        ),
        (
            "text_end",
            column(fragments, |fragment| fragment.line.text_end),
        ),
        (
            "boundary_index",
            column(fragments, |fragment| fragment.boundary_index),
        ),
        (
            "lead_index",
            column(fragments, |fragment| fragment.lead_index),
        ),
        (
            "tail_index",
            column(fragments, |fragment| fragment.tail_index),
        ),
    ] {
        capture.u32s(&name(lane), Value, column);
    }
    for (lane, column) in [
        (
            "advance",
            column(fragments, |fragment| fragment.line.advance),
        ),
        (
            "hung_advance",
            column(fragments, |fragment| fragment.line.hung_advance),
        ),
        (
            "slot_start",
            column(fragments, |fragment| fragment.slot_start),
        ),
        ("slot_end", column(fragments, |fragment| fragment.slot_end)),
    ] {
        capture.f64s(&name(lane), Value, column);
    }
    for (lane, column) in [
        (
            "start_correction_advance",
            column(fragments, |f| f.line.start_correction.advance),
        ),
        (
            "start_correction_space",
            column(fragments, |f| f.line.start_correction.space),
        ),
        (
            "start_correction_trailing",
            column(fragments, |f| f.line.start_correction.trailing),
        ),
        (
            "end_correction_advance",
            column(fragments, |f| f.line.end_correction.advance),
        ),
        (
            "end_correction_space",
            column(fragments, |f| f.line.end_correction.space),
        ),
        (
            "end_correction_trailing",
            column(fragments, |f| f.line.end_correction.trailing),
        ),
    ] {
        capture.i32s(&name(lane), Value, column);
    }
    capture.bools(
        &name("hard_break"),
        Value,
        fragments.iter().map(|fragment| fragment.line.hard_break),
    );
    capture.bools(
        &name("flexible_end"),
        Value,
        fragments.iter().map(|fragment| fragment.flexible_end),
    );
}

/// Line-edge islands and ellipses: the glyphs a corrected or truncated line draws instead of
/// the paragraph's own.
fn boundary_shape(capture: &mut Capture, boundary: &BoundaryShapeArena) {
    columns!(capture, "boundary.record", Value, boundary.records, {
        u32s: [
            flow_thread_id, source_run, cluster_start, cluster_end, text_end,
            source_binding_handle, source_font_handle, ellipsis_binding_handle,
            ellipsis_font_handle, source_glyph_start, source_glyph_count, ellipsis_glyph_start,
            ellipsis_glyph_count,
        ];
        bools: [line_start];
    });
    shape(capture, "boundary.shape", &boundary.shape);
    capture.u32s(
        "boundary.stable_id",
        Identity,
        boundary.stable_ids.iter().copied(),
    );
}

fn positioned(
    capture: &mut Capture,
    positioned: &PositionedGlyphArena,
    clusters: &ClusterArena,
    boundary: &BoundaryShapeArena,
) -> Result<(), String> {
    let mut cursor = positioned
        .occurrence_cursor(0, clusters, boundary)
        .map_err(debug)?;
    let mut rows = Vec::with_capacity(positioned.occurrence_count());
    let mut outlined = Vec::with_capacity(positioned.occurrence_count());
    while let Some(row) = cursor.next_row().map_err(debug)? {
        rows.push(row.semantic);
        outlined.push(row.has_outline);
    }
    if rows.len() != positioned.occurrence_count() {
        return Err(format!(
            "positioned cursor yielded {} of {} occurrences",
            rows.len(),
            positioned.occurrence_count()
        ));
    }
    positioned_rows(capture, "positioned.glyph", &rows);
    capture.bools("positioned.glyph.has_outline", Value, outlined);
    let (starts, counts) = positioned.semantic_line_glyph_spans();
    capture.u32s("positioned.line.glyph_start", Value, starts.iter().copied());
    capture.u32s("positioned.line.glyph_count", Value, counts.iter().copied());
    capture.f64s(
        "positioned.line.inline_extent",
        Value,
        positioned.semantic_line_inline_extents().iter().copied(),
    );
    decorations(capture, positioned.decorations());
    placement(
        capture,
        "positioned.placement",
        positioned.placement_segments(),
    );
    let translations = positioned.placement_translations();
    capture.f64s(
        "positioned.placement.translation_inline",
        Repr,
        translations.iter().map(|t| t.translation_inline),
    );
    capture.f64s(
        "positioned.placement.translation_block",
        Repr,
        translations.iter().map(|t| t.translation_block),
    );
    layout_runs(
        capture,
        "positioned.replacement_run",
        positioned.replacement_runs(),
    );
    run_local(
        capture,
        "positioned.replacement_run_local",
        positioned.replacement_run_local(),
    );
    Ok(())
}

/// Segment-relative glyph rows: the origin lanes are representation because the segment cut
/// is; the placed rows in `public.glyph` are the value.
fn positioned_rows(capture: &mut Capture, prefix: &str, rows: &[PositionedSemanticGlyph]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, class, column) in [
        ("stable_id", Identity, column(rows, |row| row.stable_id)),
        ("font_handle", Value, column(rows, |row| row.font_handle)),
        ("cluster", Value, column(rows, |row| row.cluster)),
        (
            "glyph_id",
            Value,
            column(rows, |row| u32::from(row.glyph_id)),
        ),
        ("flags", Value, column(rows, |row| u32::from(row.flags))),
        (
            "bidi_level",
            Value,
            column(rows, |row| u32::from(row.bidi_level)),
        ),
        (
            "placement_segment",
            Repr,
            column(rows, |row| row.placement_segment),
        ),
    ] {
        capture.u32s(&name(lane), class, column);
    }
    for (lane, class, column) in [
        ("font_size", Value, column(rows, |row| row.font_size)),
        (
            "inline_advance",
            Value,
            column(rows, |row| row.inline_advance),
        ),
        (
            "ink_inline_extent",
            Value,
            column(rows, |row| row.ink_inline_extent),
        ),
        (
            "ink_block_extent",
            Value,
            column(rows, |row| row.ink_block_extent),
        ),
        ("inline_origin", Repr, column(rows, |row| row.inline_origin)),
        ("block_origin", Repr, column(rows, |row| row.block_origin)),
        (
            "ink_inline_start",
            Repr,
            column(rows, |row| row.ink_inline_start),
        ),
        (
            "ink_block_start",
            Repr,
            column(rows, |row| row.ink_block_start),
        ),
    ] {
        capture.f32s(&name(lane), class, column);
    }
}

fn decorations(capture: &mut Capture, decorations: &[DecorationRecord]) {
    columns!(capture, "positioned.decoration", Value, decorations, {
        u32s: [flags, color, material_id, clip_id, region_id, flow_thread_id, transform_index];
        u8s: [style];
        f32s: [inline_start, inline_extent, block_start, block_extent];
    });
}

fn placement(capture: &mut Capture, prefix: &str, segments: &[PlacementSegment]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, column) in [
        ("fragment_index", column(segments, |s| s.fragment_index)),
        (
            "layout_run_owner",
            column(segments, |s| match s.layout_run_owner {
                LayoutRunOwner::Paragraph => 0,
                LayoutRunOwner::Replacement => 1,
            }),
        ),
        ("layout_run_index", column(segments, |s| s.layout_run_index)),
        (
            "identity",
            column(segments, |s| match s.identity {
                PlacementIdentity::StableSource => 0,
                PlacementIdentity::Dense => 1,
            }),
        ),
        (
            "numeric_block_ordinal",
            column(segments, |s| s.numeric_block_ordinal),
        ),
        (
            "run_cluster_start",
            column(segments, |s| s.run_cluster_start),
        ),
        (
            "run_cluster_count",
            column(segments, |s| s.run_cluster_count),
        ),
        (
            "glyph_source",
            column(segments, |s| match s.glyph_source {
                GlyphSource::LayoutRun => 0,
                GlyphSource::Boundary => 1,
            }),
        ),
        (
            "source_glyph_start",
            column(segments, |s| s.source_glyph_start),
        ),
        (
            "source_glyph_count",
            column(segments, |s| s.source_glyph_count),
        ),
    ] {
        capture.u32s(&name(lane), Repr, column);
    }
    // Anchors name stable text ids, so they follow the edit history.
    for (lane, column) in [
        ("segment_anchor", column(segments, |s| s.segment_anchor)),
        ("source_anchor", column(segments, |s| s.source_anchor)),
    ] {
        capture.u32s(&name(lane), Identity, column);
    }
}

/// The short-label owner: one run, one line, compact rows.
fn inline_leaf(capture: &mut Capture, leaf: &InlineLeaf) {
    let glyphs = leaf.shape.glyphs();
    columns!(capture, "inline.shape.glyph", Value, glyphs, {
        u16s: [glyph_id, flags];
        u32s: [cluster];
        i32s: [x_advance, y_advance, x_offset, y_offset];
    });
    let runs: Vec<_> = leaf.shape.run().into_iter().collect();
    columns!(capture, "inline.shape.run", Value, runs, {
        u32s: [
            source_run, binding_handle, font_handle, text_start, text_end, glyph_start,
            glyph_count,
        ];
    });
    columns!(capture, "inline.cluster", Value, leaf.clusters, {
        u32s: [
            text_start, text_end, glyph_start, glyph_count, style_index, source_run,
            binding_handle, font_handle,
        ];
        f64s: [advance, units_per_em];
        i64s: [advance_units];
        u8s: [flags];
        bools: [shaped, unsafe_before];
    });
    capture.u32s(
        "inline.cluster.stable_text_id",
        Identity,
        leaf.clusters.iter().map(|cluster| cluster.stable_text_id),
    );
    let rows: Vec<_> = (0..leaf.semantic_count() as u32)
        .filter_map(|source| leaf.row(source))
        .collect();
    let semantic: Vec<_> = rows.iter().map(|row| row.semantic).collect();
    positioned_rows(capture, "inline.row", &semantic);
    capture.bools(
        "inline.row.has_outline",
        Value,
        rows.iter().map(|row| row.has_outline),
    );
    let lines: Vec<FlowLine> = leaf.line.into_iter().collect();
    flow_lines(capture, "inline.line", &lines);
    let fragments: Vec<FlowFragment> = leaf.fragment.into_iter().collect();
    flow_fragments(capture, "inline.fragment", &fragments);
    let runs: Vec<LayoutRun> = leaf.layout_run.into_iter().collect();
    layout_runs(capture, "inline.layout_run", &runs);
    capture.f64s(
        "inline.intrinsic",
        Value,
        [
            leaf.intrinsics.min_content_width,
            leaf.intrinsics.max_content_width,
            leaf.inline_extent,
        ],
    );
    placement(capture, "inline.placement", leaf.placement.segment_rows());
    let translations = leaf.placement_translations();
    capture.f64s(
        "inline.placement.translation_inline",
        Repr,
        translations.iter().map(|t| t.translation_inline),
    );
    capture.f64s(
        "inline.placement.translation_block",
        Repr,
        translations.iter().map(|t| t.translation_block),
    );
}

/// What a host can read back: placed glyph records, the semantic records each call returned,
/// and the encoded publication.
fn public_glyphs(capture: &mut Capture, session: &Session, paragraph: u32) -> Result<(), String> {
    let count = session
        .engine
        .borrowed_paragraph_layout(ROOT_ID, paragraph)
        .map_err(debug)?;
    let mut glyphs = alloc::vec![SemanticGlyph::default(); count];
    session
        .engine
        .borrowed_paragraph_glyphs(ROOT_ID, paragraph, 0, &mut glyphs)
        .map_err(debug)?;
    columns!(capture, "public.glyph", Value, glyphs, {
        u32s: [font_handle, cluster];
        u16s: [glyph_id, flags];
        u8s: [bidi_level];
        f32s: [
            font_size, inline_origin, block_origin, inline_advance, ink_inline_start,
            ink_block_start, ink_inline_extent, ink_block_extent,
        ];
    });
    capture.u32s(
        "public.glyph.stable_id",
        Identity,
        glyphs.iter().map(|glyph| glyph.stable_id),
    );
    Ok(())
}

/// The semantic records each call returned, and the encoded publication.
fn views(capture: &mut Capture, output: &StepOutput) {
    semantic_records(capture, "view.published", &output.published_views);
    semantic_records(capture, "view.measured_first", &output.measured_first);
    // With no read after the publication the first paragraph still has its (empty) lanes.
    if output.measured_after.is_empty() {
        semantic_records(capture, "view.measured_after", &[]);
    }
    for (paragraph, records) in &output.measured_after {
        capture.prefix = paragraph_prefix(*paragraph);
        semantic_records(capture, "view.measured_after", records);
    }
    capture.prefix.clear();
    capture.u8s("wire.publication", Wire, output.publication.iter().copied());
}

/// Line, measurement and glyph records: line and paragraph ink live here.
fn semantic_records(capture: &mut Capture, prefix: &str, records: &[SemanticRecord]) {
    let name = |lane: &str| format!("{prefix}.{lane}");
    for (lane, class, column) in [
        ("id", Identity, column(records, |record| record.id)),
        ("parent_id", Identity, column(records, |r| r.parent_id)),
        ("kind", Value, column(records, |r| u32::from(r.kind))),
        ("flags", Value, column(records, |r| u32::from(r.flags))),
        ("text_start", Value, column(records, |r| r.text_start)),
        ("text_end", Value, column(records, |r| r.text_end)),
        ("item_start", Value, column(records, |r| r.item_start)),
        ("item_count", Value, column(records, |r| r.item_count)),
    ] {
        capture.u32s(&name(lane), class, column);
    }
    for (lane, column) in [
        ("inline_start", column(records, |r| r.inline_start)),
        ("block_start", column(records, |r| r.block_start)),
        ("inline_extent", column(records, |r| r.inline_extent)),
        ("block_extent", column(records, |r| r.block_extent)),
        ("inline_advance", column(records, |r| r.inline_advance)),
        ("ink_inline_start", column(records, |r| r.ink_inline_start)),
        ("ink_block_start", column(records, |r| r.ink_block_start)),
        (
            "ink_inline_extent",
            column(records, |r| r.ink_inline_extent),
        ),
        ("ink_block_extent", column(records, |r| r.ink_block_extent)),
        ("ascent", column(records, |r| r.ascent)),
        (
            "min_content_width",
            column(records, |r| r.min_content_width),
        ),
        (
            "max_content_width",
            column(records, |r| r.max_content_width),
        ),
        ("cap_height_top", column(records, |r| r.cap_height_top)),
        ("x_height_top", column(records, |r| r.x_height_top)),
    ] {
        capture.f32s(&name(lane), Value, column);
    }
}

/// The gathered codec input: every projected field of every outlined glyph, in plan order.
fn gather(capture: &mut Capture, session: &Session) {
    let view = session.engine.gather.view();
    let input = view.plan_input();
    let glyphs = input.glyphs;
    for (lane, class, column) in [
        ("stable_id", Identity, column(glyphs, |g| g.stable_id)),
        (
            "content_revision",
            Identity,
            column(glyphs, |g| g.content_revision),
        ),
        ("semantic_id", Identity, column(glyphs, |g| g.semantic_id)),
        ("technique", Value, column(glyphs, |g| g.technique.0)),
        (
            "program_variant",
            Value,
            column(glyphs, |g| u32::from(g.program_variant)),
        ),
        ("resource_id", Value, column(glyphs, |g| g.resource_id)),
        (
            "resource_generation",
            Value,
            column(glyphs, |g| g.resource_generation),
        ),
        (
            "resource_kind",
            Value,
            column(glyphs, |g| u32::from(g.resource_kind)),
        ),
        (
            "resource_reference",
            Value,
            column(glyphs, |g| g.resource_reference),
        ),
        ("transform_id", Value, column(glyphs, |g| g.transform_id)),
        ("material_id", Value, column(glyphs, |g| g.material_id)),
        ("clip_id", Value, column(glyphs, |g| g.clip_id)),
        ("depth_key", Value, column(glyphs, |g| g.depth_key)),
    ] {
        capture.u32s(&format!("gather.glyph.{lane}"), class, column);
    }
    for (lane, column) in [
        ("inline_start", column(glyphs, |g| g.inline_start)),
        ("block_start", column(glyphs, |g| g.block_start)),
        ("inline_extent", column(glyphs, |g| g.inline_extent)),
        ("block_extent", column(glyphs, |g| g.block_extent)),
    ] {
        capture.f32s(&format!("gather.glyph.{lane}"), Value, column);
    }
    capture.u32s(
        "gather.placement_slot",
        Identity,
        input.placement_slots.iter().copied(),
    );
    for (field, values) in input.f32_fields.iter().enumerate() {
        capture.f32s(
            &format!("gather.f32.{field:02}"),
            Value,
            values.iter().copied(),
        );
    }
    for (field, values) in input.u32_fields.iter().enumerate() {
        let class = if IDENTITY_U32_FIELDS.contains(&(field as u8)) {
            Identity
        } else {
            Value
        };
        capture.u32s(
            &format!("gather.u32.{field:02}"),
            class,
            values.iter().copied(),
        );
    }
}

/// The renderer's buffers after every patch so far, which must also be exactly the bytes the
/// engine believes the renderer holds.
///
/// The session placement buffer is indexed by placement slot, and slots are handed out in
/// history order, so its bytes are identity. What a glyph draws with is the value: each
/// gathered glyph's translation, read through its own slot.
fn host_buffers(
    capture: &mut Capture,
    session: &Session,
    planner: &PlannerState,
) -> Result<(), String> {
    let gathered = session.engine.gather.view();
    let slots = gathered.plan_input().placement_slots;
    let mut placement: &[u8] = &[];
    for (id, bytes) in session.host_buffers.iter() {
        if let Some(retained) = planner.plan.buffer_bytes(id)
            && retained.get(..bytes.len()) != Some(bytes)
        {
            return Err(format!(
                "buffer {id}: applying the published patches does not reproduce the engine's retained bytes"
            ));
        }
        if id == SESSION_PLACEMENT_BUFFER_ID {
            placement = bytes;
            capture.u8s("gpu.session_placement", Identity, bytes.iter().copied());
        } else {
            // Capacity and slack follow the history; `gpu.drawn` below is the value.
            capture.u8s(
                &format!("gpu.buffer.{id:08x}"),
                Identity,
                bytes.iter().copied(),
            );
        }
    }
    for (axis, lane) in ["inline", "block"].into_iter().enumerate() {
        let rows = slots.iter().map(|slot| {
            let at = *slot as usize * 8 + axis * 4;
            placement.get(at..at + 4).map_or(u32::MAX, |word| {
                u32::from_le_bytes([word[0], word[1], word[2], word[3]])
            })
        });
        capture.u32s(&format!("gpu.glyph.translation_{lane}"), Value, rows);
    }
    capture.u8s("gpu.drawn", Value, session.host_buffers.drawn()?);
    plan_records(capture, session);
    Ok(())
}

/// Stages added after the first reference set was frozen. A case frozen before them leaves
/// them out of its frozen text, so its file stays byte-identical; the differential compares
/// them for every case.
pub const EXTENDED_STAGES: [&str; 3] = ["plan", "doc", "decorated"];

/// The draw structure the renderer holds: what each packet binds (material, clip, depth,
/// transform) and what each primitive span names. A paint change that republishes retained
/// rows must still restate these.
fn plan_records(capture: &mut Capture, session: &Session) {
    let draws = session.host_buffers.draws();
    for (lane, class, column) in [
        ("program_id", Value, column(draws, |d| d.program_id)),
        (
            "program_variant",
            Value,
            column(draws, |d| u32::from(d.program_variant)),
        ),
        ("flags", Value, column(draws, |d| u32::from(d.flags))),
        ("material_id", Value, column(draws, |d| d.material_id)),
        ("clip_id", Value, column(draws, |d| d.clip_id)),
        ("depth_key", Value, column(draws, |d| d.depth_key)),
        ("transform_id", Value, column(draws, |d| d.transform_id)),
        (
            "primitive_count",
            Value,
            column(draws, |d| d.primitive_count),
        ),
        ("buffer_count", Value, column(draws, |d| d.buffer_count)),
        ("resource_count", Value, column(draws, |d| d.resource_count)),
        ("id", Identity, column(draws, |d| d.id)),
        ("order_token", Identity, column(draws, |d| d.order_token)),
    ] {
        capture.u32s(&format!("plan.draw.{lane}"), class, column);
    }
    let primitives = session.host_buffers.primitives();
    for (lane, class, column) in [
        ("kind", Value, column(primitives, |p| u32::from(p.kind))),
        ("flags", Value, column(primitives, |p| u32::from(p.flags))),
        (
            "technique_id",
            Value,
            column(primitives, |p| p.technique_id),
        ),
        ("resource_id", Value, column(primitives, |p| p.resource_id)),
        (
            "resource_generation",
            Value,
            column(primitives, |p| p.resource_generation),
        ),
        ("program_id", Value, column(primitives, |p| p.program_id)),
        (
            "program_variant",
            Value,
            column(primitives, |p| u32::from(p.program_variant)),
        ),
        (
            "record_count",
            Value,
            column(primitives, |p| u32::from(p.record_count)),
        ),
        ("clip_id", Value, column(primitives, |p| p.clip_id)),
        ("id", Identity, column(primitives, |p| p.id)),
        ("buffer_id", Identity, column(primitives, |p| p.buffer_id)),
        (
            "record_index",
            Identity,
            column(primitives, |p| p.record_index),
        ),
        (
            "logical_order",
            Identity,
            column(primitives, |p| p.logical_order),
        ),
        (
            "semantic_id",
            Identity,
            column(primitives, |p| p.semantic_id),
        ),
    ] {
        capture.u32s(&format!("plan.primitive.{lane}"), class, column);
    }
    for (lane, column) in [
        ("inline_start", column(primitives, |p| p.inline_start)),
        ("block_start", column(primitives, |p| p.block_start)),
        ("inline_extent", column(primitives, |p| p.inline_extent)),
        ("block_extent", column(primitives, |p| p.block_extent)),
    ] {
        capture.f32s(&format!("plan.primitive.{lane}"), Value, column);
    }
}

/// Projected u32 fields that carry allocation-order identity rather than layout.
const IDENTITY_U32_FIELDS: [u8; 3] = [
    crate::engine::frame::SEMANTIC_U32_CLUSTER_ID,
    crate::engine::frame::SEMANTIC_U32_STABLE_GLYPH_ID,
    crate::engine::frame::SEMANTIC_U32_PLACEMENT_SLOT,
];

fn debug(error: impl core::fmt::Debug) -> String {
    format!("{error:?}")
}
