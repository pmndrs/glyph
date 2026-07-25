---
type: Research Note
title: Shaping compilation and execution research
description: Frames static shaping, per-font bytecode, specialized CPU/Wasm, and WebGPU execution against the proven universal HarfRust baseline.
status: draft
tags: [shaping, compiler, bytecode, mlir, wasm, webgpu, performance]
sources:
  - id: shaping-contract
    resource: shaping-data-contract.md
    title: Shaping data contract V0
  - id: package-sizes
    resource: ../../apps/benchmarks/src/generated/package-sizes.json
    title: Generated package-size report
  - id: inter-fixture
    resource: ../../apps/benchmarks/fixtures/fonts/inter-v4.1/manifest.json
    title: Inter 4.1 fixture manifest
  - id: amiri-fixture
    resource: ../../apps/benchmarks/fixtures/fonts/amiri-1.002/manifest.json
    title: Amiri 1.002 fixture manifest
  - id: cjk-fixture
    resource: ../../apps/benchmarks/fixtures/fonts/noto-sans-cjk-2.004/manifest.json
    title: Noto Sans CJK JP 2.004 fixture manifest
  - id: harfbuzz-plans
    resource: https://harfbuzz.github.io/shaping-and-shape-plans.html
    title: HarfBuzz shaping and shape plans
  - id: harfbuzz-operations
    resource: https://harfbuzz.github.io/shaping-operations.html
    title: HarfBuzz shaping operations
  - id: opentype-layout
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2
    title: OpenType layout common table formats
  - id: mlir-gpu
    resource: https://mlir.llvm.org/docs/Dialects/GPU/
    title: MLIR GPU dialect
  - id: mlir-spirv
    resource: https://mlir.llvm.org/docs/Dialects/SPIR-V/
    title: MLIR SPIR-V dialect
  - id: webgpu
    resource: https://gpuweb.github.io/gpuweb/
    title: WebGPU specification
  - id: wgsl
    resource: https://gpuweb.github.io/gpuweb/wgsl/
    title: WebGPU Shading Language
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-25T18:00:06Z"
---

# Shaping compilation and execution research

Status: research framing only; no roadmap commitment or replacement of the universal shaper

## Executive finding

The project can bake final shaping only for a closed corpus whose text, font instance, script, language, direction, features, buffer flags, and relevant boundary context are known. Dynamic text still needs an evaluator because shaping transforms and mutates a sequence according to font rules and script-specific algorithms; it is not an independent character-to-glyph lookup. HarfBuzz likewise combines font tables with executable script-specific shaping models and ordered contextual operations.[^harfbuzz-plans][^harfbuzz-operations]

The accepted V0 architecture therefore remains the default:

```text
validated per-font shaping data + one shared HarfRust Wasm evaluator
```

The credible post-baseline research direction is a compiler that partially evaluates shaping per font and can lower one semantic representation to:

```text
static shaped runs | compact bytecode | specialized CPU/Wasm | WGSL compute
```

A smaller bytecode interpreter is plausible, but it does not win merely by making the shared runtime smaller. The decision must include every compiled font artifact, exact conformance, cold and warm execution, CPU-layout readiness, memory, and maintenance cost.

## Current measured baseline

The current complete runtime shaper is shared by every font. Its generated size lane reports:

| Component | Raw/minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| HarfRust shaper Wasm | 692,018 B | 257,537 B | 201,934 B |
| TypeScript direct-memory bridge | 30,406 B minified | 8,737 B | 7,794 B |
| **Shared runtime total** | — | **266,274 B** | **209,728 B** |

The V0 shaped result costs exactly 24 bytes per produced glyph plus 10 bytes per run before arena alignment. The current Chromium conformance fixture broad-shapes 97 Inter glyphs with one Wasm call in approximately 0.1–0.3 ms warm; paragraph measurement then reuses paragraph-owned arrays without repeating broad shaping.[^shaping-contract]

The authenticated shaping-only GLBs establish the font-data side of the comparison:

