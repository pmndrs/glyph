---
type: Log Entry
title: 'HarfBuzz build-tool authority'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The clean-checkout Japanese subset gate exposed that authenticated HarfBuzz source provisioning still depended on an ambient `meson` executable absent from GitHub's Ubuntu runner. The root mise toolchain now installs exact Meson 1.11.1 and Ninja 1.13.2 pins, preserving HarfBuzz's supported source build and the fresh byte-for-byte subset check without an operating-system package step or a platform-specific binary.
