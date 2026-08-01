#[cfg(not(feature = "std"))]
use core_maths::CoreFloat as _;

use crate::{
    math::{Point, clamp_unit, squared_distance},
    outline::{BLUE, CubicSoa, EdgeSoa, GREEN, LineSoa, QuadraticSoa, RED},
};

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
        full_distance_range: f32,
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
        let normalize = |distance: f32| clamp_unit(distance / full_distance_range + 0.5);
        Self {
            lanes: signed.lanes.map(normalize),
        }
    }

    #[cfg(feature = "adjacent-texel-tile-experiment")]
    pub(crate) fn evaluate_tile(
        points: [Point; 4],
        edges: &EdgeSoa,
        full_distance_range: f32,
        contours: &mut [alloc::vec::Vec<ContourDistance>; 4],
    ) -> [Self; 4] {
        for contours in &mut *contours {
            reset_tile_contours(contours);
        }
        visit_lines_tile(points, &edges.lines, contours);
        visit_quadratics_tile(points, &edges.quadratics, contours);
        visit_cubics_tile(points, &edges.cubics, contours);
        core::array::from_fn(|index| resolve_tile(edges, full_distance_range, &contours[index]))
    }

    pub(crate) fn lanes(self) -> [f32; 4] {
        self.lanes
    }
}

