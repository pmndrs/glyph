"""Print the report's Markdown tables from out/ and logs/. Usage: report_tables.py <section>
sections: sizes timing verify cff2 gpu"""
import sys, os, json, glob
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'out')
SETS = ['inter-latin', 'inter-full', 'flex-latin', 'flex-full']
NAMES = {'inter-latin': 'Inter 4.001, Latin', 'inter-full': 'Inter 4.001, full', 'flex-latin': 'Roboto Flex 3.200, Latin',
         'flex-full': 'Roboto Flex 3.200, full'}
kb = lambda v: '—' if v is None else f'{v / 1000:.1f}'


def sizes():
    for ks in SETS:
        d = json.load(open(os.path.join(OUT, f'sizes-{ks}.json')))
        R = {r['label']: r['sizes'] for r in d['rows']}
        pick = [
            ('font gvar table', 'Font `gvar`'), ('font glyf+loca', 'Font `glyf`+`loca`'),
            ('font gvar+glyf+loca', 'Font `gvar`+`glyf`+`loca`'),
            ('WOFF2 glyf transform stream (with hinting)', 'WOFF2 `glyf` transform stream'),
            ('WOFF2 file, whole variable font (fontTools, glyf transform, brotli inside)', 'WOFF2 file, whole variable font'),
            ('font fvar', 'Font `fvar`'), ('font avar', 'Font `avar`'),
            ('base stream: triplets, composites kept', '**Base stream** (triplets, composites kept)'),
            ('region table', 'Region table'), ('axis table (fvar triples + avar maps)', 'Axis table (fvar triples + avar maps)'),
            ('deltas dense, region-major, tripz, raw', 'Deltas (a) dense, triplets, no prediction'),
            ('deltas dense, region-major, tripz, prev', '**Deltas (a) dense, triplets, prev**'),
            ('deltas dense, region-major, varint, prev', 'Deltas (a) dense, varint, prev'),
            ('deltas dense, region-major, i8esc, prev', 'Deltas (a) dense, i8+escape, prev'),
            ('deltas dense, region-major, gvar, raw', 'Deltas (a) dense, gvar packed runs'),
            ('deltas dense, glyph-major, tripz, prev', 'Deltas (a) dense, triplets, prev, glyph-major'),
            ('deltas sparse, region-major, tripz, raw', 'Deltas (b) sparse, triplets, no prediction'),
            ('deltas sparse, region-major, tripz, prev', '**Deltas (b) sparse, triplets, prev**'),
            ('deltas sparse, region-major, varint, prev', 'Deltas (b) sparse, varint, prev'),
            ('deltas sparse, region-major, i8esc, prev', 'Deltas (b) sparse, i8+escape, prev'),
            ('deltas sparse, region-major, gvar, raw', 'Deltas (b) sparse, gvar packed runs'),
            ('deltas sparse, glyph-major, tripz, prev', 'Deltas (b) sparse, triplets, prev, glyph-major (benchmarked layout)'),
            ('deltas sparse, region-major, tripz, raw, point sets as bitmap', 'Deltas (b), point sets as bitmaps (no prediction)'),
            ('deltas sparse, region-major, tripz, raw, point sets as gvar', 'Deltas (b), point sets as gvar packed points (no prediction)'),
        ]
        reopt = [k for k in R if k.startswith('deltas sparse re-optimized') and k.endswith('prev')]
        pick += [(reopt[0], 'Deltas, IUP re-optimized at tolerance 0.5 (lossy), triplets, prev')] if reopt else []
        pick += [('phantom-point deltas (dropped; HVAR carries metrics)', 'Phantom-point deltas (dropped, HVAR carries metrics)')]
        print(f'#### {NAMES[ks]}\n\n| Stream | Raw KB | gzip KB | brotli KB |\n| --- | ---: | ---: | ---: |')
        for k, lab in pick:
            if k not in R: continue
            a, b, c = R[k]; print(f'| {lab} | {kb(a)} | {kb(b)} | {kb(c)} |')
        # totals
        def tot(dk):
            parts = [R['base stream: triplets, composites kept'], R['region table'], R['axis table (fvar triples + avar maps)'], R[dk]]
            return [sum(p[i] for p in parts) for i in range(3)]
        gg = R['font gvar+glyf+loca']; w = R['WOFF2 file, whole variable font (fontTools, glyf transform, brotli inside)'][2]
        for dk, lab in (('deltas dense, region-major, tripz, prev', 'dense'), ('deltas sparse, region-major, tripz, prev', 'sparse')):
            t = tot(dk)
            print(f'| **Total ours, {lab}** (base + regions + axes + deltas, each compressed separately) | {kb(t[0])} | {kb(t[1])} | {kb(t[2])} |')
        t = tot('deltas sparse, region-major, tripz, prev'); dd = R['deltas sparse, region-major, tripz, prev']
        gv = R['font gvar table']
        print(f'\nSparse total vs `gvar`+`glyf`+`loca`: {t[1]/gg[1]:.0%} gzip, {t[2]/gg[2]:.0%} brotli. Sparse deltas vs `gvar`: '
              f'{dd[1]/gv[1]:.0%} gzip, {dd[2]/gv[2]:.0%} brotli. Deltas are {dd[2]/t[2]:.0%} of our brotli total. '
              f'WOFF2 file (whole font, every table): {kb(w)} KB.\n')


