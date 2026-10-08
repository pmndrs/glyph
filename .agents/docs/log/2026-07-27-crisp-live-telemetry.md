---
type: Log Entry
title: 'Crisp live telemetry'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the responsive sparklines' fixed 180×42 backing store with observed CSS dimensions multiplied by the browser display DPR. The preallocated histories and RAF-only drawing path remain unchanged; only canvas presentation resolution changes.
