---
type: Log Entry
title: 'Implemented explicit font/runtime/host/session ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Root font assets now outlive renderer runtimes; each
runtime creates and owns its hosts, each host installs policies and binds immutable fonts, and each session owns one
target, retained text batch, and acceptance frontier. The default target consumes borrowed A/B memory synchronously;
the async target performs one bounded exact-size copy and requires the same transfer buffer back.
