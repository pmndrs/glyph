"""Q4: CFF2 variable fonts -> compatible quadratics + per-region deltas against the default master.

Usage: cff2.py <key> <font.otf> <latin|full|sample:N> [--tols 1,0.5,0.25h] [--basis A|B|AB] [--procs 4] [--err-sample N]

Masters:
  basis A  default master plus one 'region master' per VarStore region: default + that region's blend deltas alone
           (the outline at scalar 1 for that region and 0 for every other). Deltas = Q_r - Q_0 exactly.
  basis B  default master plus the real master at each region's peak location (all regions blended, as a
           designer's master would be); quadratic deltas solved back through the region-scalar matrix and rounded.
Compatible conversion: per cubic segment, fontTools.cu2qu.curves_to_quadratic over every master at once (same
number of quadratics in every master, all_quadratic). Off-curve points rounded to the grid (1 = integer units,
2 = half units, written 'h'); implied on-curve points stay implied (exact midpoints of the rounded off-curves).
Error: per cubic segment at an instance, max distance from 65 samples of the true cubic (fontTools blend at the
same normalized location, unrounded) to the instanced quadratic chain flattened to 64 segments per piece.
"""
import sys, os, io, json, gzip, time, argparse
import numpy as np
import brotli
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vmodel as V  # noqa: E402
import venc as D  # noqa: E402
import enc as E  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.pens.recordingPen import RecordingPen  # noqa: E402
from fontTools.cu2qu import curves_to_quadratic, curve_to_quadratic  # noqa: E402
from fontTools.cu2qu.errors import Error as Cu2QuError  # noqa: E402

OUT = os.path.join(HERE, '..', 'out')


def sz(b): return [len(b), len(gzip.compress(b, 9)), len(brotli.compress(b, quality=11, lgwin=24))]


def cat(p): return b''.join(p.values())


def font_regions(font):
    vs = font['CFF2'].cff.topDictIndex[0].CharStrings.varStore.otVarStore
    regs = []
    for r in vs.VarRegionList.Region:
        regs.append(tuple((0, 0, 0) if not a.PeakCoord else (V.f2(a.StartCoord), V.f2(a.PeakCoord), V.f2(a.EndCoord))
                          for a in r.VarRegionAxis))
    return vs, regs


def recordings(font, names, basis):
    vs, regs = font_regions(font)
    tags = [a.axisTag for a in font['fvar'].axes]
    gs0 = font.getGlyphSet()
    gsr = font.getGlyphSet(location={tags[0]: font['fvar'].axes[0].defaultValue})
    out = {}
    def rec(gs, n):
        p = RecordingPen(); gs[n].draw(p); return p.value
    if basis == 'A':
        def mk(r):
            return lambda vsi, deltas: sum(d for d, ri in zip(deltas, vs.VarData[vsi].VarRegionIndex) if ri == r)
        for n in names:
            lst = [rec(gs0, n)]
            for r in range(len(regs)):
                gsr.blender = mk(r); lst.append(rec(gsr, n))
            out[n] = lst
    else:
        peaks = [{t: a[1] / 16384 for t, a in zip(tags, reg) if a[1]} for reg in regs]
        gsp = [font.getGlyphSet(location=p, normalized=True) for p in peaks]
        for n in names:
            out[n] = [rec(gs0, n)] + [rec(g, n) for g in gsp]
    return out, regs


def peak_matrix(regs):
    """S[i][j] = scalar of region j at region i's peak."""
    R = len(regs)
    S = np.zeros((R, R))
    for i, ri in enumerate(regs):
        norm = [a[1] / 16384 for a in ri]
        for j, rj in enumerate(regs): S[i, j] = V.region_scalar(rj, norm)
    return S


