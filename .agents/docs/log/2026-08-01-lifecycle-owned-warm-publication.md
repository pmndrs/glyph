---
type: Log Entry
title: 'Lifecycle-owned warm publication'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added synchronous cache peeks for registered font loads, initialized shapers, and current decoded raster resources. Resident `Text` updates now shape, lay out, plan paint, and stage without crossing a Promise boundary, retain the previous generation until Three.js object traversal, and publish before raster children. React Suspense continues to own genuinely cold preparation; the React integration performs no consumer `ready` wait and explicitly invalidates its R3F root after core updates. Asynchronous plugin preparation is carried forward under one abort controller rather than probed and restarted. Adversarial findings led to shared staging logic, paint-only layout/page reuse, abort propagation across multi-font preparation, valid replacement preservation after superseded-font disposal, both Three matrix-update entry points, and defensive sibling traversal after a plugin violates the infallible-commit contract. The complete browser conformance lane proves 3/3 exact R3F reconciliations through explicit renderer traversal and 3/3 exact 68-frame Advanced Shaping timelines with five cold observations, 63 warm lifecycle publications, and zero warm readiness waits per sample; the packed consumer remains exact. Against the preceding transaction layer, browser core grows by 8,070 raw / 5,005 minified / 966 gzip / 795 Brotli bytes; Bitmap, MTSDF, and Slug runtime closures grow by 8,064/4,998/1,055/755, 8,064/4,998/1,065/808, and 8,064/4,997/973/657 bytes respectively. Baker hosts and Wasm remain byte-identical.
