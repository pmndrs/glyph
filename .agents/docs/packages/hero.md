---
type: Workspace Package
title: '@pmndrs/glyph-hero'
description: 'Glass letters, a robot, and a black-hole finale over a Slug icon lattice, then a play mode that drives the robot.'
resource: ../../../apps/hero
workspace_package: '@pmndrs/glyph-hero'
documentation_type: reference
source_digest: 'sha256:90067b83e8ba66f315947f49bb1c9300bddc31815a332e76b8bf319cc7f5e899'
tags: [package, example, react-three-fiber, webgpu, slug, vite, koota]
sources:
  - id: hero-policy
    resource: ../../../apps/hero/AGENTS.md
    title: Hero testing, comments, tuning, and readability policies
  - id: manifest
    resource: ../../../apps/hero/package.json
    title: Application manifest
  - id: app
    resource: ../../../apps/hero/src/app.tsx
    title: Canvas, providers, and application shell
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
  - id: collision-check
    resource: ../../../apps/hero/scripts/collision.probe.ts
    title: Real glyph separation and floor height after the robot push
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
  - id: profile-check
    resource: ../../../apps/hero/scripts/profile.probe.ts
    title: GPU-timestamp profile of each pass at rest and through the finale
  - id: glass-lens
    resource: ../../../apps/hero/src/letters/lens.tsx
    title: Camera-view glass capture that bends glass seen through glass
  - id: glass-lens-check
    resource: ../../../apps/hero/scripts/glass-lens.probe.ts
    title: Glass over glass bends only the glass beneath it
  - id: hmr
    resource: ../../../apps/hero/src/hmr.ts
    title: Uniform sets kept across a hot module replacement
  - id: paper-material
    resource: ../../../apps/hero/src/hero/materials.ts
    title: Paper grain baked once into a wrapping tile
  - id: retained-lines-check
    resource: ../../../apps/hero/scripts/retained-lines.probe.ts
    title: Retained typing compared with independently shaped prefixes
  - id: lattice-simulation
    resource: ../../../apps/hero/src/icon-paper/systems.ts
    title: Fixed-capacity lattice simulation and direct glyph transforms
  - id: robot-motion
    resource: ../../../apps/hero/src/robot/systems.ts
    title: Caller-owned robot path and pose output
  - id: dust-simulation
    resource: ../../../apps/hero/src/robot/systems.ts
    title: Fixed particle storage and distance-based emission
  - id: lattice-check
    resource: ../../../apps/hero/src/icon-paper/systems.test.ts
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
    title: Landing impacts and hero script event routing
  - id: viewport-hook
    resource: ../../../apps/hero/src/hero/hooks.ts
    title: React synchronization of the world viewport
  - id: mounted-view-check
    resource: ../../../apps/hero/src/hero/systems.test.ts
    title: Loading, mounted view replacement, and detached resource behavior
  - id: sequence-check
    resource: ../../../apps/hero/src/sequence/systems.test.ts
    title: Timeline ordering, delays, retriggering, and replacement during dispatch
  - id: systems
    resource: ../../../apps/hero/src/sequence/systems.ts
    title: Declarative cue scheduling and dispatch
  - id: sequence-actions
    resource: ../../../apps/hero/src/sequence/actions.ts
    title: Timeline loading and event triggering
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
    resource: ../../../apps/hero/src/frameloop.ts
    title: R3F clock and input
  - id: play-button
    resource: ../../../apps/hero/src/play-button/renderer.tsx
    title: Play button sheet, camera, and framed pixel label
  - id: play-button-materials
    resource: ../../../apps/hero/src/play-button/materials.ts
    title: Quantized frame, block-sampled label, stepped reveal, and sheet composition
  - id: play-button-systems
    resource: ../../../apps/hero/src/play-button/systems.ts
    title: Reveal timing, hit test, and mounted sheet synchronization
  - id: play-button-check
    resource: ../../../apps/hero/scripts/play-button.probe.ts
    title: WebGPU draw-in, block fill, and hover checks with a tiled close-up
  - id: rain-pane
    resource: ../../../apps/hero/src/rain/materials.ts
    title: Rain panes, composed by multiplication and captured by the glass projection
  - id: rain-check
    resource: ../../../apps/hero/scripts/rain.probe.ts
    title: WebGPU rain shadows and caustics from the projection against a control without them
  - id: steering-check
    resource: ../../../apps/hero/src/robot/systems.test.ts
    title: Arrival, curvature, bounded turning, retargeting, and greeting checks
generated:
  by: anthropic/claude-opus-5
  at: '2026-09-18T09:20:00Z'
---

# Package reference: `@pmndrs/glyph-hero`

This Vite application presents glass letters, a robot, and a black-hole finale over an animated icon lattice.
It runs on `WebGPURenderer` through React Three Fiber v10 and drei v11. The title, icons, robot display, finale
stars use Slug analytic coverage. The feature tagline uses MSDF for its outline. The play button is a pure
distance-field shader.

The world runs one of two modes, held in the world-level `Mode` trait. `sequence` is the scripted experience:
the title drops, the robot drives in, stops, greets, and leaves, and the black hole swallows the scene. While the
hole is closed, any press takes the wheel into `play`: a dropped title stays put, a robot on the floor carries on
from where it is, and the tagline backspaces away. Once the hole has opened, presses wait until the embers have gone
out and a "Play" button has drawn itself over the black frame; pressing it restarts the scene into `play` with the
robot scooting in from off screen. In play each press on the floor sends the robot to that point. It never drives a
straight line, and it rests, looks up, and greets at each stop. A beat after the rain starts, a little black hole
opens at the centre with a gravity field that grows with it; what the player pushes into it is eaten with a gulp
and widens it, until it is the finale's hole and the finale takes everything, ending at the Play button again.
Space returns to `sequence` from either mode.

