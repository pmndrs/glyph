//! Slug band strategies for variable fonts, measured against slug-core's own `build_bands`.
//!
//! Everything band-related works in slug-core's em-space `Quadratic`s (font units / upm), with lines turned into
//! slug-core's bowed quadratics by `line_to_quadratic`, exactly as the static bake does. Each axis of a band set
//! follows `build_axis_bands`: horizontal bands partition y and sort by descending max x; vertical bands partition x
//! and sort by descending max y. The shader (`slug-band.ts`) stops a band at the first curve whose own *instanced*
//! control-point maximum is half a pixel behind the sample, so a list is safe only when every overlapping curve is
//! listed and the instanced maxima are non-increasing along the list.

use pmndrs_glyph_slug_core::{Bounds, DEFAULT_BAND_COUNT, Point, Quadratic, build_bands, line_to_quadratic};

pub const NB: usize = DEFAULT_BAND_COUNT as usize;
const BAND_EPSILON: f32 = 1.0 / 1024.0;
const AXIS_EPSILON: f32 = 1.0e-10;
const BOW: f32 = 0.125;

// ---------------------------------------------------------------------------------------------- input
struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}
impl Rd<'_> {
    fn take(&mut self, n: usize) -> &[u8] {
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        s
    }
    fn u8(&mut self) -> u8 {
        self.take(1)[0]
    }
    fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.take(2).try_into().unwrap())
    }
    fn i16(&mut self) -> i16 {
        self.u16() as i16
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take(4).try_into().unwrap())
    }
    fn f32(&mut self) -> f32 {
        f32::from_le_bytes(self.take(4).try_into().unwrap())
    }
}

pub struct Loc {
    pub kind: u8,
    pub scalars: Vec<f32>,
    pub norm: Vec<f32>,
}
pub struct Spec {
    pub kind: u8,
    pub range: Vec<(f32, f32)>,
}
pub struct Simple {
    pub contours: Vec<u16>,
    pub on: Vec<bool>,
    pub base: Vec<[i16; 2]>,
    /// (region, dense deltas x0 y0 x1 y1 ...)
    pub tuples: Vec<(u16, Vec<f32>)>,
}
pub struct Part {
    pub sid: u32,
    pub off: [i16; 2],
    pub tuples: Vec<(u16, f32, f32)>,
}
pub struct Font {
    pub upm: f32,
    pub regions: usize,
    pub locs: Vec<Loc>,
    pub specs: Vec<Spec>,
    pub simple: Vec<Simple>,
    pub glyphs: Vec<Vec<Part>>,
    pub subsets: Vec<Vec<u32>>,
}

pub fn parse(b: &[u8]) -> Font {
    let mut r = Rd { b, p: 0 };
    assert_eq!(r.take(4), b"VFB1");
    let (g, rc, upm, a, l, p, s) = (r.u32(), r.u32() as usize, r.u32(), r.u32() as usize, r.u32(), r.u32(), r.u32());
    let locs = (0..l)
        .map(|_| {
            let kind = r.u8();
            r.take(3);
            Loc { kind, scalars: (0..rc).map(|_| r.f32()).collect(), norm: (0..a).map(|_| r.f32()).collect() }
        })
        .collect();
    let specs = (0..p)
        .map(|_| {
            let kind = r.u8();
            r.take(3);
            Spec { kind, range: (0..rc).map(|_| (r.f32(), r.f32())).collect() }
        })
        .collect();
    let simple = (0..s)
        .map(|_| {
            let (n, nc) = (r.u32() as usize, r.u32() as usize);
            let contours = (0..nc).map(|_| r.u16()).collect();
            let on = (0..n).map(|_| r.u8() == 0).collect();
            let base = (0..n).map(|_| [r.i16(), r.i16()]).collect();
            let t = r.u32();
            let tuples = (0..t).map(|_| (r.u16(), (0..2 * n).map(|_| r.f32()).collect())).collect();
            Simple { contours, on, base, tuples }
        })
        .collect();
    let glyphs = (0..g)
        .map(|_| {
            let np = r.u32();
            (0..np)
                .map(|_| {
                    let sid = r.u32();
                    let off = [r.i16(), r.i16()];
                    let t = r.u32();
                    Part { sid, off, tuples: (0..t).map(|_| (r.u16(), r.f32(), r.f32())).collect() }
                })
                .collect()
        })
        .collect();
    let ns = r.u32();
    let subsets = (0..ns)
        .map(|_| {
            let n = r.u32();
            (0..n).map(|_| r.u32()).collect()
        })
        .collect();
    assert_eq!(r.p, b.len());
    Font { upm: upm as f32, regions: rc, locs, specs, simple, glyphs, subsets }
}

#[inline]
fn ot_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

// ---------------------------------------------------------------------------------------------- topology
/// A control point of a Slug curve: a stored point (a == b) or the implied midpoint of two stored points.
#[derive(Clone, Copy)]
pub struct PRef(pub u32, pub u32);
#[derive(Clone, Copy)]
pub struct CRef {
    pub p0: PRef,
    /// None: a line, bowed by `line_to_quadratic`.
    pub p1: Option<PRef>,
    pub p2: PRef,
}
pub struct Topo {
    pub npts: usize,
    pub curves: Vec<CRef>,
    /// decomposed point -> (part, local index)
    pub owner: Vec<(u32, u32)>,
}

