---
type: Reference
title: Rust codex — Arc, shared ownership and clone cost
description: Checkable rules on arc, shared ownership and clone cost, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

## (a) The claim, adjudicated

**The claim:** "Arc is a superpower type because it can do raw memcopies underneath it as fast as possible" — plus an "Arc vs Vec" comparison.

**Verdict: backwards emphasis wrapped around two true facts.** Arc's actual superpower is that `.clone()` is *not* a copy at all — it's a relaxed atomic increment, O(1) regardless of payload size. The claim inverts this: it credits Arc with doing memcopies fast, when Arc's entire value proposition is doing zero of them on the hot path (clone/drop) and exactly one of them, unavoidably, on a specific cold path (turning owned data into a shared allocation for the first time). Below is what's true, half-true, and false, each pinned to a primary source. Section (b) turns each into a checkable rule; do not skip the wasm32 rules (R21–R25) — this workspace's shaper crate compiles to `wasm32-unknown-unknown` and already runs `no_std` with a custom allocator (`shaper/src/wasm.rs:23-24`), which changes several of these tradeoffs completely.

**True.**
- `Arc<T>::clone` increments a strong count with `fetch_add(1, Relaxed)` and returns a new fat/thin pointer to the *same* allocation — no data is touched, let alone copied. Verified in `rust-lang/rust` stdlib source, `library/alloc/src/sync.rs`.
- `Arc<[T]>` really does get a genuine memcpy-speed *construction* fast path when `T` is `Copy` (technically the broader, internal `TrivialClone` marker) — `Arc::from(&[u8])`, `Arc::from_iter` over a `TrustedLen` iterator of bytes, etc. compile down to one `ptr::copy_nonoverlapping` call, not N element-wise clones. This is real and it's likely the kernel of truth the maintainer is remembering.
- Cloning a `Vec<T>` is a full allocation plus an O(n) memcpy every time. `Arc<[T]>::clone` is O(1). "Arc vs Vec" as a *cloning-cost* comparison is real and dramatic — this is almost certainly the actual "Arc vs Vec" comparison being half-remembered (see the Svojanovsky article in the reading list).

**Half-true / context-dependent.**
- "As fast as possible" undersells what Arc actually buys you: skipping the memcpy is *faster* than any memcpy, "as fast as possible" or not. The phrasing suggests Arc's speed comes from a well-optimized copy; it comes from not copying.
- `Vec<T>` → `Arc<[T]>` (`From<Vec<T>> for Arc<[T]>`) genuinely does allocate and `memcpy` — so if "Arc does a memcpy underneath" means this one specific, one-time conversion, it's literally true. It is not true of `Arc::clone`, which is the operation people actually call in a loop.
- Atomic operations are not "free," but on this project's actual compile target — `wasm32-unknown-unknown` without the `atomics` feature — they are not atomic *instructions* either. LLVM legalizes every atomic op to a plain, non-atomic load/RMW/store because the target is declared `singlethread: true`. Verified by disassembling this workspace's own pinned toolchain output (R21–R23). On this target specifically, "Arc's atomics are basically free" is *true*; generalized to native multi-core targets, it is false.

**False.**
- "Arc is a superpower *because* it can do raw memcopies fast" — backwards. Arc's superpower is that `clone`/`drop` do no memcopy at all. Crediting Arc's speed to memcpy performance is crediting the wrong mechanism.
- By implication: that repeatedly cloning/sharing an `Arc` is "as fast as a raw memcpy would be, but happening constantly" — no. It's *replacing* the memcpy, once, at construction, with an O(1) pointer+counter operation thereafter.
- That this makes Arc a default-good choice for hot paths generally. It doesn't: refcount contention under real concurrent sharing, the extra pointer indirection in tight loops, and the `ArcInner` header blocking a flat buffer from being handed to a foreign consumer (JS/wasm boundary, in this codebase) are all real, measured costs (R26–R30). A flat-`Vec`-plus-index-handle codebase — which is what this workspace already is, with zero `Arc`/`Rc` in the tree today — should treat a proposal to introduce `Arc` as adding a second ownership model, not as a free win.