Local tuning values live at their use sites. Shared timing and geometry contracts, retained buffers, uniforms,
and reusable materials keep named storage. Comments describe the current algorithm or feature. The app-specific
[code policies](../../../apps/hero/AGENTS.md) govern future changes.

Koota is pinned to `0.6.6-canary.63c1187`. The organization follows the local `minecraft-like` example. Each
domain is a module with explicit ownership. Trait files contain data models and defaults. Actions own world and
entity commands, including construction, disposal, view attachment, and discrete transitions. Systems sample inputs,
advance existing state, and invoke actions for commands. Renderers prepare mounted resources and attach them through
actions. Domain view systems update those resources while their view traits are attached. Only the files a domain needs exist.
Dependencies use domain actions, published state, or explicit inputs rather than reaching into another domain to
implement its transitions.

| Domain        | Ownership                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `sequence`    | Declarative timed and event cues, pending deadlines, cancellation, and dispatch                             |
| `time`        | Playback clock and bounded frame delta                                                                      |
| `input`       | Held keys, pointer state, DOM listeners, and pointer decay                                                  |
| `hero`        | Scene and pipeline composition, script, actor lifecycle, preparation, fonts, lighting, paper, and viewport  |
| `physics`     | Crashcat resource, body traits, actions, fixed stepping, and collision events                               |
| `letters`     | Title construction and motion, published landings, retained text, feature typing, glass, and projection     |
| `icon-paper`  | Icon sheets, bounded impact queue, spring simulation, morphs, and rendering                                 |
| `robot`       | Spawn/reset/run actions, path, published departure, physics target, dust, rig, and display                  |
| `black-hole`  | Collapse state and controls, play's feeding hole and its field, attraction functions, glyph warp, and sheet |
| `star-embers` | Emission age, prepared star particles, fire material, bloom, fading, and screen-space sparks                |
| `play-button` | Reveal timing, sheet geometry and hit test, mounted sheet camera, cursor state, and the display module      |
| `rain`        | Glyph rain in play: prepared glyph solids, drop pool, spawning, edge culling, fading, panes, and shadows    |

The root owns one Koota world and the combined action set. `world.ts` exports the shared world and invokes the hero initialization action.
Action sets define commands as arrow-function properties. Root `actions.ts` spreads the domain action sets.
Hero actions initialize the actors, load the declared script, and replay the experience.
Domain actions remain directly importable, including when names collide.
Physics actions configure the solver and install contact/removal handlers before actors spawn. Icon-paper actions
build each configured lattice before attaching its trait. Letter actions create, replay, and dispose title bodies,
while letter systems own continuous lift and attraction updates.

`hero/actions.ts` declares each mode's script as cues with `at`, or `on` and optional `after`, plus an action
callback. Initialization loads one opening cue that replays after one playback second. The sequence script types
the tagline 0.55 seconds after a letter landing and runs the robot 1.4 seconds after it, and robot departure opens
the black hole. The play script is empty: nothing types above the title in play. Repeated landing events restart
their pending delays.
Replay and play both load their mode's script, which drops any pending cues, and reset the actors. The sequence
lifts and smashes the title down again; play settles it on the floor where it belongs, with letters the hole took
returning home and nothing lifted, takes the tagline off, and places the robot beyond the lower-left edge to drive
to a spot above the title.
`pressHero` takes a normalized screen point and drives the robot to that floor point. In the sequence it first
takes the wheel while the hole is closed: with the title dropped it switches mode, loads the play script, retracts
the tagline, and keeps the robot's pose if it is on the floor; before the first drop it restarts into play. Once
the hole has opened it only answers a press on the drawn Play button, which restarts into play.
`sequence` knows only the clock, cue declarations, and retained deadlines. It runs due commands in chronological
order, breaking ties by declaration order, re-reading the timeline after each cue so a cue may replace it. Each
scheduled cue runs once, and events can rearm their cues.
Two focused tests cover ordering, event delays, retriggering, and timeline replacement during dispatch.

`frameloop.ts` lists the domain systems in their execution order. Sequence cues run before motion, after robot
departure, and after letter landings so events take effect in the same frame. The scripted robot mover runs only in
`sequence` and the pointer-driven mover only in `play`; both publish the same pose and footprint. Motion targets
precede physics, and title poses synchronize after physics. The tagline is off the paper until the title's first landing, types in
three frames a character, and backspaces out one a frame when cleared on the paper; cleared after the hole took it,
it is simply gone. A typing test covers both directions. `hero/systems.ts` scrolls mounted paper, turns
landings into icon-paper impacts, and forwards landing and departure events to the script. Icon-paper, title, and star-ember
systems read published black-hole state. Feature typing owns its closed-hole condition. The physics solver
depends on the clock and its own state.

