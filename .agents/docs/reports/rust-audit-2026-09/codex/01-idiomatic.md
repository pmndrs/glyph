---
type: Reference
title: Rust codex — Idiomatic Rust and API design
description: Checkable rules on idiomatic rust and api design, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Idiomatic Rust and API Design — Rules (2026)

## Naming

### R1. Case identifiers per RFC 430; keep word order consistent within a crate
**Why:** `UpperCamelCase` marks type-level items (types, traits, enum variants), `snake_case` marks value-level items (functions, methods, modules, local bindings), `SCREAMING_SNAKE_CASE` marks statics and consts. Acronyms count as one word in `UpperCamelCase` (`Stdin`, not `StdIn`) and are lowercased in `snake_case`. Separately, error-type names should share one word order crate-wide — std uses verb-object-error (`ParseIntError`, `RecvTimeoutError`), not object-verb-error.
**Applies to us:** Twelve crates named consistently (`mtsdf-core`, `font-baker`, `slug-baker`) is the crate-name half of this; the type-name half is enforced per-crate — a reviewer can grep each crate's `error.rs` for variant/type names and check they all read verb-object-error.
**Bad / Good:**
```rust
// Bad: acronym not treated as a word; inconsistent error name order
struct GlyphUUID;
struct ErrorTimeoutRecv;

// Good
struct GlyphUuid;
struct RecvTimeoutError;
```
**Source:** [Naming — Rust API Guidelines](https://rust-lang.github.io/api-guidelines/naming.html) (fetched 2026-09; guideline text stable since ~2020), [RFC 430](https://rust-lang.github.io/rfcs/0430-finalizing-naming-conventions.html).

### R2. Name ad-hoc conversions `as_`/`to_`/`into_` by cost and ownership, not by preference
**Why:** The prefix is a contract: `as_` is a free reference-to-reference reborrow, `to_` is an expensive borrowed→borrowed/owned conversion (or an owned `Copy`→owned one), `into_` consumes `self` and is non-`Copy`-owned→owned. A caller reads the prefix and knows, without opening docs, whether the call allocates or moves.
**Applies to us:** Any method that unwraps a baked artifact or shaped-run wrapper into its raw buffer should be `into_inner`/`into_bytes` (consuming, moves the `alloc::vec::Vec` out) rather than `to_bytes` (which wrongly implies a copy) or `as_bytes` (which wrongly implies a borrow when it isn't one).
**Bad / Good:**
```rust
// Bad: "to_" implies a copy; this actually moves and drops self
impl RasterArtifact {
    pub fn to_bytes(self) -> Vec<u8> { self.buf }
}

// Good
impl RasterArtifact {
    pub fn into_bytes(self) -> Vec<u8> { self.buf }
    pub fn as_bytes(&self) -> &[u8] { &self.buf } // free reborrow
}
```
**Source:** [Naming — Rust API Guidelines, C-CONV](https://rust-lang.github.io/api-guidelines/naming.html) (fetched 2026-09).

### R3. Drop the `get_` prefix; reserve `get`/`get_mut` for the one obvious field
**Why:** Rust convention omits `get_` for ordinary accessors (`fn first(&self) -> &T`, not `get_first`). The bare `get`/`get_mut` names are reserved for types with exactly one canonical thing to fetch (`Cell::get`), and a validated accessor should ship an `_unchecked` unsafe sibling with the same shape (`get`, `get_mut`, `unsafe fn get_unchecked`).
**Applies to us:** Hot-path glyph/outline lookups in `shaper` and `mtsdf-core` are exactly the `get_unchecked` use case — SIMD kernels that have already bounds-checked a batch shouldn't pay for a second bounds check per element.
**Bad / Good:**
```rust
// Bad
impl GlyphTable {
    pub fn get_glyph(&self, id: GlyphId) -> Option<&Glyph> { ... }
}

// Good
impl GlyphTable {
    pub fn glyph(&self, id: GlyphId) -> Option<&Glyph> { ... }
    pub fn get(&self, id: GlyphId) -> Option<&Glyph> { self.glyph(id) }
    /// # Safety
    /// `id` must be in bounds.
    pub unsafe fn get_unchecked(&self, id: GlyphId) -> &Glyph { ... }
}
```
**Source:** [Naming — Rust API Guidelines, C-GETTER](https://rust-lang.github.io/api-guidelines/naming.html) (fetched 2026-09).

### R4. Collections expose the `iter`/`iter_mut`/`into_iter` triad; name the iterator type after the method
**Why:** RFC 199 fixed this shape: `iter(&self) -> Iter` yields `&U`, `iter_mut(&mut self) -> IterMut` yields `&mut U`, `into_iter(self) -> IntoIter` yields `U`. The returned type's name should echo the method (`into_iter` → `IntoIter`, `keys` → `Keys`) so that `crate::module::IntoIter` reads correctly out of context, e.g. in error messages and generated docs.
**Applies to us:** general — applies to any owning collection type exposed from `shaper` or `slug-core` (glyph runs, outline point lists).
**Source:** [Naming — Rust API Guidelines, C-ITER / C-ITER-TY](https://rust-lang.github.io/api-guidelines/naming.html) (fetched 2026-09).

## Conversions and common traits

### R5. Implement `From`/`TryFrom`/`AsRef`/`AsMut`/`Borrow`; never implement `Into`/`TryInto` directly
**Why:** `Into<U> for T` and `TryInto<U> for T` have blanket impls (`impl<T, U> Into<U> for T where U: From<T>`) supplied by any `From`/`TryFrom` impl — writing your own `Into` impl either duplicates or conflicts with that blanket. `AsRef`/`AsMut` must be infallible, free, reference-to-reference; if the conversion can fail, it isn't an `AsRef`, it's a named method returning `Option`/`Result`. `Borrow` is a different contract from `AsRef`: it additionally promises `Eq`/`Hash`/`Ord` equivalence with the owned type, which is what lets `HashMap<String, V>::get(&self, k: &str)` work — use it only when identity for lookup, not just cheap referencing, is the point.
**Applies to us:** A `GlyphId(u32)`/`FeatureTag([u8; 4])` newtype family should get `From<u32> for GlyphId`, not a hand-rolled `Into`; a font-baker path type wrapping `alloc::string::String` should implement `Borrow<str>` only if it is ever used as a `HashMap` key looked up by `&str`, otherwise `AsRef<str>` is the correct, weaker trait.
**Bad / Good:**
```rust
// Bad: hand-rolled Into fights the blanket impl; fallible "AsRef"
impl Into<u32> for GlyphId { fn into(self) -> u32 { self.0 } }
impl AsRef<Glyph> for GlyphId { fn as_ref(&self) -> &Glyph { table.lookup(*self).unwrap() } }

// Good
impl From<GlyphId> for u32 { fn from(id: GlyphId) -> u32 { id.0 } }
impl GlyphTable {
    pub fn glyph(&self, id: GlyphId) -> Option<&Glyph> { ... } // fallible -> named method
}
```
**Source:** [Interoperability — Rust API Guidelines, C-CONV-TRAITS](https://rust-lang.github.io/api-guidelines/interoperability.html) (fetched 2026-09); [Borrow vs AsRef — Rust FAQ](https://www.rustfaq.org/en/what-is-the-borrow-trait-vs-asref/).

### R6. Implement the common traits eagerly, before the type ships
**Why:** The orphan rule means only the defining crate can add `Debug`/`Clone`/`PartialEq`/`Eq`/`Hash`/`Default`/`Display`/etc. later — a downstream crate that needs `Display` on your type and doesn't have it is permanently stuck. There is no post-hoc fix that doesn't involve a newtype wrapper in the downstream crate. Gate `serde::{Serialize, Deserialize}` behind an optional feature rather than a hard dependency, so a `no_std`-only consumer doesn't pull in `serde` transitively.
**Applies to us:** Every public type in the 12 crates (glyph IDs, outline points, baked artifact headers) should get this pass before first publish — retrofitting `PartialEq`/`Hash` onto `slug-core`'s public types after downstream crates exist is a breaking-in-spirit change even though it compiles.
**Source:** [Interoperability — Rust API Guidelines, C-COMMON-TRAITS / C-SERDE](https://rust-lang.github.io/api-guidelines/interoperability.html) (fetched 2026-09).

### R7. Assert `Send`/`Sync` with a compile-time test, don't just hope auto-trait inference holds
**Why:** `Send`/`Sync` are auto traits — the compiler derives them structurally, so adding one field of a `!Send` type (a raw pointer, an `Rc`) silently un-derives `Send` for every type that contains it, with no diagnostic pointing at the API you broke. A one-line test pins the guarantee and turns a silent regression into a compile failure at the point it happens.
**Applies to us:** The wasm ABI modules pass raw pointers across the `unsafe extern` boundary; any public type built from those pointers (arena handles, wasm-side buffer views) needs this test precisely because raw pointers are `!Send + !Sync` by default and it's easy to add one behind three levels of struct nesting without noticing.
**Bad / Good:**
```rust
// Bad: assumed, never checked
pub struct ArenaHandle { ptr: *mut u8, len: usize }

// Good
pub struct ArenaHandle { ptr: *mut u8, len: usize }
unsafe impl Send for ArenaHandle {} // justified: exclusive ownership of the arena region

#[cfg(test)]
fn assert_send<T: Send>() {}
#[test]
fn arena_handle_is_send() { assert_send::<ArenaHandle>(); }
```
**Source:** [Interoperability — Rust API Guidelines, C-SEND-SYNC](https://rust-lang.github.io/api-guidelines/interoperability.html) (fetched 2026-09).

## Error design

### R8. Error types implement `core::error::Error` + `Debug` + `Display`; never `()` or a bare `String`
**Why:** `()` implements neither `Display` nor `Error`, so it can't plug into `?`-based error chains or any `Error`-aware tooling; a bare `String` implements `Display`/`Debug` but not `Error`, so it can't carry a `source()`. Since Rust 1.81 (Sept 2024), `core::error::Error` is stable and requires only `Debug + Display` — there is no longer a `no_std` excuse for a library to skip implementing it. Don't reach for `Error::source()`'s generic-member-access sibling (`Error::provide`/`Request`) yet: `error_generic_member_access` is still an unstable nightly-only feature as of 2026, with no active stabilization movement — building a public API around it is a hazard.
**Applies to us:** All 12 crates are `no_std + alloc`, so this used to be a real constraint; it no longer is. Every crate's top-level error enum (`ShapeError`, `BakeError`, `AdmissionError`, …) should implement `core::error::Error` unconditionally, not behind a `std` feature flag.
**Bad / Good:**
```rust
// Bad: no_std "workaround" that predates 1.81
#[cfg(feature = "std")]
impl std::error::Error for ShapeError {}
// no core::error::Error impl at all without the "std" feature

// Good — works identically in a #![no_std] crate since Rust 1.81
impl core::error::Error for ShapeError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self { ShapeError::Font(e) => Some(e), _ => None }
    }
}
```
**Source:** [Rust 1.81.0 release notes](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/) (2024-09-05); [`core::error::Error`](https://doc.rust-lang.org/stable/core/error/trait.Error.html); [Tracking issue for `error_generic_member_access`](https://github.com/rust-lang/rust/issues/99301) (checked 2026-09, still open/unstable).

### R9. Mark public error enums `#[non_exhaustive]` on first release, not after
**Why:** `#[non_exhaustive]` forces downstream `match` arms to include a wildcard, so adding a variant later is additive, not breaking. But adding the attribute itself, after the type is already published without it, *is* a breaking change — every existing exhaustive `match` at every call site stops compiling. The attribute is a day-one decision, not a cleanup you do before 1.0.
**Applies to us:** `ShapeError`, `AdmissionError`, and any other library-facing enum returned across a crate boundary is exactly the C-GOOD-ERR case this exists for — the taxonomy of failure modes in a font-shaping pipeline (malformed table, unsupported feature, allocator exhaustion) is guaranteed to grow.
**Bad / Good:**
```rust
// Bad: works today, but the day you add a variant, every downstream
// exhaustive match breaks
pub enum ShapeError { MissingGlyph, MalformedTable }

// Good
#[non_exhaustive]
pub enum ShapeError { MissingGlyph, MalformedTable }
```
**Source:** [RFC 2008: non_exhaustive](https://rust-lang.github.io/rfcs/2008-non-exhaustive.html); [`non_exhaustive` reference](https://doc.rust-lang.org/reference/attributes/type_system.html) (checked 2026-09).

### R10. Choose an error taxonomy on purpose: enum-of-kinds near the origin, one struct + `ErrorKind` at a stable boundary — and never nest errors as the default move
**Why:** An enum-of-variants (`thiserror`-friendly) gives maximum recoverable detail and composes well with `?`, but each new failure mode is a breaking addition to the match surface unless `#[non_exhaustive]`. A single opaque struct wrapping a C-like `ErrorKind` plus a message/source scales better once a crate accumulates dozens of failure modes, because adding detail doesn't change the public shape. Wrapping one error type as a bare variant of another (`enum A { B(BError) }` chained three deep) is called out specifically as an anti-pattern — it exists more from mechanical `?`-satisfaction than from a considered design, and it forces every downstream consumer to unwrap a stack of enums to get to the actionable cause. Prefer adding context (what operation, what file, what glyph id) with `.map_err(...)` at the point of translation, and normalize aggressively in `From` impls so the tree doesn't grow unbounded.
**Applies to us:** With 12 crates layered (`*-fontations` → `*-core`/`*-baker` → `raster-artifact`), the temptation is to let each layer's error simply wrap the layer below's verbatim. Decide per crate boundary whether callers need the underlying `ttf_parser`/`fontations`-style error detail (keep it as a `source()`, enum-of-kinds) or just need to know shaping failed and why in one line (collapse to `ShapeError { kind: ShapeErrorKind, .. }`).
**Bad / Good:**
```rust
// Bad: mechanical wrapping, no context, three enums deep to reach the cause
enum BakeError { Font(FontError) }
enum FontError { Table(TableError) }
enum TableError { Cff(CffError) }

// Good: context captured where it's known, source preserved for reporting
#[non_exhaustive]
pub enum BakeError {
    Table { name: [u8; 4], source: TableError },
    Allocator(AllocError),
}
```
**Source:** [Error type design — Nick Cameron's error-docs](https://nrc.github.io/error-docs/error-design/error-type-design.html) (fetched 2026-09).

### R11. Never expose `anyhow::Error` or `Box<dyn Error>` type-erasure from a library's public API
**Why:** An erased error type gives callers nothing to `match` on — they're reduced to `.to_string()` substring checks to distinguish a "not found" from a "permission denied." `anyhow`/`eyre`-style erasure is for the top of an application (binaries, `main`, host tools), where the only remaining action is logging or exiting; a library sits below that layer and must hand back something its caller can inspect and branch on. The dividing line is not "library vs. binary" as a rule of thumb so much as "does anything downstream need to handle this differently by kind" — but for a shared library with unknown callers, assume yes.
**Applies to us:** The 12 published crates are all libraries by construction (consumed by `font-baker`/`mtsdf-baker` binaries and eventually by host applications) — none of their public `Result` aliases should use `anyhow::Result` or `Box<dyn core::error::Error>` as the error type, even internally-convenient as that is during fast iteration. Host tool *binaries* (if any grow a `main.rs`) are the one place `anyhow` belongs.
**Bad / Good:**
```rust
// Bad: library public API
pub fn shape(input: &str) -> anyhow::Result<ShapedRun> { ... }

// Good: library public API
pub fn shape(input: &str) -> Result<ShapedRun, ShapeError> { ... }
// anyhow is fine in apps/font-baker-cli/src/main.rs, never in packages/shaper/src/lib.rs
```
**Source:** [Rust Error Handling Libraries: anyhow vs thiserror vs eyre](https://www.pistack.xyz/posts/2026-06-22-rust-error-handling-anyhow-thiserror-eyre-guide/) (2026-06-22); community consensus corroborated across multiple 2025–2026 sources found in this research pass.

### R12. Treat `thiserror` as boilerplate removal, not an API decision
**Why:** The `#[derive(thiserror::Error)]` macro only emits the same `impl Debug`/`Display`/`core::error::Error` a human would hand-write — it does not appear in the type's public signature, and it adds no trait the type wouldn't otherwise have. Consequently, switching a given error type from hand-written impls to `thiserror` (or back) is not a semver-breaking change; the choice is purely a maintenance-cost tradeoff (proc-macro compile-time cost vs. boilerplate), decided per crate, not a decision that leaks to callers.
**Applies to us:** `shaper` at 47k LOC is the crate most likely to accumulate enough error variants that hand-written `Display` arms become tedious — reach for `thiserror` there without worrying it constrains the public API differently than a hand-rolled impl would.
**Source:** [`thiserror` — docs.rs](https://docs.rs/thiserror/latest/thiserror/) (fetched 2026-09): "Switching from handwritten impls to thiserror or vice versa is not a breaking change."

### R13. Keep a `Result<T, E>`'s `Err` payload small, or `Box` it
**Why:** Every `Result<T, E>` is sized to fit its larger variant. A large `Err` payload — a full parser-state struct, an inline backtrace, a `String` plus several `Vec`s — inflates the *success* path's stack frame too, since `Ok` and `Err` share layout. `clippy::result_large_err` flags this at a default threshold of 128 bytes (`large-error-threshold` config key); the related `clippy::large_enum_variant` uses a separate 200-byte default (`enum-variant-size-threshold`) for enums generally. Either box the offending variant's payload or shrink it.
**Applies to us:** This is a direct wasm-size and hot-path-stack-cost lever, not just a style nit — release profile is `lto=true, codegen-units=1, panic="abort"`, and the shaping pipeline is in the hot path being sized-optimized. Run `clippy::result_large_err` in CI (see the `workspace.lints` rule below) rather than discovering an oversized `Result` by reading generated wasm disassembly.
**Bad / Good:**
```rust
// Bad: Err payload is 200+ bytes; Ok(GlyphId) now costs the same to move
pub fn shape_one(g: &Glyph) -> Result<GlyphId, ShapeDiagnostics /* large struct */> { ... }

// Good
pub fn shape_one(g: &Glyph) -> Result<GlyphId, Box<ShapeDiagnostics>> { ... }
```
**Source:** [Clippy lint configuration — `large-error-threshold`, `enum-variant-size-threshold`](https://doc.rust-lang.org/clippy/lint_configuration.html) (fetched 2026-09).

## Flexibility and dispatch

### R14. Return intermediate results instead of making the caller recompute them
**Why:** If a function already derives a piece of information on the way to its answer, throwing it away and forcing a second pass is pure waste. `Vec::binary_search` returns the *insertion index* on both `Ok` and `Err`, not just a found/not-found bool; `HashMap::insert` returns the previous value instead of requiring a separate `get` first; `String::from_utf8`'s error carries the valid-prefix length.
**Applies to us:** A shaping or layout pass that already walks a buffer to find a break point, a failing glyph index, or a cluster boundary should hand that index back in its `Result`/return type rather than requiring the caller to re-scan.
**Source:** [Flexibility — Rust API Guidelines, C-INTERMEDIATE](https://rust-lang.github.io/api-guidelines/flexibility.html) (fetched 2026-09).

### R15. Let ownership in the signature signal caller intent — don't take owned data you don't need to own
**Why:** Accepting `T` when `&T` suffices forces every caller to clone or forfeit the value even when they need it afterward; accepting `&T` when the function must store the value forces an internal clone the caller could have avoided by passing ownership directly. `Copy` is a marker for "this type has value semantics," not a license to make a type's cheapness the caller's problem — don't design a signature around whether a type happens to be `Copy` today.
**Applies to us:** general — most directly relevant to the baker/admission crates that build long-lived artifacts from caller-supplied glyph/outline data: take `Vec<Point>` (owned) when the artifact must own its points, take `&[Point]` when it only reads them once.
**Source:** [Flexibility — Rust API Guidelines, C-CALLER-CONTROL](https://rust-lang.github.io/api-guidelines/flexibility.html) (fetched 2026-09).

### R16. Prefer generic bounds over concrete types; make dyn-compatibility a deliberate choice, not an accident
**Why:** A function that requires only `AsRef<Path>` instead of a concrete `PathBuf` (the way `File::open` does) is usable with anything that satisfies the bound, at zero runtime cost — the compiler monomorphizes per call site. When a trait might also need to be used as `dyn Trait`, exclude the methods that can't be part of a vtable (generic methods, methods returning `Self` by value) with `where Self: Sized` rather than letting the compiler silently make the whole trait non-object-safe; `Iterator` does exactly this for `collect`, `map`, and friends so that `Iterator` itself stays usable as `dyn Iterator<Item = T>`.
**Applies to us:** general — relevant wherever `shaper` exposes a trait for pluggable font backends (`*-fontations` crates) that might reasonably be swapped at runtime.
**Bad / Good:**
```rust
// Bad: one generic method silently makes the whole trait non-object-safe
pub trait FontSource {
    fn table(&self, tag: [u8; 4]) -> Option<&[u8]>;
    fn map<F: FnMut(&[u8])>(&self, f: F); // kills dyn FontSource
}

// Good
pub trait FontSource {
    fn table(&self, tag: [u8; 4]) -> Option<&[u8]>;
    fn map<F: FnMut(&[u8])>(&self, f: F) where Self: Sized;
}
```
**Source:** [Flexibility — Rust API Guidelines, C-GENERIC / C-OBJECT](https://rust-lang.github.io/api-guidelines/flexibility.html) (fetched 2026-09).

### R17. Default to static dispatch; reach for `dyn Trait` only for heterogeneity, runtime choice, or code-size caps
**Why:** Generics/`impl Trait` monomorphize — every call site gets a specialized, inlinable copy, at the cost of code size scaling with the number of instantiations. `dyn Trait` compiles the implementation once behind a vtable — smaller code, but every call is an indirect, non-inlinable jump. The right default for computation-heavy code is static dispatch; the right default for "many implementors, one call site, called rarely relative to program size" (plugin-style registries, heterogeneous collections) is `dyn`. Don't erase the type in the middle of a hot loop and then re-monomorphize around it — push the erasure to the boundary of the hot path, not through its center.
**Applies to us:** This is a direct tension with the project's `lto=true, codegen-units=1` release profile and wasm-size sensitivity (the engine is already a large share of the shipped artifact by prior measurement) — a naive "generic everywhere" shaper pipeline can bloat the wasm binary through duplicated monomorphized code paths per font-backend type parameter. Where `*-fontations` backends are swappable, consider `dyn FontSource` at the *outer* boundary (one indirect call per shaping run) while keeping the inner per-glyph/per-point kernels fully generic or concrete.
**Source:** [dyn Trait vs. alternatives — Learning Rust](https://quinedot.github.io/rust-learning/dyn-trait-vs.html) (checked 2026-09); [dyn Trait and impl Trait in Rust — Nick Cameron](https://www.ncameron.org/blog/dyn-trait-and-impl-trait-in-rust/).

### R18. Know which `impl Trait` you're writing: argument-position sugars a generic, return-position hides a concrete type
**Why:** `fn f(x: impl Trait)` desugars to `fn f<T: Trait>(x: T)` — it's purely sugar, still fully generic, still monomorphized, just without a name the caller can turbofish. `fn f() -> impl Trait` is a different feature entirely: an existential/opaque type — the function commits to exactly one concrete return type, hidden from the caller, and (as of Rust 2024, see below) captures lifetimes according to edition-specific rules. Conflating the two leads to surprises: you cannot, for example, return different concrete types from different branches of a function returning `impl Trait`, the way you *can* pass different concrete types to different calls of a function taking `impl Trait`.
**Applies to us:** general — relevant anywhere an iterator-returning method (`fn glyphs(&self) -> impl Iterator<Item = Glyph>`) is written, which is common across `shaper`'s and `slug-core`'s public surface.
**Source:** [`impl Trait` — Rust Reference](https://doc.rust-lang.org/reference/types/impl-trait.html); general Rust language semantics, stable since Rust 1.26 (2018) for both positions.

### R19. Don't assume `async fn` in a trait (AFIT/RPITIT) gives you a dyn-compatible trait — it doesn't, by default
**Why:** `async fn` and return-position `impl Trait` in traits, stabilized in Rust 1.75 (Dec 2023), desugar to an anonymous associated type — which makes the trait non-dyn-compatible out of the box, because the concrete future/iterator type varies per implementor and a vtable needs a fixed size. There is also no direct way to add a `Send` bound to the returned future via a `where` clause the way GATs allow. The `trait_variant::make` macro is the maintained, narrowly-scoped fix: it generates a second, `Send`-bounded (or otherwise bounded) version of the trait by rewriting `async fn` to explicit `-> impl Future<Output = _> + Send`. Reach for the older `async_trait` proc-macro (which boxes every future) only when you need actual `dyn Trait` objects, not just a `Send` bound.
**Applies to us:** General — this codebase's core crates are synchronous/`no_std`; the pitfall applies if any host-side tooling (`font-baker`, `mtsdf-baker` binaries, or a future dev-server) grows async trait-based plugin interfaces.
**Bad / Good:**
```rust
// Bad: silently not dyn-compatible, no way to add + Send
trait FontLoader { async fn load(&self, path: &Path) -> Font; }

// Good: explicit about the Send requirement
#[trait_variant::make(FontLoader: Send)]
trait LocalFontLoader { async fn load(&self, path: &Path) -> Font; }
```
**Source:** [Announcing `async fn` and RPIT in traits — Rust Blog](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/) (2023-12-21); [`trait-variant` — docs.rs](https://docs.rs/trait-variant/latest/trait_variant/) (fetched 2026-09).

## Type safety and typestate

### R20. Wrap primitives in newtypes to make unit/meaning confusion a compile error
**Why:** A bare `f64` or `u32` carries no information about what it measures; a `Miles(f64)` and a `Kilometers(f64)` cannot be passed to each other's call sites by accident, because they're distinct types. This is the same class of bug as the Mars Climate Orbiter loss (mixed metric/imperial units) — pushed from a runtime/operational failure to a `rustc` diagnostic. Prefer a private inner field plus a constructor/accessor over the guideline page's own simplified `pub` field example, so the representation stays free to change later (see R28 / C-STRUCT-PRIVATE).
**Applies to us:** `GlyphId`, `FeatureTag`, `Em`/font-unit vs. pixel-space coordinate distinctions across `mtsdf-core`/`slug-core`/`bitmap-baker` are exactly this hazard — a raw `f32` design-units value and a raw `f32` device-pixels value are trivially swappable by accident without newtypes.
**Bad / Good:**
```rust
// Bad
fn advance_cursor(x: f32) { ... } // design units? pixels? em? unclear, unchecked

// Good
pub struct DesignUnits(f32);
pub struct Pixels(f32);
fn advance_cursor(x: DesignUnits) { ... } // wrong unit is now a type error
```
**Source:** [Type safety — Rust API Guidelines, C-NEWTYPE](https://rust-lang.github.io/api-guidelines/type-safety.html) (fetched 2026-09); [derive_more](https://crates.io/crates/derive_more) for forwarding common traits (`Add`, `Display`, `From`, `Deref`) onto a newtype without hand-writing each impl (2.0.1, checked 2026-09).

### R21. Replace ambiguous `bool`/`Option<T>` parameters with a dedicated type
**Why:** `Widget::new(true, false)` requires opening the docs (or the source) to know what each position means; `Widget::new(Small, Round)` is self-documenting at the call site and gives you a place to add a third variant later without an ambiguous second `bool`. This is the same instinct as R20, applied to call-site arguments rather than stored fields.
**Applies to us:** Any shaping/layout entry point currently taking a `bool` for e.g. "right-to-left" or "vertical" should use a `Direction`/`WritingMode` enum instead — both because it documents itself and because a third writing mode (e.g. an eventual vertical-mixed mode) doesn't force a signature break the way a second unrelated `bool` parameter would.
**Source:** [Type safety — Rust API Guidelines, C-CUSTOM-TYPE](https://rust-lang.github.io/api-guidelines/type-safety.html) (fetched 2026-09).

### R22. Represent flag sets with the `bitflags` crate, not a hand-rolled enum or raw integer constants
**Why:** An `enum` models mutually exclusive choices; a set of independently-combinable options is a different shape, and forcing it into an enum either produces a combinatorial explosion of variants (`ReadWrite`, `ReadExecute`, `ReadWriteExecute`, …) or falls back to raw bitwise ops on an untyped integer, losing type safety and `Debug` output. `bitflags` (2.x) generates a typed wrapper with the operators, `Debug`, and (optionally) `Serialize` already correct.
**Applies to us:** Admission/validation flags in `mtsdf-admission`, or feature/variant flags on a baked artifact header, are the intended use case — not enum-shaped choices like rasterizer format (Bitmap/MSDF/Slug), which *are* mutually exclusive and belong in a plain enum.
**Bad / Good:**
```rust
// Bad: raw bits, no type safety, no Debug
const ADMIT_OVERSIZE: u32 = 0b0001;
const ADMIT_SPARSE: u32 = 0b0010;

// Good
bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct AdmitFlags: u32 {
        const OVERSIZE = 0b0001;
        const SPARSE    = 0b0010;
    }
}
```
**Source:** [Type safety — Rust API Guidelines, C-BITFLAG](https://rust-lang.github.io/api-guidelines/type-safety.html); [`bitflags` — docs.rs](https://docs.rs/bitflags/latest/bitflags/) (2.13.1, fetched 2026-09).

### R23. Encode small, compile-time-checkable state machines as typestate; fall back to a runtime enum once states or edges grow
**Why:** Typestate puts the state in the *type* — `Encoder<Idle>`, `Encoder<Streaming>` — instead of a runtime field, so an illegal transition (calling `finish()` on an `Idle` encoder) is a compile error, not a runtime `panic!`/`Result::Err`. Each state is a distinct zero-sized marker type; a generic struct carries the marker via `PhantomData<State>` so the state costs nothing at runtime and the transition methods (`fn start(self) -> Encoder<Streaming>`) consume `self` by value, making the old state's handle unusable after a transition. This pays off for small machines — three to five states with a simple transition graph, like `serde`'s `Serializer`. Beyond that, the type-level combinatorics (and the compile-time cost of the resulting monomorphized code) usually make a runtime enum plus a validated-transition function the more maintainable choice.
**Applies to us:** general — a natural fit for a baking/admission pipeline stage sequence (e.g. `Loaded → Admitted → Baked → Packed`) where each stage's API should only exist once the previous stage has run; not a fit for something with many independent, cross-cutting flags (that's R22's job).
**Bad / Good:**
```rust
// Bad: runtime-only guard, catchable only in tests (if at all)
struct Pipeline { stage: Stage /* enum: Loaded, Admitted, Baked */ }
impl Pipeline {
    fn bake(&mut self) { assert_eq!(self.stage, Stage::Admitted); ... }
}

// Good: illegal call is a compile error
struct Pipeline<S> { data: Data, _state: PhantomData<S> }
struct Loaded; struct Admitted; struct Baked;
impl Pipeline<Loaded> {
    fn admit(self) -> Result<Pipeline<Admitted>, AdmissionError> { ... }
}
impl Pipeline<Admitted> {
    fn bake(self) -> Pipeline<Baked> { ... } // only callable after admit()
}
```
**Source:** [The Typestate Pattern in Rust — Cliffle](https://cliffle.com/blog/rust-typestate/); [Typestate pattern — Victor Farazdagi](https://farazdagi.com/posts/2024-04-07-typestate-pattern/) (2024-04-07); [`PhantomData` — std docs](https://doc.rust-lang.org/std/marker/struct.PhantomData.html).

## Builders and construction

### R24. Builders default to non-consuming `&mut self`; use consuming `self -> Self` only when a step must move ownership; mark the terminal method `#[must_use]`
**Why:** A non-consuming builder (`fn width(&mut self, w: u32) -> &mut Self`) lets a caller build conditionally in a loop or `if` without re-binding; a consuming builder (`fn width(self, w: u32) -> Self`) is required when a setter needs to hand ownership of something (e.g. a `thread::Builder`-style API feeding into `spawn`) further down the chain. Whichever shape you pick, the value produced by the terminal `build()`/`finish()` call is worthless if silently dropped — mark it `#[must_use]` so an omitted `let x = ...` is a warning, not a silent no-op. For anything beyond a handful of optional fields, prefer a compile-time-checked builder generator (`bon` or `typed_builder`) over a hand-rolled `Option<T>`-per-field struct that only discovers a missing required field via a `.unwrap()` panic at `build()` time.
**Applies to us:** A `RasterArtifact`/bake-request builder with several optional knobs (format, padding, admission thresholds) is the canonical case; `bon`'s typestate-generated builders reject a missing required field at compile time, which matters more than usual here given the "no sleeps/retries/regenerated goldens" determinism bar this repo holds itself to — a construction bug should fail the build, not a CI run.
**Bad / Good:**
```rust
// Bad: required field enforced only by a runtime panic
#[derive(Default)]
struct BakeRequestBuilder { format: Option<Format>, padding: u32 }
impl BakeRequestBuilder {
    fn build(self) -> BakeRequest {
        BakeRequest { format: self.format.expect("format required"), padding: self.padding }
    }
}

// Good: compile-time-checked required field (bon-style)
#[bon::builder]
struct BakeRequest { format: Format, #[builder(default)] padding: u32 }
// BakeRequest::builder().padding(2).build() // compile error: missing `format`
```
**Source:** [Type safety — Rust API Guidelines, C-BUILDER](https://rust-lang.github.io/api-guidelines/type-safety.html); [`bon` — bon-rs.com](https://bon-rs.com/guide/overview) (fetched 2026-09); [When to add `#[must_use]`](https://std-dev-guide.rust-lang.org/policy/must-use.html).

### R25. Constructors are static inherent functions (`new`, `with_*`, `from_*`), never free functions or trait methods pretending to be one
**Why:** `Type::new(...)` is discoverable via autocomplete on the type and doesn't require an extra `use`; a free function `new_widget(...)` scattered in a module namespace is not. Reserve `from_*` for conversions that need something a `From` impl can't offer — fallibility signaled by name, disambiguation between multiple valid source encodings, or `unsafe`ty — and use plain `From`/`TryFrom` otherwise so the type composes with generic code that bounds on those traits (R5).
**Applies to us:** general — every builder/baker crate's entry type should expose `new()`/`with_capacity()`/`from_bytes()` as inherent associated functions.
**Source:** [Predictability — Rust API Guidelines, C-CTOR](https://rust-lang.github.io/api-guidelines/predictability.html) (fetched 2026-09).

## Predictability and future-proofing

### R26. Smart pointers add no inherent methods that could collide with the pointee's, and only actual smart pointers implement `Deref`/`DerefMut`
**Why:** If `Box<T>` had an inherent `into_raw` *method*, `boxed_value.into_raw()` would be ambiguous to a reader — is that `Box`'s method or `T`'s, auto-dereffed? That's why `Box::into_raw(b)` is an associated function taking `b` explicitly, not `b.into_raw()`. The same discipline protects `Deref`: it's designed for transparent-pointer ergonomics (`Box`, `Rc`, `Arc`, `String`, `Cow`), and implementing it on an unrelated type purely so field access reads shorter breaks the compiler's implicit method-resolution and coercion rules in ways that surprise callers (autoderef pulling in methods from a type the caller didn't ask for).
**Applies to us:** general — relevant if any arena/handle wrapper in the wasm ABI layer is tempted to implement `Deref<Target = T>` for ergonomics; prefer an explicit accessor method instead.
**Source:** [Predictability — Rust API Guidelines, C-SMART-PTR / C-DEREF](https://rust-lang.github.io/api-guidelines/predictability.html) (fetched 2026-09).

### R27. Seal a trait with a private supertrait before 1.0 if you want room to add methods to it later
**Why:** Adding a method to a public trait is a breaking change for every downstream implementor — unless the trait is sealed, meaning only the defining crate can implement it. The standard pattern makes the public trait require a private supertrait (`trait Public: private::Sealed {}`) whose name downstream code cannot spell, because the module it lives in is not `pub`. A variant seals only specific methods (not the whole trait) by giving them an unnameable-type parameter, which lets downstream crates implement the rest of the trait while the sealed methods stay closed.
**Applies to us:** Any trait meant purely as an internal extension point between the `*-fontations` backend crates and `shaper`/`*-core` (rather than a genuine third-party-implementable plugin trait) should be sealed from its first release — unsealing later (removing the bound) is backward-compatible, but sealing later is not, since it would break any implementation a downstream crate had already written in the gap.
**Bad / Good:**
```rust
// Good: sealed trait, safe to add methods to `Backend` in a minor release
mod private { pub trait Sealed {} }
pub trait Backend: private::Sealed {
    fn table(&self, tag: [u8; 4]) -> Option<&[u8]>;
}
impl private::Sealed for FontationsBackend {}
impl Backend for FontationsBackend { ... }
```
**Source:** [Future proofing — Rust API Guidelines, C-SEALED](https://rust-lang.github.io/api-guidelines/future-proofing.html); [A definitive guide to sealed traits in Rust](https://predr.ag/blog/definitive-guide-to-sealed-traits-in-rust/) (fetched 2026-09).

### R28. Keep struct fields private; expose validated accessors — this is also how argument validation gets enforced
**Why:** A `pub` field is a permanent commitment to both its type and the invariant-free ability to set it to anything of that type — you can never again add a validation step, because existing code already constructs/mutates the field directly. Private fields plus a constructor (which can reject bad input) and getters (which can never return a bad value, because none was ever stored) is how C-VALIDATE's "push validity to construction time" actually gets implemented in practice, not just a separate style preference.
**Applies to us:** general — applies to every public struct across all 12 crates; the API-surface audit this repo already tracks in `docs/planning/api-surface-audit.md` is the natural place to check this for types crossing the `/core` boundary.
**Source:** [Future proofing — Rust API Guidelines, C-STRUCT-PRIVATE](https://rust-lang.github.io/api-guidelines/future-proofing.html) (fetched 2026-09).

### R29. Don't copy derived-trait bounds onto a generic struct's own type parameters
**Why:** Writing `struct Wrapper<T: Clone + Debug + PartialEq> { ... }` locks the struct's *definition* to those bounds forever — adding a `PartialOrd` derive later requires also adding `T: PartialOrd` to the struct header, which is a breaking change for any caller who had a `T` satisfying the old bounds but not the new one. Let `#[derive(...)]` generate its own (correctly minimal, per-field) bounds on `impl` blocks instead; the struct definition itself should carry a bound only when it references an associated type, needs `?Sized`, or is required by a manual `Drop` impl.
**Applies to us:** general — a common trap in a data-oriented, heavily-generic-over-buffer-element-type codebase (SIMD kernels genericized over lane width/element type are exactly where this bound-duplication instinct shows up).
**Bad / Good:**
```rust
// Bad: struct header bound blocks future derives from being additive
struct GlyphRun<T: Clone + Debug> { points: Vec<T> }

// Good
struct GlyphRun<T> { points: Vec<T> }
impl<T: Clone> Clone for GlyphRun<T> { ... } // bound lives on the impl, not the type
```
**Source:** [Future proofing — Rust API Guidelines, C-STRUCT-BOUNDS](https://rust-lang.github.io/api-guidelines/future-proofing.html) (fetched 2026-09).

### R30. Validate at the type level first, dynamically second, and give hot paths an explicit `_unchecked` opt-out
**Why:** The guidelines rank four enforcement tiers by preference: (1) a type that makes the invalid state unrepresentable (an `Ascii` wrapper instead of raw `u8`), which costs nothing at runtime and fails at compile time; (2) a runtime check that returns `Result`/`Option` or panics; (3) the same check gated behind `debug_assert!` so release builds skip it; (4) a documented `_unchecked` sibling (or a `raw` module) for call sites that have already established the invariant and can't afford to re-check it. Rust's stance deliberately rejects "be liberal in what you accept" — invalid input should be unrepresentable or rejected, not silently coerced.
**Applies to us:** SIMD kernels and wasm ABI entry points are the concrete tier-4 case: a `simd128`-gated kernel operating on a batch that the caller has already bounds- and alignment-checked at the boundary shouldn't re-validate per lane; the safe, checked entry point should be the default and the `_unchecked`/`unsafe` one should be named and documented as the deliberate exception, not the norm.
**Source:** [Dependability — Rust API Guidelines, C-VALIDATE](https://rust-lang.github.io/api-guidelines/dependability.html) (fetched 2026-09).

### R31. `Drop` must never fail or block; expose an explicit fallible `close()`/`finish()` for anything that can
**Why:** A panic inside a `Drop::drop` that runs during unwinding from another panic aborts the process — there is no `Result` return type available to `drop`, so a fallible teardown operation (flushing a buffer, closing a file, releasing a lease) has nowhere safe to report failure from `Drop` alone. The fix is a explicit, callable `close(self) -> Result<(), E>` that callers who care about the outcome call directly; `Drop` becomes a fallback that best-effort cleans up and swallows/logs errors for callers who didn't.
**Applies to us:** Any wasm-side arena or allocator-backed handle (talc-allocated regions, mapped buffers) whose teardown could plausibly fail should follow this — `Drop` unconditionally frees the region, but if there's a "flush admitted glyphs to the artifact" step that can fail, it needs its own fallible method, not a `Drop` impl that panics.
**Source:** [Dependability — Rust API Guidelines, C-DTOR-FAIL / C-DTOR-BLOCK](https://rust-lang.github.io/api-guidelines/dependability.html) (fetched 2026-09).

## Edition 2024 (vs. 2021)

### R32. Wrap every unsafe operation inside an `unsafe fn` body in its own `unsafe {}` block
**Why:** Before edition 2024, an `unsafe fn`'s entire body was implicitly an unsafe-operation-permitting context — you could dereference a raw pointer anywhere inside it with no inner `unsafe {}` marker, which made it easy to lose track of *which* operation in a long function was actually the unsafe one. The `unsafe_op_in_unsafe_fn` lint, allow-by-default in earlier editions, now **warns by default starting in edition 2024** — every unsafe operation needs its own explicit block even inside a function that is itself `unsafe fn`. This is a pure clarity/audit-surface change, not a capability change.
**Applies to us:** Directly hits the wasm ABI modules and SIMD kernels, which is where this project concentrates its `unsafe` — every `unsafe fn` there needs an audit pass to wrap each raw-pointer deref, each `core::arch::wasm32` intrinsic call, and each uninitialized-memory access in its own `unsafe {}`, both for the lint and because it's the entire point: it makes the *specific* unsafe operation, not the whole function, greppable.
**Bad / Good:**
```rust
// Bad (warns under edition 2024's default-on unsafe_op_in_unsafe_fn)
pub unsafe fn write_lane(ptr: *mut f32, v: f32) {
    *ptr = v; // implicit unsafe context — no longer sufficient
}

// Good
pub unsafe fn write_lane(ptr: *mut f32, v: f32) {
    unsafe { *ptr = v; } // the specific unsafe operation is marked
}
```
**Source:** [Rust 2024: language changes — Edition Guide](https://doc.rust-lang.org/stable/edition-guide/rust-2024/language.html) (checked 2026-09).

### R33. Mark `extern` blocks and `#[no_mangle]`/`#[export_name]`/`#[link_section]` as `unsafe`
**Why:** Edition 2024 requires `unsafe extern { ... }` for every foreign-function block (previously plain `extern { ... }` was legal) and requires the `#[unsafe(no_mangle)]`/`#[unsafe(export_name(...))]`/`#[unsafe(link_section(...))]` spelling for those attributes — both changes make explicit that the *author* is responsible for the extern declaration matching the real foreign signature, and for the exported symbol name/section being correct, since the compiler cannot check either.
**Applies to us:** This is a direct, mechanical hit on the wasm ABI modules, which by definition declare the crate's `extern "C"` exported surface — every such block and every `#[no_mangle]` export in those modules needs the `unsafe` marker added when the crate moves to (or stays on) edition 2024. `cargo fix --edition` handles the mechanical rewrite; a reviewer can grep for bare `extern "C" {` or `#[no_mangle]` (without `#[unsafe(...)]`) to catch anything the auto-fix missed or that was hand-written after the migration.
**Bad / Good:**
```rust
// Bad — rejected by rustc under edition 2024
extern "C" { fn host_log(ptr: *const u8, len: usize); }
#[no_mangle]
pub extern "C" fn shape_glyphs(ptr: *mut u8, len: usize) -> i32 { ... }

// Good
unsafe extern "C" { fn host_log(ptr: *const u8, len: usize); }
#[unsafe(no_mangle)]
pub extern "C" fn shape_glyphs(ptr: *mut u8, len: usize) -> i32 { ... }
```
**Source:** [Unsafe extern blocks — Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html); [Unsafe attributes — Edition Guide](https://doc.rust-lang.org/nightly/edition-guide/rust-2024/unsafe-attributes.html); [RFC 3484](https://rust-lang.github.io/rfcs/3484-unsafe-extern-blocks.html) (checked 2026-09).

### R34. Re-audit every `impl Trait` return type after adopting edition 2024 — lifetime capture rules changed
**Why:** In edition 2021 and earlier, a return-position `impl Trait` only captured a generic lifetime parameter if that lifetime appeared syntactically in one of the `impl Trait`'s own bounds — an elided/anonymous input lifetime was *not* captured unless mentioned. In edition 2024, **all** in-scope type and lifetime parameters are captured by default, whether mentioned in a bound or not. This can silently widen a function's returned-opaque-type API contract (the caller can no longer assume the returned value is lifetime-independent of an input it didn't seem to borrow from) or, going the other way, break existing call sites that relied on the narrower 2021 capture set. Rust 1.82 added `+ use<'a, T>` precise-capturing syntax so you can pin exactly which parameters are captured, in any edition; `cargo fix --edition` inserts these automatically where behavior would otherwise change.
**Applies to us:** Any `shaper`/`slug-core` method returning `impl Iterator<Item = ...>` or another opaque type, that takes a borrowed input the return value doesn't actually retain, needs an explicit `+ use<..>` (or `+ use<'_>` / a named subset) after the edition-2024 migration to avoid over-capturing that would otherwise force a caller's borrow of the input to outlive the returned iterator unnecessarily.
**Bad / Good:**
```rust
// Rust 2021: does NOT capture the elided lifetime of `_`
fn glyph_ids(&self) -> impl Iterator<Item = GlyphId> + '_ { ... }

// Rust 2024 default: captures it (may over-capture vs. 2021 intent)
fn glyph_ids(&self) -> impl Iterator<Item = GlyphId> + '_ { ... }

// Rust 2024, explicit: pin exactly the 2021 behavior
fn glyph_ids(&self) -> impl Iterator<Item = GlyphId> + use<> { ... }
```
**Source:** [RPIT lifetime capture rules — Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/rpit-lifetime-capture.html) (fetched 2026-09, includes exact before/after examples used above).

### R35. Let-chains (`if let ... && ... && cond`) are stable since Rust 1.88 (June 2025) under edition 2024 — stop nesting `match`/`if let` to fake them
**Why:** Combining a pattern-match and a boolean condition, or multiple pattern-matches, used to require nested `if let` blocks or a `matches!`-plus-guard workaround. Let-chains make `if let Some(a) = x && let Some(b) = y && a < b { ... }` valid directly. The feature depends on edition 2024's revised temporary-drop-scope rules for `if let`, so it's edition-gated — it isn't available by simply upgrading the compiler on an edition-2021 crate.
**Applies to us:** general cleanup opportunity in admission/validation code that currently nests `if let` purely to also check a numeric threshold or a second `Option`; worth a pass now that the whole workspace is on edition 2024 and Rust 1.97.1 (well past 1.88).
**Source:** [Rust 1.88.0 release notes](https://blog.rust-lang.org/2025/06/26/Rust-1.88.0/) (2025-06-26).

## Const generics, modules, and tooling

### R36. Treat `generic_const_exprs` as unusable in production; stay within stable `min_const_generics`
**Why:** Plain const generics (`struct Buf<const N: usize>([u8; N])`, stable since Rust 1.51/2021) are solid and idiomatic. The more powerful `#![feature(generic_const_exprs)]` — which would allow expressions like `[u8; N * 2]` or `[u8; N + 1]` in a const position — remains highly experimental with known-broken interactions (const/type defaults, lifetimes) and no stabilization path as such; the language team's 2025 project goal was explicitly to prototype a *different*, stricter design (`min_generic_const_args`) rather than push the existing feature toward stabilization. Any crate depending on `generic_const_exprs` today is pinned to nightly indefinitely, with no migration guarantee to whatever eventually stabilizes.
**Applies to us:** Directly relevant given the data-oriented-design goal and SIMD lane-width genericity — any temptation to write `[T; LANES * 2]`-style buffer types needs to work within stable const-generic arithmetic done *outside* the type (e.g., a second explicit const parameter, or a helper computing the size before monomorphization) rather than inline const expressions in generic position.
**Source:** ["Stabilizable" prototype for expanded const generics — Rust Project Goals 2025H1](https://rust-lang.github.io/rust-project-goals/2025h1/min_generic_const_arguments.html) (checked 2026-09); [Tracking issue #76560](https://github.com/rust-lang/rust/issues/76560).

### R37. Structure modules around the public API you want, not the file tree; keep private module paths out of the API
**Why:** A module's *file layout* is an implementation detail; what matters for API design is what's `pub` and where `pub use` re-exports land. A deep private module tree (`crate::internal::backend::fontations::table::cff::parser`) is fine as long as the type it defines is re-exported at a shallow, curated path (`crate::CffTable`) — callers should never need to spell the internal path. `pub(crate)` is the default for anything crossing an internal module boundary that isn't meant to be part of the crate's external contract.
**Applies to us:** With 12 crates and a stated `/core`-vs-root split (per this repo's `engine-call-contract` convention — root for types an application can encounter, `/core` for integrator-only construction types), this is the general mechanism that convention rests on: `pub(crate)` internals, `pub use` re-exports forming the curated facade at the crate root, private paths free to be reorganized without a semver bump.
**Source:** [Rust modules vs files — fasterthanli.me](https://fasterthanli.me/articles/rust-modules-vs-files); [Separating Modules into Different Files — The Rust Book, ch. 7](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html) (checked 2026-09).

### R38. Enable `[workspace.lints]` once at the workspace root; every member inherits with `lints.workspace = true`
**Why:** Stable since Rust 1.74 (Nov 2023, RFC 3389), workspace-level lint configuration lets a monorepo declare `#![warn(...)]`/`#![deny(...)]`/clippy lint levels exactly once, in the root `Cargo.toml`'s `[workspace.lints.rust]`/`[workspace.lints.clippy]` tables, instead of copy-pasted `#![...]` attributes (which drift) in every crate's `lib.rs`. Each member crate opts in with a two-line `[lints] workspace = true`. A member cannot mix `workspace = true` with its own additional lint overrides at the same level — it's a hard error — so any crate needing an exception takes it at the item/module level with a targeted `#[allow(...)]`, not by opting out of the workspace table.
**Applies to us:** With 12 crates sharing one engineering standard, this is the direct mechanism for enforcing it uniformly — including `clippy::result_large_err` (R13) and any project-specific `unsafe`-auditing lints — without relying on each crate author remembering to copy the right attribute block.
**Source:** [RFC 3389: manifest lint](https://rust-lang.github.io/rfcs/3389-manifest-lint.html); [Workspaces — The Cargo Book](https://doc.rust-lang.org/cargo/reference/workspaces.html) (checked 2026-09).

### R39. Add `#[must_use]` to values whose only purpose is being read or chained; skip it where fire-and-forget is legitimate
**Why:** The attribute exists for the specific failure mode where constructing or returning a value and then silently dropping it is *almost certainly* a bug: `Result` (an ignored error), adapter/combinator return values from `Iterator` (which are lazy and do nothing unless driven), non-mutating "builder-ish" methods like `saturating_add` (easy to mistake for in-place mutation). It is deliberately *not* applied to things with a real fire-and-forget use case — `thread::JoinHandle` is the standard library's own example of a type that stays without `#[must_use]` because detaching a thread is legitimate, not a bug. Before adding it, check for a legitimate ignore-the-value use case; if one is common, the attribute will just train people to write `let _ = ...` reflexively, which defeats its purpose.
**Applies to us:** Builder terminal methods (R24) and any "check this and get back a validated handle" API (e.g., an admission-check function returning a token/receipt type) are the clear cases; a "kick off background prewarming" style method, if one exists, is the clear exception.
**Source:** [When to add `#[must_use]` — std-dev-guide](https://std-dev-guide.rust-lang.org/policy/must-use.html) (checked 2026-09); [RFC 1940: must-use functions](https://rust-lang.github.io/rfcs/1940-must-use-functions.html).

### R40. Prefer iterator adapters for a simple single-pass transform; keep the explicit loop when the body has multi-variable state, early exit, or accesses more than one index per iteration
**Why:** Iterator chains are a genuine zero-cost abstraction — LLVM strips the adapter machinery and produces code equivalent to a hand-written loop for the common case, and the chain form documents intent (map/filter/fold) more directly than a loop body that mixes iteration mechanics with logic. But the inverse is not "iterators always win": `clippy::needless_range_loop`'s own tracked issues acknowledge that mechanically rewriting an indexed loop into `.iter().enumerate()` can both increase the optimizer's work in practice and obscure a loop body that's doing something more imperative — multiple independent indices into the same slice, early-`break`/`continue`-heavy control flow, or state threaded across iterations that doesn't map cleanly onto `fold`/`scan`. Prefer `filter_map` over a separate `.filter().map()` pair when a step can fail/be absent, since it avoids constructing and immediately discarding intermediate `Option`s.
**Applies to us:** SIMD kernels and inner shaping loops are exactly where "always use iterator adapters" is the wrong instinct — a kernel walking two or three parallel buffers by index, or unrolling by lane width, reads and optimizes better as an explicit indexed loop than as a forced `.zip().enumerate()` chain; reserve the adapter-chain style for the higher-level, single-pass, non-performance-critical glue code.
**Source:** [Comparing Performance: Loops vs. Iterators — The Rust Book, ch. 13](https://doc.rust-lang.org/book/ch13-04-performance.html); [`needless_range_loop` intrusiveness — rust-clippy #6075](https://github.com/rust-lang/rust-clippy/issues/6075) (checked 2026-09, disagreement among maintainers noted directly in the thread).

---

## Where sources disagree

- **`needless_range_loop` (R40):** Clippy's own lint authors are on record (issue #6075, #2072) that the lint's blanket suggestion is not always an improvement — compiler back-end work and readability can both regress. Recommendation: keep the lint enabled workspace-wide for glue code, but scope `#[allow(clippy::needless_range_loop)]` per-function in kernels rather than disabling it repo-wide.
- **Newtype field visibility (R20):** The API Guidelines' own C-NEWTYPE example uses a `pub` inner field for brevity, which is in tension with the same guidelines' C-STRUCT-PRIVATE and C-NEWTYPE-HIDE (future-proofing) sections a few pages later. Recommendation: private field + `From`/accessor, matching C-STRUCT-PRIVATE, treating the C-NEWTYPE page's `pub` field as a simplified teaching example rather than the recommended shape for a real published type.
- **`async_trait` vs. native AFIT (R19):** Older (pre-2024) material still defaults to recommending the `async_trait` macro for all trait-based async code; this is now dated for the common case. Recommendation: default to native `async fn` in traits, add `trait_variant::make` only for the `Send`-bound need, and reserve `async_trait`'s boxing for genuine `dyn Trait` object requirements.
