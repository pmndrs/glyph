---
type: Audit Report
title: Rust review — retained plan compilation and slot lifecycle
description: Findings from the retained plan compilation and slot lifecycle review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, plan, retained, lifecycle]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Retained plan compilation and slot/pool lifecycle — review

Scope: `shaper/src/engine/{stable_plan,ordered_plan,stable_pool,stable_order,render_plan_compiler,render_plan,plan_packing,plan_input,plan_draw,plan_error,identity_index}.rs`

All functions in scope are `unsafe = false` and `panicky = []` per the AST facts; that part of the architecture's claim holds. The issues found are lifecycle/atomicity and structural, not memory safety.

---

## P1 — `commit()` is not atomic, and `abort()` corrupts already-committed state on the recovery path the wasm boundary actually uses

**Severity:** high
**File:** `shaper/src/engine/stable_plan.rs:538-584`, `shaper/src/engine/render_plan_compiler.rs:285-311`, `shaper/src/engine/state.rs:1484-1497`, `shaper/src/wasm.rs:811-823,1144-1164`

**What:**

`StablePlanCompiler::commit()` loops over every batch and calls fallible steps (`commit_batch_storage`, `batch.slots.commit()`, `batch.order.commit()`) with `?`:

```rust
// stable_plan.rs:538
pub fn commit(&mut self) -> Result<(), StablePlanError> {
    if !self.prepared {
        return Err(StablePlanError::NotPrepared);
    }
    for batch_index in 0..self.batches.len() {
        let pending_index = self.batch_pending_indices[batch_index];
        self.commit_batch_storage(batch_index, pending_index)?;   // fallible
        let batch = &mut self.batches[batch_index];
        batch.slots.commit()?;
        let order_rebased = batch.order.rebased()?;
        ...
        batch.order.commit()?;                                    // fallible
        batch.active = pending_index != NONE;
    }
    ...
    self.prepared = false;   // only reached on the fully-successful path
    Ok(())
}
```

`commit_batch_storage` (line 1651) is genuinely fallible, not just for API uniformity — it returns `Err(InvalidIdentity)` at lines 1677 and 1698 when a buffer id/generation isn't found in `pending_allocations` or `spare_buffers`, and it calls `apply_writes` (`plan_packing.rs:96`), which itself returns `Err(InvalidIdentity)` at lines 112/115 on an out-of-range patch. Unlike `StableSlotPool::commit()` (stable_pool.rs:257, infallible after the `!prepared` guard) and `ChunkedOrder`'s own commit/abort, this outer loop has **no rollback and no atomicity**: if batch `k` fails, batches `0..k` are already mutated and committed, batch `k` itself is left with `buffers` cleared and its real bytes stranded in `spare_buffers` (the swap at line 1663 happens before the fallible steps, with no restore on early return), and — critically — `self.prepared` is **never reset**, because the only place that happens is the last line of the success path.

The same shape exists one level up in `RenderPlanCompiler::commit()`:

```rust
// render_plan_compiler.rs:285
pub fn commit(&mut self) -> Result<(), RenderPlanCompilerError> {
    match self.prepared_strategy {
        ...
        PreparedStrategy::Mixed => {
            self.ordered.commit()?;   // if this succeeds...
            self.stable.commit()?;    // ...and this fails, ordered is already committed
        }
    }
    self.prepared_strategy = PreparedStrategy::None;   // never reached on failure
    Ok(())
}
```

Now the recovery path. `StablePlanCompiler::abort()` unconditionally truncates the live batch vector to a count captured **before** the current transaction, with no guard on `self.prepared`:

```rust
// stable_plan.rs:575
pub fn abort(&mut self) {
    for batch in &mut self.batches {
        batch.slots.abort();
        batch.order.abort();
        batch.pending_retired_chunks.clear();
    }
    self.batches.truncate(self.committed_batch_count);   // stale after commit()
    self.pending_allocations.clear();
    self.prepared = false;
}
```

`committed_batch_count` is written exactly once, at the top of `prepare_with_strategy_filter` (`self.committed_batch_count = self.batches.len();`, line 303) and is **never updated by `commit()`**. Every sibling in this module gets this right: `OrderedPlanCompiler::abort()` (ordered_plan.rs:352) only clears `prepared`/`pending_allocations` and never touches the live `batches`/`buffers`; `StableSlotPool::abort()` and `ChunkedOrder::abort()` only touch pending/scratch fields via `finish_transaction`-style clears. `StablePlanCompiler::abort()` is the one place that reaches into committed live state — safe only while genuinely mid-transaction, actively destructive otherwise.

