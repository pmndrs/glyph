---
type: Decision
title: Retain assignment API and derive text invalidation in the engine
description: Optimize whole text assignments through retained engine storage and use Labs as the performance gate.
decision_status: Accepted
decided: '2026-10-09'
sources:
  - resource: ../retained-text-assignment.md
    title: Retained text assignment plan and evidence gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-09T14:00:00Z'
---

# Retain assignment API and derive text invalidation in the engine

## Decision

Keep public `Text.set()` and assignment ergonomics. Optimize packed comparison and retained invalidation inside the
existing pipeline. Do not construct a detailed multi-island edit table in JS or require a new public edit API. Rust SWAR,
fused JS packing, and rope-style storage are candidates to measure, not selected implementations. Labs is the performance
gate; hero frame-time testing is not required for this refactor.

## Why

The user explicitly chose this direction on 2026-10-09. A full assignment needs discovery, but unchanged text should not
force downstream shaping, layout, gather, and publication. The [plan](../retained-text-assignment.md) separates that
research inference from measured evidence and identifies existing benchmark coverage and its sparse-update gap.

## Consequences

This supersedes the proposed JS multi-island edit-table producer and the proposed hero frame-time acceptance gate.
Preserve the internal ordered mutation ABI and abort/retry semantics. Integrate changes into normal adapter/engine flows,
retire replaced paths, and validate retained results against cold/full recomputation. An explicit edit API is deferred.
Tree storage, comparison kernel choice, and remaining performance improvements are open pending Labs evidence.
