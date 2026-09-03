---
type: Technical Explanation
title: Untrusted-resource validation library admission
description: Defines a measured comparison between package-owned validators and small schema libraries at resource boundaries.
tags: [validation, security, bundle-size, typescript, research]
sources:
  - id: 'zod-mini'
    resource: 'https://zod.dev/packages/mini'
    title: 'Zod Mini'
  - id: 'valibot'
    resource: 'https://valibot.dev/'
    title: 'Valibot'
  - id: 'ajv-standalone'
    resource: 'https://ajv.js.org/standalone.html'
    title: 'Ajv standalone validation code'
  - id: 'typebox'
    resource: 'https://github.com/sinclairzx81/typebox'
    title: 'TypeBox'
  - id: 'engineering-standard'
    resource: '../engineering/code-style.md'
    title: 'Engineering standard'
generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-07-27T20:18:00Z'
---

# Untrusted-resource validation library admission

Status: research queued; no dependency selected
Purpose: determine whether a maintained validation library can equal or reduce the production cost of the package-owned checks without weakening the untrusted-resource boundary.

## Decision boundary

TypeScript proves calls made by typed consumers; it cannot authenticate bytes, JSON, Worker messages, GLB extensions, raster descriptors, Wasm responses, or values supplied by JavaScript. Those values remain `unknown` until one boundary validation pass produces a trusted internal type. Rendering, shaping, layout, and per-frame update loops must consume that trusted representation without repeating schema walks.

The existing hand-written validators remain the baseline. This study does not authorize a library dependency, move validation into hot paths, or replace semantic checks that a structural schema cannot express.

## Candidates

| Candidate                | Why measure it                                                                          | Important constraint                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package-owned validators | Current production baseline with explicit paths, limits, and semantic checks            | Repetition can drift when wire contracts evolve                                                                                                                            |
| Zod Mini                 | Functional, tree-shakable Zod 4 surface designed for strict browser bundle budgets      | Official examples still measure about 2.12 KiB gzip for a boolean parse and 4.0 KiB gzip for a small object; the actual resource corpus must justify that floor[^zod-mini] |
| Valibot                  | Modular imports and a stated sub-700-byte starting bundle                               | The project must measure the exact selected schemas and issue formatting rather than reuse vendor headline numbers[^valibot]                                               |
| Ajv standalone           | Generates ESM validation functions at build time without initializing Ajv in production | Generated code may be compact for canonical JSON Schemas, but custom keywords, error mapping, and semantic passes remain package-owned[^ajv-standalone]                    |
| TypeBox                  | Couples static inference with JSON Schema and provides compiled or dynamic validation   | Its broader schema/compiler surface is useful only if the selected imports tree-shake below the current boundary and do not recreate a second contract authority[^typebox] |

Regular Zod is not an initial candidate because Zod Mini exists specifically for this bundle-constrained case. Libraries may be removed from the experiment after a minimal closure exceeds the complete hand-written baseline.

## Representative boundary corpus

Every candidate must validate the same values and return the same normalized trusted types:

1. PMNDRS core and raster extension JSON decoded from GLB;
2. bitmap and MTSDF descriptors, dense records, page metadata, and external-resource declarations;
3. runtime-baker Worker request, progress, result, error, and cancellation messages;
4. direct-memory Wasm ABI metadata and bounded response framing;
5. benchmark-only imported result/report data, kept out of published runtime graphs.

Structural validation is only the first layer. Checked arithmetic, reciprocal identities, byte ranges, overlap rules, cryptographic hashes, KTX2/GLB parsing, font semantics, resource budgets, and ownership state remain explicit package logic.

## Experiment

Build each candidate from a separate ESM entry with the repository's pinned compiler and production bundler settings. Record the dependency closure rather than quoting package install size.

| Evidence        | Required measurements                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Transfer cost   | raw, minified, gzip, and Brotli bytes for one representative schema and the complete selected boundary corpus              |
| Tree shaking    | the exact module graph for browser core, each raster runtime, each lazy baker, Worker entry, and validator-only entry      |
| Cold work       | module evaluation plus any schema compilation or initialization                                                            |
| Validation work | valid and invalid p50/p95 time, allocations, and peak retained bytes over fixed small/representative/limit inputs          |
| Correctness     | the existing positive, one-invalid-field, malformed-container, fuzz-regression, depth, length, and arithmetic-limit corpus |
| Diagnostics     | deterministic error code and path mapping without exposing vendor-specific errors as public API                            |
| Maintenance     | one authoritative schema/type definition, generated-artifact reviewability, upgrade surface, license, and release cadence  |

Run timing outside rendering samples and use enough deterministic iterations to measure boundary work without sleeps or pass/fail thresholds derived from a noisy workstation. Record observations in authenticated evidence; correctness and byte ceilings remain hard gates.

## Admission rule

A library may replace a hand-written structural layer only when all of the following are true:

- it accepts and rejects the complete existing corpus identically;
- it preserves explicit resource limits and normalized package-owned errors;
- its selected production graph is no larger than the hand-written baseline in minified, gzip, and Brotli forms;
- it does not enter shaping, layout, rendering, per-frame updates, or a raster module that does not use it;
- schema construction or compilation occurs at build time or once at module initialization, never per value;
- it reduces contract duplication rather than adding a schema beside unchanged hand checks;
- packed-package and consumer-bundler tests prove the claimed tree-shaking and lazy boundaries.

If no candidate meets every gate, retain the hand-written validators and use generated tests or schema-derived fixtures to reduce drift. A slightly larger library can be reconsidered only through an explicit architectural decision with a quantified maintenance or correctness benefit; this research does not pre-approve that trade.

## Expected output

The study should produce one checked-in comparison report, reproducible size entries, deterministic boundary benchmarks, and a keep/replace decision in the canonical decision register. Until that report exists, the package manifest does not gain Zod Mini, Valibot, TypeBox, or a production Ajv runtime dependency.

[^zod-mini]: Zod documents `zod/mini` as a functional, tree-shakable API and explicitly recommends measuring the caller's own schema graph.

[^valibot]: Valibot attributes its small starting size to modular imports and bundler dead-code elimination.

[^ajv-standalone]: Ajv supports build-time generation of ESM validator functions that run without initializing Ajv.

[^typebox]: TypeBox provides JSON-Schema-producing types and a schema compiler; its current ESM surface still requires an exact closure measurement for this repository.
