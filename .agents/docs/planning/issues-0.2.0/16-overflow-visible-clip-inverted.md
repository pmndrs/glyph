---
type: Issue Record
title: 'Issue 16: overflow visible drops lines past the box while clip lays them all out'
description: 'Found while reproducing 01 and 12: with a fixed height, overflow visible keeps only the lines that fit, and clip composes every line past the box, the opposite of what the names say.'
status: draft
sources:
  - id: text-properties
    resource: ../../../../packages/glyph/src/text-properties.ts
    title: ParagraphLayout.overflow
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 16: `overflow: 'visible'` drops lines past the box while `'clip'` lays them all out

- **Severity:** should-fix (decide before 0.2.0 whether to keep the names; behaviour change is engine work)
- **Status:** planned — engine-directory work; TSDoc documents today's behaviour (issue 12)

## What happens

Measured on the built package (Inter bitmap 16, 400 characters, `width: 200`, `height: 60`, `wrap: 'word'`):
`'visible'` lays out 3 lines (60 glyphs) and drops the rest; `'clip'` lays out all 20 lines, the last at y ≈ 383, and
with two columns runs the overflow on below the second column's foot (y ≈ 712); `'ellipsis'` lays out 3 lines ending
in `…`. `measure().overflowed` is `true` in all three. In CSS terms `'visible'` behaves like a clip that drops whole
lines, and `'clip'` behaves like `visible` (and, with no renderer clipping, issue 01, draws like it).

## Root cause

`rust/shaper/src/engine/flow_composition/build.rs:169-173`: under `'clip'` the composer keeps composing bands into the
last region with a clip id; under `'visible'` it stops when the regions are full. Nothing in the decision register
(D-216 says only that visible overflow carries clip id zero) states which lines `'visible'` keeps.

## Options

1. **Keep the engine, rename nothing, document it** (done in issue 12's TSDoc). Cheapest; the names stay misleading.
2. **Make `'visible'` compose every line (CSS `visible`) and make `'clip'` keep every line but clip pixels (issue 01).**
   Then "fit the box, drop the rest" is `maxLines`/`'ellipsis'` or a new value. Changes measured output for every
   fixed-height paragraph using the default, which moves layout oracles.
3. **Make `'clip'` stop at the box like `'visible'` does** and keep pixel clipping for partly visible lines. Smaller
   change; leaves `'visible'` misnamed.

## Recommendation

Option 2 with issue 01, decided by Justin because it changes default layout output and oracle references; this lane
stops at the plan (engine directory, oracle changes).
