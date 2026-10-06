"""Check bandlab's instancer (the instance curves every band check uses) against an independent reference.

Usage:
  verify_instancer.py tt <key> <font> <latin|full>            against fontTools.varLib.instancer at the previous
                                                              study's verify locations (cached decomposed points)
  verify_instancer.py cff2 <key> <set> <pkl>                  against round(base + sum s * delta) in float64 from the
                                                              converted model, at that model's verify locations
Prints mismatching coordinates and max |difference| per location. Needs bandcheck built (BANDCHECK env or default).
"""
import sys, os, struct, subprocess, pickle
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(RESEARCH, 'encoding', 'scripts'))
sys.path.insert(0, os.path.join(RESEARCH, 'varfont', 'scripts'))
import vmodel as V  # noqa: E402
import emit  # noqa: E402
import cff2_emit  # noqa: E402

SCRATCH = '/tmp/claude-0/-home-user-glyph/562408c2-1c90-5477-a581-3dc9cf79024e/scratchpad'
V.CACHE = os.environ.get('VF_CACHE', os.path.join(SCRATCH, 'varfont', 'cache'))
VB = os.environ.get('VFB_OUT', os.path.join(SCRATCH, 'varfont-bands'))
BANDCHECK = os.environ.get('BANDCHECK', os.path.join(VB, 'target', 'release', 'bandcheck'))


def run_dump(key, which, scal):
    sp = os.path.join(VB, 'out', f'scalars-{key}-{which}.f32'); op = os.path.join(VB, 'out', f'dump-{key}-{which}.bin')
    np.asarray(scal, '<f4').tofile(sp)
    subprocess.run([BANDCHECK, 'dump', os.path.join(VB, 'data', f'{key}-{which}.vfb'), sp, op], check=True)
    raw = open(op, 'rb').read(); p = 0; out = []
    for _ in scal:
        loc = []
        while len(loc) < G[0]:
            n = struct.unpack_from('<I', raw, p)[0]; p += 4
            loc.append(np.frombuffer(raw, '<i2', 2 * n, p).reshape(-1, 2).astype(np.int64)); p += 4 * n
        out.append(loc)
    return out


G = [0]


def main():
    mode = sys.argv[1]
    if mode == 'tt':
        key, path, which = sys.argv[2:5]
        data = V.load_tt(path, which)
        locs = emit.locations(key, data['axes'])
        refs = [V.reference_instance(path, which, l) for l in locs]
        G[0] = len(data['names'])
        scal = [[V.region_scalar(r, V.user_to_norm(data, l)) for r in data['regions']] for l in locs]
        got = run_dump(key, which, scal)
        for l, r, gl in zip(locs, refs, got):
            bad = tot = 0; mx = 0
            for g, pts in enumerate(gl):
                ref = np.array(r['decomposed'][g], np.int64).reshape(-1, 2)
                assert ref.shape == pts.shape, (g, ref.shape, pts.shape)
                d = np.abs(ref - pts); bad += int((d > 0).sum()); tot += d.size; mx = max(mx, int(d.max()) if d.size else 0)
            print(f'{key} {which} {l}: {bad} / {tot} coordinates differ, max |diff| {mx}')
    else:
        key, which, pk = sys.argv[2:5]
        m = pickle.load(open(pk, 'rb'))
        data = dict(axes=m['axes'], avar=m['avar'])
        locs = cff2_emit.cff2_locations(m['axes'])
        G[0] = len(m['names'])
        scal = [[V.region_scalar(r, V.user_to_norm(data, l)) for r in m['regions']] for l in locs]
        got = run_dump(key, which, scal)
        for l, sc, gl in zip(locs, scal, got):
            bad = tot = 0; mx = 0
            for g, n in enumerate(m['names']):
                row = m['rows'][n]
                if row[1] == 'fail' or not row[1]: continue
                base = np.array([(x, y) for c in row[1] for x, y, _ in c], np.float64)
                for ri, d in enumerate(row[2]):
                    base = base + sc[ri] * np.asarray(d, np.float64)
                ref = np.floor(base + 0.5).astype(np.int64)
                d = np.abs(ref - gl[g]); bad += int((d > 0).sum()); tot += d.size; mx = max(mx, int(d.max()) if d.size else 0)
            print(f'{key} {which} {l}: {bad} / {tot} coordinates differ, max |diff| {mx}')


if __name__ == '__main__':
    main()
