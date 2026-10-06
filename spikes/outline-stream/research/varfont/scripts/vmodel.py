"""Variable-font model on top of the outline-encoding study's canonical point model.

load_tt(path, set) -> dict with
  names, models          base (default-instance) outlines in model.py 'tt-keep' form: glyf point order, composites kept
  axes                   [(tag, min, default, max)] from fvar
  avar                   {tag: [(from, to), ...]} or {}
  regions                [tuple over axes of (lo, peak, hi) as F2Dot14 ints]; shared table, index = region id
  tuples                 per glyph: list of (region_id, deltas) where deltas is a list over the glyph's points
                         (simple: glyf points; composite: one per component) of (dx, dy) ints or None (untouched),
                         phantom points removed
  phantom                per glyph: list of (region_id, 4 phantom deltas or None)
  ends                   per glyph: contour end indices (simple) / range(ncomp) (composite) for IUP
Everything is cached as pickle under varfont/cache.
"""
import os, sys, io, pickle, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'outline-encoding', 'scripts'))
import model as M  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.misc.fixedTools import otRound  # noqa: E402

CACHE = os.path.join(HERE, '..', 'cache')
LATIN = M.LATIN
FONTS = os.path.join(HERE, '..', 'fonts')


def f2(v):
    return otRound(v * 16384)


def _cache(key, fn):
    os.makedirs(CACHE, exist_ok=True)
    cp = os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest()[:16] + '.pkl')
    if os.path.exists(cp):
        with open(cp, 'rb') as f:
            return pickle.load(f)
    out = fn()
    with open(cp, 'wb') as f:
        pickle.dump(out, f)
    return out


def open_set(path, which):
    """Subset (Latin) or full font, re-loaded from bytes so every table is the compiled form."""
    font = M.open_font(path, LATIN if which == 'latin' else None)
    bio = io.BytesIO(); font.save(bio); bio.seek(0)
    return TTFont(bio)


def axes_avar(font):
    axes = [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes]
    avar = {}
    if 'avar' in font:
        for tag, seg in font['avar'].segments.items():
            if seg and set(seg.items()) != {(-1.0, -1.0), (0.0, 0.0), (1.0, 1.0)}:
                avar[tag] = sorted(seg.items())
    return axes, avar


def _extract_tt(path, which):
    font = open_set(path, which)
    names, models, _ = M.extract(font, 'tt-keep')
    axes, avar = axes_avar(font)
    tags = [a[0] for a in axes]
    glyf = font['glyf']; gvar = font['gvar']
    hm = font['hmtx'].metrics; vm = getattr(font.get('vmtx'), 'metrics', None)
    regions = {}; tuples = []; phantom = []; ends = []; same_region_twice = 0
    for name, m in zip(names, models):
        coords, ctrl = glyf._getCoordinatesAndControls(name, hm, vm)
        n = len(coords) - 4
        if m[0] == 'composite':
            ends.append(list(range(n)))
        elif m[0] == 'simple':
            ends.append(list(ctrl.endPts))
        else:
            ends.append([])
        gt = []; gp = []; seen = set()
        for tv in gvar.variations.get(name, []):
            key = []
            for t in tags:
                lo, pk, hi = tv.axes.get(t, (0.0, 0.0, 0.0))
                key.append((0, 0, 0) if pk == 0 else (f2(lo), f2(pk), f2(hi)))
            key = tuple(key)
            r = regions.setdefault(key, len(regions))
            if r in seen: same_region_twice += 1
            seen.add(r)
            c = list(tv.coordinates)
            assert len(c) == n + 4, (name, len(c), n)
            gt.append((r, [None if d is None else (int(d[0]), int(d[1])) for d in c[:n]]))
            gp.append((r, c[n:]))
        tuples.append(gt); phantom.append(gp)
    reg = [None] * len(regions)
    for k, v in regions.items(): reg[v] = k
    return dict(names=names, models=models, axes=axes, avar=avar, regions=reg, tuples=tuples, phantom=phantom,
                ends=ends, upm=font['head'].unitsPerEm, same_region_twice=same_region_twice)


def load_tt(path, which):
    return _cache(f'tt|{os.path.abspath(path)}|{which}|v3', lambda: _extract_tt(path, which))


def base_coords(m, models=None):
    """Default-instance coordinates for IUP: simple glyph points, or composite component offsets."""
    if m[0] == 'simple':
        return [(x, y) for c in m[1] for x, y, _ in c]
    if m[0] == 'composite':
        return [(dx, dy) for _, dx, dy, _ in m[1]]
    return []


