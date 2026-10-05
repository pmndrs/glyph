---
type: Log Entry
title: 'Removed the shared files every pull request conflicted on'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T17:00:00Z'
---

Package concepts no longer store a `source_digest`. Contributors attest each changed package with `docs:attest`; CI's
`Docs report` shows attestation status per package without ever failing; and the `Sync agent docs` issue (label
`agents`) lists pending attestations and gaps for a reviewer, who verifies them with `docs:verify`
([attested docs intent](../planning/decisions/attested-docs-intent.md)). Docs are found with `docs:search` and
`docs:outline` by section and line range ([locate before reading](../planning/decisions/locate-before-reading.md)). Log entries and decisions are now one file each,
named by subject and created with `docs:new`; the 644 `log.md` entries became one file each, the D-numbered register is
frozen, and validation rejects
new register rows and unfinished scaffolds ([append-only knowledge records](../planning/decisions/append-only-knowledge-records.md)).
Package size is pull-request review evidence only: the committed-report freshness check and byte budgets are removed,
and `package-sizes.json` is a harness display snapshot refreshed at release
([package-size review evidence](../planning/decisions/package-size-review-evidence.md)).
