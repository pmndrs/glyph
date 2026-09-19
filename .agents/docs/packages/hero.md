---
type: Workspace Package
title: '@pmndrs/glyph-hero'
description: 'Glass letters, a robot, and a black-hole finale over a Slug icon lattice.'
resource: ../../../apps/hero
workspace_package: '@pmndrs/glyph-hero'
documentation_type: reference
source_digest: 'sha256:5fbe9b85ff4f3f16d22e2082485c8a0321e54d324e20ffb5ecad91dfda1742fb'
tags: [package, example, react-three-fiber, webgpu, slug, vite, koota]
sources:
  - id: hero-policy
    resource: ../../../apps/hero/AGENTS.md
    title: Hero testing, comments, tuning, and readability policies
  - id: manifest
    resource: ../../../apps/hero/package.json
    title: Application manifest
  - id: hero-scene
    resource: ../../../apps/hero/src/hero/renderer.tsx
    title: Hero sequence composition
  - id: glass-material
    resource: ../../../apps/hero/src/letters/materials.ts
    title: Glass title materials and smooth lens normals
  - id: refraction-check
    resource: ../../../apps/hero/scripts/refraction.probe.ts
    title: WebGPU stained-glass verification
  - id: glass-shadows
    resource: ../../../apps/hero/src/letters/shadows.tsx
    title: Light-space glass projection
  - id: glass-shadows-check
    resource: ../../../apps/hero/scripts/glass-shadows.probe.ts
    title: WebGPU projection controls
  - id: bake
    resource: ../../../apps/hero/scripts/bake.mts
    title: Face baking and staleness check
  - id: robot
    resource: ../../../apps/hero/src/robot/renderer.tsx
    title: Robot drive, look-up, and floor footprint
  - id: robot-dust-check
    resource: ../../../apps/hero/scripts/robot-dust.probe.ts
    title: WebGPU glyph dust and fade controls
  - id: physics-traits
    resource: ../../../apps/hero/src/physics/traits.ts
    title: Shared solver resource and entity body state
  - id: physics-actions
    resource: ../../../apps/hero/src/physics/actions.ts
    title: Body creation and motion transitions
  - id: physics-systems
    resource: ../../../apps/hero/src/physics/systems.ts
    title: Fixed stepping and entity lifecycle cleanup
  - id: outline
    resource: ../../../apps/hero/src/letters/utils.ts
    title: Letter outlines cut into invisible colliders
  - id: robot-pack
    resource: ../../../apps/hero/scripts/robot.mts
    title: Robot glTF packing and staleness check
  - id: hole
    resource: ../../../apps/hero/src/black-hole/systems.ts
    title: Pure black-hole beat timeline
  - id: hole-warp
    resource: ../../../apps/hero/src/black-hole/materials.ts
    title: Outline-exact glyph warp around the hole
  - id: screen-ink
    resource: ../../../apps/hero/src/robot/materials.ts
    title: Pixels lit on the robot's face screen
  - id: startup
    resource: ../../../apps/hero/src/hero/prepare.ts
    title: Scene preparation and GPU completion gate
  - id: loading
    resource: ../../../apps/hero/src/hero/loading.tsx
    title: Preparation overlay and failure display
  - id: retained-line
    resource: ../../../apps/hero/src/letters/text.ts
    title: Prepared glyph records for typing and replay
  - id: performance-check
    resource: ../../../apps/hero/scripts/performance.probe.ts
    title: Two-cycle WebGPU performance and late-resource check
  - id: retained-lines-check
    resource: ../../../apps/hero/scripts/retained-lines.probe.ts
    title: Retained typing compared with independently shaped prefixes
  - id: lattice-simulation
    resource: ../../../apps/hero/src/icon-field/systems.ts
    title: Fixed-capacity lattice simulation and direct glyph transforms
  - id: robot-motion
    resource: ../../../apps/hero/src/robot/systems.ts
    title: Caller-owned robot path and pose output
  - id: dust-simulation
    resource: ../../../apps/hero/src/robot/systems.ts
    title: Fixed particle storage and distance-based emission
  - id: lattice-check
    resource: ../../../apps/hero/src/icon-field/systems.test.ts
    title: Matrix equivalence, bounded simulation, and edge-on morph checks
  - id: physics-check
    resource: ../../../apps/hero/src/physics/systems.test.ts
    title: Lift, bounce, landing, revival, and robot collision checks
  - id: world
    resource: ../../../apps/hero/src/world.ts
    title: Koota world and retained domain entities
  - id: actions
    resource: ../../../apps/hero/src/actions.ts
    title: Application composition of domain creation and replay
  - id: letter-actions
    resource: ../../../apps/hero/src/letters/actions.ts
    title: Title construction, disposal, and typing transitions
  - id: input
    resource: ../../../apps/hero/src/input/hooks.ts
    title: DOM input adapter with application commands
  - id: time
    resource: ../../../apps/hero/src/time/systems.ts
    title: Headless playback clock
  - id: hero-actions
    resource: ../../../apps/hero/src/hero/actions.ts
    title: Actor lifecycle and declared hero script
  - id: hero-systems
    resource: ../../../apps/hero/src/hero/systems.ts
    title: Headless simulation order and event routing
  - id: sequence-check
    resource: ../../../apps/hero/src/sequence/systems.test.ts
    title: Timeline ordering, delays, retriggering, and cancellation
  - id: systems
    resource: ../../../apps/hero/src/sequence/systems.ts
    title: Declarative cue scheduling and dispatch
  - id: sequence-actions
    resource: ../../../apps/hero/src/sequence/actions.ts
    title: Timeline loading, event triggering, and cancellation
  - id: sequence-traits
    resource: ../../../apps/hero/src/sequence/traits.ts
    title: Cue declarations and retained deadlines
  - id: hero-renderer
    resource: ../../../apps/hero/src/hero/renderer.tsx
    title: Composition of collapse and star ember post-processing
  - id: star-embers
    resource: ../../../apps/hero/src/star-embers/renderer.tsx
    title: Prepared Unicode star particles and emission motion
  - id: ember-materials
    resource: ../../../apps/hero/src/star-embers/materials.ts
    title: Star fire, bloom, fading, and screen-space sparks
  - id: frameloop
    resource: ../../../apps/hero/src/hero/renderer.tsx
    title: R3F clock, input, and development controls
