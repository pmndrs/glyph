# Workspace packages

- [`@pmndrs/text`](text.md) — public loading, baking, HarfRust shaping, paragraph layout, static discovery, and portable bitmap artifact core.
- [`@pmndrs/text-benchmarks`](benchmarks.md) — Figma-backed benchmark and product-verification application.
- [`@pmndrs/text-r3f-hello-world`](r3f-hello-world.md) — minimal public R3F Bitmap, MSDF, Slug, and fallback example.

Each package concept carries a deterministic `source_digest`. Repository validation fails when package source changes without a corresponding concept review and digest refresh.
