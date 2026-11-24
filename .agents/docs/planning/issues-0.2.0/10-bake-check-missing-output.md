---
type: Issue Record
title: 'Issue 10: glyph bake --check fails with a raw ENOENT; --yes is parsed and unused'
description: 'The direct --check path reads the requested output without handling its absence, so a missing output prints a Node stack instead of STALE_OUTPUT; --yes has never had a prompt to skip.'
status: draft
sources:
  - id: cli
    resource: ../../../../packages/glyph/src/node/cli.ts
    title: Glyph CLI
  - id: node-bake-test
    resource: ../../../../packages/glyph/tests/integration/node-bake.test.mjs
    title: Node bake integration tests
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 10: `glyph bake --check` fails with a raw ENOENT; `--yes` is parsed and unused

- **Severity:** should-fix (CI scripts call `bake:check`; a first run shows a stack trace)
- **Status:** fixed — `--check` reports a missing output or glyph map as `STALE_OUTPUT`/`STALE_GLYPH_MAP` before baking; `--yes` is removed

## What happens

```sh
glyph bake --input Inter-Regular.ttf --output missing.glb --bitmap 16 --check
# Error: ENOENT: no such file or directory, open '…/missing.glb'
#     at async open (node:internal/fs/promises:640:25) …
```

Reproduced against the built CLI. `--yes` is accepted and does nothing; its help line says "Do not prompt before
replacing an existing font", and the CLI never prompts. Found by the docs site.

## Root cause

`src/node/cli.ts:492` reads `options.output` with a bare `readFile` after baking into temporary storage; a missing
file rejects with Node's ENOENT, which `writeFailure` (`:685-691`) prints as a stack because it is not a
`NodeBakeError`. The `--glyph-map` comparison (`:501`) has the same gap. `--yes` is parsed (`:358-359`), counted as a
direct option (`:376`) and stored (`:409`); nothing reads it. It shipped as the same no-op in 0.1.0.

## Options considered

- Missing output: (1) map ENOENT to `STALE_OUTPUT`/`STALE_GLYPH_MAP` after the bake; (2) check before baking and fail
  fast. Option 2 saves a full bake whose result can only be "stale".
- `--yes`: (1) remove the flag; (2) keep it as a documented no-op. Justin wants the smallest public surface, and the
  flag has never done anything, so removing it is honest; 0.2.0 is already a breaking release.

## Chosen fix

Check that the requested output (and glyph map) exists before baking under `--check`, and report
`STALE_OUTPUT: no font exists at the requested output; run without --check to create it` (likewise
`STALE_GLYPH_MAP`). Remove `--yes` from the parser and help, and list it in the migration notes.

## Test that will prove it

`tests/integration/node-bake.test.mjs`: `--check` against a missing output exits non-zero with `STALE_OUTPUT:` and no
`ENOENT`/stack; `--yes` is an unknown argument.

## Risk

Behaviour: `--check` on a missing output still fails, now with the documented reason. API: `--yes` becomes
`Unknown argument` (migration note). Performance: one `stat` before a check bake.
