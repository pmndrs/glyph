//! Offsets, the offset map and unit boundaries: what is a valid offset, and which grapheme,
//! word, sentence and line contains a position.
//!
//! `cargo test --release --features oracle --test editing_offsets`.

mod editing;

use editing::{
    at, down, editing, lay_out, library, model, prepare_lanes, sequences, session, units, up,
    wrapped,
};
use pmndrs_glyph_shaper::engine::editing::{
    Affinity, EditingError, LayoutSource, OffsetArgument, OffsetError, OffsetReason, TextRange,
    TextUnit,
};

#[test]
fn an_offset_is_validated_and_never_snapped() {
    // a, thumbs-up with a skin tone (four units), b, space, e with a combining acute.
    let text = "a\u{1f44d}\u{1f3fd}b e\u{301}";
    let session = lay_out(&["inter"], &model(text));
    let queries = editing(&session);
    assert_eq!(queries.text_length(), 9);
    assert_eq!(queries.caret_stops().unwrap(), [0, 1, 5, 6, 7, 9]);

    let refused = |offset: f64, reason, before, after| OffsetError {
        argument: OffsetArgument::Offset,
        offset,
        reason,
        text_length: 9,
        before,
        after,
    };
    for (offset, expected) in [
        (
            2.0,
            refused(2.0, OffsetReason::InsideGrapheme, Some(1), Some(5)),
        ),
        (
            3.0,
            refused(3.0, OffsetReason::InsideGrapheme, Some(1), Some(5)),
        ),
        (
            8.0,
            refused(8.0, OffsetReason::InsideGrapheme, Some(7), Some(9)),
        ),
        (10.0, refused(10.0, OffsetReason::OutOfRange, Some(9), None)),
        (-1.0, refused(-1.0, OffsetReason::OutOfRange, None, Some(0))),
        (
            2.5,
            refused(2.5, OffsetReason::NotInteger, Some(1), Some(5)),
        ),
        (
            f64::INFINITY,
            refused(f64::INFINITY, OffsetReason::NotInteger, Some(9), None),
        ),
    ] {
        assert_eq!(
            queries.validate_offset(OffsetArgument::Offset, offset),
            Err(expected),
            "{offset}"
        );
    }
    let nan = queries
        .validate_offset(OffsetArgument::Offset, f64::NAN)
        .unwrap_err();
    assert_eq!(
        (nan.reason, nan.before, nan.after),
        (OffsetReason::NotInteger, None, None)
    );
    assert!(nan.offset.is_nan(), "the offset comes back as given");
    for offset in [0.0, 1.0, 5.0, 6.0, 7.0, 9.0] {
        assert_eq!(
            queries.validate_offset(OffsetArgument::Offset, offset),
            Ok(offset as u32)
        );
    }

    // Every query refuses the same way: nothing lands on the cluster start instead.
    let inside = EditingError::Offset(refused(3.0, OffsetReason::InsideGrapheme, Some(1), Some(5)));
    assert_eq!(queries.normalize(up(3)), Err(inside));
    assert_eq!(queries.locate(down(3)), Err(inside));
    assert_eq!(queries.is_caret_stop(3), Err(inside));
    for unit in [
        TextUnit::Grapheme,
        TextUnit::Word,
        TextUnit::Sentence,
        TextUnit::Line,
    ] {
        assert_eq!(queries.boundary(down(3), unit), Err(inside));
    }
    assert_eq!(
        queries.position(3.0, Affinity::Upstream),
        Err(refused(3.0, OffsetReason::InsideGrapheme, Some(1), Some(5)))
    );
    assert_eq!(queries.position(5.0, Affinity::Upstream), Ok(up(5)));

    // Ranges name the argument at fault; a reversed range is an error about its end.
    assert_eq!(
        queries.validate_range(1.0, 3.0),
        Err(OffsetError {
            argument: OffsetArgument::End,
            ..refused(3.0, OffsetReason::InsideGrapheme, Some(1), Some(5))
        })
    );
    assert_eq!(
        queries.validate_range(12.0, 5.0),
        Err(OffsetError {
            argument: OffsetArgument::Start,
            ..refused(12.0, OffsetReason::OutOfRange, Some(9), None)
        })
    );
    assert_eq!(
        queries.validate_range(5.0, 1.0),
        Err(OffsetError {
            argument: OffsetArgument::End,
            offset: 1.0,
            reason: OffsetReason::Reversed,
            text_length: 9,
            before: Some(1),
            after: Some(1),
        })
    );
    assert_eq!(
        queries.validate_range(5.0, 5.0),
        Ok(TextRange { start: 5, end: 5 })
    );
}

