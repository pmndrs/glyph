//! Hand-written expectations for carets, range rectangles, hit testing and movement on real
//! fonts: the cases whose right answer is a decision rather than an identity.
//!
//! `cargo test --release --features oracle --test editing_cases`. Tests that need a font from
//! the fetched adversarial set pass vacuously when `GLYPH_ADVERSARIAL_FONTS` is unset; the
//! repository's own fonts cover everything else.

mod editing;

use editing::{
    Queries, close, down, editing, glyphs, lay_out, lay_out_if_present, library, model, sequences,
    session, try_library, units, up, wrapped,
};
use pmndrs_glyph_shaper::{
    bidi::DIRECTION_RTL,
    engine::{
        editing::{
            Affinity, EditingError, GlyphRole, LayoutSource, MAX_LIGATURE_CARETS, OffsetArgument,
            OffsetError, OffsetReason, Rect, TextDirection, TextPosition, TextRange, TextUnit,
            ligature_carets,
        },
        oracle::matrix,
    },
};

const ALIGN_CENTER: u8 = 2;
const ALIGN_END: u8 = 3;
const ALIGN_JUSTIFY: u8 = 4;
const WRAP_NONE: u8 = 1;
const OVERFLOW_ELLIPSIS: u8 = 3;

fn x(queries: &Queries<'_>, position: TextPosition) -> f64 {
    queries.caret(position).expect("caret").rect.x
}

fn step(
    queries: &Queries<'_>,
    position: TextPosition,
    direction: TextDirection,
    unit: TextUnit,
) -> TextPosition {
    queries
        .move_position(position, direction, unit, None)
        .expect("move")
        .position
}

/// The positions a walk rests at, from `start` until it stops moving.
fn walk(queries: &Queries<'_>, start: TextPosition, direction: TextDirection) -> Vec<TextPosition> {
    let mut visited = vec![queries.normalize(start).expect("normalize")];
    loop {
        let last = *visited.last().expect("a start");
        let next = step(queries, last, direction, TextUnit::Grapheme);
        if next == last {
            return visited;
        }
        visited.push(next);
        assert!(visited.len() < 10_000, "the walk does not end");
    }
}

// ---------------------------------------------------------------------------------------------
// Unit 2: carets and range rectangles.
// ---------------------------------------------------------------------------------------------

#[test]
fn left_to_right_carets_stand_on_the_pen() {
    let session = lay_out(&["inter"], &model("abc"));
    let queries = editing(&session);
    let glyphs = glyphs(&queries, 0);
    let line = queries.source().line(0).unwrap();
    let mut pen = 0.0;
    for (offset, glyph) in glyphs.iter().enumerate() {
        let caret = queries.caret(down(offset as u32)).unwrap();
        assert_eq!(
            caret.rect,
            Rect {
                x: pen,
                y: line.top,
                width: 0.0,
                height: line.height
            }
        );
        assert_eq!(
            (caret.line, caret.level, caret.secondary, caret.clipped),
            (0, 0, None, false)
        );
        assert_eq!(queries.caret(up(offset as u32)).unwrap(), caret);
        pen = glyph.pen + glyph.advance;
    }
    assert!(close(x(&queries, up(3)), pen));
    assert_eq!(
        queries.normalize(down(3)).unwrap(),
        up(3),
        "no grapheme starts at the end"
    );
    assert_eq!(queries.normalize(up(1)).unwrap(), down(1));
    // The whole text is one rectangle from the first pen to the last.
    let rects = queries.range_rects(0, 3).unwrap();
    assert_eq!(rects.len(), 1);
    assert!(close(rects[0].x, 0.0) && close(rects[0].width, pen));
    assert_eq!((rects[0].y, rects[0].height), (line.top, line.height));
}

#[test]
fn right_to_left_carets_run_from_the_right_edge() {
    let Some(session) = lay_out_if_present(&["hebrew"], &model("\u{5e9}\u{5dc}\u{5d5}\u{5dd}"))
    else {
        return;
    };
    let queries = editing(&session);
    let xs: Vec<f64> = (0..=4).map(|offset| x(&queries, down(offset))).collect();
    assert!(
        close(xs[0], 600.0),
        "start-aligned right-to-left text begins at the measure's right edge"
    );
    assert!(xs.windows(2).all(|pair| pair[1] < pair[0]), "{xs:?}");
    let total: f64 = glyphs(&queries, 0).iter().map(|glyph| glyph.advance).sum();
    assert!(close(xs[0] - xs[4], total));
    for offset in 0..=4 {
        let caret = queries.caret(down(offset)).unwrap();
        assert_eq!((caret.level, caret.secondary), (1, None));
    }
    // One rectangle, and a range in the middle is the span between its two carets.
    let rects = queries.range_rects(1, 3).unwrap();
    assert_eq!(rects.len(), 1);
    assert!(close(rects[0].x, xs[3]) && close(rects[0].width, xs[1] - xs[3]));
}

/// `abc`, space, four Arabic letters, space, `def`: offsets 0–4, 4–8, 8–12.
const BIDI: &str = "abc \u{633}\u{644}\u{627}\u{645} def";

