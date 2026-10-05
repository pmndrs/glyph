---
type: Decision
title: 'Package size is pull-request review evidence'
description: 'Package size is reviewed from the pull-request size comparison; it neither fails a pull request nor lives in a file every pull request rewrites.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T16:45:28Z'
---

# Package size is pull-request review evidence

## Decision

Package size is pull-request review evidence. CI's `Package size report` job measures head and base on the same runner
and comments the delta; reviewers flag anything abnormal from that comment. No check fails a pull request on package
size: the committed-report freshness check and the reviewed byte budgets are removed. `benches/src/generated/package-sizes.json`
is only the benchmark harness's display snapshot. `pnpm size` prints measurements without writing it, and only
`release:size:generate` refreshes it, during release preparation.

## Why

The freshness check required every runtime change to regenerate a SHA-256-identified report, so every such pull
request conflicted with every other on the same generated file, and the budgets failed pull requests for growth that
a reviewer had to judge anyway. The same-runner head-versus-base comparison already gives reviewers the exact delta
without either cost.

## Consequences

Size growth is caught at review rather than mechanically. The harness may show sizes up to one release old. The
removed budgets' ceilings, cited by earlier decisions such as the shaper raw budget in D-372, no longer gate anything; D-372's break-correction decision otherwise stands.