#[cfg(feature = "adjacent-texel-tile-experiment")]
fn resolve_tile(
    edges: &EdgeSoa,
    full_distance_range: f32,
    contours: &[ContourDistance],
) -> Distance4 {
    let Some((&first, remaining)) = contours.split_first() else {
        return Distance4 { lanes: [0.0; 4] };
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
    let normalize = |distance: f32| clamp_unit(distance / full_distance_range + 0.5);
    Distance4 {
        lanes: signed.lanes.map(normalize),
    }
}

#[cfg(feature = "adjacent-texel-tile-experiment")]
fn reset_tile_contours(contours: &mut [ContourDistance]) {
    for contour in contours {
        *contour = ContourDistance::default();
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

#[cfg(feature = "adjacent-texel-tile-experiment")]
fn visit_lines_tile(
    points: [Point; 4],
    edges: &LineSoa,
    contours: &mut [alloc::vec::Vec<ContourDistance>; 4],
) {
    for index in 0..edges.x0.len() {
        let a = Point::new(edges.x0[index], edges.y0[index]);
        let b = Point::new(edges.x1[index], edges.y1[index]);
        #[cfg(all(target_arch = "wasm32", feature = "adjacent-texel-simd-experiment"))]
        let candidates = line_distance_tile_simd(points, a, b);
        #[cfg(not(all(target_arch = "wasm32", feature = "adjacent-texel-simd-experiment")))]
        let candidates = points.map(|point| line_distance(point, a, b));
        for lane in 0..4 {
            let contour = contour_mut(&mut contours[lane], edges.contour[index]);
            update_lanes(contour, edges.color[index], candidates[lane]);
            contour.point_winding += line_winding(points[lane], a, b);
        }
    }
}

#[cfg(feature = "adjacent-texel-tile-experiment")]
fn visit_quadratics_tile(
    points: [Point; 4],
    edges: &QuadraticSoa,
    contours: &mut [alloc::vec::Vec<ContourDistance>; 4],
) {
    for index in 0..edges.x0.len() {
        let edge_points = [
            Point::new(edges.x0[index], edges.y0[index]),
            Point::new(edges.cx[index], edges.cy[index]),
            Point::new(edges.x1[index], edges.y1[index]),
        ];
        for lane in 0..4 {
            let contour = contour_mut(&mut contours[lane], edges.contour[index]);
            update_lanes(
                contour,
                edges.color[index],
                DistanceCandidate::interior(quadratic_distance(points[lane], edge_points)),
            );
            contour.point_winding += quadratic_winding(points[lane], edge_points);
        }
    }
}

#[cfg(feature = "adjacent-texel-tile-experiment")]
fn visit_cubics_tile(
    points: [Point; 4],
    edges: &CubicSoa,
    contours: &mut [alloc::vec::Vec<ContourDistance>; 4],
) {
    for index in 0..edges.x0.len() {
        let edge_points = [
            Point::new(edges.x0[index], edges.y0[index]),
            Point::new(edges.cx0[index], edges.cy0[index]),
            Point::new(edges.cx1[index], edges.cy1[index]),
            Point::new(edges.x1[index], edges.y1[index]),
        ];
        for lane in 0..4 {
            let contour = contour_mut(&mut contours[lane], edges.contour[index]);
            update_lanes(
                contour,
                edges.color[index],
                DistanceCandidate::interior(cubic_distance(points[lane], edge_points)),
            );
            contour.point_winding += cubic_winding(points[lane], edge_points);
        }
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

#[cfg(all(target_arch = "wasm32", feature = "adjacent-texel-simd-experiment"))]
fn line_distance_tile_simd(points: [Point; 4], a: Point, b: Point) -> [DistanceCandidate; 4] {
    use core::arch::wasm32::{
        f32x4, f32x4_abs, f32x4_add, f32x4_div, f32x4_gt, f32x4_le, f32x4_lt, f32x4_max, f32x4_min,
        f32x4_mul, f32x4_neg, f32x4_splat, f32x4_sqrt, f32x4_sub, v128_and, v128_bitselect,
    };

    let direction = b - a;
    let length_squared = direction.length_squared();
    let point_x = f32x4(points[0].x, points[1].x, points[2].x, points[3].x);
    let point_y = f32x4(points[0].y, points[1].y, points[2].y, points[3].y);
    let from_x = f32x4_sub(point_x, f32x4_splat(a.x));
    let from_y = f32x4_sub(point_y, f32x4_splat(a.y));
    if length_squared <= f32::EPSILON {
        let distance = f32x4_sqrt(f32x4_add(
            f32x4_mul(from_x, from_x),
            f32x4_mul(from_y, from_y),
        ));
        let values = extract_f32x4(distance);
        return values.map(|value| DistanceCandidate {
            value,
            alignment: 1.0,
        });
    }

    let direction_x = f32x4_splat(direction.x);
    let direction_y = f32x4_splat(direction.y);
    let raw_t = f32x4_div(
        f32x4_add(
            f32x4_mul(from_x, direction_x),
            f32x4_mul(from_y, direction_y),
        ),
        f32x4_splat(length_squared),
    );
    let t = f32x4_min(f32x4_max(raw_t, f32x4_splat(0.0)), f32x4_splat(1.0));
    let closest_x = f32x4_add(f32x4_splat(a.x), f32x4_mul(direction_x, t));
    let closest_y = f32x4_add(f32x4_splat(a.y), f32x4_mul(direction_y, t));
    let delta_x = f32x4_sub(point_x, closest_x);
    let delta_y = f32x4_sub(point_y, closest_y);
    let unsigned_distance = f32x4_sqrt(f32x4_add(
        f32x4_mul(delta_x, delta_x),
        f32x4_mul(delta_y, delta_y),
    ));
    let cross = f32x4_sub(
        f32x4_mul(from_x, direction_y),
        f32x4_mul(from_y, direction_x),
    );
    let values = v128_bitselect(
        f32x4_neg(unsigned_distance),
        unsigned_distance,
        f32x4_lt(cross, f32x4_splat(0.0)),
    );

    let closest_to_point_x = f32x4_sub(closest_x, point_x);
    let closest_to_point_y = f32x4_sub(closest_y, point_y);
    let closest_length_squared = f32x4_add(
        f32x4_mul(closest_to_point_x, closest_to_point_x),
        f32x4_mul(closest_to_point_y, closest_to_point_y),
    );
    let length_product = f32x4_sqrt(f32x4_mul(
        f32x4_splat(length_squared),
        closest_length_squared,
    ));
    let normalized_dot = f32x4_abs(f32x4_div(
        f32x4_add(
            f32x4_mul(direction_x, closest_to_point_x),
            f32x4_mul(direction_y, closest_to_point_y),
        ),
        length_product,
    ));
    let endpoint_alignment = v128_bitselect(
        f32x4_splat(0.0),
        normalized_dot,
        f32x4_le(length_product, f32x4_splat(f32::EPSILON)),
    );
    let interior = v128_and(
        f32x4_gt(raw_t, f32x4_splat(0.0)),
        f32x4_lt(raw_t, f32x4_splat(1.0)),
    );
    let alignments = v128_bitselect(f32x4_splat(0.0), endpoint_alignment, interior);
    let values = extract_f32x4(values);
    let alignments = extract_f32x4(alignments);
    core::array::from_fn(|index| DistanceCandidate {
        value: values[index],
        alignment: alignments[index],
    })
}

#[cfg(all(target_arch = "wasm32", feature = "adjacent-texel-simd-experiment"))]
fn extract_f32x4(value: core::arch::wasm32::v128) -> [f32; 4] {
    use core::arch::wasm32::f32x4_extract_lane;
    [
        f32x4_extract_lane::<0>(value),
        f32x4_extract_lane::<1>(value),
        f32x4_extract_lane::<2>(value),
        f32x4_extract_lane::<3>(value),
    ]
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
    let qa = F64Point::from(points[0] - point);
    let ab = F64Point::from(points[1] - points[0]);
    let br = F64Point::from(points[2] - points[1] - (points[1] - points[0]));
    let endpoint_start = qa.length();
    let endpoint_end = F64Point::from(points[2] - point).length();
    let (mut minimum_distance, mut minimum_direction) = if endpoint_start <= endpoint_end {
        (endpoint_start, ab)
    } else {
        (endpoint_end, ab + br)
    };
    let mut minimum_offset = if endpoint_start <= endpoint_end {
        qa
    } else {
        F64Point::from(points[2] - point)
    };

    for t in solve_cubic(
        br.dot(br),
        3.0 * ab.dot(br),
        2.0 * ab.dot(ab) + qa.dot(br),
        qa.dot(ab),
    )
    .into_iter()
    .flatten()
    {
        if !(0.0 < t && t < 1.0) {
            continue;
        }
        let offset = qa + ab * (2.0 * t) + br * (t * t);
        let distance = offset.length();
        if distance <= minimum_distance {
            minimum_distance = distance;
            minimum_direction = ab + br * t;
            minimum_offset = offset;
        }
    }

    (non_zero_sign64(minimum_direction.cross(minimum_offset)) * minimum_distance) as f32
}

#[derive(Clone, Copy)]
struct F64Point {
    x: f64,
    y: f64,
}

impl From<Point> for F64Point {
    fn from(value: Point) -> Self {
        Self {
            x: f64::from(value.x),
            y: f64::from(value.y),
        }
    }
}

impl core::ops::Add for F64Point {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl core::ops::Mul<f64> for F64Point {
    type Output = Self;

    fn mul(self, rhs: f64) -> Self::Output {
        Self {
            x: self.x * rhs,
            y: self.y * rhs,
        }
    }
}

impl F64Point {
    fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }

    fn cross(self, other: Self) -> f64 {
        self.x * other.y - self.y * other.x
    }

    fn length(self) -> f64 {
        self.dot(self).sqrt()
    }
}

fn non_zero_sign64(value: f64) -> f64 {
    if value < 0.0 { -1.0 } else { 1.0 }
}

fn solve_cubic(a: f64, b: f64, c: f64, d: f64) -> [Option<f64>; 3] {
    if a != 0.0 {
        let normalized_b = b / a;
        if normalized_b.abs() < 1.0e6 {
            return solve_normalized_cubic(normalized_b, c / a, d / a);
        }
    }
    let [first, second] = solve_quadratic(b, c, d);
    [first, second, None]
}

fn solve_normalized_cubic(a: f64, b: f64, c: f64) -> [Option<f64>; 3] {
    let a_squared = a * a;
    let q = (a_squared - 3.0 * b) / 9.0;
    let r = (a * (2.0 * a_squared - 9.0 * b) + 27.0 * c) / 54.0;
    let r_squared = r * r;
    let q_cubed = q * q * q;
    let offset = a / 3.0;
    if r_squared < q_cubed {
        let angle = (r / q_cubed.sqrt()).clamp(-1.0, 1.0).acos();
        let radius = -2.0 * q.sqrt();
        [
            Some(radius * (angle / 3.0).cos() - offset),
            Some(radius * ((angle + 2.0 * core::f64::consts::PI) / 3.0).cos() - offset),
            Some(radius * ((angle - 2.0 * core::f64::consts::PI) / 3.0).cos() - offset),
        ]
    } else {
        let root = (r.abs() + (r_squared - q_cubed).sqrt()).powf(1.0 / 3.0);
        let u = if r < 0.0 { root } else { -root };
        let v = if u == 0.0 { 0.0 } else { q / u };
        let first = u + v - offset;
        if u == v || (u - v).abs() < 1.0e-12 * (u + v).abs() {
            [Some(first), Some(-0.5 * (u + v) - offset), None]
        } else {
            [Some(first), None, None]
        }
    }
}

fn solve_quadratic(a: f64, b: f64, c: f64) -> [Option<f64>; 2] {
    if a == 0.0 || b.abs() > 1.0e12 * a.abs() {
        return if b == 0.0 {
            [None, None]
        } else {
            [Some(-c / b), None]
        };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant > 0.0 {
        let root = discriminant.sqrt();
        [Some((-b + root) / (2.0 * a)), Some((-b - root) / (2.0 * a))]
    } else if discriminant == 0.0 {
        [Some(-b / (2.0 * a)), None]
    } else {
        [None, None]
    }
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
    #[cfg(feature = "adjacent-texel-tile-experiment")]
    use crate::outline::Edge;
    use crate::outline::WHITE;

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

    #[test]
    fn quadratic_distance_finds_a_stationary_point_missed_by_fixed_newton_starts() {
        let distance = quadratic_distance(
            Point::new(84.992_66, 52.003_475),
            [
                Point::new(-28.122_19, -39.568_462),
                Point::new(-48.995_556, -80.687_94),
                Point::new(-53.369_263, -24.972_748),
            ],
        );

        assert!((distance.abs() - 145.534_84).abs() < 1.0e-3);
    }

    #[test]
    fn quadratic_segments_keep_zero_distance_on_their_shared_contour() {
        let mut edges = EdgeSoa::default();
        edges.quadratics.x0.extend([-1.0, 0.0]);
        edges.quadratics.y0.extend([0.0, 1.0]);
        edges.quadratics.cx.extend([-1.0, 1.0]);
        edges.quadratics.cy.extend([1.0, 1.0]);
        edges.quadratics.x1.extend([0.0, 1.0]);
        edges.quadratics.y1.extend([1.0, 0.0]);
        edges.quadratics.color.extend([WHITE, WHITE]);
        edges.quadratics.contour.extend([0, 0]);
        let mut contours = [ContourDistance::default()];

        visit_quadratics(Point::new(0.75, 0.75), &edges.quadratics, &mut contours);

        assert!(
            contours[0]
                .lanes
                .iter()
                .all(|distance| distance.abs() < 1.0e-6)
        );
    }

    #[cfg(feature = "adjacent-texel-tile-experiment")]
    #[test]
    fn adjacent_tile_matches_four_scalar_evaluations() {
        let outline = [
            Edge::Line {
                points: [Point::new(0.0, 0.0), Point::new(1.0, 0.0)],
                color: RED,
            },
            Edge::Quadratic {
                points: [
                    Point::new(1.0, 0.0),
                    Point::new(1.25, 0.5),
                    Point::new(1.0, 1.0),
                ],
                color: GREEN,
            },
            Edge::Cubic {
                points: [
                    Point::new(1.0, 1.0),
                    Point::new(0.75, 1.25),
                    Point::new(0.25, 1.25),
                    Point::new(0.0, 1.0),
                ],
                color: BLUE,
            },
            Edge::Line {
                points: [Point::new(0.0, 1.0), Point::new(0.0, 0.0)],
                color: WHITE,
            },
        ];
        let mut edges = EdgeSoa::default();
        let contour = 0..outline.len();
        edges.populate(&outline, core::slice::from_ref(&contour)).unwrap();
        let points = [
            Point::new(-0.25, 0.5),
            Point::new(0.25, 0.5),
            Point::new(0.75, 0.5),
            Point::new(1.25, 0.5),
        ];
        let scalar = points.map(|point| {
            Distance4::evaluate(point, &edges, 0.25, &mut [ContourDistance::default()])
        });
        let mut tile_contours = core::array::from_fn(|_| alloc::vec![ContourDistance::default()]);

        let tiled = Distance4::evaluate_tile(points, &edges, 0.25, &mut tile_contours);

        assert_eq!(tiled, scalar);
    }
}