pub fn topology(f: &Font, g: usize) -> Topo {
    let mut curves = Vec::new();
    let mut owner = Vec::new();
    let mut base = 0usize;
    for (k, part) in f.glyphs[g].iter().enumerate() {
        let s = &f.simple[part.sid as usize];
        let mut st = 0usize;
        for &len in &s.contours {
            let n = len as usize;
            let on = &s.on[st..st + n];
            let at = |i: usize| (base + st + i % n) as u32;
            let first_on = (0..n).find(|&i| on[i]);
            let (mut i, limit, start) = match first_on {
                Some(f0) => (f0 + 1, f0 + n + 1, PRef(at(f0), at(f0))),
                None => (0, n, PRef(at(n - 1), at(0))),
            };
            let mut cur = start;
            while i < limit {
                if on[i % n] {
                    let e = PRef(at(i), at(i));
                    curves.push(CRef { p0: cur, p1: None, p2: e });
                    cur = e;
                    i += 1;
                    continue;
                }
                let ctl = PRef(at(i), at(i));
                let end = if on[(i + 1) % n] {
                    let e = PRef(at(i + 1), at(i + 1));
                    i += 2;
                    e
                } else {
                    let e = PRef(at(i), at(i + 1));
                    i += 1;
                    e
                };
                curves.push(CRef { p0: cur, p1: Some(ctl), p2: end });
                cur = end;
            }
            st += n;
        }
        for li in 0..s.on.len() {
            owner.push((k as u32, li as u32));
        }
        base += s.on.len();
    }
    Topo { npts: base, curves, owner }
}

// ---------------------------------------------------------------------------------------------- instancing
/// Decomposed points of glyph `g` at `scalars`, in font units: round(simple point) + round(component offset),
/// accumulated in f32 in tuple order (the accepted f32 instancing path).
pub fn instance(f: &Font, g: usize, scalars: &[f32], out: &mut Vec<[f32; 2]>) {
    out.clear();
    for part in &f.glyphs[g] {
        let s = &f.simple[part.sid as usize];
        let (mut ox, mut oy) = (f32::from(part.off[0]), f32::from(part.off[1]));
        for &(r, dx, dy) in &part.tuples {
            let sc = scalars[r as usize];
            if sc != 0.0 {
                ox += sc * dx;
                oy += sc * dy;
            }
        }
        let (ox, oy) = ((ox + 0.5).floor(), (oy + 0.5).floor());
        let start = out.len();
        out.extend(s.base.iter().map(|b| [f32::from(b[0]), f32::from(b[1])]));
        for (r, d) in &s.tuples {
            let sc = scalars[*r as usize];
            if sc == 0.0 {
                continue;
            }
            for (p, dd) in out[start..].iter_mut().zip(d.chunks_exact(2)) {
                p[0] += sc * dd[0];
                p[1] += sc * dd[1];
            }
        }
        for p in &mut out[start..] {
            p[0] = (p[0] + 0.5).floor() + ox;
            p[1] = (p[1] + 0.5).floor() + oy;
        }
    }
}

#[inline]
fn pv(pts: &[[f32; 2]], r: PRef) -> [f32; 2] {
    let (a, b) = (pts[r.0 as usize], pts[r.1 as usize]);
    if r.0 == r.1 { a } else { [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5] }
}

/// Slug curves (em space) of one glyph from its decomposed points, as the static bake builds them.
pub fn curves(t: &Topo, pts: &[[f32; 2]], upm: f32, out: &mut Vec<Quadratic>) {
    out.clear();
    let s = 1.0 / upm;
    for c in &t.curves {
        let (a, e) = (pv(pts, c.p0), pv(pts, c.p2));
        let (a, e) = (Point::new(a[0] * s, a[1] * s), Point::new(e[0] * s, e[1] * s));
        out.push(match c.p1 {
            None => line_to_quadratic(a, e, upm),
            Some(q) => {
                let q = pv(pts, q);
                Quadratic { p0: a, p1: Point::new(q[0] * s, q[1] * s), p2: e }
            }
        });
    }
}

/// Control-point hull per curve: [xlo, xhi, ylo, yhi]. The horizontal sort key is xhi, the vertical one yhi.
pub fn hulls(q: &[Quadratic], out: &mut Vec<[f32; 4]>) {
    out.clear();
    out.extend(q.iter().map(|c| {
        [
            c.p0.x.min(c.p1.x).min(c.p2.x),
            c.p0.x.max(c.p1.x).max(c.p2.x),
            c.p0.y.min(c.p1.y).min(c.p2.y),
            c.p0.y.max(c.p1.y).max(c.p2.y),
        ]
    }));
}

// ---------------------------------------------------------------------------------------------- band lists
/// One axis of a band set: CSR over NB bands of curve indices.
#[derive(Clone, Default, Debug)]
pub struct Csr {
    pub off: Vec<u32>,
    pub refs: Vec<u16>,
    /// scratch: packed spans of the last bin
    pub sp: Vec<u16>,
}
impl PartialEq for Csr {
    fn eq(&self, o: &Self) -> bool {
        self.off == o.off && self.refs == o.refs
    }
}
impl Csr {
    pub fn band(&self, b: usize) -> &[u16] {
        &self.refs[self.off[b] as usize..self.off[b + 1] as usize]
    }
    pub fn from_bands(bands: &[pmndrs_glyph_slug_core::Band]) -> Self {
        let mut c = Csr { off: vec![0], refs: Vec::new(), sp: Vec::new() };
        for b in bands {
            c.refs.extend_from_slice(&b.curve_indices);
            c.off.push(c.refs.len() as u32);
        }
        c
    }
}
#[derive(Clone, Default)]
pub struct Set {
    /// Partition box (em). Horizontal bands split [min_y, max_y], vertical bands [min_x, max_x].
    pub b: [f32; 4],
    pub h: Csr,
    pub v: Csr,
}

/// Axis selector: horizontal bands bin on y (hull index 2, 3) and sort by xhi (1); vertical bin on x (0, 1), key yhi (3).
#[derive(Clone, Copy, PartialEq)]
pub enum Ax {
    H,
    V,
}
impl Ax {
    #[inline]
    pub fn lohi(self, h: &[f32; 4]) -> (f32, f32) {
        match self {
            Ax::H => (h[2], h[3]),
            Ax::V => (h[0], h[1]),
        }
    }
    #[inline]
    pub fn key(self, h: &[f32; 4]) -> f32 {
        match self {
            Ax::H => h[1],
            Ax::V => h[3],
        }
    }
    #[inline]
    pub fn range(self, b: &[f32; 4]) -> (f32, f32) {
        match self {
            Ax::H => (b[1], b[3]),
            Ax::V => (b[0], b[2]),
        }
    }
}

