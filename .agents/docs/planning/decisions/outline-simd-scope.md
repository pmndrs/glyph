---
type: Decision
title: 'Outline SIMD scope'
description: 'Outline SIMD code goes to variable-font instancing, composite expansion and ink bounds; the triplet wire decoder stays scalar, and instancing uses f32.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

# Outline SIMD scope

## Decision

This revises decision 3 on #244 ("Speed target: a Wasm SIMD128 decoder").

**SIMD128 code, in the shaper's default `+simd128` build:**

- variable-font instancing (`p = base + Σ scalar_r · Δ_r`);
- composite expansion;
- ink-bound computation.

**Scalar code:** the triplet wire decoder stays scalar in both builds.

**Precision:** instancing runs in f32. The maintainer: "f32 and small error seems acceptable".

**Build:** the shaper already compiles with `+simd128` unless `PMNDRS_GLYPH_SHAPER_SIMD=0` selects the scalar build (`packages/glyph/scripts/build.mjs:64`). The scalar build runs the same steps with scalar code, so there is no new browser requirement.

## Why

**Measured on the [variable-font study](../outline-stream-variable-font-study.md)** (Node 22; scalar build against SIMD build):

| Step                                       | SIMD speedup over scalar |
| ------------------------------------------ | ------------------------ |
| Instancing, f32                            | 1.6–5.1×                 |
| Composite expansion                        | 1.9–3.6×                 |
| Ink bounds                                 | 2.1–3.7×                 |
| Triplet decoding, best of two SIMD designs | 0.62–1.23×               |

The triplet range is the best SIMD variant per step. Individual variants ran as slow as 0.41× scalar. Both SIMD decoders were byte-identical to scalar. The scalar base-triplet decode is already 0.06–0.66 µs per glyph.

**f32 accuracy:** f32 instancing is about 2× faster than exact f64x2 (Inter full: 0.13 vs 0.30 ms per instance). Against `fontTools.varLib.instancer`, the f32 path (IUP to f32, then f32 instancing) is 1 unit off on 13 of 637,680 stored coordinates on Inter full (10 axis locations; 24 of 2,008,840 after composite expansion), and on 1 of 151,816 on Roboto Flex full. Ink bounds had 0 mismatches.

## Consequences

**What it supersedes:** decision 3 on #244, and the SIMD triplet-decoder algorithm written under it. The #244 decisions comment was revised to match on 2026-10-06 ([decision 3](https://github.com/pmndrs/glyph/issues/244#issuecomment-6011804243)).

**What also changes:** decision 7 on #244 calls the required everywhere-path "the Wasm SIMD path (decision 3)". Under this revision that path is the scalar triplet decoder plus SIMD instancing, expansion and bounds.

**What is given up:** exact fontTools parity, which needs the f64 path (IUP in f64, f64 or f64x2 instancing). Output is rounded to integer units either way, so animated instances move in 1-unit steps.

**What stays open:** browser timings beyond Node 22, and code size measured as a production subset.
