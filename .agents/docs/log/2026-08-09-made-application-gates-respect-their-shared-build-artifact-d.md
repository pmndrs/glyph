---
type: Log Entry
title: 'Made application gates respect their shared build artifact dependency'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Root package checks already complete before
application checks, but the benchmark app rebuilds those runtime packages as part of its standalone contract. Running
application checks concurrently let that rebuild remove `packages/glyph/dist` while the R3F example authenticated its
freshly baked assets, intermittently hiding `bitmap_baker.wasm`. Root application checks now run serially; each app's
standalone check remains unchanged, and the ordering removes the filesystem race rather than adding a retry.
