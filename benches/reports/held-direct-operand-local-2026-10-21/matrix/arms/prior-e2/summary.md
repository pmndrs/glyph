Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

0 faster · 14 slower · 131 neutral · 0 skipped

Baseline `0.1.0 (28fd0413)` → candidate `0.1.0 (83949860)`

Latency distribution across 145 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  0.835ms |   0.847ms |
| Workloads ≤1 ms     |       75 |        75 |
| Workloads ≤2 ms     |       94 |        93 |
| Workloads ≤3 ms     |      111 |       111 |
| Workloads >3 ms     |       34 |        34 |

Largest candidate workloads (including neutral results):

| workload                                                      | baseline | candidate |   Δ time |
| ------------------------------------------------------------- | -------: | --------: | -------: |
| 1000 labels 100 edits interleaved edit-read publication       |  45.40ms |   45.37ms | -0.030ms |
| mutate one trailing span across 1000 formatted labels         |  36.48ms |   37.17ms | +0.690ms |
| publish 1024 retained Text instances                          |  18.37ms |   20.23ms | +1.860ms |
| mount and publish a 22k-glyph paragraph                       |  19.83ms |   20.11ms | +0.280ms |
| 1000 labels 100 edits immediate measurements with publication |  18.17ms |   18.24ms | +0.070ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- publication after font-size change                                           ┊         ●─┤      +13.8%  <.001  ▅▄█▃▂▁▁▁▁▁ ▁▁▁▁▅▄█▅▂▂
- 100 labels first set                                                         ┊        ├●─┤      +13.8%  <.001  ██▂▂▂▂▁▁▁▁ ▁█▆▃▃▂▂▂▁▁
- relayout after font-size change                                              ┊        ●┤        +12.3%  <.001  ▃█▂▁▁▁▁▁▁▁ ▁▁▁█▅▂▂▂▁▁
- broad end-to-end setter and publi…tion with 8192 paint spans                 ┊       ●┤         +10.8%  <.001  ▄▅▂█▄▂▁▁▁▁ ▁▁▁▁▂▆▃█▇▁
- monospaced broad end-to-end sette…tion with 8192 paint spans                 ┊      ├●          +10.4%  <.001  ▂█▄▁▂▁▁▁▁▁ ▁▁▁▁▁▃█▅▂▂
- publish 1024 retained Text instances                                         ┊     ├─●          +10.1%  <.001  ▂█▅▂▂▇▄▁▁▁ ▁▁▁▃█▄▂▃▆▃
- publish after color change                                                   ┊   ├─●┤            +7.4%  <.001  ▃█▃▂▁▁▁▂▁▁ ▁▁█▄▂▁▁▂▁▁
- rewrite 256 labels in one group                                              ┊    ●─┤            +7.3%  <.001  ▂█▅▃▂▂▂▁▁▁ ▁▁▅█▄▃▃▂▂▁
- publication after text change                                                ┊    ●┤             +6.8%  <.001  ▄▅█▄▃▂▁▁▁▁ ▁▁▃▆█▆▃▂▁▁
- cached measurement                                                           ├────●───┤          +6.7%   .021  ▁█▄▁▁▁▁▁▁▁ ▂█▆▁▁▂▂▁▁▁
- rewrite 512 labels in one group                                              ┊   ●─┤             +5.8%  <.001  ▃▅▂▄█▆▃▂▁▁ ▁▁▄▄▃▇█▅▃▂
- publish after text change                                                    ┊   ●┤              +5.6%   .010  ▃█▄▂▂▁▁▁▁▁ ▁▂█▅▂▂▁▁▁▁
- rewrite 64 labels in one group                                               ┊  ├●─┤             +5.5%  <.001  ▃█▅▃▂▁▁▁▁▁ ▁▆█▄▂▂▂▁▂▂
- rewrite 128 labels in one group                                              ┊  ├●┤              +5.5%  <.001  ▂█▅▃▂▂▁▁▁▁ ▁▄█▅▃▂▂▁▁▁
  100 labels first length-changing engine publication                          ┊ ├●──┤             +4.5%  <.001  ▂█▅▃▂▁▂▁▁▁ ▁▇█▅▃▂▂▂▁▁
  100 labels first color-only engine publication                               ├──●───┤            +4.1%   .130  ▂█▄▃▂▁▁▁▁▁ ▂█▆▃▂▁▁▂▁▁
  10 labels last length-changing engine publication                            ┊ ├●────┤           +4.0%  <.001  ▂█▃▂▁▁▁▁▁▁ ▁█▆▃▂▂▁▁▁▁
  split move and merge paint boundaries publication                            ┊ ├●                +3.9%  <.001  ▃█▇▄▄▅▄▂▁▁ ▁▁▃█▇▅▆▅▃▁
  10 labels no-op scene traversal                                              ┊├─●─┤              +3.8%   .006  █▃▆▃▃▁▁▁▁▁ █▃█▃▄▂▂▁▁▁
  100 labels no-op scene traversal                                           ├─┼──●─┤              +3.4%   .505  ▃█▄▃▁▁▁▁▁▁ ▂█▅▃▂▁▁▁▁▁
  issue 216 unsafe-boundary word-wrap reflow                                 ├─┼─●──┤              +3.2%   .195  ▂█▃▂▁▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
  100 labels first same-length scene publication                              ├┼─●──┤              +2.8%   .225  ▁▅█▄▂▂▂▁▁▁ ▁▆█▆▃▂▂▂▂▁
  1000 labels last same-length engine publication                              ├─●                 +2.6%   .050  ▂█▇▅▃▃▁▁▁▁ ▁▇█▅▃▃▂▁▁▁
  10 labels first same-length scene publication                                ├─●──┤              +2.4%   .083  ▂█▆▃▂▁▁▁▁▁ ▁▇█▄▂▂▁▂▁▁
  100 labels last length-changing engine publication                           ┊├●┤                +2.4%   .021  ▂█▇▄▂▂▁▁▁▁ ▂██▅▃▂▂▂▁▁
  100 labels last length-changing scene publication                            ├─●┤                +2.1%   .065  ▁▇█▅▃▁▁▂▂▁ ▁▆█▇▃▂▁▂▂▁
  mutate one trailing span across 1000 formatted labels                        ┊●─┤                +1.9%   .002  ▂▄█▇▇▅▄▃▂▁ ▁▁▃▇▆█▆▄▅▂
  edit and independently copy one label among 100 labels                       ┊●─┤                +1.7%   .003  ▁█▆▃▂▂▁▁▁▁ ▁▆█▃▂▂▂▁▁▁
  toggle one group containing 1000 retained labels                           ├─┼●──┤               +1.7%   .328  ▂█▇▄▂▁▁▁▁▁ ▂▇█▅▃▂▁▁▁▁
  1000 labels first color-only scene publication                               ├●┤                 +1.6%   .105  ▃█▅▃▂▂▁▁▁▁ ▂█▅▃▂▂▂▁▁▁
  type one character into a long paragraph and publish a frame                 ├●┤                 +1.5%   .130  ▂█▇▃▂▁▁▂▂▁ ▁▆█▄▂▂▁▂▂▁
  100 labels last same-length engine publication                               ├●┤                 +1.4%   .130  ▁▇█▄▂▂▁▁▁▁ ▁▅█▄▂▁▁▁▁▁
  mount and publish a 22k-glyph paragraph                                      ┊●                  +1.4%  <.001  ▃█▆▅▂▃▃▃▁▁ ▁▄█▇▅▄▃▂▂▂
  copy per-glyph metrics after text change                                     ├●┤                 +1.4%   .105  ▄▃▂▁▁▁█▂▂▁ ▄▃▁▂▁▁█▃▂▂
  edit and independently copy one label among 1 labels                         ├●────┤             +1.4%   .105  ▃█▅▂▁▁▁▁▁▁ ▂█▅▂▂▂▁▁▁▁
  100 labels first length-changing scene publication                           ├●┤                 +1.3%   .021  ▃█▇▅▃▂▁▂▁▁ ▂▇█▅▄▂▁▂▂▁
  1000 labels first color-only engine publication                             ├┼●─┤                +1.3%   .382  ▂█▄▄▂▂▂▁▁▁ ▁█▅▄▂▂▂▁▁▁
  1000 labels first set+measure+scene-publication                              ├●─┤                +1.3%   .138  ▃█▅▃▄▄▃▂▂▁ ▂█▇▅▅▄▄▃▂▁
  reorder 1000 unchanged retained labels                                       ├●┤                 +1.3%   .195  ▃▇█▄▃▂▃▃▁▁ ▁██▆▄▂▃▃▂▁
  100 labels first same-length engine publication                            ├─┼●┤                 +1.2%   .721  ▂▇█▄▂▁▁▁▁▁ ▂██▅▃▂▁▁▁▁
  100 labels batched edit-read publication                                     ├●┤                 +1.2%   .028  ▃█▇▆▃▂▃▂▂▁ ▁▃█▆▃▃▂▂▂▂
  reflow after width change                                                    ├●┤                 +1.2%   .130  ▄█▃▂▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
  type one character into a long paragraph and measure                         ├●                  +1.2%   .003  ▃█▄▂▂▁▁▂▁▁ ▂█▅▃▂▁▁▂▂▁
  per-glyph inspection after width change                                      ├●┤                 +1.2%   .021  ▁▁▁█▃█▁▄▅▁ ▁▁▁▇▂█▁▄▅▁
  borrow glyphs from 1000 steadily promoted retained labels                  ├─┼●──┤               +1.2%   .645  ▅▃█▃▁▁▁▁▆▃ ▅▃█▂▁▁▁▂█▂
  1000 labels last length-changing engine publication                          ├●┤                 +1.1%   .083  ▂▆█▅▄▃▂▂▁▁ ▁▇█▅▅▃▃▃▁▁
  type one character into a long Fredoka paragraph and measure                 ├●                  +1.1%   .003  ▃█▄▂▁▁▂▁▁▁ ▂█▅▃▁▁▁▁▁▁
  1000 labels first overwrite-before-scene-publication                       ├─┼●┤                 +1.1%   .382  ▂█▅▄▃▄▂▁▁▁ ▂█▅▅▄▃▂▁▁▁
  measure after text change                                                    ├●                  +1.0%   .010  ▃█▃▂▁▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
  edit and independently copy one label among 1000 labels                      ├●───┤              +1.0%   .130  ▃█▄▃▂▃▂▂▂▁ ▃█▅▅▃▃▃▂▁▂
  reorder then edit one of 1000 retained labels                                ├●┤                 +1.0%   .021  ▂█▆▄▃▂▂▁▁▁ ▁▅█▄▄▃▂▂▁▁
  edit and measure one of 100 retained labels                            ├─────┼●──┤               +0.9%   .980  ▂█▅▃▂▂▁▁▁▁ ▂█▆▄▂▂▁▁▁▁
  100 labels 100 edits immediate me…ements without publication                 ├●┤                 +0.9%   .195  ▂█▇▃▂▁▁▁▁▁ ▁▇█▄▂▁▂▂▁▁
  mount a label and publish its first edit                                     ├●                  +0.9%   .195  ▃█▅▃▁▂▁▂▁▁ ▂█▅▂▂▁▂▂▁▁
  borrow per-glyph metrics from 100 promoted labels                           ├┼●─┤                +0.8%   .505  ▂▁▁▂▃█▂▁▁▁ ▁▁▁▂▃█▃▁▁▁
  write 1000 paragraph and text mutations                                     ├┼●                  +0.8%   .442  ▃█▂▁▂▁▁▁▁▁ ▄█▂▂▂▁▁▁▁▁
  long unsafe-boundary paragraph reflow                                       ├┼●                  +0.8%   .574  ▃█▄▂▁▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
  1000 labels first length-changing engine publication                         ●┤                  +0.6%   .105  ▁█▇▄▄▂▂▂▁▁ ▂▇█▅▄▃▂▁▁▁
  1000 labels last length-changing scene publication                           ●─┤                 +0.6%   .130  ▂▇█▅▄▂▃▁▁▁ ▁▇█▆▄▃▂▂▂▁
  100 labels separated balanced gro…k-space engine publication                ├●──┤                +0.6%   .505  ▂▅█▆▄▃▂▁▁▁ ▂▅█▆▅▃▂▂▁▁
  mount 100 labels and borrow glyphs from each once                           ├●┤                  +0.6%   .382  ▁██▅▅▂▂▂▂▁ ▂▅█▅▅▃▂▁▂▂
  inspection then publication after width change                               ●┤                  +0.6%   .279  █▄▅█▅▇▁▁▁▁ █▃▄▇▄▄▂▃▁▁
  copy per-glyph metrics from 100 unchanged labels                            ├●─┤                 +0.5%   .382  ▂█▆▂▁▁▁▁▁▁ ▁█▇▃▁▁▁▁▁▁
  1000 labels first same-value-set                                            ├●┤                  +0.5%   .798  ▁▄█▅▃▂▂▁▂▁ ▁▄▅█▂▂▂▂▂▁
  split move and merge paint boundaries preparation only                       ●┤                  +0.5%   .382  ▂▄█▇▇▆▆▃▂▂ ▂▅▇▆▇█▅▄▂▁
  1000 labels no-op scene traversal                                           ├●───┤               +0.4%   .574  ▂█▆▂▁▁▁▁▁▁ ▂█▇▃▁▁▁▁▁▁
  1000 labels 100 edits immediate m…surements with publication                ├●─┤                 +0.4%   .574  ▁▅█▆▆▃▃▂▁▁ ▂▄█▆▄▄▃▃▁▁
  100 labels separated balanced gro…nk-space scene publication                ├●──┤                +0.4%   .505  ▁▅█▆▃▂▂▂▁▁ ▁▅█▆▄▃▂▂▂▁
  common-safe word-wrap reflow                                               ├─●──┤                +0.4%   .645  ▃█▃▁▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
  long reporter workaround paragraph reflow                                   ├●┤                  +0.4%  1.000  ▂█▄▂▁▁▁▂▁▁ ▃█▄▂▁▁▁▂▁▁
  long unsafe-boundary paragraph text edit                                     ●┤                  +0.4%   .279  ▃█▃▂▁▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
  10 labels first length-changing engine publication                          ├●───────┤           +0.3%   .398  ▂█▅▃▂▂▁▁▁▁ ▂██▅▃▂▂▂▁▁
  100 labels first color-only scene publication                            ├───●──┤                +0.3%   .721  ▂█▅▄▂▂▁▁▁▁ ▂█▅▃▂▁▁▁▂▁
  read every outline from an unchanged copy                                   ├●─┤                 +0.3%   .721  ▁█▃▁▁▁▁▁▁▁ ▄█▅▂▂▁▁▂▁▁
  scattered setter preparation in o…raph with 8192 paint spans                ├●┤                  +0.3%   .645  ▃█▆▅▂▂▁▁▂▁ ▄█▇▆▃▁▁▂▂▁
  edit and measure one of 1000 retained labels                                 ●─┤                 +0.3%   .458  ▃█▃▂▂▂▁▁▁▁ ▂█▃▂▂▁▁▁▁▁
  100 labels last color-only engine publication                              ├─●┤                  +0.2%   .574  ▂█▄▂▂▁▁▁▁▁ ▂█▃▂▂▁▁▁▁▁
  1000 labels 100 edits batched edit-read publication                       ├──●┤                  +0.2%   .328  ▆█▁▁▁▁▁▁▁▁ ▇█▁▁▁▁▁▁▁▁
  1000 labels separated unbalanced…nk-space scene publication                 ├●┤                  +0.2%   .878  ▂▄█▇▇▆▃▃▂▁ ▁▅▇█▆▅▄▂▃▁
  100 labels last same-length scene publication                              ├─●─┤                 +0.1%   .721  ▁▆█▅▃▂▁▁▂▁ ▁▆█▆▃▂▁▂▁▁
  publication after width change                                             ├─●┤                  +0.1%   .645  ▃█▄▂▁▁▂▁▁▁ ▃█▃▁▁▁▁▁▁▁
  write 22k UTF16 text into Wasm request arena                                 ●┤                  +0.1%   .523  █▃▁▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
  monospaced broad setter preparati…raph with 8192 paint spans                ├●┤                  +0.1%   .721  ▂▆█▇▃▂▁▂▂▁ ▁▄█▆▃▂▂▁▂▂
  10 labels first length-changing scene publication                         ├──●─┤                  0.0%  1.000  ▂█▇▃▂▂▂▁▁▁ ▂██▄▂▂▂▁▁▁
  10 labels last color-only scene publication                               ├──●───┤                0.0%   .878  ▂█▅▃▂▁▁▁▁▁ ▃█▅▃▂▂▁▁▁▁
  broad setter preparation in one l…raph with 8192 paint spans                ├●┤                   0.0%   .382  ▄▄▃█▃▁▂▂▁▁ ▃▆▃█▃▂▂▁▁▁
  1000 labels 100 edits interleaved edit-read publication                     ├●┤                  -0.1%  1.000  ▁▃▄█▆▅▄▃▁▁ ▂▃▅▆█▆▃▂▂▁
  normalize 1000 equivalent formatted flow updates                           ├─●┤                  -0.1%   .382  ▁▃▆▇█▇▅▄▁▁ ▁▃▆▅█▇▄▃▂▁
  measurement after width change                                              ├●┤                  -0.1%   .959  ▁▁▁▂▇█▃▂▂▁ ▁▁▁▃▇█▃▂▂▁
  monospaced unchanged end-to-end s…tion with 8192 paint spans                ├●┤                  -0.1%   .574  ▃▃▁▅█▃▁▁▁▁ ▃▃▁▆█▂▁▁▁▁
  10 labels last same-length scene publication                               ├─●─┤                 -0.2%   .878  ▂██▄▂▁▁▁▁▁ ▁██▃▂▁▁▁▁▁
  1000 labels 100 edits immediate m…ements without publication                ├●┤                  -0.2%  1.000  ▁▅█▆▃▂▂▂▂▁ ▁▄█▅▃▃▂▃▂▁
  copy per-glyph metrics with outlines after text change                      ├●┤                  -0.2%  1.000  ▄▃▂▁▁▂█▂▁▁ ▃▃▂▁▁▃█▃▁▁
  1 labels first same-value-set                                               ├●┤                  -0.2%   .279  █▂▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  1000 labels first set                                                       ├●┤                  -0.2%   .721  ▂█▆▄▂▂▂▁▁▁ ▂█▅▄▂▂▂▁▁▁
  unchanged setter preparation in o…raph with 8192 paint spans                ├●┤                  -0.2%   .645  ▂▅▂▂█▃▂▂▁▁ ▂▅▂▂█▂▂▁▁▁
  monospaced scattered end-to-end s…tion with 8192 paint spans                ├●─┤                 -0.2%   .721  ▁▇█▅▂▁▁▁▁▁ ▃█▅▃▂▂▂▂▁▁
  shared-material scattered setter…raph with 8192 paint spans                 ├●                   -0.2%   .574  ▁▄▇█▅▃▁▂▂▁ ▂▄█▆▄▁▂▂▁▁
  100 labels last color-only scene publication                              ├──●─┤                 -0.3%  1.000  ▂█▆▃▂▁▁▁▁▁ ▂█▅▃▁▁▁▁▁▁
  1000 labels first set+measure                                               ├●┤                  -0.3%   .574  ▂█▅▃▃▂▂▂▁▁ ▃█▅▃▃▂▂▁▁▁
  unchanged end-to-end setter and p…tion with 8192 paint spans               ├─●┤                  -0.3%   .574  ▂▄▁▅█▃▁▁▁▁ ▂▄▁▆█▃▁▁▁▁
  monospaced scattered setter prepa…raph with 8192 paint spans                ├●                   -0.3%   .195  ▃█▄▃▂▁▁▂▁▁ ▂█▄▂▁▁▁▁▁▁
  10 labels first same-length engine publication                            ├──●──────┤            -0.4%  1.000  ▂█▇▅▃▁▂▁▁▁ ▁▇█▄▃▂▂▁▂▁
  100 labels interleaved edit-read publication                                ├●                   -0.4%   .328  ▁▄█▇▄▃▂▂▁▁ ▁▅█▆▃▄▂▂▁▁
  100 labels separated unbalanced g…k-space engine publication                ├●─┤                 -0.4%  1.000  ▁▄█▆▃▂▂▁▂▁ ▁▆█▆▄▃▃▁▂▁
  shared-material scattered end-to-…tion with 8192 paint spans                ├●                   -0.4%   .161  ▁██▅▄▂▂▂▂▂ ▆██▄▃▂▂▂▂▁
  1000 labels first length-changing scene publication                         ├●┤                  -0.5%  1.000  ▂██▅▄▃▂▁▁▁ ▂█▇▅▃▃▂▁▁▁
  1000 labels last same-length scene publication                              ├●┤                  -0.5%   .959  ▁▆██▅▄▃▃▂▁ ▁▄█▇▄▄▃▂▁▁
  1000 labels last color-only scene publication                             ├──●┤                  -0.5%   .442  ▂█▆▄▃▂▂▁▁▁ ▃█▅▃▂▂▂▁▁▁
  100 labels 100 edits immediate measurements with publication                ├●┤                  -0.5%   .721  ▃█▄▂▂▁▁▁▁▁ ▃█▃▂▂▁▂▁▁▁
  issue 216 reporter workaround                                             ├──●─┤                 -0.5%   .668  ▂█▃▂▁▁▁▁▁▁ ▃█▃▂▁▁▁▂▁▁
  1000 labels separated balanced gr…k-space engine publication               ├─●┤                  -0.6%   .279  ▂██▅▁▁▁▁▁▁ ▂██▄▂▁▁▁▁▁
  measure 100 unchanged labels                                             ├───●─────┤             -0.6%   .900  ▂▅██▆▃▂▁▁▁ ▁▄▅█▅▂▁▁▁▁
  100 labels first same-value-set                                             ├●┤                  -0.6%   .234  ▁▃█▂▂▁▂▁▁▁ ▁█▅▄▂▂▂▁▁▁
  100 labels first overwrite-before-scene-publication                        ├─●─┤                 -0.6%   .574  ▂▅█▄▂▂▂▁▁▁ ▁▇█▄▂▂▁▁▁▁
  write one paragraph and text mutation                                      ├─●                   -0.6%   .123  █▃▃▁▁▁▂▁▁▁ █▃▃▁▁▁▁▁▁▁
  write 1000 paragraph-order mutations                                        ├●                   -0.6%   .459  ▂█▁▁▁▁▁▁▁▁ ▃█▁▁▁▁▁▁▁▁
  scattered end-to-end setter and p…tion with 8192 paint spans                ●┤                   -0.7%   .161  ▁▇█▆▅▃▂▂▂▁ ▂█▇▅▃▂▂▁▁▂
  edit and sparsely borrow one of 1000 retained labels                       ├●┼─┤                 -0.7%   .959  ▃█▄▂▂▂▁▁▁▁ ▃█▄▂▂▂▂▁▁▁
  10 labels last same-length engine publication                              ├●┼──┤                -0.8%   .878  ▂█▇▄▃▂▁▁▁▁ ▂█▇▄▂▂▁▁▁▁
  1000 labels separated unbalanced…k-space engine publication                 ●┤                   -0.8%   .161  ▁▄▇██▅▄▂▁▁ ▁▅▆█▆▄▂▂▁▁
  bind and normalize 1000 framework…ped formatted flow updates               ├●┤                   -0.8%   .038  ▁▆▅▅█▇▃▃▂▂ ▂▆▅▅█▄▄▃▁▁
  monospaced unchanged setter prepa…raph with 8192 paint spans                ●┼┤                  -0.8%   .442  ▂▆▂▁▃█▃▁▂▁ ▂▅▂▁▄█▃▁▂▁
  1000 labels first same-length engine publication                           ├●┼┤                  -0.9%   .234  ▂▇█▆▄▃▃▂▁▁ ▂▇█▆▄▃▂▂▁▁
  1 labels first set                                                         ├●┤                   -0.9%   .105  ▄█▂▁▂▂▁▂▁▁ ▅█▂▁▂▁▂▁▁▁
  1000 labels separated balanced gr…nk-space scene publication                ●┤                   -1.0%   .161  ▁▃▆█▆▃▃▁▁▁ ▁▄▆█▅▃▃▁▁▁
  measurement then publication after width change                             ●┼┤                  -1.0%   .279  ▁▁▁▂█▆▂▂▂▁ ▁▂▁▂█▅▂▂▂▁
  normalize 1000 equivalent retained label updates                            ●┤                   -1.1%   .028  ▂▅▂▁▁█▅▂▁▁ ▂▅▂▁▁█▄▁▁▁
  10 labels first color-only engine publication                              ├●┼──┤                -1.1%   .721  ▂█▅▃▂▁▁▁▁▁ ▂█▆▄▂▁▁▁▁▁
  100 labels separated unbalanced g…nk-space scene publication               ├●┤                   -1.1%   .195  ▁▆█▅▃▃▂▂▁▁ ▁▆█▅▃▂▂▂▁▁
  cached per-glyph inspection                                                ├●┼─┤                 -1.1%   .645  ▂█▅▂▁▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
  write 22k UTF16 text into owned array control                            ├──●┤                   -1.1%   .152  █▃▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  10 labels first color-only scene publication                              ├─●┼┤                  -1.2%   .328  ▂█▅▂▂▁▁▁▁▁ ▂█▅▂▂▁▁▁▁▁
  10 labels last length-changing scene publication                          ├─●┼┤                  -1.4%   .328  ▁▆█▄▃▂▁▁▁▁ ▂██▄▂▂▁▁▁▁
  1000 labels first same-length scene publication                            ├●┼┤                  -1.4%   .367  ▂▇█▅▄▃▂▂▁▁ ▂▇█▆▄▃▃▁▁▁
  100 labels first set+measure+scene-publication                            ├─●┤                   -1.5%   .028  ▂█▆▃▂▂▂▁▁▁ ▃█▄▂▂▁▁▁▁▁
  reuse 1000 unchanged Vue property snapshots                                ├●┼┤                  -1.7%   .195  █▁▁▁▁▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
  100 labels first set+measure                                               ├●┊                   -1.9%   .001  ▂█▄▂▂▂▂▂▁▁ ▃█▃▂▂▂▁▁▁▁
  1000 labels last color-only engine publication                            ├●─┼┤                  -2.6%   .099  ▂█▄▃▂▂▂▁▁▁ ▃█▄▃▂▂▂▁▁▁
  10 labels last color-only engine publication                             ├─●─┼┤                  -2.7%   .195  ▂█▅▃▁▁▁▂▁▁ ▄█▄▃▂▁▁▁▁▁
  1 labels first set+measure                                             ├───●─┼─┤                 -3.2%   .328  ▂█▇▄▃▂▁▁▁▁ ▁█▆▃▂▁▁▁▁▁
  1 labels first overwrite-before-scene-publication                        ├●─┤┊                   -3.4%   .021  ▂█▅▂▂▁▂▁▁▁ ▂█▄▂▁▁▁▁▁▁
  move 1000 retained TypeGPU labels                                    ├────●──┼──────┤            -4.0%   .328  ▁▁▅█▅▃▂▁▁▁ ▁▃▆█▄▄▂▁▁▁
  1 labels first set+measure+scene-publication                          ├───●──┼┤                  -4.3%   .234  ▂█▇▄▂▁▂▂▁▁ ▂█▅▂▁▁▁▁▁▁
  measure 1000 unchanged retained labels                               ├───●───┼─┤                 -5.4%   .367  ▁▃▇█▇▄▃▂▁▁ ▁▅█▆▅▃▂▂▂▁
                                                                └──────────────┴──────────────┘
                                                                -20%           0           +20%
