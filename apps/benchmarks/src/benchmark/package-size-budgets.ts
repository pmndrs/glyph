export const packageSizeBudgets = {
  'runtime-baker-host-js': { minifiedBytes: 3_900, gzipBytes: 1_500, brotliBytes: 1_350 },
  'runtime-baker-worker-js': {
    minifiedBytes: 9_050,
    gzipBytes: 3_050,
    brotliBytes: 2_690,
  },
  'text-shaper-wasm': {
    minifiedBytes: 693_000,
    gzipBytes: 259_000,
    brotliBytes: 203_000,
  },
  'portable-baker-js': { minifiedBytes: 6_700, gzipBytes: 2_360, brotliBytes: 2_080 },
  'portable-baker-wasm': {
    minifiedBytes: 434_285,
    gzipBytes: 168_326,
    brotliBytes: 137_100,
  },
} as const
