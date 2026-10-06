//! Variable-font instancing over the triplet outline stream: no_std, no allocator, host-owned memory.
//!
//! Built twice: `scalar` (-simd128) and `simd` (+simd128). Every `*_simd` export exists only in the SIMD build.
//! Point model ("var points"): per glyph, a simple glyph's glyf points in stored order, or a composite's component
//! offsets, laid out contiguously at `vbase[g]`. gvar deltas index the same points (phantom points are dropped).
#![no_std]

use core::arch::wasm32;

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    wasm32::unreachable()
}

// ------------------------------------------------------------------------------------------------ host memory
static mut TOP: usize = 0;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    unsafe {
        if TOP == 0 {
            TOP = wasm32::memory_size(0) * 65536;
        }
        let a = (TOP + 15) & !15;
        let end = a + n + 16;
        let have = wasm32::memory_size(0) * 65536;
        if end > have && wasm32::memory_grow(0, (end - have).div_ceil(65536)) == usize::MAX {
            return core::ptr::null_mut();
        }
        TOP = end;
        a as *mut u8
    }
}

// ------------------------------------------------------------------------------------------------ primitives
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

#[inline(always)]
fn round_half_up_f32(v: f32) -> i32 {
    let w = v + 0.5;
    let t = w as i32;
    if (t as f32) > w { t - 1 } else { t }
}

#[inline(always)]
fn round_half_up_f64(v: f64) -> i32 {
    let w = v + 0.5;
    let t = w as i32;
    if (t as f64) > w { t - 1 } else { t }
}

// ------------------------------------------------------------------------------------------------ structure
/// hdr: varint per glyph, even k = k/2 contours (simple; 0 = empty), odd k = k>>1 components. cn: varint per
/// contour. Writes per glyph kind (0 empty, 1 simple, 2 composite), simple point count, var point count, first
/// contour index; per contour its size. Returns total simple points.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn structure(
    hdr: *const u8, glyphs: usize, cn: *const u8, kind: *mut u8, npts: *mut u32, nvar: *mut u32, cfirst: *mut u32,
    csize: *mut u16,
) -> u32 {
    let (mut h, mut c) = (hdr, cn);
    let mut ci = 0u32;
    let mut total = 0u32;
    for g in 0..glyphs {
        let k = unsafe { varint(&mut h) };
        unsafe { *cfirst.add(g) = ci };
        if k & 1 == 1 {
            unsafe { *kind.add(g) = 2; *npts.add(g) = 0; *nvar.add(g) = k >> 1 };
            continue;
        }
        let mut n = 0u32;
        for _ in 0..(k >> 1) {
            let s = unsafe { varint(&mut c) };
            unsafe { *csize.add(ci as usize) = s as u16 };
            ci += 1;
            n += s;
        }
        unsafe { *kind.add(g) = if k == 0 { 0 } else { 1 }; *npts.add(g) = n; *nvar.add(g) = n };
        total += n;
    }
    total
}

/// Component plane: per component varint gid, varint zigzag dx, varint zigzag dy, flag byte (1 = 2x2 transform
/// follows, unsupported here). Returns 0, or 1 when a transform is present.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn components(comp: *const u8, n: usize, gid: *mut u32, dx: *mut i16, dy: *mut i16) -> u32 {
    let mut p = comp;
    for i in 0..n {
        unsafe {
            *gid.add(i) = varint(&mut p);
            *dx.add(i) = unzig(varint(&mut p)) as i16;
            *dy.add(i) = unzig(varint(&mut p)) as i16;
            let f = *p;
            p = p.add(1);
            if f != 0 {
                return 1;
            }
        }
    }
    0
}

// ------------------------------------------------------------------------------------------------ triplets, scalar
#[inline(always)]
unsafe fn trip_one(f: i32, d: &mut *const u8) -> (i32, i32) {
    let rd = |d: &mut *const u8| -> i32 {
        let v = unsafe { **d };
        *d = unsafe { d.add(1) };
        i32::from(v)
    };
    let (mut dx, mut dy);
    if f < 10 {
        dx = 0; dy = ((f >> 1) << 8) | rd(d); if f & 1 != 0 { dy = -dy; }
    } else if f < 20 {
        let q = f - 10; dy = 0; dx = ((q >> 1) << 8) | rd(d); if q & 1 != 0 { dx = -dx; }
    } else if f < 84 {
        let q = f - 20; let b = rd(d);
        dx = 1 + (q & 0x30) + (b >> 4); dy = 1 + ((q & 0x0c) << 2) + (b & 15);
        if q & 2 != 0 { dx = -dx; } if q & 1 != 0 { dy = -dy; }
    } else if f < 120 {
        let q = f - 84; dx = 1 + ((q / 12) << 8) + rd(d); dy = 1 + (((q % 12) >> 2) << 8) + rd(d);
        if q & 2 != 0 { dx = -dx; } if q & 1 != 0 { dy = -dy; }
    } else if f < 124 {
        let (b0, b1, b2) = (rd(d), rd(d), rd(d));
        dx = (b0 << 4) | (b1 >> 4); dy = ((b1 & 15) << 8) | b2;
        if f & 2 != 0 { dx = -dx; } if f & 1 != 0 { dy = -dy; }
    } else {
        let (b0, b1, b2, b3) = (rd(d), rd(d), rd(d), rd(d));
        dx = (b0 << 8) | b1; dy = (b2 << 8) | b3;
        if f & 2 != 0 { dx = -dx; } if f & 1 != 0 { dy = -dy; }
    }
    (dx, dy)
}

/// Triplet decode, prefix-summed within each segment. mode 0: base points (flag bit 7 = off-curve tag, written to
/// `tags`); mode 1: deltas (flag 0x80 = (0, 0) with no data bytes). Returns data bytes consumed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn trip_decode(
    mode: u32, fl: *const u8, data: *const u8, seg: *const u32, nseg: usize, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    let mut d = data;
    let mut i = 0usize;
    for s in 0..nseg {
        let n = unsafe { *seg.add(s) };
        let (mut ax, mut ay) = (0i32, 0i32);
        for _ in 0..n {
            let f0 = unsafe { *fl.add(i) };
            let (dx, dy) = if mode == 1 && f0 == 0x80 { (0, 0) } else { unsafe { trip_one(i32::from(f0 & 127), &mut d) } };
            ax += dx; ay += dy;
            unsafe {
                *x.add(i) = ax as i16; *y.add(i) = ay as i16;
                if mode == 0 { *tags.add(i) = f0 >> 7; }
            }
            i += 1;
        }
    }
    unsafe { d.offset_from(data) as usize }
}

