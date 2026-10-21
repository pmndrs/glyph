## Package performance: `full` suite

90 faster · 29 slower · 22 neutral · 4 skipped

Baseline `0.1.0 (bbb3375c)` → candidate `0.1.0 (9b1ad97a)`

> ⚠ baseline CPU clock drifted 8.3% during its run

Latency distribution across 141 comparable workload p50s. Each workload counts once; these are not frame times.

| statistic | baseline | candidate |
| --- | ---: | ---: |
| Median workload p50 | 1.090ms | 0.873ms |
| Workloads ≤1 ms | 68 | 72 |
| Workloads ≤2 ms | 84 | 91 |
| Workloads ≤3 ms | 95 | 107 |
| Workloads >3 ms | 46 | 34 |

Largest candidate workloads (including neutral results):

| workload | baseline | candidate | Δ time |
| --- | ---: | ---: | ---: |
| 1000 labels 100 edits interleaved edit-read publication | 121.45ms | 45.06ms | -76.390ms |
| mutate one trailing span across 1000 formatted labels | 40.20ms | 36.34ms | -3.860ms |
| mount and publish a 22k-glyph paragraph | 17.60ms | 19.96ms | +2.360ms |
| 1000 labels 100 edits immediate measurements with publication | 90.91ms | 18.23ms | -72.680ms |
| publish 1024 retained Text instances | 15.25ms | 18.09ms | +2.840ms |

