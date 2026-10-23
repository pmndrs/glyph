## Package performance: `publication` suite

64 faster · 9 slower · 12 neutral · 2 skipped

Baseline `0.1.0-canary-4e25a96a-20261015` → candidate `0.1.0 (4afe2f36)`

> ⚠ baseline CPU clock drifted 12.2% during its run
> ⚠ candidate CPU clock drifted 12.4% during its run

Latency distribution across 85 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  6.120ms |   4.060ms |
| Workloads ≤1 ms     |        5 |         5 |
| Workloads ≤2 ms     |       25 |        29 |
| Workloads ≤3 ms     |       35 |        40 |
| Workloads >3 ms     |       50 |        45 |

Largest candidate workloads (including neutral results):

| workload                                                      | baseline | candidate |     Δ time |
| ------------------------------------------------------------- | -------: | --------: | ---------: |
| 1000 labels 100 edits interleaved edit-read publication       | 369.69ms |  126.94ms | -242.750ms |
| mutate one trailing span across 1000 formatted labels         | 110.79ms |  115.08ms |   +4.290ms |
| 1000 labels 100 edits immediate measurements with publication | 269.39ms |   55.74ms | -213.650ms |
| publish 1024 retained Text instances                          |  39.62ms |   52.06ms |  +12.440ms |
| 100 labels interleaved edit-read publication                  |  65.33ms |   42.88ms |  -22.450ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- rewrite 512 labels in one group                                              ┊         ●┤       +34.0%  <.001  ▅█▄▂▁▁▁▁▁▁ ▁▁▁▁▄█▅▄▄▂
- rewrite 128 labels in one group                                              ┊       ├─●─┤      +33.2%  <.001  ▃█▅▄▄▂▁▁▁▁ ▁▁▂█▆▆▅▃▂▂
- publish 1024 retained Text instances                                         ┊       ├●┤        +31.4%  <.001  ▄█▃▁▁▁▁▁▁▁ ▁▁▁▁█▃▁▆▅▁
- rewrite 64 labels in one group                                               ┊     ├─●─┤        +25.9%  <.001  ▄█▆▆▃▃▁▁▁▁ ▁▁█▄▃▃▅▄▂▂
- rewrite 256 labels in one group                                              ┊      ├●┤         +25.2%  <.001  ▃█▄▂▁▁▁▁▁▁ ▁▁▄█▆▄▁▂▁▂
- move 1000 retained TypeGPU labels                                            ┊  ├─●──┤          +18.0%   .001  ▃█▇▆▆▂▃▁▁▁ ▁▁▂▄█▇▆▂▂▁
- publication after font-size change                                           ┊    ●┤            +17.9%  <.001  ▆█▄▂▁▁▁▁▁▁ ▁▁▁▁▃▆█▅▂▂
- toggle one group containing 1000 retained labels                             ┊   ├●─┤           +16.1%  <.001  ▂▇█▆▃▂▁▁▁▁ ▁▁▁▃▆█▄▂▁▁
- relayout after font-size change                                              ┊├─●┤              +10.8%   .005  █▇▅▆▄▂▁▁▁▁ ▁█▆▅▇▃▃▂▁▁
+ 10 labels first length-changing engine publication                        ├─●┊                   -4.3%   .007  ▁▁▂▅█▆▄▃▃▂ ▂▄██▆▅▆▃▂▁
+ 10 labels first length-changing scene publication                         ├─●┊                   -4.6%   .003  ▁▁▃█▆▅▅▄▄▂ ▁▂█▅▄▄▃▁▁▁
+ reorder 1000 unchanged retained labels                                    ├●┤┊                   -5.2%  <.001  ▁█▃▂▁▁▁▁▁▁ ▆█▄▁▁▁▁▁▁▁
+ 10 labels last length-changing engine publication                         ├●┤┊                   -6.2%   .003  ▁▁▃██▆▄▃▂▂ ▂█▅▆▅▅▄▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication              ├●─┤                   -6.7%   .038  ▁▁▃█▇▄▂▃▂▁ ▂█▇▆▄▅▆▂▂▁
+ 10 labels last length-changing scene publication                         ├●┤ ┊                   -9.5%  <.001  ▁▁▄██▅▅▃▂▂ ▃▆█▄▃▅▂▁▁▁
+ 10 labels no-op scene traversal                                          ├●─┤┊                  -10.0%   .010  ▂▃▃▅▇█▆▄▃▂ ▂▃▃█▆▆▃▂▁▁
+ 10 labels last color-only engine publication                            ├─●┤ ┊                  -10.1%  <.001  ▁▁▆█▃▂▃▅▄▁ ▃▆█▃▃▅▂▁▁▁
+ 100 labels last length-changing engine publication                      ├─●┤ ┊                  -10.8%  <.001  ▁▁▃█▅▄▃▅▃▁ ▄█▇▆▅▂▁▁▁▁
+ 10 labels first color-only engine publication                            ├●┤ ┊                  -10.9%  <.001  ▁▁▄█▃▂▂▅▄▂ ▂▆█▅▂▅▄▁▁▁
+ 10 labels first color-only scene publication                            ├●┤  ┊                  -12.3%   .001  ▁▁▄█▆▃▄▄▄▃ ▂▇█▆▄▄▄▁▁▁
+ normalize 1000 equivalent formatted flow updates                         ●┤  ┊                  -12.3%  <.001  ▁▁▁▂█▅▃▂▂▁ ▂▅█▆▄▂▁▁▁▁
+ 100 labels first same-length engine publication                         ├●┤  ┊                  -12.9%  <.001  ▁▁▅█▃▃▃▄▃▁ ▃█▄▃▃▂▁▁▁▁
+ 100 labels last same-length scene publication                           ├●─┤ ┊                  -12.9%  <.001  ▁▁▅█▇▅▃▃▄▂ ▂█▆▅▅▃▂▁▁▁
+ 100 labels batched edit-read publication                                ├●┤  ┊                  -13.1%  <.001  ▁▁▂█▆▅▅▃▃▁ ▂█▇▄▄▄▁▁▁▁
+ 100 labels first same-length scene publication                         ├─●┤  ┊                  -13.4%  <.001  ▁▁▄█▅▄▄▄▃▁ ▃█▆▅▃▂▂▁▁▁
+ 100 labels last same-length engine publication                         ├─●┤  ┊                  -13.5%  <.001  ▁▁█▅▄▄▃▃▄▂ ▃█▅▄▄▂▁▁▁▁
+ 10 labels last color-only scene publication                            ├─●┤  ┊                  -13.9%  <.001  ▁▂▆█▅▅▅▄▆▃ ▂██▃▃▄▃▁▁▁
+ normalize 1000 equivalent retained label updates                        ├●┤  ┊                  -14.3%  <.001  ▁▁█▅▇▅▂▂▁▁ ▃▇█▄▄▂▁▁▁▁
+ 100 labels no-op scene traversal                                       ├●──┤ ┊                  -15.3%   .002  ▁▃█▄▂▄▄▃▂▁ ▃█▄▂▃▂▃▁▁▁
+ 100 labels last length-changing scene publication                      ├●┤   ┊                  -16.8%  <.001  ▁▁▁▅█▄▅▅▄▂ ▂▅█▅▅▂▂▁▁▁
+ 100 labels first length-changing scene publication                    ├●┤    ┊                  -21.0%  <.001  ▁▁▁▅█▅▄▄▃▁ ▆█▅▅▃▂▁▁▁▁
+ 100 labels first length-changing engine publication                  ├─●     ┊                  -21.2%  <.001  ▁▁▃█▄▅▂▂▁▁ ▄█▆▃▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates          ├●┤    ┊                  -21.3%  <.001  ▁▁▁▁▄█▅▄▄▃ ▂▇█▅▂▁▁▁▁▁
+ reflow after width change                                             ├●┤    ┊                  -21.5%  <.001  ▁▁▁█▇▄▃▄▃▁ ▂█▄▃▃▄▂▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans          ●┤     ┊                  -22.7%  <.001  ▁▁▁▁▁▂▇█▆▃ ▂█▆▂▁▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                   ●┤     ┊                  -23.0%  <.001  ▁▁▁▁▁▂█▆▅▂ ▂▆█▅▁▁▁▁▁▁
+ 100 labels last color-only scene publication                         ├●┤     ┊                  -23.2%  <.001  ▁▁▁█▃▂▃▃▂▂ ▂█▄▄▁▁▁▁▁▁
+ 100 labels last color-only engine publication                       ├─●┤     ┊                  -24.8%  <.001  ▁▁▁██▃▄▃▃▃ ▂█▄▄▂▁▁▁▁▁
+ 100 labels first color-only scene publication                        ●┤      ┊                  -25.2%  <.001  ▁▁▁▇█▄▃▄▄▂ ▂█▇▆▃▁▁▁▁▁
+ 100 labels first color-only engine publication                      ├●┤      ┊                  -25.3%  <.001  ▁▁▁█▅▃▄▃▃▂ ▃█▃▄▁▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication        ├●┤      ┊                  -25.9%  <.001  ▁▁▁▁▃█▃▄▂▁ ▂██▃▂▂▂▁▁▁
+ edit and measure one of 100 retained labels                         ├●┤      ┊                  -26.1%  <.001  ▁▁▁▁▇█▃▆▄▂ ▁█▃▃▄▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans        ├●       ┊                  -27.7%  <.001  ▁▁▁▁▁▂█▅▃▁ ▇█▂▂▁▁▁▁▁▁
+ measurement then publication after width change                     ●┤       ┊                  -28.5%  <.001  ▁▁▁▁▃▆█▅▄▁ ▃█▅▄▂▁▁▁▁▁
+ inspection then publication after width change                     ├●─────┤  ┊                  -28.7%   .007  ▁█▃▂▃█▇▃▂▁ ▆▆█▄▄▂▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans        ●┤       ┊                  -29.1%  <.001  ▁▁▁▁▃█▄▃▂▂ ▂█▂▂▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication        ●┤       ┊                  -29.3%  <.001  ▁▁▁▁▁▁▇█▆▂ ▄▇█▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans       ├●┤       ┊                  -29.3%  <.001  ▁▁▁▁▂█▃▂▂▂ ▂█▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication        ●┤       ┊                  -29.9%  <.001  ▁▁▁▁▁▁▆█▄▂ ▄█▇▂▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication        ├●        ┊                  -29.9%  <.001  ▁▁▁▁▁▄█▄▂▁ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication        ●┤        ┊                  -32.0%  <.001  ▁▁▁▁▁▁▅█▅▂ ▄█▄▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans       ●┤        ┊                  -32.5%  <.001  ▁▁▁▁▁▁█▆▄▂ ▃█▄▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                      ├●         ┊                  -34.4%  <.001  ▁▁▁▁▁▁▂█▂▁ ▃█▂▁▁▁▁▁▁▁
+ split move and merge paint boundaries publication                 ●┤         ┊                  -36.3%  <.001  ▁▁▁▁▁▁▅▄█▂ ▆█▃▁▁▁▁▁▁▁
+ publication after width change                                    ●┤         ┊                  -36.4%  <.001  ▁▁▁▁▂█▆▅▄▂ █▅▄▃▃▂▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication      ●          ┊                  -36.7%  <.001  ▁▁▁▁▁▁█▆▄▂ ▄█▂▃▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication    ├●           ┊                  -41.1%  <.001  ▁▁▁▁▁▂█▅▄▂ ▄█▆▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                 ├●           ┊                  -41.4%  <.001  ▁▁▁▁▁▄█▄▁▁ ▄█▁▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                  ├●           ┊                  -41.4%  <.001  ▁▁▁▁▁▄█▃▂▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication              ├●           ┊                  -41.6%  <.001  ▁▁▁▁▁▁██▃▂ ▄█▁▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication                ├─●           ┊                  -41.6%  <.001  ▁▁▁▁▁▁▇█▄▂ ▃█▁▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication                ●┤           ┊                  -41.8%  <.001  ▁▁▁▁▁▁▃█▃▁ ▂█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ●┤           ┊                  -42.0%  <.001  ▁▁▁▁▁▁▃█▃▁ ▄█▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans   ├●            ┊                  -44.5%  <.001  ▁▁▁▁▁▁▂█▅▂ █▅▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication            ●┤            ┊                  -45.9%  <.001  ▁▁▁▁▁▁▂█▅▂ ▇█▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ├●             ┊                  -47.8%  <.001  ▁▁▁▁▁▁▄█▂▁ ▇█▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -58.5%  <.001  ▁▁▁▁▁▁▄█▄▂ ██▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -60.0%  <.001  ▁▁▁▁▁▁██▃▂ █▇▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -65.7%  <.001  ▁▁▁▁▁▁▁█▆▂ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -69.2%  <.001  ▁▁▁▁▁▁▁█▆▂ ▃█▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -69.5%  <.001  ▁▁▁▁▁▁▁██▂ █▆▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -79.3%  <.001  ▁▁▁▁▁▁▁█▄▁ █▁▁▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -82.8%  <.001  ▁▁▁▁▁▁▁▁█▄ █▁▁▁▁▁▁▁▁▁
  mutate one trailing span across 1000 formatted labels                        ┊●┤                 +3.9%  <.001  ▃██▇▇▂▂▂▁▁ ▁▁▅█▆▅▅▄▂▂
  10 labels first same-length engine publication                               ├●┤                 +3.2%   .130  ▂▆█▇█▄▄▃▃▃ ▁▂▃█▇▆▄▆▃▁
  publish after color change                                                   ●┤                  +1.6%   .028  ▃█▃▄▃▂▁▁▁▁ ▁█▄▂▄▃▂▁▁▁
  10 labels first same-length scene publication                               ├●┤                  -0.2%   .959  ▂█▆▆▄▂▂▄▂▁ ▂██▅▄▄▃▁▁▁
  10 labels last same-length engine publication                              ├─●┤                  -0.7%   .798  ▂▆█▆▄▄▅▂▂▁ ▃▇█▅▆▅▅▂▁▁
  publish after text change                                                   ●┤                   -1.8%   .105  ▁▄█▅▃▄▃▂▂▁ ▃█▇▆▃▅▃▂▁▁
  reuse 1000 unchanged Vue property snapshots                                 ●┤                   -1.9%   .234  ▃█▃▂▁▁▁▁▂▁ ▃█▃▁▁▁▁▁▁▁
  publication after text change                                               ●┤                   -2.5%   .001  ▁▁▆█▄▂▂▁▁▁ ▂█▆▅▄▂▂▂▁▁
  100 labels separated unbalanced g…k-space engine publication               ├●┼┤                  -3.0%   .328  ▁▂▇█▆▄▄▂▂▁ ▃██▅▂▆▇▄▂▁
  10 labels last same-length scene publication                               ├●┤                   -3.6%   .038  ▁▁▆█▅▃▂▄▂▂ ▂▅█▇▅▅▄▂▁▁
  100 labels separated balanced gro…k-space engine publication               ├●┤                   -4.5%   .105  ▁▁▄▇█▅▃▃▃▁ ▂▆█▄▃▅▇▄▂▁
  100 labels separated balanced gro…nk-space scene publication               ├●┤                   -4.9%   .050  ▁▁▄█▅▄▃▂▂▂ ▃█▇▅▄▆▄▂▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status    | bench                                                                             | baseline | candidate | Δ time     | Δ p50  | p     | 95% CI        |
