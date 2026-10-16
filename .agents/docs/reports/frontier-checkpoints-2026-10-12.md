---
type: Engineering Evidence
title: Archived publication frontier checkpoints
description: Historical source, validation and benchmark checkpoints superseded by the compact task tracker.
status: deprecated
sources:
  - resource: ../planning/publication-frontier.md
    title: Current task tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-16T15:13:08Z'
---

# Archived publication frontier checkpoints

These are historical checkpoints preserved from the formerly oversized task tracker. Earlier live handles, partial validations and unchecked tasks are snapshots, not current readiness. The current resume state lives in the linked compact tracker.

## Archived publication frontier checklist

## Active goal — retained preparation and publication, 12 October 2026

Implement the accepted [preparation/publication decision](../planning/decisions/retained-prepare-publish.md) in
`.cache/publication-range-spike`, preserving its existing work. Bound setters prepare changed Rust layout once;
queries read it; split independently materializes it; publish consumes accumulated dirty data and performs renderer
work. One data layout and executor, unchanged public APIs, batching intact. Prior-buffer reuse is input/scratch, not
rollback. Keep #292 unmerged; no stable release/tag or demo merge. The parent owns integration and one heavy lane.

1. [x] Record accepted contract and reconcile active plans; speculative-query plan replaced.
2. [x] Rust slice: audit and finish durable prepared revision/dirty ownership, ensuring publication does not repeat layout.
3. [x] TypeScript slice: setters, read caches, and copies consume that revision; retire duplicate query/preparation work.
4. [x] Regression slice: deterministic cold parity and seeded lifecycle/edit sequences; distinguish preparation, reads,
       copy materialization, and publication with crossing/work invariants rather than implementation-shaped snapshots.
5. [x] Integrate/review all diffs and retire old paths. Run focused tests, native/Node/static checks, failure/rebuild controls.
6. [ ] Freeze one candidate; measure set-only, same-value, overwrite, set/read, set/read/publish, set/split against frozen
       main and published 0.1.0. Include 1/100/1,000 labels, trailing spans, count changes and scattered ASCII edits.
7. [ ] Record absolute timing deltas, source retirement, production additions/deletions, raw/gzip Wasm and JS delivery sizes.
       Attribute and resolve growth; no permanent duplicate implementation.
8. [ ] Verify browser benchmark scenes and batched/standalone visuals using Portless; update draft readiness evidence.
       Complete the six fresh Sol High reduction passes below before readiness. HOLD UNMERGED.

Implementation gates 2–5 are distinct from final readiness. Evidence: Rust's `commit_measure` adopts the prepared
revision without advancing renderer revision; existing dirty owners survive until publication. The host's
`#compileFrame` sends empty semantic mutation sections and defaults to no semantic readback. Cached measurement and
the single core inspection owner serve reads; split owns its copied layout. Native preparation-count and intrinsic
work tests, seeded cold parity, sibling-fault recovery, rejection/replay, source/copy lifetimes and Unicode suites
pass at the checkpoints below. Latest rebuilt Node suite is 1,023/1,023 and static/declaration gates pass. Gates 6–8
remain open: current full comparisons, cumulative size attribution, browser benchmark visuals and held-stack evidence.

## Review gate for every wave

The parent reviews actual diffs and ownership/call flow before accepting agent output. Check correctness, retained
state/lifetime boundaries, validation, allocations and hot-path work, public/ABI impact, and removal of superseded paths.
Keep modules with their existing owners; avoid parallel executors, speculative abstractions, long explanatory comments,
and duplicated test coverage. Correct findings before advancing. A passing test count alone is not acceptance.

Freeze the reviewed source and compare exact artifacts before performance claims. Report absolute timing changes and
raw/compressed runtime size. Attribute every increase and either simplify it or establish measured benefit; unexplained
regressions remain open. Native, focused integration, seeded/cold oracles, static checks, and visual controls must match
the wave's scope. Update package knowledge and evidence after integration, not from agent summaries.

## Required reduction phase — six fresh Sol High runs

After integrated correctness/performance gates stabilize and an exact control artifact is frozen, perform at least six
fresh native Sol High subagent runs before declaring the held stack ready. All six scopes below completed at the
six-pass checkpoint; final performance, size and readiness gates remain open. Each run starts with a bounded
scope and current evidence, receives no stale advisor transcript, and is retired at the end of its topic. Use native
subagents, not ai-cli, for these models. Parent reviews all findings/diffs; one heavy verification lane.

The target is a smaller first-party Rust program and simpler ownership across work divisions. Treat source or Wasm
growth as evidence to investigate added orchestration, duplicate state, unnecessary copying, generics/codegen expansion,
and parallel paths. Reusing existing parts is insufficient if the change merely glues more work together. Keep required
Unicode/shaping support, validation, and public behavior; never trade correctness for a smaller number.

| Fresh run | Bounded ownership and goal                                                                                                                                                       | Evidence required                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1         | Rust retained state/preparation: unify accepted/prepared ownership, dirty journals and lifecycle settlement; remove obsolete candidate/undo/bookkeeping paths                    | State transition trace, retired state/functions, failure/cold parity                                |
| 2         | Rust rope/Unicode/shaping/layout consumers: collapse repeated traversal and copying around existing summaries; inspect monomorphic duplication without adding generic frameworks | One call/data path, no duplicate executor, Unicode/oracle/seeded edit checks                        |
| 3         | Rust gather/Codec/render-plan compiler: consolidate range mapping, row/slot ownership and patch compilation; retire root/suffix rediscovery and duplicated packing helpers       | Dirty-range/batch/order invariants, sparse/dense and count-change parity                            |
| 4         | TypeScript setters, queries and copies: remove redundant normalization, snapshot/encoding/preparation work and duplicate cache authority                                         | Crossings, validation boundary, split identity/lifetime and prepared-read tests                     |
| 5         | ABI/transport and host adapters: simplify result views, adoption and resource lifetime glue; keep Three/TypeGPU as consumers of canonical renderer records                       | Explicit ownership, immutable in-flight bytes, batching/order and relevant live checks              |
| 6         | Cross-boundary consolidation: trace set→Rust→query/copy→Codec→host end to end; remove duplicated semantics and orphaned paths introduced between agent scopes                    | Full residual-use inventory, reachable production paths, cumulative size/performance reconciliation |

Each run first reports concrete reduction opportunities read-only, with exact symbols, deletion targets and independent
checks. Reconcile before bounded edits. No commits or API/dependency churn from agents. Prefer removal/consolidation of
an existing system over extracting a new layer. Concise invariant comments only; consolidate duplicate tests while
retaining their distinct oracles. A pass with no safe finding documents its search and evidence rather than inventing
churn. Track all six completed runs, including clean findings; do not count a reused/stale session as fresh.

For each accepted slice: parent reviews the actual diff, verifies focused regressions/static checks, measures production
additions/deletions and raw/gzip Wasm and JS delivery sizes against the immediate frozen control, and runs scoped Labs.
After all six, run cumulative correctness, browser visual, release comparison, size, and maintainability gates. Any
remaining growth needs source/codegen attribution, measurable benefit, and explicit maintainer acceptance. Ropes remain
unmerged throughout.

- [x] Fresh Sol High run 1: Rust retained-state/preparation reduction.
- [x] Fresh Sol High run 2: rope/Unicode/shaping/layout reduction.
- [x] Fresh Sol High run 3: gather/Codec/compiler reduction.
- [x] Fresh Sol High run 4: TypeScript setter/query/copy reduction.
- [x] Fresh Sol High run 5: transport/adapter glue reduction.
- [x] Fresh Sol High run 6: end-to-end boundary consolidation.
- [ ] Cumulative correctness/performance/size review and held-stack readiness.

## Reduction integration

All six fresh Sol High reviews completed and were reconciled against actual source. The first three Rust slices pass
427 native plus outline/Unicode tests, 1,018 rebuilt Node tests and static checks, with the frozen size evidence below.
Pass 4 removes a duplicate split inspection, duplicate bounds writes and the duplicate private ink-measure executor
(production net −12). Pass 5 removes dead generation state, unreachable adoption-marker recovery and an unused limit
argument (production net −30, tests net −93); real decoder, replay, callback and lease failure checks remain.

Parent implemented pass 6's intrinsic reuse in the existing inspection owner: one closed mode selects no intrinsic
layout, retained flow or retained positioned inspection. No added executor or cache owner. Repeated reads and explicit
semantic publication reuse this state; geometry/text changes and root reset invalidate it through the existing stages.
The focused regression compares cold semantic output, preserves same-source identities across publication, counts zero
repeated intrinsic preparation and tests clipping, max-lines truncation, ellipsis and clipping exit. It passes.
The integrated six-pass checkpoint passes static gates, all 427 native unit tests plus outline/Unicode suites, and
1,017 rebuilt Node tests. Frozen package `2a015004` has shaper 1,605,525 raw / 593,415 gzip9 bytes: −5,320/−1,361
against wave 1. Its full Labs run stopped on an obsolete candidate-only private span-helper assertion; it provides no
completed performance verdict. The harness is corrected and saved reports now authenticate actual worktree inputs.

An additional cache review reproduced stale unchanged-sibling IDs after a post-preparation fault, before and after
recovery publication, on the pre-correction package. Parent corrected the new test's cold-fixture invocation and made
the two sequences independent. Three's separate inspection cache is retired in favor of the existing core owner;
outline readers attach once, public arrays remain copied, and renderer readiness includes checkpoint identity.
The rebuilt correction passes 1,020 Node tests, including both stale-identity sequences. Full-suite review caught and
corrected outline reader enumerability; copied columns retain their plain-data contract. Frozen package `1860002c`
retains the six-pass Wasm bytes and sizes. Latest cumulative Labs and benchmark-suite visual gates remain pending.

ASCII preview now uses this ropes source and rebuilt Wasm through optional `GLYPH_PREVIEW_ROOT`, preserving the demo
checkout's main history. A Chrome 155/DPR1 Fjord profile records flat/depth live 19.3/20.1 FPS, assignment-held both
59.0 FPS. Source URLs prove ropes runtime provenance. Flat live weighted samples attribute 1,166.8 ms to formatting,
3,086.9 ms to Text.set (including 1,086.1 ms preparation and 793.3 ms style compilation), 424.9 ms to the
shape/publication batch, and 616.4 ms to GC across 69 updates. Inclusive categories overlap; these are sampled CPU
observations, not a release A/B or universal frame budget. Report lives in the hero checkout's
`benches/.cache/ascii-profile/summary.md`. Next bounded work: reuse authored immutable span factories and reduce actual
changed-record binding/encoding cost in the shared setter path. Attribute remaining Rust preparation with authenticated
symbol diagnostics. One heavy lane; ropes remain held unmerged.

The next measured slice implements weakly owned immutable color/material span factories in the hero, lazy graph
correspondence in the same property-equality walker, and bounded UTF-8 scratch for ID hashing. Focused rebuilt tests
pass 30/30; the expanded 15-scene oracle checks original characters/colors plus formatted coverage and material changes.
Sequential Chrome/DPR1 captures record flat/depth 19.3/20.1→33.6/33.3 FPS, median frame interval 66.7→16.7 ms and
p95 83.3→50.0 ms. Approximate sampled formatting/setter costs fall 16.9/44.7→2.7/38.0 ms per update; preparation and
publication remain near 15/6 ms. Primitive equality's inclusive samples do not improve in the combined trace; isolated
Labs must decide its benefit. The preserved report is `benches/.cache/ascii-profile-span-reuse/summary.md` in the hero.

Parent then retired `resolvedTextLeases`: the producer already records every acquisition for failure cleanup, so the
same list now transfers to its lifetime owner instead of rediscovering leases through a second span walk. No new
ownership/cache system. Static gates pass; this later cleanup still needs rebuilt lifetime/full-package checks and is
excluded from the profile above. Freeze the resulting package and run current-main/full release Labs, then benchmark
visual and live raster/transition gates. No merge or release.

Lease-ledger build now passes all 1,023 Node tests and the fresh emitted-declaration/static gates. Frozen package
`e2cb331a` has the same shaper bytes (`fad95b05`), 1,605,525 raw / 593,415 gzip9. The three library files in this
assignment slice are +48/−46 lines versus `1860002c`; their emitted modules together add 39 raw / 50 gzip bytes
(individual modules measured separately, not a delivery bundle). Full current-main Labs is live in tool session 93568,
log `/tmp/glyph-lease-ledger-main-full.log`, output `.cache/retained-prepare-publish-wave1/lease-ledger-main-full`.
Main was reverified unchanged at `2f62d6ba`; baseline package `c2ea9cef`. No other heavy validation lane overlaps it.
Reuse this exact candidate result for the published 0.1.0 full comparison once its manifest is valid; do not time the
candidate again. Latest live browser raster/transition and benchmark-suite visual checks still remain.

The full main comparison is terminal zero: 30 faster / 26 slower / 48 neutral / 7 timing exclusions, 104 comparable
workloads and no reported correctness errors. Median workload p50 is 2.065→1.395 ms. CPU-clock calibration drift is
61.3% baseline / 59.6% candidate, so this is diagnostic evidence, not performance clearance. Material observations
include grouped rewrites (64 labels 2.19→4.64 ms, 512 labels 11.68→20.99 ms), 1,024-label rewrite/publication
22.96→34.83 ms, and 22k-glyph cold mount 24.79→31.40 ms. Immediate-read/publication loops improve substantially:
1,000 labels/100 interleaved edits 198.47→73.33 ms; immediate-measure/publication 143.45→36.41 ms. Keep both sides
visible. Investigate batched preparation and large-paragraph/cold costs; do not dismiss the regressions as drift.
Published 0.1.0 baseline-only full comparison is started with this exact saved candidate and unchanged harness digest,
log `/tmp/glyph-lease-ledger-release-full.log`; no duplicate candidate timing. Its clock-confounded candidate remains
explicit. Readiness stays open until scoped confirmation/profiling and the remaining visual/size gates are resolved.

The saved-candidate 0.1.0 comparison is terminal zero. After two timing-mode exclusions, the report is 37 faster /
27 slower / 38 neutral / 7 excluded (102 comparable). Median workload p50 2.980→2.600 ms; calibration drift 20.5%
old release / 59.6% candidate. Not performance clearance. All-label rewrites recur: 512 labels 11.67→20.99 ms;
1,024 labels 21.95→34.83 ms. The latter benchmark's name says publication but its timed body rewrites every label;
it is a warm batched-update workload, not a cold constructor measurement. One-character edit plus measurement of a
long paragraph is also observed slower, 0.911→4.490 ms, requiring focused confirmation. Absolute values, exclusions and
all rows remain in `.cache/retained-prepare-publish-wave1/lease-ledger-release-full/summary.md`.

Next one-heavy-lane task: `glyph:shaper-profile-artifact` authenticates named Wasm against exact package `e2cb331a`,
output `.cache/retained-prepare-publish-wave1/lease-ledger-named`, log `/tmp/glyph-lease-ledger-named.log`. It must
prove identical optimized executable sections before a named profile can attribute the remaining Rust preparation
and warm batched-update costs. No implementation changes are justified by unnamed Wasm function numbers alone.

### Duplicate Unicode preparation and comparison follow-up

The named diagnostic artifact proves release and executable SHA-256 both equal `fad95b050d9913b4653fa115f4e8df4983b81a2f5311aeb88209cfd3b527b10e`.
The preserved ASCII CPU capture assigns `UnicodeAnalysis::analyze` about 121.6 ms of self samples to planner input
validation and 123.1 ms to paragraph preparation. These are sampled totals across the capture, not per-set wall times.
Both setter preparation and ordinary updates reconstruct/analyze candidate text in preflight and again in the shared
paragraph prefix. The accepted next reduction preserves complete request preflight, then transfers its candidate text
and Unicode result into the existing staged owners. No durable paragraph-ID cache or second Unicode analyzer is allowed;
reuse of allocation capacity and existing ASCII proofs must survive. Native Luna implementation is bounded to that prefix.

The prior 21-faster/zero-slower result covers 45 edit-sized workloads on package `36fb3b75`; the latest full comparison
covers 104 workloads on `e2cb331a`. Counts alone cannot establish a recent backslide. All-label rewrite workloads were
absent from the earlier narrow suite. Some overlapping color cases also worsened between runs, so a frozen old-versus-new
candidate comparison is required rather than attributing every slower row to added coverage or clock drift. The first
focused comparison uses the unchanged batch suite, four blocks, output `old-new-batch`, log `/tmp/glyph-old-new-batch.log`.

That direct frozen old/new batch comparison is terminal zero: all seven workloads neutral, including 512-label rewrite
17.18→17.18 ms and 1,024-label rewrite/publication 32.97→34.03 ms. The corresponding `old-new-edit-sized` comparison is
also terminal zero: all 47 workloads neutral. These scoped comparisons do not establish parity against main; they
attribute the large full-suite weaknesses to the broader branch rather than showing a material recent cleanup backslide.
Markdown name restoration was corrected using raw candidate block medians. The main full report had misnamed the
6.49→6.12 ms publication row as measurement because measurement was excluded and both printed names shared a prefix.
The corrected reports preserve raw results, manifests and counts. The new summary workflow and regression pass benchmark
static gates and all nine release-comparison tests.

The authenticated `bulk-write-before-unicode` profile performs 1,024 sets plus immediate measurements and one publication
per iteration, 50 iterations after 10 warmups. Wall p50 is 27.60 ms, p95 35.29 ms. Inclusive Rust preparation samples total
663.25 ms, render publication 218.21 ms, shaping 187.50 ms and Unicode 31.00 ms. These overlap and are not additive or
frame times; immediate reads distinguish this probe from the no-read Labs rewrite case. Unicode consolidation alone
cannot resolve the short-label bulk cost. Its initial native patch grew +263 production lines; parent review rejected
third retained buffer capacity, linear candidate lookup, repeated cleanup sites and invalid-state flags. Revision toward
request-local ownership and existing stage buffers is in flight. Focused crossing-style publication preflight passes;
independent Unicode/late-input tests, reduction, binary build and post-change timings remain required.

The latest live hero verification passed all 15 scenes, Slug/MTSDF/Bitmap, projection switching, camera interaction and
continued scene animation under reduced motion. The final Taj dawn screenshot was inspected: scene, text overlay and
controls render coherently. This checks this preview's behavior; benchmark-app A/B visuals and HiDPI remain separate gates.
Evidence lives in the hero checkout under `benches/.cache/ascii-live`; terminal log `/tmp/ascii-ropes-live-final.log`.

## Wave 1 checkpoint — review and measurement in progress

- Rust: reuse cluster intrinsic-width results for unchanged prepared input; no-op measurement keeps its preparation
  revision while the query generation still rejects stale witnesses. Existing publication dirty-owner assertions retained.
- TypeScript: validated same-value plain-text updates skip preparation unless rebuild is pending; renderer-only no-op
  candidates keep inspection caches. Queued removals and changed bindings still use normal settlement.
- Parent review corrected an edited-vs-cold test that initially compared two fresh roots. Replaced an invalid hierarchy
  reorder fixture with the supported grouped Text.renderOrder trigger; existing rendered-order coverage remains authority.
- Build passes; native 425 unit plus outline/Unicode suites and rebuilt focused Node 41/41 pass. Combined static checks
  pass after the parent removed an obsolete lifecycle closure and corrected a test initializer. Broader package/browser,
  timing and size acceptance remain open. Final source rebuild completed;
  the initial equivalent-style request capture and same-font preparation count failures were source-traced as obsolete
  assertions after redundant preparation removal. Request-count and measurement-reuse assertions now prove the no-op,
  and a distinct Amiri font matches a cold handle. Final rebuilt full Node passes 1,018/1,018; focused corrections 11/11
  and 141/141; final native passes 425 plus outline/Unicode. No production fix or behavior waiver was needed.
- Frozen pre-parent-cleanup package a1f6d7d7e8521c3912d5513b207c5ab1e7d6416fd5d57c478deef5e2675f317f:
  shaper 1,611,014 raw / 594,858 gzip9. Immediate saved control efa4c1f…: 1,610,434 / 594,435.
  Delta +580 raw / +423 gzip9; unresolved pending benefit or simplification. One diagnostic same-value set/read profile
  is about 0.8–0.9 microseconds on both controls; no timing win is claimed. Intrinsic reuse is reachable on paint-only
  setters that request measurements with unchanged clusters; the next paired suite targets that real public path. JS raw-file sum +153 bytes is not a delivery
  bundle metric. Exact artifact/size evidence in .cache/retained-prepare-publish-wave1/size-evidence.json.
- Final reviewed-source artifact 36fb3b756e97909807278d37543bf0c84811d72c754789a31aec10b9ad20652b:
  shaper 1,610,845 raw / 594,776 gzip9, +411/+341 against the saved immediate control. Source patch dcde4d01…
  and size evidence are frozen in .cache/retained-prepare-publish-wave1/final. Parent closure cleanup reduces 169 raw
  and 82 gzip bytes from the earlier wave artifact. Growth remains unresolved. Narrow style suite four-block rerun is 0 faster/0 slower/3 neutral, but baseline clock
  drift 12.6% limits timing resolution; no speedup/parity claim. The first style run overlapped an accidentally launched
  agent package check and is explicitly excluded in its INVALID-TIMING.md. The stray process was confirmed absent at
  2026-10-12T11:54:19Z. Setter-only profiling now has a distinct boundary with zero timed layout reads/publications.

## Integrated main comparison — frozen wave 1

Remote main verified at 2f62d6bae1da688904dfd1aba40b0ed507262824. Baseline archive c2ea9cef is its runtime-equivalent
query-first CI package; candidate 36fb3b75 is the held local pipeline. Four-block edit-sized comparison completes:
21 faster / 0 slower / 24 neutral / 2 clock-confounded exclusions. Median workload p50 1.110→0.841 ms across 45
comparable cases. 1,000-label 100-edits immediate measure+publication 130.98→34.14 ms; interleaved edit/read/publication
191.98→71.14 ms. 100-edits immediate reads without publication 5.64→4.14 ms. Batched edit/read/publication
13.19→11.49 ms is neutral; exclusions do not clear their cases. This is scoped CPU evidence, not FPS or full release
parity. Exact report `.cache/retained-prepare-publish-wave1/main-edit-sized/summary.md`.

