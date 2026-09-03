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
    // Wildcard config leaves now isolate this renderer-neutral graph at 42,451 raw / 42,188 minified /
    // 11,023 gzip / 9,742 Brotli. Keep that reduction protected rather than retaining the bundled-era ceiling.
    rawBytes: 44_000,
    minifiedBytes: 44_000,
    gzipBytes: 11_500,
    brotliBytes: 10_200,
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
    // The current tsdown graph is 734,377 raw / 584,675 minified / 138,073 gzip / 113,039 Brotli. Keep a small
    // cross-host compression margin without pretending the validator belongs to the ordinary runtime closure.
    rawBytes: 741_000,
    minifiedBytes: 585_000,
    gzipBytes: 139_000,
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
  // Planner-assisted detached glyph copies add paragraph-scoped stable-ID selection and a
  // one-shot publication checkpoint without changing the retained A/B publication state.
  'text-shaper-wasm': {
    rawBytes: 1_200_000,
    minifiedBytes: 1_200_000,
    gzipBytes: 468_000,
    brotliBytes: 368_000,
  },
  // Three realization plus the root graph measures 520,663 raw / 509,451 minified / 127,281 gzip / 104,932 Brotli
  // after tsdown shared-chunk bundling and the single-graph font-loader consolidation. The old raw ceiling described
  // unbundled tsc output and no longer measured the published graph; these ceilings track the actual consumer graph.
  'three-runtime-js': {
    rawBytes: 525_000,
    minifiedBytes: 512_000,
    gzipBytes: 128_000,
    brotliBytes: 106_000,
  },
  'font-inter-bitmap-16-32': {
    rawBytes: 3_200_000,
    minifiedBytes: 3_200_000,
    gzipBytes: 570_000,
    brotliBytes: 430_000,
  },
  // Corner protection stopped error correction from flattening corner texels to a single channel.
  // Those flattened texels held four identical bytes and compressed almost for free; genuine
  // multi-channel corner data does not. Inter's MTSDF asset grew 8,007,071 to 8,167,575 gzip
  // (+2.0%) for a fall from 161 to 97 samples missing ground-truth coverage by more than a quarter,
  // which is fewer than native msdfgen's 101 on the same glyphs. Raw and Brotli both still fit the
  // reviewed ceiling; only gzip needed re-pricing. See D-293.
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
  // Shared Three technique graphs use one reviewed cross-host ceiling.
  // Shader subpaths and Three itself remain external. Each entry measures the public Glyph root, Three adapter, and
  // exactly one raster format; the largest is 469,999 raw / 459,094 minified / 114,394 gzip / 94,747 Brotli.
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
} as const;
