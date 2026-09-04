---
type: Audit Report
title: Rust review — SIMD kernels and the codec/wire system
description: Findings from the SIMD kernels and the codec/wire system review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, simd, codec, kernels]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# SIMD kernels and codec/wire — deep review

Scope: `shaper/src/engine/{kernel_lab,line_kernels,cluster_state,codec,codec_gather,codec_wire,semantic_wire}.rs`,
`mtsdf-core/src/{math,distance}.rs`, plus every other `core::arch::wasm32` site found by grep. Review only, no edits.
All line numbers verified against the working tree at review time.

## Build-tier map (read this first — it changes severity)

Not everything in scope ships. Three tiers exist, and conflating them inflates severity:

| Tier | Files / functions | Gate | Ships in `dist/text-shaper.wasm`? |
|---|---|---|---|
| Production | `line_kernels.rs` (`next_transition`, `for_each_flagged`), `cluster_state.rs` (`sum_advance_units`, `summarize_unit_chunks`), `codec.rs` (`execute_simd_records`, `write_simd_outputs`) | `cfg(all(target_arch="wasm32", feature="simd128"))`, no other gate | Yes |
| Benchmark lab | `kernel_lab.rs` (whole module), the `_grouped`/`*_i64`/checksum wrappers in `line_kernels.rs` | `#[cfg(feature = "kernel-lab")]` (`shaper/Cargo.toml:21`, not in `default = ["std"]`) | No — separate binaries under `target/kernel-lab/` (`packages/glyph/scripts/build-engine-kernel-lab.mjs:21-24`) |
| mtsdf experiments | `mtsdf-core/src/math.rs` (`quantize_unorm4`), `distance.rs` (`line_distance_tile_simd`) | `simd128-experiment`, `adjacent-texel-simd-experiment` (`mtsdf-core/Cargo.toml:14,17`) | No — not default, not referenced by any build script or workflow (verified: zero hits for these feature names outside `mtsdf-core`/`mtsdf-baker` `Cargo.toml`) |

Findings below are ordered by severity, but tier matters more than the table suggests: S1 and S2 are Production-tier, everything else is lower-stakes by construction.

## S1 — Codec SIMD batch discards a whole 4-record group on one non-finite lane; scalar discards only the offending record
**Severity:** medium   **File:** `shaper/src/engine/codec.rs:1279-1390` (SIMD) vs `codec.rs:1156-1263` (scalar), dispatched from `codec.rs:1074-1108`

**What:** `execute_program` runs `execute_simd_records` over `completed = record_count & !3` records in groups of 4, then falls through to `execute_record` one at a time for the tail (`codec.rs:1096`). Both paths check `StoreF32` output for non-finite values and return `CodecExecutionError::NonFiniteOutput`. The scalar check (`codec.rs:1231`) tests one `f32`. The SIMD check (`codec.rs:1369`, via `simd_f32_is_finite` at `codec.rs:1488`) tests all 4 lanes with `.all(...)` — if *any* lane in the group is non-finite, the whole group errors before `write_simd_outputs` (`codec.rs:1381`) is called for that group, even for lanes that were individually finite.

Because `write_simd_outputs` for one group is called only *after* every operation for all 4 records in that group has run, a group is all-or-nothing: either all 4 records' outputs are written, or none are. The scalar loop is record-at-a-time: it writes every record strictly before the one that fails.

**Why it matters:** Take `record_count = 15`, and suppose record 9 (inside SIMD group `[8..12)`) is the first record whose computed output overflows to infinity (e.g. two large-but-finite semantic inputs multiplied by a codec constant in `MultiplyF32`/`AddF32`). Both builds ultimately return `Err(NonFiniteOutput)` — that part is consistent, since the same arithmetic on the same bits (see "Verified correct" below) means both builds necessarily agree on *whether* an error occurs and at which record it first occurs. What differs is how much of `outputs` got written before the error:
- Scalar build: records 0-8 written (9 records), record 9 fails, records 10-14 never attempted.
- Explicit-SIMD build: groups `[0,4)` and `[4,8)` succeed and are written (8 records), group `[8,12)` fails as a whole — record 8, individually finite, is **not** written even though scalar would have written it.

