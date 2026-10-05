---
type: Log Entry
title: 'Maintained integration subpaths'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the package-topology interpretation before implementation: Three.js, React Three Fiber, and TypeGPU remain maintained inside `@pmndrs/glyph` and ship through `/three`, `/r3f`, and `/typegpu` subpath exports. Renderer-neutral core still imports none of them. Only the gpucat fitness fixture is required to live as an external package consuming packed public exports without deep imports. Updated README examples, API specifications, architecture, roadmap, research, and D-144 around that boundary.
