from __future__ import annotations
import hashlib, json, math, re, shutil
from pathlib import Path
from collections import Counter

WORK = Path('/private/tmp/glyph-held-20261016')
SOURCE = WORK / '.cache/held-local-20261018/physical-byte-elision'
BUNDLE = Path('/private/tmp/glyph-held-wave-report-20261018/timing')
RAW = BUNDLE / 'raw'
ARTIFACTS = BUNDLE / 'artifacts'
for p in (RAW, ARTIFACTS): p.mkdir(parents=True, exist_ok=True)

COMPS = [
    ('main', 'labs-main', 'main-baseline/pmndrs-glyph-0.1.0.tgz', 'current-main 4e25a96a57462fef5ad0d19065a822695b480f60'),
    ('published010', 'labs-published010', 'prepare-receipt/package/pmndrs-glyph-published-0.1.0.tgz', 'published @pmndrs/glyph 0.1.0'),
    ('beforeHeld2a', 'labs-before-held', 'prepare-receipt/package/pmndrs-glyph-0.1.0.tgz', 'pre-HELD control 2a7f0317'),
]

def sha(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024), b''): h.update(block)
    return h.hexdigest()
def dump(path: Path, obj): path.write_text(json.dumps(obj, indent=2, ensure_ascii=False)+'\n')
def collect_runs(result):
    runs=[]
    for file in result.get('files',[]):
        for bench in file.get('benchmarks',[]):
            for run in bench.get('runs',[]):
                runs.append({'file':file.get('file'), 'group':bench.get('groupName'), 'name':run.get('name'), 'run':run})
    return runs

