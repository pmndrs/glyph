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

**Slug bands for variable fonts** (maintainer, 2026-10-06):

- Try the build-at-load path first.
- Project how much data pre-baking variations would need.
- Look for a partial pre-bake that speeds up load and stays fully dynamic.

This is being measured; it is not settled.

**Direction from the study, not yet fixed** (each is still a gate or a recommendation):

- **TrueType wire:** the base triplet stream plus sparse, gvar-aligned delta streams (triplets with a zero-pair flag `0x80` and "previous delta" prediction, region-major), a region table and an axis table. Phantom points dropped while `HVAR` carries metrics.
- **CFF2:** convert all masters at once with compatible cu2qu, using real masters at each region peak ("basis B"), and code deltas point-major against the default master. One delta layout shared with TrueType is a gate.
- **Slug bands:** the [variable-font band study](../outline-stream-variable-font-bands-study.md) recommends an exact rebuild per instance: lazy per glyph, on every axis change, with the order-hinted builder.
  - It ships no extra bytes, matches the shader cost of static bands, and costs 0.62–1.39 ms per 200-glyph set per change in scalar Wasm.
  - For an animated wght on large fonts, the fallback is conservative-over-wght bands re-sorted on each change.
  - Not yet decided.

## Why

**TrueType is exact:** with sparse deltas, IUP at load and f64 math, instancing matched `fontTools.varLib.instancer` with 0 mismatched coordinates at 34 axis locations, composites and ink bounds included. The accepted f32 path is 1 unit off on 13 of 637,680 stored coordinates (Inter full).

**Size:** 69–76% of `gvar` + `glyf` + `loca` (brotli). Deltas are 75–97% of the bytes.

**Speed (Node 22, SIMD build):** the f32 instancing step takes 0.13 ms for Inter full and 0.35 ms for Roboto Flex full. A full re-instance with composite expansion and ink bounds takes 0.26 and 0.43 ms. A full load (decode plus IUP) takes 2.6 and 9.3 ms.

**CFF2:** compatible conversion failed on 0 of 66,999 glyphs (1,464 Source Serif, 65,535 Noto CJK), at tolerances 1, 0.5 and 0.25.

**Slug bands:** default-instance bands miss references at other instances (Inter full at wght 900: 97,240 missing references, 2,899 of 2,911 glyphs affected). The variable-font study reported conservative bands as correct. **That result does not hold for today's shader** (correction, 2026-10-06).

- The shader exits a band at the first curve whose _instanced_ maximum is half a pixel behind the sample (`slug-band.ts:102`, `core/band.ts:88–90`). It never reads a stored key.
- Lists sorted by conservative key are therefore out of order at most instances. Inter full shows 3.75 M adjacent inversions and 22,799 mismatched emulated-shader samples.
- The study's checker tested the stored-key condition instead.
- Conservative bands become correct only with one of: a re-sort on each change, a shader that exits on a stored key, or no early exit.
- See the [variable-font band study](../outline-stream-variable-font-bands-study.md).

## Consequences

**What it supersedes:** open question 4 of #244.

**What stays open:**

- one delta layout for TrueType and CFF2, including an exact sparse point-major layout for TrueType (only the lossy dense form was sized);
- keeping phantom points for fonts without `HVAR`;
- avar2, VARC, partial instancing and extrapolation;
- transformed or nested components (no fixture had them);
- GPU instancing measured on real hardware (WebGPU compute, WebGL2 render-to-texture);
- band rebuild cost per instance for CFF2 fonts.
