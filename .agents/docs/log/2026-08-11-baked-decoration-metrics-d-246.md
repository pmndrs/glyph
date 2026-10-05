---
type: Log Entry
title: 'Baked decoration metrics (D-246)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Font artifacts now bake underline position/thickness from `post` and
strikeout position/size from `OS/2` as required metrics fields, decoded into public `FontMetrics` and probed by the
rich-text conformance lane. Every baked fixture and pinned identity regenerated once, pre-v1, with byte-identical
shaping payloads; text decoration itself stays a later additive renderer feature. Raw-node fixture regeneration also
repaired: benchmark contract JSON imports now carry explicit `type: 'json'` attributes.
