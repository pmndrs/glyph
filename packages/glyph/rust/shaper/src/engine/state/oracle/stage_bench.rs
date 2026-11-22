//! Stage clocks for run-local geometry, the cluster build, positioning and measurement,
//! runnable inside the optimized wasm32 build.
//!
//! Evidence tooling, not a benchmark protocol: it times the run-local stage alone on a real
//! paragraph (the calls the engine makes for a cold build, a metric change and a line-height
//! change), the cluster stage's self-time inside real edits, and the whole engine step around
//! them, so a rewrite of a stage can be read against the code it replaces. `bench layout` times
//! whole steps per change class and reads the positioning and measurement self-time out of
//! [`clock`]. Behind the `stage-bench` feature; no shipped artifact carries it.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};

use crate::engine::{
    cluster_state::LAYOUT_CHUNK,
    frame::{ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START},
    run_local::Inherited,
};

use super::{
    super::{ParagraphState, PreparedLayout},
    corpus::{self, Script},
    fonts::FontLibrary,
    model::{Exclusion, Layout, Model, PARAGRAPH_ID, ROOT_ID, RootStyle, TextEdit},
    session::{Route, Session},
};

/// Self-time accumulators the timed stages add to. A stage opens a guard at its entry; the
/// bench drains the total around one engine step.
pub(crate) mod clock {
    use core::sync::atomic::{AtomicU64, Ordering};

    pub(crate) struct Stage(AtomicU64);

    pub(crate) static POSITIONING: Stage = Stage(AtomicU64::new(0));
    pub(crate) static MEASUREMENT: Stage = Stage(AtomicU64::new(0));
    /// Unicode analysis of a candidate text: classes, line breaks, graphemes and scripts.
    pub(crate) static UNICODE: Stage = Stage(AtomicU64::new(0));
    pub(crate) static BIDI: Stage = Stage(AtomicU64::new(0));

    pub(crate) struct Guard(&'static Stage, f64);

    impl Stage {
        pub(crate) fn guard(&'static self) -> Guard {
            Guard(self, super::now())
        }

        /// Milliseconds accumulated since the last drain.
        pub(crate) fn take(&self) -> f64 {
            f64::from_bits(self.0.swap(0, Ordering::Relaxed))
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let elapsed = super::now() - self.1;
            let total = f64::from_bits(self.0.0.load(Ordering::Relaxed)) + elapsed;
            self.0.0.store(total.to_bits(), Ordering::Relaxed);
        }
    }
}

/// Self-time of the cluster stage's entry points since the last `take`, in milliseconds as
/// f64 bits. The probe is single-threaded; the atomic only makes the static safe to name.
static CLUSTER_STAGE: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);

/// Adds the time from construction to drop to the cluster stage's clock. The cluster arena
/// holds one across each entry point that derives cluster lanes; none of them nests.
pub(crate) struct ClusterStageClock(f64);

impl ClusterStageClock {
    pub(crate) fn start() -> Self {
        Self(now())
    }
}

impl Drop for ClusterStageClock {
    fn drop(&mut self) {
        use core::sync::atomic::Ordering::Relaxed;
        let total = f64::from_bits(CLUSTER_STAGE.load(Relaxed)) + (now() - self.0);
        CLUSTER_STAGE.store(total.to_bits(), Relaxed);
    }
}

fn take_cluster_stage() -> f64 {
    f64::from_bits(CLUSTER_STAGE.swap(0, core::sync::atomic::Ordering::Relaxed))
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// Milliseconds from the host's monotonic clock.
    fn pmndrs_glyph_stage_bench_now() -> f64;
}

#[cfg(target_arch = "wasm32")]
fn now() -> f64 {
    // SAFETY: the host import takes no arguments and returns a number.
    unsafe { pmndrs_glyph_stage_bench_now() }
}

#[cfg(all(not(target_arch = "wasm32"), feature = "std"))]
fn now() -> f64 {
    extern crate std;
    use std::{sync::OnceLock, time::Instant};
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1_000.0
}

#[cfg(all(not(target_arch = "wasm32"), not(feature = "std")))]
fn now() -> f64 {
    0.0
}

const ROUTE: Route = Route {
    view_mask: 0,
    measure_first: false,
    measure_after: false,
    ..Route::FULL
};