Published 0.1.0 comparison stopped before timing: the saved-candidate harness guard rejects the dirty standalone
profiling module, although selected benchmark modules are unchanged. Log `/tmp/glyph-retained-wave1-release-edit-sized.log`.
No live run exists. Preserve the frozen packet; establish actual harness compatibility before reusing it. Size remains unresolved:
current candidate shaper 1,610,845 raw / 594,776 gzip9 vs main CI 1,456,090 / 534,013; that historical CI comparison is
not a same-builder attribution. Reduction phase and final browser/release gates remain required before readiness.

Compatibility correction: the guard now excludes only the two known standalone inspector entry points, which Labs
does not discover (`**/*.bench.ts`) and benchmark modules do not import. It still rejects benchmark modules, shared
fixtures, configuration, manifests, lockfiles, and unknown profiler files. Seven release-comparison checks passed.
Published 0.1.0 baseline rerun completed (tool session 78631 terminal zero); frozen candidate 36fb3b75 was reused
without retiming. Report `release-edit-sized/summary.md`: 36 faster / 0 slower / 10 neutral / one timing-mode exclusion
among 47 matched cases. Median workload p50 1.195→0.843 ms across 46 comparable cases. 1,000-label 100-edits immediate
measure+publication 246.31→34.14 ms; interleaved edit/read/publication 287.61→71.14 ms; batched 14.91→11.49 ms.
Separate-run variability remains; this is scoped CPU evidence, not FPS or release-wide clearance. Log
`/tmp/glyph-retained-wave1-release-edit-sized.log`. No live timing run remains. Rust formatting passed; combined native
tests completed after correcting a new test oracle that compared raw relocated wire addresses alongside decoded
geometry. Production geometry was unchanged. Final log `/tmp/glyph-retained-reduction-native-final.log`: 427 unit,
6 outline oracle, 2 bidi, one grapheme and one line-break conformance test pass. Static checks also pass (tool session
94670 terminal zero, `/tmp/glyph-retained-reduction-static.log`). Artifact rebuild/size and integration checks remain.

Reduction passes 1–3 reconciled: accepted orphaned geometry hash retirement, intrinsic reuse across geometry-only
changes, one-pass placement boundaries, one rope iterator for lookahead, session live-extent authority removal, and
shared prevalidated byte-write application. Three agents own nonoverlapping Rust slices; parent reviews before checks.
Pass 3 implementation production +30/−35 lines (plus parent caller arguments), tests extend the existing checkpoint
case for empty reuse and 3→7→2 extents. Parent confirms both owners still preflight ranges before shared copying.
Fresh passes 4 (TypeScript setters/queries/copies) and 5 (ABI/transport) completed read-only; pass 6 (cross-boundary)
completed read-only. All six fresh Sol High reviews are complete; they do not alone establish final readiness.
Pass 4 identifies a redundant split source inspection, duplicate bounds writes, and identical private
measurement methods. Pass 5 identifies dead generation state, unreachable settlement recovery, and an unused retry-era
argument; checked result authentication remains deliberate. Reconcile artificial monkeypatched-failure tests with real
lease/callback/decode failure coverage before removing unreachable plumbing. These historical review findings are now
implemented and verified at the six-pass checkpoint above. Pass 6 found repeated intrinsic clipped layout
preparation on explicit semantic-view publication; preserve full snapshots while reusing committed inspection. This
fix is implemented in the existing owner; latest full timings remain pending.
Pass 1 removes 144 net production lines and replaces
hash-only tests with decoded-geometry equality. Pass 2 removes 39 net production lines and adds earliest-boundary,
linear-placement-work and cold-restyle controls. Parent inspected all three implementation diffs; verification pending.

First three integrated reductions built and packed successfully. Exact archive dbbc91feedf22179e2cf32062de98eca1d566ffdb3d3eb3617d507542ee4ec83
under `.cache/retained-prepare-publish-wave1/reduction-rust` has shaper 1,605,337 raw / 593,330 gzip9: −5,508/−1,446
against frozen wave 1, and −5,097/−1,105 against the pre-wave immediate control. Package-owned build, native and static
checks pass. Full built-package Node tests completed 1018/1018 (tool session 1188 terminal zero,
`/tmp/glyph-retained-reduction-node.log`). OKF check passes with zero errors/warnings.
Performance and browser validation of this artifact remain required; the earlier speedups are for wave 1, not this
new artifact. Source patch and artifact hashes are frozen alongside size-evidence.json before further TS changes.

## Setter-only diagnostic

Frozen wave-1 candidate 36fb3b75, same-length edit of the first small label among 1,000, 300 measured iterations after
50 warmups: p50 0.021958 ms, mean 0.028216 ms, p95 0.048583 ms. The new profile boundary records exactly one set and
zero timed layout reads or publications per iteration. This is one warm diagnostic, not a statistical A/B or a cold-set,
ASCII frame-time, release-wide speedup or completed performance gate. Artifact and CPU profile:
`.cache/retained-prepare-publish-wave1/setter-candidate-1000`. Comparison controls and remaining count/boundary cases are
pending. Disk-space inventory runs read-only as side work; no new timing lane overlaps filesystem scanning/cleanup.

The remaining sections are historical checkpoints and evidence, not competing execution instructions. Earlier timing
results concern their pinned artifacts; the current goal requires new combined-source validation.

## Resumed ropes work — 2026-10-11

The user released the development hold: rebase #292 onto main, measure, then pursue the remaining publication frontier.
Keep #292 draft until combined correctness, performance, size and review gates pass; then mark it ready for review
and HOLD UNMERGED, even if all gates pass. The user explicitly prohibited merging ropes. #240 remains superseded/held;
no stable release/tag or demo merge. The completed query-first goal and release report below remain historical evidence.

1. [x] Preserve all75 local commits in feat/ropes-pre-main-2026-10-11 atb86830f2.
2. [x] Consolidate their final tree and rebase with gh stack onto main2f62d6ba; local integration head e0d86c63.
3. [ ] Integrate durable preparation with query-first copy/lifetime/cache guarantees. TypeScript and native ID reservation
       pass; first rebuilt focused run exposed missing durable codec binding and obsolete result-serialization assumptions.
       Existing commit_measure now retains its transaction Codec binding. Rebuilt session86380 completed exit0;
       native410/410, focused178/178 and static76975 pass. Full Node session87190 is running,
       log /tmp/glyph-ropes-rebase-all-node.log. Full Node1010/1011 passed; its sole retired-query expectation
       was corrected and lifecycle6/6 pass. Workflow17/17 and docs0errors pass. Integration commitd5b673aa is clean.
4. [ ] Pass full native/Node/seeded fuzz and relevant static/browser controls before benchmarking a frozen artifact.
5. [ ] Measure edit/read without publication, edit/read with publication, bulk setters and trailing-span workloads against
       frozen current-main package0205a45f. Edit-sized4block run session16463 is live; log /tmp/glyph-ropes-main-edit-sized.log.
       Candidate e1e3d492, output .cache/ropes-rebased-main-edit-sized. No timing verdict yet; one heavy lane.
6. [ ] Attribute remaining cost, implement one bounded shared-path improvement at a time, retire replaced code, and verify
       cumulative production additions/deletions plus raw/gzip Wasm and runtime delivery sizes. Current candidate
       shaper1,587,966raw/585,299gzip9 versus main1,456,090/534,013: +131,876raw/+51,286gzip9; size gate OPEN.
       All236 shipped JS files total860,471raw versus857,169 (+3,302); this sum is not a delivery bundle size.
       Exact artifact evidence .cache/ropes-rebased-main-candidate/size-evidence.json. Do not treat old size gates as cleared.
7. [ ] Review exact integrated code; update draft PR through gh stack submit --auto only after local gates.
       After every gate passes, mark #292 ready for review and hold it. DO NOT MERGE ropes; this applies even when complete.

Parallel user-requested native GLSL Three WebGLRenderer config variant: router Codex gpt-5.6-sol/high PID23469,
session01a1285f-bec1-7553-8a05-184a7704aa8e, transportcli-fallback, isolated .cache/webgl-renderer-support.
Shared shaping/publication/batching; separate config variant; no TSL or WebGPURenderer fallback. Agent may implement and
typecheck but heavy build/browser/benchmark lane requires parent coordination. Manifest ROOT/.cache/agent-router/three-webgl-renderer.json.

## Completed query-first checkpoint

- Main after merged #300: **2f62d6bae1da688904dfd1aba40b0ed507262824**. #299 merged at9022bb40. Reviewed head cd75ff03,
  CI merge checkout711626c2 and actual main share tree0e8068601968dbbd9c084fa416790073dacd072a.
- QUERY `.cache/query-first-placements` now owns docs-only follow-up #300 on feat/query-first-read-docs,
  merged independently at2f62d6ba; no runtime edits. QUERY is clean. #299 landed from cd75ff03. #299 merged independently; no public signature/ABI
  changes. Query desired placements; independent copies use the existing query/copy/compiler pipeline; source and
  unrelated labels remain pending. Exposed IDs are reserved, pending order uses desired state with accepted batch
  offsets, and discarded preparation retires existing cache ownership, including hidden result-capacity repair.
- Final local evidence: native341/341, rebuilt Node974/974, focused154/154, types/lint/format/docs passed.
  Negative controls removing ID reservation, failed-query cleanup or hidden-retry notification fail their distinct
  regressions. Last correction production13+/2−; full PR production298+/157− across9files. No second executor/cache.
- Same reviewer72518 completed clean: `/tmp/glyph-299-retry-review-result.json`; prior High hidden-retry finding fixed.
  Final exact-head CI38093741115 **all5PASS**, browser conformance16/16, packed-consumer/TypeGPU proof PASS.
- CI glyph Labs8blocks versus main7915: **2faster/0slower/10neutral/0excluded**, no baseline or timing-mode failures.
  Edit+copy1label3.48→3.22ms;1of1000 13.07→7.60ms. Neutral widthinspection+pub19.68→20.23ms(+.55);
  cached100metrics437.74→448.81µs(+11.07). Steady1000borrow6.34→3.98ms is statistically neutral, not a proven win.
  Artifacts QUERY/.cache/ci-38093741115/performance. This focused CPU evidence is not release-wide parity/FPS.
- Exact CI archive QUERY/.cache/ci-38093741115/candidate/pmndrs-glyph-0.1.0.tgz,
  SHA256c2ea9cef0c24f8a553b9d213b9f9b66bedc049d04e67cefcc0883469e51103cc.1217files/3099916bytes;
  profiler and fingerprint filenames absent. Candidate/conformance/size facts in the same CI directory.
- CI gzipCore+0.19%,Three+0.28%,ShaperWasm−0.24%,fonts/bakers unchanged. Local same-toolchain Wasm versus
  d126be82−3479raw/−1261gzip9; do not claim byte identity across builders or sum overlapping adapter surfaces.
- #299/#240 PR notes and #253 checkpoint updated to verified merge evidence. #240 remains held, superseded.
- ASCII exact2f62: docs-only fast-forward preserves all36 recovered file hashes and5 recovery stashes;
  existing HTTPS preview returns200. Backup .cache/ascii-main-sync/main-2f62d6ba-before.
  Runtime validation on byte-equivalent9022: build82354, focused74363 **160/160**, live64008 andtransition45219
  terminal0; all15scenes/formats/DPR2/reduced-motion animation checked. No demo merge or FPS comparison claimed.
  transition-final screenshot intentionally captures maximumzoomz2 after settled fjord.
  Depth drawcount sample has a pre-publication timing gap: no batching improvement/regression verdict.

## Active tasks and handles

1. [x] Implement/reproduce/review/query-copy correctness, rejection/recovery, lifecycle, cache and size gates.
2. [x] Land independently after exact-head CI and actual Labs pass; update remote notes; sync ASCII to merged main.
3. [x] Full release A/B **session99361 completed exit0**, log `/tmp/glyph-release-020-9022-full.log`.
       Named `benchmark:labs-package --baseline @pmndrs/glyph@0.1.0 --candidate <frozen c2 archive> --suite full --blocks4`.
       Output QUERY/.cache/release-020-9022-full:53faster/4slower/47neutral/2clock exclusions;104comparable,0errors/mode
       mismatches. Median2.475→2.080ms;baselineclockdrift5.1%. Four slow deltas59.52µs/36.09ns/about180µs/22.10µs.
       Full report issue253comment6103523441. Heavy lane released; do not duplicate the full comparison.
4. [x] Full release source/maintainability review **ai-cli PID84772**, same session01a127a9-93cf-78d2-842d-b095b2bfd2bb,
       Codex gpt-5.6-sol/high, CLI fallback, isolated `/private/tmp/glyph-299-final-maintainability` clean detached9022.
       Baseline v0.1.0 peeled2d543eedf7b3ad9eb72c7c506dfd3b1062d04caf. Read-only; no reviewer benches/servers/builds.
       Authoritative84772 completed exit0: no runtime/architecture defect; two docs findings addressed by #300.
       Report `/tmp/glyph-020-main-final-review-result.json`. Prompt `/tmp/glyph-020-main-final-review.md`.
5. [x] Docs-only #300 merged at2f62d6ba: changelog/migration/archived recipe and stale canonical evidence corrected.
       Exact head09b66e4f / CI38095856158 **all5PASS**; smoke0faster/0slower/6neutral, no comparability failures.
       docs:update/check pass; package attestation recorded. Archive0205a45f differs from benchmarked c2 only in
       CHANGELOG/MIGRATION; all other1215files byte-identical. No additional full performance run needed.
6. [x] Full report published and #253 updated. Same reviewer supplement **PID2612 completed exit0**,
       result /tmp/glyph-020-main-review-perf-final.json; no remaining production-source blocker.
       Four blocks per artifact were measured sequentially, not alternating packages; reviewer prose's
       “interleaved blocks” wording is incorrect. Four bounded slowdowns remain disclosed.
7. [x] Requirement-by-requirement completion audit verified source assertion bodies, passing Node/native/browser
       results, frozen archive identities, exact-head CI, source review, performance and size reports, independent
       merges, held PR state and absent stable tag. Query-first objective achieved; no release/tag/demo merge.

## Query-first completion audit

- Same-frame reads and no source/root publication: placement test66, copy test384 and Three query crossing control6403
  assert pending source/sibling and zero source publication crossings, then ordinary publication adopts preparation.
- First-render/edited copy parity and independence: placement tests384/422 compare geometry/metadata snapshots against
  subsequent/fresh Unicode publication, then prove later edits cannot mutate the copy.32 seeded cases.
- Batch/font/material/decorations: Three tests2430/2460/2601 and per-span material routing cover independently retained
  font/domain lifetimes, decorations and desired order with accepted shared draw offsets. Custom geometry/raster browser
  checks passed in exact-head CI; no renderer-side layout/copy executor, confirmed by full static review.
- Cache/rejection/retry correctness: warm query crossing tests retain budgets; sibling insertion, output rejection,
  result capacity growth and ordinary publication regressions plus three negative controls discriminate stale ownership.
- Performance/binary/landing: exact CI artifacts verify8block2faster0slower10neutral, Wasm−.24%, all5jobsPASS,
  reviewed/CI/merged tree identity and independent merge299. Full release comparison also completed with the bounded slowdowns/exclusions recorded above.
- Scope: current GitHub240OPEN/unmerged;292DRAFT/unmerged. No stable tag/release/demo merge. Local tracker committed;
  root's unrelated edits preserved. #300 documentation correction and full old/new report are complete.
  Actual0.2.0 version/package preparation and release publication remain outside this completed goal.

## Supplemental evidence (not current release clearance)

- Full published0.1.0→main30391d02: `.cache/publication-contract-main/.cache/release-020-30391d02-full`,
  candidate d126be82;4blocks **56faster/3slower/43neutral/2mode exclusions**,0correctness errors;
  median workloadp50 2.560→2.085ms,baselineclockdrift8.3%. Three slower cases+46.50/+50.77/+43.02µs.
  Issue253comment6101717975. Pre299 evidence only.
- Older query candidate and identity/cache proposals are historical; exact final CI above supersedes their merge gates.
  Rejected coarse-cache/private-bridge experiment `/tmp/glyph-299-cache-proposal-rejected.patch` broke warm crossings.
  No-win copy/intrinsic/flow trials remain unmerged; do not restart without new evidence.

## Held full-frontier gates

#292 remote **d025d245f1a45a3fab8f7dfbb175abf6c7fb6797**, draft, benchmark:stress. PARENT
.cache/publication-range-spike has unpublished knowledge/tooling commits; do not push. Complete design/lifetimes:
[retained-text-assignment](../planning/retained-text-assignment.md). The following original requirements remain unchanged:

1. [x] Draft retained gather ranges, SET dirt, count-changing suffix splices, pending owners/transforms and batch-key
       enumeration share existing owners/executors; cold/seeded/recordless/abort controls verified.
2. [x] Draft retires Three key copies/root revision walks, reuses retained styles/unchanged geometry and retains empty
       adapters until teardown. Preserve indexed/direct late-sibling and synchronous-read controls.
3. [x] Draft one inspection owner handles sparse/dense promotion, owned copies and outline lifetime.
4. [x] Draft private package-minted IDs retire redundant JS checks while retaining public Codec/ID/Rust ownership checks.
5. [ ] Close combined bulk/publication elapsed regression; work counters alone do not prove a win. The accepted D-373
       contract keeps renderer-owned in-flight storage immutable and uses one synchronous Rust shaping state. Preflight
       caller mutation batches before writes, make accepted-state/publication commits infallible, and on unexpected
       post-write failure throw and invalidate derived state for an explicit later rebuild through the same executor.
       No undo restore, hidden retry, or stale-frame fallback. Implemented slices preflight ordered text edit bounds
       and publication/session writes before accepted-state mutation; checkpoint snapshots preserve buffer identity.
       Cross-language failure after Rust measure commit but before TS adoption now marks derived root state unusable;
       the next explicit operation resets Rust planner state, replays live accepted TS inputs through the same executor,
       and forces a renderer checkpoint. The real-font injected-failure test confirms accepted renderer bytes stay put
       and recovery matches a cold build. Cross-call speculative transaction/fingerprint adoption is now retired.
       Reusable stage pairs remain as prior-input scratch for incremental comparison; candidate discard does not restore
       accepted state. The full post-write error-boundary audit remains open.
       The matched four-block edit-sized package A/B is 0 faster,
       1 slower, 45 neutral and 1 clock-confounded skipped; median workload p50 0.895→0.904 ms. The sole slower result
       is 1,000-label same-length engine publication (+0.140 ms, +8.5%, p=.029, 95% CI +2.4..+13.2%). The 1,000-label
       edit/read cases are neutral. Optimized Wasm +1,464 bytes; package archive +1,099 bytes. No speedup is established.
6. [x] Draft queued-root preflight shares engine registration Set; retain hierarchy checks/preparation. Scheduler held.
7. [ ] Integrate exact draw map/reduce into existing instance rope/reducer; preserve reorder, finite/extrema/signed-zero,
       order/u16/abort semantics. No alternate executor or enlarged unrelated records.
8. [ ] Clear combined maintainability, retirement and exact binary-size gates; draft archive2363562e…/shaper5ac05e74…
       is 1,591,326 raw/591,725 gzip9. 399 native/990 Node and final mutation fuzz pass; combined Labs intentionally stopped.
9. [ ] Clear exact combined-head package/hardware/CI review and landing only when the human releases the draft hold.
10. [ ] Update release readiness and roadmap after accepted gates; #247 stays open and #240 excluded. No release publication.

## Unicode preflight transfer — current validation slice

The frozen pre-wave control is package `e2cb331a` / shaper `fad95b05`. Text preflight now discovers edits once, carries its Unicode analysis into the existing paragraph stage, and shares one identity reconciler with preparation. The former same-length and full-replacement identity executors are retired. Request-local metadata is sorted once; the ordinary warm path uses existing inactive buffers and preserves proven text/identity mirrors. Caller validation still completes before accepted writes.

Final native evidence: 431 unit, 6 outline, 2 bidi, 1 grapheme and 1 line-break tests pass; authoritative terminal log `/private/tmp/luna-reconcile-shaper-tests-final.log`. The cumulative production section of `state.rs` grows by 354 lines versus frozen blob `1e634ad5` (test-module boundary 7717→8071). The agent's −46-line result compares its intermediate prototype, not this frozen control. Binary-size, rebuilt Node, scoped Labs and live gates are pending; no performance benefit claimed. Build is running under tool session 34710, log `/private/tmp/glyph-unicode-transfer-build.log`. Keep ropes held unmerged.

Parent review corrected two static failures: redundant acknowledgement error propagation and a needless final mutable Option reborrow. `glyph:static-check` then passed at session 82851. The first build measured shaper `cd689957`, 1,611,661 raw / 595,888 gzip9 bytes (+6,136 / +2,473 versus pre-wave); a final rebuild after those corrections is running at session 53619. This growth is not yet accepted.

The final rebuilt package is `ed638b95`, shaper `e49e62b2`, 1,611,661 raw / 595,887 gzip9 (+6,136 / +2,472). Full Node verification failed the explicit reserve/warm-memory invariant at `render-plan-frame-abi.test.mjs:211`: first three-character insertion after reserve grows Wasm memory. Native correctness and static success do not clear this allocation gate. Scoped Labs is held until the existing reservation path covers the new preflight scratch without an additional permanent text/Unicode owner. Luna correction is active; no concurrent heavy parent lane.

Allocation investigation identifies the first implicit paragraph: preflight cannot find a retained paragraph, so its Owned fallback allocates text/Unicode even though `spare_paragraph` already owns reserved capacity. The bounded correction will reuse that spare's inactive lanes for the matching new implicit paragraph and reserve request metadata/edit capacity in `reserve_root_text`. Matching must be explicit across lifecycle adoption; unrelated or multiple new paragraphs must not consume this candidate. No enduring third text/Unicode pool. Parent rebuild/focused Wasm/full Node validation and Labs remain pending after this correction. OKF validation passed before the correction.

Reservation correction source is frozen. `SparePending` is restricted to exactly one implicit creation with no explicit lifecycle/order mutations and the matching missing paragraph ID. The shared reset executor preserves only that inactive text/Unicode candidate, and records its mirror fact as false. Existing native ordered UTF-16 replacement regression and formatter pass. Parent rebuild session 8802, `/private/tmp/glyph-unicode-spare-build.log`; Wasm allocation/full correctness and timings remain pending. Production-section boundary is now 8183 versus pre-wave 7717 (net +466); owned buffers are not a permanent cache. Source attestation remains pending final staging and source freeze.

