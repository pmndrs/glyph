---
type: Log Entry
title: 'Baked identities no longer depend on Web Crypto'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Bake and runtime-bake producers stamp related font, raster, and
page artifacts with domain-separated MurmurHash3 x86 128 fingerprints. Normal loading compares those fingerprints and
declared lengths without hashing payload bytes. Build-time composition still recomputes fingerprints before
publication. The contract detects accidentally mixed or stale bake outputs and leaves damaged containers to decode or
upload validation; it does not claim cryptographic integrity.
