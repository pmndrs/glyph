Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

5 faster · 4 slower · 136 neutral · 0 skipped

Baseline `0.1.0 (28fd0413)` → candidate `0.1.0 (d2f7a01f)`

> ⚠ baseline CPU clock drifted 7.9% during its run

Latency distribution across 145 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 0.872ms | 0.839ms |
| Workloads ≤1 ms | 75 | 75 |
| Workloads ≤2 ms | 94 | 93 |
| Workloads ≤3 ms | 111 | 111 |
| Workloads >3 ms | 34 | 34 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 45.82ms | 45.61ms | -0.210ms |
| mutate one trailing span across 1000 formatted labels | 36.32ms | 37.34ms | +1.020ms |
| mount and publish a 22k-glyph paragraph | 19.92ms | 19.97ms | +0.050ms |
| publish 1024 retained Text instances | 18.17ms | 19.06ms | +0.890ms |
| 1000 labels 100 edits immediate measurements with publication | 18.23ms | 18.22ms | -0.010ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- publish after text change                                                    ┊  ●┤               +6.3%   .002  ▃█▄▂▁▁▁▂▁▁ ▁▂█▆▃▁▁▂▁▁
- borrow glyphs from 1000 steadily promoted retained labels                    ┊├─●───┤            +5.7%   .028  ▆█▇▁▁▁▂▅█▁ ▄▅█▂▁▁▂▂█▁
- publication after text change                                                ┊ ├●                +5.4%  <.001  ▃▆▄█▃▂▂▁▁▁ ▁▁▂▆▄█▄▃▁▁
- publish 1024 retained Text instances                                         ┊ ●──┤              +4.9%  <.001  █▅▁▁▁▁▁▁▁▁ █▇▁▁▁▁▁▁▁▁
+ edit and independently copy one label among 100 labels                    ●─┤┊                   -5.2%   .007  ▁▆█▄▂▂▂▁▁▁ ▂█▅▃▂▂▁▁▁▁
+ 100 labels first color-only scene publication                       ├─────●─┤┊                   -5.9%   .002  ▂█▆▄▃▂▂▂▁▁ ▂█▅▂▂▁▁▁▁▁
+ 100 labels first set                                                ├───●────┤                   -9.1%   .050  ▁▆█▄▂▁▁▁▁▁ ▄█▅▃▂▁▁▁▁▁
+ 1 labels first same-value-set                                        ├●─────┤┊                  -13.3%   .016  █▇▂▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ 1 labels first set                                                 ├─●──────┤┊                  -15.6%   .038  ▁▃▇█▇▄▂▂▁▁ ▁██▅▃▂▁▁▁▁
  write one paragraph and text mutation                                    ├───┼───●───────┤       +8.3%   .195  █▄▂▁▁▁▁▁▁▁ █▆▃▁▁▁▁▁▁▁
  write 22k UTF16 text into owned array control                                ├──●──┤             +5.8%   .266  █▂▁▁▁▁▁▁▁▁ █▅▂▁▁▁▁▁▁▁
  10 labels last length-changing engine publication                            ├─●──┤              +3.8%   .130  ▅█▂▁▁▁▁▁▁▁ ▃█▂▁▁▁▁▁▁▁
  relayout after font-size change                                              ┊├●                 +3.7%  <.001  ▁█▄▁▁▁▁▂▁▁ ▁▂█▃▂▂▁▁▁▁
  issue 216 reporter workaround                                                ├─●┤                +3.6%   .105  ▃█▃▂▁▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
  edit and measure one of 1000 retained labels                                 ├─●┤                +3.5%   .083  ▂█▄▂▂▂▁▁▁▁ ▁█▆▃▂▂▂▂▁▁
  1000 labels first set+measure+scene-publication                             ├┼─●┤                +3.3%   .195  ▂█▆▄▅▄▃▂▁▁ ▂▆█▆▅▄▃▂▂▁
  issue 216 unsafe-boundary word-wrap reflow                                   ├─●┤                +3.2%   .083  ▃█▄▂▁▁▁▁▁▁ ▃█▄▂▁▁▁▁▁▁
  mutate one trailing span across 1000 formatted labels                        ┊●┤                 +2.8%  <.001  ▂▄▇█▆▄▄▁▁▁ ▁▂▂▅█▆▅▃▂▁
  publication after font-size change                                           ┊●┤                 +2.8%  <.001  ▃▆▂▄█▃▂▁▁▁ ▁▁▆▅▄█▇▃▃▁
  rewrite 64 labels in one group                                               ┊●┤                 +2.6%   .002  ▃█▄▃▂▁▁▁▂▁ ▂█▅▂▂▁▁▁▁▁
  rewrite 128 labels in one group                                              ├●┤                 +2.5%   .065  ▃█▅▄▂▂▁▁▁▁ ▁█▅▄▂▂▁▂▁▁
  rewrite 512 labels in one group                                              ├●┤                 +2.5%   .015  ▅▄▃▅█▆▂▂▃▁ ▁▄▄▅▆█▅▂▂▂
  write 1000 paragraph and text mutations                                      ├●┤                 +2.5%   .011  ▂█▂▂▁▁▁▁▁▁ ▁█▃▂▂▁▁▁▁▁
  split move and merge paint boundaries publication                            ┊●                  +2.3%   .010  ▂▅█▄▃▄▄▃▂▁ ▁▁▅█▆▅▅▄▂▁
  rewrite 256 labels in one group                                            ├─┼●┤                 +2.1%   .130  ▃█▆▅▄▃▂▂▂▁ ▁▆█▅▃▂▂▂▁▁
  1000 labels first overwrite-before-scene-publication                         ┊●─┤                +2.0%   .005  ▂█▅▅▄▄▃▂▁▁ ▂▆█▇▆▅▃▃▂▁
  broad end-to-end setter and publi…tion with 8192 paint spans                 ├●                  +2.0%   .028  ▃▆▂▃▅█▄▃▂▁ ▁▃▇▄▃▅██▃▂
  long unsafe-boundary paragraph reflow                                        ├●                  +1.9%   .065  ▃█▄▂▁▁▁▁▁▁ ▂█▅▂▁▁▂▁▁▁
  1000 labels last same-length engine publication                              ├●┤                 +1.8%   .130  ▁▅█▆▅▄▂▂▁▁ ▁▂▆█▆▄▃▂▂▁
  monospaced broad end-to-end sette…tion with 8192 paint spans                 ├●                  +1.8%   .010  ▂█▇█▆▄▂▃▁▁ ▁▁▄▆██▄▃▂▁
  1000 labels first color-only engine publication                           ├──┼●─┤                +1.7%   .798  ▂█▅▅▃▃▂▂▁▁ ▂█▅▄▃▂▂▂▁▁
  write 1000 paragraph-order mutations                                         ├●─┤                +1.7%   .185  █▃▁▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
  10 labels no-op scene traversal                                             ├┼●─┤                +1.6%   .234  ▃█▄▃▃▂▂▁▁▁ ▂█▅▄▂▂▂▂▁▁
  measure 1000 unchanged retained labels                                  ├────┼●──┤               +1.5%   .721  ▂██▅▄▂▁▁▁▁ ▁██▄▄▂▂▁▁▁
  100 labels last length-changing engine publication                        ├──┼●┤                 +1.4%   .959  ▂▇█▄▃▂▂▂▁▁ ▁▆█▄▂▁▁▂▁▁
  reorder 1000 unchanged retained labels                                      ├┼●┤                 +1.2%   .234  ▂█▅▃▂▃▂▁▁▁ ▂█▆▄▃▃▂▁▁▁
  1000 labels separated unbalanced…k-space engine publication                 ├┼●                  +1.1%   .878  ▁▅██▆▃▃▂▁▁ ▂▄█▇█▃▂▁▁▁
  monospaced scattered setter prepa…raph with 8192 paint spans                 ├●                  +1.1%   .021  ▃█▄▂▂▂▁▂▁▁ ▂█▇▃▂▁▁▂▂▁
  edit and measure one of 100 retained labels                            ├─────┼●─┤                +1.0%   .900  ▂█▆▄▃▂▂▁▁▁ ▂█▆▃▂▂▁▁▁▁
  1000 labels last length-changing engine publication                          ├●──┤               +1.0%   .328  ▃█▅▄▂▁▁▁▁▁ ▃█▇▅▄▂▂▁▁▁
  1000 labels first color-only scene publication                               ●─┤                 +0.9%   .234  ▂█▅▃▂▂▂▁▁▁ ▂█▅▄▂▃▂▁▁▁
  type one character into a long paragraph and measure                         ●─┤                 +0.9%   .028  ▂█▆▃▂▁▂▂▂▁ ▁██▆▂▂▂▂▂▁
  100 labels separated unbalanced g…nk-space scene publication                ├●┤                  +0.8%   .798  ▂▅█▇▅▃▃▂▁▁ ▁▆█▆▄▃▃▂▂▁
  scattered setter preparation in o…raph with 8192 paint spans                 ●┤                  +0.8%   .195  ▂█▅▃▂▁▁▂▂▁ ▂▇█▄▃▂▁▂▁▁
  monospaced unchanged end-to-end s…tion with 8192 paint spans                ├●┤                  +0.6%   .279  ▂▄▁██▃▁▁▁▁ ▂▄▁▅█▂▂▁▁▁
  long reporter workaround paragraph reflow                                    ●┤                  +0.6%   .721  ▁█▄▂▁▁▁▁▂▁ ▁█▅▂▁▁▁▁▂▁
  1000 labels no-op scene traversal                                         ├──●┤                  +0.5%   .878  ▂█▆▃▂▁▁▁▁▁ ▂█▆▂▁▁▁▁▁▁
  type one character into a long paragraph and publish a frame                 ●┤                  +0.5%   .574  ▂█▅▂▁▂▂▂▁▁ ▂█▇▃▂▁▂▂▁▁
  copy per-glyph metrics from 100 unchanged labels                            ├●┤                  +0.5%   .938  ▁▇█▃▁▁▁▁▁▁ ▂▇█▄▂▁▁▁▁▁
  100 labels batched edit-read publication                                    ├●┤                  +0.4%   .878  ▂▆█▆▃▂▃▂▂▁ ▂▇█▆▃▂▂▂▂▁
  toggle one group containing 1000 retained labels                          ├──●─┤                 +0.4%   .959  ▁▃▇█▅▄▃▂▁▁ ▂▃██▅▄▂▂▁▁
  10 labels last length-changing scene publication                           ├─●─┤                 +0.3%   .574  ▁▆█▄▃▂▁▁▁▁ ▁▄█▄▂▁▁▁▁▁
  100 labels separated balanced gro…nk-space scene publication                ├●┤                  +0.3%   .574  ▁▆█▅▄▂▂▂▁▁ ▂▅█▅▄▃▂▂▁▁
  mount and publish a 22k-glyph paragraph                                      ●                   +0.3%   .382  ▃█▆▅▂▃▃▂▁▁ ▂█▅▆▄▂▃▂▁▁
  mount 100 labels and borrow glyphs from each once                           ├●┤                  +0.3%   .798  █▄▁▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
  inspection then publication after width change                              ├●┤                  +0.3%   .878  ▆▇▅▇▄█▂▂▁▁ █▄▅▇▄▅▂▃▁▁
  monospaced broad setter preparati…raph with 8192 paint spans                 ●┤                  +0.3%   .398  ▁▆█▅▃▂▂▂▂▁ ▁▅█▅▃▂▂▂▂▁
  shared-material scattered setter…raph with 8192 paint spans                  ●┤                  +0.3%   .161  ▁▅██▃▂▁▂▁▁ ▃▅██▆▃▃▄▂▂
  reorder then edit one of 1000 retained labels                                ●──┤                +0.3%   .161  ▃█▆▃▂▂▂▁▁▁ ▂█▆▄▃▂▂▂▁▂
  long unsafe-boundary paragraph text edit                                     ●┤                  +0.3%   .505  ▃█▃▁▁▂▁▁▁▁ ▃█▄▂▁▁▁▁▁▁
  measure after text change                                                    ●┤                  +0.2%   .130  ▂█▄▂▁▁▁▁▁▁ ▁█▄▃▂▂▁▂▁▁
  copy per-glyph metrics after text change                                     ●┤                  +0.2%   .505  ▃▄▁▁▁▂█▂▁▁ ▃▄▁▂▁▂█▂▂▁
  write 22k UTF16 text into Wasm request arena                                ├●─┤                 +0.2%   .959  █▃▁▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
  100 labels last color-only scene publication                              ├──●┤                  +0.1%  1.000  ▂█▆▄▂▁▁▂▁▁ ▁█▅▃▂▁▁▂▁▁
  normalize 1000 equivalent retained label updates                            ├●                    0.0%   .959  ▂▄▂▁▃█▂▁▁▁ ▂▄▂▁▂█▂▂▁▁
  100 labels first length-changing engine publication                        ├─●┤                   0.0%   .878  ▂██▄▃▂▂▂▂▁ ▂█▇▅▃▂▁▂▁▁
  bind and normalize 1000 framework…ped formatted flow updates                ├●                    0.0%   .878  ▂▅▆▇█▅▄▃▂▁ ▂▄▆█▇▅▃▃▁▁
  cached measurement                                                        ├──●────┤               0.0%   .900  ▄█▃▂▁▁▁▁▁▁ ▄█▃▂▁▁▁▁▁▁
  monospaced scattered end-to-end s…tion with 8192 paint spans                 ●┤                   0.0%   .959  ▂█▆▇▃▃▂▂▁▁ ▂▅█▆▃▂▁▁▂▁
  100 labels last length-changing scene publication                           ├●─┤                 -0.1%   .878  ▂█▇▄▂▂▂▁▁▁ ▂█▆▄▂▂▁▂▁▁
  1000 labels first same-length scene publication                             ├●┤                  -0.1%   .959  ▂▇█▆▄▃▂▂▁▁ ▂▆█▄▃▃▂▁▁▁
  1000 labels first length-changing engine publication                        ├●┤                  -0.1%   .959  ▂█▇▅▄▃▂▂▁▁ ▃▆█▅▄▃▂▁▁▁
  1000 labels last same-length scene publication                             ├─●┤                  -0.1%   .878  ▂█▇▅▄▄▃▁▁▁ ▂█▇▅▃▄▂▂▁▁
  1000 labels 100 edits immediate m…surements with publication                ├●                   -0.1%   .721  ▂▃█▇█▄▄▃▃▂ ▃▄▇█▆▅▄▅▂▁
  1000 labels 100 edits batched edit-read publication                         ├●                   -0.1%   .505  ▂▆█▆▅▄▃▃▂▁ ▃▇█▆▅▅▃▂▁▁
  monospaced unchanged setter prepa…raph with 8192 paint spans                ├●┤                  -0.1%   .878  ▂▅▁▂█▂▂▂▁▁ ▃▄▂▃█▂▂▁▁▁
  move 1000 retained TypeGPU labels                                         ├──●─┤                 -0.1%  1.000  ▁▂▃▆█▆▄▂▁▁ ▁▂▄▅█▇▅▂▁▁
  10 labels first length-changing scene publication                          ├─●─┤                 -0.2%   .878  ▂█▆▃▂▁▁▁▁▁ ▁█▆▃▂▁▁▁▁▁
  1000 labels last color-only scene publication                              ├─●─┤                 -0.2%   .959  ▃█▆▃▂▂▂▂▂▁ ▂█▆▃▃▂▂▁▁▁
  100 labels 100 edits immediate measurements with publication                ├●┤                  -0.2%   .959  ▂█▄▃▂▁▂▁▁▁ ▂█▄▃▂▁▁▁▁▁
  1000 labels separated balanced gr…k-space engine publication                ├●┤                  -0.2%   .959  ▁▄█▆▃▃▁▁▁▁ ▂▄█▇▄▂▁▁▁▁
  broad setter preparation in one l…raph with 8192 paint spans                 ●┤                  -0.2%   .959  ▂▇▄▇█▃▁▃▂▁ ▃█▄▇█▅▂▂▄▁
  split move and merge paint boundaries preparation only                      ├●┤                  -0.2%   .878  ▁▆█▄▂▁▁▁▁▁ ▂▆█▄▂▁▁▁▁▁
  edit and sparsely borrow one of 1000 retained labels                        ├●─┤                 -0.2%   .798  ▂█▅▃▂▂▁▁▁▁ ▁█▆▃▂▂▂▂▁▁
  10 labels first same-length scene publication                               ├●─┤                 -0.3%   .721  ▁▇█▅▃▁▁▁▁▁ ▁▆█▄▂▂▂▁▁▁
  type one character into a long Fredoka paragraph and measure                ├●                   -0.3%   .328  ▃█▅▃▂▂▂▁▁▁ ▄█▅▃▂▂▁▂▁▁
  reuse 1000 unchanged Vue property snapshots                                 ├●┤                  -0.3%   .878  ▁▅█▅▂▁▁▁▁▁ ▁▄█▄▂▁▁▁▁▁
  unchanged setter preparation in o…raph with 8192 paint spans                 ●┤                  -0.3%   .878  ▃█▁█▇▂▂▁▁▁ ▃▇▂██▂▂▂▂▁
  shared-material scattered end-to-…tion with 8192 paint spans                 ●                   -0.3%   .328  ▁▇█▄▄▃▃▂▂▂ ▃█▆▄▄▂▂▂▂▁
  10 labels first same-length engine publication                            ├──●┤                  -0.4%   .959  ▂██▅▃▂▂▁▁▁ ▁██▃▂▂▂▂▁▁
  publish after color change                                                  ├●                   -0.4%   .195  ▄█▂▁▁▁▁▁▁▁ ▆█▃▁▁▂▁▁▁▁
  1000 labels last color-only engine publication                              ├●──┤                -0.5%   .721  ▃█▄▃▂▂▁▁▁▁ ▂█▄▃▂▂▂▁▁▁
  1000 labels 100 edits interleaved edit-read publication                     ├●                   -0.5%   .442  ▂█▄▁▁▂▁▁▂▁ ▂█▅▁▁▁▁▁▁▁
  unchanged end-to-end setter and p…tion with 8192 paint spans                ├●┤                  -0.5%   .721  ▃▃▂▇█▃▂▁▁▁ ▂▄▂█▇▃▃▁▁▁
  10 labels first length-changing engine publication                          ├●┤                  -0.6%   .798  ▁▆█▄▂▂▁▁▁▁ ▁▇█▅▃▂▁▁▁▁
  100 labels first same-length engine publication                             ├●┤                  -0.6%   .721  ▁▇█▅▂▁▁▁▁▁ ▁█▇▄▂▂▁▁▁▁
  1000 labels first same-length engine publication                            ├●┤                  -0.6%   .721  ▃█▇▆▅▄▃▂▁▁ ▂█▇▆▄▃▂▁▁▁
  1000 labels separated unbalanced…nk-space scene publication                 ├●                   -0.6%   .382  ▂▅▅█▅▄▂▂▁▁ ▂▆▇█▅▅▂▂▁▁
  scattered end-to-end setter and p…tion with 8192 paint spans                ├●                   -0.6%   .279  ▂▆█▅▃▂▁▂▁▁ ▃██▅▂▂▁▁▂▁
  100 labels interleaved edit-read publication                                ├●                   -0.7%   .083  ▅█▂▁▁▁▂▄▃▂ ▃█▄▂▁▁▁▁▁▁
  1000 labels separated balanced gr…nk-space scene publication                ├●                   -0.7%   .442  ▁▇█▇▄▃▁▁▁▁ ▂▆█▅▄▃▁▁▁▁
  measurement after width change                                              ├●                   -0.7%   .279  ▁▁▁▁▃█▃▁▂▁ ▁▁▁▂▄█▃▂▂▁
  1000 labels first set+measure                                             ├──●──┤                -0.8%   .505  ▁▅█▅▃▂▂▁▁▁ ▂▇█▆▄▂▃▂▂▁
  100 labels 100 edits immediate me…ements without publication                ├●                   -0.9%   .279  ▁▃█▄▃▂▁▁▁▁ ▁▇█▅▃▂▁▁▁▁
  read every outline from an unchanged copy                                   ├●                   -0.9%   .069  ▁█▃▁▁▁▁▁▁▁ ▅█▂▁▁▁▂▁▁▁
  borrow per-glyph metrics from 100 promoted labels                           ├●┤                  -1.0%   .505  ▁▁▁▁▂▃█▂▁▁ ▁▁▁▁▂▄█▂▁▁
  100 labels first color-only engine publication                              ●┤                   -1.1%   .328  ▂█▅▃▂▁▁▁▁▁ ▂█▅▃▂▁▁▁▁▁
  1000 labels last length-changing scene publication                          ●┤                   -1.1%   .234  ▁▄█▆▄▃▂▁▁▁ ▂██▇▄▃▂▂▁▁
  10 labels last same-length engine publication                              ├●┼─┤                 -1.2%   .798  ▂██▄▂▂▂▁▁▁ ▁██▄▂▁▁▂▁▁
  mount a label and publish its first edit                                    ●┤                   -1.2%   .083  ▄█▆▄▂▂▂▁▂▁ ▂█▅▃▂▁▁▂▁▁
  edit and independently copy one label among 1000 labels                     ●┼┤                  -1.2%   .442  ▂█▆▅▃▂▄▂▂▁ ▁█▅▄▃▂▂▂▂▁
  measurement then publication after width change                             ●┤                   -1.2%   .003  ▁▂▁▂█▆▂▂▂▁ ▁▁▁▃█▄▂▂▂▁
  100 labels last color-only engine publication                             ├─●┼──┤                -1.3%   .505  ▂█▅▂▂▂▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
  copy per-glyph metrics with outlines after text change                      ●┤                   -1.3%   .195  ▂▇▂▂▁▂█▇▂▁ ▂▄▁▁▁▁█▃▂▁
  1000 labels first set                                                    ├──●┼┤                  -1.4%   .223  ▂▇██▄▃▃▂▂▁ ▂██▆▃▃▂▁▁▁
  10 labels first color-only scene publication                               ├●┼─┤                 -1.6%   .442  ▃█▄▂▁▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
  10 labels last same-length scene publication                               ├●┼┤                  -1.7%   .130  ▂██▅▂▂▁▁▁▁ ▁▇█▄▂▂▁▁▁▁
  1000 labels 100 edits immediate m…ements without publication                ●┤                   -1.8%   .038  ▁▄█▇▄▃▂▂▂▁ ▁▆█▅▄▂▂▂▁▁
  normalize 1000 equivalent formatted flow updates                            ●┼┤                  -1.8%   .442  ▁▃▅▅█▆▅▃▂▁ ▁▄▄▆█▅▄▃▁▁
  per-glyph inspection after width change                                     ●┤                   -1.8%  <.001  ▁▁▁▃█▄▇▁▃▇ ▂▁▁█▇▅█▁▇▆
  publication after width change                                              ●┼┤                  -1.8%   .130  ▂█▄▁▁▁▁▁▁▁ ▃█▃▂▁▁▂▁▁▁
  10 labels last color-only scene publication                               ├─●┼┤                  -1.9%   .234  ▄█▂▂▁▁▁▁▁▁ ▅█▂▁▁▁▁▁▁▁
  100 labels separated balanced gro…k-space engine publication             ├──●┤                   -1.9%   .038  ▁▃█▇▄▃▃▂▂▁ ▁▅█▆▃▃▂▁▁▁
  100 labels first same-length scene publication                           ├──●┼┤                  -2.1%   .279  █▇▂▁▁▁▁▁▁▁ █▅▁▁▁▁▁▁▁▁
  1000 labels first length-changing scene publication                        ├●┤                   -2.1%   .007  ▅█▁▁▁▁▁▁▁▁ █▆▁▁▁▁▁▁▁▁
  10 labels first color-only engine publication                             ├─●┼──┤                -2.2%   .442  ▂█▅▂▂▁▁▁▁▁ ▂█▄▂▂▁▁▁▁▁
  100 labels last same-length engine publication                             ├●┼┤                  -2.2%   .382  ▂█▇▅▂▂▁▁▁▁ ▂█▇▄▂▂▂▂▁▁
  100 labels separated unbalanced g…k-space engine publication               ├●┼┤                  -2.3%   .130  ▁▄█▇▄▄▂▂▁▁ ▁▅█▆▄▃▃▂▂▁
  100 labels first length-changing scene publication                     ├────●┼┤                  -2.4%   .279  ▂██▄▃▃▂▁▁▁ ▃█▇▄▃▂▂▁▁▁
  100 labels last same-length scene publication                             ├─●┤                   -3.0%   .195  ▁▇█▅▃▂▁▂▁▁ ▂▇█▃▂▁▁▁▁▁
  1000 labels first same-value-set                                          ├─●┼──┤                -3.0%   .340  ▄█▂▁▁▁▂▂▁▁ ▄█▂▁▁▁▂▂▂▁
  common-safe word-wrap reflow                                             ├─●─┤                   -3.1%   .015  ▂█▄▂▁▁▁▁▁▁ ▄█▃▂▁▁▁▁▁▁
  10 labels last color-only engine publication                             ├─●─┤                   -3.3%   .038  ▂█▅▃▂▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
  100 labels first set+measure                                           ├───●─┼──────┤            -3.3%   .878  ▁▃▇█▅▂▂▁▁▁ ▂▇█▅▄▅▃▂▁▁
  reflow after width change                                                 ├●┤┊                   -3.5%   .010  ▁█▄▂▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
  measure 100 unchanged labels                                            ├──●─┼──┤                -3.5%   .342  ▂█▃▁▁▁▁▁▁▁ ▂█▃▁▁▁▁▁▁▁
  edit and independently copy one label among 1 labels                       ●┤┊                   -3.7%  <.001  ▁▇█▅▂▁▂▁▁▁ ▂█▆▂▂▁▁▁▁▁
  100 labels no-op scene traversal                                         ├─●─┼┤                  -3.8%   .279  ▂█▅▃▂▁▂▂▁▁ ▃█▄▂▁▁▁▁▁▁
  100 labels first set+measure+scene-publication                            ├●─┼────┤              -4.2%   .721  ▁▄█▅▃▂▂▁▁▁ ▁▇█▅▄▃▂▁▁▁
  100 labels first overwrite-before-scene-publication                      ├─●─┼─┤                 -4.2%   .130  ▁▄█▅▃▂▁▂▁▁ ▂█▇▅▃▂▂▁▁▁
  cached per-glyph inspection                                               ├●┤┊                   -4.8%  <.001  ▂█▇▃▂▂▁▁▁▁ ▄█▃▁▁▁▁▁▁▁
  1 labels first overwrite-before-scene-publication                       ├─●──┼┤                  -6.6%   .161  █▂▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
  1 labels first set+measure+scene-publication                            ├─●──┼─────┤             -6.8%   .291  ▄█▁▁▁▁▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
  1 labels first set+measure                                          ├──●─────┼┤                 -11.8%   .130  ▁▅█▇▄▂▁▁▁▁ ▂█▆▃▂▂▁▁▁▁
  100 labels first same-value-set                               ├────●─────────┼───┤              -20.1%   .088  ▃█▂▁▁▁▁▁▁▁ ██▂▁▁▁▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -30%           0           +30%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | publish after text change | 1.94ms | 2.07ms | +0.130ms | +6.3% | .002 | +5.4..+7.2% |
