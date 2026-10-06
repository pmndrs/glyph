//! Q6: Slug bands under variation, with slug-core's own `build_bands` / `line_to_quadratic` (native, std).
//! Usage: bandtool <bands/key-set.bin>
//! Per glyph, three band sets (16 + 16 bands, slug-core defaults):
//!   default    curves of the default instance, glyph bounds from those curves (what is built today)
//!   conserv    one box per curve covering every instance: lo/hi of its points (see bands_emit.py), plus the line
//!              bow (0.125 units); handed to build_bands as a degenerate quadratic (lo, lo, hi) so curve min/max and
//!              the sort key (max x for horizontal bands, max y for vertical) are the box's; glyph bounds = union
//!   exact@k    curves of instance k, rebuilt (reference for what per-instance rebuilding would give)
//! Checks at every instance k, for default and conserv band sets:
//!   miss       a curve whose instance extent overlaps band b (same overlap rule as build_bands) but is not listed
//!   keyviol    a listed curve whose instance sort-axis maximum exceeds the stored sort key (early exit unsafe)
//!   outside    a glyph whose instance curve bounds exceed the band set's bounds
use pmndrs_glyph_slug_core::{Bounds, Point, Quadratic, build_bands, line_to_quadratic};
use std::{env, fs};

struct Rd<'a> { b: &'a [u8], p: usize }
impl Rd<'_> {
    fn u32(&mut self) -> u32 { let v = u32::from_le_bytes(self.b[self.p..self.p + 4].try_into().unwrap()); self.p += 4; v }
    fn u16(&mut self) -> u16 { let v = u16::from_le_bytes(self.b[self.p..self.p + 2].try_into().unwrap()); self.p += 2; v }
    fn i16(&mut self) -> i16 { self.u16() as i16 }
    fn f32(&mut self) -> f32 { f32::from_le_bytes(self.u32().to_le_bytes()) }
    fn u8(&mut self) -> u8 { let v = self.b[self.p]; self.p += 1; v }
}

/// TrueType contour walk (as the outline-encoding decoder): returns (p0, control-or-None, p2) per segment.
fn walk(pts: &[(f32, f32)], on: &[bool]) -> Vec<((f32, f32), Option<(f32, f32)>, (f32, f32))> {
    walk_idx(pts, on).into_iter().map(|(a, b, c, _)| (a, b, c)).collect()
}

/// Same walk, also returning the stored point indices (start, end) of every line segment.
fn walk_idx(pts: &[(f32, f32)], on: &[bool]) -> Vec<((f32, f32), Option<(f32, f32)>, (f32, f32), Option<(usize, usize)>)> {
    let n = pts.len();
    let p = |k: usize| (pts[k % n].0, pts[k % n].1, on[k % n]);
    let first_on = (0..n).find(|&k| on[k]);
    let (mut k, limit, start) = match first_on {
        Some(s) => (s + 1, s + n + 1, (pts[s].0, pts[s].1)),
        None => { let (a, b) = (pts[n - 1], pts[0]); (0, n, ((a.0 + b.0) * 0.5, (a.1 + b.1) * 0.5)) }
    };
    let mut cur = start;
    let mut cur_idx = first_on;
    let mut out = Vec::new();
    while k < limit {
        let (px, py, o) = p(k);
        if o { out.push((cur, None, (px, py), cur_idx.map(|c| (c % n, k % n)))); cur = (px, py); cur_idx = Some(k % n); k += 1; continue; }
        let (nx, ny, no) = p(k + 1);
        let end = if no { cur_idx = Some((k + 1) % n); k += 2; (nx, ny) } else { cur_idx = None; k += 1; ((px + nx) * 0.5, (py + ny) * 0.5) };
        out.push((cur, Some((px, py)), end, None));
        cur = end;
    }
    out
}

