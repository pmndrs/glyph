---
type: Audit Report
title: Rust review — positioning, line breaking and flow layout
description: Findings from the positioning, line breaking and flow layout review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, layout, positioning, line-break]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Audit: positioning, line breaking, flow layout

Scope: `shaper/src/engine/{positioning,line_kernels,line_composition,flow_composition,flow_geometry,layout_units,layout_query}.rs`.
All line numbers verified against the current worktree source, not the AST facts alone.

## L1 — Chunk-64 fast path desyncs the hanging-space tracker at a required break

**Severity:** high   **File:** shaper/src/engine/line_composition.rs:280-402 (`layout_next_line_integer`)

**What:** `trailing_space_units` (line 280, "the advance of the space run currently sitting at
the end of the accumulated line") is updated on every scalar cluster (lines 398-402) but is
**not touched** by the chunk-64 fast-forward branch (lines 298-327). When a whole chunk is
skipped via `advance = next_advance; space_units = next_space_units; index += LAYOUT_CHUNK;
continue;` (lines 321-324), `trailing_space_units` is left at whatever value it held before the
skip — stale in both directions:

- If the fast-forwarded chunk's tail is one or more `CLUSTER_SPACE` clusters and the next
  scalar cluster is a `CLUSTER_REQUIRED_BREAK`, `hanging_units` (line 352-356) is computed from
  a `trailing_space_units` that never saw those clusters — **under-counted**, so the required
  break's overflow test (line 357-365) discounts less than it should and can pick an earlier
  break than the f64/scalar reference would (`layout_next_line`, the designated parity twin).
- If `trailing_space_units` was already non-zero when a fast-forwarded chunk begins with a
  non-space cluster (which should reset the run to 0, per line 401's `else { 0 }`), the stale
  value survives the skip and can be credited to a later, unrelated required break —
  **over-counted**, so the overflow test discounts more than it should and can admit content
  that overflows the line.

Both directions are silent: no panic, just a layout decision that disagrees with the file's own
parity contract ("the chunked integer fit must select byte-identical lines to the f64 reference
at every width", per the `chunked_fit_matches_the_scalar_fit_across_multi_chunk_lines` test doc).

I confirmed the two existing chunk-boundary tests do not exercise this path: the hard-break
cluster's preceding space sits at absolute cluster index 2202 (`26 mod 64`) in
`chunked_fit_matches_the_scalar_fit_across_multi_chunk_lines`, and at index 99 (`35 mod 64`) in
`integer_fit_matches_the_f64_fit_exactly_across_a_fractional_width_sweep` — neither lands the
space run against a chunk boundary, so neither test can trip this.

**Why it matters:** any `WRAP_WORD` paragraph long enough to cross a 64-cluster boundary
(`LAYOUT_CHUNK = 64`, `shaper/src/engine/cluster_state.rs:32`) that also contains an explicit
line break (hard return, `<br>`-equivalent) can silently break one word early or overflow its
container, depending on which side of the stale value it lands on. Multi-line text blocks
(addresses, chat messages, code, poetry) with wide enough columns to admit 64+ clusters before
the next explicit break are the ordinary case, not an edge case.

**Before / After:**
```rust
// line_composition.rs:298-327 (current)
if chunk_summaries
    && index.is_multiple_of(super::cluster_state::LAYOUT_CHUNK)
    && index + super::cluster_state::LAYOUT_CHUNK <= count
{
    let chunk = index / super::cluster_state::LAYOUT_CHUNK;
    let flags_or = clusters.chunk_flags_or[chunk];
    if flags_or & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) == 0 {
        let next_advance = advance.saturating_add(clusters.chunk_advance_sums[chunk]);
        let next_space_units = space_units.saturating_add(clusters.chunk_space_sums[chunk]);
        let fits = max_width_units.is_none_or(|units| { /* ... */ });
        if fits {
            /* pending_allowed / pending_safe bookkeeping */
            advance = next_advance;
            space_units = next_space_units;
            index += super::cluster_state::LAYOUT_CHUNK;
            continue; // trailing_space_units untouched
        }
    }
}
```
```rust
// Minimal, still-O(1) fix: disqualify a chunk whose first or last cluster is a
// space cluster, so the fast path only ever fires when trailing_space_units is
// provably unaffected by the skip (0 going in, 0 coming out). Two extra flag
// reads, not a chunk-sized scan.
if flags_or & (CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) == 0
    && clusters.flags[index] & CLUSTER_SPACE == 0
    && clusters.flags[index + super::cluster_state::LAYOUT_CHUNK - 1] & CLUSTER_SPACE == 0
{
    // ... unchanged fast path ...
}
// A fully general fix that keeps chunks with trailing/leading spaces fast would
// need a new per-chunk summary (e.g. `chunk_trailing_space_units`, mirroring
// `chunk_advance_sums`/`chunk_space_sums` in cluster_state.rs) so the skip can
// carry the run forward instead of just refusing it.
```
**Confidence:** certain for the code fact (the field is genuinely unwritten on the fast path);
likely for real-world impact (mechanism is unconditional once the alignment occurs; I did not
execute a repro, but hand-verified both existing tests miss it and traced the arithmetic by
hand).

## L2 — Unvalidated justify ratios can flip word-space growth into shrinkage (and vice versa)

**Severity:** high   **File:** shaper/src/engine/positioning.rs:1837-1893 (`justification_adjustment`)

**What:** `apply_ratio` (`layout_units.rs:47`) is documented as taking "a declared non-negative
ratio" but that precondition is never checked or clamped anywhere in the call chain. Two call
sites derive the ratio from caller-supplied `f32` wire fields that are read raw
(`shaper/src/wire.rs:34`, `f32::from_bits` with no range check) and never validated downstream
(confirmed by grep: `justify_min_word_space_ratio`/`justify_max_word_space_ratio` flow straight
from `semantic_wire.rs:291-300` through `constraint_typography` (positioning.rs:1716-1728) into
`JustifyControls` with no clamp):

- Expansion branch (line 1837-1841): `f64::from(controls.maximum_word_space_ratio) - 1.0` is
  only non-negative if the caller's ratio is `>= 1.0`. A caller-supplied value in `(0.0, 1.0)`
  (guarded only by `> 0.0`, which the "unbounded" sentinel `0.0` deliberately excludes) makes
  the ratio negative, so `apply_ratio` returns a **negative** `space_growth` while `deficit_units
  >= 0` (we are in the "line needs MORE space" branch). `space_growth` then wins the
  `deficit_units.min(...)` comparison, `remainder = deficit_units - space_growth` grows past the
  true deficit, and `distribute_units(space_growth, spaces)` hands back negative
  `per_space_units`/`extra_space_units` — an "expand" call that instead shrinks word spaces
  while over-growing the letter-gap channel.
- Compression branch (line 1873-1883): symmetric bug. `1.0 - f64::from(controls.
  minimum_word_space_ratio)` is only non-negative if the ratio is `<= 1.0`. A caller-supplied
  value `> 1.0` makes `capacity` negative; `shrink = (-deficit_units).min(capacity)` (with
  `-deficit_units > 0` since we're over-full) picks the negative `capacity`, and
  `distribute_units(-shrink, spaces)` distributes a **positive** total on an over-full line —
  expanding it instead of shrinking it.

Both existing tests only exercise in-contract values (`maximum_word_space_ratio: 3.0` at
positioning.rs:2256, `minimum_word_space_ratio: 0.75` at positioning.rs:2299) — the sign-flip
path is untested.

**Why it matters:** a justified (`text-align: justify`) paragraph whose caller supplies
`justify_max_word_space_ratio` in `(0, 1)` or `justify_min_word_space_ratio` in `(1, ∞)` — an
easy mistake for any binding that doesn't itself validate these fields, since nothing in the
Rust API documents or enforces the required range — gets glyphs positioned in the wrong
direction: overlapping text on an under-full justified line, or a still-overflowing line on an
over-full one. No panic; silently wrong output.

**Before / After:**
```rust
// positioning.rs:1837-1841 (current) — ratio can go negative
let space_growth = if controls.maximum_word_space_ratio > 0.0 {
    deficit_units.min(super::layout_units::apply_ratio(
        span.space_advance_units,
        f64::from(controls.maximum_word_space_ratio) - 1.0,
    ))
} else {
    deficit_units
};
```
```rust
// Guard matches the field's actual contract (ratio expresses growth, so it
// must be >= 1.0 to mean anything); anything else falls back to "uncapped"
// exactly like the documented 0.0 sentinel.
let space_growth = if controls.maximum_word_space_ratio > 1.0 {
    deficit_units.min(super::layout_units::apply_ratio(
        span.space_advance_units,
        f64::from(controls.maximum_word_space_ratio) - 1.0,
    ))
} else {
    deficit_units
};
```
Mirror the fix on the compression branch (`controls.minimum_word_space_ratio > 0.0 &&
controls.minimum_word_space_ratio <= 1.0`), and consider a `debug_assert!(ratio >= 0.0)` inside
`apply_ratio` itself so any future call site reintroducing this class of bug fails loudly in
debug/test builds (it compiles out of release, so this is not proposing runtime cost — see
`layout_units.rs`'s own rounding-contract doc comment for the established pattern).

**Confidence:** certain for the arithmetic (hand-traced both branches); likely for reachability
— it depends on a caller actually supplying an out-of-contract ratio, which nothing in the Rust
layer prevents or documents, and I did not check whether a non-Rust binding layer clamps this
before it reaches the engine.

## L3 — `MEASUREMENT_FLAG_INK_BOUNDS` is cleared for an all-blank-lines paragraph even when positioning ran

**Severity:** medium   **File:** shaper/src/engine/layout_query.rs:397 (`append_measurement`)

**What:**
```rust
let ink_measured = !positioned_glyphs.is_empty() || (include_glyphs && line_count == 0);
```
The doc comment on `MEASUREMENT_FLAG_INK_BOUNDS` (layout_query.rs:24-27) states the bit should
be set whenever positioning ran, even if it positioned zero glyphs ("a paragraph that positioned
zero glyphs still sets the bit and reports a degenerate box"). The implementation only covers
that case when `line_count == 0` (a paragraph with no lines at all). A paragraph that has one or
more lines but whose lines are *entirely* hard-break clusters (e.g. text that is just `"\n"` or
`"\n\n"`) produces `line_count > 0` — `flow_composition.rs`'s `compose_band` (lines 481-492)
pushes a `FlowFragment` even for the trailing empty line (`cluster_start == cluster_end`), and
`visible_glyph_counts`'s own comment confirms positioning "skips hard-break clusters before its
glyph walk" — so `positioned_glyphs` can legitimately be empty while `line_count > 0`. In that
combination, with `include_glyphs = true` (which per its only caller, `state.rs:1699-1719`, is
only ever true when `positioned_matches_flow` is true, i.e. a real positioning pass just ran),
the formula yields `false` — the ink box is reported as *absent* rather than the documented
*degenerate present* box.

**Why it matters:** a caller asking for layout inspection on a paragraph consisting solely of
blank lines gets a result that says "ink was never measured" when positioning genuinely ran and
correctly found nothing. Any consumer that branches on this flag (e.g., to decide whether to
trust a zero-size ink box vs. fall back to a font-metrics estimate) gets the wrong branch for
this specific, real content shape (blank paragraphs/lines are common in editors).

**Before / After:**
```rust
// current
let ink_measured = !positioned_glyphs.is_empty() || (include_glyphs && line_count == 0);
```
```rust
// matches the doc comment: authoritative whenever this query ran positioning,
// regardless of how many lines or glyphs resulted
let ink_measured = include_glyphs || !positioned_glyphs.is_empty();
```
**Confidence:** likely. The formula mismatch against its own doc comment is certain; I traced
`include_glyphs`'s only call site to confirm it implies a real positioning pass, and traced
`compose_band` to confirm a hard-break-only line still yields a fragment — but I did not execute
a repro to observe the flag on a live "\n"-only paragraph.

## L4 — `assign_content_revision`'s `.expect()` depends on a non-local invariant

**Severity:** low   **File:** shaper/src/engine/positioning.rs:1299-1304 (`assign_content_revision`)

**What:**
```rust
let change_mask = previous_slot.map_or(ALL_SEMANTIC_CHANGES, |previous_slot| {
    self.semantic_change_mask(slot, previous, previous_slot)
});
let revision = if change_mask == 0 {
    previous.glyphs[previous_slot.expect("zero change requires a previous glyph")]
        .content_revision
```
This is currently safe — `change_mask == 0` can only be reached when `previous_slot` was `Some`,
because the `None` arm of `map_or` always yields the non-zero `ALL_SEMANTIC_CHANGES` — but the
proof lives in a *different expression* three lines up rather than in the type. This is exactly
the "0 production unwrap()" law the rest of the file otherwise upholds (the AST scan flags this
as the one `panicky` call in the whole review scope). A later refactor of either the `map_or`
default or the `if change_mask == 0` condition could silently reintroduce a reachable panic under
`panic = "abort"`, where nothing unwinds.

**Before / After:**
```rust
// current: safety is a non-local proof
let change_mask = previous_slot.map_or(ALL_SEMANTIC_CHANGES, |previous_slot| {
    self.semantic_change_mask(slot, previous, previous_slot)
});
let revision = if change_mask == 0 {
    previous.glyphs[previous_slot.expect("zero change requires a previous glyph")].content_revision
} else { /* ... */ };
```
```rust
// after: safety is structural — match on previous_slot once, no expect()
let revision = match previous_slot {
    Some(previous_slot) if self.semantic_change_mask(slot, previous, previous_slot) == 0 => {
        previous.glyphs[previous_slot].content_revision
    }
    _ => {
        let revision = *next_revision;
        *next_revision = next_revision.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
        revision
    }
};
// change_mask still needs recording into self.semantic_change_masks; hoist the
// mask computation out of the match arm guard if it's needed on both paths.
```
**Confidence:** certain (not a live bug today, purely a fragility/maintainability note).

## L5 — `apply_opacity` truncates instead of clamping when `opacity > 1.0`

**Severity:** low   **File:** shaper/src/engine/positioning.rs:1375-1379 (`apply_opacity`)

**What:**
```rust
fn apply_opacity(rgba: u32, opacity: f32) -> u32 {
    let alpha = ((rgba >> 24) & 0xff) as f32;
    let resolved = (alpha * opacity + 0.5) as u32;
    (rgba & 0x00ff_ffff) | (resolved << 24)
}
```
`resolved` is not clamped to `0..=255` before `resolved << 24`. Rust's float-to-int cast
saturates (so negative `opacity` is already safe, floors to 0), but `opacity > 1.0` with a large
`alpha` can push `resolved` above 255 (e.g. `alpha=255, opacity=2.0` gives `resolved=510 =
0x1FE`). The shift by 24 keeps only the low 8 bits inside the `u32`, so the 9th bit is silently
discarded and the alpha byte comes out as `0xFE` (254) — a truncation artifact, not the
presumably-intended saturate-at-255 or an error.

**Why it matters:** cosmetic (a slightly wrong alpha channel) rather than structural, and depends
on an out-of-`[0,1]` `opacity` reaching here — same unvalidated-external-`f32` pattern as L2, in
a different field.

**Before / After:**
```rust
let resolved = (alpha * opacity + 0.5) as u32;
```
```rust
let resolved = ((alpha * opacity + 0.5) as u32).min(0xff);
```
**Confidence:** certain for the arithmetic; speculative on whether `style.opacity` can actually
reach this function outside `[0,1]` in practice (did not trace its wire/resolve path).

## L6 — `polygon_section` silently drops an unpaired crossing

**Severity:** low   **File:** shaper/src/engine/flow_geometry.rs:335-344 (`polygon_section`)

**What:** `crossings.chunks_exact(2)` pairs up scanline crossings into slots; `chunks_exact`
silently ignores a trailing element if `crossings.len()` is odd. For a simple (non-self-intersecting)
polygon a horizontal scanline always produces an even number of boundary crossings, so this is
fine for well-formed input. A self-intersecting or degenerate caller-supplied polygon (region or
exclusion vertices arrive from the host/JS side with no simplicity check visible in this file)
could produce an odd count, and the last crossing would be dropped rather than erroring —
producing a subtly wrong wrap shape rather than a rejected request.

**Why it matters:** low — this is a best-effort geometry fallback already documented as
conservative elsewhere in the same file (`concave_region_and_polygon_exclusion_resolve_
conservatively`), and requires malformed input, not ordinary text content.

**Confidence:** speculative — I did not verify whether polygon simplicity is validated upstream
of this function (outside this review's file scope) before vertices reach here.

---

## What's solid

- `layout_units.rs`'s rounding contract (`saturating_floor_units`, `apply_ratio`) is exact,
  well-tested (half-up rounding, monotonicity, totality under NaN/±inf), and its `saturating_*`
  uses in `line_composition.rs`/`flow_composition.rs` are deliberate, documented, and covered by
  an explicit saturation test (`integer_fit_saturates_extreme_caller_derived_advance_sums`) — not
  findings.
- `line_kernels.rs`'s SIMD transition/flag scanners have sound bounds proofs on every `unsafe`
  load and are cross-checked against a scalar oracle under `kernel-lab`.
- `reorder_l2` correctly implements UAX #9 L2 (verified by hand against its own test).
- `flow_positioning_equivalent`/`positioned_fragment_advance`/`position_fragment` all resolve
  through the single `justification_adjustment`/`fragment_pen` definitions the file documents as
  the "ONE definition of that arithmetic" — the apparent duplication between the measurement-only
  path (`layout_query.rs`) and the full positioning path is real but deliberately centralized and
  parity-tested, not a DRY violation.
