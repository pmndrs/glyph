---
type: Log Entry
title: 'Removed the shared files every pull request conflicted on'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T17:00:00Z'
---

Package concepts no longer store a `source_digest`: `docs:drift` measures freshness from git history and the
`Docs drift` workflow keeps one `docs-drift` issue current for a scheduled maintenance agent
([concept drift issue](../planning/decisions/concept-drift-issue.md)). Log entries and decisions are now one file each,
named by subject and created with `docs:new`; `log.md` and the D-numbered register are frozen, and validation rejects
new register rows and unfinished scaffolds ([append-only knowledge records](../planning/decisions/append-only-knowledge-records.md)).
Package size is pull-request review evidence only: the committed-report freshness check and byte budgets are removed,
and `package-sizes.json` is a harness display snapshot refreshed at release
([package-size review evidence](../planning/decisions/package-size-review-evidence.md)).
