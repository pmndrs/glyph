---
type: Decision
title: 'Concept freshness is a drift issue, not a stored pin'
description: 'Workspace Package concepts store no source pin; drift is measured from git history and tracked in one rewritten issue.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T16:45:27Z'
---

# Concept freshness is a drift issue, not a stored pin

## Decision

A Workspace Package concept stores no `source_digest`. Validation enforces coverage only: exactly one concept per
package with matching `workspace_package`, `resource`, type, and documentation type, and it rejects the retired field.
A concept has drifted when non-merge commits change its package source, excluding build and dependency output, after
the last commit that touched the concept. `docs:drift` reports that drift, and the `Docs drift` workflow rewrites one
`docs-drift` issue on every push to `main` and daily: it reopens the issue on drift and closes it once every concept is
current. A scheduled maintenance agent resolves the open issue in one pull request; a review that finds a concept
already correct is recorded by updating its `generated.at`.

## Why

The stored digest hashed the whole package tree, so any two pull requests that touched the same package conflicted on
one line, and every merge forced the next pull request to rebase and re-pin. It also enforced no review: the commit
hook re-pinned the digest automatically. History already records when a concept was last edited and what changed
since, so freshness can be measured without storing anything that concurrent changes would fight over.

## Consequences

Pull requests stop conflicting on concept pins and no longer fail on concept freshness. Documentation still belongs
in the same change as source where an author knows it is affected; the drift issue catches what was missed. The
pre-commit hook only validates the staged bundle. `docs:update` and `generate-package-digests.mjs` are removed.
Drift measurement needs full git history.