/// `build_axis_bands`' band span of an interval, or None when the interval is flat (the curve is skipped).
#[inline]
pub fn span(lo: f32, hi: f32, bmin: f32, size: f32) -> Option<(usize, usize)> {
    if hi - lo < AXIS_EPSILON {
        return None;
    }
    let s = (((lo - bmin - BAND_EPSILON) / size).floor() as i32).clamp(0, NB as i32 - 1);
    let e = (((hi - bmin + BAND_EPSILON) / size).floor() as i32).clamp(0, NB as i32 - 1);
    Some((s as usize, e as usize))
}

/// Descending by key (total order), ties by ascending curve index: the order `build_axis_bands` produces with its
/// stable `sort_by(.. right.total_cmp(&left))` over a curve-order fill, whatever order the list starts in.
#[inline]
pub fn sort_desc(refs: &mut [u16], key: impl Fn(u16) -> f32) {
    let before = |a: u16, ka: f32, b: u16| match ka.total_cmp(&key(b)) {
        core::cmp::Ordering::Greater => true,
        core::cmp::Ordering::Equal => a < b,
        core::cmp::Ordering::Less => false,
    };
    if refs.len() <= 48 {
        for i in 1..refs.len() {
            let x = refs[i];
            let kx = key(x);
            let mut j = i;
            while j > 0 && before(x, kx, refs[j - 1]) {
                refs[j] = refs[j - 1];
                j -= 1;
            }
            refs[j] = x;
        }
    } else {
        refs.sort_unstable_by(|a, b| key(*b).total_cmp(&key(*a)).then(a.cmp(b)));
    }
}

const NO_SPAN: u16 = u16::MAX;

/// Per curve, its packed band span (start | end << 8) on one axis of a partition, or NO_SPAN.
pub fn spans(hull: &[[f32; 4]], skip: Option<&[bool]>, b: &[f32; 4], ax: Ax, out: &mut Vec<u16>) {
    out.clear();
    let (bmin, bmax) = ax.range(b);
    let size = (bmax - bmin) / NB as f32;
    if bmax - bmin <= 0.0 {
        out.resize(hull.len(), NO_SPAN);
        return;
    }
    out.extend(hull.iter().enumerate().map(|(c, h)| {
        if skip.is_some_and(|s| s[c]) {
            return NO_SPAN;
        }
        let (lo, hi) = ax.lohi(h);
        match span(lo, hi, bmin, size) {
            Some((s, e)) => (s | e << 8) as u16,
            None => NO_SPAN,
        }
    }));
}

/// Bin and sort one axis, writing a CSR. `skip[c]` drops a curve from this axis (conservatively flat). `order`, a
/// permutation of every curve, is the fill order: a hint close to the final key order makes the sort nearly free.
pub fn bin_sort_hint(hull: &[[f32; 4]], skip: Option<&[bool]>, b: &[f32; 4], ax: Ax, order: Option<&[u16]>, sort: bool, out: &mut Csr) {
    out.off.clear();
    out.off.resize(NB + 1, 0);
    out.refs.clear();
    let mut sp = core::mem::take(&mut out.sp);
    spans(hull, skip, b, ax, &mut sp);
    let mut cnt = [0u32; NB];
    for &x in &sp {
        if x != NO_SPAN {
            for c in &mut cnt[(x & 0xff) as usize..=(x >> 8) as usize] {
                *c += 1;
            }
        }
    }
    let mut acc = 0u32;
    for i in 0..NB {
        out.off[i] = acc;
        acc += cnt[i];
    }
    out.off[NB] = acc;
    out.refs.resize(acc as usize, 0);
    let mut fill: [u32; NB] = core::array::from_fn(|i| out.off[i]);
    let mut put = |c: u16| {
        let x = sp[c as usize];
        if x != NO_SPAN {
            for f in &mut fill[(x & 0xff) as usize..=(x >> 8) as usize] {
                out.refs[*f as usize] = c;
                *f += 1;
            }
        }
    };
    match order {
        Some(o) => o.iter().for_each(|&c| put(c)),
        None => (0..hull.len() as u16).for_each(&mut put),
    }
    if sort {
        for i in 0..NB {
            let (s, e) = (out.off[i] as usize, out.off[i + 1] as usize);
            sort_desc(&mut out.refs[s..e], |c| ax.key(&hull[c as usize]));
        }
    }
    out.sp = sp;
}

pub fn bin_sort(hull: &[[f32; 4]], skip: Option<&[bool]>, b: &[f32; 4], ax: Ax, sort: bool, out: &mut Csr) {
    bin_sort_hint(hull, skip, b, ax, None, sort, out);
}

/// Load-time fill-order hint: every curve, by descending key at the default instance (no bytes shipped).
pub fn order_hint(hull_default: &[[f32; 4]], ax: Ax) -> Vec<u16> {
    let mut o: Vec<u16> = (0..hull_default.len() as u16).collect();
    sort_desc(&mut o, |c| ax.key(&hull_default[c as usize]));
    o
}

pub fn exact_bounds(q: &[Quadratic]) -> [f32; 4] {
    let b = Bounds::from_curves(q).unwrap();
    [b.min_x, b.min_y, b.max_x, b.max_y]
}

/// S1: exact rebuild with the CSR builder (same output as slug-core's build_bands, verified by `exact_slug`).
pub fn exact_fast(q: &[Quadratic], hull: &[[f32; 4]], out: &mut Set) {
    out.b = exact_bounds(q);
    bin_sort(hull, None, &out.b, Ax::H, true, &mut out.h);
    bin_sort(hull, None, &out.b, Ax::V, true, &mut out.v);
}

/// (d) S1 filled in a load-time order hint: identical lists, nearly-sorted insertion sorts.
pub fn exact_hint(q: &[Quadratic], hull: &[[f32; 4]], oh: &[u16], ov: &[u16], out: &mut Set) {
    out.b = exact_bounds(q);
    bin_sort_hint(hull, None, &out.b, Ax::H, Some(oh), true, &mut out.h);
    bin_sort_hint(hull, None, &out.b, Ax::V, Some(ov), true, &mut out.v);
}