fn quads(pts: &[(f32, f32)], on: &[bool], cs: &[u16], upm: f32) -> Vec<Quadratic> {
    let s = 1.0 / upm;
    let mut out = Vec::new();
    let mut b = 0usize;
    for &c in cs {
        let c = c as usize;
        for (p0, ctl, p2) in walk(&pts[b..b + c], &on[b..b + c]) {
            let (a, e) = (Point::new(p0.0 * s, p0.1 * s), Point::new(p2.0 * s, p2.1 * s));
            out.push(match ctl { None => line_to_quadratic(a, e, upm), Some(q) => Quadratic { p0: a, p1: Point::new(q.0 * s, q.1 * s), p2: e } });
        }
        b += c;
    }
    out
}

/// `flat`: keep a line out of the bands of an axis when it is axis-flat at the default and both endpoints move
/// identically along that axis in every instance (same delta signature), as build_bands does for flat curves.
fn boxes(lo: &[(f32, f32)], hi: &[(f32, f32)], base: &[(f32, f32)], sig: &[(u32, u32)], on: &[bool], cs: &[u16], upm: f32, flat: u8) -> Vec<Quadratic> {
    let s = 1.0 / upm;
    let m = 0.125 * s; // line bow
    let (mut out, mut b) = (Vec::new(), 0usize);
    for &c in cs {
        let c = c as usize;
        let wl = walk(&lo[b..b + c], &on[b..b + c]);
        let wh = walk(&hi[b..b + c], &on[b..b + c]);
        let wb = walk_idx(&base[b..b + c], &on[b..b + c]);
        for (((l0, lc, l2), (h0, hc, h2)), (_, _, _, li)) in wl.into_iter().zip(wh).zip(wb) {
            let mut x0 = l0.0.min(l2.0); let mut y0 = l0.1.min(l2.1);
            let mut x1 = h0.0.max(h2.0); let mut y1 = h0.1.max(h2.1);
            if let (Some(a), Some(z)) = (lc, hc) { x0 = x0.min(a.0); y0 = y0.min(a.1); x1 = x1.max(z.0); y1 = y1.max(z.1); }
            let mut lo = Point::new(x0 * s - m, y0 * s - m);
            let mut hi = Point::new(x1 * s + m, y1 * s + m);
            if let Some((i, j)) = li {
                let (pi, pj) = (base[b + i], base[b + j]);
                // flat 1: y-flat lines leave the horizontal bands (their max-x key is untouched); 2: x-flat, vertical
                if flat == 1 && pi.1 == pj.1 && sig[b + i].1 == sig[b + j].1 { let y = (y0 + y1) * 0.5 * s; lo.y = y; hi.y = y; }
                if flat == 2 && pi.0 == pj.0 && sig[b + i].0 == sig[b + j].0 { let x = (x0 + x1) * 0.5 * s; lo.x = x; hi.x = x; }
            }
            out.push(Quadratic { p0: lo, p1: lo, p2: hi });
        }
        b += c;
    }
    out
}

fn union(q: &[Quadratic]) -> Bounds {
    let mut b = Bounds { min_x: f32::MAX, min_y: f32::MAX, max_x: f32::MIN, max_y: f32::MIN };
    for c in q { for p in [c.p0, c.p1, c.p2] { b.min_x = b.min_x.min(p.x); b.min_y = b.min_y.min(p.y); b.max_x = b.max_x.max(p.x); b.max_y = b.max_y.max(p.y); } }
    b
}

#[derive(Default)]
struct Stat { glyphs: u64, bands: u64, nonempty: u64, refs: u64, max: u64 }
impl Stat {
    fn add(&mut self, bb: &pmndrs_glyph_slug_core::GlyphBands) {
        self.glyphs += 1;
        for b in bb.horizontal.iter().chain(&bb.vertical) {
            let n = b.curve_indices.len() as u64;
            self.bands += 1; self.refs += n; self.max = self.max.max(n); if n > 0 { self.nonempty += 1; }
        }
    }
    fn line(&self, label: &str) {
        println!("{label:28} glyphs {:6}  refs {:9}  mean/band {:7.3}  mean/non-empty band {:7.3}  max/band {:4}",
            self.glyphs, self.refs, self.refs as f64 / self.bands as f64, self.refs as f64 / self.nonempty.max(1) as f64, self.max);
    }
}

