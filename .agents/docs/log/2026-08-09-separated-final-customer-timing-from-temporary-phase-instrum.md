---
type: Log Entry
title: 'Separated final customer timing from temporary phase instrumentation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The public Three workload can now retain a
single outside timer while disabling its internal phase collector. A 25,515-glyph, 31-sample release-artifact run
measures complete frame preparation, Rust update/render-plan publication, and Three application without internal clock
calls. The packaged shaper is Cargo release + LTO + SIMD followed by Binaryen `-Oz`; adjacent `-O3`/`-O4` artifacts cost
more bytes without a demonstrated speed gain. Production profiling hooks remain an explicit removal gate.
