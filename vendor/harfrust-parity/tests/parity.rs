//! The fork must shape exactly like the release it was cut from.
//!
//! Run in release mode: `cargo test --release --manifest-path vendor/harfrust-parity/Cargo.toml`,
//! and again with `--features fork-default-features` for the configuration upstream would ship.
//!
//! Two differences are intended when the fork is built without its `aat` and `rand` features, and
//! the tests state them instead of hiding them:
//!
//! - a font carrying a GSUB `rand` feature shapes as upstream does with `rand=0`;
//! - a font carrying `morx`, `kerx` or `trak` is not comparable (pmndrs/glyph's baker rejects
//!   those fonts before they reach the shaper), so none may be in the fixture set.

use harfrust_fork_parity::{
    FORK_HAS_AAT_AND_RAND, Glyph, Request, Segment, fork_engine, upstream_engine,
};
use read_fonts::{FontRef, TableProvider, types::Tag};
use serde_json::Value;
use std::{env, fs, path::PathBuf};

const PRODUCE_UNSAFE_TO_CONCAT: u32 = 0x40;
const BEGINNING_AND_END_OF_TEXT: u32 = 0x3;

/// Characters whose ordered pairs are shaped for a font that is not swept exhaustively.
const SAMPLED_PAIR_CHARACTERS: usize = 96;
/// Longest single line built from a font's mapped characters.
const INVENTORY_LINE_CHARACTERS: usize = 4096;
/// A kern-only font must show at least this many requests that kerning changes, or the
/// comparison says nothing about the `kern` table.
const MINIMUM_KERNED_REQUESTS: usize = 100;

struct Fixture {
    name: &'static str,
    path: &'static str,
    /// Shape every ordered pair of mapped characters, not a sample. Set for the fonts whose
    /// kerning lives in the legacy `kern` table.
    exhaustive_pairs: bool,
    corpus: Option<&'static str>,
}

const FIXTURES: &[Fixture] = &[
    Fixture {
        name: "cherry-cream-soda (kern only)",
        path: "fonts/cherry-cream-soda/CherryCreamSoda-Regular.ttf",
        exhaustive_pairs: true,
        corpus: None,
    },
    Fixture {
        name: "syncopate, GPOS dropped (kern only)",
        path: "fonts/syncopate/Syncopate-Regular-kernonly-SYNTH.ttf",
        exhaustive_pairs: true,
        corpus: None,
    },
    Fixture {
        name: "syncopate (kern and GPOS)",
        path: "fonts/syncopate/Syncopate-Regular.ttf",
        exhaustive_pairs: true,
        corpus: None,
    },
    Fixture {
        name: "inter",
        path: "../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf",
        exhaustive_pairs: false,
        corpus: Some("../../benches/fixtures/shaping/inter-regular"),
    },
    Fixture {
        name: "amiri",
        path: "../../benches/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf",
        exhaustive_pairs: false,
        corpus: Some("../../benches/fixtures/shaping/amiri-regular"),
    },
    Fixture {
        name: "noto-sans-cjk-jp",
        path: "../../benches/fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf",
        exhaustive_pairs: false,
        corpus: Some("../../benches/fixtures/shaping/noto-sans-cjk"),
    },
    Fixture {
        name: "noto-sans-devanagari",
        path: "../../benches/fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf",
        exhaustive_pairs: false,
        corpus: None,
    },
    Fixture {
        name: "source-serif",
        path: "../../benches/fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf",
        exhaustive_pairs: false,
        corpus: None,
    },
    Fixture {
        name: "dancing-script",
        path: "../../benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf",
        exhaustive_pairs: false,
        corpus: None,
    },
    Fixture {
        name: "dot-gothic-16",
        path: "../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf",
        exhaustive_pairs: false,
        corpus: None,
    },
    Fixture {
        name: "fredoka",
        path: "../../benches/fixtures/fonts/fredoka-issue-216/Fredoka-Regular.ttf",
        exhaustive_pairs: false,
        corpus: None,
    },
    Fixture {
        name: "font-awesome",
        path: "../../benches/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf",
        exhaustive_pairs: false,
        corpus: None,
    },
];

