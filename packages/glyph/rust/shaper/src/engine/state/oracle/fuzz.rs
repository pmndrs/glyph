//! The seeded differential driver: change a paragraph the way an editor does and require every
//! step to equal a cold layout of the same input.
//!
//! One step is one request and usually carries several changes, because a host that defers
//! preparation coalesces everything between two reads. Changes are text edits at offsets chosen
//! to land on what layout keys on (line edges, 64-cluster block edges, span and script
//! boundaries, the inside of a grapheme), width changes that cross breaks, metric changes and
//! span edits. A failure is replayed from progressively later cold starts to find the shortest
//! history that still reproduces it.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};

use crate::{
    bidi::{DIRECTION_AUTO, DIRECTION_LTR, DIRECTION_RTL},
    engine::frame::{
        ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START, DECORATION_DOUBLE,
        DECORATION_LINE_THROUGH, DECORATION_SOLID, DECORATION_UNDERLINE, OVERFLOW_ELLIPSIS,
        OVERFLOW_VISIBLE, SEMANTIC_VIEW_MEASUREMENT,
    },
};

use super::{
    capture::capture,
    corpus::{self, FRAGMENTS, Script},
    fonts::FontLibrary,
    lanes::{Capture, LaneClass, LaneDifference, cache_differences, differences},
    matrix::Case,
    model::{Decoration, Model, Span, SpanStyle, TextEdit},
    rng::Rng,
    session::{ALL_VIEWS, Route, Session},
};

/// One request: the model it produces, the text edits that get there, and the route it takes.
#[derive(Clone, Debug)]
pub struct Planned {
    pub label: String,
    pub next: Model,
    pub edits: Vec<TextEdit>,
    pub route: Route,
}

/// Offsets worth editing at, read from the last capture.
#[derive(Default)]
struct Hints {
    line_edges: Vec<u32>,
    block_edges: Vec<u32>,
    script_edges: Vec<u32>,
    hard_breaks: Vec<u32>,
}

impl Hints {
    fn new(capture: &Capture, text: &[u16]) -> Self {
        let mut line_edges = capture.u32_rows("flow.fragment.text_start");
        line_edges.extend(capture.u32_rows("flow.fragment.text_end"));
        let clusters = capture.u32_rows("cluster.text_start");
        // The run-local block cut and the chunk summaries are both every 64 clusters.
        let block_edges = (1..)
            .map(|block| block * 64)
            .take_while(|edge| *edge < clusters.len() + 2)
            .flat_map(|edge| [edge - 1, edge, edge + 1])
            .filter_map(|cluster| clusters.get(cluster).copied())
            .collect();
        Self {
            line_edges,
            block_edges,
            script_edges: capture.u32_rows("unicode.script_item.text_start"),
            hard_breaks: text
                .iter()
                .enumerate()
                .filter(|(_, unit)| **unit == u16::from(b'\n'))
                .map(|(index, _)| index as u32)
                .collect(),
        }
    }
}

struct Planner<'a> {
    script: Script,
    stack_count: usize,
    /// Whether the case was added after the first reference set was frozen. The operations
    /// added since draw from the generator only for such a case, so an earlier case plans
    /// exactly the requests it was frozen with.
    extended: bool,
    hints: &'a Hints,
    rng: &'a mut Rng,
    next: Model,
    edits: Vec<TextEdit>,
    labels: Vec<String>,
}

/// Plans one request against `model`.
fn plan(case: &Case, model: &Model, hints: &Hints, rng: &mut Rng) -> Planned {
    let changes = if rng.chance(3, 5) {
        1
    } else {
        2 + rng.below(3)
    };
    let mut planner = Planner {
        script: case.script,
        stack_count: case.stacks.len(),
        extended: case.extended,
        hints,
        rng,
        next: model.clone(),
        edits: Vec::new(),
        labels: Vec::new(),
    };
    for _ in 0..changes {
        planner.change();
    }
    let route = planner.route();
    Planned {
        label: planner.labels.join(" + "),
        next: planner.next,
        edits: planner.edits,
        route,
    }
}

