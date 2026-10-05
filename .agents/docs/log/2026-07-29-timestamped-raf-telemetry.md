---
type: Log Entry
title: 'Timestamped RAF telemetry'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Decoupled CPU and FPS history from delayed GPU query delivery through a 1,024-frame shared timestamp ring. Every frame receives the latest resolved GPU duration; one-resolution-at-a-time WebGPU sampling uses Three's resolved renderer-frame identity to refresh the still-pending slots, while WebGL polls its per-frame queries on the renderer RAF. The three canvases now scroll one shared eight-second time domain continuously without interpolating sample heights, restarting an easing transition, or reducing GPU to a sparse series. Presentation floating surfaces consistently use 80%-black composition with opaque borders, and the telemetry rail owns one real background plus opaque dividers.
