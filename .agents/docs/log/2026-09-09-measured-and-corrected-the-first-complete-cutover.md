---
type: Log Entry
title: 'Measured and corrected the first complete cutover'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The maintained benchmark now declares the distinct
placement-slot output for Bitmap, MTSDF, and Slug and records retained buffer live/capacity bytes; earlier measurements
without that occurrence lane remain attribution history rather than complete cutover costs. Compatible post-shaping
CJK script runs now share one geometry `LayoutRun` when direction, bidi level, selected font, and shaping/layout style agree.
On the exact placement-slot-inclusive target, 22k ordered Bitmap CJK active-resize improved from
`4.178 / 4.305 ms` to `3.590 / 3.940 ms`, and median writes fell from 143.1 KiB to 101.4 KiB as the shared x/y table
shrank from 58,592 to 15,968 bytes; the 87,912-byte occurrence rewrite remained the dominant cost while one-primitive
topology stayed unchanged. The matching Latin target measured `4.075 / 4.386 ms` with 39.8 KiB median writes and only
the shared x/y table patched.
Relative to PR #172's older absolute-placement timings, the target median is 1.5% faster for Latin and 0.5% slower for
CJK, but those are directional cross-contract comparisons rather than release gates. CPU publication consumes the same
local-plus-placement f32 operation as renderers. Bitmap/MTSDF/Slug program registration is green; roadmap 12.2 remains
active until the consolidated package/release and browser gates close.