// ------------------------------------------------------------------------------------------------ triplets, SIMD
#[cfg(target_feature = "simd128")]
mod simd {
    use core::arch::wasm32::*;

    #[inline(always)]
    pub unsafe fn decode4(c: v128, w: v128, z: v128) -> (v128, v128) {
        let m255 = i32x4_splat(255);
        let one = i32x4_splat(1);
        let zero = i32x4_splat(0);
        let b0 = v128_and(w, m255);
        let b1 = v128_and(u32x4_shr(w, 8), m255);
        let b2 = v128_and(u32x4_shr(w, 16), m255);
        let b3 = u32x4_shr(w, 24);
        // F: >= 124
        let mut dx = v128_or(i32x4_shl(b0, 8), b1);
        let mut dy = v128_or(i32x4_shl(b2, 8), b3);
        // E: 120..124
        let m = i32x4_lt(c, i32x4_splat(124));
        dx = v128_bitselect(v128_or(i32x4_shl(b0, 4), u32x4_shr(b1, 4)), dx, m);
        dy = v128_bitselect(v128_or(i32x4_shl(v128_and(b1, i32x4_splat(15)), 8), b2), dy, m);
        // D: 84..120, q / 12 as (q * 171) >> 11 for q < 36
        let q = i32x4_sub(c, i32x4_splat(84));
        let qd = i32x4_shr(i32x4_mul(q, i32x4_splat(171)), 11);
        let r = i32x4_sub(q, i32x4_mul(qd, i32x4_splat(12)));
        let m = i32x4_lt(c, i32x4_splat(120));
        dx = v128_bitselect(i32x4_add(i32x4_add(one, i32x4_shl(qd, 8)), b0), dx, m);
        dy = v128_bitselect(i32x4_add(i32x4_add(one, i32x4_shl(i32x4_shr(r, 2), 8)), b1), dy, m);
        // C: 20..84
        let q = i32x4_sub(c, i32x4_splat(20));
        let m = i32x4_lt(c, i32x4_splat(84));
        dx = v128_bitselect(i32x4_add(i32x4_add(one, v128_and(q, i32x4_splat(0x30))), u32x4_shr(b0, 4)), dx, m);
        dy = v128_bitselect(
            i32x4_add(i32x4_add(one, i32x4_shl(v128_and(q, i32x4_splat(0x0c)), 2)), v128_and(b0, i32x4_splat(15))),
            dy, m,
        );
        // B: 10..20
        let q = i32x4_sub(c, i32x4_splat(10));
        let mb = i32x4_lt(c, i32x4_splat(20));
        dx = v128_bitselect(v128_or(i32x4_shl(i32x4_shr(q, 1), 8), b0), dx, mb);
        dy = v128_bitselect(zero, dy, mb);
        // A: < 10
        let ma = i32x4_lt(c, i32x4_splat(10));
        dx = v128_bitselect(zero, dx, ma);
        dy = v128_bitselect(v128_or(i32x4_shl(i32x4_shr(c, 1), 8), b0), dy, ma);
        // signs
        let c1 = v128_and(c, one);
        let c2 = u32x4_shr(v128_and(c, i32x4_splat(2)), 1);
        let sx = v128_bitselect(zero, v128_bitselect(c1, c2, mb), ma);
        let sy = v128_bitselect(c1, v128_bitselect(zero, c1, mb), ma);
        dx = i32x4_add(v128_xor(dx, i32x4_neg(sx)), sx);
        dy = i32x4_add(v128_xor(dy, i32x4_neg(sy)), sy);
        (v128_andnot(dx, z), v128_andnot(dy, z))
    }

    /// low 16 bits of each i32 lane of a then b (wrapping narrow)
    #[inline(always)]
    pub fn narrow(a: v128, b: v128) -> v128 {
        i8x16_shuffle::<0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29>(a, b)
    }

    #[inline(always)]
    pub unsafe fn prefix_i16(p: *mut i16, n: usize) {
        let z = i16x8_splat(0);
        let mut carry = z;
        let mut k = 0usize;
        while k + 8 <= n {
            let q = unsafe { p.add(k) } as *mut v128;
            let mut v = unsafe { v128_load(q) };
            v = i16x8_add(v, i8x16_shuffle::<16, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13>(v, z));
            v = i16x8_add(v, i8x16_shuffle::<16, 17, 18, 19, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11>(v, z));
            v = i16x8_add(v, i8x16_shuffle::<16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7>(v, z));
            v = i16x8_add(v, carry);
            unsafe { v128_store(q, v) };
            carry = i8x16_shuffle::<14, 15, 14, 15, 14, 15, 14, 15, 14, 15, 14, 15, 14, 15, 14, 15>(v, v);
            k += 8;
        }
        let mut acc = i16x8_extract_lane::<0>(carry);
        while k < n {
            unsafe {
                acc = acc.wrapping_add(*p.add(k));
                *p.add(k) = acc;
            }
            k += 1;
        }
    }
}

