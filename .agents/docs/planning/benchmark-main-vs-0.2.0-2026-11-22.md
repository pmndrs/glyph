---
type: Log
title: 'Benchmark: main vs 0.2.0 headline workloads, 2026-11-22'
description: 'Interleaved browser timings of width-sweep reflow, long-paragraph editing and the animated ASCII frame on main 4e25a96a and the 0.2.0 integration tip, with branch CPU profiles and Job 1 verification.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T07:38:07Z'
---

# main vs 0.2.0 integration branch: headline workloads, 2026-11-22 (UTC)

Main = `4e25a96a` (packed tarball, sha256 `95bd8ebd…`, identical to the 2026-11-21 main tarball). Branch =
`experiments/segment-indexed-layout` @ `bcc5b8644` (packed after a fresh install and build, sha256 `68433dd4…`).
Apple M4, macOS 26.7.1, Google Chrome headless with WebGPU, one fresh browser per load, Playwright via
`profile-harnesses/browser/run.mts`. Load average was 2.4–4.1 throughout. A `sidepulse` status-bar process used
about 25% of one core the whole time.

**Scope.** The coordinator reordered the work partway through, so this covers only the three headline workloads and
the trimmed matrix: Latin ~2,250 words / 14,850 glyphs, the 22k stress paragraph (21,600 glyphs), and one
bidi/Amiri reflow case (15,130 glyphs). The full Labs suite did not run. Round 1 was killed partway through the main
arm and saved no results.

## Method

- Interleaving: 3 rounds. In each round every config ran main first, then branch, so the order was A B A B.
- Timed operation: every step runs through to a GPU-completed frame. The step is: mutate (and `measure()` where the
  workload reads layout), then `scene.updateMatrixWorld(true)` (publish), then `renderer.render`, then
  `device.queue.onSubmittedWorkDone` (GPU wait). Steps are paced by `requestAnimationFrame`.
- Value per load: the median of all steps in that load. Row value: the median of the 3 loads. Spread: (max − min) /
  median across loads.
- Verdict: "faster" or "slower" only when the ratio is beyond ±10% and the two arms' per-load ranges do not overlap.
  Otherwise "same".
- Reflow: `maxWidth` sweeps 600→300→600 px in 4 px steps, 151 steps.
- Edits:
  - Type at end, insert in the middle and delete in the middle: 100 steps each, cumulative.
  - Paste of 200 characters in the middle: 40 steps. Each paste is followed by an untimed undo.
  - Branch uses `replace(start, end, insert)`. Main uses the whole-string `text` setter, its only public edit path.
  - Glyph and line counts match across arms.
- ASCII demo: no standalone animated ASCII demo exists in `apps/`, `benches/` or on any branch. The one ASCII
  animation in the tree is the frame from `benches/src/retained-upload-proof.ts` (`benchmark:retained-uploads`,
  "ASCII-rich Text"), so that is what was measured:
  - 240 coloured 12-character spans, 2,880 glyphs, Inter bitmap 16, group batching.
  - Animated with `text.set({ text })`, advancing the character and palette phase every frame.
  - 300 frames after 30 warm-up frames.
  - This source file is identical on both arms.

## Headline: complete frame, per-step median ms

