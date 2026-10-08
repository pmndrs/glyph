---
type: Log Entry
title: 'Added public read/publication tradeoff benchmarks'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

The `@read-publication` Labs selection covers unchanged,
batched, and interleaved `measureGlyphs`, `caretAt`, and `selectionRects` calls at 100 and 1,000 labels, a no-read
publication control, and bulk versus incremental mount-and-split lifecycles. Final committed-layout snapshots prevent
deferred work from masquerading as an optimization; legacy split callers receive the explicit traversal they require.
The packed-artifact runner accepts and records `--filter`. An initial two-block run of base `5eccfac5` against
`d2e914a4` passed all 24 output checks on both artifacts, with matching snapshots. At 1,000 labels, the candidate's
median of block medians was 3,303.6 ms for alternating writes/`measureGlyphs`, versus 63.2 ms for writes before reads;
the baseline's alternating case was 19.4 ms but did not guarantee fresh intermediate reads. These are exploratory
observations, not significance verdicts: two blocks cannot meet Labs' 0.05 threshold, and candidate CPU frequency
drifted 6.2%. Default eight-block reruns remain available. See [benchmark ownership](../packages/benchmarks.md).
