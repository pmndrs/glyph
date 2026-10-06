"""Q8 (estimate, not implemented): resident bytes and per-change work for GPU-side instancing.

Usage: gpu_estimate.py tt <key> <font> <latin|full>   |   gpu_estimate.py cff2 <key> <model.pkl>
Counts come from the same models the benchmarks use. Layouts:
  base       i16 x, y per var point (simple points + component offsets)            4 B / var point
  pool       dense i16 dx, dy per tuple slot (glyph-major, one tuple per glyph/region)  4 B / slot
  planes     region-major: one i16 dx, dy plane over all var points per region      4 B * var points * regions
  tuples     per tuple u32 pool offset + u16 region + u16 point count; per glyph u32 first tuple
  map        per stencil slot (decomposed point or wrap point): u16/u32 source var point + u16/u32 offset var point
  stencil    the output: i16 x, y per stencil slot, tag in bit 0 of x (outline-encoding study's GPU format)
Work per instance change at a location: 2 multiply-adds per active slot (tuples whose region scalar != 0).
"""
import sys, os, json, pickle
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
import emit, cff2_emit  # noqa: E402,E401


def estimate(key, data, locs):
    G = len(data['names']); R = len(data['regions'])
    nvar = [len(V.base_coords(m)) for m in data['models']]
    NV = sum(nvar)
    slots = sum(len(tp[1]) for t in data['tuples'] for tp in t)
    T = sum(len(t) for t in data['tuples'])
    dec = 0; cont = 0
    for m in data['models']:
        if m[0] == 'simple': dec += sum(len(c) for c in m[1]); cont += len(m[1])
        elif m[0] == 'composite':
            for gid, *_ in m[1]:
                mm = data['models'][gid]
                if mm[0] == 'simple': dec += sum(len(c) for c in mm[1]); cont += len(mm[1])
    st = dec + cont
    idxw = 2 if NV < 65536 else 4
    act = []
    for loc in locs:
        norm = V.user_to_norm(data, loc)
        s = [V.region_scalar(r, norm) for r in data['regions']]
        act.append((sum(1 for v in s if v), sum(len(tp[1]) for t in data['tuples'] for tp in t if s[tp[0]])))
    worst = max(act, key=lambda a: a[1])
    out = dict(key=key, glyphs=G, regions=R, var_points=NV, slots=slots, tuples=T, decomposed=dec, contours=cont, stencil_slots=st,
               base_B=4 * NV, pool_B=4 * slots, planes_B=4 * NV * R, tuples_B=8 * T + 4 * (G + 1), map_B=2 * idxw * st,
               stencil_B=4 * st, active=act, worst_active_slots=worst[1], worst_active_regions=worst[0])
    out['resident_pool_B'] = out['base_B'] + out['pool_B'] + out['tuples_B'] + out['map_B'] + out['stencil_B']
    out['resident_planes_B'] = out['base_B'] + out['planes_B'] + out['map_B'] + out['stencil_B']
    out['madds_worst'] = 2 * worst[1]
    out['read_B_worst'] = 4 * worst[1] + 4 * NV + 2 * idxw * st
    return out


if __name__ == '__main__':
    if sys.argv[1] == 'tt':
        key, path, which = sys.argv[2:5]
        data = V.load_tt(path, which); locs = emit.locations(key, data['axes'])
        r = estimate(f'{key}-{which}', data, locs)
    else:
        key, pk = sys.argv[2:4]
        m = pickle.load(open(pk, 'rb')); data = cff2_emit.to_data(m)
        r = estimate(f"{key}-{os.path.basename(pk)[:-4]}", data, cff2_emit.cff2_locations(m['axes']))
    print(json.dumps(r))
