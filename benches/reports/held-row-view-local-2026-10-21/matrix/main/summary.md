## Package performance: `full` suite

92 faster · 30 slower · 22 neutral · 1 skipped

Baseline `0.1.0 (bbb3375c)` → candidate `0.1.0 (d2f7a01f)`

> ⚠ baseline CPU clock drifted 11.0% during its run

Latency distribution across 144 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 1.100ms | 0.809ms |
| Workloads ≤1 ms | 70 | 75 |
| Workloads ≤2 ms | 85 | 93 |
| Workloads ≤3 ms | 98 | 110 |
| Workloads >3 ms | 46 | 34 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 121.65ms | 45.61ms | -76.040ms |
| mutate one trailing span across 1000 formatted labels | 39.81ms | 37.34ms | -2.470ms |
| mount and publish a 22k-glyph paragraph | 17.41ms | 19.97ms | +2.560ms |
| publish 1024 retained Text instances | 15.42ms | 19.06ms | +3.640ms |
| 1000 labels 100 edits immediate measurements with publication | 90.98ms | 18.22ms | -72.760ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 100 labels first set                                                         ┊              ▶  +318.2%  <.001  █▃▁▁▁▁▁▁▁▁ ▁▁▇█▄▃▁▁▁▁
- 1 labels first set                                                           ┊              ▶  +289.3%  <.001  █▄▁▁▁▁▁▁▁▁ ▁▁▁▁█▆▃▂▁▁
- 1000 labels first set                                                        ┊              ▶  +259.4%  <.001  █▆▄▁▁▁▁▁▁▁ ▁▁▁▁▁▆█▃▂▁
- long unsafe-boundary paragraph reflow                                        ┊              ▶   +79.8%  <.001  ██▂▂▁▁▁▁▁▁ ▁▁▁▂█▃▁▂▁▁
- 100 labels first overwrite-before-scene-publication                          ┊             ├▶   +54.9%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▃█▄▃▂▁▁
- 1 labels first overwrite-before-scene-publication                            ┊         ├───●▶   +45.8%  <.001  █▁▁▁▁▁▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
- measure after text change                                                    ┊           ├●┤    +43.1%  <.001  ▁▁▁▁█▃▁▁▁▁ ▁▁▁▁▁▁▁█▂▁
- long reporter workaround paragraph reflow                                    ┊          ├●      +38.9%  <.001  ▂█▃▁▁▂▁▁▁▁ ▁▁▁▃█▂▁▁▂▁
- measurement after width change                                               ┊          ●┤      +37.0%  <.001  ▁▁▂█▂▁▁▁▁▁ ▁▁▁▁▁▂█▃▂▁
- rewrite 512 labels in one group                                              ┊         ├●       +36.6%  <.001  ▅█▅▂▁▁▁▁▁▁ ▁▁▁▁▄▄█▅▂▂
- copy per-glyph metrics from 100 unchanged labels                             ┊       ├─●─┤      +34.5%  <.001  ▅█▁▁▁▁▁▁▁▁ ▁▁▆█▂▁▁▁▁▁
- rewrite 128 labels in one group                                              ┊       ├─●        +32.6%  <.001  ██▃▂▁▁▁▁▁▁ ▁▁▁█▅▂▂▁▂▁
- rewrite 256 labels in one group                                              ┊        ●┤        +31.5%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▁▇█▃▃▂▁
- rewrite 64 labels in one group                                               ┊       ●┤         +27.7%  <.001  ▇█▃▁▁▂▁▁▁▁ ▁▁█▆▃▂▁▂▁▁
- publication after font-size change                                           ┊       ●┤         +27.1%  <.001  ▅█▂▁▁▁▁▁▁▁ ▁▁▁▁▁▄▄█▄▁
- type one character into a long Fredoka paragraph and measure                 ┊       ●          +27.0%  <.001  █▂▁▁▁▃▇▁▁▁ ▁▁▁▁▁▁▁█▂▁
- publish 1024 retained Text instances                                         ┊      ●─┤         +23.7%  <.001  █▁▁▁▁▁▁▁▁▁ ▁█▁▁▁▁▁▁▁▁
- relayout after font-size change                                              ┊    ├●            +18.5%  <.001  ▃█▂▂▂▁▁▁▁▁ ▁▁▁▄█▂▂▂▁▁
- 1000 labels first overwrite-before-scene-publication                         ┊   ├●┤            +16.7%  <.001  ▃█▅▃▄▃▂▁▁▁ ▁▁▁▆█▇▅▄▂▁
- mount and publish a 22k-glyph paragraph                                      ┊   ●┤             +14.7%  <.001  ▆█▅▂▁▁▁▁▁▁ ▁▁▁▁▁▂█▅▃▂
- 10 labels last same-length engine publication                                ┊  ├●─┤            +14.5%   .010  ▃█▅▅▃▂▁▁▁▁ ▁▁█▇▃▁▁▁▁▁
- mount 100 labels and borrow glyphs from each once                            ┊   ●              +13.5%  <.001  ▃█▄▂▂▂▁▁▁▁ ▁▁▁▄█▅▃▃▂▁
- cached measurement                                                           ┊ ├─●───┤          +13.1%   .007  ▇█▄▁▁▁▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
- publication after text change                                                ┊   ●              +12.6%  <.001  ▂█▄▃▂▁▁▁▁▁ ▁▁▁▃▇▆█▃▂▂
- 10 labels last same-length scene publication                                 ┊ ├●─┤             +10.9%   .007  ▂█▅▄▃▂▂▁▁▁ ▁▁█▇▃▂▂▁▁▁
- publish after color change                                                   ┊  ●               +10.9%  <.001  ▄█▂▁▁▁▂▁▁▁ ▁▁▅█▃▁▁▁▂▁
- 10 labels first same-length engine publication                               ┊ ├●┤               +9.7%   .007  ▂█▇▆▄▂▂▂▁▁ ▁▁██▃▂▂▂▂▁
- publish after text change                                                    ┊ ●┤                +8.2%  <.001  ▂█▄▁▁▂▁▁▁▁ ▁▁▅█▄▂▁▂▂▁
- long unsafe-boundary paragraph text edit                                     ┊ ●┤                +8.2%  <.001  ▄█▃▂▂▁▁▁▁▁ ▁▁█▅▂▁▂▁▁▁
- 10 labels last length-changing engine publication                            ┊├●─┤               +6.2%   .021  ▇█▂▁▁▁▁▁▁▁ ▂█▂▁▁▁▁▁▁▁
+ measure 1000 unchanged retained labels                                  ├──●┤┊                   -5.1%   .028  ▁▃█▅▃▂▁▁▁▁ ▂█▆▃▄▂▂▁▁▁
+ 100 labels first same-length engine publication                           ├●┤┊                   -5.7%   .021  ▁█▇▃▂▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
+ mutate one trailing span across 1000 formatted labels                   ├──●┤┊                   -6.2%  <.001  ▄█▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ reorder then edit one of 1000 retained labels                             ├●┤┊                   -6.3%   .005  ▁▄█▅▄▃▂▁▁▁ ▄█▄▃▂▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                   ├─● ┊                   -6.6%  <.001  ▁▂█▇▅▅▃▂▂▁ ▃█▆▃▄▂▁▁▁▁
+ 100 labels first same-length scene publication                          ├──● ┊                   -7.6%  <.001  ▁██▅▃▂▂▂▁▁ ▂█▄▂▁▁▁▁▁▁
+ 100 labels separated balanced gro…k-space engine publication              ├● ┊                   -7.9%  <.001  ▁▁▁▄█▅▂▂▁▁ ▁▄█▅▅▃▂▂▁▁
+ issue 216 unsafe-boundary word-wrap reflow                                ├●┤┊                   -7.9%  <.001  ▁█▇▃▂▁▁▁▁▁ ▃█▄▂▁▁▂▁▁▁
+ 10 labels no-op scene traversal                                          ├─●┤┊                   -8.0%   .001  ▁██▅▄▄▂▂▂▂ ▂█▅▄▂▂▂▂▁▁
+ 100 labels last same-length engine publication                            ├●┤┊                   -8.0%   .007  ▁▅█▅▃▂▂▂▁▁ ▂█▅▂▂▂▁▁▁▁
+ 100 labels separated balanced gro…nk-space scene publication              ●┤ ┊                   -8.4%  <.001  ▁▁▂██▅▂▂▂▁ ▂▆█▅▃▃▂▁▁▁
+ write 22k UTF16 text into Wasm request arena                             ├●┤ ┊                   -8.5%   .002  ▄█▂▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication              ●┤ ┊                   -8.6%  <.001  ▁▁▁▇█▃▂▂▁▁ ▁██▆▄▃▂▂▁▁
+ normalize 1000 equivalent formatted flow updates                          ●┤ ┊                   -8.9%  <.001  ▁▁▁▁▅█▂▂▃▂ ▁▄▅█▄▃▁▁▁▁
+ 100 labels last length-changing engine publication                       ├●┤ ┊                   -9.6%  <.001  ▁▂█▅▂▂▂▁▁▁ ▂█▅▂▁▂▁▁▁▁
+ 100 labels separated unbalanced g…k-space engine publication             ├●┤ ┊                  -10.3%   .003  ▁▁▃█▄▂▂▂▁▁ ▁▇█▄▃▂▂▁▁▁
+ issue 216 reporter workaround                                           ├─●  ┊                  -11.2%  <.001  ▁██▄▂▁▁▂▁▁ ▄█▃▂▁▁▁▁▁▁
+ 100 labels last length-changing scene publication                        ├●┤ ┊                  -11.6%  <.001  ▁▂█▆▃▂▂▂▂▁ ▃█▅▃▂▂▂▁▁▁
+ 10 labels last color-only scene publication                              ●─┤ ┊                  -12.1%   .005  ▁██▅▃▂▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
+ 10 labels first color-only scene publication                            ├●┤  ┊                  -12.2%  <.001  ▁█▄▂▁▁▁▁▁▁ ▆█▂▁▂▁▁▁▁▁
+ 10 labels first color-only engine publication                           ├●─┤ ┊                  -12.2%   .005  ▁▆█▆▄▂▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ type one character into a long paragraph and publish a frame             ●   ┊                  -14.0%  <.001  ▁▁▁▁▆█▂▂▂▁ ▃█▃▁▁▂▁▁▁▁
+ write 1000 paragraph and text mutations                                 ├●   ┊                  -14.4%  <.001  ▁▁▇█▃▂▁▁▁▁ ▂█▃▂▁▁▁▁▁▁
+ copy per-glyph metrics after text change                                ├●   ┊                  -14.8%  <.001  ▁▁▁▁▃█▄█▃▁ ▄▃▂▁█▂▁▁▁▁
+ 10 labels last color-only engine publication                           ├●─┤  ┊                  -15.4%  <.001  ▁█▇▅▃▂▂▂▁▁ ▄█▃▂▁▁▁▁▁▁
+ 1000 labels first set+measure                                          ├●┤   ┊                  -16.5%  <.001  ▄█▄▂▁▁▁▁▁▁ ██▂▁▁▁▁▁▁▁
+ 100 labels batched edit-read publication                                ●    ┊                  -17.2%  <.001  ▁▁▁▃▅█▃▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 1 labels                    ●    ┊                  -17.2%  <.001  ▁▂▇█▅▃▂▁▁▁ ▃█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 100 labels                 ├●    ┊                  -17.4%  <.001  ▁▁▃█▃▂▂▁▁▁ ▂█▃▂▂▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates           ├●    ┊                  -17.6%  <.001  ▁▁▁▁▃█▄▄▄▂ ▂▆█▄▂▁▁▁▁▁
+ 100 labels first set+measure+scene-publication                         ├●──┤ ┊                  -17.8%   .002  ▁▂█▅▃▂▂▂▁▁ ▃█▅▃▂▁▁▁▁▁
+ per-glyph inspection after width change                          ├──────●    ┊                  -17.9%  <.001  ▁▇▂▆▅▁▅▂▇█ ▂▁█▇▇▁▁▁▁▁
+ copy per-glyph metrics with outlines after text change                 ├●    ┊                  -18.2%  <.001  ▁▂▁▁▁▄▄▃█▂ ▃▃▂▁█▃▁▁▁▁
+ write 1000 paragraph-order mutations                                  ├─●┤   ┊                  -18.3%  <.001  ▄█▂▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ type one character into a long paragraph and measure                   ●┤    ┊                  -19.6%  <.001  █▂▁▁▁▁▁▂█▁ ▁▁▁▁▁▁█▂▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans           ●     ┊                  -19.8%  <.001  ▁▁▁▁▁▅▃█▃▁ ▅▄█▂▁▁▁▁▁▁
+ 100 labels first length-changing scene publication                    ├●┤    ┊                  -20.7%  <.001  ▁▁▂█▆▄▂▂▂▁ ▃█▆▃▂▂▁▁▁▁
+ 100 labels first length-changing engine publication                   ├●     ┊                  -20.7%  <.001  ▁▁▁█▆▂▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ common-safe word-wrap reflow                                        ├──●┤    ┊                  -21.5%  <.001  ▁▃█▄▂▂▁▁▂▁ ▄█▂▁▁▁▁▁▁▁
+ reflow after width change                                             ●┤     ┊                  -22.4%  <.001  ▁▁██▃▁▁▂▂▁ ▃█▃▂▁▁▁▁▁▁
+ edit and measure one of 100 retained labels                           ●─┤    ┊                  -22.9%  <.001  ▁▁██▄▂▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ 100 labels last color-only scene publication                         ├●┤     ┊                  -23.8%  <.001  ▁▁█▄▂▁▁▁▁▁ ▆█▃▂▂▁▁▁▁▁
+ measurement then publication after width change                      ●┤      ┊                  -25.1%  <.001  ▁▁▁▁▂▃█▂▁▁ ▁▁█▃▂▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                  ●┤      ┊                  -25.4%  <.001  ▁▁▁▁▁▁▅█▄▂ ▄█▅▁▁▁▁▁▁▁
+ 100 labels first color-only scene publication                        ●┤      ┊                  -25.7%  <.001  ▁▁█▄▂▁▁▁▁▁ ▅█▂▁▁▁▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                 ●┤      ┊                  -25.8%  <.001  ▁▁▃█▃▂▂▁▁▁ ▄█▂▂▂▁▁▁▁▁
+ 100 labels last color-only engine publication                        ●─┤     ┊                  -26.1%  <.001  ▁▁▇█▂▂▁▁▁▁ ▃█▃▂▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans         ●       ┊                  -27.2%  <.001  ▁▁▁▁▁▁█▆▄▂ █▅▂▁▁▁▁▁▁▁
+ 100 labels first color-only engine publication                    ├──●       ┊                  -27.4%  <.001  ▁▁▆█▃▂▂▁▂▁ ▃█▂▁▁▁▁▁▁▁
+ 1 labels first set+measure                                         ├─●─┤     ┊                  -27.4%  <.001  ▁▂█▆▇▅▃▂▂▁ ▃█▄▃▂▂▁▁▁▁
+ write one paragraph and text mutation                             ├──●───┤   ┊                  -27.7%   .007  ▃█▃▂▁▁▁▁▁▁ █▅▂▁▁▁▁▁▁▁
+ edit and independently copy one label among 1000 labels             ├●       ┊                  -28.2%  <.001  ▁▁▁▁▁█▄▂▂▂ ▃█▃▃▂▁▁▁▁▁
+ split move and merge paint boundaries preparation only              ●┤       ┊                  -28.9%  <.001  ▆▁▁▁▁▁▁▁▄█ ▁▁▁▁▁▁█▁▁▁
+ edit and measure one of 1000 retained labels                       ├●        ┊                  -29.3%  <.001  ▁▁▂█▃▃▂▁▁▁ ▃█▂▂▂▁▁▁▁▁
+ split move and merge paint boundaries publication                  ●         ┊                  -32.6%  <.001  ▁▁▁▁▁▂▅▇█▄ ▆█▁▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication       ●         ┊                  -32.9%  <.001  ▁▁▁▁▃▇█▃▂▁ ▂█▃▁▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans      ├●         ┊                  -34.5%  <.001  ▁▁▁▁▁▁▄█▄▂ █▅▁▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                   ●          ┊                  -36.1%  <.001  ▁▁▁▁▁▆█▅▃▁ ▄█▃▁▁▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication                  ├●┤         ┊                  -36.3%  <.001  ▁▁▁▁▁██▅▃▁ ▄█▄▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                    ●          ┊                  -37.0%  <.001  ▁▁▁▁▁▁█▆▄▂ ▅█▄▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans      ●          ┊                  -37.6%  <.001  ▁▁▁▁▃█▂▂▂▁ ▅█▂▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans     ├●          ┊                  -37.6%  <.001  ▁▁▁▁▁█▃▂▂▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication               ├●          ┊                  -38.2%  <.001  ▁▁▁▁▁▁▅█▅▁ ▄█▃▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans     ├●          ┊                  -38.2%  <.001  ▁▁▁▁▂█▄▂▂▁ ▃█▃▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication     ├●          ┊                  -38.3%  <.001  ▁▁▁▁▁▁▁██▂ ▄█▂▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans     ├●          ┊                  -38.3%  <.001  ▁▁▁▁▃█▄▂▂▁ ▅█▂▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication                  ●┤          ┊                  -38.4%  <.001  ▁▁▁▁▁▁█▆▄▂ ▁█▄▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▁▁▁▃█▂ ▃█▂▁▁▁▁▁▁▁
+ publication after width change                                   ●┤          ┊                  -39.0%  <.001  ▁▁▁▁▂█▇▂▁▁ ▇█▂▂▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●┤          ┊                  -39.1%  <.001  ▁▁▁▁▁▁▁██▂ ▃█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication              ●┤          ┊                  -39.2%  <.001  ▁▁▁▁▁▁█▆▃▁ ▅█▄▂▁▁▁▁▁▁
+ 1000 labels first same-length engine publication                 ●┤          ┊                  -39.4%  <.001  ▁▁▁▁▁▂█▅▄▂ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ●           ┊                  -39.8%  <.001  ▁▁▁▁█▄▁▁▁▁ █▅▁▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                    ├●           ┊                  -41.0%  <.001  ▁▁▁▁▁▁█▄▂▁ █▅▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans    ●            ┊                  -43.7%  <.001  ▁▁▁▁▁▁▁▆█▂ █▂▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●┤            ┊                  -45.1%  <.001  ▁▁▁▁▁▁▂█▂▁ ▅█▂▁▁▁▁▁▁▁
+ inspection then publication after width change                 ●┤            ┊                  -46.4%  <.001  ▁▅▃▁▁▂▁▂█▆ █▄█▆▄▂▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication   ●             ┊                  -47.5%  <.001  ▁▁▁▁▁▁▁█▂▁ █▄▂▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ●┤             ┊                  -48.4%  <.001  ▁▁▁▁▁▁▁█▄▂ █▇▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -50.7%  <.001  ▁▁▁▁▁▁▁▇█▂ █▆▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -61.3%  <.001  ▁▁▁▁▁▁▄█▆▂ █▂▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -61.7%  <.001  ▁▁▁▁▁▁█▄▃▁ █▆▂▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -62.2%  <.001  ▁▁▁▁▁▁▁█▆▂ █▃▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -62.5%  <.001  ▁▁▁▁▁▁▁▁█▅ █▁▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -62.6%  <.001  ▁▁▁▁▁▁█▃▂▁ █▆▂▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -64.5%  <.001  ▁▁▁▁▁▁▁▅█▁ █▁▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -67.8%  <.001  ▁▇▂▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -68.1%  <.001  ▁▁▁▁▁▁▂█▄▁ █▂▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -70.2%  <.001  ▁▁▁▁▁▁█▄▃▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -71.6%  <.001  ▁▁▁▁▁▁██▄▂ █▅▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -80.0%  <.001  ▁▁▁▁▁▁▁▁█▁ █▁▁▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -87.7%  <.001  ▁▁▁▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
  borrow glyphs from 1000 steadily promoted retained labels                   ├┼──●─┤             +11.6%   .105  █▂▂▁▁▁▁▃▇▁ ▁▅█▄▁▁▂▂█▁
  10 labels first same-length scene publication                            ├───┼─●┤                +5.8%   .234  ▅█▄▂▁▁▁▁▁▁ ▁█▂▂▁▁▁▁▁▁
  measure 100 unchanged labels                                                ├┼●─┤                +4.3%   .291  ▃█▂▂▁▁▁▁▁▁ ▂█▃▁▁▁▁▁▁▁
  cached per-glyph inspection                                                  ┊●┤                 +3.6%   .010  ▂█▄▂▁▁▁▁▁▁ ▁▇█▃▁▂▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                            ├●                  +3.2%   .003  ▁▁▁▁▂▅█▂▁▁ ▁▁▁▁▂▃█▂▁▁
  1000 labels no-op scene traversal                                           ├┼●┤                 +2.5%   .645  ▃█▆▃▂▁▁▁▁▁ ▁█▇▃▁▁▁▁▁▁
  100 labels first set+measure                                              ├──●───┤               +1.0%  1.000  ▂█▆▇▆▄▃▂▁▁ ▁▆█▆▄▅▃▂▁▁
  read every outline from an unchanged copy                                    ●                   +0.4%   .505  ▃█▂▁▁▁▁▁▁▁ ▅█▂▁▁▁▁▂▁▁
  move 1000 retained TypeGPU labels                                          ├─●─┤                 +0.4%   .798  ▁▃▇█▅▂▂▁▁▁ ▁▃▅█▇▂▁▁▁▁
  reuse 1000 unchanged Vue property snapshots                                  ●┤                  +0.3%   .279  ▁▂▄█▄▂▁▁▁▁ ▁▁▄█▅▃▁▁▁▁
  10 labels last length-changing scene publication                            ├●┤                  -0.4%  1.000  ▁▅█▅▄▃▂▁▁▁ ▁▃█▅▃▁▁▁▁▁
  10 labels first length-changing scene publication                           ├●┤                  -0.7%   .505  ▁▅█▅▄▃▂▁▁▁ ▁▄█▄▂▁▁▁▁▁
  mount a label and publish its first edit                                     ●                   -0.7%   .878  ▂█▄▂▂▂▁▁▁▁ ▂█▅▂▁▂▂▁▁▁
  toggle one group containing 1000 retained labels                           ├─●┤                  -0.8%   .645  ▂▇█▇▆▃▂▁▁▁ ▁▃█▆▄▂▁▁▁▁
  1000 labels first same-value-set                                           ├●┼──┤                -2.5%   .900  ▇█▃▁▁▁▂▂▂▁ ▅█▂▁▁▁▂▂▂▁
  1 labels first same-value-set                                              ├●┼─┤                 -2.6%   .817  █▅▁▁▁▁▁▁▁▁ █▆▁▁▁▁▁▁▁▁
  10 labels first length-changing engine publication                          ●┤                   -3.0%   .028  ▂▇█▆▆▃▂▂▁▁ ▁▅█▅▂▂▁▁▁▁
  write 22k UTF16 text into owned array control                             ├─●┼┤                  -3.0%   .279  ▆█▁▁▁▁▁▁▁▁ █▅▂▁▁▁▁▁▁▁
  100 labels no-op scene traversal                                          ├─●┤                   -3.1%   .130  ▁█▄▃▂▁▁▁▁▁ ▂█▄▃▁▁▁▁▁▁
  100 labels first same-value-set                                   ├─────────●┼───┤               -3.6%   .367  ██▂▂▂▂▁▁▁▁ █▇▂▁▂▁▁▁▁▁
  100 labels last same-length scene publication                              ├●┤                   -4.5%   .028  ▁▇█▄▂▂▁▂▁▁ ▂█▆▂▁▁▁▁▁▁
  1 labels first set+measure+scene-publication                            ├●───┼┤                 -14.1%   .065  ▂█▃▁▁▁▁▁▁▁ ▇█▂▁▁▁▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | 100 labels first set | 24.10µs | 100.79µs | +0.077ms | +318.2% | <.001 | +243.5..+368.7% |
