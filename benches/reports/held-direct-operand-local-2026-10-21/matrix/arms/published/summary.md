Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

99 faster · 26 slower · 13 neutral · 5 skipped

Baseline `0.1.0 (6e2bf7bd)` → candidate `0.1.0 (83949860)`

> ⚠ baseline CPU clock drifted 5.3% during its run

Latency distribution across 138 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 1.635ms | 1.015ms |
| Workloads ≤1 ms | 63 | 69 |
| Workloads ≤2 ms | 73 | 87 |
| Workloads ≤3 ms | 85 | 105 |
| Workloads >3 ms | 53 | 33 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 174.67ms | 45.37ms | -129.300ms |
| mutate one trailing span across 1000 formatted labels | 57.53ms | 37.17ms | -20.360ms |
| publish 1024 retained Text instances | 15.23ms | 20.23ms | +5.000ms |
| mount and publish a 22k-glyph paragraph | 18.41ms | 20.11ms | +1.700ms |
| 1000 labels 100 edits immediate measurements with publication | 153.69ms | 18.24ms | -135.450ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 100 labels first set                                                         ┊              ▶  +1462.7%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▅█▃▂▂▁
- 1 labels first set                                                           ┊              ▶  +1400.0%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁█▄▂▂▂▁
- 1000 labels first set                                                        ┊              ▶  +1159.4%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁██▃▁
- type one character into a long paragraph and measure                         ┊              ▶  +272.7%  <.001  █▂▁▁▁▁▁▁█▁ ▁▁▁▁▁▁█▂▁▁
- copy per-glyph metrics from 100 unchanged labels                             ┊              ▶   +85.0%  <.001  ██▁▁▁▁▁▁▁▁ ▁▁▁▁▃█▂▁▁▁
- rewrite 512 labels in one group                                              ┊         ●┤       +34.0%  <.001  ▄█▅▂▁▁▁▁▁▁ ▁▁▁▂▆▃██▃▂
- publish 1024 retained Text instances                                         ┊        ├●        +32.9%  <.001  ▆█▅▂▁▁▁▁▁▁ ▁▁▁▁▁▆█▃▆▄
- long unsafe-boundary paragraph reflow                                        ┊        ├●        +32.9%  <.001  ▃█▂▂▁▁▁▁▁▁ ▁▁▁█▄▂▁▂▁▁
- publication after font-size change                                           ┊        ├●        +31.8%  <.001  ▆█▂▁▁▁▁▁▁▁ ▁▁▁▁▁▄▆█▄▂
- 1 labels first overwrite-before-scene-publication                            ┊        ●┤        +30.4%  <.001  ▂█▄▃▁▁▁▁▁▁ ▁▁▁█▆▃▂▁▁▁
- 100 labels first overwrite-before-scene-publication                          ┊       ├●┤        +29.2%  <.001  ▂█▄▂▁▁▁▁▁▁ ▁▁▁█▇▃▂▁▁▁
- measurement after width change                                               ┊       ●┤         +27.1%  <.001  ▁▂▃▂█▄▂▁▁▁ ▁▁▁▁▁▂█▆▂▁
- type one character into a long Fredoka paragraph and measure                 ┊      ●┤          +24.2%  <.001  █▂▁▁▁▁█▁▁▁ ▁▁▁▁▁▁▁█▃▁
- 10 labels no-op scene traversal                                              ┊      ●───┤       +23.9%  <.001  █▃▆▂▂▁▁▁▁▁ ▁█▅▄▃▂▁▁▁▁
- rewrite 256 labels in one group                                              ┊     ├●           +22.0%  <.001  ▂█▄▂▂▁▁▁▁▁ ▁▁▁▂█▅▃▂▁▁
- rewrite 128 labels in one group                                              ┊    ●             +16.7%  <.001  ▆█▃▂▁▁▁▁▁▁ ▁▁█▇▄▂▂▂▁▁
- relayout after font-size change                                              ┊   ├●             +16.1%  <.001  ▅█▂▁▂▁▁▁▁▁ ▁▁▁▅█▃▂▂▁▁
- rewrite 64 labels in one group                                               ┊  ●┤              +11.0%   .005  ▃█▄▁▁▂▂▁▁▁ ▁▃█▄▂▂▁▁▁▁
- 100 labels no-op scene traversal                                             ┊├─●┤               +9.4%   .001  ▃█▃▂▁▁▁▁▁▁ ▁█▅▃▂▁▁▁▁▁
- mount and publish a 22k-glyph paragraph                                      ┊ ├●                +9.2%  <.001  ▇█▆▄▂▁▁▁▁▁ ▁▁▁▁▂█▆▄▂▂
- toggle one group containing 1000 retained labels                             ┊ ├●┤               +9.2%  <.001  ▃█▅▆▄▂▁▁▁▁ ▁▂▆█▅▃▂▁▁▁
- publication after text change                                                ┊ ●┤                +8.2%  <.001  ▂█▄▂▁▁▁▁▁▁ ▁▁▅▄█▃▂▂▁▁
- measure 1000 unchanged retained labels                                       ┊├●─┤               +7.5%   .019  ▂▆█▇▄▃▂▁▁▁ ▁▁▇█▆▃▃▂▂▁
- 10 labels last length-changing engine publication                            ┊ ●─┤               +6.9%  <.001  ▁█▅▂▂▁▁▁▁▁ ▁▄█▄▂▂▁▁▁▁
- 1000 labels no-op scene traversal                                            ┊├●┤                +6.2%   .010  ▂█▄▃▅▄▂▁▁▁ ▁▂▇█▆▃▁▁▁▁
- 10 labels last length-changing scene publication                             ┊├●                 +5.7%   .010  ▂█▆▄▃▂▁▁▁▁ ▁▄█▅▃▂▂▁▁▁
+ mount 100 labels and borrow glyphs from each once                          ●┤┊                   -5.1%  <.001  ▁▁▁▄█▅▂▂▂▁ ▂▅█▅▄▃▂▁▂▂
+ 100 labels separated balanced gro…k-space engine publication               ●─┤                   -5.2%   .021  ▁▁▃█▇▄▂▂▁▁ ▂▅█▆▅▃▂▂▁▁
+ 1000 labels first overwrite-before-scene-publication                      ├●┤┊                   -7.0%  <.001  ▁▄█▇▆▅▄▂▂▁ ▅█▇▅▃▃▂▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication               ● ┊                   -7.2%  <.001  ▁▁▄█▆▃▂▁▁▁ ▁▆█▅▃▂▂▂▁▁
+ 100 labels separated unbalanced g…k-space engine publication              ├●┤┊                   -7.6%  <.001  ▁▁▂▇█▅▂▂▂▁ ▁▆█▆▄▃▃▁▂▁
+ 100 labels last length-changing scene publication                         ├● ┊                   -8.1%  <.001  ▁▃█▇▃▂▁▁▁▁ ▃█▇▃▂▂▂▁▁▁
+ 100 labels last length-changing engine publication                        ●┤ ┊                   -8.4%  <.001  ▁▃█▇▃▂▁▁▁▁ ▂█▆▃▂▂▂▁▁▁
+ 10 labels first same-length scene publication                            ├●┤ ┊                  -10.0%   .010  ▁██▅▂▂▁▁▁▁ ▃█▄▂▂▁▁▁▁▁
+ issue 216 reporter workaround                                            ├●  ┊                  -11.1%  <.001  ▁▆█▄▂▁▁▁▂▁ ▃█▃▂▁▁▂▁▁▁
+ 10 labels first same-length engine publication                           ●──┤┊                  -12.4%   .003  ▁█▆▃▂▂▁▁▁▁ ▄█▃▂▁▁▁▁▁▁
+ mount a label and publish its first edit                                 ●   ┊                  -12.9%  <.001  ▁▁▂█▅▃▂▁▁▁ ▃█▄▂▁▂▂▁▁▁
+ common-safe word-wrap reflow                                            ├●┤  ┊                  -13.0%  <.001  ▁▅█▃▁▁▁▁▁▁ ▄█▃▁▁▁▂▁▁▁
+ reorder then edit one of 1000 retained labels                            ●   ┊                  -13.9%  <.001  ▁▁▁▂█▄▅▃▂▁ ▃█▄▂▁▁▁▁▁▁
+ type one character into a long paragraph and publish a frame            ├●   ┊                  -14.6%  <.001  ▁▁▁▁▃█▃▂▂▁ ▂█▄▂▂▂▁▁▁▁
+ 10 labels last same-length engine publication                          ├─●┤  ┊                  -15.0%  <.001  ▁▂██▅▃▂▂▂▂ ▂█▅▂▂▁▁▁▁▁
+ 10 labels last same-length scene publication                            ●┤   ┊                  -15.1%  <.001  ▁▃█▅▄▂▂▂▂▁ ▂█▄▂▁▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                  ●┤   ┊                  -15.1%  <.001  ▁▁▁▄█▆▇▄▄▂ ▃█▆▃▃▃▂▁▁▁
+ measurement then publication after width change                         ●    ┊                  -16.0%  <.001  ▁▃▂▁█▇▂▁▁▁ ▂▁█▅▂▁▁▁▁▁
+ 100 labels first length-changing engine publication                    ├●    ┊                  -18.2%  <.001  ▁▁▂█▅▂▂▁▁▁ ▃█▅▂▂▂▁▁▁▁
+ 1000 labels first same-value-set                                       ●     ┊                  -19.7%  <.001  ▁██▁▁▂▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels first length-changing scene publication                    ├●┤    ┊                  -20.0%  <.001  ▁▁▁█▇▃▂▂▁▁ ▃█▅▂▂▂▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                  ├●┤    ┊                  -20.3%  <.001  ▁▁▃█▃▂▂▁▁▁ ▃█▃▂▂▂▁▁▁▁
+ edit and independently copy one label among 1 labels                  ├●┤    ┊                  -21.1%  <.001  ▁▁▄█▄▃▂▂▁▁ ▃█▃▂▂▁▁▁▁▁
+ 100 labels first same-length scene publication                       ├●┤     ┊                  -23.5%  <.001  ▁▁▂█▅▂▁▁▂▁ ▄█▄▂▂▁▁▁▁▁
+ edit and measure one of 100 retained labels                          ├●┤     ┊                  -24.0%  <.001  ▁▁▄█▆▃▂▂▁▁ ▃█▅▃▂▂▁▁▁▁
+ 100 labels batched edit-read publication                             ├●      ┊                  -24.8%  <.001  ▁▁▁▁▂▄█▃▂▁ ▄█▃▂▂▁▁▁▁▁
+ write 1000 paragraph and text mutations                              ●       ┊                  -25.5%  <.001  ▁█▅▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels last same-length scene publication                        ●┤      ┊                  -25.7%  <.001  ▁▁▂█▄▂▂▂▁▁ ▂█▃▂▁▁▁▁▁▁
+ 100 labels last same-length engine publication                      ├●       ┊                  -26.3%  <.001  ▁█▅▃▁▁▁▁▁▁ █▅▁▁▁▁▁▁▁▁
+ 100 labels first same-length engine publication                     ├●┤      ┊                  -26.5%  <.001  ▁▁▁▅█▃▂▁▂▁ ▂█▄▂▁▁▁▁▁▁
+ write 22k UTF16 text into Wasm request arena                         ●       ┊                  -27.3%  <.001  ▁█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ write 22k UTF16 text into owned array control                        ●       ┊                  -27.3%  <.001  ▁█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ edit and measure one of 1000 retained labels                        ├●       ┊                  -28.1%  <.001  ▁▁▄█▂▂▂▁▁▁ ▄█▂▂▁▁▁▁▁▁
+ reflow after width change                                          ├●        ┊                  -30.6%  <.001  ▁▁▃█▄▂▂▁▂▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                ├●        ┊                  -31.6%  <.001  ▁▁▁▁▁▁▂█▃▁ ▄█▃▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication       ●         ┊                  -32.6%  <.001  ▁▁▁▁▂▇█▃▁▁ ▃█▃▁▁▁▁▁▁▁
+ split move and merge paint boundaries preparation only             ●         ┊                  -32.8%  <.001  ▄▁▁▁▁▁▁▁▁█ ▁▁▁▁▁▆█▁▁▁
+ edit and independently copy one label among 100 labels            ├●         ┊                  -34.6%  <.001  ▁▁▁▃█▃▂▁▁▁ ▃█▂▁▁▁▁▁▁▁
+ 100 labels first set+measure+scene-publication                    ●┤         ┊                  -35.2%  <.001  ▁▁▁▇█▃▂▁▁▁ ▅█▂▁▁▁▁▁▁▁
+ mutate one trailing span across 1000 formatted labels             ●┤         ┊                  -35.4%  <.001  ▁▁▁▁▁▁▃█▃▁ ▆█▁▁▁▁▁▁▁▁
+ 1 labels first set+measure+scene-publication                      ●┤         ┊                  -36.0%  <.001  ▁▁▁▂█▆▄▃▂▁ ▃█▃▂▁▁▁▁▁▁
+ 1 labels first set+measure                                        ●┤         ┊                  -36.1%  <.001  ▁▁▅▇█▇▃▂▂▁ ▂█▃▂▁▁▁▁▁▁
+ split move and merge paint boundaries publication                 ●          ┊                  -36.4%  <.001  ▁▁▁▁▁▁▃▆█▃ ▇█▁▁▁▁▁▁▁▁
+ measure after text change                                        ├●          ┊                  -38.1%  <.001  ▁▁▁▁▁▂█▃▂▁ █▃▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication     ├●          ┊                  -38.2%  <.001  ▁▁▁▁▁▁▂█▄▁ ▃█▂▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ├●          ┊                  -38.2%  <.001  ▁▁▁▁▁▁▂█▄▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▁▁▁▄█▂ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●           ┊                  -39.4%  <.001  ▁▁▁▁▁▁▁▁█▂ ▄█▂▁▁▁▁▁▁▁
+ 10 labels first color-only scene publication                     ●┤          ┊                  -39.9%  <.001  ▁▁▃█▃▁▁▁▁▁ ▇█▃▂▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication               ●           ┊                  -40.0%  <.001  ▁▁▁▁▁▁█▇▃▁ ▅█▃▁▁▁▁▁▁▁
+ 10 labels last color-only scene publication                     ├●┤          ┊                  -40.2%  <.001  ▁▁▂█▄▁▁▁▁▁ ▅█▃▂▁▁▁▁▁▁
+ copy per-glyph metrics after text change                         ●           ┊                  -40.6%  <.001  ▁▁▁▁▁██▂▂▂ ▄▁█▁▁▁▁▁▁▁
+ 10 labels first color-only engine publication                   ●┤           ┊                  -42.7%  <.001  ▁▁▂█▄▁▁▁▁▁ ▅█▂▁▁▁▁▁▁▁
+ publication after width change                                  ●            ┊                  -42.9%  <.001  ▁▁▂▂▂█▅▃▂▁ █▅▁▂▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ●            ┊                  -43.0%  <.001  ▁▁▁▁▁▁██▅▁ ▇█▂▁▁▁▁▁▁▁
+ 10 labels last color-only engine publication                   ├●            ┊                  -44.7%  <.001  ▁▁▂█▅▂▁▁▂▁ ██▂▂▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●             ┊                  -46.5%  <.001  ▁▁▁▁▁▁▂█▃▂ ▅█▃▁▁▁▁▁▁▁
+ per-glyph inspection after width change                       ◀●┤            ┊                  -47.5%  <.001  ▁▁▁█▁▁▆▃█▆ ▁▃█▅▅▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication               ●┤             ┊                  -48.9%  <.001  ▁▁▁▁▁▁▁█▄▁ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication               ●┤             ┊                  -49.3%  <.001  ▁▁▁▁▁▁▃█▅▂ ██▂▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                ●              ┊                  -49.6%  <.001  ▁▁▁▁▁▁█▇▃▁ ▇█▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ◀              ┊                  -50.2%  <.001  ▁▁▁▁▁▁▃█▂▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication               ◀              ┊                  -50.6%  <.001  ▁▁▁▁▁▁▃█▅▁ ▇█▂▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -51.5%  <.001  ▁▁▁▁▁▁▁█▄▁ █▆▁▁▁▁▁▁▁▁
+ inspection then publication after width change                ◀              ┊                  -52.0%  <.001  ▁▁▁▁▁▁▅▂█▄ █▆▇▃▃▁▁▁▁▁
+ 1000 labels first same-length engine publication              ◀              ┊                  -52.6%  <.001  ▁▁▁▁▁▁▁█▆▂ ██▁▁▁▁▁▁▁▁
+ 100 labels first color-only scene publication                 ◀              ┊                  -53.0%  <.001  ▁▁▁▄█▃▁▁▂▁ █▇▂▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -53.1%  <.001  ▁▁▁▁▁▁▁▁█▄ █▁▁▁▁▁▁▁▁▁
+ 100 labels last color-only scene publication                  ◀              ┊                  -54.1%  <.001  ▁▁▁▃█▃▂▁▂▁ █▆▂▁▁▁▁▁▁▁
+ write one paragraph and text mutation                         ◀              ┊                  -54.9%  <.001  ▁▁██▂▁▃▁▁▁ █▄▂▁▁▁▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans  ◀              ┊                  -55.7%  <.001  ▁▁▁▁▁▁▁▁▆█ █▂▁▁▁▁▁▁▁▁
+ 100 labels first color-only engine publication                ◀              ┊                  -56.7%  <.001  ▁▁▁▁█▃▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
+ reuse 1000 unchanged Vue property snapshots                   ◀              ┊                  -58.1%  <.001  ▁▁█▄▁▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
+ 100 labels last color-only engine publication                 ◀              ┊                  -58.8%  <.001  ▁▁▁▂█▃▁▁▁▁ █▄▂▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                  ◀              ┊                  -59.8%  <.001  ▁▁▁▁▁▁▁▁█▂ █▂▁▁▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -63.8%  <.001  ▁▁▁▁▁▁▁▁▆█ █▁▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -63.8%  <.001  ▁▁▁▁▁▁▁▂█▄ █▂▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -65.3%  <.001  ▁▁▁▁▁▁▁▂█▃ █▂▁▁▁▁▁▁▁▁
+ edit and independently copy one label among 1000 labels       ◀              ┊                  -66.2%  <.001  ▁▁▁▁▁▁▃█▃▂ █▄▁▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -66.5%  <.001  ▁▁▁▁▁▁▁▂█▄ █▂▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans  ◀              ┊                  -67.6%  <.001  ▁▁▁▁▁▁▁▁█▁ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -68.1%  <.001  ▁▁▁▁▁▁▁▁█▃ █▁▁▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ◀              ┊                  -70.5%  <.001  ▁▁▁▁▁▁▁▁█▂ █▂▁▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans  ◀              ┊                  -70.9%  <.001  ▁▁▁▁▁▁▁▁▇█ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -71.9%  <.001  ▁▁▁▁▁▁▁▁█▃ █▁▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -74.0%  <.001  ▁▁▁▁▁▁▁▁█▇ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -75.1%  <.001  ▁▁▁▁▁▁▁█▆▂ █▄▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -75.3%  <.001  ▁▁▁▁▁▁█▇▂▁ █▃▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -82.9%  <.001  ▁▁▁█▂▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -83.3%  <.001  ▁▁▁▁▁▁▁█▃▁ █▃▁▁▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates  ◀              ┊                  -85.2%  <.001  ▁▁▁▁▁▁▁▂█▃ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent formatted flow updates              ◀              ┊                  -85.5%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -88.1%  <.001  ▁▁▁▁▁▁▁▁█▅ █▁▁▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -90.0%  <.001  ▁▁▁▁▁▁▁█▅▂ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans  ◀              ┊                  -90.2%  <.001  ▁▁▁▁▁▁▁▄█▂ █▁▁▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -91.5%  <.001  ▁▁▁▁▁▁▁▁▇█ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans  ◀              ┊                  -91.5%  <.001  ▁▁▁▁▁▁▁▂█▇ █▁▁▁▁▁▁▁▁▁
+ move 1000 retained TypeGPU labels                             ◀              ┊                  -92.4%  <.001  ▁▁▁▁▁▂▇█▅▂ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent retained label updates              ◀              ┊                  -92.8%  <.001  ▁▁▁▁▁▁▁▅█▃ █▁▁▁▁▁▁▁▁▁
  long unsafe-boundary paragraph text edit                                     ┊●┤                 +4.8%  <.001  ▂█▃▂▂▁▁▁▁▁ ▁▂█▃▂▁▂▁▁▁
  10 labels first length-changing engine publication                           ┊●──┤               +4.1%   .010  ▂██▅▃▂▁▂▁▁ ▁▃█▆▃▂▁▂▁▁
  10 labels first length-changing scene publication                            ┊●┤                 +4.0%   .005  ▁█▇▅▃▂▁▁▁▁ ▁▄█▅▂▁▁▁▁▁
  long reporter workaround paragraph reflow                                    ┊●                  +3.8%  <.001  ▂▅█▃▂▁▂▂▁▁ ▁▁█▄▂▁▁▁▂▁
  1 labels first same-value-set                                                ├●                  +2.1%   .010  ▂▄█▂▁▁▁▁▁▁ ▁▁█▆▂▁▂▂▁▁
  100 labels first same-value-set                                              ●┤                  +1.1%   .105  ▁▆█▂▁▁▁▁▁▁ ▁▄█▄▃▂▂▁▁▁
  publish after text change                                                    ●                   +0.5%   .161  ▂█▅▂▂▂▂▁▁▁ ▂█▅▂▂▁▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                           ├●┤                  +0.5%   .798  ▂▁▁▂▃█▂▁▁▁ ▁▁▁▂▃█▃▁▁▁
  publish after color change                                                  ●┤                   -2.2%   .001  ▁█▇▃▂▂▁▁▂▁ ▃█▄▂▂▁▁▁▁▁
  cached measurement                                                         ├●┤                   -3.0%   .021  ▁▆█▁▂▂▂▁▁▁ ▂█▅▁▁▂▂▁▁▁
  100 labels separated balanced gro…nk-space scene publication               ├●┊                   -4.4%   .005  ▁▁▅█▅▃▂▂▁▁ ▂▆█▆▄▃▂▂▂▁
  issue 216 unsafe-boundary word-wrap reflow                                 ●─┤                   -5.3%   .038  ▁█▇▃▁▁▂▂▁▁ ▂█▄▂▁▁▁▁▁▁
  borrow glyphs from 1000 steadily promoted retained labels     ◀●─────────────┼─┤                -47.5%   .105  █▄▂▁▁▁▁▁▅▇ ▁▆▇▃▁▁▁▂█▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | 100 labels first set | 1.18µs | 18.46µs | +0.017ms | +1462.7% | <.001 | +1426.4..+1650.0% |
