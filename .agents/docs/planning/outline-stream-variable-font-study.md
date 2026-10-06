---
type: Engineering Research
title: Outline stream variable-font study
description: 'Full measured report on variable TrueType and CFF2 fonts in the outline stream: delta sizes, IUP, compatible cu2qu, SIMD instancing, Slug bands and shaping tables.'
tags: [outlines, variable-fonts, simd, slug, research]
sources:
  - id: summary
    resource: outline-stream-research.md
    title: Outline stream research summary
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
status: draft
---

# Variable fonts in the triplet outline stream: a measured study

> **Status of this report (reviewed 2026-10-06).** This is the study agent's report as written. Measurements stand; read these parts with the decisions in mind:
>
> - **Precision:** the recommendation of exact f64 instancing is superseded. The maintainer accepted f32 ([outline SIMD scope](decisions/outline-simd-scope.md)).
> - **SIMD:** the finding that SIMD does not speed up triplet decoding revised decision 3 on #244: the triplet decoder stays scalar, and SIMD goes to instancing, composite expansion and ink bounds.
> - **Slug bands:** "build bands at load" is this study's recommendation for variable fonts. For static fonts the maintainer kept baked, packed bands as the default; the rule for variable fonts is not decided ([variable fonts in the outline stream](decisions/variable-font-outline-stream.md)).
> - **Timings named "re-instancing"** in the summary are the instancing step alone. With composite expansion and ink bounds, which every instance needs, Inter full takes 0.26 / 0.41 ms (f32 / exact), as in the Q5 table.
> - **Slot corruption without the map:** recomputed from `logs/pointorder-*.txt`, it is 46–49% on Inter full and 31–48% on Roboto Flex full, not 47–49% on both. The Q3 table's Roboto Flex maximum is 14,213, not 14,133.

The outline format holds up for variable fonts, and the recommendation is to adopt it for TrueType now and for CFF2 with the point-major delta layout. Two things decide the design. First, the deltas are 75–97% of the bytes, so the delta layout matters far more than the base points. Second, exact parity with `fontTools.varLib.instancer` needs sparse deltas, IUP done at load, and f64 arithmetic. Nothing here touched the repo, and no GPU was available, so every GPU number is an estimate.

## Summary

**TrueType: it fits, and it is exact.**

- **Wire:** the base triplet stream with composites kept, plus delta streams in the base stream's point order, coded as triplets with a zero-pair flag and "previous delta" prediction, plus a region table and an axis table.
  - Total size is 69–76% of `gvar`+`glyf`+`loca` (brotli). Inter full: 193 KB against 281 KB. Roboto Flex full: 549 KB against 739 KB.
  - Deltas are 75% (Inter) to 97% (Roboto Flex) of the bytes.
- **Sparse beats dense:** variant (b), sparse deltas with IUP at load, then f64 instancing, matched the fontTools instancer exactly.
  - 0 mismatched coordinates at 34 axis locations across 4 sets, composites expanded and ink bounds included. This holds in scalar f64 and in f64x2 SIMD.
  - Variant (a), IUP expanded and rounded at bake, is lossy: 1 unit off on up to 0.13% of coordinates. It is also no smaller.
  - Recommendation: ship sparse.
- **Speed (Node 22, Wasm SIMD128):** the instancing step for Inter full takes 0.13 ms (f32) or 0.30 ms (exact f64x2); Roboto Flex full takes 0.35 / 0.70 ms. With composite expansion and ink bounds, a re-instance is 0.26 / 0.41 ms and 0.43 / 0.72 ms.
  - The whole load (decode plus IUP) is 2.6 ms for Inter full and 9.3 ms for Roboto Flex full.
  - SIMD gives 1.6–5.1× on instancing, but about 1× on triplet decoding. The better of the two SIMD triplet decoders runs at 0.62–1.23× scalar per step (individual variants fell to 0.41×), so the scalar decoder should stay.
- **Composites:** kept on the wire and expanded per instance, exactly. 1,882 of Inter's 2,933 glyphs are composites (1,694 have nonzero offset deltas); Roboto Flex has 517 of 948 (463).
- **Point order:** apply deltas in stream order, then build the GPU stencil. No fixture contour needs rotation; the only shift comes from the wrap points. Applying deltas to stencil slots without the index map corrupts 46–49% of slots on Inter full and 31–48% on Roboto Flex full.

**CFF2: compatible conversion never failed.**

- 0 failures across 1,464 Source Serif glyphs and 65,535 Noto CJK glyphs, at tolerance 1, 0.5 and 0.25.
- Converting real masters at the region peaks ("basis B") is required. Converting single-region "masters" ("basis A") doubles the worst-case error at corner instances (2.57 vs 1.20 units).
- **Bytes:** at tolerance 1, ours is 14% smaller than Source Serif's CFF2 as stored but 18% larger than dehinted CFF2. With CJK's single region it is 1.4% smaller than CFF2.
  - Source Serif's figure needs the point-major delta layout (every region's delta for one point together). With region-major it is +38%.

