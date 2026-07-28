//! Fontations-to-Slug outline adapter.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::vec::Vec;

use pmndrs_text_slug_core::{
    BuildError, Cubic, GlyphGeometry, Point, Quadratic, build_glyph_geometry, cubic_to_quadratics,
    line_to_quadratic,
};
use skrifa::{
    FontRef, GlyphId, MetadataProvider,
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FontOutlineError {
    Allocation,
    Draw,
    InvalidContour,
    InvalidUnitsPerEm,
    Geometry(BuildError),
}

impl From<BuildError> for FontOutlineError {
    fn from(error: BuildError) -> Self {
        Self::Geometry(error)
    }
}

/// Resolve and normalize one font-local glyph into Slug's quadratic geometry.
pub fn font_glyph_geometry(
    font: &FontRef<'_>,
    glyph_id: GlyphId,
    band_count: u16,
) -> Result<Option<GlyphGeometry>, FontOutlineError> {
    let units_per_em = font
        .metrics(Size::unscaled(), LocationRef::default())
        .units_per_em as f32;
    if !units_per_em.is_finite() || units_per_em <= 0.0 {
        return Err(FontOutlineError::InvalidUnitsPerEm);
    }
    let Some(glyph) = font.outline_glyphs().get(glyph_id) else {
        return Ok(None);
    };
    let mut collector = Collector::new(units_per_em);
    glyph
        .draw(
            DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
            &mut collector,
        )
        .map_err(|_| FontOutlineError::Draw)?;
    let (curves, contours) = collector.finish()?;
    if curves.is_empty() {
        return Ok(None);
    }
    build_glyph_geometry(curves, contours, band_count)
        .map(Some)
        .map_err(FontOutlineError::from)
}

/// Read the font-local glyph count shared by shaping and dense raster records.
pub fn glyph_count(font: &FontRef<'_>) -> Result<u16, skrifa::raw::ReadError> {
    Ok(font.maxp()?.num_glyphs())
}

struct Collector {
    units_per_em: f32,
    curves: Vec<Quadratic>,
    contour_starts: Vec<u16>,
    first: Option<Point>,
    current: Option<Point>,
    failure: Option<FontOutlineError>,
}

impl Collector {
    fn new(units_per_em: f32) -> Self {
        Self {
            units_per_em,
            curves: Vec::new(),
            contour_starts: Vec::new(),
            first: None,
            current: None,
            failure: None,
        }
    }

    fn normalized(&self, x: f32, y: f32) -> Point {
        Point::new(x / self.units_per_em, y / self.units_per_em)
    }

    fn reserve_curve(&mut self, additional: usize) -> bool {
        if self.failure.is_some() {
            return false;
        }
        if self.curves.len().saturating_add(additional) > usize::from(u16::MAX)
            || self.curves.try_reserve(additional).is_err()
        {
            self.failure = Some(FontOutlineError::Allocation);
            return false;
        }
        true
    }

    fn push_curve(&mut self, curve: Quadratic) {
        if self.reserve_curve(1) {
            self.curves.push(curve);
            self.current = Some(curve.p2);
        }
    }

    fn finish(mut self) -> Result<(Vec<Quadratic>, Vec<u16>), FontOutlineError> {
        if self.current.is_some() {
            self.close();
        }
        if let Some(error) = self.failure {
            return Err(error);
        }
        Ok((self.curves, self.contour_starts))
    }
}

impl OutlinePen for Collector {
    fn move_to(&mut self, x: f32, y: f32) {
        if self.failure.is_some() {
            return;
        }
        if self.current.is_some() {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        }
        let Ok(start) = u16::try_from(self.curves.len()) else {
            self.failure = Some(FontOutlineError::Allocation);
            return;
        };
        if self.contour_starts.try_reserve(1).is_err() {
            self.failure = Some(FontOutlineError::Allocation);
            return;
        }
        let point = self.normalized(x, y);
        if !point.x.is_finite() || !point.y.is_finite() {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        }
        self.contour_starts.push(start);
        self.first = Some(point);
        self.current = Some(point);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let (Some(start), end) = (self.current, self.normalized(x, y)) else {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        };
        self.push_curve(line_to_quadratic(start, end, self.units_per_em));
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        let Some(start) = self.current else {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        };
        self.push_curve(Quadratic {
            p0: start,
            p1: self.normalized(control_x, control_y),
            p2: self.normalized(x, y),
        });
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
        let Some(start) = self.current else {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        };
        if !self.reserve_curve(2) {
            return;
        }
        let converted = cubic_to_quadratics(Cubic {
            p0: start,
            p1: self.normalized(first_control_x, first_control_y),
            p2: self.normalized(second_control_x, second_control_y),
            p3: self.normalized(x, y),
        });
        self.curves.extend_from_slice(&converted);
        self.current = Some(converted[1].p2);
    }

    fn close(&mut self) {
        let (Some(current), Some(first)) = (self.current, self.first) else {
            self.failure = Some(FontOutlineError::InvalidContour);
            return;
        };
        if current != first {
            self.push_curve(line_to_quadratic(current, first, self.units_per_em));
        }
        self.first = None;
        self.current = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmndrs_text_slug_core::DEFAULT_BAND_COUNT;

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );
    const DANCING_SCRIPT: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf"
    );

    #[test]
    fn reads_complete_inter_identity_and_geometry() {
        let font = FontRef::new(INTER).unwrap();
        assert_eq!(glyph_count(&font).unwrap(), 2937);
        let geometry = font_glyph_geometry(&font, GlyphId::new(43), DEFAULT_BAND_COUNT)
            .unwrap()
            .expect("Inter H outline");
        assert!(!geometry.curves.is_empty());
        assert_eq!(geometry.bands.horizontal.len(), 16);
        assert_eq!(geometry.bands.vertical.len(), 16);
        assert!(geometry.bounds.max_y > geometry.bounds.min_y);
    }

    #[test]
    fn converts_cff_cubics_without_nonfinite_output() {
        let font = FontRef::new(DANCING_SCRIPT).unwrap();
        let geometry = (0..glyph_count(&font).unwrap())
            .find_map(|raw_id| {
                font_glyph_geometry(&font, GlyphId::new(u32::from(raw_id)), DEFAULT_BAND_COUNT)
                    .unwrap()
                    .filter(|geometry| geometry.curves.len() > 12)
            })
            .expect("one non-trivial CFF outline");
        assert!(geometry.curves.iter().all(|curve| {
            [curve.p0, curve.p1, curve.p2]
                .iter()
                .all(|point| point.x.is_finite() && point.y.is_finite())
        }));
    }
}
