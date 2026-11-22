---
type: Log Entry
title: 'Keep shared Three storage alive when a draw retires (port of #317)'
generated:
  by: process:docs-new
  at: '2026-11-22T03:02:47Z'
---

Ports pull request #317 onto the segment-indexed-layout integration branch, re-implemented against its draw realizer.
On Three r186, disposing a retired draw geometry destroyed every attribute attached to it, including Codec lanes, the
indexed transform table and detached `Glyphs` instance-transform storage that sibling draws still bound; the next
WebGPU submit then failed with a destroyed-buffer validation error. Retired draws now detach the shared storage that
outlives the publication before disposal and keep attached only storage that retires in the same publication. On
Three r185/r186, each draw also registers the renderer's attribute manager on its first render so that
`BufferAttribute.dispose()` by the storage owner, including of the material-only placement table, frees the GPU
allocation instead of leaking it. The ownership rules are in the [Glyph package concept](../packages/glyph.md).

The integration branch also shares MSDF atlases with their glyph tables and Slug header, band-curve and glyph-table
textures. They are not geometry attributes and stay behind reference-counted renderer-resource leases, so they needed
no code change; a regression test pins that sibling retirement keeps them and the last owner releases each exactly
once.

Evidence: focused Three integration tests fail on the unported source and pass after it. The `benchmark:three-storage-lifetime`
sibling scenario passes on Three 0.185.1 and 0.186.1 in Chromium WebGPU and WebGL2, and its negative control against a
package packed from the unported source reproduces the destroyed-buffer error and the stale A+B framebuffer. The
harness's single, multi, compile and renderer-disposed-first scenarios cannot run on this branch: removing a root's
last text group throws inside `Scene.updateMatrixWorld` because the root detaches its publication objects mid-traversal,
a defect independent of this port.
