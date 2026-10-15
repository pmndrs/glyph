---
type: Log Entry
title: 'Keep anchors with accepted inherited presentation'
generated:
  by: process:docs-new
  at: '2026-10-15T05:43:28Z'
---

Three's host-only anchor shortcut now requires the last accepted effective presentation, paragraph order and scoped
rank to match the candidate, with no material invalidation or renderer rejection. Root and TextGroup material changes
can occur without advancing a Text's desired revision, so desired revision equality alone did not establish acceptance.
A query could also stage a new presentation and clear transient invalidation before the renderer tried it. Accepted
presentation/order metadata is now retained separately from staged metadata; no per-glyph state or public API changes.
See the [Three placement contract](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs).

Twelve regressions exercise root/group material rejection before a same-frame anchor edit, after an already rejected
publication, and after an inspection query stages presentation. Both direct matrices and indexed GPU transform storage
retain the accepted anchor. Two additional cases keep changed inherited draw order with a genuinely rejected material
candidate. All fourteen fail against the prior PR implementation. Recovery accepts the new anchor/order together, and
live group translation continues to move the retained branch using its accepted anchor during rejection. Pure draw-order
changes reuse their material and are not claimed to provoke material rejection.

The final owning Glyph check passes 1,010 package/integration tests, plus Rust, fuzz, source/emitted consumer types,
lint, formatting and Clippy. The owning-built anchor suite passes all 29 tests, and independent focused review of the
combined Three, ABI compatibility and drop-cap corrections passes 41 tests. No baseline or fixture was regenerated to
make the anchor assertions pass.
