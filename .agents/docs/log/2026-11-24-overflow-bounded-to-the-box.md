---
type: Log Entry
title: 'Bounded overflow to the box'
generated:
  by: process:docs-new
  at: '2026-11-24T19:55:08Z'
---

Bounded `layout.overflow` to the box ([decision](../planning/decisions/overflow-visible-clip-swap.md), issues 01 and
16). A line box fits when it ends at or above a region's foot, straddles when it starts inside and ends past it, and is
outside when it starts at or below it; no band starts at or below the foot. In a thread's last region `'visible'` (the
default) keeps the straddling line and `'clip'` drops it; earlier regions pass it on in every mode. Measured first: on
`v0.1.0` and the branch, `'clip'` already drew only the fitting lines, and only its layout reads served the full
intrinsic layout, so the positioned clipped inspection was removed and reads now describe the drawn layout. No mode
assigns a clip id, so clipped columns no longer split draws; the integrator-facing clip plumbing stays, carrying zero.

Re-freeze: 35 clip cases moved (layout reads lose lines past the box, clip ids zero, per-column draws merge; flow and
positioned lanes unchanged); nine new visible cases, compared row by row against the previous engine, append exactly
one line to every flow capture. Native and wasm full tiers: 605 equal, differential 0 rejected, 0 unlisted; four known
divergences that came from the clipped inspection no longer occur and were removed. Shaper Wasm 1,356,129 to
1,353,396 raw, 536,278 to 535,361 gzip. A 15,000-character Node A/B (Inter bitmap, eight widths, measure and render):
width sweep without height unchanged (1.61 vs 1.61 ms per width); fixed height 60 under `'clip'` 0.75 to 0.30 ms and
under `'visible'` 0.44 to 0.31 ms; fixed height 600 under `'visible'` 0.59 to 0.44 ms.