/// One text per complex shaper (Arabic, Hebrew, Indic, Thai, Khmer, Myanmar, Hangul and the
/// Universal Shaping Engine) plus the vowel-constraint and default paths. Every font shapes all
/// of them; a font that lacks the script still runs that shaper's reordering and fallback code.
const MULTILINGUAL_TEXT: &[&str] = &[
    "Office AVATAR Wolf Type. To Yo \u{fb01} fi ffl 1/2 3/4",
    "السَّلَامُ عَلَيْكُمْ لا لأ",
    "שָׁלוֹם עוֹלָם",
    "हिन्दी क्षत्रिय कार्य",
    "বাংলা ক্ষ ত্রু",
    "தமிழ் கொ",
    "ภาษาไทย น้ำ",
    "មនុស្ស ខ្មែរ",
    "မြန်မာ ကျွန်ုပ်",
    "한국어 각 \u{1100}\u{1161}\u{11a8}",
    "བོད་ཡིག སྐད",
    "ꦧꦱꦗꦮ ꦏꦿꦶ",
    "अा ऎ",
    "日本語のテキスト、縦書き。",
    "a\u{0301}e\u{0308}\u{0323} o\u{200d}k \u{1f469}\u{200d}\u{1f680}",
];

fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn has_table(font: &FontRef<'_>, tag: &[u8; 4]) -> bool {
    font.table_data(Tag::new(tag)).is_some()
}

fn has_aat_shaping_table(font: &FontRef<'_>) -> bool {
    [b"morx", b"kerx", b"trak"]
        .into_iter()
        .any(|tag| has_table(font, tag))
}

fn has_gsub_rand_feature(font: &FontRef<'_>) -> bool {
    let Ok(features) = font.gsub().and_then(|gsub| gsub.feature_list()) else {
        return false;
    };
    features
        .feature_records()
        .iter()
        .any(|record| record.feature_tag() == Tag::new(b"rand"))
}

fn mapped_characters(font: &FontRef<'_>) -> Vec<char> {
    let cmap = font.cmap().expect("fixture has a cmap");
    (0x20_u32..0x3_0000)
        .filter_map(char::from_u32)
        .filter(|&character| {
            cmap.map_codepoint(character)
                .is_some_and(|glyph| glyph.to_u32() != 0)
        })
        .collect()
}

/// At most `limit` characters, spread evenly over the mapped set.
fn sample(characters: &[char], limit: usize) -> Vec<char> {
    if characters.len() <= limit {
        return characters.to_vec();
    }
    (0..limit)
        .map(|index| characters[index * characters.len() / limit])
        .collect()
}

/// One line per left character: `left right left right ...` over every right character, so each
/// ordered pair is adjacent once in each order.
fn pair_lines(characters: &[char]) -> Vec<String> {
    characters
        .iter()
        .map(|&left| {
            let mut line = String::new();
            for &right in characters {
                line.push(left);
                line.push(right);
            }
            line
        })
        .collect()
}

