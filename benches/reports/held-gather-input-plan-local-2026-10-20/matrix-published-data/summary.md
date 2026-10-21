Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

103 faster · 23 slower · 15 neutral · 2 skipped

Baseline `0.1.0 (6e2bf7bd)` → candidate `0.1.0 (9b1ad97a)`

Latency distribution across 141 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 1.510ms | 0.848ms |
| Workloads ≤1 ms | 66 | 72 |
| Workloads ≤2 ms | 76 | 91 |
| Workloads ≤3 ms | 88 | 108 |
| Workloads >3 ms | 53 | 33 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 174.76ms | 45.06ms | -129.700ms |
| mutate one trailing span across 1000 formatted labels | 57.58ms | 36.34ms | -21.240ms |
| mount and publish a 22k-glyph paragraph | 18.56ms | 19.96ms | +1.400ms |
| 1000 labels 100 edits immediate measurements with publication | 152.47ms | 18.23ms | -134.240ms |
| publish 1024 retained Text instances | 15.35ms | 18.09ms | +2.740ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 1 labels first set                                                           ┊              ▶  +1476.9%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁█▄▂▂▂▁
- 100 labels first set                                                         ┊              ▶  +1214.7%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁█▃▂▁▁
- 1000 labels first set                                                        ┊              ▶  +617.7%  <.001  █▅▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁█▇▃▁
- copy per-glyph metrics from 100 unchanged labels                             ┊              ▶   +84.4%  <.001  █▆▂▁▁▁▁▁▁▁ ▁▁▁▁▃█▂▁▁▁
- 100 labels first overwrite-before-scene-publication                          ┊         ●┤       +34.4%  <.001  ▃█▃▂▁▁▁▁▁▁ ▁▁▂█▅▂▂▁▁▁
- 1 labels first overwrite-before-scene-publication                            ┊         ●┤       +34.1%  <.001  ▄█▄▂▁▁▁▁▁▁ ▁▁▂█▆▄▂▂▁▁
- measurement after width change                                               ┊       ●          +27.2%  <.001  ▁▂▃▂█▄▂▁▁▁ ▁▁▁▁▁▂█▆▂▁
- rewrite 512 labels in one group                                              ┊      ├●          +25.5%  <.001  ▄█▅▂▁▁▁▁▁▁ ▁▁▁▅▄▇█▄▁▂
- type one character into a long Fredoka paragraph and measure                 ┊      ├●          +25.0%  <.001  █▂▁▁▁▁█▁▁▁ ▁▁▁▁▁▁▁█▃▁
- 10 labels no-op scene traversal                                              ┊     ●──┤         +20.3%  <.001  █▃▅▂▂▁▁▁▁▁ ▁█▅▃▃▁▁▁▁▁
- cached per-glyph inspection                                                  ┊    ●┤            +18.1%  <.001  ▆█▂▁▁▁▁▁▁▁ ▁▃█▂▁▁▁▁▁▁
- publish 1024 retained Text instances                                         ┊    ●┤            +17.8%  <.001  ▄█▇▂▁▁▁▁▁▁ ▁▁▁▁█▆▂▂▇▃
- rewrite 256 labels in one group                                              ┊   ├●┤            +16.0%  <.001  ▃█▄▂▂▁▁▁▁▁ ▁▁▃█▅▄▃▂▁▁
- publication after font-size change                                           ┊   ├●             +15.0%  <.001  ▃█▄▂▁▁▁▁▁▁ ▁▁▁▁█▃▆▇▂▂
- rewrite 128 labels in one group                                              ┊  ●┤              +10.7%  <.001  ▃█▃▂▂▁▁▁▁▁ ▁▃█▄▂▂▁▁▁▁
- long unsafe-boundary paragraph reflow                                        ┊ ├●─┤             +10.7%   .010  ▄█▃▁▁▁▁▁▁▁ ▁█▄▂▁▁▁▁▁▁
- measure 1000 unchanged retained labels                                       ┊├─●──┤             +9.4%   .005  ▂▆█▅▃▁▁▁▁▁ ▁▂▇█▇▅▃▂▁▁
- 100 labels no-op scene traversal                                             ┊ ├●┤               +9.0%   .003  ▃█▃▂▁▁▁▁▁▁ ▁█▅▄▂▁▁▁▁▁
- toggle one group containing 1000 retained labels                             ┊├●─┤               +8.1%   .010  ▄█▇▅▃▁▁▁▁▁ ▁▃█▇▃▂▁▁▁▁
- 1000 labels no-op scene traversal                                            ┊├●┤                +7.7%   .021  ▂█▆▃▅▄▂▁▁▁ ▁▃▇█▄▂▁▁▁▁
- mount and publish a 22k-glyph paragraph                                      ┊ ●┤                +7.5%  <.001  ▃█▄▄▂▂▁▁▁▁ ▁▁▁▁▇█▇▅▅▂
- 10 labels first length-changing scene publication                            ┊├●                 +5.5%  <.001  ▂█▅▄▂▂▁▁▁▁ ▁▅█▅▂▂▁▁▁▁
- 10 labels last length-changing engine publication                            ┊├●                 +5.0%   .010  ▁█▇▄▃▂▂▁▁▁ ▁▃█▅▃▂▂▁▁▁
+ 100 labels separated balanced gro…nk-space scene publication               ●┤┊                   -5.1%  <.001  ▁▂█▄▂▁▁▁▁▁ ▂█▆▃▂▁▁▁▁▁
+ mount 100 labels and borrow glyphs from each once                          ●┤┊                   -5.3%  <.001  ▁▁▁▆█▅▃▂▂▁ ▂██▆▅▂▃▂▂▁
+ 100 labels separated unbalanced g…k-space engine publication               ●┤┊                   -5.7%  <.001  ▁▁▅█▅▂▂▂▁▁ ▂▇█▄▃▃▂▁▁▁
+ publish after text change                                                  ●┤┊                   -6.2%  <.001  ▁▁█▆▃▁▂▂▁▁ ▃█▄▂▁▁▁▁▁▁
+ 100 labels separated balanced gro…k-space engine publication               ●┤┊                   -6.3%  <.001  ▁▁▄█▅▃▂▁▁▁ ▁▅█▆▄▂▂▂▁▁
+ 1000 labels first overwrite-before-scene-publication                      ├● ┊                   -6.9%  <.001  ▁▁▆█▆▅▃▃▂▁ ▃█▄▅▃▃▂▁▁▁
+ issue 216 unsafe-boundary word-wrap reflow                                ●─┤┊                   -8.6%  <.001  ▁█▇▂▂▁▁▁▁▁ ▂█▃▁▁▁▁▁▁▁
+ publish after color change                                                ●  ┊                   -9.1%  <.001  ▁▁▄█▃▂▁▁▂▁ ▄█▂▁▁▁▁▁▁▁
+ issue 216 reporter workaround                                            ├●┤ ┊                  -10.3%  <.001  ▁▅█▃▂▁▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
+ 10 labels last same-length engine publication                           ├─●─┤┊                  -10.8%   .010  ▁▃█▆▃▂▁▁▁▁ ▂█▆▃▂▁▂▁▁▁
+ 100 labels last length-changing engine publication                     ├──●┤ ┊                  -10.8%   .010  ▁▃█▆▄▂▂▂▁▁ ▃█▅▂▂▂▁▁▁▁
+ 100 labels last length-changing scene publication                      ├──●  ┊                  -11.0%  <.001  ▁▃█▆▃▂▂▂▁▁ ▃█▅▂▂▂▁▁▁▁
+ 10 labels first same-length scene publication                            ├●  ┊                  -11.4%   .002  ▁▅█▆▃▁▁▁▁▁ ▂█▄▂▂▁▁▁▁▁
+ mount a label and publish its first edit                                 ●─┤ ┊                  -11.7%  <.001  ▁▁▃█▃▃▂▁▁▁ ▃█▆▃▂▂▂▁▁▁
+ 10 labels last same-length scene publication                            ├●┤  ┊                  -13.4%  <.001  ▁▅█▇▄▂▁▁▁▁ ▃█▄▂▁▁▁▁▁▁
+ reorder then edit one of 1000 retained labels                            ●   ┊                  -13.5%  <.001  ▁▁▁▂█▅▃▃▂▁ ▄█▃▂▂▂▁▁▁▁
+ 10 labels first same-length engine publication                          ├●   ┊                  -13.6%  <.001  ▁▃█▆▃▁▂▁▁▁ ▂█▅▃▂▁▁▁▁▁
+ measurement then publication after width change                         ├●   ┊                  -14.4%  <.001  ▁▃▂▁█▆▂▂▁▁ ▁▁▇█▂▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                  ├●┤  ┊                  -14.7%  <.001  ▁▁▁▃█▇▆▄▄▂ ▃█▆▄▄▃▂▁▁▁
+ type one character into a long paragraph and publish a frame            ●    ┊                  -15.9%  <.001  ▁▁▁▁▂█▃▁▂▁ ▃█▃▁▂▂▁▁▁▁
+ common-safe word-wrap reflow                                           ├●┤   ┊                  -16.6%  <.001  ▁█▂▁▂▁▁▁▁▁ █▇▁▂▁▁▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                   ├●┤   ┊                  -17.8%  <.001  ▁▁▅█▂▂▂▁▁▁ ▄█▄▃▂▂▁▁▁▁
+ type one character into a long paragraph and measure                   ●     ┊                  -19.2%  <.001  █▂▁▁▁▁▁▁█▁ ▁▁▁▁▁▁█▂▁▁
+ 100 labels first length-changing engine publication                   ├●     ┊                  -20.8%  <.001  ▁▁▁▇█▃▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 1 labels                  ├●     ┊                  -21.5%  <.001  ▁▁▅█▄▂▂▁▁▁ ▄█▃▁▁▁▁▁▁▁
+ 100 labels first length-changing scene publication                    ●─┤    ┊                  -22.2%  <.001  ▁▁▁█▆▃▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ write 1000 paragraph-order mutations                                 ├●      ┊                  -24.1%  <.001  ▁█▂▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ edit and measure one of 100 retained labels                          ●───┤   ┊                  -25.5%  <.001  ▁▁▅█▆▄▂▂▁▁ ▂█▆▄▂▂▂▁▁▁
+ write 1000 paragraph and text mutations                              ●┤      ┊                  -25.8%  <.001  ▁█▄▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
+ edit and measure one of 1000 retained labels                       ├─●┤      ┊                  -26.4%  <.001  ▁▁▅█▃▃▂▁▁▁ ▅█▃▂▂▁▁▁▁▁
+ 100 labels first same-length scene publication                      ├●┤      ┊                  -26.6%  <.001  ▁▁▁█▇▃▂▂▁▁ ▃█▃▂▂▁▁▁▁▁
+ write 22k UTF16 text into Wasm request arena                         ●┤      ┊                  -26.9%  <.001  ▁█▃▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
+ 100 labels last same-length engine publication                      ├●┤      ┊                  -27.0%  <.001  ▁▁▁█▇▃▂▂▂▁ ▂█▃▁▁▁▁▁▁▁
+ 100 labels batched edit-read publication                             ●       ┊                  -27.1%  <.001  ▁▁▁▁▂▄█▃▂▁ ▂█▃▂▁▁▁▁▁▁
+ 100 labels first same-length engine publication                     ├●┤      ┊                  -27.3%  <.001  ▁▁▁▆█▃▂▁▂▁ ▂█▃▂▁▂▁▁▁▁
+ write 22k UTF16 text into owned array control                        ●       ┊                  -27.5%  <.001  ▁█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels last same-length scene publication                       ├●┤      ┊                  -27.6%  <.001  ▁▁▂█▅▃▂▁▂▁ ▃█▃▁▁▁▁▁▁▁
+ reflow after width change                                          ├●┤       ┊                  -30.6%  <.001  ▁▁▃█▆▂▁▁▂▁ ▆█▃▂▂▁▂▁▁▁
+ 1000 labels 100 edits batched edit-read publication                ├●        ┊                  -31.5%  <.001  ▁▁▁▁▁▁▁██▂ ▃█▄▁▁▁▁▁▁▁
+ 1 labels first set+measure+scene-publication                      ├●┤        ┊                  -33.4%  <.001  ▁▁▁▃█▄▃▂▂▁ ▃█▄▂▁▁▁▁▁▁
+ split move and merge paint boundaries preparation only             ●         ┊                  -33.4%  <.001  ▅▁▁▁▁▁▁▁▂█ ▁▁▁▁▁█▇▁▁▁
+ 100 labels 100 edits immediate me…ements without publication      ├●         ┊                  -34.0%  <.001  ▁▁▁▁▂▇█▄▂▁ ▂█▂▁▂▁▁▁▁▁
+ 100 labels first set+measure+scene-publication                    ├●         ┊                  -34.4%  <.001  ▁▁▁▄█▃▂▁▁▁ ▄█▃▁▁▁▁▁▁▁
+ 1 labels first set+measure                                       ├●┤         ┊                  -35.5%  <.001  ▁▁▆▇█▄▃▂▁▁ ▄█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 100 labels           ├●          ┊                  -36.8%  <.001  ▁▁▁▄█▃▂▁▁▁ ▆█▃▁▁▁▁▁▁▁
+ mutate one trailing span across 1000 formatted labels             ●          ┊                  -36.9%  <.001  ▁▁▁▁▁▁▁█▆▁ ▃█▁▁▁▁▁▁▁▁
+ measure after text change                                         ●          ┊                  -37.7%  <.001  ▁▁▁▁▁▂█▃▂▂ █▄▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication     ├●          ┊                  -38.3%  <.001  ▁▁▁▁▁▁▁█▇▁ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▁▁▁█▅▂ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●┤          ┊                  -38.8%  <.001  ▁▁▁▁▁▁▁▂█▂ ▂█▂▁▁▁▁▁▁▁
+ split move and merge paint boundaries publication                ●┤          ┊                  -39.2%  <.001  ▁▁▁▁▁▁▂▅█▃ ▇█▂▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●           ┊                  -39.5%  <.001  ▁▁▁▁▁▁▁▄█▁ ▅█▂▁▁▁▁▁▁▁
+ 10 labels first color-only engine publication                   ├●─┤         ┊                  -40.1%  <.001  ▁▁▂█▅▂▁▁▁▁ ▅█▃▂▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication              ├●           ┊                  -40.4%  <.001  ▁▁▁▁▁▁█▇▄▁ ▅█▂▁▁▁▁▁▁▁
+ 10 labels first color-only scene publication                     ●┤          ┊                  -40.6%  <.001  ▁▁▄█▄▂▁▁▁▁ ▆█▂▁▁▁▁▁▁▁
+ 10 labels last color-only scene publication                     ├●           ┊                  -41.1%  <.001  ▁▁▂█▄▂▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
+ 10 labels last color-only engine publication                    ├●┤          ┊                  -41.2%  <.001  ▁▁▂█▄▁▁▁▁▁ ▅█▂▂▁▁▁▁▁▁
+ copy per-glyph metrics after text change                        ●┤           ┊                  -42.0%  <.001  ▁▁▁▁▁▇█▂▂▂ ▅▂█▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ●            ┊                  -42.8%  <.001  ▁▁▁▁▁▁█▇▃▂ ▇█▂▁▁▁▁▁▁▁
+ publication after width change                                  ●┤           ┊                  -42.8%  <.001  ▁▁▂▂▂█▆▃▂▁ ██▁▂▁▁▁▁▁▁
+ per-glyph inspection after width change                       ◀─●            ┊                  -44.1%  <.001  ▁▁▁█▁▁▆▂▇▆ ▁▃█▄▆▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●             ┊                  -46.4%  <.001  ▁▁▁▁▁▁▄█▂▁ █▇▂▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                ●             ┊                  -48.0%  <.001  ▁▁▁▁▁▁██▃▂ ▇█▂▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                ●┤             ┊                  -48.9%  <.001  ▁▁▁▁▁▂█▅▂▁ █▇▁▁▁▁▁▁▁▁
+ write one paragraph and text mutation                         ●──┤           ┊                  -49.2%  <.001  ▁▁▇█▂▁▂▁▁▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication               ●              ┊                  -49.3%  <.001  ▁▁▁▁▁▁▁█▃▁ ▇█▂▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ◀              ┊                  -50.8%  <.001  ▁▁▁▁▁▁▂█▃▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -51.5%  <.001  ▁▁▁▁▁▁▁█▅▁ █▆▁▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication               ◀              ┊                  -51.9%  <.001  ▁▁▁▁▁▁▁█▅▂ █▆▂▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication              ◀              ┊                  -52.3%  <.001  ▁▁▁▁▁▁▂█▅▂ ▆█▂▁▁▁▁▁▁▁
+ inspection then publication after width change                ◀              ┊                  -52.4%  <.001  ▁▁▁▁▁▁▄▁█▂ ██▇▄▁▁▁▁▁▁
+ 100 labels first color-only scene publication                 ◀              ┊                  -52.8%  <.001  ▁▁▁▆█▂▁▂▁▁ █▇▃▁▁▁▁▁▁▁
+ 100 labels last color-only scene publication                  ◀              ┊                  -54.8%  <.001  ▁▁▁▃█▃▂▂▂▁ █▆▂▁▁▁▁▁▁▁
+ 100 labels first color-only engine publication                ◀              ┊                  -56.9%  <.001  ▁▁▁▁█▃▂▂▁▁ ██▂▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -57.4%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ 100 labels last color-only engine publication                 ◀              ┊                  -57.6%  <.001  ▁▁▁▁█▃▁▁▁▁ █▆▂▁▁▁▁▁▁▁
+ reuse 1000 unchanged Vue property snapshots                   ◀              ┊                  -58.2%  <.001  ▁▁▁▁▁▁▅█▂▂ █▂▁▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                  ◀              ┊                  -59.5%  <.001  ▁▁▁▁▁▁▁█▃▂ █▂▁▁▁▁▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans  ◀              ┊                  -59.9%  <.001  ▁▁▁▁▁▁▁▁█▄ █▃▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -63.3%  <.001  ▁▁▁▁▁▁▁▂█▃ █▂▁▁▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -63.6%  <.001  ▁▁▁▁▁▁▁▁█▇ █▁▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -65.4%  <.001  ▁▁▁▁▁▁▁▂█▃ █▂▁▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -66.2%  <.001  ▁▁▁▁▁▁▁▃█▅ █▃▁▁▁▁▁▁▁▁
+ edit and independently copy one label among 1000 labels       ◀              ┊                  -67.1%  <.001  ▁▁▁█▂▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans  ◀              ┊                  -67.4%  <.001  ▁▁▁▁▁▁▁▁█▃ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -68.4%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ◀              ┊                  -70.4%  <.001  ▁▁▁▁▁▁▁▃█▂ █▂▁▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans  ◀              ┊                  -70.7%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -71.8%  <.001  ▁▁▁▁▁▁▁▂█▅ █▂▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -74.2%  <.001  ▁▁▁▁▁▁▁▁█▅ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -74.8%  <.001  ▁▁▁▁▁▁▂█▃▁ █▄▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -75.4%  <.001  ▁▁▁▁▁▁▁█▆▂ █▄▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -82.9%  <.001  ▁▁▁▁▁▁▁██▂ █▃▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -83.2%  <.001  ▁▁▁▁▁▁▁█▇▂ █▃▁▁▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates  ◀              ┊                  -85.1%  <.001  ▁▁▁▁▁▁▁▁█▃ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent formatted flow updates              ◀              ┊                  -85.7%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -88.0%  <.001  ▁▁▁▁▁▁▁▂█▁ █▁▁▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -90.0%  <.001  ▁▁▁▁▁▁▁█▆▂ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans  ◀              ┊                  -90.2%  <.001  ▁▁▁▁▁▁▁▂█▃ █▁▁▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -91.3%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans  ◀              ┊                  -91.5%  <.001  ▁▁▁▁▁▁▁▂█▄ █▁▁▁▁▁▁▁▁▁
+ move 1000 retained TypeGPU labels                             ◀              ┊                  -92.2%  <.001  ▁▁▁▁▁▂██▄▂ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent retained label updates              ◀              ┊                  -92.7%  <.001  ▁▁▁▁▁▁▁▅█▃ █▁▁▁▁▁▁▁▁▁
  borrow glyphs from 1000 steadily promoted retained labels                 ├──┼─●┤                +7.5%   .442  █▃▂▁▁▁▁▁▇▄ ▁▆█▃▁▁▂▂█▃
  long unsafe-boundary paragraph text edit                                     ┊├●                 +5.1%  <.001  ▂█▂▂▂▁▁▁▁▁ ▁▃█▃▂▂▁▁▁▁
  rewrite 64 labels in one group                                               ┊●┤                 +4.8%   .010  ▆█▂▂▁▁▁▁▁▁ ▂█▂▂▁▁▁▁▁▁
  relayout after font-size change                                              ┊●                  +3.9%  <.001  ▃█▂▁▂▁▁▁▁▁ ▁▆█▂▁▁▂▁▁▁
  10 labels last length-changing scene publication                             ├●─┤                +3.1%   .065  ▂█▅▄▃▂▂▁▁▁ ▁▅█▄▃▂▂▁▁▁
  100 labels first same-value-set                                              ┊●                  +2.9%  <.001  ▂▄█▇▂▁▁▂▁▁ ▁▁▃██▅▂▂▁▁
  long reporter workaround paragraph reflow                                    ├●                  +2.9%   .010  █▇▃▁▁▁▁▁▁▁ ▄█▂▁▁▁▁▁▁▁
  1 labels first same-value-set                                                ├●                  +2.3%   .002  ▂▃█▃▁▁▂▁▁▁ ▁▁▆█▂▁▂▁▁▁
  1000 labels first same-value-set                                             ├●                  +2.3%   .021  ▁▅█▄▁▁▂▂▃▁ ▁▁▇█▄▂▃▂▂▁
  publication after text change                                                ●┤                  +1.5%  <.001  ▁▃█▅▂▂▁▁▁▁ ▃▇▄█▆▄▂▂▁▁
  10 labels first length-changing engine publication                          ├●┤                  +1.1%   .700  ▂██▆▃▂▂▁▁▁ ▁▄█▄▂▂▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                            ●┤                  +0.8%   .442  ▁▂▁▁▂█▆▂▁▁ ▁▁▂▁▂█▆▂▁▁
  cached measurement                                                          ├●                   -1.6%   .266  ▅█▃▁▂▂▁▁▁▁ ▅█▂▁▁▂▁▁▁▁
  measure 100 unchanged labels                                              ├─●┤                   -4.3%   .050  ▁█▃▁▁▁▁▁▁▁ ▂█▂▁▁▁▁▁▁▁
  100 labels separated unbalanced g…nk-space scene publication               ├●┊                   -4.5%   .010  ▁▁▆█▆▂▂▁▁▁ ▁▆█▅▄▃▂▂▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | 1 labels first set | 1.06µs | 16.67µs | +0.016ms | +1476.9% | <.001 | +1456.6..+1539.7% |
