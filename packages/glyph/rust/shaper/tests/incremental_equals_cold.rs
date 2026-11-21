//! One request after a cold layout must leave the engine where a cold layout of the same input
//! leaves it. Each test is the smallest request of a family the layout oracle's differential
//! driver found diverging (`tests/oracle/reference/exact/KNOWN-DIVERGENCES` at `sil-green-1`).
//!
//! `cargo test --release --features oracle --test incremental_equals_cold`

use std::{fs, path::PathBuf};

use pmndrs_glyph_shaper::{
    bidi::DIRECTION_RTL,
    engine::oracle::{
        capture::capture,
        fonts::{FontLibrary, FontRoot, font_spec},
        fuzz::incremental_differences,
        lanes::Capture,
        matrix::utf16,
        model::{Document, Layout, Model, Paragraph, Span, SpanStyle, TextEdit},
        session::{ALL_VIEWS, Route, Session},
    },
};

/// The engine's `OVERFLOW_CLIP`.
const OVERFLOW_CLIP: u8 = 2;

/// A publication that returns no views, then a measurement: a host that reads layout back.
const SILENT_THEN_MEASURE: Route = Route {
    view_mask: 0,
    measure_first: false,
    measure_after: true,
    ..Route::FULL
};

fn library(keys: &[&str]) -> FontLibrary {
    let fonts =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../benches/fixtures/fonts");
    let mut library = FontLibrary::default();
    for key in keys {
        let font = font_spec(key).expect("a font the oracle names");
        assert_eq!(
            font.root,
            FontRoot::Repository,
            "{key} is not in the repository"
        );
        let bytes = fs::read(fonts.join(font.path)).expect("read the font");
        library.insert(key, bytes).expect("prepare the font");
    }
    library
}

struct Change {
    next: Model,
    edits: Vec<TextEdit>,
    route: Route,
}

fn replace(start: u32, delete: u32, insert: &str) -> TextEdit {
    TextEdit {
        start,
        delete,
        insert: utf16(insert),
    }
}

fn edited(model: &Model, edits: &[TextEdit]) -> Model {
    let mut next = model.clone();
    for edit in edits {
        edit.apply(&mut next.text);
    }
    next
}

/// Lays `model` out cold, applies each change to that engine, and requires every result to
/// equal a cold layout of the changed model. Returns the capture after the last change.
fn assert_changes_equal_cold(stack: &[&str], model: &Model, changes: &[Change]) -> Capture {
    assert_ne!(ALL_VIEWS, 0);
    let library = library(stack);
    let stacks: [&[&str]; 1] = [stack];
    let mut warm = Session::new(&library, &stacks).expect("warm session");
    let output = warm.step(model, &[], Route::FULL).expect("cold layout");
    let mut last = capture(&warm, &output).expect("capture");
    for (index, change) in changes.iter().enumerate() {
        let warm_output = warm
            .step(&change.next, &change.edits, change.route)
            .unwrap_or_else(|error| panic!("change {index} was rejected incrementally: {error}"));
        let mut cold = Session::new(&library, &stacks).expect("cold session");
        let cold_output = cold
            .step(&change.next, &[], change.route)
            .expect("cold layout of the changed model");
        let warm_capture = capture(&warm, &warm_output).expect("capture");
        let cold_capture = capture(&cold, &cold_output).expect("capture");
        let (differences, same_owner) = incremental_differences(&warm_capture, &cold_capture);
        assert!(
            same_owner,
            "change {index}: the two layouts use different owners"
        );
        let rendered: Vec<String> = differences.iter().map(|d| d.render()).collect();
        assert!(
            rendered.is_empty(),
            "change {index} differs from cold:\n{}",
            rendered.join("\n")
        );
        last = warm_capture;
    }
    last
}

fn prose(sentences: usize) -> String {
    "the quick brown fox jumps over the lazy dog. ".repeat(sentences)
}

fn underline(id: u32, start: u32, end: u32) -> Span {
    Span {
        id,
        start,
        end,
        style: SpanStyle {
            underline: true,
            ..SpanStyle::default()
        },
    }
}

