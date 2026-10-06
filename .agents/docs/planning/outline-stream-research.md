---
type: Engineering Research
title: Outline stream research
description: 'Measured choice of the glyph outline format that serves outlineAt(), Slug, runtime re-bakes and variable fonts, with the decisions taken and the gates still open.'
tags: [outlines, slug, variable-fonts, wasm, simd, gpu, compression, research]
sources:
  - id: pr-235
    resource: https://github.com/pmndrs/glyph/pull/235
    title: Glyph outlines (outlineAt) pull request
  - id: issue-244
    resource: https://github.com/pmndrs/glyph/issues/244
    title: One quadratic curve stream for outlineAt() and runtime bakes
  - id: study-comment
    resource: https://github.com/pmndrs/glyph/issues/244#issuecomment-6010803578
    title: Measured outline storage and Slug sharing (issue comment)
  - id: decisions-comment
    resource: https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243
    title: Outline format decisions and implementation reference (issue comment)
  - id: varfont-comment
    resource: https://github.com/pmndrs/glyph/issues/244#issuecomment-6013252859
    title: Measured variable fonts in the outline stream (issue comment)
  - id: implicit-comment
    resource: https://github.com/pmndrs/glyph/issues/244#issuecomment-5997423622
    title: Parametric-to-implicit quadratic form (issue comment)
  - id: bitpack-comment
    resource: https://github.com/pmndrs/glyph/pull/235#issuecomment-5914720202
    title: Bit-packed quadratic format proposal (pull-request comment)
  - id: api-comment
    resource: https://github.com/pmndrs/glyph/pull/235#issuecomment-6009755243
    title: outlineAt() em-space reader proposal (pull-request comment)
  - id: slug-reference
    resource: https://github.com/EricLengyel/Slug
    title: Official Slug reference shaders (patent dedicated to the public domain; MIT or Apache-2.0)
  - id: woff2
    resource: https://www.w3.org/TR/WOFF2/
    title: WOFF File Format 2.0 (glyf transform, triplet encoding)
  - id: encoding-study
    resource: outline-stream-encoding-study.md
    title: Full encoding study report
  - id: varfont-study
    resource: outline-stream-variable-font-study.md
    title: Full variable-font study report
generated:
  by: anthropic/claude-code
  at: '2026-10-06T08:00:00Z'
status: draft
---

# Outline stream research

This page summarizes two measured studies and the decisions taken from them.

- **Full reports:** the [encoding study](outline-stream-encoding-study.md) and the [variable-font study](outline-stream-variable-font-study.md) hold every table and the reproduction steps.
- **Format specification:** the issue comment [outline format decisions](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243) is the implementation reference. The decision files linked below record the same choices in this bundle.
- **Code:** research scripts are in `spikes/outline-stream/research/`, and the GPU spike that tests the open gates is in `spikes/outline-stream/` ([spike plan](outline-stream-spike.md)).

## Question

#235 adds `outlineAt()`, which copies the face's own `glyf`/`loca` or `CFF ` table into the artifact. The runtime decodes it with read-fonts, which adds 24.7 KB gzip to every user's shaper.

#244 asked for one stored curve format that:

1. serves `outlineAt()` without parsing a font at runtime;
2. compresses at least as well as the source tables;
3. decodes trivially;
4. can be read by the GPU, ideally as the same bytes Slug renders from.

## Method

**Corpus:**

- TrueType: Inter 4.1, Source Serif 4.005.
- CFF: Dancing Script 3.000, Noto Sans CJK JP (the showcase subset and the full 2.004 font).
- Variable: Inter 4.001 VF and Roboto Flex 3.200 (TrueType), Source Serif 4 Variable and Noto Sans CJK JP VF 2.004 (CFF2).

**Glyph sets:** the Latin set `U+0020-007E,U+00A0-00FF`, and the full glyph set.

**Measurements:**

- Sizes: raw, gzip -9 and brotli q11.
- Decode timings: Node 22 Wasm, scalar and SIMD128.
- Correctness: cross-checked against #235's shipped decoder and against `fontTools.varLib.instancer`.

No GPU was available, so every shader number is either an estimate or unmeasured.

## Findings

### Wire format

**WOFF2-style triplet coding of TrueType-model points is the smallest candidate on every font,** under both gzip and brotli.

- The model keeps implied on-curve points implied, gives lines no control point, and keeps glyf composites.
- It is 44–77% of the table #235 copies (gzip), and smaller than fontTools' own WOFF2 glyf transform. Inter full: 51.5 vs 59.5 KB gzip, dehinted.

| Font (gzip KB)                    | Source as copied | Dehinted source | WOFF2 glyf, dehinted |  Triplets |
| --------------------------------- | ---------------: | --------------: | -------------------: | --------: |
| Inter Latin                       |             17.0 |            11.7 |                  9.4 |   **8.6** |
| Inter full                        |            116.0 |            80.5 |                 59.5 |  **51.5** |
| Source Serif full                 |             56.0 |            56.0 |                 42.5 |  **39.7** |
| Dancing Script full (tolerance 1) |             57.0 |            42.9 |                    — |  **39.3** |
| CJK 2.004 full (tolerance 1)      |           13,200 |               — |                    — | **8,713** |