| 🔴 slower | 100 labels first set | 1.20µs | 15.79µs | +0.015ms | +1214.7% | <.001 | +1198.6..+1262.9% |
| 🔴 slower | 1000 labels first set | 2.28µs | 16.35µs | +0.014ms | +617.7% | <.001 | +594.8..+630.5% |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels | 95.19µs | 175.54µs | +0.080ms | +84.4% | <.001 | +77.3..+88.0% |
| 🔴 slower | 100 labels first overwrite-before-scene-publication | 365.52µs | 491.42µs | +0.126ms | +34.4% | <.001 | +31.9..+36.2% |
| 🔴 slower | 1 labels first overwrite-before-scene-publication | 269.42µs | 361.29µs | +0.092ms | +34.1% | <.001 | +31.7..+36.8% |
| 🔴 slower | measurement after width change | 930.79µs | 1.18ms | +0.249ms | +27.2% | <.001 | +25.5..+28.2% |
| 🔴 slower | rewrite 512 labels in one group | 7.37ms | 9.25ms | +1.880ms | +25.5% | <.001 | +23.5..+27.1% |
| 🔴 slower | type one character into a long Fredoka paragraph and measure | 1.62ms | 2.03ms | +0.410ms | +25.0% | <.001 | +24.2..+25.8% |
| 🔴 slower | 10 labels no-op scene traversal | 3.17µs | 3.81µs | +0.000640ms | +20.3% | <.001 | +18.4..+30.9% |
| 🔴 slower | cached per-glyph inspection | 56.27µs | 66.44µs | +0.010ms | +18.1% | <.001 | +15.4..+21.1% |
| 🔴 slower | publish 1024 retained Text instances | 15.35ms | 18.09ms | +2.740ms | +17.8% | <.001 | +16.3..+21.3% |
| 🔴 slower | rewrite 256 labels in one group | 3.85ms | 4.46ms | +0.610ms | +16.0% | <.001 | +12.3..+21.2% |
| 🔴 slower | publication after font-size change | 6.52ms | 7.50ms | +0.980ms | +15.0% | <.001 | +13.8..+15.4% |
| 🔴 slower | rewrite 128 labels in one group | 2.13ms | 2.36ms | +0.230ms | +10.7% | <.001 | +9.0..+12.0% |
| 🔴 slower | long unsafe-boundary paragraph reflow | 570.58µs | 631.67µs | +0.061ms | +10.7% | .010 | +8.3..+15.8% |
| 🔴 slower | measure 1000 unchanged retained labels | 209.94µs | 229.63µs | +0.020ms | +9.4% | .005 | +3.7..+18.6% |
| 🔴 slower | 100 labels no-op scene traversal | 56.98µs | 62.08µs | +0.005ms | +9.0% | .003 | +6.2..+13.9% |
| 🔴 slower | toggle one group containing 1000 retained labels | 382.13µs | 413.10µs | +0.031ms | +8.1% | .010 | +4.7..+13.7% |
| 🔴 slower | 1000 labels no-op scene traversal | 359.42µs | 387.06µs | +0.028ms | +7.7% | .021 | +2.1..+11.1% |
| 🔴 slower | mount and publish a 22k-glyph paragraph | 18.56ms | 19.96ms | +1.400ms | +7.5% | <.001 | +6.3..+8.6% |
| 🔴 slower | 10 labels first length-changing scene publication | 453.92µs | 479.04µs | +0.025ms | +5.5% | <.001 | +3.4..+7.1% |
| 🔴 slower | 10 labels last length-changing engine publication | 426.08µs | 447.25µs | +0.021ms | +5.0% | .010 | +3.1..+8.3% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication | 818.67µs | 776.69µs | -0.042ms | -5.1% | <.001 | -6.6..-4.1% |
| 🟢 faster | mount 100 labels and borrow glyphs from each once | 11.79ms | 11.17ms | -0.620ms | -5.3% | <.001 | -6.0..-4.2% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication | 770.96µs | 727.08µs | -0.044ms | -5.7% | <.001 | -8.1..-4.1% |
| 🟢 faster | publish after text change | 2.08ms | 1.95ms | -0.130ms | -6.2% | <.001 | -6.7..-4.9% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication | 769.23µs | 720.40µs | -0.049ms | -6.3% | <.001 | -8.2..-3.8% |
| 🟢 faster | 1000 labels first overwrite-before-scene-publication | 1.76ms | 1.64ms | -0.120ms | -6.9% | <.001 | -9.6..-5.1% |
| 🟢 faster | issue 216 unsafe-boundary word-wrap reflow | 193.54µs | 176.88µs | -0.017ms | -8.6% | <.001 | -11.3..-4.8% |
| 🟢 faster | publish after color change | 1.51ms | 1.38ms | -0.130ms | -9.1% | <.001 | -10.6..-8.4% |
| 🟢 faster | issue 216 reporter workaround | 192.52µs | 172.60µs | -0.020ms | -10.3% | <.001 | -12.3..-8.3% |
| 🟢 faster | 10 labels last same-length engine publication | 403.00µs | 359.63µs | -0.043ms | -10.8% | .010 | -15.3..-3.3% |
| 🟢 faster | 100 labels last length-changing engine publication | 626.65µs | 559.13µs | -0.068ms | -10.8% | .010 | -19.6..-6.1% |
| 🟢 faster | 100 labels last length-changing scene publication | 674.19µs | 600.35µs | -0.074ms | -11.0% | <.001 | -19.3..-9.5% |
| 🟢 faster | 10 labels first same-length scene publication | 412.44µs | 365.29µs | -0.047ms | -11.4% | .002 | -14.8..-9.5% |
| 🟢 faster | mount a label and publish its first edit | 2.60ms | 2.30ms | -0.300ms | -11.7% | <.001 | -12.7..-6.1% |
| 🟢 faster | 10 labels last same-length scene publication | 419.04µs | 362.71µs | -0.056ms | -13.4% | <.001 | -18.2..-10.8% |
| 🟢 faster | reorder then edit one of 1000 retained labels | 6.32ms | 5.46ms | -0.860ms | -13.5% | <.001 | -14.3..-11.8% |
| 🟢 faster | 10 labels first same-length engine publication | 406.15µs | 351.10µs | -0.055ms | -13.6% | <.001 | -15.1..-11.7% |
| 🟢 faster | measurement then publication after width change | 1.63ms | 1.39ms | -0.240ms | -14.4% | <.001 | -15.3..-13.8% |
| 🟢 faster | reorder 1000 unchanged retained labels | 2.57ms | 2.19ms | -0.380ms | -14.7% | <.001 | -15.9..-10.5% |
| 🟢 faster | type one character into a long paragraph and publish a frame | 3.35ms | 2.81ms | -0.540ms | -15.9% | <.001 | -16.8..-15.3% |
| 🟢 faster | common-safe word-wrap reflow | 195.48µs | 163.13µs | -0.032ms | -16.6% | <.001 | -21.1..-12.9% |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels | 214.87µs | 176.69µs | -0.038ms | -17.8% | <.001 | -19.0..-12.8% |
| 🟢 faster | type one character into a long paragraph and measure | 2.10ms | 1.69ms | -0.410ms | -19.2% | <.001 | -20.1..-18.6% |
| 🟢 faster | 100 labels first length-changing engine publication | 772.83µs | 612.31µs | -0.161ms | -20.8% | <.001 | -22.4..-19.9% |
| 🟢 faster | edit and independently copy one label among 1 labels | 1.08ms | 848.04µs | -0.232ms | -21.5% | <.001 | -22.7..-20.0% |
| 🟢 faster | 100 labels first length-changing scene publication | 843.83µs | 656.08µs | -0.188ms | -22.2% | <.001 | -23.8..-18.3% |
| 🟢 faster | write 1000 paragraph-order mutations | 15.90µs | 12.06µs | -0.004ms | -24.1% | <.001 | -26.8..-22.0% |
| 🟢 faster | edit and measure one of 100 retained labels | 155.04µs | 115.50µs | -0.040ms | -25.5% | <.001 | -27.6..-14.5% |
| 🟢 faster | write 1000 paragraph and text mutations | 96.33µs | 71.50µs | -0.025ms | -25.8% | <.001 | -27.8..-24.1% |
| 🟢 faster | edit and measure one of 1000 retained labels | 198.38µs | 146.08µs | -0.052ms | -26.4% | <.001 | -32.3..-25.0% |
| 🟢 faster | 100 labels first same-length scene publication | 648.67µs | 476.00µs | -0.173ms | -26.6% | <.001 | -29.1..-22.1% |
| 🟢 faster | write 22k UTF16 text into Wasm request arena | 50.40µs | 36.83µs | -0.014ms | -26.9% | <.001 | -27.8..-22.7% |
| 🟢 faster | 100 labels last same-length engine publication | 582.58µs | 425.44µs | -0.157ms | -27.0% | <.001 | -28.8..-25.0% |
| 🟢 faster | 100 labels batched edit-read publication | 6.07ms | 4.42ms | -1.650ms | -27.1% | <.001 | -28.1..-26.5% |
| 🟢 faster | 100 labels first same-length engine publication | 589.06µs | 428.33µs | -0.161ms | -27.3% | <.001 | -28.5..-25.0% |
| 🟢 faster | write 22k UTF16 text into owned array control | 50.31µs | 36.46µs | -0.014ms | -27.5% | <.001 | -28.1..-25.7% |
| 🟢 faster | 100 labels last same-length scene publication | 648.52µs | 469.77µs | -0.179ms | -27.6% | <.001 | -29.0..-24.0% |
| 🟢 faster | reflow after width change | 504.71µs | 350.44µs | -0.154ms | -30.6% | <.001 | -32.1..-26.0% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication | 9.71ms | 6.65ms | -3.060ms | -31.5% | <.001 | -32.3..-30.0% |
| 🟢 faster | 1 labels first set+measure+scene-publication | 547.13µs | 364.35µs | -0.183ms | -33.4% | <.001 | -35.5..-31.3% |
| 🟢 faster | split move and merge paint boundaries preparation only | 6.86ms | 4.57ms | -2.290ms | -33.4% | <.001 | -33.7..-32.9% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication | 2.87ms | 1.89ms | -0.980ms | -34.0% | <.001 | -35.3..-32.9% |
| 🟢 faster | 100 labels first set+measure+scene-publication | 746.71µs | 490.12µs | -0.257ms | -34.4% | <.001 | -35.5..-33.3% |
| 🟢 faster | 1 labels first set+measure | 174.69µs | 112.73µs | -0.062ms | -35.5% | <.001 | -38.6..-34.0% |
| 🟢 faster | edit and independently copy one label among 100 labels | 1.49ms | 943.15µs | -0.547ms | -36.8% | <.001 | -38.4..-35.4% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels | 57.58ms | 36.34ms | -21.240ms | -36.9% | <.001 | -37.4..-36.2% |
| 🟢 faster | measure after text change | 2.59ms | 1.61ms | -0.980ms | -37.7% | <.001 | -38.1..-36.9% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication | 4.81ms | 2.97ms | -1.840ms | -38.3% | <.001 | -39.2..-37.3% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication | 4.96ms | 3.05ms | -1.910ms | -38.5% | <.001 | -39.3..-37.3% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication | 4.46ms | 2.73ms | -1.730ms | -38.8% | <.001 | -39.5..-38.3% |
| 🟢 faster | split move and merge paint boundaries publication | 9.66ms | 5.87ms | -3.790ms | -39.2% | <.001 | -39.7..-38.0% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication | 4.56ms | 2.76ms | -1.800ms | -39.5% | <.001 | -40.3..-38.8% |
| 🟢 faster | 10 labels first color-only engine publication | 411.54µs | 246.35µs | -0.165ms | -40.1% | <.001 | -43.7..-34.1% |
| 🟢 faster | 1000 labels last length-changing scene publication | 3.18ms | 1.90ms | -1.280ms | -40.4% | <.001 | -42.5..-39.7% |
| 🟢 faster | 10 labels first color-only scene publication | 426.69µs | 253.56µs | -0.173ms | -40.6% | <.001 | -41.4..-37.8% |
| 🟢 faster | 10 labels last color-only scene publication | 428.60µs | 252.56µs | -0.176ms | -41.1% | <.001 | -43.6..-39.3% |
| 🟢 faster | 10 labels last color-only engine publication | 398.96µs | 234.52µs | -0.164ms | -41.2% | <.001 | -42.9..-37.0% |
| 🟢 faster | copy per-glyph metrics after text change | 5.26ms | 3.05ms | -2.210ms | -42.0% | <.001 | -42.6..-41.6% |
| 🟢 faster | 1000 labels last length-changing engine publication | 2.91ms | 1.67ms | -1.240ms | -42.8% | <.001 | -44.1..-41.9% |
| 🟢 faster | publication after width change | 1.21ms | 693.73µs | -0.516ms | -42.8% | <.001 | -43.5..-41.0% |
| 🟢 faster | per-glyph inspection after width change | 7.90ms | 4.42ms | -3.480ms | -44.1% | <.001 | -52.4..-43.7% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication | 3.87ms | 2.08ms | -1.790ms | -46.4% | <.001 | -46.9..-46.0% |
| 🟢 faster | 1000 labels first same-length scene publication | 3.14ms | 1.63ms | -1.510ms | -48.0% | <.001 | -48.3..-47.2% |
| 🟢 faster | 1000 labels last same-length scene publication | 3.18ms | 1.62ms | -1.560ms | -48.9% | <.001 | -49.7..-48.1% |
| 🟢 faster | write one paragraph and text mutation | 1.02µs | 517.76ns | -0.000502ms | -49.2% | <.001 | -54.1..-41.2% |
| 🟢 faster | 1000 labels first set+measure+scene-publication | 3.26ms | 1.65ms | -1.610ms | -49.3% | <.001 | -49.8..-48.8% |
| 🟢 faster | 1000 labels first length-changing scene publication | 4.73ms | 2.33ms | -2.400ms | -50.8% | <.001 | -51.2..-50.2% |
| 🟢 faster | 1000 labels first length-changing engine publication | 4.42ms | 2.14ms | -2.280ms | -51.5% | <.001 | -52.3..-50.5% |
| 🟢 faster | 1000 labels last same-length engine publication | 2.84ms | 1.36ms | -1.480ms | -51.9% | <.001 | -52.6..-51.5% |
| 🟢 faster | 1000 labels first same-length engine publication | 2.89ms | 1.38ms | -1.510ms | -52.3% | <.001 | -52.8..-50.3% |
| 🟢 faster | inspection then publication after width change | 9.81ms | 4.67ms | -5.140ms | -52.4% | <.001 | -52.8..-52.1% |
| 🟢 faster | 100 labels first color-only scene publication | 632.23µs | 298.35µs | -0.334ms | -52.8% | <.001 | -53.9..-50.0% |
| 🟢 faster | 100 labels last color-only scene publication | 648.23µs | 293.06µs | -0.355ms | -54.8% | <.001 | -58.0..-53.9% |
| 🟢 faster | 100 labels first color-only engine publication | 579.75µs | 249.83µs | -0.330ms | -56.9% | <.001 | -59.7..-55.5% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans | 38.84ms | 16.56ms | -22.280ms | -57.4% | <.001 | -57.6..-56.6% |
| 🟢 faster | 100 labels last color-only engine publication | 585.88µs | 248.27µs | -0.338ms | -57.6% | <.001 | -58.4..-56.2% |
| 🟢 faster | reuse 1000 unchanged Vue property snapshots | 450.75µs | 188.48µs | -0.262ms | -58.2% | <.001 | -58.7..-57.8% |
| 🟢 faster | 100 labels interleaved edit-read publication | 26.22ms | 10.63ms | -15.590ms | -59.5% | <.001 | -60.0..-59.1% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans | 40.06ms | 16.05ms | -24.010ms | -59.9% | <.001 | -60.4..-59.7% |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 35.56ms | 13.04ms | -22.520ms | -63.3% | <.001 | -63.8..-62.8% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans | 40.31ms | 14.67ms | -25.640ms | -63.6% | <.001 | -64.0..-63.0% |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans | 36.96ms | 12.78ms | -24.180ms | -65.4% | <.001 | -65.8..-64.9% |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans | 36.59ms | 12.35ms | -24.240ms | -66.2% | <.001 | -66.7..-65.6% |
| 🟢 faster | edit and independently copy one label among 1000 labels | 5.52ms | 1.81ms | -3.710ms | -67.1% | <.001 | -67.8..-66.6% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 46.86ms | 15.27ms | -31.590ms | -67.4% | <.001 | -67.6..-67.2% |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 43.70ms | 13.82ms | -29.880ms | -68.4% | <.001 | -68.6..-68.2% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication | 20.81ms | 6.16ms | -14.650ms | -70.4% | <.001 | -70.5..-70.2% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans | 39.05ms | 11.42ms | -27.630ms | -70.7% | <.001 | -71.1..-70.5% |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 35.36ms | 9.96ms | -25.400ms | -71.8% | <.001 | -72.1..-71.4% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication | 174.76ms | 45.06ms | -129.700ms | -74.2% | <.001 | -74.4..-74.0% |
| 🟢 faster | 1000 labels first color-only scene publication | 3.07ms | 773.48µs | -2.297ms | -74.8% | <.001 | -75.2..-74.0% |
| 🟢 faster | 1000 labels last color-only scene publication | 3.10ms | 762.23µs | -2.338ms | -75.4% | <.001 | -76.2..-74.8% |
| 🟢 faster | 1000 labels last color-only engine publication | 2.83ms | 483.35µs | -2.347ms | -82.9% | <.001 | -83.1..-82.5% |
| 🟢 faster | 1000 labels first color-only engine publication | 2.82ms | 474.50µs | -2.345ms | -83.2% | <.001 | -83.5..-82.7% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates | 33.03ms | 4.91ms | -28.120ms | -85.1% | <.001 | -85.3..-85.0% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates | 33.25ms | 4.77ms | -28.480ms | -85.7% | <.001 | -85.9..-85.5% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication | 152.47ms | 18.23ms | -134.240ms | -88.0% | <.001 | -88.2..-87.7% |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans | 26.97ms | 2.71ms | -24.260ms | -90.0% | <.001 | -90.1..-89.8% |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 27.44ms | 2.69ms | -24.750ms | -90.2% | <.001 | -90.3..-90.0% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans | 31.79ms | 2.76ms | -29.030ms | -91.3% | <.001 | -91.4..-91.1% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 32.58ms | 2.76ms | -29.820ms | -91.5% | <.001 | -91.6..-91.0% |
| 🟢 faster | move 1000 retained TypeGPU labels | 3.12ms | 243.21µs | -2.877ms | -92.2% | <.001 | -92.5..-91.7% |
| 🟢 faster | normalize 1000 equivalent retained label updates | 30.20ms | 2.20ms | -28.000ms | -92.7% | <.001 | -92.9..-92.6% |

