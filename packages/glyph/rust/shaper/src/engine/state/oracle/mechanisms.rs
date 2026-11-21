//! Small texts with a scripted edit, one per long-range effect.
//!
//! Each case exists because an edit at one offset changes output far from it: a contextual
//! chain through punctuation, cursive attachment across a whole word, bidi levels carried past
//! the last strong character, a script inherited across a hard break, a joiner or regional
//! indicator re-pairing everything after it. A local-edit rule anchored to the edit offset gets
//! these wrong, so the frozen reference and the cold comparison both run them every time.

use alloc::{format, string::String, vec, vec::Vec};

use crate::{
    bidi::DIRECTION_RTL,
    engine::frame::{ALIGN_JUSTIFY, OVERFLOW_ELLIPSIS},
};

use super::{
    corpus::Script,
    matrix::{Case, Step, Tier, new_case, utf16},
    model::{Layout, Span, SpanStyle, TextEdit},
    session::Route,
};

struct Mechanism {
    name: &'static str,
    stack: &'static [&'static str],
    script: Script,
    text: String,
    width: f32,
    /// `(label, start, delete, insert)`, each against the text the previous one left.
    edits: Vec<Edit>,
}

type Edit = (&'static str, usize, usize, String);

/// Replace `delete` units at `start`, then put the original back: two steps per mechanism.
fn there_and_back(
    text: &str,
    label: &'static str,
    start: usize,
    delete: usize,
    insert: &str,
) -> Vec<Edit> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let original = String::from_utf16_lossy(&units[start..start + delete]);
    vec![
        (label, start, delete, insert.into()),
        ("restore", start, insert.encode_utf16().count(), original),
    ]
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

fn mechanisms() -> Vec<Mechanism> {
    let mut list = Vec::new();
    let mut add = |name: &'static str,
                   stack: &'static [&'static str],
                   script: Script,
                   text: String,
                   width: f32,
                   edit: (&'static str, usize, usize, &'static str)| {
        let edits = there_and_back(&text, edit.0, edit.1, edit.2, edit.3);
        list.push(Mechanism {
            name,
            stack,
            script,
            text,
            width,
            edits,
        });
    };
    let inter: &[&str] = &["inter"];
    let latin = Script::Latin;

    // Inter's case-sensitive punctuation is an inductive contextual rule: lowering one letter
    // changes glyphs out to cluster 115 and turns over-cap islands into safe boundaries.
    add(
        "inter-case-chain",
        inter,
        latin,
        format!("A{}Tword word", "-(".repeat(60)),
        300.0,
        ("lower first letter", 0, 1, "a"),
    );
    add(
        "inter-hyphen-chain",
        inter,
        latin,
        format!("A{}", "-".repeat(200)),
        300.0,
        ("lower first letter", 0, 1, "a"),
    );
    // Cursive attachment: the last letter of a 45-letter joined word moves all 44 before it.
    let joined: String = "\u{628}\u{633}\u{645}\u{644}\u{62a}\u{646}\u{6cc}\u{6c1}"
        .chars()
        .cycle()
        .take(45)
        .collect();
    add(
        "nastaliq-long-word",
        &["nastaliq"],
        Script::Urdu,
        joined,
        600.0,
        ("replace last letter", 44, 1, "\u{6a9}"),
    );
    add(
        "nastaliq-delete-space",
        &["nastaliq"],
        Script::Urdu,
        "\u{6a9}\u{62a}\u{627}\u{628} \u{6a9}\u{62a}\u{627}\u{628} \u{6a9}\u{62a}\u{627}\u{628}"
            .into(),
        600.0,
        ("delete space", 4, 1, ""),
    );

    // Digits and neutrals after one Hebrew letter stay at levels 1 and 2 with no R, AL or AN
    // character anywhere near them.
    let hebrew: &[&str] = &["inter", "hebrew"];
    add(
        "bidi-digits-after-hebrew",
        hebrew,
        Script::MixedBidi,
        "abc \u{5d0} 1 2 3 4 5 6 7 8 9, 10 + 11 x".into(),
        90.0,
        ("delete the Hebrew letter", 4, 1, ""),
    );
    // A same-length replacement reshapes a window, and the glyph at the window's edge loses the
    // unsafe-to-break and unsafe-to-concat flags a whole-run shaping gives it.
    add(
        "reshape-window-edge-flags",
        hebrew,
        Script::MixedBidi,
        "abc \u{5d0} 1 2 3 4 5 6 7 8 9, 10 + 11 x".into(),
        90.0,
        ("space to right-to-left mark", 24, 1, "\u{200f}"),
    );
    add(
        "bidi-first-strong",
        hebrew,
        Script::MixedBidi,
        "hello world (one) two".into(),
        120.0,
        ("prepend a Hebrew letter", 0, 0, "\u{5d0}"),
    );
    add(
        "bidi-isolate",
        hebrew,
        Script::MixedBidi,
        "one \u{5d0}\u{5d1}\u{5d2} two 12 three\u{2069} four".into(),
        120.0,
        ("open an isolate", 4, 0, "\u{2067}"),
    );
    // A bracket pair: an inserted `(` changes the level of a `)` 564 units later.
    let far = format!(
        "\u{5d0}\u{5d1} {}) \u{5e1}\u{5d5}\u{5e3}",
        "\u{5d2}\u{5d3}\u{5d4} ".repeat(141)
    );
    add(
        "bidi-bracket-far",
        hebrew,
        Script::Hebrew,
        far,
        600.0,
        ("open a bracket", 3, 0, "("),
    );

    // Script resolution carries through Common characters and across hard breaks.
    add(
        "script-common-carry",
        inter,
        Script::GreekCyrillic,
        "\u{44f} \u{b5} \u{b5} a".into(),
        600.0,
        ("delete the Cyrillic letter", 0, 2, ""),
    );
    add(
        "script-across-break-forward",
        inter,
        Script::GreekCyrillic,
        "\u{44f}\n1 2 3".into(),
        600.0,
        ("Cyrillic to Latin", 0, 1, "a"),
    );
    add(
        "script-across-break-backward",
        inter,
        Script::GreekCyrillic,
        "1 2 3\n\u{44f}".into(),
        600.0,
        ("Cyrillic to Latin", 6, 1, "a"),
    );
    // U+000B forces a line and is only a space to the sentence rules.
    add(
        "sentence-vertical-tab",
        inter,
        latin,
        "Mr.\u{b}smith a b".into(),
        600.0,
        ("capitalize", 4, 1, "S"),
    );
    // LB25 and SB8 read arbitrarily far inside one window.
    add(
        "line-break-numeric-run",
        inter,
        latin,
        format!("A{}5 word", "/".repeat(40)),
        150.0,
        ("letter to digit", 0, 1, "1"),
    );
    add(
        "sentence-long-lookahead",
        inter,
        latin,
        format!("Mr. {}smith", "5 ".repeat(40)),
        150.0,
        ("capitalize", 84, 1, "S"),
    );
    // ASCII bases that are not ASCII clusters.
    let emoji: &[&str] = &["inter", "emoji"];
    add(
        "keycap",
        emoji,
        Script::Emoji,
        "1\u{fe0f}\u{20e3} 2 3".into(),
        600.0,
        ("strip the keycap", 1, 2, ""),
    );
    // A space that carries a combining mark still counts as a space today: it hangs at a line
    // end and stretches under justification. Frozen as it is.
    add(
        "space-combining-mark",
        inter,
        latin,
        "aa \u{301}bb cc \u{301}dd ee ff gg hh ii jj kk".into(),
        60.0,
        ("mark a plain space", 7, 0, "\u{301}"),
    );

    // n:m clusters: one inserted unit removes a cluster.
    let devanagari = "\u{915}\u{937} ".repeat(160);
    add(
        "virama-devanagari",
        &["devanagari"],
        Script::Devanagari,
        devanagari,
        300.0,
        ("join a conjunct", 241, 0, "\u{94d}"),
    );
    add(
        "virama-bengali",
        &["bengali"],
        Script::Bengali,
        "\u{995}\u{9b7} ".repeat(160),
        300.0,
        ("join a conjunct", 241, 0, "\u{9cd}"),
    );
    add(
        "zwj-emoji",
        emoji,
        Script::Emoji,
        "\u{1f468}\u{1f469}\u{1f467} ok ".repeat(30),
        300.0,
        ("join two people", 2, 0, "\u{200d}"),
    );
    // One regional indicator re-pairs every flag after it.
    for (name, flags) in [
        ("regional-indicators-9", 9),
        ("regional-indicators-3", 3),
        ("regional-indicators-5", 5),
    ] {
        add(
            name,
            emoji,
            Script::Emoji,
            format!("x {} y", "\u{1f1ef}\u{1f1f5}".repeat(flags)),
            120.0,
            ("insert one indicator", 2, 0, "\u{1f1fa}"),
        );
    }
    // Text without spaces converges at the next hard break, not at the next word.
    let cjk = format!(
        "{0}\n{0}\n{0}",
        "\u{65e5}\u{672c}\u{8a9e}\u{306e}\u{6587}\u{7ae0}\u{3067}\u{3059}\u{3002}".repeat(30)
    );
    add(
        "multi-paragraph-cjk",
        &["cjk-jp"],
        Script::Cjk,
        cjk,
        400.0,
        ("insert in paragraph one", 5, 0, "\u{6f22}"),
    );
    let thai = format!("{0}\n{0}\n{0}", "\u{e20}\u{e32}\u{e29}\u{e32}\u{e44}\u{e17}\u{e22}\u{e44}\u{e21}\u{e48}\u{e21}\u{e35}\u{e0a}\u{e48}\u{e2d}\u{e07}\u{e27}\u{e48}\u{e32}\u{e07} ".repeat(14));
    add(
        "multi-paragraph-thai",
        &["thai"],
        Script::Thai,
        thai,
        400.0,
        ("insert in paragraph one", 5, 0, "\u{e01}"),
    );
    // The edit changes which line is last, so which line justification skips.
    let prose = "the quick brown fox jumps over the lazy dog ".repeat(5);
    add(
        "justify-last-line-moves",
        &["source-serif"],
        latin,
        prose.clone(),
        420.0,
        (
            "append a line",
            units(&prose),
            0,
            "and then it keeps going past the end ",
        ),
    );
    // One right-to-left character anywhere turns line-edge corrections off for the whole text.
    let kerned = format!("{prose}\n{prose}");
    add(
        "ltr-is-text-wide",
        &["fredoka", "amiri"],
        latin,
        kerned.clone(),
        420.0,
        (
            "one Arabic letter in paragraph two",
            units(&kerned) - 4,
            0,
            "\u{628}",
        ),
    );
    list
}

