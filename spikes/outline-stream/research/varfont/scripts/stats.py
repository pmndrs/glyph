"""Per-font variation statistics. Usage: stats.py <font> <latin|full>"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vmodel as V
t=time.time(); d = V.load_tt(sys.argv[1], sys.argv[2])
G=len(d['names']); comp=sum(m[0]=='composite' for m in d['models'])
pts=sum(len(V.base_coords(m)) for m in d['models'] if m[0]=='simple')
cpts=sum(len(m[1]) for m in d['models'] if m[0]=='composite')
withvar=sum(1 for t in d['tuples'] if t); ntup=sum(len(t) for t in d['tuples'])
explicit=sum(sum(v is not None for v in tp[1]) for t in d['tuples'] for tp in t)
slots=sum(len(tp[1]) for t in d['tuples'] for tp in t)
sparse_tuples=sum(1 for t in d['tuples'] for tp in t if None in tp[1])
comp_var=sum(1 for m,t in zip(d['models'],d['tuples']) if m[0]=='composite' and any(any(v not in (None,(0,0)) for v in tp[1]) for tp in t))
comp_tup=sum(1 for m,t in zip(d['models'],d['tuples']) if m[0]=='composite' and t)
inter=sum(1 for r in d['regions'] if any(lo!=min(pk,0) or hi!=max(pk,0) for lo,pk,hi in r if pk))
axes_per=[sum(1 for a in r if a[1]) for r in d['regions']]
print(f"{os.path.basename(sys.argv[1])} {sys.argv[2]}: glyphs {G}, composites {comp} ({comp_tup} with tuples, {comp_var} with nonzero offset deltas), simple points {pts}, component records {cpts}")
print(f"  axes {len(d['axes'])}, avar maps {len(d['avar'])}, regions {len(d['regions'])} (intermediate {inter}; axes/region max {max(axes_per)})")
print(f"  glyphs with tuples {withvar}, tuples {ntup} (sparse {sparse_tuples}), explicit deltas {explicit} of {slots} slots ({explicit/slots:.1%}), same region twice {d['same_region_twice']}  [{time.time()-t:.1f}s]")
