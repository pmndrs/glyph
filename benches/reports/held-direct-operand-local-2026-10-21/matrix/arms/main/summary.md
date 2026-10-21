## Package performance: `full` suite

94 faster · 27 slower · 21 neutral · 3 skipped

Baseline `0.1.0 (bbb3375c)` → candidate `0.1.0 (83949860)`

> ⚠ baseline CPU clock drifted 10.5% during its run

Latency distribution across 142 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic           | baseline | candidate |
| ------------------- | -------: | --------: |
| Median workload p50 |  1.135ms |   0.916ms |
| Workloads ≤1 ms     |       67 |        72 |
| Workloads ≤2 ms     |       82 |        90 |
| Workloads ≤3 ms     |       96 |       108 |
| Workloads >3 ms     |       46 |        34 |

Largest candidate workloads (including neutral results):

| workload                                                      | baseline | candidate |    Δ time |
| ------------------------------------------------------------- | -------: | --------: | --------: |
| 1000 labels 100 edits interleaved edit-read publication       | 121.36ms |   45.37ms | -75.990ms |
| mutate one trailing span across 1000 formatted labels         |  41.93ms |   37.17ms |  -4.760ms |
| publish 1024 retained Text instances                          |  15.31ms |   20.23ms |  +4.920ms |
| mount and publish a 22k-glyph paragraph                       |  17.53ms |   20.11ms |  +2.580ms |
| 1000 labels 100 edits immediate measurements with publication |  86.29ms |   18.24ms | -68.050ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 1 labels first set                                                           ┊              ▶  +1301.3%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁█▄▂▂▂▁
- 100 labels first set                                                         ┊              ▶  +1298.7%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▅█▃▂▂▁
- 1000 labels first set                                                        ┊              ▶  +405.6%  <.001  █▇▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁█▅▂▁
- long unsafe-boundary paragraph reflow                                        ┊              ▶   +80.2%  <.001  ██▂▂▁▁▁▁▁▁ ▁▁▁▁█▃▁▁▁▁
- 100 labels first overwrite-before-scene-publication                          ┊              ▶   +54.0%  <.001  ▂█▃▂▁▁▁▁▁▁ ▁▁▁▂█▄▂▁▁▁
- 1 labels first overwrite-before-scene-publication                            ┊            ●┤    +44.6%  <.001  ▃█▃▂▁▁▁▁▁▁ ▁▁▁▆█▄▂▁▁▁
- measure after text change                                                    ┊           ├●     +42.8%  <.001  ▁▁▁▁█▃▁▁▁▁ ▁▁▁▁▁▁▁█▂▁
- rewrite 512 labels in one group                                              ┊           ●┤     +41.6%  <.001  ▃█▅▂▁▁▁▁▁▁ ▁▁▁▁▃▄▅█▃▂
- publication after font-size change                                           ┊           ●┤     +39.7%  <.001  █▅▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁▆█▃▂
- long reporter workaround paragraph reflow                                    ┊          ├●      +38.8%  <.001  ▄█▃▁▁▂▁▁▁▁ ▁▁▁▅█▂▁▁▂▁
- measurement after width change                                               ┊         ├●       +36.4%  <.001  ▁▁▂█▂▂▁▁▁▁ ▁▁▁▁▁▂█▄▂▁
- rewrite 256 labels in one group                                              ┊         ●┤       +34.5%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▁▅█▄▃▂▁
- copy per-glyph metrics from 100 unchanged labels                             ┊       ├─●┤       +33.5%  <.001  ▅█▃▁▁▁▁▁▁▁ ▁▁▁▆█▂▁▁▁▁
- rewrite 64 labels in one group                                               ┊        ├●        +32.3%  <.001  ██▃▂▁▂▁▁▁▁ ▁▁▄█▄▂▁▂▁▂
- publish 1024 retained Text instances                                         ┊        ├●        +32.1%  <.001  ▇█▄▁▁▁▁▁▁▁ ▁▁▁▁▁▇█▃▇▄
- rewrite 128 labels in one group                                              ┊       ├─●┤       +31.8%  <.001  ▆█▃▂▁▁▁▁▁▁ ▁▁▁█▇▃▂▂▁▁
- type one character into a long Fredoka paragraph and measure                 ┊       ●┤         +27.8%  <.001  █▂▁▁▁▁█▁▁▁ ▁▁▁▁▁▁▁█▃▁
- relayout after font-size change                                              ┊      ├●          +27.4%  <.001  ▆█▂▂▁▁▁▁▁▁ ▁▁▁▁█▇▂▂▁▁
- publish after color change                                                   ┊    ├●            +19.2%  <.001  ▆█▂▂▂▁▁▁▁▁ ▁▁▁█▆▂▁▂▂▁
- 1000 labels first overwrite-before-scene-publication                         ┊    ●             +16.7%  <.001  ▂█▅▃▃▂▁▁▁▁ ▁▁▁█▆▅▃▂▁▁
- 10 labels first same-length scene publication                                ┊  ├─●┤            +15.4%   .005  ▂█▅▅▂▂▁▁▁▁ ▁▁█▇▃▂▂▁▁▁
- mount and publish a 22k-glyph paragraph                                      ┊   ●┤             +14.7%  <.001  ▃█▇▅▁▁▁▁▁▁ ▁▁▁▁▁▁█▇▃▂
- publication after text change                                                ┊   ●              +13.4%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▆▅█▃▂▁▁
- mount 100 labels and borrow glyphs from each once                            ┊  ├●              +12.1%  <.001  ▃█▅▃▂▂▁▁▁▁ ▁▁▂▇█▅▄▃▂▂
- 10 labels first same-length engine publication                               ┊├─●─┤              +8.6%   .015  ▃█▅▂▂▁▁▁▁▁ ▁█▇▃▂▁▁▁▁▁
- publish after text change                                                    ┊ ●┤                +8.0%  <.001  ▃█▃▂▂▁▁▁▁▁ ▁▁█▇▃▂▁▂▁▁
- long unsafe-boundary paragraph text edit                                     ┊ ●┤                +7.7%  <.001  ▅█▂▂▂▁▁▁▁▁ ▁▁█▄▂▁▂▁▁▁
+ 100 labels first same-length scene publication                            ├●─┤                   -5.3%   .015  ▁██▅▃▃▂▂▁▁ ▄█▆▃▂▂▂▁▁▁
+ 100 labels last same-length engine publication                            ├●┤┊                   -5.4%  <.001  ▁▆█▄▂▂▂▂▁▁ ▁█▆▂▁▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                     ●┤┊                   -5.6%  <.001  ▁▂█▆▅▃▃▃▂▁ ▃█▆▄▂▃▂▁▁▁
+ 100 labels last same-length scene publication                            ├─●┤┊                   -5.9%   .001  ▁▄█▆▄▂▂▂▁▁ ▁█▇▃▂▂▁▁▁▁
+ 10 labels first length-changing scene publication                         ├●─┤                   -6.4%   .002  ▂█▇▅▃▂▂▁▁▁ ▂█▆▂▁▁▁▁▁▁
+ 100 labels first same-length engine publication                           ├●┤┊                   -6.4%   .010  ▁▇█▄▂▂▁▁▁▁ ▂█▅▂▂▁▁▁▁▁
+ issue 216 unsafe-boundary word-wrap reflow                                ├●┤┊                   -6.4%   .010  ▁█▇▃▂▁▁▁▁▁ ▂█▄▂▁▁▁▁▁▁
+ normalize 1000 equivalent retained label updates                          ├● ┊                   -7.5%  <.001  ▁▁▄▃▂█▄▂▁▁ ▃▄▁▁█▂▁▁▁▁
+ write 22k UTF16 text into Wasm request arena                               ● ┊                   -7.5%   .004  ██▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ write 22k UTF16 text into owned array control                            ├─● ┊                   -7.9%  <.001  ▅█▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels separated balanced gro…k-space engine publication              ●─┤┊                   -8.6%  <.001  ▁▁▁██▃▂▁▁▁ ▂▆█▅▄▂▂▁▁▁
+ 100 labels last length-changing engine publication                       ├●┤ ┊                   -9.2%  <.001  ▁▂█▆▄▂▂▂▁▁ ▂█▅▂▂▂▁▁▁▁
+ normalize 1000 equivalent formatted flow updates                          ●  ┊                   -9.5%  <.001  ▁▁▁▁▃█▆▃▃▁ ▁▅▅█▄▃▁▁▁▁
+ 100 labels separated balanced gro…nk-space scene publication            ├─●┤ ┊                   -9.6%  <.001  ▁▁▂█▆▃▃▂▂▁ ▂▇█▄▃▂▂▁▁▁
+ 100 labels last length-changing scene publication                        ├●┤ ┊                  -10.0%  <.001  ▁▃█▆▄▂▂▂▂▁ ▃█▅▂▁▂▁▁▁▁
+ 100 labels separated unbalanced g…k-space engine publication              ●┤ ┊                  -10.1%  <.001  ▁▁▁▅█▄▂▂▁▁ ▁▆█▅▄▃▂▂▁▁
+ copy per-glyph metrics with outlines after text change                   ├●  ┊                  -10.5%  <.001  ▂▂▃▁▁▂▆▂█▂ ▁▂▄▂▁█▃▁▁▁
+ write 1000 paragraph-order mutations                                      ●  ┊                  -10.5%  <.001  ▁█▆▂▁▁▁▁▁▁ █▂▁▂▁▁▁▁▁▁
+ mutate one trailing span across 1000 formatted labels                    ├●┤ ┊                  -11.4%  <.001  ▁▁▂▄▃██▄▃▁ ▄█▆▅▂▁▁▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication             ├●  ┊                  -11.6%  <.001  ▁▁▁▅█▄▂▂▂▁ ▁▇█▅▃▂▂▁▁▁
+ 10 labels first color-only engine publication                           ├●┤  ┊                  -12.7%   .005  ▁██▆▃▂▁▂▁▁ ▂█▄▂▁▁▁▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans             ●   ┊                  -12.7%  <.001  ▁▁▁▁▂▄▃█▄▂ ▄▃█▃▁▁▁▁▁▁
+ 100 labels first set+measure+scene-publication                           ●┤  ┊                  -13.3%  <.001  ▁▂█▅▃▂▂▁▁▁ ▃█▄▂▁▁▁▁▁▁
+ type one character into a long paragraph and publish a frame             ●   ┊                  -13.4%  <.001  ▁▁▁▁▄█▃▂▂▁ ▂█▄▂▁▂▁▁▁▁
+ issue 216 reporter workaround                                          ├─●┤  ┊                  -13.9%  <.001  ▁██▅▂▁▁▂▁▁ ▄█▂▁▁▁▂▁▁▁
+ 10 labels first color-only scene publication                            ├●┤  ┊                  -14.5%  <.001  ▁▇█▅▃▂▁▂▂▁ ▃█▄▂▂▁▂▁▁▁
+ write 1000 paragraph and text mutations                                 ├●   ┊                  -14.8%  <.001  ▁▁█▅▂▁▁▁▁▁ █▇▂▂▁▁▁▁▁▁
+ 100 labels batched edit-read publication                                ├●   ┊                  -14.9%  <.001  ▁▁▂▄█▆▃▂▁▁ ▃█▄▂▂▂▁▁▁▁
+ 1 labels first set+measure+scene-publication                            ├●   ┊                  -14.9%  <.001  ▁▁▇█▇▅▄▃▂▁ ▂█▇▄▂▁▂▁▁▁
+ cached measurement                                                      ├●   ┊                  -15.0%  <.001  ▁▂█▁▂▁▁▁▁▁ ▂█▃▁▂▂▁▁▁▁
+ copy per-glyph metrics after text change                                ●─┤  ┊                  -15.4%  <.001  ▁▁▁▁▃█▅▆▂▁ ▄▂▂▁█▂▁▁▁▁
+ edit and independently copy one label among 1 labels                    ●─┤  ┊                  -15.5%  <.001  ▁▂█▇▃▂▁▁▁▁ ▃█▄▂▂▁▁▁▁▁
+ edit and independently copy one label among 100 labels                  ●┤   ┊                  -16.0%  <.001  ▁▁▂█▅▂▂▁▁▁ ▁█▆▂▂▁▁▁▁▁
+ common-safe word-wrap reflow                                            ●┤   ┊                  -16.5%  <.001  ▁▄█▄▂▁▁▁▂▁ ▅█▃▁▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates           ├●    ┊                  -16.8%  <.001  ▁▁▁▁█▇▅▆▄▁ ▃▇█▃▁▁▁▁▁▁
+ 10 labels last color-only engine publication                          ├─●┤   ┊                  -17.1%  <.001  ▁▇█▆▃▂▂▂▁▁ ▄█▃▂▁▁▁▁▁▁
+ 10 labels last color-only scene publication                           ├─●─┤  ┊                  -17.2%  <.001  ▁▅█▆▅▂▂▂▁▁ ▃█▄▃▂▁▁▁▁▁
+ 100 labels first length-changing scene publication                    ├●     ┊                  -20.0%  <.001  ▁▁▁▇█▃▂▂▂▁ ▃█▅▂▂▂▁▁▁▁
+ type one character into a long paragraph and measure                   ●     ┊                  -20.1%  <.001  █▂▁▁▁▁▁▅▅▁ ▁▁▁▁▁▅█▂▁▁
+ 100 labels first length-changing engine publication                   ├●     ┊                  -21.1%  <.001  ▁▁▂▇█▃▂▂▂▁ ▃█▄▂▂▂▁▁▁▁
+ reflow after width change                                             ├●     ┊                  -21.1%  <.001  ▁▁▇█▃▁▁▁▂▁ ▃█▃▂▁▁▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                  ●┤     ┊                  -22.4%  <.001  ▁▁▂█▃▂▂▁▁▁ ▄█▃▂▂▂▁▁▁▁
+ measurement then publication after width change                      ●┤      ┊                  -25.2%  <.001  ▁▁▁▁▂▇█▂▂▁ ▁▁█▂▂▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                  ●┤      ┊                  -25.4%  <.001  ▁▁▁▁▁▁██▃▁ ▄█▅▁▁▁▁▁▁▁
+ 100 labels last color-only scene publication                        ├●┤      ┊                  -25.6%  <.001  ▁▁█▆▂▁▁▁▁▁ ▄█▂▁▁▁▁▁▁▁
+ edit and measure one of 100 retained labels                        ├─●─┤     ┊                  -25.7%  <.001  ▁▁██▄▃▂▂▁▁ ▃█▅▃▂▁▁▁▁▁
+ 100 labels first color-only scene publication                       ├●┤      ┊                  -26.3%  <.001  ▁▁█▆▂▁▁▂▁▁ ▄█▃▂▂▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans         ●       ┊                  -27.0%  <.001  ▁▁▁▁▁▁▆█▄▁ █▆▂▁▁▁▁▁▁▁
+ edit and independently copy one label among 1000 labels             ├●┤      ┊                  -27.7%  <.001  ▁▁▁▁▃█▄▃▃▁ ▇█▅▃▂▁▁▁▁▁
+ 100 labels first color-only engine publication                     ├─●┤      ┊                  -27.9%  <.001  ▁▁█▇▃▂▁▁▁▁ ▃█▃▁▂▁▁▁▁▁
+ split move and merge paint boundaries preparation only              ●┤       ┊                  -28.8%  <.001  ▅▁▁▁▁▁▁▁▃█ ▁▁▁▁▁▁█▁▁▁
+ 100 labels last color-only engine publication                     ├─●┤       ┊                  -30.2%  <.001  ▁▁█▃▂▁▁▁▁▁ ██▂▂▁▁▁▁▁▁
+ edit and measure one of 1000 retained labels                       ├●        ┊                  -31.1%  <.001  ▁▁▁█▄▃▂▁▁▁ ▄█▂▂▁▁▁▁▁▁
+ 1 labels first set+measure                                         ├●        ┊                  -31.3%  <.001  ▁▁▇▆█▆▃▃▂▁ ▂█▄▂▁▁▁▁▁▁
+ split move and merge paint boundaries publication                  ●┤        ┊                  -32.0%  <.001  ▁▁▁▁▁▃▇█▇▂ ▇█▂▁▁▁▁▁▁▁
+ 100 labels 100 edits immediate me…ements without publication       ●┤        ┊                  -32.2%  <.001  ▁▁▁▂▅█▄▂▁▁ ▃█▂▂▁▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans      ●┤         ┊                  -35.4%  <.001  ▁▁▁▁▁▁▁█▅▂ █▅▁▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans      ●          ┊                  -36.7%  <.001  ▁▁▁▁▃█▂▂▂▁ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                   ├●          ┊                  -37.1%  <.001  ▁▁▁▁▁▅█▅▂▁ ▄█▃▁▁▁▁▁▁▁
+ per-glyph inspection after width change                          ├●          ┊                  -37.3%  <.001  ▁▆▁▆▄▁▅▂▅█ ▁▁███▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans      ●          ┊                  -37.3%  <.001  ▁▁▁▁▁▃█▂▁▂ ▄█▃▁▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans     ├●          ┊                  -37.6%  <.001  ▁▁▁▁▁▂█▂▂▁ ▄█▄▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans      ●          ┊                  -37.7%  <.001  ▁▁▁▁▃█▃▂▁▁ ▄█▂▁▁▁▁▁▁▁
+ publication after width change                                   ├●          ┊                  -38.2%  <.001  ▁▁▁▁▁█▅▂▂▁ ██▂▂▂▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ●┤          ┊                  -38.7%  <.001  ▁▁▁▁▁▁▂█▅▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                  ●┤          ┊                  -38.8%  <.001  ▁▁▁▁▁▂█▅▄▂ ▅█▃▁▁▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication                  ●┤          ┊                  -38.9%  <.001  ▁▁▁▁▁▅█▅▃▁ ▆█▄▁▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication               ●┤          ┊                  -39.1%  <.001  ▁▁▁▁▁▃█▄▂▁ ▅█▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication     ●┤          ┊                  -39.2%  <.001  ▁▁▁▁▁▁▂█▅▁ ▃█▂▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication                  ●           ┊                  -39.3%  <.001  ▁▁▁▁▁▁██▅▂ ▄█▃▂▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●           ┊                  -39.6%  <.001  ▁▁▁▁▁▁▃█▃▁ ▄█▁▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●           ┊                  -39.7%  <.001  ▁▁▁▁▁▁▂█▂▁ ▅█▁▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication             ├●           ┊                  -40.2%  <.001  ▁▁▁▁▁▁█▆▂▁ ▆█▂▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication                ├●           ┊                  -40.5%  <.001  ▁▁▁▁▁█▇▅▂▁ ▆█▂▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                     ●           ┊                  -40.5%  <.001  ▁▁▁▁▁▁▄█▂▁ █▆▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans    ●            ┊                  -43.5%  <.001  ▁▁▁▁▁▁▁██▂ █▂▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●┤            ┊                  -45.4%  <.001  ▁▁▁▁▁▁▂█▂▂ ▅█▃▁▁▁▁▁▁▁
+ inspection then publication after width change                 ●┤            ┊                  -46.2%  <.001  ▁▇▂▁▁▂▁▄█▆ █▄▇▆▄▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ├●             ┊                  -48.2%  <.001  ▁▁▁▁▁▁▁█▃▂ █▃▂▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ●┤             ┊                  -48.8%  <.001  ▁▁▂█▁▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
+ write one paragraph and text mutation                         ●              ┊                  -49.7%  <.001  ▁▃█▂▂▂▁▁▁▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ◀              ┊                  -50.8%  <.001  ▁▁▁▁▁▁▁█▆▂ █▇▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -61.1%  <.001  ▁▁▁▁▁▁▁▆█▂ █▂▁▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -62.0%  <.001  ▁▁▁▁▁▁▁▆█▃ █▃▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -62.2%  <.001  ▁▁▁▁▁▂█▃▂▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -62.4%  <.001  ▁▁▁▁▁▁█▄▃▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -62.6%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -65.1%  <.001  ▁▁▁▁▁▁▁▂█▂ █▁▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -67.9%  <.001  ▁▇▂▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -68.3%  <.001  ▁▁▁▁▁▁▄█▂▁ █▁▁▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -71.1%  <.001  ▁▁▁▁▁▁█▄▃▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -71.6%  <.001  ▁▁▁▁▁▁█▄▂▁ █▅▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -78.9%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -86.8%  <.001  ▁▁▁▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
  10 labels last same-length engine publication                               ├┼─●┤                +5.3%   .083  ▂▇█▆▅▃▂▂▁▁ ▁▁██▄▂▂▁▁▁
  10 labels last same-length scene publication                                 ├●─┤                +4.8%   .138  ▂▆█▄▃▂▂▁▁▁ ▁▂█▆▂▁▁▁▁▁
  10 labels no-op scene traversal                                              ┊●┤                 +3.9%   .002  █▂▅▂▃▁▁▁▁▁ █▃█▃▄▂▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                            ├●┤                 +3.5%   .005  ▂▁▁▂▅█▂▁▁▁ ▁▁▁▂▂█▃▁▁▁
  1000 labels first same-value-set                                             ├●                  +3.1%   .002  ▂▅█▄▁▂▂▂▂▁ ▁▁▆█▅▂▂▂▁▁
  100 labels first same-value-set                                              ├●                  +2.7%   .021  ▄█▄▃▁▂▁▁▁▁ ▁▄█▄▃▂▂▁▁▁
  1000 labels no-op scene traversal                                           ├●─┤                 +0.8%   .442  ▂██▆▂▁▁▁▁▁ ▁▆█▅▂▁▁▁▁▁
  100 labels no-op scene traversal                                            ├●┤                  +0.4%   .820  ▂█▅▃▂▁▁▁▁▁ ▂█▄▃▂▁▁▁▁▁
  toggle one group containing 1000 retained labels                            ├●─┤                 +0.4%   .574  ▃█▆▅▅▄▂▁▁▁ ▁▅██▄▃▂▁▁▁
  read every outline from an unchanged copy                                   ├●┤                  +0.3%  1.000  ▂█▃▁▁▁▁▁▁▁ ▄█▄▂▁▁▂▁▁▁
  measure 100 unchanged labels                                                ├●┤                  +0.1%   .878  ▁▂▇█▄▂▁▁▁▁ ▂▄▆█▅▂▁▁▁▁
  1 labels first same-value-set                                                ●┤                   0.0%   .798  ▁▃▃█▂▁▁▁▁▁ ▁▁▅█▂▁▁▂▁▁
  reuse 1000 unchanged Vue property snapshots                                  ●┤                  -0.4%   .798  █▁▁▁▁▁▁▁▁▁ █▁▁▁▁▁▁▁▁▁
  borrow glyphs from 1000 steadily promoted retained labels     ├──────────────●──┤                -0.4%   .959  █▄▂▁▁▁▁▁▅▇ ▁▇█▅▂▁▁▂▆▆
  mount a label and publish its first edit                                    ├●                   -1.3%   .028  ▂█▅▃▂▂▂▁▁▁ ▃█▄▂▂▂▁▁▁▁
  10 labels last length-changing engine publication                          ├─●┤                  -1.4%   .645  ▂█▆▄▂▂▁▁▁▁ ▁█▆▃▂▂▁▁▁▁
  10 labels last length-changing scene publication                           ├●┤                   -1.7%   .398  ▂██▅▅▃▂▁▁▁ ▂▆█▅▂▂▂▁▁▁
  reorder then edit one of 1000 retained labels                              ├●┊                   -4.0%  <.001  ▁▄█▇▄▄▂▂▂▁ ▂█▄▃▂▁▁▁▁▁
  10 labels first length-changing engine publication                        ├●─┼┤                  -5.9%   .195  ▂██▇▄▂▂▁▁▁ ▁▇█▄▃▁▂▁▁▁
  move 1000 retained TypeGPU labels                                        ├─●─┼┤                  -7.1%   .130  ▁▁▂▇██▃▁▁▁ ▁▃▅█▆▄▃▂▁▁
  measure 1000 unchanged retained labels                                   ├●──┼┤                 -10.7%   .185  ▁▂▄▇█▇▃▂▁▁ ▁▂▇█▅▃▃▂▂▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status    | bench                                                                                     | baseline | candidate | Δ time      | Δ p50    | p     | 95% CI            |