/// Microseconds: (median, minimum).
fn summary(samples: &mut [f64]) -> (f64, f64) {
    samples.sort_by(f64::total_cmp);
    let median = samples.get(samples.len() / 2).copied().unwrap_or(0.0);
    (
        median * 1_000.0,
        samples.first().copied().unwrap_or(0.0) * 1_000.0,
    )
}

fn row(report: &mut String, name: &str, samples: &mut [f64], glyphs: usize) {
    let (median, minimum) = summary(samples);
    let per_glyph = if glyphs == 0 {
        0.0
    } else {
        minimum * 1_000.0 / glyphs as f64
    };
    report.push_str(&format!(
        "{name}\t{median:.1}\t{minimum:.1}\t{per_glyph:.2}\n"
    ));
}

fn script(name: &str) -> Result<Script, String> {
    Ok(match name {
        "latin" => Script::Latin,
        "greek-cyrillic" => Script::GreekCyrillic,
        "arabic" => Script::Arabic,
        "hebrew" => Script::Hebrew,
        "devanagari" => Script::Devanagari,
        "thai" => Script::Thai,
        "hangul" => Script::Hangul,
        "emoji" => Script::Emoji,
        "cjk" => Script::Cjk,
        "mixed-bidi" => Script::MixedBidi,
        "code" => Script::Code,
        _ => return Err(format!("unknown script `{name}`")),
    })
}

/// `bench analysis <script> <graphemes> <iterations>`: the text analysis kernels alone on one
/// paragraph, as the engine calls them for a changed text. The per-glyph column is per UTF-16
/// unit here.
fn analysis(script: Script, graphemes: usize, iterations: usize) -> Result<String, String> {
    use crate::{
        bidi::{BidiAnalysis, DIRECTION_AUTO, DIRECTION_RTL, analyze_into},
        unicode::UnicodeAnalysis,
    };
    let text = corpus::paragraph(script, 7, graphemes);
    let mut unicode = UnicodeAnalysis::default();
    let mut bidi = BidiAnalysis::default();
    let mut report = String::new();
    let mut time = |name: &str, run: &mut dyn FnMut() -> Result<(), String>| {
        let mut samples = Vec::new();
        for _ in 0..iterations {
            let started = now();
            run()?;
            samples.push(now() - started);
        }
        row(&mut report, name, &mut samples, text.len());
        Ok::<(), String>(())
    };
    time("kernel.unicode", &mut || {
        unicode
            .analyze(&text)
            .map_err(|error| format!("unicode: {error:?}"))
    })?;
    time("kernel.unicode.scalar", &mut || {
        unicode
            .analyze_scalar(&text)
            .map_err(|error| format!("unicode: {error:?}"))
    })?;
    for (name, direction) in [
        ("kernel.bidi.auto", DIRECTION_AUTO),
        ("kernel.bidi.rtl", DIRECTION_RTL),
    ] {
        time(name, &mut || {
            analyze_into(&text, direction, &mut bidi).map_err(|error| format!("bidi: {error:?}"))
        })?;
    }
    unicode
        .analyze(&text)
        .map_err(|error| format!("unicode: {error:?}"))?;
    let coverage = unicode.kernel_coverage();
    Ok(format!(
        "ok\nshape\tunits {}\tresidue units {}\twindows {}\tbidi paragraphs {}\n{report}",
        coverage.units,
        coverage.residue_units,
        coverage.windows,
        bidi.paragraph_starts.len(),
    ))
}

fn paragraph_state(session: &mut Session) -> Result<&mut ParagraphState, String> {
    Ok(&mut session
        .engine
        .planners
        .get_mut(&ROOT_ID)
        .ok_or("root is missing")?
        .paragraph_mut(PARAGRAPH_ID)
        .ok_or("paragraph is missing")?
        .state)
}

