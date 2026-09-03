---
type: Audit Report
title: Rust code audit — semantics, performance principles, and idiom
description: Measured audit of the twelve Rust crates against a researched codex, recording what holds, what does not, and the work outstanding. Includes the confirmed defects, the deliberate design laws that must not be reported as defects, and the tooling added to make the audit repeatable.
documentation_type: explanation
tags: [rust, audit, wasm, performance, unsafe, data-oriented]
status: draft
sources:
  - id: code-style
    resource: ../engineering/code-style.md
    title: Engineering house style
  - id: decision-register
    resource: decision-register.md
    title: Decision register
  - id: wasm-size-reduction
    resource: wasm-size-reduction.md
    title: Shaper and baker Wasm size reduction
generated:
  by: anthropic-claude/opus-5
  at: '2026-09-03T00:00:00Z'
---

# Rust code audit

Audited at `feat/glyph-config-api` @ `12738c23`: twelve crates, 63,243 lines, `rustc 1.97.1`,
edition 2024, all `no_std + alloc`, shipping to `wasm32-unknown-unknown` with `talc`.

Every claim below is a measurement or an experiment. Where a finding was downgraded or withdrawn
during the audit, the correction is recorded rather than removed — a reviewer needs to know which
conclusions were tested.

## The design laws this codebase holds deliberately

These are correct and must not be reported as defects by a future audit. Each was verified.

| Law | Evidence |
| --- | --- |
| Data-oriented: SoA arenas, integer indices | 8 arenas with ≥8 parallel columns; `ClusterArena` has 26 |
| No shared ownership | 0 `Arc`, 0 `Rc`, 0 `RefCell`, 0 `Cow`, 1 `Box` (host-only binary) |
| Zero allocation in steady state | Arenas `clear()` and refill retaining capacity; 145 production `try_reserve` |
| No runtime checks in hot loops | 0 assert-family calls inside any loop body, 48 files |
| Bounds-check elision by iterator structure, not `unsafe` | 0 `get_unchecked`, 0 `for i in 0..len`, max loop nesting 3 |
| Panic-free by construction | 0 production `unwrap()` in 63k lines |
| Scalar-only C ABI | All 86 `extern "C"` functions pass and return primitives only |
| Generated layout contract | `abi_contract.rs` derives every entry via `size_of`/`align_of`/`offset_of!` |

The last two matter more than they look. Rust's `wasm32` C ABI is not clang's — Rust splats small
structs where clang uses an `sret` pointer — so passing a `#[repr(C)]` struct by value across a
signature would be a portability trap. The codebase sidesteps it by passing pointer/length pairs as
`u32` and keeping the layout contract in shared buffers, where it is generated from the types and
versioned by `RESPONSE_MAGIC` + `ABI_VERSION` + a generator stamp.

`Arc<[T]>` over `Vec<T>` was considered and rejected on evidence: nothing here is shared or cloned,
and `Arc<[T]>` has no capacity field, so adopting it would replace a zero-allocation steady state
with one allocation and memcpy per frame. On `wasm32` without `+atomics`, `Arc::clone`'s `fetch_add`
and an `Rc`-style `Cell` bump compile to byte-identical wasm, so there is no `Arc`-vs-`Rc`
performance question on this target either.

## Confirmed defects

### R1 — `StablePlanCompiler::abort()` can discard committed batches
**High impact, low likelihood.** `stable_plan.rs:575`, `state.rs:1468`, `wasm.rs:1144`.

`committed_batch_count` is snapshotted in `prepare_with_strategy_filter` (`stable_plan.rs:303`) and
never advanced by `commit()`. `commit()` has four fallible `?` points inside a loop over batches, so
a failure at batch *k* leaves batches `0..k` already promoted to live state. The recovery path
(`publish_prepared_failure`) then calls `abort_update` unconditionally, and its revision-CAS guard
does not fire — precisely because the failed commit never reached `planner.revision = prepared.next`
(`state.rs:1508`). `abort()` truncates `batches` to the pre-transaction count, discarding committed
work.

`OrderedPlanCompiler::abort` is the correct model: it clears pending state and touches nothing live.

Fix per the house rule — publish only after all fallible work succeeds: do the per-batch fallible
work into pending state, then swap. Note `let _ = state.engine.abort_update(prepared)` also discards
the abort's own error.

### R2 — `dispose_font_binding` has no in-use guard
**High.** `state.rs:351`.

Its two siblings guard. `dispose_font_stack` (`state.rs:436`) returns `Result` and refuses with
`EngineError::RegistrationInUse` when `planners.values().any(|p| p.references_font_stack(handle))`.
`dispose_font_binding` returns `()` — it structurally cannot refuse — and `swap_remove`s
unconditionally. The export `pmndrs_glyph_engine_dispose_font_binding` (`wasm.rs:204`) hardcodes
`STATUS_OK`.

The predicate already exists: `references_binding` is `pub` at `state.rs:464`, and its only callers
in the entire crate are two test assertions. It was written, tested, and never wired to the path it
was written for. `STATUS_FONT_IN_USE` (14) and `STATUS_REGISTRATION_IN_USE` (20) both exist and are
used by the sibling paths.

