---
type: Log Entry
title: 'MTSDF runtime foundation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Began roadmap item 8.3 with the optional fixed runtime module over one instanced batch family and one version-matched TSL graph. Strict in-module decoding checks identity, constants, dense records, lossless RGBA8 KTX2, and bounded mip residency before resource publication. RGB median reconstruction supplies fill; the true-distance alpha channel supplies four-atlas-pixel-bounded outline and translated hard shadow. Bitmap and MTSDF now share atlas decoding, record validation, quad construction, and paint/layout invariants. Canonical Inter decodes all ten real pages and exercises batch creation, repaint, and disposal without runtime baker Wasm.
