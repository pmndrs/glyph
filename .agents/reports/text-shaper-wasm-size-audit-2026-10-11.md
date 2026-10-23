# Text-shaper Wasm size audit

**Audited revision:** `main` at `2f62d6bae1da688904dfd1aba40b0ed507262824`  
**Artifact:** CI package from [run 38096962674](https://github.com/pmndrs/glyph/actions/runs/38096962674), artifact `11687095277`  
**Scope:** `text-shaper.wasm` only; this is not a whole-package or release-size comparison.

## Findings

The text-shaper is built as `no_std`, but it is not a no-allocation program. It uses Rust `alloc` collections, and its Wasm entry point installs Talc as the global allocator. `alloc` is the collection/API layer; Talc supplies the allocator. The audited binary still contains optimized `core` functions because `core` is the Rust language foundation used by `no_std` programs. The measured 135,530 bytes attributed to `core` are not the `std` library and are not a measurement of generic expansion alone.

HarfRust is an intentional runtime dependency: the shaper registers font data, builds HarfRust shaping state and plans, and calls its shaping API. It is not an accidental dependency pulled in by tests. `read-fonts` supplies SFNT table access used by registration and outline queries.

The dominant size opportunities are first-party shaper/engine code and static data, followed by HarfRust and font parsing. The current evidence does not quantify how much of the `core` bucket is monomorphization, nor does it prove that replacing Talc would materially shrink the artifact.

## Shipped artifact

| Measure   |                                                         CI package |                                          Independent local rebuild |
| --------- | -----------------------------------------------------------------: | -----------------------------------------------------------------: |
| Raw Wasm  |                                                        1,456,090 B |                                                        1,456,306 B |
| SHA-256   | `dc0d918f28e67591417ecd29c86d442b9fc8d703a992781fc25803b05f415403` | `81d395325ef756a1c3afea4eaa722d9190cb7862c4eb6058e697d0227bcee21b` |
| gzip-9    |                                                          534,013 B |                                                          533,899 B |
| Brotli-11 |                                                          420,940 B |                                                          421,405 B |

The local build differs by 216 raw bytes, so the CI package is the authoritative shipping measurement. Its module sections contain 1,161,104 bytes of code (about 80%), 291,747 bytes of data (about 20%), and about 3.2 KB of other sections. The module has 886 functions, 61 types and 37 exports.

## Approximate code attribution

These estimates come from Twiggy on an optimized, names-retained build with the production flags, checked against the stripped release module. They are not a byte-perfect partition: approximately 10 KB is not assigned cleanly, and data-section bytes cannot be attributed reliably by crate.

| Symbol owner                 | Approx. bytes | Interpretation                                                                                                  |
| ---------------------------- | ------------: | --------------------------------------------------------------------------------------------------------------- |
| Glyph shaper and `slug-core` |       564,908 | First-party runtime and ABI code                                                                                |
| HarfRust                     |       334,328 | Runtime text-shaping engine                                                                                     |
| Rust `core`                  |       135,530 | Optimized core-library symbols and concrete instantiations; not `std`, not a monomorphization total             |
| `read-fonts`                 |        84,012 | Runtime font-table access                                                                                       |
| Rust `alloc`                 |        16,940 | Collection/allocation API implementation; allocator is separate                                                 |
| Other named crates           |   about 6,800 | Includes Talc, Unicode crates, `smallvec`, `font-types` and math support; individual attribution is approximate |
| Ambiguous/builtins           |        28,616 | Symbols Twiggy could not assign cleanly                                                                         |
| Static data (`.rodata`)      |       291,961 | Unicode tables and other constants are candidates; exact source ownership was not resolved                      |

Largest first-party function bodies include `ParagraphState::prepare` (65,324 B), Wasm `update` (37,926 B), `RenderPlanCompiler::prepare` (31,789 B), `PlannerState::prepare_upsert` (29,944 B), font registration (27,871 B), and `ParagraphState::prepare_geometry_and_layout` (26,763 B). These identify places to inspect; function size alone does not establish duplication or safe savings.

## What the source confirms

- The shaper crate declares `default = ["std"]`, but the package build passes `--no-default-features`. The crate root then enables `#![no_std]` and explicitly imports `alloc`.
- The runtime directly uses `Vec`, `Box`, and `BTreeMap`. These need allocation but do not require `std`.
- `wasm.rs` installs `talc::wasm::WasmDynamicTalc` with `#[global_allocator]`. Replacing Talc would not remove the `alloc` collection code; it would replace the allocator implementation and needs an artifact-size and performance measurement.
- HarfRust calls are visible in the runtime code: `FontRef::new`, `ShaperData::new`, `ShapePlan`, `UnicodeBuffer`, and `shaper.shape(...)` are used in font registration and `shape_segment`.
- The shipping dependency graph includes HarfRust, `read-fonts`, `unicode-bidi`, `unicode-segmentation`, `serde_json` with `alloc`, `slug-core`, and target-specific Talc. Cargo's build dependency (`serde_json` with `std`) and dev dependencies (`flate2`, `skrifa`) are separate from the Wasm runtime graph.
- The release profile uses LTO, one codegen unit, aborting panics and stripping; the package build then runs Binaryen `-Oz` and merge-similar-functions twice. Those are already substantial size-optimization steps.

Source references: [shaper manifest](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/rust/shaper/Cargo.toml#L18-L47), [crate root and HarfRust imports](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/rust/shaper/src/lib.rs#L1-L35), [font registration](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/rust/shaper/src/lib.rs#L203-L279), [shaping call](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/rust/shaper/src/lib.rs#L406-L455), [Wasm allocator](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/rust/shaper/src/wasm.rs#L1-L35), and [build/optimization flags](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/scripts/build.mjs#L235-L248) / [Binaryen passes](https://github.com/pmndrs/glyph/blob/2f62d6bae1da688904dfd1aba40b0ed507262824/packages/glyph/scripts/build.mjs#L296-L307).

## SIMD and generic expansion

A scalar control build with the same source and release settings, but with the shipping SIMD feature and target feature disabled, was 2,638 bytes smaller raw than the local SIMD build (under 0.2% of the module). gzip was 666 bytes larger; Brotli was 3,055 bytes smaller. This was a size-only probe. SIMD should be retained or removed based on representative runtime evidence, not as a meaningful size-cut lever.

The 135,530-byte `core` figure is a symbol-owner estimate. It can include concrete instantiations reached through this program, but the audit did not isolate generic monomorphization. Treating all of that bucket as removable generic bloat would be incorrect. A defensible monomorphization estimate requires controlled builds or compiler-level item reports, then comparison of final optimized Wasm size and behavior.

## Recommended next size probes

1. Reduce or consolidate first-party preparation, layout, publication, and ABI code, validating that the same runtime paths remain covered. This is the largest identified code-owner bucket.
2. Measure Unicode data alternatives as a separate experiment; static data is about one fifth of the binary and is not explained by crate symbol attribution.
3. Test HarfRust feature reductions only against explicit shaping-support requirements and Unicode conformance tests.
4. Probe allocator substitutions only if they preserve the current allocation behavior and improve final Wasm size or runtime performance. `alloc` and Talc solve different jobs.
5. Keep SIMD decisions tied to timing. Its measured size delta is negligible.

No result here supports the claim that the text-shaper is already irreducible. The audit also does not establish that any particular reduction is safe or worth shipping; each change needs an exact-artifact correctness, runtime and size comparison.

## Limits

The CI module is authoritative for delivery size. Local compressed sizes and Twiggy ownership are diagnostic; the local raw build differs by 216 bytes. Twiggy attribution is approximate and does not account for all code or assign the data section. The SIMD comparison measures size only. No per-generic expansion total was produced. These figures concern the text-shaper Wasm alone, not other Wasm modules, TypeScript, or total package size.
