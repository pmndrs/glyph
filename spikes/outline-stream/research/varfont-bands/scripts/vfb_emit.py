"""Inputs for the variable-font band study: one binary per font and glyph set, read by bandlab (native and Wasm).

Usage:
  vfb_emit.py <key> <font> <latin|full>                  TrueType (gvar), through the previous study's vmodel cache
  vfb_emit.py <key> <font> <set> --model <cff2 pkl>      CFF2 converted by varfont/scripts/cff2.py --save (basis B)
Environment: VF_CACHE (previous study's cache dir), VFB_OUT (output dir).

Writes <VFB_OUT>/data/<key>-<set>.vfb and .json. Layout (little endian):
  'VFB1', u32 G, R, upm, A, L, P, S
  locations   L x (u8 kind, pad3, R f32 region scalars, A f32 normalized coordinates)
              kind: 0 default, 1 fvar named instance, 2 region peak, 3 random over all axes, 4 random wght only,
                    5 random wght+wdth, 6 random opsz+wght (Serif/Inter "all" is these two axes)
  specs       P x (u8 kind, pad3, R x (f32 smin, f32 smax)): region-scalar intervals a band set is conservative over.
              kind: 0 all axes, 1 wght only, 2 wght+wdth, 3 one wght cell between adjacent named-instance weights
  simple      S x (u32 n, u32 nc, u16 contour lengths[nc], u8 tags[n] (0 on, 1 off), i16 base xy[2n],
                   u32 T, T x (u16 region, f32 dense IUP-expanded deltas xy[2n]))
  glyphs      G x (u32 parts, parts x (u32 simple id, i16 ox, i16 oy, u32 T, T x (u16 region, f32 dx, f32 dy)))
  subsets     u32 count, per subset (u32 n, u32 glyph ids[n]); subset 0 = distinct glyphs of a ~200-character text,
              subset 1 = 200 distinct glyphs (text order, then cmap order)
Region scalar intervals over a box of normalized axis intervals: the product of per-axis tent ranges, each the
min/max of the piecewise-linear tent over its breakpoints inside the interval (all factors are >= 0).
"""
import sys, os, json, struct, argparse, pickle
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(RESEARCH, 'encoding', 'scripts'))
sys.path.insert(0, os.path.join(RESEARCH, 'varfont', 'scripts'))
import vmodel as V  # noqa: E402

SCRATCH = '/tmp/claude-0/-home-user-glyph/562408c2-1c90-5477-a581-3dc9cf79024e/scratchpad'
V.CACHE = os.environ.get('VF_CACHE', os.path.join(SCRATCH, 'varfont', 'cache'))
OUT = os.path.join(os.environ.get('VFB_OUT', os.path.join(SCRATCH, 'varfont-bands')), 'data')

EN = ('The quick brown fox jumps over the lazy dog, while five boxing wizards jump quickly. '
      'Sphinx of black quartz, judge my vow! Pack my box with 12 dozen liquor jugs (about 3.5 kg) and '
      '"zesty" café crème for Zoë at 7:45 PM; #glyph @ 100% — Ångström, naïve, façade.')
JA = ('今日は朝から雨が降っていましたが、午後になると空が晴れて、町の人々は公園へ散歩に出かけました。'
      '駅の近くにある古い本屋では、店主が新しく届いた小説や写真集を棚に並べています。'
      '子供たちは学校の帰りに友達と一緒に川沿いの道を歩き、夕方の光の中で話し続けました。'
      '私は電車の窓から山の景色を眺めながら、来週の旅行の計画を考えていました。'
      '東京から京都までは新幹線で約二時間半かかります。季節ごとに変わる料理や祭りも楽しみの一つです。'
      '図書館の机で手紙を書き終えると、静かな音楽が流れる喫茶店でコーヒーを飲みました。'
      '経済、政治、科学、文化、歴史、医療、環境、技術、教育、交通について議論する会議が開かれました。')


def tent_range(lo, pk, hi, a, b):
    """Range of one axis factor of fontTools' region scalar over normalized v in [a, b]."""
    if pk == 0 or lo > pk or pk > hi or (lo < 0 < hi):
        return 1.0, 1.0
    def f(v):
        if v == pk: return 1.0
        if v <= lo or v >= hi: return 0.0
        return (v - lo) / (pk - lo) if v < pk else (hi - v) / (hi - pk)
    pts = [a, b] + [p for p in (lo, pk, hi) if a < p < b]
    vals = [f(p) for p in pts]
    return min(vals), max(vals)


def region_range(region, box):
    smin = smax = 1.0
    for (lo, pk, hi), (a, b) in zip(region, box):
        mn, mx = tent_range(lo / 16384, pk / 16384, hi / 16384, a, b)
        smin *= mn; smax *= mx
    return smin, smax


