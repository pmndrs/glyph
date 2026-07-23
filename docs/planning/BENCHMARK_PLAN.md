---
type: Test Plan
title: Benchmark plan
description: Defines reproducible performance, memory, payload, loader, baker, paragraph, and presentation measurements.
status: proposed
tags: [benchmarks, performance, payload]
---

# Benchmark plan

Status: proposed  
Purpose: replace performance and payload estimates with reproducible evidence.

## Principles

1. Report whole-product outcomes and isolated kernels separately.
2. Measure cold and warm behavior; startup is part of runtime cost.
3. Separate shaping data, presentation data, JavaScript, and Wasm bytes.
4. Never compare outputs that differ semantically or in font coverage.
5. Store raw samples and environment metadata, not only summary charts.
6. Treat variance and regression thresholds as part of the benchmark definition.

## Benchmark environments

Record:

- operating system and version;
- CPU model/core count;
- RAM;
- GPU and driver;
- browser and exact version;
- JavaScript engine/Wasm feature set;
- power mode and thermal state where available;
- Rust/toolchain and optimization flags;
- dependency commits;
- font and fixture hashes.

Initial environments should include one current Chromium desktop reference, one Firefox reference, one Safari/macOS reference, and at least one constrained/mobile-class device before release claims.

## Workload corpus

### Text shapes

| Workload | Purpose |
| --- | --- |
| 8–16 character Latin label | boundary overhead and common UI latency |
| 40–80 character mixed-style line | feature ranges and normal app text |
| 500 character Latin paragraph | throughput, wrapping, and caches |
| 5,000 character Latin document | steady-state bulk kernels and memory |
| Arabic short label and paragraph | joining, cursive, marks, RTL |
| Devanagari short label and paragraph | syllable/reorder/context workload |
| mixed LTR/RTL paragraph | run segmentation and line ordering |
| emoji/ZWJ list | supplementary decode and sequence substitution |
| repeated icon labels | simple cmap/advance and cache ceiling |
| CJK paragraph subset | coverage size and line-fitting throughput |

Each workload has unique-text and repeated-text variants.

### Font shapes

- small ASCII/Latin subset;
- feature-heavy Latin Extended;
- Arabic;
- Devanagari or another USE-heavy font;
- emoji-capable font subset;
- private-use icon font;
- large CJK subset;
- one font with class kerning and one with many explicit pairs.

## Shaper benchmarks

Measure:

- Wasm module download bytes: raw, gzip, Brotli;
- compile and instantiate time;
- font registration time;
- shape-plan cold creation and warm reuse;
- UTF-16 copy/decode time;
- total shape time per request;
- glyphs and source code units per second for long runs;
- output-buffer growth/allocation;
- peak and retained Wasm memory;
- JS/Wasm calls per operation;
- cache hit latency and memory.

Variants:

1. pinned HarfRust over reference font data;
2. direct baked cmap/metrics only;
3. each compiled operation family independently;
4. scalar versus SIMD module;
5. one coarse request versus deliberately repeated small calls;
6. debug verification off versus on, clearly labeled.

## Paragraph benchmarks

Measure:

- initial analysis and broad shaping;
- greedy line fitting;
- final boundary reshape;
- total initial layout;
- width-only reflow at several widths;
- height/max-lines/ellipsis update;
- cache memory;
- changed lines and reshaped lines;
- Wasm call count and transferred/written bytes.

Resize scenario:

```text
wide → narrow in 20 steps → wide in 20 steps
```

Report latency distribution per step and the percentage of steps requiring boundary reshaping. Do not report only the average.

## Baker benchmarks

Measure native and worker Wasm independently:

- source decode/parse;
- variation instancing;
- subset and shaping closure;
- dense ID remap;
- shaping-section compilation;
- canonical outline extraction;
- Slug generation;
- MTSDF generation and atlas packing;
- each bitmap strike rasterization/packing;
- GLB assembly;
- total time;
- peak memory;
- output section sizes;
- main-thread long tasks during worker operation;
- transfer time;
- persistent-cache write/read time.

Run with shaping-only, each presentation individually, and the combined package. Large-font tests must include cancellation and configured limit failures.

## Loader and GPU benchmarks

Measure:

- fetch/decode excluded and included variants;
- GLB JSON parse and extension validation;
- typed-view registration;
- any copy into Wasm memory;
- GPU buffer creation/upload;
- texture decode/transcode/upload;
- JS allocations and retained object count;
- first drawable frame;
- warm cache load.

