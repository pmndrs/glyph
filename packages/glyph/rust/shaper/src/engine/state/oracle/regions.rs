//! A paragraph that flows through several regions: equal columns as the host derives them, and
//! explicit boxes of different sizes and positions.
//!
//! Flow leaves a region for the next when the region is full, so a change early in the text
//! moves lines across region boundaries, and a change to the regions re-flows everything after
//! the first one. Each case holds the lines' regions, the placed glyphs and the draw packets
//! to a cold layout through edits, measure changes and region changes.

use alloc::{format, string::String, vec, vec::Vec};

use crate::engine::frame::{
    ALIGN_JUSTIFY, ALIGN_START, OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE,
};

use super::{
    corpus::{self, Script},
    matrix::{Case, Extras, Step, Tier, new_case, utf16},
    mechanisms::ROUTES,
    model::{Exclusion, Layout, RegionBox, Regions, TextEdit},
};

fn columns(count: u8, gap: f32) -> Regions {
    Regions::Columns { count, gap }
}

const fn region(inline_start: f32, block_start: f32, inline_end: f32, block_end: f32) -> RegionBox {
    RegionBox {
        inline_start,
        block_start,
        inline_end,
        block_end,
    }
}

/// Three boxes of different widths, the second beside the first and the third below both.
const STAGGERED: Regions = Regions::Boxes {
    boxes: [
        region(0.0, 0.0, 260.0, 120.0),
        region(300.0, 40.0, 600.0, 200.0),
        region(40.0, 220.0, 520.0, 400.0),
    ],
    count: 3,
};

struct Fixture {
    name: &'static str,
    stack: &'static [&'static str],
    script: Script,
    /// Graphemes of generated text.
    size: usize,
    layout: Layout,
    quick: bool,
}

fn fixtures() -> Vec<Fixture> {
    let base = Layout {
        width: 600.0,
        height: 200.0,
        overflow: OVERFLOW_CLIP,
        ..Layout::default()
    };
    let fixture = |name, stack, script, size, layout, quick| Fixture {
        name,
        stack,
        script,
        size,
        layout,
        quick,
    };
    let latin: &'static [&'static str] = &["inter"];
    vec![
        fixture(
            "columns-2-latin",
            latin,
            Script::Latin,
            500,
            Layout {
                regions: columns(2, 24.0),
                ..base
            },
            true,
        ),
        fixture(
            "columns-3-justify-latin",
            &["source-serif"],
            Script::Latin,
            700,
            Layout {
                regions: columns(3, 18.0),
                align: ALIGN_JUSTIFY,
                ..base
            },
            true,
        ),
        fixture(
            "columns-2-arabic",
            &["amiri"],
            Script::Arabic,
            500,
            Layout {
                regions: columns(2, 24.0),
                ..base
            },
            false,
        ),
        fixture(
            "columns-3-cjk",
            &["cjk-jp"],
            Script::Cjk,
            500,
            Layout {
                regions: columns(3, 12.0),
                align: ALIGN_JUSTIFY,
                ..base
            },
            false,
        ),
        fixture(
            "columns-2-ellipsis-latin",
            latin,
            Script::Latin,
            900,
            Layout {
                regions: columns(2, 24.0),
                overflow: OVERFLOW_ELLIPSIS,
                ..base
            },
            false,
        ),
        fixture(
            "columns-2-exclusion-latin",
            latin,
            Script::Latin,
            500,
            Layout {
                regions: columns(2, 24.0),
                exclusion: Some(Exclusion {
                    inline_start: 80.0,
                    inline_end: 200.0,
                    block_start: 30.0,
                    block_end: 110.0,
                    polygon: false,
                }),
                align: ALIGN_JUSTIFY,
                ..base
            },
            false,
        ),
        fixture(
            "columns-2-drop-cap-latin",
            &["source-serif"],
            Script::Latin,
            500,
            Layout {
                regions: columns(2, 24.0),
                drop_cap_lines: 3,
                ..base
            },
            false,
        ),
        fixture(
            "boxes-latin",
            latin,
            Script::Latin,
            600,
            Layout {
                regions: STAGGERED,
                height: 400.0,
                ..base
            },
            true,
        ),
        fixture(
            "boxes-arabic",
            &["amiri"],
            Script::Arabic,
            600,
            Layout {
                regions: STAGGERED,
                height: 400.0,
                align: ALIGN_JUSTIFY,
                ..base
            },
            false,
        ),
        // The default overflow: the last region keeps the one line that straddles its foot.
        fixture(
            "columns-2-visible-latin",
            latin,
            Script::Latin,
            900,
            Layout {
                regions: columns(2, 24.0),
                overflow: OVERFLOW_VISIBLE,
                ..base
            },
            true,
        ),
        fixture(
            "boxes-visible-latin",
            latin,
            Script::Latin,
            900,
            Layout {
                regions: STAGGERED,
                height: 400.0,
                overflow: OVERFLOW_VISIBLE,
                ..base
            },
            false,
        ),
        // The plan's paragraph floor, in columns tall enough to hold it.
        fixture(
            "columns-3-paragraph-latin",
            latin,
            Script::Latin,
            2_400,
            Layout {
                regions: columns(3, 20.0),
                height: 1_600.0,
                width: 900.0,
                ..base
            },
            false,
        ),
    ]
}

