//! Properties of the editing queries that must hold for every fixture of the layout oracle's
//! matrix: scripts, alignments, directions, fallback, spans, drop caps, ellipses, exclusions,
//! labels on both sides of the inline-owner bound, and the degenerate texts an editor passes
//! through.
//!
//! `GLYPH_ADVERSARIAL_FONTS=… cargo test --release --features oracle --test editing_properties
//! -- --nocapture` prints the per-script table. A case whose fonts are not on this machine is
//! skipped and counted, never passed.

mod editing;

use std::collections::BTreeMap;

use editing::{adversarial_root, editing, prepare_lanes, session, try_library};
use pmndrs_glyph_shaper::engine::{
    ParagraphSource,
    editing::{
        Caret, Editing, GlyphRole, LayoutSource, TextDirection, TextPosition, TextUnit,
        is_hard_break_unit,
    },
    oracle::{
        fonts::{FONTS, FontLibrary},
        fuzz::scripted,
        matrix::{Case, cases},
        session::Session,
    },
};

type Queries<'a> = Editing<ParagraphSource<'a>>;

/// The engine's `ALIGN_JUSTIFY`.
const ALIGN_JUSTIFY: u8 = 4;

#[derive(Default)]
struct Tally {
    cases: usize,
    stops: usize,
    interior_ligature_stops: usize,
    suppressed_boundaries: usize,
    carets: usize,
    clipped_carets: usize,
    split_carets: usize,
    round_trips_exact: usize,
    round_trips_shared: usize,
    logical_moves: usize,
    lines_walked: usize,
    boundary_units: usize,
    ranges: usize,
    edits_compared: usize,
    /// Lines on which a text glyph is placed left of the glyph the pen placed before it: the
    /// pen only moves right, so these are glyphs positioning drew away from their pen.
    pen_reversals: usize,
    failures: Vec<String>,
}

impl Tally {
    fn fail(&mut self, case: &str, message: String) {
        if self.failures.len() < 12 {
            self.failures.push(format!("{case}: {message}"));
        } else if self.failures.len() == 12 {
            self.failures.push("…".into());
        }
    }
}

fn all_fonts() -> FontLibrary {
    let mut library = FontLibrary::default();
    for font in FONTS {
        if let Ok(one) = try_library(&[font.key])
            && let Some(prepared) = one.get(font.key)
        {
            library
                .insert(font.key, prepared.sfnt.clone())
                .expect("a font that prepared once");
        }
    }
    library
}

fn both(offset: u32) -> [TextPosition; 2] {
    [
        TextPosition::downstream(offset),
        TextPosition::upstream(offset),
    ]
}

fn centre(caret: &Caret) -> (f64, f64) {
    (caret.rect.x, caret.rect.y + caret.rect.height * 0.5)
}

/// A spot on the page, exactly.
fn spot(caret: &Caret) -> (u32, u64, u64) {
    (caret.line, caret.rect.x.to_bits(), caret.rect.y.to_bits())
}

/// `hit_test(centre of caret(p)) == p` for every stop and affinity, in normal form. Where
/// several positions are drawn at one spot (the two sides of a bidi boundary, a zero-width
/// grapheme) the hit must be one of them: which one is pinned by the hand-written cases.
fn round_trip(tally: &mut Tally, name: &str, queries: &Queries<'_>, stops: &[u32]) {
    let mut drawn: BTreeMap<(u32, u64, u64), Vec<TextPosition>> = BTreeMap::new();
    for &offset in stops {
        for position in both(offset) {
            let caret = queries.caret(position).expect("caret");
            let normal = queries.normalize(position).expect("normalize");
            let names = drawn.entry(spot(&caret)).or_default();
            if !caret.clipped && !names.contains(&normal) {
                names.push(normal);
            }
        }
    }
    for &offset in stops {
        for position in both(offset) {
            let caret = queries.caret(position).expect("caret");
            tally.carets += 1;
            tally.split_carets += usize::from(caret.secondary.is_some());
            if caret.clipped {
                tally.clipped_carets += 1;
                continue;
            }
            if caret.rect.height == 0.0 {
                continue;
            }
            let (x, y) = centre(&caret);
            let hit = queries.hit_test(x, y).expect("hit test");
            let normal = queries.normalize(position).expect("normalize");
            if hit == normal {
                tally.round_trips_exact += 1;
                continue;
            }
            let landed = queries.caret(hit).expect("caret of the hit");
            // A drop cap's inner edge is the body's start at another height: one x, two boxes.
            let cap_edge =
                landed.rect.x == caret.rect.x && landed.line == caret.line && hit.offset == offset;
            let shared = drawn.get(&spot(&caret)).map_or(0, Vec::len) > 1;
            if (spot(&landed) == spot(&caret) && shared) || cap_edge {
                tally.round_trips_shared += 1;
            } else {
                tally.fail(
                    name,
                    format!(
                        "hit_test(caret({position:?})) = {hit:?}, drawn at {:?} not {:?}",
                        landed.rect, caret.rect
                    ),
                );
            }
        }
    }
}

