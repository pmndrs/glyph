---
type: Log Entry
title: 'Single-owner preparation transaction'
generated:
  by: process:docs-new
  at: '2026-10-22T14:55:00Z'
---

The [single-owner transaction wave](../../../benches/reports/held-single-owner-local-2026-10-22/README.md) removes repeated text/style owner routing, the old-text seed for validated full replacements, empty frame-section work, and redundant stage commits for settled publication owners. It preserves the [preparation/publication contract](../planning/decisions/retained-prepare-publish.md): synchronous prepared inspection, independent split, one semantic executor and deferred renderer publication.

Native Sol Medium implementors and a fresh scoped Sol High review produced the candidate; native Luna ran all requested gates. The complete Glyph package check passed after strict-lint corrections and an isolated cold-oracle roundtrip fix. Initial failures are retained in local receipts. Independent wire bytes, cold output, malformed input, foreign owners, publication rejection/retry and split disposal coverage remain. The exact frozen archive is `06fe22b7f05dceb27f59b2e82d33fab541c8cee04c37b1a1ccdf078f6ecdc9be`; shipping Wasm `66e6c46357030d8457a8568af303d8552b16a68f0c3815877d01d634996bbffb` matches the executable sections of named `c94120f523f9022eaac87733822df4cf1836ad73fc4ad0228f5fdebb03ed4f36`.

The original four V3 files were verified against preserved `aac036f938fbeff63c4b2dfe74dd781205c2b14f` and saved as an exact binary patch before restoring the submitted baseline. Current main `4e25a96a` is already an ancestor, so the earlier integration warning is stale. No acceptance timing has run at this checkpoint; parity remains unproved. The latest user instruction stops optimization at verified seven-family parity or better, replacing the prior post-parity boost allowance. Keep #292 → #301 → #302 → draft #310 held and unmerged.