TIMING_ROWS = [
    ('base structure + components', 'Base: structure + components'),
    ('base triplets (scalar code)', 'Base: triplets'),
    ('unify to var points', 'Base: lay out var points'),
    ('dense delta structure', 'Deltas (a): tuple headers'),
    ('dense delta triplets (scalar code)', 'Deltas (a): triplets'),
    ('sparse delta structure', 'Deltas (b): tuple headers + point sets'),
    ('sparse delta triplets (scalar code)', 'Deltas (b): triplets'),
    ('sparse IUP at load, to f32', 'Deltas (b): IUP at load, to f32'),
    ('sparse IUP at load, to f64', 'Deltas (b): IUP at load, to f64'),
    ('normalize + region scalars', 'Instance: normalize + region scalars'),
    ('instance whole font, dense i16, f32 scalar', 'Instance (a) i16 deltas, f32'),
    ('instance whole font, dense i16, f64 scalar', 'Instance (a) i16 deltas, f64'),
    ('instance whole font, sparse, IUP at load to f32, f32 scalar', 'Instance (b) f32 deltas, f32'),
    ('instance whole font, sparse, IUP at load to f64, f64 scalar', 'Instance (b) f64 deltas, f64 (exact)'),
    ('instance glyph by glyph (one call per glyph), dense i16, f32 scalar', 'Instance (a) f32, one call per glyph'),
    ('expand composites', 'Expand composites'),
    ('ink bounds (scalar code)', 'Ink bounds'),
]
SIMD_ROWS = {
    'base triplets (scalar code)': ['base triplets (SIMD v1: scalar gathers)', 'base triplets (SIMD v2: swizzle window)', 'base triplets (SIMD v2: swizzle window + global prefix)'],
    'dense delta triplets (scalar code)': ['dense delta triplets (SIMD v1: scalar gathers)', 'dense delta triplets (SIMD v2: swizzle window)', 'dense delta triplets (SIMD v2: swizzle window + global prefix)'],
    'sparse delta triplets (scalar code)': ['sparse delta triplets (SIMD v1: scalar gathers)', 'sparse delta triplets (SIMD v2: swizzle window)', 'sparse delta triplets (SIMD v2: swizzle window + global prefix)'],
    'instance whole font, dense i16, f32 scalar': ['instance whole font, dense i16, f32 SIMD'],
    'instance whole font, dense i16, f64 scalar': ['instance whole font, dense i16, f64x2 SIMD'],
    'instance whole font, sparse, IUP at load to f32, f32 scalar': ['instance whole font, sparse, IUP at load to f32, f32 SIMD'],
    'instance whole font, sparse, IUP at load to f64, f64 scalar': ['instance whole font, sparse, IUP at load to f64, f64x2 SIMD'],
    'instance glyph by glyph (one call per glyph), dense i16, f32 scalar': ['instance glyph by glyph (one call per glyph), dense i16, f32 SIMD'],
    'ink bounds (scalar code)': ['ink bounds (SIMD code)'],
}