def norm_of(data, tag, v):
    return V.user_to_norm(data, {tag: v})[[a[0] for a in data['axes']].index(tag)]


def build_specs(data, named):
    axes = data['axes']; tags = [a[0] for a in axes]
    full = [(-1.0 if a[1] < a[2] else 0.0, 1.0 if a[3] > a[2] else 0.0) for a in axes]
    zero = [(0.0, 0.0)] * len(axes)
    specs = [('all', 0, full)]
    def only(keep):
        return [full[i] if t in keep else (0.0, 0.0) for i, t in enumerate(tags)]
    if len(axes) > 1 and 'wght' in tags:
        specs.append(('wght', 1, only({'wght'})))
    if 'wdth' in tags and len(axes) > 2:
        specs.append(('wght+wdth', 2, only({'wght', 'wdth'})))
    wi = tags.index('wght'); wa = axes[wi]
    stops = sorted({wa[1], wa[3]} | {i['wght'] for i in named if 'wght' in i})
    for a, b in zip(stops, stops[1:]):
        box = list(zero); box[wi] = (norm_of(data, 'wght', a), norm_of(data, 'wght', b))
        specs.append((f'wght {a:g}-{b:g}', 3, box))
    out = []
    for name, kind, box in specs:
        out.append((name, kind, box, [region_range(r, box) for r in data['regions']]))
    return out


def locations(key, data, named, peaks_max=200):
    axes = data['axes']; tags = [a[0] for a in axes]
    rng = np.random.default_rng(1729)
    locs = [('default', 0, {})]
    for i, inst in enumerate(named):
        locs.append((f'named {i}', 1, inst))
    def rnd(keep, n, kind):
        for j in range(n):
            locs.append((f'rand{kind}.{j}', kind, {a[0]: round(float(rng.uniform(a[1], a[3])), 3) for a in axes if a[0] in keep}))
    if len(axes) == 1:
        rnd({'wght'}, 48, 4)
    else:
        rnd(set(tags), 48, 3 if len(axes) > 2 else 6)
        rnd({'wght'}, 32, 4)
        if 'wdth' in tags:
            rnd({'wght', 'wdth'}, 32, 5)
            for w in (axes[tags.index('wght')][1], axes[tags.index('wght')][3]):
                for d in (axes[tags.index('wdth')][1], axes[tags.index('wdth')][3]):
                    locs.append((f'corner wght {w:g} wdth {d:g}', 5, {'wght': w, 'wdth': d}))
    out = []
    for name, kind, loc in locs:
        norm = V.user_to_norm(data, loc)
        out.append((name, kind, loc, norm))
    # region peaks, in normalized space (no user location needed)
    for r, reg in enumerate(data['regions'][:peaks_max]):
        norm = [pk / 16384 for (_, pk, _) in reg]
        out.append((f'peak r{r}', 2, None, norm))
    return [(n, k, l, nm, [V.region_scalar(reg, nm) for reg in data['regions']]) for n, k, l, nm in out]


def subsets(cmap, name_to_gid, text):
    seen = []
    for ch in text:
        n = cmap.get(ord(ch))
        if n is None or n not in name_to_gid: continue
        g = name_to_gid[n]
        if g not in seen: seen.append(g)
    text_set = list(seen)
    for cp in sorted(cmap):
        if len(seen) >= 200: break
        g = name_to_gid.get(cmap[cp])
        if g is not None and g not in seen: seen.append(g)
    return [text_set, seen[:200]]


def tt_glyphs(data):
    """simple glyph table and per-glyph parts; deltas are fontTools IUP-expanded floats."""
    simple_ix = {}; simple = []
    for g, m in enumerate(data['models']):
        if m[0] != 'simple': continue
        lens = [len(c) for c in m[1]]
        tags = [t for c in m[1] for _, _, t in c]
        base = [v for c in m[1] for x, y, _ in c for v in (x, y)]
        tups = [(t[0], np.array(V.dense(data, g, t, rounding=False), np.float32).reshape(-1)) for t in data['tuples'][g]]
        simple_ix[g] = len(simple); simple.append((lens, tags, base, tups))
    glyphs = []
    for g, m in enumerate(data['models']):
        if m[0] == 'empty': glyphs.append([]); continue
        if m[0] == 'simple': glyphs.append([(simple_ix[g], 0, 0, [])]); continue
        offs = [(t[0], np.array(V.dense(data, g, t, rounding=False), np.float64).reshape(-1, 2)) for t in data['tuples'][g]]
        parts = []
        for k, (gid, dx, dy, tr) in enumerate(m[1]):
            assert tr is None, 'transformed component'
            mm = data['models'][gid]
            assert mm[0] != 'composite', 'nested component'
            if mm[0] != 'simple': continue
            parts.append((simple_ix[gid], dx, dy, [(r, float(d[k, 0]), float(d[k, 1])) for r, d in offs if d[k].any()]))
        glyphs.append(parts)
    return simple, glyphs


