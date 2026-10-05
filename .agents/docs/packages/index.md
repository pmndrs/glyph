# Workspace packages

- [`@pmndrs/glyph`](glyph.md) — public loading, baking, HarfRust shaping, paragraph layout, static discovery, and portable bitmap artifact core.
- [`@pmndrs/glyph-benchmarks`](benchmarks.md) — Figma-backed benchmark and product-verification application.
- [`@pmndrs/glyph-examples`](examples.md) — paired imperative Three.js and R3F examples over shared assets.

- [`@pmndrs/glyph-typegpu-hello-world`](typegpu-hello-world.md) — editable text using the high-level TypeGPU integration.
- [`@pmndrs/glyph-tres-playground`](tres-playground.md) — Vue adapter playground rendering every raster format inside a TresJS canvas.

Repository validation requires exactly one concept per workspace package. Freshness is measured from history rather than a stored pin: a concept drifts when package source commits land after the last commit that touched it. `docs:drift` reports that drift, and the `Docs drift` workflow keeps one `docs-drift` issue in step with `main` for the maintenance agent; see D-373 in [the decision register](../planning/decision-register.md).
