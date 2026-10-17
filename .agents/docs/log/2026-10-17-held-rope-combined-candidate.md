---
type: Log Entry
title: 'Evaluate preserved HELD compiler and preparation changes together'
generated:
  by: process:docs-new
  at: '2026-10-17T20:38:25Z'
---

The user set an active goal to evaluate the retained preparation receipt cleanup together with the preserved compiler policy change. The [frontier](../planning/publication-frontier.md) governs the relaxed materiality floor and named preservation of inconclusive candidates. Fresh scoped Sol High advice supports a normalized four-arm package design: original HELD, compiler only, cleanup with original Wasm, and cleanup with treatment Wasm. The two compiler columns share exact Wasm bytes, including data, so the previous source-location data difference is excluded from the factors.

Before timing, primary froze `.cache/held-local-20261016/combination-20261017/admission-before-timing.json`: the existing no-read 1,024-label scene-publication Labs workload, 16 blocks per arm, each timed once, order original → combined → cleanup only → compiler only, with the saved combined result reused for comparisons. Serial measurements are exploratory pairwise screening, not a counterbalanced interaction estimate. No favorable-clock retry is authorized. The derived cleanup packages are experimental, not fresh production builds; any later production adoption requires its own authentication and final gates.

Evaluation is complete and [preserved as inconclusive](../../../benches/reports/held-ropes-local-2026-10-16/preparation-compiler-combination.json). The named workflow constructs two experimental archives from three authenticated inputs; fresh Sol High review is clean, and primary independently verifies all member bytes and actual Wasm interfaces. The exact combined distribution passes 1,048 Node tests, 30 prepared generators, 27 diagnostic/workflow tests and both static gates; production Wasm was restored after tests.

Original/compiler/cleanup/combined p50/p95 are 23.141/34.429, 21.614/26.289, 27.910/48.868 and 28.401/42.311 ms. Each arm ran once for 16 blocks / 256 retained samples; all comparisons reuse byte-identical combined results. Combined/cleanup clock drift is 7.4%/16.3%, and all three comparisons are withheld from causal acceptance. Observed slower medians, raw p/CI and all warnings remain recorded; neither a gain, zero benefit, causal regression nor interaction is proved. Initial relative-path ENOENT happened before sampling; the corrected absolute-path run is the sole timing experiment. No favorable-clock retry ran.

Retain the preparation cleanup and preserve both isolated and combined options under `.cache/held-experiments/held-preparation-plus-compiler-inconclusive-2026-10-17/` and the matching local `experiments/` Git ref. Production compiler policy remains unchanged. Same Python gzip9 shows compiler Wasm −4,308 raw/+5,419 gzip and cleanup JS+90 raw/+33 gzip bytes. Arm11 memory/browser/hero and final main/published acceptance are unperformed, with no prior results reassigned to it. The compact frontier records remaining dense/readiness work. All owned experiment jobs are terminal; the real stack remains held/unmerged.