Compare current Three Flatland Slug loading with the new path for equivalent Slug coverage, while reporting semantic/format differences.

## Presentation benchmarks

### Slug

- presentation bytes by glyph count;
- curve/band generation time;
- atlas/texture occupancy and padding;
- current R32F bands versus exact u32-header/u16-local-reference packing;
- RGBA16F curves versus each quality-gated UASTC/native compressed target, including dynamic transcoder bytes and selected device format;
- curves per glyph and curves per band distribution;
- glyphs per draw and GPU frame time;
- extreme scale/perspective quality and cost.

### MTSDF

- generation time;
- atlas occupancy/page count;
- raw and compressed texture bytes;
- GPU upload/decode time;
- frame time by projected pixel height;
- perceptual error at small/normal/large sizes.

### Bitmap

- time and bytes per strike;
- hinted versus unhinted/oversampled experiment;
- atlas occupancy/page count;
- quality at native and off-size scaling;
- technique-switch threshold experiments.

## Payload report

The initial measured baselines, modeled atlas envelopes, and required report schema live in the [font payload budget](PAYLOAD_BUDGET.md). Benchmarks replace its modeled values; they do not mix shared font bytes, transport bytes, and GPU texture allocation into one total.

Every font configuration reports sections separately:

```text
shared header/directory
cmap
metrics/properties
reference shaping data
compiled shaping data
Slug metadata and texture bytes
MTSDF metadata and atlas bytes
bitmap metadata and per-strike atlas bytes
GLB JSON/alignment overhead
shaper Wasm
runtime baker library and Wasm core
JavaScript by export/chunk
```

For each: raw, gzip, and Brotli. Image/KTX payloads are not recompressed in misleading ways; report their transport representation.

## Allocation and memory report

At minimum record:

- peak worker memory during baking;
- peak/retained Wasm linear memory;
- number and bytes of copies between fetch buffer, worker, Wasm, JS views, and GPU upload staging;
- per-font JS object/array counts where tooling permits;
- shaped-run and paragraph cache bytes;
- GPU resource bytes.

The desired architecture can still regress memory through oversized scratch buffers or duplicate GLB/Wasm copies; typed arrays alone do not prove zero-copy behavior.

## Methodology

- Warm up until compilation/tiering no longer dominates steady-state samples.
- Preserve a separate true cold-start measurement in a new context/process.
- Use enough iterations to report median, p90, p95, and dispersion.
- Randomize variant order where thermal/tiering drift could bias results.
- Consume benchmark outputs so dead-code elimination cannot remove work.
- Validate output hashes before accepting timing comparisons.
- Keep tracing/profiling runs separate from headline timing runs.
- Store raw JSON/CSV artifacts with the tested commit and environment manifest.

## Go/no-go gates for optimized lookup work

An optimized representation should proceed only if it demonstrates at least one material benefit without correctness loss:

- meaningful end-to-end latency or throughput improvement on target workloads;
- meaningful compressed shared-runtime reduction;
- meaningful total font-asset reduction;
- materially lower startup allocations or peak memory;
- a capability required by the canonical format or direct GPU path.

The exact numeric thresholds are a maintainer decision after Phase 1 establishes baselines. Kernel-only improvements do not qualify if total shaping or package outcomes regress.

## Regression gates before release

Candidates for CI gates after baselines stabilize:

- compressed shaper and normal-path JS size;
- cold Wasm instantiate time;
- short-label p95 shape latency;
- long-paragraph throughput;
- Latin width-only reflow p95 and Wasm call count;
- Arabic boundary-reflow p95;
- worker bake time/peak memory for one reference font;
- canonical section sizes;
- first drawable frame for one pre-baked Slug and MTSDF font.

Thresholds must include expected measurement noise and require confirmation before blocking a change.

## Phase 1 benchmark deliverable

The first benchmark report must answer:

1. What is the minimal HarfRust Wasm size and cold-start cost under the intended build settings?
2. What does one coarse batched shaping call cost compared with repeated calls?
3. How much time is Unicode/script/buffer work versus font-table access for the selected corpus?
4. What are the size and registration costs of shaping-only reference data?
5. Does the proposed shaped-buffer ABI cause copying or allocation that dominates short strings?
6. What baseline will later compiled lookup and SIMD experiments be required to beat?