| 🔴 slower | 1 labels first set | 1.08µs | 16.15µs | +0.015ms | +1400.0% | <.001 | +1366.1..+1417.7% |
| 🔴 slower | 1000 labels first set | 1.28µs | 16.18µs | +0.015ms | +1159.4% | <.001 | +1130.8..+1179.6% |
| 🔴 slower | type one character into a long paragraph and measure | 455.00µs | 1.70ms | +1.245ms | +272.7% | <.001 | +257.2..+281.4% |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels | 95.13µs | 175.96µs | +0.081ms | +85.0% | <.001 | +78.2..+89.7% |
| 🔴 slower | rewrite 512 labels in one group | 7.46ms | 10.00ms | +2.540ms | +34.0% | <.001 | +32.3..+35.4% |
| 🔴 slower | publish 1024 retained Text instances | 15.23ms | 20.23ms | +5.000ms | +32.9% | <.001 | +30.4..+33.9% |
| 🔴 slower | long unsafe-boundary paragraph reflow | 480.48µs | 638.38µs | +0.158ms | +32.9% | <.001 | +30.1..+33.9% |
| 🔴 slower | publication after font-size change | 6.56ms | 8.65ms | +2.090ms | +31.8% | <.001 | +30.5..+34.3% |
| 🔴 slower | 1 labels first overwrite-before-scene-publication | 273.56µs | 356.73µs | +0.083ms | +30.4% | <.001 | +28.4..+34.5% |
| 🔴 slower | 100 labels first overwrite-before-scene-publication | 375.37µs | 484.94µs | +0.110ms | +29.2% | <.001 | +26.9..+33.9% |
| 🔴 slower | measurement after width change | 930.19µs | 1.18ms | +0.250ms | +27.1% | <.001 | +25.3..+28.8% |
| 🔴 slower | type one character into a long Fredoka paragraph and measure | 1.63ms | 2.03ms | +0.400ms | +24.2% | <.001 | +22.6..+25.8% |
| 🔴 slower | 10 labels no-op scene traversal | 3.16µs | 3.91µs | +0.000750ms | +23.9% | <.001 | +22.6..+35.2% |
| 🔴 slower | rewrite 256 labels in one group | 3.86ms | 4.72ms | +0.860ms | +22.0% | <.001 | +20.4..+24.4% |
| 🔴 slower | rewrite 128 labels in one group | 2.12ms | 2.47ms | +0.350ms | +16.7% | <.001 | +15.8..+18.1% |
| 🔴 slower | relayout after font-size change | 1.96ms | 2.27ms | +0.310ms | +16.1% | <.001 | +14.7..+17.1% |
| 🔴 slower | rewrite 64 labels in one group | 1.30ms | 1.44ms | +0.140ms | +11.0% | .005 | +9.7..+12.6% |
| 🔴 slower | 100 labels no-op scene traversal | 56.96µs | 62.33µs | +0.005ms | +9.4% | .001 | +3.7..+14.1% |
| 🔴 slower | mount and publish a 22k-glyph paragraph | 18.41ms | 20.11ms | +1.700ms | +9.2% | <.001 | +8.3..+9.7% |
| 🔴 slower | toggle one group containing 1000 retained labels | 384.33µs | 419.77µs | +0.035ms | +9.2% | <.001 | +5.0..+13.6% |
| 🔴 slower | publication after text change | 6.74ms | 7.30ms | +0.560ms | +8.2% | <.001 | +7.5..+9.0% |
| 🔴 slower | measure 1000 unchanged retained labels | 205.08µs | 220.44µs | +0.015ms | +7.5% | .019 | +2.3..+13.7% |
| 🔴 slower | 10 labels last length-changing engine publication | 427.46µs | 457.08µs | +0.030ms | +6.9% | <.001 | +5.5..+13.2% |
| 🔴 slower | 1000 labels no-op scene traversal | 361.83µs | 384.17µs | +0.022ms | +6.2% | .010 | +2.8..+11.6% |
| 🔴 slower | 10 labels last length-changing scene publication | 435.96µs | 460.83µs | +0.025ms | +5.7% | .010 | +3.8..+8.1% |
| 🟢 faster | mount 100 labels and borrow glyphs from each once | 11.76ms | 11.15ms | -0.610ms | -5.1% | <.001 | -6.1..-4.4% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication | 767.10µs | 727.42µs | -0.040ms | -5.2% | .021 | -6.4..-0.8% |
| 🟢 faster | 1000 labels first overwrite-before-scene-publication | 1.76ms | 1.64ms | -0.120ms | -7.0% | <.001 | -9.9..-4.1% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication | 809.94µs | 752.00µs | -0.058ms | -7.2% | <.001 | -8.3..-5.4% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication | 775.17µs | 716.33µs | -0.059ms | -7.6% | <.001 | -8.8..-4.5% |
| 🟢 faster | 100 labels last length-changing scene publication | 665.15µs | 611.40µs | -0.054ms | -8.1% | <.001 | -10.0..-6.3% |
| 🟢 faster | 100 labels last length-changing engine publication | 610.52µs | 559.40µs | -0.051ms | -8.4% | <.001 | -9.6..-6.9% |
| 🟢 faster | 10 labels first same-length scene publication | 417.88µs | 376.15µs | -0.042ms | -10.0% | .010 | -12.0..-6.2% |
| 🟢 faster | issue 216 reporter workaround | 193.83µs | 172.23µs | -0.022ms | -11.1% | <.001 | -14.4..-9.1% |
| 🟢 faster | 10 labels first same-length engine publication | 400.25µs | 350.44µs | -0.050ms | -12.4% | .003 | -15.0..-3.8% |
| 🟢 faster | mount a label and publish its first edit | 2.62ms | 2.29ms | -0.330ms | -12.9% | <.001 | -13.7..-12.0% |
| 🟢 faster | common-safe word-wrap reflow | 185.44µs | 161.38µs | -0.024ms | -13.0% | <.001 | -15.2..-10.7% |
| 🟢 faster | reorder then edit one of 1000 retained labels | 6.34ms | 5.46ms | -0.880ms | -13.9% | <.001 | -15.0..-13.0% |
| 🟢 faster | type one character into a long paragraph and publish a frame | 3.32ms | 2.83ms | -0.490ms | -14.6% | <.001 | -16.0..-13.8% |
| 🟢 faster | 10 labels last same-length engine publication | 402.27µs | 342.13µs | -0.060ms | -15.0% | <.001 | -18.5..-11.6% |
| 🟢 faster | 10 labels last same-length scene publication | 421.46µs | 357.79µs | -0.064ms | -15.1% | <.001 | -17.7..-13.2% |
| 🟢 faster | reorder 1000 unchanged retained labels | 2.58ms | 2.19ms | -0.390ms | -15.1% | <.001 | -15.8..-14.2% |
| 🟢 faster | measurement then publication after width change | 1.64ms | 1.38ms | -0.260ms | -16.0% | <.001 | -16.8..-15.1% |
| 🟢 faster | 100 labels first length-changing engine publication | 761.54µs | 623.13µs | -0.138ms | -18.2% | <.001 | -20.2..-15.4% |
| 🟢 faster | 1000 labels first same-value-set | 88.75ns | 71.23ns | -0.000018ms | -19.7% | <.001 | -20.7..-19.1% |
| 🟢 faster | 100 labels first length-changing scene publication | 833.06µs | 666.65µs | -0.166ms | -20.0% | <.001 | -23.3..-18.1% |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels | 216.85µs | 172.90µs | -0.044ms | -20.3% | <.001 | -21.8..-17.5% |
| 🟢 faster | edit and independently copy one label among 1 labels | 1.07ms | 847.00µs | -0.223ms | -21.1% | <.001 | -21.9..-15.1% |
| 🟢 faster | 100 labels first same-length scene publication | 630.90µs | 482.44µs | -0.148ms | -23.5% | <.001 | -25.9..-20.3% |
| 🟢 faster | edit and measure one of 100 retained labels | 142.08µs | 108.04µs | -0.034ms | -24.0% | <.001 | -28.2..-21.5% |
| 🟢 faster | 100 labels batched edit-read publication | 6.06ms | 4.56ms | -1.500ms | -24.8% | <.001 | -25.8..-24.0% |
| 🟢 faster | write 1000 paragraph and text mutations | 96.29µs | 71.75µs | -0.025ms | -25.5% | <.001 | -27.9..-25.1% |
| 🟢 faster | 100 labels last same-length scene publication | 638.52µs | 474.44µs | -0.164ms | -25.7% | <.001 | -27.4..-24.1% |
| 🟢 faster | 100 labels last same-length engine publication | 581.15µs | 428.44µs | -0.153ms | -26.3% | <.001 | -31.3..-25.7% |
| 🟢 faster | 100 labels first same-length engine publication | 586.06µs | 430.79µs | -0.155ms | -26.5% | <.001 | -28.4..-25.0% |
| 🟢 faster | write 22k UTF16 text into Wasm request arena | 50.21µs | 36.50µs | -0.014ms | -27.3% | <.001 | -28.0..-26.3% |
| 🟢 faster | write 22k UTF16 text into owned array control | 50.19µs | 36.50µs | -0.014ms | -27.3% | <.001 | -27.8..-26.5% |
| 🟢 faster | edit and measure one of 1000 retained labels | 196.88µs | 141.50µs | -0.055ms | -28.1% | <.001 | -29.0..-26.1% |
| 🟢 faster | reflow after width change | 501.81µs | 348.12µs | -0.154ms | -30.6% | <.001 | -32.6..-28.9% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication | 9.78ms | 6.69ms | -3.090ms | -31.6% | <.001 | -32.5..-30.2% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication | 2.83ms | 1.91ms | -0.920ms | -32.6% | <.001 | -33.6..-31.8% |
| 🟢 faster | split move and merge paint boundaries preparation only | 6.84ms | 4.59ms | -2.250ms | -32.8% | <.001 | -33.4..-32.6% |
| 🟢 faster | edit and independently copy one label among 100 labels | 1.47ms | 959.69µs | -0.510ms | -34.6% | <.001 | -35.7..-33.6% |
| 🟢 faster | 100 labels first set+measure+scene-publication | 761.40µs | 493.31µs | -0.268ms | -35.2% | <.001 | -36.6..-33.8% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels | 57.53ms | 37.17ms | -20.360ms | -35.4% | <.001 | -36.3..-34.8% |
| 🟢 faster | 1 labels first set+measure+scene-publication | 554.58µs | 355.21µs | -0.199ms | -36.0% | <.001 | -38.2..-34.1% |
| 🟢 faster | 1 labels first set+measure | 169.46µs | 108.21µs | -0.061ms | -36.1% | <.001 | -37.3..-34.5% |
| 🟢 faster | split move and merge paint boundaries publication | 9.61ms | 6.11ms | -3.500ms | -36.4% | <.001 | -36.8..-36.0% |
| 🟢 faster | measure after text change | 2.59ms | 1.60ms | -0.990ms | -38.1% | <.001 | -39.1..-37.9% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication | 4.80ms | 2.97ms | -1.830ms | -38.2% | <.001 | -38.8..-37.4% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication | 4.92ms | 3.04ms | -1.880ms | -38.2% | <.001 | -39.5..-37.8% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication | 4.43ms | 2.73ms | -1.700ms | -38.5% | <.001 | -39.3..-37.9% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication | 4.55ms | 2.76ms | -1.790ms | -39.4% | <.001 | -39.8..-39.0% |
| 🟢 faster | 10 labels first color-only scene publication | 419.29µs | 252.17µs | -0.167ms | -39.9% | <.001 | -41.3..-38.3% |
| 🟢 faster | 1000 labels last length-changing scene publication | 3.15ms | 1.89ms | -1.260ms | -40.0% | <.001 | -41.1..-39.1% |
| 🟢 faster | 10 labels last color-only scene publication | 424.75µs | 254.15µs | -0.171ms | -40.2% | <.001 | -42.5..-37.4% |
| 🟢 faster | copy per-glyph metrics after text change | 5.17ms | 3.07ms | -2.100ms | -40.6% | <.001 | -41.6..-39.8% |
| 🟢 faster | 10 labels first color-only engine publication | 402.02µs | 230.35µs | -0.172ms | -42.7% | <.001 | -44.0..-40.3% |
| 🟢 faster | publication after width change | 1.22ms | 695.04µs | -0.525ms | -42.9% | <.001 | -44.2..-42.5% |
| 🟢 faster | 1000 labels last length-changing engine publication | 2.92ms | 1.66ms | -1.260ms | -43.0% | <.001 | -43.7..-42.1% |
| 🟢 faster | 10 labels last color-only engine publication | 407.83µs | 225.56µs | -0.182ms | -44.7% | <.001 | -46.2..-42.2% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication | 3.89ms | 2.08ms | -1.810ms | -46.5% | <.001 | -47.5..-45.9% |
| 🟢 faster | per-glyph inspection after width change | 8.49ms | 4.46ms | -4.030ms | -47.5% | <.001 | -51.7..-43.8% |
| 🟢 faster | 1000 labels first set+measure+scene-publication | 3.23ms | 1.65ms | -1.580ms | -48.9% | <.001 | -49.5..-47.2% |
| 🟢 faster | 1000 labels first same-length scene publication | 3.16ms | 1.60ms | -1.560ms | -49.3% | <.001 | -49.9..-47.6% |
| 🟢 faster | 1000 labels last same-length scene publication | 3.19ms | 1.61ms | -1.580ms | -49.6% | <.001 | -51.0..-48.7% |
| 🟢 faster | 1000 labels first length-changing scene publication | 4.73ms | 2.36ms | -2.370ms | -50.2% | <.001 | -51.2..-49.5% |
| 🟢 faster | 1000 labels last same-length engine publication | 2.84ms | 1.40ms | -1.440ms | -50.6% | <.001 | -52.1..-50.3% |
| 🟢 faster | 1000 labels first length-changing engine publication | 4.41ms | 2.14ms | -2.270ms | -51.5% | <.001 | -51.9..-50.9% |
| 🟢 faster | inspection then publication after width change | 9.79ms | 4.70ms | -5.090ms | -52.0% | <.001 | -52.3..-51.7% |
| 🟢 faster | 1000 labels first same-length engine publication | 2.87ms | 1.36ms | -1.510ms | -52.6% | <.001 | -53.5..-51.7% |
| 🟢 faster | 100 labels first color-only scene publication | 629.65µs | 296.06µs | -0.334ms | -53.0% | <.001 | -53.8..-51.7% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans | 38.59ms | 18.10ms | -20.490ms | -53.1% | <.001 | -53.6..-52.8% |
| 🟢 faster | 100 labels last color-only scene publication | 632.44µs | 289.98µs | -0.342ms | -54.1% | <.001 | -55.3..-52.9% |
| 🟢 faster | write one paragraph and text mutation | 1.01µs | 456.08ns | -0.000554ms | -54.9% | <.001 | -55.3..-54.6% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans | 39.74ms | 17.59ms | -22.150ms | -55.7% | <.001 | -56.2..-55.4% |
| 🟢 faster | 100 labels first color-only engine publication | 577.10µs | 249.75µs | -0.327ms | -56.7% | <.001 | -58.4..-54.9% |
| 🟢 faster | reuse 1000 unchanged Vue property snapshots | 449.42µs | 188.48µs | -0.261ms | -58.1% | <.001 | -58.8..-57.6% |
| 🟢 faster | 100 labels last color-only engine publication | 583.75µs | 240.50µs | -0.343ms | -58.8% | <.001 | -60.4..-57.9% |
| 🟢 faster | 100 labels interleaved edit-read publication | 26.24ms | 10.56ms | -15.680ms | -59.8% | <.001 | -60.0..-59.4% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans | 40.20ms | 14.54ms | -25.660ms | -63.8% | <.001 | -64.0..-63.4% |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 35.46ms | 12.84ms | -22.620ms | -63.8% | <.001 | -64.1..-63.2% |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans | 36.86ms | 12.79ms | -24.070ms | -65.3% | <.001 | -65.6..-64.9% |
| 🟢 faster | edit and independently copy one label among 1000 labels | 5.39ms | 1.82ms | -3.570ms | -66.2% | <.001 | -66.6..-64.2% |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans | 36.60ms | 12.26ms | -24.340ms | -66.5% | <.001 | -66.7..-66.0% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 46.66ms | 15.13ms | -31.530ms | -67.6% | <.001 | -67.7..-67.4% |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 43.34ms | 13.81ms | -29.530ms | -68.1% | <.001 | -68.4..-68.0% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication | 20.77ms | 6.14ms | -14.630ms | -70.5% | <.001 | -70.7..-70.1% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans | 39.02ms | 11.36ms | -27.660ms | -70.9% | <.001 | -71.2..-70.2% |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 35.56ms | 9.99ms | -25.570ms | -71.9% | <.001 | -72.2..-71.8% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication | 174.67ms | 45.37ms | -129.300ms | -74.0% | <.001 | -74.3..-73.7% |
| 🟢 faster | 1000 labels first color-only scene publication | 3.08ms | 764.85µs | -2.315ms | -75.1% | <.001 | -75.7..-75.0% |
| 🟢 faster | 1000 labels last color-only scene publication | 3.09ms | 762.17µs | -2.328ms | -75.3% | <.001 | -76.3..-74.9% |
| 🟢 faster | 1000 labels first color-only engine publication | 2.80ms | 479.88µs | -2.320ms | -82.9% | <.001 | -83.4..-82.5% |
| 🟢 faster | 1000 labels last color-only engine publication | 2.82ms | 471.31µs | -2.349ms | -83.3% | <.001 | -83.6..-82.9% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates | 33.22ms | 4.90ms | -28.320ms | -85.2% | <.001 | -85.5..-85.1% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates | 32.89ms | 4.77ms | -28.120ms | -85.5% | <.001 | -85.8..-85.4% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication | 153.69ms | 18.24ms | -135.450ms | -88.1% | <.001 | -88.2..-87.6% |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans | 26.82ms | 2.69ms | -24.130ms | -90.0% | <.001 | -90.1..-89.9% |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 27.28ms | 2.66ms | -24.620ms | -90.2% | <.001 | -90.3..-90.1% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans | 32.02ms | 2.73ms | -29.290ms | -91.5% | <.001 | -91.6..-91.3% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 32.17ms | 2.72ms | -29.450ms | -91.5% | <.001 | -91.7..-91.4% |
| 🟢 faster | move 1000 retained TypeGPU labels | 3.12ms | 238.19µs | -2.882ms | -92.4% | <.001 | -93.0..-91.4% |
| 🟢 faster | normalize 1000 equivalent retained label updates | 30.40ms | 2.19ms | -28.210ms | -92.8% | <.001 | -92.9..-92.7% |

