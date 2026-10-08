use std::{fs, path::PathBuf};

use pmndrs_glyph_shaper::outline::{GlyphOutline, OutlineError, draw_glyph};
use read_fonts::{
    TableProvider,
    model::pen::PathElement,
    tables::{
        glyf::{Anchor, Glyf, Glyph},
        loca::Loca,
    },
    types::Tag,
};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    instance::{LocationRef, Size},
    outline::DrawSettings,
};

fn face(path: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../benches/fixtures/fonts");
    fs::read(root.join(path)).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn skrifa_segments(font: &FontRef<'_>, glyph_id: u32) -> Vec<PathElement> {
    let mut segments = Vec::new();
    if let Some(glyph) = font.outline_glyphs().get(GlyphId::new(glyph_id)) {
        glyph
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut segments,
            )
            .unwrap_or_else(|error| panic!("Skrifa failed on glyph {glyph_id}: {error}"));
    }
    segments
}

fn glyph_count(font: &FontRef<'_>) -> u32 {
    u32::from(font.maxp().unwrap().num_glyphs())
}

fn table_range(font: &FontRef<'_>, tag: [u8; 4]) -> (usize, usize) {
    let record = font
        .table_directory()
        .table_records()
        .iter()
        .find(|record| record.tag() == Tag::new(&tag))
        .unwrap();
    (record.offset() as usize, record.length() as usize)
}

/// The byte range in `bytes` of each non-empty `glyf` entry.
fn glyph_data_ranges(bytes: &[u8]) -> Vec<(usize, usize)> {
    let font = FontRef::new(bytes).unwrap();
    let loca = font.loca(None).unwrap();
    let (glyf, _) = table_range(&font, *b"glyf");
    (0..loca.len().saturating_sub(1))
        .map(|glyph_id| {
            (
                glyf + loca.get_raw(glyph_id).unwrap() as usize,
                glyf + loca.get_raw(glyph_id + 1).unwrap() as usize,
            )
        })
        .filter(|(start, end)| end - start >= 10)
        .collect()
}

#[test]
fn every_fixture_glyph_draws_the_same_segments_as_skrifa() {
    for path in [
        "inter-v4.1/Inter-Regular.ttf",
        "amiri-1.002/Amiri-Regular.ttf",
        "source-serif-4.005/SourceSerif4-Regular.ttf",
        "font-awesome-free-6.7.2/fa-solid-900.ttf",
        "noto-sans-devanagari/NotoSansDevanagari.ttf",
        "dot-gothic-16/DotGothic16-Regular.ttf",
        "dancing-script-3.000/DancingScript-Regular.otf",
        "noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf",
        "noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf",
    ] {
        let bytes = face(path);
        let font = FontRef::new(&bytes).unwrap();
        let mut drawn = 0;
        for glyph_id in 0..glyph_count(&font) {
            let expected = skrifa_segments(&font, glyph_id);
            let mut actual = Vec::new();
            draw_glyph(&bytes, glyph_id, &mut actual)
                .unwrap_or_else(|error| panic!("{path} glyph {glyph_id}: {error:?}"));
            assert_eq!(actual, expected, "{path} glyph {glyph_id}");
            drawn += usize::from(!actual.is_empty());
        }
        assert!(drawn > 0, "{path} must exercise drawn glyphs");
    }
}

fn with_component_flags(bytes: &[u8], edit: impl Fn(u16) -> u16) -> Vec<u8> {
    let mut edited = bytes.to_vec();
    let word = |data: &[u8], at: usize| u16::from_be_bytes([data[at], data[at + 1]]);
    for (start, _) in glyph_data_ranges(bytes) {
        if (word(bytes, start) as i16) >= 0 {
            continue;
        }
        let mut at = start + 10;
        loop {
            let flags = word(bytes, at);
            edited[at..at + 2].copy_from_slice(&edit(flags).to_be_bytes());
            at += 4 + if flags & 0x0001 != 0 { 4 } else { 2 };
            at += if flags & 0x0008 != 0 {
                2
            } else if flags & 0x0040 != 0 {
                4
            } else if flags & 0x0080 != 0 {
                8
            } else {
                0
            };
            if flags & 0x0020 == 0 {
                break;
            }
        }
    }
    edited
}

fn point_count(glyf: &Glyf<'_>, loca: &Loca<'_>, glyph_id: GlyphId) -> usize {
    match loca.get_glyf(glyph_id, glyf).unwrap() {
        None => 0,
        Some(Glyph::Simple(glyph)) => glyph.num_points(),
        Some(Glyph::Composite(glyph)) => glyph
            .components()
            .map(|component| point_count(glyf, loca, component.glyph.into()))
            .sum(),
    }
}

