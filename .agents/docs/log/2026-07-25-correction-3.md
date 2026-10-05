---
type: Log Entry
title: 'Correction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Tightened raster plugin descriptors to `JsonValue` without trusting TypeScript at the JavaScript boundary, retained deep RFC 8785 input validation, and resolved each descriptor/`rasterKey` pair once so project ordering, packaging, and baking cannot observe different values from a stateful plugin.