/// A restyle that reshapes nothing can still split a layout run: adjacent script runs share
/// one only while their styles agree on layout.
#[test]
fn font_size_span_over_one_script_run_splits_its_layout_run() {
    let text = format!("{}\u{43c}\u{438}\u{440} \u{43c}\u{438}\u{440}", prose(8));
    let cyrillic_start = prose(8).encode_utf16().count() as u32;
    let model = Model {
        text: utf16(&text),
        ..Model::default()
    };
    let mut next = model.clone();
    next.spans = vec![Span {
        id: 2,
        start: cyrillic_start,
        end: text.encode_utf16().count() as u32,
        style: SpanStyle {
            font_size: Some(28.0),
            ..SpanStyle::default()
        },
    }];
    let last = assert_changes_equal_cold(
        &["inter"],
        &model,
        &[
            Change {
                next: next.clone(),
                edits: Vec::new(),
                route: Route::FULL,
            },
            Change {
                next: model.clone(),
                edits: Vec::new(),
                route: Route::FULL,
            },
        ],
    );
    assert_eq!(last.u32_rows("cluster.layout_run.cluster_start").len(), 1);
}

/// A style change in the same request as a same-length edit renumbers the resolved segments of
/// the whole paragraph, not only those of the run the edit reshapes.
#[test]
fn same_length_edit_with_span_added_elsewhere_remaps_every_cluster() {
    // Two shaping runs: with one, the edit rebuilds every cluster anyway.
    let model = Model {
        text: utf16(&format!("\u{641}\u{642}\u{631}\u{629} {}", prose(12))),
        ..Model::default()
    };
    // The edit is in the first run, whose clusters the old first segment still covers; the
    // span lands in the second, which the edit does not rebuild.
    let edits = vec![replace(1, 1, "\u{641}")];
    let mut next = edited(&model, &edits);
    next.spans = vec![underline(2, 200, 230)];
    // One font for both scripts: the windowed reshape needs the run's first font to cover it.
    assert_changes_equal_cold(
        &["amiri"],
        &model,
        &[Change {
            next,
            edits,
            route: Route::FULL,
        }],
    );
}

/// The same request shape with the span removed left style indexes past the end of the new
/// segment list, and the engine rejected input a cold layout accepts.
#[test]
fn same_length_edit_with_span_removed_is_accepted() {
    let mut model = Model {
        text: utf16(&format!("\u{641}\u{642}\u{631}\u{629} {}", prose(8))),
        ..Model::default()
    };
    model.spans = vec![underline(2, 300, 330)];
    let edits = vec![replace(120, 1, "H")];
    let mut next = edited(&model, &edits);
    next.spans = Vec::new();
    assert_changes_equal_cold(
        &["inter", "amiri"],
        &model,
        &[Change {
            next,
            edits,
            route: Route::FULL,
        }],
    );
}

/// Replacing a space after a comma with U+200F inside a right-to-left run: a whole-run shaping
/// flags the mark unsafe to break from the comma before it, so the window that reshapes only
/// the mark must see that comma.
#[test]
fn reshaped_window_keeps_the_flags_its_left_neighbour_causes() {
    let mut model = Model {
        text: utf16(&format!(
            "abc \u{5d0} 1 2 3 4 5 6 7 8 9, 10 + 11 x {}",
            prose(6)
        )),
        ..Model::default()
    };
    model.root.direction = DIRECTION_RTL;
    model.layout.width = 400.0;
    let comma = model.text.iter().position(|unit| *unit == 0x2c).unwrap() as u32;
    let edits = vec![replace(comma + 1, 1, "\u{200f}")];
    let next = edited(&model, &edits);
    // No font here has the Hebrew letter; it only gives the comma's run its direction.
    assert_changes_equal_cold(
        &["inter"],
        &model,
        &[Change {
            next,
            edits,
            route: Route::FULL,
        }],
    );
}

fn clipped_paragraph() -> Model {
    Model {
        text: utf16(&format!("one\ntwo\n{}", prose(20))),
        layout: Layout {
            width: 420.0,
            height: 40.0,
            overflow: OVERFLOW_CLIP,
            ..Layout::default()
        },
        ..Model::default()
    }
}

/// A width change that moves no visible break still changes the unclipped layout a measurement
/// reports, so the measurement after a silent publication must not answer from the old width.
#[test]
fn measurement_after_a_silent_width_change_uses_the_new_width() {
    let model = clipped_paragraph();
    let mut next = model.clone();
    next.layout.width = 250.0;
    assert_changes_equal_cold(
        &["inter"],
        &model,
        &[Change {
            next,
            edits: Vec::new(),
            route: SILENT_THEN_MEASURE,
        }],
    );
}

/// The same width change, published with views: the retained fragments must carry the new
/// slot, not the one they were composed in.
#[test]
fn width_change_that_moves_no_break_updates_fragment_slots() {
    let model = Model {
        text: utf16("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve"),
        ..Model::default()
    };
    let mut next = model.clone();
    next.layout.width = 480.0;
    let last = assert_changes_equal_cold(
        &["inter"],
        &model,
        &[Change {
            next,
            edits: Vec::new(),
            route: Route::FULL,
        }],
    );
    assert!(last.lane("flow.fragment.slot_end").is_some());
}

