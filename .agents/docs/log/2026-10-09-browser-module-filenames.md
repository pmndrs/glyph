---
type: Log Entry
title: 'Blocker-safe browser module filenames'
generated:
  by: process:docs-new
  at: '2026-10-09T07:38:41Z'
---

Moved Glyph’s private digest module from `fingerprint.ts` to `content-digest.ts` using the archived AST codemod. Public fingerprint identifiers and wire/cache identities are unchanged. [Glyph](../packages/glyph.md) records the filename policy; the [benchmark package](../packages/benchmarks.md) owns installed browser verification. The browser lane rejects matching URLs in the installed package and its workers, then performs a negative-control request to prove the filter is active. No particular extension or rule is claimed reproduced.
