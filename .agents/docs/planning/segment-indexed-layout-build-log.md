---
type: Log
title: 'Layout refactor build log'
description: 'Append-only record of decisions and the state of each feature in the layout refactor.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-21T12:00:00Z'
---

# Layout refactor: build log

Running record for the owner's review. Appended to as work proceeds; entries are never rewritten, only
superseded by a later entry. The plan is [segment-indexed-layout.md](segment-indexed-layout.md).

Status words: **building** (an agent is on it), **built** (committed on its lane branch), **tested** (oracle
and tests green, numbers taken), **merged** (on the integration branch), **held** (waiting, with the reason),
**dropped** / **deferred** (owner decision).

Integration branch: `experiments/segment-indexed-layout` in `/Volumes/Depot/Developer/glyph-held-rope-wip`.
Commits are local; nothing is pushed until the feature is done.

## Feature state

Updated in place; the history of each change is in the log below.

| Feature                                                                                                                                                                                                                       | State    | Where                                               | Notes                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Plan, branch rules, feature-scope decision                                                                                                                                                                                    | merged   | `771ef41de`                                         |                                                                                                    |
| Snapshots: `v0.1.0`, main, branch start                                                                                                                                                                                       | tested   | `glyph-baselines-2026-11-21/`                       | Loose reference                                                                                    |
| Adversarial font set                                                                                                                                                                                                          | tested   | `/Volumes/Depot/Developer/glyph-adversarial-fonts/` | Not in the repo (large)                                                                            |
| Competitor's eight measures, same machine                                                                                                                                                                                     | tested   | `/Volumes/Depot/Developer/glyph-competitor-bench/`  | Reconstructed scenes                                                                               |
| Profile: size and memory                                                                                                                                                                                                      | tested   | `profiles/7-size-and-memory.md`                     |                                                                                                    |
| Profile: font-size and inspection                                                                                                                                                                                             | tested   | `profiles/5-6-fontsize-and-inspection.md`           |                                                                                                    |
| Profile: browser first frame and idle                                                                                                                                                                                         | tested   | `profiles/1-2-browser-first-frame-idle.md`          |                                                                                                    |
| Profile: colour-only and many-label                                                                                                                                                                                           | tested   | `profiles/3-4-colour-and-many-label.md`             |                                                                                                    |
| Unit 0: correctness oracle                                                                                                                                                                                                    | merged   | `758b0a54b`, tag `sil-green-0`                      | 423 cases; native and wasm agree; found existing engine divergences                                |
| HarfRust fork (AAT and `rand` off, `kern` kept), panic removal                                                                                                                                                                | merged   | `d012c2f4e`, tag `sil-green-1`                      | Shaper wasm 630.7 → 567.2 kB gzip; oracle quick tier green after merge                             |
| Lazy outline decoder (−22.7 kB gzip)                                                                                                                                                                                          | held     | —                                                   | Needs an ABI change; goes with the one-ABI-change-at-a-time sequence                               |
| Renderer parts 1–2 (Three, MSDF): one draw, effect-specialized shaders, ink-trimmed quads, glyph table, on-demand atlas, growth without new pipelines, atlas pages as views, per-range uploads, optional single-channel atlas | merged   | tag `sil-green-4`                                   | Steady frame 0.234 → 0.142 ms (competitor 0.183); GPU memory 1.44 → 0.56 MiB (0.18 single-channel) |
| Slug per-font glyph table; benchmark MSDF oracle fix; full repository check passing                                                                                                                                           | merged   | tag `sil-green-9`                                   | Instances 112 → 40 B; upload per edit 84.5 → 27.6 kB; steady frame unchanged                       |
| Slug batching on the pure TypeGPU path                                                                                                                                                                                        | merged   | tag `sil-green-13`                                  |                                                                                                    |
| Slug fragment cost with band curves resident on demand                                                                                                                                                                        | merged   | tag `sil-green-13`                                  | Steady frame −27%; GPU memory with a full bake 5.80 → 0.94 MiB                                     |
| Slug on direct TypeGPU matching Three with no pixel budget (ship gate)                                                                                                                                                        | merged   | tag `sil-green-16`                                  | 0 pixels over tolerance on every Slug scene                                                        |
| Pure TypeGPU path, units 1–2: effect-specialized shaders, ink-trimmed quads                                                                                                                                                   | merged   | tag `sil-green-6`                                   | Plain-text GPU pass −19%; pixel-identical to Three within 2/255                                    |
| Pure TypeGPU batching (indexed transforms) and growth fix                                                                                                                                                                     | merged   | tag `sil-green-10`                                  | 1,000 labels: 1,000 → 1 draw, CPU 0.628 → 0.004 ms per frame                                       |
| Pure TypeGPU: one program per effect variant across fonts, on-demand atlas, single-channel mode                                                                                                                               | merged   | tag `sil-green-12`                                  | Atlas memory with a full-font bake 41.9 MB → 0.26 MB                                               |
| Atlas prewarm API                                                                                                                                                                                                             | held     | —                                                   | Needs a handle-level entry point owned by the preparation lane                                     |
| Host part 1: idle frame, linear mount in JavaScript, per-publication work, ingress, readback                                                                                                                                  | merged   | tag `sil-green-2`                                   | Idle 1,000 labels 0.196 → 0.042 ms; setter 3 → 1 crossings; `glyphs()` 812 → 3 crossings           |
| First-frame JavaScript: engine warm-up, font digest, font binding compile                                                                                                                                                     | held     | —                                                   | Each needs a decision or a renderer-free path; see log                                             |
| Whole-plan review (five reviewers)                                                                                                                                                                                            | building | `glyph-baselines-2026-11-21/review-v5/`             | Refines the plan; cuts nothing                                                                     |
| Unit 1a: dense run-local geometry (lanes, one kernel for all three clients)                                                                                                                                                   | merged   | tag `sil-green-8`                                   | Stage 56 → 20 ns per glyph in wasm; short labels 12% slower; wasm +9.9 kB gzip                     |
| Metric-change rescale, line-height class, labels handing lanes to the kernel, gather reading lanes                                                                                                                            | merged   | tag `sil-green-12`                                  | Font-size publication 6.19 ms against main 8.08; line height still behind main (6.71 against 5.63) |
| Unit 1b: positioning topology/numeric split, per-line ink                                                                                                                                                                     | merged   | tag `sil-green-15`                                  | Measurement stage about 630 → 35 µs at 22k; same-break width change a third to a sixth             |
| Positioning follow-ups: numeric repass for edge-record lines, whole-flow shortcut with edge records, deleting the staged run-local writer                                                                                     | held     | —                                                   | After the ship gate                                                                                |
| Existing-engine divergence fixes (all seven families)                                                                                                                                                                         | merged   | tag `sil-green-5`                                   | `KNOWN-DIVERGENCES` is empty; 43,680 seeded requests all equal cold                                |
| Unit 1c: dense cluster build with change-range output                                                                                                                                                                         | merged   | tag `sil-green-14`                                  | Mid-insert at 22k Inter 6.65 → 4.31 ms                                                             |
| Unit 1d part 1: Unicode property closure, dense line-break/grapheme/script kernel, per-paragraph bidi                                                                                                                         | merged   | tag `sil-green-7`                                   | Unicode stage 18–25× faster for Latin, Cyrillic, Arabic; 5.8× CJK; no gain for Indic or Thai       |
| Unit 1d part 2: UAX #14 opening-quote fix, single bidi classification, script set ids, resync predicates                                                                                                                      | merged   | tag `sil-green-11`                                  | CJK Unicode stage 261 → 199 µs at 22k; bidi on RTL text within 1–5% of the original                |
| Unit 1d part 3: word and sentence boundary lanes (unwired), three-stage Unicode tries                                                                                                                                         | merged   | tag `sil-green-14`                                  | Tables 141.6 → 80.7 kB; wasm −5.1 kB gzip                                                          |
| Font binding compiled at font load                                                                                                                                                                                            | merged   | tag `sil-green-7`                                   | First `createText` 16.2 → 12.7 ms with a full font                                                 |
| Unit 1e part 1: column gather for prepared owners                                                                                                                                                                             | merged   | tag `sil-green-3`                                   | Gather 3.40 → 0.98 ms on a 25.9k font-size publication (main 1.20)                                 |
| Unit 1e part 2: gather by change class (colour-only columns, origin-only columns, line height)                                                                                                                                | held     | —                                                   | Needs an accumulated per-paragraph change class in `state.rs`; scheduled after unit 3              |
| Unit 2: local edits                                                                                                                                                                                                           | held     | —                                                   | Needs 1b, 1c                                                                                       |
| Metric changes: keep island shapes, dense rescale                                                                                                                                                                             | held     | —                                                   | Needs 1a                                                                                           |
| Unit 3 stages 0–2: guards, batch `prepare()`, the setter flip, paint-only path, minimal mutation, change class                                                                                                                | merged   | tag `sil-green-13`                                  | 200-label mount 401 → 2 engine calls; setters make none                                            |
| Unit 3 stage 4 (ship gate): paragraph-local failure, trap recovery, `maxTextUnits`, failed-frame retry; linear engine mount; per-paragraph measurement interest                                                               | merged   | tag `sil-green-17`                                  | No memory cap leaves a root dead; 4,000-label frame 3.4 s → 109 ms                                 |
| Unit 3 stages 5–6 (ship gate): publication hold, nested renders, on-demand loops, `onLayout`, root `onError`, error boundary; remove `replacedSurrogates`; API docs and migration note                                        | building | `experiments/sil-prepare`                           |                                                                                                    |
| Unit 3 leftovers: publication failures still discard the root; failure inventory; interleaving fuzz                                                                                                                           | held     | —                                                   | After stages 5–6                                                                                   |
| Unit 4: publication (retained topology, `PATCH_COPY`, multi-range uploads)                                                                                                                                                    | held     | —                                                   | After unit 3                                                                                       |
| Many-label updates and paint-only changes                                                                                                                                                                                     | held     | —                                                   | Needs its profile and unit 3                                                                       |
| Editing support (ship gate): offset map, carets, affinity, ligature carets, IME ranges, edit session                                                                                                                          | held     | —                                                   | Waits on the owner's API review and the positioning merge                                          |
| SIMD experiments (fourteen)                                                                                                                                                                                                   | held     | —                                                   | Each needs the oracle; adopted if faster or equal                                                  |
| Sub-ulp output changes (integer pen, affine placement)                                                                                                                                                                        | held     | —                                                   | Awaiting owner approval; measured only                                                             |
| Final interleaved comparison against main and the competitor set                                                                                                                                                              | held     | —                                                   | Last                                                                                               |
| Typography other than editing support                                                                                                                                                                                         | deferred | decision record                                     |                                                                                                    |
| `rand`, Apple AAT                                                                                                                                                                                                             | dropped  | decision record                                     |                                                                                                    |

