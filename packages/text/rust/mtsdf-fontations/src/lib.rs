//! Shared Fontations provider for the repository-owned MTSDF core.

#![cfg_attr(not(feature = "std"), no_std)]

use pmndrs_text_mtsdf_core::{Bounds, OutlineSink, OutlineSource};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    outline::{DrawSettings, OutlineGlyphFormat, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
};

/// One unscaled Fontations glyph presented through the MTSDF outline contract.
pub struct FontationsOutlineSource<'font> {
    glyph: skrifa::outline::OutlineGlyph<'font>,
    bounds: Bounds,
    units_per_em: f32,
    reversed: bool,
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

/// Resolve one glyph without reparsing or flattening its maintained font outline.
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

/// Read the font-local glyph count used by shaping and dense raster records.
pub fn glyph_count(font: &FontRef<'_>) -> Result<u16, skrifa::raw::ReadError> {
    Ok(font.maxp()?.num_glyphs())
}

struct CollectorPen<'sink, 'storage>(&'sink mut OutlineSink<'storage>);

impl OutlinePen for CollectorPen<'_, '_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        self.0.quad_to(control_x, control_y, x, y);
    }

    fn curve_to(
        &mut self,
        first_control_x: f32,
        first_control_y: f32,
        second_control_x: f32,
        second_control_y: f32,
        x: f32,
        y: f32,
    ) {
        self.0.cubic_to(
            first_control_x,
            first_control_y,
            second_control_x,
            second_control_y,
            x,
            y,
        );
    }

    fn close(&mut self) {
        self.0.close();
    }
}