impl Planner<'_> {
    fn route(&mut self) -> Route {
        Route {
            view_mask: *self
                .rng
                .pick(&[ALL_VIEWS, SEMANTIC_VIEW_MEASUREMENT, 0])
                .unwrap_or(&ALL_VIEWS),
            measure_first: self.rng.chance(1, 4),
            measure_after: self.rng.chance(1, 2),
        }
    }

    fn change(&mut self) {
        if self.extended && self.rng.chance(1, 3) {
            return self.paint();
        }
        match self.rng.below(20) {
            0..=4 => self.insert(),
            5..=7 => self.delete(),
            8..=9 => self.replace_same_length(),
            10 => self.flip_case(),
            11..=13 => self.width(),
            14 => self.metric(),
            15 => self.alignment(),
            16 => self.line_limit(),
            17 => self.direction(),
            _ => self.span(),
        }
    }

    fn label(&mut self, text: String) {
        self.labels.push(text);
    }

    /// Changes one paint field of the root style or of one span.
    fn paint(&mut self) {
        let span = match self.next.spans.len() {
            0 => None,
            count => self.rng.chance(1, 2).then(|| self.rng.below(count)),
        };
        let mut paint = match span {
            Some(index) => self.next.spans[index].style.paint,
            None => self.next.root.paint,
        };
        let colour = [0xff20_20e0, 0xffe0_6020, 0x8040_4040][self.rng.below(3)];
        let what = match self.rng.below(6) {
            0 => {
                paint.material = [None, Some(1), Some(2), Some(3)][self.rng.below(4)];
                "material"
            }
            1 => {
                paint.decoration = self.decoration(colour);
                "decoration"
            }
            2 => {
                paint.outline = [None, Some((colour, 1.0)), Some((colour, 2.5))][self.rng.below(3)];
                "outline"
            }
            3 => {
                paint.shadow =
                    [None, Some((colour, 1.0, 1.0)), Some((colour, -2.0, 0.5))][self.rng.below(3)];
                "shadow"
            }
            4 => {
                paint.opacity = [None, Some(0.5), Some(0.25)][self.rng.below(3)];
                "opacity"
            }
            _ => {
                paint.foreground = [None, Some(colour)][self.rng.below(2)];
                "foreground"
            }
        };
        match span {
            Some(index) => {
                self.next.spans[index].style.paint = paint;
                self.label(format!("{what} of span {}", self.next.spans[index].id));
            }
            None => {
                self.next.root.paint = paint;
                self.label(format!("{what} of the root"));
            }
        }
    }

    fn decoration(&mut self, rgba: u32) -> Option<Decoration> {
        let flags = [
            0,
            DECORATION_UNDERLINE,
            DECORATION_LINE_THROUGH,
            DECORATION_UNDERLINE | DECORATION_LINE_THROUGH,
        ][self.rng.below(4)];
        (flags != 0).then(|| Decoration {
            flags,
            style: [DECORATION_SOLID, DECORATION_DOUBLE][self.rng.below(2)],
            rgba,
            thickness: [1.0, 2.0][self.rng.below(2)],
            offset: 0.0,
        })
    }

    /// A code-point boundary of the current text, from one of the offset strategies.
    fn offset(&mut self) -> u32 {
        let length = self.next.text.len() as u32;
        let hints = self.hints;
        let span_edges: Vec<u32> = self
            .next
            .spans
            .iter()
            .flat_map(|span| [span.start, span.end])
            .collect();
        let pool: &[u32] = match self.rng.below(9) {
            0 | 1 => &hints.line_edges,
            2 => &hints.block_edges,
            3 => &hints.script_edges,
            4 => &span_edges,
            5 => &hints.hard_breaks,
            _ => &[],
        };
        let picked = match self.rng.pick(pool) {
            // One unit either side of the edge as often as the edge itself.
            Some(edge) => (edge + self.rng.below(3) as u32).saturating_sub(1),
            None if self.rng.chance(1, 8) => [0, length][self.rng.below(2)],
            None => self.rng.below(length as usize + 1) as u32,
        };
        snap(&self.next.text, picked.min(length))
    }

    fn edit(&mut self, start: u32, delete: u32, insert: Vec<u16>) {
        let edit = TextEdit {
            start,
            delete,
            insert,
        };
        edit.apply(&mut self.next.text);
        remap_spans(&mut self.next.spans, &edit, &self.next.text);
        self.edits.push(edit);
    }

    fn insert(&mut self) {
        let start = self.offset();
        let kind = *self.rng.pick(&FRAGMENTS).unwrap_or(&FRAGMENTS[0]);
        let text = if self.rng.chance(1, 12) {
            // A paste: several words, a hard break and a word from another script.
            let mut pasted = corpus::paragraph(self.script, self.rng.next_u64(), 12);
            pasted.extend(corpus::fragment(
                self.script,
                corpus::Fragment::Foreign,
                self.rng,
            ));
            pasted
        } else {
            corpus::fragment(self.script, kind, self.rng)
        };
        self.label(format!("insert {kind:?} ({} units) at {start}", text.len()));
        self.edit(start, 0, text);
    }

    fn delete(&mut self) {
        let start = self.offset();
        let wanted = match self.rng.below(10) {
            0 => 200,
            1 => self.next.text.len(),
            _ => 1 + self.rng.below(8),
        };
        let end = snap(
            &self.next.text,
            (start as usize + wanted).min(self.next.text.len()) as u32,
        );
        if end > start {
            self.label(format!("delete {} at {start}", end - start));
            self.edit(start, end - start, Vec::new());
        }
    }

    fn replace_same_length(&mut self) {
        let start = self.offset();
        let end = snap(
            &self.next.text,
            (start as usize + 1 + self.rng.below(6)).min(self.next.text.len()) as u32,
        );
        if end > start {
            let text = corpus::same_length(self.script, (end - start) as usize, self.rng);
            self.label(format!("replace {} at {start}", end - start));
            self.edit(start, end - start, text);
        }
    }

    /// Changes the case of the next ASCII letter: in a font with case-sensitive forms this
    /// reshapes punctuation arbitrarily far to its right.
    fn flip_case(&mut self) {
        let from = self.offset() as usize;
        let found = self.next.text[from..]
            .iter()
            .position(|unit| u8::try_from(*unit).is_ok_and(|byte| byte.is_ascii_alphabetic()));
        if let Some(offset) = found {
            let at = from + offset;
            let flipped = self.next.text[at] ^ 0x20;
            self.label(format!("flip case at {at}"));
            self.edit(at as u32, 1, alloc::vec![flipped]);
        }
    }

    fn width(&mut self) {
        let current = self.next.layout.width;
        let width = match self.rng.below(8) {
            0 => current + 1.0 / 64.0,
            1 => (current - 1.0).max(1.0),
            2 => current + 7.0,
            3 => (current - 33.0).max(1.0),
            4 => 0.0,
            _ => 60.0 + self.rng.below(840) as f32 + self.rng.below(4) as f32 * 0.25,
        };
        self.label(format!("width {width}"));
        self.next.layout.width = width;
    }

    fn metric(&mut self) {
        let root = &mut self.next.root;
        match self.rng.below(4) {
            0 => root.font_size = [8.0, 11.5, 16.0, 24.0, 40.0][self.rng.below(5)],
            1 => root.letter_spacing = [0.0, 0.5, -0.25, 2.0][self.rng.below(4)],
            2 => root.line_height = [1.0, 1.2, 1.6][self.rng.below(3)],
            _ => root.word_spacing = [0.0, 3.0][self.rng.below(2)],
        }
        let root = self.next.root;
        self.label(format!(
            "metrics size {} spacing {} line {} word {}",
            root.font_size, root.letter_spacing, root.line_height, root.word_spacing
        ));
    }

    fn alignment(&mut self) {
        let align = [ALIGN_START, ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY][self.rng.below(4)];
        self.next.layout.align = align;
        self.next.layout.justify_last_line = self.rng.chance(1, 4);
        self.label(format!("align {align}"));
    }

    fn line_limit(&mut self) {
        let max_lines = [0, 3, 12][self.rng.below(3)];
        self.next.layout.max_lines = max_lines;
        self.next.layout.overflow = if max_lines != 0 && self.rng.chance(2, 3) {
            OVERFLOW_ELLIPSIS
        } else {
            OVERFLOW_VISIBLE
        };
        self.label(format!("max lines {max_lines}"));
    }

    fn direction(&mut self) {
        let direction = [DIRECTION_AUTO, DIRECTION_LTR, DIRECTION_RTL][self.rng.below(3)];
        self.next.root.direction = direction;
        self.label(format!("direction {direction}"));
    }

    fn span(&mut self) {
        let boundaries = corpus::grapheme_boundaries(&self.next.text);
        let count = self.next.spans.len();
        match self.rng.below(4) {
            0 if count != 0 => {
                let removed = self.next.spans.remove(self.rng.below(count));
                self.label(format!("remove span {}", removed.id));
            }
            1 if count != 0 => {
                let index = self.rng.below(count);
                self.next.spans[index].style = self.span_style();
                self.label(format!("restyle span {}", self.next.spans[index].id));
            }
            _ if boundaries.len() > 2 => {
                let first = self.rng.below(boundaries.len() - 1);
                let reach = 1 + self.rng.below(40.min(boundaries.len() - 1 - first));
                let span = Span {
                    id: self
                        .next
                        .spans
                        .iter()
                        .map(|span| span.id)
                        .max()
                        .unwrap_or(1)
                        + 1,
                    start: boundaries[first],
                    end: boundaries[first + reach],
                    style: self.span_style(),
                };
                if nests(&self.next.spans, span) {
                    self.label(format!("add span {}..{}", span.start, span.end));
                    self.next.spans.push(span);
                }
            }
            _ => {}
        }
    }

    fn span_style(&mut self) -> SpanStyle {
        let mut style = SpanStyle::default();
        match self.rng.below(6) {
            0 => style.font_size = Some([9.0, 13.0, 22.0][self.rng.below(3)]),
            1 => style.letter_spacing = Some([1.0, -0.5][self.rng.below(2)]),
            2 => style.baseline_shift = Some(3.0),
            3 => style.foreground = Some(0xff20_40c0),
            4 if self.stack_count > 1 => style.font_stack = Some(1),
            _ => style.underline = true,
        }
        style
    }
}

