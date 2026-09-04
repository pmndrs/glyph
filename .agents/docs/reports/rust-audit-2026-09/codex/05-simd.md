---
type: Reference
title: Rust codex — Hand-rolled SIMD for wasm
description: Checkable rules on hand-rolled simd for wasm, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Hand-rolled SIMD in Rust for wasm32 (current as of 2026-09-03)

### R1. Build simd128 kernels on stable Rust; do not nightly-gate them.
**Why:** Every function in `core::arch::wasm32`'s simd128 module carries `#[stable(feature = "wasm_simd", since = "1.54.0")]`. No `#![feature(...)]` is needed to call `v128`, `i32x4_add`, `i8x16_shuffle`, etc. on the stable channel.
**Applies to us:** The project's distance-field/codec kernels can and should build on stable 1.97.1 with zero nightly features for the SIMD parts.
**Source:** https://github.com/rust-lang/stdarch/blob/main/crates/core_arch/src/wasm32/simd128.rs (accessed 2026-09-03); https://doc.rust-lang.org/stable/core/arch/wasm32/index.html.

### R2. Do not plan the kernel architecture around `std::simd`/`portable_simd` stabilizing.
**Why:** `portable_simd` remains nightly-only (`#![feature(portable_simd)]`) with no announced stabilization date; a November 2025 community assessment concludes it "will remain such for the foreseeable future."
**Applies to us:** `core::arch::wasm32` intrinsics behind the `simd128` cargo feature are the only stable-toolchain option — treat that as the permanent design, not a stopgap.
**Source:** Sergey "Shnatsel" Davidoff, "The state of SIMD in Rust in 2025" (Medium, Nov 2025); https://doc.rust-lang.org/std/simd/index.html (tracking issue #86656, unstable).

### R3. If you want a portable wrapper instead of raw intrinsics, know it doesn't remove the wasm shipping problem.
**Why:** The `wide` crate supports wasm32 SIMD, but only as an opt-in built on the same `RUSTFLAGS="-C target-feature=+simd128"` mechanism as raw intrinsics — it has no runtime detection either. Its MSRV is 1.89, and its own docs describe it as "a near drop-in replacement for `std::simd`," not a different shipping model.
**Applies to us:** Adopting `wide` would change ergonomics, not the two-artifact build/detect requirement in R10–R12.
**Source:** https://github.com/Lokathor/wide (README, accessed 2026-09-03).

### R4. Know exactly which wasm32 v128 intrinsics are `unsafe fn` vs safe `fn`; do not blanket-wrap.
**Why:** In `stdarch`'s `simd128.rs`, memory-touching intrinsics (`v128_load*`, `v128_store*`, the `*_load_extend_*` family, `v128_load*_lane`/`_store*_lane`) are `unsafe fn` because they dereference a raw pointer. Arithmetic, comparison, shuffle/swizzle, and lane extract/replace/splat are safe `fn` — they only touch values already in hand.
**Applies to us:** Kernel code should only need `unsafe` at the pointer load/store boundary, not around the whole function body — wrapping everything hides which call actually needs justification.
**Bad / Good:**
```rust
// Bad: blanket unsafe hides which call actually needs justification
unsafe {
    let a = i32x4_splat(1);
    let b = i32x4_add(a, a);
    let v = v128_load(ptr); // the only call that actually needs unsafe
}
```
```rust
// Good: unsafe scoped to the one call that dereferences a pointer
let a = i32x4_splat(1);
let b = i32x4_add(a, a);
let v = unsafe { v128_load(ptr) };
```
**Source:** https://github.com/rust-lang/stdarch/blob/main/crates/core_arch/src/wasm32/simd128.rs (accessed 2026-09-03).

### R5. Write kernels as safe `fn` under `#[target_feature]` (Rust ≥1.86.0); stop forcing every kernel to be `unsafe fn`.
**Why:** `target_feature_11` stabilized in Rust 1.86.0 (2025-04-03) lets `#[target_feature]` attach to a safe `fn`. The unsafety moves to the call boundary (calling it without a matching `#[target_feature]` context), not the callee's signature.
**Applies to us:** Kernels no longer need the historical `unsafe fn kernel(...)` + `unsafe { kernel(...) }` double bookkeeping; `unsafe` now marks only "simd128 is asserted available here."
**Bad / Good:**
```rust
// Old pattern (still legal, no longer necessary)
#[target_feature(enable = "simd128")]
unsafe fn kernel(a: &[f32], out: &mut [f32]) { /* ... */ }
unsafe { kernel(a, out) };
```
```rust
// Rust 1.86.0+: safe signature, unsafe only at the call site
#[target_feature(enable = "simd128")]
fn kernel(a: &[f32], out: &mut [f32]) { /* ... */ }
unsafe { kernel(a, out) }; // still required unless the caller also has simd128
```
**Source:** Rust Blog, "Announcing Rust 1.86.0" (2025-04-03), https://blog.rust-lang.org/2025/04/03/Rust-1.86.0/; tracking issue https://github.com/rust-lang/rust/issues/136058; RFC https://rust-lang.github.io/rfcs/2396-target-feature-1.1.html.

