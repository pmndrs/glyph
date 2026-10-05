---
type: Log Entry
title: 'Viewport-scaled Benchmark workloads'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Gave screen-bounded Benchmark paragraphs a deterministic authored width floor that pans on smaller canvases and expands inside a shared viewport inset on larger canvases. Resize now separates camera and surface updates from content-width changes, so fixed-width resize ranges and the intrinsic Text Ladder avoid unnecessary paragraph rebuilds. Icon Grid retains intrinsic two-axis virtualization, fixed-size labels, and logarithmic icon scaling while remapping the grid coordinate under the viewport center across scale changes.