/// The nearest code-point boundary at or before `offset`.
fn snap(text: &[u16], offset: u32) -> u32 {
    let at = offset as usize;
    let splits_pair = at > 0
        && at < text.len()
        && (0xdc00..0xe000).contains(&text[at])
        && (0xd800..0xdc00).contains(&text[at - 1]);
    offset - u32::from(splits_pair)
}

/// Whether `span` is disjoint from, inside, or around every existing span.
fn nests(spans: &[Span], span: Span) -> bool {
    spans.iter().all(|other| {
        let disjoint = span.end <= other.start || span.start >= other.end;
        let inside = span.start >= other.start && span.end <= other.end;
        let around = span.start <= other.start && span.end >= other.end;
        (disjoint || inside || around) && (span.start, span.end) != (other.start, other.end)
    })
}

/// Carries spans across a text edit the way a host does: shift what follows the edit, clamp
/// what it cut into, snap to grapheme boundaries of the new text, and drop what collapsed.
pub fn remap_spans(spans: &mut Vec<Span>, edit: &TextEdit, text: &[u16]) {
    let boundaries = corpus::grapheme_boundaries(text);
    let inserted = edit.insert.len() as u32;
    let map = |offset: u32| {
        let moved = if offset <= edit.start {
            offset
        } else if offset >= edit.start + edit.delete {
            offset - edit.delete + inserted
        } else {
            edit.start + inserted
        };
        let index = boundaries.partition_point(|boundary| *boundary <= moved);
        boundaries
            .get(index.saturating_sub(1))
            .copied()
            .unwrap_or(0)
    };
    let mut kept: Vec<Span> = Vec::with_capacity(spans.len());
    for span in spans.iter() {
        let moved = Span {
            start: map(span.start),
            end: map(span.end),
            ..*span
        };
        if moved.start < moved.end && nests(&kept, moved) {
            kept.push(moved);
        }
    }
    *spans = kept;
}

