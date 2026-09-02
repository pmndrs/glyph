use std::{fs::File, io::Read, path::PathBuf};

use flate2::read::GzDecoder;
use pmndrs_glyph_shaper::unicode::UnicodeAnalysis;

const GRAPHEME_BREAK_TEST_CASES: usize = 766;

#[test]
fn unicode_17_grapheme_break_test_is_fully_conformant() {
    let source = fixture("GraphemeBreakTest.txt.gz");
    let mut analysis = UnicodeAnalysis::default();
    let mut cases = 0usize;
    for (line_index, source) in source.lines().enumerate() {
        let body = source.split('#').next().unwrap_or_default().trim();
        if body.is_empty() {
            continue;
        }
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
        analysis
            .analyze(&text)
            .unwrap_or_else(|error| panic!("GraphemeBreakTest:{}: {error:?}", line_index + 1));
        assert_eq!(
            analysis.grapheme_boundaries(),
            expected,
            "GraphemeBreakTest:{}",
            line_index + 1
        );
        cases += 1;
    }
    assert_eq!(cases, GRAPHEME_BREAK_TEST_CASES);
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
