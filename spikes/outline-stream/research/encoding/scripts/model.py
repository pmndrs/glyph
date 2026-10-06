"""Extract a font's outlines into one canonical integer point model, cached as pickle.

Glyph model:
  ('empty',)
  ('simple', contours)        contours: list[list[(x:int, y:int, t:int)]], t 0=on, 1=quadratic off, 2=cubic off
  ('composite', comps)        comps: list[(gid, dx, dy, transform_or_None)]  (glyf only, keep_components)

Modes:
  tt-keep     glyf points exactly as stored (implied on-curve points stay implied), components kept
  tt-dec      glyf points, composites decomposed (rounded)
  cff-cubic   CFF cubics as on/cubic-off points (coords rounded; fractional count reported)
  cff-q<tol>  CFF via cu2qu all_quadratic, max_err=tol units, off-curves rounded (implied on-curve points kept implied)

Usage as a module: load(font_path, unicodes_or_None, mode) -> (glyph_names, models, info)
"""
import os, pickle, hashlib
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.cu2quPen import Cu2QuPen

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache')
LATIN = 'U+0020-007E,U+00A0-00FF'


def open_font(path, unicodes):
    font = TTFont(path)
    if unicodes:
        opts = subset.Options(); opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        ranges = []
        for part in unicodes.replace('U+', '').split(','):
            a, _, b = part.partition('-'); ranges += range(int(a, 16), int(b or a, 16) + 1)
        sub.populate(unicodes=ranges); sub.subset(font)
    return font


def source_tables(font):
    tags = [t for t in ('glyf', 'loca', 'CFF ', 'CFF2') if t in font]
    return {t: font.getTableData(t) if t not in font.reader.tables or font.isLoaded(t) else font.reader[t] for t in tags}


def _rec_contours(ops, cubic_ok, stats, grid=1):
    contours = []; cur = None
    def pt(p, t):
        x, y = p[0] * grid, p[1] * grid
        if x != int(x) or y != int(y): stats['fractional'] += 1
        cur.append((int(round(x)), int(round(y)), t))
    for op, args in ops:
        if op == 'moveTo':
            cur = []; contours.append(cur); pt(args[0], 0)
        elif op == 'lineTo':
            pt(args[0], 0)
        elif op == 'curveTo':
            assert cubic_ok and len(args) == 3
            pt(args[0], 2); pt(args[1], 2); pt(args[2], 0)
        elif op == 'qCurveTo':
            for a in args[:-1]: pt(a, 1)
            if args[-1] is None:  # all-off contour
                continue
            pt(args[-1], 0)
        elif op in ('closePath', 'endPath'):
            # CFF closepath lines back to the start; drop a duplicated final on-curve point.
            if cur and len(cur) > 1 and cur[-1][2] == 0 and cur[-1][:2] == cur[0][:2]:
                cur.pop()
            cur = None
    return [c for c in contours if len(c) > 1]


def extract(font, mode):
    names = font.getGlyphOrder()
    models = []; stats = {'fractional': 0}
    if mode.startswith('tt'):
        glyf = font['glyf']
        for name in names:
            g = glyf[name]
            if g.numberOfContours == 0:
                models.append(('empty',)); continue
            if g.isComposite() and mode == 'tt-keep':
                comps = []
                for c in g.components:
                    tr = getattr(c, 'transform', None)
                    comps.append((font.getGlyphID(c.glyphName), c.x, c.y, tr if tr is not None else None))
                models.append(('composite', comps)); continue
            coords, ends, flags = g.getCoordinates(glyf)
            contours = []; start = 0
            for e in ends:
                contours.append([(int(round(coords[i][0])), int(round(coords[i][1])), 0 if flags[i] & 1 else 1) for i in range(start, e + 1)])
                start = e + 1
            models.append(('simple', contours) if contours else ('empty',))
    else:
        gs = font.getGlyphSet()
        # cff-q<tol>[x<grid>]: grid 2 stores every coordinate in half font units
        spec = mode[5:]
        grid = int(spec.split('x')[1]) if 'x' in spec else 1
        tol = None if mode == 'cff-cubic' else float(spec.split('x')[0])
        stats['grid'] = grid
        for name in names:
            rec = RecordingPen()
            if tol is None:
                gs[name].draw(rec)
            else:
                gs[name].draw(Cu2QuPen(rec, max_err=tol, reverse_direction=False, all_quadratic=True))
            contours = _rec_contours(rec.value, tol is None, stats, grid)
            models.append(('simple', contours) if contours else ('empty',))
    return names, models, stats


def load(path, unicodes, mode):
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f'{os.path.abspath(path)}|{unicodes}|{mode}|v2'.encode()).hexdigest()[:16]
    cp = os.path.join(CACHE, key + '.pkl')
    if os.path.exists(cp):
        with open(cp, 'rb') as f: return pickle.load(f)
    font = open_font(path, unicodes)
    out = extract(font, mode)
    with open(cp, 'wb') as f: pickle.dump(out, f)
    return out
