---
type: Log Entry
title: 'Compressed the default shaper download'
generated:
  by: process:docs-new
  at: '2026-10-05T19:59:45Z'
---

The build publishes reproducible gzip beside the raw optimized Wasm.
Default browser and Node loading decodes gzip only when it remains compressed after transport; raw bytes and compiled
module overrides remain supported. Package tests cover artifact identity and exports, and the packed browser consumer
exercises static gzip, HTTP decoding, and truncated input. See [the package reference](../packages/glyph.md) and
[browser verification](../packages/benchmarks.md).
