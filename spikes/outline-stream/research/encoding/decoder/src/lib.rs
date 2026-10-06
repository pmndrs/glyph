//! Candidate outline decoders, scalar Rust, no_std, no allocator (except the `bands` feature).
//! The host (bench.mjs) owns memory: it places inputs and outputs in linear memory and passes pointers.
//! Every decoder writes absolute i16 points (x, y planes), one byte per point for the on/off tag, and u16 contour
//! sizes, so all of them feed the same stencil emitter and band builder.
#![no_std]

#[cfg(feature = "bands")]
extern crate alloc;

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[inline(always)]
unsafe fn varint(p: &mut *const u8) -> u32 {
    let mut v = 0u32;
    let mut s = 0;
    loop {
        let b = unsafe { **p };
        *p = unsafe { p.add(1) };
        v |= u32::from(b & 127) << s;
        if b & 128 == 0 {
            return v;
        }
        s += 7;
    }
}

#[inline(always)]
fn unzig(v: u32) -> i32 {
    ((v >> 1) as i32) ^ -((v & 1) as i32)
}

/// Shared structure planes of varint/triplet: hdr varint per glyph (2*contours, odd = composite), cn varint per
/// contour. Writes per-glyph point counts and per-contour sizes; returns total points.
#[cfg(any(feature = "varint", feature = "triplet"))]
unsafe fn structure(hdr: *const u8, glyphs: usize, cn: *const u8, glyph_points: *mut u32, contour_sizes: *mut u16) -> usize {
    let (mut h, mut c) = (hdr, cn);
    let mut ci = 0usize;
    let mut total = 0usize;
    for g in 0..glyphs {
        let k = unsafe { varint(&mut h) };
        let mut n = 0u32;
        if k & 1 == 0 {
            for _ in 0..(k >> 1) {
                let s = unsafe { varint(&mut c) };
                unsafe { *contour_sizes.add(ci) = s as u16 };
                ci += 1;
                n += s;
            }
        }
        unsafe { *glyph_points.add(g) = n };
        total += n as usize;
    }
    total
}

#[cfg(feature = "varint")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_varint(
    hdr: *const u8, glyphs: usize, cn: *const u8, flags: *const u8, xy: *const u8,
    glyph_points: *mut u32, contour_sizes: *mut u16, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    let total = unsafe { structure(hdr, glyphs, cn, glyph_points, contour_sizes) };
    let mut p = xy;
    let mut i = 0usize;
    for g in 0..glyphs {
        let n = unsafe { *glyph_points.add(g) } as usize;
        let (mut ax, mut ay) = (0i32, 0i32);
        for _ in 0..n {
            ax += unzig(unsafe { varint(&mut p) });
            ay += unzig(unsafe { varint(&mut p) });
            unsafe {
                *x.add(i) = ax as i16;
                *y.add(i) = ay as i16;
                *tags.add(i) = (*flags.add(i >> 3) >> (i & 7)) & 1;
            }
            i += 1;
        }
    }
    total
}

#[cfg(feature = "triplet")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_triplet(
    hdr: *const u8, glyphs: usize, cn: *const u8, fl: *const u8, data: *const u8,
    glyph_points: *mut u32, contour_sizes: *mut u16, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    let total = unsafe { structure(hdr, glyphs, cn, glyph_points, contour_sizes) };
    let mut d = data;
    let mut i = 0usize;
    let rd = |d: &mut *const u8| -> i32 {
        let v = unsafe { **d };
        *d = unsafe { d.add(1) };
        i32::from(v)
    };
    for g in 0..glyphs {
        let n = unsafe { *glyph_points.add(g) } as usize;
        let (mut ax, mut ay) = (0i32, 0i32);
        for _ in 0..n {
            let f0 = unsafe { *fl.add(i) };
            let f = i32::from(f0 & 127);
            let (mut dx, mut dy);
            if f < 10 {
                dx = 0; dy = ((f >> 1) << 8) | rd(&mut d); if f & 1 != 0 { dy = -dy; }
            } else if f < 20 {
                let q = f - 10; dy = 0; dx = ((q >> 1) << 8) | rd(&mut d); if q & 1 != 0 { dx = -dx; }
            } else if f < 84 {
                let q = f - 20; let b = rd(&mut d);
                dx = 1 + (q & 0x30) + (b >> 4); dy = 1 + ((q & 0x0c) << 2) + (b & 15);
                if q & 2 != 0 { dx = -dx; } if q & 1 != 0 { dy = -dy; }
            } else if f < 120 {
                let q = f - 84; dx = 1 + ((q / 12) << 8) + rd(&mut d); dy = 1 + (((q % 12) >> 2) << 8) + rd(&mut d);
                if q & 2 != 0 { dx = -dx; } if q & 1 != 0 { dy = -dy; }
            } else if f < 124 {
                let (b0, b1, b2) = (rd(&mut d), rd(&mut d), rd(&mut d));
                dx = (b0 << 4) | (b1 >> 4); dy = ((b1 & 15) << 8) | b2;
                if f & 2 != 0 { dx = -dx; } if f & 1 != 0 { dy = -dy; }
            } else {
                let (b0, b1, b2, b3) = (rd(&mut d), rd(&mut d), rd(&mut d), rd(&mut d));
                dx = (b0 << 8) | b1; dy = (b2 << 8) | b3;
                if f & 2 != 0 { dx = -dx; } if f & 1 != 0 { dy = -dy; }
            }
            ax += dx; ay += dy;
            unsafe { *x.add(i) = ax as i16; *y.add(i) = ay as i16; *tags.add(i) = f0 >> 7; }
            i += 1;
        }
    }
    total
}

