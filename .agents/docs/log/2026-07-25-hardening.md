---
type: Log Entry
title: 'Hardening'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made shaper result layout and arena publication fallible and pre-sized; allocation exhaustion now returns the existing `RESULT_TOO_LARGE` status instead of trapping after successful shaping, for 664 additional raw Wasm bytes.