### R6. Chain `#[target_feature]` kernels to each other; keep exactly one `unsafe` boundary at the entry point.
**Why:** A `#[target_feature(enable = "X")]` fn is callable without an `unsafe` block only from another fn carrying an equal-or-superset feature set. Called from anywhere else, it still requires `unsafe { }` because the compiler can't prove the feature at that call site.
**Applies to us:** Internal helpers (e.g., a lane-blend step called from a distance-field kernel) should themselves be `#[target_feature]` fns calling each other; the public, non-`target_feature` API should cross into that world exactly once.
**Source:** https://blog.rust-lang.org/2025/04/03/Rust-1.86.0/; https://rust-lang.github.io/rfcs/2396-target-feature-1.1.html.

### R7. Never combine `#[inline(always)]` with `#[target_feature]`.
**Why:** The Rust reference states `#[inline(always)]` may not be used with `#[target_feature]`, and a `#[target_feature]` fn is not inlined into a context that lacks the same features — even with `#[inline]`, which is merely a heuristic hint there.
**Applies to us:** Small lane-blend/shuffle helpers factored out of a kernel for readability won't automatically fold into the hot loop the way scalar `#[inline(always)]` helpers do; measure before assuming the factoring is free, or keep the helper's feature set identical to the caller's so it remains an inlining candidate.
**Bad / Good:**
```rust
// Compile error: inline(always) + target_feature is rejected
#[target_feature(enable = "simd128")]
#[inline(always)]
fn helper(v: v128) -> v128 { /* ... */ }
```
```rust
// Allowed: heuristic inlining only
#[target_feature(enable = "simd128")]
#[inline]
fn helper(v: v128) -> v128 { /* ... */ }
```
**Source:** https://doc.rust-lang.org/reference/attributes/codegen.html (accessed 2026-09-03).

### R8. Don't rewrite `#[target_feature(enable = "simd128")]` as `#[unsafe(target_feature(...))]` under edition 2024.
**Why:** Edition 2024's `unsafe_attributes` migration only wraps `no_mangle`, `export_name`, and `link_section` in `unsafe(...)`. `#[target_feature]` is governed by the separate, older RFC 2396/`target_feature_11` mechanism and is untouched by that migration.
**Applies to us:** The project is on edition 2024 — a review diff that "fixes" `#[target_feature]` into `#[unsafe(target_feature(...))]` is a bogus edit to reject, not a required cleanup.
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html (accessed 2026-09-03).

### R9. There is no `is_wasm_feature_detected!`; never architect runtime SIMD dispatch inside one wasm binary.
**Why:** WebAssembly has no instruction analogous to x86 `cpuid` that running code can query for engine capability. Support is a property of the host embedding the module, fixed before/at load time — not queryable from inside the module.
**Applies to us:** An `if simd128_supported() { kernel_simd(...) } else { kernel_scalar(...) }` written inside the Rust/wasm crate has nowhere to get its answer from.
**Source:** web.dev, "WebAssembly feature detection" — "WebAssembly doesn't have a built-in way to detect supported features in runtime... you need to compile the source code into Wasm separately," https://web.dev/articles/webassembly-feature-detection (accessed 2026-09-03).

### R10. Ship two separate `.wasm` artifacts; never one binary with an internal v128/fallback branch.
**Why:** A wasm module is validated as a whole before any code executes. An engine without simd128 support throws a `CompileError` ("Compiling function failed: Invalid opcode 0xfd") for the *entire module* the instant it encounters one SIMD opcode anywhere in the function bodies — including a branch that would never run. Dead SIMD code is exactly as fatal to load as live SIMD code.
**Applies to us:** The build must produce two module outputs (e.g., a `simd128` variant and a baseline variant), not one module that self-selects a path at runtime.
**Source:** Nutrient, "WebAssembly SIMD support" troubleshooting guide (concrete `CompileError`/`LinkError` text), https://www.nutrient.io/guides/web/troubleshooting/webassembly-simd-support/; corroborated by https://v8.dev/features/simd and https://github.com/GoogleChromeLabs/wasm-feature-detect, both of which prescribe building two module variants (all accessed 2026-09-03).

