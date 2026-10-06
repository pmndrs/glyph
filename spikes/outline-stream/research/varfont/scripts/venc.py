"""Delta-stream encoders for gvar-style tuples aligned to the base stream's point order (glyf order, composites
kept: a composite's 'points' are its component offsets). Phantom points are excluded (HVAR/VVAR carry metrics).

layout:  'region'  per region r: glyph presence bitmap (G bits), then each present glyph's tuple
         'glyph'   per glyph: varint tuple count, varint region ids, then the tuples
mode:    'dense'   IUP expanded at bake, rounded to integers, every point carries a delta
         'sparse'  explicit deltas only (IUP at load); point set per tuple: 0 = all points, else coded by `pts`
value coders (on the concatenated (dx, dy) sequence of every tuple in plane order):
  trip    WOFF2 triplet coding, flag byte (bit 7 unused) + 1-4 data bytes
  tripz   triplet coding with flag 0x80 = (0, 0) and no data bytes
  varint  zigzag LEB128, x and y interleaved
  split   zigzag LEB128, x plane then y plane
  i8esc   i8 per coordinate with -128 escape into an i16 plane, x and y planes
  gvar    the gvar packed-delta runs (fontTools compileDeltaValues_), x run then y run per tuple
pred:    'raw' or 'prev' (difference from the previous delta of the same tuple)
"""
import os, sys, struct
from collections import OrderedDict
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'outline-encoding', 'scripts'))
import enc as E  # noqa: E402
import vmodel as V  # noqa: E402
from fontTools.ttLib.tables.TupleVariation import TupleVariation  # noqa: E402


def trip_pair(x, y, fl, data, zero_flag):
    ax, ay = abs(x), abs(y); sx = int(x < 0); sy = int(y < 0)
    if zero_flag and x == 0 and y == 0:
        fl.append(0x80); return
    if x == 0 and ay < 1280:
        fl.append(((ay >> 8) << 1) | sy); data.append(ay & 255)
    elif y == 0 and ax < 1280:
        fl.append(10 + (((ax >> 8) << 1) | sx)); data.append(ax & 255)
    elif 1 <= ax <= 64 and 1 <= ay <= 64:
        a, b = ax - 1, ay - 1
        fl.append(20 + ((a >> 4) << 4) + ((b >> 4) << 2) + (sx << 1 | sy)); data.append(((a & 15) << 4) | (b & 15))
    elif 1 <= ax <= 768 and 1 <= ay <= 768:
        a, b = ax - 1, ay - 1
        fl.append(84 + 12 * (a >> 8) + ((b >> 8) << 2) + (sx << 1 | sy)); data += bytes([a & 255, b & 255])
    elif ax < 4096 and ay < 4096:
        fl.append(120 + (sx << 1 | sy)); data += bytes([ax >> 4, ((ax & 15) << 4) | (ay >> 8), ay & 255])
    else:
        assert ax < 65536 and ay < 65536
        fl.append(124 + (sx << 1 | sy)); data += struct.pack('>HH', ax, ay)


def code_values(seqs, coder):
    """seqs: list of lists of (dx, dy) ints (one per tuple). Returns OrderedDict of planes."""
    o = OrderedDict()
    flat = [p for s in seqs for p in s]
    if coder in ('trip', 'tripz'):
        fl = bytearray(); data = bytearray()
        for x, y in flat: trip_pair(x, y, fl, data, coder == 'tripz')
        o['dflags'] = bytes(fl); o['ddata'] = bytes(data)
    elif coder == 'varint':
        a = np.array(flat, np.int64).reshape(-1)
        o['dxy'] = E.varint(E.zig(a))
    elif coder == 'split':
        a = np.array(flat, np.int64).reshape(-1, 2)
        o['dx'] = E.varint(E.zig(a[:, 0])); o['dy'] = E.varint(E.zig(a[:, 1]))
    elif coder == 'i8esc':
        a = np.array(flat, np.int64).reshape(-1, 2)
        for k, nm in ((0, 'x'), (1, 'y')):
            d = a[:, k]; small = (d >= -127) & (d <= 127)
            o['d' + nm] = np.where(small, d, -128).astype(np.int8).tobytes(); o['d' + nm + 'esc'] = E.i16(d[~small])
    elif coder == 'gvar':
        b = bytearray()
        for s in seqs:
            if not s: continue
            b += TupleVariation.compileDeltaValues_([p[0] for p in s]) + TupleVariation.compileDeltaValues_([p[1] for p in s])
        o['dgvar'] = bytes(b)
    else:
        raise ValueError(coder)
    return o


