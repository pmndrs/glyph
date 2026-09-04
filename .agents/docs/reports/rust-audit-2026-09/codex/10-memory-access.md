---
type: Reference
title: Rust codex — Memory access patterns and allocation behaviour
description: Checkable rules on memory access patterns and allocation behaviour, researched against primary sources, each with rationale, applicability to this repository, and a citation.
documentation_type: reference
tags: [rust, codex, rules]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Memory Access Patterns and Allocation Behaviour

Scope: `pmndrs/glyph`'s Rust workspace is already flat-ownership — zero `Arc`/`Rc`/`Cow`/`RefCell`, one `Box` (host-only binary), owned `Vec`s plus integer indices, `#[repr(C)]` records exported into wasm linear memory. The rules below assume that baseline and go past it: allocation *behaviour* under repeated calls, cache effects you can actually measure, bounds-check codegen, wasm32-specific memory mechanics, and the AoS/SoA tension at a foreign-read boundary. Every rule names what to measure and how; none of them license skipping the measurement.

Grounding was read directly from this workspace: `mtsdf-core/src/lib.rs`, `mtsdf-core/src/distance.rs`, `shaper/src/engine/render_plan.rs`, `shaper/src/wasm.rs`, `slug-baker/src/wasm.rs`, `mtsdf-baker/src/wasm.rs`, and the `Cargo.toml` of every crate.

---

## 1. Allocation behaviour in hot loops

### R1. Give every hot-loop buffer a permanent home in a scratch struct, not a local `Vec::new()`
**Why:** A `Vec` created inside a function called per-glyph or per-cluster reallocates on every call even if the call site never sees it, because nothing survives between calls to amortize growth against.
**Applies to us:** `mtsdf-core/src/lib.rs:157-170` already does this — `GeneratorScratch` bundles `input`, `colored_edges`, `colored_contours`, `corners`, `hot_edges: EdgeSoa`, `contour_distances`, `output`, `error_stencil`, and `corner_protection` into one struct owned by `MtsdfGenerator` and reused bake-to-bake. Any new hot path (a new baker, a new per-glyph pass in `shaper`) should extend an existing scratch struct rather than allocate locally.
**Bad / Good:**
```rust
// Bad: local Vec, reallocates every call regardless of caller's loop
fn rasterize_one(edges: &EdgeSoa, width: usize, height: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(width * height * 4);
    // ...
    output
}

// Good: caller-owned scratch, grown once, reused every call
struct GeneratorScratch { output: Vec<u8>, /* ... */ }
fn rasterize_into(scratch: &mut GeneratorScratch, edges: &EdgeSoa, width: usize, height: usize) {
    if scratch.output.len() < width * height * 4 {
        scratch.output.resize(width * height * 4, 0);
    }
    // write into scratch.output
}
```
**Source:** https://nnethercote.github.io/perf-book/heap-allocations.html (accessed 2026-09-03, no publish date on page) — names this the "workhorse" pattern: declare the collection outside the loop and `clear()` it, trading a small readability cost for eliminating per-iteration allocation.

### R2. Grow with `try_reserve_exact` + `resize`; shrink with `truncate`, never `shrink_to_fit`
**Why:** `shrink_to_fit` can itself trigger a reallocation to hand memory back to the allocator — exactly the cost you were trying to amortize away, paid again on the next growth.
**Applies to us:** `mtsdf-core/src/lib.rs:309-326` is the canonical instance: `output` and `contour_distances` grow via `try_reserve_exact(needed - current)` followed by `resize`, and on a smaller glyph `contour_distances.truncate(contour_count)` — capacity is kept, only `len` drops.
**Bad / Good:**
```rust
// Bad: returns capacity to the allocator, then pays to reacquire it next call
contour_distances.resize(contour_count, ContourDistance::default());
contour_distances.shrink_to_fit();

// Good: len tracks the current need, capacity tracks the historical peak
if contour_count > contour_distances.len() {
    contour_distances.try_reserve_exact(contour_count - contour_distances.len())?;
    contour_distances.resize(contour_count, ContourDistance::default());
} else {
    contour_distances.truncate(contour_count);
}
```
**Source:** https://nnethercote.github.io/perf-book/heap-allocations.html — "[`shrink_to_fit`] may cause a reallocation... use it only if you are confident that... the space savings are worth it."

### R3. `try_reserve`, not `reserve`, on every path that can be reached from wasm input size
**Why:** Infallible `reserve` aborts the whole module on allocation failure. In `no_std + alloc` on `wasm32-unknown-unknown` there is no process to kill and restart — an abort takes the entire host page's engine instance down with it.
**Applies to us:** Already the workspace convention — `try_reserve`/`try_reserve_exact` appear in every crate (40 files), and `shaper/src/wasm.rs:26` caps the untrusted side explicitly with `MAX_REQUEST_ALLOCATION_BYTES = 64 * 1024 * 1024` before any allocation is attempted. Keep extending this convention rather than reaching for plain `Vec::with_capacity`/`reserve` in new code — a single infallible call reintroduces the abort path the rest of the codebase was built to avoid.
**Bad / Good:**
```rust
// Bad: panics/aborts the wasm instance on OOM, no recovery for the host
fn reserve<T>(values: &mut Vec<T>, additional: usize) {
    values.reserve(additional);
}

// Good: propagates a typed error the caller can turn into a status code
fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), EngineError> {
    values.try_reserve(additional).map_err(|_| EngineError::Allocation)
}
```
**Source:** https://doc.rust-lang.org/nightly/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03) — confirms `-Cpanic=abort` is this target's default panic strategy, which is what an infallible allocation failure resolves to.

### R4. Reserve the size you can compute; only rely on quasi-doubling when you can't
**Why:** `Vec`'s default growth is 0, 4, 8, 16, 32, 64… — a geometric series that amortizes to O(1) per push but still means up to ~2x wasted capacity and log2(n) reallocations if you never call `reserve`. When the final size is a known function of the input (UTF-16 length, glyph count, record count), computing it once and reserving it once is strictly better than trusting amortization.
**Applies to us:** `shaper/src/unicode.rs:42-56` and `shaper/src/bidi.rs:100-114` do this correctly — `reserve(utf16_capacity)` sizes every parallel buffer from the input text length before the pass runs, not incrementally during it.
**Bad / Good:**
```rust
// Bad: relies on quasi-doubling even though the final size is knowable up front
let mut classes = Vec::new();
for ch in text.chars() { classes.push(classify(ch)); }

// Good: one allocation sized to the known upper bound
let mut classes = Vec::new();
classes.try_reserve_exact(text.len())?;
for ch in text.chars() { classes.push(classify(ch)); }
```
**Source:** https://nnethercote.github.io/perf-book/heap-allocations.html — documents the exact growth sequence (0, 4, 8, 16, 32, 64…) and recommends `with_capacity`/`reserve` whenever the size is knowable.