## Log

### 2026-11-20

- **Decision (owner).** Large units; benchmarks are spikes; no per-edit ceremony; the branch passes or fails as
  a whole; stale guidance may be deleted.
- **Decision (owner).** Requirements: typographically correct multilingual layout; mid-paragraph editing; SIMD
  and data-oriented design; HarfRust stays; OpenType only; variable fonts reserved.
- **Decision (owner).** Preparation: never stale, deferred, per-text `onLayout` property; failures throw at the
  setter; preparation cannot fail; no rollback copy.

### 2026-11-21

- **Decision (owner).** No formal pass/fail protocol. Snapshots are loose reference; later benchmarks are
  interleaved against main. Implementers run `fallow` and `kimun`. Realistic worst case is about 2,500 words.
  No eager per-setter mode. In react-three-fiber bad input goes to the error boundary.
- **Decision (owner).** Every axis is in scope; reviews refine and never cut. SIMD ideas are tested and adopted
  when faster or equal. Profiles include adversarial fonts.
- **Tested.** Snapshot 1 (`v0.1.0` against branch start): 94 faster, 24 slower, 25 neutral. Snapshot 2 (main
  against branch start): branch start behind on first set (3×), unsafe-boundary reflow (2×), measurement after
  width change (2×), publication after text and font-size change (1.3–1.4×); ahead on colour-only publication,
  interleaved edit-read-publish and formatted paragraphs.
- **Tested.** Adversarial fonts fetched and baked. The baker rejects variable fonts and bitmap colour fonts; no
  upstream font has `rand`; legacy `kern` survives into the shaping payload.
- **Decision (owner).** Feature scope: editing support is built in this plan; `rand` and Apple AAT dropped;
  all other missing typography deferred. Recorded in
  `decisions/typographic-feature-scope-for-layout-refactor.md`.
- **Tested.** Competitor's eight measures rebuilt on this machine. glyph is ahead on both edit measures; behind
  on steady frame (GPU side: two draws, four-channel atlas, untrimmed quads), first frame (JavaScript set-up,
  not shaping), width change, GPU memory and download.
- **Tested.** Size and memory profile. Shaper wasm 501 / 541 / 631 kB gzip (`v0.1.0` / main / branch start);
  glyph's own engine is 63% of code. Floor at current speed about 0.5 MB gzip. 8 MB of CPU memory before any
  text; per-glyph memory grows with edits.
- **Tested.** Font-size and inspection profile. **Finding:** the branch's largest regression against main is
  the gather step (3.76 against 1.34 ms on a font-size publication; also colour-only and single-edit
  publication). A font-size change does not reshape the body but drops and reshapes every line-edge island.
  `measure()` after a change is 2–3× main. `glyphs()` crosses into wasm 812 times after a change.
- **Decision (owner).** Start the oracle now. Atlas upload on demand. Nightly Rust accepted for the shipped
  wasm. Speed over size. HarfRust forked inside this repository. `onLayout` re-entrancy throws immediately.
  Commit locally as work proceeds; push when the feature is done.
- **Merged.** `771ef41de`: plan, feature-scope decision, branch rules.
- **Decision (owner).** Run unattended overnight, building or delegating feature by feature. Keep this log.
- **Building.** Oracle; HarfRust fork and size; renderer; host; five-reviewer plan review.
- **Default taken (no clear owner answer; separable commits).** The preparation-model API change proceeds;
  sub-ulp output changes are measured but not made the default; no stale guidance is deleted.
- **Open with the owner.** Is a breaking API release acceptable? Are sub-ulp position changes approved in
  principle? May the stale guidance be deleted?
- **Tested.** Colour-only and many-label profile. **Finding:** on the branch every setter prepares its
  paragraph synchronously in wasm (three crossings); main only records desired state. This is the cause of the
  first-set (3×), overwrite-before-publication and dense-rewrite setter regressions, and it is what the
  preparation model (unit 3) removes. Also found: a full-text replace is sent per keystroke (10 kB) where main
  sends a 375-byte mutation; a colour change runs layout in the setter; kerned fonts (Fredoka) are not admitted
  to the small-label inline path; input validation costs 314 µs per keystroke on a long paragraph. The
  published "+370% typing" figure is an artefact of a bimodal baseline; the real gap to main is +57–72%.
- **Plan refined.** Added: edit-aware minimal mutations; setter restoring the published value costs nothing;
  validation proportional to the edit; inline-path admission for kerned fonts; no per-publication scans of
  untouched labels. Host lane told the first-set cause belongs to unit 3, not to ingress.
- **Tested.** Browser first-frame and idle profile (912 cold loads). **Findings:** the font artifact is about
  45% of the first frame (a JavaScript hash of the whole 39 MB file, three extra atlas copies, and a whole-atlas
  upload); every MTSDF font compiles its own shader because atlas dimensions are WGSL literals; the MSDF
  fragment shader samples the atlas twice even with no shadow; the two draws are the double-sided material and
  one side alone is equivalent for flat text; quads are already glyph-trimmed but 1.64× the ink box; mount is
  quadratic in `#reconcileEntries` and in Rust `prepare_upsert`; the first paragraph is 10–17× slower than the
  second; idle cost is transform sync and `updateMatrixWorld`, not `shape()`.
- **Plan refined.** Added: font loading as its own unit; one pipeline shared across fonts; conditional shadow
  sample; engine warm-up at `init()`; linear mount in Rust as well as JavaScript. Findings sent to the renderer
  and host lanes with file and line targets.
- **All seven profiles are complete.**

- **Review in (1 of 5): completeness and execution.** Thirteen findings accepted as work (R1–R13 in the plan),
  four stale claims corrected, fourteen missing axes added, and execution rules adopted for parallel lanes
  (one writer per file; `state.rs` integrator-only; one ABI change in flight; serialized merges gated on the
  oracle; a `sil-green-<n>` tag and wasm size at each green merge). Most consequential: a keystroke pays
  O(text) in the request and validation, so minimal mutations move ahead of local edits (R1); the gather rule
  is diff-when-sparse, write-only-when-dense, and sparse retained gather is kept (R2); `measure()` must answer
  from a fit-only query to beat main (R3); CPU memory gets its own unit (R5).
