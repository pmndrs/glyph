---
type: Plan
title: 'Layout refactor: handoff and remaining plans'
description: 'Where the layout refactor stands at sil-green-22, what is left before ship, and a plan for every remaining unit.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-21T23:30:00Z'
---

# Layout refactor: handoff and remaining plans

This is the one document to read to pick the work up. Detail lives in the [plan](segment-indexed-layout.md),
the [build log](segment-indexed-layout-build-log.md), the [branch map](segment-indexed-layout-branches.md), the
[API summary](api-summary-for-review.md) and the [migration note](migration-from-0.1.0.md).

## 1. Where things stand

- **Integration branch** `experiments/segment-indexed-layout`, worktree `/Volumes/Depot/Developer/glyph-held-rope-wip`,
  pushed to `origin`. Last verified tag: `sil-green-23`. It sits on `experiments/held-rope-ascii-anchor-wip`
  (`8176a24e0a3f`; draft PRs #292 → #301 → #302 → #310).
- **`sil-green-22`** merged the layout-fault fixes and the editing lane with the oracle re-frozen (section 3).
  No lane branch is open.
- **Oracle**: 588 cases, 54,240 seeded requests, incremental compared against cold in every stage and lane class,
  natively and in wasm. `KNOWN-DIVERGENCES` may only shrink.
- **No PR is open for this work.** Landing is one draft PR on top of the existing stack, opened at the ship gate.

### What is merged (tags `sil-green-0` … `-21`)

| Area | What shipped on the integration branch |
| --- | --- |
| Correctness oracle | `layout-oracle` binary, frozen reference digests, seeded differential driver, wasm probe, coverage for decorations, multi-paragraph, inline objects, multi-region |
| Engine size and safety | HarfRust forked in-repo with AAT and `rand` off (legacy `kern` kept), panic paths removed |
| Dense stages | Column gather, dense cluster build with change ranges, run-local SoA geometry with one kernel, positioning split into topology and numeric with per-line ink, dense Unicode kernel, per-lane resync, lazy word/sentence lanes |
| Typography fixes | UAX #14 opening-quote fix, bidi fixes, seven divergence families, rank-order fix |
| Preparation model | Setters validate and mark dirty; reads prepare on demand; the frame batch-prepares then publishes; `glyph.prepare()`; paint-only path; `onLayout`; exact first frame without `root.attach(scene)` |
| Error model | Paragraph refusal, `maxTextUnits`, trap gateway with `GlyphEngineRestartError`, failed-frame retry, `GlyphInputError`, root `onError`, `<GlyphErrorBoundary>`, sibling-safe publication failure |
| Three MSDF | Effect-specialised graphs, ink-trimmed quads, per-font glyph tables, on-demand atlas residency, `msdfAtlas: 'sdf'` |
| Slug | Glyph table, batching, band curves resident on demand, direct-TypeGPU parity |
| TypeGPU | Batching through indexed transforms, atlas residency |
| PixiJS 3D | `@pmndrs/glyph/pixi3d` subpath export (optional peers `@pixi/3d` 0.1.x and `pixi.js` 8.23+), like `/three` and `/typegpu`; not a separate package |
| First frame | Font binding compiled at load |

### Performance standing (same machine, loose reference, not a quiet run)

- Ahead of ultra-text: edits, steady frame (0.142 ms vs 0.183 ms), draw count, never-drawn letters, GPU memory
  with on-demand upload.
- Behind ultra-text: first frame (about 36 ms vs 30 ms), width change, download size.
- Riding under the aggregate rule (slower than main, under 4 ms, no clear fix left): typing (about 2.0 ms vs
  1.8 ms), dense rewrite plus frame, `measure()` after a width change on Fredoka and Amiri (about 2× main), bidi
  on RTL (1–5%).
- Wasm gzip: v0.1.0 501 kB, main 541 kB, integration about 606 kB, with editing exports about 652 kB. Size rides
  until after ship by decision.

## 2. Decisions in force

- Operating mode: get ready to ship; then every commit stays shippable; then hardening and performance. Beating
  v0.1.0 is the bar. Beating ultra-text is a nice claim. Beating main is not required when the aggregate is better.
- 0.2.0 is a breaking release. Editing is in the ship gate. PixiJS 3D is in 0.2.0.
- Editing API is the minimum for an editable field: `caret`, `hitTest`, `move`, `boundary`, `rangeRects`,
  `replace(start, end, insert)`, `TextOffsetError`. Offsets are UTF-16 code units; bad offsets throw. No session
  object, IME API, caret rendering, selection state, clipboard or undo.
- Lone surrogates render as U+FFFD with no public API.
- `onLayout` re-entrancy throws immediately. No eager per-setter prepare. No rollback copy.
- Only "compile font binding at load" is approved among first-frame options.
- Nothing goes upstream to HarfRust without asking. The private PixiJS 3D beta tarball is never committed.
  `git stash` is not used. Agent build output goes under `/Volumes/Depot/Developer/glyph-scratch/<lane>/`.

## 3. `sil-green-22`: faults plus editing

Merged into the integration branch on Justin's word (2026-11-21), tagged `sil-green-22` and pushed. The lane and
branches and worktrees are deleted. There is one branch: the integration branch.

**What the re-freeze changed**

- Fault fixes: exactly 32 cases, the same 32 the lane listed. `value`, `identity`, `repr` and `wire` lanes moved;
  no `cache` lane. Every other case is byte-identical. Reference set `ee09f03d40ee727e`.
- Editing: all 588 cases, `wire` lanes only (ABI version 1 → 2 in every result header). No layout lane moved.
  Reference set `52e6502a494f3da2`.
- Full oracle after both: 588 equal, 0 unlisted divergences, natively and in wasm.

**Verification, all passing:** `@pmndrs/glyph` tests (1,329 integration tests, none skipped),
the shaper's cargo tests including editing, PixiJS 3D parity, TypeGPU parity, both
bitmap proofs, the TypeGPU live check, and `pnpm check`. Wasm is 647,666 bytes gzip.

**User-visible behaviour changes it carries**

- `""` measures as one line with the font's line height, `"\n"` as two, `"\n\n"` as three (was zero lines).
- The ellipsis follows paragraph direction, and ellipsis lines fit their slot (a one-line case gains one space of
  content width; a cut can land one cluster earlier).
- Right-to-left lines beside exclusions fill slots in reading order.
- The six editing methods and `TextOffsetError` exist; the old caret methods are gone.

**Expectations changed during the merge:** the two package tests for empty text and right-to-left ellipsis order;
two editing tests that pinned "empty text has no line"; the bidi layout contract fixture; one benchmark pin
(17,362 → 17,482 bytes, five empty frames now carrying one line each). `pen_reversals` is 0 across all fixtures
and was turned from a print into an assertion.

**Loose ends**

- `editing/place.rs:128` keeps a "layout made no line" caret branch that is now probably unreachable. Remove it
  with a test proving so.
- `benches/fixtures/results/advanced-shaping-conformance-chromium149.json` still records 17,362 bytes; nothing
  gates on it.
- The pre-commit hook fails when the only staged formattable file is an LFS JSON. Small hook fix.
- No `docs:attest` for the merged source (covered by S4).
- The package build writes into in-tree `rust/*/target`; make it honour `CARGO_TARGET_DIR` so agent builds can go
  to Depot scratch.

## 4. Decisions waiting on Justin

2. **Fetch Hind Madurai** (OFL, from the official google/fonts repository) into the adversarial font set so the
   Tamil conjunct caret test runs instead of skipping.
3. **Sign off the new `/core` names**: `createDecorationCodecProgram`, `decorationSchema`, `SlugBandResidency`,
   `SLUG_RESIDENT_BAND_CURVE_WIDTH`.
4. **Inline objects**: laid out in 0.2.0, or documented as accepted but not placed.
5. **Caret result fields** `secondary` and `clipped`: keep or cut.
6. **Push `feature/pixi3d`** (checkpoint `2ecb36411`, local only) or leave it local.
7. **Disk**: remove other sessions' `/private/tmp` items and stale spike/profile worktrees on Depot.

## 5. Remaining work before ship

Each unit is one lane, one worktree, one branch (`experiments/sil-<lane>`), merged only after the full oracle
tier (native and wasm) and the browser verification pass on the integration tree after a clean rebuild.

### S2. PixiJS 3D `replace` — Opus, small

The PixiJS 3D text object has the five queries but not `replace`. Add it by delegating to the same host function
the Three text uses (`src/text-editing.ts`), with the span-rebase rule covered by
`tests/fixtures/span-rebase-vectors.json`. Done when the package tests pass and a test edits a PixiJS 3D text
mid-paragraph and reads the same caret as the Three text.

### S3. Two input faults from the faults lane — top model, small to medium

1. `direction: rtl` plus ellipsis over text that starts with U+201D followed by Devanagari returns
   `InvalidRequest`. Valid input must not be refused. Start by reducing the case with `layout-oracle dump`, then
   find which validation in the ellipsis path sees an island with an empty or inverted range.
2. A line cut for an ellipsis may keep a line-edge correction for a tail that was dropped. Build a fixture with a
   hanging-punctuation or optical-margin tail past the cut; if the correction survives, clear it where the cut is
   applied. If no fixture shows it, record it as disproved.

Both get an oracle case each. Done when the oracle is green with the new cases and no listed divergence is added.

### S4. Documentation — Opus

- Bring `api-summary-for-review.md` in line with the trimmed editing API and the surrogate decision.
- Finish `migration-from-0.1.0.md`: setters no longer prepare, `prepare()`, `onLayout`, the error types, empty
  text now has one line, ellipsis follows paragraph direction, removed caret methods, `replace` with an explicit
  range.
- Update the package concepts under `.agents/docs/packages/` that are now wrong, and attest each package once.
- Public docs for the editing methods with one worked example: an editable field built from the six methods.

### S5. Quiet-machine comparison — Sonnet to run, top model to read

All lanes paused, nothing else running. Compare v0.1.0, main (`/Volumes/Depot/Developer/glyph-baseline-main`,
`4e25a96a`) and the integration tip, interleaved, plus the ultra-text set in
`/Volumes/Depot/Developer/glyph-competitor-bench`. Include typing, line-height change and mid-paragraph insert at
the realistic size (about 2,500 words, about 15k glyphs), not only the 22k stress case. Output one table:
each row against v0.1.0 (must win or tie in aggregate), against main (riding rows named), against ultra-text
(claims named). No thresholds or statistical protocol; the table is read in aggregate.

### S6. Ship PR — top model

One draft PR on top of #310 from the integration branch. Description: what changed for users, the migration
note, the comparison table, the riding rows, the known divergences list, the wasm size with the size plan. Use
the `gh-stack` skill. Not opened until S1–S5 are done and Justin says so.

## 6. After ship: hardening and performance

Ordered by expected value. Each starts with a profile spike, not a guess.

| Unit | What | Plan | Model |
| --- | --- | --- | --- |
| P1. Local edits (unit 2) | Typing is 44% reshaping the whole run | Reshape only a window around the edit bounded by safe-to-break flags; splice clusters through the existing `ClusterChanges` ranges; the oracle already compares incremental against cold. This is the row that turns typing from riding into a win | Top |
| P2. Gather by change class | Gather re-reads columns for paint-only and origin-only changes | Key the gather on `change_since_publication` (Paint, Origin, Metric, Content) and copy only the columns that class can move | Top |
| P3. Width-change `measure()` | About 2× main on Fredoka and Amiri | Profile first; the suspect is refitting every line when only lines after the first changed break can move. Reuse the fitter's line-start state up to the first line whose break changes | Top |
| P4. Size recovery | 652 kB vs 501 kB at v0.1.0 | Lazy outline decoder; move word/sentence boundary code behind first use; delete retired paths; re-measure each with `twiggy`. Prior research: `wasm-size-reduction.md` | Opus |
| P5. First frame | 36 ms vs 30 ms | Profiles say font artifact plus JS set-up. Engine warm-up at init and replacing the font hash were NOT approved; ask before either. Unapproved-free options: defer atlas texture creation to first draw, trim the bake header parse | Opus |
| P6. CPU memory | Retained lanes hold both staged copies | Share unchanged lanes between `Staged<T>` sides; measure with the heap probe in `profile-harnesses/` | Top |
| P7. Positioning follow-ups | Numeric pass still touches clean blocks | Skip blocks whose inputs are unchanged using the per-block dirty bits already produced by cluster build | Top |
| P8. Discard-free publication failure | Rust still discards the root when publication cannot be delivered | Keep the prepared revision and retry delivery; the host half is already sibling-safe | Top |
| P9. Oracle reads like a host | The oracle driver calls the engine in ways no host does (one listed finding) | Route the driver through the same call sequence as `src/internal`, then remove the listed contract finding | Opus |
| P10. SIMD experiments | Pyramid, validity interval, integer pen, affine placement, bit-parallel rule matching, shaped-string reuse, content-anchored blocks | Each is tested, and kept if faster or equal. One spike per idea, interleaved against the integration tip | Top |
| P11. Device-loss detection | GPU device loss is not detected | Listen for loss on each backend, mark residency lost, re-upload on restore | Opus |
| P12. Deferred typography | Everything in `decisions/typographic-feature-scope-for-layout-refactor.md` | Separate plan after 0.2.0 | — |

## 7. How to run things

From `packages/glyph/rust/shaper`:

```bash
GLYPH_ADVERSARIAL_FONTS=/Volumes/Depot/Developer/glyph-adversarial-fonts mise exec -- cargo run --release --features oracle --bin layout-oracle -- check --tier full
```

From `packages/glyph`:

```bash
mise exec -- node scripts/layout-oracle.mjs wasm --tier full
```

Re-freezing references changes what "correct" means, so it needs Justin's word. After a re-freeze, check that
only the expected line kinds moved (`class` is step digests, `stage` is cold digests):

```bash
git diff -U0 -- tests/oracle/reference/exact ':!tests/oracle/reference/exact/MANIFEST' | grep '^[-+][^-+]' | cut -c2- | awk '{print $1}' | sort | uniq -c
```

Verification before every tag, on the integration tree: delete `node_modules/.vite`, rebuild `@pmndrs/glyph`, then
`pnpm --filter @pmndrs/glyph test`,
`pnpm scripts run benchmark:pixi3d-parity`, `benchmark:typegpu-parity`, `benchmark:v1-bitmap`,
`benchmark:v1-bitmap -- --typegpu`, `typegpu:live-check`, `pnpm check`. About an hour.

## 8. Where evidence lives

- `/Volumes/Depot/Developer/glyph-baselines-2026-11-21/`: snapshots, tables, four profiles, the fifth review,
  profile harnesses, archived scratch.
- `/Volumes/Depot/Developer/glyph-adversarial-fonts/`: fonts with `MANIFEST.md`.
- `/Volumes/Depot/Developer/glyph-competitor-bench` and `-render`: the ultra-text harness.
- `/Volumes/Depot/Developer/glyph-scratch/faults/`: per-commit dumps and row-level diffs for the fault fixes
  (about 8 GB; can be deleted now).
- `/Volumes/Depot/Developer/text` on `feature/pixi3d`: the PixiJS 3D demo work, checkpoint `2ecb36411`, local
  only, with 52 GB of untracked demo assets.