So the two builds leave a different number of valid records in the output buffer on this error path — a real bit-for-bit divergence in shipped code, not merely a performance difference.

Non-finite output is reachable, not theoretical: `codec_gather.rs`'s `validate_semantic_shape` (`codec_gather.rs:871-875`) rejects non-finite *inputs* at gather time, and `validate_operation`'s `ConstantF32` check (`codec.rs:1736`) rejects non-finite *constants*, but neither prevents `AddF32`/`SubtractF32`/`MultiplyF32` from overflowing two large finite operands to `±Infinity` at run time — which is exactly why the runtime `NonFiniteOutput` check exists at all.

**Blast radius (why not high):** I traced every caller of `ValidatedCodec::execute`/`execute_buffers`. The only production caller is `plan_packing.rs:194-208`, whose error propagates through `PackingError::Codec` → `PlanError::CodecExecution` → `RenderPlanCompilerError::Plan` (`render_plan_compiler.rs:78-89`, which explicitly classifies `NonFiniteOutput` as *not* a retry-with-more-capacity case). `state.rs` implements `prepare`/`commit`/`abort` as an explicit transaction: `abort_pending`/`abort_update` (`state.rs:1468-1482`, `state.rs:1995-2007`) reset `self.plan` (the `RenderPlanCompiler` holding the payload buffer), and a caller can only ever reach `prepared_plan` (`state.rs:1404-1423`) with a `PreparedUpdate` token that is minted only on the success path. So under the engine's own contract, nothing downstream reads the partially-written buffer after an `Err` — this keeps the divergence from being externally observable through the supported API today. The other caller, `kernel_lab.rs:689-702`'s `exported_codec`, is `kernel-lab`-feature-gated (non-shipping).

**Before / After:**
```rust
// Before — codec.rs:1279-1390 (abridged): a failing lane aborts the call, discarding
// the whole group including any already-finite lanes in it.
let completed = inputs.record_count & !3;
for input_record in (0..completed).step_by(4) {
    let mut registers = [u32x4_splat(0); MAX_REGISTERS];
    let mut values = [u32x4_splat(0); MAX_OUTPUT_LANES];
    for (operation_index, operation) in program.operations.iter().enumerate() {
        /* ... */
        Operation::StoreF32 { source, lane, .. } => {
            let value = registers[usize::from(source)];
            if !simd_f32_is_finite(value) {
                return Err(CodecExecutionError::NonFiniteOutput); // aborts the whole call
            }
            values[store_slot(execution, operation_index, lane)] = value;
        }
        /* ... */
    }
    write_simd_outputs(program, &values, output_start + input_record, outputs, active_buffers);
}
Ok(completed)
```
```rust
// After — sketch: stop before the failing group instead of erroring out of the whole
// call, and let the caller's existing scalar tail (codec.rs:1096, unchanged) re-run
// that group one record at a time. This is the same "SIMD skip-ahead, scalar finds the
// exact boundary" idiom line_kernels.rs already uses for next_transition_simd
// (line_kernels.rs:42-62) — it doesn't need a new pattern, just this kernel adopting one
// the codebase already trusts.
let completed = inputs.record_count & !3;
let mut written = 0_usize;
'groups: for input_record in (0..completed).step_by(4) {
    let mut registers = [u32x4_splat(0); MAX_REGISTERS];
    let mut values = [u32x4_splat(0); MAX_OUTPUT_LANES];
    for (operation_index, operation) in program.operations.iter().enumerate() {
        /* ... */
        Operation::StoreF32 { source, lane, .. } => {
            let value = registers[usize::from(source)];
            if !simd_f32_is_finite(value) {
                break 'groups; // hand this group to the scalar tail below instead
            }
            values[store_slot(execution, operation_index, lane)] = value;
        }
        /* ... */
    }
    write_simd_outputs(program, &values, output_start + input_record, outputs, active_buffers);
    written = input_record + 4;
}
Ok(written) // execute_program's existing tail loop resumes here and fails at the exact
            // record the scalar-only build would, writing the same prefix.
```
No change to `execute_program`'s caller-facing contract or its tail loop (`codec.rs:1096`) is needed — only `execute_simd_records`'s early-return changes from "error immediately" to "stop and let the scalar tail catch it."

