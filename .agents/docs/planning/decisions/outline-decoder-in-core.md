---
type: Decision
title: 'Outline decoder lives in the core shaper'
description: 'The outline decoder is compiled into the core shaper Wasm and is always available; there is no separately loaded outline module.'
decision_status: Accepted
decided: '2026-10-06'
generated:
  by: process:docs-new
  at: '2026-10-06T13:09:23Z'
---

# Outline decoder lives in the core shaper

## Decision

**The decoder lives in the core shaper Wasm:**

- the triplet decoder;
- composite expansion;
- the GPU point-layout emitter;
- variable-font instancing.

It loads with the shaper, and every font that carries outlines can be read without another request.

**It replaces #235's read-fonts glyf loader, its CFF charstring interpreter, and its runtime four-way cubic split.**

## Why

**Size:** the measured decode path is 1.11 KB gzip (triplets plus the point-layout emitter), against the +24.7 KB read-fonts decoder in #235. See [outline stream research](../outline-stream-research.md).

**Small enough to always ship:** a lazily loaded module would add a request and an async boundary to save about 1 KB.

**Speed:** decoding happens once per font load, at 0.17–0.86 µs per glyph, instead of on every `outlineAt()` call (#235: 1.2–10.5 µs per call).

## Consequences

**Size:** the core shaper Wasm ends up about 23 KB smaller than #235 makes it.

**What it supersedes:** "the decoder is opt-in" in the body of #244.

**What stays open:** the size of full composite expansion and of the instancer, measured as a production subset.
