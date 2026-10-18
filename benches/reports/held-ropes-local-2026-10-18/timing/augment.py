import hashlib, json, re
from pathlib import Path
B=Path('/private/tmp/glyph-held-wave-report-20261018/timing')
W=Path('/private/tmp/glyph-held-20261016')
S=W/'.cache/held-local-20261018/physical-byte-elision'
d=json.loads((B/'timing-evidence.json').read_text())
def sha(p):
 h=hashlib.sha256();
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
# Explicitly attest that B/C reused exactly A's saved candidate JSON.
candidate_json_hashes={}
for cid,rn in [('main','labs-main'),('published010','labs-published010'),('beforeHeld2a','labs-before-held')]:
 candidate_json_hashes[cid]=sha(S/rn/'candidate.json')
d['artifacts']['candidate']['timed_candidate_json_sha256']=candidate_json_hashes['main']
d['saved_candidate_proof']={
 'timed_once_in':'main comparator A',
 'sha256_by_comparator':candidate_json_hashes,
 'byte_identical_across_A_B_C':len(set(candidate_json_hashes.values()))==1,
 'B_and_C_manifest_savedCandidate':[
   d['comparisons'][1]['saved_candidate_path'],d['comparisons'][2]['saved_candidate_path']],
 'B_and_C_log_confirmation':'Both raw operator logs state “Reusing saved candidate timings …; candidate will not be benchmarked again”.',
 'validation':'Both reuses completed exit 0 after matching artifact SHA-256, suite=full, blocks=8, Labs 0.9.0, CPU Apple M4, architecture arm64-darwin, and Node 24.18.0.'}
# Distinct independent capture chronology: the exact new candidate is one capture referenced in all three comparisons.
unique=[
 ('main baseline','main','baseline_capture'),
 ('new candidate (timed once in A)','main','candidate_capture'),
 ('published 0.1.0 baseline','published010','baseline_capture'),
 ('before-HELD 2a7 baseline','beforeHeld2a','baseline_capture'),
]
d['unique_timed_captures']=[]
for name,cid,key in unique:
 c=next(x for x in d['comparisons'] if x['id']==cid)
 d['unique_timed_captures'].append({'name':name,**c[key]})
d['clock_warning_readout']={
 'A_main_and_candidate':'No summary-level clock warning in comparison output.',
 'B_published010_baseline':'No summary-level clock warning in comparison output.',
 'C_beforeHeld2a_baseline':'Summary-level warning: baseline CPU clock drifted 9.6% during its run.',
 'candidate_capture_reused':'One capture only. Result-clock arrays are preserved; no candidate retiming occurred.',
 'per_file_boundaries':'Run and post frequencies per file are in unique_timed_captures[*].per_file_frequency_drift.',
 'per_block_observations':'Each workload row carries its block_frequency_ghz and block_spreads arrays for both arms. These provide local evidence; the summary-level C warning is preserved as an exclusion rather than applied as a blanket verdict.'}
# Family coverage list is derived from exact benchmark labels, not an attribution claim.
allcases=sorted({r['case'] for c in d['comparisons'] for r in c['rows'] if r['candidate_present']})
family_selectors={
 'long Unicode / shaping / flow':lambda c:any(x in c for x in ['edit.bench.ts','unsafe-line-breaks.bench.ts','request-arena.bench.ts']) or ('framework-publication.bench.ts' in c and 'flow' in c.lower()),
 'dense 512 / 1024':lambda c:('rewrite 512 labels in one group' in c or 'publish 1024 retained Text instances' in c),
 'width / cold / inspection':lambda c:any(x in c for x in ['cold.bench.ts','layout.bench.ts','inspection.bench.ts']),
 'small unchanged ingress':lambda c:('measure 100 unchanged labels' in c or 'same-value-set' in c or 'measure 1000 unchanged retained labels' in c),
 'sparse root publication':lambda c:('sparse-assignment.bench.ts' in c or ('batching.bench.ts' in c and any(x in c for x in ['immediate measurements with publication','interleaved edit-read publication','batched edit-read publication']))),
 'selected copy inspection':lambda c:('inspection.bench.ts' in c or 'outlines.bench.ts' in c),
 'tails / memory delivery':lambda c:('mutate one trailing span across 1000 formatted labels' in c or ('request-arena.bench.ts' in c and ('22k UTF16' in c)) or ('split move and merge paint boundaries' in c)),
}
d['fixed_performance_family_coverage']={
 name:{'candidate_workload_count':len([c for c in allcases if predicate(c)]),'candidate_workload_cases':[c for c in allcases if predicate(c)],'interpretation':'Named fixture coverage only; this grouping does not isolate an algorithmic cause.'}
 for name,predicate in family_selectors.items()
}
# Add compact neutral/control workload rows requested for the dense/width families.
ccomp=next(x for x in d['comparisons'] if x['id']=='beforeHeld2a')
selected=[]
for r in ccomp['rows']:
 if ('rewrite 512 labels in one group' in r['case'] or 'publish 1024 retained Text instances' in r['case'] or 'per-glyph inspection after width change' in r['case']):
  selected.append({'case':r['case'],'final_classification':r['final_classification'],'baseline':r['baseline'],'candidate':r['candidate']})
