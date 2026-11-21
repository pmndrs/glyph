# Repository guidance

## This branch: layout and publication refactor

This branch is one architectural attempt, judged as a whole: at the end it beats the existing architecture or it is
abandoned. Until then these rules replace anything below, in `.agents/docs`, or in earlier handoffs that conflicts:

- Work in large units. Commit coherent milestones; do not split work to preserve one invariant per commit.
- Benchmarks are spikes for evidence before committing to a direction. Saved snapshots of `v0.1.0`, main and the
  branch start are a loose reference only; any benchmark run after that is interleaved against main in the same
  session. No statistical protocol, thresholds, arm counts, or size report after each change.
- Alongside the linters and formatters, run `fallow` (TypeScript) and `kimun` (code metrics) on the code you
  touch and act on complexity, duplication and unused-code findings before calling a unit done.
- Keep work. Do not revert or discard a unit because an intermediate measurement is flat or negative.
- Correctness is not negotiable and is not ceremony: incremental results must equal cold whole-paragraph layout, and
  the tests that prove it stay green.
- Earlier decisions and plans (`planning/decisions/`, `decision-register.md`, `retained-text-assignment.md`,
  `publication-frontier.md`, `fragment-relative-reflow.md`) are history and constraints to understand, not gates.
  Where the plan in `.agents/docs/planning/segment-indexed-layout.md` departs from them, the plan wins.
- Skip `docs:attest`, per-change log records and package-size evidence here; documentation is reconciled once, at the
  end, if the branch succeeds.

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
- `pixi3d` for `@pmndrs/glyph-pixi3d` and the PixiJS 3D release it renders through;
- `gh-stack` for every dependent branch or pull-request chain;
- `codemod` only for migrations of APIs already on the default branch or released;
- `maintainability-review` for deliberate cleanups and audits;
- `evidence-first` for human-facing engineering writing.

## Code

Read the [engineering standard](.agents/docs/engineering/code-style.md) before writing or reviewing code or tests.
Validate by who can author a value: public caller input, third-party callback results, and external data once at the
boundary; trust package-owned output and prove it at the producer. Never justify a runtime guard with a test that forges
a value no production caller can supply. For TSL typing changes, start from `packages/glyph/tests/types/tsl-*.test.ts`.
Use Conventional Commit messages.

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