/// A step where incremental and cold disagree.
#[derive(Clone, Debug)]
pub struct Failure {
    pub step: usize,
    pub label: String,
    /// The first differing lane, or `outcome` when one side rejected the request.
    pub lane: String,
    /// The failure reproduces from a cold layout after this many steps of the same seed.
    /// Not computed for a divergence the caller listed as known.
    pub replay_from: Option<usize>,
    pub details: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct FuzzReport {
    pub steps: usize,
    /// Requests both engines rejected identically.
    pub rejected: usize,
    /// The distinct reasons behind `rejected`.
    pub rejections: Vec<String>,
    /// Steps where one side used the inline owner and the other did not: only public lanes
    /// were compared.
    pub owner_divergent: usize,
    /// Steps that differed from cold only on lanes listed as known divergences.
    pub known_divergent: usize,
    pub known_lanes: Vec<String>,
    /// Every step that differed from cold. The run continues past each from a cold layout of
    /// the model the step produced, so one divergence does not hide the steps after it.
    pub failures: Vec<Failure>,
}

impl FuzzReport {
    pub fn render(&self, case: &str, seed: u64) -> String {
        let mut text = format!(
            "fuzz {case} seed {seed}: {} steps, {} rejected by both, {} compared on public lanes only, {} with known divergences, {} divergent",
            self.steps,
            self.rejected,
            self.owner_divergent,
            self.known_divergent,
            self.failures.len()
        );
        if !self.rejections.is_empty() {
            text.push_str(&format!("\nrejected as: {}", self.rejections.join("; ")));
        }
        if !self.known_lanes.is_empty() {
            text.push_str(&format!(
                "\nknown divergent lanes hit: {}",
                self.known_lanes.join(", ")
            ));
        }
        for failure in &self.failures {
            text.push_str(&failure.render(case, seed));
        }
        text
    }
}

impl Failure {
    pub fn render(&self, case: &str, seed: u64) -> String {
        let mut text = format!("\nFAIL at step {} ({})", self.step, self.label);
        if let Some(from) = self.replay_from {
            text.push_str(&format!(
                "; reproduces from a cold layout after step {from}"
            ));
        }
        for detail in &self.details {
            text.push_str("\n  ");
            text.push_str(detail);
        }
        text.push_str(&format!(
            "\nreplay: layout-oracle fuzz --case {case} --seed {seed} --steps {}",
            self.step + 1
        ));
        text
    }
}

/// Lanes a host can read back; the only ones compared when the two sides chose different
/// owners, which keep different internals by design.
const PUBLIC_PREFIXES: [&str; 8] = [
    "public.", "view.", "gather.", "gpu.", "text.", "unicode.", "bidi.", "style.",
];

/// The lanes that must agree between an edit history and a cold layout, as differences, and
/// whether both sides used the same owner.
pub fn incremental_differences(warm: &Capture, cold: &Capture) -> (Vec<LaneDifference>, bool) {
    let same_owner = warm.lane("owner.inline") == cold.lane("owner.inline");
    // A publication returns semantic views only for what it prepared. A request that changes
    // nothing returns none, and the measurement lanes carry that comparison instead.
    let unprepared = warm
        .lane("view.published.kind")
        .is_none_or(|lane| lane.rows() == 0);
    let mut found: Vec<LaneDifference> = differences(warm, cold, LaneClass::history_independent)
        .into_iter()
        .filter(|difference| {
            same_owner
                || PUBLIC_PREFIXES
                    .iter()
                    .any(|prefix| difference.lane.starts_with(prefix))
        })
        .filter(|difference| !(unprepared && difference.lane.starts_with("view.published.")))
        .collect();
    found.extend(cache_differences(warm, cold));
    (found, same_owner)
}

/// Lane prefixes on which the current engine is known to differ from cold, one per line with
/// a reason after the first space. They are counted and reported, never silently dropped.
pub fn known_lanes(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_whitespace().next())
        .filter(|entry| !matches!(*entry, "seed" | "step"))
        .collect()
}

