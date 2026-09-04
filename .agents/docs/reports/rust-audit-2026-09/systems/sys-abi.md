---
type: Audit Report
title: Rust review — wasm ABI boundary and every unsafe site
description: Findings from the wasm ABI boundary and every unsafe site review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, abi, unsafe, wasm]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Wasm ABI boundary and `unsafe` audit

Scope reviewed (every file read in full unless noted): `shaper/src/wasm.rs`,
`shaper/src/abi_contract.rs`, `shaper/src/lib.rs`, `shaper/src/wire.rs`,
`shaper/src/engine/transport.rs`, `shaper/src/engine/codec.rs`,
`shaper/src/engine/codec_wire.rs`, `shaper/src/engine/plan_packing.rs`,
`font-baker/src/wasm.rs`, `bitmap-baker/src/wasm.rs`, `mtsdf-baker/src/wasm.rs`,
`slug-baker/src/wasm.rs`, `mtsdf-baker/src/progress.rs`, `slug-baker/src/progress.rs`,
and every `abi_contract.rs`/`abi_layout.rs` in the repo (bitmap-baker, font-baker,
mtsdf-baker, slug-baker, shaper). To close specific soundness questions I also read
narrow excerpts of files outside the assigned scope and say so inline: `mtsdf-core/src/lib.rs`
(`MtsdfGenerator`/`GlyphOutline` ownership), `shaper/src/engine/ordered_plan.rs` and
`stable_plan.rs` (callers of `plan_packing::execute_run`), `shaper/src/engine/kernel_lab.rs`
(2 of 8 `exported_*` entry points, spot-checked), and the wasm32 `simd128` intrinsics in
the Rust 1.97.1 `stdarch` source (`v128_load`'s actual alignment contract, to avoid guessing).
Build wiring was checked via `shaper/Cargo.toml`, `mtsdf-baker/Cargo.toml`,
`slug-baker/Cargo.toml`, and `packages/glyph/scripts/build.mjs`/`build-engine-kernel-lab.mjs`
to determine what actually ships vs. what is dev/benchmark tooling.

## A1 — No reentrancy guard around the `pmndrs_glyph_bake_progress` host callback
**Severity:** high   **File:** `mtsdf-baker/src/wasm.rs:143-184`, `mtsdf-baker/src/progress.rs:1-22`, `slug-baker/src/wasm.rs:85-126`, `slug-baker/src/progress.rs:1-22`

**What:** `pmndrs_glyph_mtsdf_bake` / `pmndrs_glyph_slug_bake` call `bake_mtsdf`/`bake_slug`
from inside the closure passed to `with_state`, i.e. while the raw `&mut WasmState` produced by
`with_state`'s final `unsafe { &mut *(pointer as *mut WasmState) }` (wasm.rs:695 / wasm.rs:538)
is still alive on the call stack. Deep inside that call, `mtsdf-baker/src/artifact.rs:226-241`
(and the analogous loop in `slug-baker/src/artifact.rs:155-173`) calls
`crate::progress::report(...)` once per glyph. `progress.rs` performs a real, wired-up FFI
call out to the host:

```rust
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn pmndrs_glyph_bake_progress(completed: u32, total: u32);
}
...
unsafe { pmndrs_glyph_bake_progress(completed, total); }
```

`with_state` has no reentrancy guard of any kind -- it is a bare `AtomicUsize` holding a
pointer, dereferenced fresh on every call:

```rust
fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 { /* first-call init, compare_exchange race handled correctly */ }
    // SAFETY: the V0 Wasm host is single-threaded; this pointer is initialized once and never freed.
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
```

If the host's JS implementation of `pmndrs_glyph_bake_progress` ever calls back into *any*
export of this same module (`pmndrs_glyph_mtsdf_alloc`/`dealloc`/`generate`/`bake`, or the
slug equivalents) before returning, `with_state` hands out a **second** live `&mut WasmState`
aliasing the first. That is undefined behavior per Rust's aliasing model regardless of which
fields either call touches, and it has a concrete, easy-to-trigger failure mode: the outer
`bake_mtsdf`/`bake_slug` call holds `source: &[u8]`, a borrow of
`state.allocations[i].bytes` obtained via `owned_bytes(&state.allocations, source_pointer,
source_length)` (wasm.rs:159 / wasm.rs:159) and dereferenced throughout the glyph loop. If the
reentrant call frees that same allocation (`pmndrs_glyph_mtsdf_dealloc(source_pointer,
source_length)` -- `deallocate` at wasm.rs:368-381 does `self.allocations.swap_remove(index)`,
which drops the `Vec<u8>` and returns its heap block to the allocator), the outer loop's next
read of `source` is a use-after-free: it reads memory the global allocator may since have
handed to something else.

**Why it matters:** none of `mtsdf-baker`'s or `slug-baker`'s exports are marked `unsafe fn`
(see A4), so nothing at the call site signals that this precondition ("the host's progress
callback must not call back into this module") exists at all -- it lives only in the fact that
a host import is invoked synchronously from inside a live `&mut WasmState` borrow. Contrast
with `shaper/src/wasm.rs`, `font-baker/src/wasm.rs`, and `bitmap-baker/src/wasm.rs`, which I
also read in full and which declare **no** `extern "C" { ... }` import blocks at all -- they
have no host-callback reentrancy surface. This hazard is specific to the two crates whose bake
pipeline reports progress.

**Before / After:**
```rust
// Before (mtsdf-baker/src/wasm.rs, and identically slug-baker/src/wasm.rs)
fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 { /* ... */ }
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
```
```rust
// After: fail loudly (abort, which panic="abort" already does on any other invariant
// violation in this module) instead of aliasing `&mut WasmState`.
static ENTERED: AtomicBool = AtomicBool::new(false);

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    if ENTERED.swap(true, Ordering::AcqRel) {
        // A host import (pmndrs_glyph_bake_progress) called back into this module while a
        // prior call was still executing. Aliasing &mut WasmState here would be UB, so abort.
        core::arch::wasm32::unreachable();
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) { ENTERED.store(false, Ordering::Release); }
    }
    let _guard = Guard;
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 { /* ... unchanged ... */ }
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
```
A cheaper, non-panicking alternative that fits the crate's existing status-code style: give
`progress::report` a way to skip the callback rather than adding a guard to `with_state`, but
that only helps if the *host* is also changed to never reenter -- the point of a guard is that
the module does not have to trust the host's discipline for its own memory safety.

**Confidence:** likely. Certain: the Rust code has zero reentrancy protection, the callback is
real and wired to a per-glyph loop in the hot bake path, and if reentered the aliasing and the
`source`-use-after-free scenario described above are exactly what happens. Unverified (out of
this Rust-focused review's scope): whether the current TypeScript host implementation of
`pmndrs_glyph_bake_progress` ever performs a synchronous call back into the wasm module. That
would need to be checked in the host binding source, not the Rust crate, to know whether this
is exploitable *today* versus merely unguarded.

## A2 — `write_u32`/`write_header_u32` panic on out-of-bounds offsets instead of returning a status
**Severity:** medium   **File:** `shaper/src/wire.rs:38-40`; the same pattern is duplicated in `font-baker/src/wasm.rs:272-277`, `bitmap-baker/src/wasm.rs:206-211`, `mtsdf-baker/src/wasm.rs:676-679`, `slug-baker/src/wasm.rs:519-522`

**What:** every crate's little-endian header writer indexes with a raw range instead of
`get_mut`:

```rust
// shaper/src/wire.rs
pub(crate) fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
```

`shaper/src/engine/transport.rs::write_header` (the sole caller for the shaper ABI's result
header) calls this ~15 times per publication with constants from `abi_contract.rs`, against
`bytes = self.outputs[slot].bytes_mut()`. The four baker crates' local `write_u32`/
`write_header_u32` are called the same way against a freshly `Vec`-allocated response buffer.

**Why it matters:** with `panic = "abort"` and no `catch_unwind` (per the established facts),
any call site where the destination buffer is shorter than `offset + 4` turns into a hard trap
that kills the whole wasm instance, not a graceful per-call error. I traced every call site
that can reach `write_u32`/`write_header_u32`/`write_header` in the reviewed files:

- `transport.rs::write_header` is only reachable through `FrameTransport::outputs[i]`, and both
  `FrameTransport::new` and `FrameTransport::reserve` reject `result_capacity <
  ENGINE_RESULT_HEADER_SIZE` before ever touching the arena (`transport.rs:151-177`).
  `AlignedArena::reserve` (`transport.rs:543-557`) is monotonic -- `growth_capacity` never
  returns less than the arena's current capacity -- so the header-size floor established at
  construction can't be eroded by a later `reserve_publish_capacity` call
  (`transport.rs:222-225`) even though that path bypasses the floor check directly.
- Each baker's `write_header_u32`/`write_u32` is only called after `response.resize(header_len,
  0)` (e.g. `font-baker/src/wasm.rs:239`, `bitmap-baker/src/wasm.rs:172`,
  `mtsdf-baker/src/wasm.rs:512`, `slug-baker/src/wasm.rs:451`), where `header_len` is exactly
  the same `RESPONSE_HEADER_BYTES`/`RESPONSE_HEADER_SIZE` constant the offsets were generated
  from.

So today every call site independently pre-establishes the invariant this function needs, and
I could not find a reachable panic. But the invariant is enforced entirely by convention at
each call site, not by the function's own signature -- nothing stops a future codec/plan-wire
change from calling `write_header`/`write_u32` against a shorter buffer and reintroducing a
whole-module abort. `font-baker`'s `write_header_u32` (only) already guards the `usize::try_from`
step but still indexes raw afterward, which is an inconsistent half-measure.

**Before / After:**
```rust
// Before
pub(crate) fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
```
```rust
// After -- same call sites, but a future invariant violation becomes a debug-visible bug
// instead of a release-mode abort of the whole module.
pub(crate) fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    let Some(slot) = bytes.get_mut(offset..offset + 4) else {
        debug_assert!(false, "write_u32 offset {offset} out of bounds for {} bytes", bytes.len());
        return;
    };
    slot.copy_from_slice(&value.to_le_bytes());
}
```

**Confidence:** certain that no currently-reachable call violates the bound (I traced every
call site in the reviewed files); likely (not certain) that this remains true under future
changes, which is the actual concern.

## A3 — `plan_packing::execute_run`'s aliasing precondition is proven only by caller discipline in two other files, with no local check
**Severity:** medium   **File:** `shaper/src/engine/plan_packing.rs:168-193`

**What:**
```rust
let base = payload.as_mut_ptr();
for (index, schema) in program.buffers.iter().copied().enumerate() {
    let length = if active_buffers & (1 << index) == 0 { 0 } else { output_records as usize * schema.stride() };
    // SAFETY: the caller sizes mutually disjoint payload segments before this call, and the
    // payload cannot reallocate while these temporary views exist.
    let start = if length == 0 { 0 } else { payload_starts[index] };
    let bytes = unsafe { slice::from_raw_parts_mut(base.add(start), length) };
    outputs[index].write(PhysicalBufferMut { schema, bytes });
}
```
This constructs up to `MAX_PHYSICAL_BUFFERS` (16) simultaneously-live `&mut [u8]` views into
the *same* `payload: &mut [u8]`. If any two active (`length > 0`) views' byte ranges
`[payload_starts[i], payload_starts[i]+length_i)` overlapped, that would be aliased `&mut`
references -- UB independent of whether the overlapping bytes are ever actually written by
both. `execute_run` itself never checks pairwise disjointness of `payload_starts`; it trusts
the caller entirely, and the comment does not say *why* that trust is warranted or point at
what enforces it.

I traced both call sites (`execute_run` is `pub fn`, reachable only from within the crate, not
part of the ABI surface itself, but its soundness gates every codec-buffer write on the update
path):
- `shaper/src/engine/ordered_plan.rs:853-865` builds `payload_starts[schema_index] =
  self.payload.len()` immediately before `self.payload.resize(payload_start + byte_count, 0)`
  for each active buffer, in schema order, for one `self.payload: Vec<u8>` shared across the
  whole range-job loop.
- `shaper/src/engine/stable_plan.rs:909-918` does the exact same bump-append into `self.payload`.

This is a legitimate arena/bump-allocator pattern -- each active buffer's region is appended
to the end of a monotonically-growing `Vec<u8>`, so regions are disjoint and ordered by
construction, both within one `RangeJob` and across jobs (the vec is never truncated between
jobs) -- and `execute_run` itself never resizes `payload`, so `base` stays valid for the call's
duration exactly as the comment claims. I verified both callers independently; the precondition
holds today.

What I could not verify from `plan_packing.rs` alone, and what makes this a real (if
currently-harmless) soundness gap: nothing local to `execute_run` would catch a future third
caller, or a bug in either bump-allocator, that produced overlapping `payload_starts`. There is
also a second, narrower coupling the second `unsafe` block depends on:
```rust
// SAFETY: the prefix contains exactly one initialized value per declared program buffer.
let outputs = unsafe {
    slice::from_raw_parts_mut(outputs.as_mut_ptr().cast::<PhysicalBufferMut<'_>>(), program.buffers.len())
};
```
This is sound only if `program.buffers.len() <= MAX_PHYSICAL_BUFFERS` (16), or the cast exposes
uninitialized `MaybeUninit` slots as initialized. That bound is enforced today, but by a
constant defined independently in a different module:
`codec::MAX_BUFFERS_PER_PROGRAM = 16` (`shaper/src/engine/codec.rs:10`), checked in
`validate_program` (`codec.rs:1656-1658`) at codec-registration time, versus
`plan_packing::MAX_PHYSICAL_BUFFERS = 16` (`plan_packing.rs:13`). If a future change bumped one
without the other, the *safe* indexing (`payload_starts[index]`, `outputs[index]` earlier in
the same loop) would panic before this unsafe block is reached -- so today's failure mode for a
divergence is a clean abort, not memory corruption -- but that safety net is again incidental,
not designed-in.

**Before / After:** a cheap, free-in-release defense that converts a future violation into a
debug-time signal instead of silent UB:
```rust
// After: add a debug-only pairwise-disjointness check before the unsafe loop.
#[cfg(debug_assertions)]
{
    let mut active: Vec<(usize, usize)> = Vec::new();
    for (index, schema) in program.buffers.iter().copied().enumerate() {
        if active_buffers & (1 << index) == 0 { continue; }
        let start = payload_starts[index];
        let end = start + output_records as usize * schema.stride();
        debug_assert!(active.iter().all(|&(s, e)| end <= s || start >= e),
            "execute_run: overlapping payload_starts ranges");
        active.push((start, end));
    }
}
```
And tie the two `16`s together once, at the definition site: `pub const MAX_PHYSICAL_BUFFERS:
usize = super::codec::MAX_BUFFERS_PER_PROGRAM;` instead of a second independent literal.

**Confidence:** certain for the current two call sites (both read in full); likely (not
certain) that this remains sound as the surrounding planner code evolves, which is the point of
the finding.

## A4 — Inconsistent use of `unsafe extern "C" fn` across the four baker crates
**Severity:** low   **File:** compare `shaper/src/wasm.rs:53-56` / `font-baker/src/wasm.rs:44-47` / `bitmap-baker/src/wasm.rs:47-50` (all `pub unsafe extern "C" fn ..._dealloc`) against `mtsdf-baker/src/wasm.rs:90-93` / `slug-baker/src/wasm.rs:78-81` (`pub extern "C" fn ..._dealloc`, not unsafe)

**What:** `shaper`, `font-baker`, and `bitmap-baker` mark every export that accepts a
`(pointer, length)` pair `unsafe extern "C" fn`, including all of the 16 functions in A7 whose
bodies perform no unsafe operation. `mtsdf-baker` and `slug-baker` mark **none** of their
exports `unsafe` -- `pmndrs_glyph_mtsdf_alloc`, `_dealloc`, `_generate`, `_bake`, and every
`_segmented_*` accessor are plain `pub extern "C" fn`, despite having the same
allocation-table-validated shape as the other two crates' functions.

**Why it matters:** this is not a soundness bug in either direction (I traced every one of
these bodies; none dereferences a raw pointer without going through the validated allocation
table first). It does mean `unsafe` is not a reliable signal of anything in this codebase's ABI
layer either way: in three crates it is over-applied (present on functions that need it for no
reason other than "takes a pointer"), and in two crates it is absent even from functions like
`pmndrs_glyph_mtsdf_bake`/`pmndrs_glyph_slug_bake` that -- per A1 -- do have a real, if
host-dependent, safety precondition worth documenting.

**Confidence:** certain (direct comparison of the five files).

## A5 — `mtsdf-baker`/`slug-baker`'s `owned_bytes` rejects the zero-length input that the other three crates accept
**Severity:** low   **File:** `mtsdf-baker/src/wasm.rs:572-577`, `slug-baker/src/wasm.rs:511-516`

**What:**
```rust
// mtsdf-baker & slug-baker (identical)
fn owned_bytes(allocations: &[Allocation], pointer: u32, length: u32) -> Option<&[u8]> {
    allocations
        .iter()
        .find(|allocation| allocation.pointer == pointer && allocation.length == length)
        .map(|allocation| allocation.bytes.as_slice())
}
```
versus `shaper/src/wasm.rs:1097-1105`, `font-baker/src/wasm.rs:359-367`, and
`bitmap-baker/src/wasm.rs:293-301`, all three of which special-case `length == 0`:
```rust
fn owned_bytes(allocations: &[Allocation], pointer: u32, length: u32) -> Option<&[u8]> {
    if length == 0 {
        return (pointer == 0).then_some(&[]);
    }
    ...
}
```
Since `adopt`/`allocate` in every crate refuse to create an `Allocation` with `pointer == 0` or
`length == 0` (they `return None`/`0` first), the allocation table can never contain such an
entry, so `mtsdf-baker`/`slug-baker`'s `owned_bytes(allocations, 0, 0)` always returns `None`
where the other three crates return `Some(&[])`.

**Why it matters:** purely a robustness/consistency nit, not a security issue -- it fails
*closed* (rejects a technically-valid empty-region call as `STATUS_INVALID_REQUEST`/an error
rather than accepting it), so there is no exploitable path here. Worth fixing only for
cross-crate consistency if a host ever legitimately passes an empty source/request buffer to
`pmndrs_glyph_mtsdf_bake`/`pmndrs_glyph_slug_bake`.

**Confidence:** certain.

## A6 — Missing / misplaced `// SAFETY:` comments (the 2 of 64 blocks in this review's scope)
**Severity:** low   **File:** `shaper/src/engine/codec.rs:1083-1093`; `shaper/src/engine/plan_packing.rs:177-184`

**What:** `execute_program`'s call into the `unsafe fn execute_simd_records` has no comment at
all:
```rust
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
let completed = unsafe {
    execute_simd_records(program, execution, inputs, output_start, outputs, active_buffers)?
};
```
I verified the real precondition myself (see the "Drafted `# Safety` contracts" section below
for `execute_simd_records`); it should be spelled out here too, at the call site, since
`execute_simd_records` itself also has no `# Safety` doc (matches the established fact that 0
of 46 unsafe fns do).

Separately, `plan_packing.rs`'s first `execute_run` block has a comment, but it sits one
statement above the `unsafe` block it documents:
```rust
// SAFETY: the caller sizes mutually disjoint payload segments before this call, and the
// payload cannot reallocate while these temporary views exist.
let start = if length == 0 { 0 } else { payload_starts[index] };          // <- comment is "about" this line
let bytes = unsafe { slice::from_raw_parts_mut(base.add(start), length) }; // <- but really documents this one
```
This is very likely the one `plan_packing.rs` block the established fact counts as lacking an
*adjacent* comment (the second `execute_run` block's comment sits directly above its `unsafe`
and would not be flagged). The content is correct; only its position needs to move down four
lines so tooling like clippy's `undocumented_unsafe_blocks` recognizes it.

**Confidence:** certain (both are direct reads of the source).

## A7 — The 16 no-op-unsafe functions: traced and confirmed safe
**Severity:** low (documentation/API-clarity cleanup, not a bug)

I independently traced all 16 `unsafe fn`s whose bodies perform no unsafe operation (this
account, built entirely from the files in this review's scope, reproduces the established
count of 16 exactly):

| # | Function | File:line |
|---|---|---|
| 1 | `pmndrs_glyph_shaper_dealloc` | `shaper/src/wasm.rs:53` |
| 2 | `pmndrs_glyph_shaper_register_font` | `shaper/src/wasm.rs:58` |
| 3 | `pmndrs_glyph_engine_register_font_stack` | `shaper/src/wasm.rs:128` |
| 4 | `pmndrs_glyph_engine_register_font_binding` | `shaper/src/wasm.rs:175` |
| 5 | `pmndrs_glyph_engine_register_codec` | `shaper/src/wasm.rs:219` |
| 6 | `pmndrs_glyph_engine_update` | `shaper/src/wasm.rs:611` |
| 7 | `pmndrs_glyph_engine_update_batch` | `shaper/src/wasm.rs:628` |
| 8 | `pmndrs_glyph_engine_copy_glyphs` | `shaper/src/wasm.rs:835` |
| 9 | `pmndrs_glyph_engine_copy_decorations` | `shaper/src/wasm.rs:904` |
| 10 | `pmndrs_glyph_engine_measure_paragraph` | `shaper/src/wasm.rs:956` |
| 11 | `pmndrs_font_baker_dealloc` | `font-baker/src/wasm.rs:45` |
| 12 | `pmndrs_font_baker_bake` | `font-baker/src/wasm.rs:50` |
| 13 | `pmndrs_font_baker_prepare` (cfg `subsetting`) | `font-baker/src/wasm.rs:80` |
| 14 | `pmndrs_font_baker_inspect` (cfg `subsetting`) | `font-baker/src/wasm.rs:112` |
| 15 | `pmndrs_bitmap_baker_dealloc` | `bitmap-baker/src/wasm.rs:48` |
| 16 | `pmndrs_bitmap_baker_bake` | `bitmap-baker/src/wasm.rs:53` |

**I agree with the classification for all 16.** Every one of them reaches raw memory only
through an `owned_bytes(allocations, pointer, length)` lookup that requires an *exact* match
against a previously-returned `(pointer, length)` pair recorded in a safe `Vec<Allocation>`
table (`Allocation { pointer: u32, requested_length: u32, bytes: Vec<u8> }`), and returns a
`&[u8]`/mutates only through safe `Vec`/slice APIs from there. None of the 16 contains a raw
pointer cast, `slice::from_raw_parts`, or any other unsafe operation in its own body; the
`unsafe` on the `fn` item is vestigial (most plausibly explained by A4's "any function that
accepts a `(pointer, length)` argument gets `unsafe`" convention, applied even where the
callee validates before use). Recommend dropping `unsafe` from all 16 -- this also removes 10
of the 16 from the "genuinely-unsafe, needs a `# Safety` doc" backlog implied by the 0/46
`missing_safety_doc` count, since a plain `fn` needs no such doc.

One clarification on the two functions the task named as examples but that live outside this
review's assigned file list: `pmndrs_font_baker_bake` (row 12 above) *is* in scope
(`font-baker/src/wasm.rs`) and I confirm it. `pmndrs_glyph_engine_update` and
`pmndrs_glyph_engine_copy_glyphs` (rows 6 and 8) are also directly in scope and confirmed.

## A8 — Speculative, low-severity, kernel-lab-only observations (test/benchmark tooling, not shipped to untrusted callers)
**Severity:** low / speculative   **File:** `shaper/src/wasm.rs:374-609`

`kernel-lab` is a non-default Cargo feature (`shaper/Cargo.toml`: `default = ["std"]`;
`kernel-lab = []`) built by a dedicated script, `packages/glyph/scripts/build-engine-kernel-lab.mjs`,
consumed only by `packages/glyph/scripts/support/engine-kernel-runner.mjs` -- the repository's
own benchmark/evidence harness, not the product's shipped `text-shaper.wasm` (built by
`scripts/build.mjs` without `kernel-lab`). I confirmed this before rating anything here below
medium: none of it is reachable by an untrusted TypeScript caller of the published package.

- Seven of the eight `pmndrs_glyph_kernel_lab_*` wrappers (`pack`, `break_masks`,
  `bidi_masks`, `flagged_scan`, `transition_scan`, `chunk_summaries`, `chunk_summaries_i64`)
  perform **no** validation in `wasm.rs` itself -- they forward every `u32` pointer argument
  straight into `unsafe { kernel_lab::exported_*(...) }` on the strength of a comment ("the
  test-only kernel validates every direct-memory region before creating slices"). I spot-checked
  two of the eight callees, `exported_pack` and the start of `exported_break_masks`
  (`shaper/src/engine/kernel_lab.rs:330-404`, outside this review's assigned scope), and both do
  build a `region::<T>(pointer, count)` per argument and reject via
  `valid_disjoint_regions(&regions)` before any `unsafe` slice construction -- consistent with
  the comment. I did not check the remaining six callees or the internals of `region`/
  `valid_disjoint_regions`/`typed_slice`/`typed_slice_mut` themselves, so I rate this
  **likely**, not certain, and it is properly in another reviewer's file scope
  (`kernel_lab.rs` is not in mine).
- `pmndrs_glyph_kernel_lab_codec` (`shaper/src/wasm.rs:542-609`) is the one kernel-lab wrapper
  that *does* validate in `wasm.rs`, via `owns_region` (`wasm.rs:1108-1119`), which -- unlike
  every other `owned_bytes` in this codebase -- accepts a pointer into the *middle* of a live
  allocation (`pointer >= entry.pointer && end <= allocation_end`), by design, since the eight
  regions checked are computed byte lengths rather than whole-allocation handles. One asymmetry
  I could not explain from `wasm.rs` alone: `f32_output_pointer`'s region is checked against
  `f32_output_bytes = (count * 4) * 4` bytes while every other region (four f32 inputs, the u32
  input, the u32 output) is checked against `f32_bytes = count * 4` bytes
  (`wasm.rs:559-578`) -- i.e. the output region's ownership pre-check demands 4x the bytes of
  everything else. This may be intentional (up to `MAX_VECTOR_WIDTH = 4` f32 lanes packed per
  record) and re-validated more precisely inside `exported_codec`, or it may be an
  over-generous/incorrect bound; I did not read `exported_codec` and mark this speculative.

**Confidence:** likely for the general validate-before-slice pattern (2/8 callees spot-checked);
speculative for the `f32_output_bytes` asymmetry specifically. Both are low severity regardless
because this feature does not ship to end users.

---

## Drafted `# Safety` contracts

None of the 46 unsafe fns in the codebase has a `# Safety` section (established fact). Below is
concrete text for the unsafe fns that fall inside this review's file scope: `execute_simd_records`
(the one genuinely-unsafe function in `codec.rs`/`plan_packing.rs`/`transport.rs`) and the eight
`kernel_lab_*` wrappers in `shaper/src/wasm.rs`. The 30-genuinely-unsafe-function total spans
files outside this review's assignment (`kernel_lab.rs` itself, and unsafe fns in other crates
not in my file list); those are not drafted here.

### `execute_simd_records` -- `shaper/src/engine/codec.rs:1265`
```rust
/// # Safety
/// The caller must first call `validate_execution(program, inputs, output_start, outputs,
/// active_buffers)` and only reach this function if it returned `Ok(())`. That call is what
/// proves the two facts this function's `v128_load`/`v128_store` calls depend on and does not
/// re-check itself:
/// 1. Every `inputs.f32_fields[i]` and `inputs.u32_fields[i]` slice has exactly
///    `inputs.record_count` elements, so `input_record + 4 <= inputs.record_count` (guaranteed
///    by this function's own `completed = inputs.record_count & !3` loop bound) is sufficient
///    for every four-lane `v128_load` from those slices to stay in bounds.
/// 2. For every buffer index whose bit is set in `active_buffers`,
///    `outputs[index].bytes.len() >= (output_start + inputs.record_count) *
///    outputs[index].schema.stride()`, which `write_simd_outputs` relies on for its
///    `v128_store` writes at `output_start * stride .. (output_start + 4) * stride`.
///
/// Additionally, `program` and `execution` must be the paired descriptor/`ExecutableProgram`
/// produced together by `ValidatedCodec::new` for the same program (i.e. `execution` came from
/// `ExecutableProgram::new(program)`), so that every register operand in `program.operations` is
/// `< MAX_REGISTERS` and every `field` operand is `< program.f32_input_count` /
/// `program.u32_input_count` -- `validate_program`/`validate_operation` establish this once at
/// codec-registration time (`ValidatedCodec::new`), and this function performs no register- or
/// field-index bounds checking of its own (see the raw `registers[usize::from(target)]` /
/// `inputs.f32_fields[usize::from(field)]` indexing throughout).
```

### `pmndrs_glyph_kernel_lab_pack` -- `shaper/src/wasm.rs:380`
```rust
/// # Safety
/// This function performs no validation of its own; it is a thin ABI shim over
/// `kernel_lab::exported_pack`. `x_pointer`, `y_pointer`, `font_size_pointer`,
/// `plane_left_pointer`, `plane_bottom_pointer`, `plane_right_pointer`, and `plane_top_pointer`
/// must each address `count` readable, correctly-aligned `f32` values in this module's linear
/// memory; `origins_pointer` and `sizes_pointer` must each address `count * 2` writable,
/// correctly-aligned `f32` values, disjoint from every other region named here and from each
/// other. `exported_pack` validates all of this (region liveness, alignment, and pairwise
/// disjointness) before constructing any slice and returns `STATUS_INVALID_REQUEST` instead of
/// proceeding if validation fails, so calling this function is memory-safe for any `u32`
/// argument values as long as that validation remains intact -- the `unsafe` on this function
/// documents a dependency on the callee, not a caller-supplied invariant. This module is not
/// reentrant: do not call any other `pmndrs_glyph_*` export from a context reachable during this
/// call.
```

### `pmndrs_glyph_kernel_lab_break_masks` -- `shaper/src/wasm.rs:414`
```rust
/// # Safety
/// Thin shim over `kernel_lab::exported_break_masks`, which validates before use.
/// `flags_pointer` must address `count` readable bytes; `output_pointer` must address
/// `count.div_ceil(16)` writable `u16` values, disjoint from `flags_pointer`. `group_count` is
/// validated to be one of `{1, 2, 4, 8}` inside the callee, not by this shim. Not reentrant (see
/// `pmndrs_glyph_kernel_lab_pack`).
```

### `pmndrs_glyph_kernel_lab_bidi_masks` -- `shaper/src/wasm.rs:433`
```rust
/// # Safety
/// Thin shim over `kernel_lab::exported_bidi_masks`, which validates before use.
/// `levels_pointer` must address `count` readable bytes; `output_pointer` must address the
/// callee-computed output element count in writable, correctly-typed, disjoint memory.
/// `group_count` is validated inside the callee. Not reentrant.
```

### `pmndrs_glyph_kernel_lab_flagged_scan` -- `shaper/src/wasm.rs:452`
```rust
/// # Safety
/// Thin shim over `kernel_lab::exported_flagged_scan`, which validates before use.
/// `flags_pointer` must address `count` readable bytes; `checksum_pointer` must address one
/// writable, correctly-aligned accumulator, disjoint from `flags_pointer`. Not reentrant.
```

### `pmndrs_glyph_kernel_lab_transition_scan` -- `shaper/src/wasm.rs:471`
```rust
/// # Safety
/// Thin shim over `kernel_lab::exported_transition_scan`, which validates before use.
/// `levels_pointer` must address `count` readable bytes; `checksum_pointer` must address one
/// writable, correctly-aligned accumulator, disjoint from `levels_pointer`. Not reentrant.
```

### `pmndrs_glyph_kernel_lab_chunk_summaries` -- `shaper/src/wasm.rs:490`
```rust
/// # Safety
/// Thin shim over `kernel_lab::exported_chunk_summaries`, which validates before use.
/// `advances_pointer` and `flags_pointer` must each address `count` readable values;
/// `advance_sums_pointer`, `space_sums_pointer`, and `flags_or_pointer` must each address
/// `count.div_ceil(chunk_size)` writable, correctly-aligned accumulators, pairwise disjoint from
/// each other and from the input regions. Not reentrant.
```

### `pmndrs_glyph_kernel_lab_chunk_summaries_i64` -- `shaper/src/wasm.rs:515`
```rust
/// # Safety
/// Same contract as `pmndrs_glyph_kernel_lab_chunk_summaries`, with `accumulator_count`
/// additionally bounding the width the callee accumulates into; validated inside
/// `kernel_lab::exported_chunk_summaries_i64` before any slice is constructed. Not reentrant.
```

### `pmndrs_glyph_kernel_lab_codec` -- `shaper/src/wasm.rs:542`
```rust
/// # Safety
/// Unlike the other kernel-lab shims, this function does its own ownership pre-check
/// (`owns_region`, wasm.rs:1108) before calling `kernel_lab::exported_codec`: every one of
/// `f32_input0_pointer` .. `f32_input3_pointer`, `u32_input0_pointer`, `f32_output_pointer`,
/// `u32_output_pointer`, and `u16_output_pointer` must fall entirely within some single live
/// allocation returned by `pmndrs_glyph_shaper_alloc` (a sub-range of that allocation is
/// permitted -- `owns_region` allows `pointer >= entry.pointer && end <= allocation_end` --
/// unlike every other pointer/length check in this crate, which requires an exact match). The
/// four f32 inputs and the u32 input must each cover `count * 4` bytes; `f32_output_pointer`
/// must cover `count * 16` bytes (I could not confirm from this file alone whether that 4x is
/// because up to `MAX_VECTOR_WIDTH` f32 lanes are packed per output record or is an
/// over-generous bound -- see A8); `u32_output_pointer` must cover `count * 4` bytes;
/// `u16_output_pointer` must cover `count * 2` bytes. `codec_handle` must name a codec
/// previously accepted by `pmndrs_glyph_engine_register_codec`. Pairwise disjointness and
/// alignment of the regions actually used by `technique`/`variant` are validated inside
/// `exported_codec`, not by `owns_region`. Not reentrant.
```

---

## Summary of verified-sound designs (not findings, included because I traced them in depth)

- **`AlignedArena::bytes`/`bytes_mut`** (`transport.rs:567-587`): `ArenaBlock` is
  `#[repr(C, align(16))] struct ArenaBlock([u8; 16])`, backed by three `const _: () =
  assert!(...)` checks (`transport.rs:615-617`) pinning `size_of == align_of == 16 ==
  ENGINE_RESULT_HEADER_ALIGNMENT`. The `slice::from_raw_parts[_mut]` reinterpretation as `&[u8]`
  is sound: non-null/aligned per `Vec`'s own guarantee (even for a zero-length arena), byte count
  matches exactly `blocks.len() * 16` initialized bytes (every block is written via
  `resize(.., ArenaBlock([0; 16]))`), and Rust's ordinary `&self`/`&mut self` borrow checking on
  the *safe* wrapper functions is what actually prevents `bytes()` and `bytes_mut()` from
  co-existing -- the unsafe block only performs the pointer-width reinterpretation.
- **`execute_simd_records`/`write_simd_outputs`** (`codec.rs:1265-1485`): I do not merely accept
  the SAFETY comments here -- I independently re-derived the byte-range arithmetic for all three
  `write_simd_outputs` vector-width cases (1, 2, 4 lanes) against `validate_execution`'s
  `output.bytes.len() >= (output_start + record_count) * stride` check and confirmed the maximum
  byte offset touched never exceeds that bound. `v128_load`'s actual contract, confirmed from
  Rust 1.97.1's own `stdarch` source rather than assumed: `pub unsafe fn v128_load(m: *const
  v128) -> v128 { m.read_unaligned() }` -- "there is no alignment requirement on this pointer
  since this intrinsic performs a 1-aligned load" -- so the natural 4-byte alignment of an
  `&[f32]`/`&[u32]` slice element is never a soundness concern here, only the length bound is.
- **`pmndrs_glyph_mtsdf_generate`'s result pointer** (`mtsdf-baker/src/wasm.rs:96-129`): at
  first read this looked like a dangling-pointer bug -- `output: &[u8]` is captured from
  `outline.generate_mtsdf(request.region)` and its raw `as_ptr()`/`len()` are stashed as the
  module's result, with no visible owner keeping the bytes alive past the call. I traced
  `generate_mtsdf` into `mtsdf-core/src/lib.rs:272-309` (outside this review's scope, read to
  close the question) and confirmed `generate_mtsdf_with_transform` returns `&mut
  self.generator.scratch.output`, i.e. a borrow of a `Vec<u8>` field embedded by value inside
  `MtsdfGenerator`, which is itself embedded by value inside the long-lived, leaked
  `WasmState` (`state.generator: MtsdfGenerator`, never dropped). The returned pointer is real,
  stable, module-owned memory, valid until the next `generate` call reuses the same scratch
  buffer -- exactly matching the documented ABI contract
  (`mtsdf-baker/src/abi_contract.rs:52`: `"ownership": "borrowed-until-next-generate"`). Not a
  bug; flagging only because it was the closest thing in this review to a false positive and is
  worth another reviewer not re-deriving from scratch.
- **`pmndrs_glyph_engine_update_batch`'s `core::mem::take(&mut state.update_batch)`**
  (`shaper/src/wasm.rs:633`): moves `update_batch` out of `state` so the per-entry closure can
  call `update(state, ...)` (which needs `&mut WasmState`) without a live second borrow of
  `state.update_batch` -- ordinary safe-Rust aliasing avoidance, not unsafe code, but worth
  recording that I checked `update()` never itself touches `state.update_batch` while the field
  is empty.
- **Allocation-table pointer stability** (all five `wasm.rs` files): `Allocation.pointer` is
  captured once via `bytes.as_mut_ptr()` after `bytes.resize(length, 0)` and before the
  `Allocation` is pushed into `Vec<Allocation>`; since moving/reallocating the *outer* `Vec`
  never touches an inner `Vec<u8>`'s own heap buffer, the recorded pointer stays valid for the
  allocation's lifetime regardless of how many other allocations are made or freed around it.
  `deallocate`'s exact `(pointer, length)` match makes a double-`dealloc` call an idempotent
  no-op rather than a double-free (the second call simply finds nothing to remove).
