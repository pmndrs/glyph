---
type: Workspace Package
title: '@pmndrs/glyph-cameo'
description: A robot rushes into a shallow close-up, reads a release note off its own face a screenful at a time, remembers one more thing, and bolts across a drifting Slug icon floor.
resource: ../../../apps/cameo
workspace_package: '@pmndrs/glyph-cameo'
documentation_type: reference
source_digest: 'sha256:a37b35a32583089bf351c0f95dd232bfeeb0c3b0cda2e034cdc1e4a7b3b2a5a3'
tags: [package, example, react-three-fiber, webgpu, slug, koota, tsl, depth-of-field, vite]
sources:
  - id: cameo-policy
    resource: ../../../apps/cameo/AGENTS.md
    title: Cameo ownership, choreography, comment, and readability policies
  - id: manifest
    resource: ../../../apps/cameo/package.json
    title: Application manifest
  - id: camera
    resource: ../../../apps/cameo/src/cameo/content.ts
    title: The fixed shot, its focal plane, and every measure taken from it
  - id: lens
    resource: ../../../apps/cameo/src/cameo/renderer.tsx
    title: Scene composition and the depth-of-field pass
  - id: take
    resource: ../../../apps/cameo/src/robot/content.ts
    title: The take, declared as beat tracks and screenfuls
  - id: robot-systems
    resource: ../../../apps/cameo/src/robot/systems.ts
    title: Travel, look, lean, face printing, and dust
  - id: printed-card
    resource: ../../../apps/cameo/src/robot/text.ts
    title: Retained per-prefix layouts, optical centring, and the beating sign-off
  - id: icon-field
    resource: ../../../apps/cameo/src/icon-field/systems.ts
    title: Scrolling lattice, motif flips, shocks, and retained matrix upload
  - id: take-check
    resource: ../../../apps/cameo/scripts/take.probe.ts
    title: WebGPU verification of the lens, the printed fit, and the take
  - id: bake
    resource: ../../../apps/cameo/scripts/bake.mts
    title: Face and icon baking with a staleness check
generated:
  by: anthropic/claude-opus-5
  at: '2026-09-22T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-cameo`

This private Vite package is a React Three Fiber example shaped like the hero and stripped to one joke: one koota
world, domains with trait, action, system, and renderer files, a `sequence` domain for cue scheduling, a `time`
domain, and every system listed in order in `src/frameloop.ts`. Vector and matrix work uses the `math` package with
caller-owned scratch, and the simulation runs without React. It is self-contained: it vendors its own pixel face,
its own icon subset, and its own copy of the robot, and reaches outside the package only for the shared Font
Awesome fixture its icons are baked from.

## The shot

The camera never moves. `src/cameo/content.ts` owns its position, its aim, a 22 degree lens, and a slight roll, and
every other measure in the application is derived from it rather than restated: the focal plane, half the frame's
height, the axis the robot crosses the frame along, the bearing it turns to when it looks into the lens, and how far
past the frame's edge it has to be to count as off it. The camera is raised above the robot's head and pitched down
far enough that the horizon leaves the picture, so the frame is floor from edge to edge at every aspect ratio.

Off frame is measured through the lens rather than approximated from the frame's width, because the travel line is
turned well off screen right and the frame widens with depth: a point far behind the mark can still be in the
picture. `framePosition` places a floor point across the frame and `offFrameDistance` solves for the nearer edge on
each side, taking the longer, which is the deeper entry end.

One `dof` pass from `three/addons/tsl/display/DepthOfFieldNode.js` focuses on the robot's face where it stops and
holds half a metre of the world either side of it. Everything else, which is the whole floor, is thrown away.

## The take

`src/robot/content.ts` declares the whole performance as data: two beat tracks, the screenfuls the face prints, when
its eyes blink, and where its braking thumps the floor. No system carries a beat time of its own, so a change to the
timing is a change to that one file. A beat reaches its value by holding, driving, braking, or swinging, and
`trackAt` reads the track at a moment.

The robot charges in from off frame, skids a little past its mark and backs onto it, because it cannot wait to say
what it came to say, arriving on a diagonal out of the blur rather than sliding in flat from the side. Its body pitch
is not scripted: it is the travel track's own second difference, so it tips into every charge and rocks back out of
every brake, including the false start and the final bolt. A track can change its acceleration between one beat and
the next but a body cannot change its pitch in a frame, so the lean chases that target rather than reading it raw;
read raw it flipped its whole range in a single frame where the charge gave way to the brake, which showed as the
rig popping on arrival. Its turns are not scripted flat either: the look track
goes past one, which turns it further than the lens and brings it back, so each turn has a whip. It turns to the
lens, prints its release note a screenful at a time, blinks, sets off, brakes a body length on, waits a beat because
it has forgotten something, snaps back round, signs off, and bolts. Leaving the frame triggers the next take.

