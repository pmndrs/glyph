---
type: Reference
title: Rust codex — Unsafe Rust correctness and verification
description: Checkable rules on unsafe rust correctness and verification, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Unsafe Rust correctness, FFI boundary safety, and verification (2026)

### R1. Never round-trip a pointer through `usize` with a plain `as` cast when you need to keep its access rights — use `with_addr`/`map_addr`.
**Why:** A pointer has two components, an address and *provenance* (which allocation it may access, for how long, with what mutability); `usize` has no provenance slot, so `ptr as usize as *mut T` only reconstructs the address and either fabricates a pointer with no provenance or (if later cast back) relies on unstable, tool-hostile "exposed provenance" semantics. `with_addr`/`map_addr` copy the *original* pointer's provenance onto the new address instead of trying to reconstruct it.
**Applies to us:** Any tagged-pointer or bit-packed handle scheme over wasm linear-memory offsets (`kernel_lab.rs`, `cluster_state.rs`) should carry the base pointer through and re-derive addresses with `with_addr`, not synthesize raw addresses from an integer offset.
**Bad / Good:**
```rust
// Bad: address survives, provenance doesn't — Miri/strict-provenance tooling can flag the reborrow as invalid.
let raw = ptr as usize;
let tagged = (raw | FLAG) as *mut T;

// Good: provenance carried from `ptr`, only the address changes.
let tagged = ptr.map_addr(|addr| addr | FLAG);
```
**Source:** https://doc.rust-lang.org/std/ptr/index.html (Strict Provenance docs); stabilized in Rust 1.84.0, PR merged 2024-10-21: https://github.com/rust-lang/rust/pull/130350

### R2. Treat `expose_provenance`/`with_exposed_provenance` as a documented last resort, not a routine substitute for R1.
**Why:** `expose_provenance` records the pointer's provenance in a global side-table so a later `usize -> *mut T` cast can pick *some* matching provenance back up, but the docs state this "Exposed Provenance" story is "on much less solid footing than Strict Provenance" and "will not work (well) with tools like Miri and CHERI."
**Applies to us:** If any wasm ABI code stores a pointer as a bare `u32`/`usize` handle and later reconstitutes it, that reconstruction is exactly the exposed-provenance case — it will not be Miri-clean and should carry a comment explaining why strict provenance (R1) wasn't usable there (typically: the value crossed the actual JS/wasm boundary as an integer, so there is no live Rust pointer to `map_addr` from).
**Bad / Good:**
```rust
// Bad, unexplained: silently falls back to exposed provenance for no stated reason.
let p = addr as *mut T;

// Good: exposed provenance used deliberately, with the reason on record.
// SAFETY: `addr` came back across the wasm/JS boundary as a bare u32 handle;
// no live Rust pointer survives the round trip, so this must use exposed
// provenance. `addr` was produced by `expose_provenance` on allocation.
let p = core::ptr::with_exposed_provenance_mut::<T>(addr);
```
**Source:** https://doc.rust-lang.org/std/ptr/index.html; RFC 3559 (provenance exists as a concept, but explicitly leaves Stacked/Tree Borrows as future work): https://rust-lang.github.io/rfcs/3559-rust-has-provenance.html

### R3. Never let a `&mut T` coexist with any other live read or write to the same bytes (outside `UnsafeCell`), even transiently.
**Why:** The optimizer treats `&mut` as an LLVM-`noalias`-style exclusivity guarantee and reorders/elides reads and writes on that basis; the Rustonomicon's own `compute(&x, &mut x)` example shows a function that is correct when `input`/`output` don't alias silently returning a different, wrong result once the compiler is allowed to cache `*input` across the aliased call.
**Applies to us:** Any place two raw pointers are derived from the same wasm-linear-memory region and one is reborrowed as `&mut` (arena/bump allocators in `kernel_lab.rs`, cluster state buffers) — two overlapping `(ptr, len)` guest ranges materialized as one `&mut [T]` and one `&[T]`/`&mut [T]` is this exact bug.
**Bad / Good:**
```rust
// Bad: `input` and `output` can alias the same u32 — UB once optimized.
fn compute(input: &u32, output: &mut u32) {
    if *input > 10 { *output = 1; }
    if *input > 5 { *output *= 2; }
}

// Good: read once, no second aliased access through `input` is possible.
fn compute(input: &u32, output: &mut u32) {
    let v = *input;
    *output = if v > 10 { 2 } else if v > 5 { *output * 2 } else { *output };
}
```
**Source:** https://doc.rust-lang.org/nomicon/aliasing.html; https://doc.rust-lang.org/nomicon/references.html ("a mutable reference cannot be aliased" — the Nomicon notes Rust has not formally defined "aliased" beyond this)

### R4. Run Miri under both its default model (Stacked Borrows) and `-Zmiri-tree-borrows`; a failure under either is real signal.
**Why:** Miri's shipped default is still Stacked Borrows as of the current README; Tree Borrows is opt-in via `-Zmiri-tree-borrows` and is explicitly documented as "even more experimental than Stacked Borrows," with the maintainers warning that "it is likely that the eventual final aliasing model of Rust will be stricter than Tree Borrows" — i.e. code accepted under TB today could be declared UB later. Neither model is the official specification; RFC 3559 only established that provenance exists as a language concept and left the aliasing model itself to "future RFCs."
**Applies to us:** This is genuinely unsettled upstream — do not treat a Tree-Borrows-only pass as clearance. `shaper/src/engine/kernel_lab.rs` and `cluster_state.rs` (36 and 13 unsafe occurrences) are exactly the kind of hand-rolled-aliasing code where SB and TB can disagree.
**Source:** https://github.com/rust-lang/miri/blob/master/README.md (default model, `-Zmiri-tree-borrows`, `-Zmiri-disable-stacked-borrows` marked unsound); https://rust-lang.github.io/rfcs/3559-rust-has-provenance.html

