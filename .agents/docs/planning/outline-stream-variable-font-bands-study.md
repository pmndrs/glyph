---
type: Engineering Research
title: Variable-font Slug band study
description: "Measured Slug band strategies for variable fonts: per-instance rebuild, conservative bands, pre-bakes and partial pre-bakes, against the shader's real early-exit rule."
tags: [slug, variable-fonts, bands, research]
sources:
  - id: summary
    resource: outline-stream-research.md
    title: Outline stream research summary
generated:
  by: anthropic/claude-code
  at: '2026-10-06T17:00:00Z'
status: draft
---

# Slug band tables for variable fonts: measured study

## Summary

**The previous study's "conservative bands are correct" result does not hold for today's shader.** The shader stops a band at the first curve whose own instanced maximum is half a pixel behind the sample (`slug-band.ts:102`, `core/band.ts:88–90`). It never reads a stored key. So a band is safe only when its curves are listed in non-increasing order of their maxima at the current instance. Bands sorted by conservative key (strategies 2 and 3, and 5(c) if it keeps the bake order) break that order:

- **Inter full, all axes:** 3.75 M adjacent inversions and 22,799 mismatched emulated-shader samples. At the worst location, 2,318 of 2,911 glyphs are wrong.
- **Roboto Flex full, all axes:** 750,003 mismatched samples.
- **wght-only conservative bands** fail too: 3,367 mismatched samples on Inter full.
- **Why the previous checker missed it:** it tested "stored key ≥ instanced max". That is the safety condition for a shader that reads a stored key, not for this one.

Every strategy that is correct here gets there by one of three fixes:

- rebuild per instance;
- re-sort the conservative lists by instanced maximum when the axes change;
- change the shader to exit on a stored key.

**Recommendation:**

- **Default:** the fully dynamic exact rebuild (strategy 1), run lazily per glyph and on every axis change, using the order-hinted CSR builder found here (5(d)).
  - It ships no extra bytes, and its output is byte-identical to `build_bands`: 0 mismatches over 4.49 M glyph-locations.
  - Shader cost equals static bands.
  - In scalar Wasm it costs 0.62–1.39 ms per 200-glyph set per axis change, 2.5–3.7× faster than calling slug-core's `build_bands`.
- **Fallback for CJK and other large fonts:** the same rebuild, lazy per glyph, never eager (about 0.74 s for the whole CJK font). For animated wght on CJK, conservative-over-wght bands built lazily at load and re-sorted on each change cost 0.61 ms per 200 glyphs (7.1× faster) for 1.18× the shader reads.
- **Don't ship full or partial pre-bakes for variable fonts.** None of them beats the zero-byte hinted rebuild by much except "conservative + resort", and that one costs 1.3–3.5× the shader reads.

## Method

- **Data:** `vfb_emit.py` exports each set from the previous study's caches.
  - TrueType: decomposed simple points plus component offsets, with fontTools IUP-expanded float deltas.
  - CFF2: the tolerance-1 basis-B compatible-quadratic models.
  - Each export carries the region scalars for every test location, and "specs" (region-scalar intervals) for all axes, wght, wght+wdth and each wght cell.
- **Code:** `bandlab` (Rust) links `packages/glyph/rust/slug-core` and uses its `Quadratic`, `line_to_quadratic`, `Bounds::from_curves` and `build_bands`.
- **Instancer check:** f32, `round(simple) + round(offset)`.
  - Against `fontTools.varLib.instancer` at the previous study's 10 TrueType locations: ≤ 32 of 200,884 coordinates are off by 1 (Inter full); Roboto Flex ≤ 1.
  - Against a float64 blend of the model for CFF2: Serif 1 of 147,200 off by 1; CJK 0 of 13.1 M at all 7 locations.
- **Correctness (`bandcheck check`):**
  - Structural checks on every glyph at every location: missing references, adjacent order inversions against instanced maxima, stored-key violations, ink outside the partition, lists over the 512 cap.
  - An emulated-shader sample test: a CPU port of `calcRootCode`, `stableRoots` and `curveContribution`, with the real early exit. Each traversal is compared with the all-curves ground truth at 64 and 4,096 px/em, on 6×6 samples per glyph and axis.
  - Locations per font: default, every `fvar` named instance, every region peak, and seeded random locations (48 over all axes, 32 wght-only, 32 wght+wdth, plus the wght×wdth corners). Totals: Inter 95, Roboto Flex 221, Serif 119, CJK 57.