**Slug bands:** bands conservative across all regions are correct (0 missed references and 0 sort-key violations at every instance tested) but cost 1.6× (Inter) to 3.1× (Roboto Flex) the references per band. Bands built for the default instance alone break at every other instance. The recommendation is bands conservative over only the axes the app animates: wght-only gives Roboto Flex 6.0 refs per band against 13.9.

## Recommendation

1. **TrueType:** adopt `quadratic-stream-v1` plus sparse, gvar-aligned delta streams (region-major, triplets with the zero-pair flag, 'prev' prediction), a region table and an axis table.
   - At load: decode, run IUP in f64 into a resident f64 pool, and instance with f64x2 SIMD for exact fontTools parity.
   - If a 1-unit difference on ≤13 of 637,680 coordinates is acceptable, f32 SIMD is about 2× faster.
   - Drop phantom points (HVAR carries metrics) and hinting.
2. **CFF2:** convert with compatible cu2qu over real peak masters, and code deltas point-major against the default master. Tolerance 1 matches CFF2's bytes; tolerance 0.25 on a half-unit grid costs 25–47% more for about 3× less error.
3. **Slug:** build bands at load, conservative over the axes in use. Rebuild per instance only for static instances.
4. **#99 / shaping payload:** keep `fvar`, `avar`, `HVAR`/`VVAR`, `MVAR`, the GDEF ItemVariationStore and GSUB FeatureVariations there, not in the outline stream.
5. **Gate:** WebGPU compute instancing and shader parity are estimated only. That is the measurement still needed.

---

## Fixtures

All downloaded 2026-10-06 from the default or release branch heads (mutable URLs; the sha256 pins the bytes), into `varfont/fonts/` and treated as untrusted data. All are OFL.

| File                          | Source URL                                                                                                                                                | sha256                                                             | Version               | Glyphs, upm  | Axes                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------- | ------------ | --------------------------------- |
| `Inter-VF.ttf`                | `https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf`                                                                  | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` | 4.001 (git-66647c0bb) | 2,933, 2048  | opsz, wght; avar on wght          |
| `RobotoFlex-VF.ttf`           | `https://raw.githubusercontent.com/google/fonts/main/ofl/robotoflex/RobotoFlex%5BGRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght%5D.ttf` | `9b523f7d82593df0107173849ebb8c817471a1df4b4fb2c3cbf40cfd810c8281` | 3.200                 | 948, 2048    | 13 axes, 84 regions               |
| `SourceSerif4-VF.otf` (CFF2)  | `https://raw.githubusercontent.com/adobe-fonts/source-serif/release/VAR/SourceSerif4Variable-Roman.otf`                                                   | `867b73c6a954a4a64616906d179f94572a748790a1d022ebeeff07f56ea0221a` | 4.005                 | 1,464, 1000  | wght, opsz; 8 regions (4 corners) |
| `NotoSansCJKjp-VF.otf` (CFF2) | `https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/OTF/NotoSansCJKjp-VF.otf`                                                        | `ab2728702f90d2ae900309f299dc3c2b075010888a1a8a67fbd5b4c6aff713a0` | 2.004                 | 65,535, 1000 | wght (default 100); 1 region      |

- The full 30.8 MB CJK font was practical, so no smaller CFF2 font was needed.
- **Sets:** "Latin" is U+0020–007E plus U+00A0–00FF (fontTools subsetter, default features), and "full" is every glyph.
- KB means 1,000 bytes. Compression is gzip -9 and brotli q11 (lgwin 24). Timings are Node 22 medians of 9 samples, on an idle 4-core machine.

---

## Q1. Delta stream size

**Model:**

- **Points:** var points are a simple glyph's glyf points in stored order, or a composite's component offsets. gvar point _i_ maps to stream point _i_.
- **Phantom points:** dropped, because every fixture has HVAR. They are shown as a separate line.
- **Coders:**
  - `tripz` is the WOFF2 triplet coding, with flag byte 0x80 meaning (0, 0) and no data bytes.
  - `prev` codes each delta as the difference from the same tuple's previous point.
  - The varint, i8+escape and gvar-packed-run coders were all measured. All are within ±3% of `tripz` once prediction is on, except gvar-packed runs, which are 12–24% worse.
- **Layouts:**
  - **Region-major:** per region, a glyph-presence bitmap, then its tuples.
  - **Glyph-major:** per glyph, a tuple count and region ids. This is the layout benchmarked in Rust.
  - **Point-major:** per point, every region's delta together.

**Inter 4.001 (KB)**

