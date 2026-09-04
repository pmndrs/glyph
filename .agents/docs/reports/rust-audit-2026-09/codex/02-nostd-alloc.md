---
type: Reference
title: Rust codex — no_std, alloc and fallible allocation
description: Checkable rules on no_std, alloc and fallible allocation, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

### R1. Make the opt-in `std` feature additive; never ship a `no_std` feature that turns std off
**Why:** Cargo unifies features across every crate that depends on a shared package within one resolve; a feature that *disables* functionality breaks the moment two dependents disagree, while a feature that only *adds* functionality is always safe to enable from anywhere in the graph.
**Applies to us:** All 12 first-party crates are no_std-by-default with std opt-in — exactly the shape the Cargo Book calls out by name. `std = []` (adds std re-exports/impls) is correct; a `no_std = []` feature would be wrong.
**Bad / Good:**
```toml
# Bad — feature removes functionality when enabled
[features]
default = ["no_std"]
no_std = []

# Good — feature adds functionality when enabled
[features]
default = []
std = []
```
**Source:** The Cargo Book, "Features" — "if you want to optionally support no_std environments, do not use a no_std feature. Instead, use a std feature that enables std." https://doc.rust-lang.org/cargo/reference/features.html (accessed 2026-09-03)

---

### R2. Declare `default-features = false` on every internal dependency edge, not just the leaf that needs it
**Why:** Cargo builds a shared dependency once per resolve using the union of every feature any dependent requested; one crate in the graph forgetting `default-features = false` turns default features back on for everyone else that depends on the same package, including a wasm-target build.
**Applies to us:** With 12 first-party crates depending on each other (e.g. `shaper` on `mtsdf-core`, `mtsdf-baker` on `mtsdf-fontations`), a single internal `path = "../x"` dependency declared without `default-features = false` silently re-enables that crate's default feature set for the whole workspace resolve.
**Bad / Good:**
```toml
# Bad — this crate's default features leak into the whole resolve
[dependencies]
mtsdf-core = { path = "../mtsdf-core" }

# Good — every consumer opts in explicitly
[dependencies]
mtsdf-core = { path = "../mtsdf-core", default-features = false }
```
**Source:** The Cargo Book, "Features" — "This can make it difficult to ensure that the default features are not enabled... Every package must ensure that default-features = false is specified to avoid enabling them." https://doc.rust-lang.org/cargo/reference/features.html (accessed 2026-09-03)

---

