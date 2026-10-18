---
type: Log Entry
title: 'Keep the offline core consumer from auto-installing unrelated peers'
generated:
  by: process:docs-new
  at: '2026-10-18T07:36:31Z'
---

The [benchmark package](../packages/benchmarks.md) packed core/runtime-bake consumer now disables automatic peer installation in its isolated offline pnpm install. CI run [39107239400](https://github.com/pmndrs/glyph/actions/runs/39107239400) passed core, raster and browser conformance checks, then failed when that install selected uncached React19.2.9 despite the workspace locking19.2.8. The consumer imports core/runtime-bake, with no React entry; Glyph marks React optional, while suspend-react has a required React peer. The change removes that ambient auto-peer resolution without adding React, changing peer declarations or allowing an online fallback.

The named static check passes. The actual Portless Chromium gate reaches its post-assertion result: baked artifact SHA b1a2496cd19ac7bb262887e08bf0c83497f210be989f6fab327336a6612a1637,172,108 bytes, matching the independent Inter manifest, plus the blocked-URL negative control and Bitmap load. Its child numeric exit was not preserved because shell status capture used invalid zsh syntax; it remains unknown rather than inferred from the whole-shell exit. Owned proxy/routes stopped and ports verified free. This is a workload observation, not a general proof of peer absence along every module resolution path.

No shipping source, public peer contract or performance timing input changes. The [held wave](../../../benches/reports/held-ropes-local-2026-10-18/README.md) remains valid for its frozen package and harness; dense and other readiness holds remain open. The next exact-head Linux CI run supplies the packed-consumer process verification; no favorable performance retry is involved.
