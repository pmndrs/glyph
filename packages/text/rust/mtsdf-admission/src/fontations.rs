use std::{hint::black_box, time::Instant};

use pmndrs_text_mtsdf_core::{Bounds, MtsdfGenerator, OutlineSink, OutlineSource};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    outline::{DrawSettings, OutlineGlyphFormat, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
};

use crate::{REGION, fnv1a};

pub struct FontationsOutlineSource<'a> {
    glyph: skrifa::outline::OutlineGlyph<'a>,
    bounds: Bounds,
    units_per_em: f32,
    reversed: bool,
}

impl OutlineSource for FontationsOutlineSource<'_> {
    type Error = skrifa::outline::DrawError;

    fn units_per_em(&self) -> f32 {
        self.units_per_em
    }

    fn bounds(&self) -> Bounds {
        self.bounds
    }

    fn emit(&self, sink: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
        sink.set_reversed(self.reversed);
        self.draw(&mut CollectorPen(sink))
    }
}

impl FontationsOutlineSource<'_> {
    pub fn draw(&self, pen: &mut impl OutlinePen) -> Result<(), skrifa::outline::DrawError> {
        self.glyph
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                pen,
            )
            .map(|_| ())
    }

    pub fn bounds(&self) -> Bounds {
        self.bounds
    }

    pub fn units_per_em(&self) -> f32 {
        self.units_per_em
    }

    pub fn reversed(&self) -> bool {
        self.reversed
    }
}

struct CollectorPen<'collector, 'storage>(&'collector mut OutlineSink<'storage>);

impl OutlinePen for CollectorPen<'_, '_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.quad_to(cx0, cy0, x, y);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.cubic_to(cx0, cy0, cx1, cy1, x, y);
    }

    fn close(&mut self) {
        self.0.close();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FontPassEvidence {
    pub elapsed_nanoseconds: u128,
    pub generated_glyphs: u32,
    pub skipped_glyphs: u32,
    pub rejected_glyphs: u32,
    pub checksum: u32,
}

pub fn measure_font_pass(
    font: FontRef<'_>,
    glyph_count: u16,
    generator: &mut MtsdfGenerator,
) -> FontPassEvidence {
    let start = Instant::now();
    let mut generated_glyphs = 0_u32;
    let mut skipped_glyphs = 0_u32;
    let mut rejected_glyphs = 0_u32;
    let mut checksum = 2_166_136_261_u32;
    for raw_glyph_id in 0..glyph_count {
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(source) = font_outline_source(&font, glyph_id) else {
            skipped_glyphs += 1;
            continue;
        };
        let Ok(mut outline) = generator.read_outline(&source) else {
            rejected_glyphs += 1;
            continue;
        };
        let Ok(bytes) = outline.generate_mtsdf(REGION) else {
            rejected_glyphs += 1;
            continue;
        };
        checksum ^= fnv1a(bytes);
        checksum = checksum.wrapping_mul(16_777_619);
        generated_glyphs += 1;
    }
    black_box(checksum);
    FontPassEvidence {
        elapsed_nanoseconds: start.elapsed().as_nanos(),
        generated_glyphs,
        skipped_glyphs,
        rejected_glyphs,
        checksum,
    }
}

pub fn font_outline_source<'font>(
    font: &'font FontRef<'font>,
    glyph_id: GlyphId,
) -> Option<FontationsOutlineSource<'font>> {
    let outlines = font.outline_glyphs();
    let glyph = outlines.get(glyph_id)?;
    let glyph_bounds = font
        .glyph_metrics(Size::unscaled(), LocationRef::default())
        .bounds(glyph_id)?;
    Some(FontationsOutlineSource {
        glyph,
        bounds: Bounds::new(
            glyph_bounds.x_min,
            glyph_bounds.y_min,
            glyph_bounds.x_max,
            glyph_bounds.y_max,
        ),
        units_per_em: font
            .metrics(Size::unscaled(), LocationRef::default())
            .units_per_em as f32,
        reversed: matches!(
            outlines.format(),
            Some(OutlineGlyphFormat::Cff | OutlineGlyphFormat::Cff2)
        ),
    })
}

pub fn glyph_count(font: &FontRef<'_>) -> Result<u16, skrifa::raw::ReadError> {
    Ok(font.maxp()?.num_glyphs())
}
