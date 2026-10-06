"""Candidate outline encodings over the canonical model (see model.py).

Every encoder returns an ordered dict {plane_name: bytes}. The payload is the planes concatenated in order
(that is what one GLB bufferView would hold); sizes are measured on that concatenation, gzip -9 and brotli q11.
"""
import struct
from collections import OrderedDict
import numpy as np
import meshoptimizer as mo


# ---------------------------------------------------------------- flatten
class Flat:
    def __init__(self, models):
        hdr = []; cn = []; xs = []; ys = []; ts = []; comps = []; gpt = [0]; gct = [0]
        for m in models:
            if m[0] == 'empty':
                hdr.append(0)
            elif m[0] == 'composite':
                hdr.append(len(m[1]) * 2 + 1); comps.extend(m[1])
            else:
                hdr.append(len(m[1]) * 2)
                for c in m[1]:
                    cn.append(len(c))
                    for x, y, t in c:
                        xs.append(x); ys.append(y); ts.append(t)
            gpt.append(len(xs)); gct.append(len(cn))
        self.hdr = np.array(hdr, np.int64)
        self.cn = np.array(cn, np.int64)
        self.x = np.array(xs, np.int64); self.y = np.array(ys, np.int64); self.t = np.array(ts, np.int64)
        self.comps = comps
        self.gpt = np.array(gpt, np.int64); self.gct = np.array(gct, np.int64)
        n = len(xs)
        # glyph start mask and contour start mask per point
        self.gstart = np.zeros(n, bool); self.gstart[self.gpt[:-1][self.gpt[:-1] < n]] = True
        cs = np.concatenate([[0], np.cumsum(self.cn)[:-1]]).astype(np.int64)
        self.cstart = np.zeros(n, bool); self.cstart[cs[cs < n]] = True
        self.cubic = bool((self.t == 2).any())

    @property
    def points(self): return len(self.x)


# ---------------------------------------------------------------- primitives
def zig(v): return ((v << 1) ^ (v >> 63)).astype(np.uint64)


def varint(u):
    """LEB128 of an unsigned numpy array, vectorized."""
    u = np.asarray(u, np.uint64)
    if len(u) == 0: return b''
    nb = np.ones(len(u), np.int64)
    for k in range(1, 10): nb += (u >= (np.uint64(1) << np.uint64(7 * k)))
    out = np.zeros(int(nb.sum()), np.uint8)
    pos = np.concatenate([[0], np.cumsum(nb)[:-1]])
    for k in range(int(nb.max())):
        sel = nb > k
        byte = ((u[sel] >> np.uint64(7 * k)) & np.uint64(0x7f)).astype(np.uint8)
        byte |= np.where(nb[sel] > k + 1, 0x80, 0).astype(np.uint8)
        out[pos[sel] + k] = byte
    return out.tobytes()


def i16(a):
    a = np.asarray(a)
    assert a.min(initial=0) >= -32768 and a.max(initial=0) <= 32767, (a.min(), a.max())
    return a.astype('<i2').tobytes()


def shuffle(b, width):
    """Byte-plane transpose (Blosc 'shuffle'): all byte 0s, then all byte 1s, ..."""
    a = np.frombuffer(b, np.uint8).reshape(-1, width)
    return a.T.copy().tobytes()


def bits(vals, width):
    vals = np.asarray(vals, np.uint8)
    if width == 1: return np.packbits(vals, bitorder='little').tobytes()
    assert width == 2
    pad = (-len(vals)) % 4
    v = np.concatenate([vals, np.zeros(pad, np.uint8)]).reshape(-1, 4)
    return (v[:, 0] | v[:, 1] << 2 | v[:, 2] << 4 | v[:, 3] << 6).astype(np.uint8).tobytes()


def comps_bytes(comps):
    out = bytearray()
    for gid, dx, dy, tr in comps:
        out += varint([gid]) + varint(zig(np.array([dx, dy])))
        if tr is None: out.append(0)
        else:
            out.append(1); out += struct.pack('<4h', *[int(round(v * 16384)) for row in tr for v in row])
    return bytes(out)


