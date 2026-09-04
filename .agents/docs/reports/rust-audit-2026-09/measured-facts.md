---
type: Audit Evidence
title: Measured facts — packages/glyph/rust
description: Structural measurements the Rust audit was built on, with the inference boundary marked explicitly.
documentation_type: reference
tags: [rust, audit, measurement]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Measured facts — `packages/glyph/rust`

Branch `feat/glyph-config-api` @ `12738c23`. Everything here was measured, not inferred.
Where a claim is inference it is labelled **[inferred]**.

## Scale

| crate | lines | files | edition | crate-type |
| --- | --- | --- | --- | --- |
| shaper | 47,124 | 52 | 2024 | cdylib, rlib |
| mtsdf-core | 3,679 | 6 | 2024 | (lib) |
| font-baker | 2,600 | 15 | 2024 | cdylib, rlib |
| mtsdf-baker | 2,546 | 13 | 2024 | cdylib, rlib |
| mtsdf-admission | 1,602 | 8 | 2024 | cdylib, rlib |
| bitmap-baker | 1,505 | 11 | 2024 | cdylib, rlib |
| slug-baker | 1,416 | 11 | 2024 | cdylib, rlib |
| slug-core | 1,389 | 2 | 2024 | (lib) |
| raster-artifact | 971 | 7 | 2024 | (lib) |
| slug-fontations | 254 | 1 | 2024 | (lib) |
| mtsdf-fontations | 131 | 1 | 2024 | (lib) |
| font-baker-fuzz | 26 | 2 | 2024 | (fuzz) |

Total ≈ 63,243 lines. `shaper` alone is 74.5% of it.

`shaper` module sizes (top): `engine/state.rs` 5,926 · `engine/positioning.rs` 3,121 ·
`abi_contract.rs` 2,729 · `engine/stable_plan.rs` 2,588 · `engine/codec.rs` 2,525 ·
`engine/codec_gather.rs` 2,332 · `engine/semantic_wire.rs` 2,266 · `engine/ordered_plan.rs` 2,242 ·
`engine/cluster_state.rs` 2,067 · `engine/flow_composition.rs` 1,849 ·
`generated/bidi_data.rs` 1,407 (generated).

## Toolchain and profile

- `rust-toolchain.toml`: channel **1.97.1**, profile minimal, components cargo/clippy/rustfmt,
  target `wasm32-unknown-unknown`. All crates edition **2024**, `rust-version = "1.97.1"`.
- Every crate is `#![no_std]` with an opt-in `std` feature. `no_std` confirmed in 12 lib roots.
- `talc = "=5.0.4"` as `#[global_allocator]` behind `cfg(target_arch = "wasm32")` in
  shaper, font-baker, slug-baker, bitmap-baker, mtsdf-baker.
- `[profile.release]`: `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true` in
  11 crates. **Only `font-baker` sets `opt-level = "z"`.** The others take the default (3).
- `#[panic_handler]` calls `core::arch::wasm32::unreachable()`.

## Structural findings

### No workspace root
There is **no workspace `Cargo.toml`** anywhere under `packages/glyph/rust`. Twelve standalone
crates. Consequences, all verified:
- `[workspace.lints]` inheritance is impossible, which is why lint policy is absent (below).
- `[profile.release]` is duplicated 11 times.
- The four pure-library crates (`mtsdf-core`, `slug-core`, `raster-artifact`, `slug-fontations`,
  `mtsdf-fontations`) carry `[profile.release]` blocks that **cargo ignores** — profiles apply only
  to the top-level package being built, and these are always built as dependencies.
- The five wasm artifacts *are* each built with their own `--manifest-path`
  (`packages/glyph/scripts/build.mjs`), so their profile blocks do take effect.

### No lint policy at all
No `[lints]` table in any `Cargo.toml`; no `clippy.toml` or `.clippy.toml` anywhere in the repo.
Lint configuration is entirely absent across all twelve crates.

`#[allow(...)]` used **41 times** (38 production in `shaper`); `#[expect(...)]` used **0 times**,
despite edition 2024 and Rust 1.97 supporting it.

## Panic discipline — strong

Split by whether the occurrence sits inside a `#[cfg(test)]` item or a test file.