generated:
  by: anthropic/claude-opus-5
  at: '2026-09-18T09:20:00Z'
---

# Package reference: `@pmndrs/glyph-hero`

This Vite application presents glass letters, a robot, and a black-hole finale over an animated icon lattice.
It runs on `WebGPURenderer` through React Three Fiber v10 and drei v11. The title, icons, robot display, and finale
stars use Slug analytic coverage. The feature tagline uses MSDF for its outline.

Local tuning values live at their use sites. Shared timing and geometry contracts, retained buffers, uniforms,
and reusable materials keep named storage. Comments describe the current algorithm or feature. The app-specific
[code policies](../../../apps/hero/AGENTS.md) govern future changes.

Koota is pinned to `0.6.6-canary.63c1187`. The organization follows the local `minecraft-like` example. Each
domain is a module with explicit ownership. Trait files contain data models and defaults. Actions own world and
entity commands, including construction, disposal, input sampling, and discrete transitions. Systems advance
existing state and invoke actions for commands. Renderers own mounted resources and send state changes through
actions. Only the files a domain needs exist.
Dependencies use domain actions, published state, or explicit inputs rather than reaching into another domain to
implement its transitions.

| Domain        | Ownership                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `sequence`    | Declarative timed and event cues, pending deadlines, cancellation, and dispatch                            |
| `time`        | Playback clock and bounded frame delta                                                                     |
| `input`       | Pointer state, DOM listeners, and pointer decay                                                            |
| `hero`        | Scene and pipeline composition, script, actor lifecycle, preparation, fonts, lighting, paper, and viewport |
| `physics`     | Crashcat resource, body traits, actions, fixed stepping, and collision events                              |
| `letters`     | Title construction and motion, published landings, retained text, feature typing, glass, and projection    |
| `icon-field`  | Icon sheets, bounded impact queue, spring simulation, morphs, and rendering                                |
| `robot`       | Spawn/reset/run actions, path, published departure, physics target, dust, rig, and display                 |
| `black-hole`  | Collapse state and controls, attraction functions, glyph warp, and rendered sheet collapse                 |
| `star-embers` | Emission age, prepared star particles, fire material, bloom, fading, and screen-space sparks               |

