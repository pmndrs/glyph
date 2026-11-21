//! Several paragraphs in one root: mounted together, edited one among many, reordered, removed
//! and added, prepared in one batch or read one at a time while their siblings wait.
//!
//! A root's paragraphs share its placement slots, its gather and its draw packets, and each
//! carries its own change since the last publication. These cases hold every paragraph's
//! lanes, the root's paragraph order and what the renderer draws to a cold layout of the same
//! document after every step, on each way a host can split the work between reads, the
//! frame's batch preparation and the publication.

use alloc::{format, string::String, vec, vec::Vec};

use crate::engine::frame::{ALIGN_CENTER, ALIGN_JUSTIFY};

use super::{
    corpus::{self, Script},
    matrix::{Case, Extras, Step, Tier, new_case, utf16},
    model::{Document, Layout, Model, Paragraph, RootStyle, TextEdit},
    session::{ALL_VIEWS, Route, Split},
};

const SEED: u64 = 20_261_123;

/// The ways a host with several texts reaches the engine.
const ROUTES: [(&str, Route); 5] = [
    // Everything in the publication request.
    ("publish", Route::FULL),
    // The frame: one batch preparation, then a publication that carries only lifecycle.
    (
        "batch",
        Route {
            view_mask: ALL_VIEWS,
            measure_first: true,
            measure_after: true,
            split: Split::Batch,
        },
    ),
    // A read of each changed paragraph while the others are still dirty.
    (
        "reads",
        Route {
            view_mask: 0,
            measure_first: true,
            measure_after: true,
            split: Split::Each,
        },
    ),
    // One read among dirty siblings, then the frame's batch for the rest.
    (
        "read-then-batch",
        Route {
            view_mask: 0,
            measure_first: true,
            measure_after: false,
            split: Split::OneThenBatch,
        },
    ),
    // The frame with nothing read back.
    (
        "batch-silent",
        Route {
            view_mask: 0,
            measure_first: true,
            measure_after: false,
            split: Split::Batch,
        },
    ),
];

/// Font stacks of the document cases: a style names one by index.
const STACKS: [&[&str]; 3] = [&["inter"], &["amiri"], &["cjk-jp"]];
const SCRIPTS: [Script; 3] = [Script::Latin, Script::Arabic, Script::Cjk];

pub(super) fn paragraph(id: u32, text: Vec<u16>, stack: u32, layout: Layout) -> Paragraph {
    Paragraph {
        id,
        order: id * 100,
        scope: 0,
        rank: 0.0,
        model: Model {
            text,
            root: RootStyle {
                font_stack: stack,
                ..RootStyle::default()
            },
            layout,
            ..Model::default()
        },
    }
}

fn document(paragraphs: Vec<Paragraph>) -> Document {
    Document {
        minted: paragraphs
            .iter()
            .map(|paragraph| paragraph.id)
            .max()
            .unwrap_or(0),
        paragraphs,
        explicit: true,
    }
}

/// `count` paragraphs of `graphemes` graphemes each, cycling through three scripts and fonts.
fn mixed(count: u32, graphemes: usize) -> Document {
    document(
        (1..=count)
            .map(|id| {
                let which = (id as usize - 1) % SCRIPTS.len();
                let layout = Layout {
                    width: 420.0 + 20.0 * which as f32,
                    align: [
                        crate::engine::frame::ALIGN_START,
                        ALIGN_JUSTIFY,
                        ALIGN_CENTER,
                    ][which],
                    ..Layout::default()
                };
                let text = corpus::paragraph(SCRIPTS[which], SEED + u64::from(id), graphemes);
                paragraph(id, text, which as u32, layout)
            })
            .collect(),
    )
}

/// `count` short labels: every one within the inline owner's bound.
fn labels(count: u32) -> Document {
    document(
        (1..=count)
            .map(|id| {
                let layout = Layout {
                    width: 0.0,
                    ..Layout::default()
                };
                let text = corpus::label(Script::Latin, SEED + u64::from(id), 40);
                paragraph(id, text, 0, layout)
            })
            .collect(),
    )
}

