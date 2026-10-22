---
type: Log Entry
title: 'Whole V3 and single-owner combination experiment'
generated:
  by: process:docs-new
  at: '2026-10-22T20:40:03Z'
---

The experimental branch combines the complete preserved V3 frontier with the frozen single-owner preparation wave. It replaces per-owner range dispatch with one range only when the entire active frontier is contiguous, unchanged in source count, decoration-free and wholly dirty. Failed admission, suffix Stop, rollback and retry retain the existing paths. There is still one ordered rope traversal in both variants. Paragraph lookup is a binary search; the added admission trades an O(N log P) lookup/check pass against the old iterator's lookup/dispatch pass rather than deleting all owner work.

Prepared inspection and split remain synchronous and independent. The dense native cold-output oracle now includes inspection, a detached copy and two further owner edits before publication, with copied bytes checked afterward. Existing callback failure, source-root restoration, count-change, abort/retry and renderer recovery coverage remains. Fresh scoped Sol High review found no actionable source issue; the exact failed-renderer-delivery plus new dense copy sequence is covered by separate tests. Native fixture counters cannot establish timed Wasm execution counts.

Six focused native workflows and the full Glyph package check passed. The package check includes fresh Wasm/JS build, 487 native tests, Node/fuzz/e2e/conformance and static checks. Benchmark routing, artifact authentication and timing are recorded in the [experiment report](../../../benches/reports/held-v3-single-owner-local-2026-10-22/README.md). No timing gain or parity is claimed by this source checkpoint.

The new `frontier` suite tags exactly four unchanged callbacks: dense512, dense1024, sparse first-label scene publication among 1000, and the one-label repeated setter. The predeclared eight-block fixed-20 single-call comparison retains all raw distributions and guards. Correct inconclusive variants stay preserved; no 5% floor, tail-only rejection or favorable rerun applies. Full seven-family/main/published and candidate-specific output/size/owned-memory gates remain necessary before acceptance. The submitted stack remains held and unmerged.

The single authenticated comparison completed after the source checkpoint at `8f62b707`. Dense512 p50 was 8.325208 → 8.337834 ms and dense1024 17.213917 → 17.176875 ms, with overlapping eight-block distributions. Fresh scoped High review did not admit V3 as the next product wave; the decision uses ordinary dense evidence, not the sparse tail or a 5% floor. The complete correct variant and all failed/corrected verification receipts remain preserved. No further V3 rerun or full product acceptance sequence is selected.
