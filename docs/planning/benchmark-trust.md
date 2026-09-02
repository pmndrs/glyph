---
type: Test Plan
title: Benchmarks we can trust
description: Moves core-API performance measurement onto pmndrs/labs, defines the statistical test that separates a real change from drift, and fixes the baseline, CI gate, and retirement plan for the benchmarks being replaced.
documentation_type: explanation
tags: [benchmarks, performance, statistics, regression, ci]
status: draft
sources:
  - id: labs
    resource: 'https://github.com/pmndrs/labs/tree/0d7785f'
    title: 'pmndrs/labs at the reviewed revision'
  - id: labs-npm
    resource: 'https://www.npmjs.com/package/@pmndrs/labs/v/0.8.0'
    title: '@pmndrs/labs 0.8.0'
  - id: labs-stats
    resource: 'https://github.com/pmndrs/labs/blob/main/src/stats.ts'
    title: 'labs statistical classifier'
  - id: labs-compare
    resource: 'https://github.com/pmndrs/labs/blob/main/src/compare.ts'
    title: 'labs comparison gating'
  - id: api-surface-audit
    resource: api-surface-audit.md
    title: 'Public API surface audit and cleanup plan'
  - id: benchmark-plan
    resource: benchmark-plan.md
    title: 'Benchmark plan'
  - id: decision-register
    resource: decision-register.md
    title: 'Decision register'
  - id: rust-layout-benchmark
    resource: '../../packages/glyph/scripts/benchmark-rust-layout-engine.mjs'
    title: 'Workflow glyph:rust-layout-benchmark'
  - id: layout-benchmark
    resource: '../../packages/glyph/scripts/benchmark-paragraph-layout.mts'
    title: 'Workflow glyph:layout-benchmark'
  - id: harness-runner
    resource: '../../apps/benchmarks/src/benchmark/runner.ts'
    title: 'Interactive and headless benchmark runner'
  - id: harness-statistics
    resource: '../../apps/benchmarks/src/benchmark/statistics.ts'
    title: 'Benchmark harness statistics'
  - id: fixture-contracts
    resource: '../../apps/benchmarks/src/benchmark/fixture-contracts.test.ts'
    title: 'Checked-in result fixture contracts'
  - id: package-size-report
    resource: '../../apps/benchmarks/src/benchmark/package-size-report.ts'
    title: 'Package size same-host and foreign-host gates'
  - id: ci
    resource: '../../.github/workflows/ci.yml'
    title: 'Repository CI workflow'
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-23T00:00:00Z'
---

# Benchmarks we can trust

Status: draft; supersedes nothing until the retirement table below is executed
Purpose: make a performance number in this repository mean "this change did that", and make the absence of a number mean "we could not tell".

