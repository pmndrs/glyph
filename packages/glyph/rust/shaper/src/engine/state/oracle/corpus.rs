//! Deterministic text per script: paragraphs of a requested grapheme count, short labels, and
//! the fragments the differential driver inserts.
//!
//! Text is composed from small word lists rather than checked in as files so every paragraph is
//! reproducible from `(script, seed, size)` on native and wasm32 alike. The lists are chosen to
//! hit what layout branches on: ligature and kerning pairs, combining marks, conjuncts, joiners,
//! digits with separators, typographic quotes, spaces and no spaces, hard breaks.

use alloc::{string::String, vec::Vec};

use crate::unicode::UnicodeAnalysis;

use super::rng::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Script {
    Latin,
    GreekCyrillic,
    Cjk,
    Chinese,
    Arabic,
    Urdu,
    Hebrew,
    Devanagari,
    Thai,
    Bengali,
    Hangul,
    Emoji,
    MixedBidi,
    Code,
}

struct Vocabulary {
    words: &'static [&'static str],
    /// Appended directly after a word.
    punctuation: &'static [&'static str],
    /// Between words; empty for scripts written without spaces.
    separator: &'static str,
    /// Single code points an edit may insert inside or beside a cluster.
    marks: &'static [&'static str],
}

const LATIN: Vocabulary = Vocabulary {
    words: &[
        "the",
        "office",
        "affinity",
        "waffle",
        "fjord",
        "AVATAR",
        "To",
        "We",
        "Type",
        "quick",
        "brown",
        "fox",
        "jumps",
        "over",
        "lazy",
        "dog",
        "caf\u{e9}",
        "na\u{ef}ve",
        "Z\u{fc}rich",
        "re\u{301}sume\u{301}",
        "\u{201c}quoted\u{201d}",
        "it\u{2019}s",
        "1,234.56",
        "3.14159",
        "co-operate",
        "x",
        "I",
        "a",
        "fluffy",
        "Wolf",
        "Yawl",
        "final",
        "flight",
        "difficult",
        "typography",
        "kerning",
        "paragraph",
        "layout",
        "measure",
        "glyph",
    ],
    punctuation: &[",", ".", ";", ":", "!", "?", "\u{2014}", "\u{2026}"],
    separator: " ",
    marks: &[
        "\u{301}", "\u{308}", "\u{2019}", "\u{201c}", "\u{a0}", "-", "9",
    ],
};

const GREEK_CYRILLIC: Vocabulary = Vocabulary {
    words: &[
        "\u{3ba}\u{3b1}\u{3b9}",
        "\u{3bb}\u{3cc}\u{3b3}\u{3bf}\u{3c2}",
        "\u{3b3}\u{3c1}\u{3b1}\u{3bc}\u{3bc}\u{3b1}\u{3c4}\u{3bf}\u{3c3}\u{3b5}\u{3b9}\u{3c1}\u{3ac}",
        "\u{391}\u{3b8}\u{3ae}\u{3bd}\u{3b1}",
        "\u{3c3}\u{3c4}\u{3bf}\u{3b9}\u{3c7}\u{3b5}\u{3af}\u{3bf}",
        "\u{3c0}\u{3b1}\u{3c1}\u{3ac}\u{3b3}\u{3c1}\u{3b1}\u{3c6}\u{3bf}\u{3c2}",
        "\u{442}\u{435}\u{43a}\u{441}\u{442}",
        "\u{448}\u{440}\u{438}\u{444}\u{442}",
        "\u{441}\u{442}\u{440}\u{43e}\u{43a}\u{430}",
        "\u{430}\u{431}\u{437}\u{430}\u{446}",
        "\u{41c}\u{43e}\u{441}\u{43a}\u{432}\u{430}",
        "\u{438}",
        "\u{432}",
        "\u{439}\u{43e}\u{433}\u{443}\u{440}\u{442}",
        "\u{451}\u{436}\u{438}\u{43a}",
        "\u{438}\u{306}",
        "12\u{a0}345,6",
        "\u{ab}\u{441}\u{43b}\u{43e}\u{432}\u{43e}\u{bb}",
    ],
    punctuation: &[",", ".", ";", "\u{387}", "!", "?", "\u{2014}"],
    separator: " ",
    marks: &["\u{301}", "\u{306}", "\u{308}", "\u{ab}", "\u{bb}", "7"],
};

