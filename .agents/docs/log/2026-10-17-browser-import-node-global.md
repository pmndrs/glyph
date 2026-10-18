---
type: Log Entry
title: 'Guard browser ESM imports from Node globals'
generated:
  by: process:docs-new
  at: '2026-10-17T21:05:58Z'
---

[Issue #217](https://github.com/pmndrs/glyph/issues/217) reported that published `dist/internal/dev.js` evaluates `process.env.NODE_ENV` during a direct browser import and throws when `process` is absent. The [Glyph package](../packages/glyph.md) now guards the Node global while keeping the literal environment comparison that production bundlers replace; untransformed browser modules without `process` leave the private diagnostics gate off. Vite's development-server `hot` marker and `NODE_ENV` replacement retain diagnostics even with a custom mode; library builds without that marker keep process-free imports safe. The production `DEV` value removes diagnostics in the measured package graph, while literal comparisons at the two guarded teardown call sites let generic production defines strip the messages. Package tests import the emitted root in a fresh process without `process`, check Node's development and production modes, and bundle the emitted diagnostics module with esbuild's standard production and browser development defines. The [benchmark package](../packages/benchmarks.md) additionally imports the exact packed diagnostics module as untransformed native ESM in Chromium with no `process` global. The package and benchmark checks exercise the real emitted and packed surfaces. No public API or artifact contract changed.
