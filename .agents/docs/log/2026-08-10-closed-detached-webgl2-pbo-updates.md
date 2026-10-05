---
type: Log Entry
title: 'Closed detached WebGL2 PBO updates'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The complete Presentation matrix exposed a deterministic transparent Zoom Text
frame on forced WebGL2 Bitmap. Three's PBO setup had replaced each storage attribute array with a padded retained copy,
while later Rust command-buffer patches still changed only canonical storage. Dirty patches now copy their exact byte
ranges into the detached upload view before texture invalidation; WebGPU retains direct aliasing. A focused integration
fixture proves canonical/upload equality and untouched padding. All 48 Bitmap/MTSDF/Slug × WebGPU/WebGL2 workload
cells remain visible with one renderer. The matrix also closed a benchmark-only transition seam where Off-axis's 120%
default could be observed for one render under the preceding workload's 100% contract. The PBO fix adds 587 raw / 112
gzip / 64 Brotli bytes to Three; core JavaScript and Wasm remain byte-identical.
