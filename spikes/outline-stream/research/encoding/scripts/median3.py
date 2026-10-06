"""Median of the three bench3.mjs runs in logs/bench3-x3.txt. Usage: median3.py"""
import re, statistics, collections, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
d = collections.defaultdict(list)
for l in open(os.path.join(R, 'logs', 'bench3-x3.txt')):
    m = re.match(r'(\S+)\s+(.*?)\s+total\s+([\d.]+) ms\s+([\d.]+) us/glyph', l)
    if m: d[(m.group(1), re.sub(r'\(\d+ B\)|\(refs=\d+\)|\(all glyphs, \d+ failed\)', '', m.group(2)).strip())].append((float(m.group(3)), float(m.group(4))))
for (k, lab), v in d.items():
    print(f'{k:8s} {lab:58s} total {statistics.median(a for a,_ in v):7.3f} ms  {statistics.median(b for _,b in v):7.3f} us/glyph  runs={[b for _,b in v]}')