#[test]
fn a_unit_is_the_one_that_contains_the_position() {
    let text = "Hello, w\u{f6}rld! It's 3.5 km. \u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467} ok\nNext line.";
    let session = lay_out(&["inter"], &model(text));
    let queries = editing(&session);
    let range = |start: u32, end: u32| TextRange { start, end };
    let unit = |position, unit| queries.boundary(position, unit).unwrap();

    // Grapheme: the family emoji is one unit of eight code units, from either side.
    let family = at(text, "\u{1f468}");
    assert_eq!(
        unit(down(family), TextUnit::Grapheme),
        range(family, family + 8)
    );
    assert_eq!(
        unit(up(family + 8), TextUnit::Grapheme),
        range(family, family + 8)
    );
    assert_eq!(unit(down(0), TextUnit::Grapheme), range(0, 1));
    assert_eq!(
        unit(up(0), TextUnit::Grapheme),
        range(0, 1),
        "no unit ends at 0"
    );
    let end = units(text);
    assert_eq!(unit(down(end), TextUnit::Grapheme), range(end - 1, end));

    // Word: UAX #29 segments. A position between two belongs to the side its affinity names.
    let world = at(text, "w\u{f6}rld");
    assert_eq!(
        unit(down(world + 2), TextUnit::Word),
        range(world, world + 5)
    );
    assert_eq!(unit(down(world), TextUnit::Word), range(world, world + 5));
    assert_eq!(
        unit(up(world), TextUnit::Word),
        range(world - 1, world),
        "the space"
    );
    assert_eq!(
        unit(down(5), TextUnit::Word),
        range(5, 6),
        "the comma is its own unit"
    );
    assert_eq!(
        unit(down(at(text, "It's") + 2), TextUnit::Word),
        range(14, 18)
    );
    assert_eq!(unit(down(at(text, "3.5")), TextUnit::Word), range(19, 22));

    // Sentence: UAX #29. "km. " is followed by an emoji and a lower-case word, which does not
    // start a sentence (SB8), so the second sentence runs to the hard break.
    let next = at(text, "Next");
    assert_eq!(
        unit(down(3), TextUnit::Sentence),
        range(0, at(text, "It's"))
    );
    assert_eq!(
        unit(down(at(text, "km")), TextUnit::Sentence),
        range(at(text, "It's"), next)
    );
    assert_eq!(
        unit(down(next), TextUnit::Sentence),
        range(next, units(text))
    );

    // Line: a line owns the hard break that ends it.
    assert_eq!(unit(down(3), TextUnit::Line), range(0, next));
    assert_eq!(
        unit(down(next - 1), TextUnit::Line),
        range(0, next),
        "before the break"
    );
    assert_eq!(unit(down(next), TextUnit::Line), range(next, end));
    assert_eq!(unit(down(end), TextUnit::Line), range(next, end));

    // The offset map: grapheme index, stable unit id, shaping cluster, line.
    let location = queries.locate(down(family)).unwrap();
    assert_eq!(
        location.grapheme as usize,
        text[..text.find('\u{1f468}').unwrap()].chars().count()
    );
    assert_eq!(location.line, 0);
    assert_eq!(location.line_range, range(0, next));
    let id = location.unit_id.expect("a unit at the offset");
    assert_eq!(queries.offset_of_unit(id), Some(family));
    assert_eq!(queries.locate(down(end)).unwrap().unit_id, None);
    assert_eq!(queries.locate(down(next)).unwrap().line, 1);
}

