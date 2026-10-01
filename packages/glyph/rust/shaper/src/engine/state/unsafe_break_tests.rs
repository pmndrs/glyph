//! Unsafe legal breaks: which the fitter classifies, how often, and how a font that flags every boundary is bounded.

use core::cell::Cell;

use super::*;
use crate::engine::{
    cluster_state::{CLUSTER_SAFE_BEFORE, ISLAND_CAP},
    frame::{WRAP_NONE, WRAP_WORD},
    line_composition::{LineCursor, layout_next_line_integer},
};

const UNIT: i64 = 1 << 16;

/// `count` one-unit clusters whose every boundary but the last is a corrected break, in one font.
fn corrected_arena(count: usize) -> ClusterArena {
    let mut c = ClusterArena::default();
    for i in 0..count {
        c.starts.push(i as u32);
        c.ends.push(i as u32 + 1);
        c.advance_units.push(UNIT);
        c.source_runs.push(0);
        c.binding_handles.push(1);
        c.font_handles.push(1);
        let last = i + 1 == count;
        c.flags.push(match (i, last) {
            (0, _) => CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
            (_, true) => 0,
            _ => CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION,
        });
    }
    c.break_corrections.resize_with(count, Default::default);
    c
}

/// Answers every break as a plain corrected one and counts what the fitter asks.
#[derive(Default)]
struct Counting {
    refused: Cell<usize>,
    priced: usize,
}

impl BreakCorrections for Counting {
    fn left(&mut self, _: usize) -> Result<Correction, EngineError> {
        self.priced += 1;
        Ok(Correction::ZERO)
    }
    fn right(&mut self, _: usize) -> Result<Correction, EngineError> {
        self.priced += 1;
        Ok(Correction::ZERO)
    }
    fn whole_line(&mut self, _: usize, _: usize) -> Result<Option<Correction>, EngineError> {
        self.priced += 1;
        Ok(None)
    }
    fn refused(&self, _: usize) -> bool {
        self.refused.set(self.refused.get() + 1);
        false
    }
}

fn lines(
    clusters: &ClusterArena,
    wrap: u8,
    width: i64,
    corrections: &mut impl BreakCorrections,
) -> usize {
    let mut cursor = LineCursor::at_cluster(0);
    let mut lines = 0;
    while layout_next_line_integer(clusters, &mut cursor, Some(width), wrap, 0.0, corrections)
        .unwrap()
        .is_some()
    {
        lines += 1;
    }
    lines
}

#[test]
fn no_break_is_classified_or_priced_without_word_wrap() {
    let clusters = corrected_arena(200);
    let mut counting = Counting::default();
    assert_eq!(lines(&clusters, WRAP_NONE, 10 * UNIT, &mut counting), 1);
    assert_eq!((counting.refused.get(), counting.priced), (0, 0));
}

#[test]
fn only_the_breaks_a_line_evaluates_are_classified() {
    let clusters = corrected_arena(200);
    let mut counting = Counting::default();
    let count = lines(&clusters, WRAP_WORD, 10 * UNIT, &mut counting);
    assert_eq!(count, 20);
    // The overflowing candidate and the selected one per line; the 190 interior candidates stay unasked.
    assert!(
        counting.refused.get() <= 2 * count,
        "{} classifications",
        counting.refused.get()
    );
    let mut all_on_one_line = Counting::default();
    assert_eq!(
        lines(&clusters, WRAP_WORD, 1_000 * UNIT, &mut all_on_one_line),
        1
    );
    assert_eq!(all_on_one_line.refused.get(), 0);
}

#[test]
fn a_chain_of_unsafe_boundaries_longer_than_the_cap_is_never_shaped() {
    // No font is registered, so any attempt to reshape an island fails.
    let clusters = corrected_arena(10 * ISLAND_CAP);
    let (mut registry, styles) = (ShaperRegistry::default(), StyleArena::default());
    let shaper = RefCell::new(&mut registry);
    let mut corrections = ShapedBreakCorrections {
        shaper: &shaper,
        text: &[],
        runs: &[],
        styles: &styles,
        clusters: &clusters,
    };
    for boundary in [1, ISLAND_CAP, 5 * ISLAND_CAP] {
        assert_eq!(corrections.left(boundary).unwrap(), Correction::ZERO);
        assert!(corrections.refused(boundary), "boundary {boundary}");
        assert_eq!(corrections.right(boundary).unwrap(), Correction::ZERO);
        assert_eq!(corrections.whole_line(0, boundary + 1).unwrap(), None);
    }
    // Every break is refused, so the paragraph is one overlong line: the fit never reaches for a shaper.
    assert_eq!(lines(&clusters, WRAP_WORD, 10 * UNIT, &mut corrections), 1);
}

#[test]
fn islands_compare_as_ordered_glyph_sequences() {
    let drawn = |alone: &[u32], paragraph: &[u16]| same_glyphs(alone.iter().copied(), paragraph);
    assert!(drawn(&[7, 9], &[7, 9]));
    assert!(!drawn(&[7, 7], &[7, 9]), "a repeat keeps every id present");
    assert!(!drawn(&[9, 7], &[7, 9]), "a reorder keeps every id present");
    assert!(!drawn(&[7], &[7, 9]));
    assert!(!drawn(&[7, 9, 9], &[7, 9]));
}