**What did not win:**

- **Bit-packing to non-byte widths:** the bit-packed layout proposed on #235 was 1.4–2.1× the size of triplets, and larger than the source table on most fonts. gzip and brotli model bytes, and bit-packing hides those patterns.
  - Blocks spanning glyph boundaries are worse still.
  - Its implied-on-curve stencil is correct, and it is the GPU read rule below.
- **Control-point prediction:** parallelogram prediction was worse after compression, and tangent prediction was within 1%.
- **meshopt:** worse than byte varints after compression, with a 7.7 KB decoder.
- **Splitting x and y planes:** neutral.
- **Dropping hinting** alone saves about 30% on hinted TrueType fonts.

### Decoder

**Size:** the scalar no_std triplet decoder is 0.57 KB gzip, or 1.11 KB with the GPU point-layout emitter. It replaces read-fonts' +24.7 KB. Composite expansion with full transform support is not in that number.

**Speed:** 0.17–0.86 µs per glyph, once at load. #235 pays 1.2–10.5 µs on every `outlineAt()` call.

| Font           | Whole-font decode at load |
| -------------- | ------------------------: |
| Inter          |                    0.5 ms |
| Noto CJK 2.004 |                     42 ms |

**Correctness:** decoded output is byte-identical to #235's decoder for every glyph of Inter (2,915) and Source Serif (1,453). CFF differs by design, because bake-time cu2qu replaces the runtime four-way split.

### GPU layout

The GPU layout is absolute i16 points in font units.

- **Word layout:** x is stored as `(x << 1) | offCurve`.
- **Contours:** each one is rotated to start on an on-curve point and gets one wrap point.
- **Read rule:** the shader rebuilds each quadratic from `p[i-1]`, `p[i]`, `p[i+1]` with the TrueType implied-on-curve rule.
- **Cost:** 5.1–6.2 bytes per curve, against Slug's 8.2–8.7, and exact in font units.

Slug's f16 em-space curves are lossy.

- They lose up to 2.0 units on Inter, and 0.83% of coordinates are off by at least 0.5 units.
- The cause is f16's 11 significant bits: at 1 em the step is 2^-10 em, about 2 units at 2,048 units per em.
- Slug inherited the layout from the official reference shaders through the Three Flatland uikit fork. No decision compared it with integer units.

### Slug sharing

When Slug reads the shared point buffer, its curve texture disappears.

| Font (brotli)       | Today: source + `.slug.glb` | Shared buffer, bands shipped | Shared buffer, bands derived at load |
| ------------------- | --------------------------: | ---------------------------: | -----------------------------------: |
| Inter Latin         |                     59.0 KB |                      28.6 KB |                               8.2 KB |
| Inter full          |                      454 KB |                       233 KB |                                48 KB |
| Noto CJK 2.004 full |                     56.9 MB |                      22.4 MB |                               7.4 MB |

**GPU memory:**

- Curve data shrinks 35–40%.
- Total resident Slug memory, compared unpadded on both sides, drops only 12–13%, because band tables dominate (Inter full: 1.81 → 1.57 MB).

**Deriving bands at load** with `slug-core` costs 8–31 µs per glyph and +9.3 KB gzip of Wasm. CJK takes 2.0 s if done eagerly.

### Implicit form

The implicit coefficients posted on #244 have one sign error. With `A = 2·y1 − y0 − y2` and `B = x0 − 2·x1 + x2`, F vanishes on the curve; C, D, E and F are correct as posted.

| Check (`research/implicit/`)                      | Result              |
| ------------------------------------------------- | ------------------- |
| Worst \|F\| on the curve, as posted               | 4·Δ²                |
| Worst \|F\| on the curve, with A and B fixed      | 1.8e-12·Δ²          |
| f32 inside/outside sign errors at font-unit scale | 0 in 48,000 samples |

**It does not make storage smaller.** With implied points, the coefficients are the first and second differences of the stored points. Storing second differences is linear prediction, which measured worse.

**Where it helps:** an inside test and a distance estimate for triangle-based or tessellated rasterizers. It does not change Slug's band ray cast.

### CFF

Bake-time cu2qu produces 2.5–3.1 quadratics per cubic, against Slug's fixed four, so CFF fonts have 22–37% fewer curves.

| Conversion                     |       Max error | Brotli vs source                                |
| ------------------------------ | --------------: | ----------------------------------------------- |
| Tolerance 0.25, half-unit grid |     ≈ 0.5 units | still smaller (Dancing Script: 46.1 vs 50.4 KB) |
| Tolerance 0.5, integer grid    | 0.88–1.03 units | 22–28% smaller                                  |

Keeping cubics would be exact and smaller, but nothing on the GPU path reads cubics.

### Variable fonts

**TrueType fits the format, and it is exact.**

