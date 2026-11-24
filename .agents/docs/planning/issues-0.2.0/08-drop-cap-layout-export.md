---
type: Issue Record
title: 'Issue 08: DropCapLayout is not exported from the root entry'
description: 'ParagraphLayout.dropCap is typed DropCapLayout, an application-encountered type, but the root entry does not export it.'
status: draft
sources:
  - id: index
    resource: ../../../../packages/glyph/src/index.ts
    title: Root entry
  - id: boundaries
    resource: ../../../../packages/glyph/tests/package/entry-point-boundaries.test.mjs
    title: Entry-point boundary test
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 08: `DropCapLayout` is not exported from the root entry

- **Severity:** should-fix (an application cannot name the type of a public field)
- **Status:** fixed — `DropCapLayout` is a root type export; the boundary test names it

## What happens

`import type { DropCapLayout } from '@pmndrs/glyph'` fails. No other entry exports it. Found by the docs site.

## Root cause

`DropCapLayout` is declared at `src/text-properties.ts:99` and used by `ParagraphLayout.dropCap` (`:138`);
`ParagraphLayout` is a root export (`src/index.ts:263`), but the `export type { … } from './text-properties.js'` block
(`src/index.ts:247-262`) omits `DropCapLayout`. By the engine-call contract an application-encountered type lives at
the root.

## Chosen fix

Add `DropCapLayout` to that block. The only option: the type already exists and has one home.

## Test that will prove it

`tests/package/entry-point-boundaries.test.mjs`: `DropCapLayout` in the list of types applications must name from the
root; `tests/types` imports it.

## Risk

API: one type-only root export (no runtime or size change).
