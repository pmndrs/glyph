---
type: Audit Report
title: Rust review — distance-field generation crates
description: Findings from the distance-field generation crates review, with file and line references, before/after snippets, and a confidence level per finding.
documentation_type: reference
tags: [rust, audit, mtsdf, raster, numerics]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Distance-field crate audit — mtsdf-core, mtsdf-baker, mtsdf-admission, mtsdf-fontations

Scope read in full, function by function: `mtsdf-core/src/{lib,math,distance,outline,color,error_correction}.rs`,
`mtsdf-baker/src/{lib,wasm,artifact,glb,model,error,abi_layout,abi_contract,progress,profile}.rs` and
`src/bin/measure-mtsdf-quality.rs`-adjacent tooling, `mtsdf-admission/src/{lib,quality,fuzzing,fontations}.rs`
plus `src/bin/measure-mtsdf-quality.rs`, `mtsdf-fontations/src/lib.rs`. Cross-checked against
`facts.jsonl` (casts/checked/saturating/wrapping/unsafe/loop-depth) and, where a claim needed evidence
outside the two files, against `Cargo.toml` feature wiring, `packages/glyph/scripts/{build.mjs,test.mts}`,
`.github/workflows/ci.yml`, `.agents/docs/roadmap/roadmap.md`, and the JS host in `packages/glyph/src/bakers/msdf.ts`.

---

## M1 — `with_state`'s exclusive `&mut WasmState` is live across a host-controlled reentrant FFI call-out
**Severity:** high   **File:** `mtsdf-baker/src/wasm.rs:681-696` (soundness anchor), triggered via `mtsdf-baker/src/progress.rs:16-20` and `mtsdf-baker/src/artifact.rs:231,241,307`

