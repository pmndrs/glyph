//! Font outline → TrueType-model stream points (variant B) and the shared quadratic curve set.

use pmndrs_glyph_slug_core::{
    Cubic, MAX_CUBIC_SUBDIVISIONS, Point, Quadratic, cubic_to_quadratics_into,
};
use skrifa::outline::OutlinePen;

/// `(x << 1) | offCurve` must fit an i16.
const COORD_LIMIT: f32 = 16384.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    Line(Point, Point),
    Quad(Point, Point, Point),
}

impl Segment {
    fn start(self) -> Point {
        match self {
            Self::Line(a, _) | Self::Quad(a, _, _) => a,
        }
    }
    fn end(self) -> Point {
        match self {
            Self::Line(_, b) | Self::Quad(_, _, b) => b,
        }
    }
}

/// Collects closed contours of lines and quadratics in font units. CFF cubics become
/// `cubic_subdivisions` quadratics through slug-core, exactly as today's Slug bake splits them.
pub struct Pen {
    pub contours: Vec<Vec<Segment>>,
    cubic_subdivisions: u8,
    current: Vec<Segment>,
    first: Option<Point>,
    at: Option<Point>,
}

impl Pen {
    pub fn new(cubic_subdivisions: u8) -> Self {
        Self {
            contours: Vec::new(),
            cubic_subdivisions,
            current: Vec::new(),
            first: None,
            at: None,
        }
    }

    pub fn finish(mut self) -> Vec<Vec<Segment>> {
        self.close();
        self.contours
    }

