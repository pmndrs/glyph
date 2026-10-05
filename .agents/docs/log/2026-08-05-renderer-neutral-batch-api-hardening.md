---
type: Log Entry
title: 'Renderer-neutral batch API hardening'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the provisional one-text-generation extraction sketch with one explicit many-item batch contract for paragraphs, labels, and font-backed icons. The draft API separates asynchronous loading from synchronous or Worker paragraph preparation, adds stable item handles, caller-requested growable/fixed capacity, deterministic item ordering, touched-item atomic updates, renderer-owned physical chunking, and owned glyph snapshots with reversible displayed-origin writes. The execution plan now compares the current Three.js API directly, sequences the portable technique split and headless batch before Three migration, requires Bitmap/MTSDF/Slug through a Wayfare/TypeGPU proof, and rejects TypeGPU shader canvas as the primary engine proof because its current public surface is fullscreen-fragment-only.
