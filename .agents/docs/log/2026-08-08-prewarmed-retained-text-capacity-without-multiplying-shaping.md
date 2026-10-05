---
type: Log Entry
title: 'Prewarmed retained text capacity without multiplying shaping scratch per session'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Session creation now reserves
both UTF-16 transaction buffers to 1,024 units by default, while cold create/reserve accepts an explicit text capacity.
The production 32,768-record analysis/shaping/layout workspace is fixed as one engine-global synchronous allocation
when those arrays land, covering the 25,515-glyph target without assigning that footprint to every paragraph.
