---
type: Log Entry
title: 'Hero rebuilt as The Living Page on the 0.2.0 API'
generated:
  by: process:docs-new
  at: '2026-11-24T05:18:09Z'
---

Added `apps/hero` on `experiments/sil-hero`, replacing the September hero from `feat/hero-demo` with "The Living
Page": one continuous shot over an editorial spread that Glyph lays out, reflows, edits and breaks apart live. The
[package concept](../packages/hero.md) describes how it uses flow regions and exclusions, `split()` glyphs with
per-letter springs, exact `replace` edits that keep a letter's identity while it is a rigid body, the editing
queries, and `position`/`paragraphPosition` in materials. It changes nothing in `packages/glyph`. `hero:capture`
steps the piece in Chromium with WebGPU and reports GPU and step time per beat; `benches/scripts/workflows.mts`
gained the `apps/hero/scripts` root so the hero's workflows are listed.
