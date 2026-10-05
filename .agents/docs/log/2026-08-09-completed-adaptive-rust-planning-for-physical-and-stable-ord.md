---
type: Log Entry
title: 'Completed adaptive Rust planning for physical and stable-order buffers without accepting repeated packing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The
first per-buffer execution prototype regressed cold Bitmap/MTSDF/Slug by roughly 1.2/2.2/2.4 ms. Grouping identical
selected ranges back into one active-buffer job closes that regression while preserving independent costing and
committed gap bytes. Canonical before/after results are mixed and standard resize remains one unchanged-size patch, so
sparse browser upload evidence is still required before claiming a win.