| 🔴 slower | borrow glyphs from 1000 steadily promoted retained labels | 1.05ms | 1.11ms | +0.060ms | +5.7% | .028 | +1.2..+13.2% |
| 🔴 slower | publication after text change | 6.91ms | 7.28ms | +0.370ms | +5.4% | <.001 | +4.7..+6.2% |
| 🔴 slower | publish 1024 retained Text instances | 18.17ms | 19.06ms | +0.890ms | +4.9% | <.001 | +3.5..+9.1% |
| 🟢 faster | edit and independently copy one label among 100 labels | 990.73µs | 939.46µs | -0.051ms | -5.2% | .007 | -6.7..-2.8% |
| 🟢 faster | 100 labels first color-only scene publication | 306.85µs | 288.60µs | -0.018ms | -5.9% | .002 | -18.2..-2.6% |
| 🟢 faster | 100 labels first set | 110.85µs | 100.79µs | -0.010ms | -9.1% | .050 | -17.9..-0.2% |
| 🟢 faster | 1 labels first same-value-set | 2.67µs | 2.31µs | -0.000360ms | -13.3% | .016 | -16.9..-1.8% |
| 🟢 faster | 1 labels first set | 107.04µs | 90.35µs | -0.017ms | -15.6% | .038 | -20.4..-1.3% |

