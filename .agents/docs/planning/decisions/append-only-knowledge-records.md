---
type: Decision
title: 'Log entries and decisions are one file each'
description: 'Each log entry and each decision is its own file named by subject, so concurrent pull requests never edit a shared record file.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T16:45:27Z'
---

# Log entries and decisions are one file each

## Decision

Record knowledge-bundle chronology as one file per change in `.agents/docs/log/`, named `YYYY-MM-DD-<slug>.md`, with
one H1 title and flat prose. Record each new decision as one file in `.agents/docs/planning/decisions/`, named by its
subject slug with no number prefix, typed `Decision`, with a `decision_status` of Proposed, Experiment, Deferred,
Accepted, or Superseded, a quoted `decided` date, optional `supersedes` naming D-IDs or slugs, and its rule under
`## Decision`. Create both with `mise exec -- pnpm scripts run docs:new`; read them newest first with `docs:list`.
`log.md` and the D-numbered decision register are frozen history: the register declares `frozen_after: D-372`, and
validation rejects any row past it.

## Why

Every pull request prepended to `log.md` and appended a `D-<next>` row to the decision register, so concurrent pull
requests conflicted on the same lines and raced for the same number. The register's padded tables made it worse: one
long row reformatted every row of its table. One file per record, named by its subject rather than a shared counter,
means two changes only collide when they record the same subject, which is a real conflict worth seeing. Listings are
derived on demand, so no shared index needs maintaining.

## Consequences

Existing D-IDs stay valid and referenced as they are; nothing is renumbered. A new decision that replaces a register
row names it in `supersedes`. Validation rejects unfinished `docs:new` scaffolds, so a record cannot merge with
placeholder text. Agent-facing instructions point at `docs:new` instead of the frozen files.
