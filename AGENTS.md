# Repository guidance

`pmndrs/text` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional raster renderers. New packages and applications belong under `packages/` or `apps/`; do not add implementation artifacts at the repository root.

Before writing or reviewing Rust, TypeScript, React, Wasm boundaries, or tests, read the canonical [engineering standard](docs/engineering/code-style.md). Use the repository-local `maintainability-review` skill for a deliberate cleanup, pre-release review, or milestone-wide audit; the skill owns the procedure, while the engineering standard owns the rules.

Use these canonical sources instead of creating shadow plans or duplicate status prose:

- `docs/roadmap/roadmap.md` for milestone order and checkbox status;
- `docs/planning/decision-register.md` for architectural decisions;
- `docs/packages/*.md` for current package ownership, boundaries, and evidence;
- `docs/log.md` for knowledge-bundle chronology.

Update affected canonical documentation in the same change as source. Package source or configuration changes require reviewing the matching package concept, regenerating its `source_digest`, and running `pnpm docs:check`.

Use the exact root toolchain pins through mise. The dated nightly under `packages/font-baker/fuzz` is isolated to cargo-fuzz. Verify narrowly first, then run the relevant package and repository checks. Keep tests deterministic; do not use sleeps, timer cushions, arbitrary retries, or regenerated goldens as correctness mechanisms.

Create small Conventional Commits that each preserve one coherent invariant. Finish completed work with a clean worktree.