| crate | unwrap prod/test | expect prod/test | panic! prod/test | unreachable! prod/test |
| --- | --- | --- | --- | --- |
| bitmap-baker | **0**/27 | 5/0 | 0/1 | 0/0 |
| font-baker | **0**/19 | 3/16 | 0/1 | 0/0 |
| mtsdf-admission | **0**/0 | 3/5 | 0/0 | 0/0 |
| mtsdf-baker | **0**/13 | 2/8 | 0/0 | 0/0 |
| mtsdf-core | **0**/2 | 0/27 | 0/0 | 0/0 |
| raster-artifact | **0**/6 | 5/10 | 0/0 | 0/0 |
| shaper | **0**/795 | 1/29 | 0/8 | 6/1 |
| slug-baker | **0**/4 | 0/0 | 0/0 | 0/0 |
| slug-core | **0**/17 | 0/0 | 0/0 | 0/0 |
| slug-fontations | **0**/6 | 0/2 | 0/0 | 0/0 |

**Zero production `unwrap()` in the entire tree.** All 795 in `shaper` are test code.
Production panic-shaped calls total 19 `expect` + 6 `unreachable!`, each of which is worth
individual review but none of which is systemic.

`try_reserve` / `try_reserve_exact` appears 145 times in production (shaper 73, slug-core 17,
mtsdf-core 15, slug-baker 12, mtsdf-baker 11, bitmap-baker 6, raster-artifact 5, font-baker 4).
Fallible allocation is a real, practised habit here, not an aspiration.

## Unsafe surface — the clearest gap

| | total | undocumented |
| --- | --- | --- |
| `unsafe { }` blocks | 64 | **6** (kernel_lab 4, codec 1, plan_packing 1) |
| `unsafe fn` declarations | 46 | **46** |

Unsafe *blocks* are 91% documented with an adjacent `// SAFETY:` comment — good discipline.

**Every one of the 46 `unsafe fn` declarations lacks a `# Safety` doc section.** Distribution:
`shaper/src/wasm.rs` 18 · `shaper/src/engine/kernel_lab.rs` 15 · `font-baker/src/wasm.rs` 4 ·
`mtsdf-baker/src/wasm.rs` 3 · `slug-baker/src/wasm.rs` 3 · `bitmap-baker/src/wasm.rs` 2 ·
`shaper/src/engine/codec.rs` 1.

These are the `pub unsafe extern "C"` wasm ABI entry points — exactly the functions whose
preconditions a TypeScript caller can violate (raw guest pointer + length pairs). The caller
contract is nowhere written down.

**The ABI surface is invisible to clippy, and a lint table would not fix it.** Verified by
experiment (`scratchpad/safety-probe`):

1. `cargo clippy --all-targets` passes clean on all eleven crates today.
2. It still passes with `-D clippy::missing_safety_doc` forced.
3. A probe crate proves clippy *does* lint `#[unsafe(no_mangle)] pub unsafe extern "C" fn` —
   at the crate root and in a `pub mod`.
4. The same function inside a **private** `mod` is silently skipped.

Every crate declares `mod wasm;` — private. `#[unsafe(no_mangle)]` exports these functions to
JavaScript, but Rust's visibility system considers them unreachable, so every lint keyed on public
reachability (`missing_safety_doc`, `missing_docs`, `unreachable_pub`) skips the entire ABI.
Enabling `pedantic` or `nursery` changes nothing here.

A second, independent blind spot compounds it: `shaper/src/lib.rs:14` and `font-baker/src/lib.rs:19`
gate `mod wasm;` behind `#[cfg(target_arch = "wasm32")]`, so a host-target clippy run — the default,
and almost certainly what CI runs — does not even compile the module containing 22 of the 46
unsafe functions.

The fix is structural (make the ABI module `pub`, or add an explicit review gate), not
configurational.

Edition-2024 `#[unsafe(no_mangle)]` syntax is used correctly throughout.

## Cast surface

653 `as` casts total, by target type:
`usize` 326 · `u32` 140 · `f32` 69 · `f64` 28 · `u16` 27 · `u8` 26 · `i32` 14 · `i16` 9 ·
`u64` 7 · `i64` 6 · `isize` 1.