<details><summary>13 neutral, 5 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | 10 labels first length-changing scene publication | 454.19µs | 472.37µs | +0.018ms | +4.0% | .005 | +2.5..+6.8% |
| neutral | 10 labels first length-changing engine publication | 435.60µs | 453.62µs | +0.018ms | +4.1% | .010 | +2.0..+12.2% |
| neutral | 100 labels separated balanced grow-shrink-space scene publication | 814.77µs | 779.29µs | -0.035ms | -4.4% | .005 | -6.7..-2.3% |
| neutral | publish after text change | 2.06ms | 2.07ms | +0.010ms | +0.5% | .161 | -0.3..+1.4% |
| neutral | publish after color change | 1.52ms | 1.48ms | -0.040ms | -2.2% | .001 | -3.0..-0.9% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 223.77µs | 224.96µs | +0.001ms | +0.5% | .798 | -1.7..+3.3% |
| neutral | cached measurement | 32.02ns | 31.07ns | -0.000001ms | -3.0% | .021 | -5.3..-0.7% |
| neutral | 1 labels first same-value-set | 68.15ns | 69.57ns | +0.000001ms | +2.1% | .010 | +0.2..+2.9% |
| neutral | 100 labels first same-value-set | 68.42ns | 69.17ns | +0.000001ms | +1.1% | .105 | -0.1..+2.3% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels | 2.03ms | 1.07ms | -0.960ms | -47.5% | .105 | -50.4..+5.5% |
| neutral | issue 216 unsafe-boundary word-wrap reflow | 190.10µs | 179.98µs | -0.010ms | -5.3% | .038 | -8.0..-1.2% |
| neutral | long reporter workaround paragraph reflow | 562.46µs | 583.88µs | +0.021ms | +3.8% | <.001 | +3.0..+4.6% |
| neutral | long unsafe-boundary paragraph text edit | 1.65ms | 1.73ms | +0.080ms | +4.8% | <.001 | +3.9..+5.8% |
| skipped: timing-mode mismatch | measure 100 unchanged labels |  |  |  |  |  |  |
| skipped: timing-mode mismatch | cached per-glyph inspection |  |  |  |  |  |  |
| skipped: timing-mode mismatch | 100 labels first set+measure |  |  |  |  |  |  |
| skipped: timing-mode mismatch | 1000 labels first set+measure |  |  |  |  |  |  |
| skipped: timing-mode mismatch | write 1000 paragraph-order mutations |  |  |  |  |  |  |

</details>