`main.tsx` mounts `<App />` inside StrictMode. Root `app.tsx` owns the application shell, world provider,
loading screen, Canvas, and Suspense boundary. It mounts `<Hero />` from `hero/renderer.tsx` as the
scene, alongside `<FrameLoop />` from root `frameloop.ts`. Hero owns scene composition and post-processing.
The frame loop mounts viewport and DOM input hooks and runs domain simulation at 60 Hz using
the scheduler's timestamp. Domain systems remain independent of React. The lift check steps the same registered
simulation job used during playback.
`useViewport(world)` publishes R3F viewport dimensions, camera depth, and aspect into the existing world-level
`Viewport` trait through a domain action in a layout effect. React changes synchronize before frames consume them,
independently of readiness or a simulation tick. Systems read the trait without accessing React or R3F.
Clock advancement runs after the simulation readiness gate, so time
retains its initial values during preparation. `updateTime` only samples the timestamp and accumulates a bounded
delta. `useHeroReady()` subscribes to preparation status, and the frame loop captures its `isReady` value in the
keyboard hook and frame callbacks. `useKeyboard` synchronizes a world-level `Keys` set through input actions and
issues the explicit replay command inside its event effect on the first Space keydown. `usePointer` owns pointer
listeners and synchronizes normalized position and activity together from DOM events using the canvas bounds, and
hands each primary-button press to `pressHero` once playback is ready.
Leaving or cancelling the pointer, losing window focus, or unmounting clears activity. The pointer publishes two
things: whether it is present over the canvas, and a strength that the frame loop fades over time once it stops
moving. The lattice reads the strength, so its disturbance settles; the play button reads presence, so it stays
lit under a resting pointer. Shadow captures follow the title's published draw group: whenever the mounted `TitleView` holds a new group, as
after a title remount under hot module replacement, the projection recaptures from it, so readiness plays no part;
the lens capture follows the same groups the same way. Root `hmr.ts` keeps one set of uniforms across a module
replacement: a set is written every frame by a mounted view and read once by the render pipeline when its node
graph is built, and the two import it from the same module but re-execute at their own times, so a fresh set on
replacement would leave the writer and the reader on different objects and the simulation would carry on while
the frame stopped answering it. The hole's, the embers', and the play button's uniforms are kept this way. Outside
development nothing is replaced and every caller builds its own. A second ordered job publishes
view state after renderer preparation callbacks and before the final render.
It updates paper, title and icon draws, feature text, robot pose, rig animation, robot display, dust, the black hole,
embers, the play button, and glass shadows. Both jobs are capped at 60 fps. View systems read attached resource traits, so detaching
a view stops updates before its renderer disposes the resources. Hidden mounted resources remain available for
preparation. Shadow time belongs to the mounted projection. Simulation systems do not construct shaders.
The app publishes no development globals or pause controls. Browser checks import the same world module
and read domain traits, while diagnostic render buffers remain private to their renderer.
`hero/prepare.ts` owns preparation requirements and status subscriptions. `hero/loading.tsx` renders the loading overlay. `hero/fonts.ts` loads the fonts, `hero/lighting.tsx` defines the
lighting and paper, and `hero/hooks.ts` synchronizes viewport state owned by hero traits and actions. Preparation owns readiness without mirroring
it into another trait. There is no separate view domain.
The source root contains `main.tsx`, `app.tsx`, `frameloop.ts`, `world.ts`, `actions.ts`, and shared deterministic helpers in `utils.ts`.
Domain roots expose traits, actions, systems, renderers, and materials where needed.
`materials.ts` groups each domain's uniforms with the shader graphs and material builders that use them.
Domain behavior stays with its owner: black-hole beats, robot motion and dust, letter synchronization, and
icon-paper simulation live in systems. Icon-paper actions build the lattice, and traits contain its data models.
Shared content lives in each domain's `content.ts`. Letters own retained typing in `text.ts` and glass projection
in `shadows.tsx`. Only small attraction calculations, cell transforms, outline conversion, and physics pose
conversion remain in `utils.ts`. Trivial object defaults are inlined at their allocation sites. Simulation does not import React or shader construction.
Domain tests remain beside their implementations.

Scalar-bearing traits use Koota SoA schemas. Per-field factories retain each entity's math tuples,
buffers, motion records, and pools. Opaque resources use AoS, including `Physics` with its entity map, callbacks,
and scratch, the held-key set, and mounted view bundles with scene objects and uniforms. High-frequency values never pass through React state. SoA `get()` returns a snapshot,
so actions and singleton updates publish scalar changes with `set`, and systems sample current scalar
state. Query mutations use `updateEach`, while composition reads published landings and departures with `readEach`.
The robot body query selects only `Robot` for writeback, preserving the physics actions' writes to `Body`. Preparation
passes measured letter geometry into letter actions before playback. Those actions create bodies on the same
world and dispose them with the mounted title. View systems publish matrices and uniforms after simulation. Replay
closes the finale, restores the icon paper, lifts the title, and resets typing and robot scheduling through their owners.

The old, unmounted break/rewind presentation and its exclusive director and compressed recording code/tests were
removed during the Koota migration. The root cleanup also removed retired ink, glass, and silhouette variants and
their unused uniforms. Materials and post-processing now live in their domains. Browser checks own common playback stories: title lift and landing, robot dust, typed text, collapse, blackness,
and Space replay. Seven numerical tests retain precise evidence for baked title colliders and their counters, glyph transforms, edge-on motif changes,
bounded pointer response, lift/drop/revival with one landing notification, and robot pushes without tipping or
leaving an invisible collider behind. These checks catch errors that
pixel comparisons cannot isolate reliably. Two lifecycle tests cover paper following the playback clock, view replacement,
hidden mounted dust updates, and detached resources remaining untouched, and one mode test covers the press flow from
the button into play, presses driving the robot, the scripted run staying out of play, and Space returning. Buffer identity and duplicate timeline/path tests are omitted.

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
an immutable compound collider with a BVH, preserving counters and concave outlines. Triangle indices are resolved
against the contours after Three removes duplicate closing vertices. An independent quadratic area integral
checks that the extruded triangles preserve the filled glyph area, including counters. Only box, convex-hull,
and static-compound shape implementations are registered. World and shape creation are synchronous and happen
during preparation, without a physics Wasm download. Kinematic targets are kept in each body's current quaternion hemisphere before `moveKinematic`, because crashcat
0.0.5 reads the move's angle as `2 acos(w)` of the delta rotation: a yaw wrapping past a half turn would otherwise
read as a near full turn a step and fling any letter it touched off the screen. A physics test sweeps the robot
back and forth across the half turn against a letter and bounds the letter's speed.
`stepPhysics(world)` keeps 60 Hz updates with four collision substeps,
gravity along negative z, free translation and yaw, and locked pitch/roll. Material mixing preserves the configured
friction and bounce threshold. Hidden letters and the absent robot remain allocated on a noncolliding layer as
static bodies, then return to kinematic or dynamic motion when playback needs them. No colliders are rebuilt on replay.
Different solvers can produce different resting positions and contact timing. The migration preserves the interaction
and animation contracts rather than identical trajectories.