Frozen `7bd64ecb` passed the real Wasm reservation ABI test. Its scoped four-block assignment comparison against pre-wave `e2cb331a` completed with no correctness errors: 2 faster / 0 slower / 2 neutral / 2 clock exclusions. Broad preparation 25.01→23.51 ms; broad preparation+publication 31.24→27.90 ms. Baseline drift 59.5% and between-run CPU clock difference 25.8% prevent treating this as performance clearance. Report: `.cache/retained-prepare-publish-wave1/unicode-spare-assignment/summary.md`.

A fresh Sol read-only routing review proved the lifecycle-wide pending-scratch flag redundant: membership validation excludes removed targets, existing lifecycle operations preserve paragraph buffers, and routes use paragraph IDs rather than vector indices. Luna retired that flag and the unreachable Unicode enum guard. The existing late-topology regression now includes rejected sibling creation and checks committed order/absence of the sibling. Final native suite passes 431 unit plus outline/Unicode controls, log `/private/tmp/glyph-unicode-routing-native.log`. New exact build/full Node/size/benchmark evidence is pending; the prior package is not this final source. Parent static log: `/private/tmp/glyph-unicode-routing-static.log`.

## Gather and planner checkpoint before single metadata construction

Historical snapshot; live handles below are superseded by the current tracker.

## Publication frontier checklist

### Goal and hold

Implement [the accepted contract](../planning/decisions/retained-prepare-publish.md): bound set prepares changed Rust layout once;
measure/glyph queries consume that revision; split independently materializes it; publish consumes dirty renderer data.
One layout and executor, unchanged public APIs, batching intact, renderer-owned in-flight bytes immutable.
Prior buffers are input/scratch, not rollback. Ropes #292 stays unmerged: no release, tag or demo merge.
Worktree `.cache/publication-range-spike`, branch `feat/rust-text-input-wire`, HEAD `722a2bdd` plus preserved local edits.
Main control was verified at `2f62d6ba` on 12 October. Parent owns integration and one heavy validation lane.

### Tasks and acceptance

- [x] Reconcile decision/API/package plans with the prepare/query/copy/publish contract.
- [x] Durable Rust preparation and accumulated dirt; renderer publication has no semantic mutations.
- [x] One core inspection/copy owner; independent copies, immutable renderer data and resource lifetimes preserved.
- [x] Six fresh Sol reduction reviews: state, Unicode/layout, Codec/gather, TS queries, transport, end-to-end.
- [x] Retire duplicate inspection, identity executors, transport generations, lease rediscovery and double Unicode analysis.
- [x] Retain style IDs; fuse authored-span validation/reuse; separate placement-range and gather-range eligibility.
- [ ] Close bulk rewrite, repeated publication and length-changing edit elapsed regressions.
- [ ] Reconcile cumulative source additions/deletions, ownership complexity and raw/gzip shaper/JS delivery growth.
- [ ] Final frozen comparisons against pre-wave, pinned main and published 0.1.0, with cold/warm absolute deltas.
- [ ] Live benchmark browser A/B and ASCII on the same artifact: batching/standalone, raster/backend, HiDPI, transitions,
      copy ordering, late siblings, immutable storage. Hero frame evidence uses actual rAF intervals.
- [ ] Retire broad gather/planner/renderer walks wherever the shared retained representation proves dirty-range reuse.
- [ ] Final maintainability/fuzz/API/ABI checks, staging/docs attestation and held-stack readiness. HOLD UNMERGED.

### Frozen controls

Evidence directory: `.cache/retained-prepare-publish-wave1/`; each row contains `pmndrs-glyph-0.1.0.tgz`.
Package version labels are identical: use hashes to distinguish main and held candidates.

| directory/control                      | package SHA prefix | shaper SHA prefix | raw bytes | system gzip9 bytes |
| -------------------------------------- | ------------------ | ----------------- | --------: | -----------------: |
| pinned main (CI 38093741115)           | c2ea9cef           | dc0d918f          | 1,456,090 |            534,013 |
| lease-ledger, pre-Unicode              | e2cb331a           | fad95b05          | 1,605,525 |            593,415 |
| unicode-routing                        | 1daf51d0           | f34ca199          | 1,612,916 |            596,093 |
| style-ids                              | d74c7657           | f34ca199          | 1,612,916 |            596,093 |
| retained-reuse                         | 85f4cf3e           | 481b0753          | 1,612,901 |            596,094 |
| splice-shrink                          | eefe9781           | aa4d123c          | 1,613,550 |            596,448 |
| single-length-window                   | d5407f3e           | 9469684e          | 1,613,989 |            596,640 |
| whole-run-adoption (inherited failure) | 5d08972e           | afa45fe5          | 1,614,248 |            596,710 |
| whole-run-adoption-corrected           | 3eea5500           | 5bd03b6f          | 1,613,809 |            596,575 |
| one-envelope                           | 3d5b6e77           | 96f3d1f9          | 1,619,334 |            598,438 |
| planner-correspondence                 | 2a2e37f2           | ec085b88          | 1,621,871 |            599,796 |
| planner-copy-runs                      | 9a5c7102           | ca5d4d75          | 1,622,332 |            600,007 |

Current frozen planner-copy-runs cumulative shaper growth versus pinned main: +166,242 raw / +65,994 gzip bytes. This remains a gate.
Style IDs: +10/−4 TS lines, identical Wasm. Retained-reuse: −12 TS / +24 Rust production lines versus its immediate
control, −15 raw / +1 gzip. Splice shrink adds +649 raw / +354 gzip; length windows add +439 raw / +192 gzip.
Neither added slice has elapsed clearance. The length-window prototype is retired after broader correctness failures. Unicode consolidation adds roughly 450 production state lines versus
pre-wave and still needs cumulative reduction/review. Historical checkpoints remain in the linked evidence archive.

### Current implementation and validation

Preflight validates caller data once and transfers one candidate text/Unicode result into retained preparation.
SWAR change discovery and identity reconciliation share that evidence. Generic Unicode analysis remains whole-text.
Retained owner-local style slots avoid canonical ID rehashing on repaint, shrink/regrow and replay.
Normalized spans use one validation/reuse pass, allocating changed slots only; caller mutation still cannot alias ownership.

One typed dirty-order producer serves gather and placement. Gather requires compatible source counts/decorations;
placement requires each dirty owner's segment count to match its old occurrence range. Aggregate counts are insufficient.
Cluster ordinals can change while stable Codec IDs and columns do not; retained gather refreshes the ordinal and marks
primitive metadata dirty. Existing cold-output tests cover balanced segment changes, decorations, reorder and checkpoints.

Shared row splice now copies shrinking/equal-count replacements before closing the gap; growth retains overlap-safe
rotation. No allocation or second executor. Exhaustive small-range composition covers ordinary and four-wide aligned lanes.
Separate grow/shrink owners were added to the existing cold-output fixture, with derived revision sequencing.
This slice passes 432 native unit + 6 outline + 2 bidi + 1 grapheme + 1 line-break tests, static/build and 182 Node tests.

The single-length-window prototype passed narrow LTR/RTL cold comparisons but failed broader Amiri ligature rejoining
coverage: deletion returned 5 glyphs versus a cold rebuild's 4, for Bitmap and Slug. d540 reproduces both failures;
the earlier eefe artifact passes the script-topology suite. The prototype is retired, including coordinate-remapping
and retained-offset logic; length-changing edits use the existing complete run scope. LTR/RTL insertion/deletion cold
comparisons remain; their bounded-work assertions are withdrawn. This is a correctness correction, not an elapsed win.
Completed frozen edit-suite A/B: `eefe9781 → d5407f3e`: 55 neutral / 1 timing-mode mismatch, no classified
speedups or slowdowns. Fredoka 2.91→2.96 ms (+0.05); median workload p50 1.020→1.050 ms.
Log `/private/tmp/glyph-single-length-window-edit.log`. Bounded DotGothic work does not establish a common-case elapsed win.

The storage-transfer prototype `5d08972e` transfers a complete sole-run shape from existing scratch into the pending arena after missing-glyph
and seam checks. Partial windows and multiple runs keep the shared range-composition executor. The independent cold-output
plus storage-identity regression fails before the transfer and passes afterward. All 433 native unit tests, 6 outline and 4 Unicode tests, static/build/docs gates pass.
The transfer adds 10 production lines and +259 raw / +70 gzip bytes versus d540; rebuilt Node and elapsed gates remain pending.
Its full rebuilt package run passes 1,022/1,024, with the two inherited length-window failures above.
The corrected source retires that shortcut, passes full native/static/docs/build, and is frozen as `3eea5500`.
Its shaper is +259 raw / +127 gzip bytes versus eefe, −180 raw / −65 gzip versus d540. Production source is net −4
lines versus d540. All 1,024 rebuilt Node tests pass, including the Amiri cases: `/private/tmp/glyph-whole-run-corrected-node.log`.
Completed four-block edit Labs (`eefe9781 → 3eea5500`): 0 faster / 2 slower / 53 neutral / 1 clock-confounded skip.
Fredoka 3.28→3.25 ms (neutral); scattered paint-span set+publish 25.44→27.51 ms (+2.07); unchanged set+publish
5.86→6.15 ms (+0.29). The unchanged workload cannot establish shape-transfer causation; no elapsed win is claimed.
The transfer experiment and its implementation-specific ownership test are retired from active source, preserving
frozen artifact/source evidence. Independent cold shape and length-edit correctness coverage remains. Retirement native (432 unit plus outline/Unicode), static, docs and build gates pass. The resulting control archive is byte-identical to eefe9781. Log `/private/tmp/glyph-whole-run-corrected-edit.log`.
Use eefe as the sound elapsed control; the failed prototype artifacts are historical diagnostic evidence only. No new cache, public API, ABI or semantic executor.

### Performance evidence and unresolved costs

`retained-reuse-assignment`: 4 faster / 0 slower / 2 neutral; scattered complete set+publish 26.25→24.20 ms,
broad 27.62→25.80 ms. `retained-reuse-batch`: 7 neutral; 1024-label set+publish 32.10→32.45 ms.
`retained-reuse-main-full`: 47 faster / 25 slower / 39 neutral, 111 compared, no exclusions. Candidate clock drift 13.3%;
a process snapshot also showed concurrent macOS media analysis consuming about three cores. Median workload p50
1.990→1.380 ms. This is mixed CPU-workload evidence, not release parity or FPS.

| workload, pinned main → retained-reuse               | baseline ms | candidate ms | delta ms |
| ---------------------------------------------------- | ----------: | -----------: | -------: |
| 1024-label set+publish                               |       20.88 |        32.31 |   +11.43 |
| cold mount/publish 22k glyphs                        |       24.24 |        28.21 |    +3.97 |
| Fredoka character edit+measure                       |       0.922 |        2.950 |   +2.028 |
| 1000 labels, 100 interleaved edits/read/publications |      175.41 |        69.01 |  −106.40 |
| 1000 labels, 100 immediate reads with publication    |      127.93 |        33.25 |   −94.68 |

The new `fredoka-edit` profile shares the exact Labs corpus/font/width, using 300 sets + 300 reads, zero publications.
Authenticated eefe profile mean 2.312 ms, p50 2.283, p95 2.479; Rust Unicode, shaping, cluster preparation and positioning
predominate. Main control mean 1.014 ms is sequential diagnostic evidence, not elapsed A/B. Its attempted named build
failed executable authentication; numeric main Wasm names remain unassigned. This prompted the length-window slice.

### Next publication slice

Fresh same-topic Sol review confirms one appended replacement envelope can reuse the existing row writer and splice
kernel without spare lane buffers. Root owns implementation; native worker creation/resumption hit the agent-thread
limit, so do not assume a Luna implementation is live. The adviser is retired when this topic ends.

- [x] Generalize `replace_retained_owner` into one ordered envelope transaction (`replace_retained_owners`). Append dirty owners with `append_from`;
      append intervening clean source gaps from one shallow old-rope snapshot and clean row/field gaps with
      `extend_from_within`. Reserve old rows plus the appended-envelope upper bound before writing. Compose the same
      three-piece source root, then perform one existing flat-lane splice. Single-owner and tail cases use this executor.
- [x] Carry ordered `GatherCorrespondence { old, next, owner }` through gather; `owner: None` authenticates a clean gap. Keep old source/record
      coordinates frozen; reconcile owner offsets once. Planner consumption remains the next unchecked task. Include every preparation-frontier owner when entering after
      a retained-stream stop. Prove earlier dirt belongs to those owners before replacing old-domain intervals with
      appended-domain intervals; clean gaps get explicit zero masks. Selection presence can change emitted count
      while source count stays equal. Replacement identity/ordinal/bounds changes remain dirt even with mask zero.
- [ ] Generalize existing complete admission and layout helpers to consume correspondence; retire the one-owner
      tuple/suffix loop and subsume ReplaceTail rather than add another planner. Reuse clean admission from old
      batch/slot mappings. Moved clean records copy bytes from old physical slots, not Codec execution. Preserve
      allocation, capacity, retirement and immutable leased storage. New batch keys/decorations/checkpoints keep
      the existing complete reconciliation, with no second semantic executor.
- [ ] Extend existing cold/TestHost and seeded attribution fixtures: separated grow/shrink owners, empty owners,
      balanced totals, same-count space transitions, earlier metadata-only dirt, clean middle gaps, two interleaved
      resource batches, abort/retry and checkpoints. Prove one splice/owner-offset pass and zero clean Codec executions;
      compare complete output and applied buffers/resources independently. Add engine/scene Labs cases that change
      several separated owners before one publication at 100/1,000 labels. Validate source/raw/gzip costs each wave.

Current unfrozen implementation retires the one-owner tuple, repeated suffix loop, stream-stop resume branch and unused
stop-owner field. Same-count sparse updates avoid a second frontier sort; tail replacements retain the cheap truncation.
The existing native cold-gather attribution fixture now proves separated count edits visit dirty owners only through
1,024-owner roots; the before-change control fails at 10 visits versus 2. One new mixed-owner test includes a metadata-only
earlier write, a clean gap, an empty owner, balanced source counts with changed selected records, both directions, and
next-publication mask clearing. Final native passes: 433 unit plus 6 outline, 2 bidi, 1 grapheme and 1 line-break tests, including seeded cold oracles.
Log `/private/tmp/glyph-one-envelope-final-native.log`. Glyph/benchmark static and focused suite routing checks pass.
Review unified owner collection with the sparse path, shared checked coordinate rebasing, and skipped the immutable
metadata prefix. Production delta versus the byte-identical eefe control: +391/−206 lines, net +185 across state/gather.
This is new multi-owner functionality in the existing executor; the frozen gather slice costs +5,784 raw / +1,990 gzip bytes versus eefe. The new `multi-owner` Labs suite has eight engine/scene cases at 100/1,000 labels, with cold measurements and
untouched-label snapshots outside timing. Build 92839 completed successfully. Luna High verified 1,024/1,024 rebuilt Node tests and exact package/shaper hashes. Four-block `one-envelope-multi-owner` Labs compares eefe9781 to 3d5b6e77: 7 faster / 1 neutral / 0 slower or skipped, eight matched workloads, no baseline correctness failures. Median workload p50 3.410→2.560 ms; the four 1,000-label cases improve by 1.46–1.53 ms. Baseline/candidate clocks remain 3.31–3.36 / 3.30–3.31 GHz. The unbalanced 1,000-label engine p99 rises 30.7%; tail causation is unverified. Browser gates remain pending. Control `one-envelope-control/`
is byte-identical to `eefe9781` (including aa4d123c Wasm), so the rejected prototypes add no active runtime bytes.

Current next source slice passes correspondence into the existing ordered admission/layout/writer. One reusable u32 origin slot per new input authenticates old physical bytes before speculative mappings change; clean gaps bypass Codec admission, moved clean rows copy committed bytes, and dirty rows keep the shared executor. ReplaceTail is subsumed by Replacement. Checkpoints, new batch keys and removed batches still use complete reconciliation. Luna High verified formatter/static, four focused regressions, 434 unit plus 6 outline/4 Unicode tests, real-root sparse attribution through 1,024 owners, and docs conformance. The new regression compares applied TestHost bytes against cold output through 24 edit sequences in each compositing mode and proves only dirty rows execute Codec; it covers separated owners, empty records, interleaved resource batches, resize, checkpoint, new-key fallback and abort/retry. Source is frozen; package build session 27138 completed successfully, log `.cache/retained-prepare-publish-wave1/planner-correspondence-build.log`. Ordered planner production source is net +171 lines versus the prior unstaged control, excluding the pre-existing shared writer change; its one reusable origin Vec stores 4 bytes per emitted input at retained capacity. No public API, ABI export or runtime dependency changes. Luna verified planner package 2a2e37f2 / shaper ec085b88: +2,537 raw / +1,358 gzip bytes versus 3d5b6e77. Rebuilt Node session 29222 completed with 1,024 passed / 0 failed, log `.cache/retained-prepare-publish-wave1/planner-correspondence-node.log`. Four-block multi-owner Labs versus 3d5b6e77 completed: 0 faster / 3 slower / 5 neutral, eight matched with no correctness failures. The 1,000-label engine cases add 0.265/0.343 ms; unbalanced scene adds 0.248 ms. Unbalanced engine p99 rises 4.346→4.693 ms (+0.347). Baseline clock drift 9.6%, candidate stable 3.30 GHz. This slice has not earned elapsed clearance. Log `.cache/retained-prepare-publish-wave1/planner-correspondence-multi-owner.log`; output `planner-correspondence-multi-owner/`. Frozen source and artifact identities are in `planner-correspondence/identity.json`. Elapsed clearance remains open. The shared Labs publisher now also feeds `multi-owner-balanced` and `multi-owner-unbalanced` profile cases, requiring the publication boundary and 100/1,000 labels. Luna passed benchmark static/format and authenticated named Wasm 789028a2 against exact executable ec085b88. The 300-iteration 1,000-label unbalanced profile performed 900 sets / 0 reads / 300 publications, with untimed cold parity. CPU self/inclusive over all iterations: prepare_internal 169.166/280.208 ms, complete topology 46.792/89.917, gather 27.206/54.165; inclusive times overlap. Raw/manifest/summary are in `planner-correspondence-profile/`; the named CPU table is `benches/.cache/retained-prepare-publish-wave1/planner-correspondence-profile/cpu-summary.md`. Inlining prevents exact-line attribution; the next bounded hypothesis coalesces consecutive clean source slots in the existing writer into one copy per buffer/run. It introduces no new executor or storage. A derived regression bound allows at most prefix/gap/suffix copies per resource batch and retains independent cold bytes + dirty-only Codec checks. Format/static, focused and 444 native tests and docs pass. Build 78207 passed. Frozen planner-copy-runs package 9a5c7102 / shaper ca5d4d75 costs +461 raw / +211 gzip bytes versus uncoalesced ec085b88. A controlled negative disables only run coalescing; compilation succeeds and the derived copy-run assertion fails. Exact source SHA 32226677 is restored before validation. Luna owns rebuilt Node session 20356, then four-block multi-owner Labs versus 3d5b6e77 using the shared publisher on both controls. Elapsed benefit remains unproven. All identities/source hashes are in `planner-copy-runs/identity.json`.

Honest initial bound: one envelope plus suffix lane move and one metadata/mapping reconciliation, not zero suffix
traffic. Flat PlanInput and absolute InstanceState.input_index still require that pass; truly sublinear moved-suffix
publication needs a later coordinate-ownership change. Gather-only improvement does not complete dirty publication.

### ASCII and operations

Hero `.cache/ascii-slug-hero` preserves main history and app edits; `GLYPH_PREVIEW_ROOT` selects ropes.
Preview https://recovered-ascii-hero.ascii-slug-hero.localhost:1355/ . Verify current server/provenance before using it.
Latest measured capture `benches/.cache/ascii-profile-style-ids/` uses f34ca199: flat 44.05/depth 42.43 FPS;
held assignment 60.00/59.34 FPS, no app errors. compileStyles 2.08 ms/update versus earlier 8.11; setter 31.97,
GC self 7.33, Rust measure 12.32, publication 5.66 ms/update. Inclusive rows overlap; sequential profiles are diagnostic.
Fresh corrected-source browser profile/visual A/B is pending. Do not use the failed d540/5d08972e artifacts as live candidates. Old browser modules need reload after the Wasm rebuild.
All scenes animate with reduced motion; only camera/parallax may reduce. No Portless dependency in package scripts.

Use pinned mise and named pnpm workflows; bounded append-log reads; one heavy lane. Retire advisors after topic and never
revive stale Sol caches. Preserve tracked/untracked work. Stage/attest only after final source/docs freeze.

## Archived resume checkpoint, 13 October 2026

Historical snapshot; active state is in the compact tracker. CPU stage totals in older profiles used name-based classification and are superseded by the origin-based correction; raw captures and artifact identities remain valid.

## Goal and hold

Implement [the accepted contract](../planning/decisions/retained-prepare-publish.md): set prepares changed Rust layout once;
measure/glyph queries read it; split independently materializes it; publish consumes accumulated renderer dirt.
One layout/writer, public APIs preserved, batching intact, leased renderer bytes immutable. Prior data is input,
not rollback. Ropes #292 stays UNMERGED: no release, tag or demo merge.

WORK: root `.cache/publication-range-spike`, branch `feat/rust-text-input-wire`, HEAD `722a2bdd` plus local edits.
Pass WORK explicitly on every command; root checkout has unrelated changes. Preserve tracked/untracked/index state.
Root owns implementation/review; Luna High owns validation in ONE heavy lane, using pinned mise/named pnpm workflows.
Use root `.agents/tools/read-append-log.mjs` for rolling logs. No GPU/second benchmark during a heavy run.
Retire advisors after topics; never revive stale Sol. Stage/attest only after the final source/docs freeze.

## Acceptance

