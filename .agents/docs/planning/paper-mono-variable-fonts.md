---
type: Feature Plan
title: Implement variable TrueType fonts with Paper Mono acceptance
description: Implementation boundaries and acceptance gates derived from the variable outline design and independent Paper Mono CPU validation.
status: draft
tags: [variable-fonts, outlines, paper-mono, shaping, slug]
sources:
  - resource: https://github.com/pmndrs/glyph/issues/99
  - resource: https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243
  - resource: https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/variable-font-outline-stream.md
  - resource: https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/outline-stream-format.md
  - resource: ../reports/2026-10-08-paper-mono-support.md
  - resource: ../../../packages/glyph/research/paper-mono/validate.py
generated:
  by: openai-codex/gpt-6
  at: '2026-10-09T06:09:10.415130+00:00'
---

# Implement variable TrueType fonts with Paper Mono acceptance

[#99](https://github.com/pmndrs/glyph/issues/99) owns coherent live variation state and shaping;
[#244](https://github.com/pmndrs/glyph/issues/244) owns the shared outline representation. The later #244
maintainer decision includes variable outlines, superseding the original exclusion. This plan preserves that
scope. Draft PR [#269](https://github.com/pmndrs/glyph/pull/269) is the implementation work item for this
feature and its production acceptance tests. Main still rejects variable input. The implementation and
production harness are not built yet; passing the existing Python experiment does not complete this PR.

## Blocking dependency: new shared outline format

Build on [#244](https://github.com/pmndrs/glyph/issues/244), specifically its later variable-outline decision,
not the old fixed quadratic representation from merged #235. The
[format design](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/outline-stream-format.md)
and [variable-stream design](https://github.com/pmndrs/glyph/blob/dcd04cc70e470a27110bff2602905ceb5e465092/.agents/docs/planning/decisions/variable-font-outline-stream.md)
are pinned to the experimental `spike/outline-stream-gpu` branch. No production format PR was identified in
the current PR inventory. The dependency must deliver original-order source points, contours/components,
base triplet planes, sparse `gvar`/region/axis records, and the source-point-to-render-slot projection.
Do not duplicate that decoder or ship a Paper-only format to unblock variable support.

The draft stays on main until a real implementation dependency exists. If it becomes a dependent branch,
use the repository's gh-stack workflow; a conceptual issue dependency is not an existing GitHub stack.

## Representation and ownership

Use one original-point-order TrueType base stream plus sparse region-major `gvar` deltas. Preserve explicit
midpoints and contour boundaries: point numbers are variation identities. Normalize one canonical coordinate
location through `fvar` and `avar`; decode, apply tuple IUP, instance, expand composites, then map to GPU slots.
The immutable original model stays the source of truth. GPU wrap slots are a projection, not new `gvar` points.
Keep shaping variation tables (including metrics and feature variations) in the shaping payload.

Use existing font/instance ownership and publication generations. Outlines, shaping plans, metrics, bounds,
raster products and bands must use the same location and instance identity. A weight change cannot retain a
cache key that silently denotes the old instance. Choose immutable instance handles or a coherent generation
model before exposing runtime coordinates. No new public signature is decided by this spike.

Slug band membership and descending early-exit order must follow the instance. Reusing default bands fails
this fixture. Rebuild exact bands first; a conservative reusable scheme needs separate proof and benchmarks.

## Implementation sequence and acceptance gates

1. Define canonical coordinate validation/normalization and instance/cache identity. Specify rejected axes,
   out-of-range policy and normative metric rounding; HarfBuzz/fontTools have 45 one-unit HVAR disagreements.
2. Implement the shared original-order stream and dynamic instancer behind the current baker/core boundary.
   Preserve component flags, including `ROUND_XY_TO_GRID`, or prove normalization. Paper's integral offsets
   do not validate dropping that flag. Fonts without HVAR need phantom-point metrics or a precise rejection.
3. Synchronize shaping, outline geometry, exact bounds and Slug bands in one accepted publication. Failed
   updates must retain the prior accepted instance and resource leases.
4. Use the pinned Paper Mono workflow as the initial independent CPU gate: all 800 glyphs at 19 locations,
   round trips, points/topology/bounds, f32 policy, GPU-slot representation and `ss02` shaping/advances.
   `ss02` uses 606/758 units, about 1.25× rather than 2×; duospacing does not require a two-cell grid.
5. Add deterministic differential/property/fuzz coverage for coordinate changes, cache invalidation, tuple
   sparsity, IUP, malformed streams, composite flags and failure recovery. Extend fixture coverage for
   first-off/all-off contours, transformed/nested/point-matched components, no-HVAR phantom metrics and
   multi-axis interactions before claiming general TrueType support.
6. Execute browser GPU readback/visual tests across supported renderer backends, including coordinate
   changes and Slug early-exit negative controls. CPU GPU-slot checks do not establish GPU execution.
7. Measure final compressed artifacts, instancing, shaping, band rebuilds, upload bytes and frame time.
   Keep existing no-op/paint-only fast paths and run representative Labs before production admission.

CFF2, VARC and avar2 require their own representation/validation gates. Paper does not exercise them.
The research decoder consumes authenticated, locally generated data; it is not a production parser.

## Paper Mono production acceptance harness to build

The harness must exercise the package being shipped, not serialize the Python candidate and validate itself.
Keep the existing Python experiment as the reference-design/oracle preparation lane, explicitly separate from
production pass/fail. Reuse its authenticated source and independent HarfBuzz/fontTools outputs.

- Download the variable TTF at commit `e6eaeceaef02e77e3db997711e07a16378de2bd7`, authenticate SHA-256
  `43369c40e211aab9dda29464b0d715c9f20d90118626a56659607108c9c03dfe`, and prepare it once through
  the shipped baker. Preserve one reusable base/delta artifact; 19 static bakes do not prove live variation.
- Load/register that artifact through the installed public package. Change coordinates through the eventual
  public variation API; do not use the Python instancer as the candidate or reach into private runtime state.
- At weights 100/400/650/800 and each interior avar knot at the knot and ±0.01 (19 locations), inspect
  all 800 production glyph outlines, bounds and shaping/metric results. Compare source-order points at
  the producer boundary and public outline geometry against independent oracle exports. Choose and
  enforce the metric rounding policy rather than hiding the 45 known one-unit differences.
- Shape the 16 ss02 letters with the feature off/on and check glyph identities, 606/758 advances,
  positions and their matching instanced outlines. Also exercise kerning and ordinary text; the current
  ss02 probe disables kerning and is not complete shaping coverage.
- Revisit weights in both directions, repeat the same coordinates, interleave two independent instances,
  and change coordinates while text/layout/paint edits occur. Prove no stale caches, cross-instance
  contamination, redundant no-op/paint-only reshaping, or partial accepted publication.
- Render actual instances in Three WebGPU/WebGL2 and TypeGPU where the feature is implemented.
  Compare readbacks/coverage with independent reference outlines, especially curve extrema and
  band boundaries. Validate dynamic Slug band membership and early-exit sorting after each change.
  Bitmap/MTSDF output, when offered for variable instances, must regenerate or select the matching
  instance's raster; old-weight coverage cannot remain attached to new metrics/outlines.
- Exercise rejected coordinates, malformed artifacts, disposal, retained old instances and failed raster
  updates through reachable APIs. Add deterministic mutation replay and wire-format fuzzing alongside
  installed-consumer tests; expose the finished acceptance workflow in the root scripts index and CI.
- Record compiled stream/package sizes, instancing/shaping/band costs, upload bytes and warmed frame
  times. Compare static-font, no-op and paint-only Labs against main; do not accept a broad regression
  as the price of adding variable support.

Until this lane invokes the production implementation, the draft cannot be marked ready or close #99.

## What Paper Mono leaves untested

| Feature                                       | Paper evidence                           | Additional gate                                                                 |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Multiple axes and interactions                | One wght axis only                       | Multi-axis fixture and coordinate/cache replay                                  |
| avar2 and cross-axis mapping                  | avar v1 only                             | avar2 fixture and independent mapping oracle                                    |
| CFF2 blend outlines and VARC                  | Neither table present                    | Separate format/instancer designs and fixtures                                  |
| Transformed, nested, point-matched composites | None in Paper                            | Composite fixtures including flags, scaled offsets and USE_MY_METRICS           |
| ROUND_XY_TO_GRID behavior                     | Flag present, tested offsets integral    | Fractional offset cases; preserve flag or prove normalization                   |
| No-HVAR phantom metrics and vertical metrics  | HVAR present; phantom deltas zero        | No-HVAR, VVAR and MVAR fixtures                                                 |
| First-off and all-off contours                | Neither contour case present             | Fixtures preserving implied points and stable source identity                   |
| Variable shaping layout                       | ss02 and advances checked; kern disabled | GPOS/GDEF variation, GSUB FeatureVariations, kerning, vertical and script cases |
| Arbitrary sparse tuples and malformed streams | One authenticated font's tuple patterns  | Differential property tests and bounded decoder fuzzing                         |
| Production decoder, live runtime and GPU      | Existing proof is Python/CPU only        | Installed-package and browser acceptance harness above                          |

## Reproduce and continue

Run `mise exec -- pnpm scripts run glyph:paper-mono-outline-stream-check` from the repository root.
It requires uv, pinned fontTools 4.59.2 and vendored HarfBuzz 14.2.0, authenticates the downloaded source
font by SHA-256, and compares regenerated evidence without writing. `--write` is an intentional evidence
refresh, not a way to accept an unexplained difference. No font binary is added to the repository.

Read the [full report](../reports/2026-10-08-paper-mono-support.md) for independent oracle boundaries,
negative controls, measured sizes and unsupported cases; the [issue acceptance proposal](../reports/2026-10-08-paper-mono-issue-99-proposal.md)
records the scope carried into #99. The linked outline decisions are pinned experimental provenance,
not a claim that the unmerged implementation is already available on main.
