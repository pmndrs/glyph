---
type: Log Entry
title: 'Milestone 7.1 hardening'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Began the integration-hardening gate with an actual asynchronous lifecycle correction: raster decodes that finish after runtime disposal are now released exactly once and reject their waiters instead of publishing a dead resource. Deterministic tests cover stale raster generations, same-artifact font re-registration, stale shaping handles, and plan ownership. Consumer-bundler module inspection now proves the runtime baker remains dynamic and heavy optional graphs stay outside browser core; a real packed tarball resolves every ESM/resource export, preserves the module-Worker declaration, and rejects CommonJS. The browser-core change adds 204 minified bytes and 30 Brotli bytes on the canonical host.
