---
type: Log Entry
title: 'Streamed default Wasm assets into the compiler'
generated:
  by: process:docs-new
  at: '2026-10-06T03:56:00Z'
---

In browsers every default Wasm asset now compiles with `WebAssembly.compileStreaming`: the text shaper, the
runtime-bake worker's font baker, and the Bitmap, MSDF and Slug bakers. Compilation overlaps the download, and HTTP gzip
or brotli is decoded by the network stack. The engine, not Glyph, decides what it streams. The WebAssembly Web API
checks the content type, origin and status before reading the body, so a declined response still has an unread body and
is buffered and compiled as before; a rejection after the body was read is a compile or network error and propagates.
Glyph does not pre-check the content type because engines differ: the spec matches `application/wasm`
case-insensitively and Chromium 141 streams `Application/Wasm`, while Node 22 rejects it. Both reject parameters such as
`application/wasm; charset=binary`. Node keeps reading the packaged files directly. This keeps the transfer saving of
HTTP compression without the JavaScript decompression cost measured for a bundled gzip asset (3.71 ms to 11.00 ms
shaper startup on #237). See [the package reference](../packages/glyph.md).