enum Outcome {
    Equal {
        same_owner: bool,
        capture: Capture,
        /// Known-divergent lanes that differed on this step.
        known: Vec<String>,
    },
    Rejected(String),
    Different(Vec<String>),
}

/// Applies `planned` to `warm` and compares the result with a cold layout of the same model.
fn check(
    library: &FontLibrary,
    stacks: &[&[&str]],
    warm: &mut Session,
    planned: &Planned,
    known: &[&str],
) -> Result<Outcome, String> {
    let warm_result = warm.step(&planned.next, &planned.edits, planned.route);
    let mut cold = Session::new(library, stacks)?;
    let cold_result = cold.step(&planned.next, &[], planned.route);
    match (warm_result, cold_result) {
        (Ok(warm_output), Ok(cold_output)) => {
            let warm_capture = capture(warm, &warm_output)?;
            let cold_capture = capture(&cold, &cold_output)?;
            let (found, same_owner) = incremental_differences(&warm_capture, &cold_capture);
            let (tolerated, found): (Vec<_>, Vec<_>) = found
                .into_iter()
                .partition(|d| known.iter().any(|prefix| d.lane.starts_with(prefix)));
            if found.is_empty() {
                Ok(Outcome::Equal {
                    same_owner,
                    capture: warm_capture,
                    known: tolerated.into_iter().map(|d| d.lane).collect(),
                })
            } else {
                Ok(Outcome::Different(
                    found.iter().map(LaneDifference::render).collect(),
                ))
            }
        }
        (Err(warm_error), Err(cold_error)) if warm_error == cold_error => {
            Ok(Outcome::Rejected(warm_error))
        }
        (warm_result, cold_result) => {
            let finding = format!(
                "outcome: incremental {} but cold {}",
                outcome_text(warm_result.err()),
                outcome_text(cold_result.err())
            );
            Ok(Outcome::Different(alloc::vec![finding]))
        }
    }
}

