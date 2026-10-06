"""Write the Rust/Node benchmark inputs for one TrueType variable font and glyph set.

Usage: emit.py <key> <font> <latin|full>
Writes bench/<key>-<set>.bin (all sections concatenated, each padded to 16 bytes with 16 spare bytes so SIMD
loads may over-read) and bench/<key>-<set>.json (section offsets, counts, user locations).
Delta streams: glyph-major (per glyph varint tuple count, per tuple varint region id), values tripz with 'prev'
prediction per tuple; sparse adds a point plane (per tuple varint count, 0 = all points, else gap varints).
"""
import sys, os, json, struct
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
import venc as D  # noqa: E402
import enc as E  # noqa: E402

BENCH = os.path.join(HERE, '..', 'bench'); os.makedirs(BENCH, exist_ok=True)


def locations(key, axes):
    rng = np.random.default_rng(11)
    t = {a[0]: a for a in axes}
    if key == 'inter':
        locs = [{}, {'wght': 100}, {'wght': 900}, {'opsz': 32}, {'wght': 900, 'opsz': 32}, {'wght': 650, 'opsz': 20},
                {'wght': 237, 'opsz': 17.3}]
    else:
        locs = [{}, {'wght': 1000}, {'wdth': 25}, {'opsz': 144, 'wght': 100, 'wdth': 151}]
    for _ in range(3):
        locs.append({a[0]: round(float(rng.uniform(a[1], a[3])), 2) for a in axes})
    return locs


def main():
    key, path, which = sys.argv[1:4]
    data = V.load_tt(path, which)
    write(key, which, data, locations(key, data['axes']))


def write(key, which, data, locs):
    f = E.Flat(data['models'])
    base = E.triplets(f)
    G = len(data['names'])
    sec = {}
    sec.update({'base_' + k: v for k, v in base.items()})
    for mode in ('dense', 'sparse'):
        p = D.delta_streams(data, mode, 'glyph', 'tripz', 'prev', 'gaps')
        sec.update({f'{mode}_' + k: v for k, v in p.items()})
    axes = data['axes']; A = len(axes)
    sec['axes'] = struct.pack(f'<{3*A}d', *[v for a in axes for v in a[1:]])
    counts = []; pairs = []
    for a in axes:
        seg = data['avar'].get(a[0], []); counts.append(len(seg)); pairs += [v for p in seg for v in p]
    sec['avar_counts'] = struct.pack(f'<{A}I', *counts); sec['avar_pairs'] = struct.pack(f'<{len(pairs)}d', *pairs)
    R = len(data['regions'])
    sec['regions'] = struct.pack(f'<{R*A*3}h', *[v for r in data['regions'] for a in r for v in a])
    sec['locations'] = struct.pack(f'<{len(locs)*A}d', *[l.get(a[0], a[2]) for l in locs for a in axes])
    blob = bytearray(); man = {}
    for k, v in sec.items():
        off = len(blob); blob += v; blob += b'\0' * (16 + (-len(blob)) % 16)
        man[k] = [off, len(v)]
    nvar = [len(V.base_coords(m)) for m in data['models']]
    ntup = sum(len(t) for t in data['tuples'])
    slots_dense = sum(len(tp[1]) for t in data['tuples'] for tp in t)
    slots_sparse = sum(sum(v is not None for v in tp[1]) for t in data['tuples'] for tp in t)
    meta = dict(key=key, set=which, glyphs=G, points=int(f.points), contours=int(len(f.cn)), comps=len(f.comps),
                varpoints=int(sum(nvar)), tuples=ntup, slots_dense=slots_dense, slots_sparse=slots_sparse,
                axes=A, regions=R, upm=data.get('upm', 1000), locations=locs, sections=man,
                max_glyph_varpoints=int(max(nvar)), decomposed_points=None)
    # decomposed point count (composites expanded)
    dec = 0
    for m in data['models']:
        if m[0] == 'simple': dec += sum(len(c) for c in m[1])
        elif m[0] == 'composite':
            for gid, *_ in m[1]:
                mm = data['models'][gid]; assert mm[0] != 'composite'
                if mm[0] == 'simple': dec += sum(len(c) for c in mm[1])
    meta['decomposed_points'] = dec
    meta['upm'] = data.get('upm', 1000)
    open(os.path.join(BENCH, f'{key}-{which}.bin'), 'wb').write(bytes(blob))
    json.dump(meta, open(os.path.join(BENCH, f'{key}-{which}.json'), 'w'), indent=1)
    print(key, which, {k: meta[k] for k in ('glyphs', 'points', 'varpoints', 'tuples', 'slots_dense', 'slots_sparse', 'regions', 'decomposed_points')}, len(blob))


if __name__ == '__main__':
    main()
