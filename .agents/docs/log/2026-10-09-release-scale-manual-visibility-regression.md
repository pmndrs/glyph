---
type: Log Entry
title: 'Added release-scale manual visibility regression'
generated:
  by: process:docs-new
  at: '2026-10-09T16:09:15Z'
---

Added a source-only 0.2 release regression over 1,000 retained Three labels in alternating automatic and explicit-group
row batches. The indexed and direct cases use the existing public `Text`/`TextGroup` API and integration
instrumentation to cover row and ancestor hide/restore after accepted publication, unrelated visible rows, zero
visibility-only Wasm updates and renderer publications, retained meshes and buffers, and edit/reflow while one row is
hidden with its current output visible after restoration. No runtime path or public API changed, and automatic
off-screen culling remains deferred. The regression, formatting, package checks, documentation attestation, and broader
validation were deliberately not run in this source pass. See the [Glyph package contract](../packages/glyph.md).
