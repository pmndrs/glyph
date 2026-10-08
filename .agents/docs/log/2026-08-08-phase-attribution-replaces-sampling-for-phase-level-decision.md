---
type: Log Entry
title: 'Phase attribution replaces sampling for phase-level decisions'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A sampling profiler put `positionPrepared` at 27.7% of self time and Unicode analysis at 7%, and the first plan followed it. Both readings were artefacts of self time. Unicode analysis is 24.6% inclusive, fragmented across `extensionSet`, `itemizeScripts`, and `resolveGraphemeScript`; and a Chrome DevTools profile of the same chain inverted the attribution entirely, reporting `lowerBound` at 15.60% of busy where Node reported 1.9%, and `positionPrepared` at 0.51% where Node reported 27.7%, because V8 inlined the callees in one run and not the other. `measureClusters`, the function the original plan would have restructured first, measured 2.7%. Added opt-in phase spans through `setTextProfiler`, costing one comparison per phase while no profiler is installed, and `userTimingProfiler()` to forward the same spans to the User Timing timeline for a browser profile. `pnpm scripts run glyph:layout-benchmark` reports a median of warmed repetitions per invalidation class with its relative standard deviation and phase breakdown, never an average across classes, and applies a value no earlier repetition used so a retained constraint cache cannot answer a measured update. Recorded as D-159 and D-160. The mixed-direction Amiri golden earned its place during this work by catching a last-digit drift when positions were accumulated in single precision: alignment and justification read a position axis back after storing it, so every axis now accumulates in double precision and narrows once, following the axis rather than today's only caller, since vertical alignment is on the roadmap.