The rig is set from the take's clock rather than stepped by frame deltas, so every take plays the same pose at the
same second whatever the frame rate did, and a check that seeks to a moment sees the pose that moment has.

Each hard stop also knocks the lens. The camera is otherwise fixed, and `shakeLens` rings it out with three fast
decaying wobbles about its own axes on top of the orientation `Framing` published as its rest, so nothing but a
knock ever moves it.

## The face

The display is a `Text` per screenful, committed once and then printed without reshaping. Printing a prefix of centred
text moves the characters already on screen, so `src/robot/text.ts` measures the layout once for every prefix and
keeps the horizontal shift each glyph sat at, then draws a prefix by copying committed matrices. Each line is centred
on its ink rather than on its advances, because a display is read by where the marks sit. The sign-off's words are
recorded with the centre of each one's ink, so each `<3` swells about its own middle on a staggered heartbeat.

Letter spacing is a distance rather than a fraction of the size, so the two are chosen together. The type size is
chosen by hand for the widest screenful, and `cameo:take-check` measures every screenful against the panel's margin
through the real shaper, so a longer line cannot quietly run off the display.

## The floor

The floor is the hero's icon paper, lying down. Two Slug sheets scroll across it, a fine gem-toned one and a coarse
dark one, their lattices offset into each other's gaps. Every cell carries all eleven glyph choices and only the
selected record has a nonzero transform, so a motif flip never reshapes text, rebuilds a batch, or creates a draw
mesh while the film runs. A cell at rest uploads nothing: its matrix is compared with the one last written.

The flip turns in the plane of the print rather than out of it, because the sheets are printed on the floor: the cell
is squeezed flat across its own width and let out again with the new glyph behind it, and halfway through it is a
line, which is the only moment the exchange could be seen. The cells sit on springs coupled to their neighbours; the
robot's wheels shove the ones they roll past, and its braking sends a travelling ring through both sheets.

## Verification

`src/robot/systems.test.ts` builds the world headlessly, from the same `WORLD_TRAITS` list the application registers
so the two cannot drift apart, and steps the real systems in frame-loop order. Fifteen stories cover the entrance and
the exit, the rush and its lean, the diagonal approach measured through the lens, the whip on every turn, knocking
the lens hardest on the way in, turning to the lens for every screenful, the false start and the halt, printing one
screenful at a time in full, holding each one long enough to read, keeping the eyes out for a whole message, the
blink between the two, take after take without being asked twice, dust while rolling and none at rest, shoving and
thumping the icon floor, and a motif flipping to a spare glyph.

`cameo:take-check` plays the real application on hardware WebGPU. It captures the take's moments, measures detail as
the mean absolute second difference across neighbouring pixels, and compares the lens's own picture with the same
frame drawn straight. Measured in headless Chromium: the face keeps 68 percent of its detail through the lens while
the far floor keeps 43 percent of its own, leaving the face four times sharper than the floor around it; every
screenful fits the panel inside its margin; both sheets drift; and the robot is outside the picture at both ends of
the take. Its contact sheet is a composite of captured targets and is not colour accurate; the application itself is
what the screenshots of it show.

The checked-in assets are a Basic Latin pixel-font subset and an eleven-icon subset baked to Slug through the
published CLI, plus the packed robot; `bake:check` and `cameo:robot --check` verify byte-identical regeneration.

The source clip is a one-shot rather than a loop: every track returns to its first keyframe except one, which swings
a limb over the first second and settles elsewhere, so playing the clip round jerked that limb back every 4.3
seconds. The pack holds any track that does not close its loop at the value it settled on, which costs a one-off
swing and buys a seam that never shows. One track qualifies, and the packer names it as it does so.

## Commands

```sh
mise exec -- pnpm scripts run cameo:dev
mise exec -- pnpm scripts run cameo:take-check
mise exec -- pnpm --filter @pmndrs/glyph-cameo check
```

The complete check runs typechecking, lint, formatting, the headless system tests, deterministic asset verification,
and a production build.
