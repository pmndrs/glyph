"""Print the per-font markdown tables of REPORT.md from results/*.json and the Slug measurements.

Usage: report_tables.py > tables.md
"""
import json, os, re, glob
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def load_rows(key):
    rows = {}
    for p in [f'{key}.json', f'{key}-r3.json'] + [os.path.basename(x) for x in glob.glob(os.path.join(R, 'results', f'{key}-*-r2.json'))]:
        fp = os.path.join(R, 'results', p)
        if not os.path.exists(fp): continue
        for r in json.load(open(fp))['rows']:
            rows[(r[0].strip(), r[1])] = r[2:5]
    grid = os.path.join(R, 'results', key.replace('-', '-grid-', 1) + '-r3.json')
    if os.path.exists(grid):
        for r in json.load(open(grid))['rows']: rows[(r[0].strip(), r[1])] = r[2:5]
    return rows


def slug(key):
    txt = ''.join(open(os.path.join(R, f)).read() for f in ('results-slug.txt', 'results-slug-cjk.txt'))
    m = re.search(rf'^{key}\.slug\.glb: glyphs=(\d+) present=(\d+) pages=\d+ file=(\d+) file_gz=(\d+) file_br=(\d+)\n  used: curve_texels=(\d+) .*?unpadded total=(\d+)\n(.*?)(?=^\S|\Z)', txt, re.S | re.M)
    if not m: return None
    sec = {k: tuple(map(int, v)) for k, *v in re.findall(r'(\w+)\s+raw=\s*(\d+) gz=\s*(\d+) br=\s*(\d+)', m.group(8))}
    return dict(file=(int(m.group(3)), int(m.group(4)), int(m.group(5))), texels=int(m.group(6)), unpadded=int(m.group(7)), sec=sec, present=int(m.group(2)))


TT = [
    ('Source and references', None),
    ('source glyf+loca', 'font table', 'source glyf+loca as copied today (with hinting)'),
    ('source, hinting stripped', 'font table', 'source glyf+loca, hinting stripped'),
    ('woff2 glyf transform', 'woff2 (glyf+loca)', 'WOFF2 glyf transform (fontTools)'),
    ('woff2 glyf transform, dehinted', 'woff2 (glyf+loca)', 'WOFF2 glyf transform, hinting stripped'),
    ('SLUG', None),
    ('Candidates, composites kept (tt-keep)', None),
    ('explicit 2n+1 varint (#244 shape)', 'tt-keep', 'explicit 2n+1 points, varint, xy interleaved (our reimplementation of the #244 shape)'),
    ('explicit 2n+1, split planes', 'tt-keep', '1. 2n+1 with x|y split planes'),
    ('implied on-curves explicit, no line ctrl', 'tt-keep', '1. implied on-curves explicit, no line controls'),
    ('planes varint, xy interleaved', 'tt-keep', '1+2. glyf points (implied), varint zigzag deltas, xy interleaved'),
    ('planes varint (x|y split, bitflags)', 'tt-keep', '2. same, x|y split planes'),
    ('planes varint, flags byte/pt', 'tt-keep', '2. same, flags 1 byte/point instead of 1 bit'),
    ('planes i16 deltas', 'tt-keep', '2. i16 deltas, x|y planes'),
    ('planes i16 deltas, byte-shuffled', 'tt-keep', '2. i16 deltas, byte-plane transposed'),
    ('planes zigzag u16 deltas, byte-shuffled', 'tt-keep', '2. zigzag u16 deltas, byte-plane transposed'),
    ('planes i8+escape deltas', 'tt-keep', '4. i8 deltas + i16 escape plane'),
    ('planes varint, pred lin', 'tt-keep', '3. linear (parallelogram) prediction'),
    ('planes varint, pred smooth', 'tt-keep', '3. tangent-continuity prediction'),
    ('StreamVByte planes (2-bit len ctrl)', 'tt-keep', '10. StreamVByte-style (2-bit length codes + byte planes)'),
    ('WOFF2-style triplets', 'tt-keep', '8/10. WOFF2 triplet coding of the same points'),
    ('+ contour dedup (back-refs)', 'tt-keep', '5. contour dedup back-refs (on varint interleaved)'),
    ('glyph-major i16 (glyf-like)', 'tt-keep', 'glyph-major fixed i16 (glyf-like order)'),
    ('meshopt v1 on abs xy', 'tt-keep', '6. EXT_meshopt vertex codec v1 on absolute i16 xy'),
    ('GPU abs i16 x|y planes', 'tt-keep', '7. absolute i16 x|y planes (GPU-readable, compact)'),
    ('Candidates, composites decomposed (tt-dec, what Slug needs)', None),
    ('explicit 2n+1 varint (#244 shape)', 'tt-dec', 'explicit 2n+1 points, varint, decomposed'),
    ('planes varint, xy interleaved', 'tt-dec', 'varint xy interleaved, decomposed'),
    ('WOFF2-style triplets', 'tt-dec', 'WOFF2-style triplets, decomposed'),
    ('bp16 maintainer proposal (per-glyph blocks)', 'tt-dec', '9. maintainer proposal (bp16, per-glyph blocks)'),
    ('bp16, blocks across glyphs', 'tt-dec', '9. bp16 variant, blocks across glyph boundaries'),
    ('meshopt v1 on abs xy', 'tt-dec', '6. meshopt v1 on absolute xy, decomposed'),
    ('GPU stencil i16 (tag in x bit0, wrap pt)', 'tt-dec', '7. GPU stencil buffer i16 (proposed Slug curve source)'),
    ('Slug layout i16 half-units', 'tt-dec', '7. Slug texel layout, i16 half units (exact)'),
    ('Slug layout f16 em (current fmt)', 'tt-dec', '7. Slug texel layout, f16 em (model of today)'),
    ('meshopt v1 on Slug i16 texels', 'tt-dec', '6. meshopt v1 on Slug i16 texels'),
]