- **Shader-cost proxy:** references read per sample per band, including the one that triggers the exit.
- **Timing (`bench.mjs`):** scalar Wasm (`-simd128`) in Node 22, median of 9 samples, alternating between two instances.
  - Glyph sets: the distinct glyphs of about 200 characters of text (57–58 glyphs; 159 for Japanese), 200 distinct glyphs, and the whole font. For CJK "whole" is every 14th glyph, 4,681 glyphs.
  - Native `bandcheck time` on the 200-glyph sets gives a Wasm/native factor of 1.07–1.84× (slug-core `build_bands` 1.7–1.8×, the other steps 1.1–1.6×). These loops are branch-bound.

## Per-font tables

### Shader cost: reads per sample per band (×exact)

All the configurations in this table are correct.

| Strategy                          | Inter Latin | Inter full | Flex Latin | Flex full | Serif Latin | Serif full | CJK full |
| --------------------------------- | ----------: | ---------: | ---------: | --------: | ----------: | ---------: | -------: |
| S1 exact rebuild                  |        3.29 |       3.54 |       3.34 |      3.47 |        3.98 |       4.30 |     6.79 |
| cons[all] + resort                |       1.60× |      1.65× |      3.30× |     3.52× |       1.95× |      1.96× |    1.18× |
| cons[all], key-exit shader        |       1.72× |      1.80× |      4.52× |     4.94× |       2.21× |      2.21× |    1.22× |
| cons[all], no early exit          |       2.31× |      2.50× |      5.07× |     5.61× |       3.10× |      3.15× |    2.04× |
| cons[wght] + resort               |       1.39× |      1.41× |      1.31× |     1.33× |       1.36× |      1.36× |  (= all) |
| cons[wght+wdth] + resort          |           — |          — |      1.57× |     1.63× |           — |          — |        — |
| 5c filter[all] + sort             |       1.04× |      1.04× |      1.37× |     1.42× |       1.07× |      1.06× |    1.00× |
| 5c filter[wght] + sort            |       1.03× |      1.02× |      1.00× |     1.01× |       1.03× |      1.03× |        — |
| S4b enclosing wght cell + resort  |       1.06× |      1.06× |      1.02× |     1.03× |       1.08× |      1.08× |    1.03× |
| 5b linear bounds, key-exit shader |       1.15× |      1.15× |      1.37× |     1.38× |       1.21× |      1.21× |    1.19× |

### References per band, mean / max (S1 is the mean over instances)

|                | Inter full |  Flex full | Serif full |    CJK full |
| -------------- | ---------: | ---------: | ---------: | ----------: |
| S1 exact       |  4.92 / 38 |  4.57 / 30 |  6.24 / 33 |  11.36 / 85 |
| cons[all]      |  8.06 / 54 | 13.90 / 72 | 12.12 / 66 | 13.59 / 107 |
| cons[wght]     |  7.00 / 43 |  5.99 / 31 |  8.52 / 39 |           — |
| 5c filter[all] |  4.46 / 38 |  2.58 / 63 |  5.63 / 48 |  11.24 / 88 |

The Latin sets are within ±10% of the full sets. No list reached the shader's 512 cap (largest: 108), and the largest glyph table has 3,456 references, inside the 16-bit header offset.

### Bytes (KB: raw / gzip / brotli q11)

Every row is band headers (32 × u32 per glyph) plus u16 references, or the stated side data.