**Where the claim most likely comes from.** No single article titled anything close to "Arc is a superpower" or making the "raw memcopies" claim directly was found (WebSearch budget was exhausted mid-investigation; remaining research used WebFetch against primary sources and Google-indexed snippets, per the fallback instruction). The strongest candidate for the "Arc vs Vec" half of the memory is Tomas Svojanovsky, "Why You Should Consider Using Arc Instead of Vec in Rust," Dev Genius, 2024-11-15 — which argues `Arc<[T]>`'s O(1) clone beats `Vec<T>`'s O(n) clone, with no "superpower"/"raw memcopy" language found in indexed snippets (the live page 403'd for direct fetch; content reconstructed from search-result excerpts only, so treat this attribution as likely, not certain). The "fast memcpy" half most plausibly comes from genuine, verifiable mechanisms: the `T: Copy`/`TrivialClone` construction specialization (R17) and/or `bytes::Bytes`'s "zero-copy sharing" reputation (R18), both of which are about *avoiding* copies, not performing them fast — consistent with a maintainer's compressed, slightly inverted memory of correct source material.

---

## (b) Rules

### R1. Model `Arc::clone` as a relaxed atomic increment, not a copy of any kind.
**Why:** The stdlib implementation is `self.inner().strong.fetch_add(1, Relaxed)`. `Relaxed` suffices — per the source comment, "increasing the reference counter can always be done with `memory_order_relaxed`: new references to an object can only be formed from an existing reference, and passing an existing reference from one thread to another must already provide any required synchronization" (citing the Boost documentation). No payload byte is read or written.
**Applies to us:** none of this workspace's crates use `Arc`/`Rc` today (verified: zero matches for `std::sync::Arc`/`std::rc::Rc`/`Arc<`/`Rc<` across `packages/glyph/rust`). Any future introduction should be justified by this actual cost model, not a guess.
**Bad / Good:**
```rust
// Bad: reasoning as if Arc::clone duplicates the pointee.
fn hand_out(buf: &Arc<[u8]>) -> Arc<[u8]> {
    // "this copies buf's bytes" — no, it does not.
    buf.clone()
}
```
```rust
// Good: clone is a refcount bump; the returned Arc aliases the same bytes.
fn hand_out(buf: &Arc<[u8]>) -> Arc<[u8]> {
    Arc::clone(buf) // one fetch_add(1, Relaxed); zero bytes touched
}
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `impl Clone for Arc<T, A>::clone`, L2523–L2554, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2523-L2554, resolved 2026-09-03.

### R2. Never price `Arc::clone`/`drop` using a native-CPU cost model without checking which target you're actually compiling for.
**Why:** The popular mental model ("atomic RMW = `LOCK XADD`, locks the bus, bounces cache lines") is accurate on x86_64/aarch64 but is not universal. This project's shaper crate targets `wasm32-unknown-unknown`, where the entire premise — that `fetch_add` compiles to a hardware atomic instruction — is false by default (R21).
**Applies to us:** directly. Whatever intuition a contributor brings from server/native Rust work does not transfer to this crate's release artifact without re-checking.
**Bad / Good:**
```rust
// Bad: "atomics are expensive, avoid Arc here" — asserted without checking
// which of this workspace's two build targets (native test harness vs.
// wasm32-unknown-unknown shipping artifact) the claim is even about.
```
```rust
// Good: state the target before stating the cost.
// "On wasm32-unknown-unknown without +atomics (our shipped artifact),
// Arc::clone's fetch_add lowers to a plain i32.load/i32.add/i32.store —
// see R21. On the native test binary, it's a real atomic RMW."
```
**Source:** self-verified by compiling both a native and a `wasm32-unknown-unknown` target with this workspace's pinned toolchain; see R21–R23 for the disassembly.

### R3. Price `Arc::drop` as one atomic RMW plus a conditional `Acquire` fence, not as "free."
**Why:** `Arc::drop` is `fetch_sub(1, Release)`, then — only on the path where the count just hit zero — `atomic::fence(Acquire)` before running the destructor. The fence exists so that "use of the data happens before decreasing the reference count, which happens before this fence, which happens before the deletion of the data" (source comment, citing Boost). `Rc::drop` has no such fence: `dec_strong()` then a plain compare to zero, because single-threaded access is already a compile-time guarantee.
**Applies to us:** relevant if this codebase ever adds a second thread (Web Worker + `SharedArrayBuffer`, or a native multi-threaded tool crate) — the fence is real synchronization, not decoration.
**Bad / Good:**
```rust
// Bad: assume Arc's Drop is exactly as cheap as Rc's Drop everywhere.
```
```rust
// Good: Arc::drop = 1 atomic RMW, +1 Acquire fence on the last-owner path.
//        Rc::drop  = 1 plain decrement,  +0 fence, ever.
// The difference is the price of the cross-thread visibility guarantee.
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `impl Drop for Arc<T, A>::drop`, L2985–L3021, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2985-L3021; `library/alloc/src/rc.rs`, `impl Drop for Rc<T, A>::drop`, L2601–L2609, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/rc.rs#L2601-L2609, resolved 2026-09-03.

### R4. Don't wrap a `Copy` type in `Arc<T>` "to make cloning cheap" — a bare copy is already cheaper than an atomic RMW plus a pointer chase.
**Why:** `Arc::clone` costs one RMW plus (usually) an allocation-adjacent pointer dereference on next use. Copying a `u32`, a `[f32; 4]`, or any small `Copy` struct is one or two register moves. `Arc<T>` only wins once cloning `T` directly costs more than that — i.e., once `T` is large or itself owns a heap allocation.
**Applies to us:** this codebase's per-glyph/per-cluster records (`GlyphRun`, cluster state, offsets) are small `Copy` structs by design (see the DOD codex, R1). Never Arc-wrap one of these "for cheap sharing" — a plain copy already wins.
**Bad / Good:**
```rust
// Bad: Arc around a type that's already trivially Copy.
struct GlyphOffset { x: f32, y: f32 }
fn share(o: Arc<GlyphOffset>) -> Arc<GlyphOffset> { Arc::clone(&o) } // RMW + indirection
```
```rust
// Good: just copy it. No allocation, no refcount, no indirection, ever.
#[derive(Clone, Copy)]
struct GlyphOffset { x: f32, y: f32 }
fn share(o: GlyphOffset) -> GlyphOffset { o }
```
**Source:** direct consequence of R1 and R3's cost model; no additional citation needed beyond the `Arc::clone`/`drop` sources above.

### R5. Use `Arc::get_mut`, not a manual `Arc::strong_count(&x) == 1` check, to take the "uniquely owned" fast path.
**Why:** `get_mut` returns `Some` only via `is_unique`, which reads *both* strong and weak counts consistently in one logical step (the weak count is locked while the strong count is read — see the `ArcInner` field comment). A hand-rolled `strong_count() == 1` check race-condition-adjacently ignores weak pointers and is not how the stdlib itself decides uniqueness.
**Applies to us:** if this codebase ever introduces `Arc` for a mutably-updated-then-shared buffer, prefer the checked API over reimplementing its invariant.
**Bad / Good:**
```rust
// Bad: reimplements (incorrectly) what get_mut already does correctly.
if Arc::strong_count(&buf) == 1 {
    unsafe { /* mutate through a raw pointer */ }
}
```
```rust
// Good: the stdlib's own uniqueness check, safe, no unsafe block needed.
if let Some(buf_mut) = Arc::get_mut(&mut buf) {
    buf_mut.push(0);
}
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `Arc::get_mut`, L2793–L2804, and the `ArcInner` field comment explaining the weak-count lock, L403–L409, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2793-L2804, resolved 2026-09-03.

### R6. Treat `Arc::make_mut`'s cost as data-dependent, not constant — it silently deep-clones whenever the `Arc` is currently shared.
**Why:** `make_mut` checks `strong.compare_exchange(1, 0, ...)`. If any other strong reference exists, it clones the *entire* pointee into a fresh allocation via `Arc::clone_from_ref_in`, which calls `T::clone_to_uninit` — for a slice this is a full element-by-element (or, for `Copy`/`TrivialClone` elements, memcpy) copy of every byte. Whether a given call to `make_mut` is O(1) or O(n) depends entirely on whether some other `Arc` handle happens to be alive at that moment — not on anything visible at the call site.
**Applies to us:** if introduced, never call `make_mut` inside a loop assuming its cost is stable between iterations; the first call after a `clone()` elsewhere in the program pays the full copy, the next one (now uniquely owned again) is free.
**Bad / Good:**
```rust
// Bad: assumes make_mut is always cheap because "we already own an Arc."
for _ in 0..1000 {
    Arc::make_mut(&mut buf).push(item); // O(n) exactly once if buf is shared
}
```
```rust
// Good: know which regime you're in — check before relying on the cost.
debug_assert_eq!(Arc::strong_count(&buf), 1, "make_mut about to deep-clone");
Arc::make_mut(&mut buf).push(item);
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `Arc::make_mut`, L2648–L2727 (clone path: L2659–L2661; `clone_from_ref_in`: L1563–L1575), https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2648-L2727, resolved 2026-09-03.

### R7. Know that `Arc<[T]>::make_mut`'s clone-on-write path is exactly as expensive as `Vec<T>::clone` plus a fresh allocation — not "just a memcpy."
**Why:** For `T: Copy` (`TrivialClone`), `clone_to_uninit` does specialize to `ptr::copy_nonoverlapping` — a real memcpy, same cost class as `Vec::clone`. For any other `T: Clone`, there is no bulk copy at all: it's `T::clone()` called once per element (R20). "It's just a memcpy" is only true for the `Copy` case.
**Applies to us:** if this codebase ever shares a baked font/atlas buffer (`[u8]` or `[f32]`, both `Copy`) via `Arc<[T]>`, `make_mut` on it while shared is a full-buffer copy — no cheaper than the `Vec` clone it would have replaced.
**Bad / Good:**
```rust
// Bad: reach for Arc<[T]> assuming make_mut avoids the Vec::clone cost.
let shared: Arc<[u8]> = baked_atlas.into();
Arc::make_mut(&mut shared).fill(0); // full-buffer memcpy if `shared` is aliased
```
```rust
// Good: if mutation-while-shared is expected, budget for the copy either way,
// or restructure so the mutator holds the sole owner (no aliasing to copy from).
```
**Source:** same as R6, plus R17/R20 below on the `TrivialClone` specialization.

### R8. Weak pointers alone force `make_mut` to relocate the data, even with no other *strong* owner.
**Why:** if `strong == 1` but `weak != 1`, `make_mut` does not mutate in place — it allocates a *new* `ArcInner`, `ptr::copy_nonoverlapping`s the current value into it byte-for-byte (via `size_of_val`, since `T` may be unsized), and strands the outstanding `Weak` pointers against the old allocation. This is a real relocation cost triggered by weak references you may not even be tracking at the call site.
**Applies to us:** a cache keyed by `Weak<T>` (e.g., a "notify me if this baked asset is still alive" pattern) would make every subsequent `make_mut` on the strong handle pay a relocation, even though the caller sees only one strong owner.
**Bad / Good:**
```rust
// Bad: hold a long-lived Weak<T> "just in case," not realizing it taxes
// every future make_mut call on the corresponding Arc.
let watcher: Weak<Buf> = Arc::downgrade(&buf);
Arc::make_mut(&mut buf).push(0); // relocates: watcher forces a copy+move
```
```rust
// Good: if you don't need to observe liveness, don't downgrade at all.
Arc::make_mut(&mut buf).push(0); // in-place: strong == 1, weak == 1 (implicit)
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `Arc::make_mut`, "steal" branch, L2662–L2717 (the panic-safety `Guard` and the `ptr::copy_nonoverlapping` at L2701–L2705), https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2662-L2717, resolved 2026-09-03.

### R9. Know that every `Vec<T>` → `Arc<[T]>` conversion allocates and `memcpy`s, no matter how it's spelled.
**Why:** `impl From<Vec<T, A>> for Arc<[T], A>` unconditionally allocates a new `ArcInner<[T]>` and runs `ptr::copy_nonoverlapping(vec_ptr, ..., len)`, then deallocates the `Vec`'s old buffer without dropping its contents. There is no in-place reuse of the `Vec`'s allocation, ever, on stable Rust.
**Applies to us:** if any baked-asset pipeline builds a `Vec<T>` and later needs to share it, budget one full-size allocation + copy for that conversion — it is not free just because "Arc clone is free."
**Bad / Good:**
```rust
// Bad: build a big Vec, then convert, believing Arc "just wraps" it.
let buf: Vec<f32> = compute_positions(); // e.g. 200 KB
let shared: Arc<[f32]> = buf.into();     // allocates 200 KB again, memcpy's it
```
```rust
// Good: know the conversion is a real, one-time O(n) cost, and pay it once —
// don't call Vec::from(&*shared) / re-convert back and forth in a hot loop.
let shared: Arc<[f32]> = compute_positions().into(); // pay it once, at the boundary
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `impl From<Vec<T, A>> for Arc<[T], A>`, L4205–L4232, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L4205-L4232, resolved 2026-09-03. Confirmed identically for `Rc`: `library/alloc/src/rc.rs`, L3114–L3132.

### R10. Understand *why* R9 is unavoidable: `ArcInner`'s refcount header must precede the data in one allocation, and a `Vec`'s buffer has neither the spare room nor the right base offset.
**Why:** `ArcInner<T>` is `#[repr(C, align(2))] { strong, weak, data: T }` — the counts sit immediately before the payload in a single allocation, by design (so `Arc` is one pointer, unlike C++'s `shared_ptr`, which is two). A `Vec<T>`'s buffer was allocated with `T`'s alignment, starting at byte 0 of its own allocation, with no header space reserved in front of it — even a `Vec` with spare capacity can't be walked forward in place, because shifting every element forward by `size_of::<ArcInner<()>>()` bytes costs exactly what a fresh copy costs.
**Applies to us:** explains why "just `Box::leak` the `Vec` and cast it" is not a shortcut — the layouts are fundamentally incompatible, not just inconveniently different.
**Bad / Good:**
```rust
// Bad: assume Vec<T>'s allocation could, in principle, become an Arc<[T]>'s
// allocation with a pointer-only conversion. It structurally cannot:
// ArcInner<[T]> = { strong: AtomicUsize, weak: AtomicUsize, data: [T] }
// Vec<T>'s buffer =                                          { data: [T] }
```
```rust
// Good: if avoiding the copy matters, avoid ever materializing the Vec —
// allocate directly as Arc<[T]> (see R11) instead of Vec<T> then .into().
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `ArcInner` definition and comment, L394–L413, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L394-L413, resolved 2026-09-03. Corroborated by Rust users forum, "Could `Arc<[T]>` from `Vec<T>` be optimized to remove the copy?" — user `landaire`: "the layout of `ArcInner` obviously is not the same as the layout of `Vec`'s data"; user `alice`: "A vector will have allocated with the wrong alignment, so you can't reuse the allocation"; user `scottmcm`: "C++'s `shared_ptr<T>` stores *two* pointers so that the counts and the item can be in different allocations, whereas `Arc` stores one pointer and thus requires a single allocation" — https://users.rust-lang.org/t/could-arc-t-from-vec-t-be-optimized-to-remove-the-copy/137532, retrieved 2026-09-03.

### R11. Collect a known-length iterator directly into `Arc<[T]>`; don't collect into `Vec<T>` first and convert.
**Why:** `Arc<[T]>: FromIterator<T>` specializes on `TrustedLen`: when the iterator's exact size is known, `Arc::from_iter_exact` allocates the `ArcInner` once and writes elements directly into its tail — one allocation total. The non-specialized path (`self.collect::<Vec<T>>().into()`) allocates as many times as `Vec`'s growth strategy needs to build the `Vec`, then allocates *again* for the `Arc` conversion (R9) — the stdlib's own doc comment says so explicitly.
**Applies to us:** any baked-buffer construction (glyph offsets, MTSDF samples) that is going to end its life as a shared `Arc<[T]>` should be written as `(0..n).map(...).collect::<Arc<[T]>>()` (or equivalent exact-size iterator), not `(0..n).map(...).collect::<Vec<_>>().into()`.
**Bad / Good:**
```rust
// Bad: builds a Vec (N reallocations as it grows), then converts (1 more).
let shared: Arc<[f32]> = (0..n).map(compute).collect::<Vec<_>>().into();
```
```rust
// Good: TrustedLen (Range is TrustedLen) → exactly one allocation, ever.
let shared: Arc<[f32]> = (0..n).map(compute).collect();
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `impl FromIterator<T> for Arc<[T]>` doc comment (L4322–L4335) and the `ToArcSlice`/`TrustedLen` specialization (L4341–L4377), https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L4322-L4377, resolved 2026-09-03.

### R12. If a `Vec` really is unavoidable before converting to `Arc<[T]>`, size it exactly first.
**Why:** R9's memcpy is mandatory; R10 explains why it can't be optimized away. What *is* avoidable is paying for `Vec`'s own doubling-growth reallocations on top of it. `Vec::with_capacity(n)` (or `shrink_to_fit()` before the conversion) means the `Vec` itself was built with at most one allocation, so the total cost is exactly the two allocations R9/R10 require — not two-plus-however-many-times-the-`Vec`-grew.
**Applies to us:** any incremental-push construction path (e.g., variable-length glyph runs) that will be frozen into an `Arc<[T]>` at the end.
**Bad / Good:**
```rust
// Bad: push without a size hint, then convert — pays for Vec's growth *and*
// the mandatory Arc conversion copy on top.
let mut buf = Vec::new();
for g in glyphs { buf.push(measure(g)); }
let shared: Arc<[Metrics]> = buf.into();
```
```rust
// Good: one Vec allocation (sized exactly), one Arc conversion allocation —
// the minimum this operation can ever cost.
let mut buf = Vec::with_capacity(glyphs.len());
for g in glyphs { buf.push(measure(g)); }
let shared: Arc<[Metrics]> = buf.into();
```
**Source:** direct consequence of R9 + R10; `Vec::with_capacity`, https://doc.rust-lang.org/std/vec/struct.Vec.html#method.with_capacity, retrieved 2026-09-03.

### R13. On this project's actual `wasm32` target, the `Vec` → `Arc<[T]>` memcpy itself is cheap — it lowers to the native `memory.copy` instruction, not a byte loop.
**Why:** `bulk-memory` has been a default-on wasm target feature since Rust 1.87 (confirmed in this workspace's own 10-memory-access codex, R25). Compiling `ptr::copy_nonoverlapping` — the exact call `From<Vec<T>> for Arc<[T]>` makes — with this workspace's pinned toolchain and default wasm32 target features lowers a runtime-length copy to a single guarded `memory.copy`, not a compiled loop:
```wat
(func $copy_like_arc_from_vec (param i32 i32 i32)
  block
    local.get 2
    i32.eqz
    br_if 0        ;; skip memory.copy on len == 0 (its trap condition)
    local.get 1
    local.get 0
    local.get 2
    memory.copy
  end)
```
So the *copy instruction* is not the expensive part of R9's cost — the allocation call (through this crate's `talc` allocator on wasm32) and doing the copy *more than once* (R12) are.
**Applies to us:** reinforces that R12 (size the `Vec` once) is the actual lever here, not avoiding the copy instruction itself, which is already about as fast as this target allows.
**Bad / Good:**
```rust
// Bad: avoid Arc<[T]> "because memcpy is slow on wasm" — the copy is not
// the bottleneck; it's a single native memory.copy either way.
```
```rust
// Good: budget for one allocation-plus-memory.copy at the conversion
// boundary; don't repeat the conversion, and don't fear the copy itself.
```
**Source:** self-verified by compiling `core::ptr::copy_nonoverlapping` to `wasm32-unknown-unknown` with this workspace's pinned toolchain (rustc 1.97.1, matching `shaper/Cargo.toml`'s `rust-version`) and disassembling with `wasm-tools print`; full output reproduced above. rust-lang/rust PR history for default `bulk-memory`, cited via this repo's own `docs/planning/research/09-wasm.md` R25, cross-checked 2026-09-03.

### R14. Default to `Arc<[T]>` / `Arc<str>` for shared immutable buffers; reach for `Arc<Vec<T>>` only when callers genuinely need `Vec`'s growth API through the shared handle.
**Why:** `Arc<[T]>` is one allocation, one pointer hop to the data. `Arc<Vec<T>>` is two allocations and two hops (R15) for no benefit unless something downstream calls `.push()`/`.reserve()` etc. *through* the `Arc` — which it almost never can anyway, since `Arc<T>` only hands out `&T`, not `&mut T`, without `get_mut`/`make_mut`.
**Applies to us:** if a baked font/atlas buffer is ever shared read-only, it should be typed `Arc<[u8]>` (or a domain newtype wrapping one), never `Arc<Vec<u8>>`.
**Bad / Good:**
```rust
// Bad: Vec's growable API is unreachable through a shared &Arc anyway —
// this pays for two allocations and buys nothing.
struct BakedAtlas(Arc<Vec<u8>>);
```
```rust
// Good: one allocation, one hop, and the type says "this doesn't grow."
struct BakedAtlas(Arc<[u8]>);
```
**Source:** direct consequence of R15/R16's measurements below.

### R15. Know that `Arc<Vec<T>>` is two allocations and two pointer hops to the first element — not one.
**Why:** `Vec<T>` is `Sized` (a 24-byte `{ptr, len, cap}` header), so `ArcInner<Vec<T>>` is `Sized` too, and `Arc<Vec<T>>` is a *thin* pointer to a control block that itself contains a `Vec` header — whose own `ptr` field points to a **second, separately allocated** buffer holding the actual elements. Measured directly on this workspace's toolchain: an `Arc<Vec<u8>>`'s control-block address and its data's backing-buffer address are different heap addresses.
**Applies to us:** any hot loop that would dereference through `Arc<Vec<T>>` pays a second cache miss (control block → `Vec` header → actual data) that `Arc<[T]>` (R16) does not.
**Bad / Good:**
```rust
// Measured (this toolchain, release build):
// Arc<Vec<u8>> control-block addr = 0x1050fe3d0
// Vec<u8> backing-buffer addr     = 0x1050fe310   <- distinct allocation
// Arc<[u8]> control-block+data    = 0x1050fe400   <- one allocation, data inline
```
```rust
// Good: reach element 0 in one hop, not two.
let flat: Arc<[u8]> = data.into();
let first = flat[0]; // Arc -> data, one hop
// vs.
let nested: Arc<Vec<u8>> = Arc::new(data);
let first = nested[0]; // Arc -> ArcInner<Vec<u8>> -> Vec's ptr -> data, two hops
```
**Source:** self-verified: `std::mem::size_of::<Arc<Vec<u8>>>() == 8` (thin) vs. `size_of::<Arc<[u8]>>() == 16` (fat), and distinct addresses for the `Arc<Vec<u8>>` control block vs. its `Vec`'s backing buffer, compiled and run with this workspace's pinned `rustc 1.97.1`, 2026-09-03. General shape corroborated by `rust-lang/rust`, `library/alloc/src/sync.rs`, `ArcInner` definition, L394–L413, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L394-L413.

### R16. `Arc<[T]>` (and `Arc<str>`) are fat pointers for exactly the reason `&[T]` is: the tail data is unsized, so its length rides along in the pointer's metadata.
**Why:** Because `ArcInner<T>`'s last field is `data: T`, and a DST's metadata (here, slice length) is carried by any pointer to it, `Arc<[T]>` is a `{data_ptr, len}` pair — 16 bytes on a 64-bit target, same shape as `&[T]` and `Box<[T]>`. `Arc<u8>` (ordinary `Sized` `T`) is a plain 8-byte pointer.
**Applies to us:** informs FFI/wire-format expectations — an `Arc<[T]>` does not have the same ABI shape as a bare pointer, the same caution this workspace's wasm codex already gives `(ptr, len)` pairs generally (R20/R28 in `03-wasm.md`).
**Bad / Good:**
```rust
// Measured on this toolchain:
// size_of::<Arc<u8>>()      = 8   (thin: T is Sized)
// size_of::<Arc<[u8]>>()    = 16  (fat: T = [u8] is unsized, DST metadata = len)
// size_of::<Arc<str>>()     = 16  (fat: same reason, str is unsized)
// size_of::<&[u8]>()        = 16  (matches Arc<[u8]>'s pointer shape exactly)
```
```rust
// Good: don't assume every Arc<T> is one word wide when passing it across
// an FFI-shaped boundary — check whether T is Sized first.
```
**Source:** self-verified `std::mem::size_of` measurements on this workspace's pinned `rustc 1.97.1`, 2026-09-03 (see R15's evidence block for the exact numbers and reproduction).

