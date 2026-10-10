---
type: Log Entry
title: 'Three publication removes the copied entries array'
sources:
  - resource: ../packages/glyph.md
    title: Glyph publication ownership
  - resource: ../planning/publication-frontier.md
    title: Compact publication task tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T11:09:07.331Z'
---

Three reconciliation now iterates its entries Map directly instead of copying the keys array (+1/-1 production). Removal deletes only the current entry before new entries are staged; disposal and unbinding cannot insert or reinsert a successor. Independent source review confirms that chain and error ordering. The existing scene.clear test now covers three consecutive ancestor removals with a retained sibling, detached synchronous measurement without rendered membership, reattachment and host clearing. The first test attempt used glyph.shape without the Three traversal that observes raw ancestry changes; it failed and was corrected to scene.updateMatrixWorld(true), without a production workaround. Static/build, all131 Three tests and full971 Node tests pass.

Frozen sourcepatchdcd11dfcc833a91a17d9296884f2bd729dd14fa647d674b61468a8fa70e2feda; TGZ80dc126d2919e54a87e9354c975dc24f13120fd1f1f1ab553aa4973a4b961ff8. Only three/text.js changes, -4raw/-7gzip; all five Wasm modules stay byte-identical to resource-key. Evidence is under .cache/publication-three-map-candidate. Paired edit-sized Labs35748 remains live; GPU pending. No timing win, landing or cumulative-size clearance claimed.

Root traversal still observes caller-owned hierarchy and presentation. Removed the misleading package statement that all full membership scans were reserved for Scene transitions. No new membership store, public API or executor was introduced. Remote main remains305e5ec9; ASCII is already integrated to that main.

Map slice committed90f7f716; source matches frozen dcd11dfc. Paired edit-sized Labs35748 completed46neutral/zero faster/zero slower and one clock-confounded first-color engine exclusion. Immediate publication100edits/1,000labels36.83→37.00ms; interleaved72.42→71.65ms. No elapsed-time win established. GPU95697 passed exact-shaper64e4ce00 WebGPU/WebGL2 dynamic-layout and WebGPU Slug rich-text probes; all three captures inspected with no new visible defect. The benchmark panels still occlude some content, as before.