def convert_glyph(recs, tol, grid, basis, Sinv):
    """recs: per master op list. Returns (contours of default (x, y, t) ints on the grid, per region delta list,
    cubic map [(contour, start_idx, [off idxs], end_idx)], stats) or raises Cu2QuError."""
    M = len(recs)
    ops = list(zip(*recs))
    contours = []; cmap = []; st = dict(cubics=0, lines=0, quads=0, dropped_close=0, kept_close=0, frac=0)
    cur = None
    def g(v):
        w = v * grid
        if w != int(w): st['frac'] += 1
        return int(round(w))
    for k, step in enumerate(ops):
        op = step[0][0]
        assert all(s[0] == op for s in step), 'incompatible masters'
        if op == 'moveTo':
            cur = dict(pts=[[(g(s[1][0][0]), g(s[1][0][1]), 0)] for s in step], raw_last=[s[1][0] for s in step],
                       first=[s[1][0] for s in step], cubics=[])
        elif op == 'lineTo':
            for m, s in enumerate(step): cur['pts'][m].append((g(s[1][0][0]), g(s[1][0][1]), 0))
            cur['raw_last'] = [s[1][0] for s in step]; st['lines'] += 1
        elif op == 'curveTo':
            curves = [(cur['raw_last'][m],) + tuple(s[1]) for m, s in enumerate(step)]
            spl = curves_to_quadratic(curves, [tol] * M, all_quadratic=True)
            n_off = len(spl[0]) - 2
            start = len(cur['pts'][0]) - 1
            for m, sp in enumerate(spl):
                for p in sp[1:-1]: cur['pts'][m].append((int(round(p[0] * grid)), int(round(p[1] * grid)), 1))
                cur['pts'][m].append((g(sp[-1][0]), g(sp[-1][1]), 0))
            cur['cubics'].append((start, list(range(start + 1, start + 1 + n_off)), start + 1 + n_off))
            cur['raw_last'] = [s[1][-1] for s in step]; st['cubics'] += 1; st['quads'] += n_off
        elif op in ('closePath', 'endPath'):
            pts = cur['pts']
            if len(pts[0]) > 1 and all(p[-1][2] == 0 and p[-1][:2] == p[0][:2] for p in pts):
                for p in pts: p.pop()
                n = len(pts[0])
                cur['cubics'] = [(a, b, 0 if e == n else e) for a, b, e in cur['cubics']]
                st['dropped_close'] += 1
            elif len(pts[0]) > 1 and any(p[-1][:2] == p[0][:2] for p in pts):
                st['kept_close'] += 1
            if len(pts[0]) > 1:
                ci = len(contours); contours.append(pts)
                for a, b, e in cur['cubics']: cmap.append((ci, a, b, e))
            cur = None
    # per master flat arrays
    P = [np.array([q for c in contours for q in c[m]], np.int64).reshape(-1, 3) for m in range(M)]
    base = [[(int(x), int(y), int(t)) for x, y, t in c[0]] for c in contours]
    if basis == 'A':
        deltas = [P[m][:, :2] - P[0][:, :2] for m in range(1, M)]
    else:
        Dm = np.stack([P[m][:, :2] - P[0][:, :2] for m in range(1, M)])  # (R, n, 2) master offsets at peaks
        sol = np.einsum('ij,jnk->ink', Sinv, Dm)
        deltas = [np.array([[int(round(a)), int(round(b))] for a, b in d.reshape(-1, 2)], np.int64).reshape(-1, 2) for d in sol]
    return base, deltas, cmap, st


def nonfloat_default(rec0, tol, grid):
    """Non-compatible (default master only) cu2qu point count for comparison."""
    n = 0; cur = None
    for op, args in rec0:
        if op == 'moveTo': cur = args[0]; n += 1
        elif op == 'lineTo': cur = args[0]; n += 1
        elif op == 'curveTo':
            sp = curve_to_quadratic((cur,) + tuple(args), tol, all_quadratic=True); n += len(sp) - 1; cur = args[-1]
        elif op in ('closePath', 'endPath'): pass
    return n


