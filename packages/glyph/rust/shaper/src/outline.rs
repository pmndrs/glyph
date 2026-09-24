//! Unhinted glyph outlines at the default instance, decoded from the `glyf`/`loca` or `CFF ` table
//! a bake keeps in its outline SFNT, through the read-fonts that HarfRust already links.
//!
//! TrueType glyphs follow Skrifa's FreeType-style unscaled loader, so both draw the same segments:
//! 26.6 fixed-point points, 16.16 fixed-point composite transforms applied before matched-point
//! anchors, and FreeType's rules for off-curve contour starts. Like FreeType, and unlike Skrifa, an
//! anchor that names a point not yet placed is refused. Composites nest at most 32 levels deep. CFF
//! glyphs use read-fonts' charstring evaluator. [`draw_glyph`] emits the raw segments, and
//! [`GlyphOutline`] turns them into the closed quadratic contours `outlineAt()` returns.

use alloc::vec::Vec;
use pmndrs_glyph_slug_core::{
    Cubic, MAX_CUBIC_SUBDIVISIONS, Point, Quadratic, cubic_to_quadratics_into,
};
use read_fonts::{
    FontRef, TableProvider,
    model::pen::OutlinePen,
    ps::cff::CffFontRef,
    tables::{
        glyf::{
            Anchor, CompositeGlyph, CompositeGlyphFlags, Glyf, Glyph, PointCoord, PointFlags,
            SimpleGlyph,
        },
        loca::Loca,
    },
    types::{F26Dot6, Fixed, GlyphId, Point as FontPoint, Tag},
};

/// The outline SFNT or one of its glyphs could not be drawn.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutlineError {
    /// The bytes are not an SFNT with `head`, `maxp`, and a `glyf`/`loca` or `CFF ` outline table.
    InvalidFont,
    /// The glyph ID is outside the font, or its outline data is malformed.
    InvalidGlyph,
    /// Allocation failed while decoding.
    OutOfMemory,
}

/// Draws one glyph's raw segments to `pen`: lines, quadratics, and cubics in font units, y up.
pub fn draw_glyph(
    font: &[u8],
    glyph_id: u32,
    pen: &mut impl OutlinePen,
) -> Result<(), OutlineError> {
    let font = FontRef::new(font).map_err(|_| OutlineError::InvalidFont)?;
    let glyph_count = font
        .maxp()
        .map_err(|_| OutlineError::InvalidFont)?
        .num_glyphs();
    if glyph_id >= u32::from(glyph_count) {
        return Err(OutlineError::InvalidGlyph);
    }
    let glyph_id = GlyphId::new(glyph_id);
    if let (Ok(glyf), Ok(loca)) = (font.glyf(), font.loca(None)) {
        let mut loader = GlyfLoader {
            glyf,
            loca,
            points: Vec::new(),
            flags: Vec::new(),
            contour_last_points: Vec::new(),
        };
        loader.load(glyph_id, 0)?;
        return loader.to_path(pen);
    }
    let cff = font
        .table_data(Tag::new(b"CFF "))
        .ok_or(OutlineError::InvalidFont)?;
    let upem = font
        .head()
        .map_err(|_| OutlineError::InvalidFont)?
        .units_per_em();
    let cff = CffFontRef::new_cff(cff.as_bytes(), 0, Some(i32::from(upem)))
        .map_err(|_| OutlineError::InvalidFont)?;
    let subfont = cff
        .subfont(cff.subfont_index(glyph_id).unwrap_or(0), &[])
        .map_err(|_| OutlineError::InvalidGlyph)?;
    cff.draw(&subfont, glyph_id, &[], None, pen)
        .map_err(|_| OutlineError::InvalidGlyph)?;
    Ok(())
}

struct GlyfLoader<'a> {
    glyf: Glyf<'a>,
    loca: Loca<'a>,
    points: Vec<FontPoint<F26Dot6>>,
    flags: Vec<PointFlags>,
    contour_last_points: Vec<usize>,
}

