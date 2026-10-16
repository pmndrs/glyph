## Package performance: `publication` suite

55 faster · 11 slower · 18 neutral · 3 skipped

Baseline `0.1.0 (3c6edf62)` → candidate `0.1.0 (d6b0f5a0)`

> ⚠ candidate CPU clock drifted 8.7% during its run

Latency distribution across 84 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  3.665ms |   2.710ms |
| Workloads ≤1 ms     |       21 |        24 |
| Workloads ≤2 ms     |       33 |        38 |
| Workloads ≤3 ms     |       39 |        46 |
| Workloads >3 ms     |       45 |        38 |

Largest candidate workloads (including neutral results):

| workload                                                                 | baseline | candidate |     Δ time |
| ------------------------------------------------------------------------ | -------: | --------: | ---------: |
| 1000 labels 100 edits interleaved edit-read publication                  | 215.82ms |   70.37ms | -145.450ms |
| mutate one trailing span across 1000 formatted labels                    |  64.82ms |   56.01ms |   -8.810ms |
| 1000 labels 100 edits immediate measurements with publication            | 152.67ms |   29.95ms | -122.720ms |
| publish 1024 retained Text instances                                     |  23.58ms |   29.07ms |   +5.490ms |
| monospaced broad end-to-end setter and publication with 8192 paint spans | 201.48ms |   24.44ms | -177.040ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- publish 1024 retained Text instances                                         ┊├─────●┤          +23.3%   .029  ▅█▇▄▂▂▁▁▁▁ ▁▁▁▂█▇▅▃▁▁
- 10 labels last same-length engine publication                                ┊   ├─●──┤         +20.7%   .029  ▄█▄▃▂▂▁▁▁▁ ▁▃██▅▃▃▃▂▁
- rewrite 512 labels in one group                                              ┊   ├●─┤           +18.2%   .029  ▃█▄▄▂▁▁▁▁▁ ▁▁▁▂▇█▄▃▂▂
- rewrite 64 labels in one group                                               ┊├───●─────┤       +16.8%   .029  ▆█▃▁▁▁▁▁▁▁ ▂█▄▃▂▁▁▁▁▁
- 10 labels last same-length scene publication                                 ┊  ├●──────┤       +13.2%   .029  ▂█▆▃▃▃▁▁▁▁ ▁▁█▆▄▃▃▂▁▁
- 10 labels first same-length engine publication                               ┊  ├●─────────┤    +12.6%   .029  ▄█▃▃▂▁▁▁▁▁ ▁▄█▆▃▂▁▁▁▁
- 1000 labels no-op scene traversal                                            ┊├─●───────────┤   +11.1%   .029  ▆█▂▂▁▁▁▁▁▁ ▁█▄▂▁▁▁▁▁▁
- 10 labels first same-length scene publication                                ┊├─●──┤            +10.4%   .029  ▂▆█▄▃▃▂▁▁▁ ▁▂▆█▅▃▃▃▂▂
- rewrite 128 labels in one group                                              ┊ ├●──┤             +9.4%   .029  ▃█▅▂▁▁▁▁▁▁ ▁▅█▇▂▂▂▁▁▁
- rewrite 256 labels in one group                                              ┊├●─┤               +7.8%   .029  ▂▇█▇▃▂▁▁▁▁ ▁▁▇█▇▅▃▂▂▂
- 10 labels last length-changing scene publication                             ┊├●────┤            +6.5%   .029  ▂█▆▄▃▂▁▁▁▁ ▁▆█▆▄▃▂▁▁▁
+ 10 labels first color-only engine publication                         ├────●─┤                   -5.9%   .029  ▁▄█▆▃▂▃▁▁▁ ▂█▆▃▃▂▁▁▁▁
+ 100 labels separated balanced gro…k-space engine publication              ├●─┤                   -6.1%   .029  ▁▂▇█▆▄▃▂▂▂ ▃▇█▆▄▃▃▃▁▁
+ publish after color change                                                ├●┤┊                   -6.7%   .029  ▁▃▆█▅▅▄▃▂▁ ▂█▅▃▃▁▂▂▂▁
+ normalize 1000 equivalent formatted flow updates                        ├──● ┊                   -6.9%   .029  ▁▁▂▃▅█▆▆▅▁ ▄▆▅█▇▃▂▁▂▁
+ publish after text change                                                 ●┤ ┊                   -9.3%   .029  ▁▁▁▂▆█▅▃▂▂ ▂▅█▄▃▃▁▂▂▁
+ 100 labels separated balanced gro…nk-space scene publication             ├●─┤┊                   -9.4%   .029  ▁▃█▆▄▄▃▂▂▁ ▃█▆▄▃▂▁▁▁▁
+ 100 labels last length-changing scene publication                        ├●┤ ┊                  -11.1%   .029  ▁▂█▇▅▂▂▂▂▁ ▄█▇▃▃▂▁▁▁▁
+ publication after text change                                           ├─●┤ ┊                  -11.6%   .029  ▁▁▂▃▅█▆▅▃▃ ▃▇█▇▃▂▂▁▁▁
+ reorder then edit one of 1000 retained labels                           ├●─┤ ┊                  -12.0%   .029  ▁▁▅██▇▃▂▁▁ ▆█▆▅▁▁▁▁▁▁
+ 100 labels last length-changing engine publication                      ├●─┤ ┊                  -12.5%   .029  ▁▁▆█▆▄▂▂▂▁ ▄█▆▄▃▂▁▁▁▁
+ mutate one trailing span across 1000 formatted labels                   ├●   ┊                  -13.6%   .029  ▁▁▁▁▃▆██▄▂ ▂▆█▄▁▁▁▁▁▁
+ 100 labels batched edit-read publication                               ├●─┤  ┊                  -15.1%   .029  ▁▂▃█▅▂▂▂▁▁ ▂▇█▁▁▁▁▁▁▁
+ 100 labels first length-changing engine publication                   ├─●─┤  ┊                  -16.0%   .029  ▁▁▁██▆▄▃▂▁ ▂█▆▅▃▂▂▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates           ├●┤   ┊                  -16.9%   .029  ▁▁▁▁▆█▅▅▃▂ ▄▆█▆▁▁▁▁▁▁
+ measurement then publication after width change                      ├──●───┤┊                  -17.0%   .029  ▁▂▃▃▇█▅▄▃▂ ▂▂▅█▆▅▂▁▁▁
+ 100 labels first length-changing scene publication                     ├●─┤  ┊                  -17.3%   .029  ▁▁▂▆█▅▄▂▂▂ ▂█▇▅▃▂▁▁▁▁
+ reorder 1000 unchanged retained labels                              ├───●───┤┊                  -17.8%   .029  ▄█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels last color-only engine publication                       ├──●──┤  ┊                  -21.3%   .029  ▁▁▆█▃▂▂▂▂▂ ▂█▄▃▂▂▁▁▁▁
+ 100 labels last color-only scene publication                         ├●─┤    ┊                  -21.9%   .029  ▁▁▄█▄▂▂▃▂▁ ▂█▅▃▂▂▂▁▁▁
+ 100 labels first color-only scene publication                        ├●─┤    ┊                  -22.3%   .029  ▁▁▇█▄▂▃▂▁▁ ▄█▅▃▂▂▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans        ├─●┤     ┊                  -23.8%   .029  ▁▁▁█▆▃▃▂▁▁ ▆█▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                 ├─●─┤    ┊                  -24.6%   .029  ▁▁▁▁▂█▆▂▁▁ ▂█▃▂▁▁▁▁▁▁
+ 100 labels first color-only engine publication                      ├●─┤     ┊                  -26.6%   .029  ▁▁▃█▄▂▂▃▂▁ ▂█▄▃▃▂▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication        ├●┤      ┊                  -26.8%   .029  ▁▁▁▃█▇▄▂▁▁ ▅█▄▃▂▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans     ├──●┤       ┊                  -29.8%   .029  ▁▁▁▃█▄▄▃▂▂ █▆▁▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication       ├●        ┊                  -31.0%   .029  ▁▁▁▁▁▁▇█▅▂ ▃█▄▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans    ├──●┤        ┊                  -32.9%   .029  ▁▁▁▁▁█▅▆▃▂ █▇▂▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                    ├──●───┤     ┊                  -33.8%   .029  ▁▁▁▁▁▁█▅▂▁ ▇█▄▅▂▂▁▁▁▁
+ inspection then publication after width change                  ├──●┤        ┊                  -33.9%   .029  ▁▂▁██▃▁▁▆▄ ██▁▃▃▃▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ├─●─┤       ┊                  -34.1%   .029  ▁▁▁▁▁▂▇█▃▂ ▃█▅▂▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication     ├──●───┤     ┊                  -34.2%   .029  ▁▁▁▁▁▂█▆▄▂ ▃█▃▂▂▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans   ├───●         ┊                  -34.5%   .029  ▁▁▁▁▅█▄▄▂▁ ▄▇█▂▁▁▁▁▁▁
+ split move and merge paint boundaries publication                 ●┤         ┊                  -35.1%   .029  ▁▁▁▁▁▁▄▇█▃ ▄█▃▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ├●──┤       ┊                  -35.5%   .029  ▁▁▁▁▂█▇▂▂▂ ▃█▂▂▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                  ├●┤         ┊                  -38.1%   .029  ▁▁▁▁▁▂▆█▄▂ ▄█▅▂▂▁▁▁▁▁
+ 1000 labels last length-changing scene publication              ├●┤          ┊                  -38.9%   .029  ▁▁▁▁▁▁▃█▅▃ ▃█▅▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication    ├●────────┤  ┊                  -39.5%   .029  ▁▁▁▁▁▄▇█▄▁ ▄█▄▂▂▂▁▁▂▁
+ 100 labels 100 edits immediate measurements with publication    ├●┤          ┊                  -39.8%   .029  ▁▁▁▁▁▁▃█▄▃ ▃█▄▂▁▁▁▁▁▁
+ 1000 labels first same-length engine publication                ├●┤          ┊                  -40.4%   .029  ▁▁▁▁▁▁▅██▃ ▂█▄▂▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                  ├●           ┊                  -40.5%   .029  ▁▁▁▁▁▃█▇▃▂ ▃█▃▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ●┤           ┊                  -42.1%   .029  ▁▁▁▁▁▁▅█▆▂ ▃█▃▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication               ◀─●┤           ┊                  -42.3%   .029  ▁▁▁▁▄█▅▃▂▁ ▆█▂▁▁▁▁▁▁▁
+ reflow after width change                                     ◀─●┤           ┊                  -43.8%   .029  ▁▁▁▂█▃▃▁▁▁ ▄█▃▃▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans  ◀─●──┤         ┊                  -44.5%   .029  ▁▁█▆▃▁▂▁▁▂ ▄█▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans   ├●            ┊                  -44.8%   .029  ▁▁▁▁▁▂█▄▂▁ █▄▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ├●┤            ┊                  -47.7%   .029  ▁▁▁▁▁▁▁▆█▃ ▅█▂▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ●┤             ┊                  -48.9%   .029  ▁▁▁▁▁▁▁▆█▂ ▇█▂▁▁▁▁▁▁▁
+ publication after width change                                ◀              ┊                  -54.3%   .029  ▁▁▄▂█▄▅▅▃▂ █▇▂▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -61.3%   .029  ▁▁▁▁▁▁▆█▄▂ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -61.9%   .029  ▁▁▁▁▁▂▇█▄▁ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -67.4%   .029  ▁▁▁▁▁▃█▇▂▁ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -68.8%   .029  ▁▁▁▁▁▁▆█▅▄ ██▂▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -69.4%   .029  ▁▁▁▁▁▁▆█▆▃ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -80.4%   .029  ▁▁▁▁▁▁▁▁█▄ █▁▁▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -87.9%   .029  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
  publication after font-size change                                           ├─●┤                +6.7%   .114  ▅█▆▅▅▃▂▁▁▁ ▁▂▂▆██▄▄▂▁
  relayout after font-size change                                             ├┼●┤                 +2.0%   .486  ▂▅█▅▂▃▂▁▁▁ ▁▅█▆▅▃▃▂▂▁
  move 1000 retained TypeGPU labels                                         ├──┼●                  +1.8%   .686  ▁▂▇█▃▂▁▁▁▁ ▁▄▅█▃▃▁▁▂▁
  10 labels last length-changing engine publication                           ├●─┤                 +0.5%   .686  ▂▇█▅▄▃▂▂▁▁ ▂▇█▆▃▄▂▂▂▂
  10 labels last color-only scene publication                                ├─●───────┤           -0.1%  1.000  ▁▇█▃▂▂▃▂▁▁ ▃██▅▃▃▂▂▂▁
  100 labels last same-length engine publication                              ├●──┤                -0.5%  1.000  ▁▅█▅▄▃▂▂▂▁ ▂█▇▆▄▃▂▃▁▁
  10 labels first length-changing scene publication                     ├──────●───┤               -0.9%   .686  ▂█▆▄▃▂▁▁▁▁ ▂█▇▄▃▂▁▁▁▁
  reuse 1000 unchanged Vue property snapshots                              ├───●──┤                -1.5%  1.000  ▁▄█▂▁▁▁▁▁▁ ▇██▅▂▃▂▂▁▁
  100 labels no-op scene traversal                                          ├─●┼────┤              -1.8%  1.000  ▃█▆▃▁▂▁▁▁▁ ▅█▆▃▃▂▁▂▁▁
  100 labels first same-length scene publication                            ├─●┼┤                  -2.1%   .200  ▁▅█▅▅▂▂▃▂▁ ▃██▅▄▃▂▁▁▁
  normalize 1000 equivalent retained label updates                      ├─────●┼─────┤             -2.3%   .886  ▁▇▇▃▅█▆▃▂▁ ▅▅▄▃█▇▅▃▁▂
  10 labels first color-only scene publication                            ├───●┼──────────┤        -3.1%   .686  ▂█▃▃▁▁▁▁▁▁ ▃█▄▃▂▁▁▁▁▁
  100 labels first same-length engine publication                            ├●┼┤                  -4.2%   .343  ▂▅██▅▃▃▂▂▁ ▂██▅▃▃▃▂▂▁
  100 labels separated unbalanced g…k-space engine publication               ├●┤                   -4.7%   .057  ▁▂▆██▅▄▃▁▁ ▂▆█▅▅▄▂▃▂▁
  100 labels last same-length scene publication                             ├─●┼─────┤             -4.8%   .686  ▂█▆▃▂▂▁▁▁▁ ▄█▆▃▂▁▁▁▁▁
  toggle one group containing 1000 retained labels                        ├───●┼─┤                 -4.9%   .686  ▃█▃▂▁▂▁▁▁▁ ▂█▂▁▁▁▁▁▁▁
  100 labels separated unbalanced g…nk-space scene publication              ├●─┼───────────┤       -6.2%   .343  ▁█▄▁▁▁▁▁▁▁ ▃█▃▁▂▁▁▁▁▁
  10 labels last color-only engine publication                           ├───●─┼┤                  -8.1%   .114  ▁▇█▄▃▂▂▁▁▁ ▂█▅▃▂▁▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status    | bench                                                                             | baseline | candidate | Δ time     | Δ p50  | p    | 95% CI        |