/// The maintainer's bp16 layout, per-glyph blocks of 16 points, width nibble per block (15 = 16 bits).
#[cfg(feature = "bp16")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_bp16(
    glyphs: usize, point_count: *const u16, contour_count: *const u16, bbox: *const i16, ends: *const u16,
    flags: *const u64, xw: *const u8, xb: *const u8, yw: *const u8, yb: *const u8,
    contour_sizes: *mut u16, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    let mut i = 0usize;
    let mut ci = 0usize;
    let mut blk = 0usize;
    let (mut xp, mut yp) = (xb, yb);
    for g in 0..glyphs {
        let n = usize::from(unsafe { *point_count.add(g) });
        let nc = usize::from(unsafe { *contour_count.add(g) });
        let mut prev = 0u16;
        for c in 0..nc {
            let e = unsafe { *ends.add(ci + c) };
            unsafe { *contour_sizes.add(ci + c) = e + 1 - if c == 0 { 0 } else { prev + 1 } };
            prev = e;
        }
        ci += nc;
        let (mut ax, mut ay) = unsafe { (i32::from(*bbox.add(4 * g)), i32::from(*bbox.add(4 * g + 1))) };
        let blocks = n.div_ceil(16);
        for b in 0..blocks {
            let wx = nib(xw, blk + b);
            let wy = nib(yw, blk + b);
            let mut vx = [0u32; 16];
            let mut vy = [0u32; 16];
            unsafe { unpack16(&mut xp, wx, &mut vx); unpack16(&mut yp, wy, &mut vy); }
            let m = (n - b * 16).min(16);
            for k in 0..m {
                ax += unzig(vx[k]); ay += unzig(vy[k]);
                unsafe {
                    *x.add(i) = ax as i16; *y.add(i) = ay as i16;
                    *tags.add(i) = ((*flags.add(i >> 6) >> (i & 63)) & 1) as u8;
                }
                i += 1;
            }
        }
        blk += blocks;
    }
    i
}

#[cfg(feature = "bp16")]
#[inline(always)]
fn nib(p: *const u8, k: usize) -> u32 {
    let b = unsafe { *p.add(k >> 1) };
    let w = u32::from(if k & 1 == 0 { b & 15 } else { b >> 4 });
    if w == 15 { 16 } else { w }
}

#[cfg(feature = "bp16")]
#[inline(always)]
unsafe fn unpack16(p: &mut *const u8, w: u32, out: &mut [u32; 16]) {
    if w == 0 { return; }
    let bytes = (2 * w) as usize;
    let mut acc: u64 = 0;
    let mut have = 0u32;
    let mut q = *p;
    let mask = (1u64 << w) - 1;
    for o in out.iter_mut() {
        while have < w {
            acc |= u64::from(unsafe { *q }) << have;
            q = unsafe { q.add(1) };
            have += 8;
        }
        *o = (acc & mask) as u32;
        acc >>= w;
        have -= w;
    }
    *p = unsafe { p.add(bytes) };
}

/// The TrueType contour walk: start on the first on-curve point (or the implied midpoint before point 0 when
/// every point is off-curve), then each on-curve point is a line and each off-curve point one quadratic whose end is
/// the next on-curve point or the implied midpoint. Calls `seg(control_or_none, end)`; returns the start point.
#[cfg(any(feature = "stencil", feature = "bands"))]
#[inline(always)]
fn walk(n: usize, p: impl Fn(usize) -> (f32, f32, bool), mut begin: impl FnMut((f32, f32)), mut seg: impl FnMut(Option<(f32, f32)>, (f32, f32))) -> (f32, f32) {
    let first_on = (0..n).find(|&k| p(k).2);
    let (mut k, limit, start) = match first_on {
        Some(s) => (s + 1, s + n + 1, (p(s).0, p(s).1)),
        None => { let (a, b) = (p(n - 1), p(0)); (0, n, ((a.0 + b.0) * 0.5, (a.1 + b.1) * 0.5)) }
    };
    begin(start);
    while k < limit {
        let (px, py, on) = p(k);
        if on { seg(None, (px, py)); k += 1; continue; }
        let (nx, ny, non) = p(k + 1);
        if non { seg(Some((px, py)), (nx, ny)); k += 2; } else { seg(Some((px, py)), ((px + nx) * 0.5, (py + ny) * 0.5)); k += 1; }
    }
    start
}

