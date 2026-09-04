---
type: Reference
title: Rust codex — Type-driven design and error modeling
description: Checkable rules on type-driven design and error modeling, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Type-Driven Design in Rust: Errors, State, and Invalid States (2026)

## Error modeling for libraries

### R1. Never return `Box<dyn Error>`, `String`, `()`, or `anyhow::Error` from a public library function.
**Why:** `()` has no `Display`/`Debug` a caller can render and cannot participate in `?`-conversion via `From`; `Box<dyn Error>` and `anyhow::Error` type-erase the failure so a caller can only log it, never `match` on it; `String` is the same problem with extra allocation.
**Applies to us:** every `pub fn` in `packages/*` that can fail (shaping, baking, layout, wasm entry points) needs a named local error enum, not a stringly-typed or trait-object return.
**Bad / Good:**
```rust
// Bad
pub fn shape(text: &str) -> Result<Buffer, String> { ... }

// Good
pub fn shape(text: &str) -> Result<Buffer, ShapeError> { ... }
```
**Source:** [Rust API Guidelines — Interoperability, C-GOOD-ERR](https://rust-lang.github.io/api-guidelines/interoperability.html), retrieved 2026-09-03.

### R2. Implement `core::error::Error`, gate nothing behind `std` unless you use `std::path` formatting or similar.
**Why:** `Error` moved into `core` and stabilized in Rust 1.81 (released 2024-09-05): *"1.81 stabilizes the `Error` trait in `core`, allowing usage of the trait in `#![no_std]` libraries... to standardize on the same Error trait, regardless of what environments the library targets."* Below 1.81, `core::error::Error` does not exist; the fallback is either raising MSRV to 1.81+, or (if that's not possible) implementing only `Debug`+`Display` and exposing your own `fn source(&self) -> Option<&dyn YourTrait>`-shaped accessor instead of the real trait, upgrading to a real `impl Error` once MSRV allows it.
**Applies to us:** moot for MSRV — this repo pins Rust 1.97.1, well past 1.81 — so every crate's error types should implement `core::error::Error` unconditionally, no `#[cfg(feature = "std")]` gate needed for the trait impl itself.
**Bad / Good:**
```rust
// Bad: silently un-implementable pre-1.81, and needlessly std-gated post-1.81
#[cfg(feature = "std")]
impl std::error::Error for ShapeError {}

// Good
impl core::error::Error for ShapeError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        None
    }
}
```
**Source:** [Rust 1.81.0 release notes](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/), 2024-09-05; [tracking issue rust-lang/rust#103765](https://github.com/rust-lang/rust/issues/103765); [`core::error::Error` docs](https://doc.rust-lang.org/core/error/trait.Error.html), retrieved 2026-09-03.

### R3. Prefer `thiserror` with `default-features = false` over hand-written `Display`/`Debug`/`Error` boilerplate, even in `no_std`.
**Why:** thiserror's own crate root is `#![no_std]` unconditionally (verified directly from source), and its derive expands to `core::error::Error`, not `std::error::Error`. The default-on `"std"` feature only adds convenience `Display` formatting for `std::path::{Path, PathBuf}` — it is not what makes the derive `no_std`-capable. Internally the crate does `#[cfg(feature = "std")] extern crate std as core;`, aliasing the `core` path to `std` so the same generated code compiles either way.
**Applies to us:** with `no_std + alloc` and Rust 1.97.1, every crate can take `thiserror = { version = "2", default-features = false }` and get `#[derive(Error)]`, `#[error("...")]`, `#[from]`, `#[source]` for free, with zero std dependency.
**Bad / Good:**
```rust
// Bad: hand-rolled boilerplate for something a derive does correctly
#[derive(Debug)]
pub enum LayoutError { EmptyRun, Overflow(u32) }
impl core::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::EmptyRun => write!(f, "empty run"),
            Self::Overflow(n) => write!(f, "layout overflow at {n}"),
        }
    }
}
impl core::error::Error for LayoutError {}

// Good
#[derive(Debug, thiserror::Error)]
pub enum LayoutError {
    #[error("empty run")]
    EmptyRun,
    #[error("layout overflow at {0}")]
    Overflow(u32),
}
```
```toml
[dependencies]
thiserror = { version = "2", default-features = false }
```
**Source:** verified directly from [thiserror `src/lib.rs`](https://raw.githubusercontent.com/dtolnay/thiserror/master/src/lib.rs) (`#![no_std]`, `extern crate std as core`) and [`src/aserror.rs`](https://raw.githubusercontent.com/dtolnay/thiserror/master/src/aserror.rs) (uses `core::error::Error` throughout, no feature gates), retrieved 2026-09-03; thiserror 2.0.20 released 2026-08-08 per [docs.rs](https://docs.rs/crate/thiserror/latest).

### R4. Never put `anyhow::Error`/`eyre::Report` in a library's public signature.
**Why:** both type-erase every failure into one opaque object, so a caller can no longer `match` on what went wrong — only `.downcast_ref::<ConcreteType>()` blindly, which requires already knowing the concrete type, defeating the point of an opaque return. This is an API-shape objection, not a no_std objection: anyhow itself is `#![no_std]`-capable (`default-features = false` + a global allocator), gated on the same `core::error::Error` stabilization as thiserror — verified directly from anyhow's source, which states pre-1.81 no_std users need an extra `.map_err(Error::msg)` because *"the trait that `?`-based error conversions are defined by is only available in std in those old versions."* eyre is architecturally a fork of anyhow (same `Report`/type-erasure shape), so the same objection applies to it.
**Applies to us:** fine in `apps/*` binaries, example harnesses, or test code; never in `packages/*` public APIs. An `anyhow::Error` also has no defined C layout, so it cannot cross the wasm ABI at all — see R37/R40.
**Source:** verified directly from [anyhow `src/lib.rs`](https://raw.githubusercontent.com/dtolnay/anyhow/master/src/lib.rs) (`#![no_std]`, no_std doc section, `default-features = false` instructions, 1.81 caveat) and [`Cargo.toml`](https://raw.githubusercontent.com/dtolnay/anyhow/master/Cargo.toml) (`std` in `default`), retrieved 2026-09-03; general guidance also in [oneuptime.com, "How to Design Error Types with thiserror and anyhow in Rust"](https://oneuptime.com/blog/post/2026-01-25-error-types-thiserror-anyhow-rust/view), 2026-01-25.

### R5. Size each error enum to one public fallible *operation* (or tightly related group), not to a module and not to the whole crate.
**Why:** an enum sized to "everything this crate can fail at" forces every caller of every function to handle variants that can't occur for the function they called (dead match arms, or a `_` that swallows real bugs — see R32). An enum sized to one operation lets the caller's `match` be exhaustive *and* meaningful.
**Applies to us:** `shaper`, `font-baker`, and the layout engine each have several independently-failing entry points (bake a font, shape a run, lay out a paragraph); each deserves its own error enum rather than one `GlyphError` covering all of them.
**Source:** [nrc, "Error type design", Rust Error Handling doc](https://nrc.github.io/error-docs/error-design/error-type-design.html): *"one error type per module is sometimes OK, but I wouldn't recommend it as a general rule"* — the right granularity tracks the abstraction level of the API, not the file layout. Retrieved 2026-09-03.

### R6. Don't wrap a whole upstream error type as a bare enum variant; embed the specific context you actually had.
**Why:** `Io(std::io::Error)` forces every caller to understand `std::io::Error` (a transitive dependency's type) to handle your error, and discards the context you had at the call site (which path, which operation) that would have let the caller actually react. thiserror's `#[from]` makes bare-wrapping frictionless, which is exactly why it's easy to reach for by accident.
**Applies to us:** a font-baking error that bare-wraps a `ttf-parser` error tells the caller nothing actionable; a variant carrying `{ table: &'static str, offset: usize, cause: TtfParserError }` does.
**Bad / Good:**
```rust
// Bad
pub enum BakeError {
    Parse(ttf_parser::FaceParsingError),
}

// Good
pub enum BakeError {
    MalformedTable { table: &'static str, offset: usize },
}
```
**Source:** [nrc, error-type-design.html](https://nrc.github.io/error-docs/error-design/error-type-design.html): *"consider it an anti-pattern unless you can prove otherwise... there is additional context that is likely to be useful when recovering or debugging"*; also [mmapped.blog, "Designing error types in Rust"](https://mmapped.blog/posts/12-rust-error-handling): recommends embedding over wrapping, contrasting a `FetchTxError` that wraps `io::Error`/`http2::Error`/`serde_cbor::Error` against one that embeds `ConnectionFailed { url, reason, cause }`. Retrieved 2026-09-03.

### R7. Mark public error enums `#[non_exhaustive]` as a deliberate per-type choice, not a reflex.
**Why:** within the defining crate the attribute is a no-op — RFC 2008: *"the attribute is essentially ignored, so that the current crate can continue to exhaustively match the enum"* — but downstream crates are forced to add a wildcard arm, and, for a `#[non_exhaustive]` **struct**, are also blocked from struct-literal construction even when they name every field. That second effect means the attribute is wrong for a struct whose whole public purpose is field construction (e.g. a plain options/config struct meant to be built with a literal).
**Applies to us:** `ShapeError`, `BakeError`, `LayoutError` — yes. A plain `LayoutOptions { ... }` config struct meant for `LayoutOptions { size, ... }` literals — no, or provide a builder instead.
**Source:** [RFC 2008 — non-exhaustive](https://github.com/rust-lang/rfcs/blob/master/text/2008-non-exhaustive.md), merged 2017, stabilized Rust 1.40.0; retrieved 2026-09-03.

### R8. Name error variants for the failure, not for their own type.
**Why:** `MyError::Io` reads as "an I/O failure happened"; `MyError::IoError` stutters the type name into the variant name for no informational gain. This is purely a review-grep-able convention, but it's a real signal of care in error taxonomy.
**Applies to us:** grep exported error enums for variants ending in `Error` — `ParseError`, `IoError`, `FontError` as *variant names inside* an already-named error enum are the smell.
**Bad / Good:**
```rust
// Bad
pub enum FontError { ParseError(...), IoError(...) }
// Good
pub enum FontError { Parse(...), Io(...) }
```
**Source:** [nrc, error-type-design.html](https://nrc.github.io/error-docs/error-design/error-type-design.html), retrieved 2026-09-03.

### R9. Keep `size_of::<YourError>()` small; box rare or large payloads instead of inflating every `Result`.
**Why:** an enum's size is (at minimum) its largest variant plus discriminant/padding, and that size applies to *every* `Result<T, YourError>` in the crate — including the `Ok` path, which now has to reserve stack space it never uses. Clippy's `result_large_err` lint (default threshold 128 bytes) exists precisely because this is easy to trigger by accident with one oversized variant.
**Applies to us:** a hypothetical `ErrorKind::VeryLargeError([i32; 1024])` variant makes `size_of::<Result<i32, ErrorKind>>() == 4104`; boxing that one variant's payload (`Box<[i32; 1024]>` or boxing the whole enum) drops it to `16`. Check any error variant that embeds a fixed-size buffer, a glyph outline, or a full source string.
**Bad / Good:**
```rust
// Bad: any variant with a large payload inflates the whole Result
pub enum BakeError {
    Overflow,
    BadOutline([Point; 512]), // huge — every Result<T, BakeError> pays for this
}

// Good
pub enum BakeError {
    Overflow,
    BadOutline(Box<[Point; 512]>),
}
```
**Source:** measured example (`Result<i32, Error>` boxed = 16 bytes vs `Result<i32, ErrorKind>` unboxed = 4104 bytes) from [baarse.substack.com, "Rust, enum, boxed error, and stack size"](https://baarse.substack.com/p/rust-enum-boxed-error-and-stack-size); lint mechanics from [rust-clippy issue #9538](https://github.com/rust-lang/rust-clippy/issues/9538) and [PR #9373](https://github.com/rust-lang/rust-clippy/pull/9373) (128-byte default threshold, `Box<E>` as the standard fix). Retrieved 2026-09-03.

### R10. Implement `source()` deliberately, and never duplicate the cause in both `Display` and `source()`.
**Why:** `core::error::Error::source(&self) -> Option<&(dyn Error + 'static)>` exists so generic error-reporting code can walk the cause chain programmatically; if `Display` *also* renders the full chain as text, every layer of a reporter that calls both will print the same cause twice.
**Applies to us:** an error reporter sitting above the wasm boundary (or a `tracing`-style logger in an example app) will walk `source()` to print a chain — don't also inline the whole chain into the top-level `Display` message.
**Bad / Good:**
```rust
// Bad: cause appears in both Display and source()
impl fmt::Display for E {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "failed: {}", self.cause) // renders full chain
    }
}
impl core::error::Error for E {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        Some(&self.cause) // ...and exposes it again
    }
}
```
**Source:** [`core::error::Error` docs](https://doc.rust-lang.org/core/error/trait.Error.html) — *"return underlying errors via `source()` OR render them in `Display`, but not both"*; `source()` stable since Rust 1.30. Retrieved 2026-09-03.

### R11. Implement `From<Inner> for YourError` for every conversion `?` should perform silently; don't `#[from]` a type you don't want in your public surface.
**Why:** the `?` operator's error arm is `return Err(From::from(e))` — a `From<Inner> for YourError` impl is what lets `?` convert automatically instead of forcing `.map_err(...)` at every call site. thiserror's `#[from]` attribute generates exactly this `From` impl, and — per R6 — always also makes that field the `source()`.
**Applies to us:** internal helpers inside `packages/shaper` that call into `packages/font-baker` should get a `From<font_baker::Error> for shaper::Error` (or a purpose-built variant), so shaper's internals can use `?` instead of manual `map_err` scattered through the call graph — but this `From` should not exist on the *public* `shaper::Error` if it would leak `font_baker::Error` to shaper's own callers (use R12 instead).
**Bad / Good:**
```rust
// Bad: manual conversion at every call site
let face = parse_face(bytes).map_err(BakeError::from_parse)?;

// Good: From lets ? do it
impl From<ttf_parser::FaceParsingError> for BakeError { ... }
let face = parse_face(bytes)?;
```
**Source:** `?`-operator conversion via `From` is documented behavior of `Result`'s `?`, stable since Rust 1.13 (2016); [`std::result` docs, "The Question Mark Operator"](https://doc.rust-lang.org/std/result/index.html#the-question-mark-operator-). Retrieved 2026-09-03.

### R12. Box a foreign error you must accept but don't want named in your public enum, rather than adding a variant per dependency.
**Why:** `Box<dyn core::error::Error + Send + Sync + 'static>` behind a single variant lets you accept arbitrary upstream failures (e.g. from a pluggable backend) without each one becoming a piece of your crate's stable public API — callers can still call `.source()` to inspect it, they just can't `match` on its concrete type without downcasting. Requires `alloc`.
**Applies to us:** a font-loading path that can be backed by different I/O sources (embedded bytes vs. a host-provided async fetch) shouldn't grow one `BakeError` variant per possible I/O backend.
**Source:** [d34dl0ck.me, "Designing Error Types in Rust Libraries"](https://d34dl0ck.me/rust-bites-designing-error-types-in-rust-libraries/index.html) — warns that `#[from]`-ing a dependency's error type directly "leaks the inner error types... to your library consumers," and recommends the boxed-trait-object variant instead. Retrieved 2026-09-03.

### R13. `Error` requires `Debug + Display`; keep `Display` a lowercase, unpunctuated phrase, and format directly without pre-building a `String`.
**Why:** `Debug + Display` are `core::error::Error`'s required supertraits — you cannot implement `Error` without both. Rust API Guidelines: error messages should be *"lowercase without trailing punctuation"* and typically concise (e.g. `"invalid digit found in string"`, not `"Invalid digit found in string."`). `Display::fmt` writes directly to the `&mut Formatter`, so it never needs `alloc` on its own — building an intermediate `String` just to `write!` it again is wasted work in a size-sensitive, no_std+alloc crate.
**Bad / Good:**
```rust
// Bad: allocates a String just to hand it to the formatter
fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
    let s = alloc::format!("Overflow at {}.", self.offset);
    write!(f, "{s}")
}
// Good: writes directly, no intermediate allocation, correct casing/punctuation
fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
    write!(f, "overflow at {}", self.offset)
}
```
**Source:** [Rust API Guidelines, C-GOOD-ERR](https://rust-lang.github.io/api-guidelines/interoperability.html); [`core::error::Error` docs](https://doc.rust-lang.org/core/error/trait.Error.html) (trait signature `pub trait Error: Debug + Display`). Retrieved 2026-09-03.

### R14. At a crate boundary inside the workspace, convert the sibling crate's error into your own rather than re-exporting it unchanged three hops up the stack.
**Why:** the same anti-pattern as R6, applied at workspace scale: if `layout::Error` has a variant that's just `Shaper(shaper::Error)` reused verbatim, and `wasm-bindings::Error` has a variant that's just `Layout(layout::Error)` reused verbatim, a consumer three crates away from the actual failure has to understand three crates' internals to handle it. Each hop should collapse the error into what *that* crate's own callers can act on.
**Applies to us:** with 12 first-party crates, this compounds fast — check any error enum whose variant payload is another first-party crate's `Error` type used unchanged.
**Source:** general application of [nrc, error-type-design.html](https://nrc.github.io/error-docs/error-design/error-type-design.html)'s wrapping-is-overused guidance to a multi-crate workspace. Retrieved 2026-09-03.

## Typestate: lifecycle in the type system

### R15. Reach for typestate only when invalid sequencing is knowable at compile time; if validity depends on a runtime fact, typestate is the wrong tool.
**Why:** typestate encodes state as a type parameter (usually via `PhantomData<State>`), so the *compiler* rejects an out-of-order call at the call site that made the mistake. That mechanism only works when the state a value is in was determined by which functions you've already called on it — a fact the type system can track. It cannot express "this handle is valid only if the buffer's generation counter still matches," because that's a fact about runtime data, not about which methods were called.
**Applies to us:** a `FontFace` loading pipeline (raw bytes -> parsed -> validated -> baked) is a good typestate candidate — the sequence is fixed and compile-time-known. A buffer handle carrying a **generation counter** (explicitly called out in this project's domain) is *not* — whether the generation is still current can only be known by comparing against the live generation at the time of use, so it belongs behind a fallible runtime accessor (`fn get(&self, gen: Generation) -> Result<&T, Stale>`), not a typestate parameter.
**Source:** [Zero To Mastery, "How To Use The Typestate Pattern In Rust"](https://zerotomastery.io/blog/rust-typestate-patterns/) — pattern structure and worked example; general typestate literature, e.g. [Stanford CS 242, Typestate](https://stanford-cs242.github.io/f19/lectures/08-2-typestate.html). Retrieved 2026-09-03.

### R16. Every state-transition method takes `self` by value and returns the new state's type — never `&mut self`.
**Why:** if a transition method took `&mut self`, the old state's handle would still be reachable afterward, and nothing would stop a second call to a method that's only valid in the state you just left. Consuming `self` makes the old, stale-typed value genuinely inaccessible — the compiler enforces it, not a runtime flag.
**Bad / Good:**
```rust
// Bad: old (Loading) value is still callable after this
impl FontFace<Loading> {
    pub fn parse(&mut self) -> FontFace<Parsed> { ... } // wrong receiver
}

// Good: Loading value is consumed, cannot be reused
impl FontFace<Loading> {
    pub fn parse(self) -> FontFace<Parsed> { ... }
}
```
**Source:** [Zero To Mastery, typestate pattern](https://zerotomastery.io/blog/rust-typestate-patterns/): *"the state transition functions should always take ownership of the state."* Retrieved 2026-09-03.

### R17. `PhantomData<State>` is free in layout, but don't assume the compiler dedupes per-state method bodies for you.
**Why:** `PhantomData<T>` is zero-sized, so a typestate wrapper has the same runtime layout with or without the marker. That guarantee is about *data*, not *code*: `impl Foo<StateA> { fn f(&self) {...} }` and `impl Foo<StateB> { fn f(&self) {...} }` are separate source items, and unless their bodies are identical enough for the optimizer's identical-code-folding to merge them, you get duplicated codegen per state. Factor logic shared across states into a private, non-generic helper called from every state's impl block.
**Applies to us:** in a wasm build with `panic = "abort"`, verify with `cargo bloat`/`twiggy` if a typestate type's states share most of their method bodies — near-identical `fn` bodies across `impl Foo<StateA>` / `impl Foo<StateB>` blocks is the grep-able smell.
**Source:** mechanism is standard Rust monomorphization behavior; general treatment in [Zero To Mastery, typestate pattern](https://zerotomastery.io/blog/rust-typestate-patterns/) and [oneuptime.com, "How to Use PhantomData in Rust"](https://oneuptime.com/blog/post/2026-01-25-rust-phantomdata/view), 2026-01-25.

### R18. Cap typestate at a handful of states per type; past that, prefer a runtime state enum matched exhaustively.
**Why:** each additional typestate parameter multiplies the number of concretely-instantiated types that can flow through generic code, and — because the state is part of the type — it leaks into every function signature that touches the value, including any that must cross the wasm ABI (where only one concrete, flattened shape can exist per exported function; see R37). A runtime `enum State { ... }` matched exhaustively (R32-33) gives most of the same "did you forget a case" safety with one shared type and one shared function signature.
**Applies to us:** if a pipeline stage count grows past ~4-5 (e.g. raw -> parsed -> shaped -> laid-out -> baked, each with sub-states), stop adding typestate parameters and switch the internal representation to a state enum before the wasm-facing API has to be parameterized over it too.
**Source:** synthesis from typestate verbosity critiques in [dl.acm.org, "Retrofitting Typestates into Rust"](https://dl.acm.org/doi/fullHtml/10.1145/3475061.3475082) — cites *"verbosity and lack of guarantees regarding the typestate's state machine"* as the pattern's known costs. Retrieved 2026-09-03.

## Newtype discipline and unit arithmetic

### R19. Wrap any primitive that could plausibly be confused with another unit, identity, generation, or coordinate space in a `#[repr(transparent)]` newtype over exactly one non-ZST field.
**Why:** `#[repr(transparent)]` guarantees the wrapper "has the same layout and ABI as the only non-size-0, non-alignment-1 field" — the Rust reference is explicit that the representation is limited to a struct/single-variant-enum with at most one non-ZST field plus any number of ZST fields (e.g. `PhantomData`). That guarantee is exactly what makes the newtype free to pass across the wasm ABI as its inner primitive (see R39).
**Applies to us:** `GlyphId`, `ClusterIndex`, `ByteOffset`, `Utf16Offset`, `Pixels`, `FontUnits`, `LayoutUnits`, `Generation`, `BufferHandle`, `PlanRevision` — every one of these should be a `#[repr(transparent)]` single-field newtype, not a bare `u32`/`f32` passed around internally.
**Bad / Good:**
```rust
// Bad: byte offset and char offset are both bare usize — interchangeable by the compiler, not by meaning
fn slice_at(offset: usize) -> &str { ... }

// Good
#[repr(transparent)]
pub struct ByteOffset(pub(crate) u32);
fn slice_at(offset: ByteOffset) -> &str { ... }
```
**Source:** [Rust Reference — Type Layout, "the transparent representation"](https://doc.rust-lang.org/reference/type-layout.html#the-transparent-representation); [RFC 1758 — repr(transparent)](https://rust-lang.github.io/rfcs/1758-repr-transparent.html). Retrieved 2026-09-03.

### R20. Derive only the trait set the newtype's *role* needs; don't derive arithmetic or ordering onto identities just because `derive` is convenient.
**Why:** deriving `PartialOrd`/`Ord`/arithmetic traits gives the type operations that type-check but are semantically meaningless — comparing two `GlyphId`s or adding two `Generation`s compiles cleanly and is still a bug. Restricting the derive set to what the role needs (`Clone, Copy, PartialEq, Eq, Hash, Debug` for an opaque identity; add `PartialOrd`/`Ord`/arithmetic only for genuine measurements) makes the *type signature itself* the enforcement — a reviewer can see `#[derive(PartialOrd)]` on `GlyphId` and know it's wrong without reading a single call site.
**Applies to us:** `GlyphId`, `ClusterIndex`, `BufferHandle`, `Generation`, `PlanRevision` are identities/counters, not measurements — no `Add`, no `Ord` unless a specific, documented reason exists (e.g. cluster indices are monotonic within a run and genuinely need `Ord` for a binary search).
**Source:** general newtype-derive discipline; [Rust API Guidelines checklist, C-COMMON-TRAITS](https://rust-lang.github.io/api-guidelines/interoperability.html), retrieved 2026-09-03.

### R21. Never implement `Deref`/`DerefMut` from a domain newtype to its inner primitive.
**Why:** `Deref` is specified for smart-pointer-to-pointee relationships (`&SmartPtr<T> -> &T`), and the Rust API Guidelines make it a strong default: *"only smart pointers should implement `Deref`."* Implementing it on a domain newtype auto-coerces every method and operator of the inner primitive onto the wrapper, silently defeating the reason the newtype exists — a `Pixels` that `Deref`s to `f32` gets `f32::sin()`, `f32`'s `Add`, and every other `f32` method for free, none of which should be callable on a `Pixels` without going through the unit-aware API.
**Applies to us:** none of `GlyphId`, `Pixels`, `FontUnits`, `LayoutUnits`, `BufferHandle`, etc. should implement `Deref`. Provide `.get()`/`.raw()`/`AsRef` accessors instead.
**Bad / Good:**
```rust
// Bad: every f32 method/operator now works on Pixels by accident
impl Deref for Pixels {
    type Target = f32;
    fn deref(&self) -> &f32 { &self.0 }
}

// Good: explicit, named access only
impl Pixels {
    pub const fn get(self) -> f32 { self.0 }
}
```
**Source:** [rust-unofficial.github.io/patterns, "Deref polymorphism" anti-pattern](https://rust-unofficial.github.io/patterns/anti_patterns/deref.html) — *"The `Deref` trait is designed for the implementation of custom pointer types... not to convert between different types"*; [Rust API Guidelines, C-DEREF](https://rust-lang.github.io/api-guidelines/interoperability.html). Retrieved 2026-09-03.

### R22. Implement `Add`/`Sub` only between two values of the *same* unit newtype; there is no `impl Add<FontUnits> for Pixels`.
**Why:** the whole point of separate unit newtypes is that `Pixels + FontUnits` is a category error the compiler should catch, the same way it catches `bool + &str`. The only legal bridge between unit spaces is an explicit, named conversion function (e.g. `FontUnits::to_pixels(self, units_per_em: u16) -> Pixels`) that makes the conversion factor visible at the call site.
**Bad / Good:**
```rust
// Bad: silently mixes unit spaces
impl core::ops::Add<FontUnits> for Pixels {
    type Output = Pixels;
    fn add(self, rhs: FontUnits) -> Pixels { Pixels(self.0 + rhs.0) } // wrong: needs a scale factor
}

// Good: same-unit arithmetic only; cross-unit needs an explicit, named conversion
impl core::ops::Add for Pixels {
    type Output = Pixels;
    fn add(self, rhs: Pixels) -> Pixels { Pixels(self.0 + rhs.0) }
}
impl FontUnits {
    pub fn to_pixels(self, units_per_em: u16, px_per_em: f32) -> Pixels {
        Pixels(self.0 as f32 / units_per_em as f32 * px_per_em)
    }
}
```
**Applies to us:** directly matches the house style rule already in force ("Add `#[repr(transparent)]` newtypes when primitive values from distinct units... could plausibly be mixed"); this rule is the arithmetic half of that — the newtype alone doesn't stop unit-mixing unless the operator impls are equally disciplined.
**Source:** mechanism follows directly from Rust's trait-based operator overloading (`core::ops::Add<Rhs>` is generic in `Rhs`, so *not* implementing the cross-unit instantiation is what makes it a compile error); pattern demonstrated by [euclid's typed geometry](https://doc.servo.org/euclid/index.html) (see R24). Retrieved 2026-09-03.

### R23. Don't adopt `uom`'s full dimensional-analysis machinery for a crate that only needs a handful of incompatible-but-not-interconvertible scalar spaces.
**Why:** `uom` does *automatic type-safe zero-cost dimensional analysis* — it tracks physical dimensions (length, time, mass, ...) with typenum-based exponents so that e.g. `Length / Time` produces a `Velocity` automatically, and converts between arbitrary units (meters, feet, ...) of the same quantity. That machinery earns its keep when quantities genuinely multiply/divide into new dimensions and need many interconvertible units. Font units, layout units, and pixels don't multiply into new quantities and don't need multi-unit conversion tables (each has exactly one representation) — they only need to never be added to each other by accident. Pulling in `uom` for that buys const-generic/typenum machinery and codegen surface a wasm-size-sensitive crate doesn't need.
**Applies to us:** do not add `uom` as a dependency for `Pixels`/`FontUnits`/`LayoutUnits`. A handful of concrete `#[repr(transparent)]` newtypes (R19) with hand-written `Add`/`Sub` (R22) and explicit conversion functions cover this project's actual requirement at a fraction of the size and compile-time cost.
**Source:** [uom crate docs](https://docs.rs/uom/latest/uom/) — *"Rather than working with measurement units... uom works with quantities... operations on quantities have zero runtime cost over using the raw storage type"*; [GitHub — iliekturtles/uom](https://github.com/iliekturtles/uom). Retrieved 2026-09-03.

### R24. If more than roughly 3-4 incompatible scalar spaces accumulate, switch from N hand-written newtypes to one `euclid`-style generic `Length<T, Unit>`.
**Why:** `euclid`'s approach is lighter than `uom`'s: it tags a generic scalar with a zero-sized `Unit` marker (`PhantomData`) purely to prevent mixing spaces — *"tagged with a generic Unit parameter which is useful to prevent mixing values from different spaces... it should not be legal to translate a screen-space position by a world-space vector."* This buys **one** generic `impl<T: Add<Output=T>, U> Add for Length<T, U>` instead of N duplicate hand-written impls, with no runtime cost (`PhantomData<U>` never appears in the compiled layout) and no dependency beyond what you write yourself — you don't need the `euclid` crate itself, just its pattern.
**Applies to us:** this project already has a dedicated `shaper/src/engine/layout_units.rs` plus `Pixels`/`FontUnits` — three spaces today. At three, hand-written concrete newtypes (R19/R22) are still simplest; if a fourth or fifth coordinate space appears (e.g. a glyph-local space), switch to the generic-`Length<T, Unit>` pattern rather than writing a fourth/fifth copy of the same `Add`/`Sub` impls.
**Bad / Good:**
```rust
// At N=3, fine: concrete newtypes (R19/R22)

// At N>=4-5, prefer one generic type over N duplicated impls:
pub struct Length<T, Unit> {
    value: T,
    _unit: core::marker::PhantomData<Unit>,
}
impl<T: core::ops::Add<Output = T>, Unit> core::ops::Add for Length<T, Unit> {
    type Output = Length<T, Unit>;
    fn add(self, rhs: Self) -> Self::Output {
        Length { value: self.value + rhs.value, _unit: core::marker::PhantomData }
    }
}
pub enum PixelSpace {}
pub enum FontUnitSpace {}
pub type Pixels = Length<f32, PixelSpace>;
pub type FontUnits = Length<f32, FontUnitSpace>;
```
**Source:** [euclid crate docs](https://doc.servo.org/euclid/index.html) / [lib.rs entry](https://lib.rs/crates/euclid) — *"a collection of strongly typed math tools for computer graphics... tagged with a generic Unit parameter."* Retrieved 2026-09-03.

### R25. A validated/refined newtype has exactly one public constructor, a private field, and no other way in.
**Why:** "parse, don't validate" only holds if the parsed type genuinely cannot be constructed except through the code path that checked the invariant. A `pub` field, a derived/handwritten `From<Inner>`, or a second `pub fn` that builds the value some other way is a silent second entry point that bypasses the check — the type stops proving anything.
**Bad / Good:**
```rust
// Bad: two ways in, only one checks
pub struct GlyphIndex(pub u16); // public field bypasses any check entirely

// Good: one validating entry point
pub struct GlyphIndex(u16);
impl GlyphIndex {
    pub fn new(raw: u16, glyph_count: u16) -> Option<Self> {
        (raw < glyph_count).then_some(Self(raw))
    }
    pub const fn get(self) -> u16 { self.0 }
}
```
**Source:** [Alexis King, "Parse, don't validate"](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/), 2019-11-05 — the foundational statement of the principle; Rust-specific treatment in [entropicdrift.com, "Refined Types in Rust: Parse, Don't Validate"](https://entropicdrift.com/blog/refined-types-parse-dont-validate/) — *"the constructor is the only way to create an `Email`... validates on construction."* Retrieved 2026-09-03.

### R26. Give a validated newtype a read accessor, never a public field.
**Why:** a public field is a second, unchecked construction path the moment anyone writes struct-update syntax, a test fixture, or `unsafe { transmute }`-free but still-bypassing code that constructs the struct literal directly (only possible if the field is `pub`, which is precisely why R25 forbids it) — so this rule is the field-level enforcement of R25's constructor-level rule. `.get()` (Copy types) or `.into_inner()` (owned types) exposes the value without exposing a construction path.
**Source:** direct consequence of [entropicdrift.com, refined types](https://entropicdrift.com/blog/refined-types-parse-dont-validate/) and [nutype crate docs](https://docs.rs/nutype) — nutype's `constructor(visibility = private)` exists specifically to let a type be validated internally by a factory function while blocking direct external construction, demonstrating the field/constructor visibility split is a recognized, checkable pattern. Retrieved 2026-09-03.

### R27. Back any id/handle/generation-counter newtype that is never legitimately zero with `NonZeroU32`/`NonZeroU16` (etc.), not a bare integer.
**Why:** `NonZero<T>` and `Option<NonZero<T>>` are guaranteed the same size and alignment as `T` — verified from the standard library docs: `assert_eq!(size_of::<Option<NonZero<u32>>>(), size_of::<u32>())`. This is the null-pointer-optimization applied to integers: the compiler reuses the all-zero bit pattern (now provably invalid for the value itself) as `Option`'s `None` discriminant, so `Option<YourId>` costs nothing over a bare `u32`, and "zero is not a valid id" is checked once at construction instead of by convention at every comparison site.
**Applies to us:** `BufferHandle`, `Generation`, `PlanRevision`, and any glyph/cluster id that reserves 0 as "invalid" are candidates — replace the newtype's backing field with `NonZeroU32` and get `Option<Handle>` for free instead of inventing a sentinel (see R29).
**Bad / Good:**
```rust
// Bad: 0 is an in-band sentinel that arithmetic can produce by accident
#[repr(transparent)]
pub struct Generation(u32); // 0 means "no generation" by convention only

// Good: zero is a type-level impossibility; Option<Generation> is free
#[repr(transparent)]
pub struct Generation(core::num::NonZeroU32);
```
**Source:** [`core::num::NonZero` docs](https://doc.rust-lang.org/std/num/struct.NonZero.html) — exact `size_of`/`align_of` assertions quoted above, and *"the same layout and bit validity as `T`... the all-zero bit pattern is invalid."* Retrieved 2026-09-03.

## Making invalid states unrepresentable

### R28. Replace two or more bools that are only meaningful in combination with a single enum naming the actual states.
**Why:** `N` independent bools encode `2^N` states, but almost never are all `2^N` combinations meaningful — the extra states are invalid states the type system is actively allowing. An enum with exactly the meaningful variants makes the impossible combinations unrepresentable instead of merely undocumented.
**Bad / Good:**
```rust
// Bad: 4 states possible, probably 2-3 are meaningful
struct BakeJob { is_running: bool, is_failed: bool }

// Good
enum BakeJob { Idle, Running, Failed(BakeError) }
```
**Applies to us:** review any struct with two or more `is_*`/`has_*` bool fields — plan/cache/loading state in the shaping or baking pipeline is the likely location.
**Source:** general "make illegal states unrepresentable" principle; treatment in [conzit.com, "Embracing Type-Driven Design in Rust"](https://conzit.com/post/embracing-type-driven-design-in-rust-a-paradigm-shift), retrieved 2026-09-03.

### R29. Never encode "no value" as a sentinel primitive (`u32::MAX`, `-1`, an overloaded `0`); use `Option<T>` (free when `T` is `NonZero`, per R27).
**Why:** a sentinel value is a silent collision waiting to happen — the moment a real computed value equals the sentinel (an actual index of `u32::MAX`, an actual generation of `0`), the "no value" check silently misfires. `Option<T>` makes "absent" a distinct, exhaustively-matched case instead of a magic number a reader has to already know about.
**Bad / Good:**
```rust
// Bad: silently wrong the day a real cluster index reaches u32::MAX
fn find_cluster(&self) -> u32 { u32::MAX /* "not found" */ }

// Good
fn find_cluster(&self) -> Option<ClusterIndex> { None }
```
**Source:** direct consequence of the `NonZero`/niche-optimization guarantee in R27; general treatment in [0xatticus.com, "Niche optimizations in Rust"](https://www.0xatticus.com/posts/understanding_rust_niche/). Retrieved 2026-09-03.

### R30. Parse, don't validate: a function that checks an invariant should return the narrower type that proves it, not the original type plus a bool/Result the caller must remember to consult.
**Why:** *"Validation returns a boolean, while parsing returns a value... the knowledge that it's valid exists only in your head (and maybe in a comment)"* when you validate-and-continue with the same type; when you parse, the fact of having checked is encoded in the return type itself, so every downstream function that requires the invariant can demand the narrower type in its signature and the compiler enforces that nobody skipped the check.
**Bad / Good:**
```rust
// Bad: validates, but the caller still holds a plain &str afterward
fn is_valid_utf16_boundary(s: &str, at: usize) -> bool { ... }
fn slice(s: &str, at: usize) {
    assert!(is_valid_utf16_boundary(s, at)); // easy to forget, or to call and ignore
    &s[..at];
}

// Good: the check produces the type the rest of the code actually needs
struct BoundaryOffset(usize);
fn checked_boundary(s: &str, at: usize) -> Option<BoundaryOffset> { ... }
fn slice(s: &str, at: BoundaryOffset) -> &str { &s[..at.0] } // caller can't skip the check
```
**Source:** [Alexis King, "Parse, don't validate"](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/), 2019-11-05; Rust-specific framing in [rustfinity.com, "Parse, Don't validate: An Effective Error Handling Strategy"](https://www.rustfinity.com/blog/parse-dont-validate). Retrieved 2026-09-03.

### R31. Don't re-derive a fact from raw data that a narrower type already proved earlier in the same call chain.
**Why:** if a function received a type that already encodes "this offset is a valid char boundary" or "this string is validated UTF-8," re-scanning/re-validating it inside the function throws away the reason the narrower type exists and doubles the cost for no safety gain. Threading the checked type through the call chain *is* the enforcement mechanism — re-checking is a sign the type wasn't actually being relied upon.
**Applies to us:** with byte offsets, char offsets, and UTF-16 code-unit offsets all present in this domain, a function taking a `ByteOffset` that was already validated against a `&str`'s boundaries should not call `s.is_char_boundary(offset)` again internally — that check belongs once, at the point the `ByteOffset` was constructed.
**Source:** corollary of "parse, don't validate," [Alexis King](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/), 2019-11-05; also her follow-up caveat that newtypes alone (without a real parse step) give weaker guarantees than this rule assumes — cited via [Hacker News discussion, "Parse, Don't Validate and Type-Driven Design in Rust"](https://news.ycombinator.com/item?id=47103931). Retrieved 2026-09-03.

## Exhaustive matching discipline and closed sets

### R32. Enable `#[deny(clippy::wildcard_enum_match_arm)]` for this crate's own closed enums; reserve `_ =>` for `#[non_exhaustive]` foreign enums or a commented, deliberate don't-care case.
**Why:** `wildcard_enum_match_arm` is a restriction-group lint (off by default, must be explicitly enabled) that flags a `match` on an enum which uses a wildcard arm instead of naming every variant — *"wildcard match will also match any future added variants."* Enabled on your own in-crate enums, adding a variant becomes a compile error at every match site that would otherwise have silently fallen into the `_` arm and done the wrong (or merely default) thing. It should **not** be blanket-enabled crate-wide if the crate also matches on `#[non_exhaustive]` foreign enums, since those structurally require a wildcard — scope the `#[deny]` (or use `#[allow]` at those specific match sites) accordingly.
**Bad / Good:**
```rust
// Bad: new RasterFormat variant silently falls into a default
match format {
    RasterFormat::Bitmap => encode_bitmap(),
    _ => encode_bitmap(), // Msdf and Slug both silently treated as Bitmap
}

// Good: adding Msdf/Slug/NewFormat forces a decision at every such site
match format {
    RasterFormat::Bitmap => encode_bitmap(),
    RasterFormat::Msdf => encode_msdf(),
    RasterFormat::Slug => encode_slug(),
}
```
**Applies to us:** the closed `Bitmap`/`MSDF`/`Slug` raster-format set is exactly the kind of enum this lint protects — a fourth format added later should force every encoder/decoder match site to be revisited, not silently default.
**Source:** [rust-clippy issue #6862](https://github.com/rust-lang/rust-clippy/issues/6862) and [#8540](https://github.com/rust-lang/rust-clippy/issues/8540) (lint mechanics and interaction with `#[non_exhaustive]`); lint category confirmed as restriction-group (opt-in) in clippy's lint listing. Retrieved 2026-09-03.

### R33. Consider `#[deny(clippy::exhaustive_enums)]`/`clippy::exhaustive_structs` on the public API surface to force a conscious `#[non_exhaustive]` decision on every new public type.
**Why:** these are restriction-group lints that flag any public enum/struct **not** marked `#[non_exhaustive]`, inverting the failure mode of R32: instead of catching a missing wildcard, they catch a missing *decision* about future extensibility, so "should this be closed or open to new variants/fields" gets answered once, deliberately, when the type is written — matching R7's requirement that the choice be per-type, not a reflex either direction.
**Applies to us:** run this as a review-time check (not necessarily a permanent `#[deny]`, since it will also flag types that are correctly exhaustive, like the closed `RasterFormat` enum in R32/R35) rather than blanket-enabling it, given it will legitimately fire on types that should stay closed.
**Source:** clippy restriction-lint category (`exhaustive_enums`, `exhaustive_structs`); cross-referenced against [RFC 2008](https://github.com/rust-lang/rfcs/blob/master/text/2008-non-exhaustive.md) stabilization in Rust 1.40.0. Retrieved 2026-09-03.

### R34. Close a trait's implementer set with the sealed-trait pattern when you want compile-time dispatch across a fixed, known set of types.
**Why:** a trait is sealed by giving it a private supertrait defined in a `mod private` that downstream crates cannot name: `pub trait TheTrait: private::Sealed {}` with `impl private::Sealed for OnlyOurType {}`. Downstream `impl TheTrait for TheirType` then fails to compile with *"the trait bound `TheirType: private::Sealed` is not satisfied"* — guaranteeing every implementer lives in your crate, so you can add methods to the trait later without it being a breaking change (the same forward-compatibility motive as `#[non_exhaustive]`, applied to traits instead of enums).
**Applies to us:** if the three raster backends (`Bitmap`/`Msdf`/`Slug`) are ever expressed as a trait (e.g. `trait RasterBackend { ... }`) rather than an enum, seal it — nothing outside this crate should be able to add a fourth backend by implementing the trait, since internal code (encoders, size calculations, wasm bindings) is written assuming exactly these three.
**Bad / Good:**
```rust
mod private { pub trait Sealed {} }
pub trait RasterBackend: private::Sealed {
    fn encode(&self, glyph: &Outline) -> Vec<u8>;
}
pub struct Bitmap; pub struct Msdf; pub struct Slug;
impl private::Sealed for Bitmap {}
impl private::Sealed for Msdf {}
impl private::Sealed for Slug {}
impl RasterBackend for Bitmap { fn encode(&self, g: &Outline) -> Vec<u8> { ... } }
// impl RasterBackend for TheirBackend {} // fails outside this crate: Sealed not satisfied
```
**Source:** [predr.ag, "A definitive guide to sealed traits in Rust"](https://predr.ag/blog/definitive-guide-to-sealed-traits-in-rust/) (verified code pattern and error text); [Rust API Guidelines, "Sealed traits protect against downstream implementations"](https://rust-lang.github.io/api-guidelines/future-proofing.html). Retrieved 2026-09-03.

### R35. Restrict a const-generic parameter to a specific, known set of values with a sealed trait bound, not a runtime assertion.
**Why:** stable const generics (`struct Foo<const N: usize>`, stabilized Rust 1.51.0, 2021-03-25) let a type be parameterized by a compile-time integer; pairing that with a sealed trait implemented only for the supported values turns "N must be 1, 2, or 4" from a runtime `assert!`/panic into a compile error for any other `N` — the unsupported instantiation simply doesn't type-check.
**Bad / Good:**
```rust
// Bad: wrong N panics at runtime, possibly deep in a call chain
struct Lanes<const N: usize>;
impl<const N: usize> Lanes<N> {
    fn new() -> Self { assert!(matches!(N, 1 | 2 | 4)); Self }
}

// Good: wrong N is a compile error at the instantiation site
mod private { pub trait Supported {} }
pub trait LaneCount: private::Supported {}
pub struct Lanes<const N: usize>;
impl private::Supported for Lanes<1> {}
impl private::Supported for Lanes<2> {}
impl private::Supported for Lanes<4> {}
impl LaneCount for Lanes<1> {}
impl LaneCount for Lanes<2> {}
impl LaneCount for Lanes<4> {}

pub struct Simd<const N: usize>(/* ... */) where Lanes<N>: LaneCount;
```
**Applies to us:** any fixed-width batch/lane count in the shaping or SIMD-adjacent code (buffer chunk widths, channel counts) that only makes sense at a small closed set of sizes is a candidate — check with the `rust-simd`/`rust-dod` agents for actual call sites before applying.
**Source:** const generics stabilization: [Rust 1.51.0 release, 2021-03-25](https://blog.rust-lang.org/2021/03/25/Rust-1.51.0.html); sealed-trait-plus-const-generic combination technique discussed in [internals.rust-lang.org, "Idea: trait bounds on constants?"](https://internals.rust-lang.org/t/idea-trait-bounds-on-constants/14998) and [iifx.dev, "Rust Generics: Choosing the Smallest Integer Type Based on Const Values"](https://iifx.dev/en/articles/457630525/rust-generics-choosing-the-smallest-integer-type-based-on-const-values). Retrieved 2026-09-03.

### R36. Default to an enum-plus-match over a sealed-trait-plus-generic for a closed set unless per-variant static dispatch is measured to matter.
**Why:** a sealed-trait-plus-generic implementer is monomorphized separately for every concrete type at every generic call site — three raster backends used through five generic pipeline functions is up to fifteen compiled copies of shared logic, versus one compiled copy of a function that takes `enum RasterFormat` and matches on it (paying one indirect branch instead). For a wasm-size-sensitive crate, the enum's extra branch is normally far cheaper than the generic's extra copies.
**Applies to us:** the `Bitmap`/`MSDF`/`Slug` raster set (R32/R34) should default to `enum RasterFormat { Bitmap, Msdf, Slug }` + exhaustive `match` for anything that isn't on a hot per-glyph path; reach for the sealed-trait-generic form only where profiling (`cargo bloat`/`twiggy`, per this repo's size-budget workflow) shows the indirection itself, not the duplication, is the bottleneck.
**Source:** standard Rust monomorphization cost model (static/generic dispatch trades code size for inlining opportunity vs. dynamic/enum dispatch trading a branch for one shared body); no single primary source states this as a rule, but it follows directly from how `rustc` compiles generics — consistent with the general dynamic-vs-static-dispatch size guidance found across [dasroot.net, "Rust Traits and Generics: Advanced Type System Patterns"](https://dasroot.net/posts/2026/03/rust-traits-generics-type-system-patterns/), 2026-03. Retrieved 2026-09-03.

## The wasm ABI boundary: convert once, in both directions

### R37. Convert between a raw primitive and its rich type exactly once, at the outermost `extern "C"`/`#[wasm_bindgen]` function — never partway through an internal call chain, and never let internal code fall back to the raw primitive either.
**Why:** this is the project's own house rule made checkable: *"Convert enums and newtypes to C/Serde primitives only at the boundary."* Concretely, that means two things, not one: the boundary function is the only place a raw `u32` becomes a `GlyphId`/`RasterFormat`/etc. (nothing crosses the boundary un-parsed), **and** it's the only place a rich type is flattened back to a primitive on the way out — internal helper functions, including private ones one call deeper, take and return the rich type. A private helper that accepts a bare `u32` "for convenience" is the boundary rule leaking inward exactly as much as a public function that returns one leaking outward.
**Bad / Good:**
```rust
// Bad: the primitive leaks one call deeper than the actual boundary
#[no_mangle]
pub extern "C" fn shape(format_tag: u32) -> u32 {
    encode(format_tag) // internal fn still takes/returns the raw tag
}
fn encode(format_tag: u32) -> u32 { ... }

// Good: only the outermost function touches the primitive
#[no_mangle]
pub extern "C" fn shape(format_tag: u32) -> u32 {
    let format = RasterFormat::try_from(format_tag).unwrap_or(RasterFormat::Bitmap);
    encode(format).into()
}
fn encode(format: RasterFormat) -> EncodedGlyph { ... } // rich type throughout
```
**Source:** project house style (`AGENTS.md`/engineering standard, given in project context); general pattern also documented for the [wasm-bindgen `convert` module](https://docs.rs/wasm-bindgen/latest/wasm_bindgen/convert/) which performs exactly this kind of boundary-only conversion via `IntoWasmAbi`/`FromWasmAbi`. Retrieved 2026-09-03.

### R38. Write the enum-to-discriminant conversion as an exhaustive `match`, not an `as` cast.
**Why:** `as` on a fieldless enum silently follows whatever discriminant values are currently assigned — if a variant is reordered, inserted in the middle, or given an explicit discriminant that later changes, every `as u8` call site re-numbers without a compile error. A `match` with no wildcard arm, by contrast, is a compile error the moment a variant is added and this site wasn't updated for it (this is R32's discipline applied specifically to the ABI boundary, where getting it wrong corrupts what the TypeScript side decodes, not just an internal `Result`).
**Bad / Good:**
```rust
// Bad: silently renumbers if RasterFormat's variant order ever changes
let tag = format as u8;

// Good: compile error the day a variant is added and this match isn't updated
let tag: u8 = match format {
    RasterFormat::Bitmap => 0,
    RasterFormat::Msdf => 1,
    RasterFormat::Slug => 2,
};
```
**Source:** consequence of Rust's enum discriminant assignment rules (unspecified/implicit unless `#[repr(...)]` and explicit `= N` are both pinned); cross-referenced against [num_enum crate docs](https://docs.rs/num_enum/latest/num_enum/derive.TryFromPrimitive.html) which exists specifically because *"`as` will silently truncate"* whereas a checked conversion does not. Retrieved 2026-09-03.

### R39. Keep a boundary-crossing newtype's raw-primitive conversion (`into_raw`/`from_raw` or `TryFrom<u32>`) local to the boundary module; don't give the newtype a public `From<u32>`/`Into<u32>` that internal code could use.
**Why:** if `BufferHandle` implements `From<u32>` publicly, any internal function can manufacture a `BufferHandle` from an arbitrary integer without going through whatever validation the real allocator performs — the newtype stops proving the handle came from a legitimate allocation (same failure mode as R25/R26, applied to ABI-facing handles specifically). Keeping the raw conversion `pub(crate)` and scoped to the boundary module means the only legitimate source of a `BufferHandle` inside the crate is the allocator that created it.
**Applies to us:** `BufferHandle`, `PlanRevision`, `Generation` — each should expose `pub(crate) fn into_raw(self) -> u32` / a boundary-module-only `from_raw`, not a public `From`/`Into<u32>` any internal caller can reach.
**Source:** direct application of R25/R26's "single validating entry point" discipline to the wasm boundary; general pattern in [wasm_bindgen::convert docs](https://docs.rs/wasm-bindgen/latest/wasm_bindgen/convert/index.html) — *"wrapping Rust enums and structs in newtypes to re-expose them to JS is the bread and butter of Wasm."* Retrieved 2026-09-03.

### R40. Never let a `Result<T, YourError>` cross the wasm ABI as-is; the boundary function converts it into a status code plus out-parameter (or throws, per this repo's engine-call-contract), and that conversion is an exhaustive match over `YourError`'s variants.
**Why:** a Rust `Result<T, E>` has no defined, stable C layout — its representation is an implementation detail even for `#[repr(Rust)]` niche-optimized cases, and the TypeScript side of a raw C-style ABI has no way to construct or pattern-match a Rust enum regardless. The boundary function must already be doing the R37 conversion in both directions; doing it via an exhaustive match (not a wildcard, per R32/R38) means adding a new `YourError` variant is a compile error at the one function that has to decide its wire representation, rather than a runtime surprise on the TypeScript side.
**Applies to us:** this is the concrete, checkable form of this repository's `engine-call-contract` rule that "a call answers or throws where it was written" — the match that turns `ShapeError`/`BakeError`/`LayoutError` into whatever the wasm boundary uses (status code, thrown JS exception, tagged result struct) belongs at that one entry point, matched exhaustively, not `as`-cast or defaulted.
**Source:** `Result<T, E>`'s layout is unspecified outside specific niche-optimized cases (general Rust layout guarantees; no stable C ABI for arbitrary `Result`); combined with project's own `engine-call-contract` skill description (given in project context) and R9's boxing guidance for any error payload too large to flatten cheaply. Retrieved 2026-09-03.
