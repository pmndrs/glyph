---
type: Log Entry
title: 'Regenerated package-size truth after isolating baker build variants'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The renderer-neutral browser core plus the
sole published SIMD shaper measures 1,224,539 raw / 447,121 gzip / 353,986 Brotli bytes; the Three adapter plus that
core measures 1,466,450 / 485,864 / 385,930 bytes. Optional Three, React, and React Three Fiber peers remain excluded.
Browser-core JavaScript stays effectively flat against the preceding record and the Three adapter shrinks, while the
shaper accounts for the net compressed growth. The complete MTSDF baker is again 552,025 raw / 215,030 gzip / 168,758
Brotli bytes after separating its 60,993-byte kernel-only Cargo target, and build-time ABI guards now prevent a partial
test module from being published as a baker.
