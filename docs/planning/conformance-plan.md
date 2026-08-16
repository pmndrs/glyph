---
type: Test Plan
title: Shaping and layout conformance plan
description: Defines HarfBuzz, HarfRust, baked-runtime, paragraph, fuzzing, and visual correctness gates.
tags: [conformance, shaping, layout, testing]
sources:
  - id: 'citation-1'
    resource: 'https://harfbuzz.github.io/shaping-opentype-features.html'
    title: 'HarfBuzz shaping documentation'
  - id: 'citation-2'
    resource: 'https://github.com/harfbuzz/harfbuzz/tree/main/test'
    title: 'HarfBuzz test suite'
  - id: 'citation-3'
    resource: 'https://github.com/harfbuzz/harfrust'
    title: 'HarfRust'
  - id: 'citation-4-1'
    resource: 'https://unicode.org/reports/tr9/'
    title: 'UAX #9'
  - id: 'citation-4-2'
    resource: 'https://unicode.org/reports/tr14/'
    title: 'UAX #14'
  - id: 'citation-4-3'
    resource: 'https://unicode.org/reports/tr29/'
    title: 'UAX #29'
  - id: 'citation-5-1'
    resource: 'https://www.w3.org/TR/css-fonts-4/'
    title: 'CSS Fonts Module Level 4'
  - id: 'citation-5-2'
    resource: 'https://www.w3.org/TR/css-text-3/'
    title: 'CSS Text Module Level 3'
  - id: 'citation-6'
    resource: 'https://learn.microsoft.com/en-us/typography/opentype/spec/'
    title: 'OpenType specification'
  - id: 'citation-7'
    resource: 'https://github.com/drawcall-ai/vitexec'
    title: 'Vitexec'

generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-08-15T15:53:27Z'
---

# Shaping and layout conformance plan

Status: active; executable through roadmap item 5.4
Purpose: define correctness before each implementation or optimization.

## Conformance target

Primary target:

> Match a pinned HarfRust release for valid, supported, statically instantiated OpenType fonts under identical shaping inputs.

Secondary target:

> Compare the same cases against the corresponding pinned HarfBuzz release and track every difference explicitly.

HarfRust is not assumed to equal HarfBuzz in every case. The project must never conceal a known difference by weakening comparisons globally.

## Version manifest

Every fixture run records:

```text
font SHA-256
font face index
HarfRust version and commit
HarfBuzz version and commit
Unicode version
pmndrs/glyph compiler version
PMNDRS_font format version
variation coordinates
shaping input options
```

Reference changes require a dedicated review containing the old/new output diff and upstream release notes.

## Comparison input

Each case specifies:

- exact source font bytes and face index;
- UTF-8 fixture text plus unambiguous code-point dump;
- input range and surrounding context range;
- direction;
- script;
- language;
- feature tags, values, and text ranges;
- variation coordinates;
- cluster level;
- buffer flags;
- replacement code point for invalid input;
- expected handling of malformed UTF-16 at the JS boundary.

Auto-guessed properties and explicit properties are separate cases.

## Comparison output

Compare all fields, not rendered appearance alone:

- output glyph count;
- packed/source glyph identity mapping;
- glyph IDs;
- cluster values;
- `xAdvance` and `yAdvance`;
- `xOffset` and `yOffset`;
- glyph flags, including unsafe-to-break/concat where exposed;
- direction and resolved segment properties;
- success/error category.

Design-unit integer outputs require exact equality. Floating raster/layout coordinates are tested separately with documented tolerances.

## Three-way stages

### Stage A — HarfBuzz versus HarfRust

Purpose: establish upstream baseline differences independently of this project.

Output:

- passing cases;
- allowlisted semantic differences with upstream issue/document link;
- unsupported cases rejected before baking;
- malformed-font behavior tracked separately from valid-font conformance.

### Stage B — source font versus baked reference payload

Run the same pinned HarfRust path on:

1. original/static-instanced source font;
2. the closed shaping-only static SFNT used by `PMNDRS_font`.

Purpose: prove the table whitelist, metrics, glyph identity, and retained layout behavior before testing any optimized data.

### Stage C — baked reference versus optimized operation

