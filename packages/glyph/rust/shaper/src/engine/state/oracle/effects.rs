//! Decorated and effect-bearing text: underline and strikethrough with their own colour and
//! material, outline, shadow and opacity, each turned on, changed and turned off, alone and in
//! the same request as a layout change.
//!
//! Paint is the part of a style a preparation can change without laying text out again, which
//! makes it the place a retained result goes stale: a decoration record bakes its colour and
//! material when it is positioned, and whether rows carry outline and shadow is decided once
//! per paragraph. These cases hold the decoration records, the per-glyph paint fields and the
//! renderer's draw packets to a cold layout after every change.

use alloc::{format, string::String, vec, vec::Vec};

use crate::engine::frame::{
    DECORATION_DOUBLE, DECORATION_LINE_THROUGH, DECORATION_SOLID, DECORATION_UNDERLINE,
};

use super::{
    corpus::Script,
    matrix::{Case, Extras, Step, Tier, new_case, utf16},
    mechanisms::ROUTES,
    model::{Decoration, Layout, Paint, RootStyle, Span, SpanStyle, TextEdit},
    session::Route,
};

const RED: u32 = 0xff20_20e0;
const BLUE: u32 = 0xffe0_6020;
const GREY: u32 = 0x8040_4040;

fn line(flags: u32, rgba: u32) -> Decoration {
    Decoration {
        flags,
        style: DECORATION_SOLID,
        rgba,
        thickness: 1.0,
        offset: 0.0,
    }
}

fn underlined(rgba: u32) -> Paint {
    Paint {
        decoration: Some(line(DECORATION_UNDERLINE, rgba)),
        ..Paint::default()
    }
}

