---
type: Log Entry
title: 'Streamed the default shaper into the Wasm compiler'
generated:
  by: process:docs-new
  at: '2026-10-06T03:56:00Z'
---

In browsers the default text shaper now compiles with `WebAssembly.compileStreaming` when its response is served
exactly as `application/wasm`, so compilation overlaps the download and HTTP gzip or brotli is decoded by the network
stack. Other content types, which streaming compile rejects, fall back to buffering the bytes and compiling them as
before. Node keeps reading the packaged file directly. This keeps the transfer saving of HTTP compression without the
JavaScript decompression cost measured for a bundled gzip asset (3.71 ms to 11.00 ms shaper startup on #237). See
[the package reference](../packages/glyph.md).
