---
type: Log Entry
title: 'Measured the retained-placement checkpoint against freshly fetched main'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Same-machine A/B/B/A runs compare
candidate `8221aa87` with `origin/main` `ee56fa48`; main's shaper is byte-identical to `20942436` because the intervening
change is README-only. Each pass used 20 warmups and 101 measured 22k-glyph ordered-Bitmap width updates. Pooled
ordinary Latin improves 32.3% median and 32.7% p95, dense CJK 24.5%/24.6%, and justified Latin 2.6%/11.1%, while
publication falls from 170–172 KiB to 30–107 KiB. Mixed bidi is not hidden in the aggregate: it remains 11.5% median
and 10.9% p95 slower despite publishing only 35.0 KiB, so the final performance gate stays open.