const CJK: Vocabulary = Vocabulary {
    words: &[
        "\u{65e5}\u{672c}\u{8a9e}",
        "\u{6587}\u{5b57}",
        "\u{7d44}\u{7248}",
        "\u{6bb5}\u{843d}",
        "\u{306e}",
        "\u{3092}",
        "\u{306b}",
        "\u{3067}\u{3059}",
        "\u{3057}\u{307e}\u{3059}",
        "\u{30ec}\u{30a4}\u{30a2}\u{30a6}\u{30c8}",
        "\u{30d5}\u{30a9}\u{30f3}\u{30c8}",
        "\u{304c}",
        "\u{3071}",
        "\u{30d1}\u{30fc}",
        "\u{6771}\u{4eac}",
        "\u{6f22}\u{5b57}",
        "\u{304b}\u{306a}",
        "\u{884c}",
        "\u{5e45}",
        "2024\u{5e74}",
        "\u{ff11}\u{ff12}\u{ff13}",
        "Glyph",
        "\u{3063}\u{3066}",
        "\u{3083}",
    ],
    punctuation: &[
        "\u{3001}", "\u{3002}", "\u{300c}", "\u{300d}", "\u{ff01}", "\u{ff1f}",
    ],
    separator: "",
    marks: &[
        "\u{3099}", "\u{309a}", "\u{30fc}", "\u{3001}", "\u{3000}", "A",
    ],
};

const CHINESE: Vocabulary = Vocabulary {
    words: &[
        "\u{4e2d}\u{6587}",
        "\u{6392}\u{7248}",
        "\u{5b57}\u{4f53}",
        "\u{6bb5}\u{843d}",
        "\u{7684}",
        "\u{662f}",
        "\u{548c}",
        "\u{5728}",
        "\u{5317}\u{4eac}",
        "\u{6587}\u{672c}",
        "\u{5e03}\u{5c40}",
        "\u{884c}\u{5bbd}",
        "\u{5bf9}\u{9f50}",
        "\u{6d4b}\u{91cf}",
        "\u{5b57}\u{5f62}",
        "2024\u{5e74}",
        "\u{4e00}\u{4e8c}\u{4e09}",
        "GPU",
    ],
    punctuation: &[
        "\u{ff0c}", "\u{3002}", "\u{201c}", "\u{201d}", "\u{ff1b}", "\u{ff1f}",
    ],
    separator: "",
    marks: &["\u{ff0c}", "\u{3002}", "\u{3000}", "\u{4e00}", "B"],
};

const ARABIC: Vocabulary = Vocabulary {
    words: &[
        "\u{627}\u{644}\u{646}\u{635}",
        "\u{627}\u{644}\u{639}\u{631}\u{628}\u{64a}",
        "\u{62e}\u{637}",
        "\u{633}\u{637}\u{631}",
        "\u{641}\u{642}\u{631}\u{629}",
        "\u{644}\u{627}",
        "\u{627}\u{644}\u{644}\u{647}",
        "\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{651}\u{64e}\u{62f}",
        "\u{643}\u{650}\u{62a}\u{64e}\u{627}\u{628}",
        "\u{641}\u{64a}",
        "\u{648}",
        "\u{639}\u{644}\u{649}",
        "\u{645}\u{646}",
        "\u{662}\u{660}\u{662}\u{664}",
        "\u{661}\u{66c}\u{662}\u{663}\u{664}\u{66b}\u{665}",
        "\u{644}\u{644}\u{643}\u{62a}\u{627}\u{628}\u{629}",
        "\u{627}\u{644}\u{62a}\u{646}\u{636}\u{64a}\u{62f}",
        "\u{62d}\u{631}\u{641}",
    ],
    punctuation: &["\u{60c}", ".", "\u{61b}", "\u{61f}", "!"],
    separator: " ",
    marks: &[
        "\u{64e}", "\u{651}", "\u{640}", "\u{200d}", "\u{200c}", "\u{60c}", "\u{665}",
    ],
};

