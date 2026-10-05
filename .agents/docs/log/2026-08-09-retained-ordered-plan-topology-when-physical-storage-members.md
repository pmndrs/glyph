---
type: Log Entry
title: 'Retained ordered-plan topology when physical storage membership stayed invariant'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The ordered-direct compiler now
reuses committed glyph-to-batch and glyph-to-slot mappings under the exact policy fingerprint and capability set. It
still validates every glyph and stable identity, and any physical storage-key mismatch returns to complete batch
discovery; a material-partition regression proves both paths. Three consecutive optimized 101-update runs measure
1.164/5.761, 1.153/5.740, and 1.155/5.738 ms median/p95 with five roughly 1.2 KiB patches. The preceding checkpoint
measured 1.314/5.863 ms. Optimized Wasm grows 4,189 bytes to 1,157,311, and retained high-water memory falls from
80.19 to 79.81 MiB. The fast class is now near 1 ms, while 81.4–81.6% RSD and the roughly 5.74 ms p95 keep the
break-sensitive tail open.
