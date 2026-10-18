---
type: Log Entry
title: "Three final-owner storage disposal compatibility"
generated:
  by: process:docs-new
  at: '2026-10-18T14:13:29Z'
---

The [Three integration owner](../packages/glyph.md#ownership) already calls `BufferAttribute.dispose()` for retired
Codec buffers and transform tables, while detached `Glyphs` disposes its own instance-transform storage. Published Three
r185/r186 does not connect that event to the renderer's GPU attribute manager. A rendered text draw followed by an empty
publication and final handle disposal therefore left allocations behind, and a rendered draw replaced by an unrendered
draw could lose the only geometry listener capable of releasing them. The authenticated original PR #317 package ended
with 10 WebGPU storage attributes on r186.1 and 18 on r185.1 in the persistent-renderer lifecycle proof.

The Three draw realizer now records the actual renderer when one of its owned meshes is encountered. An internal
compatibility adapter for verified Three revisions 185 and 186 registers each consumed storage attribute, including the
material-only placement table and borrowed detached-glyph storage, with that renderer's existing `Attributes.delete`
method. The attribute's true owner still decides when to call `dispose()`. At that point the adapter asks every
still-live renderer manager to delete its allocation through Three's own GPU destruction and memory-accounting path.
Missing allocations are harmless because `Attributes.delete` is idempotent. Weak references avoid retaining discarded
renderers; a per-mesh weak set skips repeated per-frame registration. The r186 shared-geometry detachment rule from
the [previous fix](./2026-10-17-three-shared-storage-disposal.md) stays in place, so retiring one draw does not destroy
storage owned by a live sibling. No public API, Codec, or Wasm ABI changed.

The named `benchmark:three-storage-lifetime` installed-package proof uses one persistent Chromium WebGPURenderer,
readback, and `renderer.info.memory.storageAttributes`. Both official Three 0.185.1 and 0.186.1 with the fixed package
measured `0 → 10 → 2 → 10 → 2 → 0` through initial draw, empty publication, revived draw, unrendered replacement,
empty publication, and final owner disposal. First and revived images had the same 2,933 lit pixels and identical RGBA
readback, empty images had zero lit pixels, and neither WebGPU nor WebGL2 reported a browser error. Two real renderers
using the same attributes each returned from 10 to 0 after owner disposal; disposing the second renderer before the
Glyph owner also completed cleanly. An r186 `compileAsync` pass over the replacement draw likewise returned to zero.
The original package and exact unreleased Three merge source `9986ad524ae0c0ad0fd5193bd6ac235743d0b843`
independently returned to zero, confirming the upstream attribute-disposal mechanism without treating that source as a
published peer release.

The Three integration Node lane passes 124 tests. Full package and benchmark checks and final package-size evidence are
recorded in the pull-request validation report after the final source and documentation revision.
