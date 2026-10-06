"""Measure every candidate encoding for one font and glyph set.

Usage: run.py <key> <font> <latin|full> [modes...]
Prints a table and writes results/<key>-<set>.json.
"""
import sys, os, io, json, gzip, time
import brotli
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M
import enc as E
from fontTools.ttLib import woff2

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'results'); os.makedirs(OUT, exist_ok=True)
BIN = os.path.join(HERE, '..', 'bin'); os.makedirs(BIN, exist_ok=True)


def sizes(b):
    return len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24))


def cat(planes): return b''.join(planes.values())


def main():
    key, path, which = sys.argv[1:4]
    uni = M.LATIN if which == 'latin' else None
    font = M.open_font(path, uni)
    rows = []
    upm = font['head'].unitsPerEm
    is_tt = 'glyf' in font
    # ---- source tables
    tags = [t for t in ('glyf', 'loca', 'CFF ', 'CFF2') if t in font]
    src = b''.join(font.getTableData(t) for t in tags)
    rows.append(('source ' + '+'.join(t.strip() for t in tags), 'font table', *sizes(src)))
    from fontTools import subset as S
    def dehint(f, desub=False):
        from fontTools.ttLib import TTFont
        bio = io.BytesIO(); f.save(bio); bio.seek(0); f = TTFont(bio)
        o = S.Options(); o.hinting = False; o.notdef_outline = True; o.desubroutinize = desub
        o.layout_features = ['*']; o.name_IDs = ['*']; o.glyph_names = True
        s = S.Subsetter(o); s.populate(glyphs=f.getGlyphOrder()); s.subset(f); return f
    fd = dehint(M.open_font(path, uni))
    srcd = b''.join(fd.getTableData(t) for t in tags)
    rows.append(('source, hinting stripped', 'font table', *sizes(srcd)))
    if not is_tt:
        fdd = dehint(M.open_font(path, uni), desub=True)
        rows.append(('source, dehinted + desubroutinized', 'font table', *sizes(b''.join(fdd.getTableData(t) for t in tags))))
    if is_tt:
        for label, f2 in (('woff2 glyf transform', M.open_font(path, uni)), ('woff2 glyf transform, dehinted', dehint(M.open_font(path, uni)))):
            f2.flavor = 'woff2'; bio = io.BytesIO(); f2.save(bio)
            bio.seek(0); r = woff2.WOFF2Reader(bio); e = r.tables['glyf']
            tg = r.transformBuffer.getvalue()[e.offset:e.offset + e.length]
            rows.append((label, 'woff2 (glyf+loca)', *sizes(tg)))
    modes = sys.argv[4:] or (['tt-keep', 'tt-dec'] if is_tt else ['cff-cubic', 'cff-q0.5', 'cff-q1', 'cff-q2'])
    info = {}
    for mode in modes:
        t0 = time.time()
        names, models, st = M.load(path, uni, mode)
        f = E.Flat(models)
        on = int((f.t == 0).sum()); off = int((f.t != 0).sum())
        info[mode] = dict(glyphs=len(names), contours=int(len(f.cn)), points=f.points, on=on, off=off,
                          composites=sum(1 for m in models if m[0] == 'composite'), fractional=st['fractional'])
        print(f'# {mode}: {info[mode]}  ({time.time()-t0:.1f}s)', file=sys.stderr)
        cand = {}
        cand['planes varint (x|y split, bitflags)'] = E.planes(f)
        cand['planes varint, flags byte/pt'] = E.planes(f, flags_packed=False)
        cand['planes varint, xy interleaved'] = E.planes(f, xy='interleave')
        cand['planes i16 deltas'] = E.planes(f, coord='i16')
        cand['planes i16 deltas, interleaved'] = E.planes(f, coord='i16', xy='interleave')
        cand['planes i16 deltas, byte-shuffled'] = E.planes(f, coord='i16shuf')
        cand['planes zigzag u16 deltas, byte-shuffled'] = E.planes(f, coord='i16zshuf')
        cand['planes i8+escape deltas'] = E.planes(f, coord='i8esc')
        cand['planes varint, pred lin'] = E.planes(f, pred='lin')
        cand['planes varint, pred smooth'] = E.planes(f, pred='smooth')
        cand['planes i16shuf, pred smooth'] = E.planes(f, coord='i16shuf', pred='smooth')
        cand['glyph-major i16 (glyf-like)'] = E.glyph_major(f)
        cand['GPU abs i16 xy interleaved'] = E.gpu_points(f, 'interleave')
        cand['GPU abs i16 x|y planes'] = E.gpu_points(f, 'planes')
        cand['GPU abs i16 byte-shuffled'] = E.gpu_points(f, 'shuffle')
        cand['GPU abs i16 rel-bbox shuffled'] = E.gpu_points(f, 'shuffle', rel_bbox=True)
        cand['GPU point word (tag in x low bits)'] = E.gpu_pointword(f)
        gp = E.gpu_points(f, 'interleave')
        cand['meshopt v0 on abs xy'] = E.meshopt(gp, ('xy',), 4, 0)
        cand['meshopt v1 on abs xy'] = E.meshopt(gp, ('xy',), 4, 1)
        if not f.cubic:
            q = E.explicit_quads(f)
            curves, per, lines = q
            info[mode].update(quad_curves=int(len(curves)), line_curves=int(lines.sum()))
            cand['explicit 2n+1 varint (#244 shape)'] = E.explicit_stream(f, q)
            cand['Slug layout i16 half-units'] = E.slug_layout(f, q, 'i16')
            cand['Slug layout i16, lines p1=p0'] = E.slug_layout(f, q, 'i16-p1eqp0')
            cand['Slug layout f16 em (current fmt)'] = E.slug_layout(f, q, 'f16', upm)
            sl = E.slug_layout(f, q, 'i16')
            cand['meshopt v1 on Slug i16 texels'] = E.meshopt(sl, ('tex',), 8, 1)
        for name, planes in cand.items():
            b = cat(planes)
            rows.append((name, mode, *sizes(b)))
            if name in ('planes varint (x|y split, bitflags)', 'planes i16 deltas, byte-shuffled', 'GPU abs i16 xy interleaved',
                        'meshopt v1 on abs xy', 'planes varint, pred smooth'):
                tag = name.split(' ')[0] + '-' + ('smooth' if 'smooth' in name else name.split(' ')[1])
                with open(os.path.join(BIN, f'{key}-{which}-{mode}-{tag}.bin'), 'wb') as fh: fh.write(b)
                with open(os.path.join(BIN, f'{key}-{which}-{mode}-{tag}.json'), 'w') as fh:
                    json.dump({k: len(v) for k, v in planes.items()} | {'glyphs': len(f.hdr), 'contours': int(len(f.cn)), 'points': f.points, 'cubic': f.cubic}, fh)
    w = max(len(r[0]) for r in rows)
    print(f'## {key} {which}  upm={upm}')
    print(json.dumps(info))
    for r in rows: print(f'{r[0]:{w}s}  {r[1]:18s} raw={r[2]:9d} gz={r[3]:9d} br={r[4]:9d}')
    json.dump({'rows': rows, 'info': info, 'upm': upm}, open(os.path.join(OUT, f'{key}-{which}.json'), 'w'), indent=1)


if __name__ == "__main__": main()