| Table                                         |        Inter Latin |               Inter full |          Flex Latin |                Flex full |         Serif Latin |               Serif full |                    CJK full |
| --------------------------------------------- | -----------------: | -----------------------: | ------------------: | -----------------------: | ------------------: | -----------------------: | --------------------------: |
| Static bands (default instance)               |    119 / 28 / 20.7 |      1,291 / 342 / 184.9 |      89 / 23 / 17.7 |         393 / 102 / 63.5 |     130 / 41 / 30.5 |        771 / 249 / 141.3 |    54,952 / 21,088 / 13,088 |
| S3 full pre-bake, all axes (= 5c candidates)  |    165 / 42 / 26.9 |      1,874 / 469 / 251.0 |     207 / 38 / 27.1 |        956 / 172 / 106.4 |     218 / 61 / 40.5 |      1,313 / 352 / 199.2 |    65,390 / 24,504 / 15,231 |
| S3, wght                                      |    151 / 39 / 25.4 |      1,678 / 430 / 228.2 |     108 / 27 / 20.6 |         480 / 124 / 75.2 |     165 / 52 / 35.4 |        978 / 300 / 166.8 |                     (= all) |
| S3, wght+wdth                                 |                  — |                        — |     122 / 30 / 22.0 |         554 / 138 / 83.4 |                   — |                        — |                           — |
| S4 every named instance (9 / 20 / 30 / 7)     | 1,068 / 149 / 86.1 |   11,591 / 1,703 / 864.7 | 1,779 / 218 / 137.5 |      7,878 / 990 / 547.7 | 3,866 / 525 / 321.4 | 22,888 / 3,176 / 1,702.5 | 391,725 / 79,064 / 56,773\* |
| S4 every region peak + default                |   714 / 116 / 68.8 |    7,733 / 1,317 / 671.4 | 7,579 / 718 / 465.7 | 33,545 / 3,368 / 2,007.6 | 1,156 / 242 / 154.6 |    6,832 / 1,452 / 773.5 | 112,039 / 40,486 / 31,018\* |
| S4b every wght cell (8 / 9 / 5 / 6)           |  984 / 232 / 173.1 | 10,742 / 2,843 / 1,552.7 |   817 / 210 / 163.5 |      3,620 / 948 / 592.0 |   687 / 229 / 160.4 |    4,075 / 1,310 / 742.8 |  345,452 / 133,808 / 83,490 |
| 5a boxes + pre-sorted order (12 B/curve), all |     75 / 36 / 27.6 |        931 / 427 / 217.4 |      54 / 31 / 25.7 |         257 / 142 / 96.6 |     108 / 52 / 38.3 |        696 / 332 / 172.9 |    61,354 / 37,509 / 23,576 |
| 5b hull-delta bounds per region               |   259 / 115 / 58.7 |    3,281 / 1,161 / 440.3 | 2,587 / 807 / 375.8 | 12,371 / 3,666 / 1,259.3 |   602 / 267 / 123.3 |    3,890 / 1,441 / 558.4 |    44,039 / 21,932 / 13,989 |
| Stored keys for a key-exit shader (4 B/curve) |     26 / 15 / 12.5 |         327 / 158 / 99.8 |      19 / 12 / 10.6 |           88 / 50 / 42.3 |      37 / 18 / 15.0 |         242 / 114 / 69.4 |     21,970 / 13,304 / 8,063 |
| Outline stream, brotli (previous study)       |               35.2 |                    193.2 |               193.0 |                    549.2 |                68.2 |                    276.8 |                      12,240 |

\* Brotli q9 because the table is over 100 MB. "S4b every wght cell" is the sum of the per-cell tables.

Against static bands (brotli):

| Strategy                   | Range      |
| -------------------------- | ---------- |
| S3 full pre-bake, all axes | 1.16–1.68× |
| S3, wght                   | 1.16–1.23× |
| Every named instance       | 4.2–12.1×  |
| Every region peak          | 2.4–31.6×  |
| Every wght cell            | 5.3–9.3×   |
| 5a                         | 1.05–1.80× |
| 5b                         | 1.07–21.3× |

### Time per axis change after instancing (scalar Wasm)

Steps are curves (+ hulls) + band step. Values are ms per 200-glyph set, then ms for the whole set.