/// `bench paragraph <font> <script> <graphemes> <iterations>` or
/// `bench labels <font> <script> <count> <iterations>`. Each answer line is
/// `name<TAB>median µs<TAB>minimum µs<TAB>minimum ns per glyph`.
pub fn command(library: &FontLibrary, fields: &[&str]) -> Result<String, String> {
    let number = |text: &str| {
        text.parse::<usize>()
            .map_err(|error| format!("`{text}` is not a number: {error}"))
    };
    match fields {
        ["paragraph", font, script_name, graphemes, iterations] => paragraph(
            library,
            font,
            script(script_name)?,
            number(graphemes)?,
            number(iterations)?,
        ),
        ["labels", font, script_name, count, iterations] => labels(
            library,
            font,
            script(script_name)?,
            number(count)?,
            number(iterations)?,
        ),
        ["layout", fixture, align, graphemes, iterations] => layout(
            library,
            fixture,
            align,
            number(graphemes)?,
            number(iterations)?,
        ),
        ["analysis", script_name, graphemes, iterations] => analysis(
            script(script_name)?,
            number(graphemes)?,
            number(iterations)?,
        ),
        _ => Err(
            "usage: bench paragraph|labels <font> <script> <size> <iterations> | bench layout \
             <fixture> <align> <size> <iterations> | bench analysis <script> <size> <iterations>"
                .to_string(),
        ),
    }
}

type Restyle = fn(&mut RootStyle);

fn paragraph(
    library: &FontLibrary,
    font: &str,
    script: Script,
    graphemes: usize,
    iterations: usize,
) -> Result<String, String> {
    let base = Model {
        text: corpus::paragraph(script, 7, graphemes),
        root: RootStyle {
            font_size: 24.0,
            ..RootStyle::default()
        },
        layout: Layout::default(),
        ..Model::default()
    };
    let restyled = |change: Restyle| {
        let mut next = base.clone();
        change(&mut next.root);
        next
    };
    let mut report = String::new();

    // `first+second` is a fallback stack: text the first font lacks shapes in the second.
    let stack: Vec<&str> = font.split('+').collect();
    let mut cold = Vec::new();
    let mut cold_clusters = Vec::new();
    for _ in 0..iterations.div_ceil(8).max(3) {
        let mut session = Session::new(library, &[&stack])?;
        take_cluster_stage();
        let started = now();
        session.step(&base, &[], ROUTE)?;
        cold.push(now() - started);
        cold_clusters.push(take_cluster_stage());
    }
    let mut session = Session::new(library, &[&stack])?;
    session.step(&base, &[], ROUTE)?;
    let glyphs = paragraph_state(&mut session)?
        .clusters
        .committed()
        .glyph_ids
        .len();
    let clusters = paragraph_state(&mut session)?
        .clusters
        .committed()
        .starts
        .len();
    let blocks = paragraph_state(&mut session)?
        .clusters
        .committed()
        .run_local()
        .blocks()
        .len();
    report.push_str(&format!(
        "shape\tglyphs {glyphs}\tclusters {clusters}\tblocks {blocks}\n"
    ));
    row(&mut report, "op.cold", &mut cold, glyphs);
    row(
        &mut report,
        "stage.cluster.cold",
        &mut cold_clusters,
        glyphs,
    );

    // 23.7 over a 1000- or 2048-unit em is not a dyadic scale.
    let changes: [(&str, Restyle); 3] = [
        ("op.font_size", |root| root.font_size = 23.7),
        ("op.letter_spacing", |root| root.letter_spacing = 0.35),
        ("op.line_height", |root| root.line_height = 1.45),
    ];
    for (name, change) in changes {
        let changed = restyled(change);
        let mut samples = Vec::new();
        for iteration in 0..iterations {
            let next = if iteration % 2 == 0 { &changed } else { &base };
            let started = now();
            session.step(next, &[], ROUTE)?;
            samples.push(now() - started);
        }
        if iterations % 2 == 1 {
            session.step(&base, &[], ROUTE)?;
        }
        row(&mut report, name, &mut samples, glyphs);
    }

    stage(&mut session, &mut report, iterations, glyphs)?;
    edits(&mut session, &mut report, &base, script, iterations, glyphs)?;
    Ok(format!("ok\n{report}"))
}