```diff
                                                                faster ◀       ┊       ▶ slower    Δ p50      p  baseline   candidate
- 1 labels first set                                                           ┊              ▶  +1339.6%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁█▄▂▂▂▁
- 1000 labels first set                                                        ┊              ▶  +994.5%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁▁██▃▂
- 100 labels first set                                                         ┊              ▶  +933.8%  <.001  █▁▁▁▁▁▁▁▁▁ ▁▁▁▁▁█▂▂▁▁
- type one character into a long Fredoka paragraph and measure                 ┊              ▶  +290.5%  <.001  █▂▁▁▁▂█▁▁▁ ▁▁▁▁▁▁▁█▃▁
- type one character into a long paragraph and measure                         ┊              ▶  +228.0%  <.001  █▂▁▁▁▁▁▃▇▁ ▁▁▁▁▁▃█▂▁▁
- long unsafe-boundary paragraph reflow                                        ┊              ▶   +78.4%  <.001  █▇▂▂▁▁▁▁▁▁ ▁▁▁▁█▃▁▁▁▁
- 100 labels first overwrite-before-scene-publication                          ┊              ▶   +53.0%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▄█▃▂▁▁▁
- measure after text change                                                    ┊            ●┤    +43.4%  <.001  ▁▁▁▁█▃▁▁▁▁ ▁▁▁▁▁▁▁█▂▁
- 1 labels first overwrite-before-scene-publication                            ┊        ├──●─┤    +39.9%  <.001  ▃█▄▂▁▁▁▁▁▁ ▁▁▁▆█▅▂▂▁▁
- measurement after width change                                               ┊          ├●      +38.8%  <.001  ▁▁▂█▂▂▁▁▁▁ ▁▁▁▁▁▂█▄▂▁
- long reporter workaround paragraph reflow                                    ┊          ●┤      +36.2%  <.001  ▃█▃▁▁▂▁▁▁▁ ▁▁▁██▃▂▂▂▁
- rewrite 512 labels in one group                                              ┊        ├●        +31.9%  <.001  ▆█▅▂▁▁▁▁▁▁ ▁▁▁▃▅▅█▅▁▂
- copy per-glyph metrics from 100 unchanged labels                             ┊     ├──●┤        +30.2%  <.001  ▃█▄▂▁▁▁▁▁▁ ▁▁▁▃█▂▁▁▁▁
- rewrite 128 labels in one group                                              ┊       ├●         +29.6%  <.001  █▇▂▂▁▁▁▁▁▁ ▁▁▂█▄▂▁▁▂▁
- rewrite 256 labels in one group                                              ┊      ├●─┤        +27.2%  <.001  ▂█▄▂▁▁▁▁▁▁ ▁▁▁▃█▅▄▂▂▁
- rewrite 64 labels in one group                                               ┊      ●┤          +24.6%  <.001  ██▂▁▂▂▁▁▁▁ ▁▁█▅▂▂▁▁▁▁
- 10 labels no-op scene traversal                                              ┊   ├─●┤           +20.7%  <.001  █▅▆▃▃▁▁▁▁▁ █▃▆▃▃▂▁▁▁▁
- publication after font-size change                                           ┊     ●            +20.1%  <.001  ▄█▃▂▁▁▁▁▁▁ ▁▁▁▁▁▇▃█▂▂
- publish 1024 retained Text instances                                         ┊    ├●            +18.7%  <.001  ▃█▇▂▁▁▁▁▁▁ ▁▁▁▁█▇▃▃█▃
- 10 labels last same-length engine publication                                ┊  ├─●──┤          +16.2%   .007  ▂█▄▄▃▂▁▁▁▁ ▁▂█▆▄▃▂▁▁▁
- 10 labels first same-length engine publication                               ┊  ├●┤             +14.1%  <.001  ▃█▆▄▃▂▂▁▁▁ ▁▁██▅▃▂▁▁▁
- mount and publish a 22k-glyph paragraph                                      ┊   ●              +13.4%  <.001  ▆█▆▂▁▁▁▁▁▁ ▁▁▁▁▁▆█▇▅▂
- mount 100 labels and borrow glyphs from each once                            ┊  ├●              +11.7%  <.001  ▂█▅▃▂▂▁▁▁▁ ▁▁▁▇█▆▂▃▂▁
- relayout after font-size change                                              ┊ ├●┤              +11.2%  <.001  █▄▂▁▁▁▁▁▁▁ ▁█▅▂▂▁▁▁▁▁
- 10 labels first same-length scene publication                                ┊ ├●─┤             +11.0%  <.001  ▃█▅▄▃▂▁▁▁▁ ▁▂█▅▃▂▁▁▁▁
- publish after color change                                                   ┊  ●                +9.8%  <.001  ▄█▂▁▂▁▁▁▁▁ ▁▁█▃▁▁▁▁▁▁
- 10 labels last same-length scene publication                                 ┊ ├●┤               +9.6%  <.001  ▃█▆▅▃▂▂▁▁▁ ▁▂██▄▂▁▁▁▁
- long unsafe-boundary paragraph text edit                                     ┊ ●┤                +8.1%  <.001  ▆█▃▂▂▂▁▁▁▁ ▁▁█▃▂▁▁▁▁▁
- publication after text change                                                ┊├●                 +5.5%  <.001  ▁▄█▃▃▂▂▁▂▁ ▁▁▆▄▄█▄▃▂▁
+ 100 labels last same-length scene publication                              ├●┊                   -5.0%   .021  ▁█▇▃▂▁▁▁▁▁ ▂█▄▂▁▂▁▁▁▁
+ 100 labels last same-length engine publication                             ├●┊                   -5.0%  <.001  ▁▆█▄▂▂▁▂▁▁ ▂█▆▂▁▁▁▁▁▁
+ 100 labels first same-length scene publication                           ├─●─┤                   -5.1%   .038  ▃█▂▂▁▁▁▁▁▁ ▇█▃▁▁▁▁▁▁▁
+ reorder 1000 unchanged retained labels                                     ●┤┊                   -5.9%   .028  ▁▁█▇▅▃▃▂▁▁ ▃█▆▄▄▃▂▂▁▁
+ write 22k UTF16 text into Wasm request arena                               ●─┤                   -6.4%   .005  ▆█▂▁▁▁▁▁▁▁ █▅▁▁▁▁▁▁▁▁
+ issue 216 unsafe-boundary word-wrap reflow                               ├─● ┊                   -7.9%  <.001  ▁▇█▄▂▁▁▂▂▁ ▂█▄▂▁▁▁▁▁▁
+ 100 labels separated unbalanced g…k-space engine publication              ●┤ ┊                   -8.9%  <.001  ▁▁▁▆█▄▂▂▁▁ ▂▆█▅▃▃▂▁▁▁
+ write 22k UTF16 text into owned array control                             ●┤ ┊                   -8.9%  <.001  ▄█▁▁▁▁▁▁▁▁ █▂▁▁▁▁▁▁▁▁
+ 100 labels separated balanced gro…nk-space scene publication            ├─●┤ ┊                   -9.0%  <.001  ▁▁▂█▅▃▂▂▁▁ ▂██▄▃▂▁▁▁▁
+ measure 100 unchanged labels                                             ├●─┤┊                   -9.0%   .002  ▁▁▅█▆▃▂▁▁▁ ▂▄█▆▂▂▁▁▁▁
+ 100 labels separated balanced gro…k-space engine publication             ├●┤ ┊                   -9.1%  <.001  ▁▁▁█▇▃▂▂▁▁ ▁▆█▅▃▂▂▁▁▁
+ 100 labels separated unbalanced g…nk-space scene publication              ●┤ ┊                   -9.4%   .007  ▁▁▁▇█▄▂▂▂▁ ▁▇█▅▄▃▂▂▁▁
+ mutate one trailing span across 1000 formatted labels                     ●  ┊                   -9.6%  <.001  ▁▁▁▁▂███▆▃ ▂▄█▄▄▁▁▁▁▁
+ 100 labels last length-changing engine publication                        ●──┤                   -9.6%   .050  ▁▃█▅▂▂▂▂▁▁ ▃█▅▂▂▂▁▁▁▁
+ 10 labels first color-only scene publication                             ├●┤ ┊                  -10.1%  <.001  ▁█▆▃▂▁▁▁▁▁ ▃█▄▂▁▁▁▁▁▁
+ normalize 1000 equivalent formatted flow updates                         ├●  ┊                  -10.2%  <.001  ▁▁▁▂██▆▅▃▁ ▃▅█▅▄▁▁▁▁▁
+ 100 labels last length-changing scene publication                        ├●┤ ┊                  -11.0%  <.001  ▁▂█▆▃▂▂▂▁▁ ▃█▅▂▂▂▁▁▁▁
+ copy per-glyph metrics with outlines after text change                   ●┤  ┊                  -11.9%  <.001  ▁▂▃▂▁▁▆▃█▂ ▁▂▆▂▁█▃▁▁▁
+ 10 labels last color-only engine publication                             ●─┤ ┊                  -12.2%   .010  ▁██▅▂▁▁▂▁▁ ▃█▄▂▂▂▁▁▁▁
+ 10 labels last color-only scene publication                             ├●┤  ┊                  -13.6%  <.001  ▁█▇▄▃▁▁▁▁▁ ▄█▃▂▁▁▁▁▁▁
+ 1 labels first set+measure+scene-publication                           ├─●┤  ┊                  -13.8%  <.001  ▁▁▇█▆▅▄▂▁▁ ▂█▇▄▂▂▁▁▁▁
+ cached measurement                                                      ├●   ┊                  -13.9%  <.001  ▁█▆▁▂▁▁▁▁▁ ▅█▂▁▂▂▁▁▁▁
+ type one character into a long paragraph and publish a frame             ●   ┊                  -14.1%  <.001  ▁▁▁▁▄█▃▁▂▂ ▃█▃▂▂▂▁▁▁▁
+ issue 216 reporter workaround                                           ├●   ┊                  -14.1%  <.001  ▁▄█▄▂▁▁▁▁▁ ▂█▃▁▁▁▁▁▁▁
+ common-safe word-wrap reflow                                           ├●┤   ┊                  -15.4%  <.001  ▁▄█▃▁▁▁▁▁▁ ▅█▃▁▁▁▁▁▁▁
+ write 1000 paragraph and text mutations                                 ●┤   ┊                  -15.9%  <.001  ▁█▂▁▁▁▁▁▁▁ █▃▁▁▁▁▁▁▁▁
+ edit and independently copy one label among 1 labels                    ●    ┊                  -16.5%  <.001  ▁▂▇█▅▃▂▂▁▁ ▃█▄▂▁▁▁▁▁▁
+ bind and normalize 1000 framework…ped formatted flow updates            ●    ┊                  -17.4%  <.001  ▁▁▁▁▇█▅▆▃▂ ▃▇█▃▂▁▁▁▁▁
+ 100 labels batched edit-read publication                               ├●    ┊                  -18.2%  <.001  ▁▁▁▂▄█▄▂▁▁ ▂█▅▂▂▁▁▁▁▁
+ write 1000 paragraph-order mutations                                   ├●    ┊                  -18.2%  <.001  ▂█▂▁▁▁▁▁▁▁ █▄▁▁▁▁▁▁▁▁
+ 100 labels first set+measure+scene-publication                      ├───●    ┊                  -18.3%  <.001  ▁▁▆█▅▄▃▂▂▁ ▂█▄▂▁▁▁▁▁▁
+ edit and independently copy one label among 100 labels                ├●┤    ┊                  -19.3%  <.001  ▁▁▃█▅▂▂▂▁▁ ▃█▄▂▂▁▁▁▁▁
+ 100 labels first length-changing scene publication                     ●─┤   ┊                  -19.6%  <.001  ▁▁▂█▇▄▂▂▁▁ ▂█▄▃▂▂▁▁▁▁
+ copy per-glyph metrics after text change                               ●─┤   ┊                  -19.6%  <.001  ▁▁▁▁▃█▄▅▁▁ ▆▃▂▄█▁▁▁▁▁
+ edit and measure one of 100 retained labels                          ├─●─┤   ┊                  -20.4%  <.001  ▁▁▅█▆▃▃▂▁▁ ▂█▆▄▃▂▂▁▁▁
+ broad end-to-end setter and publi…tion with 8192 paint spans           ●     ┊                  -20.7%  <.001  ▁▁▁▁▁▁▆▆█▃ ▄▄█▂▁▁▁▁▁▁
+ 100 labels first length-changing engine publication                   ●┤     ┊                  -21.9%  <.001  ▁▂█▂▂▁▁▁▁▁ ▆█▂▁▁▁▁▁▁▁
+ edit and sparsely borrow one of 1000 retained labels                  ●─┤    ┊                  -21.9%  <.001  ▁▁▄█▃▂▂▁▁▁ ▄█▄▃▂▁▁▁▁▁
+ 100 labels first color-only engine publication                       ├●┤     ┊                  -23.7%  <.001  ▁▁█▄▂▁▁▂▁▁ ▅█▃▂▂▁▁▁▁▁
+ 100 labels last color-only scene publication                         ├●      ┊                  -24.7%  <.001  ▁▁█▆▂▂▁▂▁▁ ▅█▃▂▂▁▁▁▁▁
+ reflow after width change                                           ├─●┤     ┊                  -24.7%  <.001  ▁██▂▂▁▁▁▁▁ █▅▂▂▁▁▁▁▁▁
+ 100 labels first color-only scene publication                        ├●┤     ┊                  -24.9%  <.001  ▁▁█▆▂▁▁▁▂▁ ▄█▃▂▂▁▁▁▁▁
+ measurement then publication after width change                      ●┤      ┊                  -25.3%  <.001  ▁▁▁▁▂██▂▂▁ ▁▁█▃▂▁▁▁▁▁
+ 1000 labels 100 edits batched edit-read publication                  ●┤      ┊                  -26.0%  <.001  ▁▁▁▁▁▁▃█▅▂ ▂█▆▂▁▁▁▁▁▁
+ 100 labels last color-only engine publication                        ●┤      ┊                  -26.1%  <.001  ▁▁██▂▁▁▁▁▁ ▅█▃▂▁▁▁▁▁▁
+ scattered end-to-end setter and p…tion with 8192 paint spans         ●       ┊                  -26.5%  <.001  ▁▁▁▁▁▁▅█▄▁ ▇█▂▁▁▁▁▁▁▁
+ edit and measure one of 1000 retained labels                      ├─●┤       ┊                  -28.4%  <.001  ▁▁▂█▄▂▂▁▁▁ ▅█▃▂▂▁▁▁▁▁
+ edit and independently copy one label among 1000 labels             ●┤       ┊                  -28.9%  <.001  ▁▁▁▁██▂▃▂▁ ▄█▃▃▁▁▁▁▁▁
+ split move and merge paint boundaries preparation only              ●        ┊                  -29.1%  <.001  ▇▁▁▁▁▁▁▁██ ▁▁▁▁▁▁█▁▁▁
+ 100 labels 100 edits immediate me…ements without publication       ●┤        ┊                  -32.7%  <.001  ▁▁▁▁▄█▆▂▁▁ ▂█▂▁▁▁▁▁▁▁
+ split move and merge paint boundaries publication                  ●         ┊                  -34.6%  <.001  ▁▁▁▁▁▁▅▆█▃ ▆█▄▁▁▁▁▁▁▁
+ 1 labels first set+measure                                     ├───●┤        ┊                  -34.9%  <.001  ▁▃▆█▇▅▃▃▂▁ ▄█▄▂▂▁▁▁▁▁
+ monospaced scattered end-to-end s…tion with 8192 paint spans      ●┤         ┊                  -35.1%  <.001  ▁▁▁▁▁▁▁█▆▃ █▃▁▁▁▁▁▁▁▁
+ 1000 labels first same-length scene publication                   ●          ┊                  -36.2%  <.001  ▁▁▁▁▁▂█▅▃▁ ▄█▃▁▁▁▁▁▁▁
+ unchanged setter preparation in o…raph with 8192 paint spans      ●          ┊                  -36.7%  <.001  ▁▁▁▁▃█▂▂▁▂ ▅█▃▂▁▁▁▁▁▁
+ unchanged end-to-end setter and p…tion with 8192 paint spans      ●          ┊                  -37.0%  <.001  ▁▁▁▁▁▅█▂▂▁ ▄█▃▁▁▁▁▁▁▁
+ monospaced unchanged end-to-end s…tion with 8192 paint spans      ●          ┊                  -37.0%  <.001  ▁▁▁▁▁▄█▂▂▁ ▄█▄▁▁▁▁▁▁▁
+ 1000 labels last same-length scene publication                    ●          ┊                  -37.2%  <.001  ▁▁▁▁▁▁█▅▄▁ ▅█▃▁▁▁▁▁▁▁
+ monospaced unchanged setter prepa…raph with 8192 paint spans      ●          ┊                  -37.3%  <.001  ▁▁▁▁▂█▂▂▂▁ ▅█▂▁▁▁▁▁▁▁
+ per-glyph inspection after width change                           ●─────┤    ┊                  -37.7%  <.001  ▁▆▂█▅▁▆▂▇█ ▁▁█▇▇▁▁▁▁▁
+ 1000 labels separated unbalanced…nk-space scene publication      ●┤          ┊                  -38.4%  <.001  ▁▁▁▁▁▁▄█▄▁ ▄█▂▁▁▁▁▁▁▁
+ 1000 labels last length-changing scene publication               ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▁▁█▇▄▁ ▄█▃▁▁▁▁▁▁▁
+ publication after width change                                   ●┤          ┊                  -38.5%  <.001  ▁▁▁▁▂█▄▁▂▁ ▇█▂▂▁▁▁▁▁▁
+ 1000 labels separated balanced gr…nk-space scene publication     ●┤          ┊                  -38.8%  <.001  ▁▁▁▁▁▁█▇▂▁ ▆█▂▁▁▁▁▁▁▁
+ write one paragraph and text mutation                           ├●──┤        ┊                  -38.8%  <.001  ▁▃█▃▁▂▁▁▁▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels separated balanced gr…k-space engine publication     ●           ┊                  -39.0%  <.001  ▁▁▁▁▁▁▁▄█▃ ▂█▂▁▁▁▁▁▁▁
+ 1000 labels first set+measure+scene-publication                  ●           ┊                  -39.2%  <.001  ▁▁▁▁▁▃█▅▃▂ ▆█▄▁▁▁▁▁▁▁
+ 1000 labels last length-changing engine publication              ●┤          ┊                  -39.4%  <.001  ▁▁▁▁▁▁▅█▄▂ ▆█▃▁▁▁▁▁▁▁
+ 1000 labels separated unbalanced…k-space engine publication      ●           ┊                  -39.7%  <.001  ▁▁▁▁▁▁▅█▂▁ ▅█▁▁▁▁▁▁▁▁
+ 1000 labels last same-length engine publication                  ●           ┊                  -39.9%  <.001  ▁▁▁▁▁▁█▅▄▁ ██▃▁▁▁▁▁▁▁
+ 1000 labels first same-length engine publication                 ●┤          ┊                  -40.0%  <.001  ▁▁▁▁▁▂█▆▄▂ ▄█▃▁▁▁▁▁▁▁
+ 100 labels interleaved edit-read publication                     ●           ┊                  -40.6%  <.001  ▁▁▁▁▁▁▁█▂▁ █▆▁▁▁▁▁▁▁▁
+ shared-material scattered end-to-…tion with 8192 paint spans    ●            ┊                  -43.1%  <.001  ▁▁▁▁▁▁▁▃█▂ █▂▁▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…ements without publication   ●┤            ┊                  -45.2%  <.001  ▁▁▁▁▁▁▄█▂▁ ▇█▂▁▁▁▁▁▁▁
+ inspection then publication after width change                 ●┤            ┊                  -45.9%  <.001  ▁▁▄▆▁▁▂▂█▆ ▁▁███▁▁▁▁▁
+ 100 labels 100 edits immediate measurements with publication  ├●             ┊                  -47.7%  <.001  ▁▁▁▁▁▁▁█▂▁ █▄▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing scene publication           ●              ┊                  -49.0%  <.001  ▁▁▁▁▁▁▁█▇▂ █▆▁▁▁▁▁▁▁▁
+ 1000 labels first length-changing engine publication          ●              ┊                  -49.9%  <.001  ▁▁▁▁▁▁▁█▇▂ █▇▁▁▁▁▁▁▁▁
+ scattered setter preparation in o…raph with 8192 paint spans  ◀              ┊                  -61.2%  <.001  ▁▁▁▁▁▁▂▇█▃ █▂▁▁▁▁▁▁▁▁
+ 1000 labels first color-only scene publication                ◀              ┊                  -61.5%  <.001  ▁▁▁▁▁▁█▅▃▂ █▇▃▁▁▁▁▁▁▁
+ broad setter preparation in one l…raph with 8192 paint spans  ◀              ┊                  -61.6%  <.001  ▁▁▁▁▁▁▁█▇▂ █▄▁▁▁▁▁▁▁▁
+ 1000 labels last color-only scene publication                 ◀              ┊                  -61.8%  <.001  ▁▁▁▁▁▁█▇▄▂ █▆▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits interleaved edit-read publication       ◀              ┊                  -62.9%  <.001  ▁▁▁▁▁▁▁▁█▂ █▁▁▁▁▁▁▁▁▁
+ shared-material scattered setter…raph with 8192 paint spans   ◀              ┊                  -64.9%  <.001  ▁▁▁▁▁▁▁▂█▃ █▁▁▁▁▁▁▁▁▁
+ monospaced broad setter preparati…raph with 8192 paint spans  ◀              ┊                  -67.4%  <.001  ▁▇▂▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
+ monospaced scattered setter prepa…raph with 8192 paint spans  ◀              ┊                  -68.6%  <.001  ▁▁▁▁▁▁▁▄█▃ █▂▁▁▁▁▁▁▁▁
+ 1000 labels last color-only engine publication                ◀              ┊                  -70.4%  <.001  ▁▁▁▁▁▁█▅▃▁ █▆▂▁▁▁▁▁▁▁
+ 1000 labels first color-only engine publication               ◀              ┊                  -71.7%  <.001  ▁▁▁▁▁▁█▃▂▁ █▅▂▁▁▁▁▁▁▁
+ 1000 labels 100 edits immediate m…surements with publication  ◀              ┊                  -79.9%  <.001  ▁▁▁▁▁▁▁▁█▆ █▁▁▁▁▁▁▁▁▁
+ monospaced broad end-to-end sette…tion with 8192 paint spans  ◀              ┊                  -87.9%  <.001  ▁▁▁▁▁▁▁▁▁█ █▁▁▁▁▁▁▁▁▁
  1000 labels first overwrite-before-scene-publication                        ├┼───●┤             +13.3%   .083  ▂█▅▄▃▄▂▁▁▁ ▁▁▁█▄▄▃▁▁▁
  100 labels first same-value-set                                              ├●┤                 +4.5%   .001  ▃█▅▆▂▂▂▁▁▁ ▁▁▆█▆▂▂▂▁▁
  1 labels first same-value-set                                                ┊●                  +4.1%   .007  ▄█▄▂▁▂▁▁▁▁ ▁▂█▄▂▂▁▁▁▁
  1000 labels first same-value-set                                             ┊●┤                 +3.2%   .001  ▁▃█▆▂▂▂▂▁▁ ▁▁▂█▆▂▂▂▁▁
  borrow glyphs from 1000 steadily promoted retained labels            ├───────┼●─┤                +2.6%   .645  ▇▂▂▁▁▁▁▁█▁ ▁▆█▃▁▁▂▂▇▃
  1000 labels no-op scene traversal                                           ├●┤                  +1.6%   .505  ▁█▆▄▂▁▁▁▁▁ ▂██▃▂▁▁▁▁▁
  borrow per-glyph metrics from 100 promoted labels                            ●┤                  +1.5%   .065  ▁▂▁▁▂▅█▂▁▁ ▁▁▁▁▂▄█▂▁▁
  reuse 1000 unchanged Vue property snapshots                                  ●┤                  +0.9%   .442  ▁█▆▂▁▁▁▁▁▁ ▂▆█▂▁▁▁▁▁▁
  100 labels no-op scene traversal                                            ├●─┤                 +0.5%   .382  ▄█▄▃▁▁▁▁▁▁ ▃█▄▃▂▁▁▁▁▁
  publish after text change                                                   ├●┤                  +0.4%   .798  ▂█▄▃▂▂▁▁▁▁ ▁█▆▂▁▁▁▁▁▁
  read every outline from an unchanged copy                                    ●                   +0.3%   .554  ▄█▃▁▁▁▂▁▁▁ ▄█▂▁▁▁▂▁▁▁
  toggle one group containing 1000 retained labels                            ├●─┤                 +0.1%   .878  ▃█▄▅▄▂▁▁▁▁ ▁▆█▅▃▂▁▁▁▁
  measure 1000 unchanged retained labels                                    ├──●─┤                 -0.7%   .574  ▁▂▇█▆▃▂▂▁▁ ▁▄█▇▆▄▃▁▁▁
  10 labels first length-changing engine publication                          ├●                   -1.1%   .314  ▁█▇▄▄▃▂▂▁▁ ▁▆█▃▂▂▁▂▁▁
  mount a label and publish its first edit                                  ├──●                   -1.6%   .065  ▅█▄▂▂▁▁▁▁▁ ▅█▃▂▁▁▁▁▁▁
  10 labels last length-changing scene publication                         ├──●┼┤                  -2.0%   .279  ▂█▆▆▅▃▂▂▂▁ ▁██▄▃▂▂▁▁▁
  move 1000 retained TypeGPU labels                                          ├●┼┤                  -2.2%   .505  ▁▄█▇▂▁▁▁▁▁ ▂▆█▆▃▂▁▁▁▁
  10 labels last length-changing engine publication                          ├●┤                   -2.5%   .130  ▁▇█▅▅▂▂▁▁▁ ▁▆█▄▃▂▁▂▁▁
  10 labels first length-changing scene publication                        ├──●┤                   -2.9%   .161  ▁█▆▆▆▄▂▂▁▁ ▁▆█▄▂▂▁▁▁▁
  reorder then edit one of 1000 retained labels                               ●┤                   -3.9%   .001  ▁▄█▇▄▄▂▂▂▁ ▄█▅▄▂▂▂▂▁▁
  100 labels first same-length engine publication                            ●┤┊                   -5.1%   .015  ▁▆█▅▂▁▁▂▁▁ ▂█▇▃▂▁▁▂▁▁
  10 labels first color-only engine publication                            ├─●─┼┤                  -6.6%   .130  ▁█▇▄▃▂▁▁▁▁ ▃█▄▃▂▂▁▁▁▁
                                                                └──────────────┴──────────────┘
                                                                -50%           0           +50%
```

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🔴 slower | 1 labels first set | 1.16µs | 16.67µs | +0.016ms | +1339.6% | <.001 | +1307.5..+1380.3% |
| 🔴 slower | 1000 labels first set | 1.49µs | 16.35µs | +0.015ms | +994.5% | <.001 | +960.0..+1012.4% |
| 🔴 slower | 100 labels first set | 1.53µs | 15.79µs | +0.014ms | +933.8% | <.001 | +923.0..+961.3% |
| 🔴 slower | type one character into a long Fredoka paragraph and measure | 519.42µs | 2.03ms | +1.511ms | +290.5% | <.001 | +282.3..+305.9% |
| 🔴 slower | type one character into a long paragraph and measure | 516.67µs | 1.69ms | +1.173ms | +228.0% | <.001 | +171.1..+268.5% |
| 🔴 slower | long unsafe-boundary paragraph reflow | 354.15µs | 631.67µs | +0.278ms | +78.4% | <.001 | +74.2..+84.2% |
| 🔴 slower | 100 labels first overwrite-before-scene-publication | 321.15µs | 491.42µs | +0.170ms | +53.0% | <.001 | +49.2..+56.8% |
| 🔴 slower | measure after text change | 1.13ms | 1.61ms | +0.480ms | +43.4% | <.001 | +41.8..+45.5% |
| 🔴 slower | 1 labels first overwrite-before-scene-publication | 258.27µs | 361.29µs | +0.103ms | +39.9% | <.001 | +31.6..+46.4% |
| 🔴 slower | measurement after width change | 853.02µs | 1.18ms | +0.327ms | +38.8% | <.001 | +36.7..+39.7% |
| 🔴 slower | long reporter workaround paragraph reflow | 427.71µs | 582.46µs | +0.155ms | +36.2% | <.001 | +35.3..+39.1% |
| 🔴 slower | rewrite 512 labels in one group | 7.01ms | 9.25ms | +2.240ms | +31.9% | <.001 | +29.8..+34.2% |
| 🔴 slower | copy per-glyph metrics from 100 unchanged labels | 134.79µs | 175.54µs | +0.041ms | +30.2% | <.001 | +20.8..+33.4% |
| 🔴 slower | rewrite 128 labels in one group | 1.82ms | 2.36ms | +0.540ms | +29.6% | <.001 | +28.0..+31.1% |
| 🔴 slower | rewrite 256 labels in one group | 3.51ms | 4.46ms | +0.950ms | +27.2% | <.001 | +22.7..+33.0% |
| 🔴 slower | rewrite 64 labels in one group | 1.09ms | 1.35ms | +0.260ms | +24.6% | <.001 | +22.5..+26.4% |
| 🔴 slower | 10 labels no-op scene traversal | 3.16µs | 3.81µs | +0.000650ms | +20.7% | <.001 | +14.6..+24.5% |
| 🔴 slower | publication after font-size change | 6.24ms | 7.50ms | +1.260ms | +20.1% | <.001 | +19.5..+21.1% |
| 🔴 slower | publish 1024 retained Text instances | 15.25ms | 18.09ms | +2.840ms | +18.7% | <.001 | +16.5..+21.4% |
| 🔴 slower | 10 labels last same-length engine publication | 309.58µs | 359.63µs | +0.050ms | +16.2% | .007 | +8.4..+26.7% |
| 🔴 slower | 10 labels first same-length engine publication | 307.65µs | 351.10µs | +0.043ms | +14.1% | <.001 | +9.9..+17.3% |
| 🔴 slower | mount and publish a 22k-glyph paragraph | 17.60ms | 19.96ms | +2.360ms | +13.4% | <.001 | +12.3..+14.9% |
| 🔴 slower | mount 100 labels and borrow glyphs from each once | 10.00ms | 11.17ms | +1.170ms | +11.7% | <.001 | +10.8..+13.0% |
| 🔴 slower | relayout after font-size change | 1.82ms | 2.02ms | +0.200ms | +11.2% | <.001 | +8.3..+13.0% |
| 🔴 slower | 10 labels first same-length scene publication | 329.04µs | 365.29µs | +0.036ms | +11.0% | <.001 | +7.7..+16.1% |
| 🔴 slower | publish after color change | 1.25ms | 1.38ms | +0.130ms | +9.8% | <.001 | +8.5..+11.2% |
| 🔴 slower | 10 labels last same-length scene publication | 330.85µs | 362.71µs | +0.032ms | +9.6% | <.001 | +7.3..+13.9% |
| 🔴 slower | long unsafe-boundary paragraph text edit | 1.61ms | 1.74ms | +0.130ms | +8.1% | <.001 | +6.8..+9.1% |
| 🔴 slower | publication after text change | 6.48ms | 6.84ms | +0.360ms | +5.5% | <.001 | +3.0..+6.1% |
| 🟢 faster | 100 labels last same-length scene publication | 494.31µs | 469.77µs | -0.025ms | -5.0% | .021 | -7.4..-2.7% |
| 🟢 faster | 100 labels last same-length engine publication | 447.90µs | 425.44µs | -0.022ms | -5.0% | <.001 | -7.3..-2.1% |
| 🟢 faster | 100 labels first same-length scene publication | 501.50µs | 476.00µs | -0.025ms | -5.1% | .038 | -12.2..-0.7% |
| 🟢 faster | reorder 1000 unchanged retained labels | 2.33ms | 2.19ms | -0.140ms | -5.9% | .028 | -7.4..-1.9% |
| 🟢 faster | write 22k UTF16 text into Wasm request arena | 39.35µs | 36.83µs | -0.003ms | -6.4% | .005 | -7.7..-0.9% |
| 🟢 faster | issue 216 unsafe-boundary word-wrap reflow | 192.08µs | 176.88µs | -0.015ms | -7.9% | <.001 | -12.4..-6.3% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space engine publication | 798.38µs | 727.08µs | -0.071ms | -8.9% | <.001 | -10.1..-7.0% |
| 🟢 faster | write 22k UTF16 text into owned array control | 40.00µs | 36.46µs | -0.004ms | -8.9% | <.001 | -9.9..-6.8% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space scene publication | 853.04µs | 776.69µs | -0.076ms | -9.0% | <.001 | -17.7..-8.1% |
| 🟢 faster | measure 100 unchanged labels | 7.03µs | 6.39µs | -0.000640ms | -9.0% | .002 | -14.5..-4.5% |
| 🟢 faster | 100 labels separated balanced grow-shrink-space engine publication | 792.73µs | 720.40µs | -0.072ms | -9.1% | <.001 | -12.9..-7.0% |
| 🟢 faster | 100 labels separated unbalanced grow-shrink-space scene publication | 850.98µs | 771.04µs | -0.080ms | -9.4% | .007 | -11.3..-7.9% |
| 🟢 faster | mutate one trailing span across 1000 formatted labels | 40.20ms | 36.34ms | -3.860ms | -9.6% | <.001 | -10.4..-8.6% |
| 🟢 faster | 100 labels last length-changing engine publication | 618.19µs | 559.13µs | -0.059ms | -9.6% | .050 | -11.5..-1.3% |
| 🟢 faster | 10 labels first color-only scene publication | 282.10µs | 253.56µs | -0.029ms | -10.1% | <.001 | -11.9..-8.1% |
| 🟢 faster | normalize 1000 equivalent formatted flow updates | 5.31ms | 4.77ms | -0.540ms | -10.2% | <.001 | -13.1..-9.0% |
| 🟢 faster | 100 labels last length-changing scene publication | 674.83µs | 600.35µs | -0.074ms | -11.0% | <.001 | -13.2..-8.2% |
| 🟢 faster | copy per-glyph metrics with outlines after text change | 3.52ms | 3.10ms | -0.420ms | -11.9% | <.001 | -13.4..-10.0% |
| 🟢 faster | 10 labels last color-only engine publication | 267.25µs | 234.52µs | -0.033ms | -12.2% | .010 | -14.4..-6.1% |
| 🟢 faster | 10 labels last color-only scene publication | 292.40µs | 252.56µs | -0.040ms | -13.6% | <.001 | -16.6..-10.3% |
| 🟢 faster | 1 labels first set+measure+scene-publication | 422.65µs | 364.35µs | -0.058ms | -13.8% | <.001 | -20.9..-11.6% |
| 🟢 faster | cached measurement | 35.88ns | 30.89ns | -0.000005ms | -13.9% | <.001 | -15.4..-12.0% |
| 🟢 faster | type one character into a long paragraph and publish a frame | 3.28ms | 2.81ms | -0.470ms | -14.1% | <.001 | -14.9..-13.7% |
| 🟢 faster | issue 216 reporter workaround | 201.04µs | 172.60µs | -0.028ms | -14.1% | <.001 | -17.3..-11.7% |
| 🟢 faster | common-safe word-wrap reflow | 192.77µs | 163.13µs | -0.030ms | -15.4% | <.001 | -18.9..-11.7% |
| 🟢 faster | write 1000 paragraph and text mutations | 84.98µs | 71.50µs | -0.013ms | -15.9% | <.001 | -17.8..-13.8% |
| 🟢 faster | edit and independently copy one label among 1 labels | 1.02ms | 848.04µs | -0.172ms | -16.5% | <.001 | -18.0..-15.2% |
| 🟢 faster | bind and normalize 1000 framework-shaped formatted flow updates | 5.94ms | 4.91ms | -1.030ms | -17.4% | <.001 | -18.1..-16.0% |
| 🟢 faster | 100 labels batched edit-read publication | 5.41ms | 4.42ms | -0.990ms | -18.2% | <.001 | -19.1..-17.2% |
| 🟢 faster | write 1000 paragraph-order mutations | 14.75µs | 12.06µs | -0.003ms | -18.2% | <.001 | -20.5..-15.7% |
| 🟢 faster | 100 labels first set+measure+scene-publication | 599.60µs | 490.12µs | -0.109ms | -18.3% | <.001 | -28.6..-15.4% |
| 🟢 faster | edit and independently copy one label among 100 labels | 1.17ms | 943.15µs | -0.227ms | -19.3% | <.001 | -21.7..-16.2% |
| 🟢 faster | 100 labels first length-changing scene publication | 816.46µs | 656.08µs | -0.160ms | -19.6% | <.001 | -20.9..-14.0% |
| 🟢 faster | copy per-glyph metrics after text change | 3.79ms | 3.05ms | -0.740ms | -19.6% | <.001 | -20.6..-13.6% |
| 🟢 faster | edit and measure one of 100 retained labels | 145.15µs | 115.50µs | -0.030ms | -20.4% | <.001 | -27.5..-14.8% |
| 🟢 faster | broad end-to-end setter and publication with 8192 paint spans | 20.24ms | 16.05ms | -4.190ms | -20.7% | <.001 | -21.6..-20.2% |
| 🟢 faster | 100 labels first length-changing engine publication | 783.77µs | 612.31µs | -0.171ms | -21.9% | <.001 | -24.9..-20.9% |
| 🟢 faster | edit and sparsely borrow one of 1000 retained labels | 226.27µs | 176.69µs | -0.050ms | -21.9% | <.001 | -23.0..-17.1% |
| 🟢 faster | 100 labels first color-only engine publication | 327.27µs | 249.83µs | -0.077ms | -23.7% | <.001 | -28.1..-19.0% |
| 🟢 faster | 100 labels last color-only scene publication | 389.44µs | 293.06µs | -0.096ms | -24.7% | <.001 | -27.3..-23.5% |
| 🟢 faster | reflow after width change | 465.54µs | 350.44µs | -0.115ms | -24.7% | <.001 | -28.6..-20.6% |
| 🟢 faster | 100 labels first color-only scene publication | 397.23µs | 298.35µs | -0.099ms | -24.9% | <.001 | -26.9..-20.0% |
| 🟢 faster | measurement then publication after width change | 1.86ms | 1.39ms | -0.470ms | -25.3% | <.001 | -25.9..-24.3% |
| 🟢 faster | 1000 labels 100 edits batched edit-read publication | 8.99ms | 6.65ms | -2.340ms | -26.0% | <.001 | -26.8..-24.2% |
| 🟢 faster | 100 labels last color-only engine publication | 335.77µs | 248.27µs | -0.087ms | -26.1% | <.001 | -27.4..-23.4% |
| 🟢 faster | scattered end-to-end setter and publication with 8192 paint spans | 19.96ms | 14.67ms | -5.290ms | -26.5% | <.001 | -27.2..-25.7% |
| 🟢 faster | edit and measure one of 1000 retained labels | 204.04µs | 146.08µs | -0.058ms | -28.4% | <.001 | -36.5..-26.7% |
| 🟢 faster | edit and independently copy one label among 1000 labels | 2.55ms | 1.81ms | -0.740ms | -28.9% | <.001 | -30.0..-28.0% |
| 🟢 faster | split move and merge paint boundaries preparation only | 6.45ms | 4.57ms | -1.880ms | -29.1% | <.001 | -29.4..-28.6% |
| 🟢 faster | 100 labels 100 edits immediate measurements without publication | 2.81ms | 1.89ms | -0.920ms | -32.7% | <.001 | -34.3..-31.5% |
| 🟢 faster | split move and merge paint boundaries publication | 8.98ms | 5.87ms | -3.110ms | -34.6% | <.001 | -34.9..-33.2% |
| 🟢 faster | 1 labels first set+measure | 173.29µs | 112.73µs | -0.061ms | -34.9% | <.001 | -46.2..-29.0% |
| 🟢 faster | monospaced scattered end-to-end setter and publication with 8192 paint spans | 17.61ms | 11.42ms | -6.190ms | -35.1% | <.001 | -36.3..-34.6% |
| 🟢 faster | 1000 labels first same-length scene publication | 2.56ms | 1.63ms | -0.930ms | -36.2% | <.001 | -36.8..-35.4% |
| 🟢 faster | unchanged setter preparation in one large paragraph with 8192 paint spans | 4.28ms | 2.71ms | -1.570ms | -36.7% | <.001 | -37.2..-36.1% |
| 🟢 faster | unchanged end-to-end setter and publication with 8192 paint spans | 4.37ms | 2.76ms | -1.610ms | -37.0% | <.001 | -37.4..-35.9% |
| 🟢 faster | monospaced unchanged end-to-end setter and publication with 8192 paint spans | 4.38ms | 2.76ms | -1.620ms | -37.0% | <.001 | -37.5..-36.0% |
| 🟢 faster | 1000 labels last same-length scene publication | 2.58ms | 1.62ms | -0.960ms | -37.2% | <.001 | -38.2..-36.1% |
| 🟢 faster | monospaced unchanged setter preparation in one large paragraph with 8192 paint spans | 4.30ms | 2.69ms | -1.610ms | -37.3% | <.001 | -38.3..-36.1% |
| 🟢 faster | per-glyph inspection after width change | 7.09ms | 4.42ms | -2.670ms | -37.7% | <.001 | -38.2..-17.2% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space scene publication | 4.95ms | 3.05ms | -1.900ms | -38.4% | <.001 | -39.1..-37.7% |
| 🟢 faster | 1000 labels last length-changing scene publication | 3.08ms | 1.90ms | -1.180ms | -38.5% | <.001 | -39.7..-37.6% |
| 🟢 faster | publication after width change | 1.13ms | 693.73µs | -0.436ms | -38.5% | <.001 | -40.5..-37.5% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space scene publication | 4.85ms | 2.97ms | -1.880ms | -38.8% | <.001 | -40.6..-37.9% |
| 🟢 faster | write one paragraph and text mutation | 846.70ns | 517.76ns | -0.000329ms | -38.8% | <.001 | -44.6..-29.4% |
| 🟢 faster | 1000 labels separated balanced grow-shrink-space engine publication | 4.47ms | 2.73ms | -1.740ms | -39.0% | <.001 | -39.6..-38.5% |
| 🟢 faster | 1000 labels first set+measure+scene-publication | 2.72ms | 1.65ms | -1.070ms | -39.2% | <.001 | -40.6..-38.7% |
| 🟢 faster | 1000 labels last length-changing engine publication | 2.75ms | 1.67ms | -1.080ms | -39.4% | <.001 | -40.4..-38.3% |
| 🟢 faster | 1000 labels separated unbalanced grow-shrink-space engine publication | 4.58ms | 2.76ms | -1.820ms | -39.7% | <.001 | -41.1..-39.0% |
| 🟢 faster | 1000 labels last same-length engine publication | 2.27ms | 1.36ms | -0.910ms | -39.9% | <.001 | -40.6..-39.3% |
| 🟢 faster | 1000 labels first same-length engine publication | 2.30ms | 1.38ms | -0.920ms | -40.0% | <.001 | -40.8..-37.7% |
| 🟢 faster | 100 labels interleaved edit-read publication | 17.88ms | 10.63ms | -7.250ms | -40.6% | <.001 | -41.1..-39.9% |
| 🟢 faster | shared-material scattered end-to-end setter and publication with 8192 paint spans | 26.85ms | 15.27ms | -11.580ms | -43.1% | <.001 | -43.6..-42.7% |
| 🟢 faster | 1000 labels 100 edits immediate measurements without publication | 3.79ms | 2.08ms | -1.710ms | -45.2% | <.001 | -45.6..-44.8% |
| 🟢 faster | inspection then publication after width change | 8.63ms | 4.67ms | -3.960ms | -45.9% | <.001 | -47.6..-43.6% |
| 🟢 faster | 100 labels 100 edits immediate measurements with publication | 11.79ms | 6.16ms | -5.630ms | -47.7% | <.001 | -48.6..-47.4% |
| 🟢 faster | 1000 labels first length-changing scene publication | 4.57ms | 2.33ms | -2.240ms | -49.0% | <.001 | -49.8..-48.4% |
| 🟢 faster | 1000 labels first length-changing engine publication | 4.28ms | 2.14ms | -2.140ms | -49.9% | <.001 | -51.0..-49.1% |
| 🟢 faster | scattered setter preparation in one large paragraph with 8192 paint spans | 32.92ms | 12.78ms | -20.140ms | -61.2% | <.001 | -61.5..-60.5% |
| 🟢 faster | 1000 labels first color-only scene publication | 2.01ms | 773.48µs | -1.237ms | -61.5% | <.001 | -62.2..-60.0% |
| 🟢 faster | broad setter preparation in one large paragraph with 8192 paint spans | 32.17ms | 12.35ms | -19.820ms | -61.6% | <.001 | -61.9..-61.2% |
| 🟢 faster | 1000 labels last color-only scene publication | 2.00ms | 762.23µs | -1.238ms | -61.8% | <.001 | -62.9..-61.0% |
| 🟢 faster | 1000 labels 100 edits interleaved edit-read publication | 121.45ms | 45.06ms | -76.390ms | -62.9% | <.001 | -63.0..-62.5% |
| 🟢 faster | shared-material scattered setter preparation in one large paragraph with 8192 paint spans | 39.35ms | 13.82ms | -25.530ms | -64.9% | <.001 | -65.7..-64.5% |
| 🟢 faster | monospaced broad setter preparation in one large paragraph with 8192 paint spans | 39.93ms | 13.04ms | -26.890ms | -67.4% | <.001 | -68.7..-66.7% |
| 🟢 faster | monospaced scattered setter preparation in one large paragraph with 8192 paint spans | 31.70ms | 9.96ms | -21.740ms | -68.6% | <.001 | -68.8..-68.0% |
| 🟢 faster | 1000 labels last color-only engine publication | 1.63ms | 483.35µs | -1.147ms | -70.4% | <.001 | -70.8..-69.8% |
| 🟢 faster | 1000 labels first color-only engine publication | 1.68ms | 474.50µs | -1.206ms | -71.7% | <.001 | -72.6..-71.0% |
| 🟢 faster | 1000 labels 100 edits immediate measurements with publication | 90.91ms | 18.23ms | -72.680ms | -79.9% | <.001 | -80.0..-79.1% |
| 🟢 faster | monospaced broad end-to-end setter and publication with 8192 paint spans | 136.74ms | 16.56ms | -120.180ms | -87.9% | <.001 | -88.0..-87.7% |

