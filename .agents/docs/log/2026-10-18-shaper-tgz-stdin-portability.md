---
type: Log Entry
title: 'Explicit gzip decoding for frozen shaper archives'
generated:
  by: process:docs-new
  at: '2026-10-18T07:17:24Z'
---

The frozen shaper accounting, named-profile and diagnostic-memory workflows now request gzip decompression explicitly when extracting a `.tgz` member from stdin. GNU tar rejects the previous implicit-detection form; BSD tar had accepted it. Existing member selection, archive/byte authentication, error propagation and artifact generation remain unchanged.

The [Glyph package](../packages/glyph.md) runtime and benchmark timing inputs are unchanged. CI run [39106374228](https://github.com/pmndrs/glyph/actions/runs/39106374228) failed the accounting CLI archive test before its performance job; its failure is preserved. The existing four-case accounting test and formatter/linter pass locally; GNU tar is not installed on this Mac, so the next exact-head Linux CI run is the GNU verification. No engine build or performance rerun was used to justify these diagnostic-tool flag changes.
