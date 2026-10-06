"""Write bench inputs (same format as emit.py) for a converted CFF2 font saved by cff2.py --save.
Usage: cff2_emit.py <key> <model.pkl>   -> bench/<key>-<set>.bin/json, locations = cff2_locations()"""
import sys, os, pickle
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import emit  # noqa: E402


def cff2_locations(axes):
    t = {a[0]: a for a in axes}
    locs = [{}, {'wght': t['wght'][1]}, {'wght': t['wght'][3]}]
    if 'opsz' in t:
        locs += [{'opsz': t['opsz'][1]}, {'opsz': t['opsz'][3]}, {'wght': t['wght'][3], 'opsz': t['opsz'][1]}, {'wght': 650}, {'wght': 350, 'opsz': 36}]
    else:
        locs += [{'wght': 650}, {'wght': 350}]
    rng = np.random.default_rng(5)
    for _ in range(2): locs.append({a[0]: round(float(rng.uniform(a[1], a[3])), 2) for a in axes})
    return locs


def to_data(m):
    models = []; tuples = []
    for n in m['names']:
        r = m['rows'][n]
        if r[1] == 'fail' or not r[1]: models.append(('empty',)); tuples.append([]); continue
        models.append(('simple', r[1]))
        tuples.append([(ri, [(int(x), int(y)) for x, y in d]) for ri, d in enumerate(r[2]) if np.any(d)])
    return dict(names=m['names'], models=models, tuples=tuples, regions=m['regions'], axes=m['axes'], avar=m['avar'],
                ends=[[] for _ in m['names']], upm=m['upm'])


if __name__ == '__main__':
    key, pk = sys.argv[1:3]
    m = pickle.load(open(pk, 'rb'))
    data = to_data(m)
    which = os.path.basename(pk).replace('.pkl', '')
    emit.write(key, which, data, cff2_locations(m['axes']))
