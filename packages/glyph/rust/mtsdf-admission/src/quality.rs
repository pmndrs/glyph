//! Ground-truth quality measurement for the repository-owned MTSDF kernel.
//!
//! The native msdfgen oracle proves the kernel *agrees with msdfgen*. It cannot prove the
//! reconstructed glyph is *correct*, because a coloring artifact reproduced faithfully is still an
//! artifact. This module supplies the missing reference: an independent scanline rasterization of
//! the same outline, compared against the exact coverage the production fragment shader
//! reconstructs from the generated field.
//!
//! The reconstruction mirrors `packages/glyph/src/tsl/msdf-shader.ts`:
//!
//! ```text
//! coverage = clamp((median3(rgb) - 0.5) * pixelRange * zoom + 0.5, 0, 1)
//! ```
//!
//! The reference rasterizer is deliberately not shared with the kernel under test: it flattens
//! every curve into short chords and fills by scanline crossings, exact in x and supersampled in
//! y. An oracle earns trust by being obviously right, not by being efficient.

use crate::REFERENCE_SUBSAMPLES_PER_ROW;

use std::string::String;

/// One flattened outline in output-pixel space, ready for scanline filling.
pub struct ReferenceOutline {
    points: Vec<[f64; 2]>,
    contours: Vec<core::ops::Range<usize>>,
}

/// Per-glyph agreement between the shader reconstruction and the reference rasterization.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct QualityMeasurement {
    pub sample_count: usize,
    pub mean_absolute_error: f64,
    pub maximum_absolute_error: f64,
    pub worst_x: usize,
    pub worst_y: usize,
    pub samples_over_quarter: usize,
    pub samples_over_half: usize,
}

impl ReferenceOutline {
    pub fn new() -> Self {
        Self {
            points: Vec::new(),
            contours: Vec::new(),
        }
    }

    pub fn clear(&mut self) {
        self.points.clear();
        self.contours.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.contours.is_empty()
    }

    /// Fill one row of pixel coverage in `[0, 1]`, exact in x and subsampled in y.
    fn accumulate_row(
        &self,
        row: usize,
        width: usize,
        crossings: &mut Vec<(f64, i32)>,
        out: &mut [f64],
    ) {
        out.fill(0.0);
        let weight = 1.0 / REFERENCE_SUBSAMPLES_PER_ROW as f64;
        for subsample in 0..REFERENCE_SUBSAMPLES_PER_ROW {
            let y = row as f64 + (subsample as f64 + 0.5) / REFERENCE_SUBSAMPLES_PER_ROW as f64;
            crossings.clear();
            for contour in &self.contours {
                let span = &self.points[contour.clone()];
                for index in 0..span.len() {
                    let start = span[index];
                    let end = span[(index + 1) % span.len()];
                    // Half-open in y so a vertex shared by two chords is counted once.
                    let direction = if start[1] <= y && end[1] > y {
                        1
                    } else if end[1] <= y && start[1] > y {
                        -1
                    } else {
                        continue;
                    };
                    let ratio = (y - start[1]) / (end[1] - start[1]);
                    crossings.push((start[0] + ratio * (end[0] - start[0]), direction));
                }
            }
            if crossings.is_empty() {
                continue;
            }
            crossings.sort_by(|left, right| left.0.total_cmp(&right.0));
            let mut winding = 0;
            let mut span_start = 0.0_f64;
            for &(x, direction) in crossings.iter() {
                if winding == 0 {
                    span_start = x;
                }
                winding += direction;
                if winding == 0 {
                    add_span(out, width, span_start, x, weight);
                }
            }
        }
    }

    /// Reference coverage for every pixel of a `width` x `height` image.
    pub fn rasterize(&self, width: usize, height: usize) -> Vec<f64> {
        let mut coverage = vec![0.0_f64; width * height];
        let mut crossings = Vec::new();
        for row in 0..height {
            let (start, end) = (row * width, row * width + width);
            self.accumulate_row(row, width, &mut crossings, &mut coverage[start..end]);
        }
        coverage
    }
}

impl Default for ReferenceOutline {
    fn default() -> Self {
        Self::new()
    }
}

/// Add a covered x interval's exact per-column overlap into one accumulator row.
fn add_span(out: &mut [f64], width: usize, start: f64, end: f64, weight: f64) {
    let low = start.max(0.0);
    let high = end.min(width as f64);
    if high <= low || high.is_nan() || low.is_nan() {
        return;
    }
    let first = low.floor() as usize;
    let last = ((high.ceil() as usize).max(first + 1)).min(width);
    for (column, accumulated) in out.iter_mut().enumerate().take(last).skip(first) {
        let overlap = high.min(column as f64 + 1.0) - low.max(column as f64);
        if overlap > 0.0 {
            *accumulated += overlap * weight;
        }
    }
}

