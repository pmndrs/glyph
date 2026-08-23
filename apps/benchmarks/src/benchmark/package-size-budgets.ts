export const packageSizeBudgets = {
  'browser-core': {
    rawBytes: 388_000,
    minifiedBytes: 284_000,
    gzipBytes: 82_400,
    brotliBytes: 63_500,
  },
  // The renderer-neutral core subpath (D-249) must stay integration-free; the graph
  // assertion in measure-package-sizes.mts already rejects any three/tsl/react pull.
  // Grew with the technique-schema authority layer (D-251): declarations, validation,
  // and the schema-typed store path. The review-closure pass added +3,525 raw /
  // +1,686 minified / +351 Brotli of real validation, provenance, and derivation
  // code (schema normalization and freezing, DSL session provenance,
  // schemaPolicyBuffers/schemaFieldTable). Re-based when tsdown bundling lands per
  // the technique contract plan.
  // The external-raster routing around the Worker font-bake plan added +1,786 raw /
  // +919 minified of unrecorded growth (the evidence refold rides this branch), and
  // the 11.17 measure tier added +2,481 raw / +1,258 minified / +211 gzip for the
  // synchronous measure entry, the retained speculative transaction, and the host
  // fast path. Measured byte-identical on linux-x64 and darwin; the integer-units
  // slices above ride within the remaining headroom (+360 raw at their tip).
  // These ceilings now price the PRODUCTION graph: the size harness defines
  // process.env.NODE_ENV="production" so development-only `if (DEV)` diagnostics fold
  // away exactly as they do in a consumer's build, and asserts that none of their text
  // survives. Total teardown (D-255) cost +1,295 raw measured unstripped; guarding its
  // guidance left +468 of real production behaviour, which fits the existing ceiling.
  // The ceiling had no room for the cross-host gap: this host measures 231,670 raw and the Linux
  // runner measures 232,558, so CI failed on a 558-byte overage that is host difference rather than
  // growth. Raised to clear the foreign-host measurement with headroom.
  'core-subpath-js': {
    rawBytes: 238_000,
    minifiedBytes: 162_000,
    gzipBytes: 41_500,
    brotliBytes: 35_400,
  },
  'tsl-subpath-js': {
    rawBytes: 27_000,
    minifiedBytes: 14_000,
    gzipBytes: 4_200,
    brotliBytes: 3_700,
  },
  // The TypeGPU technique shader library is a sibling of `/tsl` with no scene
  // integration; `typegpu` itself is an optional peer and stays outside the graph.
  'typegpu-subpath-js': {
    rawBytes: 30_000,
    minifiedBytes: 16_000,
    gzipBytes: 5_000,
    brotliBytes: 4_400,
  },
  'font-validator-js': {
    rawBytes: 741_000,
    minifiedBytes: 585_000,
    gzipBytes: 138_000,
    brotliBytes: 113_500,
  },
  'runtime-baker-host-js': {
    rawBytes: 18_000,
    minifiedBytes: 16_000,
    gzipBytes: 6_000,
    brotliBytes: 5_500,
  },
  'runtime-baker-worker-js': {
    rawBytes: 790_000,
    minifiedBytes: 620_000,
    gzipBytes: 148_000,
    brotliBytes: 122_000,
  },
  // Complete Rust shaping, layout, policy, and command-plan publication. Gzip and Brotli rose for the decoration
  // rendering feature (D-248): decorating-box cascade state, per-cluster run aggregation, resource-free plan rows,
  // and paint-order gather passes. The 11.14 typography tier re-priced the ceilings once for all of its layers:
  // constraint decode/validation, paragraph spacing, first-line indent, bounded justification, and the graduated
  // D-245 kernels total roughly +1.3 KB raw. The margins cover cross-host build variance: the Linux toolchain
  // emits equal-length but byte-different wasm (different sha256) whose compressed sizes run a few hundred bytes
  // above the recorded macOS host's.
  // The 11.17 measure tier grew the engine by +9,413 raw / +5,028 gzip / +4,014
  // Brotli: speculative measure transactions, candidate adoption, and the
  // paragraph query path. The integer-units slices then shrank the tip by a net
  // -4,228 raw before the retained adjacency stream (+2,209), the metric-only
  // scale refresh (+1,753), and integer justification (+1,071: euclidean unit
  // distribution and the Q16 growth caps) priced their layers back in.
  // Corrected baseline: the recorded ceiling was already exceeded before the style-wire
  // fixes below it. At the previous commit the measured artifact stood at 1,121,718 raw /
  // 435,656 gzip / 345,593 Brotli against a 1,117,500 / 434,800 / 344,100 ceiling — an
  // unpriced overage of 4,218 raw, 856 gzip, and 1,493 Brotli carried by the slice 3b and
  // slice 4 layers, which re-priced their own evidence but not this ceiling. The style-wire
  // fixes then added 83 raw while shrinking gzip by 9 and Brotli by 272. These values price
  // the measured artifact plus the documented cross-host margin, and name the overage rather
  // than absorbing it silently.
  'text-shaper-wasm': {
    rawBytes: 1_169_500,
    minifiedBytes: 1_169_500,
    gzipBytes: 454_500,
    brotliBytes: 361_500,
  },
  // Raw rose for the policy-DSL authoring layer riding the Three bundle (D-250),
  // then the review-closure pass added +3,535 raw / +1,711 minified / +439 Brotli
  // of schema-derived executor lookups, program buffer derivation, and the
  // glyph-origin schema map replacing literal id ranges. Real code, not comments;
  // the compressed ceilings hold with tight headroom by design.
  // Column flow (contentBox columns over ordered regions) added ~+1.7 KB raw of
  // geometry derivation and validation in the Three adapter.
  // The external-raster routing rode into the Three bundle too (+1,786 raw /
  // +914 minified), then the 11.17 frame adoption and measureLayout host fast
  // path added +5,310 raw / +2,690 minified in the Three adapter.
  // These ceilings now price the PRODUCTION graph: the size harness defines
  // process.env.NODE_ENV="production" so development-only `if (DEV)` diagnostics fold
  // away exactly as they do in a consumer's build, and asserts that none of their text
  // survives. Total teardown (D-255) cost +1,295 raw measured unstripped; guarding its
  // guidance left +468 of real production behaviour, which fits the existing ceiling.
  // The shared module the stack-wide delta pointed at is `unicode-segmenter`, which enters every
  // runtime graph through `internal/graphemes.ts` at the edit-topology layer: caller-side span
  // alignment must read the same extended grapheme boundaries the engine's Rust tables do, and
  // `Intl.Segmenter` follows the host ICU and can disagree. That accounts for the near-identical
  // ~22 KB step across four independent graphs -- one module, four importers -- and is a deliberate
  // correctness-over-size trade rather than drift. The remainder at this layer is the semantic
  // record widening from 44 to 68 bytes. Both hosts measure identically, so none of this is
  // foreign-host variance.
  'three-runtime-js': {
    rawBytes: 444_000,
    minifiedBytes: 275_000,
    gzipBytes: 73_500,
    brotliBytes: 62_000,
  },
  'font-inter-bitmap-16-32': {
    rawBytes: 3_200_000,
    minifiedBytes: 3_200_000,
    gzipBytes: 570_000,
    brotliBytes: 430_000,
  },
  'font-inter-mtsdf': {
    rawBytes: 40_000_000,
    minifiedBytes: 40_000_000,
    gzipBytes: 7_000_000,
    brotliBytes: 3_400_000,
  },
  'font-inter-slug': {
    rawBytes: 3_600_000,
    minifiedBytes: 3_600_000,
    gzipBytes: 650_000,
    brotliBytes: 430_000,
  },
  'font-icons-bitmap-16-32': {
    rawBytes: 2_500_000,
    minifiedBytes: 2_500_000,
    gzipBytes: 470_000,
    brotliBytes: 375_000,
  },
  'font-icons-mtsdf': {
    rawBytes: 33_000_000,
    minifiedBytes: 33_000_000,
    gzipBytes: 7_500_000,
    brotliBytes: 3_500_000,
  },
  'font-icons-slug': {
    rawBytes: 3_100_000,
    minifiedBytes: 3_100_000,
    gzipBytes: 690_000,
    brotliBytes: 510_000,
  },
  'bitmap-runtime-js': {
    rawBytes: 430_000,
    minifiedBytes: 267_000,
    gzipBytes: 72_500,
    brotliBytes: 60_500,
  },
  'mtsdf-runtime-js': {
    rawBytes: 430_000,
    minifiedBytes: 267_000,
    gzipBytes: 72_500,
    brotliBytes: 60_500,
  },
  'slug-runtime-js': {
    rawBytes: 430_000,
    minifiedBytes: 267_000,
    gzipBytes: 72_500,
    brotliBytes: 60_500,
  },
  'bitmap-baker-wasm': {
    rawBytes: 626_000,
    minifiedBytes: 626_000,
    gzipBytes: 236_000,
    brotliBytes: 181_000,
  },
  'bitmap-baker-js': {
    rawBytes: 23_500,
    minifiedBytes: 16_000,
    gzipBytes: 4_900,
    brotliBytes: 4_400,
  },
  'mtsdf-generator-js': {
    rawBytes: 12_000,
    minifiedBytes: 9_000,
    gzipBytes: 2_700,
    brotliBytes: 2_400,
  },
  'mtsdf-generator-wasm': {
    rawBytes: 55_000,
    minifiedBytes: 55_000,
    gzipBytes: 24_500,
    brotliBytes: 21_000,
  },
  'mtsdf-baker-wasm': {
    rawBytes: 551_000,
    minifiedBytes: 551_000,
    gzipBytes: 216_000,
    brotliBytes: 170_000,
  },
  'mtsdf-baker-js': {
    rawBytes: 27_500,
    minifiedBytes: 19_500,
    gzipBytes: 5_700,
    brotliBytes: 5_100,
  },
  'slug-baker-wasm': {
    rawBytes: 464_000,
    minifiedBytes: 464_000,
    gzipBytes: 187_000,
    brotliBytes: 147_000,
  },
  'slug-baker-js': {
    rawBytes: 20_000,
    minifiedBytes: 14_000,
    gzipBytes: 4_500,
    brotliBytes: 4_000,
  },
  'portable-baker-js': {
    rawBytes: 12_000,
    minifiedBytes: 8_500,
    gzipBytes: 2_700,
    brotliBytes: 2_400,
  },
  'portable-baker-wasm': {
    rawBytes: 1_086_000,
    minifiedBytes: 1_086_000,
    gzipBytes: 391_000,
    brotliBytes: 305_000,
  },
  // Raw and minified rose for the allocation-free grapheme script resolution; the growth is comment-dominated, at
  // +3,010 raw against +298 Brotli, because the parallel-array form needs its reasoning recorded next to it.
  'unicode-analysis-js': {
    rawBytes: 171_000,
    minifiedBytes: 143_000,
    gzipBytes: 42_500,
    brotliBytes: 31_500,
  },
} as const;
