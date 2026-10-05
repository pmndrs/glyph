---
type: Log Entry
title: 'GPU publication is serialized through its acceptance fence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The example renderer rejects resource or buffer
mutation while an asynchronous submission is in flight, derives idle-frame classification once in the recording
oracle, scopes readback validation errors, and always closes an abandoned render pass. Its named workflow now requests
WebGPU explicitly and proves two visible submissions, zero idle submissions, one clear-only disposal submission, and
zero pixels after that clear. Validation acceptance commits without a per-frame queue-completion stall; readback supplies
the completion fence only where evidence needs it. Package-local shader transforms replace a private cross-package import.