The root owns one Koota world and the combined action set. `world.ts` invokes the hero initialization action.
Action sets define commands as arrow-function properties. Root `actions.ts` spreads the domain action sets and
adds world disposal. Hero actions initialize the actors, load the declared script, and replay the experience.
Domain actions remain directly importable, including when names collide.
Physics actions configure the solver and install contact/removal handlers before actors spawn. Field actions
build each configured lattice before attaching its trait. Letter actions create, replay, and dispose title bodies,
while letter systems own continuous lift and attraction updates.

`hero/actions.ts` declares the script as cues with `at`, or `on` and optional `after`, plus an action callback.
The opening cue runs after one playback second. A letter landing schedules typing after 0.55 seconds and the robot
after 1.4 seconds. Robot departure opens the black hole. Repeated landing events restart their pending delays.
Replay cancels pending cues before resetting the actors and lifting the title again.
`sequence` knows only the clock, cue declarations, and retained deadlines. It runs due commands in chronological
order, breaking ties by declaration order. Each scheduled cue runs once, and events can rearm their cues.
Two focused tests cover ordering, event delays, retriggering, and cancellation during dispatch.

`hero/systems.ts` orders simulation, forwards landing and departure events to the script, sends landing positions
to field waves, and samples black-hole pop age for star embers. Black-hole state is passed explicitly into the
field and title systems and the feature-line view. The physics solver depends on the clock and its own state.

`main.tsx` only mounts `<Hero />` from `hero/renderer.tsx`. That renderer owns the application shell, world instance
and hot-reload disposal, loading screen, canvas, Suspense boundary, scene composition, and post-processing.
Its private frame loop samples renderer inputs, delegates DOM input, and runs the headless hero tick at 60 Hz.
`hero/prepare.ts` owns preparation requirements and status subscriptions. `hero/loading.tsx` renders the loading overlay. `hero/fonts.ts` loads the fonts, `hero/lighting.tsx` defines the
lighting and paper, and hero traits and actions own viewport and readiness state. There is no separate view domain.
Only `main.tsx`, `world.ts`, `actions.ts`, and the shared deterministic `random.ts` remain at the source root.
Domain roots expose traits, actions, systems, renderers, and materials where needed.
`materials.ts` groups each domain's uniforms with the shader graphs and material builders that use them.
Domain behavior stays with its owner: black-hole beats, robot motion and dust, letter synchronization, and
icon-field simulation live in systems. Icon-field actions build the lattice, and traits contain its data models.
Shared content lives in each domain's `content.ts`. Letters own retained typing in `text.ts` and glass projection
in `shadows.tsx`. Only small attraction calculations, cell transforms, outline conversion, and physics pose
conversion remain in `utils.ts`. Trivial object defaults are inlined at their allocation sites. Simulation does not import React or shader construction.
Domain tests remain beside their implementations.

Scalar-bearing traits use Koota SoA schemas. Per-field factories retain each entity's math tuples,
buffers, motion records, and pools. Only `Physics`, the opaque solver resource with its entity map, callbacks,
and scratch, stays AoS. High-frequency values never pass through React state. SoA `get()` returns a snapshot,
so actions and singleton updates publish scalar changes with `set`, and render callbacks sample current scalar
state. Query mutations use `updateEach`, while composition reads published landings and departures with `readEach`.
The robot body query selects only `Robot` for writeback, preserving the physics actions' writes to `Body`. Preparation
passes measured letter geometry into letter actions before playback. Those actions create bodies on the same
world and dispose them with the mounted title. Renderers publish matrices and uniforms after simulation. Replay
closes the finale, restores the field, lifts the title, and resets typing and robot scheduling through their owners.

