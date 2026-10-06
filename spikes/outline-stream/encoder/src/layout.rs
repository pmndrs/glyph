//! Binary sections of `<prefix>.spike.bin`, per the spike plan's asset format.

use pmndrs_glyph_slug_core::{
    Bounds, Point, Quadratic, build_bands, line_to_quadratic, quantize_f16,
};

use crate::outline::{Curve, StreamPoint};

pub const ROW_TEXELS: usize = 4096;
pub const GLYPH_RECORD_BYTES: usize = 32;
/// Today's Slug bake: `DEFAULT_BAND_COUNT` (16) on each axis; the adaptive 16/32/64 policy is autoresearch-only.
pub const BAND_COUNT: u16 = 16;

#[derive(Default)]
pub struct Sections {
    pub glyphs: Vec<u8>,
    /// RGBA16F texels, 8 bytes each.
    pub curves_f16: Vec<u8>,
    /// RG16I texels, 4 bytes each.
    pub points_i16: Vec<u8>,
    pub band_headers: Vec<u32>,
    pub band_refs_a: Vec<u16>,
    pub band_refs_b: Vec<u16>,
}

/// What the verifier needs to find each curve again in both layouts.
pub struct PlacedGlyph {
    pub curve_base: u32,
    pub point_base: u32,
    pub band_base: u32,
    pub point_count: u32,
    pub curves: Vec<Curve>,
    /// Glyph-local texel offset of each curve's first texel.
    pub texels: Vec<u16>,
    /// Curves that build_bands may skip on that axis (flat in both A and B geometry).
    pub flat_y: Vec<bool>,
    pub flat_x: Vec<bool>,
}

#[derive(Default, Debug)]
pub struct BandStats {
    pub references: usize,
    pub stored_references: usize,
    pub shared_bands: usize,
    pub max_band_references: usize,
}

impl Sections {
    pub fn texel_count(&self) -> usize {
        self.curves_f16.len() / 8
    }

    pub fn push_empty(&mut self) {
        let record = Record {
            curve_base: self.texel_count() as u32,
            point_base: (self.points_i16.len() / 4) as u32,
            band_base: self.band_headers.len() as u32,
            bands: 0,
            bounds: Bounds::ZERO,
        };
        record.write(&mut self.glyphs);
    }