| Stream                                                   | Latin gzip / brotli | Full gzip / brotli |
| -------------------------------------------------------- | ------------------- | ------------------ |
| Font `gvar`                                              | 41.3 / 36.0         | 264.3 / 211.1      |
| Font `glyf`+`loca` (unhinted font)                       | 12.0 / 11.3         | 81.6 / 69.0        |
| Font `gvar`+`glyf`+`loca`                                | 53.3 / 47.5         | 345.8 / 280.9      |
| WOFF2 file, whole variable font (every table)            | — / 55.2            | — / 350.2          |
| **Base stream** (triplets, composites kept)              | 8.9 / 8.5           | 52.4 / 49.1        |
| Region table / axis table (fvar triples + avar)          | 0.04 / 0.08         | 0.04 / 0.08        |
| Deltas (a) dense, triplets, no prediction                | 35.5 / 33.8         | 205.8 / 193.5      |
| **Deltas (a) dense, triplets, prev**                     | 28.9 / 26.6         | 152.6 / 142.7      |
| **Deltas (b) sparse, triplets, prev**                    | 28.9 / 26.6         | 154.2 / 144.0      |
| Deltas (b) sparse, glyph-major (benchmarked layout)      | 28.6 / 26.5         | 157.8 / 144.4      |
| Deltas, IUP re-optimized at tolerance 0.5 (lossy)        | 29.8 / 27.3         | 158.8 / 147.5      |
| Deltas, point-major, dense values (lossy, see note)      | 27.6 / 25.5         | 145.0 / 130.0      |
| Phantom deltas (dropped)                                 | 1.0 / 0.9           | 6.8 / 6.2          |
| **Total ours, sparse** (each part compressed separately) | 37.9 / 35.2         | 206.7 / 193.2      |

**Roboto Flex 3.200 (KB)**

| Stream                                                          | Latin gzip / brotli | Full gzip / brotli |
| --------------------------------------------------------------- | ------------------- | ------------------ |
| Font `gvar`                                                     | 299.5 / 244.5       | 920.4 / 714.7      |
| Font `glyf`+`loca`                                              | 9.0 / 8.6           | 27.4 / 24.6        |
| Font `gvar`+`glyf`+`loca`                                       | 308.6 / 253.0       | 948.0 / 739.4      |
| WOFF2 file, whole variable font                                 | — / 278.4           | — / 791.5          |
| **Base stream**                                                 | 6.4 / 6.2           | 18.0 / 16.9        |
| Region table / axis table                                       | 0.22 / 0.21         | 0.22 / 0.21        |
| Deltas (a) dense, triplets, no prediction                       | 233.3 / 214.9       | 680.9 / 620.1      |
| **Deltas (a) dense, triplets, prev**                            | 204.1 / 184.5       | 588.2 / 525.4      |
| **Deltas (b) sparse, triplets, prev**                           | 205.9 / 186.5       | 593.5 / 532.0      |
| Deltas (b) sparse, glyph-major                                  | 213.8 / 190.3       | 626.9 / 542.3      |
| Deltas, IUP re-optimized at tolerance 0.5 (lossy)               | 216.5 / 198.3       | 634.1 / 564.7      |
| Deltas, per-axis zero-skip bitmaps, varint, prev (dense values) | 198.0 / 174.7       | 580.3 / 497.9      |
| Phantom deltas (dropped)                                        | 5.9 / 5.0           | 21.9 / 17.3        |
| **Total ours, sparse**                                          | 212.8 / 193.0       | 612.0 / 549.2      |

**Ratios (sparse, brotli):**

- Total against `gvar`+`glyf`+`loca`: Inter Latin 74%, Inter full 69%, Roboto Flex Latin 76%, Roboto Flex full 74%.
- Deltas against `gvar`: 74%, 68%, 76%, 74%.
- The whole-font WOFF2 is not a like-for-like comparison, since it includes every table. Even so, our outline streams are smaller than it (Inter full 193 vs 350 KB).

**Findings:**

- **Dense vs sparse:** within ±1.3%, because these fonts are 89.5% (Inter) and 94.7% (Roboto Flex) explicit already.
- **IUP decode cost for (b), one-off at load, SIMD build:**

  | Font, set         | IUP to f32 | IUP to f64 |
  | ----------------- | ---------- | ---------- |
  | Inter Latin       | 0.08 ms    | 0.07 ms    |
  | Inter full        | 0.87 ms    | 0.81 ms    |
  | Roboto Flex Latin | 0.89 ms    | 0.81 ms    |
  | Roboto Flex full  | 3.44 ms    | 3.46 ms    |

- **IUP re-optimization (lossy) is larger** once prediction is on, because the points it removes were already cheap. Reject it.
- **Prediction:** 'prev' saves 15–26%.
- **Region-major vs glyph-major:** region-major is 0.3% (Inter) to 1.8% (Roboto Flex) smaller than glyph-major.
- **Point-major and zero-skip:** both rows above are on dense (IUP-at-bake, rounded) values, so they are lossy for TrueType. An exact sparse point-major layout was not measured.

---

## Q2. Composites

