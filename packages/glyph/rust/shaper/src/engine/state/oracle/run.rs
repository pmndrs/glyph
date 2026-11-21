//! What a host runs: build one case's reference, judge it against the frozen text, drive the
//! differential, and answer all of that through one text command so the native tool and the
//! wasm probe are the same code behind two thin hosts.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt::Write;

use super::{
    capture::{EXTENDED_STAGES, capture},
    fonts::{FONTS, FontLibrary, FontRoot},
    fuzz::{self, Planned, incremental_differences, remap_spans},
    lanes::{Capture, LaneClass, LaneDifference, digest, golden_differences, golden_line_lane},
    matrix::{self, Case, Step, Tier},
    model::{Document, PARAGRAPH_ID},
    session::{Route, Session},
    tier::{self, Files},
};

/// Seeded requests frozen after a case's own scripted steps.
const FROZEN_SEEDED_STEPS: usize = 3;
pub const REFERENCE_HEADER: &str = "# glyph layout oracle reference v1";

/// One case laid out cold and then stepped: the text to freeze, every capture behind it, and
/// any step where the incremental result was not the cold one.
pub struct Reference {
    pub text: String,
    pub captures: Vec<(String, Capture)>,
    pub divergences: Vec<String>,
    /// Clusters in the cold layout, for the 2,000-cluster floor.
    pub clusters: usize,
}

fn planned_from_step(document: &Document, step: &Step) -> Planned {
    let mut next = step.document.clone().unwrap_or_else(|| document.clone());
    let id = step.paragraph.unwrap_or(PARAGRAPH_ID);
    if let Some(paragraph) = next.paragraph_mut(id) {
        let model = &mut paragraph.model;
        for edit in &step.edits {
            edit.apply(&mut model.text);
            remap_spans(&mut model.spans, edit, &model.text);
        }
        if let Some(layout) = step.layout {
            model.layout = layout;
        }
        if let Some(root) = step.root {
            model.root = root;
        }
        if let Some(spans) = &step.spans {
            model.spans.clone_from(spans);
        }
        if let Some(objects) = &step.inline_objects {
            model.inline_objects.clone_from(objects);
        }
    }
    Planned {
        label: step.label.clone(),
        next,
        edits: alloc::vec![(id, step.edits.clone())],
        route: step.route.unwrap_or(Route::FULL),
    }
}

/// Every request the reference freezes after the cold layout: the case's scripted steps, then
/// seeded ones for cases the driver edits.
fn frozen_steps(case: &Case) -> Vec<Planned> {
    let mut document = case.start();
    let mut steps = Vec::new();
    for step in &case.steps {
        let planned = planned_from_step(&document, step);
        document = planned.next.clone();
        steps.push(planned);
    }
    if case.fuzz {
        let seed = digest(case.name.as_bytes());
        steps.extend(fuzz::scripted(case, &document, seed, FROZEN_SEEDED_STEPS));
    }
    steps
}

/// `known` lists lane prefixes on which the engine is known to differ from cold; a step that
/// differs only there is not reported as a divergence.
pub fn reference(library: &FontLibrary, case: &Case, known: &[&str]) -> Result<Reference, String> {
    let stacks: Vec<&[&str]> = case.stacks.iter().map(Vec::as_slice).collect();
    let mut warm = Session::new(library, &stacks)?;
    let output = warm.step_document(&case.start(), &[], Route::FULL)?;
    let cold = capture(&warm, &output)?;
    let clusters = cold
        .lane("cluster.text_start")
        .or_else(|| cold.lane("inline.cluster.text_start"))
        .map_or(0, super::lanes::Lane::rows);
    let mut reference = Reference {
        text: format!("{REFERENCE_HEADER}\ncase {}\n", case.name),
        captures: Vec::new(),
        divergences: Vec::new(),
        clusters,
    };
    reference
        .text
        .push_str(&frozen_text("cold", &cold, true, later_stages(case)));
    reference.captures.push(("cold".to_string(), cold));
    for (index, planned) in frozen_steps(case).into_iter().enumerate() {
        let label = format!("{:02} {}", index + 1, planned.label);
        let stepped = warm.step_document(&planned.next, &planned.edits, planned.route);
        let mut fresh = Session::new(library, &stacks)?;
        let cold = fresh.step_document(&planned.next, &[], planned.route);
        match (stepped, cold) {
            (Ok(output), Ok(cold_output)) => {
                let stepped = capture(&warm, &output)?;
                let cold = capture(&fresh, &cold_output)?;
                let (found, _) = incremental_differences(&stepped, &cold);
                reference.divergences.extend(
                    found
                        .iter()
                        .filter(|d| !known.iter().any(|prefix| d.lane.starts_with(prefix)))
                        .map(|d| format!("step {label}: {}", d.render())),
                );
                reference
                    .text
                    .push_str(&frozen_text(&label, &stepped, false, later_stages(case)));
                reference.captures.push((label, stepped));
            }
            (Err(error), Err(cold_error)) if error == cold_error => {
                let _ = writeln!(reference.text, "step {label}\nrejected {error}");
                // The engine is unusable after a rejected request: restart where it was.
                let previous = warm.document().cloned().unwrap_or_default();
                warm = Session::new(library, &stacks)?;
                warm.step_document(&previous, &[], Route::FULL)?;
            }
            (stepped, cold) => {
                // One side rejected what the other accepted: a divergence in its own right.
                let outcome = |result: Option<String>| {
                    result.map_or_else(|| "succeeded".to_string(), |e| format!("failed with {e}"))
                };
                let finding = format!(
                    "incremental {} but cold {}",
                    outcome(stepped.err()),
                    outcome(cold.err())
                );
                let _ = writeln!(reference.text, "step {label}\noutcome {finding}");
                reference
                    .divergences
                    .push(format!("step {label}: outcome: {finding}"));
                warm = Session::new(library, &stacks)?;
                if warm.step_document(&planned.next, &[], Route::FULL).is_err() {
                    warm = Session::new(library, &stacks)?;
                    warm.step_document(&case.start(), &[], Route::FULL)?;
                }
            }
        }
    }
    Ok(reference)
}

