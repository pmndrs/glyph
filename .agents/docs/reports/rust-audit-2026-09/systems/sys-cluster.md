---
type: Audit Report
title: Rust review — cluster and text-analysis state
description: Findings from the cluster and text-analysis state review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, clusters, unicode, bidi]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Cluster / text-analysis system — deep review

Scope: `shaper/src/engine/cluster_state.rs`, `shaping_state.rs`, `style_state.rs`,
`shaper/src/unicode.rs`, `bidi.rs`, `line_break.rs`. Review only, no edits made.

Every candidate defect below was traced to its actual call sites (including outside
the assigned files, in `line_composition.rs`, `positioning.rs`, `state.rs`,
`semantic_wire.rs`, `sort.rs`, `layout_units.rs`) before being kept or discarded, so
severities reflect verified blast radius, not just local code shape.

---

## C1 — `intrinsic_widths` indexes parallel columns with no length validation
**Severity:** medium   **File:** `engine/cluster_state.rs:525-568`

**What:** `intrinsic_widths` loops `0..self.starts.len()` and directly indexes
`self.flags[index]` (line 532), `self.advances[index]` (line 552), and
`self.flags[index + 1]` (line 564), with no check that `flags.len()` /
`advances.len()` actually equal `starts.len()`. Every other reader of these same
columns *outside* this file re-validates lengths before trusting them:
`line_composition.rs:292-293` re-derives the expected chunk count from
`clusters.chunk_flags_or.len()` before enabling its fast path, and
`positioning.rs:630-639` explicitly checks all six glyph-stream columns against
`glyph_ids.len()` and returns `EngineError::InvalidRequest` on mismatch.
`intrinsic_widths` has neither a `Result` return to signal a problem nor even a
`debug_assert!`.

**Why it matters:** the length equality is maintained only by convention across three
separate mutators (`build`, `rebuild_source_run_if_topology_is_stable`,
`refresh_scales_from_stream`) and is never asserted at one choke point. If a future
change to any of them (or a new mutator) grows `starts`/`ends` without growing
`flags`/`advances` in lockstep, `intrinsic_widths` — reachable directly from
`state.rs:1613` on every intrinsic-sizing query — panics via plain indexing, which is
the one failure mode the crate's "panic-free by construction" law exists to prevent.
Since `debug-assertions` is off in release, a regression here would not even fail
loudly unless a test happened to exercise the mismatched state.

**Before / After:**
```rust
// before
pub(crate) fn intrinsic_widths(&self, wrap: u8) -> IntrinsicWidths {
    let mut min_run = 0.0_f64;
    let mut max_run = 0.0_f64;
    ...
    for index in 0..self.starts.len() {
        let flags = self.flags[index];
```
```rust
// after — costs nothing in release; matches the discipline positioning.rs and
// line_composition.rs already apply to the same columns from outside this file
pub(crate) fn intrinsic_widths(&self, wrap: u8) -> IntrinsicWidths {
    debug_assert_eq!(self.flags.len(), self.starts.len());
    debug_assert_eq!(self.advances.len(), self.starts.len());
    let mut min_run = 0.0_f64;
    let mut max_run = 0.0_f64;
    ...
    for index in 0..self.starts.len() {
        let flags = self.flags[index];
```

**Confidence:** certain that the indexing is locally unguarded; likely (not certain)
that it is a live risk — tracing `state.rs`'s staging discipline
(`prepare_clusters`/`abort_clusters`, `state.rs:3093-3179`) shows every success path
keeps the columns in lockstep today. What would confirm exploitability: a
property/fuzz test driving `build()` toward the desync described in C5, then calling
`intrinsic_widths` on the result.

---

## C2 — same function silently normalizes an invalid `wrap` byte instead of rejecting it
**Severity:** low   **File:** `engine/cluster_state.rs:560-568`

