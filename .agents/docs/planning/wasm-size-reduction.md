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

#### 2026-11-24: the shaper's level and the last min-sized-rust flags

The remaining build settings were measured on one raw module at `9b9fc6d49`
([decision](decisions/shaper-build-flags-2026-11.md)):

- **Rust flags.** `-Zfmt-debug=none` and `-Zlocation-detail=none`, alone or together, give a raw module byte-identical
  to the baseline. `-Cpanic=immediate-abort` had already removed everything they target.
- **Optimizer level.** The level inside the D-244 sandwich mostly moves raw bytes, not gzip bytes. Against `-Oz`
  (1,410,403 / 567,156 / 451,720 raw / gzip / Brotli):
  - `-O3` is +7,473 / −753 / −1,036, and matches `-Oz` speed in the browser headline and the engine Labs, so the
    shaper now ships `-O3`.
  - `-O4` is about 2–4% slower on the engine lanes and +923 gzip.
  - Removing `--one-caller-inline-max-function-size=0` adds about 5 kB gzip and costs 8–15% on a cold first frame.
  - The bakers keep `-Oz`.

The optimizer has no size left to give this module; the remaining levers are code and tables.

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

| Cut                                                                | Commit                   |   Δ raw |  Δ gzip | Δ Brotli |
| ------------------------------------------------------------------ | ------------------------ | ------: | ------: | -------: |
| placement run lookup through the shared `u64` sort kernel          | `464e046a3`              |  −6,383 |  −2,048 |   −1,933 |
| one measurement record writer, glyph source as `&mut dyn FnMut`    | `0d589655c`              |  −5,575 |  −2,625 |   −1,620 |
| fork `variations` feature off (default instance only)              | `7d8ad3bc2`              | −13,165 |  −5,151 |   −4,837 |
| fork `FontInstance` support only with `experimental_font_api`      | `1faf6a1e4`              | −12,722 |  −2,534 |   −1,317 |
| glyph-outline decoding moved to the font baker                     | `05426b7c7`, `54714cd2e` | −62,603 | −23,502 |  −17,858 |
| engine handle registries: `IdMap` instead of `BTreeMap<u32, _>`    | `1067c1f96`              | −37,784 | −13,772 |  −11,042 |
| UAX #29 categories from one trie (vendored `unicode-segmentation`) | `9b086527d`              | −36,128 | −23,478 |   −9,589 |

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

`BTreeMap<u32, _>` was a hidden instance of the same problem: four handle registries instantiated B-tree node code per
value type (about 23 kB raw of `alloc::collections::btree`) and inlined it into every lookup site. `engine::id_map::IdMap`
keeps sorted keys beside values and runs one non-generic binary search; it saved 13,772 gzip. Two more were collapsed
(table above); together `−4,673` gzip with every headline row within ±4% and overlapping ranges. The
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

All three items above were taken on 2026-11-23 (next section), except the `usize` sort.

How we write generics in this crate so they collapse:

1. A generic function is a thin shell. It converts its generic arguments (`impl AsRef<[T]>`, closures, iterators) into
   slices, indices or `&mut dyn FnMut` and calls one non-generic body; only per-element kernels on the hot path stay
   generic over their element.
2. A closure parameter on a function that is not a per-glyph or per-cluster kernel is `&mut dyn FnMut`, not
   `impl FnMut`. One indirect call per record is invisible next to the record's work; a second copy of the body is not.
   The rope's ordered update pays one per visited record with no measurable cost on the headline edit rows.
3. Every ordering lowers its key to `u64` (`sort::pack2`, `sort::f64_key`) and sorts through `sort::sort_keys` or
   `sort::sort_pairs`. A key that does not lower (a many-field logical key) sorts `(prefix, index)` pairs through
   `sort::sort_pairs_by` and permutes with `sort::apply_pair_order`. A new `sort_unstable_by_key`, `sort_by` or `sort`
   is a new copy of pdqsort or driftsort (3 to 8 kB raw), in vendored crates too, where a stable sort by a small key is
   an unstable sort of `key << 32 | position`.
