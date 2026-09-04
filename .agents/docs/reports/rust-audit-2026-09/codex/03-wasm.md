---
type: Reference
title: "Rust codex — Rust to WebAssembly: size, ABI and memory"
description: "Checkable rules on Rust-to-WebAssembly size, ABI and memory, researched against primary sources, each with rationale, applicability to this repository, and a citation."
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

### R1. Measure `opt-level = "s"` against `"z"` — never assume `"z"` wins
**Why:** The rustc book defines `z` as "optimize for binary size, but more aggressively" than `s`, and states outright: "Often results in larger binaries than `s`." `z` suppresses more inlining and vectorization than `s`; on branchy code that occasionally makes the *compiled* result larger, not smaller, because the more aggressive size heuristics forgo folding opportunities that inlining would have exposed.
**Applies to us:** The shaper crate (47k LOC, the largest contributor to the shipped artifact) is exactly the branchy, loop-heavy code where this inversion shows up. Build both and diff the actual `shaper.wasm`; don't set `opt-level = "z"` from folklore.
**Bad / Good:**
```toml
# Bad: assumed without measuring
[profile.release]
opt-level = "z"
```
```toml
# Good: pick the winner after building both and comparing wasm-opt'd output size
[profile.release]
opt-level = "s"   # measured smaller than "z" for this artifact
```
**Source:** https://doc.rust-lang.org/rustc/codegen-options/index.html (rustc book, `opt-level`, current).

### R2. Default to `lto = "fat"` for the shipped artifact, but re-measure `"thin"` on this workspace size
**Why:** Fat LTO does whole-dependency-graph analysis; thin LTO is documented by rustc itself to sometimes match or beat fat on larger codebases: "For larger projects like the Rust compiler, ThinLTO can even result in better performance than fat LTO."
**Applies to us:** 12 first-party crates / ~63k LOC is large enough that this isn't a hypothetical caveat — compare both on the real link, not a toy crate, before locking `lto = "fat"` into the release profile.
**Source:** https://doc.rust-lang.org/rustc/codegen-options/index.html (rustc book, `lto`, current).

### R3. Set `codegen-units = 1` on every profile that produces a shipped artifact
**Why:** `codegen-units > 1` partitions a crate into independently-codegen'd chunks for parallelism; cross-chunk inlining and duplicate-instantiation merging both stop at partition boundaries. LTO and monomorphization dedup (R8) both need a single partition to see the whole program.
**Applies to us:** general — already the project's stated release-profile setting; treat any PR that raises it above 1 for the wasm targets as a regression, not a tuning choice.
**Source:** https://doc.rust-lang.org/rustc/codegen-options/index.html (rustc book, `codegen-units`).

### R4. `panic = "abort"` must be uniform across the entire crate graph that feeds a shipped artifact
**Why:** rustc enforces this at link time: "If any crate in the crate graph uses `abort`, the final binary (`bin`, `dylib`, `cdylib`, `staticlib`) must also use `abort`." A profile override that only reaches the top-level crate, while a path- or dev-dependency resolves under a different profile, either fails to link or silently reintroduces unwind tables.
**Applies to us:** with 12 crates and `std` as an opt-in feature for host tools, a host-tool build profile that forgets `panic = "abort"` (or a `[profile.dev]` used to build a test binary that links the same cdylib) is the concrete failure mode to check for in CI.
**Source:** https://doc.rust-lang.org/rustc/codegen-options/index.html (rustc book, `panic`).

### R5. Follow Cargo's `strip` with a Binaryen/wasm-tools strip pass — Cargo's strip does not remove wasm custom sections
**Why:** Cargo's `strip` operates on symbol tables at the object/link level. Binaryen registers `strip-debug`, `strip-dwarf`, `strip-producers`, `strip-target-features`, and `strip-toolchain-annotations` as *separate* passes precisely because they are independent knobs over independent wasm custom sections (name section, DWARF, the toolchain "producers" section, the `target_features` section) — if Cargo's strip already deleted all of them, these passes would be redundant and wouldn't exist as distinct options. `wasm-tools` mirrors this with its own `strip` subcommand operating directly on custom sections.
**Applies to us:** general, cheap, and easy to get half-done — a build that only sets `strip = true` and skips this step still ships a "producers" custom section naming the exact rustc/LLVM toolchain version.
**Bad / Good:**
```bash
# Bad: relies on Cargo strip alone
cargo build --release --target wasm32-unknown-unknown

# Good: demangle names for debugging, strip remaining custom sections, then verify what's left
wasm-tools demangle target/.../shaper.wasm | wasm-tools strip | wasm-tools objdump
wasm-opt -Oz --strip-producers --strip-target-features -o out.wasm in.wasm
```
**Source:** https://github.com/WebAssembly/binaryen `src/passes/pass.cpp` (pass registry, current main branch); https://github.com/bytecodealliance/wasm-tools README (current).

### R6. Do not depend on `-Cpanic=immediate-abort` / `-Zbuild-std-features=panic_immediate_abort` on this toolchain
**Why:** Both require `-Zunstable-options` plus `-Z build-std` on nightly. As late as nightly-2025-09-24 the feature had an open regression that grew `std`'s contribution from 17.3 KiB to 82.6 KiB (roughly +378%) before a fix landed, and a separate issue (`core` compiled with an incompatible panic strategy) was still open in the same window. The rustc book documenting a flag's semantics is not the same as the flag being stabilized.
**Applies to us:** pinned to stable Rust 1.97.1 — this path is unavailable outright, full stop. The size win it targets (dropping panic-message formatting entirely) has to come from R17/R18 below instead, which reach most of the same result on stable.
**Bad / Good:**
```toml
# Bad: silently requires nightly + -Z flags, breaks a stable-pinned toolchain/CI
# .cargo/config.toml
[unstable]
build-std-features = ["panic_immediate_abort"]
```
```rust
// Good on stable: hand-roll the same effect for the no_std wasm artifact (see R17)
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
```
**Source:** https://github.com/rust-lang/rust/issues/147257 (binary size regression, nightly-2025-09-24); https://github.com/rust-lang/rust/issues/146974 (build-std panic-strategy incompatibility, open); https://doc.rust-lang.org/rustc/codegen-options/index.html (`panic` option lists `immediate-abort` but only reachable via `-Z`).

