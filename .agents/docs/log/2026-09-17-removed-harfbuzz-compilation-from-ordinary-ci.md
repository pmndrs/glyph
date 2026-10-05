---
type: Log Entry
title: 'Removed HarfBuzz compilation from ordinary CI'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced benchmark-local Meson/Ninja setup and Ubuntu GLib
installation with authenticated Git LFS bundles for HarfBuzz 13.0.0 and 14.2.0. CI now provisions both versions
through the indexed root pnpm workflow, verifies their manifests and executables, and exposes only 14.2.0 on `PATH`.