For each compiled operation family, run both executors from identical pre-operation buffer state and compare post-operation state where feasible, then compare final shaped output.

Operation families are enabled independently so failures identify the responsible compiler/executor.

### Stage D — shaped output versus paragraph integration

Verify that line fitting and boundary reshaping preserve:

- cluster-safe breaks;
- line-start/line-end shaping;
- source-to-glyph mapping;
- bidi visual order;
- inserted hyphen/ellipsis mapping;
- identical shaped glyphs across raster selection.

Item 5.2 fixes the Latin integration baseline in the canonical paragraph
contract: natural/wide/narrow layouts compare every HarfRust-derived glyph ID,
UTF-16 cluster, flag, scaled x/y position, line source/glyph range, baseline,
advance, and normalized SoA hash after the complete GLB extraction path. The
720 px and 360 px cases each submit all affected ranges in exactly one reshape
call; an unrelated subsequent shaper call proves the layout owns its arrays.

## Required script/behavior matrix

| Area           | Minimum cases                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latin          | kerning, `liga`, `clig`, `calt`, marks, decomposed/composed text, stylistic feature ranges                                                                                                                                                                             |
| Greek/Cyrillic | extended cmap, marks, language-specific substitutions where available                                                                                                                                                                                                  |
| Arabic         | joining forms, lam-alef, marks, cursive attachment, RTL clusters, line-boundary reshape                                                                                                                                                                                |
| Hebrew         | RTL order, marks, punctuation, mixed Latin                                                                                                                                                                                                                             |
| Devanagari     | reordering, conjuncts, pre-base vowels, marks, cluster boundaries                                                                                                                                                                                                      |
| USE script     | at least one non-Devanagari USE font/script with syllable behavior                                                                                                                                                                                                     |
| Thai/Lao       | marks and line-break tailoring boundary cases                                                                                                                                                                                                                          |
| Hangul         | precomposed and Jamo sequences                                                                                                                                                                                                                                         |
| CJK            | `cmap` formats 12/14, supplementary Han, standardized and ideographic variation sequences, `locl` for pinned Chinese/Japanese/Korean language cases, no-space line breaking and punctuation boundaries, vertical-form data retained though vertical layout is deferred |
| Emoji          | supplementary scalars, VS15/VS16, modifiers, ZWJ sequences, flags/keycaps                                                                                                                                                                                              |
| Icons          | private-use cmap, missing glyph, no-GSUB fast/simple font, selected/full-library paging, manifest-backed standalone SVG identity, accepted fill rules, and explicit SVG rejection cases                                                                                |
| Controls       | LF, CRLF, paragraph separator, tabs policy, default ignorables, ZWJ/ZWNJ, soft hyphen                                                                                                                                                                                  |
| Invalid input  | unpaired UTF-16 surrogates and replacement policy at JS boundary                                                                                                                                                                                                       |

The CJK row is split across two gates. Roadmap item 5.4 now proves exact horizontal CJK source/reduced HarfRust and HarfBuzz agreement, UTF-16 clustering, language-sensitive substitutions, variation handling, and paragraph layout. It conditionally retains source `BASE`, `VORG`, `vhea`, and `vmtx` without fabrication while leaving vertical layout deferred. It does not require CJK raster coverage. Milestone 14 later combines large-coverage CJK raster paging with icon paging, residency, and payload stress; that later work does not block the Latin-first Bitmap/MTSDF/Slug target v1 renderer gate. Before those raster contracts freeze, a synthetic 65,535-glyph fixture still validates glyph-ID width, dense-record lengths, logical page indexes, external page sources, and multi-page batching without claiming full CJK rendering support.

### Large-coverage page invariants

- `u16` remains the per-face OpenType glyph-ID width; maximum-cardinality arithmetic must not overflow record lengths or offsets.
- `page = 0xffff` means permanently absent raster data; a valid but nonresident logical page is a distinct runtime state.
- Logical page order is independent of URI order, fetch completion, GPU array layers, bindings, and draw order.
- Embedded and external sources produce identical decoded bytes and GPU readback for lossless variants.
- Every external source verifies declared length and SHA-256 before decode or upload.
- Slug curve, header, and reference resources publish atomically as one resident page.
- A changed layout cancels or supersedes stale preparation without publishing obsolete batches.
- CJK and icon page-walk fixtures preserve visual order and blending while pages span multiple backend batches.

