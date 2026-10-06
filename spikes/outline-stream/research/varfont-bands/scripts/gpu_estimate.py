"""Estimate (not a measurement) of a WebGPU compute pass doing 5(c) per instance change, against the measured Wasm CPU
path for the same glyphs.

Usage: gpu_estimate.py <out dir> <key-set> [<key-set> ...]   reads out/bench-<ks>.json and out/check-<ks>.json

Model, per instance change, for the glyphs of one bench subset (instanced points already on the GPU):
  pass 1, one thread per curve: read 3 control points from the point buffer (3 x 4 B, RG16I), write a 16 B hull
  pass 2, one thread per band: read the band's candidate references (2 B each) and, per candidate, the hull's two
          bin-axis bounds and its key (12 B), keep the overlapping ones, insertion-sort them by key in registers
          (lists are short: see mean/max refs), write kept references (2 B each) into the band's fixed slot (its
          capacity is the candidate count, so offsets never move and no prefix sum is needed) and a 4 B header.
  time = 2 dispatch overheads + bytes / bandwidth. Assumptions (not measured): effective bandwidth 25 GB/s
  (integrated) and 200 GB/s (discrete); 10-50 us per dispatch including submit. The CPU column is measured Wasm
  (hulls + 5c filter+sort) plus, for WebGL2, the bytes texSubImage2D would upload (kept refs + headers).
"""
import sys, os, json


def main():
    out = sys.argv[1]
    print('| Set | Glyphs | Curves | Candidates | Kept refs | GPU bytes per change | GPU est. 25 GB/s + 2x10-50 us | GPU est. 200 GB/s + 2x10-50 us | CPU Wasm hulls + 5c (measured) | WebGL2 upload |')
    print('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    rows = []
    for ks in sys.argv[2:]:
        bench = json.load(open(os.path.join(out, f'bench-{ks}.json')))
        chk = json.load(open(os.path.join(out, f'check-{ks}.json')))['strategies']
        for cfg in bench['configs']:
            if cfg['subset'] != 1 or cfg['spec'] != 'all':
                continue
            g, c = cfg['glyphs'], cfg['curves']
            cand = chk['S2/S3 cons[all] today\'s shader']['total']['mean_refs'] * 32 * g
            kept = chk['5c filter[all] + sort']['total']['mean_refs'] * 32 * g
            bands = 32 * g
            b1 = c * (12 + 16)
            b2 = cand * (2 + 12) + kept * 2 + bands * 4
            tot = b1 + b2
            lo_i, hi_i = 2 * 10 + tot / 25e9 * 1e6, 2 * 50 + tot / 25e9 * 1e6
            lo_d, hi_d = 2 * 10 + tot / 200e9 * 1e6, 2 * 50 + tot / 200e9 * 1e6
            st = bench['configs'][[i for i, x in enumerate(bench['configs']) if x['subset'] == 1][0]]['steps']
            cpu = (st['hulls'] + st['5c_filter_sort']) * g
            up = kept * 2 + bands * 4
            rows.append(dict(set=ks, glyphs=g, curves=c, candidates=cand, kept=kept, gpu_bytes=tot, cpu_us=cpu, upload=up))
            print(f'| {ks} | {g} | {c:,} | {cand:,.0f} | {kept:,.0f} | {tot / 1e3:,.0f} KB | {lo_i:.0f}-{hi_i:.0f} us | '
                  f'{lo_d:.0f}-{hi_d:.0f} us | {cpu:.0f} us | {up / 1e3:.1f} KB |')
    json.dump(rows, open(os.path.join(out, 'gpu-estimate.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
