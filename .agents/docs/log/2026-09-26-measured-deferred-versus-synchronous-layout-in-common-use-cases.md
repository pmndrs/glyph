---
type: Log Entry
title: 'Measured deferred versus synchronous layout in common use cases'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

The `@read-publication` selection now runs
framework-neutral use cases in scenes of 100 and 1,000 labels sharing one root: breaking a title into letters, typing
in a field, clicking to place a caret, 30 floating combat numbers that break apart, a 50-line edit with caret reads,
100 dashboard tickers with and without glyph reads, and loading a scene with every label broken apart. Each produces
the same checked outcome on both artifacts, written the way each API requires. Multi-object use cases run with all
updates before the reads and with each object updated and read in turn. An eight-block run of base `5eccfac5` against
`d2e914a4` at matched clocks matched all 24 outputs. At 1,000 labels every single-object and batched use case was
neutral, and the synchronous build shows each result one frame sooner; at 100 labels the title and the batched
50-line edit were 8% and 6% slower (p = .021). Updating and reading each object in turn publishes the root once
per object: at 1,000 labels the 50-line edit took 126 ms against 8.7 ms deferred, the tickers 362 ms against
11.8 ms, the combat burst 135 ms against 52 ms, and the scene load 2.48 s against 1.18 s. See
[benchmark ownership](../packages/benchmarks.md).
