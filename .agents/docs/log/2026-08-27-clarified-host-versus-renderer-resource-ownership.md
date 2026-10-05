---
type: Log Entry
title: 'Clarified host versus renderer resource ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The host owns portable policy/font registrations and sessions,
not Canvas, device, context, bind-group, material, or pipeline objects. WebGPU canvases configured with one device may
share one renderer realization pool; different WebGPU devices and WebGL contexts require separate pools while still
consuming one host's portable bindings. The reviewed HTML implementation report now lives durably under `.agents/docs/reports`.
