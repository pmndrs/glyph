---
type: Log Entry
title: 'Probe lifecycle'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the mobile product probe's fixed-port child process. Its Vite server now selects an available local port and shares transactional cleanup with headed Chromium, so an occupied development port or browser-launch failure cannot strand the responsive evidence lane.