/// Text edits through the whole engine step, with the cluster stage's self-time inside each:
/// one grapheme typed mid-paragraph, three typed in one request at the quarter points, and the
/// whole text replaced by another of the same script. Each edit alternates with the edit that undoes it; only the
/// forward edit is reported.
fn edits(
    session: &mut Session,
    report: &mut String,
    base: &Model,
    script: Script,
    iterations: usize,
    glyphs: usize,
) -> Result<(), String> {
    let starts = paragraph_state(session)?
        .clusters
        .committed()
        .starts
        .clone();
    // Typing repeats the grapheme before the caret, so the edit stays in the paragraph's
    // script: (caret, the units typed).
    let typed = |numerator: usize| -> Result<(u32, Vec<u16>), String> {
        let from = (starts.len() * numerator / 4).max(1);
        (from..starts.len())
            .map(|cluster| (starts[cluster - 1] as usize, starts[cluster] as usize))
            .find(|(start, _)| !matches!(base.text[*start], 0x0a | 0x20))
            .map(|(start, end)| (end as u32, base.text[start..end].to_vec()))
            .ok_or_else(|| "the paragraph has no grapheme to repeat".to_string())
    };
    let insert = |carets: &[(u32, Vec<u16>)]| -> Vec<TextEdit> {
        // Applied in order, so each later caret counts the units typed before it.
        let mut before = 0;
        carets
            .iter()
            .map(|(caret, units)| {
                let edit = TextEdit {
                    start: caret + before,
                    delete: 0,
                    insert: units.clone(),
                };
                before += units.len() as u32;
                edit
            })
            .collect()
    };
    let remove = |carets: &[(u32, Vec<u16>)]| -> Vec<TextEdit> {
        carets
            .iter()
            .map(|(caret, units)| TextEdit {
                start: *caret,
                delete: units.len() as u32,
                insert: Vec::new(),
            })
            .collect()
    };
    let other = corpus::paragraph(script, 11, starts.len());
    let whole = |from: &[u16], to: &[u16]| {
        alloc::vec![TextEdit {
            start: 0,
            delete: from.len() as u32,
            insert: to.to_vec(),
        }]
    };
    let middle = [typed(2)?];
    let three = [typed(1)?, typed(2)?, typed(3)?];
    let cases: [(&str, Vec<TextEdit>, Vec<TextEdit>); 3] = [
        ("insert_mid", insert(&middle), remove(&middle)),
        ("three_range", insert(&three), remove(&three)),
        (
            "replace_all",
            whole(&base.text, &other),
            whole(&other, &base.text),
        ),
    ];
    for (name, forward, backward) in cases {
        let mut edited = base.clone();
        for edit in &forward {
            edit.apply(&mut edited.text);
        }
        let mut whole_step = Vec::new();
        let mut cluster_stage = Vec::new();
        let mut unicode_stage = Vec::new();
        let mut bidi_stage = Vec::new();
        for _ in 0..iterations {
            take_cluster_stage();
            clock::UNICODE.take();
            clock::BIDI.take();
            let started = now();
            session.step(&edited, &forward, ROUTE)?;
            whole_step.push(now() - started);
            cluster_stage.push(take_cluster_stage());
            unicode_stage.push(clock::UNICODE.take());
            bidi_stage.push(clock::BIDI.take());
            session.step(base, &backward, ROUTE)?;
        }
        row(report, &format!("op.{name}"), &mut whole_step, glyphs);
        for (stage, samples) in [
            ("cluster", &mut cluster_stage),
            ("unicode", &mut unicode_stage),
            ("bidi", &mut bidi_stage),
        ] {
            row(report, &format!("stage.{stage}.{name}"), samples, glyphs);
        }
    }
    Ok(())
}

/// The run-local stage alone, called the way each change class calls it.
fn stage(
    session: &mut Session,
    report: &mut String,
    iterations: usize,
    glyphs: usize,
) -> Result<(), String> {
    let Session {
        registry, engine, ..
    } = session;
    let paragraph = &mut engine
        .planners
        .get_mut(&ROOT_ID)
        .ok_or("root is missing")?
        .paragraph_mut(PARAGRAPH_ID)
        .ok_or("paragraph is missing")?
        .state;
    let styles = paragraph.styles.active().resolved.segments();
    let runs = paragraph.shaping_runs.active().runs();
    let (pending, committed) = paragraph.clusters.derive_mut();
    for (name, inherited) in [
        ("stage.run_local.cold", None),
        ("stage.run_local.metric", Some(Inherited::Ink)),
        ("stage.run_local.line_height", Some(Inherited::Geometry)),
    ] {
        let mut samples = Vec::new();
        for _ in 0..iterations {
            // What a style-only change derives before the stage runs; untimed.
            pending
                .refresh_styles_from_stream(
                    committed,
                    styles,
                    runs,
                    inherited == Some(Inherited::Ink),
                )
                .map_err(|error| format!("refresh: {error:?}"))?
                .ok_or("the committed clusters cannot be refreshed")?;
            pending.run_local.take_inherited();
            let started = now();
            // The stage's whole cost for the class: what it copies from the committed arena,
            // then the rebuild.
            if let Some(inherited) = inherited {
                pending
                    .run_local
                    .inherit(&committed.run_local, inherited)
                    .map_err(|error| format!("inherit: {error:?}"))?;
            }
            pending
                .rebuild_run_local_geometry(runs, styles, |handle, glyph| {
                    registry.font_glyph_extents(handle, glyph)
                })
                .map_err(|error| format!("run-local: {error:?}"))?;
            samples.push(now() - started);
        }
        row(report, name, &mut samples, glyphs);
    }
    Ok(())
}