def predict(seq, pred):
    if pred == 'raw' or not seq: return seq
    out = [seq[0]]
    for (a, b), (c, d) in zip(seq[1:], seq[:-1]): out.append((a - c, b - d))
    return out


def point_set(d, pts):
    """d: list with None for untouched. Returns bytes for the explicit point set (0 = all points)."""
    idx = [i for i, v in enumerate(d) if v is not None]
    if len(idx) == len(d): return E.varint([0])
    if pts == 'gaps':
        gaps = [idx[0]] + [b - a - 1 for a, b in zip(idx, idx[1:])]
        return E.varint([len(idx)]) + E.varint(gaps)
    if pts == 'bitmap':
        return E.varint([1]) + np.packbits(np.array([v is not None for v in d], np.uint8), bitorder='little').tobytes()
    if pts == 'gvar':
        return TupleVariation.compilePoints(set(idx))
    raise ValueError(pts)


def delta_streams(data, mode='dense', layout='region', coder='tripz', pred='raw', pts='gaps', regions=None):
    """Returns OrderedDict planes of the whole delta stream (structure + point sets + values)."""
    G = len(data['names'])
    per_glyph = []  # per glyph list of (region, values, pointset_bytes)
    for g in range(G):
        lst = []
        for tup in data['tuples'][g]:
            if regions is not None and tup[0] not in regions: continue
            if mode == 'dense':
                memo = data.setdefault('_dense', {})
                k = (g, id(tup))
                if k not in memo: memo[k] = V.dense(data, g, tup)
                vals = memo[k]; ps = b''
            else:
                vals = [v for v in tup[1] if v is not None]; ps = point_set(tup[1], pts)
            lst.append((tup[0], predict(vals, pred), ps))
        per_glyph.append(lst)
    o = OrderedDict(); seqs = []; psets = bytearray()
    if layout == 'region':
        R = len(data['regions']); pres = bytearray()
        for r in range(R):
            bits = np.zeros(G, np.uint8)
            for g in range(G):
                for (rr, vals, ps) in per_glyph[g]:
                    if rr == r: bits[g] = 1; seqs.append(vals); psets += ps
            pres += np.packbits(bits, bitorder='little').tobytes()
        o['presence'] = bytes(pres)
    else:
        cnt = []; rid = []
        for g in range(G):
            cnt.append(len(per_glyph[g]))
            for (rr, vals, ps) in per_glyph[g]:
                rid.append(rr); seqs.append(vals); psets += ps
        o['tcount'] = E.varint(cnt); o['rid'] = E.varint(rid)
    if mode == 'sparse': o['points'] = bytes(psets)
    o.update(code_values(seqs, coder))
    return o


def region_table(data):
    """count, then per region: varint axis mask, flag byte intermediate, peaks i16 (+ lo, hi when intermediate)."""
    b = bytearray(E.varint([len(data['regions'])]))
    for reg in data['regions']:
        mask = sum(1 << i for i, a in enumerate(reg) if a[1])
        inter = any(lo != min(pk, 0) or hi != max(pk, 0) for lo, pk, hi in reg if pk)
        b += E.varint([mask]); b.append(int(inter))
        for lo, pk, hi in reg:
            if not pk: continue
            b += struct.pack('<h', pk)
            if inter: b += struct.pack('<hh', lo, hi)
    return bytes(b)


def axis_table(data):
    """per axis: tag, min/default/max as 16.16; avar: per axis pair count + F2Dot14 pairs."""
    b = bytearray(E.varint([len(data['axes'])]))
    for tag, mn, df, mx in data['axes']:
        b += tag.encode('ascii') + struct.pack('<3i', *(int(round(v * 65536)) for v in (mn, df, mx)))
    for tag, *_ in data['axes']:
        seg = data['avar'].get(tag, [])
        b += E.varint([len(seg)])
        for a, c in seg: b += struct.pack('<hh', V.f2(a), V.f2(c))
    return bytes(b)


def phantom_stream(data):
    seqs = []
    for g, lst in enumerate(data['phantom']):
        for r, c in lst:
            seqs.append([(0, 0) if v is None else (int(v[0]), int(v[1])) for v in c])
    return code_values(seqs, 'tripz')
