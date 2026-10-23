Candidate timings reuse a saved run; only the baseline was measured in this job. CPU model, architecture, Node version, suite, blocks and package digest match. Separate-run machine variability remains.

## Package performance: `full` suite

104 faster · 28 slower · 11 neutral · 0 skipped

Baseline `0.1.0 (6e2bf7bd)` → candidate `0.1.0 (d2f7a01f)`

Latency distribution across 143 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 1.300ms | 0.778ms |
| Workloads ≤1 ms | 69 | 74 |
| Workloads ≤2 ms | 79 | 92 |
| Workloads ≤3 ms | 90 | 110 |
| Workloads >3 ms | 53 | 33 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 177.13ms | 45.61ms | -131.520ms |
| mutate one trailing span across 1000 formatted labels | 57.43ms | 37.34ms | -20.090ms |
| mount and publish a 22k-glyph paragraph | 18.63ms | 19.97ms | +1.340ms |
| publish 1024 retained Text instances | 15.35ms | 19.06ms | +3.710ms |
| 1000 labels 100 edits immediate measurements with publication | 153.62ms | 18.22ms | -135.400ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 100 labels first set                                                         ┊              ▶  +378.1%  <.001  █▃▁▁▁▁▁▁▁▁ ▁▁▆█▄▃▂▁▁▁
- 1 labels first set                                                           ┊              ▶  +343.0%  <.001  █▃▁▁▁▁▁▁▁▁ ▁▁▁▁█▆▃▂▁▁
- 1000 labels first set                                                        ┊              ▶  +317.8%  <.001  █▄▂▁▁▁▁▁▁▁ ▁▁▁▁▁▆█▃▂▁
- type one character into a long paragraph and measure                         ┊              ▶  +274.0%  <.001  █▂▁▁▁▁▁▁█▂ ▁▁▁▁▁▁█▂▁▁
- copy per-glyph metrics from 100 unchanged labels                             ┊              ▶   +83.4%  <.001  ▆█▁▁▁▁▁▁▁▁ ▁▁▁▁▂█▃▁▁▁
- 100 labels first overwrite-before-scene-publication                          ┊        ├─●─┤     +35.7%  <.001  ▃█▃▂▂▁▁▁▁▁ ▁▁▁█▇▄▃▂▁▁
- 1 labels first overwrite-before-scene-publication                            ┊        ├●───┤    +34.5%  <.001  █▁▁▁▁▁▁▁▁▁ █▆▁▁▁▁▁▁▁▁
- long unsafe-boundary paragraph reflow                                        ┊         ●┤       +33.3%  <.001  ▂█▃▂▂▁▁▁▁▁ ▁▁▁█▅▂▁▂▁▁
- rewrite 512 labels in one group                                              ┊       ●┤         +27.5%  <.001  ▃█▅▂▁▁▁▁▁▁ ▁▁▁▃▄▅█▄▂▂
- measurement after width change                                               ┊       ●┤         +26.4%  <.001  ▁▂▃▂█▃▂▁▁▁ ▁▁▁▁▁▂█▅▂▁
- type one character into a long Fredoka paragraph and measure                 ┊      ●┤          +24.4%  <.001  ▇▂▁▁▁▁█▁▁▁ ▁▁▁▁▁▁▁█▂▁
- publish 1024 retained Text instances                                         ┊      ●─┤         +24.2%  <.001  █▁▁▁▁▁▁▁▁▁ ▁█▁▁▁▁▁▁▁▁
- publication after font-size change                                           ┊     ●┤           +20.4%  <.001  ▃█▃▁▁▁▁▁▁▁ ▁▁▁▁▁▇▅█▄▁
- cached per-glyph inspection                                                  ┊    ├●            +18.5%  <.001  ▅█▃▂▁▁▁▁▁▁ ▁▁█▄▂▁▁▁▁▁
- cached measurement                                                           ┊  ├─●─┤           +16.6%  <.001  ▆█▃▂▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
- rewrite 256 labels in one group                                              ┊    ●             +16.4%  <.001  ▂█▄▂▂▁▁▁▁▁ ▁▁▁▆█▄▂▂▁▁
- rewrite 128 labels in one group                                              ┊   ●┤             +13.9%  <.001  ▅█▃▂▂▁▁▁▁▁ ▁▂█▅▃▂▂▁▁▁
- borrow glyphs from 1000 steadily promoted retained labels                    ┊ ├●─┤             +11.2%   .010  ▆▃▂▁▁▁▁▁█▁ ▁▅█▄▁▁▂▂█▂
- 1000 labels no-op scene traversal                                            ┊ ├●┤              +10.7%  <.001  ▃█▃▅▂▁▁▁▁▁ ▁▄█▃▂▁▁▁▁▁
- 1000 labels first same-value-set                                             ┊├─●──┤             +8.5%   .007  █▆▂▁▁▂▂▂▁▁ ▄█▂▁▁▁▂▂▂▁
- 10 labels last length-changing engine publication                            ┊ ├●─┤              +8.4%   .001  ▇█▂▁▁▁▁▁▁▁ ▁█▂▁▁▁▁▁▁▁
- relayout after font-size change                                              ┊ ●┤                +8.1%  <.001  ▄█▂▁▂▂▁▁▁▁ ▁▁▆█▂▂▂▂▁▁
- toggle one group containing 1000 retained labels                             ┊├●─┤               +7.9%   .005  ▃█▆▆▅▃▂▁▁▁ ▁▂▅█▅▅▂▂▁▁
- publication after text change                                                ┊ ●┤                +7.7%  <.001  █▃▁▁▁▁▁▁▁▁ ▂█▁▁▁▁▁▁▁▁
- mount and publish a 22k-glyph paragraph                                      ┊ ●┤                +7.2%  <.001  ▃█▇▅▄▂▁▁▁▁ ▁▁▁▁▄█▇▃▃▂
- measure 1000 unchanged retained labels                                       ┊├●┤                +6.3%   .005  ▂█▇▄▂▁▁▁▁▁ ▁▅█▄▃▂▂▁▁▁
- rewrite 64 labels in one group                                               ┊ ●                 +6.1%  <.001  ▂█▃▁▁▁▂▁▁▁ ▁█▆▃▂▂▁▁▂▁
- 10 labels last length-changing scene publication                             ┊├●                 +5.1%  <.001  ▁█▆▄▃▂▁▁▁▁ ▁▃█▆▃▂▁▁▁▁
+ issue 216 unsafe-boundary word-wrap reflow                                ├─●┊                   -4.9%   .007  ▁█▆▃▁▁▁▂▂▁ ▃█▄▂▁▁▁▁▁▁
+ 100 labels separated balanced gro…nk-space scene publication               ├●┊                   -5.0%  <.001  ▁▁▅█▅▂▂▁▁▁ ▂▆█▅▃▂▂▁▁▁
+ 100 labels separated balanced gro…k-space engine publication               ●┤┊                   -5.4%  <.001  ▁▁▂██▅▃▂▂▁ ▁▄█▆▅▃▃▂▁▁
+ mount 100 labels and borrow glyphs from each once                          ● ┊                   -6.1%  <.001  ▁▁▂█▆▄▂▂▁▁ ▂█▅▃▂▂▂▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication              ├●┤┊                   -6.6%  <.001  ▁▁▃█▇▄▃▂▂▁ ▁▇█▆▄▃▂▂▁▁
+ 1000 labels first overwrite-before-scene-publication                      ├●┤┊                   -6.6%   .001  ▁▂█▇▆▅▄▃▂▁ ▂█▇▆▄▃▂▁▁▁
+ 100 labels separated unbalanced g…k-space engine publication              ●┤ ┊                   -9.1%   .005  ▁▁▃█▆▃▃▂▁▁ ▁▇█▅▃▃▂▂▁▁
+ publish after color change                                                ●  ┊                   -9.5%  <.001  ▁▁▂█▃▂▁▁▁▁ ▅█▃▂▁▁▂▁▁▁
+ 1 labels first same-value-set                                           ├─●─┤┊                   -9.7%   .019  █▆▁▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ 100 labels last length-changing engine publication                       ├●┤ ┊                   -9.9%  <.001  ▁▁▆█▄▂▂▂▁▁ ▂█▇▃▂▂▂▁▁▁
+ 100 labels last length-changing scene publication                        ├●┤ ┊                  -10.9%  <.001  ▁▃█▇▄▂▂▂▁▁ ▂█▅▃▂▂▂▁▁▁
+ 10 labels first same-length scene publication                           ├●─┤ ┊                  -12.1%  <.001  ▁▅█▅▂▁▁▁▁▁ ▂█▃▂▂▁▁▁▁▁
+ issue 216 reporter workaround                                          ├─●┤  ┊                  -12.2%  <.001  ▁▇█▄▂▁▂▂▂▁ ▄█▃▂▁▁▂▁▁▁
+ 10 labels first same-length engine publication                        ├──●┤  ┊                  -12.4%   .005  ▁▃█▆▄▂▂▁▂▁ ▂█▄▂▂▁▁▁▁▁
+ 10 labels last same-length engine publication                            ●┤  ┊                  -12.4%  <.001  ▁▄█▆▃▂▁▁▁▁ ▂█▅▂▁▁▁▁▁▁
+ reorder then edit one of 1000 retained labels                            ●┤  ┊                  -13.5%  <.001  ▁▁▁▆█▃▄▂▂▁ ▅█▄▂▂▂▁▁▁▁
+ mount a label and publish its first edit                                 ●   ┊                  -13.6%  <.001  ▁▁▄█▃▂▁▁▁▁ ▃█▄▂▂▂▁▁▁▁
+ 10 labels last same-length scene publication                            ├●   ┊                  -13.7%  <.001  ▁▄█▅▄▂▁▁▂▁ ▂█▄▂▁▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                  ├●   ┊                  -14.4%  <.001  ▁▁▁▆█▇▅▄▂▁ ▃█▆▃▃▂▁▁▁▁
+ measurement then publication after width change                         ├●   ┊                  -14.7%  <.001  ▁▂▁▁█▂▁▁▁▁ ▁▁█▃▂▁▁▁▁▁
+ type one character into a long paragraph and publish a frame            ├●   ┊                  -14.8%  <.001  ▁▁▁▁█▇▃▂▂▁ ▃█▃▂▂▂▁▁▁▁
+ common-safe word-wrap reflow                                         ├─●┤    ┊                  -19.5%  <.001  ▁▃█▄▂▁▁▂▁▁ ▄█▂▁▁▁▁▁▁▁
+ 100 labels first length-changing engine publication                  ├─●     ┊                  -21.3%  <.001  ▁▁▁█▇▂▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 1 labels                  ├●     ┊                  -21.3%  <.001  ▁▁▃█▄▂▂▁▁▁ ▃█▃▂▁▁▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                  ├●     ┊                  -21.3%  <.001  ▁▁▃█▅▂▂▂▁▁ ▄█▃▂▂▂▁▁▁▁
+ write 22k UTF16 text into owned array control                        ├●─┤    ┊                  -21.8%  <.001  ▁█▂▁▁▁▁▁▁▁ █▄▂▁▁▁▁▁▁▁
+ write 1000 paragraph-order mutations                                  ●┤     ┊                  -22.2%  <.001  ▂█▂▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ 100 labels first length-changing scene publication                    ●─┤    ┊                  -22.4%  <.001  ▁▁▁█▆▃▂▂▁▁ ▃█▅▃▂▂▁▁▁▁
+ 1000 labels first set+measure                                        ├●─┤    ┊                  -22.4%  <.001  ▁▂█▄▆▇▄▂▂▁ ▂█▆▃▂▂▁▁▁▁
+ edit and measure one of 100 retained labels                          ├●┤     ┊                  -23.1%  <.001  ▁▁▅█▄▃▂▂▂▁ ▃█▄▃▂▁▁▁▁▁
+ write 1000 paragraph and text mutations                               ●      ┊                  -24.0%  <.001  ▁█▂▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
+ edit and measure one of 1000 retained labels                        ├●┤      ┊                  -25.2%  <.001  ▁▁▄█▃▂▂▁▁▁ ▃█▃▂▂▁▁▁▁▁
+ 100 labels first same-length engine publication                      ●┤      ┊                  -25.6%  <.001  ▁▁▁█▅▃▁▂▁▁ ▂█▃▂▁▁▁▁▁▁
+ write 22k UTF16 text into Wasm request arena                         ●┤      ┊                  -26.3%  <.001  ▁█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels first same-length scene publication                      ├●       ┊                  -26.9%  <.001  ▁▁▁▇█▃▂▂▂▁ ▂█▃▁▁▁▁▁▁▁
+ 100 labels batched edit-read publication                             ●       ┊                  -26.9%  <.001  ▁▁▁▁▂▅█▄▂▁ ▃█▃▂▁▁▁▁▁▁
+ 100 labels last same-length scene publication                       ├●┤      ┊                  -27.7%  <.001  ▁▁▁█▇▃▂▂▂▁ ▂█▃▁▁▁▁▁▁▁
+ 100 labels last same-length engine publication                      ●┤       ┊                  -28.9%  <.001  ▁█▂▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ write one paragraph and text mutation                              ├●─────┤  ┊                  -30.0%   .007  ▃█▂▂▁▁▁▁▁▁ █▅▃▁▁▁▁▁▁▁
+ reflow after width change                                          ├●        ┊                  -31.0%  <.001  ▁▁▃█▇▂▁▁▂▁ ▄█▃▁▁▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                ●┤        ┊                  -31.9%  <.001  ▁▁▁▁▁▁▁█▇▂ ▅█▃▁▁▁▁▁▁▁
+ split move and merge paint boundaries preparation only             ●         ┊                  -33.3%  <.001  ▅▁▁▁▁▁▁▁▂█ ▁▁▁▁▁██▁▁▁
+ 100 labels first set+measure+scene-publication                     ●──┤      ┊                  -33.7%  <.001  ▁▁▁██▄▂▂▁▁ ▄█▄▂▁▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication      ├●         ┊                  -33.9%  <.001  ▁▁▁▁▃█▇▃▁▁ ▂█▃▁▁▁▁▁▁▁
+ 1 labels first set+measure                                        ├●─┤       ┊                  -34.0%  <.001  ▁▁▆██▆▄▂▂▁ ▃█▄▂▂▁▁▁▁▁
+ mutate one trailing span across 1000 formatted labels             ├●         ┊                  -35.0%  <.001  ▁▁▁▁▁▁▄█▃▁ ▃█▁▁▁▁▁▁▁▁
+ 1 labels first set+measure+scene-publication                     ├●──┤       ┊                  -35.3%   .003  ▁▁█▃▁▁▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
+ edit and independently copy one label among 100 labels           ├●          ┊                  -36.6%  <.001  ▁▁▁▄█▃▂▁▁▁ ▅█▂▁▁▁▁▁▁▁
+ measure after text change                                         ●          ┊                  -37.0%  <.001  ▁▁▁▁▁▂█▃▂▁ █▅▂▁▁▁▁▁▁▁
+ split move and merge paint boundaries publication                 ●          ┊                  -37.0%  <.001  ▁▁▁▁▁▁▃▅█▃ ▇█▁▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication      ●          ┊                  -37.6%  <.001  ▁▁▁▁▁▁▁▆█▃ ▄█▃▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ├●          ┊                  -37.9%  <.001  ▁▁▁▁▁▁▁▅█▂ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▁▁▁█▅▁ ▃█▁▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●┤          ┊                  -38.8%  <.001  ▁▁▁▁▁▁▁█▃▁ ▂█▂▁▁▁▁▁▁▁
+ 10 labels first color-only scene publication                    ├●           ┊                  -40.1%  <.001  ▁▁▄█▄▂▁▁▁▁ ▇█▂▁▂▁▁▁▁▁
+ 1000 labels last length-changing scene publication               ●           ┊                  -40.3%  <.001  ▁▁▁▁▁▁▇█▅▂ ▄█▃▁▁▁▁▁▁▁
+ copy per-glyph metrics after text change                         ●           ┊                  -40.3%  <.001  ▁▁▁▁▁▆█▂▁▁ ▅▂█▁▁▁▁▁▁▁
+ 10 labels last color-only scene publication                     ├●           ┊                  -41.4%  <.001  ▁▁▂█▄▁▁▁▁▁ ▅█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ●┤           ┊                  -42.6%  <.001  ▁▁▁▁▁▁▇█▄▁ ▅█▃▁▁▁▁▁▁▁
+ 10 labels first color-only engine publication                  ├●┤           ┊                  -43.3%  <.001  ▁▁▂█▅▂▁▁▁▁ ▇█▃▂▂▁▁▁▁▁
+ publication after width change                                  ●┤           ┊                  -43.8%  <.001  ▁▁▁▂▂▅█▂▁▁ █▆▂▂▁▁▁▁▁▁
+ 10 labels last color-only engine publication                   ├●┤           ┊                  -44.4%  <.001  ▁▁▂█▄▂▁▁▁▁ █▇▂▂▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●             ┊                  -46.7%  <.001  ▁▁▁▁▁▁▄█▂▁ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication               ├●             ┊                  -47.3%  <.001  ▁▁▁▁▁▁▃█▃▁ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication               ├●             ┊                  -48.0%  <.001  ▁▁▁▁▁▁▂█▆▂ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                ├●             ┊                  -48.3%  <.001  ▁▁▁▁▁▁█▆▃▁ █▇▂▁▁▁▁▁▁▁
+ per-glyph inspection after width change                       ●─┤            ┊                  -48.4%  <.001  ▁▁▁█▁▁▇▃█▆ ▁▃█▄▅▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ●              ┊                  -50.0%  <.001  ▁▁▁▁▁▁▁█▇▂ █▇▁▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication               ◀┤             ┊                  -50.1%  <.001  ▁▁▁▁▁▁▁█▆▂ ▂█▂▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication              ◀              ┊                  -50.9%  <.001  ▁▁▁▁▁▁▃█▅▂ ▇█▁▁▁▁▁▁▁▁
+ inspection then publication after width change                ◀              ┊                  -52.1%  <.001  ▁▁▁▁▁▁▅▂█▄ █▆▆▄▃▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -52.2%  <.001  ▁▁▁▁▁▁▂█▂▁ █▅▁▁▁▁▁▁▁▁
+ 100 labels last color-only scene publication                  ◀              ┊                  -53.2%  <.001  ▁▁▁▄█▂▃▂▂▁ █▅▂▁▁▁▁▁▁▁
+ 100 labels first color-only scene publication                 ◀              ┊                  -54.9%  <.001  ▁▁▁▃█▃▂▂▁▁ █▅▂▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -56.4%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ 100 labels first color-only engine publication                ◀              ┊                  -57.2%  <.001  ▁▁▁▁█▃▁▁▁▁ █▆▂▁▁▁▁▁▁▁
+ 100 labels last color-only engine publication                 ◀              ┊                  -57.2%  <.001  ▁▁▁▂█▃▁▂▁▁ ██▂▂▁▁▁▁▁▁
+ reuse 1000 unchanged Vue property snapshots                   ◀              ┊                  -57.9%  <.001  ▁▁▁▁▁▁█▆▂▁ █▁▁▁▁▁▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans  ◀              ┊                  -59.4%  <.001  ▁▁▁▁▁▁▁▁█▇ █▄▁▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                  ◀              ┊                  -62.9%  <.001  ▁▁▁▁▁▁▁▆█▂ █▂▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -63.6%  <.001  ▁▁▁▁▁▁▁▂█▃ █▂▁▁▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -63.9%  <.001  ▁▁▁▁▁▁▁▁██ █▁▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -65.2%  <.001  ▁▁▁▁▁▁▁▂█▄ █▂▁▁▁▁▁▁▁▁
+ edit and independently copy one label among 1000 labels       ◀              ┊                  -66.1%  <.001  ▁▁▁▁▁▁█▄▃▁ █▄▁▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -66.6%  <.001  ▁▁▁▁▁▁▂█▂▁ █▂▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans  ◀              ┊                  -67.5%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -68.0%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ◀              ┊                  -70.4%  <.001  ▁▁▁▁▁▁▁█▆▁ █▂▁▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans  ◀              ┊                  -70.7%  <.001  ▁▁▁▁▁▁▁▁▆█ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -71.3%  <.001  ▁▁▁▁▁▁▁▂█▄ █▂▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -74.2%  <.001  ▁▁▁▁▁▁▁▂█▂ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -74.9%  <.001  ▁▁▁▁▁▁▁█▆▂ █▅▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -75.8%  <.001  ▁▁▁▁▁▁▁█▄▂ █▃▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -82.6%  <.001  ▁▁▁▁▁▁▁▇█▂ █▃▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -83.4%  <.001  ▁▁▁▁▁▁▁██▂ █▃▁▁▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates  ◀              ┊                  -85.3%  <.001  ▁▁▁▁▁▁▁▁█▃ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent formatted flow updates              ◀              ┊                  -85.4%  <.001  ▁▁▁▁▁▁▁▃█▂ █▁▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -88.1%  <.001  ▁▁▁▁▁▁▂█▁▁ █▁▁▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -90.1%  <.001  ▁▁▁▁▁▁▁▆█▂ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans  ◀              ┊                  -90.2%  <.001  ▁▁▁▁▁▁▁▂█▃ █▁▁▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans  ◀              ┊                  -91.5%  <.001  ▁▁▁▁▁▁▁▂█▆ █▁▁▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans  ◀              ┊                  -91.5%  <.001  ▁▁▁▁▁▁▁▂█▅ █▁▁▁▁▁▁▁▁▁
+ move 1000 retained TypeGPU labels                             ◀              ┊                  -92.0%  <.001  ▁▁▁▁▁▂▇█▄▂ █▁▁▁▁▁▁▁▁▁
+ normalize 1000 equivalent retained label updates              ◀              ┊                  -92.6%  <.001  ▁▁▁▁▁▁▁▅█▂ █▁▁▁▁▁▁▁▁▁
  10 labels no-op scene traversal                                             ├┼─●─┤               +8.3%   .137  ▃█▅▃▃▂▂▂▁▁ ▂█▅▄▂▂▂▂▁▁
  long unsafe-boundary paragraph text edit                                     ┊├●                 +5.0%  <.001  ▂█▃▂▂▁▁▁▁▁ ▁▂█▄▂▁▁▁▁▁
  10 labels first length-changing scene publication                            ┊●┤                 +4.3%  <.001  ▃█▅▄▂▁▁▁▁▁ ▁▆█▄▂▂▁▂▁▁
  10 labels first length-changing engine publication                           ├●─┤                +4.0%   .041  ▁██▅▃▂▂▂▁▁ ▁▃█▅▃▂▁▁▁▁
  long reporter workaround paragraph reflow                                    ┊●                  +3.6%   .010  ▂▆█▃▂▁▂▂▂▁ ▁▂█▄▁▁▁▂▁▁
  100 labels no-op scene traversal                                            ├┼●┤                 +1.9%   .553  ▄█▅▃▁▁▁▁▁▁ ▂█▄▃▂▁▁▁▁▁
  100 labels first same-value-set                                           ├──●──────────┤         0.0%   .896  █▆▁▁▁▁▁▁▁▁ ██▂▁▁▁▁▁▁▁
  publish after text change                                                    ●                   -0.1%   .959  ▁█▇▃▁▂▂▁▁▁ ▂█▇▃▂▁▁▂▁▁
  measure 100 unchanged labels                                               ├─●┤                  -0.6%   .398  ▂█▂▁▁▁▁▁▁▁ ▃█▃▁▁▁▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                           ├●                   -0.9%   .279  ▁▂▁▁▂█▆▂▁▁ ▁▂▁▂▂█▄▁▁▁
  100 labels first set+measure                                            ├──●─┼─┤                 -6.6%   .234  ▁█▆█▆▃▂▂▁▁ ▂█▇▅▅▃▂▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | 100 labels first set | 21.08µs | 100.79µs | +0.080ms | +378.1% | <.001 | +291.6..+417.2% |