impl GlyfLoader<'_> {
    fn load(&mut self, glyph_id: GlyphId, depth: usize) -> Result<(), OutlineError> {
        if depth > 32 {
            return Err(OutlineError::InvalidGlyph);
        }
        match self
            .loca
            .get_glyf(glyph_id, &self.glyf)
            .map_err(|_| OutlineError::InvalidGlyph)?
        {
            None => Ok(()),
            Some(Glyph::Simple(glyph)) => self.load_simple(&glyph),
            Some(Glyph::Composite(glyph)) => self.load_composite(&glyph, depth),
        }
    }

    fn load_simple(&mut self, glyph: &SimpleGlyph<'_>) -> Result<(), OutlineError> {
        let start = self.points.len();
        let count = glyph.num_points();
        let ends = glyph.end_pts_of_contours();
        self.points
            .try_reserve(count)
            .map_err(|_| OutlineError::OutOfMemory)?;
        self.flags
            .try_reserve(count)
            .map_err(|_| OutlineError::OutOfMemory)?;
        self.contour_last_points
            .try_reserve(ends.len())
            .map_err(|_| OutlineError::OutOfMemory)?;
        self.points.resize(start + count, FontPoint::default());
        self.flags.resize(start + count, PointFlags::default());
        glyph
            .read_points_fast(&mut self.points[start..], &mut self.flags[start..])
            .map_err(|_| OutlineError::InvalidGlyph)?;
        let mut previous = 0;
        for end in ends {
            let end = end.get();
            if end < previous {
                return Err(OutlineError::InvalidGlyph);
            }
            previous = end;
            self.contour_last_points.push(start + usize::from(end));
        }
        Ok(())
    }

    fn load_composite(
        &mut self,
        glyph: &CompositeGlyph<'_>,
        depth: usize,
    ) -> Result<(), OutlineError> {
        let glyph_start = self.points.len();
        for component in glyph.components() {
            let start = self.points.len();
            self.load(component.glyph.into(), depth + 1)?;
            let end = self.points.len();
            let matrix = component.transform;
            let [xx, yx, xy, yy] = [matrix.xx, matrix.yx, matrix.xy, matrix.yy]
                .map(|value| Fixed::from_bits(i32::from(value.to_bits()) * 4));
            let has_transform = component.flags.intersects(
                CompositeGlyphFlags::WE_HAVE_A_SCALE
                    | CompositeGlyphFlags::WE_HAVE_AN_X_AND_Y_SCALE
                    | CompositeGlyphFlags::WE_HAVE_A_TWO_BY_TWO,
            );
            if has_transform {
                for point in &mut self.points[start..end] {
                    let (x, y) = (
                        Fixed::from_bits(point.x.to_i32()),
                        Fixed::from_bits(point.y.to_i32()),
                    );
                    *point = FontPoint::new(
                        F26Dot6::from_i32((x * xx + y * xy).to_bits()),
                        F26Dot6::from_i32((x * yx + y * yy).to_bits()),
                    );
                }
            }
            let offset = match component.anchor {
                Anchor::Offset { x, y } => {
                    let (mut x, mut y) = (i32::from(x), i32::from(y));
                    let offset_flags = CompositeGlyphFlags::SCALED_COMPONENT_OFFSET
                        | CompositeGlyphFlags::UNSCALED_COMPONENT_OFFSET;
                    if has_transform
                        && component.flags & offset_flags
                            == CompositeGlyphFlags::SCALED_COMPONENT_OFFSET
                    {
                        x = (Fixed::from_bits(x) * freetype_hypot(xx, xy)).to_bits();
                        y = (Fixed::from_bits(y) * freetype_hypot(yy, yx)).to_bits();
                    }
                    FontPoint::new(F26Dot6::from_i32(x), F26Dot6::from_i32(y))
                }
                Anchor::Point { base, component } => {
                    let base = self.points[glyph_start..start]
                        .get(usize::from(base))
                        .ok_or(OutlineError::InvalidGlyph)?;
                    let component = self.points[start..end]
                        .get(usize::from(component))
                        .ok_or(OutlineError::InvalidGlyph)?;
                    *base - *component
                }
            };
            for point in &mut self.points[start..end] {
                *point += offset;
            }
        }
        Ok(())
    }

    fn to_path(&self, pen: &mut impl OutlinePen) -> Result<(), OutlineError> {
        let mut start = 0;
        for &end in &self.contour_last_points {
            if end < start || end >= self.points.len() {
                return Err(OutlineError::InvalidGlyph);
            }
            let points = &self.points[start..=end];
            let flags = &self.flags[start..=end];
            start = end + 1;
            let contour = points
                .iter()
                .zip(flags)
                .map(|(point, flags)| (*point, *flags));
            contour_to_path(contour, pen)?;
        }
        Ok(())
    }
}

