export const packageSizeBudgets = {
  'browser-core': {
    // The public root owns Glyph, FontFace, text authoring/measurement values, and their shared loading graph. The unbundled distribution
    // measures the consumer closure once: 362,479 raw / 354,093 minified / 88,281 gzip / 73,217 Brotli.
    rawBytes: 368_000,
    minifiedBytes: 360_000,
    gzipBytes: 90_000,
    brotliBytes: 75_000,
  },
  // GlyphConfig, Codec, schema, raster-format helpers, and the zero-copy command-buffer contract.
  'glyph-config-js': {
    // The direct occurrence-origin and projected-flow contracts measure 44,703 raw / 44,426 minified /
    // 11,682 gzip / 10,251 Brotli. Keep bounded headroom without restoring the old bundled graph.
    rawBytes: 46_000,
    minifiedBytes: 46_000,
    gzipBytes: 12_000,
    brotliBytes: 10_500,
  },
  // `/typegpu` covers all first-party formats with peers external. Its ceiling keeps less than one percent
  // raw/minified headroom and bounded compression variance.
  'typegpu-direct-renderer-js': {
    rawBytes: 236_000,
    minifiedBytes: 233_000,
    gzipBytes: 45_000,
    brotliBytes: 38_000,
  },
  'font-validator-js': {
    // The current tsdown graph is 734,377 raw / 584,675 minified / 138,073 gzip / 113,039 Brotli. Keep a small
    // cross-host compression margin without pretending the validator belongs to the ordinary runtime closure.
    rawBytes: 741_000,
    minifiedBytes: 585_000,
    gzipBytes: 139_000,
    brotliBytes: 113_500,
  },
  // Portable fingerprinting moved this graph from 5,816 to 6,022 gzip bytes.
  // Linux and macOS agree byte-for-byte, so this ceiling needs no host margin.
  'runtime-baker-host-js': {
    rawBytes: 18_000,
    minifiedBytes: 16_000,
    gzipBytes: 6_200,
    brotliBytes: 5_500,
  },
  'runtime-baker-worker-js': {
    rawBytes: 790_000,
    minifiedBytes: 620_000,
    gzipBytes: 148_000,
    brotliBytes: 122_000,
  },
  // Complete Rust shaping, layout, Codec execution, and command publication. The ceiling keeps less than one percent
  // headroom plus bounded cross-host compression variance; feature attribution lives in the decision log.
  'text-shaper-wasm': {
    rawBytes: 1_385_000,
    minifiedBytes: 1_385_000,
    gzipBytes: 536_000,
    brotliBytes: 413_000,
  },
  // Three realization includes projected flow and the shared placement table, with peer dependencies external.
  'three-runtime-js': {
    rawBytes: 558_000,
    minifiedBytes: 546_000,
    gzipBytes: 138_000,
    brotliBytes: 113_000,
  },
  // The React adapter includes Glyph's root and Three integration while React, R3F, and Three remain consumer peers.
  'react-runtime-js': {
    rawBytes: 548_000,
    minifiedBytes: 535_000,
    gzipBytes: 136_000,
    brotliBytes: 112_000,
  },
  // The existing production hello-world application intentionally includes its complete consumer graph. The R3F v9
  // compatibility change measures 2,621,866 emitted / 739,256 gzip / 561,836 Brotli bytes across its JavaScript chunks.
  'r3f-hello-world-production-js': {
    rawBytes: 2_650_000,
    minifiedBytes: 2_650_000,
    gzipBytes: 750_000,
    brotliBytes: 570_000,
  },
  // `/three/typegpu` prices the complete optional integration with peers external.
  'three-typegpu-runtime-js': {
    rawBytes: 667_000,
    minifiedBytes: 653_000,
    gzipBytes: 152_000,
    brotliBytes: 124_000,
  },
  'font-inter-bitmap-16-32': {
    rawBytes: 3_200_000,
    minifiedBytes: 3_200_000,
    gzipBytes: 570_000,
    brotliBytes: 430_000,
  },
  // Genuine multi-channel corner correction compresses less than flattened texels; the reviewed quality tradeoff
  // and ceiling change are recorded in D-293.
  'font-inter-mtsdf': {
    rawBytes: 40_000_000,
    minifiedBytes: 40_000_000,
    gzipBytes: 8_300_000,
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
  // Shared Three technique graphs use one cross-host ceiling; each entry measures the public Glyph root, adapter,
  // and one raster format while shader subpaths and Three remain external.
  'bitmap-runtime-js': {
    rawBytes: 477_000,
    minifiedBytes: 466_000,
    gzipBytes: 116_000,
    brotliBytes: 97_000,
  },
  'mtsdf-runtime-js': {
    rawBytes: 477_000,
    minifiedBytes: 466_000,
    gzipBytes: 116_000,
    brotliBytes: 97_000,
  },
  'slug-runtime-js': {
    rawBytes: 477_000,
    minifiedBytes: 466_000,
    gzipBytes: 116_000,
    brotliBytes: 97_000,
  },
  'bitmap-baker-wasm': {
    rawBytes: 626_000,
    minifiedBytes: 626_000,
    gzipBytes: 236_000,
    brotliBytes: 181_000,
  },
  // Carries the same inlined fingerprint hash: minified 15,726 -> 16,047 (+321), crossing by 47.
  'bitmap-baker-js': {
    rawBytes: 23_500,
    minifiedBytes: 16_300,
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
  // Carries the same inlined fingerprint hash: minified 19,218 -> 19,539 (+321), crossing by 39.
  'mtsdf-baker-js': {
    rawBytes: 27_500,
    minifiedBytes: 19_800,
    gzipBytes: 5_700,
    brotliBytes: 5_100,
  },
  // CFF subdivision and outline refusal moved macOS raw bytes from 461,488 to 464,386.
  // Linux emits 464,113 raw / 186,785 gzip / 147,013 Brotli, so the ceiling includes host margin.
  'slug-baker-wasm': {
    rawBytes: 467_000,
    minifiedBytes: 467_000,
    gzipBytes: 188_000,
    brotliBytes: 148_000,
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
} as const;
