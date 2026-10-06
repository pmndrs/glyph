"""Q7: variation tables that shaping/metrics need (not the outline stream), sizes per fixture.

Usage: vtables.py <font> <latin|full>
Sizes of each compiled table (raw / gzip -9 / brotli q11), plus the parts that exist only for variation:
GDEF ItemVariationStore (GDEF compiled with and without it), GSUB/GPOS FeatureVariations, and the count of
VariationIndex device tables in GPOS/GDEF (deltas for anchors, kerning and caret positions in the GDEF store).
The Latin set keeps every layout feature (layout_features '*').
"""
import sys, io, gzip, copy
import brotli
from fontTools.ttLib import TTFont
from fontTools import subset

def sz(b): return (len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24)))

path, which = sys.argv[1:3]
font = TTFont(path)
if which == 'latin':
    o = subset.Options(); o.layout_features = ['*']; o.notdef_outline = True; o.name_IDs = ['*']; o.hinting = True
    s = subset.Subsetter(o)
    r = []
    for part in 'U+0020-007E,U+00A0-00FF'.replace('U+', '').split(','):
        a, _, b = part.partition('-'); r += range(int(a, 16), int(b or a, 16) + 1)
    s.populate(unicodes=r); s.subset(font)
bio = io.BytesIO(); font.save(bio); bio.seek(0); font = TTFont(bio)
rows = []
for tag in ('fvar', 'avar', 'STAT', 'HVAR', 'VVAR', 'MVAR', 'GDEF', 'GSUB', 'GPOS', 'cvar', 'gvar', 'CFF2', 'glyf'):
    if tag in font: rows.append((tag, sz(font.getTableData(tag))))
def without(tag, fn):
    f2 = TTFont(io.BytesIO(bio.getvalue()))
    t = f2[tag]; fn(t.table)
    return sz(t.compile(f2))
if 'GDEF' in font and getattr(font['GDEF'].table, 'VarStore', None) is not None:
    full = sz(font.getTableData('GDEF'))
    def drop(t): t.VarStore = None
    w = without('GDEF', drop)
    rows.append(('GDEF ItemVariationStore (GDEF minus GDEF without it)', tuple(a - b for a, b in zip(full, w))))
    vs = font['GDEF'].table.VarStore
    rows.append((f'  GDEF store: {len(vs.VarRegionList.Region)} regions, {len(vs.VarData)} VarData, {sum(v.ItemCount for v in vs.VarData)} delta rows', None))
for tag in ('GSUB', 'GPOS'):
    if tag in font and getattr(font[tag].table, 'FeatureVariations', None) is not None:
        full = sz(font.getTableData(tag))
        def drop(t): t.FeatureVariations = None; t.Version = 0x00010000
        w = without(tag, drop)
        fv = font[tag].table.FeatureVariations
        rows.append((f'{tag} FeatureVariations ({fv.FeatureVariationCount} records)', tuple(a - b for a, b in zip(full, w))))
# VariationIndex device tables
def count_dev(table):
    n = 0; seen = set()
    def walk(o):
        nonlocal n
        if id(o) in seen: return
        seen.add(id(o))
        if type(o).__name__ == 'Device' and getattr(o, 'DeltaFormat', 0) == 0x8000: n += 1; return
        if isinstance(o, list):
            for x in o: walk(x)
        elif hasattr(o, '__dict__'):
            for k, v in vars(o).items():
                if k.startswith('_'): continue
                if isinstance(v, (list,)) or hasattr(v, '__dict__'): walk(v)
    walk(table); return n
for tag in ('GPOS', 'GDEF'):
    if tag in font: rows.append((f'{tag} VariationIndex device tables: {count_dev(font[tag].table)}', None))
total = [0, 0, 0]
print(f'### {path.split("/")[-1]} {which}: glyphs {font["maxp"].numGlyphs}')
print('| Table | Raw B | gzip B | brotli B |\n| --- | ---: | ---: | ---: |')
for k, v in rows:
    if v is None: print(f'| {k} | | | |'); continue
    print(f'| {k} | {v[0]} | {v[1]} | {v[2]} |')