## Cluster-specific cases

Fixtures must cover:

- many characters to one glyph;
- one character to multiple glyphs;
- reordered glyphs;
- combining-mark stacks;
- zero-advance marks;
- ligature clusters adjacent to legal line breaks;
- monotone cluster levels for LTR and RTL;
- style/feature boundaries inside words;
- caret and hit-test mapping around ligatures;
- unsafe-to-break and unsafe-to-concat flags;
- context range larger than emitted item range.

## Paragraph correctness matrix

### Unicode algorithms

- Run the version-matched Unicode `LineBreakTest.txt`.
- Run `GraphemeBreakTest.txt` for extended grapheme boundaries.
- Run the version-matched `BidiTest.txt` and `BidiCharacterTest.txt`; bidi analysis is owned by the package's JavaScript paragraph engine.
- Record any tailoring as a named profile, never an undocumented deviation.

Item 5.1 runs all 766 Unicode 17 `GraphemeBreakTest.txt` vectors and all 19,338
Unicode 17 `LineBreakTest.txt` vectors in the ordinary package suite. The
official sources are stored as deterministic gzip fixtures whose uncompressed
SHA-256 values are checked before the tests execute. UAX #9 remains an explicit
5.3 gate and cannot inherit completion from the UAX #14/#29 results.

### Reflow cases

- empty paragraph and empty lines;
- explicit hard breaks including CRLF;
- trailing spaces and all-space lines;
- single cluster wider than the region;
- repeated width changes that converge on cached line boundaries;
- max lines with clip and ellipsis;
- soft hyphen hidden and selected;
- inserted hyphen in Arabic and Latin;
- mixed RTL/LTR text across lines;
- font fallback at grapheme/cluster boundaries;
- width change that needs zero reshapes;
- width change that batches several boundary reshapes into one call.

## Font corpus policy

The checked-in corpus must be redistributable and small enough for ordinary CI. Large or restricted corpora use download manifests with hashes and run in scheduled/manual jobs.

Each selected font records why it exists:

- script/feature coverage;
- source/license;
- exact file hash;
- expected reference engine behavior;
- subset used for repository fixtures;
- known upstream bugs.

No fixture may silently update by URL.

## Fuzzing

### Structured text generation

Bias generation toward:

- combining-mark chains;
- joining controls;
- virama/consonant sequences;
- emoji ZWJ and variation selectors;
- bidi isolates/embeddings;
- feature-range boundaries;
- invalid surrogate boundaries;
- very long clusters and repeated contexts.

### Binary inputs

Fuzz:

- GLB chunk lengths and order;
- JSON extension indexes;
- section offsets, lengths, counts, and alignments;
- integer overflow and overlapping ranges;
- capability/format enums;
- cmap page descriptors;
- operation records and trie/CSR indexes;
- atlas dimensions and row strides.
- external page URI, length, hash, page-directory, and duplicate-request state;

### Failure policy

- No crash, trap, out-of-bounds read, or unbounded allocation.
- Invalid baked data fails registration before shaping/upload.
- Differential mismatches save the source seed, options, and both outputs.
- Reduced reproductions become permanent regression fixtures.

## Visual tests

Shaping conformance is data equality; visual tests cover raster and integration.

The current browser's HTML/CSS text renderer is the visual reference. Each capture uses the same browser process, font bytes, text, language, direction, feature settings, size, constraints, DPR, colors, and viewport as the candidate. Browser screenshots do not replace HarfRust/HarfBuzz field-level shaping comparisons; both gates must pass. Current Three Flatland Slug is not a visual or shaping oracle.

Required views:

- browser HTML/CSS reference versus Slug/MSDF/bitmap at representative sizes;
- extreme zoom/perspective for Slug;
- tiny text for bitmap and MSDF;
- marks and cursive connections;
- clipping, ellipsis, alignment, and mixed direction;
- technique switching from one positioned run.

Snapshot comparison must use a perceptual metric and retain raw difference images. Exact pixel equality is required only for deterministic CPU-generated atlases or reference equations where appropriate.