/// S1 with slug-core itself.
pub fn exact_slug(q: &[Quadratic]) -> Set {
    let b = Bounds::from_curves(q).unwrap();
    let gb = build_bands(q, b, DEFAULT_BAND_COUNT).unwrap();
    Set { b: [b.min_x, b.min_y, b.max_x, b.max_y], h: Csr::from_bands(&gb.horizontal), v: Csr::from_bands(&gb.vertical) }
}

// ---------------------------------------------------------------------------------------------- conservative
/// Band set conservative over a spec (region-scalar intervals), with its boxes (the stored keys).
#[derive(Clone, Default)]
pub struct Cons {
    pub set: Set,
    /// conservative hull per curve [xlo, xhi, ylo, yhi] (em)
    pub boxes: Vec<[f32; 4]>,
    /// flat in y at every instance of the spec (skipped from horizontal bands) / flat in x (vertical)
    pub flat_y: Vec<bool>,
    pub flat_x: Vec<bool>,
}

/// Per decomposed point and axis, the integer range every rounded instance in the spec lies in.
pub fn point_ranges(f: &Font, g: usize, spec: &Spec, lo: &mut Vec<[f32; 2]>, hi: &mut Vec<[f32; 2]>) {
    lo.clear();
    hi.clear();
    for part in &f.glyphs[g] {
        let s = &f.simple[part.sid as usize];
        let (mut olo, mut ohi) = ([f64::from(part.off[0]), f64::from(part.off[1])], [f64::from(part.off[0]), f64::from(part.off[1])]);
        for &(r, dx, dy) in &part.tuples {
            let (a, b) = spec.range[r as usize];
            for (k, d) in [dx, dy].into_iter().enumerate() {
                let (u, v) = (f64::from(a) * f64::from(d), f64::from(b) * f64::from(d));
                olo[k] += u.min(v);
                ohi[k] += u.max(v);
            }
        }
        let olo = [ot_round(olo[0] - 1e-3), ot_round(olo[1] - 1e-3)];
        let ohi = [ot_round(ohi[0] + 1e-3), ot_round(ohi[1] + 1e-3)];
        let n = s.on.len();
        let mut l: Vec<[f64; 2]> = s.base.iter().map(|b| [f64::from(b[0]), f64::from(b[1])]).collect();
        let mut h = l.clone();
        for (r, d) in &s.tuples {
            let (a, b) = spec.range[*r as usize];
            if a == 0.0 && b == 0.0 {
                continue;
            }
            for i in 0..n {
                for k in 0..2 {
                    let dd = f64::from(d[2 * i + k]);
                    let (u, v) = (f64::from(a) * dd, f64::from(b) * dd);
                    l[i][k] += u.min(v);
                    h[i][k] += u.max(v);
                }
            }
        }
        for i in 0..n {
            lo.push([(ot_round(l[i][0] - 1e-3) + olo[0]) as f32, (ot_round(l[i][1] - 1e-3) + olo[1]) as f32]);
            hi.push([(ot_round(h[i][0] + 1e-3) + ohi[0]) as f32, (ot_round(h[i][1] + 1e-3) + ohi[1]) as f32]);
        }
    }
}

/// True when every stored point a curve depends on moves identically along `axis` at every instance of the spec.
fn flat_everywhere(f: &Font, g: usize, t: &Topo, c: &CRef, spec: &Spec, axis: usize) -> bool {
    let mut ids = [c.p0.0, c.p0.1, c.p2.0, c.p2.1, c.p0.0, c.p0.0];
    if let Some(q) = c.p1 {
        ids[4] = q.0;
        ids[5] = q.1;
    }
    let (part, l0) = t.owner[ids[0] as usize];
    let s = &f.simple[f.glyphs[g][part as usize].sid as usize];
    let b0 = s.base[l0 as usize][axis];
    for &id in &ids[1..] {
        let (p, li) = t.owner[id as usize];
        if p != part || s.base[li as usize][axis] != b0 {
            return false;
        }
    }
    for (r, d) in &s.tuples {
        if spec.range[*r as usize].1 == 0.0 {
            continue;
        }
        let d0 = d[2 * l0 as usize + axis];
        if ids[1..].iter().any(|&id| d[2 * t.owner[id as usize].1 as usize + axis] != d0) {
            return false;
        }
    }
    true
}

pub fn conservative(f: &Font, g: usize, t: &Topo, spec: &Spec) -> Cons {
    let (mut lo, mut hi) = (Vec::new(), Vec::new());
    point_ranges(f, g, spec, &mut lo, &mut hi);
    let s = 1.0 / f.upm;
    let pad = BOW * s * 1.001;
    let mut out = Cons::default();
    let mut ub = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for c in &t.curves {
        let refs = [Some(c.p0), c.p1, Some(c.p2)];
        let mut bx = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
        for r in refs.into_iter().flatten() {
            let (l, h) = (pv(&lo, r), pv(&hi, r));
            bx[0] = bx[0].min(l[0] * s);
            bx[1] = bx[1].max(h[0] * s);
            bx[2] = bx[2].min(l[1] * s);
            bx[3] = bx[3].max(h[1] * s);
        }
        let fy = flat_everywhere(f, g, t, c, spec, 1);
        let fx = flat_everywhere(f, g, t, c, spec, 0);
        if c.p1.is_none() && !fx && !fy {
            bx[0] -= pad;
            bx[1] += pad;
            bx[2] -= pad;
            bx[3] += pad;
        }
        ub = [ub[0].min(bx[0]), ub[1].min(bx[2]), ub[2].max(bx[1]), ub[3].max(bx[3])];
        out.boxes.push(bx);
        out.flat_y.push(fy);
        out.flat_x.push(fx);
    }
    out.set.b = ub;
    bin_sort(&out.boxes, Some(&out.flat_y), &ub, Ax::H, true, &mut out.set.h);
    bin_sort(&out.boxes, Some(&out.flat_x), &ub, Ax::V, true, &mut out.set.v);
    out
}

pub fn in_spec(loc: &Loc, spec: &Spec) -> bool {
    loc.scalars.iter().zip(&spec.range).all(|(s, (a, b))| *s >= a - 1e-6 && *s <= b + 1e-6)
}

