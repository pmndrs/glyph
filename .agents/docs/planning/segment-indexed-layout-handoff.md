---
type: Plan
title: 'Layout refactor: handoff and remaining plans'
description: 'Where the 0.2.0 layout refactor stands at sil-green-49, the decisions in force, the open lanes and how to finish each, the path to a release, and the work after it.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T23:00:00Z'
---

# Layout refactor: handoff and remaining plans

Read this first. Detail lives in the [plan](segment-indexed-layout.md), the [build log](segment-indexed-layout-build-log.md)
(append-only, every decision with its date), the [branch map](segment-indexed-layout-branches.md), the
[API summary](api-summary-for-review.md), the [migration note](migration-from-0.1.0.md), and the experiment records
named below.

## 1. Where things stand

- **Integration branch** `experiments/segment-indexed-layout`, worktree `/Volumes/Depot/Developer/glyph-held-rope-wip`,
  pushed to `origin`. Last verified tag: **`sil-green-58`**. It sits on `experiments/held-rope-ascii-anchor-wip`
  (`8176a24e0a3f`; draft PRs #292 → #301 → #302 → #310). It ships as **0.2.0**, a breaking release.
- **Oracle:** 596 frozen cases, 928 differential runs (~55,700 requests) comparing incremental against cold in every
  stage and lane class, natively and in wasm. 0 unlisted divergences. `KNOWN-DIVERGENCES` may only shrink.
- **Verification on `sil-green-50`:** clippy `-D warnings`, full native and wasm oracle (596 equal), all shaper tests, `pnpm --filter @pmndrs/glyph test`.
  The full browser set and `pnpm check` last passed at `sil-green-44`/`-47`; run the full set (section 7) before the
  ship PR.
- **Core shaper wasm:** 611.0 kB gzip (1,567 kB raw) at `sil-green-50`, down from 687.7 kB at `-43`. v0.1.0 was
  501 kB, main 541 kB. Only the core shaper's size matters; bakers are dynamically imported.
- **No PR is open for this work.** Landing is one draft PR on top of the stack, when Justin says so.

### What 0.2.0 contains

| Area | State |
| --- | --- |
| Engine | Dense stages (column gather, cluster build with change ranges, run-local SoA geometry, positioning split, dense Unicode kernel with simd128 class stage and bidi class lanes), HarfRust forked in-repo, panic-free |
| Edits | Every edit type reshapes only its edited runs and splices clusters and geometry (typing at end, mid-paragraph, multi-edit, right-to-left); windowed Unicode re-analysis |
| Reflow | Width-only changes skip regathering unchanged rows, reuse line fits that still hold, skip unchanged lines and edge-record lines in positioning |
| Preparation | Setters mark dirty; reads prepare on demand; the frame batch-prepares; `prepare()`, `onLayout`, exact first frame |
| Error model | Paragraph refusal, `maxTextUnits`, trap gateway, `GlyphInputError`, `onError`, `<GlyphErrorBoundary>` |
| Editing API | `caret`, `hitTest`, `move`, `boundary`, `rangeRects`, `replace(start, end, insert)`, `TextOffsetError` on Three, TypeGPU and PixiJS 3D |
| Renderers | Three MSDF/Slug/bitmap, TypeGPU, PixiJS 3D as the `@pmndrs/glyph/pixi3d` subpath |
| Culling | Automatic bounds for every built-in draw; custom materials culled by default with `defineTextMaterial(create, { boundsPadding, frustumCulled })`; per-text `frustumCulled = false` |
| Materials | `position` and `paragraphPosition` safe in vertex and fragment stages (PR #311 re-implemented) |
| Ported PRs | #317 (shared Three storage), #314 (browser import without `process`), #316 (line glyph spans), #311 |
| Fixes | Layout faults (empty text has a line, ellipsis order, exclusion order, island placement, hung spaces), grapheme split across bidi runs, negative-spacing lone marks, empty-text ink, `compileAsync` stopping publication, codec buffer growth, scene-unbind crash |
| Size | Language-tag resolution moved into a compact table; HarfRust `variations` and `FontInstance` compiled out; generic duplication cuts; runtime outline decoding moved into `font-baker.wasm` |

### Performance against main (2026-11-22, loaded machine; ratios, not a quiet run)

| Row | 0.2.0 / main |
| --- | --- |
| Type at end, 2,500 words / 22k glyphs | 0.53 / 0.48 |
| Insert, delete, paste mid, 2,500 words | 0.59–0.62 |
| Insert, delete, paste mid, 22k | 0.42–0.43 |
| Width sweep, 2,500 words / 22k / bidi | 0.94 / 0.94 / 0.78 |
| Small ASCII frame | about 0.83 |
| Mixed Arabic/Latin edits (type end / insert / delete / paste) | 0.52 / 0.77 / 0.76 / 0.81 |
| `measure()` alone right after a width change | about 2.1 (frame total equal or faster; decision below) |

Not yet re-measured with the typing fix and upload narrowing (section 3), which take type-at-end to about 4.67 ms and
its upload from 695 kB to 1.7 kB per keystroke.

## 2. Decisions in force

- Operating mode: ship-ready first; every commit after that shippable; then hardening. Beating v0.1.0 is the bar;
  rows under ~4 ms with no clear fix may ride; performance is judged in aggregate.
- Correctness is the hard gate: incremental equals cold, typographic output unchanged. Re-freezing oracle references
  needs Justin's word; he approved the six listed in section 3.
- Editing API is the minimum six methods plus `TextOffsetError`; lone surrogates render as U+FFFD with no API.
- Smallest public surface. New `/core` names `createDecorationCodecProgram`, `decorationSchema`, `SlugBandResidency`,
  `SLUG_RESIDENT_BAND_CURVE_WIDTH` stay public. Caret keeps `secondary` and `clipped`.
- Renderers are subpath exports of `@pmndrs/glyph`, never separate packages. The private PixiJS 3D beta tarball is
  never committed. `feature/pixi3d` in `/Volumes/Depot/Developer/text` stays local.
- **Deferred to 0.3.0:** inline objects (icons go through the font stack, wrap-around through exclusions);
  frustum-culling PR #319's bench; PR #313; a glyph-owned RTL bidi resolver
  ([decision](decisions/rtl-bidi-resolver-deferred.md)).
- **Size:** only the core shaper (and core JS) matters. Tables were organised to gzip well; never undo that; judge
  every cut by gzip of the whole shipped wasm. Speed beats size. HarfRust's `variations` feature must come back on
  (about 5 kB gzip) when variable-font shaping is added.
- No `git stash`. Agent build output goes under `/Volumes/Depot/Developer/glyph-scratch/<lane>/` (builds honour
  `CARGO_TARGET_DIR`). Nothing goes upstream to HarfRust without asking. Lanes run `km` (kimun, pinned in
  `mise.toml`) and `fallow` (`pnpm dlx fallow@3.13.0`, config `.fallowrc.jsonc`).

## 3. Open lanes at handoff

None. Every lane is merged into `sil-green-51` and its branch deleted. `sil-green-51` passed, on its own tip: clippy
`-D warnings`, native and wasm oracle (596 equal, 0 unlisted divergences), `cargo test --features oracle`, the
package tests, `pnpm check`, and the pixi3d-parity, typegpu-parity, v1-bitmap, three-storage-lifetime,
frustum-culling and material-position proofs. The mixed-bidi lane's last fix: an edit that empties a paragraph now
takes the empty-text path before any incremental shaping path. Mixed Arabic/Latin edit rows are tracked by
`pnpm scripts run benchmark:headline-bidi-edit`.

## 4. Decisions waiting on Justin

1. **`measure()` after a width change** ([evidence and designs](measure-after-width-change-2026-11-22.md)): the
   frame is equal or faster, but the isolated read is about 2× main because 0.2.0 positions on the read. Options:
   - C now: build placement segments in the frame, not the read (about −0.05 ms, no re-freeze), rest rides.
   - B + D: keep positioning's predecessor across a read, and make the summary's glyph counts lazy (reaches main).
   - A: speculative reads like main (reverses durable reads; not recommended).
   Recommended: C now, B + D after ship.
2. **When to open the ship PR** (one draft PR on top of #310).

## 5. Path to release

1. Land the open lanes (section 3), each re-verified on the integration tree.
2. **Rust cleanup pass** from the [kimun audit](code-quality-audit-2026-11-22.md): the 5 new or grown Rust functions
   (`position_fragment`, `reposition_retained_line`, `build_lines`, `position_segment`,
   `validate_style_topology_for_inputs`), the 2 new duplicate groups, then `screen_font`, `compile_draw_spans` and
   line-break `decide`. No behaviour change, A/B any hot loop. Held until the lanes above land (Justin's call).
3. **Docs** (S4): bring `api-summary-for-review.md` and `migration-from-0.1.0.md` in line with everything in section
   1 (pixi3d subpath, culling options, `position`/`paragraphPosition`, editing on PixiJS 3D, empty-text lines,
   ellipsis direction, `TextFrameError` below); update `.agents/docs/packages/glyph.md`; run `docs:attest`; public
   docs for the editing methods with one worked editable-field example.
4. **Quiet-machine comparison** (S5): all lanes paused; v0.1.0, main (`/Volumes/Depot/Developer/glyph-baseline-main`),
   the integration tip and ultra-text (`/Volumes/Depot/Developer/glyph-competitor-bench`), interleaved, with the
   headline harness (`/Volumes/Depot/Developer/glyph-baselines-2026-11-22/profile-harnesses/browser/headline.js`)
   plus the full suite. Recheck the noisy rows: Latin 15k layout read after the outline move (+3–5%), Latin 15k
   insert/paste frame totals after the fork cuts (+10–20% total, layout equal).
5. **Ship PR** (S6): one draft PR on #310 via the `gh-stack` skill; description lists the superseded open PRs
   (#317, #314, #316, #311, #240), the migration note, the comparison table and the riding rows.

### Known bugs and gaps at handoff

- `TextFrameError` is public but never thrown (`textFrameError` has no caller), although `glyph.md` says `/three`
  re-raises engine rejections as it. Decide: wire it up or remove it before ship.
- A draw compiled with `compileAsync` and never rendered, outside the root (a `split()` copy), registers no renderer
  and can leak its storage on Three r185/r186. The `compileAsync` fix depends on Three's private
  `_compilationPromises`; a test fails loudly if Three renames it.
- Reparenting a deeper ancestor of a detached `Glyphs` into an opted-out `TextGroup` is not detected by culling.
- `typegpu@0.12.5` reads `process.env` unguarded, so the TypeGPU entries need a bundler or a `process` shim as
  unbundled browser ESM (documented in the migration note).
- The oracle driver plans column layouts no host can send (6 rejections); see P9.

## 6. After ship

| Unit | What | Plan |
| --- | --- | --- |
| P1. `measure()` B + D | Section 4 | Keep positioning's predecessor across a read; lazy summary glyph counts |
| P2. Discard-free publication failure | Rust discards the root when publication cannot be delivered | Per-stage rollback across planner and gather, a retry entry point, a new oracle route (fixes lane analysis in the build log) |
| P3. `retained_rope` type-erased core | ~31 kB raw of duplicate generic copies across five node types | One shared tree core, per-type leaf copy and drop; A/B the edit rows |
| P4. More core size | See the 2026-11-22 section of [wasm-size-reduction.md](wasm-size-reduction.md) | Remaining duplicate sorts; data-driven syllabic shaper interpreter priced there |
| P5. Content-anchored blocks | Blocks on a 64-cluster grid shift after an insert | Only if edit profiles still show block shifts after the splice work |
| P6. Shaping fast path widening | [experiments-shaping](experiments-shaping-2026-11-22.md): `UNSAFE_TO_CONCAT` flags block text fonts | R1/R2 rules priced; not worth it for Inter |
| P7. First frame, CPU memory, device loss, oracle reading like a host | Carried from the earlier plan | See the plan's "Every axis" |
| P8. Deferred typography and variable-font shaping | [scope decision](decisions/typographic-feature-scope-for-layout-refactor.md) | Turn `variations` back on in the fork |
| P9. Inline objects | Deferred by Justin | Design the four public pieces (input, result box, `replace` rebasing, more than one per text) |

## 7. How to run things

From `packages/glyph/rust/shaper` (set `CARGO_TARGET_DIR` to a Depot scratch dir):

```bash
GLYPH_ADVERSARIAL_FONTS=/Volumes/Depot/Developer/glyph-adversarial-fonts mise exec -- cargo run --release --features oracle --bin layout-oracle -- check --tier full
```

From `packages/glyph`:

```bash
GLYPH_ADVERSARIAL_FONTS=/Volumes/Depot/Developer/glyph-adversarial-fonts mise exec -- node scripts/layout-oracle.mjs wasm --tier full
```

Without `GLYPH_ADVERSARIAL_FONTS` the wasm oracle skips 163 cases. After an approved re-freeze, prove what moved by
dumping every lane of every case before and after (`/Volumes/Depot/Developer/glyph-scratch/refreeze/lanediff.py`)
and by counting changed reference lines:

```bash
git diff -U0 -- tests/oracle/reference/exact ':!tests/oracle/reference/exact/MANIFEST' | grep '^[-+]' | grep -v '^[-+][-+]' | cut -c2- | awk '{print $1}' | sort | uniq -c
```

Full verification before a release tag: `mise exec -- pnpm install --frozen-lockfile`, delete `node_modules/.vite`,
rebuild `@pmndrs/glyph`, then `cargo clippy --features oracle --all-targets -- -D warnings`,
`cargo test --features oracle`, both oracles, `pnpm --filter @pmndrs/glyph test`, and
`pnpm scripts run benchmark:pixi3d-parity`, `benchmark:typegpu-parity`, `benchmark:v1-bitmap`,
`benchmark:v1-bitmap -- --typegpu`, `typegpu:live-check`, `benchmark:three-storage-lifetime`,
`benchmark:material-position`, `benchmark:frustum-culling`, then `pnpm check`. About an hour.

## 8. Where evidence lives

- `/Volumes/Depot/Developer/glyph-baselines-2026-11-21/` and `-2026-11-22/`: snapshots, headline harness, profiles.
- `/Volumes/Depot/Developer/glyph-adversarial-fonts/`: fonts with `MANIFEST.md` (Hind Madurai added 2026-11-22).
- `/Volumes/Depot/Developer/glyph-scratch/<lane>/`: per-lane logs, patches and probes (safe to delete after landing).
- Experiment records: [reflow](experiments-reflow-2026-11-22.md), [unicode](experiments-unicode-2026-11-22.md),
  [shaping](experiments-shaping-2026-11-22.md), [benchmark vs main](benchmark-main-vs-0.2.0-2026-11-22.md),
  [code quality](code-quality-audit-2026-11-22.md), [size](wasm-size-reduction.md).
- Stale Depot worktrees with uncommitted spike source (keep): `glyph-chunk-spike`, `glyph-floor-exp`,
  `glyph-throughput-spike`, `glyph-profile-inspect`, `glyph-profile-size`.
- `/Volumes/Depot/Developer/text` on `feature/pixi3d`: Justin's PixiJS 3D demo checkpoint `2ecb36411`, local only.
