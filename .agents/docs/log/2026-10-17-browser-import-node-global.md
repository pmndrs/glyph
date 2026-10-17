---
type: Log Entry
title: 'Guard browser ESM imports from Node globals'
generated:
  by: process:docs-new
  at: '2026-10-17T21:05:58Z'
---

[Issue #217](https://github.com/pmndrs/glyph/issues/217) reported that published `dist/internal/dev.js` evaluates `process.env.NODE_ENV` during a direct browser import and throws when `process` is absent. The [Glyph package](../packages/glyph.md) now reads Vite's build mode when supplied, Node's environment in Node, and defaults its private diagnostics gate to development for direct browser modules without either value. A package test imports the emitted root in a fresh process without `process`, checks Node's development and production modes, and executes a Vite production bundle without `process` to keep diagnostics disabled. The [benchmark package](../packages/benchmarks.md) additionally imports the exact packed diagnostics module as untransformed native ESM in Chromium with no `process` global. The focused emitted-module test, Glyph package check, and benchmark package check pass; the packed Chromium consumer bakes and loads the canonical font artifact and retains its URL-blocking negative control. The repository check reaches the Tres playground live probe, where the slug scene reports three draws while the probe expects two; that separate live gate remains red. No public API or artifact contract changed.