/// `move(move(p, forward), backward) == p` and its mirror, over consecutive stops.
fn logical_moves(tally: &mut Tally, name: &str, queries: &Queries<'_>, stops: &[u32]) {
    let step = |position, direction| {
        queries
            .move_position(position, direction, TextUnit::Grapheme, None)
            .expect("move")
            .position
    };
    for pair in stops.windows(2) {
        let from = queries
            .normalize(TextPosition::downstream(pair[0]))
            .expect("normalize");
        let to = queries
            .normalize(TextPosition::downstream(pair[1]))
            .expect("normalize");
        let forward = step(from, TextDirection::Forward);
        let back = step(forward, TextDirection::Backward);
        if forward != to || back != from {
            tally.fail(
                name,
                format!("forward from {from:?} gave {forward:?} (want {to:?}), back gave {back:?}"),
            );
        }
        tally.logical_moves += 2;
    }
    if let (Some(first), Some(last)) = (stops.first(), stops.last()) {
        let start = queries
            .normalize(TextPosition::downstream(*first))
            .expect("normalize");
        let end = queries
            .normalize(TextPosition::downstream(*last))
            .expect("normalize");
        if step(start, TextDirection::Backward) != start || step(end, TextDirection::Forward) != end
        {
            tally.fail(name, "a move past a text end did not stay".into());
        }
    }
}

/// Walking right from a line's left edge, and left from its right edge, rests at every place of
/// the line exactly once in x order. A soft wrap is one stop that rests on the later box, so
/// the earlier box's end edge is the one place a walk may pass without resting.
fn visual_walks(tally: &mut Tally, name: &str, queries: &Queries<'_>, stops: &[u32]) {
    // Every place of every line: its x, and the offsets drawn there.
    let mut places: BTreeMap<u32, Vec<(f64, Vec<u32>)>> = BTreeMap::new();
    for &offset in stops {
        for position in both(offset) {
            let caret = queries.caret(position).expect("caret");
            if caret.clipped || caret.rect.height == 0.0 {
                continue;
            }
            let line = places.entry(caret.line).or_default();
            match line.iter_mut().find(|(x, _)| *x == caret.rect.x) {
                Some((_, offsets)) => offsets.push(offset),
                None => line.push((caret.rect.x, vec![offset])),
            }
        }
    }
    for (line, expected) in &places {
        let source = queries.source();
        let facts = source.line(*line as usize).expect("line");
        let y = facts.top + facts.height * 0.5;
        for (direction, start_x) in [(TextDirection::Right, -1e12), (TextDirection::Left, 1e12)] {
            let mut position = queries.hit_test(start_x, y).expect("hit");
            let mut visited: Vec<f64> = Vec::new();
            let mut rested: Vec<u32> = Vec::new();
            let mut steps = 0;
            loop {
                let caret = queries.caret(position).expect("caret");
                if caret.line != *line || caret.clipped {
                    break;
                }
                if let Some(previous) = visited.last() {
                    let ordered = if direction == TextDirection::Right {
                        caret.rect.x >= *previous
                    } else {
                        caret.rect.x <= *previous
                    };
                    if !ordered {
                        tally.fail(
                            name,
                            format!(
                                "line {line}: {direction:?} walk went from x {previous} to {} at {position:?}",
                                caret.rect.x
                            ),
                        );
                        break;
                    }
                }
                visited.push(caret.rect.x);
                rested.push(position.offset);
                let next = queries
                    .move_position(position, direction, TextUnit::Grapheme, None)
                    .expect("move")
                    .position;
                if next == position {
                    break;
                }
                position = next;
                steps += 1;
                if steps > 4 * expected.len() + 8 {
                    tally.fail(name, format!("line {line}: {direction:?} walk did not end"));
                    break;
                }
            }
            for x in &visited {
                if !expected.iter().any(|(place, _)| place == x) {
                    tally.fail(
                        name,
                        format!("line {line}: {direction:?} walk rested at x {x}, not a place of the line"),
                    );
                }
            }
            for (x, offsets) in expected {
                // A place the walk passed without resting is a soft wrap: it rested at that
                // offset on the next box of the line, or left the line through it.
                if !visited.contains(x)
                    && !offsets.iter().any(|offset| {
                        rested.contains(offset)
                            || walk_leaves_through(queries, *line, *offset, direction)
                    })
                {
                    tally.fail(
                        name,
                        format!("line {line}: {direction:?} walk never rested at x {x} (offsets {offsets:?})"),
                    );
                }
            }
        }
        tally.lines_walked += 1;
    }
}

