---
type: Decision
title: 'A bake keeps every OpenType layout feature unless --layout-features narrows it'
description: 'A bake keeps every OpenType layout feature, with or without --unicodes, unless --layout-features names the ones to keep in addition to the features shaping needs.'
decision_status: Proposed
decided: '2026-11-24'
generated:
  by: process:docs-new
  at: '2026-11-24T19:31:35Z'
---

# A bake keeps every OpenType layout feature unless --layout-features narrows it

## Decision

- With no `--layout-features` (`layoutFeatures` omitted, or `*`), a bake keeps every feature the source has, whether or
  not it names `--unicodes`. A Unicode subset selects code points, not features.
- `--layout-features <tags>` keeps the named four-character tags plus `skera::DEFAULT_LAYOUT_FEATURES` (hb-subset's
  default list). No list can drop that set, so a selection cannot break script shaping. Glyphs only a dropped feature
  reaches are not baked.
- The selection is part of the prepared bytes, so the source fingerprint, the up-to-date check and `--check` compare it;
  no separate artifact field records it.

## Why

Justin, 2026-11-24: "a subset limits characters, not features", then asked for one option with the same default for
full and subset bakes. Style `features` accept any tag, so a default that prunes features is a silent no-op for the
caller. Narrowing by a keep-list mirrors `--unicodes` and hb-subset's own `--layout-features`; unioning it with the
default list keeps the features HarfBuzz-style shaping applies unasked. Evidence:
[issue 02](../issues-0.2.0/02-subset-drops-discretionary-features.md) (feature sets and glyph counts equal to HarfBuzz
14.4.0's `hb-subset`).

## Consequences

Subset assets grow by the alternates of their code points (the ASCII Inter app asset 3.7x). Apps that need small
assets narrow `--unicodes` or pass `--layout-features`. Open: the runtime worker bake behind `loadFont` does not take
`layoutFeatures` yet, and there is no drop-list form.