The icon paper composes glyph transforms directly, replacing 1,108 temporary Three groups. Its neighbour graph,
motif candidates, swap flags, selected records, and twelve wave slots are allocated once. Motif changes use a seeded
`math/random` generator on the frame clock; the next change waits 1.1 seconds from its last start. Each update visits
each cell and its four neighbours, plus active waves, at a bounded eight substeps: O(cells × (4 + active waves)) time
and O(cells) retained storage. Expired waves are excluded before the inner loop. A long frame discards excess
simulation backlog instead of accumulating work indefinitely.

In play the robot is a cart with a bounded turn rate: the desired heading sways either side of the bearing along
the trip and settles onto it over the last stretch, slow carts pivot harder so a target behind them stays reachable,
and speed brakes in time to stop. A floor marker at the destination, a ring in the title's red that lands from wide to
tight with slowly turning gaps around a dot, eases in on each press and out once the robot arrives; it stays mounted hidden so
its shader compiles during preparation. The pure `steer` step is tested for arrival all round, curvature, bounded turning,
and retargeting mid-trip. At rest the robot's face runs the scripted stop's clock from its look-up, so the greeting
is shared; the published `face` clock is what the display reads in both modes.

Two seconds into play, glyphs start raining: each drop is a glyph from the title font as a pane of stained glass in
one of the five theme tints, spawned as a dynamic body cut from its outline at the drop's size, falling from near the camera
under lighter gravity until it lands, where it weighs what the letters weigh and the robot can push it. Rain bodies
stack, so glyphs may land on letters and on each other; title letters keep their no-stack rule. A glyph pushed past
the edge is destroyed at once; with the pool full, the oldest glyph scales away first and the next drop waits for
its slot, one recycle at a time; leaving play fades them all.
Landings ripple nothing. Each glyph falls at its own angle with a little spin, and one going gathers itself for an
instant then scales away. Rain arrives above the solver's restitution threshold, so it bounces off the robot's
stadium, which carries a sloped roof and its own bounce; since a letter body cannot tip, a glyph that still comes to
rest on the robot's back is flicked off sideways by the rain system. The renderer cuts each slot's unit solid and
centres its glyph on the body's origin before playback. A rain pane composes as stained glass does, multiplying
whatever is beneath it, so panes overlapping each other or the title go dark where they cross and a pane over paper
tints the paper; the title's true refraction cannot see other glass, because the renderer's transmission pass holds
only the opaque scene. The pane is lit by the environment, so its highlights brighten what shows through, and it
uses WebGPU's premultiplied multiply blend with alpha one, which is exactly what is beneath times the pane. Its
ink is bent round the black hole through the same warp as the title's and the icon field's, so a pane near the
hole shows a warped letter rather than a straight one inside a warped quad. A rain test covers spawning, landing, edge culling, pool
recycling, and the stop, and a physics test the bounce off the robot.
Each drop casts the same coloured shadow and caustic as the title, from the same glass projection: rain panes are
physical glass materials named like the title's, each glyph is broken apart into a plain mesh under its slot once
shaped, and the rain publishes its root as a second capture source beside the title's draw group. The projection's
per-pixel march and blur cost the same however many panes it captures, so the rain adds only its draws into the
capture. A glyph falling from near the camera would stretch the march over the whole scene and coarsen every
shadow, so rain captures only over the last four units of the fall, and its shadow arrives just before it does.
A rain glyph is thin glass lying on the floor, and its shadow is cast that way: the title's projection assumes a
slab as thick as its letters, whose top the lamp's slant sets off beside the glass, so a small pane would see its
shadow shifted by most of itself. The normal capture carries each pane's slab depth in its spare channel, the
title's full slab or the rain's thin one, normalized by the coverage weight as the normals are and standing in the
full slab where the coverage has thinned to a soft edge, so the title's penumbra is exactly what it was while a
rain glyph's shade sits under and just around it, at two thirds of the title's weight. The glass-shadow check pins
the title's effect, tint, and depth response to their values before the rain cast anything.