/// SIMD triplet decode, same contract as `trip_decode`:
/// 1. 16 flags at a time: byte length per point from compares (1 + [c>=84] + [c>=120] + [c>=124], 0 for a zero pair),
/// 2. in-register prefix sum of the lengths gives every point's data offset,
/// 3. each group of 4 points is decoded independently (4 unaligned u32 loads, branch-free class selects),
/// 4. a per-segment i16 prefix sum turns deltas into absolute values.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn trip_decode_simd(
    mode: u32, fl: *const u8, data: *const u8, seg: *const u32, nseg: usize, x: *mut i16, y: *mut i16, tags: *mut u8,
) -> usize {
    use core::arch::wasm32::*;
    let mut total = 0usize;
    for s in 0..nseg {
        total += unsafe { *seg.add(s) } as usize;
    }
    let mut d = data;
    let mut i = 0usize;
    let z8 = i8x16_splat(0);
    while i + 16 <= total {
        let f = unsafe { v128_load(fl.add(i) as *const v128) };
        let cls = v128_and(f, u8x16_splat(0x7f));
        let mut len = i8x16_sub(
            i8x16_sub(i8x16_sub(i8x16_splat(1), u8x16_ge(cls, u8x16_splat(84))), u8x16_ge(cls, u8x16_splat(120))),
            u8x16_ge(cls, u8x16_splat(124)),
        );
        let zm = if mode == 1 { i8x16_eq(f, u8x16_splat(0x80)) } else { z8 };
        len = v128_andnot(len, zm);
        let mut p = len;
        p = i8x16_add(p, i8x16_shuffle::<16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 16, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 16, 16, 16, 16, 16, 16, 0, 1, 2, 3, 4, 5, 6, 7>(p, z8));
        let excl = i8x16_sub(p, len);
        let mut offs = [0u8; 16];
        unsafe { v128_store(offs.as_mut_ptr() as *mut v128, excl) };
        let tot = u8x16_extract_lane::<15>(p) as usize;
        if mode == 0 {
            unsafe { v128_store(tags.add(i) as *mut v128, u8x16_shr(f, 7)) };
        }
        let c16 = [u16x8_extend_low_u8x16(cls), u16x8_extend_high_u8x16(cls)];
        let z16 = [i16x8_extend_low_i8x16(zm), i16x8_extend_high_i8x16(zm)];
        for h in 0..2 {
            let mut gx = [i32x4_splat(0); 2];
            let mut gy = [i32x4_splat(0); 2];
            for q in 0..2 {
                let c = if q == 0 { u32x4_extend_low_u16x8(c16[h]) } else { u32x4_extend_high_u16x8(c16[h]) };
                let zz = if q == 0 { i32x4_extend_low_i16x8(z16[h]) } else { i32x4_extend_high_i16x8(z16[h]) };
                let base = h * 8 + q * 4;
                let rd = |k: usize| -> u32 { unsafe { core::ptr::read_unaligned(d.add(offs[base + k] as usize) as *const u32) } };
                let w = u32x4(rd(0), rd(1), rd(2), rd(3));
                let (a, b) = unsafe { simd::decode4(c, w, zz) };
                gx[q] = a; gy[q] = b;
            }
            unsafe {
                v128_store(x.add(i + h * 8) as *mut v128, simd::narrow(gx[0], gx[1]));
                v128_store(y.add(i + h * 8) as *mut v128, simd::narrow(gy[0], gy[1]));
            }
        }
        d = unsafe { d.add(tot) };
        i += 16;
    }
    while i < total {
        let f0 = unsafe { *fl.add(i) };
        let (dx, dy) = if mode == 1 && f0 == 0x80 { (0, 0) } else { unsafe { trip_one(i32::from(f0 & 127), &mut d) } };
        unsafe {
            *x.add(i) = dx as i16; *y.add(i) = dy as i16;
            if mode == 0 { *tags.add(i) = f0 >> 7; }
        }
        i += 1;
    }
    let mut s0 = 0usize;
    for s in 0..nseg {
        let n = unsafe { *seg.add(s) } as usize;
        unsafe { simd::prefix_i16(x.add(s0), n); simd::prefix_i16(y.add(s0), n) };
        s0 += n;
    }
    unsafe { d.offset_from(data) as usize }
}

// ------------------------------------------------------------------------------------------------ var points
/// Lay simple points and component offsets out as var points: vbase[g] = prefix of nvar. Tags follow (0 for comps).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unify(
    glyphs: usize, kind: *const u8, nvar: *const u32, sx: *const i16, sy: *const i16, stags: *const u8,
    cx: *const i16, cy: *const i16, vbase: *mut u32, vx: *mut i16, vy: *mut i16, vtags: *mut u8, cfirst_comp: *mut u32,
) -> u32 {
    let (mut s, mut c, mut v) = (0usize, 0usize, 0usize);
    for g in 0..glyphs {
        let n = unsafe { *nvar.add(g) } as usize;
        unsafe { *vbase.add(g) = v as u32; *cfirst_comp.add(g) = c as u32 };
        let k = unsafe { *kind.add(g) };
        for j in 0..n {
            unsafe {
                if k == 2 {
                    *vx.add(v + j) = *cx.add(c + j); *vy.add(v + j) = *cy.add(c + j); *vtags.add(v + j) = 0;
                } else {
                    *vx.add(v + j) = *sx.add(s + j); *vy.add(v + j) = *sy.add(s + j); *vtags.add(v + j) = *stags.add(s + j);
                }
            }
        }
        if k == 2 { c += n } else { s += n }
        v += n;
    }
    unsafe { *vbase.add(glyphs) = v as u32 };
    v as u32
}

// ------------------------------------------------------------------------------------------------ delta structure
/// Glyph-major tuple headers. Per tuple writes glyph, region, coded value count, value offset, and (sparse) the
/// explicit point index of every coded value; tfirst[g] is the glyph's first tuple. pts = null for dense streams.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn delta_structure(
    glyphs: usize, tcount: *const u8, rid: *const u8, pts: *const u8, nvar: *const u32, tfirst: *mut u32,
    t_glyph: *mut u32, t_region: *mut u32, t_len: *mut u32, t_off: *mut u32, idx: *mut u16,
) -> u32 {
    let (mut tc, mut r, mut p) = (tcount, rid, pts);
    let mut t = 0usize;
    let mut off = 0u32;
    for g in 0..glyphs {
        let k = unsafe { varint(&mut tc) };
        unsafe { *tfirst.add(g) = t as u32 };
        let n = unsafe { *nvar.add(g) };
        for _ in 0..k {
            unsafe {
                *t_glyph.add(t) = g as u32;
                *t_region.add(t) = varint(&mut r);
                *t_off.add(t) = off;
                let mut len = n;
                if !pts.is_null() {
                    let cnt = varint(&mut p);
                    if cnt == 0 {
                        for j in 0..n { *idx.add((off + j) as usize) = j as u16; }
                    } else {
                        len = cnt;
                        let mut at = 0u32;
                        for j in 0..cnt {
                            let gap = varint(&mut p);
                            at = if j == 0 { gap } else { at + gap + 1 };
                            *idx.add((off + j) as usize) = at as u16;
                        }
                    }
                }
                *t_len.add(t) = len;
                off += len;
            }
            t += 1;
        }
    }
    unsafe { *tfirst.add(glyphs) = t as u32 };
    t as u32
}