# ---------------------------------------------------------------- predictors
def pred_prev(f, a):
    p = np.concatenate([[0], a[:-1]]); p[f.gstart] = 0; return a - p


def pred_lin(f, a):
    """Linear extrapolation 2*p[-1]-p[-2] inside a contour; previous point at contour starts."""
    prev = np.concatenate([[0], a[:-1]]); prev[f.gstart] = 0
    prev2 = np.concatenate([[0, 0], a[:-2]])
    p = 2 * prev - prev2
    first2 = f.cstart | np.concatenate([[True], f.cstart[:-1]])
    p[first2] = prev[first2]
    return a - p


def pred_smooth(f, a):
    """Reflect the previous off-curve point through an on-curve point (tangent continuity) when the
    point follows an on-curve point that follows an off-curve point; else previous point."""
    t = f.t
    prev = np.concatenate([[0], a[:-1]]); prev[f.gstart] = 0
    prev2 = np.concatenate([[0, 0], a[:-2]])
    tp = np.concatenate([[0], t[:-1]]); tp2 = np.concatenate([[0, 0], t[:-2]])
    use = (t != 0) & (tp == 0) & (tp2 != 0) & ~f.cstart & ~np.concatenate([[True], f.cstart[:-1]])
    p = np.where(use, 2 * prev - prev2, prev)
    return a - p


PRED = {'prev': pred_prev, 'lin': pred_lin, 'smooth': pred_smooth}


# ---------------------------------------------------------------- encodings: compact streams
def flags_plane(f, packed):
    if not packed: return f.t.astype(np.uint8).tobytes()
    return bits(f.t, 2 if f.cubic else 1)


def planes(f, coord='varint', pred='prev', flags_packed=True, xy='split'):
    dx = PRED[pred](f, f.x); dy = PRED[pred](f, f.y)
    o = OrderedDict()
    o['hdr'] = varint(f.hdr); o['cn'] = varint(f.cn); o['comp'] = comps_bytes(f.comps)
    o['flags'] = flags_plane(f, flags_packed)
    if xy == 'interleave':
        d = np.stack([dx, dy], 1).reshape(-1)
        if coord == 'varint': o['xy'] = varint(zig(d))
        elif coord == 'i16': o['xy'] = i16(d)
        elif coord == 'i16shuf': o['xy'] = shuffle(i16(d), 2)
        return o
    for name, d in (('x', dx), ('y', dy)):
        if coord == 'varint': o[name] = varint(zig(d))
        elif coord == 'i16': o[name] = i16(d)
        elif coord == 'i16shuf': o[name] = shuffle(i16(d), 2)
        elif coord == 'i16zshuf': o[name] = shuffle(zig(d).astype('<u2').tobytes(), 2)
        elif coord == 'i8esc':
            small = (d >= -127) & (d <= 127)
            o[name] = np.where(small, d, -128).astype(np.int8).tobytes()
            o[name + 'esc'] = i16(d[~small])
    return o


def glyph_major(f, pred='prev'):
    """glyf-like: per glyph [hdr][contour counts][flags][x deltas][y deltas], fixed-width i16 deltas."""
    dx = PRED[pred](f, f.x); dy = PRED[pred](f, f.y)
    out = bytearray(); ci = 0
    comps = iter(f.comps)
    for g in range(len(f.hdr)):
        h = int(f.hdr[g]); out += varint([h])
        if h & 1:
            for _ in range(h >> 1): out += comps_bytes([next(comps)])
            continue
        a, b = f.gpt[g], f.gpt[g + 1]; c0, c1 = f.gct[g], f.gct[g + 1]
        out += varint(f.cn[c0:c1])
        out += f.t[a:b].astype(np.uint8).tobytes() + i16(dx[a:b]) + i16(dy[a:b])
    return OrderedDict(all=bytes(out))