| --------- | --------------------------------------------------------------------------------- | -------- | --------- | ---------- | ------ | ---- | ------------- |
| 🔴 slower | publish 1024 retained Text instances                                              | 23.58ms  | 29.07ms   | +5.490ms   | +23.3% | .029 | +4.3..+25.6%  |
| 🔴 slower | 10 labels last same-length engine publication                                     | 688.92µs | 831.81µs  | +0.143ms   | +20.7% | .029 | +14.0..+29.3% |
| 🔴 slower | rewrite 512 labels in one group                                                   | 12.44ms  | 14.70ms   | +2.260ms   | +18.2% | .029 | +12.7..+22.2% |
| 🔴 slower | rewrite 64 labels in one group                                                    | 2.28ms   | 2.67ms    | +0.390ms   | +16.8% | .029 | +4.7..+37.4%  |
| 🔴 slower | 10 labels last same-length scene publication                                      | 726.71µs | 822.46µs  | +0.096ms   | +13.2% | .029 | +9.9..+38.0%  |
| 🔴 slower | 10 labels first same-length engine publication                                    | 698.19µs | 785.85µs  | +0.088ms   | +12.6% | .029 | +9.1..+45.3%  |
| 🔴 slower | 1000 labels no-op scene traversal                                                 | 688.10µs | 764.81µs  | +0.077ms   | +11.1% | .029 | +4.8..+48.6%  |
| 🔴 slower | 10 labels first same-length scene publication                                     | 748.42µs | 826.35µs  | +0.078ms   | +10.4% | .029 | +4.5..+19.6%  |
| 🔴 slower | rewrite 128 labels in one group                                                   | 3.76ms   | 4.11ms    | +0.350ms   | +9.4%  | .029 | +5.4..+20.3%  |
| 🔴 slower | rewrite 256 labels in one group                                                   | 6.76ms   | 7.28ms    | +0.520ms   | +7.8%  | .029 | +2.3..+11.8%  |
| 🔴 slower | 10 labels last length-changing scene publication                                  | 975.90µs | 1.04ms    | +0.064ms   | +6.5%  | .029 | +2.0..+23.2%  |
| 🟢 faster | 10 labels first color-only engine publication                                     | 586.79µs | 552.35µs  | -0.034ms   | -5.9%  | .029 | -21.7..-1.4%  |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication                | 1.50ms   | 1.41ms    | -0.090ms   | -6.1%  | .029 | -11.2..-1.2%  |
| 🟢 faster | publish after color change                                                        | 2.28ms   | 2.13ms    | -0.150ms   | -6.7%  | .029 | -10.8..-5.0%  |
| 🟢 faster | normalize 1000 equivalent formatted flow updates                                  | 8.06ms   | 7.51ms    | -0.550ms   | -6.9%  | .029 | -16.4..-5.3%  |
| 🟢 faster | publish after text change                                                         | 3.28ms   | 2.98ms    | -0.300ms   | -9.3%  | .029 | -11.0..-8.1%  |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication                 | 1.61ms   | 1.46ms    | -0.150ms   | -9.4%  | .029 | -14.1..-3.8%  |
| 🟢 faster | 100 labels last length-changing scene publication                                 | 1.36ms   | 1.21ms    | -0.150ms   | -11.1% | .029 | -15.0..-7.0%  |
| 🟢 faster | publication after text change                                                     | 10.46ms  | 9.24ms    | -1.220ms   | -11.6% | .029 | -15.8..-5.9%  |
| 🟢 faster | reorder then edit one of 1000 retained labels                                     | 9.50ms   | 8.36ms    | -1.140ms   | -12.0% | .029 | -16.2..-5.7%  |
| 🟢 faster | 100 labels last length-changing engine publication                                | 1.29ms   | 1.13ms    | -0.160ms   | -12.5% | .029 | -15.7..-7.6%  |
| 🟢 faster | mutate one trailing span across 1000 formatted labels                             | 64.82ms  | 56.01ms   | -8.810ms   | -13.6% | .029 | -15.7..-12.5% |
| 🟢 faster | 100 labels batched edit-read publication                                          | 9.16ms   | 7.78ms    | -1.380ms   | -15.1% | .029 | -19.7..-10.8% |
| 🟢 faster | 100 labels first length-changing engine publication                               | 1.44ms   | 1.21ms    | -0.230ms   | -16.0% | .029 | -23.7..-9.3%  |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates                   | 9.39ms   | 7.80ms    | -1.590ms   | -16.9% | .029 | -21.3..-14.2% |
| 🟢 faster | measurement then publication after width change                                   | 3.67ms   | 3.05ms    | -0.620ms   | -17.0% | .029 | -25.9..-3.2%  |
| 🟢 faster | 100 labels first length-changing scene publication                                | 1.55ms   | 1.28ms    | -0.270ms   | -17.3% | .029 | -19.5..-11.6% |
| 🟢 faster | reorder 1000 unchanged retained labels                                            | 4.60ms   | 3.78ms    | -0.820ms   | -17.8% | .029 | -28.4..-3.8%  |
| 🟢 faster | 100 labels last color-only engine publication                                     | 694.27µs | 546.40µs  | -0.148ms   | -21.3% | .029 | -28.8..-8.7%  |
| 🟢 faster | 100 labels last color-only scene publication                                      | 830.13µs | 647.92µs  | -0.182ms   | -21.9% | .029 | -26.4..-15.5% |
| 🟢 faster | 100 labels first color-only scene publication                                     | 834.06µs | 647.67µs  | -0.186ms   | -22.3% | .029 | -28.0..-16.6% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans                     | 31.59ms  | 24.07ms   | -7.520ms   | -23.8% | .029 | -31.5..-20.1% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication                               | 14.39ms  | 10.85ms   | -3.540ms   | -24.6% | .029 | -28.5..-17.0% |
| 🟢 faster | 100 labels first color-only engine publication                                    | 742.69µs | 545.08µs  | -0.198ms   | -26.6% | .029 | -29.3..-21.2% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication                   | 5.02ms   | 3.68ms    | -1.340ms   | -26.8% | .029 | -28.8..-23.3% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans                 | 31.91ms  | 22.39ms   | -9.520ms   | -29.8% | .029 | -39.9..-25.7% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication                | 7.23ms   | 4.99ms    | -2.240ms   | -31.0% | .029 | -34.4..-29.8% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans      | 27.43ms  | 18.40ms   | -9.030ms   | -32.9% | .029 | -42.5..-31.4% |
| 🟢 faster | 100 labels interleaved edit-read publication                                      | 29.49ms  | 19.54ms   | -9.950ms   | -33.8% | .029 | -42.0..-18.9% |
| 🟢 faster | inspection then publication after width change                                    | 10.99ms  | 7.26ms    | -3.730ms   | -33.9% | .029 | -43.3..-31.5% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication             | 6.99ms   | 4.60ms    | -2.390ms   | -34.1% | .029 | -40.7..-27.5% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication              | 7.63ms   | 5.02ms    | -2.610ms   | -34.2% | .029 | -43.1..-20.8% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans                 | 7.03ms   | 4.60ms    | -2.430ms   | -34.5% | .029 | -47.3..-32.9% |
| 🟢 faster | split move and merge paint boundaries publication                                 | 13.25ms  | 8.60ms    | -4.650ms   | -35.1% | .029 | -36.7..-33.7% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication               | 6.94ms   | 4.47ms    | -2.470ms   | -35.5% | .029 | -40.2..-25.7% |
| 🟢 faster | 1000 labels first same-length scene publication                                   | 4.55ms   | 2.82ms    | -1.730ms   | -38.1% | .029 | -39.0..-31.7% |
| 🟢 faster | 1000 labels last length-changing scene publication                                | 5.26ms   | 3.21ms    | -2.050ms   | -38.9% | .029 | -42.2..-36.5% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication                  | 6.37ms   | 3.85ms    | -2.520ms   | -39.5% | .029 | -44.0..-10.1% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication                      | 18.87ms  | 11.36ms   | -7.510ms   | -39.8% | .029 | -42.2..-36.3% |
| 🟢 faster | 1000 labels first same-length engine publication                                  | 4.05ms   | 2.41ms    | -1.640ms   | -40.4% | .029 | -42.9..-36.5% |
| 🟢 faster | 1000 labels last same-length scene publication                                    | 4.63ms   | 2.75ms    | -1.880ms   | -40.5% | .029 | -41.9..-39.3% |
| 🟢 faster | 1000 labels last length-changing engine publication                               | 4.82ms   | 2.79ms    | -2.030ms   | -42.1% | .029 | -44.5..-40.3% |
| 🟢 faster | 1000 labels last same-length engine publication                                   | 4.21ms   | 2.43ms    | -1.780ms   | -42.3% | .029 | -50.8..-39.4% |
| 🟢 faster | reflow after width change                                                         | 1.24ms   | 694.75µs  | -0.545ms   | -43.8% | .029 | -51.8..-39.3% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans      | 8.30ms   | 4.61ms    | -3.690ms   | -44.5% | .029 | -64.5..-31.8% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 41.44ms  | 22.87ms   | -18.570ms  | -44.8% | .029 | -47.6..-44.1% |
| 🟢 faster | 1000 labels first length-changing scene publication                               | 7.19ms   | 3.76ms    | -3.430ms   | -47.7% | .029 | -49.3..-43.2% |
| 🟢 faster | 1000 labels first length-changing engine publication                              | 6.65ms   | 3.40ms    | -3.250ms   | -48.9% | .029 | -49.4..-47.6% |
| 🟢 faster | publication after width change                                                    | 2.50ms   | 1.14ms    | -1.360ms   | -54.3% | .029 | -63.8..-51.2% |
| 🟢 faster | 1000 labels last color-only scene publication                                     | 3.65ms   | 1.41ms    | -2.240ms   | -61.3% | .029 | -65.3..-56.8% |
| 🟢 faster | 1000 labels first color-only scene publication                                    | 3.66ms   | 1.39ms    | -2.270ms   | -61.9% | .029 | -64.1..-52.3% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication                           | 215.82ms | 70.37ms   | -145.450ms | -67.4% | .029 | -69.2..-62.5% |
| 🟢 faster | 1000 labels first color-only engine publication                                   | 2.94ms   | 914.88µs  | -2.025ms   | -68.8% | .029 | -72.1..-65.5% |
| 🟢 faster | 1000 labels last color-only engine publication                                    | 2.99ms   | 916.73µs  | -2.073ms   | -69.4% | .029 | -73.2..-65.7% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication                     | 152.67ms | 29.95ms   | -122.720ms | -80.4% | .029 | -81.4..-79.1% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans          | 201.48ms | 24.44ms   | -177.040ms | -87.9% | .029 | -88.2..-87.5% |

