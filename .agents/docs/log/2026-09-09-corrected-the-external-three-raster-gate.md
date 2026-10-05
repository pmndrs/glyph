---
type: Log Entry
title: 'Corrected the external Three raster gate'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Direct `TextGroup.updateMatrixWorld()` now observes and publishes a
changed finite group render order without requiring a full Scene traversal; unchanged traversal remains inert. The
external raster browser proof now exercises the current root-level publication contract—`TextGroup.renderOrder`
against sibling Scene draw order—instead of the superseded per-group publication model. WebGPU and WebGL2 each pass
two retained deterministic frames with the same pixel hash, retained Mesh, and retained geometry.
