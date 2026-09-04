---
type: Audit Report
title: Rust review — engine state, frames and font binding
description: Findings from the engine state, frames and font binding review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, state, frames, fonts]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Engine state/frame/font-binding review

Scope: `shaper/src/engine/{state,frame,frame_wire,font_binding,font_binding_wire,semantic_view,mod}.rs`.
No `shaping_run.rs` exists; the run-splitting/fallback logic lives in `state.rs` (`prepare_shape`,
`try_prepare_incremental_shape`, `prepare_boundary_candidate`, and the free functions around line 3800-4140) and was
reviewed as part of this scope.

---

## E1 — `dispose_font_binding` has no in-use guard; its siblings all do
**Severity:** high   **File:** `shaper/src/engine/state.rs:351-360`, `shaper/src/wasm.rs:204-212`

**What:** Three resource kinds in `TextEngine` are disposable while potentially still referenced:
codecs, font stacks, and font render bindings. Two of the three check for live references before disposing
and report a conflict status; the third does not.

- `dispose_codec` (state.rs:502-515): checks `self.planners.values().any(|p| p.codec_binding...)`, returns
  `Err(EngineError::RegistrationInUse)` if in use.
- `dispose_font_stack` (state.rs:436-450): checks `self.planners.values().any(|p| p.references_font_stack(handle))`,
  returns `Err(EngineError::RegistrationInUse)` if in use.
- `pmndrs_glyph_shaper_dispose_font` (wasm.rs:99-111): checks `state.engine.references_shaping_font(handle)`,
  returns `STATUS_FONT_IN_USE` if in use.
- `dispose_font_binding` (state.rs:351-360): unconditionally `swap_remove`s the binding. Its signature is
  `fn dispose_font_binding(&mut self, handle: u32)` — returning `()`, not `Result<(), EngineError>` — so it has no
  channel to report "in use" even if it wanted to. `pmndrs_glyph_engine_dispose_font_binding` (wasm.rs:204-212)
  calls it and always returns `STATUS_OK`.

The exact predicate this disposal needs already exists and is unit-tested, but is wired to nothing in production:
`references_binding` (state.rs:464-468, `self.font_stacks.iter().any(|stack| stack.fonts.contains(&handle))`) is
called only from a test (state.rs:4402, 4409) that is actually exercising `dispose_font_stack`'s side effect, not
`dispose_font_binding`.

**Why it matters:** A host can dispose a `FontRenderBinding` (the technique-specific glyph/strike/resource tables
registered via `pmndrs_glyph_engine_register_font_binding`) while a font stack still lists it and a live paragraph
still resolves through that stack. The disposal call reports success. The break surfaces later, on an unrelated
frame: `find_font_binding` (state.rs:3830-3838) is used with `?` from `prepare_shape` (state.rs:2785),
`prepare_boundary_candidate`'s fallback loop (state.rs:2873, 3968), and the retained-gather glyph walk
(`codec_gather.rs:334`, `binding_for_font(...).ok_or(GatherError::FontBindingMissing)`) — any of these now fail for
a paragraph that did nothing wrong, with no link back to the disposal that caused it. Two further sharp edges:
`find_font_binding` reports a missing *binding* as `EngineError::FontStackMissing` (state.rs:3837) — the same
variant `find_font_stack` uses for a missing *stack* (state.rs:3827) — so the host cannot tell which registration
actually broke from the status code. And because retained/incremental paragraphs skip re-shaping when text/style
are unchanged, a paragraph shaped *before* the disposal can carry a stale `binding_handle` in its `ClusterArena`
for an arbitrary number of frames before anything re-touches it and surfaces the failure.