| --------- | --------------------------------------------------------------------------------- | -------- | --------- | ---------- | ------ | ----- | ------------- |
| 🔴 slower | rewrite 512 labels in one group                                                   | 20.31ms  | 27.20ms   | +6.890ms   | +34.0% | <.001 | +32.2..+36.8% |
| 🔴 slower | rewrite 128 labels in one group                                                   | 6.70ms   | 8.93ms    | +2.230ms   | +33.2% | <.001 | +26.4..+38.5% |
| 🔴 slower | publish 1024 retained Text instances                                              | 39.62ms  | 52.06ms   | +12.440ms  | +31.4% | <.001 | +28.0..+34.4% |
| 🔴 slower | rewrite 64 labels in one group                                                    | 4.58ms   | 5.76ms    | +1.180ms   | +25.9% | <.001 | +20.6..+32.4% |
| 🔴 slower | rewrite 256 labels in one group                                                   | 11.07ms  | 13.86ms   | +2.790ms   | +25.2% | <.001 | +22.5..+28.9% |
| 🔴 slower | move 1000 retained TypeGPU labels                                                 | 716.40µs | 845.32µs  | +0.129ms   | +18.0% | .001  | +8.7..+25.1%  |
| 🔴 slower | publication after font-size change                                                | 14.41ms  | 16.99ms   | +2.580ms   | +17.9% | <.001 | +16.7..+18.6% |
| 🔴 slower | toggle one group containing 1000 retained labels                                  | 1.60ms   | 1.86ms    | +0.260ms   | +16.1% | <.001 | +13.8..+22.1% |
| 🔴 slower | relayout after font-size change                                                   | 5.24ms   | 5.80ms    | +0.560ms   | +10.8% | .005  | +2.6..+14.2%  |
| 🟢 faster | 10 labels first length-changing engine publication                                | 1.87ms   | 1.79ms    | -0.080ms   | -4.3%  | .007  | -9.4..-2.1%   |
| 🟢 faster | 10 labels first length-changing scene publication                                 | 1.92ms   | 1.83ms    | -0.090ms   | -4.6%  | .003  | -10.2..-3.1%  |
| 🟢 faster | reorder 1000 unchanged retained labels                                            | 6.84ms   | 6.49ms    | -0.350ms   | -5.2%  | <.001 | -10.7..-3.3%  |
| 🟢 faster | 10 labels last length-changing engine publication                                 | 1.87ms   | 1.75ms    | -0.120ms   | -6.2%  | .003  | -11.3..-3.2%  |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication               | 2.84ms   | 2.65ms    | -0.190ms   | -6.7%  | .038  | -10.2..-1.0%  |
| 🟢 faster | 10 labels last length-changing scene publication                                  | 1.95ms   | 1.76ms    | -0.190ms   | -9.5%  | <.001 | -12.3..-7.3%  |
| 🟢 faster | 10 labels no-op scene traversal                                                   | 203.05µs | 182.71µs  | -0.020ms   | -10.0% | .010  | -12.9..-2.6%  |
| 🟢 faster | 10 labels last color-only engine publication                                      | 1.19ms   | 1.07ms    | -0.120ms   | -10.1% | <.001 | -16.1..-5.7%  |
| 🟢 faster | 100 labels last length-changing engine publication                                | 2.31ms   | 2.06ms    | -0.250ms   | -10.8% | <.001 | -15.8..-7.9%  |
| 🟢 faster | 10 labels first color-only engine publication                                     | 1.24ms   | 1.11ms    | -0.130ms   | -10.9% | <.001 | -14.6..-8.1%  |
| 🟢 faster | 10 labels first color-only scene publication                                      | 1.38ms   | 1.21ms    | -0.170ms   | -12.3% | .001  | -15.6..-8.5%  |
| 🟢 faster | normalize 1000 equivalent formatted flow updates                                  | 16.62ms  | 14.58ms   | -2.040ms   | -12.3% | <.001 | -13.3..-9.2%  |
| 🟢 faster | 100 labels first same-length engine publication                                   | 1.91ms   | 1.66ms    | -0.250ms   | -12.9% | <.001 | -15.7..-9.5%  |
| 🟢 faster | 100 labels last same-length scene publication                                     | 2.12ms   | 1.85ms    | -0.270ms   | -12.9% | <.001 | -17.3..-7.5%  |
| 🟢 faster | 100 labels batched edit-read publication                                          | 17.74ms  | 15.41ms   | -2.330ms   | -13.1% | <.001 | -16.0..-10.5% |
| 🟢 faster | 100 labels first same-length scene publication                                    | 2.13ms   | 1.84ms    | -0.290ms   | -13.4% | <.001 | -20.0..-9.9%  |
| 🟢 faster | 100 labels last same-length engine publication                                    | 1.94ms   | 1.68ms    | -0.260ms   | -13.5% | <.001 | -18.5..-9.0%  |
| 🟢 faster | 10 labels last color-only scene publication                                       | 1.42ms   | 1.22ms    | -0.200ms   | -13.9% | <.001 | -19.4..-10.5% |
| 🟢 faster | normalize 1000 equivalent retained label updates                                  | 7.89ms   | 6.76ms    | -1.130ms   | -14.3% | <.001 | -17.1..-11.5% |
| 🟢 faster | 100 labels no-op scene traversal                                                  | 354.64µs | 300.35µs  | -0.054ms   | -15.3% | .002  | -19.6..-6.2%  |
| 🟢 faster | 100 labels last length-changing scene publication                                 | 2.65ms   | 2.20ms    | -0.450ms   | -16.8% | <.001 | -21.3..-12.1% |
| 🟢 faster | 100 labels first length-changing scene publication                                | 2.88ms   | 2.28ms    | -0.600ms   | -21.0% | <.001 | -24.2..-17.8% |
| 🟢 faster | 100 labels first length-changing engine publication                               | 2.75ms   | 2.16ms    | -0.590ms   | -21.2% | <.001 | -25.7..-19.0% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates                   | 18.66ms  | 14.69ms   | -3.970ms   | -21.3% | <.001 | -22.9..-18.2% |
| 🟢 faster | reflow after width change                                                         | 2.00ms   | 1.57ms    | -0.430ms   | -21.5% | <.001 | -24.7..-18.0% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans                     | 48.59ms  | 37.54ms   | -11.050ms  | -22.7% | <.001 | -24.3..-20.8% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication                               | 26.82ms  | 20.65ms   | -6.170ms   | -23.0% | <.001 | -24.1..-20.3% |
| 🟢 faster | 100 labels last color-only scene publication                                      | 1.76ms   | 1.35ms    | -0.410ms   | -23.2% | <.001 | -28.1..-20.4% |
| 🟢 faster | 100 labels last color-only engine publication                                     | 1.53ms   | 1.15ms    | -0.380ms   | -24.8% | <.001 | -29.6..-21.5% |
| 🟢 faster | 100 labels first color-only scene publication                                     | 1.82ms   | 1.36ms    | -0.460ms   | -25.2% | <.001 | -27.4..-21.8% |
| 🟢 faster | 100 labels first color-only engine publication                                    | 1.56ms   | 1.16ms    | -0.400ms   | -25.3% | <.001 | -28.6..-22.4% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication                   | 10.80ms  | 8.00ms    | -2.800ms   | -25.9% | <.001 | -29.7..-24.3% |
| 🟢 faster | edit and measure one of 100 retained labels                                       | 681.11µs | 503.66µs  | -0.177ms   | -26.1% | <.001 | -28.8..-22.7% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans                 | 49.19ms  | 35.57ms   | -13.620ms  | -27.7% | <.001 | -28.6..-26.1% |
| 🟢 faster | measurement then publication after width change                                   | 6.12ms   | 4.38ms    | -1.740ms   | -28.5% | <.001 | -31.1..-27.1% |
| 🟢 faster | inspection then publication after width change                                    | 17.25ms  | 12.30ms   | -4.950ms   | -28.7% | .007  | -32.6..-8.8%  |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans                 | 12.21ms  | 8.65ms    | -3.560ms   | -29.1% | <.001 | -30.7..-26.9% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication               | 11.50ms  | 8.13ms    | -3.370ms   | -29.3% | <.001 | -31.3..-27.5% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans      | 12.06ms  | 8.52ms    | -3.540ms   | -29.3% | <.001 | -32.0..-27.1% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication                | 12.45ms  | 8.73ms    | -3.720ms   | -29.9% | <.001 | -31.6..-28.1% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication              | 12.71ms  | 8.90ms    | -3.810ms   | -29.9% | <.001 | -31.9..-29.4% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication             | 11.83ms  | 8.05ms    | -3.780ms   | -32.0% | <.001 | -33.6..-30.1% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans      | 43.27ms  | 29.20ms   | -14.070ms  | -32.5% | <.001 | -34.2..-31.6% |
| 🟢 faster | 100 labels interleaved edit-read publication                                      | 65.33ms  | 42.88ms   | -22.450ms  | -34.4% | <.001 | -35.2..-33.9% |
| 🟢 faster | split move and merge paint boundaries publication                                 | 20.35ms  | 12.97ms   | -7.380ms   | -36.3% | <.001 | -37.4..-34.9% |
| 🟢 faster | publication after width change                                                    | 3.74ms   | 2.38ms    | -1.360ms   | -36.4% | <.001 | -37.9..-33.7% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication                      | 42.27ms  | 26.75ms   | -15.520ms  | -36.7% | <.001 | -37.9..-36.0% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication                  | 14.01ms  | 8.25ms    | -5.760ms   | -41.1% | <.001 | -42.5..-38.6% |
| 🟢 faster | 1000 labels first same-length scene publication                                   | 7.70ms   | 4.51ms    | -3.190ms   | -41.4% | <.001 | -42.8..-39.8% |
| 🟢 faster | 1000 labels last same-length scene publication                                    | 7.67ms   | 4.50ms    | -3.170ms   | -41.4% | <.001 | -44.2..-40.2% |
| 🟢 faster | 1000 labels last length-changing scene publication                                | 8.87ms   | 5.18ms    | -3.690ms   | -41.6% | <.001 | -43.1..-39.9% |
| 🟢 faster | 1000 labels last same-length engine publication                                   | 6.85ms   | 4.00ms    | -2.850ms   | -41.6% | <.001 | -45.4..-40.3% |
| 🟢 faster | 1000 labels first same-length engine publication                                  | 6.98ms   | 4.06ms    | -2.920ms   | -41.8% | <.001 | -44.3..-40.9% |
| 🟢 faster | 1000 labels last length-changing engine publication                               | 8.06ms   | 4.68ms    | -3.380ms   | -42.0% | <.001 | -42.9..-40.8% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 66.52ms  | 36.90ms   | -29.620ms  | -44.5% | <.001 | -45.5..-42.7% |
| 🟢 faster | 1000 labels first length-changing scene publication                               | 11.72ms  | 6.34ms    | -5.380ms   | -45.9% | <.001 | -47.3..-44.6% |
| 🟢 faster | 1000 labels first length-changing engine publication                              | 10.98ms  | 5.73ms    | -5.250ms   | -47.8% | <.001 | -49.2..-46.6% |
| 🟢 faster | 1000 labels first color-only scene publication                                    | 6.21ms   | 2.57ms    | -3.640ms   | -58.5% | <.001 | -60.1..-56.7% |
| 🟢 faster | 1000 labels last color-only scene publication                                     | 6.34ms   | 2.54ms    | -3.800ms   | -60.0% | <.001 | -61.3..-58.9% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication                           | 369.69ms | 126.94ms  | -242.750ms | -65.7% | <.001 | -66.4..-64.6% |
| 🟢 faster | 1000 labels first color-only engine publication                                   | 5.41ms   | 1.67ms    | -3.740ms   | -69.2% | <.001 | -70.3..-68.1% |
| 🟢 faster | 1000 labels last color-only engine publication                                    | 5.41ms   | 1.65ms    | -3.760ms   | -69.5% | <.001 | -70.6..-68.8% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication                     | 269.39ms | 55.74ms   | -213.650ms | -79.3% | <.001 | -80.3..-78.0% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans          | 234.84ms | 40.28ms   | -194.560ms | -82.8% | <.001 | -83.1..-82.5% |

