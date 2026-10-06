---
type: Engineering Research
title: Outline stream encoding study
description: 'Full measured report comparing outline storage encodings, decoders, GPU layouts and Slug sharing across TrueType and CFF fonts.'
tags: [outlines, slug, compression, wasm, gpu, research]
sources:
  - id: summary
    resource: outline-stream-research.md
    title: Outline stream research summary
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
status: draft
---

# Glyph outline encodings: a measured study

> **Status of this report (reviewed 2026-10-06).** This is the study agent's report as written, before the maintainer's decisions. Measurements stand; read these parts with the corrections in [outline stream research](outline-stream-research.md#corrections-to-earlier-write-ups):
>
> - **GPU resident memory:** the two GPU columns of the "Today vs proposed" table compare padded Slug pages today with unpadded proposed data. Unpadded on both sides, total resident Slug memory drops only 12–13% (Inter full 1.81 → 1.57 MB; Inter Latin 156 → 138 KB). It does not halve.
> - **Decoder delivery:** the recommendation of a decoder "loaded only with outlined artifacts" is superseded. The decoder is required and lives in the core shaper Wasm ([decision](decisions/outline-decoder-in-core.md)).
> - **Decoder size:** the 0.56 KB triplet decoder covers decomposed glyphs only; full composite expansion is unmeasured (the JS expander only approximates nested transforms).
> - **Decode speed:** "0.17–0.86 µs/glyph" uses the slowest of three CJK 2.004 runs. The medians in the decode table give 0.17–0.64.
> - **`outlineAt()` space:** finding 7 says `outlineAt()` multiplies by `fontSize/upm`, as #235 did (paragraph space). The accepted API is em space, y down: points divided by `unitsPerEm`, y negated ([decision](decisions/outline-stream-format.md)).
> - **Bands:** building bands at load is an option. The maintainer kept baked, packed bands as the default.
> - **SIMD:** this study timed scalar decoders only. The later variable-font study found SIMD gives no gain on triplet decoding ([decision](decisions/outline-simd-scope.md)).
> - **Terminology:** "stencil" here means the three-point neighbourhood read `p[i-1]`, `p[i]`, `p[i+1]`, not the GPU stencil buffer.

**Scope and method:**

- Branch: `origin/feat/glyph-outlines`, with `dist/` as built.
- Compressed sizes are gzip -9 and brotli q11 (lgwin 24) of each candidate's planes, concatenated as one bufferView. KB means 1,000 bytes.
- Reused from the interrupted run, after verifying it: the outline model and encoders (`model.py`, `enc.py`, `run.py`) and the Slug section parser.
  - These reproduce the brief's numbers exactly. The source tables match (Inter Latin 16,951 B gzip), and all seven weak-stream numbers match when I rerun the original `stream_estimate.py` (Inter Latin 13,987 B, Serif full 73,011 B).
  - Re-running `slug_sizes.py` gives byte-identical Slug sizes, and `f16_error.py` reproduces.
- New in this run: candidate 9 (the maintainer's proposal), StreamVByte, the implied-point ablation, the GPU stencil layout, cu2qu error, Rust→Wasm decoders, timing of the shipped decoder, and full Noto CJK 2.004.

## Answer: the unlock

**Let Slug read its curves from the same i16 point buffer `outlineAt()` reads, through TrueType's implied-on-curve stencil.**

- Slug's band references then name point indices instead of curve texels.
- Slug's own f16 curve texture goes away, so the curves ship once.
- Its band tables can also be built at load from those points instead of shipping.

The parts, each backed by the tables below:

1. **Wire format: WOFF2-style triplet coding of TrueType-model points.**
   - Implied on-curve points stay implied, lines carry no control point, and glyf composites are kept.
   - Varint structure planes; 1 flag byte per point (on/off plus the size class) and a data-byte plane.
   - It is the smallest candidate on every font with both gzip and brotli: 44–77% of the source table as copied today (gzip).
   - It beats fontTools' real WOFF2 glyf transform. Inter full: 51.5 vs 59.5 KB gzip, dehinted. Source Serif full: 39.7 vs 42.5 KB.
2. **At load, one tiny decoder expands it to absolute i16 x,y planes plus a tag per point.**
   - Size: 0.56 KB gzip as scalar Rust→Wasm, or 1.26 KB gzip as minified JS including composite expansion. Today's shaper carries +24.7 KB gzip for this.
   - Speed: 0.17–0.86 µs/glyph, so the whole of Inter decodes in 0.5 ms and all of CJK 2.004 in about 42 ms.
   - The shipped read-fonts path costs 1.2–10.5 µs per glyph, on every `outlineAt()` call.
3. **That buffer, decomposed, is the GPU format.**
   - Each contour is rotated to start on an on-curve point and gets one wrap point appended. The off-curve tag goes in bit 0 of x.
   - It costs 5.1–6.2 B/curve, against Slug's 8.2–8.7 B/curve today, and is exact in font units.
   - Slug's f16 em coordinates are lossy: Inter loses up to 2.0 units, and 0.83% of its coordinates are off by 0.5 units or more.
   - The shader fetches `p[i-1]`, `p[i]`, `p[i+1]` (12 B per curve, against 16 B today) and applies the maintainer's stencil.
   - The same buffer serves `outlineAt()`. The stencil emitter produces output **byte-identical** to the shipped shaper's for all 2,915 Inter glyphs and all 1,453 Source Serif glyphs.

**Today vs proposed, outlines plus Slug (KB, gzip / brotli):**

| Font, set                    | Today: source table + `.slug.glb` | Proposed, bands shipped: triplets + Slug band tables | Proposed, bands built at load | GPU resident today (Slug pages, padded) | GPU resident proposed (stencil + band tables, unpadded) |
| ---------------------------- | --------------------------------: | ---------------------------------------------------: | ----------------------------: | --------------------------------------: | ------------------------------------------------------: |
| Inter Latin                  |                       73.6 / 59.0 |                                          35.3 / 28.6 |                     8.6 / 8.2 |                                  238 KB |                                                  138 KB |
| Inter full                   |                     637.9 / 454.2 |                                        317.9 / 233.2 |                   51.5 / 48.4 |                                 3154 KB |                                                 1572 KB |
| Serif Latin                  |                       86.2 / 69.1 |                                          45.4 / 36.9 |                    10.2 / 9.8 |                                  262 KB |                                                  170 KB |
| Serif full                   |                     400.1 / 287.3 |                                        217.5 / 158.4 |                   39.7 / 37.2 |                                 1680 KB |                                                  929 KB |
| Dancing Latin (tolerance 1)  |                     152.7 / 130.9 |                                          67.7 / 57.2 |                   15.2 / 14.4 |                                  410 KB |                                                  204 KB |
| Dancing full (tolerance 1)   |                     498.8 / 399.5 |                                        234.6 / 186.5 |                   39.3 / 36.0 |                                 2802 KB |                                                 1030 KB |
| CJK showcase (tolerance 1)   |                     162.3 / 134.8 |                                          66.2 / 53.2 |                   20.2 / 19.3 |                                  393 KB |                                                  164 KB |
| CJK 2.004 full (tolerance 1) |                   75,910 / 56,850 |                                      29,980 / 22,380 |                 8,710 / 7,380 |                                191.5 MB |                                                 87.2 MB |

The "bands shipped" column assumes the band-table bytes stay as baked; only the reference target changes. On the GPU, bands dominate in both columns: Inter Latin today unpadded is 156 KB, of which curves are 51 KB. Of the Slug file's brotli bytes, the curve texture is 48–68%.

**Why the maintainer's layout (candidate 9, bp16) is not the unlock.** Its stencil is correct, and it is exactly the GPU rule above. But implemented exactly as written, the wire layout compresses badly:

- It is larger than the source table on Inter full (131.4 vs 116.0 KB gzip), Serif Latin and full, Dancing Latin and full, and CJK 2.004 (13.36 vs 13.20 MB).
- It is smaller only on Inter Latin (87%, because that source carries hinting) and CJK showcase (98%).
- It is 1.4–2.1× the size of triplets everywhere.

The cause is bit-packing to non-byte widths, which hides the byte patterns that gzip and brotli model:

- Blocks that span glyph boundaries are worse still (Inter full: 166.5 vs 131.4 KB gzip). Per-glyph alignment is what lets the compressor match repeated decomposed glyphs.
- The weak prototype `stream_estimate.py` also bit-packs in blocks of 16. Its exact point set re-encoded as byte varints gives Inter Latin 12.3 vs 14.0 KB gzip.

**Costs and lossy aspects, exactly:**

- **TrueType:** lossless (byte-identical output, above).
- **CFF:** lossy at bake time.
  - The corpus CFF coordinates are all integers (0 of 124,660 fractional in Dancing; 0 of 12.4 M in CJK 2.004), so keeping cubics would be exact.
  - Error is measured against the true cubic, as max / p99 / mean in font units. 65 samples per cubic are taken against a 64-segment flattening, which over-estimates slightly.

  | Conversion                                 | Dancing Script     | CJK showcase       | CJK 2.004 (20,000-cubic sample) |
  | ------------------------------------------ | ------------------ | ------------------ | ------------------------------- |
  | cu2qu tol 0.5, integer grid                | 0.88 / 0.69 / 0.31 | 0.87 / 0.65 / 0.29 | 1.03 / 0.66 / 0.29              |
  | cu2qu tol 0.25, half-unit grid             | 0.50 / 0.35 / 0.17 | 0.42 / 0.33 / 0.15 | 0.55 / 0.34 / 0.15              |
  | Slug texture today (4-split, f16 em)       | 1.27 / 0.34 / 0.13 | 0.34 / 0.29 / 0.15 | 0.47 / 0.30 / 0.15              |
  | `outlineAt()` today (runtime 4-split, f32) | 1.14 / 0.28 / 0.04 | 0.19 / 0.12 / 0.01 | 0.45 / 0.10 / 0.01              |
  - Integer rounding pins the mean near 0.3 u at any tolerance. The half-unit grid halves it for about 6–10% more brotli bytes.

- **Composites:** expanded at load. JS decode plus expansion takes 0.94 ms for Inter full.
- **Bands at load:** slug-core in Wasm costs 8.3–31 µs/glyph, plus 9.3 KB gzip of Wasm.
  - Latin is 2–5 ms per font, eagerly.
  - CJK 2.004 takes 2.0 s eagerly, so it must be lazy per glyph, or keep shipping bands.
- **Shader:** `loadCurve` becomes 3 point fetches plus selects, and the record carries a point base instead of a texel base.
  - Lines no longer need bowing: `solve-quadratic.ts` already takes a linear path for `|a| < 1/65536`.
  - **GPU speed was not measured** (no GPU on this machine). That is the gate #244 already names.

## Headline across fonts (KB)

CFF quadratic columns use cu2qu tolerance 1 on the integer grid. Triplets keep composites.

| Font, set              | Source (as copied) | Dehinted source | WOFF2 glyf, dehinted | Weak prototype | Varint planes |  Triplets | Triplets, decomposed | CFF cubics, triplets | bp16 (maintainer) | GPU stencil buffer | Slug `.slug.glb` |
| ---------------------- | -----------------: | --------------: | -------------------: | -------------: | ------------: | --------: | -------------------: | -------------------: | ----------------: | -----------------: | ---------------: |
| Inter Latin, gzip      |               17.0 |            11.7 |                  9.4 |           14.0 |          10.5 |   **8.6** |                  9.4 |                  n/a |              14.7 |               18.1 |             56.7 |
| Inter Latin, brotli    |               15.7 |            11.0 |                  8.8 |           13.5 |           9.0 |   **8.2** |                  8.9 |                  n/a |              13.6 |               14.9 |             43.3 |
| Inter full, gzip       |              116.0 |            80.5 |                 59.5 |           88.9 |          63.6 |  **51.5** |                 70.3 |                  n/a |             131.4 |              159.0 |            521.8 |
| Inter full, brotli     |               97.6 |            68.7 |                 54.6 |           83.6 |          52.7 |  **48.4** |                 61.6 |                  n/a |             111.5 |              116.7 |            356.7 |
| Serif Latin, gzip      |               13.2 |            13.2 |                 10.8 |           17.3 |          11.9 |  **10.2** |                 10.8 |                  n/a |              17.9 |               21.9 |             73.0 |
| Serif Latin, brotli    |               12.8 |            12.8 |                 10.3 |           16.6 |          10.5 |   **9.8** |                 10.2 |                  n/a |              16.7 |               18.2 |             56.4 |
| Serif full, gzip       |               56.0 |            56.0 |                 42.5 |           73.0 |          47.1 |  **39.7** |                 45.1 |                  n/a |              83.9 |               99.5 |            344.1 |
| Serif full, brotli     |               50.2 |            50.2 |                 39.5 |           66.4 |          40.1 |  **37.2** |                 41.1 |                  n/a |              73.1 |               74.4 |            237.2 |
| Dancing Latin, gzip    |               19.9 |            16.3 |                  n/a |           25.7 |          17.3 |  **15.2** |                 15.2 |                 12.5 |              22.1 |               28.3 |            132.8 |
| Dancing Latin, brotli  |               18.9 |            15.3 |                  n/a |           24.7 |          15.2 |  **14.4** |                 14.4 |                 11.8 |              20.5 |               23.8 |            112.0 |
| Dancing full, gzip     |               57.0 |            42.9 |                  n/a |           77.7 |          46.9 |  **39.3** |                 39.3 |                 33.5 |              71.6 |               89.8 |            441.8 |
| Dancing full, brotli   |               50.4 |            37.8 |                  n/a |           65.3 |          38.2 |  **36.0** |                 36.0 |                 30.9 |              64.3 |               70.7 |            349.1 |
| CJK showcase, gzip     |               28.5 |            24.4 |                  n/a |           32.3 |          25.4 |  **20.2** |                 20.2 |                 18.7 |              28.1 |               33.8 |            133.7 |
| CJK showcase, brotli   |               26.5 |            22.6 |                  n/a |           30.6 |          21.9 |  **19.3** |                 19.3 |                 17.9 |              26.3 |               28.0 |            108.2 |
| CJK 2.004 full, gzip   |             13,200 |    not measured |                  n/a |   not measured |        11,498 | **8,713** |                8,713 |                8,389 |            13,361 |             15,864 |           62,713 |
| CJK 2.004 full, brotli |             10,891 |    not measured |                  n/a |   not measured |         8,547 | **7,382** |                7,382 |                7,101 |            11,678 |             11,411 |           45,962 |

## Per-font tables

The "vs source" columns compare against the table as copied today. Candidate numbers refer to the brief's list. "Slug band tables" means headers plus references plus records. The CJK showcase has no Latin glyphs (its Latin subset is 1 glyph, and the Slug bake fails with "missing cmap"), so it only has a full-set table.

### Inter 4.1, Latin (U+0020-007E, U+00A0-00FF)

| Encoding                                                                              | Raw KB | gzip KB | brotli KB | gzip vs source | brotli vs source |
| ------------------------------------------------------------------------------------- | -----: | ------: | --------: | -------------: | ---------------: |
| **Source and references**                                                             |        |         |           |                |                  |
| Source glyf+loca as copied today (with hinting)                                       |   28.2 |    17.0 |      15.7 |           100% |             100% |
| Source glyf+loca, hinting stripped                                                    |   17.1 |    11.7 |      11.0 |            69% |              70% |
| WOFF2 glyf transform (fontTools)                                                      |   24.8 |    14.5 |      13.2 |            85% |              85% |
| WOFF2 glyf transform, hinting stripped                                                |   13.8 |     9.4 |       8.8 |            55% |              56% |
| Weak prototype `stream_estimate.py`, composites kept                                  |   17.6 |    14.0 |      13.5 |            83% |              86% |
| Weak prototype `stream_estimate.py`, decomposed                                       |   28.6 |    16.1 |      15.4 |            95% |              98% |
| Slug `.slug.glb` as baked (whole file, 287 glyphs)                                    |  250.5 |    56.7 |      43.3 |           334% |             277% |
| Slug curve texture section only (RGBA16F, padded page)                                |  131.3 |    28.5 |      21.9 |           168% |             140% |
| Slug band tables only                                                                 |  118.1 |    26.7 |      20.4 |           157% |             130% |
| **Candidates, composites kept**                                                       |        |         |           |                |                  |
| Explicit 2n+1 points, varint, xy interleaved (our reimplementation of the #244 shape) |   22.1 |    14.2 |      12.2 |            84% |              78% |
| 1. 2n+1 with x and y in split planes                                                  |   22.1 |    13.8 |      12.1 |            81% |              78% |
| 1. Implied on-curves explicit, no line controls                                       |   17.9 |    12.3 |      10.5 |            73% |              67% |
| 1+2. glyf points (implied), varint zigzag deltas, xy interleaved                      |   15.4 |    10.5 |       9.0 |            62% |              57% |
| 2. Same, x and y split planes                                                         |   15.4 |    10.5 |       9.0 |            62% |              58% |
| 2. Same, flags 1 byte per point instead of 1 bit                                      |   19.0 |    10.6 |       9.0 |            63% |              58% |
| 2. i16 deltas, x and y planes                                                         |   18.5 |    11.0 |       9.3 |            65% |              59% |
| 2. i16 deltas, byte-plane transposed                                                  |   18.5 |    10.2 |       9.4 |            60% |              60% |
| 2. Zigzag u16 deltas, byte-plane transposed                                           |   18.5 |    10.3 |       9.5 |            61% |              61% |
| 4. i8 deltas with an i16 escape plane                                                 |   16.4 |    10.6 |       9.2 |            62% |              59% |
| 3. Linear (parallelogram) prediction                                                  |   15.1 |    11.1 |       9.9 |            65% |              63% |
| 3. Tangent-continuity prediction                                                      |   15.1 |    10.4 |       8.9 |            61% |              57% |
| 10. StreamVByte-style (2-bit length codes plus byte planes)                           |   13.4 |     9.8 |       9.1 |            58% |              58% |
| 8/10. WOFF2 triplet coding of the same points                                         |   12.0 | **8.6** |   **8.2** |            51% |              52% |
| 5. Contour dedup back-references                                                      |   15.3 |    10.5 |       8.9 |            62% |              57% |
| Glyph-major fixed i16 (glyf-like order)                                               |   22.1 |    11.3 |       9.6 |            67% |              62% |
| 6. EXT_meshopt vertex codec v1 on absolute i16 xy                                     |   14.4 |    11.3 |      10.7 |            67% |              68% |
| 7. Absolute i16 x and y planes (GPU-readable)                                         |   20.8 |    12.1 |      10.2 |            71% |              65% |
| **Candidates, decomposed (what Slug needs)**                                          |        |         |           |                |                  |
| Explicit 2n+1 points, varint                                                          |   37.9 |    15.7 |      13.3 |            93% |              85% |
| Varint, xy interleaved                                                                |   25.7 |    11.3 |       9.6 |            67% |              61% |
| WOFF2-style triplets                                                                  |   19.9 |     9.4 |       8.9 |            55% |              57% |
| 9. Maintainer proposal (bp16, per-glyph blocks)                                       |   30.0 |    14.7 |      13.6 |            87% |              87% |
| 9. bp16 with blocks across glyph boundaries                                           |   25.1 |    18.1 |      17.0 |           107% |             109% |
| 6. meshopt v1 on absolute xy                                                          |   22.4 |    15.8 |      14.8 |            93% |              95% |
| 7. GPU stencil buffer i16                                                             |   33.0 |    18.1 |      14.9 |           107% |              95% |
| 7. Slug texel layout, i16 half units (exact)                                          |   51.8 |    28.1 |      21.4 |           166% |             137% |
| 7. Slug texel layout, f16 em (model of today)                                         |   51.8 |    28.3 |      22.0 |           167% |             141% |
| 6. meshopt v1 on Slug i16 texels                                                      |   37.9 |    26.4 |      25.7 |           156% |             164% |

### Inter 4.1, full glyph set

| Encoding                                        | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ----------------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source glyf+loca as copied today                |  225.5 |    116.0 |      97.6 |           100% |             100% |
| Source, hinting stripped                        |  143.4 |     80.5 |      68.7 |            69% |              70% |
| WOFF2 glyf transform                            |  192.2 |     90.3 |      81.8 |            78% |              84% |
| WOFF2 glyf transform, hinting stripped          |  114.3 |     59.5 |      54.6 |            51% |              56% |
| Weak prototype, composites kept                 |  132.6 |     88.9 |      83.6 |            77% |              86% |
| Weak prototype, decomposed                      |  354.5 |    139.3 |     113.2 |           120% |             116% |
| Slug `.slug.glb` (2,915 glyphs)                 | 3272.7 |    521.8 |     356.7 |           450% |             366% |
| Slug curve texture section                      | 2097.3 |    252.0 |     171.0 |           217% |             175% |
| Slug band tables                                | 1174.2 |    266.4 |     184.8 |           230% |             189% |
| Explicit 2n+1, composites kept                  |  155.1 |     83.5 |      69.9 |            72% |              72% |
| 1. 2n+1, split planes                           |  155.1 |     79.7 |      69.9 |            69% |              72% |
| 1. Implied on-curves explicit, no line controls |  126.2 |     71.8 |      59.6 |            62% |              61% |
| 1+2. Varint, xy interleaved                     |  111.6 |     63.6 |      52.7 |            55% |              54% |
| 2. x and y split                                |  111.6 |     63.4 |      53.7 |            55% |              55% |
| 2. Flags 1 byte per point                       |  134.7 |     63.9 |      53.6 |            55% |              55% |
| 2. i16 deltas                                   |  133.5 |     66.0 |      54.7 |            57% |              56% |
| 2. i16 deltas, byte-shuffled                    |  133.5 |     63.7 |      56.8 |            55% |              58% |
| 2. Zigzag u16, byte-shuffled                    |  133.5 |     63.9 |      57.0 |            55% |              58% |
| 4. i8 with escape                               |  119.6 |     64.5 |      55.0 |            56% |              56% |
| 3. Linear prediction                            |  111.2 |     67.4 |      58.6 |            58% |              60% |
| 3. Tangent prediction                           |  110.0 |     63.0 |      53.7 |            54% |              55% |
| 10. StreamVByte                                 |   99.7 |     60.2 |      54.9 |            52% |              56% |
| 8/10. Triplets                                  |   90.2 | **51.5** |  **48.4** |            44% |              50% |
| 5. Contour dedup                                |  104.3 |     62.9 |      52.5 |            54% |              54% |
| Glyph-major i16                                 |  156.6 |     70.2 |      58.0 |            60% |              59% |
| 6. meshopt v1, absolute xy                      |  113.5 |     72.6 |      66.0 |            63% |              68% |
| 7. Absolute i16 planes                          |  155.7 |     73.4 |      60.3 |            63% |              62% |
| Decomposed: explicit 2n+1                       |  471.6 |    125.9 |      88.3 |           109% |              90% |
| Decomposed: varint                              |  315.5 |     87.3 |      64.8 |            75% |              66% |
| Decomposed: triplets                            |  241.2 |     70.3 |      61.6 |            61% |              63% |
| 9. bp16, per-glyph blocks                       |  355.6 |    131.4 |     111.5 |           113% |             114% |
| 9. bp16, blocks across glyphs                   |  308.1 |    166.5 |     144.9 |           143% |             148% |
| 6. meshopt v1, decomposed                       |  271.1 |    157.4 |     137.4 |           136% |             141% |
| 7. GPU stencil buffer                           |  409.0 |    159.0 |     116.7 |           137% |             120% |
| 7. Slug texels, i16                             |  643.2 |    248.1 |     166.2 |           214% |             170% |
| 7. Slug texels, f16 em                          |  643.2 |    248.6 |     170.4 |           214% |             175% |
| 6. meshopt v1 on Slug i16 texels                |  471.9 |    264.2 |     235.2 |           228% |             241% |

### Source Serif 4.005, Latin

The font is unhinted, so "hinting stripped" equals the source.

| Encoding                              | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source glyf+loca                      |   24.6 |     13.2 |      12.8 |           100% |             100% |
| WOFF2 glyf transform                  |   19.4 |     10.8 |      10.3 |            82% |              81% |
| Weak prototype, composites kept       |   24.7 |     17.3 |      16.6 |           131% |             130% |
| Weak prototype, decomposed            |   33.8 |     19.8 |      18.8 |           150% |             148% |
| Slug `.slug.glb` (291 glyphs)         |  275.2 |     73.0 |      56.4 |           551% |             442% |
| Slug curve texture section            |  131.3 |     35.1 |      28.2 |           265% |             221% |
| Slug band tables                      |  142.8 |     35.1 |      27.2 |           266% |             213% |
| Explicit 2n+1, composites kept        |   28.7 |     15.6 |      13.9 |           118% |             109% |
| 1. 2n+1, split planes                 |   28.7 |     15.3 |      13.9 |           115% |             109% |
| 1. Implied explicit, no line controls |   23.6 |     13.3 |      12.0 |           100% |              94% |
| 1+2. Varint, interleaved              |   20.5 |     11.9 |      10.5 |            90% |              82% |
| 2. x and y split                      |   20.5 |     12.0 |      10.7 |            91% |              84% |
| 2. Flags as bytes                     |   26.9 |     12.1 |      10.7 |            91% |              84% |
| 2. i16 deltas                         |   31.1 |     13.5 |      11.3 |           102% |              89% |
| 2. i16, byte-shuffled                 |   31.1 |     12.9 |      11.7 |            97% |              92% |
| 2. Zigzag u16, byte-shuffled          |   31.1 |     12.2 |      11.3 |            92% |              89% |
| 4. i8 with escape                     |   19.8 |     11.9 |      10.8 |            90% |              84% |
| 3. Linear prediction                  |   20.4 |     12.4 |      11.4 |            94% |              89% |
| 3. Tangent prediction                 |   20.4 |     11.9 |      10.7 |            90% |              84% |
| 10. StreamVByte                       |   18.7 |     11.7 |      11.2 |            88% |              88% |
| 8/10. Triplets                        |   17.9 | **10.2** |   **9.8** |            77% |              77% |
| 5. Contour dedup                      |   17.2 |     11.7 |      10.3 |            88% |              81% |
| Glyph-major i16                       |   37.4 |     13.9 |      11.8 |           105% |              93% |
| 6. meshopt v1, absolute xy            |   20.4 |     14.8 |      13.9 |           112% |             109% |
| 7. Absolute i16 planes                |   33.5 |     15.6 |      12.8 |           118% |             101% |
| Decomposed: explicit 2n+1             |   39.3 |     17.0 |      14.9 |           129% |             117% |
| Decomposed: varint                    |   28.2 |     12.5 |      11.1 |            95% |              87% |
| Decomposed: triplets                  |   24.5 |     10.8 |      10.2 |            81% |              80% |
| 9. bp16, per-glyph blocks             |   33.6 |     17.9 |      16.7 |           135% |             131% |
| 9. bp16, across glyphs                |   29.8 |     21.6 |      20.4 |           163% |             160% |
| 6. meshopt v1, decomposed             |   27.2 |     18.3 |      16.8 |           139% |             131% |
| 7. GPU stencil buffer                 |   44.8 |     21.9 |      18.2 |           165% |             143% |
| 7. Slug texels, i16                   |   67.7 |     32.3 |      25.2 |           244% |             198% |
| 7. Slug texels, f16 em                |   67.7 |     34.7 |      27.9 |           262% |             219% |

### Source Serif 4.005, full glyph set

| Encoding                              | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source glyf+loca                      |  121.5 |     56.0 |      50.2 |           100% |             100% |
| WOFF2 glyf transform                  |   97.7 |     42.5 |      39.5 |            76% |              79% |
| Weak prototype, composites kept       |  121.9 |     73.0 |      66.4 |           130% |             132% |
| Weak prototype, decomposed            |  192.7 |     92.4 |      77.0 |           165% |             154% |
| Slug `.slug.glb` (1,453 glyphs)       | 1739.2 |    344.1 |     237.2 |           614% |             473% |
| Slug curve texture section            | 1048.8 |    163.8 |     115.1 |           292% |             229% |
| Slug band tables                      |  689.3 |    177.8 |     121.2 |           317% |             242% |
| Explicit 2n+1, composites kept        |  142.4 |     62.8 |      53.1 |           112% |             106% |
| 1. Implied explicit, no line controls |  115.8 |     52.3 |      44.6 |            93% |              89% |
| 1+2. Varint, interleaved              |  102.0 |     47.1 |      40.1 |            84% |              80% |
| 2. x and y split                      |  102.0 |     47.6 |      41.9 |            85% |              83% |
| 2. Zigzag u16, byte-shuffled          |  153.6 |     48.6 |      44.4 |            87% |              88% |
| 4. i8 with escape                     |   97.2 |     47.4 |      41.9 |            85% |              84% |
| 3. Linear prediction                  |  101.7 |     49.7 |      44.9 |            89% |              89% |
| 3. Tangent prediction                 |  101.5 |     47.4 |      41.8 |            85% |              83% |
| 10. StreamVByte                       |   91.9 |     46.6 |      44.1 |            83% |              88% |
| 8/10. Triplets                        |   89.0 | **39.7** |  **37.2** |            71% |              74% |
| 5. Contour dedup                      |   72.7 |     45.3 |      39.0 |            81% |              78% |
| 6. meshopt v1, absolute xy            |  100.6 |     64.6 |      59.2 |           115% |             118% |
| 7. Absolute i16 planes                |  165.4 |     63.1 |      51.0 |           113% |             102% |
| Decomposed: explicit 2n+1             |  231.1 |     77.7 |      59.5 |           139% |             119% |
| Decomposed: varint                    |  163.8 |     55.7 |      44.1 |            99% |              88% |
| Decomposed: triplets                  |  142.1 |     45.1 |      41.1 |            80% |              82% |
| 9. bp16, per-glyph blocks             |  190.4 |     83.9 |      73.1 |           150% |             146% |
| 9. bp16, across glyphs                |  171.3 |    102.1 |      93.9 |           182% |             187% |
| 6. meshopt v1, decomposed             |  155.3 |     90.9 |      80.1 |           162% |             160% |
| 7. GPU stencil buffer                 |  257.9 |     99.5 |      74.4 |           178% |             148% |
| 7. Slug texels, i16                   |  399.1 |    150.3 |     103.7 |           268% |             207% |
| 7. Slug texels, f16 em                |  399.1 |    160.9 |     114.0 |           287% |             227% |

### Dancing Script 3.000 (CFF), Latin

| Encoding                                 | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ---------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source CFF as copied today               |   23.1 |     19.9 |      18.9 |           100% |             100% |
| Source CFF, hinting stripped             |   19.1 |     16.3 |      15.3 |            82% |              81% |
| Source CFF, dehinted and desubroutinized |   25.5 |     14.2 |      13.4 |            71% |              71% |
| Weak prototype (tolerance 1, decomposed) |   41.3 |     25.7 |      24.7 |           129% |             131% |
| Slug `.slug.glb` (219 glyphs)            |  419.7 |    132.8 |     112.0 |           666% |             594% |
| Slug curve texture section               |  262.3 |     77.9 |      68.8 |           391% |             365% |
| Slug band tables                         |  156.3 |     52.5 |      42.7 |           263% |             227% |
| Cubics: varint, interleaved              |   30.4 |     13.7 |      12.1 |            69% |              64% |
| Cubics: x and y split, 2-bit tags        |   30.4 |     14.1 |      12.5 |            71% |              66% |
| Cubics: i8 with escape                   |   28.6 |     13.8 |      12.4 |            69% |              66% |
| Cubics: StreamVByte                      |   26.7 |     13.7 |      13.1 |            69% |              69% |
| Cubics: triplets                         |   25.4 | **12.5** |  **11.8** |            63% |              63% |
| Cubics: contour dedup                    |   19.5 |     13.6 |      12.1 |            68% |              64% |
| Cubics: meshopt v1                       |   29.1 |     18.6 |      17.2 |            93% |              91% |
| Cubics: bp16 layout                      |   32.0 |     18.6 |      17.4 |            93% |              92% |
| Tolerance 1: explicit 2n+1               |   42.5 |     21.3 |      19.2 |           107% |             102% |
| Tolerance 1: implied explicit            |   42.4 |     19.8 |      18.1 |           100% |              96% |
| Tolerance 1: varint                      |   33.0 |     17.3 |      15.2 |            87% |              81% |
| Tolerance 1: i8 with escape              |   30.1 |     16.8 |      15.0 |            84% |              80% |
| Tolerance 1: StreamVByte                 |   31.4 |     17.3 |      16.1 |            87% |              86% |
| Tolerance 1: triplets                    |   30.3 |     15.2 |      14.4 |            76% |              76% |
| Tolerance 1: bp16                        |   35.4 |     22.1 |      20.5 |           111% |             109% |
| Tolerance 1: meshopt v1                  |   31.6 |     21.8 |      20.0 |           109% |             106% |
| Tolerance 1: GPU stencil                 |   54.7 |     28.3 |      23.8 |           142% |             126% |
| Tolerance 1: Slug texels, f16            |   78.8 |     43.6 |      38.1 |           219% |             202% |
| Tolerance 0.5: explicit 2n+1             |   50.5 |     24.6 |      21.5 |           123% |             114% |
| Tolerance 0.5: varint                    |   36.5 |     19.4 |      18.0 |            97% |              95% |
| Tolerance 0.5: triplets                  |   34.1 |     17.0 |      16.1 |            85% |              86% |
| Tolerance 0.5: bp16                      |   38.7 |     25.0 |      23.3 |           125% |             124% |
| Tolerance 0.5: GPU stencil               |   63.5 |     33.0 |      27.7 |           165% |             147% |
| Tolerance 0.25, half-unit: triplets      |   44.9 |     20.7 |      19.6 |           104% |             104% |
| Tolerance 0.25, half-unit: bp16          |   48.4 |     30.0 |      28.1 |           151% |             149% |

### Dancing Script 3.000 (CFF), full glyph set

| Encoding                                 | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ---------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source CFF as copied today               |   74.4 |     57.0 |      50.4 |           100% |             100% |
| Source CFF, hinting stripped             |   58.3 |     42.9 |      37.8 |            75% |              75% |
| Source CFF, dehinted and desubroutinized |  142.1 |     41.6 |      35.4 |            73% |              70% |
| Weak prototype                           |  219.7 |     77.7 |      65.3 |           136% |             129% |
| Slug `.slug.glb` (1,013 glyphs)          | 2843.7 |    441.8 |     349.1 |           775% |             692% |
| Slug curve texture section               | 2097.3 |    243.5 |     196.5 |           427% |             390% |
| Slug band tables                         |  745.2 |    195.3 |     150.5 |           343% |             298% |
| Cubics: varint                           |  163.8 |     36.4 |      30.0 |            64% |              60% |
| Cubics: x and y split                    |  163.8 |     38.1 |      33.1 |            67% |              66% |
| Cubics: i8 with escape                   |  154.7 |     38.2 |      33.3 |            67% |              66% |
| Cubics: linear prediction                |  159.0 |     37.9 |      34.1 |            66% |              68% |
| Cubics: StreamVByte                      |  145.0 |     39.6 |      36.6 |            69% |              73% |
| Cubics: triplets                         |  137.7 | **33.5** |      30.9 |            59% |              61% |
| Cubics: contour dedup                    |   57.4 |     33.5 |  **29.6** |            59% |              59% |
| Cubics: meshopt v1                       |  156.9 |     69.5 |      60.7 |           122% |             120% |
| Cubics: bp16 layout                      |  172.0 |     61.3 |      55.3 |           107% |             110% |
| Tolerance 1: explicit 2n+1               |  226.5 |     57.2 |      46.5 |           100% |              92% |
| Tolerance 1: implied explicit            |  225.5 |     51.7 |      42.4 |            91% |              84% |
| Tolerance 1: varint                      |  175.4 |     46.9 |      38.2 |            82% |              76% |
| Tolerance 1: i8 with escape              |  161.5 |     46.1 |      40.0 |            81% |              79% |
| Tolerance 1: StreamVByte                 |  167.6 |     48.2 |      44.6 |            84% |              89% |
| Tolerance 1: triplets                    |  161.5 |     39.3 |      36.0 |            69% |              71% |
| Tolerance 1: bp16                        |  187.9 |     71.6 |      64.3 |           125% |             127% |
| Tolerance 1: meshopt v1                  |  168.7 |     77.7 |      67.8 |           136% |             135% |
| Tolerance 1: GPU stencil                 |  293.0 |     89.8 |      70.7 |           158% |             140% |
| Tolerance 1: Slug texels, f16            |  421.0 |    135.4 |     107.9 |           237% |             214% |
| Tolerance 0.5: explicit 2n+1             |  268.1 |     65.9 |      51.1 |           116% |             101% |
| Tolerance 0.5: varint                    |  194.1 |     52.0 |      44.1 |            91% |              87% |
| Tolerance 0.5: triplets                  |  181.1 |     43.2 |      39.3 |            76% |              78% |
| Tolerance 0.5: bp16                      |  205.5 |     80.6 |      72.7 |           141% |             144% |
| Tolerance 0.5: GPU stencil               |  338.6 |    103.6 |      81.0 |           182% |             161% |
| Tolerance 0.25, half-unit: varint        |  263.5 |     65.0 |      50.2 |           114% |              99% |
| Tolerance 0.25, half-unit: triplets      |  237.6 |     51.6 |      46.1 |            91% |              91% |
| Tolerance 0.25, half-unit: bp16          |  257.1 |     94.8 |      83.9 |           166% |             166% |
| Tolerance 0.25, half-unit: GPU stencil   |  399.1 |    129.5 |     102.7 |           227% |             204% |

### Noto Sans CJK JP showcase (CFF), 155 glyphs

| Encoding                                 | Raw KB |  gzip KB | brotli KB | gzip vs source | brotli vs source |
| ---------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source CFF as copied today               |   31.8 |     28.5 |      26.5 |           100% |             100% |
| Source CFF, hinting stripped             |   27.1 |     24.4 |      22.6 |            85% |              85% |
| Source CFF, dehinted and desubroutinized |   26.2 |     23.0 |      20.9 |            81% |              79% |
| Weak prototype                           |   36.9 |     32.3 |      30.6 |           113% |             115% |
| Slug `.slug.glb`                         |  400.7 |    133.7 |     108.2 |           469% |             408% |
| Slug curve texture section               |  262.3 |     85.5 |      73.5 |           300% |             277% |
| Slug band tables                         |  137.3 |     46.0 |      33.9 |           161% |             128% |
| Cubics: varint                           |   31.6 |     23.8 |      20.2 |            83% |              76% |
| Cubics: i8 with escape                   |   30.4 |     22.5 |      19.9 |            79% |              75% |
| Cubics: StreamVByte                      |   28.1 |     21.5 |      20.4 |            75% |              77% |
| Cubics: triplets                         |   25.4 | **18.7** |  **17.9** |            66% |              67% |
| Cubics: contour dedup                    |   30.2 |     23.9 |      20.2 |            84% |              76% |
| Cubics: meshopt v1                       |   29.4 |     24.4 |      23.0 |            86% |              87% |
| Cubics: bp16 layout                      |   32.0 |     25.9 |      24.2 |            91% |              91% |
| Tolerance 1: explicit 2n+1               |   44.3 |     33.0 |      28.2 |           116% |             106% |
| Tolerance 1: implied explicit            |   36.9 |     28.8 |      24.7 |           101% |              93% |
| Tolerance 1: varint                      |   31.8 |     25.4 |      21.9 |            89% |              83% |
| Tolerance 1: triplets                    |   27.1 |     20.2 |      19.3 |            71% |              73% |
| Tolerance 1: bp16                        |   33.9 |     28.1 |      26.3 |            98% |              99% |
| Tolerance 1: meshopt v1                  |   29.7 |     26.2 |      24.9 |            92% |              94% |
| Tolerance 1: GPU stencil                 |   47.9 |     33.8 |      28.0 |           118% |             106% |
| Tolerance 0.5: triplets                  |   29.6 |     22.0 |      20.8 |            77% |              78% |
| Tolerance 0.5: bp16                      |   36.4 |     30.4 |      28.6 |           107% |             108% |
| Tolerance 0.5: GPU stencil               |   53.0 |     37.6 |      31.3 |           132% |             118% |
| Tolerance 0.25, half-unit: triplets      |   36.8 |     27.0 |      25.6 |            95% |              96% |
| Tolerance 0.25, half-unit: bp16          |   43.2 |     36.6 |      34.5 |           128% |             130% |

### Noto Sans CJK JP 2.004 (CFF), 65,535 glyphs (lean run)

| Encoding                                  | Raw MB |  gzip MB | brotli MB | gzip vs source | brotli vs source |
| ----------------------------------------- | -----: | -------: | --------: | -------------: | ---------------: |
| Source CFF as copied today                |  15.46 |    13.20 |     10.89 |           100% |             100% |
| Slug `.slug.glb` (65,524 glyphs, 2 pages) | 194.17 |    62.71 |     45.96 |           475% |             422% |
| Slug curve texture section                | 134.22 |    41.44 |     30.81 |           314% |             283% |
| Slug band tables                          |  59.95 |    21.27 |     15.00 |           161% |             138% |
| Cubics: varint                            |  18.12 |    11.08 |      8.17 |            84% |              75% |
| Cubics: triplets                          |  14.28 | **8.39** |  **7.10** |            64% |              65% |
| Cubics: bp16 layout                       |  18.41 |    12.78 |     11.05 |            97% |             101% |
| Tolerance 1: varint                       |  17.76 |    11.50 |      8.55 |            87% |              78% |
| Tolerance 1: triplets                     |  14.70 |     8.71 |      7.38 |            66% |              68% |
| Tolerance 1: bp16                         |  18.88 |    13.36 |     11.68 |           101% |             107% |
| Tolerance 1: GPU stencil (5.22 B/curve)   |  27.29 |    15.86 |     11.41 |           120% |             105% |

Not measured on full CJK: dehinted source, WOFF2, the weak prototype, and the remaining candidates. That job took more than 25 CPU minutes and I stopped it once the lean run had covered the leading candidates.

## Findings per candidate

1. **Implied on-curve points.** Ablation on Inter Latin, composites kept, gzip:
   - Explicit 2n+1: 14.2 KB.
   - Dropping line controls: 12.3 KB.
   - Also keeping implied points implied: 10.5 KB, which is −26% overall. Brotli follows the same pattern, as do all fonts.
2. **Stream separation.**
   - Splitting x and y planes vs interleaving them is neutral on gzip; interleaving is better on brotli (Inter full: 52.7 vs 53.7 KB).
   - 1-bit vs 1-byte flags makes ±1% difference after compression.
   - Byte-plane transposition helps gzip on fixed i16 (Inter Latin 10.2 vs 11.0) but hurts brotli.
   - **Bit-packing hurts both coders every time** (bp16 rows; also the weak prototype).
3. **Prediction.**
   - Tangent-continuity prediction is within 1% of plain deltas.
   - Linear (parallelogram) prediction is worse after compression on every font (for example Inter full brotli 58.6 vs 52.7).
   - Prediction is not worth having.
4. **Precision.**
   - i8 with an escape plane comes within ±3% of varint.
   - i16 deltas are worse than varint.
   - f16 em (Slug today) is lossy for TrueType: Inter up to 2.0 u, and 0.83% of coordinates off by 0.5 u or more; Serif up to 0.44 u.
   - cu2qu error is in the table under "Answer".
5. **Cubics and reuse.**
   - Keeping CFF cubics is the smallest and is exact: Dancing full triplets 30.9 KB brotli vs 36.0 KB at tolerance 1. But neither Slug nor the stencil can read cubics directly.
   - Keeping composites: Inter full triplets 51.5 vs 70.3 KB gzip decomposed.
   - Contour dedup: −0.6% to −4% gzip on top of varint. Large raw savings, which the compressor mostly finds anyway.
6. **meshopt.**
   - Always worse than byte-varint planes after gzip or brotli (Inter full: 72.6 vs 63.6 KB gzip).
   - The decoder module is 7.7 KB gzip (`meshopt_decoder.mjs`, 29.3 KB raw). It decodes Inter full in 0.09 ms.
7. **GPU layouts (bytes per curve, decomposed, including per-contour costs).**
   - Slug RGBA16F texels: 8.68 (Inter Latin), 8.23 (Dancing full), 8.36 (CJK showcase), 8.44 (CJK 2.004).
   - Slug texels as i16 half units: the same byte count, and exact.
   - Stencil i16 points: 5.07–6.19 (Inter 5.53, Serif 5.48, Dancing tolerance 1 5.82, CJK 2.004 5.22).
   - Absolute i16 planes without wrap and rotation: about 4 B per point, which needs contour lookups in the shader.
   - **One buffer can serve both `outlineAt()` and Slug.** `outlineAt()` walks the same stencil and multiplies by `fontSize/upm`; the emitter's output is byte-identical to the shipped one, as above.
8. **WOFF2 glyf transform.** Strong (51–82% of source gzip), but serial and not GPU-readable. The triplet stream above uses the same triplet idea and is 6–16% smaller, because it drops the bbox, instruction and overlap streams.
9. **Maintainer's proposal.** Size is covered above. Its scalar Wasm decode takes 0.27–0.84 µs/glyph, slower than triplets. It is decodable in a compute shader, but a fragment shader cannot read point `i` without a per-block base table, which the format does not carry.
10. **StreamVByte.** Raw size between varint and triplets, but compressed it is no better than varint; triplets dominate it.

**Point growth and curve count after cu2qu:**

| Font         | Cubic points |     Tol 0.25 |      Tol 0.5 | Tol 1 |        Tol 2 |
| ------------ | -----------: | -----------: | -----------: | ----: | -----------: |
| Dancing full |       60,093 |         +61% |         +35% |  +16% |          +2% |
| CJK showcase |       10,474 |         +35% |         +19% |   +7% |          −1% |
| CJK 2.004    |    6,156,570 | not measured | not measured | +3.2% | not measured |

Quadratic curves per font, against Slug's fixed 4-split today:

| Font         | Slug 4-split today |       Tol 0.5 |         Tol 1 |
| ------------ | -----------------: | ------------: | ------------: |
| Dancing full |            ~79,722 | 61,750 (−23%) | 50,368 (−37%) |
| CJK showcase |            ~12,886 | 10,100 (−22%) |  8,825 (−32%) |
| CJK 2.004    |            ~7.29 M |  not measured | 5.22 M (−28%) |

Quadratics per cubic: 3.08 at tolerance 0.5 and 2.50 at tolerance 1 (Dancing), against 4 today.

**CFF precision and size trade-off, Dancing full:**

| Conversion                 | Max / p99 / mean error (units) | Triplets gzip / brotli KB |
| -------------------------- | ------------------------------ | ------------------------: |
| Tol 0.25, integer grid     | 0.75 / 0.59 / 0.29             |               47.2 / 42.3 |
| Tol 0.25, half-unit grid   | 0.50 / 0.35 / 0.17             |               51.6 / 46.1 |
| Tol 0.5, integer grid      | 0.88 / 0.69 / 0.31             |               43.2 / 39.3 |
| Tol 0.5, half-unit grid    | 0.72 / 0.50 / 0.23             |               46.2 / 41.6 |
| Tol 1, integer grid        | 1.26 / 1.04 / 0.40             |               39.3 / 36.0 |
| Tol 1, half-unit grid      | 1.15 / 0.90 / 0.34             |               41.6 / 37.8 |
| Tol 2, integer grid        | 2.17 / 1.73 / 0.53             |               35.7 / 33.0 |
| Cubics kept                | 0                              |               33.5 / 30.9 |
| Source CFF as copied today | —                              |               57.0 / 50.4 |

## Decode speed

**What was timed:**

- Node 22, all-Wasm, median of 3 runs of 21–51 repetitions each.
- **Shipped:** `dist/text-shaper.wasm`'s `pmndrs_glyph_shaper_glyph_outline` called directly. That is read-fonts' glyf loader, or the CFF interpreter plus `cubic_to_quadratics_into(…, 4)`, plus its f32 encoding.
- **Candidates:** my scalar no_std Rust decoders, built with the repo's pinned 1.97.1 toolchain.
- Not a native Rust bench.
- Candidates decode the decomposed stream (tolerance 1 for CFF). All checksums match.

Per-glyph figures are µs/glyph; per-1,000-glyph figures are ms.

| Font (glyphs)      | Load: triplets, whole font | Load: varint | Load: bp16 | `outlineAt()` core: stencil → f32 | Shipped Wasm decode | Shipped `outlineAt()` incl. JS reader | Candidate `outlineAt()` incl. same JS reader | Slug bands at load (slug-core) |
| ------------------ | -------------------------- | ------------ | ---------- | --------------------------------- | ------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------ |
| Inter (2,937)      | 0.51 ms, 0.17              | 0.30         | 0.27       | 0.14                              | **1.24**            | 2.19                                  | 0.99                                         | 8.3                            |
| Serif (1,464)      | 0.30 ms, 0.21              | 0.26         | 0.32       | 0.18                              | **1.56**            | 2.74                                  | 1.33                                         | 11.0                           |
| Dancing (1,017)    | 0.30 ms, 0.29              | 0.37         | 0.51       | 0.31                              | **5.54**            | 7.55                                  | 1.75                                         | 16.3                           |
| CJK showcase (155) | 0.04 ms, 0.27              | 0.50         | 0.54       | 0.48                              | **10.5**            | 9.7                                   | 2.2                                          | 24.9                           |
| CJK 2.004 (65,535) | 42 ms, 0.64                | 0.71         | 0.82       | 0.53                              | **8.8**             | 12.3                                  | 2.3                                          | 30.7 (2.0 s eagerly)           |

- **Composite expansion (JS, triplets plus expansion, composites kept):** Inter full 0.94 ms, Serif full 0.64 ms.
- **JS reader cost:** the JS reader's per-curve arrays dominate the candidate `outlineAt()` path. #253's packed-view API would remove that cost.

## Decoder size (Wasm, opt-level s, LTO, stripped; KB)

| Decoder                                        |  Raw |  gzip | brotli |
| ---------------------------------------------- | ---: | ----: | -----: |
| Varint                                         | 0.60 |  0.35 |   0.33 |
| Triplets                                       | 0.97 |  0.56 |   0.52 |
| bp16                                           | 0.93 |  0.60 |   0.57 |
| Stencil emitter (`outlineAt()`)                | 1.00 |  0.64 |   0.59 |
| Triplets plus stencil                          | 1.92 |  1.09 |   1.00 |
| Band builder (slug-core)                       | 24.6 |   9.3 |    7.9 |
| JS triplets plus composite expansion, minified |  2.6 |  1.26 |   1.17 |
| Today: read-fonts decoder in the shaper        |    — | +24.7 |      — |

The JS decoder's handling of nested composite transforms is approximate.

## GPU usability per candidate

| Candidate                                                         | Readable by a shader?                                                                    | Precision                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Source glyf, CFF, WOFF2, triplets, varint, StreamVByte, i8+escape | No (serial, variable length); decode at load                                             | Lossless glyf; CFF as stated                              |
| bp16                                                              | Compute-shader decode only (block widths need a prefix sum); not per-curve random access | i16 font units                                            |
| meshopt                                                           | No; Wasm decode, then absolute layout                                                    | Lossless                                                  |
| Absolute i16 planes                                               | Yes (storage buffer, or RG16I texture on WebGL2); needs contour bounds                   | Exact i16 font units                                      |
| **Stencil i16 buffer**                                            | **Yes: 3 fetches per curve reference**                                                   | Exact i16 (half-unit option for CFF)                      |
| Slug texels, i16                                                  | Yes (as today, integer texture)                                                          | Exact, half units                                         |
| Slug texels, f16 em (today)                                       | Yes                                                                                      | Lossy: Inter up to 2 u; CFF 4-split as in the error table |

## Recommendation

1. **Artifact:** add `outlines.format: "quadratic-stream-v1"` as WOFF2-style triplets.
   - Composites kept.
   - For CFF, cu2qu at bake time with **tolerance 0.25 on a half-unit grid** if precision is the priority: max 0.50 / 0.42 / 0.55 u on Dancing, the showcase and CJK 2.004 (sampled). It still undercuts the source as copied (Dancing 46.1 vs 50.4 KB brotli; showcase 25.6 vs 26.5).
   - Otherwise tolerance 0.5 on the integer grid (max 0.88–1.03 u; 22–28% under the source).
2. **Runtime:** a 0.6–1.1 KB gzip decoder (Wasm or JS), loaded only with outlined artifacts.
   - It writes the stencil buffer, and `outlineAt()` and Slug both read it.
   - This removes the read-fonts decoder (+24.7 KB gzip) and the runtime cubic split.
3. **Slug:** keep the band logic and change only the curve fetch (stencil from the point buffer). Then either ship bands as today, or build them lazily per glyph at load (8–31 µs/glyph).
   - Even shipping bands halves outlines-plus-Slug bytes.
   - Building them at load cuts 80–90% (Inter Latin: 59.0 → 8.2 KB brotli).

**Gate before adopting:** shader speed parity of the stencil fetch on WebGPU and WebGL2. That was not measured.

## Not measured

- GPU shader speed: no GPU here.
- SIMD decoder variants.
- A native Rust bench of read-fonts.
- CFF2 and variable fonts: no fixture.
- Composites kept on the GPU as instanced draws.
- Converting cubics at load instead of at bake time.
- The visual effect of unbowed lines in Slug.
- Full-CJK variants beyond the lean run.

## Reproduce

All under `OE/` = `spikes/outline-stream/research/encoding/`. Run Python with `python3 -I` and Node with `/opt/node22/bin/node`.

**Sizes:**

- `scripts/model.py`, `scripts/enc.py`, `scripts/enc3.py`: the outline model and every encoder.
- `scripts/run.py <key> <font> latin|full`, `scripts/run2.py`, `scripts/run3.py`: the size measurements.
- `scripts/cjk_lean.py`: the lean full-CJK run.
- `scripts/weak_baseline.py`: the original `stream_estimate.py` with brotli added.

**Precision:**

- `scripts/cu2qu_error.py <font> [sample]`: cu2qu and Slug-split error.
- `scripts/f16_error.py`: Slug f16 coordinate error.

**Slug:**

- `node packages/glyph/dist/node/cli.js bake … --slug --split`, then `scripts/slug_sizes.py`. Baked files are in `slug/`.

**Speed:**

- `decoder/`: the Rust crate. Build with `cargo +1.97.1 build --release --target wasm32-unknown-unknown [--no-default-features --features …]`; outputs go in `wasm/`.
- `scripts/emit_bench3.py` writes the inputs; `scripts/bench3.mjs bench3 <key> wasm/all.wasm <dist>/text-shaper.wasm <dist>/glyph-outline.js` runs the benchmark; `scripts/median3.py` takes medians.
- `scripts/crosscheck.mjs`: compares decoded output against the shipped decoder.
- `scripts/bench.mjs`: the JS decode and composite expansion benchmark.

**Tables:**

- `scripts/report_tables.py`, `scripts/summary.py`, `scripts/cff_table.py`. Generated output is in `tables.md` and `summary.md`; raw logs are in `logs/` and results in `results/`.

---

# Addendum: follow-up checks

## The implicit form from #244 (comment 5997423622)

**The posted coefficients have one sign error.** Checked on 2,000 random integer curves in float64 (`scripts/check3.py`):

- **As posted:** F does not vanish on the curve. The worst |F| is 4·Δ².
- **With A and B negated**, i.e. `A = 2y1 − y0 − y2` and `B = x0 − 2x1 + x2` (or, equivalently, C negated): the worst |F| on the curve is 1.8e-12·Δ².
- **Unchanged:** C, D, E and F (the posted F, written G in my script) are correct as posted.

**f32 precision is not a blocker** (`scripts/check2.py`):

- Setup: coordinates up to 2,048 ± 300 font units, with points sampled 0.01–0.25 font units off the curve on both sides.
- Result: 0 wrong inside/outside signs in 48,000 samples. That holds both with coefficients precomputed in absolute coordinates and when evaluated relative to P0.

**It does not make storage smaller.**

- Implicit coefficients are derived from the three points, so storing them would cost more bytes.
- With implied on-curve points, a run of off-curve controls q gives segment k the power-basis coefficients `b = q_k − q_(k−1)` and `a = (q_(k−1) − 2q_k + q_(k+1)) / 2`. The implicit A and B are ±a with the axes swapped.
- So the coefficients are the first and second differences of the stored control polygon.
  - The deltas the stream already stores are the b coefficients.
  - Storing second differences is linear prediction, which measured worse after compression (Inter full: 58.6 vs 52.7 KB brotli).

**Where it does help: rendering, not storage.**

- It gives an inside test for a triangle-based (Loop–Blinn-style) or tessellated rasterizer, and F/|∇F| as an approximate distance for antialiasing.
- Slug's band ray cast needs the crossing roots rather than the implicit sign, so it does not change Slug.

## Why Slug stores f16 em coordinates

**Where the layout comes from:** the reference Slug shaders by Eric Lengyel (`EricLengyel/Slug` at be3c13eb). The repository's license today is MIT or Apache-2.0, and its README asks for credit in distributed software.

- The README specifies a curve texture with "four 16-bit floating-point channels", holding endpoint-shared control points in em space, and a two-channel 16-bit unsigned band texture.
- The pixel shader subtracts the em-space sample coordinate directly from the fetched points (`SlugPixelShader.hlsl`, the `p12` and `p3` loads).
- `PMNDRS_font_slug` V0 adopted that layout through the Three Flatland uikit fork.
- No decision in the repository compares it against integer font units.

**Why it is lossy:** f16 has 11 significant bits. At 1 em the step is 2^-10 em, about 2 units at 2,048 units per em, which matches the measured worst error on Inter (2.0 units).

**The integer alternative costs nothing per curve:**

1. Scale the em-space sample coordinate by `unitsPerEm` once, in the vertex shader.
2. Fetch i16 points from an integer texture. Slug already uses R32UI/R16UI integer textures with exact texel fetches for WebGL2.
3. Convert each fetched point to float.

The rest of the shader (`fwidth`, root solving, coverage) then runs in font units, exactly, for coordinates up to ±32,767.

**The current reference is the same.**

- The current `main` of `EricLengyel/Slug` has byte-identical shaders to be3c13eb (checked 2026-10-06).
- Its README now says "the patent has been dedicated to the public domain", and that the code may be used for any purpose, with credit required when distributed.
- The curve format is unchanged: four f16 channels holding em-space points.

**Lines: the reference encodes a line from p1 to p2 as the quadratic {p1, p2, p2}, duplicating the endpoint.**

- This is a different choice from #235's midpoint control `{p1, (p1 + p2) / 2, p2}`.
- The midpoint form makes the t² coefficient zero, so `solve-quadratic.ts` takes its linear path. The duplicated-endpoint form keeps the t² coefficient nonzero.
- Which one is better for the band solver's root eligibility and precision has not been measured here. The stencil format carries no control point for lines at all, so the shader can synthesize either one.