fn outcome_text(error: Option<String>) -> String {
    error.map_or_else(
        || "succeeded".to_string(),
        |error| format!("failed with {error}"),
    )
}

fn cold_session(
    library: &FontLibrary,
    stacks: &[&[&str]],
    model: &Model,
) -> Result<(Session, Capture), String> {
    let mut session = Session::new(library, stacks)?;
    let output = session.step(model, &[], Route::FULL)?;
    let capture = capture(&session, &output)?;
    Ok((session, capture))
}

/// Runs `steps` requests of `seed` against `case`.
pub fn fuzz(
    library: &FontLibrary,
    case: &Case,
    seed: u64,
    steps: usize,
    known: &[&str],
    listed: &[(usize, String)],
) -> Result<FuzzReport, String> {
    let stacks: Vec<&[&str]> = case.stacks.iter().map(Vec::as_slice).collect();
    // Mixing in the case name gives every case its own sequence under one seed.
    let mut rng = Rng::new(seed ^ super::lanes::digest(case.name.as_bytes()));
    let (warm, last) = cold_session(library, &stacks, &case.model)?;
    let mut run = Run {
        library,
        stacks: &stacks,
        known,
        listed,
        warm,
        last,
        models: Vec::new(),
        history: Vec::new(),
        origin: 0,
        report: FuzzReport::default(),
    };
    for step in 0..steps {
        let model = run.warm.model().cloned().unwrap_or_default();
        let hints = Hints::new(&run.last, &model.text);
        let planned = plan(case, &model, &hints, &mut rng);
        run.step(step, model, planned)?;
    }
    Ok(run.report)
}

