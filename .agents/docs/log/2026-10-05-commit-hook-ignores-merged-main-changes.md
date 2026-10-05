---
type: Log Entry
title: 'Commit hook ignores changes a merge of main brings in'
generated:
  by: process:docs-new
  at: '2026-10-05T19:18:33Z'
---

Merging `main` into a pull-request branch staged every file `main` changed, and the docs report diffed the index against
`HEAD`, so the commit hook listed packages only `main` touched as missing. The hook now compares the index with the
newest merge base of the default branch, counting `MERGE_HEAD` during a merge, so it reports only what the branch
changed. See [attested docs intent](../planning/decisions/attested-docs-intent.md).