### R3. Guard genuinely exclusive features with a `compile_error!`; don't let feature unification combine them silently
**Why:** Feature unification ORs every feature reaching a build unit together; if two features encode mutually exclusive strategies, the union has to be rejected explicitly at compile time, or one silently wins/shadows the other with no diagnostic.
**Applies to us:** `simd128` is additive today (it only adds a `#[cfg(target_feature = "simd128")]` code path), so this is preventive — but the moment a second, incompatible SIMD strategy (e.g. a relaxed-simd kernel that can't coexist with the hand-rolled v128 one in the same build) becomes its own feature, this guard becomes load-bearing.
**Bad / Good:**
```rust
// Bad — both kernels can be enabled together with no diagnostic, one silently wins
#[cfg(feature = "simd128")]
mod simd128_kernel;
#[cfg(feature = "relaxed_simd")]
mod relaxed_simd_kernel;

// Good — the combination is rejected at compile time
#[cfg(all(feature = "simd128", feature = "relaxed_simd"))]
compile_error!("simd128 and relaxed_simd are mutually exclusive kernels");
```
**Source:** The Cargo Book, "Features" (additive-features rule and the mutually-exclusive-features / `compile_error!` pattern) https://doc.rust-lang.org/cargo/reference/features.html (accessed 2026-09-03)

---

### R4. Write `#![cfg_attr(not(feature = "std"), no_std)]` at the crate root, and `extern crate alloc;` right under it
**Why:** `core` and `std` are sysroot crates the compiler links automatically, but `alloc` is an *optional* sysroot crate that is deliberately left out of the implicit/extern prelude — unlike an ordinary Cargo.toml dependency (which, since edition 2018, needs no `extern crate` line at all), `alloc` still needs an explicit `extern crate alloc;` before `alloc::vec::Vec` or `alloc::string::String` resolve to anything.
**Applies to us:** All 12 crates are no_std + alloc by default; this is the literal first lines every crate root needs, and it's a one-line audit (`rg -L "extern crate alloc" $(rg -l 'cfg_attr.*no_std' packages/*/src/lib.rs)`).
**Bad / Good:**
```rust
// Bad — no_std is set, but alloc::vec::Vec doesn't resolve
#![cfg_attr(not(feature = "std"), no_std)]
use alloc::vec::Vec; // error[E0433]: failed to resolve: use of undeclared crate `alloc`

// Good
#![cfg_attr(not(feature = "std"), no_std)]
extern crate alloc;
use alloc::vec::Vec;
```
**Source:** `alloc` crate root docs, https://doc.rust-lang.org/alloc/index.html (accessed 2026-09-03) — "Crates that use the #![no_std] attribute however will typically not depend on std, so they'd use this crate instead."

---

### R5. Feature-gate every std-only `pub` item behind `#[cfg(feature = "std")]`; the no_std surface is the API's floor, not an afterthought
**Why:** A `pub` item that only compiles under `std` (anything touching `std::io`, `std::fs`, `std::time::Instant`, thread-based sync) breaks the `--no-default-features` build the moment someone adds it without a `cfg`, and the no_std configuration is only as trustworthy as the last time it was actually compiled and checked (see R6).
**Applies to us:** Host-tool-only surface (e.g. file I/O for `font-baker`'s CLI) must not leak into the default no_std build that targets `wasm32-unknown-unknown`.
**Bad / Good:**
```rust
// Bad — compiles by accident under std, breaks --no-default-features
pub fn load_font_from_path(p: &std::path::Path) -> Font { /* ... */ }

// Good
#[cfg(feature = "std")]
pub fn load_font_from_path(p: &std::path::Path) -> Font { /* ... */ }
```
**Source:** General Cargo/Rust feature-gating practice, cross-checked against The Cargo Book "Features," https://doc.rust-lang.org/cargo/reference/features.html (accessed 2026-09-03)

---

### R6. Build and check BOTH configurations in CI explicitly — default features alone proves nothing about no_std
**Why:** `cargo check`/`cargo test` with no flags only exercises whatever `default = [...]` happens to be; a std-only item guarded incorrectly (R5), a stray `std`-only macro, or a `std`-only trait impl duplicating a now-unnecessary shim (R10) will not be caught until someone actually runs `--no-default-features --target wasm32-unknown-unknown`.
**Applies to us:** The wasm32-unknown-unknown release build IS the shipped product; a CI matrix that only ever runs `cargo test` on the host with default features can go a long time without compiling the exact no_std configuration that ships.
**Bad / Good:**
```bash
# Bad — CI only ever exercises one feature combination
cargo test --workspace

# Good — both configurations, plus the real target, every run
cargo hack check --each-feature --workspace --no-dev-deps
cargo check --workspace --no-default-features --target wasm32-unknown-unknown
cargo test --workspace --all-features
```
**Source:** cargo-hack, https://github.com/taiki-e/cargo-hack (accessed 2026-09-03); Microsoft "Rust Engineering Practices" ch. 9 "no_std and Feature Verification," https://microsoft.github.io/RustTraining/engineering-book/ch09-no-std-and-feature-verification.html (accessed 2026-09-03)

---

### R7. Audit feature unification before adding a shared dependency; don't resolve the std host tool and the no_std wasm target in the same cargo invocation if they disagree on a dependency's features
**Why:** Cargo resolves a dependency once per unit graph and unions every requested feature onto it; a host-tool binary (std) and a wasm library (no_std) built together, both depending on the same third-party crate, get that crate built with the union of both feature sets — silently pulling std-gated code back into the wasm build's dependency tree.
**Applies to us:** `font-baker`'s CLI (std, host binary) sharing a dependency with `shaper`/`mtsdf-*`/`slug-*` (no_std, wasm) is exactly this shape; keep the wasm release build to its own `cargo build -p <crate> --target wasm32-unknown-unknown` invocation, and check with `cargo tree -e features` whenever a new shared dependency is added.
**Bad / Good:**
```bash
# Bad — one workspace-wide build can unify a shared dep's features
cargo build --workspace --release

# Good — the wasm target is resolved on its own
cargo build -p glyph-shaper --release --target wasm32-unknown-unknown --no-default-features
cargo tree -e features -p some-shared-dep --target wasm32-unknown-unknown
```
**Source:** The Cargo Book, "Features" — "When a dependency is used by multiple packages, Cargo will use the union of all features enabled on that dependency when building it." https://doc.rust-lang.org/cargo/reference/features.html (accessed 2026-09-03)

---

### R8. There is no `HashMap` in `alloc` — use `BTreeMap`, or vendor `hashbrown` directly with an explicit, fixed hasher
**Why:** `std::collections::HashMap` needs `RandomState`, which seeds itself from OS randomness that `core`/`alloc` cannot provide; `alloc::collections` therefore only exports `BinaryHeap`, `BTreeMap`, `BTreeSet`, `LinkedList`, and `VecDeque` — no hash map at all.
**Applies to us:** Any no_std lookup table (glyph-id → outline offset, codepoint → cluster) has to be either a `BTreeMap` (deterministic order, no hasher needed) or `hashbrown::HashMap` pinned to an explicit `BuildHasher` — never the std type, which won't even compile without `std`.
**Bad / Good:**
```rust
// Bad — does not exist in alloc
use alloc::collections::HashMap; // error: no `HashMap` in `alloc::collections`

// Good — deterministic, no_std-safe
use alloc::collections::BTreeMap;
let mut glyph_offsets: BTreeMap<GlyphId, u32> = BTreeMap::new();
```
**Source:** `alloc::collections` module docs (HashMap absent from the list), https://doc.rust-lang.org/alloc/collections/index.html (accessed 2026-09-03)

---

### R9. Treat `BTreeMap`/`BTreeSet` inserts as always-panicking-on-OOM — there is no `reserve` or `try_reserve` for them at all
**Why:** A `BTreeMap` allocates one tree node at a time as it grows rather than into a single contiguous buffer, so there is no capacity to pre-reserve; the standard library accordingly never shipped `reserve`/`try_reserve`/`try_reserve_exact` for any collection that isn't backed by a flat buffer (`Vec`, `String`, `VecDeque`, `BinaryHeap`).
**Applies to us:** A glyph/cluster registry keyed through a `BTreeMap` and grown from untrusted input size (glyph count from a font file, cluster count from arbitrary text) has no stable way to pre-check that the allocation will succeed before inserting — the insert itself can abort the program on OOM no matter how disciplined the rest of the crate is about `try_reserve`.
**Bad / Good:**
```rust
// Bad — assumes BTreeMap has the same fallible surface as Vec
map.try_reserve(font.glyph_count())?; // does not compile: no such method on BTreeMap

// Good — bound the untrusted size before building the map at all, or build it from
// a Vec grown via try_reserve and sort once, instead of incremental BTreeMap inserts.
let mut entries = Vec::new();
entries.try_reserve_exact(checked_glyph_count)?;
entries.extend(/* ... */);
entries.sort_unstable_by_key(|(k, _)| *k);
```
**Source:** `alloc::collections::btree_map::BTreeMap` docs (no reserve/try_reserve method present), https://doc.rust-lang.org/alloc/collections/btree_map/struct.BTreeMap.html (accessed 2026-09-03); rationale: https://www.nicolas-hahn.com/2020/11/30/btreemap-with-capacity/ (accessed 2026-09-03)

---

### R10. Implement `core::error::Error` directly — since 1.81.0 it IS `std::error::Error`; don't hand-roll a substitute or duplicate the impl per feature
**Why:** Rust 1.81.0 (released 2024-09-05) stabilized `core::error::Error`, and `std::error::Error` is now simply a re-export of that same trait — one `impl core::error::Error for MyError {}` (alongside `Debug`/`Display`) satisfies a no_std caller matching on `core::error::Error` and a std caller matching on `std::error::Error` with no duplication.
**Applies to us:** Every fallible boundary across the 12 crates (shaping, baking, admission errors) can use a single real `Error` impl in the default no_std build instead of a pre-1.81-style bespoke trait or a `core-error`-shim crate.
**Bad / Good:**
```rust
// Bad — pre-1.81 workaround duplicated per feature, or a hand-rolled trait
#[cfg(feature = "std")]
impl std::error::Error for ShapeError {}
#[cfg(not(feature = "std"))]
pub trait ErrorLike: core::fmt::Debug + core::fmt::Display {}

// Good — one impl, satisfies both configurations since 1.81.0
impl core::error::Error for ShapeError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> { self.cause.as_deref() }
}
```
**Source:** Rust 1.81.0 stabilizes the `Error` trait in `core`, https://www.infoworld.com/article/3511396/rust-1-81-stabilizes-error-trait.html (2024-09-05); `core::error::Error` docs, https://doc.rust-lang.org/core/error/trait.Error.html (accessed 2026-09-03, current stable 1.98.1)

---

### R11. Do float transcendentals through `libm`'s extension traits — `core`/`alloc` expose none
**Why:** `core::f32`/`core::f64` have no `sin`/`cos`/`atan2`/`pow`/`exp`/etc.; those inherent methods exist on the primitive types only when `std` links the platform C math library. `libm::F32Ext`/`F64Ext` are pure-Rust reimplementations of the same functions, usable identically with or without `std`.
**Applies to us:** Curve/angle math in `shaper`, `mtsdf-core`, and `slug-core` (`atan2`, trig for curve flattening, etc.) must go through `libm`, not `f64::sin()`, or the default no_std build simply fails to compile.
**Bad / Good:**
```rust
// Bad — compiles only because a test happened to run with `std` on
let angle = dx.atan2(dy); // f64::atan2 is a std-only inherent method

// Good — identical whether std is on or off
use libm::F64Ext;
let angle = dx.atan2(dy); // resolves through the libm extension trait
```
**Source:** `libm` crate docs, https://docs.rs/libm/latest/libm/ (accessed 2026-09-03)

---

### R12. Never split the same float computation across `#[cfg(feature = "std")]` into two implementations — write one, using `libm`, unconditionally
**Why:** Because `core::f64` has no `sin`, no_std-only code is naturally forced onto `libm`; but nothing stops a *std-gated* branch of the same function from being written against std's inherent `f64::sin`, which calls the host platform's C library — a different implementation not guaranteed to produce bit-identical results to `libm`'s pure-Rust one.
**Applies to us:** If `font-baker`'s std-enabled host CLI ever recomputes curve math that the no_std wasm shaper also computes (golden-file comparisons, or baking on host vs. shaping on wasm), a per-feature-gated math implementation turns "did my change regress the geometry" into "did my OS's libc change" — a false signal.
**Bad / Good:**
```rust
// Bad — two math backends for the same computation, will drift in low-order bits
#[cfg(feature = "std")]
fn curve_angle(dx: f64, dy: f64) -> f64 { dx.atan2(dy) }        // platform libm
#[cfg(not(feature = "std"))]
fn curve_angle(dx: f64, dy: f64) -> f64 { libm::atan2(dx, dy) } // pure-Rust libm

// Good — one implementation, identical bits regardless of the std feature
fn curve_angle(dx: f64, dy: f64) -> f64 { libm::atan2(dx, dy) }
```
**Source:** Cross-platform float-determinism discussion (platform libm/compiler-builtins divergence), https://rapier.rs/docs/user_guides/rust/determinism/ (accessed 2026-09-03); `libm` docs, https://docs.rs/libm/latest/libm/ (accessed 2026-09-03)

---

### R13. Use `try_reserve`/`try_reserve_exact` at every `Vec`/`String`/`VecDeque` growth point sized from untrusted input
**Why:** `Vec`, `String`, and `VecDeque` have shipped `try_reserve`/`try_reserve_exact` since Rust 1.57.0 (December 2021); calling it before a growth operation turns an OOM, or a capacity request that overflows `usize`, into a `Result` instead of an abort via the default infallible allocation path.
**Applies to us:** Glyph outline buffers, atlas rows, and shaping-cluster buffers all grow from sizes ultimately derived from an input font file or input text — sizes a malformed or adversarial file can inflate arbitrarily.
**Bad / Good:**
```rust
// Bad — a huge/malformed glyph count aborts the whole process
let mut outline = Vec::with_capacity(glyph.contour_count() * AVG_POINTS);

// Good — caller decides what to do with a failure
let mut outline = Vec::new();
outline.try_reserve_exact(checked_capacity)?;
```
**Source:** `Vec::try_reserve`/`try_reserve_exact`, "Since 1.57.0," https://doc.rust-lang.org/std/vec/struct.Vec.html (accessed 2026-09-03); RFC 2116, https://rust-lang.github.io/rfcs/2116-alloc-me-maybe.html (accessed 2026-09-03)

---

### R14. Don't assume `HashMap`'s fallible surface mirrors `Vec`'s — it has `try_reserve` but no `try_reserve_exact`
**Why:** `HashMap::try_reserve` is stable since 1.57.0, but `HashMap` (via its hashbrown-derived growth strategy) never got a `try_reserve_exact` counterpart; the "exact" variant only exists on the flat-buffer collections.
**Applies to us:** If a `hashbrown`-backed table is used anywhere behind a `std`-gated, host-tool-only code path, code ported from `Vec`-style "always call the `_exact` sibling" habits won't compile against `HashMap`.
**Bad / Good:**
```rust
// Bad — no such method
map.try_reserve_exact(n)?;

// Good — HashMap only has the (possibly over-allocating) form
map.try_reserve(n)?;
```
**Source:** `std::collections::HashMap` docs — `try_reserve` present ("Since 1.57.0"), no `try_reserve_exact` listed, https://doc.rust-lang.org/std/collections/struct.HashMap.html (accessed 2026-09-03)

---

### R15. Check the stabilization version per collection — `BinaryHeap::try_reserve` landed later (1.63.0), not with the original 1.57.0 batch
**Why:** RFC 2116's initial stabilization (1.57.0) covered `Vec`, `String`, `VecDeque`, `HashMap`/`HashSet`; `BinaryHeap::try_reserve`/`try_reserve_exact` shipped separately in 1.63.0 (August 2022) under a follow-up tracking issue for additional containers.
**Applies to us:** A blanket "try_reserve has been stable everywhere since 1.57" assumption is wrong for `BinaryHeap` (e.g. a priority queue over shaping candidates). The project's pinned 1.97.1 has both, but the per-type version matters for anyone auditing MSRV claims in this codebase.
**Bad / Good:**
```rust
// Bad — comment asserts an incorrect, blanket stabilization story
// try_reserve: stable everywhere since 1.57
heap.try_reserve(n)?;

// Good — cite the type-specific version
// BinaryHeap::try_reserve: stable since 1.63.0 (not 1.57.0 like Vec/String/HashMap)
heap.try_reserve(n)?;
```
**Source:** `BinaryHeap::try_reserve`/`try_reserve_exact`, "Since 1.63.0," https://doc.rust-lang.org/std/collections/struct.BinaryHeap.html (accessed 2026-09-03); tracking issue for try_reserve on more containers, https://github.com/rust-lang/rust/issues/91789 (opened 2021-12-11)

---

### R16. Treat `TryReserveError` as opaque on stable — don't branch on overflow-vs-OOM; `.kind()` is nightly-only
**Why:** `TryReserveError::kind()` and the `TryReserveErrorKind` enum that would distinguish `CapacityOverflow` (a bug — the requested size overflowed `usize`) from `AllocError` (a real OOM) sit behind the unstable `try_reserve_kind` feature (tracking issue #48043); stable code only gets an opaque, `Display`/`Debug`-able error.
**Applies to us:** Any handler that wants to "retry smaller on OOM but hard-fail on a bogus size" cannot make that distinction on stable 1.97.1 by inspecting `TryReserveError` — the size must be validated with checked arithmetic (R23–R27) *before* the `try_reserve` call, so overflow never reaches it as an indistinguishable case.
**Bad / Good:**
```rust
// Bad — does not compile on stable
match v.try_reserve(n) {
    Err(e) if matches!(e.kind(), TryReserveErrorKind::CapacityOverflow) => panic!("bug"),
    Err(e) => return Err(e.into()), // real OOM
    Ok(()) => {}
}

// Good — validate the size yourself; try_reserve then only ever means "OOM"
let n = element_count.checked_mul(element_size).ok_or(Error::SizeOverflow)?;
v.try_reserve(n).map_err(Error::Alloc)?;
```
**Source:** `TryReserveError::kind()`, marked "nightly-only experimental API (`try_reserve_kind` #48043)," https://doc.rust-lang.org/std/collections/struct.TryReserveError.html (accessed 2026-09-03)

---

### R17. Treat `allocator_api` as unstable and unplanned for this MSRV — as of Rust 1.98.1 (2026-09-03) it still has not shipped
**Why:** The custom-allocator machinery (`core::alloc::Allocator`, `Box::new_in`, `Vec::new_in`, and their fallible `try_new_in` siblings) has been nightly-only behind `#![feature(allocator_api)]` since 2019. A minimal, *infallible*, non-dyn-compatible stabilization slice (PR #156882, opened 2026-05-24, covering only the bare `Allocator` trait plus `Box::new_in`/`Vec::new_in`/`System`/`Global`) was still in its Final Comment Period and unmerged as of the most recent version this research could confirm — 1.98.1, two releases past this project's pinned 1.97.1 (2026-07-16).
**Applies to us:** Do not design engine-call-contract entry points, or any `Vec<T, A: Allocator>`-generic internal API, around `allocator_api` landing "soon" — it has been imminent for years, and even the subset now closest to landing does not include the fallible constructors R13 otherwise mandates.
**Bad / Good:**
```rust
// Bad — requires nightly, does not build on the pinned 1.97.1 toolchain
#![feature(allocator_api)]
pub struct Atlas<A: core::alloc::Allocator = alloc::alloc::Global> { rows: Vec<Row, A> }

// Good — stable today; swap the internal storage strategy later if/when it ships
pub struct Atlas { rows: Vec<Row> }
```
**Source:** rust-lang/rust PR #156882 "alloc: stabilise `Allocator`," https://github.com/rust-lang/rust/pull/156882 (opened 2026-05-24, in FCP disposition-merge as of fetch); "The Allocator API in 2026: Rust's Almost-There Feature That Refuses to Land," https://medium.com/@trivajay259/the-allocator-api-in-2026-rusts-almost-there-feature-that-refuses-to-land-d6f0f934d296; release index cross-check — no "Allocator"/"allocator_api"/"try_reserve" changelog entries for any version 1.90.0–1.98.1, https://doc.rust-lang.org/releases.html (accessed 2026-09-03)

---

### R18. If custom-allocator-generic collections are needed now, take a dependency on `allocator_api2`, not on `#![feature(allocator_api)]`
**Why:** `allocator_api2` mirrors the in-progress nightly `Allocator` trait definition but compiles on stable Rust; it's already the dependency `hashbrown` and `bumpalo` use for the same purpose, so adopting it doesn't add a novel, unvetted abstraction on top of R17's unstable feature.
**Applies to us:** An arena-per-bake-job allocator for `font-baker`/`mtsdf-baker` (freeing an entire batch's temporary allocations at once) is a legitimate motivation; reach for `allocator_api2` behind an internal feature so the crate keeps building on stable 1.97.1 while getting the ergonomics the real trait will eventually offer.
**Bad / Good:**
```toml
# Bad — pins the crate to nightly for a feature that keeps not landing (R17)
# requires `#![feature(allocator_api)]` or a nightly toolchain override

# Good — stable-compatible mirror, same shape as the eventual std trait
[dependencies]
allocator-api2 = { version = "0.2", default-features = false }
```
**Source:** "The State of Allocators in 2026," https://cetra3.github.io/blog/state-of-allocators-2026/ (2026, accessed 2026-09-03)

---

### R19. Reserve the full capacity a multi-step mutation needs *before* performing any of the steps — never interleave reserve-and-mutate when the batch must be all-or-nothing
**Why:** `try_reserve`'s own contract guarantees the collection is left unmodified if the reservation itself fails; that guarantee only protects a caller who reserves everything up front. Reserving incrementally inside a loop can still leave a collection partially mutated if a *later* iteration's reservation fails.
**Applies to us:** Appending a whole glyph's contours, or merging a whole shaped run's clusters, is naturally an all-or-nothing operation; computing the total additional length first (contour point count, cluster count) turns that into one `try_reserve` call instead of N.
**Bad / Good:**
```rust
// Bad — can succeed for iterations 0..k and fail at k+1, leaving a half-built contour
for point in points {
    outline.try_reserve(1)?;
    outline.push(point);
}

// Good — all-or-nothing: reserve once, then the loop cannot fail on allocation
outline.try_reserve(points.len())?;
outline.extend(points);
```
**Source:** RFC 2116 — "the Vec is unmodified if this occurs," https://rust-lang.github.io/rfcs/2116-alloc-me-maybe.html (accessed 2026-09-03)

---

### R20. Build the new value in a local, `try_reserve`'d scratch structure and swap it into shared/published state only after every fallible step has already succeeded
**Why:** There is no stable rollback for a sequence of fallible mutations spread across *multiple* collections or a shared structure (recall R9: a `BTreeMap` insert can't even be pre-reserved). The only way to guarantee shared state never observes a half-finished update is to finish the whole computation somewhere private first, then commit with one final, infallible move.
**Applies to us:** Publishing a newly-baked glyph into a shared atlas registry, or a newly-shaped run into a cache, must not mutate the shared `BTreeMap`/registry field-by-field across several fallible steps — build the complete new entry locally, then commit it in one step.
**Bad / Good:**
```rust
// Bad — registry can end up holding a half-populated glyph if step 3 OOMs
registry.insert(id, GlyphEntry::new());
registry.get_mut(&id).unwrap().outline.try_reserve(n)?;
registry.get_mut(&id).unwrap().outline.extend(points); // shared state already mutated

// Good — nothing touches `registry` until the entry is fully built
let mut outline = Vec::new();
outline.try_reserve_exact(n)?;
outline.extend(points);
let entry = GlyphEntry { outline /* , ... */ };
registry.insert(id, entry); // BTreeMap insert is the one remaining panic-on-OOM step (R9), now atomic
```
**Source:** Derived from RFC 2116's reserve-then-mutate guarantee (R19) combined with `BTreeMap`'s lack of `try_reserve` (R9), https://rust-lang.github.io/rfcs/2116-alloc-me-maybe.html (accessed 2026-09-03)

---

### R21. Grep `try_reserve`-disciplined, untrusted-input modules for the infallible allocation entry points that quietly reintroduce an abort-on-OOM path
**Why:** `vec![x; n]`, `.to_vec()`, `.clone()` of a large buffer, `format!()`, `.collect::<Vec<_>>()`, `Box::new`, and `Rc`/`Arc::new` all go through the infallible allocation path, which calls `handle_alloc_error` (an abort — see R22) on failure. A single one of these inside an otherwise `try_reserve`-disciplined function silences all the discipline around it.
**Applies to us:** A font-file-driven size (glyph count, contour count, atlas dimension) passed to `vec![0u8; size]` or `.collect()` anywhere in `shaper`/`font-baker`/`mtsdf-baker` is exactly the pattern that turns a malformed input file into a process abort.
**Bad / Good:**
```rust
// Bad — infallible; a huge/malformed `size` aborts the process
let buf = vec![0u8; size];

// Good — fallible, matches the rest of the module's discipline
let mut buf = Vec::new();
buf.try_reserve_exact(size)?;
buf.resize(size, 0u8); // resize after reserve doesn't need to allocate further
```
**Source:** `handle_alloc_error`, https://doc.rust-lang.org/std/alloc/fn.handle_alloc_error.html (accessed 2026-09-03); RFC 2116 background on which stdlib APIs remain infallible, https://rust-lang.github.io/rfcs/2116-alloc-me-maybe.html

---

### R22. Design as if OOM outside a `try_reserve` call is always fatal — `#[alloc_error_handler]` is still unstable and unreliable even on recent stable Rust
**Why:** Customizing what happens when the infallible allocation path (R21) fails requires `#[alloc_error_handler]`, nightly-only since its introduction (tracking issue #51540, opened 2018); as recently as November 2025 (issue #148916), it was reported to fail to even *link* on a stable-Rust no_std binary. There is no supported way on stable 1.97.1 to intercept or recover from that abort.
**Applies to us:** This is the strongest argument for R13/R19–R21 being complete rather than partial — once code reaches an infallible allocation call on the wasm32 target, the only remaining behavior is whatever `handle_alloc_error`'s default does (abort), full stop.
**Bad / Good:**
```rust
// Bad — requires nightly, and per rust-lang/rust#148916 may not even link on stable
#![feature(alloc_error_handler)]
#[alloc_error_handler]
fn oom(layout: core::alloc::Layout) -> ! { /* custom recovery */ }

// Good — accept the default abort for the genuinely-infallible paths, and make sure
// every untrusted-size path already went through try_reserve (R13/R21) so this
// handler is unreachable for anything driven by input size.
```
**Source:** Tracking issue #51540, https://github.com/rust-lang/rust/issues/51540; "alloc_error_handler does not link using stable rust," https://github.com/rust-lang/rust/issues/148916 (reported November 2025); `handle_alloc_error`, https://doc.rust-lang.org/std/alloc/fn.handle_alloc_error.html (accessed 2026-09-03)

---

### R23. Never rely on `overflow-checks` to catch a bad size computation in release — it isn't implied by `lto`, `codegen-units`, `panic = "abort"`, or `strip`
**Why:** Rust's release profile leaves `overflow-checks` following `debug-assertions`, which defaults to `false` under `[profile.release]`; none of `lto = true`, `codegen-units = 1`, `panic = "abort"`, or `strip = true` turn it on. Integer arithmetic in the shipped wasm binary therefore wraps silently on overflow unless the arithmetic itself is checked.
**Applies to us:** This project's release profile (`lto=true, codegen-units=1, panic="abort", strip=true`) does not set `overflow-checks`; a size/offset computation exercised only in a release/wasm build (not the debug host test suite) can wrap silently and feed a too-small buffer into `unsafe` SIMD/ABI code with nothing to catch it.
**Bad / Good:**
```rust
// Bad — correctness depends on a profile flag the release build doesn't set
let byte_len = width * height * BYTES_PER_PIXEL; // silently wraps in release

// Good — correctness doesn't depend on any profile flag
let byte_len = width
    .checked_mul(height)
    .and_then(|px| px.checked_mul(BYTES_PER_PIXEL))
    .ok_or(Error::SizeOverflow)?;
```
**Source:** General stable Rust semantics — `overflow-checks` defaults to the `debug-assertions` value, `false` in `[profile.release]` unless set explicitly; Cargo Book profiles reference, https://doc.rust-lang.org/cargo/reference/profiles.html (accessed 2026-09-03), cross-checked against this project's stated release profile.

---

### R24. Cross a widening/narrowing integer boundary with `try_from`/`TryInto`, never a truncating `as` cast
**Why:** An integer `as` cast between two integer types never panics — it wraps/truncates silently to fit the destination width (unlike the float-to-int `as` cast, which has saturated rather than produced UB since Rust 1.45.0). `wasm32-unknown-unknown` gives `usize`/`isize` a 32-bit range, so any offset or length arriving as `u64`/`f64` (a font table-directory offset, a length crossing the wasm ABI from JS) silently loses its high bits with a bare `as usize`.
**Applies to us:** Every wasm-ABI function taking a length/offset from JS, and every font-file table-directory offset parsed as `u32`/`u64`, is exactly this boundary; a truncated value that should have failed loudly as an `Err` instead reads or writes at the wrong address once it reaches `unsafe` pointer arithmetic.
**Bad / Good:**
```rust
// Bad — silently wraps if len_from_js > u32::MAX, no panic, no Err
#[no_mangle]
pub extern "C" fn write_glyph(len: u64, ptr: *mut u8) {
    let len = len as usize; // wasm32: usize is 32-bit, this can truncate
    // ...
}

// Good — an oversized length becomes an explicit error, not a truncated pointer
#[no_mangle]
pub extern "C" fn write_glyph(len: u64, ptr: *mut u8) -> i32 {
    let Ok(len) = usize::try_from(len) else { return ERR_LEN_OVERFLOW };
    // ...
    0
}
```
**Source:** Numeric cast semantics (integer `as` never panics; float-to-int `as` saturates since 1.45.0), general stable Rust reference; `wasm32-unknown-unknown` platform notes, https://doc.rust-lang.org/beta/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03)

---

### R25. Enable `clippy::cast_possible_truncation`, `clippy::cast_sign_loss`, and `clippy::cast_possible_wrap` in size/offset/index modules — all three are allow-by-default and catch nothing until turned on
**Why:** Clippy ships these three casting lints at the default `allow` level precisely because they also fire on plenty of intentionally-safe casts elsewhere; leaving the default means a bare truncating `as` in a wasm-ABI or size-computation module compiles clean with zero diagnostic.
**Applies to us:** The modules computing buffer sizes and offsets that feed this project's `unsafe` SIMD kernels and wasm ABI functions are the precise, low-blast-radius place to turn these on, without forcing the whole ~63k-LOC workspace to eat the noise these lints produce elsewhere.
**Bad / Good:**
```rust
// Bad — module-level, no enforcement; a truncating cast compiles silently
mod wasm_abi;

// Good — scoped deny, catches every bare-truncating cast at compile time
#![deny(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_possible_wrap)]
mod wasm_abi;
```
**Source:** Clippy lint index (`cast_possible_truncation`/`cast_sign_loss`/`cast_possible_wrap`, default level `allow`), https://rust-lang.github.io/rust-clippy/stable/index.html (accessed 2026-09-03)

---

### R26. Justify every remaining intentional truncating cast with `#[expect(clippy::cast_possible_truncation, reason = "...")]`, not a bare `as`
**Why:** Once R25's lints are on, a genuinely-safe truncation (a value already clamped/checked upstream, or a bit-pattern/hash/lane-index cast where wraparound is the intended semantic, not a size) still needs to compile. `#[expect(...)]` both silences the lint *and* fails the build if the lint stops firing — meaning the justification has gone stale — which a bare `#[allow(...)]` does not.
**Applies to us:** SIMD lane-index and hash-bucket casts in the data-oriented hot paths are exactly the "wraparound is intended" case R25's deny would otherwise block; each one needs a one-line reason a reviewer can check against the surrounding code, not a silent `as`.
**Bad / Good:**
```rust
// Bad — indistinguishable from an unreviewed truncation
let lane = index as u32 & 0x3; // actually a checked-safe mask, but reads like a bug

// Good — the exception is visible, reviewable, and self-invalidating if it becomes wrong
#[expect(clippy::cast_possible_truncation, reason = "index already masked to 2 bits above")]
let lane = index as u32 & 0x3;
```
**Source:** `#[expect]` (`lint_reasons`, RFC 2383) stabilized in Rust 1.81.0 (2024-09-05) via rust-lang/rust#120924, https://github.com/rust-lang/rust/pull/120924; Clippy `cast_possible_truncation` docs, https://rust-lang.github.io/rust-clippy/stable/index.html#cast_possible_truncation (accessed 2026-09-03)

---

### R27. Reach for `checked_*` (surface an error), not `saturating_*` (silently substitute a value), when the arithmetic feeds a size, offset, or capacity
**Why:** `saturating_add`/`saturating_mul` return a valid-looking, in-range value instead of signaling failure. For a byte count or offset, that value is *wrong*, not safe — a saturated size silently becomes a too-small allocation that a later unsafe write can then run past, trading a loud overflow bug for a silent, harder-to-find buffer overrun.
**Applies to us:** Any `width` × `height` × `bytes_per_pixel`-shaped computation in `bitmap-baker`/`mtsdf-baker`/`slug-baker` that feeds a buffer size must fail loudly on overflow, not clamp to `usize::MAX` (which then fails allocation for an unrelated-looking reason) or, worse, to some smaller in-range value that still gets used.
**Bad / Good:**
```rust
// Bad — a saturated size is a wrong size, not a safe one
let stride = width.saturating_mul(BYTES_PER_PIXEL);
let buf = vec![0u8; stride * height]; // still unchecked, and stride may already be wrong

// Good — overflow is a distinguishable, reportable error
let stride = width.checked_mul(BYTES_PER_PIXEL).ok_or(Error::SizeOverflow)?;
let len = stride.checked_mul(height).ok_or(Error::SizeOverflow)?;
```
**Source:** General stable Rust integer API semantics (`checked_*`/`saturating_*` on primitive integers); applied here as size-computation-specific guidance.

---

### R28. `panic = "abort"` removes unwind tables, not the panic-formatting machinery — eliminate panicking call sites, don't assume the profile flag did the work
**Why:** On a normal stable toolchain, `panic = "abort"` only changes what happens *after* a panic is raised (no unwind, straight to abort); the `core::fmt::Arguments` formatting code, the panic message string, and the call into the panic runtime are all still generated and linked in for every `.unwrap()`, `.expect("msg")`, `panic!("...")`, and panicking index/slice operation in reachable code. Eliminating that machinery entirely requires nightly's `-Z build-std -C panic=immediate-abort`, which is not available on a pinned stable toolchain.
**Applies to us:** With the release profile already at `panic = "abort"`, the only remaining stable lever to shrink the "panic tax" on the wasm32 binary is removing the panicking call sites themselves (R27, R29), not the profile setting.
**Bad / Good:**
```rust
// Bad — still costs bytes for formatting machinery + a distinct panic site,
// even under panic = "abort" on stable
let glyph = glyphs.get(id).expect("glyph id out of range");

// Good — no panicking call site to begin with
let glyph = glyphs.get(id).ok_or(Error::InvalidGlyphId(id))?;
```
**Source:** min-sized-rust (`panic = "abort"`: stable since 1.10, removes unwinding code only), https://github.com/johnthagen/min-sized-rust (accessed 2026-09-03); `panic=immediate-abort` nightly/build-std status, https://github.com/rust-lang/rust/issues/146974 and https://github.com/rust-lang/rust/issues/147257 (accessed 2026-09-03)

---

### R29. At any boundary fed by untrusted size/index data, prefer the `Result`/`Option`-returning sibling over the panicking default — a panic in this project's `panic = "abort"` build is not a catchable error, it's a trap that kills the whole wasm instance
**Why:** `slice[i]`, `.unwrap()`, `.expect(..)`, and infallible arithmetic operators all panic on their failure case; under `panic = "abort"` that panic has no unwind path to catch, log, or recover from. From the JS host's perspective the wasm instance simply traps, and any other in-flight work sharing that instance is gone with it.
**Applies to us:** A malformed glyph index or an out-of-range cluster offset parsed from an untrusted font file must resolve to a `Result::Err` the caller can report, not a trapped wasm instance the JS host has to reload from scratch.
**Bad / Good:**
```rust
// Bad — panics (traps the instance) on an out-of-range index
let glyph = glyphs[glyph_id as usize];

// Good — untrusted index becomes an ordinary error value
let glyph = glyphs.get(glyph_id as usize).ok_or(Error::InvalidGlyphId(glyph_id))?;
```
**Source:** General stable Rust semantics (indexing panics; `.get()` returns `Option`); consequence of this project's `panic = "abort"` release profile removing any unwind-based recovery path.

---

### R30. Write the crate's `#[panic_handler]` body as `core::arch::wasm32::unreachable()` — stable, safe, and the smallest possible deterministic trap
**Why:** `core::arch::wasm32::unreachable()` has been stable and safe to call since Rust 1.37.0; it compiles directly to the WebAssembly `unreachable` instruction — an unconditional trap — with no formatting or printing machinery involved, unlike a `loop {}` spin (which hangs instead of trapping) or anything that touches `core::fmt`.
**Applies to us:** This is the correct minimal `#[panic_handler]` body for the wasm32-unknown-unknown target on a stable toolchain, and it composes with R28/R29: once panicking call sites are minimized, the rare remaining panic should trap immediately and cheaply rather than spin or print.
**Bad / Good:**
```rust
// Bad — spins forever instead of trapping; also pulls in core::fmt for no reason
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! { loop {} }

// Good — stable since 1.37.0, safe, compiles to a single `unreachable` trap instruction
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }
```
**Source:** `core::arch::wasm32::unreachable`, stable since 1.37.0, https://doc.rust-lang.org/core/arch/wasm32/fn.unreachable.html (accessed 2026-09-03)

---

### R31. `#[panic_handler]` may be defined exactly once in the whole crate graph of a bin/dylib/cdylib — keep it in the top-level binary crate only, never in a published library crate
**Why:** The attribute must apply to exactly one function of signature `fn(&PanicInfo) -> !` across the entire dependency graph of a given binary; defining it in a library crate would force every downstream consumer of that library into the library author's panic strategy, and would conflict outright if the consumer defines its own.
**Applies to us:** With 12 first-party crates that are libraries and only a small number of final wasm/host binaries, `#[panic_handler]` belongs solely in those final binary crates — mirrors the `#[global_allocator]` single-definition rule (R39) for the same structural reason.
**Bad / Good:**
```rust
// Bad — inside a published packages/shaper library crate
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }

// Good — only in the final wasm binary crate that links everything together
// (apps/*-wasm/src/main.rs or equivalent), never under packages/*
```
**Source:** `#[panic_handler]`, The Rustonomicon, https://doc.rust-lang.org/nomicon/panic-handler.html (accessed 2026-09-03); The Embedonomicon, "The smallest #![no_std] program," https://docs.rust-embedded.org/embedonomicon/smallest-no-std.html (accessed 2026-09-03)

---

### R32. Don't bake `panic = "abort"`-only assumptions into shared no_std+alloc library source — the same source also compiles under the `std` feature for host tools, which may default to `panic = "unwind"`
**Why:** This project's crates are no_std+alloc by default with `std` as an opt-in feature for host tools/binaries; that means the *same* library source is compiled twice — once into a `panic = "abort"` wasm binary, once into whatever panic strategy the host binary's own profile chooses (typically `unwind` unless overridden). Code that calls unstable abort-specific intrinsics directly, or otherwise assumes panics never unwind, is only correct for one of those two compilations.
**Applies to us:** Keep panic-strategy-specific behavior (R30's `core::arch::wasm32::unreachable()`) confined to the final wasm binary crate's `#[panic_handler]`; shared library code in `packages/*` should not itself assume abort semantics.
**Bad / Good:**
```rust
// Bad — inside a shared, no_std+alloc library crate, assumes abort semantics directly
fn bail() -> ! { unsafe { core::intrinsics::abort() } } // also: unstable intrinsic

// Good — let the panic machinery (and the binary's own #[panic_handler]) own the strategy
fn bail() -> ! { panic!("unrecoverable shaping state") }
```
**Source:** `core::intrinsics::abort` instability and abort-vs-unwind discussion, https://internals.rust-lang.org/t/core-abort-in-no-std/8772 (accessed 2026-09-03); project context (no_std+alloc by default, `std` opt-in for host tools/binaries).

---

### R33. `no-panic` only detects anything under `panic = "unwind"` — it is a silent no-op under `panic = "abort"`; run it as a separate CI job, not inside the panic=abort release build
**Why:** `no-panic`'s technique relies on the linker being unable to resolve a symbol that only the unwinding panic runtime defines; its own documentation states plainly that code must be built with `panic = "unwind"` for detection to work at all, and that the attribute is "useless in code built with panic = abort."
**Applies to us:** This project's release profile is `panic = "abort"`; a `#[no_panic]` annotation compiled as part of that release build proves nothing about whether the function can panic. Panic-freedom verification for hot/unsafe-adjacent functions needs its own `panic = "unwind"` CI job/crate, separate from the shipped release build.
**Bad / Good:**
```toml
# Bad — annotated function lives only in the panic=abort release build/profile;
# no-panic silently verifies nothing there
[profile.release]
panic = "abort"

# Good — a dedicated dev-dependency/CI crate compiled with panic = "unwind"
# exercises the #[no_panic]-annotated functions; the release binary stays panic=abort
[profile.no-panic-check]
inherits = "dev"
panic = "unwind"
```
**Source:** dtolnay/no-panic — "Code must be built with panic = "unwind" (the default) in order for any panics to be detected... The attribute is useless in code built with panic = "abort"," https://github.com/dtolnay/no-panic (accessed 2026-09-03)

---

### R34. Do not adopt wee_alloc — it has been unmaintained since 2022 (RUSTSEC-2022-0054), with no release since roughly 2019 and known memory leaks
**Why:** Two of wee_alloc's own maintainers confirmed the crate is unmaintained; the RustSec advisory (reported 2022-05-11, issued 2022-09-08, last modified 2023-06-13) documents open memory-leak issues and recommends switching to the platform default allocator instead. As of this research (2026-09-03) the advisory remains unpatched — there is no fixed version to upgrade to.
**Applies to us:** The project already uses talc, so this is a guard against regression: if wee_alloc ever appears as a transitive dependency (e.g. pulled in by a third-party no_std crate's dev-dependencies or examples), it needs to be excluded/replaced, not quietly linked into a release wasm binary.
**Bad / Good:**
```toml
# Bad — unmaintained since ~2019, documented memory leaks
[dependencies]
wee_alloc = "0.4"

# Good — this project's existing choice
[dependencies]
talc = "5.0.4"
```
**Source:** RUSTSEC-2022-0054, https://rustsec.org/advisories/RUSTSEC-2022-0054.html (issued 2022-09-08, accessed 2026-09-03)

---

### R35. Know the fallback: wasm32-unknown-unknown's built-in default allocator is a bundled port of dlmalloc, not "no allocator" — an accidentally-removed `#[global_allocator]` silently swaps talc for it
**Why:** When a wasm32-unknown-unknown binary doesn't set `#[global_allocator]`, the toolchain links in the `dlmalloc` crate — a pure-Rust dlmalloc port shipped specifically because the target historically couldn't call into a C allocator. This is a real, working allocator, so removing the project's `#[global_allocator]` line by accident (a merge conflict, a refactor) doesn't fail to compile — it just silently changes the binary's size/perf characteristics away from whatever talc was chosen for.
**Applies to us:** Since size is explicitly a tracked concern for this project (talc pinned specifically to beat dlmalloc), CI should assert the `#[global_allocator]` attribute is present in the final wasm binary crate, not merely assume it stays there.
**Bad / Good:**
```bash
# Bad — nothing catches a silently-reverted allocator choice
cargo build --release --target wasm32-unknown-unknown

# Good — CI fails loudly if the global allocator line disappears
rg -q '#\[global_allocator\]' apps/*-wasm/src/*.rs || {
    echo "no #[global_allocator] found — build would silently fall back to dlmalloc"; exit 1;
}
```
**Source:** `dlmalloc` crate docs ("the default memory allocator for the wasm32-unknown-unknown target in the standard library"), https://docs.rs/dlmalloc (accessed 2026-09-03); `wasm32-unknown-unknown` platform support notes, https://doc.rust-lang.org/beta/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03)

---

### R36. talc's `core::alloc::Allocator` implementation requires talc's own `nightly` cargo feature — never enable it on the pinned stable 1.97.1 toolchain
**Why:** talc implements the stable `GlobalAlloc` trait unconditionally, but its implementation of the still-unstable `core::alloc::Allocator` trait (R17) is gated behind talc's own `"nightly"` feature, which itself requires a nightly compiler to build.
**Applies to us:** Consume talc via `GlobalAlloc`/`#[global_allocator]` only; enabling talc's `nightly` feature would break the stable-1.97.1 build the moment it's turned on, and gains nothing until R17's `allocator_api` actually stabilizes.
**Bad / Good:**
```toml
# Bad — will not compile on the pinned stable 1.97.1 toolchain
[dependencies]
talc = { version = "5.0.4", features = ["nightly"] }

# Good — stable GlobalAlloc usage only
[dependencies]
talc = "5.0.4"
```
**Source:** talc crate docs, feature list (`nightly` gates `core::alloc::Allocator` impls; MSRV 1.64), https://docs.rs/talc/latest/talc/ (accessed 2026-09-03)

---

### R37. talc's wasm dynamic allocator is explicitly single-threaded (`cfg(not(target_feature = "atomics"))`) — revisit the setup before any future move to shared-memory wasm threads
**Why:** talc's ready-made wasm integration (`talc::wasm::WasmDynamicTalc` / `new_wasm_dynamic_allocator`) is a lock-free cell, valid only when the target doesn't have the `atomics` target feature enabled (i.e. no shared linear memory, no threads). Enabling `atomics` without switching to talc's `TalcLock` would make the global allocator's internal bookkeeping racy — a data race inside the allocator itself, corrupting heap metadata under concurrent access.
**Applies to us:** The project's wasm32-unknown-unknown target is currently single-threaded; if SIMD work ever grows into a threads-plus-shared-memory story (`+atomics,+bulk-memory`), the global allocator static must move from the lock-free cell to `TalcLock` in the same change, not after.
**Bad / Good:**
```rust
// Bad — lock-free cell, silently unsound if atomics gets enabled later
#[global_allocator]
static TALC: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

// Good — explicit guard makes the single-thread assumption checkable at compile time
#[cfg(all(not(target_feature = "atomics"), target_family = "wasm"))]
#[global_allocator]
static TALC: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();
#[cfg(all(target_feature = "atomics", target_family = "wasm"))]
compile_error!("switch the global allocator to TalcLock before enabling atomics");
```
**Source:** talc WASM guide, https://github.com/SFBdragon/talc/blob/master/talc/README_WASM.md (accessed 2026-09-03)

---

### R38. talc's size/perf knobs (`disable-grow-in-place`, `disable-realloc-in-place`, and its wasm memory-growth strategy) trade runtime behavior for binary size — measure before enabling, don't take the defaults or the trade on faith
**Why:** talc's `disable-grow-in-place`/`disable-realloc-in-place` cargo features remove the corresponding fast-path routines to shrink the compiled wasm module, at the cost of falling back to allocate-copy-free on grow/shrink; separately, talc's own docs quantify one concrete instance of this kind of trade-off — its `WasmGrowAndExtend` memory-growth strategy costs about 97 bytes (roughly 8-9%) more module size than `WasmGrowAndClaim` for that specific code path.
**Applies to us:** Given wasm binary size is an explicit, tracked concern for this project, these are exactly the kind of knob worth dialing in deliberately for the release profile — but only after profiling realloc-heavy hot loops (glyph/atlas growth), since disabling grow-in-place trades a runtime cost that's real, not free.
**Bad / Good:**
```toml
# Bad — enabled without measuring, on the assumption "smaller is always better"
[dependencies]
talc = { version = "5.0.4", features = ["disable-grow-in-place", "disable-realloc-in-place"] }

# Good — a comment records the measured trade-off that justified the choice
[dependencies]
# disable-grow-in-place: -N bytes measured on release wasm build 2026-0X-XX;
# atlas growth is not realloc-hot per profiling in <link/issue>.
talc = { version = "5.0.4", features = ["disable-grow-in-place"] }
```
**Source:** talc WASM guide (feature descriptions, `WasmGrowAndExtend` vs `WasmGrowAndClaim` ~97-byte/~8-9% figure), https://github.com/SFBdragon/talc/blob/master/talc/README_WASM.md and https://docs.rs/talc/latest/talc/ (accessed 2026-09-03)

---

### R39. `#[global_allocator]` may be defined at most once in the whole linked binary, and belongs only in a final binary/cdylib crate — never in a published library crate
**Why:** The Rust standard library docs state this directly: using `#[global_allocator]` more than once in a crate or its recursive dependencies is a compile error, and it's meant to be set by the binary, not a library — a library crate that defines one would take the allocator choice away from every downstream consumer, including a host tool that wants the system allocator.
**Applies to us:** talc's `#[global_allocator]` static (R35, R37) belongs solely in the final wasm binary crate (and, if applicable, a separate one for the std host-tool binary); none of the 12 published `packages/*` library crates should ever contain one.
**Bad / Good:**
```rust
// Bad — inside a published packages/shaper library crate
#[global_allocator]
static TALC: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

// Good — only in the final binary crate that produces the shipped .wasm artifact
// (e.g. apps/glyph-wasm/src/main.rs), never under packages/*
```
**Source:** `std::alloc` module docs — "The #[global_allocator] can only be used once in a crate or its recursive dependencies... Binary crates should set the #[global_allocator] attribute; library crates generally should NOT," https://doc.rust-lang.org/std/alloc/index.html (accessed 2026-09-03)