const MEASURED: Route = Route {
    view_mask: 0,
    measure_first: false,
    measure_after: true,
    ..Route::FULL
};

/// The fragments' cluster ranges: two layouts with the same list broke at the same places.
fn breaks(session: &mut Session) -> Result<Vec<(u32, u32)>, String> {
    let flow = paragraph_state(session)?.flow_layout.committed();
    let mut cursor = flow.fragments.cursor_from(0).ok_or("no fragment cursor")?;
    let fragments = cursor
        .take(flow.fragments.len())
        .ok_or("fragment cursor is short")?;
    Ok(fragments
        .iter()
        .map(|fragment| (fragment.line.cluster_start, fragment.line.cluster_end))
        .collect())
}

/// One change class: the step is timed whole, and the positioning and measurement stages
/// report their own time inside it.
struct Timed {
    op: Vec<f64>,
    positioning: Vec<f64>,
    measurement: Vec<f64>,
}

impl Timed {
    fn new() -> Self {
        Self {
            op: Vec::new(),
            positioning: Vec::new(),
            measurement: Vec::new(),
        }
    }

    fn step(
        &mut self,
        session: &mut Session,
        next: &Model,
        edits: &[TextEdit],
    ) -> Result<(), String> {
        clock::POSITIONING.take();
        clock::MEASUREMENT.take();
        let started = now();
        session.step(next, edits, MEASURED)?;
        self.op.push(now() - started);
        self.positioning.push(clock::POSITIONING.take());
        self.measurement.push(clock::MEASUREMENT.take());
        Ok(())
    }

    fn report(&mut self, report: &mut String, name: &str, glyphs: usize) {
        row(report, &format!("{name}.op"), &mut self.op, glyphs);
        row(
            report,
            &format!("{name}.positioning"),
            &mut self.positioning,
            glyphs,
        );
        row(
            report,
            &format!("{name}.measurement"),
            &mut self.measurement,
            glyphs,
        );
    }
}

