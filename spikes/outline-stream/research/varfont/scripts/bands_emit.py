"""Q6 inputs: decomposed default points, conservative per-point ranges across all regions, and fontTools instances.

Usage: bands_emit.py <key> <font> <latin|full> [axis,axis...]
With an axis list, the ranges cover only regions whose participating axes are all in the list (bands conservative
for animating just those axes, the others held at their defaults); output bands/<key>-<set>-<axes>.bin.
Per glyph (composites decomposed): points (default, i16), tags, lo/hi per coordinate as f32 where
  lo = base + sum_r min(0, delta_r) - 0.5,  hi = base + sum_r max(0, delta_r) + 0.5
(deltas IUP-expanded in float; region scalars are in [0, 1] inside the axis ranges; the 0.5 covers final rounding;
a composite point's range adds its component offset's range), plus K instances from fontTools.varLib.instancer at
the verify locations. Writes bands/<key>-<set>.bin.
"""
import sys, os, json, struct, zlib
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
import emit  # noqa: E402

OUT = os.path.join(HERE, '..', 'bands'); os.makedirs(OUT, exist_ok=True)


ALLOW = None


def ranges(data, g):
    m = data['models'][g]; base = np.array(V.base_coords(m), np.float64).reshape(-1, 2)
    lo = base.copy(); hi = base.copy(); per = []  # per tuple (region, dense deltas)
    for tup in data['tuples'][g]:
        if ALLOW is not None:
            reg = data['regions'][tup[0]]
            if any(a[1] and data['axes'][i][0] not in ALLOW for i, a in enumerate(reg)): continue
        d = np.array(V.dense(data, g, tup, rounding=False), np.float64).reshape(-1, 2)
        lo += np.minimum(d, 0); hi += np.maximum(d, 0); per.append((tup[0], d))
    return base, lo, hi, per


def signatures(n, parts):
    """parts: list of (region, (n, 2) deltas). Per point and axis: crc32 of its nonzero (region, delta) vector, so
    two points share a signature exactly when they move identically along that axis in every instance."""
    out = np.zeros((n, 2), np.uint32)
    for i in range(n):
        for a in (0, 1):
            acc = {}
            for r, d in parts:
                acc[r] = acc.get(r, 0.0) + float(d[i, a])
            out[i, a] = zlib.crc32(repr(sorted((r, round(v, 9)) for r, v in acc.items() if v != 0)).encode())
    return out


def main():
    global ALLOW
    key, path, which = sys.argv[1:4]
    suffix = ''
    if len(sys.argv) > 4: ALLOW = set(sys.argv[4].split(',')); suffix = '-' + sys.argv[4].replace(',', '+')
    data = V.load_tt(path, which)
    locs = emit.locations(key, data['axes'])
    refs = [V.reference_instance(path, which, l) for l in locs]
    G = len(data['names']); out = bytearray(struct.pack('<III', G, len(locs), data['upm']))
    R = {}
    for g in range(G):
        m = data['models'][g]
        if m[0] == 'simple':
            R[g] = ranges(data, g)
    for g in range(G):
        m = data['models'][g]
        if m[0] == 'empty':
            out += struct.pack('<II', 0, 0); continue
        if m[0] == 'simple':
            cs = [len(c) for c in m[1]]; tags = [t for c in m[1] for _, _, t in c]
            base, lo, hi, per = R[g]; sig = signatures(len(base), per)
        else:
            cb, clo, chi, cper = ranges(data, g)
            cs = []; tags = []; bl = []; ll = []; hl = []; sl = []
            for k, (gid, *_rest) in enumerate(m[1]):
                mm = data['models'][gid]
                if mm[0] != 'simple': continue
                cs += [len(c) for c in mm[1]]; tags += [t for c in mm[1] for _, _, t in c]
                b, l, h, per = R[gid]
                bl.append(b + cb[k]); ll.append(l + clo[k]); hl.append(h + chi[k])
                parts = per + [(r, np.repeat(d[k:k + 1], len(b), 0)) for r, d in cper]
                sl.append(signatures(len(b), parts))
            if not cs:
                out += struct.pack('<II', 0, 0); continue
            base, lo, hi, sig = np.concatenate(bl), np.concatenate(ll), np.concatenate(hl), np.concatenate(sl)
        n = len(tags)
        out += struct.pack('<II', n, len(cs)) + struct.pack(f'<{len(cs)}H', *cs) + bytes(tags)
        out += base.astype('<i2').tobytes() + (lo - 0.5).astype('<f4').tobytes() + (hi + 0.5).astype('<f4').tobytes()
        out += sig.astype('<u4').tobytes()
        for r in refs:
            p = np.array(r['decomposed'][g], np.int64).reshape(-1, 2)
            assert len(p) == n, (g, len(p), n)
            out += p.astype('<i2').tobytes()
    open(os.path.join(OUT, f'{key}-{which}{suffix}.bin'), 'wb').write(bytes(out))
    json.dump(locs, open(os.path.join(OUT, f'{key}-{which}{suffix}.json'), 'w'))
    print(key, which, G, len(out))


if __name__ == '__main__':
    main()
