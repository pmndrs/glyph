---
type: Log Entry
title: 'Scoped contributor toolchains'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Reduced the root mise install to Node, pnpm, and stable Rust; moved Meson and Ninja into the benchmark workload that provisions authenticated HarfBuzz utilities. Pnpm remains the single command surface, contributors may supply matching versions directly, non-interactive agents use `mise exec --`, and CI explicitly provisions and verifies the optional fixture gate without hiding downloads inside the ordinary check.
