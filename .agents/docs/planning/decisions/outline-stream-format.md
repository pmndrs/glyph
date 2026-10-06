---
type: Decision
title: 'Outline stream format'
description: 'Glyph outlines are stored as WOFF2-style triplet-coded TrueType-model points, decoded once into an i16 point buffer read three points at a time, and exposed as em-space outlineAt() views (borrowed) and curve tuples (owned).'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

# Outline stream format

## Decision

This records decisions 2, 4 and 9 of the issue comment [outline format decisions](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243), which is the implementation reference. The reference encoder is the study's `enc.py` (`triplets`, `comps_bytes`) and `enc3.py` (`stencil`), in `spikes/outline-stream/research/encoding/scripts/`. Where the code and the text disagree, raise it on #244 before implementing.

### Wire format

The `outlines` view of `PMNDRS_font`, under a new `outlines.format` value. The name is not decided; the study proposed `quadratic-stream-v1`.

**Point model:** TrueType's.

- Each point is on-curve or off-curve.
- Two consecutive off-curve points imply an on-curve point at their midpoint, which is not stored.
- Lines are two consecutive on-curve points, with no control point.
- Contours are closed and keep the font's winding. TrueType and CFF wind in opposite directions, so callers take the fill sign from the largest contour. That rule was reasoned from how each format winds its outer contours; it has not been checked against a baked glyph.
- Point order is the font's own. Variable-font deltas ([variable fonts in the outline stream](variable-font-outline-stream.md)) depend on it.

**Planes,** concatenated into one buffer view; HTTP compression handles transport:

| Plane   | Contents                                                                                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hdr`   | One LEB128 varint per glyph: `0` empty, `2 × contours` simple, `2 × components + 1` composite.                                                                                                                                                                  |
| `cn`    | One varint per contour of a simple glyph: its point count.                                                                                                                                                                                                      |
| `comp`  | Per component: `varint(glyphId)`, `varint(zigzag(dx))`, `varint(zigzag(dy))`, then a transform byte. `0` means no transform. `1` is followed by the 2×2 matrix as four little-endian i16 in F2DOT14 (`round(value × 16384)`), row-major as fontTools stores it. |
| `flags` | One byte per point. Bit 7 is `1` for off-curve. Bits 0–6 are the WOFF2 triplet size class.                                                                                                                                                                      |
| `data`  | 1–4 bytes per point, as the class dictates: the dx/dy delta from the previous point. The first point of each glyph is relative to (0, 0).                                                                                                                       |

**Triplet classes** (low 7 bits of the flag; the sign bits sit in the low bits of the class, as in WOFF2):

| Classes | Delta shape                                       | Data bytes |
| ------- | ------------------------------------------------- | ---------: |
| 0–9     | dx = 0, \|dy\| < 1280                             |          1 |
| 10–19   | dy = 0, \|dx\| < 1280                             |          1 |
| 20–83   | 1 ≤ \|dx\|, \|dy\| ≤ 64 (one nibble each)         |          1 |
| 84–119  | 1 ≤ \|dx\|, \|dy\| ≤ 768                          |          2 |
| 120–123 | \|dx\|, \|dy\| < 4096 (12 bits each)              |          3 |
| 124–127 | 16 bits each (big-endian magnitudes, as in WOFF2) |          4 |

**Composites** stay on the wire. Point-matched offsets and `ROUND_XY_TO_GRID` are not handled yet; they are part of the composite gate.

**Dropped:** hinting instructions and per-glyph bounding boxes. Nothing reads hinting today: the bitmap baker draws with `DrawSettings::unhinted` (`packages/glyph/rust/bitmap-baker/src/rasterize.rs`), and Slug and MTSDF are resolution-independent. Bounding boxes come from the points.

**CFF and CFF2 cubics** become quadratics at bake time with cu2qu, which emits quadratic splines with implied on-curve points, so they fit the same model. Tolerance and grid are open: 0.25 on a half-unit grid (≈ 0.5 units of error, still smaller than the source) or 0.5 on the integer grid (0.88–1.03 units, 22–28% smaller).

### GPU layout

Built at decode time from the wire format, with composites expanded:

- **`glyphBase`:** `u32[glyphCount + 1]`, the first point index of each glyph.
- **`points`:** one 32-bit word per point, in font units. `x` is an i16 holding `(x << 1) | offCurve`; `y` is a plain i16.
  - So `offCurve = x & 1` and the coordinate is `x >> 1` (arithmetic shift).
  - **Range:** `|x| < 16384` font units, and `y` keeps the full i16 range. On a half-unit grid (a CFF option), x is limited to `|x| < 8192` units. The study encoder asserts the bound; fonts with 4,096 or more units per em need a check or a fallback (gate).

**Per contour, in order:**

1. **Rotate the contour to start on an on-curve point.** Then the first curve's start is a real stored point, and every off-curve point has a previous point `p[i-1]`.
   - A contour with **no on-curve point** is legal in TrueType. The encoder then synthesizes an on-curve start at the midpoint of the last and first points and puts it first.
   - **Caveat:** the study encoder floors that midpoint to an integer (`(a + b) // 2` in `enc3.py`), which is lossy when the sum is odd. Fix it before shipping, with half-unit coordinates or a flag that has the shader compute the midpoint. For variable fonts the midpoint must be computed from instanced points.
