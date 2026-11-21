//! The fixture matrix: every case the oracle lays out cold, freezes, and edits.
//!
//! Cases come in three shapes. **Paragraphs** are at least 2,000 clusters per script, crossed
//! with alignment, direction, fallback, spans, drop caps, ellipses and exclusions. **Labels**
//! are short texts on both sides of the 64-unit inline-owner bound. **Mechanism** cases are
//! small texts with a scripted edit, each pinning one long-range effect found in review.

use alloc::{
    format,
    string::{String, ToString},
    vec,
    vec::Vec,
};

use crate::{
    bidi::{DIRECTION_LTR, DIRECTION_RTL},
    engine::frame::{
        ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS,
        WRAP_CHARACTER, WRAP_NONE,
    },
};

use super::{
    corpus::{self, Script},
    model::{Exclusion, Layout, Model, RootStyle, Span, SpanStyle, TextEdit},
    session::Route,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    Quick,
    Full,
}

/// One scripted change: text edits first, then whatever of the rest is set.
#[derive(Clone, Debug, Default)]
pub struct Step {
    pub label: String,
    pub edits: Vec<TextEdit>,
    pub layout: Option<Layout>,
    pub root: Option<RootStyle>,
    pub spans: Option<Vec<Span>>,
    /// How the request reaches the engine; the full route when unset.
    pub route: Option<Route>,
}

#[derive(Clone, Debug)]
pub struct Case {
    pub name: String,
    pub tier: Tier,
    /// Font keys per font stack; a style names a stack by index.
    pub stacks: Vec<Vec<&'static str>>,
    pub script: Script,
    pub model: Model,
    pub steps: Vec<Step>,
    /// Whether the differential driver edits this case.
    pub fuzz: bool,
    /// Paragraph cases must reach the plan's 2,000-cluster floor.
    pub paragraph: bool,
}

impl Case {
    pub fn font_keys(&self) -> Vec<&'static str> {
        let mut keys: Vec<&'static str> = self.stacks.iter().flatten().copied().collect();
        keys.sort_unstable();
        keys.dedup();
        keys
    }
}

/// Graphemes generated per paragraph: above the 2,000-cluster floor after ligatures merge.
const PARAGRAPH_GRAPHEMES: usize = 2_400;
const SEED: u64 = 20_261_121;

struct ScriptFixture {
    key: &'static str,
    script: Script,
    stack: &'static [&'static str],
    /// In the quick tier: fonts are in the repository and the script is not a near-duplicate.
    quick: bool,
}

const SCRIPTS: &[ScriptFixture] = &[
    fixture("latin", Script::Latin, &["inter"], true),
    fixture("greek-cyrillic", Script::GreekCyrillic, &["inter"], true),
    fixture("cjk", Script::Cjk, &["cjk-jp"], true),
    fixture("arabic", Script::Arabic, &["amiri"], true),
    fixture("devanagari", Script::Devanagari, &["devanagari"], true),
    fixture("mixed-bidi", Script::MixedBidi, &["inter", "amiri"], true),
    fixture("hebrew", Script::Hebrew, &["hebrew"], false),
    fixture("thai", Script::Thai, &["thai"], false),
    fixture("bengali", Script::Bengali, &["bengali"], false),
    fixture("hangul", Script::Hangul, &["hangul"], false),
    fixture("emoji", Script::Emoji, &["inter", "emoji"], false),
];

const fn fixture(
    key: &'static str,
    script: Script,
    stack: &'static [&'static str],
    quick: bool,
) -> ScriptFixture {
    ScriptFixture {
        key,
        script,
        stack,
        quick,
    }
}

const ALIGNMENTS: [(&str, u8); 4] = [
    ("start", ALIGN_START),
    ("center", ALIGN_CENTER),
    ("end", ALIGN_END),
    ("justify", ALIGN_JUSTIFY),
];

