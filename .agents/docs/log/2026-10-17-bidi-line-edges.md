---
type: Log Entry
title: 'Correct bidi line edges at visual clusters'
generated:
  by: process:docs-new
  at: '2026-10-17T21:02:39Z'
---

Issue [#245](https://github.com/pmndrs/glyph/issues/245) remained after the unsafe legal-break correction in D-372 because a paragraph-wide LTR flag suppressed every correction when any RTL run existed. The [Glyph package](../packages/glyph.md) now admits an unsafe UAX #14 break when both sides share one shaping run, binding, and font. It places the resulting line-edge record at its first UAX #9 visual cluster and walks RTL record clusters in visual order, preserving each cluster's decoration and justification. An island crossing shaping owners remains unavailable because HarfRust cannot shape it under one direction.

The CrossSpace Hebrew-tail integration fixture now requires line starts before `a` to draw glyph 28. A pure RTL Amiri fixture compares each wrapped line's glyph identities, advances, visual positions, and fitted width with the line shaped alone. Rust tests cover RTL admission and the cross-run rejection. The focused edge integration lane passed 22 tests; the full shaper lane passed 333 unit tests and its outline and Unicode suites after authenticating the source fonts. The full Glyph package check passed, including 1,027 package and integration Node tests, fuzz lanes, declarations, lint, formatting, and Clippy.
