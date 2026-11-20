---
type: Log Entry
title: 'Checkpoint the HELD rope and ASCII anchor runtime prototype'
generated:
  by: process:docs-new
  at: '2026-11-20T23:18:23Z'
---

This branch checkpoints the current HELD rope implementation, its bounded ASCII-anchor shaping experiment, and the retained regression tests above draft #310. It is a work-in-progress source snapshot, not accepted performance work. Synchronous setters, prepared measurement and glyph queries, independent split, Rust authority, logical order, and packed storage retain their existing contracts.

The optional route admits a screened, printable-ASCII, single-font Latn/LTR paragraph with a length-changing edit. It shapes a bounded item between immutable anchors and reconstructs the packed raw arena; full Unicode, cluster, layout, measurement, and publication work remains charged. Unsupported cases use the existing producer. No public API or contract change is proposed.

The last final native suite passed 512 unit tests and 13 integration tests, with one ignored test and no warnings. The standard package check built shipping JS/Wasm and passed its package tests and formatting, then failed Clippy in ascii_anchor_policy.rs: fixed_window has eight arguments and the right-anchor range loop indexes old. These known findings are preserved in this snapshot. No new tests or benchmarks are being run merely to push it.

The new runtime has no verified complete-operation speed result. Both-control parity across all seven fixed families remains open; the prior full matrix had real sparse/interleaved/copy gains and remaining regressions. Future changed-candidate timings must use ABBA and ABAB against same-machine main and published 0.1.0, including reversed orders, fresh processes, absolute p50/p90, and ordered untrimmed block distributions. There is no 5% admission floor or contaminated-p95-only veto.

All local frozen source, artifacts, raw results, failures, and earlier variants remain preserved. The existing PR stack stays unmerged. This branch creates no new PR, release, tag, or demo merge.

See the [HELD rope performance handoff](../reports/held-rope-performance-handoff-2026-11-20.md) for research links, prior approaches, measured outcomes, and the continuation protocol.