| Strategy                                      |  Inter full |   Flex full |  Serif full |  CJK full¹ | Speedup vs S1 slug-core |
| --------------------------------------------- | ----------: | ----------: | ----------: | ---------: | ----------------------: |
| **1. S1, slug-core `build_bands`**            | 2.06 / 29.2 |  1.82 / 9.3 | 2.93 / 20.4 | 4.31 / 150 |                    1.0× |
| S1, CSR builder                               | 0.92 / 13.5 |  0.85 / 4.2 | 1.40 / 10.2 |  1.95 / 79 |                    2.2× |
| **5(d) S1, CSR + default-order fill hint**    | 0.76 / 11.2 |  0.74 / 4.5 |  1.08 / 8.6 |  1.39 / 53 |                2.5–3.7² |
| 2. cons[all] + resort                         |  0.43 / 7.2 |  0.74 / 4.1 |  0.72 / 6.3 |  0.61 / 25 |                2.5–7.1² |
| 2. cons[wght] + resort                        |  0.36 / 6.4 |  0.30 / 1.7 |  0.51 / 4.5 |          — |                5.7–7.6² |
| 2. cons[wght+wdth] + resort                   |           — |  0.40 / 2.1 |           — |          — |                4.5–4.7² |
| 5c filter[all] + sort                         | 0.72 / 11.1 |  0.82 / 5.2 |  1.10 / 9.1 |  1.03 / 40 |                2.2–4.2² |
| 5c filter[wght] + sort                        | 0.68 / 10.2 |  0.55 / 2.8 |  0.83 / 7.4 |          — |                3.0–4.1² |
| 5b linear bounds (no instanced points needed) | 0.88 / 16.0 | 1.61 / 10.5 | 1.35 / 10.8 |  1.75 / 67 |                1.1–2.8² |
| 3. S3 pre-baked, key-exit shader              |           0 |           0 |           0 |          0 |                       — |

¹ CJK "whole" is a 4,681-glyph sample. Extrapolated to all 65,524 glyphs: S1 with slug-core ≈ 2.1 s, hinted ≈ 0.74 s.
² Range across all seven sets (Latin included); the full per-set tables are printed by `report_tables.py update`.

**Building once at load:**

| Strategy                 | Inter full | Roboto Flex full | Serif full | CJK sample |
| ------------------------ | ---------: | ---------------: | ---------: | ---------: |
| cons[all] (strategy 2)   |      32 ms |            37 ms |      29 ms |     108 ms |
| 5a from pre-sorted boxes |     7.9 ms |           2.9 ms |     6.6 ms |      35 ms |

5a speeds up the conservative build 3–13×. The previous study's instancing (SIMD, sparse) costs 0.044–0.37 µs/glyph; my dense scalar instancer costs 0.19–1.3 µs/glyph and is shown only for context. Either way, instancing is not where the time goes.

**Per-frame budget at 60 Hz (16.7 ms):** every strategy fits a 200-glyph set. The hinted exact rebuild takes 4.5–8% of the frame and the conservative-wght resort 2–3%. A whole-font eager rebuild does not fit for Inter full (11 ms hinted) or CJK, so rebuild only the glyphs in use.

## Answers per strategy

1. **Build at load, per instance:** correct at every location (0 errors). It costs 3.8–7.0 µs/glyph with the hinted builder, or 9.4–21.7 µs/glyph with `build_bands`. Glyph bounds and the band transform change per instance, so glyph records must be re-uploaded too; that upload was not timed.
2. **Conservative, built once:**
   - Coverage is correct.
   - The order is wrong with today's shader at every tested location.
   - It becomes correct with a resort on each change (0.30–0.74 ms per 200 glyphs), a key-exit shader, or no early exit.
   - wght-only conservatism is cheap in shader reads (1.31–1.41×). All-axes conservatism is not on Roboto Flex (3.3–3.5×).
3. **Full pre-bake:** 1.16–1.68× the static bands and 13–124% of the outline stream (brotli). It has the same ordering problem as strategy 2.
4. **Named instance or master corner, nearest:** not correct between instances. Inter full nearest named instance: 1.62 M missing references and 70,667 mismatched samples. Nearest peak is worse. Even CJK's single axis: 10.2 M missing references.
   - The enclosing-cell variant (bands conservative over each wght interval between named weights) is correct with a resort, at 1.02–1.08× reads.
   - It costs 5.3–9.3× the static bytes, and it covers only the wght sub-space.
