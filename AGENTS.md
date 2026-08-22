# Repository guidance

`pmndrs/glyph` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional raster renderers. New packages and applications belong under `packages/` or `apps/`; do not add implementation artifacts at the repository root.

Before writing or reviewing Rust, TypeScript, React, Wasm boundaries, or tests, read the canonical [engineering standard](docs/engineering/code-style.md). Use the repository-local `maintainability-review` skill for a deliberate cleanup, pre-release review, or milestone-wide audit; the skill owns the procedure, while the engineering standard owns the rules.

Use the repository-local `tsl` skill before implementing or reviewing Three.js Shading Language materials, compute work, post-processing, or GLSL-to-TSL migrations. Verify examples against the repository's installed Three.js version rather than relying on remembered APIs.

Use the repository-local `claude-review` skill when invoking Claude Code for an adversarial or external-model review. Keep reviews read-only, stream visible progress, and retain the complete trace in the ignored repository cache instead of launching an opaque buffered subprocess.

Use the repository-local `gh-stack` skill for every dependent branch or pull-request workflow. Create, adopt, navigate,
rebase, push, submit, sync, link, and merge stacks through non-interactive `gh stack` commands; ordinary `git push`,
`gh pr create`, and `gh pr merge` are not substitutes for GitHub Stack state. Always use `gh stack submit --auto` and
`gh stack view --json`, and provide every branch or checkout argument explicitly as required by the skill.

Consult the repository-local `evidence-first` skill as the default style guidance for human-facing engineering communication, including chat updates and final answers, reports, reviews, handoffs, PR and issue prose, READMEs, and technical documentation. It offers situational cues rather than a fixed template. Domain skills still determine the work and valid evidence, `open-knowledge-format` governs bundle structure and provenance, and `diataxis-docs` governs the purpose and top-level structure of reader-facing documentation.

Use these canonical sources instead of creating shadow plans or duplicate status prose:

- `docs/roadmap/roadmap.md` for milestone order and checkbox status;
- `docs/planning/decision-register.md` for architectural decisions;
- `docs/packages/*.md` for current package ownership, boundaries, and evidence;
- `docs/log.md` for knowledge-bundle chronology.

Update affected canonical documentation in the same change as source. Package source or configuration changes require reviewing the matching package concept, re-pinning its `source_digest` with `mise exec -- pnpm scripts run docs:update`, and verifying with `mise exec -- pnpm scripts run docs:check`.

Use the exact root toolchain pins through mise. Agent commands must enter that environment explicitly with `mise exec -- pnpm ...` or `mise exec -- <tool> ...`; do not depend on `mise activate` surviving across non-interactive commands. Mise owns tool selection, while pnpm remains the only repository workflow surface. Install workload-scoped mise tools only when their documented pnpm workflow requires them. The dated nightly under `packages/glyph/rust/font-baker-fuzz` is isolated to cargo-fuzz. Verify narrowly first, then run the relevant package and repository checks. Keep tests deterministic; do not use sleeps, timer cushions, arbitrary retries, or regenerated goldens as correctness mechanisms.

Exercise repository workflows through named `pnpm` scripts from the workspace root. Prefer a short root alias for a maintainer-facing application workflow. When a repeatable build, test, profile, capture, generation, or development command is missing, add the package-owned script and root alias before running it; do not leave the working procedure as an agent-only shell recipe or temporary probe.

Before searching for or inventing a specialized maintenance command, run `mise exec -- pnpm scripts list`. Use `mise exec -- pnpm scripts show <name>` to inspect its prerequisites and writes, then `mise exec -- pnpm scripts run <name> -- [arguments]` to execute it. Contributor-facing root commands are limited to `bake`, `dev`, `build`, `test`, `check`, and this `scripts` index; specialized workflows describe themselves in their source metadata instead of expanding package manifests.

TypeScript checks use the repository-pinned compiler and the patched `@types/three` declaration graph. For TSL typing changes, begin with the focused regression fixture before running a package or application project.

Create small Conventional Commits that each preserve one coherent invariant. Finish completed work with a clean worktree.