// ------------------------------------------------------------------------------------------------ IUP
/// fontTools iup_segment over one axis, f64.
#[inline(always)]
fn iup_axis(x: f64, x1: f64, x2: f64, d1: f64, d2: f64) -> f64 {
    let (mut x1, mut x2, mut d1, mut d2) = (x1, x2, d1, d2);
    if x1 == x2 {
        return if d1 == d2 { d1 } else { 0.0 };
    }
    if x1 > x2 {
        core::mem::swap(&mut x1, &mut x2);
        core::mem::swap(&mut d1, &mut d2);
    }
    let scale = (d2 - d1) / (x2 - x1);
    if x <= x1 { d1 } else if x >= x2 { d2 } else { d1 + (x - x1) * scale }
}

/// Expand sparse tuples to dense deltas (IUP, interpolation of untouched points, as fontTools iup_contour), f64
/// arithmetic; writes f32 (`wide` = 0) or f64 (`wide` = 1) pools at dense offset doff[t] = prefix of nvar[glyph].
/// scratch: u8 per point of the largest glyph (touched marks), plus f64 x/y of the glyph's explicit deltas.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn iup_expand(
    ntuples: usize, t_glyph: *const u32, t_len: *const u32, t_off: *const u32, idx: *const u16, vxs: *const i16,
    vys: *const i16, kind: *const u8, nvar: *const u32, vbase: *const u32, cfirst: *const u32, csize: *const u16,
    vx: *const i16, vy: *const i16, wide: u32, out_x: *mut u8, out_y: *mut u8, doff: *mut u32, scratch: *mut u8,
    sdx: *mut f64, sdy: *mut f64,
) -> u32 {
    let mut o = 0u32;
    for t in 0..ntuples {
        let g = unsafe { *t_glyph.add(t) } as usize;
        let n = unsafe { *nvar.add(g) } as usize;
        let len = unsafe { *t_len.add(t) } as usize;
        let off = unsafe { *t_off.add(t) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        unsafe { *doff.add(t) = o };
        for j in 0..n { unsafe { *scratch.add(j) = 0; *sdx.add(j) = 0.0; *sdy.add(j) = 0.0 } }
        for j in 0..len {
            let k = usize::from(unsafe { *idx.add(off + j) });
            unsafe { *scratch.add(k) = 1; *sdx.add(k) = f64::from(*vxs.add(off + j)); *sdy.add(k) = f64::from(*vys.add(off + j)) }
        }
        let store = |k: usize, a: f64, c: f64| unsafe {
            let at = o as usize + k;
            if wide == 1 { *(out_x as *mut f64).add(at) = a; *(out_y as *mut f64).add(at) = c; }
            else { *(out_x as *mut f32).add(at) = a as f32; *(out_y as *mut f32).add(at) = c as f32; }
        };
        if len == n {
            for k in 0..n { unsafe { store(k, *sdx.add(k), *sdy.add(k)) } }
        } else {
            // contours: simple glyph contour sizes, or one point per component
            let composite = unsafe { *kind.add(g) } == 2;
            let mut start = 0usize;
            let mut c = unsafe { *cfirst.add(g) } as usize;
            while start < n {
                let cn = if composite { 1 } else { usize::from(unsafe { *csize.add(c) }) };
                c += 1;
                let end = start + cn;
                // touched indices in [start, end)
                let mut first = usize::MAX;
                let mut last = usize::MAX;
                for k in start..end { if unsafe { *scratch.add(k) } == 1 { if first == usize::MAX { first = k; } last = k; } }
                if first == usize::MAX {
                    for k in start..end { store(k, 0.0, 0.0); }
                } else {
                    let px = |k: usize| f64::from(unsafe { *vx.add(b + k) });
                    let py = |k: usize| f64::from(unsafe { *vy.add(b + k) });
                    let dx = |k: usize| unsafe { *sdx.add(k) };
                    let dy = |k: usize| unsafe { *sdy.add(k) };
                    let seg = |lo: usize, hi: usize, r1: usize, r2: usize| {
                        for k in lo..hi {
                            store(k, iup_axis(px(k), px(r1), px(r2), dx(r1), dx(r2)), iup_axis(py(k), py(r1), py(r2), dy(r1), dy(r2)));
                        }
                    };
                    if first != start { seg(start, first, first, last); }
                    let mut prev = first;
                    store(first, dx(first), dy(first));
                    for k in first + 1..=last {
                        if unsafe { *scratch.add(k) } == 1 {
                            if k - prev > 1 { seg(prev + 1, k, prev, k); }
                            store(k, dx(k), dy(k));
                            prev = k;
                        }
                    }
                    if last != end - 1 { seg(last + 1, end, last, first); }
                }
                start = end;
            }
        }
        o += n as u32;
    }
    o
}

// ------------------------------------------------------------------------------------------------ axes, regions
/// fontTools normalizeValue + avar v1 piecewiseLinearMap + F2Dot14 quantization (otRound(v * 16384)).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn normalize(
    naxes: usize, axes: *const f64, avar_counts: *const u32, avar_pairs: *const f64, user: *const f64, out: *mut i32,
) {
    let mut pairs = avar_pairs;
    for a in 0..naxes {
        let (lo, df, hi) = unsafe { (*axes.add(3 * a), *axes.add(3 * a + 1), *axes.add(3 * a + 2)) };
        let mut v = unsafe { *user.add(a) };
        v = v.min(hi).max(lo);
        let mut n = if v == df || lo == hi {
            0.0
        } else if (v < df && lo != df) || (v > df && hi == df) {
            (v - df) / (df - lo)
        } else {
            (v - df) / (hi - df)
        };
        let cnt = unsafe { *avar_counts.add(a) } as usize;
        if cnt > 0 {
            let key = |i: usize| unsafe { *pairs.add(2 * i) };
            let val = |i: usize| unsafe { *pairs.add(2 * i + 1) };
            let mut hit = None;
            for i in 0..cnt { if key(i) == n { hit = Some(val(i)); } }
            n = if let Some(h) = hit { h }
            else if n < key(0) { n + val(0) - key(0) }
            else if n > key(cnt - 1) { n + val(cnt - 1) - key(cnt - 1) }
            else {
                let mut i = 0;
                while key(i + 1) < n { i += 1; }
                let (a0, b0, va, vb) = (key(i), key(i + 1), val(i), val(i + 1));
                va + (vb - va) * (n - a0) / (b0 - a0)
            };
            pairs = unsafe { pairs.add(2 * cnt) };
        }
        unsafe { *out.add(a) = round_half_up_f64(n * 16384.0) };
    }
}