#[test]
fn a_bidi_boundary_has_a_caret_on_each_side() {
    let session = lay_out(&["inter", "amiri"], &model(BIDI));
    let queries = editing(&session);
    let glyphs = glyphs(&queries, 0);
    // The Arabic run is drawn between these two x: its logical end is its left edge.
    let left: f64 = glyphs[..4].iter().map(|glyph| glyph.advance).sum();
    let right = left + glyphs[4..8].iter().map(|glyph| glyph.advance).sum::<f64>();

    // Offset 4, where the run starts: downstream is the first Arabic letter's leading
    // (right) edge, upstream the trailing edge of the space before the run.
    let downstream = queries.caret(down(4)).unwrap();
    let upstream = queries.caret(up(4)).unwrap();
    assert!(close(downstream.rect.x, right) && close(upstream.rect.x, left));
    assert_eq!((downstream.level, upstream.level), (1, 0));
    assert_eq!(downstream.secondary, Some(upstream.rect));
    assert_eq!(upstream.secondary, Some(downstream.rect));
    // Offset 8, where it ends: upstream is the last Arabic letter's trailing (left) edge,
    // downstream the leading edge of the space after the run.
    let downstream = queries.caret(down(8)).unwrap();
    let upstream = queries.caret(up(8)).unwrap();
    assert!(close(downstream.rect.x, right) && close(upstream.rect.x, left));
    assert_eq!((downstream.level, upstream.level), (0, 1));
    // Inside the run the two affinities are one place.
    assert_eq!(
        queries.caret(down(6)).unwrap(),
        queries.caret(up(6)).unwrap()
    );
    assert_eq!(queries.caret(down(6)).unwrap().secondary, None);
    for position in [down(4), up(4), down(8), up(8)] {
        assert_eq!(
            queries.normalize(position).unwrap(),
            position,
            "both sides are places"
        );
    }

    // A hit names the side it is on; exactly on the shared edge, the lower level.
    let y = 5.0;
    assert_eq!(queries.hit_test(left - 0.5, y).unwrap(), up(4));
    assert_eq!(queries.hit_test(left + 0.5, y).unwrap(), up(8));
    assert_eq!(queries.hit_test(x(&queries, up(4)), y).unwrap(), up(4));
    assert_eq!(queries.hit_test(right - 0.5, y).unwrap(), down(4));
    assert_eq!(queries.hit_test(right + 0.5, y).unwrap(), down(8));
    assert_eq!(queries.hit_test(x(&queries, down(8)), y).unwrap(), down(8));

    // A logical range that crosses the boundary is two rectangles: `c`, space, and the first
    // two Arabic letters, which are the right half of the run.
    let rects = queries.range_rects(2, 6).unwrap();
    assert_eq!(rects.len(), 2);
    assert!(close(rects[0].x, x(&queries, down(2))) && close(rects[0].x + rects[0].width, left));
    assert!(close(rects[1].x, x(&queries, down(6))) && close(rects[1].x + rects[1].width, right));
}

#[test]
fn visual_movement_crosses_a_bidi_run_in_x_order() {
    let session = lay_out(&["inter", "amiri"], &model(BIDI));
    let queries = editing(&session);
    // Rightward the caret enters the run at its left edge, which is its logical end, and stays
    // attached to the letter it just crossed.
    assert_eq!(
        walk(&queries, down(0), TextDirection::Right),
        [
            down(0),
            down(1),
            down(2),
            down(3),
            up(4),
            down(7),
            down(6),
            down(5),
            down(4),
            down(9),
            down(10),
            down(11),
            up(12),
        ]
    );
    assert_eq!(
        walk(&queries, up(12), TextDirection::Left),
        [
            up(12),
            down(11),
            down(10),
            down(9),
            down(8),
            down(5),
            down(6),
            down(7),
            up(8),
            down(3),
            down(2),
            down(1),
            down(0),
        ]
    );
    // Each walk's x is strictly monotonic: every place once.
    for (direction, start) in [
        (TextDirection::Right, down(0)),
        (TextDirection::Left, up(12)),
    ] {
        let xs: Vec<f64> = walk(&queries, start, direction)
            .into_iter()
            .map(|position| x(&queries, position))
            .collect();
        assert!(
            xs.windows(2)
                .all(|pair| if direction == TextDirection::Right {
                    pair[1] > pair[0]
                } else {
                    pair[1] < pair[0]
                }),
            "{xs:?}"
        );
    }
    // Logical movement ignores the drawing order.
    assert_eq!(
        walk(&queries, down(0), TextDirection::Forward)
            .iter()
            .map(|position| position.offset)
            .collect::<Vec<_>>(),
        (0..=12).collect::<Vec<_>>()
    );
}