const URDU: Vocabulary = Vocabulary {
    words: &[
        "\u{627}\u{631}\u{62f}\u{648}",
        "\u{646}\u{633}\u{62a}\u{639}\u{644}\u{6cc}\u{642}",
        "\u{62e}\u{637}",
        "\u{6a9}\u{62a}\u{627}\u{628}",
        "\u{6c1}\u{6d2}",
        "\u{6a9}\u{6cc}",
        "\u{645}\u{6cc}\u{6ba}",
        "\u{627}\u{648}\u{631}",
        "\u{67e}\u{627}\u{6a9}\u{633}\u{62a}\u{627}\u{646}",
        "\u{632}\u{628}\u{627}\u{646}",
        "\u{62a}\u{62d}\u{631}\u{6cc}\u{631}",
        "\u{6f2}\u{6f0}\u{6f2}\u{6f4}",
        "\u{644}\u{641}\u{638}",
    ],
    punctuation: &["\u{60c}", "\u{6d4}", "\u{61f}"],
    separator: " ",
    marks: &["\u{64e}", "\u{650}", "\u{200c}", "\u{6d4}"],
};

const HEBREW: Vocabulary = Vocabulary {
    words: &[
        "\u{5e9}\u{5dc}\u{5d5}\u{5dd}",
        "\u{5e2}\u{5d5}\u{5dc}\u{5dd}",
        "\u{5d8}\u{5e7}\u{5e1}\u{5d8}",
        "\u{5e9}\u{5d5}\u{5e8}\u{5d4}",
        "\u{5e4}\u{5e1}\u{5e7}\u{5d4}",
        "\u{5e9}\u{5c1}\u{5b8}\u{5dc}\u{5d5}\u{5b9}\u{5dd}",
        "\u{5d1}\u{5bc}\u{5b0}\u{5e8}\u{5b5}\u{5d0}\u{5e9}\u{5c1}\u{5b4}\u{5d9}\u{5ea}",
        "\u{5e2}\u{5d1}\u{5e8}\u{5d9}\u{5ea}",
        "\u{5d2}\u{5d5}\u{5e4}\u{5df}",
        "\u{5d0}\u{5ea}",
        "\u{5e2}\u{5dc}",
        "\u{5dc}\u{5d0}",
        "2024",
        "1,234.5",
        "\u{5d0}\u{5d5}\u{5ea}\u{5d9}\u{5d5}\u{5ea}",
    ],
    punctuation: &[",", ".", "\u{5be}", "!", "?", ":"],
    separator: " ",
    marks: &["\u{5b0}", "\u{5bc}", "\u{5c1}", "\u{5be}", "\u{5f3}", "4"],
};

const DEVANAGARI: Vocabulary = Vocabulary {
    words: &[
        "\u{939}\u{93f}\u{928}\u{94d}\u{926}\u{940}",
        "\u{92a}\u{93e}\u{920}",
        "\u{905}\u{915}\u{94d}\u{937}\u{930}",
        "\u{932}\u{93f}\u{92a}\u{93f}",
        "\u{915}\u{94d}\u{937}\u{924}\u{94d}\u{930}\u{93f}\u{92f}",
        "\u{936}\u{94d}\u{930}\u{940}",
        "\u{938}\u{902}\u{938}\u{94d}\u{915}\u{943}\u{924}",
        "\u{915}\u{93e}",
        "\u{939}\u{948}",
        "\u{914}\u{930}",
        "\u{92a}\u{902}\u{915}\u{94d}\u{924}\u{93f}",
        "\u{926}\u{94d}\u{935}\u{93e}\u{930}\u{93e}",
        "\u{967}\u{968}\u{969}",
        "\u{930}\u{94d}\u{200d}\u{92f}",
        "\u{915}\u{94d}\u{200c}\u{937}",
        "\u{92d}\u{93e}\u{930}\u{924}",
    ],
    punctuation: &["\u{964}", ",", "\u{965}", "?"],
    separator: " ",
    marks: &[
        "\u{94d}", "\u{902}", "\u{93f}", "\u{200d}", "\u{200c}", "\u{93c}", "\u{967}",
    ],
};