/// `bench layout <fixture> <align> <graphemes> <iterations>`: positioning and measurement
/// self-time per change class, each step a publication followed by a measurement.
fn layout(
    library: &FontLibrary,
    fixture: &str,
    align: &str,
    graphemes: usize,
    iterations: usize,
) -> Result<String, String> {
    let (script, stack, shape): (Script, &[&str], fn(&mut Layout)) = match fixture {
        "inter" => (Script::Latin, &["inter"], |_| {}),
        "fredoka" => (Script::Latin, &["fredoka"], |_| {}),
        "amiri" => (Script::Arabic, &["amiri"], |_| {}),
        "bidi" => (Script::MixedBidi, &["inter", "amiri"], |_| {}),
        "cjk" => (Script::Cjk, &["cjk-jp"], |_| {}),
        "dropcap" => (Script::Latin, &["inter"], |layout| {
            layout.drop_cap_lines = 3
        }),
        "exclusion" => (Script::Latin, &["inter"], |layout| {
            layout.exclusion = Some(Exclusion {
                inline_start: 220.0,
                inline_end: 380.0,
                block_start: 40.0,
                block_end: 4_000.0,
                polygon: false,
            });
        }),
        _ => return Err(format!("unknown layout fixture `{fixture}`")),
    };
    let (align, other_align) = match align {
        "start" => (ALIGN_START, ALIGN_CENTER),
        "center" => (ALIGN_CENTER, ALIGN_END),
        "end" => (ALIGN_END, ALIGN_START),
        "justify" => (ALIGN_JUSTIFY, ALIGN_START),
        _ => return Err(format!("unknown alignment `{align}`")),
    };
    let mut base = Model {
        text: corpus::paragraph(script, 7, graphemes),
        root: RootStyle {
            font_size: 24.0,
            ..RootStyle::default()
        },
        layout: Layout {
            align,
            ..Layout::default()
        },
        ..Model::default()
    };
    shape(&mut base.layout);
    let relaid = |change: &dyn Fn(&mut Layout)| {
        let mut next = base.clone();
        change(&mut next.layout);
        next
    };
    let stacks: &[&[&str]] = &[stack];
    let mut report = String::new();

    let mut cold = Timed::new();
    for _ in 0..iterations.div_ceil(8).max(3) {
        let mut session = Session::new(library, stacks)?;
        cold.step(&mut session, &base, &[])?;
    }
    let mut session = Session::new(library, stacks)?;
    session.step(&base, &[], MEASURED)?;
    let glyphs = paragraph_state(&mut session)?
        .clusters
        .committed()
        .glyph_ids
        .len();
    let base_breaks = breaks(&mut session)?;
    let (segments, spans) = {
        let positioned = paragraph_state(&mut session)?.positioned.committed();
        (
            positioned.placement_segments().len(),
            positioned.occurrence_spans().len(),
        )
    };

    // The widest step that keeps every break, so the row times a pure origin change.
    let mut same = None;
    for delta in [0.5_f32, 0.125, 0.03125, 0.007_812_5] {
        let candidate = relaid(&|layout| layout.width += delta);
        session.step(&candidate, &[], MEASURED)?;
        let kept = breaks(&mut session)? == base_breaks;
        session.step(&base, &[], MEASURED)?;
        if kept {
            same = Some(candidate);
            break;
        }
    }
    let moved = relaid(&|layout| layout.width -= 40.0);
    session.step(&moved, &[], MEASURED)?;
    let moved_breaks = breaks(&mut session)?;
    session.step(&base, &[], MEASURED)?;
    let moved_lines = base_breaks
        .iter()
        .zip(&moved_breaks)
        .filter(|(left, right)| left != right)
        .count()
        + base_breaks.len().abs_diff(moved_breaks.len());
    report.push_str(&format!(
        "shape\tglyphs {glyphs}\tsegments {segments}\tspans {spans}\tfragments {}\tmoved {moved_lines}\tsame-breaks {}\n",
        base_breaks.len(),
        same.is_some()
    ));
    cold.report(&mut report, "cold", glyphs);

    // A mid-paragraph edit: one grapheme is doubled, then removed again.
    let boundaries = corpus::grapheme_boundaries(&base.text);
    let middle = boundaries.len() / 2;
    let (start, end) = (boundaries[middle], boundaries[middle + 1]);
    let grapheme = base.text[start as usize..end as usize].to_vec();
    let insert = TextEdit {
        start,
        delete: 0,
        insert: grapheme.clone(),
    };
    let remove = TextEdit {
        start,
        delete: end - start,
        insert: Vec::new(),
    };
    let mut edited = base.clone();
    insert.apply(&mut edited.text);
    let mut edit = Timed::new();
    for iteration in 0..iterations & !1 {
        if iteration % 2 == 0 {
            edit.step(&mut session, &edited, core::slice::from_ref(&insert))?;
        } else {
            edit.step(&mut session, &base, core::slice::from_ref(&remove))?;
        }
    }
    edit.report(&mut report, "edit", glyphs);

    let aligned = relaid(&|layout| layout.align = other_align);
    for (name, changed) in [
        ("width.same", same.as_ref()),
        ("width.moved", Some(&moved)),
        ("align", Some(&aligned)),
    ] {
        let Some(changed) = changed else { continue };
        let mut timed = Timed::new();
        for iteration in 0..iterations & !1 {
            let next = if iteration % 2 == 0 { changed } else { &base };
            timed.step(&mut session, next, &[])?;
        }
        timed.report(&mut report, name, glyphs);
    }
    Ok(format!("ok\n{report}"))
}

fn label_text(script: Script, index: usize) -> Vec<u16> {
    match script {
        Script::Latin => format!("label {index:03}").encode_utf16().collect(),
        _ => corpus::label(script, index as u64 + 1, 24),
    }
}

