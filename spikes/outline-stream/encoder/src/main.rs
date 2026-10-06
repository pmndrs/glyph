//! Outline stream GPU spike encoder.
//!
//! `encoder <font.ttf|otf> <out-prefix> [--unicodes U+0020-007E,U+00A0-00FF] [--triplet]`
//!
//! Writes `<prefix>.spike.bin` and `<prefix>.spike.json` per the asset format in
//! `.agents/docs/planning/outline-stream-spike.md`, then reads both layouts back and fails on any structural
//! mismatch. `--triplet` also writes `<prefix>.triplet.bin` / `.triplet.json` for `cpu-bench.mjs`.

mod layout;
mod outline;
mod triplet;
mod verify;

use std::{fs, path::Path, process::ExitCode};

use pmndrs_glyph_slug_core::DEFAULT_CUBIC_SUBDIVISIONS;
use serde_json::{Value, json};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    outline::{DrawSettings, OutlineGlyphFormat},
    prelude::{LocationRef, Size},
    raw::TableProvider,
};

use layout::{BandStats, Sections};
use outline::{Pen, Stats};

struct Args {
    font: String,
    prefix: String,
    unicodes: Option<String>,
    triplet: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut unicodes = None;
    let mut triplet = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--unicodes" => unicodes = Some(args.next().ok_or("--unicodes needs a value")?),
            "--triplet" => triplet = true,
            _ if arg.starts_with("--") => return Err(format!("unknown option {arg}")),
            _ => positional.push(arg),
        }
    }
    let [font, prefix] = <[String; 2]>::try_from(positional).map_err(
        |_| "usage: encoder <font.ttf|otf> <out-prefix> [--unicodes U+0020-007E,...] [--triplet]",
    )?;
    Ok(Args {
        font,
        prefix,
        unicodes,
        triplet,
    })
}

