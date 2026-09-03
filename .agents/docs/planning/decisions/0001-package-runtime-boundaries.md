---
type: Architecture Decision Record
title: Package and runtime boundaries
description: Records the accepted native-ESM, optional-module, Worker, Three.js, and React package architecture.
status: stable
tags: [architecture, esm, worker, react, threejs]
sources:
  - id: decision-register
    resource: ../decision-register.md
    title: Decision register
  - id: architecture
    resource: ../architecture.md
    title: Architecture
  - id: api
    resource: ../api-shapes.md
    title: Runtime and bake API V0
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# ADR 0001: Package and runtime boundaries

Date: 2026-07-26  
Status: Accepted  
Decisions: D-001–009, D-030–032, D-035–036, D-067–068, D-071, D-086–087, D-094

## Context

The product must load and render portable font assets in browsers without forcing Node hosts, runtime baking, React, one raster engine, or platform-specific bindings into every consumer graph. The same implementation must support direct Three.js use and a thin React adapter.

## Decision

`@pmndrs/glyph` is the Three.js-first product core. It publishes native ESM only; optional React, baker, runtime-bake, and raster capabilities live behind explicit subpaths or dynamic imports. The baked-first loader infers canonical sibling artifacts and invokes one module Worker only for fallback. React reconciles the same framework-neutral `Text` object through the repository-pinned R3F WebGPU entry. Raster identities derive from canonical package descriptors rather than caller labels.

## Alternatives considered

- One bundled runtime containing React, every raster, validation, and baking was rejected because consumers would pay for unused capabilities.
- A React-owned implementation was rejected because it would split lifecycle and rendering behavior from direct Three.js consumers.
- CommonJS compatibility and platform binaries were rejected because they multiply artifacts and weaken the browser/Wasm boundary.
- Scanning installed packages or executing application modules during discovery was rejected as nondeterministic and unsafe.

## Consequences

- Every public subpath and the packed tarball require executable ESM and graph-isolation tests.
- Runtime baking pays an explicit asynchronous Worker boundary and is unavailable when retained source bytes do not exist.
- Optional packages must declare their capabilities and cannot mutate core into a closed raster registry.
- React/R3F prerelease gaps may require narrow pinned patches, each with upstream guidance and removal tests.

## Evidence

The package suite imports every packed ESM/resource export, rejects CommonJS, and asserts the module-Worker edge. Independent consumer builds verify that browser core retains runtime baking dynamically while excluding React, raster, Node, validator, Worker, and portable-baker hosts from its initial graph.