const EPS: f32 = 1.0 / 1024.0;
/// curves of instance `inst` (same curve order as the band set) against bands built with `bounds`.
fn check(bands: &pmndrs_glyph_slug_core::GlyphBands, bounds: Bounds, keys_h: &[Quadratic], keys_v: &[Quadratic], inst: &[Quadratic], n: u16) -> (u64, u64, bool) {
    let (mut miss, mut kv) = (0u64, 0u64);
    for (axis, list) in [(0, &bands.horizontal), (1, &bands.vertical)] {
        let (bmin, bmax) = if axis == 0 { (bounds.min_y, bounds.max_y) } else { (bounds.min_x, bounds.max_x) };
        let size = (bmax - bmin) / f32::from(n);
        for (bi, band) in list.iter().enumerate() {
            let set: std::collections::HashSet<u16> = band.curve_indices.iter().copied().collect();
            for (ci, c) in inst.iter().enumerate() {
                let v = if axis == 0 { [c.p0.y, c.p1.y, c.p2.y] } else { [c.p0.x, c.p1.x, c.p2.x] };
                let (lo, hi) = (v[0].min(v[1]).min(v[2]), v[0].max(v[1]).max(v[2]));
                if hi - lo < 1.0e-10 { continue; }
                let s = (((lo - bmin - EPS) / size).floor() as i32).clamp(0, i32::from(n) - 1);
                let e = (((hi - bmin + EPS) / size).floor() as i32).clamp(0, i32::from(n) - 1);
                if (s..=e).contains(&(bi as i32)) && !set.contains(&(ci as u16)) { miss += 1; }
            }
            for &ci in &band.curve_indices {
                let c = inst[ci as usize];
                let k = if axis == 0 { keys_h[ci as usize] } else { keys_v[ci as usize] };
                let (am, km) = if axis == 0 { (c.p0.x.max(c.p1.x).max(c.p2.x), k.p0.x.max(k.p1.x).max(k.p2.x)) }
                               else { (c.p0.y.max(c.p1.y).max(c.p2.y), k.p0.y.max(k.p1.y).max(k.p2.y)) };
                if am > km { kv += 1; }
            }
        }
    }
    let ib = Bounds::from_curves(inst).unwrap();
    let outside = ib.min_x < bounds.min_x - 1e-6 || ib.min_y < bounds.min_y - 1e-6 || ib.max_x > bounds.max_x + 1e-6 || ib.max_y > bounds.max_y + 1e-6;
    (miss, kv, outside)
}

