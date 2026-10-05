---
type: Log Entry
title: 'Clean-checkout CI prerequisites'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Fixed two producer-lifecycle defects exposed by consecutive GitHub Actions runs. ABI capture had resolved on child `exit`, which can precede stdout EOF; the failing run therefore parsed a successful producer's empty buffer. A shared capture boundary now resolves on `close`, and a causal subprocess regression observes zero bytes at exit versus the complete 65,559-byte JSON payload at stream close. The next clean run reached the benchmark fixture layer and exposed an unrelated ignored-cache assumption: the Japanese subset check invoked a missing local `hb-subset`. That check now provisions and authenticates exact HarfBuzz 13.0.0 before fresh regeneration, making the package's declared check sufficient on a new checkout.
