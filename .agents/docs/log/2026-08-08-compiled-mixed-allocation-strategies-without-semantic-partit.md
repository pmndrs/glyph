---
type: Log Entry
title: 'Compiled mixed allocation strategies without semantic partitions'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a retained dispatcher that keeps the
homogeneous ordered-direct or stable-indirect path as one compiler and one direct plan view. A heterogeneous frame
lets both compilers filter the same borrowed glyph/field slices, then merges only resource, buffer, patch, primitive,
draw, retirement, and payload records. Disjoint low/high buffer-ID namespaces make the merged bindings unambiguous;
shared resources are validated and retained across an allocation-strategy transition; draws recover original global
order. Alternating-strategy, transition, mixed no-op, and settled-capacity tests pass. The dispatcher remains
unreachable from `text_update`; optimized Wasm stays 739,909 raw / 214,395 Brotli bytes. The unchanged shipping path's
25,515-glyph cold/font-size/width/text medians are 57.18/12.44/8.58/39.28 ms, so session integration and target timing
remain open rather than inferred.
