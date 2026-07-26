export const packageSizeBudgets = {
  'browser-core': {
    rawBytes: 315_000,
    minifiedBytes: 240_000,
    gzipBytes: 71_000,
    brotliBytes: 55_000,
  },
  'font-validator-js': {
    rawBytes: 741_000,
    minifiedBytes: 585_000,
    gzipBytes: 138_000,
    brotliBytes: 113_500,
  },
  'runtime-baker-host-js': {
    rawBytes: 5_300,
    minifiedBytes: 3_900,
    gzipBytes: 1_500,
    brotliBytes: 1_350,
  },
  'runtime-baker-worker-js': {
    rawBytes: 13_400,
    minifiedBytes: 9_050,
    gzipBytes: 3_050,
    brotliBytes: 2_690,
  },
  'text-shaper-js': {
    rawBytes: 44_100,
    minifiedBytes: 31_000,
    gzipBytes: 8_900,
    brotliBytes: 7_900,
  },
  'text-shaper-wasm': {
    rawBytes: 693_000,
    minifiedBytes: 693_000,
    gzipBytes: 259_000,
    brotliBytes: 203_000,
  },
  'portable-baker-js': {
    rawBytes: 10_100,
    minifiedBytes: 6_700,
    gzipBytes: 2_360,
    brotliBytes: 2_080,
  },
  'portable-baker-wasm': {
    rawBytes: 434_285,
    minifiedBytes: 434_285,
    gzipBytes: 168_326,
    brotliBytes: 137_100,
  },
  'unicode-analysis-js': {
    rawBytes: 165_000,
    minifiedBytes: 141_000,
    gzipBytes: 42_500,
    brotliBytes: 31_500,
  },
} as const
