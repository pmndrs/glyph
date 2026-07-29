---
type: Engineering Research
title: Slug outline architecture
description: Records the rejected exact-distance outline, the shipping fill-only boundary, and the gate for a bounded approximate replacement.
tags: [slug, outline, rendering, tsl, performance, research]
sources:
  - id: slug-manual
    resource: https://sluglibrary.com/SlugManual.pdf
    title: Slug User Manual
  - id: slug-reference
    resource: https://github.com/EricLengyel/Slug/tree/be3c13eb7d63f9e8aa5c583e42d92c374cb91d98
    title: Official public Slug reference shaders
  - id: rejected-runtime
    resource: https://github.com/pmndrs/text/commit/6f18b8fc5b9167e0143c41624f615e71dd51aecc
    title: Rejected dynamic analytic outline implementation
  - id: decision-register
    resource: decision-register.md
    title: Repository decision register
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-29T13:24:14Z'
status: draft
---

# Slug outline architecture

## Current product boundary

Slug V0 renders fill and opacity. It rejects every runtime `outline` property, including zero-width or transparent outlines, and rejects shadow. The generic text paint API retains outline because MTSDF supports it.

The previously implemented dynamic outline is removed from shipping source. It remains recoverable in Git history only as rejected research.[^rejected-runtime]

## What was rejected

The removed one-draw material evaluated ordinary Slug fill, then conditionally ran a second analytic closest-distance algorithm over intersecting curve bands. For quadratic Béziers, fill and distance solve different equations:

```text
fill:      Cx(t) = px or Cy(t) = py
distance:  (C(t) - p) · C′(t) = 0
```

The distance condition is generally cubic. The implementation therefore repeated band traversal and curve loads, ran iterative closest-point refinement, and reduced per-curve distances in addition to the fill work. Its generated program contained 16 static texture-load sites, six loop constructs, and two derivative sites, compared with eight loads, two loops, and one derivative site for fill.

The retained 268-glyph measurement showed the total outlined scene at `2.44×–4.33×` fill-only GPU time:

| Backend | DPR | All outline / fill | Mixed / fill |
| ------- | --: | -----------------: | -----------: |
| WebGPU  |   1 |              4.33× |        4.27× |
| WebGPU  |   2 |              3.51× |        3.34× |
| WebGL2  |   1 |              2.48× |        2.45× |
| WebGL2  |   2 |              2.44× |        2.61× |

The per-instance branch was locally useful—it reduced mixed-batch median GPU time by 30.51% on WebGPU and 23.96% on WebGL2 relative to unconditional distance evaluation—but it did not repair the architecture. The generated shader also placed a duplicate `fwidth` inside divergent fragment control flow while disabling derivative-uniformity diagnostics.

## External evidence

The official public Slug reference implements fill only.[^slug-reference] The commercial manual describes geometric outlines as conversion-time expanded contours with additional vertices and triangles; it does not describe a cheap dynamic distance threshold over ordinary fill data.[^slug-manual]

The surveyed public Slug-derived renderers were likewise fill-only or expanded strokes into closed contours rendered as ordinary Slug fills. No surveyed implementation reused fill roots to produce a true geometric dynamic outline, and none published evidence for a dynamic outline near fill cost.

Expanded contours remain a valid Slug technique, but fixed or quantized widths, extra geometry/storage, and effect-layer ordering do not satisfy the current requirement for arbitrary per-glyph widths in one ordinary batch.

## Candidate: bounded axis-distance approximation

The only active direction is an approximation derived during the existing horizontal and vertical fill traversals. It may retain the nearest eligible ray intersections, combine their axis distances into an outline coverage proxy, and use the already-computed screen derivative only for antialias width. It must not invoke a closest-point solver, traverse halo bands independently, or add an MSDF sidecar.

This is not exact Euclidean distance. Expected failure cases are extrema, acute corners, counters, joins, overlaps, and fragments whose nearest boundary does not cross either sample ray. Those cases define the conformance corpus.

## Go/no-go gate

The candidate proceeds only if both conditions hold:

1. Its visual error is no worse than the repository's MTSDF outline on the same source-outline corpus, including acute corners, counters, overlaps, complex icons, scale, rotation, and perspective.
2. Its nonzero-outline median GPU time is at most `1.15×` a fill-only control using the same expanded quad on both WebGPU and forced WebGL2. Zero-width material specialization remains the ordinary fill shader.

The experiment must emit and inspect final WGSL and GLSL, prove one derivative site outside divergent control flow, and report curve references, texture loads, loop structure, framebuffer error, and paired GPU samples. Failure of either condition ends the experiment; Slug remains fill-only rather than restoring the exact-distance fallback.

## Not verified

- The proprietary Slug shader implementation is not public; the manual establishes its data and geometry contract, not its exact draw submission.
- A shared-root approximation has not yet been implemented or measured.
- The `1.15×` performance ceiling is the initial research gate, not evidence already achieved.

[^slug-manual]: The manual's outline-effect and font-conversion sections specify expanded outline contours and additional geometry.

[^slug-reference]: The audited reference snapshot exposes one fill evaluation and no stroke or outline path.

[^rejected-runtime]: This commit introduced the now-rejected one-draw exact-distance runtime; later history owns its removal.