/// Region scalars (OpenType tent rules) at F2Dot14 normalized coordinates; regions are (lo, peak, hi) F2Dot14 per axis.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scalars(nreg: usize, naxes: usize, regions: *const i16, norm: *const i32, out64: *mut f64, out32: *mut f32) {
    for r in 0..nreg {
        let mut s = 1.0f64;
        for a in 0..naxes {
            let p = unsafe { regions.add(3 * (r * naxes + a)) };
            let (lo, pk, hi) = unsafe { (f64::from(*p) / 16384.0, f64::from(*p.add(1)) / 16384.0, f64::from(*p.add(2)) / 16384.0) };
            if pk == 0.0 || lo > pk || pk > hi || (lo < 0.0 && hi > 0.0) { continue; }
            let v = f64::from(unsafe { *norm.add(a) }) / 16384.0;
            if v == pk { continue; }
            if v <= lo || v >= hi { s = 0.0; break; }
            s *= if v < pk { (v - lo) / (pk - lo) } else { (hi - v) / (hi - pk) };
        }
        unsafe { *out64.add(r) = s; *out32.add(r) = s as f32 };
    }
}

// ------------------------------------------------------------------------------------------------ instancing
const MAXT: usize = 256;

#[inline(always)]
unsafe fn active(g: usize, tfirst: *const u32, t_region: *const u32, sc: *const f32, list: &mut [(u32, f32); MAXT]) -> usize {
    let (a, b) = unsafe { (*tfirst.add(g) as usize, *tfirst.add(g + 1) as usize) };
    let mut k = 0;
    for t in a..b {
        let s = unsafe { *sc.add(*t_region.add(t) as usize) };
        if s != 0.0 { list[k] = (t as u32, s); k += 1; }
    }
    k
}

