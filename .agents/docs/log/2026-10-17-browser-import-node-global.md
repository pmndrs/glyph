---
type: Log Entry
title: 'Guard browser ESM imports from Node globals'
generated:
  by: process:docs-new
  at: '2026-10-17T21:05:58Z'
---

[Issue #217](https://github.com/pmndrs/glyph/issues/217) reported that published `dist/internal/dev.js` evaluates `process.env.NODE_ENV` during a direct browser import and throws when `process` is absent. The [Glyph package](../packages/glyph.md) now guards the Node global while keeping the literal environment comparison that production bundlers replace; direct browser modules without `process` leave the private diagnostics gate off. A package test imports the emitted root in a fresh process without `process`, checks Node's development and production modes, and bundles the emitted diagnostics module with esbuild's standard production `NODE_ENV` define to prove the browser output folds to false. The [benchmark package](../packages/benchmarks.md) additionally imports the exact packed diagnostics module as untransformed native ESM in Chromium with no `process` global. The package and benchmark checks exercise the real emitted and packed surfaces. No public API or artifact contract changed.