| 🔴 slower | 1 labels first set | 20.40µs | 90.35µs | +0.070ms | +343.0% | <.001 | +316.3..+367.8% |
| 🔴 slower | 1000 labels first set | 30.40µs | 127.00µs | +0.097ms | +317.8% | <.001 | +281.3..+334.8% |
| 🔴 slower | type one character into a long paragraph and measure | 457.33µs | 1.71ms | +1.253ms | +274.0% | <.001 | +261.4..+285.7% |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels | 96.38µs | 176.73µs | +0.080ms | +83.4% | <.001 | +75.0..+92.9% |
| 🔴 slower | 100 labels first overwrite-before-scene-publication | 368.19µs | 499.79µs | +0.132ms | +35.7% | <.001 | +30.0..+43.5% |
| 🔴 slower | 1 labels first overwrite-before-scene-publication | 270.02µs | 363.25µs | +0.093ms | +34.5% | <.001 | +30.5..+46.4% |
| 🔴 slower | long unsafe-boundary paragraph reflow | 481.27µs | 641.40µs | +0.160ms | +33.3% | <.001 | +31.9..+35.3% |
| 🔴 slower | rewrite 512 labels in one group | 7.46ms | 9.51ms | +2.050ms | +27.5% | <.001 | +25.3..+28.7% |
| 🔴 slower | measurement after width change | 933.58µs | 1.18ms | +0.246ms | +26.4% | <.001 | +25.0..+28.8% |
| 🔴 slower | type one character into a long Fredoka paragraph and measure | 1.62ms | 2.02ms | +0.400ms | +24.4% | <.001 | +23.0..+25.4% |
| 🔴 slower | publish 1024 retained Text instances | 15.35ms | 19.06ms | +3.710ms | +24.2% | <.001 | +22.3..+29.8% |
| 🔴 slower | publication after font-size change | 6.56ms | 7.90ms | +1.340ms | +20.4% | <.001 | +19.9..+22.0% |
| 🔴 slower | cached per-glyph inspection | 56.77µs | 67.29µs | +0.011ms | +18.5% | <.001 | +15.9..+20.1% |
| 🔴 slower | cached measurement | 4.02µs | 4.69µs | +0.000670ms | +16.6% | <.001 | +9.5..+22.2% |
| 🔴 slower | rewrite 256 labels in one group | 3.87ms | 4.51ms | +0.640ms | +16.4% | <.001 | +15.2..+17.8% |
| 🔴 slower | rewrite 128 labels in one group | 2.12ms | 2.41ms | +0.290ms | +13.9% | <.001 | +11.8..+15.3% |
| 🔴 slower | borrow glyphs from 1000 steadily promoted retained labels | 993.75µs | 1.11ms | +0.116ms | +11.2% | .010 | +6.4..+18.2% |
| 🔴 slower | 1000 labels no-op scene traversal | 351.81µs | 389.29µs | +0.037ms | +10.7% | <.001 | +7.6..+13.8% |
| 🔴 slower | 1000 labels first same-value-set | 4.40µs | 4.77µs | +0.000370ms | +8.5% | .007 | +3.6..+21.3% |
| 🔴 slower | 10 labels last length-changing engine publication | 433.48µs | 469.71µs | +0.036ms | +8.4% | .001 | +5.4..+16.3% |
| 🔴 slower | relayout after font-size change | 1.95ms | 2.11ms | +0.160ms | +8.1% | <.001 | +7.1..+9.1% |
| 🔴 slower | toggle one group containing 1000 retained labels | 396.33µs | 427.52µs | +0.031ms | +7.9% | .005 | +4.0..+12.0% |
| 🔴 slower | publication after text change | 6.76ms | 7.28ms | +0.520ms | +7.7% | <.001 | +5.9..+8.6% |
| 🔴 slower | mount and publish a 22k-glyph paragraph | 18.63ms | 19.97ms | +1.340ms | +7.2% | <.001 | +5.4..+8.5% |
| 🔴 slower | measure 1000 unchanged retained labels | 208.69µs | 221.94µs | +0.013ms | +6.3% | .005 | +2.5..+9.7% |
| 🔴 slower | rewrite 64 labels in one group | 1.30ms | 1.38ms | +0.080ms | +6.1% | <.001 | +5.3..+7.0% |
| 🔴 slower | 10 labels last length-changing scene publication | 441.67µs | 463.98µs | +0.022ms | +5.1% | <.001 | +3.2..+7.6% |
| 🟢 faster | issue 216 unsafe-boundary word-wrap reflow | 188.46µs | 179.25µs | -0.009ms | -4.9% | .007 | -10.3..-2.4% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication | 818.90µs | 777.85µs | -0.041ms | -5.0% | <.001 | -7.9..-3.9% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication | 769.52µs | 728.02µs | -0.042ms | -5.4% | <.001 | -6.5..-4.3% |
| 🟢 faster | mount 100 labels and borrow glyphs from each once | 11.89ms | 11.17ms | -0.720ms | -6.1% | <.001 | -8.1..-5.1% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication | 825.71µs | 771.46µs | -0.054ms | -6.6% | <.001 | -9.5..-4.0% |
| 🟢 faster | 1000 labels first overwrite-before-scene-publication | 1.78ms | 1.67ms | -0.110ms | -6.6% | .001 | -9.4..-4.0% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication | 782.77µs | 711.65µs | -0.071ms | -9.1% | .005 | -10.7..-5.8% |
| 🟢 faster | publish after color change | 1.52ms | 1.38ms | -0.140ms | -9.5% | <.001 | -10.1..-9.0% |
| 🟢 faster | 1 labels first same-value-set | 2.56µs | 2.31µs | -0.000250ms | -9.7% | .019 | -16.9..-3.3% |
| 🟢 faster | 100 labels last length-changing engine publication | 618.17µs | 556.85µs | -0.061ms | -9.9% | <.001 | -12.2..-7.9% |
| 🟢 faster | 100 labels last length-changing scene publication | 669.52µs | 596.77µs | -0.073ms | -10.9% | <.001 | -12.7..-6.7% |
| 🟢 faster | 10 labels first same-length scene publication | 418.50µs | 367.92µs | -0.051ms | -12.1% | <.001 | -15.1..-7.3% |
| 🟢 faster | issue 216 reporter workaround | 199.71µs | 175.35µs | -0.024ms | -12.2% | <.001 | -18.9..-9.6% |
| 🟢 faster | 10 labels first same-length engine publication | 396.00µs | 346.92µs | -0.049ms | -12.4% | .005 | -21.8..-10.3% |
| 🟢 faster | 10 labels last same-length engine publication | 397.44µs | 348.06µs | -0.049ms | -12.4% | <.001 | -14.7..-8.7% |
| 🟢 faster | reorder then edit one of 1000 retained labels | 6.32ms | 5.47ms | -0.850ms | -13.5% | <.001 | -14.3..-9.8% |
| 🟢 faster | mount a label and publish its first edit | 2.63ms | 2.27ms | -0.360ms | -13.6% | <.001 | -14.3..-12.1% |
| 🟢 faster | 10 labels last same-length scene publication | 416.58µs | 359.31µs | -0.057ms | -13.7% | <.001 | -15.5..-12.6% |
| 🟢 faster | reorder 1000 unchanged retained labels | 2.56ms | 2.20ms | -0.360ms | -14.4% | <.001 | -16.1..-12.4% |
| 🟢 faster | measurement then publication after width change | 1.63ms | 1.39ms | -0.240ms | -14.7% | <.001 | -15.7..-14.1% |
| 🟢 faster | type one character into a long paragraph and publish a frame | 3.32ms | 2.83ms | -0.490ms | -14.8% | <.001 | -15.8..-14.3% |
| 🟢 faster | common-safe word-wrap reflow | 194.94µs | 156.88µs | -0.038ms | -19.5% | <.001 | -26.5..-15.8% |
| 🟢 faster | 100 labels first length-changing engine publication | 774.27µs | 609.67µs | -0.165ms | -21.3% | <.001 | -26.6..-19.7% |
| 🟢 faster | edit and independently copy one label among 1 labels | 1.07ms | 839.33µs | -0.231ms | -21.3% | <.001 | -22.5..-20.4% |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels | 219.79µs | 172.92µs | -0.047ms | -21.3% | <.001 | -23.8..-19.1% |
| 🟢 faster | write 22k UTF16 text into owned array control | 50.40µs | 39.40µs | -0.011ms | -21.8% | <.001 | -26.6..-16.5% |
| 🟢 faster | write 1000 paragraph-order mutations | 16.08µs | 12.52µs | -0.004ms | -22.2% | <.001 | -24.2..-18.9% |
| 🟢 faster | 100 labels first length-changing scene publication | 848.71µs | 658.88µs | -0.190ms | -22.4% | <.001 | -24.1..-17.6% |
| 🟢 faster | 1000 labels first set+measure | 192.96µs | 149.67µs | -0.043ms | -22.4% | <.001 | -25.7..-15.9% |
| 🟢 faster | edit and measure one of 100 retained labels | 142.44µs | 109.56µs | -0.033ms | -23.1% | <.001 | -28.1..-19.2% |
| 🟢 faster | write 1000 paragraph and text mutations | 95.85µs | 72.85µs | -0.023ms | -24.0% | <.001 | -24.9..-21.7% |
| 🟢 faster | edit and measure one of 1000 retained labels | 195.40µs | 146.13µs | -0.049ms | -25.2% | <.001 | -28.9..-24.1% |
| 🟢 faster | 100 labels first same-length engine publication | 575.33µs | 428.04µs | -0.147ms | -25.6% | <.001 | -27.7..-23.2% |
| 🟢 faster | write 22k UTF16 text into Wasm request arena | 50.44µs | 37.19µs | -0.013ms | -26.3% | <.001 | -27.6..-22.4% |
| 🟢 faster | 100 labels first same-length scene publication | 643.33µs | 470.40µs | -0.173ms | -26.9% | <.001 | -29.0..-25.1% |
| 🟢 faster | 100 labels batched edit-read publication | 6.13ms | 4.48ms | -1.650ms | -26.9% | <.001 | -28.1..-25.8% |
| 🟢 faster | 100 labels last same-length scene publication | 644.42µs | 466.08µs | -0.178ms | -27.7% | <.001 | -28.7..-24.0% |
| 🟢 faster | 100 labels last same-length engine publication | 592.27µs | 421.38µs | -0.171ms | -28.9% | <.001 | -30.5..-25.7% |
| 🟢 faster | write one paragraph and text mutation | 11.60µs | 8.12µs | -0.003ms | -30.0% | .007 | -34.9..-10.7% |
| 🟢 faster | reflow after width change | 502.75µs | 346.77µs | -0.156ms | -31.0% | <.001 | -32.5..-29.9% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication | 9.81ms | 6.68ms | -3.130ms | -31.9% | <.001 | -32.7..-31.2% |
| 🟢 faster | split move and merge paint boundaries preparation only | 6.87ms | 4.59ms | -2.280ms | -33.3% | <.001 | -33.7..-32.4% |
| 🟢 faster | 100 labels first set+measure+scene-publication | 747.67µs | 495.77µs | -0.252ms | -33.7% | <.001 | -34.9..-24.5% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication | 2.88ms | 1.90ms | -0.980ms | -33.9% | <.001 | -35.2..-32.8% |
| 🟢 faster | 1 labels first set+measure | 172.42µs | 113.83µs | -0.059ms | -34.0% | <.001 | -38.2..-26.6% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels | 57.43ms | 37.34ms | -20.090ms | -35.0% | <.001 | -35.8..-34.2% |
| 🟢 faster | 1 labels first set+measure+scene-publication | 553.46µs | 357.83µs | -0.196ms | -35.3% | .003 | -38.4..-25.8% |
| 🟢 faster | edit and independently copy one label among 100 labels | 1.48ms | 939.46µs | -0.541ms | -36.6% | <.001 | -40.8..-35.8% |
| 🟢 faster | measure after text change | 2.55ms | 1.61ms | -0.940ms | -37.0% | <.001 | -37.4..-36.3% |
| 🟢 faster | split move and merge paint boundaries publication | 9.60ms | 6.04ms | -3.560ms | -37.0% | <.001 | -37.5..-36.6% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication | 4.78ms | 2.98ms | -1.800ms | -37.6% | <.001 | -38.2..-36.8% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication | 4.89ms | 3.03ms | -1.860ms | -37.9% | <.001 | -38.6..-37.4% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication | 4.56ms | 2.80ms | -1.760ms | -38.5% | <.001 | -40.0..-38.2% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication | 4.46ms | 2.73ms | -1.730ms | -38.8% | <.001 | -39.3..-37.5% |
| 🟢 faster | 10 labels first color-only scene publication | 423.38µs | 253.42µs | -0.170ms | -40.1% | <.001 | -42.3..-39.1% |
| 🟢 faster | 1000 labels last length-changing scene publication | 3.17ms | 1.89ms | -1.280ms | -40.3% | <.001 | -41.2..-39.1% |
| 🟢 faster | copy per-glyph metrics after text change | 5.19ms | 3.09ms | -2.100ms | -40.3% | <.001 | -40.8..-39.0% |
| 🟢 faster | 10 labels last color-only scene publication | 420.88µs | 246.65µs | -0.174ms | -41.4% | <.001 | -42.9..-38.8% |
| 🟢 faster | 1000 labels last length-changing engine publication | 2.92ms | 1.67ms | -1.250ms | -42.6% | <.001 | -44.2..-38.7% |
| 🟢 faster | 10 labels first color-only engine publication | 410.17µs | 232.69µs | -0.177ms | -43.3% | <.001 | -46.3..-38.5% |
| 🟢 faster | publication after width change | 1.23ms | 690.90µs | -0.539ms | -43.8% | <.001 | -44.2..-41.3% |
| 🟢 faster | 10 labels last color-only engine publication | 402.88µs | 223.83µs | -0.179ms | -44.4% | <.001 | -45.3..-41.2% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication | 3.90ms | 2.08ms | -1.820ms | -46.7% | <.001 | -47.2..-46.2% |
| 🟢 faster | 1000 labels first set+measure+scene-publication | 3.23ms | 1.70ms | -1.530ms | -47.3% | <.001 | -49.5..-46.5% |
| 🟢 faster | 1000 labels first same-length scene publication | 3.13ms | 1.63ms | -1.500ms | -48.0% | <.001 | -48.7..-47.4% |
| 🟢 faster | 1000 labels last same-length scene publication | 3.14ms | 1.62ms | -1.520ms | -48.3% | <.001 | -49.0..-47.2% |
| 🟢 faster | per-glyph inspection after width change | 8.46ms | 4.37ms | -4.090ms | -48.4% | <.001 | -53.1..-44.9% |
| 🟢 faster | 1000 labels first length-changing scene publication | 4.73ms | 2.37ms | -2.360ms | -50.0% | <.001 | -51.0..-49.5% |
| 🟢 faster | 1000 labels last same-length engine publication | 2.84ms | 1.41ms | -1.430ms | -50.1% | <.001 | -50.9..-48.3% |
| 🟢 faster | 1000 labels first same-length engine publication | 2.84ms | 1.39ms | -1.450ms | -50.9% | <.001 | -51.8..-50.2% |
| 🟢 faster | inspection then publication after width change | 9.83ms | 4.70ms | -5.130ms | -52.1% | <.001 | -52.8..-51.5% |
| 🟢 faster | 1000 labels first length-changing engine publication | 4.44ms | 2.12ms | -2.320ms | -52.2% | <.001 | -52.7..-51.8% |
| 🟢 faster | 100 labels last color-only scene publication | 631.10µs | 295.06µs | -0.336ms | -53.2% | <.001 | -54.0..-52.5% |
| 🟢 faster | 100 labels first color-only scene publication | 639.42µs | 288.60µs | -0.351ms | -54.9% | <.001 | -56.1..-53.5% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans | 38.72ms | 16.87ms | -21.850ms | -56.4% | <.001 | -56.6..-56.1% |
| 🟢 faster | 100 labels first color-only engine publication | 576.52µs | 246.90µs | -0.330ms | -57.2% | <.001 | -58.6..-56.6% |
| 🟢 faster | 100 labels last color-only engine publication | 574.92µs | 246.10µs | -0.329ms | -57.2% | <.001 | -58.9..-54.5% |
| 🟢 faster | reuse 1000 unchanged Vue property snapshots | 449.75µs | 189.23µs | -0.261ms | -57.9% | <.001 | -58.4..-57.4% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans | 39.98ms | 16.24ms | -23.740ms | -59.4% | <.001 | -59.8..-58.8% |
| 🟢 faster | 100 labels interleaved edit-read publication | 28.47ms | 10.55ms | -17.920ms | -62.9% | <.001 | -63.3..-62.3% |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 35.46ms | 12.91ms | -22.550ms | -63.6% | <.001 | -64.0..-63.2% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans | 40.45ms | 14.60ms | -25.850ms | -63.9% | <.001 | -64.0..-63.6% |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans | 36.82ms | 12.82ms | -24.000ms | -65.2% | <.001 | -65.5..-65.0% |
| 🟢 faster | edit and independently copy one label among 1000 labels | 5.35ms | 1.82ms | -3.530ms | -66.1% | <.001 | -66.5..-65.7% |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans | 36.68ms | 12.25ms | -24.430ms | -66.6% | <.001 | -67.0..-66.1% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 46.85ms | 15.21ms | -31.640ms | -67.5% | <.001 | -67.8..-67.3% |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 43.44ms | 13.91ms | -29.530ms | -68.0% | <.001 | -68.2..-67.5% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication | 20.88ms | 6.18ms | -14.700ms | -70.4% | <.001 | -70.7..-69.9% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans | 39.12ms | 11.48ms | -27.640ms | -70.7% | <.001 | -70.9..-70.4% |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 35.18ms | 10.09ms | -25.090ms | -71.3% | <.001 | -71.6..-70.9% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication | 177.13ms | 45.61ms | -131.520ms | -74.2% | <.001 | -74.6..-74.0% |
| 🟢 faster | 1000 labels first color-only scene publication | 3.08ms | 774.48µs | -2.306ms | -74.9% | <.001 | -75.0..-74.1% |
| 🟢 faster | 1000 labels last color-only scene publication | 3.12ms | 755.19µs | -2.365ms | -75.8% | <.001 | -76.3..-74.9% |
| 🟢 faster | 1000 labels first color-only engine publication | 2.80ms | 486.42µs | -2.314ms | -82.6% | <.001 | -83.4..-82.2% |
| 🟢 faster | 1000 labels last color-only engine publication | 2.83ms | 471.06µs | -2.359ms | -83.4% | <.001 | -83.7..-82.5% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates | 33.59ms | 4.94ms | -28.650ms | -85.3% | <.001 | -85.7..-84.9% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates | 32.84ms | 4.78ms | -28.060ms | -85.4% | <.001 | -85.7..-85.2% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication | 153.62ms | 18.22ms | -135.400ms | -88.1% | <.001 | -88.2..-87.7% |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans | 27.05ms | 2.68ms | -24.370ms | -90.1% | <.001 | -90.1..-89.8% |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 27.32ms | 2.67ms | -24.650ms | -90.2% | <.001 | -90.4..-90.1% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans | 31.99ms | 2.72ms | -29.270ms | -91.5% | <.001 | -91.5..-91.0% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 32.17ms | 2.74ms | -29.430ms | -91.5% | <.001 | -91.6..-91.3% |
| 🟢 faster | move 1000 retained TypeGPU labels | 3.18ms | 255.98µs | -2.924ms | -92.0% | <.001 | -92.4..-91.7% |
| 🟢 faster | normalize 1000 equivalent retained label updates | 30.24ms | 2.23ms | -28.010ms | -92.6% | <.001 | -92.7..-92.5% |