### R5. Measure allocation *counts*, not allocation *time* — the metric hides in wall-clock noise until it doesn't
**Why:** A single extra allocation per glyph is invisible in a profile of one glyph and dominant across a paragraph of ten thousand. Count first; only chase the ones that show up in volume.
**Applies to us:** Two measurement paths are directly usable here without adding a heavyweight profiler dependency to a `no_std` crate: (1) `dhat-rs`'s heap-testing API lets a *native* `std`-feature test assert "this code path performs exactly N heap allocations," which can be wired into `shaper`'s existing `std` feature/dev-dependency surface as a regression gate on a hot function like `TextEngine` shaping or `MtsdfGenerator::generate`; (2) `talc`'s `counters` Cargo feature exposes live heap/allocation-count statistics from the exact allocator already in `shaper/src/wasm.rs:22-24`, so the wasm build itself can report allocation counts through a debug export, no native harness required.
**Bad / Good:**
```rust
// dhat-rs: pin an allocation-count regression, not just a "seems fast" feeling
#[test]
fn shaping_one_paragraph_allocates_a_bounded_number_of_times() {
    let _profiler = dhat::Profiler::builder().testing().build();
    let stats_before = dhat::HeapStats::get();
    shape_paragraph(&mut engine, PARAGRAPH);
    let stats_after = dhat::HeapStats::get();
    assert!(stats_after.total_blocks - stats_before.total_blocks < 8);
}
```
**Source:** https://docs.rs/dhat/latest/dhat/ (accessed 2026-09-03) — documents `dhat::HeapStats` and the testing-mode profiler for exactly this "assert N allocations" pattern. `talc` counters: https://github.com/SFBdragon/talc/blob/master/talc/README.md (accessed 2026-09-03) — "enabling `counters` will make Talc track heap and allocation metrics... accessed via the `counters` associated function."

### R6. Audit per-glyph and per-cluster functions specifically for hidden allocation — they don't show up the way a per-paragraph allocation does
**Why:** A profiler sampling wall-clock time on a paragraph-level call will surface the *sum* of per-glyph allocations as one lump, often misattributed to whatever generic allocator symbol is on the stack, not to the specific per-glyph call site that's issuing thousands of tiny allocations.
**Applies to us:** Every function taking a single glyph, cluster, or edge and returning an owned collection (`Vec`, `String`) rather than writing into a caller-supplied scratch buffer is a candidate. `mtsdf-core/src/distance.rs`'s `Distance4::evaluate` is the model to match: it takes `contours: &mut [ContourDistance]` as scratch and returns only a `Distance4` (four `f32`s by value) — no allocation possible inside the per-pixel hot path at all.
**Source:** direct codebase reading, `mtsdf-core/src/distance.rs:51-99`.

### R7. A domain-separated allocator split needs a stated invariant, or it's just two heaps that can silently cross-contaminate
**Why:** Running two allocator instances only pays off if allocations are partitioned by a real property (lifetime, trust boundary, reset cadence) that a single heap can't express. Without a written rule for which allocations go where, the split is indistinguishable from an accident.
**Applies to us:** `slug-baker/src/wasm.rs:21-24` and `mtsdf-baker/src/wasm.rs:28-31` each declare two `talc::wasm::WasmDynamicTalc` statics — `ALLOCATOR` and `BACKING_ALLOCATOR` — and the dealloc wrapper carries a `SAFETY` comment: "the pointer and layout came from this wrapper's Talc allocation domain." That comment is the load-bearing part of the pattern; it's the invariant that makes the split meaningful instead of arbitrary. Any future split (e.g. a third domain for a new baker) should carry the same kind of explicit, checkable statement of which allocations belong to which domain and why crossing them is a bug.
**Source:** direct codebase reading, `slug-baker/src/wasm.rs`, `mtsdf-baker/src/wasm.rs`.

### R8. A bump/arena allocator doesn't automatically beat talc's general-purpose allocator here — it duplicates a benefit the architecture already has
**Why:** Arena allocators win primarily by making *bulk free* O(1) instead of O(n) individual frees. `talc` already gives O(1) in-place dealloc and realloc; the thing an arena would additionally buy is skipping bin/boundary-tag bookkeeping on the allocation side, which only matters at allocation *counts* per frame high enough for that bookkeeping to show up in a profile.
**Applies to us:** Every scratch buffer in this codebase is already a `Vec` living inside a struct that's cleared/truncated in place (R1, R2) — that *is* the bulk-free property an arena would provide, achieved architecturally instead of through a second allocator. Reach for `bumpalo`/a custom arena only after `talc`'s `counters` feature (R5) shows a specific hot path issuing enough individual small allocations, per call, that bin lookup itself is the bottleneck — not as a default choice.
**Source:** https://github.com/SFBdragon/talc/blob/master/talc/README.md (accessed 2026-09-03) — describes talc as "a dlmalloc-style linked list allocator with boundary tagging and binning... allocation O(n) worst case (but in practice its near-constant time)... in-place reallocations and deallocations are O(1)." EuroRust 2024, Arthur Pastel, "The Impact of Memory Allocators on Performance: A Deep Dive," Oct 10–11 2024, Vienna & online — https://eurorust.eu/2024/talks/the-impact-of-memory-allocators-on-performance-a-deep-dive/ (accessed 2026-09-03): a full talk on exactly this allocator-selection trade-off, built from a from-scratch allocator implementation up to comparing established strategies.

### R9. `Cow` would reintroduce a per-access branch this codebase's hot loops were built to avoid — its absence is not an oversight
**Why:** `Cow<'_, T>`'s value is amortizing a rare mutation against a common borrow, at the cost of an `is-this-owned` check on every access. That trade is right for infrequent, mixed borrowed/owned data (e.g. error messages); it is wrong inside a loop that runs per-glyph or per-pixel, where the branch itself becomes the cost you're trying to eliminate.
**Applies to us:** Consistent with the measured fact that this workspace has zero `Cow` usage — the flat `Vec` + index ownership model means every hot-loop buffer is unconditionally owned, so there is no borrowed/owned state to discriminate at the point of use. Keep it that way inside `mtsdf-core`, `shaper/src/engine`, and the raster hot paths specifically; a `Cow` is only a candidate at a boundary that is itself cold (e.g. one-time font-table parsing), never inside a per-pixel or per-glyph loop.
**Source:** https://nnethercote.github.io/perf-book/heap-allocations.html — presents `Cow` as the recommended fix for "a mixture of borrowed and owned data," which is precisely the shape this codebase's hot loops don't have.

---

## 2. Cache behaviour you can actually act on