| --------- | ----------------------------------------------------------------------------------------- | -------- | --------- | ----------- | -------- | ----- | ----------------- |
| 🔴 slower | 1 labels first set                                                                        | 1.15µs   | 16.15µs   | +0.015ms    | +1301.3% | <.001 | +1281.4..+1316.5% |
| 🔴 slower | 100 labels first set                                                                      | 1.32µs   | 18.46µs   | +0.017ms    | +1298.7% | <.001 | +1262.1..+1339.9% |
| 🔴 slower | 1000 labels first set                                                                     | 3.20µs   | 16.18µs   | +0.013ms    | +405.6%  | <.001 | +388.6..+422.6%   |
| 🔴 slower | long unsafe-boundary paragraph reflow                                                     | 354.17µs | 638.38µs  | +0.284ms    | +80.2%   | <.001 | +74.7..+82.2%     |
| 🔴 slower | 100 labels first overwrite-before-scene-publication                                       | 314.88µs | 484.94µs  | +0.170ms    | +54.0%   | <.001 | +51.1..+57.5%     |
| 🔴 slower | 1 labels first overwrite-before-scene-publication                                         | 246.71µs | 356.73µs  | +0.110ms    | +44.6%   | <.001 | +42.1..+47.7%     |
| 🔴 slower | measure after text change                                                                 | 1.12ms   | 1.60ms    | +0.480ms    | +42.8%   | <.001 | +41.6..+44.4%     |
| 🔴 slower | rewrite 512 labels in one group                                                           | 7.07ms   | 10.00ms   | +2.930ms    | +41.6%   | <.001 | +39.3..+43.0%     |
| 🔴 slower | publication after font-size change                                                        | 6.19ms   | 8.65ms    | +2.460ms    | +39.7%   | <.001 | +38.7..+42.3%     |
| 🔴 slower | long reporter workaround paragraph reflow                                                 | 420.73µs | 583.88µs  | +0.163ms    | +38.8%   | <.001 | +37.0..+39.4%     |
| 🔴 slower | measurement after width change                                                            | 866.50µs | 1.18ms    | +0.314ms    | +36.4%   | <.001 | +34.3..+38.3%     |
| 🔴 slower | rewrite 256 labels in one group                                                           | 3.51ms   | 4.72ms    | +1.210ms    | +34.5%   | <.001 | +32.6..+37.2%     |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels                                          | 131.83µs | 175.96µs  | +0.044ms    | +33.5%   | <.001 | +25.3..+36.2%     |
| 🔴 slower | rewrite 64 labels in one group                                                            | 1.09ms   | 1.44ms    | +0.350ms    | +32.3%   | <.001 | +30.2..+34.3%     |
| 🔴 slower | publish 1024 retained Text instances                                                      | 15.31ms  | 20.23ms   | +4.920ms    | +32.1%   | <.001 | +29.8..+33.9%     |
| 🔴 slower | rewrite 128 labels in one group                                                           | 1.87ms   | 2.47ms    | +0.600ms    | +31.8%   | <.001 | +27.0..+35.2%     |
| 🔴 slower | type one character into a long Fredoka paragraph and measure                              | 1.59ms   | 2.03ms    | +0.440ms    | +27.8%   | <.001 | +26.7..+29.1%     |
| 🔴 slower | relayout after font-size change                                                           | 1.79ms   | 2.27ms    | +0.480ms    | +27.4%   | <.001 | +24.9..+28.2%     |
| 🔴 slower | publish after color change                                                                | 1.25ms   | 1.48ms    | +0.230ms    | +19.2%   | <.001 | +18.3..+20.2%     |
| 🔴 slower | 1000 labels first overwrite-before-scene-publication                                      | 1.40ms   | 1.64ms    | +0.240ms    | +16.7%   | <.001 | +15.3..+18.2%     |
| 🔴 slower | 10 labels first same-length scene publication                                             | 325.92µs | 376.15µs  | +0.050ms    | +15.4%   | .005  | +10.1..+18.5%     |
| 🔴 slower | mount and publish a 22k-glyph paragraph                                                   | 17.53ms  | 20.11ms   | +2.580ms    | +14.7%   | <.001 | +13.2..+16.0%     |
| 🔴 slower | publication after text change                                                             | 6.44ms   | 7.30ms    | +0.860ms    | +13.4%   | <.001 | +12.3..+13.9%     |
| 🔴 slower | mount 100 labels and borrow glyphs from each once                                         | 9.95ms   | 11.15ms   | +1.200ms    | +12.1%   | <.001 | +10.5..+12.8%     |
| 🔴 slower | 10 labels first same-length engine publication                                            | 322.81µs | 350.44µs  | +0.028ms    | +8.6%    | .015  | +4.5..+17.7%      |
| 🔴 slower | publish after text change                                                                 | 1.92ms   | 2.07ms    | +0.150ms    | +8.0%    | <.001 | +7.4..+8.7%       |
| 🔴 slower | long unsafe-boundary paragraph text edit                                                  | 1.61ms   | 1.73ms    | +0.120ms    | +7.7%    | <.001 | +7.2..+8.7%       |
| 🟢 faster | 100 labels first same-length scene publication                                            | 509.58µs | 482.44µs  | -0.027ms    | -5.3%    | .015  | -11.4..-1.3%      |
| 🟢 faster | 100 labels last same-length engine publication                                            | 453.04µs | 428.44µs  | -0.025ms    | -5.4%    | <.001 | -8.5..-3.9%       |
| 🟢 faster | reorder 1000 unchanged retained labels                                                    | 2.32ms   | 2.19ms    | -0.130ms    | -5.6%    | <.001 | -6.3..-4.3%       |
| 🟢 faster | 100 labels last same-length scene publication                                             | 504.10µs | 474.44µs  | -0.030ms    | -5.9%    | .001  | -12.6..-3.2%      |
| 🟢 faster | 10 labels first length-changing scene publication                                         | 504.44µs | 472.37µs  | -0.032ms    | -6.4%    | .002  | -8.5..-1.6%       |
| 🟢 faster | 100 labels first same-length engine publication                                           | 460.25µs | 430.79µs  | -0.029ms    | -6.4%    | .010  | -10.0..-2.6%      |
| 🟢 faster | issue 216 unsafe-boundary word-wrap reflow                                                | 192.35µs | 179.98µs  | -0.012ms    | -6.4%    | .010  | -9.1..-3.2%       |
| 🟢 faster | normalize 1000 equivalent retained label updates                                          | 2.36ms   | 2.19ms    | -0.170ms    | -7.5%    | <.001 | -8.4..-5.6%       |
| 🟢 faster | write 22k UTF16 text into Wasm request arena                                              | 39.48µs  | 36.50µs   | -0.003ms    | -7.5%    | .004  | -7.8..-6.4%       |
| 🟢 faster | write 22k UTF16 text into owned array control                                             | 39.63µs  | 36.50µs   | -0.003ms    | -7.9%    | <.001 | -12.5..-7.2%      |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication                        | 795.92µs | 727.42µs  | -0.069ms    | -8.6%    | <.001 | -10.1..-4.6%      |
| 🟢 faster | 100 labels last length-changing engine publication                                        | 615.77µs | 559.40µs  | -0.056ms    | -9.2%    | <.001 | -14.3..-7.4%      |
| 🟢 faster | normalize 1000 equivalent formatted flow updates                                          | 5.27ms   | 4.77ms    | -0.500ms    | -9.5%    | <.001 | -11.2..-8.9%      |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication                         | 862.46µs | 779.29µs  | -0.083ms    | -9.6%    | <.001 | -15.1..-7.1%      |
| 🟢 faster | 100 labels last length-changing scene publication                                         | 679.54µs | 611.40µs  | -0.068ms    | -10.0%   | <.001 | -14.8..-8.1%      |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication                      | 797.00µs | 716.33µs  | -0.081ms    | -10.1%   | <.001 | -11.3..-7.3%      |
| 🟢 faster | copy per-glyph metrics with outlines after text change                                    | 3.46ms   | 3.09ms    | -0.370ms    | -10.5%   | <.001 | -11.9..-9.4%      |
| 🟢 faster | write 1000 paragraph-order mutations                                                      | 6.76µs   | 6.05µs    | -0.000710ms | -10.5%   | <.001 | -11.1..-9.7%      |
| 🟢 faster | mutate one trailing span across 1000 formatted labels                                     | 41.93ms  | 37.17ms   | -4.760ms    | -11.4%   | <.001 | -12.3..-5.6%      |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication                       | 850.52µs | 752.00µs  | -0.099ms    | -11.6%   | <.001 | -13.6..-9.7%      |
| 🟢 faster | 10 labels first color-only engine publication                                             | 263.88µs | 230.35µs  | -0.034ms    | -12.7%   | .005  | -15.6..-9.3%      |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans                             | 20.15ms  | 17.59ms   | -2.560ms    | -12.7%   | <.001 | -13.1..-12.2%     |
| 🟢 faster | 100 labels first set+measure+scene-publication                                            | 568.94µs | 493.31µs  | -0.076ms    | -13.3%   | <.001 | -15.0..-11.3%     |
| 🟢 faster | type one character into a long paragraph and publish a frame                              | 3.27ms   | 2.83ms    | -0.440ms    | -13.4%   | <.001 | -14.7..-12.7%     |
| 🟢 faster | issue 216 reporter workaround                                                             | 200.15µs | 172.23µs  | -0.028ms    | -13.9%   | <.001 | -18.5..-11.4%     |
| 🟢 faster | 10 labels first color-only scene publication                                              | 295.08µs | 252.17µs  | -0.043ms    | -14.5%   | <.001 | -17.2..-10.7%     |
| 🟢 faster | write 1000 paragraph and text mutations                                                   | 84.17µs  | 71.75µs   | -0.012ms    | -14.8%   | <.001 | -16.6..-13.2%     |
| 🟢 faster | 100 labels batched edit-read publication                                                  | 5.36ms   | 4.56ms    | -0.800ms    | -14.9%   | <.001 | -16.3..-14.0%     |
| 🟢 faster | 1 labels first set+measure+scene-publication                                              | 417.38µs | 355.21µs  | -0.062ms    | -14.9%   | <.001 | -16.5..-13.0%     |
| 🟢 faster | cached measurement                                                                        | 36.58ns  | 31.07ns   | -0.000006ms | -15.0%   | <.001 | -17.5..-13.1%     |
| 🟢 faster | copy per-glyph metrics after text change                                                  | 3.63ms   | 3.07ms    | -0.560ms    | -15.4%   | <.001 | -17.9..-11.5%     |
| 🟢 faster | edit and independently copy one label among 1 labels                                      | 1.00ms   | 847.00µs  | -0.153ms    | -15.5%   | <.001 | -16.3..-8.8%      |
| 🟢 faster | edit and independently copy one label among 100 labels                                    | 1.14ms   | 959.69µs  | -0.180ms    | -16.0%   | <.001 | -16.8..-14.6%     |
| 🟢 faster | common-safe word-wrap reflow                                                              | 193.21µs | 161.38µs  | -0.032ms    | -16.5%   | <.001 | -18.1..-14.3%     |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates                           | 5.89ms   | 4.90ms    | -0.990ms    | -16.8%   | <.001 | -19.8..-16.0%     |
| 🟢 faster | 10 labels last color-only engine publication                                              | 272.15µs | 225.56µs  | -0.047ms    | -17.1%   | <.001 | -23.0..-13.4%     |
| 🟢 faster | 10 labels last color-only scene publication                                               | 306.83µs | 254.15µs  | -0.053ms    | -17.2%   | <.001 | -22.6..-9.3%      |
| 🟢 faster | 100 labels first length-changing scene publication                                        | 833.58µs | 666.65µs  | -0.167ms    | -20.0%   | <.001 | -22.1..-18.7%     |
| 🟢 faster | type one character into a long paragraph and measure                                      | 2.12ms   | 1.70ms    | -0.420ms    | -20.1%   | <.001 | -20.6..-19.4%     |
| 🟢 faster | 100 labels first length-changing engine publication                                       | 790.06µs | 623.13µs  | -0.167ms    | -21.1%   | <.001 | -23.6..-18.4%     |
| 🟢 faster | reflow after width change                                                                 | 441.40µs | 348.12µs  | -0.093ms    | -21.1%   | <.001 | -22.6..-19.8%     |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels                                      | 222.90µs | 172.90µs  | -0.050ms    | -22.4%   | <.001 | -24.1..-19.6%     |
| 🟢 faster | measurement then publication after width change                                           | 1.85ms   | 1.38ms    | -0.470ms    | -25.2%   | <.001 | -27.1..-24.6%     |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication                                       | 8.97ms   | 6.69ms    | -2.280ms    | -25.4%   | <.001 | -26.6..-24.3%     |
| 🟢 faster | 100 labels last color-only scene publication                                              | 389.98µs | 289.98µs  | -0.100ms    | -25.6%   | <.001 | -28.6..-23.2%     |
| 🟢 faster | edit and measure one of 100 retained labels                                               | 145.35µs | 108.04µs  | -0.037ms    | -25.7%   | <.001 | -34.4..-21.3%     |
| 🟢 faster | 100 labels first color-only scene publication                                             | 401.94µs | 296.06µs  | -0.106ms    | -26.3%   | <.001 | -29.7..-24.3%     |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans                         | 19.91ms  | 14.54ms   | -5.370ms    | -27.0%   | <.001 | -27.3..-26.2%     |
| 🟢 faster | edit and independently copy one label among 1000 labels                                   | 2.52ms   | 1.82ms    | -0.700ms    | -27.7%   | <.001 | -28.9..-24.3%     |
| 🟢 faster | 100 labels first color-only engine publication                                            | 346.48µs | 249.75µs  | -0.097ms    | -27.9%   | <.001 | -34.3..-23.1%     |
| 🟢 faster | split move and merge paint boundaries preparation only                                    | 6.45ms   | 4.59ms    | -1.860ms    | -28.8%   | <.001 | -29.2..-28.2%     |
| 🟢 faster | 100 labels last color-only engine publication                                             | 344.79µs | 240.50µs  | -0.104ms    | -30.2%   | <.001 | -36.1..-27.2%     |
| 🟢 faster | edit and measure one of 1000 retained labels                                              | 205.29µs | 141.50µs  | -0.064ms    | -31.1%   | <.001 | -33.8..-29.9%     |
| 🟢 faster | 1 labels first set+measure                                                                | 157.56µs | 108.21µs  | -0.049ms    | -31.3%   | <.001 | -33.7..-28.4%     |
| 🟢 faster | split move and merge paint boundaries publication                                         | 8.98ms   | 6.11ms    | -2.870ms    | -32.0%   | <.001 | -32.4..-31.5%     |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication                           | 2.81ms   | 1.91ms    | -0.900ms    | -32.2%   | <.001 | -33.4..-30.8%     |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans              | 17.58ms  | 11.36ms   | -6.220ms    | -35.4%   | <.001 | -36.0..-33.9%     |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans                 | 4.25ms   | 2.69ms    | -1.560ms    | -36.7%   | <.001 | -37.2..-36.1%     |
| 🟢 faster | 1000 labels last same-length scene publication                                            | 2.55ms   | 1.61ms    | -0.940ms    | -37.1%   | <.001 | -38.9..-36.4%     |
| 🟢 faster | per-glyph inspection after width change                                                   | 7.11ms   | 4.46ms    | -2.650ms    | -37.3%   | <.001 | -38.4..-37.0%     |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans              | 4.34ms   | 2.72ms    | -1.620ms    | -37.3%   | <.001 | -38.0..-36.7%     |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans                         | 4.37ms   | 2.73ms    | -1.640ms    | -37.6%   | <.001 | -38.5..-36.8%     |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans      | 4.27ms   | 2.66ms    | -1.610ms    | -37.7%   | <.001 | -38.0..-36.9%     |
| 🟢 faster | publication after width change                                                            | 1.13ms   | 695.04µs  | -0.435ms    | -38.2%   | <.001 | -39.0..-37.8%     |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication                      | 4.95ms   | 3.04ms    | -1.910ms    | -38.7%   | <.001 | -39.7..-38.1%     |
| 🟢 faster | 1000 labels first same-length scene publication                                           | 2.62ms   | 1.60ms    | -1.020ms    | -38.8%   | <.001 | -40.4..-37.5%     |
| 🟢 faster | 1000 labels first set+measure+scene-publication                                           | 2.71ms   | 1.65ms    | -1.060ms    | -38.9%   | <.001 | -40.2..-37.5%     |
| 🟢 faster | 1000 labels last length-changing scene publication                                        | 3.11ms   | 1.89ms    | -1.220ms    | -39.1%   | <.001 | -40.9..-37.5%     |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication                        | 4.88ms   | 2.97ms    | -1.910ms    | -39.2%   | <.001 | -39.7..-38.2%     |
| 🟢 faster | 1000 labels last same-length engine publication                                           | 2.31ms   | 1.40ms    | -0.910ms    | -39.3%   | <.001 | -41.1..-38.7%     |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication                       | 4.52ms   | 2.73ms    | -1.790ms    | -39.6%   | <.001 | -40.6..-39.2%     |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication                     | 4.57ms   | 2.76ms    | -1.810ms    | -39.7%   | <.001 | -40.3..-39.4%     |
| 🟢 faster | 1000 labels last length-changing engine publication                                       | 2.78ms   | 1.66ms    | -1.120ms    | -40.2%   | <.001 | -42.3..-39.0%     |
| 🟢 faster | 1000 labels first same-length engine publication                                          | 2.29ms   | 1.36ms    | -0.930ms    | -40.5%   | <.001 | -42.8..-39.2%     |
| 🟢 faster | 100 labels interleaved edit-read publication                                              | 17.75ms  | 10.56ms   | -7.190ms    | -40.5%   | <.001 | -40.9..-40.0%     |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans         | 26.80ms  | 15.13ms   | -11.670ms   | -43.5%   | <.001 | -43.7..-43.2%     |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication                          | 3.81ms   | 2.08ms    | -1.730ms    | -45.4%   | <.001 | -46.3..-44.9%     |
| 🟢 faster | inspection then publication after width change                                            | 8.75ms   | 4.70ms    | -4.050ms    | -46.2%   | <.001 | -47.8..-44.1%     |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication                              | 11.84ms  | 6.14ms    | -5.700ms    | -48.2%   | <.001 | -48.8..-47.5%     |
| 🟢 faster | 1000 labels first length-changing scene publication                                       | 4.60ms   | 2.36ms    | -2.240ms    | -48.8%   | <.001 | -49.3..-48.2%     |
| 🟢 faster | write one paragraph and text mutation                                                     | 907.22ns | 456.08ns  | -0.000451ms | -49.7%   | <.001 | -50.1..-49.4%     |
| 🟢 faster | 1000 labels first length-changing engine publication                                      | 4.35ms   | 2.14ms    | -2.210ms    | -50.8%   | <.001 | -51.8..-49.7%     |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans                 | 32.91ms  | 12.79ms   | -20.120ms   | -61.1%   | <.001 | -61.6..-60.7%     |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans                     | 32.27ms  | 12.26ms   | -20.010ms   | -62.0%   | <.001 | -62.4..-61.5%     |
| 🟢 faster | 1000 labels first color-only scene publication                                            | 2.02ms   | 764.85µs  | -1.255ms    | -62.2%   | <.001 | -62.9..-61.0%     |
| 🟢 faster | 1000 labels last color-only scene publication                                             | 2.03ms   | 762.17µs  | -1.268ms    | -62.4%   | <.001 | -64.2..-61.5%     |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication                                   | 121.36ms | 45.37ms   | -75.990ms   | -62.6%   | <.001 | -63.1..-62.3%     |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 39.59ms  | 13.81ms   | -25.780ms   | -65.1%   | <.001 | -65.5..-64.8%     |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans          | 40.03ms  | 12.84ms   | -27.190ms   | -67.9%   | <.001 | -68.7..-67.3%     |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans      | 31.50ms  | 9.99ms    | -21.510ms   | -68.3%   | <.001 | -68.6..-68.1%     |
| 🟢 faster | 1000 labels first color-only engine publication                                           | 1.66ms   | 479.88µs  | -1.180ms    | -71.1%   | <.001 | -71.7..-70.1%     |
| 🟢 faster | 1000 labels last color-only engine publication                                            | 1.66ms   | 471.31µs  | -1.189ms    | -71.6%   | <.001 | -72.5..-70.9%     |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication                             | 86.29ms  | 18.24ms   | -68.050ms   | -78.9%   | <.001 | -80.0..-78.7%     |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans                  | 136.94ms | 18.10ms   | -118.840ms  | -86.8%   | <.001 | -86.9..-86.7%     |