2. **Append a wrap point,** a copy of the first point, after the last point. Then `p[i+1]` exists at the last curve, and the shader needs no wrap-around index logic.

**Read rule,** for each point index `i` of a contour, excluding the wrap point:

| Point `i` | Next point `i + 1` | Segment                                                                                                                                                    |
| --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| off-curve | any                | Quadratic with control `p[i]`. Start is `p[i-1]` if it is on-curve, else `mid(p[i-1], p[i])`. End is `p[i+1]` if it is on-curve, else `mid(p[i], p[i+1])`. |
| on-curve  | on-curve           | Line from `p[i]` to `p[i+1]`.                                                                                                                              |
| on-curve  | off-curve          | No segment. `p[i]` is the start of the next quadratic.                                                                                                     |

**Worked example:** `A(on) B(off) C(off) D(on)` is stored as `A B C D A` after the wrap. Reading at `B` gives the quadratic `A, B, mid(B, C)`; at `C`, `mid(B, C), C, D`; at `D`, the closing line `D → A`.

Earlier comments call this read "the stencil", in the numerical sense of a fixed neighbourhood. It has nothing to do with the GPU stencil buffer.

**Coefficients** are derived in registers from the three points; none are stored. With implied points they are the first and second differences of the stored points, so storing them would only add bytes.

