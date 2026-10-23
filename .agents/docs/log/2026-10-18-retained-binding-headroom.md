---
type: Log Entry
title: 'Remove duplicate placement revision counting with proved headroom'
generated:
  by: process:docs-new
  at: '2026-10-18T14:37:20Z'
---

The [accepted preparation/publication contract](../planning/decisions/retained-prepare-publish.md) retains one Rust
executor and the existing canonical packed/SoA storage. The placement binder already validates segment/count/glyph
relationships and computes the number of instances in changed segments. It previously discarded that bound, scanned
every changed glyph to count needed content revisions, then scanned those glyphs again in the writer. Existing native
dense1024 evidence counts10,240 writer visits; the exact preflight traverses those same spans. That is deterministic
work evidence from its recorded fixture, not a measured current Bitmap duration or GPU upload count.

When checked conversion and addition prove that every changed instance could receive a revision without overflow,
the binder now invokes its existing writer directly. The writer advances the cursor only for actual revision demand.
If that conservative bound cannot establish headroom, the existing exact count and pre-mutation overflow check remain,
preserving valid near-limit requests with zero or one new revision. Capacity validation and checked increments remain;
no new allocation, persistent state, cache, layout, API, ABI or executor is introduced. Both branches share one writer.
Time remains O(segments+changed glyphs), with one complete changed-glyph read pass removed on the proved branch and
O(1) additional metadata. The writer's only fallible post-mutation operation is its revision increment, which either
preflight proves cannot fail.

Native Sol6 Medium implemented the isolated change; fresh scoped Sol High review found no blocking correctness issue.
Four focused placement-binding/slot tests, pinned Rust formatting and strict all-target Clippy pass. The independent placement fixture covers conservative-bound failure with exact
zero/one demand, normal mixed masks, next_revision=0, unchanged handles and near-overflow failure before glyph, handle,
cursor or retained-state changes. Existing cold placement and downstream output oracles stay authoritative. No elapsed
gain is inferred from removing a pass.

The same coherent candidate also constructs each leaf/tree iterator result directly in its selected match arm. The
preceding iterator checkpoint `0452c639` passed the full package, pack, named and memory-parity gates. Its authenticated
shipping Wasm avoided the leaf's276-byte clear but still copied288bytes at the shared constructor exit; direct-arm
construction attempts to remove that temporary. Only a new optimized artifact can establish that outcome. The passing
first version is preserved at `refs/experiments/held-leaf-iterator-first-2026-10-18`, with package SHA-256
`b5402df7e7e5b219f927e9e72eac5b5d6576d4ed875cc768eabaa6742714debe`. Its shaper was1,593,080 raw/587,205 gzip9
bytes, +6,288/+2,118 versus request/payload checkpoint4c72fcc6, using Python gzip9 with mtime0. No timing matrix ran
for that intermediate iterator checkpoint. The full-check numeric exit was0, but its initial raw output was not fully
persisted; the gate receipt records that gap without reconstructing or rerunning it.

The combined request/payload/iterator/binding candidate now receives one final build/artifact/correctness gate and one
frozen main/published0.1.0/previous-HELD comparison with candidate reuse. No helper-by-helper timing loop is introduced.
The [compact frontier](../planning/publication-frontier.md) retains all seven families, dense priority, final API/ABI,
peer/lifetime/browser/hero/current-main integration requirements and the held, unmerged stack.