**Confidence:** certain for the divergence itself (traced both paths operation-by-operation, and the group/record write boundaries are unambiguous in the code as written). Likely (not certain) that it is unobservable today — that rests on every caller of `execute_program` going through the `prepare`/`abort` transaction I traced; I did not exhaustively audit every future call site this might grow. A property test that runs the same codec program with inputs engineered to overflow at a chosen record index, once against the scalar-only build and once against the explicit-SIMD build, and diffs the output buffers on `Err`, would confirm both the divergence and the fix.

## S2 — The only kernel-lab coverage for the chunk-64 accumulator sum tests a duplicate, not the production function
**Severity:** medium   **File:** `shaper/src/engine/cluster_state.rs:56-92` vs `shaper/src/engine/kernel_lab.rs:276-301`

**What:** `cluster_state.rs`'s production `sum_advance_units` (SIMD arm at `cluster_state.rs:57-86`, `ACCUMULATORS = 4` fixed) and `kernel_lab.rs`'s benchmark-only `chunk_sum_i64_simd::<ACCUMULATORS>` (`kernel_lab.rs:276-301`) are **not the same function** — they are two independently-maintained, line-for-line-equivalent copies of the same accumulator-tree reduction. `kernel_lab.rs:224-225`'s own doc comment even says this is "matching the production lane width," acknowledging the duplication rather than sharing code.

Contrast with `line_kernels.rs`, which gets this right: production's `next_transition` (`line_kernels.rs:12-24`) and the kernel-lab-only `next_transition_grouped` (`line_kernels.rs:27-39`) both call the *same* `next_transition_simd::<GROUPS>` (`line_kernels.rs:42`) — production simply instantiates it at `<1>`. There is exactly one implementation, and the kernel-lab harness exercises the literal production code path at other widths as a side effect. `cluster_state.rs`/`kernel_lab.rs` do not share this way.

**Why it matters:** The established fact for this review is that no test compiles both the scalar and SIMD twins in one build, so the repo leans on the JS-side cross-build harness (`packages/glyph/scripts/support/engine-kernel-runner.mjs` + `benchmark-engine-kernels.mts`, see S3) as the closest thing to a differential test. That harness calls `pmndrs_glyph_kernel_lab_chunk_summaries_i64`, which exercises `kernel_lab.rs::chunk_sum_i64_simd`, **not** `cluster_state.rs::sum_advance_units`. So the one numeric-bound-sensitive kernel this review's task brief calls out by name — the ±2^53 × 64 accumulator sum — has zero differential coverage, automated or manual, for its actual shipped implementation. Today the two copies match (I diffed them by hand; see "Verified correct"), but nothing enforces that a future edit to either one keeps them in sync — the JS harness would keep passing while comparing `kernel_lab.rs`'s copy against itself, oblivious to production drifting.

