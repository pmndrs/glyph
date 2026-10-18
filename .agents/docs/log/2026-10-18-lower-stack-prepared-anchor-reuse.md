---
type: Log Entry
title: 'Lower stack prepared anchor and query reuse'
generated:
  by: process:docs-new
  at: '2026-10-18T17:50:09Z'
---

The lowest held layer now reuses the [Glyph owner's](../packages/glyph.md#ownership) existing preparation
for ordinary anchor changes before renderer acceptance. The existing planner reanchors its owned measurement and
inspection when text, styles, geometry and preparation removals are unchanged. It keeps immutable line-record identity
and avoids another engine preparation. Semantic changes retain the existing executor and invalidation path. Renderer
rejection still requires explicit publication retry; this change does not accept renderer work from a read.

The Three presentation comparison now supplies its existing six arguments, fixing the lower branches' TypeScript
build failure after current-main integration. No public API, ABI, data layout or additional cache was introduced.
The [Glyph owner reference](../packages/glyph.md) already describes anchor-only line reuse and remains accurate.

Real-Wasm tests now count the actual preparation crossing instead of reading a stale request after a no-op. Creation
plus first demand prepares empty/whitespace text once, then reuses its bounds. An explicit equal font assignment keeps
its measurement but still publishes renderer work; a distinct font prepares once and matches an independent cold
paragraph. Changed style payload, stable line identity and accepted-publication checks remain.

Fresh scoped Sol High reviews pass. The isolated lower checkout's full package check exits 0, including 1,063 primary
Node tests, the additional fuzz/font-baker lanes, 501 native tests with one existing ignored test, and static checks.
All six applied source/test files match that gated checkout byte for byte. Earlier failing commands remain in the
local evidence; none was relabeled successful. This repairs the stack foundation and makes no performance claim.
All layers remain held and unmerged.