The application-level guard that is supposed to prevent "abort after commit" is the revision check in `state.rs`:

```rust
// state.rs:1484
pub(crate) fn commit_update(&mut self, prepared: PreparedUpdate) -> Result<CommittedUpdate, EngineError> {
    ...
    planner.plan.commit().map_err(plan_error)?;   // bails here on failure
    planner.commit_paragraphs();
    ...
    planner.revision = prepared.next;              // never reached on failure
    ...
}

pub(crate) fn abort_update(&mut self, prepared: PreparedUpdate) -> Result<(), EngineError> {
    ...
    if planner.revision != prepared.previous { return Err(EngineError::RevisionConflict); }
    planner.abort_pending();   // -> self.plan.abort()
    ...
}
```

The guard assumes `commit()` is all-or-nothing: either it fully applies and bumps `revision`, or it has no effect and `revision` is untouched. That assumption is false here. A failed `commit_update` leaves `planner.revision == prepared.previous`, so a subsequent `abort_update(prepared)` (same token) sails past the revision check.

This is not a hypothetical caller — it is the engine's **own** recovery path, exercised on every commit failure at the wasm boundary:

```rust
// wasm.rs:811
let commit = match state.engine.commit_update(prepared) {
    Ok(commit) => commit,
    Err(error) => {
        return publish_prepared_failure(state, prepared, revision, engine_status(error), error.fault(), 0, 0);
    }
};

// wasm.rs:1144
fn publish_prepared_failure(state: &mut WasmState, prepared: PreparedUpdate, ...) -> u32 {
    let root_id = prepared.root_id();
    let _ = state.engine.abort_update(prepared);   // unconditional, on any commit_update error
    publish_attributed_failure(...)
}
```

**Why it matters:** A mixed-strategy frame where `ordered.commit()` succeeds and `stable.commit()` fails (or a stable-only frame whose own per-batch loop fails partway) is reported to JS as a plain commit error. The engine's own recovery for that error calls `abort()` on a compiler that has already committed part or all of its batches. `StablePlanCompiler::abort()` then silently truncates `self.batches` back to its pre-transaction length, discarding the batches that were just correctly committed — live glyph storage disappears from the compiler's bookkeeping while the renderer may already hold (or be about to receive) records that reference it. Separately, even without hitting the truncation, `self.prepared` staying `true` after a failed `commit()` means the compiler can never accept another `prepare()` (`AlreadyPrepared` forever) — a permanent hang for that root.

The `InvalidIdentity` triggers are currently reachable only through a `prepare()`-time bookkeeping bug elsewhere (id/generation mismatch between what `prepare_batch_storage` records and what `commit_batch_storage` later finds), not through malformed external input — so this is dormant today. That is exactly the danger: it is a landmine in the one recovery path every commit failure funnels through, not a bug that fails safely.

**Before / After:**

```rust
// Before — stable_plan.rs:575
pub fn abort(&mut self) {
    for batch in &mut self.batches {
        batch.slots.abort();
        batch.order.abort();
        batch.pending_retired_chunks.clear();
    }
    self.batches.truncate(self.committed_batch_count);
    self.pending_allocations.clear();
    self.prepared = false;
}
```

```rust
// After — no-op when there is no in-flight transaction to undo, matching every
// sibling abort() in this module (OrderedPlanCompiler, StableSlotPool, ChunkedOrder).
pub fn abort(&mut self) {
    if !self.prepared {
        return;
    }
    for batch in &mut self.batches {
        batch.slots.abort();
        batch.order.abort();
        batch.pending_retired_chunks.clear();
    }
    self.batches.truncate(self.committed_batch_count);
    self.pending_allocations.clear();
    self.prepared = false;
}
```

This guard alone turns "corrupts already-committed batches" into a safe no-op. It does not give `commit()` atomicity — batches already applied before a mid-loop failure stay applied, and `self.prepared` still needs to be cleared on the error path so the compiler doesn't wedge (`if result.is_err() { self.prepared = false; }` around the loop body, mirroring `prepare_with_strategy_filter`'s own `if result.is_err() { self.abort(); }`). The complete fix is to make `commit()` infallible in practice the way `StableSlotPool::commit()` already is: move the invariant that `commit_batch_storage`'s `.ok_or(InvalidIdentity)?` checks currently guard into `prepare()`/`prepare_batch_storage`, where a failure is cheap to recover from, so `commit()` only ever performs already-validated, infallible application.

