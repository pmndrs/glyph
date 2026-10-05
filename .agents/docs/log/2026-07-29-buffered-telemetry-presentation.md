---
type: Log Entry
title: 'Buffered telemetry presentation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Moved the shared FPS/CPU/GPU chart head 250 milliseconds behind the renderer RAF clock so asynchronously polled GPU measurements normally settle into their original timestamped slots before display rather than visibly catching up. The delay affects presentation only: rendering, measurement, polling, and the eight-second history remain unchanged. FPS history now smooths frame duration with a 250-millisecond time-based exponential average before converting to a rate, while CPU/GPU timings and the observed refresh-rate ceiling stay unsmoothed. CPU timing now begins at renderer callback entry and includes completed-query polling plus workload animation/update before render submission; it explicitly excludes external React/browser work, presentation, compositing, and RAF wait time.