#[test]
fn a_soft_wrap_is_two_places_for_one_offset() {
    let session = lay_out(&["fredoka"], &wrapped());
    let queries = editing(&session);
    let (first, second) = (
        queries.source().line(0).unwrap(),
        queries.source().line(1).unwrap(),
    );
    let upstream = queries.caret(up(7)).unwrap();
    let downstream = queries.caret(down(7)).unwrap();
    assert_eq!((upstream.line, downstream.line), (0, 1));
    assert_eq!(
        (upstream.rect.y, downstream.rect.y),
        (first.top, second.top)
    );
    assert_eq!(downstream.rect.x, 0.0);
    assert_eq!((upstream.secondary, downstream.secondary), (None, None));
    // The earlier line's end is past its trailing space, which hangs beyond the last letter.
    let space = glyphs(&queries, 0).last().copied().unwrap();
    assert!(close(upstream.rect.x, space.pen + space.advance));
    assert!(close(x(&queries, down(6)), space.pen));
    assert_eq!(queries.normalize(up(7)).unwrap(), up(7));
    assert_eq!(queries.normalize(down(7)).unwrap(), down(7));

    // Past the end of a line is that line's end, upstream; before a line's start, downstream.
    assert_eq!(queries.hit_test(1_000.0, first.top + 1.0).unwrap(), up(7));
    assert_eq!(queries.hit_test(-5.0, second.top + 1.0).unwrap(), down(7));
    // Between two lines the nearer one answers; above and below the paragraph, the first and
    // the last.
    assert_eq!(queries.hit_test(-5.0, second.top - 0.01).unwrap(), down(0));
    assert_eq!(queries.hit_test(-5.0, -1_000.0).unwrap(), down(0));
    assert_eq!(queries.hit_test(1_000.0, 1_000.0).unwrap(), up(28));

    // Line movement and line units follow the affinity.
    let line = TextUnit::Line;
    assert_eq!(step(&queries, down(2), TextDirection::Forward, line), up(7));
    assert_eq!(
        step(&queries, up(7), TextDirection::Backward, line),
        down(0)
    );
    assert_eq!(
        step(&queries, down(7), TextDirection::Backward, line),
        down(7)
    );
    assert_eq!(
        step(&queries, down(7), TextDirection::Forward, line),
        up(14)
    );
    assert_eq!(step(&queries, down(2), TextDirection::Right, line), up(7));
    assert_eq!(step(&queries, down(9), TextDirection::Left, line), down(7));
    assert_eq!(
        queries.boundary(up(7), line).unwrap(),
        TextRange { start: 0, end: 7 }
    );
    assert_eq!(
        queries.boundary(down(7), line).unwrap(),
        TextRange { start: 7, end: 14 }
    );

    // A wrap is one stop when moving: it rests at the start of the later line, and one more
    // step from either side of it leaves it.
    assert_eq!(
        step(
            &queries,
            down(6),
            TextDirection::Forward,
            TextUnit::Grapheme
        ),
        down(7)
    );
    assert_eq!(
        step(&queries, down(6), TextDirection::Right, TextUnit::Grapheme),
        down(7)
    );
    assert_eq!(
        step(&queries, up(7), TextDirection::Right, TextUnit::Grapheme),
        down(8)
    );
    assert_eq!(
        step(&queries, down(7), TextDirection::Right, TextUnit::Grapheme),
        down(8)
    );
    assert_eq!(
        step(&queries, down(7), TextDirection::Left, TextUnit::Grapheme),
        down(6)
    );
    assert_eq!(
        step(&queries, up(7), TextDirection::Left, TextUnit::Grapheme),
        down(6)
    );
    assert_eq!(
        step(&queries, down(8), TextDirection::Left, TextUnit::Grapheme),
        down(7)
    );

    // A range across the wrap is one rectangle per line.
    let rects = queries.range_rects(4, 9).unwrap();
    assert_eq!(rects.len(), 2);
    assert_eq!((rects[0].y, rects[1].y), (first.top, second.top));
    assert!(close(rects[0].x + rects[0].width, upstream.rect.x) && rects[1].x == 0.0);
}

#[test]
fn hard_breaks_and_empty_lines_have_carets() {
    let session = lay_out(&["inter"], &model("ab\n\ncd"));
    let queries = editing(&session);
    let source = queries.source();
    assert_eq!(source.line_count(), 3);
    let tops: Vec<f64> = (0..3).map(|line| source.line(line).unwrap().top).collect();
    let caret = |position| queries.caret(position).unwrap();

    // Before the break: the end of the first line, whichever affinity asks.
    assert_eq!(caret(down(2)), caret(up(2)));
    assert_eq!((caret(down(2)).line, caret(down(2)).rect.y), (0, tops[0]));
    assert_eq!(queries.normalize(down(2)).unwrap(), up(2));
    // The empty line: its own line box, at the line's start.
    assert_eq!(caret(down(3)), caret(up(3)));
    assert_eq!(
        (
            caret(down(3)).line,
            caret(down(3)).rect.x,
            caret(down(3)).rect.y
        ),
        (1, 0.0, tops[1])
    );
    assert!(caret(down(3)).rect.height > 0.0);
    assert_eq!(queries.normalize(up(3)).unwrap(), down(3));
    // After the second break: the start of the third line.
    assert_eq!((caret(up(4)).line, caret(up(4)).rect.x), (2, 0.0));

    // Any x on the empty line is its one stop.
    for x in [-50.0, 0.0, 300.0, 9_000.0] {
        assert_eq!(queries.hit_test(x, tops[1] + 2.0).unwrap(), down(3));
    }
    // Stepping visually or logically passes through it once.
    assert_eq!(
        walk(&queries, down(0), TextDirection::Right)
            .iter()
            .map(|position| position.offset)
            .collect::<Vec<_>>(),
        [0, 1, 2, 3, 4, 5, 6]
    );
    assert_eq!(
        walk(&queries, up(6), TextDirection::Left)
            .iter()
            .map(|position| position.offset)
            .collect::<Vec<_>>(),
        [6, 5, 4, 3, 2, 1, 0]
    );
    // Line units tile the text: a line owns its break.
    let lines: Vec<TextRange> = [0, 3, 4]
        .into_iter()
        .map(|offset| queries.boundary(down(offset), TextUnit::Line).unwrap())
        .collect();
    assert_eq!(
        lines,
        [(0, 3), (3, 4), (4, 6)].map(|(start, end)| TextRange { start, end })
    );
    // A break draws nothing: the whole text is the two words.
    let rects = queries.range_rects(0, 6).unwrap();
    assert_eq!(
        rects.iter().map(|rect| rect.y).collect::<Vec<_>>(),
        [tops[0], tops[2]]
    );

    // A final break is followed by an empty line that holds the caret.
    let session = lay_out(&["inter"], &model("word\n"));
    let queries = editing(&session);
    assert_eq!(queries.caret(down(5)).unwrap().line, 1);
    assert_eq!(queries.caret(down(4)).unwrap().line, 0);
    assert_eq!(queries.hit_test(40.0, 30.0).unwrap(), down(5));
}