fn anchors_in_range(glyf: &Glyf<'_>, loca: &Loca<'_>, glyph_id: GlyphId) -> bool {
    let Some(Glyph::Composite(glyph)) = loca.get_glyf(glyph_id, glyf).unwrap() else {
        return true;
    };
    let mut placed = 0;
    glyph.components().all(|component| {
        let child = point_count(glyf, loca, component.glyph.into());
        let valid = match component.anchor {
            Anchor::Offset { .. } => true,
            Anchor::Point { base, component } => {
                usize::from(base) < placed && usize::from(component) < child
            }
        } && anchors_in_range(glyf, loca, component.glyph.into());
        placed += child;
        valid
    })
}

fn agrees_with_skrifa(bytes: &[u8]) -> usize {
    let font = FontRef::new(bytes).unwrap();
    let (glyf, loca) = (font.glyf().unwrap(), font.loca(None).unwrap());
    let mut drawn = 0;
    for glyph_id in 0..glyph_count(&font) {
        let mut actual = Vec::new();
        let ours = draw_glyph(bytes, glyph_id, &mut actual);
        if !anchors_in_range(&glyf, &loca, GlyphId::new(glyph_id)) {
            assert_eq!(
                ours,
                Err(OutlineError::InvalidGlyph),
                "glyph {glyph_id} names a missing point"
            );
            continue;
        }
        assert!(ours.is_ok(), "glyph {glyph_id}: {ours:?}");
        assert_eq!(actual, skrifa_segments(&font, glyph_id), "glyph {glyph_id}");
        drawn += usize::from(!actual.is_empty());
    }
    drawn
}

#[test]
fn point_anchored_and_scaled_offset_components_match_skrifa() {
    let inter = face("inter-v4.1/Inter-Regular.ttf");
    let point_anchored = with_component_flags(&inter, |flags| flags & !0x0002);
    assert!(agrees_with_skrifa(&point_anchored) > 500);
    let amiri = face("amiri-1.002/Amiri-Regular.ttf");
    let scaled_offsets = with_component_flags(&amiri, |flags| flags | 0x0800);
    assert!(agrees_with_skrifa(&scaled_offsets) > 1_000);
}

#[test]
fn corrupted_outline_tables_fail_or_draw_without_panicking() {
    let bytes = face("inter-v4.1/Inter-Regular.ttf");
    let dancing = face("dancing-script-3.000/DancingScript-Regular.otf");
    let mut outline = GlyphOutline::default();
    for (source, tag) in [(&bytes, *b"glyf"), (&bytes, *b"loca"), (&dancing, *b"CFF ")] {
        let font = FontRef::new(source).unwrap();
        let (offset, length) = table_range(&font, tag);
        let glyph_count = glyph_count(&font);
        let mut state = 0x504d_4e44_u64;
        for _ in 0..64 {
            let mut corrupted = source.to_vec();
            for _ in 0..16 {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1);
                let at = offset + (state >> 33) as usize % length;
                corrupted[at] = (state >> 17) as u8;
            }
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            let glyph_id = (state >> 33) as u32 % glyph_count;
            let _ = outline.decode(&corrupted, glyph_id);
        }
    }
}

fn nested_composites(leaf: &[u8], depth: u16) -> Vec<u8> {
    let mut glyf = leaf.to_vec();
    let mut loca = vec![0, glyf.len() as u32];
    for glyph_id in 1..=depth {
        glyf.extend_from_slice(&(-1_i16).to_be_bytes());
        glyf.extend_from_slice(&[0; 8]);
        for flags in [0x0022_u16, 0x0002] {
            glyf.extend_from_slice(&flags.to_be_bytes());
            glyf.extend_from_slice(&(glyph_id - 1).to_be_bytes());
            glyf.extend_from_slice(&[0, 0]);
        }
        loca.push(glyf.len() as u32);
    }
    let mut head = [0; 54];
    head[18..20].copy_from_slice(&1000_u16.to_be_bytes());
    head[50..52].copy_from_slice(&1_u16.to_be_bytes());
    let mut maxp = 0x5000_u32.to_be_bytes().to_vec();
    maxp.extend_from_slice(&(depth + 1).to_be_bytes());
    let tables: [(&[u8; 4], Vec<u8>); 4] = [
        (b"glyf", glyf),
        (b"head", head.to_vec()),
        (
            b"loca",
            loca.iter()
                .flat_map(|offset| offset.to_be_bytes())
                .collect(),
        ),
        (b"maxp", maxp),
    ];
    let mut font = 0x0001_0000_u32.to_be_bytes().to_vec();
    font.extend_from_slice(&[0, 4, 0, 0, 0, 0, 0, 0]);
    let mut offset = 12 + 16 * tables.len();
    for (tag, data) in &tables {
        font.extend_from_slice(*tag);
        font.extend_from_slice(&[0; 4]);
        font.extend_from_slice(&(offset as u32).to_be_bytes());
        font.extend_from_slice(&(data.len() as u32).to_be_bytes());
        offset += data.len().next_multiple_of(4);
    }
    for (_, data) in &tables {
        font.extend_from_slice(data);
        font.resize(font.len().next_multiple_of(4), 0);
    }
    font
}