| Font | Source | Core GLB | Retained shaping payload |
| --- | ---: | ---: | ---: |
| Inter 4.1 | 411,640 B | 172,140 B | 171,056 B |
| Amiri 1.002 | 431,116 B | 179,048 B | 177,963 B |
| Noto Sans CJK JP 2.004 | 16,467,736 B | 1,540,460 B | 1,539,372 B |

The Noto artifact is 655,920 bytes with gzip and 515,421 bytes with Brotli. An alternative representation cannot claim all GLB bytes as savings: container metadata, metrics, glyph extents, provenance, and renderer inputs may remain even if compiled shaping replaces the retained SFNT rules.

## Why everything cannot be baked universally

The baker knows the font but normally does not know the future text. Shaping depends on a complete input key:

```text
font identity and variation instance
+ Unicode sequence and surrounding context
+ script, language, and direction
+ feature values and ranges
+ cluster level and buffer flags
+ beginning/end and line-boundary context
```

OpenType contextual and chained-context lookups can inspect backtrack, input, and lookahead sequences. Substitutions mutate the glyph buffer, and later lookups observe the changed sequence.[^opentype-layout] Script models may also normalize, divide text into syllables, reorder, join, attach, position, and merge clusters in a prescribed order.[^harfbuzz-operations]

For fixed content, the evaluator can run at bake time and serialize the final glyph IDs, clusters, advances, offsets, and flags. For arbitrary text, the alternatives are to execute an evaluator locally, call one elsewhere, or enumerate every admitted input and configuration. The last choice grows combinatorially and becomes unbounded when the text length is not capped.

This distinction is canonical:

```text
closed corpus  → bake-time shaping → stored glyph runs → no runtime shaper
dynamic corpus → font rules + runtime evaluator          → shaped glyph runs
```

## Candidate disposition

| Candidate | Status | Research disposition |
| --- | :---: | --- |
| Shared HarfRust Wasm | ✅ baseline | Preserve as the universal correctness oracle and fallback. |
| Static pre-shaped runs | 🧪 candidate | Strong for explicitly closed text/localization corpora; invalidated by an unmatched shaping key. |
| Full pure-JavaScript shaper | ⏸ deprioritized | Avoid a second handwritten universal engine; it is unlikely to beat the current total without reducing capability and would duplicate conformance maintenance. |
| Semantic bytecode + shared VM | 🧪 priority | Most credible smaller dynamic path; measure total VM plus compiled fonts rather than VM size alone. |
| Per-font specialized CPU/Wasm | 🧪 priority | Natural first compiler target because it preserves synchronous CPU layout and can prove the semantic IR before GPU work. |
| Per-font WGSL/WebGPU | 🧪 later | Throughput target for large batches; current CPU-owned UI layout imposes readback and synchronization. |

## Semantic bytecode model

OpenType GSUB/GPOS already stores compact domain rules. A naive compiler can expand them into verbose low-level instructions and become both larger and slower. The bytecode should therefore use bounded semantic operations rather than a general-purpose instruction set:

```text
MAP_CMAP
MATCH_COVERAGE
MATCH_CLASS_CONTEXT
APPLY_SINGLE_SUBSTITUTION
APPLY_LIGATURE_SUBSTITUTION
REORDER_SYLLABLE
ATTACH_MARK
ATTACH_CURSIVE
APPLY_PAIR_POSITION
COMPACT_BUFFER
```

The balance is deliberate:

- low-level instructions make the interpreter small but increase bytecode size and dispatch work;
- high-level instructions keep font programs compact but move universal shaping machinery back into the interpreter;
- font-specific native code removes dispatch but duplicates executable code and pipeline compilation per font.

The portfolio break-even equation is:

```text
current = shared HarfRust runtime + Σ current shaping data(font)
candidate = shared VM + Σ compiled bytecode(font)

candidate wins only when:
shared VM + Σ bytecode(font) < shared runtime + Σ current data(font)
```