def cff_rows(modes):
    out = [('Source and references', None),
           ('source CFF', 'font table', 'source CFF as copied today (with hinting)'),
           ('source, hinting stripped', 'font table', 'source CFF, hinting stripped'),
           ('source, dehinted + desubroutinized', 'font table', 'source CFF, dehinted + desubroutinized'),
           ('SLUG', None),
           ('Cubics kept (cff-cubic)', None),
           ('planes varint, xy interleaved', 'cff-cubic', 'varint xy interleaved, cubics'),
           ('planes varint (x|y split, bitflags)', 'cff-cubic', '2. x|y split, 2-bit tags'),
           ('planes i8+escape deltas', 'cff-cubic', '4. i8 + escape'),
           ('planes zigzag u16 deltas, byte-shuffled', 'cff-cubic', '2. zigzag u16 byte-shuffled'),
           ('planes varint, pred lin', 'cff-cubic', '3. linear prediction'),
           ('StreamVByte planes (2-bit len ctrl)', 'cff-cubic', '10. StreamVByte-style'),
           ('WOFF2-style triplets', 'cff-cubic', '10. WOFF2-style triplets, cubics'),
           ('+ contour dedup (back-refs)', 'cff-cubic', '5. contour dedup back-refs'),
           ('meshopt v1 on abs xy', 'cff-cubic', '6. meshopt v1 on absolute xy'),
           ('bp16 maintainer proposal (per-glyph blocks)', 'cff-cubic', '9. bp16 layout applied to cubic points')]
    for m in modes:
        out += [(f'Quadratics, bake-time cu2qu ({m})', None),
                ('explicit 2n+1 varint (#244 shape)', m, 'explicit 2n+1 points, varint (our reimplementation of the #244 shape)'),
                ('implied on-curves explicit, no line ctrl', m, '1. implied on-curves explicit'),
                ('planes varint, xy interleaved', m, '1+2. implied on-curves, varint xy interleaved'),
                ('planes i8+escape deltas', m, '4. i8 + escape'),
                ('planes varint, pred lin', m, '3. linear prediction'),
                ('StreamVByte planes (2-bit len ctrl)', m, '10. StreamVByte-style'),
                ('WOFF2-style triplets', m, '10. WOFF2-style triplets'),
                ('bp16 maintainer proposal (per-glyph blocks)', m, '9. maintainer proposal (bp16)'),
                ('meshopt v1 on abs xy', m, '6. meshopt v1 on absolute xy'),
                ('GPU stencil i16 (tag in x bit0, wrap pt)', m, '7. GPU stencil buffer i16'),
                ('Slug layout f16 em (current fmt)', m, '7. Slug texel layout f16 em, cu2qu curves')]
    return out