fn freetype_hypot(a: Fixed, b: Fixed) -> Fixed {
    let (a, b) = (a.to_bits().abs(), b.to_bits().abs());
    Fixed::from_bits(if a > b {
        a + ((3 * b) >> 3)
    } else {
        b + ((3 * a) >> 3)
    })
}

fn contour_to_path<C: PointCoord>(
    mut contour: impl ExactSizeIterator<Item = (FontPoint<C>, PointFlags)> + Clone,
    pen: &mut impl OutlinePen,
) -> Result<(), OutlineError> {
    let (Some(first), Some(last)) = (contour.clone().next(), contour.clone().last()) else {
        return Ok(());
    };
    if first.1.is_off_curve_cubic() {
        return Err(OutlineError::InvalidGlyph);
    }
    let count = contour.len();
    let mut omit_last = false;
    let start = if first.1.is_off_curve_quad() {
        if last.1.is_on_curve() {
            omit_last = true;
            last.0
        } else {
            midpoint(last.0, first.0)
        }
    } else {
        contour.next();
        first.0
    };
    pen.move_to(start.x.to_f32(), start.y.to_f32());
    let mut pending = Pending::Empty;
    let remaining = if omit_last { count - 1 } else { contour.len() };
    for point in contour.take(remaining) {
        pending.emit(point, pen)?;
    }
    if !matches!(pending, Pending::Empty) {
        pending.emit((start, PointFlags::on_curve()), pen)?;
    }
    pen.close();
    Ok(())
}

fn midpoint<C: PointCoord>(a: FontPoint<C>, b: FontPoint<C>) -> FontPoint<C> {
    FontPoint::new(a.x.midpoint(b.x), a.y.midpoint(b.y))
}

#[derive(Clone, Copy)]
enum Pending<C> {
    Empty,
    Quad(FontPoint<C>),
    Cubic(FontPoint<C>),
    TwoCubics(FontPoint<C>, FontPoint<C>),
}

impl<C: PointCoord> Pending<C> {
    fn emit(
        &mut self,
        (point, flags): (FontPoint<C>, PointFlags),
        pen: &mut impl OutlinePen,
    ) -> Result<(), OutlineError> {
        let f = |point: FontPoint<C>| (point.x.to_f32(), point.y.to_f32());
        *self = match *self {
            Self::Empty if flags.is_off_curve_quad() => Self::Quad(point),
            Self::Empty if flags.is_off_curve_cubic() => Self::Cubic(point),
            Self::Empty => {
                let (x, y) = f(point);
                pen.line_to(x, y);
                Self::Empty
            }
            Self::Quad(control) if flags.is_off_curve_quad() => {
                let ((cx, cy), (x, y)) = (f(control), f(midpoint(control, point)));
                pen.quad_to(cx, cy, x, y);
                Self::Quad(point)
            }
            Self::Quad(_) if flags.is_off_curve_cubic() => return Err(OutlineError::InvalidGlyph),
            Self::Quad(control) => {
                let ((cx, cy), (x, y)) = (f(control), f(point));
                pen.quad_to(cx, cy, x, y);
                Self::Empty
            }
            Self::Cubic(first) if flags.is_off_curve_cubic() => Self::TwoCubics(first, point),
            Self::Cubic(_) => return Err(OutlineError::InvalidGlyph),
            Self::TwoCubics(..) if flags.is_off_curve_quad() => {
                return Err(OutlineError::InvalidGlyph);
            }
            Self::TwoCubics(first, second) if flags.is_off_curve_cubic() => {
                let ((ax, ay), (bx, by), (x, y)) =
                    (f(first), f(second), f(midpoint(second, point)));
                pen.curve_to(ax, ay, bx, by, x, y);
                Self::Cubic(point)
            }
            Self::TwoCubics(first, second) => {
                let ((ax, ay), (bx, by), (x, y)) = (f(first), f(second), f(point));
                pen.curve_to(ax, ay, bx, by, x, y);
                Self::Empty
            }
        };
        Ok(())
    }
}

/// One glyph as closed quadratic contours in font units, reused across calls.
///
/// A contour of `n` curves holds `2n + 1` points, `start, control, end, control, end, ...`, and its
/// last point repeats its first. A line becomes the quadratic whose control is its midpoint, and a
/// cubic becomes four equal-parameter quadratics.
#[derive(Default)]
pub struct GlyphOutline {
    points: Vec<Point>,
    contour_ends: Vec<u32>,
    open_contour_start: Option<usize>,
    failure: Option<OutlineError>,
}