- **Decision recorded.** `decisions/deferred-never-stale-preparation.md` supersedes the setter rule of
  `decisions/retained-prepare-publish.md`. This writes down the owner's preparation design of 2026-11-20.
- **Guards added.** Oracle told to compare applied buffers, coalesce several edits before a read, add UAX #29
  conformance files, and never regenerate the frozen reference. Renderer lane told to capture a pixel
  reference from the branch-start build before changing draws or quads.
- **Review in (2 of 5): multilingual correctness and editing.** Two local-edit rules in the plan were wrong as
  worded and are corrected. (M1) A fixed 37-cluster halo around an edit is unsafe: on Inter a one-letter change
  alters glyphs 115 clusters away, and on Nastaliq a whole 45-letter word; cache retention is now bounded by
  the cluster build's measured dirty ranges. (M2) Bidi levels are not zero away from RTL text; bidi is
  classified per bidi paragraph with counts that trigger a rerun. Also: the Unicode resync rule holds for line
  breaks, graphemes, words and sentences (400,000 fuzzed strings) but not for scripts; the fast-path character
  classes become a property closure generated from Unicode data rather than a script list; convergence is by
  stable unit id past the last dirty range.
- **Editing support design recorded** (caret unit, ligature carets, affinity, lazy boundary lanes, IME ranges
  anchored by unit ids rather than style spans). **Held item:** verify what a style split inside a ligature
  cluster does today before building IME ranges.
- **Oracle** given the failing inputs as fixtures and the extra lanes to dump.
- **Review in (3 of 5): host, API and preparation.** Ten findings accepted (H1–H10 in the plan). Most
  consequential: (H1) "preparation cannot fail" had no out-of-memory or trap policy — measured with capped
  memory, a large paragraph can trap the engine and kill the whole root, including unrelated labels, and a
  failed publication leaves a root that cannot even be shrunk; the fix is paragraph-local reservation before
  the first write, a trap gateway that re-instantiates and replays, and a text-size limit at the setter.
  (H3) the failure inventory is far larger than the plan listed; it becomes a scripted inventory with a
  disposition per class. (H4) a paragraph may only be published at a revision whose `onLayout` phase
  completed; nested shadow and pass renders sync transforms only; on-demand rendering must be invalidated by
  setters. (H6) setter-ending benchmark rows are split into setter, setter + read and setter + frame with
  crossing budgets so unit 3 cannot fake a win.
- **Plan corrected.** The stale "re-prepare for a few passes" sentence is removed; `onLayout` writes to layout
  inputs throw, and the phase runner contains callback exceptions so one bad callback cannot unmount a canvas.
- **Default taken, needs the owner.** An editing session with `replace(start, end, insert)` would give minimal
  mutations and correct IME ranges, but offset-taking edit helpers were removed on purpose earlier. It is
  designed but not exposed publicly until approved.
- **Review in (4 of 5): rendering, size and memory.** Fourteen findings accepted (G1–G14). **Finding that
  overturns an earlier reading:** the steady-frame gap to the competitor is the MSDF shader's always-on outline
  and shadow path (two atlas samples per fragment), not two draws, four channels or untrimmed quads. Measured:
  default 0.234 ms per frame, one sample fill-only 0.150, competitor 0.183, floor 0.127. Effect-specialized
  shader variants now lead the renderer lane; quad trimming moves after. Also: each power-of-two capacity
  crossing costs about 5 ms because material identity includes buffer identity; a per-font glyph table (36–40 B
  instances instead of 100–120 B) is the common mechanism for atlas paging, smaller uploads and WebGL2; Slug's
  steady frame (0.755 ms) gets its own row; a correctness-preserving labels tier is the only route to
  competitor-class download size.
- **Renderer lane re-prioritised** with the measured order and file targets.
- **Removed from the work list:** streaming wasm compile (already implemented).
- **Review in (5 of 5): engine and SIMD.** Nine findings accepted (E1–E9), with kernels measured in wasm.
  Most consequential: (E1) gather's cost is its row-by-row interpreted shape — a column-major write-only gather
  measures 82 µs in wasm against about 640 for a model of today's, at 25,900 glyphs; gather becomes unit 1e and
  is the largest single prize. (E2) positioning splits content-only topology from a numeric pass, which gives
  most of the integer pen's benefit with no change in output bits. (E6) the memory growth with edits comes
  from exact reservations, not from allocator regions that cannot merge — this corrects an inference in the
  size profile. (E7) fitting by tree search is unsound when line-edge corrections apply; the experiment
  becomes a bounded linear scan. (E8) `f64::min/max` costs 3.3× in wasm.
- **Integer pen re-scoped.** Not faster cold in wasm and it changed 0 of 25,900 f32 outputs in the model; only
  f64 outputs change. It stays a tested experiment; the owner question is now about f64 outputs.
- **All five reviews are complete and folded into the plan.** Nothing was cut.
- **Building.** Gather lane (unit 1e) started in its own worktree ahead of the oracle merge, proven against
  the existing fresh-gather equality test until the oracle is available.
- **Built and tested: HarfRust fork and size cuts** (`experiments/sil-harfrust`, five commits ending
  `8afd89c0d`). Shaper wasm 630.7 → 567.2 kB gzip (−63.5 kB): fork with AAT and `rand` off −27 kB, panic
  machinery removed −36.5 kB. Shaping proven identical to the crates.io release in one process: 6.76 million
  glyphs over the repo fixtures and 3.86 million over 27 adversarial fonts; legacy `kern` swept over every
  character pair on three kern fonts, with a check that fails if `kern` is silently lost. 622 Rust and 1,147
  Node tests pass. Speed within ±3.1% on a coarse interleaved check. The pristine crate is its own commit, so
  the upstream patch is one `git diff`.
- **Deviation to note.** Panic removal uses the pinned stable compiler with `RUSTC_BOOTSTRAP=1` rather than a
  nightly toolchain, so the shipped wasm is built by the same compiler that runs the tests. The owner accepted
  nightly; this gets the same result. It can be switched to a dated nightly in one script.
- **Machine change to note.** The lane added the `rust-src` component to the installed 1.97.1 toolchain and
  listed it in `rust-toolchain.toml`.
- **Held: lazy outline decoder.** It would save a further 22.7 kB gzip but removes three exports from the
  shaper wasm, which is an ABI break; it is queued with the other ABI changes.
- **Not covered.** No fixture has AAT tables, so the AAT-off path is tested only by its absence. Two clippy
  findings in `ascii_anchor_policy.rs` predate the lane and were left.
- **Built and tested: renderer part 1** (`experiments/sil-render`, five commits ending `91c86f9dc`). Three's
  MSDF path now beats the competitor on steady frame and draw count (same machine, interleaved, medians):
  paragraph at 4× fill 0.234 → 0.142 ms per frame (competitor 0.183); 200 labels 0.257 → 0.150 (0.189); one
  draw instead of two; GPU memory for a paragraph 1.44 → 0.56 MiB (0.49), and 55.5 → 0.6 MiB with a full-font
  bake; 200 labels 1.55 → 0.39 MiB (0.30). WebGL2 improved too (0.433 → 0.170). First frame improved slightly
  (40.5 → 36.4 ms; competitor 30.1). Never-drawn letter level at the median; its maximum was noisy.
  How: one shader graph per effect combination; ink-trimmed quads grown by effect extent (−20% covered pixels
  at 4×); a per-font glyph table replacing 32 of 88 instance bytes, with atlas size as a uniform so all MSDF
  fonts share one program; glyph cells copied into a resident atlas on first use, before the frame that draws
  them.
- **Correctness.** Pixel comparison against the branch-start build over 18 scenes (effects, sizes, rotation,
  perspective, Arabic): no pixel differs by more than 6/255 on WebGPU or 4/255 on WebGL2. The repo's render
  proof passes on both backends and caught two bugs that were fixed. 711 tests pass.
- **Visible differences, intended.** Edge pixels move by up to 6/255; overlapping opposite-facing glyphs in
  one draw blend in instance order; one proof's tolerance was relaxed to one byte on up to three channels.
- **Breaking surface.** `msdfSchema` buffers are now `rect`, `color`, `effectColor`, `effect`; `uvRect`,
  `uvBounds` and `page` are gone.
- **Finding.** `flat` varyings are slow on this GPU (nine of them made the frame slower than the start).
- **Not done in part 1, now building as part 2:** buffer growth still creates new pipelines; Slug steady frame
  unchanged (0.755 ms); the pure TypeGPU path has the glyph table only; TypeGPU direct mode is still one draw
  per text; no R8 memory mode; no atlas prewarm or eviction; the baked atlas is still copied three times at
  load. Multi-range upload folding is left to the integrator because the host lane is editing the same file.