def dense(data, g, tup, rounding=True):
    """IUP-expanded deltas of one tuple, rounded to integers (bake-time dense variant) or float."""
    from fontTools.varLib.iup import iup_contour
    m = data['models'][g]
    d = tup[1]
    if None in d:
        coords = base_coords(m)
        if m[0] == 'composite':
            d = [(0, 0) if v is None else v for v in d]
        else:
            out = []; st = 0
            for e in data['ends'][g]:
                out += list(iup_contour(d[st:e + 1], coords[st:e + 1])); st = e + 1
            d = out
    if rounding:
        return [(otRound(a), otRound(b)) for a, b in d]
    return [(float(a), float(b)) for a, b in d]


def user_to_norm(data, loc):
    """fontTools instancer normalization: normalizeValue, avar v1 map, then F2Dot14 quantization."""
    from fontTools.varLib.models import normalizeValue, piecewiseLinearMap
    out = []
    for tag, mn, df, mx in data['axes']:
        v = normalizeValue(loc.get(tag, df), (mn, df, mx))
        if tag in data['avar']:
            v = piecewiseLinearMap(v, dict(data['avar'][tag]))
        out.append(otRound(v * 16384) / 16384)
    return out


def region_scalar(region, norm):
    s = 1.0
    for (lo, pk, hi), v in zip(region, norm):
        if pk == 0: continue
        lo, pk, hi = lo / 16384, pk / 16384, hi / 16384
        if lo > pk or pk > hi or (lo < 0 < hi): continue
        if v == pk: continue
        if v <= lo or v >= hi: return 0.0
        s *= (v - lo) / (pk - lo) if v < pk else (hi - v) / (hi - pk)
    return s


def reference_instance(path, which, loc):
    """fontTools instancer full instance, compiled and re-read. Returns per glyph:
       simple -> list of (x, y) ints; composite -> list of (dx, dy) component offsets; plus decomposed points."""
    def build():
        from fontTools.varLib import instancer
        font = open_set(path, which)
        inst = instancer.instantiateVariableFont(font, loc, inplace=False)
        bio = io.BytesIO(); inst.save(bio); bio.seek(0); inst = TTFont(bio)
        glyf = inst['glyf']; out = []; dec = []
        for name in inst.getGlyphOrder():
            g = glyf[name]
            if g.numberOfContours == 0: out.append([]); dec.append([]); continue
            if g.isComposite(): out.append([(c.x, c.y) for c in g.components])
            else: out.append([tuple(map(int, p)) for p in g.coordinates])
            coords, _, _ = g.getCoordinates(glyf)
            dec.append([(otRound(x), otRound(y)) for x, y in coords])
        bounds = [(glyf[n].xMin, glyf[n].yMin, glyf[n].xMax, glyf[n].yMax) if glyf[n].numberOfContours else None
                  for n in inst.getGlyphOrder()]
        return dict(own=out, decomposed=dec, bounds=bounds)
    key = f'ref|{os.path.abspath(path)}|{which}|{sorted(loc.items())}|v3'
    return _cache(key, build)


def reoptimized(data, tolerance=0.5):
    """Copy of data whose simple-glyph tuples are re-sparsified with fontTools' iup_contour_optimize on the
    rounded dense deltas (lossy: IUP reproduces each delta within `tolerance` units). Composites unchanged."""
    from fontTools.varLib.iup import iup_contour_optimize
    def build():
        out = []
        for g, lst in enumerate(data['tuples']):
            m = data['models'][g]; new = []
            for tup in lst:
                if m[0] != 'simple': new.append(tup); continue
                d = dense(data, g, tup); coords = base_coords(m); res = []; st = 0
                for e in data['ends'][g]:
                    res += list(iup_contour_optimize(d[st:e + 1], coords[st:e + 1], tolerance)); st = e + 1
                if all(v is None for v in res): continue  # no explicit point: the tuple contributes nothing
                new.append((tup[0], [None if v is None else (int(v[0]), int(v[1])) for v in res]))
            out.append(new)
        return out
    d2 = dict(data); d2['tuples'] = _cache(f"reopt|{data['names'][:3]}|{len(data['names'])}|{len(data['regions'])}|{tolerance}|v2", build)
    d2.pop('_dense', None)
    return d2