```

| status    | bench                                                                    | baseline | candidate | Δ time      | Δ p50  | p     | 95% CI        |
| --------- | ------------------------------------------------------------------------ | -------- | --------- | ----------- | ------ | ----- | ------------- |
| 🔴 slower | publication after font-size change                                       | 7.60ms   | 8.65ms    | +1.050ms    | +13.8% | <.001 | +13.1..+16.1% |
| 🔴 slower | 100 labels first set                                                     | 16.22µs  | 18.46µs   | +0.002ms    | +13.8% | <.001 | +12.4..+15.7% |
| 🔴 slower | relayout after font-size change                                          | 2.02ms   | 2.27ms    | +0.250ms    | +12.3% | <.001 | +11.4..+13.2% |
| 🔴 slower | broad end-to-end setter and publication with 8192 paint spans            | 15.88ms  | 17.59ms   | +1.710ms    | +10.8% | <.001 | +10.1..+11.5% |
| 🔴 slower | monospaced broad end-to-end setter and publication with 8192 paint spans | 16.39ms  | 18.10ms   | +1.710ms    | +10.4% | <.001 | +9.2..+10.9%  |
| 🔴 slower | publish 1024 retained Text instances                                     | 18.37ms  | 20.23ms   | +1.860ms    | +10.1% | <.001 | +8.5..+11.3%  |
| 🔴 slower | publish after color change                                               | 1.38ms   | 1.48ms    | +0.100ms    | +7.4%  | <.001 | +5.4..+8.8%   |
| 🔴 slower | rewrite 256 labels in one group                                          | 4.39ms   | 4.72ms    | +0.330ms    | +7.3%  | <.001 | +6.3..+9.7%   |
| 🔴 slower | publication after text change                                            | 6.83ms   | 7.30ms    | +0.470ms    | +6.8%  | <.001 | +6.2..+7.5%   |
| 🔴 slower | cached measurement                                                       | 29.12ns  | 31.07ns   | +0.000002ms | +6.7%  | .021  | +0.6..+12.6%  |
| 🔴 slower | rewrite 512 labels in one group                                          | 9.46ms   | 10.00ms   | +0.540ms    | +5.8%  | <.001 | +4.9..+7.5%   |
| 🔴 slower | publish after text change                                                | 1.96ms   | 2.07ms    | +0.110ms    | +5.6%  | .010  | +4.7..+7.0%   |
| 🔴 slower | rewrite 64 labels in one group                                           | 1.36ms   | 1.44ms    | +0.080ms    | +5.5%  | <.001 | +4.5..+7.9%   |
| 🔴 slower | rewrite 128 labels in one group                                          | 2.34ms   | 2.47ms    | +0.130ms    | +5.5%  | <.001 | +3.8..+6.8%   |

<details><summary>131 neutral, 0 skipped</summary>

| status  | bench                                                                                     | baseline | candidate | Δ time      | Δ p50 | p     | 95% CI       |
| ------- | ----------------------------------------------------------------------------------------- | -------- | --------- | ----------- | ----- | ----- | ------------ |
| neutral | normalize 1000 equivalent retained label updates                                          | 2.21ms   | 2.19ms    | -0.020ms    | -1.1% | .028  | -1.6..-0.1%  |
| neutral | mutate one trailing span across 1000 formatted labels                                     | 36.48ms  | 37.17ms   | +0.690ms    | +1.9% | .002  | +1.2..+3.6%  |
| neutral | edit and measure one of 100 retained labels                                               | 107.08µs | 108.04µs  | +0.000960ms | +0.9% | .980  | -7.5..+5.8%  |
| neutral | 10 labels no-op scene traversal                                                           | 3.77µs   | 3.91µs    | +0.000140ms | +3.8% | .006  | +1.3..+6.6%  |
| neutral | 10 labels first same-length scene publication                                             | 367.40µs | 376.15µs  | +0.009ms    | +2.4% | .083  | -0.4..+6.0%  |
| neutral | 10 labels first length-changing scene publication                                         | 472.33µs | 472.37µs  | +0.000040ms | 0.0%  | 1.000 | -3.4..+2.2%  |
| neutral | 10 labels first color-only scene publication                                              | 255.21µs | 252.17µs  | -0.003ms    | -1.2% | .328  | -3.4..+0.9%  |
| neutral | 10 labels first same-length engine publication                                            | 351.71µs | 350.44µs  | -0.001ms    | -0.4% | 1.000 | -3.4..+9.1%  |
| neutral | 10 labels first length-changing engine publication                                        | 452.10µs | 453.62µs  | +0.002ms    | +0.3% | .398  | -1.2..+10.6% |
| neutral | 10 labels first color-only engine publication                                             | 233.00µs | 230.35µs  | -0.003ms    | -1.1% | .721  | -2.8..+4.3%  |
| neutral | 10 labels last same-length scene publication                                              | 358.54µs | 357.79µs  | -0.000750ms | -0.2% | .878  | -2.1..+2.3%  |
| neutral | 10 labels last length-changing scene publication                                          | 467.46µs | 460.83µs  | -0.007ms    | -1.4% | .328  | -3.6..+1.5%  |
| neutral | 10 labels last color-only scene publication                                               | 254.06µs | 254.15µs  | +0.000090ms | 0.0%  | .878  | -4.4..+4.7%  |
| neutral | 10 labels last same-length engine publication                                             | 344.88µs | 342.13µs  | -0.003ms    | -0.8% | .878  | -3.3..+3.6%  |
| neutral | 10 labels last length-changing engine publication                                         | 439.50µs | 457.08µs  | +0.018ms    | +4.0% | <.001 | +2.7..+10.6% |
| neutral | 10 labels last color-only engine publication                                              | 231.79µs | 225.56µs  | -0.006ms    | -2.7% | .195  | -5.3..+1.0%  |
| neutral | 100 labels no-op scene traversal                                                          | 60.29µs  | 62.33µs   | +0.002ms    | +3.4% | .505  | -2.7..+6.5%  |
| neutral | 100 labels first same-length scene publication                                            | 469.19µs | 482.44µs  | +0.013ms    | +2.8% | .225  | -1.1..+6.0%  |
| neutral | 100 labels first length-changing scene publication                                        | 657.81µs | 666.65µs  | +0.009ms    | +1.3% | .021  | +0.3..+3.1%  |
| neutral | 100 labels first color-only scene publication                                             | 295.13µs | 296.06µs  | +0.000930ms | +0.3% | .721  | -4.7..+4.0%  |
| neutral | 100 labels first same-length engine publication                                           | 425.85µs | 430.79µs  | +0.005ms    | +1.2% | .721  | -2.1..+2.9%  |
| neutral | 100 labels first length-changing engine publication                                       | 596.54µs | 623.13µs  | +0.027ms    | +4.5% | <.001 | +2.2..+8.2%  |
| neutral | 100 labels first color-only engine publication                                            | 239.98µs | 249.75µs  | +0.010ms    | +4.1% | .130  | -0.4..+8.8%  |
| neutral | 100 labels last same-length scene publication                                             | 473.75µs | 474.44µs  | +0.000690ms | +0.1% | .721  | -2.5..+2.5%  |
| neutral | 100 labels last length-changing scene publication                                         | 598.71µs | 611.40µs  | +0.013ms    | +2.1% | .065  | -0.0..+4.0%  |
| neutral | 100 labels last color-only scene publication                                              | 290.77µs | 289.98µs  | -0.000790ms | -0.3% | 1.000 | -3.6..+2.0%  |
| neutral | 100 labels last same-length engine publication                                            | 422.69µs | 428.44µs  | +0.006ms    | +1.4% | .130  | -0.3..+2.6%  |
| neutral | 100 labels last length-changing engine publication                                        | 546.35µs | 559.40µs  | +0.013ms    | +2.4% | .021  | +0.9..+4.6%  |
| neutral | 100 labels last color-only engine publication                                             | 240.08µs | 240.50µs  | +0.000420ms | +0.2% | .574  | -2.7..+1.6%  |
| neutral | 1000 labels no-op scene traversal                                                         | 382.52µs | 384.17µs  | +0.002ms    | +0.4% | .574  | -1.9..+5.5%  |
| neutral | 1000 labels first same-length scene publication                                           | 1.62ms   | 1.60ms    | -0.020ms    | -1.4% | .367  | -2.5..+1.8%  |
| neutral | 1000 labels first length-changing scene publication                                       | 2.37ms   | 2.36ms    | -0.010ms    | -0.5% | 1.000 | -1.9..+1.2%  |
| neutral | 1000 labels first color-only scene publication                                            | 753.15µs | 764.85µs  | +0.012ms    | +1.6% | .105  | -0.6..+3.3%  |
| neutral | 1000 labels first same-length engine publication                                          | 1.37ms   | 1.36ms    | -0.010ms    | -0.9% | .234  | -2.8..+0.8%  |
| neutral | 1000 labels first length-changing engine publication                                      | 2.13ms   | 2.14ms    | +0.010ms    | +0.6% | .105  | -0.2..+1.9%  |
| neutral | 1000 labels first color-only engine publication                                           | 473.71µs | 479.88µs  | +0.006ms    | +1.3% | .382  | -1.4..+4.5%  |
| neutral | 1000 labels last same-length scene publication                                            | 1.61ms   | 1.61ms    | 0.000ms     | -0.5% | .959  | -1.4..+1.3%  |
| neutral | 1000 labels last length-changing scene publication                                        | 1.88ms   | 1.89ms    | +0.010ms    | +0.6% | .130  | -0.4..+2.1%  |
| neutral | 1000 labels last color-only scene publication                                             | 766.02µs | 762.17µs  | -0.004ms    | -0.5% | .442  | -3.9..+1.8%  |
| neutral | 1000 labels last same-length engine publication                                           | 1.36ms   | 1.40ms    | +0.040ms    | +2.6% | .050  | +0.1..+3.2%  |
| neutral | 1000 labels last length-changing engine publication                                       | 1.64ms   | 1.66ms    | +0.020ms    | +1.1% | .083  | -0.4..+2.9%  |
| neutral | 1000 labels last color-only engine publication                                            | 484.13µs | 471.31µs  | -0.013ms    | -2.6% | .099  | -4.2..+1.2%  |
| neutral | 100 labels 100 edits immediate measurements without publication                           | 1.89ms   | 1.91ms    | +0.020ms    | +0.9% | .195  | -0.6..+2.1%  |
| neutral | 100 labels 100 edits immediate measurements with publication                              | 6.16ms   | 6.14ms    | -0.020ms    | -0.5% | .721  | -1.5..+0.7%  |
| neutral | 100 labels batched edit-read publication                                                  | 4.50ms   | 4.56ms    | +0.060ms    | +1.2% | .028  | +0.1..+2.4%  |
| neutral | 100 labels interleaved edit-read publication                                              | 10.59ms  | 10.56ms   | -0.030ms    | -0.4% | .328  | -0.7..+0.4%  |
| neutral | 1000 labels 100 edits immediate measurements without publication                          | 2.09ms   | 2.08ms    | -0.010ms    | -0.2% | 1.000 | -1.6..+1.6%  |
| neutral | 1000 labels 100 edits immediate measurements with publication                             | 18.17ms  | 18.24ms   | +0.070ms    | +0.4% | .574  | -0.7..+2.0%  |
| neutral | 1000 labels 100 edits batched edit-read publication                                       | 6.67ms   | 6.69ms    | +0.020ms    | +0.2% | .328  | -3.8..+1.2%  |
| neutral | 1000 labels 100 edits interleaved edit-read publication                                   | 45.40ms  | 45.37ms   | -0.030ms    | -0.1% | 1.000 | -1.1..+1.1%  |
| neutral | 100 labels separated balanced grow-shrink-space engine publication                        | 723.44µs | 727.42µs  | +0.004ms    | +0.6% | .505  | -1.1..+3.7%  |
| neutral | 100 labels separated balanced grow-shrink-space scene publication                         | 776.02µs | 779.29µs  | +0.003ms    | +0.4% | .505  | -1.3..+3.7%  |
| neutral | 100 labels separated unbalanced grow-shrink-space engine publication                      | 718.96µs | 716.33µs  | -0.003ms    | -0.4% | 1.000 | -1.8..+2.7%  |
| neutral | 100 labels separated unbalanced grow-shrink-space scene publication                       | 760.00µs | 752.00µs  | -0.008ms    | -1.1% | .195  | -2.7..+0.6%  |
| neutral | 1000 labels separated balanced grow-shrink-space engine publication                       | 2.74ms   | 2.73ms    | -0.010ms    | -0.6% | .279  | -2.5..+0.8%  |
| neutral | 1000 labels separated balanced grow-shrink-space scene publication                        | 3.00ms   | 2.97ms    | -0.030ms    | -1.0% | .161  | -1.4..+0.4%  |
| neutral | 1000 labels separated unbalanced grow-shrink-space engine publication                     | 2.78ms   | 2.76ms    | -0.020ms    | -0.8% | .161  | -2.0..+0.2%  |
| neutral | 1000 labels separated unbalanced grow-shrink-space scene publication                      | 3.03ms   | 3.04ms    | +0.010ms    | +0.2% | .878  | -1.1..+1.2%  |
| neutral | mount and publish a 22k-glyph paragraph                                                   | 19.83ms  | 20.11ms   | +0.280ms    | +1.4% | <.001 | +0.9..+1.6%  |
| neutral | mount a label and publish its first edit                                                  | 2.27ms   | 2.29ms    | +0.020ms    | +0.9% | .195  | -0.6..+1.5%  |
| neutral | mount 100 labels and borrow glyphs from each once                                         | 11.09ms  | 11.15ms   | +0.060ms    | +0.6% | .382  | -0.7..+1.2%  |
| neutral | measure after text change                                                                 | 1.59ms   | 1.60ms    | +0.010ms    | +1.0% | .010  | +0.4..+1.2%  |
| neutral | reflow after width change                                                                 | 344.15µs | 348.12µs  | +0.004ms    | +1.2% | .130  | -0.4..+2.2%  |
| neutral | measure 100 unchanged labels                                                              | 6.81µs   | 6.77µs    | -0.000040ms | -0.6% | .900  | -4.9..+8.3%  |
| neutral | type one character into a long paragraph and measure                                      | 1.68ms   | 1.70ms    | +0.020ms    | +1.2% | .003  | +0.4..+1.5%  |
| neutral | type one character into a long Fredoka paragraph and measure                              | 2.01ms   | 2.03ms    | +0.020ms    | +1.1% | .003  | +0.3..+1.8%  |
| neutral | type one character into a long paragraph and publish a frame                              | 2.79ms   | 2.83ms    | +0.040ms    | +1.5% | .130  | -0.2..+2.3%  |
| neutral | reuse 1000 unchanged Vue property snapshots                                               | 191.81µs | 188.48µs  | -0.003ms    | -1.7% | .195  | -2.8..+0.9%  |
| neutral | normalize 1000 equivalent formatted flow updates                                          | 4.77ms   | 4.77ms    | 0.000ms     | -0.1% | .382  | -2.2..+0.7%  |
| neutral | bind and normalize 1000 framework-shaped formatted flow updates                           | 4.94ms   | 4.90ms    | -0.040ms    | -0.8% | .038  | -2.3..-0.0%  |
| neutral | copy per-glyph metrics after text change                                                  | 3.03ms   | 3.07ms    | +0.040ms    | +1.4% | .105  | -0.1..+2.3%  |
| neutral | copy per-glyph metrics from 100 unchanged labels                                          | 175.04µs | 175.96µs  | +0.000920ms | +0.5% | .382  | -0.7..+3.0%  |
| neutral | edit and independently copy one label among 1 labels                                      | 835.17µs | 847.00µs  | +0.012ms    | +1.4% | .105  | -0.5..+7.9%  |
| neutral | edit and independently copy one label among 100 labels                                    | 943.60µs | 959.69µs  | +0.016ms    | +1.7% | .003  | +0.7..+3.8%  |
| neutral | edit and independently copy one label among 1000 labels                                   | 1.80ms   | 1.82ms    | +0.020ms    | +1.0% | .130  | -0.2..+6.7%  |
| neutral | borrow per-glyph metrics from 100 promoted labels                                         | 223.08µs | 224.96µs  | +0.002ms    | +0.8% | .505  | -1.0..+3.5%  |
| neutral | measurement after width change                                                            | 1.18ms   | 1.18ms    | 0.000ms     | -0.1% | .959  | -1.0..+1.0%  |
| neutral | measurement then publication after width change                                           | 1.40ms   | 1.38ms    | -0.020ms    | -1.0% | .279  | -1.7..+0.7%  |
| neutral | cached per-glyph inspection                                                               | 67.96µs  | 67.23µs   | -0.000730ms | -1.1% | .645  | -2.4..+2.0%  |
| neutral | per-glyph inspection after width change                                                   | 4.41ms   | 4.46ms    | +0.050ms    | +1.2% | .021  | +0.4..+2.5%  |
| neutral | inspection then publication after width change                                            | 4.67ms   | 4.70ms    | +0.030ms    | +0.6% | .279  | -0.4..+1.5%  |
| neutral | publication after width change                                                            | 694.54µs | 695.04µs  | +0.000500ms | +0.1% | .645  | -2.2..+0.9%  |
| neutral | copy per-glyph metrics with outlines after text change                                    | 3.10ms   | 3.09ms    | -0.010ms    | -0.2% | 1.000 | -1.1..+1.2%  |
| neutral | read every outline from an unchanged copy                                                 | 870.23µs | 873.21µs  | +0.003ms    | +0.3% | .721  | -1.4..+2.5%  |
| neutral | 1 labels first set                                                                        | 16.29µs  | 16.15µs   | -0.000140ms | -0.9% | .105  | -2.2..+0.2%  |
| neutral | 1 labels first set+measure                                                                | 111.79µs | 108.21µs  | -0.004ms    | -3.2% | .328  | -7.8..+2.2%  |
| neutral | 1 labels first set+measure+scene-publication                                              | 371.31µs | 355.21µs  | -0.016ms    | -4.3% | .234  | -9.9..+1.4%  |
| neutral | 1 labels first same-value-set                                                             | 69.67ns  | 69.57ns   | -0.000000ms | -0.2% | .279  | -1.9..+0.8%  |
| neutral | 1 labels first overwrite-before-scene-publication                                         | 369.23µs | 356.73µs  | -0.013ms    | -3.4% | .021  | -5.8..-0.8%  |
| neutral | 100 labels first set+measure                                                              | 20.34µs  | 19.96µs   | -0.000380ms | -1.9% | .001  | -3.1..-0.8%  |
| neutral | 100 labels first set+measure+scene-publication                                            | 500.60µs | 493.31µs  | -0.007ms    | -1.5% | .028  | -4.4..-0.2%  |
| neutral | 100 labels first same-value-set                                                           | 69.58ns  | 69.17ns   | -0.000000ms | -0.6% | .234  | -1.8..+1.0%  |
| neutral | 100 labels first overwrite-before-scene-publication                                       | 487.88µs | 484.94µs  | -0.003ms    | -0.6% | .574  | -2.6..+2.4%  |
| neutral | 1000 labels first set                                                                     | 16.21µs  | 16.18µs   | -0.000030ms | -0.2% | .721  | -1.3..+1.7%  |
| neutral | 1000 labels first set+measure                                                             | 20.14µs  | 20.08µs   | -0.000060ms | -0.3% | .574  | -1.7..+0.7%  |
| neutral | 1000 labels first set+measure+scene-publication                                           | 1.63ms   | 1.65ms    | +0.020ms    | +1.3% | .138  | -0.6..+4.4%  |
| neutral | 1000 labels first same-value-set                                                          | 70.84ns  | 71.23ns   | +0.000000ms | +0.5% | .798  | -1.0..+1.7%  |
| neutral | 1000 labels first overwrite-before-scene-publication                                      | 1.62ms   | 1.64ms    | +0.020ms    | +1.1% | .382  | -2.1..+2.8%  |
| neutral | write one paragraph and text mutation                                                     | 458.74ns | 456.08ns  | -0.000003ms | -0.6% | .123  | -2.5..+0.2%  |
| neutral | write 1000 paragraph-order mutations                                                      | 6.08µs   | 6.05µs    | -0.000030ms | -0.6% | .459  | -1.7..+0.5%  |
| neutral | write 1000 paragraph and text mutations                                                   | 71.15µs  | 71.75µs   | +0.000600ms | +0.8% | .442  | -1.5..+1.8%  |
| neutral | write 22k UTF16 text into Wasm request arena                                              | 36.48µs  | 36.50µs   | +0.000020ms | +0.1% | .523  | -0.5..+1.0%  |
| neutral | write 22k UTF16 text into owned array control                                             | 36.90µs  | 36.50µs   | -0.000400ms | -1.1% | .152  | -5.9..+0.3%  |
| neutral | unchanged setter preparation in one large paragraph with 8192 paint spans                 | 2.70ms   | 2.69ms    | -0.010ms    | -0.2% | .645  | -1.5..+1.1%  |
| neutral | unchanged end-to-end setter and publication with 8192 paint spans                         | 2.74ms   | 2.73ms    | -0.010ms    | -0.3% | .574  | -2.2..+1.6%  |
| neutral | scattered setter preparation in one large paragraph with 8192 paint spans                 | 12.75ms  | 12.79ms   | +0.040ms    | +0.3% | .645  | -0.7..+1.2%  |
| neutral | scattered end-to-end setter and publication with 8192 paint spans                         | 14.65ms  | 14.54ms   | -0.110ms    | -0.7% | .161  | -1.5..+0.2%  |
| neutral | broad setter preparation in one large paragraph with 8192 paint spans                     | 12.26ms  | 12.26ms   | 0.000ms     | 0.0%  | .382  | -0.7..+1.4%  |
| neutral | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans      | 2.68ms   | 2.66ms    | -0.020ms    | -0.8% | .442  | -1.4..+0.7%  |
| neutral | monospaced unchanged end-to-end setter and publication with 8192 paint spans              | 2.72ms   | 2.72ms    | 0.000ms     | -0.1% | .574  | -1.7..+1.0%  |
| neutral | monospaced scattered setter preparation in one large paragraph with 8192 paint spans      | 10.02ms  | 9.99ms    | -0.030ms    | -0.3% | .195  | -1.3..+0.3%  |
| neutral | monospaced scattered end-to-end setter and publication with 8192 paint spans              | 11.38ms  | 11.36ms   | -0.020ms    | -0.2% | .721  | -1.2..+2.0%  |
| neutral | monospaced broad setter preparation in one large paragraph with 8192 paint spans          | 12.82ms  | 12.84ms   | +0.020ms    | +0.1% | .721  | -0.9..+1.1%  |
| neutral | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 13.85ms  | 13.81ms   | -0.040ms    | -0.2% | .574  | -1.3..+0.4%  |
| neutral | shared-material scattered end-to-end setter and publication with 8192 paint spans         | 15.19ms  | 15.13ms   | -0.060ms    | -0.4% | .161  | -1.3..+0.2%  |
| neutral | split move and merge paint boundaries preparation only                                    | 4.57ms   | 4.59ms    | +0.020ms    | +0.5% | .382  | -0.3..+0.9%  |
| neutral | split move and merge paint boundaries publication                                         | 5.88ms   | 6.11ms    | +0.230ms    | +3.9% | <.001 | +2.8..+4.4%  |
| neutral | toggle one group containing 1000 retained labels                                          | 412.67µs | 419.77µs  | +0.007ms    | +1.7% | .328  | -2.3..+5.7%  |
| neutral | reorder 1000 unchanged retained labels                                                    | 2.16ms   | 2.19ms    | +0.030ms    | +1.3% | .195  | -0.2..+2.3%  |
| neutral | reorder then edit one of 1000 retained labels                                             | 5.41ms   | 5.46ms    | +0.050ms    | +1.0% | .021  | +0.2..+2.1%  |
| neutral | measure 1000 unchanged retained labels                                                    | 232.96µs | 220.44µs  | -0.013ms    | -5.4% | .367  | -10.1..+2.0% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels                                 | 1.05ms   | 1.07ms    | +0.020ms    | +1.2% | .645  | -3.1..+4.8%  |
| neutral | edit and measure one of 1000 retained labels                                              | 141.15µs | 141.50µs  | +0.000350ms | +0.3% | .458  | -0.5..+2.5%  |
| neutral | edit and sparsely borrow one of 1000 retained labels                                      | 174.04µs | 172.90µs  | -0.001ms    | -0.7% | .959  | -2.8..+3.0%  |
| neutral | move 1000 retained TypeGPU labels                                                         | 248.06µs | 238.19µs  | -0.010ms    | -4.0% | .328  | -10.5..+9.8% |
| neutral | common-safe word-wrap reflow                                                              | 160.71µs | 161.38µs  | +0.000670ms | +0.4% | .645  | -2.3..+3.8%  |
| neutral | issue 216 reporter workaround                                                             | 173.13µs | 172.23µs  | -0.000900ms | -0.5% | .668  | -3.5..+3.1%  |
| neutral | issue 216 unsafe-boundary word-wrap reflow                                                | 174.35µs | 179.98µs  | +0.006ms    | +3.2% | .195  | -2.7..+7.0%  |
| neutral | long reporter workaround paragraph reflow                                                 | 581.83µs | 583.88µs  | +0.002ms    | +0.4% | 1.000 | -1.8..+0.8%  |
| neutral | long unsafe-boundary paragraph reflow                                                     | 633.15µs | 638.38µs  | +0.005ms    | +0.8% | .574  | -1.3..+1.8%  |
| neutral | long unsafe-boundary paragraph text edit                                                  | 1.72ms   | 1.73ms    | +0.010ms    | +0.4% | .279  | -0.2..+1.4%  |

</details>