def p50_p95(stats):
    samples=sorted(stats.get('samples',[]))
    block_medians=sorted(stats.get('blocks',{}).get('medians',[]))
    p50=(block_medians[(len(block_medians)-1)//2] + block_medians[len(block_medians)//2])/2 if block_medians else None
    ix=math.floor(.95*(len(samples)-1)) if samples else None
    return p50, (samples[ix] if ix is not None else None), ix, len(samples), len(block_medians)

def run_key(r): return f"{r.get('file')} / {r.get('group')} / {r.get('name')}"
def metrics(r):
    if r is None: return None
    stats=r['run'].get('stats',{})
    p50,p95,ix,n,nb=p50_p95(stats)
    blocks=stats.get('blocks',{})
    return {
        'file':r.get('file'), 'group':r.get('group'), 'name':r.get('name'),
        'timing_mode':'batched' if stats.get('plan',{}).get('batch') else 'single-call',
        'sample_count_retained':n, 'block_count':nb,
        'p50_median_of_block_medians_ns':p50,
        'p50_median_of_block_medians_ms':None if p50 is None else p50/1e6,
        'p95_pooled_sample_ns':p95,
        'p95_pooled_sample_ms':None if p95 is None else p95/1e6,
        'p95_index_zero_based':ix,
        'p95_rule':'sorted pooled retained samples at floor(0.95*(N-1))',
        'sample_min_ns':stats.get('min'), 'sample_max_ns':stats.get('max'),
        'plan':stats.get('plan'),
        'block_medians_ns':blocks.get('medians'),
        'block_frequency_ghz':blocks.get('freqs'),
        'block_spreads':blocks.get('spreads'),
        'gc_diagnostics':stats.get('gc'),
        'heap_diagnostics':stats.get('heap'),
    }

ANSI=re.compile(r'\x1b\[[0-9;]*m')

def parse_md_rows(md):
    result={}
    for line in md.splitlines():
        if not line.startswith('|'): continue
        cells=[x.strip() for x in line.strip().strip('|').split('|')]
        if len(cells)<2 or cells[0] in ('status','---'): continue
        status=cells[0]
        if status.startswith('🔴 slower'): status='slower'
        elif status.startswith('🟢 faster'): status='faster'
        elif status=='neutral': status='neutral'
        elif status.startswith('skipped: '): status=status
        else: continue
        result[cells[1]]=status
    return result

def display_ns(value):
    m=re.fullmatch(r'(\d+(?:\.\d+)?)(ns|µs|us|ms|s)', value)
    if not m: return None
    scale={'ns':1,'µs':1e3,'us':1e3,'ms':1e6,'s':1e9}[m.group(2)]
    return float(m.group(1))*scale

def match_console_rows(path, runs_by_name):
    text=ANSI.sub('',path.read_text())
    pattern=re.compile(r'^ {2}([▲▼■]) (.+?)\s+(\S+)\s+(\S+)\s+([+-]?[\d.]+)%\s+[+-]?[\d.]+%\s+(\S+)\s+(\S+%)$',re.M)
    statuses={'▲':'faster','▼':'slower','■':'neutral'}
    out={}
    for m in pattern.finditer(text):
        mark, printed, base, cand, delta, p, ci=m.groups()
        prefix=printed[:-1] if printed.endswith('…') else printed
        candidates=[r for r in runs_by_name.values() if r['name'].startswith(prefix)]
        shown=display_ns(cand)
        if shown is not None:
            unit_match=re.fullmatch(r'(\d+(?:\.\d+)?)(ns|µs|us|ms|s)', cand)
            if unit_match:
                scale={'ns':1,'µs':1e3,'us':1e3,'ms':1e6,'s':1e9}[unit_match.group(2)]
                precision=len(unit_match.group(1).split('.')[1]) if '.' in unit_match.group(1) else 0
                tolerance=scale/(10**precision)/2
                candidates=[r for r in candidates if r.get('p50_ns') is not None and abs(shown-r['p50_ns']) <= tolerance]
        if len(candidates)==1:
            out[run_key(candidates[0])]={'status':statuses[mark],'baseline_printed':base,'candidate_printed':cand,'delta_p50_percent':float(delta),'p':p,'ci95':ci}
    return out

def console_counts(text):
    plain=ANSI.sub('',text)
    m=re.search(r'^summary\s+(?:(\d+) faster\s+)?(?:(\d+) slower\s+)?(?:(\d+) neutral\s+)?(?:(\d+) skipped)?',plain,re.M)
    return None if not m else {'faster':int(m.group(1) or 0),'slower':int(m.group(2) or 0),'neutral':int(m.group(3) or 0),'skipped':int(m.group(4) or 0)}
def summary_counts(md):
    m=re.search(r'^(\d+) faster · (\d+) slower · (\d+) neutral · (\d+) skipped$',md,re.M)
    return None if not m else {'faster':int(m.group(1)),'slower':int(m.group(2)),'neutral':int(m.group(3)),'skipped':int(m.group(4))}

def capture_summary(result):
    freqs=result.get('environment',{}).get('freqs',[])
    if not freqs: return {'timestamp':result.get('timestamp'),'git':result.get('git'),'hardware':result.get('hardware'),'runtime_environment':result.get('environment')}
    start=freqs[0].get('runFreq'); end=freqs[-1].get('postFreq')
    global_drift=None if not start else (end/start-1)*100
    per_file=[]
    for f in freqs:
        a=f.get('runFreq'); b=f.get('postFreq')
        per_file.append({**f,'within_file_drift_percent':None if not a else (b/a-1)*100})
    return {'timestamp':result.get('timestamp'),'git':result.get('git'),'hardware':result.get('hardware'),'runtime_environment':result.get('environment'),'first_run_to_last_post_frequency_drift_percent':global_drift,'per_file_frequency_drift':per_file}

comparisons=[]
for cid, report_name, baseline_rel, baseline_label in COMPS:
    report=SOURCE/report_name
    dst=RAW/cid
    if dst.exists(): shutil.rmtree(dst)
    shutil.copytree(report,dst)
    baseline=json.loads((report/'baseline.json').read_text())
    candidate=json.loads((report/'candidate.json').read_text())
    manifest=json.loads((report/'manifest.json').read_text())
    md=(report/'summary.md').read_text()
    console=(report/'comparison.txt').read_text()
    b_runs=collect_runs(baseline); c_runs=collect_runs(candidate)
    b_by={run_key(x):x for x in b_runs}; c_by={run_key(x):x for x in c_runs}
    # candidate names are unique in the exact result; use them to resolve Labs' console truncation.
    cand_name_lookup={}
    for r in c_runs:
        p50,_,_,_,_=p50_p95(r['run'].get('stats',{})); r['p50_ns']=p50
        cand_name_lookup[r['name']]=r
    b_name_lookup={r['name']:r for r in b_runs}
    final_status=parse_md_rows(md)
    raw_console=match_console_rows(report/'comparison.txt',cand_name_lookup)
    timing_modes={}
    for mismatch in manifest.get('notComparable',{}).get('timingModeMismatches',[]):
        label,mode=mismatch.split(': ',1)
        timing_modes[label]=mode
    labels=sorted(set(b_by)|set(c_by))
    rows=[]
    for label in labels:
        b=b_by.get(label); c=c_by.get(label)
        visible_name=(c or b).get('name')
        status=final_status.get(visible_name)
        if status is None and c is not None and b is None:
            status='unmatched candidate: absent from baseline'
        if status is None and b is not None and c is None:
            status='unmatched baseline: absent from candidate'
        if status is None:
            status='not listed by comparison summary'
        reason=status if status.startswith('skipped: ') else (status if status.startswith('unmatched ') else None)
        # The saved-candidate summary renders mismatch rows by run name; retain exact file-qualified mismatch reason.
        exact_modes=[value for key,value in timing_modes.items() if key == label]
        if exact_modes: reason='timing mode mismatch: '+exact_modes[0]
        rows.append({
            'case':label,
            'baseline_present':b is not None,
            'candidate_present':c is not None,
            'final_classification':status,
            'final_exclusion_reason':reason,
            'console_classification':raw_console.get(label),
            'baseline':metrics(b),
            'candidate':metrics(c),
        })
    count=summary_counts(md)
    cconsole=console_counts(console)
    unmatched_b=sorted(run_key(r) for r in b_runs if run_key(r) not in c_by)
    unmatched_c=sorted(run_key(r) for r in c_runs if run_key(r) not in b_by)
    clock_alerts=re.findall(r'^> ⚠ (.+)$',md,re.M)
    comparisons.append({
        'id':cid,
        'timed_comparator':f'{baseline_label} → frozen candidate 880255c1',
        'baseline_artifact':manifest.get('baseline'),
        'candidate_artifact':manifest.get('candidate'),
        'saved_candidate_path':manifest.get('savedCandidate'),
        'suite':manifest.get('suite'),'blocks_requested':manifest.get('blocks'),'labs_version':manifest.get('labsVersion'),
        'harness_digest':manifest.get('harnessDigest'),
        'baseline_capture':capture_summary(baseline),'candidate_capture':capture_summary(candidate),
        'baseline_check_failures':manifest.get('notComparable',{}).get('baselineCheckFailures',[]),
        'timing_mode_mismatches':manifest.get('notComparable',{}).get('timingModeMismatches',[]),
        'clock_warnings_in_summary':clock_alerts,
        'console_counts_before_harness_exclusions':cconsole,
        'final_summary_counts':count,
        'final_comparable_count':sum((count or {}).get(k,0) for k in ('faster','slower','neutral')),
        'matched_count_reported_by_labs':int(re.search(r'matched:\s*(\d+)',ANSI.sub('',console)).group(1)) if re.search(r'matched:\s*(\d+)',ANSI.sub('',console)) else None,
        'unmatched_baseline_cases':unmatched_b,
        'unmatched_candidate_cases':unmatched_c,
        'rows':rows,
    })

# Copy immutable package archives and candidate package/size/source receipts.
ART_SPECS=[
 ('candidate-880255c1.tgz', SOURCE/'package/pmndrs-glyph-0.1.0.tgz'),
 ('main-4e25a96a-bbb3375c.tgz', WORK/'.cache/held-local-20261016/main-baseline/pmndrs-glyph-0.1.0.tgz'),
 ('published-0.1.0-6e2bf7bd.tgz', WORK/'.cache/held-local-20261016/prepare-receipt/package/pmndrs-glyph-published-0.1.0.tgz'),
 ('before-held-2a7f0317.tgz', WORK/'.cache/held-local-20261016/prepare-receipt/package/pmndrs-glyph-0.1.0.tgz'),
]
for name,src in ART_SPECS: shutil.copy2(src,ARTIFACTS/name)
for name in ('package-evidence-final.json','dist-before-pack.json','package-evidence.json'):
    src=SOURCE/'package'/name
    if src.exists(): shutil.copy2(src,ARTIFACTS/name)
shutil.copy2(WORK/'packages/glyph/.cache/physical-byte-elision-named/candidate.wasm', ARTIFACTS/'candidate-named-wasm-52e6c935.wasm')
shutil.copy2(WORK/'packages/glyph/.cache/physical-byte-elision-memory/text-shaper.control.wasm', ARTIFACTS/'before-held-wasm-52e6c935.wasm')

bundle={
 'format':'glyph-installed-package-full-labs-wave-v1',
 'generated_utc':'2026-10-18T06:55:00Z',
 'source':{
   'worktree':'/private/tmp/glyph-held-20261016','head':'ad6327d9199cedf88217f1098db3aeb439ec3e66','tracked_worktree_clean':True,
   'pinned_current_main':'4e25a96a57462fef5ad0d19065a822695b480f60',
   'candidate_source_package_evidence':'artifacts/package-evidence-final.json',
   'candidate_source_runtime_unchanged_from_previous_head':True,
   'candidate_rust_shaper_source_tree':'9aafc52c10cd76b6e4868048859b3bb70081d41b',
   'candidate_full_rust_tests':569,'candidate_ignored_test':1,'candidate_node_tests':1084,'minimum_peer_tests':55,'prepared_operations_checks':30,
 },
 'artifacts':{
   'candidate':{'file':'artifacts/candidate-880255c1.tgz','sha256':'880255c15c9822ded79cc934dba755070348faf729bc96af9cd6f450a57cb332','wasm_sha256':'52e6c93589926675c52bccf0d880b2005f9544d9322f4273af364ca47a7c2adb'},
   'current_main':{'file':'artifacts/main-4e25a96a-bbb3375c.tgz','sha256':'bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20','source_commit':'4e25a96a57462fef5ad0d19065a822695b480f60'},
   'published010':{'file':'artifacts/published-0.1.0-6e2bf7bd.tgz','sha256':'6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b'},
   'beforeHeld2a':{'file':'artifacts/before-held-2a7f0317.tgz','sha256':'2a7f0317a49319203aac935a8d7387eafcc9f78443ff6de31c699c4605412627','wasm_sha256':'52e6c93589926675c52bccf0d880b2005f9544d9322f4273af364ca47a7c2adb'},
 },
 'method':{'suite':'full','blocks':8,'p50':'median of retained block medians','p95':'pooled retained sample sorted ascending at zero-based floor(0.95*(N-1))','candidate_timed_once_in_main_then_reused_byte_for_byte_in_published010_and_beforeHeld2a':True},
 'comparisons':comparisons,
}
dump(BUNDLE/'timing-evidence.json',bundle)
# Hash every collected input/output except the checksum manifest itself.
checks=[]
for p in sorted(BUNDLE.rglob('*')):
    if p.is_file() and p.name!='sha256-manifest.json': checks.append({'path':str(p.relative_to(BUNDLE)),'bytes':p.stat().st_size,'sha256':sha(p)})
dump(BUNDLE/'sha256-manifest.json',{'algorithm':'sha256','files':checks})

# Human skim report with final counts/exclusions and the five HELD-control slower rows.
lines=['# Physical byte elision: consolidated full Package Labs wave','',
       'This bundle preserves all three complete installed-package comparisons, logs, manifests, lockfiles, package-before/after receipts and exact package archives. It is a factual evidence packet; no acceptance verdict is assigned here.','',
       'The candidate was measured only in A (main → candidate). B and C reuse A’s exact saved `candidate.json`; A/B/C candidate JSON hashes are checked separately in this bundle. All runs used `full`, 8 blocks, Labs 0.9.0, Apple M4, arm64-darwin, Node 24.18.0.','',
       '| Comparator | Console before post-filter | Final comparison summary | Captured clock note |','| --- | --- | --- | --- |']
for c in comparisons:
    raw=c['console_counts_before_harness_exclusions']; fin=c['final_summary_counts']
    raw_s='unavailable' if raw is None else f"{raw['faster']} faster / {raw['slower']} slower / {raw['neutral']} neutral / {raw['skipped']} console skipped"
    fin_s='unavailable' if fin is None else f"{fin['faster']} faster / {fin['slower']} slower / {fin['neutral']} neutral / {fin['skipped']} skipped; {c['final_comparable_count']} comparable"
    clk='; '.join(c['clock_warnings_in_summary']) or 'No summary-level clock warning'
    lines.append(f"| {c['id']} | {raw_s} | {fin_s} | {clk} |")
lines+=['','## Exclusions and unmatched workloads','']
for c in comparisons:
    lines.append(f"### {c['id']}")
    lines.append('')
    for x in c['timing_mode_mismatches']: lines.append(f'- Timing-mode mismatch: `{x}`')
    for r in c['rows']:
        if (r['final_classification'] or '').startswith('skipped: clock-confounded'):
            lines.append(f"- Clock-confounded: `{r['case']}` — {r['final_classification']} (raw console {r['console_classification']})")
    for x in c['unmatched_candidate_cases']: lines.append(f'- Candidate-only unmatched row: `{x}`')
    for x in c['unmatched_baseline_cases']: lines.append(f'- Baseline-only unmatched row: `{x}`')
    lines.append('')
lines+=['## Before-HELD control slow rows','']
slow=[r for r in comparisons[2]['rows'] if r['final_classification']=='slower']
lines.append(f"There are {len(slow)} final slower rows out of {comparisons[2]['final_comparable_count']} comparable cases. The detailed JSON contains per-file boundaries, per-block clock frequencies/spreads, retained p50/p95 samples and counts for each row.")
lines.append('')
lines.append('| Workload | p50 baseline → candidate (ms) | p95 baseline → candidate (ms) | Retained samples baseline / candidate | Baseline ↔ candidate file |')
lines.append('| --- | ---: | ---: | ---: | --- |')
for r in slow:
    b=r['baseline'];c=r['candidate']
    lines.append(f"| {r['case']} | {b['p50_median_of_block_medians_ms']:.6f} → {c['p50_median_of_block_medians_ms']:.6f} | {b['p95_pooled_sample_ms']:.6f} → {c['p95_pooled_sample_ms']:.6f} | {b['sample_count_retained']} / {c['sample_count_retained']} | {b['file']} ↔ {c['file']} |")
lines+=['','## Files','',
        '- `timing-evidence.json`: per-workload p50/p95, retained sample counts, block medians, block frequency/spread, GC/heap diagnostics, capture environments, classification and exclusions.','- `raw/`: full logs, comparisons, summaries, package manifests and lockfiles for A/B/C.','- `artifacts/`: exact candidate and baseline package archives, candidate pack evidence and Wasm artifacts.','- `sha256-manifest.json`: checksums for every other file in this directory.','']
(BUNDLE/'README.md').write_text('\n'.join(lines))
# Refresh checksum manifest to include README itself (derive.py is intentionally listed too).
checks=[]
for p in sorted(BUNDLE.rglob('*')):
    if p.is_file() and p.name!='sha256-manifest.json': checks.append({'path':str(p.relative_to(BUNDLE)),'bytes':p.stat().st_size,'sha256':sha(p)})
dump(BUNDLE/'sha256-manifest.json',{'algorithm':'sha256','files':checks})
print(BUNDLE)
print('comparisons',len(comparisons))
for c in comparisons:
    print(c['id'],c['console_counts_before_harness_exclusions'],c['final_summary_counts'],'unmatched baseline',len(c['unmatched_baseline_cases']),'candidate',len(c['unmatched_candidate_cases']))
print('C slower rows:')
for r in slow: print(r['case'],r['baseline']['p50_median_of_block_medians_ms'],r['candidate']['p50_median_of_block_medians_ms'],r['baseline']['p95_pooled_sample_ms'],r['candidate']['p95_pooled_sample_ms'],r['baseline']['sample_count_retained'],r['candidate']['sample_count_retained'])
