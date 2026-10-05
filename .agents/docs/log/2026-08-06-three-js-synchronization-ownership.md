---
type: Log Entry
title: 'Three.js synchronization ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the speculative `Text.updateMode` and `TextGroup.updateMode` properties. One loader-cache domain owns one hidden core runtime; each standalone text or group reconciles membership, invokes the runtime-wide update, commits its staged target revision, delegates ordinary world-matrix traversal, and writes glyph transforms through its `updateMatrixWorld()` override before Three constructs the render list. Core dirty ranges become Three attribute update ranges there; WebGPURenderer performs the actual GPU writes while preparing the internal submission meshes. The core's allocation-free clean path makes repeated calls no-ops, and grouped text disables only its standalone preparation branch without changing caller-owned Three matrix flags.