d['before_held_dense_and_width_rows']=selected
for c in d['comparisons']:
 console=(B/'raw'/({'main':'main','published010':'published010','beforeHeld2a':'beforeHeld2a'}[c['id']])/'comparison.txt').read_text()
 console=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',console)
 counts=re.search(r'compared:\s*(\d+)\s+matched:\s*(\d+)',console)
 if counts:
  c['console_compared_count']=int(counts.group(1)); c['matched_count_reported_by_labs']=int(counts.group(2))
 for name in ('summary.md','comparison.txt'):
  if name=='comparison.txt': continue
 # include full operational command/exit receipts inline for indexability
 c['operator_exit_receipt']=json.loads((S/('labs-main' if c['id']=='main' else 'labs-published010' if c['id']=='published010' else 'labs-before-held')/'operator-exit.json').read_text())
# Final robust checksum list; include checksum JSON contents except the checksum manifest itself.
(B/'timing-evidence.json').write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
# Build final readable summary. Use exact data and raw console vs final summary counts separately.
lines=['# Physical byte elision: consolidated full Package Labs wave','',
'This is a factual, portable evidence bundle for three installed-package comparisons. It preserves raw Labs samples, per-file and per-block frequency readings, summaries, comparison text, install manifests/lockfiles, exact package archives, and pack/member evidence. No algorithm or acceptance verdict is assigned here.','',
'## Wave and method','',
'- Candidate archive SHA-256: `880255c15c9822ded79cc934dba755070348faf729bc96af9cd6f450a57cb332`; candidate shaper Wasm SHA-256: `52e6c93589926675c52bccf0d880b2005f9544d9322f4273af364ca47a7c2adb`. Frozen source HEAD is `ad6327d9199cedf88217f1098db3aeb439ec3e66`; pinned current main is `4e25a96a57462fef5ad0d19065a822695b480f60`.','- A timed the candidate once against main. B and C reused A’s `candidate.json`; its SHA-256 is `'+candidate_json_hashes['main']+'` for all three copied result files. Each reuse is confirmed in its runner log and manifest.','- All lanes used the `full` suite, 8 blocks, Labs 0.9.0, Apple M4, arm64-darwin, Node 24.18.0. p50 is the median of block medians. p95 is the pooled retained sample at zero-based `floor(0.95*(N-1))`. Raw `gc` and `heap` diagnostics are carried per row; heap fields are diagnostics and do not represent live/peak process memory.','- Runner status: A exit 0 / 2,639.886 s; B exit 0 / 1,411.132 s; C exit 0 / 1,247.336 s. Exact argv, start/finish epoch values and log path are in each `raw/<lane>/operator-exit.json`.','',
'## Raw console counts and final summary counts','',
'Console counts are before the runner subtracts timing-mode mismatches. Final counts are taken from the generated summary after those exclusions. These are separate stages.','',
'| Comparison | Raw console faster / slower / neutral / clock skips | Console compared / matched | Timing-mode exclusions | Final faster / slower / neutral / skipped | Comparable | Candidate-only unmatched |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
for c in d['comparisons']:
 raw=c['console_counts_before_harness_exclusions'];fin=c['final_summary_counts']
 lines.append(f"| {c['id']} | {raw['faster']} / {raw['slower']} / {raw['neutral']} / {raw['skipped']} | {c['console_compared_count']} / {c['matched_count_reported_by_labs']} | {len(c['timing_mode_mismatches'])} | {fin['faster']} / {fin['slower']} / {fin['neutral']} / {fin['skipped']} | {c['final_comparable_count']} | {len(c['unmatched_candidate_cases'])} |")
lines+=['','For every lane `baselineCheckFailures` is empty. Main: raw console 89/30/23 with 3 clock-confounded skips; after 4 timing-mode exclusions the final summary is 87/28/23 and 7 skipped (138 comparable). Published 0.1.0: raw console 96/26/21; after 3 mode exclusions the final summary is 95/24/21 and 3 skipped (140 comparable). The release archive lacks two candidate-only outline cases below; they are outside the 143 raw-console compared rows and the final 140 comparable rows (the console reports 145 total matched workload identities). Before-HELD: raw console 3/7/133 with 2 clock-confounded skips; after 3 mode exclusions final is 2/5/133 and 5 skipped (140 comparable).','',
'### Exact timing-mode exclusions','']
for c in d['comparisons']:
 lines.append(f"**{c['id']}**")
 for x in c['timing_mode_mismatches']: lines.append(f'- `{x}`')
 if not c['timing_mode_mismatches']: lines.append('- None.')
 lines.append('')
lines+=['### Unmatched case identities','',
'Published 0.1.0 has no outline fixtures for these two candidate-only workloads; they are listed explicitly and were not compared:','']
for c in d['comparisons']:
 if c['unmatched_candidate_cases']:
  for x in c['unmatched_candidate_cases']: lines.append(f'- `{x}`')
 else: lines.append(f"- `{c['id']}`: no unmatched baseline/candidate cases.")
lines+=['','## Clock evidence','',
'A’s two timed result captures and B’s baseline have no summary-level clock warning. C’s before-HELD baseline report carries the warning “baseline CPU clock drifted 9.6% during its run.” The bundle retains raw per-file run/post frequencies and per-workload per-block frequencies/spreads for all four unique timed captures (one candidate capture reused three times). The derived first-file-run to last-file-post values are separately labeled in JSON and should not be substituted for Labs’ warning calculation. Row-level local clock data accompanies every workload; no global drift label is used to erase unrelated rows.','',
'### Exact clock-confounded exclusions','']
for c in d['comparisons']:
 lines.append(f"**{c['id']}**")
 clock_rows=[r for r in c['rows'] if (r['final_classification'] or '').startswith('skipped: clock-confounded')]
 if clock_rows:
  for r in clock_rows: lines.append(f"- `{r['case']}` — {r['final_classification']}; raw console status: {r['console_classification']}")
 else: lines.append('- None.')
 lines.append('')
lines+=['## Four independent capture clock notes','',
'Only four unique timing captures exist: A baseline, A candidate, B baseline, and C baseline. Candidate timings copied by B/C are the same A capture. Summary clock warning and the separately derived environment boundary delta are shown side by side; do not treat them as the same statistic. Per-file and per-block records remain in the JSON.','',
'| Capture | Summary warning | First-file runFreq → last-file postFreq delta (derived from result environment) |','| --- | --- | ---: |']
for x in d['unique_timed_captures']:
 warns=next(c['clock_warnings_in_summary'] for c in d['comparisons'] if x['name'].startswith('main baseline') and c['id']=='main') if False else None
 boundary=x.get('first_run_to_last_post_frequency_drift_percent')
 label=x['name']
 if label=='before-HELD 2a7 baseline': warning='baseline CPU clock drifted 9.6% during its run'
 else: warning='none in summary header'
 lines.append(f"| {label} | {warning} | {boundary:.3f}% |")
lines+=['','## Seven fixed-family coverage','',
'The mapping below identifies candidate workload fixture coverage by exact benchmark labels; it does not claim isolated attribution. Each row has per-arm sample counts, p50/p95, block medians/frequencies/spreads, GC, heap, and final classification in `timing-evidence.json`.','',
'| Fixed family | Candidate workload count | Representative exact fixtures |','| --- | ---: | --- |']
for name,v in d['fixed_performance_family_coverage'].items():
 ex=v['candidate_workload_cases'][:3]
 lines.append(f"| {name} | {v['candidate_workload_count']} | {'; '.join('`'+x.split(' / ')[-1]+'`' for x in ex)} |")
lines+=['','## Before-HELD slower rows','',
'The five final slower rows remain in the raw evidence with their full 8-block medians, per-block clock frequencies/spreads, pooled samples and p95. These are workload observations from the unchanged frozen candidate result compared with the before-HELD package.','',
'| Workload | p50 baseline → candidate (ms) | p95 baseline → candidate (ms) | N baseline / candidate | p50 Δ | Console p / CI | Block frequency min–max GHz (baseline → candidate) |','| --- | ---: | ---: | ---: | ---: | --- | --- |']
slows=[r for r in ccomp['rows'] if r['final_classification']=='slower']
for r in slows:
 b,c=r['baseline'],r['candidate']; raw=r['console_classification'] or {}
 f1=b['block_frequency_ghz'];f2=c['block_frequency_ghz']
 fr=f"{min(f1):.3f}–{max(f1):.3f} → {min(f2):.3f}–{max(f2):.3f}"
 delta=(c['p50_median_of_block_medians_ms']-b['p50_median_of_block_medians_ms'])*1e3
 console=f"p={raw.get('p','not available')}; CI {raw.get('ci95','not available')}"
 lines.append(f"| {r['case']} | {b['p50_median_of_block_medians_ms']:.9f} → {c['p50_median_of_block_medians_ms']:.9f} | {b['p95_pooled_sample_ms']:.9f} → {c['p95_pooled_sample_ms']:.9f} | {b['sample_count_retained']} / {c['sample_count_retained']} | +{delta:.3f} µs | {console} | {fr} |")
lines+=['','## Dense 512/1024 and width inspection control rows','',
'These are exact HELD-control p50/p95 observations, not final verdicts. p95 is empirical and not a separate significance test.','',
'| Workload | Classification | p50 baseline → candidate (ms) | p95 baseline → candidate (ms) | N baseline / candidate |','| --- | --- | ---: | ---: | ---: |']
for r in selected:
 b,c=r['baseline'],r['candidate']
 lines.append(f"| {r['case']} | {r['final_classification']} | {b['p50_median_of_block_medians_ms']:.9f} → {c['p50_median_of_block_medians_ms']:.9f} | {b['p95_pooled_sample_ms']:.9f} → {c['p95_pooled_sample_ms']:.9f} | {b['sample_count_retained']} / {c['sample_count_retained']} |")
lines+=['','## Bundle contents','',
'- `timing-evidence.json`: all per-row results, block data, captures, exclusions, unmatched names, and saved-candidate proof.','- `raw/`: full raw result JSON, comparison text, summary, manifests, per-install locks/packages, and exact command logs/exit objects.','- `artifacts/`: candidate and baseline `.tgz` files, Wasm artifacts, and complete candidate package/member evidence.','- `sha256-manifest.json`: SHA-256 checksums and byte lengths for every other file.','- `derive.py`, `augment.py`: data derivation and packaging helpers.','']
(B/'README.md').write_text('\n'.join(lines)+'\n')
# Copy top-level helper scripts into the bundle (derive.py lives here; augment.py too).
# Manifest covers all package files and evidence except itself.
checks=[]
for p in sorted(B.rglob('*')):
 if p.is_file() and p.name!='sha256-manifest.json':
  checks.append({'path':str(p.relative_to(B)),'bytes':p.stat().st_size,'sha256':sha(p)})
(B/'sha256-manifest.json').write_text(json.dumps({'algorithm':'sha256','files':checks},indent=2)+'\n')
print('updated bundle',B)
print('candidate json hashes',candidate_json_hashes)
print('C slow rows',len(slows))