/// Re-sort every band of a list set (in place) by the instanced keys: conservative membership, exact order.
pub fn resort(set: &mut Set, hull: &[[f32; 4]]) {
    for (ax, csr) in [(Ax::H, &mut set.h), (Ax::V, &mut set.v)] {
        for i in 0..NB {
            let (s, e) = (csr.off[i] as usize, csr.off[i + 1] as usize);
            sort_desc(&mut csr.refs[s..e], |c| ax.key(&hull[c as usize]));
        }
    }
}

/// 5(c): keep the candidates whose instanced hull overlaps the band in the fixed partition, then (optionally)
/// stable-sort them by instanced key.
pub fn filter(cands: &Set, hull: &[[f32; 4]], sort: bool, out: &mut Set) {
    out.b = cands.b;
    for (ax, src, dst) in [(Ax::H, &cands.h, &mut out.h), (Ax::V, &cands.v, &mut out.v)] {
        dst.off.clear();
        dst.refs.clear();
        let mut sp = core::mem::take(&mut dst.sp);
        spans(hull, None, &cands.b, ax, &mut sp);
        dst.off.push(0);
        for i in 0..NB {
            let s = dst.refs.len();
            for &c in src.band(i) {
                let x = sp[c as usize];
                if x != NO_SPAN && (x & 0xff) as usize <= i && i <= (x >> 8) as usize {
                    dst.refs.push(c);
                }
            }
            if sort {
                sort_desc(&mut dst.refs[s..], |c| ax.key(&hull[c as usize]));
            }
            dst.off.push(dst.refs.len() as u32);
        }
        dst.sp = sp;
    }
}

