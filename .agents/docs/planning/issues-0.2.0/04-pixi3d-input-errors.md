---
type: Issue Record
title: 'Issue 04: Pixi3DText throws TypeError/RangeError where other renderers throw GlyphInputError'
description: 'Pixi3DText construction and update never wrap caller-input validation, so the same invalid input is a GlyphInputError on Three and TypeGPU and a bare TypeError or RangeError on PixiJS 3D.'
status: draft
sources:
  - id: pixi3d-text
    resource: ../../../../packages/glyph/src/pixi3d/text.ts
    title: Pixi3DText
  - id: glyph-error
    resource: ../../../../packages/glyph/src/glyph-error.ts
    title: GlyphInputError and validatingInput
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 04: `Pixi3DText` throws `TypeError`/`RangeError` instead of `GlyphInputError`

- **Severity:** should-fix (documented error contract; `instanceof GlyphInputError` handling breaks on one renderer)
- **Status:** fixed — construction and `update()` wrap caller-input validation in `GlyphInputError`; the Pixi3D editing test checks each path

## What happens

```ts
handle.createText({ font, text: 7 }); // TypeError, not GlyphInputError
handle.createText({ font, text: 'a', style: { fontSize: NaN } }); // RangeError
text.update({ style: { fontSize: -1 } }); // RangeError
text.update(7); // TypeError
```

Reproduced against the built package; the same calls on a Three `Text` or a TypeGPU text throw `GlyphInputError`
(`code: 'invalid-input'`, `path` naming the property, `cause` the validator error). Found by the docs site.

## Root cause

`src/pixi3d/text.ts` never imports `src/glyph-error.ts`. Its own checks throw bare errors (`:195`, `:197`, `:415`,
`:424`, `:428`), and the shared validators it reaches through `services.createText` (`:101`) and
`this.#controller.update` (`:202`) throw their `TypeError`/`RangeError` unwrapped. Three wraps the same work with
`validatingInput([], () => normalizeDesired(...))` (`src/three/text.ts:1416`) and rethrows update failures through
`glyphInputError(path, error)` (`:1504-1510`); TypeGPU does the same (`src/typegpu/text.ts:89-107`, `:404-407`).

## Options considered

1. Wrap construction and update in `validatingInput`/`glyphInputError`, mirroring Three (path `[]` for the whole
   options object, the single updated key when one key changed, `['text']` and `['material']` for those checks).
2. Throw `GlyphInputError` directly at each Pixi3D check: still misses the shared validators' errors.

## Chosen fix

Option 1: the same two helpers at the two entry points, so every caller-input failure is a `GlyphInputError` whose
`cause` is the original error. Non-input errors (a disposed handle, an engine failure) pass through unchanged, because
`glyphInputError` converts only `TypeError`/`RangeError`.

## Test that will prove it

`tests/integration/failure-inventory.test.mjs` (or `tests/package/pixi3d-editing.test.mjs`): the four calls above
throw `GlyphInputError` with the paths Three reports for the same input.

## Risk

Behaviour: the thrown class changes from `TypeError`/`RangeError` to `GlyphInputError` (which is an `Error`; callers
catching by message or by `TypeError` on Pixi3D change). API: none. Performance/size: one closure per construction
and update.