#[test]
fn an_empty_line_starts_where_its_alignment_puts_it() {
    for (align, direction, expected) in [
        (ALIGN_CENTER, None, 300.0),
        (ALIGN_END, None, 600.0),
        (1, Some(DIRECTION_RTL), 600.0),
        (ALIGN_END, Some(DIRECTION_RTL), 0.0),
    ] {
        let mut model = model("ab\n\ncd");
        model.layout.align = align;
        if let Some(direction) = direction {
            model.root.direction = direction;
        }
        let session = lay_out(&["inter"], &model);
        let queries = editing(&session);
        let caret = queries.caret(down(3)).unwrap();
        assert_eq!(
            (caret.rect.x, caret.line),
            (expected, 1),
            "align {align} {direction:?}"
        );
        assert_eq!(caret.level, u8::from(direction.is_some()));
    }
}

#[test]
fn text_with_no_line_has_no_line_box_to_stand_in() {
    // Layout makes no line for empty text or for text that is only hard breaks, so there is no
    // line height to give a caret: the rectangle is empty at the origin. Pinned as it is; the
    // fix is a layout change, not a query change.
    for text in ["", "\n", "\n\n"] {
        let session = lay_out(&["inter"], &model(text));
        let queries = editing(&session);
        assert_eq!(queries.source().line_count(), 0, "{text:?}");
        for offset in 0..=units(text) {
            let caret = queries.caret(down(offset)).unwrap();
            assert_eq!(caret.rect, Rect::default());
            assert!(!caret.clipped);
        }
        assert_eq!(queries.hit_test(10.0, 10.0).unwrap(), down(0));
        assert_eq!(
            queries.boundary(down(0), TextUnit::Line).unwrap(),
            TextRange {
                start: 0,
                end: units(text)
            }
        );
    }
}

#[test]
fn a_drop_cap_has_its_own_box() {
    let mut model = model(
        "The quick brown fox jumps over the lazy dog and keeps running far away and then some \
         more words to fill three lines of text at least",
    );
    model.layout.width = 200.0;
    model.layout.drop_cap_lines = 2;
    let session = lay_out(&["source-serif"], &model);
    let queries = editing(&session);
    let source = queries.source();
    let cap = source.drop_cap(0).expect("a drop cap");
    assert_eq!(
        (cap.line, cap.fragment.text_start, cap.fragment.text_end),
        (0, 0, 1)
    );
    let line = source.line(0).unwrap();
    assert_ne!((cap.top, cap.height), (line.top, line.height));

    // The initial's two carets stand in its box; the body's first caret in the line's.
    let before = queries.caret(down(0)).unwrap();
    let after = queries.caret(up(1)).unwrap();
    let body = queries.caret(down(1)).unwrap();
    for caret in [before, after] {
        assert_eq!(
            (caret.rect.y, caret.rect.height, caret.line),
            (cap.top, cap.height, 0)
        );
    }
    assert_eq!(
        (body.rect.y, body.rect.height, body.line),
        (line.top, line.height, 0)
    );
    assert!(after.rect.x > before.rect.x && body.rect.x >= after.rect.x);
    assert_eq!(after.secondary, None, "another box, not a split caret");
    // Both sides of offset 1 are places.
    assert_eq!(queries.normalize(up(1)).unwrap(), up(1));
    assert_eq!(queries.normalize(down(1)).unwrap(), down(1));

    // Inside the initial the hit is the initial's; its line is still the first.
    let middle = cap.top + cap.height * 0.5;
    assert_eq!(
        queries.hit_test(before.rect.x + 1.0, middle).unwrap(),
        down(0)
    );
    assert_eq!(queries.hit_test(after.rect.x - 1.0, middle).unwrap(), up(1));
    assert_eq!(queries.boundary(down(0), TextUnit::Line).unwrap().start, 0);
    assert_eq!(
        queries.boundary(down(0), TextUnit::Line).unwrap(),
        queries.boundary(down(5), TextUnit::Line).unwrap()
    );
    // Moving right leaves the initial for the body in one step, and comes back the same way.
    assert_eq!(
        step(&queries, down(0), TextDirection::Right, TextUnit::Grapheme),
        down(1)
    );
    assert_eq!(
        step(&queries, down(1), TextDirection::Left, TextUnit::Grapheme),
        down(0)
    );
    assert_eq!(
        step(&queries, down(4), TextDirection::Backward, TextUnit::Line),
        down(0)
    );
    // A range over the initial and the first word is one rectangle in each box.
    let rects = queries.range_rects(0, 3).unwrap();
    assert_eq!(rects.len(), 2);
    assert_eq!((rects[0].y, rects[0].height), (cap.top, cap.height));
    assert_eq!((rects[1].y, rects[1].height), (line.top, line.height));
}

#[test]
fn a_line_around_an_exclusion_is_one_rectangle_per_fragment() {
    let case = matrix::case("feature-exclusion-box-latin").expect("the oracle's exclusion case");
    let session = lay_out(&["inter"], &case.model);
    let queries = editing(&session);
    let source = queries.source();
    let line = (0..source.line_count())
        .find(|line| source.line(*line).unwrap().fragment_count == 2)
        .expect("a line the exclusion splits");
    let facts = source.line(line).unwrap();
    let (first, second) = (
        source.fragment(facts.fragment_start).unwrap(),
        source.fragment(facts.fragment_start + 1).unwrap(),
    );
    assert_eq!(first.text_end, second.text_start);
    let exclusion = case.model.layout.exclusion.unwrap();

    let rects = queries
        .range_rects(first.text_start, second.text_end)
        .unwrap();
    assert_eq!(rects.len(), 2, "{rects:?}");
    assert!(
        rects
            .iter()
            .all(|rect| rect.y == facts.top && rect.height == facts.height)
    );
    assert!(rects[0].x + rects[0].width <= f64::from(exclusion.inline_start) + 8.0);
    assert!(rects[1].x >= f64::from(exclusion.inline_end));
    // The offset where the text jumps the exclusion is two places on one line, and not a split
    // caret.
    let wrap = first.text_end;
    let (upstream, downstream) = (
        queries.caret(up(wrap)).unwrap(),
        queries.caret(down(wrap)).unwrap(),
    );
    assert_eq!((upstream.line, downstream.line), (line as u32, line as u32));
    assert!(upstream.rect.x < f64::from(exclusion.inline_start) + 8.0);
    assert!(downstream.rect.x >= f64::from(exclusion.inline_end));
    assert_eq!((upstream.secondary, downstream.secondary), (None, None));
    // A point inside the exclusion goes to the nearer fragment.
    let y = facts.top + 1.0;
    assert_eq!(
        queries
            .hit_test(f64::from(exclusion.inline_start) + 20.0, y)
            .unwrap(),
        up(wrap)
    );
    assert_eq!(
        queries
            .hit_test(f64::from(exclusion.inline_end) - 20.0, y)
            .unwrap(),
        down(wrap)
    );
    // The line unit is the whole line, both fragments.
    assert_eq!(
        queries.boundary(down(wrap), TextUnit::Line).unwrap(),
        TextRange {
            start: first.text_start,
            end: second.text_end
        }
    );
    assert_eq!(
        queries.boundary(up(wrap), TextUnit::Line).unwrap().start,
        first.text_start
    );
}