    fn push(&mut self, segment: Segment) {
        self.current.push(segment);
        self.at = Some(segment.end());
    }
}

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.close();
        self.first = Some(Point::new(x, y));
        self.at = self.first;
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let start = self.at.expect("line_to after move_to");
        self.push(Segment::Line(start, Point::new(x, y)));
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let start = self.at.expect("quad_to after move_to");
        self.push(Segment::Quad(start, Point::new(cx, cy), Point::new(x, y)));
    }

    fn curve_to(&mut self, c1x: f32, c1y: f32, c2x: f32, c2y: f32, x: f32, y: f32) {
        let start = self.at.expect("curve_to after move_to");
        let zero = Quadratic {
            p0: start,
            p1: start,
            p2: start,
        };
        let mut pieces = [zero; MAX_CUBIC_SUBDIVISIONS];
        let cubic = Cubic {
            p0: start,
            p1: Point::new(c1x, c1y),
            p2: Point::new(c2x, c2y),
            p3: Point::new(x, y),
        };
        let written = cubic_to_quadratics_into(cubic, self.cubic_subdivisions, &mut pieces);
        for piece in &pieces[..written] {
            self.push(Segment::Quad(piece.p0, piece.p1, piece.p2));
        }
    }

    fn close(&mut self) {
        let (Some(at), Some(first)) = (self.at, self.first) else {
            return;
        };
        if at != first {
            self.push(Segment::Line(at, first));
        }
        if !self.current.is_empty() {
            self.contours.push(std::mem::take(&mut self.current));
        }
        self.first = None;
        self.at = None;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StreamPoint {
    pub x: i16,
    pub y: i16,
    pub off: bool,
}

impl StreamPoint {
    pub fn word(self) -> [u8; 4] {
        let x = ((i32::from(self.x) << 1) | i32::from(self.off)) as i16;
        let mut out = [0; 4];
        out[..2].copy_from_slice(&x.to_le_bytes());
        out[2..].copy_from_slice(&self.y.to_le_bytes());
        out
    }
    fn point(self) -> Point {
        Point::new(f32::from(self.x), f32::from(self.y))
    }
}

/// One curve of the shared set, in variant-B point order.
#[derive(Clone, Copy, Debug)]
pub struct Curve {
    /// Glyph-local point offset: the off-curve control, or a line's first on-curve point.
    pub point: u16,
    pub contour: u16,
    pub line: bool,
    /// Exact, font units. A line's control is its midpoint.
    pub quad: Quadratic,
}

#[derive(Default, Debug)]
pub struct Stats {
    pub contours: usize,
    pub segments: usize,
    pub implied_on_curve_recovered: usize,
    pub all_off_curve_contours: usize,
    pub all_off_curve_lossy: usize,
    pub rounded_points: usize,
    pub max_rounding: f32,
    pub max_source_error: f32,
}

pub struct GlyphPoints {
    /// Every contour rotated to start on-curve, with its wrap point appended.
    pub points: Vec<StreamPoint>,
    pub curves: Vec<Curve>,
    /// Font-order points of each contour (implied on-curve points removed, not rotated), for the triplet stream.
    pub source_contours: Vec<Vec<StreamPoint>>,
}

/// `recover_implied` is for TrueType sources only: CFF split points are always explicit.
pub fn glyph_points(
    contours: &[Vec<Segment>],
    recover_implied: bool,
    stats: &mut Stats,
) -> Result<GlyphPoints, String> {
    let mut out = GlyphPoints {
        points: Vec::new(),
        curves: Vec::new(),
        source_contours: Vec::new(),
    };
    for (contour_index, segments) in contours.iter().enumerate() {
        let contour = u16::try_from(contour_index).map_err(|_| "too many contours")?;
        let base = out.points.len();
        let (points, owners, source) = contour_points(segments, recover_implied, stats)?;
        stats.contours += 1;
        stats.segments += segments.len();
        out.source_contours.push(source);

        let mut derived_owners = Vec::with_capacity(segments.len());
        for i in 0..points.len() - 1 {
            let p = points[i];
            let next = points[i + 1];
            let (quad, line) = if p.off {
                let prev = points[i - 1];
                let start = if prev.off { mid(prev, p) } else { prev.point() };
                let end = if next.off { mid(p, next) } else { next.point() };
                (
                    Quadratic {
                        p0: start,
                        p1: p.point(),
                        p2: end,
                    },
                    false,
                )
            } else if !next.off {
                let (a, b) = (p.point(), next.point());
                (
                    Quadratic {
                        p0: a,
                        p1: midpoint(a, b),
                        p2: b,
                    },
                    true,
                )
            } else {
                continue;
            };
            let owner = owners[i].ok_or_else(|| {
                format!("contour {contour_index}: curve at point {i} has no source segment")
            })?;
            let source_line = matches!(segments[owner], Segment::Line(..));
            if source_line != line {
                return Err(format!(
                    "contour {contour_index}: curve kind differs from source segment {owner}"
                ));
            }
            let error = source_error(segments[owner], quad);
            stats.max_source_error = stats.max_source_error.max(error);
            derived_owners.push(owner);
            out.curves.push(Curve {
                point: u16::try_from(base + i).map_err(|_| "glyph has more than 65535 points")?,
                contour,
                line,
                quad,
            });
        }
        // Every source segment exactly once, in cyclic order.
        let m = segments.len();
        let rotation = derived_owners.first().copied().unwrap_or(0);
        if derived_owners.len() != m
            || derived_owners
                .iter()
                .enumerate()
                .any(|(j, &o)| o != (rotation + j) % m)
        {
            return Err(format!(
                "contour {contour_index}: {} derived curves do not cover {m} source segments in order",
                derived_owners.len()
            ));
        }
        out.points.extend_from_slice(&points);
    }
    Ok(out)
}

type ContourPoints = (Vec<StreamPoint>, Vec<Option<usize>>, Vec<StreamPoint>);

/// Returns the rotated points with the wrap point, the source segment each point owns (an off-curve point owns
/// its quadratic, an on-curve point owns the line it starts), and the unrotated font-order points.
fn contour_points(
    segments: &[Segment],
    recover_implied: bool,
    stats: &mut Stats,
) -> Result<ContourPoints, String> {
    let m = segments.len();
    for k in 0..m {
        if segments[k].end() != segments[(k + 1) % m].start() {
            return Err(format!("discontinuous contour at segment {k}"));
        }
    }
    // Every segment contributes its on-curve start, then its control.
    let mut raw: Vec<(Point, bool, Option<usize>)> = Vec::with_capacity(2 * m);
    for (k, segment) in segments.iter().enumerate() {
        match *segment {
            Segment::Line(a, _) => raw.push((a, false, Some(k))),
            Segment::Quad(a, c, _) => {
                raw.push((a, false, None));
                raw.push((c, true, Some(k)));
            }
        }
    }
    // TrueType implied on-curve points: an on-curve point exactly at the midpoint of two off-curve neighbours.
    let n = raw.len();
    let implied: Vec<bool> = (0..n)
        .map(|i| {
            let (p, off, _) = raw[i];
            let (a, a_off, _) = raw[(i + n - 1) % n];
            let (b, b_off, _) = raw[(i + 1) % n];
            recover_implied
                && !off
                && a_off
                && b_off
                && p.x * 2.0 == a.x + b.x
                && p.y * 2.0 == a.y + b.y
        })
        .collect();
    let mut kept = Vec::with_capacity(n);
    for (i, &(p, off, owner)) in raw.iter().enumerate() {
        if implied[i] {
            stats.implied_on_curve_recovered += 1;
            continue;
        }
        kept.push((round_point(p, off, stats)?, owner));
    }
    let source: Vec<StreamPoint> = kept.iter().map(|(p, _)| *p).collect();

    let start = match kept.iter().position(|(p, _)| !p.off) {
        Some(start) => start,
        None => {
            // No on-curve point: insert one at a neighbour midpoint, exactly where some pair sums to even
            // coordinates, otherwise rounded (lossy, and visible in the source error).
            stats.all_off_curve_contours += 1;
            let len = kept.len();
            let pair = (0..len).find(|&k| {
                let (a, b) = (kept[k].0, kept[(k + 1) % len].0);
                (i32::from(a.x) + i32::from(b.x)) % 2 == 0
                    && (i32::from(a.y) + i32::from(b.y)) % 2 == 0
            });
            if pair.is_none() {
                stats.all_off_curve_lossy += 1;
            }
            let k = pair.unwrap_or(len - 1);
            let (a, b) = (kept[k].0, kept[(k + 1) % len].0);
            let m = midpoint(a.point(), b.point());
            let synth = StreamPoint {
                x: m.x.round() as i16,
                y: m.y.round() as i16,
                off: false,
            };
            kept.insert(k + 1, (synth, None));
            k + 1
        }
    };
    kept.rotate_left(start);
    let wrap = (kept[0].0, None);
    kept.push(wrap);
    let (points, owners) = kept.into_iter().unzip();
    Ok((points, owners, source))
}

fn round_point(p: Point, off: bool, stats: &mut Stats) -> Result<StreamPoint, String> {
    if !(p.x.abs() < COORD_LIMIT && p.y.abs() < COORD_LIMIT) {
        return Err(format!(
            "point ({}, {}) is outside |coordinate| < 16384",
            p.x, p.y
        ));
    }
    let (x, y) = (p.x.round(), p.y.round());
    let delta = (x - p.x).abs().max((y - p.y).abs());
    if delta > 0.0 {
        stats.rounded_points += 1;
        stats.max_rounding = stats.max_rounding.max(delta);
    }
    Ok(StreamPoint {
        x: x as i16,
        y: y as i16,
        off,
    })
}

fn source_error(segment: Segment, quad: Quadratic) -> f32 {
    let d = |a: Point, b: Point| (a.x - b.x).abs().max((a.y - b.y).abs());
    match segment {
        Segment::Line(a, b) => d(a, quad.p0).max(d(b, quad.p2)),
        Segment::Quad(a, c, b) => d(a, quad.p0).max(d(c, quad.p1)).max(d(b, quad.p2)),
    }
}

fn mid(a: StreamPoint, b: StreamPoint) -> Point {
    midpoint(a.point(), b.point())
}

pub fn midpoint(a: Point, b: Point) -> Point {
    Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5)
}
