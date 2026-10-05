---
type: Log Entry
title: 'HarfBuzz CLI prerequisite'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the assumption that pinned Meson and Ninja alone make upstream HarfBuzz utilities available. HarfBuzz 13 creates `hb-shape` and `hb-subset` only with GLib development metadata; the provisioner now requires that dependency during Meson configuration, while the Ubuntu 24.04 job installs `libglib2.0-dev` explicitly and reports its resolved version. Unrelated optional backends are disabled so the source-build graph does not vary with ambient host libraries; the authenticated HarfBuzz engine and exact subset-byte gate remain unchanged.