- **Unexplained.** One integration test (`font-binding-wire`) is killed with exit 137 on this machine; cause
  not separated from machine load. Part 2 is asked to establish it.
- **Wire needs handed to the engine lanes:** an effect flag per draw span (so mixed-style batches use the
  fill-only shader for unshadowed glyphs) and engine-owned atlas copy records.
- **Merged: unit 0, the correctness oracle** (`758b0a54b`, tag `sil-green-0`). 423 cases across 11 scripts,
  four alignments, fallback, spans, drop cap, ellipsis, exclusions, labels of 12–256 units, the adversarial
  fonts and 76 mechanism cases from the reviews. A seeded driver issues requests of 1–4 coalesced changes and
  compares every step with a cold layout (43,680 requests in the full tier). It compares what the renderer
  draws after patches are applied. Native and optimized wasm agree on every digest. Quick tier 3.4 s, full
  63 s native and 120 s in wasm. The frozen reference cannot be regenerated without two explicit flags.
- **Finding: the current engine is not always equal to a cold layout.** 75 of 43,680 seeded requests and 4
  scripted cases differ, each reproducible as one request. Largest family (48): adding, removing or restyling
  a span without changing length leaves stale style data, often visible (for example a font-size span on the
  last script run of a mixed-script label is not applied). 18 are valid inputs rejected incrementally but
  accepted cold. Also: lost unsafe-to-break flags at the edge of a reshaped window, 3 stale `measure` results
  after a width change. All are recorded in `KNOWN-DIVERGENCES`, a list that may only shrink.
- **Merged: HarfRust fork and size cuts** (`d012c2f4e`, tag `sil-green-1`); quick oracle tier green on the
  merged tree. Shaper wasm on the integration branch: 567.2 kB gzip.
- **Building: three engine lanes** off `sil-green-1`: geometry (1a and metric rescale), Unicode (1d plus word
  and sentence lanes), cluster (divergence fixes first, then 1c). Gather (1e) and host lanes told to merge the
  integration branch to pick up the oracle.
- **Not in the oracle yet:** inline objects, several paragraphs per root, columns, vertical modes, language
  and feature spans. `WordBreakTest`, `SentenceBreakTest` and a Tamil/Kannada font were not fetched by the
  oracle lane; the Unicode lane is fetching the two test files through the repo's sync script.
- **Merged: host part 1** (tag `sil-green-2`; nine commits; quick oracle tier green after merge; 1,132 JS and
  513 Rust tests pass on the lane). Interleaved medians, loaded machine:
  idle frame at 1,000 labels 0.196 → 0.042 ms in Node (Three's own traversal floor is 0.031); browser idle CPU
  at 200 labels 0.050 → 0.027 ms (competitor 0.010); moving 10 of 1,000 labels 0.204 → 0.046 ms; editing one
  of 1,000 labels and publishing 0.70 → 0.37 ms (main 1.40); mount of 1,000 labels 225 → 190 ms (main 247);
  `measureGlyphs` on a 25.9k paragraph 52 → 27 ms; `readGlyphs` full scan after a width change 6.07 → 2.85 ms
  (main 3.59); `glyphs()` on unchanged labels back to main's level. A setter makes 1 engine call instead of 3;
  the first `glyphs()` after a change makes 3 instead of 812.
- **Not improved by host part 1.** First set is unchanged (0.036 against 0.007 ms on main): it is the eager
  preparation, owned by unit 3. First frame barely moved (paragraph 37.7 → 37.0 ms; 200 labels 60.2 → 57.3).
- **Finding.** About 27 ms of a cold 35 ms paragraph in Node is first-execution cost (lazy wasm compile, JIT,
  first-use initialisation), independent of the font; the same content in a second root costs 4 ms.
- **Held, need a decision or a new path.** (1) An engine warm-up at `init()` needs an embedded font or a
  renderer-free measurement path. (2) The 19 ms font digest is the content identity used to converge font
  sources and validate transfers, so replacing it with a header hash is an identity decision; reading it
  faster gave nothing (compute-bound). (3) Compiling the font binding at font load instead of first use (12 ms)
  spends CPU and memory on fonts that are loaded but never used.
- **Behaviour changes in host part 1.** Tree changes are detected from Three's `added`/`removed` events, so
  code that writes `.parent` directly without dispatching events is not seen. `Text.measure()` no longer
  subscribes the text to bounding-box upkeep (reading `boundingBox` still does). Sticky measurement became
  read-driven rather than removed, because removing it doubled engine calls for set-then-measure. Seven
  existing test assertions were changed because they asserted the behaviour being removed.
- **Incident.** The host lane ran `git stash` on a clean tree and then `git stash pop`, which applied a
  pre-existing stash of the owner's (`stash@{0}`, "wip: msdf rename", from `feat/three-api`) into the lane
  worktree. The pop conflicted, so git kept the stash; all three stashes are still listed and intact. The lane
  reset its worktree. Side effect: conflict preimages were recorded in the shared `.git/rr-cache`.
- **Building: unit 3** (preparation and error model) in `experiments/sil-prepare`, off `sil-green-2`.
- **Merged: unit 1e part 1, column gather** (tag `sil-green-3`). Gather for prepared paragraphs is now
  column-at-a-time. Wasm gather stage, 25.9k glyphs (new / before / main, ms): font size 0.98 / 3.40 / 1.20;
  colour 0.90 / 3.44 / 1.16; 1,000 labels rewritten 0.91 / 1.81 / 0.94; scattered edits in 8,192 spans
  0.70 / 1.59 / 0.94. Whole operation: font-size publication 5.42 / 7.62 / 5.82; colour 2.89 / 5.44 / 3.94;
  1,000 labels rewritten 12.28 / 14.00 / 14.25. The sparse wins are kept (one of 1,000 labels: 0.0013 ms
  against 0.098 on main). Proven by a seeded property test (13 scenarios, 14 change classes) in which the
  retained result, a fresh gather and an independent row-by-row projection must agree bit for bit, and by the
  oracle. Measured first: forcing the non-diff path made every case slower, so the cost was the row
  projection, as the review said.
- **Not reached.** The model's 0.11 ms was not reached (0.98). Three cases where main narrows the work by
  change class stay far behind main at the gather stage: line height 0.93 against 0.07, a first-character edit
  0.88 against 0.09, one span of 8,192 recoloured 0.90 against 0.04. Gather has no change class to act on; it
  needs one accumulated per paragraph in `state.rs`. Held as part 2 until unit 3 lands, since unit 3 changes
  when preparation happens. The plan stage is now the larger part of a publication (1.3 against 0.8 ms).
- **Integrator fixes at this merge.** (1) Full-tier oracle showed two cases differing: both use the synthetic
  `rand` font, and the cause is the intended one — the fork turns `rand` off. Those two cases were re-frozen
  (reference set is now `254b4ddfe69776cc`); three listed divergences on that font no longer occur and were
  removed from the list. (2) The wasm oracle probe failed to build after the fork merge (it lacked the
  rebuilt-standard-library flag the shipped build now uses); fixed. **Lesson applied:** merges are now gated
  on the full tier, not the quick tier.
- **State at `sil-green-3`:** full tier native 423 of 423 cases equal, 0 unlisted divergences; wasm quick
  tier green. Shaper wasm 569.0 kB gzip.
- **Found by the gather lane, outside gather:** a debug assertion in positioning fires when a font-size span
  boundary falls inside a layout run and the span range moves (same family as the listed span divergences);
  the cluster lane owns that family.
- **Merged: renderer part 2** (tag `sil-green-4`; full oracle tier green after merge; pixels against the
  branch-start reference unchanged, largest difference 6/255). Capacity growth now creates 0 shader modules
  and 0 pipelines on WebGPU (growth edit 5.4–6.1 → 2.1–2.5 ms); on WebGL2 materials are still rebuilt because
  Three bakes storage attributes into textures there. Baked atlas pages are views of the loaded file (three
  copies removed); first frame for 200 labels 60.4 → 54.9 ms (competitor 33.2). A rendered front-face test was
  added. Per-range uploads are in, with no gain on contiguous edits. An opt-in single-channel atlas mode cuts
  GPU memory to 0.18 MiB for a paragraph (competitor 0.49) but **looks different** (8.7% of lit pixels differ,
  up to 120/255 at rounded corners), so it is off by default.
- **Correction from the lane.** The integration test killed with exit 137 was caused by the lane itself, not
  the machine: a hand-written codec mirror was not updated, the comparison failed, and the assertion library
  built a multi-gigabyte diff. Fixed; the earlier "also fails on baseline" observation was wrong.
- **Not done by renderer part 2, now building as two lanes:** Slug (steady frame still 0.755 ms) and the pure
  TypeGPU path (no effect variants, trimming or on-demand atlas; one draw per text).
- **Held: atlas prewarm API.** The renderer primitive exists; the public entry point needs shaping and a
  handle-level call owned by the preparation lane.
- **Known gap in checks.** The repository's full `check` stops at two clippy findings in
  `ascii_anchor_policy.rs` (code scheduled for deletion), so later steps of the check have not run on this
  branch. The Slug lane is asked to scope-allow them and report what the rest of the check finds.
- **New breaking surfaces (renderer).** MSDF atlas resource group: `texture` replaced by a `pages` token plus
  a `glyphs` table (an external renderer must exchange the token in-process); materials survive buffer growth
  on WebGPU; decoded atlas pages alias the loaded file's bytes.
- **Stopped: all six running lanes hit the account's weekly usage limit** on the top model (resets
  2026-11-23 15:00 America/Detroit). Nothing was lost; each lane's worktree holds its state:
  geometry (`glyph-wt-geometry`): stage clocks committed, the dense kernel and paragraph files written but
  uncommitted and unproven; Unicode (`glyph-wt-unicode`): dense kernel over the property closure committed,
  generator changes uncommitted, oracle tiers not yet run; cluster (`glyph-wt-cluster`): divergence fixes in
  progress, uncommitted, with a new regression test file; preparation (`glyph-wt-prepare`): stage 0 guards
  (crossing budget) committed, the flip not started; Slug (`glyph-wt-render`): clippy allows and early
  glyph-table edits uncommitted; TypeGPU (`glyph-wt-typegpu`): real-device parity harness committed, no
  renderer change yet. None of this is merged. The integration branch is unaffected at `sil-green-4`.
