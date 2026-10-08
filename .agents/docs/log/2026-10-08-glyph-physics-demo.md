---
type: Log Entry
title: 'Glyph physics demo'
generated:
  by: process:docs-new
  at: '2026-10-08T03:18:13Z'
---

The Presentation workload "Glyph physics" drops a paragraph as Box3D rigid bodies whose colliders are built from
`Glyphs.outlineAt(i)`: Clipper2 nonzero union, earcut, Hertel-Mehlhorn convex pieces, prism hulls with z locked. One
collider is built per `(fontId, glyphId)` and `colliders[i]` stays parallel to `Glyphs`; a 2,000-glyph paragraph builds in
about 7 ms with that sharing against about 165 ms without it, and one glyph with a counter takes about 1.3 ms
(`labs/package/glyph-colliders.bench.ts`, one noisy Linux host, so evidence for this host only).

The Colliders wireframe first looked missing on thin straight stems. Every glyph had pieces and hulls; the pale cyan had no
contrast against the white fill, since a stem's collider edges lie on its own edge. It is now a deeper cyan, and a test
checks that every printable ASCII glyph yields a hull. A settled pile overlapped by up to 2.6 px because dynamic bodies are
not swept against each other, so the speed cap is now 0.07 em per step. The remaining overlap is about 0.02 em (0.65 px at
28 px), five to six times Box3D's 0.1 px contact slop, and the cause of that residue is not found; the overlap test allows
0.03 em. The walls are inset from the control dock and the payload pills and the paragraph starts above the viewport so the
glyphs heap up. See the [benchmarks concept](../packages/benchmarks.md).

Colliders then stopped respecting holes: each is built from the filled outer regions only, at the same 0.2 px flattening, so
counters are solid and the outer edge still rolls. The Outlines overlay still draws the true contours. For 662 bodies of 28
px Inter in a 700 px box (33 shapes), pieces per shape fell from 12.2 average and 32 maximum to 7.2 and 21, hull shapes from
8,490 to 5,494, and the Node-native step from 10.9 to 7.4 ms while falling (steps 0-60) and from 12.4 to 9.0 ms while piling
(steps 200-400), on this host. The frame loop now runs at most two fixed steps per frame and discards the time it cannot run,
because a step costing most of a frame made each late frame owe more steps than the last.
