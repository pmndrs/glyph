---
type: Log Entry
title: 'Bounded Three residency and retained draw identity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Applied exact Rust buffer/resource retirements to dependent
material and texture realizations, retaining shared renderer resources until their final plan reference leaves. The
compiled-Wasm fixture now checks exact live storage-plus-resource bytes after Bitmap → MSDF → Slug transitions.
Lifecycle-only reorder retains the same meshes/geometries/materials and changes range/order metadata; coalescing
retains one compatible draw and retires only the other. Live backend submission still owns native-fence proof.