fn parse_unicodes(spec: &str) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let hex = |s: &str| {
            let s = s.trim_start_matches("U+").trim_start_matches("u+");
            u32::from_str_radix(s, 16).map_err(|_| format!("bad code point {s:?}"))
        };
        let (lo, hi) = match part.split_once('-') {
            Some((lo, hi)) => (hex(lo)?, hex(hi)?),
            None => (hex(part)?, hex(part)?),
        };
        out.extend(lo..=hi);
    }
    Ok(out)
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("encoder: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let bytes = fs::read(&args.font).map_err(|e| format!("{}: {e}", args.font))?;
    let font = FontRef::new(&bytes).map_err(|e| format!("{}: {e}", args.font))?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let upm = f32::from(metrics.units_per_em);
    let glyph_count = font.maxp().map_err(|e| e.to_string())?.num_glyphs();
    let outlines = font.outline_glyphs();
    let format = match outlines.format() {
        Some(OutlineGlyphFormat::Glyf) => "truetype",
        Some(OutlineGlyphFormat::Cff) => "cff",
        Some(OutlineGlyphFormat::Cff2) => "cff2",
        _ => return Err("font has no glyf, CFF or CFF2 outlines".into()),
    };
    let truetype = format == "truetype";
    let advances = font.glyph_metrics(Size::unscaled(), LocationRef::default());

    // First code point mapped to each glyph.
    let mut codepoint_of = vec![-1i64; usize::from(glyph_count)];
    for (cp, gid) in font.charmap().mappings() {
        if let Some(slot) = codepoint_of
            .get_mut(gid.to_u32() as usize)
            .filter(|s| **s < 0)
        {
            *slot = i64::from(cp);
        }
    }
    let selection: Vec<(u32, i64)> = match &args.unicodes {
        None => (0..u32::from(glyph_count))
            .map(|g| (g, codepoint_of[g as usize]))
            .collect(),
        Some(spec) => {
            let charmap = font.charmap();
            let mut seen = std::collections::HashSet::new();
            parse_unicodes(spec)?
                .into_iter()
                .filter_map(|cp| charmap.map(cp).map(|g| (g.to_u32(), i64::from(cp))))
                .filter(|(g, _)| seen.insert(*g))
                .collect()
        }
    };

    let mut sections = Sections::default();
    let mut stats = Stats::default();
    let mut band_stats = BandStats::default();
    let mut triplets = triplet::Triplets::default();
    let mut placed = Vec::new();
    let (mut glyph_ids, mut codepoints, mut advance_widths) = (Vec::new(), Vec::new(), Vec::new());
    let mut curve_counts = Vec::new();
    for &(gid, cp) in &selection {
        glyph_ids.push(gid);
        codepoints.push(cp);
        advance_widths.push(advances.advance_width(GlyphId::new(gid)).unwrap_or(0.0));
        let mut pen = Pen::new(DEFAULT_CUBIC_SUBDIVISIONS);
        if let Some(glyph) = outlines.get(GlyphId::new(gid)) {
            glyph
                .draw(
                    DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                    &mut pen,
                )
                .map_err(|e| format!("glyph {gid}: draw: {e}"))?;
        }
        let contours = pen.finish();
        let points = outline::glyph_points(&contours, truetype, &mut stats)
            .map_err(|e| format!("glyph {gid}: {e}"))?;
        triplets.push_glyph(&points.source_contours);
        curve_counts.push(points.curves.len());
        if points.curves.is_empty() {
            sections.push_empty();
            continue;
        }
        let glyph = sections
            .push_glyph(&points.points, points.curves, upm, &mut band_stats)
            .map_err(|e| format!("glyph {gid}: {e}"))?;
        placed.push((gid, glyph));
    }
    let used = (
        sections.texel_count(),
        sections.points_i16.len() / 4,
        sections.band_headers.len(),
    );
    sections.pad_rows();

    let report = verify::verify(&sections, &placed, upm);
    let curves: usize = curve_counts.iter().sum();
    let structural_ok = report.errors.is_empty() && report.curves_checked == curves;

    // Binary, sections 16-byte aligned.
    let mut bin = Vec::new();
    let mut section = |name: &str, data: &[u8], extra: Value| -> (String, Value) {
        bin.resize(bin.len().next_multiple_of(16), 0);
        let offset = bin.len();
        bin.extend_from_slice(data);
        let mut v = json!({ "offset": offset, "length": data.len() });
        if let (Value::Object(map), Value::Object(more)) = (&mut v, extra) {
            map.extend(more);
        }
        (name.to_owned(), v)
    };
    let u32_bytes = |v: &[u32]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let u16_bytes = |v: &[u16]| v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>();
    let rows = |texels: usize| json!({ "texels": texels, "rows": texels / layout::ROW_TEXELS });
    let sections_json: serde_json::Map<String, Value> = [
        section(
            "glyphs",
            &sections.glyphs,
            json!({ "count": selection.len(), "stride": layout::GLYPH_RECORD_BYTES }),
        ),
        section(
            "curvesF16",
            &sections.curves_f16,
            rows(sections.curves_f16.len() / 8),
        ),
        section(
            "pointsI16",
            &sections.points_i16,
            rows(sections.points_i16.len() / 4),
        ),
        section(
            "bandHeaders",
            &u32_bytes(&sections.band_headers),
            rows(sections.band_headers.len()),
        ),
        section(
            "bandRefsA",
            &u16_bytes(&sections.band_refs_a),
            rows(sections.band_refs_a.len()),
        ),
        section(
            "bandRefsB",
            &u16_bytes(&sections.band_refs_b),
            rows(sections.band_refs_b.len()),
        ),
    ]
    .into_iter()
    .collect();

    let name = Path::new(&args.font)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("font");
    let stats_json = json!({
        "glyphsWithOutlines": placed.len(),
        "contours": stats.contours,
        "curves": curves,
        "quadratics": report.quads,
        "lines": report.lines,
        "points": used.1,
        "curveTexels": used.0,
        "bandSlots": used.2,
        "bandReferences": band_stats.references,
        "storedBandReferences": band_stats.stored_references,
        "sharedBands": band_stats.shared_bands,
        "maxBandReferences": band_stats.max_band_references,
        "impliedOnCurveRecovered": stats.implied_on_curve_recovered,
        "allOffCurveContours": stats.all_off_curve_contours,
        "allOffCurveContoursRounded": stats.all_off_curve_lossy,
        "roundedPoints": stats.rounded_points,
        "maxRoundingFontUnits": stats.max_rounding,
        "maxSourceErrorFontUnits": stats.max_source_error,
    });
    let verify_json = json!({
        "ok": structural_ok,
        "curvesChecked": report.curves_checked,
        "referencesChecked": report.references_checked,
        "referencedCurves": report.referenced_curves,
        "maxAvsBFontUnits": report.max_a_vs_b,
        "maxLineControlAvsBFontUnits": report.max_line_control_a_vs_b,
        "errors": report.errors.iter().take(20).collect::<Vec<_>>(),
        "errorCount": report.errors.len(),
    });
    let meta = json!({
        "format": "outline-stream-spike-v0",
        "font": name,
        "source": args.font,
        "outlineFormat": format,
        "unicodes": args.unicodes,
        "unitsPerEm": metrics.units_per_em,
        "ascender": metrics.ascent,
        "descender": metrics.descent,
        "fontGlyphCount": glyph_count,
        "glyphCount": selection.len(),
        "rowTexels": layout::ROW_TEXELS,
        "bandCount": { "horizontal": layout::BAND_COUNT, "vertical": layout::BAND_COUNT },
        "cubicSubdivisions": if truetype { Value::Null } else { json!(DEFAULT_CUBIC_SUBDIVISIONS) },
        "layout": {
            "glyph": "curveBase u32, pointBase u32, bandBase u32, hBands u16, vBands u16, minX minY maxX maxY f32 (font units); hBands = vBands = 0 means no outline",
            "bandHeader": "bandHeaders[bandBase + band] = (refCount << 16) | refOffset; horizontal bands 0..hBands (by y), then vertical (by x)",
            "bandRef": "bandRefsA/B[bandBase + refOffset + k]; A = texel offset from curveBase, B = point offset from pointBase",
            "bandIndex": "band = clamp(floor((coord - min) / ((max - min) / count)), 0, count - 1)",
            "curveA": "texels curveBase+ref (x1 y1 x2 y2) and curveBase+ref+1 (x3 y3), em units; diagonal lines bowed by 0.125 font units as V0",
            "pointB": "i16 (x << 1) | offCurve, i16 y, font units; x = word >> 1 (arithmetic)",
            "readRuleB": "off p[i]: control p[i]; start p[i-1] if on else mid(p[i-1], p[i]); end p[i+1] if on else mid(p[i], p[i+1]). on p[i] (then p[i+1] is on): line p[i] -> p[i+1]",
            "padding": "texture-shaped sections are zero-padded to whole rows of rowTexels"
        },
        "sections": sections_json,
        "glyphIds": glyph_ids,
        "codepoints": codepoints,
        "advances": advance_widths,
        "curveCounts": curve_counts,
        "stats": stats_json,
        "verify": verify_json,
    });

    let prefix = &args.prefix;
    if let Some(dir) = Path::new(prefix)
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
    {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(format!("{prefix}.spike.bin"), &bin).map_err(|e| e.to_string())?;
    fs::write(
        format!("{prefix}.spike.json"),
        serde_json::to_string_pretty(&meta).unwrap(),
    )
    .map_err(|e| e.to_string())?;

    if args.triplet {
        let mut tbin = Vec::new();
        let mut planes = serde_json::Map::new();
        for (plane, data) in [
            ("hdr", &triplets.hdr),
            ("cn", &triplets.cn),
            ("flags", &triplets.flags),
            ("data", &triplets.data),
        ] {
            planes.insert(
                plane.into(),
                json!({ "offset": tbin.len(), "length": data.len() }),
            );
            tbin.extend_from_slice(data);
        }
        let tmeta = json!({
            "font": name,
            "unitsPerEm": metrics.units_per_em,
            "glyphs": triplets.glyphs,
            "glyphIds": selection.iter().map(|s| s.0).collect::<Vec<_>>(),
            "contours": triplets.contours,
            "points": triplets.points,
            "sumX": triplets.sum_x,
            "sumY": triplets.sum_y,
            "onCurve": triplets.on_curve,
            "compositesExpanded": true,
            "planes": planes,
        });
        fs::write(format!("{prefix}.triplet.bin"), &tbin).map_err(|e| e.to_string())?;
        fs::write(
            format!("{prefix}.triplet.json"),
            serde_json::to_string_pretty(&tmeta).unwrap(),
        )
        .map_err(|e| e.to_string())?;
    }

    println!(
        "{name}{}: {} glyphs ({} with outlines), {} contours, {curves} curves ({} quadratic, {} line), {} points",
        args.unicodes
            .as_deref()
            .map(|u| format!(" [{u}]"))
            .unwrap_or_default(),
        selection.len(),
        placed.len(),
        stats.contours,
        report.quads,
        report.lines,
        used.1,
    );
    println!(
        "  implied on-curve recovered {}, all-off-curve contours {} (rounded start {}), rounded points {} (max {:.4} u), max B vs source {:.4} u",
        stats.implied_on_curve_recovered,
        stats.all_off_curve_contours,
        stats.all_off_curve_lossy,
        stats.rounded_points,
        stats.max_rounding,
        stats.max_source_error,
    );
    println!(
        "  bands {}x{}: {} refs ({} stored, max {} per band); verify: {} curves, {} refs, max A-vs-B {:.4} u, line control {:.4} u, {}",
        layout::BAND_COUNT,
        layout::BAND_COUNT,
        band_stats.references,
        band_stats.stored_references,
        band_stats.max_band_references,
        report.curves_checked,
        report.references_checked,
        report.max_a_vs_b,
        report.max_line_control_a_vs_b,
        if structural_ok {
            "OK".to_owned()
        } else {
            format!("{} STRUCTURAL ERRORS", report.errors.len())
        },
    );
    println!(
        "  wrote {prefix}.spike.bin ({} bytes){}",
        bin.len(),
        if args.triplet { " + triplet" } else { "" }
    );
    if !structural_ok {
        for e in report.errors.iter().take(10) {
            eprintln!("  {e}");
        }
        return Err("self-verify failed".into());
    }
    Ok(())
}