**Before / After:**
```rust
// Before — two independent copies.
// cluster_state.rs:56-86
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    use core::arch::wasm32::{i64x2_add, i64x2_extract_lane, i64x2_splat, v128, v128_load};
    const ACCUMULATORS: usize = 4;
    /* ...same loop as kernel_lab.rs::chunk_sum_i64_simd... */
}

// kernel_lab.rs:275-301
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn chunk_sum_i64_simd<const ACCUMULATORS: usize>(advances: &[i64]) -> i64 {
    /* ...the same loop again, parameterized... */
}
```
```rust
// After — one generic implementation (in line_kernels.rs, always compiled, matching
// how next_transition_simd is already shared), production and the lab both call it.
// line_kernels.rs (new, always compiled — no cfg(feature = "kernel-lab") on the fn itself)
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
pub(crate) unsafe fn sum_i64_simd<const ACCUMULATORS: usize>(advances: &[i64]) -> i64 {
    /* the one implementation */
}

// cluster_state.rs
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn sum_advance_units(advances: &[i64]) -> i64 {
    // SAFETY: see line_kernels::sum_i64_simd.
    unsafe { super::line_kernels::sum_i64_simd::<4>(advances) }
}

// kernel_lab.rs — benchmark harness now instantiates the literal production function.
1 => super::line_kernels::sum_i64_simd::<1>(chunk_advances),
2 => super::line_kernels::sum_i64_simd::<2>(chunk_advances),
4 => super::line_kernels::sum_i64_simd::<4>(chunk_advances),  // <- this arm now *is* production
8 => super::line_kernels::sum_i64_simd::<8>(chunk_advances),
```
With this change, `benchmark-engine-kernels.mts`'s existing `i64Chunk64x4` cross-build hash comparison (see S3) starts covering the real `sum_advance_units`, closing the gap with no new test code.

**Confidence:** certain that the two implementations are textually independent (read both in full, `cluster_state.rs:56-92` and `kernel_lab.rs:275-301`); certain they currently compute the same result (same accumulator count, same load/add/extract sequence, same tail-sum pattern — I hand-verified lane-by-lane). Speculative only in the sense that "will they drift" is a prediction, not an observation — the point of the finding is that nothing prevents it.

## S3 — The one cross-build SIMD/scalar differential check that exists isn't wired into CI
**Severity:** low   **File:** `packages/glyph/scripts/build-engine-kernel-lab.mjs`, `packages/glyph/scripts/benchmark-engine-kernels.mts:21-40`

**What:** This review's task brief states no scalar-vs-SIMD differential test exists anywhere in the repo, reasoning from the fact that the `cfg`-exclusive twins can't both be in one build. That's true at the `cargo test` level. But `build-engine-kernel-lab.mjs` compiles three *separate* wasm binaries (`scalar`: no SIMD codegen; `auto`: SIMD codegen, LLVM auto-vec only; `explicit`: SIMD codegen + hand-written intrinsics), and `benchmark-engine-kernels.mts:33-40` hashes each variant's output over real captured paragraph arrays and throws if `auto`/`explicit` disagree with the `scalar` oracle. This is a genuine cross-build differential test, and (S2 aside) it does exercise the real `line_kernels.rs` production functions through the kernel-lab wrappers.

It is not part of `pnpm test` or `pnpm check` (root `package.json` — `test`/`check` scripts have no reference to `kernel-lab`), and no `.github/workflows/*.yml` invokes `glyph:kernel-lab-build` or `glyph:kernel-lab` (grepped, zero hits). It only runs when a developer manually runs `pnpm scripts run glyph:kernel-lab-build` then `pnpm scripts run glyph:kernel-lab`.

**Why it matters:** a regression in `line_kernels.rs` or `codec.rs`'s SIMD kernels (once S2 is fixed, `cluster_state.rs` too) would be silently un-caught by CI. The safety net exists but nobody is required to step on it.

**Before / After:**
```yaml
# Before: no CI workflow references glyph:kernel-lab.

# After — sketch, e.g. as a step in the existing Rust CI job, gated so it only runs
# when shaper/rust or the kernel-lab scripts change:
- name: SIMD kernel-lab differential check
  run: |
    mise exec -- pnpm scripts run glyph:kernel-lab-build
    mise exec -- pnpm scripts run glyph:kernel-lab
```
**Confidence:** certain (grepped `.github/workflows` and root `package.json` directly; both are simple text searches with unambiguous results).