The old, unmounted break/rewind presentation and its exclusive director and compressed recording code/tests were
removed during the Koota migration. The root cleanup also removed retired ink, glass, and silhouette variants and
their unused uniforms. Materials and post-processing now live in their domains. Browser checks own common playback stories: title lift and landing, robot dust, typed text, collapse, blackness,
and Space replay. Six numerical tests retain precise evidence for baked title colliders and their counters, glyph transforms, edge-on motif changes,
bounded pointer response, lift/drop/revival with one landing notification, and robot pushes without tipping or
leaving an invisible collider behind. These checks catch errors that
pixel comparisons cannot isolate reliably. Buffer identity and duplicate timeline/path tests are omitted.

The application pins Poimandres' `math` package at `0.1.0` for the hero's CPU simulation and transforms. Its upstream
skill is installed at `.agents/skills/math/SKILL.md` from `pmndrs/math` commit
`c6713e38dd86de6e3e5bf98b94e22c2a29e4a709`, matching the published package's `gitHead`.
Letter actions own title creation and disposal, letter systems advance title motion, and retained typing helpers operate on caller-owned records.
Math tuples hold transform scratch. Physics publishes retained position and rotation tuples on each `Body` trait,
which the letters domain projects into its matrix stream. Three matrices and scene objects remain at the rendering boundary.

The `physics` domain pins `crashcat@0.0.5` and splits into `traits.ts`, `actions.ts`, and `systems.ts`, with a small
`utils.ts` for pose data and behavior checks beside the systems. `Physics` holds the solver resource on the Koota world, while `Body` owns each entity's
solver ID, motion targets, published pose, and landing state. There is no separate simulation world or parallel
letter body array. World-bound actions create, hold, release, park, and revive bodies. Removing `Body` or destroying
its entity removes the solver body through one lifecycle subscription. The letters domain supplies outline prisms and
animation targets. Crashcat combines each letter's prisms into
an immutable compound collider with a BVH, preserving counters and concave outlines. Only box, convex-hull,
and static-compound shape implementations are registered. World and shape creation are synchronous and happen
during preparation, without a physics Wasm download. `stepPhysics(world)` keeps 60 Hz updates with four collision substeps,
gravity along negative z, free translation and yaw, and locked pitch/roll. Material mixing preserves the configured
friction and bounce threshold. Hidden letters and the absent robot remain allocated on a noncolliding layer as
static bodies, then return to kinematic or dynamic motion when playback needs them. No colliders are rebuilt on replay.
Different solvers can produce different resting positions and contact timing. The migration preserves the interaction
and animation contracts rather than identical trajectories.

The icon field composes glyph transforms directly, replacing 1,108 temporary Three groups. Its neighbour graph,
motif candidates, swap flags, selected records, and twelve wave slots are allocated once. Motif changes use a seeded
`math/random` generator on the frame clock; the next change waits 1.1 seconds from its last start. Each update visits
each cell and its four neighbours, plus active waves, at a bounded eight substeps: O(cells × (4 + active waves)) time
and O(cells) retained storage. Expired waves are excluded before the inner loop. A long frame discards excess
simulation backlog instead of accumulating work indefinitely.

Robot path sampling, eye transitions, and floor footprints overwrite retained outputs. Consumers copy a footprint
when they need its previous-frame position. Dust uses 128 reusable particle records; saturation replaces the oldest
slot, movement above four units is treated as a teleport, and absent robots emit nothing. Title landings use a
fixed buffer and count; each released body reports its first floor contact once. Lift, departure, replay, and typing
reuse their original records. The robot collider and shadow capture list are prepared before playback. These
application-owned update kernels create no temporary arrays, collections, or pose objects; renderer and physics
library internals are outside that claim. Scene-authored dimensions and flight durations are positive, transforms
used as coordinate frames are invertible, and frame deltas are nonnegative.

The field tests compare direct transforms with Three's matrix composition, bound pointer disturbances, and check
edge-on motif substitution. The physics tests compose only clock and physics resources with the actors under test. They use real Crashcat contacts to verify bounce, one landing per release, revival, and robot pushes
without tipping or leaving collisions after departure. WebGPU checks cover visible robot emission and fade, finale timing, and replay.

