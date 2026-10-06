"""Copy of scratchpad/outline-cost/stream_estimate.py (the weak #244 prototype), unchanged except that it also\nreports brotli q11 and prints JSON. Usage: weak_baseline.py <font> [unicodes]"""
"""Encode a font's glyph outlines as a #244-style quadratic stream and report its size.

Per glyph: a contour index (u32 offset), per-contour end (u16 point count), line flags (1 bit per segment),
and points as i16 zigzag deltas packed in blocks of 16 with one bit-width byte per block. CFF cubics become
quadratics at bake time with cu2qu (tolerance 1 font unit), as #244 proposes.
"""
import gzip, struct, sys, json, brotli
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.basePen import BasePen

class QuadCollector(BasePen):
    def __init__(self, glyphSet):
        super().__init__(glyphSet); self.contours = []
    def _moveTo(self, p): self.contours.append([('M', p)])
    def _lineTo(self, p): self.contours[-1].append(('L', p))
    def _qCurveToOne(self, c, p): self.contours[-1].append(('Q', c, p))
    def _curveToOne(self, a, b, c): raise AssertionError('cubic left after cu2qu')
    def _closePath(self): pass
    def _endPath(self): pass

def zig(v): return (v << 1) ^ (v >> 31)

def pack(values):
    out = bytearray()
    for i in range(0, len(values), 16):
        block = values[i:i + 16]
        width = max((v.bit_length() for v in block), default=0)
        out.append(width)
        bits = 0; n = 0
        for v in block:
            bits |= v << n; n += width
        out += bits.to_bytes((n + 7) // 8, 'little')
    return bytes(out)

def encode(font, glyph_names, keep_components=False):
    gs = font.getGlyphSet()
    index = bytearray(); body = bytearray()
    for name in glyph_names:
        index += struct.pack('<I', len(body))
        glyf = font['glyf'] if keep_components and 'glyf' in font else None
        if glyf is not None and glyf[name].isComposite():
            # A component record: glyph id (u16), dx, dy (i16) per component, as glyf itself keeps them.
            comps = glyf[name].components
            body += struct.pack('<H', 0x8000 | len(comps))
            for c in comps: body += struct.pack('<Hhh', font.getGlyphID(c.glyphName), c.x, c.y)
            continue
        rec = QuadCollector(gs)
        pen = Cu2QuPen(rec, max_err=1.0, reverse_direction=False)
        dec = DecomposingRecordingPen(gs); gs[name].draw(dec); dec.replay(pen)
        ends = []; flags = []; deltas = []; last = (0, 0); count = 0
        for contour in rec.contours:
            for seg in contour:
                if seg[0] != 'M': flags.append(seg[0] == 'L')
                for p in seg[1:]:
                    x, y = round(p[0]), round(p[1])
                    deltas += [zig(x - last[0]), zig(y - last[1])]; last = (x, y); count += 1
            ends.append(count)
        body += struct.pack('<H', len(ends)) + b''.join(struct.pack('<H', e) for e in ends)
        body += bytes(sum(1 << i for i, f in enumerate(flags[j:j + 8]) if f) for j in range(0, len(flags), 8))
        body += pack(deltas)
    return bytes(index + body)

path, unicodes = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
font = TTFont(path)
if unicodes:
    opts = subset.Options(); opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    ranges = []
    for part in unicodes.replace('U+', '').split(','):
        a, _, b = part.partition('-'); ranges += range(int(a, 16), int(b or a, 16) + 1)
    sub.populate(unicodes=ranges); sub.subset(font)
names = font.getGlyphOrder()
tables = [t for t in ('glyf', 'loca', 'CFF ', 'CFF2') if t in font]
source = sum(len(font.reader[t]) if not unicodes else len(font.getTableData(t)) for t in tables)
stream = encode(font, names)
res = {'stream': [len(stream), len(gzip.compress(stream, 9)), len(brotli.compress(stream, quality=11, lgwin=24))]}
if 'glyf' in font:
    kept = encode(font, names, keep_components=True)
    res['stream_components'] = [len(kept), len(gzip.compress(kept, 9)), len(brotli.compress(kept, quality=11, lgwin=24))]
print(json.dumps(res))
