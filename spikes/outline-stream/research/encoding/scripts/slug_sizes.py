"""Measure a split Slug raster GLB: per section raw / gzip -9 / brotli q11, plus used (unpadded) texels.

Usage: slug_sizes.py <name.slug.glb> [...]
Record layout (40 B): i16 plane l,b,r,t; u16 page,hBands,vBands,flags; u32 curveBase,curveSpan,hHeader,vHeader,refBase,refCount.
Curve page: RGBA16F texel = (p0.x,p0.y,p1.x,p1.y) per curve, plus one (p2.x,p2.y,0,0) end texel per contour, em-normalized.
"""
import json, struct, sys, gzip, brotli

def gz(b): return len(gzip.compress(b, 9))
def br(b): return len(brotli.compress(b, quality=11))

def parse(path):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    bin_off = 20 + jl + 8
    views = [b[bin_off + v.get('byteOffset', 0): bin_off + v.get('byteOffset', 0) + v['byteLength']] for v in j['bufferViews']]
    return b, j, views

def main():
    for path in sys.argv[1:]:
        b, j, views = parse(path)
        ext = j['extensions']['PMNDRS_font_slug']
        rec = views[ext['recordBufferView']]
        n = len(rec) // 40
        recs = [struct.unpack_from('<4h4H6I', rec, i * 40) for i in range(n)]
        present = [r for r in recs if r[4] != 0xffff]
        used_curve_texels = sum(r[9] for r in present)
        used_refs = sum(r[13] for r in present)
        used_headers = sum(r[5] + r[6] for r in present)
        kinds = {'record': bytearray(), 'curve': bytearray(), 'header': bytearray(), 'reference': bytearray()}
        kinds['record'] += rec
        for p in ext['pages']:
            kinds['curve'] += views[p['curve']['variants'][0]['source']['bufferView']]
            kinds['header'] += views[p['headerResource']['source']['bufferView']]
            kinds['reference'] += views[p['referenceResource']['source']['bufferView']]
        print(f"{path.split('/')[-1]}: glyphs={n} present={len(present)} pages={len(ext['pages'])} file={len(b)} file_gz={gz(b)} file_br={br(b)}")
        print(f"  used: curve_texels={used_curve_texels} ({used_curve_texels*8} B) headers={used_headers} ({used_headers*4} B) refs={used_refs} ({used_refs*2} B) records={n*40} B  -> unpadded total={used_curve_texels*8+used_headers*4+used_refs*2+n*40}")
        for k, v in kinds.items():
            print(f"  {k:9s} raw={len(v):9d} gz={gz(bytes(v)):8d} br={br(bytes(v)):8d}")

main()