/// points = round(base + sum(scalar * delta)) over glyphs [g0, g1); deltas are a dense pool (i16 = `pool` 0, or
/// f32 = 1) at doff[t]. f32 arithmetic, point-outer / tuple-inner, accumulation order as fontTools (sum, then base).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn instance_f32(
    g0: usize, g1: usize, nvar: *const u32, vbase: *const u32, tfirst: *const u32, t_region: *const u32,
    doff: *const u32, sc: *const f32, vx: *const i16, vy: *const i16, pool: u32, dx: *const u8, dy: *const u8,
    ox: *mut i16, oy: *mut i16,
) {
    let mut list = [(0u32, 0f32); MAXT];
    for g in g0..g1 {
        let n = unsafe { *nvar.add(g) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        let k = unsafe { active(g, tfirst, t_region, sc, &mut list) };
        for j in 0..n {
            let (mut ax, mut ay) = (0f32, 0f32);
            for &(t, s) in &list[..k] {
                let at = unsafe { *doff.add(t as usize) } as usize + j;
                let (ddx, ddy) = unsafe {
                    if pool == 0 { (f32::from(*(dx as *const i16).add(at)), f32::from(*(dy as *const i16).add(at))) }
                    else { (*(dx as *const f32).add(at), *(dy as *const f32).add(at)) }
                };
                ax += s * ddx; ay += s * ddy;
            }
            unsafe {
                *ox.add(b + j) = round_half_up_f32(f32::from(*vx.add(b + j)) + ax) as i16;
                *oy.add(b + j) = round_half_up_f32(f32::from(*vy.add(b + j)) + ay) as i16;
            }
        }
    }
}

/// Same in f64 (exactness reference); pool 0 = i16, 2 = f64.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn instance_f64(
    g0: usize, g1: usize, nvar: *const u32, vbase: *const u32, tfirst: *const u32, t_region: *const u32,
    doff: *const u32, sc: *const f64, vx: *const i16, vy: *const i16, pool: u32, dx: *const u8, dy: *const u8,
    ox: *mut i16, oy: *mut i16,
) {
    for g in g0..g1 {
        let n = unsafe { *nvar.add(g) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        let (ta, tb) = unsafe { (*tfirst.add(g) as usize, *tfirst.add(g + 1) as usize) };
        for j in 0..n {
            let (mut ax, mut ay) = (0f64, 0f64);
            for t in ta..tb {
                let s = unsafe { *sc.add(*t_region.add(t) as usize) };
                if s == 0.0 { continue; }
                let at = unsafe { *doff.add(t) } as usize + j;
                let (ddx, ddy) = unsafe {
                    if pool == 0 { (f64::from(*(dx as *const i16).add(at)), f64::from(*(dy as *const i16).add(at))) }
                    else { (*(dx as *const f64).add(at), *(dy as *const f64).add(at)) }
                };
                ax += s * ddx; ay += s * ddy;
            }
            unsafe {
                *ox.add(b + j) = round_half_up_f64(f64::from(*vx.add(b + j)) + ax) as i16;
                *oy.add(b + j) = round_half_up_f64(f64::from(*vy.add(b + j)) + ay) as i16;
            }
        }
    }
}

/// SIMD128 instancing, 8 points per step: i16x8 base and deltas widened to two f32x4, fused over active tuples,
/// floor(v + 0.5), saturating narrow back to i16x8. Tail points scalar. pool 0 = i16 deltas, 1 = f32 deltas.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn instance_simd(
    g0: usize, g1: usize, nvar: *const u32, vbase: *const u32, tfirst: *const u32, t_region: *const u32,
    doff: *const u32, sc: *const f32, vx: *const i16, vy: *const i16, pool: u32, dx: *const u8, dy: *const u8,
    ox: *mut i16, oy: *mut i16,
) {
    use core::arch::wasm32::*;
    #[inline(always)]
    unsafe fn widen(p: *const i16) -> (v128, v128) {
        let v = unsafe { v128_load(p as *const v128) };
        (f32x4_convert_i32x4(i32x4_extend_low_i16x8(v)), f32x4_convert_i32x4(i32x4_extend_high_i16x8(v)))
    }
    #[inline(always)]
    fn fin(base: (v128, v128), acc: (v128, v128)) -> v128 {
        let h = f32x4_splat(0.5);
        let a = i32x4_trunc_sat_f32x4(f32x4_floor(f32x4_add(f32x4_add(base.0, acc.0), h)));
        let b = i32x4_trunc_sat_f32x4(f32x4_floor(f32x4_add(f32x4_add(base.1, acc.1), h)));
        i16x8_narrow_i32x4(a, b)
    }
    let mut list = [(0u32, 0f32); MAXT];
    for g in g0..g1 {
        let n = unsafe { *nvar.add(g) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        let k = unsafe { active(g, tfirst, t_region, sc, &mut list) };
        let mut j = 0usize;
        while j + 8 <= n {
            let z = f32x4_splat(0.0);
            let (mut ax0, mut ax1, mut ay0, mut ay1) = (z, z, z, z);
            for &(t, s) in &list[..k] {
                let at = unsafe { *doff.add(t as usize) } as usize + j;
                let sv = f32x4_splat(s);
                let (x0, x1, y0, y1) = unsafe {
                    if pool == 0 {
                        let (a, b) = widen((dx as *const i16).add(at));
                        let (c, d) = widen((dy as *const i16).add(at));
                        (a, b, c, d)
                    } else {
                        let px = (dx as *const f32).add(at);
                        let py = (dy as *const f32).add(at);
                        (v128_load(px as *const v128), v128_load(px.add(4) as *const v128),
                         v128_load(py as *const v128), v128_load(py.add(4) as *const v128))
                    }
                };
                ax0 = f32x4_add(ax0, f32x4_mul(sv, x0)); ax1 = f32x4_add(ax1, f32x4_mul(sv, x1));
                ay0 = f32x4_add(ay0, f32x4_mul(sv, y0)); ay1 = f32x4_add(ay1, f32x4_mul(sv, y1));
            }
            unsafe {
                v128_store(ox.add(b + j) as *mut v128, fin(widen(vx.add(b + j)), (ax0, ax1)));
                v128_store(oy.add(b + j) as *mut v128, fin(widen(vy.add(b + j)), (ay0, ay1)));
            }
            j += 8;
        }
        while j < n {
            let (mut ax, mut ay) = (0f32, 0f32);
            for &(t, s) in &list[..k] {
                let at = unsafe { *doff.add(t as usize) } as usize + j;
                let (ddx, ddy) = unsafe {
                    if pool == 0 { (f32::from(*(dx as *const i16).add(at)), f32::from(*(dy as *const i16).add(at))) }
                    else { (*(dx as *const f32).add(at), *(dy as *const f32).add(at)) }
                };
                ax += s * ddx; ay += s * ddy;
            }
            unsafe {
                *ox.add(b + j) = round_half_up_f32(f32::from(*vx.add(b + j)) + ax) as i16;
                *oy.add(b + j) = round_half_up_f32(f32::from(*vy.add(b + j)) + ay) as i16;
            }
            j += 1;
        }
    }
}

// ------------------------------------------------------------------------------------------------ composites, bounds
/// Decompose one instance: simple glyphs copy their instanced points, composites copy each component glyph's
/// instanced points plus the instanced (rounded) offset. One level (the fixtures have no nested composites).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn expand(
    g0: usize, g1: usize, kind: *const u8, nvar: *const u32, vbase: *const u32, cfirst_comp: *const u32,
    comp_gid: *const u32, ix: *const i16, iy: *const i16, dbase: *const u32, dx: *mut i16, dy: *mut i16,
) {
    for g in g0..g1 {
        let n = unsafe { *nvar.add(g) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        let mut w = unsafe { *dbase.add(g) } as usize;
        if unsafe { *kind.add(g) } == 2 {
            let cf = unsafe { *cfirst_comp.add(g) } as usize;
            for c in 0..n {
                let src = unsafe { *comp_gid.add(cf + c) } as usize;
                let (ofx, ofy) = unsafe { (*ix.add(b + c), *iy.add(b + c)) };
                let sb = unsafe { *vbase.add(src) } as usize;
                let sn = unsafe { *nvar.add(src) } as usize;
                for j in 0..sn {
                    unsafe {
                        *dx.add(w) = (*ix.add(sb + j)).wrapping_add(ofx);
                        *dy.add(w) = (*iy.add(sb + j)).wrapping_add(ofy);
                    }
                    w += 1;
                }
            }
        } else {
            for j in 0..n { unsafe { *dx.add(w) = *ix.add(b + j); *dy.add(w) = *iy.add(b + j); } w += 1; }
        }
    }
}

/// Control-box ink bounds per glyph from decomposed instanced points: xmin, ymin, xmax, ymax (i16).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bounds(g0: usize, g1: usize, dbase: *const u32, dx: *const i16, dy: *const i16, out: *mut i16) {
    for g in g0..g1 {
        let (a, b) = unsafe { (*dbase.add(g) as usize, *dbase.add(g + 1) as usize) };
        let (mut x0, mut y0, mut x1, mut y1) = (i16::MAX, i16::MAX, i16::MIN, i16::MIN);
        for k in a..b {
            let (x, y) = unsafe { (*dx.add(k), *dy.add(k)) };
            x0 = x0.min(x); x1 = x1.max(x); y0 = y0.min(y); y1 = y1.max(y);
        }
        if a == b { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
        unsafe { *out.add(4 * g) = x0; *out.add(4 * g + 1) = y0; *out.add(4 * g + 2) = x1; *out.add(4 * g + 3) = y1; }
    }
}

#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bounds_simd(g0: usize, g1: usize, dbase: *const u32, dx: *const i16, dy: *const i16, out: *mut i16) {
    use core::arch::wasm32::*;
    for g in g0..g1 {
        let (a, b) = unsafe { (*dbase.add(g) as usize, *dbase.add(g + 1) as usize) };
        let mut mn = i16x8_splat(i16::MAX);
        let mut mx = i16x8_splat(i16::MIN);
        let mut k = a;
        while k + 8 <= b {
            let x = unsafe { v128_load(dx.add(k) as *const v128) };
            let y = unsafe { v128_load(dy.add(k) as *const v128) };
            // lanes 0..3 track x, 4..7 track y after a horizontal fold
            let lo = i8x16_shuffle::<0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23>(x, y);
            let hi = i8x16_shuffle::<8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31>(x, y);
            mn = i16x8_min(mn, i16x8_min(lo, hi));
            mx = i16x8_max(mx, i16x8_max(lo, hi));
            k += 8;
        }
        let mut r = [0i16; 8];
        let mut s = [0i16; 8];
        unsafe { v128_store(r.as_mut_ptr() as *mut v128, mn); v128_store(s.as_mut_ptr() as *mut v128, mx) };
        let (mut x0, mut y0) = (r[0].min(r[1]).min(r[2]).min(r[3]), r[4].min(r[5]).min(r[6]).min(r[7]));
        let (mut x1, mut y1) = (s[0].max(s[1]).max(s[2]).max(s[3]), s[4].max(s[5]).max(s[6]).max(s[7]));
        while k < b {
            let (x, y) = unsafe { (*dx.add(k), *dy.add(k)) };
            x0 = x0.min(x); x1 = x1.max(x); y0 = y0.min(y); y1 = y1.max(y);
            k += 1;
        }
        if a == b { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
        unsafe { *out.add(4 * g) = x0; *out.add(4 * g + 1) = y0; *out.add(4 * g + 2) = x1; *out.add(4 * g + 3) = y1; }
    }
}

// ------------------------------------------------------------------------------------------------ triplets, SIMD v2
/// Variant of `trip_decode_simd` whose per-point byte window is built in registers: the 16-lane exclusive length
/// prefix is spread to 4 bytes per point, rebased to the group of 4, plus (0, 1, 2, 3), and used as an
/// i8x16_swizzle mask over one unaligned 16-byte load per group (no scalar gathers). `global` = 1 replaces the
/// per-segment prefix sum with one stream-wide i16 prefix sum followed by a per-segment rebase.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn trip_decode_simd2(
    mode: u32, fl: *const u8, data: *const u8, seg: *const u32, nseg: usize, x: *mut i16, y: *mut i16, tags: *mut u8,
    global: u32,
) -> usize {
    use core::arch::wasm32::*;
    let mut total = 0usize;
    for s in 0..nseg {
        total += unsafe { *seg.add(s) } as usize;
    }
    let mut d = data;
    let mut i = 0usize;
    let z8 = i8x16_splat(0);
    let iota = i8x16(0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3);
    macro_rules! group {
        ($excl:expr, $a:literal, $b:literal, $c:literal, $e:literal) => {{
            let spread = i8x16_shuffle::<$a, $a, $a, $a, $b, $b, $b, $b, $c, $c, $c, $c, $e, $e, $e, $e>($excl, $excl);
            let base = i8x16_shuffle::<$a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a, $a>($excl, $excl);
            let mask = i8x16_add(i8x16_sub(spread, base), iota);
            let o = u8x16_extract_lane::<$a>($excl) as usize;
            i8x16_swizzle(unsafe { v128_load(d.add(o) as *const v128) }, mask)
        }};
    }
    while i + 16 <= total {
        let f = unsafe { v128_load(fl.add(i) as *const v128) };
        let cls = v128_and(f, u8x16_splat(0x7f));
        let mut len = i8x16_sub(
            i8x16_sub(i8x16_sub(i8x16_splat(1), u8x16_ge(cls, u8x16_splat(84))), u8x16_ge(cls, u8x16_splat(120))),
            u8x16_ge(cls, u8x16_splat(124)),
        );
        let zm = if mode == 1 { i8x16_eq(f, u8x16_splat(0x80)) } else { z8 };
        len = v128_andnot(len, zm);
        let mut p = len;
        p = i8x16_add(p, i8x16_shuffle::<16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 16, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11>(p, z8));
        p = i8x16_add(p, i8x16_shuffle::<16, 16, 16, 16, 16, 16, 16, 16, 0, 1, 2, 3, 4, 5, 6, 7>(p, z8));
        let excl = i8x16_sub(p, len);
        let tot = u8x16_extract_lane::<15>(p) as usize;
        if mode == 0 {
            unsafe { v128_store(tags.add(i) as *mut v128, u8x16_shr(f, 7)) };
        }
        let w = [group!(excl, 0, 1, 2, 3), group!(excl, 4, 5, 6, 7), group!(excl, 8, 9, 10, 11), group!(excl, 12, 13, 14, 15)];
        let c16 = [u16x8_extend_low_u8x16(cls), u16x8_extend_high_u8x16(cls)];
        let z16 = [i16x8_extend_low_i8x16(zm), i16x8_extend_high_i8x16(zm)];
        for h in 0..2 {
            let (a0, b0) = unsafe { simd::decode4(u32x4_extend_low_u16x8(c16[h]), w[2 * h], i32x4_extend_low_i16x8(z16[h])) };
            let (a1, b1) = unsafe { simd::decode4(u32x4_extend_high_u16x8(c16[h]), w[2 * h + 1], i32x4_extend_high_i16x8(z16[h])) };
            unsafe {
                v128_store(x.add(i + h * 8) as *mut v128, simd::narrow(a0, a1));
                v128_store(y.add(i + h * 8) as *mut v128, simd::narrow(b0, b1));
            }
        }
        d = unsafe { d.add(tot) };
        i += 16;
    }
    while i < total {
        let f0 = unsafe { *fl.add(i) };
        let (dx, dy) = if mode == 1 && f0 == 0x80 { (0, 0) } else { unsafe { trip_one(i32::from(f0 & 127), &mut d) } };
        unsafe {
            *x.add(i) = dx as i16; *y.add(i) = dy as i16;
            if mode == 0 { *tags.add(i) = f0 >> 7; }
        }
        i += 1;
    }
    if global == 0 {
        let mut s0 = 0usize;
        for s in 0..nseg {
            let n = unsafe { *seg.add(s) } as usize;
            unsafe { simd::prefix_i16(x.add(s0), n); simd::prefix_i16(y.add(s0), n) };
            s0 += n;
        }
    } else {
        unsafe { simd::prefix_i16(x, total); simd::prefix_i16(y, total) };
        // rebase: subtract the running value at the end of the previous segment, walking backwards so the base
        // values read are still the global prefix
        let mut ends = total;
        let mut s = nseg;
        while s > 0 {
            s -= 1;
            let n = unsafe { *seg.add(s) } as usize;
            let start = ends - n;
            if start > 0 && n > 0 {
                let (bx, by) = unsafe { (*x.add(start - 1), *y.add(start - 1)) };
                let (vx, vy) = (i16x8_splat(bx), i16x8_splat(by));
                let mut k = start;
                while k + 8 <= ends {
                    unsafe {
                        let px = x.add(k) as *mut v128; v128_store(px, i16x8_sub(v128_load(px), vx));
                        let py = y.add(k) as *mut v128; v128_store(py, i16x8_sub(v128_load(py), vy));
                    }
                    k += 8;
                }
                while k < ends { unsafe { *x.add(k) = (*x.add(k)).wrapping_sub(bx); *y.add(k) = (*y.add(k)).wrapping_sub(by); } k += 1; }
            }
            ends = start;
        }
    }
    unsafe { d.offset_from(data) as usize }
}

