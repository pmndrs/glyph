---
type: Log Entry
title: 'Retained policy inputs and rebuilt only from the first storage mismatch'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Gathered field-major policy inputs now
commit under the exact session revision, policy fingerprint, and capability set. A one-byte selection lane skips
binding/resource/policy work for zero-change glyphs; changed records update only reachable fields. Identity replacement
stays in the same physical topology, while technique, program, resource, transform, material, clip, or depth changes
retain the verified prefix and fully gather the suffix. Commit/abort and disposal tests cover cache lifecycle, and an
oracle proves identity/field updates plus a material-triggered suffix rebuild. The unchanged optimized 101-update lane
improves from 2.607/6.184 to 1.314/5.863 ms median/p95 with five roughly 1.2 KiB patches. RSD remains 76.2%, so the
break-sensitive tail is open. Optimized Wasm grows 5,856 bytes to 1,153,122; retained high-water memory is 80.19 MiB.