## Test layers and ownership

Status key: ✅ available · 🟡 partial or conditional · ⬜ not started

| Layer                    | Status | Required evidence                                                                                                                                                                                                                                                                                     | Canonical owner                                              |
| ------------------------ | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Unit                     |   🟡   | Deterministic tests for parsing, arithmetic, bounds, hashing, serialization, error mapping, and other isolated policy. Tests may use generated values and inspect package internals.                                                                                                                  | The package that owns the implementation.                    |
| Package integration      |   🟡   | The baker, bitmap generator, loader, shaper, and paragraph engine are exercised through public package boundaries with generated ABI equality, zero Wasm imports, direct-memory round trips, structured failures, deterministic bytes/results, and format validation. Rendering remains open.         | The package that owns each boundary.                         |
| Product end-to-end       |   🟡   | Inter, Amiri, and Noto CJK flow through real public baker/loader/registry/shaper/paragraph paths with exact Node, Chromium, and GPU-enabled Vitexec evidence. Rendering remains open.                                                                                                                 | The shared interactive/headless app under `apps/benchmarks`. |
| Differential conformance |   🟡   | Pinned HarfRust/HarfBuzz source oracles compare every glyph field; Inter records its exact flag inventory while Amiri and all thirteen CJK cases agree exactly. Each also matches the reduced SFNT, and runtime Inter/CJK paths use registered GLB views. Rendering-era script additions remain open. | The conformance runner and fixture corpus.                   |
| Fuzzing                  |   🟡   | Fixed-seed Rust source, bitmap/loader artifact, raw shaper-request, Unicode paragraph-policy, and CJK boundary mutations run twice in normal CI. Pinned cargo-fuzz/libFuzzer exercises the public bake boundary; minimized findings become checked-in fixtures. Renderer targets remain open.         | Each package owns its target and regression corpus.          |
| Performance regression   |   🟡   | Correctness-passing browser scenarios retain baker, loader, shaper, paragraph, bidi/policy, and CJK timings/payload/memory/call evidence; reviewed noise thresholds and renderer baselines remain open.                                                                                               | The shared benchmark scenario registry and runners.          |

Every implementation change adds the lowest-cost unit regression that identifies the defect. A package-boundary change also adds or updates an integration case. Any user-visible vertical slice must add a scenario to the shared benchmark registry and an end-to-end assertion in the appropriate automated or local live-probe lane before its roadmap item can be marked complete. The interactive lab, automated runner, and local probes consume the same scenario contract; duplicating the workload in an ad hoc demo or benchmark script does not satisfy the gate.

Generated contract fixtures are appropriate for overflow, malformed-input, and maximum-cardinality coverage. They never substitute for a licensed, hash-pinned real font in a product end-to-end gate. Until the canonical font is pinned, real-font smoke tests may accept an explicit local path and report a skip when absent, but that conditional lane cannot close a roadmap exit criterion.

### Fuzzing tiers

Fuzzing supplements the explicit malformed corpus; it never replaces schema, semantic, integration, or real-product assertions.

- Hermetic CI runs bounded fixed-seed mutation/property smoke tests at the Rust bake and TypeScript validation boundaries. The same input must produce the same structured result, and any panic, trap, unstructured exception, or nondeterministic outcome fails the test.
- Maintainer-local mutation runs use explicit seeds and the public production boundary. Coverage-guided Rust runs use exact cargo-fuzz/libFuzzer pins and the exact dated nightly in the isolated fuzz workspace; nested mise consumes that contextual `rust-toolchain.toml`. The product crate and distributed Wasm remain governed solely by the root stable pin.
- Every run records its seed and bounded inputs. A crash is minimized, copied into the owning package's checked-in malformed corpus, and paired with an ordinary regression test before the transient fuzz artifact is cleared.
- Unseeded random CI, retry-on-failure behavior, elapsed-time assertions, and treating an unreproduced long fuzz run as a release guarantee are forbidden.

## Execution environments