The scene builds two interleaved lattices of eleven icons on mass-spring grids at different depths, scaled
so they interleave on screen and stay in phase. The Slug-glass `Glyph` and feature line start at rest. One second
after preparation finishes, the title automatically lifts towards the camera and smashes back down. This opening
beat uses the ready-gated sequence clock and runs once. Space replays the sequence, including if pressed before
the automatic lift. The lift is carried, 35 ms per letter, to just short
of the camera; the fall is simulated. Each letter is a rigid body in a Crashcat world with a static floor: it is thrown
down with a little sideways drift and spin, rebounds once, and comes to rest wherever friction stops it, a touch off
its mark and off square, differently on every replay. The floor's first contact with each letter is what strikes
the lattices, so the impacts land where the letters actually do. The feature line retypes after the final landing.
Holding Space does not restart the animation, and focused form controls retain their normal keyboard behavior.

A small robot treats the screen as its floor: Sketchfab's _Cute Home Robot_ by Yandrack (CC-BY-4.0; the credit
ships in the build's `notices.txt`). It drives in from the bottom left along a meandering diagonal whose phase
changes every run, stops over the title, rocks back on its wheels and turns its face up to the camera, then drives
off the top right. While it looks up, its face screen glitches its eyes out in torn bands and prints `PMNDRS` a letter at a time
in the pixel face, lit like the display it sits on, then glitches the eyes back as it looks down; the text rides
the head joint, placed from the screen's measured extent in that joint's frame. It runs 1.4 s after the opening
landing and after every replay's landing. On the floor it
is a kinematic body in the same world, a rounded box the size of its body driven to its path each frame, so
nothing stops it: the letters slide and turn where it shoves them and stay wherever they end up. The letters stay
glyph's: once the paragraph has committed it is broken apart with `Text.breakApart()`, and each pane's glyph copy
follows its body through `Glyphs.setMatrixAt()`, so a lift is real depth and a shove is a real move while shaping
and the stained-glass materials remain the paragraph's own. Colliders use `getSlugGlyphCurves` on the loaded
Geist Black font, indexed by the paragraph's shaped glyph IDs. Preparation joins the quantized curves into paths,
triangulates their filled regions with counters intact, and extrudes invisible prisms. There is no second font
parser or runtime TTF request. A real-font test covers all five title solids and the open counter in `p`.

While driving, the robot kicks up small, randomly varied Slug icon glyphs behind both wheels. A fixed pool of 128
particles emits by distance travelled, so the trail thins as it slows and stops emitting while it looks up. The
glyphs drift outward in world space, tumble, shrink, and fade as they rise; existing particles finish fading after
the robot leaves. The pool reuses the baked icon face and one transparent material without reshaping text per frame.
`mise exec -- pnpm scripts run hero:robot-dust-check` observes the real drive-in on WebGPU and compares the trail
with hidden and fully faded controls, saving a capture under `apps/hero/.cache/robot-dust.png`.

The moment the robot's body is off the screen, a black hole opens at the centre, so the pull lands a beat after it has gone. Each glyph accelerates directly into a tightening spiral as the field reaches it:
the icon sheets keep scrolling and changing motifs, slowing under a strengthening field that releases nearby
glyphs before distant ones and stretches them along their velocity;
the title's letters follow cubic spiral paths from their actual robot-shoved positions; and the feature line is
broken apart into independently animated glyphs. Title motion is carried by the existing kinematic bodies during
the finale, then restored to the lift-and-smash sequence on Space. The Slug materials still bend each outline
through `coverageAt`, anchored at the glyph's own centre.

The final pull takes the whole rendered frame, including the paper, shadows, and remaining particles. A post-process
inverse mapping twists and shrinks that sheet into the centre between 2.15 and 3.12 seconds, exposing black behind
its edges. After a brief empty hold, sixteen pastel Unicode stars (★ ☆ ✦ ✧ ✩ ✶) spit outward at 3.35 seconds with a few small
light sparks. The stars shrink like embers, with enhanced bloom and a 1.25-second fade applied after composition so their halos dim along with their cores; the output is exactly black by 4.6 seconds and stays there until Space replays.
Post-processing is always enabled, and preparation waits for its render pipeline.

