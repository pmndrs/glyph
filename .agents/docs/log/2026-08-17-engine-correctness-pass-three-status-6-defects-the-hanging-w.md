---
type: Log Entry
title: 'Engine correctness pass: three status-6 defects, the hanging word space, and the flag lattice'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A live stall in the Advanced-shaping workload was reproduced headlessly and root-caused to three
independent rejections of valid public-API input, none of them the state machine the investigation
expected: an empty feature range on an empty root style, style payloads allocated all-languages-then-all-
features against a validator that requires per-record order, and a ligature-absorbed cluster left without
its owning font's units-per-em. Each is fixed at the point that made the valid state unrepresentable
(D-255 covers the lifecycle half). A sequence-level property gate now drives randomized-but-seeded
interactive sequences through the public Three surface and asserts per step that valid input publishes
and that committed metrics never disagree with themselves; reverting the three fixes turns it red.
Separately, the line-terminating word space now hangs (D-257) — it was charged against the measure by the
fit and assumed absent by justification, which made flush unreachable on every justified line and made
the breaker discard break opportunities outright. Finally the prepared/pending flag lattice is retired
(D-258): every stage is one `Staged<T>`, and stale positioning over a re-run flow is unrepresentable
rather than repaired. Lanes unchanged across an interleaved three-round A/B at 22,000 glyphs.
