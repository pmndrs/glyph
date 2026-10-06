"""Dehinted CFF2 table size only (for fonts too large for cff2_cubic.py). Usage: cff2_dehint.py <font.otf>"""
import sys, io, gzip, brotli
from fontTools.ttLib import TTFont
from fontTools import subset
f = TTFont(sys.argv[1]); o = subset.Options(); o.hinting = False; o.notdef_outline = True; o.layout_features = ['*']; o.name_IDs = ['*']; o.glyph_names = True
s = subset.Subsetter(o); s.populate(glyphs=f.getGlyphOrder()); s.subset(f)
bio = io.BytesIO(); f.save(bio); bio.seek(0); b = TTFont(bio).getTableData('CFF2')
print('CFF2 dehinted', len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24)))
