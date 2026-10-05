---
type: Log Entry
title: 'Closed the LayoutRun browser, size, and performance matrix'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Both native TSL and Three/TypeGPU Presentation paths
pass all 60 workload/backend/technique cells: 10 workloads, WebGPU and WebGL2, and Bitmap/MTSDF/Slug. The matrix keeps
every workload visible, preserves its expected draw topology, and covers Editorial, 11,510-glyph Paragraph Stress,
projected off-axis text, dynamic layout, paint effects, and rich text. Editorial retains exactly three draws and its
64-sample median reflow spans `0.990–1.710 ms` across the full runs. Direct TypeGPU's project-Chromium WebGPU gate also
passes all three rasters with nonzero-alpha counts `9280/7875/7497`. The reviewed size check records 1,374,150 raw /
532,034 gzip bytes for the shaper, 233,947 / 44,210 for direct TypeGPU, 554,014 / 136,538 for Three, and 662,332 /
149,746 for Three plus TypeGPU. The final semantic deferral adds only 554 raw shaper bytes (0.04%); every JavaScript
adapter and font artifact is unchanged from the preceding placement-publication checkpoint.
