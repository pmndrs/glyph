---
type: Workspace Package
title: '@pmndrs/glyph-juggler'
description: A koota-driven stick figure with stats juggles the forge-hot letters of a shaped sentence you type, dropping and exploding what he cannot catch.
resource: ../../../apps/juggler
workspace_package: '@pmndrs/glyph-juggler'
documentation_type: reference
source_digest: 'sha256:1385b8d4e77d435e88f46056a1a775a548d6a39100e1785496c8b0b0f5902fd0'
tags: [package, example, react, react-three-fiber, koota, tsl, simulation, vite]
sources:
  - id: manifest
    resource: ../../../apps/juggler/package.json
    title: Example application manifest
  - id: frameloop
    resource: ../../../apps/juggler/src/frameloop.ts
    title: Simulation and view systems in execution order
  - id: letters
    resource: ../../../apps/juggler/src/letters/systems.ts
    title: Letter release, fall, seating, scrolling, explosion, and view systems
  - id: juggler
    resource: ../../../apps/juggler/src/juggler/systems.ts
    title: Body chase, catch rule with stats, hand motion, and figure pose
  - id: materials
    resource: ../../../apps/juggler/src/letters/materials.ts
    title: Shared forge text material with instance-encoded state, flames, and shards
  - id: proof
    resource: ../../../apps/juggler/src/juggler/systems.test.ts
    title: Headless stories through the real systems
generated:
  by: anthropic/claude-fable-5-1
  at: '2026-09-20T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-juggler`

This private Vite package is a React Three Fiber example structured like the hero: one koota world, a `letters`
domain and a `juggler` domain with trait, action, system, and renderer files, a `time` domain, an `input` hook, and
every system listed in order in `src/frameloop.ts`. Vector and matrix work uses the `math` package with caller-owned
scratch. The simulation runs without React.

The typed sentence appears at the top as one shaped paragraph. Each letter is struck in white-hot with flames and
embers and cools through yellow, orange, and red to steel. The sentence drops its letters one at a time in typing
order, faster under a backlog, and scrolls emptied leading lines out of the way. A released letter hops out with a
spin and a squash and takes a colour as it falls. The juggler has stats: body speed, hand speed, reach, and grip. He
runs to stand under the letter landing soonest, leaning toward the other hand's next catch within reach; each released
letter is routed to the hand with the widest gap in its arrivals; a hand may throw early once it has handled a letter
for half its dwell; and a catch requires a free hand within grip, otherwise the letter drops, falls to the floor, and
explodes into shards. With nothing in play the figure waves.

`src/juggler/systems.test.ts` builds the world headlessly and steps the real systems in frame-loop order. It covers
juggling a short word without drops, dropping and exploding under a forty-letter burst, release order with a hop and
the body under the first letter, reaching a free hand toward its incoming letter, faster releases under backlog,
catching only within grip, the idle wave, and deletion freeing a hand.

Rendering avoids per-letter shader work. The sentence's paragraph is a layout oracle parked far below the view; each
committed layout seats every letter on its glyph's ink centre by UTF-16 cluster, and line baselines drive the scroll.
Each letter is a one-glyph `Text` inside one `TextGroup`, all sharing a single `defineTextMaterial` forge material.
The letter's heat, tint progress, and hue ride in its style colour, duplicated on a cell-wide outline so the values
are readable outside the ink where the halo is drawn; the view system rewrites the style only when the quantized
values change. Per-character style spans were rejected because the engine's resolved style includes colour, so they
would split shaping runs and lose kerning. Flames and explosion shards are one instanced mesh each with per-instance
attributes. Letter views mount from callback refs because the R3F text ref settles after the group's effect runs.
The glyph reads its character once on mount so an exploded entity never reaches React's render.

Measured in headless Chromium with WebGPU at a 120 Hz frame budget: typing forty characters previously created about
ten GPU pipelines per letter with hitches up to 617 ms; with the shared material it creates about one per letter and
the worst typing frame is 16 ms, with idle and juggling frames at the display rate.

The checked-in Inter asset is a Basic Latin MSDF bake through the published CLI; `bake:check` verifies byte-identical
regeneration.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/glyph-juggler dev
mise exec -- pnpm --filter @pmndrs/glyph-juggler test
mise exec -- pnpm --filter @pmndrs/glyph-juggler check
```

The complete check runs typechecking, lint, formatting, the headless system tests, deterministic asset verification,
and a production build. No browser probe exists yet; rendering, performance, and the explosion were verified by
scripted Chromium runs with screenshots, pipeline counts, and frame timing.
