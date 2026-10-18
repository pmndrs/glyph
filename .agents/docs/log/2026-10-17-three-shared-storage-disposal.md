---
type: Log Entry
title: 'Keep shared Three storage alive when a draw retires'
generated:
  by: process:docs-new
  at: '2026-10-17T23:21:12Z'
---

Removing one of two TextGroups under the same root on Three r186 (`second.removeFromParent()`) made every following
frame fail WebGPU validation with `[Buffer (unlabeled)] used in submit while destroyed`, and the canvas kept showing the
removed label. Three's geometry disposal handler changed in r186: r185 destroyed only the attributes a shader reads as
vertex input, while r186 destroys every attribute on the geometry. Each Three draw geometry also carries the root's
shared Codec buffers, transform table, and detached glyph storage by attribute name, so retiring the removed group's draw
destroyed GPU buffers the surviving draw's existing bind group still referenced. Three recreates a deleted attribute on
its next upload but does not rebuild a bind group whose attribute object is unchanged.

The [retained frame transaction](../packages/glyph.md#retained-frame-transaction) now records the storage the draw
realizer lends to each geometry. A retired draw detaches lent storage that outlives the publication before disposing its
geometry, and keeps attached only Codec buffers and transform tables retiring in the same publication. Three's
`BufferAttribute.dispose()` releases no GPU buffer in r185 or r186, so that geometry disposal remains the release path
for retired storage. No public API, Codec, or Wasm ABI changed.

Two integration tests in `three-v1.test.mjs` record each retired geometry's attributes when its `dispose` event fires.
Removing a sibling group must leave no surviving draw's storage on the retired geometry. Growing a buffer generation
must keep the retired generation attached and must not hand the grown draw's live storage to disposal. Against the
unfixed source both fail on the live-storage assertion; with the fix both pass, as do the 176 tests in the Three
integration files.

Reproduced with the external standalone report (`@pmndrs/glyph@0.1.0-canary-4e25a96a-20261015`, `three@0.186.1`,
Vite 8.3.4) in headless Chromium through Playwright on an Apple Metal 3 WebGPU adapter: the console was clean before
the click and logged 66 validation errors in the 60 frames after it. The same page using a packed build of this change
removed the label, kept the first label rendering, and logged nothing. A growth variant (capacity 2, `grow`) showed no
error before or after the change, because growth replaces every draw and new bind groups bind recreated buffers. Three
reported the same 10 storage attributes before and after growth for both builds, so retired generations are still
released.

On `three@0.185.1`, the lower bound of the peer range, the change is inert. Neither build logged an error in either
scenario, and both reported identical Three memory counters. On removal, storage stayed at 10 attributes and vertex
attributes fell from 5 to 3. On growth, storage rose from 10 to 18 attributes, because r185 destroys no retired storage
generation with or without this change.

The complete owning Glyph check passes, including 1,028 package and integration tests, the fuzz and font-baker lanes,
Rust tests, emitted declarations, lint, formatting, and Clippy.