#[test]
fn composites_that_multiply_their_components_are_refused() {
    let triangle = [
        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 1, 1, 0, 0, 0, 100, 255, 206, 0, 0, 0, 0, 0,
        100,
    ];
    let mut segments = Vec::new();
    draw_glyph(&nested_composites(&triangle, 4), 4, &mut segments).expect("16 triangles");
    let closes = segments
        .iter()
        .filter(|segment| matches!(segment, PathElement::Close))
        .count();
    assert_eq!(closes, 16);
    assert_eq!(
        draw_glyph(&nested_composites(&triangle, 15), 15, &mut Vec::new()),
        Err(OutlineError::InvalidGlyph),
        "98,304 points"
    );
    assert_eq!(
        draw_glyph(&nested_composites(&[], 30), 30, &mut Vec::new()),
        Err(OutlineError::InvalidGlyph),
        "a billion components"
    );
}

/// Checks one decoded glyph against Skrifa's segments for it: segment `s` of contour `c` starts at
/// point `2s + c`, a line is flagged and keeps its midpoint control, a cubic becomes four flagged
/// quadratics, and every point Skrifa names is font units over `unitsPerEm` with y negated.
fn assert_decoded_layout(label: &str, outline: &GlyphOutline, segments: &[PathElement], upem: f32) {
    let em = |x: f32, y: f32| (x / upem, (0.0 - y) / upem);
    let (points, lines, ends) = (
        outline.points(),
        outline.segment_lines(),
        outline.contour_ends(),
    );
    assert_eq!(
        points.len(),
        2 * lines.len() + ends.len(),
        "{label}: point count"
    );
    assert_eq!(
        ends.last().map_or(0, |&end| end as usize),
        lines.len(),
        "{label}: last contour end"
    );
    let point = |index: usize| (points[index].x, points[index].y);
    let (mut segment, mut contour, mut contour_start) = (0_usize, 0_usize, 0_usize);
    let (mut start, mut current) = ((0.0, 0.0), (0.0, 0.0));
    // (segment, contour, expected control if Skrifa names one, expected end, is a line)
    let mut expected = Vec::new();
    for element in segments {
        match *element {
            PathElement::MoveTo { x, y } => {
                start = em(x, y);
                current = start;
                contour_start = segment;
                if contour < ends.len() {
                    assert_eq!(
                        point(2 * segment + contour),
                        start,
                        "{label}: contour start"
                    );
                }
            }
            PathElement::LineTo { x, y } => {
                current = em(x, y);
                expected.push((segment, contour, None, current, true));
                segment += 1;
            }
            PathElement::QuadTo { cx0, cy0, x, y } => {
                current = em(x, y);
                expected.push((segment, contour, Some(em(cx0, cy0)), current, false));
                segment += 1;
            }
            PathElement::CurveTo { x, y, .. } => {
                current = em(x, y);
                for _ in 0..3 {
                    assert_eq!(lines[segment], 0, "{label}: cubic piece");
                    segment += 1;
                }
                expected.push((segment, contour, None, current, false));
                segment += 1;
            }
            PathElement::Close => {
                if current != start {
                    expected.push((segment, contour, None, start, true));
                    segment += 1;
                }
                if segment == contour_start {
                    continue;
                }
                assert_eq!(ends[contour] as usize, segment, "{label}: contour end");
                contour += 1;
            }
        }
    }
    assert_eq!(contour, ends.len(), "{label}: contour count");
    for (segment, contour, control, end, line) in expected {
        let at = 2 * segment + contour;
        assert_eq!(
            lines[segment],
            u8::from(line),
            "{label}: segment {segment} line flag"
        );
        assert_eq!(point(at + 2), end, "{label}: segment {segment} end");
        if let Some(control) = control {
            assert_eq!(point(at + 1), control, "{label}: segment {segment} control");
        }
        if line {
            let ((x0, y0), (cx, cy)) = (point(at), point(at + 1));
            assert!(
                (cx - (x0 + end.0) * 0.5).abs() <= 1e-6 && (cy - (y0 + end.1) * 0.5).abs() <= 1e-6,
                "{label}: segment {segment} line control is not its midpoint"
            );
        }
    }
}