- [x] Reconcile API/decision/package plans with prepare/query/copy/publish ownership.
- [x] Durable Rust preparation and accumulated dirt; publication carries no semantic mutations.
- [x] One inspection/copy owner; independent lifetimes; empty publication keeps adapter lease.
- [x] Six fresh Sol reduction reviews; retire duplicate inspection, identity, transport and Unicode work.
- [x] Retain style IDs/owned spans; validate callers once; unify gather/placement dirty-order discovery.
- [x] One multi-owner gather envelope, clean gaps, separate source/record coordinates and one suffix splice.
- [x] Pass authenticated correspondence through existing ordered admission/layout/patch executor.
- [x] Cold applied-buffer tests, dirty-only Codec counts, bounded copy runs, checkpoint/failure and negative control.
- [x] Retire request-header tuple allocations; preserve ABI checks and compare the frozen publication suite.
- [ ] Close bulk rewrite, repeated-publication and length-edit elapsed regressions, including tail stability.
- [ ] Reconcile cumulative source/ownership complexity and shaper/JS raw/compressed growth.
- [ ] Frozen pre-wave/main/published 0.1.0 comparisons: absolute cold/warm deltas and correctness.
- [ ] Live benchmark browser A/B + ASCII on the same artifact: standalone/batches, raster/backend/HiDPI,
      transitions, copy order, late siblings and immutable storage. Hero FPS uses real rAF intervals.
- [ ] Retire remaining broad gather/planner/renderer discovery where retained data proves unchanged work.
- [ ] Final maintainability/fuzz/API/ABI, canonical docs/staging/attestation and held-stack readiness. HOLD UNMERGED.

## Current implementation

Gather `replace_retained_owners` uses existing append/splice kernels. Clean source gaps share rope storage;
flat lanes splice once. Every preparation-frontier owner participates after a retained stop. Old dirt must belong
to those owners; source and emitted deltas are independent. Owner offsets reconcile once from the first dirty owner.
`GatherCorrespondence {old,next,owner}` marks clean gaps with None. No spare lane buffers or second executor.

Ordered `Replacement` subsumes ReplaceTail. A reusable u32 origin slot per new input captures old physical provenance
before speculative maps change. Clean admission reuses batch membership; moved clean bytes bulk-copy consecutive
old slots without Codec execution. Existing capacity/patch helpers remain authoritative. Checkpoints, new/removed
batch keys and decorations use complete reconciliation. Abort invalidates mappings. Absolute input indices still
require a CPU metadata/suffix pass: this does NOT prove sublinear moved-suffix publication.

The latest correction removes the second old-rope iterator and clean clone/rebase branch: every InstanceState now
uses the existing constructor from canonical gathered lanes; origins authorize renderer-byte reuse only.
Static, focused cold/trailing/real-root tests, all 444 native tests and docs pass. Build/pack passed.
Luna verified rebuilt Node 1,024/0 and four-block multi-owner A/B (session 98174 terminal): eight matched, eight neutral, no correctness failures. Post-run docs conformance also passes. d96 artifact is frozen; the later unreachable gather-loop deletion is not yet validated.
Prior control `planner-single-metadata/identity.json` records exact package, shaper and five Rust source hashes.
Current `planner-direct-header/identity.json` freezes package 7620a5ac, shaper 108d0046 and six edited source hashes.

## Frozen artifacts and verdicts

Artifacts live under WORK `.cache/retained-prepare-publish-wave1/`; filenames all `pmndrs-glyph-0.1.0.tgz`.
Version strings do not identify candidates. Pinned main c2ea9cef/dc0d918f is root query-first-placements CI 38093741115.

| artifact                | package SHA | shaper SHA | raw / system gzip9 bytes |
| ----------------------- | ----------- | ---------- | -----------------------: |
| pinned main             | c2ea9cef    | dc0d918f   |      1,456,090 / 534,013 |
| one-envelope            | 3d5b6e77    | 96f3d1f9   |      1,619,334 / 598,438 |
| planner-copy-runs       | 9a5c7102    | ca5d4d75   |      1,622,332 / 600,007 |
| planner-single-metadata | d96cad16    | 1aba48d7   |      1,622,134 / 599,911 |
| planner-direct-header   | 7620a5ac    | 108d0046   |      1,621,536 / 599,657 |
| planner-paint-partition | 3a397e92    | d98f53c8   |      1,622,978 / 600,418 |
| planner-tail-prefix     | c42e70a6    | 61613b04   |      1,622,648 / 600,202 |

- Gather-only eefe9781→3d5b6e77: 7 faster/1 neutral, 8 matched, four blocks, no correctness failures;
  median workload p50 3.410→2.560 ms, 1,000-label cases −1.46…−1.53 ms; +1,990 gzip bytes.
- Uncoalesced planner 3d→2a2e37f2/ec085b88: 3 slower/5 neutral; 1,000 engine +0.265/+0.343 ms,
  unbalanced scene +0.248 ms. Baseline clock drift 9.6%; unbalanced engine p99 +0.347 ms.
- Coalesced 3d→9a: 8 neutral. Unbalanced 1,000 engine p50 4.132→4.061 ms, p99 4.695→4.299 ms;
  other tails worsen: 100 balanced scene p99 1.480→4.908 ms, 1,000 unbalanced scene 4.929→6.874 ms.
  Neutral classification does not prove a speedup or tail parity. All frozen candidates pass 1,024 Node tests.
- d96: −198 raw/−96 gzip versus 9a; +2,800/+1,473 versus 3d. All 1,024 Node tests pass. Labs is eight neutral; 1,000 unbalanced scene p50 4.515→4.347 ms, p99 4.752→4.611 ms. P99 changes range −3.9%…+10.7%; no universal tail or speedup claim.
  Cumulative shaper growth versus pinned main: +166,044 raw/+65,898 gzip bytes, still a gate.
- d96→7620 (`planner-direct-header-publication/`), session 18353 terminal: 82 matched, 30 faster/52 neutral,
  no classified slower cases, no check failures or timing-mode mismatches. 512-label rewrite p50/p99
  17.10/18.56→15.72/17.32 ms is faster; 1,024 retained Text publication 31.65/35.40→30.49/33.52 ms is neutral
  (p50 −3.7%, below 5% minimum delta). Baseline clock drift 5.1%; unrelated no-op rows move too, so the aggregate
  is not causal proof for header encoding. Candidate Wasm −598 raw/−254 gzip; frame-wire.js +1,233 raw/+120 gzip;
  tarball +235 bytes. Compiled ABI 7/7, named Unicode, 3 focused Rust, static and final docs conformance pass.
  Bulk remains slower than pinned main's earlier 20.633 ms; no current-main or release-wide clearance claimed.

Exact previous comparisons: `one-envelope-multi-owner/`, `planner-correspondence-multi-owner/`,
`planner-copy-runs-multi-owner/`. Broad historical main A/B is 47 faster/25 slower/39 neutral with 13.3% candidate
clock drift; it does not clear current source. Full absolute deltas and retired experiments are in the evidence archive.

Authenticated ec085b88 named profile (789028a2) shares the Labs three-owner publisher: 1,000 labels, 300 iterations,
900 sets/0 reads/300 publications, cold parity. CPU self/inclusive totals: prepare_internal 169.166/280.208 ms,
complete topology 46.792/89.917, gather 27.206/54.165. Inclusive times overlap; inlining prevents exact-line attribution.
Raw/manifest: `planner-correspondence-profile/`; table: WORK
`benches/.cache/retained-prepare-publish-wave1/planner-correspondence-profile/cpu-summary.md`.
Profile latency is diagnostic, not Labs A/B or FPS. Multi-owner profile modes require publication and 100/1,000 labels.

## Bulk regression and preparation profile

Frozen d96 versus pinned main, `planner-single-metadata-main-batch/`: seven matched, five slower/one faster/one
neutral, no correctness failures or exclusions. 1,024 updates plus publication p50 **20.633→32.098 ms** and
p99 **22.466→35.827 ms**. Group rewrites at 64/128/256/512 labels also regress; 100-label edit+measure improves
0.206→0.145 ms. Reported clock drift is below 2%; the bulk regression remains a gate.

Authenticated d96 bulk profiles (`planner-single-metadata-bulk-preparation/` and `…-bulk-publication/`) each use
20,000 sets and 20,000 immediate reads; preparation has no publications, publication has 20. p50 totals per
1,000-label iteration are 19.305 and 25.122 ms. These diagnostics are not paired Labs deltas and have no bulk
cold-control assertion. Preparation sampled CPU is 425.208 ms: ParagraphState::prepare self 23.999/inclusive
162.917 ms, HarfRust apply_forward self 19.583 ms, paragraph measurement append self 6.083 ms. Inclusive totals
overlap; HarfRust is inside the authenticated Rust shaper, not an external Wasm module. Artifact-authenticated source maps identify frame-wire::writeHeader self 20.960 ms and the enclosing
writer self 12.624/inclusive 37.793 ms. Header construction allocates 35 tuples and one outer array per call. Named engine SHA e81325cc matches executable sections of shaper 1aba48d7.

Root removed the unreachable `sparse && retaining` owner loop in append_planner_gather: its preceding sparse-stream
branch either returns or sets retaining=false. Existing stream/replacement and broad append executors remain.
Luna independently verified reachability and passed sparse attribution, mixed-owner retained-stop and trailing
replacement focused Rust tests. It is not a measured speedup.
Root also replaced the 35-entry header tuple loop with direct checked DataView writes, preserving field order,
validation labels and little-endian wire bytes. Existing ABI fixtures are the independent oracle. Both edits pass formatter/static, the three focused Rust tests and docs conformance. Rebuilt Node ABI fixture
passes 7/7 and the named Unicode check passes. Candidate 7620a5ac reduces shaper by 598 raw/254 gzip bytes; JS
delivery delta is pending. d96 remains the profile/control artifact. Paired Labs results are recorded below; attribution remains limited by clock drift and unrelated case movement.

## Next gates and preview

1. Saved-profile mapping and the 7620 publication comparison are complete. Do not restart session 18353 or duplicate
   the 82-case run. The manifest/identity and saved JSON establish exact artifacts; compiled ABI and docs checks pass.
2. Shared empty-input experiment is REJECTED: afe992e candidate (see exact identity.json) passed static/build,
   20/20 ABI/setter/replay tests and docs, but batch Labs 75086 is six neutral/one clock-confounded skip across seven
   paired cases. 512-label rewrite p50/p99 14.73/16.13→15.19/16.77 ms; 1,024 publication 29.38/32.61→29.71/33.28 ms.
   Wasm identical, JS +77 gzip and tarball +715 bytes, no established latency gain. Root restored the exact two TS
   sources from authenticated 7620; other source/index changes remain. Saved artifacts/reports are historical evidence.
   That experiment's dist was replaced by the later paint build; keep the archived comparison as historical evidence.
3. Paint-partition invalidation is the current wave. The original native reproduction (3514) confirmed
   insert/move/remove color spans on unchanged abcdefg each invoked HarfRust for all seven units. Cached cluster
   style indexes and shaping-run source references made clearing the invalidation bits alone incorrect.
   The shared classifier now compares effective styles over the old/new range refinement and distinguishes mapping
   dirt from metric dirt. Existing run preparation refreshes descriptors; the existing cluster refresh remaps style
   indices. Flow preparation consumes the actual geometry-change result. No second metadata/shaping executor.
   The first focused test caught omitted summary lanes in the existing cluster copy. The same copy now preserves
   summaries, word/placement caches and island shapes for mapping-only edits; metric refresh still rebuilds them.
   Luna passed static/format and the basic paint-partition and metric-refresh cold oracles. Wrapped Fredoka checks
   exercise nonempty unsafe-boundary corrections and island shapes, preserve flow and match cold output. The same
   regression also passes Amiri liga=1 versus liga=0 glyph-count control, combining-grapheme remapping, and a later
   width edit against cold output. Repeated byte-record construction is one test-local builder; probes are removed.
   Full native and Unicode conformance now pass (435 shaper, 6 outline, 2 bidi plus official grapheme/line-break
   vectors), and root build is terminal green. Candidate 3a397e92 is frozen with source snapshots/hashes:
   +1,442 raw/+761 system gzip9 shaper bytes versus 7620; frame-wire/render-planner JS hashes are identical.
   Rebuilt focused Node tests pass 13/13; final docs check has zero errors/warnings. Corrected @style comparison
   (79426 terminal) matches 17/17: 2 faster, 15 neutral. Changing-boundary prep p50/p99 11.063/11.877→6.163/6.634 ms;
   prep+publication 12.984/13.920→8.086/8.676 ms (−44.3%/−37.7%, both p=.029). Independently initialized geometry
   and paint checks pass. Fixed-boundary color and typography controls are neutral; resolution is about ±6%.
   Paired @batch (97406 terminal) matches 7/7, all neutral: 1,024 labels 31.106/41.542→30.688/34.673 ms p50/p99,
   p=.686. This row times all 1,024 setters plus one publication, not publication alone. Baseline clock drift 5.6%;
   lower p99 alone is not a classified win. Bulk/main regression remains.
   Report directories: planner-paint-partition-style-corrected/ and planner-paint-partition-batch/. Identity also
   pins benchmark source snapshots. This establishes a paint-boundary win, not an ASCII FPS or general-release verdict.
   First style attempt (47751, planner-paint-partition-style/) exposed a fixture mismatch: measure counts 18,432
   glyphs including spaces, while drawing emits 12,288 instances. Do not interpret that failed case as a runtime
   regression or a valid whole-wave verdict. Preserve it; use separate cold expectations and a new output directory
   for corrected benchmark definitions. Both corrected comparisons are complete; do not restart these sessions.
   Bulk/main, cumulative size, held-stack readiness and live gates remain open.
4. Tail-prefix bookkeeping retirement is now implemented, pending validation: +7/−36 source lines against frozen
   3a state.rs. Positive prefix results only came from replacement, whose nonempty correspondence is already consumed
   by the earlier scope. Broad append returned zero; the legacy fallback only asked for a whole-input replacement.
   Removed its discovery/scope branch and changed the two private gather wrappers to return unit. Existing gather
   and ordered executors remain. Luna independently confirms the proof. Focused multi-owner empty/nonempty, mixed
   tail and separated-replacement cold-publication tests pass; full native is 436/436 plus outline and Unicode
   conformance. Rebuilt package tests pass 19/19, including empty publisher lease; static passes. Existing recordless
   coverage is codec_gather::retained_gather_realigns_when_a_paragraph_sheds_a_recordless_glyph and
   source_intervals_skip_clean_recordless_rows_and_match_full_gather. Ordered mixed-tail cold TestHost checks actual
   rendered snapshots; the new state fixture checks full gather/session translations and does not claim glyph-byte
   or nonempty glyphless-text coverage. ZWJ/soft-hyphen trials emitted records and are not accepted as that proof.
   Frozen c42e70a6 reduces shaper by 330 raw/216 system gzip9 bytes versus 3a, with unchanged JS. Batch comparison
   39020 is live in planner-tail-prefix-batch/; wait for that handle, do not restart it. Final docs check remains.
   Frozen 3a/source snapshots remain the control; current dist reflects rebuilt c42e70a6.

Hero: root `.cache/ascii-slug-hero`; `GLYPH_PREVIEW_ROOT=WORK` selects held ropes.
https://recovered-ascii-hero.ascii-slug-hero.localhost:1355/ . Verify server/provenance and reload after Wasm rebuild.
Latest f34ca199 flat/depth 44.05/42.43 FPS is old evidence; fresh browser A/B is pending. All scenes animate with
reduced motion; only camera/parallax may reduce. Follow Portless before servers; no Portless package-script dependency.

History: [evidence archive](../reports/frontier-checkpoints-2026-10-12.md).
Design: [retained assignment](../planning/retained-text-assignment.md). Read this tracker first after compaction.

## Archived checkpoint: demand summary and no-read profiling

Snapshot before compacting the active tracker on 2026-10-13T12:10:38.058Z. Current status belongs to the linked tracker.

## Goal and operating rules

Implement [the accepted contract](../planning/decisions/retained-prepare-publish.md): set prepares changed Rust layout once;
measure/glyph queries consume that revision; split independently materializes it; publish consumes renderer dirt.
One layout/writer, unchanged public APIs, batching intact, in-flight renderer bytes immutable. Old state is reusable
input, not rollback. **Ropes #292 remains UNMERGED; no release, tag or demo merge.**

WORK is root `.cache/publication-range-spike`, branch `feat/rust-text-input-wire`, HEAD `722a2bdd` plus local edits.
Always pass WORK explicitly; root has unrelated changes. Preserve tracked/untracked/index state. Root implements/reviews;
Luna High runs bounded implementations and test/build/benchmark/profile gates in ONE heavy lane. Parent owns
hotspot attribution, architectural planning and acceptance decisions. No browser/GPU overlap. Fresh Sol only;
never revive stale advisors. Native Sol currently cannot spawn because of the agent-thread limit; no advisor is claimed.
Use pinned mise/named pnpm workflows and root `.agents/tools/read-append-log.mjs` for rolling machine logs.
WORK retires source_digest/docs:update; current docs workflow uses attestation/check. Stage/attest after final freeze.

## Acceptance and remaining work

Do not select the next optimization from one slow row alone. Freeze current4afe4ba2 for one full main comparison,
then reuse those candidate timings for published0.1.0. Preserve sparse-edit/read, color, copy, repeated-publication
and broad-span gains while closing bulk/cold/long-edit costs. Parent reviews authenticated source-attributed
profiles and chooses one structural correction; Luna receives a bounded implementation or testing gate. A neutral
timing micro-optimization with added runtime code is rejected. Do not revert accepted reductions based on
unpaired runs. Current seven-case evidence is not a full-suite verdict.

- [x] Reconcile canonical API/decision/package plans around prepare/query/copy/publish ownership.
- [x] Durable Rust preparation; publication sends empty semantic mutation arrays and lifecycle/order only.
- [x] Same-revision inspection/copy ownership, independent lifetimes and empty-publication adapter lease.
- [x] Six fresh Sol reduction reviews; retire duplicate Unicode, inspection, identity and transport work.
- [x] Retained style IDs/owned spans and one caller-validation boundary; typed dirty-owner frontier.
- [x] One multi-owner gather envelope: clean rope gaps, separate source/record coordinates, one suffix splice.
- [x] Existing ordered admission/writer consumes correspondence; moved clean physical slots bulk-copy without Codec.
- [x] Cold applied-buffer, dirty-only Codec, checkpoint/failure, negative-control and Unicode evidence.
- [x] Direct checked header writes; paint-partition mapping preserves shaping/flow and cached boundaries.
- [x] Retire obsolete tail-prefix discovery/scope fallback through the same gather/ordered executors.
- [ ] Close bulk rewrite, repeated-publication and length-edit elapsed regressions, including tail stability.
- [ ] Reduce/reconcile cumulative Rust/JS source, ownership complexity and raw/compressed growth.
- [ ] Frozen current/main/published 0.1.0 comparisons: absolute cold/warm deltas and correctness.
- [ ] Live benchmark browser A/B and ASCII on the same artifact: batches, raster/backend/HiDPI, transitions,
      copy order, late siblings and immutable storage. Real rAF intervals for FPS.
- [ ] Final maintainability/fuzz/API/ABI, canonical docs/staging/attestation and held-stack readiness.

## Current single design

Rust owns prepared text/Unicode/layout; setters admit known paragraph IDs instead of rediscovering semantic mutations.
Queries may materialize inspection but do not publish. Pending/unpublished preparation IDs carry renderer dirt.
Gather `replace_retained_owners` shares clean rope gaps and uses existing append/splice kernels. Every frontier owner
participates after a retained stop; source and emitted-row deltas remain independent. Offsets reconcile once from
first dirty owner. `GatherCorrespondence {old,next,owner}` authorizes clean physical provenance; one origin slot per
new ordered input replaces the second rope iterator. Each InstanceState uses the canonical current gather constructor.
Checkpoint, new/removed batch keys and decorations use the same complete executor. Abort invalidates derived mappings.
Absolute input indices still require suffix metadata work: sublinear moved-suffix publication is NOT established.

Paint splits compare effective styles over old/new range refinement. Existing shaping-run preparation refreshes source
references; existing cluster refresh remaps style indexes. Mapping-only refresh preserves summaries, word/placement
caches and island shapes; metric refresh rederives them. Flow gate consumes actual geometry change, not metadata dirt.
Replacement scopes now carry correspondence alone; the unchanged prefix derives from its first old record.
Empty correspondence declines retained topology and uses the same complete executor. Seeded tail and abort-mapping
fixtures carry real dirty-owner correspondence; empty/malformed scopes prove full admission and cold rendered parity.

## Exact artifacts and measured effects

All artifacts are under WORK `.cache/retained-prepare-publish-wave1/`. Filenames/version strings say 0.1.0 and do NOT
identify code. Exact SHA, source snapshots and benchmark snapshots are in each identity.json.

| control/candidate                | package SHA  | shaper SHA   | raw / system gzip -n -9 bytes |
| -------------------------------- | ------------ | ------------ | ----------------------------: |
| pinned main                      | c2ea9cef     | dc0d918f     |           1,456,090 / 534,013 |
| direct header                    | 7620a5ac     | 108d0046     |           1,621,536 / 599,657 |
| paint partition                  | 3a397e92     | d98f53c8     |           1,622,978 / 600,418 |
| accepted tail-prefix             | c42e70a6     | 61613b04     |           1,622,648 / 600,202 |
| rejected whole-window experiment | c24831cc     | 3d994dea     |           1,622,795 / 600,146 |
| correspondence scope             | 53d93a62     | d2603d2c     |           1,622,482 / 600,151 |
| **current demand summary**       | **4afe4ba2** | **0b7f6c84** |       **1,622,514 / 600,182** |

Remote HEAD/main was reverified at `2f62d6bae1da688904dfd1aba40b0ed507262824` on 13 October;
the archived c2ea9cef runtime control remains applicable. Pinned main tar is root
`.cache/query-first-placements/.cache/ci-38093741115/candidate/`.
Current dist is frozen demand-summary build44373/package4afe4ba2; 53d remains its size control. Frozen source snapshots are recoverable. JS frame-wire/render-planner hashes are unchanged
through paint/tail waves. Tail wave is +7/−36 production lines versus 3a; −330 raw/−216 gzip Wasm bytes.