pub(super) fn cases(cases: &mut Vec<Case>) {
    for mechanism in mechanisms() {
        let in_repository = mechanism.stack.iter().all(|key| {
            super::fonts::font_spec(key)
                .is_some_and(|font| font.root != super::fonts::FontRoot::Adversarial)
        });
        let tier = if in_repository {
            Tier::Quick
        } else {
            Tier::Full
        };
        for (suffix, align) in [("", None), ("-justify", Some(ALIGN_JUSTIFY))] {
            let mut case = new_case(
                format!("mech-{}{suffix}", mechanism.name),
                tier,
                mechanism.stack,
                mechanism.script,
            );
            case.model.text = utf16(&mechanism.text);
            case.model.layout.width = mechanism.width;
            if let Some(align) = align {
                case.model.layout.align = align;
            }
            if matches!(
                mechanism.name,
                "bidi-bracket-far" | "reshape-window-edge-flags"
            ) {
                case.model.root.direction = DIRECTION_RTL;
            }
            case.steps = mechanism
                .edits
                .iter()
                .map(|(label, start, delete, insert)| Step {
                    label: (*label).into(),
                    edits: vec![TextEdit {
                        start: *start as u32,
                        delete: *delete as u32,
                        insert: utf16(insert),
                    }],
                    ..Step::default()
                })
                .collect();
            case.fuzz = suffix.is_empty();
            cases.push(case);
        }
    }
    cases.push(max_lines_count_change());
    cases.push(style_removal_with_same_length_edit());
    span_changes(cases);
}