<details><summary>15 neutral, 2 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | rewrite 64 labels in one group | 1.29ms | 1.35ms | +0.060ms | +4.8% | .010 | +2.8..+6.2% |
| neutral | 10 labels first length-changing engine publication | 450.08µs | 454.92µs | +0.005ms | +1.1% | .700 | -3.7..+3.7% |
| neutral | 10 labels last length-changing scene publication | 443.27µs | 457.08µs | +0.014ms | +3.1% | .065 | -0.6..+8.6% |
| neutral | 100 labels separated unbalanced grow-shrink-space scene publication | 807.19µs | 771.04µs | -0.036ms | -4.5% | .010 | -6.4..-3.1% |
| neutral | relayout after font-size change | 1.95ms | 2.02ms | +0.070ms | +3.9% | <.001 | +2.5..+4.8% |
| neutral | measure 100 unchanged labels | 6.68µs | 6.39µs | -0.000290ms | -4.3% | .050 | -9.4..-0.1% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 220.77µs | 222.65µs | +0.002ms | +0.8% | .442 | -0.9..+2.6% |
| neutral | cached measurement | 31.38ns | 30.89ns | -0.000000ms | -1.6% | .266 | -3.4..+1.3% |
| neutral | publication after text change | 6.73ms | 6.84ms | +0.110ms | +1.5% | <.001 | +1.0..+1.8% |
| neutral | 1 labels first same-value-set | 68.12ns | 69.72ns | +0.000002ms | +2.3% | .002 | +0.9..+3.3% |
| neutral | 100 labels first same-value-set | 68.35ns | 70.35ns | +0.000002ms | +2.9% | <.001 | +1.9..+4.9% |
| neutral | 1000 labels first same-value-set | 69.40ns | 70.99ns | +0.000002ms | +2.3% | .021 | +0.4..+3.1% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels | 976.06µs | 1.05ms | +0.074ms | +7.5% | .442 | -11.1..+9.2% |
| neutral | long reporter workaround paragraph reflow | 565.77µs | 582.46µs | +0.017ms | +2.9% | .010 | +1.5..+4.4% |
| neutral | long unsafe-boundary paragraph text edit | 1.65ms | 1.74ms | +0.090ms | +5.1% | <.001 | +3.8..+6.0% |
| skipped: timing-mode mismatch | 100 labels first set+measure |  |  |  |  |  |  |
| skipped: timing-mode mismatch | 1000 labels first set+measure |  |  |  |  |  |  |

</details>
