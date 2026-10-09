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
off-screen culling remains deferred. The initial source pass deliberately ran no validation. The serialized lane then
rebased the change onto `b6ba9947`, built the package with the pinned toolchain, and passed the named focused
`glyph:node-tests` workflow over all 86 `three-v1` tests, including both 1,000-label modes and the retained #280 sparse
assignment cases. Touched-file Oxfmt and Oxlint checks also passed; no Labs, server, or broad repository gate ran. See
the [Glyph package contract](../packages/glyph.md).
