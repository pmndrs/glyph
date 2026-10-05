---
type: Log Entry
title: 'Repository formatter authority'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the benchmark and Glyph package-local Oxfmt policies with one root configuration. Authored code and documentation now share a 120-column, semicolon-enabled, single-quote, trailing-comma style from every working directory; compiler-generated sources and authenticated fixtures remain byte-preserved exclusions rather than formatter inputs.