### R5. Run Miri against the crate's logic compiled for a host target, not `wasm32-unknown-unknown`.
**Why:** Miri cross-interprets for arbitrary foreign targets via `--target`, but its own README's supported-target list is Tier-1-host-OS-oriented (Linux best supported; `s390x-unknown-linux-gnu` as the big-endian reference) and does not include `wasm32-unknown-unknown`; the Miri lead's own Dec 2025 retrospective says "we are currently looking for someone who wants to maintain Miri's support for wasm targets" — i.e. even the wasm-*adjacent* support that exists is unowned.
**Applies to us:** `wasm32-unknown-unknown` is this project's primary target, but Miri verification has to run the same `#![no_std]` + `alloc` logic against a host triple (e.g. `x86_64-unknown-linux-gnu`, with `MIRI_NO_STD`-style no-libstd sysroot builds for the `no_std` crates) as a proxy. Document this gap explicitly rather than assuming "we ran Miri" covers the actual shipped artifact's codegen.
**Source:** https://github.com/rust-lang/miri/blob/master/README.md; https://www.ralfj.de/blog/2025/12/22/miri.html (Dec 2025)

### R6. Never call `mem::uninitialized::<T>()`; there is no correct use of it.
**Why:** It is deprecated since Rust 1.39 and has the same effect as `MaybeUninit::uninit().assume_init()` — for nearly every `T` (any type with a validity invariant tighter than "any bit pattern"), producing an uninitialized value of that type is instantaneous UB the moment it's produced, independent of whether it's later read.
**Applies to us:** Grep for `mem::uninitialized` and `MaybeUninit::uninit().assume_init()` across the wasm ABI crates; any hit not wrapped around a type that is itself `MaybeUninit<_>` or a genuinely all-bit-patterns-valid primitive is a bug.
**Bad / Good:**
```rust
// Bad: instantaneous UB for almost any T.
let x: MyStruct = unsafe { core::mem::uninitialized() };

// Good: track uninitialized-ness in the type until every field is written.
let mut x = core::mem::MaybeUninit::<MyStruct>::uninit();
// ... write every field via `&raw mut` (see R7) ...
let x = unsafe { x.assume_init() };
```
**Source:** https://doc.rust-lang.org/core/mem/fn.uninitialized.html; https://doc.rust-lang.org/stable/std/mem/union.MaybeUninit.html

### R7. Initialize `MaybeUninit<T>` fields through `&raw mut (*ptr).field` + `.write(...)`, never by materializing an intermediate `&mut T`/`&mut Field`.
**Why:** Forming a safe reference to a struct that is still partially uninitialized is itself UB even before you touch the uninitialized fields, because references carry a validity invariant that the pointee is fully valid; `&raw mut` forms a raw pointer without asserting that, and `MaybeUninit::write` assigns without running `Drop` on the (nonexistent) old value.
**Applies to us:** Any bump-allocated struct construction in the baker/shaper `wasm.rs` files that builds a result record field-by-field in guest-visible memory should use this pattern rather than `let mut x: MaybeUninit<T> = ...; unsafe { (*x.as_mut_ptr()).field = v; }` (that line is technically the same raw-pointer-field-write, but reaching for `&mut *x.as_mut_ptr()` anywhere nearby reintroduces the hazard).
**Bad / Good:**
```rust
// Bad: `&mut *ptr` asserts the whole T is valid while only `name` is initialized.
let mut uninit: MaybeUninit<Foo> = MaybeUninit::uninit();
let r: &mut Foo = unsafe { &mut *uninit.as_mut_ptr() };
r.name = "Bob".to_string();

// Good: raw-pointer field access, no intermediate `&mut Foo`.
let mut uninit: MaybeUninit<Foo> = MaybeUninit::uninit();
let ptr = uninit.as_mut_ptr();
unsafe { (&raw mut (*ptr).name).write("Bob".to_string()); }
unsafe { (&raw mut (*ptr).list).write(vec![0, 1, 2]); }
let foo = unsafe { uninit.assume_init() };
```
**Source:** https://doc.rust-lang.org/stable/std/mem/union.MaybeUninit.html

### R8. Audit every `mem::zeroed`/`MaybeUninit::zeroed().assume_init()` call against the concrete instantiated type — it is only sound when the all-zero bit pattern is a valid value of that exact type.
**Why:** `zeroed()` is unconditionally sound only for types whose all-zero bit pattern satisfies their validity invariant (e.g. `u32`, `[u8; N]`); it is documented UB for references (`&T` must be non-null and aligned), `NonZero*`, and fieldless enums whose discriminant 0 isn't a declared variant — and this is a property of the *monomorphized* type, so it must be re-checked at every generic instantiation, not just the first time a call site is written.
**Applies to us:** `#[repr(C)]` result structs shared with JS that embed `Option<&T>`/`NonNull<T>`/enum tags must not be produced via a blanket `zeroed()` "clear the struct" helper unless every field is independently zero-valid.
**Bad / Good:**
```rust
// Bad: UB the instant the reference type is instantiated.
let x: &i32 = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };

enum NotZero { One = 1, Two = 2 }
let pair = unsafe { core::mem::MaybeUninit::<(u8, NotZero)>::zeroed().assume_init() }; // UB: NotZero has no 0 discriminant

// Good: zero only the fields that are actually zero-valid; construct the rest explicitly.
let pair = (0u8, NotZero::One);
```
**Source:** https://doc.rust-lang.org/stable/std/mem/union.MaybeUninit.html

### R9. In a SAFETY comment, say explicitly whether you are upholding a *validity* invariant (must hold at every typed access, compiler-exploited) or a *safety* invariant (only enforced at the safe/unsafe boundary) — they are discharged differently.
**Why:** A validity invariant (e.g. "this `bool` is 0 or 1," "this reference is non-null and aligned") must hold every time the value is touched in a typed way, including inside otherwise-arbitrary unsafe code, because the compiler actively optimizes on it; a safety invariant (e.g. "this `Vec`'s capacity accounting is consistent") only has to hold at the point control crosses back into safe code — unsafe code is allowed to transiently violate it internally. Conflating the two leads to either over-cautious code or, worse, code that thinks a transient safety-invariant violation is fine when it's actually a validity violation the optimizer can already see.
**Applies to us:** General — applies to any SAFETY comment written across the ~180+ unsafe occurrences in the wasm ABI/engine modules; the distinction determines whether an invariant can be "fixed up before returning to safe code" or must never be false, full stop.
**Source:** https://www.ralfj.de/blog/2018/08/22/two-kinds-of-invariants.html; glossary: https://rust-lang.github.io/unsafe-code-guidelines/glossary.html