| 🔴 slower | 1 labels first set | 23.21µs | 90.35µs | +0.067ms | +289.3% | <.001 | +278.0..+306.5% |
| 🔴 slower | 1000 labels first set | 35.33µs | 127.00µs | +0.092ms | +259.4% | <.001 | +195.9..+291.7% |
| 🔴 slower | long unsafe-boundary paragraph reflow | 356.79µs | 641.40µs | +0.285ms | +79.8% | <.001 | +76.1..+81.9% |
| 🔴 slower | 100 labels first overwrite-before-scene-publication | 322.60µs | 499.79µs | +0.177ms | +54.9% | <.001 | +47.9..+65.0% |
| 🔴 slower | 1 labels first overwrite-before-scene-publication | 249.12µs | 363.25µs | +0.114ms | +45.8% | <.001 | +32.5..+58.3% |
| 🔴 slower | measure after text change | 1.12ms | 1.61ms | +0.490ms | +43.1% | <.001 | +40.8..+46.1% |
| 🔴 slower | long reporter workaround paragraph reflow | 423.46µs | 587.98µs | +0.165ms | +38.9% | <.001 | +36.5..+40.1% |
| 🔴 slower | measurement after width change | 861.37µs | 1.18ms | +0.319ms | +37.0% | <.001 | +35.9..+39.2% |
| 🔴 slower | rewrite 512 labels in one group | 6.96ms | 9.51ms | +2.550ms | +36.6% | <.001 | +34.0..+38.3% |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels | 131.42µs | 176.73µs | +0.045ms | +34.5% | <.001 | +28.2..+39.1% |
| 🔴 slower | rewrite 128 labels in one group | 1.82ms | 2.41ms | +0.590ms | +32.6% | <.001 | +27.1..+34.1% |
| 🔴 slower | rewrite 256 labels in one group | 3.43ms | 4.51ms | +1.080ms | +31.5% | <.001 | +30.0..+33.6% |
| 🔴 slower | rewrite 64 labels in one group | 1.08ms | 1.38ms | +0.300ms | +27.7% | <.001 | +25.8..+29.5% |
| 🔴 slower | publication after font-size change | 6.22ms | 7.90ms | +1.680ms | +27.1% | <.001 | +26.6..+28.4% |
| 🔴 slower | type one character into a long Fredoka paragraph and measure | 1.59ms | 2.02ms | +0.430ms | +27.0% | <.001 | +25.6..+28.1% |
| 🔴 slower | publish 1024 retained Text instances | 15.42ms | 19.06ms | +3.640ms | +23.7% | <.001 | +21.7..+28.7% |
| 🔴 slower | relayout after font-size change | 1.78ms | 2.11ms | +0.330ms | +18.5% | <.001 | +17.0..+19.0% |
| 🔴 slower | 1000 labels first overwrite-before-scene-publication | 1.43ms | 1.67ms | +0.240ms | +16.7% | <.001 | +12.6..+18.9% |
| 🔴 slower | mount and publish a 22k-glyph paragraph | 17.41ms | 19.97ms | +2.560ms | +14.7% | <.001 | +14.0..+15.5% |
| 🔴 slower | 10 labels last same-length engine publication | 304.06µs | 348.06µs | +0.044ms | +14.5% | .010 | +10.7..+19.9% |
| 🔴 slower | mount 100 labels and borrow glyphs from each once | 9.85ms | 11.17ms | +1.320ms | +13.5% | <.001 | +12.4..+14.6% |
| 🔴 slower | cached measurement | 4.15µs | 4.69µs | +0.000540ms | +13.1% | .007 | +6.8..+26.7% |
| 🔴 slower | publication after text change | 6.47ms | 7.28ms | +0.810ms | +12.6% | <.001 | +11.7..+13.8% |
| 🔴 slower | 10 labels last same-length scene publication | 324.00µs | 359.31µs | +0.035ms | +10.9% | .007 | +5.9..+15.3% |
| 🔴 slower | publish after color change | 1.24ms | 1.38ms | +0.140ms | +10.9% | <.001 | +10.3..+11.3% |
| 🔴 slower | 10 labels first same-length engine publication | 316.33µs | 346.92µs | +0.031ms | +9.7% | .007 | +5.3..+14.2% |
| 🔴 slower | publish after text change | 1.91ms | 2.07ms | +0.160ms | +8.2% | <.001 | +7.3..+9.4% |
| 🔴 slower | long unsafe-boundary paragraph text edit | 1.61ms | 1.74ms | +0.130ms | +8.2% | <.001 | +7.1..+9.2% |
| 🔴 slower | 10 labels last length-changing engine publication | 442.08µs | 469.71µs | +0.028ms | +6.2% | .021 | +1.7..+13.3% |
| 🟢 faster | measure 1000 unchanged retained labels | 233.77µs | 221.94µs | -0.012ms | -5.1% | .028 | -15.5..-1.7% |
| 🟢 faster | 100 labels first same-length engine publication | 454.06µs | 428.04µs | -0.026ms | -5.7% | .021 | -8.5..-2.5% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels | 39.81ms | 37.34ms | -2.470ms | -6.2% | <.001 | -15.9..-4.9% |
| 🟢 faster | reorder then edit one of 1000 retained labels | 5.83ms | 5.47ms | -0.360ms | -6.3% | .005 | -8.4..-3.3% |
| 🟢 faster | reorder 1000 unchanged retained labels | 2.35ms | 2.20ms | -0.150ms | -6.6% | <.001 | -13.1..-5.6% |
| 🟢 faster | 100 labels first same-length scene publication | 509.15µs | 470.40µs | -0.039ms | -7.6% | <.001 | -16.1..-5.2% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication | 790.63µs | 728.02µs | -0.063ms | -7.9% | <.001 | -9.6..-7.0% |
| 🟢 faster | issue 216 unsafe-boundary word-wrap reflow | 194.60µs | 179.25µs | -0.015ms | -7.9% | <.001 | -10.0..-4.6% |
| 🟢 faster | 10 labels no-op scene traversal | 32.08µs | 29.52µs | -0.003ms | -8.0% | .001 | -13.1..-3.9% |
| 🟢 faster | 100 labels last same-length engine publication | 458.17µs | 421.38µs | -0.037ms | -8.0% | .007 | -9.7..-4.4% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication | 848.94µs | 777.85µs | -0.071ms | -8.4% | <.001 | -10.3..-7.3% |
| 🟢 faster | write 22k UTF16 text into Wasm request arena | 40.65µs | 37.19µs | -0.003ms | -8.5% | .002 | -12.4..-5.5% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication | 844.46µs | 771.46µs | -0.073ms | -8.6% | <.001 | -10.9..-7.0% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates | 5.24ms | 4.78ms | -0.460ms | -8.9% | <.001 | -9.1..-7.0% |
| 🟢 faster | 100 labels last length-changing engine publication | 616.02µs | 556.85µs | -0.059ms | -9.6% | <.001 | -12.7..-8.1% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication | 793.21µs | 711.65µs | -0.082ms | -10.3% | .003 | -14.0..-7.4% |
| 🟢 faster | issue 216 reporter workaround | 197.52µs | 175.35µs | -0.022ms | -11.2% | <.001 | -15.7..-8.9% |
| 🟢 faster | 100 labels last length-changing scene publication | 675.33µs | 596.77µs | -0.079ms | -11.6% | <.001 | -13.4..-7.8% |
| 🟢 faster | 10 labels last color-only scene publication | 280.56µs | 246.65µs | -0.034ms | -12.1% | .005 | -13.7..-6.8% |
| 🟢 faster | 10 labels first color-only scene publication | 288.75µs | 253.42µs | -0.035ms | -12.2% | <.001 | -18.0..-10.0% |
| 🟢 faster | 10 labels first color-only engine publication | 265.10µs | 232.69µs | -0.032ms | -12.2% | .005 | -18.2..-6.2% |
| 🟢 faster | type one character into a long paragraph and publish a frame | 3.29ms | 2.83ms | -0.460ms | -14.0% | <.001 | -14.7..-13.5% |
| 🟢 faster | write 1000 paragraph and text mutations | 85.13µs | 72.85µs | -0.012ms | -14.4% | <.001 | -16.1..-12.1% |
| 🟢 faster | copy per-glyph metrics after text change | 3.63ms | 3.09ms | -0.540ms | -14.8% | <.001 | -16.5..-12.6% |
| 🟢 faster | 10 labels last color-only engine publication | 264.63µs | 223.83µs | -0.041ms | -15.4% | <.001 | -21.5..-11.3% |
| 🟢 faster | 1000 labels first set+measure | 179.31µs | 149.67µs | -0.030ms | -16.5% | <.001 | -21.5..-13.0% |
| 🟢 faster | 100 labels batched edit-read publication | 5.41ms | 4.48ms | -0.930ms | -17.2% | <.001 | -18.3..-15.7% |
| 🟢 faster | edit and independently copy one label among 1 labels | 1.01ms | 839.33µs | -0.171ms | -17.2% | <.001 | -18.2..-16.3% |
| 🟢 faster | edit and independently copy one label among 100 labels | 1.14ms | 939.46µs | -0.201ms | -17.4% | <.001 | -18.6..-16.0% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates | 5.99ms | 4.94ms | -1.050ms | -17.6% | <.001 | -18.6..-16.5% |
| 🟢 faster | 100 labels first set+measure+scene-publication | 602.94µs | 495.77µs | -0.107ms | -17.8% | .002 | -20.4..-6.5% |
| 🟢 faster | per-glyph inspection after width change | 5.32ms | 4.37ms | -0.950ms | -17.9% | <.001 | -39.4..-15.1% |
| 🟢 faster | copy per-glyph metrics with outlines after text change | 3.77ms | 3.09ms | -0.680ms | -18.2% | <.001 | -20.5..-15.7% |
| 🟢 faster | write 1000 paragraph-order mutations | 15.33µs | 12.52µs | -0.003ms | -18.3% | <.001 | -22.2..-14.8% |
| 🟢 faster | type one character into a long paragraph and measure | 2.13ms | 1.71ms | -0.420ms | -19.6% | <.001 | -20.2..-17.9% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans | 20.25ms | 16.24ms | -4.010ms | -19.8% | <.001 | -20.5..-18.7% |
| 🟢 faster | 100 labels first length-changing scene publication | 830.67µs | 658.88µs | -0.172ms | -20.7% | <.001 | -23.5..-15.3% |
| 🟢 faster | 100 labels first length-changing engine publication | 769.17µs | 609.67µs | -0.160ms | -20.7% | <.001 | -22.3..-19.6% |
| 🟢 faster | common-safe word-wrap reflow | 199.94µs | 156.88µs | -0.043ms | -21.5% | <.001 | -28.4..-17.4% |
| 🟢 faster | reflow after width change | 446.92µs | 346.77µs | -0.100ms | -22.4% | <.001 | -24.2..-20.5% |
| 🟢 faster | edit and measure one of 100 retained labels | 142.04µs | 109.56µs | -0.032ms | -22.9% | <.001 | -25.0..-17.7% |
| 🟢 faster | 100 labels last color-only scene publication | 387.44µs | 295.06µs | -0.092ms | -23.8% | <.001 | -25.6..-21.1% |
| 🟢 faster | measurement then publication after width change | 1.86ms | 1.39ms | -0.470ms | -25.1% | <.001 | -26.3..-24.6% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication | 8.96ms | 6.68ms | -2.280ms | -25.4% | <.001 | -26.6..-24.7% |
| 🟢 faster | 100 labels first color-only scene publication | 388.40µs | 288.60µs | -0.100ms | -25.7% | <.001 | -27.5..-23.5% |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels | 233.13µs | 172.92µs | -0.060ms | -25.8% | <.001 | -28.0..-22.1% |
| 🟢 faster | 100 labels last color-only engine publication | 332.94µs | 246.10µs | -0.087ms | -26.1% | <.001 | -28.0..-20.9% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans | 20.07ms | 14.60ms | -5.470ms | -27.2% | <.001 | -27.9..-26.6% |
| 🟢 faster | 100 labels first color-only engine publication | 340.19µs | 246.90µs | -0.093ms | -27.4% | <.001 | -35.4..-25.8% |
| 🟢 faster | 1 labels first set+measure | 156.71µs | 113.83µs | -0.043ms | -27.4% | <.001 | -33.2..-20.4% |
| 🟢 faster | write one paragraph and text mutation | 11.23µs | 8.12µs | -0.003ms | -27.7% | .007 | -35.5..-14.9% |
| 🟢 faster | edit and independently copy one label among 1000 labels | 2.53ms | 1.82ms | -0.710ms | -28.2% | <.001 | -29.2..-27.5% |
| 🟢 faster | split move and merge paint boundaries preparation only | 6.45ms | 4.59ms | -1.860ms | -28.9% | <.001 | -29.2..-27.9% |
| 🟢 faster | edit and measure one of 1000 retained labels | 206.60µs | 146.13µs | -0.060ms | -29.3% | <.001 | -32.2..-28.4% |
| 🟢 faster | split move and merge paint boundaries publication | 8.97ms | 6.04ms | -2.930ms | -32.6% | <.001 | -33.2..-32.4% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication | 2.83ms | 1.90ms | -0.930ms | -32.9% | <.001 | -34.3..-32.1% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans | 17.52ms | 11.48ms | -6.040ms | -34.5% | <.001 | -35.4..-33.8% |
| 🟢 faster | 1000 labels first same-length scene publication | 2.55ms | 1.63ms | -0.920ms | -36.1% | <.001 | -37.8..-35.2% |
| 🟢 faster | 1000 labels first set+measure+scene-publication | 2.67ms | 1.70ms | -0.970ms | -36.3% | <.001 | -39.2..-34.9% |
| 🟢 faster | 1000 labels last same-length scene publication | 2.58ms | 1.62ms | -0.960ms | -37.0% | <.001 | -37.5..-35.6% |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans | 4.30ms | 2.68ms | -1.620ms | -37.6% | <.001 | -38.2..-36.1% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 4.39ms | 2.74ms | -1.650ms | -37.6% | <.001 | -38.5..-37.2% |
| 🟢 faster | 1000 labels last length-changing scene publication | 3.06ms | 1.89ms | -1.170ms | -38.2% | <.001 | -38.9..-37.0% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans | 4.41ms | 2.72ms | -1.690ms | -38.2% | <.001 | -39.1..-37.3% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication | 4.83ms | 2.98ms | -1.850ms | -38.3% | <.001 | -38.9..-37.5% |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 4.33ms | 2.67ms | -1.660ms | -38.3% | <.001 | -39.7..-37.5% |
| 🟢 faster | 1000 labels last same-length engine publication | 2.30ms | 1.41ms | -0.890ms | -38.4% | <.001 | -39.9..-36.3% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication | 4.55ms | 2.80ms | -1.750ms | -38.5% | <.001 | -40.0..-38.2% |
| 🟢 faster | publication after width change | 1.13ms | 690.90µs | -0.439ms | -39.0% | <.001 | -39.4..-36.1% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication | 4.48ms | 2.73ms | -1.750ms | -39.1% | <.001 | -39.7..-38.0% |
| 🟢 faster | 1000 labels last length-changing engine publication | 2.76ms | 1.67ms | -1.090ms | -39.2% | <.001 | -40.8..-35.2% |
| 🟢 faster | 1000 labels first same-length engine publication | 2.30ms | 1.39ms | -0.910ms | -39.4% | <.001 | -40.5..-38.3% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication | 5.04ms | 3.03ms | -2.010ms | -39.8% | <.001 | -40.2..-38.8% |
| 🟢 faster | 100 labels interleaved edit-read publication | 17.88ms | 10.55ms | -7.330ms | -41.0% | <.001 | -41.8..-40.6% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 27.00ms | 15.21ms | -11.790ms | -43.7% | <.001 | -44.3..-43.2% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication | 3.79ms | 2.08ms | -1.710ms | -45.1% | <.001 | -45.6..-44.5% |
| 🟢 faster | inspection then publication after width change | 8.77ms | 4.70ms | -4.070ms | -46.4% | <.001 | -47.5..-42.3% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication | 11.77ms | 6.18ms | -5.590ms | -47.5% | <.001 | -47.9..-46.7% |
| 🟢 faster | 1000 labels first length-changing scene publication | 4.59ms | 2.37ms | -2.220ms | -48.4% | <.001 | -49.6..-48.0% |
| 🟢 faster | 1000 labels first length-changing engine publication | 4.30ms | 2.12ms | -2.180ms | -50.7% | <.001 | -51.3..-50.3% |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans | 33.09ms | 12.82ms | -20.270ms | -61.3% | <.001 | -61.6..-60.6% |
| 🟢 faster | 1000 labels first color-only scene publication | 2.02ms | 774.48µs | -1.246ms | -61.7% | <.001 | -62.7..-60.4% |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans | 32.38ms | 12.25ms | -20.130ms | -62.2% | <.001 | -62.4..-61.5% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication | 121.65ms | 45.61ms | -76.040ms | -62.5% | <.001 | -62.7..-62.1% |
| 🟢 faster | 1000 labels last color-only scene publication | 2.02ms | 755.19µs | -1.265ms | -62.6% | <.001 | -63.3..-61.1% |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 39.23ms | 13.91ms | -25.320ms | -64.5% | <.001 | -65.3..-64.0% |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 40.05ms | 12.91ms | -27.140ms | -67.8% | <.001 | -68.5..-67.4% |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 31.57ms | 10.09ms | -21.480ms | -68.1% | <.001 | -68.3..-67.7% |
| 🟢 faster | 1000 labels first color-only engine publication | 1.63ms | 486.42µs | -1.144ms | -70.2% | <.001 | -71.5..-69.4% |
| 🟢 faster | 1000 labels last color-only engine publication | 1.66ms | 471.06µs | -1.189ms | -71.6% | <.001 | -72.1..-69.8% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication | 90.98ms | 18.22ms | -72.760ms | -80.0% | <.001 | -80.1..-79.8% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans | 137.16ms | 16.87ms | -120.290ms | -87.7% | <.001 | -87.7..-87.6% |