5. **Partial pre-bakes** (brotli bytes added; per-change speedup over strategy 1):

   | Option                                                | Bytes added                                   | Speedup                                                    | Correctness                                                                  |
   | ----------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
   | (a) per-curve conservative boxes, pre-sorted per axis | +1.05–1.8× static                             | Only speeds up the once-at-load conservative build (3–13×) | Lists come out in conservative order, so they still need a resort per change |
   | (b) per-region hull-delta bounds                      | +1.07–21× static (Roboto Flex has 84 regions) | 1.1–2.8×                                                   | Needs a key-exit shader; inverted in 554k–25M adjacent pairs with today's    |
   - **On (b):** instance bounds are not linear in the scalars, because a min over points is only piecewise linear. The linear, conservative form is valid (0 missing references) but costs 1.15–1.38× reads. On the CPU path the points are instanced anyway for rendering (sub-µs per glyph), so (b) saves nothing there.
   - **(c) fixed layout plus candidates filtered per instance:** bytes = the S3 pre-bake. Speed 2.2–4.2×, reads 1.00–1.07×; Roboto Flex all-axes reaches 1.42× because the fixed partition spans a huge conservative box.
     - It is correct only with a re-sort. Filtering in bake order gave up to 386,939 mismatched samples (Roboto Flex).
     - Exact binning into the same fixed partition gives identical lists (0 mismatches) at the same speed, so the candidate lists buy nothing.
   - **(d) found here, zero bytes:** fill the CSR bins in the curves' default-instance key order. The insertion sorts then see nearly sorted lists, and a (key, index) tie-break keeps the output identical to `build_bands`. Result: 2.5–3.7× over slug-core, matching 5(c) without its data.

6. **GPU estimate (not run):** 5(c) on WebGPU as two compute passes. Bands keep fixed slots sized by their candidate count, so no prefix sum is needed.
   - About 0.8–1.7 MB read and written per change for a 200-glyph set.
   - Estimated time: 52–167 µs at 25 GB/s or 24–108 µs at 200 GB/s, with 10–50 µs per dispatch assumed.
   - Measured CPU Wasm for the same work: 624–1,029 µs.
   - The WebGL2 CPU path then uploads 54–169 KB per change.
   - At this size, dispatch overhead dominates, and the GPU win does not justify a second path beyond the mandatory CPU one.

## Correctness results

| Strategy                                          | Missing refs | Inversions     | Sample mismatches | Result                                                                                                                                 |
| ------------------------------------------------- | ------------ | -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| S1 (slug-core, CSR, hinted)                       | 0            | 0              | 0                 | Correct at every location, all 7 sets. CSR and hinted outputs are byte-identical to `build_bands` in 4.49 M glyph-location comparisons |
| cons + resort; 5c + sort; enclosing cell + resort | 0            | 0              | 0                 | Correct                                                                                                                                |
| Key-exit and no-exit shaders                      | 0            | (n/a)          | 0                 | Correct, 0 stored-key violations                                                                                                       |
| Conservative in bake order, today's shader        | 0            | ≥ 1 everywhere | 51–750,003        | Wrong in every set                                                                                                                     |
| Default bake, nearest named, nearest peak         | Many         | Many           | Many              | Wrong; up to every glyph at the worst location                                                                                         |

For the conservative-in-bake-order and default/nearest rows, the per-strategy figures are in `out/check-*.json`.

The sample test is sampled, so its mismatch counts are lower bounds. The "correct" verdicts rest on the structural pair: 0 missing references with 0 inversions is sufficient for an exact early exit.

## What is unmeasured

- **No GPU, no real shader:** reads per sample-band is a proxy, not frame time. The GPU estimate is arithmetic under stated assumptions.
- **Upload time** (`texSubImage2D` or `writeBuffer`) per change: bytes only. The per-instance glyph-record update for S1 was not sized.
- **Sampling coverage:**
  - 6×6 samples per glyph and axis, at 64 and 4,096 px/em only, with thickening off.
  - The sample test runs on every 3rd glyph (Inter and Serif full), every 2nd (Roboto Flex full) and every 40th (CJK). Structural checks cover every glyph.
- **Timing scope:**
  - Scalar Wasm in Node 22 only: no SIMD band builder, no browsers.
  - CJK whole-font times are a 4,681-glyph sample, extrapolated.
  - The production SIMD sparse instancer was not reused.
- **Not tried:**
  - band counts other than 16+16, for example retuning the fixed partition;
  - a previous-frame order hint, instead of the default-instance one;
  - i8 packing for 5(b);
  - cells on axes other than wght, and cells off the wght-only sub-space.