### R10. Only rely on field order, size, alignment, and enum-tag layout across the `extern "C"` wasm boundary for types explicitly `#[repr(C)]` (or `#[repr(u*)]`/`#[repr(i*)]` for fieldless enums) — plain `#[repr(Rust)]` types have no defined layout at all.
**Why:** `#[repr(C)]` is documented to match field ordering, size, and alignment to the C ABI; `repr(Rust)` layout is unspecified and the compiler is free to reorder fields, differ between builds, or differ between monomorphizations of the "same" generic type. `rustc`'s `improper_ctypes_definitions` lint (warn-by-default) already flags non-FFI-safe *types* in `extern "C"` signatures, e.g. it rejects `&str`/`String` and suggests `*const u8` plus a length — the same pointer/length convention this project already uses.
**Applies to us:** Every struct handed across `shaper/src/wasm.rs`, `mtsdf-baker/src/wasm.rs`, `slug-baker/src/wasm.rs`, `font-baker/src/wasm.rs` boundaries needs `#[repr(C)]`; a plain struct that "happens to work" today is one compiler upgrade from silently reordering.
**Bad / Good:**
```rust
// Bad: layout unspecified, and `&str` isn't C-ABI-safe to begin with.
pub extern "C" fn describe(p: &str) { /* ... */ }

// Good: explicit repr(C) result type, pointer+length instead of &str.
#[repr(C)]
pub struct GlyphResult { pub advance: f32, pub flags: u32 }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn shape(ptr: *const u8, len: usize) -> GlyphResult { /* ... */ }
```
**Source:** https://doc.rust-lang.org/nomicon/other-reprs.html; https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html#improper-ctypes-definitions

### R11. Do not assume a `#[repr(transparent)]` wrapper keeps its inner type's niche/ABI properties once nested inside another generic or enum.
**Why:** `repr(transparent)` guarantees the wrapper's own layout and ABI are identical to its single non-ZST field, but that guarantee does not propagate through nesting — the Nomicon calls out that `UnsafeCell` itself needs the unstable `no_niche` attribute specifically because its ABI is *not* guaranteed to be preserved when nested inside other types.
**Applies to us:** If a `#[repr(transparent)]` newtype wraps a `NonNull<T>` (for a niche-optimized `Option<Handle>`) and that newtype is later embedded in a generic container passed across FFI, the niche optimization is not something to depend on without independently re-verifying layout (e.g. with a `const _: () = assert!(size_of::<Option<Wrapper<T>>>() == size_of::<Wrapper<T>>());`).
**Source:** https://doc.rust-lang.org/nomicon/other-reprs.html

### R12. Never take `&`/`&mut` to a field of a `#[repr(packed)]` (or `packed(n)` with `n` less than the field's natural alignment) struct — copy the value out first.
**Why:** A packed field can be under-aligned relative to its type's required alignment; forming a reference asserts that alignment holds, so the reference itself is already UB before any dereference, and the compiler has no reliable way to "paper over" the misalignment for you.
**Applies to us:** Any wire-format struct read directly out of the wasm ABI's byte buffer that uses `packed` to avoid padding must copy fields (`let v = s.field;`) rather than borrow them.
**Bad / Good:**
```rust
#[repr(packed)]
struct Header { flag: u8, len: u32 }

// Bad: `&h.len` may be misaligned — UB to even form the reference.
fn read_len(h: &Header) -> u32 { h.len }          // implicit `&h.len` under the hood in some patterns

// Good: copy the (possibly misaligned) field by value.
fn read_len(h: &Header) -> u32 { let len = h.len; len }
```
**Source:** https://doc.rust-lang.org/nomicon/other-reprs.html

### R13. Never `transmute::<&T, &mut T>` a shared reference into a mutable one, by any route (direct transmute, pointer-cast-then-reborrow, `UnsafeCell` misuse without actual interior mutability).
**Why:** The Nomicon states this is unconditionally UB — "No you can't do it. No you're not special" — because the optimizer assumes data behind a live `&T` will not change for the duration of that borrow, regardless of what the code that produced the `&mut T` intends to do with it.
**Applies to us:** General; a search for `transmute` combined with `*const` → `*mut` casts followed by a reborrow anywhere in the ~180 unsafe sites is worth an explicit audit pass.
**Source:** https://doc.rust-lang.org/nomicon/transmutes.html

### R14. Never `transmute` between two instantiations of a generic `repr(Rust)` container (e.g. `Vec<A>` to `Vec<B>`) on the assumption that `size_of::<A>() == size_of::<B>()` is enough.
**Why:** `mem::transmute`'s only compiler-enforced condition is that the *outer* types have equal size; it does not check field layout, and `repr(Rust)` gives no layout guarantee even between two monomorphizations of the same generic struct. Only `repr(C)` and `repr(transparent)` types have a layout precise enough to transmute safely.
**Applies to us:** Any "reinterpret this typed arena/buffer as a different element type" trick in `kernel_lab.rs`/`cluster_state.rs` needs the target type to be `repr(C)`/`repr(transparent)`, or needs to go through `bytemuck`/`zerocopy` (R16/R17) instead of a bare `transmute`.
**Source:** https://doc.rust-lang.org/nomicon/transmutes.html