/// Collects a glyph outline into flattened chords in output-pixel space.
///
/// `to_pixel` maps one font-unit point into the rendered image's pixel coordinates, so the caller
/// owns the y flip and the zoom rather than duplicating the atlas framing here.
pub struct FlatteningPen<F> {
    outline: ReferenceOutline,
    to_pixel: F,
    current: [f32; 2],
    start: [f32; 2],
    open: usize,
    chords_per_curve: usize,
}

impl<F: Fn(f32, f32) -> [f64; 2]> FlatteningPen<F> {
    pub fn new(to_pixel: F, chords_per_curve: usize) -> Self {
        Self {
            outline: ReferenceOutline::new(),
            to_pixel,
            current: [0.0, 0.0],
            start: [0.0, 0.0],
            open: 0,
            chords_per_curve: chords_per_curve.max(1),
        }
    }

    pub fn finish(mut self) -> ReferenceOutline {
        self.close_contour();
        self.outline
    }

    fn push(&mut self, x: f32, y: f32) {
        self.outline.points.push((self.to_pixel)(x, y));
        self.current = [x, y];
    }

    fn close_contour(&mut self) {
        let end = self.outline.points.len();
        if end > self.open {
            self.outline.contours.push(self.open..end);
        }
        self.open = end;
    }
}

impl<F: Fn(f32, f32) -> [f64; 2]> skrifa::outline::OutlinePen for FlatteningPen<F> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.close_contour();
        self.start = [x, y];
        self.push(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y);
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        let [x0, y0] = self.current;
        for step in 1..=self.chords_per_curve {
            let t = step as f32 / self.chords_per_curve as f32;
            let inverse = 1.0 - t;
            let px = inverse * inverse * x0 + 2.0 * inverse * t * control_x + t * t * x;
            let py = inverse * inverse * y0 + 2.0 * inverse * t * control_y + t * t * y;
            self.push(px, py);
        }
        self.current = [x, y];
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
        let [x0, y0] = self.current;
        for step in 1..=self.chords_per_curve {
            let t = step as f32 / self.chords_per_curve as f32;
            let inverse = 1.0 - t;
            let a = inverse * inverse * inverse;
            let b = 3.0 * inverse * inverse * t;
            let c = 3.0 * inverse * t * t;
            let d = t * t * t;
            let px = a * x0 + b * first_control_x + c * second_control_x + d * x;
            let py = a * y0 + b * first_control_y + c * second_control_y + d * y;
            self.push(px, py);
        }
        self.current = [x, y];
    }

    fn close(&mut self) {
        let [x, y] = self.start;
        self.close_contour();
        self.current = [x, y];
    }
}

/// Reconstruct shader coverage from a generated MTSDF field at an integer zoom.
///
/// `field` is the RGBA output of `generate_mtsdf_with_transform`, `width`/`height` its texel
/// dimensions, and `pixel_range` the baked full distance range in atlas texels.
pub fn reconstruct_coverage(
    field: &[u8],
    width: usize,
    height: usize,
    zoom: usize,
    pixel_range: f64,
    channel: Channel,
) -> Vec<f64> {
    let out_width = width * zoom;
    let out_height = height * zoom;
    let mut coverage = vec![0.0_f64; out_width * out_height];
    let screen_range = pixel_range * zoom as f64;
    for row in 0..out_height {
        let v = (row as f64 + 0.5) / zoom as f64 - 0.5;
        for column in 0..out_width {
            let u = (column as f64 + 0.5) / zoom as f64 - 0.5;
            let encoded = sample_bilinear(field, width, height, u, v, channel);
            coverage[row * out_width + column] =
                ((encoded - 0.5) * screen_range + 0.5).clamp(0.0, 1.0);
        }
    }
    coverage
}

/// Which reconstruction the caller wants from the MTSDF field.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Channel {
    /// `median3(r, g, b)` — the sharp multi-channel reconstruction the fill uses.
    Median,
    /// The true signed distance in alpha — never spiky, but rounds real corners.
    TrueDistance,
}

fn sample_bilinear(
    field: &[u8],
    width: usize,
    height: usize,
    u: f64,
    v: f64,
    channel: Channel,
) -> f64 {
    let clamped_u = u.clamp(0.0, (width - 1) as f64);
    let clamped_v = v.clamp(0.0, (height - 1) as f64);
    let x0 = clamped_u.floor() as usize;
    let y0 = clamped_v.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let fx = clamped_u - x0 as f64;
    let fy = clamped_v - y0 as f64;
    let weights = [
        (x0, y0, (1.0 - fx) * (1.0 - fy)),
        (x1, y0, fx * (1.0 - fy)),
        (x0, y1, (1.0 - fx) * fy),
        (x1, y1, fx * fy),
    ];
    // The sampler filters each stored channel independently and the shader takes the median of
    // the filtered values. Taking the median first and interpolating the result would round every
    // corner, which is precisely the property multi-channel encoding exists to preserve.
    let mut channels = [0.0_f64; 4];
    for (x, y, weight) in weights {
        let texel = (y * width + x) * 4;
        for (lane, accumulated) in channels.iter_mut().enumerate() {
            *accumulated += weight * f64::from(field[texel + lane]) / 255.0;
        }
    }
    match channel {
        Channel::Median => {
            let [red, green, blue, _] = channels;
            red.min(green).max(red.max(green).min(blue))
        }
        Channel::TrueDistance => channels[3],
    }
}

