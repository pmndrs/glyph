# Workspace packages

- [`@pmndrs/glyph`](glyph.md) — public loading, baking, HarfRust shaping, paragraph layout, static discovery, and portable bitmap artifact core.
- [`@pmndrs/glyph-benchmarks`](benchmarks.md) — Figma-backed benchmark and product-verification application.
- [`@pmndrs/glyph-examples`](examples.md) — paired imperative Three.js and R3F examples over shared assets.

- [`@pmndrs/glyph-typegpu-hello-world`](typegpu-hello-world.md) — editable text using the high-level TypeGPU integration.
- [`@pmndrs/glyph-tres-playground`](tres-playground.md) — Vue adapter playground rendering every raster format inside a TresJS canvas.

Each package concept carries a deterministic `source_digest`. Repository validation fails when package source changes without a corresponding concept review and digest refresh.
