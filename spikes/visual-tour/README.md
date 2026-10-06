# Visual tour (local A/B of pending PRs)

Temporary dev tool. It sits outside the pnpm workspace, has no npm dependencies and no CI, and is deleted once the
pending PRs land. For each pull request it builds the PR's base ("A") and head ("B") in separate worktrees, renders
the same Presentation scenes with both builds, diffs the images and writes a report that walks through every PR:
A | B | diff heatmap, an A/B flip, a 4× nearest-neighbour magnifier and the numbers.

## How it captures

Both builds are captured through the Presentation route that `benchmark:presentation-screenshots` drives
(`benches/scripts/capture-presentation-workloads.mts` → `run-presentation-workload-probe.mts`): each worktree's own
Vite server, `/presentation?mode=benchmark&technique=…&backend=…&delivery=baked&dpr=2&font=inter`, and the same
"Live workload" picker and workload table. The tour renders nothing itself.

There are two capture modes:

- **`--capture tour` (default), [`capture.mjs`](capture.mjs).** The same page, plus a page clock. The stock probe
  screenshots animated workloads at whatever moment its 7-second soak ends. Two runs of one build therefore differ by
  whole frames: in this container, Text ladder differed in 31% of pixels and Editorial (animation switched off) in
  1.4%. `capture.mjs` installs a clock before any page script, freezes it once the page is ready, and sets it so each
  workload is captured at fixed scene times after its mount (`--times 0,2500` by default). Every
  `performance.now()` and animation-frame timestamp then follows the same sequence in A and B. It hides the DOM
  overlay (controls and telemetry) and screenshots the renderer canvas at device pixel ratio `--dpr` (2 by default,
  matching the route's `dpr=2`, so the image is the canvas's own pixels).
- **`--capture probe`.** The worktree's unmodified `run-presentation-workload-probe.mts`, with the environment
  `benchmark:presentation-screenshots` sets (`PRESENTATION_SCREENSHOT_DIR`), once per backend × technique
  (`PRESENTATION_BACKEND`, `PRESENTATION_TECHNIQUE`). The workflow itself hard-codes MSDF, and the probe accepts all
  three techniques. Its images are full-page 1280×720 at DPR 1, after the soak. The telemetry panel and size badges are
  masked out of the numbers. Use it to check that the stock workflow runs on a build. Its diffs on animated workloads
  are noise.

`--noise` captures A a second time and reports A against A for each scene. A scene with any pixel over 1/255 is marked
**unstable**: the capture is not deterministic there, and its A/B numbers are not evidence.