### R11. Gate the SIMD module with `#[cfg(target_feature = "simd128")]`, not `#[target_feature(enable = ...)]` alone.
**Why:** rustc's `wasm32-unknown-unknown` platform docs warn that simd128 "cannot be disabled via compiler flags alone" once a function carries `#[target_feature(enable = "simd128")]` — that attribute force-emits v128 instructions regardless of whether `-C target-feature=+simd128` was passed for the build. An ungated kernel module leaks SIMD opcodes into the intended "no-SIMD" fallback artifact too, defeating R10.
**Applies to us:** The crate needs a build-wide switch (`RUSTFLAGS=-C target-feature=+simd128` or an equivalent profile) plus `#[cfg(target_feature = "simd128")] mod simd; #[cfg(not(target_feature = "simd128"))] mod scalar;` so the fallback artifact contains zero v128 opcodes, not just "shouldn't call" them.
**Bad / Good:**
```rust
// Bad: these opcodes appear in EVERY build of the crate, including one
// compiled without -C target-feature=+simd128
#[target_feature(enable = "simd128")]
unsafe fn kernel(a: &[f32]) -> f32 { /* v128 ops */ }
```
```rust
// Good: the whole module is compiled out unless the build opted in
#[cfg(target_feature = "simd128")]
mod simd_kernel {
    #[target_feature(enable = "simd128")]
    unsafe fn kernel(a: &[f32]) -> f32 { /* v128 ops */ }
}
#[cfg(not(target_feature = "simd128"))]
mod scalar_kernel {
    fn kernel(a: &[f32]) -> f32 { /* scalar */ }
}
```
**Source:** https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03) — explicitly recommends `#[cfg(target_feature = "simd128")]` over `#[target_feature(enable = "simd128")]` for this reason.

### R12. Pick the artifact host-side with a real capability probe, not a user-agent allowlist.
**Why:** `wasm-feature-detect`'s `simd()` compiles a tiny SIMD-bearing probe module and attempts to validate/instantiate it against the live engine, so it tracks actual engine capability — including engines outside a hand-maintained version table, or a browser where the feature is flagged off.
**Applies to us:** Any embedder loading the glyph wasm binaries (docs site, host apps) should call `await simd()` from `wasm-feature-detect` before choosing which artifact to fetch.
**Source:** https://github.com/GoogleChromeLabs/wasm-feature-detect (accessed 2026-09-03); usage pattern corroborated by https://web.dev/articles/webassembly-feature-detection and https://v8.dev/features/simd.

### R13. Don't pull in x86-style function-multiversioning machinery for the wasm target.
**Why:** The `multiversion` crate explicitly elides itself on wasm32 — there is no runtime feature detection to multiversion against — so `#[multiversion]`-annotated code becomes a no-op wrapper there, costing compile time and reader confusion for zero effect.
**Applies to us:** If a kernel is shared with a native host tool (e.g., a build-time font baker) that does use `multiversion` for AVX2 dispatch, treat the wasm32 build of that same source as a different problem needing the two-artifact strategy (R10/R11), not an extension of the multiversion setup.
**Source:** CuriousCoding, "Distributing Rust SIMD Binaries," https://curiouscoding.nl/posts/distributing-rust-simd-binaries/ (accessed 2026-09-03).

### R14. Treat relaxed-simd as perf-only and non-reproducible; never on a compared/hashed/golden-tested path.
**Why:** The WebAssembly relaxed-simd spec states plainly that these ~19 instructions are host-dependent by design: "some operators are host-dependent, because the set of possible results may depend on properties of the host environment." Identical inputs may legally produce different outputs on different hardware or engines — this is compliant behavior, not a bug.
**Applies to us:** Glyph rasterization output (Bitmap/MSDF/Slug) is cached, diffed, and golden-tested. `relaxed_madd`/`relaxed_min`/`relaxed_max`/`relaxed_swizzle`/`relaxed_dot` must not appear on any kernel feeding those paths, however much they'd save.
**Source:** https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md (accessed 2026-09-03).

### R15. relaxed-simd is stable Rust and standardized Wasm 3.0 — its risk is determinism, not toolchain maturity.
**Why:** `core::arch::wasm32`'s relaxed-simd functions are `#[stable(feature = "stdarch_wasm_relaxed_simd", since = "1.82.0")]`, requiring only the `relaxed-simd` target feature, not a nightly compiler. Relaxed SIMD shipped as part of Wasm 3.0 in Chrome 119+, Firefox 120+, and Safari 18.2+.
**Applies to us:** Don't reject relaxed-simd on "it's experimental" grounds — it isn't, at the language/engine level. Reject specific *uses* on determinism grounds (R14) instead; evaluate the two axes independently.
**Source:** https://doc.rust-lang.org/nightly/core/arch/wasm32/fn.f32x4_relaxed_max.html and sibling functions, stable since 1.82.0; https://webassembly.org/news/2026-01-21-states-of-webassembly/ (2026-01-21) (both accessed 2026-09-03).