Glass is also seen through glass. The renderer's transmission refracts only the opaque scene, so on its own a
letter bends the icon field beneath it but not another letter or a rain pane. `letters/lens.tsx` renders every
stained-glass draw from the scene camera, at half the frame's resolution, into the frontmost pane's shading
normal, view depth, coverage, refractive index and slab, every channel coverage-weighted so filtering the capture
at a pane's edge blends only real glass. A glass material reads the pane over its fragment, and where that pane
is nearer the camera than the fragment by more than a hair it shifts the point its own outline is integrated at
along the refracted ray into the pane, carried the pane's slab deep: the title's slab is its transmission
thickness, so a letter bends a letter exactly as it bends the paper, and a rain pane's is thin. The shift rides
the hole warp as one more displacement before the coverage integral, so a bent letter under glass is bent twice,
correctly. Meshes that share a material share one capture clone in both captures, since every node graph built is
preparation time. The captures, this one and the lamp's, read each glass material's coverage without the lens
through a registry the materials fill, since a capture must not read the texture it draws and the lamp's view has no
screen to read it at; that registry also gives the rain panes, which never set an opacity node, glyph-shaped
captures where they had quads. The capture is redrawn on the same terms as the shadow capture, and when the frame is resized. The capture target and its sampling nodes are kept across a module replacement
like the uniforms. `hero:glass-lens-check` holds one title letter a slab above another on WebGPU and verifies the
lens changes nothing at rest and, with the overlap, changes pixels only where glass lies.

Play's hole is a third beat of the hole state, `play`, beside the finale's `open` and `black`. The play script
opens it a beat after the rain starts, somewhere off the centre within a bounded offset that the collapse trait
carries as the hole's place, so the finale it becomes, the eaten glyphs' arcs, the drawn hole, the lattice, the
post pass's sheet collapse, lens and sparks, and the embers' burst all follow it. The hole's place is a floor position,
and everything at another depth carries it along the camera's ray to its own depth, as the horizon already was
scaled, so the field, the glyph warp, the bent lattice, and the drawn hole all sit over one screen point: the
view publishes the hole's place on screen as an offset from the centre, measured on the floor where the
viewport's extent is and negated down the frame, whose rows run the other way to the world's y, and the post pass
bends and winds the frame about that point; the sequence's finale opens at the centre.

Light bends toward the hole, so the post pass reads the frame around it from nearer in and it stretches outward:
the offset from the hole, pulled in by the square of its horizon over the distance, which is how far a ray
passing that far out is deflected. The horizon it is given is the apparent one, since the hole is drawn above the
floor and covers more of the frame than its horizon covers of the floor. The bend rises from nothing just outside
the hole's own ring of light and over the next horizon, which keeps what it reads always outside that ring
however hard it pulls, so the disk stays exactly the circle it was drawn, and it closes off a few horizons
further on so the far frame holds still rather than swimming. The finale check verifies the frame bends around
the hole, that the far frame does not, and that with the hole moved off the centre the bend gathers about it
rather than about its mirror, which is what an inverted screen axis would give. `advanceCollapse` drives it from its own clock while the
finale's is unset, easing its width up to what its meals have earned and swelling it into a gulp that decays over
a moment after each one, its pull flinching with it so nearby glass bends. `feedHole` runs after physics: every
landed rain glyph and every letter within the field, which reaches fourteen horizons out and so grows with the hole,
is set on a current, since friction would hold a body against any force it could be given. The field is wide and
weak: most of it is an orbit, a speed round the hole that quickens toward it, over an inward creep that is next to
nothing far out and grows only near, so a body settles into going round and round before it is much nearer; the orbit gives out over the last
horizons, where the creep becomes a rush, so nothing settles just outside. A letter rides the same current at two
thirds the pace. Whatever crosses the horizon is eaten, rain widening the hole a little and a letter by about as
much again, so the title alone does not fill it, and some forty meals to the finale's horizon, so what the hole
has caught has time to settle into orbit before it goes critical. An eaten glyph
loses its body at once and its glyph flies into the centre on the finale's tightening arc, stretched along it and
shrinking; an eaten letter leaves on the same flight from where it was, one letter at a time, each departure held
on the hole's clock beside the finale's, which sets them all at once. Rain still in the air passes over it. Once
the drawn hole, easing after its meals, reaches the finale's horizon it hands over to the finale timeline joined
where that hole is already open, so nothing shrinks to reopen, and the finale is congruent with what play built:
the collapse trait keeps the pull play's hole had at the handover and the finale's pull rises from there to full
instead of from nothing, and the tagline's glyphs fly in only as far as they had been typed, so play, with the
tagline off, sends none. Through the finale the same system draws the rain in and eats it on its own rushing
spiral whose speed is set by how far the finale has wound rather than by the pull, so nothing lurches at the
handover; the wind-up is squared over about a second, a brief hold and then a hard pull that is at full speed well
before the pop, and the title rides that field too instead of being sent off on the sequence's scripted departures: the
letters keep their places for a beat, then spin in faster and faster, each taken as the field carries it across
the horizon, and the pop takes the rest. The beat leaves the paper's cells on their springs and the title in place,
though the hole's gravity bends the sheet: within the field each cell still holding its springs is leaned in and
wound round the hole, so the paper strains toward it and springs back once it has gone, and none is swallowed;
the finale carries that bend on, letting go of it as each cell lets go, so the strain runs into the collapse.
Only the Play button answers a press while either mode's finale is open. Play's finale ends at the Play button
too, since the reveal follows the embers rather than the mode. A hole test feeds the hole from a rain glyph
pushed to it, checks the gulp and the settled width, carries a glyph a few horizons out about a quarter turn
round it in two seconds while it only creeps nearer, feeds it to the finale, checks the pull carries over and
only rises, and reaches the button in play. A lattice test bends the sheet under play's hole and lets it spring
back.

