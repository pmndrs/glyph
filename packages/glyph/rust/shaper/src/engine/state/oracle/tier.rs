//! A whole tier in one call: every selected case against the frozen reference set, then the
//! differential driver over every case it edits. The host supplies fonts and the reference
//! set's files; everything that decides pass or fail is here, so the native tool and the wasm
//! probe cannot disagree about what a pass is.

use alloc::{
    collections::BTreeMap,
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::fmt::Write;

use super::{
    fonts::FontLibrary,
    fuzz,
    lanes::digest,
    matrix::{self, Case, Tier},
    run::{PARAGRAPH_CLUSTER_FLOOR, reference, verdict},
};

/// The reference set's files by name; an absent file reads as empty.
pub trait Files {
    fn read(&self, name: &str) -> String;
}

impl Files for BTreeMap<String, String> {
    fn read(&self, name: &str) -> String {
        self.get(name).cloned().unwrap_or_default()
    }
}

pub const MANIFEST: &str = "MANIFEST";
pub const WAIVERS: &str = "WAIVERS";
pub const KNOWN_DIVERGENCES: &str = "KNOWN-DIVERGENCES";

pub fn reference_file(case: &str) -> String {
    format!("{case}.txt")
}

pub struct Outcome {
    pub passed: bool,
    pub report: String,
}

/// The cases a run covers: the named ones, or every case of the tier.
pub fn selected(tier: Tier, names: &[&str]) -> Result<Vec<Case>, String> {
    if names.is_empty() {
        return Ok(matrix::cases()
            .into_iter()
            .filter(|case| case.tier <= tier)
            .collect());
    }
    names
        .iter()
        .map(|name| matrix::case(name).ok_or_else(|| format!("unknown case {name}")))
        .collect()
}

pub fn file_digest(text: &str) -> String {
    format!("{:016x}", digest(text.as_bytes()))
}

/// `case -> digest` from the manifest: the record that a frozen file is still the blessed one.
pub fn manifest(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|line| line.split_once(' '))
        .filter(|(_, case)| *case != "set")
        .map(|(digest, case)| (case.to_string(), digest.to_string()))
        .collect()
}

pub fn manifest_text(manifest: &BTreeMap<String, String>) -> String {
    let mut text: String = manifest
        .iter()
        .map(|(case, digest)| format!("{digest} {case}\n"))
        .collect();
    let _ = writeln!(text, "{} set", set_digest(manifest));
    text
}

/// One digest for the whole reference set: the value to quote when saying which reference a
/// result was judged against.
pub fn set_digest(manifest: &BTreeMap<String, String>) -> String {
    let joined: String = manifest
        .iter()
        .map(|(case, digest)| format!("{digest} {case}\n"))
        .collect();
    file_digest(&joined)
}

/// Whether `KNOWN-DIVERGENCES` lists `step <case> <NN>`.
fn known_step(known: &str, case: &str, step: &str) -> bool {
    known.lines().any(|line| {
        let mut entry = line.split_whitespace();
        entry.next() == Some("step") && entry.next() == Some(case) && entry.next() == Some(step)
    })
}

/// Every `seed <case> <seed> <step> <lane>` entry for one run: the steps at which it is known
/// to differ from cold, each with its first differing lane.
pub fn known_seed_steps(known: &str, case: &str, seed: u64) -> Vec<(usize, String)> {
    known
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            match fields.as_slice() {
                ["seed", name, listed, step, lane, ..]
                    if *name == case && listed.parse() == Ok(seed) =>
                {
                    Some((step.parse().ok()?, (*lane).to_string()))
                }
                _ => None,
            }
        })
        .collect()
}

/// The reference set's shared files, read once per run.
struct ReferenceSet {
    manifest: BTreeMap<String, String>,
    waivers: String,
    known: String,
}

impl ReferenceSet {
    fn read(files: &dyn Files) -> Self {
        Self {
            manifest: manifest(&files.read(MANIFEST)),
            waivers: files.read(WAIVERS),
            known: files.read(KNOWN_DIVERGENCES),
        }
    }
}

#[derive(Default)]
struct ReferenceTally {
    equal: usize,
    differ: usize,
    skipped: usize,
    waived: usize,
    divergent_steps: usize,
    unlisted_steps: usize,
}

/// Lays out and steps every case and judges it against its frozen file.
pub fn references(library: &FontLibrary, files: &dyn Files, cases: &[Case]) -> Outcome {
    let set = ReferenceSet::read(files);
    let mut report = String::new();
    let mut tally = ReferenceTally::default();
    for case in cases {
        let missing = library.missing(case.font_keys());
        if !missing.is_empty() {
            tally.skipped += 1;
            let _ = writeln!(
                report,
                "SKIPPED {}: missing fonts {}",
                case.name,
                missing.join(", ")
            );
            continue;
        }
        let expected = files.read(&reference_file(&case.name));
        let problems = judge(library, &set, case, &expected, &mut tally, &mut report);
        if problems.is_empty() {
            tally.equal += 1;
            continue;
        }
        tally.differ += 1;
        let _ = writeln!(report, "FAIL {}", case.name);
        for problem in problems.iter().take(12) {
            let _ = writeln!(report, "  {problem}");
        }
    }
    let _ = writeln!(
        report,
        "reference set {}: {} cases equal, {} differ, {} skipped, {} waived lines; {} scripted steps where incremental is not cold, {} of them not in {KNOWN_DIVERGENCES}",
        set_digest(&set.manifest),
        tally.equal,
        tally.differ,
        tally.skipped,
        tally.waived,
        tally.divergent_steps,
        tally.unlisted_steps,
    );
    Outcome {
        passed: tally.differ == 0 && tally.unlisted_steps == 0,
        report,
    }
}

