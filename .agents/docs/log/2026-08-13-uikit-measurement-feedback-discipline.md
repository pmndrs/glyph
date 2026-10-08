---
type: Log Entry
title: 'uikit measurement feedback discipline'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Community integration feedback (high-frequency line break/unbreak
flapping with CPU churn in a reactive layout) root-caused to unrounded measure feedback: sweeping 811 fractional
widths through a measure→exact-constrain loop flips line counts at 39 knife-edge widths, and rounding the
fed-back width up to the point scale flips zero. The rule lived only in the uikit conformance fixture's
`roundUpToPointScale`; the integration document now states it as a hard requirement with the stable Yoga
callback pattern, and notes the two adjacent factors at the reported build: the pre-#66 metric-topology session
storms and the not-yet-landed 11.17 synchronous-measure cost reduction. The reported distance aliasing verified
as expected current behavior — atlas textures upload without mipmaps under a linear min filter, and
pixelSnapping was confirmed off by default at the reported commit — recorded as quality work, not a regression.
