---
type: Log Entry
title: 'WebGL renderer handoff'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Reproduced rapid Benchmark/Conformance switching in WebKit as a null WebGL2 context followed by Three.js retrying its rejected initialization from `setAnimationLoop(null)`. All benchmark renderer owners now use one disposal boundary that stops rendering, invokes Three's synchronous cleanup, and waits for the browser's actual `webglcontextlost` event before the exclusive lifecycle admits a replacement. Failed initialization releases an acquired WebGL context without re-entering Three initialization. This established causal context release but did not make React Activity's preserved canvas reusable; the Activity canvas handoff above completes that boundary.
