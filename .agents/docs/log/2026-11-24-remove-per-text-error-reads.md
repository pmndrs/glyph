---
type: Log Entry
title: 'Per-text error reads removed; thrown messages quote the text'
generated:
  by: process:docs-new
  at: '2026-11-24T03:20:05Z'
---

Removed `Text.error`, `TextGroup.error`, the `failed` status of `commitState()`, `TypeGpuText.error` and
`Pixi3DText.error`, with the Three attributed-error bookkeeping that served them (Justin, 2026-11-23: failures throw,
and nobody walks every text to find which one failed). The
[render-time failure decision](../planning/decisions/render-time-errors-throw.md) is amended. The thrown value now
names the text: a refusal is a `GlyphError` (`engine-failed`) quoting the first 40 UTF-16 units of the text and the
cause, a result-arena overflow names the text it withholds, an `onLayout` exception is rethrown quoting its text with
the original as `cause`, and a fixed capacity names its root. A refused text's `commitState()` is `pending`. Benches
and apps that read the removed members now end headless frames with `endFrame(scene)` so the frame's failure throws.
See [glyph](../packages/glyph.md) and the [migration guide](../planning/migration-from-0.1.0.md).
