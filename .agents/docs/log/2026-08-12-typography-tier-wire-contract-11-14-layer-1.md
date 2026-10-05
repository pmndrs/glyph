---
type: Log Entry
title: 'Typography-tier wire contract (11.14, layer 1)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Constraint records grew 56 → 84 bytes for the professional
typography controls: first-line indent, paragraph space before/after, word-space ratio bounds (each side
independently optional, zero meaning unbounded), letter-space expansion budget, and a closed last-line policy
enum (`auto`/`justify`). Rust decodes, validates, and retains the fields; the raw-byte geometry fingerprint
invalidates on any change automatically; the generated TS ABI, frame-wire encoder (optional inputs, zero
defaults), and record-size pins moved together. Behavior is unchanged in this layer — the fields carry but do
not yet steer layout.
