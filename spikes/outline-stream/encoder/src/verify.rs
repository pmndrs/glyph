//! Self-check: read every curve back from both written layouts and every band reference from the written
//! headers. A is compared in f16 against B; B must reproduce the shared curve set exactly.

use std::collections::HashMap;

use pmndrs_glyph_slug_core::{Point, Quadratic};

use crate::layout::{PlacedGlyph, Sections, f16_to_f32};

#[derive(Default, Debug)]
pub struct Report {
    pub curves_checked: usize,
    pub quads: usize,
    pub lines: usize,
    pub referenced_curves: usize,
    pub references_checked: usize,
    /// A (f16 em, decoded × upm) against B (exact), endpoints and quadratic controls, font units.
    pub max_a_vs_b: f32,
    /// A line's bowed f16 control against B's midpoint, font units (V0 bows diagonal lines by 0.125 units).
    pub max_line_control_a_vs_b: f32,
    pub errors: Vec<String>,
}

pub fn verify(sections: &Sections, placed: &[(u32, PlacedGlyph)], units_per_em: f32) -> Report {
    let mut report = Report::default();
    for (glyph_id, glyph) in placed {
        if let Err(message) = verify_glyph(sections, glyph, units_per_em, &mut report) {
            report.errors.push(format!("glyph {glyph_id}: {message}"));
        }
    }
    report
}

fn verify_glyph(
    sections: &Sections,
    glyph: &PlacedGlyph,
    upm: f32,
    report: &mut Report,
) -> Result<(), String> {
    let point_end = glyph.point_base + glyph.point_count;
    let point = |offset: u32| -> Result<(Point, bool), String> {
        let index = glyph.point_base + offset;
        if index >= point_end {
            return Err(format!("point offset {offset} is outside the glyph"));
        }
        let at = 4 * index as usize;
        let b = &sections.points_i16[at..at + 4];
        let xw = i16::from_le_bytes([b[0], b[1]]);
        let y = i16::from_le_bytes([b[2], b[3]]);
        Ok((Point::new(f32::from(xw >> 1), f32::from(y)), xw & 1 != 0))
    };
    let mid = |a: Point, b: Point| Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    // The read rule. Returns the curve and whether it is a line.
    let read_b = |offset: u32| -> Result<(Quadratic, bool), String> {
        let (p, off) = point(offset)?;
        let (n, n_off) = point(offset + 1)?;
        if !off {
            if n_off {
                return Err(format!(
                    "reference {offset} names an on-curve point that starts no line"
                ));
            }
            return Ok((
                Quadratic {
                    p0: p,
                    p1: mid(p, n),
                    p2: n,
                },
                true,
            ));
        }
        let (a, a_off) = point(
            offset
                .checked_sub(1)
                .ok_or("off-curve point has no predecessor")?,
        )?;
        let start = if a_off { mid(a, p) } else { a };
        let end = if n_off { mid(p, n) } else { n };
        Ok((
            Quadratic {
                p0: start,
                p1: p,
                p2: end,
            },
            false,
        ))
    };
    let texel = |offset: u32| -> [f32; 4] {
        let at = 8 * (glyph.curve_base + offset) as usize;
        let b = &sections.curves_f16[at..at + 8];
        let h = |k: usize| f16_to_f32(u16::from_le_bytes([b[2 * k], b[2 * k + 1]])) * upm;
        [h(0), h(1), h(2), h(3)]
    };
    let read_a = |offset: u32| -> Quadratic {
        let (t0, t1) = (texel(offset), texel(offset + 1));
        Quadratic {
            p0: Point::new(t0[0], t0[1]),
            p1: Point::new(t0[2], t0[3]),
            p2: Point::new(t1[0], t1[1]),
        }
    };
    let d = |a: Point, b: Point| (a.x - b.x).abs().max((a.y - b.y).abs());

    let mut by_texel = HashMap::new();
    let mut by_point = HashMap::new();
    for (index, curve) in glyph.curves.iter().enumerate() {
        let texel_offset = u32::from(glyph.texels[index]);
        if (glyph.curve_base + texel_offset) as usize % crate::layout::ROW_TEXELS
            == crate::layout::ROW_TEXELS - 1
        {
            return Err(format!("curve {index} straddles a texel row"));
        }
        by_texel.insert(glyph.texels[index], index);
        by_point.insert(curve.point, index);
        let (b, line) = read_b(u32::from(curve.point))?;
        if line != curve.line {
            return Err(format!("curve {index}: read rule gives the wrong kind"));
        }
        if b != curve.quad {
            return Err(format!(
                "curve {index}: B is not exact: {b:?} vs {:?}",
                curve.quad
            ));
        }
        let a = read_a(texel_offset);
        let ends = d(a.p0, b.p0).max(d(a.p2, b.p2));
        if line {
            report.lines += 1;
            report.max_a_vs_b = report.max_a_vs_b.max(ends);
            report.max_line_control_a_vs_b = report.max_line_control_a_vs_b.max(d(a.p1, b.p1));
        } else {
            report.quads += 1;
            report.max_a_vs_b = report.max_a_vs_b.max(ends.max(d(a.p1, b.p1)));
        }
        report.curves_checked += 1;
    }
    if by_point.len() != glyph.curves.len() || by_texel.len() != glyph.curves.len() {
        return Err("two curves share a texel or point offset".into());
    }

    let bands = 2 * usize::from(crate::layout::BAND_COUNT);
    let base = glyph.band_base as usize;
    let mut in_h = vec![false; glyph.curves.len()];
    let mut in_v = vec![false; glyph.curves.len()];
    for band in 0..bands {
        let header = sections.band_headers[base + band];
        let (count, offset) = ((header >> 16) as usize, (header & 0xffff) as usize);
        for k in 0..count {
            let (ra, rb) = (
                sections.band_refs_a[base + offset + k],
                sections.band_refs_b[base + offset + k],
            );
            let ca = by_texel
                .get(&ra)
                .ok_or_else(|| format!("band {band}: A reference {ra} is not a curve texel"))?;
            let cb = by_point
                .get(&rb)
                .ok_or_else(|| format!("band {band}: B reference {rb} is not a curve point"))?;
            if ca != cb {
                return Err(format!(
                    "band {band} ref {k}: A names curve {ca}, B names curve {cb}"
                ));
            }
            if band < bands / 2 {
                in_h[*ca] = true;
            } else {
                in_v[*ca] = true;
            }
            report.references_checked += 1;
        }
    }
    for index in 0..glyph.curves.len() {
        if !in_h[index] && !glyph.flat_y[index] || !in_v[index] && !glyph.flat_x[index] {
            return Err(format!(
                "curve {index} is missing from every band of an axis it crosses"
            ));
        }
        if in_h[index] || in_v[index] {
            report.referenced_curves += 1;
        }
    }
    Ok(())
}