### R17. The one real "Arc does a fast memcpy" path is construction from a `Copy` (`TrivialClone`) slice — and it is a specialization, not the general case.
**Why:** `Arc<[T]>::from(&[T])` dispatches through a private `ArcFromSlice` trait with two impls: the default (`T: Clone`) calls `from_iter_exact(v.iter().cloned(), ...)` — one `T::clone()` per element — while a specialized impl for `T: TrivialClone` (a compiler-internal marker every `Copy` primitive implements) calls `Arc::copy_from_slice`, which is exactly one `ptr::copy_nonoverlapping` for the whole slice. `TrivialClone` is `#[unstable(feature = "trivial_clone")]`/`#[doc(hidden)]` — application code can't name it, but every `Copy` primitive (`u8`..`u128`, `f16`..`f128`, `bool`, `char`, raw pointers, `&T`) gets it automatically, which is why `Arc<[u8]>`/`Arc<[f32]>` specifically get the fast path.
**Applies to us:** this codebase's baked buffers (`[u8]`, `[f32]`) are exactly the `Copy` element types this specialization targets — if `Arc<[T]>` is ever introduced for one, construction will be one memcpy, not N clones.
**Bad / Good:**
```rust
// Slow path (T: Clone, not TrivialClone) — one clone call per element:
#[derive(Clone)]
struct Handle(std::rc::Rc<str>); // Clone, not Copy
let a: Arc<[Handle]> = data.into(); // N calls to Handle::clone()
```
```rust
// Fast path (T: Copy → TrivialClone) — one memcpy for the whole slice:
let a: Arc<[f32]> = data.into(); // one ptr::copy_nonoverlapping, N * 4 bytes
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`, `ArcFromSlice` trait and both impls, L2481–L2503, and `Arc::copy_from_slice`, L2402–L2411, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs#L2481-L2503; `TrivialClone` definition, `library/core/src/clone.rs` L270–L283 and primitive impls L708–L733, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/core/src/clone.rs#L270-L283, resolved 2026-09-03.

