# Browser memory observations

Four sequential untimed browser command-family observations completed. Each used the same 240-color-span, 2,880-initial-glyph retained Text workload, six phases per backend, and 30 idle frames. The main arm was captured and frozen as the oracle before the comparison arms.

| Arm          | Usage   | Installed shaper Wasm SHA-256                                      | Max observed non-atomic sweep sum | Cleanup                                      |
| ------------ | ------- | ------------------------------------------------------------------ | --------------------------------: | -------------------------------------------- |
| main         | stream  | `059ab502908510109c0f66b1a5558e42b79ba843bff36b18c309ec7be8a189e4` |               1,531,603,080 bytes | proven; no remaining or uncertain identities |
| candidate    | stream  | `244078b186e9de0414331ff9de2632c8a57c4ec20f19b6e0a41ce964f8e1b30a` |               1,578,707,752 bytes | proven; no remaining or uncertain identities |
| published010 | dynamic | `addb8144f474c9f5a005bdda084bcf15c05170004b34c7a65ab592db4962c893` |               1,486,776,192 bytes | proven; no remaining or uncertain identities |
| prior328     | stream  | `4ee7d0532a5f2b2a42f843b9f9d866bffb00fb4e6f70bb96adba952651944ffa` |               1,527,622,176 bytes | proven; no remaining or uncertain identities |

For all four archives, delivery reports completed with no response errors or failed requests. Both WebGPU and WebGL2 observed installed `index.js` and `three.js`; every recorded shaper Wasm response hash matched that arm’s installed Wasm hash. Every arm’s six phase signatures (`pixelHash`, lit pixels, draw calls, instances) matched the frozen main oracle on both backends. Thirty idle frames completed with buffer versions unchanged.

The controls record per-phase upload counters and per-backend storage attributes in `browser-memory-summary.json`. Published 0.1.0 used `dynamic` buffer usage as the baseline-specific control; main, candidate, and prior328 used `stream`. The recorded CPU submission timings are diagnostic and are not acceptance evidence.

The OS values are sampled, non-atomic sums over each entire observed command family, including installation, startup, rendering, and teardown. They are estimates, not exact simultaneous peaks; short-lived peaks can be missed. The existing pixel hash is a noncryptographic 32-bit digest paired with lit-pixel count, not a retained full-pixel-array proof. Observer scanning and browser response hashing add overhead.