/// SIMD128 instancing in f64x2 (2 points per lane group, 8 points per step), same accumulation order as
/// `instance_f64`, for bit-exact agreement with fontTools. pool 0 = i16 deltas, 2 = f64 deltas.
#[cfg(target_feature = "simd128")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn instance_simd64(
    g0: usize, g1: usize, nvar: *const u32, vbase: *const u32, tfirst: *const u32, t_region: *const u32,
    doff: *const u32, sc: *const f64, vx: *const i16, vy: *const i16, pool: u32, dx: *const u8, dy: *const u8,
    ox: *mut i16, oy: *mut i16,
) {
    use core::arch::wasm32::*;
    #[inline(always)]
    unsafe fn load8(p: *const u8, at: usize, pool: u32) -> [v128; 4] {
        unsafe {
            if pool == 0 {
                let v = v128_load((p as *const i16).add(at) as *const v128);
                let lo = i32x4_extend_low_i16x8(v); let hi = i32x4_extend_high_i16x8(v);
                [f64x2_convert_low_i32x4(lo), f64x2_convert_low_i32x4(i32x4_shuffle::<2, 3, 0, 1>(lo, lo)),
                 f64x2_convert_low_i32x4(hi), f64x2_convert_low_i32x4(i32x4_shuffle::<2, 3, 0, 1>(hi, hi))]
            } else {
                let q = (p as *const f64).add(at);
                [v128_load(q as *const v128), v128_load(q.add(2) as *const v128), v128_load(q.add(4) as *const v128), v128_load(q.add(6) as *const v128)]
            }
        }
    }
    #[inline(always)]
    unsafe fn fin(base: [v128; 4], acc: [v128; 4]) -> v128 {
        let h = f64x2_splat(0.5);
        let r: [v128; 4] = core::array::from_fn(|k| i32x4_trunc_sat_f64x2_zero(f64x2_floor(f64x2_add(f64x2_add(base[k], acc[k]), h))));
        let a = i32x4_shuffle::<0, 1, 4, 5>(r[0], r[1]);
        let b = i32x4_shuffle::<0, 1, 4, 5>(r[2], r[3]);
        i16x8_narrow_i32x4(a, b)
    }
    let mut list = [(0u32, 0f64); MAXT];
    for g in g0..g1 {
        let n = unsafe { *nvar.add(g) } as usize;
        let b = unsafe { *vbase.add(g) } as usize;
        let (ta, tb) = unsafe { (*tfirst.add(g) as usize, *tfirst.add(g + 1) as usize) };
        let mut k = 0;
        for t in ta..tb { let s = unsafe { *sc.add(*t_region.add(t) as usize) }; if s != 0.0 { list[k] = (t as u32, s); k += 1; } }
        let mut j = 0usize;
        while j + 8 <= n {
            let z = f64x2_splat(0.0);
            let (mut ax, mut ay) = ([z; 4], [z; 4]);
            for &(t, s) in &list[..k] {
                let at = unsafe { *doff.add(t as usize) } as usize + j;
                let sv = f64x2_splat(s);
                let (x, y) = unsafe { (load8(dx, at, pool), load8(dy, at, pool)) };
                for q in 0..4 { ax[q] = f64x2_add(ax[q], f64x2_mul(sv, x[q])); ay[q] = f64x2_add(ay[q], f64x2_mul(sv, y[q])); }
            }
            unsafe {
                v128_store(ox.add(b + j) as *mut v128, fin(load8(vx as *const u8, b + j, 0), ax));
                v128_store(oy.add(b + j) as *mut v128, fin(load8(vy as *const u8, b + j, 0), ay));
            }
            j += 8;
        }
        while j < n {
            let (mut ax, mut ay) = (0f64, 0f64);
            for &(t, s) in &list[..k] {
                let at = unsafe { *doff.add(t as usize) } as usize + j;
                let (ddx, ddy) = unsafe {
                    if pool == 0 { (f64::from(*(dx as *const i16).add(at)), f64::from(*(dy as *const i16).add(at))) }
                    else { (*(dx as *const f64).add(at), *(dy as *const f64).add(at)) }
                };
                ax += s * ddx; ay += s * ddy;
            }
            unsafe {
                *ox.add(b + j) = round_half_up_f64(f64::from(*vx.add(b + j)) + ax) as i16;
                *oy.add(b + j) = round_half_up_f64(f64::from(*vy.add(b + j)) + ay) as i16;
            }
            j += 1;
        }
    }
}
