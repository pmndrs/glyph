---
type: Implementation Plan
title: Paragraph batching and TypeGPU integration recovery
description: Disposable execution plan for auditing merged PR 46, preserving the dependent PR stack, closing retained-layout correctness findings, and proving browser performance before PR 161 lands.
documentation_type: explanation
tags: [glyph, batching, typegpu, three, performance, benchmarks, recovery]
status: draft
sources:
  - id: typegpu-pr
    resource: https://github.com/pmndrs/glyph/pull/46
    title: TypeGPU core shaders pull request
  - id: batching-pr
    resource: https://github.com/pmndrs/glyph/pull/161
    title: Paragraph batching recovery pull request
  - id: base-pr
    resource: https://github.com/pmndrs/glyph/pull/160
    title: Paragraph-layout stack base pull request
  - id: width-performance
    resource: https://github.com/pmndrs/glyph/issues/154
    title: Paragraph width-update performance issue
  - id: rich-text-batching
    resource: https://github.com/pmndrs/glyph/issues/121
    title: Rich-text batching issue
  - id: language-resources
    resource: https://github.com/pmndrs/glyph/issues/163
    title: Optional language-resource issue
  - id: roadmap
    resource: ../roadmap/roadmap.md
    title: Canonical implementation roadmap
  - id: decisions
    resource: decision-register.md
    title: Decision register
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-08T04:51:21Z'
---

# Paragraph batching and TypeGPU integration recovery

This is temporary execution state for the branch culminating in PR #161. It exists because PR #46 landed before the
dependent batching stack, leaving a nontrivial integration, correctness, and performance recovery that must survive
context changes without being reconstructed from chat. It is not a new architecture source. The roadmap, decision
register, package concepts, and durable issue records remain authoritative.

Delete this file, remove its planning-index entry, and record the closure in the documentation log after every item is
implemented or closed with evidence. Promote only durable decisions and final measurements to the canonical concepts.

## Outcome and non-negotiable constraints

Land the complete dependent stack with PR #161 on top of PR #160 and the earlier linked PRs, rebased onto the main branch
that now contains PR #46. The result must:

- close the accepted scope of #154, #121, #115, and #113 without weakening browser behavior;
- keep Icon Grid at two draws, camera-ranked labels at one draw, Rich Text at five draws, Paragraph Stress at one draw,
  and every other established workload inside its existing one-to-three-draw envelope;
- preserve Rust-owned shaping, paragraph flow, positioning, paragraph permutation, and atomic publication;
- keep only camera-distance calculation in TypeScript; adapters and users must not sort paragraphs themselves;
- keep retained hot paths allocation-free after warmup, avoid enlarging glyph/kernel records or adding branches inside
  established SIMD loops, and measure any new indexing or scratch storage;
- retain the accepted no-compositing configuration and 64 UTF-16-unit spare paragraph default while allowing actual
  strings and glyph arenas to grow correctly;
- preserve TypeGPU as an optional dependency that is absent from default consumers and tree-shakes when its subpaths are
  unused;
- pass exact CPU/GPU live probes with flat-or-better results against an identical remote-main build;
- remain unmerged until the maintainer completes a manual benchmark-suite pass.

## Baseline, authorship, and stack preservation

PR #46 merged to `main` as merge commit `3de4a0b185e70c577a34465cce8ac9004582d728`. Its second parent is contributor
commit `6213efe6fc1b1af3f2a37f4ebda9d01b4c5f76e0`, so the contributor commit and authorship remain intact. Follow-up PRs
#164 and #165 corrected the integration boundary; the stack rebase base is `a82bfe5c4925a3d64c9c653f4ead4136b5ff07c`.

The dependent pull-request order is:

```text
#128 -> #130 -> #156 -> #139 -> #157 -> #160 -> #161
```

The stack is linked in gh-stack stack #159. PR #161's last known remote head before this recovery was `5171acc2`; local
recovery commits have not been pushed. Do not use `gh stack sync`, `rebase`, or `unstack` until the exact remote graph,
local commits, and intended new base have been captured. Never repair the stack by squashing or recreating contributor
commits.

Required sequence:

1. Confirm PR #46's exact merge and its `main` CI/release outcome.
2. Audit merged #46 on its own. Fix only a regression that is independently present on `main`; otherwise record the
   resolution needed when the batching stack is replayed.
3. Fetch the final green `main` commit.
4. Snapshot every PR head, parent, patch ID, author, and committer before rewriting anything.
5. Follow the repository gh-stack procedure to rebase the entire ordered stack, preserving each review boundary and
   commit authorship. Resolve conflicts once at the layer that owns them.
