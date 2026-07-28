# Fixed-32 Slug band calibration

Status: calibration only; do not adopt as the production policy.

The fixed-32 challenger preserved every retained output pixel and reduced scalar curve visits, but its universal payload and residency costs are too large to accept without a less noisy, complete performance win. The result justifies testing adaptive per-glyph bands that retain fixed 16 for sparse glyphs.

## Evidence

| Observation             | Fixed 32 versus fixed 16 |
| ----------------------- | -----------------------: |
| Exact quality cells     |     28/28 byte-identical |
| Scalar evaluated curves |         12.0–19.4% fewer |
| Gzip artifact bytes     |          14.4–21.6% more |
| Slug GPU residency      |          13.0–20.3% more |

Five alternating A/B rounds used the 1,500×950 Text Ladder at DPR 2 with twelve causal GPU samples per session:

| Backend | Source            | Fixed 16 median GPU | Fixed 32 median GPU | Median paired change | Paired changes                   |
| ------- | ----------------- | ------------------: | ------------------: | -------------------: | -------------------------------- |
| WebGPU  | Inter             |            0.780 ms |            0.726 ms |                −7.4% | −4.7, −6.0, −9.3, −7.4, −7.9%    |
| WebGPU  | Noto CJK showcase |            2.698 ms |            2.587 ms |                −5.3% | −5.3, −15.8, +2.6, −11.6, +25.7% |
| WebGL2  | Inter             |            0.977 ms |            0.889 ms |                −8.2% | −8.2, −11.0, −22.5, −0.2, +1.2%  |
| WebGL2  | Noto CJK showcase |            3.289 ms |            2.964 ms |               −10.4% | −12.5, −8.4, −4.3, −10.4, −13.8% |

Raw measurements are retained in `quality-chromium149.json` and `performance-chromium149.json`. Exact artifact identities and resource costs are in `artifacts-v0.json`.

## Findings

1. The shader responds to lower per-fragment curve traversal even on the Latin ladder.
2. Doubling bands also increases duplicated references: Inter grows from 93,280 to 186,560 headers and from 335,979 to 452,765 references; the Japanese showcase grows from 4,960 to 9,920 headers and from 34,920 to 51,647 references.
3. Japanese WebGPU dispersion crosses zero, so the current run does not establish a reliable fixed-32 win there.
4. The manifest was materialized with the retained calibration rather than committed before the first local capture. The variables were fixed in code, but this result therefore cannot qualify for automatic acceptance under the repository protocol.

## Not verified

- Fixed 32 was not performance-tested over the other five source families or DPR 1.
- No bake-time or peak-memory comparison was retained.
- The existing generated-WGSL unreachable-`break` warnings remain unchanged from the baseline.

## Next

Precommit an adaptive `{16, 32, 64}` per-glyph manifest, then measure whether it preserves the curve-work improvement without imposing the universal fixed-32 storage cost.