#[test]
fn clipped_text_parks_its_caret_after_the_ellipsis() {
    let mut model = model("The quick brown fox jumps over the lazy dog and keeps running far away");
    model.layout.width = 120.0;
    model.layout.wrap = WRAP_NONE;
    model.layout.overflow = OVERFLOW_ELLIPSIS;
    let session = lay_out(&["inter"], &model);
    let queries = editing(&session);
    let glyphs = glyphs(&queries, 0);
    let marker = glyphs.last().copied().unwrap();
    assert_eq!(marker.role, GlyphRole::Ellipsis);
    let visible = queries.source().fragment(0).unwrap().text_end;
    assert!(visible < queries.text_length());

    // The last drawn offset is a caret before the ellipsis; nothing is clipped about it.
    let last = queries.caret(up(visible)).unwrap();
    assert!(close(last.rect.x, marker.pen) && !last.clipped);
    assert_eq!(queries.normalize(down(visible)).unwrap(), up(visible));
    // Every offset in the text the ellipsis stands for is valid, flagged, and drawn at the far
    // edge of the ellipsis on the line that was cut.
    for offset in [visible + 1, visible + 9, queries.text_length()] {
        for position in [down(offset), up(offset)] {
            let caret = queries.caret(position).unwrap();
            assert!(caret.clipped, "{offset}");
            assert!(close(caret.rect.x, marker.pen + marker.advance));
            assert_eq!(
                (caret.line, caret.rect.y, caret.secondary),
                (0, last.rect.y, None)
            );
        }
    }
    // A hit on or past the ellipsis is the last drawn offset; hits never land in clipped text.
    for x in [marker.pen + 1.0, marker.pen + marker.advance, 5_000.0] {
        assert_eq!(queries.hit_test(x, 5.0).unwrap(), up(visible));
    }
    // Movement goes on through the hidden text one grapheme at a time, and comes back.
    assert_eq!(
        step(
            &queries,
            up(visible),
            TextDirection::Forward,
            TextUnit::Grapheme
        )
        .offset,
        visible + 1
    );
    assert_eq!(
        step(
            &queries,
            up(visible),
            TextDirection::Right,
            TextUnit::Grapheme
        )
        .offset,
        visible + 1
    );
    assert_eq!(
        step(
            &queries,
            down(visible + 1),
            TextDirection::Left,
            TextUnit::Grapheme
        )
        .offset,
        visible
    );
    assert_eq!(
        step(
            &queries,
            down(visible + 5),
            TextDirection::Backward,
            TextUnit::Grapheme
        )
        .offset,
        visible + 4
    );
    // Hidden text has no rectangle, and the one line owns all of the text.
    let drawn = queries.range_rects(visible - 3, visible).unwrap();
    assert_eq!(
        queries
            .range_rects(visible - 3, queries.text_length())
            .unwrap(),
        drawn
    );
    assert_eq!(
        queries.range_rects(visible + 2, visible + 8).unwrap(),
        vec![]
    );
    assert_eq!(
        queries.boundary(down(visible + 4), TextUnit::Line).unwrap(),
        TextRange {
            start: 0,
            end: queries.text_length()
        }
    );
}

#[test]
fn ligature_stops_come_from_the_font_when_it_has_them() {
    // Fredoka's `ffi` is one glyph with GDEF carets at 285 and 569 of 1000 units per em.
    let session = lay_out(&["fredoka"], &model("office"));
    let queries = editing(&session);
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 2, 3, 4, 5, 6]);
    let ligature = glyphs(&queries, 0)[1];
    assert_eq!(ligature.text, 1);
    assert_eq!(
        queries.locate(down(2)).unwrap().cluster,
        TextRange { start: 1, end: 4 }
    );
    let scale = 16.0 / 1000.0;
    assert!(close(x(&queries, down(1)), ligature.pen));
    assert!(close(x(&queries, down(2)), ligature.pen + 285.0 * scale));
    assert!(close(x(&queries, down(3)), ligature.pen + 569.0 * scale));
    assert!(close(x(&queries, down(4)), ligature.pen + ligature.advance));
    // The middle `f` selects exactly the span between the two carets, and a hit inside it
    // resolves to the nearer caret.
    let rects = queries.range_rects(2, 3).unwrap();
    assert_eq!(rects.len(), 1);
    assert!(close(rects[0].width, (569.0 - 285.0) * scale));
    assert_eq!(
        queries.hit_test(ligature.pen + 300.0 * scale, 5.0).unwrap(),
        down(2)
    );
    assert_eq!(
        queries.hit_test(ligature.pen + 560.0 * scale, 5.0).unwrap(),
        down(3)
    );
    for offset in 1..=4 {
        let position = queries.normalize(down(offset)).unwrap();
        let caret = queries.caret(position).unwrap();
        assert_eq!(
            queries.hit_test(caret.rect.x, caret.rect.y + 1.0).unwrap(),
            position
        );
    }
}