    /// Writes one glyph to every section. Returns where its data landed.
    pub fn push_glyph(
        &mut self,
        points: &[StreamPoint],
        curves: Vec<Curve>,
        units_per_em: f32,
        band_stats: &mut BandStats,
    ) -> Result<PlacedGlyph, String> {
        // Variant A curves: em units, f16, lines bowed exactly as the V0 bake does.
        let a_em: Vec<Quadratic> = curves
            .iter()
            .map(|curve| {
                let em = scale(curve.quad, 1.0 / units_per_em);
                let quad = if curve.line {
                    line_to_quadratic(em.p0, em.p2, units_per_em)
                } else {
                    em
                };
                map_points(quad, |v| quantize_f16(v).expect("em coordinate fits f16"))
            })
            .collect();
        let a_units: Vec<Quadratic> = a_em.iter().map(|q| scale(*q, units_per_em)).collect();
        let exact: Vec<Quadratic> = curves.iter().map(|c| c.quad).collect();

        // One band set for both variants: build_bands over the union of the exact (B) and decoded-f16 (A)
        // geometry, so a curve lands in every band either variant's copy touches.
        let n = curves.len();
        let union: Vec<Quadratic> = exact.iter().chain(&a_units).copied().collect();
        let bounds = Bounds::from_curves(&union).ok_or("glyph has no curves")?;
        let built =
            build_bands(&union, bounds, BAND_COUNT).map_err(|e| format!("build_bands: {e:?}"))?;
        let key_x: Vec<f32> = (0..n)
            .map(|i| max3(exact[i], |p| p.x).max(max3(a_units[i], |p| p.x)))
            .collect();
        let key_y: Vec<f32> = (0..n)
            .map(|i| max3(exact[i], |p| p.y).max(max3(a_units[i], |p| p.y)))
            .collect();
        let fold = |indices: &[u16], key: &[f32]| -> Vec<u16> {
            let mut out: Vec<u16> = indices
                .iter()
                .map(|&i| (usize::from(i) % n) as u16)
                .collect();
            out.sort_unstable();
            out.dedup();
            // Descending max coordinate, as the reference requires; ties by curve order.
            out.sort_by(|&l, &r| {
                key[usize::from(r)]
                    .total_cmp(&key[usize::from(l)])
                    .then(l.cmp(&r))
            });
            out
        };
        let bands: Vec<Vec<u16>> = built
            .horizontal
            .iter()
            .map(|b| fold(&b.curve_indices, &key_x))
            .chain(
                built
                    .vertical
                    .iter()
                    .map(|b| fold(&b.curve_indices, &key_y)),
            )
            .collect();
        let flat = |q: Quadratic, f: fn(Point) -> f32| {
            let (a, b, c) = (f(q.p0), f(q.p1), f(q.p2));
            a.max(b).max(c) - a.min(b).min(c) < 1.0e-10
        };
        let flat_y = (0..n)
            .map(|i| flat(exact[i], |p| p.y) && flat(a_units[i], |p| p.y))
            .collect();
        let flat_x = (0..n)
            .map(|i| flat(exact[i], |p| p.x) && flat(a_units[i], |p| p.x))
            .collect();

        // A: V0's endpoint-shared texels, a curve never straddling a row.
        let curve_base = self.texel_count();
        let mut texels = vec![0u16; n];
        let mut i = 0;
        while i < n {
            let contour = curves[i].contour;
            let first = i;
            let mut last = i;
            while i < n && curves[i].contour == contour {
                if self.texel_count() % ROW_TEXELS == ROW_TEXELS - 1 {
                    // The skipped texel still ends the previous curve of this contour, if any.
                    match i.checked_sub(1).filter(|&p| p >= first) {
                        Some(prev) => {
                            let end = a_em[prev].p2;
                            self.push_texel([end.x, end.y, 0.0, 0.0]);
                        }
                        None => self.curves_f16.extend_from_slice(&[0; 8]),
                    }
                }
                texels[i] = u16::try_from(self.texel_count() - curve_base)
                    .map_err(|_| "curve span over u16")?;
                let q = a_em[i];
                self.push_texel([q.p0.x, q.p0.y, q.p1.x, q.p1.y]);
                last = i;
                i += 1;
            }
            let end = a_em[last].p2;
            self.push_texel([end.x, end.y, 0.0, 0.0]);
        }

        // B: the points as they are.
        let point_base = self.points_i16.len() / 4;
        for p in points {
            self.points_i16.extend_from_slice(&p.word());
        }

        // Headers and references share the glyph's bandBase: header i at bandBase + i, reference k of a band
        // at bandBase + refOffset + k. Identical bands share one reference run, as V0 does.
        let band_base = self.band_headers.len();
        let mut offsets: Vec<u16> = Vec::with_capacity(bands.len());
        let mut cursor = 0usize;
        let mut run_a: Vec<u16> = Vec::new();
        let mut run_b: Vec<u16> = Vec::new();
        for (index, band) in bands.iter().enumerate() {
            band_stats.references += band.len();
            band_stats.max_band_references = band_stats.max_band_references.max(band.len());
            if let Some(prior) = (0..index).find(|&p| bands[p] == *band) {
                offsets.push(offsets[prior]);
                band_stats.shared_bands += 1;
                continue;
            }
            offsets.push(u16::try_from(cursor).map_err(|_| "reference offset over u16")?);
            for &c in band {
                run_a.push(texels[usize::from(c)]);
                run_b.push(curves[usize::from(c)].point);
            }
            cursor += band.len();
        }
        band_stats.stored_references += cursor;
        let span = bands.len().max(cursor);
        self.band_headers.resize(band_base + span, 0);
        self.band_refs_a.resize(band_base + span, 0);
        self.band_refs_b.resize(band_base + span, 0);
        for (index, band) in bands.iter().enumerate() {
            let count = u32::try_from(band.len())
                .ok()
                .filter(|&c| c <= 0xffff)
                .ok_or("band over u16 refs")?;
            self.band_headers[band_base + index] = (count << 16) | u32::from(offsets[index]);
        }
        self.band_refs_a[band_base..band_base + cursor].copy_from_slice(&run_a);
        self.band_refs_b[band_base..band_base + cursor].copy_from_slice(&run_b);

        Record {
            curve_base: curve_base as u32,
            point_base: point_base as u32,
            band_base: band_base as u32,
            bands: BAND_COUNT,
            bounds,
        }
        .write(&mut self.glyphs);
        Ok(PlacedGlyph {
            curve_base: curve_base as u32,
            point_base: point_base as u32,
            band_base: band_base as u32,
            point_count: points.len() as u32,
            curves,
            texels,
            flat_y,
            flat_x,
        })
    }