**Confidence:** certain. Traced end to end: `wasm.rs:811-823` → `publish_prepared_failure` (`wasm.rs:1144-1164`, unconditional `abort_update`) → `state.rs:1484-1497` (`commit_update`, revision bumped only after `plan.commit()` succeeds) → `state.rs:1468-1482` (`abort_update`'s revision-conflict guard, bypassed because revision never advanced) → `render_plan_compiler.rs:285-311` (`commit`/`abort`, no atomicity, `Mixed` arm can leave one sub-compiler committed and the other not) → `stable_plan.rs:538-584` (`commit`/`abort`, stale `committed_batch_count`, no `prepared` guard) → `stable_plan.rs:1651-1703` / `plan_packing.rs:96-119` (the actual fallible steps). What would additionally confirm impact: a regression test that forces `commit_batch_storage` to return `Err` (e.g. via a fault-injection hook) and asserts `self.batches.len()` and `has_state()` before/after the resulting `abort_update`.

---

## P2 — `StablePlanCompiler::batches` never prunes fully-dead entries; per-update cost tracks edit history, not live content

**Severity:** medium
**File:** `shaper/src/engine/stable_plan.rs:107-121,199,409-417,449-461,542,581`

**What:** A `StableBatch` is created once per distinct `BatchKey` ever seen (`self.batches.push(StableBatch::new(key))`, line 413) and is never removed except by `abort()`'s truncate-away-newly-added-entries path (line 581), which only undoes the *current* transaction. There is no compaction for a batch that has gone fully idle: zero live glyphs, `active == false`, quarantine drained. Grepping the file confirms the only mutators of `self.batches` are `push` (413) and `truncate` (581) — no `remove`/`retain`/`swap_remove`.

Both `prepare_inner`'s per-batch pass (`for batch_index in 0..self.batches.len() { self.prepare_batch_identity(...); ... }`, line 449) and `commit()`'s per-batch pass (line 542) iterate **every batch ever created**, including long-dead ones, on every single update — as long as `has_state()` (line 467) is still `true` for *any* batch. `BatchKey` includes `resource_generation`, `material_id`, `clip_id`, and `depth_key` (line 74-86), so an editor-style workload that cycles through many distinct resource generations, clip regions, or depth buckets over a document's lifetime accumulates one permanent `StableBatch` — with its own `StableSlotPool` and `ChunkedOrder`, each holding several `Vec`s — per generation of key ever used, even after that batch's slots and chunks have fully drained to empty.

Contrast with `OrderedPlanCompiler`: its `commit()` rebuilds `self.batches` from scratch out of `self.pending_batches` each cycle (`ordered_plan.rs:330-338`), so a batch that stops appearing in `pending_batches` is naturally dropped. `StablePlanCompiler` has no equivalent reaping pass.

**Why it matters:** for a long-lived, heavily-edited root that keeps *some* stable-strategy content alive while its batch-key set keeps churning (e.g. per-edit clip/depth/material changes), the fixed per-update overhead of walking `self.batches` — and the retained capacity of each dead batch's slot/order `Vec`s, which `clear()`/`resize(0, ..)` never shrinks — grows without bound relative to the edit history, not the current live glyph count. This is a scalability defect, not a correctness one: renders stay correct, but steady-state cost per update stops being proportional to steady-state content.

**Before / After:**

```rust
// Before — stable_plan.rs:449 (prepare_inner), always walks every batch ever created
for batch_index in 0..self.batches.len() {
    self.prepare_batch_identity(batch_index, publication_generation, capability.fragmentation_budget)?;
    ...
}
```

```rust
// After — sketch: compact fully-idle batches once their quarantine has drained,
// e.g. at the top of prepare_inner after the acknowledge() pass (line 334-338),
// swap-removing any batch with `!active && !slots.has_quarantined_slots() &&
// quarantined_chunks.is_empty()`. Requires batch_pending_indices / any stored
// batch_index references to be rebuilt after compaction, since indices shift.
```

**Confidence:** likely. The growth mechanism (push-only, no compaction, per-update full walk) is certain and directly traced. What is not fully quantified is real-world severity, which depends on how often application code changes `BatchKey`-affecting fields (resource generation, clip, depth, material) on long-lived documents; the existing test `an_inactive_batch_stays_live_only_until_its_quarantine_is_acknowledged` (stable_plan.rs:2023) only checks `has_state()`, not `self.batches.len()`, so it does not exercise or guard against this.

---

## P3 — Per-glyph batch lookup is O(glyphs × distinct batches) in both compilers

**Severity:** medium
**File:** `shaper/src/engine/stable_plan.rs:409-417`, `shaper/src/engine/ordered_plan.rs:437-449`

**What:** Routing each glyph to its batch is a linear scan:

```rust
// stable_plan.rs:409, inside the per-glyph loop in prepare_inner
let batch_index = match self.batches.iter().position(|batch| batch.key == key) {
    Some(index) => index,
    None => { ... }
};
```

```rust
// ordered_plan.rs:437, inside the equivalent per-glyph loop
let batch_index = match self.pending_batches.iter().position(|batch| batch.state.key == key) {
    Some(index) => index,
    None => {
        ...
        let prior_index = self.batches.iter().position(|batch| batch.key == key)...  // second scan
        ...
    }
};
```

Both run once per glyph, scanning the full batch list each time. `identity_index.rs` provides an O(1) epoch-cleared hash lookup in the same module (used for `stable_id`), but `BatchKey` lookups use `Vec::position` instead.

**Why it matters:** for realistic inputs (batch count bounded by a handful of technique/resource/material/clip/depth combinations), this is fine. It becomes quadratic when a frame has many distinct `BatchKey`s relative to glyph count — e.g. per-glyph depth keys or clip ids, or the long-lived churn scenario in P2 inflating `self.batches` even for a small live set. Combined with P2 (dead batches never pruned), the scan grows with edit history even when the *live*, distinct-this-frame batch count stays small, since `stable_plan.rs:409` scans all of `self.batches`, not just active ones.

**Before / After:** no inline snippet — the fix is structural (hash `BatchKey` into a scratch `IdentityIndex`-style table keyed by a cheap hash of its fields, rebuilt once per `prepare()` alongside `identity_set`, rather than per-glyph linear scan), not a local edit.

**Confidence:** likely for the algorithmic complexity (directly read); speculative on real-world impact, since it depends on distinct-batch-count in practice, which this review has no runtime data for.

---

## P4 — `PendingBatch.buffer_count` silently carries two different meanings across one `prepare()` pass

**Severity:** low
**File:** `shaper/src/engine/stable_plan.rs:817-818,1275,1318-1319,1665`

**What:** `prepare_batch_storage` first sets `buffer_count` to the physical-program-buffer count only:

```rust
// stable_plan.rs:817
self.pending_batches[pending_index].buffer_count = u16::try_from(program.buffers.len())
    .map_err(|_| StablePlanError::ArithmeticOverflow)?;
```

Later in the same `prepare_inner()` pass, `compile_bindings` (which runs once for all batches, after the storage loop) overwrites it to include the order buffer:

```rust
// stable_plan.rs:1275, 1318
let binding_count = program.buffers.len() + 1;
...
pending.buffer_count = u16::try_from(binding_count)...;
```

`commit_batch_storage`, which only ever runs after a full `prepare()` cycle, recovers the physical-only count by subtracting the order buffer back out:

```rust
// stable_plan.rs:1665
for index in 0..usize::from(pending.buffer_count.saturating_sub(1)) {
```

**Why it matters:** this is correct today only because `compile_bindings` unconditionally runs last and overwrites every pending batch's `buffer_count` before `commit()` can observe it — there is no code path today where `commit_batch_storage` sees the intermediate (physical-only) value. But the field's meaning depends on *write order across two different functions* with no type-level or documented enforcement; a refactor that reorders `compile_bindings` relative to the storage loop, or that calls `commit_batch_storage` against a `PendingBatch` that never went through `compile_bindings`, would silently drop the last physical buffer's writes on commit (the `saturating_sub(1)` masks the underflow that would otherwise be a loud panic on `buffer_count == 0`).

**Before / After:**

```rust
// Before — one field, two meanings, recovered with a saturating subtraction
buffer_count: u16,   // = program.buffers.len() after prepare_batch_storage,
                      // = program.buffers.len() + 1 after compile_bindings
```

```rust
// After — sketch: store the physical count once and add the order buffer explicitly
// at each of the two use sites (compile_bindings's binding_count, and the draw
// records' buffer_count at lines 1471/1562), instead of overwriting the stored field:
physical_buffer_count: u16,   // set once in prepare_batch_storage, never rewritten
// binding_count = physical_buffer_count + 1, computed locally where needed
```

**Confidence:** certain that the dual-write exists and that the current call order makes it safe; speculative that it will stay safe under future refactoring — flagged for durability, not because it misbehaves today.

---

## P5 — `IdentitySet::insert` computes its probe mask with an unchecked subtraction, asymmetric with `IdentityIndex`

**Severity:** low
**File:** `shaper/src/engine/identity_index.rs:48-62` vs `111-147`

**What:** `IdentityIndex::get`/`insert_position` guard the empty-table case explicitly:

```rust
// identity_index.rs:111
pub(crate) fn get(&self, identity: u32) -> Option<u32> {
    let mask = self.keys.len().checked_sub(1)?;   // None if never prepared
    ...
}
```

`IdentitySet::insert` does not:

```rust
// identity_index.rs:48
pub(crate) fn insert(&mut self, identity: u32) -> bool {
    let mask = self.keys.len() - 1;   // underflows if keys.len() == 0
    ...
}
```

If `insert` is ever called before `prepare` (or after a `prepare` that somehow left `keys` empty), `self.keys.len() - 1` wraps to `usize::MAX` (release has `overflow-checks` off), and the subsequent `self.epochs[index]` is an out-of-bounds index into a zero-length `Vec` — a hard panic regardless of the overflow-checks setting, since slice indexing is always checked.

**Why it matters:** not reachable today — both call sites (`stable_plan.rs:341/368`, `ordered_plan.rs:400/419` and `492/510`) call `identity_set.prepare(input.glyphs.len())` immediately before a loop that calls `insert()` exactly `input.glyphs.len()` times, and `prepare()` always leaves `keys.len() >= 8` (its `required` computation `.max(8)`s the capacity even for `entry_count == 0`). This is purely a latent-contract issue: the "prepare before insert, and never insert more than `entry_count` new identities" invariant is enforced by caller discipline, not by the type or by a defensive check, unlike its sibling `IdentityIndex`.

**Before / After:**

```rust
// Before
pub(crate) fn insert(&mut self, identity: u32) -> bool {
    let mask = self.keys.len() - 1;
    ...
}
```

```rust
// After — match IdentityIndex's own defensive pattern
pub(crate) fn insert(&mut self, identity: u32) -> bool {
    let mask = self.keys.len().checked_sub(1).expect("IdentitySet::prepare must run before insert");
    ...
}
```

**Confidence:** certain that the asymmetry exists and is unreachable today under current call sites (verified by grep across the crate); the fix is a hardening suggestion, not a live-bug fix.

---

## P6 — Slot ids, chunk ids, and generations share the bare `u32` type throughout this subsystem

**Severity:** low
**File:** `shaper/src/engine/stable_order.rs:8-25,422-430`, `shaper/src/engine/stable_pool.rs:7-19`

**What:** `stable_order.rs` alone mixes at least two distinct address spaces as bare `u32` in adjacent structs: `OrderEntry.record_slot` (a physical *record* slot, the same space as `stable_pool.rs`'s `SlotAssignment.slot`) and `ChunkState.slot`/`PendingChunk.slot` (a physical *chunk* slot, a different space measured in units of `ORDER_CHUNK_RECORDS`). `committed_entries(&self, slot: u32, len: u16)` (line 422) takes a chunk slot and multiplies it by `ORDER_CHUNK_RECORDS` internally to reach a record offset — nothing in the signature distinguishes it from a record slot, and the same is true of `allocate_chunk() -> Result<u32, _>` versus `StableSlotPool::allocate_slot() -> Result<u32, _>` one file over.

**Why it matters:** the compiler gives no help against passing a record slot where a chunk slot (or a generation, or a buffer id) is expected; every one of the module's many `id: u32, generation: u32` parameter pairs (e.g. `retire_buffer(&mut self, id: u32, generation: u32, byte_length: usize, publication_generation: u32)`, stable_plan.rs:1631) is a same-type-adjacent transposition hazard the type system cannot catch. No transposed call site was found in this review — every call site traced was correctly ordered — so this is a durability/idiom recommendation, not a live bug.

**Before / After:**

```rust
// Before
struct ChunkState { slot: u32, len: u16 }
pub struct OrderEntry { pub stable_id: u32, pub record_slot: u32 }
fn committed_entries(&self, slot: u32, len: u16) -> Result<&[OrderEntry], ChunkedOrderError>
```

```rust
// After — sketch
struct ChunkSlot(u32);
struct RecordSlot(u32);
struct ChunkState { slot: ChunkSlot, len: u16 }
pub struct OrderEntry { pub stable_id: u32, pub record_slot: RecordSlot }
fn committed_entries(&self, slot: ChunkSlot, len: u16) -> Result<&[OrderEntry], ChunkedOrderError>
```

**Confidence:** certain that the bare-`u32` mixing exists as described; speculative that it is worth the churn given this is `pub(crate)`-internal and no misuse was found — lowest priority of the findings here.
