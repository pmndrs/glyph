---
type: Log Entry
title: 'Registered ordered font-stack ownership in Rust'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added cold, direct-memory font-stack lifecycle operations with
nonempty/unique member validation, exact-order idempotence, conflict detection, and member-font retention. A
compiled-Wasm test registers a real baked Inter font, proves disposal fails while its stack is live, releases the
stack, and then disposes the font. Size measurement rejected a generic tree map at 837,865 raw / 312,057 gzip /
246,478 Brotli bytes in favor of a compact cold vector at 828,401 / 309,252 / 244,402. Technique/resource binding and
fallback shaping remain open, so this adds no frame latency claim.