#[test]
fn ligature_stops_divide_evenly_when_the_font_has_no_carets() {
    // Source Serif's `ffi` is one glyph and the font has no LigCaretList.
    let session = lay_out(&["source-serif"], &model("office"));
    let queries = editing(&session);
    let ligature = glyphs(&queries, 0)[1];
    assert_eq!(
        queries.locate(down(2)).unwrap().cluster,
        TextRange { start: 1, end: 4 }
    );
    for (offset, part) in [(1, 0.0), (2, 1.0), (3, 2.0), (4, 3.0)] {
        assert!(
            close(
                x(&queries, down(offset)),
                ligature.pen + ligature.advance * part / 3.0
            ),
            "{offset}"
        );
    }
    // Inter's `->` is a ligature of two punctuation marks: one stop in the middle.
    let session = lay_out(&["inter"], &model("a->b"));
    let queries = editing(&session);
    let arrow = glyphs(&queries, 0)[1];
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 2, 3, 4]);
    assert!(close(x(&queries, down(2)), arrow.pen + arrow.advance * 0.5));
}

#[test]
fn a_pair_the_shaper_merged_stops_between_its_two_glyphs() {
    // Fredoka draws `fi` as `f` and a dotless `i` in one cluster: the stop is where the second
    // glyph starts, not the midpoint of the pair.
    let session = lay_out(&["fredoka"], &model("fi"));
    let queries = editing(&session);
    let glyphs = glyphs(&queries, 0);
    assert_eq!(glyphs.len(), 2);
    assert_eq!((glyphs[0].text, glyphs[1].text), (0, 0), "one cluster");
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 2]);
    assert!(close(x(&queries, down(1)), glyphs[1].pen));
    assert!(!close(
        glyphs[1].pen,
        (glyphs[1].pen + glyphs[1].advance) * 0.5
    ));
}

#[test]
fn the_fonts_carry_the_ligature_carets_the_review_counted() {
    let count = |key: &str| -> Option<usize> {
        let library = try_library(&[key]).ok()?;
        let font = library.get(key)?;
        let mut carets = [0; MAX_LIGATURE_CARETS];
        Some(
            (0..font.glyph_count.min(u32::from(u16::MAX)))
                .filter(|glyph| ligature_carets(&font.sfnt, *glyph as u16, &mut carets).is_some())
                .count(),
        )
    };
    assert_eq!(count("fredoka"), Some(8));
    assert_eq!(count("amiri"), Some(13));
    assert_eq!(count("inter"), Some(0));
    assert_eq!(count("source-serif"), Some(0));
    // The adversarial set, when it is on this machine.
    for (key, expected) in [
        ("recursive", 79),
        ("hebrew", 3),
        ("fira-code", 0),
        ("nastaliq", 0),
    ] {
        if let Some(found) = count(key) {
            assert_eq!(found, expected, "{key}");
        }
    }
}

#[test]
fn cursive_attachment_keeps_carets_in_reading_order() {
    // Nastaliq stacks each word down and to the left; the pen still runs right to left.
    let text = "\u{627}\u{631}\u{62f}\u{648} \u{632}\u{628}\u{627}\u{646} \u{646}\u{633}\u{62a}\u{639}\u{644}\u{6cc}\u{642}";
    let Some(session) = lay_out_if_present(&["nastaliq"], &model(text)) else {
        return;
    };
    let queries = editing(&session);
    let stops = queries.caret_stops().unwrap();
    assert_eq!(
        stops.len() as u32,
        units(text) + 1,
        "every letter is a stop"
    );
    let xs: Vec<f64> = stops
        .iter()
        .map(|offset| x(&queries, down(*offset)))
        .collect();
    assert!(xs.windows(2).all(|pair| pair[1] <= pair[0]), "{xs:?}");
    assert!(close(xs[0], 600.0));
    let line = queries.source().line(0).unwrap();
    for offset in &stops {
        let caret = queries.caret(down(*offset)).unwrap();
        assert_eq!(
            (caret.rect.y, caret.rect.height),
            (line.top, line.height),
            "a caret is the line box, wherever the glyph was attached"
        );
    }
}

#[test]
fn a_justified_line_selects_edge_to_edge() {
    let case = matrix::case("para-latin-justify").expect("the oracle's justified paragraph");
    assert_eq!(case.model.layout.align, ALIGN_JUSTIFY);
    let session = lay_out(&["inter"], &case.model);
    let queries = editing(&session);
    let source = queries.source();
    let text = source.text();
    let mut checked = 0;
    for line in 0..source.line_count() - 1 {
        let fragment = source
            .fragment(source.line(line).unwrap().fragment_start)
            .unwrap();
        let next = source
            .fragment(source.line(line + 1).unwrap().fragment_start)
            .unwrap();
        // A line that wraps softly and ends in the one space the wrap consumed.
        if next.text_start != fragment.text_end
            || text[fragment.text_end as usize - 1] != 0x20
            || text[fragment.text_end as usize - 2] == 0x20
        {
            continue;
        }
        let rects = queries
            .range_rects(fragment.text_start, fragment.text_end - 1)
            .unwrap();
        assert_eq!(rects.len(), 1, "line {line}");
        assert!(close(rects[0].x, 0.0), "line {line}: {rects:?}");
        assert!(
            (rects[0].width - f64::from(case.model.layout.width)).abs() < 0.05,
            "line {line}: {rects:?}"
        );
        // The stretch belongs to the spaces: a letter's rectangle is its own advance.
        let glyphs = glyphs(&queries, line);
        let letter = glyphs
            .iter()
            .find(|glyph| text[glyph.text as usize] != 0x20)
            .unwrap();
        let rect = queries.range_rects(letter.text, letter.text + 1).unwrap();
        assert!(close(rect[0].width, letter.advance), "line {line}");
        checked += 1;
    }
    assert!(checked > 10, "{checked} justified lines checked");
}