Densest files: `engine/semantic_wire.rs` 66 · `engine/stable_plan.rs` 52 ·
`engine/ordered_plan.rs` 47 · `engine/codec_wire.rs` 38 · `mtsdf-admission/src/quality.rs` 29 ·
`engine/state.rs` 29 · `mtsdf-baker/src/wasm.rs` 21.

**The `usize` cases are target-dependent.** On `wasm32`, `usize` is 32 bits, so `usize as u32` is
lossless; the same code compiled for a 64-bit host — which is what `cargo test`, the `std`-feature
binaries, and the fuzz target all do — truncates silently. A cast that is correct on the shipping
target can be wrong under test, and vice versa. **[inferred: needs a concrete example to confirm
it bites in practice; the mechanism is certain, the exploitation is not yet demonstrated.]**

~17 casts look like float→int (`mtsdf-admission/src/quality.rs` 8 being the densest). Rust
float→int `as` saturates rather than wrapping, which is safe but silent.

## Feature surface

| crate | features |
| --- | --- |
| mtsdf-baker | default, std, artifact-baker, simd128-experiment, adjacent-texel-tile-experiment, adjacent-texel-simd-experiment, allocation-evidence, profiling |
| slug-baker | default, std, artifact-baker, allocation-evidence, autoresearch-fixed32-bands, autoresearch-adaptive-bands, autoresearch-adaptive32-bands |
| mtsdf-core | default, std, simd128-experiment, profiling, adjacent-texel-tile-experiment, adjacent-texel-simd-experiment |
| font-baker | default, std, subsetting, compression, fuzzing, oracle |
| shaper | default, std, kernel-lab, simd128, debug-validation |
| mtsdf-admission | oracle, full-font-evidence, fuzzing |
| others | default, std |

Nine features on `mtsdf-baker`, seven on `slug-baker`, several named `*-experiment` or
`autoresearch-*`. Whether every combination is built or tested is unverified.

Note the naming split: `shaper` has `simd128`, while `mtsdf-baker`/`mtsdf-core` have
`simd128-experiment`. Same concept, two names.

## Shipped artifact size (gzipped, `packages/glyph/dist`)

| artifact | gzipped |
| --- | --- |
| text-shaper.wasm | 423.8 KB |
| font-baker.wasm | 378.6 KB |
| bitmap-baker.wasm | 227.4 KB |
| mtsdf-baker.wasm | 208.8 KB |
| slug-baker.wasm | 181.1 KB |
| **total** | **1,419.7 KB** |

`wasm-opt` runs on each artifact with `--enable-bulk-memory
--enable-nontrapping-float-to-int [--enable-simd] --merge-similar-functions -Oz` applied twice.

## Existing house rules this audit must not contradict

`.agents/docs/engineering/code-style.md` § Rust already mandates: `no_std + alloc` for portable
crates; maintained upstream libraries over shadow parsers; error enums with exhaustive matches;
`#[repr(transparent)]` newtypes for mixable primitives; no `unwrap`/`expect`/`panic!`/unchecked
indexing/truncating casts as error control flow on reusable paths; checked size arithmetic and
`try_reserve` as separate obligations; small `unsafe` blocks with `SAFETY` explanations covering
ownership/range/lifetime/reentrancy/concurrency; allocations owned by the module that releases them.

The codex extends this; it does not replace it.


## Verified strengths (measured, not assumed)

These were checked because a research rule made them checkable. Each is a hazard the codebase
already avoids — the report should say so rather than only listing faults.

### Error types are tiny
Measured with a probe crate depending on the real crates (`scratchpad/size-probe`), release profile:

| type | size | `Result<(), E>` |
| --- | --- | --- |
| `engine::EngineError` | 12 | 12 |
| `engine::FrameFault` | 8 | 12 |
| `engine::codec::CodecError` | 1 | 1 |
| `engine::codec::CodecExecutionError` | 1 | 1 |
| `engine::codec_gather::GatherError` | 1 | 1 |
| `engine::font_binding::FontBindingError` | 1 | 1 |
| `engine::render_plan_compiler::RenderPlanCompilerError` | 1 | 1 |
| `unicode::UnicodeError` | 1 | 1 |
| `bidi::BidiError` | 1 | 1 |
| `slug_core::BuildError` | 1 | 1 |
| `mtsdf_core::GenerateError` | 1 | 1 |