/// One paint fixture: where it starts and the changes it goes through. A change is a label,
/// the paint after it, and the layout change (if any) that rides in the same request.
struct Fixture {
    name: &'static str,
    /// Whether the paint is the root style's or a span's over part of the text.
    on_span: bool,
    start: Paint,
    changes: Vec<(&'static str, Paint, Ride)>,
}

/// What else the request changes besides paint.
#[derive(Clone, Copy)]
enum Ride {
    Nothing,
    /// A text edit that changes line breaks.
    Edit,
    /// A same-length edit: the text changes and the layout topology does not.
    SameLength,
    Width(f32),
}

fn fixtures() -> Vec<Fixture> {
    let material = |paint: Paint, id| Paint {
        material: Some(id),
        ..paint
    };
    let outlined = |rgba, width| Paint {
        outline: Some((rgba, width)),
        ..Paint::default()
    };
    let shadowed = |rgba, inline, block| Paint {
        shadow: Some((rgba, inline, block)),
        ..Paint::default()
    };
    let struck = Paint {
        decoration: Some(line(DECORATION_LINE_THROUGH, BLUE)),
        material: Some(1),
        ..Paint::default()
    };
    let decorated = |decoration| Paint {
        decoration: Some(decoration),
        ..Paint::default()
    };
    vec![
        // The class a render proof caught: a material change on decorated text is not
        // paint-only, because the decoration records carry the material.
        Fixture {
            name: "underline-material",
            on_span: false,
            start: underlined(RED),
            changes: vec![
                ("material on", material(underlined(RED), 1), Ride::Nothing),
                (
                    "material swapped",
                    material(underlined(RED), 2),
                    Ride::Nothing,
                ),
                (
                    "material and width",
                    material(underlined(RED), 3),
                    Ride::Width(300.0),
                ),
                (
                    "material and edit",
                    material(underlined(RED), 4),
                    Ride::Edit,
                ),
                (
                    "material and same-length edit",
                    material(underlined(RED), 5),
                    Ride::SameLength,
                ),
                ("material off", underlined(RED), Ride::Nothing),
            ],
        },
        Fixture {
            name: "underline-colour",
            on_span: false,
            start: underlined(RED),
            changes: vec![
                ("recolour", underlined(BLUE), Ride::Nothing),
                ("recolour and width", underlined(GREY), Ride::Width(333.0)),
                (
                    "thicker",
                    decorated(Decoration {
                        thickness: 2.5,
                        ..line(DECORATION_UNDERLINE, GREY)
                    }),
                    Ride::Nothing,
                ),
                (
                    "double",
                    decorated(Decoration {
                        style: DECORATION_DOUBLE,
                        ..line(DECORATION_UNDERLINE, GREY)
                    }),
                    Ride::Nothing,
                ),
                (
                    "add strikethrough",
                    decorated(line(DECORATION_UNDERLINE | DECORATION_LINE_THROUGH, GREY)),
                    Ride::Nothing,
                ),
                ("decoration off", Paint::default(), Ride::Nothing),
                ("decoration on with an edit", underlined(RED), Ride::Edit),
            ],
        },
        Fixture {
            name: "strike-span-material",
            on_span: true,
            start: struck,
            changes: vec![
                ("material swapped", material(struck, 2), Ride::Nothing),
                (
                    "recolour",
                    Paint {
                        decoration: Some(line(DECORATION_LINE_THROUGH, RED)),
                        ..material(struck, 2)
                    },
                    Ride::Nothing,
                ),
                ("material and edit", material(struck, 3), Ride::Edit),
                (
                    "material and same-length edit",
                    material(struck, 4),
                    Ride::SameLength,
                ),
                (
                    "material and width",
                    material(struck, 5),
                    Ride::Width(280.0),
                ),
            ],
        },
        // Material on undecorated text is paint-only; adding a decoration afterwards must
        // carry the material into the new decoration records.
        Fixture {
            name: "material-then-decoration",
            on_span: false,
            start: Paint::default(),
            changes: vec![
                ("material on", material(Paint::default(), 1), Ride::Nothing),
                (
                    "material swapped",
                    material(Paint::default(), 2),
                    Ride::Nothing,
                ),
                ("underline on", material(underlined(BLUE), 2), Ride::Nothing),
                (
                    "material swapped under decoration",
                    material(underlined(BLUE), 3),
                    Ride::Nothing,
                ),
                (
                    "underline off",
                    material(Paint::default(), 3),
                    Ride::Nothing,
                ),
            ],
        },
        Fixture {
            name: "outline",
            on_span: false,
            start: Paint::default(),
            changes: vec![
                ("outline on", outlined(RED, 1.0), Ride::Nothing),
                ("recolour", outlined(BLUE, 1.0), Ride::Nothing),
                ("wider", outlined(BLUE, 2.5), Ride::Nothing),
                ("wider and edit", outlined(BLUE, 3.0), Ride::Edit),
                ("outline off", Paint::default(), Ride::Nothing),
                (
                    "outline on with width",
                    outlined(GREY, 1.5),
                    Ride::Width(310.0),
                ),
            ],
        },
        Fixture {
            name: "shadow-span",
            on_span: true,
            start: Paint::default(),
            changes: vec![
                ("shadow on", shadowed(GREY, 1.0, 1.0), Ride::Nothing),
                ("moved", shadowed(GREY, 2.0, -1.5), Ride::Nothing),
                (
                    "recolour and same-length edit",
                    shadowed(RED, 2.0, -1.5),
                    Ride::SameLength,
                ),
                ("shadow off and edit", Paint::default(), Ride::Edit),
                (
                    "shadow and outline on",
                    Paint {
                        outline: Some((BLUE, 1.0)),
                        ..shadowed(GREY, 1.0, 1.0)
                    },
                    Ride::Nothing,
                ),
            ],
        },
        Fixture {
            name: "opacity-foreground",
            on_span: false,
            start: underlined(RED),
            changes: vec![
                (
                    "half opaque",
                    Paint {
                        opacity: Some(0.5),
                        ..underlined(RED)
                    },
                    Ride::Nothing,
                ),
                (
                    "foreground",
                    Paint {
                        opacity: Some(0.5),
                        foreground: Some(BLUE),
                        ..underlined(RED)
                    },
                    Ride::Nothing,
                ),
                (
                    "foreground and width",
                    Paint {
                        foreground: Some(GREY),
                        ..underlined(RED)
                    },
                    Ride::Width(290.0),
                ),
            ],
        },
    ]
}

/// The text each fixture is laid out over: a three-line paragraph, a right-to-left paragraph
/// and a label short enough for the inline owner when nothing is decorated.
const TEXTS: [(&str, &[&str], Script, &str, usize); 3] = [
    (
        "latin",
        &["fredoka"],
        Script::Latin,
        "the quick brown fox jumps over the lazy dog ",
        5,
    ),
    (
        "arabic",
        &["amiri"],
        Script::Arabic,
        "\u{627}\u{644}\u{646}\u{635} \u{627}\u{644}\u{639}\u{631}\u{628}\u{64a} \u{641}\u{64a} \u{633}\u{637}\u{631} \u{648}\u{641}\u{642}\u{631}\u{629} ",
        6,
    ),
    ("label", &["inter"], Script::Latin, "a decorated label", 1),
];

pub(super) fn cases(cases: &mut Vec<Case>) {
    for fixture in fixtures() {
        for (text_name, stack, script, unit, repeats) in TEXTS {
            for (route_name, route) in ROUTES {
                // Quick: the Latin paragraph on the two routes that publish without reading.
                let quick = text_name == "latin" && matches!(route_name, "full" | "silent");
                let name = format!("fx-{}-{text_name}-{route_name}", fixture.name);
                let tier = if quick { Tier::Quick } else { Tier::Full };
                let mut case = new_case(name, tier, stack, script);
                case.extended = true;
                case.extras = Extras {
                    paint: true,
                    ..Extras::default()
                };
                case.fuzz = route_name == "full";
                case.model.text = utf16(&unit.repeat(repeats));
                case.model.layout.width = 420.0;
                apply(
                    &mut case.model.root,
                    &mut case.model.spans,
                    &fixture,
                    fixture.start,
                );
                case.steps = steps(&case, &fixture, route);
                cases.push(case);
            }
        }
    }
}

/// Puts `paint` where the fixture carries it: the root style, or one span over the middle.
fn apply(root: &mut RootStyle, spans: &mut Vec<Span>, fixture: &Fixture, paint: Paint) {
    if !fixture.on_span {
        root.paint = paint;
        return;
    }
    let (start, end) = spans.first().map_or((2, 14), |span| (span.start, span.end));
    *spans = vec![Span {
        id: 2,
        start,
        end,
        style: SpanStyle {
            // A span has to declare something; a size that changes nothing keeps it alive
            // while its paint is off.
            font_size: Some(16.0),
            paint,
            ..SpanStyle::default()
        },
    }];
}

fn steps(case: &Case, fixture: &Fixture, route: Route) -> Vec<Step> {
    let mut steps = Vec::new();
    let mut text: Vec<u16> = case.model.text.clone();
    let mut layout = case.model.layout;
    let mut root = case.model.root;
    let mut spans = case.model.spans.clone();
    for (label, paint, ride) in &fixture.changes {
        apply(&mut root, &mut spans, fixture, *paint);
        let mut step = Step {
            label: String::from(*label),
            route: Some(route),
            ..Step::default()
        };
        match ride {
            Ride::Nothing => {}
            Ride::Width(width) => layout.width = *width,
            Ride::Edit | Ride::SameLength => {
                let insert = if matches!(ride, Ride::Edit) {
                    "wider words "
                } else {
                    "Q"
                };
                let edit = TextEdit {
                    start: 0,
                    delete: u32::from(matches!(ride, Ride::SameLength)),
                    insert: utf16(insert),
                };
                edit.apply(&mut text);
                // The span keeps its place in the text: shift it by what the edit added.
                let shift = edit.insert.len() as u32 - edit.delete;
                for span in &mut spans {
                    span.start += shift;
                    span.end += shift;
                }
                step.edits = vec![edit];
            }
        }
        step.layout = Some(Layout { ..layout });
        step.root = Some(root);
        step.spans = Some(spans.clone());
        steps.push(step);
    }
    steps
}