6. Verify the GitHub stack still displays #161 directly above #160 and all earlier links remain intact before pushing.
7. Apply any remaining recovery commits on the rebased #161 branch, then use gh-stack to publish without changing the
   PR topology.

## Already checkpointed recovery work

These local commits are coherent checkpoints and must be preserved through the rebase:

- `33abc926 fix(glyph): close retained transaction review` — paragraph-keyed Rust semantic input spans, render-active
  query reconciliation, rank-only allocation removal, tight explicit line-height correctness, and exact telemetry
  capture foundations.
- `3e51b3c7 fix(glyph): restore emergency word wrapping` — overlong words now emergency-break at a shaping-safe boundary
  in sparse-index, scalar integer, and reference fitting paths.
- `9ca9fcfd fix(benchmarks): stabilize scene transitions` — telemetry resets preserve prior graph snapshots and start the
  new epoch at slot zero; changing React callbacks no longer tear down the persistent renderer host.

Each commit had focused format, lint, type, Rust, or unit evidence when created. Rebase conflict resolution invalidates
only the affected evidence; rerun proportional gates rather than assuming either that all evidence remains valid or that
every unrelated long-running suite must be repeated after each small fix.

## PR #46 integration audit

### Required before or during the stack rebase

- [x] Confirm merged-main CI and release jobs are green; repair failures attributable to #46 directly on `main`.
- [x] Keep shader ownership split under `/shaders/tsl` and `/shaders/typegpu` without making one backend import the other.
- [x] Move the physical sources to `src/shaders/tsl/` and `src/shaders/typegpu/` so the package graph mirrors those
      public namespaces; do not retain ambiguous `/tsl`, generic `/shaders`, or `/three-typegpu` aliases.
- [x] Keep `/three` on the TSL path and provide `/three/typegpu` as the explicit Three-plus-TypeGPU bridge.
- [x] Keep `/typegpu` as the direct integration leaf for custom TypeGPU engines.
- [x] Prove default/root and `/three` consumers build with TypeGPU peer packages absent.
- [x] Prove `/typegpu` and `/three/typegpu` consumers build when their optional peers are installed.
- [x] Keep `@typegpu/gl` as the optional fallback-rendering peer for the Three-plus-TypeGPU integration, while proving
      default/root, `/three`, `/typegpu`, and `/shaders/typegpu` consumers do not require it unless `/three/typegpu` is
      selected.
- [x] Price `/three`, `/three/typegpu`, and `/typegpu` as the application-facing bundle boundaries; use package-resolution,
      graph-isolation, and tree-shaking tests for shader leaves instead of redundant per-technique size budgets.
- [x] Resolve the merged PR's restored root `compositing` option in favor of the accepted no-compositing contract.
- [x] Resolve its restored `textUnits: 256` default in favor of 64; retained text still grows from actual content.
- [ ] Re-run the batching draw-count matrix through both `/three` and `/three/typegpu` after conflict resolution.
- [x] Decide and document the Bitmap native-TSL versus TypeGPU pixel delta. Do not claim pixel parity unless exact image
      evidence proves it; pin an honest experimental threshold if the implementation intentionally remains non-identical.

### Explicitly not a blocker for this stack

Direct `/typegpu` currently proves Bitmap, MTSDF, and Slug but is narrower than the Three host: it lacks decorations,
rich/nested spans, fallback stacks, the Three material hierarchy, custom raster programs, reusable PropertyLists,
TextGroup behavior, authored pixel snapping, caret/selection helpers, and cross-Text batching. Preserve truthful capability
documentation and do not disguise the ordered-direct renderer as the future full implementation.

A full `glyphtype` WebGPU renderer, including the three raster techniques and TypeGPU-native batching/material behavior,
starts only after both PR #46 and this stack are merged to `main`. Do not scaffold it in this branch.

## Correctness and bounded-work fixes

Every item below came from a reproduced failure or a validated adversarial-review finding. Fix each in the smallest
owning layer and add the regression before broad verification.

- [x] Accept content-only semantic mutations for multiple existing paragraphs without dummy lifecycle upserts.
- [x] Accept semantic wire tables grouped in an order different from retained paragraph order while retaining atomic
      rejection of unknown or noncontiguous paragraph groups.
- [x] Preserve shaping-safe emergency wrapping for an overlong unbreakable word.
- [x] Preserve authored tight explicit line height, including negative half-leading.
- [x] Preserve exact trailing-space state across chunk-skipped word fitting, including negative spacing and hard breaks,
      without adding a lane, allocation, or SIMD-kernel branch.
