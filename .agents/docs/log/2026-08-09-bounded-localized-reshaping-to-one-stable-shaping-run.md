---
type: Log Entry
title: 'Bounded localized reshaping to one stable shaping run'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A retained UTF-16 edit whose style, script, bidi level,
direction, and fallback topology remain stable now copies unchanged shaped runs and reshapes only the affected run;
hard breaks, style boundaries, script changes, and bidi changes are therefore explicit correctness boundaries rather
than heuristic byte windows. On the production optimized SIMD Wasm and the unchanged 22,000-glyph Bitmap fixture,
complete Rust `text_update` plus render-plan publication fell from 16.223 ms to 9.372 ms median over 31 measured edits.
This checkpoint is not a budget claim: cluster construction, composition, positioning, and plan gathering still scan
globally, p95 remains 9.723 ms, and the strict eight-warmup lane still detects later Wasm memory growth.