### R15. `mem::transmute_copy::<T, U>` is UB if `size_of::<U>() > size_of::<T>()` — it has none of `transmute`'s size check.
**Why:** `transmute_copy` reads `size_of::<U>()` bytes starting at `&T`'s address regardless of how large `T` actually is; unlike `transmute`, the compiler performs no size-equality check at all, so a size mismatch is a straightforward out-of-bounds read rather than a compile error.
**Applies to us:** If used anywhere as a shortcut to avoid `transmute`'s equal-size restriction, confirm the size relationship is checked (`const _: () = assert!(size_of::<U>() <= size_of::<T>());`) next to the call.
**Source:** https://doc.rust-lang.org/nomicon/transmutes.html

### R16. Prefer `bytemuck` (`Pod`/`Zeroable`/`cast`/`from_bytes`) over a hand-rolled `transmute` or pointer-cast for plain-old-data reinterpretation.
**Why:** `bytemuck`'s `Pod`/`Zeroable`/etc. traits are `unsafe` to implement but the crate checks size/alignment/validity preconditions *at the cast call site* (or via a `#[derive]` that verifies the type qualifies), rather than only offering a compile-time size check the way raw `transmute` does; it is `no_std`-by-default (no features required for the core API; `alloc` support is opt-in via `extern_crate_alloc`).
**Applies to us:** Reinterpreting wasm-linear-memory byte buffers as typed slices (glyph records, path commands) in the baker/shaper `wasm.rs` files is exactly bytemuck's use case; it's a small, `no_std`-clean dependency, which fits the project's `no_std + alloc` constraint.
**Bad / Good:**
```rust
// Bad: transmute checks only that sizes match; alignment/validity are on you.
let floats: &[f32] = unsafe { core::mem::transmute(bytes) };

// Good: bytemuck checks alignment and size, returns a Result instead of UB on mismatch.
let floats: &[f32] = bytemuck::try_cast_slice(bytes).map_err(|_| Error::Misaligned)?;
```
**Source:** https://docs.rs/bytemuck/latest/bytemuck/

### R17. For structured/DST byte-buffer parsing where a cast can legitimately fail at runtime (attacker-controlled wasm input), prefer `zerocopy`'s `TryFromBytes`/`FromBytes`/`IntoBytes` over `bytemuck`'s infallible casts or a raw `transmute`.
**Why:** `zerocopy` is `no_std` by default (`alloc`/`std` opt-in) and its `TryFromBytes` performs an actual runtime validity check of the byte pattern before handing back a typed value, rather than assuming the caller already validated it; `bytemuck` is better suited to trusted, already-well-formed POD (see R16), while `zerocopy` is the documented choice "for structs (possibly dynamically sized)."
**Applies to us:** Parsing a guest-supplied, length-prefixed record whose validity can't be assumed (as opposed to internal engine buffers you fully control) is the `TryFromBytes` case, not the `bytemuck::cast` case.
**Source:** https://docs.rs/zerocopy/latest/zerocopy/

### R18. `slice::from_raw_parts[_mut]`'s data pointer must be non-null and properly aligned for `T` even when `len == 0`; use `NonNull::<T>::dangling()` for an empty guest buffer instead of a bare null/zero cast.
**Why:** The stable docs are explicit that alignment and non-null are required "even for zero-length slices," in part because enum-layout niche optimizations rely on references (including zero-length slices) being non-null and aligned to distinguish them from other bit patterns — this holds regardless of whether any byte is ever actually read.
**Applies to us:** Any wasm export that treats a `(0, 0)` `(ptr, len)` pair from JS as "no data" must not build the resulting slice from the literal `0` pointer JS sent; it must special-case it to `NonNull::dangling()` (or an equivalent aligned sentinel) before calling `from_raw_parts`.
**Bad / Good:**
```rust
// Bad: if `ptr` is genuinely 0 (JS passed no buffer), this is UB even at len == 0.
let s: &[u8] = unsafe { core::slice::from_raw_parts(ptr as *const u8, len) };

// Good: substitute a dangling-but-aligned pointer for the empty case.
let data_ptr = if len == 0 { core::ptr::NonNull::<u8>::dangling().as_ptr() } else { ptr as *mut u8 };
let s: &[u8] = unsafe { core::slice::from_raw_parts(data_ptr, len) };
```
**Source:** https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html; https://doc.rust-lang.org/std/ptr/struct.NonNull.html

### R19. Reject a guest-supplied `(ptr, len)` pair before constructing a slice if `len * size_of::<T>()` would exceed `isize::MAX` or would overflow the address space when added to the pointer.
**Why:** `slice::from_raw_parts` requires the total byte size to be no larger than `isize::MAX` and requires `data + len * size_of::<T>()` not to "wrap around" the address space; this is a real, checkable precondition, not a theoretical one, when `len` originates from untrusted JS input rather than from a Rust-side `Vec`/`Box` that already upholds it.
**Applies to us:** Every `extern "C"` entry point that takes a JS-supplied length needs an explicit `len.checked_mul(size_of::<T>())` (or equivalent) bounds check ahead of any `from_raw_parts` call — this is exactly the class of check that "it's a u32 from JS, so it's small" reasoning skips.
**Source:** https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html

### R20. `ptr.add`/`ptr.sub`/`ptr.offset` require the *entire byte range* between the start pointer and the result to lie within one allocation — not just the destination address.
**Why:** The stable docs specify that when the computed offset is non-zero, `self` must be derived from a pointer to some allocation and "the entire memory range between `self` and `result`" must be in bounds of that allocation; computing an intermediate pointer that briefly leaves the allocation is UB even if it is never dereferenced and even if the final pointer lands back in bounds.
**Applies to us:** Arena/bump-pointer arithmetic in `kernel_lab.rs` that computes a candidate offset, checks it, and only *then* decides whether to use it must do the bounds check on the integer address before forming the pointer via `add`/`offset`, not compute the out-of-range pointer first and validate second.
**Source:** https://doc.rust-lang.org/std/primitive.pointer.html (`offset`/`add`/`sub` safety sections)

