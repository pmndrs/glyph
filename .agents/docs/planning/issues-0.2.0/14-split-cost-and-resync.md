---
type: Issue Record
title: 'Issue 14: split() is tens of milliseconds for thousands of glyphs and cannot be re-synced'
description: 'Design question: Text.split() copies the committed layout into an independent Glyphs per call, about 30-80 ms for 8,100 glyphs in Node; after an edit the copy must be disposed and split again.'
status: draft
sources:
  - id: three-text
    resource: ../../../../packages/glyph/src/three/text.ts
    title: Text.split
  - id: glyphs
    resource: ../../../../packages/glyph/src/three/glyphs.ts
    title: Glyphs
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 14: `split()` is tens of milliseconds for thousands of glyphs and cannot be re-synced

- **Severity:** later (design; performance work first, API only with Justin's approval)
- **Status:** decided (Justin, 2026-11-24): no re-sync API; `split()` stays the freeze tool. Cost reduction without API remains open

## What happens

The hero splits about 6,500 glyphs and measured ~100 ms per `split()` in the browser, redone after every insert.
Measured here on the built package in Node (bitmap Inter 16, 8,100 glyphs): 79 ms on the first call, 31-46 ms warm.
`glyphs()` on the same text takes 0.1 ms, so the cost is the copy, not the layout read.

## Root cause

By design `split()` (`src/three/text.ts:1613-1667`) builds an independent `Glyphs`: it copies the layout inspection
columns, captures outlines, allocates a per-glyph matrix table and a `StorageInstancedBufferAttribute`, and creates its
own draws and materials through `services.copy` (`:2342-2352`). No shaping repeats. A `Glyphs` is a snapshot with a
token-gated constructor (`glyphs.ts:138`) and no update path, so an edit means `dispose()` + `split()` and re-applying
every matrix.

## Smallest options

1. **Make split cheaper without API.** Profile first (the warm/cold gap suggests allocation and program creation),
   then cut what dominates: share programs and materials with the source text's realized draws, allocate the matrix
   table lazily, and skip outline capture unless `outlineAt` is called.
2. **`Glyphs.sync()`** (re-copy from the source `Text`, keeping the matrices of glyphs whose stable ID survives). One
   method; needs a defined answer for removed and inserted glyphs and keeps the `Glyphs` tied to its source.
3. **Issue 13 option 1** removes the need to split for per-letter animation.

## Recommendation

Option 3 (issue 13) first, then option 1 with a benchmark row (`split()` at 1k/8k glyphs, cold and warm) added to the
Labs suite; add `sync()` only if a use case remains that needs CPU-side per-glyph matrices after edits.
