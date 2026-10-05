---
type: Log Entry
title: 'Reproducible TypeScript-to-Rust migration evidence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Rebuilt exact base commit `90964be0` in an isolated worktree
with its own lockfile and original public layout benchmark, then ran the unchanged 22,000-glyph target at eight warmups
and 31 measured repetitions on the same Darwin arm64 host as the current optimized artifact. The base
cold/font-size/width/suffix-edit medians are 58.32/12.09/9.15/39.61 ms. Current Bitmap, MTSDF, and Slug complete
`text_update` plus render-plan medians are respectively 15.90/6.04/2.78/13.48, 16.50/6.41/2.73/13.52, and
16.73/6.64/2.96/14.37 ms. Checked JSON records retain the exact summaries, one shared Wasm identity, technique,
allocation strategy, cadence, and glyph target; a fixture contract requires every comparable Rust median to remain
below the recorded TypeScript median. This establishes the migration direction on this machine without turning timing
observations into cross-host CI thresholds or declaring the p95-under-4-ms target complete.
