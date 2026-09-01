use alloc::vec::Vec;

use crate::{AtlasRegion, outline::Bounds, outline::Edge};
#[cfg(not(any(feature = "std", test)))]
use core_maths::CoreFloat as _;

const ARTIFACT_T_EPSILON: f64 = 0.01;
const ERROR: u8 = 1;
pub(crate) const PROTECTED: u8 = 2;
const PROTECTION_RADIUS_TOLERANCE: f64 = 1.001;
const MIN_DEVIATION_RATIO: f64 = 10.0 / 9.0;

#[derive(Clone, Copy)]
struct CorrectionGrid {
    width: usize,
    height: usize,
    horizontal_span: f64,
    vertical_span: f64,
    diagonal_span: f64,
}

pub(crate) fn correct_interpolation_artifacts(
    rgba: &mut [u8],
    width: usize,
    height: usize,
    horizontal_distance_delta: f64,
    vertical_distance_delta: f64,
    stencil: &mut Vec<u8>,
    protection: &[u8],
) -> Result<usize, ()> {
    let Some(texel_count) = width.checked_mul(height) else {
        return Err(());
    };
    if rgba.len() != texel_count.checked_mul(4).ok_or(())? {
        return Err(());
    }
    if texel_count > stencil.len() {
        stencil
            .try_reserve_exact(texel_count - stencil.len())
            .map_err(|_| ())?;
    }
    stencil.resize(texel_count, 0);
    stencil.fill(0);

    let horizontal_span = MIN_DEVIATION_RATIO * horizontal_distance_delta;
    let vertical_span = MIN_DEVIATION_RATIO * vertical_distance_delta;
    let grid = CorrectionGrid {
        width,
        height,
        horizontal_span,
        vertical_span,
        diagonal_span: horizontal_span.hypot(vertical_span),
    };
    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if protection.get(index).copied().unwrap_or(0) & PROTECTED == 0
                && has_artifact_with_neighbor(rgba, grid, x, y)
            {
                stencil[index] |= ERROR;
            }
        }
    }

    Ok(apply_median_stencil(rgba, stencil))
}

