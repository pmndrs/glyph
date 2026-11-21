//! Inline objects: boxes a host declares at text offsets, sent with a paragraph's geometry.
//!
//! The engine at this commit parses, validates and routes these records per paragraph, and
//! their presence makes a geometry request count as a change; no layout stage reads them, so
//! a line reserves no room for one and nothing is drawn for one. These cases therefore pin
//! what exists: a request carrying inline objects is accepted on every route, and the layout
//! it leaves equals a cold layout of the same input. When a layout stage starts reading them,
//! these references change and that change is the feature.

use alloc::{format, string::String, vec, vec::Vec};

use crate::engine::frame::{
    ALIGN_JUSTIFY, BASELINE_ALPHABETIC, BASELINE_MIDDLE, BASELINE_TEXT_BOTTOM, BASELINE_TEXT_TOP,
};

use super::{
    corpus::Script,
    matrix::{Case, Extras, Step, Tier, new_case, utf16},
    mechanisms::ROUTES,
    model::{InlineObject, Layout, TextEdit},
};

pub(super) fn object(text_offset: u32, inline_extent: f32, block_extent: f32) -> InlineObject {
    InlineObject {
        text_offset,
        inline_extent,
        block_extent,
        baseline_offset: 0.0,
        baseline_alignment: BASELINE_ALPHABETIC,
        margin_inline: 0.0,
    }
}

const TEXTS: [(&str, &[&str], Script, &str, usize); 4] = [
    (
        "latin",
        &["inter"],
        Script::Latin,
        "the quick brown fox jumps over the lazy dog ",
        6,
    ),
    (
        "arabic",
        &["amiri"],
        Script::Arabic,
        "\u{627}\u{644}\u{646}\u{635} \u{627}\u{644}\u{639}\u{631}\u{628}\u{64a} \u{641}\u{64a} \u{633}\u{637}\u{631} \u{648}\u{641}\u{642}\u{631}\u{629} ",
        6,
    ),
    (
        "cjk",
        &["cjk-jp"],
        Script::Cjk,
        "\u{65e5}\u{672c}\u{8a9e}\u{306e}\u{6587}\u{7ae0}\u{3067}\u{3059}\u{3002}",
        12,
    ),
    ("label", &["inter"], Script::Latin, "icon then a label", 1),
];

pub(super) fn cases(cases: &mut Vec<Case>) {
    for (text_name, stack, script, unit, repeats) in TEXTS {
        for (route_name, route) in ROUTES {
            let quick = text_name == "latin" && matches!(route_name, "full" | "measure-first");
            let tier = if quick { Tier::Quick } else { Tier::Full };
            let name = format!("io-{text_name}-{route_name}");
            let mut case = new_case(name, tier, stack, script);
            case.extended = true;
            case.extras = Extras {
                objects: true,
                ..Extras::default()
            };
            case.fuzz = route_name == "full";
            case.model.text = utf16(&unit.repeat(repeats));
            case.model.layout = Layout {
                width: 360.0,
                align: ALIGN_JUSTIFY,
                ..Layout::default()
            };
            let length = case.model.text.len() as u32;
            let first = object(0, 24.0, 24.0);
            let middle = object(length / 2, 40.0, 16.0);
            let last = object(length, 12.0, 30.0);
            case.model.inline_objects = vec![first, middle];
            let change = |label: &str, objects: Vec<InlineObject>| Step {
                label: String::from(label),
                inline_objects: Some(objects),
                route: Some(route),
                ..Step::default()
            };
            case.steps = vec![
                change("add one at the end", vec![first, middle, last]),
                change(
                    "move and grow the middle one",
                    vec![first, object(length / 3, 64.0, 48.0), last],
                ),
                change(
                    "align to the text top with margins",
                    vec![
                        first,
                        InlineObject {
                            baseline_alignment: BASELINE_TEXT_TOP,
                            baseline_offset: -3.0,
                            margin_inline: 4.0,
                            ..middle
                        },
                        InlineObject {
                            baseline_alignment: BASELINE_TEXT_BOTTOM,
                            ..last
                        },
                    ],
                ),
                Step {
                    label: String::from("edit the text and leave the objects"),
                    edits: vec![TextEdit {
                        start: 1,
                        delete: 0,
                        insert: utf16(" wider words here "),
                    }],
                    route: Some(route),
                    ..Step::default()
                },
                Step {
                    label: String::from("narrow the measure and re-anchor"),
                    layout: Some(Layout {
                        width: 240.0,
                        ..case.model.layout
                    }),
                    inline_objects: Some(vec![InlineObject {
                        baseline_alignment: BASELINE_MIDDLE,
                        ..object(4, 30.0, 30.0)
                    }]),
                    route: Some(route),
                    ..Step::default()
                },
                change("remove every object", Vec::new()),
                change("put two back", vec![first, middle]),
            ];
            cases.push(case);
        }
    }
}