### R7. Run `wasm-opt -Oz --converge` as a mandatory post-link step, not an optional extra
**Why:** `-Oz` is Binaryen's most aggressive size meta-pass. `--converge` re-runs the configured pass pipeline in a loop until the file stops shrinking, because later passes routinely expose folding/DCE opportunities that earlier passes in the same pipeline didn't see on their first pass over the code.
**Applies to us:** general pipeline step for every shipped `.wasm` artifact (shaper and the raster backends alike).
**Bad / Good:**
```bash
# Bad: single pass, leaves fixed-point gains on the table
wasm-opt -Oz -o out.wasm in.wasm

# Good
wasm-opt --converge -Oz -o out.wasm in.wasm
```
**Source:** https://github.com/WebAssembly/binaryen/wiki/Optimizer-Cookbook (current); https://rustwasm.github.io/book/reference/code-size.html (rustwasm book, current).

### R8. Explicitly run `duplicate-function-elimination` / `merge-similar-functions` — don't trust LTO alone to dedup monomorphizations
**Why:** LTO merges functions that are identical at the LLVM-IR level. Two monomorphized instances that differ only in a generic parameter they never observably use can still diverge syntactically in LLVM IR (different mangled names, different debug metadata) while compiling down to byte-identical wasm. Binaryen's `duplicate-function-elimination` and `merge-similar-functions` passes operate on the actual emitted wasm bytecode and catch exactly this class LTO's IR-level view misses.
**Applies to us:** the shaper's generic layout/shaping code, parameterized over script/writing-system and buffer types, is a natural source of near-identical instantiations that LTO alone won't fully collapse.
**Bad / Good:**
```bash
# Good: explicit dedup pass in addition to -Oz's default set
wasm-opt --duplicate-function-elimination --merge-similar-functions -Oz -o out.wasm in.wasm
```
**Source:** https://github.com/WebAssembly/binaryen `src/passes/pass.cpp` (`registerPass("duplicate-function-elimination", ...)`, `registerPass("merge-similar-functions", ...)`, current).

### R9. `wasm-snip` functions you know are dead but the compiler can't prove are dead
**Why:** `wasm-snip` replaces a function's body with a single `unreachable` instruction. Everything transitively reachable only from a snipped function becomes eligible for DCE on the next `wasm-opt`/`wasm-ld --gc-sections` pass — this covers code the compiler is *conservatively* keeping because some trait impl or generic bound makes it reachable in principle, even though your actual call graph never exercises it on this target.
**Applies to us:** e.g. `std`-only diagnostic/formatting paths that leak into the no_std build's link graph via a shared trait impl compiled once for both the host-tool (`std`) and wasm (`no_std`) configurations.
**Bad / Good:**
```bash
wasm-snip --snip-rust-fmt-code --snip-rust-panicking-code in.wasm -o snipped.wasm
wasm-opt --dce -o out.wasm snipped.wasm
```
**Source:** https://github.com/rustwasm/wasm-snip README (current, maintained by the Rust and WebAssembly Working Group).

### R10. Audit and minimize the exported symbol surface — every export is a GC root
**Why:** `wasm-ld`'s dead-code elimination can only drop code unreachable from a root, and every `#[no_mangle] pub extern "C" fn` is by definition a root. An unused, debug-only, or speculative export keeps its *entire* transitive call graph in the shipped binary — including any `core::fmt` or generic machinery it alone pulls in — no matter how aggressive `opt-level`/LTO/`wasm-opt` are downstream, because none of those tools may remove a live root.
**Applies to us:** ties directly to the engine-call-contract discipline already governing this repo's published entry points — treat an export-list audit as a size lever, not only an API-surface concern. `twiggy dominators` makes each export's retained-size subtree directly visible (its own output literally roots each subtree at `export "..."`).
**Bad / Good:**
```rust
// Bad: exported "just in case", pins its whole subtree even if nothing calls it
#[no_mangle]
pub extern "C" fn debug_dump_arena() -> u32 { /* ... */ }
```
```rust
// Good: gate debug-only exports behind a feature that's off in the shipped build
#[cfg(feature = "diagnostics")]
#[no_mangle]
pub extern "C" fn debug_dump_arena() -> u32 { /* ... */ }
```
**Source:** https://github.com/rustwasm/twiggy `guide/src/usage/command-line-interface/dominators.md` (`export "items_parse"` shown as a dominator-tree root, current).

### R11. Use `twiggy`, not `cargo-bloat`, to attribute size inside a compiled `.wasm`
**Why:** `cargo-bloat`'s own README states plainly: "WASM is not supported. Use twiggy instead." `cargo-bloat` reads native object-file symbol tables; twiggy parses the wasm binary format (and partial DWARF) directly and builds an actual call graph over it, which is what makes its retained-size ("dominators") analysis possible at all.
**Applies to us:** general — a checkable rule: if a size-audit script or CI job runs `cargo bloat` against a `.wasm` file, that's wrong on its face regardless of what it reports.
**Source:** https://github.com/RazrFalcon/cargo-bloat README (current, explicit WASM-unsupported statement).

### R12. Use `twiggy monos` specifically to find monomorphization bloat — `top`/`dominators` alone won't isolate it
**Why:** `twiggy monos` groups shallow size by the *generic function* being instantiated and reports both the exact bloat contributed and each concrete instantiation beneath it, which `top` (flat, per-symbol) and `dominators` (retained-size tree) don't do on their own. Twiggy's own example output for `monos` shows `<&'a T as core::fmt::Debug>::fmt` as a top contributor at 7.26% of the (example) binary, split across three separate monomorphized instances — a direct, primary-source illustration of R16 below.
**Applies to us:** run this before assuming a generic hot path in the shaper is "probably fine" — the tool answers the question with a number instead.
**Bad / Good:**
```bash
twiggy monos shaper.wasm
```
**Source:** https://github.com/rustwasm/twiggy `guide/src/usage/command-line-interface/monos.md` (current; example output shows `alloc::slice::merge_sort` and `<&'a T as core::fmt::Debug>::fmt` as top bloat contributors).