- **Cause.** Every lane, profile and review ran on the top model. Mechanical work (profiles, font fetching,
  harness building, merges, log upkeep) did not need it.

### 2026-11-21, after the usage reset

- **Decision (owner).** A breaking release is acceptable.
- **Decision (owner).** An editing session with `replace(start, end, insert)` may be public, on conditions:
  it must not reintroduce the edge cases that caused API errors before; it throws when misused; and it must be
  easy to understand, because "start" and "end" mean different things for glyphs and characters. Design rule
  taken from this: offsets are UTF-16 code units of the source text and nothing else (never glyph or cluster
  indices); an offset that is out of range, reversed, or not on a grapheme boundary throws a typed error
  naming the offset and the nearest valid boundaries; nothing is snapped silently.
- **Decision (owner).** Of the three first-frame options, only **compiling the font binding at font load** is
  approved. Engine warm-up at `init()` with an embedded font, and replacing the JavaScript font hash with a
  bake-time digest, are **not approved** and stay held.
- **Decision (owner).** Stale process guidance may be deleted, with a list of what was removed.
- **Decision (owner).** Match the model to the work from here on.
- **Salvaged.** Interrupted work committed as unverified checkpoints: geometry `a20cec258`, Unicode
  `2f5788bf7`, Slug `0231437a3`. The cluster worktree's files are staged but not committed (its commit hook
  needs dependencies installed). Preparation and TypeGPU worktrees were clean.
- **Dispatch, by model.** Top model, resumed with their context: cluster (divergence fixes, then 1c),
  geometry (1a), Unicode (1d), preparation model (unit 3). Opus, fresh: Slug; pure TypeGPU path; font binding
  at load. Sonnet: stale-guidance deletion; salvage. Integration (merge, full oracle tier, tests, this log)
  stays with the coordinator and is kept small.
- **Done: stale process guidance removed** (`038690bb1`). Removed from `publication-frontier.md`: "Roles and
  bounded context" (model and effort tiers per step), "Execution and completion gates", and the checkbox list
  of remaining acceptance gates. Removed from `decisions/retained-prepare-publish.md`: the per-wave
  measurement and size requirements; a supersession line now points to the new preparation decision.
  `session-handoff.md` had no such process section, so nothing was removed there. Candidates left alone
  because process text is interleaved with measurements or design: several chronological passages in
  `publication-frontier.md`, two in `retained-text-assignment.md`, and acceptance gates for unrelated
  features. Full list: `stale-guidance-removed-2026-11-21.md`.
- **Decision (owner).** Integrate, commit and push to the remote as each feature resolves, so no work is at
  risk. This replaces "push when the feature is done".
- **Pushed.** `experiments/segment-indexed-layout` and tags `sil-green-0` to `sil-green-4` are on
  `origin`. In-progress lane branches are pushed as backups (`experiments/sil-geometry`, `sil-unicode`,
  `sil-render`, `sil-prepare`, `sil-typegpu`); they hold unverified checkpoints and are not for review. No
  pull request is opened. From here: each lane result is merged, gated on the full oracle tier and the
  package tests, tagged, and pushed in the same step; lane branches are pushed at each hand-back.
- **Merged: divergence fixes** (tag `sil-green-5`, pushed). All seven families of "incremental differs from
  cold" are fixed at their cause and the known-divergence list is empty: the full tier now reads 423 cases
  equal, 0 scripted steps and 0 of 43,680 seeded requests differing, native and wasm. Root causes: a style
  refresh that copied the previous layout runs and kept stale style indexes outside the reshaped run (this
  one cause produced the 48 span cases, the 18 rejected-valid-input cases and the extra CJK layout run); a
  sparse reshape window that could not see what its unchanged left neighbour does to its first glyph (now
  shapes one cluster ahead; costs two more shaped units in two tests); a resize shortcut that skipped the step
  retiring a cached measurement and discarded the newly composed flow; a convergence test that could drop a
  final empty line; a direction flag not reset. All were reachable from the public API. Seven new regression
  tests each fail on the previous tag and pass now.
- **Integrator action.** 37 frozen cases had recorded the divergent result and were re-frozen (reference set
  `d8e1146486189b8b`). Checked before accepting: only incremental step digests and one recorded rejection
  changed; no cold-stage digest changed, so the cold reference the rewrite is judged against is untouched.
- **Note.** The lane tried to add waiver entries itself and the permission system blocked it; no waivers were
  added by anyone.
- **Merged: pure TypeGPU path, units 1–2** (tag `sil-green-6`, pushed; full oracle tier green). MSDF
  fragments are specialized by effect and quads are trimmed to ink with the same rule as Three. GPU pass for
  plain text −19% (0.0384 → 0.0310 ms), Devanagari −14%. The TypeGPU output now matches Three at the same
  camera with 0 pixels over tolerance (max difference 2/255); before, six scenes had pixels off by up to
  57/255. Labels did not improve: at 1,000 labels the cost is per-draw (1,000 draws, 2,000 bind-group calls,
  0.33 ms GPU, 0.6–0.7 ms CPU), which is what batching removes.
- **Found, not yet fixed.** Growing past 1,000 labels on the TypeGPU path raises a device error; likely cause
  is a reused draw keeping a bind group on a reallocated placement table. Assigned with batching.
- **Design accepted for batching.** Use the codec's existing indexed-transform mode for MSDF and bitmap (a
  per-instance transform index and one renderer-owned transform table), so moving a label is one 8-byte
  write and 1,000 same-font labels become about one draw. Slug stays in direct mode until its lane frees a
  buffer slot.
- **New behaviour to note.** On TypeGPU the first appearance of an outline or shadow compiles its pipeline in
  that frame; a custom colour transform no longer sees the empty part of a glyph cell.
- **Merged: unit 1d part 1, dense Unicode analysis** (tag `sil-green-7`, pushed; full oracle tier green,
  native and wasm). Fast-path membership is generated from the Unicode database as a property closure, not a
  script list. Unicode stage self-time in wasm at 22k units (before → after, µs): Latin 1,208 → 50; Cyrillic
  1,429 → 60; Arabic 1,319 → 69; CJK 1,554 → 261; Devanagari 1,325 → 1,357; Thai unchanged. Proven by an
  exhaustive kernel-versus-scalar comparison over 82.8 million strings, a 400,000-string fuzz, and all UAX
  conformance files through both paths. Bidi is now classified per bidi paragraph with counts exposed.
- **Costs and gaps of part 1.** Wasm grew by 8.8 kB gzip (the new table and kernel; the table re-encoding
  meant to offset it is not done). Bidi is about 25% slower on paragraphs with right-to-left text because
  they are classified twice. Indic and Thai text gain nothing (all residue). Whole-operation edit time
  against main was not measured.