More fonts help when compiled bytecode is smaller than the replaced font data; more fonts hurt when compilation expands it. The benchmark must therefore report one-font and realistic multi-font portfolios instead of presenting interpreter size in isolation.

Potential bake-time specialization includes:

- remove absent lookup kinds, scripts, languages, and variation paths;
- pre-resolve feature schedules and extension lookups;
- intern repeated coverage, class, anchor, and value structures;
- select dense, sparse, page-directory, perfect-hash, or binary-search layouts per table;
- prove maximum context, buffer growth, instruction count, and output size;
- share content-addressed program/data sections across fonts when identity permits it.

Performance is not assumed. Bytecode dispatch and bounds checks can lose to compiled Rust, while normalized tables and pre-resolved schedules can recover time by removing generic parsing and traversal. Both outcomes are plausible and must be measured.

## MLIR compiler direction

MLIR is useful as a build-time compiler framework, not as the browser artifact or runtime. A custom shaping dialect could preserve semantic operations long enough to verify, specialize, and lower them independently:

```text
OpenType + font identity
        ↓
pmndrs shaping dialect
        ↓ canonicalization, partial evaluation, bounds proofs
        ├── static shaped-run serializer
        ├── compact bytecode and reference VM
        ├── specialized CPU/Wasm
        └── GPU dialect → WebGPU-oriented WGSL lowering
```

Upstream MLIR documents GPU and SPIR-V dialect/conversion infrastructure, with the GPU dialect explicitly described as evolving.[^mlir-gpu][^mlir-spirv] WebGPU browsers consume WGSL source modules and pipelines, not MLIR; a production path therefore needs a WebGPU-constrained WGSL lowering and validation stage rather than assuming a direct upstream MLIR target.[^wgsl]

The same semantic IR must feed the reference CPU path and every optimized backend. Generated outputs are accepted only after bit-for-bit glyph IDs, clusters, positions, and mapped flags match HarfRust and HarfBuzz across the declared capability set.

## WebGPU opportunity and CPU-layout constraint

WebGPU is a throughput backend, not an automatic latency optimization. Shaping inside one run contains sequential mutation and compaction dependencies; the available parallelism is strongest across many independent runs, paragraphs, or text nodes.

The current UI architecture keeps measurement and layout on the CPU. Every uncached GPU shape therefore requires at least one synchronization before CPU layout can use its result:

```text
upload → dispatch → compute → staging copy → mapAsync → CPU layout
```

WebGPU buffer mapping is asynchronous so the user agent can ensure the GPU has finished using the buffer, and a mapped buffer cannot simultaneously participate in GPU queue work.[^webgpu] This fixed round trip is likely to dominate small labels and short paragraphs even when the kernel itself is faster.

The end-to-end model is:

```text
Tcpu(N) = CPU shape + CPU layout

Tgpu(N) = upload + submit + GPU shape + copy + mapAsync + CPU layout
```

No speedup range is accepted before measurement. The working hypotheses are:

- individual UI labels and short paragraphs will be slower or neutral on GPU;
- large batches of independent runs may amortize submission and readback;
- returning only clusters, advances, unsafe-break flags, and aggregate metrics may reduce bytes but not the synchronization;
- keeping glyph output GPU-resident helps rendering but does not remove the CPU measurement dependency;
- GPU shaping, wrapping, positioning, and rendering together could return only compact box metrics, but CPU constraint resolution may require another pass and an additional frame;
- the largest opportunity is text-heavy maps, terminals, editors, documents, or 3D scenes rather than ordinary retained UI labels.

Specialized CPU/Wasm is therefore the first compiler target. It preserves synchronous layout, establishes the IR and conformance machinery, and provides an honest baseline before WebGPU complexity is admitted.

## Required research ladder

