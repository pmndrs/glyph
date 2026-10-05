---
type: Log Entry
title: 'Owned MTSDF evidence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Implemented the `no_std + alloc` Rust geometry core with typed outline errors, reusable scratch, AoS-to-SoA lowering, true signed line/curve distances, contour-aware overlap resolution, and nonzero-fill sign correction. All seven native-msdfgen oracle cases now have zero coverage mismatches and 0.472–0.549-byte mean alpha error. The optimized no-import admission module is 42,607 bytes (18,318 gzip; 15,333 Brotli); 2,915 Inter glyphs are cold/warm checksum-stable, and the 40.173-second scalar median establishes the optimization baseline. A deterministic 1,000-run cargo-fuzz smoke completes without a crash.
