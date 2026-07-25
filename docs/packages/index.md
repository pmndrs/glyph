# Workspace packages

- [`@pmndrs/text`](text.md) — public compile-time contract scaffold.
- [`@pmndrs/text-font-baker`](font-baker.md) — internal portable Rust/Wasm bake core.
- [`@pmndrs/text-benchmarks`](benchmarks.md) — Figma-backed benchmark and product-verification application.

Each package concept carries a deterministic `source_digest`. Repository validation fails when package source changes without a corresponding concept review and digest refresh.
