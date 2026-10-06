"""Band data sizes per strategy: raw, gzip -9 and brotli q11 (lgwin 24) of each table bandcheck --bytes wrote.

Usage: sizes.py <bytes dir root> <out dir> <key-set> [...] [--only <table>]   writes <out dir>/sizes-<key-set>.json
       (--only: one table, written to sizes-<key-set>.<table>.json; merge.py-free: report_tables.py merges them)
Tables over 100 MB (CJK named-all and peaks-all) are compressed at brotli q9 (lgwin 24) instead of q11, for time;
the JSON records the quality used.
Tables (per glyph: 32 u32 band headers (count << 16 | offset) then u16 references, as Slug V0 packs them; glyph
records and curve data are excluded because they are the same for every strategy):
  static-default   bands of the default instance (what a static bake ships today)
  cons-<spec>      bands conservative over a spec (all, wght, wght+wdth, or one wght cell); = 5(c) candidate lists
  named-all        exact bands at every fvar named instance; peaks-all: at every region peak plus the default
  5a-<spec>        per curve 4 x i16 conservative box + per axis a u16 order pre-sorted by conservative key
  keys-<spec>      per curve 2 x i16 conservative keys a key-exit shader would read
  5b-linear        per glyph u8 region count + u8 ids, per curve per glyph region 4 x i16 hull-delta bounds
"""
import sys, os, json, gzip
import brotli


def sz(b):
    q = 11 if len(b) <= 100_000_000 else 9
    return dict(raw=len(b), gzip=len(gzip.compress(b, 9)), brotli=len(brotli.compress(b, quality=q, lgwin=24)), brotli_q=q)


def main():
    args = sys.argv[1:]
    only = None
    if '--only' in args:
        i = args.index('--only'); only = args[i + 1]; del args[i:i + 2]
    root, out = args[:2]
    for ks in args[2:]:
        res = {}
        d = os.path.join(root, ks)
        for fn in sorted(os.listdir(d)):
            if only is not None and fn[:-4] != only:
                continue
            res[fn[:-4]] = sz(open(os.path.join(d, fn), 'rb').read())
        cells = [v for k, v in res.items() if k.startswith('cons-cell')]
        if cells:
            res['cons-cells-sum'] = {k: sum(c[k] for c in cells) for k in ('raw', 'gzip', 'brotli')}
            res['cons-cells-count'] = len(cells)
        print(ks)
        for k, v in res.items():
            if isinstance(v, dict):
                print(f'  {k:18} raw {v["raw"] / 1e3:10.1f} KB  gzip {v["gzip"] / 1e3:9.1f} KB  brotli {v["brotli"] / 1e3:9.1f} KB')
        json.dump(res, open(os.path.join(out, f'sizes-{ks}{"." + only if only else ""}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
