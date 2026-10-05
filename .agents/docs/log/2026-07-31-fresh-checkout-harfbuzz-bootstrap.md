---
type: Log Entry
title: 'Fresh-checkout HarfBuzz bootstrap'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added an exact root pipx pin before the existing pipx-backed Meson pin, so `mise install` no longer assumes an ambient pipx executable. The minimal Rust toolchain declares Cargo explicitly instead of relying on an implicit profile component that was absent from a fresh Linux mise cache. The macOS prerequisite now names both Homebrew `glib` and `pkgconf`, making the required `glib-2.0` metadata discoverable when the authenticated HarfBuzz fixture workflow configures its pinned utilities.