def cff2_glyphs(m):
    simple = []; glyphs = []
    for n in m['names']:
        r = m['rows'][n]
        if r[1] == 'fail' or not r[1]: glyphs.append([]); continue
        lens = [len(c) for c in r[1]]
        tags = [t for c in r[1] for _, _, t in c]
        assert set(tags) <= {0, 1}
        base = [v for c in r[1] for x, y, _ in c for v in (x, y)]
        tups = [(ri, np.asarray(d, np.float32).reshape(-1)) for ri, d in enumerate(r[2]) if np.any(d)]
        glyphs.append([(len(simple), 0, 0, [])]); simple.append((lens, tags, base, tups))
    return simple, glyphs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('key'); ap.add_argument('font'); ap.add_argument('set')
    ap.add_argument('--model', default=None)
    a = ap.parse_args()
    from fontTools.ttLib import TTFont
    if a.model:
        m = pickle.load(open(a.model, 'rb'))
        data = dict(axes=m['axes'], avar=m['avar'], regions=m['regions'], upm=m['upm'], names=m['names'])
        simple, glyphs = cff2_glyphs(m)
        font = TTFont(a.font, lazy=True)
        assert m.get('grid', 1) == 1
    else:
        data = V.load_tt(a.font, a.set)
        simple, glyphs = tt_glyphs(data)
        font = V.open_set(a.font, a.set)
    named = [dict(i.coordinates) for i in font['fvar'].instances]
    cmap = font.getBestCmap()
    name_to_gid = {n: i for i, n in enumerate(data['names'])}
    subs = subsets(cmap, name_to_gid, JA if a.key == 'cjk' else EN)
    specs = build_specs(data, named)
    locs = locations(a.key, data, named)
    G, R, A = len(glyphs), len(data['regions']), len(data['axes'])
    out = bytearray(b'VFB1' + struct.pack('<7I', G, R, data['upm'], A, len(locs), len(specs), len(simple)))
    for _, kind, _, norm, sc in locs:
        out += struct.pack('<B3x', kind) + struct.pack(f'<{R}f', *sc) + struct.pack(f'<{A}f', *norm)
    for _, kind, _, rr in specs:
        out += struct.pack('<B3x', kind) + struct.pack(f'<{2 * R}f', *[v for p in rr for v in p])
    for lens, tags, base, tups in simple:
        n = len(tags)
        out += struct.pack('<II', n, len(lens)) + struct.pack(f'<{len(lens)}H', *lens) + bytes(tags)
        out += np.asarray(base, '<i2').tobytes() + struct.pack('<I', len(tups))
        for r, d in tups:
            assert len(d) == 2 * n
            out += struct.pack('<H', r) + d.astype('<f4').tobytes()
    for parts in glyphs:
        out += struct.pack('<I', len(parts))
        for sid, ox, oy, tups in parts:
            out += struct.pack('<Ihh I', sid, ox, oy, len(tups))
            for r, dx, dy in tups:
                out += struct.pack('<Hff', r, dx, dy)
    out += struct.pack('<I', len(subs))
    for s in subs:
        out += struct.pack(f'<I{len(s)}I', len(s), *s)
    os.makedirs(OUT, exist_ok=True)
    stem = os.path.join(OUT, f'{a.key}-{a.set}')
    open(stem + '.vfb', 'wb').write(bytes(out))
    meta = dict(key=a.key, set=a.set, font=os.path.basename(a.font), model=os.path.basename(a.model) if a.model else None,
                glyphs=G, regions=R, upm=data['upm'], axes=data['axes'],
                locations=[dict(name=n, kind=k, user=l, norm=[round(v, 6) for v in nm]) for n, k, l, nm, _ in locs],
                specs=[dict(name=n, kind=k, box=b) for n, k, b, _ in specs],
                subsets=[dict(name=nm, n=len(s)) for nm, s in zip(('text', 'g200'), subs)])
    json.dump(meta, open(stem + '.json', 'w'), indent=1)
    print(a.key, a.set, 'glyphs', G, 'simple', len(simple), 'regions', R, 'locations', len(locs), 'specs', len(specs),
          'subsets', [len(s) for s in subs], 'bytes', len(out))


if __name__ == '__main__':
    main()