- **Finding: the existing line breaker has UAX #14 bugs** not covered by the official test file (inherited
  from the library it was ported from): after an opening quote the break after the following unit is
  suppressed (`“A dog` has no break after the space; `«字字字` no break between the first two ideographs), and
  two state flags survive a required line break. The kernel reproduces the current behaviour bit for bit.
  **Default taken:** fix it, since correct multilingual line breaking is a stated requirement; it changes
  line breaks against main for text with opening quotes and changes cold references for the affected oracle
  cases, which will be listed and re-frozen as a separate commit that is easy to revert. Assigned to part 2.
- **Merged: font binding compiled at font load** (tag `sil-green-7`). The first `createText` no longer
  compiles the binding: 16.2 → 12.7 ms with a full 55 MB font in the browser, first frame 39.7 → 35.9 ms.
  Smaller than the 12 ms the profile suggested, because most of that figure was the atlas re-pack at first
  draw, which did not move. Total time from font load to first frame did not measurably change. Cost for a
  font loaded and never drawn: 3–8 ms of CPU at load and 0.3–4.4 MiB held until release.
- **Merged: unit 1a, dense run-local geometry** (tag `sil-green-8`, pushed; full oracle tier green, native
  and wasm). Run-local rows are seven f32 lanes computed by one kernel with the cut rule as a parameter.
  Stage self-time in wasm: 56 → 20 ns per glyph on Inter, Fredoka, Amiri, Devanagari and CJK (22k Inter: 1,232
  → 391–442 µs). A font-size step at 22k: 4.25 → 3.55 ms. **Costs:** the short-label stage is 12% slower
  (102 → 114 µs for 200 labels) because labels still copy glyph by glyph before the kernel; and the shipped
  wasm grew 9.9 kB gzip. Both are assigned to the lane's next unit. Whole-operation time against main was
  not measured.
- **Tested, not merged: Slug per-font glyph table** (`experiments/sil-render`). Instance data 112 → 40 bytes,
  upload per edit 84.5 → 27.6 kB, GPU memory for a paragraph 0.209 → 0.147 MiB, pixels identical to the
  branch-start reference except one pixel by 1/255. **The steady frame did not improve** (0.88 ms at 4×,
  flat): the time is in the fragment stage, not instance reads, so the fragment unit is where Slug's frame
  cost will move. The merge conflicts with the TypeGPU lane's module split in one file; the Slug lane is
  resolving it.
- **Finding: the repository's full check has been failing** at a benchmark conformance case since the MSDF
  glyph-table merge (the benchmark's MSDF oracle still expects a texture array). The package tests pass; the
  benchmark build and packed-consumer test had not been reached. The Slug lane is fixing it with the merge.
- **Watch: wasm size is rising again.** Unicode kernel +8.8 kB and geometry +9.9 kB gzip on top of 570 kB.
  Offsets not yet done: table re-encoding, deleting the staged writer, deleting retired paths.
- **Building.** Positioning (1b) started in `experiments/sil-positioning`. Unit 1c (cluster build) starts
  when the geometry lane's next unit merges, since both edit `refresh_styles_from_stream`.
- **Merged: Slug per-font glyph table** (tag `sil-green-9`, pushed; full oracle tier green). Also merged with
  it: the benchmark's MSDF oracle now reads the page token and glyph table, so **the repository's full
  `check` runs to the end and passes** (all package and app checks, 16 headless conformance cases, the
  benchmark build). The remaining failures were five planning-doc validator errors from documents written
  during this work; frontmatter added, validator now reports 0 errors.
- **New public surface.** `@pmndrs/glyph/core` exports `msdfBakedPages`, `MsdfBakedPages`,
  `MSDF_GLYPH_TABLE_STRIDE`, `MSDF_GLYPH_TABLE_LAYER_STEP` and `SLUG_GLYPH_TABLE_STRIDE`; an external renderer
  needs them. `slugSchema` buffers changed (five removed, a `glyph` buffer added).
- **Tested, not merged: pure TypeGPU batching** (`experiments/sil-typegpu`, `b8a19d05a`). MSDF and bitmap use
  indexed transforms with one renderer-owned transform table. Per frame at 1,000 labels: draws 1,000 → 1,
  bind-group calls 2,000 → 2, CPU 0.628 → 0.0043 ms, GPU pass 0.320 → 0.104 ms. Moving 10 of 1,000 labels
  0.615 → 0.010 ms. Editing one label 0.975 → 0.090 ms (same glyph count) and 7.55 → 1.05 ms (count
  changes). The device error when growing past 1,000 labels is fixed and has a real-device test. Still 0
  pixels over tolerance against Three, including new scenes for growth, moving labels and mixed effects.
  Costs: plain single text GPU pass 0.031 → 0.034 ms (two extra storage reads per vertex, not isolated);
  count-changing edits upload about 6% more bytes. Slug is not batched (no free lane). The merge conflicts
  with the Slug table in three files; the lane is resolving it.
- **Merged: pure TypeGPU batching** (tag `sil-green-10`, pushed; full oracle tier green; on the lane after
  merging with the Slug table: real-device parity 0 pixels over tolerance, 1,139 package and integration
  tests, and the full repository `check` exits 0). Numbers as logged above.
- **Finding.** With the glyph table Slug has only four buffers, so it can take a transform-index buffer
  like MSDF and bitmap and be batched the same way; no lane packing is needed. Assigned to the Slug lane with
  the fragment-cost unit.
- **Building.** Slug: fragment cost, then batching. TypeGPU: shared pipelines, then on-demand atlas.
- **Merged: unit 1d part 2** (tag `sil-green-11`, pushed; full oracle tier green, native and wasm).
  (A) The line breaker's opening-quote bug is fixed in the scalar and the kernel: `“A dog` can now break
  after the space, `«字字字` between the first two ideographs, and state no longer leaks across a required
  break. Proven by an exhaustive kernel-versus-scalar run over 106.9 million strings and the official test
  file on both paths. **This changes line breaking against main** for text with an opening quote; it is its
  own commit (`670cbc24a`). Two oracle label cases whose edit steps create the pattern gained one break
  opportunity and were re-frozen (set `126c1d9ef4c23603`); checked: only step digests changed, no cold-stage
  digest. (B) Right-to-left paragraphs are classified once: bidi at 22k Arabic 510 → 410 µs (original 391),
  so it is **still 1–5% slower than before the kernel work**, not equal. CJK Unicode stage 261 → 199 µs.
  (C) Per-lane resync predicates for local edits, with the reviewer's 400,000-string fuzz ported per lane and
  200,000 random edits for the script window. Wasm +0.17 kB gzip.
- **Correction.** Two mixed-bidi figures logged for part 1 (94 and 57 µs) were first-run allocation effects
  from too few iterations; the steady-state figures are 35 and 52 µs.
- **Interim: geometry unit 2** (not merged; full proof running on the lane). Run-local stage at 22k in wasm:
  metric change 1,265 → 299 µs; line height 1,264 → 15 µs (its own class now); 200 labels 104 → 67.6 µs, so
  the label regression is gone. Wasm size recovered only about 0.5 kB of the 9.9 kB the first unit added.
- **Shaper wasm on the integration branch: 589.8 kB gzip.**
- **Merged: geometry unit 2** (tag `sil-green-12`, pushed; full oracle tier green, native and wasm). Metric
  changes rerun the kernel from font-unit lanes; line height is its own class and skips advances and geometry
  (run-local stage 1,264 → 15 µs); labels hand lanes straight to the kernel (200 labels 104 → 67.6 µs, the
  earlier regression is gone). Whole operation against main, interleaved (ms): font-size publication at 25.9k
  6.19 against 8.08; Fredoka 6.02 against 8.17; letter spacing 5.31 against 7.15; 200 labels restyled 2.55
  against 3.21. **Still behind main: line-height publication, 6.71 against 5.63**; run-local is now 15 µs
  of it, so the rest is elsewhere on that path and is unprofiled (the gather change-class work is the
  suspect). Gather reading lanes showed no measurable gain. A new cold-equality test covers size, line
  height, spacing and a mixed span at a non-round size on two fonts.
- **Size not recovered.** The geometry work stands at about +9.4 kB gzip. The staged writer that remains
  serves only line-edge islands; deleting it needs positioning to hand island lanes directly, which goes to
  the positioning lane.
- **Merged: pure TypeGPU shared programs and on-demand atlas** (tag `sil-green-12`). All MSDF fonts share one
  program per effect variant (a second and third font now create 0 shader modules and 0 pipelines; before, 2
  and 2 each). Only drawn glyphs take GPU memory: atlas bytes with a full-font bake 41.9 MB → 0.26 MB, with
  an ASCII bake 2.06 MB → 0.26 MB; mount plus first frame for one text 8.6 → 1.3 ms. Editing to a
  never-drawn glyph costs 0.02–0.05 ms more at the median (0.075 → 0.120 ms at 1,000 labels). Parity with
  Three stays at 0 pixels over tolerance, including new scenes where glyphs arrive over several frames.
  Single-channel mode exists; its memory figure is computed, not measured.
- **Lanes finished and deleted:** `experiments/sil-geometry`, `experiments/sil-typegpu`.
- **Building: unit 1c** (dense cluster build) in a fresh `experiments/sil-cluster`.
- **Tested, not merged: Slug batching and Slug fragment cost** (`experiments/sil-render`).
  Fragment profile by injected shader variants (paragraph at 4×, ms): shipped 0.89; flat colour 0.16; band
  lookup only 0.16; so nearly all the time is curve visits (about 6.8 per pixel, each a dependent reference
  load, two curve loads and a solve). Covered pixels barely matter, so quads were not trimmed. Implemented:
  one texel per band entry holding the curve's control points (one load per visit), an exact skip for curves
  wholly beyond the half-pixel window, unsigned addressing. Steady frame, interleaved: paragraph 4× on WebGPU
  0.904 → 0.666 ms; 200 labels 1.377 → 1.007; WebGL2 paragraph 1.444 → 0.966; labels 2.557 → 1.684. Pixels
  identical to the branch-start reference except one pixel by 1/255.
- **Held by the integrator: the fragment commit.** It trades GPU memory for speed: each band entry is 16
  bytes instead of a 2-byte reference to a shared curve. An ASCII page goes 96 → 264 kB; a full-font bake is
  estimated (not measured) at about 11 MB of band curves against 1.4 MB of references. The owner's goal is
  no axis behind main, so it is not merged as is. The lane is asked to measure the full-font figure and make
  band curves resident on demand (only for glyphs in use), as MSDF now is, so typical text does not pay it.
- **Slug batching** matches the old per-text output except one pixel by 1/255; against Three the Slug scenes
  have 2–5 pixels over tolerance that predate batching and were budgeted in the parity script with a comment.
  Its merge conflicts with the TypeGPU atlas merge in two files; the lane is resolving it.
- **Tested, not merged: unit 3 stages 0–2, the preparation model** (`experiments/sil-prepare`). Setters now
  validate and mark dirty with zero engine calls; a read prepares that one paragraph; the frame prepares
  everything dirty in one call, then publishes. Engine calls for 200 labels: mount plus first frame 401 → 2;
  200 setters 200 → 0; 400 overwriting setters plus a frame 401 → 2; restoring the published value plus a
  frame 3 → 0; `createText` 1 → 0. A colour change no longer runs layout (asserted in Rust). A keystroke in
  a 4,950-unit paragraph sends under 512 bytes instead of 10 kB. Lone surrogates become U+FFFD and are
  counted. A per-paragraph change class since the last publication (none, paint, origin, metric, content,
  with dirty unit and line intervals) is exposed for gather. Proof on its base: full oracle tier native and
  wasm, 1,175 Node tests including React and Vue, a crossing-budget test and a conformance suite run against
  Three, react-three-fiber, Vue and TypeGPU-direct. Benchmark rows that ended at a setter are split into
  setter, setter + read and setter + frame, each asserting a layout digest.
- **Numbers (loaded machine; read the shape).** Setter spans drop to main's level or below (first set at
  1,000 labels 15.4 → 4.2 µs, main 12.0; overwrite at 1,000 labels setter + frame 775 → 151 µs, main 1,150).
  Mount plus frame at 2,000 labels 384 → 113 ms (main 564). Interleaved edit-read-publish stays a win (11.7
  ms, main 133.7).