4. A container generic over its element (`retained_rope`) keeps the structural algorithm on an erased node and makes the
   element type visible only where elements are copied, dropped or summarised. Byte storage in `u64` words with a
   `&'static` per-type descriptor works for `Copy` records; the typed view is one `unsafe` cast resting on the invariant
   that only the typed shell writes records.
5. Erasing a small generic is not always a gzip win: replacing three ~450-byte `apply_pair_order` copies with a swap
   callback cut raw bytes and added gzip bytes, because the copies compressed well against each other. Measure gzip.
6. Before adding a generic with more than one caller, check `twiggy monos` on the named build
   (`glyph:shaper-profile-artifact`) for its duplicate bytes, and justify a second copy with an A/B.

### 2026-11-23 monomorphization pass

Branch `experiments/sil-monos` from `sil-green-53` (`36fe54722`). Same build and measurement as above (package flags,
isolated target, gzip 9, Brotli 11; the scratch build is byte-identical to the package's `dist/text-shaper.wasm`).
`twiggy monos` on the named control: generics with more than one instantiation hold `145,473` B, `99,504` of them
duplicate copies (`core`/`alloc` `53,922`, ours `39,040`, HarfRust `5,587`). The top duplicates were stable quicksort
over HarfRust map types (`14,470`), `retained_rope::update_ordered_node` over seven type and closure pairs (`13,766`),
unstable quicksort (`11,025`, `IndexEdit` alone `6,138`), drop glue over 29 types (`10,381`), drift sort (`6,175`),
HarfRust `apply_chain_with_sequences` (`5,587`) and `retained_rope` `split`/`balance`/`join_nodes`/`append_right`/
`branch` (`19,149` together). After the pass: `65,400` B total, `39,653` duplicate (ours `4,796`).

| Cut                                                                 | Commit      |       raw |   Δ raw |    gzip | Δ gzip |  Brotli | Δ Brotli |
| ------------------------------------------------------------------- | ----------- | --------: | ------: | ------: | -----: | ------: | -------: |
| control `sil-green-53`                                              | `36fe54722` | 1,578,052 |       — | 621,697 |      — | 484,862 |        — |
| `retained_rope` type-erased tree core                               | `1e2303d46` | 1,541,888 | −36,164 | 612,881 | −8,816 | 478,320 |   −6,542 |
| `IndexEdit` and splice `Range` sorts through shared kernels         | `0cd655f53` | 1,534,502 |  −7,386 | 609,932 | −2,949 | 476,480 |   −1,840 |
| HarfRust `feature_info_t`/`lookup_map_t` sorts as `u64` keys (fork) | `3f6b7559d` | 1,516,384 | −18,118 | 604,181 | −5,751 | 471,668 |   −4,812 |
| `sort_pairs` shares `sort_pairs_by`'s instantiation                 | `748046ba3` | 1,511,499 |  −4,885 | 602,850 | −1,331 | 471,408 |     −260 |
| HarfRust `map_features` stable tag sort as `u64` keys (fork)        | `ca7656dd5` | 1,506,043 |  −5,456 | 601,122 | −1,728 | 469,752 |   −1,656 |

Together `−72,009` raw / `−20,575` gzip / `−15,110` Brotli.

**Rope.** One non-generic `Node` serves every record type: a leaf keeps its records as bytes at the type's stride in
`u64` words (so every record type with alignment up to 8 is aligned) beside a `&'static RecordKind` holding the stride
and a per-type summary function. Split, join, balance, append, point update, the exact builder and the ordered-update
traversal compile once; the ordered update's per-record callback and range source cross as `&mut dyn FnMut`, the
callback writing a replacement record's bytes into a stack buffer. The first replacement in a leaf copies the whole leaf
and later ones overwrite their row. Iteration, cursors, point lookup, `index_for_fragment` and `find_source` still borrow
a leaf as `&[T]` and stay specialised. What is left per type is the shell (`update_ordered_ranges` with its inlined
call-site closures, about 7.8 kB over 25 call sites) and five 200-byte summary functions. The estimate was `−10` to
`−12` kB gzip; the cut gave `−8.8` kB.

**Sorts.** `PlacementLogicalKey` does not pack into `u64`, so placement edits sort `(0, index)` pairs through
`sort::sort_pairs_by`, whose comparator is `&mut dyn FnMut` and is reached only on equal prefixes, then permute with
`apply_pair_order`; `sort_pairs` runs the same instantiation without a comparator. The HarfRust plan compiler's three
sorts lower to `u64` keys and share the shaper's `[u64]` sort: `tag << 32 | position` gives `feature_info_t` order
(`seq` is the position) and the stable tag order of `map_features`, and all six `lookup_map_t` fields pack into 52 bits
and unpack after the sort (see `vendor/harfrust/GLYPH-FORK.md`; the fork parity tests pass in both configurations).

Speed: headline harness, 7 fresh-browser loads per arm, each cut against the one before it, and
`benchmark:headline-bidi-edit` with 5 rounds per cut. The host carried other lanes (load average 5 to 15) and, during
the fork-key cut's run, this lane's own oracle gates. No row moved beyond its ranges. The rope cut's first run read
latin15k `delete-middle` +11% (frame and layout) against a baseline range of `4.42..8.22`; a 9-load latin-only rerun
read every latin row within ±2%. The sort cuts' rows are within ±8% in both directions with overlapping ranges; the
`sort_pairs` cut's bidi-edit read `+1%` to `+6%` per step with overlapping loads. The `map_features` cut's rows overlap (bidi-edit
`delete-middle` `+9%` with overlapping loads). Control against the tip on a quieter host (7 loads): every row within
`−6%` to `+3.5%`; latin15k and stress22k rows overlap, and the bidi15k edit rows read `+1%` to `+3.5%`, with
`paste-middle` (`12.47` to `12.77` ms frame, `8.59` to `8.80` ms layout) the one row whose ranges do not overlap. The
likely cause is the rope's indirect per-record call in the ordered update; the drift is inside the owner's allowance
and is reported, not reverted.

Not taken:

- `apply_pair_order` through a `&mut dyn FnMut(usize, usize)` swap: `−315` raw but `+337` gzip.
- The `u32`/`usize` pdqsort (about 3.9 kB raw with its helpers): its callers (`dirty_instances`, placement-slot and
  lifecycle scratch in `engine/state.rs`, `drawn` graphemes) sort `u32` or `usize` vectors in place; routing them
  through `sort_keys` needs a `u64` scratch at each site, and two are in `state.rs` code another lane owns.
- Drop glue (`10,406` duplicate over 29 types) is one function per distinct type, not duplication a shell can remove.
- HarfRust `apply_chain_with_sequences` (three match-function triples, `5,587` duplicate) is the per-glyph GSUB/GPOS
  matcher; an indirect match call per glyph is not worth about 2 kB gzip. `unicode-bidi`'s bracket-pair sort and
  HarfRust Indic's per-syllable stable sort (about 9 kB raw with their drift-sort halves) are an unvendored dependency
  and a per-syllable hot path.
- `codec_gather::splice_appended` and the column-lane pairs (about 3 kB duplicate) are per-column kernels.

### 2026-11-23 `engine::state` pass

Branch `experiments/sil-state-size` from `sil-green-54` (`dda804dda`), same build and compression as above (the scratch
build is byte-identical to the package's `dist/text-shaper.wasm`). Control: `1,578,343` raw / `621,409` gzip /
`484,719` Brotli, `engine::state` `293,029` B. Inlining was attributed with a twin build at `debug = "limited"`: each
`DW_TAG_inlined_subroutine` range is charged to the function it sits in (pre-wasm-opt bytes).

- `PlannerState::prepare_upsert` (`43,726` B) was paragraph creation: the derived `ParagraphState::default()` (well over
  a hundred fields) inlined as ~10 kB of constant stores, then `Box::new(RetainedParagraph { .., state })` storing the
  scalarised state into the box field by field (~20 kB). The same default was inlined into `new_planner` (11 kB) and the
  refusal path. After the cut `prepare_upsert` is `525` B and `new_planner` `2,345` B.
- `OrderedPlanCompiler::prepare_internal` (`27,418` B) and `PositionedGlyphArena::build_lines` (`26,455` B) are
  single-caller steps on the publication and per-line paths (`compile_draw_spans` 10.8 kB, `write_changed_ranges`
  9.8 kB; `prepare_build` 10.4 kB, `position_line` 7.3 kB). One copy each, nothing cold: not cut.
- The rest was helpers inlined at many sites, listed in the table.

| Cut                                                                    | Commit      |   Δ raw |  Δ gzip | Δ Brotli |
| ---------------------------------------------------------------------- | ----------- | ------: | ------: | -------: |
| empty `ParagraphState` and boxed `RetainedParagraph` built out of line | `60b33df10` | −54,386 | −26,169 |  −16,952 |
| one `WasmState` initialization behind `with_state` (43 instances)      | `58523b642` | −21,238 |  −3,042 |     −921 |
| arena `clear`s out of line                                             | `e7b60e799` |  −7,987 |  −2,070 |     −944 |
| one out-of-line paragraph binary search                                | `7fd123655` | −10,868 |  −3,743 |   −1,711 |
| `PlacementLogicalKey` ordering through one out-of-line `cmp`           | `5ad42ef5f` |  −7,629 |  −2,999 |   −1,921 |
| allocator `alloc`/`dealloc` out of line (~690 sites)                   | `cf54b15a1` |  −2,887 |    −873 |     −171 |
| failure publication `#[cold]`                                          | `3d4794766` |    −559 |    −216 |     −503 |
| five per-publication helpers out of line                               | `fcd2048cd` |  −3,638 |  −1,348 |     −737 |

Together `−109,192` raw / `−40,460` gzip (−6.5%) / `−23,860` Brotli; `engine::state` `226,967` B. Speed: headline harness
(5 loads per cut, each against the one before; host load average 11 to 31 from other lanes) moved no row beyond its
ranges; control against the pass's tip (7 loads) read every row within `−6%` to `+4%`, and
`benchmark:headline-bidi-edit` (5 rounds) `0.96` to `1.02`.

**Rope fast path.** After the merge of the monomorphization pass (`1,407,038` / `563,770` / `449,269`), the ordered
update's per-record step became a dyn visitor call plus a runtime-size byte copy, and bidi15k `paste-middle` read about
2.5% slower. The tree walk stays type-erased; it now hands each leaf, through one indirect call, to
`update_leaf_records`, an `#[inline(always)]` loop generic over the record type and the caller's update. Cost `+2,493`
raw / `+1,389` gzip / `+825` Brotli (`6009e8318`), about 16% of the rope cut's `8,816`. Against the pre-merge tip,
`benchmark:headline-bidi-edit` (6 rounds) reads `paste-middle` `12.78` → `12.80` ms and the headline harness (7 loads)
`0.99` frame / `1.00` layout. Against the merged tip directly the bidi-edit run read `+3%` with overlapping loads, so the
2.5% itself is not resolvable on this host.

**Cold code at size (research for the crate split).** `#[optimize(size)]` on the 57 functions that only run at setup,
registration, validation or on rare requests (`validate_planner_inputs`, `stage_planner_inputs`, `ValidatedCodec::new`
and codec validation, codec and font-binding wire decoding, language resolution, root and registry lifecycle) saves
`6,215` raw / `907` gzip. Moving language resolution into a crate built at `opt-level = "z"` saved `95` gzip. The
largest cold bodies (`validate_planner_inputs` 14.8 kB, `stage_planner_inputs` 7.5 kB) are methods over
`engine::state`'s types and cannot leave the crate without those types. Cold code is a small, already compact share;
the size is in hot code.

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

### Unicode tables (research step 4)

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
`unicode-segmentation` range tables were the exception: `(char, char, category)` rows of code points that
gzip barely compresses (grapheme 19,416 raw / 6,961 gzip, word 29,940 / 10,877, sentence 13,200 / 4,977). The crate is
now vendored with its four category lookups (grapheme, word, sentence, emoji) answered from one trie over the combined
57-tuple category, about 3.9 kB gzip, generated from the crate's own tables and compared with them at every scalar value;
whole-wasm gzip fell by 23,478 bytes. The UAX #29 algorithms are untouched.

### 2026-11-24 size-audit cuts

Branch `experiments/sil-sizecuts` from `sil-green-64`, building the cuts ranked in
[the core size audit](core-size-audit-2026-11-23.md) plus the dead Flat gather path from the engine size report. Same
build as above (package flags, `-O3` since `sil-green-63`, isolated target; the control is byte-identical to the
package's `dist/text-shaper.wasm`, 1,417,876 raw). Gzip is GNU `gzip -9`; Brotli is Node quality 11. Every row is
stacked on the rows above it, in commit order.

| Audit # | Cut                                                                                    |       Δ raw |           Δ gzip -9 |    Δ Brotli |
| ------: | -------------------------------------------------------------------------------------- | ----------: | ------------------: | ----------: |
|       1 | HarfRust `ucd_table` split per property (fork; generated, checked at every code point) |     −13,976 |              −4,820 |      −4,047 |
|       3 | Fallible `Vec` growth out of line (`ColdGrowth`, 164 call sites)                       |      −6,631 |              −2,341 |      −1,401 |
|       6 | `add_feature` `#[inline(never)]` (fork)                                                |      −6,133 |              −1,243 |        −856 |
|       7 | ASCII bootstrap through `UnicodeBuffer::add`                                           |      −2,338 |                −906 |        −932 |
|       8 | `add_pause` `#[inline(never)]` (fork)                                                  |      −3,673 |                −505 |        −566 |
|      11 | MVAR and FeatureVariations calls compiled out without `variations` (fork)              |      −1,585 |                −662 |        +197 |
|       4 | `is_word` from an `ALPHANUMERIC` bit in the line-break trie                            |      +5,527 |                −750 |      −1,490 |
|       5 | `InCB_Extend` as a fifth column of the segmentation trie (fork)                        |      −3,453 |              −1,502 |        −705 |
|       2 | `Staged<T>` fills both values from one out-of-line `T::default()`                      |      −3,929 |              −1,589 |        −868 |
|       9 | `font_index` binary search out of line                                                 |      −1,681 |                −449 |        −386 |
|       — | Flat gather path (`GatherInput::Flat`, `LayoutPlanInput`) compiled only for tests      |     −16,875 |              −8,383 |      −5,677 |
|         | **Total: 1,417,876 → 1,363,129 raw, 562,607 → 539,457 gzip, 450,595 → 433,864 Brotli** | **−54,747** | **−23,150 (−4.1%)** | **−16,731** |

- Cut 2 was built in its cheap form. The audit's `const` template needs a `const` constructor for every type under
  `ParagraphState`; most of the 10.6 kB of stores was each `Staged<T>` initializing its two `T` inline, so an
  out-of-line `fresh::<T>()` halves it (`empty()` 2,432 bytes plus about 3.1 kB of `fresh` bodies). A runtime template
  copy was larger than the control (+509 gzip), since `default()` stays linked.
- Cut 4 grows the line-break trie (74 values instead of 61) but removes `core`'s Alphabetic and N tables; the bit sits
  above the existing property bits, so the hot `properties` lookup is unchanged. A test pins `core`'s Unicode version
  and compares the bit with `char::is_alphanumeric` at every scalar.
- Cut 9 measured +337 Brotli when stacked directly on cuts 1, 3, 6, 7 and 8; on the full stack it is −386.
- Dropped: cut 12 (the four test-only exports) is −239 raw / −45 gzip / +410 Brotli on the tip and would move about
  thirty test and benchmark call sites off `textUpdate`. Cut 10 and `TableRange::new` were not built (owner direction).
- Behaviour: native and wasm32+simd128 layout oracles with the adversarial fonts give 596 cases equal and no rejected or
  unlisted divergence; the shaper, fork and segmentation tests pass.

Speed, tip against `sil-green-64` with only `text-shaper.wasm` differing (same package JavaScript), interleaved. The
host was not quiet: another workspace's build kept the load average at 8 to 28, so ranges are wide.

- Browser headline (`headline.js`, 6 rounds; paired median candidate/baseline): every edit, sweep and ASCII-frame row
  is 0.95 to 1.03 except `latin15k` sweep (1.08 CPU, range 0.86 to 1.20). A 10-round `latin15k` rerun put every row
  at 1.03 CPU or less with ranges of about ±15%: within noise, but the one lane to recheck on a quiet host.
- Engine Labs (`--suite engine --wasm`, 4 rounds, order alternated): every row 0.82 to 1.02.
- `benchmark:headline-bidi-edit` (5 rounds): 0.97 to 1.02.

### 2026-11-24 retention tiers

Branch `experiments/sil-tiers` on `sil-green-65`. The [engine size report](engine-size-report-2026-11-24.md) priced
five special-case incremental paths at up to 23.9 kB gzip together (option 3). Each was tried in order as delete,
parameterise through the general path, de-duplicate, keep, and the first that held speed on the path's own rows was
kept. Two changed; three stay, because removing them is slower on the rows they exist for.

| Path                                               | Removal price (gzip, raw) | Removed, on its rows (candidate/baseline) | Outcome                                                                                |      Δ raw |     Δ gzip |   Δ Brotli |
| -------------------------------------------------- | ------------------------: | ----------------------------------------- | -------------------------------------------------------------------------------------- | ---------: | ---------: | ---------: |
| In-place cluster rebuild of one run                |            −3,403, −7,395 | same-length edit 0.73 to 0.83; rest 1.00  | **deleted**                                                                            |     −6,681 |     −2,749 |     −2,210 |
| Rebuild after an exclusion change                  |            −4,216, −8,620 | moving exclusion, 26k glyphs: 1.2 to 1.9  | **de-duplicated** (one band loop)                                                      |       −319 |       −409 |     −1,075 |
| ASCII-anchor splice                                |           −9,933, −25,975 | Inter 1.00; Fredoka insert mid 1.37–1.48  | kept                                                                                   |          0 |          0 |          0 |
| Reorder-only fast path                             |            −4,038, −8,809 | 1.11 to 1.70                              | kept                                                                                   |          0 |          0 |          0 |
| Resize equivalence (`flow_positioning_equivalent`) |            −2,015, −4,499 | 1.9 to 3.2                                | kept                                                                                   |          0 |          0 |          0 |
|                                                    |                           |                                           | **Total: 1,363,129 → 1,356,129 raw, 539,454 → 536,296 gzip, 433,472 → 430,187 Brotli** | **−7,000** | **−3,158** | **−3,285** |

Removal prices are Node zlib level 9 on `sil-green-65` (control 543,055); the delta columns and the total are
`gzip -9`. Removal ratios were measured on `sil-green-64`.

- **In-place cluster rebuild.** `rebuild_source_run_if_topology_is_stable` rebuilt an edited run inside a copy of the
  previous arena when the edit kept every cluster and glyph count. The general splice between previous rows accepts
  the same one-run window, and it is faster: the in-place path copied the whole arena and re-derived every layout unit
  and chunk sum, where the splice copies the rows outside the window and builds only the window's. The tier, its
  range-limited stable-id pass and five helpers only it called are gone (820 lines with their two tests). One thing
  the tier did had to move: it kept the break corrections cached away from the edited run, and the splice started
  an empty cache, which changed the frozen cache lanes of five reference cases. The splice now keeps the cache in
  the same case (one run, the same grapheme boundaries, as many glyphs) and clears it around the run as the tier
  did, so no reference is re-frozen.
- **Exclusion rebuild.** Removing it is 1.2 to 1.9 times slower on a moving exclusion at 26k glyphs, so it stays.
  It no longer carries its own copy of the loop that walks a region band by band: the full build and the rebuild
  both call `compose_region_bands` once per region, and the rebuild passes its "rejoined the previous flow" test as
  a `&mut dyn FnMut`. A per-line out-of-line step saved about twice as much (−758 gzip) but measured 1.004 to 1.013 on
  the width sweep against 0.996 to 1.005 for the same build twice, so it was not taken.
- **ASCII anchor.** It applies to one length-changing edit in a paragraph that is a single Latin run of at most
  8,192 units in one font that passes its screen. Inter does not pass (1.00 with the path off at 600 to 8,000 units);
  Fredoka does, and without it an insert in the middle is 1.37 times slower at 2,000 units and 1.48 at 8,000. The
  general path reshapes the whole run for a length-changing edit, so the plan's premise that the splice tiers replace
  the anchor does not hold for that class of font. Parameterising was built as a scratch prototype
  (`glyph-scratch/tiers/patches/p1-general-resized-window-proto.patch`): the existing unsafe-to-concat windows of
  same-length edits, extended to one length-changing edit with four clusters of probe margin. With the anchor
  deleted that build is −10,578 gzip (Node zlib, on `sil-green-64`), passes the native oracle (596 equal, nothing unlisted), and makes Inter 0.46 to
  0.72 on single-run typing and inserts, but Fredoka stays 1.37 to 1.50: HarfRust flags every Fredoka glyph unsafe
  to concatenate (class kerning matches every pair), so there is no boundary to window on, and the anchor's font
  screen is the only proof that covers it. The screen is also where the bytes are (`screen_gpos_lookups`,
  `screen_lookups` and `ascii_anchor_screen` are 13 kB raw of the 26 kB), and nothing else shares it. Kept; the
  trade (delete the anchor, take the general window: Inter-class single-run edits about twice as fast, Fredoka-class
  inserts mid-paragraph about 1.45 times slower, about −10 kB) is the owner's.
- **Reorder-only.** With the path off, reordering 1,000 labels is 1.70 times slower and reordering paragraphs 1.11
  to 1.16. It is one function plus a walk that collects the drawn stable ids; neither repeats another kernel that
  could be called at a coarser seam than a glyph. Permuting the committed instances by each paragraph's retained
  gather range would drop the walk, but the walk is what notices a binding whose strikes changed, and the ranges
  are stale after the first reorder. Kept.
- **Resize equivalence.** With the proof off, a width change that composes the same lines is 1.9 to 3.2 times
  slower, and a fine width sweep 3.2. Calling one out-of-line pen function for both flows is −106 gzip, and
  `fragment_pen` out of line everywhere is −203 gzip and +417 Brotli; neither is worth a change. Kept.

Speed was measured with a headless package harness (`glyph-scratch/tiers/bench/pkgab.mjs`): both arms load in one
Node process with the same package JavaScript and a different `text-shaper.wasm`, steps alternate between the arms,
and each step is the mutation, scene publication and a headless frame end. Ratios are the 10th-percentile step time,
median over 4 to 8 fresh-process rounds of 200 to 400 steps. The same build against itself gave 0.99 to 1.04 at a
load average of 20 and 0.996 to 1.005 at 4.

Tip against `sil-green-65` on that harness (5 rounds of 300 steps, 34 rows, Inter): a same-length edit in the middle
of a paragraph is 0.71 at 26k glyphs in 100 runs and 0.84 at 3k; every other row (typing at the end, inserts, a
same-length edit in a single run of 600 to 8,000 units, whole-text replacement, width sweeps, equivalent widths,
moving exclusions, reorders) is 0.984 to 1.007. Kimun on `packages/glyph/rust` is C+ 76.2 before and C+ 76.1 after.

The lanes the earlier passes used, tip against `sil-green-65` with only `text-shaper.wasm` differing. The gates were
running on the same host during all three.

- Browser headline (`headline.js`, 5 loads per arm, complete GPU-completed frames): every edit, sweep and ASCII-frame
  row of `latin15k`, `stress22k` and `bidi15k` is 0.990 to 1.006.
- Engine Labs (`--suite engine --wasm`, 4 rounds, order alternated, 25th percentile): `localized-edit` 0.81; every
  other row 0.985 to 1.017 except `equivalent-width` at 1.045 (range 0.987 to 1.106, a 0.2 ms row). The same
  raw-engine case with both modules in one process and steps alternated is 1.000 to 1.008 over three runs of 400
  steps, and the package harness puts the operation at 0.995 and 1.004.
- `benchmark:headline-bidi-edit` (4 rounds): 0.98 to 1.00.

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
