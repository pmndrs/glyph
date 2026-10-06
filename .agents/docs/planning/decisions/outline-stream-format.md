---
type: Decision
title: 'Outline stream format'
description: 'Glyph outlines are stored as WOFF2-style triplet-coded TrueType-model points, decoded once into an i16 point buffer read three points at a time, and exposed through an em-space outlineAt() reader.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: process:docs-new
  at: '2026-10-06T13:09:21Z'
---

# Outline stream format

## Decision

**Wire format** (the `outlines` view of `PMNDRS_font`, under a new `outlines.format`):

- **Point model:** TrueType's.
  - Each point is on-curve or off-curve.
  - Two consecutive off-curve points imply an on-curve point at their midpoint, which is not stored.
  - Lines are two consecutive on-curve points, with no control point.
  - Contours are closed and keep the font's winding.
  - Point order is the font's own.
- **Planes:** `hdr`, `cn`, `comp`, `flags` and `data`, concatenated into one buffer view.
  - `hdr`: one varint per glyph (`0` empty, `2 × contours` simple, `2 × components + 1` composite).
  - `cn`: one varint per contour, its point count.
  - `comp`: per component, `varint(glyphId)`, the zigzag dx and dy, then a transform byte. `0` means none; `1` is followed by four F2DOT14 i16 values.
  - `flags`: one byte per point. Bit 7 set means off-curve; the low 7 bits are the WOFF2 triplet size class.
  - `data`: 1–4 bytes per point, the delta from the previous point. The first point of each glyph is relative to (0, 0).
- **Composites** stay on the wire.
- **Dropped:** hinting instructions and per-glyph bounding boxes.
- **CFF cubics** become quadratics at bake time with cu2qu. Tolerance and grid are open.

**GPU layout:**

- **Built at decode,** with composites expanded:
  - `glyphBase`: `u32[glyphCount + 1]`, the first point index of each glyph.
  - `points`: one 32-bit word per point, an i16 `(x << 1) | offCurve` followed by an i16 `y`, in font units.
- **Per contour:**
  1. Rotate the contour to start on an on-curve point. A contour with no on-curve point gets a synthesized midpoint start.
  2. Append one wrap point, a copy of the first point.
- **Read rule:** each off-curve `p[i]` is a quadratic with control `p[i]`. Its start is `p[i-1]` if that point is on-curve, else `mid(p[i-1], p[i])`. Its end is `p[i+1]` if that point is on-curve, else `mid(p[i], p[i+1])`.
- **Lines:** two consecutive on-curve points make a line.
- **Coefficients** are derived in registers; none are stored.

**API:** `outlineAt(index, target?)` returns a `GlyphOutlineReader`.

- **Coordinates:** em units, y down, origin at the glyph's pen position on the baseline.
- **Raw columns:** `points`, `contourEnds`, `segmentLines`.
- **Methods:** `curveAt(segment, target?)` and `isLine()`, plus `copy()` for an owned outline.
- **Scratch targets** make the call allocation-free.
- **The stored format stays private** behind the reader.

The issue comment [outline format decisions](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243) holds the full specification, worked example and size-class table.

## Why

See [outline stream research](../outline-stream-research.md) and the [encoding study](../outline-stream-encoding-study.md).

**Triplets are the smallest measured candidate on every font,** under both gzip and brotli.

- They are 44–77% of the source table #235 copies, and smaller than fontTools' WOFF2 glyf transform.
- The bit-packed proposal measured 1.4–2.1× larger, because bit widths hide the byte patterns gzip and brotli model.

**Keeping TrueType's point model and order** makes variable-font deltas apply directly, and composites stay compact.

**The i16 point layout** costs 5.1–6.2 bytes per curve against Slug's 8.2–8.7, and is exact.

**Rotation and the wrap point** mean every off-curve point has both neighbours, so the shader needs no wrap-around index logic.

**An em-space reader keyed by font and glyph id** lets callers cache shapes and GPU buffers once and place them with the layout's `x`, `y` and `fontSize`.

## Consequences

**What it supersedes:**

- #235's `opentype-sfnt-outlines-v0` copy of `glyf`/`loca`/`CFF` and its tuple-returning `outlineAt()`.
- The bit-packed blocks of 16 in the body of #244.

**What stays open:**

- full composite expansion;
- an exact start point for contours with no on-curve point (today it is rounded, which is lossy);
- CFF tolerance and grid;
- the coordinate range (`|x| < 16384`);
- line encoding in Slug.