#[test]
fn decoded_outlines_share_endpoints_flag_lines_and_use_em_units_y_down() {
    for path in [
        "inter-v4.1/Inter-Regular.ttf",
        "font-awesome-free-6.7.2/fa-solid-900.ttf",
        "dancing-script-3.000/DancingScript-Regular.otf",
    ] {
        let bytes = face(path);
        let font = FontRef::new(&bytes).unwrap();
        let upem = f32::from(font.head().unwrap().units_per_em());
        let mut outline = GlyphOutline::default();
        let (mut lines, mut curves) = (0, 0);
        for glyph_id in 0..glyph_count(&font) {
            let label = format!("{path} glyph {glyph_id}");
            outline
                .decode(&bytes, glyph_id)
                .unwrap_or_else(|error| panic!("{label}: {error:?}"));
            assert_decoded_layout(&label, &outline, &skrifa_segments(&font, glyph_id), upem);
            let glyph_lines = outline
                .segment_lines()
                .iter()
                .filter(|&&line| line == 1)
                .count();
            lines += glyph_lines;
            curves += outline.segment_lines().len() - glyph_lines;
        }
        assert!(
            lines > 100 && curves > 100,
            "{path}: {lines} lines, {curves} curves"
        );
    }
}

/// Rewrites every simple glyph's point flags with `edit`, which must keep the coordinate-size and repeat bits.
fn with_simple_point_flags(bytes: &[u8], edit: impl Fn(u8) -> u8) -> Vec<u8> {
    let mut edited = bytes.to_vec();
    let word = |at: usize| u16::from_be_bytes([bytes[at], bytes[at + 1]]) as usize;
    for (start, _) in glyph_data_ranges(bytes) {
        let contours = word(start);
        if contours == 0 || contours >= 0x8000 {
            continue;
        }
        let ends = start + 10;
        let point_count = word(ends + 2 * (contours - 1)) + 1;
        let mut at = ends + 2 * contours;
        at += 2 + word(at);
        let mut points = 0;
        while points < point_count {
            let flags = bytes[at];
            edited[at] = edit(flags);
            at += 1;
            points += 1;
            if flags & 0x08 != 0 {
                points += usize::from(bytes[at]);
                at += 1;
            }
        }
    }
    edited
}

/// Counts contours that start off-curve and contours with no on-curve point at all.
fn off_curve_contours(bytes: &[u8]) -> (usize, usize) {
    let font = FontRef::new(bytes).unwrap();
    let (glyf, loca) = (font.glyf().unwrap(), font.loca(None).unwrap());
    let (mut off_start, mut all_off) = (0, 0);
    for glyph_id in 0..loca.len().saturating_sub(1) {
        let Ok(Some(Glyph::Simple(glyph))) = loca.get_glyf(GlyphId::new(glyph_id as u32), &glyf)
        else {
            continue;
        };
        let points: Vec<_> = glyph.points().collect();
        let mut first = 0;
        for &last in glyph.end_pts_of_contours() {
            let contour = &points[first..=usize::from(last.get())];
            off_start += usize::from(!contour[0].on_curve);
            all_off += usize::from(contour.iter().all(|point| !point.on_curve));
            first = usize::from(last.get()) + 1;
        }
    }
    (off_start, all_off)
}

#[test]
fn contours_that_start_off_curve_or_have_no_on_curve_point_match_skrifa() {
    let inter = face("inter-v4.1/Inter-Regular.ttf");
    for (label, edited) in [
        (
            "all off-curve",
            with_simple_point_flags(&inter, |flags| flags & !0x01),
        ),
        (
            "on-curve flipped",
            with_simple_point_flags(&inter, |flags| flags ^ 0x01),
        ),
    ] {
        let (off_start, all_off) = off_curve_contours(&edited);
        assert!(
            off_start > 1_000,
            "{label}: {off_start} contours start off-curve"
        );
        if label == "all off-curve" {
            assert_eq!(all_off, off_start, "{label}: every contour is off-curve");
        }
        assert!(agrees_with_skrifa(&edited) > 1_000, "{label}");
        let font = FontRef::new(&edited).unwrap();
        let upem = f32::from(font.head().unwrap().units_per_em());
        let mut outline = GlyphOutline::default();
        for glyph_id in 0..glyph_count(&font) {
            let name = format!("{label} glyph {glyph_id}");
            outline
                .decode(&edited, glyph_id)
                .unwrap_or_else(|error| panic!("{name}: {error:?}"));
            assert_decoded_layout(&name, &outline, &skrifa_segments(&font, glyph_id), upem);
        }
    }
}