**What:** `pmndrs_glyph_mtsdf_bake` (wasm.rs:143-184) runs entirely inside `with_state(|state| { ... bake_mtsdf(source, request) ... })`. `bake_mtsdf` → `bake_mtsdf_internal` → `rasterize_font` (artifact.rs:202-326) calls `crate::progress::report(...)` once before the glyph loop, once per selected glyph, and once after (artifact.rs:231, 241, 307). On `wasm32`, `report` makes a **synchronous** call through an imported host function:
```rust
// progress.rs
unsafe extern "C" { fn pmndrs_glyph_bake_progress(completed: u32, total: u32); }
...
unsafe { pmndrs_glyph_bake_progress(completed, total); }
```
`with_state`'s only safety argument is a comment: "the V0 Wasm host is single-threaded; this pointer is initialized once and never freed" — it says nothing about reentrancy. The actual host import (checked in `packages/glyph/src/bakers/msdf.ts:71-77`) forwards straight to an **arbitrary user-supplied callback**:
```ts
pmndrs_glyph_bake_progress(completed: number, total: number) {
  listener?.({ stage: 'raster', phase: 'rasterizing', completed, total });
}
```
`listener` is `request.onProgress`, a public API parameter. Nothing in the Rust code, the FFI comment, or the JSON ABI contract (`abi_contract.rs`'s `"progress"` import entry) states or enforces that this callback must not call back into the module. If it does — call `pmndrs_glyph_mtsdf_dealloc`, `pmndrs_glyph_mtsdf_alloc`, or `pmndrs_glyph_mtsdf_bake` again — `with_state` hands out a **second** live `&mut WasmState` aliasing the first, which is already Rust UB, and is exploitable under this crate's own `lto = true, codegen-units = 1` release profile.

**Why it matters:** the concrete failure mode is worse than abstract aliasing. `pmndrs_glyph_mtsdf_bake` (wasm.rs:152-158) obtains `source: &[u8]` via `owned_bytes(&state.allocations, source_pointer, source_length)`, and that slice is held live across the entire bake — `select_font` (artifact.rs:329-344) builds a `FontRef<'source>` that zero-copy-borrows it, and every `font_outline_source(&font, glyph_id)` call in the per-glyph loop reads through that borrow. If a reentrant `onProgress` callback calls `pmndrs_glyph_mtsdf_dealloc(source_pointer, source_length)` — nothing prevents it — `deallocate` (wasm.rs:368-381) `swap_remove`s the `Allocation`, dropping its `Vec<u8>` and freeing the backing memory, while the outer call's `font`/`source` keep reading it: a genuine use-after-free, not just a theoretical aliasing violation.

**Before / After:**
```rust
// Before — wasm.rs:681-696
fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 { /* lazy init via CAS, unchanged */ }
    // SAFETY: the V0 Wasm host is single-threaded; this pointer is initialized once and never freed.
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
```
```rust
// After — trap on reentrancy instead of aliasing
static BORROWED: AtomicBool = AtomicBool::new(false);

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 { /* lazy init via CAS, unchanged */ }
    if BORROWED.swap(true, Ordering::AcqRel) {
        // A host callback (pmndrs_glyph_bake_progress -> onProgress) re-entered the
        // module while a &mut WasmState was already live. Trap instead of aliasing it.
        core::arch::wasm32::unreachable();
    }
    // SAFETY: BORROWED excludes re-entrant callers, so this is the only live &mut.
    let result = operation(unsafe { &mut *(pointer as *mut WasmState) });
    BORROWED.store(false, Ordering::Release);
    result
}
```
**Confidence:** likely. The structural gap is certain (traced end to end: FFI call-out while the borrow is held, no guard anywhere, the shipping JS import forwards to arbitrary user code). Whether it fires today depends on what a consumer's `onProgress` does; I did not find a first-party `onProgress` implementation that reenters. What would confirm it: a Miri/`-Zmiri-tree-borrows` run of `with_state` with a synthetic host stub whose `pmndrs_glyph_bake_progress` calls `pmndrs_glyph_mtsdf_dealloc` on the source allocation mid-bake.

---

## M2 — Edge-coloring's `seed` is provably always zero; `switch_color`'s "random" branch is dead
**Severity:** medium   **File:** `mtsdf-core/src/color.rs:27,175-180,182-192`

**What:** `color_edges` seeds coloring with `let mut seed = 0_u64;` (color.rs:27), then calls `initial_color(&mut seed)` once per glyph and threads `seed` through every `switch_color` call for every contour/corner in that glyph. The two places that mutate it:
```rust
fn initial_color(seed: &mut u64) -> u8 {
    let colors = [CYAN, MAGENTA, YELLOW];
    let index = (*seed % 3) as usize;
    *seed /= 3;
    colors[index]
}
fn switch_color(color: &mut u8, seed: &mut u64, banned: u8) {
    ...
    let shift = 1 + (*seed & 1) as u32;
    *seed >>= 1;
    ...
}
```
Both operations (`/= 3`, `>>= 1`) map `0 -> 0`. Since `seed` starts at `0` and is never written from any other source in this file, it is `0` on every single call, for every glyph, forever — `initial_color` always returns `CYAN`, and `switch_color`'s unbanned branch always computes `shift = 1`, never `2`. The "banned-color" branch (color.rs:184-187, an XOR-complement, no seed use) is unaffected and still functions.

**Why it matters:** this doesn't corrupt output — `switch_color`'s banned-color enforcement still holds regardless of `shift`, so no two edges across a real corner ever collide, and the whole pipeline stays deterministic (more deterministic than presumably intended: it doesn't even vary with glyph index or edge count). What's lost is the entropy the `seed: &mut u64` machinery exists to provide: every unconstrained color transition in every glyph rotates the same fixed direction by exactly one step, so the RGB pattern is fully predictable rather than varying per contour shape. A `u64` parameter threaded through 5 functions that can never observably be non-zero is dead complexity — either the intended seed source (e.g. per-glyph edge/contour counts) was never wired in, or this should be simplified to a hardcoded `shift = 1` and the parameter dropped.

**Before / After:**
```rust
// Before — color.rs:27
let mut seed = 0_u64;
let mut color = initial_color(&mut seed);
```
```rust
// After — seed from glyph geometry so it varies per glyph while staying
// 100% reproducible for identical input (no wall-clock/thread entropy)
let mut seed = (source.len() as u64)
    ^ (contours.len() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
let mut color = initial_color(&mut seed);
```
**Confidence:** certain — the entire lifecycle of `seed` is contained in this one file and traces to a fixed point at `0` by induction (both mutating operations are `0 -> 0`, and no other write site exists).

---

## M3 — No spatial acceleration structure: every texel rescans every edge
**Severity:** medium   **File:** `mtsdf-core/src/distance.rs:335-394` (`visit_lines`/`visit_quadratics`/`visit_cubics`), driven per-texel from `mtsdf-core/src/lib.rs:341-368`

**What:** `Distance4::evaluate` (distance.rs:52-99) is called once per output texel (lib.rs:351-357). It calls `visit_lines`/`visit_quadratics`/`visit_cubics`, each of which does `for index in 0..edges.x0.len() { ... }` — an unconditional linear scan of **every** edge of that kind in the glyph, with no bounding-box precheck, no per-tile edge list, no grid/BVH. Total cost is `O(output_width * output_height * total_edges)`; the `adjacent-texel-tile-experiment` path (distance.rs:396-480) amortizes the per-edge overhead across 4 texels at once but is still `O(edges)` per group, not sublinear in edge count.

**Why it matters:** for a complex glyph (dense CJK ideograph, many contours/components) baked into a large atlas region, this is the dominant cost, and it scales with both texel count and edge count with no way to skip edges that are geometrically far from a given texel. This is a known, standard property of the reference MSDF algorithm (not a coding mistake), but it is exactly the kind of thing the task asked to characterize: there is no acceleration structure and no early-out, by design, today.

**Before / After:** no isolated before/after — this is a whole-loop architecture question, not a local fix. A bounding-box precheck per edge (skip edges whose bbox, expanded by `full_distance_range`, doesn't reach the texel's row) or a coarse per-row edge bucket (sort edges by y-extent once per glyph, walk only the active set per scanline) would cut the constant factor without changing output, since the tightest edges near a texel already dominate the final `ContourDistance`.

**Confidence:** certain (the loops are unconditional over the full edge SoA; verified no filtering exists anywhere between `EdgeSoa` population and `visit_*`).

---

## M4 — `generate_mtsdf_with_transform` is 176 lines doing four separable jobs
**Severity:** medium   **File:** `mtsdf-core/src/lib.rs:280-456`

**What:** One function does: region/transform validation (285-308), output-buffer sizing via `try_reserve_exact`/`resize` (309-315), per-contour scratch sizing, duplicated for the `adjacent-texel-tile-experiment` cfg arm (317-337), the scalar per-pixel double loop (341-368), the **entire second copy** of that double loop for the tile-experiment cfg arm (369-419, itself SIMD-vs-scalar branching inside), distance-delta computation (420-425), and the three-call error-correction orchestration (426-453). `facts.jsonl` confirms this is the single function over 150 LOC in the whole audited scope (next largest is 133 LOC).

**Why it matters:** the cfg-gated duplication means the scalar and tile-experiment pixel loops must be kept in sync by hand (already a source of drift risk for M2-adjacent behavior like quantization order), and reviewing "does the hot loop do X" requires reading past two loop bodies and orchestration code in one function to be sure which is active.

**Before / After:**
```rust
// Before: everything inlined in generate_mtsdf_with_transform (lib.rs:280-456)
```
```rust
// After — sketch: extract named steps, keep the function as an orchestrator
fn generate_mtsdf_with_transform(&mut self, region, transform) -> Result<&[u8], GenerateError> {
    let (total_width, total_height, output_len) = validate_region_and_transform(region, transform, self.bounds)?;
    let output = prepare_output_buffer(&mut self.generator.scratch.output, output_len)?;
    let contour_distances = prepare_contour_scratch(&mut self.generator.scratch, ...)?;
    fill_texels(output, total_width, total_height, region, transform, &self.generator.scratch.hot_edges, contour_distances);
    apply_error_correction(output, total_width, total_height, region, transform, &mut self.generator.scratch);
    Ok(output)
}
```
**Confidence:** certain on the LOC/structure claim (facts.jsonl + direct read); the split above is illustrative, not a verified-compiling refactor.

---

## M5 — `solve_quadratic` is duplicated verbatim between `distance.rs` and `error_correction.rs`
**Severity:** medium   **File:** `mtsdf-core/src/distance.rs:929-946` and `mtsdf-core/src/error_correction.rs:361-378`

**What:** Byte-for-byte identical private functions (diffed directly; only difference is `1.0e12` vs `1e12`, the same f64 literal):
```rust
fn solve_quadratic(a: f64, b: f64, c: f64) -> [Option<f64>; 2] {
    if a == 0.0 || b.abs() > 1e12 * a.abs() {
        return if b == 0.0 { [None, None] } else { [Some(-c / b), None] };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant > 0.0 {
        let root = discriminant.sqrt();
        [Some((-b + root) / (2.0 * a)), Some((-b - root) / (2.0 * a))]
    } else if discriminant == 0.0 {
        [Some(-b / (2.0 * a)), None]
    } else {
        [None, None]
    }
}
```
Both files already import `math::{Point, clamp_unit, squared_distance}` from a shared internal module, so there's a natural home for this.

**Why it matters:** this is the numerically-sensitive root solver (large-coefficient-ratio guard, discriminant branch, near-zero-`a` fallback) both `quadratic_distance`'s cubic solve and `has_diagonal_artifact_inner`'s crossing search depend on. Any future correctness fix (e.g. a better catastrophic-cancellation guard on the discriminant formula) applied to one copy and not the other silently reintroduces the bug in the other file.

**Before / After:**
```rust
// Before: fn solve_quadratic(...) { ... } defined once in distance.rs, once in error_correction.rs
```
```rust
// After — math.rs
pub(crate) fn solve_quadratic(a: f64, b: f64, c: f64) -> [Option<f64>; 2] { /* single copy */ }
// distance.rs / error_correction.rs
use crate::math::solve_quadratic;
```
**Confidence:** certain (diffed with a script; text is identical modulo literal formatting).

---

## M6 — The outline fuzz harness cannot reach `MissingMove`/`NestedMove`/`EdgeLimit`
**Severity:** medium   **File:** `mtsdf-admission/src/fuzzing.rs:81-117`

**What:** `MutatedOutline::emit` gates every non-`move` command on `contour_open`:
```rust
match command[0] % 5 {
    0 => { if contour_open { collector.close(); } collector.move_to(...); contour_open = true; }
    1 if contour_open => collector.line_to(...),
    2 if contour_open => collector.quad_to(...),
    3 if contour_open => collector.cubic_to(...),
    4 if contour_open => { collector.close(); contour_open = false; }
    _ => {}
}
```
`line_to`/`quad_to`/`cubic_to`/`close` are silently dropped whenever `contour_open` is false, and `move_to` always auto-closes any open contour before starting a new one. That means `OutlineSink::push_edge`'s `MissingMove` guard (`outline.rs:369-372`) and `OutlineSink::move_to`'s `NestedMove` guard (`outline.rs:288-289`) can never actually fire from this corpus — the harness pre-sanitizes exactly the sequencing they exist to reject. With `MAX_COMMANDS = 128` (fuzzing.rs:6) far below `GeneratorLimits::default().max_edges = 65_535`, `EdgeLimit` is unreachable too, and `decode_coordinate`'s `rem_euclid(2_049) - 1_024` (fuzzing.rs:119-121) always yields a finite value, so `NonFiniteCoordinate` is unreachable as well.

**Why it matters:** the fuzzer's entire reach is geometric degeneracy (self-intersection, coincident points, extreme relative scale via the randomized `AtlasRegion` at fuzzing.rs:16-23) — valuable, but it means `OutlineSink`'s own ingestion-validation state machine has zero fuzz coverage and relies entirely on the two hand-written unit tests in `outline.rs` (`sink_closes_and_reverses_contours`, `sink_records_limits_without_panicking`) for regression protection.

**Before / After:** not a code diff — a coverage gap. A second corpus/target that feeds `OutlineSink` raw opcodes without the `contour_open` presanitization (or drops it entirely and lets `OutlineSink` reject malformed sequences on its own, since it's already `panic`-free on failure) would close it.

**Confidence:** certain (traced the guard exhaustively: every branch that could call a validation-triggering method is either gated by the same state `move_to` maintains, or bounded well under the limits that would trigger `EdgeLimit`).

---

## M7 — `error_correction.rs` recomputes each texel's median up to 9× per bake
**Severity:** low-medium   **File:** `mtsdf-core/src/error_correction.rs:95-151` (`has_artifact_with_neighbor`), `380-388` (`pixel`)

**What:** `correct_interpolation_artifacts`'s main loop (error_correction.rs:54-63) calls `has_artifact_with_neighbor(rgba, grid, x, y)` once per texel; that function calls `pixel(rgba, grid.width, ...)` (a `u8 -> f64` load-and-divide-by-255 for 3 channels) for `center`, `left`, `bottom`, `right`, `top`, and up to 4 diagonal neighbors — up to 9 raw pixel reads per texel, none cached. Because every interior texel is visited as "center" once and as somebody else's neighbor up to 8 times, each texel's `pixel()` value is recomputed independently on every one of those visits instead of being read once and looked up.

**Why it matters:** this is the exact "loop-invariant work that could hoist" the task asked to look for — `pixel(x, y)` returns the same `[f64; 3]` every time for fixed `rgba`. It's dwarfed by the `O(width * height * edges)` per-pixel distance evaluation (M3), so it's not the dominant cost, but it's a clean, low-risk win: a single `width * height` pass computing `median3(pixel(...))` once into a scratch buffer, consumed by both `has_artifact_with_neighbor` and `mark_protected_edges`' `pair` closure (which does the same `pixel4`/`median3` pattern independently at error_correction.rs:518-529), would cut redundant work without touching behavior.

**Confidence:** certain (the call graph has no memoization anywhere between texel reads and the final stencil).

---

## M8 — The 8 MiB response-chunk size is a magic number duplicated between Rust and the generated ABI JSON
**Severity:** low   **File:** `mtsdf-baker/src/wasm.rs:72` vs `mtsdf-baker/src/abi_contract.rs:133`

**What:**
```rust
// wasm.rs:72 (private, feature = "artifact-baker")
const RESPONSE_CHUNK_BYTES: usize = 8 * 1024 * 1024;
```
```rust
// abi_contract.rs:132-135 — same value, independent literal
"segmented": {
    "chunkByteLength": 8388608,
    "unavailableStatus": 4294967295_u32,
},
```
`abi_contract.rs` already re-exports `mtsdf-baker`'s `offset_of!`-derived layout constants (`pub use crate::abi_layout::*;`) specifically to keep the published contract mechanically in sync with the Rust struct layout it describes, but `RESPONSE_CHUNK_BYTES` isn't `pub(crate)` and isn't threaded through the same way, so this one field falls back to a hand-copied literal.

**Why it matters:** if `RESPONSE_CHUNK_BYTES` is ever retuned (it's exactly the kind of size/perf knob this repository tunes), the generated ABI contract JSON — which downstream JS/TS codegen reads as the source of truth per `generate-mtsdf-abi.rs` — silently goes stale. The actual per-call chunk length is still always correct at runtime (`pmndrs_glyph_mtsdf_segmented_chunk_len` computes it fresh via `.min(RESPONSE_CHUNK_BYTES)`, wasm.rs:266-277), so this is a documentation/planning-hint drift risk, not a runtime correctness bug.

**Before / After:**
```rust
// Before: two independent literals, 8 * 1024 * 1024 and 8388608
```
```rust
// After — wasm.rs
pub(crate) const RESPONSE_CHUNK_BYTES: usize = 8 * 1024 * 1024;
// abi_contract.rs
"chunkByteLength": crate::wasm::RESPONSE_CHUNK_BYTES,
```
**Confidence:** certain the duplication exists; likely (not certain) that it will ever actually drift, since the value hasn't needed tuning yet.

---

## M9 — No newtypes separate texel coordinates, glyph-space coordinates, and em-relative deltas
**Severity:** low-medium   **File:** `mtsdf-core/src/{lib,outline,math}.rs` generally; e.g. `lib.rs:42-47` (`AtlasRegion`, raw `usize`), `outline.rs:12-17` (`Bounds`, raw `f32`), `lib.rs:52-53` (`MtsdfTransform.full_distance_range: f32`)

**What:** `AtlasRegion.inner_width`/`inner_height`/`padding_x`/`padding_y` are plain `usize` texel counts; `Bounds`/`Point` fields are plain `f32` in font design units; `MtsdfTransform.full_distance_range` and `GeneratorLimits` fields are also raw primitives. Nothing at the type level distinguishes "a texel index," "a font-unit coordinate," or "an em-relative delta" — all three flow through the same `f32`/`usize` types across `lib.rs`, `outline.rs`, `distance.rs`, and into `mtsdf-baker/src/artifact.rs`'s `QuantizedGlyph` (which mixes `i32` plane coordinates, `f32` font-unit bounds, and `usize`/`u16` texel dimensions in adjacent fields).

**Why it matters:** I did not find an actual instance of a unit mix-up bug in this scope — every crossing point I traced (e.g. `region.total_width()` feeding both texel-loop bounds and `AtlasRegion` byte-length math; `bounds.min_x` feeding both the sampling transform and `QuantizedGlyph`'s plane-bounds computation) was correctly scoped. But the task specifically asked whether newtypes exist here, and they don't: the only thing preventing "pass a texel index where a font-unit coordinate was expected" is naming convention and review, not the compiler. Given how numerically delicate this code already is (M1-M7 above), that's a real, if currently unrealized, risk surface.

**Confidence:** certain on the absence of newtypes (grepped the module for any `struct Texel(...)`/`struct FontUnit(...)`-style wrapper — none exist); the risk assessment is inherently forward-looking, not a demonstrated bug.

---

## M10 — `checked_integer`'s `i32::MAX` bound is imprecise by up to 1.0 at the extreme edge
**Severity:** low   **File:** `mtsdf-baker/src/artifact.rs:456-461`

**What:**
```rust
fn checked_integer(value: f32, glyph_id: u16) -> Result<i32, MtsdfBakeError> {
    if !value.is_finite() || value < i32::MIN as f32 || value > i32::MAX as f32 {
        return Err(glyph_too_large(glyph_id));
    }
    Ok(value as i32)
}
```
`i32::MAX as f32` rounds *up* to `2147483648.0` (`2^31`) because f32 has only 24 bits of mantissa and the true value `2147483647` isn't representable; the nearest f32 is one ULP (256) above it. So `value > i32::MAX as f32` actually rejects only values strictly above `2^31`, not above the true `i32::MAX`. A `value` in `(2147483647.0, 2147483648.0]` passes this guard.

**Why it matters:** this is benign, not exploitable — `value as i32` for `2147483648.0` saturates to `i32::MAX` (Rust's float-to-int cast saturates, doesn't wrap or UB), and every caller of `checked_floor`/`checked_ceil` immediately narrows the result further via `i16::try_from` (artifact.rs:407) or `usize::try_from` (artifact.rs:410-411), both of which would reject a value that large anyway. No realistic font produces glyph-space coordinates within a few hundred units of 2^31 after scaling. Flagging only because the review asked specifically about narrowing-cast/quantization boundary correctness.

**Confidence:** certain on the f32-precision claim (mechanically verifiable: `2147483647.0f32 == 2147483648.0f32` is true); speculative that it ever matters in practice.

---

## M11 — `QuantizedGlyph::new`'s plane-bounds arithmetic is the one unchecked spot in an otherwise checked-arithmetic file
**Severity:** low   **File:** `mtsdf-baker/src/artifact.rs:400-405`

**What:**
```rust
let plane = [
    left - padding,
    bottom - padding,
    right + padding,
    top + padding,
];
```
`left`/`bottom`/`right`/`top` come from `checked_floor`/`checked_ceil` (which guarantee they're within `[i32::MIN, i32::MAX as f32]`, modulo M10's one-ULP slack), and `padding` is `i32::try_from(field_padding())` (bounded to ≤510 given `pixel_range ≤ MAX_MTSDF_PIXEL_RANGE = 1020`, validated earlier in `MtsdfDescriptorV0::validate`). This one line uses plain `-`/`+`, unlike essentially every other arithmetic op in this file (`checked_add`, `checked_mul`, `try_from` throughout `bake_mtsdf_internal` and `prepare_artifact_response`).

**Why it matters:** with `overflow-checks = false` in the release profile, `left - padding` for `left` near `i32::MIN` would silently wrap rather than panic. The downstream `i16::try_from` at artifact.rs:407 catches essentially all such wraps (a wrapped i32 is overwhelmingly likely to land outside i16's range too), but a value landing coincidentally back inside i16 range after wrapping would silently produce a wrong `plane_bounds` for that glyph instead of the intended `glyph_too_large` error. This requires `left`/`right`/etc. to already be within ~510 of `i32::MIN`/`MAX` post-scale, which itself requires pathological `units_per_em`/bounds combinations from an adversarial font.

**Before / After:**
```rust
// Before
let plane = [left - padding, bottom - padding, right + padding, top + padding];
```
```rust
// After — consistent with the rest of the file's checked-arithmetic style
let plane = [
    left.checked_sub(padding).ok_or_else(|| glyph_too_large(glyph_id))?,
    bottom.checked_sub(padding).ok_or_else(|| glyph_too_large(glyph_id))?,
    right.checked_add(padding).ok_or_else(|| glyph_too_large(glyph_id))?,
    top.checked_add(padding).ok_or_else(|| glyph_too_large(glyph_id))?,
];
```
**Confidence:** speculative — I did not construct a concrete font that reaches this range; the gap is real but the trigger is extreme.

---

## M12 — `encode_artifact_response`'s error-path length cast isn't guarded the way the success path is
**Severity:** low   **File:** `mtsdf-baker/src/wasm.rs:501-531` vs `wasm.rs:463-482`

**What:** The success path in `prepare_artifact_response` explicitly checks `u32::try_from(metadata.len()).is_err()` before building a `PreparedArtifactResponse` (wasm.rs:477-482). `prepared_error_response` (wasm.rs:492-499) builds one with no such check, and `encode_artifact_response` — called on *either* kind of response (see the call site at wasm.rs:175-183) — does `let metadata_length = prepared.metadata.len() as u32;` (wasm.rs:505), a truncating cast, unconditionally.

**Why it matters:** in practice `prepared_error_response`'s `metadata` is `serde_json::to_vec(&error)` for a small `code` + `message` struct (`MtsdfBakeError`, error.rs:22-27), whose `message` is always a short, non-attacker-sized diagnostic (a `serde_json::Error::to_string()` or a static str) — never realistically near 4 GiB. So this is an asymmetry in defense-in-depth, not a reachable bug today.

**Confidence:** certain the asymmetry exists; speculative that it's exploitable given the bounded size of everything that flows into `MtsdfBakeError::message` in this codebase today.

---

## M13 — `sample_bilinear` underflows `width - 1`/`height - 1` for a zero-dimension field
**Severity:** low (tooling only)   **File:** `mtsdf-admission/src/quality.rs:284-289`

**What:**
```rust
let clamped_u = u.clamp(0.0, (width - 1) as f64);
let clamped_v = v.clamp(0.0, (height - 1) as f64);
```
Plain `usize` subtraction; `width == 0` or `height == 0` wraps in release (overflow-checks off per the workspace profile) or panics in a debug/test build. Every current caller (`reconstruct_coverage`, called from `measure-mtsdf-quality.rs:152-159` with `width`/`height` sourced from a real, already-validated `AtlasRegion`) passes dimensions that are provably `>= 1`, so this isn't reachable via any code path that exists today — but `sample_bilinear` doesn't itself assert `width > 0 && height > 0`, so nothing stops a future caller from doing so.

**Confidence:** certain on the underflow if triggered; speculative that it's ever reachable, since `mtsdf-core`'s own `AtlasRegion` validation (`lib.rs:285-287`) rejects zero dimensions before a field can ever be generated.

---

## M14 — `Framing::new` (the admission bin's `QuantizedGlyph` mirror) skips the finite/range validation its `mtsdf-baker` counterpart has
**Severity:** low (dev tooling only)   **File:** `mtsdf-admission/src/bin/measure-mtsdf-quality.rs:216-219` vs `mtsdf-baker/src/artifact.rs:448-461`

**What:** The module doc comment (measure-mtsdf-quality.rs:5) states this struct deliberately mirrors `mtsdf-baker`'s `QuantizedGlyph` framing math — but where `QuantizedGlyph::new` routes `bounds.min_x * scale` through `checked_floor`/`checked_ceil`/`checked_integer` (rejecting non-finite or out-of-i32-range values with a typed error), `Framing::new` does the same computation with bare `.floor() as i32`/`.ceil() as i32`, no finiteness or range check. Not memory-unsafe (Rust's float-to-int cast saturates NaN to 0 and ±∞ to `i32::MIN`/`MAX`), just less informative on malformed input — a NaN-producing font would silently substitute `0` here instead of reporting a clear "glyph too large" style error the way the shipped baker does.

**Confidence:** certain on the asymmetry; low-impact by construction, since this bin is a developer-run comparison tool against known test fonts, not an input-validation boundary.

---

## M15 — `glb.rs`'s `.expect()` at line 123 depends on a cross-file, cross-function invariant that isn't documented at the call site
**Severity:** low   **File:** `mtsdf-baker/src/glb.rs:118-127`

**What:**
```rust
if let Some(coverage_view) = coverage_view {
    let extension = extension.as_object_mut().expect("extension is an object");
    extension.insert("coverage".into(), pmndrs_glyph_raster_artifact::raster_coverage_json_value(
        coverage_descriptor.expect("coverage descriptor accompanies bits"),
    ));
    ...
}
```
The first `.expect()` (line 119, `as_object_mut`) is trivially safe — `extension` was constructed two lines earlier via `json!({ ... })`, always an object. The second (line 123) is safe only because `rasterized.coverage.is_some() <=> coverage_descriptor.is_some()` holds — an invariant established three call frames away, in `artifact.rs`'s `request_coverage` (artifact.rs:358-376), which returns `None` exactly when its `coverage` parameter is `None`. Nothing at the `glb.rs:123` call site documents this; a future change decoupling `rasterized.coverage` from `request.descriptor.coverage` (e.g. a caching layer that recomputes one but not the other) would silently turn this into a live panic.

**Confidence:** certain the invariant currently holds (traced `bake_mtsdf_internal` → `rasterize_font` → `request_coverage` → `build_mtsdf_glb`, all keyed off the same `request.descriptor.coverage`); the risk is about future maintenance, not present behavior.

---

## M16 — `has_diagonal_artifact_inner` takes 11 positional parameters
**Severity:** low (informational)   **File:** `mtsdf-core/src/error_correction.rs:274-337`

**What:** `#[allow(clippy::too_many_arguments)]` on an 11-parameter private function (`first_median, fourth_median, first, linear, quadratic, first_delta, middle_delta, fourth_delta, first_extreme, second_extreme, span`), self-acknowledged in the source. Below the task's 150-LOC threshold (64 lines), so not flagged there, but worth a mention: several of these (`first_median`/`fourth_median`/`first`/`linear`/`quadratic`) are invariant across the three sibling calls in `has_diagonal_artifact` (error_correction.rs:235-271) and would read more clearly as a small `DiagonalArtifactContext` struct built once and reused per channel.

**Confidence:** certain (parameter count is a direct read); purely a readability call, not a defect.

---

## Experiment-feature verdict: `simd128-experiment`, `adjacent-texel-tile-experiment`, `adjacent-texel-simd-experiment`

**Live, deliberately parked — not dead, not abandoned.** Evidence, not inference:

- `mtsdf-core/Cargo.toml:11-17` and `mtsdf-baker/Cargo.toml:24-25,43-45`: none of the three are in `default`; `adjacent-texel-simd-experiment` implies `adjacent-texel-tile-experiment`.
- `packages/glyph/scripts/build.mjs:218-233`: the actual shipping wasm build invokes `cargo build --no-default-features --features artifact-baker` for `mtsdf-baker` — none of the three experiment flags are passed. The shipped artifact never contains this code.
- `packages/glyph/scripts/test.mts:10-16,32-34`: `mtsdf-core`/`mtsdf-baker` are in `libraryRustManifests`, tested via `cargo test --manifest-path ... --lib --locked` with **no** `--features` argument — default features only.
- `.github/workflows/ci.yml`: contains no reference to any of the three flags anywhere in the file.
- `.agents/docs/roadmap/roadmap.md:632,684`: documents the actual decision — "an equivalent four-texel scalar tile and an adjacent-texel SIMD line-distance kernel were compared against the unchanged scalar quadratic/cubic lane fallback... Adjacent SIMD improves the bounded Node and Chromium corpora by 2.4% and 0.9%... while adding 20.7% optimized and 11.4% Brotli bytes. Scalar tile improves bounded Node by 10.1% but regresses Chromium by 1.5%... Both candidates are rejected as universal runtime defaults, remain experiment features, and scalar Wasm remains the single merged v0 kernel." The `simd128-experiment` feature is separately called out as "non-shipping evidence... not a JavaScript option, alternate package artifact, or runtime branch."

Net effect: the code is *correct and intentional to keep*, but **untested by any automated path** in this repository today (default-off everywhere, no CI matrix leg, no script builds it). `distance.rs:1200-1249`'s `adjacent_tile_matches_four_scalar_evaluations` test — the one thing that would catch the tile path drifting out of sync with the scalar path after a future edit to `visit_lines`/`visit_quadratics`/`visit_cubics` — never runs in `cargo test --lib` with default features, and never runs in CI. If these are worth keeping as documented evidence, they'd benefit from one CI leg (even a manual/scheduled one) that builds and tests each feature combination so "rejected as default, kept as evidence" doesn't quietly become "compiles by luck."

---

## Also verified, no defect found

- **`mark_protected_corners` on a 1-edge contour** (error_correction.rs:421-485): traced explicitly — `edges.get(contour.clone())`/`span.last()` are `Option`-returning, the only raw index (`protection[y*width+x]`, line 479) is guarded by `x < width && y < height` immediately above it, and `column`/`row`/`libm_floor` are all `is_finite()`-checked before use. Safe for 1-edge, 0-corner, and teardrop-split (3-edge) contours alike; verified the exact single "protected corner" position a teardrop split produces matches the original detected corner.
- **`ReadOutlineError<E>`'s generic parameter**: earns its keep — `E` is `OutlineSource::Error`, which genuinely varies per implementation (`Infallible` for the built-in test/oracle sources, `skrifa::outline::DrawError` for `FontationsOutlineSource`, `()` for the wasm `WireRequest`), and in a `no_std`+`alloc` crate that avoids `Box<dyn Error>` everywhere else, collapsing it to a fixed type would force either an allocation or information loss.
- **`quantize_unorm`/`quantize_unorm4`** (math.rs:100-133): rounding-then-cast is correct at both boundaries (verified against the file's own `quantization_saturates` test arithmetically), and Rust's float-to-int `as` cast saturates rather than wraps, so a stray `NaN` collapses to `0` and any out-of-range value clamps — quantization cannot wrap a `u8`.
- **wasm float determinism / NaN payloads**: the reviewed hot path actively avoids producing NaN (epsilon-guarded division throughout `distance.rs`/`error_correction.rs`/`math.rs::normalized`), and where a NaN is used deliberately as a sentinel (`error_correction.rs:228-234`'s `extreme` computation), every consumer is a `<`/`>` comparison, which IEEE-754 defines as `false` for any NaN regardless of payload. The final `u8` quantization step also collapses any NaN to `0` independent of its payload. No path was found where a NaN's specific bit pattern (as opposed to its mere NaN-ness) could reach the output.
- **CFF/CFF2 winding reversal** (`mtsdf-fontations/src/lib.rs:82-85`): `reversed: matches!(outlines.format(), Some(OutlineGlyphFormat::Cff | OutlineGlyphFormat::Cff2))` correctly flags the one font-format family whose outline winding convention is opposite TrueType's, and `OutlineSink::close()` (outline.rs:340-346) correctly reverses both edge order and each edge's own direction when `reversed` is set.
- **Degenerate contours generally**: a `move_to` immediately followed by `close` with no intervening edge (single-point subpath) is silently dropped by `OutlineSink::close()`'s `if end > start` guard (outline.rs:340) before it ever reaches `EdgeSoa`/`color_edges`/`Distance4`; a `move_to; line_to(same point); close` (one zero-length edge) survives as a 1-edge, winding-0 contour and was traced through `contour_winding`, `classify_contour`, `line_distance`'s degenerate branch, and `line_winding` — all produce finite, harmless (zero-contribution) values, never `NaN`/`inf`.
