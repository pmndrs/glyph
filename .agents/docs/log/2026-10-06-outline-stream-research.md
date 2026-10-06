---
type: Log Entry
title: 'Recorded the outline stream research and spike'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

Recorded the measured outline-format research for #235 and #244 as [outline stream research](../planning/outline-stream-research.md).

- **Full reports:** the [encoding study](../planning/outline-stream-encoding-study.md) and the [variable-font study](../planning/outline-stream-variable-font-study.md).
- **Decisions:**
  - [outline stream format](../planning/decisions/outline-stream-format.md)
  - [outline decoder in the core shaper](../planning/decisions/outline-decoder-in-core.md)
  - [outline SIMD scope](../planning/decisions/outline-simd-scope.md)
  - [Slug reads the shared outline points](../planning/decisions/slug-shared-outline-points.md) (Proposed until GPU parity)
  - [variable fonts in the outline stream](../planning/decisions/variable-font-outline-stream.md)
- **Spike:** added the temporary [GPU spike](../planning/outline-stream-spike.md) under `spikes/outline-stream/`, with the research scripts in `spikes/outline-stream/research/` and the official Slug reference shaders vendored for porting (credit: Eric Lengyel; patent dedicated to the public domain; MIT or Apache-2.0).
- **Verified** against the session that produced them, the #244 and #235 comments, the raw study logs and the code. The pass corrected misstated ranges (decode µs per glyph, slot corruption without the map, re-instance timings), separated what the maintainer decided from study recommendations (variable-font delta layout and bands, instancing in core), moved the optional compute decoder to the decoder decision, and added the implementation detail the decisions comment holds (rotation and wrap reasons, the all-off-curve rounding caveat, packing range, composite transform bytes, the implicit-form sign fix, the f16 origin). [Outline stream research](../planning/outline-stream-research.md#corrections-to-earlier-write-ups) lists the corrections.
