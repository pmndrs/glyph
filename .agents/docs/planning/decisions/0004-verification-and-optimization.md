---
type: Architecture Decision Record
title: Verification and optimization policy
description: Records the accepted conformance, benchmark, local GPU, and evidence-gated optimization architecture.
status: stable
tags: [architecture, testing, benchmarks, conformance, optimization]
sources:
  - id: decision-register
    resource: ../decision-register.md
    title: Decision register
  - id: benchmark
    resource: ../benchmark-plan.md
    title: Benchmark plan
  - id: conformance
    resource: ../conformance-plan.md
    title: Conformance plan
  - id: autoresearch
    resource: ../autoresearch.md
    title: Autoresearch protocol
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-26T19:51:43Z'
---

# ADR 0004: Verification and optimization policy

Date: 2026-07-26  
Status: Accepted  
Decisions: D-060, D-063, D-074, D-079–083, D-090, D-092, D-095

## Context

Rendering correctness, product cost, and experiment throughput answer different questions. Combining them produces misleading timings, invisible correctness failures, flaky automation, or optimizations that win one kernel while regressing the product.

## Decision

One benchmark application exposes two explicit modes over shared fixtures and implementations. Conformance presents reference, candidate, difference, structured results, and validation costs. Benchmark mode continuously reports consumer-facing startup phases, retained sizes, CPU frame time, FPS, and supported GPU time. CI owns deterministic unit, integration, package, schema, headless, and fuzz-smoke gates; GPU-capable Vitexec and explicit Playwright viewports are maintained local lanes. Optimization requires reproducible interleaved A/B evidence, exact quality guards, complete cost accounting, and human acceptance.

## Alternatives considered

- Reporting end-to-end conformance duration as rendering performance was rejected because readback, hashing, oracle, and diff work are test costs.
- Screenshot-only tests were rejected because they do not isolate shaping, layout, payload, or lifecycle errors.
- Timer cushions, arbitrary retries, and regenerated goldens were rejected as flaky correctness mechanisms.
- Automatic optimization acceptance was rejected because visible quality, compatibility, and maintainability tradeoffs require review.

## Consequences

- Benchmark URLs independently encode mode, technique, backend, workload, and DPR.
- WebGPU timestamp queries and WebGL2 disjoint timer queries report explicit unsupported states rather than fabricated GPU values.
- Test state advances through causal application signals and deterministic commands; presentation clocks do not define correctness.
- Autoresearch campaigns fail closed until a checked-in baseline and explicit human enablement exist.

## Evidence

The shared registry drives Vitest, headless Chromium, Vitexec, mobile Playwright, exact browser/reference captures, package-size graphs, and raw results. Negative controls prove the harness detects wrong output and withheld completion; fixed-size telemetry rings avoid measurement-driven allocation growth.