The `star-embers` domain owns its SoA emission age, actions, renderer, and materials. Its actions initialize and
sample the age, and replay clears it before the next opening. It has no dependency on the black-hole domain.
`hero/renderer.tsx` composes the black-hole sheet warp with the ember bloom, fade, and sparks.

The ember material in `src/star-embers/materials.ts` keeps the exact Slug star silhouettes and shades each glyph's
own quad with a creamy hot core, an amber rim, moving fire noise, and gentle asynchronous flicker. As the stars
shrink, the surface cools toward orange; the composed stars and bloom still fade together. The WebGPU capture
compares this surface against a flat pastel control.

The six star shapes are baked from the vendored OFL Noto Sans Symbols 2 face, with the symbols shared between the
bake and the burst in `src/star-embers/traits.ts`. `hero:star-font` restores the pinned source and license, and
`hero:bake -- --only=stars` regenerates the tiny Slug subset. Both accept `--check`.

The timeline and feature-glyph paths are pure functions. The WebGPU finale check covers collapse, completion,
and replay from black. The development handle `heroHole` opens, freezes, or dismisses the beat.
`mise exec -- pnpm scripts run hero:hole-check` steps the actual WebGPU scene through six moments, compares collapsed
paper against an uncollapsed control, checks the luminous glyphs against a hidden control and the exact black frame, and verifies replay restores the
paper. It also checks the bloom against a disabled control and confirms stars and their bloom still linger at 0.8 seconds. Its filmstrip is saved at `apps/hero/.cache/hole.png`.

`mise exec -- pnpm scripts run hero:robot` packs the Sketchfab download (a multi-file glTF with 2048² textures)
into the single `assets/robot.glb` the app imports: the model's own floor disc is dropped, textures are reduced to
1024² WebP, and the animation is resampled. `--check` verifies the committed file is what the source still packs to.

The main render job is capped at 60 fps through R3F v10's native scheduler. The offscreen glass-shadow job is
capped separately because Canvas's limit does not throttle update jobs.

The scene uses the conference slides’ lime loading screen and centered black Poimandres mark, including
the subtle shake, reduced-motion support, and 400 ms fade when GPU preparation finishes. Preparation failures
remain visible in the overlay. It holds animation until all text, detached glyphs, physics bodies,
the robot, environment, dust, and burst are ready. Preparation renders hidden and offscreen objects through the
actual shadow, transmission, and post passes, compiles the scene, and waits for submitted GPU work before revealing
the normal visibility set. Browser checks wait for `data-hero-state="ready"`; readiness follows completed work,
not a fixed delay.

Both typing lines retain their complete glyph records and precompute every prefix's centering with Glyph's own
layout during preparation. Playback changes matrices only, including the feature line's departure and replay.
The icon field retains all eleven choices for each cell (12,188 glyph records across both layers); motif changes
swap visible records without reshaping text or creating draw meshes. This trades retained storage for stable playback.
`hero:retained-lines-check` compares all prefixes with independently shaped layouts and verifies transform reset.

`mise exec -- pnpm scripts run hero:performance` runs two complete lift, typing, robot,
collapse, and burst replays on WebGPU after preparation. It rejects new shader programs, render pipelines, scene
meshes, or asset loads, with a deliberate new-material control proving the compilation counters work. It reports
raw render intervals, CPU submission work, asynchronous GPU queue completion, and long tasks, along with the
adapter, viewport, and drawing-buffer dimensions. The canvas uses adaptive DPR between 1 and 2, and the report records the actual drawing-buffer size for each run.

With the declarative hero script, two complete 1280×720 replays on Apple Metal with Chromium 149 averaged 60.00 fps
across 1,702 frames after 3.13 seconds of preparation. No late shader programs, pipelines, meshes, assets, or long
tasks were observed. Render intervals were 17.5 ms at p95 and 28.9 ms worst, with one interval over 25 ms.
CPU submission time was 4.2 ms at p95, and browser GPU queue completion was 8.9 ms at p95.
Earlier SoA runs on this host averaged 58.38 and 58.46 fps, while the preceding AoS commit (`64fcb3bd`) averaged
58.00 fps. These separate runs show variable pacing and do not establish a speedup from the domain extraction.
They verify resource preparation but do not measure delivery through a screen recorder or guarantee steady 60 fps.