**Before / After:**
```rust
// state.rs:351 — today, no guard, no error channel
pub fn dispose_font_binding(&mut self, handle: u32) {
    if let Some(index) = self
        .font_bindings
        .iter()
        .position(|binding| binding.handle == handle)
    {
        self.font_bindings.swap_remove(index);
        self.invalidate_gather_cache();
    }
}
```
```rust
// after — same shape as dispose_font_stack / dispose_codec
pub fn dispose_font_binding(&mut self, handle: u32) -> Result<(), EngineError> {
    if self.references_binding(handle) {
        return Err(EngineError::RegistrationInUse);
    }
    if let Some(index) = self
        .font_bindings
        .iter()
        .position(|binding| binding.handle == handle)
    {
        self.font_bindings.swap_remove(index);
        self.invalidate_gather_cache();
    }
    Ok(())
}
```
`pmndrs_glyph_engine_dispose_font_binding` would then map `Err` to `STATUS_FONT_IN_USE`/`STATUS_REGISTRATION_IN_USE`
exactly as `pmndrs_glyph_engine_dispose_font_stack` already does for its `Result`.

**Confidence:** certain. Both call chains were read end to end; `references_binding` exists, is correct, and is
simply never called from the disposal path. Whether a host actually hits this in practice (disposes a binding a
live stack still lists) depends on host-side discipline this Rust layer cannot see — the finding is that the engine
does not enforce the invariant it enforces everywhere else, not that it has been observed to misfire.

---

## E2 — Batch paragraph removal is O(n) per removed paragraph, not O(n) total
**Severity:** medium   **File:** `shaper/src/engine/state.rs:2009-2029` (`abort_lifecycle`), `2031-2062`
(`commit_paragraphs`)

**What:** `PlannerState.paragraphs` is kept sorted by id on purpose — `paragraph`/`paragraph_mut` (state.rs:1825-1837)
binary-search it, and `prepare_upsert` (state.rs:1951-1985) inserts new entries at the binary-searched position to
preserve that order. Both `abort_lifecycle` and `commit_paragraphs` remove doomed entries with a `while` loop calling
`self.paragraphs.remove(index)` one at a time:
```rust
let mut index = 0;
while index < self.paragraphs.len() {
    if self.paragraphs[index].pending_remove {
        let paragraph = self.paragraphs.remove(index);   // shifts every later element
        ...
    } else {
        index += 1;
    }
}
```
`Vec::remove` is O(n − index); removing k paragraphs this way from a vector of n is O(k·n) worst case, not O(n).

**Why it matters:** the engine is explicitly retained/incremental for large paragraph counts (virtualized
documents, many-paragraph roots). A frame that removes or creates many paragraphs at once — clearing a document,
scrolling a virtualized view past a large window — pays O(n²) in `commit_paragraphs`/`abort_lifecycle` even though
the surrounding design already maintains the one thing (`paragraphs` sorted by id) that would make a single linear
`retain`-style pass sufficient.

**Before / After:**
```rust
// before (commit_paragraphs, state.rs:2039-2054) — O(n) shift per removed paragraph
let mut index = 0;
while index < self.paragraphs.len() {
    if self.paragraphs[index].pending_remove {
        let paragraph = self.paragraphs.remove(index);
        if self.spare_paragraph.is_none() {
            self.spare_paragraph = Some(paragraph.state);
        }
    } else {
        let paragraph = &mut self.paragraphs[index];
        if let Some(order) = paragraph.pending_order.take() {
            paragraph.order = order;
        }
        paragraph.created = false;
        index += 1;
    }
}
```
```rust
// after — one linear pass; order is preserved because retain_mut is stable
let mut took_spare = self.spare_paragraph.is_some();
self.paragraphs.retain_mut(|paragraph| {
    if paragraph.pending_remove {
        if !took_spare {
            // still needs the owned ParagraphState out of `paragraph`; a `retain`-based
            // rewrite needs a small helper (e.g. mem::take + Default, or a first single-pass
            // scan that extracts exactly one victim for the spare slot) since retain_mut only
            // exposes `&mut RetainedParagraph`, not ownership of the dropped entries.
            took_spare = true;
        }
        return false;
    }
    if let Some(order) = paragraph.pending_order.take() {
        paragraph.order = order;
    }
    paragraph.created = false;
    true
});
```
The sketch above shows the shape of the fix; recovering exactly one removed paragraph's owned `ParagraphState` for
the spare-reuse pool needs either a small first pass (find the first `pending_remove` index, `remove` just that one,
then `retain_mut` the rest) or restructuring `spare_paragraph` reuse — the point is the O(n) shift-per-removal should
not repeat once per doomed paragraph.

