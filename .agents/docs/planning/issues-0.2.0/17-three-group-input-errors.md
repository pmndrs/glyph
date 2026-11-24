---
type: Issue Record
title: 'Issue 17: Three TextGroup options and Text.onLayout throw raw TypeError/RangeError'
description: 'Found while reproducing 07: TextGroup batching, renderOrder and pixelSnapping, and the Text onLayout setter, validate caller input without the GlyphInputError wrapper the Text property setters use.'
status: draft
sources:
  - id: three-text
    resource: ../../../../packages/glyph/src/three/text.ts
    title: Three Text and TextGroup
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 17: Three `TextGroup` options and `Text.onLayout` throw raw `TypeError`/`RangeError`

- **Severity:** later
- **Status:** planned — not fixed in this lane

## What happens

`group.batching = 'none'` throws `TypeError: TextGroup batching must be "auto", "shared", or "group"`; so do invalid
`createTextGroup` options (`renderOrder`, `pixelSnapping`) and `text.onLayout = 7`. The Text property setters wrap the
same kind of error in `GlyphInputError` with a `path`.

## Root cause

`src/three/text.ts:1849-1857` (TextGroup construction), `:1877-1879` (`batching` setter via
`normalizeTextGroupBatching`, `:3022-3025`) and `:1390` (`onLayout`) throw directly; only `Text` construction and
`#applyUpdate` go through `validatingInput`/`glyphInputError`. The documented setter contract
(`api-summary-for-review.md`, "Setters") names `Text` setters, so `TextGroup` is outside it rather than in breach.

## Chosen fix (planned)

Wrap `TextGroup` construction in `validatingInput([], …)` and each validating setter in `validatingInput([name], …)`,
the same as issue 04, and widen the documented contract to "every Glyph object's setters". Held for Justin because it
widens a documented contract across every integration's group type; it is mechanical once agreed.

## Risk

Thrown class changes for invalid group options; no API change.