Paint versus 7620, four-block @style (79426 TERMINAL): 17/17 matched, 2 faster/15 neutral, cold initial-state
geometry/paint checks pass. Preparation p50/p99 11.063/11.877→6.163/6.634 ms; prep+publication
12.984/13.920→8.086/8.676 ms (−44.3%/−37.7%, p=.029). Fixed-boundary color/typography controls neutral;
resolution about ±6%. Report `planner-paint-partition-style-corrected/`. First attempt 47751 is invalid fixture
comparison (measurement includes spaces, draw count excludes them); preserve `planner-paint-partition-style/`.

Paint @batch (97406 TERMINAL) and tail @batch (39020 TERMINAL) each match 7/7, all neutral. Latest tail 1,024 setters
plus one publication p50/p99 29.438/32.899→30.439/34.433 ms (+3.4%/+4.7%, p50 neutral); 512 rewrite p99
15.733→17.062 ms (+8.4%, p50 +2.2% neutral). Do not turn neutral into a speed claim or ignore tails.
Reports `planner-paint-partition-batch/` and `planner-tail-prefix-batch/`. No check errors/timing-mode exclusions.
Historical d96 versus main had 1,024 setters+publication 20.633/22.466→32.098/35.827 ms; fresh current/main pairing
is still required. Older header/gather wins and rejected shared-empty-input experiment are in the evidence archive.

## Validation and current next action

Current c42 passes format/static, 436 native units, outline/Unicode conformance, rebuilt Node 19/19 (including empty
publisher lease), build and docs check. Existing recordless-source tests are `retained_gather_realigns_when_a_paragraph_sheds_a_recordless_glyph`
and `source_intervals_skip_clean_recordless_rows_and_match_full_gather`; mixed-tail cold TestHost verifies rendered
snapshots. New state count-transition fixture compares full gather and session translations, not renderer glyph bytes.
ZWJ/soft-hyphen fixture trials emitted fallback records; no glyphless-authored-text proof is claimed from them.

Fresh authenticated c42 bulk-write profiles are COMPLETE: 1,000 labels, 20 timed/5 warmup iterations; 20k sets/20k
immediate reads, with 0 or 20 publications. Diagnostic p50 18.893 ms preparation / 23.866 ms with publication;
not paired Labs or FPS. Paths `planner-tail-prefix-profile-{preparation,publication}/`. Named executable matches
61613b04; profile module `wasm://wasm/0069ebc6`. Unverified `00aa4bda` transition is not attributed to Glyph.

The saved captures have now been reclassified by origin, using one shared classifier. Eight deterministic
classifier tests and benchmark static checks pass. Preparation self samples: Wasm 228.207 ms, Glyph JS
139.001 ms, host 44.459 ms. Publication: Wasm 274.833 ms, Glyph JS 176.335 ms, host 49.666 ms,
external JS/harness 4.541 ms. These are exclusive sampling totals, not per-frame timings; old name-based
bucket summaries are superseded. Authenticated Binaryen merged functions remain opaque within Wasm.

The whole-window selector experiment is **REJECTED and removed**. Session 29249 terminated with 7/7 matched,
all neutral, no check failures/mode mismatches. Candidate c24831cc versus accepted c42: 1,024 sets+publication
p50/p99 28.903/33.134→28.850/32.542 ms; 100-label edit+measure .135729/.234667→.146584/.258833 ms.
Baseline/candidate spread ±1.1%/±1.7%, resolution about ±3.4%. +147 raw/−56 gzip Wasm bytes and 17 added
production lines do not justify retention without demonstrated benefit. Keep its frozen reports/snapshots.
The retained Inter counter/cold regression still proves the incremental path shapes the entire short run.

Correspondence-only scope cleanup is **ACCEPTED**: production +23/−36 (net −13); tests +110/−13
(including 58 test-only short-label lines); −166 raw/−51 gzip Wasm bytes versus c42. Format/static/docs,
437 units/six outline/official Unicode and cold rendered/abort/malformed-scope gates pass. Four-block
@multi-owner session 17701 is TERMINAL: 8 matched, all neutral, no skips/check/mode failures. Baseline/candidate
spread ±1.9% each; clocks 3.374/3.301 GHz. 1,000 balanced scene p50/p99 4.227/4.698→4.241/4.660 ms;
unbalanced scene 4.267/4.497→4.254/4.644 ms. 100 unbalanced engine p99 rises1.315→1.458 ms.
This is a maintenance/size improvement, not a speed claim. Reports `planner-correspondence-scope-multi-owner/`.

Current main c2ea9cef versus frozen 53d93a62 @batch is TERMINAL (session 9339, four blocks): 7 matched,
5 slower/2 neutral, no skips/check/mode failures. Baseline/candidate spreads ±2.3%/±1.5%, clocks
3.28–3.38/3.27–3.32 GHz. Absolute p50/p99 ms:

| operation                |                  main |               current |                p50 delta |
| ------------------------ | --------------------: | --------------------: | -----------------------: |
| 100 labels, edit+measure |     .200333 / .329875 |     .179458 / .292459 | −.020875 (neutral/noisy) |
| rewrite64                |   1.923063 / 2.928625 |   2.630271 / 3.689958 |                 +.707208 |
| rewrite128               |   3.249437 / 4.272375 |   4.715188 / 5.888208 |                +1.465751 |
| rewrite256               |   5.791604 / 6.828750 |   8.388313 / 9.586584 |                +2.596709 |
| rewrite512               | 10.369333 / 12.243416 | 15.632250 / 16.628625 |                +5.262917 |
| toggle1000               |     .619500 / .929208 |     .637251 / .743708 |       +.017751 (neutral) |
| 1024 sets+publication    | 20.625125 / 22.974292 | 30.393417 / 33.872125 |                +9.768292 |

Reports `planner-correspondence-scope-main-batch/`. This confirms the bulk gate remains failed; the cleanup
neither caused nor resolved the eager-preparation regression. No repeat of this comparison is warranted without
another runtime change.

**Current demand-summary versus main:** session58602 is TERMINAL, four-block @batch, 7 matched:
1 faster/5 slower/1 neutral, no correctness errors, skips or timing-mode mismatches. Baseline/candidate
clocks3.30–3.38/3.28–3.31GHz, spreads±1.8%/±1.5%, resolution about±3.6%. Absolute p50/p99 ms:

| operation                |         main c2ea9cef |        demand4afe4ba2 |          p50 delta |
| ------------------------ | --------------------: | --------------------: | -----------------: |
| 100 labels, edit+measure |     .211375 / .355333 |     .166833 / .297583 |  −.044542 (faster) |
| rewrite64                |   1.952063 / 2.828208 |   2.086750 / 3.170250 |           +.134687 |
| rewrite128               |   3.289105 / 4.272875 |   3.609750 / 4.840000 |           +.320645 |
| rewrite256               |   5.889105 / 6.676584 |   6.713771 / 7.883000 |           +.824666 |
| rewrite512               | 11.004501 / 12.327000 | 13.784854 / 14.649375 |          +2.780353 |
| toggle1000               |     .662605 / .902666 |     .638312 / .774917 | −.024293 (neutral) |
| 1024 sets+publication    | 20.370666 / 23.295125 | 26.812376 / 30.598917 |          +6.441710 |

Artifacts `planner-demand-summary-main-batch/` and `planner-demand-summary/identity.json`.
Bulk parity remains FAILED. Separate runs against main do not establish a paired improvement versus53d.
Demand Wasm adds32raw/31gzip bytes versus53d; render-planner adds195raw/52gzip, ThreeText131raw/51gzip.
Cumulative versusmain: Wasm+166,424raw/+66,169gzip; planner+1,685raw/+511gzip;
ThreeText+206raw/+48gzip; tar+74,765bytes. Reduction/reconciliation remains OPEN.

**Next action:** Luna captures the actual no-read bulk scene workload:1024 labels,20 timed/5 warmups,
`bulk-write --reads none --publication-path scene`. Candidate preparation, candidate publication, then main
publication run serially. These are diagnostic CPU profiles, not another Labs comparison. Historical bulk
profiles measured every label after each setter and used engine publication; they do not isolate this workload.
The existing harness now offers explicit read/publication modes while retaining measure/engine defaults.
Static/format92477 and workflow31832 (18/18) pass. Parent reviewed the shared loop; no second executor.
Runtime remains frozen4af while profiling. No fullLabs, server/GPU overlap, runtime edits or commits.

The native oracle is resolved: min/max widths and first-demand LINE spans match cold output. The actual defect
was publication passing false for borrowed-layout spans to the SAME append_paragraph_measurement helper.
Forwarding the requested bit fixes exact publication/query equality. Focused regression and full 437 native/six
outline/official Unicode pass; formatter/static pass. First clipped/ellipsis demand uses prepared clusters with
zero shaping, one intrinsic flow/no intrinsic positioning, unchanged prepared/root revision. Repeated demand
reuses the cache; no main-flow or shaping replay at publication. No width/glyph-range normalization hides this.

The parent changed the existing TS preparation method to honor measurement demand: unqueried labels use mask0;
previously queried metric caches stay current on subsequent setters. First query requests missing summary through
the SAME empty-mutation preparation executor, before any borrowed callback. Query-only work does not increment
semantic-preparation count or invalidate owned inspection. Three acceptShape only refreshes bounds already requested, using the current cached summary; unqueried
Texts stay lazy. A closed unrequested/dirty/current box state preserves previously returned mutable min/max
references. Explicit measurement/boundingBox getters materialize bounds; packed renderer bounds stay unchanged. No public signatures, ABI exports, second executor or deferred layout were introduced.

Current distribution is the demand-summary build 44373. Focused Node 197/197 passes, followed by Three 142/142
after a test-only strengthening: exactly one first-demand crossing, strict warm summary identity, setters keep
requested summaries current, and publication reads that cached value. Requested Box3/min-reference refresh
remains 48/48. Public canonical authored-packet tests now snapshot setter bytes before query-only packets,
while retaining geometry/flow/glyph assertions. TypeGPU38/38 and static/format pass. Artifact freeze, size and four-block main @batch are complete as above;
broader release/live gates remain open. All validation Luna.

Parent verified publication encoding has empty semantic mutation arrays and commit uses prepared/unpublished
paragraph IDs. Font extents already use flat records and last-font lookup memo; heavy shape_segment is nongeneric.
No duplicate font cache or second shaping executor is justified. GitHub #292 remains OPEN/DRAFT at d1eb263e
(head `feat/publication-range-spike`, base main); local frontier is uncommitted/unmerged. Shared file/index stays
preserved. All tests/builds/profiles/Labs remain Luna High, one heavy lane.

## Preview and durable links

Hero is root `.cache/ascii-slug-hero`; `GLYPH_PREVIEW_ROOT=WORK` selects ropes. Preview:
https://recovered-ascii-hero.ascii-slug-hero.localhost:1355/ . Verify server/provenance and reload after Wasm rebuild.
Old f34ca199 flat/depth 44.05/42.43 FPS is historical; fresh benchmark/hero visual A/B remains pending. All scenes
animate with reduced motion; only camera/parallax may reduce. Follow Portless before servers; never package-depend on it.

[Accepted design](../planning/decisions/retained-prepare-publish.md) · [Detailed assignment/lifetimes](../planning/retained-text-assignment.md) ·
[Historical checkpoint evidence](../reports/frontier-checkpoints-2026-10-12.md).

## 2026-10-13 Equal-flow rejection and monospaced frontier

## Goal and authority

Implement [the accepted contract](../planning/decisions/retained-prepare-publish.md): set prepares changed Rust layout once;
measure/glyph queries read that revision; split independently materializes it; publish consumes renderer dirt.
One layout/writer, unchanged public APIs, batching intact, in-flight renderer bytes immutable. Old state is reusable
input, not rollback. **Ropes #292 remains UNMERGED; no release, tag or demo merge.**

WORK is root `.cache/publication-range-spike`, branch `feat/rust-text-input-wire`, HEAD `722a2bdd` plus local edits.
Always pass WORK explicitly; preserve tracked/untracked/index state. Root owns design, hotspot analysis, planning,
review and acceptance judgments. Luna High receives only bounded implementation, testing/build/Labs/profile gates
or factual OKF/web retrieval. Luna does not select optimizations, decide tradeoffs or accept work. ONE heavy lane;
no browser/GPU overlap. Fresh Sol advisors only; never revive a stale advisor. Use pinned mise/named pnpm workflows.
WORK uses docs attestation/check, not retired source_digest/update. Stage/attest after final freeze.

## Remaining gates

- [x] Canonical ownership plans and durable Rust preparation; publication sends empty semantic mutations.
- [x] Prepared inspection/copy identities, independent lifetimes, empty publisher lease and desired copy order.
- [x] Six fresh reduction reviews, caller validation once, retained style IDs and typed dirty-owner frontier.
- [x] One multi-owner gather envelope, clean rope gaps and ordered correspondence/bulk copy through shared writer.
- [x] Cold/failure/Unicode oracles; paint partition retains shaping; direct header writes; obsolete tail-prefix retired.
- [x] Demand summaries: unqueried setters/publish use mask0; first query materializes the prepared layout summary.
- [ ] Full frozen current/main and published0.1.0 landscape; close bulk/length/cold regressions and unstable tails.
- [ ] Reconcile/reduce cumulative source, ownership complexity, raw/compressed size.
- [ ] Same-artifact browser benchmark and ASCII A/B: batching, raster/backend/DPR, transitions, copies, late siblings.
- [ ] Final maintainability/fuzz/API/ABI, canonical docs/staging/attestation and held-stack readiness.

Do not choose the next optimization from one slow row. Preserve sparse-edit/read, color, copy, repeated-publication
and broad-span wins while closing bulk/cold/long-edit costs. Root analyzes authenticated profiles and selects one
structural correction. Reject added runtime micro-optimizations with neutral timing. No reverts based on unpaired
runs. Seven-case batch evidence cannot establish full-suite parity.

## Current single design

Known paragraph IDs admit setters directly to Rust. Queries may materialize inspection without publication.
Pending/unpublished owner IDs carry renderer dirt. Gather shares clean rope gaps and performs one suffix splice;
source/record coordinates stay distinct. Ordered writer derives the clean prefix from real owner correspondence.
Empty/malformed correspondence uses the same complete executor, proved by cold rendered parity. Absolute input
indexes still require moved-suffix metadata work; sublinear suffix publication is not established.

Paint splits compare effective old/new interval refinement. Existing shaping-run preparation updates references and
cluster refresh remaps style indexes; mapping-only refresh preserves shape/flow summaries and boundary islands.
No second shaping/layout executor. Demand uses the existing preparation method: unqueried labels omit optional
measurements; previously requested summaries remain current on edits. First summary query runs before borrowed
callbacks. Publication preserves already-returned mutable Box3 references from cached summaries; unrequested bounds
remain lazy. Requested borrowed-layout bit reaches the same Rust helper in query and publication.

## Frozen artifact and gates

All evidence below is WORK `.cache/retained-prepare-publish-wave1/`; filename0.1.0 is not artifact identity.

| artifact                       | package SHA | shaper SHA | raw / system gzip9 bytes |
| ------------------------------ | ----------- | ---------- | -----------------------: |
| main                           | c2ea9cef    | dc0d918f   |      1,456,090 / 534,013 |
| prior scope cleanup            | 53d93a62    | d2603d2c   |      1,622,482 / 600,151 |
| full-suite demand summary      | 4afe4ba2    | 0b7f6c84   |      1,622,514 / 600,182 |
| prior retained-style trust     | 071ccfe4    | ab9d7ecf   |      1,621,711 / 599,984 |
| rejected equal-flow experiment | b1142ce8    | 7beb2176   |      1,622,215 / 600,086 |

Full-suite dist was build44373, package `planner-demand-summary/pmndrs-glyph-0.1.0.tgz`; snapshots/hashes/gates in
`planner-demand-summary/identity.json`. Demand versus53d adds32raw/31gzip Wasm,195raw/52gzip planner,
131raw/51gzip ThreeText. Cumulative versusmain: Wasm+166,424raw/+66,169gzip; planner+1,685raw/+511gzip;
ThreeText+206raw/+48gzip; tar+74,765. Growth remains an open reduction gate.

Native437 units/six outline/official bidi/grapheme/linebreak conformance and docs pass. Focused Node197/197,
strengthened Three142/142, TypeGPU38/38, format/static pass. Exactly one first-summary crossing, warm identity,
current requested summary after edit, and requested Box3 reference refresh48/48 remain asserted. First clipped
summary performs zero shaping, one intrinsic flow, no intrinsic positioning and no revision advance. Width/LINE
cold oracles remain exact. Earlier width0 diagnosis was an oracle error; real publication LINE mask error is fixed.

## Current performance evidence

Four-block main→current @batch session58602 TERMINAL:7 matched,1 faster/5 slower/1 neutral, zero correctness
errors/skips/mode mismatches. Clocks3.30–3.38/3.28–3.31GHz; spread±1.8/±1.5%, resolution±3.6%.

| workload                  |     main p50/p99 ms |  current p50/p99 ms |
| ------------------------- | ------------------: | ------------------: |
| one edit+measure among100 |     .211375/.355333 |     .166833/.297583 |
| rewrite64                 |   1.952063/2.828208 |   2.086750/3.170250 |
| rewrite128                |   3.289105/4.272875 |   3.609750/4.840000 |
| rewrite256                |   5.889105/6.676584 |   6.713771/7.883000 |
| rewrite512                | 11.004501/12.327000 | 13.784854/14.649375 |
| toggle1000                |     .662605/.902666 |     .638312/.774917 |
| 1024 sets+publication     | 20.370666/23.295125 | 26.812376/30.598917 |

Report `planner-demand-summary-main-batch/`. Bulk parity FAILED:+6.441710ms p50/+7.303792ms p99.
Separate earlier runs do not prove candidate-on-candidate improvement. Latest full checkpoint was85f4cf3e,
`retained-reuse-main-full/`:111 cases,47 faster/25 slower/39 neutral; median1.990→1.380ms, candidate drift13.3%.
Those older broad rows are diagnostic, not current artifact clearance. Prior archive preserves every wave/report.

## Active gate and parent analysis

Full main/current session6180 is TERMINAL0, `planner-demand-main-full/`, four blocks, frozen4af.
Canonical report:71 faster/18 slower/30 neutral/2 timing-mode exclusions (119 comparable of121 matched),
no baseline correctness failures. Raw console counts72/19 include the two incompatible timing modes; do not quote
those as final verdict. Median workload p50 2.490→1.770ms; workloads≤3ms69→76, >3ms50→43. Baseline clock
drift5.5%, spread±1.7%, resolution±3.3%; candidate is not flagged unstable in canonical summary.
Bulk1024 p50 21.67→26.77ms (+5.10ms); rewrite512 10.99→13.79ms (+2.80ms); cold22k24.09→25.33ms.
Long Fredoka edit+measure2.34→2.92ms; generic long edit+measure2.95→3.64ms. Wins remain:1000-label
interleaved171.90→66.24ms; immediate-measure+publish124.32→32.16ms; broad8192-span prep48.47→20.54ms;
color-only engine2.51→.686ms; edit+copy among1000 3.95→2.83ms. This is the current landscape, not clearance.
Published0.1.0 baseline-only session18666 is TERMINAL0, reusing EXACT saved candidate timings/harness in
`planner-demand-release-full/`:88 faster/9 slower/19 neutral/3 excluded,116 comparable. Two outline cases are
candidate-only; two timing-mode mismatches and one clock-confounded workaround reflow are excluded. No baseline
correctness failures. Median3.010→1.900ms;≤3ms58→74, >3ms58→42. Separate-run variability remains explicit.
Nine slower p50 deltas:bulk1024+5.73ms;rewrite512+2.62ms;long generic edit+measure+.56ms;Fredoka+.54ms;
rewrite256+.48ms;unsafe reflow+.20ms;100-label metric copies+.095ms;group toggle+.035ms;cached glyphs+.016ms.
No duplicate candidate timing. Both broad gates are complete on frozen4af; newer source must receive a separate
artifact identity before claiming these results. Root selected the bounded style-trust slice below. ONE heavy lane;
no server/GPU/Labs overlap. Final source/size/current-artifact performance and visual gates remain OPEN.

Authenticated named shaper proof in `planner-demand-named/manifest.json` has release/executableSHA0b7f6c84.
No-read scene publication capture12888 passed20,480 timed sets/zero reads/20 publications. Source-mapped summary:
`planner-demand-named-publication/cpu-profile-summary.md`. Parent-reviewed samples identify shared preparation,
HarfRust shaping, positioning, planner validation, ordered admission and Codec gather. Inclusive totals overlap;
not per-frame cost or proof of avoidable work. Root must distinguish required shaping from duplicated preparation
before an edit. Historical per-set-measure profiles cannot isolate this no-read workload.

Exact current named capture p50 is21.647ms;20-sample p95/p99 both select max27.287ms, a coarse tail. Raw origin
self totalsµs:otherWasm170001,shaping71582,gather22668,plan16584,allocation9082,GlyphJS138665.
Unattributed Binaryen functions stay opaque; bridge00aa4bda is not credited to Glyph. Main initial publication warms
summaries while candidate does not: this is ordinary end-to-end behavior but prevents interpreting the captures as
identical cache-state kernel comparisons. No causal gain/loss is claimed from subtracting these samples.

## Parent source findings awaiting the full gate

`validate_lifecycle_input` exits on empty lifecycle input; `commit_paragraphs(false)` resolves only staged IDs.
These setter paths do not establish a whole-root scan. No new root index/cache is justified by this capture.
The short alpha/bravo edit legitimately reshapes its changed run; the prior complete-window selector was tested,
neutral and retired. Do not repeat it. Text/unit buffers already preserve same-length mirrors and preflight Unicode
transfers into the shared preparation; do not recreate those earlier fixes.

`forkResolvedTextWithText` shares an existing lease owner but adds per-snapshot WeakMap/refcount bookkeeping on
every text edit. A possible structural reduction is to track desired/published lease-owner edges directly while
keeping semantic snapshots distinct. It is NOT approved yet: acceptance needs meaningful size/cost reduction,
unchanged independent-copy/readiness semantics, and failure/removal/disposal ownership proof. It cannot alone be
claimed to close the bulk gap.

