export const packageSizeBudgets = {
  'browser-core': {
    rawBytes: 388_000,
    minifiedBytes: 284_000,
    gzipBytes: 82_400,
    brotliBytes: 63_500,
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
  // and paint-order gather passes, at roughly +0.6 KB gzip and +1.1 KB Brotli against a raw total that stayed
  // inside the golfed ceiling.
  'text-shaper-wasm': {
    rawBytes: 1_107_000,
    minifiedBytes: 1_107_000,
    gzipBytes: 429_000,
    brotliBytes: 339_500,
  },
  'three-runtime-js': {
    rawBytes: 350_000,
    minifiedBytes: 232_000,
    gzipBytes: 60_000,
    brotliBytes: 51_000,
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
    rawBytes: 425_000,
    minifiedBytes: 325_000,
    gzipBytes: 95_000,
    brotliBytes: 75_000,
  },
  'mtsdf-runtime-js': {
    rawBytes: 425_000,
    minifiedBytes: 325_000,
    gzipBytes: 95_000,
    brotliBytes: 75_000,
  },
  'slug-runtime-js': {
    rawBytes: 425_000,
    minifiedBytes: 325_000,
    gzipBytes: 95_000,
    brotliBytes: 75_000,
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
