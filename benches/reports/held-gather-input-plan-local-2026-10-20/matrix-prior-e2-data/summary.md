Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

1 faster · 2 slower · 142 neutral · 0 skipped

Baseline `0.1.0 (28fd0413)` → candidate `0.1.0 (9b1ad97a)`

Latency distribution across 145 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  0.856ms |   0.848ms |
| Workloads ≤1 ms     |       75 |        75 |
| Workloads ≤2 ms     |       94 |        94 |
| Workloads ≤3 ms     |      111 |       111 |
| Workloads >3 ms     |       34 |        34 |

Largest candidate workloads (including neutral results):

| workload                                                      | baseline | candidate |   Δ time |
| ------------------------------------------------------------- | -------: | --------: | -------: |
| 1000 labels 100 edits interleaved edit-read publication       |  45.52ms |   45.06ms | -0.460ms |
| mutate one trailing span across 1000 formatted labels         |  36.13ms |   36.34ms | +0.210ms |
| mount and publish a 22k-glyph paragraph                       |  19.85ms |   19.96ms | +0.110ms |
| 1000 labels 100 edits immediate measurements with publication |  18.30ms |   18.23ms | -0.070ms |
| publish 1024 retained Text instances                          |  18.13ms |   18.09ms | -0.040ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 10 labels no-op scene traversal                                              ┊      ├●┤         +23.5%  <.001  █▄▄▃▂▁▁▁▁▁ █▄▆▃▂▁▁▁▁▁
- write one paragraph and text mutation                                        ├───●─────┤        +11.4%   .001  █▃▅▁▁▁▁▁▁▁ █▃▅▁▁▁▁▁▁▁
+ toggle one group containing 1000 retained labels                         ├─●┤┊                   -7.5%   .005  ▁▃▇█▅▂▁▁▁▁ ▂██▅▃▂▁▁▁▁
  cached measurement                                                           ├─●──┤              +6.7%   .065  ▇█▁▁▁▂▁▁▁▁ ▅█▂▁▁▂▁▁▁▁
  10 labels last same-length engine publication                                ├─●──┤              +5.1%   .065  ▂█▆▃▂▁▁▁▁▁ ▂█▇▄▃▂▂▂▁▁
  edit and measure one of 100 retained labels                                 ├┼─●───┤             +5.0%   .195  ▂█▅▃▂▂▁▁▁▁ ▂█▇▅▃▂▂▂▁▁
  measure 1000 unchanged retained labels                                       ├─●─┤               +4.7%   .130  ▁▄█▅▃▂▁▁▁▁ ▁▄█▇▆▄▃▁▁▁
  100 labels no-op scene traversal                                             ┊●─┤                +4.2%  <.001  ▄█▃▂▁▁▁▁▁▁ ▂█▄▃▂▁▁▁▁▁
  100 labels first color-only scene publication                                ├●─┤                +3.7%   .050  ▂█▅▃▂▁▁▁▁▁ ▁█▆▃▂▂▁▂▁▁
  edit and sparsely borrow one of 1000 retained labels                         ├●─┤                +3.2%   .083  ▃█▄▃▂▂▂▁▁▁ ▂█▅▄▂▂▂▂▁▁
  1 labels first set                                                           ├●┤                 +2.7%   .003  ▅█▂▁▂▁▂▁▁▁ ▄█▃▂▂▂▂▂▁▁
  1 labels first set+measure                                                  ├┼●─┤                +2.4%   .645  ▂█▆▃▂▁▁▁▁▁ ▃█▆▄▃▂▁▂▁▁
  rewrite 256 labels in one group                                              ├●┤                 +2.0%   .328  ▃█▅▃▂▂▁▁▁▁ ▃█▆▅▄▃▂▂▂▁
  1 labels first set+measure+scene-publication                                 ├●┤                 +1.7%   .645  ▂██▅▃▂▁▁▁▁ ▂▇█▅▃▂▂▁▁▁
  write 1000 paragraph-order mutations                                         ├●┤                 +1.6%   .099  █▃▁▁▁▁▁▁▁▁ █▅▁▁▁▁▁▁▁▁
  100 labels last color-only engine publication                               ├┼●┤                 +1.5%   .234  ▄█▅▃▂▂▂▁▁▁ ▂█▅▃▂▁▁▁▁▁
  100 labels separated unbalanced g…k-space engine publication                 ●┤                  +1.4%   .161  ▂▆█▆▅▃▂▂▁▁ ▁▄█▆▄▃▂▂▁▁
  measure after text change                                                    ●┤                  +1.4%  <.001  ▂█▃▂▂▁▁▁▁▁ ▁█▇▃▂▁▁▂▂▁
  measure 100 unchanged labels                                               ├─●─┤                 +1.4%   .505  ▂▄█▅▃▁▁▁▁▁ ▂▄█▇▃▂▁▁▁▁
  reflow after width change                                                    ●──┤                +1.3%   .161  ▄█▃▂▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
  rewrite 128 labels in one group                                              ●┤                  +1.2%   .234  ▄█▅▃▂▂▁▁▁▁ ▂█▄▃▂▁▁▁▁▁
  1000 labels first set                                                        ●┤                  +1.2%   .161  ▂█▆▃▂▂▂▁▁▁ ▂█▆▄▂▃▂▂▂▁
  10 labels first same-length scene publication                              ├─●┤                  +1.1%   .959  ▂█▆▃▃▂▂▂▁▁ ▁█▆▄▂▂▁▁▁▁
  10 labels last length-changing engine publication                            ●┤                  +1.1%   .314  ▁▆█▄▂▂▂▁▁▁ ▁▅█▄▃▂▂▁▁▁
  100 labels last length-changing engine publication                           ●──┤                +1.1%   .279  ▂█▅▂▁▂▁▁▁▁ ▂█▅▂▂▂▁▁▁▁
  100 labels first same-length scene publication                             ├─●─┤                 +1.0%   .721  ▂█▇▄▃▂▂▂▁▁ ▂██▃▂▂▂▂▁▁
  copy per-glyph metrics from 100 unchanged labels                           ├─●┤                  +1.0%  1.000  ▂█▅▂▁▁▁▁▁▁ ▂█▅▂▁▁▁▁▁▁
  reorder 1000 unchanged retained labels                                       ●─┤                 +1.0%   .161  ▂█▆▄▂▂▂▁▁▁ ▂█▆▄▄▃▂▂▁▁
  100 labels separated unbalanced g…nk-space scene publication                 ●┤                  +0.9%   .574  ▂▇█▅▃▃▂▂▁▁ ▁▆█▄▃▃▂▂▁▁
  1 labels first overwrite-before-scene-publication                            ●┤                  +0.9%   .195  ▂▆█▅▃▁▂▁▁▁ ▂▆█▆▄▂▂▁▁▁
  write 1000 paragraph and text mutations                                     ├●┤                  +0.9%   .878  ▆█▂▂▁▁▁▁▁▁ ▅█▂▂▁▁▁▁▁▁
  mount 100 labels and borrow glyphs from each once                            ●┤                  +0.8%   .130  ▂█▆▄▃▂▂▂▂▁ ▂██▆▃▂▃▁▂▁
  1 labels first same-value-set                                                ●┤                  +0.8%   .279  ▂██▃▁▂▁▁▁▁ ▁▅█▃▁▁▁▁▁▁
  reorder then edit one of 1000 retained labels                                ●┤                  +0.8%   .105  ▂█▆▄▃▂▂▁▁▁ ▁▆█▄▃▃▂▂▂▁
  type one character into a long paragraph and measure                         ●┤                  +0.7%   .328  ▂█▆▃▂▁▁▂▂▁ ▂█▆▃▂▁▁▂▂▁
  1000 labels first set+measure+scene-publication                              ●┤                  +0.7%   .505  ▃█▄▄▄▄▂▁▁▁ ▂█▇▄▄▃▃▂▁▁
  monospaced broad setter preparati…raph with 8192 paint spans                 ●┤                  +0.7%   .442  ▂▆█▄▂▂▂▂▁▁ ▁▆█▅▃▂▂▂▁▁
  mutate one trailing span across 1000 formatted labels                        ●                   +0.6%   .645  ▁▂▄█▅▄▄▄▃▂ ▂▃▅██▅▄▄▄▁
  100 labels first overwrite-before-scene-publication                          ●┤                  +0.6%   .878  ▂█▆▃▂▂▁▁▁▁ ▂█▇▃▂▁▁▁▁▁
  monospaced unchanged setter prepa…raph with 8192 paint spans                 ●┤                  +0.6%   .574  ▃▆▂▂█▅▂▂▂▁ ▃▆▂▁██▂▂▁▁
  monospaced unchanged end-to-end s…tion with 8192 paint spans                ├●┤                  +0.6%   .328  ▃█▁▁▁▁▁▁▁▁ ▃█▁▁▁▁▁▁▁▁
  mount and publish a 22k-glyph paragraph                                      ●┤                  +0.5%   .195  ▄█▆▅▂▃▂▂▁▁ ▄█▅▅▅▃▄▃▂▁
  10 labels first same-length engine publication                             ├─●┤                  +0.4%   .798  ▂█▇▄▃▃▂▂▂▁ ▁█▇▄▃▂▁▁▁▁
  100 labels first color-only engine publication                             ├─●─┤                 +0.4%   .959  ▃█▅▂▂▁▁▁▁▁ ▃█▅▃▂▁▁▁▁▁
  measurement after width change                                               ●┤                  +0.4%   .574  ▁▁▁▂▆█▃▂▂▁ ▁▁▁▂▆█▃▂▂▁
  1000 labels first color-only engine publication                             ├●┤                  +0.3%   .878  ▂█▄▄▂▂▂▁▁▁ ▂█▆▃▃▂▂▂▂▁
  publish after color change                                                   ●                   +0.3%  1.000  █▂▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  copy per-glyph metrics after text change                                     ●                   +0.3%   .397  ▅▆▂▂▁▁█▆▂▁ ▄▆▂▂▁▁█▆▂▁
  100 labels first set+measure+scene-publication                              ├●┤                  +0.3%   .959  ▁▆█▄▂▂▁▁▁▁ ▂██▄▃▂▁▁▁▁
  unchanged end-to-end setter and p…tion with 8192 paint spans                 ●┤                  +0.3%   .328  ▅▇█▁▁▁▁▁▁▁ ▄▆█▁▁▁▁▁▁▁
  monospaced scattered end-to-end s…tion with 8192 paint spans                 ●                   +0.3%   .645  ▃█▅▄▂▂▁▂▁▁ ▂▇█▅▂▂▁▁▂▁
  100 labels last color-only scene publication                               ├─●┤                  +0.2%   .878  ▃█▅▃▂▁▁▂▁▁ ▂█▄▂▁▁▁▁▁▁
  1000 labels first same-length scene publication                              ●┤                  +0.2%   .523  ▂██▆▄▂▂▂▁▁ ▂▆█▄▄▃▂▁▁▁
  unchanged setter preparation in o…raph with 8192 paint spans                ├●                   +0.2%   .959  ▂▅▄█▃▁▁▁▁▁ ▂▆▄█▃▂▂▁▁▁
  scattered setter preparation in o…raph with 8192 paint spans                ├●                   +0.2%   .721  ▂█▆▅▃▂▂▂▁▁ ▁█▇▅▂▁▂▂▂▁
  1000 labels first length-changing engine publication                         ●┤                  +0.1%   .959  ▂█▆▄▃▂▁▁▁▁ ▂█▇▆▄▃▁▁▁▁
  100 labels interleaved edit-read publication                                 ●                   +0.1%   .878  ▂██▅▄▂▃▂▁▁ ▁█▆▅▃▂▂▁▁▁
  100 labels separated balanced gro…nk-space scene publication                ├●                   +0.1%   .878  ▁▇█▅▃▃▂▂▁▁ ▂▇█▄▃▂▂▁▁▁
  1000 labels first set+measure                                                ●                   +0.1%   .959  ▂█▇▄▄▂▂▂▁▁ ▂█▆▄▃▂▂▂▁▁
  write 22k UTF16 text into Wasm request arena                                ├●┤                  +0.1%   .939  █▄▁▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
  broad end-to-end setter and publi…tion with 8192 paint spans                 ●                   +0.1%   .721  ▁▅▆▃█▇▄▃▁▁ ▃▆▃▂█▆▃▂▂▁
  rewrite 64 labels in one group                                               ●┤                   0.0%   .878  ▂█▄▃▂▁▁▁▁▁ ▁█▅▂▁▂▁▁▂▁
  10 labels last color-only scene publication                                 ├●┤                   0.0%   .878  ▁█▅▃▂▂▁▁▁▁ ▁█▆▃▂▁▁▁▁▁
  mount a label and publish its first edit                                     ●─┤                  0.0%   .798  ▂█▅▄▂▂▂▂▁▁ ▂█▇▄▃▂▂▂▂▁
  publication after width change                                               ●┤                   0.0%   .878  ▃█▃▂▁▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
  copy per-glyph metrics with outlines after text change                       ●┤                   0.0%   .878  ▄▃▁▂▁▁█▄▁▁ ▃▆▂▂▁▂█▅▂▁
  shared-material scattered end-to-…tion with 8192 paint spans                ├●                    0.0%   .505  ▂█▆▃▄▁▂▁▁▂ ▂█▆▃▂▂▁▁▁▁
  10 labels last same-length scene publication                                ├●┤                  -0.1%  1.000  ▂█▇▅▂▂▁▁▁▁ ▁▇█▅▂▂▁▁▁▁
  100 labels first same-length engine publication                             ├●┤                  -0.1%   .741  ▁██▄▂▂▁▁▁▁ ▂▇█▄▂▂▁▁▂▁
  1000 labels first color-only scene publication                              ├●─┤                 -0.1%   .505  ▃█▅▃▃▂▁▁▁▁ ▂█▅▃▂▃▂▁▁▁
  1000 labels separated balanced gr…k-space engine publication                ├●                   -0.1%   .505  ▁▅██▇▅▃▂▂▁ ▁▄██▅▃▂▂▁▁
  1000 labels separated unbalanced…nk-space scene publication                  ●┤                  -0.1%   .959  ▃▅▆█▃▃▃▁▁▁ ▂▆█▇▅▃▂▂▁▁
  inspection then publication after width change                               ●                   -0.1%   .574  ▇▄▂▄█▃▃█▃▁ ▆▅▂▃▇▂▂█▃▁
  publication after text change                                                ●                   -0.1%   .959  ▂▆▄▃█▇▃▂▃▁ ▂▇▄▃█▆▄▃▂▂
  1000 labels first overwrite-before-scene-publication                         ●                   -0.1%   .798  ▄██▆▅▅▃▂▁▁ ▂█▅▄▄▃▃▂▁▁
  broad setter preparation in one l…raph with 8192 paint spans                 ●                   -0.1%   .442  █▆▁▁▁▁▁▁▁▁ █▅▁▁▁▁▁▁▁▁
  1000 labels separated unbalanced…k-space engine publication                 ├●                   -0.2%   .721  ▂▆▆██▅▄▂▂▁ ▂▅▇█▆▃▃▂▁▁
  type one character into a long paragraph and publish a frame                 ●                   -0.2%   .505  ▃▇█▃▂▂▂▂▂▁ ▂█▇▃▂▁▂▂▂▁
  shared-material scattered setter…raph with 8192 paint spans                  ●                   -0.2%   .279  ▁▅█▆▄▄▂▂▁▂ ▂▄█▆▃▂▂▂▁▁
  publish 1024 retained Text instances                                        ├●┤                  -0.2%   .959  ▂▄█▃▂▂▃▄▄▃ ▂█▆▃▂▂▃▆▄▃
  long unsafe-boundary paragraph text edit                                    ├●                   -0.2%   .382  ▄█▄▂▂▂▁▁▁▁ ▄█▃▂▂▂▁▁▁▁
  100 labels first length-changing scene publication                           ●─┤                 -0.3%   .959  ▂█▇▅▂▂▂▂▁▁ ▂█▇▄▃▂▂▂▁▁
  100 labels 100 edits immediate me…ements without publication                ├●                   -0.3%   .593  ▁▆█▅▃▁▁▂▁▁ ▂▆█▄▂▁▁▁▁▁
  type one character into a long Fredoka paragraph and measure              ├──●                   -0.3%   .959  █▄▁▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
  reuse 1000 unchanged Vue property snapshots                                 ├●                   -0.3%   .593  ▁▆█▂▁▁▁▁▁▁ ▂▆█▂▁▁▁▁▁▁
  edit and independently copy one label among 100 labels                      ├●                   -0.3%   .721  ▂█▆▃▂▂▁▁▁▁ ▂█▅▃▂▂▂▁▁▁
  read every outline from an unchanged copy                                    ●                   -0.3%   .505  ▃█▁▁▁▁▁▁▁▁ ▄█▂▁▁▁▂▁▁▁
  split move and merge paint boundaries preparation only                       ●                   -0.3%   .645  ▂▄▆▇█▅▄▃▂▁ ▂▅▆██▅▃▂▁▁
  100 labels 100 edits immediate measurements with publication                ├●                   -0.4%   .130  ▂█▅▃▂▂▁▁▁▁ ▂█▄▂▂▁▁▁▁▁
  100 labels batched edit-read publication                                    ├●                   -0.4%   .505  ▁▅█▅▃▂▂▂▂▁ ▂▇█▅▄▂▂▂▂▁
  1000 labels 100 edits immediate m…surements with publication                ├●                   -0.4%   .382  ▁▅█▅▄▃▃▂▁▁ ▂▅█▇▄▃▂▁▁▁
  relayout after font-size change                                              ●                   -0.4%   .878  ▂█▃▁▁▁▁▁▁▁ ▃█▃▁▁▁▂▁▁▁
  write 22k UTF16 text into owned array control                               ├●┤                  -0.4%   .625  █▃▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  1000 labels last length-changing scene publication                          ├●┤                  -0.5%   .382  ▂██▇▄▃▂▂▁▁ ▁▅█▅▃▄▂▂▁▁
  1000 labels 100 edits immediate m…ements without publication                ├●                   -0.5%   .574  ▁▄█▆▃▃▂▂▁▁ ▁▄█▅▃▂▂▂▁▁
  measurement then publication after width change                             ├●                   -0.5%   .442  ▁▁▁▃█▄▂▂▁▁ ▁▁▁▃█▃▂▂▁▁
  rewrite 512 labels in one group                                             ├●                   -0.6%   .328  ▂▅▃▄▇█▄▂▂▂ ▂▅▄▃█▇▄▂▂▂
  100 labels last length-changing scene publication                         ├──●                   -0.6%   .279  ▂██▅▃▂▂▂▁▁ ▃█▆▄▂▂▂▂▁▁
  publish after text change                                                 ├──●                   -0.6%   .505  █▄▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  normalize 1000 equivalent formatted flow updates                             ●                   -0.6%   .721  ▂▄▇▅█▆▄▃▁▁ ▃▆▄▆█▄▃▃▂▁
  bind and normalize 1000 framework…ped formatted flow updates                ├●                   -0.6%   .130  ▁▅▃▅█▄▃▂▁▁ ▂▅▅▆█▄▃▂▂▁
  1000 labels first same-value-set                                            ├●                   -0.6%   .195  ▁▅▇█▅▂▃▁▂▂ ▁▅█▆▂▂▂▂▂▁
  1000 labels 100 edits batched edit-read publication                         ├●                   -0.7%   .574  ▂▅█▇▇▆▆▂▂▁ ▂▄██▇▆▅▃▂▂
  1000 labels separated balanced gr…nk-space scene publication                ├●                   -0.7%   .279  ▂▆██▅▄▂▁▁▁ ▁▅█▄▄▃▂▁▁▁
  100 labels first same-value-set                                             ├●┤                  -0.7%   .798  ▂▃▇▇█▃▂▂▁▁ ▁▂▇█▆▃▂▂▁▁
  scattered end-to-end setter and p…tion with 8192 paint spans                 ●                   -0.7%   .645  ▂▅▇█▄▂▂▂▂▁ ▂▇█▆▄▃▂▂▂▁
  normalize 1000 equivalent retained label updates                            ├●                   -0.8%   .442  ▂▅▃▁▁▆█▄▂▁ ▂▆▂▁▁▆█▃▁▁
  100 labels last same-length scene publication                             ├──●┤                  -0.8%   .505  ▂█▄▂▂▂▁▁▁▁ ▂█▄▁▁▁▁▁▁▁
  1000 labels last same-length engine publication                             ├●                   -0.8%   .161  ▂▆█▅▃▂▂▂▁▁ ▂█▅▄▃▂▂▁▁▁
  10 labels first color-only engine publication                              ├─●──┤                -0.9%   .798  ▂█▆▄▂▂▂▁▁▁ ▃█▅▃▃▂▂▁▁▁
  edit and independently copy one label among 1 labels                        ├●                   -0.9%   .328  ▂█▆▃▂▂▁▁▁▁ ▂█▅▂▁▁▁▁▁▁
  long reporter workaround paragraph reflow                                   ├●                   -0.9%   .161  ▁█▅▂▂▁▂▂▁▁ ▂█▄▂▂▁▁▁▁▁
  1000 labels 100 edits interleaved edit-read publication                     ├●                   -1.0%   .083  ▃▃▇▇█▇▅▂▃▂ ▂▆▆█▆▃▃▂▁▁
  10 labels last length-changing scene publication                            ├●──┤                -1.1%   .959  ▂██▄▃▂▁▁▁▁ ▁██▄▃▂▂▁▁▁
  per-glyph inspection after width change                                     ├●                   -1.1%   .130  ▁▁▁█▂█▂▇▂▁ ▁▁▁█▂▇▁▆▂▁
  split move and merge paint boundaries publication                           ├●                   -1.1%   .161  ▄█▄▁▁▁▁▁▁▁ ▅█▄▂▁▁▁▁▁▁
  cached per-glyph inspection                                                 ├●                   -1.2%   .195  ▂█▃▂▁▁▁▁▁▁ ▂█▂▁▁▁▁▁▁▁
  monospaced broad end-to-end sette…tion with 8192 paint spans                ├●                   -1.2%   .161  ▁▅▇█▃▃▃▂▂▁ ▂▅█▄▂▃▂▁▁▁
  1000 labels last length-changing engine publication                         ├●                   -1.3%   .382  ▂█▇▆▃▃▂▂▁▂ ▂█▆▅▃▂▂▁▁▁
  10 labels first length-changing engine publication                          ├●                   -1.4%   .152  ▁▇█▅▃▂▂▁▁▁ ▁▆█▃▂▂▁▂▁▁
  monospaced scattered setter prepa…raph with 8192 paint spans                ├●                   -1.4%   .050  ▁▅█▅▃▂▂▂▂▁ ▂█▆▄▂▂▁▁▂▁
  1000 labels first same-length engine publication                            ├●┤                  -1.5%   .382  ▁▄██▅▄▄▂▁▁ ▂▇█▆▅▄▄▂▂▁
  borrow per-glyph metrics from 100 promoted labels                           ├●                   -1.5%   .065  ▁▁▁▂▃█▂▁▁▁ ▁▁▁▂▄█▂▁▁▁
  publication after font-size change                                          ├●                   -1.5%  <.001  ▁▄▇▂▃█▄▂▂▂ ▃▆▂▂█▄▂▂▁▁
  100 labels separated balanced gro…k-space engine publication                ●┤                   -1.6%   .382  ▁▂██▅▃▂▂▂▁ ▁▅█▇▅▃▂▂▂▁
  100 labels first set                                                        ●┤                   -1.6%   .279  ▃█▃▂▂▁▁▂▁▁ ▅█▄▂▂▂▂▁▁▁
  100 labels first set+measure                                                ●┤                   -1.6%   .065  ▂█▃▁▂▁▂▁▁▁ ▃█▃▂▂▂▁▁▁▁
  edit and independently copy one label among 1000 labels                     ●┤                   -1.8%   .015  ▁█▆▆▃▃▃▃▂▂ ▁█▆▄▂▂▃▂▁▁
  edit and measure one of 1000 retained labels                            ├───●┼┤                  -1.8%   .328  ▄█▄▃▂▂▂▁▁▁ ▄█▃▂▂▁▁▁▁▁
  long unsafe-boundary paragraph reflow                                       ●┼┤                  -1.8%   .195  ▂█▆▃▁▁▂▂▁▁ ▂█▅▂▁▁▁▁▁▁
  10 labels last color-only engine publication                               ├●┼─┤                 -2.1%   .721  ▂█▅▂▁▂▁▁▁▁ ▂█▅▃▂▂▁▁▁▁
  100 labels first length-changing engine publication                      ├──●┤                   -2.2%   .028  ▁▆█▅▃▃▂▂▂▁ ▁██▄▂▂▂▁▁▁
  10 labels first length-changing scene publication                         ├─●┼┤                  -2.3%   .574  ▃█▇▄▃▂▂▁▁▁ ▂█▅▃▂▂▁▁▁▁
  1000 labels last same-length scene publication                              ●┤                   -2.3%   .005  ▁▅██▅▃▃▂▁▁ ▂█▇▅▃▃▂▁▁▁
  move 1000 retained TypeGPU labels                                         ├─●┼─┤                 -2.3%  1.000  ▂▆██▅▁▁▁▁▁ ▂▆█▆▃▂▁▁▁▁
  100 labels last same-length engine publication                             ├●┤                   -2.7%   .234  ▂█▆▄▃▂▂▁▁▁ ▂█▆▂▁▁▁▁▁▁
  issue 216 unsafe-boundary word-wrap reflow                                ├─●┤                   -2.7%   .185  ▂█▃▂▂▂▁▁▁▁ ▂█▃▁▁▁▁▁▁▁
  1000 labels no-op scene traversal                                          ├●┤                   -2.8%   .007  ▁▃▆█▄▂▁▁▁▁ ▁▆█▆▃▂▁▁▁▁
  1000 labels first length-changing scene publication                         ●┤                   -2.8%   .021  ▁▅█▆▅▄▂▂▁▁ ▂█▇▅▂▃▂▁▁▁
  1000 labels last color-only engine publication                            ├─●┤                   -2.9%   .130  ▂█▆▃▂▂▁▁▁▁ ▄█▅▃▃▂▁▁▁▁
  issue 216 reporter workaround                                              ├●┼┤                  -3.0%   .328  ▂█▄▂▁▁▁▂▁▁ ▂█▃▂▁▁▁▁▁▁
  10 labels first color-only scene publication                              ├─●┤                   -4.0%   .022  ▂█▅▃▃▂▁▁▁▁ ▃█▄▂▂▁▁▁▁▁
  common-safe word-wrap reflow                                              ├─●┤                   -4.3%   .069  ▂█▄▃▁▁▁▂▁▁ ▃█▃▂▁▁▁▁▁▁
  1000 labels last color-only scene publication                             ├●─┤                   -4.9%   .021  ▂█▅▃▂▂▂▁▁▁ ▃█▄▂▂▂▁▁▁▁
  borrow glyphs from 1000 steadily promoted retained labels      ├───────────●─┤                   -4.9%   .083  ▅█▂▂▇▂▁▁▁▁ ▅█▁▂▇▁▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -45%           0           +45%
