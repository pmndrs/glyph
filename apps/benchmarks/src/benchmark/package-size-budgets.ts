export const packageSizeBudgets = {
  'browser-core': {
    // Root Paragraph now ships its real private measurement engine instead of a detached constructor sketch.
    // Final planner vocabulary and typed font requests add raw names while compressed sizes remain below budget.
    rawBytes: 450_000,
    minifiedBytes: 292_000,
    gzipBytes: 82_400,
    brotliBytes: 63_500,
  },
  // Backends, planners, semantic plan readers, portable resources, and call-time validation.
  // Includes branded ID provenance and the zero-copy compiled-font view used by renderer integrations.
  'core-subpath-js': {
    rawBytes: 430_000,
    minifiedBytes: 282_000,
    gzipBytes: 70_500,
    brotliBytes: 59_000,
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
  // Re-priced once on feat/plan-retention: the glyph-animation tier (cbe727bf) added
  // +12,071 raw / +4,949 gzip / +8,451 Brotli of Rust shaping and planning code but left
  // the gate un-repinned; this branch changed no Rust behaviour (formatting only), and the
  // measured artifact is byte-identical to its base commit.
  'text-shaper-wasm': {
    rawBytes: 1_176_000,
    minifiedBytes: 1_176_000,
    gzipBytes: 459_000,
    brotliBytes: 362_000,
  },
  // Three realization, engine-owned backend/plan mapping, first-frame measurement and bounds,
  // exact-generation resource transactions, final planner names, and bounded candidate leases.
  'three-runtime-js': {
    rawBytes: 714_000,
    minifiedBytes: 461_000,
    gzipBytes: 117_000,
    brotliBytes: 97_000,
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
    gzipBytes: 8_100_000,
    brotliBytes: 4_200_000,
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
    gzipBytes: 8_800_000,
    brotliBytes: 4_300_000,
  },
  'font-icons-slug': {
    rawBytes: 3_100_000,
    minifiedBytes: 3_100_000,
    gzipBytes: 690_000,
    brotliBytes: 510_000,
  },
  // Shared Three technique graphs use one reviewed cross-host ceiling.
  // Shader subpaths remain outside these runtime graphs.
  'bitmap-runtime-js': {
    rawBytes: 581_000,
    minifiedBytes: 365_500,
    gzipBytes: 95_500,
    brotliBytes: 80_000,
  },
  'mtsdf-runtime-js': {
    rawBytes: 581_000,
    minifiedBytes: 365_500,
    gzipBytes: 95_500,
    brotliBytes: 80_000,
  },
  'slug-runtime-js': {
    rawBytes: 581_000,
    minifiedBytes: 365_500,
    gzipBytes: 95_500,
    brotliBytes: 80_000,
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
    rawBytes: 71_000,
    minifiedBytes: 71_000,
    gzipBytes: 31_000,
    brotliBytes: 26_000,
  },
  'mtsdf-baker-wasm': {
    rawBytes: 560_000,
    minifiedBytes: 560_000,
    gzipBytes: 220_000,
    brotliBytes: 173_000,
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
