# Layout refactor: branch map

Which feature is on which branch. Updated at every merge and every hand-back. Companion to the
[build log](segment-indexed-layout-build-log.md) and the [plan](segment-indexed-layout.md).

Rules: a lane branch is deleted (local, remote and its worktree) as soon as it is merged into the integration
branch and the merge is verified, tagged and pushed. A branch that is merged but still has a lane working on
it stays until that lane hands back. Lane branches on the remote are backups, not for review.

## Integration branch

`experiments/segment-indexed-layout` on `origin`, worktree `/Volumes/Depot/Developer/glyph-held-rope-wip`.
Based on `8176a24e0` (tip of `experiments/held-rope-ascii-anchor-wip`).

| Tag                 | Feature merged at this tag                                                                                                                                                                                                    | Came from (branch, now deleted unless noted)                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `sil-green-0`       | Correctness oracle (unit 0)                                                                                                                                                                                                   | built on the integration branch                                    |
| `sil-green-1`       | HarfRust fork (AAT and `rand` off, `kern` kept); panic machinery removed from the shipped wasm                                                                                                                                | `experiments/sil-harfrust` (deleted)                               |
| `sil-green-2`       | Host part 1: idle frame, linear JavaScript mount, per-publication work, ingress, readback                                                                                                                                     | `experiments/sil-host` (deleted)                                   |
| `sil-green-3`       | Column gather for prepared paragraphs (unit 1e part 1); `rand`-font oracle cases re-frozen; wasm probe build fix                                                                                                              | `experiments/sil-gather` (deleted)                                 |
| `sil-green-4`       | Renderer parts 1–2 (Three, MSDF): one draw, effect-specialized shaders, ink-trimmed quads, glyph table, on-demand atlas, growth without new pipelines, atlas pages as views, per-range uploads, optional single-channel atlas | `experiments/sil-render` (kept: the Slug lane is working on it)    |
| `sil-green-5`       | Existing-engine divergence fixes (seven families); 37 step references re-frozen                                                                                                                                               | `experiments/sil-cluster` (deleted; recreated when unit 1c starts) |
| `sil-green-6`       | Pure TypeGPU path units 1–2: effect-specialized shaders, ink-trimmed quads, real-device parity harness                                                                                                                        | `experiments/sil-typegpu` (kept: lane continues with batching)     |
| after `sil-green-4` | Stale process guidance removed; plan, decisions, build log and this map                                                                                                                                                       | integration branch                                                 |

## Open lane branches

| Branch                     | Worktree            | Feature in progress                                                                                         | On `origin`                                           | State                                        |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `experiments/sil-geometry` | `glyph-wt-geometry` | Dense run-local geometry (1a); then metric-change rescale                                                   | yes (unverified checkpoint)                           | building                                     |
| `experiments/sil-unicode`  | `glyph-wt-unicode`  | Unicode property closure and dense kernel (1d); then bidi counts, resync predicate, word and sentence lanes | yes (unverified checkpoint)                           | building                                     |
| `experiments/sil-prepare`  | `glyph-wt-prepare`  | Preparation and error model (unit 3): batch prepare and the setter flip first                               | yes (guard tests only)                                | building                                     |
| `experiments/sil-render`   | `glyph-wt-render`   | Slug: full check, per-font glyph table; then fragment cost                                                  | yes (unverified checkpoint on top of the merged work) | building                                     |
| `experiments/sil-typegpu`  | `glyph-wt-typegpu`  | Pure TypeGPU path: batching through indexed transforms, growth bug; then on-demand atlas                    | yes                                                   | building (units 1–2 merged at `sil-green-6`) |
| `experiments/sil-fontload` | `glyph-wt-fontload` | Font binding compiled at font load                                                                          | no (nothing committed yet)                            | building                                     |

## Not on any branch yet

Positioning split (1b); local edits (unit 2); gather by change class (1e part 2); engine mount, cannot-fail
and trap gateway, Three two-step, `onLayout` (unit 3 stages 3–6); publication (unit 4); many-label and
paint-only; CPU-memory unit; font loading beyond the binding; editing support; SIMD experiments; final
comparison.

## Other worktrees (not lanes)

Throwaway, detached, never merged: `glyph-floor-exp`, `glyph-chunk-spike`, `glyph-throughput-spike` (spikes);
`glyph-profile-inspect`, `glyph-profile-manylabel`, `glyph-profile-manylabel-main`, `glyph-profile-size`
(profiles); `glyph-baseline-main` (main, built, used for interleaved comparisons — keep until the final
comparison).
