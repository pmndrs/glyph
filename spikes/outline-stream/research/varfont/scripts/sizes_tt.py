"""Q1 sizes for a TrueType variable font. Usage: sizes_tt.py <key> <font> <latin|full>
Writes out/sizes-<key>-<set>.json and prints a Markdown table."""
import sys, os, io, json, gzip
import brotli
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
import venc as D  # noqa: E402
import enc as E  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

OUT = os.path.join(HERE, '..', 'out'); os.makedirs(OUT, exist_ok=True)


def sz(b):
    return [len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24))]


def cat(p): return b''.join(p.values())


def main():
    key, path, which = sys.argv[1:4]
    font = V.open_set(path, which)
    data = V.load_tt(path, which)
    rows = []
    def add(label, b, group): rows.append(dict(label=label, group=group, sizes=sz(b)))
    gv = font.getTableData('gvar'); gl = font.getTableData('glyf') + font.getTableData('loca')
    add('font gvar table', gv, 'reference'); add('font glyf+loca', gl, 'reference'); add('font gvar+glyf+loca', gv + gl, 'reference')
    # dehinted glyf (base stream drops hinting)
    from fontTools import subset as S
    fd = V.open_set(path, which); o = S.Options(); o.hinting = False; o.notdef_outline = True; o.layout_features = ['*']
    o.name_IDs = ['*']; o.glyph_names = True; o.drop_tables = []
    s = S.Subsetter(o); s.populate(glyphs=fd.getGlyphOrder()); s.subset(fd)
    bio = io.BytesIO(); fd.save(bio); bio.seek(0); fd = TTFont(bio)
    add('font glyf+loca, hinting stripped', fd.getTableData('glyf') + fd.getTableData('loca'), 'reference')
    add('font gvar+glyf+loca, hinting stripped', fd.getTableData('gvar') + fd.getTableData('glyf') + fd.getTableData('loca'), 'reference')
    add('font fvar', font.getTableData('fvar'), 'axes')
    if 'avar' in font: add('font avar', font.getTableData('avar'), 'axes')
    # WOFF2 of the whole (subset) variable font, and the transformed glyf stream within it
    f2 = V.open_set(path, which); f2.flavor = 'woff2'; bio = io.BytesIO(); f2.save(bio)
    rows.append(dict(label='WOFF2 file, whole variable font (fontTools, glyf transform, brotli inside)', group='reference',
                     sizes=[None, None, len(bio.getvalue())]))
    from fontTools.ttLib import woff2
    bio.seek(0); r = woff2.WOFF2Reader(bio); e = r.tables['glyf']
    tg = r.transformBuffer.getvalue()[e.offset:e.offset + e.length]
    add('WOFF2 glyf transform stream (with hinting)', tg, 'reference')
    # ours
    base = E.triplets(E.Flat(data['models']))
    add('base stream: triplets, composites kept', cat(base), 'ours')
    add('region table', D.region_table(data), 'ours')
    add('axis table (fvar triples + avar maps)', D.axis_table(data), 'ours')
    add('phantom-point deltas (dropped; HVAR carries metrics)', cat(D.phantom_stream(data)), 'ours')
    best = {}
    for mode in ('dense', 'sparse'):
        for layout in ('region', 'glyph'):
            for coder in ('tripz', 'trip', 'varint', 'split', 'i8esc', 'gvar'):
                for pred in ('raw', 'prev'):
                    if coder == 'gvar' and pred == 'prev': continue
                    if layout == 'glyph' and coder not in ('tripz', 'varint') : continue
                    p = D.delta_streams(data, mode, layout, coder, pred)
                    b = cat(p)
                    add(f'deltas {mode}, {layout}-major, {coder}, {pred}', b, 'deltas-' + mode)
                    planes = {k: sz(v) for k, v in p.items()}
                    rows[-1]['planes'] = planes
        for pts in ('bitmap', 'gvar'):
            if mode == 'sparse':
                p = D.delta_streams(data, mode, 'region', 'tripz', 'raw', pts)
                add(f'deltas sparse, region-major, tripz, raw, point sets as {pts}', cat(p), 'deltas-sparse')
    ro = V.reoptimized(data)
    expl = sum(sum(v is not None for v in tp[1]) for t in ro['tuples'] for tp in t)
    slots = sum(len(tp[1]) for t in ro['tuples'] for tp in t)
    for pred in ('raw', 'prev'):
        add(f'deltas sparse re-optimized (IUP tolerance 0.5, lossy; {expl}/{slots} explicit), region-major, tripz, {pred}',
            cat(D.delta_streams(ro, 'sparse', 'region', 'tripz', pred)), 'deltas-sparse')
    json.dump(dict(key=key, set=which, rows=rows), open(os.path.join(OUT, f'sizes-{key}-{which}.json'), 'w'), indent=1)
    print(f'### {key} {which}\n\n| Stream | Raw B | gzip B | brotli B |\n| --- | ---: | ---: | ---: |')
    for r in rows:
        a, b, c = r['sizes']
        print(f"| {r['label']} | {a if a is not None else '—'} | {b if b is not None else '—'} | {c} |")


if __name__ == '__main__':
    main()