def timing(sets=None):
    for ks in sets or SETS + sorted(os.path.basename(p)[6:-5] for p in glob.glob(os.path.join(OUT, 'bench-serif-*.json')) + glob.glob(os.path.join(OUT, 'bench-cjk-*.json'))):
        p = os.path.join(OUT, f'bench-{ks}.json')
        if not os.path.exists(p): continue
        d = json.load(open(p)); T = d['timings']; G = d['glyphs']
        print(f"#### {NAMES.get(ks, ks)}: {G} glyphs, {d['varpoints']} var points, {d['tuples']} tuples, {d['slots_dense']} dense / "
              f"{d['slots_sparse']} sparse delta slots; timed location has {d['active_regions_at_timed_location']} of {d['regions']} regions active\n")
        print('| Step | Scalar build: per font ms | per glyph µs | per 1,000 glyphs ms | SIMD build, best SIMD code: per font ms | per glyph µs | SIMD code used | SIMD speedup |')
        print('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |')
        for k, lab in TIMING_ROWS:
            sv = T.get(f'scalar: {k}')
            if sv is None: continue
            simd = [(T[f'simd: {s}'], s) for s in SIMD_ROWS.get(k, []) if f'simd: {s}' in T]
            if simd:
                bv, bn = min(simd); code = bn.split('(')[-1].rstrip(')') if '(' in bn else bn.split(', ')[-1]
            else:
                bv, code = T.get(f'simd: {k}'), 'scalar code, +simd128 build'
            print(f'| {lab} | {sv:.3f} | {sv*1000/G:.3f} | {sv*1000/G:.3f} | {bv:.3f} | {bv*1000/G:.3f} | {code} | {sv/bv:.2f}× |')
        # end to end
        def s(b, k): return T[f'{b}: {k}']
        load_sc = s('scalar', 'base structure + components') + s('scalar', 'base triplets (scalar code)') + s('scalar', 'unify to var points')
        best_base = min(T[f'simd: {x}'] for x in SIMD_ROWS['base triplets (scalar code)'])
        load_si = s('simd', 'base structure + components') + best_base + s('simd', 'unify to var points')
        for mode in ('dense', 'sparse'):
            dl_sc = s('scalar', f'{mode} delta structure') + s('scalar', f'{mode} delta triplets (scalar code)')
            dl_si = s('simd', f'{mode} delta structure') + min(T[f'simd: {x}'] for x in SIMD_ROWS[f'{mode} delta triplets (scalar code)'])
            if mode == 'sparse':
                dl_sc += s('scalar', 'sparse IUP at load, to f64'); dl_si += s('simd', 'sparse IUP at load, to f64')
                i_sc = s('scalar', 'instance whole font, sparse, IUP at load to f64, f64 scalar')
                i_si = s('simd', 'instance whole font, sparse, IUP at load to f64, f64x2 SIMD')
            else:
                i_sc = s('scalar', 'instance whole font, dense i16, f32 scalar'); i_si = s('simd', 'instance whole font, dense i16, f32 SIMD')
            ex_sc = s('scalar', 'expand composites') + s('scalar', 'ink bounds (scalar code)')
            ex_si = s('simd', 'expand composites') + min(s('simd', 'ink bounds (scalar code)'), s('simd', 'ink bounds (SIMD code)'))
            print(f"| **Decode + instance, {'(a) dense, f32' if mode == 'dense' else '(b) sparse, IUP at load, f64 exact'}** (sum of the steps above, + expand + bounds) | "
                  f"{load_sc + dl_sc + i_sc + ex_sc:.3f} | {(load_sc + dl_sc + i_sc + ex_sc)*1000/G:.3f} | {(load_sc + dl_sc + i_sc + ex_sc)*1000/G:.3f} | "
                  f"{load_si + dl_si + i_si + ex_si:.3f} | {(load_si + dl_si + i_si + ex_si)*1000/G:.3f} | best of each | {(load_sc + dl_sc + i_sc + ex_sc)/(load_si + dl_si + i_si + ex_si):.2f}× |")
            print(f"| Re-instance only, {mode} (instance + expand + bounds, data resident) | {i_sc + ex_sc:.3f} | {(i_sc + ex_sc)*1000/G:.3f} | {(i_sc + ex_sc)*1000/G:.3f} | "
                  f"{i_si + ex_si:.3f} | {(i_si + ex_si)*1000/G:.3f} | | {(i_sc + ex_sc)/(i_si + ex_si):.2f}× |")
        print()


