"""Markdown tables for the variable-font band study, from bandcheck, bench.mjs and sizes.py outputs.

Usage: report_tables.py <out dir> correctness|bytes|timing|update <key-set> [...]
  correctness  per strategy: locations, mean/max refs per band, missing refs, order inversions against instanced
               maxima, stored-key violations, glyphs outside the partition, emulated-shader sample mismatches at 64 and
               4096 px/em, worst-location glyphs with any error, and references read per sample and band (64 px/em)
  bytes        per pre-baked table: raw / gzip / brotli KB, and brotli against the static default-instance bands
  timing       Wasm us/glyph per step, per glyph set
  update       composed per-update and at-load costs per strategy (Wasm), for the 200-glyph set and the whole font
"""
import sys, os, json

OUT = sys.argv[1]
# Outline-stream totals (brotli KB) from the previous study (outline-stream-variable-font-study.md, Q1 and Q4)
OUTLINE = {'inter-latin': 35.2, 'inter-full': 193.2, 'flex-latin': 193.0, 'flex-full': 549.2,
           'serif-latin': 68.2, 'serif-full': 276.8, 'cjk-full': 12240.0}
ORDER = ['S1 exact rebuild', 'S0 default-instance bake']


def load(name):
    p = os.path.join(OUT, name)
    return json.load(open(p)) if os.path.exists(p) else None