/// Whether a walk leaves a line at `offset`: the offset is the soft wrap it continues through
/// onto another line, where it rests.
fn walk_leaves_through(
    queries: &Queries<'_>,
    line: u32,
    offset: u32,
    direction: TextDirection,
) -> bool {
    both(offset).into_iter().any(|position| {
        let caret = queries.caret(position).expect("caret");
        let moved = queries
            .move_position(position, direction, TextUnit::Grapheme, None)
            .expect("move")
            .position;
        caret.line != line || queries.caret(moved).expect("caret").line != line
    })
}

/// Counts the lines whose text glyphs are not in pen order, case by case.
fn pen_order(tally: &mut Tally, names: &mut Vec<String>, name: &str, queries: &Queries<'_>) {
    let source = queries.source();
    let mut lines = 0;
    for line in 0..source.line_count() {
        let mut previous: Option<(f64, bool)> = None;
        let mut reversed = false;
        source
            .line_glyphs(line, &mut |glyph| {
                if glyph.role != GlyphRole::Text {
                    return;
                }
                if let Some((pen, cap)) = previous
                    && cap == glyph.drop_cap
                    && glyph.pen < pen - 0.5
                    && source
                        .line(line)
                        .is_some_and(|facts| facts.fragment_count == 1)
                {
                    reversed = true;
                }
                previous = Some((glyph.pen, glyph.drop_cap));
            })
            .expect("glyphs");
        lines += usize::from(reversed);
    }
    if lines != 0 {
        names.push(format!("{name} ({lines})"));
    }
    tally.pen_reversals += lines;
}

/// `boundary` ranges of every unit tile the text, and a unit is the same from either end.
fn boundaries_tile(tally: &mut Tally, name: &str, queries: &Queries<'_>) {
    let length = queries.text_length();
    for unit in [
        TextUnit::Grapheme,
        TextUnit::Word,
        TextUnit::Sentence,
        TextUnit::Line,
    ] {
        let mut offset = 0;
        while offset < length {
            let range = match queries.boundary(TextPosition::downstream(offset), unit) {
                Ok(range) => range,
                Err(error) => {
                    tally.fail(name, format!("{unit:?} boundary at {offset}: {error:?}"));
                    break;
                }
            };
            if range.start != offset || range.end <= offset || range.end > length {
                tally.fail(
                    name,
                    format!("{unit:?} unit at {offset} is {range:?}: the units do not tile"),
                );
                break;
            }
            // Line units are found through the caret, and an upstream caret at a soft wrap is
            // on the earlier line by definition; the others are pure text.
            if unit != TextUnit::Line {
                let from_end = queries
                    .boundary(TextPosition::upstream(range.end), unit)
                    .expect("boundary");
                if from_end != range {
                    tally.fail(
                        name,
                        format!("{unit:?} unit {range:?} is {from_end:?} from its end"),
                    );
                    break;
                }
            }
            tally.boundary_units += 1;
            offset = range.end;
        }
    }
}

