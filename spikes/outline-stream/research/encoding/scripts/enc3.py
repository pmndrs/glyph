"""Third-round candidates over the canonical model (model.py / enc.Flat).

  bp16(f, per_glyph)     the maintainer's proposal from PR #235 comment 5914720202, as written:
                         per glyph point_count, contour ends, bbox; 1 flag bit per point in u64 words;
                         x and y SoA zigzag deltas bit-packed in blocks of 16 points with one width nibble
                         per block. First point of a glyph is a delta from the glyph's bbox min.
  svb(f)                 StreamVByte-style: 2-bit byte-length codes (0..2 bytes, 3 = escape unused) for every
                         zigzag delta in a control plane, data bytes in x and y planes, 1-bit flags.
  explicit_on(f)         TrueType points with every implied on-curve point made explicit (rounded to integer
                         units) but no line midpoint controls: the middle step between glyf and 2n+1.
  explicit_planes(f)     the 2n+1 layout (implied on-curves explicit, line midpoint controls) with split planes,
                         so the implied-point effect is isolated from the stream-separation effect.
  stencil(f)             GPU-resident stencil buffer: per contour rotated to start on an on-curve point, one wrap
                         point appended, i16 x,y per point with the off-curve tag in bit 0 of x. A curve is named
                         by one point index; the shader reads p[i-1], p[i], p[i+1].
All return OrderedDict planes like enc.py.
"""
from collections import OrderedDict
import numpy as np
import enc as E


def _zig(d):
    return ((d << 1) ^ (d >> 63)).astype(np.int64)


def _width(v):
    v = np.asarray(v, np.int64)
    w = np.zeros(v.shape, np.int64)
    nz = v > 0
    w[nz] = np.floor(np.log2(v[nz])).astype(np.int64) + 1
    return w


def _pack_blocks(z, widths):
    """z: (B,16) unsigned values, widths (B,) bits. Little-endian bitstream per block, 2*w bytes per block."""
    out = bytearray()
    for blk, w in zip(z.tolist(), widths.tolist()):
        if w == 0: continue
        acc = 0
        for k, v in enumerate(blk): acc |= v << (k * w)
        out += acc.to_bytes(2 * w, 'little')
    return bytes(out)


def _nibbles(w):
    w = np.asarray(w, np.int64)
    code = np.where(w >= 15, 15, w)  # 15 means 16 bits
    if len(code) % 2: code = np.concatenate([code, [0]])
    return (code[0::2] | (code[1::2] << 4)).astype(np.uint8).tobytes()


def glyph_bbox(f):
    G = len(f.gpt) - 1; bb = np.zeros((G, 4), np.int64)
    for g in range(G):
        a, b = f.gpt[g], f.gpt[g + 1]
        if b > a: bb[g] = (f.x[a:b].min(), f.y[a:b].min(), f.x[a:b].max(), f.y[a:b].max())
    return bb


def bp16(f, per_glyph=True):
    assert not f.comps, 'bp16 is defined over decomposed outlines'
    G = len(f.gpt) - 1
    npts = np.diff(f.gpt); ncont = np.diff(f.gct)
    bb = glyph_bbox(f)
    gid = np.repeat(np.arange(G), npts)
    # deltas: previous point inside a glyph, bbox min at the glyph's first point
    def deltas(a, base):
        p = np.concatenate([[0], a[:-1]])
        p[f.gstart] = base[gid[f.gstart]]
        return a - p
    dx = _zig(deltas(f.x, bb[:, 0])); dy = _zig(deltas(f.y, bb[:, 1]))
    o = OrderedDict()
    o['point_count'] = npts.astype('<u2').tobytes()
    o['contour_count'] = ncont.astype('<u2').tobytes()
    o['bbox'] = bb.astype('<i2').tobytes()
    # contour ends, glyph-relative last point index
    ends = []
    for g in range(G):
        c0, c1 = f.gct[g], f.gct[g + 1]
        ends.extend((np.cumsum(f.cn[c0:c1]) - 1).tolist())
    o['contour_ends'] = np.array(ends, np.int64).astype('<u2').tobytes()
    flags = (f.t != 0).astype(np.uint8)
    pad = (-len(flags)) % 64
    o['flags_u64'] = np.packbits(np.concatenate([flags, np.zeros(pad, np.uint8)]), bitorder='little').tobytes()
    for name, z in (('x', dx), ('y', dy)):
        if per_glyph:
            blocks = []
            for g in range(G):
                a, b = f.gpt[g], f.gpt[g + 1]
                if b == a: continue
                seg = z[a:b]; padn = (-len(seg)) % 16
                blocks.append(np.concatenate([seg, np.zeros(padn, np.int64)]).reshape(-1, 16))
            zb = np.concatenate(blocks) if blocks else np.zeros((0, 16), np.int64)
        else:
            padn = (-len(z)) % 16
            zb = np.concatenate([z, np.zeros(padn, np.int64)]).reshape(-1, 16)
        w = _width(zb.max(axis=1))
        w = np.where(w == 15, 16, w)
        o[name + '_width'] = _nibbles(w)
        o[name + '_bits'] = _pack_blocks(zb, w)
    return o