Parent has applied the narrower style-validation reduction after the release baseline gate: when style mutations
are empty and normalization does not realign ranges, `prepare_styles` revalidates unchanged retained records after
preflight already checks their final-text ranges/features. `dispose_font_stack` rejects any stack referenced by an
active paragraph; the registry cannot change during synchronous preparation. This supplies the missing font-lifetime
proof. Root/topology are already admitted, so this branch can trust retained styles and return through the same kernel.
Production now returns Ok through the same branch instead of repeating validate_text. The existing RTL/font-lifetime
regression covers measured text-only change before/after normal publication and prohibits premature stack disposal.
Existing nested-style matrix now has packed kern[1,2) and a😀d:span[1,3) remains scalar-aligned while feature.end2
splits a surrogate pair. Exact faults and unchanged preparation count prove caller preflight, not a later failure.
Full native437/six outline/Unicode pass; static82497 passes after unused_mut removal; strengthened native95034 passes.
Retained-style dist was build51430, packed071ccfe4, Wasmab9d7ecf. Focused Node183/183 passes.
Compared with4af, Wasm decreases803raw/198gzip and tar206bytes; five inspected JS assets/package manifest are
byte-identical. Cumulative Wasm versusmain remains+165,621raw/+65,971gzip. No speed acceptance yet.
Four-block4af→071 batch:0 faster/1 slower/6 neutral; rewrite256 6.22→6.70ms (+.48ms,+7.7%,p=.029).
Baseline clocks3.33–3.38GHz versus candidate3.20–3.32; resolution±5.1%. Preserve the slowdown observation;
calibration prevents treating this alone as causal attribution. Assignment six cases all neutral.
Saved evidence:retained-style-trust-{batch,assignment}/. Full-suite counts above remain evidence for4af, not071.
Performance keep gate stays OPEN. Docs check found three archive link errors; parent repaired those links. Rerun26440 passes with zero
conformance errors, producer-profile errors or warnings. Parent reviewed
Luna's patch target, missing constant import and duplicated test assertions before applying; validator now compares
formatter changes against an actual pre-format snapshot, not the unrelated MM index. Keep only if code/size decrease
and representative batch/style timing is not worse. Luna executes exact bounded tasks, without acceptance decisions.
Do NOT remove `arena.validate` from the mutated/realigned branch: it produces order scratch consumed by `resolve`.
Retiring that pass later requires transferring the actual preflight candidate/order into the existing style stage,
just as text/Unicode transfer already works. Deleting that guard alone would lose required data.

## Next bounded proof

Parent source review finds every reshaped cluster change returns flow-dirty, including potentially equal-width
monospace replacements. Before implementing reuse, prove actual font advances/flags and cold layout/position parity.
A test-only ordinary-flow counter can establish current unnecessary recomposition. Derive eventual flow-versus-render
dirt inside the existing canonical comparison; no second scanner/executor. Render glyphs must refresh even when flow
can be retained. Reject reuse for changed topology/advances/flags/bidi/fonts, glyph-dependent line edges/dropcaps or
other unproved dependencies. Test-only proof now passes, native55559: actual DotGothic16 abcd→wxyz,16px character-wrap width,
two lines; exact old/new cluster ranges/advances/flags/fonts and flow lines/fragments match while glyph IDs change.
Independent cold wxyz shape/position/flow oracle passes. One ordinary-flow preparation and four newly positioned
glyphs are observed; zero convergence checks. First fixture omitted extents and produced no drawable records;
parent corrected both constructors to the existing registered-extents fixture, preserving assertions. This proves
avoidable flow recomposition in that case, not a timing gain or coverage of all ASCII updates.
The next implementation must also retain dirty-line information for positioning; merely skipping flow can turn
sparse positioning into a whole-paragraph rebuild. Full-assignment run anchors may change: existing canonical
matching by stable anchor cannot alone authorize positional flow reuse. Keep geometry proof distinct from occurrence
identity and update all glyph data through the existing writer. Parent has now applied the rule: the existing run/cluster comparison emits content and flow evidence in one pass.
New occurrence anchors can still prove identical coordinates, without retaining old content identities. Only text-edit
preparation requests this proof. Accepted geometry/bidi, no dropcaps/ellipsis/glyph-dependent boundary islands and
exact cluster metrics/flags authorize shared flow records; current text edits mark positioning dirt through existing
rope source lookup. Shape, positioning, gather and publication retain their original shared executors.
The four-case real-font test uses FULL assignments, including one sparse change among320 units; glyphs/flow match
independent cold output, sparse positioning retains clean records, and space/newline changes force ordinary flow.
Static69114 passes; native63878 passes438 units/six outline/official Unicode. The previous bulk-work fixture expected
10,240 unnecessary intrinsic visits; parent replaces that with zero visits/zero flow preparations and strengthens
its cold intrinsic-width oracle. No weakened rendered parity. Build91790/pack30277 and rebuilt Node80392 (183/183) pass; benchmark static79457/31838 passes.
Current packageb1142ce8/Wasm7beb2176 is1,622,215raw/600,086gzip, +504raw/+102gzip versus071;
tar3,174,606 (+131). Parent independently compared all1,212 archived files: no additions/removals; ONLY
text-shaper.wasm bytes differ. Cumulative Wasm versusmain is+166,125raw/+66,073gzip. Identity/source hashes
in equal-flow-proof/identity.json. NO performance acceptance.
Assignment attempt75253 failed before timing, with no results; parent inspected the authenticated asset's16/32
strike descriptor and corrected the fixture's requested contract (nonempty tuple). Static31838 passes; paired
assignment49515 is LIVE with complete stdout/stderr log. Exact071/b114 artifacts and new harness hashes captured.
Batch/style remain queued and must stop on correctness/identity failure. No browser/GPU lane overlaps timing.

### Equal-flow decision and next hotspot

Parent REJECTS this runtime slice: correctness/work reduction alone did not justify extra code. Paired four-block
assignment has12/12 neutral, batch6/6 neutral plus one clock-confounded exclusion, style16/16 neutral plus one
clock-confounded exclusion. Zero correctness failures. Style samples are noisy (median spread±5.4%, resolution~±10.6%);
neutral is not established parity. Reports equal-flow-{assignment,batch,style}/ preserve all observations.

Parent archived the exact final source, complete tests, re-applicable experiment.patch, b114 package and reports in
equal-flow-proof/. Restored pre-experiment production and retired its temporary diagnostic test/counter. Existing
retained-style071 changes and earlier improvements remain intact. Source is restored; dist is stillb114 until rebuilt.
Restoration validation/build/pack is assigned to Luna; no source reversion based on unmatched historical timings.

The new harness itself stays: it uncovered a much larger cost. Monospaced broad preparation188.65→190.48ms and
publication193.05→196.54ms versus proportional broad20.73→20.95/25.29→25.91ms. Those different-font workloads
are not a causal A/B, but justify an exact hot-path profile. Scattered mono18.87→18.62ms prep/20.60→21.01ms E2E
is neutral. No claim about renderer FPS. Do not repeat full timing to search for a win.

Next bounded action: capture EXACT new mono-broad preparation benchmark via Labs documented nodeFlags/unique tag,
candidate071 ONLY. Reuse the registered workload, no new profiling executor/data generator. Optional profile flags
must be paired, disallow baseline/saved-candidate, label profiling timings diagnostic-only. Preserve normal Labs
behavior. Luna implements this harness/gates/capture; parent chooses the fix from authenticated CPU evidence.

Labs assignment declarations share one helper between unchanged Inter names and added DotGothic16 group.
Twelve rows cover18432 units/8192 paint spans, unchanged/scattered/broad FULL assignments, immediate measure versus
publication. The existing authenticated16/32 mono asset is reused; font loading/input generation remains untimed.
Three bitmap fixture loaders share one private helper. New harness digest7da48ebe is scoped to completed comparisons;
profile-tag wiring will create a new digest. Never relabel old full reports as the new harness.

- [x] Test native438/cold correctness and Node183 for the archived experiment; binary+504raw/+102gzip.
- [x] Complete scoped timing and reject unproved runtime optimization; preserve evidence and retire added path.
- [ ] Verify restored production/build/package matches071; current dist must not be mistaken for restored source.
- [ ] Exact mono-broad CPU capture, hotspot analysis by parent, then ONE justified correction.
- [ ] Final full-suite/release and live visual reconciliation, cumulative code/size reductions, held stack readiness.

## Preview and links

Hero is root `.cache/ascii-slug-hero`; `GLYPH_PREVIEW_ROOT=WORK` selects ropes. Existing URL:
https://recovered-ascii-hero.ascii-slug-hero.localhost:1355/ . Server/provenance/reload must be verified before use.
Old44FPS captures are historical. Follow Portless before servers; never add it to package dependencies/scripts.
All scenes animate under reduced motion; only camera/parallax may reduce. Use real rAF intervals for FPS.

[Accepted design](../planning/decisions/retained-prepare-publish.md) · [Detailed lifetimes/research](../planning/retained-text-assignment.md) ·
[Historical checkpoints](../reports/frontier-checkpoints-2026-10-12.md).

## 2026-10-13 Authenticated monospaced shaping-context hotspot

Exact071 candidate-only Labs diagnostic capture22570 selected only `@mono-broad-preparation`, two blocks,32samples; ordinary timing reuse is prohibited. Two execution V8 captures contain3,307/3,340samples and4,739,458/4,773,334µs of sampled CPU. The separate orchestration capture includes worker waiting and is not credited to the engine. Executable-authenticated function294 is `decode_utf16_range_into`, with3,305,877/3,339,579µs self samples (~70% of each execution capture). Source maps and named Wasm are bound to TGZ071ccfe47627db27672e7f2193272f5c53b682d45ab794a1f2df4488029b177d and release/executableab9d7ecfc8876e279e6a647e750e8adb799eddea7d4cd3bf3f36ece3e6132437. Saved summaries live under WORK `.cache/retained-prepare-publish-wave1/mono-broad-profile/summary-{81254,81355}.md`. They are attribution, not frame time or paired timing.

The primary traced whole-context decoding in `shape_segment_inner`: prefix decoded fully then reversed, suffix decoded fully, both passed to HarfRust. Pinned HarfRust0.12.0 `src/hb/buffer.rs` defines `CONTEXT_LENGTH=5`; both codepoint context setters consume only five values. Thus nearly all decoding of long contexts is unused. The accepted implementation replaces the existing helper with bounded nearest-five context decoding, shares the scalar decoder, and reduces registry context scratch reservation32768→5. Full item decoding remains unchanged. The enum/selection logic stays in one helper; no alternate shaping executor or public API/ABI change. Independent standard-library UTF-16 decoding across deterministic valid/malformed slices is the behavioral oracle. Correctness, size and targeted paired evidence remain pending; no elapsed improvement is claimed yet.

The saved summary tooling initially rejected the named builder's top-level proof schema. It now normalizes that schema into the existing nested proof validator; exact file/executable/function-map/artifact authentication remains mandatory. Static97455 and CPU-summary8/8test62687 pass. The profiles and named artifact were not regenerated.

Bounded context gate: native438 plus six outline, two bidi, official grapheme/linebreak suites pass; static and scoped build74257 pass. Rebuilt focused Node56336 passes183/183; docs38358 reports zero errors/warnings. Frozen TGZd73b4adc69393fc52aa9845dcf4a4259ba3d5d0a019de81caad28cb6d84d385a is3,174,692B. Shaper96a66fa80eabdd09ec8375dcb616f2d7c4aee8e42e44d7a20b4a5f8bf20c6216 is1,622,923raw/600,201system gzip9 (+1,212/+217 versus071). Package.json, every distJS and the four other Wasm are identical. Production+47/−17 lines; tests bring total+127/−20. Pre-slice lib.rs is HEAD722a source (source-control), not the post-implementation/pre-format snapshot. Paired assignment2380 is running; acceptance remains pending.

Assignment2380 completes, exact071→d73b, four fresh blocks on the same harness:2faster/10neutral/0slower/0skipped, all correctness checks pass. Mono broad preparation188.37→21.93ms (−166.44/−88.4%,p=.029,95%CI−88.9..−88.1%); mono broad SET+publication192.20→26.95ms (−165.25/−86.0%,p=.029,95%CI−86.3..−85.8%). Proportional broad preparation20.55→20.84 and publication25.50→25.91 are neutral; unchanged/scattered controls also neutral. Median across these12workloads20.635→20.585ms understates removal of the largest outliers; neither median nor case timings are FPS. Primary retains the bounded-context change and requests sequential batch/cold/style controls before cumulative/full/live acceptance. Final broader gates and binary-size reconciliation remain open.

Batch96465 completes exact071→d73b, four blocks:0faster/2slower/5neutral,7matched/no skips/no correctness errors. Rewrite512labels13.27→14.06ms (+.79/+6.0%,p=.029,95%CI+2.7..+12.1%); publish1024retainedText26.22→27.69ms (+1.47/+5.6%,p=.029,CI+4.2..+10.0%). Candidate clock3.09–3.28GHz drift6.0%, baseline3.27–3.37GHz; this limits causal attribution but does not erase slower observations. Other batch cases remain neutral, including noisy100-label edit/measure. Cold33214 completes3matched/3neutral/no skips/no failures: first22kpublication26.34→26.43ms; first label3.70→3.76;100-label first borrowing17.65→17.62. Candidate cold clock stable, comparison resolution~±3.4%. Style27341 is running. No reruns requested to seek favorable timing.

Style27341 completes17matched/17neutral/no skips/no correctness errors; color-only scene/engine families report noisy samples~11.6–16.4%. Assignment/batch/cold/style manifests bind exact071 andd73b artifacts and suite-specific harness selections. Runtime/harness now freeze for ALL Node/docs gates followed by full main→d73b comparison and published0.1.0→the SAME saved d73b candidate (no duplicate candidate timing). Remote main remains2f62d6bae1da688904dfd1aba40b0ed507262824, exact c2ea9cef control. Primary owns landscape/acceptance. Raw average-block-median calculations differ from the canonical Labs comparison p50 values; human summaries use the named workflow's canonical `summary.md` estimator consistently.

Full Node25886 stops1022/1025 before docs/full Labs. Three preparation-count failures: measure-minimal-text-edit expected3/actual4; bound-edit flow expected1/actual2; failed-root replay expected4/actual6. Parent traced first demanded summaries through #assertTextQueryable→#prepareTextCandidate(includeMeasurement=true): already prepared candidates send empty semantic mutation sections, while internal semantic #preparationCount increments only preparationChanged. Raw measure-export/PlanTransport.prepareParagraph invocations conflate first query materialization and semantic preparation. The accepted demand-summary contract requires separate observations, not changing expected counters to6 without proof. Bounded test correction preserves setter-once/unchanged-set/replay semantic counts, asserts first materialization and cached subsequent reads, and keeps zero renderer publication; production runtime remains frozen d73b. Full comparative runs remain stopped until reviewed coverage passes.

Primary reviewed the two-file instrumentation correction and consolidated the bound-edit wrapper reused after the cold oracle. No runtime changes or relaxed semantic-count assertions. Static64233 passes; selected16/16 Node53569 passes, including all three previously failing cases. ALL Node67852 is running on unchanged d73b; full Labs remains gated. Original25886 failure log is preserved.

ALL Node67852 passes1025/1025 on unchanged d73b; docs also passes zero errors/warnings. The previously failed preparation-count coverage now proves semantic reuse separately from first-summary materialization. Full four-block current-main c2ea9cef→d73b comparison starts; published0.1.0 will use the identical saved candidate. Final landscape, size reconciliation and live gates remain open.

## 2026-10-13 Pre-landscape tracker archive

Historical tracker snapshot before compaction; the linked active checklist remains authoritative.

## Goal and authority

Implement [the accepted contract](../planning/decisions/retained-prepare-publish.md): setters prepare changed Rust layout once;
measure/glyph queries read that revision; split independently materializes it; publish consumes renderer dirt.
ONE semantic/layout/writer pipeline, unchanged public APIs, batching intact, in-flight renderer bytes immutable.
Old state is reusable input, not rollback. Preserve all prior local/index/untracked work. No release/tag/demo merge.
Ropes #292 remains OPEN/DRAFT/unmerged (remote verified d1eb263e, main base). Do not push/merge this work.

WORK=root `.cache/publication-range-spike`, branch feat/rust-text-input-wire, HEAD722a2bdd plus preserved edits.
Always pass WORK explicitly. Primary owns design/hotspots/planning/review/acceptance. Luna High only bounded
implementation, gates/build/Labs/profile, or factual retrieval; no acceptance decisions. Native agents for owned
models, no ai-cli. ONE heavy lane; no browser/GPU overlap. Never revive stale Sol advisors. Use pinned mise/named
pnpm workflows. WORK uses docs attest/check, not retired source_digest/update. Stage/attest after final freeze.

## Required remaining gates

- [x] Durable Rust preparation; ordinary publication carries empty semantic mutations.
- [x] Desired inspection/copy identities, independent lifetimes, empty publisher lease, desired copy order.
- [x] Six fresh reduction reviews; caller validation once; retained styles and dirty-owner frontier.
- [x] Shared multi-owner gather/writer, clean rope gaps, correspondence/bulk copy, no duplicate executor.
- [x] Cold/failure/Unicode oracles; paint partitions preserve shaping; direct headers; old tail-prefix retired.
- [x] Demand summaries: omit unrequested measurements, materialize first query, keep requested bounds current.
- [ ] Close/reconcile bulk/length/cold regressions using full current/main and published0.1.0 landscape.
- [ ] Reduce/reconcile cumulative source, ownership complexity and raw/compressed delivery size.
- [ ] SAME-artifact browser benchmark/ASCII A/B: batching/raster/backend/DPR/transitions/copies/late siblings.
- [ ] Final maintainability/fuzz/API/ABI/docs/staging/attestation and held-stack readiness.

Do not select fixes from a percent alone or a synthetic work count. Preserve sparse/read/color/copy/publication
wins. Reject added runtime micro-optimizations with neutral timing; no reverts based on unpaired comparisons.
No arbitrary wins target, no repeated full timing in search of a favorable run.

## Current single design

Known paragraph IDs admit setters directly to Rust. Queries materialize inspection without publication.
Pending owner IDs carry renderer dirt. Gather shares clean rope gaps and splices one suffix envelope; source/record
coordinates remain distinct. Ordered writer derives clean prefixes from real owner correspondence. Absolute moved
suffix metadata still needs work; sublinear suffix publication is unproved. Paint partitions refine effective
intervals through the same shaping/cluster/positioning executor. Demand summaries use the existing Rust helper;
returned Box3 references refresh, unrequested bounds remain lazy; borrowed-layout mask matches query/publication.

## Artifacts and last full landscape

All evidence:WORK `.cache/retained-prepare-publish-wave1/`; package version0.1.0 is not artifact identity.

| artifact                                      | tar SHA      | shaper SHA   | raw / system gzip9 bytes |
| --------------------------------------------- | ------------ | ------------ | -----------------------: |
| pinned main                                   | c2ea9cef     | dc0d918f     |      1,456,090 / 534,013 |
| full-suite demand summary                     | 4afe4ba2     | 0b7f6c84     |      1,622,514 / 600,182 |
| restored style-trust control                  | 071ccfe4     | ab9d7ecf     |      1,621,711 / 599,984 |
| REJECTED equal-flow                           | b1142ce8     | 7beb2176     |      1,622,215 / 600,086 |
| **CURRENT bounded context, controls pending** | **d73b4adc** | **96a66fa8** |  **1,622,923 / 600,201** |

The prior restored scoped build95512 and packed equal-flow-restored TGZ are BYTE-IDENTICAL to frozen071 (pack27683).
Format4585/static98280/native3740 pass:437 units/six outline/official bidi/grapheme/linebreak. Prior rebuilt Node183
passes at exact071. Style trust removed repeated retained validation, +2/−6 production; font/range/feature/lifetime
proofs remain. Mutated/realigned `arena.validate` must stay: it supplies resolver order. Cumulative Wasm versusmain
+165,621raw/+65,971gzip remains OPEN. Its paired assignment6 neutral; batch1 slower/6 neutral (256 rewrite+0.48ms,
+7.7%, differing clocks). Do not waive that observation or claim current full parity.

LAST FULL REPORTS ARE FROZEN4af, not current071/new harness:
main→4af:71 faster/18 slower/30 neutral/2 timing-mode exclusions (119 comparable), median p50 2.490→1.770ms;
≤3ms69→76. Main baseline drift5.5%. Bulk1024 21.67→26.77ms;512 rewrite10.99→13.79; long edit+measure
2.95→3.64. Wins:1000-label interleaved171.90→66.24ms, immediate-measure+publish124.32→32.16ms,
broad8192-span prep48.47→20.54ms, color engine2.51→.686ms, copy3.95→2.83ms.
published0.1.0→SAME saved4af candidate:88 faster/9 slower/19 neutral/3 exclusions (116 comparable), median
3.010→1.900ms;≤3ms58→74. Bulk+5.73ms,512 rewrite+2.62, long generic+.56,Fredoka+.54,256+.48,
unsafe reflow+.20,metric copies+.095,toggle+.035,cached glyphs+.016ms. Two outline candidate-only cases are not wins.
Reports planner-demand-{main,release}-full/. No duplicate candidate timing. Earlier reports/profiles in archive.

## Rejected wave and active work

Equal-flow proof was correct: real DotGothic two-line glyph replacement retained exact geometry; dirty-line metadata
preserved sparse positioning; negatives/cold oracle/native438/Node183 passed. But paired four-block071→b114
assignment12 neutral, batch6 neutral+1 clock exclusion, style16 neutral+1 clock exclusion. Style noisy (resolution
~±10.6%); neutral does not establish parity. Added97-ish production lines/+504raw/+102gzip had no measured speedwin.
Primary REJECTED it, archived complete source/tests/reapply patch/b114/results under equal-flow-proof/, retired its
temporary code/counter/test, and verified exact071 restoration. No silent loss of prior improvements.

KEEP the new shared Labs assignment harness (Inter + authenticated DotGothic16),18432 units/8192 paint spans;
unchanged/scattered/broad FULL assignments, immediate measure vs publication. Original Inter names unchanged;
font/input generation untimed; mono declares both baked16/32 strikes. No new large asset. New rows exposed broad
mono~189ms prep/~193ms E2E versus proportional~21/~25ms; different fonts are not causal A/B. This is the next hotspot.

