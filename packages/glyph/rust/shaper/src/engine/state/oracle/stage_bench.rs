//! Stage clocks for run-local geometry, runnable inside the optimized wasm32 build.
//!
//! Evidence tooling, not a benchmark protocol: it times the run-local stage alone on a real
//! paragraph (the calls the engine makes for a cold build, a metric change and a line-height
//! change) and the whole engine step around it, so a rewrite of the stage can be read against
//! the code it replaces. Behind the `stage-bench` feature; no shipped artifact carries it.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};

use crate::engine::cluster_state::LAYOUT_CHUNK;

use super::{
    super::{ParagraphState, PreparedLayout},
    corpus::{self, Script},
    fonts::FontLibrary,
    model::{Layout, Model, PARAGRAPH_ID, ROOT_ID, RootStyle},
    session::{Route, Session},
};

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
        "arabic" => Script::Arabic,
        "devanagari" => Script::Devanagari,
        "cjk" => Script::Cjk,
        _ => return Err(format!("unknown script `{name}`")),
    })
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
        _ => Err("usage: bench paragraph|labels <font> <script> <size> <iterations>".to_string()),
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

    let mut cold = Vec::new();
    for _ in 0..iterations.div_ceil(8).max(3) {
        let mut session = Session::new(library, &[&[font]])?;
        let started = now();
        session.step(&base, &[], ROUTE)?;
        cold.push(now() - started);
    }
    let mut session = Session::new(library, &[&[font]])?;
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
    Ok(format!("ok\n{report}"))
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
    // Each change class calls the stage after deriving the pending clusters; until a class gets
    // its own path the three rows time the same rebuild.
    for (name, metrics_changed) in [
        ("stage.run_local.cold", false),
        ("stage.run_local.metric", true),
        ("stage.run_local.line_height", false),
    ] {
        let mut samples = Vec::new();
        for _ in 0..iterations {
            pending
                .refresh_styles_from_stream(committed, styles, metrics_changed)
                .map_err(|error| format!("refresh: {error:?}"))?
                .ok_or("the committed clusters cannot be refreshed")?;
            let started = now();
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
        ] {
            assert!(paragraph.contains(stage), "{paragraph}");
        }
        let labels = command(&library, &["labels", "inter", "latin", "8", "2"]).unwrap();
        assert!(labels.contains("inline 8"), "{labels}");
        assert!(labels.contains("stage.run_local.labels"), "{labels}");
    }
}
