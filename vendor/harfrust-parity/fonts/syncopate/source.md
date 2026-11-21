# Syncopate Regular 001.001

- Source: <https://raw.githubusercontent.com/google/fonts/main/apache/syncopate/Syncopate-Regular.ttf>,
  fetched 2026-11-20
- License: Apache License 2.0 (`LICENSE.txt`)
- License SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

| File                                   | SHA-256                                                            | Tables that kern                        |
| -------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `Syncopate-Regular.ttf`                | `fcbb10798b80c981afabaa1055bde2ee29b283069b44cdfc68457e903a056ac1` | `kern` (format 0, 3,290 pairs) and GPOS |
| `Syncopate-Regular-kernonly-SYNTH.ttf` | `5fe5310dc782b6e9e8b3ec532f223a634dedd6705bdd7471f15167ba30686936` | `kern` only                             |

`Syncopate-Regular.ttf` is the unmodified upstream file. `Syncopate-Regular-kernonly-SYNTH.ttf` is
a modified copy, not an upstream artifact: the same font with its GPOS table deleted using
fontTools 4.68.0 (`del font["GPOS"]`, then `font.save`). Nothing else was changed.