- [x] Query or inspect one detached Text without rebinding unrelated detached siblings.
- [x] Reject duplicate final base paragraph orders at the typed boundary and preserve atomic order swaps.
- [x] Retain accepted outer property identities beside shared immutable snapshots so unchanged adapter updates are O(1),
      while a newly submitted style, layout, or constraint record observes nested caller changes.
- [x] Omit unchanged scoped-order rows from paragraph queries while retaining the complete speculative lifecycle.
- [x] Bound `measureParagraph` result-capacity retries while retaining asymmetric A/B capacity growth.
- [x] Replace or encapsulate the live `queryMembers` scratch-array return so re-entry cannot observe mutated membership.
- [x] Make exact telemetry capture admit CPU and completed GPU samples under one documented window rule.
- [x] Keep the benchmark renderer error callback stable at its sole application owner instead of mirroring props through
      an effect or teaching the host to retain callback state.
- [x] Prove negative-advance dense scripts cannot materialize one 12-byte sparse-word record per cluster or disable the
      intended chunk fast path. Measure memory and fitting throughput before selecting the density guard.
- [x] Pin the established per-workload draw-count envelopes in executable tests rather than prose alone.
- [x] Keep `baselineShift` internal and unexposed. Public tight line height permits a signed descent while ascent remains
      a nonnegative top-to-baseline distance; this stack does not invent public baseline-shift semantics.

## Retained-update and resize performance work

### Proven attribution

The long-paragraph Rust path is currently faster than exact remote main and exact PR #160 in direct A/B probes. At an
11,510-target width workload, changed-plan median was 1.704 ms versus 2.298 ms on main and 2.368 ms on #160; no-patch
median was 0.130 ms versus 0.154 ms on main. Both candidates retained a 62.75 MiB high-water mark. The 12-byte sparse
word index is built once after shaping, retained across geometry-only updates, and scanned sequentially. It is not the
source of the observed frame spikes.

The browser spikes exceed measured Rust work. Paragraph Stress retained update medians were about 0.56 ms on the
candidate versus 0.60–0.71 ms on main, while whole-frame p95 could reach 17–25 ms. Editorial similarly showed core
reflows around 0.82–1.05 ms while whole frames could reach roughly 27 ms. This points to adapter/application scheduling,
measurement reconciliation, and reactive UI work before deeper kernel changes.

No historical revision in the measured retained-resize ladder was about twice as fast as the recovered core. The
remembered twofold results were either an isolated chunk-summary microkernel whose production consumer was still pending,
or a compound Paragraph Stress comparison under the older React/Koota harness. Production retains four-block SIMD for
flags and cluster work plus the codec kernels; eight-block bidi was a lab-only variant and was about 1.9 times slower than
four-block at 100,602 items. On a fixed-active 22,000-target resize, rebuilt explicit SIMD was about 13% faster than the
same revision's rebuilt scalar artifact, and the current fixed-active SIMD median was about 26% faster than the older
August SIMD result. Every final comparison must still rebuild and hash its artifact because `dist/text_shaper.wasm` is a
last-build-wins output.

### Ordered optimization work

- [x] In Three measurement/inspection, call the existing `needsReconcile(texts)` predicate and reconcile only when it is
      true. Prove detached/reparent/rank/material cases still reconcile, while a cached width-query avoids Set allocation and
      member removal scans.
- [x] In Editorial layout, call `measure()` once per Text per reflow and reuse that result instead of six total calls.
- [x] Decouple Paragraph Stress's automated per-frame width/font motion from React/Koota control-tree rerenders. Update
      the scene imperatively and reflect controls at a lower cadence without changing the authored workload.
- [ ] Re-measure active Paragraph Stress and Editorial with the exact capture API before changing Rust again.
- [ ] Carry a sparse-word cursor across lines to remove repeated `partition_point` only if a profile shows material cost.
- [ ] Investigate retained line/glyph dirty ranges so width changes do not globally compare and republish unchanged
      positioned streams.
- [ ] Consider segmented positioned storage only after the simpler range proof. It must lower multi-megabyte A/B traffic
      without regressing gather locality, cold start, or constant-time frames.
- [ ] Benchmark SIMD for classified uniform LTR flow/positioning runs only after data is isolated into vector-friendly
      blocks. Keep scalar fallback and require a same-source win over LLVM auto-vectorization.
- [ ] Track initial shaping, warm updates, p95/max spikes, allocation count, Wasm high-water memory, request/publication
      bytes, browser transfer size, and cold package initialization together; a median-only improvement is insufficient.