The full hero package check passes, including six numerical tests, two timeline tests, all five font bake checks, and the production
build. WebGPU checks cover title lift and landing, both retained typing lines, the black-hole finale, and replay.
The production entry bundle is 599.52 kB gzip, down from 609.11 kB before removing the alternate scene.

The title reads `Glyph` in title case and uses Geist Black at weight 900, matching the family, weight, and font version used by `threejs-conf-talk`.
Its five inline glass materials use that talk's brand accents in `src/letters/materials.ts`: red G, orange l,
teal y, blue p, and purple h. The same attenuation colors tint their projected light. The feature line sits below the lowercase descenders.
Each has its own attenuation tint, thickness, roughness, and refractive index, with smooth lens normals and modest
physical dispersion. The paper and icon background stay unchanged; there are no added crystal lights, internal
rainbow beams, or hidden studio images.

The title's shadow and caustics are one projection under a lamp of their own, a point above the top of the lift and
a little to the upper right; the studio lights are untouched, so the glass keeps its highlights. Each frame the five
glass panes are captured straight down into a 1024 × 640 height field: analytic coverage, transmitted tint from
Three's attenuation values, height above a receiving plane at z = -0.06, refractive index, dispersion, and the
pane's lens normal. A multiply-blended receiver marches each pixel toward the light through that field, treating
every flat letter as a slab 1.2 units deep, so the glyphs throw a soft, extruded, tinted shadow that leans slightly
down and to the left. The march's samples are spaced quadratically and its range follows the highest letter, which
the title's bodies publish each physics step because the poses live in the glyph instance buffer. Under the lamp's
perspective a lifted letter's shadow grows and spreads beneath it as the letter grows on screen, softening and
thinning through a four-level Gaussian pyramid of the capture blended by height, and settles back to the same pixels
on landing. The light the glass turns aside returns as caustics: a 512 × 320 grid over the plane is carried in its
vertex shader to where each ray lands after refracting through the lens normal, an edge chamfer, and two slowly
turning lattices of facets, once per colour channel with a small index spread, and its brightness is the source area
gathering in each pixel, so the light pools into faint, spectrally fringed glints inside the shadow. It is an art-
directed projection, not multi-bounce light transport.

`mise exec -- pnpm scripts run hero:refraction-check` verifies the five visible stained-glass finishes against an
untinted control on WebGPU and checks repeated captures and resizing.
`mise exec -- pnpm scripts run hero:glass-shadow-buffers` tiles the capture, lens normals, heights, and caustic map
into `apps/hero/.cache/glass-shadow-buffers.png` and logs the caustic grid's vertex sample count.
`mise exec -- pnpm scripts run hero:lift-sheet` verifies the automatic opening beat, steps its physics deterministically,
and tiles four moments of the lift and smash into `apps/hero/.cache/lift-sheet.png`.
`mise exec -- pnpm scripts run hero:glass-shadow-check` compares the projection with disabled and untinted
controls, lifts the actual draw surfaces while keeping visible glass fixed for the readback, and verifies an
exact return to the original pixels after lowering them. Both run through Vitexec, fail on browser errors,
and save scene readbacks under `apps/hero/.cache/`.

`pnpm --filter @pmndrs/glyph-hero dev` starts the development server. `bake` and `bake:check` drive the five font
assets through the Glyph CLI, and `check` runs typecheck, lint, format, unit tests, the bake staleness check, and the
build. `hero:bake -- --only=<asset-name>` limits a bake to one face. Geist Black, Geist Mono Bold, and Geist Pixel
Grid include Basic Latin. The tagline adds its punctuation to Mono Bold. Icons and stars include only the symbols
used by their domains. `useFonts` preloads four Slug fonts and the tagline's MSDF font before rendering the scene,
and each renderer receives only the fonts it draws. The origin scene, video, multilingual faces, unused copy, and
alternate scene switch are removed.