<details><summary>18 neutral, 3 skipped</summary>

| status                                                | bench                                                                | baseline | candidate | Δ time      | Δ p50 | p     | 95% CI        |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------- | --------- | ----------- | ----- | ----- | ------------- |
| neutral                                               | normalize 1000 equivalent retained label updates                     | 3.70ms   | 3.61ms    | -0.090ms    | -2.3% | .886  | -22.0..+18.4% |
| neutral                                               | 10 labels first length-changing scene publication                    | 1.03ms   | 1.02ms    | -0.010ms    | -0.9% | .686  | -22.7..+12.9% |
| neutral                                               | 10 labels first color-only scene publication                         | 620.71µs | 601.21µs  | -0.019ms    | -3.1% | .686  | -15.6..+36.4% |
| neutral                                               | 10 labels last color-only scene publication                          | 592.17µs | 591.75µs  | -0.000420ms | -0.1% | 1.000 | -7.2..+27.2%  |
| neutral                                               | 10 labels last length-changing engine publication                    | 979.65µs | 984.10µs  | +0.004ms    | +0.5% | .686  | -4.1..+7.9%   |
| neutral                                               | 10 labels last color-only engine publication                         | 569.44µs | 523.13µs  | -0.046ms    | -8.1% | .114  | -21.6..+2.2%  |
| neutral                                               | 100 labels no-op scene traversal                                     | 129.79µs | 127.50µs  | -0.002ms    | -1.8% | 1.000 | -8.4..+16.3%  |
| neutral                                               | 100 labels first same-length scene publication                       | 1.04ms   | 1.02ms    | -0.020ms    | -2.1% | .200  | -11.1..+3.1%  |
| neutral                                               | 100 labels first same-length engine publication                      | 963.19µs | 922.81µs  | -0.040ms    | -4.2% | .343  | -8.2..+4.8%   |
| neutral                                               | 100 labels last same-length scene publication                        | 1.05ms   | 996.79µs  | -0.053ms    | -4.8% | .686  | -10.3..+19.8% |
| neutral                                               | 100 labels last same-length engine publication                       | 940.50µs | 935.63µs  | -0.005ms    | -0.5% | 1.000 | -4.3..+8.5%   |
| neutral                                               | 100 labels separated unbalanced grow-shrink-space engine publication | 1.48ms   | 1.41ms    | -0.070ms    | -4.7% | .057  | -8.1..+1.5%   |
| neutral                                               | 100 labels separated unbalanced grow-shrink-space scene publication  | 1.54ms   | 1.44ms    | -0.100ms    | -6.2% | .343  | -11.1..+41.4% |
| neutral                                               | relayout after font-size change                                      | 2.99ms   | 3.05ms    | +0.060ms    | +2.0% | .486  | -2.8..+6.3%   |
| neutral                                               | reuse 1000 unchanged Vue property snapshots                          | 304.25µs | 299.54µs  | -0.005ms    | -1.5% | 1.000 | -12.8..+9.5%  |
| neutral                                               | publication after font-size change                                   | 9.52ms   | 10.17ms   | +0.650ms    | +6.7% | .114  | -0.5..+9.3%   |
| neutral                                               | toggle one group containing 1000 retained labels                     | 795.25µs | 756.31µs  | -0.039ms    | -4.9% | .686  | -15.3..+6.2%  |
| neutral                                               | move 1000 retained TypeGPU labels                                    | 400.02µs | 407.02µs  | +0.007ms    | +1.8% | .686  | -9.2..+4.9%   |
| skipped: clock-confounded: neutral→faster · 2.94→2.84 | edit and measure one of 100 retained labels                          |          |           |             |       |       |               |
| skipped: clock-confounded: slower→neutral · 2.95→2.89 | 10 labels first length-changing engine publication                   |          |           |             |       |       |               |
| skipped: timing-mode mismatch                         | 10 labels no-op scene traversal                                      |          |           |             |       |       |               |

</details>
