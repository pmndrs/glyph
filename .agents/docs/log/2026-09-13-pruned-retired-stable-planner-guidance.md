---
type: Log Entry
title: 'Pruned retired stable-planner guidance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed live integration-guide, API, fragment-placement, dirty-range, and
package-reference prose that still described allocation strategy selection, logical-order buffers, or the stable
planner as current. D-362 and this append-only log retain the historical decision and evidence; ordered storage is now
documented as the sole physical plan without adding benchmark or size claims before final verification.
