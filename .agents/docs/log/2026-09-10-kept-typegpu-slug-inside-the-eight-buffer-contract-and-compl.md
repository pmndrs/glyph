---
type: Log Entry
title: 'Kept TypeGPU Slug inside the eight-buffer contract and completed the indexed A/B matrix'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Slug now stores the
engine-owned placement slot in its existing unused `bandCounts.z` lane in both adapters. Its seven raster records plus
stable-glyph identity remain exactly eight Codec buffers; the vertex path binds the seven raster records and reads the
shared f32x2 placement table from scene storage, with no placement texture, ninth Codec buffer, bind group, or draw.
The focused TypeGPU workflow passes all 38 declaration, packed-consumer, shader, and integration tests; the project
Chromium WebGPU gate renders Bitmap/MSDF/Slug with nonzero-alpha counts `9280/7875/7497`. Three pooled
101-sample passes after 40 warmups compare the indexed candidate with exact `2094243668bcf5462cff0ac3b1f7faf52cba3b6c`
main. Bitmap Latin improves `3.741 / 3.829` → `2.584 / 2.680 ms`, dense-CJK Bitmap
`2.986 / 3.153` → `2.268 / 2.292 ms`, justified Latin `3.675 / 3.726` → `3.447 / 3.491 ms`, MTSDF Latin
`4.079 / 4.131` → `2.683 / 2.708 ms`, and Slug Latin `4.031 / 4.098` → `2.639 / 2.743 ms`. Corresponding
writes fall by 82.1%, 37.9–40.9%, 82.0%, 91.1%, and 91.1%. Mixed bidi remains the honest exception:
`3.956 / 4.065` → `4.520 / 4.685 ms` while bytes fall 79.7% to 35,856. A measured deferred-span mutation was neutral
and was removed; the bidi CPU regression remains open for browser end-to-end attribution rather than being hidden in
an aggregate speedup.
