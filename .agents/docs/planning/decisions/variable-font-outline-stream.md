---
type: Decision
title: 'Variable fonts in the outline stream'
description: 'Variable fonts are in scope for the outline stream: sparse gvar-aligned delta streams instanced at load, with compatible cu2qu for CFF2 and conservative Slug bands.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: process:docs-new
  at: '2026-10-06T13:09:27Z'
---

# Variable fonts in the outline stream

## Decision

**TrueType:**

- **What ships:** the base triplet stream, plus sparse delta streams in stream point order, region-major, triplet-coded with a zero-pair flag and "previous delta" prediction, plus a region table and an axis table.
- **Phantom points** are dropped while `HVAR` carries metrics.

**Instancing, in this order:**

1. Decode.
2. Run IUP per tuple, in original contour order.
3. Instance in f32 SIMD.
4. Expand composites with rounded offsets.
5. Build the GPU layout through a slot-to-point map that is built once.

**CFF2:**

- Convert all masters at once with compatible cu2qu, using real masters at each region peak.
- Code deltas point-major against the default master.

**Slug bands:** build them against conservative bounds over the axes the application animates.

**Shaping:** the variation tables shaping needs (`fvar`, `avar`, `HVAR`/`VVAR`, `MVAR`, the GDEF ItemVariationStore, GSUB FeatureVariations) belong to the shaping payload, #99.

## Why

See the [variable-font study](../outline-stream-variable-font-study.md).

**TrueType is exact:** instancing matched `fontTools.varLib.instancer` with 0 mismatches at 34 locations, on the f64 path.

**Size:** 69–76% of `gvar` + `glyf` + `loca` (brotli).

**Speed:** re-instancing takes 0.13–0.35 ms per font in f32.

**CFF2:** compatible conversion failed on 0 of 66,999 glyphs.

**Slug bands:** default-instance bands miss references at other instances. Conservative bands are correct.

## Consequences

**What it supersedes:** open question 4 of #244 ("variation deltas are out of scope").

**What stays open:**

- one delta layout for TrueType and CFF2;
- keeping phantom points for fonts without `HVAR`;
- avar2 and VARC;
- transformed or nested components;
- GPU instancing measured on real hardware.
