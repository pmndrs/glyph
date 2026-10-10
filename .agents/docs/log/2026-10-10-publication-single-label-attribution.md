---
type: Log Entry
title: Separate one-label preparation from remaining Three publication work
sources:
  - resource: ../packages/benchmarks.md
    title: Profile boundary contract
  - resource: ../planning/publication-frontier.md
    title: Current performance gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T15:28:36.823Z'
---

Current frozen76ef artifact versus registry0.1.0 stress4 run59507 passed8 cases:4faster/2slower/2neutral/0skips. Bulk1024 publication19.72→30.39ms(+10.67/+54.1%); groupvisibility559.65→592.98us(+33.33us). One-label edit+measurement among1000labels237.44→150.00us(-36.8%). The median across8 workload p50s1.795→1.646ms does not clear the bulk regression or fullreleasegate. Report .cache/publication-current-release-stress/summary.md.

The named1024-label fixture edits the final six-character numeric label for1000iterations/20warmups. Preparation92207 median20.667us/p9535.750us; publication37429, now read-before-publish, median766.209us/p951095.792us. Both use exact76ef+named8dc9; this is diagnostic latency, not release A/B or GPU frame time. Final publication measurement matches an independently initialized cold one-label control. The earlier read-afterpublication profile63755 was777.917us median; do not mix those call orders in an isolated-stage claim.

In the read-first profile847.583ms total sampled across1000updates,765.711ms JS/56.040ms Wasm/25.832msruntime. prepareDrawReplacement80.043ms, renderer#prepareBound78.083ms, Text#reconcileEntries77.127ms, renderer#prepareTransforms73.750ms and matrixMultiply51.414ms are sampled self totals, not individual frame times. Independent source-map review traced metadata-triggered display-list replacement to eager transform-map/index rebuilding and draw realization. Safe source slice retains identical binding tables and ordered structural draw identities through the existing realizer; matrix observation stays until mutable ancestors/explicitshape/late-sibling correctness is proved. Gather stream source slice and node-summary validity work remain separate owners in the same pipeline, not applied parallel implementations.

Benchmark package checking found the previous diagnostic JavaScript import lacked a declaration companion (TS7016). Added the package-owned typed proof/function-map companion rather than suppressing the boundary. Initial check96811 failed; corrected check70475 is the completion gate. Workflow tests17/17 pass, publication cold control passed.

Corrected package check70475 passed TypeScript/lint/format, then failed the saved-comparison fixture because edited benches/labs is correctly rejected as an uncommitted harness change. The current-HEAD fixture requires a clean harness. Commit this verified profile change, then rerun the package check using already-built runtime packages; do not weaken saved-result authentication.

After commit1bd341f1, benchmark package check85237 passed with already-built runtime packages: types, lint, format, tests, Chromium verification and application build. Initial sandboxed launch47383 failed macOS Mach-port registration; the authorized browser-capable retry passed. No runtime change or new performance claim.
