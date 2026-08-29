# Repository guidance

`pmndrs/glyph` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional raster renderers. New packages and applications belong under `packages/` or `apps/`; do not add implementation artifacts at the repository root.

Before writing or reviewing Rust, TypeScript, React, Wasm boundaries, or tests, read the canonical [engineering standard](docs/engineering/code-style.md). Use the repository-local `maintainability-review` skill for a deliberate cleanup, pre-release review, or milestone-wide audit; the skill owns the procedure, while the engineering standard owns the rules.

Use the repository-local `tsl` skill before implementing or reviewing Three.js Shading Language materials, compute work, post-processing, or GLSL-to-TSL migrations. Verify examples against the repository's installed Three.js version rather than relying on remembered APIs.

Use the repository-local `engine-call-contract` skill before adding, moving, or removing anything on a published entry point, before giving an engine call an error path or a result type, and when deciding whether a failure belongs to the caller or to this package. It carries the two rules the API is built on: a call answers or throws where it was written, and a type an application can encounter lives at the root while a thing only an integrator constructs lives in `/core`.

Use the vendored `typegpu` skill from TypeGPU's own maintainers before writing or reviewing TypeGPU shaders, buffers, bind groups, or pipelines, exactly as the `tsl` skill governs Three.js Shading Language work. It was installed with the upstream installer (`skills add software-mansion-labs/skills -s typegpu`) and targets TypeGPU 0.12, matching the pinned dependency. Its `references/` cover shaders, textures, types, pipelines, and the standard library.

Use the repository-local `agent-router` skill for every external-model review, delegated implementation, or research run. It routes through the pinned `ai-cli-mcp` server, preserves resumable sessions, and requires an isolated worktree for mutation-capable CLIs.

The local `ai-cli` command can diagnose the pinned package, catalog, and provider CLIs, but it is not proof that the MCP transport is loaded. After changing MCP configuration, reload the client and confirm the server's tools are present before calling the router healthy.

Until the MCP tools are visible, `mise exec -- pnpm exec ai-cli ...` is the approved temporary fallback because it uses the pinned workspace package and preserves the same PID/session lifecycle. Mark those runs `transport: cli-fallback`, capture their PID and session ID, and never substitute an unpinned provider CLI or treat a successful fallback as MCP validation.

Use the bounded append-only reader at `.agents/tools/read-append-log.mjs` for agent traces and rolling logs. Do not load `docs/log.md` or a full JSONL trace into context; query `docs/planning/decision-register.md` for settled decisions and read only the relevant bounded log slice.

The reader is the required context-management tool for append-only output:

```bash
node .agents/tools/read-append-log.mjs <trace.jsonl> --delta
node .agents/tools/read-append-log.mjs <trace.jsonl> --lines 80 --bytes 12000
```

`--delta` advances a cursor and handles a rolled or truncated file. A trace sample is diagnostic only; retrieve authoritative agent results through the provider/MCP result operation. For decisions, query the decision register and the relevant package concept instead of searching the whole chronology.

Keep machine traces and OKF-visible knowledge separate. Raw JSONL traces and cursor state may live in ignored `.cache/` directories and may be byte-rolled. If a run is surfaced in an OKF bundle or `docs/log.md`, write a human-readable summary that preserves the reserved OKF log shape: exactly one H1 title, newest-first `## YYYY-MM-DD` sections, and flat prose entries. Never byte-roll, cursor-edit, or append raw trace records into an OKF `log.md`; validate the bundle after changing it.

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

Use the repository-local `codemod` skill for TypeScript or TSX symbol renames, import moves, signature changes, and public
API migrations. It uses pinned ts-morph and dated migration recipes; global find-and-replace is not an allowed code rename
tool. Update non-code documentation only after the AST migration and residual-use inventory are clean.

Create small Conventional Commits that each preserve one coherent invariant. Finish completed work with a clean worktree.
