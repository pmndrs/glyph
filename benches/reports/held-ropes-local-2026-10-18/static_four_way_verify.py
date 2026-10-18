#!/usr/bin/env python3
"""Authenticate four frozen Glyph package archives and compare static contents."""
import gzip, hashlib, io, json, tarfile
from pathlib import Path

BASE=Path('/private/tmp/glyph-held-20261016/.cache/held-local-20261018/physical-byte-elision/gates')
OLD=json.loads((BASE/'static-archive-comparison.json').read_text())
EXPECTED={
 'candidate':'880255c15c9822ded79cc934dba755070348faf729bc96af9cd6f450a57cb332',
 'main':'bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20',
 'published0.1.0':'6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b',
 'previous2a7':'2a7f0317a49319203aac935a8d7387eafcc9f78443ff6de31c699c4605412627',
}
# Exact paths are taken from the frozen receipt and authenticated against its SHA.
PATHS={k:OLD['archives'][k]['path'] for k in EXPECTED if k in OLD['archives']}
PATHS['published0.1.0']=OLD['comparatorRoles']['published0.1.0']
assert set(PATHS)==set(EXPECTED), PATHS

def sha(b): return hashlib.sha256(b).hexdigest()
def gz(b): return len(gzip.compress(b, compresslevel=9, mtime=0))
def canon(x): return json.dumps(x, sort_keys=True, separators=(',',':'), ensure_ascii=False).encode()
def closure(pkg):
    # Extended 15-field manifest closure; prior receipt compared only its six-field exports/types/peer-dependency/sideEffects subset.
    keys=('name','version','type','main','module','types','typings','exports','files','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','sideEffects','bin')
    return {k:pkg.get(k) for k in keys}

def load(name,path):
    raw=Path(path).read_bytes(); actual=sha(raw)
    assert actual==EXPECTED[name], f'{name} archive SHA mismatch: {actual}'
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
        members={m.name:tf.extractfile(m).read() for m in tf.getmembers() if m.isfile()}
    pkg=json.loads(members['package/package.json'])
    js={p:b for p,b in members.items() if p.startswith('package/dist/') and p.endswith('.js')}
    decl={p:b for p,b in members.items() if p.startswith('package/dist/') and (p.endswith('.d.ts') or p.endswith('.d.ts.map'))}
    wasm={p:b for p,b in members.items() if p.startswith('package/dist/') and p.endswith('.wasm')}
    assert len(wasm)==5, (name,sorted(wasm))
    jcat=b''.join(js[p] for p in sorted(js))
    dmanifest={p:sha(decl[p]) for p in sorted(decl)}
    jmanifest={p:sha(js[p]) for p in sorted(js)}
    return {'archive':{'path':path,'bytes':len(raw),'sha256':actual},'members':members,'package':pkg,'closure':closure(pkg),'js':js,'decl':decl,'wasm':wasm,
      'js_concat':jcat,'js_manifest':jmanifest,'decl_manifest':dmanifest}

A={n:load(n,p) for n,p in PATHS.items()}
C=A['candidate']
results={}
for n,x in A.items():
    jm=x['js_manifest']; cm=C['js_manifest']
    dm=x['decl_manifest']; cdm=C['decl_manifest']
    jpaths=sorted(set(jm)|set(cm)); dpaths=sorted(set(dm)|set(cdm))
    jdiff=[p for p in jpaths if jm.get(p)!=cm.get(p)]
    ddiff=[p for p in dpaths if dm.get(p)!=cdm.get(p)]
    wm={p:sha(b) for p,b in sorted(x['wasm'].items())}
    cwm={p:sha(b) for p,b in sorted(C['wasm'].items())}
    results[n]={
      'archive':x['archive'],
      'runtimeJs':{'fileCount':len(x['js']),'rawBytes':len(x['js_concat']),'gzip9Mtime0Bytes':gz(x['js_concat']),'sortedConcatSha256':sha(x['js_concat']),'perPathManifestSha256':sha(canon(x['js_manifest'])),'changedPathsVsCandidate':jdiff},
      'declarations':{'fileCount':len(x['decl']),'rawBytes':sum(map(len,x['decl'].values())),'perPathManifestSha256':sha(canon(x['decl_manifest'])),'changedPathsVsCandidate':ddiff},
      'packageClosure':{'sha256':sha(canon(x['closure'])),'equalToCandidate':x['closure']==C['closure']},
      'wasm':{p:{'rawBytes':len(b),'sha256':sha(b),'gzip9Mtime0Bytes':gz(b),'equalToCandidate':sha(b)==cwm[p]} for p,b in sorted(x['wasm'].items())},
    }