fn main() {
    let path = env::args().nth(1).unwrap();
    let buf = fs::read(&path).unwrap();
    let mut r = Rd { b: &buf, p: 0 };
    let (g, k, upm) = (r.u32() as usize, r.u32() as usize, r.u32() as f32);
    let n = pmndrs_glyph_slug_core::DEFAULT_BAND_COUNT;
    let (mut sd, mut sc, mut sn) = (Stat::default(), Stat::default(), Stat::default());
    let mut se: Vec<Stat> = (0..k).map(|_| Stat::default()).collect();
    let (mut dmiss, mut dkv, mut dout, mut cmiss, mut ckv, mut cout) = (vec![0u64; k], vec![0u64; k], vec![0u64; k], vec![0u64; k], vec![0u64; k], vec![0u64; k]);
    let mut dglyph_bad = vec![0u64; k];
    let mut curves_total = 0u64;
    let (mut flat_h, mut flat_v) = (0u64, 0u64);
    for _ in 0..g {
        let (np, nc) = (r.u32() as usize, r.u32() as usize);
        if np == 0 { continue; }
        let cs: Vec<u16> = (0..nc).map(|_| r.u16()).collect();
        let on: Vec<bool> = (0..np).map(|_| r.u8() == 0).collect();
        let base: Vec<(f32, f32)> = (0..np).map(|_| (f32::from(r.i16()), f32::from(r.i16()))).collect();
        let lo_x: Vec<f32> = (0..2 * np).map(|_| r.f32()).collect();
        let hi_x: Vec<f32> = (0..2 * np).map(|_| r.f32()).collect();
        let lo: Vec<(f32, f32)> = (0..np).map(|i| (lo_x[2 * i], lo_x[2 * i + 1])).collect();
        let hi: Vec<(f32, f32)> = (0..np).map(|i| (hi_x[2 * i], hi_x[2 * i + 1])).collect();
        let sig: Vec<(u32, u32)> = { let v: Vec<u32> = (0..2 * np).map(|_| r.u32()).collect(); (0..np).map(|i| (v[2 * i], v[2 * i + 1])).collect() };
        let insts: Vec<Vec<(f32, f32)>> = (0..k).map(|_| (0..np).map(|_| (f32::from(r.i16()), f32::from(r.i16()))).collect()).collect();
        let q0 = quads(&base, &on, &cs, upm);
        curves_total += q0.len() as u64;
        for c in &q0 {
            if (c.p0.y.max(c.p1.y).max(c.p2.y) - c.p0.y.min(c.p1.y).min(c.p2.y)) < 1.0e-10 { flat_h += 1; }
            if (c.p0.x.max(c.p1.x).max(c.p2.x) - c.p0.x.min(c.p1.x).min(c.p2.x)) < 1.0e-10 { flat_v += 1; }
        }
        let b0 = Bounds::from_curves(&q0).unwrap();
        let bd = build_bands(&q0, b0, n).unwrap();
        sd.add(&bd);
        let qb_h = boxes(&lo, &hi, &base, &sig, &on, &cs, upm, 1);
        let qb_v = boxes(&lo, &hi, &base, &sig, &on, &cs, upm, 2);
        let qb_noflat = boxes(&lo, &hi, &base, &sig, &on, &cs, upm, 0);
        let bc_bounds = union(&qb_noflat);
        let bc = pmndrs_glyph_slug_core::GlyphBands {
            horizontal: build_bands(&qb_h, bc_bounds, n).unwrap().horizontal,
            vertical: build_bands(&qb_v, bc_bounds, n).unwrap().vertical,
        };
        sc.add(&bc);
        sn.add(&build_bands(&qb_noflat, bc_bounds, n).unwrap());
        for j in 0..k {
            let qi = quads(&insts[j], &on, &cs, upm);
            let bi = Bounds::from_curves(&qi).unwrap();
            se[j].add(&build_bands(&qi, bi, n).unwrap());
            let (m, v, o) = check(&bd, b0, &q0, &q0, &qi, n);
            dmiss[j] += m; dkv[j] += v; dout[j] += o as u64; if m + v > 0 { dglyph_bad[j] += 1; }
            let (m, v, o) = check(&bc, bc_bounds, &qb_h, &qb_v, &qi, n);
            cmiss[j] += m; ckv[j] += v; cout[j] += o as u64;
        }
    }
    println!("# {path}: curves {curves_total}, bands per glyph {}, default curves skipped as axis-flat: horizontal {flat_h}, vertical {flat_v}", 2 * n);
    sd.line("default instance only");
    sc.line("conservative, all regions");
    sn.line("conservative, no flat skip");
    for (j, s) in se.iter().enumerate() { s.line(&format!("rebuilt exactly at loc {j}")); }
    for j in 0..k {
        println!("loc {j}: default-only bands: missing refs {:6}, sort-key violations {:6}, glyphs affected {:5}, glyphs outside bounds {:5} | conservative: missing {}, key violations {}, outside {}",
            dmiss[j], dkv[j], dglyph_bad[j], dout[j], cmiss[j], ckv[j], cout[j]);
    }
}
