---
type: Log Entry
title: 'Added attached Three glyph deformation without reopening layout or batching'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`Text.withGlyphs()` remains the
generic synchronous bounded read, while `Text.transformGlyphs()` accepts an exact-length affine `Matrix4` result as
live presentation. Bare arrays are Text-local; structured results name paragraph x-right/y-down, Text-local, or world
space. The first result lazily allocates renderer-owned mat4 storage and refreshes material/display-list identity once;
later updates compare f32 rows, mark only changed adjacent 16-float physical-record ranges, and do not cross shaping or
render-plan publication. An unchanged full result or unchanged world transform schedules zero matrix uploads; changing
one glyph while returning the required complete index domain schedules exactly one 16-float row.
Stable-slot owner tags reset reused records, equal-count text edits reapply matrices by the new visual index, changed
counts retire the stale result, `clearGlyphTransforms()` restores layout placement, and `measureGlyphs()` applies the
same matrices to interaction geometry. The exact-source package gate passes 982/982 tests plus fuzz, format, type, and
Rust checks; both WebGPU and WebGL2 node builders compile the matrix path, and the complete 56-case Three integration
file passes. The Three adapter grows 8,676 raw / 2,198 gzip / 1,703 Brotli bytes and remains within reviewed ceilings.
Direct TypeGPU remains an explicit proof-of-concept follow-on rather than inheriting Three's storage contract.
