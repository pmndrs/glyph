---
type: Log Entry
title: 'External runtime bake routing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The third-party proof lane (`benchmark:external-raster`) had been failing on
main: the runtime shoveled every requested raster into the Worker font-bake plan, and the Worker's embedded
baker switch correctly rejected kinds it does not carry — killing the whole load even though the host-side path
through `technique.runtimeBaker` exists for exactly this case. The routing authority is now one declared set,
`workerRasterKinds`, exported from the runtime-bake subpath: Worker plans carry only Worker-embedded kinds, and
every other technique's raster deliberately misses in the baked artifact and bakes host-side through the baker
its own declaration names. Proven red-green in Node with the published example package (a strict stub enforcing
the Worker's contract) and by the restored browser lane: deterministic external raster frames on WebGPU and
WebGL2 with identical hashes. Verified pre-existing on a clean origin/main worktree before fixing, so this is a
repair, not a regression from the stack.
