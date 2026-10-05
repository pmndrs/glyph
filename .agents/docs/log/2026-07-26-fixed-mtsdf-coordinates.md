---
type: Log Entry
title: 'Fixed MTSDF coordinates'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added an explicit checked generator transform so the fixed baker can place every glyph on one global plane grid and encode one authoritative pixel range without per-glyph stretching. Oracle mode still uses the admitted one-em range and retains every exact native-oracle hash; the added production seam costs 164 raw Wasm bytes.
