"""Cross-font headline table and combined (outlines + Slug) payload, from results/ and the Slug measurements.
Usage: summary.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_tables import load_rows, slug, R

FONTS = [('Inter Latin', 'inter-latin', 'tt'), ('Inter full', 'inter-full', 'tt'), ('Serif Latin', 'serif-latin', 'tt'),
         ('Serif full', 'serif-full', 'tt'), ('Dancing Latin', 'dancing-latin', 'cff'), ('Dancing full', 'dancing-full', 'cff'),
         ('CJK showcase', 'cjks-full', 'cff'), ('CJK 2.004 full', 'cjk-full', 'cff')]


def pick(rows, kind):
    q = 'cff-q1'
    keep = 'tt-keep' if kind == 'tt' else q
    dec = 'tt-dec' if kind == 'tt' else q
    src = ('source glyf+loca', 'font table') if kind == 'tt' else ('source CFF', 'font table')
    return dict(
        source=rows.get(src),
        dehinted=rows.get(('source, hinting stripped', 'font table')),
        woff2=rows.get(('woff2 glyf transform, dehinted', 'woff2 (glyf+loca)')),
        varint=rows.get(('planes varint, xy interleaved', keep)),
        triplet=rows.get(('WOFF2-style triplets', keep)),
        triplet_dec=rows.get(('WOFF2-style triplets', dec)),
        triplet_cubic=rows.get(('WOFF2-style triplets', 'cff-cubic')) if kind == 'cff' else None,
        bp16=rows.get(('bp16 maintainer proposal (per-glyph blocks)', dec)),
        stencil=rows.get(('GPU stencil i16 (tag in x bit0, wrap pt)', dec)),
    )


def c(v, i): return f'{v[i] / 1000:.1f}' if v else 'n/m'


print('| Font, set | source (as copied) | dehinted source | WOFF2 glyf, dehinted | weak prototype | varint planes | triplets | triplets, decomposed | CFF cubics, triplets | bp16 (maintainer) | GPU stencil buffer | Slug `.slug.glb` |')
print('| --- |' + ' ---: |' * 11)
weak = {}
wl = os.path.join(R, 'logs', 'weak-baseline.txt')
if os.path.exists(wl): weak = dict((l.split(' ', 1)[0], json.loads(l.split(' ', 1)[1])) for l in open(wl) if l.strip())
combined = []
for label, key, kind in FONTS:
    if not os.path.exists(os.path.join(R, 'results', key + '.json')): continue
    rows = load_rows(key); p = pick(rows, kind); s = slug(key)
    w = weak.get(key, {}); wv = w.get('stream_components') or w.get('stream')
    for i, comp in ((1, 'gzip'), (2, 'brotli')):
        print(f'| {label}, {comp} | {c(p["source"], i)} | {c(p["dehinted"], i)} | {c(p["woff2"], i)} | {c(wv, i)} | {c(p["varint"], i)} | **{c(p["triplet"], i)}** | {c(p["triplet_dec"], i)} | {c(p["triplet_cubic"], i)} | {c(p["bp16"], i)} | {c(p["stencil"], i)} | {c(s["file"], i) if s else "n/m"} |')
    if s:
        sec = s['sec']
        bands = [sum(sec[k][i] for k in ('header', 'reference', 'record')) for i in range(3)]
        combined.append((label, p['source'], s['file'], bands, p['triplet'], p['stencil'], s, kind))

print('\n| Font, set | today: source table + Slug file, gzip / brotli KB | proposed, bands shipped: triplets + Slug band tables | proposed, bands built at load: triplets only | GPU resident today: Slug pages (curve + header + reference textures) | GPU resident proposed: stencil buffer + band tables (unpadded) |')
print('| --- | ---: | ---: | ---: | ---: | ---: |')
for label, src, sf, bands, trip, sten, s, kind in combined:
    today = (src[1] + sf[1], src[2] + sf[2]); prop = (trip[1] + bands[1], trip[2] + bands[2])
    sec = s['sec']
    gpu_today = sec['curve'][0] + sec['header'][0] + sec['reference'][0]
    gpu_new = (sten[0] if sten else 0) + (s['unpadded'] - s['texels'] * 8)
    print(f'| {label} | {today[0]/1000:.1f} / {today[1]/1000:.1f} | {prop[0]/1000:.1f} / {prop[1]/1000:.1f} | {trip[1]/1000:.1f} / {trip[2]/1000:.1f} | {gpu_today/1000:.0f} KB | {gpu_new/1000:.0f} KB |')