## S4 — Disclosed but worth resurfacing: the shipped bidi transition-scan kernel is ~4.4x *slower* than scalar on adversarial mixed-direction runs
**Severity:** low (already logged — not a new finding, resurfaced because it's squarely inside "flag kernels with no evidence of a measured win")   **File:** `shaper/src/engine/line_kernels.rs:12-24,42-62`; evidence in `.agents/docs/planning/decision-register.md` (D-245)

**What:** Unlike every other kernel in scope, this one is *not* missing evidence — decision D-245 records that the shipped one-block SIMD transition scan is ~6.5-6.7x faster than scalar on the captured (pure-LTR-Latin) 25,515/100,602-glyph corpora, but ~4.4x *slower* than scalar on a synthetic adversarial mixed-direction lane (frequent short runs, so the 16-byte lookahead rarely pays for itself before falling back to the scalar tail). D-245 explicitly disclaims generalizing either number to real mixed-direction text, since the captured corpus has no natural bidi mixing.

**Why it matters:** this is the one place in scope where "is the SIMD kernel proven faster" has a documented *maybe, depending on script mix* answer rather than a clean yes. Text that genuinely interleaves scripts (Arabic/Hebrew numerals and Latin punctuation, not just synthetic worst-case) is a realistic product workload, not an edge case — and it's the one case this kernel is measured to regress on.

**Before / After:** not applicable — no code defect, the kernel and its scalar fallback are correct (see "Verified correct"). The actionable gap is evidentiary: a real mixed-script corpus in the kernel-lab evidence set, so D-245's caveat can be resolved one way or the other instead of staying open indefinitely.

**Confidence:** certain that D-245 says this (quoted the decision register directly). Speculative on real-world impact, exactly as D-245 itself says.

## Verified correct (no divergence found — recorded so the coverage of this review is legible)

- **`line_kernels.rs:42-62` (`next_transition_simd`) and `line_kernels.rs:75-115` (`for_each_flagged_grouped`).** These cannot produce an approximate result by construction: the SIMD portion only ever (a) locates the exact mismatching/matching byte via `i8x16_bitmask(...).trailing_zeros()` within a fully-in-bounds, fully-scanned block, or (b) advances to a boundary having *proven* (via a real v128 compare over the whole block) that no such byte exists yet, and control always falls through to the identical scalar loop for anything the SIMD portion didn't positively resolve. There is no numeric bound to violate and no way for GROUPS width to change the answer, only how much work the SIMD prefix does before the scalar suffix takes over. This is the strongest pattern in scope and is the one I used as the template for S1 and S2's fixes.
- **`cluster_state.rs:56-92` (`sum_advance_units`) numeric bound.** Traced to its only producer: `refresh_layout_units` (`cluster_state.rs:484-513`) builds `advance_units` exclusively via `layout_units::layout_units_from_scaled` (`layout_units.rs:26-29`), which saturates every element to ±2^53 through `saturating_floor_units` (`layout_units.rs:57-73`) before it ever reaches the array. `LAYOUT_CHUNK = 64` (`cluster_state.rs:32`) bounds the reduction to 64 such elements. Grepped every mutation site of `advance_units` — the only writer is that one `.extend(...)` call. 64 × 2^53 = 2^59, far inside i64::MAX (~2^63); `i64x2_add`'s wasm-mandated wrapping semantics never actually wrap. The bound in the doc comment is real, not aspirational.
- **`codec.rs:1279-1390` (`execute_simd_records`) arithmetic vs `codec.rs:1156-1263` (`execute_record`), operation-by-operation:** `AddF32`/`SubtractF32`/`MultiplyF32` are elementwise IEEE ops (no reduction-order question); `LessThanF32` normalizes wasm's all-ones/all-zeros comparison mask to 0/1 via `v128_and(..., u32x4_splat(1))`, matching scalar's `u32::from(bool)`; `SelectF32` uses `v128_bitselect` driven by `i32x4_ne(cond, 0)`, matching scalar's `!= 0` (not just `== 1`) semantics; `ConvertU32ToF32` relies on wasm's precisely-specified (not host-dependent) `f32.convert_i32_u` / `f32x4.convert_i32x4_u`, which the spec guarantees agree bit-for-bit unlike e.g. x86 SSE ambiguity.
- **`codec.rs:1393-1485` (`write_simd_outputs`) shuffle/transpose, all three fast-path widths.** Hand-verified the vector_width=2 pairing (`i32x4_shuffle::<0,4,1,5>`/`<2,6,3,7>`) and the vector_width=4 case, which is the textbook 4×4 SIMD transpose (`low01`/`low23`/`high01`/`high23` then the final shuffle pair) — lane 0 of `records[0]` is exactly record 0's first component, worked through all 4 output records by hand. Bounds: max byte offset written is `(output_end - 1) * stride + stride`, which `validate_execution` (`codec.rs:1136-1152`) already proves fits before either path runs.
- **`codec_wire.rs` decode path (`parse_codec` and helpers) and `wire.rs` (`array`/`read_u16`/`read_u32`).** Every count is capped against `MAX_*` constants before any allocation (`codec_wire.rs:66-77`); `array()` (`wire.rs:3-18`) uses `checked_mul`/`checked_add`/`.get(range)` throughout — no path to integer overflow or an OOB slice from adversarial `offset`/`count`/`stride`. `reject_overlaps` (`codec_wire.rs:201-225`) prevents table aliasing. All `Vec` growth in the decode path goes through `try_reserve_exact`, so allocation failure is a `STATUS_INVALID_REQUEST`, not an abort. Register indices (`u8`, unchecked at decode time) are safe because `validate_operation`'s `initialize`/`require` (`codec.rs:1812-1839`) use `.get()`/`.get_mut()`, not raw indexing, and run (via `validate_codec` → `ValidatedCodec::new`) before `ExecutableProgram::new`'s `operation_buffer_masks` (`codec.rs:759-791`) does raw-index into `[u32; MAX_REGISTERS]` — by construction every register index reaching that raw indexing already passed the bounds-checked validation. `MAX_BUFFERS_PER_PROGRAM = 16` exactly matches the `u16`/bit-16 mask width used throughout (`buffer_dependency_masks: Vec<u16>`, `active_buffers`/`operation_buffer_masks: u32` using only the low 16 bits) — at exactly 16 buffers, `1_u32 << 16` is in-bounds and buffer count is structurally capped at 16 before that shift ever executes.
- **`mtsdf-core/src/distance.rs:623-712` (`line_distance_tile_simd`, experimental tier).** Branchless via `v128_bitselect` reproduces the scalar `line_distance`'s two conditionals (degenerate zero-length edge; interior vs. endpoint alignment) exactly, including the `normalized_abs_dot` formula (`distance.rs:725-732`, `abs(dot/length_product)`, matched term-for-term). Unconditionally computing the discarded branch is safe because wasm float ops never trap on NaN/Inf and lanes are independent — a garbage value in a discarded lane can't corrupt a kept one.
- **`mtsdf-core/src/math.rs:104-128` (`quantize_unorm` vs `quantize_unorm4`, experimental tier).** Both formulas bound their intermediate to exactly `[0.0, 255.0]` before the integer narrowing, so the scalar path's saturating float→int `as u8` and the SIMD path's `i32x4_trunc_sat_f32x4` + plain `as u8` never actually exercise the saturating/truncating distinction — the invariant makes the two cast strategies equivalent in practice, not just by luck.
- **`kernel_lab.rs:22-59` (`pack_origins_and_sizes`).** Not actually a SIMD kernel — both cfg arms call the same `pack_scalar` unconditionally. The doc comment (`kernel_lab.rs:44-45`) records that a hand-written shuffle/store candidate was measured and rejected in favor of relying on `+simd128` autovectorization. This is the house policy ("SIMD only where proven faster") working as intended, and it's corroborated independently by decision D-162/D-245 in the decision register.
- **No `relaxed-simd` usage anywhere in the tree** (grepped `relaxed` across all `*.rs`, zero hits) — the host-nondeterminism hazard flagged in this review's brief doesn't materialize.
- **`codec_gather.rs`.** Single `unsafe` block in the whole ~2,300-line file (`codec_gather.rs:839`, a `slice::from_raw_parts` over an `AlignedBlock<T>` Vec whose size relationship to `T` is asserted by an adjacent `debug_assert_eq!`); `validate_semantic_shape` (`codec_gather.rs:859-884`) rejects non-finite semantic f32 inputs before they ever reach codec execution; every loop is bounded by an already-validated length, no `loop {}`/unbounded `while`.

## Differential-test plan

**Sharper version of the "no differential test" established fact, verified directly:** `packages/glyph/scripts/test.mts:23-30` runs `cargo test --manifest-path rust/shaper/Cargo.toml --locked` with **no `--target` and no `--features`** — a plain native-host test binary with only `default = ["std"]` active. Two consequences, both confirmed by reading the exact invocation:
1. `kernel-lab` is off, so `kernel_lab.rs`'s module — and every test inside its `#[cfg(test)] mod tests` (`kernel_lab.rs:767-953`, gated by `#[cfg(test)]` only, **not** `target_arch`) — is not compiled at all by `pnpm test`. Those tests (`every_i64_accumulator_specialization_matches_the_scalar_oracle`, `every_mask_group_specialization_matches_the_x1_oracle`, etc.) only run when a developer manually adds `--features kernel-lab`, and even then only on whatever host `cargo test` runs on.
2. There is no `--target wasm32-unknown-unknown`, so `target_arch != "wasm32"` for this test binary regardless of which host runs it. That means every `#[cfg(all(target_arch = "wasm32", feature = "simd128"))]` arm in scope — production included, not just kernel-lab — is *never compiled* by `cargo test` today. `line_kernels.rs`'s own tests (`transitions_match_the_naive_scan_across_block_boundaries`, `flagged_visits_match_the_naive_filter_for_every_alignment`) genuinely do exercise `next_transition`/`for_each_flagged` and pass — but only through the scalar tail, since the SIMD prefix inside them can't compile on this target. They are correctness tests for the production functions, not SIMD tests, despite living right next to the SIMD code.

So the gap is not merely "the scalar and SIMD twins can't be compared in one build" — it's that **`cargo test` as currently invoked never builds a single `core::arch::wasm32` intrinsic in this crate, production or lab.** Every SIMD-specific claim in this report (S1's operation-by-operation trace, the "Verified correct" bullets) was established by reading the code, because no test run could have established it instead.