| Font, set         | Composites / glyphs | With tuples | With nonzero offset deltas | Component records | Stored simple points → decomposed |
| ----------------- | ------------------- | ----------- | -------------------------- | ----------------- | --------------------------------- |
| Inter Latin       | 119 / 291           | 119         | 112                        | 191               | 4,413 → 7,982                     |
| Inter full        | 1,882 / 2,933       | 1,882       | 1,694                      | 3,565             | 28,319 → 100,442                  |
| Roboto Flex Latin | 69 / 221            | 69          | 69                         | 146               | 3,372 → 5,931                     |
| Roboto Flex full  | 517 / 948           | 517         | 463                        | 1,018             | 9,826 → 27,763                    |

- **How it works:** a composite's deltas move its component offsets, one var point per component. The instancer rounds instanced offsets with otRound, as fontTools does, then expansion adds each component glyph's instanced points.
- **Verified:** the decomposed output equals fontTools' instanced `getCoordinates()` exactly on the sparse f64 path, and ink bounds match for composites too.
- **Not covered:** the fixtures contain no transformed and no nested components. The Rust parser rejects transforms.
- **Cost:** expansion takes 0.055 ms for Inter full (0.019 µs/glyph) and 2.7 ms for CJK.

---

## Q3. Point order

**Order of operations, verified:**

1. Decode base points and deltas in stream (glyf) order.
2. Run IUP per tuple, in original contour order and boundaries, with no wrap point.
3. Instance: `p = round(base + Σ scalar·Δ)`.
4. Expand composites with rounded offsets.
5. Build the GPU stencil: rotate each contour to an on-curve start, append one wrap point, synthesize the midpoint for all-off-curve contours, and put the tag in bit 0 of x.

**Measurements:**

| Check                                                                                                             | Inter full                                    | Roboto Flex full                |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| Contours needing rotation                                                                                         | 0 of 7,011 decomposed                         | 0 of 2,103                      |
| All-off-curve contours                                                                                            | 0                                             | 0                               |
| Wrap points (one per contour)                                                                                     | 7,011                                         | 2,103                           |
| IUP rotation-invariant (contour tuples tested; max \|diff\|)                                                      | 9,030; 0.0                                    | 16,080; 0.0                     |
| Stencil of the Wasm instance via a map built once from the default, against the stencil of the fontTools instance | 2,911/2,911 glyphs equal at every location    | 939/939                         |
| Stream-order deltas applied to stencil slots without the map (non-default locations)                              | 49,927–52,429 of 107,453 slots wrong (46–49%) | 9,267–14,213 of 29,866 (31–48%) |

- **Why the map is fixed:** on/off flags never vary, so the rotation and the slot→point map are instance-invariant and can be built once at load.
- **GPU-side instancing:** gather through that map, with the wrap slot duplicating its source's delta.
- **Midpoint caveat:** a synthesized midpoint must be computed from instanced points. Averaging deltas onto a rounded base midpoint can differ by rounding. This case does not occur in the fixtures.

---

## Q4. CFF2

**Method:**

- `curves_to_quadratic` runs over all masters at once (all_quadratic, same segment count in every master).
- Basis B uses the default plus real masters at each region peak, and solves the deltas back through the peak scalar matrix, rounded.
- Error is per cubic segment against the true blended cubic at the same normalized location: 65 samples, against the quadratic chain flattened 64 times per piece.

**Results:**

| Font, conversion                                  | Failures | Points vs cubic (compatible / default-only) | Worst location: max / p99 / mean error (float instance) | Rounded to storage grid: max / mean | Base + best deltas brotli      |
| ------------------------------------------------- | -------- | ------------------------------------------- | ------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| Serif Latin, tol 1, basis B                       | 0        | +11.7% / +3.1%                              | 1.23 / 0.97 / 0.38                                      | 1.26 / 0.49                         | 11.6 + 56.6 KB (point-major)   |
| Serif Latin, tol 0.5, B                           | 0        | +28.9%                                      | 0.96 / 0.63 / 0.30                                      | 1.01 / 0.47                         | 12.8 + 69.5 KB (region-major)  |
| Serif Latin, tol 0.25 half-unit, B                | 0        | +48.4%                                      | 0.41 / 0.31 / 0.16                                      | 0.46 / 0.24                         | 15.2 + 74.9 KB (point-major)   |
| Serif Latin, tol 1, **basis A**                   | 0        | +16.1%                                      | **2.57** / 1.58 / 0.61 (corner instance)                | —                                   | —                              |
| Serif full, tol 1, B                              | 0        | +11.2% / +3.7%                              | 1.29 / 0.97 / 0.37                                      | 1.29 / 0.49                         | 48.0 + 228.8 KB (point-major)  |
| Serif full, tol 0.5, B                            | 0        | +26.9% / +11.9%                             | 0.97 / 0.64 / 0.30                                      | 1.09 / 0.46                         | 51.8 + 296.5 KB (region-major) |
| Serif full, tol 0.25 half-unit, B                 | 0        | +45.4% / +24.8%                             | 0.45 / 0.31 / 0.16                                      | 0.51 / 0.24                         | 59.8 + 285.3 KB (point-major)  |
| CJK full (65,535 glyphs, 1,061,820 cubics), tol 1 | 0        | +11.7% / +8.0%                              | 1.43 / 0.95 / 0.34                                      | 1.58 / 0.49                         | 5,978 + 6,264 KB               |
| CJK full, tol 0.25 half-unit                      | 0        | +41.5% / +33.1%                             | 0.50 / 0.33 / 0.16                                      | 0.57 / 0.25                         | 7,571 + 7,939 KB               |