/// The ways a host reaches the engine: publish with every view, publish with none and read
/// back, publish with none and no read, and measure before publishing.
pub(super) const ROUTES: [(&str, Route); 4] = [
    ("full", Route::FULL),
    (
        "silent-then-measure",
        Route {
            view_mask: 0,
            measure_first: false,
            measure_after: true,
        },
    ),
    (
        "silent",
        Route {
            view_mask: 0,
            measure_first: false,
            measure_after: false,
        },
    ),
    (
        "measure-first",
        Route {
            view_mask: 0,
            measure_first: true,
            measure_after: false,
        },
    ),
];

fn span(id: u32, start: u32, end: u32, style: SpanStyle) -> Span {
    Span {
        id,
        start,
        end,
        style,
    }
}

/// `(name, font stack, script, text, alignment, spans before, spans after)`.
type SpanFixture<'a> = (
    &'static str,
    &'static [&'static str],
    Script,
    &'a str,
    u8,
    Vec<Span>,
    Vec<Span>,
);

/// Span changes with no text change: the request carries one style record and nothing else.
fn span_changes(cases: &mut Vec<Case>) {
    let sized = SpanStyle {
        font_size: Some(13.0),
        ..SpanStyle::default()
    };
    let underlined = SpanStyle {
        underline: true,
        ..SpanStyle::default()
    };
    let tightened = SpanStyle {
        letter_spacing: Some(-0.5),
        ..SpanStyle::default()
    };
    let cjk = "\u{65e5}\u{672c}\u{8a9e}\u{306e}\u{6587}\u{7ae0}\u{3067}\u{3059}\u{3002}".repeat(4);
    let prose = "the quick brown fox jumps over the lazy dog ".repeat(5);
    let fixtures: [SpanFixture<'_>; 5] = [
        (
            "span-add-size-mixed-label",
            &["cjk-jp"],
            Script::Cjk,
            "\u{65e5}\u{672c}\u{8a9e}\u{3063}\u{3066}W2024\u{5e74}\u{ff11}\u{6f22}\u{5b57}\u{30d5}\u{30a4}\u{30a2}\u{30a6}\u{30c8} \u{65e5}\u{672c}\u{8a9e}\u{65e5}\u{672c}\u{3071}\u{300c}\u{306e}\u{304b}\u{306a}\u{6771}nalcaf\u{e9}",
            crate::engine::frame::ALIGN_JUSTIFY,
            Vec::new(),
            vec![span(2, 31, 38, sized)],
        ),
        (
            "span-add-size-label-cjk",
            &["cjk-jp"],
            Script::Cjk,
            &cjk,
            crate::engine::frame::ALIGN_CENTER,
            Vec::new(),
            vec![span(2, 29, 36, sized)],
        ),
        (
            "span-add-size-label-latin",
            &["inter"],
            Script::Latin,
            "a short label with a tail",
            crate::engine::frame::ALIGN_CENTER,
            Vec::new(),
            vec![span(2, 20, 25, sized)],
        ),
        (
            "span-add-size-paragraph",
            &["inter"],
            Script::Latin,
            &prose,
            crate::engine::frame::ALIGN_START,
            Vec::new(),
            vec![span(2, 100, 140, sized)],
        ),
        (
            "span-restyle-paragraph",
            &["inter"],
            Script::Latin,
            &prose,
            crate::engine::frame::ALIGN_START,
            vec![span(2, 200, 215, underlined)],
            vec![span(2, 200, 215, tightened)],
        ),
    ];
    for (name, stack, script, text, align, before, after) in fixtures {
        for (route_name, route) in ROUTES {
            let mut case = new_case(
                format!("mech-{name}-{route_name}"),
                Tier::Quick,
                stack,
                script,
            );
            case.model.text = utf16(text);
            case.model.layout.align = align;
            case.model.spans = before.clone();
            case.steps = vec![
                Step {
                    label: "change the span".into(),
                    spans: Some(after.clone()),
                    route: Some(route),
                    ..Step::default()
                },
                Step {
                    label: "restore".into(),
                    spans: Some(before.clone()),
                    route: Some(route),
                    ..Step::default()
                },
            ];
            cases.push(case);
        }
    }
}