**What:**
```rust
let can_break_after = match wrap {
    WRAP_WORD => flags & CLUSTER_ALLOWED_BREAK != 0,
    WRAP_CHARACTER => {
        index + 1 == self.starts.len()
            || self.flags[index + 1] & CLUSTER_SAFE_BEFORE != 0
    }
    WRAP_NONE => false,
    _ => false,
};
```
`wrap` is a raw `u8`, so the `_ => false` arm is syntactically required — but
`intrinsic_widths` returns `IntrinsicWidths`, not `Result<_, EngineError>`, so there is
no way to reject a `wrap` value outside the three named constants; it silently
measures as if `WRAP_NONE` had been requested. The sibling integer line-composer,
`layout_next_line_integer` (`line_composition.rs:241-246`), takes the same kind of
`wrap: u8` and explicitly checks `!matches!(wrap, WRAP_NONE | WRAP_WORD |
WRAP_CHARACTER)`, returning `EngineError::InvalidRequest`.

**Why it matters:** if `constraint.wrap` (the caller, `state.rs:1613`) is not already
validated before this call, a malformed wire value would make intrinsic-width
measurement silently disagree with the real line-breaking pass instead of surfacing a
caller-actionable error — "measure" and "lay out" would disagree about what a bad
`wrap` byte means, rather than both rejecting it the same way.

**Confidence:** speculative — I did not trace whether `constraint.wrap` is validated
upstream (that would live in `semantic_wire.rs`/`state.rs`, outside this review's
assigned files). What would confirm it: check whether geometry/constraint parsing
validates the wrap byte before it reaches `intrinsic_widths`; if so this is dead code,
just inconsistent with the sibling function's `Result` contract.

---

## C3 — chunk-summary and glyph-stable-id invariants are enforced only by the consumer, never the producer
**Severity:** low   **File:** `engine/cluster_state.rs:99-107` (doc), `484-513`
(`refresh_layout_units`), `850-926` (`aggregate_shape`)

**What:** the doc comments on `chunk_advance_sums`/`chunk_space_sums`/`chunk_flags_or`
(lines 103-104: "refreshed with them") and `advance_units` (lines 99-101: "must
match") state invariants that no `debug_assert!` in this file checks (grep confirms
zero `debug_assert` calls across all six files in scope). `refresh_layout_units`
computes `chunk_count` from `self.advance_units.len()` alone and trusts
`summarize_unit_chunks`'s internal `.zip(flags.chunks(...))` (line 41) to run the same
number of chunks as `advance_units.chunks(...)` — nothing checks
`self.flags.len() == self.advances.len()` before or after. Separately,
`aggregate_shape` resizes `glyph_ids`, `glyph_clusters`, `glyph_x_advances`,
`glyph_x_offsets`, `glyph_y_offsets`, `glyph_shape_flags` to `stream_len` (lines
869-880) but *deliberately* leaves `glyph_stable_ids` untouched — it's filled later by
a separate call to `assign_stable_glyph_ids`/`assign_stable_glyph_ids_in_range`
(confirmed: `glyph_stable_ids.resize` only appears at line 764, inside
`assign_stable_glyph_ids`). So `glyph_stable_ids.len() != glyph_ids.len()` is a valid,
expected state of `ClusterArena` for a window between two calls, and nothing marks
that window at the type level.

**Why it matters, and why this is "low" not "high":** I checked both invariants
against their actual readers. `line_composition.rs:292-293` re-derives the expected
chunk count from `chunk_flags_or.len()` before trusting the fast path (a violation
degrades to the scalar path, not a panic); `positioning.rs:630-639` explicitly checks
`glyph_stable_ids.len() != stream_len` and returns `InvalidRequest`; and
`state.rs:3165-3178` pairs every `build()` with `assign_stable_glyph_ids` and calls
`self.abort_clusters()` on either failing, so the unpopulated-`glyph_stable_ids`
window is never actually exposed to a caller. The current blast radius is therefore
low — this is a defense-in-depth gap, not a live bug — but the invariant lives
entirely in comments plus caller discipline spread across three files, with zero
enforcement at the one place that owns the columns.