### R13. Run `cargo llvm-lines` under fat LTO to see cross-crate monomorphization before the wasm even exists
**Why:** `cargo llvm-lines` counts LLVM-IR lines and instantiation counts per generic function, but by default "only shows the contribution of the root crate; dependencies are not included," because Rust generics are monomorphized in the *using* crate, not the defining one. Its own docs give the fix: force all codegen into the root crate by building under LTO, so dependency-crate generics get attributed too.
**Applies to us:** exactly the multi-crate-workspace case flagged in its own README — running plain `cargo llvm-lines` against, say, the `font-baker` crate will under-report generic bloat that actually originates in `shaper` or `mtsdf-core`.
**Bad / Good:**
```bash
# Incomplete: only the root crate's own generic instantiations are counted
cargo llvm-lines --release

# Complete: forces cross-crate codegen into the root crate so it's all visible
CARGO_PROFILE_RELEASE_LTO=fat cargo llvm-lines --release
```
**Source:** https://github.com/dtolnay/cargo-llvm-lines README, "Multicrate Projects" section (current).

### R14. Use `wasm-tools validate` / `print` / `objdump` in CI to inspect the boundary surface and enabled proposals
**Why:** `wasm-tools validate foo.wasm --features=-simd` (or similar) validates a binary against an explicit feature set, and `wasm-tools print` / `objdump` make the export section and section list directly inspectable without a browser. This turns "does this artifact only use the wasm proposals our minimum supported runtime actually implements" into a scriptable check instead of a runtime surprise.
**Applies to us:** pairs with R10 (export audit) and R36 (target-feature defaults) — a CI step that runs `wasm-tools print shaper.wasm | grep '(export'` and diffs it against an allowlist catches an accidental new export before it ships.
**Bad / Good:**
```bash
wasm-tools validate shaper.wasm --features=-exception-handling
wasm-tools print shaper.wasm -o shaper.wat   # inspect exports/sections by hand
```
**Source:** https://github.com/bytecodealliance/wasm-tools README (current).

### R15. Don't let `core::fmt::Display` reach hot or boundary-adjacent integer formatting
**Why:** `impl Display for u32` (and the other integer types) routes through `core::fmt`'s general-purpose `pad_integral()`, which exists to support width/fill/alignment format specifiers most callers never use. A tracked example: formatting `core::panic::Location` (which embeds a `u32` line/column) costs "almost 3 KiB" on `wasm32-unknown-unknown` with `opt-level = "z"` + LTO, purely from pulling in this padding machinery — the issue is open with no fix as of this writing.
**Applies to us:** any place the engine formats a number for a host-visible error/log path (not just panics) pays this cost; prefer a minimal manual integer-to-string routine (or a `itoa`-style crate) over `write!`/`{}`/`ToString` for anything reachable from the wasm build.
**Bad / Good:**
```rust
// Bad: pulls in core::fmt's general pad_integral machinery for a plain integer
let s = format!("{glyph_id}");
```
```rust
// Good: bypass core::fmt entirely for the common case
let mut buf = itoa::Buffer::new();
let s = buf.format(glyph_id);
```
**Source:** https://github.com/rust-lang/rust/issues/118940 ("`impl fmt::Display for u32` compiles to large binary", open, C-optimization/I-heavy/T-libs).

### R16. Don't derive or otherwise instantiate `Debug`/`Display` on a generic type instantiated across many concrete parameters
**Why:** each concrete instantiation of a derived `Debug`/`Display` impl is a separate monomorphization with its own copy of the formatting machinery (field names, punctuation, nested `fmt` calls). Twiggy's own `monos` example output (R12) shows `<&'a T as core::fmt::Debug>::fmt` as the *second-largest* bloat source in their sample binary, ahead of all but one other function family, split across three separate instantiations.
**Applies to us:** any `#[derive(Debug)]` on a type generic over glyph/shaping parameters that also compiles into the wasm target multiplies this cost by the number of concrete instantiations reachable from an export; gate `Debug` impls behind the `std` feature (host-tool builds only) where they're actually used for diagnostics.
**Bad / Good:**
```rust
// Bad: Debug derived unconditionally, compiled into every wasm-bound instantiation too
#[derive(Debug)]
struct ShapedRun<B: Buffer> { /* ... */ }
```
```rust
// Good: Debug only exists in the host-tool / std build where it's actually consumed
#[cfg_attr(feature = "std", derive(Debug))]
struct ShapedRun<B: Buffer> { /* ... */ }
```
**Source:** https://github.com/rustwasm/twiggy `guide/src/usage/command-line-interface/monos.md` (current, example output).

### R17. Supply a hand-written `#[panic_handler]` that ignores `PanicInfo` and traps, for the no_std wasm artifact
**Why:** on stable Rust (R6 rules out `panic_immediate_abort`), the only way to keep panic-message formatting out of a no_std binary entirely is to never format it: `core::arch::wasm32::unreachable()` has been stable since Rust 1.37.0 and lowers directly to the wasm `unreachable` trap instruction, with no dependency on `core::fmt`. Reading fields off `PanicInfo` (location, message) to log them pulls the same `core::fmt`/`pad_integral` machinery back in (R15).
**Applies to us:** every crate here is no_std + alloc, and the wasm32 cdylib that gets shipped is exactly the artifact that needs exactly one `#[panic_handler]` in its link graph — this is the single highest-leverage, fully-stable substitute for the nightly-only `panic_immediate_abort` path.
**Bad / Good:**
```rust
// Bad: formats the panic, pulling in core::fmt for a message nothing in the browser reads
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    log(&alloc::format!("{info}"));
    core::arch::wasm32::unreachable()
}
```
```rust
// Good: no formatting reachable at all
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
```
**Source:** https://doc.rust-lang.org/stable/core/arch/wasm32/fn.unreachable.html (stable since 1.37.0, current); https://github.com/rust-lang/rust/issues/118940 (formatting cost).

