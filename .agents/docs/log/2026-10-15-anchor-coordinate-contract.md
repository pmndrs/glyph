---
type: Log Entry
title: 'Clarify anchored glyph coordinate spaces and split replacement'
generated:
  by: process:docs-new
  at: '2026-10-15T12:19:48Z'
---

The [Three query reference](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs) now names raw
paragraph, anchored Text-local logical/native, detached Glyphs-local and world coordinates separately. It explains that
`anchorOffset` is already included in native Text-local placement queries, is captured by a split container's transform,
and must not be added again to detached glyph matrices. Public JSDoc now identifies the measured owner rather than
calling every measurement Text-local. Immutable detached measurements record original geometry, not live animated
per-glyph transforms.

Corrected an obsolete sentence that claimed caret/selection queries used accepted layout. The implementation and
existing desired-layout contract query pending desired text; rejected draws retain accepted geometry/anchor. A caller
swapping currently visible text must first observe committed state. No API, runtime statement or renderer behavior
changed; the [Glyph concept](../packages/glyph.md#semantic-queries) records the distinction.

A real public-API regression compares every glyph's complete source and split world matrix beneath rotated,
nonuniformly scaled ancestors and a separately transformed Text. It covers default and explicit anchors in direct and
indexed modes, checks detached measured origins in world space, and changes source text/anchor afterward to prove the
snapshot is independent. The focused anchor suite passes 34 tests and all package/integration suites pass 1,015 tests.
