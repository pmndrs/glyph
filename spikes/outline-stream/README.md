# Outline stream GPU spike

Temporary code. It settles the shader speed-parity gate of
[Slug reads the shared outline points](../../.agents/docs/planning/decisions/slug-shared-outline-points.md), following
the [spike plan](../../.agents/docs/planning/outline-stream-spike.md) and the point layout of
[Outline stream format](../../.agents/docs/planning/decisions/outline-stream-format.md). It is outside the pnpm
workspace, has no package exports and no CI, and is deleted or folded into `packages/glyph` once the decision is made.

## What it measures

One glyph grid is drawn with the same instances, band partition, sort order, vertex program, dilation, band walk,
root solver and coverage. Only the curve fetch differs:

| Variant | Curve data                                                     | Fetch per band reference                                                                           |
| ------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `A`     | RGBA16F endpoint-sharing curve texels in em units (today's V0) | two texel loads                                                                                    |
| `B-mid` | i16 points, `(x << 1) \| offCurve, y`, font units              | three point loads plus the implied-on-curve rule; lines `{p1, mid, p2}`                            |
| `B-dup` | same as `B-mid`                                                | same; lines `{p1, p2, p2}` (the reference's recommendation)                                        |
| `B-f16` | same as `B-mid`, diagnostic only, not timed                    | B rebuilt as the encoder builds A: V0's 1/8-unit line bow, then every point rounded through f16 em |

- B scales the sample coordinate by `unitsPerEm` once, in the vertex shader. The fragment shader works in font units
  and does no per-curve scaling.
- On WebGPU, A reads a `texture_2d<f32>` (rgba16float) with `textureLoad` and B reads an `array<u32>` storage buffer.
  Band headers and references are storage buffers for both.
- On WebGL2, A reads an RGBA16F `sampler2D` and B an RG16I `isampler2D`, both with `texelFetch`. Headers are R32UI and
  references R16UI.
- The shader math ports `packages/glyph/src/shaders/typegpu/slug/core/*.ts`: root code, the stable solver with its
  linear path, weighted coverage, band traversal with the sorted early exit, and dilation. The source is
  [`gpu/shaders.mjs`](gpu/shaders.mjs), one text per language with only `fetchCurve` swapped.
- The "main" variant (rendering the real `.slug.glb`) is **not implemented**. Its curve pages are KTX2 resources split
  across pages, and selecting the Latin set needs the core GLB's cmap. A is the same data and the same fetch.

## Prerequisites

- Node 22, plus `git lfs pull`, because the fixture fonts are LFS objects.
- Rust 1.97.1 (`rustup toolchain install 1.97.1`) for the spike encoder, which `prepare` builds.
- The package build, only for the optional main assets: `mise exec -- pnpm build`. Otherwise pass `--no-main` to
  `prepare`.

## Commands

From the repository root:

```sh
node spikes/outline-stream/prepare.mjs          # all three fixtures; --no-main skips the CLI Slug bake; or pass font paths
node spikes/outline-stream/serve.mjs            # prints http://localhost:5178/gpu/ (PORT overrides)
node spikes/outline-stream/cpu-bench.mjs        # Inter by default; --font <path> --reps <n>; writes out/cpu/cpu-bench.json
```

The encoder can also run alone:

```sh
(cd spikes/outline-stream/encoder && cargo +1.97.1 build --release)
spikes/outline-stream/encoder/target/release/encoder <font> <out-prefix> [--unicodes U+0020-007E,U+00A0-00FF] [--triplet]
```

`prepare` writes `out/<name>.spike.{bin,json}` (full set), `out/<name>-latin.spike.*`, the main bake
`out/<name>.glb` plus `out/<name>.slug.glb`, and `out/index.json`. Section offsets are in `meta.sections`, and the
encoder's self-verify results are in each asset's `verify` field.

Open the printed URL in Chrome (WebGPU and WebGL2), Safari (WebGL2, plus WebGPU where enabled) and Firefox (WebGL2,
plus WebGPU where enabled). Pick a font and glyph set (`latin` is the Latin set the plan asks for) and press **Run
all**. The defaults are a 2048×2048 canvas, 100 frames after 10 warm-up frames, split over 4 interleaved rounds so drift
hits every variant alike, at 12, 32, 128 and 512 px per em, plus a magnified view of one glyph (`g` by default).

- **Precise WebGPU timers in Chrome:** Chrome quantizes `timestamp-query` to 100 µs unless it is launched with
  `--enable-webgpu-developer-features`, or the same flag is set in `chrome://flags`. At small sizes, raise **Draws per
  frame** so a frame is well above that step.
- **URL parameters** preset the form, for scripted runs:
  `?font=inter-regular&set=latin&w=2048&h=2048&frames=100&warmup=10&rounds=4&draws=1&sizes=12,32,128,512,mag&backends=webgpu,webgl2&variants=A,B-mid,B-dup,B-f16&glyph=g&run=1`.
- **Headless correctness check:** software rendering, so its timings are not meaningful.

  ```sh
  node spikes/outline-stream/gpu/test/fake-asset.mjs   # hand-made shapes, merged into out/index.json
  node spikes/outline-stream/gpu/test/headless.mjs     # fake shapes; or --font inter-regular [--glyphs a,g,Q]
  ```

  It renders through Chromium with SwiftShader (WebGL2 and WebGPU) and compares every magnified glyph with an 8×8
  supersampled CPU rasterization of the exact outline. It writes `gpu/test/screenshot-*.png`. `prepare` rewrites
  `out/index.json`, so rerun `fake-asset.mjs` afterwards if you want the fake listed.

## Reading the results

Each row of the table and of the JSON is one backend × case × variant:

- **`median ms`, `p90 ms`:** per-frame GPU time from `timestamp-query` or `EXT_disjoint_timer_query_webgl2`. Without a
  timer extension, it is wall time per frame around `queue.onSubmittedWorkDone()` or `gl.finish()`. The `timer` column
  says which one was used. Wall-time fallbacks include submission and synchronization overhead and only compare
  variants against each other.
- **`pipelined ms/frame`:** wall time for the whole batch of frames divided by the frame count, a throughput check on
  the GPU timer.
- **`median / A`:** the speed-parity number. 1.00 is parity, and above 1 means B is slower.
- **`max Δ`, `mean Δ`, `px > 1/255`:** the B image against the A image of the same case, in 1/255 steps over RGB. The
  **diff** button shows the image: A dimmed, red where B is darker, blue where B is brighter, amplified ×16.
- **`B-dup` rows** also carry `diffVsBMid` in the JSON. **`crossBackendA`** compares A between the two backends.

The page prints the full result as one JSON line to the console, and **Copy JSON** copies it for pasting into #244.
The JSON includes the user agent, the WebGPU adapter info, the unmasked WebGL renderer and the asset statistics.

### What "parity" means for the gate

The plan's "Done when" asks for both of these, on at least one integrated and one discrete GPU, on WebGPU and WebGL2,
at all four sizes:

- **Speed:** B's median is within noise of A's. Compare `median / A` with the spread between A's own median and p90,
  and between runs. If B is consistently slower beyond that, the difference must be explained.
- **Pixels:** the A–B difference is explained by f16 quantization, with no structural errors (no missing or extra
  curves) in the magnified view.

`B-f16` makes the pixel half checkable. It is B with A's encoding applied in the shader: V0's 1/8-unit bow on diagonal
lines, then f16 rounding of every point. When `A` vs `B-f16` is zero, or within a step or two from GPU rounding of
`pack2x16float`, the whole A–B difference is the f16 encoding. Any remaining `B-mid` vs A difference is then B being
exact, not B being wrong.

The **line-encoding toggle** recommendation comes from the `B-mid` vs `B-dup` timings. Their pixels matched exactly in
every software run (see below), so the choice is speed only.

### Evidence from this container (software rendering only)

These checks ran in headless Chromium with SwiftShader, which proves correctness only. The timings are meaningless.

The runs used a 512² canvas: the fake shapes, plus Inter, Source Serif 4 and Dancing Script (CFF) in their `latin`
sets. Each font got a grid at all four sizes and ten magnified glyphs (`a g e O Q S & @ 8 ß`):

- **A vs B-f16** is at most 1/255 in every case, on both backends. The 1/255 steps appear only for the two
  1000-unit fonts, where `x / unitsPerEm` is inexact in f32. Every A–B difference measured is therefore the f16
  encoding plus V0's line bow.
- **A vs B-mid** in the magnified views (about 600 px/em) is at most 44–76/255. In the grids it is at most 4/255 at
  12 px for Inter, and up to 89/255 for the 1000-unit fonts, whose f16 em steps are coarser in font units.
- **Coverage against the CPU reference** (8×8 supersampled non-zero winding of the exact outline):
  - B-mid never differs by more than 61/255, with a mean of at most 0.16/255 per glyph, which is the antialiasing
    difference between Slug's two-ray filter and a box filter.
  - A exceeds 64/255 in a few edge pixels on Inter (O: 12 pixels, S: 6), from f16 rounding.
  - Neither variant showed a missing or extra curve, which would differ by about 255.
- **B-dup vs B-mid** pixels were identical: at most 1/255, and none above 1/255.
- **WebGPU and WebGL2** give the same A–B numbers. Their A images differ at 12–32 px (and in a handful of pixels at
  128 px) because of rasterization ties at the dilated quad edge. The repository's dilation moves each corner
  0.5 px along the normalized half-diagonal, so a wide, short quad gets only about 0.2 px of vertical fringe, and
  edges land within about 0.01 px of pixel centres. The reference shader dilates 0.5 px per axis.

## Files

- `serve.mjs`: static server, port 5178 or `PORT`.
- `gpu/index.html`, `gpu/main.mjs`: page, Run all, results table and JSON.
- `gpu/assets.mjs`: reads `out/index.json` and `out/<font>.spike.{json,bin}`. It validates every band reference and
  checks that A and B name the same curve, with endpoints within half an f16 ulp.
- `gpu/scene.mjs`: instance data for the grid (set with the asset's advances and ascender/descender) and the magnified
  view.
- `gpu/shaders.mjs`: WGSL and GLSL ES 3.00.
- `gpu/webgpu.mjs`, `gpu/webgl2.mjs`: the backends, with timing and readback.
- `gpu/analysis.mjs`: median, p90 and the pixel diff.
- `gpu/test/fake-asset.mjs`, `gpu/test/headless.mjs`: the asset-free check described above.

## Credit

The Slug algorithm and the reference shaders in [`reference/`](reference/) are by Eric Lengyel, Copyright 2017, under
the MIT License (see [`reference/README.md`](reference/README.md) and [`reference/LICENSE`](reference/LICENSE)). The
shaders here follow those references through the repository's own port, which is adapted from three-flatland Slug
(MIT).
