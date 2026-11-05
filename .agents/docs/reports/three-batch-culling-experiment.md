---
type: Engineering Report
title: Three batch culling compatibility experiment
description: Records supplied-bound compatibility with Three's existing frustum culler and the limits of the initial timing observations.
documentation_type: explanation
sources:
  - id: issue
    resource: https://github.com/pmndrs/glyph/issues/236
    title: Culling compatibility experiment scope
  - id: realizer
    resource: ../../../packages/glyph/src/three/internal/draw-realizer.ts
    title: Existing draw-to-mesh realization
  - id: experiment
    resource: ../../../benches/src/batch-culling-proof.ts
    title: Browser experiment and correctness controls
  - id: bounds
    resource: ../../../benches/src/benchmark/labs/batch-culling-bounds.ts
    title: Fixture-only supplied bounds policy
  - id: workflow
    resource: ../../../benches/scripts/verify-batch-culling.mts
    title: Repeatable browser workflow
  - id: samples
    resource: ../../../benches/fixtures/results/three-batch-culling-chromium156.json
    title: Raw samples, source hashes, browser and live device identity
generated:
  by: openai-codex/gpt-6
  at: '2026-11-05T02:13:42Z'
---

# Three batch culling compatibility experiment

Three's existing culler can skip the tested Glyph meshes when the application supplies conservative bounds in the
correct coordinate space. All 72 pixel comparisons passed on the recorded Apple GPU run. This does not establish
automatic bounds maintenance, general material compatibility, or a net performance win. Production culling remains
disabled and [#236](https://github.com/pmndrs/glyph/issues/236) remains open.

## Boundary and authority

The existing realizer emits one `THREE.Mesh` per instance span, split by resource/material/primitive requirements.
A logical batch is therefore not necessarily one mesh. The fixture uses 24 existing named publication roots, each with
one explicit `TextGroup` and one Bitmap Text with an underline: 48 meshes and 96 renderer-reported draw calls before
culling. The extra passes are retained in the measurements; mesh count is not treated as draw-call count.

Indexed transforms are shader-buffer inputs rather than mesh matrices; direct mode composes the paragraph transform
into the mesh. Default quad geometry bounds cannot account for the indexed glyph positions. The fixture supplies a
known local envelope covering its text, reflow and decoration, transforms it to world space, then assigns a conservative
mesh-local sphere to each known draw. It reads direct children of known publication nodes after edits, without searching
the scene. Three's normal matrix update, `scene.onBeforeRender` callback and normal frustum traversal retain authority.
There is no second culling pass or write to `visible`.

This intentionally tests root/publication boundaries. It does not implement a general mapping from every nested
TextGroup, resource span, or shared batch to a maintained bound. Unknown material displacement opts out. A shader which
moves an off-screen label 900 units back into view is tested with culling disabled, then with explicit displaced bounds.
Neither material identity nor `Text.boundingBox` is taken as proof of safe render bounds. The helper assumes the
fixture's invertible transforms and unshared geometries; singular transforms, arbitrary shear and general glyph-level
animation need their own conservative-bound policy before any production use.

## Correctness evidence

`benchmark:batch-culling` asserts the actual WebGPU/WebGL2 backend in both indexed and direct modes. Each combination
passed 18 exact byte comparisons against culling disabled: visible, fully off-screen, partially visible, camera motion,
moving/nested transforms, editing/reflow, editing while off-screen and returning, material replacement with supplied
bounds, displaced-material bounds, and static/moving/editing workloads before and after measurement. The scene uses a
256 × 128 linear RGBA target, fixed DPR, clear color and tone mapping; readback is the completion signal. Browser and
shader errors fail the run. Incorrect off-screen bounds deliberately remove visible glyphs, and the pixel oracle must
detect that negative control.

The recorded run used Three 0.185.1, Chromium 156.0.8078.80, live WebGPU identity `apple metal-3`, and WebGL2 identity
`ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)`. The raw report authenticates the experiment,
bounds helper, runner and font bytes with SHA-256. This is workspace-source evidence based on main `4e25a96a5`, rather
than an installed-package release comparison. MTSDF, Slug, mixed fonts/resources, perspective/stereo cameras and the
issue attachment's exact 1,000-label scene were not run in this experiment. Existing manual visibility coverage remains
in the Three integration suite, including the release-scale 1,000-label test.

## Cost observations

The run records 12 observations per mode for each workload, alternating mode order. Each moving/editing observation
resets to the same accepted text/constraint/position state before measuring the same edit, width reflow and movement.
Correctness readbacks warm both culling paths before timing. Reset renders and prior timestamp queries are drained
outside the measured observation. Static workloads have 22/24 visible boundaries or 2/24 visible boundaries.

Scene update/publication time, bounds assignment, and the renderer's native `Frustum.intersectsObject` calls are recorded
separately. The native-method wrapper observes the actual traversal and is restored at teardown. It adds timer overhead
and its small durations approach clock resolution. CPU render submission includes those subspans and backend work;
they must not be added to it again. GPU timestamp resolution happens after CPU timing, with unavailable results recorded
as null rather than zero. Initialization, readback, reset renders and end-to-end frame latency are not included in the
CPU submission field.

Selected **indexed-mode medians**, milliseconds, disabled → enabled; all direct-mode samples are also retained:

| Backend | Workload                          | CPU submission | Bounds enabled | Native tests enabled | GPU timestamp   |
| ------- | --------------------------------- | -------------- | -------------- | -------------------- | --------------- |
| WebGPU  | mostly visible, static            | 0.440 → 0.568  | 0.058          | 0.023                | 0.102 → 0.032   |
| WebGPU  | mostly visible, moving/editing    | 3.263 → 3.590  | 0.035          | 0.010                | 0.082 → 0.085   |
| WebGPU  | mostly off-screen, static         | 0.563 → 0.338  | 0.030          | 0.008                | 0.056 → 0.071   |
| WebGPU  | mostly off-screen, moving/editing | 3.293 → 2.648  | 0.030          | 0.010                | 0.059 → 0.084   |
| WebGL2  | mostly visible, static            | 0.955 → 1.020  | 0.070          | 0.030                | 8.133 → 6.902   |
| WebGL2  | mostly visible, moving/editing    | 4.028 → 3.840  | 0.038          | 0.010                | 12.952 → 10.959 |
| WebGL2  | mostly off-screen, static         | 0.790 → 0.413  | 0.035          | 0.005                | 5.245 → 3.165   |
| WebGL2  | mostly off-screen, moving/editing | 3.498 → 2.798  | 0.030          | 0.005                | 12.420 → 1.896  |

All four combinations reduced calls from 96 to 88 in mostly-visible workloads and from 96 to 8 in mostly-off-screen
workloads. Each enabled observation performed 48 native object tests; disabled observations performed zero. These are
small, instrumented, single-run observations on one machine, with varying GPU timings and visible-case CPU regressions.
They justify further measurement, not a speedup claim. The envelope is application-supplied: measuring its transformation
and assignment does not establish the cost of deriving conservative bounds from arbitrary dynamic glyph geometry.

## Reproduce and continue

Build Glyph, then run `mise exec -- pnpm scripts run benchmark:batch-culling -- --output=/absolute/path/report.json`
with the project Chromium selection. The workflow accepts the ordinary reported Vite origin or a caller-provided
`PORTLESS_URL`; Portless is not a project dependency. `--software-gpu` is available for compatibility investigation and
does not establish hardware performance. Inspect the recorded live renderer identity before interpreting timings.

The draft should remain an experiment. Before proposing production behavior, cover the missing raster/resource and
transform cases, establish the real automatic-bound producer and invalidation cost, and measure representative
installed-package workloads across devices. Continuing to manage batch boundaries and visibility manually remains a
valid outcome.
