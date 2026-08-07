---
type: Architecture Decision Record
title: Raster and container contracts
description: Records the accepted GLB companion, GPU-ready payload, bitmap, MTSDF, and Slug architecture.
status: stable
tags: [architecture, gltf, raster, bitmap, mtsdf, slug]
sources:
  - id: decision-register
    resource: ../decision-register.md
    title: Decision register
  - id: raster-contract
    resource: ../raster-data-contract.md
    title: Raster data contract
  - id: extensions
    resource: ../extensions/index.md
    title: glTF extension drafts
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T01:16:02Z'
---

# ADR 0003: Raster and container contracts

Date: 2026-07-26  
Status: Accepted  
Decisions: D-021–023, D-034, D-050–053, D-055–059, D-061–065, D-070, D-073, D-075–076, D-084, D-089, D-091, D-093

## Context

Shaping data and raster payloads have different lifecycles, coverage, sizes, and GPU formats. Consumers need embedded and independently hosted delivery without changing identity or runtime semantics, and optional raster engines must remain tree-shakable.

## Decision

The provisional `PMNDRS_font` GLB family separates one shaping core from typed raster companions. Embedded and external forms use the same schema and reciprocal identity. Raster packages own final fixed-stride GPU records and lossless KTX2 payloads; direct-to-GPU means no semantic reconstruction or record repacking. Merged v0 contains Bitmap, linear RGBA8 MTSDF, and Slug modules; target v1 preserves all three behind the renderer-neutral boundary. Bitmap proves the path at native device-pixel strikes; MTSDF is the general recommendation; Slug owns outline-accurate large and zoomed text.

## Alternatives considered

- One monolithic asset was rejected because independent raster selection and delivery would become impossible.
- Duplicating advances, kerning, or shaping inside rasters was rejected because the universal layout must remain authoritative.
- Plain MSDF beside MTSDF was rejected because parallel encodings and batch families add cost without an accepted product role.
- Reconstructing GPU records at runtime was rejected because it adds CPU work and another correctness boundary.

## Consequences

- Every companion authenticates shaping hash, glyph count/width, raster key, version, buffer ranges, and external hashes before publication.
- Bitmap renders fill and opacity only; unsupported effects reject instead of degrading silently.
- Logical pages are not equivalent to texture layers, binding slots, draws, or residency policy.
- Latin remains the first release rendering corpus; broad CJK paging and icon coverage land after the first release gate.

## Evidence

The bitmap slice proves deterministic maintained-library rasterization, canonical 20-byte records, lossless R8 KTX2, embedded/external parity, hostile-input validation, exact WebGPU/WebGL2 output, device-pixel snapping, resource accounting, and transactional teardown. MTSDF and Slug must satisfy the same contract before their roadmap gates close.
