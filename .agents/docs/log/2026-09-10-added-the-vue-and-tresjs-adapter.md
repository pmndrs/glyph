---
type: Log Entry
title: 'Added the Vue and TresJS adapter'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`@pmndrs/glyph/vue` publishes `GlyphProvider`, `Text`, `TextGroup`, and
`useFont` with typed `useBitmap`/`useMsdf`/`useSlug` leaves. The adapter reconciles the same retained Three objects
through the TresJS custom renderer with private catalogue names, stable constructor args, keyed remounts, one
default root per canvas, and reactive font readiness instead of render-phase suspension. Shared desired-snapshot
comparison moved into an internal module used by both React and Vue. A happy-dom TresCanvas host proves lease
balance under Tres disposal; a new `apps/tres-playground` Vite application renders every raster format.
