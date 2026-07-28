# Hull-assisted Slug band experiment

Status: rejected as a build-time source-class variant.

The copied hull-assisted layout preserves every retained output pixel and moves an exact axis bound ahead of curve texture loads, but no source reaches the optimization protocol's provisional 5% product-level improvement on both backends. Gzip grows by 29.0–44.2% and Slug GPU residency grows by 17.4–25.2%, so the candidate does not justify a source-class-specific format or runtime shader branch.

## Evidence

| Observation         | Packed hull versus fixed 16 |
| ------------------- | --------------------------: |
| Exact quality cells |        28/28 byte-identical |
| Gzip artifact bytes |             29.0–44.2% more |
| Slug GPU residency  |             17.4–25.2% more |
| Missing glyph runs  |                       0/140 |

Five alternating A/B rounds used the 1,500×950 Text Ladder at DPR 2 with twelve causal GPU samples per session. The retained capture contains 140 unique runs: seven sources, two backends, two variants, and five rounds.

| Backend | Source                 | Fixed 16 median GPU | Packed hull median GPU | Median paired change |     Paired range |
| ------- | ---------------------- | ------------------: | ---------------------: | -------------------: | ---------------: |
| WebGPU  | Inter                  |            0.772 ms |               0.761 ms |                −1.2% |    −3.4 to −1.2% |
| WebGPU  | Amiri                  |            1.861 ms |               1.798 ms |                −3.4% |    −4.6 to −2.8% |
| WebGPU  | Noto Sans Devanagari   |            1.542 ms |               1.510 ms |                −2.1% |  −11.7 to +17.0% |
| WebGPU  | DotGothic16            |            2.183 ms |               2.132 ms |                +5.7% | −20.2 to +115.9% |
| WebGPU  | Noto Sans CJK showcase |            2.244 ms |               2.489 ms |                +0.3% |  −16.1 to +30.8% |
| WebGPU  | Source Serif 4         |            0.763 ms |               0.744 ms |                −1.4% |   −3.7 to +64.6% |
| WebGPU  | Dancing Script         |            2.272 ms |               2.129 ms |                −1.6% |  −14.8 to +20.2% |
| WebGL2  | Inter                  |            0.963 ms |               0.907 ms |                −2.2% |    −7.2 to +7.2% |
| WebGL2  | Amiri                  |            1.806 ms |               1.766 ms |                −4.3% |    −5.0 to −1.4% |
| WebGL2  | Noto Sans Devanagari   |            2.759 ms |               2.666 ms |                −3.3% |    −5.7 to +1.8% |
| WebGL2  | DotGothic16            |            2.818 ms |               2.715 ms |                −3.6% |    −5.1 to −1.6% |
| WebGL2  | Noto Sans CJK showcase |            3.108 ms |               2.965 ms |                −4.6% |   −10.3 to −3.5% |
| WebGL2  | Source Serif 4         |            0.912 ms |               0.959 ms |                −0.8% |   −8.5 to +20.3% |
| WebGL2  | Dancing Script         |            2.902 ms |               2.797 ms |                −3.6% |   −10.1 to −0.2% |

The candidate regeneration check reproduced all seven authenticated artifacts from the candidate commit:

```text
mise exec -- node ./scripts/generate-slug-fixed32-experiment.mts --experiment=hull --check
exit 0
```

The command ran from `apps/benchmarks`; the same script intentionally resolves fixture inputs relative to that package. Exact artifact identities, page sizes, raw histories, and machine summaries are retained in `artifacts-v0.json`, `quality-chromium149.json`, `performance-chromium149.json`, and `environment.json`. The candidate and capture identities in `environment.json` are Git-history provenance; the capture JSON records the immutable base directly.

## Findings

1. The strongest paired median is Amiri at −3.4% on WebGPU and −4.3% on WebGL2. It is directionally consistent but below the provisional 5% gate on both backends while adding 44.2% gzip bytes and 20.6% GPU residency.
2. Noto Sans CJK reaches −4.6% on WebGL2 but regresses by +0.3% on WebGPU. DotGothic16 similarly improves by −3.6% on WebGL2 and regresses by +5.7% on WebGPU. The intended dense-source class therefore has no dual-backend product win.
3. Four DotGothic16 quality cells retain their previously characterized hinted-Canvas severe-error pixels, but `exactBaselinePixels` is true in every cell: the hull candidate introduces no changed output pixels.
4. The failed candidate is removed from the shipping tree. Commit `4631599d676feb1c02f12b0e6fc3cdb1c2719ed6` retains the exact implementation and capture probes for audit without adding an alternate public format or shader branch.

## Not verified

- Bake time and peak baker memory were not retained.
- Product timing was not repeated at DPR 1, another viewport, or a second physical GPU.
- Five pairs characterize direction and dispersion but do not establish a formal 95% confidence interval for the noisy sources.

## Next

Test the legacy plan's unimplemented per-root structural branches without changing the Slug artifact format or floating-point accumulation order.
