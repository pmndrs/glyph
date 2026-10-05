---
type: Log Entry
title: 'Advanced-shaping performance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed roadmap item 7.2 with a performance observation that is separate from finite conformance duration. The human WebGPU surface ran every exact authored lane at explicit 1× DPR and waited for twelve causal FPS/GPU reports without sleeps. Chromium 149 on Apple `metal-3` observed 119.7–120.9 FPS, 0.1–0.2 ms median CPU submit, 0.050–0.149 ms median GPU time, 8.6–18.5 ms initial public `Text` readiness, and 23.4–119.0 ms startup; the record labels its environment and remains evidence rather than a portability threshold. Live and captured reports now present the rolling GPU median instead of hard-coding it unavailable.