This plan is the deliverable named by the [API surface audit](api-surface-audit.md#final-phase-benchmarks-we-can-trust). It owns the **core API measurement lane in Node**. The [benchmark plan](benchmark-plan.md) keeps ownership of the browser lab, conformance, GPU timing, and payload; nothing here replaces it, and the reasons are in [What this cannot tell us](#what-this-cannot-tell-us).

## The diagnosis

The complaint is drift, and drift has a specific cause here. Every timing number in the repository is a **median of correlated samples from one process**.

[`glyph:rust-layout-benchmark`](../../packages/glyph/scripts/benchmark-rust-layout-engine.mjs) defaults to `--warmup 8 --reps 31`: thirty-one repetitions inside a single Node process, sorted into a median, p95, and a relative standard deviation. Those thirty-one samples share one JIT state, one heap layout, and one GC history. Their spread measures how much the _loop_ varies once warm. It does not measure how much the _number_ varies when you run the command again — which is the only variance a reader actually cares about, because that is the variance a code change has to beat.

So `rsdPercent` reads low, the median looks precise to four decimals, and the number still moves between runs. The statistic is answering a different question than the one being asked of it.

The rest of the surface is weaker still:

| Path                                                                | Samples                   | Dispersion reported        | Gate                                                |
| ------------------------------------------------------------------- | ------------------------- | -------------------------- | --------------------------------------------------- |
| [`runner.ts`](../../apps/benchmarks/src/benchmark/runner.ts) via CI | 3, warmup 1               | median, p95                | none                                                |
| `runtime-fallback-parity`, `source-outline-fidelity` probes         | 1, warmup 0               | none possible              | none                                                |
| `benchmark:presentation-performance`                                | 1.5 s rAF window per cell | p95, max, slow-frame count | none — the 20 ms counter is printed, never asserted |
| `glyph:layout-benchmark`                                            | 31, warmup 8              | median, p95, RSD           | none                                                |
| `glyph:kernel-lab*`                                                 | 101, warmup 40            | median                     | none                                                |

Three facts follow, and all three are load-bearing:

1. **No timing threshold is asserted anywhere.** No probe, scenario, or test fails on a duration.
2. **No performance workflow runs in CI.** [`ci.yml`](../../.github/workflows/ci.yml) runs static checks, the package-size lane, and the conformance suite. Every performance number in this repository was produced by a human running a command locally.
3. **The one test that looks like a regression gate is not one.** [`fixture-contracts.test.ts`](../../apps/benchmarks/src/benchmark/fixture-contracts.test.ts) asserts `rustReport.medianMs < baselineReport.medianMs` between two _checked-in JSON files_. It measures nothing at test time and passes forever regardless of the current code.

[`statistics.ts`](../../apps/benchmarks/src/benchmark/statistics.ts) is fourteen lines exporting `median` and `percentile`. There is no code in this repository that answers "is this difference real?"

The infrastructure is not the problem. The ring-buffer telemetry, the GPU timestamp queries, the User Timing phase spans, the 101-sample kernel cadence, and the invalidation-class separation in the layout scripts are all sound and mostly stay. What is missing is the inferential layer on top and the CI wiring that makes it bite.

## What pmndrs/labs provides

[pmndrs/labs](https://github.com/pmndrs/labs) is a Node benchmark runner whose stated purpose is exactly this problem. Every claim below was verified against the source at revision `0d7785f` and against a working install of `@pmndrs/labs@0.8.0`, not taken from its README.

### The mechanism that fixes drift

Labs makes the **fresh-process block median** the experimental unit, not the sample.

```
one saved run, blocks: 8 (default)

  block 1   fresh V8  ──► inner samples ──► median₁ ┐
  block 2   fresh V8  ──► inner samples ──► median₂ │
    …                                               ├─► 8 independent units
  block 8   fresh V8  ──► inner samples ──► median₈ ┘

  blocks are interleaved across benchmarks: A₁ B₁ C₁ → A₂ B₂ C₂ → …
  so a thermal ramp or a clock boost spans every benchmark equally
```

Each block is a separate process spawned as `execFileSync(process.execPath, ['--import', tsx, ...nodeFlags, worker])`. The between-block spread therefore captures JIT nondeterminism, heap-layout luck, and environment drift — precisely the variance that thirty-one in-process repetitions hide. The pilot block chooses a measurement plan (batching, sample count) within its share of the budget and every later block replays it verbatim, so all blocks do identical work.

Inner samples are still collected and still useful for distribution shape and p99, but they do not vote on the verdict.

### The rest of the guarantees

| Guarantee                       | Mechanism                                                                                                                                          | Verified                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bench isolation                 | each bench runs in its own worker process; reordering cannot skew results                                                                          | `isolate: true` default                                            |
| GC control                      | each sample starts from a GC reset; per-sample GC time and heap bytes reported separately                                                          | `--expose-gc` in default `nodeFlags`                               |
| Timing-overhead control         | measurements too fast to time directly are batched automatically                                                                                   | `plan.batch`, observed `batch_samples: 4096, batch_unroll: 4`      |
| Dead-code-elimination detection | samples matching an empty call are flagged; returning a value from the measured function defeats it                                                | reported in the run summary                                        |
| Adaptive stopping               | Welford update in log space to a 2.5 % relative standard-error target, floor `minSamples: 20` and `minCpuTime: 0.642 s`, bailout `maxCpuTime: 5 s` | `config.ts`                                                        |
| Machine-stability detection     | CPU clock probed before and after each file and before each block; drift > 5 % warns                                                               | run summary reported `Stable clock: readings ranged 2.77–2.84 GHz` |

### What a benchmark looks like

Setup precedes `yield`, the yielded function is measured, teardown follows. Async setup works, which matters because Wasm instantiation and font loading are async:

```ts
import { bench, group } from '@pmndrs/labs';

group('paragraph @core', () => {
  bench('measure, metrics only @measure', async function* () {
    const session = await coldSession({ glyphs: 22_000 }); // untimed
    yield () => {
      const m = session.paragraph.measure();
      return m.contentWidth; // consumed: defeats DCE
    };
  });
});
```

`@tags` in the name filter runs. Verified: the async generator body executes before the timed region and its cost is excluded.

## How a run establishes that a difference is real

### The test

Two gates, both of which must pass before labs reports faster or slower ([`stats.ts`](https://github.com/pmndrs/labs/blob/main/src/stats.ts) `classify`):

1. **Statistical significance** — two-sided Mann-Whitney U on the block medians, `p ≤ alpha`, **alpha = 0.05**. At or below 50 combined blocks this is the exact conditional permutation distribution over doubled integer ranks, so tied medians are handled exactly rather than approximated. Above 50 it falls back to a continuity- and tie-corrected normal approximation.
2. **Practical magnitude** — `|Hodges-Lehmann relative effect| ≥ minDelta`, **minDelta = 0.05**. The estimator is the median of all pairwise `candidate / baseline` block-median ratios, minus one.

A rank test is the right family here. Timing distributions are right-skewed and GC-contaminated; a t-test on the mean would be dominated by the tail. Cliff's delta is computed for context but deliberately not gated, because on block medians it is a monotone transform of the same U statistic already behind the p-value.

Two further protections apply automatically:

- **Hardware match is a hard gate.** CPU model, architecture, and runtime must be identical or the entire comparison is refused. This is the single most important constraint on the CI design below.
- **Clock cross-check.** When the two runs' median block clocks differ by more than 2 %, the same block medians are re-judged in estimated CPU cycles. If the time verdict and the cycle verdict disagree, the bench is skipped as clock-confounded rather than reported.

### Sample size, and what it buys

Blocks are the sample. With the default `blocks: 8` per side:

| Blocks per side | Smallest attainable two-sided exact p | Eligible at α = 0.05   |
| --------------: | ------------------------------------: | :--------------------- |
|               2 |                                 0.333 | no                     |
|               3 |                                 0.100 | no                     |
|               4 |                                0.0286 | yes — the floor        |
|               6 |                               0.00216 | yes                    |
|           **8** |                          **0.000155** | **yes, with headroom** |
|              16 |                           3.33 × 10⁻⁹ | yes                    |

Labs enforces this: a comparison whose block counts cannot reach the configured alpha is skipped with a reason rather than reported.

Significance is necessary but not sufficient — the run also has to be able to _resolve_ a 5 % effect. Labs summarizes each run's block medians as a robust relative spread, `1.4826 × MAD / median`, and converts it to an approximate minimum detectable effect:

```
MDE ≈ 2.8 × spread × √(2 / blocks)          at blocks = 8:  MDE ≈ 1.40 × spread
```

So **the 5 % threshold is resolvable only while between-block spread stays at or under about 3.6 %.**

| Blocks per side | MDE as a multiple of spread | Spread budget to resolve 5 % |
| --------------: | --------------------------: | ---------------------------: |
|               4 |                      1.98 × |                        2.5 % |
|           **8** |                  **1.40 ×** |                    **3.6 %** |
|              12 |                      1.14 × |                        4.4 % |
|              16 |                      0.99 × |                        5.1 % |
|              24 |                      0.81 × |                        6.2 % |

This is the knob for a noisy machine: hold the threshold and add blocks. A bench whose resolution is coarser than `minDelta` is annotated `⚠ ~±N%` and still judged, not hidden — a neutral verdict there means "could not establish a change at this scale", which is different from "no change" and must be read that way.

### It was verified, not assumed

On an Apple M2 Pro, one bench, 8 blocks per side. The baseline and the two candidates ran the same file; only an environment variable scaled the work.

| Comparison                  | Between-block spread | Reported resolution |    Δp50 |    Δp99 |     p | Verdict                      |
| --------------------------- | -------------------: | ------------------: | ------: | ------: | ----: | :--------------------------- |
| identical code vs. baseline |        2.1 % / 3.2 % |   ~±3.0 % / ~±4.5 % |  +1.5 % | +38.3 % |  .279 | **neutral**                  |
| +12 % injected work         |                    — |                   — | +15.9 % | +24.1 % | <.001 | **slower**, CI +12.7…+20.1 % |

The first row is the property the team is asking for. The candidate's median was 1.5 % higher and its p99 was 38 % higher, and the tool still declined to call it a change — which is correct, because the code was identical. Today's harness has no mechanism that could reach that conclusion; it would have reported the +1.5 % median move as data.

The measured spread also confirms the planning formula: 1.40 × 2.1 % = 2.9 % against a reported ~±3.0 %, and 1.40 × 3.2 % = 4.5 % against a reported ~±4.5 %.

### Chosen parameters

| Parameter    | Value                   | Reason                                                                               |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------ |
| `blocks`     | 8 locally, **16 in CI** | shared runners are noisier; buying resolution with blocks keeps the threshold honest |
| `alpha`      | 0.05                    | labs default; exact test makes it attainable from 4 blocks                           |
| `minDelta`   | 0.05                    | below the 3.6 % spread typical of a quiet machine there is no point claiming finer   |
| `adaptive`   | `true` (2.5 % target)   | default                                                                              |
| `maxCpuTime` | 5 s                     | default; divided across blocks                                                       |
| `isolate`    | `true`                  | required — block sampling is disabled without it                                     |

## What is measured

Scope is the core API in Node against `@pmndrs/glyph/core` and the packaged release Wasm. The eight paths map almost one-to-one onto modules under `packages/glyph/src/core/`, which is a good sign that the taxonomy is real rather than invented for this document.

Every measurement bench binds to **root `Paragraph`, not `Text` from `/three`**. It is the stable framework-neutral surface, it needs no scene graph, and its two-query split -- `measure()` for sizes, `glyphs()` for the positioned columns -- is exactly the boundary these benches price. Font-loading benches use root `loadFont()`; renderer integration benches then create `/core` `GlyphEngine`, `GlyphBackend`, and `RenderPlanner` values and bind that immutable font. This prices the real ownership seam rather than a raw shaper shortcut.

All eight paths run in plain Node against the packaged Wasm with no browser, canvas, or GPU. That is established, not assumed: `glyph:rust-layout-benchmark` drives the raw ABI in Node today, and `glyph:layout-benchmark` drives the full path including render-plan application in Node. The one Node-specific wrinkle is that the shaper defaults to `fetch`-ing its Wasm relative to the module URL, so the benches pass the Wasm path explicitly, as the existing fixture helper already does.

Every bench states its unit of work. The fixture is the existing `paragraphTextForGlyphs` corpus at a pinned glyph count so the numbers stay comparable to the records being replaced, and the invalidation classes are kept apart rather than averaged — a principle already established in [`glyph:layout-benchmark`](../../packages/glyph/scripts/benchmark-paragraph-layout.mts) and worth preserving verbatim: they invalidate different caches, so averaging them hides whichever one is slow.

| #   | Path                          | Entry point                                                                                                               | Unit of work                                                                                                                        | Counts as a regression                                                                                                                       |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shaping                       | retained planner text mutation and the Rust planner update                                                                | one full reshape of the pinned paragraph, per script class (Latin, Arabic, Devanagari, CJK)                                         | +5 % on any script class; a Latin-only win that costs a complex script is a regression, not a trade                                          |
| 2   | Line breaking                 | greedy fitting in `engine/line_composition.rs`, over break bits set during `prepare_unicode` / `prepare_clusters`         | one re-break at a new column width, shaping retained — Latin and CJK as separate benches                                            | +5 % on either corpus; also any change in break count for the fixture, which is a correctness failure not a slowdown                         |
| 3   | Layout and positioning        | planner style/geometry transaction                                                                                        | one reposition of retained clusters: `font-size` (metrics rebuild) and `column-resize` (reflow only) as separate benches            | +5 % on either class                                                                                                                         |
| 4a  | Measurement, metrics only     | `Paragraph.measure()`, `readPlannerMeasurements`                                                                          | one `measure()` reading sizes, baselines, ascent/descent and intrinsic widths, touching **no** positioned column                    | +5 %, **or any nonzero column materialization** — see below                                                                                  |
| 4b  | Measurement, materialized     | `Paragraph.glyphs()`                                                                                                      | one `glyphs()` call copying the positioned columns out of Wasm at a fresh constraint                                                | +5 %                                                                                                                                         |
| 5   | Frame wire compile            | `compilePlannerFrameUpdate(frame): Uint8Array`                                                                            | one encode of a complete frame update to its wire bytes                                                                             | +5 %, or any growth in emitted byte length for a fixed frame                                                                                 |
| 6   | Command-buffer projection     | internal `RenderPlanView` framing plus the canonical typed `CommandBufferView`, consumed by the GPU-free example renderer | one full traversal of a published command buffer for the pinned paragraph                                                           | +5 %, or any growth in patch count or write bytes for an unchanged frame                                                                     |
| 7   | Publication ownership handoff | borrowed target decode versus the async target's one owned transfer copy                                                  | `no-op` (unchanged frame), `suffix-edit`, `localized-edit`, `localized-splice`, plus copy priced against borrow-and-decode-in-place | +5 % on any class; **`no-op` is special — see below**                                                                                        |
| 8   | Font binding                  | portable `compileFont`, backend binding compilation, and engine-local shaping registration                                | one bind of a validated artifact: the JS table compile and the Wasm registration as separate benches                                | +5 %; the JS compile is `glyphCount × strikeCount` scalar writes, so a large-coverage CJK font with several strikes is the case that matters |

Four of these are not merely being re-implemented — **they are unmeasured today at any level**, and finding that out is part of what this exercise bought:

- **4b, materialized measurement.** No existing benchmark requests the layout-inspection semantic view. `glyph:rust-layout-benchmark`'s `measure-query` case runs at the measurement mask only, so the metrics-versus-materialization split that commit `ffe65e11` created has never been measured.
- **5, the frame wire compile.** It is pure, synchronous, and touches no Wasm, so it is trivially isolatable — and it has only ever been timed inside a window that also contained a Wasm call.
- **7, the cost of `copyPublication()`.** Nothing prices the contiguous copy against borrowing and decoding in place, and nothing varies acknowledgement lag.
- **2 on CJK.** Line breaking is only swept per corpus by the Rust script; the break-heavy CJK path is where a quadratic scan once hid, and it deserves a standing bench.

### Three hazards that would make these benches lie

These are the reasons a benchmark of this API can report a confident number that means nothing. Each has to be designed against, not discovered later.

**Two cache layers sit between the bench and the engine.** `Paragraph` memoizes measurements and inspections in `Map`s keyed by the constraint, and returns the _identical object_ for a repeated equal constraint without touching Wasm at all. Behind that, Rust keeps one speculative transaction that survives a _different_ constraint and dies on a text or style change. Labs calls the yielded function thousands of times, so a bench written as `p.measure(sameConstraints)` or `p.glyphs(sameConstraints)` measures a `Map` lookup after its first iteration and will report picosecond-class timings with excellent stability. Every measure and glyphs bench must therefore invalidate deliberately — the existing [`glyph:layout-benchmark`](../../packages/glyph/scripts/benchmark-paragraph-layout.mts) already does this correctly by using a constraint value no earlier repetition used, and that discipline carries over. Where invalidation is not possible without also measuring `update()`, the bench measures the pair and says so in its name.

**The positioned columns are expensive to even hold.** The inspection `glyphs()` returns carries twenty-one positioned properties — `inkBounds`, `x`, `y`, `glyphIds`, `clusters`, the per-line arrays. Any spread, `Object.keys`, `JSON.stringify`, deep-equal, or console log of one copies all of them. Since labs requires the measured function to return a value to defeat dead-code elimination, the returned sink must be a single eager scalar such as `m.contentWidth`, never the query result object itself. A bench that returns the object measures the opposite of what its name claims.

**4a is a shape assertion, not only a timing one.** The reason two calls exist is that a flexbox host probing many widths for sizes alone never pays to copy arrays it does not touch: `measure()` takes the paragraph-scoped synchronous query, and only `glyphs()` asks the engine for per-glyph records. The benchmark protecting that must assert the _absence_ of positioned work, not merely that the call is fast: a regression here would appear as a modest constant factor that a 5 % threshold could plausibly miss on one paragraph, while being catastrophic for a host probing a hundred candidate widths. Assert `layoutRevision` is unchanged after a metrics-only `measure()` and fail on any advance. Reading `layoutRevision` is itself safe — it does not materialize.

Two further absolutes, because a ratio test cannot express them:

- **7's `no-op` case.** [D-198](decision-register.md) records the unchanged-frame path at 0.001 ms median. A relative test on a number that small is dominated by timer resolution, so the guard is an absolute ceiling. Any move into the microseconds means invalidation started scanning.
- **Acknowledgement lag is a cost axis, not a constant.** `StableSlotPool` quarantines freed slots until the host acknowledges past their publication generation, so a host that acknowledges every frame reuses slots and one that lags forces fresh allocation. The retention benches fix acknowledgement lag explicitly and report `patchCount` and buffer counts beside the time; a change in allocation behaviour shows up there before it shows up in milliseconds.

Where a bench protects a structural property rather than a duration — emitted byte length, patch count, break count, `layoutRevision` — that property is asserted **inside the benchmark's teardown as an exact equality**, and is not routed through the statistical gate at all. Exact facts do not need a p-value, and giving them one only adds a way for them to be missed.

## The baseline

### The constraint that decides everything

Labs refuses to compare across hardware. CPU model, architecture, and runtime must match exactly or the comparison is denied outright. A saved result is therefore **only meaningful against another result from the same machine**, and a baseline committed from a maintainer's M4 Pro is worthless to a Linux CI runner and vice versa.

This kills the obvious design — commit a blessed baseline JSON, compare every run against it — and it kills it for a good reason rather than an inconvenient one. It is the same lesson the package-size lane already learned the hard way: [`package-size-report.ts`](../../apps/benchmarks/src/benchmark/package-size-report.ts) does exact identity comparison on the recording host and budget ceilings everywhere else, because the Linux toolchain emits equal-length but byte-different Wasm.

### Two baselines, for two different jobs

|                 | CI gate                                                            | Reviewed record                                                                    |
| --------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **What**        | the merge-base commit, measured in the same job on the same runner | the numbers quoted in `docs/` and the decision register                            |
| **Where**       | nowhere — built and discarded within the job                       | `apps/benchmarks/fixtures/results/`, and the decision-register entry that cites it |
| **Compared by** | the two-gate classifier over both runs' block medians              | human review                                                                       |
| **Updated**     | never; it is recomputed every run                                  | by the rules below                                                                 |
| **Storage**     | `.labs/` is gitignored                                             | committed, one record per subject, named `<subject>-<sha>-<platform>-<arch>.json`  |

Local development uses a third, ephemeral baseline: `.labs/baseline` is a pointer file naming one result in `.labs/results/`, managed by `bench --baseline` and `bench compare`. It is a working tool, gitignored, and never authoritative.

### Not laundering a regression into the record

The failure mode is specific and worth naming: **re-run until the number you want appears, then commit that one.** Each p-value applies to one benchmark and labs does not adjust alpha across a suite, so repeated runs of a 14-bench suite at α = 0.05 will eventually produce a spurious verdict somewhere by construction. Four rules, in order of how easy they are to break:

1. **A reviewed record may only be replaced by a result that compared `neutral` or `faster` against the record it replaces**, on the same machine, in one comparison. A `slower` verdict cannot become the new record by being committed.
2. **An accepted regression requires a decision-register entry naming the cost and the reason it is worth paying.** The repository already does this well — D-195 accepts a +2,357-byte Brotli regression to avoid a second correctness implementation, and says so. A performance regression gets the same treatment: the number, the verdict, and the trade.
3. **Re-running to change a verdict is prohibited.** If a result is disputed, the response is more blocks, not another roll. Raising `blocks` is a legitimate, pre-declared response to insufficient resolution; re-running the same configuration until the sign flips is not.
4. **Every committed record carries its block medians, its labs configuration, and the hardware block.** A record without the raw units cannot be re-judged later and is not evidence. This also lets `minDelta` be revisited after the fact, because resolution is derived from the stored medians rather than frozen at save time.

Records are pruned when superseded. The current `fixtures/results/` directory holds `rust-layout-bitmap-*` at three different commits with no manifest saying which is current; that ambiguity is itself a way for a regression to hide.

## CI

### The design

Do not store a baseline. **Measure both sides in the same job on the same runner.**

```
job: performance (pull_request only)
  ├─ checkout merge-base ──► build ──► bench --blocks 16 -n base
  ├─ checkout head       ──► build ──► bench --blocks 16 -n head
  └─ gate: classify(base.blocks.medians, head.blocks.medians) per bench
```

This is not a novel idea in this repository — it is exactly what the existing `size` job does via `andresz1/size-limit-action`, which checks out both revisions and reports a diff against the base branch. Extending the pattern from bytes to time is the smallest coherent change.

It also disposes of the hard problem rather than mitigating it. The hardware-match gate is satisfied by construction. Runner-to-runner variation — the dominant noise source on shared infrastructure, and the one that no amount of sampling can remove — cancels, because both numbers come from the same machine within minutes of each other. What remains is within-machine drift, which is what block interleaving and the clock cross-check are built for.

The residual risks are real and bounded: the two builds are sequential, so a thermal ramp across the job biases the second half. Interleaving blocks _between_ the two checkouts would remove that too, but it requires both builds resident simultaneously and is deferred until the simple version proves insufficient.

### Cost

Measured on an M2 Pro with a 300 ms setup per bench, 8 blocks:

| Shape                               | Wall clock |
| ----------------------------------- | ---------: |
| 1 bench, single block (`bench run`) |     10.8 s |
| 1 bench, 8 blocks (saved)           |     18.3 s |
| 4 benches, 8 blocks (saved)         |     44.9 s |

That is roughly **7 s fixed plus 11 s per bench** at 8 blocks. The ~14 benches above cost about 2.7 minutes per side at 8 blocks, so a two-sided CI run at 16 blocks lands near 10–11 minutes plus two builds. It belongs in its own job, not bolted onto the 30-minute `check` job.

### The failure condition

**A bench fails when its verdict is `slower`: p ≤ 0.05 on the exact Mann-Whitney U over block medians _and_ Hodges-Lehmann relative effect ≥ +5 %.** Neutral passes. Faster passes. A bench skipped as clock-confounded or for insufficient block replication passes, and is reported as skipped — an unmeasurable bench must not be silently green, but it also must not fail a pull request for a property of the runner.

The exact-equality assertions carried in bench teardown — wire byte length, patch count, break count, `layoutRevision` — fail independently and unconditionally. They are not subject to any threshold.

One implementation fact must be planned around: **`labs compare` always exits 0.** This was verified directly; both a `slower` and a `neutral` comparison returned exit status 0, and the published package exports only `bench`, `group`, `defineConfig`, and `getBenchRegistry` — the classifier and the store are not part of the public API. The gate is therefore a small repository-owned workflow that reads `blocks.medians` out of each saved result JSON and applies the two-gate rule. The saved schema supports this directly; a verified 8-block run stores its medians at `files[*].benchmarks[*].runs[*].stats.blocks.medians`. Upstreaming a `--json` output mode and a nonzero exit is the better long-term fix and is worth opening against pmndrs/labs, but this plan does not depend on it.

### Version pinning

`@pmndrs/labs` is at **0.8.0, published the same week this plan was written, pre-1.0, with eight releases to date.** The comparison semantics are still moving — effect-size gating on Cliff's delta was already removed in an earlier revision. Pin the exact version, treat a labs upgrade as a change that invalidates stored records, and re-establish records after upgrading rather than comparing across versions.

## What is replaced, kept, and deleted

### Replaced by labs benches

| Today                         | Why it moves                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glyph:rust-layout-benchmark` | 31 in-process reps → block medians; its eight invalidation cases map directly onto benches 1–7                                                                                                                                                                                    |
| `glyph:layout-benchmark`      | same, for the public path; its invalidation-class separation is preserved. Its `/three` call site has already been re-pointed at the settled `Text.measure()`/`Text.glyphs()` split, and rewriting it onto `Paragraph` and labs together is still cheaper than repairing it twice |
| `glyph:kernel-lab` (Node)     | 101 in-process samples with no significance test; scalar/auto/explicit SIMD variants become three benches compared pairwise                                                                                                                                                       |

The fixture and corpus helpers (`paragraphTextForGlyphs`, `paragraph-benchmark-fixture.mts`) are reused unchanged. The workflows are retired only once their replacements produce records; the scripts are not deleted on the same commit that adds the benches.

### Kept unchanged

| Kept                                                                                                   | Why                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The package-size lane in full                                                                          | genuinely deterministic — no timer, fixed compression levels, SHA-256 identity, production defines — and already gated on-host by identity and off-host by budget. It is the one thing in the repository that already works, and labs has nothing to offer it. |
| `benchmark:presentation-performance`, `benchmark:paragraph-stress-timing`, `probe:live-update-latency` | GPU, vsync, and frame pacing. Labs is Node-only; these cannot move and must not be deleted for failing to be statistical.                                                                                                                                      |
| `glyph:kernel-lab-browser`                                                                             | measures Wasm SIMD under the browser's engine, which the Node sibling cannot substitute for                                                                                                                                                                    |
| Every conformance probe and scenario                                                                   | they assert correctness — hashes, pixel envelopes, exact byte equality — and are unaffected                                                                                                                                                                    |
| The interactive lab                                                                                    | it is a human control plane, not a regression gate                                                                                                                                                                                                             |

The kept browser probes should stop being called benchmarks in prose. They are observations. Naming them accurately is most of the fix for people trusting them too much.

### Deleted

| Deleted                                                                                | Why                                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fixture-contracts.test.ts` lines 104–148, the `comparableCases` block                 | compares two frozen JSON files to each other and passes forever; it is worse than no gate because it looks like one |
| The pinned float medians in the same file (`medianMs: 58.32441699999981` and siblings) | full float equality on wall-clock medians, only possible because the file is static                                 |
| `fixtures/results/bake-host-baseline-v0.json`                                          | three samples, `performance.now()` clamped to 0.1 ms, and zero consumers anywhere in the repository                 |
| Superseded `rust-layout-*` records at stale commits                                    | keep one current record per subject; the rest are noise that makes "which is the baseline" unanswerable             |

Two cleanups are adjacent and cheap. There are **four independent percentile implementations** — three ceiling-based, one floor-based returning `NaN` on empty — so p95 in a sweep record and p95 in a runner summary are not computed by the same rule and are not comparable. And [`runner.ts`](../../apps/benchmarks/src/benchmark/runner.ts) passes a hard-coded sample index `0` to every warmup iteration while the measured loop passes the real index, so a target whose work varies by index is warmed on a different path than it is measured on. Neither blocks this plan; both should be fixed while the surface is being touched.

## What this cannot tell us

Stated plainly, because a benchmark suite that is trusted beyond its evidence is worse than one nobody trusts.

- **Nothing about the GPU.** Labs runs in Node. Frame time, submit time, GPU timestamps, shader compilation, vsync, and frame pacing are outside it entirely. The browser lab keeps that job and keeps its weaknesses — notably that `benchmark:presentation-performance` is vsync-bound at ~120 FPS, so rAF FPS has no headroom to show an improvement and can only detect a regression past the refresh floor.
- **Nothing about the browser's engine.** These benches measure Wasm and JavaScript under Node's V8 with `--allow-natives-syntax --expose-gc`. Chrome's V8 differs in flags and tier-up behavior, Safari and Firefox differ more, and a Node-measured win is not automatically a browser win.
- **Nothing about Rust as native code.** There are no criterion benches and no `benches/` directory in any of the twelve crates. All Rust performance is measured indirectly through the Wasm boundary from JavaScript. A Rust-level regression that Wasm compilation happens to mask is invisible here, and so is per-function granularity.
- **Nothing about absolute cost on a user's machine.** A verdict is a relative claim about two runs on one machine. The absolute milliseconds are not portable, and a record from a maintainer's laptop does not describe a mid-range Android device.
- **Nothing about startup, memory, or allocation.** Setup is deliberately outside the timed region, so cold-start cost is not measured by these benches. Heap bytes per iteration are reported by labs but are descriptive only and are not significance-tested; a memory regression will not fail this gate.
- **Nothing suite-wide.** Each p-value applies to one benchmark, and alpha is not adjusted for multiplicity. With ~14 benches at α = 0.05, roughly one spurious verdict per twenty clean runs is expected. Read a single red bench as a prompt to investigate, not as proof.
- **Nothing causal.** A verdict says the two sets of block medians differ by more than 5 % and that the difference is unlikely under the null. It does not say the code change caused it — a dependency bump, a toolchain change, or an unmeasured machine state in the same commit range will read identically.
- **Neutral is not "no change".** Where between-block spread exceeds `minDelta`, labs annotates the row as limited-resolution and a neutral verdict means the run could not establish a change at that scale. Reporting must preserve that distinction rather than flattening it to a pass.

## Sequencing

1. Add `@pmndrs/labs` pinned, a `labs.config.ts`, and the bench directory under `packages/glyph`. Add the root workflow and its `pnpm scripts` metadata before running anything by hand.
2. Land benches 1–3 and 7 against the existing fixture; confirm between-block spread is under 3.6 % on a maintainer machine, and raise `blocks` for any bench that is not.
3. Land benches 4a/4b, 5, 6, and 8, including the exact-equality teardown assertions.
4. Build the CI gate over `blocks.medians` and run it non-blocking on pull requests for long enough to measure its false-positive rate on no-op changes. Do not make it required before that number is known.
5. Execute the retirement table; record the replacement in the decision register and amend D-160, which currently names `glyph:layout-benchmark` as the source of layout performance claims.
6. Re-pin the affected package concepts and run `docs:update` / `docs:check`.

Step 4 is not optional. A gate whose false-positive rate is unknown will be disabled by the first person it blocks unfairly, and the repository will be back where it started — with benchmarks nobody trusts.
