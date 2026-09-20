---
type: Workspace Package
title: '@pmndrs/glyph-juggler'
description: A stick figure with superhuman speed juggles the glyphs you type, proven by a pure simulation test.
resource: ../../../apps/juggler
workspace_package: '@pmndrs/glyph-juggler'
documentation_type: reference
source_digest: 'sha256:e9a047d70df4f82c208081d355eaf96267b3782aa97fa8f49d8bc27268ef48c8'
tags: [package, example, react, react-three-fiber, simulation, vite]
sources:
  - id: manifest
    resource: ../../../apps/juggler/package.json
    title: Example application manifest
  - id: simulation
    resource: ../../../apps/juggler/src/juggler.ts
    title: Pure juggling simulation with the always-catches guarantee
  - id: proof
    resource: ../../../apps/juggler/src/juggler.test.ts
    title: Deterministic proof that no letter passes the hands
  - id: scene
    resource: ../../../apps/juggler/src/app.tsx
    title: R3F scene with batched letter Text nodes and an inverse-kinematics stick figure
generated:
  by: anthropic/claude-fable-5-1
  at: '2026-09-20T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-juggler`

This private Vite package is a small React Three Fiber example. Each typed key adds one glyph to a row at the top of
the view. The row releases one letter at a time; each falls under gravity, and a stick figure runs under it, catches
it, and tosses it to the other hand. Backspace removes the newest letter, taking from the waiting row first.

`src/juggler.ts` is a pure simulation in pixel units with no React or Three imports. The juggler always catches every
letter by construction rather than by tuning: the body chases the letter whose predicted landing is soonest, a hand
that still holds a letter tosses it the instant another arrives, and a catch places the hand exactly under the letter
so the arm stretches as far as needed. Toss flight time grows with the number of letters in play so each hand clears
its dwell, capped so the apex stays inside the view. `src/juggler.test.ts` steps a twelve-letter word and a
forty-letter burst for tens of seconds at 120 Hz and asserts that no letter is ever below the catch plane, every
letter is caught, and deletion frees the holding hand.

`src/app.tsx` renders one `Text` per letter inside a single `TextGroup`, positioned through Three groups that the
update-phase frame callback poses from the world; React re-renders only when a letter is typed or deleted. The
simulation steps in the R3F `physics` phase with the delta clamped so a background tab does not launch letters through
the floor on return. The stick figure is plain node-material meshes posed by two-bone inverse kinematics for arms and
legs, with a stride and lean driven by eased body velocity.

The checked-in Inter asset is a Basic Latin MSDF bake through the published CLI; `bake:check` verifies byte-identical
regeneration.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/glyph-juggler dev
mise exec -- pnpm --filter @pmndrs/glyph-juggler test
mise exec -- pnpm --filter @pmndrs/glyph-juggler check
```

The complete check runs typechecking, lint, formatting, the simulation tests, deterministic asset verification, and a
production build. No browser probe exists yet; the always-catches property is proven in the simulation rather than in
the rendered scene.
