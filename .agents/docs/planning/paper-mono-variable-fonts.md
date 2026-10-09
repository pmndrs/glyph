---
type: Feature Plan
title: Variable TrueType implementation handoff with Paper Mono
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
  at: '2026-10-09T05:59:43.820423+00:00'
---

# Variable TrueType implementation handoff with Paper Mono

[#99](https://github.com/pmndrs/glyph/issues/99) owns coherent live variation state and shaping;
[#244](https://github.com/pmndrs/glyph/issues/244) owns the shared outline representation. The later #244
maintainer decision includes variable outlines, superseding the original exclusion. This plan preserves that
scope. Main still rejects variable input; this draft contains research, not product support.

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

## Reproduce and continue

Run `mise exec -- pnpm scripts run glyph:paper-mono-outline-stream-check` from the repository root.
It requires uv, pinned fontTools 4.59.2 and vendored HarfBuzz 14.2.0, authenticates the downloaded source
font by SHA-256, and compares regenerated evidence without writing. `--write` is an intentional evidence
refresh, not a way to accept an unexplained difference. No font binary is added to the repository.

Read the [full report](../reports/2026-10-08-paper-mono-support.md) for independent oracle boundaries,
negative controls, measured sizes and unsupported cases; the [issue acceptance proposal](../reports/2026-10-08-paper-mono-issue-99-proposal.md)
records the scope carried into #99. The linked outline decisions are pinned experimental provenance,
not a claim that the unmerged implementation is already available on main.
