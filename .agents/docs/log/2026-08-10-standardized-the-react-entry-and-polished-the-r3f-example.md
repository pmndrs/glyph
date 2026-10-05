---
type: Log Entry
title: 'Standardized the React entry and polished the R3F example'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Renamed the sole declarative package entry from the
stale `@pmndrs/glyph/r3f` path to the originally specified `@pmndrs/glyph/react` path; React Three Fiber remains the
internal host reconciler and an optional peer rather than part of the public name. The hello-world example preloads
each multi-raster asset through the public hook cache, renders its controls with Slug, and uses a local `Button`
component with a TSL capsule-distance node over plane geometry. Technique colors connect each tracked uppercase label
to a nested globe span that binds its subsetted Font Awesome raster directly instead of requiring a font stack. Each
label is vertically centered by a shaped 44-unit line box whose extra leading is divided around the font metrics,
rather than by an arbitrary visual offset. A clean WebGPU browser run switches Bitmap, MSDF, and Slug without shader
errors or warnings.
