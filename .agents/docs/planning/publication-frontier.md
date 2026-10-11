---
type: Engineering Plan
title: Publication frontier checklist
description: Compact resume point and task tracker for the 0.2.0 publication frontier.
status: draft
sources:
  - resource: retained-text-assignment.md
    title: Detailed design, lifetimes and rope evidence
generated:
  by: openai-codex/gpt-6
  at: '2026-10-11T00:40:24Z'
---

# Publication frontier checklist

## Scope and rules

Prepare 0.2.0 with small independent main-based fixes, one reviewed/validated merge at a time. Release decider:
**published0.1.0 → accepted candidate**. Preserve one pipeline, assignment API, synchronous reads, batching,
recovery and explicit publisher lifetime. The query-first goal is complete; the human holds #292/#240 outside this
release cut. Actual version/package preparation and release authorization are separate future work. Do not resume held Labs, push held documentation/branches, publish a stable release/tag or merge the demo.
Preserve unrelated ROOT edits (~45). One local heavy lane. Sync ASCII through the existing resumable agent after main
advances; preserve all app edits and use Portless for servers. Never advance publishedText on measurement.
Detailed prior diagnostic checkpoints remain in Git history through6f82128f; do not recreate a chronology here.

## Resumed ropes work — 2026-10-11

The user released the development hold: rebase #292 onto main, measure, then pursue the remaining publication frontier.
Keep #292 draft until combined correctness, performance, size and review gates pass. #240 remains superseded/held;
no stable release/tag or demo merge. The completed query-first goal and release report below remain historical evidence.

1. [x] Preserve all75 local commits in feat/ropes-pre-main-2026-10-11 atb86830f2.
2. [x] Consolidate their final tree and rebase with gh stack onto main2f62d6ba; local integration head e0d86c63.
3. [ ] Integrate durable preparation with query-first copy/lifetime/cache guarantees. TypeScript and native ID reservation
       pass; first rebuilt focused run exposed missing durable codec binding and obsolete result-serialization assumptions.
       Existing commit_measure now retains its transaction Codec binding. Rebuilt session86380 completed exit0;
       native410/410, focused178/178 and static76975 pass. Full Node session87190 is running,
       log /tmp/glyph-ropes-rebase-all-node.log. Combined Labs/browser/size remain unverified.
4. [ ] Pass full native/Node/seeded fuzz and relevant static/browser controls before benchmarking a frozen artifact.
5. [ ] Measure edit/read without publication, edit/read with publication, bulk setters and trailing-span workloads against
       frozen current-main package0205a45f. One heavy benchmark lane; record absolute deltas and correctness failures.
6. [ ] Attribute remaining cost, implement one bounded shared-path improvement at a time, retire replaced code, and verify
       cumulative production additions/deletions plus raw/gzip Wasm and runtime delivery sizes.
7. [ ] Review exact integrated code; update draft PR through gh stack submit --auto only after local gates.
       No merge authorization implied by the development restart.

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
[retained-text-assignment](retained-text-assignment.md). The following original requirements remain unchanged:

1. [x] Draft retained gather ranges, SET dirt, count-changing suffix splices, pending owners/transforms and batch-key
       enumeration share existing owners/executors; cold/seeded/recordless/abort controls verified.
2. [x] Draft retires Three key copies/root revision walks, reuses retained styles/unchanged geometry and retains empty
       adapters until teardown. Preserve indexed/direct late-sibling and synchronous-read controls.
3. [x] Draft one inspection owner handles sparse/dense promotion, owned copies and outline lifetime.
4. [x] Draft private package-minted IDs retire redundant JS checks while retaining public Codec/ID/Rust ownership checks.
5. [ ] Close combined bulk/publication elapsed regression; work counters alone do not prove a win. Rollback redesign held.
6. [x] Draft queued-root preflight shares engine registration Set; retain hierarchy checks/preparation. Scheduler held.
7. [ ] Integrate exact draw map/reduce into existing instance rope/reducer; preserve reorder, finite/extrema/signed-zero,
       order/u16/abort semantics. No alternate executor or enlarged unrelated records.
8. [ ] Clear combined maintainability, retirement and exact binary-size gates; draft archive2363562e…/shaper5ac05e74…
       is 1,591,326 raw/591,725 gzip9. 399 native/990 Node and final mutation fuzz pass; combined Labs intentionally stopped.
9. [ ] Clear exact combined-head package/hardware/CI review and landing only when the human releases the draft hold.
10. [ ] Update release readiness and roadmap after accepted gates; #247 stays open and #240 excluded. No release publication.
