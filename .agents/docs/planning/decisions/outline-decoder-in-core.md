---
type: Decision
title: 'Outline decoder lives in the core shaper'
description: 'The outline decoder is compiled into the core shaper Wasm and is always available; there is no separately loaded outline module, and a WebGPU compute decoder is optional.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

# Outline decoder lives in the core shaper

## Decision

**The outline decoder lives in the core shaper Wasm. It is required and always available.** There is no separately loaded outline module. In the maintainer's words: "Because the decoder is small, I don't want to optionally load it, it should be in the runtime, required, always available. So the bytes we need for the decoder go into the core wasm."

**What the decoder covers** (decision 1 on #244):

- the triplet wire decoder;
- composite expansion;
- the GPU point-layout emitter that `outlineAt()` and Slug read.

Variable-font instancing runs on the decoded points, so it is expected to live in the same module. No separate decision places it there, and its production size is unmeasured.

**It replaces #235's read-fonts glyf loader, its CFF charstring interpreter, and its runtime `cubic_to_quadratics_into(…, 4)` split** (`packages/glyph/rust/shaper/src/outline.rs` on #235).

**A WebGPU compute decoder is optional, not required** (decision 7 on #244). WebGL2 has no compute shaders, so the Wasm path is the one that must work everywhere. A compute decoder would upload the wire bytes (about 1.3 bytes per point) instead of the point buffer (about 5 bytes per curve). It pays off mainly for variable-font instancing. Shader effects (strokes, offsets, distance, morphing) do not need it: they read the decoded point buffer.

## Why

**Size:** the measured scalar decoders, no_std Rust to Wasm at opt-level s with LTO, stripped:

| Decoder                          | gzip              |
| -------------------------------- | ----------------- |
| Triplet decode                   | 0.56 KB (556 B)   |
| Triplet decode plus point layout | 1.09 KB (1,090 B) |
| Composite expansion              | not measured      |
| #235's read-fonts decoder        | +24.7 KB          |

The #244 decisions comment quotes 0.57 and 1.11 KB for the same files: gzip -9 with the file name in the header (569 and 1,111 B), against the study log's headerless gzip.

**Speed:** decoding happens once per font load, at 0.17–0.64 µs per glyph (medians; all of Inter in 0.51 ms, all of Noto CJK 2.004 in 42 ms), instead of on every `outlineAt()` call (#235: 1.2–10.5 µs per call). One slower CJK run measured 0.86 µs per glyph; earlier write-ups quote that as the upper bound.

## Consequences

**Size:** the core shaper Wasm ends up about 23 KB smaller than #235 makes it, and every font with outlines can be read without loading anything else.

**What it supersedes:** "the decoder is opt-in" in the body of #244 and in the [#235 bit-packed proposal](https://github.com/pmndrs/glyph/pull/235#issuecomment-5914720202), and the encoding study's recommendation of a decoder "loaded only with outlined artifacts".

**What stays open:** the size of full composite expansion, and of the instancer as a production subset (the whole study instancer module, every variant included, is 3.8 KB gzip scalar or 7.8 KB SIMD at opt-level s).