/// A same-length edit that makes the last text line wrap: the reflow reaches the old empty
/// line a final hard break owns while it still has that hard break to place, and must go on
/// to compose the empty line after it.
#[test]
fn reflow_into_the_trailing_empty_line_still_ends_with_one() {
    let mut model = Model {
        text: utf16(&format!("{}\na ii i\n", prose(10))),
        ..Model::default()
    };
    // Wide enough for `a WW` and not for `a WW i`.
    model.layout.width = 46.0;
    // Past the first unit of the line, so the run keeps the identity its retention is keyed on.
    let start = prose(10).encode_utf16().count() as u32 + 3;
    let edits = vec![replace(start, 2, "WW")];
    let next = edited(&model, &edits);
    assert_changes_equal_cold(
        &["inter"],
        &model,
        &[Change {
            next,
            edits,
            route: Route::FULL,
        }],
    );
}

/// Metric changes rerun run-local geometry from the font units the paragraph already holds,
/// and a line-height change reuses the geometry. Both must land on the cold layout's bits:
/// 23.7 over Inter's 2048-unit em and Fredoka's 1000-unit em are not dyadic scales, and Fredoka
/// corrects a break at every space.
#[test]
fn metric_and_line_height_changes_equal_a_cold_layout_at_the_new_metrics() {
    for font in ["inter", "fredoka"] {
        let model = Model {
            text: utf16(&format!("{}AVATAR To Wa office affine. ", prose(40))),
            ..Model::default()
        };
        let restyled = |change: fn(&mut Model)| {
            let mut next = model.clone();
            change(&mut next);
            Change {
                next,
                edits: Vec::new(),
                route: Route::FULL,
            }
        };
        assert_changes_equal_cold(
            &[font],
            &model,
            &[
                restyled(|next| next.root.font_size = 23.7),
                restyled(|next| next.root.line_height = 1.45),
                restyled(|next| {
                    next.root.font_size = 23.7;
                    next.root.line_height = 1.45;
                }),
                restyled(|next| next.root.letter_spacing = 0.35),
                restyled(|next| next.root.word_spacing = 1.3),
                restyled(|next| {
                    next.spans = vec![Span {
                        id: 2,
                        start: 30,
                        end: 300,
                        style: SpanStyle {
                            font_size: Some(11.3),
                            baseline_shift: Some(2.5),
                            ..SpanStyle::default()
                        },
                    }];
                }),
                restyled(|_| ()),
            ],
        );
    }
}

/// Four explicit paragraphs in authored order 100, 200, 300, 400.
/// A lane of `f64` rows.
fn f64_rows(capture: &Capture, name: &str) -> Vec<f64> {
    capture
        .lane(name)
        .unwrap_or_else(|| panic!("no lane {name}"))
        .bytes
        .chunks_exact(8)
        .map(|row| f64::from_le_bytes(row.try_into().expect("eight bytes")))
        .collect()
}

