---
type: Log Entry
title: 'Closed the target-control follow-up'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Opus verified all original ownership findings, then exposed three omissions in
the new target contract. Targets are now explicitly disposable so session teardown detaches device-pool controls;
replacement-device checkpoint barriers are per session so an idle canvas cannot deadlock an active sibling; and the
worker target resolves referenced resources into an authenticated digest/descriptor manifest because a realm-local
resolver closure cannot cross `postMessage`. A final Opus verification reported no remaining blocker. The host's generic
session factory maps target delivery to the correct session return type and rejects a reused target object before Wasm
allocation. These are contract corrections, not a second integration mode.
