# Repository guidance

`pmndrs/glyph` is an ESM-only monorepo for portable font baking, universal shaping, paragraph layout, and optional
raster renderers. Packages and applications live under `packages/` and `apps/`; the benchmark application is
`benches/`.

## Commands

Run everything through the pinned toolchain: `mise exec -- pnpm …` or `mise exec -- <tool> …`, never relying on
`mise activate` across non-interactive commands. Root commands are `glyph`, `dev`, `build`, `test`, `check`, and
`scripts`; every other workflow is listed by `mise exec -- pnpm scripts list`, inspected with `scripts show <name>`, and
run with `scripts run <name> -- [arguments]`. When a repeatable workflow is missing, add a package-owned script and
root alias instead of leaving a shell recipe. Run `scripts run repo:hooks:install` once per clone. Verify narrowly first,
then run package and repository checks; keep tests deterministic, with no sleeps, timer cushions, retries, or
regenerated goldens as correctness mechanisms.

## Skills

Skills live in `.agents/skills`. If your harness does not list them, run
`node .agents/scripts/link-skills.mjs <your-skills-dir>` (Claude Code: `.claude/skills`) and reload. Use:

- `engine-call-contract` before changing a published entry point, an engine call's error path or result type, or
  deciding whether a failure is the caller's;
- `tsl` for Three.js Shading Language and `typegpu` for TypeGPU work, checked against the installed versions;
- `gh-stack` for every dependent branch or pull-request chain;
- `codemod` only for migrations of APIs already on the default branch or released;
- `maintainability-review` for deliberate cleanups and audits;
- `evidence-first` for human-facing engineering writing.

## Code

Read the [engineering standard](.agents/docs/engineering/code-style.md) before writing or reviewing code or tests.
Validate by who can author a value: public caller input, third-party callback results, and external data once at the
boundary; trust package-owned output and prove it at the producer. Never justify a runtime guard with a test that forges
a value no production caller can supply. For TSL typing changes, start from `packages/glyph/tests/types/tsl-*.test.ts`.
Create small Conventional Commits, each preserving one invariant, and finish with a clean worktree.

## Docs

Start at `.agents/docs/index.md` and never read a whole doc to find something: `scripts run docs:search -- <terms or
path>` and `docs:outline -- <path>[:line]` print `path › Heading  [start-end]` with the matching paragraph, so read
only that range; `docs:decision -- D-123` prints one decision and `docs:list -- log --since <date>` recent changes.
Canonical sources: `roadmap/roadmap.md` (milestones), `planning/decisions/` (one file per decision; D-001–D-372 are the
frozen `decision-register.md`), `packages/*.md` (package ownership and evidence), and `log/` (one file per change).

When you change a package's source, update its concept if it is now wrong, then, after your last source change, run
`docs:attest -- <package> "<what you changed and checked>"` and commit the file it writes. Record changes and decisions
with `docs:new -- log|decision <slug> <title>`, replacing every `TODO(docs:new)`; never edit a shared record or number
one. Nothing here blocks a merge: the commit hook and CI's `Docs report` show what is unattested, and the
`Sync agent docs` issue (label `agents`) lists what merged unverified for the reviewer, who corrects the docs and runs
`docs:verify -- <slug>`. Package size is review evidence from CI's size comment; never commit `package-sizes.json` from
a feature branch.
