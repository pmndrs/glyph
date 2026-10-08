---
type: Log Entry
title: 'Stopped publishing dangling source map references'
generated:
  by: process:docs-new
  at: '2026-10-05T19:16:13Z'
---

The package excludes `dist/**/*.map`, but the emitted modules still carried `sourceMappingURL` comments, so consumers
serving the package unbundled logged a warning per module. The build now emits hidden source maps; the map files stay
available locally. See [the package reference](../packages/glyph.md).
