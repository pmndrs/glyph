---
type: Log Entry
title: 'Target-owned raster conformance captures'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved finite MTSDF and Slug resource creation, standard/source-outline capture, CPU comparison, borrowed-renderer state restoration, and disposal from live renderer modules into `benchmark/targets/conformance/raster`. Both techniques now implement the same warm session contract directly; Slug's external-resource, large/extreme/complex/clipped, affine, and projection-zoom proofs moved with the shared finite resource graph. Conformance surfaces, runtime fallback, and URL-loaded probes import the target modules directly. The complete 314-test benchmark gate and production build passed, all 19 isolated browser scenarios remained deterministic, retained comparison capture/navigation recovery passed on WebGPU and forced WebGL2, and both complete Slug role and external-resource probes passed on both backends.
