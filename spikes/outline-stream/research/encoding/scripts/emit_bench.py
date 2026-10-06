"""Write the two leading wire candidates for the JS decode benchmark, plus a decode reference.

Usage: emit_bench.py <key> <font> <mode>
  bench/<key>.varint.bin  planes: hdr | cn | comp | flags(bits) | xy (zigzag LEB128 deltas, x,y interleaved)
  bench/<key>.u16shuf.bin planes: hdr | cn | comp | flags(bits) | x lo | x hi | y lo | y hi (zigzag u16 deltas)
  bench/<key>.abs.bin     planes: offsets(u32 point,contour per glyph) | cn u16 | comp | flags(bits) | x i16 | y i16
  bench/<key>.json        plane lengths, counts, and a checksum of the fully expanded (decomposed) points
"""
import sys, os, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, model as M, enc as E

key, path, mode = sys.argv[1:4]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench'); os.makedirs(OUT, exist_ok=True)
names, models, _ = M.load(path, None, mode)
f = E.Flat(models)
dx = E.pred_prev(f, f.x); dy = E.pred_prev(f, f.y)
common = [('hdr', E.varint(f.hdr)), ('cn', E.varint(f.cn)), ('comp', E.comps_bytes(f.comps)), ('flags', E.flags_plane(f, True))]
v = common + [('xy', E.varint(E.zig(np.stack([dx, dy], 1).reshape(-1))))]
zx = E.zig(dx).astype('<u2'); zy = E.zig(dy).astype('<u2')
assert int(E.zig(dx).max(initial=0)) < 65536 and int(E.zig(dy).max(initial=0)) < 65536
s = common + [('xlo', (zx & 0xff).astype(np.uint8).tobytes()), ('xhi', (zx >> 8).astype(np.uint8).tobytes()),
              ('ylo', (zy & 0xff).astype(np.uint8).tobytes()), ('yhi', (zy >> 8).astype(np.uint8).tobytes())]
a = [('offsets', E.gpu_offsets(f)), ('cn', f.cn.astype('<u2').tobytes()), ('comp', E.comps_bytes(f.comps)),
     ('flags', E.flags_plane(f, True)), ('x', E.i16(f.x)), ('y', E.i16(f.y))]

# reference: fully decomposed absolute points per glyph (recursive component expansion, x,y as i16)
gpts = {}
def expand(g):
    if g in gpts: return gpts[g]
    m = models[g]
    if m[0] == 'empty': r = np.zeros((0, 2), np.int64)
    elif m[0] == 'simple': r = np.array([(x, y) for c in m[1] for x, y, _ in c], np.int64).reshape(-1, 2)
    else:
        parts = []
        for gid, ox, oy, tr in m[1]:
            p = expand(gid).astype(np.float64)
            if tr is not None:
                t = np.array([[round(v * 16384) / 16384 for v in row] for row in tr])
                p = np.round(p @ t)
            parts.append(p.astype(np.int64) + [ox, oy])
        r = np.concatenate(parts) if parts else np.zeros((0, 2), np.int64)
    gpts[g] = r; return r
allp = np.concatenate([expand(g) for g in range(len(models))])
meta = dict(glyphs=len(f.hdr), contours=int(len(f.cn)), points=f.points, cubic=f.cubic,
            expandedPoints=int(len(allp)), expandedSum=int(allp.sum()), expandedCrc=zlib.crc32(allp.astype('<i2').tobytes()))
t = list(E.triplets(f).items())
for tag, planes in (('varint', v), ('u16shuf', s), ('abs', a), ('triplet', t)):
    open(os.path.join(OUT, f'{key}.{tag}.bin'), 'wb').write(b''.join(p for _, p in planes))
    meta[tag] = [[n, len(p)] for n, p in planes]
json.dump(meta, open(os.path.join(OUT, f'{key}.json'), 'w'))
print(key, {k: meta[k] for k in ('glyphs', 'contours', 'points', 'expandedPoints')})
