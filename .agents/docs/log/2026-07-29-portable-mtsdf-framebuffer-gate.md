---
type: Log Entry
title: 'Portable MTSDF framebuffer gate'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the headless conformance lane after it compared Playwright SwiftShader pixels with a hash captured through Apple Metal. Both paths were Chromium 149 on the same host, but filtered analytic coverage was not byte-identical. MTSDF scenes now require within-renderer determinism and exact structural/resource invariants, while the companion scalar reconstruction owns reviewed pixel-error limits. The three-sample SwiftShader comparison passes at `0.0957/255` mean error, maximum error `10`, and 3,233 threshold pixels; hardware hashes remain observations rather than portable goldens.
