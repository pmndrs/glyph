---
type: Log Entry
title: 'Presentation retained-workload closure'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed benchmark-side warm `ready` coordination from retained layout, font, and Dynamic Layout updates; all publish through the Three.js lifecycle. Zoom now pre-shapes its complete 16-word multilingual corpus during cold scene construction and performs only resident scale/opacity/visibility animation. Icon Grid stages cold pool growth off-scene, publishes new view defaults atomically, drains recycling synchronously with retained scratch storage, and no longer allocates per-entry geometry sets or active-layout arrays on every frame. The six-cell Bitmap/MTSDF/Slug × WebGPU/WebGL workload matrix held visible pixels through all seven comparison scenes with one renderer and no warnings; both 60-second timed demos completed their authored sequence and ended on Off-axis / 3D at 60.02 Icon Grid FPS. The 27-cell WebGPU cadence sweep held 60.0–60.2 RAF FPS with zero slow frames in every MTSDF/Slug cell and every Bitmap cell except the deliberate 11,510-glyph/1,120-draw Paragraph Stress case, which measured 58.8 FPS with three frames above 20 ms. The corrected Icon Grid evidence workflow retains a bounded CPU profile and performance trace instead of attempting an unbounded heap-summary serialization; its 20-second run recycled 660 assignments with 18.60 ms p95, 18.64 ms maximum, and zero slow frames. Pinned React Doctor 0.7.2 reports zero diagnostics and a 100/100 score; the retained screenshot workflow covers all seven workloads on both backends. Every commit in the nine-PR stack is GitHub-verified for the configured maintainer identity, every PR body records its exact scope and evidence, and every latest CI run passes.
