Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `publication` suite

64 faster · 4 slower · 17 neutral · 2 skipped

Baseline `0.1.0` → candidate `0.1.0 (d6b0f5a0)`

> ⚠ baseline CPU clock drifted 7.4% during its run
> ⚠ candidate CPU clock drifted 8.7% during its run

Latency distribution across 85 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  4.850ms |   2.670ms |
| Workloads ≤1 ms     |       16 |        25 |
| Workloads ≤2 ms     |       33 |        39 |
| Workloads ≤3 ms     |       36 |        47 |
| Workloads >3 ms     |       49 |        38 |

Largest candidate workloads (including neutral results):

| workload                                                                 | baseline | candidate |     Δ time |
| ------------------------------------------------------------------------ | -------: | --------: | ---------: |
| 1000 labels 100 edits interleaved edit-read publication                  | 318.16ms |   70.37ms | -247.790ms |
| mutate one trailing span across 1000 formatted labels                    |  91.15ms |   56.01ms |  -35.140ms |
| 1000 labels 100 edits immediate measurements with publication            | 278.54ms |   29.95ms | -248.590ms |
| publish 1024 retained Text instances                                     |  23.90ms |   29.07ms |   +5.170ms |
| monospaced broad end-to-end setter and publication with 8192 paint spans |  62.78ms |   24.44ms |  -38.340ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- publish 1024 retained Text instances                                         ┊   ├─●─┤          +21.6%   .029  ▄█▆▄▂▁▁▁▁▁ ▁▁▁▁▂█▅▆▅▂
- rewrite 512 labels in one group                                              ┊  ├─●─┤           +16.2%   .029  ▂▅█▅▂▁▁▁▁▁ ▁▁▁▂▇█▄▃▃▂
- 10 labels last length-changing scene publication                             ├─●─────┤           +6.7%   .029  ▁█▇▄▃▂▁▁▁▁ ▁▃█▇▅▃▂▁▁▁
- rewrite 128 labels in one group                                              ┊●──┤               +4.9%   .029  ▂█▄▃▂▁▁▁▁▁ ▁▆█▅▂▂▂▁▁▁
+ relayout after font-size change                                            ●┤┊                   -5.3%   .029  ▁▂▇██▅▃▃▁▁ ▃▇█▅▃▃▃▁▂▁
+ 100 labels last length-changing engine publication                      ├─●─┤┊                   -9.4%   .029  ▁▂▇█▅▄▃▃▂▁ ▄█▆▅▃▃▂▁▁▁
+ 10 labels first same-length scene publication                           ├─●──┤                   -9.8%   .029  ▁▃██▅▃▃▂▂▁ ▂▇█▅▂▃▂▂▁▁
+ 100 labels last length-changing scene publication                       ├─●┤ ┊                  -10.8%   .029  ▁▃█▆▃▃▂▂▁▁ ▄█▅▃▃▁▁▁▁▁
+ publish after text change                                               ├●   ┊                  -13.9%   .029  ▁▁▁▂██▅▃▃▁ ▂▇█▃▃▂▂▁▁▁
+ publication after text change                                           ├●┤  ┊                  -14.3%   .029  ▁▁▁▁█▆▅▅▅▃ ▂▇█▄▂▂▁▁▁▁
+ reorder 1000 unchanged retained labels                               ├───●┤  ┊                  -14.5%   .029  ▁▁▅▇▇█▄▃▁▂ ▃█▇▄▂▁▁▁▁▁
+ 100 labels first length-changing scene publication                     ├●─┤  ┊                  -15.1%   .029  ▁▁▂██▅▄▃▂▂ ▂█▇▅▃▂▁▁▁▁
+ 100 labels first length-changing engine publication                   ├─●─┤  ┊                  -16.7%   .029  ▁▁▁▄█▇▄▃▃▁ ▂██▅▄▃▂▁▁▁
+ publish after color change                                             ├●┤   ┊                  -17.7%   .029  ▁▁▁▄██▄▃▃▂ ▂█▄▃▁▂▂▁▁▁
+ 100 labels first same-length scene publication                        ├●─┤   ┊                  -21.3%   .029  ▁▁▂█▆▃▃▂▂▁ ▃█▄▄▂▁▁▁▁▁
+ 100 labels first same-length engine publication                      ├●─┤    ┊                  -22.4%   .029  ▁▁▁▆█▄▃▃▂▂ ▂█▄▃▃▁▁▁▁▁
+ 100 labels batched edit-read publication                              ●┤     ┊                  -22.5%   .029  ▁▁▁▁▃▄█▆▄▁ ▂▅█▅▁▁▁▁▁▁
+ reorder then edit one of 1000 retained labels                        ├●─┤    ┊                  -22.5%   .029  ▁▁▁▄▅▅█▅▃▃ ▆█▄▃▁▁▁▁▁▁
+ 100 labels last same-length engine publication                        ●┤     ┊                  -22.9%   .029  ▁▁▁▃█▄▃▃▂▂ ▂█▇▄▂▂▁▁▁▁
+ 100 labels last same-length scene publication                        ├●────┤ ┊                  -23.2%   .029  ▁▁▃██▄▃▂▂▁ ▄█▆▃▂▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication        ├●┤      ┊                  -25.1%   .029  ▁▁▁▂██▆▃▂▂ ▄█▅▂▂▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                ├●─┤      ┊                  -30.1%   .029  ▁▁▁▁▁▁▃▇█▄ ▂█▄▂▁▁▁▁▁▁
+ 10 labels first color-only scene publication                      ├─●──────┤ ┊                  -31.2%   .029  ▁▁▅█▃▂▂▁▁▁ ▃█▄▃▂▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication      ├●┤        ┊                  -31.9%   .029  ▁▁▁▁▁▁▄▆█▄ ▃█▄▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication       ├●┤        ┊                  -33.4%   .029  ▁▁▁▁▁▁▂██▃ ▃█▇▂▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ├─●───┤     ┊                  -34.0%   .029  ▁▁▁▁▁▁▆█▅▃ ▃█▄▂▁▂▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication      ├●─┤       ┊                  -34.7%   .029  ▁▁▁▁▁▁▂▇█▄ ▂█▅▁▂▁▁▁▁▁
+ 10 labels first color-only engine publication                   ├─●─┤        ┊                  -35.1%   .029  ▁▁▁██▄▃▃▂▂ ▂█▄▃▂▁▁▁▁▁
+ 10 labels last color-only scene publication                     ├─●──────┤   ┊                  -35.3%   .029  ▁▁▁█▆▃▃▃▁▁ ▃█▄▃▂▂▁▁▁▁
+ mutate one trailing span across 1000 formatted labels            ●┤          ┊                  -38.5%   .029  ▁▁▁▁▁▆█▂▁▁ ▆█▁▁▁▁▁▁▁▁
+ 10 labels last color-only engine publication                   ├─●─┤         ┊                  -38.5%   .029  ▁▁▁██▃▃▃▂▁ ▂█▄▃▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ├─●────────┤  ┊                  -39.7%   .029  ▁▁▁▁▁▄██▅▂ ▄█▄▂▂▂▁▁▂▁
+ split move and merge paint boundaries publication                ●           ┊                  -39.7%   .029  ▁▁▁▁▁▁▂▃█▃ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication             ├─●           ┊                  -41.4%   .029  ▁▁▁▁▁▁▄█▅▂ ▃█▄▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication            ├●┤           ┊                  -42.5%   .029  ▁▁▁▁▁▁▆█▄▃ ▃█▃▁▁▁▁▁▁▁
+ reflow after width change                                      ├●┤           ┊                  -42.9%   .029  ▁▁▁▁▄█▃▃▂▁ ▃█▃▃▂▁▁▁▁▁
+ inspection then publication after width change                ◀●─┤           ┊                  -46.3%   .029  ▁▃█▂▄▂▁▁▁▁ █▃▂▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication               ●┤             ┊                  -48.6%   .029  ▁▁▁▁▁▁▂██▃ ▅█▃▂▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ●─┤            ┊                  -49.3%   .029  ▁▁▁▁▁▁▂██▃ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                ●┤             ┊                  -49.4%   .029  ▁▁▁▁▁▁▂█▆▂ ▄█▃▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication               ●┤             ┊                  -49.6%   .029  ▁▁▁▁▁▁▁█▇▄ ▄█▃▁▁▁▁▁▁▁
+ 100 labels first color-only scene publication                 ●─┤            ┊                  -49.7%   .029  ▁▁▁▂█▅▂▂▂▁ ▆█▃▂▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -50.3%   .029  ▁▁▁▁▁▁▁█▇▂ ██▁▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication              ◀┤             ┊                  -51.6%   .029  ▁▁▁▁▁▃█▅▂▂ ▅█▂▁▁▁▁▁▁▁
+ 100 labels last color-only scene publication                  ◀┤             ┊                  -52.8%   .029  ▁▁▁▂█▃▄▃▁▁ ▅█▃▂▁▁▁▁▁▁
+ 100 labels last color-only engine publication                 ◀┤             ┊                  -53.7%   .029  ▁▁▁▁█▇▃▂▂▁ ▄█▃▂▁▁▁▁▁▁
+ 100 labels first color-only engine publication                ◀              ┊                  -54.1%   .029  ▁▁▁▁▇█▄▃▂▂ ▄█▄▂▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                  ◀┤             ┊                  -55.9%   .029  ▁▁▁▁▁▁▁▇█▂ ▇█▃▂▂▁▁▁▁▁
+ reuse 1000 unchanged Vue property snapshots                   ◀              ┊                  -56.8%   .029  ▁▁█▄▂▂▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ publication after width change                                ◀              ┊                  -57.3%   .029  ▁▂▄▃█▆█▅▄▃ ██▂▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -61.1%   .029  ▁▁▁▁▁▁▁█▃▁ █▁▁▁▁▁▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans  ◀              ┊                  -63.0%   .029  ▁▁▁▁▁▁▇█▁▁ █▁▁▁▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -66.1%   .029  ▁▁▁▁▁▁▁█▇▂ █▁▁▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ◀              ┊                  -67.2%   .029  ▁▁▁▁▁▁▁██▂ █▇▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans  ◀              ┊                  -69.4%   .029  ▁▁▁▁▁▁▁▇█▂ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans  ◀              ┊                  -70.4%   .029  ▁▁▁▁▁▁▁▁█▃ █▂▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -74.2%   .029  ▁▁▁▁▁▁▃█▅▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -74.7%   .029  ▁▁▁▁▁▁▂█▅▁ █▆▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -77.9%   .029  ▁▁▁▁▁▁▁▁█▅ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -81.5%   .029  ▁▁▁▁▁▁▂█▄▁ █▃▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -81.6%   .029  ▁▁▁▁▁▁▁█▇▂ █▄▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent formatted flow updates              ◀              ┊                  -86.0%   .029  ▁▁▁▁▁▁█▂▂▁ █▁▁▁▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates  ◀              ┊                  -86.0%   .029  ▁▁▁▁▁▁█▄▃▁ █▁▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -89.2%   .029  ▁▁▁▁▁▁▁█▄▂ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans  ◀              ┊                  -91.6%   .029  ▁▁▁▁▁▁▁▂█▂ █▁▁▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -91.7%   .029  ▁▁▁▁▁▁▁▃█▂ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent retained label updates              ◀              ┊                  -92.2%   .029  ▁▁▁▁▁▁▁▆█▃ █▁▁▁▁▁▁▁▁▁
+ move 1000 retained TypeGPU labels                             ◀              ┊                  -93.1%   .029  ▁▁▁▁▁▆█▇▂▁ █▁▁▁▁▁▁▁▁▁
  10 labels last length-changing engine publication                            ├─●─┤               +7.2%   .114  ▂▅█▄▂▃▂▂▁▁ ▁▃█▆▅▄▃▂▂▂
  toggle one group containing 1000 retained labels                            ├┼─●─┤               +6.2%   .200  ▃█▄▃▁▁▁▁▁▁ ▁█▇▂▁▁▁▁▁▁
  rewrite 64 labels in one group                                              ├┼─●────┤            +5.7%   .686  ▂█▃▁▁▁▁▁▁▁ ▃█▄▃▂▁▁▁▁▁
  rewrite 256 labels in one group                                             ├┼●──┤               +4.3%   .200  ▂▆▇█▃▅▃▁▁▁ ▁▁███▅▃▂▂▂
  1000 labels no-op scene traversal                                           ├┼●──────────┤       +2.1%   .486  ▂█▃▁▁▁▁▁▁▁ ▁█▄▂▂▁▁▁▁▁
  10 labels first length-changing scene publication                           ├●────┤              +1.6%   .200  ▃█▅▄▃▁▁▁▁▁ ▂█▇▄▃▂▁▁▁▁
  publication after font-size change                                          ├●┤                  +0.3%   .686  ▄█▄▂▁▁▁▁▁▁ ▁█▄▁▁▁▁▁▁▁
  100 labels no-op scene traversal                                          ├──●────┤              -0.6%   .886  ▁█▆▃▂▂▂▂▁▁ ▂█▇▃▂▂▂▂▁▁
  10 labels last same-length engine publication                             ├─●┤                   -3.7%   .200  ▁▃█▇▅▃▃▂▂▁ ▃██▆▅▃▄▃▂▂
  100 labels separated unbalanced g…k-space engine publication               ├●┤                   -3.8%   .029  ▁▁▆█▇▃▃▃▂▁ ▂▆█▅▅▄▂▃▂▁
  100 labels separated balanced gro…k-space engine publication               ├●┤                   -4.8%   .057  ▁▄▇██▅▃▃▂▂ ▄▆██▆▃▄▄▃▁
  100 labels separated balanced gro…nk-space scene publication              ├●─┤                   -5.8%   .114  ▁▅█▅▃▂▂▁▁▁ ▃█▅▄▃▂▁▁▁▁
  100 labels separated unbalanced g…nk-space scene publication              ├●─┼─────────────┤     -6.3%   .343  ▂█▄▁▁▁▁▁▁▁ ▃█▃▁▂▁▁▁▁▁
  10 labels first same-length engine publication                           ├─●─┼────┤              -6.5%   .343  ▁▅█▄▃▂▁▁▁▁ ▂█▆▄▂▂▁▁▁▁
  edit and measure one of 100 retained labels                           ├────●─┼──┤                -7.9%   .886  ▁█▆▂▁▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
  measurement then publication after width change                      ├────●──┼──┤                -8.5%   .343  ▁▁▁▆█▆▇▆▃▁ ▂▂▃█▅▆▄▂▁▁
  10 labels last same-length scene publication                           ├──●──┼──┤                -9.7%   .200  ▁▃█▄▂▃▂▁▁▁ ▁█▆▃▃▁▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status    | bench                                                                             | baseline | candidate | Δ time     | Δ p50  | p    | 95% CI        |
