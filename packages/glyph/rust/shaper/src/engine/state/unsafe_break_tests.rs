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