/// Fonts chosen for one stress each, laid out with the text that triggers it.
const FONT_STRESS: &[(&str, &str, Script)] = &[
    ("fredoka", "fredoka", Script::Latin),
    ("source-serif", "source-serif", Script::Latin),
    ("dancing-script", "dancing-script", Script::Latin),
    ("eb-garamond", "eb-garamond", Script::Latin),
    ("eb-garamond-italic", "eb-garamond-italic", Script::Latin),
    ("recursive", "recursive", Script::Latin),
    ("nabla", "nabla", Script::Latin),
    ("kern-only", "kern-only", Script::Latin),
    ("kern-only-synth", "kern-only-synth", Script::Latin),
    ("fira-code", "fira-code", Script::Code),
    ("fira-code-rand", "fira-code-rand", Script::Code),
    ("nastaliq", "nastaliq", Script::Urdu),
    ("cjk-sc", "cjk-sc", Script::Chinese),
    ("synthetic-supported", "synthetic-supported", Script::Latin),
    (
        "synthetic-long-ligature",
        "synthetic-long-ligature",
        Script::Latin,
    ),
    (
        "synthetic-value2-pair1",
        "synthetic-value2-pair1",
        Script::Latin,
    ),
    (
        "synthetic-value2-pair2",
        "synthetic-value2-pair2",
        Script::Latin,
    ),
];

/// Label lengths in UTF-16 units: inside the inline owner, at its bound, and past it.
const LABEL_UNITS: [usize; 6] = [12, 48, 64, 80, 128, 256];

pub fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    script_paragraphs(&mut cases);
    feature_paragraphs(&mut cases);
    font_stress(&mut cases);
    labels(&mut cases);
    degenerate(&mut cases);
    super::mechanisms::cases(&mut cases);
    cases
}

pub fn case(name: &str) -> Option<Case> {
    cases().into_iter().find(|case| case.name == name)
}

fn paragraph_model(script: Script) -> Model {
    Model {
        text: corpus::paragraph(script, SEED, PARAGRAPH_GRAPHEMES),
        ..Model::default()
    }
}

