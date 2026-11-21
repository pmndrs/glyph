//! Proof that the dense kernel plus scalar windows equals the scalar analysis on every lane.

use alloc::{string::String, vec::Vec};

use super::{UnicodeAnalysis, kernel};

struct Pair {
    dense: UnicodeAnalysis,
    scalar: UnicodeAnalysis,
    text: Vec<u16>,
    checked: usize,
}

impl Pair {
    fn new() -> Self {
        Self {
            dense: UnicodeAnalysis::default(),
            scalar: UnicodeAnalysis::default(),
            text: Vec::new(),
            checked: 0,
        }
    }

    fn check_scalars(&mut self, scalars: &[u32]) {
        self.text.clear();
        for scalar in scalars {
            let character = char::from_u32(*scalar).expect("scalar value");
            let mut units = [0u16; 2];
            self.text
                .extend_from_slice(character.encode_utf16(&mut units));
        }
        self.check();
    }

    fn check_str(&mut self, text: &str) {
        self.text.clear();
        self.text.extend(text.encode_utf16());
        self.check();
    }

    fn check(&mut self) {
        let dense = self.dense.analyze(&self.text);
        let scalar = self.scalar.analyze_scalar(&self.text);
        let shown = || {
            String::from_utf16_lossy(&self.text)
                .escape_unicode()
                .collect::<String>()
        };
        assert_eq!(dense, scalar, "result for {}", shown());
        if scalar.is_err() {
            return;
        }
        assert_eq!(
            self.dense.line_breaks(),
            self.scalar.line_breaks(),
            "line breaks for {}",
            shown()
        );
        assert_eq!(
            self.dense.grapheme_boundaries(),
            self.scalar.grapheme_boundaries(),
            "graphemes for {}",
            shown()
        );
        assert_eq!(
            self.dense.script_items(),
            self.scalar.script_items(),
            "scripts for {}",
            shown()
        );
        let (dense, scalar) = (
            self.dense.printable_ascii_facts(),
            self.scalar.printable_ascii_facts(),
        );
        assert_eq!(
            dense.printable(),
            scalar.printable(),
            "printable for {}",
            shown()
        );
        if scalar.printable() {
            assert_eq!(dense.used(), scalar.used(), "ASCII mask for {}", shown());
        }
        self.checked += 1;
    }
}

/// Every string over `alphabet` of exactly `length` scalars, after `prefix`.
fn exhaustive(pair: &mut Pair, prefix: &[u32], alphabet: &[u32], length: usize) {
    let mut indices = alloc::vec![0usize; length];
    let mut scalars: Vec<u32> = prefix.to_vec();
    scalars.resize(prefix.len() + length, 0);
    loop {
        for (slot, index) in scalars[prefix.len()..].iter_mut().zip(&indices) {
            *slot = alphabet[*index];
        }
        pair.check_scalars(&scalars);
        let mut position = length;
        loop {
            if position == 0 {
                return;
            }
            position -= 1;
            indices[position] += 1;
            if indices[position] < alphabet.len() {
                break;
            }
            indices[position] = 0;
        }
    }
}

/// One representative per kernel class byte, plus one per residue line-break behaviour.
fn reduced_alphabet() -> Vec<u32> {
    let mut seen = alloc::collections::BTreeSet::new();
    let mut alphabet = Vec::new();
    for scalar in kernel::KERNEL_TEST_REPRESENTATIVES {
        let class = u16::try_from(*scalar).map_or(0, kernel::unit_class);
        if class != 0 && seen.insert(class) {
            alphabet.push(*scalar);
        }
    }
    // Residue: mark, joiner, ZW, WJ, CR, regional indicator, emoji base and modifier, Brahmic
    // aksara and virama, conjoining jamo, Thai, a keycap mark, and a supplementary letter.
    alphabet.extend_from_slice(&[
        0x301, 0x200d, 0x200b, 0x2060, 0x0d, 0x1f1fa, 0x261d, 0x1f3fb, 0x1b05, 0x1b44, 0x915,
        0x94d, 0x1100, 0x1161, 0x11a8, 0xe01, 0x20e3, 0x1d400, 0x25cc, 0xfffc,
    ]);
    alphabet
}