def kb(v): return f'{v / 1000:.1f}'


def table(title, key, spec, src_key):
    rows = load_rows(key)
    src = rows.get(src_key)
    print(f'\n### {title}\n')
    print('| Encoding | Raw KB | gzip KB | brotli KB | gzip vs source | brotli vs source |')
    print('| --- | ---: | ---: | ---: | ---: | ---: |')
    s = slug(key)
    for item in spec:
        if item[1] is None:
            if item[0] == 'SLUG':
                wl = os.path.join(R, 'logs', 'weak-baseline.txt')
                weak = dict((l.split(' ', 1)[0], json.loads(l.split(' ', 1)[1])) for l in open(wl) if l.strip()) if os.path.exists(wl) else {}
                for wk, wlabel in (('stream_components', 'weak prototype `stream_estimate.py`, composites kept'), ('stream', 'weak prototype `stream_estimate.py`, decomposed')):
                    v = weak.get(key, {}).get(wk)
                    if v: print(f'| {wlabel} | {kb(v[0])} | {kb(v[1])} | {kb(v[2])} | {v[1]/src[1]*100:.0f}% | {v[2]/src[2]*100:.0f}% |')
                if s:
                    sec = s['sec']
                    bands = [sum(sec[k][i] for k in ('header', 'reference', 'record')) for i in range(3)]
                    def r(label, v):
                        print(f'| {label} | {kb(v[0])} | {kb(v[1])} | {kb(v[2])} | {v[1]/src[1]*100:.0f}% | {v[2]/src[2]*100:.0f}% |')
                    r(f'Slug `.slug.glb` as baked (whole file, {s["present"]} glyphs)', s['file'])
                    r('Slug curve texture section only (RGBA16F, padded page)', sec['curve'])
                    r('Slug band tables only (headers + references + records)', bands)
                continue
            print(f'| **{item[0]}** | | | | | |'); continue
        name, mode, label = item
        v = rows.get((name, mode))
        if v is None: continue
        print(f'| {label} | {kb(v[0])} | {kb(v[1])} | {kb(v[2])} | {v[1]/src[1]*100:.0f}% | {v[2]/src[2]*100:.0f}% |')


FONTS = [
    ('Inter 4.1, Latin (U+0020-007E, U+00A0-00FF)', 'inter-latin', TT, ('source glyf+loca', 'font table')),
    ('Inter 4.1, full glyph set', 'inter-full', TT, ('source glyf+loca', 'font table')),
    ('Source Serif 4.005, Latin', 'serif-latin', TT, ('source glyf+loca', 'font table')),
    ('Source Serif 4.005, full glyph set', 'serif-full', TT, ('source glyf+loca', 'font table')),
    ('Dancing Script 3.000 (CFF), Latin', 'dancing-latin', cff_rows(['cff-q1', 'cff-q0.5', 'cff-q0.25x2']), ('source CFF', 'font table')),
    ('Dancing Script 3.000 (CFF), full glyph set', 'dancing-full', cff_rows(['cff-q1', 'cff-q0.5', 'cff-q0.25x2']), ('source CFF', 'font table')),
    ('Noto Sans CJK JP showcase (CFF), full glyph set (155 glyphs)', 'cjks-full', cff_rows(['cff-q1', 'cff-q0.5', 'cff-q0.25x2']), ('source CFF', 'font table')),
    ('Noto Sans CJK JP 2.004 (CFF), full glyph set (65,535 glyphs)', 'cjk-full', cff_rows(['cff-q1']), ('source CFF', 'font table')),
]

if __name__ == '__main__':
    for title, key, spec, src in FONTS:
        if not os.path.exists(os.path.join(R, 'results', key + '.json')):
            print(f'\n### {title}\n\nNot measured (results/{key}.json missing).'); continue
        table(title, key, spec, src)