/// Everything wrong with one case against its frozen file; waived lines and divergent steps
/// go to the report and the tally.
fn judge(
    library: &FontLibrary,
    set: &ReferenceSet,
    case: &Case,
    expected: &str,
    tally: &mut ReferenceTally,
    report: &mut String,
) -> Vec<String> {
    let mut problems = Vec::new();
    if set.manifest.get(&case.name) != Some(&file_digest(expected)) {
        problems.push("frozen file is missing or is not the one MANIFEST records".to_string());
    }
    let actual = match reference(library, case, &fuzz::known_lanes(&set.known)) {
        Ok(actual) => actual,
        Err(error) => {
            problems.push(error);
            return problems;
        }
    };
    let verdict = verdict(&case.name, expected, &actual.text, &set.waivers);
    problems.extend(verdict.failures);
    tally.waived += verdict.waived.len();
    for line in verdict.waived {
        let _ = writeln!(report, "waived {}: {line}", case.name);
    }
    if case.paragraph && actual.clusters < PARAGRAPH_CLUSTER_FLOOR {
        problems.push(format!(
            "paragraph has {} clusters, under the {PARAGRAPH_CLUSTER_FLOOR} floor",
            actual.clusters
        ));
    }
    // A divergence line is `step <NN> <label>: <lane> …`; report the first per step.
    let step_of = |line: &String| line.split_whitespace().nth(1).map(String::from);
    let mut steps: Vec<String> = actual.divergences.iter().filter_map(step_of).collect();
    steps.dedup();
    for step in steps {
        let listed = known_step(&set.known, &case.name, &step);
        tally.divergent_steps += 1;
        tally.unlisted_steps += usize::from(!listed);
        let first = actual
            .divergences
            .iter()
            .find(|line| step_of(line).as_deref() == Some(step.as_str()))
            .map_or("", String::as_str);
        let _ = writeln!(
            report,
            "DIVERGES{} {} {first}",
            if listed { " (listed)" } else { "" },
            case.name
        );
    }
    problems
}

#[derive(Default)]
struct DifferentialTally {
    runs: usize,
    compared: usize,
    rejected: usize,
    tolerated: usize,
    listed: usize,
    failing_runs: usize,
}

/// Runs the differential driver, seeds `1..=seeds`, over every selected case it edits.
pub fn differential(
    library: &FontLibrary,
    files: &dyn Files,
    cases: &[Case],
    seeds: u64,
    steps: usize,
) -> Outcome {
    let known = files.read(KNOWN_DIVERGENCES);
    let mut report = String::new();
    let mut tally = DifferentialTally::default();
    let edited = cases
        .iter()
        .filter(|case| case.fuzz && library.missing(case.font_keys()).is_empty());
    for case in edited {
        for seed in 1..=seeds {
            tally.runs += 1;
            let clean = run_seed(library, &known, case, seed, steps, &mut tally, &mut report);
            tally.failing_runs += usize::from(!clean);
        }
    }
    let _ = writeln!(
        report,
        "differential: {} runs of up to {steps} requests, {} requests compared with cold, {} rejected by both engines, {} differing only on lanes in {KNOWN_DIVERGENCES}, {} requests differing as listed there, {} runs with an unlisted divergence",
        tally.runs,
        tally.compared,
        tally.rejected,
        tally.tolerated,
        tally.listed,
        tally.failing_runs,
    );
    Outcome {
        passed: tally.failing_runs == 0,
        report,
    }
}

/// One run of one seed. Returns whether every divergence it found is a listed one.
fn run_seed(
    library: &FontLibrary,
    known: &str,
    case: &Case,
    seed: u64,
    steps: usize,
    tally: &mut DifferentialTally,
    report: &mut String,
) -> bool {
    let listed = known_seed_steps(known, &case.name, seed);
    let run = match fuzz::fuzz(
        library,
        case,
        seed,
        steps,
        &fuzz::known_lanes(known),
        &listed,
    ) {
        Ok(run) => run,
        Err(error) => {
            let _ = writeln!(report, "FAIL {} seed {seed}: {error}", case.name);
            return false;
        }
    };
    tally.compared += run.steps;
    tally.rejected += run.rejected;
    tally.tolerated += run.known_divergent;
    let is_listed = |failure: &fuzz::Failure| {
        listed
            .iter()
            .any(|(step, lane)| *step == failure.step && *lane == failure.lane)
    };
    let (expected, unexpected): (Vec<_>, Vec<_>) = run.failures.iter().partition(|f| is_listed(f));
    tally.listed += expected.len();
    for failure in &unexpected {
        let _ = writeln!(
            report,
            "fuzz {} seed {seed}{}",
            case.name,
            failure.render(&case.name, seed)
        );
        let _ = writeln!(
            report,
            "to list it: seed {} {seed} {} {}",
            case.name, failure.step, failure.lane
        );
    }
    for (step, lane) in listed.iter().filter(|(step, _)| *step < steps) {
        if !expected.iter().any(|f| f.step == *step && f.lane == *lane) {
            let _ = writeln!(
                report,
                "NOTE {} seed {seed} step {step} ({lane}) is listed as a known divergence and no longer differs",
                case.name
            );
        }
    }
    unexpected.is_empty()
}
