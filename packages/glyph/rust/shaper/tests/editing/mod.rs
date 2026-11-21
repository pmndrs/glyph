//! Shared by the editing tests: fonts, sessions and the paragraph under test.

#![allow(dead_code)]

use std::{env, fs, path::PathBuf};

use pmndrs_glyph_shaper::engine::{
    ParagraphSource,
    editing::{Editing, GlyphFacts, LayoutSource, TextPosition, TextUnit},
    oracle::{
        fonts::{FontLibrary, FontRoot, font_spec},
        matrix::utf16,
        model::{Model, PARAGRAPH_ID, ROOT_ID},
        session::{Route, Session},
    },
};

/// Where the fetched adversarial fonts are, when the environment names them.
pub fn adversarial_root() -> Option<PathBuf> {
    env::var_os("GLYPH_ADVERSARIAL_FONTS").map(PathBuf::from)
}

/// Loads `keys`, or names the first font that is not on this machine.
pub fn try_library(keys: &[&str]) -> Result<FontLibrary, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut library = FontLibrary::default();
    for key in keys {
        let font = font_spec(key).ok_or_else(|| format!("{key} is not an oracle font"))?;
        let root = match font.root {
            FontRoot::Repository => manifest.join("../../../../benches/fixtures/fonts"),
            FontRoot::Synthetic => manifest.join("src/engine/adversarial-fonts"),
            FontRoot::Adversarial => {
                adversarial_root().ok_or_else(|| format!("{key}: GLYPH_ADVERSARIAL_FONTS unset"))?
            }
        };
        let bytes = fs::read(root.join(font.path)).map_err(|error| format!("{key}: {error}"))?;
        library.insert(key, bytes)?;
    }
    Ok(library)
}

pub fn library(keys: &[&str]) -> FontLibrary {
    try_library(keys).expect("fonts")
}

/// One paragraph laid out cold.
pub fn session(library: &FontLibrary, stacks: &[&[&str]], model: &Model) -> Session {
    let mut session = Session::new(library, stacks).expect("session");
    session.step(model, &[], Route::FULL).expect("cold layout");
    session
}

/// The paragraph's editing queries, with the word and sentence lanes filled.
pub fn prepare_lanes(session: &mut Session) {
    for unit in [TextUnit::Word, TextUnit::Sentence] {
        session
            .engine_mut()
            .prepare_editing_boundaries(ROOT_ID, PARAGRAPH_ID, unit)
            .expect("boundary lanes");
    }
}

pub type Queries<'a> = Editing<ParagraphSource<'a>>;

pub fn editing(session: &Session) -> Queries<'_> {
    let (engine, fonts) = session.engine();
    engine
        .editing(fonts, ROOT_ID, PARAGRAPH_ID)
        .expect("a prepared paragraph")
}

pub fn model(text: &str) -> Model {
    Model {
        text: utf16(text),
        ..Model::default()
    }
}

pub fn down(offset: u32) -> TextPosition {
    TextPosition::downstream(offset)
}

pub fn up(offset: u32) -> TextPosition {
    TextPosition::upstream(offset)
}

/// UTF-16 offset of the first occurrence of `needle`.
pub fn at(text: &str, needle: &str) -> u32 {
    let byte = text.find(needle).expect("the needle is in the text");
    text[..byte].encode_utf16().count() as u32
}

pub fn units(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

/// One paragraph laid out cold with its word and sentence lanes filled.
pub fn lay_out(stack: &[&str], model: &Model) -> Session {
    let library = library(stack);
    let mut session = session(&library, &[stack], model);
    prepare_lanes(&mut session);
    session
}

/// As `lay_out`, or `None` when the stack needs a font this machine does not have.
pub fn lay_out_if_present(stack: &[&str], model: &Model) -> Option<Session> {
    let library = try_library(stack).ok()?;
    let mut session = session(&library, &[stack], model);
    prepare_lanes(&mut session);
    Some(session)
}

pub fn glyphs(queries: &Queries<'_>, line: usize) -> Vec<GlyphFacts> {
    let mut glyphs = Vec::new();
    queries
        .source()
        .line_glyphs(line, &mut |glyph| glyphs.push(glyph))
        .expect("glyphs");
    glyphs
}

pub fn close(left: f64, right: f64) -> bool {
    (left - right).abs() < 1e-3
}

/// Texts that are one grapheme each though they are several code points, and plain letters
/// between them. Returns the text and the offsets of its grapheme boundaries.
pub fn sequences() -> (String, Vec<u32>) {
    let pieces = [
        "a",
        "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}", // family: an emoji ZWJ sequence
        "b",
        "\u{1f1eb}\u{1f1f7}", // regional indicators F R
        "\u{1f1e9}\u{1f1ea}", // regional indicators D E
        "\u{1f1ef}",          // one regional indicator left over
        "c",
        "1\u{fe0f}\u{20e3}",        // keycap
        "e\u{301}\u{323}",          // two combining marks
        "\u{1100}\u{1161}\u{11a8}", // conjoining jamo
        "\u{915}\u{94d}\u{937}",    // Devanagari conjunct (GB9c)
        "\u{e01}\u{e33}",           // Thai consonant and SARA AM
        "\u{1f44d}\u{1f3fd}",       // emoji modifier
        "\r\n",                     // one hard break
        "z",
    ];
    let mut boundaries = vec![0];
    for piece in pieces {
        boundaries.push(boundaries.last().unwrap() + units(piece));
    }
    (pieces.concat(), boundaries)
}

/// Four lines at width 60 in Fredoka: `office `, `waffle `, `fjord `, `affinity`.
pub fn wrapped() -> Model {
    let mut model = model("office waffle fjord affinity");
    model.layout.width = 60.0;
    model
}
