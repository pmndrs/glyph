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
        let glyph_count = u32::from(font.maxp().unwrap().num_glyphs());
        let mut drawn = 0;
        for glyph_id in 0..glyph_count {
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
    let font = read_fonts::FontRef::new(bytes).unwrap();
    let loca = font.loca(None).unwrap();
    let glyf = font
        .table_directory()
        .table_records()
        .iter()
        .find(|record| record.tag() == Tag::new(b"glyf"))
        .unwrap()
        .offset() as usize;
    let mut edited = bytes.to_vec();
    let word = |data: &[u8], at: usize| u16::from_be_bytes([data[at], data[at + 1]]);
    for glyph_id in 0..loca.len().saturating_sub(1) {
        let (start, end) = (
            loca.get_raw(glyph_id).unwrap() as usize,
            loca.get_raw(glyph_id + 1).unwrap() as usize,
        );
        if end - start < 10 || (word(bytes, glyf + start) as i16) >= 0 {
            continue;
        }
        let mut at = glyf + start + 10;
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
    let tables = read_fonts::FontRef::new(bytes).unwrap();
    let (glyf, loca) = (tables.glyf().unwrap(), tables.loca(None).unwrap());
    let mut drawn = 0;
    for glyph_id in 0..u32::from(font.maxp().unwrap().num_glyphs()) {
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
        let record = font
            .table_directory()
            .table_records()
            .iter()
            .find(|record| record.tag() == Tag::new(&tag))
            .unwrap();
        let (offset, length) = (record.offset() as usize, record.length() as usize);
        let glyph_count = u32::from(font.maxp().unwrap().num_glyphs());
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