| --------- | --------------------------------------------------------------------------------- | -------- | --------- | ---------- | ------ | ---- | ------------- |
| 🔴 slower | publish 1024 retained Text instances                                              | 23.90ms  | 29.07ms   | +5.170ms   | +21.6% | .029 | +14.4..+25.6% |
| 🔴 slower | rewrite 512 labels in one group                                                   | 12.66ms  | 14.70ms   | +2.040ms   | +16.2% | .029 | +8.4..+24.1%  |
| 🔴 slower | 10 labels last length-changing scene publication                                  | 974.06µs | 1.04ms    | +0.066ms   | +6.7%  | .029 | +0.5..+25.7%  |
| 🔴 slower | rewrite 128 labels in one group                                                   | 3.92ms   | 4.11ms    | +0.190ms   | +4.9%  | .029 | +3.1..+12.4%  |
| 🟢 faster | relayout after font-size change                                                   | 3.22ms   | 3.05ms    | -0.170ms   | -5.3%  | .029 | -7.7..-2.7%   |
| 🟢 faster | 100 labels last length-changing engine publication                                | 1.24ms   | 1.13ms    | -0.110ms   | -9.4%  | .029 | -17.7..-3.2%  |
| 🟢 faster | 10 labels first same-length scene publication                                     | 916.19µs | 826.35µs  | -0.090ms   | -9.8%  | .029 | -15.8..-1.2%  |
| 🟢 faster | 100 labels last length-changing scene publication                                 | 1.35ms   | 1.21ms    | -0.140ms   | -10.8% | .029 | -16.7..-6.2%  |
| 🟢 faster | publish after text change                                                         | 3.46ms   | 2.98ms    | -0.480ms   | -13.9% | .029 | -16.6..-12.0% |
| 🟢 faster | publication after text change                                                     | 10.78ms  | 9.24ms    | -1.540ms   | -14.3% | .029 | -17.9..-10.2% |
| 🟢 faster | reorder 1000 unchanged retained labels                                            | 4.42ms   | 3.78ms    | -0.640ms   | -14.5% | .029 | -25.1..-10.2% |
| 🟢 faster | 100 labels first length-changing scene publication                                | 1.51ms   | 1.28ms    | -0.230ms   | -15.1% | .029 | -21.2..-10.7% |
| 🟢 faster | 100 labels first length-changing engine publication                               | 1.45ms   | 1.21ms    | -0.240ms   | -16.7% | .029 | -22.5..-10.1% |
| 🟢 faster | publish after color change                                                        | 2.59ms   | 2.13ms    | -0.460ms   | -17.7% | .029 | -19.8..-15.0% |
| 🟢 faster | 100 labels first same-length scene publication                                    | 1.30ms   | 1.02ms    | -0.280ms   | -21.3% | .029 | -24.6..-12.3% |
| 🟢 faster | 100 labels first same-length engine publication                                   | 1.19ms   | 922.81µs  | -0.267ms   | -22.4% | .029 | -27.0..-17.1% |
| 🟢 faster | 100 labels batched edit-read publication                                          | 10.03ms  | 7.78ms    | -2.250ms   | -22.5% | .029 | -24.9..-19.7% |
| 🟢 faster | reorder then edit one of 1000 retained labels                                     | 10.79ms  | 8.36ms    | -2.430ms   | -22.5% | .029 | -26.7..-17.9% |
| 🟢 faster | 100 labels last same-length engine publication                                    | 1.21ms   | 935.63µs  | -0.274ms   | -22.9% | .029 | -24.9..-19.4% |
| 🟢 faster | 100 labels last same-length scene publication                                     | 1.30ms   | 996.79µs  | -0.303ms   | -23.2% | .029 | -27.7..-6.2%  |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication                   | 4.91ms   | 3.68ms    | -1.230ms   | -25.1% | .029 | -29.0..-23.6% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication                               | 15.52ms  | 10.85ms   | -4.670ms   | -30.1% | .029 | -32.1..-22.7% |
| 🟢 faster | 10 labels first color-only scene publication                                      | 874.27µs | 601.21µs  | -0.273ms   | -31.2% | .029 | -38.2..-5.7%  |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication                | 7.33ms   | 4.99ms    | -2.340ms   | -31.9% | .029 | -35.5..-30.8% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication             | 6.91ms   | 4.60ms    | -2.310ms   | -33.4% | .029 | -36.4..-28.4% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication              | 7.62ms   | 5.02ms    | -2.600ms   | -34.0% | .029 | -38.8..-20.8% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication               | 6.85ms   | 4.47ms    | -2.380ms   | -34.7% | .029 | -35.8..-25.8% |
| 🟢 faster | 10 labels first color-only engine publication                                     | 851.67µs | 552.35µs  | -0.299ms   | -35.1% | .029 | -43.5..-31.4% |
| 🟢 faster | 10 labels last color-only scene publication                                       | 915.08µs | 591.75µs  | -0.323ms   | -35.3% | .029 | -43.2..-14.4% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels                             | 91.15ms  | 56.01ms   | -35.140ms  | -38.5% | .029 | -40.6..-37.3% |
| 🟢 faster | 10 labels last color-only engine publication                                      | 850.56µs | 523.13µs  | -0.327ms   | -38.5% | .029 | -46.1..-33.2% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication                  | 6.39ms   | 3.85ms    | -2.540ms   | -39.7% | .029 | -45.4..-8.5%  |
| 🟢 faster | split move and merge paint boundaries publication                                 | 14.26ms  | 8.60ms    | -5.660ms   | -39.7% | .029 | -40.4..-38.9% |
| 🟢 faster | 1000 labels last length-changing scene publication                                | 5.49ms   | 3.21ms    | -2.280ms   | -41.4% | .029 | -45.4..-39.5% |
| 🟢 faster | 1000 labels last length-changing engine publication                               | 4.85ms   | 2.79ms    | -2.060ms   | -42.5% | .029 | -45.4..-40.7% |
| 🟢 faster | reflow after width change                                                         | 1.22ms   | 694.75µs  | -0.525ms   | -42.9% | .029 | -45.8..-39.9% |
| 🟢 faster | inspection then publication after width change                                    | 13.53ms  | 7.26ms    | -6.270ms   | -46.3% | .029 | -65.2..-38.9% |
| 🟢 faster | 1000 labels first same-length scene publication                                   | 5.48ms   | 2.82ms    | -2.660ms   | -48.6% | .029 | -50.7..-45.2% |
| 🟢 faster | 1000 labels first length-changing scene publication                               | 7.41ms   | 3.76ms    | -3.650ms   | -49.3% | .029 | -51.1..-44.8% |
| 🟢 faster | 1000 labels last same-length scene publication                                    | 5.44ms   | 2.75ms    | -2.690ms   | -49.4% | .029 | -50.7..-47.6% |
| 🟢 faster | 1000 labels last same-length engine publication                                   | 4.81ms   | 2.43ms    | -2.380ms   | -49.6% | .029 | -51.4..-47.7% |
| 🟢 faster | 100 labels first color-only scene publication                                     | 1.29ms   | 647.67µs  | -0.642ms   | -49.7% | .029 | -52.1..-44.9% |
| 🟢 faster | 1000 labels first length-changing engine publication                              | 6.84ms   | 3.40ms    | -3.440ms   | -50.3% | .029 | -51.6..-48.5% |
| 🟢 faster | 1000 labels first same-length engine publication                                  | 4.99ms   | 2.41ms    | -2.580ms   | -51.6% | .029 | -58.1..-48.3% |
| 🟢 faster | 100 labels last color-only scene publication                                      | 1.37ms   | 647.92µs  | -0.722ms   | -52.8% | .029 | -59.7..-47.2% |
| 🟢 faster | 100 labels last color-only engine publication                                     | 1.18ms   | 546.40µs  | -0.634ms   | -53.7% | .029 | -57.9..-47.4% |
| 🟢 faster | 100 labels first color-only engine publication                                    | 1.19ms   | 545.08µs  | -0.645ms   | -54.1% | .029 | -57.3..-48.9% |
| 🟢 faster | 100 labels interleaved edit-read publication                                      | 44.28ms  | 19.54ms   | -24.740ms  | -55.9% | .029 | -59.3..-45.7% |
| 🟢 faster | reuse 1000 unchanged Vue property snapshots                                       | 692.79µs | 299.54µs  | -0.393ms   | -56.8% | .029 | -62.3..-50.8% |
| 🟢 faster | publication after width change                                                    | 2.68ms   | 1.14ms    | -1.540ms   | -57.3% | .029 | -64.6..-49.0% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans          | 62.78ms  | 24.44ms   | -38.340ms  | -61.1% | .029 | -61.4..-60.1% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans                     | 65.01ms  | 24.07ms   | -40.940ms  | -63.0% | .029 | -64.0..-61.7% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans                 | 66.09ms  | 22.39ms   | -43.700ms  | -66.1% | .029 | -67.1..-64.7% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication                      | 34.62ms  | 11.36ms   | -23.260ms  | -67.2% | .029 | -69.2..-64.9% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 74.74ms  | 22.87ms   | -51.870ms  | -69.4% | .029 | -70.1..-69.0% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans      | 62.18ms  | 18.40ms   | -43.780ms  | -70.4% | .029 | -71.5..-69.6% |
| 🟢 faster | 1000 labels last color-only scene publication                                     | 5.46ms   | 1.41ms    | -4.050ms   | -74.2% | .029 | -76.7..-70.3% |
| 🟢 faster | 1000 labels first color-only scene publication                                    | 5.51ms   | 1.39ms    | -4.120ms   | -74.7% | .029 | -76.5..-68.5% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication                           | 318.16ms | 70.37ms   | -247.790ms | -77.9% | .029 | -78.5..-77.1% |
| 🟢 faster | 1000 labels first color-only engine publication                                   | 4.94ms   | 914.88µs  | -4.025ms   | -81.5% | .029 | -83.0..-79.4% |
| 🟢 faster | 1000 labels last color-only engine publication                                    | 4.98ms   | 916.73µs  | -4.063ms   | -81.6% | .029 | -82.8..-79.5% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates                                  | 53.59ms  | 7.51ms    | -46.080ms  | -86.0% | .029 | -87.8..-85.7% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates                   | 55.56ms  | 7.80ms    | -47.760ms  | -86.0% | .029 | -87.5..-84.9% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication                     | 278.54ms | 29.95ms   | -248.590ms | -89.2% | .029 | -90.5..-88.5% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans      | 54.89ms  | 4.61ms    | -50.280ms  | -91.6% | .029 | -91.9..-91.2% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans                 | 55.56ms  | 4.60ms    | -50.960ms  | -91.7% | .029 | -92.2..-91.4% |
| 🟢 faster | normalize 1000 equivalent retained label updates                                  | 46.44ms  | 3.61ms    | -42.830ms  | -92.2% | .029 | -93.5..-90.7% |
| 🟢 faster | move 1000 retained TypeGPU labels                                                 | 5.93ms   | 407.02µs  | -5.523ms   | -93.1% | .029 | -94.1..-92.7% |