fn new_document_case(name: String, tier: Tier, start: Document) -> Case {
    let mut case = new_case(name, tier, STACKS[0], Script::Latin);
    case.stacks = STACKS.iter().map(|stack| stack.to_vec()).collect();
    case.extended = true;
    case.extras = Extras {
        paragraphs: true,
        ..Extras::default()
    };
    case.document = Some(start);
    case
}

fn insert(start: u32, text: &str) -> TextEdit {
    TextEdit {
        start,
        delete: 0,
        insert: utf16(text),
    }
}

/// The scripted life of a four-paragraph document.
fn steps(start: &Document, route: Route) -> Vec<Step> {
    let step = |label: &str| Step {
        label: String::from(label),
        route: Some(route),
        ..Step::default()
    };
    let mut current = start.clone();
    let mut steps = Vec::new();

    // One of four edited.
    steps.push(Step {
        paragraph: Some(2),
        edits: vec![insert(3, " \u{643}\u{644}\u{645}\u{629} ")],
        ..step("edit paragraph 2 alone")
    });
    // Every paragraph dirty at once: the batch.
    steps.push(Step {
        paragraph: Some(1),
        edits: vec![insert(0, "first ")],
        more_edits: vec![
            (2, vec![insert(0, "\u{623}\u{648}\u{644} ")]),
            (3, vec![insert(0, "\u{6700}\u{521d}")]),
            (4, vec![insert(0, "fourth ")]),
        ],
        ..step("edit all four")
    });
    // A measure change on one paragraph and a text edit on another.
    steps.push(Step {
        paragraph: Some(3),
        layout: Some(Layout {
            width: 300.0,
            ..start.paragraphs[2].model.layout
        }),
        more_edits: vec![(4, vec![insert(7, "edited ")])],
        ..step("narrow paragraph 3, edit paragraph 4")
    });
    // Reorder: the first paragraph moves behind the others.
    if let Some(first) = current.paragraph_mut(1) {
        first.order = 950;
    }
    steps.push(Step {
        document: Some(current.clone()),
        ..step("move paragraph 1 last")
    });
    // A scoped rank on two paragraphs that stay for the rest of the script: within a scope,
    // rank decides which member takes which of the scope's places in the order.
    for (id, rank) in [(1, 2.5), (4, -1.0)] {
        if let Some(ranked) = current.paragraph_mut(id) {
            ranked.scope = 7;
            ranked.rank = rank;
        }
    }
    steps.push(Step {
        document: Some(current.clone()),
        ..step("rank paragraphs 1 and 4 in a scope")
    });
    // Remove one of four.
    current.paragraphs.retain(|paragraph| paragraph.id != 3);
    steps.push(Step {
        document: Some(current.clone()),
        ..step("remove paragraph 3")
    });
    // Add one, in the gap the removal left in the order.
    let added = paragraph(
        5,
        corpus::paragraph(Script::Latin, SEED + 5, 60),
        0,
        Layout::default(),
    );
    current.paragraphs.push(Paragraph {
        order: 300,
        ..added
    });
    current.minted = 5;
    steps.push(Step {
        document: Some(current.clone()),
        ..step("add paragraph 5")
    });
    // Remove, add and edit in one step.
    current.paragraphs.retain(|paragraph| paragraph.id != 2);
    current.paragraphs.push(paragraph(
        6,
        corpus::paragraph(Script::Cjk, SEED + 6, 40),
        2,
        Layout::default(),
    ));
    current.minted = 6;
    steps.push(Step {
        document: Some(current.clone()),
        paragraph: Some(4),
        edits: vec![insert(0, "again ")],
        ..step("remove 2, add 6, edit 4")
    });
    // Nothing changes: the read and the publication still have to agree with cold.
    steps.push(step("nothing changes"));
    steps
}