Camera distance remains TypeScript-owned because it depends on host camera state. The adapter should publish paragraph
ranks and let Rust own atomic permutation. Benchmark whether replacing the current 544-entry JavaScript sort with direct
`renderOrder = -distanceSquared` updates is correct and faster; do not trade a proven stable permutation for an assumed
sort removal.

## Optional language resources and Intl.Segmenter

Issue #163 owns the future locale-resource design: optional dynamic language data can be imported into the same Rust
linear memory, with baseline Unicode behavior when no language is selected. The measured `Intl.Segmenter` experiment is
not a core replacement: Chromium's grapheme segmentation plus UTF-16 boundary encoding, one memory copy, and one Wasm
call measured 1.280 ms for 684 labels versus 0.920 ms for current full Rust Unicode analysis, before Rust still performs
UAX #14, script, bidi, shaping, and validation work. Linker isolation showed no reliable Brotli transfer win. Keep the
notes on #163; do not add an Intl adapter or second Wasm target in this branch without new contrary evidence.

## Verification and landing gates

Use repository-owned scripts and identical source/flags for A/B evidence. Record raw artifacts as well as summaries.

- [x] PR #46 correction main CI and release workflows are green at `a82bfe5c`.
- [ ] The full stack is visibly and correctly linked on GitHub after rebase, with #161 immediately above #160.
- [ ] Focused regressions for every correctness fix pass.
- [ ] Glyph Rust tests, Unicode conformance, rustfmt, Clippy `-D warnings`, TypeScript type tests, Oxfmt, and Oxlint pass.
- [ ] Package export/optional-peer/tree-shaking fixtures pass for root, `/three`, `/three/typegpu`, and `/typegpu`.
- [ ] The TypeGPU hello-world builds and its hardware live probe passes for Bitmap, MTSDF, and Slug.
- [ ] The same hardware live-probe matrix passes through stable `/three` and experimental `/three/typegpu`, including
      Bitmap, MTSDF, Slug, decorations, retained updates, custom materials, expected draw counts, and finite CPU/GPU timing.
- [ ] `pnpm docs:check` passes and every changed package concept has a current `source_digest`.
- [ ] Browser presentation matrix passes all 60 backend/technique/workload cells.
- [ ] All 24 live mutation probes reach a visible frame without renderer status errors.
- [ ] Automated draw pins hold: Icon Grid 2, camera-ranked labels 1, Paragraph Stress 1, Rich Text 5, and other workloads
      their established one-to-three envelopes.
- [ ] Fresh-scene A/B captures exactly 120 CPU and 120 finite completed-GPU samples per cell, rotates workload order, and
      compares at least seven runs against a freshly built remote `main` worktree.
- [ ] Paragraph Stress and Editorial active-resize median and tail CPU/GPU times are flat or better; idle/steady results
      do not substitute for active mutation evidence.
- [ ] Node and browser SIMD labs remain flat or better, with scalar/reference parity.
- [ ] Rebuild and hash the Wasm artifact for every A/B revision; compare explicit SIMD with a separately rebuilt scalar
      artifact on the same final revision before attributing any historical performance delta to vectorization.
- [ ] Replay the documented revision ladder under one identical exact-window capture overlay. Freeze workload semantics,
      use fresh renderers, rotate order for at least seven paired rounds, and split Paragraph Stress at the commit that moved
      authored reflow into the timed scene frame so incompatible telemetry windows are never presented as engine regressions.
- [ ] Package size, Wasm raw/gzip/Brotli size, cold initialization, allocator count, and linear-memory high-water checks
      show no unexplained regression.
- [ ] Dead/duplicate-code tooling is rerun in the changed scope; cleanup does not add abstraction or hot-path work solely
      to satisfy a metric.
- [ ] A final read-only Opus adversarial review is run through the repository review tooling; every reported claim is
      independently reproduced or rejected before changes are made.
- [ ] CI is green on the final pushed stack.
- [ ] The maintainer completes the benchmark application pass and explicitly approves merge.

## Cleanup condition

This plan is complete only when every checkbox is either satisfied or closed with durable counter-evidence, the
maintainer has approved the benchmark suite, PR #161 has landed, and no required work above remains hidden in chat.
Before deleting it:

1. move durable API/architecture decisions to the decision register;
2. move final implementation and performance evidence to the affected package concepts and roadmap;
3. ensure issue #154, #121, #115, and #113 disposition is accurate;
4. add a newest-first completion entry to the documentation log;
5. remove the planning-index link and this file in the same final documentation commit.
