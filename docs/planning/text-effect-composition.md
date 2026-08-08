---
type: Research Concept
title: Three.js text effect composition
description: Superseded proposal for a bespoke TSL effect layer; custom material authority is the selected direction.
documentation_type: explanation
tags: [rendering, effects, tsl, threejs, superseded]
status: deprecated
sources:
  - id: material-authority
    resource: three-material-authority.md
    title: Three material authority
  - id: core-api
    resource: core-api.md
    title: Core material routing
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-08T00:00:00Z'
---

# Three.js text effect composition

This proposal is superseded. The package will not add `TextEffect`, `defineTextEffect`, effect lists, an effect parameter
schema, or an effect graph registry. Those concepts duplicate renderer material systems and do not provide ordinary
lighting, depth, shadow, or pipeline authority.

The selected Rust route carries numeric `material_id` values from the resolved text/span cascade into policy-shaped draw
packets. The exact Three material-factory API remains under design in [Three material authority](three-material-authority.md).
Reusable TSL functions remain ordinary application helpers for constructing a material; they are not a second text-core
rendering vocabulary.

This file remains only to make the rejected direction and its replacement discoverable.
