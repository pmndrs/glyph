---
type: Implementation Plan
title: Dense stages and local edits (v4)
description: Makes mid-paragraph editing and reflow several times faster by running each bookkeeping stage as a dense pass over flat lanes, keeping caches and converging locally after an edit, and deferring preparation without ever serving a stale read, with whole-run shaping and exact output preserved.
documentation_type: explanation
tags: [glyph, layout, reflow, editing, performance, wasm, simd]
status: draft
sources:
  - id: handoff
    resource: ../reports/held-rope-performance-handoff-2026-11-20.md
    title: HELD rope performance WIP handoff
  - id: frr
    resource: fragment-relative-reflow.md
    title: Fragment-relative retained reflow
  - id: rta
    resource: retained-text-assignment.md
    title: Retained assignment design
generated:
  by: anthropic-claude/fable-5.2
  at: '2026-11-21T05:00:00Z'
---

# Dense stages and local edits (v4)

Status: **proposed for implementation.** Three earlier drafts (segment index, content-addressed chunks, v3 with
resize intervals and parametric placement) were reviewed against source by seventeen reviewers; this is what
survived. Tags: **[measured]** on this machine (Apple M4; native arm64 and wasm32+simd128 under Node/V8, ≥3 runs);
**[verified]** read in source by a reviewer; **[estimate]**; **[not verified]**. The file keeps its name so links
hold.

## Evidence

### Where the time goes **[measured]**

Fredoka prose, 25,973 clusters, 25,086 glyphs, 518 lines. Microseconds, p50, native / wasm.

| Stage             | Midpoint insert + measure | Width change + measure |
| ----------------- | ------------------------- | ---------------------- |
| **Total**         | **5,960 / 8,960**         | **1,355 / 1,910**      |
| Unicode analysis  | 1,045                     | 0                      |
| Bidi              | 95                        | 0                      |
| Shaping           | 81                        | 0                      |
| Cluster build     | 3,150                     | 0                      |
| Flow / fit        | 387 / 589                 | 147 / 220              |
| Positioning       | 612 / 1,021               | 612                    |
| Measurement (ink) | 611 / 716                 | 593                    |

Cluster build: run canonical comparison 1,270; run-local geometry 700; header loop 498; stable glyph ids 320;
shape aggregation 178; rest about 250. The engine runs 1.4–1.5× slower in wasm than native. Copying every staged
lane with a gap is about 125 µs.

### Dense kernels against the engine **[measured, plain case]**

| Stage                              | Native ratio | Wasm ratio                                           | Note                                    |
| ---------------------------------- | ------------ | ---------------------------------------------------- | --------------------------------------- |
| Ink                                | 23×          | 23× with compare-select min/max (6× with `f32::min`) | Bit-equal                               |
| Positioning                        | 6.9×         | 7.4×                                                 | Bit-equal on lines without lead islands |
| Cluster header/index/aggregation   | 6.7×         | 7.4×                                                 | Equal                                   |
| Break flags, units, word breaks    | 1.8×         | 1.9×                                                 | Equal                                   |
| Run-local geometry                 | 3.3×         | 3.4×                                                 | Bit-equal                               |
| Stable ids (lane compare, no hash) | 15×          | 19×                                                  | Equal                                   |
| Run comparison (lane compares)     | 25×          | 46× with fold compare (4.6× with slice `==`)         | Decisions agree                         |
| Graphemes + scripts, ASCII         | 72×          | 19×                                                  | Equal                                   |
| Line breaks, ASCII subset          | 8.7×         | 10.5×                                                | Equal                                   |

**Whole operation, all stages at their floor:** edit 5.4× native, 4.0× wasm as written, about 5.2× wasm with two
one-line kernel fixes; resize 5.2× native, 4.0× wasm, about 4.8× with the fixes. The host adds single-digit
microseconds to a width change and under 0.1 ms to an edit **[estimate from source]**, so about 4–4.5× should show
end to end on these two operations.

The overhead removed (closures, `dyn` calls, 56–104 byte struct copies, per-element `Result`) costs as much or
more in wasm, which is why the ratios hold.

### How much survives the general case **[estimate]**

The spike kernels assume one font, one style, LTR, start alignment and, for Unicode, a small ASCII subset.

| Stage              | General case                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Ink                | about 10×                                                                                           |
| Stable ids         | about 15× for single edits                                                                          |
| Positioning        | about 4× LTR; 1–1.5× for justified or bidi lines                                                    |
| Cluster header     | 4–5× LTR; about 2× for reordered scripts                                                            |
| Run-local geometry | 2–2.5×                                                                                              |
| Unicode            | Zero for any paragraph with a curly quote, dash or non-ASCII character unless the table covers them |

The essential branches are per layout run, per style segment and per placement segment, so the design is outer
loops over those with branch-free inner loops, not a paragraph classifier.

### What blocks local edits **[verified]**

- A full cluster build clears the cache of line-edge island shapes and break corrections
  (`cluster_state.rs:532-533`), so every line re-runs HarfRust on its edges. This is why flow costs 387 µs on an
  edit and 147 µs on a resize.
- Flow convergence requires an equal cluster count (`flow_composition.rs:863-866`), so any insert refits from
  line 0.
- The resize shortcut rejects any line with an edge record (`positioning.rs:4521-4526`); kerned Fredoka has one
  at every space and never takes it, Inter always does **[measured]**.
- Run-local blocks are cut every 64 clusters from run start, so blocks after an insert in the same run all change
  (0 of 203 reusable **[measured]**). Rows inside a block are already block-relative; only the index layer is
  absolute.

### Ruled out

| Idea                                           | Why                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-addressed chunk store                  | Optimizes shaping (1–4% of an edit); chunk break flags and corrections depend on neighbours; chunked shaping is 1.2–2.1× slower cold **[measured]**                     |
| Font barrier certificate; flag-verified splice | Inter's `calt` reaches seven glyphs across spaces; HarfRust flags every pair-kerning attempt **[verified]**                                                             |
| Replacing HarfRust at runtime                  | 51–115 ns/glyph Latin; small on every measured path **[measured]**                                                                                                      |
| GPU order indirection                          | Measured slower and retired (D-362)                                                                                                                                     |
| Lazy positioning on read at the Rust level     | Reads are `&self` and bypass the mutation gate **[verified]**                                                                                                           |
| Parametric placement on the GPU                | Justification is integer quotient-and-remainder with caps, not affine; centre/end would differ by an ulp from today; the placement table is session-wide **[verified]** |
| Resize validity interval                       | Sound, but the chance a 1 px step stays inside it is about 2 in a million at 518 lines **[estimate]**                                                                   |

## Design

Shaping stays whole-run with today's incremental window. Storage stays flat SoA with A/B staging. Results equal
cold layout.

### 0. Oracle first

No test today can guard this refactor: the retained-equals-cold tests compare warm against cold with the same
code on both sides, cover a case flip and one single-character edit, and skip run-local rows, revisions and ink;
the only multi-script differential test uses texts of about 25 clusters and never resizes or justifies
**[verified]**.

- **Frozen reference:** a lane dump from the current engine at every stage boundary (Unicode facts, shape lanes,
  cluster lanes, flow records, placed glyphs, line summaries, measure record, gather lanes), over a matrix of
  script × alignment × justification × fallback × multi-style × drop cap × ellipsis × exclusions.
- **Differential driver:** seeded random edits (insert, delete, replace at random offsets, including combining
  marks, joiners, bidi controls, newlines, quotes, digits with separators, regional indicators, style-boundary
  moves, edits at 63/64/65-cluster offsets) and resizes, each compared with a cold layout.
- **Corpus:** paragraphs of at least 2,000 clusters per script. Fixtures exist for Latin, Arabic, Devanagari and
  Japanese; add Hebrew, Thai, Bengali, Hangul and emoji.
- **Definition of equal:** incremental-new equals cold-new bit-exactly; new equals frozen-old bit-exactly on
  integer lanes and placed f32.
- **Wasm probe:** the spike's engine-versus-kernel timing, runnable under Node.

### 1. Dense stages

Rewrite bodies in place under existing signatures; no parallel module and no second path.

1. **Run-local rows as SoA lanes,** with one geometry kernel fed by all three clients (paragraph build, boundary
   islands, short labels). The cut rule is a parameter of the kernel.
2. **Positioning** replaces the main path whole: spans emitted per segment in place, decorations hoisted to style
   ranges, per-run direction; line ink computed in the same pass with the same placement function.
3. **Cluster build** as outer loops over runs, fonts and style segments; lane-compare stable ids for single
   edits; run comparison as fold compares that also emit dirty ranges.
4. **Unicode** as one table-driven pair-rule kernel with classes: C0 ASCII; C1 Latin, Greek, Cyrillic and general
   punctuation (ships with the first kernel, since real prose has typographic quotes); C2 CJK and Hangul; C3
   (RTL, explicit bidi, Indic conjuncts, regional indicators, emoji joiners, Thai) stays on the existing analysis.
   Classification is per analysis window, and bidi is zero-level only when the resolved base direction is LTR
   with no override and no R/AL/AN characters.

Kernel rules for wasm **[measured]**: no slice `==` on hot lanes (use a fold compare); no `f32::min/max` in hot
loops (compare-select after finite validation); pre-slice lanes and use `zip` or `chunks_exact`; keep f64 out of
reduction lanes where exactness allows; no per-element `u128` or variable 64-bit shifts; explicit
`core::arch::wasm32` only where the auto-vectorizer fails, behind the existing feature with a scalar twin.

### 2. Local edits

1. **Keep correction and island caches across a build,** outside a halo of 37 clusters around the edit
   (island cap 32 plus shaping context 5), rebased. Expected to take edit flow from about 387 to about 150 µs
   **[estimate]**.
2. **Convergent reflow for count-changing edits:** restart at the line before the dirty range; converge when a
   new line start equals an old line start plus the edit's delta, beyond the halo, with the same cached start
   correction, slot, height and baseline. Rewrite the suffix's offsets and re-accumulate block positions; do not
   adopt by reference.
3. **Widen the positioning shortcut** to lines whose edge-record content compares equal.
4. **Unicode resync** for classes C1–C2: recompute from the last required break, or letter–single-space–letter
   boundary with no following combining mark, before the edit to the first after it.
5. **Per-line ink cache,** keyed on positioning's own reuse proof and translation bits.

**Decision gate after units 1–2:** content-anchored block cuts, a windowed cluster rebuild and rebase-aware line
reuse save roughly another 13 ns per cluster after the dense stages **[estimate]**. They matter only for very
large paragraphs, change golden bytes for runs over 64 clusters, and re-key placement identity. Build them only
if the 22k-glyph keystroke misses its target once units 1–2 are measured in wasm.

### 3. Preparation model and errors

**Never stale.** The setter validates and marks dirty. Any read prepares that paragraph first if dirty and
adopts the result. The frame prepares whatever is still dirty in one batch, then publishes. Once per revision.

Changes the host needs **[verified]**:

- **Two-step publication in Three.** A prepare step at the front of the scene prepares dirty texts and runs
  callbacks before any node computes matrices; the existing last child publishes and syncs transforms. Today
  publication is the last child, so a callback that moves another object would lag a frame. `root.attach(scene)`
  makes the first frame exact (the react-three-fiber provider calls it at mount); apps that own their pipeline
  call `glyph.shape()` or `root.prepare()` before rendering.
- **Reads become paragraph-local.** Today one `measure()` stages every dirty sibling, detached texts share one
  cache slot, and the constructor reconciles all members (O(N²) mount).
- **Anchor resolution moves into the batch prepare.** Today a setter with an anchor calls `measure()`.
- **Per-text `onLayout`** (property, not a hook): fires after that text is first prepared and whenever its
  measurement changes, in its own phase after the batch prepare and before any root stages. A callback may
  read anything and write transforms, visibility and paint; writing a layout input of any registered text
  throws immediately (owner decision; there is no extra pass). See "Host, API and preparation review".