<details><summary>22 neutral, 1 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | 10 labels first same-length scene publication | 347.75µs | 367.92µs | +0.020ms | +5.8% | .234 | -13.2..+11.4% |
| neutral | 10 labels first length-changing scene publication | 477.23µs | 473.94µs | -0.003ms | -0.7% | .505 | -2.2..+1.9% |
| neutral | 10 labels first length-changing engine publication | 472.67µs | 458.50µs | -0.014ms | -3.0% | .028 | -4.7..-0.7% |
| neutral | 10 labels last length-changing scene publication | 465.77µs | 463.98µs | -0.002ms | -0.4% | 1.000 | -3.7..+2.2% |
| neutral | 100 labels no-op scene traversal | 62.19µs | 60.25µs | -0.002ms | -3.1% | .130 | -8.9..+1.4% |
| neutral | 100 labels last same-length scene publication | 488.06µs | 466.08µs | -0.022ms | -4.5% | .028 | -6.4..-1.5% |
| neutral | 1000 labels no-op scene traversal | 379.77µs | 389.29µs | +0.010ms | +2.5% | .645 | -2.7..+5.0% |
| neutral | mount a label and publish its first edit | 2.29ms | 2.27ms | -0.020ms | -0.7% | .878 | -1.2..+0.9% |
| neutral | measure 100 unchanged labels | 17.79µs | 18.56µs | +0.000770ms | +4.3% | .291 | -2.0..+9.1% |
| neutral | reuse 1000 unchanged Vue property snapshots | 188.65µs | 189.23µs | +0.000580ms | +0.3% | .279 | -0.7..+2.6% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 216.83µs | 223.79µs | +0.007ms | +3.2% | .003 | +1.3..+4.8% |
| neutral | cached per-glyph inspection | 64.96µs | 67.29µs | +0.002ms | +3.6% | .010 | +1.8..+6.9% |
| neutral | read every outline from an unchanged copy | 865.38µs | 868.69µs | +0.003ms | +0.4% | .505 | -1.3..+1.2% |
| neutral | 1 labels first set+measure+scene-publication | 416.42µs | 357.83µs | -0.059ms | -14.1% | .065 | -17.2..+2.2% |
| neutral | 1 labels first same-value-set | 2.38µs | 2.31µs | -0.000070ms | -2.6% | .817 | -5.3..+7.9% |
| neutral | 100 labels first set+measure | 126.13µs | 127.38µs | +0.001ms | +1.0% | 1.000 | -10.6..+14.6% |
| neutral | 100 labels first same-value-set | 2.92µs | 2.81µs | -0.000110ms | -3.6% | .367 | -36.8..+14.3% |
| neutral | 1000 labels first same-value-set | 4.90µs | 4.77µs | -0.000130ms | -2.5% | .900 | -7.2..+8.5% |
| neutral | write 22k UTF16 text into owned array control | 40.63µs | 39.40µs | -0.001ms | -3.0% | .279 | -8.6..+3.1% |
| neutral | toggle one group containing 1000 retained labels | 431.15µs | 427.52µs | -0.004ms | -0.8% | .645 | -5.5..+3.8% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels | 990.21µs | 1.11ms | +0.120ms | +11.6% | .105 | -4.9..+15.9% |
| neutral | move 1000 retained TypeGPU labels | 254.96µs | 255.98µs | +0.001ms | +0.4% | .798 | -5.8..+5.5% |
| skipped: clock-confounded: neutral→faster · 4.13→3.79 | normalize 1000 equivalent retained label updates |  |  |  |  |  |  |

</details>
