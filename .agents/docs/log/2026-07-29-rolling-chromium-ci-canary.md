---
type: Log Entry
title: 'Rolling Chromium CI canary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced CI's Playwright browser download with explicit discovery of the GitHub Ubuntu runner's rolling system Chromium. One package-owned launcher routes every direct Playwright launch through an optional project-specific executable path while preserving the managed local default, logs the actual launched version, and adds that exact value beside the potentially reduced user agent in headless benchmark summaries. Focused Node tests protect both branches and reject an empty override; historical Chromium 149 fixture names and goldens remain unchanged.