### R18. Forbid `.unwrap()` / `.expect()` / panicking index or slice ops on any path reachable from an exported function
**Why:** every panicking standard-library call site (`Option::unwrap`, `[i]` indexing, `a / b` on integers, etc.) is `#[track_caller]`, which the compiler implements by threading a hidden `&'static Location` argument (file, line, column) to every call — and formatting that `Location` on the way to a panic message is precisely the `core::fmt`/`pad_integral` cost measured at ~3 KiB in R15. With R17's minimal handler in place, the message is discarded anyway, so the panicking call site is pure cost (code size, plus a bounds/null check that can't be elided) for zero runtime benefit.
**Applies to us:** the concrete grep-able check: no `.unwrap()`, `.expect(...)`, or unchecked `slice[i]` indexing inside any function transitively reachable from a `pub extern "C"` export — replace with `.ok_or(ErrorCode::...)`-style fallible plumbing that returns a sentinel (see R32) instead of panicking.
**Bad / Good:**
```rust
// Bad: panics with a formatted, located message on a path the host calls directly
#[no_mangle]
pub extern "C" fn glyph_advance(ptr: *const Glyph, idx: u32) -> f32 {
    let glyphs = unsafe { core::slice::from_raw_parts(ptr, len) };
    glyphs[idx as usize].advance   // panics + formats Location on OOB
}
```
```rust
// Good: fallible, no panicking path reachable from the export
#[no_mangle]
pub extern "C" fn glyph_advance(ptr: *const Glyph, len: u32, idx: u32) -> f32 {
    let glyphs = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
    glyphs.get(idx as usize).map_or(f32::NAN, |g| g.advance)
}
```
**Source:** https://github.com/rust-lang/rust/issues/118940 (Location formatting cost); https://rustc-dev-guide.rust-lang.org/backend/implicit-caller-location.html (`#[track_caller]` mechanism, current).

### R19. Bound monomorphization fan-out: erase a generic hot spot to a non-generic core or a trait object once instantiation count times body size gets large
**Why:** a generic function of size *n* instantiated over *m* concrete type combinations contributes on the order of *n×m* bytes before any cross-crate merging (R8) has a chance to collapse identical instances. LTO and `duplicate-function-elimination` only merge instances that end up *identical*; instances that differ in any observable way (even just which concrete numeric type backs a buffer) stay separate.
**Applies to us:** the shaper's layout/shaping code parameterized over buffer/writing-system types is the named largest contributor to the artifact — use R13 (`cargo llvm-lines` under LTO) to find any single generic function whose `Copies` column times its per-copy `Lines` dominates the total, and either monomorphize it manually down to the 2-3 concrete types actually shipped, or push the type parameter behind a `dyn Trait`/vtable at the one call site where it doesn't matter for hot-loop performance.
**Bad / Good:**
```rust
// Bad: large generic body, instantiated once per concrete Buffer impl that reaches wasm
fn shape_run<B: Buffer>(buf: &mut B, spec: &Spec) { /* hundreds of lines */ }
```
```rust
// Good: one non-generic core, thin generic shim only where the type actually varies
fn shape_run_core(buf: &mut dyn Buffer, spec: &Spec) { /* hundreds of lines, compiled once */ }
fn shape_run<B: Buffer>(buf: &mut B, spec: &Spec) { shape_run_core(buf, spec) }
```
**Source:** https://github.com/dtolnay/cargo-llvm-lines README (measurement method, current); https://www.alilleybrinker.com/blog/monomorphization-bloat/ (practitioner analysis of the *n×m* growth pattern).

### R20. `#[repr(C)]` or `#[repr(transparent)]` is mandatory on every type that crosses `extern "C"` — never a bare Rust struct or enum
**Why:** plain Rust struct/enum layout is unspecified and may be reordered, niche-packed, or otherwise rearranged by the compiler between builds; only `repr(C)` (fixed C-compatible field order and padding) or `repr(transparent)` (guaranteed identical layout/ABI to its single non-zero-sized field) give a caller on the other side of the boundary anything to rely on.
**Applies to us:** general — the entire raw C-ABI boundary this project exports depends on this holding for every type that appears in a signature, not just the "obviously FFI" ones.
**Bad / Good:**
```rust
// Bad: layout is unspecified, may change silently between compiler versions
pub struct GlyphMetrics { advance: f32, bearing: f32 }
```
```rust
#[repr(C)]
pub struct GlyphMetrics { advance: f32, bearing: f32 }
```
**Source:** https://doc.rust-lang.org/nomicon/ffi.html (Rustonomicon, "Representing opaque structs" / repr(C) guidance, current).

### R21. Represent opaque handles with the zero-sized + `PhantomPinned` idiom, never a bare `*mut T` or an exposed struct layout
**Why:** the Rustonomicon's documented idiom for an opaque FFI type is a `#[repr(C)]` struct with a private zero-sized field plus `PhantomData<(*mut u8, PhantomPinned)>`, which (a) makes the type impossible to construct or inspect outside the defining module, (b) makes it `!Send + !Sync + !Unpin` so the host can't accidentally do something the Rust side never validated, and (c) gives distinct handle types for distinct resources so the compiler — not a runtime check — rejects passing a `FontHandle` where a `BufferHandle` is expected.
**Applies to us:** every long-lived resource the host holds onto across calls (font, shaping buffer, baked atlas) should get its own opaque type via this pattern rather than sharing a single `*mut c_void`.
**Bad / Good:**
```rust
// Bad: any u32/pointer will do, no type-level distinction between resource kinds
pub type Handle = u32;
```
```rust
#[repr(C)]
pub struct FontHandle {
    _data: (),
    _marker: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
```
**Source:** https://doc.rust-lang.org/nomicon/ffi.html (Rustonomicon, "Representing opaque structs", current).