The workloads are the probe's ten: `editorial`, `text-ladder`, `zoom-text`, `icon-grid`, `billboard-labels`,
`off-axis-3d`, `dynamic-layout`, `paragraph-stress`, `paint-effects`, `rich-text`. The techniques are `bitmap`, `msdf`
(the probe's `mtsdf`) and `slug`. The backends are `webgpu` and `webgl2`. One scene is
workload × technique × backend × time.

## What A and B are

- **B:** `pull/<n>/head`, fetched from `origin` (pmndrs/glyph), so fork PRs work.
- **A:** the merge base of B with the PR's base branch. The base branch comes from
  `https://api.github.com/repos/pmndrs/glyph/pulls/<n>`, which works unauthenticated; `GITHUB_TOKEN` is used when set
  and dropped if GitHub rejects it. Without the API, `--base` (default `main`) is used.
- **Stacked PRs** (#227, #229 and #234 target other PR branches) compare against their base branch, not `main`, so a
  diff shows only that PR's change. The tour prints `STACKED: …` and the report says which PR owns the base branch
  when that PR is in the same run.

## Local checklist

Run everything from the repository root. Times in brackets were measured in a 4-core container with no GPU (SwiftShader).
The rest are estimates for a laptop with a GPU and have not been measured.

### 1. Prerequisites (once)

- The mise toolchain: `mise install`, then `mise exec -- pnpm install --frozen-lockfile` in the main checkout. The tour
  uses `mise exec -- pnpm` when `mise` is on `PATH`, and plain `pnpm` otherwise.
- Rust 1.97.1 with the wasm target, for the package build:
  `rustup toolchain install 1.97.1 --target wasm32-unknown-unknown`.
- Git LFS: `git lfs install`. The benchmark fixtures are LFS objects, and each worktree runs `git lfs pull`. Objects
  are shared through the main `.git/lfs`, so only the first pull downloads them.
- Google Chrome with WebGPU. Captures use your installed Chrome by default (Playwright's `chrome` channel), so they
  run on the machine's real GPU. If Chrome isn't installed, the Playwright-managed Chromium is the fallback; download it
  once with `mise exec -- pnpm --filter @pmndrs/glyph-benchmarks exec playwright install chromium`. `--software` runs
  prefer the managed Chromium. To use another browser, pass `--chromium <path>` or set
  `PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH` (the stock probe honours it too).
  Check WebGPU once with `mise exec -- pnpm scripts run benchmark:presentation -- --technique slug --backend webgpu --workload text-ladder`.

### 2. Sync, build and tour

```sh
node spikes/visual-tour/tour.mjs --keep --open
```

This is the same as `--prs 256,234,227,229,240,235 --backends webgpu,webgl2 --techniques bitmap,msdf,slug --times 0,2500`.
For each PR it does the following:

1. **Sync** (seconds): `git fetch origin +refs/pull/<n>/head` and `+refs/heads/<base>`, then
   `git merge-base`.
2. **Worktrees** (seconds each): `git worktree add --detach spikes/visual-tour/.work/<sha> <sha>`, cached by SHA, so a
   base shared by several PRs is built once.
3. **Build**, once per SHA: `git lfs pull` (a few seconds once cached), `pnpm install --frozen-lockfile` (about 5 s from
   a warm pnpm store), and `pnpm --filter @pmndrs/glyph build` ([6.5–7 min], 4-core; it compiles the Rust bakers and the
   shaper to wasm and runs wasm-opt). That build is what `pnpm dev` runs before Vite: the Presentation route compiles
   the workspace sources through Vite's `source` condition and needs only `@pmndrs/glyph`'s `dist/` wasm and workers.
   `--full-build` runs the repository's `pnpm build` instead (much slower). A successful build is recorded in
   `.work/state/<sha>.json` and skipped on later runs while the worktree exists.
4. **Capture**, once per SHA, backend × technique and workload × time. For the ten workloads at two times, each
   backend × technique takes [2 min for WebGL2 MSDF and 4 min for WebGL2 Slug under SwiftShader]; on a GPU expect well
   under a minute (an estimate). Images are cached in
   `.work/captures/<sha>/<variant>/`, and `--recapture` redoes them.
5. **Diff and report** (seconds): `out/<run>/report.json`, `out/<run>/index.html` and `out/<run>/img/`.

The six default PRs need ten distinct commits (as of 2026-10-06: #227's head is #229's base, and #240 and #235 share
a base), so ten builds. Estimate 30–60 min for a cold full run on a laptop and a few minutes for a warm rerun with
`--keep`; these laptop figures are estimates, not measurements. A failed build or capture is recorded in the report (with the log's tail and its path
under `.work/logs/`), and the tour moves on to the next PR.

Useful narrower runs:

```sh
node spikes/visual-tour/tour.mjs --prs 256 --techniques slug --keep --open       # the dilation fix only
node spikes/visual-tour/tour.mjs --skip-build --open                              # reuse kept worktrees as they are
node spikes/visual-tour/tour.mjs --prs 240 --workloads editorial,dynamic-layout --noise --keep
node spikes/visual-tour/tour.mjs --prs 256 --capture probe --techniques slug --keep   # stock probe, for parity
```

Other options: `--run <name>` names `out/<name>/` (default: a timestamp), `--dpr 1|2`, `--serve` serves without
opening a browser, `--port` (default 5179), `--software` (below), `TOUR_VERBOSE=1` streams child output. Notes in
[`prs.json`](#notes-prsjson) override the built-in "what to look at" text.

### 3. Read the report

`--open` (or `--serve`) serves `spikes/` and prints `http://localhost:5179/visual-tour/out/<run>/`. Opening
`out/<run>/index.html` from disk also works. The summary table at the top gives each PR's expectation and its status:

- **as expected:** the PR matched its expectation;
- **UNEXPECTED DIFFERENCE:** an "identical" PR changed pixels;
- **expected a change, saw none:** a "change" PR left every pixel the same;
- **partial** or **failed:** see the errors.

Within a PR, scenes are sorted most-changed first. The keys are <kbd>j</kbd>/<kbd>k</kbd> for the next or previous
scene and <kbd>space</kbd> to flip the B panel to A and back. Clicking a panel opens a 4× nearest-neighbour magnifier
of A, B and the diff at the same spot, and <kbd>Esc</kbd> closes it. The numbers, over RGB, are max |Δ|, mean |Δ|, the
pixels over 1/255 and over 8/255, and the bounding box of the changed pixels. Heatmap colours: yellow is over 8/255,
red is B darker, blue is B brighter, and grey is B unchanged.

### 4. The outline-format A/B

The tour does not cover the outline stream format (V0 curve texels against shared outline points). That A/B has its own
harness, described in [`../outline-stream/README.md`](../outline-stream/README.md):

```sh
node spikes/outline-stream/prepare.mjs     # builds the Rust encoder (needs Rust 1.97.1), bakes the three fixtures
node spikes/outline-stream/serve.mjs       # http://localhost:5178/gpu/ — press "Run all" in Chrome, Safari, Firefox
```

### 5. CPU bench

```sh
node spikes/outline-stream/cpu-bench.mjs   # Inter by default; --font <path> --reps <n>; writes spikes/outline-stream/out/cpu/cpu-bench.json
```

Its run time was not measured here.

## Evidence from this container (software rendering only)

The run was `node spikes/visual-tour/tour.mjs --prs 256 --software --chromium /opt/pw-browsers/chromium --backends webgl2,webgpu --techniques slug,msdf --noise --keep`:
A was `a9713cdf` (main) and B was `1eaea1c6`, with ten workloads at t = 0 and 2500 ms.

- **Determinism:** A captured twice was bit-identical in all 40 WebGL2 scenes (max |Δ| 0).
- **WebGL2 MSDF:** all 20 scenes were identical (max |Δ| 0), as expected for a Slug-only change.
- **WebGL2 Slug:** all 20 scenes changed, with edge pixels only (see the heatmaps). Max |Δ| was 34–138/255, and the
  pixels over 1/255 ranged from 256 (Zoom text at t = 0) to 204,898 (Billboard labels, 5.6%). On Text ladder at
  t = 0, 62,139 pixels were over 1/255 and 18,415 over 8/255. Edges moved both ways: 34,524 pixels were brighter in B
  and 27,615 darker, and the total ink rose by 0.1%.
- **WebGPU:** not captured (see below), so WebGPU against WebGL2 agreement is unverified.

## Without a GPU: `--software`

`--software` launches Chromium with SwiftShader (`--use-angle=swiftshader`, `--use-vulkan=swiftshader`,
`--enable-features=Vulkan`, `--enable-unsafe-swiftshader`). In `tour` mode the flags go straight to Playwright. The
stock probe hard-codes its Chromium flags, but it honours `PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH`, so in `probe` mode
the tour writes `.work/chromium-swiftshader.sh`, a wrapper that appends the flags and execs the real browser. Software
pixels are deterministic but are not a GPU's pixels: use them to prove the pipeline, not to judge rasterization.

WebGPU did not run under SwiftShader in the container this was built in. Its Chromium 141 rejects the `swizzle` field
that the installed three.js passes to `GPUTexture.createView`, the page logs
`Failed to read the 'swizzle' property from 'GPUTextureViewDescriptor'`, and the tour records every WebGPU scene as
missing. Use a Chromium at least as new as the one Playwright 1.61 installs.

In `probe` mode the stock probe fails a whole backend × technique on any browser warning or console error, and only
writes screenshots for the workloads it reached.

## Notes: `prs.json`

This file is optional and merged over the built-in notes per PR number:

```json
{
  "256": { "topic": "Slug dilation", "expect": "change", "note": "Look at …" },
  "241": { "expect": "identical", "note": "…" }
}
```

`expect` is `change` or `identical`, and it drives the summary status.

## Disk use and clean-up

- **Worktrees:** about 3 GB each [measured], 2.2 GB of it in Rust `target/` directories. `node_modules` is hard-linked from the pnpm
  store, so it costs little real space. Six PRs mean up to nine worktrees, or about 27 GB with `--keep`.
- **Without `--keep`:** the tour removes the worktrees it built at the end of the run (`git worktree remove --force`,
  then `git worktree prune`) and keeps only the captures.
- **Captures:** about 0.35 MB per 2560×1440 PNG [measured], so 20 images (7 MB) per SHA × backend × technique at the
  defaults, or about 0.4 GB for ten SHAs × six cells.
- **Reports:** each copies its A and B images and writes heatmaps, about 0.95 MB per scene [38 MB for 40 scenes]. A full
  six-PR run at the defaults (120 scenes per PR) comes to about 0.7 GB.

To clean up everything:

```sh
git worktree list | grep spikes/visual-tour/.work      # what is there
rm -rf spikes/visual-tour/.work spikes/visual-tour/out
git worktree prune
```

`.work/` and `out/` are git-ignored.

## Files

- `tour.mjs`: the orchestrator (sync, worktrees, build, capture, diff, report, static server).
- `capture.mjs`: the deterministic Presentation capture, run from a worktree's `benches/` with that worktree's Vite
  and Playwright.
- `png.mjs`: the PNG decoder (8-bit grey, RGB, RGBA and palette, all five filters, no interlace) and RGBA encoder over
  `node:zlib`, plus the image diff and heatmap.
- `report.mjs`: the HTML report (inline CSS and JS, light and dark).
