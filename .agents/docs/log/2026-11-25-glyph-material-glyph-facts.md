---
type: Log Entry
title: 'Tell materials which glyph they draw: glyphIndex and glyphOrigin'
generated:
  by: process:docs-new
  at: '2026-11-25T01:59:45Z'
---

[Issue 13](../planning/issues-0.2.0/13-per-glyph-material-identity.md): per-letter animation had to `split()` a text
and drive matrices, because a material could not tell which glyph it was drawing. Materials can now read two facts
about that glyph in every integration: its index in the text's layout order and its pen origin.

- **Engine.** One new semantic codec input, the glyph's layout index (`semanticU32Fields.glyphIndex`, field 9): the
  index `glyphs()` reports the glyph at, read from the occurrence spans the gather already walks. A host codec may
  declare one `glyphFacts` system buffer; its origin lanes store the pen origin every technique
  body already loads. A glyph's index can move under a record the gather would otherwise skip (a blank or boundary
  glyph added before a retained line), so positioning also proves that every retained line kept its first layout
  index, and a codec that publishes the index gathers the whole paragraph when that proof fails. A codec that does not
  declare the input gathers and skips exactly as before.
- **Three** (`/three`, `/three/typegpu`, React, Vue). `defineThreeConfig({ glyphFacts: true })` publishes the lane;
  a glyph material context then carries `glyphIndex: Node<'uint'>` and `glyphOrigin: Node<'vec3'>`, stage-safe like
  the position nodes. Without the option neither lane exists and reading either fact throws.
- **TypeGPU.** `defineTypeGpuConfig({ glyphFacts: true })` publishes the lane and passes `glyphIndex` and
  `glyphOrigin` to `transformPosition` and `transformColor` as third and fourth arguments. Such a config builds its
  pipelines with the lane as a vertex input and two flat varyings; any other config compiles the same WGSL as
  `sil-green-72` (65 modules, one sha256).
- **PixiJS 3D.** `definePixi3DConfig({ glyphFacts: true })` publishes the lane, and a recipe whose bits declare the
  `aGlyphFacts` attribute (`float32x4`: origin x, origin y, index) carries them.

The facts are one record of four floats (origin x, origin y, index, unused), so a material that reads both adds one
storage buffer and MSDF in indexed mode stays at WebGPU's default eight. The index is exact up to 2^24. The facts are
opt-in because they are 16 bytes per glyph instance that the engine gathers for every text of a handle.
Measured on the same machine against `sil-green-71`, a handle that does not ask is unchanged: the same compiled codec
bytes, the same bytes per instance (bitmap 64, MSDF 68, Slug 48 in Three), byte-identical Three WGSL and GLSL for the
default material and for a caller material that reads neither fact, and frame times within run-to-run noise on 1,000
labels and one 24,000-glyph text. The index is a position, not an identity; `split()` remains the way to freeze one.
The [Glyph concept](../packages/glyph.md) records the boundary and the
[API summary](../planning/api-summary-for-review.md) the names.
