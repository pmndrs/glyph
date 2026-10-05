---
type: Log Entry
title: 'Justification controls (11.14, layer 3)'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Justify grows professional bounds. Word spaces expand uniformly up
to the declared maximum ratio of their natural advance sum; the remaining deficit spills into inter-cluster
letter gaps bounded per gap, and any residue reads as an under-full line. A declared minimum ratio makes spaces
elastic in the other direction twice over: the line breaker lends the shrinkable fraction back while scanning —
admitting the word that would otherwise just overflow, via a new `CLUSTER_SPACE` flag stamped at cluster build —
and the positioning pass compresses those spaces to exactly the same bound. The last-line policy (`auto` |
`justify`) now also covers hard-broken lines. Measurement mirrors every branch through the shared
`positioned_fragment_advance`. Proven red-green with distribution unit tests (cap spill, shrink clamp, last-line
gates), a breaker admission test, and a Three integration segment: an unbounded justified last line fills its
exact box, while capped word growth plus a 0.5 letter-gap bound lands at natural-plus-gaps exactly.
