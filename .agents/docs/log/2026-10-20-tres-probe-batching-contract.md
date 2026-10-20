---
type: Log Entry
title: 'Correct the Tres probe batching contract'
generated:
  by: process:docs-new
  at: '2026-10-20T13:13:34Z'
---

The repository check exposed a stale Slug expectation in the [Tres playground](../packages/tres-playground.md) live probe. The app README already specifies two greeting draws (Latin and icon) plus the label group's single draw. The producer selects the outermost default `auto` TextGroup as a separate batching boundary, so sharing a Slug material and font does not merge the greeting into that group.

An authenticated preceding HELD archive (`2e4342243c55edb56d3a1a32cbd730185c8d172fa5634da9c1f8fc3b0edd9558`) supplied shaper `244078b186e9de0414331ff9de2632c8a57c4ec20f19b6e0a41ce964f8e1b30a` through temporary test-only Vite middleware. Its served hash was logged. The unchanged probe failed with a committed Slug greeting and three draws/25 records while expecting two. The corrected probe passes against that preceding shaper and the frozen combined candidate (`340cbe186620e51f7d0ec460e473d72332c1c112d6c07dfd7dab4e63f74f6804`; shipping shaper `1f8d970cd74eafd2aedd5adb98abd64d002ac0ebd370fa40e936dc4dbd8a6fbf`). The candidate's named playground check passes all three raster formats.

The correction requires the greeting and all three label paragraphs to be committed, no greeting/group errors, three draws partitioned into 1, 10 and 14 records, and the existing backdrop condition. It adds no delay, retries or timer padding. Temporary middleware was removed; runtime source, package bytes, dependencies and application behavior are unchanged. This is a probe-contract correction, not a performance result. Raw negative/positive controls and numeric exits are preserved in the local wave evidence under `tres-probe-contract/`; fresh scoped review and the final repository/downstream gates are recorded separately.
