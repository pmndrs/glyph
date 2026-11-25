---
type: Log Entry
title: 'Decorations follow glyph facts: glyphIndex and glyphOrigin on a rectangle'
generated:
  by: process:docs-new
  at: '2026-11-25T04:07:44Z'
---

[Issue 13](../planning/issues-0.2.0/13-per-glyph-material-identity.md), second part: a material that moved glyphs by
`glyphIndex` or `glyphOrigin` left their underline behind, because a decoration draw knew nothing about the glyphs
above it. A decoration rectangle now says which glyphs it runs under, and a Three decoration material reads them
through the same two names.

- **Engine.** A `DecorationRecord` carries the layout index of the glyph at its inline start and at its inline end,
  and the line's baseline. Positioning captures them where a decorated run opens and closes, from the same occurrence
  count that numbers glyphs, so the cases follow from layout order being visual order: the first index is always the
  left end of the rectangle (the last character of a right-to-left run), blanks count, a ligature is one glyph, and
  a run is cut at every line break and font change, each rectangle with its own range. A retained line's records
  move by the change in the line's first layout index when they are copied. Decoration rows fill the three F32 lanes
  after the rectangle with baseline, first and last index; a program that does not read those lanes publishes the
  bytes it published before.
- **Codec.** `createDecorationCodecProgram` accepts `glyphFacts` among its system buffers and then stores, in the
  lane glyph rows use, the first glyph's pen origin (the rectangle's inline start, on the baseline), its index, and
  the last glyph's index where a glyph row has an unused lane. Three declares it for a `glyphFacts: true` handle:
  a decoration row grows from 32 to 48 bytes in indexed mode and 28 to 44 in direct mode. PixiJS 3D and TypeGPU
  codecs are unchanged with the option on or off.
- **Three** (`/three`, `/three/typegpu`). A decoration material context carries `glyphIndex: Node<'float'>`, the mix
  of the two indices along the rectangle (each end takes exactly its glyph's index), and `glyphOrigin: Node<'vec3'>`,
  the first glyph's origin. The index is a float because a rectangle spans many glyphs; `float(glyphIndex)` reads
  both kinds of context. The mix reads the unit quad's own `x` from the geometry: Three reassigns `positionLocal` to
  the material's `positionNode` before it evaluates a varying, which a fragment read goes through.
- **Fix found on the way.** A decoration row's only identity is its ordinal, and its content revision was the
  committed engine revision floored at one: one for a root's first publication and again for its second. An edit
  right after creation that kept the glyph count left the underline at its old rectangle. The row now takes the
  revision the update commits. This changes publications with the option off, for the better; no oracle lane moved.

What a rectangle cannot do: it has four corners, so it translates and shears with its two end glyphs and stays
straight between them. Nothing here cuts decorations per glyph.

Evidence: the oracle compares the three new record fields between incremental and cold on every request in an
extended stage no frozen reference includes (605 cases equal, 56,400 requests, 0 unlisted). No oracle request and no
edit tried through Three reaches a retained decorated line whose glyphs moved (a decorated paragraph repositions the
lines after an edit), so the move-on-copy is held by a unit test of the copy alone. Compiled codec bytes with the
option off are identical to `sil-green-72` for Three (both transform modes), TypeGPU and PixiJS 3D. A decoration
draw's vertex stage binds 2 storage buffers in direct mode and 4 in indexed mode with the facts; MSDF glyphs stay at 8. `benchmark:typegpu-parity` reads 444 underline pixels carrying the interpolated index and first-glyph origin on a
real WebGPU device. 1,000 underlined labels and one 24,000-glyph underlined text time within run-to-run noise of the
branch before this change, option off and on. Core shaper wasm: 527,647 bytes gzip -9, up 320.

Not done: PixiJS 3D decorations still draw with their own flat material. Routing them through a text material needs
the factory to be told it is drawing a decoration, which `Pixi3DTextMaterialFormat` cannot say today; see the issue
record. The [Glyph concept](../packages/glyph.md) and the [Three API](../planning/three-api.md) carry the contract.
