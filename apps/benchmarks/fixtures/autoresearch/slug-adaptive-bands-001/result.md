# Adaptive Slug band experiment

Status: rejected before GPU measurement.

The precommitted `{16, 32, 64}` policy selected the smallest count whose two-axis mean occupancy reached at most six references per band. Artifact evidence contradicts the hypothesis that it would avoid fixed-32's universal storage cost, so the protocol stops before noisy GPU timing.

## Evidence

| Source                 | 16-band glyphs | 32-band glyphs | 64-band glyphs | Missing | GPU residency vs fixed 16 |
| ---------------------- | -------------: | -------------: | -------------: | ------: | ------------------------: |
| Inter                  |          2,369 |            360 |            186 |      22 |                     +8.6% |
| Amiri                  |          4,077 |          1,932 |            681 |      20 |                    +11.6% |
| Noto Sans Devanagari   |            518 |            232 |            198 |       6 |                    +18.4% |
| DotGothic16            |          2,550 |            776 |          6,022 |      14 |                    +21.1% |
| Noto Sans CJK showcase |             50 |             28 |             77 |       0 |                    +24.4% |
| Source Serif 4         |          1,030 |            337 |             86 |      11 |                    +10.2% |
| Dancing Script         |            388 |            394 |            231 |       4 |                    +25.0% |

Across the seven complete artifacts, gzip grows 9.7–30.2% and Slug GPU residency grows 8.6–25.0%. Devanagari, DotGothic16, the Japanese showcase, and Dancing Script are larger than their universal fixed-32 artifacts because too many glyphs escalate to 64 bands.

Exact artifact identities, page sizes, and glyph-count distributions are retained in `artifacts-v0.json`.

## Not verified

- No GPU performance capture was run after the storage hypothesis failed.
- Pixel identity was not recaptured for this rejected policy.
- Bake time and peak memory were not retained.

## Next

Test a separately precommitted adaptive policy capped at `{16, 32}` so dense glyphs can retain the measured fixed-32 curve-work signal without 64-band escalation.
