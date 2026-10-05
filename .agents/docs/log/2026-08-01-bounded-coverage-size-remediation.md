---
type: Log Entry
title: 'Bounded-coverage size remediation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the second derived Serde serialization graph from Bitmap and MTSDF coverage-capable bakers while preserving strict seed validation and byte-identical canonical descriptors. The measured Darwin arm64 Wasm payloads now occupy 626,940 raw / 234,735 gzip / 180,503 Brotli bytes for Bitmap and 553,190 raw / 215,142 gzip / 169,365 Brotli bytes for MTSDF. Dedicated pre-coverage growth gates bound the remaining strict decoder, cmap-resolution, and canonical-policy cost. Bitmap runtime decode now also derives the canonical policy key from authenticated strikes and coverage before creating GPU resources, matching the existing MTSDF boundary.