### R22. Use `repr(transparent)` index/generation newtypes for anything the host retains across calls, not raw pointers
**Why:** a raw pointer handed to the host is only valid until the next allocation your allocator services internally reuses or moves that memory — the host has no way to know when that happens. An index into a Rust-owned table (see R23) is stable and lets the Rust side freely reallocate/compact its own storage without invalidating anything the host is holding.
**Applies to us:** given talc is the allocator at every wasm boundary and the host (TypeScript) is expected to hold font/buffer handles across many calls, exposing raw pointers as "the handle" ties allocator internals to the public ABI; an index+generation newtype doesn't.
**Bad / Good:**
```rust
// Bad: the pointer IS the handle; any internal move/realloc breaks every host-held handle
#[no_mangle]
pub extern "C" fn font_load(ptr: *const u8, len: u32) -> *mut Font { /* ... */ }
```
```rust
#[repr(transparent)]
pub struct FontHandle(u64); // packed (generation << 32 | index), see R23

#[no_mangle]
pub extern "C" fn font_load(ptr: *const u8, len: u32) -> FontHandle { /* ... */ }
```
**Source:** https://github.com/fitzgen/generational-arena README (design rationale, current).

### R23. Pair every handle with a generation counter and reject stale generations instead of dereferencing
**Why:** a plain slot index is vulnerable to the ABA problem: delete the object at slot `i`, allocate a new one that lands in the same freed slot `i`, and a stale handle from before the delete now silently refers to the wrong live object instead of failing. A monotonically-incrementing generation stored alongside each slot, and checked against the generation embedded in the handle on every lookup, turns that silent wrong-object bug into a checkable "handle is stale, refuse it" branch — which is exactly the use-after-free guard a raw-pointer C ABI has no other way to get.
**Applies to us:** this is the concrete mechanism that makes R21/R22's opaque handles actually catch a host-side use-after-free (e.g. TypeScript calling into a font handle after `font_free` was already called) instead of reading freed/reused memory.
**Bad / Good:**
```rust
// Bad: index alone — a freed-then-reused slot silently answers to the old handle
fn get(&self, idx: u32) -> Option<&Font> { self.slots.get(idx as usize)?.as_ref() }
```
```rust
// Good: generation must match, or the lookup fails instead of aliasing
fn get(&self, handle: FontHandle) -> Option<&Font> {
    let (gen, idx) = handle.unpack();
    let slot = self.slots.get(idx as usize)?;
    (slot.generation == gen).then(|| &slot.value)?
}
```
**Note:** a generation field must be wide enough that reuse-until-wraparound is not a realistic threat for this table's churn rate — a 32-bit generation wrapping is the documented edge case for this pattern.
**Source:** https://github.com/fitzgen/generational-arena README ("What? Why?", ABA problem walkthrough, current); https://github.com/fitzgen/generational-arena/issues/13 (generational-arena vs slotmap trade-offs, wraparound caveat).

### R24. Validate every caller-supplied `(ptr, len)` against current memory bounds and null before constructing a slice
**Why:** `slice::from_raw_parts`'s safety contract requires the pointer be non-null, properly aligned, and valid for `len * size_of::<T>()` bytes within a single allocation — none of which a value arriving from the host is guaranteed to satisfy. In a wasm guest context this is not a hypothetical: a `GuestPtr` "does not imply any form of validity... pointers can be out-of-bounds, misaligned, etc." by construction, because it originates from an untrusted caller, not from Rust's own allocator.
**Applies to us:** every exported function taking a `(ptr, len)` pair from TypeScript must check `ptr != 0`, `len` fits before the current `memory.size` in bytes, and the range doesn't overflow, *before* calling `from_raw_parts` — not after.
**Bad / Good:**
```rust
// Bad: trusts the host completely
#[no_mangle]
pub unsafe extern "C" fn parse(ptr: *const u8, len: u32) -> i32 {
    let data = core::slice::from_raw_parts(ptr, len as usize); // UB if out of bounds
    /* ... */
}
```
```rust
#[no_mangle]
pub unsafe extern "C" fn parse(ptr: *const u8, len: u32) -> i32 {
    if ptr.is_null() { return ErrorCode::NullPointer as i32; }
    let end = match (ptr as usize).checked_add(len as usize) {
        Some(e) if e <= current_memory_bytes() => e,
        _ => return ErrorCode::OutOfBounds as i32,
    };
    let data = core::slice::from_raw_parts(ptr, len as usize);
    /* ... */
}
```
**Source:** https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html (safety contract, current); https://docs.wasmtime.dev/api/wiggle/struct.GuestPtr.html (guest-pointer validity framing, current).

### R25. Use `read_unaligned`/`write_unaligned` for any field read at a caller-supplied byte offset — never assume host-chosen offsets are aligned
**Why:** a byte offset arriving from JavaScript (an array index, a computed offset) carries no alignment guarantee at all — JS has no concept of alignment. Dereferencing a `*const u32` built from such an offset via ordinary `*ptr` read is UB the moment the address isn't a multiple of 4; `core::ptr::read_unaligned`/`write_unaligned` are specified to work correctly on any address.
**Applies to us:** any exported function that lets the host pass a raw byte offset into a shared buffer (as opposed to always handing back a Rust-controlled, alignment-guaranteed handle) needs this — don't assume "it's always been 4-aligned in practice" is a safety argument.
**Bad / Good:**
```rust
// Bad: UB if offset isn't a multiple of 4
let value = unsafe { *(ptr.add(offset) as *const u32) };
```
```rust
let value = unsafe { core::ptr::read_unaligned(ptr.add(offset) as *const u32) };
```
**Source:** https://doc.rust-lang.org/nomicon/ffi.html (Rustonomicon, general FFI-safety framing, current); https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html (alignment as part of the same class of contract, current).

