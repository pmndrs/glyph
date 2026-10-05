---
type: Log Entry
title: 'Fixed the compiler-mapped render-plan wire grammar'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Extended the aligned result header from 128 to 144 bytes to
carry policy handle, capability set, and a deterministic validated-policy fingerprint. Added exact semantic, resource,
buffer, patch, primitive, draw, retirement, and diagnostic records plus tagged actions and allocation strategies.
Field-wise little-endian serialization rebases write-patch payloads inside the same immutable A/B publication and
rejects malformed spans before touching its inactive arena. Rust unit tests cover every table and the header-to-table
linkage; real Wasm integration reproduces policy identity, checkpoint/delta revisions, failure isolation, and A/B
immutability. Retained semantic compilation is not yet claimed.