fn closure_alphabet() -> Vec<u32> {
    reduced_alphabet()
        .into_iter()
        .filter(|scalar| u16::try_from(*scalar).is_ok_and(|unit| kernel::unit_class(unit) != 0))
        .collect()
}

#[test]
fn kernel_equals_scalar_on_every_representative_string_up_to_two() {
    let mut pair = Pair::new();
    pair.check_scalars(&[]);
    for length in 1..=2 {
        exhaustive(&mut pair, &[], kernel::KERNEL_TEST_REPRESENTATIVES, length);
    }
    assert!(pair.checked > 16_000);
}

#[test]
fn kernel_equals_scalar_on_every_class_string_up_to_three() {
    let mut pair = Pair::new();
    let alphabet = reduced_alphabet();
    exhaustive(&mut pair, &[], &alphabet, 3);
}

/// The acceptance bar: all representative strings to length 3, all class strings to length 4,
/// closure class strings to length 5. Minutes in release; run with `--ignored`.
#[test]
#[ignore = "exhaustive closure proof; run in release"]
fn kernel_equals_scalar_exhaustively() {
    let mut pair = Pair::new();
    exhaustive(&mut pair, &[], kernel::KERNEL_TEST_REPRESENTATIVES, 3);
    exhaustive(&mut pair, &[], &reduced_alphabet(), 4);
    exhaustive(&mut pair, &[], &closure_alphabet(), 5);
    // The same class strings straddling a 64-unit block edge.
    for lead in 60..=63 {
        let prefix = alloc::vec![0x61u32; lead];
        exhaustive(&mut pair, &prefix, &reduced_alphabet(), 3);
    }
    std::println!("exhaustive strings checked: {}", pair.checked);
}

#[test]
fn kernel_equals_scalar_across_block_edges() {
    let mut pair = Pair::new();
    let alphabet = reduced_alphabet();
    for lead in [62usize, 63] {
        let prefix = alloc::vec![0x61u32; lead];
        exhaustive(&mut pair, &prefix, &alphabet, 2);
    }
    let closure = closure_alphabet();
    let prefix = alloc::vec![0x61u32; 62];
    exhaustive(&mut pair, &prefix, &closure, 3);
}

/// Starred rules: `SP*`, `(SY|IS)*`, `CM*`, `RI*`, `Extend*`, required breaks and quotes pumped
/// between every pair of classes, short and across a block edge.
#[test]
fn kernel_equals_scalar_on_pumped_strings() {
    let mut pair = Pair::new();
    let alphabet = reduced_alphabet();
    let pumps: &[&[u32]] = &[
        &[0x20],
        &[0x2f],
        &[0x2c],
        &[0x2f, 0x2c],
        &[0x301],
        &[0x1f1fa],
        &[0x200d],
        &[0x0a],
        &[0x201c],
        &[0x20, 0x0a],
        &[0x31, 0x20],
    ];
    let mut scalars = Vec::new();
    for first in &alphabet {
        for last in &alphabet {
            for pump in pumps {
                for count in [1usize, 2, 3, 5, 41, 64, 65, 130] {
                    for tail in [&[][..], &[0x61][..], &[0x4e00, 0x4e00][..], &[0x35][..]] {
                        scalars.clear();
                        scalars.push(*first);
                        for _ in 0..count {
                            scalars.extend_from_slice(pump);
                        }
                        scalars.push(*last);
                        scalars.extend_from_slice(tail);
                        pair.check_scalars(&scalars);
                    }
                }
            }
        }
    }
}

const FUZZ_TOKENS: &[&str] = &[
    "a",
    "b",
    "Z",
    "s",
    "я",
    "α",
    "\u{b5}",
    "\u{1d400}",
    "א",
    "ب",
    "1",
    "2",
    ",",
    ".",
    "/",
    "-",
    "(",
    ")",
    "\"",
    "\u{201c}",
    "\u{201d}",
    "\u{ab}",
    "\u{bb}",
    "\u{2019}",
    " ",
    " ",
    " ",
    " ",
    "\u{301}",
    "\u{200d}",
    "\u{a0}",
    "%",
    "$",
    "\n",
    "\u{2028}",
    "\u{b}",
    "字",
    "。",
    "「",
    "ア",
    "ก",
    "क",
    "\u{94d}",
    "\u{1f1fa}",
    "\u{1f469}",
    "\u{fe0f}",
    "\u{2014}",
    "!",
    "?",
    ":",
    "\u{2026}",
    "[",
    "]",
    "\r",
    "\u{200b}",
    "\u{2060}",
    "、",
    "ー",
    "한",
    "\u{1100}",
    "\u{20e3}",
    "\u{e0100}",
    "\u{ff9e}",
    "ｶ",
    "\u{2010}",
    "\u{2013}",
    "'",
    "word",
    "the ",
    "日本語",
    "ö",
    "o\u{308}",
    "\u{3000}",
    "\u{ff01}",
    "©",
    "\t",
    "\u{1f3fb}",
    "\u{202e}",
    "\u{2069}",
];

fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

#[test]
fn kernel_equals_scalar_on_seeded_fuzz() {
    let mut pair = Pair::new();
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let mut text = String::new();
    let rounds = if cfg!(debug_assertions) {
        20_000
    } else {
        400_000
    };
    for round in 0..rounds {
        text.clear();
        let length = if round % 16 == 0 {
            40 + (xorshift(&mut state) % 200) as usize
        } else {
            1 + (xorshift(&mut state) % 14) as usize
        };
        // Plain rounds lean on letters and spaces so safe cuts and windows both occur.
        let plain = round % 3 == 0;
        for _ in 0..length {
            let pick = xorshift(&mut state);
            if plain && pick % 4 != 0 {
                text.push_str(["a", "b", " ", "я", "字", "the ", "word"][(pick >> 8) as usize % 7]);
            } else {
                text.push_str(FUZZ_TOKENS[(pick >> 8) as usize % FUZZ_TOKENS.len()]);
            }
        }
        pair.check_str(&text);
    }
}

#[test]
fn kernel_equals_scalar_on_review_counterexamples() {
    let mut pair = Pair::new();
    let slashes = "/".repeat(40);
    let digits = "5 ".repeat(40);
    let bracket_middle = "def ghi jkl mno pqr stu vwx ".repeat(20);
    for text in [
        "я \u{b5} \u{b5} a",
        "a \u{b5} \u{b5} я",
        "bZ \u{1d400}",
        "я\n1 2 3",
        "a\n1 2 3",
        "1 2 3\nя",
        "ب\n(1)",
        "Mr.\u{000B}smith a b",
        "Mr.\u{000B}Smith a b",
        "Mr.\u{2028}smith",
        &alloc::format!("A{slashes}5 word"),
        &alloc::format!("1{slashes}5 word"),
        &alloc::format!("Mr. {digits}smith a"),
        &alloc::format!("Mr. {digits}Smith a"),
        "abc א 1 2 3 4 5 6 7 8 9, 10 + 11 x",
        &alloc::format!("א abc ({bracket_middle}xyz) א"),
        "אhello world (one) two",
        "1\u{fe0f}\u{20e3} and \u{20}\u{301}x",
        "葛\u{e0100}城 ｶﾞ ハ\u{ff9e}",
        "«a b» “A dog” ( \n字字字",
        "\u{201c}\u{2018}Hello\u{2019} he said\u{201d}",
        "well-known 3.14 1,000 24/7 $(5) 50% a/b http://a.b/c1",
        "ภาษาไทยไม่มีช่องว่าง ภาษา",
        "日本語の「文章」です。ー・ヶ々",
        "한국어 문장 \u{1112}\u{1161}\u{11ab}",
        "क्षत्रिय ಕ್ಷ க்ஷ",
        "🇺🇸🇬🇧 👨‍👩‍👧 👍🏽",
    ] {
        pair.check_str(text);
    }
}

#[test]
fn plain_prose_stays_in_the_kernel() {
    let mut analysis = UnicodeAnalysis::default();
    let text: Vec<u16> = "The quick (brown) fox, aged 3.5, said: \"hello\" - twice! Then left."
        .repeat(8)
        .encode_utf16()
        .collect();
    analysis.analyze(&text).unwrap();
    assert_eq!(analysis.kernel_coverage().residue_units, 0);
    let text: Vec<u16> = "naïve café\u{301} done".encode_utf16().collect();
    analysis.analyze(&text).unwrap();
    let coverage = analysis.kernel_coverage();
    assert_eq!(coverage.windows, 1);
    assert!(coverage.residue_units < text.len() as u32);
}
