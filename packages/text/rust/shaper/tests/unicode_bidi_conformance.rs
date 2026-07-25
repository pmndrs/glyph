use std::{fs::File, io::Read, path::PathBuf};

use flate2::read::GzDecoder;
use pmndrs_text_shaper::bidi::Unicode17BidiData;
use unicode_bidi::{LTR_LEVEL, Level, RTL_LEVEL, utf16::BidiInfo};

const BIDI_TEST_CASES: usize = 770_241;
const BIDI_CHARACTER_TEST_CASES: usize = 91_707;

#[test]
fn unicode_17_bidi_test_is_fully_conformant() {
    let source = fixture("BidiTest.txt.gz");
    let mut expected_levels = Vec::new();
    let mut expected_order = Vec::new();
    let mut cases = 0usize;
    for (line_index, raw) in source.lines().enumerate() {
        let line = raw.trim();
        if let Some(value) = line.strip_prefix("@Levels:") {
            expected_levels = parse_levels(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("@Reorder:") {
            expected_order = parse_usizes(value);
            continue;
        }
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let (types, bitset) = line
            .split_once(';')
            .unwrap_or_else(|| panic!("invalid BidiTest line {}", line_index + 1));
        let classes: Vec<&str> = types.split_whitespace().collect();
        let text: Vec<u16> = classes.iter().map(|value| representative(value)).collect();
        let bitset = u8::from_str_radix(bitset.trim(), 16).expect("paragraph bitset");
        for (bit, default_level) in [(1, None), (2, Some(LTR_LEVEL)), (4, Some(RTL_LEVEL))] {
            if bitset & bit == 0 {
                continue;
            }
            verify_case(
                &text,
                &(0..text.len()).collect::<Vec<_>>(),
                default_level,
                &expected_levels,
                &expected_order,
                None,
                &format!("BidiTest:{}", line_index + 1),
            );
            cases += 1;
        }
    }
    assert_eq!(cases, BIDI_TEST_CASES);
}

#[test]
fn unicode_17_bidi_character_test_is_fully_conformant() {
    let source = fixture("BidiCharacterTest.txt.gz");
    let mut cases = 0usize;
    for (line_index, raw) in source.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split(';').collect();
        assert_eq!(fields.len(), 5, "BidiCharacterTest:{}", line_index + 1);
        let code_points: Vec<u32> = fields[0]
            .split_whitespace()
            .map(|value| u32::from_str_radix(value, 16).expect("code point"))
            .collect();
        let mut text = Vec::new();
        let mut positions = Vec::with_capacity(code_points.len());
        for code_point in code_points {
            positions.push(text.len());
            let character = char::from_u32(code_point).expect("Unicode scalar");
            let mut encoded = [0u16; 2];
            text.extend_from_slice(character.encode_utf16(&mut encoded));
        }
        let default_level = match fields[1].trim() {
            "0" => Some(LTR_LEVEL),
            "1" => Some(RTL_LEVEL),
            "2" => None,
            value => panic!("unexpected paragraph direction {value}"),
        };
        verify_case(
            &text,
            &positions,
            default_level,
            &parse_levels(fields[3]),
            &parse_usizes(fields[4]),
            Some(fields[2].trim().parse().expect("paragraph level")),
            &format!("BidiCharacterTest:{}", line_index + 1),
        );
        cases += 1;
    }
    assert_eq!(cases, BIDI_CHARACTER_TEST_CASES);
}

fn verify_case(
    text: &[u16],
    positions: &[usize],
    default_level: Option<Level>,
    expected_levels: &[Option<u8>],
    expected_order: &[usize],
    expected_paragraph_level: Option<u8>,
    label: &str,
) {
    assert_eq!(
        positions.len(),
        expected_levels.len(),
        "{label}: input length"
    );
    let info = BidiInfo::new_with_data_source(&Unicode17BidiData, text, default_level);
    let paragraph = info
        .paragraphs
        .first()
        .unwrap_or_else(|| panic!("{label}: missing paragraph"));
    if let Some(expected) = expected_paragraph_level {
        assert_eq!(
            paragraph.level.number(),
            expected,
            "{label}: paragraph level"
        );
    }
    let reordered = info.reordered_levels(paragraph, paragraph.range.clone());
    let actual_levels: Vec<u8> = positions
        .iter()
        .map(|&index| reordered[index].number())
        .collect();
    for (index, expected) in expected_levels.iter().enumerate() {
        if let Some(expected) = expected {
            assert_eq!(actual_levels[index], *expected, "{label}: level {index}");
        }
    }
    let retained: Vec<usize> = expected_levels
        .iter()
        .enumerate()
        .filter_map(|(index, level)| level.map(|_| index))
        .collect();
    let levels: Vec<Level> = retained
        .iter()
        .map(|&index| reordered[positions[index]])
        .collect();
    let actual_order: Vec<usize> = BidiInfo::reorder_visual(&levels)
        .into_iter()
        .map(|index| retained[index])
        .collect();
    assert_eq!(actual_order, expected_order, "{label}: visual order");
}

fn parse_levels(value: &str) -> Vec<Option<u8>> {
    value
        .split_whitespace()
        .map(|value| match value {
            "x" => None,
            value => Some(value.parse().expect("embedding level")),
        })
        .collect()
}

fn parse_usizes(value: &str) -> Vec<usize> {
    value
        .split_whitespace()
        .map(|value| value.parse().expect("visual index"))
        .collect()
}

fn representative(class: &str) -> u16 {
    match class {
        "L" => 0x0061,
        "R" => 0x05D0,
        "AL" => 0x0627,
        "EN" => 0x0030,
        "ES" => 0x002B,
        "ET" => 0x0024,
        "AN" => 0x0660,
        "CS" => 0x002C,
        "NSM" => 0x0300,
        "BN" => 0x0000,
        "B" => 0x2029,
        "S" => 0x0009,
        "WS" => 0x0020,
        "ON" => 0x0021,
        "LRE" => 0x202A,
        "RLE" => 0x202B,
        "PDF" => 0x202C,
        "LRO" => 0x202D,
        "RLO" => 0x202E,
        "LRI" => 0x2066,
        "RLI" => 0x2067,
        "FSI" => 0x2068,
        "PDI" => 0x2069,
        value => panic!("unknown Bidi_Class {value}"),
    }
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
