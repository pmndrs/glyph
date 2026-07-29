use alloc::vec::Vec;
#[cfg(not(any(feature = "std", test)))]
use core_maths::CoreFloat as _;

const ARTIFACT_T_EPSILON: f64 = 0.01;
const ALPHA_CONFIRMATION_SUBDIVISIONS: usize = 32;
const ALPHA_EDGE_MARGIN: f64 = 4.0 / 255.0;
const MAX_ALPHA_CONFIRMATION_PASSES: usize = 4;
const ERROR: u8 = 1;
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
            if has_artifact_with_neighbor(rgba, grid, x, y) {
                stencil[y * width + x] |= ERROR;
            }
        }
    }

    let mut corrected = apply_median_stencil(rgba, stencil);
    for _ in 0..MAX_ALPHA_CONFIRMATION_PASSES {
        stencil.fill(0);
        if mark_alpha_disagreements(rgba, width, height, stencil) == 0 {
            break;
        }
        corrected = corrected
            .checked_add(apply_true_distance_stencil(rgba, stencil))
            .ok_or(())?;
    }
    Ok(corrected)
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

fn apply_true_distance_stencil(rgba: &mut [u8], stencil: &[u8]) -> usize {
    let mut corrected = 0;
    for (index, mask) in stencil.iter().copied().enumerate() {
        if mask & ERROR == 0 {
            continue;
        }
        // Alpha stores the true signed distance in MTSDF. Once the denser pass proves that
        // interpolated RGB disagrees with it at the coverage boundary, copying that distance
        // removes both the inversion and its wrong magnitude. The edge-fast pass above keeps
        // median correction for ordinary MSDF channel collisions.
        let offset = index * 4;
        let true_distance = rgba[offset + 3];
        rgba[offset] = true_distance;
        rgba[offset + 1] = true_distance;
        rgba[offset + 2] = true_distance;
        corrected += 1;
    }
    corrected
}

fn mark_alpha_disagreements(rgba: &[u8], width: usize, height: usize, stencil: &mut [u8]) -> usize {
    if width < 2 || height < 2 {
        return 0;
    }
    let mut marked = 0;
    for y in 0..height - 1 {
        for x in 0..width - 1 {
            let indices = [
                y * width + x,
                y * width + x + 1,
                (y + 1) * width + x,
                (y + 1) * width + x + 1,
            ];
            let corners = indices.map(|index| pixel4(rgba, index));
            let minimum_alpha = corners
                .iter()
                .map(|corner| corner[3])
                .fold(f64::INFINITY, f64::min);
            let maximum_alpha = corners
                .iter()
                .map(|corner| corner[3])
                .fold(f64::NEG_INFINITY, f64::max);
            // Edge-fast owns far-field inversions. Restrict the denser MTSDF-specific pass to
            // cells whose true-distance alpha reaches the coverage boundary within four byte steps.
            if maximum_alpha < 0.5 - ALPHA_EDGE_MARGIN || minimum_alpha > 0.5 + ALPHA_EDGE_MARGIN {
                continue;
            }
            let spreads = corners.map(|corner| {
                corner[0].max(corner[1]).max(corner[2]) - corner[0].min(corner[1]).min(corner[2])
            });
            for sample_y in 1..ALPHA_CONFIRMATION_SUBDIVISIONS {
                let y_ratio = sample_y as f64 / ALPHA_CONFIRMATION_SUBDIVISIONS as f64;
                for sample_x in 1..ALPHA_CONFIRMATION_SUBDIVISIONS {
                    let x_ratio = sample_x as f64 / ALPHA_CONFIRMATION_SUBDIVISIONS as f64;
                    let sample: [f64; 4] = core::array::from_fn(|channel| {
                        bilinear_channel(corners, channel, x_ratio, y_ratio)
                    });
                    if (median3([sample[0], sample[1], sample[2]]) >= 0.5) == (sample[3] >= 0.5) {
                        continue;
                    }
                    let weights = [
                        (1.0 - x_ratio) * (1.0 - y_ratio),
                        x_ratio * (1.0 - y_ratio),
                        (1.0 - x_ratio) * y_ratio,
                        x_ratio * y_ratio,
                    ];
                    let mut selected = 0;
                    let mut selected_score = 0.0;
                    for corner in 0..4 {
                        let score = spreads[corner] * weights[corner];
                        if score > selected_score {
                            selected = corner;
                            selected_score = score;
                        }
                    }
                    if selected_score > 0.0 && stencil[indices[selected]] & ERROR == 0 {
                        stencil[indices[selected]] |= ERROR;
                        marked += 1;
                    }
                }
            }
        }
    }
    marked
}

fn bilinear_channel(corners: [[f64; 4]; 4], channel: usize, x_ratio: f64, y_ratio: f64) -> f64 {
    let bottom = corners[0][channel] * (1.0 - x_ratio) + corners[1][channel] * x_ratio;
    let top = corners[2][channel] * (1.0 - x_ratio) + corners[3][channel] * x_ratio;
    bottom * (1.0 - y_ratio) + top * y_ratio
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrects_interpolation_inversions_without_changing_alpha() {
        let mut rgba = vec![255, 230, 0, 17, 0, 230, 255, 23];
        let alpha = [rgba[3], rgba[7]];
        let corrected =
            correct_interpolation_artifacts(&mut rgba, 2, 1, 0.05, 0.05, &mut Vec::new())
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
            correct_interpolation_artifacts(&mut rgba, 2, 1, 0.05, 0.05, &mut Vec::new())
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
            correct_interpolation_artifacts(&mut narrow_span, 2, 1, 0.7, 0.7, &mut Vec::new())
                .expect("narrow correction");
        let wide_corrections =
            correct_interpolation_artifacts(&mut wide_span, 2, 1, 0.8, 0.8, &mut Vec::new())
                .expect("wide correction");

        assert_eq!(narrow_corrections, 2);
        assert_eq!(wide_corrections, 0);
        assert_eq!(wide_span, vec![255, 230, 0, 17, 0, 230, 255, 23]);
    }

    #[test]
    fn uses_true_distance_alpha_to_remove_residual_bilinear_holes() {
        let mut rgba = vec![
            110, 110, 107, 110, 130, 130, 161, 130, 130, 140, 130, 130, 155, 155, 157, 155,
        ];
        let alpha = [rgba[3], rgba[7], rgba[11], rgba[15]];
        let corrected =
            correct_interpolation_artifacts(&mut rgba, 2, 2, 0.125, 0.125, &mut Vec::new())
                .expect("correction");
        assert!(corrected > 0);
        assert_eq!([rgba[3], rgba[7], rgba[11], rgba[15]], alpha);
        for pixel in rgba.chunks_exact(4) {
            if pixel[0] == pixel[1] && pixel[1] == pixel[2] {
                assert_eq!(pixel[0], pixel[3]);
            }
        }
        assert_eq!(mark_alpha_disagreements(&rgba, 2, 2, &mut [0; 4]), 0);
        assert_eq!(
            correct_interpolation_artifacts(&mut rgba, 2, 2, 0.125, 0.125, &mut Vec::new(),)
                .expect("idempotent correction"),
            0,
        );
    }
}