/// 5(a) data: conservative boxes with each axis' curve order pre-sorted by descending conservative key, so the
/// runtime only bins (the lists come out already in conservative-key order).
pub struct Presorted {
    pub b: [f32; 4],
    pub boxes: Vec<[f32; 4]>,
    pub order_h: Vec<u16>,
    pub order_v: Vec<u16>,
}
pub fn presort(c: &Cons) -> Presorted {
    let mut oh: Vec<u16> = (0..c.boxes.len() as u16).filter(|&i| !c.flat_y[i as usize]).collect();
    let mut ov: Vec<u16> = (0..c.boxes.len() as u16).filter(|&i| !c.flat_x[i as usize]).collect();
    oh.sort_by(|a, b| c.boxes[*b as usize][1].total_cmp(&c.boxes[*a as usize][1]));
    ov.sort_by(|a, b| c.boxes[*b as usize][3].total_cmp(&c.boxes[*a as usize][3]));
    Presorted { b: c.set.b, boxes: c.boxes.clone(), order_h: oh, order_v: ov }
}
pub fn bin_presorted(p: &Presorted, out: &mut Set) {
    out.b = p.b;
    for (ax, order, dst) in [(Ax::H, &p.order_h, &mut out.h), (Ax::V, &p.order_v, &mut out.v)] {
        dst.off.clear();
        dst.off.resize(NB + 1, 0);
        dst.refs.clear();
        let (bmin, bmax) = ax.range(&p.b);
        if bmax - bmin <= 0.0 {
            continue;
        }
        let size = (bmax - bmin) / NB as f32;
        let mut cnt = [0u32; NB];
        for &c in order {
            let (lo, hi) = ax.lohi(&p.boxes[c as usize]);
            if let Some((s, e)) = span(lo, hi, bmin, size) {
                for x in &mut cnt[s..=e] {
                    *x += 1;
                }
            }
        }
        let mut acc = 0;
        for i in 0..NB {
            dst.off[i] = acc;
            acc += cnt[i];
        }
        dst.off[NB] = acc;
        dst.refs.resize(acc as usize, 0);
        let mut fill: [u32; NB] = core::array::from_fn(|i| dst.off[i]);
        for &c in order {
            let (lo, hi) = ax.lohi(&p.boxes[c as usize]);
            if let Some((s, e)) = span(lo, hi, bmin, size) {
                for f in &mut fill[s..=e] {
                    dst.refs[*f as usize] = c;
                    *f += 1;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- 5(b)
/// Per curve: default hull in font units and, per region the glyph uses, integer bounds on how far its hull edges
/// move per unit scalar: min/max over the curve's stored points of (point delta + component offset delta). Then
/// hull(s) is contained in [L0 + sum s*dmin - 1, H0 + sum s*dmax + 1] (1 = both roundings), linear in the scalars.
pub struct Lin {
    pub regions: Vec<u16>,
    /// per curve [xlo, xhi, ylo, yhi] at the default, font units
    pub h0: Vec<[f32; 4]>,
    /// per curve, per glyph region: [dxmin, dxmax, dymin, dymax]
    pub d: Vec<[f32; 4]>,
    pub line: Vec<bool>,
}
pub fn lin_data(f: &Font, g: usize, t: &Topo) -> Lin {
    let mut regions: Vec<u16> = Vec::new();
    for part in &f.glyphs[g] {
        for (r, _) in &f.simple[part.sid as usize].tuples {
            regions.push(*r);
        }
        for (r, _, _) in &part.tuples {
            regions.push(*r);
        }
    }
    regions.sort_unstable();
    regions.dedup();
    let nr = regions.len();
    let mut base = Vec::new();
    instance(f, g, &vec![0.0; f.regions], &mut base);
    // per decomposed point, per glyph region, the total delta (point + offset)
    let mut pd = vec![[0f32; 2]; t.npts * nr];
    let mut at = 0usize;
    for part in &f.glyphs[g] {
        let s = &f.simple[part.sid as usize];
        let n = s.on.len();
        for (r, d) in &s.tuples {
            let ri = regions.binary_search(r).unwrap();
            for i in 0..n {
                pd[(at + i) * nr + ri][0] += d[2 * i];
                pd[(at + i) * nr + ri][1] += d[2 * i + 1];
            }
        }
        for &(r, dx, dy) in &part.tuples {
            let ri = regions.binary_search(&r).unwrap();
            for i in 0..n {
                pd[(at + i) * nr + ri][0] += dx;
                pd[(at + i) * nr + ri][1] += dy;
            }
        }
        at += n;
    }
    let mut out = Lin { regions, h0: Vec::new(), d: Vec::new(), line: Vec::new() };
    for c in &t.curves {
        let mut ids = vec![c.p0.0, c.p0.1, c.p2.0, c.p2.1];
        if let Some(q) = c.p1 {
            ids.push(q.0);
            ids.push(q.1);
        }
        let mut h = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
        for r in [Some(c.p0), c.p1, Some(c.p2)].into_iter().flatten() {
            let p = pv(&base, r);
            h = [h[0].min(p[0]), h[1].max(p[0]), h[2].min(p[1]), h[3].max(p[1])];
        }
        out.h0.push(h);
        out.line.push(c.p1.is_none());
        for ri in 0..nr {
            let mut d = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
            for &id in &ids {
                let v = pd[id as usize * nr + ri];
                d = [d[0].min(v[0]), d[1].max(v[0]), d[2].min(v[1]), d[3].max(v[1])];
            }
            out.d.push([d[0].floor(), d[1].ceil(), d[2].floor(), d[3].ceil()]);
        }
    }
    out
}
/// Conservative hulls (em) at an instance from 5(b) data, without instancing points.
pub fn lin_hulls(l: &Lin, scalars: &[f32], upm: f32, out: &mut Vec<[f32; 4]>) {
    out.clear();
    let s = 1.0 / upm;
    let pad = BOW * s * 1.001;
    let nr = l.regions.len();
    let sc: Vec<f32> = l.regions.iter().map(|r| scalars[*r as usize]).collect();
    for (c, h0) in l.h0.iter().enumerate() {
        let mut h = [h0[0] - 1.0, h0[1] + 1.0, h0[2] - 1.0, h0[3] + 1.0];
        for (ri, &x) in sc.iter().enumerate() {
            if x == 0.0 {
                continue;
            }
            let d = l.d[c * nr + ri];
            h[0] += x * d[0];
            h[1] += x * d[1];
            h[2] += x * d[2];
            h[3] += x * d[3];
        }
        let p = if l.line[c] { pad } else { 0.0 };
        // widen by one f32 ulp-scale step so f32 rounding of the instancer stays inside
        out.push([(h[0] - 1e-3) * s - p, (h[1] + 1e-3) * s + p, (h[2] - 1e-3) * s - p, (h[3] + 1e-3) * s + p]);
    }
}
pub fn lin_build(hull: &[[f32; 4]], out: &mut Set) {
    let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
    for h in hull {
        b = [b[0].min(h[0]), b[1].min(h[2]), b[2].max(h[1]), b[3].max(h[3])];
    }
    out.b = b;
    bin_sort(hull, None, &b, Ax::H, true, &mut out.h);
    bin_sort(hull, None, &b, Ax::V, true, &mut out.v);
}

// ---------------------------------------------------------------------------------------------- shader emulation
#[inline]
fn root_code(y1: f32, y2: f32, y3: f32) -> u32 {
    let s = (y1 < 0.0) as u32 | ((y2 < 0.0) as u32) << 1 | ((y3 < 0.0) as u32) << 2;
    (0x2e74u32 >> s) & 0x0101
}
#[inline]
fn stable_roots(a: f32, b: f32, c: f32) -> (f32, f32) {
    let disc = b * b - a * c;
    if a.abs() < 1.0 / 65_536.0 {
        let r = c / (b * 2.0);
        (r, r)
    } else if disc <= 0.0 {
        let e = b / a;
        (e, e)
    } else {
        let d = disc.sqrt();
        let q = b + if b >= 0.0 { d } else { -d };
        let (ra, rb) = (q / a, c / q);
        if b >= 0.0 { (rb, ra) } else { (ra, rb) }
    }
}
/// One curve's (coverage, max) in the ray frame (+x through the sample), per `curveContribution` with thicken 1.
#[inline]
fn contribution(p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], ppem: f32) -> (f32, f32) {
    let maximum = p0[0].max(p1[0]).max(p2[0]) * ppem;
    if maximum < -0.5 {
        return (0.0, maximum);
    }
    let code = root_code(p0[1], p1[1], p2[1]);
    if code == 0 {
        return (0.0, maximum);
    }
    let (t1, t2) = stable_roots(p0[1] - p1[1] * 2.0 + p2[1], p0[1] - p1[1], p0[1]);
    let a = p0[0] - p1[0] * 2.0 + p2[0];
    let b = p0[0] - p1[0];
    let r1 = ((a * t1 - b * 2.0) * t1 + p0[0]) * ppem;
    let r2 = ((a * t2 - b * 2.0) * t2 + p0[0]) * ppem;
    let c1 = if code & 1 != 0 { (r1 + 0.5).clamp(0.0, 1.0) } else { 0.0 };
    let c2 = if code & 0x100 != 0 { (r2 + 0.5).clamp(0.0, 1.0) } else { 0.0 };
    (c1 - c2, maximum)
}
#[inline]
fn frame(c: &Quadratic, s: [f32; 2], ax: Ax) -> ([f32; 2], [f32; 2], [f32; 2]) {
    let f = |p: Point| match ax {
        Ax::H => [p.x - s[0], p.y - s[1]],
        Ax::V => [p.y - s[1], p.x - s[0]],
    };
    (f(c.p0), f(c.p1), f(c.p2))
}
#[derive(Clone, Copy, PartialEq)]
pub enum Exit {
    /// today's shader: stop at the first curve whose instanced maximum is half a pixel behind
    Actual,
    /// a shader that reads a stored conservative key per reference instead
    Key,
    /// no early exit
    None,
}
/// Coverage of one band at a sample, and references read. `keys`: per-curve stored keys for `Exit::Key`.
pub fn eval_band(list: &[u16], q: &[Quadratic], s: [f32; 2], ax: Ax, ppem: f32, exit: Exit, keys: Option<&[[f32; 4]]>) -> (f32, u32) {
    let mut cov = 0.0;
    let mut n = 0;
    let sv = if ax == Ax::H { s[0] } else { s[1] };
    for &c in list.iter().take(512) {
        n += 1;
        if exit == Exit::Key {
            let k = ax.key(&keys.unwrap()[c as usize]);
            if (k - sv) * ppem < -0.5 {
                break;
            }
        }
        let (p0, p1, p2) = frame(&q[c as usize], s, ax);
        let (cv, m) = contribution(p0, p1, p2, ppem);
        if exit == Exit::Actual && m < -0.5 {
            break;
        }
        cov += cv;
    }
    (if ax == Ax::V { -cov } else { cov }, n)
}
/// Ground truth: every curve of the glyph, no bands, no exit.
pub fn eval_all(q: &[Quadratic], s: [f32; 2], ax: Ax, ppem: f32) -> f32 {
    let mut cov = 0.0;
    for c in q {
        let (p0, p1, p2) = frame(c, s, ax);
        cov += contribution(p0, p1, p2, ppem).0;
    }
    if ax == Ax::V { -cov } else { cov }
}
#[inline]
pub fn band_of(set: &Set, s: [f32; 2], ax: Ax) -> usize {
    let (bmin, bmax) = ax.range(&set.b);
    let v = if ax == Ax::H { s[1] } else { s[0] };
    if bmax - bmin <= 0.0 {
        return 0;
    }
    let scale = NB as f32 / (bmax - bmin);
    (v * scale - bmin * scale).clamp(0.0, NB as f32 - 1.0) as usize
}

// ---------------------------------------------------------------------------------------------- benchmark state
/// Per-glyph state for timing a glyph set; every per-instance step reads instanced points from slot 0 or 1.
pub struct Bench {
    pub glyphs: Vec<usize>,
    pub topo: Vec<Topo>,
    pub locs: [usize; 2],
    pub pts: [Vec<Vec<[f32; 2]>>; 2],
    pub q: [Vec<Vec<Quadratic>>; 2],
    pub hull: [Vec<Vec<[f32; 4]>>; 2],
    pub spec: usize,
    pub cons: Vec<Cons>,
    pub live: Vec<Set>,
    pub pre: Vec<Presorted>,
    pub lin: Vec<Lin>,
    /// per glyph, default-instance fill-order hints (horizontal, vertical)
    pub hint: Vec<(Vec<u16>, Vec<u16>)>,
    pub scratch: Set,
    pub scratch_q: Vec<Quadratic>,
    pub scratch_h: Vec<[f32; 4]>,
    pub scratch_p: Vec<[f32; 2]>,
}

impl Bench {
    pub fn new(f: &Font, glyphs: Vec<usize>, spec: usize, locs: [usize; 2]) -> Self {
        let glyphs: Vec<usize> = glyphs.into_iter().filter(|&g| !f.glyphs[g].is_empty()).collect();
        let topo: Vec<Topo> = glyphs.iter().map(|&g| topology(f, g)).collect();
        let mk = |li: usize| {
            let pts: Vec<Vec<[f32; 2]>> = glyphs
                .iter()
                .map(|&g| {
                    let mut p = Vec::new();
                    instance(f, g, &f.locs[li].scalars, &mut p);
                    p
                })
                .collect();
            let q: Vec<Vec<Quadratic>> = pts
                .iter()
                .zip(&topo)
                .map(|(p, t)| {
                    let mut q = Vec::new();
                    curves(t, p, f.upm, &mut q);
                    q
                })
                .collect();
            let h: Vec<Vec<[f32; 4]>> = q
                .iter()
                .map(|q| {
                    let mut h = Vec::new();
                    hulls(q, &mut h);
                    h
                })
                .collect();
            (pts, q, h)
        };
        let (p0, q0, h0) = mk(locs[0]);
        let (p1, q1, h1) = mk(locs[1]);
        let cons: Vec<Cons> = glyphs.iter().zip(&topo).map(|(&g, t)| conservative(f, g, t, &f.specs[spec])).collect();
        let live = cons.iter().map(|c| c.set.clone()).collect();
        let pre = cons.iter().map(presort).collect();
        let lin = glyphs.iter().zip(&topo).map(|(&g, t)| lin_data(f, g, t)).collect();
        let hint = glyphs
            .iter()
            .zip(&topo)
            .map(|(&g, t)| {
                let (mut p, mut q, mut h) = (Vec::new(), Vec::new(), Vec::new());
                instance(f, g, &vec![0.0; f.regions], &mut p);
                curves(t, &p, f.upm, &mut q);
                hulls(&q, &mut h);
                (order_hint(&h, Ax::H), order_hint(&h, Ax::V))
            })
            .collect();
        Bench {
            glyphs,
            topo,
            locs,
            pts: [p0, p1],
            q: [q0, q1],
            hull: [h0, h1],
            spec,
            cons,
            live,
            pre,
            lin,
            hint,
            scratch: Set::default(),
            scratch_q: Vec::new(),
            scratch_h: Vec::new(),
            scratch_p: Vec::new(),
        }
    }
    pub fn curve_count(&self) -> usize {
        self.topo.iter().map(|t| t.curves.len()).sum()
    }
    /// step: instance points (dense f32 deltas, scalar)
    pub fn t_instance(&mut self, f: &Font, slot: usize) -> u64 {
        let sc = &f.locs[self.locs[slot]].scalars;
        let mut acc = 0u64;
        for &g in &self.glyphs {
            instance(f, g, sc, &mut self.scratch_p);
            acc += self.scratch_p.len() as u64;
        }
        acc
    }
    /// step: Slug curves from instanced points
    pub fn t_curves(&mut self, f: &Font, slot: usize) -> u64 {
        let mut acc = 0;
        for (t, p) in self.topo.iter().zip(&self.pts[slot]) {
            curves(t, p, f.upm, &mut self.scratch_q);
            acc += self.scratch_q.len() as u64;
        }
        acc
    }
    /// step: control-point hulls from curves
    pub fn t_hulls(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for q in &self.q[slot] {
            hulls(q, &mut self.scratch_h);
            acc += self.scratch_h.len() as u64;
        }
        acc
    }
    /// S1 with slug-core's build_bands (Bounds::from_curves + build_bands, its allocations included)
    pub fn t_s1_slug(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for q in &self.q[slot] {
            let b = Bounds::from_curves(q).unwrap();
            let gb = build_bands(q, b, DEFAULT_BAND_COUNT).unwrap();
            acc += gb.horizontal.iter().chain(&gb.vertical).map(|b| b.curve_indices.len() as u64).sum::<u64>();
        }
        acc
    }
    /// S1 with the CSR builder (bounds + bin + sort), from hulls
    pub fn t_s1_fast(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for (q, h) in self.q[slot].iter().zip(&self.hull[slot]) {
            exact_fast(q, h, &mut self.scratch);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
    /// (d) S1 with the default-instance fill-order hint
    pub fn t_s1_hint(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for ((q, h), (oh, ov)) in self.q[slot].iter().zip(&self.hull[slot]).zip(&self.hint) {
            exact_hint(q, h, oh, ov, &mut self.scratch);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
    /// S2 at load: conservative bands from base points and deltas
    pub fn t_s2_load(&mut self, f: &Font) -> u64 {
        let mut acc = 0;
        for (&g, t) in self.glyphs.iter().zip(&self.topo) {
            let c = conservative(f, g, t, &f.specs[self.spec]);
            acc += (c.set.h.refs.len() + c.set.v.refs.len()) as u64;
        }
        acc
    }
    /// 5(a) at load: bin pre-sorted conservative boxes
    pub fn t_5a(&mut self) -> u64 {
        let mut acc = 0;
        for p in &self.pre {
            bin_presorted(p, &mut self.scratch);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
    /// per instance: re-sort the resident conservative lists by instanced keys (from the hull step)
    pub fn t_resort(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for (s, h) in self.live.iter_mut().zip(&self.hull[slot]) {
            resort(s, h);
            acc += u64::from(s.h.refs.first().copied().unwrap_or(0));
        }
        acc
    }
    /// per instance: 5(c) filter candidates + stable sort by instanced keys
    pub fn t_5c(&mut self, slot: usize, sort: bool) -> u64 {
        let mut acc = 0;
        for (c, h) in self.cons.iter().zip(&self.hull[slot]) {
            filter(&c.set, h, sort, &mut self.scratch);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
    /// per instance: exact bin + sort into the fixed conservative partition, no candidate lists
    pub fn t_fixed_exact(&mut self, slot: usize) -> u64 {
        let mut acc = 0;
        for (c, h) in self.cons.iter().zip(&self.hull[slot]) {
            self.scratch.b = c.set.b;
            bin_sort(h, None, &c.set.b, Ax::H, true, &mut self.scratch.h);
            bin_sort(h, None, &c.set.b, Ax::V, true, &mut self.scratch.v);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
    /// per instance: 5(b) linear conservative hulls + bin + sort, without instanced points
    pub fn t_5b(&mut self, f: &Font, slot: usize) -> u64 {
        let sc = &f.locs[self.locs[slot]].scalars;
        let mut acc = 0;
        for l in &self.lin {
            lin_hulls(l, sc, f.upm, &mut self.scratch_h);
            lin_build(&self.scratch_h, &mut self.scratch);
            acc += (self.scratch.h.refs.len() + self.scratch.v.refs.len()) as u64;
        }
        acc
    }
}

// ---------------------------------------------------------------------------------------------- wasm exports
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::cell::RefCell;
    thread_local! {
        static FONT: RefCell<Option<Font>> = const { RefCell::new(None) };
        static BENCH: RefCell<Option<Bench>> = const { RefCell::new(None) };
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn alloc(n: usize) -> *mut u8 {
        let mut v = vec![0u8; n];
        let p = v.as_mut_ptr();
        core::mem::forget(v);
        p
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn load(p: *const u8, n: usize) -> u32 {
        let b = unsafe { core::slice::from_raw_parts(p, n) };
        let f = parse(b);
        let g = f.glyphs.len() as u32;
        FONT.with(|x| *x.borrow_mut() = Some(f));
        g
    }
    /// subset: 0/1 = font subsets, 254 = every k-th glyph (about 5,000), 255 = every glyph. Returns glyph count kept.
    #[unsafe(no_mangle)]
    pub extern "C" fn prepare(subset: u32, spec: u32, loc_a: u32, loc_b: u32) -> u32 {
        FONT.with(|x| {
            let f = x.borrow();
            let f = f.as_ref().unwrap();
            let glyphs: Vec<usize> = match subset {
                255 => (0..f.glyphs.len()).collect(),
                254 => (0..f.glyphs.len()).step_by(f.glyphs.len().div_ceil(5000)).collect(),
                s => f.subsets[s as usize].iter().map(|&g| g as usize).collect(),
            };
            let b = Bench::new(f, glyphs, spec as usize, [loc_a as usize, loc_b as usize]);
            let n = b.glyphs.len() as u32;
            BENCH.with(|y| *y.borrow_mut() = Some(b));
            n
        })
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn curve_count() -> u32 {
        BENCH.with(|y| y.borrow().as_ref().unwrap().curve_count() as u32)
    }
    /// step ids: 0 instance, 1 curves, 2 hulls, 3 s1 slug-core, 4 s1 csr, 5 s2 load, 6 5a, 7 resort, 8 5c,
    /// 9 5c without sort, 10 fixed exact, 11 5b, 12 s1 with order hint
    #[unsafe(no_mangle)]
    pub extern "C" fn run(step: u32, slot: u32) -> f64 {
        FONT.with(|x| {
            let f = x.borrow();
            let f = f.as_ref().unwrap();
            BENCH.with(|y| {
                let mut y = y.borrow_mut();
                let b = y.as_mut().unwrap();
                let s = slot as usize;
                (match step {
                    0 => b.t_instance(f, s),
                    1 => b.t_curves(f, s),
                    2 => b.t_hulls(s),
                    3 => b.t_s1_slug(s),
                    4 => b.t_s1_fast(s),
                    5 => b.t_s2_load(f),
                    6 => b.t_5a(),
                    7 => b.t_resort(s),
                    8 => b.t_5c(s, true),
                    9 => b.t_5c(s, false),
                    10 => b.t_fixed_exact(s),
                    11 => b.t_5b(f, s),
                    12 => b.t_s1_hint(s),
                    _ => 0,
                }) as f64
            })
        })
    }
}