### R18. Don't credit `bytes::Bytes`'s speed to a fast memcpy either — it's the same refcount-bump sharing, just behind a vtable.
**Why:** `Bytes`'s own doc comment is explicit: "For `Bytes` implementations which point to a reference counted shared storage (e.g. an `Arc<[u8]>`), sharing will be implemented by increasing the reference count." Slicing (`Bytes::slice`) is pointer arithmetic plus a refcount bump on the same underlying allocation, not a copy. `Bytes` is frequently the concrete example people reach for when they say "Arc-backed buffers are fast" — and the mechanism is, again, avoiding the copy, not performing one quickly.
**Applies to us:** if this codebase ever needs `Bytes`-style zero-copy sub-slicing of a shared buffer (e.g., handing out sub-ranges of a baked atlas), the underlying lesson is the same as R1: the speed comes from refcounting, not from any copy at all.
**Bad / Good:** n/a — this rule corrects attribution, not code.
**Source:** `tokio-rs/bytes`, `src/bytes.rs`, `Bytes` struct doc comment ("Memory layout" / "Sharing" sections), https://github.com/tokio-rs/bytes/blob/master/src/bytes.rs, resolved 2026-09-03.

### R19. Prefer a `TrustedLen` iterator into `Arc<[T]>` over building a `Vec` first, whenever the data's final destination only needs to *read* it.
**Why:** restates R11 with the construction angle: `Arc<[T]>: FromIterator` bypasses `Vec` entirely for exact-size iterators, writing straight into the final allocation. This is strictly better than "build a `Vec`, `.into()` it" whenever nothing downstream needs mutable/growable access to the intermediate buffer.
**Applies to us:** applies anywhere this codebase computes a fixed-length derived buffer (per-glyph metrics, MSDF samples) that will be shared read-only afterward.
**Bad / Good:** see R11 (same code pattern; this rule states the general principle R11 exemplifies).
**Source:** same as R11.

