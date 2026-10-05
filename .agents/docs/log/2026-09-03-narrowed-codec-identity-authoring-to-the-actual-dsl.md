---
type: Log Entry
title: 'Narrowed Codec identity authoring to the actual DSL'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`/config/codec` now exposes only buffer, technique, program,
and baked-resource identity helpers. Handle-scoped Codec, font, root-planning, paragraph, style, material, layout, and
live-resource identities moved under package-private engine state, along with capability-set wire selection. Exact
membership in the already-compiled Codec descriptor replaces a redundant second validation pass.