/// The rectangles of a range never overlap, add up across a split, and cover exactly the
/// advances of the graphemes drawn in it.
fn ranges(tally: &mut Tally, name: &str, case: &Case, queries: &Queries<'_>) {
    let source = queries.source();
    let length = queries.text_length();
    let boundaries: Vec<u32> = source.grapheme_boundaries().to_vec();
    if boundaries.len() < 2 {
        return;
    }
    let width = |start: u32, end: u32| -> f64 {
        queries
            .range_rects(start, end)
            .expect("range")
            .iter()
            .map(|rect| rect.width)
            .sum()
    };
    let whole = queries.range_rects(0, length).expect("range");
    for (index, rect) in whole.iter().enumerate() {
        for other in &whole[index + 1..] {
            let same_band = rect.y < other.y + other.height && other.y < rect.y + rect.height;
            let overlap = rect.x.max(other.x) < (rect.x + rect.width).min(other.x + other.width);
            if same_band
                && overlap
                && rect.x + rect.width - other.x > 1e-6
                && other.x + other.width - rect.x > 1e-6
            {
                tally.fail(name, format!("range rects overlap: {rect:?} and {other:?}"));
            }
        }
    }
    // The advances positioning placed: every text glyph of every line, hard breaks aside.
    let mut advances = 0.0;
    let text = source.text();
    for line in 0..source.line_count() {
        source
            .line_glyphs(line, &mut |glyph| {
                let hard_break = text
                    .get(glyph.text as usize)
                    .is_some_and(|unit| is_hard_break_unit(*unit));
                if glyph.role == GlyphRole::Text && !hard_break {
                    advances += glyph.advance;
                }
            })
            .expect("glyphs");
    }
    let covered: f64 = whole.iter().map(|rect| rect.width).sum();
    // Justification and letter spacing widen the gaps between graphemes; nothing narrows them.
    let spaced = case.model.root.letter_spacing != 0.0
        || case.model.root.word_spacing != 0.0
        || case
            .model
            .spans
            .iter()
            .any(|span| span.style.letter_spacing.is_some());
    let justified = case.model.layout.align == ALIGN_JUSTIFY;
    let tolerance = 1e-3 * (1.0 + advances.abs());
    if covered < advances - tolerance || (!spaced && !justified && covered > advances + tolerance) {
        tally.fail(
            name,
            format!("the whole text covers {covered}, its glyphs advance {advances}"),
        );
    }
    // Additivity over seeded splits.
    let mut seed = 0x9e37_79b9_7f4a_7c15_u64 ^ boundaries.len() as u64;
    let mut pick = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        boundaries[(seed % boundaries.len() as u64) as usize]
    };
    for _ in 0..24 {
        let mut cut = [pick(), pick(), pick()];
        cut.sort_unstable();
        let (left, right, both) = (
            width(cut[0], cut[1]),
            width(cut[1], cut[2]),
            width(cut[0], cut[2]),
        );
        if (left + right - both).abs() > 1e-6 * (1.0 + both.abs()) {
            tally.fail(
                name,
                format!("range {cut:?}: {left} + {right} is not {both}"),
            );
        }
        tally.ranges += 1;
    }
}

/// Every caret, stop and hit of an edited paragraph equals a cold layout of the same model.
fn edits_equal_cold(
    tally: &mut Tally,
    library: &FontLibrary,
    case: &Case,
    stacks: &[&[&str]],
    warm: &mut Session,
) {
    for planned in scripted(case, 20_261_121, 3) {
        if warm
            .step(&planned.next, &planned.edits, planned.route)
            .is_err()
        {
            // A rejected request leaves the root unusable, as the oracle's driver records.
            return;
        }
        let Ok(mut cold) = Session::new(library, stacks) else {
            return;
        };
        if cold.step(&planned.next, &[], planned.route).is_err() {
            return;
        }
        // The lanes were filled before the edit: they must have followed it.
        prepare_lanes(warm);
        prepare_lanes(&mut cold);
        let (warm_queries, cold_queries) = (editing(warm), editing(&cold));
        let stops = warm_queries.caret_stops().expect("stops");
        if stops != cold_queries.caret_stops().expect("stops") {
            tally.fail(
                &case.name,
                format!("after {}: caret stops differ from cold", planned.label),
            );
            return;
        }
        let length = warm_queries.text_length();
        for unit in [TextUnit::Word, TextUnit::Sentence] {
            let mut offset = 0;
            while offset < length {
                let position = TextPosition::downstream(offset);
                let unit_range = warm_queries.boundary(position, unit).expect("boundary");
                if Ok(unit_range) != cold_queries.boundary(position, unit) {
                    tally.fail(
                        &case.name,
                        format!(
                            "after {}: the {unit:?} at {offset} differs from cold",
                            planned.label
                        ),
                    );
                    return;
                }
                offset = unit_range.end.max(offset + 1);
            }
        }
        for &offset in &stops {
            for position in both(offset) {
                let (warm_caret, cold_caret) = (
                    warm_queries.caret(position).expect("caret"),
                    cold_queries.caret(position).expect("caret"),
                );
                if warm_caret != cold_caret {
                    tally.fail(
                        &case.name,
                        format!(
                            "after {}: caret({position:?}) is {warm_caret:?}, cold {cold_caret:?}",
                            planned.label
                        ),
                    );
                    return;
                }
                let (x, y) = (warm_caret.rect.x + 1.25, warm_caret.rect.y + 1.0);
                if warm_queries.hit_test(x, y) != cold_queries.hit_test(x, y) {
                    tally.fail(
                        &case.name,
                        format!(
                            "after {}: hit_test({x}, {y}) differs from cold",
                            planned.label
                        ),
                    );
                    return;
                }
            }
        }
        tally.edits_compared += 1;
    }
}

