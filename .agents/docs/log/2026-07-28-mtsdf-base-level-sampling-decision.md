---
type: Log Entry
title: 'MTSDF base-level sampling decision'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed runtime mip generation and trilinear cross-level sampling after review found no affirmative mipmap guidance in the primary MSDF paper or official generators and the encoded channels do not support ordinary distance-preserving averaging. MTSDF now keeps bilinear sampling plus screen-derivative reconstruction over authenticated base levels. Runtime, validator, fixture, and inspector accounting agree on padded base-array residency; canonical Inter falls from 55,924,040 to 41,943,040 GPU bytes, and the mip-level inspector row is gone. This supersedes the earlier scheduled minification campaign.