<details><summary>11 neutral, 0 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | 10 labels no-op scene traversal | 27.27µs | 29.52µs | +0.002ms | +8.3% | .137 | -4.8..+13.3% |
| neutral | 10 labels first length-changing scene publication | 454.48µs | 473.94µs | +0.019ms | +4.3% | <.001 | +2.4..+5.9% |
| neutral | 10 labels first length-changing engine publication | 440.88µs | 458.50µs | +0.018ms | +4.0% | .041 | +0.3..+9.1% |
| neutral | 100 labels no-op scene traversal | 59.13µs | 60.25µs | +0.001ms | +1.9% | .553 | -3.9..+7.3% |
| neutral | publish after text change | 2.07ms | 2.07ms | 0.000ms | -0.1% | .959 | -0.6..+0.8% |
| neutral | measure 100 unchanged labels | 18.67µs | 18.56µs | -0.000110ms | -0.6% | .398 | -7.3..+2.9% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 225.73µs | 223.79µs | -0.002ms | -0.9% | .279 | -3.3..+0.9% |
| neutral | 100 labels first set+measure | 136.31µs | 127.38µs | -0.009ms | -6.6% | .234 | -17.7..+5.3% |
| neutral | 100 labels first same-value-set | 2.81µs | 2.81µs | 0.000ms | 0.0% | .896 | -11.6..+37.7% |
| neutral | long reporter workaround paragraph reflow | 567.48µs | 587.98µs | +0.021ms | +3.6% | .010 | +1.7..+4.5% |
| neutral | long unsafe-boundary paragraph text edit | 1.66ms | 1.74ms | +0.080ms | +5.0% | <.001 | +3.7..+5.9% |

</details>