- **Fixture gaps:** avar2, VARC, fonts without HVAR, nested or transformed components (none in the fixtures).

## Reproduce

Paths:

- `R=spikes/outline-stream/research/varfont-bands`
- `SC=<scratch>`
- `F=$SC/varfont/fonts`
- `M=$SC/varfont/models`
- `V=$SC/varfont-bands`

Outputs land in `$V/{data,out,logs,bytes,wasm}`. The scripts read the previous study's cache, `$SC/varfont/cache`.

1. **Data:**
   ```
   python3 -I $R/scripts/vfb_emit.py inter $F/Inter-VF.ttf latin|full
   python3 -I $R/scripts/vfb_emit.py flex $F/RobotoFlex-VF.ttf latin|full
   python3 -I $R/scripts/vfb_emit.py serif $F/SourceSerif4-VF.otf latin|full --model $M/serif-{latin,full}-1.0-B.pkl
   python3 -I $R/scripts/vfb_emit.py cjk $F/NotoSansCJKjp-VF.otf full --model $M/cjk-full-1.0-B.pkl
   ```
2. **Build** (from `$R/bandlab`):
   ```
   CARGO_TARGET_DIR=$V/target cargo +1.97.1 build --release --offline
   RUSTFLAGS="-C target-feature=-simd128" CARGO_TARGET_DIR=$V/target-wasm cargo +1.97.1 build --release --offline --lib --target wasm32-unknown-unknown
   cp $V/target-wasm/wasm32-unknown-unknown/release/bandlab.wasm $V/wasm/bandlab-scalar.wasm
   ```
3. **Instancer check:**
   ```
   python3 -I $R/scripts/verify_instancer.py tt <key> <font> <set>
   python3 -I $R/scripts/verify_instancer.py cff2 <key> <set> <pkl>
   ```
4. **Correctness and tables** (strides 1 for the Latin sets, 3 for Inter and Serif full, 2 for Roboto Flex full, 40 for CJK):
   ```
   $V/target/release/bandcheck check $V/data/<ks>.vfb $V/out/check-<ks>.json --stride-samples <k> --bytes $V/bytes/<ks>
   ```
5. **Wasm timing** (run alone on an idle machine):
   ```
   node $R/scripts/bench.mjs $V/wasm/bandlab-scalar.wasm $V/data/<ks>.vfb $V/out/bench-<ks>.json
   ```
6. **Native factor:**
   ```
   $V/target/release/bandcheck time $V/data/<ks>.vfb 1 0 <locA> <locB>
   ```
   Locations used: Inter full 10 11, Roboto Flex full 21 22, Serif full 31 32, CJK 8 9. Results are in `$V/out/native-g200.json`.
7. **Sizes:**
   ```
   python3 -I $R/scripts/sizes.py $V/bytes $V/out <ks>...
   python3 -I $R/scripts/sizes.py $V/bytes $V/out cjk-full --only <table>
   ```
   Run one `--only` process per CJK table, in parallel.
8. **Reports:**
   ```
   python3 -I $R/scripts/report_tables.py $V/out correctness|bytes|timing|update <ks>...
   python3 -I $R/scripts/gpu_estimate.py $V/out <ks>...
   ```

`bench.mjs` passes `pnpm exec oxlint --deny-warnings`. Nothing is committed and `packages/` is untouched.

**Files** in `spikes/outline-stream/research/varfont-bands/`:

- `bandlab/Cargo.toml`, `bandlab/Cargo.lock`
- `bandlab/src/lib.rs`, `bandlab/src/bin/bandcheck.rs`
- `scripts/vfb_emit.py`, `scripts/verify_instancer.py`, `scripts/bench.mjs`, `scripts/sizes.py`, `scripts/report_tables.py`, `scripts/gpu_estimate.py`

**Process notes:**

- The first size run was stopped at the 30-minute background limit and rerun in parallel; CJK named-instance and peak tables use brotli q9.
- I removed the ignored `__pycache__` folders under `research/varfont/scripts` and `research/encoding/scripts`, which my imports had touched.
- **Docs to correct:** the "conservative bands are correct" claim in the study doc (Q6) and in `decisions/variable-font-outline-stream.md` needs correcting.