    fn push_texel(&mut self, values: [f32; 4]) {
        for v in values {
            self.curves_f16
                .extend_from_slice(&f16_bits(v).to_le_bytes());
        }
    }

    /// Pads every texture-shaped section to whole 4096-texel rows.
    pub fn pad_rows(&mut self) {
        let pad = |len: usize| len.div_ceil(ROW_TEXELS).max(1) * ROW_TEXELS;
        let texels = pad(self.texel_count());
        self.curves_f16.resize(texels * 8, 0);
        let points = pad(self.points_i16.len() / 4);
        self.points_i16.resize(points * 4, 0);
        let bands = pad(self.band_headers.len());
        self.band_headers.resize(bands, 0);
        self.band_refs_a.resize(bands, 0);
        self.band_refs_b.resize(bands, 0);
    }
}

struct Record {
    curve_base: u32,
    point_base: u32,
    band_base: u32,
    bands: u16,
    bounds: Bounds,
}

impl Record {
    fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.curve_base.to_le_bytes());
        out.extend_from_slice(&self.point_base.to_le_bytes());
        out.extend_from_slice(&self.band_base.to_le_bytes());
        out.extend_from_slice(&self.bands.to_le_bytes());
        out.extend_from_slice(&self.bands.to_le_bytes());
        for v in [
            self.bounds.min_x,
            self.bounds.min_y,
            self.bounds.max_x,
            self.bounds.max_y,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
}

fn scale(q: Quadratic, s: f32) -> Quadratic {
    map_points(q, |v| v * s)
}

fn map_points(q: Quadratic, f: impl Fn(f32) -> f32) -> Quadratic {
    let p = |p: Point| Point::new(f(p.x), f(p.y));
    Quadratic {
        p0: p(q.p0),
        p1: p(q.p1),
        p2: p(q.p2),
    }
}

fn max3(q: Quadratic, f: impl Fn(Point) -> f32) -> f32 {
    f(q.p0).max(f(q.p1)).max(f(q.p2))
}

/// Bits of a value already rounded to binary16 by `quantize_f16` (so no rounding happens here).
fn f16_bits(value: f32) -> u16 {
    let value = quantize_f16(value).expect("em coordinate fits f16");
    let sign = if value.is_sign_negative() { 0x8000 } else { 0 };
    let a = value.abs();
    if a == 0.0 {
        return sign;
    }
    if a < 6.103_515_6e-5 {
        // Subnormal: an exact multiple of 2^-24.
        return sign | (a * 16_777_216.0) as u16;
    }
    let bits = a.to_bits();
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    sign | ((exponent as u16) << 10) | ((bits >> 13) & 0x3ff) as u16
}

pub fn f16_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1f);
    let mantissa = f32::from(bits & 0x3ff);
    sign * if exponent == 0 {
        mantissa * (1.0 / 16_777_216.0)
    } else {
        (1.0 + mantissa / 1024.0) * 2f32.powi(exponent - 15)
    }
}