**Before / After:**
```rust
// before — refresh_layout_units ends with no check
summarize_unit_chunks(
    &self.advance_units,
    &self.flags,
    &mut self.chunk_advance_sums,
    &mut self.chunk_space_sums,
    &mut self.chunk_flags_or,
);
Ok(())
```
```rust
// after
summarize_unit_chunks(
    &self.advance_units,
    &self.flags,
    &mut self.chunk_advance_sums,
    &mut self.chunk_space_sums,
    &mut self.chunk_flags_or,
);
debug_assert_eq!(self.flags.len(), self.advances.len());
debug_assert_eq!(self.chunk_advance_sums.len(), chunk_count);
debug_assert_eq!(self.chunk_space_sums.len(), chunk_count);
debug_assert_eq!(self.chunk_flags_or.len(), chunk_count);
Ok(())
```

**Confidence:** certain no local check exists; certain (read both call sites) that the
two consumers named above already guard defensively; likely, not exhaustively
verified, that these are the only two consumers of these five columns.

---

## C4 — bare `u32` indices cross cluster/text/glyph/style-record domains with no newtype
**Severity:** low, idiomatic   **File:** `engine/style_state.rs:106-107, 584-596`;
pattern repeats throughout `engine/cluster_state.rs`

**What:** `ResolvedStyle::language_source`/`features_source` (style_state.rs:106-107)
are plain `u32` indices into a `StyleArena::records` slice, but `ResolvedStyle` itself
carries no reference to, or type-level tag for, which `StyleArena` produced it:
```rust
pub(crate) fn resolved_language(&self, style: ResolvedStyle) -> Option<&[u8]> {
    let index = usize::try_from(style.language_source).ok()?;
    self.records.get(index).map(|source| self.language(*source))
}
```
Every call site found (`invalidation_against`, style_state.rs:217-273, which
carefully pairs `previous_storage`/`old` with `next_storage`/`new`) does pair the
right arena with the right style — I found no live misuse — but nothing in the type
system would catch a future call site resolving a style against the *wrong* arena; it
would silently return a different-but-plausible language/feature slice rather than
erroring, because `self.records.get(index)` is a checked lookup that always resolves
to *some* valid record in whatever arena `self` is.

The same shape — a bare `u32` meaning "index into a specific, unnamed collection" —
recurs for cluster indices vs. UTF-16 text offsets vs. glyph/adjacency indices vs.
style-record indices throughout `cluster_state.rs`: `break_target(&self, position:
u32, ...)` takes a text offset, `cluster_at(&self, offset: u32)` also takes a text
offset but returns a cluster index, and both sit beside `style_indexes: Vec<u32>`
(style-record indices) and `source_runs: Vec<u32>` (shaping-run indices) — four index
spaces, one representation.

**Why it matters:** this is precisely the bug class this domain is known for. A
newtype (`StyleRecordIndex(u32)`, `ClusterIndex(u32)`, `TextOffset(u32)`) at the
`ResolvedStyle`/`ClusterArena` boundary would turn an accidental cross-domain index
into a compile error instead of a silent wrong-value bug. This is a robustness/idiom
recommendation for the boundary that mixes the most arenas (style resolution), not a
report of an existing defect.

**Confidence:** certain about the representation; speculative about actual risk — no
live misuse found in this review.

---

## C5 — `build()`'s per-cluster loop interleaves fallible operations between unconditional pushes across 15 parallel `Vec`s
**Severity:** low, speculative   **File:** `engine/cluster_state.rs:213-239`

**What:** inside `for boundaries in boundaries.windows(2)`, five columns push
unconditionally (`starts`, `ends`, `advances`, `flags`, `units_per_em`), then
`style_indexes.push(u32::try_from(style_index)...?)` can early-return (line 227),
then three more columns push unconditionally (`source_runs`, `binding_handles`,
`font_handles`), then `stable_ids.push(*text_unit_ids.get(...).ok_or(...)?)` can
early-return (lines 231-235), then four more push unconditionally (`glyph_starts`,
`glyph_counts`, `shaped`, `unsafe_before`). If either `?` fired on iteration k, the
arena would end the call with some columns at length k+1 and others at length k — the
exact "N parallel columns must stay equal-length" invariant this system is built on.