### R10. Don't cargo-cult 64 bytes — the line size that matters is the one on the machine you measure on, and it isn't universal
**Why:** Cache-line-crossing arguments are only as good as the line size they assume. Treating 64 bytes as a constant produces wrong conclusions on hardware where it isn't 64.
**Applies to us:** Confirmed on current hardware: 64 bytes on Intel 14th-gen desktop parts, but Apple M4 pairs cache lines into 128-byte fetch granules. Since local development on this workspace happens on Apple Silicon (per this environment) while the shipped artifact runs inside whatever cache hierarchy the *browser's host CPU* has, neither number is authoritative for the deployed target — wasm itself exposes no cache-line size at all (R17). Treat line-size-specific padding as a micro-optimization to verify per-target, not a default to reach for.
**Bad / Good:**
```rust
// Bad: hardcodes an assumption that only holds on some x86 parts
#[repr(align(64))]
struct HotRecord { /* ... */ }

// Good: size/pack for density first; only add alignment after measuring
// a specific false-sharing or split-load regression on a specific target
struct HotRecord { /* fields ordered largest-to-smallest, no explicit align */ }
```
**Source:** https://developerlife.com/2025/05/19/rust-mem-latency/, Nazmul Idris, May 19 2025 (accessed 2026-09-03) — states the 64-byte figure for Intel 14th Gen and the 128-byte pairing behavior for Apple M4 explicitly, with relative latency figures (L1 10–50x, L2 50–200x, RAM 500–1000x register access).

