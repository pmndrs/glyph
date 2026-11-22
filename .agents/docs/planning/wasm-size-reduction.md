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

`text-shaper.wasm` is the artifact a consumer downloads to render one line of text. At the
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

| Section |   Bytes | Share |    gzip |
| ------- | ------: | ----: | ------: |
| `code`  | 899,942 | 80.2% | 343,873 |
| `data`  | 220,094 | 19.6% |  84,768 |

Pre-optimizer symbol attribution (code + data, 1,238,626 B):

| Owner                                   |   Bytes | Share |
| --------------------------------------- | ------: | ----: |
| `pmndrs_glyph_shaper` (this repository) | 406,572 | 32.8% |
| HarfRust (incl. generic instantiations) | 365,471 | 29.5% |
| `.rodata` data segment                  | 227,710 | 18.4% |
| `read-fonts`                            | 160,641 | 13.0% |
| everything else                         | ~78,000 |  6.3% |

The first row is the finding that reframes the problem. **Our own layout engine is the single
largest block, larger than HarfRust.** Within it, `engine::state` alone is `128,705 B` — 14%
of the whole artifact — followed by `stable_plan` (38,522), `ordered_plan` (23,573),
`policy` (22,034), `positioning` (19,061), and `semantic_wire` (17,714).

## Reading harfrust#277 correctly

The upstream thread ends at "probably nothing we can do." That conclusion does not transfer,
and it is important to say why rather than to inherit it.

The thread is measuring `.data.rel.ro` in a **dynamically linked ELF shared object**. That
section is a _relocation table_: for every `&'static str` in a static array, the linker emits
an 8-byte pointer plus an 8-byte length that must be fixed up at load time. Wasm has no dynamic
relocations. Static data is a data segment with immediate offsets, so the entire cost the thread
was chasing does not exist in our artifact.

Two of the thread's incidental findings are confirmed absent here:

- `read_fonts::tables::post::DEFAULT_GLYPH_NAMES` (fontations#1671) is **already dead-stripped**
  from the shaper — shaping never resolves glyph names.
- The `tag_table` language strings are **not in `.rodata`** at all. HarfRust compiles them into
  comparison _code_, which is why `tags_from_complex_language` shows up as 17,409 B of code.

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

| Build                     |           raw |        gzip |      Brotli |
| ------------------------- | ------------: | ----------: | ----------: |
| shipped (stable 1.97.1)   |     1,122,345 |     432,771 |     345,445 |
| nightly, no other change  |     1,123,305 |     432,975 |           — |
| `-Cpanic=immediate-abort` | **1,034,100** | **398,901** | **313,306** |

**−88,245 raw / −33,870 gzip / −32,139 Brotli, with no behaviour change.**
`-Zlocation-detail=none -Zfmt-debug=none` adds nothing further (+13 gzip, noise) because
immediate-abort has already made the location strings unreachable.

The cost is a toolchain policy change: this requires nightly, against a repository that pins
stable through `rust-toolchain.toml`.

A stable-toolchain equivalent was built and measured: a Binaryen post-pass that replaces the
bodies of the ten `core::panicking::*` / `rust_begin_unwind` entry points with `unreachable`
before the D-244 sandwich, so `-Oz` collects the formatting graph.

| Path                              |       raw |    gzip | share of the nightly win |
| --------------------------------- | --------: | ------: | -----------------------: |
| stable + Binaryen panic stub      | 1,093,370 | 420,069 |       33% raw / 37% gzip |
| nightly `-Cpanic=immediate-abort` | 1,034,100 | 398,901 |                     100% |

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

| Cut                                                                                                  |         raw |        Δ raw |        gzip |      Δ gzip |
| ---------------------------------------------------------------------------------------------------- | ----------: | -----------: | ----------: | ----------: |
| control                                                                                              |   1,034,100 |            — |     398,892 |           — |
| AAT — `morx`/`kerx`/`trak`/`ankr`/`feat`, **legacy `kern` retained**                                 |     977,913 |      −56,187 |     380,350 |     −18,542 |
| AAT — legacy `kern` dropped as well                                                                  |     975,276 |      −58,824 |     379,351 |     −19,541 |
| `tag_table::tags_from_complex_language`                                                              |   1,020,037 |      −14,063 |     395,716 |      −3,176 |
| complex-script shapers (Indic, Khmer, Myanmar, USE, Arabic, Hangul, Hebrew, Thai, vowel constraints) |     908,286 |     −125,814 |     359,248 |     −39,644 |
| all three                                                                                            | **835,403** | **−198,697** | **336,541** | **−62,351** |

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

| Block                        | survives LTO as a callable seam? |          post-build Δ raw |                vs source patch |
| ---------------------------- | -------------------------------- | ------------------------: | -----------------------------: |
| `tags_from_complex_language` | yes, one function                | **−18,234** (gzip −4,694) | **fully recoverable, no fork** |
| AAT                          | only `layout_morx_table::apply`  |     −17,142 (gzip −5,355) |                            31% |

`tags_from_complex_language` is a single leaf function and is strippable from the shipped
artifact today with no HarfRust change at all — but **stripping it is not unconditionally
behaviour-preserving**, and the language payload is what makes it so. See below.

### 2b. The language path, and why the payload unlocks it

`language` is a public style property (`text-properties.ts:59`), optional and unset by default,
plumbed through the wire to the HarfRust plan (`lib.rs:427`). So the default path never _calls_
language resolution, but always _links_ it.

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

| Scope                                                    |                                    Δ raw |              Δ gzip | reachable how                    |
| -------------------------------------------------------- | ---------------------------------------: | ------------------: | -------------------------------- |
| `tags_from_complex_language` only                        | −14,063 (src) / **−18,234** (post-build) | −3,176 / **−4,694** | post-build stub, no fork         |
| **all language resolution** (adds the 1,662-entry table) |                              **−27,912** |         **−10,511** | needs an `#[inline(never)]` seam |

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
±100 bytes, and `--converge` makes gzip marginally _worse_. This confirms D-244 and closes the
pass-ordering lever. D-242 already closed `opt-level`.

### 4. Static Unicode tables in this repository

Our own generated tables, measured from their declarations:

| Table                                              |      Bytes |
| -------------------------------------------------- | ---------: |
| `SCRIPT_EXTENSION_END_VALUES` `[u32; 3,764]`       |     15,056 |
| `BIDI_CLASS_RANGES` `[(u32,u32,BidiClass); 1,267]` |     15,204 |
| `SCRIPT_END_VALUES` `[u32; 3,434]`                 |     13,736 |
| `LINE_BREAK_END_VALUES` `[u32; 5,624]`             |     22,496 |
| `SCRIPT_EXTENSION_TAGS` `[u32; 702]`               |      2,808 |
| `SCRIPT_EXTENSION_OFFSETS` `[u32; 285]`            |      1,140 |
| `BIDI_BRACKETS` `[(u32,u32,bool); 128]`            |      1,152 |
| **total**                                          | **71,592** |

That is 45% of the `.rodata` remaining after every HarfRust cut. The encoding is naive: a flat
`u32` per boundary and a full 4-byte FourCC per script, repeated for every range. A delta-varint
boundary stream plus a byte index into a deduplicated tag table measures, on `SCRIPT_END_VALUES`:

| Encoding                                      |       raw |      gzip |
| --------------------------------------------- | --------: | --------: |
| current `[u32]`                               |    13,736 |     4,423 |
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
question, because the complex-script cut in lever 2 removes _behaviour_, not just data. The
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

|                    |                  raw |                gzip |
| ------------------ | -------------------: | ------------------: |
| engine=3 (shipped) |            1,122,345 |             432,771 |
| engine=z           |            1,013,270 |             396,702 |
|                    | **−109,075 (−9.7%)** | **−36,069 (−8.3%)** |

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
4. `benchmark:labs-internal -- --suite engine --wasm <path>` accepts an explicit shaper artifact, so candidates are
   compared without rebuilding `dist`.

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

`font-baker.wasm` is `1,081,312 B` raw / `386,725 B` gzip. Its 2.6× step at `285475b4`
(422,538 → 1,097,702) is fully explained: the Wasm build invocation gained
`--features subsetting`, where `subsetting = ["std", "dep:skera"]`.

| Build                          |       raw |    gzip |
| ------------------------------ | --------: | ------: |
| core (`no_std`, no subsetting) |   488,569 | 171,246 |
| `+ std`                        |   550,492 | 189,286 |
| `+ skera` (shipped)            | 1,082,576 | 386,748 |

`std` costs `+61,923`; **skera costs `+532,084` raw / `+197,462` gzip.** `read-fonts` is 43.4%
of the artifact, and `read_fonts::ps::cs` — the CFF charstring interpreter — is `177,970 B` of
that alone.

The runtime consequence is that browsers pay for subsetting unconditionally and use it
conditionally: `prepare` is called only when `unicodeRanges` is supplied
([`font-bake-pipeline.ts:41`](../../../packages/glyph/src/internal/font-bake-pipeline.ts)), and
`inspect` is Node/CLI-only. `inspect_font` needs only `skrifa`; `prepare_font` is skera's sole
consumer. Splitting the subsetting entry points into a lazily fetched second module leaves the
common runtime bake path at `488,569 / 171,246` — **−55% raw, −56% gzip on the default download.**

Separately, the shaper links `read-fonts 0.41.0` while the baker links `0.42.1`; unifying them
is a prerequisite for any shared-artifact consolidation.

## Sequencing

| Order | Work                                                                          | Measured value                                                                                                                  | Gate                                                                          |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Panic machinery removal                                                       | −88,245 raw / −33,870 gzip on nightly; −28,975 / −12,702 via the stable post-pass (shaper alone; applies to all five artifacts) | nightly pin decision, weighed against the 2.7× gap                            |
| 2     | Lazy subsetting module                                                        | −593,743 raw / −215,502 gzip on the default baker download                                                                      | public export surface change                                                  |
| 3     | Language payload owns BCP-47 → OT tags; emit `-x-hbot`, then strip resolution | −18,234 raw / −4,694 gzip post-build; **−27,912 / −10,511** with one `#[inline(never)]`                                         | the payload must land first — stripping before it silently degrades `zh-Hant` |
| 4     | Unicode table re-encoding, decode at init                                     | ~−45,000 raw / ~−18,000 gzip estimated from the measured `SCRIPT_END_VALUES` ratio                                              | cold-start lane must hold; costs ~71,592 B of heap                            |
| 5     | `engine::state` size audit                                                    | unpriced; 406,572 B surface                                                                                                     | none — pure measurement first                                                 |
| 6     | AAT removal                                                                   | −56,187 raw / −18,542 gzip (**legacy `kern` retained**)                                                                         | 31% post-build; the rest needs an `aat` cargo feature upstream or in a fork   |
| 7     | Data-driven syllabic interpreter                                              | unlocks −125,814 raw / −39,644 gzip as payload                                                                                  | correctness parity against the HarfBuzz oracle                                |

Steps 1–4 need no HarfRust source change (step 3 gets two-thirds of its value without one, and
all of it with a single `#[inline(never)]`). Step 3 is the first place the external-payload
architecture pays for itself in bytes rather than only in future flexibility, which argues for
pulling the language payload earlier than its current Milestone 17 position.

Steps 3 and 6 share one upstream ask: HarfRust has no cargo features at all, which is the gap
harfrust#277 is fundamentally about. Contributing an `aat` feature and an inlining seam on the
language path serves upstream's own stated size problem rather than forking away from it. Step 7
is the one that lets a single runtime serve every script without shipping every script.

## 2026-11-22 pass

Branch `experiments/sil-size` from `sil-green-40` (`904ec2b9`). Levers 1 (`-Cpanic=immediate-abort` with
`-Zbuild-std`, through `RUSTC_BOOTSTRAP` on the pinned compiler) and the AAT cut with legacy `kern` retained were
already on the branch. Every size below is the shipped `text-shaper.wasm` built by the package build's own flags
(`scripts/support/shaper-build.mjs`) into an isolated target; gzip is level 9 and Brotli is quality 11.

### Where the artifact grew

`sil-green-40` ships `1,719,376` raw / `676,672` gzip / `516,882` Brotli: `code` `1,466,728` (`581,440` gzip) and
`data` `247,935` (`85,439` gzip). The August baseline above was `1,122,345` before levers 1 and AAT, which together
were priced at about `−144,000` raw, so the shaper has grown by roughly `740,000` raw since this note was written.

Attribution is `twiggy top` over the same build with names kept (`CARGO_PROFILE_RELEASE_STRIP=false`, `wasm-opt -g`;
`1,719,608` B excluding the name section, within 0.02% of the shipped bytes). Unlike the August table these are
post-optimizer function bodies, so inlined callees count toward their caller.

| Owner                                               |   Bytes | Share |
| --------------------------------------------------- | ------: | ----: |
| `pmndrs_glyph_shaper` functions and exports         | 903,100 | 52.5% |
| `core`/`alloc` instantiated over shaper types       |  73,724 |  4.3% |
| data segments                                       | 247,933 | 14.4% |
| HarfRust, with instantiations over its types        | 259,327 | 15.1% |
| `read-fonts`, with instantiations over its types    | 164,422 |  9.6% |
| `core`/`alloc`/`compiler_builtins`, not generic     |  20,383 |  1.2% |
| `unicode-bidi`, `unicode-segmentation`, `smallvec`… | ~32,000 |  1.9% |

Our engine went from `406,572` B (August, pre-optimizer) to about `977,000` B and is now 57% of the module; it is
nearly all of the growth. By module (functions whose name places them there, instantiations included):
`engine::state` 291,412; `positioning` 73,449; `retained_rope` 67,945; `cluster_state` 56,740; `codec_gather`
52,361; `ordered_plan` 33,745; `flow_composition` 31,856; `editing` 26,593; `unicode` 25,732; `outline` 25,615;
`bidi` 22,132; `placement_slot_arena` 21,768; `codec` 20,570; `line_composition` 19,662; `inline_leaf` 19,160;
`layout_query` 19,022. The largest single bodies are `PlannerState::prepare_upsert` (43,478),
`OrderedPlanCompiler::prepare_internal` (21,794) and `PositionedGlyphArena::build_lines` (16,856).

The data segments, mapped by linking with `--no-merge-data-segments`:

| Data                                                                                                                        |   Bytes |
| --------------------------------------------------------------------------------------------------------------------------- | ------: |
| our Unicode tries (script 29.4k, line break 23.1k, bidi 19.3k, kernel ~10k, script extensions ~7k)                          | ~90,000 |
| `unicode-segmentation` range tables (word 29,940, grapheme 19,416, sentence 13,200), `(char, char, u8)` rows padded to 12 B |  62,556 |
| HarfRust `ucd_table` (`u16` 21,568, `u8` 19,845, decomposition maps ~7k)                                                    | ~48,000 |
| HarfRust USE/Indic/Myanmar machines and tables                                                                              | ~17,000 |
| HarfRust `OPEN_TYPE_LANGUAGES`                                                                                              |  11,464 |

HarfRust by module: `ot_shape` 49,147, `ot` 26,967, `ot_shaper_use` 19,656, `ot_shaper_indic` 17,257,
`ot_shaper_vowel_constraints` 13,163, `face` 13,038, `tag_table` 12,706, `ot_shaper_arabic` 12,226. `read-fonts`:
`tables::layout` 43,328, `gpos` 20,258, `gsub` 17,081, `ps::cs` 16,018 (the CFF charstring interpreter the outline
module uses), `ps::cff::dict` 7,906. Generic duplication `twiggy monos` reports above 4 kB: unstable quicksort over five
element types (20,850, 14,712 of it bloat), stable quicksort over HarfRust map types (19,795), drop glue (16,733),
`retained_rope::update_ordered_node` over five node types (13,929), and `append_measurement_from_occurrences_source`
over two closures (11,768).

### Cuts

| Cut                               | Commit     |       raw |   Δ raw |    gzip | Δ gzip |  Brotli | Δ Brotli |
| --------------------------------- | ---------- | --------: | ------: | ------: | -----: | ------: | -------: |
| control `sil-green-40`            | `904ec2b9` | 1,719,376 |       — | 676,672 |      — | 516,882 |        — |
| language resolution in the shaper | `e8a60ecf` | 1,701,737 | −17,639 | 671,831 | −4,841 | 513,742 |   −3,140 |

**Language resolution (research step 3).** The fork gained a default-on `language-tags` feature that owns
`tag_table` and `tags_from_language`, and `ShapePlan::new_with_language_tags`, which takes the language-system tags
from the caller. The shaper builds HarfRust without the feature, so resolution is not stripped after the fact but
never compiled. `rust/shaper/src/language_tags.rs` resolves instead, from tables
`scripts/generate-language-tag-data.mjs` generates out of the vendored `tag_table.rs` (checked by
`unicode check-data`): the 148 complex rules as one byte stream interpreted in order, and the 1,433 table rows as a
varint stream with a 23-entry block index, so lookup stays a binary search plus a scan of at most 64 rows. It runs only
when a plan is built for a run that sets `language`, which the default path never does. A differential test compares it
with HarfRust's own resolution (`harfrust::opentype_language_tags`, enabled for tests only) over every one-to-three
letter word, every rule and table key with 26 suffixes and three prefixes, truncations, private-use and irregular forms,
and 200,000 seeded random tags; two deliberate mutations (the last-row bound and the block search) each fail it.

The research proposed handing HarfRust `<lang>-x-hbot<TAG>`. That is not behaviour-identical, for two reasons the
differential test would have caught: HarfRust resolves up to three candidate tags (`zh-Hant-MO` is `ZHTM`, then `ZHH`)
and GSUB and GPOS each take the first one the font has, while `-x-hbot` carries one; and a three-letter fallback such as
`i-a` resolves to `I-A `, which a private-use subtag cannot spell. Passing the tags beside the language avoids both.

The net is about half the research's `−10,511` gzip, because that figure removed resolution without replacing its table:
the replacement data is ~7.3 kB raw / ~4.2 kB gzip and its interpreter ~2.5 kB raw. Delivering the table as an
on-demand payload (fetched the first time a run sets `language`) would recover that remainder from the default download;
it needs an asynchronous path the shaper does not have today.

Speed, interleaved with the 2026-11-22 headline harness (base and candidate consumers built from one package, differing
only in `text-shaper.wasm`; 7 fresh-browser loads per arm; host load average 5 to 22 from other lanes): every row's
ranges overlap and no ratio reaches the 10% verdict threshold. Headline workloads never set `language`, so no changed code
runs on them. `latin15k` sweep read +2.3% and then +3.9% total (layout +4% and +9%, about 20 to 40 µs) across two runs
with fully overlapping ranges; this is not resolvable on a loaded host and should be repeated on a quiet one. Oracles
(native and wasm, full tier) are green without a re-freeze.

After the merge with `sil-green-43` (`86afe793c`, `1,726,075` raw / `682,851` gzip / `522,919` Brotli, of which the
language cut still accounts for `−17,647` / `−4,816` / `−3,050`), each later cut is measured against the one before it:

| Cut                                                             | Commit                   |   Δ raw |  Δ gzip | Δ Brotli |
| --------------------------------------------------------------- | ------------------------ | ------: | ------: | -------: |
| placement run lookup through the shared `u64` sort kernel       | `464e046a3`              |  −6,383 |  −2,048 |   −1,933 |
| one measurement record writer, glyph source as `&mut dyn FnMut` | `0d589655c`              |  −5,575 |  −2,625 |   −1,620 |
| fork `variations` feature off (default instance only)           | `7d8ad3bc2`              | −13,165 |  −5,151 |   −4,837 |
| fork `FontInstance` support only with `experimental_font_api`   | `1faf6a1e4`              | −12,722 |  −2,534 |   −1,317 |
| glyph-outline decoding moved to the font baker                  | `05426b7c7`, `54714cd2e` | −62,603 | −23,502 |  −17,858 |

### Monomorphization (research step 5)

`twiggy monos` over the named build of `86afe793c`: generics with more than one instantiation hold `201,647` B, of which
`113,315` B are duplicate copies (everything but the largest instantiation of each generic). By the generic's owner:
`core`/`alloc` `89,603` total / `59,906` duplicate (sorts, drop glue and collection code instantiated over our types),
ours `94,401` / `42,770`, HarfRust `8,553` / `5,587`, read-fonts `7,633` / `4,480`. The largest duplicate groups:

| Generic                                                                                | Duplicate |  Total |
| -------------------------------------------------------------------------------------- | --------: | -----: |
| `core::slice::sort::unstable::quicksort`                                               |    16,746 | 22,884 |
| `core::slice::sort::stable::quicksort` (HarfRust `ot_map` types, bidi brackets, Indic) |    14,470 | 19,795 |
| `retained_rope::update_ordered_node`                                                   |    10,894 | 13,929 |
| `core::ptr::drop_glue`                                                                 |    10,804 | 16,875 |
| `core::slice::sort::stable::drift::sort`                                               |     6,175 |  8,715 |
| `layout_query::append_measurement_from_occurrences_source` (2 closures)                |     5,713 | 11,768 |
| HarfRust `contextual::apply_chain_with_sequences`                                      |     5,587 |  8,553 |
| `retained_rope::split` / `balance` / `join_nodes` / `append_right` (5 node types each) |    17,333 | 23,177 |
| read-fonts CFF `Evaluator`                                                             |     2,950 |  5,320 |

Two were collapsed (table above); together `−4,673` gzip with every headline row within ±4% and overlapping ranges. The
engine already had a shared sort kernel (D-243, `engine/sort.rs`); the run lookup was the largest caller still sorting a
tuple type of its own. Remaining, priced:

- **`retained_rope`, about 31 kB raw of duplicate copies across five node types (est. 10 to 12 kB gzip).** `Node<T>` has
  the same layout for every `T` (a leaf is a `Vec<T>` plus a summary), so `branch`, `balance`, `join_nodes`, `split`'s
  descent and `update_ordered_node`'s traversal could run on one type-erased node, with only leaf copying, dropping and
  record summaries supplied per type. The rope is on every edit and is owned by the segment-layout lane, so it is a
  separate task with its own A/B.
- `IndexEdit` sort (6 kB raw; its `PlacementLogicalKey` does not pack into the `u64` kernel), a `usize` sort (3 kB) and the
  `Range` sort in `cluster_state/splice.rs` (2 kB, left alone while the Unicode lane works in that file).
- HarfRust's three stable sorts over `ot_map` types (about 19 kB raw with their drift-sort halves): their orderings are
  total (`feature_info_t` compares the sequence number, merged lookups combine commutatively), so one unstable kernel
  would do, but that is a fork change to the plan compiler and needs the cold-start check.

How we write generics in this crate so they collapse:

1. A generic function is a thin shell. It converts its generic arguments (`impl AsRef<[T]>`, closures, iterators) into
   slices, indices or `&mut dyn FnMut` and calls one non-generic body; only per-element kernels on the hot path stay
   generic over their element.
2. A closure parameter on a function that is not a per-glyph or per-cluster kernel is `&mut dyn FnMut`, not
   `impl FnMut`. One indirect call per record is invisible next to the record's work; a second copy of the body is not.
3. Every ordering lowers its key to `u64` (`sort::pack2`, `sort::f64_key`) and sorts through `sort::sort_keys` or
   `sort::sort_pairs`. A new `sort_unstable_by_key` or `sort_by` is a new copy of pdqsort (3 to 6 kB raw).
4. A container generic over its element (`retained_rope`) keeps the structural algorithm on an erased node and makes the
   element type visible only where elements are copied, dropped or summarised.
5. Before adding a generic with more than one caller, check `twiggy monos` on the named build
   (`glyph:shaper-profile-artifact`) for its duplicate bytes, and justify a second copy with an A/B.

### HarfRust fork features (owner direction B)

`variations` (default on upstream, off for us): every font shapes at its default instance; variation coordinates, the
GDEF item variation store and feature-variation indices are ignored, so the HVAR/VVAR/MVAR, `gvar` and device-delta
paths are not linked. The shaper never passes a `ShaperInstance`, so nothing changes today. **Variable-font shaping is
on the roadmap and needs the feature back on**: FeatureVariations selection, GPOS/GDEF variation deltas and HVAR/`gvar`
advances all live behind it, and turning it on costs the `5,151` gzip (`13,165` raw) this cut saved.

The `FontInstance` gate removes code only the experimental `FontInstance` API can reach; it has no behaviour cost.

A vertical-layout gate was priced and not taken: making `Direction::is_horizontal` constant would remove `2,962` raw /
`1,200` gzip, but the shaper would then have to refuse vertical directions inside HarfRust rather than at its own wire,
and the saving is small. The complex-script shapers stay (removing them removes behaviour); see the interpreter estimate
below.

### read-fonts and Skrifa in the core shaper (owner direction A)

Skrifa was never in the shipped shaper: it was a test-only dependency (the outline oracle), and it moved with that test
to the font baker. read-fonts, about `164` kB of the merged build's functions, splits by what reaches it:

| Reached by                                                        | read-fonts bytes | Runtime need                                                                |
| ----------------------------------------------------------------- | ---------------: | --------------------------------------------------------------------------- |
| HarfRust layout: `tables::layout`, `gsub`, `gpos`, `gdef`, `kern` |           85,055 | Shaping. Stays.                                                             |
| outline decoding: `ps::cs`, `ps::cff`, `glyf`, `loca`             |           46,514 | `outlineAt()` on fonts baked with `outlines`. Moved to the font baker.      |
| variable-font paths: `gvar`, `hvar`, `mvar`, `variations`         |           11,758 | None today (no instance is passed). Behind the fork's `variations` feature. |
| `model::font::tables` (the `FontInstance` model)                  |            7,178 | None. Behind `experimental_font_api`.                                       |
| `cmap`, `hmtx`, `head`, `maxp` and other metrics                  |            6,506 | Shaping. Stays.                                                             |
| generic instantiations over read-fonts types                      |            7,141 | Mostly layout.                                                              |

The only runtime consumer of outlines is the font loader: `outlineAt()` (Text, borrowed and detached glyph views) reads a
JavaScript store that the loader fills, glyph by glyph, behind the already-asynchronous load promise. Slug rendering uses
its own baked curves, and ink bounds come from the baked extents table. So the decoder moved, as the
`rust/glyph-outline` crate, into `font-baker.wasm`, which the runtime already loads on demand; nothing about a public
API's synchronous shape or the artifact format changed. Fonts with outlines now fetch the baker once.

The baker builds at `opt-level = "z"`; at `z` the CJK decode below took about 630 ms. Per-package profile overrides give
`pmndrs-glyph-outline`, `read-fonts` and `pmndrs-glyph-slug-core` `opt-level = 3` (read-fonts alone at 3 reached about
500 ms). The baker grows from `1,080,718` raw / `389,311` gzip to `1,160,249` / `427,030` (`+79,531` / `+37,719`),
which the owner accepts because the baker is loaded on demand. Cold outline load in Node (module compile included),
interleaved eight times each: Noto Sans CJK JP, 65,535 CFF glyphs, median 375 ms through the baker against 371 ms
through the shaper; Inter, 2,937 glyphs, 11 to 12 ms against 12 to 15 ms.

Baking outlines into the artifact instead (contours stored at bake time, no runtime decoder at all) would also remove the
core module fetch, but it is an artifact format change and is not done here.

### Lazy subsetting module (research step 2): parked

Parked by the owner: the baker is already loaded on demand, so its size is not a target. For the record, it needs no
public change if the font-baker binding moves out of the public entry into an internal module: the runtime bake worker
could then bind a subsetting-free build whenever a request has no `unicodeRanges` (the only caller of `prepare`), which
measured `456,403` raw / `179,716` gzip against the full baker and baked every fixture face to identical bytes.

### Unicode tables (research step 4): no change

The kernel's three-stage tries replaced the flat `u32` boundary arrays this note priced in August, and they already
compress well: about 90 kB raw but about 11 kB gzip together. Standalone gzip -9 of each table, as shipped and in the
re-encodings that would shrink it raw:

| Table      | Leaves raw / gzip | Leaves bit-packed raw / gzip | Middle `u16` gzip | Middle as two byte planes gzip |
| ---------- | ----------------: | ---------------------------: | ----------------: | -----------------------------: |
| script     |    25,920 / 2,199 |               (8-bit values) |               850 |                            703 |
| line break |    20,032 / 2,134 |       15,024 / 2,601 (6 bit) |               700 |                            581 |
| bidi class |    16,832 / 1,269 |       10,520 / 1,651 (5 bit) |               607 |                            503 |
| kernel     |     7,136 / 1,918 |               (8-bit values) |               988 |                            837 |

Bit-packing the leaves makes gzip worse by 380 to 470 bytes per table, which is the owner's point about layouts chosen
for gzip. Splitting each middle stage into low and high byte planes would save about 520 gzip bytes in all, but turns
one `u16` load into two byte loads on the per-code-point lookup that every paragraph runs; it is not worth a hot-path
change. HarfRust's `ucd_table` comes from HarfBuzz's packtab, already a multi-stage byte encoding. The
`unicode-segmentation` range tables (word 29,940, grapheme 19,416, sentence 13,200 raw; `(char, char, u8)` rows padded
to 12 bytes) belong to a pinned third-party crate; their padding is zeros that gzip absorbs, and replacing them means
owning a UAX #29 implementation, which the engineering standard argues against.

### Not now: estimates

- **Data-driven syllabic interpreter (research step 7).** The Indic, Khmer, Myanmar and USE shapers plus vowel constraints
  are about `63` kB of HarfRust code and `12` kB of machine tables in this build (`ot_shaper_use` 19,656, `indic` 17,257,
  `vowel_constraints` 13,163, `khmer` 5,968, `myanmar` 5,916, Ragel tables ~12 kB). An interpreter that runs the same
  Ragel tables from data would keep perhaps 8 to 12 kB of code and could move the tables into per-script payloads,
  for roughly −45 to −55 kB raw / −15 to −20 kB gzip on a Latin-only download. Cost: a new state-machine runtime proven
  against HarfBuzz on the full shaping corpus for every syllabic script, and a payload fetch before a complex-script
  paragraph can shape.
- **Per-script payloads.** Beyond the interpreter, the HarfRust `ucd_table` (~48 kB raw) and our script, line-break and
  bidi tries (~90 kB raw, ~30 kB gzip) are script-independent lookups every paragraph uses; splitting them per script
  would make Latin pay only for the Latin blocks, perhaps −20 to −30 kB gzip, at the price of a coverage check and fetch
  before first shaping of a new script, i.e. a first-frame cost for multilingual text.
