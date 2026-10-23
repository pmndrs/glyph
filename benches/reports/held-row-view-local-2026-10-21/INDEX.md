# E6 packet index

Start with [the current decision and limits](README.md), then [the independent admission review](reviews/e6-full-fixed-matrix-admission-sol-high.md). [Provenance](provenance.json) lists every exact copy by relative path, original path, byte count and SHA-256, plus excluded raw artifacts. README, INDEX and provenance are authored packet files; all other 127 files are byte-exact copies.

| Directory | Evidence |
| --- | --- |
| [`source/`](source/) | E6 whole-product and row-view patches, E5 predecessor patch, exact-source preservation and active E4 restore receipts. |
| [`shipping/`](shipping/) | Archive/package/member, executable/ABI/SIMD, peers, Node/Rust, memory and renderer-recovery receipts and logs. |
| [`native/`](native/) | Actual Bitmap replay identity, work ledger, exact-result and native gate logs. |
| [`matrix/`](matrix/) | Three fixed full-suite raw JSON inputs, manifests, summaries, receipts and complete logs; reused candidate identity. |
| [`statistics/`](statistics/) | Stock collector, installed source copies and their exact ISC license, all 433 paired facts, E2's 145-row facts and provenance. |
| [`verification/`](verification/) | Independent full-matrix and E2 all-row recalculation receipts. |
| [`reviews/`](reviews/) | Final seven-family admission, architecture/ingress, API/lifetime, browser/memory and next-boundary reviews. |
| [`history/`](history/) | Frozen shipping-only index and earlier copy manifests; historical `be6`/pending-timing text is superseded. |

The `.raw` suffix preserves original JSON/MJS bytes under this repository's formatter. To audit with tools that require `.json` or `.mjs`, copy to a scratch location and restore the original suffix. The collector's absolute artifact root is capture-host context; map its input files through `provenance.json`. The raw archive, Wasm binaries and native trace are excluded with hash inventory. No E6 CPU profile exists.
