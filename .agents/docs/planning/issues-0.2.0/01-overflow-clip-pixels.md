---
type: Issue Record
title: "Issue 01: overflow 'clip' does not clip pixels in the Three renderer"
description: "ParagraphLayout.overflow 'clip' only tags lines with an opaque clip identity; no clip rectangle reaches any renderer, so overflowing glyphs are drawn."
status: draft
sources:
  - id: text-properties
    resource: ../../../../packages/glyph/src/text-properties.ts
    title: ParagraphLayout.overflow
  - id: draw-realizer
    resource: ../../../../packages/glyph/src/three/internal/draw-realizer.ts
    title: Three draw realization
  - id: command-tree
    resource: ../../../../packages/glyph/src/internal/typed-command-tree.ts
    title: Typed command tree clip identities
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 01: `overflow: 'clip'` does not clip pixels in Three

- **Severity:** should-fix (the interim TSDoc note is in 0.2.0; the pixel clip is not)
- **Status:** planned — the fix needs engine-directory work owned by another lane; interim TSDoc landed

## What happens

A paragraph with a fixed `height` and `layout: { overflow: 'clip' }` draws every line, including the ones past the
box. Found by the hero (`apps/hero` body text, `experiments/sil-hero`) and the docs site.

## Reproduction

```ts
const text = root.createText({
  font,
  text: longParagraph,
  constraints: { width: { mode: 'exact', size: 200 }, height: { mode: 'exact', size: 40 } },
  layout: { wrap: 'word', overflow: 'clip' },
});
// Render: lines below y = 40 are visible. Every built-in renderer behaves the same.
```

## Root cause

The engine marks, it does not clip, and nothing carries geometry:

- `rust/shaper/src/engine/flow_composition/build.rs:169-173` gives a band `clip_id = region.record.id` when
  `overflow == OVERFLOW_CLIP`; lines are still composed and positioned. Only `ellipsis` and `maxLines` truncate.
- The render plan carries only that id (`render_plan_wire.rs:705,719`); the region's clip rectangle
  (`configured-handle.ts:1173`, `region.clip ?? bounds`) is read into the engine and used only for an equality check
  (`flow_geometry.rs:250`).
- `src/internal/typed-command-tree.ts:392,422` interns the id as an opaque `ClipIdentity`.
- `src/three/internal/draw-realizer.ts:117` uses that identity only in the draw cache key. No material masks by it;
  TypeGPU and PixiJS 3D do not read `clip` at all.

## Options considered

1. **Document only.** Say `'clip'` marks a boundary and pixel clipping is the renderer's job. Honest but leaves a
   typed option that does nothing visible in every built-in renderer.
2. **Drop clipped lines in layout.** Wrong: a line partly inside the box must draw its visible part, and layout is
   per line, not per pixel.
3. **Publish the clip rectangle with the clip identity and mask in each renderer.** The engine emits a clip table
   (`id → [inlineStart, blockStart, inlineEnd, blockEnd]` in paragraph-local units, the same space as
   `paragraphPosition`); `ClipIdentity` carries the rectangle; because `clipId` is already part of each draw's key,
   every draw has exactly one clip, so Three adds one per-draw `vec4` uniform and multiplies opacity by
   `step(rect.xy, paragraphPosition) * step(paragraphPosition, rect.zw)`. TypeGPU and PixiJS 3D do the same in their
   fragment programs.

## Chosen fix

Option 3. A plain paragraph (no `flow`) needs a rectangle too, taken from its constraint box; whether the engine
already assigns such a paragraph a clip id through an implicit region was not established here and is the first thing
the work checks. The work starts in `rust/shaper/src/engine` (render-plan wire),
which the `experiments/sil-tiers` lane is editing, so this lane stops at the plan. In this lane:
`ParagraphLayout.overflow` gets TSDoc stating what each value does today, so the typed option is not silently
misleading (commit referencing issue 01).

## Test that will prove it

- Rust: extend `only_clip_overflow_assigns_a_clip_id_to_lines` (`engine/flow_composition.rs:1713`) to assert the
  published clip rectangle for a plain paragraph and for a flow region with an explicit `clip`.
- Three: `tests/integration/three-shader.test.mjs` — compile a clipped draw on both backends and assert the clip
  uniform reaches the fragment stage; a negative control without `'clip'` has none.
- Pixels: a browser lane rendering a clipped paragraph and counting lit pixels below the box (zero with `'clip'`,
  non-zero without).

## Risk

- Behaviour: text that relied on `'clip'` being a no-op starts clipping; that is the documented intent.
- API: none (the clip rectangle stays internal; integrators already receive `primitive.clip`).
- Performance: one uniform per draw and two `step`s per fragment; draws already split by clip.
- Size: a small wire field and shader code in each renderer.