### R11. A `#[repr(C)]` wire record crossing a cache line is an ABI question, not a cache question
**Why:** Cache-line placement matters for data walked repeatedly, field-by-field, in a hot loop. A record written once by Rust and read once per field by JavaScript through a `DataView` never gets walked that way — its "hot loop" is a single linear pass at publish time, and its consumer has no cache hierarchy concept at all (it's reading through a `TypedArray`/`DataView`, whose cost model is bounds-checked property access, not cacheline fetch).
**Applies to us:** The seven record types in `shaper/src/engine/render_plan.rs:32-154` (`ResourceRecord` 40 bytes, `BufferRecord`/`PatchRecord` 36 bytes, `PrimitiveRecord`/`DrawRecord` 64 bytes, `RetirementRecord`/`DiagnosticRecord` 24 bytes — each pinned by a `const _: () = assert!(size_of::<T>() == N)` at lines 171-177) should be sized for wire compactness and natural alignment, not for cache-line packing. Don't spend effort aligning `PrimitiveRecord` to a 64-byte line on the theory that it helps cache behavior — nothing on either side of that boundary walks it that way.
**Source:** direct codebase reading, `shaper/src/engine/render_plan.rs`.

### R12. Working-set-fits-cache beats blocking — know which one your loop is in before reaching for tiling
**Why:** 2D grid blocking (tiling a raster pass into cache-sized sub-blocks) is a fix for a working set that doesn't fit a cache level. If the working set already fits, blocking adds loop-nest complexity for zero benefit; the actual lever left on the table is something else — usually redundant recomputation, not cache residency.
**Applies to us:** This is the central, non-obvious finding in the MSDF rasterizer. The per-glyph working set — `EdgeSoa`'s parallel line/quadratic/cubic arrays plus the `ContourDistance` scratch slice — is at most a few hundred edges for even a complex glyph, comfortably inside L1 on any target this ships to. Classic cache blocking of the pixel grid would buy nothing here. What the codebase's own `adjacent-texel-tile-experiment` feature (`mtsdf-core/src/lib.rs:369-419`, `mtsdf-core/src/distance.rs:101-169`) actually targets is different: it groups four horizontally-adjacent output pixels and evaluates all four against the *same* edge in one visit (via `Distance4::evaluate_tile`, SIMD-lane-per-pixel), amortizing the cost of walking `EdgeSoa` once per four pixels instead of once per pixel. That's arithmetic-intensity tiling — cutting redundant edge revisitation — not cache-capacity tiling. Name this distinction explicitly before proposing "blocking" as a fix for anything in this rasterizer; the profitable target is edge-revisit count, not working-set size.
**Source:** direct codebase reading, `mtsdf-core/src/lib.rs:300-419`, `mtsdf-core/src/distance.rs:19-169`.

### R13. A boring row-major linear sweep over the actual output buffer beats a clever traversal, once the buffer fits cache
**Why:** Once the working set fits a cache level, the traversal order that matters is the one matching the buffer's physical layout — anything else adds complexity without reducing misses, because there are no misses left to reduce.
**Applies to us:** `mtsdf-core/src/lib.rs:342-367` walks the output bitmap via `output.chunks_exact_mut(total_width * 4)` (rows) then `row.chunks_exact_mut(4)` (pixels) — a plain linear sweep matching the RGBA-interleaved output layout exactly. This is correct precisely because it's unremarkable; resist "improving" it with a space-filling curve or blocked traversal without first showing the current sweep actually misses cache at realistic glyph-atlas cell sizes.
**Source:** direct codebase reading, `mtsdf-core/src/lib.rs:342-367`.

### R14. Fuse when it removes a full extra pass over a large buffer; split when the fused loop's combined working set no longer fits where each half's did alone
**Why:** These are opposite fixes for opposite problems, and picking between them requires knowing which problem you have. Fusion trades "two cheap linear passes" for "one pass, half the memory traffic." Fission trades "one loop whose per-iteration footprint spills L1/L2" for "two loops, each with a footprint that fits" — at the cost of reading the shared input twice.
**Applies to us:** `Distance4::evaluate` (`mtsdf-core/src/distance.rs:51-99`) is already a fused design: `visit_lines`, `visit_quadratics`, and `visit_cubics` each do a single pass over their own `EdgeSoa` sub-array and write directly into the shared `contours` scratch, rather than each pass reading and rewriting a shared intermediate buffer. If a future change adds a per-edge computation expensive enough to want its own SIMD-friendly pass, the question to answer before splitting it out is whether `contours` plus the relevant `EdgeSoa` sub-array together still fit L1 as one combined working set — if yes, fusion still wins; only split when that combined footprint is what's actually spilling.
**Source:** direct codebase reading, `mtsdf-core/src/distance.rs:335-394`; general framing from https://nnethercote.github.io/perf-book/ (accessed 2026-09-03).

### R15. Zero linked structures is a result worth defending, not just a starting condition
**Why:** Pointer-chasing traversal loses to a flat array scan even when the linked structure is small enough that its *total* footprint would fit cache — the loss comes from defeating hardware prefetch (each next-pointer load is a data-dependent branch the prefetcher can't get ahead of), not from allocation overhead or total size.
**Applies to us:** This is a validation rule, not a to-do: the measured absence of `Box`ed linked structures (one `Box`, in a host-only binary) across 63k lines means every traversal in this codebase is already prefetch-friendly by construction. Treat any future proposal to introduce an intrusive linked list, tree, or graph structure (even a "small" one, even one that would fit in cache by total byte count) as a regression against this property, and require it to be justified against a flat-array-plus-indices alternative first.
**Source:** general knowledge, corroborated by https://developerlife.com/2025/05/19/rust-mem-latency/ (accessed 2026-09-03) on stack/contiguous access locality vs. scattered heap access.

### R16. Prefetch-friendly order for parallel SoA arrays means "iterate the shared index once," not "finish one array before starting the next"
**Why:** When several `Vec`s are indexed by the same logical position (as `EdgeSoa`'s `x0`/`y0`/`x1`/`y1`/`color`/`contour`/`context` all are), the hardware prefetcher does best when each array is walked in the same, single, monotonic pass — one index at a time across all arrays — because that's the access pattern each array's own prefetch stream can predict. Walking `x0` fully, then `y0` fully, then `x1` fully, would revisit each array's address range from scratch and cost you the same total bytes touched but with worse temporal locality on the (small) per-iteration working set already living in registers.
**Applies to us:** `visit_lines` (`mtsdf-core/src/distance.rs:335-351`) does this correctly — a single `for index in 0..edges.x0.len()` loop touches `x0[index]`, `y0[index]`, `x1[index]`, `y1[index]`, `color[index]`, `contour[index]`, `context[index]` together, once per index, rather than looping once per field.
**Source:** direct codebase reading, `mtsdf-core/src/distance.rs:335-351`.

### R17. wasm32 has no exposed cache hierarchy — treat byte-boundary cache tuning as a hypothesis to verify per-engine, not a portable fact
**Why:** Everything in this section describes real, measurable hardware cache behavior — but the program never gets to observe *which* hardware cache it's running on. wasm linear memory is a flat, unsegmented byte array with no instruction for querying cache-line size, no prefetch intrinsic exposed to safe code, and a host engine (V8, SpiderMonkey, Wasmtime) sitting between the wasm bytecode and whatever the actual CPU does with it.
**Applies to us:** Advice like R10–R16 remains valid at the level of "smaller and denser wins, sequential beats scattered" — that's a property of any memory hierarchy. It stops being valid the moment it becomes a specific byte-alignment or line-crossing claim, because that claim was made about a specific CPU's cache, not about the abstract machine this code actually targets. Any such claim needs to be re-verified against real browser-engine timing (R30), not asserted from x86/ARM intuition.
**Source:** general knowledge of the wasm linear-memory model, corroborated by the absence of any cache/prefetch intrinsics in `core::arch::wasm32` (the only `wasm32`-specific intrinsics this codebase uses are the `f32x4_*` SIMD operations in `mtsdf-core/src/distance.rs:623-723`, none of which are cache-related).

---

## 3. Bounds checks and codegen

### R18. Zero `get_unchecked` across 63k lines is evidence for "measure before reaching for unsafe indexing," not a gap to fill
**Why:** The whole point of the safe bounds-check-elimination patterns (slice-first, `chunks_exact`, `zip`, assert-once) is that they get LLVM to prove what `get_unchecked` merely *asserts* — and a compiler-proven bound survives refactoring, while a manually-asserted one silently becomes unsound the moment an invariant it depended on changes.
**Applies to us:** `grep -rn get_unchecked` across the entire `rust/` tree returns nothing. This is not an oversight to fix; it's the current, working answer to "when is `get_unchecked` justified here" — essentially never, so far. Any PR introducing it should be held to the bar in R23, not treated as a normal optimization.
**Source:** direct codebase measurement (grep, this session). https://readyset.io/blog/bounds-checks (accessed 2026-09-03, no date on page) — manually converting 651 bounds-checked indexing operations to `unsafe` in a production Rust codebase *regressed* two representative query latencies by 16–20%, while a custom compiler build that eliminated every bounds check in the program was within measurement noise of baseline.

### R19. `chunks_exact` is the established idiom for decoding fixed-size records from a flat byte buffer — extend it, don't reinvent it
**Why:** `chunks_exact(n)` states the record size once and lets every subsequent slice access inside the loop be provably in-bounds relative to that one checked division, instead of re-deriving an offset (`i * n`) and indexing into the original buffer per field.
**Applies to us:** This is already how every wire-decoding module in this workspace works: `shaper/src/engine/semantic_wire.rs` (constraint, region, exclusion, inline-object, and flow-vertex records), `shaper/src/engine/codec_wire.rs` (program, input, capability-set, buffer, operation records), `shaper/src/engine/font_binding_wire.rs`, and `bitmap-baker/src/lib.rs:421`. Adding a new record kind should add a new `chunks_exact(RECORD_SIZE)` loop matching this shape, not a hand-rolled indexed loop.
**Bad / Good:**
```rust
// Bad: re-derives byte offsets per record, each one bounds-checked independently
for i in 0..(bytes.len() / RECORD_SIZE) {
    let start = i * RECORD_SIZE;
    let id = u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap());
    // ...
}

// Good: one length check on entry to the loop, then provably in-bounds slicing
for record in bytes.chunks_exact(RECORD_SIZE) {
    let id = u32::from_le_bytes(record[0..4].try_into().unwrap());
    // ...
}
```
**Source:** https://github.com/Shnatsel/bounds-check-cookbook (accessed 2026-09-03) — a recipe collection specifically for this pattern, each recipe with an assembly-verification command via `cargo-show-asm`; https://nnethercote.github.io/perf-book/bounds-checks.html (accessed 2026-09-03).

### R20. Slice once above the loop; index the slice, not the original `Vec`, inside it
**Why:** Indexing a `&[T]` sliced once before a loop lets LLVM treat the length as loop-invariant. Indexing the original `Vec<T>` (or re-slicing per iteration) reopens the question of whether the length could change mid-loop, even when it provably can't from the loop body alone.
**Applies to us:** `mtsdf-core/src/distance.rs:329-333`'s `contour_mut` helper is a documented instance of this discipline going one step further — it indexes `contours: &mut [ContourDistance]` (already a slice, passed in as scratch) with an index whose provenance is explained in a comment rather than re-validated: *"`EdgeSoa::populate` creates every index from the same contour slice used to size this reusable buffer, so the conversion and access are invariant-safe."* That's the pattern to reach for before `get_unchecked`: state the invariant once, in one place, in a form both the reader and (via `chunks_exact`/slicing) the compiler can lean on.
**Source:** direct codebase reading, `mtsdf-core/src/distance.rs:329-333`; general pattern from https://nnethercote.github.io/perf-book/bounds-checks.html.

### R21. Verify bounds-check removal by reading the emitted **wasm**, not x86 assembly
**Why:** LLVM's wasm backend is a different backend from its x86/ARM ones, with independent codegen decisions. A bounds check eliminated in a native build's disassembly is not evidence it was eliminated in the `wasm32-unknown-unknown` artifact this project actually ships — the only way to know is to read that artifact.
**Applies to us:** For any hot decode/index path (candidates: `chunks_exact` loops in `*_wire.rs`, `contour_mut`, the pixel loop in `mtsdf-core/src/lib.rs`), verify with:
```bash
# From the crate directory, after a release build targeting wasm32:
mise exec -- cargo build --release --target wasm32-unknown-unknown
wasm2wat target/wasm32-unknown-unknown/release/*.wasm -o out.wat
# or, for a structured disassembly with symbol names:
wasm-objdump -d -x target/wasm32-unknown-unknown/release/*.wasm | less
```
Look for a `br_if`/`unreachable` pair guarding each memory access inside the hot function's disassembly; its absence around a specific access — not its absence "in general" — is the actual claim being verified.
**Source:** https://github.com/WebAssembly/wabt (accessed 2026-09-03) — `wasm2wat`/`wasm-objdump` (WABT toolkit); https://github.com/bytecodealliance/wasm-tools (accessed 2026-09-03) as the actively-maintained alternative CLI/library set for the same inspection.

### R22. When `get_unchecked` is genuinely justified: profiled-hot, locally-provable, and verified — and still expect a small or negative win
**Why:** The three preconditions exist because each removes a different way this goes wrong: without "profiled hot," you're optimizing code that doesn't matter; without "locally provable," the safety comment is a promise nothing checks; without "verified," you don't actually know the safe version was worse in the first place.
**Applies to us:** Concretely, before reaching for `get_unchecked` anywhere in this codebase: (1) show the bounds check is inside a function that dominates a `talc`-counters or wall-clock hot path (R5); (2) state the invariant that makes the access safe in a comment scoped to the one function using it (matching `contour_mut`'s existing comment style, R20); (3) confirm via `wasm2wat` (R21) that the safe version — after trying slice-first/`chunks_exact`/assert-once — still emits the check; and (4) re-benchmark after the change, because Readyset's real-world data point (R18) is that manual `unsafe` conversion made things *worse*, not better, likely by disturbing inlining decisions the optimizer had already made around the safe form.
**Source:** https://readyset.io/blog/bounds-checks (accessed 2026-09-03); https://nnethercote.github.io/perf-book/bounds-checks.html (accessed 2026-09-03) — frames `get_unchecked`/`get_unchecked_mut` explicitly as "a last resort."

### R23. `codegen-units = 1` + `lto = true` (already set everywhere) is what makes cross-crate bounds-check elimination possible at all
**Why:** Bounds-check elimination frequently depends on inlining a callee enough that the caller's known-length slice and the callee's index computation end up in the same optimization unit. Without whole-program LTO, a helper function defined in one crate and called from another is opaque to the caller's optimizer no matter how provably in-bounds its internal indexing is.
**Applies to us:** Every crate's `[profile.release]` already sets `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true` (confirmed in `shaper`, `mtsdf-core`, `mtsdf-admission`, `slug-baker`, `slug-core`, `bitmap-baker`, `mtsdf-baker`, `raster-artifact`, `slug-fontations`, `font-baker`). This is a precondition this codebase already meets for the wire-decoding helpers (R19) to have their bounds checks eliminated across the `shaper` → `*_wire.rs` module boundary — don't let a new crate split silently drop it.
**Source:** direct codebase reading, all ten `Cargo.toml` files under `rust/`.

### R24. `opt-level = "z"` measurably trades away bounds-check elimination and inlining-driven optimization — keep it scoped to genuinely offline crates
**Why:** Size-optimized codegen (`"z"`, and to a lesser extent `"s"`) deliberately suppresses some of the same inlining and unrolling that `"3"` (the implicit default `opt-level` under `lto`/`codegen-units=1` elsewhere in this workspace) uses to prove bounds are safe to elide. That's the correct trade for a tool that runs once, offline, on a developer's machine — and the wrong trade for anything in a per-glyph or per-frame path.
**Applies to us:** `font-baker/Cargo.toml:61` is the one crate in this workspace with `opt-level = "z"`; every other crate leaves it at the implicit release default. That's appropriate — `font-baker` is an offline baking tool, not a hot runtime path — but it's worth stating explicitly as a boundary: `opt-level = "z"` should never migrate to `shaper`, `mtsdf-core`, or any crate whose code runs per-glyph, per-cluster, or per-pixel at request time.
**Source:** direct codebase reading, `font-baker/Cargo.toml:58-64` vs. the other nine `Cargo.toml` files.

---

## 4. What's different on wasm32 specifically

### R25. `bulk-memory` has been on by default since Rust 1.87 — but verify the actual copy you care about still lowers to it
**Why:** With `bulk-memory` enabled, `Vec`/slice copies, clones, and `memcpy`-shaped code *can* lower to the native `memory.copy`/`memory.fill` wasm instructions instead of a compiled-in byte-copy loop — but LLVM's wasm backend has its own size heuristic and does not do this unconditionally (R26). "The feature is on" and "this specific copy uses it" are different claims.
**Applies to us:** `shaper/Cargo.toml` pins `rust-version = "1.97.1"`, well past the 1.87 threshold, so `bulk-memory`, `nontrapping-fptoint`, `multivalue`, `mutable-globals`, `reference-types`, and `sign-ext` are all active by default for every crate targeting `wasm32-unknown-unknown` in this workspace without any extra `RUSTFLAGS`. For a specific large copy that matters (e.g. copying a decoded glyph outline, or the `output` bitmap buffer in `mtsdf-core`), confirm the instruction actually emitted with `wasm2wat` (R21) rather than assuming the target-feature default settles it.
**Source:** https://doc.rust-lang.org/nightly/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03) — "As of Rust 1.87.0 (and LLVM 20), `bulk-memory`... [is] enabled by default." Cross-checked against `shaper/Cargo.toml`'s `rust-version = "1.97.1"` directly.

### R26. `memory.copy` is not emitted for every copy — small constant-length copies still inline as loads/stores
**Why:** `memory.copy` has fixed per-call overhead in most wasm engines' implementations; for very small, compile-time-constant-length copies, that overhead can exceed the cost of just emitting the loads and stores directly. LLVM's wasm backend has been tuned around exactly this — small copies stay inlined, larger ones become `memory.copy`.
**Applies to us:** This matters most for the small, fixed-size `#[repr(C)]` records this codebase moves around (`BufferRecord` at 36 bytes, `DrawRecord` at 64 bytes) — don't be surprised, when reading `wasm2wat` output (R21), to see a handful of `i32.load`/`i32.store` pairs instead of a `memory.copy` call for a single-record copy; that's the compiler making the same size call the LLVM heuristic makes, not a missed optimization.
**Source:** general LLVM wasm backend behavior, corroborated via search of `rust-lang/rust` and LLVM issue trackers (accessed 2026-09-03) describing this exact small-copy heuristic; not independently verified against LLVM source in this session — treat the exact size threshold as unconfirmed and re-check against the actual `wasm2wat` output for the record sizes in `render_plan.rs` before relying on it.

### R27. `memory.grow` detaches every existing JS-side view into wasm memory — including views the host thinks are still valid
**Why:** Per the WebAssembly JS API, growing linear memory reallocates the backing buffer, and **every** existing `ArrayBuffer`/`TypedArray`/`DataView` view into the old buffer is detached (`byteLength` becomes 0) — even a `grow(0)` call. This is not specific to the view that triggered the growth; it's every view the host currently holds.
**Applies to us:** This is the single highest-leverage wasm32-specific fact for this codebase's design, because the entire published contract is "TypeScript reads `#[repr(C)]` records directly out of wasm linear memory" (`render_plan.rs`, `RenderPlanView`). Any allocation inside a call — not just an obviously large one, but any `Vec` push that happens to cross the current linear-memory ceiling — can trigger `memory.grow` internally (via `talc`'s `WasmDynamicTalc`, R32) and silently invalidate every `TypedArray` the JS side is holding over previously-published records, including ones from an earlier, unrelated call. The host wrapper must re-derive its views from `memory.buffer` after **every** call into the wasm module that could allocate — not only after calls documented as "may grow memory" — or it risks reading a detached, zero-length buffer.
**Bad / Good:**
```javascript
// Bad: caches a view once, reuses it across calls indefinitely
const recordsView = new Uint32Array(instance.exports.memory.buffer, ptr, len);
callWasmFunctionThatMightAllocate();
readFrom(recordsView); // may be a detached, zero-length buffer now

// Good: re-derive the view after any call that could have grown memory
callWasmFunctionThatMightAllocate();
const recordsView = new Uint32Array(instance.exports.memory.buffer, ptr, len);
readFrom(recordsView);
```
**Source:** https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow (accessed 2026-09-03) — "Detachment means that the ArrayBuffer's byteLength becomes zero... Every call to grow() detaches any existing ArrayBuffer or TypedArray references, even if you call grow(0)." (Not applicable if a future change moves this boundary onto `SharedArrayBuffer`-backed memory, where growth does not detach — see the same MDN page — but this codebase does not currently use shared memory.)

### R28. There are no hardware performance counters in a browser, and timer precision is deliberately degraded — plan measurement around that, don't fight it
**Why:** Browsers reduced `performance.now()`'s resolution specifically as a Spectre mitigation (Chrome dropped it from 5μs to 100μs, plus added jitter) because a sufficiently precise timer is the primary tool needed to distinguish a cache hit from a cache miss and mount a timing side-channel attack. That's a deliberate, security-motivated design choice, not a gap that will close — cache-miss-level questions are unanswerable in-browser by construction.
**Applies to us:** Answer microarchitectural questions (does this access pattern miss L1? does this struct layout cause false sharing?) in a *native* harness — `cargo bench`/Criterion against the same crate compiled for the host target, where real hardware counters and higher-resolution timers are available — then confirm only the resulting end-to-end wall-clock delta in the actual browser target, with the warm-up discipline in R29. Don't try to infer cache behavior from browser timing directly; the signal isn't there to find.
**Source:** https://v8.dev/blog/spectre (accessed 2026-09-03) — documents the `performance.now()` precision reduction and the temporary fleet-wide `SharedArrayBuffer` disable, both specifically to prevent construction of a sufficiently precise timer for cache-timing attacks.

### R29. Benchmark wasm honestly: warm the path before timing, because the code running under you changes between call 1 and call 1000
**Why:** Browser wasm engines tier — a baseline (fast-compile, slower-execute) compiler runs first, with an optimizing compiler kicking in after enough executions. A cold-start measurement is measuring the baseline tier's output, not the code path this codebase's steady-state users actually spend their time in.
**Applies to us:** Any in-browser measurement of a `shaper`/`mtsdf-baker`/`slug-baker` hot function (shaping a paragraph, baking a glyph) should run a fixed, documented number of warm-up iterations before the timed window starts, and should report the steady-state number, not the first-call number. This matters more here than in a typical wasm module because this codebase's hot paths (per-glyph, per-pixel loops) are exactly the kind of tight, repeatedly-executed code an optimizing tier target first — meaning the gap between cold and warm is likely to be large, not incidental.
**Source:** search-corroborated (accessed 2026-09-03, not independently fetched from a single primary source this session): browser wasm engines' baseline/optimizing tiering behavior and its effect on warm-up-sensitive benchmarking is well-established V8/SpiderMonkey documentation; treat the specific tiering thresholds as engine-version-dependent and unverified rather than a fixed number to design around.

### R30. Know which of `talc`'s two wasm strategies you're on, and why
**Why:** `talc` ships two distinct ways to claim wasm linear memory: `WasmGrowAndClaim` (grow on demand via `memory.grow`, no upfront ceiling) and `WasmArenaTalc` (claim a fixed static region once, e.g. 128MB, and never call `memory.grow` again). They trade differently: dynamic growth avoids picking a worst-case ceiling but pays an infrequent grow-and-copy cost (and triggers the view-detachment in R27) each time it grows; the fixed arena pays that cost once at startup and never again, at the price of committing to a ceiling that must be sized for the worst realistic input.
**Applies to us:** `shaper/src/wasm.rs:22-24` uses `talc::wasm::new_wasm_dynamic_allocator()` — the dynamic-growth strategy — and separately caps the untrusted-input case explicitly with `MAX_REQUEST_ALLOCATION_BYTES = 64 * 1024 * 1024` at the request layer (`shaper/src/wasm.rs:26`), rather than by sizing a fixed arena to that ceiling. That's the right split of concerns: the allocator handles "how memory grows," the request layer handles "how much a single caller is allowed to ask for" — don't collapse them by switching to `WasmArenaTalc` without first checking whether that duplicates or conflicts with the existing request-size cap.
**Source:** https://github.com/SFBdragon/talc/blob/master/talc/README_WASM.md (accessed 2026-09-03) — describes both `WasmGrowAndClaim` and `WasmArenaTalc` as the two wasm-target strategies talc provides. Cross-checked against `shaper/src/wasm.rs:22-26` directly.

### R31. `panic = "abort"` is already this target's default — the explicit setting is insurance against that changing, not a required override
**Why:** `wasm32-unknown-unknown` already defaults to `-Cpanic=abort`; setting it explicitly in every `Cargo.toml` doesn't currently change behavior. It does two other things: it documents the dependency (a future `no_std` crate added to the workspace can't quietly assume unwind support exists), and it guards against the default itself moving — the WebAssembly exception-handling proposal stabilized around mid-2025, which is what makes `panic = "unwind"` reachable on this target at all now (via nightly + `-Zbuild-std`), where it wasn't before.
**Applies to us:** Every crate's explicit `panic = "abort"` (R23) is correct to keep even though it's currently redundant with the target default — it's a statement of intent that survives a future toolchain where the default might change, and it's consistent with this workspace's general practice of pinning exact behavior rather than inheriting implicit defaults (R32).
**Source:** https://doc.rust-lang.org/nightly/rustc/platform-support/wasm32-unknown-unknown.html (accessed 2026-09-03) — confirms the current default and describes the mid-2025 exception-handling stabilization and the `-Zbuild-std` path required to opt into unwind on this target today.

---

## 5. AoS at the boundary, SoA in the loop

### R32. `#[repr(C)]` AoS is correct at a foreign-read boundary because the foreign reader strides fixed offsets with no shared runtime to call through
**Why:** A foreign consumer reading wasm linear memory (TypeScript, through a `DataView`/`TypedArray`) has no way to call a Rust getter per field. It can only compute `base + index * stride + field_offset` and read raw bytes. That access pattern is exactly what AoS provides and exactly what SoA denies — SoA would require the JS side to know N separate array base addresses and stride each one independently, multiplying the surface area of the ABI instead of unifying it into one `stride` constant per record type.
**Applies to us:** The seven record types in `shaper/src/engine/render_plan.rs` are this codebase's concrete instance of the correct choice: `ResourceRecord`, `BufferRecord`, `PatchRecord`, `PrimitiveRecord`, `DrawRecord`, `RetirementRecord`, `DiagnosticRecord` are all `#[repr(C)]`, each with a `const _: () = assert!(core::mem::size_of::<T>() == N)` pinning its exact byte size (40, 36, 36, 64, 64, 24, 24 respectively, `render_plan.rs:171-177`). That assertion is a compile-time ABI contract: a field reorder or an added field that changes the size fails the Rust build at the exact site that defines the layout, instead of silently drifting until the TypeScript side reads garbage at runtime.
**Source:** direct codebase reading, `shaper/src/engine/render_plan.rs:32-177`; general FFI/repr(C) framing search-corroborated (accessed 2026-09-03).

### R33. Keep the internal hot loop SoA; materialize the AoS view once, at the boundary, not per access
**Why:** The transpose cost between SoA and AoS is real but it's a *fixed* cost paid once per publish — if it instead happened per access (e.g. by making the hot loop walk pre-transposed AoS records), the same transpose cost would be paid once per iteration instead of once per publish, for however many iterations that publish covers.
**Applies to us:** This is exactly the seam already drawn in this codebase: `EdgeSoa` (with its `LineSoa`/`QuadraticSoa`/`CubicSoa` parallel arrays, `mtsdf-core/src/outline.rs`) is the internal representation the per-pixel hot loop (`Distance4::evaluate`, `mtsdf-core/src/distance.rs`) walks, and it is never itself exposed across the wasm boundary. The AoS records in `render_plan.rs` are produced by a separate compilation step (`render_plan_compiler.rs`) that runs once per publish, not once per primitive drawn. Any new hot-loop data structure should follow the same shape: SoA internally, with a single, clearly-named function responsible for producing the AoS wire form — never a hot loop that walks `#[repr(C)]` AoS records directly.
**Source:** direct codebase reading, `mtsdf-core/src/outline.rs`, `mtsdf-core/src/distance.rs`, `shaper/src/engine/render_plan_compiler.rs` (existence and role confirmed via `reserve()` grep in this session), `shaper/src/engine/render_plan.rs`.

### R34. The transpose direction is decided by which side is foreign and which side is hot — not by a general "SoA is faster" rule
**Why:** SoA is faster specifically when a loop repeatedly accesses one or two fields across many records and doesn't need the rest — that's a property of the *access pattern*, not an intrinsic property of the data. The wasm/TypeScript boundary has the opposite access pattern: JS typically reads one full record at a time (all fields of one `DrawRecord` to issue one draw call), which is exactly what AoS is dense for, and what SoA would force into N separate strided reads to reassemble.
**Applies to us:** Resist framing this codebase's design as "SoA is correct, AoS is a necessary evil at the boundary" — both are correct for what each side of the boundary actually does with the data. `EdgeSoa` is SoA because `Distance4::evaluate` reads all edges' coordinates together, field by field, across thousands of edges per glyph. `DrawRecord` is AoS because a renderer consuming `RenderPlanView` reads one draw's worth of fields together, once, to issue one draw call. Neither choice generalizes to "always use X" — each is a direct consequence of its own access pattern.
**Source:** https://jamesmcm.github.io/blog/intro-dod/, James McMurray, July 25 2020 (accessed 2026-09-03) — "An introduction to Data Oriented Design with Rust," demonstrating ~50% improvement from SoA specifically for a field-repeated-across-many-entities access pattern, with the explicit caveat that the win comes from that access shape, not from SoA in the abstract. https://tweedegolf.nl/en/blog/88/data-oriented-design, Folkert, March 15 2023 (accessed 2026-09-03) — a parser/compiler case study with the same framing: 1.12x speedup and ~12% memory reduction from splitting a `Vec<Def>` into parallel arrays *because* most passes only touch a subset of fields; notably, a `Box<Def>` variant benchmarked in the same study was 1.69x **slower** than the plain `Vec<Def>` baseline — direct evidence against reflexively boxing enum-shaped record data, consistent with this codebase's one-`Box`-total measured fact.

### R35. Not every record type needs an internal SoA form — the tension only exists where both sides are hot
**Why:** SoA-vs-AoS is a real design tension only for data that's accessed in a tight loop on the Rust side *and* published across the boundary. A record type that's cold on the Rust side (constructed once, in low volume, never iterated field-by-field in a loop) gets no benefit from an internal SoA representation — there's no hot loop for SoA to speed up, only wire-format concerns, which AoS already satisfies.
**Applies to us:** `RetirementRecord` and `DiagnosticRecord` (`render_plan.rs`, 24 bytes each) are the likely examples here — diagnostics and retirements are emitted at low volume relative to `PrimitiveRecord`/`DrawRecord`, and nothing in this codebase suggests a per-pixel or per-glyph loop iterates them field-by-field the way `EdgeSoa` is iterated. Don't introduce an internal SoA staging structure for a record type until a specific hot loop over it is identified — until then, building it directly in its AoS wire form is both simpler and exactly as fast.
**Source:** direct codebase reading, `shaper/src/engine/render_plan.rs:131-154`, informed by R33/R34's framing.

---

## 6. Measurement discipline (cross-cutting)

### R36. Every claim in sections 2 and 4 above degrades to a guess without a specific measurement tied to this codebase's actual shapes
**Why:** Cache and wasm-engine behavior are both determined by hardware/engine internals this program cannot observe directly (R17, R28). Generic performance advice is a hypothesis about *typical* hardware; whether it holds for a specific glyph atlas cell size, a specific paragraph length, or a specific browser engine is an empirical question every time.
**Applies to us:** Treat R10–R17 (cache) and R25–R31 (wasm32) as a checklist of hypotheses to verify with `wasm2wat` (R21), `talc` counters or `dhat-rs` (R5), and warm-state browser timing (R29) — specifically against this codebase's real record sizes (`render_plan.rs`'s 24–64 byte records), real edge counts (`EdgeSoa` populated from actual font outlines), and real atlas cell dimensions (`mtsdf-baker`'s configured output sizes) — not against a synthetic microbenchmark shaped differently from the production hot path.
**Source:** synthesis of R5, R21, R28, R29 above.

### R37. A `talc` allocation-count regression test is cheaper to keep green than a cache-behavior claim, and catches a different class of bug
**Why:** Allocation-count regressions are deterministic and machine-portable (they don't depend on which CPU or browser engine runs the test) in a way cache-timing regressions never can be. They're the correct default measurement to wire into CI for this codebase's hot paths; cache/timing measurements are for targeted investigation, not continuous gating.
**Applies to us:** Wire a `talc`-counters-backed or `dhat-rs`-backed allocation-count assertion (R5) into the existing test/check surface for at least the two highest-volume hot paths this workspace has: `TextEngine` shaping a paragraph (`shaper/src/engine`) and `MtsdfGenerator::generate` rasterizing one glyph (`mtsdf-core/src/lib.rs`). A silent regression from "zero allocations in this loop" to "one allocation per pixel" should fail a fast, deterministic check, not wait to be noticed in a wall-clock benchmark someone happens to run.
**Source:** synthesis of R1–R6 above, https://docs.rs/dhat/latest/dhat/ (accessed 2026-09-03).

---

## Reading list

Verified directly (fetched or confirmed via direct search-result content) in this research session, 2026-09-03:

- **The Rust Performance Book** — N. Nethercote. Canonical, continuously updated reference; no single publish date. https://nnethercote.github.io/perf-book/heap-allocations.html, https://nnethercote.github.io/perf-book/bounds-checks.html, https://nnethercote.github.io/perf-book/profiling.html
- **bounds-check-cookbook** — Sergey "Shnatsel" Davidoff, GitHub repo, undated (actively maintained). Recipes with `cargo-show-asm`-verified assembly output for eliminating bounds checks without `unsafe`. https://github.com/Shnatsel/bounds-check-cookbook
- **"How much does Rust's bounds checking actually cost?"** — Readyset engineering blog, no publish date visible on the fetched page. Field data from a production codebase: manual `unsafe` conversion of 651 bounds checks regressed two representative queries 16–20%; a compiler build eliminating all bounds checks was within noise of baseline. https://readyset.io/blog/bounds-checks
- **talc** — SFBdragon (Shaun Beautement), GitHub. Primary source for the allocator this codebase uses on wasm32. General README and `README_WASM.md` (wasm-specific: `WasmGrowAndClaim` vs `WasmArenaTalc`). https://github.com/SFBdragon/talc
- **"The Impact of Memory Allocators on Performance: A Deep Dive"** — Arthur Pastel (CodSpeed founder), EuroRust 2024, Vienna & online, Oct 10–11 2024. https://eurorust.eu/2024/talks/the-impact-of-memory-allocators-on-performance-a-deep-dive/
- **"An introduction to Data Oriented Design with Rust"** — James McMurray, July 25 2020. Older than the 2023–2026 window requested, kept because it's the clearest primary AoS/SoA source found with a concrete ~50% benchmark and explicit access-pattern reasoning. https://jamesmcm.github.io/blog/intro-dod/
- **"Optimizing a parser/compiler with data-oriented design: a case study"** — Folkert de Vries, Tweede golf, March 15 2023. Real before/after numbers (1.12x speedup, ~12% memory reduction) and a documented `Box`-variant regression (1.69x slower). https://tweedegolf.nl/en/blog/88/data-oriented-design
- **"Rust, Memory performance & latency – locality, access, allocate, cache lines"** — Nazmul Idris, developerlife.com, May 19 2025. Concrete, dated cache-line and latency figures (64B Intel 14th-gen vs. 128B Apple M4 pairing; L1/L2/RAM relative latency multipliers). https://developerlife.com/2025/05/19/rust-mem-latency/
- **wasm32-unknown-unknown platform support** — The rustc book (primary/official). Confirms `bulk-memory`/`nontrapping-fptoint` default-on since Rust 1.87 + LLVM 20, `dlmalloc` as the target's default allocator, `panic=abort` as the target default, and the mid-2025 exception-handling stabilization path to `panic=unwind`. https://doc.rust-lang.org/nightly/rustc/platform-support/wasm32-unknown-unknown.html
- **`WebAssembly.Memory.prototype.grow()`** — MDN (primary/official). Confirms every `grow()` call detaches existing `ArrayBuffer`/`TypedArray` views, even `grow(0)`; shared-memory exception noted. https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
- **"A year with Spectre: a V8 perspective"** — V8 blog (official). Source for the `performance.now()` precision reduction and `SharedArrayBuffer` disable as Spectre mitigations, underpinning why in-browser cache-timing measurement is unavailable by design. https://v8.dev/blog/spectre
- **WABT (WebAssembly Binary Toolkit)** and **wasm-tools** — the two actively-maintained tool sets for `wasm2wat`/`wasm-objdump`-style inspection of emitted wasm, used throughout section 3 and 4's verification steps. https://github.com/WebAssembly/wabt, https://github.com/bytecodealliance/wasm-tools
- **dhat** (dhat-rs) — docs.rs, primary crate documentation. `dhat::HeapStats` and testing-mode profiler for allocation-count regression tests. https://docs.rs/dhat/latest/dhat/

Found but explicitly not used as a rule source, with reason:

- **"How to avoid bounds checks in Rust (without unsafe!)"** — Shnatsel, Medium. Direct `WebFetch` returned HTTP 403; content was corroborated only through a search-engine result excerpt quoting the article directly (slice-before-loop, assert-on-range patterns), not a full fetch. Treated as lower-confidence than the same author's GitHub cookbook, which fetched cleanly.
- **EuroRust 2025, "Rust's Memory Model: The Logic Behind Safe Concurrency"** — Martin Ombura Jr., Paris & online, Oct 9–10 2025. Fetched and confirmed real, but its subject is concurrency memory *ordering* (Relaxed/Acquire/Release/SeqCst, `Mutex`/`Once`/`Arc`) — a different "memory model" than this document's topic, and not applicable to a single-threaded wasm engine with zero `Arc`. Not cited as a rule source to avoid conflating the two meanings of "memory model."
- A cluster of SEO-aggregator sites returned by search (oneuptime.com, daily.dev, developers-heaven.net, calmops.com, elitedev.in, rustfaq.org, blog.rajpoot.dev, rustycloud.org, softwarepatternslexicon.com) — excluded entirely. These show the pattern of templated, undated, non-attributed content mills rather than practitioner writing, and none were fetched or cited.
- A specific RustConf 2023–2026 talk on data layout/cache/SoA specifically — searched for directly, not found. Not naming one rather than guessing.
- LLVM's exact size threshold for inlining a small copy instead of emitting `memory.copy` (R26) — found described in secondary search results (rust-lang/rust and LLVM issue trackers) but not independently confirmed by reading LLVM source in this session. Flagged as unconfirmed in R26 itself rather than stated as fact.