/// Found by the scripted life above when it ranked a paragraph it later removed: a scope's
/// members trade places in the order by rank, and when one of them is removed the others keep
/// the places they traded into, where a cold layout of the remaining paragraphs gives each
/// its own.
fn ranked_member_removed() -> Case {
    let start = mixed(4, 60);
    let mut ranked = start.clone();
    for (id, rank) in [(2, 2.5), (4, -1.0)] {
        if let Some(paragraph) = ranked.paragraph_mut(id) {
            paragraph.scope = 7;
            paragraph.rank = rank;
        }
    }
    let mut removed = ranked.clone();
    removed.paragraphs.retain(|paragraph| paragraph.id != 2);
    let mut case = new_document_case(
        String::from("doc-ranked-scope-member-removed"),
        Tier::Quick,
        start,
    );
    case.steps = vec![
        Step {
            label: String::from("rank paragraphs 2 and 4 in a scope"),
            document: Some(ranked),
            ..Step::default()
        },
        Step {
            label: String::from("remove paragraph 2"),
            document: Some(removed),
            ..Step::default()
        },
    ];
    case
}

pub(super) fn cases(cases: &mut Vec<Case>) {
    cases.push(ranked_member_removed());
    // A scripted life on every route, at two paragraph sizes.
    for (size_name, graphemes, quick) in [("short", 60, true), ("long", 420, false)] {
        let start = mixed(4, graphemes);
        for (route_name, route) in ROUTES {
            let name = format!("doc-four-{size_name}-{route_name}");
            // Quick: the short document on the three routes that differ most.
            let quick = quick && matches!(route_name, "publish" | "batch" | "reads");
            let tier = if quick { Tier::Quick } else { Tier::Full };
            let mut case = new_document_case(name, tier, start.clone());
            case.steps = steps(&start, route);
            case.fuzz = matches!(route_name, "publish" | "batch");
            cases.push(case);
        }
    }
    // Mounts. A cold layout of a document is its mount, through the route of the step being
    // compared, so every step of these cases mounts all of its paragraphs on the cold side.
    for (name, start, tier) in [
        ("doc-mount-two", mixed(2, 200), Tier::Quick),
        ("doc-mount-seven", mixed(7, 120), Tier::Full),
        ("doc-mount-labels-24", labels(24), Tier::Full),
        ("doc-mount-labels-64", labels(64), Tier::Full),
        ("doc-mount-one", mixed(1, 300), Tier::Full),
    ] {
        for (route_name, route) in [ROUTES[0], ROUTES[1], ROUTES[2]] {
            let mut case = new_document_case(format!("{name}-{route_name}"), tier, start.clone());
            let step = |label: &str| Step {
                label: String::from(label),
                route: Some(route),
                ..Step::default()
            };
            case.steps = vec![
                Step {
                    paragraph: start.ids().last().copied(),
                    edits: vec![insert(0, "x ")],
                    ..step("edit the last paragraph")
                },
                step("nothing changes"),
            ];
            case.fuzz = route_name == "publish";
            cases.push(case);
        }
    }
    cases.push(emptied());
}

/// A root that loses every paragraph and gains new ones: the empty root is a state too.
fn emptied() -> Case {
    let start = mixed(2, 60);
    let none = Document {
        paragraphs: Vec::new(),
        explicit: true,
        minted: start.minted,
    };
    let mut again = mixed(3, 40);
    for paragraph in &mut again.paragraphs {
        paragraph.id += 10;
    }
    again.minted = 13;
    let mut case = new_document_case(String::from("doc-emptied-and-refilled"), Tier::Quick, start);
    let step = |label: &str, document: Document, route: Route| Step {
        label: String::from(label),
        document: Some(document),
        route: Some(route),
        ..Step::default()
    };
    case.steps = vec![
        step("remove every paragraph", none.clone(), ROUTES[1].1),
        step("nothing, on an empty root", none, ROUTES[2].1),
        step("three new paragraphs", again, ROUTES[3].1),
    ];
    case
}