```

| status    | bench                                            | baseline | candidate | Δ time      | Δ p50  | p     | 95% CI        |
| --------- | ------------------------------------------------ | -------- | --------- | ----------- | ------ | ----- | ------------- |
| 🔴 slower | 10 labels no-op scene traversal                  | 3.08µs   | 3.81µs    | +0.000730ms | +23.5% | <.001 | +20.4..+27.3% |
| 🔴 slower | write one paragraph and text mutation            | 464.59ns | 517.76ns  | +0.000053ms | +11.4% | .001  | +1.0..+29.3%  |
| 🟢 faster | toggle one group containing 1000 retained labels | 446.42µs | 413.10µs  | -0.033ms    | -7.5%  | .005  | -10.8..-2.6%  |

<details><summary>142 neutral, 0 skipped</summary>

| status  | bench                                                                                     | baseline | candidate | Δ time      | Δ p50 | p     | 95% CI       |
| ------- | ----------------------------------------------------------------------------------------- | -------- | --------- | ----------- | ----- | ----- | ------------ |
| neutral | normalize 1000 equivalent retained label updates                                          | 2.21ms   | 2.20ms    | -0.010ms    | -0.8% | .442  | -3.4..+1.0%  |
| neutral | mutate one trailing span across 1000 formatted labels                                     | 36.13ms  | 36.34ms   | +0.210ms    | +0.6% | .645  | -1.3..+1.2%  |
| neutral | edit and measure one of 100 retained labels                                               | 109.98µs | 115.50µs  | +0.006ms    | +5.0% | .195  | -2.6..+18.0% |
| neutral | rewrite 64 labels in one group                                                            | 1.35ms   | 1.35ms    | 0.000ms     | 0.0%  | .878  | -1.1..+2.1%  |
| neutral | rewrite 128 labels in one group                                                           | 2.33ms   | 2.36ms    | +0.030ms    | +1.2% | .234  | -0.7..+2.4%  |
| neutral | rewrite 256 labels in one group                                                           | 4.38ms   | 4.46ms    | +0.080ms    | +2.0% | .328  | -1.2..+6.8%  |
| neutral | rewrite 512 labels in one group                                                           | 9.30ms   | 9.25ms    | -0.050ms    | -0.6% | .328  | -2.4..+0.9%  |
| neutral | 10 labels first same-length scene publication                                             | 361.23µs | 365.29µs  | +0.004ms    | +1.1% | .959  | -7.3..+2.5%  |
| neutral | 10 labels first length-changing scene publication                                         | 490.46µs | 479.04µs  | -0.011ms    | -2.3% | .574  | -9.9..+2.4%  |
| neutral | 10 labels first color-only scene publication                                              | 264.17µs | 253.56µs  | -0.011ms    | -4.0% | .022  | -7.6..-0.2%  |
| neutral | 10 labels first same-length engine publication                                            | 349.75µs | 351.10µs  | +0.001ms    | +0.4% | .798  | -6.4..+3.2%  |
| neutral | 10 labels first length-changing engine publication                                        | 461.19µs | 454.92µs  | -0.006ms    | -1.4% | .152  | -4.5..+1.0%  |
| neutral | 10 labels first color-only engine publication                                             | 248.58µs | 246.35µs  | -0.002ms    | -0.9% | .798  | -7.5..+9.8%  |
| neutral | 10 labels last same-length scene publication                                              | 363.00µs | 362.71µs  | -0.000290ms | -0.1% | 1.000 | -3.7..+3.9%  |
| neutral | 10 labels last length-changing scene publication                                          | 462.31µs | 457.08µs  | -0.005ms    | -1.1% | .959  | -2.7..+8.1%  |
| neutral | 10 labels last color-only scene publication                                               | 252.56µs | 252.56µs  | 0.000ms     | 0.0%  | .878  | -2.9..+3.3%  |
| neutral | 10 labels last same-length engine publication                                             | 342.08µs | 359.63µs  | +0.018ms    | +5.1% | .065  | -0.1..+13.8% |
| neutral | 10 labels last length-changing engine publication                                         | 442.29µs | 447.25µs  | +0.005ms    | +1.1% | .314  | -1.0..+3.5%  |
| neutral | 10 labels last color-only engine publication                                              | 239.60µs | 234.52µs  | -0.005ms    | -2.1% | .721  | -7.5..+5.2%  |
| neutral | 100 labels no-op scene traversal                                                          | 59.58µs  | 62.08µs   | +0.003ms    | +4.2% | <.001 | +2.1..+7.6%  |
| neutral | 100 labels first same-length scene publication                                            | 471.06µs | 476.00µs  | +0.005ms    | +1.0% | .721  | -4.8..+5.7%  |
| neutral | 100 labels first length-changing scene publication                                        | 657.94µs | 656.08µs  | -0.002ms    | -0.3% | .959  | -1.2..+6.9%  |
| neutral | 100 labels first color-only scene publication                                             | 287.77µs | 298.35µs  | +0.011ms    | +3.7% | .050  | +0.9..+10.2% |
| neutral | 100 labels first same-length engine publication                                           | 428.90µs | 428.33µs  | -0.000570ms | -0.1% | .741  | -2.3..+3.1%  |
| neutral | 100 labels first length-changing engine publication                                       | 626.23µs | 612.31µs  | -0.014ms    | -2.2% | .028  | -10.9..-0.6% |
| neutral | 100 labels first color-only engine publication                                            | 248.90µs | 249.83µs  | +0.000930ms | +0.4% | .959  | -4.9..+7.4%  |
| neutral | 100 labels last same-length scene publication                                             | 473.58µs | 469.77µs  | -0.004ms    | -0.8% | .505  | -8.7..+2.4%  |
| neutral | 100 labels last length-changing scene publication                                         | 604.25µs | 600.35µs  | -0.004ms    | -0.6% | .279  | -8.2..+1.0%  |
| neutral | 100 labels last color-only scene publication                                              | 292.42µs | 293.06µs  | +0.000640ms | +0.2% | .878  | -4.9..+2.5%  |
| neutral | 100 labels last same-length engine publication                                            | 437.17µs | 425.44µs  | -0.012ms    | -2.7% | .234  | -7.3..+1.4%  |
| neutral | 100 labels last length-changing engine publication                                        | 553.10µs | 559.13µs  | +0.006ms    | +1.1% | .279  | -0.9..+10.4% |
| neutral | 100 labels last color-only engine publication                                             | 244.50µs | 248.27µs  | +0.004ms    | +1.5% | .234  | -2.7..+5.1%  |
| neutral | 1000 labels no-op scene traversal                                                         | 398.25µs | 387.06µs  | -0.011ms    | -2.8% | .007  | -6.4..-0.9%  |
| neutral | 1000 labels first same-length scene publication                                           | 1.63ms   | 1.63ms    | 0.000ms     | +0.2% | .523  | -1.1..+1.7%  |
| neutral | 1000 labels first length-changing scene publication                                       | 2.40ms   | 2.33ms    | -0.070ms    | -2.8% | .021  | -3.4..-0.6%  |
| neutral | 1000 labels first color-only scene publication                                            | 774.19µs | 773.48µs  | -0.000710ms | -0.1% | .505  | -3.0..+5.0%  |
| neutral | 1000 labels first same-length engine publication                                          | 1.40ms   | 1.38ms    | -0.020ms    | -1.5% | .382  | -2.8..+2.5%  |
| neutral | 1000 labels first length-changing engine publication                                      | 2.14ms   | 2.14ms    | 0.000ms     | +0.1% | .959  | -1.4..+2.0%  |
| neutral | 1000 labels first color-only engine publication                                           | 472.94µs | 474.50µs  | +0.002ms    | +0.3% | .878  | -3.6..+3.8%  |
| neutral | 1000 labels last same-length scene publication                                            | 1.66ms   | 1.62ms    | -0.040ms    | -2.3% | .005  | -4.2..-1.0%  |
| neutral | 1000 labels last length-changing scene publication                                        | 1.91ms   | 1.90ms    | -0.010ms    | -0.5% | .382  | -1.7..+1.5%  |
| neutral | 1000 labels last color-only scene publication                                             | 801.37µs | 762.23µs  | -0.039ms    | -4.9% | .021  | -9.5..-1.1%  |
| neutral | 1000 labels last same-length engine publication                                           | 1.37ms   | 1.36ms    | -0.010ms    | -0.8% | .161  | -2.9..+0.3%  |
| neutral | 1000 labels last length-changing engine publication                                       | 1.69ms   | 1.67ms    | -0.020ms    | -1.3% | .382  | -2.9..+0.9%  |
| neutral | 1000 labels last color-only engine publication                                            | 497.79µs | 483.35µs  | -0.014ms    | -2.9% | .130  | -7.7..+0.5%  |
| neutral | 100 labels 100 edits immediate measurements without publication                           | 1.90ms   | 1.89ms    | -0.010ms    | -0.3% | .593  | -3.1..+1.3%  |
| neutral | 100 labels 100 edits immediate measurements with publication                              | 6.19ms   | 6.16ms    | -0.030ms    | -0.4% | .130  | -2.4..+0.2%  |
| neutral | 100 labels batched edit-read publication                                                  | 4.44ms   | 4.42ms    | -0.020ms    | -0.4% | .505  | -2.2..+1.1%  |
| neutral | 100 labels interleaved edit-read publication                                              | 10.62ms  | 10.63ms   | +0.010ms    | +0.1% | .878  | -1.0..+1.1%  |
| neutral | 1000 labels 100 edits immediate measurements without publication                          | 2.09ms   | 2.08ms    | -0.010ms    | -0.5% | .574  | -1.6..+1.0%  |
| neutral | 1000 labels 100 edits immediate measurements with publication                             | 18.30ms  | 18.23ms   | -0.070ms    | -0.4% | .382  | -1.8..+1.0%  |
| neutral | 1000 labels 100 edits batched edit-read publication                                       | 6.70ms   | 6.65ms    | -0.050ms    | -0.7% | .574  | -2.1..+1.3%  |
| neutral | 1000 labels 100 edits interleaved edit-read publication                                   | 45.52ms  | 45.06ms   | -0.460ms    | -1.0% | .083  | -1.6..+0.0%  |
| neutral | 100 labels separated balanced grow-shrink-space engine publication                        | 732.17µs | 720.40µs  | -0.012ms    | -1.6% | .382  | -4.1..+1.3%  |
| neutral | 100 labels separated balanced grow-shrink-space scene publication                         | 775.63µs | 776.69µs  | +0.001ms    | +0.1% | .878  | -2.3..+1.2%  |
| neutral | 100 labels separated unbalanced grow-shrink-space engine publication                      | 717.13µs | 727.08µs  | +0.010ms    | +1.4% | .161  | -1.4..+3.5%  |
| neutral | 100 labels separated unbalanced grow-shrink-space scene publication                       | 764.19µs | 771.04µs  | +0.007ms    | +0.9% | .574  | -1.4..+2.6%  |
| neutral | 1000 labels separated balanced grow-shrink-space engine publication                       | 2.73ms   | 2.73ms    | 0.000ms     | -0.1% | .505  | -2.4..+0.8%  |
| neutral | 1000 labels separated balanced grow-shrink-space scene publication                        | 2.99ms   | 2.97ms    | -0.020ms    | -0.7% | .279  | -2.3..+0.6%  |
| neutral | 1000 labels separated unbalanced grow-shrink-space engine publication                     | 2.76ms   | 2.76ms    | 0.000ms     | -0.2% | .721  | -1.8..+0.8%  |
| neutral | 1000 labels separated unbalanced grow-shrink-space scene publication                      | 3.05ms   | 3.05ms    | 0.000ms     | -0.1% | .959  | -1.3..+1.6%  |
| neutral | mount and publish a 22k-glyph paragraph                                                   | 19.85ms  | 19.96ms   | +0.110ms    | +0.5% | .195  | -0.3..+1.6%  |
| neutral | mount a label and publish its first edit                                                  | 2.30ms   | 2.30ms    | 0.000ms     | 0.0%  | .798  | -1.3..+6.0%  |
| neutral | mount 100 labels and borrow glyphs from each once                                         | 11.08ms  | 11.17ms   | +0.090ms    | +0.8% | .130  | -0.3..+2.1%  |
| neutral | measure after text change                                                                 | 1.59ms   | 1.61ms    | +0.020ms    | +1.4% | <.001 | +0.6..+2.8%  |
| neutral | publish after text change                                                                 | 1.96ms   | 1.95ms    | -0.010ms    | -0.6% | .505  | -8.7..+0.7%  |
| neutral | reflow after width change                                                                 | 345.94µs | 350.44µs  | +0.004ms    | +1.3% | .161  | -0.6..+9.0%  |
| neutral | publish after color change                                                                | 1.37ms   | 1.38ms    | +0.010ms    | +0.3% | 1.000 | -0.9..+0.9%  |
| neutral | relayout after font-size change                                                           | 2.03ms   | 2.02ms    | -0.010ms    | -0.4% | .878  | -1.0..+0.9%  |
| neutral | measure 100 unchanged labels                                                              | 6.30µs   | 6.39µs    | +0.000090ms | +1.4% | .505  | -5.3..+6.3%  |
| neutral | type one character into a long paragraph and measure                                      | 1.68ms   | 1.69ms    | +0.010ms    | +0.7% | .328  | -0.7..+1.6%  |
| neutral | type one character into a long Fredoka paragraph and measure                              | 2.03ms   | 2.03ms    | 0.000ms     | -0.3% | .959  | -7.7..+1.1%  |
| neutral | type one character into a long paragraph and publish a frame                              | 2.82ms   | 2.81ms    | -0.010ms    | -0.2% | .505  | -1.2..+0.4%  |
| neutral | reuse 1000 unchanged Vue property snapshots                                               | 189.02µs | 188.48µs  | -0.000540ms | -0.3% | .593  | -1.6..+1.2%  |
| neutral | normalize 1000 equivalent formatted flow updates                                          | 4.80ms   | 4.77ms    | -0.030ms    | -0.6% | .721  | -1.4..+0.8%  |
| neutral | bind and normalize 1000 framework-shaped formatted flow updates                           | 4.94ms   | 4.91ms    | -0.030ms    | -0.6% | .130  | -1.6..+0.6%  |
| neutral | copy per-glyph metrics after text change                                                  | 3.04ms   | 3.05ms    | +0.010ms    | +0.3% | .397  | -0.4..+1.2%  |
| neutral | copy per-glyph metrics from 100 unchanged labels                                          | 173.85µs | 175.54µs  | +0.002ms    | +1.0% | 1.000 | -5.2..+2.1%  |
| neutral | edit and independently copy one label among 1 labels                                      | 855.98µs | 848.04µs  | -0.008ms    | -0.9% | .328  | -2.3..+0.8%  |
| neutral | edit and independently copy one label among 100 labels                                    | 946.17µs | 943.15µs  | -0.003ms    | -0.3% | .721  | -1.7..+1.2%  |
| neutral | edit and independently copy one label among 1000 labels                                   | 1.85ms   | 1.81ms    | -0.040ms    | -1.8% | .015  | -4.3..-0.4%  |
| neutral | borrow per-glyph metrics from 100 promoted labels                                         | 226.13µs | 222.65µs  | -0.003ms    | -1.5% | .065  | -2.7..+0.1%  |
| neutral | cached measurement                                                                        | 28.94ns  | 30.89ns   | +0.000002ms | +6.7% | .065  | -0.2..+14.9% |
| neutral | measurement after width change                                                            | 1.18ms   | 1.18ms    | 0.000ms     | +0.4% | .574  | -0.6..+1.6%  |
| neutral | measurement then publication after width change                                           | 1.40ms   | 1.39ms    | -0.010ms    | -0.5% | .442  | -1.9..+0.9%  |
| neutral | cached per-glyph inspection                                                               | 67.27µs  | 66.44µs   | -0.000830ms | -1.2% | .195  | -3.1..+1.4%  |
| neutral | per-glyph inspection after width change                                                   | 4.47ms   | 4.42ms    | -0.050ms    | -1.1% | .130  | -1.8..+0.2%  |
| neutral | inspection then publication after width change                                            | 4.67ms   | 4.67ms    | 0.000ms     | -0.1% | .574  | -0.8..+0.7%  |
| neutral | publication after font-size change                                                        | 7.61ms   | 7.50ms    | -0.110ms    | -1.5% | <.001 | -1.9..-1.1%  |
| neutral | publication after width change                                                            | 693.92µs | 693.73µs  | -0.000190ms | 0.0%  | .878  | -1.4..+1.9%  |
| neutral | publication after text change                                                             | 6.84ms   | 6.84ms    | 0.000ms     | -0.1% | .959  | -0.6..+0.6%  |
| neutral | copy per-glyph metrics with outlines after text change                                    | 3.10ms   | 3.10ms    | 0.000ms     | 0.0%  | .878  | -1.0..+1.7%  |
| neutral | read every outline from an unchanged copy                                                 | 875.71µs | 873.35µs  | -0.002ms    | -0.3% | .505  | -1.2..+0.7%  |
| neutral | 1 labels first set                                                                        | 16.24µs  | 16.67µs   | +0.000430ms | +2.7% | .003  | +1.2..+6.1%  |
| neutral | 1 labels first set+measure                                                                | 110.10µs | 112.73µs  | +0.003ms    | +2.4% | .645  | -4.2..+8.0%  |
| neutral | 1 labels first set+measure+scene-publication                                              | 358.15µs | 364.35µs  | +0.006ms    | +1.7% | .645  | -1.2..+4.7%  |
| neutral | 1 labels first same-value-set                                                             | 69.17ns  | 69.72ns   | +0.000001ms | +0.8% | .279  | -0.6..+1.7%  |
| neutral | 1 labels first overwrite-before-scene-publication                                         | 358.13µs | 361.29µs  | +0.003ms    | +0.9% | .195  | -0.5..+3.1%  |
| neutral | 100 labels first set                                                                      | 16.05µs  | 15.79µs   | -0.000260ms | -1.6% | .279  | -2.4..+0.7%  |
| neutral | 100 labels first set+measure                                                              | 20.21µs  | 19.89µs   | -0.000320ms | -1.6% | .065  | -3.0..+0.0%  |
| neutral | 100 labels first set+measure+scene-publication                                            | 488.44µs | 490.12µs  | +0.002ms    | +0.3% | .959  | -1.8..+1.6%  |
| neutral | 100 labels first same-value-set                                                           | 70.83ns  | 70.35ns   | -0.000000ms | -0.7% | .798  | -1.9..+1.7%  |
| neutral | 100 labels first overwrite-before-scene-publication                                       | 488.52µs | 491.42µs  | +0.003ms    | +0.6% | .878  | -1.4..+1.7%  |
| neutral | 1000 labels first set                                                                     | 16.15µs  | 16.35µs   | +0.000200ms | +1.2% | .161  | -0.5..+2.6%  |
| neutral | 1000 labels first set+measure                                                             | 20.33µs  | 20.36µs   | +0.000030ms | +0.1% | .959  | -1.5..+1.2%  |
| neutral | 1000 labels first set+measure+scene-publication                                           | 1.64ms   | 1.65ms    | +0.010ms    | +0.7% | .505  | -1.0..+1.5%  |
| neutral | 1000 labels first same-value-set                                                          | 71.40ns  | 70.99ns   | -0.000000ms | -0.6% | .195  | -2.1..+0.6%  |
| neutral | 1000 labels first overwrite-before-scene-publication                                      | 1.64ms   | 1.64ms    | 0.000ms     | -0.1% | .798  | -1.4..+1.1%  |
| neutral | write 1000 paragraph-order mutations                                                      | 11.88µs  | 12.06µs   | +0.000180ms | +1.6% | .099  | -0.3..+6.0%  |
| neutral | write 1000 paragraph and text mutations                                                   | 70.88µs  | 71.50µs   | +0.000620ms | +0.9% | .878  | -4.5..+2.8%  |
| neutral | write 22k UTF16 text into Wasm request arena                                              | 36.81µs  | 36.83µs   | +0.000020ms | +0.1% | .939  | -2.0..+1.8%  |
| neutral | write 22k UTF16 text into owned array control                                             | 36.60µs  | 36.46µs   | -0.000140ms | -0.4% | .625  | -4.5..+1.7%  |
| neutral | unchanged setter preparation in one large paragraph with 8192 paint spans                 | 2.70ms   | 2.71ms    | +0.010ms    | +0.2% | .959  | -1.6..+1.4%  |
| neutral | unchanged end-to-end setter and publication with 8192 paint spans                         | 2.75ms   | 2.76ms    | +0.010ms    | +0.3% | .328  | -0.5..+1.9%  |
| neutral | scattered setter preparation in one large paragraph with 8192 paint spans                 | 12.76ms  | 12.78ms   | +0.020ms    | +0.2% | .721  | -2.1..+1.1%  |
| neutral | scattered end-to-end setter and publication with 8192 paint spans                         | 14.77ms  | 14.67ms   | -0.100ms    | -0.7% | .645  | -1.4..+1.0%  |
| neutral | broad setter preparation in one large paragraph with 8192 paint spans                     | 12.37ms  | 12.35ms   | -0.020ms    | -0.1% | .442  | -1.4..+0.6%  |
| neutral | broad end-to-end setter and publication with 8192 paint spans                             | 16.03ms  | 16.05ms   | +0.020ms    | +0.1% | .721  | -1.5..+0.7%  |
| neutral | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans      | 2.68ms   | 2.69ms    | +0.010ms    | +0.6% | .574  | -0.6..+2.7%  |
| neutral | monospaced unchanged end-to-end setter and publication with 8192 paint spans              | 2.74ms   | 2.76ms    | +0.020ms    | +0.6% | .328  | -1.7..+1.8%  |
| neutral | monospaced scattered setter preparation in one large paragraph with 8192 paint spans      | 10.10ms  | 9.96ms    | -0.140ms    | -1.4% | .050  | -3.2..-0.2%  |
| neutral | monospaced scattered end-to-end setter and publication with 8192 paint spans              | 11.39ms  | 11.42ms   | +0.030ms    | +0.3% | .645  | -0.8..+1.2%  |
| neutral | monospaced broad setter preparation in one large paragraph with 8192 paint spans          | 12.95ms  | 13.04ms   | +0.090ms    | +0.7% | .442  | -0.6..+2.4%  |
| neutral | monospaced broad end-to-end setter and publication with 8192 paint spans                  | 16.77ms  | 16.56ms   | -0.210ms    | -1.2% | .161  | -2.4..+0.4%  |
| neutral | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 13.84ms  | 13.82ms   | -0.020ms    | -0.2% | .279  | -1.4..+0.3%  |
| neutral | shared-material scattered end-to-end setter and publication with 8192 paint spans         | 15.27ms  | 15.27ms   | 0.000ms     | 0.0%  | .505  | -3.0..+0.6%  |
| neutral | split move and merge paint boundaries preparation only                                    | 4.59ms   | 4.57ms    | -0.020ms    | -0.3% | .645  | -1.2..+0.6%  |
| neutral | split move and merge paint boundaries publication                                         | 5.94ms   | 5.87ms    | -0.070ms    | -1.1% | .161  | -2.3..+0.4%  |
| neutral | reorder 1000 unchanged retained labels                                                    | 2.17ms   | 2.19ms    | +0.020ms    | +1.0% | .161  | -0.4..+6.2%  |
| neutral | reorder then edit one of 1000 retained labels                                             | 5.42ms   | 5.46ms    | +0.040ms    | +0.8% | .105  | -0.1..+2.4%  |
| neutral | measure 1000 unchanged retained labels                                                    | 219.23µs | 229.63µs  | +0.010ms    | +4.7% | .130  | -1.4..+12.2% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels                                 | 1.10ms   | 1.05ms    | -0.050ms    | -4.9% | .083  | -41.1..+0.7% |
| neutral | edit and measure one of 1000 retained labels                                              | 148.73µs | 146.08µs  | -0.003ms    | -1.8% | .328  | -14.0..+2.4% |
| neutral | edit and sparsely borrow one of 1000 retained labels                                      | 171.27µs | 176.69µs  | +0.005ms    | +3.2% | .083  | -0.7..+8.7%  |
| neutral | publish 1024 retained Text instances                                                      | 18.13ms  | 18.09ms   | -0.040ms    | -0.2% | .959  | -2.3..+2.2%  |
| neutral | move 1000 retained TypeGPU labels                                                         | 248.83µs | 243.21µs  | -0.006ms    | -2.3% | 1.000 | -7.8..+5.2%  |
| neutral | common-safe word-wrap reflow                                                              | 170.52µs | 163.13µs  | -0.007ms    | -4.3% | .069  | -9.8..+0.6%  |
| neutral | issue 216 reporter workaround                                                             | 177.92µs | 172.60µs  | -0.005ms    | -3.0% | .328  | -6.9..+2.6%  |
| neutral | issue 216 unsafe-boundary word-wrap reflow                                                | 181.75µs | 176.88µs  | -0.005ms    | -2.7% | .185  | -10.5..+0.6% |
| neutral | long reporter workaround paragraph reflow                                                 | 587.58µs | 582.46µs  | -0.005ms    | -0.9% | .161  | -4.3..+0.2%  |
| neutral | long unsafe-boundary paragraph reflow                                                     | 643.54µs | 631.67µs  | -0.012ms    | -1.8% | .195  | -3.7..+1.5%  |
| neutral | long unsafe-boundary paragraph text edit                                                  | 1.74ms   | 1.74ms    | 0.000ms     | -0.2% | .382  | -2.1..+0.5%  |

</details>