`clippy::result_large_err` triggers at 128 bytes and `large_enum_variant` at 200. The largest
error here is 12. Nine of eleven are fieldless enums that niche-pack so `Result<(), E>` costs the
same single byte. Nothing to fix.

### Module facades are correct
`unreachable_pub` reports **0** across all ten library crates (verified on a cold build with a
separate `CARGO_TARGET_DIR` — a warm clippy cache silently reports nothing, which is its own trap
worth knowing). Private modules with an explicit `pub use` facade is the pattern throughout:
`slug-core/src/lib.rs:14` re-exports `PackError` and friends out of a private `mod packer`;
`shaper/src/engine/mod.rs:58` re-exports exactly three names — `EngineError`, `FrameFault`,
`TextEngine` — from a 5,926-line `state.rs`. That is a deliberate, tight facade.

**Correction to an earlier reading in this audit:** `pub` items inside private modules were briefly
taken as decorative `pub`. They are not; they are re-exported through the facade and are genuinely
reachable. The wasm ABI functions remain the real exception — they are exported by `no_mangle`
rather than by `pub use`, which is why the reachability-keyed lints skip them.

### The ABI passes only scalars
All **86** `extern "C"` functions across the tree take and return primitive scalars only
(`u32`/`i32`/`f32`/`usize`/`()`); not one passes or returns a struct by value.

This matters more than it looks. Rust's `wasm32-unknown-unknown` `extern "C"` ABI is *not* clang's
wasm C ABI — Rust splats small structs into scalar fields where clang uses an `sret` pointer — so
any `repr(C)` struct crossing this boundary would be a portability trap. The codebase sidesteps it
entirely by passing pointer/length pairs as `u32`. Whether that was deliberate or incidental, it is
correct, and it should be written down as a rule so nobody "improves" it later.

### The panic strategy is the correct stable one
`#[panic_handler]` calling `core::arch::wasm32::unreachable()` (stable since 1.37) is the right
choice on pinned stable 1.97.1: `-Cpanic=immediate-abort` and
`build-std-features=panic_immediate_abort` remain nightly-only. `catch_unwind` catches nothing
under `panic = "abort"`, so the boundary must be panic-free by construction rather than
panic-and-catch — which is consistent with the measured zero production `unwrap()`.

### The allocator choice is current
`wee_alloc` was archived in August 2025 with known leaks. `talc` is the modern replacement, and it
is what these crates already use.


## HIGH: the shipped shaper requires wasm SIMD, with no fallback and no detection

**Verified end to end, not inferred.**

1. `packages/glyph/scripts/build.mjs:60-77` reads `PMNDRS_GLYPH_SHAPER_SIMD`, **defaulting to on**
   (`shaperSimd = setting !== '0'`), and compiles with
   `-C target-feature=+simd128` into `target/wasm-simd128/`, passing `--enable-simd` to wasm-opt.
   A scalar build into `target/wasm-scalar/` exists but is opt-in.
2. `packages/glyph/dist/` contains exactly one `text-shaper.wasm`. No scalar variant ships.
3. `wasm-opt --print-features dist/text-shaper.wasm` fails validation with
   `SIMD operations require SIMD [--enable-simd], on (v128.load align=4 ...)` — the shipped
   artifact provably contains `v128` instructions.
4. No SIMD feature detection exists anywhere in the package's TypeScript.

A WebAssembly module is validated **as a whole** at instantiation. One `v128` opcode anywhere makes
an engine without simd128 reject the entire module — `CompileError: Invalid opcode 0xfd`. This is
not a slow path or a degraded mode: the library fails to load at all.

wasm simd128 shipped in Chrome 91 (2021-05), Firefox 89 (2021-06), **Safari 16.4 (2023-03)**. Every
engine older than those, and any embedder without the proposal, gets a hard failure.

The gating in the Rust source is *correct* — `#[cfg(all(target_arch = "wasm32", feature =
"simd128"))]` throughout `engine/kernel_lab.rs` and `engine/line_kernels.rs`, which is the right
construct (`#[target_feature(enable = ...)]` alone would emit SIMD opcodes into every build and
defeat the split). The machinery for two artifacts is already built. What is missing is shipping
the second one and choosing between them at load.

