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

| Feature                                                                                 | State    | Where                                               | Notes                                             |
| --------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ------------------------------------------------- |
| Plan, branch rules, feature-scope decision                                              | merged   | `771ef41de`                                         |                                                   |
| Snapshots: `v0.1.0`, main, branch start                                                 | tested   | `glyph-baselines-2026-11-21/`                       | Loose reference                                   |
| Adversarial font set                                                                    | tested   | `/Volumes/Depot/Developer/glyph-adversarial-fonts/` | Not in the repo (large)                           |
| Competitor's eight measures, same machine                                               | tested   | `/Volumes/Depot/Developer/glyph-competitor-bench/`  | Reconstructed scenes                              |
| Profile: size and memory                                                                | tested   | `profiles/7-size-and-memory.md`                     |                                                   |
| Profile: font-size and inspection                                                       | tested   | `profiles/5-6-fontsize-and-inspection.md`           |                                                   |
| Profile: browser first frame and idle                                                   | tested   | `profiles/1-2-browser-first-frame-idle.md`          |                                                   |
| Profile: colour-only and many-label                                                     | tested   | `profiles/3-4-colour-and-many-label.md`             |                                                   |
| Unit 0: correctness oracle                                                              | building | integration branch                                  | Gates every engine unit                           |
| HarfRust fork (AAT and `rand` off, `kern` kept), panic removal, lazy outline decoder    | building | `experiments/sil-harfrust`                          |                                                   |
| Renderer: one draw, ink-trimmed quads, on-demand atlas, TypeGPU batching                | building | `experiments/sil-render`                            |                                                   |
| Host: idle frame, linear mount, first-frame JavaScript, first set, ingress, readback    | building | `experiments/sil-host`                              |                                                   |
| Whole-plan review (five reviewers)                                                      | building | `glyph-baselines-2026-11-21/review-v5/`             | Refines the plan; cuts nothing                    |
| Unit 1a: dense run-local geometry                                                       | held     | —                                                   | Needs oracle                                      |
| Unit 1b: dense positioning and per-line ink                                             | held     | —                                                   | Needs oracle, 1a                                  |
| Unit 1c: dense cluster build                                                            | held     | —                                                   | Needs oracle, 1a                                  |
| Unit 1d: table-driven Unicode classes                                                   | held     | —                                                   | Needs oracle                                      |
| Gather rewrite (write-only path, lane compare)                                          | held     | —                                                   | Needs oracle                                      |
| Unit 2: local edits                                                                     | held     | —                                                   | Needs 1b, 1c                                      |
| Metric changes: keep island shapes, dense rescale                                       | held     | —                                                   | Needs 1a                                          |
| Unit 3: preparation and error model, `onLayout`                                         | held     | —                                                   | Sequenced after the host lane                     |
| Unit 4: publication (retained topology, `PATCH_COPY`, multi-range uploads)              | held     | —                                                   | After unit 3                                      |
| Many-label updates and paint-only changes                                               | held     | —                                                   | Needs its profile and unit 3                      |
| Editing support (offset map, boundaries, carets, affinity, ligature carets, IME ranges) | held     | —                                                   | Needs 1d, 2 and an API design                     |
| SIMD experiments (fourteen)                                                             | held     | —                                                   | Each needs the oracle; adopted if faster or equal |
| Sub-ulp output changes (integer pen, affine placement)                                  | held     | —                                                   | Awaiting owner approval; measured only            |
| Final interleaved comparison against main and the competitor set                        | held     | —                                                   | Last                                              |
| Typography other than editing support                                                   | deferred | decision record                                     |                                                   |
| `rand`, Apple AAT                                                                       | dropped  | decision record                                     |                                                   |

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
