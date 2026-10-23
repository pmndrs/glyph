---
type: Decision
title: 'Superseded: trust package-owned cluster-aligned span handoffs'
description: 'Historical decision: package-authored arrays carried JS alignment proofs; rust-owned-authored-span-ranges moves range resolution into Rust and removes this provenance system.'
decision_status: Superseded
decided: '2026-10-08'
generated:
  by: process:docs-new
  at: '2026-10-08T18:02:39Z'
---

# Superseded: trust only package-owned cluster-aligned span handoffs

This decision is superseded by [rust-owned-authored-span-ranges](../../planning/decisions/rust-owned-authored-span-ranges.md). It documents the
previous JavaScript alignment and provenance design for history only.

## Decision

Glyph text compilers may attach package-private provenance to the exact frozen span array they resolve against a specific
text value. Three normalization may skip Unicode segmentation only when that exact array and text association is still
present. A framework adapter may transfer the proof to a new frozen array only when every span boundary is unchanged.
Caller-owned arrays, arrays from another package copy, changed text, or changed boundaries take the ordinary validation
and cluster-alignment path.

## Why

React and Vue flatten nested text, align its ranges, then replace each span record while binding loaded fonts. Repeating
the same Unicode segmentation in Three is redundant, but a structural brand or caller assertion would let mutable or
foreign arrays bypass the engine's grapheme-grid contract. The former provenance implementation used exact object identity
and text equality. The [historical integration tests](../../../../packages/glyph/tests/integration/text-mutation-span-alignment.test.mjs)
covered inherited proofs, duplicate/unproven input, changed text, changed boundaries, malformed UTF-16, and fresh raw input.

## Consequences

Package-owned span arrays and records are frozen before they are trusted. Malformed UTF-16 is never marked aligned and
continues to the engine's existing rejection path. The optimization remains internal: no public caller can manufacture
the proof, and package duplication safely costs a repeated alignment rather than weakening correctness. D-265's shared
cluster-boundary rule remains authoritative; this decision only records when repeating that rule can be elided.