fn labels(
    library: &FontLibrary,
    font: &str,
    script: Script,
    count: usize,
    iterations: usize,
) -> Result<String, String> {
    let models: Vec<Model> = (0..count)
        .map(|index| Model {
            // The many-label profile's text; generated labels mostly need line-edge islands.
            text: label_text(script, index),
            layout: Layout {
                width: 160.0,
                ..Layout::default()
            },
            ..Model::default()
        })
        .collect();
    let mut report = String::new();
    let mut cold = Vec::new();
    let mut sessions = Vec::new();
    for _ in 0..iterations.div_ceil(8).max(3) {
        sessions.clear();
        for _ in 0..count {
            sessions.push(Session::new(library, &[&[font]])?);
        }
        let started = now();
        for (session, model) in sessions.iter_mut().zip(&models) {
            session.step(model, &[], ROUTE)?;
        }
        cold.push(now() - started);
    }
    let mut glyphs = 0;
    let mut inline = 0;
    for session in &mut sessions {
        if let PreparedLayout::Inline(leaf) = paragraph_state(session)?.prepared_layout.committed()
        {
            glyphs += leaf.semantic_count();
            inline += 1;
        }
    }
    report.push_str(&format!(
        "shape\tlabels {count}\tinline {inline}\tglyphs {glyphs}\n"
    ));
    row(&mut report, "op.labels.cold", &mut cold, glyphs);

    let mut samples = Vec::new();
    for _ in 0..iterations {
        let mut elapsed = 0.0;
        for session in &mut sessions {
            let Session {
                registry, engine, ..
            } = session;
            let paragraph = &mut engine
                .planners
                .get_mut(&ROOT_ID)
                .ok_or("root is missing")?
                .paragraph_mut(PARAGRAPH_ID)
                .ok_or("paragraph is missing")?
                .state;
            let styles = paragraph.styles.active().resolved.segments();
            let (committed, _) = paragraph.prepared_layout.pair_mut();
            let PreparedLayout::Inline(leaf) = committed else {
                continue;
            };
            let mut ids = [0_u32; LAYOUT_CHUNK];
            let mut bidi_level = 0;
            for (source, id) in ids.iter_mut().enumerate().take(leaf.semantic_count()) {
                let semantic = leaf
                    .row(source as u32)
                    .ok_or("label row is missing")?
                    .semantic;
                *id = semantic.stable_id;
                bidi_level = semantic.bidi_level;
            }
            let started = now();
            leaf.build_numeric_rows(&ids, styles, bidi_level, |handle, glyph| {
                registry.font_glyph_extents(handle, glyph)
            })
            .map_err(|error| format!("label rows: {error:?}"))?;
            elapsed += now() - started;
        }
        samples.push(elapsed);
    }
    row(&mut report, "stage.run_local.labels", &mut samples, glyphs);
    Ok(format!("ok\n{report}"))
}

#[cfg(all(test, feature = "std"))]
mod tests {
    extern crate std;
    use super::*;

    /// The probe's commands run natively too, so a stage rewrite cannot silently break them.
    #[test]
    fn bench_commands_report_every_stage() {
        let mut library = FontLibrary::default();
        let font = std::fs::read(std::format!(
            "{}/../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        library.insert("inter", font).unwrap();
        let paragraph = command(&library, &["paragraph", "inter", "latin", "300", "2"]).unwrap();
        for stage in [
            "op.cold",
            "op.font_size",
            "op.letter_spacing",
            "op.line_height",
            "stage.run_local.cold",
            "stage.run_local.metric",
            "stage.run_local.line_height",
            "stage.cluster.cold",
            "op.insert_mid",
            "stage.cluster.insert_mid",
            "stage.cluster.three_range",
            "stage.cluster.replace_all",
        ] {
            assert!(paragraph.contains(stage), "{paragraph}");
        }
        let labels = command(&library, &["labels", "inter", "latin", "8", "2"]).unwrap();
        assert!(labels.contains("inline 8"), "{labels}");
        assert!(labels.contains("stage.run_local.labels"), "{labels}");
        for align in ["start", "center", "end", "justify"] {
            let layout = command(&library, &["layout", "inter", align, "300", "2"]).unwrap();
            for change in ["cold", "edit", "width.same", "width.moved", "align"] {
                for clock in ["op", "positioning", "measurement"] {
                    assert!(
                        layout.contains(&std::format!("{change}.{clock}\t")),
                        "{layout}"
                    );
                }
            }
        }
    }
}