CJK errors are on a 20,000-cubic sample; Serif full covers all 12,991 cubics. CFF2 coordinates were all integers (0 fractional).

**Point-growth basis:** the compatible figures count cubic points after dropping redundant closing points (5,282 in Serif full, 64,829 in CJK full). Against the raw cubic point counts in `logs/cff2-*-B.log`, compatible growth is +3.0% (tol 1) and +34.6% (tol 0.25, half-unit) for Serif full, and +10.5% and +40.0% for CJK full. The default-only figures here do not reproduce exactly from those logs (Serif full logs: +3.5%, +11.0%, +23.0%), so treat that column as approximate.

**Bytes against the CFF2 table (brotli):**

| Font        | CFF2 as stored | CFF2 dehinted                      | Ours, exact cubic deltas | Ours, quadratic tol 1                       | Ours, quadratic tol 0.25 half-unit |
| ----------- | -------------- | ---------------------------------- | ------------------------ | ------------------------------------------- | ---------------------------------- |
| Serif Latin | 76.8 KB        | 60.4 KB                            | 59.7 KB                  | 68.2 KB                                     | 90.1 KB                            |
| Serif full  | 323.4 KB       | 234.1 KB                           | 235.6 KB                 | 276.8 KB (−14% vs stored, +18% vs dehinted) | 345.1 KB                           |
| CJK full    | 12.42 MB       | 12.42 MB (dehinting saves nothing) | not measured             | 12.24 MB (−1.4%)                            | 15.51 MB (+25%)                    |

- **Layout matters for multi-region CFF2.** Region-major Serif full at tolerance 1 is 48.0 + 274.8 = 323 KB; point-major is 277 KB. With one region (CJK) the two layouts are identical.
- **Wasm instancer check:** on the f64 path, the Wasm output equals the Python float instance rounded to the grid with 0 mismatches (Serif Latin and full, CJK on a 2,000-glyph sample). f32 SIMD had 7 one-unit mismatches out of 30,824 coordinates, at one location.
- **Against `instantiateCFF2(round=noRound)`:** max 1.26 units on Serif Latin and 1.26 on Serif full (300-glyph sample). For CJK the reference was the exact glyph-set blend, which matched `noRound` on Serif with a difference of 0.0: max 1.72 units.
- **Side finding: `instantiateVariableFont` on CFF2 is itself lossy.** As shipped, it rounds each blended relative charstring operand, so positions drift along a contour: up to 5.2 units on one glyph at wght 650, and our measured max against it is 6.1–9.2 units at interior locations. With `round=noRound` the drift is gone (difference 0.0). Use `noRound` as the reference.

---

## Q5. Instancing speed

**What was built:** a `no_std` crate copied from the previous study's decoder, compiled twice: scalar (`-simd128`) and SIMD (`+simd128`, `core::arch::wasm32`).

- **Instancing:** fontTools `normalizeValue`, the avar v1 piecewise map, F2Dot14 quantization, tent scalars, then `round(base + Σ s·Δ)`, accumulated in fontTools' order.
- **SIMD triplet decoder:** flag→length via three compares on 16 flags, an in-register prefix sum for offsets, then each group of 4 points decoded independently.
  - v1 uses scalar gathers.
  - v2 builds an `i8x16_swizzle` window from the spread offsets.
  - Finally an i16x8 prefix sum gives absolute values, per segment or stream-wide.
- **Verified:** both SIMD decoders are byte-identical to scalar on every set.

**SIMD build, best code per step (µs/glyph, which equals ms per 1,000 glyphs; per-font ms in brackets):**

