---
type: Log Entry
title: 'Made cold command-buffer growth recover instead of failing the benchmark scene'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Decoupled the 64 MiB output
safety limit from the smaller retained A/B arenas. Rust's exact required-result watermark now drives one bounded cold
reserve/retry; the host re-resolves the request pointer and recopies after possible Wasm-memory detachment. A
compiled-Wasm test forces growth from a header-sized arena. The live MTSDF paragraph-stress scene consequently publishes
11,510 glyphs in one draw instead of status 7 at 1,382,592 bytes. Three settled WebGPU A/B runs rejected an eighth,
split origin/size storage binding: CPU submit was unchanged and median GPU time trended worse, so MTSDF stays packed.