### R20. For a non-`Copy` element type, every "fast path" claim above is void — `make_mut`/`from_slice` fall back to one `T::clone()` call per element.
**Why:** `TrivialClone` (R17) is implemented only for primitives, raw pointers, and shared references — not for arbitrary `#[derive(Clone)]` types, and specifically not for anything owning its own heap allocation (`String`, `Vec<T>`, `Box<T>`, another `Rc`/`Arc`). For those, both `ArcFromSlice::from_slice`'s default impl and `Arc::make_mut`'s clone-on-write path degrade to `from_iter_exact`/`clone_to_uninit` calling `Clone::clone()` element-by-element — no bulk memcpy, no matter how large the slice.
**Applies to us:** if this codebase ever has `Arc<[SomeOwnedType]>` (e.g., a slice of `String`s or nested `Vec`s), none of R13/R17's "it's just a memcpy" reasoning applies — budget N allocations, not one memcpy.
**Bad / Good:**
```rust
// Bad: assume Arc<[T]> construction is "basically a memcpy" for any T.
let shared: Arc<[String]> = labels.into(); // N heap-owning clones, not 1 memcpy
```
```rust
// Good: know which regime you're in before estimating cost.
// T: Copy (u8, f32, ...)      -> Arc<[T]> construction is 1 memcpy.
// T: Clone, not Copy (String) -> Arc<[T]> construction is N clones.
```
**Source:** same as R17 (the `T: Clone` default arm of `ArcFromSlice`, L2488–L2494).

### R21. On this crate's actual compile target — `wasm32-unknown-unknown` without `+atomics` — `Arc`'s atomic operations are not atomic instructions at all.
**Why:** The target spec sets `singlethread: true` with the comment "Wasm doesn't have atomics yet, so tell LLVM that we're in a single threaded model which will legalize atomics to normal operations." Verified directly: compiling `AtomicUsize::fetch_add(1, Relaxed)` — the exact operation `Arc::clone` performs — to `wasm32-unknown-unknown` with this workspace's pinned toolchain and default (no `+atomics`) target features produces:
```wat
(func $bump_relaxed (param i32) (result i32)
  (local i32)
  local.get 0
  local.get 0
  i32.load
  local.tee 1
  i32.const 1
  i32.add
  i32.store
  local.get 1)
```
Plain `i32.load` / `i32.add` / `i32.store` — no `i32.atomic.rmw.add`, no lock, no fence, no wasm atomics-proposal instruction anywhere. (For contrast: compiled with `-C target-feature=+atomics` and shared memory, the identical Rust source instead emits a single `i32.atomic.rmw.add` against an imported `shared` memory — a genuinely different, opt-in target.)
**Applies to us:** this is this workspace's actual shipping target (`shaper/Cargo.toml`: `crate-type = ["cdylib", "rlib"]`, wasm32-specific `talc` allocator wired at `shaper/src/wasm.rs:23-24`, no `+atomics` anywhere in the build). Every native-target intuition about atomic cost (R2) needs re-deriving here from first principles, not assumed.
**Bad / Good:**
```rust
// Bad: "we can't afford Arc here, atomics are expensive on wasm" —
// unverified assumption, wrong for this specific build configuration.
```
```rust
// Good: verify codegen for the actual target and feature set in use
// before making a claim about atomic operation cost on wasm32.
```
**Source:** `rust-lang/rust`, `compiler/rustc_target/src/spec/base/wasm.rs`, `singlethread: true` and its comment, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/compiler/rustc_target/src/spec/base/wasm.rs, resolved 2026-09-03. Codegen self-verified: `rustc 1.97.1` (this workspace's pinned `rust-version`, from `shaper/Cargo.toml`), `cargo build --release --target wasm32-unknown-unknown`, disassembled with `wasm-tools print`; contrast build compiled with `nightly-2025-08-01`/`-Z build-std=core -C target-feature=+atomics -C link-arg=--shared-memory`, 2026-09-03.

### R22. Because of R21, `Arc` and `Rc` cost identically on this target for the refcount bump itself — verified byte-for-byte, not just "probably similar."
**Why:** Compiled side-by-side on this workspace's toolchain, `AtomicUsize::fetch_add(1, Relaxed)` (what `Arc::clone` does) and a hand-written `Cell<usize>` get+add+set (exactly what `Rc::clone`'s `inc_strong()` does) produce **identical wasm instruction sequences**, function-for-function, with `wasm32-unknown-unknown` and no `+atomics`. There is no codegen-size or runtime-cost difference between them on this target.
**Applies to us:** on this project's shipped artifact, choosing `Rc` over `Arc` is not a performance optimization — there is no performance difference to capture. Don't spend review time on it as if it were one.
**Bad / Good:**
```wat
;; Arc::clone's fetch_add(1, Relaxed):
(func $bump_relaxed (param i32) (result i32)
  (local i32)
  local.get 0 local.get 0 i32.load local.tee 1
  i32.const 1 i32.add i32.store local.get 1)

;; Rc::clone's Cell<usize> get() + 1 + set():
(func $bump_cell (param i32) (result i32)
  (local i32)
  local.get 0 local.get 0 i32.load local.tee 1
  i32.const 1 i32.add i32.store local.get 1)
;; identical, instruction for instruction.
```
```rust
// Good: pick Arc vs. Rc on this target for the Send/Sync signal (R25),
// not for speed — there's no speed difference here to choose on.
```
**Source:** self-verified, same methodology and toolchain as R21, 2026-09-03.

