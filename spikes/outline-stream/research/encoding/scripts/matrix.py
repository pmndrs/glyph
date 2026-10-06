"""Print gz/br KB for every candidate across results/*.json. Usage: matrix.py key-set ..."""
import json, sys, os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results')
keys = sys.argv[1:]
data = {k: json.load(open(os.path.join(R, k + '.json'))) for k in keys}
order = []
for k in keys:
    for r in data[k]['rows']:
        if (r[0], r[1]) not in order: order.append((r[0], r[1]))
print(f"{'candidate':42s} {'mode':10s} " + ' '.join(f'{k:>21s}' for k in keys))
for name, mode in order:
    cells = []
    for k in keys:
        m = {(r[0], r[1]): r for r in data[k]['rows']}.get((name, mode))
        cells.append(f'{m[2]/1000:6.1f}/{m[3]/1000:6.1f}/{m[4]/1000:6.1f}' if m else ' ' * 20)
    print(f'{name[:42]:42s} {mode[:10]:10s} ' + ' '.join(f'{c:>21s}' for c in cells))
