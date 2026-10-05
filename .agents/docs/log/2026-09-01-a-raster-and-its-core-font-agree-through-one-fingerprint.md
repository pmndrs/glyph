---
type: Log Entry
title: 'A raster and its core font agree through one fingerprint'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Every raster extension carries a single
domain-separated MurmurHash3 x86 128 digest over the compatibility tuple it must share with its core, replacing eight
hand-written multi-field identity checks and retiring the `shapingFingerprint`, `glyphCount`, `glyphIdWidth`, and
`descriptorFingerprint` fields that existed only to be compared. The canonical form is published contract, so a
consumer may keep its own fingerprint-to-metadata manifest, and a third-party technique stamps it through the exported
helper. Page payloads are never external, a font declares one raster per technique, splitting is an explicit request
rather than a duplicate-extension fallback, and no filename carries a content hash. Baking defaults to MSDF, derives a
url-safe output name, and skips work whose artifact is already current.