/// Compare a reconstruction against the reference rasterization.
pub fn compare(candidate: &[f64], reference: &[f64], width: usize) -> QualityMeasurement {
    let mut measurement = QualityMeasurement {
        sample_count: candidate.len(),
        ..QualityMeasurement::default()
    };
    let mut total = 0.0_f64;
    for (index, (&ours, &truth)) in candidate.iter().zip(reference).enumerate() {
        let error = (ours - truth).abs();
        total += error;
        if error > measurement.maximum_absolute_error {
            measurement.maximum_absolute_error = error;
            measurement.worst_x = index % width;
            measurement.worst_y = index / width;
        }
        if error > 0.25 {
            measurement.samples_over_quarter += 1;
        }
        if error > 0.5 {
            measurement.samples_over_half += 1;
        }
    }
    if !candidate.is_empty() {
        measurement.mean_absolute_error = total / candidate.len() as f64;
    }
    measurement
}

/// Render one comparison image as binary PPM: reference, candidate, then absolute error.
pub fn write_triptych(
    candidate: &[f64],
    reference: &[f64],
    width: usize,
    height: usize,
) -> Vec<u8> {
    let panel_gap = 4;
    let total_width = width * 3 + panel_gap * 2;
    let mut header = String::new();
    core::fmt::Write::write_fmt(
        &mut header,
        format_args!("P6\n{total_width} {height}\n255\n"),
    )
    .expect("string formatting cannot fail");
    let mut bytes = header.into_bytes();
    for row in 0..height {
        for column in 0..total_width {
            let (panel, x) = if column < width {
                (0, column)
            } else if column < width + panel_gap {
                (3, 0)
            } else if column < width * 2 + panel_gap {
                (1, column - width - panel_gap)
            } else if column < width * 2 + panel_gap * 2 {
                (3, 0)
            } else {
                (2, column - width * 2 - panel_gap * 2)
            };
            let index = row * width + x;
            match panel {
                0 => push_grey(&mut bytes, reference[index]),
                1 => push_grey(&mut bytes, candidate[index]),
                2 => push_error(&mut bytes, (candidate[index] - reference[index]).abs()),
                _ => bytes.extend_from_slice(&[24, 24, 28]),
            }
        }
    }
    bytes
}

fn push_grey(bytes: &mut Vec<u8>, value: f64) {
    let level = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    bytes.extend_from_slice(&[level, level, level]);
}

fn push_error(bytes: &mut Vec<u8>, error: f64) {
    // Error ramps black -> amber -> white so a corner spike is unmistakable next to noise.
    let scaled = (error.clamp(0.0, 1.0) * 2.0).min(1.0);
    let red = (scaled * 255.0).round() as u8;
    let green = (scaled * scaled * 190.0).round() as u8;
    let blue = (scaled.powi(4) * 255.0).round() as u8;
    bytes.extend_from_slice(&[red, green, blue]);
}

/// Serializes a glyph outline into msdfgen's `-defineshape` syntax.
///
/// Emitting the same outline both generators consume is what makes the comparison a controlled
/// experiment: identical geometry, identical framing, only the kernel differs.
pub struct ShapePen {
    text: String,
    open: bool,
}

impl ShapePen {
    pub fn new() -> Self {
        Self {
            text: String::new(),
            open: false,
        }
    }

    pub fn finish(mut self) -> String {
        self.close_contour();
        self.text
    }

    fn close_contour(&mut self) {
        if self.open {
            self.text.push_str("# } ");
            self.open = false;
        }
    }
}

impl Default for ShapePen {
    fn default() -> Self {
        Self::new()
    }
}

impl skrifa::outline::OutlinePen for ShapePen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.close_contour();
        self.text.push_str(&format!("{{ {x}, {y}; "));
        self.open = true;
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.text.push_str(&format!("{x}, {y}; "));
    }

    fn quad_to(&mut self, control_x: f32, control_y: f32, x: f32, y: f32) {
        self.text
            .push_str(&format!("({control_x}, {control_y}); {x}, {y}; "));
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
        self.text.push_str(&format!(
            "({first_control_x}, {first_control_y}; {second_control_x}, {second_control_y}); {x}, {y}; "
        ));
    }

    fn close(&mut self) {
        self.close_contour();
    }
}