**Confidence:** likely. The O(n)-per-`remove` cost and the sorted-vec invariant are both directly confirmed in the
code. Whether this is a *measured* hot spot depends on how many paragraphs typical hosts remove per frame, which
this review can't observe; a benchmark with a large paragraph count and a multi-paragraph removal batch would
confirm the practical impact.

---

## E3 — `reset_for_reuse` calls the same nine `Staged::abort()`s twice
**Severity:** low   **File:** `shaper/src/engine/state.rs:2066-2172`

**What:** `reset_for_reuse` clears every stage of a pooled `ParagraphState` for reuse. Nine `.abort()` calls in its
second half duplicate a call already made in its first half, in the same function, with nothing in between that
could make the second call meaningful:

| First call | Duplicate |
|---|---|
| `self.styles.abort();` — line 2091 | line 2158 |
| `self.unicode.abort();` — line 2097 | line 2160 |
| `self.bidi.abort();` — line 2104 | line 2161 |
| `self.shaping_runs.abort();` — line 2110 | line 2162 |
| `self.shape.abort();` — line 2116 | line 2163 |
| `self.clusters.abort();` — line 2123 | line 2164 |
| `self.geometry.abort();` — line 2129 | line 2169 |
| `self.flow_layout.abort();` — line 2135 | line 2170 |
| `self.positioned.abort();` — line 2149 | line 2171 |

