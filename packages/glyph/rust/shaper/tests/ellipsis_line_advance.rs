//! A line cut for an ellipsis is as wide as what it draws. The cut drops the line's end, so a
//! line-edge correction priced for that end must go with it, or an end-aligned line shifts by
//! the correction and its measured width disagrees with its glyphs.
//!
//! `cargo test --release --features oracle --test ellipsis_line_advance`

use std::{fs, path::PathBuf};

use pmndrs_glyph_shaper::engine::oracle::{
    capture::capture,
    fonts::{FontLibrary, font_spec},
    lanes::Capture,
    matrix::utf16,
    model::{Layout, Model},
    session::{Route, Session},
};

/// The engine's `ALIGN_END` and `OVERFLOW_ELLIPSIS`.
const ALIGN_END: u8 = 3;
const OVERFLOW_ELLIPSIS: u8 = 3;

/// Japanese whose first line at 260 units ends at a break the font corrects: the island before
/// it, shaped alone as a line end, is 0.8 wider than the paragraph's glyphs there.
const TEXT: &str = "\u{3057}\u{307e}\u{3059}\u{300c}\u{306e}\u{6771}\u{4eac}\u{304b}\u{306a}\u{ff11}\u{ff12}\u{ff13}\u{ff01}\u{6bb5}\u{843d}\u{3063}\u{3066}\u{3083}\u{300d}\u{5e45}\u{884c}\u{6bb5}\u{843d}\u{6bb5}\u{843d}\u{884c}\u{3057}\u{307e}\u{3059}Glyph";

fn layout(max_lines: u32, overflow: u8) -> Capture {
    let fonts =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../benches/fixtures/fonts");
    let font = font_spec("cjk-jp").expect("the oracle's Japanese font");
    let mut library = FontLibrary::default();
    library
        .insert(
            "cjk-jp",
            fs::read(fonts.join(font.path)).expect("read the font"),
        )
        .expect("prepare the font");
    let stacks: [&[&str]; 1] = [&["cjk-jp"]];
    let mut session = Session::new(&library, &stacks).expect("session");
    let model = Model {
        text: utf16(TEXT),
        layout: Layout {
            width: 260.0,
            align: ALIGN_END,
            max_lines,
            overflow,
            ..Layout::default()
        },
        ..Model::default()
    };
    let output = session.step(&model, &[], Route::FULL).expect("layout");
    capture(&session, &output).expect("capture")
}

fn rows<const N: usize, T>(capture: &Capture, name: &str, read: fn([u8; N]) -> T) -> Vec<T> {
    let lane = capture
        .lane(name)
        .unwrap_or_else(|| panic!("no lane {name}"));
    lane.bytes
        .chunks_exact(N)
        .map(|row| read(row.try_into().expect("whole rows")))
        .collect()
}

/// The first line's charged advance, its end correction, and the sum of the advances it draws.
fn first_line(capture: &Capture) -> (f64, i32, f64) {
    let advance = rows(capture, "flow.fragment.advance", f64::from_le_bytes)[0];
    let correction = rows(
        capture,
        "flow.fragment.end_correction_advance",
        i32::from_le_bytes,
    )[0];
    let start = rows(capture, "positioned.line.glyph_start", u32::from_le_bytes)[0] as usize;
    let count = rows(capture, "positioned.line.glyph_count", u32::from_le_bytes)[0] as usize;
    let drawn = rows(
        capture,
        "positioned.glyph.inline_advance",
        f32::from_le_bytes,
    )[start..start + count]
        .iter()
        .map(|advance| f64::from(*advance))
        .sum();
    (advance, correction, drawn)
}

#[test]
fn a_line_cut_for_an_ellipsis_drops_the_correction_its_end_was_priced_with() {
    // The fixture's premise: uncut, the first line ends at a corrected break and draws its width.
    let (advance, correction, drawn) = first_line(&layout(0, 1));
    assert_ne!(
        correction, 0,
        "the uncut first line ends at a corrected break"
    );
    assert!(
        (advance - drawn).abs() < 1e-3,
        "uncut: charged {advance}, drawn {drawn}"
    );

    let (advance, correction, drawn) = first_line(&layout(1, OVERFLOW_ELLIPSIS));
    assert!(
        (advance - drawn).abs() < 1e-3,
        "cut for the ellipsis: charged {advance}, drawn {drawn}"
    );
    assert_eq!(correction, 0, "the cut line keeps no end correction");
}