| Font, set          | Base triplets | Delta triplets (sparse) | IUP at load (f64) | Instance f32 SIMD | Instance f64x2 SIMD (exact) | Expand + bounds | **Decode + instance, sparse, exact** | **Re-instance only, f32 / exact** |
| ------------------ | ------------- | ----------------------- | ----------------- | ----------------- | --------------------------- | --------------- | ------------------------------------ | --------------------------------- |
| Inter Latin        | 0.080         | 0.383                   | 0.242             | 0.048             | 0.104                       | 0.027           | 0.896 [0.26 ms]                      | 0.084 / 0.128 [0.024 / 0.037 ms]  |
| Inter full         | 0.065         | 0.336                   | 0.278             | 0.044             | 0.102                       | 0.038           | 0.890 [2.61 ms]                      | 0.087 / 0.139 [0.26 / 0.41 ms]    |
| Roboto Flex Latin  | 0.081         | 6.12                    | 3.64              | 0.255             | 0.595                       | 0.027           | 10.96 [2.42 ms]                      | 0.298 / 0.619 [0.066 / 0.137 ms]  |
| Roboto Flex full   | 0.058         | 4.55                    | 3.65              | 0.370             | 0.734                       | 0.029           | 9.85 [9.34 ms]                       | 0.450 / 0.761 [0.43 / 0.72 ms]    |
| Serif full (tol 1) | 0.256         | 2.17                    | 1.15              | 0.163             | 0.444                       | 0.035           | 4.24 [6.21 ms]                       | 0.197 [0.29 ms] dense             |
| CJK full (tol 1)   | 0.655         | 0.606                   | 0.463             | 0.196             | 0.585                       | 0.085           | 2.82 [185 ms]                        | 0.276 [18.1 ms] dense             |

**Scalar vs SIMD:**

| Step                        | SIMD speedup over scalar |
| --------------------------- | ------------------------ |
| Instancing, f32             | 1.6–5.1×                 |
| Instancing, f64x2           | 1.3–3.4×                 |
| Ink bounds                  | 2.1–3.7×                 |
| Composite expansion         | 1.9–3.6×                 |
| Triplet decoding            | 0.62–1.23×               |
| Decode plus instance, whole | 1.04–1.51×               |

The full scalar and SIMD tables for every step are in `out/bench-*.json` and are printed by `report_tables.py timing`.

- **Per-glyph calls:** calling one glyph at a time adds about 60–110 ns of JS→Wasm overhead per call. Inter full: 0.107 vs 0.044 µs/glyph for f32 SIMD.
- **Exactness against fontTools (34 locations, own plus decomposed coordinates and bounds):**

  | Path                                          | Result                                                                          |
  | --------------------------------------------- | ------------------------------------------------------------------------------- |
  | (b) sparse, IUP f64, f64 scalar or f64x2 SIMD | **exact everywhere**                                                            |
  | (b) sparse, f32                               | 1 unit off on 13/637,680 coordinates (Inter full); 1/151,816 (Roboto Flex full) |
  | (a) dense, rounded at bake                    | 1 unit off on 846/637,680 (Inter full, 0.13%); 0 on Roboto Flex with f64        |
  | Ink bounds                                    | 0 mismatches for every variant                                                  |

- **Code size (whole modules, every variant included, so an upper bound):** the scalar module is 11.1 KB raw / 4.8 KB gzip at opt 3, or 7.6 / 3.8 KB at opt s. The SIMD module is 27.6 / 10.5 KB, or 19.1 / 7.8 KB.

---

> **Corrected 2026-10-06:** the Q6 claim that conservative bands are correct used a stored-key condition. Today's shader exits on each curve's instanced maximum, and under that rule conservative bands in bake order are wrong. See the [variable-font band study](outline-stream-variable-font-bands-study.md).

## Q6. Slug bands under variation

**Tool:** slug-core's own `build_bands`, `Bounds::from_curves` and `line_to_quadratic`, called natively (`varfont/bandtool`, depending on `packages/glyph/rust/slug-core`). This is the real function, not a reimplementation.

**Conservative boxes:**

- Each coordinate gets `base + Σ min(0, Δ) − 0.5` to `base + Σ max(0, Δ) + 0.5`, which covers final rounding, plus 0.125 units for the line bow.
- Composites add the component offset's range.
- Each box is passed to `build_bands` as a degenerate quadratic (lo, lo, hi), with glyph bounds set to the union of the boxes.
- Lines that are axis-flat at the default and whose endpoints move identically in every instance (matched delta signatures) skip that axis, as `build_bands` does for flat curves. Each axis is built separately so its sort key is not changed.
- Region scalars are always in [0, 1] inside the axis ranges, so every instance lies inside the boxes.

**Results (16+16 bands per glyph):**

| Font, set         | Default only: mean / max refs per band | Conservative, all regions | No flat skip | Conservative, wght only | Rebuilt per instance (mean over locations) / max |
| ----------------- | -------------------------------------- | ------------------------- | ------------ | ----------------------- | ------------------------------------------------ |
| Inter Latin       | 4.46 / 29                              | 6.97 / 40                 | 7.53 / 41    | —                       | 4.44 / 29                                        |
| Inter full        | 4.93 / 38                              | **8.08 / 54**             | 8.96 / 57    | 7.02 / 44               | 4.91 / 38                                        |
| Roboto Flex Latin | 4.38 / 20                              | 12.87 / 72                | 13.36 / 72   | —                       | 4.39 / 24                                        |
| Roboto Flex full  | 4.54 / 20                              | **13.91 / 72**            | 14.51 / 72   | 6.01 / 31               | 4.57 / 24                                        |