The structural fix is the one line_kernels.rs already models for its *call sites* (though not, per the point above, for actually exercising the SIMD arm under `cargo test`): stop making the SIMD implementation `cfg`-exclusive with the scalar one. Only the *caller* (production vs. kernel-lab, or a future test) should be `cfg`/const-generic-selected; the kernel itself should compile unconditionally on any target once its intrinsics are behind `target_arch = "wasm32"`, because `core::arch::wasm32` intrinsics are only unavailable off-wasm32, not off-`simd128`. Concretely:

```rust
// Today (cluster_state.rs, codec.rs, kernel_lab.rs's own twins): the SIMD fn and its
// scalar twin are cfg-exclusive, so a native `cargo test` run never compiles the SIMD
// arm at all — there is nothing for a test in that binary to compare against.
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn sum_advance_units(advances: &[i64]) -> i64 { /* v128 intrinsics */ }

#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
fn sum_advance_units(advances: &[i64]) -> i64 { advances.iter().sum() }
```

```rust
// Proposed: rename both, gate only on target_arch (wasm32's core::arch::wasm32 is what's
// actually target-restricted — simd128 as a Cargo feature is a *policy* choice about
// which one production calls, not a compiler requirement), and keep a callable scalar
// oracle unconditionally. On wasm32 this compiles BOTH bodies into one test binary, so
// a `#[cfg(test)] mod tests` placed next to it (same shape as the existing ones, e.g.
// kernel_lab.rs:767-953 — those are `#[cfg(test)]`-only today, not target-gated, which
// is exactly why cargo test's current native/no-target invocation never touches them
// meaningfully; see above) could finally assert simd == scalar directly, PROVIDED it
// also actually runs on a wasm32 target. This repo has no `.cargo/config.toml` at all
// (verified: no such file), so there is no configured runner for
// `--target wasm32-unknown-unknown` today — standing one up is the one missing piece,
// not the cfg structure.

