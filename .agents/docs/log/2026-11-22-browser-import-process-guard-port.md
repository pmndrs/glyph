---
type: Log Entry
title: 'Guard browser imports without process (port of #314)'
generated:
  by: process:docs-new
  at: '2026-11-22T03:10:42Z'
---

Ports pull request #314 (issue #217) onto the segment-indexed-layout integration branch. The private diagnostics gate
read `process.env.NODE_ENV` unconditionally, so importing the shipped ESM directly in a browser threw before any Glyph
code ran. The gate now checks for the Node global, keeps Node development and production behavior, and follows Vite's
`import.meta.hot` and `import.meta.env.DEV` in served and built browser modules; the two teardown warnings keep literal
`NODE_ENV` comparisons so generic production defines still remove their text. See the
[Glyph package concept](../packages/glyph.md) and the [benchmark package concept](../packages/benchmarks.md).

Beyond the original pull request, a package test imports every browser entry (root, `/core`, `/three`, `/typegpu`,
`/three/typegpu`, `/pixi3d`) with Glyph's own modules evaluated without `process`; it fails on the unguarded gate. An
audit of the built `dist` found every other `process` read guarded (`typeof process`, `globalThis.process?.`, or
short-circuited by `DEV`) or confined to Node-only modules. The installed `typegpu@0.12.5` peer reads
`process.env.NODE_ENV` unguarded in `shared/env.js`, so the TypeGPU entries still fail as untransformed browser ESM
until that peer is bundled or shimmed; that is outside Glyph.