<details><summary>21 neutral, 3 skipped</summary>

| status                        | bench                                                     | baseline | candidate | Δ time      | Δ p50  | p     | 95% CI        |
| ----------------------------- | --------------------------------------------------------- | -------- | --------- | ----------- | ------ | ----- | ------------- |
| neutral                       | 10 labels no-op scene traversal                           | 3.76µs   | 3.91µs    | +0.000150ms | +3.9%  | .002  | +2.6..+5.4%   |
| neutral                       | 10 labels first length-changing engine publication        | 481.98µs | 453.62µs  | -0.028ms    | -5.9%  | .195  | -8.6..+3.1%   |
| neutral                       | 10 labels last same-length scene publication              | 341.48µs | 357.79µs  | +0.016ms    | +4.8%  | .138  | -0.8..+8.5%   |
| neutral                       | 10 labels last length-changing scene publication          | 468.79µs | 460.83µs  | -0.008ms    | -1.7%  | .398  | -5.4..+1.3%   |
| neutral                       | 10 labels last same-length engine publication             | 324.98µs | 342.13µs  | +0.017ms    | +5.3%  | .083  | -3.5..+10.5%  |
| neutral                       | 10 labels last length-changing engine publication         | 463.42µs | 457.08µs  | -0.006ms    | -1.4%  | .645  | -5.3..+4.0%   |
| neutral                       | 100 labels no-op scene traversal                          | 62.06µs  | 62.33µs   | +0.000270ms | +0.4%  | .820  | -4.3..+2.1%   |
| neutral                       | 1000 labels no-op scene traversal                         | 381.02µs | 384.17µs  | +0.003ms    | +0.8%  | .442  | -4.1..+6.0%   |
| neutral                       | mount a label and publish its first edit                  | 2.32ms   | 2.29ms    | -0.030ms    | -1.3%  | .028  | -2.6..-0.1%   |
| neutral                       | measure 100 unchanged labels                              | 6.76µs   | 6.77µs    | +0.000010ms | +0.1%  | .878  | -3.7..+3.0%   |
| neutral                       | reuse 1000 unchanged Vue property snapshots               | 189.29µs | 188.48µs  | -0.000810ms | -0.4%  | .798  | -1.5..+2.5%   |
| neutral                       | borrow per-glyph metrics from 100 promoted labels         | 217.33µs | 224.96µs  | +0.008ms    | +3.5%  | .005  | +1.5..+6.7%   |
| neutral                       | read every outline from an unchanged copy                 | 870.42µs | 873.21µs  | +0.003ms    | +0.3%  | 1.000 | -1.8..+2.7%   |
| neutral                       | 1 labels first same-value-set                             | 69.57ns  | 69.57ns   | 0.000ms     | 0.0%   | .798  | -1.4..+3.0%   |
| neutral                       | 100 labels first same-value-set                           | 67.37ns  | 69.17ns   | +0.000002ms | +2.7%  | .021  | +0.5..+4.1%   |
| neutral                       | 1000 labels first same-value-set                          | 69.10ns  | 71.23ns   | +0.000002ms | +3.1%  | .002  | +1.2..+4.1%   |
| neutral                       | toggle one group containing 1000 retained labels          | 417.92µs | 419.77µs  | +0.002ms    | +0.4%  | .574  | -2.5..+5.8%   |
| neutral                       | reorder then edit one of 1000 retained labels             | 5.69ms   | 5.46ms    | -0.230ms    | -4.0%  | <.001 | -5.3..-3.4%   |
| neutral                       | measure 1000 unchanged retained labels                    | 246.94µs | 220.44µs  | -0.026ms    | -10.7% | .185  | -12.6..+3.0%  |
| neutral                       | borrow glyphs from 1000 steadily promoted retained labels | 1.07ms   | 1.07ms    | 0.000ms     | -0.4%  | .959  | -48.9..+10.7% |
| neutral                       | move 1000 retained TypeGPU labels                         | 256.27µs | 238.19µs  | -0.018ms    | -7.1%  | .130  | -13.8..+4.8%  |
| skipped: timing-mode mismatch | cached per-glyph inspection                               |          |           |             |        |       |               |
| skipped: timing-mode mismatch | 100 labels first set+measure                              |          |           |             |        |       |               |
| skipped: timing-mode mismatch | 1000 labels first set+measure                             |          |           |             |        |       |               |

</details>
