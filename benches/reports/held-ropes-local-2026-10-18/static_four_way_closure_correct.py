#!/usr/bin/env python3
"""Read-only correction of package manifest closure scopes; does not gzip or build."""
import copy, gzip, hashlib, io, json, tarfile
from pathlib import Path
BASE=Path('/private/tmp/glyph-held-20261016/.cache/held-local-20261018/physical-byte-elision/gates')
old=json.loads((BASE/'static-four-way-verified.v1.json').read_text())
comparison=json.loads((BASE/'static-archive-comparison.json').read_text())
paths={
 'candidate':comparison['archives']['candidate']['path'],
 'main':comparison['archives']['main']['path'],
 'published0.1.0':comparison['archives']['published0.1.0']['path'],
 'previous2a7':comparison['archives']['previous2a7']['path'],
}
expected={n:comparison['archives'][n]['archiveSha256'] for n in paths}
old_six=('exports','types','typings','peerDependencies','peerDependenciesMeta','sideEffects')
extended=('name','version','type','main','module','types','typings','exports','files','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','sideEffects','bin')
def sha(b): return hashlib.sha256(b).hexdigest()
def canon(x): return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def package_json(n,p):
 raw=Path(p).read_bytes(); assert sha(raw)==expected[n], (n,'archive hash mismatch')
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tf:
  b=tf.extractfile('package/package.json').read()
 return json.loads(b)
pkgs={n:package_json(n,p) for n,p in paths.items()}
candidate=pkg=pkg0=pkgs['candidate']
def project(pkg, fields): return {k:pkg.get(k) for k in fields}
ref6=project(candidate,old_six); ref15=project(candidate,extended)
res=copy.deepcopy(old)
for n,pkg in pkgs.items():
 six=project(pkg,old_six); ext=project(pkg,extended)
 diffs={k:{'candidate':ref15[k],'archive':ext[k]} for k in extended if ref15[k]!=ext[k]}
 res['archives'][n]['packageClosure']={
  'priorReceiptSixFieldSubset':{'fields':list(old_six),'sha256':sha(canon(six)),'equalToCandidate':six==ref6},
  'extendedFifteenFieldManifestClosure':{'fields':list(extended),'sha256':sha(canon(ext)),'equalToCandidate':ext==ref15,'differentFieldsVsCandidate':diffs},
  'interpretation':'Manifest-field equality only; neither subset is a public API equivalence proof.'}
 res['compactSummary'][n]['packageClosure']=res['archives'][n]['packageClosure']
res['format']='glyph-static-four-way-verified-v2'
res['closureCorrection']={
 'preservedPriorReceipt':'static-four-way-verified.v1.json',
 'priorReceiptClosureFields':list(old_six),
 'extendedClosureFields':list(extended),
 'correction':'Version 1 incorrectly described its 15-field package closure comparison as the same closure used by the prior receipt. The prior receipt compares only the six listed fields. Re-reading the exact four authenticated package.json members shows all four archives equal candidate on that six-field subset. Extended 15-field differences are separately listed per archive.',
 'publicApiCaveat':'Package manifest closure comparison, under either field set, is not a proof of public API equality.'}
out=BASE/'static-four-way-verified.json'
out.write_text(json.dumps(res,indent=2,sort_keys=True)+'\n')
print(json.dumps({'output':str(out),'sixFieldScope':list(old_six),'extendedScope':list(extended),'archives':{n:{'sixFieldEqual':res['archives'][n]['packageClosure']['priorReceiptSixFieldSubset']['equalToCandidate'],'extendedEqual':res['archives'][n]['packageClosure']['extendedFifteenFieldManifestClosure']['equalToCandidate'],'differentExtendedFields':res['archives'][n]['packageClosure']['extendedFifteenFieldManifestClosure']['differentFieldsVsCandidate']} for n in paths}},indent=2,sort_keys=True))
