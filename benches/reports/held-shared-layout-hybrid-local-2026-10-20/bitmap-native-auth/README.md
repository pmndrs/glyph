# Actual Bitmap replay authentication

The final full05 replay reproduces6157ordered successful events from unchanged shipping archive28fd0413…,
including initialization first/once and native batch reservation. Native engine/frame transport matches4099complete
query/publication results byte-for-byte (1977392B). Initial/forward/reverse preparation counts are2048/1024/1024,
with one single-entry batch each. All9227blob references and request1155504B are authenticated;237installed JS
members remain unchanged before/after. Raw inputs, manifests, logs and source preimages remain locally preserved
under .cache/held-hybrid-20261020/evidence/bitmap-native-replay-auth; they are not part of Git and must not be assumed
available on another machine.

The [initial independent review](independent-code-review.md) found omitted initialization and native batch-arena
reservation, despite matching outputs. The [correction review](correction-review.md) closes both findings for this
one-root fixture. [Root integrity](root-authentication-integrity.json) verifies corrected source/blob/event identities;
its review-pending wording records its earlier collection stage. Source-review prose copies use repository formatting
with raw source and formatted target identities in [copy provenance](copy-provenance.json).

This authenticates the reproduced native engine and frame transport paths for later field/physical-work counters.
Direct ordered entry replay excludes native UpdateBatchTransport.process, batch descriptor/allocator work, actual
Three private host buffers, GC and timing. It does not establish a speed gain, parity or other-family readiness.
The full package check exits0. Its initial rebuild exposed one data-byte source-location shift from the test module
being declared above production code; all code sections were identical. Moving that declaration to EOF and rebuilding
restored every947archived shipped file exactly, including Wasm01001ff6…. Five extra build files are unshipped, not
archived-member mismatches. [Final integrity](final-authentication-integrity.json), [member comparison](shipping-rebuild-member-compare.json),
[build](shipping-rebuild-result.json.raw) and [fresh replay](final-replay-result.json.raw) authenticate this correction.
The final event index is byte-identical to full04; only diagnostic-source metadata reflects declaration placement.
No work counters or product optimization are in this checkpoint.
The [owned log](../../../../.agents/docs/log/2026-10-20-bitmap-native-replay-authentication.md) and compact frontier
own current operation state. Stack held/unmerged; parity false, boost waves0.

Raw wrapper and section receipts use `.json.raw` filenames to preserve their exact authenticated JSON bytes while keeping them outside source formatting. Their original paths and SHA-256 values remain in final-copy-provenance.json.