#[test]
fn a_caret_or_a_range_inside_a_grapheme_is_refused() {
    // a, thumbs-up with a skin tone (four units), b.
    let session = lay_out(&["inter"], &model("a\u{1f44d}\u{1f3fd}b"));
    let queries = editing(&session);
    let refused = |argument, offset: f64| {
        EditingError::Offset(OffsetError {
            argument,
            offset,
            reason: OffsetReason::InsideGrapheme,
            text_length: 6,
            before: Some(1),
            after: Some(5),
        })
    };
    assert_eq!(
        queries.caret(down(3)),
        Err(refused(OffsetArgument::Offset, 3.0))
    );
    assert_eq!(
        queries.range_rects(1, 3),
        Err(refused(OffsetArgument::End, 3.0))
    );
    assert_eq!(
        queries.range_rects(2, 5),
        Err(refused(OffsetArgument::Start, 2.0))
    );
    assert_eq!(
        queries.range_rects(5, 1),
        Err(EditingError::Offset(OffsetError {
            argument: OffsetArgument::End,
            offset: 1.0,
            reason: OffsetReason::Reversed,
            text_length: 6,
            before: Some(1),
            after: Some(1),
        }))
    );
    assert_eq!(queries.range_rects(5, 5), Ok(vec![]));
    assert!(queries.caret(down(7)).is_err());
}

// ---------------------------------------------------------------------------------------------
// Unit 3: movement.
// ---------------------------------------------------------------------------------------------

#[test]
fn word_and_sentence_movement_stop_at_words_and_sentences() {
    let text = "Hello, world! How are you? Fine.";
    let session = lay_out(&["inter"], &model(text));
    let queries = editing(&session);
    let walk_by = |start: u32, direction, unit| {
        let mut offsets = vec![start];
        loop {
            let last = *offsets.last().unwrap();
            let next = step(&queries, down(last), direction, unit).offset;
            if next == last {
                return offsets;
            }
            offsets.push(next);
        }
    };
    // Forward rests at the end of each word; backward at the start of each.
    assert_eq!(
        walk_by(0, TextDirection::Forward, TextUnit::Word),
        [0, 5, 12, 17, 21, 25, 31, 32]
    );
    assert_eq!(
        walk_by(32, TextDirection::Backward, TextUnit::Word),
        [32, 27, 22, 18, 14, 7, 0]
    );
    // From inside a word: to its end, to its start.
    assert_eq!(
        step(&queries, down(9), TextDirection::Forward, TextUnit::Word),
        down(12)
    );
    assert_eq!(
        step(&queries, down(9), TextDirection::Backward, TextUnit::Word),
        down(7)
    );
    assert_eq!(
        walk_by(0, TextDirection::Forward, TextUnit::Sentence),
        [0, 14, 27, 32]
    );
    assert_eq!(
        walk_by(32, TextDirection::Backward, TextUnit::Sentence),
        [32, 27, 14, 0]
    );
    // Left and right by word follow the base direction: here, left is backward.
    assert_eq!(
        step(&queries, down(9), TextDirection::Left, TextUnit::Word),
        down(7)
    );
    assert_eq!(
        step(&queries, down(9), TextDirection::Right, TextUnit::Word),
        down(12)
    );
}

#[test]
fn vertical_movement_keeps_its_goal_column() {
    let text = "aaaaaaaaaa\na\naaaaaaaaaa";
    let session = lay_out(&["inter"], &model(text));
    let queries = editing(&session);
    let start = down(8);
    let column = x(&queries, start);
    let line = TextUnit::Line;

    let first = queries
        .move_position(start, TextDirection::Down, line, None)
        .unwrap();
    assert_eq!(
        first.position,
        up(12),
        "the short line ends before the column"
    );
    assert_eq!(first.goal_x, column);
    // With the goal the column survives the short line; without it the caret's own x is used.
    let second = queries
        .move_position(
            first.position,
            TextDirection::Down,
            line,
            Some(first.goal_x),
        )
        .unwrap();
    assert_eq!((second.position, second.goal_x), (down(21), column));
    let forgotten = queries
        .move_position(first.position, TextDirection::Down, line, None)
        .unwrap();
    assert_eq!(forgotten.position, down(14));
    // And back up the same way.
    let third = queries
        .move_position(
            second.position,
            TextDirection::Up,
            line,
            Some(second.goal_x),
        )
        .unwrap();
    let fourth = queries
        .move_position(third.position, TextDirection::Up, line, Some(third.goal_x))
        .unwrap();
    assert_eq!((third.position, fourth.position), (up(12), start));

    // Above the first line is the start of the text, below the last its end; the goal stays.
    let top = queries
        .move_position(down(3), TextDirection::Up, line, Some(40.0))
        .unwrap();
    assert_eq!((top.position, top.goal_x), (down(0), 40.0));
    let bottom = queries
        .move_position(down(15), TextDirection::Down, line, Some(40.0))
        .unwrap();
    assert_eq!((bottom.position, bottom.goal_x), (up(23), 40.0));
    // Any other move reports the new caret's x as the next goal.
    let sideways = queries
        .move_position(
            down(3),
            TextDirection::Forward,
            TextUnit::Grapheme,
            Some(999.0),
        )
        .unwrap();
    assert_eq!(sideways.goal_x, x(&queries, down(4)));
}