#[test]
fn a_sequence_is_one_grapheme_and_one_stop() {
    let (text, boundaries) = sequences();
    let session = lay_out(&["inter"], &model(&text));
    let queries = editing(&session);
    assert_eq!(queries.caret_stops().unwrap(), boundaries);
    for pair in boundaries.windows(2) {
        let unit = TextRange {
            start: pair[0],
            end: pair[1],
        };
        assert_eq!(
            queries.boundary(down(pair[0]), TextUnit::Grapheme).unwrap(),
            unit
        );
        assert_eq!(
            queries.boundary(up(pair[1]), TextUnit::Grapheme).unwrap(),
            unit
        );
        assert_eq!(queries.is_caret_stop(pair[1]), Ok(true));
        // Every offset inside the sequence is refused with the sequence's two ends.
        for inside in pair[0] + 1..pair[1] {
            let refused = queries
                .check_offset(OffsetArgument::Offset, inside)
                .unwrap_err();
            assert_eq!(
                (refused.reason, refused.before, refused.after),
                (OffsetReason::InsideGrapheme, Some(pair[0]), Some(pair[1]))
            );
        }
    }
}

#[test]
fn line_units_tile_the_text() {
    // Hard breaks, an empty line, and soft wraps: every line owns the break that ends it.
    for (stack, model, expected) in [
        (
            &["inter"][..],
            model("ab\n\ncd"),
            vec![(0, 3), (3, 4), (4, 6)],
        ),
        (&["inter"][..], model("word\n"), vec![(0, 5), (5, 5)]),
        (
            &["fredoka"][..],
            wrapped(),
            vec![(0, 7), (7, 14), (14, 20), (20, 28)],
        ),
    ] {
        let session = lay_out(stack, &model);
        let queries = editing(&session);
        let lines: Vec<(u32, u32)> = (0..queries.source().line_count())
            .map(|line| queries.line_range(line).unwrap())
            .map(|range| (range.start, range.end))
            .collect();
        assert_eq!(lines, expected);
        for (line, (start, end)) in expected.iter().enumerate() {
            if start == end {
                continue;
            }
            let located = queries.locate(down(*start)).unwrap();
            assert_eq!((located.line, located.line_range.end), (line as u32, *end));
            assert_eq!(
                queries.boundary(down(*start), TextUnit::Line).unwrap(),
                TextRange {
                    start: *start,
                    end: *end
                }
            );
        }
    }
    // Empty text is one empty line, and text that is only hard breaks is one line per break and
    // the empty line after the last: each line owns its break, the last line owns nothing.
    for (text, expected) in [
        ("", vec![(0, 0)]),
        ("\n", vec![(0, 1), (1, 1)]),
        ("\n\n", vec![(0, 1), (1, 2), (2, 2)]),
    ] {
        let session = lay_out(&["inter"], &model(text));
        let queries = editing(&session);
        let lines: Vec<(u32, u32)> = (0..queries.source().line_count())
            .map(|line| queries.line_range(line).unwrap())
            .map(|range| (range.start, range.end))
            .collect();
        assert_eq!(lines, expected, "{text:?}");
        for (start, end) in expected {
            assert_eq!(
                queries.boundary(down(start), TextUnit::Line).unwrap(),
                TextRange { start, end },
                "{text:?}"
            );
        }
    }
}

