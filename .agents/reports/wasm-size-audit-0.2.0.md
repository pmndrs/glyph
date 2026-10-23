# Glyph text-shaper Wasm size audit

**Snapshot:** 11 October 2026  
**Revision audited:** `main` at `2f62d6bae1da688904dfd1aba40b0ed507262824`  
**Authoritative package:** CI run [38096962674](https://github.com/pmndrs/glyph/actions/runs/38096962674), artifact `11687095277`

This is a read-only audit of the current-main **text-shaper Wasm binary only**. It does not measure the other shipped Wasm modules, JavaScript, or whole-package delivery size. The release-wide 0.1.0 comparison and package/version preparation were still open in the roadmap at this snapshot.

## Shipped binary

| Measure                |                                                         CI package |                                          Independent local rebuild |
| ---------------------- | -----------------------------------------------------------------: | -----------------------------------------------------------------: |
| Raw `text-shaper.wasm` |                                                        1,456,090 B |                                                        1,456,306 B |
| SHA-256                | `dc0d918f28e67591417ecd29c86d442b9fc8d703a992781fc25803b05f415403` | `81d395325ef756a1c3afea4eaa722d9190cb7862c4eb6058e697d0227bcee21b` |
| gzip-9                 |                                                          534,013 B |                                                          533,899 B |
| Brotli-11              |                                                          420,940 B |                                                          421,405 B |

The local build differs by 216 raw bytes, so the exact CI artifact is the release-size reference. Its sections are 1,161,104 bytes of code (about 80%), 291,747 bytes of data (about 20%), and roughly 3.2 KB of other sections. The module contains 886 functions, 61 types, and 37 exports.

## Approximate code ownership

An optimized names-retained build with production optimization flags was analyzed with Twiggy, then compared with the stripped module. Function-owner totals are estimates, not an additive ledger: about 10 KB is not assigned cleanly, and static data cannot be reliably attributed by crate.

| Optimized symbol owner       | Approx. bytes | Notes                                                                                                                      |
| ---------------------------- | ------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Glyph shaper and `slug-core` |       564,908 | First-party implementation, including ABI wrappers                                                                         |
| HarfRust                     |       334,328 | Shaping implementation                                                                                                     |
| Rust `core`                  |       135,530 | `no_std` core-library symbols and concrete instantiations; not `std` or a direct monomorphization measurement              |
| `read-fonts`                 |        84,012 | Font parsing and tables                                                                                                    |
| Rust `alloc`                 |        16,940 | Heap-backed collection and allocation API support; the allocator implementation is separate                                |
| Other named crates           |   about 6,800 | `smallvec`, **`talc`**, Unicode crates, `font-types`, math support; per-crate splits were not reliable in this attribution |
| Ambiguous/builtins           |        28,616 | Twiggy could not assign these cleanly by symbol prefix                                                                     |
| Static data (`.rodata`)      |       291,961 | Present in final data section; crate ownership is unclear                                                                  |

The largest first-party function bodies include:

| Function                                      | Approx. bytes |
| --------------------------------------------- | ------------: |
| `ParagraphState::prepare`                     |        65,324 |
| `wasm::update`                                |        37,926 |
| `RenderPlanCompiler::prepare`                 |        31,789 |
| `PlannerState::prepare_upsert`                |        29,944 |
| `pmndrs_glyph_shaper_register_font`           |        27,871 |
| `ParagraphState::prepare_geometry_and_layout` |        26,763 |
| `append_paragraph_measurement`                |        25,797 |
| `engine_register_codec`                       |        21,455 |

The first six total about 218 KB. They are concrete audit targets, but large functions alone do not prove duplication or safe savings.

## SIMD and optimization passes

A scalar control build used the same source and release settings with the shipping SIMD feature and target flag disabled. Compared with the local SIMD build, it was 2,638 bytes smaller raw (under 0.2% of the binary); gzip was 666 bytes larger and Brotli was 3,055 bytes smaller. This was a size-only probe, not a runtime comparison. SIMD is not a meaningful large-size reduction lever here; retain or remove it based on representative performance evidence.

The release profile already uses LTO, one codegen unit, aborting panics, and stripping. The package build runs Binaryen `-Oz` and `--merge-similar-functions` twice. On the local raw build, those passes removed 145,399 bytes (about 9.1%) and 464 functions.

### `no_std`, `alloc`, and the allocator

The shipping build uses `--no-default-features`; the shaper crate is compiled without its `std` feature. That removes Rust `std`, but it does not remove Rust `core`: `no_std` programs still link the `core` library. The 135,530-byte Twiggy estimate is code attributed to `core` symbols in this optimized module, not a mandatory fixed-size `core` payload and not a measure of generic expansion alone. Its exact savings require function-level experiments against the same Wasm build.

The shaper also explicitly imports Rust `alloc` and uses heap-backed types such as `Vec`, `Box`, and `BTreeMap`. `alloc` supplies those Rust APIs and collection implementations; **it is not the allocator that obtains memory**. On Wasm, `wasm.rs` registers `talc::wasm::WasmDynamicTalc` with `#[global_allocator]`, so allocations made through `alloc` are served by Talc. Replacing Talc would not remove the `alloc` APIs or their collection code. The audit did not isolate Talc's exact function bytes from the other small named crates.

HarfRust is present because this artifact performs runtime text shaping with HarfRust: the shaper imports its `ShapePlan`, `ShaperData`, `UnicodeBuffer`, glyph buffer, flags, and font interfaces. `read-fonts` provides the corresponding font-table access. Removing HarfRust would mean replacing or substantially reimplementing that shaping engine; it is not an accidental package dependency.

Thus the figures above are all from the text-shaper Wasm, but their attribution is approximate. The 135,530-byte `core` figure should be read as “optimized functions attributed to Rust `core`,” not “the Rust standard library we forgot to disable.”

## Where to investigate next

1. Measure and simplify first-party preparation/update/render-plan paths, looking for repeated validation, duplicated state handling, and cold branches. Verify optimized Wasm size and runtime behavior; source-line reduction alone is not evidence of a smaller binary.
2. Re-test first-party Unicode table and data-layout alternatives against the exact current revision. Older size numbers are historical and need fresh correctness, runtime, and artifact measurements.
3. Probe HarfRust feature reductions only against explicit product support requirements; removing script support for size alone risks shaping regressions.
4. Keep SIMD decisions tied to runtime wins; the size delta is negligible.

The audit does not support “there is no room left to shrink Wasm.” It also does not prove a particular cut is safe or worthwhile. Each proposal needs an isolated exact-head correctness, performance, and size comparison.

## Validation limits

- The current-main CI run passed all five jobs. Its package artifact is authoritative for the listed shipping sizes.
- The independent local binary differed by 216 raw bytes; local attribution and compression figures are therefore diagnostic, not substitutes for the CI package.
- Twiggy function ownership is approximate; the function estimates do not add up exactly to the code section, and static data ownership is unresolved.
- The SIMD comparison measures size only.
- Green CI and this binary audit do not establish release-wide parity with published 0.1.0. At this snapshot, the roadmap still required that full comparison and package/version preparation.