### R16. If a relaxed-simd instruction's non-determinism is provably unreachable at a call site, document that proof instead of banning the instruction by policy.
**Why:** The non-determinism is per-instruction and per-input-class. `relaxed_swizzle` differs from `swizzle` only in the out-of-range-index case (base zeros it; relaxed leaves it implementation-defined) — a shuffle table built entirely from const, verified in-range indices never reaches that divergence.
**Applies to us:** Require a reviewer-visible comment proving the non-deterministic case is unreachable (e.g., "all indices are `const` and `< 16`") before using a relaxed op on a determinism-sensitive path — proof, not a blanket prohibition, matches the project's general engineering posture.
**Source:** https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md (accessed 2026-09-03) — per-instruction breakdown of exactly which input classes are host-dependent.

### R17. Never assert bit-exact equality on a NaN-producing float result, even in plain scalar wasm.
**Why:** The WebAssembly spec defines "an arithmetic NaN" as ±nan(m) where payload bits beyond the canonical set-MSB are "arbitrary." Only whether a value *is* a canonical NaN is pinned down; the exact bit pattern of a NaN produced from an operation with a NaN input is implementation-defined — in scalar `f32`/`f64` ops as much as in `v128` ones, with or without SIMD or relaxed-simd involved.
**Applies to us:** Any test or determinism guarantee comparing float buffers byte-for-byte must special-case or exclude NaN lanes, or compare "is NaN" rather than exact bits — including distance-field outputs with no SIMD in the picture at all.
**Source:** WebAssembly Core Specification, arithmetic-NaN definition, https://webassembly.github.io/spec/core/syntax/values.html (accessed 2026-09-03).

### R18. `pmin`/`pmax` are not commutative and not drop-in replacements for `min`/`max`.
**Why:** `f32x4.pmin(a, b)` is defined as `b < a ? b : a`; `f32x4.pmax(a, b)` as `a < b ? b : a`. Both propagate NaN from the **first** operand only — a NaN in the second operand is silently discarded — unlike `min`/`max`, which propagate NaN from either operand. Swapping operand order changes the result whenever either operand is NaN or the operands are ±0.0.
**Applies to us:** A distance-field min-reduction ported to `pmin`/`pmax` for speed must fix operand order to match which side is allowed to carry a "pending" NaN (e.g., accumulator vs. incoming sample), or results silently diverge from the scalar reference.
**Bad / Good:**
```rust
// Bad: assumes pmin is commutative like scalar f32::min
let acc = f32x4_pmin(sample, acc); // a NaN in `sample` vanishes silently
```
```rust
// Good: accumulator first, matching "NaN poisons the running result"
let acc = f32x4_pmin(acc, sample);
```
**Source:** MDN, "pmin"/"pmax: Wasm SIMD arithmetic instruction," https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/SIMD/arithmetic/pmin and .../pmax (accessed 2026-09-03).

### R19. A naive float-sum loop will never autovectorize — that's correctness, not a missed optimization.
**Why:** LLVM only reorders (tree-reduces) a floating-point reduction under the `-fassociative-math -fno-signed-zeros -fno-trapping-math` fast-math subset, because float addition is not associative and reordering changes the result. rustc enables no such flags by default on any target, including wasm32, so the loop vectorizer correctly refuses to vectorize `for x in xs { sum += x }`.
**Applies to us:** If profiling shows a scalar float-sum loop hot, the fix is an explicit SIMD tree-reduction kernel with a documented error bound (R20) or accepting the scalar cost — not reshaping the loop and hoping the vectorizer "finally" kicks in.
**Source:** LLVM, "Auto-Vectorization in LLVM," https://llvm.org/docs/Vectorizers.html; Rust internals, "Pre-pre-RFC floating-point math assumptions (fast-math)," https://internals.rust-lang.org/t/pre-pre-rfc-floating-point-math-assumptions-fast-math/7162 (both accessed 2026-09-03).

### R20. Treat SIMD-vs-scalar float reduction differences as a documented error bound, not a bug to chase to zero.
**Why:** A lane-parallel accumulate-then-horizontal-sum kernel sums in a different — but equally IEEE-754-valid — order than a scalar left-to-right reference. The two are different reduction trees and differ by rounding error proportional to lane count and value range, not by a fixed "off by epsilon" defect.
**Applies to us:** Differential tests (R21–R24) comparing a SIMD distance-field/position-summation kernel to its scalar oracle must assert a bounded-error tolerance (e.g., "≤4 ULP for a 4-lane tree reduction, N ≤ 4096") — never bit-exact equality — for any kernel that reassociates float arithmetic across lanes.
**Source:** orlp.net, "Taming Floating-Point Sums," https://orlp.net/blog/taming-float-sums/ (accessed 2026-09-03); corroborated by the LLVM Vectorizers reduction-flags section above.

