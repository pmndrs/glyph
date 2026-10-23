---
type: Engineering Plan
title: Prepared paragraph reads and renderer publication
description: Queries and independent copies consume one durable Rust preparation without publishing the source.
status: draft
sources:
  - resource: decisions/retained-prepare-publish.md
    title: Accepted preparation/publication contract
  - resource: retained-text-assignment.md
    title: Detailed retained layout and lifetime design
  - resource: publication-frontier.md
    title: Active implementation gates
  - resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Rust preparation and publication owner
  - resource: ../../../packages/glyph/src/internal/render-planner.ts
    title: Host preparation and query integration
generated:
  by: openai-codex/gpt-6
  at: '2026-10-12T11:22:21Z'
---

# Prepared paragraph reads and renderer publication

The accepted design has two stages and one layout implementation. A bound setter validates and encodes authored
input, prepares invalid layout stages in Rust, and adopts the prepared revision synchronously. Reads answer from that
revision before any render publication. Preparing one label does not publish or relayout unrelated labels.

| Call                        | Required work                                                                            | Work excluded                                            |
| --------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `set()`                     | Detect change, prepare invalid Unicode/shaping/layout stages, record dirty owners/ranges | Renderer gather, batch realization, GPU submission       |
| `measure()`                 | Read cached summary                                                                      | Repeat preparation or publication                        |
| Glyph/caret/selection query | Materialize requested inspection from prepared layout                                    | Repeat input encoding/shaping or source publication      |
| `split()`                   | Copy selected prepared records and retain independent resources                          | Publish source/root or redo layout                       |
| Publication                 | Gather changed renderer records, update necessary topology/bindings, encode patches      | Rediscover mutations or prepare unchanged semantic state |

```mermaid
flowchart LR
  S[set] --> P[One retained Rust preparation]
  P --> Q[measure / glyphs / caret / selection]
  P --> C[split: independent owned copy]
  P --> D[Accumulated dirty owners and ranges]
  D --> R[Codec / render plan / batching]
  R --> G[Renderer updates]
```

Prepared layout revision and renderer publication generation are separate. Read caching must account for lifetime and
identity changes, including sibling creation/removal, while copies remain independent of later source edits/disposal.
Renderer-owned in-flight storage stays immutable; borrowed query views have explicit lifetimes. Empty roots retain
adapters until teardown. Topology changes and dense updates may broaden renderer work through the same executor.

The former design in this file used a cross-call speculative query transaction, invalidation on mismatched publication,
and A/B compute state as rollback protection. Those are superseded by the accepted decision. Reusable prior-input
scratch is permitted; committed-state undo and hidden retry are not. Main's query-first behavior is the correctness
control; the held refactor adds durable setter preparation and incremental publication. No public API change.

Acceptance and evidence live in the compact tracker; this document does not claim those gates are already passed.