const THAI: Vocabulary = Vocabulary {
    words: &[
        "\u{e20}\u{e32}\u{e29}\u{e32}\u{e44}\u{e17}\u{e22}",
        "\u{e15}\u{e31}\u{e27}\u{e2d}\u{e31}\u{e01}\u{e29}\u{e23}",
        "\u{e01}\u{e32}\u{e23}\u{e08}\u{e31}\u{e14}\u{e2b}\u{e19}\u{e49}\u{e32}",
        "\u{e1a}\u{e23}\u{e23}\u{e17}\u{e31}\u{e14}",
        "\u{e19}\u{e49}\u{e33}",
        "\u{e17}\u{e35}\u{e48}",
        "\u{e41}\u{e25}\u{e30}",
        "\u{e40}\u{e1b}\u{e47}\u{e19}",
        "\u{e01}\u{e23}\u{e38}\u{e07}\u{e40}\u{e17}\u{e1e}",
        "\u{e1b}\u{e35}\u{e48}",
        "\u{e52}\u{e55}\u{e56}\u{e57}",
        "\u{e04}\u{e27}\u{e32}\u{e21}\u{e01}\u{e27}\u{e49}\u{e32}\u{e07}",
        "\u{e2a}\u{e27}\u{e31}\u{e2a}\u{e14}\u{e35}",
    ],
    punctuation: &["\u{e2f}", "\u{e46}", ",", "."],
    separator: " ",
    marks: &[
        "\u{e48}", "\u{e49}", "\u{e31}", "\u{e33}", "\u{e47}", "\u{e2f}", "\u{e55}",
    ],
};

const BENGALI: Vocabulary = Vocabulary {
    words: &[
        "\u{9ac}\u{9be}\u{982}\u{9b2}\u{9be}",
        "\u{9b2}\u{9bf}\u{9aa}\u{9bf}",
        "\u{985}\u{995}\u{9cd}\u{9b7}\u{9b0}",
        "\u{9b8}\u{9cd}\u{9a4}\u{9ac}\u{995}",
        "\u{995}\u{9cd}\u{9b7}\u{9c7}\u{9a4}\u{9cd}\u{9b0}",
        "\u{9b6}\u{9cd}\u{9b0}\u{9c0}",
        "\u{98f}\u{9ac}\u{982}",
        "\u{9aa}\u{982}\u{995}\u{9cd}\u{9a4}\u{9bf}",
        "\u{9ad}\u{9be}\u{9b7}\u{9be}",
        "\u{9a2}\u{9be}\u{995}\u{9be}",
        "\u{9e7}\u{9e8}\u{9e9}",
        "\u{9b0}\u{9cd}\u{200d}\u{9af}",
        "\u{9a6}\u{9cd}\u{9ac}\u{9be}\u{9b0}\u{9be}",
        "\u{9b9}\u{9af}\u{9bc}",
    ],
    punctuation: &["\u{964}", ",", "?", "!"],
    separator: " ",
    marks: &[
        "\u{9cd}", "\u{982}", "\u{9bf}", "\u{9bc}", "\u{200d}", "\u{200c}", "\u{9e7}",
    ],
};

const HANGUL: Vocabulary = Vocabulary {
    words: &[
        "\u{d55c}\u{ae00}",
        "\u{ae00}\u{aebc}",
        "\u{bb38}\u{b2e8}",
        "\u{c870}\u{d310}",
        "\u{c11c}\u{c6b8}",
        "\u{c740}",
        "\u{b294}",
        "\u{c744}",
        "\u{c785}\u{b2c8}\u{b2e4}",
        "\u{d569}\u{b2c8}\u{b2e4}",
        "\u{b108}\u{be44}",
        "\u{c904}",
        "\u{1112}\u{1161}\u{11ab}",
        "\u{1100}\u{1173}\u{11af}",
        "2024\u{b144}",
        "1,234.5\u{c6d0}",
        "\u{ce21}\u{c815}",
    ],
    punctuation: &[",", ".", "!", "?", "\u{3001}"],
    separator: " ",
    marks: &["\u{1161}", "\u{11ab}", "\u{1100}", "\u{3002}", "5"],
};

