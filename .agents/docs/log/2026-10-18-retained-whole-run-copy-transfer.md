---
type: Log Entry
title: 'Retain whole-run shape ownership and rebuild clusters without old copies'
generated:
  by: process:docs-new
  at: '2026-10-18T18:07:29Z'
---

The [preparation/publication contract](../planning/decisions/retained-prepare-publish.md) still uses one synchronous
Rust executor, existing ShapeArena/ClusterArena owners and packed/SoA layouts. This is a fresh current-source
combination above the current-main/dense-root wave, not recovery of an unavailable historical experiment.

For one complete old/new source run, shaped run and window, after the existing font, glyph-zero, unsafe-concatenation
and boundary proofs, preparation swaps the completed scratch arena into empty pending storage. The old pending
capacity becomes reusable scratch. The admitted case retires the whole scratch range scan, glyph-column copy and
run collapse. Partial windows, retained prefixes/suffixes, multiple runs, fallback and extra probe suffixes retain the
original append path. Committed and pending generations remain independently owned; existing failure invalidation,
commit, prepared-query and split lifetimes remain authoritative.

A successful incremental replacement of the sole whole-paragraph source run uses the existing cold ClusterArena
builder and stable-ID reconciliation instead of copying old cluster columns and overwriting their entire range.
Admission requires the authoritative Unicode grapheme count to equal UTF-16 length, bounding the existing builder's
capacity request to actual cluster cardinality. Combining and surrogate cases retain the existing helper/fallback.
No Unicode parser, speculative cache, second executor or persistent storage format is added. Final output construction
remains linear in text, clusters and glyphs. Shape ownership transfer is constant time; changed capacity distribution
can affect live/peak memory and is not assumed to save it.

Native Sol6 Medium implemented the combined wave; a fresh scoped Sol High review removed four redundant
package-owned relationship checks and found no unresolved source finding. Independent cold shape metadata and all
seven glyph lanes, full public cold-output, combining fallback, prepared reads/split, empty/sparse/RTL, boundary and
stable-ID oracles protect downstream semantics. Registered shaper tests passed 486 cases; strict all-target Clippy
passed. Actual 1,024-label Inter counters in each of two cycles report 1,024 arena transfers, 10,240 moved glyphs,
zero counted range-copied glyphs, 1,024 full cluster builds and zero copied old cluster rows. Publication repeats no
shaping, flow, positioning or query serialization. These count removed work, not elapsed savings: 10,240 ordered
rewrites/comparisons remain.

The first complete package command passed 576 native cases (one existing ignored) but failed one bounds test after
an incorrect top-layer rebase resolution. The lower layer eagerly measures on creation; the top requests its first
measurement summary on demand after durable preparation. The top test is restored byte-for-byte to its established
328aedb8 contract, counting the crossing after creation. Runtime and generated ABI sources were unchanged by that
correction. The subsequent complete package command exits0: 1,140 Node and576 native cases pass, one existing native ignored,
and static checks pass. All four Rust source and16 generated ABI hashes remain unchanged. Final artifact evidence belongs in the
[compact frontier](../planning/publication-frontier.md) as they complete; this record makes no speed or no-regression
claim before new shipping package, named-Wasm, size, memory and same-machine seven-family comparisons.

The real gh-stack chain remains #292 → #301 → #302 → draft #310, held and unmerged. Correct inconclusive variants,
raw failures and exact source identities remain preserved. No merge, release, tag or demo merge is authorized.
