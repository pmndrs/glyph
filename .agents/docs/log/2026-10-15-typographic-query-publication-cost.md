---
type: Log Entry
title: 'Reduce typographic query publication cost'
generated:
  by: process:docs-new
  at: '2026-10-15T11:51:00Z'
---

The richer typographic measurements added repeated scalar reads and immutable line-strut allocations to Three's
publication measurements. The [semantic query implementation](../packages/glyph.md#semantic-queries) now bounds one
native DataView to the publication, retaining native scalar bounds protection and whole-table validation while removing
repeated JavaScript safe-integer/range checks for package-owned field offsets. Adjacent identical line struts share one
frozen font-metrics object; differing authored sizes remain independent. Ordinary Three updates reject the anchor-only
shortcut before comparing accepted presentation when the anchor identity is unchanged. The public measurement shape,
constraint sizing, accepted/rejected placement semantics, and Wasm ABI remain unchanged.

An eight-block packed-package comparison against exact canary `0.1.0-canary-d7ffcbbd-20261014` reproduced width-reflow
cost at +17.4% before these corrections. Sharing metrics alone reduced allocation but retained +15.8% reflow, so it was
not accepted as a sufficient fix. With the publication-bounded reader, the same suite measured reflow at 481.25 versus
544.58 microseconds (-11.6%, p<.001, confidence interval -16.1..-8.5%). Measurement, color publication and font-size
relayout were neutral with lower medians. Text publication was clock-confounded and cached labels used different
batching modes; neither is claimed as passing performance evidence from that run. Ignored raw artifacts are under
`benches/.cache/anchor-perf-before`, `anchor-perf-metrics`, and `anchor-perf-reader`; packed stages and CPU profiles are
retained under `/tmp/glyph-anchor-perf-*` and `/tmp/glyph-anchor-*.cpuprofile` on the development machine.

The focused anchor, drop-cap typography and shaper compatibility suites pass 32 tests. The existing real-font tests now
also prove immutable strut sharing and independent metrics for successive lines with differing authored font sizes.

The complete owning Glyph check passes: 1,010 package/integration tests plus Rust, fuzz, source/emitted consumer types,
lint, formatting and Clippy. No font fixture, binary ABI, or correctness baseline was changed.

The final 16-block smoke comparison (`benches/.cache/anchor-perf-final`, packed candidate `f59012ff`) reports one faster,
zero slower, four neutral and one timing-mode mismatch. Text publication is 1.99 versus 2.03 ms (-2.1%, p=.035,
confidence interval -3.1..-0.2%); reflow is 486.56 versus 545.46 microseconds (-10.8%, p<.001). All five comparable
workload medians are lower. This machine run also reports 20% candidate clock drift, an 11.4% between-run clock
difference, and a worse text-publication p99 (+126.1%); it establishes improved medians, not a tail-latency guarantee.
Cached-label mode mismatch remains excluded. Fresh CI performance evidence is still required before merge.