A live paragraph referencing a disposed binding fails later on an unrelated frame with a
misleadingly-named `FontStackMissing`.

### R3 — chunk-64 fast path skips `trailing_space_units`
**High.** `line_composition.rs:280-327`.

`layout_next_line_integer`'s chunk skip updates `advance` and `space_units` but not
`trailing_space_units`, so a required break immediately after or straddling a skipped 64-cluster
chunk gets the wrong hang discount — breaking a word early or letting a line overflow. Both existing
chunk-boundary tests miss the alignment (spaces land at 26/64 and 35/64, not 63/64).

### R4 — the ABI surface is invisible to every lint
**High.** All crates.

`cargo clippy --all-targets -- -D warnings` runs on all eleven crates from `check.mts` — a real gate
— but **host-target only**. Two independent blind spots defeat it:

1. Every crate declares `mod wasm;` **private**. `#[unsafe(no_mangle)]` exports the symbol, but
   Rust's visibility system treats it as unreachable, so `missing_safety_doc`, `missing_docs`, and
   `unreachable_pub` skip the whole ABI. Verified by probe: the identical function is linted at
   crate root and in a `pub mod`, and silently skipped in a private `mod`. Enabling `pedantic` or
   `nursery` changes nothing.
2. `shaper/src/lib.rs:14` and `font-baker/src/lib.rs:19` also gate `mod wasm;` behind
   `#[cfg(target_arch = "wasm32")]`, so a host clippy run never compiles the module holding 22 of
   the 46 `unsafe fn`.

Consequence: 46 of 46 `unsafe fn` lack a `# Safety` section and nothing reports it. Of those, 16
have bodies performing **no unsafe operation at all** — they validate guest ranges through a safe
allocation-table lookup and never dereference a raw pointer — so they should drop `unsafe` entirely.
The remaining 30 need real contracts.

A lint gate here must also use a cold `CARGO_TARGET_DIR`: a warm clippy cache emits no warnings at
all and passes vacuously.

### R5 — justification ratios are validated in TypeScript, not at the ABI
**Medium.** `positioning.rs:1837`, `semantic_wire.rs:296`.

`justification_adjustment` guards `maximum_word_space_ratio > 0.0` but computes `ratio - 1.0`, so
any value in `(0.0, 1.0)` passes the guard and hands `apply_ratio` a negative ratio, silently
flipping word-space expansion into shrinkage. `apply_ratio` is total (it handles NaN and saturates)
but has no precondition check.

**Severity corrected during the audit.** The reviewing agent rated this high on the assumption that
nothing validated the field. `src/text-properties.ts:250-253` does — it throws `RangeError` for
`minWordSpaceRatio` outside `(0, 1]` and `maxWordSpaceRatio` below 1. So the public API is safe and
the exposure is the raw ABI, which is exported and callable by anyone who loads the module. TS
validation does not defend a wasm export.

### R6 — no workspace root
**High, structural.** `packages/glyph/rust/`.

Twelve standalone crates, twelve `Cargo.lock` files, no workspace. Measured consequences:

- **rust-analyzer cannot index the tree at all** — it crashes with no project to resolve. That is
  why type-dependent questions in this audit had to be answered by reading rather than tooling.
- `[workspace.lints]` inheritance is impossible, so lint policy cannot be expressed in Cargo at all;
  `#[allow]` appears 41 times and `#[expect]` zero times despite edition 2024.
- `shaper` resolves `read-fonts` 0.41.0 (held by `harfrust`) while every baker resolves 0.42.1 — the
  product parses the same font with two parser versions depending on whether it is shaping or
  baking. `skrifa` is exact-pinned in five crates and floating in two.
- `[profile.release]` is duplicated eleven times; cargo ignores it in the five pure-library crates,
  because profiles apply only to the top-level package. Only `font-baker` sets `opt-level = "z"`.

### R7 — the shipped shaper requires wasm SIMD, with no fallback
**High.** Build pipeline.

`dist/text-shaper.wasm` provably contains `v128.load` (`wasm-opt` rejects it without
`--enable-simd`). `build.mjs:60` defaults `PMNDRS_GLYPH_SHAPER_SIMD` on, only one artifact ships, and
no capability probe exists in the TypeScript. A wasm module is validated as a whole, so one `v128`
opcode makes a non-SIMD engine reject the entire module — the library does not load. simd128 shipped
in Safari only at 16.4 (March 2023).

The Rust gating is already correct (`#[cfg(all(target_arch = "wasm32", feature = "simd128"))]`), and
both target directories exist. What is missing is shipping the second artifact and selecting at load.

### R8 — the SIMD twins cannot be differentially tested
**Medium.** `cluster_state.rs`, `kernel_lab.rs`, `line_kernels.rs`.

Each SIMD kernel and its scalar twin are `#[cfg]`-exclusive, so the scalar reference is never
compiled in the same build as the kernel and no test can compare them. `sum_advance_units`
correctness rests on a ±2^53 × 64 bound stated in a comment; the SIMD path wraps (`i64x2_add`) while
the scalar path does not. Make the scalar oracle unconditional and let `cfg` select only which one
the caller uses, so a property test can compare them in one build.