### R21. Every SIMD kernel ships with an always-compiled scalar reference used as the test oracle.
**Why:** Without a live scalar implementation to diff against, "the SIMD kernel is correct" degrades to "the SIMD kernel is self-consistent," which catches nothing. The scalar twin must exist and run in CI regardless of which artifact ships to users.
**Applies to us:** Test configuration must compile both `simd_kernel` and `scalar_kernel` together, independent of the shipping `#[cfg(target_feature = "simd128")]` gate from R11 — e.g., a test binary force-built with `-C target-feature=+simd128` that still includes the scalar module for comparison.
**Source:** General differential-testing principle; corroborated by Cryspen's SIMD-testing methodology, which assumes both implementations are always available side by side, https://cryspen.com/post/specify-rust-simd/ (accessed 2026-09-03).

### R22. Differentially test with property-based inputs biased toward edge cases, not hand-picked "normal" values.
**Why:** SIMD intrinsics special-case boundary conditions that mid-range random data rarely hits: signed-saturation bounds, ±0.0, NaN/Inf, denormals, and lane-crossing shuffle/swizzle indices at 0, N−1, N, 2N−1.
**Applies to us:** Cluster-state scan and codec/packing kernels on `i8`/`u8` lanes should specifically generate inputs at `i8::MIN`, `i8::MAX`, `0`, and boundary-adjacent values, not just uniformly random ones.
**Source:** Cryspen SIMD-testing methodology (exhaustive tests for small ranges, random tests for large ranges), https://cryspen.com/post/specify-rust-simd/ (accessed 2026-09-03).

### R23. Derive the scalar oracle from the algorithm's specification, not from the SIMD kernel's observed behavior.
**Why:** Cryspen's methodology found real Rust stdlib bugs (`_mm256_bsrli_epi128`/`_mm512_bsrli_epi128` computing `tmp % 16` instead of clamping to 16, contrary to Intel's documented behavior) precisely because their reference model was written fresh from the ISA documentation, not reverse-engineered from an existing implementation. Two implementations sharing a derivation can share a bug.
**Applies to us:** When adding a SIMD kernel, write the scalar version first, straight from the format/algorithm spec — then write the SIMD version against it. Don't write the SIMD kernel and back-derive a "scalar equivalent" by unrolling it; that tests the kernel against itself in different clothing.
**Source:** Cryspen, "Formally Specifying and Testing the Rust Standard Library," https://cryspen.com/post/specify-rust-simd/ (accessed 2026-09-03).

### R24. Exhaustively test finite, enumerable input spaces instead of sampling them.
**Why:** A specific `i8x16_shuffle::<I0..I15>` call site has a fixed, compile-time-known set of const indices — there's no random dimension to sample. Single-byte lane arithmetic has only 256 (or 65,536 for lane pairs) possible values, cheap to brute-force.
**Applies to us:** Codec/packing kernels working in `i8x16`/`u8x16` lanes should have at least one exhaustive-over-all-256-values test per lane operation, not only property-sampled ones.
**Source:** Cryspen SIMD-testing methodology, https://cryspen.com/post/specify-rust-simd/ (accessed 2026-09-03).

### R25. Prove autovectorization failed before writing a single intrinsic.
**Why:** This is the actual enforcement mechanism for "hand-rolled SIMD only where proven faster than the autovectorizer" — without this step the policy is asserted, never verified.
**Applies to us:** Required checklist item before merging any new `#[target_feature(enable = "simd128")]` kernel: show that the scalar version's compiled output does not already contain v128 opcodes for the loop in question (see R26 for how).
**Source:** Derived directly from the stated project policy; verification method in R26.

### R26. Confirm vectorization (or its absence) by reading emitted code, not by eyeballing source.
**Why:** `cargo-show-asm` prints the assembly, LLVM IR, or the Wasm rustc/LLVM actually emits for a function, directly from the terminal. `wasm2wat` on the compiled `.wasm` makes the opcode stream greppable. rustc's `-Rpass=loop-vectorize` / `-Rpass-missed=loop-vectorize` / `-Rpass-analysis=loop-vectorize` remarks name the specific reason a loop wasn't vectorized.
**Applies to us:** Attach the `cargo-show-asm`/`wasm2wat` excerpt showing v128 opcodes present or absent to the PR description whenever a hand-rolled kernel is added or removed, per R25.
**Bad / Good:**
```bash
# Bad: "I checked the assembly" with nothing attached to the PR
```
```bash
# Good: reproducible evidence
cargo asm --target wasm32-unknown-unknown my_crate::scalar_kernel
wasm2wat target/wasm32-unknown-unknown/release/my_crate.wasm \
  | grep -c 'v128\|i32x4\|f32x4'
```
**Source:** https://crates.io/crates/cargo-show-asm; https://github.com/WebAssembly/wabt (wasm2wat); https://llvm.org/docs/Vectorizers.html (`-Rpass` diagnostics) (all accessed 2026-09-03).

