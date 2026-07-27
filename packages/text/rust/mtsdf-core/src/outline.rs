use alloc::vec::Vec;
use core::ops::Range;

use crate::math::Point;

pub(crate) const RED: u8 = 0b001;
pub(crate) const GREEN: u8 = 0b010;
pub(crate) const BLUE: u8 = 0b100;
pub(crate) const WHITE: u8 = RED | GREEN | BLUE;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl Bounds {
    pub const fn new(min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    pub(crate) fn is_valid(self) -> bool {
        self.min_x.is_finite()
            && self.min_y.is_finite()
            && self.max_x.is_finite()
            && self.max_y.is_finite()
            && self.max_x > self.min_x
            && self.max_y > self.min_y
    }

    pub(crate) fn width(self) -> f32 {
        self.max_x - self.min_x
    }

    pub(crate) fn height(self) -> f32 {
        self.max_y - self.min_y
    }
}

pub trait OutlineSource {
    type Error;

    fn units_per_em(&self) -> f32;
    fn bounds(&self) -> Bounds;
    fn emit(&self, sink: &mut OutlineSink<'_>) -> Result<(), Self::Error>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BuildFailure {
    Allocation,
    EdgeLimit,
    NonFiniteCoordinate,
    MissingMove,
    NestedMove,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Edge {
    Line { points: [Point; 2], color: u8 },
    Quadratic { points: [Point; 3], color: u8 },
    Cubic { points: [Point; 4], color: u8 },
}

impl Edge {
    pub(crate) fn start(self) -> Point {
        match self {
            Self::Line { points, .. } => points[0],
            Self::Quadratic { points, .. } => points[0],
            Self::Cubic { points, .. } => points[0],
        }
    }

    pub(crate) fn end(self) -> Point {
        match self {
            Self::Line { points, .. } => points[1],
            Self::Quadratic { points, .. } => points[2],
            Self::Cubic { points, .. } => points[3],
        }
    }

    pub(crate) fn point(self, t: f32) -> Point {
        match self {
            Self::Line { points, .. } => points[0].lerp(points[1], t),
            Self::Quadratic { points, .. } => {
                let one_minus_t = 1.0 - t;
                points[0] * (one_minus_t * one_minus_t)
                    + points[1] * (2.0 * one_minus_t * t)
                    + points[2] * (t * t)
            }
            Self::Cubic { points, .. } => {
                let one_minus_t = 1.0 - t;
                let one_minus_t_squared = one_minus_t * one_minus_t;
                let t_squared = t * t;
                points[0] * (one_minus_t_squared * one_minus_t)
                    + points[1] * (3.0 * one_minus_t_squared * t)
                    + points[2] * (3.0 * one_minus_t * t_squared)
                    + points[3] * (t_squared * t)
            }
        }
    }

    pub(crate) fn direction_at_start(self) -> Point {
        match self {
            Self::Line { points, .. } => points[1] - points[0],
            Self::Quadratic { points, .. } => (points[1] - points[0]) * 2.0,
            Self::Cubic { points, .. } => (points[1] - points[0]) * 3.0,
        }
    }

    pub(crate) fn direction_at_end(self) -> Point {
        match self {
            Self::Line { points, .. } => points[1] - points[0],
            Self::Quadratic { points, .. } => (points[2] - points[1]) * 2.0,
            Self::Cubic { points, .. } => (points[3] - points[2]) * 3.0,
        }
    }

    pub(crate) fn set_color(&mut self, value: u8) {
        match self {
            Self::Line { color, .. }
            | Self::Quadratic { color, .. }
            | Self::Cubic { color, .. } => *color = value,
        }
    }

    pub(crate) fn reverse(self) -> Self {
        match self {
            Self::Line { points, color } => Self::Line {
                points: [points[1], points[0]],
                color,
            },
            Self::Quadratic { points, color } => Self::Quadratic {
                points: [points[2], points[1], points[0]],
                color,
            },
            Self::Cubic { points, color } => Self::Cubic {
                points: [points[3], points[2], points[1], points[0]],
                color,
            },
        }
    }

    pub(crate) fn split_in_thirds(self) -> [Self; 3] {
        let (first, remainder) = self.split(1.0 / 3.0);
        let (second, third) = remainder.split(0.5);
        [first, second, third]
    }

    fn split(self, t: f32) -> (Self, Self) {
        match self {
            Self::Line { points, color } => {
                let middle = points[0].lerp(points[1], t);
                (
                    Self::Line {
                        points: [points[0], middle],
                        color,
                    },
                    Self::Line {
                        points: [middle, points[1]],
                        color,
                    },
                )
            }
            Self::Quadratic { points, color } => {
                let a = points[0].lerp(points[1], t);
                let b = points[1].lerp(points[2], t);
                let middle = a.lerp(b, t);
                (
                    Self::Quadratic {
                        points: [points[0], a, middle],
                        color,
                    },
                    Self::Quadratic {
                        points: [middle, b, points[2]],
                        color,
                    },
                )
            }
            Self::Cubic { points, color } => {
                let a = points[0].lerp(points[1], t);
                let b = points[1].lerp(points[2], t);
                let c = points[2].lerp(points[3], t);
                let d = a.lerp(b, t);
                let e = b.lerp(c, t);
                let middle = d.lerp(e, t);
                (
                    Self::Cubic {
                        points: [points[0], a, d, middle],
                        color,
                    },
                    Self::Cubic {
                        points: [middle, e, c, points[3]],
                        color,
                    },
                )
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct OutlineStorage {
    pub(crate) edges: Vec<Edge>,
    pub(crate) contours: Vec<Range<usize>>,
}

impl OutlineStorage {
    pub(crate) fn clear(&mut self) {
        self.edges.clear();
        self.contours.clear();
    }
}

pub struct OutlineSink<'a> {
    storage: &'a mut OutlineStorage,
    max_edges: usize,
    contour_start: Option<usize>,
    first: Point,
    current: Point,
    reversed: bool,
    failure: Option<BuildFailure>,
}

impl<'a> OutlineSink<'a> {
    pub(crate) fn new(storage: &'a mut OutlineStorage, max_edges: usize) -> Self {
        Self {
            storage,
            max_edges,
            contour_start: None,
            first: Point::ZERO,
            current: Point::ZERO,
            reversed: false,
            failure: None,
        }
    }

    pub fn set_reversed(&mut self, reversed: bool) {
        self.reversed = reversed;
    }

    pub fn move_to(&mut self, x: f32, y: f32) {
        let point = Point::new(x, y);
        if !point.is_finite() {
            self.fail(BuildFailure::NonFiniteCoordinate);
        } else if self.contour_start.is_some() {
            self.fail(BuildFailure::NestedMove);
        } else {
            self.contour_start = Some(self.storage.edges.len());
            self.first = point;
            self.current = point;
        }
    }

    pub fn line_to(&mut self, x: f32, y: f32) {
        let end = Point::new(x, y);
        self.push_edge(Edge::Line {
            points: [self.current, end],
            color: WHITE,
        });
        self.current = end;
    }

    pub fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let control = Point::new(cx, cy);
        let end = Point::new(x, y);
        self.push_edge(Edge::Quadratic {
            points: [self.current, control, end],
            color: WHITE,
        });
        self.current = end;
    }

    pub fn cubic_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let control_a = Point::new(cx0, cy0);
        let control_b = Point::new(cx1, cy1);
        let end = Point::new(x, y);
        self.push_edge(Edge::Cubic {
            points: [self.current, control_a, control_b, end],
            color: WHITE,
        });
        self.current = end;
    }

    pub fn close(&mut self) {
        let Some(start) = self.contour_start else {
            self.fail(BuildFailure::MissingMove);
            return;
        };
        if self.current != self.first {
            self.push_edge(Edge::Line {
                points: [self.current, self.first],
                color: WHITE,
            });
        }
        self.contour_start = None;
        let end = self.storage.edges.len();
        if end > start {
            if self.reversed {
                self.storage.edges[start..end].reverse();
                for edge in &mut self.storage.edges[start..end] {
                    *edge = edge.reverse();
                }
            }
            if self.storage.contours.try_reserve(1).is_err() {
                self.fail(BuildFailure::Allocation);
                return;
            }
            self.storage.contours.push(start..end);
        }
    }

    pub(crate) fn finish(mut self) -> Result<(), BuildFailure> {
        if self.contour_start.is_some() {
            self.close();
        }
        match self.failure {
            Some(failure) => Err(failure),
            None => Ok(()),
        }
    }

    fn push_edge(&mut self, edge: Edge) {
        if self.failure.is_some() {
            return;
        }
        if self.contour_start.is_none() {
            self.fail(BuildFailure::MissingMove);
            return;
        }
        if !edge.start().is_finite() || !edge.end().is_finite() {
            self.fail(BuildFailure::NonFiniteCoordinate);
            return;
        }
        match edge {
            Edge::Quadratic { points, .. } if !points[1].is_finite() => {
                self.fail(BuildFailure::NonFiniteCoordinate);
                return;
            }
            Edge::Cubic { points, .. } if !points[1].is_finite() || !points[2].is_finite() => {
                self.fail(BuildFailure::NonFiniteCoordinate);
                return;
            }
            _ => {}
        }
        if self.storage.edges.len() >= self.max_edges {
            self.fail(BuildFailure::EdgeLimit);
            return;
        }
        if self.storage.edges.try_reserve(1).is_err() {
            self.fail(BuildFailure::Allocation);
            return;
        }
        self.storage.edges.push(edge);
    }

    fn fail(&mut self, failure: BuildFailure) {
        if self.failure.is_none() {
            self.failure = Some(failure);
        }
    }
}

#[derive(Default)]
pub(crate) struct LineSoa {
    pub(crate) x0: Vec<f32>,
    pub(crate) y0: Vec<f32>,
    pub(crate) x1: Vec<f32>,
    pub(crate) y1: Vec<f32>,
    pub(crate) color: Vec<u8>,
    pub(crate) contour: Vec<u32>,
}

#[derive(Default)]
pub(crate) struct QuadraticSoa {
    pub(crate) x0: Vec<f32>,
    pub(crate) y0: Vec<f32>,
    pub(crate) cx: Vec<f32>,
    pub(crate) cy: Vec<f32>,
    pub(crate) x1: Vec<f32>,
    pub(crate) y1: Vec<f32>,
    pub(crate) color: Vec<u8>,
    pub(crate) contour: Vec<u32>,
}

#[derive(Default)]
pub(crate) struct CubicSoa {
    pub(crate) x0: Vec<f32>,
    pub(crate) y0: Vec<f32>,
    pub(crate) cx0: Vec<f32>,
    pub(crate) cy0: Vec<f32>,
    pub(crate) cx1: Vec<f32>,
    pub(crate) cy1: Vec<f32>,
    pub(crate) x1: Vec<f32>,
    pub(crate) y1: Vec<f32>,
    pub(crate) color: Vec<u8>,
    pub(crate) contour: Vec<u32>,
}

#[derive(Default)]
pub(crate) struct EdgeSoa {
    pub(crate) lines: LineSoa,
    pub(crate) quadratics: QuadraticSoa,
    pub(crate) cubics: CubicSoa,
    pub(crate) contour_windings: Vec<i8>,
}

impl EdgeSoa {
    pub(crate) fn populate(
        &mut self,
        edges: &[Edge],
        contours: &[Range<usize>],
    ) -> Result<(), BuildFailure> {
        self.clear();
        let mut line_count = 0;
        let mut quadratic_count = 0;
        let mut cubic_count = 0;
        for edge in edges {
            match edge {
                Edge::Line { .. } => line_count += 1,
                Edge::Quadratic { .. } => quadratic_count += 1,
                Edge::Cubic { .. } => cubic_count += 1,
            }
        }
        self.lines.reserve(line_count)?;
        self.quadratics.reserve(quadratic_count)?;
        self.cubics.reserve(cubic_count)?;
        self.contour_windings
            .try_reserve(contours.len())
            .map_err(|_| BuildFailure::Allocation)?;
        for (contour_index, contour) in contours.iter().enumerate() {
            self.contour_windings
                .push(contour_winding(&edges[contour.clone()]));
            let contour_index =
                u32::try_from(contour_index).map_err(|_| BuildFailure::EdgeLimit)?;
            for edge in &edges[contour.clone()] {
                match *edge {
                    Edge::Line { points, color } => {
                        self.lines.push(points, color, contour_index);
                    }
                    Edge::Quadratic { points, color } => {
                        self.quadratics.push(points, color, contour_index);
                    }
                    Edge::Cubic { points, color } => {
                        self.cubics.push(points, color, contour_index);
                    }
                }
            }
        }
        Ok(())
    }

    fn clear(&mut self) {
        self.lines.clear();
        self.quadratics.clear();
        self.cubics.clear();
        self.contour_windings.clear();
    }
}

fn contour_winding(edges: &[Edge]) -> i8 {
    fn shoelace(a: Point, b: Point) -> f32 {
        (b.x - a.x) * (a.y + b.y)
    }

    let total = match edges {
        [] => 0.0,
        [edge] => {
            let a = edge.point(0.0);
            let b = edge.point(1.0 / 3.0);
            let c = edge.point(2.0 / 3.0);
            shoelace(a, b) + shoelace(b, c) + shoelace(c, a)
        }
        [first, second] => {
            let a = first.point(0.0);
            let b = first.point(0.5);
            let c = second.point(0.0);
            let d = second.point(0.5);
            shoelace(a, b) + shoelace(b, c) + shoelace(c, d) + shoelace(d, a)
        }
        _ => {
            let mut total = 0.0;
            let mut previous = edges[edges.len() - 1].point(0.0);
            for edge in edges {
                let current = edge.point(0.0);
                total += shoelace(previous, current);
                previous = current;
            }
            total
        }
    };
    if total > 0.0 {
        1
    } else if total < 0.0 {
        -1
    } else {
        0
    }
}

macro_rules! soa_methods {
    ($type:ty, [$($field:ident),+]) => {
        impl $type {
            fn clear(&mut self) {
                $(self.$field.clear();)+
                self.color.clear();
                self.contour.clear();
            }

            fn reserve(&mut self, additional: usize) -> Result<(), BuildFailure> {
                $(self.$field.try_reserve(additional).map_err(|_| BuildFailure::Allocation)?;)+
                self.color.try_reserve(additional).map_err(|_| BuildFailure::Allocation)?;
                self.contour.try_reserve(additional).map_err(|_| BuildFailure::Allocation)?;
                Ok(())
            }
        }
    };
}

soa_methods!(LineSoa, [x0, y0, x1, y1]);
soa_methods!(QuadraticSoa, [x0, y0, cx, cy, x1, y1]);
soa_methods!(CubicSoa, [x0, y0, cx0, cy0, cx1, cy1, x1, y1]);

impl LineSoa {
    fn push(&mut self, points: [Point; 2], color: u8, contour: u32) {
        self.x0.push(points[0].x);
        self.y0.push(points[0].y);
        self.x1.push(points[1].x);
        self.y1.push(points[1].y);
        self.color.push(color);
        self.contour.push(contour);
    }
}

impl QuadraticSoa {
    fn push(&mut self, points: [Point; 3], color: u8, contour: u32) {
        self.x0.push(points[0].x);
        self.y0.push(points[0].y);
        self.cx.push(points[1].x);
        self.cy.push(points[1].y);
        self.x1.push(points[2].x);
        self.y1.push(points[2].y);
        self.color.push(color);
        self.contour.push(contour);
    }
}

impl CubicSoa {
    fn push(&mut self, points: [Point; 4], color: u8, contour: u32) {
        self.x0.push(points[0].x);
        self.y0.push(points[0].y);
        self.cx0.push(points[1].x);
        self.cy0.push(points[1].y);
        self.cx1.push(points[2].x);
        self.cy1.push(points[2].y);
        self.x1.push(points[3].x);
        self.y1.push(points[3].y);
        self.color.push(color);
        self.contour.push(contour);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sink_closes_and_reverses_contours() {
        let mut storage = OutlineStorage::default();
        let mut sink = OutlineSink::new(&mut storage, 8);
        sink.set_reversed(true);
        sink.move_to(0.0, 0.0);
        sink.line_to(1.0, 0.0);
        sink.line_to(1.0, 1.0);
        sink.close();
        sink.finish().expect("valid outline");
        assert_eq!(storage.contours, alloc::vec![0..3]);
        assert_eq!(storage.edges[0].start(), Point::new(0.0, 0.0));
        assert_eq!(storage.edges[2].end(), Point::new(0.0, 0.0));
    }

    #[test]
    fn sink_records_limits_without_panicking() {
        let mut storage = OutlineStorage::default();
        let mut sink = OutlineSink::new(&mut storage, 1);
        sink.move_to(0.0, 0.0);
        sink.line_to(1.0, 0.0);
        sink.line_to(1.0, 1.0);
        assert_eq!(sink.finish(), Err(BuildFailure::EdgeLimit));
    }
}