/// The stages added since the first reference set that `case` freezes: none for a case frozen
/// before them, the draw structure for a case added since, and the root's paragraph list for a
/// case with several paragraphs.
fn later_stages(case: &Case) -> &'static [&'static str] {
    match (case.extended, case.document.is_some()) {
        (false, _) => &[],
        (true, false) => &["plan"],
        (true, true) => &["plan", "doc"],
    }
}

/// One step's frozen lines: one digest per group of lanes, where a group is a stage and a
/// class for the cold layout (`stage cluster value …`) and a class alone for the steps after it
/// (`class repr …`). A digest covers its lanes' names, kinds, row counts and rows, so any change
/// inside the group changes the line; `dump` and `diff` then locate the lane and the row.
/// Lanes with no rows are left out, so a lane that gains rows changes its group too.
fn frozen_text(step: &str, capture: &Capture, by_stage: bool, later: &[&str]) -> String {
    let mut groups: Vec<(String, usize, String)> = Vec::new();
    let golden = capture.golden(step);
    for line in golden.lines().skip(1) {
        let fields: Vec<&str> = line.split(' ').collect();
        let [_, name, class, _, rows, _] = fields.as_slice() else {
            continue;
        };
        if *rows == "0" {
            continue;
        }
        let stage = name.split('.').next().unwrap_or(name);
        if EXTENDED_STAGES.contains(&stage) && !later.contains(&stage) {
            continue;
        }
        let group = if by_stage {
            format!("stage {stage} {class}")
        } else {
            format!("class {class}")
        };
        match groups.iter_mut().find(|(known, _, _)| *known == group) {
            Some((_, lanes, text)) => {
                *lanes += 1;
                let _ = writeln!(text, "{line}");
            }
            None => groups.push((group, 1, format!("{line}\n"))),
        }
    }
    let mut text = format!("step {step}\n");
    for (group, lanes, lines) in groups {
        let _ = writeln!(text, "{group} {lanes} {:016x}", digest(lines.as_bytes()));
    }
    text
}

/// A stated, enumerated difference from the frozen reference: `case-prefix group-prefix
/// reason`, where the group is a stage name on cold lines and a class name on step lines.
struct Waiver<'a> {
    case: &'a str,
    lane: &'a str,
}

fn waivers(text: &str) -> Vec<Waiver<'_>> {
    text.lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            Some(Waiver {
                case: fields.next()?,
                lane: fields.next()?,
            })
        })
        .collect()
}

#[derive(Default)]
pub struct Verdict {
    pub failures: Vec<String>,
    pub waived: Vec<String>,
}

/// Judges `actual` against the frozen `expected`. A differing line is a failure unless a
/// waiver names its case and lane.
pub fn verdict(case: &str, expected: &str, actual: &str, waiver_text: &str) -> Verdict {
    let waivers = waivers(waiver_text);
    let mut verdict = Verdict::default();
    for difference in golden_differences(expected, actual) {
        let waived = golden_line_lane(&difference).is_some_and(|lane| {
            waivers.iter().any(|waiver| {
                (waiver.case == "*" || case.starts_with(waiver.case))
                    && lane.starts_with(waiver.lane)
            })
        });
        if waived {
            verdict.waived.push(difference);
        } else {
            verdict.failures.push(difference);
        }
    }
    verdict
}