| workload           | config                  |  main | branch | branch/main | verdict                  | spread m/b | branch CPU | branch > 4 ms |
| ------------------ | ----------------------- | ----: | -----: | ----------: | ------------------------ | ---------- | ---------: | ------------- |
| 1 reflow sweep     | Latin 15k, Inter MTSDF  |  2.95 |   3.25 |        1.10 | same (borderline slower) | 2% / 3%    |       1.87 |               |
| 1 reflow sweep     | stress 22k, Inter MTSDF |  3.49 |   3.96 |        1.14 | **slower**               | 5% / 2%    |       2.55 |               |
| 1 reflow sweep     | bidi 15k, Amiri bitmap  |  6.23 |   4.70 |        0.76 | **faster**               | 2% / 2%    |       3.26 | FLAG          |
| 2 type at end      | Latin 15k               |  9.41 |   5.06 |        0.54 | **faster**               | 2% / 2%    |       3.61 | FLAG          |
| 2 type at end      | stress 22k              | 12.80 |   6.54 |        0.51 | **faster**               | 3% / 0%    |       4.97 | FLAG          |
| 2 insert middle    | Latin 15k               |  7.70 |   5.25 |        0.68 | **faster**               | 2% / 5%    |       3.74 | FLAG          |
| 2 insert middle    | stress 22k              | 14.57 |   6.54 |        0.45 | **faster**               | 1% / 0%    |       4.97 | FLAG          |
| 2 delete middle    | Latin 15k               |  7.68 |   5.15 |        0.67 | **faster**               | 5% / 6%    |       3.64 | FLAG          |
| 2 delete middle    | stress 22k              | 14.64 |   6.62 |        0.45 | **faster**               | 1% / 0%    |       5.07 | FLAG          |
| 2 paste 200 middle | Latin 15k               |  7.94 |   5.17 |        0.65 | **faster**               | 5% / 4%    |       3.67 | FLAG          |
| 2 paste 200 middle | stress 22k              | 14.93 |   6.76 |        0.45 | **faster**               | 2% / 1%    |       5.22 | FLAG          |
| 3 ASCII frame      | 2,880 glyphs, 240 spans |  5.75 |   4.82 |        0.84 | **faster**               | 1% / 1%    |       3.53 | FLAG          |

The FLAG column marks a branch total above 4 ms. Totals include about 1.3–1.6 ms of GPU wait. On CPU time alone,
the branch rows above 4 ms are the 22k edits (4.97–5.22 ms).

### Stage split (main / branch, ms per step)

| workload          | mutate+measure | of which `measure()` | publish     | render() CPU | GPU wait    | draws | writeBuffer KB/frame |
| ----------------- | -------------- | -------------------- | ----------- | ------------ | ----------- | ----- | -------------------- |
| sweep Latin 15k   | 0.29 / 0.51    | 0.21 / 0.45          | 0.93 / 1.17 | 0.17 / 0.16  | 1.59 / 1.38 | 3 / 2 | 15 / 16              |
| sweep 22k         | 0.34 / 0.67    | 0.26 / 0.61          | 1.29 / 1.66 | 0.17 / 0.18  | 1.70 / 1.39 | 3 / 2 | 22 / 23              |
| sweep bidi Amiri  | 0.26 / 0.83    | 0.18 / 0.75          | 3.93 / 2.10 | 0.39 / 0.33  | 1.61 / 1.47 | 3 / 2 | 720 / 488            |
| type end 22k      | 8.69 / 2.15    | —                    | 2.15 / 2.38 | 0.17 / 0.44  | 1.79 / 1.58 | 3 / 2 | **27 / 1010**        |
| insert middle 22k | 8.66 / 2.02    | —                    | 3.69 / 2.50 | 0.39 / 0.41  | 1.83 / 1.58 | 3 / 2 | 899 / 1016           |
| ASCII frame       | 0.59 / 0.21    | —                    | 3.59 / 3.12 | 0.20 / 0.20  | 1.37 / 1.31 | 3 / 2 | 175 / 152            |

**Findings.**

- `measure()` right after a width change is still about 2× main on Latin (0.45 vs 0.21 ms) and on 22k
  (0.61 vs 0.26 ms). On bidi it is about 4× (0.75 vs 0.18 ms).
- On the Latin and 22k sweeps, publish is also slower: 1.17 vs 0.93 ms and 1.66 vs 1.29 ms.
- Bidi reflow wins overall because its publish halves.
- Typing at the end uploads about 1 MB per frame on the branch against 27 KB on main, roughly the whole instance
  buffer.

The `wasmclock=1` loads split each stage into Wasm and host time (per step, main / branch), for example on 22k:

| workload (22k) | Wasm in mutate+measure | Wasm in publish | host JS     | GPU API     |
| -------------- | ---------------------- | --------------- | ----------- | ----------- |
| sweep          | 0.21 / 0.48            | 1.02 / 1.40     | 0.38 / 0.39 | 0.03 / 0.04 |
| insert middle  | 8.42 / 1.93            | 3.38 / 2.29     | 0.66 / 0.44 | 0.28 / 0.31 |

For the ASCII frame, Wasm in publish is 3.18 / 2.87 ms and host JS is 1.17 / 0.54 ms. All rows are in `tables.md`.

## CPU profiles (branch, unminified consumer, 100 µs sampling, named Wasm from `glyph:shaper-profile-artifact`)