#[test]
fn misuse_is_an_error() {
    let session = lay_out(&["inter"], &model("abc"));
    let queries = editing(&session);
    for direction in [TextDirection::Up, TextDirection::Down] {
        for unit in [TextUnit::Grapheme, TextUnit::Word, TextUnit::Sentence] {
            assert_eq!(
                queries
                    .move_position(down(1), direction, unit, None)
                    .map(|moved| moved.position),
                Err(EditingError::UnitNotSupported { direction, unit })
            );
        }
    }
    assert_eq!(
        queries.hit_test(f64::NAN, 0.0),
        Err(EditingError::NotFinite)
    );
    assert_eq!(
        queries.hit_test(0.0, f64::INFINITY),
        Err(EditingError::NotFinite)
    );
    assert_eq!(
        queries
            .move_position(down(1), TextDirection::Down, TextUnit::Line, Some(f64::NAN))
            .map(|moved| moved.position),
        Err(EditingError::NotFinite)
    );
    // A paragraph the root does not have.
    let (engine, fonts) = session.engine();
    assert!(matches!(
        engine.editing(fonts, 4, 99),
        Err(EditingError::NotPrepared)
    ));
}

#[test]
fn a_right_to_left_paragraph_moves_right_toward_its_start() {
    let Some(session) = lay_out_if_present(
        &["hebrew"],
        &model("\u{5e9}\u{5dc}\u{5d5}\u{5dd} \u{5e2}\u{5d5}\u{5dc}\u{5dd}"),
    ) else {
        return;
    };
    let queries = editing(&session);
    assert_eq!(
        walk(&queries, up(9), TextDirection::Right)
            .iter()
            .map(|position| position.offset)
            .collect::<Vec<_>>(),
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    );
    assert_eq!(
        step(&queries, down(2), TextDirection::Left, TextUnit::Grapheme),
        down(3)
    );
    // By word and by line, right is backward here.
    assert_eq!(
        step(&queries, down(7), TextDirection::Right, TextUnit::Word),
        down(5)
    );
    assert_eq!(
        step(&queries, down(2), TextDirection::Right, TextUnit::Line),
        down(0)
    );
    assert_eq!(
        step(&queries, down(2), TextDirection::Left, TextUnit::Line),
        up(9)
    );
}

#[test]
fn carets_after_an_edit_equal_a_cold_layout() {
    // Typing into a ligature and across a wrap, each step through the engine's edit path.
    use pmndrs_glyph_shaper::engine::oracle::{matrix::utf16, model::TextEdit, session::Route};
    let library = library(&["fredoka"]);
    let stack: &[&str] = &["fredoka"];
    let mut model = wrapped();
    let mut warm = session(&library, &[stack], &model);
    for (start, delete, insert) in [
        (2, 0, "f"),
        (1, 2, ""),
        (7, 0, "wa"),
        (0, 3, "o\u{301}"),
        (10, 5, "\n"),
    ] {
        let edit = TextEdit {
            start,
            delete,
            insert: utf16(insert),
        };
        edit.apply(&mut model.text);
        warm.step(&model, std::slice::from_ref(&edit), Route::FULL)
            .expect("edit");
        let cold = session(&library, &[stack], &model);
        let (warm_queries, cold_queries) = (editing(&warm), editing(&cold));
        let stops = warm_queries.caret_stops().unwrap();
        assert_eq!(stops, cold_queries.caret_stops().unwrap());
        for offset in stops {
            for affinity in [Affinity::Upstream, Affinity::Downstream] {
                let position = TextPosition::new(offset, affinity);
                assert_eq!(
                    warm_queries.caret(position).unwrap(),
                    cold_queries.caret(position).unwrap(),
                    "{position:?} after inserting {insert:?} at {start}"
                );
            }
        }
    }
}

#[test]
fn a_move_from_inside_a_grapheme_is_refused() {
    let session = lay_out(&["inter"], &model("a\u{1f44d}\u{1f3fd}b"));
    let queries = editing(&session);
    for direction in [
        TextDirection::Forward,
        TextDirection::Backward,
        TextDirection::Left,
        TextDirection::Right,
        TextDirection::Up,
        TextDirection::Down,
    ] {
        let unit = if matches!(direction, TextDirection::Up | TextDirection::Down) {
            TextUnit::Line
        } else {
            TextUnit::Grapheme
        };
        assert_eq!(
            queries
                .move_position(down(3), direction, unit, None)
                .map(|moved| moved.position),
            Err(EditingError::Offset(OffsetError {
                argument: OffsetArgument::Offset,
                offset: 3.0,
                reason: OffsetReason::InsideGrapheme,
                text_length: 6,
                before: Some(1),
                after: Some(5),
            }))
        );
    }
}

#[test]
fn movement_steps_over_a_sequence_as_one_unit() {
    // An emoji ZWJ sequence, regional-indicator pairs, a keycap, combining marks, conjoining
    // jamo, a conjunct, an emoji modifier, CRLF.
    let (text, boundaries) = sequences();
    let session = lay_out(&["inter"], &model(&text));
    let queries = editing(&session);
    for pair in boundaries.windows(2) {
        for (direction, from, to) in [
            (TextDirection::Forward, pair[0], pair[1]),
            (TextDirection::Backward, pair[1], pair[0]),
        ] {
            assert_eq!(
                step(&queries, down(from), direction, TextUnit::Grapheme).offset,
                to,
                "{direction:?} from {from}"
            );
        }
    }
    // The same stops, visually: the first line left to right, then the line after the hard
    // break, which is not a stop of its own.
    let visited: Vec<u32> = walk(&queries, down(0), TextDirection::Right)
        .iter()
        .map(|position| position.offset)
        .collect();
    assert_eq!(visited, boundaries);
}
