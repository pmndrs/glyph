# Wire needs from the renderer lane

Two things the renderer does today by scanning instance lanes in JavaScript at commit
(`packages/glyph/src/three/internal/msdf-draws.ts`). Both would be cheaper and exact if the plan carried them. Field
names are proposals; sizes follow the existing little-endian, 4-byte-aligned plan records.

## 1. Effect mask per draw span

**Why.** The MSDF material has one graph per combination of effects in use. A fill-only graph costs 0.156 ms per
frame for 200 labels at 4x fill; the graph that can compose a shadow costs 0.185 ms when 10% of the labels have one,
because every fragment of the draw pays for the shadow's interpolated inputs. If spans were split by effect, the
other 90% would stay on the fill-only graph.

**Today.** One span per (program, resource, material, clip, depth key). The renderer ORs the alpha bytes of the
`effectColor` lane over the span's records on every publication that replaces draws or writes that lane.

**Need.**

| Field        | Type                              | Meaning                                                                                            |
| :----------- | :-------------------------------- | :------------------------------------------------------------------------------------------------- |
| `effectMask` | `u32` on the instance-span record | bit 0: some record has outline alpha > 0; bit 1: some record has shadow alpha > 0; other bits zero |

- Emitted with every instance span of a technique that declares text effects; zero for all others.
- A paint-only publication that changes the mask of an existing span must republish that span (a draw
  replacement or a span patch), since the renderer picks the material from it.
- Optional, behind a capability flag `split-spans-by-effect`: start a new span when the mask changes between
  consecutive records in paint order. Order is preserved, so compositing does not change; the cost is more draws
  when effects alternate, so the engine should only split when a run of equal mask is at least N records (N = 64 is a
  reasonable start; the renderer can measure).

With the mask on the span the renderer drops its lane scan and never reads `effectColor` on the CPU.

## 2. Atlas residency records (engine-owned allocator)

**Why.** GPU memory follows the glyphs drawn, not the glyphs baked (0.56 MiB instead of 1.44 MiB for an ASCII bake,
0.6 instead of 55.5 MiB for a full-font bake). The renderer keeps, per font, a resident atlas of 256-texel layers and
a per-glyph table `[left, top, width, height + layer * 4096]`; instances carry only the glyph's table row.

**Today.** At commit the renderer reads the glyph row of every record in each span that was written, and admits rows
it has not seen (shelf packing in arrival order, never moved, never evicted). That is O(records in the span) per
edit, and the allocator state lives outside the plan, so it cannot be checkpointed, replayed or shared with a
second renderer of the same handle.

**Need.** Two record kinds in the update section of a plan, ahead of the buffer patches of the same publication:

| Record        | Fields                                                                                                                                                       | Meaning                                                                                                                                                                 |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_GROW`  | `resource: u32`, `layers: u16`, `pageSize: u16`                                                                                                              | The resident atlas of `resource` now has `layers` layers of `pageSize` square texels. First record for a resource creates it.                                           |
| `ATLAS_ADMIT` | `resource: u32`, `glyphRow: u32`, `layer: u16`, `left: u16`, `top: u16`, `width: u16`, `height: u16`, `sourcePage: u16`, `sourceLeft: u16`, `sourceTop: u16` | Copy `width x height` texels from baked page `sourcePage` at `(sourceLeft, sourceTop)` to resident `layer` at `(left, top)`, and set table row `glyphRow` to that cell. |

- `ATLAS_ADMIT` is emitted in the publication whose instances first name `glyphRow`, never later, so the frame that
  first draws a glyph already has it. A glyph named by several texts in one publication is admitted once.
- Rows are stable: an admitted cell is not moved. Eviction, if added, is a third record (`ATLAS_EVICT resource
glyphRow`) emitted only when no live instance names the row; the renderer zeroes the table row.
- The allocator needs, per font resource, each glyph's baked cell size. That is already in the font binding the
  engine holds (plane metrics) or can be added as two `u16` binding fields (`cellWidth`, `cellHeight`).
- `pageSize` is 256 unless a baked cell is larger, then the next power of two that holds it.
- A prewarm request (`prewarm(font, text | codepoints)`) is the same path: shape, emit `ATLAS_ADMIT` for the glyph
  rows, publish no instances. It lets an application keep `ATLAS_GROW` (a whole-texture rebuild) off keystrokes.
- A renderer that uploads the whole baked atlas (TypeGPU today) ignores both records and fills the table from the
  baked cells.

The renderer side then becomes: apply `ATLAS_GROW` (reallocate, re-upload), apply each `ATLAS_ADMIT` (row copy,
mark the layer, write one table row), no lane scan.