- **Default-only bands are wrong at other instances.** Inter full at wght 900: 97,240 missing references, 231,903 sort-key violations, and 2,899 of 2,911 glyphs affected.
- **Conservative bands are correct.** 0 missing references and 0 key violations at every location (10 for Inter, 7 for Roboto Flex). wght-only bands are also 0 at the wght-only locations; violations appear only outside that sub-space, as expected.
- **Sort-by-max early exit stays correct.** The shader breaks at the first stored key below the sample. It is safe exactly when every stored key is at least the curve's instance maximum. Conservative keys guarantee that, and the measured count of violations is 0.
- **Band-table size** scales with references: Inter full goes from 459,013 to 752,401 (+64%).

---

## Q7. Extents and variation tables

**Ink extents:** taken from instanced, decomposed points. They equal fontTools' instanced `glyf` bounds at every location, composites included (0 mismatches). Cost in the SIMD build: Inter full 0.056 ms (0.019 µs/glyph), Roboto Flex full 0.016 ms, CJK 2.9 ms per font.

**Variation tables shaping needs (brotli bytes; outline tables shown for scale):**

| Table                               | Inter Latin\* |      Inter full | Roboto Flex Latin | Roboto Flex full |    Serif Latin |      Serif full |
| ----------------------------------- | ------------: | --------------: | ----------------: | ---------------: | -------------: | --------------: |
| fvar                                |            95 |              95 |               309 |              309 |            221 |             221 |
| avar                                |            56 |              56 |                48 |               48 |             52 |              52 |
| STAT                                |           160 |             160 |               380 |              380 |            184 |             184 |
| HVAR                                |         1,578 |           6,485 |             5,692 |           16,187 |          2,268 |           4,807 |
| MVAR                                |           113 |             113 |               318 |              318 |             89 |              89 |
| GDEF ItemVariationStore             |         1,218 |           5,833 |            10,064 |           16,310 |         10,237 |          17,998 |
| GSUB FeatureVariations              |             — |               — |    80 (7 records) |               99 |              — |               — |
| GPOS (VariationIndex device tables) |   6,970 (779) | 36,112 (13,498) |     9,062 (2,763) |   17,970 (8,974) | 24,781 (5,019) | 62,317 (13,738) |
| gvar / CFF2, for scale              |        56,108 |         211,120 |           259,973 |          714,673 |        137,198 |         323,360 |

\* This table uses a Latin subset that keeps every layout feature, so Inter Latin closes over 640 glyphs here, not 291.

