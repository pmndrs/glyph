---
type: Log Entry
title: 'Packed-consumer fixture'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Chrome 150 began requesting `/favicon.ico` for the synthetic packed-tarball consumer after its Worker had already returned the exact artifact; the fixture's strict console gate correctly exposed Vite's incidental 404. The document now declares a self-contained data-URL favicon, and future browser-resource failures retain their console source or HTTP status, resource type, and URL instead of collapsing to an unidentified 404.