### R21. Treat "the address is inside the wasm instance's current linear memory" as necessary but not sufficient to validate a guest pointer — also recheck against the *current* `memory.size()` at the time of use, check alignment for the target `T`, and check the byte range doesn't overlap any other range currently lent out as `&mut`.
**Why:** Linear memory can grow between when a handle/offset was captured and when it's used, so a bound computed once can be stale by the time of the actual access; `wasmtime`'s own `GuestPtr` type documents this precisely — "presence of a `GuestPtr` does not imply any form of validity. Pointers can be out-of-bounds, misaligned, etc." — construction is deliberately unchecked, and it is only the `GuestMemory::read`/`write` accessor methods that perform real validation. "In bounds" alone also says nothing about whether the range aliases another live Rust reference over the same bytes (R3).
**Applies to us:** This is the central hazard for `shaper/src/wasm.rs`, `mtsdf-baker/src/wasm.rs`, `slug-baker/src/wasm.rs`, `font-baker/src/wasm.rs` (68+28+25+12 unsafe occurrences) — a raw `extern "C"` ABI without wasm-bindgen means there is no framework-level guest-pointer validation layer; every one of these boundary functions is this project's own `GuestMemory::read`.
**Source:** https://docs.wasmtime.dev/api/wiggle/struct.GuestPtr.html

### R22. Prefer opaque handle tables (index + generation counter) over raw guest pointers/indices for any resource that outlives a single `extern "C"` call.
**Why:** A raw pointer or bare index handed back to Rust by JS after the underlying slot was freed and reused is indistinguishable, at the type level, from a still-live handle to the original resource — there is no way to check "is this the same logical object" from the bits alone. A generation counter stored alongside the slot and echoed back as part of the handle turns "use after free/reuse" from silent memory corruption into a checkable, rejectable mismatch.
**Applies to us:** Any long-lived engine object exposed to JS across multiple calls (a shaping context, a baked-atlas handle, a cluster/arena id in `cluster_state.rs`) should be a `{index, generation}` handle validated on every entry, not a raw pointer JS is trusted to keep valid.
**Bad / Good:**
```rust
// Bad: `id` is a bare arena index; a freed-then-reused slot is indistinguishable.
pub unsafe extern "C" fn use_context(id: u32) { /* looks up arena[id] directly */ }

// Good: generation must match, or the call is rejected instead of touching a reused slot.
#[repr(C)]
pub struct Handle { index: u32, generation: u32 }
pub unsafe extern "C" fn use_context(h: Handle) -> i32 {
    match arena.get(h.index) {
        Some(slot) if slot.generation == h.generation => { /* ... */ 0 }
        _ => ERR_STALE_HANDLE,
    }
}
```
**Source:** https://docs.wasmtime.dev/api/wiggle/struct.GuestPtr.html (validity is never implied by presence — the general principle this pattern is answering); general handle-table/generational-index design as used in this precedent.

### R23. Prefer explicit `(ptr, len)` pairs over NUL-terminated C strings for any guest-supplied text crossing the wasm ABI.
**Why:** A NUL-terminated-string reader has to scan forward from `ptr` looking for a `0` byte with no independently known upper bound; if the guest didn't actually place a NUL within the mapped region (malicious or simply buggy JS), that scan reads out of the intended buffer until it happens to find a zero byte somewhere else in linear memory — an explicit length makes the read bound a value you validate up front (R19), not a value you discover by reading past the end.
**Applies to us:** This project already exports a raw pointer/length ABI rather than wasm-bindgen's `CString`-flavored conveniences — R23 is confirming that choice is correct for the FFI boundary, not proposing a change; the actionable check is that no route in `wasm.rs` regresses to a `CStr::from_ptr`-style NUL scan for guest data.
**Source:** https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html#improper-ctypes-definitions (rustc's own recommendation for `&str`/`String` at the C boundary is "consider using `*const u8` and a length instead")

### R24. Do not rely on `catch_unwind` at a wasm `extern "C"` entry point built with `panic = "abort"` — it will not catch anything there.
**Why:** The stable docs state plainly that `catch_unwind` "only catches unwinding panics, not those that abort the process," and a panic under `panic = "abort"` *is* an aborting panic by construction — so a `catch_unwind` wrapper around an exported function in this project's release profile is dead code that provides no actual recovery.
**Applies to us:** The release profile is `panic = "abort"` (given); if any boundary function wraps itself in `catch_unwind` believing it degrades a panic to a returned error code, that belief is false for the shipped artifact, even if it appears to work in a host-side `cargo test` that defaults to `panic = "unwind"`.
**Source:** https://doc.rust-lang.org/std/panic/fn.catch_unwind.html

### R25. Given R24, every `extern "C"` entry point must be panic-free by construction for all attacker/guest-controlled inputs — a panic is a whole-instance abort, not a per-call error path.
**Why:** With no working `catch_unwind` net, `unwrap()`/`expect()`/slice-indexing/integer-overflow (in debug)/`assert!` reachable from guest-controlled `(ptr, len)` values or JS-controlled numeric parameters terminates the *entire* wasm instance (and, depending on the host, may take the whole page/worker down with it) rather than failing just that call.
**Applies to us:** Every validated boundary function (R19–R22) should return an error code/result rather than `unwrap`; this is a stronger requirement here than in a typical `panic = "unwind"` host binary, precisely because of R24.
**Source:** https://doc.rust-lang.org/std/panic/fn.catch_unwind.html; project context (`panic = "abort"` release profile)