- The format is the base triplet stream plus sparse, gvar-aligned delta streams, a region table and an axis table.
- It matched `fontTools.varLib.instancer` with 0 mismatched coordinates at 34 axis locations, composites and ink bounds included.
- Exact parity needs IUP (interpolation of untouched points) at load and f64. f32 is 1 unit off on at most 13 of 637,680 coordinates, and was accepted.
- Total size is 69–76% of `gvar` + `glyf` + `loca` (brotli): Inter full 193 vs 281 KB, Roboto Flex full 549 vs 739 KB. Deltas are 75–97% of the bytes.

**Speed:**

| Font             | Re-instance (f32 / exact) | Full load |
| ---------------- | ------------------------- | --------: |
| Inter full       | 0.13 / 0.30 ms            |    2.6 ms |
| Roboto Flex full | 0.35 / 0.70 ms            |    9.3 ms |

**SIMD:**

| Step                | SIMD speedup over scalar |
| ------------------- | ------------------------ |
| Instancing          | 1.6–5.1×                 |
| Composite expansion | 1.9–3.6×                 |
| Ink bounds          | 2.1–3.7×                 |
| Triplet decoding    | 0.62–1.23×               |

**Order of operations:**

1. Decode, in glyf order.
2. Run IUP.
3. Instance.
4. Expand composites.
5. Build the GPU layout.

The GPU slot-to-point map is instance-invariant and built once. Applying deltas to GPU slots without it corrupts 47–49% of slots.

**CFF2:** compatible cu2qu across real peak masters failed on 0 glyphs (all 1,464 Source Serif glyphs and all 65,535 CJK glyphs). Multi-region fonts need a point-major delta layout.

**Slug bands:**

- Bands built for the default instance alone are wrong at every other instance.
- Bands built against conservative bounds across all regions are correct, at 1.6–3.1× the references per band.
- Bands conservative over only the animated axes cost far less.

**Shaping:** the tables shaping must keep (`fvar`, `avar`, `HVAR`/`VVAR`, `MVAR`, the GDEF ItemVariationStore, GSUB FeatureVariations) belong to the shaping payload (#99), not the outline stream.

### Hinting and runtime re-bakes

**Hinting:** dropping it changes nothing today.

- The bitmap baker draws unhinted (`DrawSettings::unhinted`), and Slug and MTSDF are resolution-independent.
- A TrueType bytecode interpreter on the GPU is not practical.
- GPU-friendly alternatives:
  - font-size snapping to the cap height;
  - an autohinter-style vertical warp of the sample coordinate against baked alignment zones;
  - hinted outlines for small sizes only;
  - stem darkening as a presentation adjustment.

**Runtime re-bakes from the stream** are within reach but not wired.

| Generator | State                                                                                      |
| --------- | ------------------------------------------------------------------------------------------ |
| MTSDF     | `mtsdf-core` is already curve-fed.                                                         |
| Slug      | `slug-core::build_glyph_geometry` takes quadratics, but `bake_slug` takes the source font. |
| Bitmap    | Draws through skrifa into zeno; zeno itself is format-free.                                |

All three need a raster identity rule for bakes made from the stream.

## Decisions

- [Outline stream format](decisions/outline-stream-format.md): the wire format, the GPU point layout and the em-space `outlineAt()` reader.
- [Outline decoder in the core shaper](decisions/outline-decoder-in-core.md).
- [Outline SIMD scope](decisions/outline-simd-scope.md): SIMD for instancing, expansion and bounds; scalar wire decoding; f32 instancing.
- [Slug reads the shared outline points](decisions/slug-shared-outline-points.md): bands stay baked by default; compute decode is optional.
- [Variable fonts in the outline stream](decisions/variable-font-outline-stream.md).

## Open gates

- Shader speed parity of the three-point read on WebGPU and WebGL2, against today's f16 texture. The [spike](outline-stream-spike.md) measures this.
- Full composite expansion (scaled and 2×2 transforms, nesting, point-matched offsets, `ROUND_XY_TO_GRID`) and its size.
- Making the synthesized start point exact for contours with no on-curve point, since rounding it is lossy.
- Raster identity for bakes made from the stream.
- CFF tolerance and grid, checked visually at large magnification.
- The packed-point coordinate range (`|x| < 16384`, half that on a half-unit grid), and fonts with 4,096 or more units per em.
- Line encoding in Slug: a midpoint control, or the reference's duplicated endpoint.
- Whether u16 band references to point indices fit, and lazy band derivation for CJK.
- Curves-in entry points for the Slug and bitmap bakers.
- Browser timings.
- One delta layout for TrueType and CFF2, and keeping phantom points for fonts without `HVAR`.
- GPU instancing on real hardware.
- avar2, VARC, and transformed or nested components.

## Reproduction

Every script is in `spikes/outline-stream/research/`:

- **`encoding/`:** the outline model and encoders, decoder crate, size, timing and cross-check scripts, and `raw-results.json`.
- **`varfont/`:** the variable-font model and encoders, instancer crate, slug-core band tool, and verification scripts.
- **`implicit/`:** the implicit-form checks.

The scripts were written against scratch paths in the session that produced them; adjust the paths before rerunning. The full reports list exact commands and fixture hashes.
