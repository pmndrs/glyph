# E6 bounded direct row-view implementation handoff

21 October 2026. Isolated source: `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo`, corrected E5 Rust source `be6c7960dd7eda8917bc43422edadca1970c1278` atop original `277417596afbe2a8cd87454317d05607dc9ba51b`. Current HEAD `b331b12b26c17d861c5570caf76ddbe4feb75eb6` contains separate docs/tooling commits. No Rust commit, stage, checkout, reset, stash, push, package, benchmark, or profile was performed in this wave.

## Owned change and deletion

`state.rs` now has a preparation-call-scoped `DirectRowView` that borrows a `DirectRowContext` and owns its 9 f32 plus 8 u32 semantic slice-reference arrays. `DirectRowContext::view` constructs them once. `DirectRowView::f32/u32` still makes a short `LayoutPlanInput` at each load and calls the existing `source_f32/source_u32` authority. It deletes the two semantic array extractions from *each* operand load. The sole existing test helper that directly read `DirectRowContext` now constructs one view per row.

`codec.rs` lazily creates one view at the first active load within each scalar record, or four views at the first active load within a SIMD group. Later active operations reuse those views in program order. Preexisting `row()` resolution remains once per scalar row/four per SIMD group. Packed `v128_load` and its validation are unchanged. No view exists for a record/group with no active load. `work_attribution.rs` adds only `direct_semantic_view_constructions`; the native replay ledger and focused assertion in `transport/bitmap_replay_auth.rs` expose/check it.

The setup term changes from O(L × 17) slice-reference extraction to O(P_loaded × 17), where L is active operand loads and P_loaded is selected rows with active loads. O(L + S + B) source reads, candidate walk, and physical work remain. At most four views live on the stack; there are no heap or persistent columns. The 20-byte locators and candidate workspace remain. The existing scalar/SIMD interpreter, eligibility, fallback, data layout, and ABI remain unchanged.

## Ownership and error proof

The view borrows positioned slices, binding and selected strike for only the codec call. It stores no self-referential descriptor; `LayoutPlanInput` borrows the view's arrays for each call to the original source resolver. The arrays are references only and their construction cannot return a source error. Active masks still skip operations before a view is constructed. The first and later source reads occur at the same operation and lane in the same order, including four SIMD lanes 0..3; finite checks and output stores remain where they were. No declared unused field is newly read. This wave did not fuse owner preflight, change source coordinates, or alter renderer rollback.

## Actual gates and frozen evidence

- `glyph:shaper-format`: pass (`format.stdout`, `.stderr`, `.exit`). `git diff --check`: pass.
- `glyph:static-check`: pass (`static.*`); its source runs pinned Rust fmt check and Clippy `--locked --all-targets -- -D warnings` alongside package static checks.
- `glyph:shaper-tests`: pass (`shaper-tests.*`): 490 library tests and 13 additional integration/conformance tests passed, 1 ignored authenticated replay test. Focused scalar-tail test also passed independently (`focused-native.*`).
- `benchmark:bitmap-native-work-replay`: pass (`bitmap-native-replay.*`), against frozen `full-05` trace SHA-256 `51667f42fd2f4bde967dffab2b18048cf38a35174142952f09999815186d0fa6` and manifest SHA-256 `09eb23a2fe41bad3578a4dfd8d42403ee66586da555f358f6317a477e3695412`. It authenticated 6,157 events, 4,099 results, and 1,977,392 encoded result bytes exactly. Ledger SHA-256 `e69193c205135c1b1d1c5c39d0e04ffa0b041347350df4af37edfc4902984520`; identity SHA-256 `3df3e9db9092253b3f136a23aad1a2fca04f6c42151fd2dc8ab980cd8961297a`.
- Per forward and reverse publication, the replay asserts 9,216 semantic view constructions for 9,216 selected rows, versus 138,240 f32 and 36,864 u32 active loads (175,104 total). Physical comparison is 589,824 bytes and actual emitted writes are 368,640 bytes per direction. The separate `elidedFullFieldWrites` count is hypothetical avoided gather writing, not emitted output.

Frozen owned product SHA-256: `state.rs` `c11754546b96c5e8de949a163a5717c6fb45bc9b742cbb0f0abce09c2f1ab959`; `codec.rs` `66f3302c781b7af7d3e4c5c831977da77805e8c714e3330c2957d460af5e72d2`; `work_attribution.rs` `9e47aa897405061c99d868dd00cf619a459cd062d5acffe57fcbf985baf22591`; `transport/bitmap_replay_auth.rs` `f13a1e468c69c3ffc727deb5f00f7f7b393b5fa3a265d964adc51d2a854f8de9`.

## Remaining gates and limits

This is native scalar proof, not shipped Wasm SIMD utilization or latency parity. The E5 native correctness suite had transport failure and renderer recovery coverage; those product paths were not freshly rerun here. Native fuzz/OOM was not run. Independent cold output oracles already cover scalar tails, mode transitions, source/strike/recordless and masks in the full native suite; this wave added only the distinct construction count to the exact replay. Fresh High review, frozen shipping package, seven-family main/release/E2 matrix, size/memory/browser/lifetime gates remain under root ownership. No partial speed win is claimed until those gates run.
