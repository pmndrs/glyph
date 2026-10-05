---
type: Log Entry
title: "Aligned React font loading with R3F's cache and nested Text API"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Generic `useFont` now accepts a technique directly,
while `useBitmapFont`, `useMSDF`, and `useSlug` are typed wrappers with matching preload and clear methods. R3F remains
the sole promise/result cache; Glyph owns only abort and font-lease disposal. Nested `Text` authors inline runs, and its
call-time boundary rejects box properties that JSX cannot reliably exclude statically.