def explicit_quads(f):
    """Expand every contour into Slug-style quadratic curves (p0, p1, p2); lines get the midpoint control,
    implied on-curve points become explicit. Coordinates in half units (x2) so midpoints stay exact.
    Returns (curves int64 array [n,6], curve-count per contour, is_line per curve). Cubics are not handled."""
    assert not f.cubic
    curves = []; per = []; lines = []
    off = 0
    for n in f.cn:
        pts = [(int(f.x[off + i]) * 2, int(f.y[off + i]) * 2, int(f.t[off + i])) for i in range(n)]
        off += n
        # rotate to start on an on-curve point (or synthesize one)
        k = next((i for i, p in enumerate(pts) if p[2] == 0), None)
        if k is None:
            a, b = pts[-1], pts[0]; pts = [((a[0] + b[0]) // 2, (a[1] + b[1]) // 2, 0)] + pts
        else:
            pts = pts[k:] + pts[:k]
        # insert implied on-points
        full = []
        for i, p in enumerate(pts):
            q = pts[i - 1]
            if p[2] == 1 and q[2] == 1: full.append(((p[0] + q[0]) // 2, (p[1] + q[1]) // 2, 0))
            full.append(p)
        if full[-1][2] == 1 and full[0][2] == 1: pass
        full.append(full[0])
        cnt = 0; i = 0
        while i < len(full) - 1:
            p0 = full[i]
            if full[i + 1][2] == 1:
                p1, p2 = full[i + 1], full[i + 2]; i += 2; lines.append(False)
            else:
                p2 = full[i + 1]; p1 = ((p0[0] + p2[0]) // 2, (p0[1] + p2[1]) // 2); i += 1; lines.append(True)
            curves.append((p0[0], p0[1], p1[0], p1[1], p2[0], p2[1])); cnt += 1
        per.append(cnt)
    return np.array(curves, np.int64).reshape(-1, 6), np.array(per, np.int64), np.array(lines, bool)


def explicit_stream(f, q):
    """The #244 prototype shape: explicit 2n+1 points per contour, zigzag deltas, line flags. Units rounded."""
    curves, per, lines = q
    # point sequence per contour: p0, (p1, p2)*  in integer units (rounded half units)
    o = OrderedDict(); seqx = []; seqy = []
    ci = 0
    for n in per:
        c = curves[ci:ci + n]; ci += n
        seqx.append(c[0, 0]); seqy.append(c[0, 1])
        seqx.extend(c[:, [2, 4]].reshape(-1)); seqy.extend(c[:, [3, 5]].reshape(-1))
    sx = np.round(np.array(seqx) / 2).astype(np.int64); sy = np.round(np.array(seqy) / 2).astype(np.int64)
    dx = np.diff(np.concatenate([[0], sx])); dy = np.diff(np.concatenate([[0], sy]))
    o['hdr'] = varint(f.hdr); o['cn'] = varint(per); o['comp'] = comps_bytes(f.comps)
    o['lines'] = bits(lines.astype(np.uint8), 1)
    o['xy'] = varint(zig(np.stack([dx, dy], 1).reshape(-1)))
    return o


# ---------------------------------------------------------------- encodings: GPU-direct (no CPU decode)
def gpu_offsets(f):
    """Per glyph u32 point base + u32 contour base: what a shader needs to find a glyph's data."""
    return np.stack([f.gpt[:-1], f.gct[:-1]], 1).astype('<u4').tobytes()


def gpu_points(f, layout='interleave', rel_bbox=False):
    x, y = f.x.copy(), f.y.copy()
    o = OrderedDict()
    o['offsets'] = gpu_offsets(f)
    o['cn'] = f.cn.astype('<u2').tobytes()
    o['comp'] = comps_bytes(f.comps)
    o['flags'] = flags_plane(f, True)
    if rel_bbox:
        # subtract per-glyph min (the per-glyph bounds are already in the glyph record)
        gid = np.repeat(np.arange(len(f.gpt) - 1), np.diff(f.gpt))
        mnx = np.minimum.reduceat(x, f.gpt[:-1][np.diff(f.gpt) > 0]) if len(x) else x
        nz = np.diff(f.gpt) > 0
        bx = np.zeros(len(f.gpt) - 1, np.int64); by = bx.copy()
        bx[nz] = mnx; by[nz] = np.minimum.reduceat(y, f.gpt[:-1][nz])
        x = x - bx[gid]; y = y - by[gid]
    if layout == 'interleave': o['xy'] = i16(np.stack([x, y], 1).reshape(-1))
    elif layout == 'planes': o['x'] = i16(x); o['y'] = i16(y)
    elif layout == 'shuffle': o['x'] = shuffle(i16(x), 2); o['y'] = shuffle(i16(y), 2)
    elif layout == 'xyshuffle': o['xy'] = shuffle(i16(np.stack([x, y], 1).reshape(-1)), 4)
    return o


def gpu_pointword(f):
    """One u32 per point: x i16 | y i16 with the on/off flag folded into bit 0 of x (coords x2 -> no).
    Here: x stored as (x<<1|offcurve) in 16 bits needs |x| < 16384."""
    o = OrderedDict(); o['offsets'] = gpu_offsets(f); o['cn'] = f.cn.astype('<u2').tobytes(); o['comp'] = comps_bytes(f.comps)
    xf = (f.x << 2) | f.t  # 2-bit tag (on/quad/cubic) in low bits
    o['xy'] = i16(np.stack([xf, f.y], 1).reshape(-1))
    return o


def slug_layout(f, q, fmt='i16', upm=1000):
    """Slug's curve texture layout: texel = (p0.x,p0.y,p1.x,p1.y) per curve + (p2.x,p2.y,0,0) per contour.
    i16: half font units (exact, lines as p1=p0? no: midpoint, as Slug), f16: em-normalized binary16."""
    curves, per, lines = q
    tex = []; ci = 0
    for n in per:
        c = curves[ci:ci + n]; ci += n
        tex.append(c[:, :4]); tex.append(np.array([[c[-1, 4], c[-1, 5], 0, 0]]))
    t = np.concatenate(tex) if tex else np.zeros((0, 4), np.int64)
    o = OrderedDict()
    if fmt == 'i16': o['tex'] = i16(t.reshape(-1))
    elif fmt == 'i16-p1eqp0':
        # lines written with p1 = p0 (exact straight segment, no bow): flag-free
        t2 = t.copy(); ci = 0; row = 0
        o['tex'] = None
        rows = []
        for n in per:
            c = curves[ci:ci + n].copy(); l = lines[ci:ci + n]; ci += n
            c[l, 2:4] = c[l, 0:2]
            rows.append(c[:, :4]); rows.append(np.array([[c[-1, 4], c[-1, 5], 0, 0]]))
        o['tex'] = i16(np.concatenate(rows).reshape(-1))
    elif fmt == 'f16':
        o['tex'] = (t.reshape(-1) / 2.0 / upm).astype('<f2').tobytes()
    return o


def meshopt(planes_dict, key, stride, version=0):
    mo.encode_vertex_version(version)
    o = OrderedDict()
    for k, v in planes_dict.items():
        if k in key:
            arr = np.frombuffer(v, np.uint8)
            pad = (-len(arr)) % stride
            arr = np.concatenate([arr, np.zeros(pad, np.uint8)]).reshape(-1, stride)
            o[k] = mo.encode_vertex_buffer(arr, len(arr), stride)
        else:
            o[k] = v
    mo.encode_vertex_version(0)
    return o


# ---------------------------------------------------------------- WOFF2-style triplets on this model
def triplets(f):
    """WOFF2 glyf triplet coding (one flag byte per point carries on/off plus the dx/dy size class; 1-4 data
    bytes follow), on this model's points (on/off only: CFF cubic offs come in pairs, so 1 bit suffices)."""
    dx = pred_prev(f, f.x); dy = pred_prev(f, f.y)
    fl = bytearray(); data = bytearray()
    for x, y, t in zip(dx.tolist(), dy.tolist(), f.t.tolist()):
        on = 0 if t == 0 else 128
        ax, ay = abs(x), abs(y); sx = x < 0; sy = y < 0
        if x == 0 and ay < 1280:
            fl.append(on | ((ay >> 8) << 1) | sy); data.append(ay & 255)
        elif y == 0 and ax < 1280:
            fl.append(on | (10 + (((ax >> 8) << 1) | sx))); data.append(ax & 255)
        elif 1 <= ax <= 64 and 1 <= ay <= 64:
            a, b = ax - 1, ay - 1
            fl.append(on | (20 + ((a >> 4) << 4) + ((b >> 4) << 2) + (sx << 1 | sy))); data.append(((a & 15) << 4) | (b & 15))
        elif 1 <= ax <= 768 and 1 <= ay <= 768:
            a, b = ax - 1, ay - 1
            fl.append(on | (84 + 12 * (a >> 8) + ((b >> 8) << 2) + (sx << 1 | sy))); data += bytes([a & 255, b & 255])
        elif ax < 4096 and ay < 4096:
            fl.append(on | (120 + (sx << 1 | sy))); data += bytes([ax >> 4, ((ax & 15) << 4) | (ay >> 8), ay & 255])
        else:
            fl.append(on | (124 + (sx << 1 | sy))); data += struct.pack('>HH', ax, ay)
    o = OrderedDict(); o['hdr'] = varint(f.hdr); o['cn'] = varint(f.cn); o['comp'] = comps_bytes(f.comps)
    o['flags'] = bytes(fl); o['data'] = bytes(data)
    return o


def planes_onoff(f):
    """varint xy-interleaved planes with a 1-bit on/off flag even for CFF (cubic offs come in pairs)."""
    o = planes(f, xy='interleave'); o['flags'] = bits((f.t != 0).astype(np.uint8), 1); return o


def dedup_contours(f):
    """Contour reuse (subroutine-like): a contour whose shape (all points relative to its first point, with
    tags) equals an earlier contour is replaced by a back-reference; only its start delta stays in the stream."""
    seen = {}; uniq = 0
    ref = []; keep = np.ones(f.points, bool)
    off = 0; dups = 0; dup_pts = 0
    xs, ys, ts = f.x, f.y, f.t
    for n in f.cn.tolist():
        key = (tuple((xs[off:off + n] - xs[off]).tolist()), tuple((ys[off:off + n] - ys[off]).tolist()), tuple(ts[off:off + n].tolist()))
        if key in seen:
            ref.append(uniq - seen[key]); keep[off + 1:off + n] = False; dups += 1; dup_pts += n - 1
        else:
            seen[key] = uniq; uniq += 1; ref.append(0)
        off += n
    dx = pred_prev(f, f.x); dy = pred_prev(f, f.y)
    # deltas of kept points: recompute from the previous *kept* point so a dropped run does not leave a gap
    kx, ky = f.x[keep], f.y[keep]
    gs = f.gstart[keep]
    px = np.concatenate([[0], kx[:-1]]); px[gs] = 0; py = np.concatenate([[0], ky[:-1]]); py[gs] = 0
    o = OrderedDict(); o['hdr'] = varint(f.hdr); o['cn'] = varint(f.cn); o['ref'] = varint(ref); o['comp'] = comps_bytes(f.comps)
    o['flags'] = bits((f.t[keep] != 0).astype(np.uint8), 1)
    o['xy'] = varint(zig(np.stack([kx - px, ky - py], 1).reshape(-1)))
    o['_stats'] = b''
    return o, dict(contours=int(len(f.cn)), dup_contours=dups, dup_points=dup_pts)