fn apply_median_stencil(rgba: &mut [u8], stencil: &[u8]) -> usize {
    let mut corrected = 0;
    for (index, mask) in stencil.iter().copied().enumerate() {
        if mask & ERROR == 0 {
            continue;
        }
        // The output length was authenticated above, so every texel has one complete RGBA tuple.
        let offset = index * 4;
        let median = median_u8(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
        rgba[offset] = median;
        rgba[offset + 1] = median;
        rgba[offset + 2] = median;
        corrected += 1;
    }
    corrected
}

fn pixel4(rgba: &[u8], index: usize) -> [f64; 4] {
    let offset = index * 4;
    [
        f64::from(rgba[offset]) / 255.0,
        f64::from(rgba[offset + 1]) / 255.0,
        f64::from(rgba[offset + 2]) / 255.0,
        f64::from(rgba[offset + 3]) / 255.0,
    ]
}

fn has_artifact_with_neighbor(rgba: &[u8], grid: CorrectionGrid, x: usize, y: usize) -> bool {
    let center = pixel(rgba, grid.width, x, y);
    let center_median = median3(center);
    let left = (x > 0).then(|| pixel(rgba, grid.width, x - 1, y));
    let bottom = (y > 0).then(|| pixel(rgba, grid.width, x, y - 1));
    let right = (x + 1 < grid.width).then(|| pixel(rgba, grid.width, x + 1, y));
    let top = (y + 1 < grid.height).then(|| pixel(rgba, grid.width, x, y + 1));

    left.is_some_and(|neighbor| {
        has_linear_artifact(center_median, center, neighbor, grid.horizontal_span)
    }) || bottom.is_some_and(|neighbor| {
        has_linear_artifact(center_median, center, neighbor, grid.vertical_span)
    }) || right.is_some_and(|neighbor| {
        has_linear_artifact(center_median, center, neighbor, grid.horizontal_span)
    }) || top.is_some_and(|neighbor| {
        has_linear_artifact(center_median, center, neighbor, grid.vertical_span)
    }) || (x > 0
        && y > 0
        && has_diagonal_artifact(
            center_median,
            center,
            left.unwrap_or(center),
            bottom.unwrap_or(center),
            pixel(rgba, grid.width, x - 1, y - 1),
            grid.diagonal_span,
        ))
        || (x + 1 < grid.width
            && y > 0
            && has_diagonal_artifact(
                center_median,
                center,
                right.unwrap_or(center),
                bottom.unwrap_or(center),
                pixel(rgba, grid.width, x + 1, y - 1),
                grid.diagonal_span,
            ))
        || (x > 0
            && y + 1 < grid.height
            && has_diagonal_artifact(
                center_median,
                center,
                left.unwrap_or(center),
                top.unwrap_or(center),
                pixel(rgba, grid.width, x - 1, y + 1),
                grid.diagonal_span,
            ))
        || (x + 1 < grid.width
            && y + 1 < grid.height
            && has_diagonal_artifact(
                center_median,
                center,
                right.unwrap_or(center),
                top.unwrap_or(center),
                pixel(rgba, grid.width, x + 1, y + 1),
                grid.diagonal_span,
            ))
}

fn has_linear_artifact(first_median: f64, first: [f64; 3], second: [f64; 3], span: f64) -> bool {
    let second_median = median3(second);
    (first_median - 0.5).abs() >= (second_median - 0.5).abs()
        && (has_linear_artifact_inner(
            first_median,
            second_median,
            first,
            second,
            first[1] - first[0],
            second[1] - second[0],
            span,
        ) || has_linear_artifact_inner(
            first_median,
            second_median,
            first,
            second,
            first[2] - first[1],
            second[2] - second[1],
            span,
        ) || has_linear_artifact_inner(
            first_median,
            second_median,
            first,
            second,
            first[0] - first[2],
            second[0] - second[2],
            span,
        ))
}

fn has_linear_artifact_inner(
    first_median: f64,
    second_median: f64,
    first: [f64; 3],
    second: [f64; 3],
    first_delta: f64,
    second_delta: f64,
    span: f64,
) -> bool {
    let denominator = first_delta - second_delta;
    if denominator == 0.0 {
        return false;
    }
    let ratio = first_delta / denominator;
    if !(ARTIFACT_T_EPSILON..1.0 - ARTIFACT_T_EPSILON).contains(&ratio) {
        return false;
    }
    let interpolated = median3(mix3(first, second, ratio));
    is_protected_artifact(
        0.0,
        1.0,
        ratio,
        first_median,
        second_median,
        interpolated,
        span,
    )
}

fn has_diagonal_artifact(
    first_median: f64,
    first: [f64; 3],
    second: [f64; 3],
    third: [f64; 3],
    fourth: [f64; 3],
    span: f64,
) -> bool {
    let fourth_median = median3(fourth);
    if (first_median - 0.5).abs() < (fourth_median - 0.5).abs() {
        return false;
    }
    let abc: [f64; 3] =
        core::array::from_fn(|channel| first[channel] - second[channel] - third[channel]);
    let linear: [f64; 3] = core::array::from_fn(|channel| -first[channel] - abc[channel]);
    let quadratic: [f64; 3] = core::array::from_fn(|channel| fourth[channel] + abc[channel]);
    let extreme: [f64; 3] = core::array::from_fn(|channel| {
        if quadratic[channel] == 0.0 {
            f64::NAN
        } else {
            -0.5 * linear[channel] / quadratic[channel]
        }
    });
    has_diagonal_artifact_inner(
        first_median,
        fourth_median,
        first,
        linear,
        quadratic,
        first[1] - first[0],
        second[1] - second[0] + third[1] - third[0],
        fourth[1] - fourth[0],
        extreme[0],
        extreme[1],
        span,
    ) || has_diagonal_artifact_inner(
        first_median,
        fourth_median,
        first,
        linear,
        quadratic,
        first[2] - first[1],
        second[2] - second[1] + third[2] - third[1],
        fourth[2] - fourth[1],
        extreme[1],
        extreme[2],
        span,
    ) || has_diagonal_artifact_inner(
        first_median,
        fourth_median,
        first,
        linear,
        quadratic,
        first[0] - first[2],
        second[0] - second[2] + third[0] - third[2],
        fourth[0] - fourth[2],
        extreme[2],
        extreme[0],
        span,
    )
}

#[allow(clippy::too_many_arguments)]
fn has_diagonal_artifact_inner(
    first_median: f64,
    fourth_median: f64,
    first: [f64; 3],
    linear: [f64; 3],
    quadratic: [f64; 3],
    first_delta: f64,
    middle_delta: f64,
    fourth_delta: f64,
    first_extreme: f64,
    second_extreme: f64,
    span: f64,
) -> bool {
    let roots = solve_quadratic(
        fourth_delta - middle_delta + first_delta,
        middle_delta - 2.0 * first_delta,
        first_delta,
    );
    roots.into_iter().flatten().any(|ratio| {
        if !(ARTIFACT_T_EPSILON..1.0 - ARTIFACT_T_EPSILON).contains(&ratio) {
            return false;
        }
        let interpolated = interpolated_median(first, linear, quadratic, ratio);
        let mut artifact = is_protected_artifact(
            0.0,
            1.0,
            ratio,
            first_median,
            fourth_median,
            interpolated,
            span,
        );
        for extreme in [first_extreme, second_extreme] {
            if extreme > 0.0 && extreme < 1.0 {
                let (start_t, start_median, end_t, end_median) = if extreme > ratio {
                    (
                        0.0,
                        first_median,
                        extreme,
                        interpolated_median(first, linear, quadratic, extreme),
                    )
                } else {
                    (
                        extreme,
                        interpolated_median(first, linear, quadratic, extreme),
                        1.0,
                        fourth_median,
                    )
                };
                artifact |= is_protected_artifact(
                    start_t,
                    end_t,
                    ratio,
                    start_median,
                    end_median,
                    interpolated,
                    span,
                );
            }
        }
        artifact
    })
}

fn is_protected_artifact(
    first_t: f64,
    second_t: f64,
    sample_t: f64,
    first_median: f64,
    second_median: f64,
    sample_median: f64,
    span: f64,
) -> bool {
    let inverted = (first_median > 0.5 && second_median > 0.5 && sample_median <= 0.5)
        || (first_median < 0.5 && second_median < 0.5 && sample_median >= 0.5);
    if !inverted {
        return false;
    }
    let first_span = (sample_t - first_t) * span;
    let second_span = (second_t - sample_t) * span;
    !(sample_median >= first_median - first_span
        && sample_median <= first_median + first_span
        && sample_median >= second_median - second_span
        && sample_median <= second_median + second_span)
}

fn solve_quadratic(a: f64, b: f64, c: f64) -> [Option<f64>; 2] {
    if a == 0.0 || b.abs() > 1e12 * a.abs() {
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

fn pixel(rgba: &[u8], width: usize, x: usize, y: usize) -> [f64; 3] {
    // Callers authenticate dimensions and keep x/y inside them before entering this hot path.
    let offset = (y * width + x) * 4;
    [
        f64::from(rgba[offset]) / 255.0,
        f64::from(rgba[offset + 1]) / 255.0,
        f64::from(rgba[offset + 2]) / 255.0,
    ]
}

fn interpolated_median(
    constant: [f64; 3],
    linear: [f64; 3],
    quadratic: [f64; 3],
    ratio: f64,
) -> f64 {
    median3(core::array::from_fn(|channel| {
        ratio * (ratio * quadratic[channel] + linear[channel]) + constant[channel]
    }))
}

fn mix3(first: [f64; 3], second: [f64; 3], ratio: f64) -> [f64; 3] {
    core::array::from_fn(|channel| first[channel] * (1.0 - ratio) + second[channel] * ratio)
}

fn median3(value: [f64; 3]) -> f64 {
    value[0]
        .min(value[1])
        .max(value[0].max(value[1]).min(value[2]))
}

fn median_u8(red: u8, green: u8, blue: u8) -> u8 {
    red.min(green).max(red.max(green).min(blue))
}

/// Mark the four texels enveloping every colour-transition corner as protected.
///
/// Ported from msdfgen's `MSDFErrorCorrection::protectCorners`, which the shipping kernel omitted.
/// Two consecutive edges sharing at most one channel form a corner: that is where the median is
/// deliberately allowed to disagree with the true distance so the reconstruction stays sharp.
/// Correcting such a texel replaces the sharp corner with the rounded true distance.
pub(crate) fn mark_protected_corners(
    edges: &[Edge],
    contours: &[core::ops::Range<usize>],
    bounds: Bounds,
    region: AtlasRegion,
    width: usize,
    height: usize,
    protection: &mut Vec<u8>,
) -> Result<(), ()> {
    let texel_count = width.checked_mul(height).ok_or(())?;
    if texel_count > protection.len() {
        protection
            .try_reserve_exact(texel_count - protection.len())
            .map_err(|_| ())?;
    }
    protection.resize(texel_count, 0);
    protection.fill(0);
    if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
        return Ok(());
    }
    for contour in contours {
        let Some(span) = edges.get(contour.clone()) else {
            continue;
        };
        let Some(&last) = span.last() else {
            continue;
        };
        let mut previous_color = last.color();
        for edge in span {
            let common = previous_color & edge.color();
            previous_color = edge.color();
            // A corner is a colour transition: the two edges share at most one channel.
            if common & common.wrapping_sub(1) != 0 {
                continue;
            }
            let point = edge.start();
            let x_ratio = (point.x - bounds.min_x) / bounds.width();
            let y_ratio = (point.y - bounds.min_y) / bounds.height();
            // Texel centres sit at integer indices; row 0 is the top, matching the output buffer.
            let column = x_ratio * region.inner_width as f32 + region.padding_x as f32 - 0.5;
            let source_row = y_ratio * region.inner_height as f32 + region.padding_y as f32 - 0.5;
            let row = (height as f32) - 1.0 - source_row;
            if !column.is_finite() || !row.is_finite() {
                continue;
            }
            let left = libm_floor(column);
            let top = libm_floor(row);
            for (x, y) in [
                (left, top),
                (left + 1, top),
                (left, top + 1),
                (left + 1, top + 1),
            ] {
                if x < 0 || y < 0 {
                    continue;
                }
                let (x, y) = (x as usize, y as usize);
                if x < width && y < height {
                    protection[y * width + x] |= PROTECTED;
                }
            }
        }
    }
    Ok(())
}

fn libm_floor(value: f32) -> i64 {
    let truncated = value as i64;
    if value < 0.0 && (truncated as f32) != value {
        truncated - 1
    } else {
        truncated
    }
}

/// Protect texels that straddle a real edge from correction.
///
/// Ported from msdfgen's `MSDFErrorCorrection::protectEdges`. Where two neighbouring texels bracket
/// the 0.5 crossing, the channel that carries the edge is allowed to be an outlier: that outlier is
/// the edge's sub-texel position, not an interpolation fault. Only the non-median channels that
/// actually contribute to the crossing are protected, so genuine channel collisions elsewhere stay
/// correctable.
pub(crate) fn mark_protected_edges(
    rgba: &[u8],
    width: usize,
    height: usize,
    horizontal_distance_delta: f64,
    vertical_distance_delta: f64,
    protection: &mut [u8],
) {
    if width < 2 || height < 2 {
        return;
    }
    let horizontal_radius = PROTECTION_RADIUS_TOLERANCE * horizontal_distance_delta;
    let vertical_radius = PROTECTION_RADIUS_TOLERANCE * vertical_distance_delta;
    let diagonal_radius =
        PROTECTION_RADIUS_TOLERANCE * horizontal_distance_delta.hypot(vertical_distance_delta);
    let pair = |first: usize, second: usize, radius: f64, protection: &mut [u8]| {
        let a = pixel4(rgba, first);
        let b = pixel4(rgba, second);
        let first_median = median3([a[0], a[1], a[2]]);
        let second_median = median3([b[0], b[1], b[2]]);
        if (first_median - 0.5).abs() + (second_median - 0.5).abs() >= radius {
            return;
        }
        let mask = edge_between_texels(a, b);
        protect_extreme_channels(&mut protection[first], a, first_median, mask);
        protect_extreme_channels(&mut protection[second], b, second_median, mask);
    };
    for y in 0..height {
        for x in 0..width - 1 {
            let index = y * width + x;
            pair(index, index + 1, horizontal_radius, protection);
        }
    }
    for y in 0..height - 1 {
        for x in 0..width {
            let index = y * width + x;
            pair(index, index + width, vertical_radius, protection);
        }
    }
    for y in 0..height - 1 {
        for x in 0..width - 1 {
            let index = y * width + x;
            pair(index, index + width + 1, diagonal_radius, protection);
            pair(index + 1, index + width, diagonal_radius, protection);
        }
    }
}

/// Bit mask of the channels whose zero crossing between two texels is the median there.
fn edge_between_texels(a: [f64; 4], b: [f64; 4]) -> u8 {
    let mut mask = 0;
    for (channel, flag) in [(0_usize, 1_u8), (1, 2), (2, 4)] {
        let denominator = a[channel] - b[channel];
        if denominator == 0.0 {
            continue;
        }
        let t = (a[channel] - 0.5) / denominator;
        if !(t > 0.0 && t < 1.0) {
            continue;
        }
        let interpolated = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t,
        ];
        if median3(interpolated) == interpolated[channel] {
            mask |= flag;
        }
    }
    mask
}

/// Protect a texel when one of its non-median channels carries the crossing in `mask`.
fn protect_extreme_channels(stencil: &mut u8, texel: [f64; 4], median: f64, mask: u8) {
    if (mask & 1 != 0 && texel[0] != median)
        || (mask & 2 != 0 && texel[1] != median)
        || (mask & 4 != 0 && texel[2] != median)
    {
        *stencil |= PROTECTED;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::{
        math::Point,
        outline::{BLUE, GREEN, RED},
    };

    /// The unit square mapped one font unit per texel, with four texels of padding.
    fn unit_square_region() -> (Bounds, AtlasRegion, usize, usize) {
        let bounds = Bounds::new(0.0, 0.0, 8.0, 8.0);
        let region = AtlasRegion {
            inner_width: 8,
            inner_height: 8,
            padding_x: 4,
            padding_y: 4,
        };
        (bounds, region, 16, 16)
    }

    #[test]
    fn colour_transition_protects_the_four_enveloping_texels() {
        let (bounds, region, width, height) = unit_square_region();
        // Two edges meeting at (4, 4) with no shared channel: a corner by msdfgen's definition.
        let edges = [
            Edge::Line {
                points: [Point::new(0.0, 4.0), Point::new(4.0, 4.0)],
                color: RED | GREEN,
            },
            Edge::Line {
                points: [Point::new(4.0, 4.0), Point::new(4.0, 0.0)],
                color: BLUE,
            },
        ];
        let mut protection = Vec::new();
        let contour = 0..2;
        mark_protected_corners(
            &edges,
            core::slice::from_ref(&contour),
            bounds,
            region,
            width,
            height,
            &mut protection,
        )
        .expect("protection");
        // The contour wraps, so both junctions are colour transitions: the shared start at
        // (0, 4) and the shared end at (4, 4). One font unit is one texel with four of padding,
        // so those land at texel indices 3.5 and 7.5, each enveloped by a 2x2 block. Row 0 is
        // the top, and y = 4 is the vertical centre, so both blocks straddle rows 7 and 8.
        let marked: Vec<usize> = protection
            .iter()
            .enumerate()
            .filter(|(_, flag)| **flag & PROTECTED != 0)
            .map(|(index, _)| index)
            .collect();
        assert_eq!(
            marked,
            [
                7 * width + 3,
                7 * width + 4,
                7 * width + 7,
                7 * width + 8,
                8 * width + 3,
                8 * width + 4,
                8 * width + 7,
                8 * width + 8,
            ]
        );
    }

    #[test]
    fn two_shared_channels_are_not_a_corner() {
        let (bounds, region, width, height) = unit_square_region();
        // msdfgen treats a transition as a corner when the two edges share at most one channel,
        // so sharing exactly one is still a corner. Two shared channels is a smooth join.
        let edges = [
            Edge::Line {
                points: [Point::new(0.0, 4.0), Point::new(4.0, 4.0)],
                color: RED | GREEN,
            },
            Edge::Line {
                points: [Point::new(4.0, 4.0), Point::new(4.0, 0.0)],
                color: RED | GREEN,
            },
        ];
        let mut protection = Vec::new();
        let contour = 0..2;
        mark_protected_corners(
            &edges,
            core::slice::from_ref(&contour),
            bounds,
            region,
            width,
            height,
            &mut protection,
        )
        .expect("protection");
        assert!(protection.iter().all(|flag| flag & PROTECTED == 0));
    }

    #[test]
    fn a_protected_texel_is_never_rewritten_by_correction() {
        // This pair is the inversion case `corrects_interpolation_inversions_without_changing_alpha`
        // relies on, so the unprotected control is known to be rewritten. Protecting both texels
        // must leave the field untouched: that is what keeps a real corner sharp.
        let source = [255_u8, 230, 0, 17, 0, 230, 255, 23];

        let mut unprotected = source.to_vec();
        let rewritten = correct_interpolation_artifacts(
            &mut unprotected,
            2,
            1,
            0.05,
            0.05,
            &mut Vec::new(),
            &[],
        )
        .expect("correction");

        let mut protected = source.to_vec();
        let untouched = correct_interpolation_artifacts(
            &mut protected,
            2,
            1,
            0.05,
            0.05,
            &mut Vec::new(),
            &[PROTECTED; 2],
        )
        .expect("correction");

        assert_eq!(
            rewritten, 2,
            "the control must actually correct, or this proves nothing"
        );
        assert_ne!(unprotected.as_slice(), source.as_slice());
        assert_eq!(untouched, 0);
        assert_eq!(protected.as_slice(), source.as_slice());
    }

    #[test]
    fn corrects_interpolation_inversions_without_changing_alpha() {
        let mut rgba = vec![255, 230, 0, 17, 0, 230, 255, 23];
        let alpha = [rgba[3], rgba[7]];
        let corrected =
            correct_interpolation_artifacts(&mut rgba, 2, 1, 0.05, 0.05, &mut Vec::new(), &[])
                .expect("correction");
        assert_eq!(corrected, 2);
        assert_eq!(&rgba[..3], &[230, 230, 230]);
        assert_eq!(&rgba[4..7], &[230, 230, 230]);
        assert_eq!([rgba[3], rgba[7]], alpha);
    }

    #[test]
    fn leaves_linear_single_channel_fields_unchanged() {
        let mut rgba = vec![0, 0, 0, 0, 255, 255, 255, 255];
        let expected = rgba.clone();
        let corrected =
            correct_interpolation_artifacts(&mut rgba, 2, 1, 0.05, 0.05, &mut Vec::new(), &[])
                .expect("correction");
        assert_eq!(corrected, 0);
        assert_eq!(rgba, expected);
    }

    #[test]
    fn detects_diagonal_inversions_without_linear_neighbors() {
        let first = [1.0, 230.0 / 255.0, 0.0];
        let second = [0.0; 3];
        let third = [0.0; 3];
        let fourth = [0.0, 230.0 / 255.0, 1.0];
        let span = 0.05;

        assert!(!has_linear_artifact(median3(first), first, second, span));
        assert!(!has_linear_artifact(median3(first), first, third, span));
        assert!(has_diagonal_artifact(
            median3(first),
            first,
            second,
            third,
            fourth,
            span,
        ));
    }

    #[test]
    fn correction_respects_the_expected_distance_span() {
        let inversion = vec![255, 230, 0, 17, 0, 230, 255, 23];
        let mut narrow_span = inversion.clone();
        let mut wide_span = inversion;

        let narrow_corrections =
            correct_interpolation_artifacts(&mut narrow_span, 2, 1, 0.7, 0.7, &mut Vec::new(), &[])
                .expect("narrow correction");
        let wide_corrections =
            correct_interpolation_artifacts(&mut wide_span, 2, 1, 0.8, 0.8, &mut Vec::new(), &[])
                .expect("wide correction");

        assert_eq!(narrow_corrections, 2);
        assert_eq!(wide_corrections, 0);
        assert_eq!(wide_span, vec![255, 230, 0, 17, 0, 230, 255, 23]);
    }
}
