---
type: Workspace Package
title: '@pmndrs/glyph-juggler'
description: A superhuman stick figure juggles the letters of a shaped, kerned sentence you type, proven by a pure simulation test.
resource: ../../../apps/juggler
workspace_package: '@pmndrs/glyph-juggler'
documentation_type: reference
source_digest: 'sha256:11bb14829a1e581d92a8de7434b5e0ed320167fdc47ea0afe59b516dddddd286'
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

This private Vite package is a small React Three Fiber example. The typed sentence appears at the top of the view as
one shaped paragraph, so kerning and word spacing come from the text engine. Each new letter is red hot and cools to
white. The sentence then drops its letters one at a time in typing order; each hops out with a spin and a squash, the
paragraph flinches, and the letter takes a colour as it falls. A stick figure runs under it, catches it, and tosses it
to the other hand. Backspace removes the newest character. With nothing in play the figure waves for input.

`src/juggler.ts` is a pure simulation in pixel units with no React or Three imports. Waiting letters sit where the
view places them from a committed layout, so the simulation never lays out text. The juggler always catches every
letter by construction rather than by tuning: the body chases the letter whose predicted landing is soonest, a hand
that still holds a letter tosses it the instant another arrives, and a catch places the hand exactly under the letter
so the arm stretches as far as needed. Hands carry a catch inward along a scoop and throw from beside the body; a free
hand reaches toward the next letter assigned to it. Toss flight time grows with the number of letters in play so each
hand clears its dwell, capped so the apex stays inside the view. `src/juggler.test.ts` steps a sentence and a
forty-letter burst for tens of seconds at 120 Hz and asserts that no falling letter is ever below the catch plane,
every letter is caught, release follows sentence order with an upward hop, a free hand reaches for its incoming
letter, the idle wave starts, and removal by sentence offset frees the holding hand.

`src/app.tsx` keeps the sentence as one uniformly styled `Text` so it shapes as a single run; per-character style
spans would split shaping runs, because the engine's resolved style includes colour. The paragraph is parked far below
the view, and each committed layout revision is broken apart with `Text.breakApart()` into per-glyph copies drawn at
the top. A copy's matrix is scaled to zero while its letter is hot or has left, and restored once the letter has
cooled; each glyph's ink centre, keyed by UTF-16 cluster, places the waiting letter in the simulation. A separate
one-glyph `Text` per letter, inside one `TextGroup`, draws the hot overlay through the imperative `style` setter and
then becomes the falling letter, centred on its own ink box. World mutations happen in the key handler, not in React
state updaters, which StrictMode invokes twice. The simulation steps in the R3F `physics` phase with the delta clamped;
view synchronization runs in the update phase. The stick figure is plain node-material meshes posed by two-bone
inverse kinematics, with elbows that flip outward when a hand is raised.

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
the rendered scene, and the paragraph, cooling, and wave were verified by a scripted Chromium run with screenshots.