def _worker(job):
    path, which, names, tols, basis = job
    font = V.open_set(path, which) if which in ('latin', 'full') else TTFont(path)
    recs, regs = recordings(font, names, basis)
    Sinv = np.linalg.inv(peak_matrix(regs)) if basis == 'B' else None
    res = {}
    for tol, grid in tols:
        out = []
        for n in names:
            try:
                out.append((n,) + convert_glyph(recs[n], tol, grid, basis, Sinv) + (nonfloat_default(recs[n][0], tol, grid),))
            except Cu2QuError as e:
                out.append((n, 'fail', repr(e)))
        res[(tol, grid)] = out
    cubic_pts = {}
    for n in names:
        c = 0
        for op, args in recs[n][0]:
            if op in ('moveTo', 'lineTo'): c += 1
            elif op == 'curveTo': c += 3
            elif op in ('closePath',): pass
        cubic_pts[n] = c
    return res, cubic_pts


def cubic_curves_at(font, names, norm_loc):
    gs = font.getGlyphSet(location=norm_loc, normalized=True) if norm_loc else font.getGlyphSet()
    out = {}
    for n in names:
        p = RecordingPen(); gs[n].draw(p); cur = None; cl = []
        for op, args in p.value:
            if op == 'moveTo': cur = args[0]
            elif op == 'lineTo': cur = args[0]
            elif op == 'curveTo': cl.append((cur,) + tuple(args)); cur = args[-1]
        out[n] = cl
    return out


T = np.linspace(0, 1, 65); U = np.linspace(0, 1, 65)


def cubic_pts(c, t=T):
    c = np.array(c, np.float64); m = 1 - t
    return (m**3)[:, None] * c[0] + (3 * m * m * t)[:, None] * c[1] + (3 * m * t * t)[:, None] * c[2] + (t**3)[:, None] * c[3]


def dist(samples, poly):
    a = poly[:-1]; b = poly[1:]; ab = b - a
    ap = samples[:, None, :] - a[None]
    den = (ab * ab).sum(-1); den[den == 0] = 1
    t = np.clip((ap * ab[None]).sum(-1) / den[None], 0, 1)
    d = ap - t[..., None] * ab[None]
    return np.sqrt((d * d).sum(-1)).min(1).max()


