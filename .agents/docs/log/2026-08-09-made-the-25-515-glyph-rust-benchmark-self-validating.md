---
type: Log Entry
title: 'Made the 25,515-glyph Rust benchmark self-validating'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The result header's `primitiveCount` counts primitive-table
rows, so the benchmark's former “1 renderable instance” label did not prove the workload even though its 1–2.4 MiB
writes showed full packing. It now sums glyph primitive `recordCount` values and rejects an undersized plan. On the
unchanged `--glyphs 22000` fixture, Rust publishes 21,805 renderable records from 25,515 positioned TypeScript glyphs.
Five-warmup/11-sample Bitmap/MTSDF/Slug resize medians are 3.779/4.345/5.082 ms with p95
4.156/4.951/5.679 ms, versus TypeScript's 8.33 ms median. Rust wins, but all policies still fail the sub-4 ms p95 gate;
isolated warm-session Wasm high-water marks of 64.75/77.75/78.56 MiB also remain open rather than accepted costs.
