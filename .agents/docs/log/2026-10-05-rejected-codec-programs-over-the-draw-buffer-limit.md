---
type: Log Entry
title: 'Rejected codec programs that declare more buffers than one draw binds at registration'
generated:
  by: process:docs-new
  at: '2026-10-05T19:22:02Z'
---

`validate_codec` and the mirrored `compileCodec` preflight now compare each program's buffer count against
`maxBuffersPerDraw` of every capability set it serves, and `createRasterCodecProgram` names the technique and system
buffers when its assembled program exceeds the limit. The engine previously discovered the mismatch in
`compile_bindings` and reported it as `result-too-large` on the first publish. See [the package reference](../packages/glyph.md).