def svb(f, pred='prev'):
    dx = E.PRED[pred](f, f.x); dy = E.PRED[pred](f, f.y)
    zx = _zig(dx); zy = _zig(dy)
    o = OrderedDict()
    o['hdr'] = E.varint(f.hdr); o['cn'] = E.varint(f.cn); o['comp'] = E.comps_bytes(f.comps)
    o['flags'] = E.bits((f.t != 0).astype(np.uint8), 1)
    ctrl = []
    for name, z in (('x', zx), ('y', zy)):
        assert z.max(initial=0) < 65536
        ln = np.where(z == 0, 0, np.where(z < 256, 1, 2))
        ctrl.append(ln)
        lo = (z & 255).astype(np.uint8); hi = (z >> 8).astype(np.uint8)
        o[name + 'lo'] = lo[ln >= 1].tobytes(); o[name + 'hi'] = hi[ln == 2].tobytes()
    c = np.stack(ctrl, 1).reshape(-1)  # x,y alternate: 2 points per control byte
    o['ctrl'] = E.bits(c.astype(np.uint8), 2)
    return o


def _implied_on(f):
    """Per contour, the point list with implied on-curve midpoints inserted (rounded down to int units)."""
    out_x = []; out_y = []; out_t = []; per = []
    off = 0
    for n in f.cn.tolist():
        xs = f.x[off:off + n].tolist(); ys = f.y[off:off + n].tolist(); ts = f.t[off:off + n].tolist(); off += n
        cx = []; cy = []; ct = []
        for i in range(n):
            j = i - 1
            if ts[i] == 1 and ts[j] == 1:
                cx.append((xs[i] + xs[j]) // 2); cy.append((ys[i] + ys[j]) // 2); ct.append(0)
            cx.append(xs[i]); cy.append(ys[i]); ct.append(ts[i])
        out_x += cx; out_y += cy; out_t += ct; per.append(len(cx))
    return np.array(out_x, np.int64), np.array(out_y, np.int64), np.array(out_t, np.int64), np.array(per, np.int64)


class _View:
    """Minimal Flat look-alike over a rewritten point list (no composites)."""
    def __init__(self, f, x, y, t, cn):
        self.x, self.y, self.t, self.cn = x, y, t, cn
        self.comps = f.comps; self.cubic = f.cubic
        # glyph point bases: contours per glyph unchanged
        cs = np.concatenate([[0], np.cumsum(cn)])
        self.gpt = cs[f.gct]; self.gct = f.gct; self.hdr = f.hdr
        n = len(x)
        self.gstart = np.zeros(n, bool); self.gstart[self.gpt[:-1][self.gpt[:-1] < n]] = True
        self.cstart = np.zeros(n, bool); self.cstart[cs[:-1][cs[:-1] < n]] = True

    @property
    def points(self): return len(self.x)


def explicit_on(f):
    x, y, t, cn = _implied_on(f)
    v = _View(f, x, y, t, cn)
    return E.planes(v, xy='interleave'), v


def explicit_planes(f, q):
    """2n+1 explicit points per contour as split planes (x | y varint deltas, line bit plane)."""
    curves, per, lines = q
    seqx = []; seqy = []; ci = 0
    for n in per.tolist():
        c = curves[ci:ci + n]; ci += n
        seqx.append(c[0, 0]); seqy.append(c[0, 1])
        seqx.extend(c[:, [2, 4]].reshape(-1)); seqy.extend(c[:, [3, 5]].reshape(-1))
    sx = np.round(np.array(seqx) / 2).astype(np.int64); sy = np.round(np.array(seqy) / 2).astype(np.int64)
    o = OrderedDict()
    o['hdr'] = E.varint(f.hdr); o['cn'] = E.varint(per); o['comp'] = E.comps_bytes(f.comps)
    o['lines'] = E.bits(lines.astype(np.uint8), 1)
    o['x'] = E.varint(E.zig(np.diff(np.concatenate([[0], sx]))))
    o['y'] = E.varint(E.zig(np.diff(np.concatenate([[0], sy]))))
    return o


def stencil(f):
    """GPU stencil layout over decomposed outlines. Returns (planes, stats)."""
    assert not f.comps
    xs = []; ys = []; ts = []; curves = 0; lines = 0; pad = 0
    off = 0; cbase = [0]
    for ci, n in enumerate(f.cn.tolist()):
        cx = f.x[off:off + n].tolist(); cy = f.y[off:off + n].tolist(); ct = f.t[off:off + n].tolist(); off += n
        k = next((i for i, tt in enumerate(ct) if tt == 0), None)
        if k is None:  # all off-curve: synthesize an on-curve midpoint (rounded) to start on
            cx = [(cx[-1] + cx[0]) // 2] + cx; cy = [(cy[-1] + cy[0]) // 2] + cy; ct = [0] + ct; pad += 1
        else:
            cx = cx[k:] + cx[:k]; cy = cy[k:] + cy[:k]; ct = ct[k:] + ct[:k]
        cx.append(cx[0]); cy.append(cy[0]); ct.append(0); pad += 1
        for i in range(len(ct) - 1):
            if ct[i] != 0: curves += 1
            elif ct[i + 1] == 0: curves += 1; lines += 1
        xs += cx; ys += cy; ts += ct; cbase.append(len(xs))
    x = np.array(xs, np.int64); y = np.array(ys, np.int64); t = np.array(ts, np.int64)
    assert np.abs(x).max(initial=0) < 16384
    o = OrderedDict()
    o['glyph_base'] = np.array(cbase, np.int64)[f.gct].astype('<u4').tobytes()  # G+1 u32 point bases
    o['xy'] = E.i16(np.stack([(x << 1) | (t != 0), y], 1).reshape(-1))
    return o, dict(points=len(x), pad_points=pad, curves=curves, lines=lines)
