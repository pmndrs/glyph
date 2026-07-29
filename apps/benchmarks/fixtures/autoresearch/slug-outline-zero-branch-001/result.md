# Slug zero-width outline branch experiment

Status: accepted as the production one-draw outline path.

The per-fragment zero-width branch preserves exact output pixels while reducing median paired GPU time by 30.51% on WebGPU and 23.96% on WebGL2 for the mixed outlined/unoutlined workload. It clears the precommitted 5% dual-backend gate without a median regression above 2% at any tested size or in the all-outlined guard.

## Evidence

The quality capture covers WebGPU and WebGL2 at DPR 1 and 2 for both alternating-outline and all-outlined scenes. All eight candidate framebuffers are byte-identical to their multiply-zero baselines, every case remains one draw, and all four workload-membership negative controls change exactly 18,937 pixels.

The retained generated programs are distinct. The branch adds 64 source bytes and two greater-than comparisons on each backend: WGSL grows from 35,987 to 36,051 bytes and GLSL grows from 38,252 to 38,316 bytes.

Sixty-four alternating A/B pairs per backend used the 1,500×950 Paint Effects workload at DPR 2 with twelve retained steady-state GPU reports per run. Positive percentages are regressions.

| Backend | Pattern     | Size      | Pairs | Baseline median GPU | Candidate median GPU | Median paired change | Bootstrap median 95% CI |
| ------- | ----------- | --------- | ----: | ------------------: | -------------------: | -------------------: | ----------------------: |
| WebGPU  | alternating | all sizes |    48 |            2.733 ms |             1.824 ms |              −30.51% |       −32.67 to −27.95% |
| WebGPU  | alternating | 16 px     |    16 |            1.116 ms |             0.771 ms |              −30.51% |       −31.82 to −29.11% |
| WebGPU  | alternating | 40 px     |    16 |            2.733 ms |             1.824 ms |              −33.37% |       −33.49 to −33.11% |
| WebGPU  | alternating | 128 px    |    16 |            3.497 ms |             3.362 ms |               −3.59% |         −4.54 to +7.00% |
| WebGL2  | alternating | all sizes |    48 |            2.642 ms |             1.996 ms |              −23.96% |       −24.35 to −23.14% |
| WebGL2  | alternating | 16 px     |    16 |            1.407 ms |             1.129 ms |              −19.25% |       −21.15 to −18.41% |
| WebGL2  | alternating | 40 px     |    16 |            2.642 ms |             1.996 ms |              −24.40% |       −25.19 to −24.26% |
| WebGL2  | alternating | 128 px    |    16 |            4.196 ms |             3.174 ms |              −24.22% |       −24.69 to −23.91% |

Sixteen additional all-outlined pairs per backend guard the branch overhead when every fragment can require stroke evaluation. The aggregate median paired change is −0.23% on WebGPU and +0.38% on WebGL2. The largest per-size guard median is +1.53%, below the precommitted +2% limit. Every run reports one draw, zero missing glyphs, identical 618,487-byte artifacts, and identical 3,162,112-byte Slug GPU resources between variants.

The immutable base is `85bdcebf68f3a32ff681b5afb020b304ecb4d357`; candidate and capture commit `e9d0c6259c123ef02d44b834ff020391d5167107` contains the measured implementation and capture harness. Exact observations, generated shaders, commit-scoped source identities, fixture identities, and toolchain pins are authenticated by `environment.json`.

## Findings

1. **Observed:** branching around analytic stroke evaluation is materially cheaper than evaluating stroke and multiplying by zero in a mixed one-draw batch on both measured backends.
2. **Observed:** the all-outlined workload does not show a material aggregate penalty, although its smaller per-size samples are less conclusive than the primary workload.
3. **Observed:** the WebGPU 128 px primary median improves by 3.59%, below the 5% aggregate target, and its per-size confidence interval crosses zero. The precommitted gate requires the 5% improvement and negative confidence bound across all primary sizes together, while limiting each individual size to a 2% median regression; the candidate satisfies those conditions.

## Not verified

- Performance was not repeated on a second physical GPU, browser engine, viewport, DPR, font, stroke width, or outlined-glyph ratio.
- The all-outlined per-size groups contain only five or six pairs; their confidence intervals are wider than the median-only guard gate.
- CPU submit time, startup time, bake time, and peak memory were observed incidentally or not retained as acceptance metrics.
- The physical machine model at capture time was not retained.

## Next

Keep the accepted zero-width branch as the shipping one-draw outline baseline while later Slug work preserves the measured mixed-batch and all-outlined guards.