/// Inter, registered as font 1 with empty extents: enough to shape islands for real.
fn inter() -> ShaperRegistry {
    const INTER: &[u8] =
        include_bytes!("../../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
    let mut registry = ShaperRegistry::default();
    let extents = vec![0u8; 2937 * 8];
    let availability = vec![0u8; 2937usize.div_ceil(8)];
    assert_eq!(
        registry.register_font(1, INTER, &extents, &availability, 0, 0),
        0
    );
    registry
}

/// `text` in font 1, a cluster per unit, a corrected break after each space.
fn text_arena(text: &[u16]) -> ClusterArena {
    let mut c = corrected_arena(text.len());
    for (i, unit) in text.iter().enumerate() {
        c.units_per_em.push(1000.0);
        c.glyph_starts.push(i as u32);
        c.glyph_counts.push(1);
        c.glyph_ids.push(0);
        c.stable_ids.push(i as u32 + 1);
        // Words break after a space, and only there.
        if *unit == 0x20 {
            c.flags[i] |= CLUSTER_SPACE;
        } else {
            c.flags[i] &= !(CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION);
        }
        // Only the cluster after a space is unsafe to break before, so each island is a space and its neighbour.
        if i == 0 || text[i - 1] != 0x20 {
            c.flags[i] |= CLUSTER_SAFE_BEFORE;
        }
    }
    c
}

/// Lays `clusters` out in lines `width` units wide and gives each line its edge records, as a layout does.
fn lay_out(
    clusters: &ClusterArena,
    text: &[u16],
    width: i64,
    registry: &mut ShaperRegistry,
) -> BoundaryShapeArena {
    let styles = StyleArena::default();
    let run = ShapingRun {
        text_start: 0,
        text_end: text.len() as u32,
        script: u32::from_be_bytes(*b"Latn"),
        direction: 0,
        bidi_level: 0,
        style: Default::default(),
    };
    let shaper = RefCell::new(registry);
    let mut corrections = ShapedBreakCorrections {
        shaper: &shaper,
        text,
        runs: &[run],
        styles: &styles,
        clusters,
    };
    let mut cursor = LineCursor::at_cluster(0);
    let mut out = BoundaryShapeArena::default();
    let mut next_glyph_id = 1;
    while let Some(line) = layout_next_line_integer(
        clusters,
        &mut cursor,
        Some(width * UNIT),
        WRAP_WORD,
        0.0,
        &mut corrections,
    )
    .unwrap()
    {
        let fragment = FlowFragment {
            line,
            slot_start: 0.0,
            slot_end: 0.0,
            flexible_end: false,
            boundary_index: NO_BOUNDARY,
            lead_index: NO_BOUNDARY,
            tail_index: NO_BOUNDARY,
        };
        corrections
            .line_edge_records(fragment, 0, (&mut out, &[]), &mut next_glyph_id)
            .unwrap();
    }
    out
}

fn shapings() -> usize {
    crate::SHAPINGS.with(Cell::get)
}

fn drawn(out: &BoundaryShapeArena) -> (Vec<u16>, Vec<u32>, Vec<i32>) {
    let s = &out.shape;
    (
        s.glyph_ids.clone(),
        s.clusters.clone(),
        s.x_advances.clone(),
    )
}

#[test]
fn a_geometry_only_relayout_shapes_no_island() {
    let text: Vec<u16> = "Reveals one grapheme at a time".encode_utf16().collect();
    let (clusters, mut registry) = (text_arena(&text), inter());
    let before = shapings();
    let first = lay_out(&clusters, &text, 14, &mut registry);
    assert!(shapings() > before, "a cold layout shapes its islands");
    assert!(!first.records.is_empty(), "the layout drew line edges");
    // The same clusters laid out again, as a width change does: pricing and edge records reuse the islands.
    let before = shapings();
    let again = lay_out(&clusters, &text, 15, &mut registry);
    assert_eq!(shapings() - before, 0, "a relayout reshaped an island");
    assert_eq!(drawn(&again), drawn(&first));
}

#[test]
fn a_cluster_rebuild_empties_the_island_cache_and_draws_what_a_cold_build_does() {
    let text: Vec<u16> = "Reveals one grapheme at a time".encode_utf16().collect();
    let edited: Vec<u16> = "Reveals ONE grapheme at a time".encode_utf16().collect();
    let (mut clusters, mut registry) = (text_arena(&text), inter());
    lay_out(&clusters, &text, 14, &mut registry);
    assert!(!clusters.islands.borrow().shape.runs.is_empty());
    // The cluster stage clears the arena before it rebuilds it.
    clusters.clear();
    assert!(clusters.islands.borrow().shape.runs.is_empty());
    assert!(clusters.islands.borrow().slots.is_empty());
    let rebuilt = text_arena(&edited);
    let before = shapings();
    let warm = lay_out(&rebuilt, &edited, 14, &mut registry);
    assert!(shapings() > before, "an edit reshapes its islands");
    // Nothing stale: a cold arena over the edited text draws the same glyphs.
    let cold = lay_out(&text_arena(&edited), &edited, 14, &mut registry);
    assert_eq!(drawn(&warm), drawn(&cold));
}