Primary chose exact registered mono-broad CPU capture, not another timing sweep/new workload executor.
Existing Labs documented nodeFlags provide Node CPU profiles; only NEW mono broad prep has unique
@mono-broad-preparation tag. Optional --profile-tag/--cpu-profile-output must be paired, candidate-only, no baseline
or saved candidate; exactly ONE row; diagnostic result names isolated; saved-profile reuse rejected.
Release-comparison63536 passed9/9; static31668 passed. Exact071 capture22570 completed two diagnostic blocks
with stable clocks and 32 samples of one registered mono broad-preparation row. Worker orchestration is a separate
profile. Two execution profiles each put ~70% self samples in Wasm294. Authenticated named artifact matches exact
release/executable ab9d7ecf:294 is `decode_utf16_range_into`, reached through setter preparation, not publication.
Named manifest-summary schema interoperability is being fixed through the same hash/function-map authentication;
no profile rerun or weaker symbol association. Static97455 and eight summary tests62687 pass. New harness digest e91db26f differs from historical7da48ebe.

Primary source review found full prefix/suffix UTF-16 context decoding even though pinned HarfRust0.12.0 retains only
five scalar codepoints. Accepted bounded correction: decode nearest last five before the item (outward order), first
five after it; reuse existing scratch/scalar decoder, preserve slice/surrogate semantics and full item shaping. This
scalar contract is distinct from five shaping clusters and SIMD lane counts. Luna implements the prescribed helper
and exhaustive independent UTF-16 slice oracle; primary reviews and accepts only after native/packed/size and paired
mono/proportional/batch/style evidence. No speedup claimed before timing. Bounded context adds30 net production lines; native438 plus conformance,
static, scoped build74257, focused Node183/183(56336), docs38358 all pass. New d73b TGZ is3,174,692B;
shaper grows1,212raw/217gzip versus071. Package.json/all distJS/four other Wasm remain identical. Paired four-block
assignment2380 completes:2 faster/10 neutral/0 slower/0 skipped/no correctness errors. Mono broad preparation
188.37→21.93ms (−166.44ms/−88.4%); mono broad SET+publication192.20→26.95ms (−165.25ms/−86.0%). Other
cases neutral, not universal parity. Parent RETAINS this measured fix; batch→cold→style controls queued sequentially
before full/main/release and live acceptance. Batch96465:0 faster/2 slower/5 neutral/no errors;512rewrite
13.27→14.06ms (+.79),1024publish26.22→27.69ms (+1.47). Candidate clock drift6.0%; attribution is uncertain,
not waived. Cold33214:3 neutral/no errors;22k first publication26.34→26.43ms. Style27341:17 neutral/no skips/no errors,
noisy color-only families (~11.6–16.4%); no blanket parity claim. ALL Node/docs then full main→d73b and
published0.1.0→SAME saved d73b candidate queued. Runtime/harness FROZEN; no optimization edits during gates.
Remote main still2f62d6 (verified); c2ea9cef control unchanged. Old4af full is historical, never relabeled.
ALL Node25886 stopped1022/1025:three instrumentation assertions count read-only first-summary materialization
as semantic preparation. Source trace: #prepareTextCandidate increments semantic count only preparationChanged;
empty-mutation query requests intentionally materialize lazy views. Primary prescribes separate semantic/query
counters, cached repeated-read and no-publication assertions in two existing tests. No runtime edit/relaxed numeric
expectations. Two existing tests now separately observe semantic requests/query-only frames; primary reviewed and
unified reused instrumentation. Static64233, focused16/16(53569), ALL Node1025/1025(67852), and docs zero
errors/warnings pass on unchanged d73b. Original failed log preserved. Full four-block main c2→d73b is starting;
published0.1.0 comparison will reuse SAME saved candidate, not time it twice. Parent interprets final landscape.
No profile/frame-rate claim follows. Cumulative size gate remains open.

- [x] Restore source/dist/package071 and preserve rejected experiment/results.
- [x] Profile harness static/reuse guard gates; exact one-case CPU capture, authenticated parent hotspot judgment.
- [ ] Bounded correction, cold/fuzz correctness, size and targeted paired evidence; retain only justified work.
- [ ] Final full and live gates above, then held stack readiness.

## Preview and knowledge links

Hero=root `.cache/ascii-slug-hero`; GLYPH_PREVIEW_ROOT=WORK selects held ropes. Existing URL
https://recovered-ascii-hero.ascii-slug-hero.localhost:1355/ requires server/provenance/reload verification.
No server/GPU lane during Labs. Follow Portless before launch; never add it to scripts/dependencies. Scenes always
animate under reduced motion; camera/parallax may reduce. Use actual rAF intervals for FPS; old44FPS is historical.

[Detailed lifetimes/research](../planning/retained-text-assignment.md) · [Historical checkpoints](frontier-checkpoints-2026-10-12.md).

## 2026-10-13 Frozen d73b full landscape and bulk diagnostic

Main c2ea9cef→d73b, four blocks, harnessc7737f80:60 faster/16 slower/50 neutral/one timing-mode exclusion;126 comparable, zero correctness failures. Workload median2.545→2.230ms,≤3ms68→75. Report:WORK `.cache/retained-prepare-publish-wave1/bounded-context-main-full/summary.md`. Published0.1.0 baseline reuses the same saved candidate:89 faster/2 slower/24 neutral/10 excluded;115 comparable, median3.750→2.240ms. Baseline CPU clock drift119.1% (.85–3.34GHz) prevents release-wide acceptance; no timed rerun requested. Report:bounded-context-release-full/summary.md. An initial invocation omitted explicit candidate and was rejected by saved-artifact authentication before timing; corrected command preserved validator and both logs.

All16 main slower rows, baseline→candidate ms:unsafe reflow.77127→1.21;Fredoka typing2.19→3.03;measure aftertext1.78→2.38;100cached glyph copies.18452→.24515;1024publish20.68→26.73;long typing3.06→3.87;512rewrite11.61→14.19;reporter reflow.89685→1.09;inspection+width publication10.06→12.16;1000no-op scene.56869→.64244;100mount+borrow14.99→16.57;256rewrite6.13→6.76;10label lastsame-length engine.49927→.54875;128rewrite3.41→3.64;unsafe textedit2.51→2.65;64rewrite2.05→2.15. Release two comparable slows:1024publish20.94→26.73 (+5.79ms),512rewrite12.21→14.19 (+1.98ms).

Main large wins:1000labels100interleaved edit/read/publications182.77→67.46ms;100 immediate measures+publication125.80→32.42ms;monospaced broad end-to-end197.08→26.07ms. Trailing-span1000labels58.91→51.74ms remains expensive. Current suite adds six Mono cases and formerly excluded10no-op:119 common candidate cases retain median1.77ms from old4af to d73b. Different suite headlines do not establish regression; separate runs do not establish causal parity.

Exact bulk1024 Labs case acquired one diagnostic tag, leaving setup/body/assertions unchanged. Named artifact authenticates exactd73b executable96a66fa8;profiles122101/122103 under bulk-1024-profile are valid, orchestration profile122059 lacks Wasm and is excluded. Whole workers include setup/imports; cold prepare_upsert and unassigned GC cannot be attributed to the timed update. Parent's benchFn ancestry filter finds812125/1635125us qualified sampled CPU:prepareTextCandidate432705/913421us (53–56%),outside-preparation setter57208/100207us,scene publication186877/413040us (23–25%),other135335/208457us. Neither these samples nor raw whole-worker GC are elapsed workload timers. Existing Inspector-scoped bulk-write diagnostic is next; it uses a related fixture, explicitly not the exact Labs fixture.

Unconsumed private RenderPlannerCounters API/fields/increments were removed only after frozen full timing. No caller/public export exists; all actual request-boundary tests remain. This is source-only:dist/TGZd73b is unchanged and deletion gates/newartifact pending. No commit/push/merge/release.

Related Inspector-scoped bulk-write diagnostics complete exit0 on exactd73b with authenticated named executable96a66fa8. Setup/three warmups precede profiler start;20timed iterations precede profiler stop;parity reads happen afterward. Preparation20,480sets/no reads/no publications:p50/p9517.5525/23.0332ms,241samples/382542us,GC5samples/7541us. Set+scene publication20,480sets/no reads/20publications:p50/p9524.5606/27.9503ms,333samples/524458us,GC3samples/4417us. Source maps bound to exact TGZ;named Wasm URL0069f01a,additionalpublicationURL00aa4bda unattributed. Inspector post/stop self32125/35083us is profiler overhead;do not equate CPU totals to elapsed latency. Preparation shared branch inclusive257168/283501us;Rust ParagraphState.prepare174041/199249us inclusive;scene publish includes orderedprepare16543us andgather.update_fields14876us in publication capture. Inclusive rows overlap. GC is a small measured contributor in this scoped related case,not evidence about every scene or jitter. Primary reviewed unusedcounter exactdiff against frozen sourceMap:22deleted lines,no other source delta in thatfile. Static/build/focused/docs/pack next;no hypothetical bulk fast path approved.

Counter retirement is accepted after primary exactdiff review and Luna gates:static65839/build25318/Node18133 all pass,199/199 focused tests;docs zeroerrors/zerowarnings. Packed5acd90fce08c403e4d3b10aa094e416e40d671a335afe53a278a115e763b0d81 is3,174,018bytes,674fewer tarballbytes than d73b. AllfiveWasm hashes/raw/gzip match d73b;no Rust size gain or new performance result claimed. Identity/logs:WORK `.cache/retained-prepare-publish-wave1/counter-retirement-proof/`. Full landscape remains frozen d73b evidence. Goal active;bulk/length,size,visual/finalgates unresolved.

## 2026-10-13 — Semantic ownership consolidation

Full-index measure variant `4f185056` passed correctness but paired seven-case batch was one slower, five neutral and one clock-confounded exclusion; rewrite256 6.23→6.64 ms. Its single-row variant `0104e986` was two slower/five neutral: rewrite64 2.09→2.20 ms, toggle1,000 .626→.667 ms. Neither was accepted. Both authenticated snapshots and logs remain under the request-index proof folders.

Known-owner `7f579d89` validates contiguous records and projected lifecycle membership through the same routing loop while avoiding setter index allocation. Static/build/docs, native439 plus conformance and Node199 pass. Four-block seven-case batch is all neutral, without skipped cases or correctness failures. This retires about90 production lines and saves564raw/546gzip Wasm bytes; no speedup is claimed. Current shaper1,622,359raw/599,655gzip remains166,269raw/65,642gzip larger than main.

Authenticated main scoped publication diagnostic uses pinned c2ea without invented Wasm symbol names: p50/p95 18.503/24.895ms. The analogous d73b capture is24.561/27.950ms; these separate profiles are diagnostic, not a paired release comparison. A benchmark-only report fix permits artifact-only JavaScript source authentication without named Wasm proof; explicit Wasm URL still requires all original identity checks. Eight focused report tests and static checks pass. No additional timing was run to repair the report.

Current TypeScript hypothesis is unnecessary result materialization when no semantic view is requested. Scoped preparation sampled13.501ms self in result decoding across20,480sets; this is sampled CPU, not a promised elapsed win. One shared bounds/capacity validator preserves envelope checks while omitting discarded byte views, publication objects and borrowed leases. Primary reviewed its +13production-line patch; gates and paired timing are pending.

## 2026-10-13 — Unrequested-result experiment retired

Artifact326d passed static/build, Node207 and docs with five Wasms byte-identical to7f. One four-block seven-case comparison was all neutral, no skips or correctness failures. Baseline7f→326d p50: edit/read1of100 .20140→.18646ms; rewrite64 2.20→2.16,128 3.68→3.78,256 6.60→6.87,512 13.35→13.88; toggle1,000 .65983→.66435; publish1,024 26.28→27.24ms. Clocks3.23–3.31GHz; noisy small controls limit attribution. Primary rejected the +13production-line/+45gzip-JS change and restored all three exact source-before files. Candidate, patch and results remain in unrequested-result proof/batch folders. No additional timing is authorized for restoration.

## Archived 14 October checkpoint before the 9a0e full comparison

The following is an archived snapshot. Its live handles and pending results are superseded by the canonical current tracker.

### Current checkpoint — 14 October 2026

WORK is `feat/rust-text-input-wire` at `d998bb814eac473b4d24dc1871ebee9f81c95b81`. Real `gh stack rebase feat/rust-text-input-wire --downstack --remote origin` integrated latest main `d7ffcbbdc5a38635604570f76395005e2d195d9a`. The local chain remains #292 → #301 → #302 → current top branch; no push, submit, merge, release or tag occurred. #304/#305's Slug shader API, tests and documentation are preserved. Both shader implementations and the shader API fixture match current main exactly.

**Preservation:** 97 staged/unstaged/untracked working files were authenticated before rebase. Explicit stash `44d6be8d73b9f47da295d093e41ee1c74617b512` and binary patches/index inventory remain in `.cache/held-stack-main-sync/`. Restore conflicts were only three documentation timestamps; merged bodies keep both ropes and Slug notes. The original five staged paths and their exact index blobs were restored. All original working-file hashes match except the three expected merged docs. Receipt `restored.json` and `gh stack view --json` prove the restored branch and clean conflict state. Never pop an unrelated stash or reset this dirty worktree.

| Evidence / phase                             | Exact result and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earlier accepted endpoint isolation          | Existing shared shape executor now isolates the edited edge run (+17/−3 production), copying13 clean runs. Generalized unsafe prototype retired. Frozen1e paired edit gate improved Inter set+measure3.74→2.58ms and set+publish4.91→3.80ms. Not current-main/npm acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Last completed timing, before aggregate work | 1e→8c15 four-block edit-sized:0faster/2slower/53neutral; 100 edit/read/publications among1000labels p5032.376→34.123ms, p9534.510→35.857ms. No favorable rerun. 8c15 remains unaccepted historical evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Diagnosed publication cause                  | Authenticated8c15 profile: one hostMesh,8000→8100instances; preparation p50/p952.166/3.466ms versus publication29.644/32.348ms, unpaired diagnostics. Exclusive samples: Three reconciliation~26.8%, ordered prepare~22%; no attribution of all ordered time to bounds. Indexed native case reducedG records despite7 admissions/rewrites.                                                                                                                                                                                                                                                                                                                                                         |
| Complete aggregate/cache/cursor wave         | One canonical draw compiler; clean draw → clean32-slot block → row reduction. Exact dirty physical membership, zero-mask metadata, current key/storage/mode witnesses, bit-safe bounds and lifecycle guards. Dense record consumption uses the existing cursor. No generic rope widening/new semantic tree/API/ABI.                                                                                                                                                                                                                                                                                                                                                                                |
| Coherent cleanup                             | Retired three repeated searches with monotone local positions, one draw-field equality owner, removed unreachable replay branch. Normal metadata work after dirty sort is O(B+D+Q·32+R+draws); still O(B) copy/fold, dense/adverse O(G), and host/Three costs remain. Cleanup production+81/−81 before format; added77 distinct boundary-oracle lines.                                                                                                                                                                                                                                                                                                                                             |
| Exact pre-main-integration correctness       | `aggregate-eligibility-gate/attempt1/`: formatter/static,458native (448unit+6outline+2bidi+1grapheme+1line-break),1042Node,build/pack all pass. Fixed2511-file source closure after formatting. Actual compiler float-bit/error and cold-host/cache/lifecycle/key/u16/Unicode/seed cases pass.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Current frozen combined wave                 | `combined-retirement-gate/attempt2/package/pmndrs-glyph-0.1.0.tgz`, SHA5b7f8915d4877ed94eba7bbc48788556c37c90390840fa453a92d0343ff2b43b;1,217members/3,182,938tarballbytes. Static/build/460native/1042Node/compose/pack pass. Shaper1,627,404raw/602,399gzip9-mtime0: −284/−236 versus886e, cumulative +171,314/+68,386 versuslatestmain remains unjustified. Runtime JS aggregate −875raw/−184gzip versus886e (not a tree-shaken bundle measurement). Only shaper Wasm changes versus886e; manifest/exports remain equal. Public guard is stripped; private ABI reset/invalidated changes remain deliberate. No elapsed-speedup claim.                                                           |
| Latest-main baseline                         | CIrun38498756661/artifact11864449277, authenticatedhead d7ffcbbd. `.cache/main-d7ffcbbd-ci-package/pmndrs-glyph-0.1.0.tgz` SHA3c6edf621d472ef08115cf69699ec2867be95898c4d56f7b15c19bc43dc35a42. Older c2ea/2f62 package is distinct historical pinned-main evidence.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Completed full main comparison               | `full-5b7-main/labs/summary.md`: four blocks,77faster/17slower/34neutral/one timing-mode exclusion; no baseline check failures. Median workload p502.705→2.285ms. 100edit/read/publications among1000labels130.00→26.79ms; shared-material scattered8192spans38.07→21.86ms; trailing-span1000labels59.60→52.44ms. Warm dense1024setter+publication21.03→26.12ms and Fredoka edit/measure0.932→3.11ms remain regressions. Candidate clock drift6.5%; smaller deltas are qualified, not universally accepted. Source/HEAD/index closure unchanged. Wrapper exited1 on readonly zsh `status` AFTER complete Labs artifacts; child exit was not independently captured. Preserve that error; no rerun. |

**Frozen source provenance:** combined gate's `final-after-analysis.json` records all2521 maintained hashes and unchangedHEAD/index, includingoriginalfive stagedpaths. Formatter touched onlythree reviewedRustfiles andtwo editedNode tests. The original attempt2 reconstruction accidentally compared against baseline preimages; primary caught it, correct post-implementation pre-format hashes were reconstructed, and the corrected3,899-byte diff proves whitespace-only changes. Superseded evidence is retained, not reused. Three text remains unchanged; failed scene-observation fusion stays retired. Current dist/package5b7 includes the complete wave and main's Slug changes.

### Next wave boundary and outstanding acceptance

1. Main integration, six reviews, four implementation slices and combined gate are complete/primary-reviewed. Attempt1 stopped on formatting; attempt2 passes static,460native (450unit+6outline+2bidi+1grapheme+1line-break),1042Node,compose/pack. Fullmain3c6→candidate5b7 has completed; source closure and generated manifest/report reviewed. Wrapper bookkeeping failure is recorded separately from complete results, not called an exit0 gate. Published0.1.0 versus SAMEsavedcandidate is also complete, exit0, with unchanged source/harness. Current5b7 attribution checkpoint is complete. Next: complete the bounded ownership/size-accounting reduction wave and choose any Rust retirement from actual body accounting; no per-helper performance runs.
2. Both full comparisons are complete and primary-reviewed. Published0.1.0:89faster/6slower/32neutral,127comparable,2candidate-only outline cases,zero correctness errors/mode mismatches; median workload p503.190→2.130ms. Full p50/p95 and receipts: `full-5b7-main/` and `full-5b7-published010/`. Remaining release regressions: warm1024bulk(+4.119ms),Fredoka(+2.194ms),512rewrite(+2.053ms),width measure(+0.554ms),unsafe reflow(+0.170ms),cached100metrics(+0.110ms). Candidate6.5%clock drift still qualifies precision. No favorable rerun.
3. Complete packed public declaration and generated ABI inventory. Source review and internal-guard correction are in `current-api-review.md`; private root-invalidated/reset support deliberately changes the ABI. Identical exports alone are not compatibility proof. Cumulative binary growth, live/peak/high-water memory and source retirement still require justification.
4. Real browser benchmark-scene and hero visual/batching checks remain required, with Portless for every listening server. No fake FPS timers or inferred GPU submissions. Complete maintained docs attestation only after coherent staging; old8fbd5d81 is not current-byte evidence.
5. Address only remaining evidenced bottlenecks in coherent waves. Do not revive rejected Three fusion or add ancestor-memo guard machinery (~4% resolver samples and public-getter/callback compatibility risks). Keep one executor and existing packed/SoA/SWAR/SIMD paths.
6. Source-classification correction: `stress.bench.ts`1024 case publishes its fixture BEFORE timing, then changes all1024strings and publishes per iteration. It is warm dense bulk work, not cold. First/last position families exist; middle is not covered by this full suite.
7. Final reviewed stack may be submitted via real `gh stack submit --auto --remote origin` and marked ready only after all gates. It remains HELD/UNMERGED.

Full frozen comparisons and current5b7 diagnostics are complete, with exact receipts under `full-5b7-main/`, `full-5b7-published010/` and `current-5b7-diagnostics/`. The candidate was not retimed for the release comparison. Diagnostics: warm1024sets/no-publication p50/p9515.597/18.732ms; withpublication22.115/25.991ms; Fredoka set/read2.452/3.240ms. They are unpaired attribution: bulk~64%Wasm/~30%JS/~1%GC; Fredoka mainlyRust. Fresh SolHigh `current-preparation-advisor/review.md` deferred guard widening; do not revive it or create a second executor. Blocksize36bytes is proven; live/peak/high-water memory is not. Current reduction/gate state follows.

### Active reduction wave — 14 October 2026

HOST accounting passed12/12 fixtures and one named workflow, with2524 maintained files unchanged. Exact5b7 shaperb66f:1,627,404raw bytes/1036functions; no equal-type/exact-body duplicates. Code-section growth versusmain is169,473bytes, data1,632bytes. Largest body ParagraphState::prepare113,680bytes aggregates stages; D-244 rejects blanket outlining. Reports: `size-accounting-5b7-main/`.

Gzip reconciliation: Node24.18/zlib1.3.1-e00f703 gives608,223candidate/539,003main (+69,220). Python3.14.8/zlib1.2.12 reproduces archived candidate602,399/SHA1f431; historical executable is unknown. Old within-producer +68,386 remains historical; never mix compressor absolute sizes. Proof: `size-accounting-5b7-main/gzip-reconciliation.md`.

The integrated D-243 retirement wave removes seven comparator/range sorts: linear merge/coalescing of ordered same-coordinate dirty ranges; packed boundary keys through shared sort_keys; state orderings through shared sort_pairs/permutation and existing transient scratch. TS resolved ownership removes WeakMap/per-value wrappers. No shader, Unicode admission, semantic executor, public API or ABI changes in this wave. Boundary keys add4bytes/capacity slot, lifecycle pairs8bytes/slot; reused pair scratch can grow. Final artifact size and live memory are still gates. Exact implementor patches/proofs: `positioning-order-retirement/`, `state-order-retirement/`, `resolved-ownership-retirement/`; primary review `order-ownership-wave/integration-review.md`. Source-growth counts are in those isolated diffs; binary retirement is not yet measured.

