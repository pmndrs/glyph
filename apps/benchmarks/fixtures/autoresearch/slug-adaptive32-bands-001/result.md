# Capped adaptive Slug band experiment

Status: rejected as a production policy.

The precommitted `{16, 32}` policy preserves every retained output pixel and reduces scalar curve visits, but it fails the end-to-end guard gate. DotGothic16 regresses by 14.9% median paired GPU time on WebGPU, while the Noto CJK WebGPU improvement is noisy and its WebGL2 median does not reach the provisional 5% gate. The added payload and residency therefore have no complete dual-backend product win.

## Evidence

| Observation             | Adaptive 32 versus fixed 16 |
| ----------------------- | --------------------------: |
| Exact quality cells     |        28/28 byte-identical |
| Scalar evaluated curves |             2.7–13.5% fewer |
| Gzip artifact bytes     |              6.5–17.0% more |
| Slug GPU residency      |              5.7–14.6% more |

Five alternating A/B rounds used the 1,500×950 Text Ladder at DPR 2 with twelve causal GPU samples per session. The retained capture contains 140 runs: seven sources, two backends, two variants, and five rounds.

| Backend | Source                 | Fixed 16 median GPU | Adaptive 32 median GPU | Median paired change |    Paired range |
| ------- | ---------------------- | ------------------: | ---------------------: | -------------------: | --------------: |
| WebGPU  | Inter                  |            0.776 ms |               0.765 ms |                −1.4% |   −2.8 to −0.6% |
| WebGPU  | Amiri                  |            1.849 ms |               1.828 ms |                −1.4% |   −1.8 to −0.3% |
| WebGPU  | Noto Sans Devanagari   |            2.554 ms |               2.122 ms |                −0.8% | −45.4 to +17.7% |
| WebGPU  | DotGothic16            |            2.539 ms |               2.918 ms |               +14.9% |  +6.1 to +36.4% |
| WebGPU  | Noto Sans CJK showcase |            2.459 ms |               2.289 ms |               −13.6% | −23.6 to +14.0% |
| WebGPU  | Source Serif 4         |            0.760 ms |               0.736 ms |                −1.9% |   −4.4 to +2.2% |
| WebGPU  | Dancing Script         |            2.880 ms |               2.700 ms |                −7.5% | −33.1 to +23.1% |
| WebGL2  | Inter                  |            0.890 ms |               0.911 ms |                +2.8% |  +0.9 to +22.3% |
| WebGL2  | Amiri                  |            1.962 ms |               1.910 ms |                −2.7% |  −15.2 to +7.3% |
| WebGL2  | Noto Sans Devanagari   |            2.819 ms |               2.815 ms |                −0.5% |   −6.6 to +8.6% |
| WebGL2  | DotGothic16            |            2.922 ms |               2.878 ms |                −1.2% |   −6.6 to +3.1% |
| WebGL2  | Noto Sans CJK showcase |            3.112 ms |               3.004 ms |                −3.5% |   −5.3 to −0.3% |
| WebGL2  | Source Serif 4         |            0.962 ms |               0.924 ms |                −3.9% |  −20.3 to +6.8% |
| WebGL2  | Dancing Script         |            2.865 ms |               2.759 ms |                +1.1% |  −9.1 to +36.7% |

Exact artifact identities, page sizes, glyph-band distributions, raw histories, and machine summaries are retained in `artifacts-v0.json`, `quality-chromium149.json`, and `performance-chromium149.json`.

## Findings

1. Lower scalar curve traversal is not sufficient evidence of lower GPU time. DotGothic16 evaluates 7.0% fewer DPR-2 curves yet regresses consistently on WebGPU.
2. The Noto CJK showcase is the only primary with a provisional-gate-sized WebGPU median, but one pair regresses and the WebGL2 median is only −3.5%.
3. The first 140-run timing capture completed in the browser but its Node wrapper discarded the transcript because the copied seven-source constant was initialized after top-level validation. Commit `e45eae6` corrected that probe ordering before the complete retained rerun; no samples from the discarded capture are mixed into this result.

## Not verified

- Bake time and peak baker memory were not retained.
- Product timing was not repeated at DPR 1 or at another viewport.
- Five pairs characterize direction and dispersion but do not establish a formal 95% confidence interval for the noisy sources.

## Next

Reproduce the older fork's build-time hull-assisted band experiment on the dense sources, retaining the baseline format for sources where the hull does not clear both backend and storage gates.
