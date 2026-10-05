---
type: Log Entry
title: 'Removed repeated placement-root discovery from retained reflow'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`ClusterArena` now prepares one stable u32
word/run-root anchor per cluster after its independently usable word-fit sidecar; positioning resolves that anchor in
O(1). The placement arena replaces one segment index per rendered glyph with one instance count per compact segment,
so retained line copy and final slot binding operate on contiguous segment ranges without changing batches, draws,
placement rows, or publication bytes. A same-harness A/B/B/A against exact parent `2b6d5eb3`, with 62 samples per
revision, improves median justified Latin 6.7%, mixed bidi 1.9%, ordinary Latin 1.7%, and dense CJK 0.7%; p95 improves
10.1%, 2.2%, 1.2%, and 0.8%. A separate 202-sample cold comparison limits the median tradeoff to +0.4%/+0.5% for
Latin/CJK, and the optimized Wasm is 339 raw bytes smaller. The full Rust and Unicode conformance suites pass; the
final fresh-main/full-workload gauntlet remains open.