pub(super) fn new_case(name: String, tier: Tier, stack: &[&'static str], script: Script) -> Case {
    Case {
        name,
        tier,
        stacks: vec![stack.to_vec()],
        script,
        model: Model::default(),
        steps: Vec::new(),
        fuzz: false,
        paragraph: false,
    }
}

/// Script × alignment at paragraph size. Start-aligned and justified paragraphs are edited by
/// the driver; centre and end are frozen and resized by their own scripted step.
fn script_paragraphs(cases: &mut Vec<Case>) {
    for script in SCRIPTS {
        let model = paragraph_model(script.script);
        for (label, align) in ALIGNMENTS {
            let edited = matches!(align, ALIGN_START | ALIGN_JUSTIFY);
            let tier = if script.quick && align == ALIGN_START {
                Tier::Quick
            } else {
                Tier::Full
            };
            let mut case = new_case(
                format!("para-{}-{label}", script.key),
                tier,
                script.stack,
                script.script,
            );
            case.model = model.clone();
            case.model.layout.align = align;
            case.fuzz = edited;
            case.paragraph = true;
            case.steps = resize_steps(case.model.layout);
            cases.push(case);
        }
    }
}

/// Width changes that cross breaks, then one that does not: the resize shortcut and its miss.
fn resize_steps(layout: Layout) -> Vec<Step> {
    [417.0, 418.0, 233.5, 600.0]
        .into_iter()
        .map(|width| Step {
            label: format!("width {width}"),
            layout: Some(Layout { width, ..layout }),
            ..Step::default()
        })
        .collect()
}

fn feature_paragraphs(cases: &mut Vec<Case>) {
    let latin = paragraph_model(Script::Latin);
    let arabic = paragraph_model(Script::Arabic);
    let cjk = paragraph_model(Script::Cjk);
    let mut push = |name: &str,
                    tier: Tier,
                    stacks: &[&[&'static str]],
                    script: Script,
                    model: Model,
                    fuzz: bool| {
        let mut case = new_case(format!("feature-{name}"), tier, stacks[0], script);
        case.stacks = stacks.iter().map(|stack| stack.to_vec()).collect();
        case.model = model;
        case.fuzz = fuzz;
        case.paragraph = true;
        cases.push(case);
    };

    // Direction: a base direction the text does not have, in both senses.
    for (name, text, stack, script, direction) in [
        (
            "latin-rtl-base",
            &latin,
            &["inter"][..],
            Script::Latin,
            DIRECTION_RTL,
        ),
        (
            "arabic-ltr-base",
            &arabic,
            &["amiri"][..],
            Script::Arabic,
            DIRECTION_LTR,
        ),
    ] {
        for (label, align) in ALIGNMENTS {
            let mut model = text.clone();
            model.root.direction = direction;
            model.layout.align = align;
            let fuzz = align == ALIGN_JUSTIFY;
            push(
                &format!("{name}-{label}"),
                Tier::Full,
                &[stack],
                script,
                model,
                fuzz,
            );
        }
    }

    // Fallback: one stack, three fonts, text that needs all of them.
    let mut fallback = paragraph_model(Script::MixedBidi);
    fallback
        .text
        .extend(corpus::paragraph(Script::Cjk, SEED, 200));
    push(
        "fallback-three-fonts",
        Tier::Quick,
        &[&["inter", "amiri", "cjk-jp"]],
        Script::MixedBidi,
        fallback,
        true,
    );

    // Spans: size, spacing, colour, underline, a second font stack, nesting, baseline shift.
    for (name, text, stacks, script, tier) in [
        (
            "spans-latin",
            &latin,
            &[&["inter"][..], &["source-serif"][..]][..],
            Script::Latin,
            Tier::Quick,
        ),
        (
            "spans-arabic",
            &arabic,
            &[&["amiri"][..], &["inter", "amiri"][..]][..],
            Script::Arabic,
            Tier::Full,
        ),
        (
            "spans-cjk",
            &cjk,
            &[&["cjk-jp"][..], &["inter", "cjk-jp"][..]][..],
            Script::Cjk,
            Tier::Full,
        ),
    ] {
        let mut model = text.clone();
        model.spans = styled_spans(&model.text);
        model.layout.align = ALIGN_JUSTIFY;
        push(name, tier, stacks, script, model, true);
    }

    // Drop cap, alone and with an exclusion beside it.
    for (name, text, stack, script, tier) in [
        (
            "drop-cap-latin",
            &latin,
            &["source-serif"][..],
            Script::Latin,
            Tier::Quick,
        ),
        (
            "drop-cap-arabic",
            &arabic,
            &["amiri"][..],
            Script::Arabic,
            Tier::Full,
        ),
        (
            "drop-cap-cjk",
            &cjk,
            &["cjk-jp"][..],
            Script::Cjk,
            Tier::Full,
        ),
    ] {
        let mut model = text.clone();
        model.layout.drop_cap_lines = 3;
        model.layout.align = ALIGN_JUSTIFY;
        push(name, tier, &[stack], script, model, true);
    }

    // Ellipsis and clipping: a line limit, a single line, a bounded height.
    for (name, text, stack, script) in [
        ("latin", &latin, &["inter"][..], Script::Latin),
        ("arabic", &arabic, &["amiri"][..], Script::Arabic),
        ("cjk", &cjk, &["cjk-jp"][..], Script::Cjk),
    ] {
        let mut limited = text.clone();
        limited.layout.max_lines = 3;
        limited.layout.overflow = OVERFLOW_ELLIPSIS;
        push(
            &format!("ellipsis-3-lines-{name}"),
            Tier::Full,
            &[stack],
            script,
            limited,
            true,
        );
        let mut single = text.clone();
        single.layout.wrap = WRAP_NONE;
        single.layout.overflow = OVERFLOW_ELLIPSIS;
        push(
            &format!("ellipsis-nowrap-{name}"),
            Tier::Full,
            &[stack],
            script,
            single,
            false,
        );
    }
    let mut clipped = latin.clone();
    clipped.layout.height = 200.0;
    clipped.layout.overflow = OVERFLOW_CLIP;
    push(
        "clip-height-latin",
        Tier::Full,
        &[&["inter"]],
        Script::Latin,
        clipped,
        true,
    );
    let mut limited = latin.clone();
    limited.layout.max_lines = 12;
    limited.layout.overflow = OVERFLOW_ELLIPSIS;
    limited.layout.align = ALIGN_JUSTIFY;
    push(
        "ellipsis-12-lines-justify-latin",
        Tier::Quick,
        &[&["fredoka"]],
        Script::Latin,
        limited,
        true,
    );

    // Exclusions: a box and a contour the lines flow around.
    for (name, polygon) in [("exclusion-box", false), ("exclusion-contour", true)] {
        for (script_name, text, stack, script, tier) in [
            ("latin", &latin, &["inter"][..], Script::Latin, Tier::Quick),
            (
                "arabic",
                &arabic,
                &["amiri"][..],
                Script::Arabic,
                Tier::Full,
            ),
        ] {
            let mut model = text.clone();
            model.layout.align = ALIGN_JUSTIFY;
            model.layout.exclusion = Some(Exclusion {
                inline_start: 180.0,
                inline_end: 420.0,
                block_start: 40.0,
                block_end: 260.0,
                polygon,
            });
            let tier = if polygon { Tier::Full } else { tier };
            push(
                &format!("{name}-{script_name}"),
                tier,
                &[stack],
                script,
                model,
                true,
            );
        }
    }

    // Wrapping modes and the typography controls that change every advance or line box.
    let mut character = latin.clone();
    character.layout.wrap = WRAP_CHARACTER;
    push(
        "wrap-character-latin",
        Tier::Full,
        &[&["inter"]],
        Script::Latin,
        character,
        true,
    );
    let mut unwrapped = latin.clone();
    unwrapped.layout.width = 0.0;
    push(
        "unconstrained-latin",
        Tier::Full,
        &[&["inter"]],
        Script::Latin,
        unwrapped,
        false,
    );
    let mut spaced = latin.clone();
    spaced.root.letter_spacing = 0.75;
    spaced.root.word_spacing = 2.5;
    spaced.root.line_height = 1.6;
    spaced.layout.first_line_indent = 24.0;
    spaced.layout.justify_last_line = true;
    spaced.layout.align = ALIGN_JUSTIFY;
    push(
        "spacing-indent-latin",
        Tier::Full,
        &[&["inter"]],
        Script::Latin,
        spaced,
        true,
    );
    // Letter spacing reaches joined Arabic clusters today; frozen as it is.
    let mut spaced_arabic = arabic.clone();
    spaced_arabic.root.letter_spacing = 1.5;
    push(
        "letter-spacing-arabic",
        Tier::Quick,
        &[&["amiri"]],
        Script::Arabic,
        spaced_arabic,
        true,
    );
    for (name, size) in [("size-8", 8.0), ("size-72", 72.0)] {
        let mut model = latin.clone();
        model.root.font_size = size;
        push(
            &format!("{name}-latin"),
            Tier::Full,
            &[&["fredoka"]],
            Script::Latin,
            model,
            false,
        );
    }
}

/// Seven spans over the first 600 graphemes: disjoint, nested, and sharing an edge.
fn styled_spans(text: &[u16]) -> Vec<Span> {
    let boundaries = corpus::grapheme_boundaries(text);
    let at = |grapheme: usize| boundaries[grapheme.min(boundaries.len() - 1)];
    let styles = [
        (
            10,
            60,
            SpanStyle {
                font_size: Some(22.0),
                ..SpanStyle::default()
            },
        ),
        (
            20,
            40,
            SpanStyle {
                foreground: Some(0xff33_66cc),
                underline: true,
                ..SpanStyle::default()
            },
        ),
        (
            60,
            61,
            SpanStyle {
                font_size: Some(9.0),
                baseline_shift: Some(4.0),
                ..SpanStyle::default()
            },
        ),
        (
            100,
            220,
            SpanStyle {
                font_stack: Some(1),
                ..SpanStyle::default()
            },
        ),
        (
            120,
            180,
            SpanStyle {
                letter_spacing: Some(1.25),
                ..SpanStyle::default()
            },
        ),
        (
            130,
            131,
            SpanStyle {
                underline: true,
                ..SpanStyle::default()
            },
        ),
        (
            400,
            600,
            SpanStyle {
                font_size: Some(12.5),
                font_stack: Some(1),
                ..SpanStyle::default()
            },
        ),
    ];
    styles
        .into_iter()
        .enumerate()
        .map(|(index, (start, end, style))| Span {
            id: index as u32 + 2,
            start: at(start),
            end: at(end),
            style,
        })
        .collect()
}

fn font_stress(cases: &mut Vec<Case>) {
    for (name, font, script) in FONT_STRESS {
        // The synthetic fonts carry a handful of glyphs; a label is all they can draw.
        let synthetic = font.starts_with("synthetic");
        let quick = matches!(*font, "fredoka" | "source-serif" | "dancing-script") || synthetic;
        let tier = if quick { Tier::Quick } else { Tier::Full };
        for (label, align) in [("start", ALIGN_START), ("justify", ALIGN_JUSTIFY)] {
            let mut case = new_case(format!("font-{name}-{label}"), tier, &[*font], *script);
            if synthetic {
                case.model.text = corpus::label(*script, SEED, 200);
            } else {
                case.model = paragraph_model(*script);
                case.paragraph = true;
            }
            case.model.layout.align = align;
            case.fuzz = align == ALIGN_START || matches!(*font, "fredoka" | "nastaliq");
            case.steps = resize_steps(case.model.layout);
            cases.push(case);
        }
    }
}

fn labels(cases: &mut Vec<Case>) {
    let mut fixtures: Vec<(&str, Script, &[&'static str], bool)> = SCRIPTS
        .iter()
        .map(|script| (script.key, script.script, script.stack, script.quick))
        .collect();
    // A kerned font: every space is a correctable boundary, which keeps short labels off the
    // inline owner.
    fixtures.push(("fredoka", Script::Latin, &["fredoka"], true));
    for (key, script, stack, quick) in fixtures {
        for units in LABEL_UNITS {
            for (label, align) in &ALIGNMENTS[..3] {
                let name = format!("label-{key}-{units}-{label}");
                let tier = if quick && *align == ALIGN_START {
                    Tier::Quick
                } else {
                    Tier::Full
                };
                cases.push(sized_label(name, tier, stack, script, units, *align));
            }
        }
        let mut ellipsis = new_case(format!("label-{key}-ellipsis"), Tier::Full, stack, script);
        ellipsis.model.text = corpus::label(script, SEED, 60);
        ellipsis.model.layout.width = 120.0;
        ellipsis.model.layout.wrap = WRAP_NONE;
        ellipsis.model.layout.overflow = OVERFLOW_ELLIPSIS;
        ellipsis.fuzz = true;
        cases.push(ellipsis);
    }
}

fn sized_label(
    name: String,
    tier: Tier,
    stack: &[&'static str],
    script: Script,
    units: usize,
    align: u8,
) -> Case {
    let mut case = new_case(name, tier, stack, script);
    case.model.text = corpus::label(script, SEED + units as u64, units);
    case.model.layout.align = align;
    // The 48-unit labels are measured unconstrained, as a host sizing to content does.
    case.model.layout.width = if units == 48 { 0.0 } else { 260.0 };
    case.fuzz = align == ALIGN_START;
    case
}

/// Empty and near-empty text: the states an editor passes through.
fn degenerate(cases: &mut Vec<Case>) {
    for (name, text) in [
        ("empty", ""),
        ("one-letter", "a"),
        ("one-space", " "),
        ("spaces", "     "),
        ("newline", "\n"),
        ("newlines", "\n\n\n"),
        ("trailing-newline", "word\n"),
        ("trailing-spaces", "word   \nnext   "),
    ] {
        let mut case = new_case(
            format!("degenerate-{name}"),
            Tier::Quick,
            &["inter"],
            Script::Latin,
        );
        case.model.text = text.encode_utf16().collect();
        case.fuzz = true;
        cases.push(case);
    }
}

pub fn tier_name(tier: Tier) -> &'static str {
    match tier {
        Tier::Quick => "quick",
        Tier::Full => "full",
    }
}

pub fn parse_tier(name: &str) -> Result<Tier, String> {
    match name {
        "quick" => Ok(Tier::Quick),
        "full" => Ok(Tier::Full),
        other => Err(format!("unknown tier `{other}`; use quick or full")),
    }
}

pub fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub fn text_string(text: &[u16]) -> String {
    String::from_utf16_lossy(text).to_string()
}