The play button lives on its own screen-space sheet with an orthographic camera fitted to the viewport aspect, so
its geometry and hit test share the pointer's normalized units. The hero's post pass renders that sheet after the
scene has gone black and adds it to the finished frame, which is why it survives the ember fade. Everything on it
is quantized to one pixel, two of the pixel font's squares. The frame is a rounded-rectangle distance field
evaluated at pixel centres, a one-pixel outline that draws itself round from the top, with its halo and pointer
fill held to a few levels. The label samples the font's coverage at the four squares of each pixel and lights the
pixel when at least half are ink, keeping the hair of a gap the font leaves between squares; the pixels
materialize in a fixed random order as the frame closes, lit by a sweep and by hover, and under the pointer the
frame blooms softly either side of its stroke, the one light on the button that is not on its pixel grid. The
reveal advances in twenty notches. Both stay mounted and compile during preparation, revealed by uniforms. `hero:play-button-check`
draws the button in on WebGPU, verifies that half way in only some of the pixels have lit and that hover brightens
it, and tiles the three moments with a close-up.
The finale check verifies the black frame stays black at the ember fade, the button then lights it, a press beside
it changes nothing, a press on it restores the paper with the robot driving, and Space returns to the sequence.

Robot path sampling, eye transitions, and floor footprints overwrite retained outputs. Consumers copy a footprint
when they need its previous-frame position. Dust uses 128 reusable particle records; saturation replaces the oldest
slot, movement above four units is treated as a teleport, and absent robots emit nothing. Title landings use a
fixed buffer and count; each released body reports its first floor contact once. Lift, departure, replay, and typing
reuse their original records. The robot collider and shadow capture list are prepared before playback. These
application-owned update kernels create no temporary arrays, collections, or pose objects; renderer and physics
library internals are outside that claim. Scene-authored dimensions and flight durations are positive, transforms
used as coordinate frames are invertible, and frame deltas are nonnegative.

The lattice tests compare direct transforms with Three's matrix composition, bound pointer disturbances, and check
edge-on motif substitution. The physics tests compose only clock and physics resources with the actors under test. They use real Crashcat contacts to verify bounce, one landing per release, revival, and robot pushes
without tipping or leaving collisions after departure. Dynamic letter contacts reject vertical support between
letters, so a falling letter reaches the floor instead of stacking on another letter. Side contacts still separate
the letters, and floor restitution still supplies the bounce. A regression drops partially overlapping bodies
and verifies they settle beside one another. `hero:collision-check` verifies the actual glyph bodies after the
robot push, allowing at most 0.04 units of floor-height error or penetration against the solver's 0.02 contact
slop. A coincident-shape control verifies that the overlap measurement detects intersections. WebGPU checks cover visible robot emission and fade, finale timing, and replay.

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
Keyup releases held keys, and window blur or keyboard-hook cleanup clears them. The opening browser check also
covers one replay per press, form input exclusion, key normalization, focus-loss cleanup, and pointer position
and activity from canvas events. It also verifies viewport initialization and a resize while the frame loop is stopped.

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

The `star-embers` domain owns its SoA emission age, actions, systems, renderer, and materials. Its actions initialize
and reset the age, while its synchronization system samples the published black-hole pop age.
`hero/renderer.tsx` composes the black-hole sheet warp with the ember bloom, fade, and sparks. The bloom takes
only what is brighter than white and runs at a quarter of the frame's resolution, plenty for a glow.

The ember material in `src/star-embers/materials.ts` keeps the exact Slug star silhouettes and shades each glyph's
own quad with a creamy hot core, an amber rim, moving fire noise, and gentle asynchronous flicker. As the stars
shrink, the surface cools toward orange; the composed stars and bloom still fade together. The WebGPU capture
compares this surface against a flat pastel control.

The six star shapes are baked from the vendored OFL Noto Sans Symbols 2 face, with the symbols shared between the
bake and the burst in `src/star-embers/traits.ts`. `hero:star-font` restores the pinned source and license, and
`hero:bake -- --only=stars` regenerates the tiny Slug subset. Both accept `--check`.

The timeline and feature-glyph paths are pure functions. The WebGPU finale check covers collapse, completion,
and replay from black.
`mise exec -- pnpm scripts run hero:hole-check` steps the actual WebGPU scene through six moments, compares collapsed
paper against an uncollapsed control, checks the luminous glyphs against a hidden control and the exact black frame, and verifies replay restores the
paper. It also checks the bloom against a disabled control and confirms stars and their bloom still linger at 0.8 seconds. Its filmstrip is saved at `apps/hero/.cache/hole.png`.

`mise exec -- pnpm scripts run hero:robot` packs the Sketchfab download (a multi-file glTF with 2048² textures)
into the single `assets/robot.glb` the app imports: the model's own floor disc is dropped, textures are reduced to
1024² WebP, and the animation is resampled. `--check` verifies the committed file is what the source still packs to.

The main render job is capped at 60 fps through R3F v10's native scheduler. Simulation and view publication are
capped separately, with glass-shadow updates last in the view job before the final render.

The scene uses the conference slides’ lime loading screen and centered black Poimandres mark, including
the subtle shake, reduced-motion support, and 400 ms fade when GPU preparation finishes. Preparation failures
remain visible in the overlay. It holds animation until all text, detached glyphs, physics bodies,
the robot, environment, dust, and burst are ready. Preparation renders hidden and offscreen objects through the
actual shadow, transmission, and post passes, compiles the scene, and waits for submitted GPU work before revealing
the normal visibility set. Browser checks wait for `data-hero-state="ready"`; readiness follows completed work,
not a fixed delay. Each phase also leaves a User Timing mark, and the performance check reports when each began:
on 2026-09-22 through the development server the app mounted at about 2.2 s, prepared for 1.5 s, and compiled for
0.65 s, with the preparing phase almost entirely Three building node graphs for materials rather than shaping.