#[test]
fn word_and_sentence_units_after_an_edit_equal_a_cold_layout() {
    // A same-length letter edit keeps the paragraph's Unicode analysis, and with it the lanes
    // the queries filled. Capitalising the `o` starts a sentence there (UAX #29 SB8 and SB11),
    // so a lane kept as it was would still answer with one sentence.
    use pmndrs_glyph_shaper::engine::oracle::{matrix::utf16, model::TextEdit, session::Route};
    let library = library(&["inter"]);
    let stack: &[&str] = &["inter"];
    let mut model = model("Go. ok then, and more.");
    let mut warm = session(&library, &[stack], &model);
    prepare_lanes(&mut warm);
    assert_eq!(
        editing(&warm)
            .boundary(down(6), TextUnit::Sentence)
            .unwrap(),
        TextRange { start: 0, end: 22 }
    );
    for (start, delete, insert) in [(4, 1, "O"), (4, 1, "o"), (9, 1, "N"), (3, 0, " A")] {
        let edit = TextEdit {
            start,
            delete,
            insert: utf16(insert),
        };
        edit.apply(&mut model.text);
        warm.step(&model, std::slice::from_ref(&edit), Route::FULL)
            .expect("edit");
        prepare_lanes(&mut warm);
        let mut cold = session(&library, &[stack], &model);
        prepare_lanes(&mut cold);
        let (warm_queries, cold_queries) = (editing(&warm), editing(&cold));
        for unit in [TextUnit::Word, TextUnit::Sentence] {
            for offset in warm_queries.caret_stops().unwrap() {
                assert_eq!(
                    warm_queries.boundary(down(offset), unit).unwrap(),
                    cold_queries.boundary(down(offset), unit).unwrap(),
                    "{unit:?} at {offset} after {insert:?} at {start}"
                );
            }
        }
    }
    assert_eq!(
        editing(&warm)
            .boundary(down(8), TextUnit::Sentence)
            .unwrap()
            .start,
        4,
        "\"Go. A ok theN, and more.\": the inserted capital starts the second sentence"
    );
}

#[test]
fn boundary_lanes_follow_edits_with_and_without_queries_between() {
    // Once a word or sentence query has filled a paragraph's lanes they are carried across
    // edits and recompute a window around each; after 32 edits with no query they are dropped
    // and the next query computes them whole. Either way the answer is a cold layout's.
    use pmndrs_glyph_shaper::engine::oracle::{matrix::utf16, model::TextEdit, session::Route};
    let library = library(&["inter"]);
    let stack: &[&str] = &["inter"];
    for queried_every in [1_usize, 5, 40] {
        let mut model = model("One. two three. Four five, six? seven");
        let mut warm = session(&library, &[stack], &model);
        prepare_lanes(&mut warm);
        for step in 0..80_usize {
            // Insert, capitalise, delete and split sentences at offsets that move with the text.
            let length = model.text.len() as u32;
            let at = (step as u32 * 7 + 3) % length.max(1);
            let (start, delete, insert) = match step % 4 {
                0 => (at, 0, ". X"),
                1 => (at, 1, "q"),
                2 => (at.min(length - 1), 1, ""),
                _ => (at, 0, " w"),
            };
            let edit = TextEdit {
                start,
                delete,
                insert: utf16(insert),
            };
            edit.apply(&mut model.text);
            warm.step(&model, std::slice::from_ref(&edit), Route::FULL)
                .expect("edit");
            if (step + 1) % queried_every != 0 {
                continue;
            }
            prepare_lanes(&mut warm);
            let mut cold = session(&library, &[stack], &model);
            prepare_lanes(&mut cold);
            let (warm_queries, cold_queries) = (editing(&warm), editing(&cold));
            for unit in [TextUnit::Word, TextUnit::Sentence] {
                let mut offset = 0;
                while offset < warm_queries.text_length() {
                    let range = warm_queries.boundary(down(offset), unit).unwrap();
                    assert_eq!(
                        Ok(range),
                        cold_queries.boundary(down(offset), unit),
                        "{unit:?} at {offset} after step {step}, queried every {queried_every}"
                    );
                    offset = range.end;
                }
            }
        }
    }
}
