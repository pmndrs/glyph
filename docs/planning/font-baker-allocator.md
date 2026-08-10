---
type: Performance Experiment
title: Wasm allocator experiment
description: Defines the allocator candidates, workloads, measurements, and selection gate for the no_std font baker.
resource: ../../packages/text/rust/font-baker/Cargo.toml
tags: [baking, wasm, allocator, performance]
sources:
  - id: 'citation-1'
    resource: 'https://docs.rs/lol_alloc/latest/lol_alloc/'
    title: '`lol_alloc` documentation'
  - id: 'citation-2'
    resource: 'https://github.com/yvt/rlsf'
    title: '`rlsf`'
  - id: 'citation-3'
    resource: 'https://github.com/EmbarkStudios/rpmalloc-rs'
    title: '`rpmalloc` Rust wrapper'
  - id: 'citation-4'
    resource: 'https://github.com/rustwasm/wee_alloc'
    title: '`wee_alloc`'
  - id: 'citation-5'
    resource: 'https://docs.rs/talc/latest/talc/'
    title: '`talc` documentation'
  - id: 'citation-6'
    resource: 'https://github.com/SFBdragon/talc/blob/master/talc/README_WASM.md'
    title: '`talc` WebAssembly allocator guidance'

generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-07-28T04:52:01Z'
---

# Wasm allocator experiment

Status: complete; pinned dynamic Talc 5.0.4 is selected

The portable font baker performs substantial temporary allocation while parsing tables, rebuilding SFNT bytes, collecting glyph extents, serializing GLB data, and returning an artifact. The allocator is private behind the versioned C ABI, so it can change without changing JavaScript callers or baked bytes.

## Candidate disposition

| Candidate                                |            Status            | Fit for this workload                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | :--------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust `dlmalloc`                          |     ✅ measured baseline     | Supported reuse, but produced the largest optimized module in all four lanes.                                                                                                                                                                                                                                             |
| `rlsf::SmallGlobalTlsf`                  |        ⏸️ not needed         | Explicitly supports non-atomic `wasm32`; retain as a challenger only if Talc later regresses. Talc already cleared the size and lifecycle gates, so another allocator is not product work.                                                                                                                                |
| `talc::wasm::WasmDynamicTalc` 5.0.4      |         ✅ selected          | The documented dynamic Wasm owner grows linear memory on demand and preserves a small initial memory. It reduced every optimized module while retaining the existing ownership, error, and reused-Worker suite.[^citation-6]                                                                                              |
| `talc::wasm::WasmArenaTalc` with 128 MiB |      ❌ reject globally      | It saved only 32 gzip bytes versus dynamic Talc in the representative font-baker module, increased Brotli by 259 bytes, raised initial memory from about 1.1 MiB to about 129 MiB, and imposed a fixed ceiling. The documented arena remains useful only when that reservation and lifetime are intentional.[^citation-6] |
| `lol_alloc::LeakingAllocator`            |   🟡 conditional benchmark   | O(1), very small, and plausible when one Worker instance performs exactly one bake before termination. It never frees or reuses memory, so it is not a general repeated-bake allocator.                                                                                                                                   |
| `lol_alloc::FreeListAllocator`           |    ⬜ optional benchmark     | Small and reusable, but allocation/free cost grows with free-list length. Test only if code size dominates and fragmentation remains controlled.                                                                                                                                                                          |
| `wee_alloc`                              |       ⬜ low priority        | Very small, but its main allocation path is O(n) and its own guidance says it is a poor choice when allocation is a bottleneck.                                                                                                                                                                                           |
| `rpmalloc` Rust wrapper                  | ❌ exclude from browser lane | The wrapper documents desktop x86-64 targets rather than `wasm32-unknown-unknown`; its native/thread-cache strengths do not justify adding an unsupported platform path.                                                                                                                                                  |

## Optimized module evidence

All values are bytes from the same pinned Rust 1.97.1 and Binaryen 129.0.0 `-Oz` build on Darwin arm64. Transport columns use deterministic gzip and Brotli settings. The existing complete Rust/TypeScript suites establish artifact and lifecycle parity.

| Module              | `dlmalloc` raw |      Talc raw |  Raw saved | `dlmalloc` gzip |   Talc gzip | Gzip saved | `dlmalloc` Brotli | Talc Brotli | Brotli saved |
| ------------------- | -------------: | ------------: | ---------: | --------------: | ----------: | ---------: | ----------------: | ----------: | -----------: |
| Portable font baker |        432,339 |       422,538 |      9,801 |         167,671 |     164,319 |      3,352 |           136,354 |     134,012 |        2,342 |
| Bitmap baker        |        620,169 |       606,799 |     13,370 |         231,001 |     226,586 |      4,415 |           177,329 |     173,780 |        3,549 |
| MTSDF baker         |        530,661 |       516,561 |     14,100 |         205,119 |     200,991 |      4,128 |           160,758 |     156,823 |        3,935 |
| HarfRust shaper     |        689,651 |       680,312 |      9,339 |         256,794 |     253,568 |      3,226 |           201,660 |     199,365 |        2,295 |
| **Corpus total**    |  **2,272,820** | **2,226,210** | **46,610** |     **860,585** | **845,464** | **15,121** |       **676,101** | **663,980** |   **12,121** |

## Lifecycle gates

The selected allocator must keep passing the same representative product behaviors:

1. one cold valid bake followed by Worker termination;
2. four sequential valid bakes in one Worker instance;
3. mixed small/large faces to expose fragmentation and memory growth;
4. repeated malformed inputs to cover cleanup on error paths;
5. cancellation at the host boundary between requests.

The complete suite exercises cold initialization, sequential reused-Worker bakes, malformed ownership, cancellation recovery, artifact validation, shaping, Bitmap and MTSDF generation, and exact product fixtures. Talc changes allocator mechanics only; it does not receive credit for the serial MTSDF distance kernel and does not alter the C ABI or artifact format.

## Selection gate

Use pinned `talc::wasm::WasmDynamicTalc` for all four Wasm modules. Do not expose allocator choice in the public API. Do not use a fixed global arena.

A request-local scratch arena remains a valid future optimization only if phase profiling identifies a material allocation cost and the implementation proves that every object in the arena dies together. Persistent Worker registries, returned artifacts, borrowed ABI results, and cancellation state must remain outside that reset span. Compare the arena against dynamic Talc using complete baker work, peak pages, and byte-identical artifacts; allocator-only microbenchmarks are insufficient.

[^citation-6]: Talc's WebAssembly guidance documents both the dynamically growing allocator and the fixed arena allocator, including the arena's compile-time reservation.
