---
type: Decision
title: "Run the shaper's final wasm-opt pass at -O3"
description: 'The core shaper is optimized with the D-244 merge sandwich at -O3 instead of -Oz; the bakers keep -Oz, and -Zfmt-debug/-Zlocation-detail stay off because they change nothing.'
decision_status: Proposed
decided: '2026-11-24'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T02:47:34Z'
---

# Run the shaper's final wasm-opt pass at -O3

## Decision

`shaperOptimizationArguments` in `packages/glyph/scripts/support/shaper-build.mjs` is
`--one-caller-inline-max-function-size=0 --merge-similar-functions -O3 --merge-similar-functions -O3` for
`text-shaper.wasm`. The bakers keep `-Oz`. The Rust side is unchanged: no `-Zfmt-debug=none` and no
`-Zlocation-detail=none`. A later change to the shaper's level must show the same thing this one did: equal or better
speed on the browser headline and the engine Labs, and whole-module gzip -9 no worse.

## Why

All variants were optimized from one raw Rust module (`9b9fc6d49`, rustc 1.97.1, Binaryen 129). Its `-Oz` output is
byte-identical to the packed `dist/text-shaper.wasm` at that commit, and the `-O3` output is byte-identical to the
rebuilt `dist` after this change.

**Rust flags.** With `-Cpanic=immediate-abort` and `-Zbuild-std=core,alloc` already set, adding `-Zfmt-debug=none`,
`-Zlocation-detail=none`, or both gives a raw module byte-identical to the baseline (same sha256). The flags reached
every crate's rustc invocation (checked in the Cargo fingerprints). Panic sites already trap without formatting, and
the remaining `Debug` impls are dead. There is nothing to measure, so neither flag is added.

**Sizes** (gzip -9 and Brotli 11 are Node zlib):

| level (with merge sandwich)      |                   raw |           gzip -9 |         Brotli 11 |
| -------------------------------- | --------------------: | ----------------: | ----------------: |
| `-Oz` (D-244, before)            |             1,410,403 |           567,156 |           451,720 |
| `-O3`                            |             1,417,876 |           566,403 |           450,684 |
| `-O4`                            |             1,420,102 |           568,079 |           453,452 |
| `-O3` without the one-caller cap |             1,416,909 |           572,406 |           458,327 |
| `-O4` without the one-caller cap |             1,419,321 |           573,559 |           460,840 |
| `-Os` / `-O2` (for reference)    | 1,409,226 / 1,417,415 | 567,289 / 566,715 | 451,520 / 451,660 |

`-O3` is +7,473 raw, −753 gzip, −1,036 Brotli against `-Oz`.

**Browser headline.** The `profile-harnesses/browser/headline.js` workloads from the
[2026-11-22 headline benchmark](../benchmark-main-vs-0.2.0-2026-11-22.md), on one consumer build whose shaper asset was
swapped per variant. The workloads are Latin 15k and 22k (sweep, type-end, insert, delete, paste), bidi Amiri sweep and
edits, and the ASCII frame. The harness also recorded time to the first frame (`createText` to GPU-complete) and
`WebAssembly.compileStreaming` plus `instantiate`. Six rounds, all five variants in each round with rotated order,
one fresh Chrome per load, load average 9–17. Paired-median ratios against `-Oz`:

| row                     |     `-O3` |     `-O4` | `-O3` no cap | `-O4` no cap |
| ----------------------- | --------: | --------: | -----------: | -----------: |
| 22k type-end            |      1.00 |      0.98 |         0.95 |         1.06 |
| 22k insert middle       |      0.98 |      0.97 |         1.02 |         1.02 |
| 22k paste middle        |      0.98 |      0.96 |         1.01 |         1.04 |
| 22k sweep               |      0.99 |      1.01 |         0.98 |         1.00 |
| Latin 15k type-end      |      1.09 |      1.04 |         1.00 |         1.00 |
| Latin 15k paste middle  |      0.94 |      0.99 |         0.94 |         0.96 |
| Latin 15k sweep         |      1.03 |      1.02 |         0.99 |         0.96 |
| bidi edit type-end      |      0.93 |      0.95 |         1.03 |         1.02 |
| bidi edit insert middle |      1.02 |      1.05 |         1.08 |         1.06 |
| bidi sweep              |      1.02 |      1.02 |         0.98 |         0.97 |
| ASCII frame             |      0.98 |      1.00 |         0.96 |         1.01 |
| first frame, 22k        |      1.03 |      1.03 |     **1.15** |     **1.10** |
| first frame, Latin 15k  |      0.98 |      0.98 |     **1.13** |     **1.12** |
| first frame, bidi       |      0.99 |      1.00 |     **1.09** |     **1.08** |
| compile + instantiate   | 0.91–1.09 | 0.89–1.07 |    0.90–1.15 |    0.87–1.01 |

Per-load ranges are wide (often ±25%) on this host, so ratios inside about ±10% are noise. The only consistent
signal is that removing the one-caller inlining cap slows the cold first frame by 8–15%. Pooled `compileStreaming`
medians are 2.83 ms (`-Oz`) and 2.94 ms (`-O3`), and `instantiate` is 0.09 ms for every variant. Node's lazy
`WebAssembly.compile` takes 1.19–1.21 ms for all five, interleaved over 25 rounds.

**Engine Labs.** `benchmark:labs-internal -- --suite engine --wasm <variant>`: three rounds in O3, O4, Oz order, fresh
process per run, resolution about ±2%. Median of per-round ratios against `-Oz`:

- `-O3`: 0.99–1.04 on all 16 lanes. Every lane's per-round range includes 1.00 except two that move in opposite
  directions: suffix-edit (1.01–1.03) and equivalent-width (0.97–0.99). Examples: cold 1.004, suffix-edit 1.012,
  localized-splice 0.991, column-resize 1.037 (a lane with ±20% noise inside one process).
- `-O4`: 1.011–1.068, with every per-round ratio at or above 1.00. Examples: cold 1.015, suffix-edit 1.039,
  localized-edit 1.033. That is a small but consistent slowdown.

So `-O3` runs at the same speed as `-Oz` and is smaller by the measure the tables are tuned for, whole-module gzip.
`-O4` is slower and larger. Removing the cap is larger by about 5 kB gzip and slower on a cold first frame. None of the
size changes approach the 10 kB gzip threshold that would need an owner decision.

## Consequences

This supersedes D-244's level choice for the shaper only. The merge sandwich and the one-caller cap from D-244 stay,
and the bakers stay at `-Oz`. Through `shaperOptimizationArguments`, every tool that rebuilds the shaper uses the new
pipeline: `build.mjs`, `layout-oracle.mjs wasm`, `stage-bench.mjs`, and the memory and profile artifacts.
`build-shaper-optimizer-ablation.mjs` replays a frozen `-Oz` artifact, so it now pins that pipeline as a constant
instead of reading the release flags. The gain is small (−753 gzip bytes). The level is chosen on evidence, not
habit: `-Oz` bought nothing on this module because its size is dominated by tables and HarfRust code that `-Oz` does
not shrink. Still open: these timings come from a host under heavy load. A quiet-host rerun of the headline with more
rounds could find speed differences under 5% that this run cannot resolve.
