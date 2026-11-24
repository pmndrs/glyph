---
type: Issue Record
title: 'Issue 06: order on Three text properties is typed but never read'
description: 'Three TextProperties inherit ParagraphBaseProperties.order, but the adapter never copies it; Three paint order comes from scene traversal and renderOrder.'
status: draft
sources:
  - id: three-text
    resource: ../../../../packages/glyph/src/three/text.ts
    title: Three Text
  - id: text-properties
    resource: ../../../../packages/glyph/src/text-properties.ts
    title: ParagraphBaseProperties
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 06: `order` on Three text properties is typed but never read

- **Severity:** should-fix (a typed option that silently does nothing)
- **Status:** fixed — Three `TextProperties` omit `order`; the type test expects an error for it

## What happens

`root.createText({ font, text, order: 5 })` and `text.set({ order: 5 })` type-check and change nothing. React and Vue
`Text` props inherit the same field. Found by the docs site.

## Root cause

`src/three/text.ts:92` builds `TextBaseProperties` as `Omit<ParagraphBaseProperties<Format>, 'font'> & …`, so
`order` (`src/text-properties.ts:186`, no TSDoc) is accepted. `DesiredTextState` has no `order`, `normalizeDesired`
never reads it, and `coreTextState` passes the scene-traversal index as the core `order`
(`updateParagraphOrder(order, …)`, `text.ts:2074-2101`). Three's paint order is the scene graph plus `renderOrder` on
the `Text` or its `TextGroup`; an authored `order` has no meaning there. TypeGPU and PixiJS 3D options do not declare
`order`.

## Options considered

1. **Remove `order` from Three's property types** (`Omit<…, 'font' | 'order'>`), and give
   `ParagraphBaseProperties.order` TSDoc saying it is the integration-assigned paint order.
2. **Thread `order` through to the core.** Conflicts with traversal-derived order and gives Three two order
   mechanisms; no use case asks for it.

## Chosen fix

Option 1: the smallest surface. Three, R3F and Vue stop accepting a property they never read.

## Test that will prove it

`tests/types/three-v1-api.test.ts`: `// @ts-expect-error` on `createText({ …, order: 1 })` and `text.set({ order: 1 })`.

## Risk

API: a TypeScript caller passing `order` gets a compile error (the value never had an effect); runtime unchanged.
Recorded in the migration notes.
