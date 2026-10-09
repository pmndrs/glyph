---
type: Log Entry
title: 'Reused unchanged span alignment across publication normalization'
generated:
  by: process:docs-new
  at: '2026-10-08T23:58:33Z'
---

Raw formatted updates now reuse the previous normalized cluster grid when the string and every validated span boundary
are unchanged. The same bounded proof applies in Three and the retained planner; new text or boundaries still use the
full Unicode segmenter, and style snapshots still validate and clone caller-owned nested data. The
[Glyph concept](../packages/glyph.md) records that boundary. A negative-control integration test makes Unicode alignment
throw: an unchanged-boundary color edit succeeds, while changed text and an inside-cluster boundary still throw. The
official Unicode 17 grapheme corpus and the existing unaligned-input retention case also pass.

Added `benchmark:publication-profile` and the focused `spans` Labs suite to the
[benchmark concept](../packages/benchmarks.md). Both use the exact installed-package workload: 1,000 labels, eight raw
spans, and alternating input objects whose only change is the last span's color. Warmup and correctness are untimed; the
oracle now inspects the realized scene and proves 1,000 texts, 34,000 glyphs, one draw, stable borrowed positions, and
5,000 glyphs in the selected red or blue paint lane.

Against the source-equivalent `4d97b2ab` artifact, the final 20-iteration V8 profile removes all sampled grapheme work
from the timed loop (92.086 ms CPU and 209,185,808 sampled bytes at baseline), reduces sampled allocation from
1,922,206,632 to 1,701,100,408 bytes, and lowers set/stage p50 from 38.564 to 35.885 ms. WeakMap allocation remains
essentially unchanged (43,880,856 to 42,808,816 bytes), so the earlier equality-allocation hypothesis was not the cause
and that experiment is not included. A stable 12-block Labs confirmation measures 88.74 to 86.73 ms p50 (-2.3%,
`p < .001`, 95% CI -3.3% to -1.5%); Labs classifies it neutral under the configured 5% effect threshold. Reported heap
falls from 38.12 to 28.40 MB/iteration and median GC from 1.18 ms to 0.56 ms. This is a partial trailing-span reduction,
not a claim that edit-sized publication or the other full-suite regressions are resolved.