# Verify the actual previous2a7 runtime JS equality from archive bytes, independently of old receipt claims.
assert A['previous2a7']['js_manifest']==C['js_manifest']
assert A['previous2a7']['js_concat']==C['js_concat']
assert results['candidate']['runtimeJs']['changedPathsVsCandidate']==[]
report={
 'format':'glyph-static-four-way-verified-v1',
 'method':{'archive':'exact TGZ SHA256 authenticated against frozen receipt','runtimeJs':'all package/dist/**/*.js, path-sorted; compare both per-path SHA manifests and concatenated bytes','declarations':'all package/dist/**/*.d.ts and *.d.ts.map, per-path SHA manifest','packageClosure':'declared manifest fields; this is not a public API equivalence proof','wasm':'all five package/dist/*.wasm raw SHA256/length and deterministic gzip level 9 mtime 0','gzip':'Python gzip.compress, level 9, mtime=0; same process and method for every archive'},
 'correction':{'priorReceipt':'static-archive-comparison.json preserved unchanged','misleadingField':'candidate.runtimeJsChangedPathsVsCandidate listed candidate paths despite self-comparison','rootCause':'Original generator is not present in the inspected evidence tree, so its internal cause cannot be established. Direct comparison shows the bad candidate array has 236 entries and is exactly the key set of candidate.runtimeJsFilesBySha (all runtime paths), not a diff; this is true in both preserved v1 and v2 receipts. Candidate concat hash and per-file manifest match the archive; direct self-diff is empty.','correctedCandidateSelfChangedPaths':results['candidate']['runtimeJs']['changedPathsVsCandidate'],'preOptimizationRole':'bec6c1735542bba49ab480d2337c787255950d09383c2f5720794a4d68fc5265','previous2a7Role':'2a7f0317a49319203aac935a8d7387eafcc9f78443ff6de31c699c4605412627'},
 'compactSummary':{n:{'archiveBytes':x['archive']['bytes'],'archiveSha256':x['archive']['sha256'],'runtimeJs':{k:x['runtimeJs'][k] for k in ('fileCount','rawBytes','gzip9Mtime0Bytes','sortedConcatSha256','perPathManifestSha256')},'runtimeJsChangedPathCountVsCandidate':len(x['runtimeJs']['changedPathsVsCandidate']),'declarations':{k:x['declarations'][k] for k in ('fileCount','rawBytes','perPathManifestSha256')},'declarationChangedPathCountVsCandidate':len(x['declarations']['changedPathsVsCandidate']),'packageClosure':x['packageClosure'],'wasmTotals':{'fileCount':len(x['wasm']),'rawBytes':sum(w['rawBytes'] for w in x['wasm'].values()),'gzip9Mtime0Bytes':sum(w['gzip9Mtime0Bytes'] for w in x['wasm'].values()),'perPathSha256ManifestSha256':sha(canon({p:w['sha256'] for p,w in x['wasm'].items()}))}} for n,x in results.items()},
 'archives':results,
 'assertions':{'archiveShaMatchesFrozenReceipt':True,'candidateSelfRuntimeJsDiffEmpty':True,'previous2a7RuntimeJsByteIdentityWithCandidate':True,'allFourHaveFiveWasm':True},
}
out=BASE/'static-four-way-verified.json'
out.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
print(json.dumps({'output':str(out),'archives':{n:r['archive'] for n,r in results.items()},'runtimeJs':{n:r['runtimeJs'] for n,r in results.items()},'declarations':{n:r['declarations'] for n,r in results.items()},'packageClosure':{n:r['packageClosure'] for n,r in results.items()},'compactSummary':report['compactSummary'],'assertions':report['assertions'],'correction':report['correction']},indent=2,sort_keys=True))
