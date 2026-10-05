---
type: Log Entry
title: 'Single coverage validation authority'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed unused Bitmap and MTSDF validation-context coverage fields; standalone validators now expose only the authenticated descriptor as expected coverage authority, eliminating a public input that could silently disagree.
