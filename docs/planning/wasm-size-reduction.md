---
type: Research Note
title: Shaper and baker Wasm size reduction
description: Measured byte attribution for the distributed Wasm artifacts, the levers that remain, and the staged-table delivery model that keeps one runtime instead of two.
status: draft
tags: [wasm, size, harfrust, unicode, tables, payload]
sources:
  - id: harfrust-277
    resource: https://github.com/harfbuzz/harfrust/issues/277
    title: 'harfrust#277 — Too much dirty data in the library'
  - id: fontations-1671
    resource: https://github.com/googlefonts/fontations/issues/1671
    title: 'fontations#1671 — DEFAULT_GLYPH_NAMES static cost'
  - id: decision-register
    resource: decision-register.md
    title: Decision register (D-242, D-243, D-244)
  - id: payload-budget
    resource: payload-budget.md
    title: Font payload budget
  - id: language-bundles
    resource: language-and-strike-bundles.md
    title: Language-aware font units and physical bitmap strikes
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-17T23:55:00Z'
---

# Shaper and baker Wasm size reduction

Status: measured attribution plus a staged delivery design. No lever here is accepted yet;
D-242, D-243, and D-244 remain the accepted optimizer decisions.

## Why this note exists

`text_shaper.wasm` is the artifact a consumer downloads to render one line of text. At the
measured baseline it is `1,122,345 B` raw, `435,781 B` gzip, `345,445 B` Brotli. Community
feedback compares that unfavourably against all of Three.js. The comparison is fair, and the
answer is not a second "minimal" runtime — two runtimes means two correctness surfaces, two
conformance lanes, and a permanent question of which one a bug reproduces on. The answer is
one runtime whose script-specific mass is delivered on demand.

## Measurement method

Every number below is from this repository's own toolchain: `wasm32-unknown-unknown`,
`--release --no-default-features`, the shaper with `simd128`, and the D-244 optimizer sandwich
`--merge-similar-functions -Oz --merge-similar-functions -Oz`. Attribution uses `twiggy top`
over builds with `strip = false` so the name section survives. Cut variants patch a vendored
HarfRust through `cargo --config patch.crates-io.harfrust.path=...`, so the repository manifest
is untouched and the control variant reproduces the unpatched artifact byte-for-byte.

Cut variants are **sizing probes, not validated builds**. They exist to price a block of
functionality, not to propose removing it.

## What the artifact is actually made of

Post-`wasm-opt` section split for the shipped shaper:

| Section | Bytes | Share | gzip |
| ------- | ----: | ----: | ---: |
| `code`  | 899,942 | 80.2% | 343,873 |
| `data`  | 220,094 | 19.6% | 84,768 |

Pre-optimizer symbol attribution (code + data, 1,238,626 B):

| Owner | Bytes | Share |
| ----- | ----: | ----: |
| `pmndrs_glyph_shaper` (this repository) | 406,572 | 32.8% |
| HarfRust (incl. generic instantiations) | 365,471 | 29.5% |
| `.rodata` data segment | 227,710 | 18.4% |
| `read-fonts` | 160,641 | 13.0% |
| everything else | ~78,000 | 6.3% |

The first row is the finding that reframes the problem. **Our own layout engine is the single
largest block, larger than HarfRust.** Within it, `engine::state` alone is `128,705 B` — 14%
of the whole artifact — followed by `stable_plan` (38,522), `ordered_plan` (23,573),
`policy` (22,034), `positioning` (19,061), and `semantic_wire` (17,714).

## Reading harfrust#277 correctly

The upstream thread ends at "probably nothing we can do." That conclusion does not transfer,
and it is important to say why rather than to inherit it.

The thread is measuring `.data.rel.ro` in a **dynamically linked ELF shared object**. That
section is a *relocation table*: for every `&'static str` in a static array, the linker emits
an 8-byte pointer plus an 8-byte length that must be fixed up at load time. Wasm has no dynamic
relocations. Static data is a data segment with immediate offsets, so the entire cost the thread
was chasing does not exist in our artifact.

Two of the thread's incidental findings are confirmed absent here:

- `read_fonts::tables::post::DEFAULT_GLYPH_NAMES` (fontations#1671) is **already dead-stripped**
  from the shaper — shaping never resolves glyph names.
- The `tag_table` language strings are **not in `.rodata`** at all. HarfRust compiles them into
  comparison *code*, which is why `tags_from_complex_language` shows up as 17,409 B of code.

What does transfer are the block sizes the thread surfaced. Those are priced below.

## Measured levers

Baseline for the deltas is the shipped artifact: `1,122,345` raw / `432,771` gzip
(as rebuilt here; the recorded evidence entry is `435,781` gzip on Justin's host).

### 1. Panic machinery — behaviour-identical

The shaper's `#[panic_handler]` already discards `PanicInfo` and traps:

```rust
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
```

Every byte spent formatting a panic message is therefore provably unobservable. Removing it via
`-Zbuild-std=core,alloc -Zunstable-options -Cpanic=immediate-abort`:

| Build | raw | gzip | Brotli |
| ----- | --: | ---: | -----: |
| shipped (stable 1.97.1) | 1,122,345 | 432,771 | 345,445 |
| nightly, no other change | 1,123,305 | 432,975 | — |
| `-Cpanic=immediate-abort` | **1,034,100** | **398,901** | **313,306** |

**−88,245 raw / −33,870 gzip / −32,139 Brotli, with no behaviour change.**
`-Zlocation-detail=none -Zfmt-debug=none` adds nothing further (+13 gzip, noise) because
immediate-abort has already made the location strings unreachable.

The cost is a toolchain policy change: this requires nightly, against a repository that pins
stable through `rust-toolchain.toml`.

A stable-toolchain equivalent was built and measured: a Binaryen post-pass that replaces the
bodies of the ten `core::panicking::*` / `rust_begin_unwind` entry points with `unreachable`
before the D-244 sandwich, so `-Oz` collects the formatting graph.

| Path | raw | gzip | share of the nightly win |
| ---- | --: | ---: | -----------------------: |
| stable + Binaryen panic stub | 1,093,370 | 420,069 | 33% raw / 37% gzip |
| nightly `-Cpanic=immediate-abort` | 1,034,100 | 398,901 | 100% |

The post-pass recovers only about a third. The gap is caller-side codegen: `immediate-abort`
also stops emitting the `Location` construction and argument marshalling at every panic site,
which no callee-body rewrite can reach — those are stores to linear memory that Binaryen cannot
prove dead. Adding `--inlining-optimizing --converge` does not help (1,094,847 raw; marginally
worse), which confirms roughly a third is the ceiling for post-processing. The stable path is
real and needs no policy change, but **this lever is worth 2.7× more on nightly**. The stubbed
module validates; it has not yet been run against the conformance lane.

**Will nightly stop being required?** Not on a schedule anyone can plan around. Two independently
unstable features stack here:

- `-Cpanic=immediate-abort` has an open tracking issue (rust#147286) whose two checklist items —
  "Select a name?" and "Declare stabilization?" — are both still unchecked, with the flag's final
  name an explicitly unresolved question. It was recently promoted from a `-Zbuild-std-features`
  flag to a real panic strategy, which is genuine forward motion, but no stabilization has been
  proposed.
- It requires `-Zbuild-std` regardless, because a precompiled `core`/`alloc` still carries the
  formatting machinery. `build-std` has been unstable since 2019 with no stabilization report.

Treat this as a **standing nightly dependency for the shipped artifact**, not as a wait. If that
is unacceptable, the stable post-pass is the permanent answer at a third of the value.

### 2. HarfRust block pricing

Each cut is measured on top of lever 1 (control: 1,034,100 / 398,892).

| Cut | raw | Δ raw | gzip | Δ gzip |
| --- | --: | ----: | ---: | -----: |
| control | 1,034,100 | — | 398,892 | — |
| AAT — `morx`/`kerx`/`trak`/`ankr`/`feat`, **legacy `kern` retained** | 977,913 | −56,187 | 380,350 | −18,542 |
| AAT — legacy `kern` dropped as well | 975,276 | −58,824 | 379,351 | −19,541 |
| `tag_table::tags_from_complex_language` | 1,020,037 | −14,063 | 395,716 | −3,176 |
| complex-script shapers (Indic, Khmer, Myanmar, USE, Arabic, Hangul, Hebrew, Thai, vowel constraints) | 908,286 | −125,814 | 359,248 | −39,644 |
| all three | **835,403** | **−198,697** | **336,541** | **−62,351** |

The two AAT rows must not be conflated. HarfRust reaches the legacy OpenType `kern` table through
`AatCache`/`AatTables` even though `kern` is not an AAT-only table, so the naive "cut AAT" patch
silently removes `kern` kerning — a visible regression on the many older web fonts that kern
through `kern` rather than GPOS. **The correct AAT cut is the first row**: retaining `kern` costs
2,637 raw / 999 gzip and is not optional. The combined row above still uses the naive cut and is
therefore ~2.6 KB optimistic.

Levers 1 and 2 together take the shaper from `1,122,345 / 432,771` to `835,403 / 336,541`:
**−25.6% raw, −22.2% gzip**, with Brotli at `269,494`.

### 2a. Which HarfRust cuts need a fork, and which do not

A source patch is not the only way to remove a block. The same Binaryen post-pass used for
panics can stub any function that still exists as a distinct call target after LTO, letting
`-Oz` collect the subgraph behind it. (`wasm-snip` is the purpose-built tool for this; it uses
the same mechanism and has the same limit. `twiggy` is analysis-only and cannot strip.)

The limit is not the tooling — it is whether LTO left a seam:

| Block | survives LTO as a callable seam? | post-build Δ raw | vs source patch |
| ----- | -------------------------------- | ---------------: | --------------: |
| `tags_from_complex_language` | yes, one function | **−18,234** (gzip −4,694) | **fully recoverable, no fork** |
| AAT | only `layout_morx_table::apply` | −17,142 (gzip −5,355) | 31% |

`tags_from_complex_language` is a single leaf function and is strippable from the shipped
artifact today with no HarfRust change at all — but **stripping it is not unconditionally
behaviour-preserving**, and the language payload is what makes it so. See below.

### 2b. The language path, and why the payload unlocks it

`language` is a public style property (`text-properties.ts:59`), optional and unset by default,
plumbed through the wire to the HarfRust plan (`lib.rs:427`). So the default path never *calls*
language resolution, but always *links* it.

HarfRust resolves in two stages (`hb/tag.rs:189`): `tags_from_complex_language` first — a
17,409 B `match` handling multi-subtag cases like `zh-Hant → ZHT`, `sr-Latn`, `-fonnapa` — then a
binary search over `OPEN_TYPE_LANGUAGES`, a 1,662-entry sorted table, for simple subtags. Naively
stubbing the first stage therefore silently degrades `zh-Hant` to `zh`, the wrong OpenType tag for
Traditional Chinese, which is precisely the case where language selection matters most. It is not
a safe unconditional strip.

**HarfRust honours HarfBuzz's `-x-hbot<TAG>` private-use subtag.** When the language string
carries one, `parse_private_use_subtag` returns true, `needs_language` becomes false, and
`tags_from_language` is **never called at all** (`hb/tag.rs:76-80`) — neither stage runs. Our
`valid_language_bytes` already accepts that form.

That is exactly the seam the external language payload wants. The payload owns BCP-47 → OpenType
tag resolution as a data table — which is the representation we want regardless — and the runtime
hands HarfRust `zh-x-hbotZHT`. Resolution inside HarfRust then becomes provably dead code rather
than merely unused, and stripping it is a no-op by construction.

| Scope | Δ raw | Δ gzip | reachable how |
| ----- | ----: | -----: | ------------- |
| `tags_from_complex_language` only | −14,063 (src) / **−18,234** (post-build) | −3,176 / **−4,694** | post-build stub, no fork |
| **all language resolution** (adds the 1,662-entry table) | **−27,912** | **−10,511** | needs an `#[inline(never)]` seam |

The full bypass is worth roughly **twice** the complex function alone. Post-build tooling reaches
only the first row, because `tags_from_language` and the `OPEN_TYPE_LANGUAGES` binary search were
both inlined by LTO. The remaining ~9,700 B needs one `#[inline(never)]` in a fork, or an upstream
change — a small ask, and a natural companion to the `aat` feature.

AAT is not, because `layout_kerx_table::apply`, `layout_trak_table::apply`, and the
`aat::layout::{substitute,position,track}` dispatch wrappers were all inlined away by
`lto = true` + `codegen-units = 1`, leaving no seam to stub. The remaining 69% lives in
`aat::map`, the subtable-cache constructors, and inlined kerx/trak bodies. Recovering it needs
either `#[inline(never)]` seams or real feature gates — both of which are HarfRust source
changes, so the fork is unavoidable for AAT.

Since HarfRust has no feature gates at all (the gap harfrust#277 is fundamentally about), a
`aat` cargo feature — default-on upstream, off for us — is a small and plausibly welcome
upstream contribution. A `[patch.crates-io]` fork is the bridge while that lands, not a
permanent parallel codebase.

### 3. The optimizer is exhausted

`--converge`, `--gufa`, `--code-folding`, `--dae-optimizing`, `--signature-pruning`, and
`--signature-refining` were each measured against the D-244 sandwich. Every variant lands within
±100 bytes, and `--converge` makes gzip marginally *worse*. This confirms D-244 and closes the
pass-ordering lever. D-242 already closed `opt-level`.

### 4. Static Unicode tables in this repository

Our own generated tables, measured from their declarations:

| Table | Bytes |
| ----- | ----: |
| `SCRIPT_EXTENSION_END_VALUES` `[u32; 3,764]` | 15,056 |
| `BIDI_CLASS_RANGES` `[(u32,u32,BidiClass); 1,267]` | 15,204 |
| `SCRIPT_END_VALUES` `[u32; 3,434]` | 13,736 |
| `LINE_BREAK_END_VALUES` `[u32; 5,624]` | 22,496 |
| `SCRIPT_EXTENSION_TAGS` `[u32; 702]` | 2,808 |
| `SCRIPT_EXTENSION_OFFSETS` `[u32; 285]` | 1,140 |
| `BIDI_BRACKETS` `[(u32,u32,bool); 128]` | 1,152 |
| **total** | **71,592** |

That is 45% of the `.rodata` remaining after every HarfRust cut. The encoding is naive: a flat
`u32` per boundary and a full 4-byte FourCC per script, repeated for every range. A delta-varint
boundary stream plus a byte index into a deduplicated tag table measures, on `SCRIPT_END_VALUES`:

| Encoding | raw | gzip |
| -------- | --: | ---: |
| current `[u32]` | 13,736 | 4,423 |
| delta-varint + byte index (175 distinct tags) | **4,225** | **2,602** |

−69% raw, −41% gzip, and it applies to every table in the list.

**This is not free, and the cost is lookup latency.** These tables are random-accessed, not
scanned: `unicode::script` goes through `lookup_partition` (a `partition_point` binary search),
and `bidi::class` uses `binary_search_by_key`. A varint stream has no O(1) indexing, so decoding
in place would turn every property lookup into a linear scan — a per-codepoint regression on the
hottest pre-shaping path. Three options, in preference order:

1. **Decode once at module init into the existing flat arrays.** Lookup code and complexity are
   untouched — the binary search runs against exactly the representation it runs against today.
   The cost is `71,592 B` of heap that is currently `.rodata`, plus one linear decode pass at
   startup. This trades wasm bytes for resident bytes, which is the right trade for a download
   complaint but must be stated plainly rather than presented as a pure win.
2. **Block-indexed varint**: varint deltas in blocks of 64 with a sparse `u32` index per block.
   Keeps O(log n) — binary-search the sparse index, then scan ≤64 entries — at roughly half the
   saving and no heap cost. The right choice if init time or memory turns out to matter.
3. Decode in place with a linear scan. Rejected; listed only so it is not rediscovered.

Option 1 should be measured against the 22k-glyph lanes before adoption: the decode pass lands
in cold-start, which is already a reported lane, so a regression there would show up immediately.

## The staged-table model

Levers 1–4 are worth roughly 300 KB raw. They do not by themselves answer the "one runtime"
question, because the complex-script cut in lever 2 removes *behaviour*, not just data. The
architecture that keeps one runtime is to stop compiling script-specific mass into the module
and start delivering it beside the font.

The blocks split cleanly by what they actually are:

```
                     ┌─ pure data ────────────────┐   externalize as payload
  script properties  │ SCRIPT_*, BIDI_*, LINE_BREAK_*   71,592 B  │
  HarfRust ucd/use/indic/arabic tables                            │
                     └────────────────────────────┘

                     ┌─ generated code ───────────┐   needs a data-driven
  USE / Indic / Khmer / Myanmar state machines     │   interpreter first
  tags_from_complex_language (17,409 B of `match`) │
                     └────────────────────────────┘

                     ┌─ real machinery ───────────┐   stays resident
  GSUB/GPOS application, buffer, normalization     │
                     └────────────────────────────┘
```

Three consequences follow, and the middle one is the load-bearing design problem:

1. **Property tables are payloads today.** `SCRIPT_*`, `BIDI_*`, `LINE_BREAK_*`, and HarfRust's
   `ucd_table` are pure lookup structures. They can ship as versioned, hash-identified binary
   units resolved the same way [language-aware font units](language-and-strike-bundles.md)
   resolves coverage, and they compress far better as a standalone payload than as `.rodata`
   fragments (lever 4 measures the encoding win independently of delivery).

2. **State machines are code, not tables.** The Indic/USE/Khmer/Myanmar shapers are Ragel-
   generated transition functions. Externalizing them requires a data-driven table interpreter in
   the runtime — a bounded, well-understood piece of work, and the same interpreter serves every
   script. Until it exists, "external tables" cannot reach the `125,814 B` that the complex-shaper
   cut prices. This is the gate on the whole plan and should be scheduled as such.

3. **`tags_from_complex_language` is misclassified.** It is a `match` over ~800 BCP-47 subtags,
   emitted as 17,409 B of comparison code. As a sorted table with a binary search it is a few
   kilobytes of data and belongs in the language payload. This one is behaviour-preserving and
   can land ahead of the interpreter.

Delivery follows the existing font-unit story: the shaper declares which table units a paragraph
needs from the scripts already segmented by the engine, the host resolves them through the same
directory that resolves font units, and a paragraph that is pure Latin never fetches the Indic
unit. The failure mode must be explicit — an unresolved table unit reports missing coverage
before drawing, exactly as an unresolved font unit does.

## The other half: our own engine, and why it is large

No table plan touches the 406,572 B of `pmndrs_glyph_shaper`. After every HarfRust cut it is
**46% of the remaining artifact**, with `engine::state` at `128,705 B`.

### Isolating our own code: engine at `opt-level = "z"`

D-242's four-variant matrix (whole-`z`, dependency-`z`, HarfRust-family-`s`, whole-`s`) never
measured the one cell that isolates our own code: **engine crate at `opt-level = "z"`, every
dependency left at `3`**. It is reachable on the stable toolchain with
`--config 'profile.release.opt-level="z"' --config 'profile.release.package."*".opt-level=3'`.

The size half is deterministic and stands:

| | raw | gzip |
| --- | --: | ---: |
| engine=3 (shipped) | 1,122,345 | 432,771 |
| engine=z | 1,013,270 | 396,702 |
| | **−109,075 (−9.7%)** | **−36,069 (−8.3%)** |

That is a larger byte win than the nightly panic lever, from one profile line on stable.

**The speed half is NOT yet measured.** A first attempt ran on a host at 8% battery, discharging,
with macOS reporting an early battery warning. Apple Silicon biases scheduling toward efficiency
cores under battery pressure, and the two runs were sequential with a full Cargo build between
them, so the candidate ran at a lower charge than the baseline — a bias that inflates the
apparent regression by an unknown amount. Those timings are discarded rather than recorded here.

This project has already been bitten by exactly this failure mode: D-248 notes that "earlier
apparent regressions reproduced on the checkpoint under ambient load". The measurement protocol
below exists because of it.

### Measurement protocol for any size-versus-speed claim

1. AC power, Low Power Mode off, no concurrent builds or agents on the host.
2. **Same-window interleaved A/B** — alternate baseline and candidate within one session rather
   than running one after the other, so drift and thermal state affect both equally. Sequential
   whole-run comparison is not acceptable evidence.
3. 8 warmup / ≥31 measured, comparing medians only. `column-resize` and `localized-edit` ran at
   46% and 70% RSD even on a quiet host, so single samples in those lanes mean nothing; `no-op`
   and `measure-query` are the tight lanes.
4. `benchmark-rust-layout-engine.mjs` accepts `--wasm <path>`, so candidates are compared without
   rebuilding `dist`.

Until that runs, the standing prior is D-242's: size levels regressed shaping-bound lanes by
22–98%, and warm planner lanes stayed within noise only while the engine crate kept `3`. The
engine-`z` cell is expected to cost real time, but **how much is unmeasured**, and the 9.7% is
not claimable as rejected or accepted until it is.

### What this implies for the audit either way

The criterion for size work in our own code holds regardless of the exact number: **remove
duplication that `-O3` is not exploiting; never remove specialization that it is.** A change that
merely gives the optimizer less to work with will show up as a lane regression under the protocol
above.

D-243 (shared sort kernel) and D-244 are the only code-shape work recorded, and both targeted
HarfRust-adjacent code. A duplication audit of `engine::state`, the `stable_plan`/`ordered_plan`
pair, `semantic_wire`, and `bidi::analyze_into` is the largest unexamined surface in the artifact
and should be priced before any upstream HarfRust fork is contemplated.

## Portable baker

`font_baker.wasm` is `1,081,312 B` raw / `386,725 B` gzip. Its 2.6× step at `285475b4`
(422,538 → 1,097,702) is fully explained: the Wasm build invocation gained
`--features subsetting`, where `subsetting = ["std", "dep:skera"]`.

| Build | raw | gzip |
| ----- | --: | ---: |
| core (`no_std`, no subsetting) | 488,569 | 171,246 |
| `+ std` | 550,492 | 189,286 |
| `+ skera` (shipped) | 1,082,576 | 386,748 |

`std` costs `+61,923`; **skera costs `+532,084` raw / `+197,462` gzip.** `read-fonts` is 43.4%
of the artifact, and `read_fonts::ps::cs` — the CFF charstring interpreter — is `177,970 B` of
that alone.

The runtime consequence is that browsers pay for subsetting unconditionally and use it
conditionally: `prepare` is called only when `unicodeRanges` is supplied
([`font-bake-pipeline.ts:41`](../../packages/glyph/src/internal/font-bake-pipeline.ts)), and
`inspect` is Node/CLI-only. `inspect_font` needs only `skrifa`; `prepare_font` is skera's sole
consumer. Splitting the subsetting entry points into a lazily fetched second module leaves the
common runtime bake path at `488,569 / 171,246` — **−55% raw, −56% gzip on the default download.**

Separately, the shaper links `read-fonts 0.41.0` while the baker links `0.42.1`; unifying them
is a prerequisite for any shared-artifact consolidation.

## Sequencing

| Order | Work | Measured value | Gate |
| ----- | ---- | -------------- | ---- |
| 1 | Panic machinery removal | −88,245 raw / −33,870 gzip on nightly; −28,975 / −12,702 via the stable post-pass (shaper alone; applies to all five artifacts) | nightly pin decision, weighed against the 2.7× gap |
| 2 | Lazy subsetting module | −593,743 raw / −215,502 gzip on the default baker download | public export surface change |
| 3 | Language payload owns BCP-47 → OT tags; emit `-x-hbot`, then strip resolution | −18,234 raw / −4,694 gzip post-build; **−27,912 / −10,511** with one `#[inline(never)]` | the payload must land first — stripping before it silently degrades `zh-Hant` |
| 4 | Unicode table re-encoding, decode at init | ~−45,000 raw / ~−18,000 gzip estimated from the measured `SCRIPT_END_VALUES` ratio | cold-start lane must hold; costs ~71,592 B of heap |
| 5 | `engine::state` size audit | unpriced; 406,572 B surface | none — pure measurement first |
| 6 | AAT removal | −56,187 raw / −18,542 gzip (**legacy `kern` retained**) | 31% post-build; the rest needs an `aat` cargo feature upstream or in a fork |
| 7 | Data-driven syllabic interpreter | unlocks −125,814 raw / −39,644 gzip as payload | correctness parity against the HarfBuzz oracle |

Steps 1–4 need no HarfRust source change (step 3 gets two-thirds of its value without one, and
all of it with a single `#[inline(never)]`). Step 3 is the first place the external-payload
architecture pays for itself in bytes rather than only in future flexibility, which argues for
pulling the language payload earlier than its current Milestone 17 position.

Steps 3 and 6 share one upstream ask: HarfRust has no cargo features at all, which is the gap
harfrust#277 is fundamentally about. Contributing an `aat` feature and an inlining seam on the
language path serves upstream's own stated size problem rather than forking away from it. Step 7
is the one that lets a single runtime serve every script without shipping every script.