/// Lanes that differ between two dumps of the same step, each located to its first row.
pub fn dump_differences(left: &Capture, right: &Capture) -> Vec<LaneDifference> {
    super::lanes::differences(left, right, |class| class != LaneClass::Cache)
}

/// Answers one command. The first line of the answer is `ok`, `fail` or `skip`.
///
/// - `list <tier>`: one line per case, `name edited fonts`.
/// - `fonts`: one line per font, `key root path`.
/// - `reference <case>`: the text to freeze.
/// - `fuzz <case> <seed> <steps>`: one differential run.
/// - `references <tier>` and `differential <tier> <seeds> <steps>`: a whole tier against the
///   reference set in `files`; `payload` optionally names cases, one per line.
pub fn command(library: &FontLibrary, files: &dyn Files, line: &str, payload: &str) -> String {
    let fields: Vec<&str> = line.split_whitespace().collect();
    let names: Vec<&str> = payload.lines().filter(|name| !name.is_empty()).collect();
    let known = files.read(tier::KNOWN_DIVERGENCES);
    let tiered = |name: &str, run: &dyn Fn(&[Case]) -> tier::Outcome| {
        let cases = tier::selected(matrix::parse_tier(name)?, &names)?;
        let outcome = run(&cases);
        let status = if outcome.passed { "ok" } else { "fail" };
        Ok(format!("{status}\n{}", outcome.report))
    };
    let answer = match fields.as_slice() {
        ["list", tier] => matrix::parse_tier(tier).map(list),
        ["fonts"] => Ok(fonts()),
        ["reference", name] => with_case(library, name, |case| {
            let reference = reference(library, case, &[])?;
            Ok(format!("ok\n{}", reference.text))
        }),
        ["fuzz", name, seed, steps] => with_case(library, name, |case| {
            let seed_number = number(seed)?;
            let listed = tier::known_seed_steps(&known, name, seed_number);
            let report = fuzz::fuzz(
                library,
                case,
                seed_number,
                number(steps)? as usize,
                &fuzz::known_lanes(&known),
                &listed,
            )?;
            let unlisted = report
                .failures
                .iter()
                .any(|failure| failure.replay_from.is_some());
            let status = if unlisted { "fail" } else { "ok" };
            Ok(format!("{status}\n{}", report.render(name, number(seed)?)))
        }),
        ["references", name] => tiered(name, &|cases| tier::references(library, files, cases)),
        ["differential", name, seeds, steps] => {
            let (seeds, steps) = match (number(seeds), number(steps)) {
                (Ok(seeds), Ok(steps)) => (seeds, steps as usize),
                (Err(error), _) | (_, Err(error)) => return format!("fail\n{error}"),
            };
            tiered(name, &|cases| {
                tier::differential(library, files, cases, seeds, steps)
            })
        }
        #[cfg(feature = "stage-bench")]
        ["bench", rest @ ..] => super::stage_bench::command(library, rest),
        _ => Err(format!("unknown command `{line}`")),
    };
    answer.unwrap_or_else(|error| format!("fail\n{error}"))
}

fn number(text: &str) -> Result<u64, String> {
    text.parse::<u64>()
        .map_err(|error| format!("`{text}` is not a number: {error}"))
}

fn with_case(
    library: &FontLibrary,
    name: &str,
    run: impl FnOnce(&Case) -> Result<String, String>,
) -> Result<String, String> {
    let case = matrix::case(name).ok_or_else(|| format!("unknown case `{name}`"))?;
    let missing = library.missing(case.font_keys());
    if missing.is_empty() {
        run(&case)
    } else {
        Ok(format!("skip\nmissing fonts: {}", missing.join(", ")))
    }
}

pub fn list(tier: Tier) -> String {
    let mut text = "ok\n".to_string();
    for case in matrix::cases().iter().filter(|case| case.tier <= tier) {
        let _ = writeln!(
            text,
            "{} {} {}",
            case.name,
            u8::from(case.fuzz),
            case.font_keys().join(",")
        );
    }
    text
}

fn fonts() -> String {
    let mut text = "ok\n".to_string();
    for font in FONTS {
        let root = match font.root {
            FontRoot::Repository => "repository",
            FontRoot::Synthetic => "synthetic",
            FontRoot::Adversarial => "adversarial",
        };
        let _ = writeln!(text, "{} {root} {}", font.key, font.path);
    }
    text
}

/// The plan's floor for a paragraph fixture.
pub const PARAGRAPH_CLUSTER_FLOOR: usize = 2_000;