### R26. Don't assume a `repr(C)` struct passed or returned by value matches clang's wasm32 C ABI — Rust has its own, different convention
**Why:** the Rust language team's own design-meeting notes document the mismatch directly: for a `#[repr(C)] struct A(i32, i32)` passed by value, "Rust's approach (wasm32-unknown-unknown): the struct is 'splatted' — decomposed into its component fields and passed as two separate `i32` parameters," while "Clang's approach (wasm32-wasi, emscripten): the struct is passed by indirect reference, appearing as a single `i32` parameter pointing to the data." `repr(C)` guarantees *memory layout* compatibility with C; it does not guarantee *calling-convention* compatibility on wasm32, because wasm32-unknown-unknown's `"C"` ABI and clang's `"C"` ABI for wasm disagree about how aggregates cross function boundaries.
**Applies to us:** since this boundary is Rust-on-both-sides-of-the-declaration (a `pub extern "C" fn` defined in Rust, called from generated/hand-written TypeScript glue that only needs to match *whatever Rust actually emits*, not clang), this is safe to rely on internally — but it means the convention is Rust's own "padded direct" splatting, not literally "the C ABI," and must never be assumed portable to a non-Rust-compiled consumer or a different Rust target.
**Source:** https://github.com/rust-lang/lang-team/blob/main/design-meeting-minutes/2021-04-21-wasm-abi.md (current); https://github.com/rust-diplomat/diplomat/blob/main/docs/wasm_abi_quirks.md ("padded direct" mechanics, padding-typed-as-preceding-field detail, current).

### R27. Return multi-field results through a caller-supplied output pointer (outparam), not a returned aggregate
**Why:** wasm functions natively return only scalars. For an aggregate return, Rust's wasm32 target lowers to an outparam convention: "sufficient space for the struct must be allocated on the wasm heap, and a pointer to this space should be passed in as the last parameter for the function" — the caller allocates, passes the pointer, calls, then reads the populated struct back out. Relying on any other shape for a multi-field return (e.g. assuming it "just returns a struct") doesn't match what actually gets emitted.
**Applies to us:** every exported function that needs to hand back more than one scalar (e.g. a shaped-glyph result with both an advance and an error code) should take an explicit `out: *mut Result` parameter rather than declaring a `-> ResultStruct` return type and hoping the ABI does the right thing.
**Bad / Good:**
```rust
// Ambiguous: relies on the caller knowing Rust's outparam lowering implicitly
#[repr(C)]
pub struct ShapeResult { advance: f32, error: u32 }
#[no_mangle]
pub extern "C" fn shape(ptr: *const u8, len: u32) -> ShapeResult { /* ... */ }
```
```rust
// Explicit: the ABI contract is visible in the signature itself
#[no_mangle]
pub unsafe extern "C" fn shape(ptr: *const u8, len: u32, out: *mut ShapeResult) -> u32 {
    // returns an ErrorCode; writes the result through `out` only on success
}
```
**Source:** https://github.com/rust-diplomat/diplomat/blob/main/docs/wasm_abi_quirks.md ("Return Values and Sret Pointers", current).

### R28. Pack a `(ptr, len)` pair into a single `u64` return instead of reaching for a multi-value `extern "C"` return
**Why:** wasm's native multi-value proposal lets a function return more than one scalar, and Rust can target it via `-C target-feature=+multivalue` — but relying on it for a hand-written `extern "C"` signature means depending on a lowering convention that, per R26, is not the stable/portable C ABI, and per R31 has an active LLVM correctness bug for wide types. Packing `(ptr << 32) | len` into one `u64` sidesteps both problems entirely: it's a single scalar, needs no outparam allocation, and has no multivalue-specific codegen path to miscompile.
**Applies to us:** the common "return a byte span" shape (a baked-atlas output, a shaped-run buffer) should use this instead of either an outparam struct (R27, fine but needs a caller-side allocation) or a raw multivalue return (avoid, per R31).
**Bad / Good:**
```rust
// Avoid: depends on multivalue lowering being present and correctly compiled
#[no_mangle]
pub extern "C" fn bake(ptr: *const u8, len: u32) -> (u32, u32) { /* (out_ptr, out_len) */ }
```
```rust
// Good: single scalar return, no multivalue dependency
#[no_mangle]
pub extern "C" fn bake(ptr: *const u8, len: u32) -> u64 {
    let (out_ptr, out_len): (u32, u32) = /* ... */;
    ((out_ptr as u64) << 32) | out_len as u64
}
```
**Source:** https://github.com/WebAssembly/binaryen README ("Experiments show that better support for multivalue could enable useful but small code size savings of 1-3%", current — i.e. even Binaryen's own maintainers rate multivalue's benefit as marginal, which is the case *for* bit-packing over chasing multivalue support).

### R29. Never rely on multivalue or wide (`u128`/`i128`) `extern "C"` returns on wasm32 for correctness-critical code
**Why:** an open, confirmed miscompilation exists where "correct Rust code lowers to incorrect machine code" when the `multivalue` target feature is combined with optimizations and a wide return type — a minimal reproduction returning `Option<u128>` and combining two 111s with `unwrap_or_default()` silently produces `111` instead of `333`. This is categorized as an LLVM-level bug in the wasm backend, not a Rust-level one, and remains open.
**Applies to us:** combined with R28 (bit-pack narrow pairs instead of using multivalue) and R26 (Rust's wasm ABI isn't the portable C ABI anyway), this rules out `u128`/`i128` anywhere near a multivalue-eligible `extern "C"` return on this target — reserve wide integers for internal-only, non-exported computation.
**Source:** https://github.com/rust-lang/rust/issues/127318 ("Wasm32 miscompilation when using u128 with multivalue and optimizations", open, C-external-bug).

