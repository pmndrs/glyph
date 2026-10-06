---
type: Decision
title: 'Outline SIMD scope'
description: 'Outline SIMD code goes to variable-font instancing, composite expansion and ink bounds; the triplet wire decoder stays scalar, and instancing uses f32.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: process:docs-new
  at: '2026-10-06T13:09:24Z'
---

# Outline SIMD scope

## Decision

**SIMD128 code, in the shaper's default `+simd128` build:**

- variable-font instancing (`points = base + Σ scalar · Δ`);
- composite expansion;
- ink-bound computation.

**Scalar code:** the triplet wire decoder stays scalar in both builds.

**Precision:** instancing runs in f32.

## Why

**Measured on the [variable-font study](../outline-stream-variable-font-study.md):**

| Step                                            | SIMD speedup over scalar |
| ----------------------------------------------- | ------------------------ |
| Instancing, f32                                 | 1.6–5.1×                 |
| Composite expansion                             | 1.9–3.6×                 |
| Ink bounds                                      | 2.1–3.7×                 |
| Triplet decoding (two independent SIMD designs) | 0.62–1.23×               |

**f32 accuracy:** f32 instancing is about 2× faster than exact f64x2. Against `fontTools.varLib.instancer`, it is 1 unit off on at most 13 of 637,680 coordinates (Inter full). The maintainer accepted that error.

## Consequences

**What it supersedes:** the earlier wording of decision 3 on #244, "SIMD decoder as the speed target".

**What is given up:** exact fontTools parity, which needs the f64 path.

**What stays open:** browser timings, and code size measured as a production subset.
