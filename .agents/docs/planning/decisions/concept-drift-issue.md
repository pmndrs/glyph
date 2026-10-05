---
type: Decision
title: 'Docs freshness and validity are advisory, not merge gates'
description: 'Concepts store no source pin; a pull-request comment reports what to review and fix, and one rewritten issue carries anything merged unresolved.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T16:45:27Z'
---

# Docs freshness and validity are advisory, not merge gates

## Decision

A Workspace Package concept stores no `source_digest`. Validation enforces coverage only: exactly one concept per
package with matching `workspace_package`, `resource`, type, and documentation type, and it rejects the retired field.
A concept has drifted when non-merge commits change its package source, excluding build and dependency output, after
the last commit that touched the concept. `docs:drift` reports that drift, and the `Docs drift` workflow rewrites one
`Sync agent docs` issue, labelled `agents`, on every push to `main` and daily: it reopens the issue on drift and closes it once every concept is
current. A scheduled maintenance agent resolves the open issue in one pull request; a review that finds a concept
already correct is recorded by updating its `generated.at`.

Docs checks never fail CI. On each pull request the `Docs report` job runs `docs:drift -- --pr <base>`: it lists the
packages whose source the pull request changes without touching their concept, plus every validation finding, each
with the command that fixes it, in the job summary and in one comment it rewrites (posted only once there is something
to say). A maintainer may merge with items open; the `Sync agent docs` issue also lists validation findings on `main`, so
the maintenance agent resolves drift and invalid docs together.

## Why

The stored digest hashed the whole package tree, so any two pull requests that touched the same package conflicted on
one line, and every merge forced the next pull request to rebase and re-pin. It also enforced no review: the commit
hook re-pinned the digest automatically. History already records when a concept was last edited and what changed
since, so freshness can be measured without storing anything that concurrent changes would fight over.

## Consequences

Pull requests stop conflicting on concept pins and no longer fail on concept freshness or bundle validity, so
documentation upkeep never stands between a reviewed change and its merge. Documentation still belongs
in the same change as source where an author knows it is affected; the drift issue catches what was missed. The
pre-commit hook prints the same advisory report for the staged change, naming each concept to review and the command
that records it, and never blocks the commit. `docs:update` and `generate-package-digests.mjs` are removed.
Drift measurement needs full git history.