### R26. Never let a panic actually unwind out of a plain `extern "C"` function — if a boundary function might unwind in some build (e.g. a host test harness using the default `panic = "unwind"`), declare it `extern "C-unwind"` instead of leaving it `extern "C"`.
**Why:** A Rust-defined `extern "C"` function is compiled on the assumption that it never unwinds (LLVM `nounwind`); historically, panicking across such a boundary was UB, which is exactly what motivated RFC 2945's `extern "C-unwind"` ABI and the `AbortUnwindingCalls` codegen pass, which forces a clean process abort at the boundary instead of letting the unwind continue into UB territory. Whether a given toolchain resolves the plain-`"C"` case to "defined abort" or leaves a residual UB corner is not settled enough to lean on — the safe reading is "don't let it happen" regardless of which mitigation currently applies.
**Applies to us:** Moot for the actual wasm release artifact (panic=abort means nothing unwinds anywhere, see R24/R25), but relevant the moment any of these `extern "C"` functions are called from host-side Rust tests/benches built with the ordinary `panic = "unwind"` dev profile.
**Source:** https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html; https://github.com/rust-lang/rust/issues/83116 ("C-unwind" ABI is unsound with panic=abort — the class of bug this ABI split exists to close)

### R27. In an `unsafe fn` body, wrap each unsafe operation in its own explicit `unsafe {}` block.
**Why:** `unsafe_op_in_unsafe_fn` is warn-by-default starting in edition 2024 (it was allow-by-default through 2021); the old behavior let an `unsafe fn`'s entire body perform unsafe operations without any block, which hid exactly which lines needed a safety justification. `cargo fix --edition` can mechanically add the blocks, but the safety comments (R31) still need to be written by hand.
**Applies to us:** With Rust 1.97.1 / edition 2024 already in use, this should already be enforced by the toolchain default; confirm no crate-level `#![allow(unsafe_op_in_unsafe_fn)]` is silencing it.
**Bad / Good:**
```rust
// Bad in edition 2024 (warns): bare unsafe op with no block inside an unsafe fn.
unsafe fn get_unchecked<T>(x: &[T], i: usize) -> &T {
    x.get_unchecked(i)
}

// Good: explicit block, ready for a SAFETY comment.
unsafe fn get_unchecked<T>(x: &[T], i: usize) -> &T {
    // SAFETY: caller guarantees `i < x.len()`.
    unsafe { x.get_unchecked(i) }
}
```
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html

### R28. Every `extern` block is `unsafe extern` in edition 2024; mark individual imported items `safe fn`/`safe static` only for the ones truly callable with no precondition, for any input.
**Why:** The compiler cannot verify that a hand-written `extern` signature matches the actual foreign definition; a mismatch is UB, so edition 2024 requires the block itself to be marked `unsafe extern` to put that responsibility on record, while still letting specific, genuinely-safe-for-all-inputs items opt back into safe-to-call status with `safe fn`/`safe static`.
**Applies to us:** Any `extern "C" { ... }` import block declaring host-provided functions the wasm module calls into needs the `unsafe extern` wrapper; don't blanket-mark every imported item `safe` just to avoid `unsafe` at call sites — only items that hold for literally any argument qualify.
**Bad / Good:**
```rust
// Bad in edition 2024 (rejected): extern block missing `unsafe`.
extern "C" {
    fn host_log(ptr: *const u8, len: usize);
}

// Good: block is unsafe extern; `sqrt` truly has no unsafe precondition so it's `safe fn`.
unsafe extern "C" {
    pub safe fn sqrt(x: f64) -> f64;
    pub unsafe fn host_log(ptr: *const u8, len: usize);
}
```
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html; RFC 3484: https://rust-lang.github.io/rfcs/3484-unsafe-extern-blocks.html

### R29. `#[no_mangle]`, `#[export_name = ..]`, and `#[link_section = ..]` require `#[unsafe(...)]` wrapping in edition 2024 — attach a comment about symbol-collision uniqueness, since that's the actual hazard.
**Why:** These attributes reach into the global, cross-library symbol/linker namespace in ways the compiler cannot check; a colliding symbol name between two linked crates is a real, observed miscompilation/crash vector, not a hypothetical one, which is why edition 2024 makes the `unsafe` explicit at the attribute site rather than only at nearby unsafe blocks.
**Applies to us:** Every exported wasm ABI function (the entire raw C-ABI surface this project ships) uses `#[no_mangle]` (or `#[export_name]`); each one needs `#[unsafe(no_mangle)]` plus a short justification that the exported symbol name is unique across the built module.
**Bad / Good:**
```rust
// Bad (rejected on edition 2024): bare #[no_mangle].
#[no_mangle]
pub extern "C" fn shape_text() { /* ... */ }

// Good: explicit unsafe wrapper with the actual hazard on record.
// SAFETY: `shape_text` is unique across this crate's exported symbol table.
#[unsafe(no_mangle)]
pub extern "C" fn shape_text() { /* ... */ }
```
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html; RFC 3325: https://github.com/rust-lang/rfcs/pull/3325

