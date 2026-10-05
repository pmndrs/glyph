---
type: Log Entry
title: 'Reduced R3F font loading to resolution plus readiness'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

D-300 makes readiness the only loading branch after font
resolution: loaded selections proceed synchronously and unloaded selections suspend on the stable `handle.load()`
promise. A provider font map contributes local aliases only. Direct FontFace and root-catalog selections use the same
path; only an unresolvable name throws before the readiness check.