By contrast `bitmap-baker.wasm` requires only bulk-memory, which has far broader support.

## Dependency drift across the twelve independent manifests

There are **12 separate `Cargo.lock` files**; each crate resolves independently.

- **`read-fonts`: `shaper` is on 0.41.0, every baker on 0.42.1.** The shaper is held back by
  `harfrust 0.12.0`, which requires 0.41.0. So the product parses the same font with two different
  versions of the same parser depending on whether it is shaping or baking. Not a size problem —
  they are separate artifacts — but a behavioural-divergence risk on any table the two versions
  read differently.
- **`skrifa` is pinned inconsistently**: `=0.45.1` (exact) in mtsdf-admission, mtsdf-baker,
  mtsdf-fontations, slug-baker, slug-fontations; `0.45.1` (caret, floating) in bitmap-baker and
  font-baker. Two crates can float to 0.46 on a fresh resolve while five cannot.
- Only 4 of 17 external crates are exact-pinned (`libfuzzer-sys`, `skera`, `talc`,
  `unicode-segmentation`). There is no stated policy for which get `=`.

**Correction made during this audit:** `font-baker`'s lockfile lists both read-fonts 0.41.0 and
0.42.1, which looked like two parsers linked into one artifact. `cargo tree` shows 0.41.0 arrives
only through `harfrust`, behind the optional `oracle` feature, which the shipped build does not
enable. No duplicate ships. The lockfile records the union across all features; it is not evidence
of what links.


## The ABI layout contract is a strength, not a risk

Design intent (confirmed by the maintainer): the data layouts are deliberately exported into wasm
linear memory so TypeScript reads them directly with the correct layouts, and the ABI tables are
generated at build time. This is for raw speed.

The audit should record this as one of the strongest parts of the codebase. Evidence:

- **35 `#[repr(C)]` types**, 4 `#[repr(transparent)]`, 2 `#[repr(u8)]`. `repr(C)` is the correct
  and only defensible choice for a layout contract; `repr(Rust)` field order is compiler-chosen and
  explicitly unstable, so relying on it here would be a real bug. The codebase never does.
- **The table is derived, not transcribed.** `shaper/src/abi_contract.rs` computes every entry from
  the real types with `size_of::<T>()`, `align_of::<T>()`, and `offset_of!(T, field)`. TypeScript
  consumes that generated output. The table therefore *cannot* disagree with the structs — a field
  change propagates to the consumer by construction. This is a stronger guarantee than any test.
- **Cross-build skew is versioned too**, so the guarantee survives bytes that outlive the build that
  wrote them: `slug-baker/src/abi_layout.rs` defines `RESPONSE_MAGIC = "PMSL"` with a magic offset;
  `abi_contract.rs` emits `ABI_VERSION` and `generator: env!("CARGO_PKG_VERSION")`;
  `raster-artifact/src/ktx.rs` uses the standard KTX magic.
- **All 86 `extern "C"` functions take and return primitive scalars only.** No struct crosses a
  function signature by value, which sidesteps the fact that Rust's `wasm32-unknown-unknown` "C"
  ABI is *not* clang's (Rust splats small structs; clang uses an `sret` pointer). The layout
  contract lives in the shared buffers, where it is generated and versioned — which is the right
  place for it.

**Correction to an earlier line of this audit.** I counted 27 of 35 `repr(C)` types as "not pinned
by a compile-time size assert" and was treating that as a gap. It is not. Pinning is not the safety
mechanism — *generation from the types* is. The nine `const _: () = assert!(size_of::<T>() == N)`
in `semantic_view.rs`, `transport.rs`, and `render_plan.rs` are change-detectors that force a human
to notice a layout edit; they are useful, but their absence elsewhere is not a correctness hole.
Recommending 27 new assertions would be busywork dressed as rigour.

The one thing worth saying is narrow: those nine assertions encode magic numbers (`== 76`, `== 40`,
`== 36`, `== 64`). A reader cannot tell from the line whether 76 is a requirement or an observation.
A short comment naming *why* the size is fixed — a JS reader striding it, a cache-line target —
would make the intent checkable. That is a comment-level note, not a defect.

`ABI_VERSION` is still `0`, which is consistent with a pre-1.0 contract that has not needed a bump.