**Why it matters, and why this is low/speculative:** I traced both fallible sites and
could not construct a reachable trigger in current code. `u32::try_from(style_index)`
needs more than `u32::MAX` style segments walked in one `build()` call — not a
realistic input. `text_unit_ids.get(usize::try_from(start)...)` is doubly guarded:
`text.len() == text_unit_ids.len()` is checked at function entry (line 187), and
`start` is always `< text.len()` because it comes from `unicode.grapheme_boundaries()`,
itself built by re-encoding the same validated `text`. And even if one did fire, every
call site of `build()` (`state.rs:3165-3167`) propagates the `Err` via `?` without
reading the arena further, and the *next* `prepare_clusters()` call unconditionally
clears the pending arena (`abort_clusters()`, `state.rs:3098`) before it is touched
again — so a partially-filled arena is never actually observed.

**Before / After:** independent of reachability, resolving every fallible value
before committing any push removes the class of concern for free and reads as the
more idiomatic shape for a "commit one record to N parallel columns" loop:
```rust
// before (excerpt)
self.style_indexes
    .push(u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?);
self.source_runs.push(NO_SOURCE_RUN);
self.binding_handles.push(0);
self.font_handles.push(0);
self.stable_ids.push(
    *text_unit_ids
        .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?,
);
```
```rust
// after (excerpt) — resolve fallible values first, push unconditionally after
let style_index_u32 = u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?;
let stable_id = *text_unit_ids
    .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
    .ok_or(EngineError::InvalidRequest)?;

self.style_indexes.push(style_index_u32);
self.source_runs.push(NO_SOURCE_RUN);
self.binding_handles.push(0);
self.font_handles.push(0);
self.stable_ids.push(stable_id);
```

**Confidence:** speculative for reachability (no triggering input constructed);
certain that the interleaved ordering exists as written.

---

## Reviewed and found sound (no finding)

- **`layout_units.rs` saturation bound.** `layout_units_from_scaled` clamps every
  value to ±2^53 before it ever reaches `cluster_state.rs`. That is why
  `space_sum.saturating_add(...)` (cluster_state.rs:47) and `sum_advance_units`'s plain
  scalar/SIMD accumulation (lines 57-92) can never actually saturate or overflow
  within one 64-element chunk (64 × 2^53 ≈ 2^59, well inside i64). Verified by reading
  `layout_units.rs` directly; not a live risk despite the mixed
  checked/saturating/plain style.
- **`sort.rs`'s two-pass "stable sort via unstable sort" in
  `style_state.rs::validate`** (style_state.rs:440-459). `sort::sort_pairs` is
  `sort_unstable()`, but every call site embeds either the original index or the
  *previous pass's rank* as the tuple tiebreak, which makes the composite result
  provably equivalent to one stable four-key sort. Traced by hand against
  `sort.rs`'s own doc comment; holds. Good, deliberate technique — not a defect.
- **`line_break.rs`'s `numeric_prefix_before`** (lines 470-495) looked like a
  possible O(n²) trap on first read (a backward walk invoked from `decide()` for
  every NU/PO/PR transition), but any walk terminates the moment it reaches a
  non-SY/IS character — including the *previous* trigger — so each character is
  walked at most once across all calls combined. Amortized O(n log n), not
  quadratic.
- **`unicode.rs` / `line_break.rs` direct `text[index]` indexing** in
  `decode_scalar` and the offset-table helpers (`accepts_context`,
  `class_after_spaces`) is unchecked but every call site is bounded by an invariant
  established earlier in the same construction pass (grapheme boundaries summing to
  exactly `text.len()`; `candidate_offsets`/`grapheme_scripts` growing in lockstep
  one entry per loop iteration). No panic path found.
- **`bidi.rs`** is clean throughout: checked arithmetic on every offset, binary
  searches correctly bounded, `level.saturating_add(1)` in
  `shaping_state.rs:529` is unreachable in practice since `unicode_bidi` caps
  embedding levels at 125 (UAX #9), nowhere near `u8::MAX`.
- **`style_state.rs`'s wire-length arithmetic.** `push_mutation`/`total_feature_count`
  divide `value.features.len() / 16` with no explicit `% 16 == 0` check, which looked
  like a truncation risk — but `semantic_wire.rs`'s `array(...)` constructs that slice
  from a wire `feature_count` times `FEATURE_RECORD_SIZE`, so the length is an exact
  multiple of 16 by construction; the division never actually truncates malformed
  input.
