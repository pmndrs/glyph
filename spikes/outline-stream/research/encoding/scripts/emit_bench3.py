"""Write decoder benchmark inputs for bench3.mjs (Wasm decoders vs the shipped shaper decoder).

Usage: emit_bench3.py <key> <font> <mode>     (mode: tt-dec or cff-q1; decomposed so every format applies)
  bench3/<key>.<fmt>.bin  + bench3/<key>.json (plane offsets per format, counts, reference checksums)
"""
import sys, os, json, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, model as M, enc as E, enc3 as E3

key, path, mode = sys.argv[1:4]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bench3'); os.makedirs(OUT, exist_ok=True)
names, models, _ = M.load(path, None, mode)
f = E.Flat(models)
assert not f.comps
fmts = {
    'varint': E.planes(f, xy='interleave'),
    'triplet': E.triplets(f),
    'bp16': E3.bp16(f, True),
}
fmts['varint']['flags'] = E.bits((f.t != 0).astype(np.uint8), 1)
meta = dict(glyphs=len(f.hdr), contours=int(len(f.cn)), points=f.points, upm=int(__import__('fontTools.ttLib', fromlist=['TTFont']).TTFont(path)['head'].unitsPerEm),
            sumX=int(f.x.sum()), sumY=int(f.y.sum()), crc=zlib.crc32(np.stack([f.x, f.y], 1).astype('<i2').tobytes()),
            onCurve=int((f.t == 0).sum()), font=os.path.abspath(path), mode=mode)
for name, planes in fmts.items():
    off = 0; layout = {}
    blob = bytearray()
    for k, v in planes.items():
        while len(blob) % 8: blob.append(0)  # 8-byte align each plane (u64 flags, u16 arrays)
        layout[k] = [len(blob), len(v)]; blob += v
    open(os.path.join(OUT, f'{key}.{name}.bin'), 'wb').write(bytes(blob))
    meta[name] = layout
json.dump(meta, open(os.path.join(OUT, f'{key}.json'), 'w'))
print(key, mode, {k: meta[k] for k in ('glyphs', 'contours', 'points')})
