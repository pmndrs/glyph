---
type: Performance Experiment
title: Wasm allocator experiment
description: Defines the allocator candidates, workloads, measurements, and selection gate for the no_std font baker.
resource: ../../packages/font-baker/rust/Cargo.toml
tags: [baking, wasm, allocator, performance]
sources:
  - id: "citation-1"
    resource: "https://docs.rs/lol_alloc/latest/lol_alloc/"
    title: "`lol_alloc` documentation"
  - id: "citation-2"
    resource: "https://github.com/yvt/rlsf"
    title: "`rlsf`"
  - id: "citation-3"
    resource: "https://github.com/EmbarkStudios/rpmalloc-rs"
    title: "`rpmalloc` Rust wrapper"
  - id: "citation-4"
    resource: "https://github.com/rustwasm/wee_alloc"
    title: "`wee_alloc`"

generated:
  by: "openai-codex/gpt-5"
  at: "2026-07-25T01:24:00Z"
---

# Wasm allocator experiment

Status: proposed experiment; `dlmalloc` is the implementation baseline, not the final performance decision

The portable font baker performs substantial temporary allocation while parsing tables, rebuilding SFNT bytes, collecting glyph extents, serializing GLB data, and returning an artifact. The allocator is private behind the versioned C ABI, so it can change without changing JavaScript callers or baked bytes.

## Candidate disposition

| Candidate | Status | Fit for this workload |
| --- | :---: | --- |
| Rust `dlmalloc` | 🟡 baseline | Already compiles for the `no_std` Wasm package and supports reuse across repeated bakes. Measure it before replacing it. |
| `rlsf::SmallGlobalTlsf` | 🟡 benchmark | Explicitly supports non-atomic `wasm32`; TLSF provides constant-time allocation/deallocation and reusable pools. This is the primary challenger. |
| `lol_alloc::LeakingAllocator` | 🟡 conditional benchmark | O(1), very small, and plausible when one Worker instance performs exactly one bake before termination. It never frees or reuses memory, so it is not a general repeated-bake allocator. |
| `lol_alloc::FreeListAllocator` | ⬜ optional benchmark | Small and reusable, but allocation/free cost grows with free-list length. Test only if code size dominates and fragmentation remains controlled. |
| `wee_alloc` | ⬜ low priority | Very small, but its main allocation path is O(n) and its own guidance says it is a poor choice when allocation is a bottleneck. |
| `rpmalloc` Rust wrapper | ❌ exclude from browser lane | The wrapper documents desktop x86-64 targets rather than `wasm32-unknown-unknown`; its native/thread-cache strengths do not justify adding an unsupported platform path. |

## Benchmark workloads

Use the shared benchmark harness when its package-size and Worker lanes exist. Each candidate must run the same optimized Wasm build and canonical inputs:

1. one cold valid bake followed by Worker termination;
2. four sequential valid bakes in one Worker instance;
3. mixed small/large faces to expose fragmentation and memory growth;
4. repeated malformed inputs to cover cleanup on error paths;
5. cancellation at the host boundary between requests.

Record raw and Brotli Wasm bytes, cold and warm bake time, peak linear-memory pages, retained pages after each request, artifact hash parity, and allocator-induced traps. Do not select an allocator from microbenchmarks that omit font parsing and GLB construction.

## Selection gate

Keep `dlmalloc` until the benchmark harness shows a material improvement with identical artifacts and diagnostics. Prefer `rlsf` if it improves repeated-bake time or retained memory without an unacceptable payload increase. Use a leaking bump allocator only if the Worker lifecycle is explicitly one request per instance and total wall time, including Worker startup, wins on the representative corpus.