const EMOJI: Vocabulary = Vocabulary {
    words: &[
        "\u{1f600}",
        "\u{1f44d}\u{1f3fd}",
        "\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}",
        "\u{1f1ef}\u{1f1f5}",
        "\u{1f1fa}\u{1f1f8}",
        "\u{2764}\u{fe0f}",
        "\u{1f3f3}\u{fe0f}\u{200d}\u{1f308}",
        "1\u{fe0f}\u{20e3}",
        "#\u{fe0f}\u{20e3}",
        "\u{1f469}\u{1f3fb}\u{200d}\u{1f4bb}",
        "\u{263a}\u{fe0f}",
        "\u{1f680}",
        "ok",
        "launch",
        "\u{1f9d1}\u{200d}\u{1f91d}\u{200d}\u{1f9d1}",
        "\u{1f1eb}\u{1f1f7}",
        "\u{2728}",
        "\u{1f408}\u{200d}\u{2b1b}",
    ],
    punctuation: &["!", ".", ","],
    separator: " ",
    marks: &[
        "\u{200d}",
        "\u{fe0f}",
        "\u{1f3fd}",
        "\u{1f1ef}",
        "\u{20e3}",
        "\u{1f600}",
        "a",
    ],
};

const MIXED_BIDI: Vocabulary = Vocabulary {
    words: &[
        "layout",
        "\u{627}\u{644}\u{646}\u{635}",
        "\u{5e9}\u{5dc}\u{5d5}\u{5dd}",
        "(v1.2)",
        "ABC-123",
        "\u{643}\u{62a}\u{627}\u{628} (book)",
        "\u{2067}\u{5e2}\u{5d1}\u{5e8}\u{5d9}\u{5ea}\u{2069}",
        "\u{2066}left\u{2069}",
        "\u{202b}\u{639}\u{631}\u{628}\u{64a}\u{202c}",
        "100%",
        "\u{662}\u{660}",
        "\u{200f}!",
        "\u{200e}?",
        "C++",
        "\u{5d0}\u{5d1}\u{5d2} 42 \u{5d3}\u{5d4}",
        "[\u{641}\u{64a}]",
        "the",
        "\u{648}",
        "$9.99",
        "\u{202e}abc\u{202c}",
    ],
    punctuation: &[",", ".", "\u{60c}", ":", "!"],
    separator: " ",
    marks: &[
        "\u{200e}", "\u{200f}", "\u{2066}", "\u{2067}", "\u{2069}", "\u{202b}", "\u{202c}", "(",
        ")", "\u{627}", "\u{5d0}", "z", "8",
    ],
};

const CODE: Vocabulary = Vocabulary {
    words: &[
        "=>", "!=", "===", "->", "<=", ">=", "::", "www", "fn", "let", "x", "!==", "<!--", "-->",
        "0xFF", "|>", "&&", "||", "++", "**", "/*", "*/", "value", "match",
    ],
    punctuation: &[";", ",", ")", "("],
    separator: " ",
    marks: &["=", ">", "-", "!", "<", "|"],
};

const fn vocabulary(script: Script) -> &'static Vocabulary {
    match script {
        Script::Latin => &LATIN,
        Script::GreekCyrillic => &GREEK_CYRILLIC,
        Script::Cjk => &CJK,
        Script::Chinese => &CHINESE,
        Script::Arabic => &ARABIC,
        Script::Urdu => &URDU,
        Script::Hebrew => &HEBREW,
        Script::Devanagari => &DEVANAGARI,
        Script::Thai => &THAI,
        Script::Bengali => &BENGALI,
        Script::Hangul => &HANGUL,
        Script::Emoji => &EMOJI,
        Script::MixedBidi => &MIXED_BIDI,
        Script::Code => &CODE,
    }
}

/// Words per hard line break in generated paragraphs.
const WORDS_PER_HARD_BREAK: usize = 97;

/// A paragraph of at least `graphemes` grapheme clusters.
pub fn paragraph(script: Script, seed: u64, graphemes: usize) -> Vec<u16> {
    let vocabulary = vocabulary(script);
    let mut rng = Rng::new(seed ^ 0x5eed_c0de);
    let mut text = String::new();
    let mut words = 0_usize;
    loop {
        // Counting graphemes is the expensive part, so grow in batches.
        for _ in 0..32 {
            push_word(&mut text, vocabulary, &mut rng);
            words += 1;
            if words.is_multiple_of(WORDS_PER_HARD_BREAK) {
                text.push('\n');
            } else {
                text.push_str(vocabulary.separator);
            }
        }
        let units: Vec<u16> = text.encode_utf16().collect();
        if grapheme_count(&units) >= graphemes {
            return units;
        }
    }
}

