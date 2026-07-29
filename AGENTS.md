# Repository guidance

`pmndrs/text` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional raster renderers. New packages and applications belong under `packages/` or `apps/`; do not add implementation artifacts at the repository root.

Before writing or reviewing Rust, TypeScript, React, Wasm boundaries, or tests, read the canonical [engineering standard](docs/engineering/code-style.md). Use the repository-local `maintainability-review` skill for a deliberate cleanup, pre-release review, or milestone-wide audit; the skill owns the procedure, while the engineering standard owns the rules.

Use the repository-local `tsl` skill before implementing or reviewing Three.js Shading Language materials, compute work, post-processing, or GLSL-to-TSL migrations. Verify examples against the repository's installed Three.js version rather than relying on remembered APIs.

Consult the repository-local `evidence-first` skill as the default style guidance for human-facing engineering communication, including chat updates and final answers, reports, reviews, handoffs, PR and issue prose, READMEs, and technical documentation. It offers situational cues rather than a fixed template. Domain skills still determine the work and valid evidence, `open-knowledge-format` governs bundle structure and provenance, and `diataxis-docs` governs the purpose and top-level structure of reader-facing documentation.

Use these canonical sources instead of creating shadow plans or duplicate status prose:

- `docs/roadmap/roadmap.md` for milestone order and checkbox status;
- `docs/planning/decision-register.md` for architectural decisions;
- `docs/packages/*.md` for current package ownership, boundaries, and evidence;
- `docs/log.md` for knowledge-bundle chronology.

Update affected canonical documentation in the same change as source. Package source or configuration changes require reviewing the matching package concept, regenerating its `source_digest`, and running `pnpm docs:check`.

Use the exact root toolchain pins through mise. The dated nightly under `packages/font-baker/fuzz` is isolated to cargo-fuzz. Verify narrowly first, then run the relevant package and repository checks. Keep tests deterministic; do not use sleeps, timer cushions, arbitrary retries, or regenerated goldens as correctness mechanisms.

TypeScript checks use the repository-pinned compiler and the patched `@types/three` declaration graph. For TSL typing changes, begin with the focused regression fixture before running a package or application project.

Create small Conventional Commits that each preserve one coherent invariant. Finish completed work with a clean worktree.