/// An empty paragraph is one line and each hard break ends one: `""` has one line, `"\n"` two,
/// `"\n\n"` three, each zero wide with the font's line box, so a measurement has a height and
/// a caret has a line to be on. Inter's em is 2048 units with an ascender of 1984 and a
/// descender of 494: at 16 px that is 15.5 above the baseline and 3.859375 below, and the
/// default line height of 1.2 makes each line 19.2 tall with the difference shared out as
/// half-leading on either side. Typing the breaks one by one must land on the same lines.
#[test]
fn empty_and_newline_only_text_have_one_line_per_paragraph() {
    let height = f64::from(16.0_f32 * 1.2_f32);
    let (ascent, descent) = (1984.0 / 2048.0 * 16.0, 494.0 / 2048.0 * 16.0);
    let baseline = ascent + (height - ascent - descent) / 2.0;
    let text = |text: &str| Model {
        text: utf16(text),
        ..Model::default()
    };
    let typed = |from: &str, start: u32, delete: u32, insert: &str| {
        let edits = vec![replace(start, delete, insert)];
        Change {
            next: edited(&text(from), &edits),
            edits,
            route: Route::FULL,
        }
    };
    for (content, lines) in [("", 1_usize), ("\n", 2), ("\n\n", 3)] {
        let capture = assert_changes_equal_cold(&["inter"], &text(content), &[]);
        assert_eq!(
            f64_rows(&capture, "flow.line.height"),
            vec![height; lines],
            "{content:?}"
        );
        assert_eq!(
            f64_rows(&capture, "flow.line.baseline"),
            vec![baseline; lines],
            "{content:?}"
        );
        assert_eq!(
            f64_rows(&capture, "flow.line.block_start"),
            (0..lines)
                .map(|line| line as f64 * height)
                .collect::<Vec<_>>(),
            "{content:?}"
        );
        assert_eq!(
            f64_rows(&capture, "flow.line.typography_ascent"),
            vec![ascent; lines]
        );
        assert_eq!(
            f64_rows(&capture, "flow.line.typography_descent"),
            vec![descent; lines]
        );
        assert_eq!(
            f64_rows(&capture, "flow.fragment.advance"),
            vec![0.0; lines]
        );
        assert_eq!(
            f64_rows(&capture, "positioned.line.inline_extent"),
            vec![0.0; lines]
        );
        assert_eq!(
            capture.u32_rows("positioned.line.glyph_count"),
            vec![0; lines]
        );
        // The measured paragraph: zero wide, as tall as its lines.
        let measured = |name: &str| {
            let lane = capture
                .lane(&format!("view.measured_after.{name}"))
                .expect("the measured view");
            f32::from_le_bytes(lane.bytes[..4].try_into().expect("four bytes"))
        };
        assert_eq!(measured("inline_extent"), 0.0, "{content:?}");
        assert_eq!(
            measured("block_extent"),
            (lines as f64 * height) as f32,
            "{content:?}"
        );
    }
    // Emptied, broken, broken again, and filled: every step is the cold layout.
    assert_changes_equal_cold(
        &["inter"],
        &text("a"),
        &[
            typed("a", 0, 1, ""),
            typed("", 0, 0, "\n"),
            typed("\n", 1, 0, "\n"),
            typed("\n\n", 0, 0, "b"),
            typed("b\n\n", 0, 3, ""),
        ],
    );
}

fn four_paragraphs() -> Document {
    Document {
        paragraphs: (1..=4)
            .map(|id| Paragraph {
                id,
                order: id * 100,
                scope: 0,
                rank: 0.0,
                model: Model {
                    text: utf16(&format!("paragraph {id}")),
                    ..Model::default()
                },
            })
            .collect(),
        explicit: true,
        minted: 4,
    }
}

/// Lays `start` out cold, moves that engine through `documents` one request each, and requires
/// every result to equal a cold layout of the same document.
fn assert_documents_equal_cold(start: &Document, documents: &[Document]) {
    let library = library(&["inter"]);
    let stacks: [&[&str]; 1] = [&["inter"]];
    let mut warm = Session::new(&library, &stacks).expect("warm session");
    warm.step_document(start, &[], Route::FULL)
        .expect("cold layout");
    for (index, document) in documents.iter().enumerate() {
        let warm_output = warm
            .step_document(document, &[], Route::FULL)
            .unwrap_or_else(|error| panic!("document {index} was rejected incrementally: {error}"));
        let mut cold = Session::new(&library, &stacks).expect("cold session");
        let cold_output = cold
            .step_document(document, &[], Route::FULL)
            .expect("cold layout of the document");
        let warm_capture = capture(&warm, &warm_output).expect("capture");
        let cold_capture = capture(&cold, &cold_output).expect("capture");
        assert!(cold_capture.lane("doc.order.id").is_some());
        let (differences, _) = incremental_differences(&warm_capture, &cold_capture);
        let rendered: Vec<String> = differences.iter().map(|d| d.render()).collect();
        assert!(
            rendered.is_empty(),
            "document {index} differs from cold:\n{}",
            rendered.join("\n")
        );
    }
}

/// Members of a scope trade the scope's places in the root order by rank. A place belongs to
/// the authored order of the paragraph that holds it without ranks, so when a member is
/// removed, leaves the scope or is reordered, the others return to their own places.
#[test]
fn ranked_scope_members_return_to_their_own_places() {
    let start = four_paragraphs();
    let mut ranked = start.clone();
    for (id, rank) in [(2, 2.5), (4, -1.0)] {
        let paragraph = ranked
            .paragraph_mut(id)
            .expect("a paragraph of the document");
        paragraph.scope = 7;
        paragraph.rank = rank;
    }
    let mut removed = ranked.clone();
    removed.paragraphs.retain(|paragraph| paragraph.id != 2);
    assert_documents_equal_cold(&start, &[ranked.clone(), removed]);

    let mut left = ranked.clone();
    left.paragraph_mut(4).expect("paragraph 4").scope = 0;
    assert_documents_equal_cold(&start, &[ranked.clone(), left]);

    let mut reordered = ranked.clone();
    reordered.paragraph_mut(3).expect("paragraph 3").order = 50;
    assert_documents_equal_cold(&start, &[ranked, reordered]);
}
