//! Font fallback picks one font per extended grapheme cluster: a cluster whose base a font
//! lacks moves to the next font of the stack whole, with every mark, joiner and other Extend
//! or Prepend code point it holds, even where HarfRust reports that code point as a cluster
//! of its own.
//!
//! `cargo test --release --features oracle --test fallback_graphemes`

use std::{fs, path::PathBuf};

use pmndrs_glyph_shaper::engine::oracle::{
    capture::capture,
    fonts::{FontLibrary, FontRoot, font_spec},
    fuzz::incremental_differences,
    lanes::Capture,
    matrix::utf16,
    model::{Model, TextEdit},
    session::{FIRST_BINDING_HANDLE, Route, Session},
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

fn model(text: &str) -> Model {
    Model {
        text: utf16(text),
        ..Model::default()
    }
}

/// A cold layout of `text` in the one stack `stack`.
fn cold(stack: &[&str], text: &str) -> Result<Capture, String> {
    let library = library(stack);
    let mut session = Session::new(&library, &[stack])?;
    let output = session.step(&model(text), &[], Route::FULL)?;
    capture(&session, &output)
}

/// Each grapheme cluster as `(text start, text end, position of its font in the stack)`.
fn cluster_fonts(capture: &Capture) -> Vec<(u32, u32, u32)> {
    let starts = capture.u32_rows("cluster.text_start");
    let ends = capture.u32_rows("cluster.text_end");
    let bindings = capture.u32_rows("cluster.binding_handle");
    assert_eq!(starts.len(), ends.len());
    assert_eq!(starts.len(), bindings.len());
    starts
        .into_iter()
        .zip(ends)
        .zip(bindings)
        .map(|((start, end), binding)| (start, end, binding - FIRST_BINDING_HANDLE))
        .collect()
}

/// `text` lays out cold in `stack` with each grapheme cluster in the font `expected` names.
fn assert_cluster_fonts(stack: &[&str], text: &str, expected: &[(u32, u32, u32)]) {
    let capture = cold(stack, text)
        .unwrap_or_else(|error| panic!("{text:?} in {stack:?} was rejected: {error}"));
    assert_eq!(cluster_fonts(&capture), expected, "{text:?} in {stack:?}");
}

const INTER_AMIRI: &[&str] = &["inter", "amiri"];
const INTER_CJK: &[&str] = &["inter", "cjk-jp"];

/// ZWNJ extends the lam before it. Inter lacks the lam but HarfRust hides a default-ignorable
/// it lacks instead of reporting it missing, so the joiner alone would stay in Inter.
#[test]
fn zwnj_follows_the_arabic_base_it_extends() {
    assert_cluster_fonts(
        INTER_AMIRI,
        "\u{627}\u{644}\u{200C}\u{646}\u{635}",
        &[(0, 1, 1), (1, 3, 1), (3, 4, 1), (4, 5, 1)],
    );
}

#[test]
fn zwj_follows_the_arabic_base_it_extends() {
    assert_cluster_fonts(
        INTER_AMIRI,
        "\u{627}\u{644}\u{200D}\u{646}\u{635}",
        &[(0, 1, 1), (1, 3, 1), (3, 4, 1), (4, 5, 1)],
    );
}

/// A combining mark Inter has, after a base it lacks.
#[test]
fn a_covered_combining_mark_follows_its_uncovered_base() {
    assert_cluster_fonts(
        INTER_AMIRI,
        "\u{627}\u{644}\u{301}\u{646}",
        &[(0, 1, 1), (1, 3, 1), (3, 4, 1)],
    );
}

#[test]
fn a_variation_selector_follows_its_uncovered_base() {
    assert_cluster_fonts(
        INTER_AMIRI,
        "\u{627}\u{644}\u{FE00}\u{646}",
        &[(0, 1, 1), (1, 3, 1), (3, 4, 1)],
    );
}

/// An Arabic mark Inter lacks, after a Latin base it has: the first font that covers both.
#[test]
fn an_uncovered_mark_takes_its_covered_base_to_the_next_font() {
    assert_cluster_fonts(INTER_AMIRI, "a\u{651}b", &[(0, 2, 1), (2, 3, 0)]);
}

/// A halfwidth voiced sound mark is Extend but a letter (Lm), not a mark: HarfRust gives it a
/// cluster of its own.
#[test]
fn a_halfwidth_sound_mark_follows_its_base() {
    assert_cluster_fonts(INTER_CJK, "a\u{FF9E}b", &[(0, 2, 1), (2, 3, 0)]);
}

/// U+0600 ARABIC NUMBER SIGN is Prepend: the digit after it is part of its cluster.
#[test]
fn a_prepended_concatenation_mark_takes_the_digit_after_it() {
    assert_cluster_fonts(
        INTER_AMIRI,
        "a\u{600}1b",
        &[(0, 1, 0), (1, 3, 1), (3, 4, 0)],
    );
}

/// Inserting the joiner into a laid-out paragraph equals laying the joined text out cold.
#[test]
fn inserting_zwnj_after_a_fallback_base_equals_cold() {
    let library = library(INTER_AMIRI);
    let stacks: [&[&str]; 1] = [INTER_AMIRI];
    let before = model("\u{627}\u{644}\u{646}\u{635} abc");
    let edit = TextEdit {
        start: 2,
        delete: 0,
        insert: utf16("\u{200C}"),
    };
    let mut after = before.clone();
    edit.apply(&mut after.text);

    let mut warm = Session::new(&library, &stacks).expect("warm session");
    warm.step(&before, &[], Route::FULL).expect("cold layout");
    let warm_output = warm
        .step(&after, &[edit], Route::FULL)
        .expect("the insertion");
    let warm_capture = capture(&warm, &warm_output).expect("capture");
    let mut cold = Session::new(&library, &stacks).expect("cold session");
    let cold_output = cold.step(&after, &[], Route::FULL).expect("cold layout");
    let cold_capture = capture(&cold, &cold_output).expect("capture");

    let (differences, same_owner) = incremental_differences(&warm_capture, &cold_capture);
    assert!(same_owner, "the two layouts use different owners");
    let rendered: Vec<String> = differences.iter().map(|d| d.render()).collect();
    assert!(
        rendered.is_empty(),
        "the insertion differs from cold:\n{}",
        rendered.join("\n")
    );
    assert_eq!(
        cluster_fonts(&warm_capture)[..4],
        [(0, 1, 1), (1, 3, 1), (3, 4, 1), (4, 5, 1)]
    );
}