<details><summary>22 neutral, 4 skipped</summary>

| status | bench | baseline | candidate | Δ time | Δ p50 | p | 95% CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | 10 labels first length-changing scene publication | 493.29µs | 479.04µs | -0.014ms | -2.9% | .161 | -13.6..+0.5% |
| neutral | 10 labels first length-changing engine publication | 459.85µs | 454.92µs | -0.005ms | -1.1% | .314 | -4.3..+1.1% |
| neutral | 10 labels first color-only engine publication | 263.83µs | 246.35µs | -0.017ms | -6.6% | .130 | -14.6..+3.3% |
| neutral | 10 labels last length-changing scene publication | 466.54µs | 457.08µs | -0.009ms | -2.0% | .279 | -14.0..+1.8% |
| neutral | 10 labels last length-changing engine publication | 458.92µs | 447.25µs | -0.012ms | -2.5% | .130 | -5.6..+0.5% |
| neutral | 100 labels no-op scene traversal | 61.75µs | 62.08µs | +0.000330ms | +0.5% | .382 | -2.4..+6.4% |
| neutral | 100 labels first same-length engine publication | 451.27µs | 428.33µs | -0.023ms | -5.1% | .015 | -6.4..-2.3% |
| neutral | 1000 labels no-op scene traversal | 380.88µs | 387.06µs | +0.006ms | +1.6% | .505 | -2.6..+4.5% |
| neutral | mount a label and publish its first edit | 2.34ms | 2.30ms | -0.040ms | -1.6% | .065 | -9.3..+0.7% |
| neutral | publish after text change | 1.94ms | 1.95ms | +0.010ms | +0.4% | .798 | -1.7..+2.2% |
| neutral | reuse 1000 unchanged Vue property snapshots | 186.88µs | 188.48µs | +0.002ms | +0.9% | .442 | -0.9..+2.3% |
| neutral | borrow per-glyph metrics from 100 promoted labels | 219.46µs | 222.65µs | +0.003ms | +1.5% | .065 | -0.0..+2.9% |
| neutral | read every outline from an unchanged copy | 870.50µs | 873.35µs | +0.003ms | +0.3% | .554 | -1.2..+1.2% |
| neutral | 1 labels first same-value-set | 66.97ns | 69.72ns | +0.000003ms | +4.1% | .007 | +2.4..+4.6% |
| neutral | 100 labels first same-value-set | 67.36ns | 70.35ns | +0.000003ms | +4.5% | .001 | +1.3..+5.8% |
| neutral | 1000 labels first same-value-set | 68.78ns | 70.99ns | +0.000002ms | +3.2% | .001 | +1.9..+5.1% |
| neutral | 1000 labels first overwrite-before-scene-publication | 1.45ms | 1.64ms | +0.190ms | +13.3% | .083 | -1.7..+16.8% |
| neutral | toggle one group containing 1000 retained labels | 412.63µs | 413.10µs | +0.000470ms | +0.1% | .878 | -2.5..+5.7% |
| neutral | reorder then edit one of 1000 retained labels | 5.68ms | 5.46ms | -0.220ms | -3.9% | .001 | -4.4..-1.5% |
| neutral | measure 1000 unchanged retained labels | 231.33µs | 229.63µs | -0.002ms | -0.7% | .574 | -8.5..+7.3% |
| neutral | borrow glyphs from 1000 steadily promoted retained labels | 1.02ms | 1.05ms | +0.030ms | +2.6% | .645 | -27.0..+8.7% |
| neutral | move 1000 retained TypeGPU labels | 248.75µs | 243.21µs | -0.006ms | -2.2% | .505 | -5.5..+4.4% |
| skipped: clock-confounded: neutral→faster · 4.13→3.79 | normalize 1000 equivalent retained label updates |  |  |  |  |  |  |
| skipped: timing-mode mismatch | cached per-glyph inspection |  |  |  |  |  |  |
| skipped: timing-mode mismatch | 100 labels first set+measure |  |  |  |  |  |  |
| skipped: timing-mode mismatch | 1000 labels first set+measure |  |  |  |  |  |  |

</details>
