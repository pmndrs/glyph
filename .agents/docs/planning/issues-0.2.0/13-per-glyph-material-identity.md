---
type: Issue Record
title: 'Issue 13: no per-glyph identity or per-instance input in the material context'
description: 'Design question: per-letter animation must split() and drive matrices because a TextMaterial sees no glyph index, and paragraphPosition is a split-time snapshot for detached glyphs.'
status: draft
sources:
  - id: material
    resource: ../../../../packages/glyph/src/three/material.ts
    title: Three material context
  - id: realizer
    resource: ../../../../packages/glyph/src/three/internal/material-realizer.ts
    title: Material realization
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 13: no per-glyph identity or per-instance input in the material context

- **Severity:** later (design; public API addition needs Justin's approval)
- **Status:** approved (Justin, 2026-11-24): add `glyphIndex` and the glyph's origin to the material context. The index is the linear layout order, not an identity; `split()` is how identity is frozen. Implemented 2026-11-24 on `experiments/sil-glyphindex` as opt-in glyph facts (see [the log](../../log/2026-11-25-glyph-material-glyph-facts.md))

## What happens

The hero animates letters individually. A `defineTextMaterial` factory receives `{ root, kind, format, shader,
createDefaultMaterial, paragraphPosition, position }` (`src/three/material.ts:40-80`, realized at
`material-realizer.ts:592-597`); none of it says which glyph a fragment belongs to, so per-letter motion has to
`split()` the text and call `Glyphs.setMatrixAt` per glyph on the CPU. `paragraphPosition` is documented as the
unanchored paragraph-local position, excluding detached-glyph transforms (`material.ts:26-31`); on a split `Glyphs` it
is the position captured at split time and does not follow later edits of the source `Text` or the matrices the app
sets.

## Root cause

Not a defect: the material context was designed around paint and position, and per-instance identity stayed inside
the realizer (`#glyphTransform(instance, …)`, `material-realizer.ts:543-551`; the technique instance nodes such as
`TslMsdfInstanceNodes` are internal).

## Smallest API options

1. **One `glyphIndex: Node<'uint'>` on the material context** — the glyph's index in its paragraph's layout order (the
   same index `glyphs()` and `Glyphs.setMatrixAt` use). A shader derives per-letter phase, delay or a lookup into an
   app-owned storage buffer from it; no new objects, one field. Cost: the index must reach the vertex stage. Glyph
   records already carry the stable glyph ID and the layout order is known when instances are packed, but whether the
   published instance stream carries an ordinal today must be checked first; if it does not, it is one `u32` per
   instance in the render-plan wire, which is engine-directory work.
2. **`glyphIndex` plus a documented `paragraphPosition` contract for `Glyphs`** — state that on a `Glyphs` it is the
   split-time position (what it is), so effects keyed on it are stable while the app moves the glyphs.
3. **A per-instance user attribute API** (`instanceInput(name, type, values)`) — general, but a second buffer
   lifecycle, resizing on every edit, and a larger surface.
4. **Leave it to `split()`** and make split cheap (issue 14).

## Recommendation

Option 1 with option 2's documentation: the smallest surface that removes `split()` from per-letter animation. Index
semantics must be decided with it: layout order shifts on an insert, which suits wave/stagger effects; a stable
identity across edits would be the stable glyph ID instead. Prove with a shader-compile test on both backends and a
browser lane comparing a `glyphIndex`-driven wave against the same wave through `split()`.

## What was built

- `glyphIndex` is the index `glyphs()` reports the glyph at; `glyphOrigin` is its pen origin on the baseline. Neither
  can be derived from what an instance already carried: a draw holds only the inked glyphs of one font, so a record's
  position in its batch skips blanks and other fonts, and an instance carries its quad's corner, not its pen (Bitmap
  keeps the bearing on the CPU only). Both therefore travel in one new lane of four floats, 16 bytes per instance.
- They are opt-in per handle (`glyphFacts: true` in Three, TypeGPU and PixiJS 3D), because the codec that decides what the engine gathers is fixed when a handle is created. A handle that
  does not ask publishes the same codec bytes as before.
- No text-level glyph count reaches a shader: Three batches many texts into one draw. Normalise with a uniform set
  from `text.measure().glyphCount`.
