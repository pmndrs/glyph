---
type: Log Entry
title: 'Core host and session ownership are now enforceable'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Registrations are claimed per Wasm instance and host,
cross-host frame references fail before invalidating the last publication, and scoped ID provenance follows a
successful registration. Live sessions retain their policy and font stacks; failed disposal remains retryable.
Owned publication copies now use package-private runtime provenance instead of an exported forgeable symbol. Copying
does not advance renderer acceptance. Three consumes the A/B borrow directly, preserves realization errors without
retrying unchanged frames, and requests a fresh checkpoint only after explicit renderer-relevant invalidation. Malformed
emitted plans remain engine defects rather than recovery input. Semantic measurement no longer advances the device
acceptance fence after a failed realization, and same-session owned copies now answer `isExpired()` as permanently live.
Owned-publication runtime provenance is documented as realm-local; worker receivers call
`TextEngineRenderPlanView.bindBytes()` on transferred self-owned bytes instead of pretending a WeakSet witness survives
structured cloning. That call now rejects ABI, status, and every render or semantic table framing mismatch before
transactionally rebinding its reader. Rejected Three realization makes positioned inspection return `undefined` without
an engine retry, and fixed-capacity candidate rejection releases its provisional stack and material leases. The core
reference also fixes the lifecycle map: compiled payloads are portable data, while each renderer owns per-device GPU
realization and cross-session leases.
