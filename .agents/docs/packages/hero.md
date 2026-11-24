---
type: Workspace Package
title: '@pmndrs/glyph-hero'
description: 'The landing-page hero, The Living Page, one continuous shot over a live editorial spread set, reflowed, edited and broken apart with Glyph on Three.js WebGPU.'
resource: ../../../apps/hero
workspace_package: '@pmndrs/glyph-hero'
documentation_type: reference
tags: [package, example, threejs, webgpu, react-three-fiber, slug, hero]
sources:
  - id: manifest
    resource: ../../../apps/hero/package.json
    title: Application manifest
  - id: policy
    resource: ../../../apps/hero/AGENTS.md
    title: Hero code policies
  - id: script
    resource: ../../../apps/hero/src/director/actions.ts
    title: The attract loop's script and the visitor's commands
  - id: page
    resource: ../../../apps/hero/src/page/systems.ts
    title: Flow, layout read and per-letter springs
  - id: capture
    resource: ../../../apps/hero/scripts/capture.mts
    title: Stepped capture and GPU frame times
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-24T08:30:00Z'
---

# Package reference: `@pmndrs/glyph-hero`

This Vite application is the landing-page hero. It uses only public exports of `@pmndrs/glyph` (`/react`, `/three`,
the root), React Three Fiber's WebGPU entry, Koota for state, `math`, `crashcat` for rigid bodies and `@pmndrs/klipp`
(core entry only) for virtual cameras. Its code policies are in `apps/hero/AGENTS.md`: one Koota world, a module per
domain, simulation that runs without React.

The piece is an attract loop of about a minute that hands over to the visitor on any input and resumes after 32 idle
seconds. The beats are declared as cues in `director/actions.ts`: a headline typed at a caret that lights the page, a
crane back to the spread, the gutters pulled from three columns to two, four and back, a black hole led through the
text, the rewind, a caret placed and typed at in the essay and then inside an Arabic word, and a dive through the drop
cap's counter that cuts back to the caret.

## How the page uses Glyph

- The essay is one `Text` whose `flow` is restated whenever a gutter, the page's edge or the hole moves: one
  rectangle region a column, each excluding the pull quote's box and the hole's polygon. `layout.dropCap` sets the
  cap. The pull quote is set at one column's measure and read with `measure()` before the body's flow is stated, so
  the exclusion is exactly as tall as the quote.
- The essay is drawn as detached glyphs from `Text.split()`. Each frame the layout is read with `Text.glyphs()` and
  every glyph is moved toward its new place on its own spring through `Glyphs.setMatrixAt`. A glyph's identity is the
  offset of the text it was split from, kept through edits by a table of removed offsets (`page/utils.ts`).
- A letter the hole takes leaves the text by `Text.replace(offset, offset + 1, '')` and becomes a rigid body whose
  convex pieces come from `Glyphs.outlineAt` (`physics/utils.ts`). The rewind returns each character with another
  `replace` and carries its glyph to wherever the layout then puts it.
- Clicks go through `hitTest`, the caret's rectangle and its second place at a bidi boundary through `caret`, arrow
  keys through `move`, and typing through `replace`. While a caret is in the essay the paragraph is drawn whole, and
  it is split again when something next moves it.
- Every text uses a `defineTextMaterial` factory. The body's ripple reads `paragraphPosition`; lighting reads
  `position` through the model matrix. The headline evaluates `shader.coverageAt` five times a fragment: once for
  the letter and four times a bevel's width to each side, which gives the wet-ink spread and the glass bevel's normal.

## Tiers, motion and the frame budget

`quality/content.ts` holds what each tier draws with. `full` uses four samples, depth of field and physical
transmission in the headline; `lite` uses none of them, a lower pixel ratio and fewer bodies, and is chosen at load
for a coarse pointer or a small screen, or with `?tier=lite`. The frame budget is judged on the frame interval: a
page dropping frames is drawn at a lower resolution a step at a time, and a full-tier page still late at the least
resolution moves to lite at the loop's next cut, because a tier change rebuilds the canvas. With
`prefers-reduced-motion`, or `?still`, the attract loop does not play: the finished spread is shown, cameras cut,
letters do not spring and the grain holds still.

## Workflows

`hero:bake` bakes the seven font subsets to Slug (`--check` verifies them); the serif and the display face keep
outlines. `hero:dev` serves the page. `hero:capture` steps a `?probe` page a sixtieth of a second at a time in
Chromium with WebGPU, runs a scenario of director commands (`attract`, `interact`), saves frames and a video, fails
on console errors or when the engine's text and the script's account of it disagree, and reports GPU timestamp-query
time and step time per beat; `--realtime` lets the display's clock run and reports frame intervals instead.

## Known limits

- Sound from the earlier hero is not ported.
- A touch keyboard is not raised for typing: the caret takes hardware key events only.
- The GPU time reported is the sum of a frame's pass timestamps, which on Apple GPUs can exceed the frame interval
  it was measured in. It is evidence between configurations, not an absolute.