def quad_chain(start, offs, end):
    out = []; s = start
    for i, c in enumerate(offs):
        e = end if i == len(offs) - 1 else (c + offs[i + 1]) / 2
        m = 1 - U
        out.append((m * m)[:, None] * s + (2 * m * U)[:, None] * c + (U * U)[:, None] * e); s = e
    return np.concatenate(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('key'); ap.add_argument('font'); ap.add_argument('which')
    ap.add_argument('--tols', default='1,0.5,0.25h'); ap.add_argument('--basis', default='A')
    ap.add_argument('--procs', type=int, default=4); ap.add_argument('--err-sample', type=int, default=20000)
    ap.add_argument('--no-bytes', action='store_true')
    ap.add_argument('--save', default=None, help='pickle the converted model per tolerance to this path prefix')
    ap.add_argument('--no-err', action='store_true')
    a = ap.parse_args()
    tols = [(float(t.rstrip('h')), 2 if t.endswith('h') else 1) for t in a.tols.split(',')]
    which = a.which
    if which.startswith('sample:'):
        full = TTFont(a.font); allnames = full.getGlyphOrder(); N = int(which.split(':')[1])
        rng = np.random.default_rng(7); names = sorted(rng.choice(len(allnames), N, replace=False).tolist())
        names = [allnames[i] for i in names]; fontsrc = 'full-file'; font = full
    else:
        font = V.open_set(a.font, which); names = font.getGlyphOrder()
    axes, avar = V.axes_avar(font)
    _, regs = font_regions(font)
    t0 = time.time()
    report = dict(key=a.key, set=which, glyphs=len(names), regions=len(regs), axes=axes)
    for basis in a.basis:
        chunks = [names[i::a.procs] for i in range(a.procs)]
        jobs = [(a.font, which if not which.startswith('sample:') else 'file', c, tols, basis) for c in chunks]
        if a.procs > 1:
            from multiprocessing import Pool
            with Pool(a.procs) as pool: parts = pool.map(_worker, jobs)
        else:
            parts = [_worker(j) for j in jobs]
        cpts_by = {}
        for _, cp in parts: cpts_by.update(cp)
        print(f'# basis {basis}: converted in {time.time()-t0:.1f}s', file=sys.stderr)
        for tol, grid in tols:
            byname = {}
            for res, _ in parts:
                for row in res[(tol, grid)]: byname[row[0]] = row
            fails = [r for r in byname.values() if r[1] == 'fail']
            ok = [byname[n] for n in names if byname[n][1] != 'fail']
            st = dict(cubics=0, quads=0, lines=0, dropped_close=0, kept_close=0, frac=0)
            qpts = 0; noncompat = 0
            for r in ok:
                for k in st: st[k] += r[4][k]
                qpts += sum(len(c[0]) for c in [[cc] for cc in r[1]])
                noncompat += r[5]
            cpts = sum(cpts_by[n] for n in names)
            tag = f'basis {basis}, tol {tol}' + (', half-unit grid' if grid == 2 else '')
            entry = dict(fails=[(r[0], r[2]) for r in fails], cubic_points=cpts, quad_points=qpts,
                         noncompat_quad_points=noncompat, **st)
            print(f'## {tag}: fails {len(fails)}, cubic pts {cpts}, compatible quad pts {qpts} ({qpts/cpts-1:+.1%}), '
                  f'default-only quad pts {noncompat} ({noncompat/cpts-1:+.1%}), quads/cubic {st["quads"]/max(1,st["cubics"]):.3f}, {st}',
                  file=sys.stderr)
            # ---- bytes
            if not a.no_bytes and not which.startswith('sample:'):
                models = []; tuples = []
                for n in names:
                    r = byname[n]
                    if r[1] == 'fail' or not r[1]: models.append(('empty',)); tuples.append([]); continue
                    models.append(('simple', r[1]))
                    tl = []
                    for ri, d in enumerate(r[2]):
                        if np.any(d): tl.append((ri, [(int(x), int(y)) for x, y in d]))
                    tuples.append(tl)
                data = dict(names=names, models=models, tuples=tuples, regions=regs, axes=axes, avar=avar,
                            ends=[[] for _ in names])
                base = E.triplets(E.Flat(models))
                entry['bytes'] = {'base triplets': sz(cat(base)), 'region table': sz(D.region_table(data)),
                                  'axis table': sz(D.axis_table(data))}
                for pred in ('raw', 'prev'):
                    for coder in ('tripz', 'i8esc', 'varint'):
                        entry['bytes'][f'deltas {coder} {pred}'] = sz(cat(D.delta_streams(data, 'dense', 'region', coder, pred)))
                allb = cat(base) + D.region_table(data) + D.axis_table(data) + cat(D.delta_streams(data, 'dense', 'region', 'tripz', 'prev'))
                entry['bytes']['total (one blob: base + regions + axes + deltas tripz prev)'] = sz(allb)
                print(f"   bytes {entry['bytes']}", file=sys.stderr)
            if a.save:
                import pickle
                gsuffix = f"{tol}{'h' if grid == 2 else ''}"
                keep = {n: byname[n] for n in names}
                pickle.dump(dict(names=names, rows=keep, regions=regs, axes=axes, avar=avar, grid=grid, tol=tol, basis=basis,
                                 upm=font['head'].unitsPerEm),
                            open(f'{a.save}-{gsuffix}-{basis}.pkl', 'wb'))
            if a.no_err:
                report[tag] = entry; continue
            # ---- error at instances
            locs = [{}, {'wght': axes_min(axes, 'wght')}, {'wght': axes_max(axes, 'wght')}]
            if any(t == 'opsz' for t, *_ in axes):
                locs += [{'opsz': axes_min(axes, 'opsz')}, {'opsz': axes_max(axes, 'opsz')},
                         {'wght': axes_max(axes, 'wght'), 'opsz': axes_min(axes, 'opsz')}]
            locs += [{'wght': 650}, {'wght': 350}]
            if any(t == 'opsz' for t, *_ in axes): locs[-1] = {'wght': 350, 'opsz': 36}
            errs = {}
            # sample of cubics: (glyph, cubic index)
            allc = [(n, k) for n in names if byname[n][1] != 'fail' for k in range(len(byname[n][3]))]
            rng = np.random.default_rng(3)
            sel = allc if len(allc) <= a.err_sample else [allc[i] for i in np.sort(rng.choice(len(allc), a.err_sample, replace=False))]
            seln = sorted(set(n for n, _ in sel))
            efont = font if not which.startswith('sample:') else TTFont(a.font)
            for loc in locs:
                dd = dict(names=names, axes=axes, avar=avar)
                norm = V.user_to_norm(dd, loc)
                s = np.array([V.region_scalar(r, norm) for r in regs])
                nloc = {t: v for (t, *_), v in zip(axes, norm) if v}
                truth = cubic_curves_at(efont, seln, nloc)
                e_f = []; e_i = []
                cache = {}
                for n, k in sel:
                    if n not in cache:
                        r = byname[n]
                        P0 = np.array([q for c in r[1] for q in c], np.float64).reshape(-1, 3)
                        Q = P0[:, :2] + sum(si * d for si, d in zip(s, r[2]) if si) if len(r[2]) else P0[:, :2]
                        offsets = np.cumsum([0] + [len(c) for c in r[1]])
                        cache[n] = (Q / grid, np.floor(Q + 0.5) / grid, offsets)  # instance rounded to the storage grid
                    Qf, Qi, offsets = cache[n]
                    ci, st_, offs, en = byname[n][3][k]
                    b = offsets[ci]
                    c = truth[n][k]; smp = cubic_pts(c)
                    for Qx, acc in ((Qf, e_f), (Qi, e_i)):
                        acc.append(dist(smp, quad_chain(Qx[b + st_], [Qx[b + o] for o in offs], Qx[b + en])))
                e_f = np.array(e_f); e_i = np.array(e_i)
                lab = ','.join(f'{k}={v}' for k, v in loc.items()) or 'default'
                errs[lab] = dict(float=[float(e_f.max()), float(np.percentile(e_f, 99)), float(e_f.mean())],
                                 int=[float(e_i.max()), float(np.percentile(e_i, 99)), float(e_i.mean())], n=len(sel))
                print(f'   err {lab:24s} float max/p99/mean {e_f.max():.3f}/{np.percentile(e_f,99):.3f}/{e_f.mean():.3f}'
                      f'   instance rounded to grid: {e_i.max():.3f}/{np.percentile(e_i,99):.3f}/{e_i.mean():.3f}  (n={len(sel)})', file=sys.stderr)
            entry['errors'] = errs
            report[tag] = entry
    if not which.startswith('sample:'):
        src = font.getTableData('CFF2')
        report['CFF2 table'] = sz(src)
        print(f'# CFF2 table {report["CFF2 table"]}', file=sys.stderr)
    json.dump(report, open(os.path.join(OUT, f'cff2-{a.key}-{which.replace(":", "")}-{a.basis}.json'), 'w'), indent=1, default=str)
    print(f'# done {time.time()-t0:.1f}s', file=sys.stderr)


def axes_min(axes, tag): return next(a[1] for a in axes if a[0] == tag)
def axes_max(axes, tag): return next(a[3] for a in axes if a[0] == tag)


if __name__ == '__main__':
    main()