<details><summary>17 neutral, 2 skipped</summary>

| status                                                | bench                                                                | baseline | candidate | Δ time      | Δ p50 | p    | 95% CI        |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------- | --------- | ----------- | ----- | ---- | ------------- |
| neutral                                               | edit and measure one of 100 retained labels                          | 345.83µs | 318.56µs  | -0.027ms    | -7.9% | .886 | -24.2..+11.2% |
| neutral                                               | rewrite 64 labels in one group                                       | 2.52ms   | 2.67ms    | +0.150ms    | +5.7% | .686 | -3.3..+23.4%  |
| neutral                                               | rewrite 256 labels in one group                                      | 6.98ms   | 7.28ms    | +0.300ms    | +4.3% | .200 | -5.0..+13.7%  |
| neutral                                               | 10 labels first length-changing scene publication                    | 1.00ms   | 1.02ms    | +0.020ms    | +1.6% | .200 | -2.9..+16.3%  |
| neutral                                               | 10 labels first same-length engine publication                       | 840.85µs | 785.85µs  | -0.055ms    | -6.5% | .343 | -13.9..+17.7% |
| neutral                                               | 10 labels last same-length scene publication                         | 910.88µs | 822.46µs  | -0.088ms    | -9.7% | .200 | -19.3..+9.4%  |
| neutral                                               | 10 labels last same-length engine publication                        | 863.42µs | 831.81µs  | -0.032ms    | -3.7% | .200 | -8.6..+1.3%   |
| neutral                                               | 10 labels last length-changing engine publication                    | 917.81µs | 984.10µs  | +0.066ms    | +7.2% | .114 | -1.3..+13.5%  |
| neutral                                               | 100 labels no-op scene traversal                                     | 128.23µs | 127.50µs  | -0.000730ms | -0.6% | .886 | -11.3..+18.0% |
| neutral                                               | 1000 labels no-op scene traversal                                    | 749.15µs | 764.81µs  | +0.016ms    | +2.1% | .486 | -3.6..+39.6%  |
| neutral                                               | 100 labels separated balanced grow-shrink-space engine publication   | 1.48ms   | 1.41ms    | -0.070ms    | -4.8% | .057 | -7.6..+0.1%   |
| neutral                                               | 100 labels separated balanced grow-shrink-space scene publication    | 1.55ms   | 1.46ms    | -0.090ms    | -5.8% | .114 | -9.9..+0.3%   |
| neutral                                               | 100 labels separated unbalanced grow-shrink-space engine publication | 1.46ms   | 1.41ms    | -0.050ms    | -3.8% | .029 | -5.9..-0.1%   |
| neutral                                               | 100 labels separated unbalanced grow-shrink-space scene publication  | 1.54ms   | 1.44ms    | -0.100ms    | -6.3% | .343 | -9.2..+46.1%  |
| neutral                                               | measurement then publication after width change                      | 3.33ms   | 3.05ms    | -0.280ms    | -8.5% | .343 | -27.4..+10.7% |
| neutral                                               | publication after font-size change                                   | 10.13ms  | 10.17ms   | +0.040ms    | +0.3% | .686 | -1.9..+3.6%   |
| neutral                                               | toggle one group containing 1000 retained labels                     | 711.90µs | 756.31µs  | +0.044ms    | +6.2% | .200 | -1.8..+14.5%  |
| skipped: clock-confounded: slower→neutral · 2.96→2.89 | 10 labels first length-changing engine publication                   |          |           |             |       |      |               |
| skipped: timing-mode mismatch                         | 10 labels no-op scene traversal                                      |          |           |             |       |      |               |

</details>
