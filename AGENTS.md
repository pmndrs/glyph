# Repository guidance

`pmndrs/glyph` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional raster renderers. New packages and applications belong under `packages/` or `apps/`; do not add implementation artifacts at the repository root.

Before writing or reviewing Rust, TypeScript, React, Wasm boundaries, or tests, read the canonical [engineering standard](docs/engineering/code-style.md). Use the repository-local `maintainability-review` skill for a deliberate cleanup, pre-release review, or milestone-wide audit; the skill owns the procedure, while the engineering standard owns the rules.

Use the repository-local `tsl` skill before implementing or reviewing Three.js Shading Language materials, compute work, post-processing, or GLSL-to-TSL migrations. Verify examples against the repository's installed Three.js version rather than relying on remembered APIs.

Use the repository-local `engine-call-contract` skill before adding, moving, or removing anything on a published entry point, before giving an engine call an error path or a result type, and when deciding whether a failure belongs to the caller or to this package. It carries the two rules the API is built on: a call answers or throws where it was written, and application-encountered values and types live at the root while integrator construction helpers live on their exact `/config/*` leaves.

Use the vendored `typegpu` skill from TypeGPU's own maintainers before writing or reviewing TypeGPU shaders, buffers, bind groups, or pipelines, exactly as the `tsl` skill governs Three.js Shading Language work. It was installed with the upstream installer (`skills add software-mansion-labs/skills -s typegpu`) and targets TypeGPU 0.12, matching the pinned dependency. Its `references/` cover shaders, textures, types, pipelines, and the standard library.

Use the repository-local `agent-router` skill for every external-model review, delegated implementation, or research run. It routes through the pinned `ai-cli-mcp` server, preserves resumable sessions, and requires an isolated worktree for mutation-capable CLIs.

Read rolling JSONL traces only with `.agents/tools/read-append-log.mjs`; never load an entire trace or `docs/log.md` into
context. `--delta` advances a cursor, while `--lines <n> --bytes <n>` gives a bounded diagnostic tail. Trace samples are
not authoritative results: retrieve the completed response through `wait` or `get_result`. Keep raw traces in ignored
`.cache/` storage and publish only a human-readable summary when the result belongs in repository knowledge.

Use the repository-local `gh-stack` skill for every dependent branch or pull-request workflow. Root stacks on the remote
default branch and preserve their state through non-interactive `gh stack` commands; ordinary push and PR commands are
not substitutes.

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

Use the repository-local `codemod` skill for TypeScript or TSX migrations only after the changed API has reached the
remote default branch or external users. Unmerged feature work is edited directly and leaves no migration recipe for an
API nobody received. Shipped migrations use pinned ts-morph rather than global text replacement; update non-code
documentation only after the AST migration and residual-use inventory are clean.

Create small Conventional Commits that each preserve one coherent invariant. Finish completed work with a clean worktree.