<details><summary>12 neutral, 2 skipped</summary>

| status                                                | bench                                                                | baseline | candidate | Δ time   | Δ p50 | p     | 95% CI      |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------- | --------- | -------- | ----- | ----- | ----------- |
| neutral                                               | mutate one trailing span across 1000 formatted labels                | 110.79ms | 115.08ms  | +4.290ms | +3.9% | <.001 | +2.1..+5.0% |
| neutral                                               | 10 labels first same-length scene publication                        | 1.52ms   | 1.52ms    | 0.000ms  | -0.2% | .959  | -3.3..+3.4% |
| neutral                                               | 10 labels first same-length engine publication                       | 1.45ms   | 1.50ms    | +0.050ms | +3.2% | .130  | -1.2..+8.3% |
| neutral                                               | 10 labels last same-length scene publication                         | 1.51ms   | 1.45ms    | -0.060ms | -3.6% | .038  | -7.0..-1.3% |
| neutral                                               | 10 labels last same-length engine publication                        | 1.49ms   | 1.48ms    | -0.010ms | -0.7% | .798  | -6.0..+3.6% |
| neutral                                               | 100 labels separated balanced grow-shrink-space engine publication   | 2.79ms   | 2.66ms    | -0.130ms | -4.5% | .105  | -7.8..+1.1% |
| neutral                                               | 100 labels separated balanced grow-shrink-space scene publication    | 2.92ms   | 2.78ms    | -0.140ms | -4.9% | .050  | -7.7..-0.1% |
| neutral                                               | 100 labels separated unbalanced grow-shrink-space engine publication | 2.65ms   | 2.57ms    | -0.080ms | -3.0% | .328  | -7.7..+4.4% |
| neutral                                               | publish after text change                                            | 5.65ms   | 5.55ms    | -0.100ms | -1.8% | .105  | -4.6..+0.2% |
| neutral                                               | publish after color change                                           | 3.82ms   | 3.88ms    | +0.060ms | +1.6% | .028  | +0.4..+3.6% |
| neutral                                               | reuse 1000 unchanged Vue property snapshots                          | 849.07µs | 832.89µs  | -0.016ms | -1.9% | .234  | -3.9..+1.2% |
| neutral                                               | publication after text change                                        | 16.73ms  | 16.31ms   | -0.420ms | -2.5% | .001  | -3.7..-1.4% |
| skipped: clock-confounded: neutral→faster · 3.15→3.05 | 1000 labels no-op scene traversal                                    |          |           |          |       |       |             |
| skipped: clock-confounded: faster→neutral · 3.04→3.15 | reorder then edit one of 1000 retained labels                        |          |           |          |       |       |             |

</details>
