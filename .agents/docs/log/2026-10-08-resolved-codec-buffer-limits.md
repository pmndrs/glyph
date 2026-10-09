---
type: Log Entry
title: 'Validated resolved Codec draw-buffer limits'
generated:
  by: process:docs-new
  at: '2026-10-08T19:32:47Z'
---

Community PR #226 now rejects a Codec program whose selected capability set cannot bind all of its declared buffers at
registration, instead of allowing the first publication to fail with `result-too-large`. Glyph program validation shares
the engine's exact-set-before-wildcard resolver; decoration validation retains its declaration-order first-match rule, so
an unreachable wildcard no longer invalidates a narrower override. The public raster helper reports the same condition as
a `RangeError`, derives the diagnostic's system-buffer names from the declarations it publishes, and documents the direct
eight-buffer and indexed nine-buffer boundary. The [Glyph concept](../packages/glyph.md#renderer-codec) records the
selection and limit contract.

Public compiler tests cover accepted wildcard overrides and wide-only bindings, selected over-limit wildcard and specific
programs, and decoration ordering. The raster integration covers both boundary counts and indexed transform publication.
The shaper's 312 unit tests, strict Clippy and rustfmt, TypeScript typecheck/lint/format, and 124 focused public Node tests
pass. The draw-time capacity guard remains as a cheap natural failure if an internal invariant regresses; no wire or public
signature changed.
