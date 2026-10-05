---
type: Log Entry
title: 'Separate Three.js API contract'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Split the renderer-neutral core and Three.js consumer surfaces. The README now leads with minimal React Three Fiber and imperative Three.js paths that load one font, create one `TextGroup`, add `Text`, and attach the batch to the scene, then shows only real core calls and prepared-revision fields while marking renderer-owned buffer allocation, dirty-range upload, raster resource/shader binding, transform composition, ordered submission, and retirement as integration pseudocode. The authoritative Three specification keeps core handles private, lazily initializes cached shaping from the loader, late-binds unattached `Text` objects before first shaping, exposes only ordinary Three `add()` / `remove()` membership rather than a duplicate allocation shortcut, and assigns shared paragraph slots, buffers, and targets to the effective `TextGroup`. Detached text retains desired state without batch resources; reparenting recycles old membership and creates destination membership; direct scene attachment owns an implicit batch; and permanent text disposal remains distinct from scene removal, group disposal, and font disposal. The integration synchronizes from the Three render lifecycle while renderer-bound GPU targets stay isolated beneath one shared core runtime. `TextGroup` remains a non-Group `Object3D`, preserving the nearest real Three Group's primary order while supplying the secondary order for its physical submissions. Async supersession and cancellation resolve as handled outcomes; only preparation failures reject.
