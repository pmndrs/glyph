---
type: Decision
title: 'Variable fonts in the outline stream'
description: 'Variable fonts are in scope for the outline stream: deltas apply to stream points before the GPU layout is built, through a slot map built once; the measured delta layout, CFF2 method and Slug band approach are the direction, not yet fixed.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

# Variable fonts in the outline stream

## Decision

This records decision 8 on #244. The maintainer: "Answering how we solve variable fonts from this same change is a HUGE win and should be folded in". After the [variable-font study](../outline-stream-variable-font-study.md), they accepted f32 instancing ([outline SIMD scope](outline-simd-scope.md)) and said the other findings "look promising".

**Decided:**

- **Variable fonts are in scope for the outline format.** This replaces open question 4 in the body of #244 ("variation deltas are out of scope for now").
- **The point model carries them.** gvar stores per-point x/y deltas indexed by TrueType point number, off-curve points included, plus one point per component for composites. Keeping TrueType's point model and order, with composites on the wire, maps those deltas one-to-one onto stream points and component offsets.
- **Order of operations,** verified exact against fontTools:
  1. Decode base points and deltas in stream order, which is glyf order.
  2. Run IUP (interpolation of untouched points) per tuple, in the original contour order and boundaries, before any wrap point.
  3. Instance: `p = round(base + Σ scalar_r(axes) · Δ_r)`, in f32.
  4. Expand composites with the instanced component offsets, rounded as fontTools rounds them.
  5. Build the GPU layout: rotate contours to start on an on-curve point, append wrap points, synthesize midpoints for contours with no on-curve point, and tag x.

  Deltas apply before rotation. A synthesized midpoint must be computed from instanced points, not from a rounded base midpoint plus averaged deltas.

- **The slot map.** On/off flags never vary between instances, so contour rotation and the map from each GPU slot to its source point are instance-invariant. Build the map once at load. GPU-side instancing gathers through it, and a wrap slot copies its source point's delta. Applying stream-order deltas straight to GPU slots without the map corrupts 46–49% of slots on Inter full and 31–48% on Roboto Flex full.
- **Shaping tables stay out of the outline stream.** The variation tables shaping needs (`fvar`, `avar`, `HVAR`/`VVAR`, `MVAR`, the GDEF ItemVariationStore, GSUB FeatureVariations) belong to the shaping payload, #99.

**Direction from the study, not yet fixed** (each is still a gate or a recommendation):

- **TrueType wire:** the base triplet stream plus sparse, gvar-aligned delta streams (triplets with a zero-pair flag `0x80` and "previous delta" prediction, region-major), a region table and an axis table. Phantom points dropped while `HVAR` carries metrics.
- **CFF2:** convert all masters at once with compatible cu2qu, using real masters at each region peak ("basis B"), and code deltas point-major against the default master. One delta layout shared with TrueType is a gate.
- **Slug bands:** build bands against conservative bounds over the axes the application animates. This differs from the static-font default of shipping baked bands ([Slug reads the shared outline points](slug-shared-outline-points.md)); which applies to variable fonts is not decided, nor how an application names its animated axes.

## Why

**TrueType is exact:** with sparse deltas, IUP at load and f64 math, instancing matched `fontTools.varLib.instancer` with 0 mismatched coordinates at 34 axis locations, composites and ink bounds included. The accepted f32 path is 1 unit off on 13 of 637,680 stored coordinates (Inter full).

**Size:** 69–76% of `gvar` + `glyf` + `loca` (brotli). Deltas are 75–97% of the bytes.

**Speed (Node 22, SIMD build):** the f32 instancing step takes 0.13 ms for Inter full and 0.35 ms for Roboto Flex full. A full re-instance with composite expansion and ink bounds takes 0.26 and 0.43 ms. A full load (decode plus IUP) takes 2.6 and 9.3 ms.

**CFF2:** compatible conversion failed on 0 of 66,999 glyphs (1,464 Source Serif, 65,535 Noto CJK), at tolerances 1, 0.5 and 0.25.

**Slug bands:** default-instance bands miss references at other instances (Inter full at wght 900: 97,240 missing references, 2,899 of 2,911 glyphs affected). Conservative bands are correct at every tested location but hold 1.6× (Inter) to 3.1× (Roboto Flex) the references per band; wght-only bands cut Roboto Flex from 13.9 to 6.0.

## Consequences

**What it supersedes:** open question 4 of #244.

**What stays open:**

- one delta layout for TrueType and CFF2, including an exact sparse point-major layout for TrueType (only the lossy dense form was sized);
- keeping phantom points for fonts without `HVAR`;
- avar2, VARC, partial instancing and extrapolation;
- transformed or nested components (no fixture had them);
- GPU instancing measured on real hardware (WebGPU compute, WebGL2 render-to-texture);
- band rebuild cost per instance for CFF2 fonts.