def verify():
    print('| Font, set | Locations | Variant | Own coords mismatched (max) | Decomposed coords mismatched (max) | Ink-bounds mismatches | Exact locations |')
    print('| --- | ---: | --- | ---: | ---: | ---: | ---: |')
    for ks in SETS:
        rows = json.load(open(os.path.join(OUT, f'verify-{ks}.json')))
        agg = {}
        for r in rows:
            a = agg.setdefault(r['variant'], dict(own=0, ownn=0, dec=0, decn=0, omax=0, dmax=0, b=0, locs=0, ex=0))
            a['own'] += r['own_mismatch']; a['ownn'] += r['own_coords']; a['dec'] += r['dec_mismatch']; a['decn'] += r['dec_coords']
            a['omax'] = max(a['omax'], r['own_max']); a['dmax'] = max(a['dmax'], r['dec_max'])
            a['b'] += r['bounds_mismatch_simple'] + r['bounds_mismatch_composite']; a['locs'] += 1; a['ex'] += (r['own_mismatch'] + r['dec_mismatch'] == 0)
        for k, a in agg.items():
            print(f"| {NAMES[ks]} | {a['locs']} | {k} | {a['own']} / {a['ownn']} ({a['omax']}) | {a['dec']} / {a['decn']} ({a['dmax']}) | {a['b']} | {a['ex']}/{a['locs']} |")


def cff2():
    for p in sorted(glob.glob(os.path.join(OUT, 'cff2-*.json'))):
        d = json.load(open(p))
        print(f"#### {os.path.basename(p)}: {d['glyphs']} glyphs, {d['regions']} regions, CFF2 table {d.get('CFF2 table')}\n")
        for tag, e in d.items():
            if not isinstance(e, dict) or 'cubic_points' not in e: continue
            cp = e['cubic_points'] - e['dropped_close']; dq = e['noncompat_quad_points'] - e['dropped_close']
            print(f"- {tag}: fails {len(e['fails'])}; cubic points {cp}; compatible quadratic points {e['quad_points']} ({e['quad_points']/cp-1:+.1%}); "
                  f"default-only cu2qu {dq} ({dq/cp-1:+.1%}); quadratics per cubic {e['quads']/max(1, e['cubics']):.2f}")
            if 'bytes' in e:
                b = e['bytes']; print('  - bytes (raw/gzip/brotli): ' + '; '.join(f'{k} {v[0]}/{v[1]}/{v[2]}' for k, v in b.items()))
            if 'errors' in e:
                print('  - error max/p99/mean, float instance | rounded to the storage grid: ' + '; '.join(
                    f"{k}: {v['float'][0]:.2f}/{v['float'][1]:.2f}/{v['float'][2]:.2f} | {v['int'][0]:.2f}/{v['int'][1]:.2f}/{v['int'][2]:.2f}" for k, v in e['errors'].items()))
        print()


def gpu():
    print('| Font, set | Var points | Delta slots | Stencil slots | Base | Delta pool | Region planes | Tuple table | Gather map | Instanced stencil | **Resident (pool layout)** | Worst active regions / slots | Multiply-adds per change | Bytes read per change |')
    print('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for l in open(os.path.join(OUT, 'gpu-estimate.jsonl')):
        d = json.loads(l)
        print(f"| {d['key']} | {d['var_points']} | {d['slots']} | {d['stencil_slots']} | {kb(d['base_B'])} KB | {kb(d['pool_B'])} KB | {kb(d['planes_B'])} KB | "
              f"{kb(d['tuples_B'])} KB | {kb(d['map_B'])} KB | {kb(d['stencil_B'])} KB | {kb(d['resident_pool_B'])} KB | {d['worst_active_regions']} / {d['worst_active_slots']} | "
              f"{d['madds_worst']} | {kb(d['read_B_worst'])} KB |")


if __name__ == '__main__':
    dict(sizes=sizes, timing=timing, verify=verify, cff2=cff2, gpu=gpu)[sys.argv[1]]()
