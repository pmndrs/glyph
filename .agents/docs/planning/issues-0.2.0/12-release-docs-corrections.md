---
type: Issue Record
title: 'Issue 12: release docs state removed or wrong behaviour'
description: 'MIGRATION-0.2.md says culling is manual, the migration concept lists text.error on TypeGPU text as new, and the visible overflow default is undocumented.'
status: draft
sources:
  - id: package-migration
    resource: ../../../../packages/glyph/MIGRATION-0.2.md
    title: Package migration guide
  - id: migration
    resource: ../migration-from-0.1.0.md
    title: Migrating from 0.1.0
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 12: release docs state removed or wrong behaviour

- **Severity:** ship-blocker (the shipped migration guide contradicts the shipped behaviour)
- **Status:** fixed — MIGRATION-0.2.md describes default frustum culling, the stale `text.error` item is gone, and `ParagraphLayout.overflow` has TSDoc and a package-concept note measured against the build

## What happens and root cause

1. `packages/glyph/MIGRATION-0.2.md:110-111` says "Visibility culling is manual in 0.2 … Automatic off-screen group
   culling is not shipped." Frustum culling has since shipped on by default for every built-in draw
   (`.agents/docs/planning/migration-from-0.1.0.md:129-131`, `benchmark:frustum-culling`). The package guide was not
   updated with it.
2. `.agents/docs/planning/migration-from-0.1.0.md:124` lists "`text.error` on TypeGPU text" as new surface. Per-text
   error reads were removed (`log/2026-11-24-remove-per-text-error-reads.md`; the same file's line 83 says so), so the
   line contradicts its own section 3.
3. `ParagraphLayout.overflow` has no documentation, and the finding's description of it was inverted. Measured on
   the built package (Inter bitmap 16, 400 characters, `width: 200`, `height: 60`, `wrap: 'word'`):

   | `overflow`   | plain paragraph                      | `columns: { count: 2 }`                                                     |
   | ------------ | ------------------------------------ | --------------------------------------------------------------------------- |
   | `'visible'`  | 3 lines, 60 glyphs; the rest dropped | 6 lines, 60 glyphs; the rest dropped                                        |
   | `'clip'`     | all 20 lines, the last at y ≈ 383    | all 40 lines; the overflow runs on below the second column's foot (y ≈ 712) |
   | `'ellipsis'` | 3 lines, the last ending in `…`      | 6 lines                                                                     |

   `measure().overflowed` is `true` in every case. So it is `'clip'` (which the hero used) that stacks the overflow at
   the last column's foot, and because no renderer clips (issue 01) those lines are drawn. The naming mismatch itself
   is issue 16.

## Chosen fix

Correct the culling paragraph to describe default frustum culling and its opt-out; delete the stale `text.error`
item; add TSDoc to `ParagraphLayout.overflow` stating what each value does today (above), and the same note in
`.agents/docs/packages/glyph.md`.

## Test that will prove it

Docs only: `pnpm check` (OKF validation and formatting); the TSDoc is checked by the declaration build.

## Risk

None to behaviour or API.