#[test]
fn properties_hold_for_every_oracle_fixture() {
    let library = all_fonts();
    let mut tallies: BTreeMap<String, Tally> = BTreeMap::new();
    let mut skipped = Vec::new();
    let mut reversed = Vec::new();
    for case in cases() {
        let keys = case.font_keys();
        if !library.missing(keys.iter().copied()).is_empty() {
            skipped.push(case.name.clone());
            continue;
        }
        let stacks: Vec<&[&str]> = case.stacks.iter().map(Vec::as_slice).collect();
        let mut warm = session(&library, &stacks, &case.model);
        prepare_lanes(&mut warm);
        let tally = tallies.entry(format!("{:?}", case.script)).or_default();
        tally.cases += 1;
        {
            let queries = editing(&warm);
            let stops = queries.caret_stops().expect("stops");
            let graphemes = queries.source().grapheme_boundaries().len().max(1);
            tally.stops += stops.len();
            tally.suppressed_boundaries += graphemes - stops.len();
            tally.interior_ligature_stops += stops
                .iter()
                .filter(|offset| {
                    let located = queries
                        .locate(TextPosition::downstream(**offset))
                        .expect("locate");
                    located.cluster.start < **offset && **offset < located.cluster.end
                })
                .count();
            round_trip(tally, &case.name, &queries, &stops);
            logical_moves(tally, &case.name, &queries, &stops);
            visual_walks(tally, &case.name, &queries, &stops);
            boundaries_tile(tally, &case.name, &queries);
            ranges(tally, &case.name, &case, &queries);
            pen_order(tally, &mut reversed, &case.name, &queries);
        }
        if case.fuzz {
            edits_equal_cold(tally, &library, &case, &stacks, &mut warm);
        }
    }
    println!(
        "{:<14} {:>5} {:>8} {:>6} {:>6} {:>8} {:>7} {:>6} {:>8} {:>7} {:>8} {:>6} {:>7} {:>6} {:>6}",
        "script",
        "cases",
        "stops",
        "lig",
        "suppr",
        "carets",
        "clipped",
        "split",
        "rt-exact",
        "rt-shrd",
        "moves",
        "lines",
        "units",
        "ranges",
        "edits"
    );
    let mut failures = Vec::new();
    for (script, tally) in &tallies {
        println!(
            "{:<14} {:>5} {:>8} {:>6} {:>6} {:>8} {:>7} {:>6} {:>8} {:>7} {:>8} {:>6} {:>7} {:>6} {:>6}  {}",
            script,
            tally.cases,
            tally.stops,
            tally.interior_ligature_stops,
            tally.suppressed_boundaries,
            tally.carets,
            tally.clipped_carets,
            tally.split_carets,
            tally.round_trips_exact,
            tally.round_trips_shared,
            tally.logical_moves,
            tally.lines_walked,
            tally.boundary_units,
            tally.ranges,
            tally.edits_compared,
            if tally.failures.is_empty() {
                "ok"
            } else {
                "FAILED"
            },
        );
        failures.extend(tally.failures.iter().cloned());
    }
    println!("{} cases skipped for missing fonts", skipped.len());
    println!(
        "{} lines draw a glyph left of its pen, in: {}",
        tallies
            .values()
            .map(|tally| tally.pen_reversals)
            .sum::<usize>(),
        reversed.join(", ")
    );
    if adversarial_root().is_some() {
        assert!(skipped.is_empty(), "fonts missing for {skipped:?}");
    }
    assert!(
        tallies.values().map(|tally| tally.cases).sum::<usize>() > 100,
        "a pass with nothing checked is not a pass"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
