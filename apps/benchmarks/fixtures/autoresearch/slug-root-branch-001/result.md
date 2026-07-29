# Per-root branch Slug experiment

Status: rejected as a production shader change.

The structural per-root candidate preserves all 28 retained quality cells and leaves artifact bytes and Slug GPU residency unchanged, but no source improves GPU frame time by at least 5% on both backends. The candidate also adds 304 generated shader bytes on each backend, so it does not clear the precommitted product gate.

## Evidence

The quality capture covers seven sources, WebGPU and WebGL2, and DPR 1 and 2. Every candidate framebuffer is byte-identical to its corresponding baseline framebuffer. The four retained final-program records show that Three 0.185.1 already lowers the baseline boolean selections to control flow: the candidate reduces root-condition branches from eight to four while growing WGSL from 15,464 to 15,768 bytes and GLSL from 16,593 to 16,897 bytes.

Five alternating A/B rounds used the 1,500×950 Text Ladder at DPR 2 with twelve retained steady-state GPU reports per session. The performance capture contains 140 runs: seven sources, two backends, two variants, and five rounds. Positive percentages are regressions.

| Backend | Source                 | Baseline median GPU | Candidate median GPU | Median paired change |      Paired range |
| ------- | ---------------------- | ------------------: | -------------------: | -------------------: | ----------------: |
| WebGPU  | Inter                  |            0.777 ms |             0.782 ms |               +0.84% |   −0.65 to +1.19% |
| WebGPU  | Amiri                  |            1.862 ms |             1.862 ms |               +0.11% |   −0.23 to +0.37% |
| WebGPU  | Noto Sans Devanagari   |            2.932 ms |             2.939 ms |               +0.71% | −16.22 to +31.16% |
| WebGPU  | DotGothic16            |            2.317 ms |             2.256 ms |               −4.06% | −24.29 to +13.56% |
| WebGPU  | Noto Sans CJK showcase |            1.267 ms |             1.354 ms |               +8.43% |  −6.15 to +56.77% |
| WebGPU  | Source Serif 4         |            0.449 ms |             0.426 ms |               +1.19% | −19.77 to +17.05% |
| WebGPU  | Dancing Script         |            1.137 ms |             1.179 ms |               +1.74% |   −5.98 to +6.68% |
| WebGL2  | Inter                  |            0.936 ms |             1.022 ms |              +11.22% | −45.80 to +95.57% |
| WebGL2  | Amiri                  |            1.097 ms |             1.161 ms |               +3.35% | −43.47 to +71.01% |
| WebGL2  | Noto Sans Devanagari   |            2.890 ms |             2.837 ms |               −1.56% | −27.71 to +16.93% |
| WebGL2  | DotGothic16            |            3.083 ms |             3.044 ms |               −0.56% |   −3.43 to +7.71% |
| WebGL2  | Noto Sans CJK showcase |            3.303 ms |             3.198 ms |               −2.27% |  −32.71 to −0.40% |
| WebGL2  | Source Serif 4         |            0.986 ms |             0.980 ms |               −9.03% |  −14.00 to +9.55% |
| WebGL2  | Dancing Script         |            3.065 ms |             2.949 ms |               −1.98% |   −5.65 to −0.32% |

Across the seven source medians, the middle paired change is a 0.84% WebGPU regression and a 1.56% WebGL2 improvement. All fourteen source/backend summaries report identical baseline and candidate artifact bytes and identical Slug GPU bytes. All 140 runs report zero missing glyphs.

The immutable base is `1ba4c6713579141c661e7cb2b5f089986258651a`. Commit `dac20ea9df48e4b907fdd4211d0348dc3ed6c858` contains the product candidate used by the quality capture. The performance capture identifies its evidence-only descendant `7ae82fd9e312b5c5a2e73ae48ff6fe6830429f69`; the diff from `dac20ea9` adds only the retained quality JSON and documentation. Commit `317511f88190ef059694a9ebc5dbc9e80e93a953` records the rejection and removes the temporary selector, candidate shader implementation, capture scripts, and probes from the shipping tree while retaining both JSON observations.

## Findings

1. **Observed:** the older mechanism hypothesis is contradicted by the retained generated programs. The baseline already contains eight root-condition branches across the two axes; it does not eagerly evaluate both root contributions.
2. **Inferred:** coalescing those conditions into four branches is not a reliable end-to-end win on this corpus and machine. The largest observed regressions are +8.43% for Noto Sans CJK on WebGPU and +11.22% for Inter on WebGL2, and the paired ranges are wide for several sources.
3. **Observed:** DotGothic16 retains severe-error pixels relative to the independent quality reference in some cells, but `exactBaselinePixels` is true in all 28 cells. Those characterized errors are not candidate regressions.

## Not verified

- Startup effects were captured only as raw per-run values and were not reduced into a precommitted paired gate.
- Bake time and peak baker memory were not retained.
- Product timing was not repeated at DPR 1, another viewport, or a second physical GPU.
- Five pairs expose substantial dispersion but do not establish a formal 95% confidence interval.
- The capture JSON does not retain the Node, pnpm, Rust, operating-system build, or physical machine model.

## Next

Keep the shipping baseline and move to a different precommitted Slug hypothesis rather than restoring this root-branch candidate.