| Lane                  | Runs where                                                                              | Required scope                                                                                                                                                                                                                                            | Must not claim                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Hermetic CI           | Pull requests and scheduled CI, without network access                                  | Unit tests, compiled package integration, schema and asset validation, deterministic CPU/Wasm fixtures, and browser smoke cases whose capabilities are genuinely available.                                                                               | CI does not claim native GPU, driver, color, timing, or interaction coverage when the runner does not provide it.                        |
| Vitest product suite  | Shared test modules used by the benchmark app                                           | Scenario assertions, structured runtime state, artifact validation, and reusable setup/teardown.                                                                                                                                                          | A passing simulated or mocked target is not real-product coverage.                                                                       |
| Vitexec live probes   | Maintainer machines with the visible benchmark app and real device/browser capabilities | Inject Vitest-compatible probes into the running Vite app, import real modules, drive multi-frame state, inspect exact runtime values, and retain screenshots, traces, profiles, and environment metadata. Use GPU-friendly launch policy where required. | This local lane is not a required pull-request CI check and must not publish unreviewed machine-specific timings as universal baselines. |
| Playwright automation | Headed local browsers, remote browser endpoints, or CI when representative              | Reuse the same scenarios for repeatable navigation, lifecycle, screenshots, and supported WebGL/WebGPU cases.                                                                                                                                             | Headless or software rendering must not silently stand in for a required hardware-GPU acceptance run.                                    |

Capability checks are explicit test outcomes: pass, fail, or unsupported with a reason. Unsupported GPU/device combinations do not fail portable CI, but a milestone that requires that capability remains incomplete until its designated local/device matrix passes and stores reviewable evidence.

## Live-probe determinism contract

Canonical Vitexec probes are committed erasable TypeScript files under the benchmark app, never shell-embedded strings. They may use type annotations, interfaces, `satisfies`, and type-only imports, but not TypeScript constructs that require runtime transformation semantics such as enums, namespaces, parameter properties, or decorators. Ad hoc snippets remain useful for diagnosis but cannot satisfy an integration or end-to-end gate.

Each probe imports the real scenario driver and pure assertion/result helpers through browser-root module paths. A thin Vitest adapter and the Vitexec entry file reuse those helpers so assertions do not drift between runners. The probe performs user-like actions through the public interaction path; imported state is for observation and precise assertions, not bypassing the behavior under test. Results are emitted as one versioned machine-readable record with scenario ID, inputs, capabilities, assertions, lifecycle state, and evidence paths.

Readiness is causal and observable:

| System transition        | Accepted synchronization                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| App and scenario startup | An exported readiness promise/event or explicit lifecycle state owned by the app/scenario.                               |
| Worker bake/load         | The actual request promise plus request/generation identity and terminal state.                                          |
| Render publication       | A scenario-owned render-complete signal identifying the submitted generation/frame, followed by observable scene state.  |
| WebGPU work/readback     | Queue completion and mapped-read completion for the exact submitted work.                                                |
| WebGL work/readback      | The backend's explicit synchronization/readback completion for the exact submission.                                     |
| Animation or reflow      | A deterministic scenario clock/step and the resulting versioned state transition, not elapsed wall time.                 |
| DOM-visible outcome      | The product event/state that owns the change; DOM observation is acceptable when the DOM is itself the product contract. |

The following are forbidden in an accepted probe:

- `sleep`, `setTimeout`, fixed delays, arbitrary `requestAnimationFrame` counts, or elapsed-time polling as readiness;
- retries, Vitest retry settings, catch-and-rerun wrappers, or widened timeouts used to turn an intermittent failure green;
- polling a private value when the owning subsystem can expose an actual completion signal;
- dependence on network availability, mutable latest assets, shared browser state, test order, ambient cache state, unseeded randomness, or a previous probe's cleanup;
- screenshot-only success when structured state or GPU readback can establish the result.

Vitexec/Vitest timeouts are watchdogs for a hung or missing completion signal, never synchronization. Hitting one is a test failure with the last lifecycle state and pending operation recorded. If a subsystem has no causal completion signal, that is an observability defect to fix in the scenario/product boundary rather than an invitation to add a delay.

Before promotion from an exploratory probe to the integration/E2E suite, it must satisfy all of these admission gates:

| Gate             | Required evidence                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Causal review    | Every wait names its producer, operation/generation identity, completion signal, and asserted postcondition.                                                                                                  |
| Isolation        | Fresh fixture state, explicit seed/clock, deterministic teardown, no external network, and no dependence on execution order.                                                                                  |
| Negative control | Deliberately wrong expected state fails; withheld completion reaches the watchdog and cannot produce a pass.                                                                                                  |
| Repetition       | Default admission run: 100 consecutive executions with zero retries across at least 10 fresh isolated browser/server lifecycles. Each required GPU/backend environment contributes at least 20 of those runs. |
| Failure policy   | Any intermittent failure blocks promotion. After the causal defect is fixed, evidence restarts from zero; the suite never masks the failure with retries.                                                     |

Repeated success is supporting evidence, not a substitute for causal synchronization. Run counts, cold lifecycle count, environments, commits, probe hash, failures, and artifacts are retained with the admission record.

## CI tiers

### Pull request tier

Status: ✅ implemented by [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

The workflow installs the exact repository Node, pnpm, stable Rust, and Wasm target pins through mise, installs dependencies from the frozen lockfile, and runs `pnpm check` with headless Chromium. Third-party actions use immutable commit SHAs annotated with their verified current release. Vitexec, hardware-GPU claims, timing gates, and coverage-guided nightly fuzzing remain outside this tier.

Wasm runtime portability is verified through the generated ABI and exact source-to-product behavior. Release builds also remap checkout and Cargo paths and enforce exact optimized sizes. An exact Wasm hash identifies output from the canonical release builder: pinned native Rust/Binaryen builds on macOS arm64 and Ubuntu x64 can encode equivalent modules with different internal function-index order, even though the modules have equal length and produce byte-identical artifacts. CI retains failed Wasm outputs for seven days so any future divergence can be compared directly rather than inferred from a hash alone.

GPU framebuffer hashes are portable gates only when an independent byte-level oracle proves exact composition. Filtered analytic coverage may vary across native drivers and SwiftShader while remaining correct. MTSDF and Slug therefore require stable pixels across samples from one renderer invocation, authenticated inputs and resource invariants, and bounded error against their independent scalar CPU reconstructions; hardware-specific hashes remain labeled observations rather than CI expectations.

- formatting and package-owned unit tests;
- compiled-artifact package integration tests;
- small licensed corpus;
- HarfRust differential fixtures;
- Unicode targeted subset;
- saved fuzz regressions;
- fixed-seed Rust input and TypeScript artifact-mutation smoke tests;
- deterministic benchmark-app smoke scenarios through public APIs for CI-supported capabilities;
- no network downloads.

Target duration: short enough to be required on every PR.

### Nightly tier

- full licensed/downloadable corpus by pinned hashes;
- HarfBuzz three-way comparison;
- Unicode conformance files;
- bounded differential fuzzing;
- native/Wasm baker parity;
- visual snapshots on reference GPU/software environment.
- longer correctness-passing benchmark scenarios with retained raw results.

### Maintainer local GPU tier

- visible benchmark app driven by Vitexec/Vitest live probes;
- headed or remote Playwright reuse where it preserves the required GPU/device behavior;
- WebGPU and WebGL2 capability, upload, draw, readback, lifecycle, and visual assertions;
- screenshots, raw diffs, traces/profiles where relevant, and an exact environment manifest;
- admitted probes only: causal synchronization, zero retries, and recorded clean-run evidence;
- correctness approval before any timing sample is accepted.

### Release tier

- all nightly checks;
- browser matrix;
- package and Wasm size gates;
- GLB backward/forward compatibility fixtures;

## Allowlist rules

Every allowlisted mismatch contains:

- stable case identifier;
- affected version range;
- exact differing fields;
- reason;
- upstream issue or source citation;
- owner;
- removal condition.

There is no wildcard allowlist by script, font, or output field.

## Exit criteria for Phase 1

- The initial corpus and licenses are documented.
- Stage A differences are understood and allowlisted narrowly.
- Stage B passes exactly for supported valid fonts.
- JS/Wasm handling of UTF-16 and clusters has dedicated fixtures.
- The conformance runner emits machine-readable and human-readable diffs.
- Saved fixtures include all comparison inputs and version metadata.
