---
type: Log Entry
title: 'Skip unused preparation publication leases'
generated:
  by: process:docs-new
  at: '2026-10-16T20:32:43Z'
---

The user relaxed the materiality floor and admitted a private preparation-receipt cleanup in the [final plan](../reports/final-performance-architecture-plan.md). `PlanTransport.prepareParagraph` now returns synchronously through an optional semantic consumer. No-view setters still prepare in Rust and check status, bounds and capacities, but omit publication view/object/WeakMap lease creation and eleven unused header reads. The direct planner consumer requests full decoding only for measurement. No new executor, request cache, header rewrite, public contract or Rust instruction change was introduced.

[Portable wave evidence](../../../benches/reports/held-ropes-local-2026-10-16/preparation-receipt-cleanup.json) authenticates candidate `2a7f0317…`, source hashes and all 145 absolute distributions. Build/pack/static/named proof, 1,048 final Node tests, 30 prepared generators,55 minimum-peer tests, production sizes, 16 browser cases and 6 animated-layout cells pass; fresh Sol High review is clean. The preliminary pre-publication Node run is explicitly excluded. Public declarations/manifest and other four Wasms remain exact; all 943 dist members match after the peer rebuild. JS grows 33 gzip bytes. The 473 native tests remain applicable to unchanged Rust source.

One four-block candidate run is reused against main `4e25a96a` and integrity-authenticated registry 0.1.0. Dense regressions remain; inspection remains favorable. Clock drift 6.0% / 8.5% / 33.1%, row exclusions, missing baseline workloads and parser ambiguity prevent blanket latency claims. This is retained as a smaller proven work removal, with no isolated cleanup speedup claim. Candidate requested live/peak maxima are 40,345,423 / 40,553,931bytes; scope and physical-peak exclusions are recorded. Old-archive memory reproduction failed and no paired result is claimed.

The [compact frontier](../planning/publication-frontier.md) records the remaining bitmap-proof, dense, cumulative API/ABI, main-integration and full hero/acceptance gates. Previous ignored ASCII hero source has not been retrieved or authenticated in this checkout, so historical proof is not reused. Owned Portless verification server/proxy are stopped. Stack stays held and unmerged.