Shares are of busy (non-idle) sampled time. The Wasm stages are assigned by Rust symbol keyword (`cpuprofile.py`);
"render plan" is `ordered_plan`.

| workload          | busy ms | Wasm | gather / publication | render plan | positioning | line breaking / flow | cluster | shaping | Unicode + bidi | alloc | glyph JS | Three JS | GPU upload (writeBuffer) |
| ----------------- | ------: | ---: | -------------------: | ----------: | ----------: | -------------------: | ------: | ------: | -------------: | ----: | -------: | -------: | -----------------------: |
| 1 sweep Latin 15k |     228 |  77% |                  34% |          8% |         11% |                   7% |    0.4% |      0% |             3% |    2% |       9% |       5% |                       2% |
| 2 edits Latin 15k |   1,438 |  82% |                  22% |         10% |          5% |                   6% |     11% |      6% |             8% |    6% |       6% |       2% |                       5% |
| 3 ASCII frame     |     968 |  84% |                   6% |          3% |          2% |                   2% |      3% | **59%** |             2% |  0.6% |       8% |       2% |                       2% |

Top self-time functions:

1. **Sweep.**
   - `codec_gather::columns::RowSource::fill`: 27.5 ms
   - `CodecGatherWorkspace::retain_column`: 23.1 ms self, 67.0 ms inclusive
   - `memcmp`: 17.0 ms
   - `OrderedPlanCompiler::prepare_internal`: 11.7 ms self, 52.9 ms inclusive
   - `codec::execute_program`: 9.0 ms
2. **Edits.**
   - `codec::execute_program`: 101 ms
   - `RowSource::fill`: 96 ms
   - `writeBuffer`: 72 ms
   - `OrderedPlanCompiler::prepare_internal`: 70.6 ms self, 304 ms inclusive
   - `CodecGatherWorkspace::append_column`: 56.9 ms self, 262 ms inclusive
   - `run_local_kernel::layout_run`: 41.5 ms
3. **ASCII frame.**
   - HarfRust `ChainedSequenceContext` contextual lookup: 318 ms self, 387 ms inclusive
   - `ot_layout::apply_forward`: 527 ms inclusive
   - `set_glyph_flags`: 27 ms
   - Gather (`retain_column`, `RowSource::fill`): about 28 ms combined
   - In other words, the animated frame is dominated by reshaping 2,880 characters every frame.

Reports: `headline/profile-reports/*.md`; raw: `headline/profiles/`.

## Job 1 (verification of `bcc5b8644`): all passed

| step                                  | result                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and build                     | `pnpm install --frozen-lockfile`, `node_modules/.vite` caches deleted, `@pmndrs/glyph` rebuilt: exit 0                                                                                              |
| Native layout oracle, full tier       | Exit 0. Differential: 904 runs, 54,240 requests, 0 unlisted divergences. Reference set: 590 cases equal, 0 differ.                                                                                  |
| Wasm oracle, full tier                | Exit 0                                                                                                                                                                                              |
| Shaper `cargo test --features oracle` | 626 passed, 0 failed, 2 ignored. The Tamil conjunct test `a_conjunct_of_a_real_font_moves_as_one_unit` ran rather than skipped: re-run with `--nocapture`, it passed and printed no "skipped" line. |
| `pnpm --filter @pmndrs/glyph test`    | 1,432 passed, 0 failed                                                                                                                                                                              |
| `benchmark:pixi3d-parity`             | ok                                                                                                                                                                                                  |
| `benchmark:typegpu-parity`            | ok                                                                                                                                                                                                  |
| `benchmark:v1-bitmap`                 | exit 0                                                                                                                                                                                              |
| `benchmark:v1-bitmap -- --typegpu`    | exit 0                                                                                                                                                                                              |
| `typegpu:live-check`                  | ok                                                                                                                                                                                                  |
| `benchmark:three-storage-lifetime`    | exit 0                                                                                                                                                                                              |
| `benchmark:material-position`         | 24 cases passed                                                                                                                                                                                     |
| `pnpm check`                          | Exit 0. One OKF warning: a footnote in `segment-indexed-layout-handoff.md` has no matching source.                                                                                                  |

Logs are in `job1/`.

Raw results and harness: `/Volumes/Depot/Developer/glyph-baselines-2026-11-22/` (local, not committed).
