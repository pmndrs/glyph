---
type: Log Entry
title: 'Retained immutable bindings for patch-only publication'
generated:
  by: process:docs-new
  at: '2026-10-09T04:55:35Z'
---

The ordered render-plan publisher now retains immutable resource, buffer, primitive, and draw bindings for a patch-only
publication when the pending plan proves those bindings are identical to the accepted plan. The proof includes batch
count and state, physical buffer identity, generation and capacity, primitive and draw bytes, and the absence of
retirements. It deliberately excludes mutable buffer contents because ordered physical patches are their authoritative
publication. Abort/retry coverage proves that rejected work cannot advance accepted bytes or force a replacement.

The [Glyph package concept](../packages/glyph.md) records the contract and its limit. Fresh installed-package Labs
comparison found 30.8–46.1% lower medians in eleven color-only lanes, with the twelfth inconclusive, and a 30.8% lower
100-label interleaved edit-read median; same-length and length-changing text edits remained neutral. A named-Wasm profile showed
that color-only edits do not reshape, but retained engine preparation, gather, and render-plan work still scale with the
root. The candidate color-only median was 0.094 ms at 10 labels and 1.071 ms at 1,000 labels, an 11.4× increase, so issue
#247's edit-sized acceptance is not closed.

The [benchmark package concept](../packages/benchmarks.md) now names the `edit-sized` installed-package suite and the
named-Wasm stage profiler. These preserve warm, serialized measurements across same-length, length-changing, color-only,
batched-read, and interleaved-read cases without making profiler samples into a correctness mechanism. No public API or
wire-format change was introduced; metadata-changing text edits continue to use the existing atomic group replacement.

The Glyph and benchmark package checks pass. The full workspace check reaches an existing Tres playground live-probe
failure: its Slug switch commits 25 records in three draws while the probe expects two. Rebuilding and rerunning the same
Portless probe with the previous publication predicate reproduces the identical result, so it is recorded as a baseline
application failure rather than attributed to binding retention.