Both typing lines retain their complete glyph records and precompute every prefix's centering with Glyph's own
layout during preparation. Playback changes matrices only, including the feature line's departure and replay.
The icon paper retains all eleven choices for each cell (12,188 glyph records across both layers); motif changes
swap visible records without reshaping text or creating draw meshes. This trades retained storage for stable playback.
The view keeps each cell's matrix as last written and writes a glyph only when the cell moved by more than a hair,
was swapped, or was swallowed, so a still sheet uploads nothing; a lattice test writes every cell once, then
nothing over thirty still frames, then again under the pointer.
`hero:retained-lines-check` compares all prefixes with independently shaped layouts and verifies transform reset.

`mise exec -- pnpm scripts run hero:performance` runs two complete lift, typing, robot,
collapse, and burst replays on WebGPU after preparation. It rejects new shader programs, render pipelines, scene
meshes, or asset loads, with a deliberate new-material control proving the compilation counters work. It reports
raw render intervals, CPU submission work, asynchronous GPU queue completion, GPU time from timestamp queries,
the preparation phases, how much the heap grows a frame and how often it is collected, and long tasks, along
with the adapter, viewport, and drawing-buffer dimensions. The canvas uses adaptive DPR
between 1 and 2, and the report records the actual drawing-buffer size for each run. Queue completion is latency,
not GPU time: on 2026-09-22 it read 9 ms while the GPU's own clock read 15 ms median and 32 ms at p95 for the
same 720p frames, and it had hidden a frame that would not survive a retina display.

The page opened with `?profile` creates the renderer with timestamp queries, `dpr` pins the pixel ratio, and
`nomsaa` and `nobloom` leave those out of the post pipeline. `mise exec -- pnpm scripts run hero:profile`, with
`--path "/?profile&dpr=2"` and the like, weighs the frame on that clock: with the title at rest it hides each
pass or layer in turn, the shadow capture, the receiver, the lens capture, the icon paper, the paper, the title,
the feature line, and the embers, and reports the median and p95 GPU milliseconds of each, then the finale's
moments with everything drawn. On the Apple GPU that produced these numbers, differences under about 3 ms are
noise, since lighter frames run at lower clocks and read slower; only the large differences are trusted. That profile found the resting frame at 11.1 ms at 720p and 38 ms at 2560 × 1440, with the shadow receiver's
march over half of it and the paper's noise most of the rest. After the march texture, the still-frame skips, the
quarter-resolution bloom, the coarser caustic grid, and the baked grain, the resting frame is 5.3 ms at 720p and
12.6 ms at 2560 × 1440. Teaching the captures what a still scene is worth another 2.9 ms at 2560 × 1440, 14.8 ms
to 11.9, and seventeen of its sixty passes.

The hero is bound by the GPU, and by fill rather than by passes. Over a whole playback at 720p the GPU's own
clock reads 8 to 12 ms a frame against 4.6 to 5.2 ms of CPU submission, so the CPU has half the work. The frame
draws forty to sixty passes, but the captures are fixed small targets and leaving the whole chain out at rest
costs nothing the profile can read; what the frame spends is the main pass, where the paper, the two icon sheets, the glass and the shadow receiver
each carry about a screen of fill, and four-sample multisampling over all of it is 3.2 ms of the 11.9 at
2560 × 1440, a little over a quarter. The costliest thing in it was not the shading but the renderer's back-face
pass: a double-sided transmissive material is drawn twice, back faces then front, which a closed solid needs and
a flat pane does not, and the title's letters are flat panes. Drawing them once, from whichever side faces the
camera, took 4.8 ms off a 15.7 ms resting frame at 2560 × 1440, as much as hiding the glass altogether, and left
the letters looking as they did. Dispersion is the next of it, three samples of the frame behind rather than one, worth 2.5 ms and the chromatic
fringe.

Collection is not where the rest is. Over a playback the heap grows about six hundred kilobytes a frame and is
collected some forty times, but the profiler's own account puts collection at 111 ms of 28.4 s, a hundredth of
the busy time and a two hundred and fiftieth of the wall, and its cost shows as the odd twenty-millisecond pause
rather than a tax on every frame. Attributing that allocation to a system is beyond what the browser's heap
reading can tell: it is quantized coarsely enough that over the profile's short windows a collection landing
inside one swamps what the frames allocated, which is why the profile reports passes and draws but not
allocation. Doing it properly wants an allocation sampler, which is a debugger-protocol domain the probes cannot
reach from inside the page. The glyphs are antialiased by that multisampling
through alpha-to-coverage, so it is not free to drop; the levers left are the pixel ratio, the sample count, and
folding the receiver into the sheets it darkens. Over a whole playback at 720p, where the
lift and the finale redraw the captures every frame, the performance check's GPU median runs 8 to 12 ms from one
run to the next, from 15 before; run-to-run spread on this machine is about a millisecond at rest and more in
motion, so a claim needs more than one run.

With world-backed keyboard input, two complete 1280×720 replays on Apple Metal with Chromium 149 averaged 60.01 fps
across 1,703 frames after 3.20 seconds of preparation. No late shader programs, pipelines, meshes, assets, or long
tasks were observed. Render intervals were 17.4 ms at p95 and 25.0 ms worst, with no intervals over 25 ms.
CPU submission time was 4.4 ms at p95, and browser GPU queue completion was 8.9 ms at p95.
Earlier SoA runs on this host averaged 58.38 and 58.46 fps, while the preceding AoS commit (`64fcb3bd`) averaged
58.00 fps. These separate runs show variable pacing and do not establish a speedup from the domain extraction.
They verify resource preparation but do not measure delivery through a screen recorder or guarantee steady 60 fps.

