---
type: Log Entry
title: 'Font survey: which fonts leave an edit a window to reshape'
generated:
  by: process:docs-new
  at: '2026-11-24T18:56:55Z'
---

Surveyed 61 fonts to see how much of a shaping run one edit reshapes, before and after the ASCII-anchor splice was
replaced (see the [2026-11-24 edit windows section](../planning/wasm-size-reduction.md) and
[glyph](../packages/glyph.md)). Nothing was downloaded: the fonts are the repository fixtures, the adversarial set, the
fonts of this macOS install and copies already on the machine. Montserrat and Poppins were not available.

Method: a scratch tool outside the repository (`glyph-scratch/anchor/survey`, built against the vendored HarfRust fork
with the features the shaper uses, so no AAT) shapes one run of ordinary prose per font (822 units of English, or 113 to
351 units in the font's script, mostly the first articles of the Universal Declaration of Human Rights), then replays the
engine's window rule for an insertion and a one-cluster deletion at every cluster boundary, 227 to 1,643 edits per
font. Each replay splices the reshaped window into the retained glyphs and compares the result with a cold shape of
the new text: ids, clusters, advances, offsets and flags. All 61 fonts spliced equal under both rules (0 differing
edits of about 80,000 each).

Columns: clusters HarfRust flags unsafe to concatenate, unsafe to break, and unsafe to concatenate for more than a
simple adjacent pair; then the units one edit shapes as median and as mean share of the run, under the rule of the
replacement commit (boundaries no glyph flags, whole run when the fresh shape refuses) and under the final rule
(also boundaries between two clusters that stand alone, refused ends moved out up to three times).

| Font                     | Text       | Source          | Concat | Break | Beyond pairs | Replacement: median, share | Final: median, share | Kern table: median, share |
| ------------------------ | ---------- | --------------- | -----: | ----: | -----------: | -------------------------: | -------------------: | ------------------------: |
| Inter 4.1                | latin      | repo fixture    |  97.4% | 14.3% |        25.2% |                  58, 11.1% |             14, 2.2% |                  14, 2.2% |
| Fredoka                  | latin      | repo fixture    |  99.9% | 20.3% |         8.4% |                822, 100.0% |             11, 1.5% |                  11, 1.5% |
| Source Serif 4           | latin      | repo fixture    |  98.3% | 22.6% |        29.2% |                 479, 47.1% |             17, 2.4% |                  17, 2.4% |
| Dancing Script           | latin      | repo fixture    |  97.0% |  3.0% |        28.6% |                   67, 9.9% |             16, 2.4% |                  16, 2.4% |
| DotGothic16              | latin      | repo fixture    |   0.0% |  0.0% |         0.0% |                   11, 1.3% |             11, 1.3% |                  11, 1.3% |
| Amiri (Latin)            | latin      | repo fixture    |  27.5% |  0.4% |         3.0% |                   11, 2.8% |             11, 1.4% |                  11, 1.4% |
| Noto Sans CJK JP (Latin) | latin      | repo fixture    |  96.4% | 16.8% |        15.3% |                 136, 14.2% |             13, 1.8% |                  13, 1.8% |
| EB Garamond              | latin      | adversarial set |  93.3% |  8.2% |         3.0% |                   31, 9.2% |             11, 1.4% |                  11, 1.4% |
| EB Garamond Italic       | latin      | adversarial set |  94.8% | 17.4% |         3.0% |                   36, 9.1% |             11, 1.4% |                  11, 1.4% |
| Fira Code                | latin      | adversarial set |  33.9% |  0.6% |        25.9% |                  11, 13.0% |             12, 1.8% |                  12, 1.8% |
| Recursive (static)       | latin      | adversarial set |  94.1% | 17.7% |        25.7% |                   50, 7.8% |             15, 2.1% |                  15, 2.1% |
| Cherry Cream Soda        | latin      | adversarial set | 100.0% |  3.3% |         0.0% |                822, 100.0% |          822, 100.0% |                  10, 5.0% |
| Syncopate                | latin      | adversarial set |  59.7% |  3.5% |         0.0% |                   13, 3.8% |             11, 1.3% |                  11, 1.3% |
| Hind Madurai (Latin)     | latin      | adversarial set |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| Roboto                   | latin      | local copy      |  69.0% |  6.2% |         2.5% |                   15, 4.6% |             11, 1.4% |                  11, 1.4% |
| Noto Sans                | latin      | local copy      |  83.5% |  6.2% |        23.5% |                   20, 4.2% |             14, 1.9% |                  14, 1.9% |
| Open Sans                | latin      | local copy      | 100.0% |  6.2% |         0.1% |                822, 100.0% |          822, 100.0% |                  11, 1.4% |
| Source Sans Pro          | latin      | local copy      |  93.5% | 16.6% |        41.5% |                   42, 8.6% |             20, 3.0% |                  20, 3.0% |
| Lato                     | latin      | system (rdoc)   |   4.9% |  4.9% |         0.0% |                   11, 1.4% |             11, 1.3% |                  11, 1.3% |
| IBM Plex Sans            | latin      | local copy      |  91.4% | 15.6% |         8.2% |                   32, 7.6% |             11, 1.6% |                  11, 1.6% |
| IBM Plex Mono            | latin      | local copy      |  10.7% |  0.0% |         5.4% |                   11, 1.3% |             11, 1.3% |                  11, 1.3% |
| Work Sans                | latin      | local copy      |  96.4% | 19.1% |         5.6% |                   56, 9.3% |             11, 1.5% |                  11, 1.5% |
| Noto Serif               | latin      | local copy      |   2.7% |  2.7% |         0.0% |                   11, 1.3% |             10, 1.3% |                  10, 1.3% |
| Roboto Flex              | latin      | local copy      |  92.8% |  9.1% |         0.6% |                   39, 6.7% |             11, 1.3% |                  11, 1.3% |
| JetBrains Mono           | latin      | local copy      |  16.1% |  0.0% |         9.5% |                   11, 3.3% |             11, 1.4% |                  11, 1.4% |
| Geist                    | latin      | local copy      |  88.3% | 63.7% |        10.9% |                   19, 4.5% |             11, 1.6% |                  11, 1.6% |
| Barlow Condensed         | latin      | local copy      |  91.6% | 12.2% |         6.9% |                   30, 5.7% |             11, 1.5% |                  11, 1.5% |
| SF NS (system UI)        | latin      | macOS           |  96.6% | 13.8% |         5.5% |                  74, 11.5% |             11, 1.5% |                  11, 1.5% |
| New York                 | latin      | macOS           |  93.9% | 13.4% |         0.1% |                   57, 9.7% |             11, 1.3% |                  11, 1.3% |
| Helvetica                | latin      | macOS           | 100.0% |  2.8% |         0.0% |                822, 100.0% |          822, 100.0% |                  10, 2.2% |
| Helvetica Neue           | latin      | macOS           | 100.0% |  4.6% |         0.0% |                822, 100.0% |          822, 100.0% |                 10, 27.9% |
| Times                    | latin      | macOS           | 100.0% |  2.9% |         0.0% |                822, 100.0% |          822, 100.0% |                  10, 2.2% |
| Avenir Next              | latin      | macOS           |  83.5% | 12.6% |         2.0% |                   20, 5.1% |             11, 1.4% |                  11, 1.4% |
| Menlo                    | latin      | macOS           |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| Arial                    | latin      | macOS           |  13.5% |  2.8% |         5.4% |                   11, 1.4% |             11, 1.3% |                  11, 1.3% |
| Times New Roman          | latin      | macOS           | 100.0% |  2.9% |         5.4% |                822, 100.0% |          822, 100.0% |                  11, 2.0% |
| Georgia                  | latin      | macOS           |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| Verdana                  | latin      | macOS           | 100.0% |  4.4% |         0.0% |                822, 100.0% |          822, 100.0% |                  10, 1.3% |
| Trebuchet MS             | latin      | macOS           | 100.0% |  2.3% |         0.0% |                822, 100.0% |          822, 100.0% |                  10, 2.4% |
| Tahoma                   | latin      | macOS           |  19.5% | 10.1% |         5.4% |                   11, 1.3% |             11, 1.3% |                  11, 1.3% |
| Courier New              | latin      | macOS           |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| Comic Sans MS            | latin      | macOS           |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| PT Sans                  | latin      | macOS           |  77.2% | 13.9% |         0.0% |                   17, 6.7% |             11, 1.4% |                  11, 1.4% |
| Arial Unicode            | latin      | macOS           |   0.0% |  0.0% |         0.0% |                   10, 1.3% |             10, 1.3% |                  10, 1.3% |
| Amiri                    | arabic     | repo fixture    | 100.0% | 35.3% |        96.0% |                351, 100.0% |          351, 100.0% |               351, 100.0% |
| Noto Sans Arabic         | arabic     | local copy      |  99.4% | 37.0% |        89.6% |                 238, 57.5% |           238, 57.4% |                238, 57.4% |
| Geeza Pro                | arabic     | macOS           |  98.6% | 40.8% |        99.7% |                  96, 28.6% |            96, 28.1% |               351, 100.0% |
| SF Arabic                | arabic     | macOS           |  99.7% | 40.3% |        95.5% |                 239, 57.7% |           239, 57.7% |                239, 57.7% |
| Noto Nastaliq Urdu       | urdu       | adversarial set |  99.6% | 39.5% |        91.2% |                 144, 54.5% |           144, 54.5% |                144, 54.5% |
| Noto Sans Hebrew         | hebrew     | adversarial set |  15.9% |  8.9% |         0.0% |                   11, 7.2% |             10, 4.4% |                  10, 4.4% |
| SF Hebrew                | hebrew     | macOS           |  97.2% | 16.3% |        67.9% |                  84, 35.2% |            57, 30.3% |                 57, 30.3% |
| Noto Sans Devanagari     | devanagari | repo fixture    |  91.1% |  8.5% |        55.7% |                  35, 14.7% |            37, 13.8% |                 37, 13.8% |
| Kohinoor Devanagari      | devanagari | macOS           |  85.5% |  3.8% |        49.1% |                  30, 10.7% |             30, 8.1% |                  30, 8.1% |
| Noto Sans Bengali        | bengali    | adversarial set |  93.4% | 18.5% |        81.0% |                  57, 21.2% |            57, 17.8% |                 57, 17.8% |
| Noto Sans Thai           | thai       | adversarial set |  44.7% |  7.2% |        21.5% |                  14, 19.6% |             14, 6.2% |                  14, 6.2% |
| Thonburi                 | thai       | macOS           |  33.8% |  0.0% |        13.9% |                  14, 13.4% |             14, 5.5% |                  14, 5.5% |
| Noto Sans CJK JP         | japanese   | repo fixture    |  25.3% | 11.0% |         8.9% |                   11, 8.1% |             11, 7.8% |                  11, 7.8% |
| Hiragino Sans W3         | japanese   | macOS           |  15.8% |  7.5% |         4.1% |                   11, 7.7% |             11, 7.4% |                  11, 7.4% |
| Noto Sans CJK SC         | chinese    | adversarial set |   5.3% |  0.0% |         0.0% |                   11, 9.2% |             10, 9.1% |                  10, 9.1% |
| Noto Sans KR             | korean     | adversarial set |   8.3% |  0.0% |         0.0% |                   11, 5.9% |             10, 5.7% |                  10, 5.7% |
| Apple SD Gothic Neo      | korean     | macOS           |   0.0% |  0.0% |         0.0% |                   10, 5.7% |             10, 5.7% |                  10, 5.7% |

Classes under the replacement rule, by mean share of the run one edit shapes:

- **Windows (under 25%): 45 of 61 fonts, the majority.** Inter, Roboto, Noto Sans, Noto Serif, Lato, Source Sans,
  IBM Plex, Work Sans, EB Garamond, Geist, the monospaced fonts, SF, Avenir Next, Arial, Georgia, Tahoma, and the
  Devanagari, Bengali, Thai, Japanese, Chinese and Korean fonts.
- **Whole run: 10 fonts.** Fredoka, whose `kern` lookup holds the space in its first-glyph coverage, so every glyph
  starts a pair and is flagged. Open Sans (this copy), Helvetica, Helvetica Neue, Times, Times New Roman, Verdana,
  Trebuchet MS and Cherry Cream Soda kern through a legacy `kern` table, for which HarfRust flags the whole buffer.
  Amiri flags every Arabic cluster.
- **Partly (25% to 58%): 6 fonts.** Source Serif 4, and the Arabic and Hebrew fonts Noto Sans Arabic, Geeza Pro,
  SF Arabic, Noto Nastaliq Urdu and SF Hebrew.

Under the final rule Fredoka and Source Serif 4 join the first class (1.5% and 2.4%), which is then 47 fonts; the
legacy-`kern` fonts and Amiri stay whole-run and the five Arabic and Hebrew fonts stay partial. A longer run lowers
every windowed share, because a window's size does not depend on the run's.

**Kern-table follow-up (same day, `experiments/sil-kern`).** The last column is the rule after legacy `kern` tables
were given per-pair marks (see the [kern-table section](../planning/wasm-size-reduction.md)); the beyond-pairs column
is from that build too. All 79,837 replayed edits splice equal to a cold shape, and the cold shapes of all 61 fonts
are byte-identical to the previous build's (ids, clusters, advances, offsets and both published flag bits). Classes
now: **windows 54** (Times New Roman, Verdana, Helvetica, Times, Trebuchet MS, Cherry Cream Soda and the surveyed
Open Sans joined, at 1.3% to 5.0% of the run), **partly 5** (Helvetica Neue at 27.9%, because a probe that holds no
glyph its `kern` subtables start a pair on cannot tell whether the run is flagged and reshapes it whole in 27% of
edits; Noto Sans Arabic, SF Arabic, Noto Nastaliq Urdu, SF Hebrew), **whole run 2** (Amiri; and Geeza Pro, which
moved from 28% to whole-run because its `kern` table is a state machine that HarfRust does not flag at all, and the
fork now marks it). Helvetica and Helvetica Neue from macOS cannot be baked (`morx`), so their rows describe the
shaper, not a shipped configuration.

The table is one run of about 820 units. The raw rows are `glyph-scratch/kern/survey/{p1rule,final,kern}.tsv`.