### R30. Never form `&`/`&mut` to a `static mut` item; use `&raw const`/`&raw mut`, or migrate the state to `UnsafeCell`/atomics/`OnceLock`.
**Why:** `static_mut_refs` is warn-by-default (tracking issue #114447): any two references to the same mutable static are trivially aliasable from unrelated call sites with no borrow-checker relationship between them, which is exactly the aliasing hazard R3 describes, just at `'static` scope where it's easy to lose track of. `&raw const`/`&raw mut` obtain a pointer without asserting the reference-level "no other access" guarantee up front.
**Applies to us:** Any global arena/kernel-state singleton in `kernel_lab.rs`/`cluster_state.rs` implemented as `static mut` needs every access audited for this. It is also exactly the pattern that turns reentrancy into a live bug rather than a theoretical one: if an exported entry point holds a raw pointer/reference into this state while it calls an imported host `extern "C"` function that (directly or indirectly) calls back into another exported entry point before the first returns, the two invocations alias the same static — on one thread, with no data-race detector to catch it. Treat non-reentrancy as an explicit, documented precondition of any exported function that touches this state and calls out to host code.
**Bad / Good:**
```rust
static mut ARENA: [u8; 4096] = [0; 4096];

// Bad (warns): reference to a mutable static.
let a = unsafe { &mut ARENA };

// Good: raw pointer, no reference-level aliasing assertion.
let a = unsafe { &raw mut ARENA };
```
**Source:** https://doc.rust-lang.org/std/keyword.static.html; tracking issue: https://github.com/rust-lang/rust/issues/114447

### R31. A `// SAFETY:` comment must state which concrete precondition(s) are discharged and why, referencing the actual values in scope at that call site — not restate the callee's `# Safety` doc section.
**Why:** The Rust standard library's own policy separates the two: a `# Safety` doc section on an `unsafe fn` specifies the contract callers must uphold in general; a `// SAFETY:` comment at a specific call site has to show *why this particular call* satisfies that contract, e.g. "SAFETY: just checked that `mid` is on a char boundary" — a comment that just repeats "this is safe because the caller ensures X" without saying how X is true here is not doing the job.
**Applies to us:** With 68+36+28+25+13+12 unsafe occurrences concentrated in a handful of files, a repo-wide sweep that finds SAFETY comments merely echoing function docs (rather than justifying the local call) is worth flagging as technical debt even where `undocumented_unsafe_blocks` (R33) would already pass.
**Bad / Good:**
```rust
// Bad: restates the general contract, proves nothing about this call.
// SAFETY: caller must ensure `idx` is in bounds.
let v = unsafe { *ptr.add(idx) };

// Good: shows why the contract holds *here*.
// SAFETY: `idx < len` was checked above, and `ptr` was validated against the
// current `memory.size()` for `len` elements at function entry (see `validate_range`).
let v = unsafe { *ptr.add(idx) };
```
**Source:** https://std-dev-guide.rust-lang.org/policy/safety-comments.html

### R32. Every `pub unsafe fn` (and `unsafe trait`/`unsafe impl`) must have a `# Safety` doc section enumerating the caller's obligations — ownership, valid range, lifetime, alignment, reentrancy, concurrency.
**Why:** `clippy::missing_safety_doc` (pedantic) exists precisely because an `unsafe fn` with no stated contract forces every caller to reverse-engineer the precondition from the implementation, which drifts silently as the implementation changes; enabling the lint makes the absence a build-time signal instead of a code-review hope.
**Applies to us:** This is the natural companion to R31 for every unsafe function the wasm ABI crates export or use internally across module boundaries (not just the `extern "C"` surface — any `pub(crate) unsafe fn` shared between `wasm.rs` and the engine modules qualifies too).
**Bad / Good:**
```rust
// Bad: no stated contract.
pub unsafe fn start_apocalypse(u: &mut Universe) { unimplemented!() }

// Good.
/// # Safety
///
/// This function should not be called before the horsemen are ready.
pub unsafe fn start_apocalypse(u: &mut Universe) { unimplemented!() }
```
**Source:** https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/doc/mod.rs (`MISSING_SAFETY_DOC`, pedantic group)

### R33. Turn on `clippy::undocumented_unsafe_blocks` (restriction, opt-in) repo-wide as the mechanical floor under R31/R32.
**Why:** It's restriction-level, meaning it does not fire unless explicitly enabled in lint config, but once enabled it flags every `unsafe` block or `unsafe impl` with no `// SAFETY:` comment on the immediately preceding line(s) — the exact convention R31 describes. It has configuration knobs (`accept-comment-above-statement`, `accept-comment-above-attributes`) for comments that sit above a `let`/attribute rather than directly above the block.
**Applies to us:** Given the unsafe density in this codebase, enabling this lint (in `clippy.toml` / `#![warn(clippy::undocumented_unsafe_blocks)]` at crate root) is the cheapest way to guarantee no new unsafe block ships without at least *a* safety comment, even before judging comment quality (R31).
**Bad / Good:**
```rust
// Bad (lint fires): no SAFETY comment at all.
let ptr = unsafe { NonNull::new_unchecked(a) };

// Good.
// SAFETY: references are guaranteed to be non-null.
let ptr = unsafe { NonNull::new_unchecked(a) };
```
**Source:** https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/undocumented_unsafe_blocks.rs

### R34. Enable `clippy::multiple_unsafe_ops_per_block` (restriction, opt-in) to keep at most one unsafe operation per `unsafe {}` block.
**Why:** Combined with `undocumented_unsafe_blocks`, this forces each unsafe operation to get its own independent justification instead of one SAFETY comment trying to cover several different operations (a pointer cast *and* an unchecked conversion, say) whose preconditions are actually different. It counts operations only within the innermost enclosing `unsafe` block, treats a macro expanding to multiple unsafe ops as one operation, and doesn't count taking a raw pointer to a union field (which is safe).
**Applies to us:** Given the sheer count of unsafe occurrences here, this lint is the difference between a SAFETY comment reviewers can actually check against a single operation versus a paragraph trying to justify three things at once.
**Bad / Good:**
```rust
// Bad: two different unsafe ops justified by one comment.
// SAFETY: ptr is valid and in range.
let c = unsafe { char::from_u32_unchecked(*(ptr as *const u32)) };

// Good: each operation, and each precondition, stands alone.
// SAFETY: ptr is valid, aligned, and in range for a u32 read (checked above).
let code = unsafe { *(ptr as *const u32) };
// SAFETY: `code` was validated as a legal Unicode scalar value by the shaper before this point.
let c = unsafe { char::from_u32_unchecked(code) };
```
**Source:** https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/multiple_unsafe_ops_per_block.rs

### R35. Enable the `clippy::transmute*` lint family (`transmute_ptr_to_ptr`, `transmute_undefined_repr`, `missing_transmute_annotations`, `wrong_transmute`, `transmuting_null`, `transmute_null_to_fn`, `useless_transmute`, `eager_transmute`, `unsound_collection_transmute`) instead of relying on manual review to catch transmute misuse.
**Why:** These are individually narrow, mechanically checkable patterns (`transmute_null_to_fn` and `transmuting_null` are `correctness`-level: a transmuted null pointer used as a function pointer or reference is always UB; `transmute_undefined_repr` is `nursery`-level and flags transmuting to/from a type with no defined layout — exactly the R14 hazard; `missing_transmute_annotations` flags calls missing explicit generic parameters, which otherwise silently follow type inference into the wrong types).
**Applies to us:** Cheap, high-signal additions given this codebase's raw-pointer-and-buffer-reinterpretation style; several of these lints (`transmute_undefined_repr`, `unsound_collection_transmute`) are direct machine checks for rules R10/R14 above.
**Source:** https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/transmute/mod.rs

### R36. Add `cargo careful test` / `cargo careful run` (nightly) as a cheap host-side gate before reaching for Miri.
**Why:** `cargo-careful` rebuilds `std` itself with debug assertions enabled (assertions the normal rustup-distributed std has compiled out) and additionally catches invalid `bool`/`char`/enum-discriminant values produced via `zeroed()`/`transmute`, and reads of never-initialized `MaybeUninit` bytes — i.e. it mechanically enforces R6/R8 — at roughly 1.5x the runtime cost of a normal `cargo test` build, which is cheap enough to run routinely, unlike Miri.
**Applies to us:** Like Miri (R5), this only exercises a host-target build of the logic, not the actual `wasm32-unknown-unknown` artifact — but it's a fast enough gate to run on every CI push rather than reserved for periodic Miri sweeps.
**Source:** https://github.com/thomcc/cargo-careful

### R37. Do not expect `cargo-fuzz`/libFuzzer coverage, or Address/LeakSanitizer instrumentation, of the actual `wasm32-unknown-unknown` build artifact — both are host-target-only; fuzz/sanitize the same unsafe logic compiled for a host target as a proxy.
**Why:** libFuzzer's coverage/sanitizer instrumentation "needs LLVM sanitizer support," which the Rust Fuzz Book states works on "x86-64 Linux, x86-64 macOS and Apple-Silicon (aarch64) macOS, and Windows" — no wasm32. Separately, rustc's own stabilized AddressSanitizer/LeakSanitizer support (tracking issue #123617) lists stable sanitizer support only for specific Tier-1 host targets (e.g. `aarch64-apple-darwin`, `aarch64-unknown-linux-gnu`, `x86_64-*`); `wasm32-unknown-unknown` appears in neither the stable nor unstable sanitizer columns of that table.
**Applies to us:** This is almost certainly *why* `font-baker-fuzz` is described as "isolated to a dated nightly" rather than fuzzing the shipped wasm build directly — the fuzz target has to be the host-compiled version of the same unsafe parsing/baking logic. Make that proxy relationship explicit in the fuzz crate's documentation if it isn't already, so a future reader doesn't assume fuzzing covers wasm-specific codegen.
**Source:** https://rust-fuzz.github.io/book/cargo-fuzz.html; https://github.com/rust-lang/rust/issues/123617 (stabilization report and per-target sanitizer table)

### R38. Treat Kani, Creusot, and Verus as not yet applicable to this crate's wasm ABI shim layer in 2026 — at most, carve out isolated pure-logic modules for them, don't expect them to verify the boundary code itself.
**Why:** Kani's own stated scope is `#[kani::proof]` harnesses run on a Linux/macOS host via bounded model checking, with no stated `no_std`/`wasm32` support story; Creusot (Why3-based deductive verification) and Verus (SMT + ghost state) both require substantial upfront annotation and target more idiomatic, allocation-light Rust than a raw pointer/length C-ABI shim over `no_std + alloc`. None of the three is positioned, as of early 2026, as a drop-in check for FFI boundary code the way Miri or fuzzing are.
**Applies to us:** If model checking is worth pursuing at all here, the candidate is a self-contained, allocation-light algorithm (e.g. a specific layout/shaping invariant) extracted into its own pure function, not `kernel_lab.rs`/`cluster_state.rs`/the `wasm.rs` files wholesale. This assessment is lower-confidence than the other tooling rules in this file — it was not cross-checked against Creusot's or Verus's own current documentation this session, only against secondary summaries plus Kani's own README; verify directly before committing engineering time.
**Source:** https://github.com/model-checking/kani (README: "Rust 1.58+; Linux or Mac", `#[kani::proof]` harness model)

### R39. Budget for `wasm32-unknown-unknown` having no OS-level guard-page stack-overflow protection — deep or unbounded recursion reachable from guest input is silent heap corruption, not a trap.
**Why:** LLVM's shadow stack for this target lives in the low ~1 MiB of the module's own linear memory and grows downward as a plain `i32` global; there is no guard page the way native targets have one, so overflowing it underflows the stack pointer into heap memory with no trap at all. This is an open, unresolved rustc issue (#126747, filed 2024) with a working repro showing heap data silently corrupted by stack overflow on both `wasm32-unknown-unknown` and `wasm32-wasi` across multiple engines (wasmtime, wasmedge, Firefox, Chrome, Safari, Node).
**Applies to us:** Any recursive algorithm reachable from guest-controlled input — tree-structured layout/shaping recursion, recursive path/outline processing in the bakers — needs an explicit, checked depth bound rather than relying on "the runtime will stop us"; on this target, nothing stops you.
**Source:** https://github.com/rust-lang/rust/issues/126747 (open as of this research; includes minimal repro)

### R40. Before adding `unsafe impl Send`/`unsafe impl Sync` to any FFI handle or engine-state type, state explicitly what exclusive-access or synchronization guarantee makes it true — "it compiles without the impl" is not evidence.
**Why:** `Send`/`Sync` are marker traits with no methods, so an incorrect `unsafe impl` produces no compiler error at the impl site — the Nomicon is explicit that "something can safely be Send unless it shares mutable state with something else without enforcing exclusive access to it," and that a type is `Sync` only if concurrent `&T` access from multiple threads can never race with a write. The danger is entirely in code elsewhere trusting the impl.
**Applies to us:** `wasm32-unknown-unknown` is single-threaded by default, so this is low-urgency today, but any `unsafe impl Send`/`Sync` added for a future wasm-threads/shared-memory build (or for a host-side multi-threaded test harness reusing the same types) needs its justification on record before that door is opened, not after.
**Source:** https://doc.rust-lang.org/nomicon/send-and-sync.html