fn corpus_requests(directory: &str) -> Vec<(String, Request)> {
    let source = fs::read(manifest_path(directory).join("cases.json")).expect("corpus cases");
    let corpus: Value = serde_json::from_slice(&source).expect("corpus JSON");
    let defaults = &corpus["defaults"];
    let field = |case: &Value, name: &str| -> Value {
        if case[name].is_null() {
            defaults[name].clone()
        } else {
            case[name].clone()
        }
    };
    corpus["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|case| case["oracle"].as_bool().unwrap_or(true))
        .map(|case| {
            let text = |value: Value| value.as_str().expect("string").to_owned();
            let features = field(case, "features")
                .as_array()
                .expect("features")
                .iter()
                .map(|feature| feature.as_str().expect("feature").to_owned())
                .collect();
            (
                text(case["id"].clone()),
                Request {
                    text: text(case["text"].clone()),
                    segment: Some(Segment {
                        direction: text(field(case, "direction")),
                        script: text(field(case, "script")),
                        language: Some(text(field(case, "language"))),
                    }),
                    features,
                    buffer_flags: PRODUCE_UNSAFE_TO_CONCAT,
                    precompiled_plan: false,
                },
            )
        })
        .collect()
}

/// The variants each generated text is shaped under: guessed and forced directions, kerning on
/// and off, and both the planless and the precompiled-plan entry points.
fn variants(text: &str) -> Vec<Request> {
    let request = |segment: Option<Segment>, features: &[&str], precompiled_plan: bool| Request {
        text: text.to_owned(),
        segment,
        features: features.iter().map(|&feature| feature.to_owned()).collect(),
        buffer_flags: BEGINNING_AND_END_OF_TEXT | PRODUCE_UNSAFE_TO_CONCAT,
        precompiled_plan,
    };
    let forced = |direction: &str| {
        Some(Segment {
            direction: direction.to_owned(),
            script: "Latn".to_owned(),
            language: Some("en".to_owned()),
        })
    };
    vec![
        request(None, &[], false),
        request(None, &[], true),
        request(None, &["-kern"], true),
        request(None, &["-liga", "smcp", "ss01"], true),
        request(forced("ltr"), &[], true),
        request(forced("rtl"), &[], true),
        request(forced("ttb"), &[], false),
    ]
}

struct Tally {
    requests: usize,
    glyphs: usize,
    /// Requests whose result changes when kerning is switched off.
    kerned_requests: usize,
    /// Requests upstream shapes differently with and without its default `rand` feature.
    randomized_requests: usize,
}

/// Shapes one request on both engines and returns the shared result, or panics with the first
/// differing glyph.
fn assert_same(
    label: &str,
    upstream: &upstream_engine::Font<'_>,
    fork: &fork_engine::Font<'_>,
    request: &Request,
    upstream_disables_rand: bool,
) -> Vec<Glyph> {
    let expected = if upstream_disables_rand {
        upstream.shape(&with_feature(request, "rand=0"))
    } else {
        upstream.shape(request)
    };
    let actual = fork.shape(request);
    if expected != actual {
        let index = expected
            .iter()
            .zip(&actual)
            .position(|(left, right)| left != right)
            .unwrap_or(expected.len().min(actual.len()));
        panic!(
            "{label}: fork differs from upstream at glyph {index} of {} / {}\n  request: {request:?}\n  upstream: {:?}\n  fork:     {:?}",
            expected.len(),
            actual.len(),
            expected.get(index),
            actual.get(index),
        );
    }
    actual
}

/// Every request one font is compared on: all pair lines and multilingual texts under each
/// variant, every shaping-corpus case, and the font's own corpus through a precompiled plan.
fn requests_for(font: &FontRef<'_>, exhaustive_pairs: bool, corpus: Option<&str>) -> Vec<Request> {
    let characters = mapped_characters(font);
    let pair_limit = if exhaustive_pairs {
        usize::MAX
    } else {
        SAMPLED_PAIR_CHARACTERS
    };
    let mut texts = pair_lines(&sample(&characters, pair_limit));
    texts.extend(MULTILINGUAL_TEXT.iter().map(|&text| text.to_owned()));
    texts.push(
        sample(&characters, INVENTORY_LINE_CHARACTERS)
            .into_iter()
            .collect(),
    );

    let mut requests: Vec<Request> = texts.iter().flat_map(|text| variants(text)).collect();
    for directory in FIXTURES.iter().filter_map(|fixture| fixture.corpus) {
        requests.extend(
            corpus_requests(directory)
                .into_iter()
                .map(|(_, request)| request),
        );
    }
    if let Some(directory) = corpus {
        // The fixture's own corpus again through the entry point the product uses.
        requests.extend(
            corpus_requests(directory)
                .into_iter()
                .map(|(_, request)| Request {
                    precompiled_plan: true,
                    ..request
                }),
        );
    }
    requests
}

fn with_feature(request: &Request, feature: &str) -> Request {
    let mut request = request.clone();
    request.features.push(feature.to_owned());
    request
}

fn sweep(name: &str, bytes: &[u8], exhaustive_pairs: bool, corpus: Option<&str>) -> Tally {
    let font = FontRef::new(bytes).expect("fixture is a readable font");
    let upstream = upstream_engine::Font::new(bytes);
    let fork = fork_engine::Font::new(bytes);
    let has_rand = has_gsub_rand_feature(&font);
    let upstream_disables_rand = !FORK_HAS_AAT_AND_RAND && has_rand;
    let mut tally = Tally {
        requests: 0,
        glyphs: 0,
        kerned_requests: 0,
        randomized_requests: 0,
    };
    for request in &requests_for(&font, exhaustive_pairs, corpus) {
        let glyphs = assert_same(name, &upstream, &fork, request, upstream_disables_rand);
        tally.requests += 1;
        tally.glyphs += glyphs.len();
        let kerning_requested = !request.features.iter().any(|feature| feature == "-kern");
        if kerning_requested && fork.shape(&with_feature(request, "-kern")) != glyphs {
            tally.kerned_requests += 1;
        }
        if has_rand && upstream.shape(request) != upstream.shape(&with_feature(request, "rand=0")) {
            tally.randomized_requests += 1;
        }
    }
    tally
}

#[test]
fn fork_shapes_every_fixture_like_upstream() {
    for fixture in FIXTURES {
        let bytes = fs::read(manifest_path(fixture.path)).expect("fixture font");
        let font = FontRef::new(&bytes).expect("fixture is a readable font");
        assert!(
            FORK_HAS_AAT_AND_RAND || !has_aat_shaping_table(&font),
            "{}: AAT fonts are not comparable without the fork's `aat` feature",
            fixture.name
        );
        let tally = sweep(
            fixture.name,
            &bytes,
            fixture.exhaustive_pairs,
            fixture.corpus,
        );
        println!(
            "{}: {} requests, {} glyphs identical; kerning changed {} requests",
            fixture.name, tally.requests, tally.glyphs, tally.kerned_requests
        );
        if fixture.exhaustive_pairs {
            // The comparison is only evidence about `kern` if kerning is actually applied.
            assert!(
                tally.kerned_requests > MINIMUM_KERNED_REQUESTS,
                "{}: the legacy `kern` table was not applied",
                fixture.name
            );
        }
    }
}

/// The checked-in HarfRust oracle of the repository's shaping corpus, reproduced by the fork.
#[test]
fn fork_reproduces_the_checked_in_shaping_oracle() {
    for fixture in FIXTURES {
        let Some(directory) = fixture.corpus else {
            continue;
        };
        let bytes = fs::read(manifest_path(fixture.path)).expect("fixture font");
        let fork = fork_engine::Font::new(&bytes);
        let oracle: Value = serde_json::from_slice(
            &fs::read(manifest_path(directory).join("harfrust.json")).expect("oracle"),
        )
        .expect("oracle JSON");
        let expected_cases = oracle["cases"].as_array().expect("oracle cases");
        let requests = corpus_requests(directory);
        assert_eq!(expected_cases.len(), requests.len(), "{}", fixture.name);
        for (expected, (id, request)) in expected_cases.iter().zip(&requests) {
            assert_eq!(expected["id"].as_str(), Some(id.as_str()));
            let field = |glyph: &Value, name: &str| glyph[name].as_i64().expect("glyph field");
            let expected: Vec<Glyph> = expected["glyphs"]
                .as_array()
                .expect("glyphs")
                .iter()
                .map(|glyph| Glyph {
                    glyph_id: field(glyph, "glyphId") as u32,
                    cluster: field(glyph, "cluster") as u32,
                    flags: field(glyph, "flags") as u32,
                    x_advance: field(glyph, "xAdvance") as i32,
                    y_advance: field(glyph, "yAdvance") as i32,
                    x_offset: field(glyph, "xOffset") as i32,
                    y_offset: field(glyph, "yOffset") as i32,
                })
                .collect();
            assert_eq!(fork.shape(request), expected, "{}: case {id}", fixture.name);
        }
    }
}

/// Fonts outside the repository, named by `HARFRUST_PARITY_EXTRA_FONTS` (paths separated by `:`).
/// Without the fork's `aat` feature, fonts with AAT shaping tables are reported and skipped.
#[test]
fn fork_shapes_extra_fonts_like_upstream() {
    let Some(paths) = env::var_os("HARFRUST_PARITY_EXTRA_FONTS") else {
        return;
    };
    for path in env::split_paths(&paths) {
        let bytes = fs::read(&path).expect("extra font");
        let name = path.display().to_string();
        let Ok(font) = FontRef::new(&bytes) else {
            println!("{name}: skipped, not a single-face font");
            continue;
        };
        if !FORK_HAS_AAT_AND_RAND && has_aat_shaping_table(&font) {
            println!("{name}: skipped, AAT shaping tables");
            continue;
        }
        let tally = sweep(&name, &bytes, false, None);
        println!(
            "{name}: {} requests, {} glyphs identical; kerning changed {} requests; upstream `rand` changed {}",
            tally.requests, tally.glyphs, tally.kerned_requests, tally.randomized_requests
        );
    }
}
