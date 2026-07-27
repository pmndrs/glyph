#[cfg(not(feature = "std"))]
use core_maths::CoreFloat as _;

use crate::{
    math::{Point, clamp_unit, squared_distance},
    outline::{BLUE, CubicSoa, EdgeSoa, GREEN, LineSoa, QuadraticSoa, RED},
};

const QUADRATIC_STARTS: usize = 8;
const QUADRATIC_STEPS: usize = 6;
const CUBIC_STARTS: usize = 8;
const CUBIC_STEPS: usize = 8;
const QUADRATIC_WINDING_STEPS: usize = 16;
const CUBIC_WINDING_STEPS: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Distance4 {
    lanes: [f32; 4],
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ContourDistance {
    lanes: [f32; 4],
    alignments: [f32; 4],
    point_winding: i32,
}

impl Default for ContourDistance {
    fn default() -> Self {
        Self {
            lanes: [f32::INFINITY; 4],
            alignments: [f32::INFINITY; 4],
            point_winding: 0,
        }
    }
}

impl Distance4 {
    pub(crate) fn evaluate(
        point: Point,
        edges: &EdgeSoa,
        units_per_em: f32,
        contours: &mut [ContourDistance],
    ) -> Self {
        for contour in &mut *contours {
            *contour = ContourDistance::default();
        }
        visit_lines(point, &edges.lines, contours);
        visit_quadratics(point, &edges.quadratics, contours);
        visit_cubics(point, &edges.cubics, contours);

        let Some((&first, remaining)) = contours.split_first() else {
            return Self { lanes: [0.0; 4] };
        };
        let mut shape = first.signed();
        let mut inner = None;
        let mut outer = None;
        classify_contour(shape, edges.contour_windings[0], &mut inner, &mut outer);
        for (index, contour) in remaining.iter().enumerate() {
            let distance = contour.signed();
            shape.merge(distance);
            classify_contour(
                distance,
                edges.contour_windings[index + 1],
                &mut inner,
                &mut outer,
            );
        }

        let mut signed = resolve_overlaps(shape, inner, outer, contours, &edges.contour_windings);
        let filled = contours
            .iter()
            .map(|contour| contour.point_winding)
            .sum::<i32>()
            != 0;
        if (signed.resolve() >= 0.0) != filled {
            for lane in &mut signed.lanes {
                *lane = -*lane;
            }
        }
        let normalize = |distance: f32| clamp_unit(distance / units_per_em + 0.5);
        Self {
            lanes: signed.lanes.map(normalize),
        }
    }

    pub(crate) fn lanes(self) -> [f32; 4] {
        self.lanes
    }
}

#[derive(Clone, Copy, Debug)]
struct SignedDistance4 {
    lanes: [f32; 4],
    alignments: [f32; 4],
}

impl SignedDistance4 {
    fn resolve(self) -> f32 {
        let [red, green, blue, _] = self.lanes;
        red.min(green).max(red.max(green).min(blue))
    }

    fn merge(&mut self, other: Self) {
        for index in 0..4 {
            update_distance(
                &mut self.lanes[index],
                &mut self.alignments[index],
                DistanceCandidate {
                    value: other.lanes[index],
                    alignment: other.alignments[index],
                },
            );
        }
    }
}

impl ContourDistance {
    fn signed(self) -> SignedDistance4 {
        SignedDistance4 {
            lanes: self.lanes,
            alignments: self.alignments,
        }
    }
}

fn classify_contour(
    distance: SignedDistance4,
    winding: i8,
    inner: &mut Option<SignedDistance4>,
    outer: &mut Option<SignedDistance4>,
) {
    let scalar = distance.resolve();
    if winding > 0 && scalar >= 0.0 {
        merge_optional(inner, distance);
    }
    if winding < 0 && scalar <= 0.0 {
        merge_optional(outer, distance);
    }
}

fn merge_optional(target: &mut Option<SignedDistance4>, distance: SignedDistance4) {
    if let Some(target) = target {
        target.merge(distance);
    } else {
        *target = Some(distance);
    }
}

fn resolve_overlaps(
    shape: SignedDistance4,
    inner: Option<SignedDistance4>,
    outer: Option<SignedDistance4>,
    contours: &[ContourDistance],
    windings: &[i8],
) -> SignedDistance4 {
    let inner_scalar = inner.map_or(f32::NEG_INFINITY, SignedDistance4::resolve);
    let outer_scalar = outer.map_or(f32::INFINITY, SignedDistance4::resolve);
    let (mut distance, selected_winding) = if let Some(mut distance) = inner
        && inner_scalar >= 0.0
        && inner_scalar.abs() <= outer_scalar.abs()
    {
        for (&contour, &winding) in contours.iter().zip(windings) {
            let contour = contour.signed();
            let scalar = contour.resolve();
            if winding > 0 && scalar.abs() < outer_scalar.abs() && scalar > distance.resolve() {
                distance = contour;
            }
        }
        (distance, 1)
    } else if let Some(mut distance) = outer
        && outer_scalar <= 0.0
        && outer_scalar.abs() < inner_scalar.abs()
    {
        for (&contour, &winding) in contours.iter().zip(windings) {
            let contour = contour.signed();
            let scalar = contour.resolve();
            if winding < 0 && scalar.abs() < inner_scalar.abs() && scalar < distance.resolve() {
                distance = contour;
            }
        }
        (distance, -1)
    } else {
        return shape;
    };

    for (&contour, &winding) in contours.iter().zip(windings) {
        if winding != selected_winding {
            let contour = contour.signed();
            let scalar = contour.resolve();
            if scalar * distance.resolve() >= 0.0 && scalar.abs() < distance.resolve().abs() {
                distance = contour;
            }
        }
    }
    if distance.resolve() == shape.resolve() {
        shape
    } else {
        distance
    }
}

fn contour_mut(contours: &mut [ContourDistance], index: u32) -> &mut ContourDistance {
    // EdgeSoa::populate creates every index from the same contour slice used to
    // size this reusable buffer, so the conversion and access are invariant-safe.
    &mut contours[index as usize]
}

fn visit_lines(point: Point, edges: &LineSoa, contours: &mut [ContourDistance]) {
    for index in 0..edges.x0.len() {
        let a = Point::new(edges.x0[index], edges.y0[index]);
        let b = Point::new(edges.x1[index], edges.y1[index]);
        let contour = contour_mut(contours, edges.contour[index]);
        update_lanes(contour, edges.color[index], line_distance(point, a, b));
        contour.point_winding += line_winding(point, a, b);
    }
}

fn visit_quadratics(point: Point, edges: &QuadraticSoa, contours: &mut [ContourDistance]) {
    for index in 0..edges.x0.len() {
        let points = [
            Point::new(edges.x0[index], edges.y0[index]),
            Point::new(edges.cx[index], edges.cy[index]),
            Point::new(edges.x1[index], edges.y1[index]),
        ];
        let contour = contour_mut(contours, edges.contour[index]);
        update_lanes(
            contour,
            edges.color[index],
            DistanceCandidate::interior(quadratic_distance(point, points)),
        );
        contour.point_winding += quadratic_winding(point, points);
    }
}

fn visit_cubics(point: Point, edges: &CubicSoa, contours: &mut [ContourDistance]) {
    for index in 0..edges.x0.len() {
        let points = [
            Point::new(edges.x0[index], edges.y0[index]),
            Point::new(edges.cx0[index], edges.cy0[index]),
            Point::new(edges.cx1[index], edges.cy1[index]),
            Point::new(edges.x1[index], edges.y1[index]),
        ];
        let contour = contour_mut(contours, edges.contour[index]);
        update_lanes(
            contour,
            edges.color[index],
            DistanceCandidate::interior(cubic_distance(point, points)),
        );
        contour.point_winding += cubic_winding(point, points);
    }
}

#[derive(Clone, Copy)]
struct DistanceCandidate {
    value: f32,
    alignment: f32,
}

impl DistanceCandidate {
    fn interior(value: f32) -> Self {
        Self {
            value,
            alignment: 0.0,
        }
    }
}

fn update_lanes(contour: &mut ContourDistance, color: u8, candidate: DistanceCandidate) {
    if color & RED != 0 {
        update_distance(&mut contour.lanes[0], &mut contour.alignments[0], candidate);
    }
    if color & GREEN != 0 {
        update_distance(&mut contour.lanes[1], &mut contour.alignments[1], candidate);
    }
    if color & BLUE != 0 {
        update_distance(&mut contour.lanes[2], &mut contour.alignments[2], candidate);
    }
    update_distance(&mut contour.lanes[3], &mut contour.alignments[3], candidate);
}

fn update_distance(current: &mut f32, alignment: &mut f32, candidate: DistanceCandidate) {
    if candidate.value.abs() < current.abs()
        || (candidate.value.abs() == current.abs() && candidate.alignment < *alignment)
    {
        *current = candidate.value;
        *alignment = candidate.alignment;
    }
}

fn non_zero_sign(value: f32) -> f32 {
    if value < 0.0 { -1.0 } else { 1.0 }
}

fn line_distance(point: Point, a: Point, b: Point) -> DistanceCandidate {
    let direction = b - a;
    let length_squared = direction.length_squared();
    if length_squared <= f32::EPSILON {
        return DistanceCandidate {
            value: squared_distance(point, a).sqrt(),
            alignment: 1.0,
        };
    }
    let from_start = point - a;
    let raw_t = from_start.dot(direction) / length_squared;
    let t = raw_t.clamp(0.0, 1.0);
    let closest = a + direction * t;
    DistanceCandidate {
        value: non_zero_sign(from_start.cross(direction)) * squared_distance(point, closest).sqrt(),
        alignment: if raw_t > 0.0 && raw_t < 1.0 {
            0.0
        } else {
            normalized_abs_dot(direction, closest - point)
        },
    }
}

fn normalized_abs_dot(a: Point, b: Point) -> f32 {
    let length_product = (a.length_squared() * b.length_squared()).sqrt();
    if length_product <= f32::EPSILON {
        0.0
    } else {
        (a.dot(b) / length_product).abs()
    }
}

fn quadratic_distance(point: Point, points: [Point; 3]) -> f32 {
    let start = squared_distance(point, points[0]);
    let end = squared_distance(point, points[2]);
    let (mut best, mut best_t) = if start <= end {
        (start, 0.0)
    } else {
        (end, 1.0)
    };
    for start in 0..=QUADRATIC_STARTS {
        let mut t = start as f32 / QUADRATIC_STARTS as f32;
        for _ in 0..QUADRATIC_STEPS {
            let position = quadratic_point(points, t);
            let first = quadratic_derivative(points, t);
            let second = (points[2] - points[1] * 2.0 + points[0]) * 2.0;
            let delta = position - point;
            let denominator = first.dot(first) + delta.dot(second);
            if denominator.abs() <= 1.0e-8 || !denominator.is_finite() {
                break;
            }
            t = (t - delta.dot(first) / denominator).clamp(0.0, 1.0);
        }
        let candidate = squared_distance(point, quadratic_point(points, t));
        if candidate <= best {
            best = candidate;
            best_t = t;
        }
    }
    let delta = quadratic_point(points, best_t) - point;
    non_zero_sign(quadratic_derivative(points, best_t).cross(delta)) * best.sqrt()
}

fn cubic_distance(point: Point, points: [Point; 4]) -> f32 {
    let start = squared_distance(point, points[0]);
    let end = squared_distance(point, points[3]);
    let (mut best, mut best_t) = if start <= end {
        (start, 0.0)
    } else {
        (end, 1.0)
    };
    for start in 0..=CUBIC_STARTS {
        let mut t = start as f32 / CUBIC_STARTS as f32;
        for _ in 0..CUBIC_STEPS {
            let position = cubic_point(points, t);
            let first = cubic_derivative(points, t);
            let second = cubic_second_derivative(points, t);
            let delta = position - point;
            let denominator = first.dot(first) + delta.dot(second);
            if denominator.abs() <= 1.0e-8 || !denominator.is_finite() {
                break;
            }
            t = (t - delta.dot(first) / denominator).clamp(0.0, 1.0);
        }
        let candidate = squared_distance(point, cubic_point(points, t));
        if candidate < best {
            best = candidate;
            best_t = t;
        }
    }
    let delta = cubic_point(points, best_t) - point;
    non_zero_sign(cubic_derivative(points, best_t).cross(delta)) * best.sqrt()
}

fn quadratic_point(points: [Point; 3], t: f32) -> Point {
    let one_minus_t = 1.0 - t;
    points[0] * (one_minus_t * one_minus_t)
        + points[1] * (2.0 * one_minus_t * t)
        + points[2] * (t * t)
}

fn quadratic_derivative(points: [Point; 3], t: f32) -> Point {
    (points[1] - points[0]) * (2.0 * (1.0 - t)) + (points[2] - points[1]) * (2.0 * t)
}

fn cubic_point(points: [Point; 4], t: f32) -> Point {
    let one_minus_t = 1.0 - t;
    let one_minus_t_squared = one_minus_t * one_minus_t;
    let t_squared = t * t;
    points[0] * (one_minus_t_squared * one_minus_t)
        + points[1] * (3.0 * one_minus_t_squared * t)
        + points[2] * (3.0 * one_minus_t * t_squared)
        + points[3] * (t_squared * t)
}

fn cubic_derivative(points: [Point; 4], t: f32) -> Point {
    let one_minus_t = 1.0 - t;
    (points[1] - points[0]) * (3.0 * one_minus_t * one_minus_t)
        + (points[2] - points[1]) * (6.0 * one_minus_t * t)
        + (points[3] - points[2]) * (3.0 * t * t)
}

fn cubic_second_derivative(points: [Point; 4], t: f32) -> Point {
    (points[2] - points[1] * 2.0 + points[0]) * (6.0 * (1.0 - t))
        + (points[3] - points[2] * 2.0 + points[1]) * (6.0 * t)
}

fn quadratic_winding(point: Point, points: [Point; 3]) -> i32 {
    let mut winding = 0;
    let mut previous = points[0];
    for step in 1..=QUADRATIC_WINDING_STEPS {
        let next = quadratic_point(points, step as f32 / QUADRATIC_WINDING_STEPS as f32);
        winding += line_winding(point, previous, next);
        previous = next;
    }
    winding
}

fn cubic_winding(point: Point, points: [Point; 4]) -> i32 {
    let mut winding = 0;
    let mut previous = points[0];
    for step in 1..=CUBIC_WINDING_STEPS {
        let next = cubic_point(points, step as f32 / CUBIC_WINDING_STEPS as f32);
        winding += line_winding(point, previous, next);
        previous = next;
    }
    winding
}

fn line_winding(point: Point, a: Point, b: Point) -> i32 {
    if a.y <= point.y {
        if b.y > point.y && (b - a).cross(point - a) > 0.0 {
            return 1;
        }
    } else if b.y <= point.y && (b - a).cross(point - a) < 0.0 {
        return -1;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_distance_handles_degenerate_edges() {
        assert_eq!(
            line_distance(Point::new(3.0, 4.0), Point::ZERO, Point::ZERO).value,
            5.0
        );
    }

    #[test]
    fn cubic_distance_terminates_for_degenerate_control_points() {
        assert_eq!(cubic_distance(Point::new(1.0, 0.0), [Point::ZERO; 4]), 1.0);
    }
}