impl GlyphOutline {
    /// Replaces the contents with one glyph of `font`.
    pub fn decode(&mut self, font: &[u8], glyph_id: u32) -> Result<(), OutlineError> {
        self.points.clear();
        self.contour_ends.clear();
        self.open_contour_start = None;
        self.failure = None;
        let drawn = draw_glyph(font, glyph_id, self);
        if self.open_contour_start.is_some() {
            self.close();
        }
        drawn?;
        match self.failure.take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Replaces `out` with the wire form the host reads: little-endian `u32` contour count, then
    /// each contour's exclusive end point index as `u32`, then every point as `f32` `x, y`.
    pub fn encode(&self, out: &mut Vec<u8>) -> Result<(), OutlineError> {
        let contours =
            u32::try_from(self.contour_ends.len()).map_err(|_| OutlineError::OutOfMemory)?;
        let length = 4 + self.contour_ends.len() * 4 + self.points.len() * 8;
        out.clear();
        out.try_reserve_exact(length)
            .map_err(|_| OutlineError::OutOfMemory)?;
        out.extend_from_slice(&contours.to_le_bytes());
        for end in &self.contour_ends {
            out.extend_from_slice(&end.to_le_bytes());
        }
        for point in &self.points {
            out.extend_from_slice(&point.x.to_le_bytes());
            out.extend_from_slice(&point.y.to_le_bytes());
        }
        Ok(())
    }

    pub fn points(&self) -> &[Point] {
        &self.points
    }

    pub fn contour_ends(&self) -> &[u32] {
        &self.contour_ends
    }

    fn current(&mut self) -> Option<Point> {
        if self.open_contour_start.is_none() {
            self.fail(OutlineError::InvalidGlyph);
            return None;
        }
        self.points.last().copied()
    }

    fn push(&mut self, points: &[Point]) {
        if self.failure.is_some() {
            return;
        }
        if points
            .iter()
            .any(|point| !point.x.is_finite() || !point.y.is_finite())
        {
            self.fail(OutlineError::InvalidGlyph);
        } else if self.points.try_reserve(points.len()).is_err() {
            self.fail(OutlineError::OutOfMemory);
        } else {
            self.points.extend_from_slice(points);
        }
    }

    fn fail(&mut self, error: OutlineError) {
        self.failure.get_or_insert(error);
    }
}

impl OutlinePen for GlyphOutline {
    fn move_to(&mut self, x: f32, y: f32) {
        if self.open_contour_start.is_some() {
            self.close();
        }
        self.open_contour_start = Some(self.points.len());
        self.push(&[Point::new(x, y)]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let Some(start) = self.current() else { return };
        let end = Point::new(x, y);
        self.push(&[line_control(start, end), end]);
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        if self.current().is_none() {
            return;
        }
        self.push(&[Point::new(control_x, control_y), Point::new(x, y)]);
    }

    fn curve_to(
        &mut self,
        first_x: f32,
        first_y: f32,
        second_x: f32,
        second_y: f32,
        x: f32,
        y: f32,
    ) {
        let Some(start) = self.current() else { return };
        let mut quadratics = [Quadratic {
            p0: start,
            p1: start,
            p2: start,
        }; MAX_CUBIC_SUBDIVISIONS];
        let count = cubic_to_quadratics_into(
            Cubic {
                p0: start,
                p1: Point::new(first_x, first_y),
                p2: Point::new(second_x, second_y),
                p3: Point::new(x, y),
            },
            4,
            &mut quadratics,
        );
        for quadratic in &quadratics[..count] {
            self.push(&[quadratic.p1, quadratic.p2]);
        }
    }

    fn close(&mut self) {
        let Some(start) = self.open_contour_start.take() else {
            self.fail(OutlineError::InvalidGlyph);
            return;
        };
        if self.failure.is_some() {
            return;
        }
        let first = self.points[start];
        let last = self.points[self.points.len() - 1];
        if last != first {
            self.push(&[line_control(last, first), first]);
        }
        if self.points.len() - start < 3 {
            self.points.truncate(start);
            return;
        }
        match u32::try_from(self.points.len()) {
            Ok(end) if self.contour_ends.try_reserve(1).is_ok() => self.contour_ends.push(end),
            Ok(_) => self.fail(OutlineError::OutOfMemory),
            Err(_) => self.fail(OutlineError::OutOfMemory),
        }
    }
}

fn line_control(start: Point, end: Point) -> Point {
    Point::new((start.x + end.x) * 0.5, (start.y + end.y) * 0.5)
}
