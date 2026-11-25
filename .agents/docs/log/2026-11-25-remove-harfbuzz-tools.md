---
type: Log Entry
title: 'Removed the HarfBuzz command-line tools and audited renderer parity'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-25T02:01:24Z'
---

Removed every HarfBuzz command-line dependency from checks and CI
([decision](../planning/decisions/remove-harfbuzz-tools.md)): the provisioning, vendoring and bundle-authentication
tooling, the hb-shape oracle generator, the Git LFS bundles under `benches/vendor/harfbuzz` and the CI step. The
Japanese showcase subset is frozen and authenticated instead of rebuilt; its bytes did not change. The `harfbuzz.json`
shaping references stay as frozen data ([benchmarks](../packages/benchmarks.md)).

Audited cross-renderer pixel checks. Three is the reference in both harnesses: `benchmark:typegpu-parity` compares
TypeGPU with Three (MSDF and Slug, 0 pixels over 8/255) and `benchmark:pixi3d-parity` compares PixiJS 3D with Three
(MSDF, Slug, Bitmap). No harness compares TypeGPU with PixiJS 3D directly, and CI runs neither. The TypeGPU Bitmap
scene is not compared with Three: on 2026-11-24 it differed in 29,588 pixels over 8/255, while PixiJS 3D Bitmap on
WebGPU matches Three with 0 over. The old reason, that Three snaps Bitmap quads, was wrong (`pixelSnapping` is
opt-in); the comment and capture notes now record the measured difference as an open TypeGPU defect.