- **Errors.** Setters throw a typed input error and keep the previous value; in react-three-fiber that reaches
  the nearest error boundary. `onError` fires on the culprit text only, for publication-time failures; a
  root-level `onError` carries capacity, material and GPU failures.

**Prepare cannot fail.** Everything a caller can get wrong is validated at the setter; fonts and features are
handles; missing glyphs are a count; sizes are bounded from text length. Today a failure after the first Rust
write destroys the root and the host replays every text from its accepted values, which is the last rollback
copy in the system. Make failures paragraph-local (discard that paragraph's pending state), make a planning
failure abort the plan and not the root, and reserve in prepare what publication needs. Irreducible at
publication: exact per-batch buffer limits, a user's material factory, GPU allocation and device loss; none needs
a rollback copy because the previous draws stay on screen until commit. The grapheme-boundary check for style
spans is done in TypeScript so unread setters still cross into wasm once.

### 4. Host and publication

Edit-aware requests so Rust can reuse shaping; one crossing per prepare with cached request views; several dirty
upload ranges per buffer in Three; retained topology that survives a count change, then `PATCH_COPY`; a fit-only
query that returns line count and height without positioning.

### 5. Editing support (in scope) and typography deferred

Owner decision 2026-11-21, recorded with the full list in
`planning/decisions/typographic-feature-scope-for-layout-refactor.md`.

**Built in this plan — editing support:**

- a source-to-layout offset map (source UTF-16 offset ↔ cluster ↔ glyph ↔ line), kept as dense lanes and
  updated by the same local-edit path as layout;
- word and sentence boundaries (UAX #29), as bitmask lanes produced by the Unicode stage;
- caret positions and movement, logical and visual, across bidi runs;
- line-end caret affinity;
- carets inside ligatures (font ligature-caret data where the bake keeps it, else even division by component);
- IME composition ranges: marked ranges that survive the edits made during composition.

These are reads over prepared layout, so they follow the preparation model in section 3 (never stale) and must
not add work to an edit that nobody queries. Design is not done; it needs a query API and a profile of caret
queries during typing.

**Dropped:** `rand`; Apple AAT tables (the baker already rejects them).

**Deferred to a later effort** (not built here; the refactor must not make them harder): Graphite; variable
fonts (bake-time instances and runtime axes); colour fonts; soft hyphen and automatic hyphenation; CJK break
strictness; Thai-family dictionary breaking; balanced or optimal breaking; tabs and white-space modes;
non-U+0020 spaces; CJK inter-character justification, punctuation trim and autospacing; kashida; hanging
punctuation; line-edge corrections in paragraphs with RTL text; vertical writing; ruby. Mechanisms to leave
room for: glyph insertion at line edges, break candidates with width delta and penalty, a pluggable break
source, justification classes per cluster, font-instance identity in cache keys.

## Every axis

The goal is the whole: no axis left behind main, `v0.1.0` or a competitor. Sections 0–5 above cover editing and
reflow, which were measured first. This section carries every other axis raised during planning. Evidence level
is stated per axis; **unpriced** means no profile exists on this machine and one is required before the design is
firm.

| Axis                                                                                                    | What is known                                                                                                                                                                                                                                                                                                                                                                          | Work                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **First frame / cold mount** (paragraph, 200 labels, 22k stress)                                        | A competitor reports 39–45 ms against 50–76 ms for `v0.1.0`. Shaping is about 1.5 ms of a 22k mount **[measured]**; the same cluster build, Unicode, positioning and ink stages run cold, so dense stages apply. Mounting N texts reconciles all members each time (O(N²)) **[verified]**. Shader and pipeline compile, wasm instantiate, font load and atlas upload are **unpriced**. | Dense stages on the cold path; linear mount; batch prepare across labels in one crossing; compile pipelines while layout runs; streaming wasm compile; atlas upload sized to what is used. Profile first.                                                                                                                                        |
| **Idle frame** (nothing changed)                                                                        | Competitor measured 0.208 ms CPU per frame for 200 texts against 0.012 ms. Each frame scans every member (`needsReconcile`), syncs every transform, walks to the scene per text, and calls `shape()` **[verified]**.                                                                                                                                                                   | An unchanged frame does no per-text work: dirty lists for reconcile and transforms; skip `shape()` when nothing is dirty.                                                                                                                                                                                                                        |
| **Draw count and fragment cost**                                                                        | 200 labels draw in 2 draws against 1; double-sided text costs two passes; quads are not trimmed to ink **[competitor report; our side not verified]**.                                                                                                                                                                                                                                 | Single pass for double-sided text; batch compatible labels into one draw; ink-trimmed quads. Quad trimming was tried before and hit an edge with shadows and outlines, which draw outside the ink box: the trim has to be the ink box grown by the effect extent (outline width, shadow offset and blur) for that style. Measure GPU frame time. |
| **Many-label updates** (rewrite 64–512, publish 1,024, overwrite, setter-only)                          | Deficit is fixed cost: +0.28 ms intercept, +3.7% slope; 512 crossings against one; gather self time about twice main; possible inline-path miss for the fixture **[verified/arithmetic on old-machine data]**.                                                                                                                                                                         | Deferred batch prepare (one crossing); fewer per-setter allocations; write-only gather when a paragraph is fully rewritten; confirm inline-path admission; retained topology across count changes; reuse of identical shaped strings across labels. Capture on this machine.                                                                     |
| **Paint-only change** (colour)                                                                          | +23% against main on the old machine; cause never captured. **Unpriced.**                                                                                                                                                                                                                                                                                                              | Capture, then fix; expected to be host and gather work with no layout.                                                                                                                                                                                                                                                                           |
| **Font-size and axis change**                                                                           | Full relayout today; 22k publication after a size change was 8.6 against 6.6 ms. Shaping is in font units, so a size change should not need reshaping unless the font has size-dependent data **[not verified]**.                                                                                                                                                                      | Keep shape lanes in font units and rescale advances and geometry in a dense pass; refit. Verify what the engine does today.                                                                                                                                                                                                                      |
| **Inspection and readback** (per-glyph inspection, copy metrics from unchanged labels, `measureGlyphs`) | +14–32% and up to +71% behind on the old machine; `measureGlyphs` rebuilds a map over every glyph in the root after each publication and borrows 32 glyphs per crossing; per-glyph typed arrays are allocated per call **[verified]**.                                                                                                                                                 | Per-paragraph origin lookup; bulk borrow in one crossing; reuse output arrays.                                                                                                                                                                                                                                                                   |
| **Transform-only updates** (moving many labels)                                                         | Every frame visits all transforms; a `replace` copies the whole transform table **[verified]**.                                                                                                                                                                                                                                                                                        | Dirty-transform list; no full-table copy.                                                                                                                                                                                                                                                                                                        |
| **Publication and upload**                                                                              | Count change rewrites the batch suffix and re-admits every instance; Rust never emits `PATCH_COPY`; Three merges all dirty ranges into one envelope; WebGL2 re-uploads whole storage textures **[verified]**.                                                                                                                                                                          | Retained topology across count changes; `PATCH_COPY`; multi-range uploads; treat WebGL2 as a capability fact.                                                                                                                                                                                                                                    |
| **Shaping cost, cold and repeated**                                                                     | 51–115 ns per glyph Latin, 316 Arabic **[measured]**; whole-word chunking is slower cold; fonts such as Inter have rules across spaces.                                                                                                                                                                                                                                                | Reuse identical shaped strings (whole label or run) keyed by text and font instance, which is exact by construction; a bake-time fast path for runs proven rule-free stays a research spike.                                                                                                                                                     |
| **Download size**                                                                                       | 511 kB of gzipped wasm against a 43 kB competitor. Dense rewrites delete closure- and `dyn`-generic paths; AAT shaping is already rejected by the baker. **Unpriced by section.**                                                                                                                                                                                                      | Size audit of the wasm (Unicode tables, HarfRust features, retained ropes, ASCII-anchor policy, duplicate builders); remove what the new design retires; consider compiling out AAT; lazy loading.                                                                                                                                               |
| **GPU and CPU memory**                                                                                  | 3.38 MiB against 0.64 MiB in the competitor's run, driven by atlas format and what is baked; staged A/B lanes double CPU lanes.                                                                                                                                                                                                                                                        | Atlas subsetting and format options; capacity policy for buffers; report bytes per glyph.                                                                                                                                                                                                                                                        |
| **Tail latency**                                                                                        | Not profiled. Sources: per-setter allocations, measurement decode into a new Map, `memory.grow`. **Unpriced.**                                                                                                                                                                                                                                                                         | Allocation-free setters and reads on the steady path; pre-grown arenas.                                                                                                                                                                                                                                                                          |
| **Small paragraphs and labels**                                                                         | The resize interval hits often at a few lines; the inline path handles ≤64 units.                                                                                                                                                                                                                                                                                                      | Keep the validity interval for short paragraphs only; keep the inline path byte-identical.                                                                                                                                                                                                                                                       |

| **Copy and split** (edit + copy among many labels, `split()`, outlines) | Existing wins against main and `v0.1.0`; depend on one prepared revision shared by reads and publication. | Keep; bulk copy lanes; no per-glyph crossings. |
| **Rich text** (8,192-span formatted paragraphs, sparse and scattered style edits) | Existing wins of 60–87% from retained assignment. | Keep; outer loops over style segments in the dense stages must not regress them. |
| **Interleaved edit, read, publish among many labels** | Existing win (50 against 136 ms at 1,000 labels on the old machine); depends on work scaling with the edited label, not the root. | Keep; publication must reuse read-prepared results with no per-root revalidation. |
| **Correction-heavy text** (kerned fonts where every space is a correctable boundary; the "unsafe boundary" rows) | Reflow +73% behind main on the old machine; line-edge island shaping repeats when caches are dropped; the shortcut rejects edge records **[verified]**. | Cache retention; content-compared shortcut; shape line-edge islands in batches. |
| **Alignment and justification** | Centre, end and justify add 300–700 µs of positioning on a resize **[measured]**; general-case dense positioning keeps only 1–1.5× for justified lines **[estimate]**. | Dense justification pass; integer pen experiment; affine origin for centre and end. |
| **Non-Latin text** | Unicode analysis is 18% of an edit and the ASCII kernels do not apply; RTL positioning is a separate path; CJK takes the dense word mode. | Table-driven Unicode classes C1–C2; mirrored RTL pass; per-line bidi reorder over dense outputs; SIMD experiments below for C3. |
| **Request ingress** | Each request zero-fills its arena slice and writes through `DataView`; view objects are reallocated when the length changes **[verified]**. | Cached views; write only what is used. |
| **Renderer backends** | TypeGPU direct mode issues one draw per text (1,000 labels, 1,000 draws); WebGL2 re-uploads whole storage textures **[verified]**. | Batching option for TypeGPU; WebGL2 thresholds set from its real upload behaviour. |
| **Font registration and bake load** | Part of first frame; **unpriced**. | Profile; lazy per-script tables. |

### Existing research this plan builds on

Earlier notes in `planning/` already price several axes; the plan adopts them rather than re-deriving them.

- **`wasm-size-reduction.md` — the size plan.** Measured levers on the shaper (control 1,034,100 raw / 398,892
  gzip): panic machinery −88 kB raw / −34 kB gzip on nightly (−29 / −13 kB via a stable Binaryen post-pass);
  AAT with legacy `kern` retained −56 / −18.5 kB (only 31% recoverable post-build; the rest needs an `aat`
  cargo feature in HarfRust); BCP-47 language-tag resolution moved into the language payload −28 / −10.5 kB;
  Unicode table re-encoding about −45 / −18 kB; complex-script shapers as payload via a data-driven syllabic
  interpreter −126 / −40 kB; `engine::state` is a 406 kB surface, unpriced. HarfRust has no cargo features at
  all (harfrust#277). **Route:** a `[patch.crates-io]` fork carrying default-on `aat` (and `rand`) features and
  an inlining seam on the language path, offered upstream, removed when released. The naive AAT cut also
  removes legacy `kern`; the fork must keep it.
- **`integer-layout-units.md`.** Fit decisions are already integer (16 fraction bits, i64); the positioning pen
  was deliberately left f64. The integer-pen experiment below is that note's deferred migration.
- **`shaping-compilation-research.md`.** Static shaping, per-font bytecode and GPU shaping against the HarfRust
  baseline; the bake-time rule-free experiment below continues it.
- **`language-and-strike-bundles.md`.** Per-language font units and staged delivery; the memory and download
  rows for large fonts (55 MiB full Noto Sans, 48 MiB Arabic bake) depend on it.
- **`vertical-writing.md`.** Deferred with the rest of the typography list.

### Size and memory profile **[measured 2026-11-21]**

Report: `glyph-baselines-2026-11-21/profiles/7-size-and-memory.md`.

**Shaper wasm, gzip:** `v0.1.0` 501 kB; main 541 kB; branch start 631 kB. Code is 82%, data 18%. glyph's own
engine is 63% of code (877 kB raw); HarfRust 30% (423 kB raw). The branch's +94 kB gzip over main is all
glyph-owned: retained rope +71 kB raw, `engine::state` +43, plan and gather +32, cluster build +29, ASCII-anchor
+16.

| Largest owners                          | Raw    | gzip (est.) |
| --------------------------------------- | ------ | ----------- |
| `engine::state`                         | 254 kB | 99 kB       |
| glyph Unicode tables and code           | 204 kB | 62 kB       |
| Render plan, gather, wire               | 144 kB | 56 kB       |
| HarfRust GSUB/GPOS                      | 138 kB | 54 kB       |
| HarfRust complex shapers                | 117 kB | 43 kB       |
| HarfRust buffer, core, plan             | 105 kB | 41 kB       |
| HarfRust Unicode and tags               | 96 kB  | 30 kB       |
| Retained rope                           | 71 kB  | 28 kB       |
| Outline extraction (for outline export) | 71 kB  | 28 kB       |
| HarfRust AAT                            | 66 kB  | 26 kB       |

Also: 115 closure-generic instantiations in glyph total 152 kB raw; sort instantiations 82 kB across nine
element types.

| Cut (measured on the branch artifact)                                                                 | gzip saved                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| AAT out, legacy `kern` kept                                                                           | 26.4 kB                                   |
| Outline export made lazy                                                                              | 22.7 kB                                   |
| `-Zlocation-detail=none` (+`fmt-debug=none`)                                                          | 17.6 (19.9) kB                            |
| ASCII-anchor path removed                                                                             | 10.6 kB                                   |
| Paths this plan retires (rope, old cluster build, positioning, ASCII-anchor), before replacement code | up to about 76 kB                         |
| `opt-level=s` (20–45% slower) / `z` (50–75% slower)                                                   | 72 / 132 kB                               |
| Latin/Greek/Cyrillic-only build                                                                       | 71 kB (only 7% under a full no-AAT build) |

There is no ABI seam between engine and HarfRust, so a per-script code split is not available today; the
Unicode re-encoding estimate in the old size note is stale (the tables are now 141 kB of two-stage tries and
need re-pricing). **Floor at current speed: about 0.5 MB gzip** for a full multilingual module; the
competitor's 45 kB is out of reach for any engine that shapes (HarfRust layout, core and Unicode plus UAX tables
are about 165 kB gzip before engine code). The lever that scales is glyph's own 877 kB.

**CPU memory:** 8.0 MB live before any text (`init` reserves 32,768-entry shape and gather workspaces, 3.6 MB;
root creation adds 4.4 MB regardless of requested capacity). 761 B per glyph at mount, 1,139 B after the first
edit (the pending half of the staged lanes fills), 1,355 B after 21 edits and still growing: the allocator
grows by exact pages as separate regions that cannot merge. Staged lanes are 560 B per UTF-16 unit committed,
of which clusters are 240. 25 kB per 9-glyph label.

**GPU memory:** set by the technique's whole-font upload, not by the text. Slug 3.0 MiB for Inter, of which
1.4 MiB is zero padding in the curve texture (2× estimate plus power-of-two rows); MTSDF 40 MiB; bitmap 0.66
MiB. No runtime subsetting. Slug instances carry 64 of 120 bytes of per-font glyph constants repeated per
instance. Floors for a 1,000-glyph paragraph: 1.74 MiB by trimming padding, 0.15 MiB uploading only used
glyphs, 0.06–0.07 MiB with a per-glyph constant table.

### Font-size and inspection profile **[measured 2026-11-21]**

Report: `glyph-baselines-2026-11-21/profiles/5-6-fontsize-and-inspection.md`. Loaded machine; ratios and splits
are the usable part.

**Font-size change.** The paragraph body is not reshaped; shape lanes are already in font units and nothing in
a baked font needs size-dependent shaping. What reruns: style resolve, shaping-run rebuild, advance refresh,
full run-local geometry, full fit, full positioning, gather, plan. Line-edge islands _are_ reshaped (428
HarfRust calls per change on Fredoka) because the island cache is dropped on any metric change, although island
shapes do not depend on size. Letter spacing and line height take the same path; line height changes no
advance or run-local input yet both are rebuilt, plus a 1.35 ms per-run comparison.

| Font-size publication, wasm self ms (25,900 glyphs, Inter) | branch   | main     |
| ---------------------------------------------------------- | -------- | -------- |
| Style, runs, advance refresh                               | 0.39     | 0.20     |
| Run-local geometry                                         | 1.51     | 1.43     |
| Fit                                                        | 0.24     | 0.09     |
| Positioning                                                | 1.33     | 1.90     |
| **Gather**                                                 | **3.76** | **1.34** |
| Render plan                                                | 1.02     | 0.87     |
| Total                                                      | 8.53     | 6.48     |

**The branch's publication regression against main is gather.** The branch always takes the retained-diff
gather (`state.rs:2110-2125`); top costs are `compare_projected_inputs` (`codec_gather.rs:2277`, 1.06 ms),
`update_retained_source` (0.61), `GatherInputCursor::row_at` (0.59). The same cost appears on every
single-paragraph publication: colour-only 4.54 against 1.28 ms; a one-character edit 3.27 against 0.11 ms.
Line-height publication pays 4.6 ms of gather and plan where main pays 0.25.

**`measure()` after a change is about 2× main** (3.2× after a width change: 1.18 against 0.37 ms): the branch
positions every glyph and unions every ink box (about 22 ns per glyph in wasm); main reads lines. Measurement
is also sticky: once `measure()` has been called, every later setter pays it.

**Inspection.** `glyphs()` first call after a change crosses into wasm 812 times on the branch (32 glyphs per
crossing) against once on main. `readGlyphs` crosses once per glyph (25,900) on every version. A sparse
one-glyph borrow after a width change builds and seeks a cursor each call: 96 ns against 7 on main. Copying
metrics from unchanged labels is +46% against main, partly from a non-enumerable `outlineAt` on cached columns
slowing the object spread. The glyph-origin map is rebuilt in full after every publication (0.3 ms at 1,000
labels). `measureGlyphs` is half garbage collection from per-glyph objects.

**Work this adds or sharpens:**

- Gather: a write-only path when all or most of a paragraph changed; diff only where a diff can win; make the
  comparison a lane compare. This is the largest single branch regression and applies to edits, colour, size
  and line height alike.
- Measurement from per-line ink (already in the dense positioning design), not a per-glyph union; no sticky
  measurement.
- Metric changes: keep island shapes; rescale advances and run-local geometry in a dense pass (run-local is
  linear in scale); requantize break corrections; line height must skip advances and run-local entirely.
  Inferred floor for the layout half: about 2.0 of today's 3.5 ms.
- Inspection: one crossing for bulk reads on every path; a cursor-free single-glyph read; per-paragraph origin
  lookup; no per-glyph objects.

### Colour-only and many-label profile **[measured 2026-11-21]**

Report: `glyph-baselines-2026-11-21/profiles/3-4-colour-and-many-label.md`. Loaded machine.

**Core finding: on the branch every setter prepares its paragraph synchronously in wasm** (three crossings:
`request_capacity`, `request_ptr`, `measure_paragraph`); on main and `v0.1.0` a setter only records desired
state. Every regression in this group traces to it, which is what the preparation model in section 3 removes.

- **First set** (3× main): the setter shapes and lays out the label, 8.8 µs of added work (76% in
  `measure_paragraph`: shaping 4.6, inline-leaf build 1.6, Unicode 1.1), amplified in the benchmark by running
  lukewarm after a forced GC. Request encode is 0.47 µs; the arena zero-fill and `DataView` writes are not the
  problem. The other side: set-then-measure is 10.3 µs against 13.5 on main.
- **Overwrite before publication:** two preparations, the first discarded; and the publication is no longer a
  no-op, because main sends no mutation when desired equals published (`minimalTextMutation`) while the branch
  runs gather, codec and an O(N) transform rebuild (`command-buffer-renderer.ts:650-688`).
- **Typing one character:** the published +370% is misleading (the baseline alternates a 70 µs "restore" with
  a 1,940 µs insert). Against the mean the branch is +57% (Inter) and +72% (Fredoka) behind main, and 18%
  _faster_ on the insert alone. Per keystroke the branch sends a full-text replace (10 kB request, 2,517
  `DataView` writes) where main sends a 375-byte minimal mutation; `validate_planner_inputs` costs 314 µs,
  Unicode 307, cluster build 947, positioning 208, measurement 155, shaping 119.
- **Colour-only publication:** the branch is far ahead at scale (0.107 µs per untouched label against 0.667 on
  main) but does layout in the setter for a colour change: 3.8–5.3 µs for a short label, and it repositions a
  whole 4k-glyph paragraph (282 µs). No shaping on either arm.
- **Rewrite 64–512, publish 1,024:** setter 5.6–8.7 µs per label against 0.8–1.3 on main; publish 3.4–5.2
  against 8.1–11.7. Totals are level except rewrite 512 (+32%), whose per-label growth with N is unattributed.
  Gather when everything changes costs twice main's (2.3 against 1.1 µs per label).
- **Remaining O(N) per publication on untouched labels:** `#reconcileEntries` (`text.ts:1490`), the Rust
  `owner_kind_changed` scan (`state.rs:2048`), `#renderMembers`, transform rebuild.
- **Inline path:** admitted for Inter labels up to 64 units; **not admitted for Fredoka word labels** (rejected
  in `InlineLeaf::build_clusters`, then permanently on the general path), so kerned fonts miss it.

**Work this adds or sharpens:**

- Section 3 is confirmed as the fix for first set, overwrite and the setter half of dense rewrites; a colour
  change must never run layout.
- Edit-aware requests: a minimal mutation, not a full-text replace; a setter that restores the published value
  must cost nothing and publish nothing.
- Input validation proportional to the edit, not the paragraph.
- Inline path admission for kerned fonts (or a dense small-label path that does not need it).
- No per-publication scan of untouched labels in Rust or JavaScript.

### Browser first-frame and idle profile **[measured 2026-11-21]**

Report: `glyph-baselines-2026-11-21/profiles/1-2-browser-first-frame-idle.md`. Chrome 157 headless, WebGPU on
Metal, 912 cold loads alternating branch and main, Inter MTSDF unless stated.

**First frame, 200 labels, navigation to GPU done about 254–279 ms.** Where it goes (ms, branch / main):

| Stage                                                   | ms        |
| ------------------------------------------------------- | --------- |
| Font fetch (39 MB file)                                 | 55 / 43   |
| Font decode, digest, register                           | 34 / 32   |
| Import `three/webgpu`                                   | 32 / 29   |
| HTML, entry chunk, glyph modules                        | 38 / 32   |
| Mount (`createText` ×200)                               | 48 / 27   |
| First render: publication                               | 13 / 36   |
| First render: Three node build, pipelines, atlas upload | 23 / 24   |
| GPU queue drain                                         | 12 / 12   |
| wasm fetch, compile, instantiate                        | 6.6 / 5.3 |

- **The font artifact is about 45% of the first frame.** A JavaScript hash of the whole 39 MB file takes
  19.4 ms (`content-digest.ts:20`); three further full copies of the atlas take 11–12 ms; the whole 41.9 MB
  atlas is uploaded (16 ms against 3.4 for a sub-megabyte atlas). With a 0.9 MB bitmap font the same page is
  done in 131–137 ms.
- **Every MTSDF font is its own shader and pipeline:** atlas dimensions are baked into WGSL as literals
  (`msdf-shader.ts:66-69`). Likely cause of 155–591 ms first-use stalls seen in 8 of 912 loads.
- **Mount plus first render is the same on both trees** (84 against 86 ms at 200 labels): the branch moved
  engine work into `createText`, main does it in the first frame.
- **The first paragraph runs 10–17× slower than the second** on every font: first-use cost, not shaping.
- **Mount is quadratic in two places:** `#reconcileEntries` (`text.ts:1490`) and
  `PlannerState::prepare_upsert` (`state.rs:3772`, a `Vec::insert` of a struct holding the whole paragraph
  state). Quadratic share: 2–3% at 200 labels, 25–33% at 1,000, about half at 2,000.
- **Cold engine split, 22k paragraph (wasm ms):** shaping 12.1, gather 5.4, plan compile 4.3, geometry and
  flow 3.9, cluster build 3.9, Unicode 2.8, positioning 2.1. Cold, shaping is the largest stage.
- Main's warm remount of 1,000 labels degrades from 76 to 235 ms in the allocator; the branch does not.

**Idle frame.** `render()` is 0.33 ms at 200 labels and 0.62 at 1,000 (branch); glyph's share is 0.12 and
0.36 ms. Per frame at 1,000 labels: transform sync chain 0.161 ms, `Text.updateMatrixWorld` ×N 0.144, reconcile
scan 0.045, 79 kB of garbage. `shape()` costs at most 0.008 ms and never crosses into wasm. Draws: 3 per frame
(two for the double-sided material, one for Three's output pass).

- **Double-sided:** two draws but each fragment is shaded once; every quad is back-facing in a y-down
  orthographic scene, so one side alone is equivalent.
- **Quads are already trimmed to the glyph,** but MTSDF quads are 1.64× the ink box and ink is only 25% of the
  rasterized area for a 10 px label.
- **The MSDF fragment shader samples the atlas twice per fragment** (fill and shadow) whether or not a shadow
  is set: 0.31 ms of fragment time at 1,000 labels against 0.014 for bitmap.
- Three's own first render and output pass cost more than glyph's publication and GPU pass at typical counts.

**Work this adds or sharpens:**

- Font loading as its own unit: no whole-file hash on the critical path, no redundant atlas copies, paged
  upload; consider a compressed or smaller default atlas tier for labels.
- One shader and pipeline shared by all fonts of a technique (atlas dimensions as uniforms).
- Conditional shadow sample; one side for flat text; tighter SDF quad padding where the style allows.
- Warm-up of first-use engine state during `init()` or off the critical path.
- Linear mount in both JavaScript and Rust (`prepare_upsert`).
- Cold shaping is the largest engine stage at mount: shaped-string reuse and the bake-time rule-free path
  matter most there.

### The competitor's eight measures on this machine **[measured 2026-11-21]**

Rebuilt from the published setup (scenes are not public; scale and options are guesses, so use as same-machine
targets only). Chrome 157 headless, WebGPU on Metal, loaded machine, medians. Report:
`glyph-baselines-2026-11-21/profiles/8-competitor-set.md`; harness `/Volumes/Depot/Developer/glyph-competitor-bench/`.

| Measure                                                   | ultra-text 1.0.1                  | glyph 0.1.0 | main  | branch start |
| --------------------------------------------------------- | --------------------------------- | ----------- | ----- | ------------ |
| Steady paragraph, ms/frame at 4× fill (empty frame 0.067) | 0.186                             | 0.264       | 0.239 | 0.239        |
| Steady paragraph, CPU ms/frame                            | 0.010                             | 0.137       | 0.012 | 0.012        |
| Steady 200 labels, ms/frame at 4× fill                    | 0.192                             | 0.300       | 0.262 | 0.259        |
| Steady 200 labels, CPU ms/frame                           | 0.011                             | 0.201       | 0.051 | 0.049        |
| Draw calls, paragraph / labels                            | 1 / 1                             | 2 / 2       | 2 / 2 | 2 / 2        |
| First frame, paragraph, ms                                | 30.3                              | 40.7        | 41.2  | 38.8         |
| First frame, 200 labels, ms                               | 33.2                              | 60.7        | 62.5  | 61.5         |
| Width change, CPU part, ms                                | 0.26 `reflow()`; 1.82 `rebuild()` | 0.62        | 0.54  | 0.89         |
| Edit 10 known letters, CPU part, ms                       | 1.91                              | 1.20        | 1.10  | 1.37         |
| Never-drawn letter, ms                                    | 4.40 (3.28 reserved)              | 2.53        | 2.42  | 2.43         |
| GPU memory, paragraph, MiB                                | 0.49 (7.3 peak)                   | 1.44        | 1.44  | 1.44         |
| Download, kB gzip                                         | 45                                | 627         | 674   | 762          |

What it shows:

- **Steady frame:** CPU is already tied for a paragraph; the remaining gap is GPU-side and scales with covered
  pixels: two draws of a four-channel MSDF against one draw of an R8 SDF on trimmed quads. At 200 labels 0.04 ms
  of CPU remains: per-text `sync`, `syncTransforms` and `needsReconcile`, plus Three's own matrix pass over 200
  objects. `v0.1.0` uploaded 200–440 kB every idle frame; main and the branch upload nothing.
- **First frame:** shaping is about 1 ms and synchronous WebGPU calls about 1 ms. The time is JavaScript: the
  first `glyph.shape()` (18 ms paragraph, 29 ms labels on main: plan and resource set-up), and Three building
  node graphs for two materials (13.6 ms first render against 9.7). 200 labels: `createText` ×200 is 13–32 ms,
  with 3.6–6 ms in `structuredClone` on the branch.
- **Width change:** main is 2× behind `reflow()` on CPU; the branch start regresses further (0.34 ms of wasm per
  change against 0.07 on main).
- **Edits:** glyph is ahead; the competitor pays 0.74 ms of DOM measurement per edit.
- **Memory:** one 1023×344 RGBA8 atlas sized by the bake, not the text. Latin-1 is 2.57 MiB, full Noto Sans
  55.5 MiB, an Arabic bake 47.9 MiB (46 MB file, 98 s to bake).
- **Download:** the shaper wasm is 541 kB on main and 631 kB on the branch (+89 kB).
- **Correctness:** the competitor's default path draws `fi`/`fl` unligated and Arabic as isolated forms; its
  browser-shaping option is correct at a 187 ms first atlas build. The timed scenes contain no ligature pair.

## SIMD experiments

Every idea raised in planning is tested, none is dropped on argument alone. Each is built as a kernel on real
data, compared with the dense baseline in wasm, and **adopted when it is faster or equal** with output unchanged.
Where an idea changes output bits, the change is stated and the owner decides.

| Experiment                                                                                                                | What it could win                                                                                         | Known constraint                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Paragraph pyramid: advance sums and ink min/max at dyadic scales                                                          | Line ends by search; range ink without glyph visits; O(log n) updates                                     | Max ink corner is not a pure translate today                           |
| Fit as a search over cumulative advances (Eytzinger or S-tree layout) and a fit-only query                                | "How many lines" at competitor speed                                                                      | Corrections and rescue rules must still be consulted                   |
| Resize validity interval                                                                                                  | Skip fitting when no break can change                                                                     | Rarely hits on long paragraphs; test on labels and short paragraphs    |
| Integer pen                                                                                                               | Reorderable prefix sums; unlocks the 30× positioning kernel and 74× segment-box ink measured in the spike | Changes output bits by under an ulp of f32                             |
| Affine placement for centre and end alignment, evaluated identically on CPU and GPU                                       | Resize uploads one value for those alignments                                                             | Not valid for justify; differs by an ulp from today                    |
| SIMD Unicode stage one: class lookup and pair table to break and boundary bitmasks, state machine only on flagged residue | Unicode analysis for C1–C2 at ASCII-kernel speed                                                          | Unbounded-context rules need the residue path                          |
| Data-parallel state machines for bidi and line-break residue                                                              | C3 scripts                                                                                                | Research                                                               |
| SIMD text diff and lane compares                                                                                          | Edit discovery, stable ids, run comparison                                                                | Already measured for ids and runs                                      |
| Batch line-edge island shaping                                                                                            | Correction-heavy text                                                                                     | HarfRust call overhead per island                                      |
| Shaped-string reuse keyed by text and font instance                                                                       | Dense label rewrites, cold mount of repeated strings                                                      | Exact only for whole runs or labels                                    |
| Bake-time proof that a run is rule-free, shaping it by table lookup and class-pair kerning; bit-parallel rule matching    | Cold shaping without the shaper                                                                           | Fonts such as Inter have rules across spaces                           |
| Content-anchored blocks, windowed cluster rebuild, rebase-aware line reuse                                                | Local edits in very long paragraphs                                                                       | Changes golden bytes; saves about 13 ns per cluster after dense stages |
| SIMD gather and codec packing; write-only fields for rewritten paragraphs                                                 | Publication of dense updates                                                                              | Gather is per-field lanes keyed by render binding                      |
| Ink-trimmed quads grown by effect extent                                                                                  | Fragment cost                                                                                             | Earlier attempt clipped shadows and outlines                           |

### Profiles required before this section is firm

1. Cold mount and first frame, split into wasm instantiate, font load, prepare, publish, pipeline compile, upload.
2. Idle frame CPU and GPU time at 200 and 1,000 labels.
3. Colour-only publish.
4. Dense rewrite 512 and publish 1,024 on this machine.
5. Font-size change path.
6. Inspection and copy paths.
7. Wasm size by section.

**Fonts for every profile and for the oracle.** Benign fonts hide the costs that matter, so each profile runs on
an adversarial set as well as the usual fixtures:

- In the repo: the four synthetic fonts under `engine/adversarial-fonts/`; Inter (contextual rule reaching seven
  glyphs across spaces); Fredoka and Source Serif (space kerns against the next word, so every line edge is a
  correctable boundary); Dancing Script (cursive ligatures); Amiri; Noto Sans Devanagari; Noto Sans CJK JP.
- To add, each chosen for a specific stress: a Nastaliq Urdu font (deep contextual and cursive positioning); a
  coding font with long ligature and contextual chains; a text family with many optional features and a large
  kerning table; a variable font instanced at non-default axes; a colour font; a font with `rand`; a font with
  only a legacy `kern` table; a full CJK font (large glyph count, extension lookups, punctuation kerning); Hebrew,
  Thai, Bengali, Hangul and emoji fonts, which have no fixture today.

**Fetched 2026-11-21** to `/Volumes/Depot/Developer/glyph-adversarial-fonts/` (manifest `MANIFEST.md`, baked
GLBs under `baked/`): Noto Nastaliq Urdu, Fira Code, EB Garamond roman and italic, Recursive, Noto Color Emoji
(CBDT and COLRv1 builds), Nabla, full Noto Sans CJK SC (65,535 glyphs), Noto Sans Hebrew, Thai, Bengali and KR,
a natural legacy-`kern`-only font (Cherry Cream Soda) and a synthesized one, and a synthesized `rand` font (no
upstream font among 3,923 on Google Fonts has `rand`). What the bakes showed **[observed]**:

- The baker rejects every variable font (`fvar`); static instances stand in. The variable-font lane therefore
  starts at the baker, not the engine.
- A CBDT colour font cannot be baked by any raster (no outlines), and there is no shaping-only bake, so its
  emoji sequences cannot be profiled. COLRv1 fonts bake as outlines; `COLR`/`CPAL` are not kept.
- Legacy `kern` survives into the shaping payload, so kern-only shaping is testable.
- No fetched font has AAT tables; that rejection path is untested.
- Bake cost is itself an axis: full CJK takes 218 s and 196 MB as Slug; Noto Sans KR 57 s and 51 MB; an MSDF
  bake of a 2,030-glyph font 76 s and 28 MB.

## Who benefits

| Text                         | Dense stages                                                                        | Local edits                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Latin, Greek, Cyrillic prose | Yes (needs C1)                                                                      | Yes                                                                           |
| CJK                          | Yes with C2 and multi-run loops                                                     | Dense refit, not convergence: one inserted ideograph shifts every later break |
| Arabic, Hebrew               | Cluster build and ink yes; positioning needs a mirrored pass; Unicode stays general | With a bidi-level compare                                                     |
| Mixed bidi                   | Cluster build and ink                                                               | No                                                                            |
| Indic                        | Yes with n:m cluster scatter; Unicode stays general                                 | Yes                                                                           |
| Thai                         | Yes except Unicode                                                                  | No break opportunities to converge on                                         |
| Justified or centred         | Ink and cluster build; positioning 1–1.5×                                           | Yes                                                                           |

## Expected result

22k glyphs, Latin, start-aligned. Wasm figures apply the measured 1.4–1.5× engine ratio.

| Workload                  | Today (wasm) | After dense stages                | After local edits               | With the gated block work   |
| ------------------------- | ------------ | --------------------------------- | ------------------------------- | --------------------------- |
| Midpoint insert + measure | 8.96 ms      | about 1.7 ms **[measured floor]** | about 1.2–1.4 ms **[estimate]** | about 0.5 ms **[estimate]** |
| Width change + measure    | 1.91 ms      | about 0.4 ms **[measured floor]** | same                            | same                        |

Every other axis is covered under "Every axis"; none is out of scope. Their expected results are not stated
because they have not been profiled on this machine. Against a width-only competitor such as pretext, the
fit-only query should reach parity on "how many lines"; a single-character edit will stay several times slower
while doing real shaping.

## Measurement

No formal pass/fail protocol, thresholds or arm counts (owner decision). The branch as a whole either beats the
existing architecture or it does not.

- **Before building:** one full-suite snapshot each of `v0.1.0`, main `4e25a96a` and this branch's starting point
  on this machine. These are a loose reference only; machine load varies.
- **During the work:** any benchmark is run interleaved against main in the same session. No comparison against
  a saved number.
- **Snapshot 1, `v0.1.0` against branch start** (full suite, 143 workloads, one run, loose): 94 faster, 24
  slower, 25 neutral; median workload 1.32 → 0.86 ms. Where the branch start is _behind the published release_:
  typing one character into a long paragraph and measuring (+370%, Fredoka +267%), first set of 1/100/1,000
  labels (+220–285%), unsafe-boundary reflow (+84%), measurement after width change (+81%), copying per-glyph
  metrics from 100 unchanged labels (+77%), publication after text change (+25–36%), cached per-glyph inspection
  (+24%), font-size change (+16–22%), 22k mount (+8%). Where it is ahead: colour-only publication at 100–1,000
  labels (−49 to −82%), interleaved and immediate edit-read-publish (−59 to −87%), formatted paragraphs (−57 to
  −91%), 1,000-label publication (−43 to −54%). Files: `glyph-baselines-2026-11-21/run1-published-vs-branch-start/`.
- **Snapshot 2, main against branch start** (same conditions; machine not quiet, load 3–4). Branch start behind
  main (p50 ms, main → branch): first set of 1/100/1,000 labels 0.035 → 0.10 (2.7–3.0×, setter-only);
  unsafe-boundary reflow 0.32 → 0.64; 22k measurement after width change 0.83 → 1.64; measure after text change
  1.16 → 1.71; typing one character and measuring 1.28 → 1.83; 22k publication after text change 6.5 → 9.1;
  22k publication after font-size change 6.3 → 8.0; overwrite before publication 1.4–1.5×; common publish after
  colour change 1.31 → 1.59; 22k mount 17.6 → 19.8; rewrite 512 6.85 → 7.42. Ahead of main: 1,000-label
  colour-only publication (0.30–0.40×), interleaved edit-read-publish (0.38×), immediate measurements with
  publication (0.21×), formatted paragraphs (0.12–0.40×; main's two monospaced rows may be contaminated),
  22k publication after width change (0.65×). Level: cached inspection, copy metrics from unchanged labels,
  publish 1,024, Fredoka edit and measure (1.50 against 1.58; `v0.1.0` is fastest at 0.97). Tables:
  `glyph-baselines-2026-11-21/summary.md`, `tables.md`, `snapshot.csv`.
- **Correctness** is the only hard gate: wrong output is a failure.
- **Sizes that matter:** the realistic worst case is about 2,500 words (two pages at 8 pt, roughly 15k glyphs).
  The 22k-glyph paragraph is a stress test, not a target.
- **Workloads worth adding** because the existing rows flatter the design (one sentence repeated, 1/64 px width
  steps, 4k-glyph edits): random-offset typing in natural text at page and two-page sizes, a drag-resize that
  crosses breaks, and the same on CJK, Arabic, mixed bidi and justified text.
- **Things to watch early:** the wasm kernel ratios once the first dense stage is in the engine; rows the plan
  does not touch (colour-only publish, per-glyph inspection, cold mount, small-label publication) for drift; the
  Fredoka keystroke through the public API against main.

## Decisions

Made by the owner: correctness and mid-paragraph editing are requirements; data-oriented and SIMD; deferred
never-stale preparation with a per-text callback property and a prepare that cannot fail; OpenType shaping only
(the baker already rejects AAT tables); variable fonts reserved (font-instance identity in keys, bake-time
instancing; animated axes are a full reshape, Slug only, out of scope); HarfRust stays; large units, spikes for
evidence, one final comparison.

Also decided (2026-11-21):

- **No eager per-setter mode.** Reads prepare on demand; `prepare()` covers apps that own their pipeline.
- **Bad input throws.** In react-three-fiber the throw goes to the nearest error boundary, which is how modern
  React expresses fallback declaratively; `<Text>` does not catch it. `onError` is for publication-time failures.
- **22k-glyph paragraphs are not a target;** about 2,500 words is the realistic worst case. The gated block work
  (content-anchored cuts, windowed rebuild) is therefore unlikely to be needed.
- **No formal pass/fail protocol;** see Measurement.
- **Code quality tools.** Implementers run `fallow` (TypeScript: complexity, duplication, unused code) and
  `kimun` (complexity, duplication, hotspots) alongside the linters and formatters, and act on what they report
  for the code they touch.

- **Feature scope.** Editing support is built in this plan; `rand` and AAT are dropped; every other missing
  typographic feature is deferred (section 5 and the decision record). Legacy `kern` keeps working.

Decided 2026-11-21 (second round):

- **Oracle starts now,** in parallel with the remaining profiles and the whole-plan review.
- **Atlas upload on demand:** upload the glyphs in use, in pages, instead of the whole baked font. The cost of
  a never-drawn glyph becomes an upload and must be measured against today's 2.4 ms row.
- **Nightly Rust is accepted for the shipped wasm** so panic machinery can be removed (34 kB gzip against 13 kB
  on stable).
- **Speed over size:** no `opt-level=s` or `z`.
- **HarfRust is forked inside this repository** (vendored source under `vendor/harfrust`, wired with
  `[patch.crates-io]`), carrying default-on cargo features for AAT and `rand` with legacy `kern` kept. An
  upstream pull request is a separate, later decision.
- **`onLayout` re-entrancy throws immediately:** a callback that changes text or layout input during its own
  layout phase is an error; there is no extra prepare pass.
- **Commits:** milestones are committed locally on `experiments/segment-indexed-layout` as the work proceeds,
  so the history is easy to pin and maintain; the branch is pushed when the feature is done.

Awaiting a clear answer: whether a breaking API release is acceptable (setters no longer prepare, two-step
Three publication, `onLayout`); whether sub-ulp output changes (integer pen, affine placement) are approved in
principle; deleting stale guidance.

## Refinements from the fifth review

Reports: `glyph-baselines-2026-11-21/review-v5/`. Each finding becomes work or an experiment; nothing is cut.

### Completeness and execution review

Work added (each owned by a unit below):

| #   | Finding                                                                                                                                                                                                                                                | Work                                                                                                                                                                                                                          | Settled by                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | A keystroke pays O(text) outside the stage table: full-text replace, whole-payload validation (314 µs), whole-text Unicode (307 µs)                                                                                                                    | **Minimal mutation against the last prepared text and edit-sized validation, built before unit 2**, so local edits show through the public API                                                                                | The typing row through the public API                                                                      |
| R2  | The plan retires the retained rope yet keeps wins that depend on it (2.9 µs retained gather for one edit of 1,000 labels against 535 µs on main)                                                                                                       | **Gather rule:** diff when few rows changed, write-only when most changed, one layout, stable switch. What is retired is the rope's use for _layout_ records, not sparse gather                                               | Force `retained = false` at `state.rs:2110-2125` and rerun the existing harness on both shapes of workload |
| R3  | `measure()` after a change cannot beat main if it needs positioning (main: 0.37 ms at 22k without positioning)                                                                                                                                         | `measure()` answers from the fit-only query; ink is computed on demand, per line. Define what a `measure(constraints)` sweep does to prepared state                                                                           | Width-change measurement row against main                                                                  |
| R4  | Engine mount is quadratic (`prepare_upsert`, 27 ms self at 1,000 labels) on branch and main                                                                                                                                                            | Make it independent of root size; add a dispose-and-recreate workload                                                                                                                                                         | Label sweep 100–2,000                                                                                      |
| R5  | CPU memory grows with every edit and nothing owned it (761 → 1,355 B per glyph; 8 MB before text; 25 kB per label)                                                                                                                                     | **CPU-memory unit:** reservations sized from use, pending lanes on demand, mergeable allocator regions, shared scratch; a typing soak. Reconcile with "pre-grown arenas" for tail latency: grow in policy steps, not per miss | Bytes per glyph after 1, 21 and 1,000 edits                                                                |
| R6  | First frame is the font artifact, cold code and Three, which dense stages do not touch                                                                                                                                                                 | Unit 9 made concrete: hash without the atlas payload, remove atlas copies, atlas dimensions as uniforms, first-use `compileFont` and codec install moved off the critical path                                                | First-frame split                                                                                          |
| R7  | A colour change reruns positioning in full (1.76 ms of a 22k colour publication) and rebuilds the inline leaf for labels                                                                                                                               | Paint-only changes skip layout entirely                                                                                                                                                                                       | Colour rows                                                                                                |
| R8  | Kerned-font labels never take the inline path and never return; labels over 64 units are 15–18% behind main                                                                                                                                            | Admission for kerned fonts, a way back, and label lengths 80/128/256 in the workloads                                                                                                                                         | New label-length rows                                                                                      |
| R9  | Right-to-left text never takes the resize shortcut (Amiri 2.2 ms against 0.13 for Inter, native, 15k)                                                                                                                                                  | Extend the content-compared shortcut to RTL lines                                                                                                                                                                             | Amiri width-change row                                                                                     |
| R10 | The renderer lane had no correctness gate                                                                                                                                                                                                              | Pixel reference from the branch-start build for every technique and effect                                                                                                                                                    | Per-commit comparison                                                                                      |
| R11 | Smaller rows: toggle a group of 1,000; measure 1,000 unchanged (`#assertMember`); outline paths never profiled; line height (1.35 ms per-run comparison, needless refit, a regather main avoids); idle garbage 31–111 kB per frame; bake time and size | Each added to its unit: host, readback, metric changes, idle frame; bake time and size get their own unit                                                                                                                     | Their snapshot rows                                                                                        |
| R12 | Size: `opt-level=2` saves 14 kB gzip at no stated speed cost; 82 kB of sort instantiations; three Unicode databases; 132 kB of adapter JavaScript; `engine::state` 254 kB                                                                              | Added to the size unit; `opt-level=2` needs the speed check before adoption                                                                                                                                                   | Interleaved shaping-bound rows                                                                             |
| R13 | The width-change gap to the competitor's `reflow()` is host-side (0.07 of 0.54 ms is wasm on main) and unprofiled                                                                                                                                      | Profile the host half of a width change                                                                                                                                                                                       | CPU profile of the width setter                                                                            |

Corrections to claims in this plan:

- The wasm-to-native ratio is 1.5–2.6× for gather, positioning and run-local, not 1.4–1.5×; the expected-result
  table is optimistic until re-measured in wasm per stage.
- Host cost per edit is 0.36 ms of package JavaScript at 22k, not under 0.1 ms.
- There is no `dyn` in the binary; the overhead is closure generics (152 kB, 115 instantiations).
- Rows above still marked unpriced for colour, first frame, font size and download are now measured.

Constraints from earlier notes, now adopted:

- The accepted decision `decisions/retained-prepare-publish.md` requires synchronous setter preparation and no
  public `prepare()`. It is superseded by `decisions/deferred-never-stale-preparation.md`.
- The engine-call-contract skill governs the new error model; `capacity.policy: 'fixed'` is not a failure.
- Each SIMD experiment reports code size and a whole-operation number as well as the kernel number (D-245).
- Earlier gather experiments (E3, E5, E6, whole-V3) were run and rejected; the gather unit states how it
  differs before building.
- Sub-ulp experiments get their own frozen reference; the main reference is never regenerated.
- From the reflow note: zero steady-state allocation, bytes published per width change, exclusions with a
  moving obstacle, and a soak are all measured.

Axes added (none had a row): scrolling and culling of long documents; many paragraphs in one root; streaming
and append (chat, logs); coalesced and multi-range edits before one read (the normal case under deferred
preparation); selection and caret rendering; resizing many labels at once; device-pixel-ratio change; fallback
chain cost; worker preparation; device loss and tab restore; long-session soak; other browsers and CPUs;
WebGL2; the benchmark app's own browser scenes.

### Multilingual correctness and editing review

Two local-edit rules in section 2 were wrong as worded; both were shown with concrete inputs
(`review-v5/i18n-editing.md`, tests in `/Volumes/Depot/Developer/glyph-review-scratch/i18n/tests/`).

| #   | Finding (evidence run on real fonts)                                                                                                                                                                                                                                                                                                                                                                                                         | Refinement                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **A fixed 37-cluster halo is unsafe: shaping reach is unbounded.** Inter: in `A` + `-(`×60 + `Tword word`, changing `A` to `a` changes glyphs out to cluster 115 and flips 38 boundaries from over-cap islands to safe. Nastaliq: replacing the last letter of a 45-letter word changes all 44 before it. A cached correction also reads island glyphs, `CLUSTER_SAFE_BEFORE` within ±33, the refused slot and the paragraph-wide `ltr` flag | **The halo is measured from the cluster build's dirty ranges** (glyph ids, advances, offsets, `unsafe_before`, break flags, owner lanes), not from the edit position. Everything is dropped when `ltr` or a run's shaping inputs change                                                                                                                                                                                                      |
| M2  | **"Bidi is level zero outside the window" is false after an RTL character.** In `abc א 1 2 3 … 10 + 11 x` digits far from the Hebrew letter are level 2. An inserted `(` changes a `)` 564 units later; one prepended Hebrew letter flips every level                                                                                                                                                                                        | Classify bidi per bidi paragraph (split at Bidi_Class B). Keep three counts per paragraph (R/AL/AN, explicit controls, overrides); a count crossing zero reruns that paragraph and invalidates the caches in M1                                                                                                                                                                                                                              |
| M3  | **Unicode resync holds for four lanes and fails for two.** 400,000 fuzzed strings gave no counterexample for line breaks, graphemes, words or sentences at letter–space–letter cuts. It fails for scripts (`я µ µ a`: U+00B5 is Script=Common and inherits across the cut) and required breaks are not a restart for scripts, sentences or bidi. Windows are unbounded in length (LB25 moves a break 41 units away, SB8 80)                  | Define the predicate on properties (line-break class AL or HL, explicit single script, next unit not Extend/SpacingMark/ZWJ). The script lane gets its own resync between explicit-script graphemes; restart points are per lane; each window is seeded with the two previous classes                                                                                                                                                        |
| M4  | **C0–C3 as a script list is unsound.** ASCII is not pair-rule (LB25, LB14, LB16/17, LB20a need context); ASCII bases form non-ASCII clusters (keycap, space + U+0301); C1 has Pi/Pf quotes, U+2010, B2 dashes, NFD marks; C2 has kana CJ/NS, IVS, jamo and East_Asian_Width rules                                                                                                                                                            | **Classes are a property closure generated from the UCD.** Proven by exhaustive kernel-versus-scalar on class strings up to length 4 plus pumped strings, and by running the conformance files through the kernel path. Thai stays in C3 explicitly                                                                                                                                                                                          |
| M5  | **Convergence by count is ambiguous under n:m clusters** (a virama insert adds a unit and removes a cluster) and must survive several dirty ranges                                                                                                                                                                                                                                                                                           | Converge on the stable text-unit id of a line's first cluster, only past the last dirty range; recompute line-index state (ellipsis, drop cap, final-line justify, `maxLines`) for the suffix. CJK and Thai do converge at the next required break, and Thai at spaces: "Who benefits" understated this                                                                                                                                      |
| M6  | **Editing support needs four decisions**                                                                                                                                                                                                                                                                                                                                                                                                     | See below                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M7  | Oracle gaps                                                                                                                                                                                                                                                                                                                                                                                                                                  | Dump levels, classes, scripts, `index_at`, `unsafe_before`, correction lanes, island slots, visual order; fixtures by mechanism; add `WordBreakTest` and `SentenceBreakTest`; add a Tamil or Kannada font; pin existing behaviour (space + mark hangs, letter spacing on joined Arabic, text-wide `ltr`)                                                                                                                                     |
| M8  | Reservations for deferred features                                                                                                                                                                                                                                                                                                                                                                                                           | Keep edge records as the general "line owns extra glyphs" mechanism; do not make "correction = advance delta" part of the ink cache key (Nastaliq corrections are not horizontal-only, unsafe chains run a full sentence); a justification-class lane, not a space-only summary; a property bit, not `== 0x20`; name lanes inline/block; key caches on font instance; a sparse per-cluster side table for break candidates and edge advances |

**Editing support design (from M6):**

- **Caret unit:** grapheme boundaries. Interior stops only inside true ligature clusters (Latin, Arabic,
  Hebrew); Indic and South-East Asian conjuncts and emoji sequences move as one.
- **Ligature carets:** the baker keeps GDEF byte-exact, so `LigCaretList` survives; only four fonts in the set
  carry one, so even division by component is the common path. Format 2 is resolved at bake time.
- **Affinity:** `{offset, upstream | downstream}` covers line ends and bidi boundaries. Today's
  `caretForOffset` takes no affinity and cannot express a caret at the end of a soft-wrapped line.
- **Lanes:** one byte boundary lane per unit with word and sentence bits computed lazily; `index_at` is the
  unit-to-cluster hop; the line is found by search at query time. Edits nobody queries pay nothing.
- **IME ranges are not style spans.** A marked boundary inside `fi`, lam-alef or a conjunct is a grapheme
  boundary inside one shaping cluster; as a style span it would hit `StyleSplitsCluster` and either un-form the
  ligature or fail preparation. Marked ranges are anchored by stable unit ids and drawn from selection
  geometry. **This must be verified before the unit is built; a failing prepare would break "preparation
  cannot fail".**
- **Stated limitation:** UAX #29 word boundaries give 16 "words" for a Thai phrase and 8 for a Japanese one;
  the word lane goes through the pluggable break source so dictionaries can replace it later.

### Host, API and preparation review

Report: `review-v5/host-api.md`; experiments in `/Volumes/Depot/Developer/glyph-review-scratch/host/`
(Node, single runs; browser-side points are read from source).

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Refinement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **"Preparation cannot fail" had no out-of-memory or trap policy, and today's recovery can kill the root** (measured with capped wasm memory): at one size the setter throws and the root recovers; larger, the setter traps (`unreachable`) and every later call on the root fails, including an unrelated sibling; larger still, the setter succeeds, publication fails, and the root is permanently dead — even shrinking the text throws, because the old oversized value is replayed first (`render-planner.ts:796`). Panics are bare traps with no poison flag. Removing panic machinery makes this a precondition | `try_reserve` a paragraph's full lane bound before the first write, so refusal is paragraph-local. One gateway for every export that treats a trap as engine-dead, re-instantiates and replays authored state. Apply the incoming value before any replay. Validate a `maxTextUnits` limit at the setter. Add "paragraph reservation refused" to the residue table. Test: sibling still works and the victim can be shrunk or disposed at every cap                                                                                                            |
| H2  | `onLayout` rules were contradictory and incomplete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Stale sentence removed. Rule: read anything; write transforms, visibility, paint; never a layout input. The phase runner contains each callback's exception and finishes the frame (uncontained, react-three-fiber unmounts the whole canvas). `dispose()` never throws for phase reasons. Dependent layout uses the pull form (`b.constraints = { width: a.measure().width }`) or a declared dependency prepared in dependency order, no extra pass. Note: in R3F, `onLayout` + `setState` is one frame late on first paint; imperative mutation is pre-paint |
| H3  | **The failure inventory is far larger than the plan's residue list:** 946 `InvalidRequest` and 365 `ResultTooLarge` sites; any `Err` after the first write invalidates the root (`state.rs:1641-1643`). Missing classes: traps; time-of-check gaps between setter and prepare (handles must be leased until consumed); TypeScript adoption failing after Rust committed; post-commit host steps; counter exhaustion; measurement serialization; user-callback throws. The TypeScript grapheme-boundary check is unsafe (`Intl.Segmenter` follows the browser's ICU, not Rust's Unicode 17)                              | A scripted reachability inventory checked in beside the oracle, each class given a disposition (20-row table in the review). Snap-forward of span boundaries inside Rust prepare so the boundary status cannot occur. A seeded interleaving fuzz (setters, font disposal, reads, frames) asserting no crossing returns non-OK                                                                                                                                                                                                                                  |
| H4  | **The prepare-to-publish window and multi-render frames were unspecified.** A setter from a later sibling during traversal could publish a revision whose `onLayout` never ran. `scene.updateMatrixWorld()` runs per `renderer.render`, including nested shadow and pass renders. In `frameloop="demand"` an imperative setter requests no frame, so nothing prepares. No device-loss handling                                                                                                                                                                                                                          | Invariant: a paragraph is published only at a revision whose layout phase completed (per-paragraph publication hold). Nested traversals sync transforms only. `prepare()` and `shape()` are defined at the engine so every integration shares semantics. In R3F, prepare is a scheduler job before `render`. Providers wire the dirty notification to `invalidate`. Device loss gets a root `onError` and a checkpoint                                                                                                                                         |
| H5  | **Scene membership: idle cost, linear mount and exact first frame pull against each other.** `createText` alone is quadratic (10.8 ms at 100, 786 ms at 1,600); mount crosses twice per label; membership is learned per text per traversal                                                                                                                                                                                                                                                                                                                                                                             | An unconfirmed list resolved by parent walk at prepare, once per re-parenting; a two-instruction epoch stamp in `updateMatrixWorld`; a constructor with zero crossings; one root per portal scene; root baseline (about 1.6 MB of wasm memory per root) on the memory axis                                                                                                                                                                                                                                                                                     |
| H6  | **Benchmarks will fake a win after unit 3 unless split.** Interleaved set-then-measure costs one crossing per label today and will after                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Split every setter-ending row into three timed spans (setter; setter + read; setter + frame) with asserted crossing budgets. One decaying "measurement interest" per text in a per-root column. A dev warning when on-demand prepares per frame pass a threshold. Zero batch work for paragraphs a read already prepared                                                                                                                                                                                                                                       |
| H7  | Error model as authors meet it: a setter throw with no inner boundary removes the whole canvas; a lone surrogate throws though it is ordinary data; Vue behaves differently from React                                                                                                                                                                                                                                                                                                                                                                                                                                  | Ship an in-canvas error boundary; replace lone surrogates with U+FFFD and count them; stable error code and property path; Vue `error` event; define `text.error`, `group.error`, `commitState()` under the new model                                                                                                                                                                                                                                                                                                                                          |
| H8  | TypeGPU-direct has no scene, resolves anchors eagerly and has no decorations (needed for IME underlines)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Engine-level two-step gives all four integrations one semantics; one conformance suite run against all four                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| H9  | Editing queries: today each caret or selection query copies a full placements snapshot after an edit; `GlyphCaret.leading` conflates bidi side with line-end affinity                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `TextPosition { offset, affinity }` with `caret`, `hitTest`, `move` (with `goalX` and unit), `boundary`, `rangeRects`; one crossing and a fixed-size answer each. Derived lanes built lazily; maintained through edits by an explicit editing session (`text.edit()`), not sticky first use. `session.replace(start, end, insert)` is also the minimal mutation of R1, and IME ranges need it (a diff cannot place "a" inserted into "aaa")                                                                                                                    |
| H10 | Migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Six steps: conformance and crossing tests; additive `prepare()`; setter flip with split benchmarks; two-step Three; `onLayout`; failure work in parallel. Read-after-write programs do not change behaviour                                                                                                                                                                                                                                                                                                                                                    |

**Owner decision needed (H9):** offset-taking edit helpers were removed on purpose earlier
(`three-api.md:258-261`); an editing session with `replace(start, end, insert)` reintroduces one, scoped to
the session. Default taken for the night: design it, do not ship it in the public API until approved.

### Rendering, size and memory review

Report: `review-v5/gpu-size-memory.md`; experiments in `/Volumes/Depot/Developer/glyph-review-scratch/gpu/`
(material variants of main injected through `defineTextMaterial`; Chrome 157 headless, WebGPU, loaded machine).

**G1. The steady-frame gap is the always-on effect path — not two draws, four channels or untrimmed quads.**
This overturns the plan's earlier reading of the competitor result.

| Variant (ms per frame at 4× fill) | Paragraph | 200 labels |
| --------------------------------- | --------- | ---------- |
| ultra-text                        | 0.183     | 0.188      |
| glyph main, default               | 0.234     | 0.257      |
| default, single pass (one draw)   | 0.233     | 0.254      |
| **one MSDF sample, fill only**    | **0.150** | **0.151**  |
| alpha channel only                | 0.145     | 0.145      |
| same quads, flat colour           | 0.127     | 0.128      |
| one 2×2 px quad (the real floor)  | 0.127     | 0.127      |

`msdf-shader.ts:70-98` always takes two samples and composites outline and shadow. Without that, glyph is ahead
of the competitor with no trimming and no single-channel atlas. The second draw costs nothing on the GPU (one
pass is fully culled); channel count is worth 0.005 ms and quad area at most 0.023.

| #   | Finding                                                                                                                                                                                                                                     | Refinement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Above                                                                                                                                                                                                                                       | **Effect-specialized program variants** (none, outline, shadow, both) keyed from the style; compare against a per-instance branch at 0%, 10% and 100% shadowed glyphs. Quad trimming stays but comes after. The harness floor is the one-quad frame                                                                                                                                                                                                                                                                                             |
| G2  | glyph's quads are back-facing; `FrontSide` renders nothing (y negated without reversing winding, `msdf-shader.ts:101-105`)                                                                                                                  | Reverse the winding in the same commit as single pass; a `FrontSide` conformance test                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| G3  | **Every power-of-two capacity crossing costs about 5 ms** and creates 2 shader modules, 2 pipelines and 15 buffers: the material cache key includes buffer identity, and a resize rewrites everything                                       | Material identity independent of buffer identity; a resize is allocate + `PATCH_COPY` from the old generation + changed writes (the one case where `PATCH_COPY` saves upload bytes). Also what makes early pipeline compile possible                                                                                                                                                                                                                                                                                                            |
| G4  | **A per-font glyph table unifies paging, publication, memory and WebGL2.** MSDF instances are 100 B with duplicated UV data, Slug repeats 64 of 120 B; a two-character tail edit uploads the whole instance set (98 kB at 1,205 characters) | Instances carry a glyph slot (about 36–40 B); moving an atlas cell is a table-row write. This is not the order indirection retired earlier                                                                                                                                                                                                                                                                                                                                                                                                      |
| G5  | On-demand atlas paging had a decision but no mechanism                                                                                                                                                                                      | The engine owns a shelf allocator and emits atlas-copy records in the same plan as the instances, so the first frame with a new glyph is correct in one crossing. Baked pages stay on the CPU as views (source of truth for growth, WebGL2, device loss). 512² layers, doubling with a GPU-side copy; a prewarm call. Judged by the never-drawn-letter maximum, not median                                                                                                                                                                      |
| G6  | Publication corrections                                                                                                                                                                                                                     | Multi-range upload is a host-only fix (Rust already emits up to 8 ranges; Three folds them into one envelope). `PATCH_COPY` within one buffer saves gather and wire bytes but not upload. Per-paragraph slack (zero-area records) stops a count change from shifting every later paragraph                                                                                                                                                                                                                                                      |
| G7  | The WebGL2 capability set is one static object; any change re-uploads a whole texture per lane                                                                                                                                              | Choose the set once the backend is known; the glyph table makes most lanes static                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G8  | First frame, GPU side: glyph default 13.6 ms first render against a 5.7 ms one-quad floor and 9.5 for the competitor; single pass without the effect graph reaches 9.3–10.3                                                                 | Follows from G1–G3. "Streaming wasm compile" is already implemented and comes off the work list. No code uses `compileAsync`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G9  | **Slug's steady frame (0.755 ms at 4×) is the largest GPU cost and had no row**                                                                                                                                                             | New row: per-glyph band counts, contiguous per-band curves, early exit, trimming (where trimming pays)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| G10 | Single channel matters for memory, not frame time                                                                                                                                                                                           | Upload the MTSDF alpha channel as R8 with no new bake: 0.34 MiB for ASCII against 1.34                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| G11 | Download: 0.43–0.47 MB is reachable (estimate)                                                                                                                                                                                              | `opt-level=2` (−14 kB, speed within noise); one insertion sort in the HarfRust fork (48 of 85 kB of sorts); three-stage tries (bidi class 12 kB against 32); validation moved to the setter removes most of `validate_planner_inputs`; Binaryen `-O3` instead of `-Oz` twice; technique code split out of the 135 kB Three entry. **A correctness-preserving labels tier** (build-time shaped strings, or the rule-free proof driving a JavaScript-only placer, falling back to the full module) is the only route to competitor-class download |
| G12 | CPU memory policy                                                                                                                                                                                                                           | No fixed reservation (under 1 MB before text; today two 32,768-record reservations); cluster lanes at most 120 B from 240; one pending copy per root with a halo window (about 780 B per glyph from 1,139–1,355); 1.5× growth with a minimum allocator claim so regions merge                                                                                                                                                                                                                                                                   |
| G13 | GPU memory                                                                                                                                                                                                                                  | Slug padding 3.02 → 1.74 MiB independent of paging; Slug references as baked `r16`; smaller instances from the glyph table                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G14 | TypeGPU direct: one draw and one bind group per text; batches rejected                                                                                                                                                                      | Reuse the indexed-transform path to merge spans                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Engine and SIMD review

Report: `review-v5/engine-simd.md`; kernel and allocator models in
`/Volumes/Depot/Developer/glyph-review-scratch/engine/` (models, not engine code).

Measured (25,900 glyphs, M4, min of 25):

| Kernel                                                | native       | wasm simd128 | wasm scalar |
| ----------------------------------------------------- | ------------ | ------------ | ----------- |
| Ink per glyph, `f64::min/max`                         | 29.0 µs      | 77.7         | 68.3        |
| Ink per glyph, compare-select (bit-equal)             | 29.4         | 23.9         | 23.8        |
| Ink per segment, exact                                | 15.4         | 20.0         | 20.1        |
| Translation-only repass, serial f64 pen (bit-exact)   | 13.3         | 13.7         | 14.3        |
| Font-size rescale from a kept integer prefix          | 3.3          | 8.4          | 6.5         |
| Fit per line: word walk / prefix window               | 31 / 13.5 ns | 41 / 18.1    | 41 / 9.4    |
| Gather, row-major compare-then-write (model of today) | 653 µs       | 638          | 650         |
| **Gather, column-major write-only, 14 fields**        | **70**       | **82**       | **93**      |
| Lane compare, new against accepted columns            | 26           | 28           | 82          |

| #   | Finding                                                                                                                                                                                                                                                                                                                                                            | Refinement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | **Gather's cost is its row-major interpreted shape, not only the diff.** `row_at` builds a ~150-byte row per glyph and passes it by value to every field read; the compare dispatches per field per glyph; the walk is a rope callback per row. The fresh path shares `row_at`. Engine: 145 ns per glyph in wasm against main's 52; column-major model: about 4 ns | **Column gather:** classify each program input once into a source kernel (placed add per segment, lane copy, fill per style range, table gather by glyph id, fill per run). Write-only by change class (metric, rewrite, first publish → all columns; colour → colour column; width → origin columns of recomposed lines). Where a narrow upload matters, XOR-fold new against accepted per 64 rows into dirty chunks. Count changes by prefix/suffix `copy_within`. About 0.11 ms at 25.9k against 3.76 today                                                                                                                                                                                                                             |
| E2  | **Positioning: split content-only topology from the numeric pass.** The per-cluster cost is span construction and a 14-field merge test, not the pen add. Gap justification and odd direction force one segment per cluster (Amiri 727 µs against Inter 337 at 15k)                                                                                                | Segment cuts become a content lane; a numeric-only repass runs when a line's break is unchanged (exact pen chain plus translations: 14–15 µs in wasm; 34 with exact ink). RTL as multi-cluster visual-order segments. Space-justified and RTL lines then stay near the LTR ratio; only gap justification and edge-record lines stay at 1–1.5×. **Most of the integer-pen unlock is available bit-exactly this way.** Per-line ink must carry a missing-glyph count, island, ellipsis and drop-cap glyphs, per-fragment origins under exclusions, and a signed-zero rule                                                                                                                                                                    |
| E3  | Local edits: 37 is a correct distance bound for what it covers, but a correction also depends on break flags, owner lanes, run language and features, the paragraph-end bit, spacing, size, `advance_units` and `ltr`. Whole-line, cut and clipped edge shapes are never cached                                                                                    | Dirty range = text edit ∪ lane diff from 1c ∪ Unicode resync window ∪ old and new style-boundary positions (agrees with M1). Drop the cache when `ltr` or run-level inputs change. Store corrections as font-unit facts; key the uncached shapes. Count-changing convergence also needs `trailing_empty` to match, delta-mapped old-side lookups, and a block-translation-invariant suffix when the line count changes (one region, no exclusion or drop-cap cut below, no clamp)                                                                                                                                                                                                                                                          |
| E4  | Metric changes: run-local rebuild calls an `extents_for` closure per glyph, 58 ns per glyph in wasm for arithmetic that measures 0.6                                                                                                                                                                                                                               | Keep i16 font-unit ink lanes in cluster order so a size change never touches the font registry; rerun the dense kernel from font units ("linear in scale" holds for the formula, not for stored f32 rows). Line height is its own class: skip advances and run-local, reuse breaks in one unobstructed region                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E5  | Cluster build: two struct assemblies per cluster in the run compare; a hash index over all previous clusters per build; a binary search per glyph on non-identity scatter                                                                                                                                                                                          | Lane compares are delta-shifted (compare lengths, not absolute starts), folded per 64-cluster chunk with a scalar walk on a miss; the hash index stays as the fallback for multi-range edits (replace-all, style moves, IME). **The dirty range is an explicit output of 1c**                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E6  | **Memory growth comes from exact reservations, not unmergeable regions** (allocator model: flat once capacity is n + n/8; 34 `try_reserve_exact` sites). This corrects the inference in the size profile                                                                                                                                                           | One size-class capacity policy per paragraph; grow-and-extend; pre-grow outside prepare (`memory.grow` detaches cached views). Lane diet for the 240 B cluster lanes: `break_corrections` is 48 B per cluster for a sparse cache; `units_per_em` and four handle lanes are per-run constants (24 B); `advances` and `advance_units` duplicate one quantity. About 120 B is realistic                                                                                                                                                                                                                                                                                                                                                       |
| E7  | SIMD experiments table                                                                                                                                                                                                                                                                                                                                             | **Fit as a tree search is unsound with corrections** (the predicate is not monotone); use a bounded linear mask scan on i32 block-relative prefixes, and stage-clock the fit first (search is at most a seventh of fit time). Unicode stage one: simd128 has no gather, so swizzle nibble tables under 0x80; stronger: one u64 bitmap per class with rules as shifted boolean algebra and carry propagation for space runs, residue only for blocks with Extend/ZWJ. Affine placement's CPU prize is about 14 µs; measure upload bytes instead. Rows added: topology/numeric split, exact segment ink, font-unit ink and correction lanes, branch-free justification, per-line flattening, struct packing and range lanes, capacity policy |
| E8  | Wasm specifics                                                                                                                                                                                                                                                                                                                                                     | `f64::min/max` costs 3.3×; use `pmin/pmax` or compare-select. f64 and i64 lanes gain nothing from simd128 and sometimes lose; keep scalar twins. Run the wasm probe on the shipped artifact after Binaryen (call boundaries are the risk, not kernels). Kernel rules name `AlignedField` indexing and per-element `.get().ok_or()?`                                                                                                                                                                                                                                                                                                                                                                                                        |
| E9  | Build order                                                                                                                                                                                                                                                                                                                                                        | Gather becomes **unit 1e** (it reads the lanes 1a and 1b rewrite). 1a has more readers than three: gather, measurement and borrows, the inline `CompactSink`, the boundary path. 1b and 1c both edit `state.rs`: sequence them or split first. Oracle dumps are keyed semantic lanes, not struct bytes. Per-element `work_attribution` hooks get a per-call replacement. Each unit deletes what it replaces and records wasm size                                                                                                                                                                                                                                                                                                          |

**Integer pen, re-scoped by measurement:** it is not faster cold (16.8 against 15.4 µs in wasm) and changed 0 of
25,900 f32 rows in the model; f64 outputs do change. The owner question is therefore about f64 outputs, and the
topology/numeric split delivers most of the benefit with no bit change. It stays a tested experiment.

**Ordering by size of prize (engine):** column gather (about 3.6 ms on a 22k publication), then the
topology/numeric split, then cluster-build lane compares; per-segment ink, the ink cache and the pyramid each
add at most 4–20 µs and come after.

### Execution rules for parallel lanes

- One writer per file. `state.rs` (22k lines) is written only by the integrator: lanes add new `impl` files
  and hand over call-site swaps and deletions as small commits.
- One ABI change in flight at a time: readback → unit 3 → unit 4 → editing support.
- Merges are serialized, with the oracle run on the rebased tree. A `sil-green-<n>` tag marks every green
  merge, and the wasm gzip size is recorded at each tag. The morning state is the last green tag.
- Each handback names the old functions it deleted and any it left, so half-migrated paths are visible.
- Before unit 3 changes what setter-only benchmarks mean: freeze the harness and fixtures by hash, add
  complete-operation twins of setter-only rows, and assert a layout digest in each benchmark.
- One timing run at a time on the machine.
- Engine lanes by file: gather (`codec_gather.rs`, `ordered_plan.rs`); geometry (1a, later metric rescale);
  Unicode (1d, resync, word and sentence lanes); positioning (1b, shortcut, line ink, carets); cluster (1c,
  cache retention, offset map); flow (convergence, fit-only query, island batching).
- Merge order: oracle → gather, 1a, 1d → 1b, 1c → minimal mutation → unit 2 → metric rescale → snapshot →
  unit 3 → snapshot → unit 4 → many-label and paint-only → editing support and experiments → size and memory
  → final comparison.

## Build order

| #   | Unit                                                                                                     | Size | Parallel                           |
| --- | -------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------- |
| 0   | Oracle: frozen lane dump, fixture matrix, random-edit driver, wasm probe                                 | M    | First, alone                       |
| 1a  | SoA run-local rows; one geometry kernel for all three clients                                            | L    | After 0                            |
| 1b  | Positioning rewritten in place; line ink; content-compared shortcut                                      | L    | With 1c, 1d after 1a               |
| 1c  | Cluster build loops; lane-compare ids; fold run comparison                                               | XL   | With 1b                            |
| 1d  | Unicode tables C0–C1, then C2                                                                            | M    | Any time                           |
| 2   | Cache retention, convergent reflow, Unicode resync, per-line ink cache                                   | L    | After 1b, 1c                       |
| 3   | Preparation model, error model, callbacks, Three two-step publication                                    | XL   | Any time; one owner for `state.rs` |
| 4   | Host and publication                                                                                     | L    | After 3                            |
| 5   | Idle frame, mount, transforms: dirty lists, linear mount, no per-frame work                              | L    | With 3                             |
| 6   | Many-label updates and paint-only changes                                                                | L    | After 3                            |
| 7   | Inspection and readback; font-size rescale                                                               | M    | Any time after 1                   |
| 8   | Draw count, single-pass double-sided, ink-trimmed quads                                                  | M    | Independent                        |
| 9   | First frame: pipeline compile, wasm and atlas loading                                                    | M    | Independent                        |
| 10  | Size and memory                                                                                          | M    | After old paths are deleted        |
| E   | Editing support: offset map, word and sentence boundaries, carets, affinity, ligature carets, IME ranges | L    | After 1d and 2                     |
| G   | Gate: measure in wasm and Chrome; build block cuts and windowing only if needed                          | —    | After 2                            |
| 11  | Interleaved comparison against main, and against the competitor's published set                          | S    | Last                               |

This order is provisional until the profiles listed under "Every axis" are taken; units 5–10 are not designed
yet.

The competitor's comparison scenes are not in its public repository (no benchmark files in the tree; its README
says the harness is kept with the development sources). The same author publishes a general WebGPU/WebGL
profiler, `gpu-perf-agent` (github.com/Makio64/gpu-perf-agent, npm 2.5.0), with before/after comparison scripts;
whether the published numbers were taken with it is not confirmed. For the final comparison, either ask the
author for the scenes or rebuild the eight published measures from their documented setup: Noto Sans Regular, a Latin paragraph of 1,000 glyphs and 200 labels,
3200×2400 target, medians of 10 cold loads, 30 edits, 32 width changes and 8 steady rounds.

## Likeliest ways this fails

1. The general-case kernels keep much less than the plain-case ratios, especially positioning for justified and
   bidi text.
2. Unit 3 touches every benchmark's timing and the Three integration at once; a mistake there can hide or fake
   wins.
3. The dense rewrite inside very large files stalls with old and new paths coexisting.

## State of the work

As of 2026-11-21. Nothing is implemented; implementation waits for the owner's word after a whole-plan review.

- **Branch:** `experiments/segment-indexed-layout` in the worktree `/Volumes/Depot/Developer/glyph-held-rope-wip`,
  on top of `8176a24e0a3f` (tip of `experiments/held-rope-ascii-anchor-wip`, itself on draft PRs #292 → #301 →
  #302 → #310). Uncommitted: this file and the branch rules at the top of `AGENTS.md`. Nothing pushed.
- **Spike worktrees** (detached at `8176a24e0a3f`, uncommitted, throwaway):
  `/Volumes/Depot/Developer/glyph-floor-exp` (stage splits, segment walk),
  `/Volumes/Depot/Developer/glyph-chunk-spike` (chunked shaping equality),
  `/Volumes/Depot/Developer/glyph-throughput-spike` (dense kernels; also runs under wasm in Node).
- **Snapshots:** a single full-suite run each of `v0.1.0`, main `4e25a96a` and the branch start is being written
  to `/Volumes/Depot/Developer/glyph-baselines-2026-11-21/`; main is built in
  `/Volumes/Depot/Developer/glyph-baseline-main`. Loose reference only.
- **Not yet done:** the seven profiles under "Every axis"; fetching the adversarial fonts; installing `fallow`
  and `kimun`; designs for the axes beyond editing and reflow; the whole-plan review; deleting stale guidance.
- **Waiting on the owner:** whether to use the competitor author's `gpu-perf-agent` profiler; whether to ask
  the author for the comparison scenes; the adversarial font list; `rand` default, legacy `kern`, callback
  re-entrancy.

### Night run, started 2026-11-21

The owner gave the word to build unattended, feature by feature. Commits are local; nothing is pushed.

| Lane                   | Worktree and branch                                                              | Scope                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Oracle (unit 0)        | `glyph-held-rope-wip`, `experiments/segment-indexed-layout` (integration branch) | Frozen stage dumps, fixture matrix, seeded differential driver, wasm probe                                           |
| HarfRust fork and size | `glyph-wt-harfrust`, `experiments/sil-harfrust`                                  | Vendored fork with `aat`/`rand` features, `kern` kept; panic removal; lazy outline decoder                           |
| Renderer               | `glyph-wt-render`, `experiments/sil-render`                                      | One draw; ink-trimmed quads; on-demand atlas paging; Slug padding; TypeGPU batching                                  |
| Host                   | `glyph-wt-host`, `experiments/sil-host`                                          | Idle frame, linear mount, first-frame JavaScript, first set, ingress, readback                                       |
| Review                 | read-only, reports in `glyph-baselines-2026-11-21/review-v5/`                    | Five reviewers: engine and SIMD, host and API, multilingual and editing, GPU/size/memory, completeness and execution |

Waiting for the oracle before starting: engine units 1a–1d, the gather rewrite, local edits, metric-change
rescale, the preparation and error model, many-label work, editing support, the SIMD experiments. Lanes merge
into the integration branch once the oracle is committed there, each gated on the oracle staying green.

Defaults taken where the owner's answer was unclear, each kept as separable commits: the preparation-model API
change proceeds (it is the owner's own design); sub-ulp output experiments are measured and recorded but the
bit-identical path stays the default until approved; no stale guidance is deleted.

## Change log

- 2026-11-20: v1 (segment index) and v2 (content-addressed chunks) reviewed and rejected; v3 written from four
  native spikes; preparation and error model, scope decisions and typographic gaps added; fallibility audit folded
  in.
- 2026-11-21: v4 after six reviews of v3. Added wasm measurements (gains hold at 4–5×), oracle as unit 0, Unicode
  class C1 in the first kernel, the Three two-step publication and paragraph-local reads. Dropped parametric
  placement; deferred the validity interval; gated block cuts and windowing behind a measurement.
- 2026-11-21: v4 had narrowed to editing and reflow. Restored every other axis as planned work ("Every axis"),
  with the profiles each needs. Formal pass/fail protocol removed. Implementation is on hold until those axes
  are profiled and designed.
- 2026-11-21: added the remaining axes (copy and split, rich text, interleaved updates, correction-heavy text,
  alignment, non-Latin, ingress, backends, font registration), the adversarial font set, and "SIMD experiments":
  every deferred idea is tested and adopted when faster or equal.
