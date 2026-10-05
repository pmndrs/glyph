---
type: Log Entry
title: 'Technique-contract review closure (D-250/D-251)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Closed all four adversarial-review findings on the
schema-authority stack. Policy-DSL values now carry session provenance: a value loaded from one program's input
table throws when stored through another builder instead of silently reading a shifted input. Technique schemas
deep-freeze at definition, making the documented immutability true at runtime. The remaining smear sites now
derive from schemas: `schemaPolicyBuffers` replaces hand-rolled width lists in the Three programs,
`schemaFieldTable` orders binding-table readers by the schema's declared names so a misspelled or missing reader
is a compile error, the executor resolves draw buffers by schema name instead of literal id ranges, and the
plan-program registry references the transform system buffer instead of restating `15`. Glyph-origin
augmentation became schema-declared opt-in metadata (`glyphOrigin`) rather than assuming Bitmap's buffer layout
for every technique. The structural gate now also rejects literal-width buffer builders, literal id ranges, and
restated system ids. Every policy and binding byte golden stayed pinned — the derivations reproduce the
hand-rolled bytes exactly, decided by the existing decoded-equivalence proof. The adversarial re-review then
confirmed provenance and glyph-origin closed and surfaced follow-up defects, fixed in a second pass: session
provenance is now stamped at node construction and combined in O(1) — a shared expression DAG no longer costs an
exponential graph walk, and mixing sessions fails at the combinator itself; schema definition validates the
caller's input first and returns an owned, deeply frozen copy, so rejection leaves caller data untouched and a
hostile lanes accessor can never change a validated width; the size-budget notes now record the measured deltas
(+3.5 KB raw / +1.7 KB minified per surface of real validation and derivation code) instead of claiming
comment-dominated growth; and the package reference gained `/core` and `/tsl` rows with `/three/{bitmap,msdf,slug}`
described as the compatibility aliases they are. The re-review's remaining structural finding — TSL shader lane
meaning and the external example still restate schema knowledge — is migration layers 3–4 of the technique
contract plan, scheduled with the audit.
