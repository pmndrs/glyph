---
type: Log Entry
title: 'Core API surface (D-249)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The renderer-neutral engine publishes as `@pmndrs/glyph/core` and the technique
shader library as `@pmndrs/glyph/tsl`. Three's first-party policy and the Slug shader tree leave core internals,
and a scoped import lint holds the first-party integrations to the same public surface a third party gets.
Behavior is unchanged; subpath type tests pin both surfaces.