/// outlineAt() for one glyph from the absolute point planes, emitted in the exact encoding the shipped shaper returns
/// (u32 contour count, u32 cumulative contour ends in points, f32 x,y explicit 2n+1 points), font units.
#[cfg(feature = "stencil")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emit_outline(
    x: *const i16, y: *const i16, tags: *const u8, contour_sizes: *const u16, contours: usize, out: *mut u8,
) -> usize {
    let head = out as *mut u32;
    unsafe { *head = contours as u32 };
    let pts = unsafe { out.add(4 + 4 * contours) } as *mut f32;
    let mut w = 0usize;
    let mut base = 0usize;
    for c in 0..contours {
        let n = usize::from(unsafe { *contour_sizes.add(c) });
        let b = base;
        let p = |k: usize| -> (f32, f32, bool) {
            let j = b + (k % n);
            unsafe { (f32::from(*x.add(j)), f32::from(*y.add(j)), *tags.add(j) == 0) }
        };
        let w0 = w;
        w += 1;
        let cur = core::cell::Cell::new((0.0f32, 0.0f32));
        let start = walk(n, p, |st| cur.set(st), |ctrl, end| {
            let cur_v = cur.get();
            let ctl = ctrl.unwrap_or(((cur_v.0 + end.0) * 0.5, (cur_v.1 + end.1) * 0.5));
            unsafe {
                *pts.add(2 * w) = ctl.0; *pts.add(2 * w + 1) = ctl.1;
                *pts.add(2 * w + 2) = end.0; *pts.add(2 * w + 3) = end.1;
            }
            w += 2;
            cur.set(end);
        });
        unsafe { *pts.add(2 * w0) = start.0; *pts.add(2 * w0 + 1) = start.1; }
        unsafe { *head.add(1 + c) = w as u32 };
        base += n;
    }
    4 + 4 * contours + 8 * w
}

/// Slug band building at load from the decoded points (slug-core's own line bowing and build_glyph_geometry, 16+16
/// bands), for one glyph. Returns the reference count, or u32::MAX on error. Bump allocator reset per call.
#[cfg(feature = "bands")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn build_bands(
    x: *const i16, y: *const i16, tags: *const u8, contour_sizes: *const u16, contours: usize, upm: f32,
) -> u32 {
    use alloc::vec::Vec;
    use pmndrs_glyph_slug_core::{build_glyph_geometry, line_to_quadratic, Point, Quadratic};
    unsafe { bump::reset() };
    let mut curves: Vec<Quadratic> = Vec::new();
    let mut starts: Vec<u16> = Vec::new();
    let mut base = 0usize;
    let s = 1.0 / upm;
    for c in 0..contours {
        let n = usize::from(unsafe { *contour_sizes.add(c) });
        let b = base;
        let p = |k: usize| -> (f32, f32, bool) {
            let j = b + (k % n);
            unsafe { (f32::from(*x.add(j)) * s, f32::from(*y.add(j)) * s, *tags.add(j) == 0) }
        };
        starts.push(curves.len() as u16);
        let first = curves.len();
        let cur = core::cell::Cell::new(Point::new(0.0, 0.0));
        let _ = first;
        walk(n, p, |st| cur.set(Point::new(st.0, st.1)), |ctrl, end| {
            let e = Point::new(end.0, end.1);
            curves.push(match ctrl {
                None => line_to_quadratic(cur.get(), e, upm),
                Some(q) => Quadratic { p0: cur.get(), p1: Point::new(q.0, q.1), p2: e },
            });
            cur.set(e);
        });
        base += n;
    }
    match build_glyph_geometry(curves, starts, 16) {
        Ok(g) => g.bands.horizontal.iter().chain(&g.bands.vertical).map(|b| b.curve_indices.len() as u32).sum(),
        Err(_) => u32::MAX,
    }
}

#[cfg(feature = "bands")]
mod bump {
    use core::alloc::{GlobalAlloc, Layout};
    const PAGE: usize = 65536;
    static mut BASE: usize = 0;
    static mut TOP: usize = 0;
    static mut END: usize = 0;
    pub unsafe fn reset() { unsafe { TOP = BASE; } }
    struct Bump;
    unsafe impl GlobalAlloc for Bump {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            unsafe {
                if BASE == 0 {
                    let pages = 64;
                    let old = core::arch::wasm32::memory_grow(0, pages);
                    BASE = old * PAGE; TOP = BASE; END = BASE + pages * PAGE;
                }
                let a = (TOP + l.align() - 1) & !(l.align() - 1);
                if a + l.size() > END { return core::ptr::null_mut(); }
                TOP = a + l.size();
                a as *mut u8
            }
        }
        unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
    }
    #[global_allocator]
    static A: Bump = Bump;
}