- **Power basis,** for Slug's root solve: `a = p0 − 2·p1 + p2`, `b = 2·(p1 − p0)`.
- **Implicit form,** for an inside test or distance in other rasterizers: use the [comment on #244](https://github.com/pmndrs/glyph/issues/244#issuecomment-5997423622) with **A and B negated**, `A = 2·y1 − y0 − y2` and `B = x0 − 2·x1 + x2`. C, D, E and F are correct as posted. As posted, F does not vanish on the curve (worst |F| = 4·Δ²); with the fix the worst is 1.8e-12·Δ² over 2,000 random curves, and f32 gave 0 wrong inside/outside signs in 48,000 samples at font-unit scale.

### `outlineAt()` API

Revised with the maintainer on 2026-10-06; the [#235 API comment](https://github.com/pmndrs/glyph/pull/235#issuecomment-6009755243) has the full proposal. There is **no reader object**. `withGlyphs` is written as `readGlyphs`, following #238.

- **Coordinates:** em units (1.0 is the font size), origin at the glyph's pen position on the baseline, y down, like every other box the layout publishes. Place a point with `x = glyph.x + ex · glyph.fontSize` and `y = glyph.y + ey · glyph.fontSize`.
- **Borrowed path:** `readGlyphs((glyphs) => glyphs.outlineAt(index, target?))` returns a plain `GlyphOutlineView`.
  - Fields: `fontHandle`, `glyphId`, and typed-array views `points`, `contourEnds` and `segmentLines`. Equal keys mean identical outlines.
  - The optional `target` is refilled, which saves only the holder allocation. The typed-array views are created on every call.
  - There are no helper methods; callers read `segmentLines[s] === 1` for lines.
  - The views expire with the callback, or at the next engine call.
- **Owned path:** `text.glyphs().outlineAt(index)` returns caller-owned `GlyphOutlineContour[]`. Each curve is a `GlyphOutlineCurve` tuple `[x0, y0, cx, cy, x1, y1, isLine]`, so loops can branch on `isLine` without importing anything.
- **Lines:** a line keeps its midpoint control in `points` and in the tuple, so code that ignores the line flag still draws it.
- **The stored format stays private.** Both paths are filled from the decoded GPU points (divided by `unitsPerEm`, y negated), so this API doesn't change if the stored format does.

**Points are stored exactly as the font stores them.**

- The bake copies every `glyf` point, on-curve or off-curve, in stored order.
- It never re-derives which on-curve points are implied, even when an explicit on-curve point sits exactly at the midpoint of its two off-curve neighbours.
- `gvar` deltas are indexed by `glyf` point number, so dropping such points breaks variable fonts.
- **Evidence:** the spike encoder rebuilds points from curves for its GPU test. On Inter it drops 2,548 such points: the shape is unchanged, but the point count no longer matches `glyf`.
- CFF fonts, which are converted with cu2qu, keep the points cu2qu emits.

## Why

See [outline stream research](../outline-stream-research.md) and the [encoding study](../outline-stream-encoding-study.md).

**Triplets are the smallest measured candidate on every font,** under both gzip and brotli.

- They are 44–77% of the source table #235 copies (gzip), and 6–16% smaller than fontTools' WOFF2 glyf transform, because they drop WOFF2's instruction, bounding-box and overlap streams.
- The bit-packed proposal measured 1.4–2.1× larger, because bit widths hide the byte patterns gzip and brotli model. Its implied-on-curve read rule is correct and is the GPU rule above.

**Keeping TrueType's point model and order** makes variable-font deltas map one-to-one onto stream points, and keeps composites compact.

**The i16 point layout** costs 5.1–6.2 bytes per curve against Slug's 8.2–8.7, and is exact in font units. Its decoded output is byte-identical to #235's decoder for every glyph of Inter (2,915) and Source Serif (1,453).

**Em space** is the maintainer's call: an outline is the shape of a glyph id in a font, not a property of one placement, so it should not be scaled like placement data. Callers can cache shapes and GPU buffers per font and glyph id and place them with the layout's `x`, `y` and `fontSize`. y down matches the rest of the layout data.

## Consequences

**What it supersedes:**

- From [glyph outlines](glyph-outlines.md): the `opentype-sfnt-outlines-v0` copy of `glyf`/`loca`/`CFF `, decoding through read-fonts with a runtime four-way cubic split, and the paragraph-space, tuple-returning `outlineAt()`. Outlines stay optional core-font data shared by every raster technique.
- The bit-packed blocks of 16 in the body of #244.

**Changing the stored format later is cheap.** The runtime rejects any font whose `provenance.bakerVersion` is not exactly its own `FONT_BAKER_VERSION` (`packages/glyph/src/internal/font-artifact-reader.ts:44`, `packages/glyph/src/font-baker/contract.ts`). A format change ships with a baker-version bump and a re-bake, not a compatibility reader. What 0.2.0 locks in is the `outlineAt()` API.

**What stays open** (the gates on #244):

- full composite expansion (scaled and 2×2 transforms, nesting, point-matched offsets, `ROUND_XY_TO_GRID`) and its decoder size;
- an exact start point for contours with no on-curve point;
- CFF tolerance and grid, checked visually at large magnification;
- the coordinate range (`|x| < 16384`, half on a half-unit grid) and fonts with 4,096 or more units per em;
- line encoding in Slug.