The full hero package check passes, including seven numerical tests, two timeline tests, two mounted-view lifecycle tests, all five font bake checks, and the production
build. WebGPU checks cover title lift and landing, both retained typing lines, the black-hole finale, and replay.
The production entry bundle is 600.07 kB gzip, down from 609.11 kB before removing the alternate scene.

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
pane's lens normal. The shadow marches each texel of the receiving plane toward the light through that field,
treating every flat letter as a slab 1.2 units deep, so the glyphs throw a soft, extruded, tinted shadow that leans
slightly down and to the left. The march's samples are spaced quadratically and its range follows the highest
letter, which the title's bodies publish each physics step because the poses live in the glyph instance buffer.
It is drawn into a texture over the plane at the capture's resolution, which is all the detail the blurred capture
holds, and the multiply-blended receiver reads that texture back with one sample a pixel, so the march costs the
plane's texels rather than every screen pixel; at a retina pixel ratio that was over half the frame. The capture, its four-level Gaussian pyramid, and the march are redrawn only when the scene under the lamp has
stirred: a pane's own matrix or visibility, the title's letter transforms, which live in one instanced draw whose
container never moves, any glass value the capture carries, the reach, a caster showing, or the hole pulling,
which bends every outline. A body at rest still settles by hairs, so a move counts only past a fraction of a
pixel; an exact comparison redrew every frame for a scene that had stopped. The pyramid's blur nodes are run by
hand at that moment rather than every frame. The lens capture follows the same rule. Under the lamp's perspective a lifted letter's shadow grows and spreads beneath it
as the letter grows on screen, softening and thinning through the pyramid blended by height, and settles back to
the same pixels on landing. The light the glass turns aside returns as caustics every frame, since their facets
turn with time: a 128 × 80 grid over the plane, eight capture texels a cell since the warped grid is blurred after,
is carried in its vertex shader to where each ray lands after refracting through the lens normal, an edge chamfer,
and two slowly turning lattices of facets, once per colour channel with a small index spread, and its brightness
is the source area gathering in each pixel, so the light pools into faint, spectrally fringed glints inside the
shadow. The robot casts in the same projection: its model sits on a caster layer, and while it shows, the capture also
draws the main scene under the lamp with that layer alone and an override that writes no tint, so it pools no
light, and a little over half the weight, so its shade reads beside the tinted glass rather than as a hole;
skinning and joints come with the objects, which clones would lose. The scene's background is left out of that
draw, or it would fill the capture as pale glass everywhere and wash every shadow off the frame. The black hole
casts too, as a disk the size of its drawn core at the height it is drawn, so the lamp's slant throws its shade
well down and to the left of it rather than into a lump under it; the march's samples are spaced quadratically,
so reaching that high still leaves more than half of them under the letters. Both are redrawn every frame they
show, since neither is ever still then, at no cost the profile can tell apart, and both are drawn once while
hidden during preparation so their programs compile there rather than when they first appear. The robot check
verifies its shadow against the robot taken off that layer and that the frame away from it is untouched; the
finale check verifies the hole's against its shade turned off, with its lens off for both so the shade is
measured where it falls. It is an art-directed projection, not multi-bounce light transport.

The paper behind everything is grain: three octaves of noise whose height tints and roughens the sheet and whose
slope tilts its normal. A plane the size of the screen at a retina pixel ratio asked for those octaves millions
of times a frame, a third of the frame. The grain is baked once, when the paper mounts, into a 2048-texel tile
over 32 world units that wraps, blended from four copies of itself shifted a tile along each axis and weighted so
the copies agree along every edge; the slope is taken across the tile's texels and scaled to the screen pixel it
used to be taken across, so the look is the same at every pixel ratio. The paper reads height and slope back with
one sample, scrolled with the icon paper. The tile is kept across a module replacement like the uniforms.

`mise exec -- pnpm scripts run hero:refraction-check` verifies the five visible stained-glass finishes against an
untinted control on WebGPU and checks repeated captures and resizing.
`mise exec -- pnpm scripts run hero:lift-sheet` verifies the automatic opening beat, steps its physics deterministically,
and tiles four moments of the lift and smash into `apps/hero/.cache/lift-sheet.png`.
`mise exec -- pnpm scripts run hero:glass-shadow-check` compares the projection with disabled and untinted
controls, lifts the actual draw surfaces while keeping visible glass fixed for the readback, and verifies an
exact return to the original pixels after lowering them. Both run through Vitexec, fail on browser errors,
and save scene readbacks under `apps/hero/.cache/`.

`pnpm --filter @pmndrs/glyph-hero dev` starts the development server. `bake` and `bake:check` drive the five font
assets through the Glyph CLI, and `check` runs typecheck, lint, format, unit tests, the bake staleness check, and the
build. `mise exec -- pnpm scripts run hero:format` applies the repository formatter to the app.
`hero:bake -- --only=<asset-name>` limits a bake to one face. Geist Black, Geist Mono Bold, and Geist Pixel
Grid include Basic Latin. The tagline adds its punctuation to Mono Bold. Icons and stars include only the symbols
used by their domains. `useFonts` preloads four Slug fonts and the tagline's MSDF font before rendering the scene,
and each renderer receives only the fonts it draws. The origin scene, video, multilingual faces, unused copy, and
alternate scene switch are removed.
