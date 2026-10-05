---
type: Log Entry
title: 'Text layering contract'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made framework-neutral `Text` a composite `Object3D` so it honors caller-owned parent Group ordering, while `Text.renderOrder` becomes the base for each generated drawable's raster-local order. Bitmap, MTSDF, Slug, and the external raster proof implement the public base-order method and use neutral `Object3D` batch roots; the adapter rejects nested raster Groups, and focused tests cover cold publication, changes without reshaping, retained updates, React Object3D props, and multi-font spans. Against the parent stack layer, browser core grows by 707 raw / 504 minified / 152 gzip / 144 Brotli bytes; Bitmap, MTSDF, and Slug runtime closures grow by 1,164/717/216/294, 1,288/781/232/311, and 1,237/774/254/186 bytes respectively. The reviewed absolute and cumulative JavaScript ceilings advance only where those production paths grew. Ordinary builds consume the checked-in canonical size record instead of rewriting it with host-specific measurements; the explicit size-generation workflow remains its sole writer, while tests measure the current host read-only against the reviewed ceilings.