### R30. Every allocate function needs an exact-ownership free function that reconstructs the *original* `Layout`
**Why:** `GlobalAlloc::dealloc` (and, transitively, `Vec::from_raw_parts`) requires the layout passed at deallocation to match the layout used at allocation exactly — not just the element type, but the exact size *and alignment*. A documented failure mode: allocate a buffer at alignment 2 (e.g. backing a `Vec<u16>`), hand it across the boundary, then reconstruct it on free as a `Vec<u8>` (alignment 1) — the mismatched alignment on `dealloc` corrupts the allocator's internal structures. Reconstructing from `(ptr, len)` alone is never sufficient when the original allocation's *capacity* differed from its length, or when the element type on free doesn't match the element type at allocation.
**Applies to us:** every "allocate an output buffer, hand `(ptr, len)` to the host, host later calls a `free` export" pattern in this codebase must pass back everything needed to reconstruct the exact original `Vec`/`Layout` — capacity included, not just length — or must use a fixed, single element type/alignment for every buffer this free function ever accepts.
**Bad / Good:**
```rust
// Bad: reconstructs a Vec from length alone; if the original had extra capacity,
// or a different element type, this deallocates with the wrong Layout — UB.
#[no_mangle]
pub unsafe extern "C" fn free_buf(ptr: *mut u8, len: u32) {
    drop(Vec::from_raw_parts(ptr, len as usize, len as usize)); // capacity guessed!
}
```
```rust
// Good: capacity is round-tripped through the handle/header, not guessed
#[no_mangle]
pub unsafe extern "C" fn free_buf(ptr: *mut u8, len: u32, cap: u32) {
    drop(Vec::from_raw_parts(ptr, len as usize, cap as usize));
}
```
**Source:** https://doc.rust-lang.org/std/vec/struct.Vec.html (`from_raw_parts` safety contract, current); https://users.rust-lang.org/t/why-does-vec-from-raw-parts-require-same-size-and-not-same-size-capacity/73036 (alignment-mismatch failure mode, practitioner discussion).

### R31. No function exposed across the C ABI may unwind — design every export to be panic-free by construction, don't lean on catching a panic at the boundary
**Why:** unwinding across a plain `"C"` extern boundary is undefined behavior by rustc's own model (LLVM is permitted to assume such functions can't unwind and optimize accordingly); this repo's `panic = "abort"` setting already converts any escaping panic into a hard process abort rather than UB, which is correct — but it also means `catch_unwind` is not an available safety net at the boundary at all: its own documentation states "this function *only* catches unwinding panics, not those that abort the process," i.e. under `panic = "abort"` it catches nothing.
**Applies to us:** combined with R18, the only viable strategy is prevention, not recovery — every exported function's *entire* transitive call graph must be free of panicking paths, because there is no `catch_unwind`-shaped rescue available once `panic = "abort"` is set repo-wide.
**Bad / Good:**
```rust
// Bad: assumes catch_unwind saves you — it does nothing under panic = "abort"
#[no_mangle]
pub extern "C" fn shape(ptr: *const u8, len: u32) -> i32 {
    std::panic::catch_unwind(|| shape_impl(ptr, len)).unwrap_or(-1) // never catches anything here
}
```
```rust
// Good: shape_impl itself cannot panic — verified by construction (R18), not caught
#[no_mangle]
pub extern "C" fn shape(ptr: *const u8, len: u32) -> i32 {
    shape_impl(ptr, len) // returns a status code on every path, never panics
}
```
**Source:** https://doc.rust-lang.org/std/panic/fn.catch_unwind.html ("only catches unwinding panics, not those that abort the process", current); https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html (unwinding-across-`extern "C"`-is-UB framing, current RFC).

### R32. Don't reach for the `"C-unwind"` ABI in this codebase
**Why:** `"C-unwind"` exists specifically to let a panic (or a foreign C++ exception) *propagate* across an `extern` boundary instead of aborting — its RFC motivates it with cases like "WebAssembly interpreters" and libraries wrapping C++ that need cross-language exception propagation. That is the opposite of what this project needs: with `panic = "abort"` set repo-wide and a browser host that has no concept of unwinding into it, the correct behavior for an escaping panic is exactly what plain `"C"` already gives — a hard abort — not a propagated unwind.
**Applies to us:** if a future contributor hits the "unwinding across `extern "C"` is UB" lint/warning and reaches for `"C-unwind"` to make the warning go away, that is the wrong fix — the right fix is eliminating the panicking path (R18/R31), because `"C-unwind"` under `panic = "abort"` still aborts on an incoming foreign unwind (per the RFC), so it buys nothing here beyond what plain `"C"` already provides, while inviting contributors to think unwinding-through is a supported recovery path.
**Source:** https://rust-lang.github.io/rfcs/2945-c-unwind-abi.html (motivating use cases, `panic = "abort"` + `"C-unwind"` behavior, current RFC).

### R33. Signal errors via a sentinel return value plus a side-channel accessor — never via panic, even one you intend to "catch"
**Why:** given R31 (no `catch_unwind` safety net under `panic = "abort"`), the only remaining channel to report failure across the boundary is the return value itself (or an out-parameter status). A common, checkable shape: every exported function returns a small integer status/error code (0 = success, negative/nonzero = a specific `ErrorCode` variant cast to its representation), and a separate exported accessor (e.g. `last_error_message() -> (ptr, len)`) lets the host pull a human-readable detail only when it actually wants one, instead of the hot path paying for message construction on every call.
**Applies to us:** this is the concrete replacement for "just panic and let the host figure it out" — every `pub extern "C" fn` in this codebase's exported surface should be auditable against "does its signature include a way to report failure that isn't panicking."
**Bad / Good:**
```rust
// Bad: only signals success; any internal failure has nowhere to go but panic
#[no_mangle]
pub extern "C" fn load_font(ptr: *const u8, len: u32) -> FontHandle { /* ... */ }
```
```rust
#[no_mangle]
pub unsafe extern "C" fn load_font(ptr: *const u8, len: u32, out: *mut FontHandle) -> i32 {
    match load_font_impl(ptr, len) {
        Ok(h) => { *out = h; 0 }
        Err(e) => e.code(), // nonzero; detail retrievable via last_error_message()
    }
}
```
**Source:** synthesized from R18/R31's constraints (`catch_unwind` unavailability under `panic = "abort"`, https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) applied to this project's stated ABI shape — general practice for panic-free C ABIs, "applies to us" throughout.