/// A span removed in the same request as a same-length text edit, in text that has one
/// right-to-left word. Found by the driver: the engine at the reference commit rejects the
/// request incrementally and accepts the same input cold.
fn style_removal_with_same_length_edit() -> Case {
    let mut case = new_case(
        "mech-rtl-same-length-edit-with-span-removal".into(),
        Tier::Quick,
        &["inter", "amiri"],
        Script::Latin,
    );
    // One right-to-left word ahead of the prose.
    case.model.text = utf16(&format!(
        "\u{641}\u{642}\u{631}\u{629} {}",
        "hello brave new world of text ".repeat(12)
    ));
    case.model.spans = vec![Span {
        id: 2,
        start: 300,
        end: 330,
        style: SpanStyle {
            underline: true,
            ..SpanStyle::default()
        },
    }];
    case.steps = vec![Step {
        label: "capitalize and remove the span".into(),
        edits: vec![TextEdit {
            start: 120,
            delete: 1,
            insert: utf16("H"),
        }],
        spans: Some(Vec::new()),
        ..Step::default()
    }];
    case
}

/// A line limit with an ellipsis, where the edit moves the text across the limit both ways.
fn max_lines_count_change() -> Case {
    let prose = "the quick brown fox jumps over the lazy dog ".repeat(6);
    let mut case = new_case(
        "mech-max-lines-count-change".into(),
        Tier::Quick,
        &["fredoka"],
        Script::Latin,
    );
    case.model.text = utf16(&prose);
    case.model.layout = Layout {
        width: 420.0,
        max_lines: 4,
        overflow: OVERFLOW_ELLIPSIS,
        ..Layout::default()
    };
    let cut = units(&prose) / 2;
    case.steps = vec![
        Step {
            label: "delete half, under the limit".into(),
            edits: vec![TextEdit {
                start: 10,
                delete: cut as u32,
                insert: Vec::new(),
            }],
            ..Step::default()
        },
        Step {
            label: "two edits in one request, over the limit".into(),
            edits: vec![
                TextEdit {
                    start: 4,
                    delete: 0,
                    insert: utf16(&prose[..cut]),
                },
                TextEdit {
                    start: 0,
                    delete: 3,
                    insert: utf16("The"),
                },
            ],
            ..Step::default()
        },
        Step {
            label: "raise the limit".into(),
            layout: Some(Layout {
                width: 420.0,
                max_lines: 6,
                overflow: OVERFLOW_ELLIPSIS,
                ..Layout::default()
            }),
            ..Step::default()
        },
    ];
    case.fuzz = true;
    case
}