- [x] Preserve a universal, fully conformant HarfRust baseline.
- [x] Pin representative Latin, complex-script, and maximum-cardinality CJK fixtures.
- [x] Measure the current shared runtime and per-font GLB payloads independently.
- [ ] Attribute Wasm bytes and warm time to Unicode/script logic, font access, lookup execution, allocation, and ABI support.
- [ ] Record lookup-kind, feature, coverage/class, context-depth, mutation, and output-growth distributions for Inter, Amiri, Noto CJK, and a broader licensed corpus.
- [ ] Define a semantic shaping IR with explicit malformed-input and bounded-work semantics.
- [ ] Implement a slow reference interpreter and prove complete differential equality before optimizing.
- [ ] Lower one representative font to semantic bytecode and compare total compressed portfolio bytes.
- [ ] Lower the same IR to specialized CPU/Wasm and compare cold start, warm throughput, and CPU-layout-ready latency.
- [ ] Add a WebGPU kernel only after CPU targets validate the IR; measure submission, compute, copy, mapping, and CPU-layout readiness separately.
- [ ] Test single-run and batched workloads at 32, 128, 512, 2,048, 10,000, and 100,000 produced glyphs.
- [ ] Produce a human-reviewed recommendation: universal replacement, optional variant, static-only path, or rejected hypothesis.

## Acceptance matrix

| Dimension | Required evidence |
| --- | --- |
| Correctness | Exact HarfBuzz/HarfRust glyph IDs, clusters, four positions, flags, contextual boundaries, and malformed-input behavior. |
| Universality | Inter, Amiri, Noto CJK, official Unicode corpora, variation sequences, feature ranges, and every declared script capability. |
| Size | Shared runtime plus every font artifact, raw/gzip/Brotli, for one-font and multi-font portfolios. |
| CPU performance | Cold initialization, first shape, warm shape, boundary reshape, paragraph measurement, and layout-ready latency. |
| GPU performance | Pipeline creation, upload, dispatch, compute, staging copy, `mapAsync`, bytes read, CPU-layout-ready latency, and GPU-resident render latency. |
| Memory | Peak CPU/Wasm memory, GPU storage/staging memory, allocation count, and cache residency. |
| Robustness | Work bounds, malformed bytecode rejection, device loss, WebGPU absence, fallback equality, and cross-vendor WGSL validation. |
| Maintenance | Compiler/runtime code size, versioning, generated-artifact review, fuzzing, conformance cost, and font-update regeneration. |

The [autoresearch protocol](autoresearch.md) governs performance acceptance: kernel or binary improvements do not qualify when the product-level path is neutral, slower, less universal, or less maintainable.

## Current non-decisions

- This note does not schedule a compiled shaping format or change V0.
- It does not authorize removing the shared HarfRust fallback.
- It does not assume pure JavaScript, bytecode, specialized Wasm, or WebGPU is smaller or faster.
- It does not couple the public paragraph API to a renderer or GPU backend.
- It does not permit a Latin-only result to claim universal shaping.
- A compiled format requires a new declared `shapingFormat`, validator, provenance, size lane, fuzz target, and differential conformance matrix.

[^shaping-contract]: Current ABI, byte accounting, ownership, conformance, and benchmark evidence are defined in the shaping data contract.
[^harfbuzz-plans]: HarfBuzz documents that font tables and segment properties select internal script-specific shaping models and shape plans.
[^harfbuzz-operations]: HarfBuzz documents ordered reordering, joining, contextual substitution, and contextual positioning operations over a glyph sequence.
[^opentype-layout]: OpenType defines contextual and chained-context matching across backtrack, input, and lookahead sequences.
[^mlir-gpu]: MLIR documents its evolving middle-level GPU abstraction and GPU-module execution model.
[^mlir-spirv]: MLIR documents progressive lowering from GPU and other dialects into target-constrained SPIR-V.
[^wgsl]: WGSL defines the shader module and compute-pipeline lifecycle consumed by WebGPU implementations.
[^webgpu]: WebGPU specifies asynchronous mapped-buffer readback and the ownership transition between CPU mapping and GPU queue use.