<details><summary>136 neutral, 0 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | normalize 1000 equivalent retained label updates | 2.23ms | 2.23ms | 0.000ms | 0.0% | .959 | -1.5..+0.9% |
| neutral | mutate one trailing span across 1000 formatted labels | 36.32ms | 37.34ms | +1.020ms | +2.8% | <.001 | +1.4..+3.9% |
| neutral | edit and measure one of 100 retained labels | 108.46µs | 109.56µs | +0.001ms | +1.0% | .900 | -11.1..+5.6% |
| neutral | rewrite 64 labels in one group | 1.34ms | 1.38ms | +0.040ms | +2.6% | .002 | +1.3..+3.8% |
| neutral | rewrite 128 labels in one group | 2.35ms | 2.41ms | +0.060ms | +2.5% | .065 | -0.2..+4.3% |
| neutral | rewrite 256 labels in one group | 4.41ms | 4.51ms | +0.100ms | +2.1% | .130 | -4.7..+3.7% |
| neutral | rewrite 512 labels in one group | 9.28ms | 9.51ms | +0.230ms | +2.5% | .015 | +0.5..+3.8% |
| neutral | 10 labels no-op scene traversal | 29.06µs | 29.52µs | +0.000460ms | +1.6% | .234 | -2.1..+6.1% |
| neutral | 10 labels first same-length scene publication | 369.10µs | 367.92µs | -0.001ms | -0.3% | .721 | -3.0..+4.9% |
| neutral | 10 labels first length-changing scene publication | 474.69µs | 473.94µs | -0.000750ms | -0.2% | .878 | -3.7..+3.2% |
| neutral | 10 labels first color-only scene publication | 257.60µs | 253.42µs | -0.004ms | -1.6% | .442 | -4.2..+3.5% |
| neutral | 10 labels first same-length engine publication | 348.31µs | 346.92µs | -0.001ms | -0.4% | .959 | -5.4..+2.8% |
| neutral | 10 labels first length-changing engine publication | 461.40µs | 458.50µs | -0.003ms | -0.6% | .798 | -2.1..+1.9% |
| neutral | 10 labels first color-only engine publication | 237.88µs | 232.69µs | -0.005ms | -2.2% | .442 | -6.5..+5.3% |
| neutral | 10 labels last same-length scene publication | 365.54µs | 359.31µs | -0.006ms | -1.7% | .130 | -3.2..+1.1% |
| neutral | 10 labels last length-changing scene publication | 462.65µs | 463.98µs | +0.001ms | +0.3% | .574 | -4.3..+3.9% |
| neutral | 10 labels last color-only scene publication | 251.38µs | 246.65µs | -0.005ms | -1.9% | .234 | -7.0..+2.5% |
| neutral | 10 labels last same-length engine publication | 352.33µs | 348.06µs | -0.004ms | -1.2% | .798 | -4.4..+3.6% |
| neutral | 10 labels last length-changing engine publication | 452.35µs | 469.71µs | +0.017ms | +3.8% | .130 | -0.2..+10.2% |
| neutral | 10 labels last color-only engine publication | 231.54µs | 223.83µs | -0.008ms | -3.3% | .038 | -7.7..-0.4% |
| neutral | 100 labels no-op scene traversal | 62.60µs | 60.25µs | -0.002ms | -3.8% | .279 | -8.8..+2.9% |
| neutral | 100 labels first same-length scene publication | 480.38µs | 470.40µs | -0.010ms | -2.1% | .279 | -8.1..+1.7% |
| neutral | 100 labels first length-changing scene publication | 675.02µs | 658.88µs | -0.016ms | -2.4% | .279 | -12.0..+1.5% |
| neutral | 100 labels first same-length engine publication | 430.50µs | 428.04µs | -0.002ms | -0.6% | .721 | -2.9..+1.7% |
| neutral | 100 labels first length-changing engine publication | 609.38µs | 609.67µs | +0.000290ms | 0.0% | .878 | -4.6..+1.3% |
| neutral | 100 labels first color-only engine publication | 249.56µs | 246.90µs | -0.003ms | -1.1% | .328 | -2.8..+0.8% |
| neutral | 100 labels last same-length scene publication | 480.71µs | 466.08µs | -0.015ms | -3.0% | .195 | -6.7..+0.4% |
| neutral | 100 labels last length-changing scene publication | 597.60µs | 596.77µs | -0.000830ms | -0.1% | .878 | -2.5..+4.0% |
| neutral | 100 labels last color-only scene publication | 294.69µs | 295.06µs | +0.000370ms | +0.1% | 1.000 | -6.0..+2.3% |
| neutral | 100 labels last same-length engine publication | 430.81µs | 421.38µs | -0.009ms | -2.2% | .382 | -3.8..+1.8% |
| neutral | 100 labels last length-changing engine publication | 549.40µs | 556.85µs | +0.007ms | +1.4% | .959 | -7.0..+3.6% |
| neutral | 100 labels last color-only engine publication | 249.29µs | 246.10µs | -0.003ms | -1.3% | .505 | -6.1..+5.5% |
| neutral | 1000 labels no-op scene traversal | 387.27µs | 389.29µs | +0.002ms | +0.5% | .878 | -6.0..+2.6% |
| neutral | 1000 labels first same-length scene publication | 1.63ms | 1.63ms | 0.000ms | -0.1% | .959 | -2.1..+1.9% |
| neutral | 1000 labels first length-changing scene publication | 2.42ms | 2.37ms | -0.050ms | -2.1% | .007 | -3.6..-0.8% |
| neutral | 1000 labels first color-only scene publication | 767.75µs | 774.48µs | +0.007ms | +0.9% | .234 | -0.5..+4.6% |
| neutral | 1000 labels first same-length engine publication | 1.40ms | 1.39ms | -0.010ms | -0.6% | .721 | -2.7..+1.7% |
| neutral | 1000 labels first length-changing engine publication | 2.12ms | 2.12ms | 0.000ms | -0.1% | .959 | -1.7..+1.8% |
| neutral | 1000 labels first color-only engine publication | 478.46µs | 486.42µs | +0.008ms | +1.7% | .798 | -5.5..+5.8% |
| neutral | 1000 labels last same-length scene publication | 1.62ms | 1.62ms | 0.000ms | -0.1% | .878 | -3.5..+1.6% |
| neutral | 1000 labels last length-changing scene publication | 1.91ms | 1.89ms | -0.020ms | -1.1% | .234 | -2.7..+0.7% |
| neutral | 1000 labels last color-only scene publication | 756.71µs | 755.19µs | -0.002ms | -0.2% | .959 | -3.9..+4.9% |
| neutral | 1000 labels last same-length engine publication | 1.39ms | 1.41ms | +0.020ms | +1.8% | .130 | -0.9..+4.6% |
| neutral | 1000 labels last length-changing engine publication | 1.66ms | 1.67ms | +0.010ms | +1.0% | .328 | -1.0..+8.0% |
| neutral | 1000 labels last color-only engine publication | 473.23µs | 471.06µs | -0.002ms | -0.5% | .721 | -2.6..+5.8% |
| neutral | 100 labels 100 edits immediate measurements without publication | 1.92ms | 1.90ms | -0.020ms | -0.9% | .279 | -2.9..+0.3% |
| neutral | 100 labels 100 edits immediate measurements with publication | 6.19ms | 6.18ms | -0.010ms | -0.2% | .959 | -1.1..+1.4% |
| neutral | 100 labels batched edit-read publication | 4.46ms | 4.48ms | +0.020ms | +0.4% | .878 | -1.7..+1.8% |
| neutral | 100 labels interleaved edit-read publication | 10.62ms | 10.55ms | -0.070ms | -0.7% | .083 | -2.1..+0.1% |
| neutral | 1000 labels 100 edits immediate measurements without publication | 2.12ms | 2.08ms | -0.040ms | -1.8% | .038 | -2.7..-0.1% |
| neutral | 1000 labels 100 edits immediate measurements with publication | 18.23ms | 18.22ms | -0.010ms | -0.1% | .721 | -1.1..+0.9% |
| neutral | 1000 labels 100 edits batched edit-read publication | 6.69ms | 6.68ms | -0.010ms | -0.1% | .505 | -2.0..+0.5% |
| neutral | 1000 labels 100 edits interleaved edit-read publication | 45.82ms | 45.61ms | -0.210ms | -0.5% | .442 | -1.9..+0.8% |
| neutral | 100 labels separated balanced grow-shrink-space engine publication | 742.38µs | 728.02µs | -0.014ms | -1.9% | .038 | -8.1..-0.1% |
| neutral | 100 labels separated balanced grow-shrink-space scene publication | 775.21µs | 777.85µs | +0.003ms | +0.3% | .574 | -1.3..+2.2% |
| neutral | 100 labels separated unbalanced grow-shrink-space engine publication | 728.35µs | 711.65µs | -0.017ms | -2.3% | .130 | -3.4..+1.2% |
| neutral | 100 labels separated unbalanced grow-shrink-space scene publication | 765.56µs | 771.46µs | +0.006ms | +0.8% | .798 | -2.0..+2.0% |
| neutral | 1000 labels separated balanced grow-shrink-space engine publication | 2.73ms | 2.73ms | 0.000ms | -0.2% | .959 | -1.7..+1.1% |
| neutral | 1000 labels separated balanced grow-shrink-space scene publication | 3.00ms | 2.98ms | -0.020ms | -0.7% | .442 | -1.8..+0.8% |
| neutral | 1000 labels separated unbalanced grow-shrink-space engine publication | 2.77ms | 2.80ms | +0.030ms | +1.1% | .878 | -1.5..+1.9% |
| neutral | 1000 labels separated unbalanced grow-shrink-space scene publication | 3.05ms | 3.03ms | -0.020ms | -0.6% | .382 | -1.4..+0.5% |
| neutral | mount and publish a 22k-glyph paragraph | 19.92ms | 19.97ms | +0.050ms | +0.3% | .382 | -0.3..+0.8% |
| neutral | mount a label and publish its first edit | 2.30ms | 2.27ms | -0.030ms | -1.2% | .083 | -2.3..+0.2% |
| neutral | mount 100 labels and borrow glyphs from each once | 11.14ms | 11.17ms | +0.030ms | +0.3% | .798 | -1.6..+1.1% |
| neutral | measure after text change | 1.61ms | 1.61ms | 0.000ms | +0.2% | .130 | -0.1..+1.6% |
| neutral | reflow after width change | 359.52µs | 346.77µs | -0.013ms | -3.5% | .010 | -5.7..-1.3% |
| neutral | publish after color change | 1.38ms | 1.38ms | 0.000ms | -0.4% | .195 | -1.1..+0.2% |
| neutral | relayout after font-size change | 2.03ms | 2.11ms | +0.080ms | +3.7% | <.001 | +2.9..+4.3% |
| neutral | measure 100 unchanged labels | 19.23µs | 18.56µs | -0.000670ms | -3.5% | .342 | -9.8..+5.2% |
| neutral | type one character into a long paragraph and measure | 1.70ms | 1.71ms | +0.010ms | +0.9% | .028 | +0.2..+3.1% |
| neutral | type one character into a long Fredoka paragraph and measure | 2.03ms | 2.02ms | -0.010ms | -0.3% | .328 | -1.6..+0.5% |
| neutral | type one character into a long paragraph and publish a frame | 2.81ms | 2.83ms | +0.020ms | +0.5% | .574 | -0.7..+1.4% |
| neutral | reuse 1000 unchanged Vue property snapshots | 189.77µs | 189.23µs | -0.000540ms | -0.3% | .878 | -1.2..+1.3% |
| neutral | normalize 1000 equivalent formatted flow updates | 4.87ms | 4.78ms | -0.090ms | -1.8% | .442 | -2.6..+1.3% |
| neutral | bind and normalize 1000 framework-shaped formatted flow updates | 4.94ms | 4.94ms | 0.000ms | 0.0% | .878 | -1.9..+0.7% |
| neutral | copy per-glyph metrics after text change | 3.09ms | 3.09ms | 0.000ms | +0.2% | .505 | -0.4..+2.1% |
| neutral | copy per-glyph metrics from 100 unchanged labels | 175.85µs | 176.73µs | +0.000880ms | +0.5% | .938 | -2.4..+2.2% |
| neutral | edit and independently copy one label among 1 labels | 871.85µs | 839.33µs | -0.033ms | -3.7% | <.001 | -4.7..-2.9% |
| neutral | edit and independently copy one label among 1000 labels | 1.84ms | 1.82ms | -0.020ms | -1.2% | .442 | -2.7..+1.7% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 226.08µs | 223.79µs | -0.002ms | -1.0% | .505 | -2.4..+1.1% |
| neutral | cached measurement | 4.69µs | 4.69µs | 0.000ms | 0.0% | .900 | -6.1..+9.4% |
| neutral | measurement after width change | 1.19ms | 1.18ms | -0.010ms | -0.7% | .279 | -1.4..+0.7% |
| neutral | measurement then publication after width change | 1.41ms | 1.39ms | -0.020ms | -1.2% | .003 | -2.7..-0.5% |
| neutral | cached per-glyph inspection | 70.69µs | 67.29µs | -0.003ms | -4.8% | <.001 | -6.9..-2.4% |
| neutral | per-glyph inspection after width change | 4.45ms | 4.37ms | -0.080ms | -1.8% | <.001 | -2.3..-0.9% |
| neutral | inspection then publication after width change | 4.69ms | 4.70ms | +0.010ms | +0.3% | .878 | -1.6..+1.5% |
| neutral | publication after font-size change | 7.68ms | 7.90ms | +0.220ms | +2.8% | <.001 | +2.5..+3.8% |
| neutral | publication after width change | 703.52µs | 690.90µs | -0.013ms | -1.8% | .130 | -2.6..+2.5% |
| neutral | copy per-glyph metrics with outlines after text change | 3.13ms | 3.09ms | -0.040ms | -1.3% | .195 | -2.6..+0.1% |
| neutral | read every outline from an unchanged copy | 876.21µs | 868.69µs | -0.008ms | -0.9% | .069 | -2.7..+0.0% |
| neutral | 1 labels first set+measure | 129.00µs | 113.83µs | -0.015ms | -11.8% | .130 | -17.4..+1.8% |
| neutral | 1 labels first set+measure+scene-publication | 383.75µs | 357.83µs | -0.026ms | -6.8% | .291 | -9.1..+11.6% |
| neutral | 1 labels first overwrite-before-scene-publication | 388.98µs | 363.25µs | -0.026ms | -6.6% | .161 | -10.1..+1.8% |
| neutral | 100 labels first set+measure | 131.77µs | 127.38µs | -0.004ms | -3.3% | .878 | -13.0..+13.7% |
| neutral | 100 labels first set+measure+scene-publication | 517.46µs | 495.77µs | -0.022ms | -4.2% | .721 | -6.7..+9.1% |
| neutral | 100 labels first same-value-set | 3.52µs | 2.81µs | -0.000710ms | -20.1% | .088 | -29.9..+7.2% |
| neutral | 100 labels first overwrite-before-scene-publication | 521.96µs | 499.79µs | -0.022ms | -4.2% | .130 | -7.9..+4.2% |
| neutral | 1000 labels first set | 128.77µs | 127.00µs | -0.002ms | -1.4% | .223 | -8.2..+1.7% |
| neutral | 1000 labels first set+measure | 150.88µs | 149.67µs | -0.001ms | -0.8% | .505 | -5.2..+6.6% |
| neutral | 1000 labels first set+measure+scene-publication | 1.65ms | 1.70ms | +0.050ms | +3.3% | .195 | -1.4..+5.3% |
| neutral | 1000 labels first same-value-set | 4.92µs | 4.77µs | -0.000150ms | -3.0% | .340 | -5.1..+5.8% |
| neutral | 1000 labels first overwrite-before-scene-publication | 1.63ms | 1.67ms | +0.040ms | +2.0% | .005 | +1.0..+5.4% |
| neutral | write one paragraph and text mutation | 7.50µs | 8.12µs | +0.000620ms | +8.3% | .195 | -7.5..+24.2% |
| neutral | write 1000 paragraph-order mutations | 12.31µs | 12.52µs | +0.000210ms | +1.7% | .185 | -0.7..+6.6% |
| neutral | write 1000 paragraph and text mutations | 71.10µs | 72.85µs | +0.002ms | +2.5% | .011 | +0.5..+4.8% |
| neutral | write 22k UTF16 text into Wasm request arena | 37.13µs | 37.19µs | +0.000060ms | +0.2% | .959 | -1.9..+4.3% |
| neutral | write 22k UTF16 text into owned array control | 37.25µs | 39.40µs | +0.002ms | +5.8% | .266 | -1.0..+12.5% |
| neutral | unchanged setter preparation in one large paragraph with 8192 paint spans | 2.69ms | 2.68ms | -0.010ms | -0.3% | .878 | -0.9..+2.5% |
| neutral | unchanged end-to-end setter and publication with 8192 paint spans | 2.74ms | 2.72ms | -0.020ms | -0.5% | .721 | -1.7..+1.6% |
| neutral | scattered setter preparation in one large paragraph with 8192 paint spans | 12.71ms | 12.82ms | +0.110ms | +0.8% | .195 | -0.5..+1.4% |
| neutral | scattered end-to-end setter and publication with 8192 paint spans | 14.69ms | 14.60ms | -0.090ms | -0.6% | .279 | -1.2..+0.3% |
| neutral | broad setter preparation in one large paragraph with 8192 paint spans | 12.27ms | 12.25ms | -0.020ms | -0.2% | .959 | -0.7..+1.4% |
| neutral | broad end-to-end setter and publication with 8192 paint spans | 15.92ms | 16.24ms | +0.320ms | +2.0% | .028 | +0.5..+2.9% |
| neutral | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 2.68ms | 2.67ms | -0.010ms | -0.1% | .878 | -1.2..+1.2% |
| neutral | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 2.72ms | 2.74ms | +0.020ms | +0.6% | .279 | -1.2..+1.7% |
| neutral | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 9.98ms | 10.09ms | +0.110ms | +1.1% | .021 | +0.2..+2.2% |
| neutral | monospaced scattered end-to-end setter and publication with 8192 paint spans | 11.47ms | 11.48ms | +0.010ms | 0.0% | .959 | -1.0..+1.2% |
| neutral | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 12.86ms | 12.91ms | +0.050ms | +0.3% | .398 | -0.4..+1.3% |
| neutral | monospaced broad end-to-end setter and publication with 8192 paint spans | 16.57ms | 16.87ms | +0.300ms | +1.8% | .010 | +0.7..+2.3% |
| neutral | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 13.86ms | 13.91ms | +0.050ms | +0.3% | .161 | -0.3..+1.8% |
| neutral | shared-material scattered end-to-end setter and publication with 8192 paint spans | 15.25ms | 15.21ms | -0.040ms | -0.3% | .328 | -1.0..+0.4% |
| neutral | split move and merge paint boundaries preparation only | 4.60ms | 4.59ms | -0.010ms | -0.2% | .878 | -1.1..+1.0% |
| neutral | split move and merge paint boundaries publication | 5.91ms | 6.04ms | +0.130ms | +2.3% | .010 | +1.4..+2.8% |
| neutral | toggle one group containing 1000 retained labels | 425.69µs | 427.52µs | +0.002ms | +0.4% | .959 | -5.6..+3.2% |
| neutral | reorder 1000 unchanged retained labels | 2.17ms | 2.20ms | +0.030ms | +1.2% | .234 | -1.4..+3.4% |
| neutral | reorder then edit one of 1000 retained labels | 5.45ms | 5.47ms | +0.020ms | +0.3% | .161 | -0.2..+5.1% |
| neutral | measure 1000 unchanged retained labels | 218.73µs | 221.94µs | +0.003ms | +1.5% | .721 | -10.4..+7.8% |
| neutral | edit and measure one of 1000 retained labels | 141.17µs | 146.13µs | +0.005ms | +3.5% | .083 | -0.3..+5.9% |
| neutral | edit and sparsely borrow one of 1000 retained labels | 173.31µs | 172.92µs | -0.000390ms | -0.2% | .798 | -1.4..+4.2% |
| neutral | move 1000 retained TypeGPU labels | 256.29µs | 255.98µs | -0.000310ms | -0.1% | 1.000 | -5.7..+4.3% |
| neutral | common-safe word-wrap reflow | 161.81µs | 156.88µs | -0.005ms | -3.1% | .015 | -8.5..-0.9% |
| neutral | issue 216 reporter workaround | 169.25µs | 175.35µs | +0.006ms | +3.6% | .105 | -0.6..+6.3% |
| neutral | issue 216 unsafe-boundary word-wrap reflow | 173.67µs | 179.25µs | +0.006ms | +3.2% | .083 | -0.2..+6.3% |
| neutral | long reporter workaround paragraph reflow | 584.54µs | 587.98µs | +0.003ms | +0.6% | .721 | -0.8..+1.3% |
| neutral | long unsafe-boundary paragraph reflow | 629.65µs | 641.40µs | +0.012ms | +1.9% | .065 | -0.3..+2.8% |
| neutral | long unsafe-boundary paragraph text edit | 1.73ms | 1.74ms | +0.010ms | +0.3% | .505 | -0.5..+1.3% |

</details>