/// One differential run in progress.
struct Run<'a> {
    library: &'a FontLibrary,
    stacks: &'a [&'a [&'a str]],
    known: &'a [&'a str],
    listed: &'a [(usize, String)],
    warm: Session,
    /// The capture after the last accepted step: where the next step finds its offsets.
    last: Capture,
    /// `models[n]` is the model before `history[n]`; together they replay the run since
    /// `origin`, the step at which the engine was last restarted cold.
    models: Vec<Model>,
    history: Vec<Planned>,
    origin: usize,
    report: FuzzReport,
}

impl Run<'_> {
    fn step(&mut self, step: usize, model: Model, planned: Planned) -> Result<(), String> {
        self.models.push(model.clone());
        self.history.push(planned.clone());
        self.report.steps = step + 1;
        let outcome = check(
            self.library,
            self.stacks,
            &mut self.warm,
            &planned,
            self.known,
        )?;
        match outcome {
            Outcome::Equal {
                same_owner,
                capture,
                known,
            } => {
                self.report.owner_divergent += usize::from(!same_owner);
                self.report.known_divergent += usize::from(!known.is_empty());
                for lane in known {
                    push_unique(&mut self.report.known_lanes, lane);
                }
                self.last = capture;
                Ok(())
            }
            Outcome::Rejected(reason) => {
                push_unique(&mut self.report.rejections, reason);
                self.report.rejected += 1;
                // A rejected request leaves the root unusable; a host replays its accepted
                // values, which is a cold layout of the model before the step.
                self.restart(step, &model, &model)
            }
            Outcome::Different(details) => {
                let failure = self.failure(step, &model, &planned, details);
                self.report.failures.push(failure);
                // Continue from a cold layout of the new model, or of the model before the
                // step when cold rejects the new one.
                self.restart(step, &planned.next, &model)
            }
        }
    }

    fn failure(
        &self,
        step: usize,
        model: &Model,
        planned: &Planned,
        mut details: Vec<String>,
    ) -> Failure {
        let lane = details
            .first()
            .and_then(|detail| detail.split_whitespace().next())
            .map_or_else(String::new, |lane| lane.trim_end_matches(':').to_string());
        let listed = self
            .listed
            .iter()
            .any(|(at, known)| *at == step && *known == lane);
        // Locating and describing a divergence replays the run, so a listed one skips both.
        let replay_from = (!listed).then(|| {
            self.origin
                + shortest_replay(
                    self.library,
                    self.stacks,
                    &self.models,
                    &self.history,
                    self.known,
                )
        });
        if !listed {
            details.push(format!("before: {}", describe(model)));
            details.push(format!("after:  {}", describe(&planned.next)));
            details.push(format!("edits:  {:?}", planned.edits));
            details.push(format!("text before: {}", escaped(&model.text)));
            details.push(format!("route:  {:?}", planned.route));
        }
        Failure {
            step,
            label: planned.label.clone(),
            lane,
            replay_from,
            details,
        }
    }

    /// Replaces the engine with a cold layout of `model`, or of `fallback` if that fails.
    fn restart(&mut self, step: usize, model: &Model, fallback: &Model) -> Result<(), String> {
        (self.warm, self.last) = match cold_session(self.library, self.stacks, model) {
            Ok(restarted) => restarted,
            Err(_) => cold_session(self.library, self.stacks, fallback)?,
        };
        self.history.clear();
        self.models.clear();
        self.origin = step + 1;
        Ok(())
    }
}

fn push_unique(list: &mut Vec<String>, item: String) {
    if !list.contains(&item) {
        list.push(item);
    }
}

/// Text as a Rust string literal body, so a failure can be pasted into a fixture.
fn escaped(text: &[u16]) -> String {
    String::from_utf16_lossy(text).escape_unicode().to_string()
}

