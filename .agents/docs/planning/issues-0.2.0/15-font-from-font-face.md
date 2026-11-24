---
type: Issue Record
title: 'Issue 15: no public way to get a Font from a FontFace outside the hooks'
description: 'Design question: createFontStack and span(font) take Font values, but only the React and Vue hooks (and text.font) produce one from a FontFace.'
status: draft
sources:
  - id: font-face
    resource: ../../../../packages/glyph/src/font-face.ts
    title: FontFace and FontFaceSelection
  - id: handle-access
    resource: ../../../../packages/glyph/src/three/internal/handle-access.ts
    title: Three handle font access
  - id: loaded-font
    resource: ../../../../packages/glyph/src/loaded-font.ts
    title: createFontStack
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 15: no public way to get a `Font` from a `FontFace` outside the hooks

- **Severity:** later (design; public API addition needs Justin's approval)
- **Status:** planned — not implemented

## What happens

`createFontStack(primary, ...fallbacks)` (`src/loaded-font.ts:54-80`) and `span(font, …)` (`src/formatted-text.ts:116`)
require `Font` values. In React and Vue, `useFont`/`useBitmap`/… return one. In plain three.js the docs site had to
create a throwaway `Text` from a `FontFace` selection and read `text.font`. Found by the docs site.

## Root cause

A `Font` is a lease on a font loaded into one handle's engine, so it is handle-relative. The hooks reach it through
internal helpers (`acquireThreeHandleFont`, `loadThreeHandleFont`, `src/three/internal/handle-access.ts:20,41`) over
`@internal` root methods (`src/three/text.ts:581-600`) that delegate to `FontFaceHandleStore.acquire`
(`src/font-face.ts:329-407`). Nothing public exposes them.

## Smallest API options

1. **`handle.font(selection): Font`** — synchronous, throws if the selection is not loaded (`await selection.load()`
   first), returns a caller-owned lease (`dispose()`), format typed from the selection. One method on each integration
   handle, thin over the existing `acquireFont`.
2. **Accept `FontFaceSelection` wherever a `Font` is accepted** (`createFontStack`, `span`), resolved when a text binds
   to a handle, as `createText` already does for `font`. No new name, but two signatures widen and stack resolution
   moves into binding, including the error for a selection not loaded on that handle.
3. **Export the Three helpers from `/three`** (and equivalents per renderer): least design, renderer-specific, two
   names per integration.

## Recommendation

Option 2 if Justin prefers no new names: it matches how `createText` already takes selections and keeps leases
internal. Otherwise option 1, which is one method with an explicit lease and is what the hooks already do. Either is
proved through `tests/integration/font-face-handle.test.mjs` (a stack built from selections shapes like one built from
hook fonts) and `tests/types/three-v1-api.test.ts`.