- None of the fixtures has VVAR except CJK, and none has `cvar`.
- GPOS device deltas resolve through the GDEF store, so the store belongs to the shaping payload (#99).

---

## Q8. GPU instancing (estimate only)

**Layouts assumed:**

- Base: i16 x,y per var point.
- Deltas: a dense i16 pool per tuple, or region-major i16 planes.
- Tuple table: 8 B per tuple.
- Slot map: slot→(point, offset point) gather map, u16 pairs.
- Output: the 4 B/point stencil buffer.

**Estimates:**

| Font, set                         | Resident (pool layout)                       | Resident (region planes) | Worst active regions / slots | Multiply-adds per change | Bytes read per change |
| --------------------------------- | -------------------------------------------- | ------------------------ | ---------------------------- | ------------------------ | --------------------- |
| Inter Latin                       | 190 KB                                       | 179 KB                   | 3 / 13,596                   | 27k                      | 107 KB                |
| Inter full                        | 1.75 MB (delta pool 636 KB)                  | 1.62 MB                  | 3 / 95,402                   | 191k                     | 939 KB                |
| Roboto Flex Latin                 | 1.14 MB                                      | 1.25 MB                  | 28 / 78,812                  | 158k                     | 355 KB                |
| Roboto Flex full                  | 3.80 MB (delta pool 2.95 MB)                 | 3.93 MB                  | 28 / 248,528                 | 497k                     | 1.16 MB               |
| Serif Latin (tol 1)               | 534 KB                                       | 516 KB                   | 3 / 34,794                   | 70k                      | 235 KB                |
| CJK full (tol 1), arithmetic only | base 26.2 MB + pool 26.2 MB + stencil ≈26 MB | —                        | 1 / 6.55 M                   | 13.1 M                   | ≈ 52 MB               |

**WebGPU:** two compute passes per instance change.

1. One thread per var point, looping over the active tuples with uniform scalars.
2. One thread per stencil slot, doing the gather and composite-offset add.

At these sizes the arithmetic is microseconds even on integrated GPUs, so dispatch overhead would dominate. The CPU alternative was measured: 0.26 ms (Inter full, f32 SIMD plus expand plus bounds), then an upload of 430 KB of stencil.

**WebGL2:** there is no compute shader and no storage buffer. Three options:

- **(a) CPU instancing plus upload:** measured CPU cost as above, plus a `texSubImage2D` of the stencil texture (RG16I) per change: Inter full 430 KB, Roboto Flex full 119 KB.
- **(b) Render-to-texture:** one fragment per stencil texel into an RG16I target (color-renderable in WebGL2). It does `texelFetch` on the base, the gather map, and up to N active region planes as a texture array (Inter 638 KB, Roboto Flex 3.6 MB), using uniform scalars.
- **(c) Transform feedback** into a buffer, then a copy into the texture via `PIXEL_UNPACK_BUFFER`.

Option (b) or (a) is the practical one. None was measured.

---

## Exactly what is lossy

- **TrueType, recommended path** (sparse, IUP at load in f64, f64 or f64x2 instancing): lossless against fontTools at the 34 tested locations.
  - Output is rounded to integer units, as fontTools does, so animated instances move in 1-unit steps.
  - Fractional output was not measured.
- **TrueType f32 instancing:** 1 unit off on ≤13 of 637,680 coordinates (near-.5 values).
- **TrueType dense (IUP rounded at bake):** 1 unit off on up to 0.13% of coordinates (0.31% decomposed).
- **IUP re-optimization at tolerance 0.5:** lossy within 0.5 × scalar, and not recommended.
- **Phantom points:** dropped. This needs HVAR, which all fixtures have; a font without HVAR would need them kept.
- **Hinting:** dropped. No fixture has `cvar`.
- **CFF2:** cu2qu error as in the Q4 table. Basis A (single-region masters) amplifies corner-instance error to 2.57 units, so do not use it.
- **Bands:** conservative bands are exact in coverage and cost only extra references.

## Not measured

- Anything on a GPU: WebGPU compute, WebGL2 passes, shader speed.
- Decode speed for the point-major and per-axis zero-skip layouts (sizes only), and an exact sparse point-major layout for TrueType.
- Exact-cubic delta size for CJK, and the fontTools instancer on full CJK. The exact glyph-set blend was used instead, on a 2,000-glyph sample.
- Bands for CFF2 fonts, and the cost of rebuilding bands per instance (the previous study measured 8–31 µs/glyph for slug-core).
- avar2, VARC, fonts without HVAR, nested or transformed components, partial instancing, extrapolation.
- Fractional (unrounded) instance output, and native Rust or browser engines other than Node 22.
- Code size of a production-only subset of the Wasm.

## Reproduce

All paths are under `VF=spikes/outline-stream/research/varfont/`. Run Python as `python3 -I` and Node as `/opt/node22/bin/node`. Caches go to `cache/`, logs to `logs/`, results to `out/`, inputs to `bench/`, `bands/` and `models/`.

1. **Model and encoders:** `scripts/vmodel.py` and `scripts/venc.py`, which import `outline-encoding/scripts/{model,enc}.py`. Run `scripts/stats.py <font> latin|full` for the variation stats.
2. **Q1 sizes:** `scripts/sizes_tt.py <key> <font> latin|full`, and `scripts/zskip.py tt|cff2 …` for the zero-skip and point-major layouts.
3. **Rust instancer:** `instancer/` (src/lib.rs). Build with:
   ```
   RUSTFLAGS="-C target-feature=±simd128" CARGO_TARGET_DIR=target-{scalar,simd} cargo +1.97.1 build --profile release|small --target wasm32-unknown-unknown
   ```
   and copy the outputs to `wasm/{scalar,simd}-{release,small}.wasm`.
4. **Q5:** `scripts/emit.py <key> <font> <set>`, then `scripts/bench.mjs bench <key-set> wasm out [--quick|--lean]`, then `scripts/verify.py <key> <font> <set>`.
5. **Q3:** `scripts/pointorder.py <key> <font> <set>`.
6. **Q6:** `scripts/bands_emit.py <key> <font> <set> [wght]`, then `bandtool/target/release/bandtool bands/<file>.bin`. Build with `cargo +1.97.1 build --release` in `bandtool/`.
7. **Q4:** `scripts/cff2.py <key> <font> latin|full|sample:N --tols 1,0.5,0.25h --basis A|B [--save models/<p>] [--no-bytes] [--no-err]`, then `scripts/cff2_emit.py <key> <pkl>`, `bench.mjs`, and `scripts/verify_cff2.py <key> <font> <set> <pkl> [N] [--no-instancer]`. Also `scripts/cff2_cubic.py <font> <set>` and `scripts/cff2_dehint.py <font>`.
   - The `--save` run overwrote `out/cff2-serif-full-B.json`. Serif full's error and byte numbers are in `logs/cff2-serif-full-B.log`; rerun without `--save` to regenerate the JSON.
8. **Q7:** `scripts/vtables.py <font> latin|full`.
9. **Q8:** `scripts/gpu_estimate.py tt <key> <font> <set>` or `scripts/gpu_estimate.py cff2 <key> <pkl>`.
10. **Tables:** `scripts/report_tables.py sizes|timing|verify|cff2|gpu`.