pub(super) fn cases(cases: &mut Vec<Case>) {
    for fixture in fixtures() {
        for (route_name, route) in ROUTES {
            // The long paragraph runs on one route; the others on all four.
            if fixture.size > 1_000 && route_name != "full" {
                continue;
            }
            let quick = fixture.quick && route_name == "full";
            let name = format!("rg-{}-{route_name}", fixture.name);
            let mut case = new_case(
                name,
                if quick { Tier::Quick } else { Tier::Full },
                fixture.stack,
                fixture.script,
            );
            case.extended = true;
            case.extras = Extras {
                regions: true,
                ..Extras::default()
            };
            case.fuzz = route_name == "full";
            case.paragraph = fixture.size > 2_000;
            case.model.text = corpus::paragraph(fixture.script, 20_261_122, fixture.size);
            case.model.layout = fixture.layout;
            let layout = fixture.layout;
            let relaid = |label: &str, layout: Layout| Step {
                label: String::from(label),
                layout: Some(layout),
                route: Some(route),
                ..Step::default()
            };
            let edited = |label: &str, start: u32, delete: u32, insert: &str| Step {
                label: String::from(label),
                edits: vec![TextEdit {
                    start,
                    delete,
                    insert: utf16(insert),
                }],
                route: Some(route),
                ..Step::default()
            };
            let middle = case.model.text.len() as u32 / 2;
            case.steps = vec![
                edited("insert in the first region", 0, 0, "pushed along the flow "),
                edited("delete in a later region", middle, 12, ""),
                relaid(
                    "narrower measure",
                    Layout {
                        width: layout.width - 90.0,
                        ..layout
                    },
                ),
                relaid(
                    "shorter regions",
                    Layout {
                        height: layout.height - 60.0,
                        ..layout
                    },
                ),
                relaid(
                    "three columns, wider gap",
                    Layout {
                        regions: columns(3, 40.0),
                        ..layout
                    },
                ),
                relaid(
                    "one region",
                    Layout {
                        regions: Regions::Single,
                        align: ALIGN_START,
                        ..layout
                    },
                ),
                relaid("the starting regions", layout),
            ];
            cases.push(case);
        }
    }
}

/// A clipped paragraph and requests that change nothing, found by the driver on these cases:
/// what a borrowed-layout read serves afterwards follows the views earlier requests asked for,
/// not the views this request asks for, so it differs from a cold layout on the same route.
pub(super) fn clipped_noop(cases: &mut Vec<Case>) {
    let mut case = new_case(
        String::from("rg-clipped-noop-borrowed-layout"),
        Tier::Quick,
        &["inter"],
        Script::Latin,
    );
    case.extended = true;
    case.model.text = corpus::paragraph(Script::Latin, 20_261_122, 400);
    case.model.layout = Layout {
        width: 600.0,
        height: 120.0,
        overflow: OVERFLOW_CLIP,
        ..Layout::default()
    };
    case.steps = ROUTES
        .iter()
        .map(|(name, route)| Step {
            label: format!("nothing changes, {name}"),
            route: Some(*route),
            ..Step::default()
        })
        .collect();
    cases.push(case);
}