### R34. Revalidate every host-side cached view into wasm memory after any call that can allocate
**Why:** `WebAssembly.Memory` grows by discarding the backing `ArrayBuffer` and creating a new, larger one — any JavaScript `TypedArray`/`DataView` still referencing the old buffer becomes permanently detached, and any raw numeric pointer the host cached from a previous call now indexes into memory that may no longer even belong to the same logical allocation. This isn't theoretical: a real browser (Ladybird) shipped a security advisory for exactly this class of bug, where a cached typed-array data pointer kept pointing into freed memory after `memory.grow()`, giving "a one-line arbitrary read and write into kfree'd memory."
**Applies to us:** the TypeScript binding layer around this engine must never hold a `Uint8Array`/`DataView` (or a raw numeric offset treated as globally valid) across a call boundary without checking `memory.buffer.byteLength` first — any Rust-side function that allocates (which, given talc backs every wasm boundary, is most of them) is a potential growth point.
**Bad / Good:**
```javascript
// Bad: view cached once, reused after calls that may have grown memory
const bytes = new Uint8Array(instance.exports.memory.buffer);
instance.exports.shape(ptr, len); // may grow memory, detaching `bytes`
readFrom(bytes, outPtr); // TypeError: Cannot perform ... on a detached ArrayBuffer
```
```javascript
// Good: revalidate/re-wrap after any call that can allocate
let bytes = new Uint8Array(instance.exports.memory.buffer);
function view() {
  if (bytes.buffer !== instance.exports.memory.buffer) {
    bytes = new Uint8Array(instance.exports.memory.buffer);
  }
  return bytes;
}
instance.exports.shape(ptr, len);
readFrom(view(), outPtr);
```
**Source:** https://awesome.red-badger.com/chriswhealy/memory-grow-and-arraybuffers (mechanism + mitigation pattern, practitioner writeup); https://github.com/LadybirdBrowser/ladybird/security/advisories/GHSA-w89h-j2xg-c457 (real-world cached-pointer-after-grow vulnerability).

### R35. Document, per export, which functions can trigger a memory grow — don't leave the host guessing
**Why:** R34's mitigation only works if the host binding layer actually knows *when* to revalidate. Since every allocating call is a potential growth point but not every export allocates (a pure getter over an already-loaded font doesn't), an undocumented boundary forces the host to either revalidate defensively before every single call (safe but wasteful) or guess (unsafe).
**Applies to us:** a concrete, checkable convention — e.g. a naming suffix, a doc comment tag, or a generated manifest alongside the `.wasm` output — that marks which exports may allocate, so the TypeScript glue can revalidate only where it's actually needed instead of everywhere or nowhere.
**Source:** general practice extending R34's mechanism; https://awesome.red-badger.com/chriswhealy/memory-grow-and-arraybuffers (same source, applied as a boundary-documentation discipline rather than just a runtime check).

### R36. Do not adopt the WebAssembly Component Model or WASI for this browser-targeted library
**Why:** as of 2026 the Component Model and WASI Preview 2/0.3 ecosystem is real and shipping, but its entire momentum is server/edge-runtime-focused (Wasmtime, serverless platforms) — industry surveys of the 2025-2026 wasm landscape discuss Component Model and WASI exclusively in an "outside the browser" context, with zero browser engine shipping native support for either. Component Model tooling (WIT, the canonical ABI, `wasm-tools component`) targets composing modules across languages via generated bindings — a different problem than this project's, which already owns both sides of a single Rust↔TypeScript boundary directly.
**Applies to us:** the hand-written raw C-ABI boundary this project already uses (pointer/length pairs, manual ownership, opaque handles) *is* the standard, correct pattern for a browser-targeted wasm32-unknown-unknown library in 2026 — adopting WIT/component tooling would add a canonical-ABI lowering layer (with its own size and complexity cost) to solve a cross-language-composition problem this project doesn't have, since the consumer is always hand-written or generated TypeScript, never another wasm component.
**Source:** https://platform.uno/blog/the-state-of-webassembly-2025-2026/ (2025-2026 state-of-wasm survey, Component Model/WASI framed as non-browser, current); https://github.com/bytecodealliance/wasm-tools README (`component` subcommands operate on WIT-described components, a separate object model from a plain core wasm module, current).

### R37. Know that `multivalue` and `reference-types` are default-on target features since Rust 1.82 (October 17, 2024) — but don't chase them as a size lever
**Why:** the official Rust blog announced that both proposals became default-enabled for `wasm32-unknown-unknown` in Rust 1.82, with the explicit compatibility warning that "any WebAssembly module with an indirect function call... will produce a WebAssembly binary that cannot be decoded by engines and tooling that do not support the reference-types proposal." Separately, Binaryen's own maintainers measured multivalue's *size* upside at only "1-3%" even with better internal support — it is a minor lever, not a major one, and (per R29) has an open correctness bug for wide types.
**Applies to us:** two independent, checkable consequences: (1) verify the actual minimum browser/engine versions this project claims to support all shipped reference-types + multivalue (Chrome 96+/Firefox 79+/Safari 15+ per current support tables) — this is now the *default*, not an opt-in, so "we didn't use multivalue" is not a valid reason to skip that check; (2) if compatibility with a pre-reference-types engine is ever required, the escape hatch is `RUSTFLAGS="-Ctarget-cpu=mvp"` combined with `-Z build-std` to recompile `std` itself against the older feature set — which, per R6, is a nightly-only path not available on this stable-pinned toolchain today.
**Source:** https://blog.rust-lang.org/2024/09/24/webassembly-targets-change-in-default-target-features/ (official Rust blog, 2024-09-24); https://github.com/WebAssembly/binaryen README (1-3% multivalue size-savings measurement, current); https://caniuse.com/wasm-reference-types and https://caniuse.com/wasm-multi-value (current browser support tables).