#[cfg(target_arch = "wasm32")]
fn sum_advance_units_simd(advances: &[i64]) -> i64 { /* v128 intrinsics, unsafe inside */ }

fn sum_advance_units_scalar(advances: &[i64]) -> i64 { advances.iter().sum() }

// Production caller picks one at compile time, same as today:
#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn sum_advance_units(advances: &[i64]) -> i64 { sum_advance_units_simd(advances) }
#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
fn sum_advance_units(advances: &[i64]) -> i64 { sum_advance_units_scalar(advances) }

// A property test, now buildable in one wasm32 test binary regardless of the
// `simd128` Cargo feature:
#[cfg(all(test, target_arch = "wasm32"))]
mod simd_parity {
    use super::*;
    // any no_std-friendly property-test harness (proptest supports no_std; or a manual
    // fuzz-style loop seeded from a PRNG, consistent with this repo's existing
    // hand-rolled property tests such as kernel_lab.rs's
    // `every_i64_accumulator_specialization_matches_the_scalar_oracle`) generates
    // `advances: Vec<i64>` clamped to the documented ±2^53 bound and asserts:
    #[test]
    fn matches_scalar_oracle_for_every_length_and_remainder() {
        for len in 0..=200 {
            let advances: Vec<i64> = /* generate, clamped to ±2^53 */;
            assert_eq!(sum_advance_units_simd(&advances), sum_advance_units_scalar(&advances));
        }
    }
}
```

Apply the same rename-and-share pattern to `codec.rs`'s `execute_simd_records`/`execute_record` pair and `kernel_lab.rs`'s `break_masks_simd`/`bidi_masks_simd`/`chunk_sum_i64_simd`/`chunk_summary_simd`. Once every SIMD kernel in scope has an unconditionally-compiled scalar oracle sitting next to it, a `wasm32-unknown-unknown` runner is still needed for `cargo test` itself to execute them — I did not find one in this repo (no `.cargo/config.toml` at all, and no `wasmtime`/`wasm-bindgen-test` reference anywhere under `packages/glyph`, grepped). Standing up one (`.cargo/config.toml`'s `[target.wasm32-unknown-unknown]` `runner`, pointed at `wasmtime` or `wasm-bindgen-test-runner`) is a prerequisite this plan introduces, not something to assume is already there. Until that lands, the same property comparison can run **today** with zero new infrastructure by driving it from the existing Node-based harness instead of `cargo test`: `packages/glyph/scripts/support/engine-kernel-runner.mjs` already loads a compiled `.wasm` via Node's built-in `WebAssembly.compile`/`instantiate` (no wasmtime needed) and pokes exported functions directly — S3's fix (wiring `glyph:kernel-lab-build` + `glyph:kernel-lab` into CI) already gets the accumulator-sum kernel this coverage once S2 makes `sum_advance_units` the literal function under test, without waiting on a `cargo test`-based runner at all. The `cargo test` property-test route above is the more thorough long-term fix (covers every input shape, not just the captured/synthetic corpora); the Node route is the fast path that uses only what's already in the repo.
