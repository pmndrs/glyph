---
type: Log Entry
title: 'Route the Tres live gate through Portless'
generated:
  by: process:docs-new
  at: '2026-10-18T01:52:29Z'
---

The [Tres playground](../packages/tres-playground.md) live gate now uses the app's Vite config hook to bind
Vitexec's server to Portless's assigned `PORT` when `PORTLESS_URL` is present. Its existing probe still checks all
three raster formats; the wrapper also fetches the playground through the named Portless route while the server is
listening. The full package check passes without Portless, and the Portless run reports 25 records in 3/3/2 draws
plus `portless-route-ok`.