**Why it matters:** `Staged::abort()` is presumably idempotent (nothing here suggests otherwise — the buffers were
already `.clear()`'d immediately before each first call), so this is very unlikely to be a correctness bug. It is a
clear maintainability smell: the trailing block (lines 2154-2171) reads as a later addition — it also carries the
scratch-buffer clears and fingerprint resets that genuinely are new (`style_nesting_scratch`, `geometry_fingerprint`,
`speculative_text_fingerprint`, etc.) — pasted in without removing the `.abort()` calls it duplicates. Left alone,
the next person to touch this function has to re-derive which of the eighteen `.abort()`-shaped lines are load-bearing.

**Before / After:**
```rust
// before — lines 2154-2171, nine of these ten statements repeat one already made above
self.style_mutation_scratch.clear();
self.style_order_scratch.clear();
self.style_nesting_scratch.clear();
self.style_resolution_scratch.clear();
self.styles.abort();               // duplicate of line 2091
self.style_invalidation = StyleInvalidation::default();
self.unicode.abort();              // duplicate of line 2097
self.bidi.abort();                 // duplicate of line 2104
self.shaping_runs.abort();         // duplicate of line 2110
self.shape.abort();                // duplicate of line 2116
self.clusters.abort();             // duplicate of line 2123
self.geometry_fingerprint = 0;
self.pending_geometry_fingerprint = 0;
self.speculative_text_fingerprint = 0;
self.speculative_style_fingerprint = 0;
self.geometry.abort();             // duplicate of line 2129
self.flow_layout.abort();          // duplicate of line 2135
self.positioned.abort();           // duplicate of line 2149
```
```rust
// after — keep only the statements with no earlier duplicate
self.style_mutation_scratch.clear();
self.style_order_scratch.clear();
self.style_nesting_scratch.clear();
self.style_resolution_scratch.clear();
self.style_invalidation = StyleInvalidation::default();
self.geometry_fingerprint = 0;
self.pending_geometry_fingerprint = 0;
self.speculative_text_fingerprint = 0;
self.speculative_style_fingerprint = 0;
```
**Confidence:** certain — read directly, both halves are in the same function with no intervening mutation of the
relevant `Staged` fields.

---

## E4 — `EngineError::fault()`'s catch-all can silently drop a future variant's attribution
**Severity:** low   **File:** `shaper/src/engine/state.rs:106-117`

**What:**
```rust
pub fn fault(self) -> FrameFault {
    match self {
        Self::StyleRangeInvalid(fault)
        | Self::StyleSplitsCluster(fault)
        | Self::StyleNestingInvalid(fault)
        | Self::StyleRootInvalid(fault)
        | Self::StyleFontStackMissing(fault)
        | Self::FontMetricsMissing(fault) => fault,
        _ => FrameFault::default(),
    }
}
```
This is the only `_ =>` in production `state.rs`. It enumerates the six `FrameFault`-carrying variants and defaults
everything else. `map_fault` (state.rs:119-129), right next to it, instead enumerates the same six variants and
passes everything else through unchanged with `other => other` — which is correct for *any* variant, present or
future, since "not a fault-carrying variant" needs no special handling there. `fault()`'s `_` arm is different in
kind: it is reachable by construction any time `EngineError` gains a seventh fault-carrying variant and the author
forgets to add it here.

**Why it matters:** `FrameFault`'s own doc comment (state.rs:35-42) states "neither identifier is ever legitimately
zero," and its default is the documented "not attributed" sentinel. A future fault-carrying `EngineError` variant
left out of this match would silently report `(paragraph_id: 0, style_id: 0)` instead of failing to compile —
exactly the class of bug an exhaustive match without `_` exists to prevent at zero runtime cost.

**Before / After:**
```rust
// after — compiler forces a decision when a new variant is added
_ => FrameFault::default(),
```
```rust
Self::InvalidHandle
| Self::HandleConflict
| Self::CodecMissing
| Self::FontStackMissing
| Self::RootConflict
| Self::RootMissing
| Self::RevisionConflict
| Self::RevisionExhausted
| Self::InvalidRequest
| Self::ResultTooLarge
| Self::RegistrationInUse => FrameFault::default(),
```
**Confidence:** certain the pattern exists as shown; the future-proofing benefit is the standard argument against
catch-alls on a closed, evolving enum, not a bug that has fired.

---

## E5 — Incremental-reshape fast path bypasses the fallback-span reserve *and* merge
**Severity:** low   **File:** `shaper/src/engine/state.rs:3056-3070` vs. `4067-4086`

**What:** Every other place that grows `fallback_spans`/`pending_fallback_spans` goes through
`push_fallback_span` (state.rs:4067-4086), which does two things: coalesces the new span into the previous one when
they're adjacent and share `(source_run, font_index, binding_handle, font_handle)`, and otherwise does a
`try_reserve(1)`-guarded push. `try_prepare_incremental_shape` — the fast path taken on small, in-run text edits —
builds its remap of `self.fallback_spans` with a raw push instead:
```rust
for span in self.fallback_spans.iter().copied() {
    let (text_start, text_end) = if span.source_run == affected_source_run {
        (new_run.text_start, new_run.text_end)
    } else {
        (map_old_offset(span.text_start, edit)?, map_old_offset(span.text_end, edit)?)
    };
    self.pending_fallback_spans.push(FallbackSpan { text_start, text_end, ..span });   // raw push
}
```
**Why it matters:** this is a straight 1:1 remap of an existing, already-reserved-for list (the run count cannot
grow on this path — `try_prepare_incremental_shape` requires `old_runs.len() == new_runs.len()`, state.rs:2946 —
so `pending_fallback_spans` ends this loop at exactly `self.fallback_spans.len()`, which was itself built under the
capacity `reserve_root_text`/`reserve_text` already granted). In today's code this is very likely always within
capacity, so the missing `try_reserve` is a latent inconsistency rather than a live bug. The missing *merge* is the
more concrete effect: an edit that shifts offsets without changing topology can leave `pending_fallback_spans` less
coalesced than the from-scratch path in `prepare_shape` would have produced for the same logical spans (harmless
for correctness — any consumer iterating spans gets the same shaping input either way — but it is the one place in
the struct where this list's invariant, "adjacent compatible spans are merged," is not maintained by construction.

**Before / After:**
```rust
// before
self.pending_fallback_spans.push(FallbackSpan { text_start, text_end, ..span });
```
```rust
// after — same reserve+merge discipline as every other producer of this list
push_fallback_span(
    &mut self.pending_fallback_spans,
    FallbackSpan { text_start, text_end, ..span },
)?;
```
**Confidence:** likely for the inconsistency (directly read); speculative on whether it can currently exceed
reserved capacity — would need to confirm no path lets `reserve_root_text`'s capacity shrink between the commit
that populated `fallback_spans` and this incremental edit.

---

## E6 — Zero `debug_assert!` in ~4300 lines of production code carrying many stated invariants
**Severity:** low   **File:** `shaper/src/engine/state.rs` (module-wide); sharpest examples at `1825-1837`,
`40-42`/`95-104`

**What:** `debug_assert!` does not appear anywhere in `state.rs` outside `#[cfg(test)]`. `overflow-checks` and
`debug-assertions` are off even in this crate's non-release profile per the repo's own build config, so
`debug_assert!` here is exactly as free in every build as the prose already is — it just makes the invariant
checkable instead of only readable. Two concrete, cheap candidates surfaced during this review:

1. `PlannerState.paragraphs` is documented-by-construction to stay sorted by id (`prepare_upsert` inserts at the
   binary-searched position, state.rs:1970) because `paragraph`/`paragraph_mut` (state.rs:1825-1837) binary-search
   it. A binary search over an accidentally-unsorted vector doesn't panic — it silently returns the wrong paragraph
   or `None`. Nothing currently re-checks the ordering after the mutation passes in `prepare_lifecycle`/
   `commit_paragraphs`.
2. `FrameFault`'s doc comment (state.rs:40-42) states paragraph/style ids are "never legitimately zero." Nothing
   asserts this where a real (non-default) `FrameFault` gets constructed or attached (e.g. `in_paragraph`,
   state.rs:95-104).

**Before / After:**
```rust
// after commit_paragraphs' reordering swap (state.rs:2055-2059)
core::mem::swap(&mut self.ordered_paragraphs, &mut self.pending_ordered_paragraphs);
self.pending_ordered_paragraphs.clear();
debug_assert!(
    self.paragraphs.windows(2).all(|pair| pair[0].id < pair[1].id),
    "paragraphs must stay sorted by id for paragraph()/paragraph_mut() to binary_search correctly"
);
```
```rust
// EngineError::in_paragraph (state.rs:95)
pub(crate) fn in_paragraph(self, paragraph_id: u32) -> Self {
    debug_assert_ne!(paragraph_id, 0, "paragraph ids are allocated from one; 0 means \"not attributed\"");
    self.map_fault(|fault| FrameFault { ... })
}
```
**Confidence:** certain that the assertions are absent and would compile out of release exactly like everywhere
else in the codebase; likely (not certain) that these two are the highest-value spots — a full invariant inventory
across every doc comment in the file was out of scope for this pass.

---

## E7 — Bare `u32` for every identifier kind invites transposition
**Severity:** low   **File:** `shaper/src/engine/state.rs:143-147, 318-328`; `shaper/src/engine/frame.rs:105-186`

**What:** Root ids, paragraph ids, style ids, codec handles, capability-set ids, revisions, stable/glyph ids,
generations, and — sharpest example — two genuinely different kinds of font handle are all plain `u32`:
```rust
struct RegisteredFontBinding {
    handle: u32,          // a font *render binding* handle
    shaping_handle: u32,  // a *shaping* font handle (looked up in ShaperRegistry)
    binding: FontRenderBinding,
}

pub fn register_font_binding(
    &mut self,
    handle: u32,
    shaping_handle: u32,
    shaping_glyph_count: u32,
    binding: FontRenderBinding,
) -> Result<(), EngineError> { ... }
```
Three consecutive `u32` parameters, two of which name different id spaces, with nothing but argument order and
naming discipline preventing a future call site from swapping `handle` and `shaping_handle` — a swap the compiler
would accept silently. `frame.rs`'s `RootRevision { engine: u32, root: u32 }` and `UpdateRequest`'s half-dozen
`u32` fields (`root_id`, `codec_handle`, `capability_set`, ...) are the same pattern at the wire-request boundary.

**Why it matters:** this is the same class of bug newtypes exist to make unrepresentable at zero runtime cost
(`#[repr(transparent)] struct X(u32)` compiles to the same bits). It's listed here as confirmation of what the
review brief flagged rather than a new discovery — the module mixes every id space as bare `u32` throughout, and
`register_font_binding`'s signature is the sharpest concrete example of where that costs real protection.

**Before / After:**
```rust
// before
struct RegisteredFontBinding { handle: u32, shaping_handle: u32, binding: FontRenderBinding }
```
```rust
// after
#[derive(Clone, Copy, PartialEq, Eq)]
struct FontBindingHandle(u32);
#[derive(Clone, Copy, PartialEq, Eq)]
struct ShapingFontHandle(u32);

struct RegisteredFontBinding {
    handle: FontBindingHandle,
    shaping_handle: ShapingFontHandle,
    binding: FontRenderBinding,
}
```
**Confidence:** certain the types are bare `u32` throughout; this is a design-cost observation (module-wide,
pre-existing, large blast radius to fix) rather than a bug with a triggering sequence, so it is ranked low despite
being systemic.

---

## Module architecture — is `state.rs` doing one job or several?

`engine/mod.rs` re-exports exactly `EngineError`, `FrameFault`, `TextEngine` (mod.rs:58) — confirmed a tight
facade; nothing in this review found a path that would need to widen it.

Enumerating `state.rs`'s actual responsibilities by `impl` block and free-function cluster (139 functions total):

1. **`impl TextEngine`** — three flat resource registries (font bindings, font stacks, codecs: ~250 lines,
   state.rs:318-524), root lifecycle (create/dispose/reserve/revision: state.rs:525-573), and frame orchestration
   (prepare/measure/commit/abort/copy: state.rs:624-1522). The registries are structurally near-identical
   (register/dispose/get/count over a `Vec`/`BTreeMap`) and only reach into `self.planners` for their two in-use
   checks (`references_font_stack`, `codec_binding` scan) — the closest thing here to a one-directional,
   separable concern, but not perfectly so.
2. **`impl PlannerState`** — one root's paragraph collection: ordering, create/remove staging, commit/abort
   (state.rs:1803-2062). Already its own `impl` block; tightly used by (1)'s frame orchestration, not separable
   without just relocating the coupling.
3. **`impl ParagraphState`** — the per-paragraph staged pipeline: text → styles → unicode → bidi → shaping_runs →
   shape → clusters → geometry → flow_layout → positioned (state.rs:2174-3600, the bulk of the file's length).
   Every stage follows the same prepare/abort/commit triad and depends on the staged output of the previous one.
   This is one responsibility (the incremental per-paragraph pipeline) regardless of its line count — splitting it
   across files would move the coupling, not reduce it.
4. **Free-function cluster: incremental shaping / font-fallback / boundary-candidate / ellipsis** —
   `prepare_boundary_candidate`, `append_boundary_source_ids`, `push_fallback_span`, `collect_cluster_records`,
   `containing_run`, `edit_delta`, `map_old_offset`, `same_edit_run_topology`, `shifted_text_offset`,
   `same_shaping_properties`, `shaping_run_topology_stable` (state.rs:1524-1569, 3730-3838, 3840-4139). These take
   arena/slice parameters and return plain values — none of them touch `TextEngine`, `PlannerState`, or `&mut
   ParagraphState`. This is the one genuinely separable responsibility with a clean, one-directional dependency
   (arena logic → called by `ParagraphState`'s methods, never the reverse) — effectively the `shaping_run.rs` the
   scope brief anticipated might already exist as its own file. It could move to a private `state::shaping_run`
   submodule (`mod shaping_run;` inside `state.rs`, i.e. `engine/state/shaping_run.rs`) without touching
   `engine/mod.rs`'s three-name facade at all, since every function in this cluster is already crate-private.

**Verdict:** don't split `state.rs` wholesale — responsibilities (2) and (3) are load-bearing complexity, not
accidental sprawl, and moving them elsewhere doesn't reduce their coupling to the frame-orchestration methods in
(1). The one concrete, low-risk extraction available today is responsibility (4) — the incremental-shape/fallback
free-function cluster — into its own submodule; it is already logically self-contained and physically scattered
across three non-adjacent regions of the file.

---

## What was checked and found sound (no finding filed)

- Panic-free-by-construction: zero `unwrap()`/`expect()`/`panic!()`/`unreachable!()`/`todo!()` in production
  `state.rs` (confirmed by grep excluding the `#[cfg(test)] mod tests` block starting at line 4284).
- Zero narrowing casts to `u8`/`u16`/`i8`/`i16` in production `state.rs`; the handful of `as u32`/`as usize` casts
  present are all lossless widenings or round-trips of values that started as the target type.
- `saturating_mul`/`saturating_sub`/`wrapping_add`/`wrapping_mul` usages (state.rs:933, 1012, 2405, 3262-3263, 3710,
  4142, 4192) all checked individually — each is on a capacity/generation-counter value where the wraparound or
  clamp is the correct behaviour, not a masked bug.
  `for i in 0..collection.len()` indexing (e.g. state.rs:1191, 1358, 3317) is a borrow-checker workaround for
  needing a fresh immutable read of `planner.active_order()`/`self.flow_layout...` alongside a mutable borrow of
  the same owner inside the loop body — not a naive habit; an iterator-based rewrite isn't available without an
  extra allocation, which would violate the zero-steady-state-allocation law these loops are already respecting.
- `prepare_text`/`prepare_styles`/`prepare_lifecycle`/`measure_paragraph_inner`/`prepare_update_inner`: every
  error exit path was traced and each calls the matching `abort_*`/`abort_pending` before returning `Err`; commit
  paths (`commit_update`) perform their one fallible step (`plan.commit()`) before any field mutation, so nothing
  is published from a partially-failed preparation. `planner.acknowledged_publication_generation` is the one
  field deliberately mutated before the fallible closure runs in `prepare_update_inner` (state.rs:1162) — this is
  explicitly commented as an external monotonic fact that must survive an abort, not an oversight.
- `speculative_lifecycle_fingerprint` (state.rs:4148-4205) was traced through repeat-call and reorder scenarios;
  the "lifecycle-neutral upsert" short-circuit (state.rs:4173-4178) correctly excludes only upserts restating an
  already-committed paragraph at its already-committed order, so genuine reorders/creates/removes always perturb
  the hash and speculative adoption cannot cross a real structural change.
  `copy_glyphs`/`copy_decorations` (state.rs:633-832) allocate freely (`Vec::new()`, fresh `CodecGatherWorkspace`)
  — correctly so, per their own doc comments: these are cold, one-shot detached-plan queries, not steady-state
  frame paths, so the zero-allocation law doesn't apply to them.
- `font_binding.rs`/`font_binding_wire.rs`: `FieldTable`, `FontRenderBinding::new`/`select`, and the wire parser
  (`parse_font_binding`, `reject_overlaps`/`relative_range`) all validate with `checked_*`/`try_from` and reject
  malformed input before constructing anything; no gap found here.
