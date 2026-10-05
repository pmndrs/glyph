---
type: Log Entry
title: 'Technique selection and packing corrections'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The first built-in portable-technique implementation pass found two missing inputs. `writeStorage()` could not produce renderer-ready origins or resource-relative values because it omitted both paragraph-local displayed glyph origins and the binding core had already selected for the physical batch. `select()` also could not represent shaped whitespace and other intentionally absent raster records without allocating invalid instances. Added `originX` / `originY`, the exact selected binding, and an explicit `undefined` no-instance result. This preserves the original ownership boundary—core still lays out, applies origin overrides, resolves fallback, and partitions once; techniques only select and pack the supplied candidate.