- **What the flip did not fix, stated by the lane.** Typing one character is not faster end to end (insert
  plus read 2.03 ms, main 1.69): the smaller request did not move it, so the cost is in the Rust stages and
  validation. Dense rewrite plus frame is still 20–38% behind main (rewrite 64: 0.82 against 0.59 ms): that
  is per-label engine cost. Colour-only frames still grow with root size because gather re-reads the whole
  paragraph. Mount plus read is still superlinear (stage 3). Edit-proportional validation in Rust was not
  done.
- **Defects the rewrite of old tests surfaced, both fixed:** a frame batch could exceed a per-request style
  limit each setter had respected; a prepared lease leaked when a removal committed.
- **Breaking changes recorded** (the owner accepted a breaking release): a setter no longer prepares and
  cannot throw an engine status; lone surrogates no longer throw; `commitState()` `pending` also means "not
  yet prepared"; a failed preparation surfaces at the read or the frame.

### 2026-11-21, ship-gate decisions

- **Decision (owner): operating mode.** First get the product ready to ship; then every commit stays
  shippable; then hardening and performance. Beating v0.1.0 is the minimum bar; beating ultra-text is a nice
  claim; beating main is not required if overall performance is better.
- **Decision (owner): aggregate performance.** A row that got slower, has no clear fix left and fits in
  about 4 ms rides until after ship-ready.
- **Decision (owner): ship-gate scope.** Editing support is part of the gate. Wasm size rides. The UAX #14
  opening-quote fix stays. The direct-TypeGPU Slug mismatch with Three is fixed before ship. The oracle
  covers decorations, several paragraphs per root, inline objects and multi-region flow before ship. The
  quiet-machine comparison runs once at the gate with all lanes paused. The owner reviews a one-page API
  summary before docs are written. Landing is one draft PR on top of the existing stack, when ship-ready.
- **Merged: preparation model stages 0–2 and the Slug work** (tag `sil-green-13`, pushed). The first
  verification of the combined tree failed. Two failures were a stale benchmark dependency cache caused by
  untracked profiling scratch left in the worktree (moved out; the benchmark's dependency scan is now
  limited to its own pages). Clearing it exposed one real bug from the preparation change: a material or
  decoration-colour change on decorated text was treated as paint-only and published a stale material id,
  because decoration records bake material and colour at positioning time. Fixed (`6a51cd428`) with tests.
  The oracle did not catch it; a render proof did, which is why decoration coverage is now being added.
- **Merged: unit 1c and Unicode part 3** (tag `sil-green-14`, pushed). Verified on the combined tree after a
  clean rebuild: full repository check exits 0; TypeGPU real-device parity; both render proofs on WebGPU and
  WebGL2; live check; full oracle tier native and wasm at 423 equal, 0 divergences. Unit 1c: mid-paragraph
  insert at 22k, whole step in wasm against `sil-green-12`: Inter 6.65 → 4.31 ms, Fredoka 7.34 → 4.65, Amiri
  9.98 → 7.28, Devanagari 11.96 → 9.20, CJK 8.58 → 6.36; the build reports exactly which cluster ranges
  changed, proven by a shadow build running the old comparison beside the new one. Wasm +8.8 kB gzip.
  Unicode part 3: lazy word and sentence lanes (an edit nobody queries does no word or sentence work;
  windowed recompute after an edit; Unicode 17 word and sentence tests permanent), and three-stage tries
  (our tables 141.6 → 80.7 kB, wasm −5.1 kB gzip, every lookup checked for all code points).
- **Tested, not merged: unit 1b positioning** (`experiments/sil-positioning`). Measurement stage about
  620 → 35 µs at 22k; a width or alignment change that moves no break costs a third (LTR) to a sixth (RTL)
  of before; cold, edit and moved-break positioning 15–40% faster. `measure()` after a width change against
  main: Inter 1.27×, Fredoka and Amiri about 2×. Wasm +5.9 kB gzip. Built on `sil-green-8`; the lane is
  merging the current branch and re-proving.
- **Process change.** Browser proofs now run on the integration tree, after a clean rebuild, before every
  tag; previously they ran only on lane branches.
