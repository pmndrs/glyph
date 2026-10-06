//! Outline stream CPU path for `cpu-bench.mjs`: the scalar triplet decoder and stencil emitter from
//! `research/encoding/decoder` (varint, bp16 and band building removed), plus the GPU point-layout emitter of the
//! outline stream format decision. Scalar Rust, no_std, no allocator: the host places inputs and outputs in linear
//! memory and passes pointers.
#![no_std]

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

/// Structure planes: hdr varint per glyph (2*contours, odd = composite), cn varint per contour. Writes per-glyph
/// point counts, per-glyph contour counts and per-contour sizes; returns total points.
unsafe fn structure(
    hdr: *const u8, glyphs: usize, cn: *const u8, glyph_points: *mut u32, glyph_contours: *mut u32,
    contour_sizes: *mut u16,
) -> usize {
    let (mut h, mut c) = (hdr, cn);
    let mut ci = 0usize;
    let mut total = 0usize;
    for g in 0..glyphs {
        let k = unsafe { varint(&mut h) };
        let mut n = 0u32;
        let contours = if k & 1 == 0 { k >> 1 } else { 0 };
        for _ in 0..contours {
            let s = unsafe { varint(&mut c) };
            unsafe { *contour_sizes.add(ci) = s as u16 };
            ci += 1;
            n += s;
        }
        unsafe {
            *glyph_points.add(g) = n;
            *glyph_contours.add(g) = contours;
        }
        total += n as usize;
    }
    total
}

/// Decodes the whole font into absolute i16 x, y planes and one tag byte per point (1 = off-curve).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_triplet(
    hdr: *const u8, glyphs: usize, cn: *const u8, fl: *const u8, data: *const u8,
    glyph_points: *mut u32, glyph_contours: *mut u32, contour_sizes: *mut u16, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    let total = unsafe { structure(hdr, glyphs, cn, glyph_points, glyph_contours, contour_sizes) };
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

#[inline(always)]
fn word(x: i16, y: i16, off: bool) -> u32 {
    u32::from(((x << 1) | i16::from(off)) as u16) | (u32::from(y as u16) << 16)
}

/// The GPU point layout for the whole font: per contour, rotated to start on its first on-curve point, with one
/// wrap point appended. A contour with no on-curve point starts at an inserted on-curve midpoint, exact at the first
/// neighbour pair whose sums are even, otherwise rounded between the last and first points (the encoder's rule).
/// Writes `glyph_base[glyphs + 1]` (first point of each glyph) and the i16 `(x << 1) | off, y` words; returns the
/// number of words.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn emit_points(
    x: *const i16, y: *const i16, tags: *const u8, glyph_contours: *const u32, contour_sizes: *const u16,
    glyphs: usize, glyph_base: *mut u32, out: *mut u32,
) -> usize {
    let mut w = 0usize;
    let mut src = 0usize;
    let mut ci = 0usize;
    for g in 0..glyphs {
        unsafe { *glyph_base.add(g) = w as u32 };
        let contours = unsafe { *glyph_contours.add(g) } as usize;
        for _ in 0..contours {
            let n = usize::from(unsafe { *contour_sizes.add(ci) });
            ci += 1;
            let p = |k: usize| unsafe { (*x.add(src + k), *y.add(src + k), *tags.add(src + k) != 0) };
            let mut put = |v: u32| {
                unsafe { *out.add(w) = v };
                w += 1;
            };
            match (0..n).find(|&k| !p(k).2) {
                Some(s) => {
                    for k in (s..n).chain(0..s) {
                        let (px, py, off) = p(k);
                        put(word(px, py, off));
                    }
                    let (px, py, _) = p(s);
                    put(word(px, py, false));
                }
                None => {
                    let even = |k: usize| {
                        let (a, b) = (p(k), p((k + 1) % n));
                        (i32::from(a.0) + i32::from(b.0)) & 1 == 0 && (i32::from(a.1) + i32::from(b.1)) & 1 == 0
                    };
                    let k = (0..n).find(|&k| even(k)).unwrap_or(n - 1);
                    let (a, b) = (p(k), p((k + 1) % n));
                    let half = |u: i16, v: i16| {
                        let s = i32::from(u) + i32::from(v);
                        // f32::round: halves away from zero.
                        (if s >= 0 { (s + 1) >> 1 } else { -((-s + 1) >> 1) }) as i16
                    };
                    let synth = word(half(a.0, b.0), half(a.1, b.1), false);
                    put(synth);
                    for j in (k + 1..n).chain(0..=k) {
                        let (px, py, off) = p(j);
                        put(word(px, py, off));
                    }
                    put(synth);
                }
            }
            src += n;
        }
    }
    unsafe { *glyph_base.add(glyphs) = w as u32 };
    w
}

/// The TrueType contour walk: start on the first on-curve point (or the implied midpoint before point 0 when
/// every point is off-curve), then each on-curve point is a line and each off-curve point one quadratic whose end is
/// the next on-curve point or the implied midpoint. Calls `seg(control_or_none, end)`; returns the start point.
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
