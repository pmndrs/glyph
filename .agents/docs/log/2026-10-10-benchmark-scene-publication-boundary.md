---
type: Log Entry
title: Verify Scene publication in released-package benchmarks
sources:
  - resource: ../packages/benchmarks.md
    title: Installed-package benchmark contracts
  - resource: ../planning/publication-frontier.md
    title: Publication frontier tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T12:28:06.824Z'
---

The full historical registry0.1.0→49ab67dc run exposed unequal standalone publication fixtures. Integrity-authenticated released three/text.js proves TextGroup traversal only observed publication after a render-order change, while child observation returned for an undefined Scene. Current standalone traversal likewise skips publication. The benchmark checked descendant textCount, not accepted renderer output. Thus its enormous standalone ratios compare deferred setters with synchronous preparation and cannot establish publication regressions. Bounded source excerpts and verified SHA512 are preserved in .cache/release-010-standalone-source-excerpts.txt; original full report is retained unchanged.

createParagraph and createTextBatch now attach to a Scene, traverse the Scene and require committed Text state plus nonempty rendered glyph draws. Twelve existing traversal call sites were migrated with pinned ts-morph; warm publication cases also require committed state after timing. Existing attachToScene consumers reuse their Scene. No production artifact changed. Focused script TypeScript and strict lint passed. Independent read-only review found no source correctness defect; cold lanes include construction, fixture checks and teardown and must not be compared with the former unparented harness.

Corrected smoke4 session48178 completed with exit0 on the same frozen49ab67dc candidate versus registry0.1.0: one faster, three slower, two neutral, zero skipped. Text publication3.00→3.69ms (+0.690ms); font-size2.76→3.27ms (+0.510ms); color2.21→2.40ms (+0.190ms); edit/measure3.77→2.81ms (-0.960ms). Corrected cold4 session99862 completed with exit0: cold22k mount/publication24.82→28.83ms (+4.010ms); first label/edit3.57→3.23ms (-0.340ms);100 label mount/borrow17.25→18.92ms (+1.670ms). Reports under .cache/publication-release-010-scene-smoke and scene-cold. These are scoped corrected comparisons, not a replacement full matrix or release clearance.

The existing edit-sized profiler gained bulk-write with both preparation and publication boundaries. Both assign and immediately measure every label; only publication calls glyph.shape once after all writes. This forces completion on deferred-setter packages too, unlike SET-only staging. All-label state checks occur outside profiling. Frozen49ab67dc profiles58484 and81351 completed with exit0 for1024 labels,100 iterations,10 warmups: preparation p5020.966625/p9525.249834ms; with publication p5027.682458/p9532.647375ms. These separate profiled runs attribute current costs and are not an old/new A/B. Samples split preparation approximately50% Wasm/48% JS; publication54% Wasm/44% JS. Matching dist source maps identify JS self samples in writePreparedPlannerFrameUpdate/writeHeader, GlyphIdScope.id, prepareTextCandidate and compileEngineGeometry. Wasm functions remain numeric, so no Rust kernel attribution is claimed. Original #247, size and release gates remain open.

Corrected stress4 session15342 exited1 because the visibility benchmark assumed an even count of timed toggles and expected visible=true. Both packages failed that parity-dependent check. The benchmark now checks the actual final toggled state and restores visibility with an untimed Scene traversal before its retained-output oracle. That failed run is diagnostic only and will not be presented as a successful comparison.

Corrected stress4 session96427 completed with exit0, four faster/three slower/one neutral/zero skipped. Bulk1024 Text20.02→38.54ms (+18.520ms/+92.5%); borrowed1000 promoted3.12→5.39ms (+2.270ms); unchanged1000 measurements282.44→355.85µs (+0.073ms). Reorder3.52→3.01ms and reorder/edit8.62→7.43ms improve; visibility590.15→612.58µs is neutral. Report .cache/publication-release-010-scene-stress-verified. Bulk regression remains substantial after equivalent publication; subsequent fixes must be measured against these corrected boundaries.