- **Lanes deleted after merge:** `experiments/sil-cluster`, `experiments/sil-unicode`.
- **Merged: unit 1b positioning** (tag `sil-green-15`, pushed). Verified on the combined tree after a clean
  rebuild: full repository check exits 0; TypeGPU real-device parity; both render proofs on WebGPU and
  WebGL2; live check; full oracle tier native and wasm at 423 equal, 0 divergences. Wasm stage at 22k,
  centre-aligned: measurement 632 → 46 µs (Inter), 662 → 31 (Amiri); width change with the same breaks
  844 → 281 (Inter), 1,714 → 308 (Amiri), 2,178 → 412 (mixed bidi); cold positioning 855 → 616 (Inter).
  `measure()` after a width change, whole operation against main: Inter 0.46 against 0.36 ms; Fredoka 1.07
  against 0.48; Amiri 0.41 against 0.20 — all under 4 ms, so they ride. Not done: lines with edge records,
  decorated paragraphs and gap-justified lines take no numeric repass. Shaper wasm is 601 kB gzip (rides).
- **Tested, merged pending proofs: Slug parity on direct TypeGPU** (`670cc248a`). The mismatch with Three
  was not a formula difference: where a pixel centre sits exactly on a glyph edge, the last bit of an
  interpolated coordinate decided coverage, and the two renderers round vertex positions differently. Both
  shaders now sample 1/10,000 of a pixel off centre, which resolves ties on the same side as an exact CPU
  reference. Result: 0 pixels over tolerance against Three on every Slug scene (largest difference 1/255),
  budgets removed; no pixel moved more than 2/255 against the branch-start reference; steady frame level.
  Limit: at about 1,000 px per em, rounding could approach the offset and ties could reappear.
- **Written for owner review:** `api-summary-for-review.md` — every public name added, changed or removed
  since v0.1.0, read from code, plus proposed shapes for `onLayout`, the editing queries, the editing
  session and the error surface, with fifteen naming questions. Findings: the published `exports` map is
  unchanged; today's `caretForOffset` snaps an offset inside a cluster to its start and `selectionRects`
  swaps and clips ranges silently, which conflicts with the owner's "nothing snapped silently" rule; two doc
  comments are wrong. Editing support is held until the owner answers.
- **Merged: Slug parity on direct TypeGPU** (tag `sil-green-16`, pushed). Verified on the combined tree after
  a clean rebuild: glyph package tests, TypeGPU real-device parity, both render proofs on WebGPU and WebGL2,
  live check. The full repository check was not re-run for this shader-only merge (it passed on the lane's
  branch and at `sil-green-15`). Ship-gate item closed.
- **Tested, not merged: error model (unit 3 group A)** (`experiments/sil-prepare`, `8cda3229a`). A failure in
  one paragraph empties that paragraph only; `maxTextUnits` (default 65,536) throws at the setter; every
  engine call goes through one gateway that recovers from a trap by replacing the instance and restating
  fonts and roots; a failed frame is retried once. Capped-memory test now permanent: at 500–4,000 pages only
  the oversized paragraph is refused and siblings are unaffected; at 300 pages the root's publication no
  longer fits, reads still work, and shrinking or disposing the victim recovers. No cap leaves a root dead.
  Also in that lane: mount linear in label count (4,000-label frame 3.4 s → 109 ms) and per-paragraph
  measurement interest. Settled: the slow colour-only reading was machine load (119 / 124 / 126 µs across
  three builds); typing is 44% shaping because the whole run is reshaped, and validation is 7.6 µs, so the
  typing gap belongs to local edits. Not done: publication failures still discard the root; failure
  inventory and interleaving fuzz; a per-text error surface on TypeGPU-direct. Proven on a base before the
  cluster-build and positioning merges; the lane is catching up before it merges.
- **Question from the owner: pixi3d.** The refactor does not run in the pixi3d checkout
  (`/Volumes/Depot/Developer/text`, `feature/pixi3d`), which is untouched. `packages/glyph-pixi3d` exists
  only on that branch, largely uncommitted, and was built against the old Slug and MSDF schemas and
  synchronous setters, so official integration is a port. Awaiting the owner on whether it is in the ship
  gate and who commits the uncommitted work.
- **Decision (owner): API summary approved** with the recommended answers, except lone surrogates.
- **Decision (owner): lone surrogates get no public API.** They render as the replacement character instead
  of throwing, and that is all: `Text.replacedSurrogates` is removed and no count is added anywhere.
  `text.text` returns the string as assigned.
- **Decision (owner): PixiJS 3D support is part of 0.2.0.** The owner's pixi work was committed locally on
  `feature/pixi3d` (`2ecb36411`; hook bypassed for two unused-symbol warnings in the demo app; not pushed).
  Left out of that commit and untouched on disk: 52 GB of untracked demo assets and new app files, the
  vendored private beta tarball, two scratch directories. The renderer package is being ported onto the
  integration branch against the official public release, proven by a pixel comparison against Three; demos,
  examples and apps stay behind; the private beta tarball must not enter the public repository.
- **Building.** Editing support, engine half (`experiments/sil-editing`): offset map, carets, hit testing,
  movement, selection rectangles, with property tests over the oracle corpus. PixiJS 3D port
  (`experiments/sil-pixi3d`). Oracle coverage (`experiments/sil-oracle`). Preparation lane: catching up, then
  frame integration and `onLayout`.
- **Merged: error model, unit 3 stage 4** (tag `sil-green-17`, pushed). Verified on the combined tree after a
  clean rebuild: glyph package tests 1,234 of 1,234; TypeGPU real-device parity; both render proofs on WebGPU
  and WebGL2; live check; full oracle tier native and wasm at 423 equal, 0 divergences. The full repository
  check passed on the lane's merged branch and was not re-run on the integration tree for this tag.
- **Merged: PixiJS 3D renderer** (tag `sil-green-18`, pushed). Package `@pmndrs/glyph-pixi3d`, public, against
  the official `@pixi/3d` 0.1.0 (MIT, published 2026-11-12) and `pixi.js` 8.23 as peer dependencies; both
  earlier patches dropped; nothing from the private beta copied. Techniques carried: bitmap, MSDF/MTSDF with
  outline and shadow, Slug, decorations; also spans, `split()`, anchors, custom materials. Verified on the
  combined tree after a clean install and rebuild: full repository check exits 0; glyph package tests; the
  package's own check (34 tests); new `benchmark:pixi3d-parity` (27 scenes against Three on WebGPU and
  WebGL2); TypeGPU parity; both render proofs; live check. The Rust engine is unchanged by this merge, so the
  oracle was not re-run. Parity: WebGPU within tolerance on every scene (max 2/255) except 13 of 74,484
  pixels in one outline scene; WebGL2 Slug at most 13 pixels over; WebGL2 bitmap up to 1.63% of lit pixels
  over; each difference is a named budget with its cause. Gaps: MSDF uploads every baked page on PixiJS 3D;
  no ordered `TextGroup` equivalent; decorations, `split()` and instancing have unit tests but no parity
  scene; no performance numbers. Left behind: the demo app, the GLYPH//BREAKER shader bit, two demo skills.
- **Needs owner sign-off: three new `/core` names** the port required: `createDecorationCodecProgram` and
  `decorationSchema`; `SlugBandResidency` and `SLUG_RESIDENT_BAND_CURVE_WIDTH`.
- **Tested, not merged: oracle coverage** (`experiments/sil-oracle`): 165 new cases (decorated text and
  effects 84, several paragraphs per root 27, columns and regions 38, inline objects 16); full tier 588 cases
  and 54,240 requests. It now catches the decorated-text material bug. Three new engine divergences recorded,
  not fixed: paragraph draw order under ranked scopes depends on history; removing every paragraph from a
  root leaves its glyphs drawn and the next request rejected; a borrowed-glyph read after a no-op on a
  clipped paragraph is stale. Findings: inline objects are accepted and validated but no layout stage reads
  them; regions were exercised only as horizontal rectangles. The lane is catching up with the integration
  branch before the coverage merges.
- **Merged: oracle coverage** (tag `sil-green-19`, pushed; full tier native and wasm: 588 cases equal, 54,240
  requests, 0 unlisted divergences; reference set `9eec1a5a309ffe3f`; every pre-existing case byte-identical).
  Ship-gate item closed for coverage. One of the three reported divergences was retracted: the "emptied
  root" case was a bug in the oracle's own driver (removals were not sent when a step removed every
  paragraph), fixed; an emptied root equals cold. **Two engine divergences stand** and are listed: (1)
  paragraph draw order under ranked scopes depends on history (lead: `validate_lifecycle_input` rebuilds the
  pending order from the already rank-permuted list, and `prepare_lifecycle` permutes again); (2) a
  borrowed-glyph read after a no-op on a clipped paragraph is stale (lead: `append_paragraph_measurement`
  keeps the previous clipped-inspection mode when nothing is pending, regardless of the views requested).
  Both leads come from reading the code, not from a fix. A fix lane has started.