### R9 — a hot function indexes three columns by one length
**Medium.** `cluster_state.rs:525`.

`intrinsic_widths` iterates `0..self.starts.len()` while indexing `self.flags[index]` and
`self.advances[index]` — three columns, one length — and is the only loop in the file not using
iterator structure, so it pays two to three bounds checks per cluster.

Hoisting fixes both concerns at once and is strictly fewer branches than today:

```rust
let count = self.starts.len();
let flags_col = &self.flags[..count];       // one check, hoisted
let advances_col = &self.advances[..count]; // one check, hoisted
```

### R10 — retained plan state grows with edit history
**Medium.** `stable_plan.rs:107`, `ordered_plan.rs:437`.

`StablePlanCompiler.batches` is push-only; dead `StableBatch` entries are never pruned, so per-update
cost tracks a document's batch-key churn rather than its live content. Compounding it, per-glyph
batch routing is a `Vec::position` linear scan — O(glyphs × distinct batches) — while an O(1)
hash-lookup pattern (`identity_index.rs`) exists in the same module.

## Corrections made during this audit

Recorded because a future reader needs to know which conclusions were tested and revised.

- **653 casts → 60.** The initial count treated every `as` as suspect. On `wasm32`, `usize` is 32
  bits, so the 324 `usize`/`isize` casts are no-ops on the shipping target. The real surface is 60
  narrowing casts to sub-32-bit types, in eight files.
- **"Twenty-seven unpinned `repr(C)` structs" was withdrawn.** Generation from the types is the
  safety mechanism; the nine `const _: assert!(size_of..)` are change-detectors. Recommending 27 more
  would be busywork.
- **"`pub` in private modules is decorative" was wrong.** Those items are re-exported through
  facades and genuinely reachable; `unreachable_pub` is 0 across all ten library crates. The wasm
  ABI is the real exception because `no_mangle` exports without `pub use`.
- **"No lint policy exists" was too strong.** `check.mts` gates clippy with `-D warnings` on every
  crate. The defect is narrower and worse: the gate cannot see the ABI.
- **Four in-loop "allocations" were analyzer false positives.** `Range<usize>` is not `Copy`, so
  `range.clone()` is required and free. AST structure alone cannot answer whether a `.clone()`
  allocates.

## Tooling added

`packages/glyph/rust/ast-facts` + `packages/glyph/scripts/ast-facts.mts`, registered as
`glyph:ast-facts` and gated by `check.mts` alongside the shipped crates.

```bash
mise exec -- pnpm scripts run glyph:ast-facts -- --out .cache/ast-facts.jsonl
```

Emits one JSON object per function and struct — loop nesting, allocations inside loops, casts by
target type, `unsafe` blocks, `# Safety` presence, arena column counts — parsed with `syn` rather
than matched with a regex, because loop scope and `#[cfg(test)]` scope are not regular languages.

It deliberately separates `definite_alloc_in_loop` from `type_dependent_in_loop`: `syn` is a parser,
not a compiler, so `Range::clone()` and `Vec::clone()` are indistinguishable to it. Read the
type-dependent sites before believing them.

## Outstanding work

Ordered by value, not effort.

1. **Fix R1.** Make `StablePlanCompiler::commit()` atomic. It is the only finding that can corrupt
   retained state.
2. **Fix R2.** Wire `references_binding` into `dispose_font_binding`; return `Result` and map to
   `STATUS_REGISTRATION_IN_USE`, matching the siblings.
3. **Fix R3**, and add a chunk-boundary test with a space at 63/64.
4. **Ship the scalar shaper artifact and probe for SIMD at load (R7).** Confirm the scalar build
   passes the suite and measure its size and speed first. If the scalar path is unacceptable, a
   documented minimum-engine policy is a legitimate answer — but it should be a recorded decision
   rather than a default nobody chose.
5. **Drop `unsafe` from the 16 functions that perform no unsafe operation, and write `# Safety`
   contracts for the remaining 30 (R4).**
6. **Add a workspace root (R6)**, move the profile there once, resolve the `read-fonts` split, and
   settle a pinning policy. This also restores rust-analyzer, which restores type-aware review.
7. **Make the ABI visible to the lint gate (R4)** — `pub mod wasm;`, or a CI step running clippy
   against `--target wasm32-unknown-unknown` with a cold target directory.
8. **Make the SIMD scalar oracle unconditional and add a differential property test (R8).**
9. **Hoist the column slices in `intrinsic_widths` (R9).**
10. **Prune dead batches and replace the linear batch scan (R10).**

Not recommended, with reasons: splitting `state.rs` for its line count (its complexity is
load-bearing; one clean extraction of the shaping-run cluster exists if wanted);
`clippy::arithmetic_side_effects` (the targeted `cast_*` lints catch the real bugs with far less
noise); adding runtime checks in hot loops (contrary to a deliberate and correct law — use
`debug_assert!`, which compiles out of this release profile, or a test).
