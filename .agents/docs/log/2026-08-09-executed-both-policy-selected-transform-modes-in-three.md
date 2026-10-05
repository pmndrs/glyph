---
type: Log Entry
title: 'Executed both policy-selected transform modes in Three'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Generalized the command-buffer target across indexed
and direct transform realizations for Bitmap, MSDF, and Slug. The same compiled-Wasm fixture now registers a direct
first-party policy: Rust emits draw transforms `[1,2]`, omits transform buffers, and Three updates retained draw
matrices from their scene objects. The existing indexed policy still emits draw transforms `[0,0]`, buffer 15, and
the shared matrix sidecar. A hybrid policy additionally publishes indexed Bitmap and direct MSDF draws together;
scene-only synchronization updates both realizations without Wasm. The engine policy chooses each program contract;
Three does not rebatch the plan.
