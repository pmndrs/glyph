"""Precision vs curve count for CFF cubic -> quadratic conversion.

Usage: cu2qu_error.py <font.otf> [max_cubics]
For every cubic segment (or a fixed-seed sample of max_cubics), measures the max distance from the true cubic to:
  cu2qu tol=T, float           fontTools curve_to_quadratic(max_err=T), unrounded
  cu2qu tol=T, int off-curves  same, with every off-curve point rounded to integer font units (implied on-curve
                               points stay exact midpoints of the rounded off-curves, as glyf stores them)
  slug 4-split, f32            slug-core cubic_to_quadratics_into(.., 4) (equal-parameter split + midpoint fit),
                               what #235's outlineAt() returns today
  slug 4-split, f16 em         the same, with every point rounded through binary16 in em units (Slug's texture)
Distance: 65 samples on the cubic, each to the nearest point of the quadratic chain flattened to 64 segments per
piece (point-to-segment). Also reports quadratics per cubic and fractional CFF coordinates.
"""
import sys, math
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.cu2qu import curve_to_quadratic

path = sys.argv[1]; cap = int(sys.argv[2]) if len(sys.argv) > 2 else 0
font = TTFont(path); upm = font['head'].unitsPerEm
gs = font.getGlyphSet()
cubics = []; frac = 0; total = 0
for name in font.getGlyphOrder():
    rec = RecordingPen(); gs[name].draw(rec); cur = None
    for op, args in rec.value:
        for p in args:
            if p is None: continue
            total += 2; frac += (p[0] != int(p[0])) + (p[1] != int(p[1]))
        if op == 'moveTo': cur = args[0]; start = cur
        elif op == 'lineTo': cur = args[0]
        elif op == 'curveTo': cubics.append((cur, *args)); cur = args[-1]
        elif op == 'qCurveTo': cur = args[-1]
rng = np.random.default_rng(1)
idx = np.arange(len(cubics))
if cap and len(cubics) > cap: idx = np.sort(rng.choice(len(cubics), cap, replace=False))
T = np.linspace(0, 1, 65)
U = np.linspace(0, 1, 65)


def cubic_pts(c, t):
    c = np.array(c, np.float64); m = 1 - t
    return (m**3)[:, None] * c[0] + (3 * m * m * t)[:, None] * c[1] + (3 * m * t * t)[:, None] * c[2] + (t**3)[:, None] * c[3]


def quad_chain(qs):
    out = []
    for p0, p1, p2 in qs:
        p0, p1, p2 = map(np.asarray, (p0, p1, p2)); m = 1 - U
        out.append((m * m)[:, None] * p0 + (2 * m * U)[:, None] * p1 + (U * U)[:, None] * p2)
    return np.concatenate(out)


def dist(samples, poly):
    a = poly[:-1]; b = poly[1:]; ab = b - a
    ap = samples[:, None, :] - a[None]
    den = (ab * ab).sum(-1); den[den == 0] = 1
    t = np.clip((ap * ab[None]).sum(-1) / den[None], 0, 1)
    d = ap - t[..., None] * ab[None]
    return np.sqrt((d * d).sum(-1)).min(1).max()


def spline_to_quads(p0, offs, p3):
    qs = []; start = p0
    for i, c in enumerate(offs):
        end = p3 if i == len(offs) - 1 else ((c[0] + offs[i + 1][0]) / 2, (c[1] + offs[i + 1][1]) / 2)
        qs.append((start, c, end)); start = end
    return qs


def slug_split(c, n=4, f16=False):
    c = [np.array(p, np.float32) / upm for p in c]
    qs = []; rest = c
    for i in range(n):
        rem = n - i
        if rem == 1: head = rest
        else:
            t = np.float32(1.0 / rem)
            lerp = (lambda a, b: (a + b) * np.float32(0.5)) if rem == 2 else (lambda a, b: a + (b - a) * t)
            m01 = lerp(rest[0], rest[1]); m12 = lerp(rest[1], rest[2]); m23 = lerp(rest[2], rest[3])
            m012 = lerp(m01, m12); m123 = lerp(m12, m23); mid = lerp(m012, m123)
            head = [rest[0], m01, m012, mid]; rest = [mid, m123, m23, rest[3]]
        p1 = (-head[0] + 3 * head[1] + 3 * head[2] - head[3]) * np.float32(0.25)
        qs.append((head[0], p1, head[3]))
    if f16: qs = [tuple(np.asarray(p, np.float32).astype(np.float16).astype(np.float64) for p in q) for q in qs]
    return [tuple(np.asarray(p, np.float64) * upm for p in q) for q in qs]


res = {}
for i in idx:
    c = cubics[i]; s = cubic_pts(c, T)
    for tol in (0.25, 0.5, 1.0, 2.0):
        sp = curve_to_quadratic(c, tol)
        offs = sp[1:-1]
        res.setdefault(f'cu2qu tol={tol}, float', []).append((dist(s, quad_chain(spline_to_quads(sp[0], offs, sp[-1]))), len(offs)))
        roffs = [(round(x), round(y)) for x, y in offs]
        res.setdefault(f'cu2qu tol={tol}, int off-curves', []).append((dist(s, quad_chain(spline_to_quads(sp[0], roffs, sp[-1]))), len(offs)))
        hoffs = [(round(2 * x) / 2, round(2 * y) / 2) for x, y in offs]
        res.setdefault(f'cu2qu tol={tol}, half-unit off-curves', []).append((dist(s, quad_chain(spline_to_quads(sp[0], hoffs, sp[-1]))), len(offs)))
    res.setdefault('slug 4-split, f32 (#235 runtime)', []).append((dist(s, quad_chain(slug_split(c))), 4))
    res.setdefault('slug 4-split, f16 em (Slug texture)', []).append((dist(s, quad_chain(slug_split(c, 4, True))), 4))
print(f'{path.split("/")[-1]} upm={upm} cubics={len(cubics)} measured={len(idx)} fractional coords={frac}/{total}')
print(f'{"method":38s} {"quads/cubic":>11s} {"max err":>8s} {"p99":>7s} {"mean":>7s}  (font units)')
for k, v in res.items():
    e = np.array([a for a, _ in v]); n = np.array([b for _, b in v])
    print(f'{k:38s} {n.mean():11.3f} {e.max():8.3f} {np.percentile(e, 99):7.3f} {e.mean():7.3f}')