Primary and fresh SolHigh reviewed producer monotonicity, payload/order pairing, scratch phases and failure cleanup. Preflight runs before routing: repeated owner groups make text-record count the safe reserve bound. Zero/singleton pair lowering is skipped. The existing shared permutation now rejects counts above2^31 before scratch clearing. New placement-sort allocation can fail after binding; the preparation closure invalidates the derived root before returning, with no renderer adoption. This changed failure point is explicit. A real production-helper test covers nonmonotone placement slot/payloads.

Correctness gate history (all receipts retained under `order-ownership-wave/gate/`):

- attempt1:452native units pass/2new-test failures; corrected test stimuli now move glyph baselines and use real order mutations instead of inspecting already-reused scratch. Production unchanged by those corrections.
- attempt2: full native/Unicode conformance/doc tests and runtime build passed; static failed HOST CLI parameter shadow. Only markdown-local parameter/references renamed, output literals unchanged.
- attempt3: static reachedClippy, failed redundant usize cast and15single-range fixture expressions in positioning.rs. Source freeze is unlocked only for that bounded cast/test-syntax correction; no lint suppression or coverage deletion. Sol6Medium positioning agent owns it. No Node/package/named-size/timing has run yet.

Final attempt4 passes static/build,464native (454unit+6outline+2bidi+1grapheme+1line-break),209focused/1045fullNode,adapters,paragraphcontracts,compose,pack,named parity,size. Only prior test/Clippy/host-lint corrections were needed; their failure receipts remain. All2524 maintained files unchanged duringattempt4, closure34f61e84…; runtime dist948files closure6da93575…. HEADd998/original5stagedblobs+mode/pathinventory remain unchanged. RawindexSHA refreshed8f3eef→2e7d1f53 without blob changes.

Current immutable tar: `order-ownership-wave/gate/attempt4/package/pmndrs-glyph-0.1.0.tgz`, SHA9a0e0614180e98eeed1e963215df7429ef09cef6e338aef2d456ce2ed35b1066,3,170,447bytes. ShaperSHAc493e409554fcee69737bf6e7c3fe0ad64bb9239b8c99cb70126676a89e514d0; namedbea3084b… matches executable exactly. New shaper1,590,560raw/595,983Node-zlibgzip bytes,1014functions: −36,844raw/−12,240gzip/−22functions vs5b7; cumulative+134,470raw/+56,980gzip versusmain3c remains open. Seven retired comparator/range-sort symbol families are absent from the new named report; owner hints overlap and do not partition dependencies. Final receipt/size report under `order-ownership-wave/gate/attempt4/`.

Primary reviewed actual final receipts/body accounting and passedsource/retirement/lifetimeproof. HOST-only Luna `luna_order_wave_archive_inventory` now inventories exactnew/prior/main packagedWasm/JS/declarations without timing or sourcewrites. Next: Luna `luna_full_5b7_main_labs` performs one full4block pinnedmain→9a0e completed-wave checkpoint and published0.1.0→SAMEsavedcandidate (no candidate retiming), one serialheavy lane, no profiles/favorable reruns. Source/docs freeze before preflight. No benchmarks are currentlylive. Then primary reviews absolute p50/p95, remaining6release regressions and binary/memory/API/ABI/visual gates. All artifacts are held; no merge/release/push.

## Archived 14 October checkpoint before dense request-ingress implementation

### Current checkpoint — 14 October 2026

WORK remains feat/rust-text-input-wire at d998bb814eac473b4d24dc1871ebee9f81c95b81, with intentional staged/unstaged/untracked changes. Latest remote-main integration is d7ffcbbdc5a38635604570f76395005e2d195d9a; the real held gh-stack chain is #292 → #301 → #302 → current top. Slug #304/#305 remains preserved. No push/submit/merge/release/tag occurred. Never reset this worktree or substitute outer main.

**Preservation:** original five stage-0 paths/blobs/modes remain exact; index raw SHA2e7d1f53886490aad1f3de5ede6aa81b9dbe2ee8e98dd57c809f62bbfe3414de includes only prior stat-cache refresh. The full blob inventory, preservation stash44d6be8d73b9f47da295d093e41ee1c74617b512 and restored97-file receipts are under .cache/held-stack-main-sync/. Do not pop an unrelated stash or stage the whole tree.

| Gate / artifact                          | Observed result and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen completed-wave artifact           | .cache/retained-prepare-publish-wave2/order-ownership-wave/gate/attempt4/package/pmndrs-glyph-0.1.0.tgz; SHA9a0e0614180e98eeed1e963215df7429ef09cef6e338aef2d456ce2ed35b1066;1,217members/3,170,447bytes. ShaperSHAc493e409554fcee69737bf6e7c3fe0ad64bb9239b8c99cb70126676a89e514d0. These timings do not describe the next unbuilt wave.                                                                                                                                                                                                                                                                                                                                    |
| Correctness/build                        | Static/build,464native (454unit+6outline+2bidi+1grapheme+1linebreak),209focused/1045fullNode, adapters/paragraphcontracts/compose/pack/named executable parity pass. Failure receipts attempts1–3 remain; attempt4 allpassed. Source closure34f61e84… and dist948-file closure6da93575… are recorded in attempt4/final-receipt.json.                                                                                                                                                                                                                                                                                                                                         |
| Pinned-main full comparison              | Full report (local-only `.cache/retained-prepare-publish-wave2/order-ownership-wave/full-9a0e-main/labs/summary.md`):70faster/16slower/42neutral/oneclock exclusion;128comparable, zero result errors/timing-mode mismatches, terminal0. Median workload p502.615→2.255ms. Main artifact3c6edf621d472ef08115cf69699ec2867be95898c4d56f7b15c19bc43dc35a42.                                                                                                                                                                                                                                                                                                                    |
| Published0.1.0 full comparison           | Final report (local-only `.cache/retained-prepare-publish-wave2/order-ownership-wave/full-9a0e-published010/labs/summary.md`):87faster/9slower/26neutral/5excluded;122comparable, zero result errors, terminal0. Threeclock exclusions+two timing-mode exclusions; two candidate-only outline workloads. Raw87/11/26/3 is before exclusions, not the final verdict. Median workload p503.390→2.395ms. SAMEcandidate JSON reused byte-for-byte, no retiming. Registry integrity and locks in postrun-authentication.json.                                                                                                                                                     |
| Absolute product evidence                | Among1000labels,100edit/read/publications: main124.13→26.43ms; published225.83→26.43ms. Interleaved: main172.67→64.62ms; published255.27→64.62ms. Trailing1000spans: main56.62→49.80ms; published82.16→49.80ms. Workload times, not FPS.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Remaining regression evidence            | Main warm1024bulk20.546/22.309→25.373/28.108ms p50/p95; cold100borrow14.583/16.457→16.920/19.066;512rewrite11.008/12.552→13.106/14.008;Fredoka.947/2.677→2.943/3.313. Full16 absolute deltas in full-9a0e-main/slower-absolute-primary.json. p50 uses block medians; p95 pooled samples with pinned Labs percentile indexing. These causes remain open; do not explain them away as drift.                                                                                                                                                                                                                                                                                   |
| Release-regression absolute verification | full-9a0e-published010/slower-absolute-retrieved.json and receipt: primary independently verified all18 old/new p50/p95 pairs and both input hashes. Dense1024 adds4.470ms p50/5.371ms p95; the other eight add.015–.885ms p50. Width-inspection/publication p95 improves18.054→13.070ms despite slowerp50. No retiming; five exclusions remain excluded.                                                                                                                                                                                                                                                                                                                    |
| Size/memory                              | Shaper1,590,560raw/595,983Node-zlibgzip bytes: −36,844/−12,240 and22fewerfunctions versus5b7; cumulative+134,470/+56,980 versusmain stillneeds justification/reduction. Runtime237JS members864,780raw/234,748framedaggregate gzip: −278/−65 versus5b7;+7,453/+2,159 versusmain (not tree-shakenbundle). Requested engine live/peak now captured below; physical fragmentation and JS/GPU retention remain unmeasured.                                                                                                                                                                                                                                                       |
| Six fresh SolHigh reviews                | All six complete; primary read reports under order-ownership-wave/final-reviews/. Preparation, aggregate, ordering, API/lifetimes and Three host scopes found no justified deletion/defect. The inherited mapper generation defect was reproduced against frozen9a0e:141/142 tests passed, with only the new span-before-draw binding assertion failing. The corrected build passes that regression. Historical identity retention remains separate; no second executor or unproved Unicode/segmented redesign is authorized.                                                                                                                                                |
| Latest mapper/memory correctness wave    | order-ownership-wave/mapper-memory-gate/attempt1/report.md: static/build,467native,145focused/1045fullNode and docs:check pass. Original staged raw diff unchanged. Generated mapper JS/maps changed;9a0e timing claims remain frozen-artifact evidence, not timings of this latest JS.                                                                                                                                                                                                                                                                                                                                                                                      |
| Current run-metadata wave                | run-metadata-gate/attempt2/report/report.md: static/build,469native/1045Node, benchmark static, host accounting4/4 and docs:check pass. Frozen archive58eeb9d46d3bdb3360ac403845a836ba68000c75314afd8191331afd621386ec; shaper33898e22fac86101b883e842d6aea59a9b4fe4d7f830439a49a6ec980a38dbfd,1,590,687raw/596,144Node-zlibgzip,1013functions. Delta versus9a0e:+127raw/+161gzip; versusmain:+134,597/+57,141. Archive237JS members total864,847raw,+67versus9a0e from mapper correction; tree-shaken bundle gate remains open. No current58 timings yet. Original staged patch/five blobs/lock preserved.                                                                  |
| Diagnostic allocator isolation           | live-memory-probe/artifact/manifest.json: feature-off shaper matches c493 exactly; diagnostic-only artifact a2a8989b… verifies alloc16/realloc32/free with zero final live delta. Logical requested-byte counters are proven; application capture is recorded below. Physical fragmentation, JS and GPU retention remain unmeasured.                                                                                                                                                                                                                                                                                                                                         |
| Application memory capture               | application-live-memory/capture/attempt2/memory.json SHA8f4b803a33366235a0868c45b14b2f726e1a983709792cf32681be3f2dbd3850:71 phases pass, input hashes unchanged, frozen9a0e/controlc493/diagnostica2a8 authenticated. Dense warm requested-live settles43,792,647bytes and teardown7,621,080; warm allocations6,858/update after initial growth. All eight independent-copy teardown cycles return exactly7,639,240bytes. Wasm capacity ends783pages; requested bytes exclude fragmentation/transient realloc peaks/JS/GPU/decoder memory. Attempt1 was a launcher cwd error before capture and remains preserved. Counts establish allocation traffic, not CPU attribution. |
| Initial browser visual smoke             | Current built runtime was served through existing Portless proxy at https://glyph-rope-review.localhost:1355. Dynamic-layout/Inter/Slug at DPR2 visibly renders and reflows on WebGPU and WebGL2; Bitmap and MSDF reflow also visually inspected on WebGL2. Full-density Billboard rendered, but overlap prevents a useful visual parity conclusion without lower-density/main A/B. Server74386 stopped terminal130 and agent tab2 closed before CPU captures. This is not complete scene coverage, hero verification, or FPS acceptance.                                                                                                                                    |
| Dense CPU attribution                    | dense-9a0e-attribution/preparation and publication: both exact9a0e/named-c493 captures pass,1024owners/122,880timed setters each; zero timed reads, publication lane120scene publications; one draw/9,216glyphs retained. Preparation sampled1,695,875µs: shaping421,710; allocator22,832 (~1.35%); ParagraphState::prepare195,043self is an inlined aggregate, not a specific stage. Publication allocator22,583µs; gather/ordered/host work separately visible. Inclusive frames overlap and other-wasm bucket is not fully stage-classified. Diagnosticp50/p95 are not paired speedups; full Labs results remain authoritative.                                           |
| API/ABI and coverage                     | Actual packed guards/queue/PostCommitError stripped; root/Three signatures unchanged versusmain. Private resetRoot/rootInvalidated deliberate. Four isolated packed consumers pass strict TS fixtures/build/missing-peer checks with skipLibCheck=true. Min-peer/browser/finalABI gates remain open. Factual coverage inventory corrected by primary: split Labs exists at1/1000owners, not100; same-value/overwrite exist in profile driver, not Labs.                                                                                                                                                                                                                      |
| Final declaration archive inspection     | final-58-api-inspection/declaration-archive-inspection.json: all226 current58 declarations byte-identical to reviewed9a0e. Export maps, peer ranges and optional-peer metadata match both9a0e andmain. Nine declaration files differ versusmain; existing source review distinguishes internal helpers/ABI and comments from unchanged root/Three signatures. This does not replace minimum-peer or browser proof.                                                                                                                                                                                                                                                           |

**Current58 final comparisons are terminal:** main attempt2 session81580 and published0.1.0 attempt3 session52069 both exited0. Main:86faster/22slower/34neutral/3timing-mode exclusions,142comparable,6.1% baseline clock drift. Published:97faster/14slower/27neutral/5exclusions,138comparable,9.3% baseline drift; four timing-mode mismatches and one clock-confounded exclusion. Both have zero baseline check failures. Exact candidate JSON SHA02424cca76df0873c71f8beb8151886ad2400eab39a84d6942478e5953bbcb9b is reused byte-for-byte; candidate was timed once. All absolute p50/pooled-p95 rows are in the final58 report (local-only `.cache/retained-prepare-publish-wave2/order-ownership-wave/final-58-published010/attempt3/final-report.md`). Production source9b8f99d7…, harness1b234a29…,175-fixture inventory, index, staged patch058710… and root lockd0d64… unchanged across both runs. Different inventory digest methods are not comparable hashes. Failed release attempt2 omitted the explicit candidate and was rejected before timing; its receipt remains. No validation bypass or favorable rerun. No benchmark/profile/server currently runs.

**User priority — larger gaps and tails:** pursue p95 spikes and p50 regressions above1ms first. Sub1ms median gaps are deferred unless one correction addresses a shared larger cause. Main's seven larger median gaps are dense1024publication+4.971ms,512rewrite+2.089ms,cold100glyph-borrow+2.078ms,Fredokaedit/read+2.068ms,widthinspection/publication+1.937ms,cold22kpublication+1.772ms,longparagraphedit/read+1.466ms. Font-size publication is a separate high-priority tail: p959.217→32.498ms despite only+0.677ms p50. Primary independently recalculated these from actual block medians and pooled samples. Do not treat this tail as explained GC or drift. Luna performs read-only saved-result tail forensics under font-size-tail-forensics/; no new timing is authorized. Primary selects the next coherent implementation wave from exclusive artifact-authenticated evidence and source proof. Retain the user's large-wave cadence; no micro-measurements or sub1ms helper chase.

**Private ABI review completed:** source/lifetime receipt (local-only `.cache/retained-prepare-publish-wave2/order-ownership-wave/final-58-api-inspection/private-abi-source-review.md`) traces rootInvalidated/resetRoot generator/export/loader/transport/replay and recovery tests. Current packed config/glyph declaration strips the internal mutation guard, correcting the older source-only public-method warning. All226 current declarations equal reviewed9a0e; nine differ versusmain. This does not close cumulative size/memory, broader visual/hero or held-submission gates.

**Next high-delta evidence boundary:** fresh SolHigh large-edit-wave-advice/report.md is complete and primary read it. Both long-edit cases alternate count-changing insertion/removal; sparse shape windows, cluster correspondence and flow continuation currently require equal counts. Full cluster rebuild clears its shaped-island cache; previous_edge_ids preserves identity only, while attach_line_edges traverses every fragment. Demanded summary also scans clusters/lines/ink. These restrictions partly exist on main; they are not proved introduced regressions. An integrated count-change correspondence wave remains conditional on exact current stage attribution and concat/Unicode/continuation/edge/float proofs; no runtime implementation is authorized from this advice alone. Adviser retired. Saved font-size forensics is complete:100candidate samples,p9532.498ms,p9957.281ms,max79.544ms,16above16.67ms; no per-sample block/time metadata. Forced GC counters are outside callback timing and do not explain the tail. Sol6Medium owns only the two existing host profiler files to add the exact font-size/no-timed-read case and cold parity; primary reviews before execution. Luna owns one isolated current58 named-shaper build under current-58-attribution/named for executable authentication and current body attribution. No latency run or runtime edit is authorized in this instrumentation step; keep one heavy lane. Existing full58 comparisons remain exact saved evidence, not results of later harness changes.

### Next coherent wave and remaining gates

**High-delta attribution completed:** current-58-attribution/named authenticates executable33898… against frozen58,1013functions, no dist writes. Reviewed host font-size case and one benchmark-static gate passed. Four sequential captures under current-58-attribution/captures/attempt1 all exited0 with exact source/harness/archive/index/locks preserved: font-size publication p50/p958.800/9.572ms, setter4.998/5.490, Interedit/read1.934/2.216, Fredoka2.382/2.667. These are diagnostic-only independent processes, not paired speedups. Ordered font-size callbacks did not reproduce32.498ms saved p95; the earlier tail remains unexplained, not cleared. Current named self samples confirm Unicode/cluster revisions/numeric rebuilding/positioning in Inter and substantial HarfRust work in Fredoka; the aggregate other-wasm bucket remains unclassified. Primary also found newly executed positioning/ink relative to main's measurement-only query, but postponing positioning conflicts with the accepted renderer-only publication decision. Dropping only BORROWED_LAYOUT neither avoids positioning/ink nor preserves later inspection line spans. Ink-only work is deferred under user priorities. Fresh read-only SolHigh count-change-correspondence-design now proves one coordinate-typed prefix/affected/suffix mapping through existing cluster and flow convergence owners; no runtime code or new latency run is authorized until primary reviews its exact admission/continuation/edge/lifetime/deletion proof. Preserve broad Unicode and unsafe shaping fallback. Dense publication remains a separate open larger gap. No further microbenchmark or profile run is authorized during this design/implementation wave.

1. **Complete:** generation-aware mapper retirement preserves a staged newer buffer. Primary reviewed the two-line correction and existing growth regression; frozen negative control and corrected focused/full suites distinguish the defect. No new cache/publicAPI/ABI.
2. **Complete:** diagnostic-only allocator module and isolated named artifact workflow. Default feature OFF preserves shipping shaper bytes and exports. Feature ON counts logical requested-live/peak/calls through the same Talc allocator. No private-layout casts/vendor fork; physical fragmentation/transient realloc peak remain excluded.
3. **Complete dependency correction and consolidated correctness/size gate:** run-metadata-retention/owned.diff is+10/−8 production lines, with no new state/cache/API/ABI. Primary traced active-run consumers and text-dirty shaping, corrected negative tests to omit unrelated style upserts, and inspected the cold glyph oracle and certified-text/feature/language dependency case. Final focused2/2 and style oracle1/1 pass; long sparse oracle also asserts metadata reuse while shape remains prepared. Staged module comments now distinguish semantic acceptance from renderer publication and arena-owned capacity policy. The gate under run-metadata-gate/attempt2 is terminal: static/native/build/fullNode/benchmark-static/accounting/docs pass. Native469 and Node1045 pass; archive58 and exact sizes are recorded above. Attempt1 stopped at cargo fmt before any test/build. Primary ran named glyph:shaper-format (session55925 exit0), then authorized the corrected static gate and remaining checks. No performance timing. Prior9a0e full timings do not describe this new source until final comparison. Rope pooling remains deferred: capacity retention adds another leaf generation and allocator self share alone does not justify it. Historical token-cache retirement remains deferred pending lifetime/memory evidence.
4. **Prepared-operation coverage reviewed:** Sol6Medium added15 cases in prepared-operations.bench.ts plus the missing100-owner split; existing split names are preserved. Primary corrected setter-only/same-value/overwrite setup to leave the target unqueried; read cases warm only their requested cache. Cold oracles/unchanged siblings run outside timing. Frozen58 runtime stays unchanged. Benchmark-static/docs passed. The first full58/main launch session70354 stopped terminal130 during the baseline: the new helper wrongly compared Labs' first untimed result with the final alternating value and used a postpublication cold oracle for a prepublication read. Candidate/release were never timed; no completed verdict exists. Logs and unchanged-source receipts remain in final-58-main. Primary reviewed first-result/pre-post corrections and matched the cold oracle's initially published text/read-demand cache to the tested owner. The SAME generator factory powers Labs and benchmark:prepared-operations-check. Attempt5 passes30/30 cases on EACH installed main/candidate/published0.1.0 (90 total), including2/3 invocation parities; primary read actual logs. Plain measure permits absent ink under layout.ts51/70; every other field and every present ink box matches the independent cold oracle. Earlier strict ink-presence checks were benchmark defects; all failed receipts remain. Final helperSHA04dd8f3ecffa6da84867371958987db06e23c531d099be73084d1dc25a5e87b6; benchmark-static and docs:check pass. Source/harness/index/lock preserved. Runtime archive58 stays frozen; do not rebuild/repack or reuse the stopped partial run as a full result. The next full comparison uses a new attempt2 output directory and the corrected authenticated harness, then reuses its candidate for0.1.0. Choose the next performance correction only from authenticated remaining stage evidence. Keep the scalar/SWAR/SIMD packed/SoA design and one preparation/publication executor. Old5b7/8c15 profiles are leads, not9a0e causal magnitudes. Do not widen shaping/Unicode guards without cold/fuzz/continuation proof.
5. **Minimum peer gate complete:** primary read report and terminal log; default glyph:peer-check exited0,55/55 focusedNode and four TypeScript projects pass.447 runtime source hashes, staged five blobs/modes and raw staged diff preserved. Exact Vue patch was not retained (requested3.5 range); no browser pixel claim. Release absolute retrieval is complete and independently checked. Complete prepared API/ABI, cumulative size/memory disposition, broader browser benchmark scenes and hero preview, plus final paired performance after the next substantial wave. Source/docs attestation follows coherent staging, not the old8fbd attestation. Real gh-stack held submission/clean coherent commits remain open. Mark ready only when all requirements hold; **remain unmerged**.

Previous verbose checkpoints are archived in [historical evidence](../reports/frontier-checkpoints-2026-10-12.md). The accepted decision and full architectural report remain mandatory resume context.