/// A label that fits the engine's inline owner: at most `max_units` UTF-16 units, whole words.
pub fn label(script: Script, seed: u64, max_units: usize) -> Vec<u16> {
    let vocabulary = vocabulary(script);
    let mut rng = Rng::new(seed ^ 0x0001_abe1);
    let mut text = String::new();
    loop {
        let mut next = text.clone();
        if !next.is_empty() {
            next.push_str(vocabulary.separator);
        }
        push_word(&mut next, vocabulary, &mut rng);
        if next.encode_utf16().count() > max_units {
            return text.encode_utf16().collect();
        }
        text = next;
    }
}

fn push_word(text: &mut String, vocabulary: &Vocabulary, rng: &mut Rng) {
    if let Some(word) = rng.pick(vocabulary.words) {
        text.push_str(word);
    }
    if rng.chance(1, 6)
        && let Some(mark) = rng.pick(vocabulary.punctuation)
    {
        text.push_str(mark);
    }
}

pub fn grapheme_count(units: &[u16]) -> usize {
    grapheme_boundaries(units).len().saturating_sub(1)
}

/// UTF-16 offsets of every grapheme boundary, first and last included. Empty for text the
/// engine would reject as ill-formed.
pub fn grapheme_boundaries(units: &[u16]) -> Vec<u32> {
    let mut analysis = UnicodeAnalysis::default();
    match analysis.analyze(units) {
        Ok(()) => analysis.grapheme_boundaries().to_vec(),
        Err(_) => Vec::new(),
    }
}

/// What an edit inserts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fragment {
    Word,
    /// A word and its separator, so the edit adds a break opportunity.
    SpacedWord,
    /// One code point that joins, marks or controls: the inside-a-cluster cases.
    Mark,
    Space,
    HardBreak,
    /// A word from another script, crossing a script and usually a font boundary.
    Foreign,
    /// One character that changes bidi resolution far from itself: a strong right-to-left
    /// letter, half of a bracket pair, an isolate control, or a directional mark.
    Bidi,
}

/// Single characters whose effect on bidi levels is not local.
const BIDI_PROBES: [&str; 9] = [
    "\u{5d0}", "\u{627}", "(", ")", "[", "\u{2067}", "\u{2066}", "\u{2069}", "\u{200f}",
];

pub const FRAGMENTS: [Fragment; 7] = [
    Fragment::Word,
    Fragment::SpacedWord,
    Fragment::Mark,
    Fragment::Space,
    Fragment::HardBreak,
    Fragment::Foreign,
    Fragment::Bidi,
];

pub fn fragment(script: Script, kind: Fragment, rng: &mut Rng) -> Vec<u16> {
    let vocabulary = vocabulary(script);
    let mut text = String::new();
    match kind {
        Fragment::Word => push_word(&mut text, vocabulary, rng),
        Fragment::SpacedWord => {
            push_word(&mut text, vocabulary, rng);
            text.push(' ');
        }
        Fragment::Mark => text.push_str(rng.pick(vocabulary.marks).copied().unwrap_or("x")),
        Fragment::Space => text.push(' '),
        Fragment::HardBreak => text.push('\n'),
        Fragment::Bidi => text.push_str(rng.pick(&BIDI_PROBES).copied().unwrap_or("(")),
        Fragment::Foreign => {
            let other = if script == Script::Latin {
                &ARABIC
            } else {
                &LATIN
            };
            push_word(&mut text, other, rng);
        }
    }
    text.encode_utf16().collect()
}

/// Same-length replacement text: `units` UTF-16 units of the script's own letters where that
/// is possible, so the edit changes content and not length.
pub fn same_length(script: Script, units: usize, rng: &mut Rng) -> Vec<u16> {
    let vocabulary = vocabulary(script);
    let mut text = Vec::with_capacity(units);
    while text.len() < units {
        let word = rng.pick(vocabulary.words).copied().unwrap_or("x");
        for unit in word.encode_utf16() {
            // A lone surrogate would be rejected as ill-formed; replace it with a letter.
            let unit = if (0xd800..0xe000).contains(&unit) {
                u16::from(b'o')
            } else {
                unit
            };
            if text.len() < units {
                text.push(unit);
            }
        }
    }
    text
}
