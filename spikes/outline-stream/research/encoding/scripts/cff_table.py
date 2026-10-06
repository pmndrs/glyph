"""CFF precision vs size vs curve count table (cu2qu tolerance and grid), from results/ and logs/cu2qu-*.txt.
Usage: cff_table.py <key> <cu2qu-log-name>   e.g. cff_table.py dancing-full dancing"""
import os, sys, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_tables import load_rows, slug, R

key, logname = sys.argv[1:3]
rows = load_rows(key)
stencil = {}
for p in (f'{key}-r3.json', key.replace('-', '-grid-', 1) + '-r3.json'):
    fp = os.path.join(R, 'results', p)
    if os.path.exists(fp): stencil.update(json.load(open(fp))['stencil'])
info = json.load(open(os.path.join(R, 'results', key + '.json')))['info']
err = {}
for l in open(os.path.join(R, 'logs', f'cu2qu-{logname}.txt')):
    m = re.match(r'(.+?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$', l.rstrip())
    if m: err[m.group(1).strip()] = tuple(float(m.group(i)) for i in range(2, 6))
cubic_pts = info['cff-cubic']['points']
src = rows[('source CFF', 'font table')]
print(f'| Conversion | points (growth vs cubic) | quadratic curves | quads per cubic | max / p99 / mean error, font units | triplets gzip / brotli KB | GPU stencil buffer KB (5.x B/curve) |')
print('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
tri = rows.get(('WOFF2-style triplets', 'cff-cubic'))
print(f'| none: CFF cubics kept (exact) | {cubic_pts:,} | n/a | n/a | 0 (CFF coordinates here are integers) | {tri[1]/1000:.1f} / {tri[2]/1000:.1f} | n/a (not quadratic) |')
for mode, label, ek in (('cff-q0.25', 'cu2qu tol 0.25, integer grid', 'cu2qu tol=0.25, int off-curves'),
                        ('cff-q0.25x2', 'cu2qu tol 0.25, half-unit grid', 'cu2qu tol=0.25, half-unit off-curves'),
                        ('cff-q0.5', 'cu2qu tol 0.5, integer grid', 'cu2qu tol=0.5, int off-curves'),
                        ('cff-q0.5x2', 'cu2qu tol 0.5, half-unit grid', 'cu2qu tol=0.5, half-unit off-curves'),
                        ('cff-q1', 'cu2qu tol 1, integer grid', 'cu2qu tol=1.0, int off-curves'),
                        ('cff-q1x2', 'cu2qu tol 1, half-unit grid', 'cu2qu tol=1.0, half-unit off-curves'),
                        ('cff-q2', 'cu2qu tol 2, integer grid', 'cu2qu tol=2.0, int off-curves')):
    st = stencil.get(mode); t = rows.get(('WOFF2-style triplets', mode)); e = err.get(ek)
    if not st or not t: continue
    pts = st['points'] - st['pad_points']
    sten = rows.get(('GPU stencil i16 (tag in x bit0, wrap pt)', mode))
    print(f'| {label} | {pts:,} (+{(pts/cubic_pts-1)*100:.0f}%) | {st["curves"]:,} | {e[0]:.2f} | {e[1]:.2f} / {e[2]:.2f} / {e[3]:.2f} | {t[1]/1000:.1f} / {t[2]/1000:.1f} | {sten[0]/1000:.0f} ({st["bytes_per_curve"]:.2f}) |')
s = slug(key)
if s:
    contours = info['cff-cubic']['contours']
    e = err['slug 4-split, f16 em (Slug texture)']; e2 = err['slug 4-split, f32 (#235 runtime)']
    curves = s['texels'] - contours
    print(f'| today, Slug: fixed 4-split, f16 em | n/a | ~{curves:,} | 4.00 | {e[1]:.2f} / {e[2]:.2f} / {e[3]:.2f} | curve section {s["sec"]["curve"][1]/1000:.1f} / {s["sec"]["curve"][2]/1000:.1f} | {s["texels"]*8/1000:.0f} used ({s["texels"]*8/curves:.2f}) |')
    print(f'| today, #235 `outlineAt()`: fixed 4-split, f32 | n/a | ~{curves:,} | 4.00 | {e2[1]:.2f} / {e2[2]:.2f} / {e2[3]:.2f} | source CFF {src[1]/1000:.1f} / {src[2]/1000:.1f} | n/a |')
