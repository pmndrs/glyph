//! Unicode 17 `WordBreakTest.txt` and `SentenceBreakTest.txt` through the boundary lane API.

use std::{fs::File, io::Read, path::PathBuf};

use flate2::read::GzDecoder;
use pmndrs_glyph_shaper::unicode::{SENTENCE_BOUNDARY, UnicodeAnalysis, WORD_BOUNDARY};

const WORD_BREAK_TEST_CASES: usize = 1944;
const SENTENCE_BREAK_TEST_CASES: usize = 512;

#[test]
fn unicode_17_word_break_test_is_fully_conformant() {
    assert_eq!(
        run("WordBreakTest.txt.gz", WORD_BOUNDARY),
        WORD_BREAK_TEST_CASES
    );
}

#[test]
fn unicode_17_sentence_break_test_is_fully_conformant() {
    assert_eq!(
        run("SentenceBreakTest.txt.gz", SENTENCE_BOUNDARY),
        SENTENCE_BREAK_TEST_CASES
    );
}

/// Checks every vector of `name` against the lane bit `kind`, on a fresh lane and on a lane
/// recomputed after an edit that appended the vector to a resync prefix; returns the case count.
fn run(name: &str, kind: u8) -> usize {
    let source = fixture(name);
    let mut analysis = UnicodeAnalysis::default();
    let mut cases = 0usize;
    for (line_index, source) in source.lines().enumerate() {
        let body = source.split('#').next().unwrap_or_default().trim();
        if body.is_empty() {
            continue;
        }
        let (text, expected) = parse(body);
        let label = || format!("{name}:{}", line_index + 1);
        analysis
            .analyze(&text)
            .unwrap_or_else(|error| panic!("{}: {error:?}", label()));
        let lane = analysis
            .boundary_lane(&text, kind)
            .unwrap_or_else(|error| panic!("{}: {error:?}", label()));
        assert_eq!(set_positions(lane, kind), expected, "{}", label());

        // The same vector after "a b " through an edit: the windowed recompute must give the
        // vector's boundaries shifted by the prefix, with a boundary at the join.
        let prefix: Vec<u16> = "a b ".encode_utf16().collect();
        analysis.analyze(&prefix).unwrap();
        analysis.boundary_lane(&prefix, kind).unwrap();
        let mut joined = prefix.clone();
        joined.extend_from_slice(&text);
        analysis
            .analyze_edit(&joined, prefix.len(), 0, text.len())
            .unwrap_or_else(|error| panic!("{}: {error:?}", label()));
        let edited = analysis.boundary_lane(&joined, kind).unwrap();
        let mut fresh = UnicodeAnalysis::default();
        fresh.analyze(&joined).unwrap();
        assert_eq!(
            edited,
            fresh.boundary_lane(&joined, kind).unwrap(),
            "{} after an edit",
            label()
        );
        cases += 1;
    }
    cases
}

fn set_positions(lane: &[u8], kind: u8) -> Vec<u32> {
    (0..lane.len())
        .filter(|position| lane[*position] & kind != 0)
        .map(|position| u32::try_from(position).expect("UTF-16 offset"))
        .collect()
}

/// `÷ 0061 × 0308 ÷` into UTF-16 units and the offsets marked `÷`.
fn parse(body: &str) -> (Vec<u16>, Vec<u32>) {
    let tokens: Vec<&str> = body.split_whitespace().collect();
    let mut text = Vec::new();
    let mut expected = Vec::new();
    let mut cursor = 0usize;
    while cursor < tokens.len() {
        if tokens[cursor] == "÷" {
            expected.push(u32::try_from(text.len()).expect("UTF-16 offset"));
        }
        cursor += 1;
        let Some(hexadecimal) = tokens.get(cursor) else {
            break;
        };
        let code_point = u32::from_str_radix(hexadecimal, 16).expect("code point");
        let character = char::from_u32(code_point).expect("Unicode scalar");
        let mut encoded = [0u16; 2];
        text.extend_from_slice(character.encode_utf16(&mut encoded));
        cursor += 1;
    }
    (text, expected)
}

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/unicode-17.0.0")
        .join(name);
    let mut decoder = GzDecoder::new(File::open(path).expect("open Unicode fixture"));
    let mut source = String::new();
    decoder
        .read_to_string(&mut source)
        .expect("decode Unicode fixture");
    source
}