/// Everything about a model except its text.
fn describe(model: &Model) -> String {
    format!(
        "{} units, root {:?}, layout {:?}, spans {:?}",
        model.text.len(),
        model.root,
        model.layout,
        model.spans
    )
}

/// The latest step after which a cold start still reproduces the final step's failure:
/// tries one step of history, then two, four, and so on back to the whole run.
fn shortest_replay(
    library: &FontLibrary,
    stacks: &[&[&str]],
    models: &[Model],
    history: &[Planned],
    known: &[&str],
) -> usize {
    let last = history.len() - 1;
    let mut back = 0;
    loop {
        let start = last.saturating_sub(back);
        if start == 0 || replay_fails(library, stacks, &models[start], &history[start..], known) {
            return start;
        }
        back = (back * 2).max(1);
    }
}

fn replay_fails(
    library: &FontLibrary,
    stacks: &[&[&str]],
    start: &Model,
    steps: &[Planned],
    known: &[&str],
) -> bool {
    let Ok((mut warm, _)) = cold_session(library, stacks, start) else {
        return false;
    };
    let Some((last, earlier)) = steps.split_last() else {
        return false;
    };
    for planned in earlier {
        if warm
            .step(&planned.next, &planned.edits, planned.route)
            .is_err()
        {
            return false;
        }
    }
    matches!(
        check(library, stacks, &mut warm, last, known),
        Ok(Outcome::Different(_))
    )
}

/// The first `count` requests `seed` plans against `case`, for freezing an edited sequence.
/// Each is planned against the model the one before it produced, with no engine in the loop,
/// so the sequence depends only on the seed and the case.
pub fn scripted(case: &Case, seed: u64, count: usize) -> Vec<Planned> {
    let mut rng = Rng::new(seed);
    let hints = Hints::default();
    let mut model = case.model.clone();
    let mut planned = Vec::with_capacity(count);
    for _ in 0..count {
        let mut step = plan(case, &model, &hints, &mut rng);
        step.route = Route::FULL;
        model = step.next.clone();
        planned.push(step);
    }
    planned
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(id: u32, start: u32, end: u32) -> Span {
        Span {
            id,
            start,
            end,
            style: SpanStyle::default(),
        }
    }

    #[test]
    fn spans_follow_an_edit_and_never_split_a_grapheme_or_cross() {
        // "ab e\u{301} cd": the fourth grapheme is two units.
        let mut text: Vec<u16> = "ab e\u{301} cd".encode_utf16().collect();
        let mut spans = alloc::vec![span(2, 0, 2), span(3, 3, 5), span(4, 6, 8)];
        let edit = TextEdit {
            start: 4,
            delete: 1,
            insert: "xyz".encode_utf16().collect(),
        };
        edit.apply(&mut text);
        remap_spans(&mut spans, &edit, &text);
        assert_eq!(
            spans,
            [span(2, 0, 2), span(3, 3, 7), span(4, 8, 10)],
            "before the edit unchanged, around it widened, after it shifted"
        );

        // Deleting everything a span covered drops it; the rest stay nested or disjoint.
        let wipe = TextEdit {
            start: 3,
            delete: 4,
            insert: Vec::new(),
        };
        wipe.apply(&mut text);
        remap_spans(&mut spans, &wipe, &text);
        assert_eq!(spans, [span(2, 0, 2), span(4, 4, 6)]);
        assert!(!nests(&spans, span(9, 1, 5)), "a crossing span is refused");
        assert!(nests(&spans, span(9, 0, 6)), "an enclosing span is allowed");
    }

    #[test]
    fn offsets_snap_off_the_middle_of_a_surrogate_pair() {
        let text: Vec<u16> = "a\u{1f600}b".encode_utf16().collect();
        assert_eq!(
            [0, 1, 2, 3, 4].map(|offset| snap(&text, offset)),
            [0, 1, 1, 3, 4]
        );
    }
}