### R27. Benchmark in the browser via `wasm-bindgen-test`; `cargo bench`/criterion does not run on wasm32.
**Why:** criterion.rs has a long-open, unresolved feature request for wasm-bindgen support (issue #270) — it depends on native process/timing infrastructure absent under `wasm32-unknown-unknown`. `wasm-bindgen-test` gained a dedicated `bench` feature in 2025 (tracked across issues #4812/#4823/#4840) specifically to run timed tests in a real browser via `performance.now()`.
**Applies to us:** Any "kernel X is faster" claim must point at a `wasm-bindgen-test` bench run against an actual browser engine — native `cargo bench` numbers do not transfer to wasm32/V8 or wasm32/SpiderMonkey codegen.
**Source:** https://github.com/bheisler/criterion.rs/issues/270 (open); https://github.com/wasm-bindgen/wasm-bindgen/issues/4840 (accessed 2026-09-03).

### R28. Wrap every timed variant's input and output in `black_box`, symmetrically.
**Why:** `std::hint::black_box` (stable since 1.66.0, 2022-12-15) is the standard best-effort way to stop the optimizer from constant-folding a benchmark's inputs or eliminating its unused output. Wrapping only one of two compared variants gives the compiler different dead-code-elimination latitude for each, biasing the comparison independent of real performance.
**Applies to us:** A `wasm-bindgen-test` bench comparing `scalar_kernel` vs. `simd_kernel` must `black_box` the shared input and each kernel's return value identically in both timed loops.
**Bad / Good:**
```rust
// Bad: asymmetric — only the SIMD path is protected from DCE
let r = std::hint::black_box(simd_kernel(&data));
let r2 = scalar_kernel(&data); // compiler may see `r2` unused and fold the loop away
```
```rust
// Good: identical treatment on both sides
let data = std::hint::black_box(&data);
let r = std::hint::black_box(simd_kernel(data));
let r2 = std::hint::black_box(scalar_kernel(data));
```
**Source:** https://doc.rust-lang.org/beta/std/hint/fn.black_box.html; stabilization PR https://github.com/rust-lang/rust/pull/62891 (stable 1.66.0, 2022-12-15) (accessed 2026-09-03).

### R29. Require a SIMD win to be reproducible above the noise floor, and ideally across two engines, before keeping it.
**Why:** Browser benchmark results are documented to shift meaningfully between manual runs and driver-automated runs (`NO_HEADLESS=1` vs. ChromeDriver/SafariDriver) from JIT warm-up and GC timing differences. A single run's "15% faster" is inside the noise band unless repeated runs on the same engine agree, and a win specific to one engine's JIT quirks isn't evidence the intrinsic is fundamentally faster.
**Applies to us:** PR evidence from R25/R26 should include a benchmark repeated at least 3x with spread reported, on one Chromium engine and one non-Chromium engine (Firefox/SpiderMonkey) for anything on a hot path.
**Source:** wasm-bindgen bench discussion noting browser benchmark variance between manual and driver-automated runs, https://github.com/wasm-bindgen/wasm-bindgen/issues/4840 (accessed 2026-09-03).

### R30. Delete a hand-rolled kernel that isn't measurably faster than its autovectorized scalar twin.
**Why:** Hand-rolled intrinsics cost unsafe surface area and the full differential-testing apparatus (R21–R24). A well-structured scalar loop can match hand-written SIMD intrinsics exactly: measured 25.54µs autovectorized vs. 25.78µs hand-written, both ~3x a naive scalar loop's 77.67µs. "Hand-rolled" is not inherently faster than "autovectorized well."
**Applies to us:** The closing half of R25 — if benchmark evidence doesn't show a real win, delete the intrinsic kernel and keep the autovectorizable scalar one; don't grandfather it in because it's already written.
**Source:** Nick Wilcox, "Taking Advantage of Auto-Vectorization in Rust," https://www.nickwilcox.com/blog/autovec/ (accessed 2026-09-03).

### R31. Prove slice lengths equal up front so bounds checks disappear from the loop body.
**Why:** The vectorizer must prove every iteration's memory access is in-bounds before emitting a vector load/store. A bounds check inside the loop (implicit from indexing an unproven-length slice) is exactly the per-iteration branch that blocks vectorization; asserting lengths match once, before the loop, lets the compiler discharge all per-iteration checks at once.
**Applies to us:** Default to this before considering intrinsics for any new hot loop (ties to R25).
**Bad / Good:**
```rust
// Bad: compiler must bounds-check dst[i] and src[i] every iteration
pub fn scale(dst: &mut [f32], src: &[f32], k: f32) {
    for i in 0..src.len() {
        dst[i] = src[i] * k;
    }
}
```
```rust
// Good: length proven equal once; per-iteration checks eliminated
pub fn scale(dst: &mut [f32], src: &[f32], k: f32) {
    assert_eq!(dst.len(), src.len());
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d = *s * k;
    }
}
```
**Source:** Nick Wilcox, "Taking Advantage of Auto-Vectorization in Rust," https://www.nickwilcox.com/blog/autovec/ (accessed 2026-09-03).

### R32. Prefer `chunks_exact`/`as_chunks` over `chunks`/manual indexing for fixed-width groups.
**Why:** `chunks_exact` (and `as_chunks`, returning `&[T; N]` items) guarantees every chunk but a separately-returned remainder is exactly N elements, giving LLVM a provably fixed per-chunk trip count. `chunks`/manual `a[i..i+n]` indexing keeps the ragged-last-chunk case inline in the loop, usually defeating vectorization of the whole loop rather than just its tail.
**Applies to us:** Distance-field and codec loops processing runs of 4/8/16 elements (matching v128 lane counts) are exactly this shape, whether or not they end up using intrinsics.
**Source:** Nick Wilcox, "Taking Advantage of Auto-Vectorization in Rust," https://www.nickwilcox.com/blog/autovec/; Rust internals, "chunks_exact(N) Item is &'a [T] and not &'a [T; N]," https://internals.rust-lang.org/t/chunks-exact-n-item-is-a-t-and-not-a-t-n/23279 (both accessed 2026-09-03).

### R33. Keep early exits (`return`/`break`/`?`) out of the hot inner loop body.
**Why:** The loop vectorizer needs a fixed, provable trip count and uniform control flow across the lanes it groups. A data-dependent early exit makes the number of scalar iterations that actually ran a runtime value the vectorizer can't fold into a vector-width batch, so it falls back to scalar.
**Applies to us:** A cluster-state scan that wants to bail out on the first match should run to completion and reduce (mask + `position`/`trailing_zeros`-style pattern) inside the loop, returning once after it — or be written as a deliberate hand-rolled SIMD kernel that owns that tradeoff explicitly, with proof per R25.
**Source:** LLVM, "Auto-Vectorization in LLVM" (trip-count / uniform-control-flow requirement), https://llvm.org/docs/Vectorizers.html (accessed 2026-09-03).

### R34. Use `#[repr(C)]` fixed-layout structs or struct-of-arrays layouts in hot-loop data, not per-element tagged data.
**Why:** The vectorizer needs a provably constant stride between consecutive elements to group loads/stores. A `#[repr(C)]` struct (or a plain `f32` array) gives it one; an enum, `Vec<Box<dyn T>>`, or any per-element size/branch makes the stride runtime-dependent and unvectorizable by construction, regardless of how the loop is written.
**Applies to us:** Applies directly to glyph position/coordinate buffers in the layout and codec kernels — pack them as fixed `#[repr(C)]` element arrays, not variant-tagged data.
**Bad / Good:**
```rust
// Bad: per-element layout the compiler can't reason about statically
enum Sample { Mono(f32), Stereo(f32, f32) }
fn gain(samples: &mut [Sample], g: f32) { /* can't vectorize: per-element dispatch */ }
```
```rust
// Good: fixed, provable per-element stride
#[repr(C)]
struct Stereo { l: f32, r: f32 }
fn gain(samples: &mut [Stereo], g: f32) {
    for s in samples.iter_mut() { s.l *= g; s.r *= g; }
}
```
**Source:** Nick Wilcox, "Taking Advantage of Auto-Vectorization in Rust" (`repr(C)` `StereoSample` example), https://www.nickwilcox.com/blog/autovec/ (accessed 2026-09-03).

### R35. Verify lane 0 against a known scalar value whenever writing a shuffle/lane-order-sensitive kernel.
**Why:** wasm128 numbers lanes little-endian/LSB-first: for `iNxM`, lane n occupies bits `Nn..Nn+N-1`, and lane 0 sits at the lowest memory address when a `v128` is stored. This is easy to transpose mentally when porting a kernel sketched with a different lane-order intuition, and the resulting bug is silent — a wrong answer, not a crash.
**Applies to us:** Any new shuffle/swizzle/extract-lane kernel needs a test asserting `i32x4_extract_lane::<0>(v)` equals the specific scalar value intended for "the first element," not just aggregate output correctness.
**Source:** WebAssembly SIMD proposal spec — lane numbering ("Lane n corresponds to bits 8n–8n+7," etc.) and byte order ("bits 0-7 go in the first byte with bit 0 as the LSB"), https://github.com/WebAssembly/simd/blob/main/proposals/simd/SIMD.md (accessed 2026-09-03).

### R36. Never assume SIMD `+`/`-` matches a saturating scalar reference — simd128 integer ops wrap silently.
**Why:** Unlike scalar Rust integers (which panic on overflow in debug builds), `i32x4_add`/`i8x16_add`/etc. always wrap, with no debug-mode check. There is no build configuration under which a wrapping-vs-saturating mismatch announces itself.
**Applies to us:** Codec/packing kernels on `i8`/`u8` lanes (where boundary overflow is common) must use the explicit `*_add_sat`/`*_sub_sat` family whenever the scalar reference saturates. A differential test (R22) hitting `i8::MAX`/`i8::MIN` will catch a `+`-for-`add_sat` mistake that typical-input testing will not.
**Bad / Good:**
```rust
// Bad: silently wraps if the scalar reference saturates at u8::MAX
let sum = u8x16_add(a, b);
```
```rust
// Good: matches a saturating scalar reference exactly
let sum = u8x16_add_sat(a, b);
```
**Source:** https://github.com/rust-lang/stdarch/blob/main/crates/core_arch/src/wasm32/simd128.rs (saturating-op docs, e.g. `i8x16_add_sat`) (accessed 2026-09-03).

### R37. Don't substitute `i8x16_relaxed_swizzle` for `i8x16_swizzle` as a "free" speedup.
**Why:** Base `i8x16_swizzle` is fully specified: out-of-range indices (outside `[0,15]`) deterministically produce lane value 0. `i8x16_relaxed_swizzle` leaves the out-of-range case implementation-defined. They agree only on inputs that never go out of range — the two functions have identical call signatures, so this substitution compiles silently in either direction with zero type-level signal that anything changed.
**Applies to us:** Instance of R16 worth its own check given how easy the swap is to make unnoticed.
**Bad / Good:**
```rust
// Bad: silent semantic change if `indices` can ever contain a value >= 16
let out = i8x16_relaxed_swizzle(table, indices);
```
```rust
// Good: keep the deterministic op unless indices are proven in-range
// (and comment the invariant if you do switch)
let out = i8x16_swizzle(table, indices);
```
**Source:** https://doc.rust-lang.org/stable/core/arch/wasm32/fn.i8x16_swizzle.html ("indices outside of the range the resulting lane is 0"); https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md (both accessed 2026-09-03).

### R38. Don't try to make `*_shuffle` indices dynamic — they're const generics; use `swizzle` for runtime indices.
**Why:** `i8x16_shuffle::<I0, ..., I15>(a, b)` takes 16 `usize` const generic parameters that must be compile-time constants in `[0, 32)`; the compiler statically encodes them into the wasm `shuffle` instruction's immediate bytes. There is no path that accepts a runtime `[usize; 16]` and forwards it to `shuffle`. A kernel needing runtime-computed permutation indices needs `i8x16_swizzle` instead — a different instruction (single input, dynamic index vector, zero-fills out-of-range per R37), not an alternate calling convention for shuffle.
**Applies to us:** A reviewer seeing an attempt to compute shuffle indices at runtime and pass them into `*_shuffle` should flag it as a type error waiting to happen — it won't compile — not a style nit.
**Source:** https://doc.rust-lang.org/beta/core/arch/wasm32/fn.i32x4_shuffle.html ("All index expressions must be constant") (accessed 2026-09-03).

### R39. Don't add manual pointer-alignment checks before `v128_load`/`v128_store`.
**Why:** WebAssembly's `align` immediate on a memory instruction is a performance hint only; it does not change execution semantics, and misalignment never traps. Only an out-of-bounds access (crossing the end of linear memory) traps, independent of alignment. Rust's own `v128_load` documents itself as performing a "1-aligned load" for exactly this reason — no alignment is required for correctness.
**Applies to us:** Any alignment-guard branch around a `v128_load`/`v128_store` call in the codec/distance-field kernels is dead protective code and can be deleted; the only real requirement `v128_load` has is "valid to read 16 bytes from" — a bounds concern, not an alignment one.
**Source:** https://doc.rust-lang.org/stable/core/arch/wasm32/fn.v128_load.html (accessed 2026-09-03); corroborated by MDN's SIMD load reference, https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/SIMD/load_store/load, and community discussion confirming alignment hints don't affect semantics, https://github.com/microsoft/ChakraCore/issues/6259.

### R40. Prefer a plain typed dereference over `v128_load`/`v128_store` when you already hold a valid typed reference.
**Why:** Rust's `v128_load` docs note the intrinsic is "not strictly necessary" once you already have a `&v128`: `unsafe { v128_load(a) }` is equivalent to `*a` for `a: &v128`. The intrinsic exists for the raw-pointer case (arbitrary/unaligned byte offsets into a buffer); with a proper `&v128`/`&[v128; N]` reference in hand, a plain dereference goes through Rust/LLVM's normal load path and removes an unnecessary `unsafe` call.
**Applies to us:** Kernel code that already sliced a buffer as `&[v128]` (e.g., via a `bytemuck`/`as_chunks`-style cast earlier in the pipeline) should index/deref that slice directly rather than re-deriving a raw pointer to feed back into `v128_load`.
**Bad / Good:**
```rust
// Unnecessary: re-deriving a raw pointer from an already-typed reference
let v: v128 = unsafe { v128_load(&buf[i] as *const v128) };
```
```rust
// Simpler and equally correct: buf[i] is already a valid v128
let v: v128 = buf[i];
```
**Source:** https://doc.rust-lang.org/stable/core/arch/wasm32/fn.v128_load.html (accessed 2026-09-03).