def correctness(ks):
    c = load(f'check-{ks}.json')
    print(f'\n**{ks}** — {c["glyph_locations"]:,} glyph-locations; slug-core vs CSR builder mismatches '
          f'{c["fast_vs_slug_mismatch"]}, vs hinted builder {c["hint_vs_slug_mismatch"]}; sample test on every '
          f'{c["sample_stride"]}-th glyph, {c["grid"]}x{c["grid"]} samples per glyph and axis\n')
    print('| Strategy | Locs | Refs/band mean / max | Missing | Inversions | Key viol. | Outside | Sample mismatches 64 / 4096 px | Worst-loc bad glyphs | Reads / sample-band |')
    print('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    names = sorted(c['strategies'], key=lambda n: (n not in ORDER, ORDER.index(n) if n in ORDER else 0, n))
    for n in names:
        s = c['strategies'][n]; t = s['total']
        inv = t['inv_pairs'] if ('today' in n or 'keep' in n or n.startswith('S0') or n.startswith('S1') or n.startswith('S4') or 'resort' in n or '+ sort' in n) else '(n/a)'
        print(f'| {n} | {s["locations"]} | {t["mean_refs"]:.2f} / {t["max_refs"]} | {t["miss"]:,} | {inv if isinstance(inv, str) else f"{inv:,}"} | '
              f'{t["keyviol"]:,} | {t["outside"]:,} | {t["mis64"]:,} / {t["mis4096"]:,} | {s["worst_bad_glyphs"]:,} | {t["iters_per_sample_band"]:.2f} |')


def kb(v):
    return f'{v / 1e3:,.1f}'


def bytes_(ks):
    s = load(f'sizes-{ks}.json') or {}
    for fn in sorted(os.listdir(OUT)):
        if fn.startswith(f'sizes-{ks}.') and fn.count('.') == 2:
            s.update(json.load(open(os.path.join(OUT, fn))))
    cells = [v for k, v in s.items() if k.startswith('cons-cell') and k != 'cons-cells-sum' and isinstance(v, dict)]
    if cells:
        s['cons-cells-sum'] = {k: sum(c[k] for c in cells) for k in ('raw', 'gzip', 'brotli')}
    st = s['static-default']['brotli']
    print(f'\n**{ks}** (outline stream, previous study: {OUTLINE[ks]:,.1f} KB brotli)\n')
    print('| Table | Raw KB | gzip KB | brotli KB | brotli vs static bands | brotli vs outline stream |')
    print('| --- | ---: | ---: | ---: | ---: | ---: |')
    for k, v in s.items():
        if not isinstance(v, dict) or (k.startswith('cons-cell') and k != 'cons-cells-sum'):
            continue
        print(f'| {k}{" (brotli q9)" if v.get("brotli_q") == 9 else ""} | {kb(v["raw"])} | {kb(v["gzip"])} | {kb(v["brotli"])} | {v["brotli"] / st:.2f}x | {v["brotli"] / 1e3 / OUTLINE[ks] * 100:.0f}% |')


def timing(ks):
    b = load(f'bench-{ks}.json')
    print(f'\n**{ks}** (Wasm scalar, Node 22, us per glyph)\n')
    keys = list(b['configs'][0]['steps'])
    print('| Subset | Spec | Glyphs | Curves | ' + ' | '.join(keys) + ' |')
    print('| --- | --- | ---: | ---: | ' + ' | '.join('---:' for _ in keys) + ' |')
    for cfg in b['configs']:
        print(f'| {cfg["subset"]} | {cfg["spec"]} | {cfg["glyphs"]} | {cfg["curves"]:,} | ' + ' | '.join(
            f'{cfg["steps"][k]:.3f}' if k in cfg['steps'] else '' for k in keys) + ' |')


def update(ks):
    b = load(f'bench-{ks}.json')
    by = {}
    for cfg in b['configs']:
        by.setdefault(cfg['subset'], {})[cfg['spec']] = cfg
    print(f'\n**{ks}** — band work per axis change, after instancing (Wasm scalar; us per glyph, and ms for the set)\n')
    print('| Strategy | Steps | us/glyph (text) | us/glyph (200) | ms per 200 glyphs | ms whole set | Speedup vs S1 slug-core |')
    print('| --- | --- | ---: | ---: | ---: | ---: | ---: |')
    subs = sorted(by)
    big = subs[-1]
    specs = list(by[subs[0]])

    def cost(sub, spec, parts):
        st0 = by[sub][specs[0]]['steps']; st = by[sub][spec]['steps']
        return sum((st if p in st else st0)[p] for p in parts)
    rows = [('S1 rebuild, slug-core build_bands', specs[0], ['curves', 's1_slug']),
            ('S1 rebuild, CSR builder', specs[0], ['curves', 'hulls', 's1_fast']),
            ('(d) S1 rebuild, CSR + default-order hint', specs[0], ['curves', 'hulls', 's1_hint']),
            ('5b linear bounds (no instanced points needed)', specs[0], ['5b_linear'])]
    for sp in specs:
        rows += [(f'S2 cons[{sp}] + resort per change', sp, ['curves', 'hulls', 'resort']),
                 (f'5c filter[{sp}] + sort', sp, ['curves', 'hulls', '5c_filter_sort']),
                 (f'(d2) exact bin into fixed partition[{sp}]', sp, ['curves', 'hulls', 'fixed_exact'])]
    base = {s: cost(s, specs[0], ['curves', 's1_slug']) for s in subs}
    for name, sp, parts in rows:
        t0, t1, tb = cost(subs[0], sp, parts), cost(subs[1], sp, parts), cost(big, sp, parts)
        g1, gb = by[subs[1]][sp]['glyphs'], by[big][sp]['glyphs']
        print(f'| {name} | {"+".join(parts)} | {t0:.2f} | {t1:.2f} | {t1 * g1 / 1e3:.3f} | {tb * gb / 1e3:.2f} | {base[subs[1]] / t1:.1f}x |')
    print('\nAt load (once per font, us/glyph, whole set):\n')
    print('| Strategy | us/glyph | ms whole set |')
    print('| --- | ---: | ---: |')
    gb = by[big][specs[0]]['glyphs']
    print(f'| S1 initial build, slug-core | {cost(big, specs[0], ["curves", "s1_slug"]):.2f} | {cost(big, specs[0], ["curves", "s1_slug"]) * gb / 1e3:.1f} |')
    print(f'| (d) S1 initial build, hinted | {cost(big, specs[0], ["curves", "hulls", "s1_hint"]):.2f} | {cost(big, specs[0], ["curves", "hulls", "s1_hint"]) * gb / 1e3:.1f} |')
    for sp in specs:
        print(f'| S2 cons[{sp}] built at load | {cost(big, sp, ["s2_load"]):.2f} | {cost(big, sp, ["s2_load"]) * gb / 1e3:.1f} |')
        print(f'| 5a cons[{sp}] binned from pre-sorted boxes | {cost(big, sp, ["5a_bin"]):.2f} | {cost(big, sp, ["5a_bin"]) * gb / 1e3:.1f} |')
    print(f'\n(whole set = {gb} glyphs; instancing step, this crate\'s dense scalar instancer: {by[big][specs[0]]["steps"]["instance"]:.3f} us/glyph)')


def main():
    mode = sys.argv[2]
    for ks in sys.argv[3:]:
        {'correctness': correctness, 'bytes': bytes_, 'timing': timing, 'update': update}[mode](ks)


if __name__ == '__main__':
    main()
