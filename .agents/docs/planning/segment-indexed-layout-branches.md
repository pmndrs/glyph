---
type: Reference
title: 'Layout refactor branch map'
description: 'Which feature is on which branch and tag in the layout refactor.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-21T12:00:00Z'
---

# Layout refactor: branch map

Which feature is on which branch. Updated at every merge and every hand-back. Companion to the
[build log](segment-indexed-layout-build-log.md) and the [plan](segment-indexed-layout.md).

Rules: a lane branch is deleted (local, remote and its worktree) as soon as it is merged into the integration
branch and the merge is verified, tagged and pushed. A branch that is merged but still has a lane working on
it stays until that lane hands back. Lane branches on the remote are backups, not for review.

## Integration branch

`experiments/segment-indexed-layout` on `origin`, worktree `/Volumes/Depot/Developer/glyph-held-rope-wip`.
Based on `8176a24e0` (tip of `experiments/held-rope-ascii-anchor-wip`).

| Tag                 | Feature merged at this tag                                                                                                                                                                                                    | Came from (branch, now deleted unless noted)                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `sil-green-0`       | Correctness oracle (unit 0)                                                                                                                                                                                                   | built on the integration branch                                                        |
| `sil-green-1`       | HarfRust fork (AAT and `rand` off, `kern` kept); panic machinery removed from the shipped wasm                                                                                                                                | `experiments/sil-harfrust` (deleted)                                                   |
| `sil-green-2`       | Host part 1: idle frame, linear JavaScript mount, per-publication work, ingress, readback                                                                                                                                     | `experiments/sil-host` (deleted)                                                       |
| `sil-green-3`       | Column gather for prepared paragraphs (unit 1e part 1); `rand`-font oracle cases re-frozen; wasm probe build fix                                                                                                              | `experiments/sil-gather` (deleted)                                                     |
| `sil-green-4`       | Renderer parts 1–2 (Three, MSDF): one draw, effect-specialized shaders, ink-trimmed quads, glyph table, on-demand atlas, growth without new pipelines, atlas pages as views, per-range uploads, optional single-channel atlas | `experiments/sil-render` (kept: the Slug lane is working on it)                        |
| `sil-green-5`       | Existing-engine divergence fixes (seven families); 37 step references re-frozen                                                                                                                                               | `experiments/sil-cluster` (deleted; recreated when unit 1c starts)                     |
| `sil-green-6`       | Pure TypeGPU path units 1–2: effect-specialized shaders, ink-trimmed quads, real-device parity harness                                                                                                                        | `experiments/sil-typegpu` (kept: lane continues with batching)                         |
| `sil-green-7`       | Unicode property closure and dense kernel, per-paragraph bidi (unit 1d part 1); font binding compiled at font load                                                                                                            | `experiments/sil-unicode` (kept: lane continues), `experiments/sil-fontload` (deleted) |
| `sil-green-8`       | Dense run-local geometry (unit 1a)                                                                                                                                                                                            | `experiments/sil-geometry` (kept: lane continues)                                      |
| `sil-green-9`       | Slug per-font glyph table; benchmark MSDF oracle fix (full repository check passes)                                                                                                                                           | `experiments/sil-render` (kept: Slug fragment cost is next)                            |
| `sil-green-10`      | Pure TypeGPU batching through indexed transforms; growth device-error fix                                                                                                                                                     | `experiments/sil-typegpu` (kept: on-demand atlas is next)                              |
| `sil-green-11`      | UAX #14 opening-quote fix, single bidi classification, script set ids, resync predicates (unit 1d part 2)                                                                                                                     | `experiments/sil-unicode` (kept: part 3 is next)                                       |
| after `sil-green-4` | Stale process guidance removed; plan, decisions, build log and this map                                                                                                                                                       | integration branch                                                                     |

## Open lane branches

| Branch                        | Worktree               | Feature in progress                                                                        | On `origin`            | State                                        |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------- |
| `experiments/sil-geometry`    | `glyph-wt-geometry`    | Metric-change rescale, line-height class, label regression, gather reading run-local lanes | yes                    | building (1a merged at `sil-green-8`)        |
| `experiments/sil-positioning` | `glyph-wt-positioning` | Unit 1b: positioning topology/numeric split, per-line ink                                  | no                     | building                                     |
| `experiments/sil-unicode`     | `glyph-wt-unicode`     | Unit 1d part 3: word and sentence lanes, break-source seam, table re-encoding              | yes                    | building (parts 1–2 merged)                  |
| `experiments/sil-prepare`     | `glyph-wt-prepare`     | Preparation and error model (unit 3): batch prepare and the setter flip first              | yes (guard tests only) | building                                     |
| `experiments/sil-render`      | `glyph-wt-render`      | Slug fragment cost; Slug batching                                                          | yes                    | building                                     |
| `experiments/sil-typegpu`     | `glyph-wt-typegpu`     | Pure TypeGPU: shared pipelines, on-demand atlas residency, single-channel mode             | yes                    | building (batching merged at `sil-green-10`) |

## Not on any branch yet

Dense cluster build (1c); local edits (unit 2); gather by change class (1e part 2); engine mount, cannot-fail
and trap gateway, Three two-step, `onLayout` (unit 3 stages 3–6); publication (unit 4); many-label and
paint-only; CPU-memory unit; font loading beyond the binding; editing support; SIMD experiments; final
comparison.

## Other worktrees (not lanes)

Throwaway, detached, never merged: `glyph-floor-exp`, `glyph-chunk-spike`, `glyph-throughput-spike` (spikes);
`glyph-profile-inspect`, `glyph-profile-manylabel`, `glyph-profile-manylabel-main`, `glyph-profile-size`
(profiles); `glyph-baseline-main` (main, built, used for interleaved comparisons — keep until the final
comparison).