### R23. `Arc`'s `Acquire` fence on the last-reference drop path costs zero instructions on this target.
**Why:** `atomic::fence(Acquire)` is a compiler barrier with no corresponding hardware instruction to emit when the target is declared single-threaded (R21's `singlethread: true`) — there is nothing for it to order against. Compiled and disassembled directly: a function mirroring `Arc::drop`'s full shape (`fetch_sub(Release)`, branch on the result, `fence(Acquire)` on the last-owner path) emits no fence-related instruction whatsoever — the fence vanishes entirely, leaving only the load/subtract/store/branch that the refcount bookkeeping itself requires.
**Applies to us:** confirms R22 extends to the *whole* clone/drop cycle, not just the increment — `Arc`'s complete lifecycle overhead on this target is identical to `Rc`'s.
**Bad / Good:**
```wat
;; fetch_sub(Release), branch, then fence(Acquire) on the last-owner path:
(func $drop_like_arc (param i32) (result i32)
  (local i32)
  local.get 0 local.get 0 i32.load local.tee 1
  i32.const -1 i32.add i32.store
  i32.const 0 local.set 0
  block
    local.get 1 i32.const 1 i32.ne br_if 0
    i32.const 1 local.set 0   ;; <- fence(Acquire) was here; zero instructions emitted
  end
  local.get 0)
```
```rust
// Good: don't budget any runtime cost for Arc's Acquire fence on this
// target specifically — it is provably free here (not just "probably").
```
**Source:** self-verified, same methodology and toolchain as R21, 2026-09-03.

### R24. `Arc` is not gated out of a `no_std` + `alloc` crate on `wasm32` — the "Arc needs `std`/full atomics support" caution doesn't transfer to this target.
**Why:** `Arc<T>` requires `#[cfg(target_has_atomic = "ptr")]`, which some `no_std` embedded targets (certain Cortex-M0, AVR) genuinely fail, forcing a fallback to `Rc` or hand-rolled refcounting. `wasm32-unknown-unknown` is not one of those targets: its target spec sets `max_atomic_width: Some(64)` **unconditionally** — independent of whether `+atomics` is enabled — specifically so that `singlethread`-legalization (R21) can apply. `target_has_atomic` is therefore satisfied on wasm32 regardless of the `atomics` feature, and `Arc` compiles and works in a plain `alloc`-only crate here.
**Applies to us:** this crate already runs exactly this configuration — `shaper/src/lib.rs:1`: `#![cfg_attr(not(feature = "std"), no_std)]` with `extern crate alloc;`, and a wasm32-specific `#[global_allocator]` (`shaper/src/wasm.rs:23-24`). If `Arc` were ever needed there, availability would not be the blocker; the tradeoffs in R26–R30 would be.
**Bad / Good:**
```rust
// Bad: "we can't use Arc, we're no_std on wasm32" — false on this target.
```
```rust
// Good: know the actual gate is target_has_atomic, which wasm32 satisfies
// unconditionally (max_atomic_width: Some(64) regardless of +atomics) —
// so the real question is whether Arc is the right tool (R26-R30), not
// whether it compiles.
```
**Source:** `rust-lang/rust`, `compiler/rustc_target/src/spec/base/wasm.rs`, `max_atomic_width: Some(64)`, https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/compiler/rustc_target/src/spec/base/wasm.rs, resolved 2026-09-03; `std::sync::Arc` docs, "This type is only available on platforms that support atomic loads and stores of pointers... detected at compile time using `#[cfg(target_has_atomic = "ptr")]`", https://doc.rust-lang.org/std/sync/struct.Arc.html, retrieved 2026-09-03; this workspace's `shaper/src/lib.rs:1` and `shaper/src/wasm.rs:23-24`, verified 2026-09-03.

### R25. If you ever reach for `Rc` over `Arc` on this target, do it for the `!Send`/`!Sync` compile-time guarantee, not for speed — and expect that reason to expire if this target ever gains `+atomics`.
**Why:** R22/R23 already show there's no performance difference to capture today. The one substantive remaining difference is static: `Rc<T>` is `!Send`/`!Sync` by construction (it holds a bare `NonNull`/raw-pointer field and never opts back in), so the compiler rejects any attempt to move or share it across a thread/worker boundary — a real defense-in-depth signal in a codebase that is single-threaded today but could grow a Web Worker or a `+atomics` build later. `Arc<T>` would silently compile in that same accidental-sharing spot. The moment this target's build ever adds `-C target-feature=+atomics` with shared memory (R21's contrast build), `Arc`'s cost profile diverges from `Rc`'s again exactly as it does on native targets — and `Rc` becomes actively wrong (not just merely non-optimal) to share across the new thread boundary, which is precisely the mistake its `!Send` bound exists to catch.
**Applies to us:** if a future feature needs shared immutable data with zero performance difference between `Arc`/`Rc` today, the type choice should be read as documentation of thread-boundary intent, not a performance decision.
**Bad / Good:**
```rust
// Bad rationale: "use Rc, it's faster on wasm." Not measurably true (R22/R23).
```
```rust
// Good rationale: "use Rc — this type must never cross a worker boundary,
// and I want the compiler, not a code reviewer, to enforce that."
struct SingleThreadCache(std::rc::Rc<[u8]>); // !Send, !Sync: enforced statically
```
**Source:** direct consequence of R21–R24; no additional citation.

### R26. On any target where `Arc`'s atomics are real — every non-wasm target this workspace's tooling/tests run on, and `wasm32` the day `+atomics` is ever enabled — refcount contention under genuine concurrent sharing is a measured, large effect.
**Why:** The underlying mechanism is cache-coherence traffic: when multiple cores repeatedly write to the same cache line (here, the `strong`/`weak` counters), the line bounces between cores' private caches, serializing what looks like independent work. This is not Arc-specific — it's the general "false sharing" cost that applies equally to a contended refcount. It has been measured at roughly an order of magnitude or more in adjacent, well-instrumented benchmarks: an 11.7x slowdown from unpadded (falsely shared) vs. padded counters, and a wait-free MPSC queue benchmark quantifying the same effect concretely on both Apple M1 Pro and several x86 servers. None of these benchmark `Arc`'s refcount specifically — they establish that the *mechanism* Arc's refcount would hit under real contention is large and well-documented, not theoretical.
**Applies to us:** relevant only if/when this codebase's `wasm32` target gains real threads (`+atomics` + `SharedArrayBuffer`), or for any native multi-threaded tool crate in this workspace. Not relevant to the current single-threaded shipped artifact (R21–R23).
**Bad / Good:** n/a — this is a caution about a regime this codebase is not currently in, not a code pattern to fix today.
**Source:** Chrysostomos Nanakos, "The Shared State Performance Ladder in Rust," 2026-02-14, measured "Packed (false sharing): 465.21ms / Padded (isolated): 39.85ms / False sharing penalty: 11.7x," https://www.include.gr/writing/rust-shared-state-performance.html. dist1ll, "Measuring the impact of false sharing," alic.dev, 2023-01, benchmarked on Apple M1 Pro and multiple x86 servers, "updating 8 bytes of data... also invalidates 56 neighboring bytes," https://alic.dev/blog/false-sharing. Both retrieved 2026-09-03; neither benchmarks `Arc` specifically — cited for the general false-sharing mechanism only.

### R27. A `Vec<Arc<T>>` defeats the flat-buffer property that makes `Vec<T>` fast to iterate.
**Why:** `Vec<T>` alone is contiguous, prefetchable, and SIMD-friendly. `Vec<Arc<T>>` is a contiguous array of pointers into scattered heap allocations — every element access is a pointer chase to a potentially cold cache line, exactly the indirection this workspace's own DOD codex (R7 there) already tells contributors to replace with flat arenas plus index handles.
**Applies to us:** this workspace's own `04-dod.md` R7 already establishes the fix (`Vec<Node>` + `NodeId` index, not `Rc<RefCell<Node>>`); the same argument applies verbatim to `Arc<T>` in a hot loop — this rule exists so the "but Arc's clone is free" argument doesn't get used to reintroduce the pointer-chase pattern that rule already forbids.
**Bad / Good:**
```rust
// Bad: "Arc::clone is free, so Vec<Arc<Glyph>> is fine" — the clone is
// free; the per-element pointer chase during iteration is not.
struct GlyphRun { glyphs: Vec<Arc<Glyph>> }
```
```rust
// Good: flat storage, Copy index handles — no pointer chase, no refcount.
struct GlyphId(u32);
struct GlyphRun { glyphs: Vec<Glyph>, order: Vec<GlyphId> }
```
**Source:** this workspace's own `docs/planning/research/04-dod.md`, R7 (flat arena + index handle over `Rc<RefCell<Node>>`), cross-referenced 2026-09-03; general cache/prefetch argument per R26's sources.

### R28. The `ArcInner` header means an `Arc<[T]>`'s data pointer is not independently free-able — it cannot cross this project's wasm/JS ownership-transfer boundary the way a `Vec<T>`/`Box<[T]>` can.
**Why:** `Arc<[T]>::as_ptr()` (or `&*arc`) gives a pointer to the *data*, which sits immediately after the `strong`/`weak` header in the same allocation (R10). The allocation's true start — the only address a general-purpose deallocator can legally free — is `data_ptr - size_of::<ArcInner<()>>()` extended to `T`'s alignment, and freeing it correctly also requires decrementing the refcount and matching `arcinner_layout_for_value_layout` exactly, not calling a generic `dealloc(ptr, Layout::array::<T>(len))`. This workspace's own wasm codex already requires "every allocate function needs an exact-ownership free function that reconstructs the *original* `Layout`" (`03-wasm.md` R30) — `Arc<[T]>` cannot satisfy that contract when handed across the boundary, because the pointer a foreign caller receives is not the pointer the allocator would need back.
**Applies to us:** directly, for any baked-buffer handoff to JS across this crate's wasm boundary — the existing pattern (own it as a plain buffer, transfer via `into_raw`/reconstruct via `from_raw`) works with `Box<[T]>`/`Vec<T>` and does not work with `Arc<[T]>`.
**Bad / Good:**
```rust
// Bad: hand a shared slice's raw parts across the wasm boundary as if it
// were a plain owned allocation.
let shared: Arc<[u8]> = build_atlas();
let ptr = shared.as_ptr();
core::mem::forget(shared);
// host later calls free(ptr, len) — but `ptr` is the DATA address, not
// the allocation's start (that's ptr - size_of::<ArcInner<()>>()), and a
// correct free also needs the exact ArcInner<[u8]> layout and a refcount
// decrement, not a plain dealloc(ptr, Layout::array::<u8>(len)).
```
```rust
// Good: Box<[T]> has no header. into_raw IS the allocation's start; the
// host can own it and free it exactly, matching 03-wasm.md's R30 contract.
let owned: Box<[u8]> = build_atlas_boxed();
let ptr = Box::into_raw(owned) as *mut u8;
// host frees later via the crate's paired free(ptr, len), which
// reconstructs Box::from_raw(slice::from_raw_parts_mut(ptr, len)).
```
**Source:** `rust-lang/rust`, `library/alloc/src/sync.rs`: `ArcInner` struct (L394–L413), `arcinner_layout_for_value_layout` (L415–L424), `data_offset` (L4396–L4410) — https://github.com/rust-lang/rust/blob/a69a63265cfd9e006d43137f98301b8d274ad4c9/library/alloc/src/sync.rs, resolved 2026-09-03; this workspace's own `docs/planning/research/03-wasm.md` R30 ("every allocate function needs an exact-ownership free function that reconstructs the *original* `Layout`"), cross-referenced 2026-09-03; `Box::into_raw`, https://doc.rust-lang.org/std/boxed/struct.Box.html#method.into_raw, retrieved 2026-09-03.

### R29. In a codebase built on flat `Vec<T>` + newtype index handles, treat a proposal to introduce `Arc` as a request to add a second ownership model — not a free performance option.
**Why:** This workspace's `packages/glyph/rust` tree currently contains zero uses of `Arc`/`Rc` anywhere (verified by search across all eleven crates). Its documented architecture is flat `Vec` buffers plus `Copy` index newtypes (`04-dod.md` R7–R9), which already solves the "shared, aliasable, multiply-referenced data" problem `Arc` exists for — via arena position instead of a refcounted pointer, with none of R26–R28's costs and none of R9/R10's conversion tax. Introducing `Arc` alongside that pattern means two different answers to "how do I refer to this data" coexisting in one codebase, not a strict improvement to the existing one.
**Applies to us:** entirely — this is the load-bearing rule the other 29 exist to support. Before adding `Arc` anywhere in this tree, name the specific problem an index handle into an existing (or new) flat arena cannot solve.
**Bad / Good:**
```rust
// Bad: reach for Arc because "it's cheap to clone," solving a sharing
// problem this codebase already has a zero-cost answer for.
struct Paragraph { runs: Vec<Arc<Run>> }
```
```rust
// Good: an index into a flat arena is Copy, has no refcount, no
// allocation, and no drop glue — strictly cheaper than Arc for this.
struct RunId(u32);
struct Paragraph { runs: Vec<RunId> }
struct Document { run_arena: Vec<Run> }
```
**Source:** verified by search: no `std::sync::Arc`/`std::rc::Rc`/`Arc<`/`Rc<` matches anywhere under `packages/glyph/rust` (all eleven crates), 2026-09-03; this workspace's own `docs/planning/research/04-dod.md` R7–R9, cross-referenced 2026-09-03.

### R30. If genuine multi-owner sharing is ever unavoidable, keep the `Arc` internal-only — never let its pointer cross the wasm boundary — and re-derive the cost model for the target you actually shipped (R21–R25), not the one you remember from native Rust.
**Why:** Synthesizes R9/R10 (conversion tax), R21–R25 (this target's atomics are free today, but that's a property of the *current* build, not a law), and R28 (the header blocks foreign export). The only shape in which `Arc` is safe to introduce here is: constructed once, cloned only on the Rust side of the boundary, and never handed out as a raw pointer for a foreign allocator to manage.
**Applies to us:** the closing statement of this file's guidance — if a future change needs shared ownership inside the Rust side of this engine, `Arc<[T]>` (R14/R16) is a defensible choice *as long as it stays internal*; the moment a design needs to export the buffer to JS/WebGPU, fall back to the existing `Box<[T]>`/`Vec<T>` transfer pattern (R28) and either copy at the boundary or restructure ownership so only one side ever frees it.
**Bad / Good:**
```rust
// Bad: Arc<[T]> that gets exported across the wasm boundary somewhere
// downstream — violates R28's ownership contract the moment it does.
pub fn get_atlas_ptr(atlas: &Arc<[u8]>) -> *const u8 { atlas.as_ptr() }
```
```rust
// Good: Arc stays internal (e.g. shared between two Rust-side caches);
// the wasm-facing export path always goes through the existing
// owned-buffer transfer contract, copying once at the boundary if needed.
struct InternalCache(Arc<[u8]>); // never exported directly
pub fn export_atlas_copy(atlas: &InternalCache) -> Box<[u8]> {
    atlas.0.as_ref().into() // one explicit, intentional copy at the boundary
}
```
**Source:** synthesis of R9, R10, R21–R25, R28 above; no additional citation.

---

## (c) Reading list

**Conference talks (verified via official conference talk pages).**
- Arthur Pastel, "The Impact of Memory Allocators on Performance: A Deep Dive," EuroRust 2024, Vienna, 2024-10-10/11. Builds a basic allocator to explain fragmentation/overhead, then evaluates production allocators. Directly relevant to R9/R12's "the allocation, not the copy, is often the real cost" framing. https://eurorust.eu/2024/talks/the-impact-of-memory-allocators-on-performance-a-deep-dive/ (talk page); recording: https://www.youtube.com/watch?v=pJ-FRRB5E84
- Arthur Pastel & Adrien Cacciaguerra, "Trust Your Benchmarks, Not Your Instincts: A Rust Performance Quiz," EuroRust 2025, Paris, 2025-10-09/10. Interactive case studies "from iterator chains to memory allocations" testing intuition against measurement — a good pairing with this file's own "verify, don't assume" throughline (R2, R21). https://eurorust.eu/2025/talks/trust-your-benchmarks/

**Articles (author, date, and relevance verified by direct fetch).**
- Guillaume Endignoux, "Optimization adventures: making a parallel Rust workload even faster with data-oriented design (and other tricks)," 2024-12-02. Flattening `Vec<Vec<usize>>` to `Box<[u8]>` (20% faster), `SmallVec`-style inlining (12–25% faster), and a counterintuitive "sort then clone" case. Doesn't discuss `Arc`/`Rc` directly, but is the strongest verified 2023–2026 DOD-in-Rust case study with real numbers. https://gendignoux.com/blog/2024/12/02/rust-data-oriented-design.html
- Chrysostomos Nanakos, "The Shared State Performance Ladder in Rust," include.gr, 2026-02-14. Cache-line contention, CAS retry cost under 32-thread contention (~40% failed CAS attempts), and thread-local accumulation (1886x speedup in its own microbenchmark). General shared-state cost material backing R26. https://www.include.gr/writing/rust-shared-state-performance.html
- Debasish Ghosh, "Cache-Conscious Data Layout in Rust: Field Zoning, False Sharing, and the 128-Byte Rule," 2026-08-23. Field-ownership zoning and the adjacent-line-prefetcher rationale for 128-byte (not 64-byte) padding. Backs R26/R27's cache-locality argument; does not mention `Arc`/`Rc` directly. https://debasishg.github.io/blog/part1-cache-conscious-data-layout-in-rust/
- dist1ll, "Measuring the impact of false sharing," alic.dev, 2023-01. Concrete false-sharing measurements on Apple M1 Pro, Intel i5-9600k, AMD EPYC Milan, and Intel Cascade Lake, via a hand-rolled wait-free MPSC queue. Backs R26 with hardware-diverse numbers. https://alic.dev/blog/false-sharing
- Tomas Svojanovsky, "Why You Should Consider Using Arc Instead of Vec in Rust," Dev Genius, 2024-11-15. The likely source of the "Arc vs Vec" half of the claim under investigation (O(1) `Arc<[T]>` clone vs. O(n) `Vec` clone). **Caveat:** the live page returned HTTP 403 to direct fetch; this entry is reconstructed from indexed search-result excerpts only, not a full read — treat specific wording attributed to it as unverified. https://blog.devgenius.io/why-you-should-consider-using-arc-instead-of-vec-in-rust-c640419298c7
- Krun Dev (handle only; no full name or publish date found on the page), "Rust Clone vs Arc Performance: Data Ownership Strategies That Actually Scale," krun.pro. Explicitly argues *against* an "Arc is a superpower" reading — frames `Arc::clone`/`drop` as real `LOCK XADD`/`LOCK XSUB` cost and cache-line-bouncing risk, concluding a deep clone can beat `Arc` sharing in low-contention single-threaded code. Directionally consistent with this file's own findings but **lower confidence**: no verifiable author identity, no visible publish date, no benchmark numbers shown. Cited for its correct qualitative framing, not as a source of any specific number. https://krun.pro/rust-clone/

**Reference material (living documents, not date-stamped articles).**
- Nicholas Nethercote, "The Rust Performance Book" — "Heap Allocations" chapter. Canonical, continuously maintained: "Unlike `Box`, calling `clone` on an `Rc`/`Arc` value does not involve an allocation. Instead, it merely increments a reference count," alongside the caution that `Rc`/`Arc` for rarely-shared values increases allocation rates. https://nnethercote.github.io/perf-book/heap-allocations.html
- `std::sync::Arc` and `std::rc::Rc` stable documentation — source of the "atomic operations are more expensive than ordinary memory accesses... consider using `Rc` for lower overhead" guidance quoted/qualified throughout this file (R2, R25). https://doc.rust-lang.org/std/sync/struct.Arc.html / https://doc.rust-lang.org/std/rc/struct.Rc.html

**Primary-source community discussions (verified by direct fetch, not blog posts but load-bearing for R10/R20's design rationale).**
- Rust users forum, "Could `Arc<[T]>` from `Vec<T>` be optimized to remove the copy?" — the clearest public explanation of why the `ArcInner` header forces the R9/R10 memcpy, from forum members `landaire`, `alice`, and `scottmcm`. https://users.rust-lang.org/t/could-arc-t-from-vec-t-be-optimized-to-remove-the-copy/137532
- Rust internals forum, "Pre-RFC: Rc and Arc with only strong count" — motivates why a weak-count-free `Arc`/`Rc` (see `triomphe::Arc`/`ThinArc` below) is a real, wanted design point, not a hypothetical one. https://internals.rust-lang.org/t/pre-rfc-rc-and-arc-with-only-strong-count/5828
- `triomphe` crate (Manishearth, fork of `std::sync::Arc`) — ships `Arc` without a weak count (smaller `ArcInner`, no weak-count RMW on the fast path) and `ThinArc`/`UniqueArc`/`ArcBorrow` variants built for exactly the FFI-boundary and header-avoidance concerns in R28/R30, if this codebase ever needs them without hand-rolling. https://docs.rs/triomphe / https://github.com/Manishearth/triomphe
