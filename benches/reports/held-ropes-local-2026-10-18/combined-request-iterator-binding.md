# Request, iterator and binding wave — 18 October 2026

Source head `57243ee5b5742da52214fc977517d2a01d2ab845` (clean frozen checkout); candidate archive SHA-256 `ef8e4183b4bc61153c5e207abf797d5728fc7f42c3d4f9caeb9cb645c1707471` (3,169,746 bytes).

Historical 57243ee5 evidence only; not acceptance evidence for subsequent new-112 plus dirty integrated-hybrid source. Re-evaluate that source on its own frozen package and gates.

## Local full-suite captures

| Comparison        | Report counts                                   | Drift warnings                                                                                       | Window UTC                                                           |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| labs-main         | 73 faster · 25 slower · 40 neutral · 7 skipped  | ⚠ baseline CPU clock drifted 40.9% during its run; ⚠ candidate CPU clock drifted 9.8% during its run | 2026-10-18T14:47:57.358493+00:00 to 2026-10-18T15:34:08.208152+00:00 |
| labs-published010 | 78 faster · 33 slower · 20 neutral · 12 skipped | ⚠ baseline CPU clock drifted 10.0% during its run; ⚠ candidate CPU clock drifted 9.8% during its run | 2026-10-18T15:34:08.208691+00:00 to 2026-10-18T15:57:16.087501+00:00 |
| labs-prior-held   | 3 faster · 57 slower · 75 neutral · 10 skipped  | ⚠ baseline CPU clock drifted 5.7% during its run; ⚠ candidate CPU clock drifted 9.8% during its run  | 2026-10-18T15:57:16.087792+00:00 to 2026-10-18T16:18:03.686320+00:00 |

Each comparison has 145 paired workload rows in `combined-request-iterator-binding.json`, with absolute p50/p95 nanoseconds, retained N, actual batch mode and per-file CPU-frequency readings. The same JSON lists clock-confounded and timing-mode mismatch exclusions separately; full comparison footers are preserved with the raw reports. p50 uses the median of eight block medians; p95 uses the sorted retained sample at `floor(.95*(N-1))`. The candidate measurement JSON was byte-identical across comparisons. The prior-held run may overlap the separate integration-checkout install event; overlap cannot be localized, and no rows were dropped or recaptured.

## Gates and artifact facts

- Full package check exited 0: 572 Rust tests passed (1 ignored; 0 failed); 1084 Node tests passed (0 failed); formatting passed on 487 files.
- Pack, named artifact, memory artifact and live-memory capture commands exited 0. Named executable hash matches release Wasm SHA-256 `81e0508fc3931de2fbbea9d6e49034096a45d76a7142f337dbdc296f18b9467b`.
- Memory report covers the engine Wasm instance for 8 cycles. It excludes JS tokens, GPU and font-decoder instances; reported allocator high-water excludes Talc fragmentation and transient internal realloc peak.
- Exact-head CI run 39137219764 concluded `success`. Its performance report is smoke-only (2 faster · 0 slower · 4 neutral · 0 skipped); 16 conformance cases passed.
- Copy-only archive: `/Volumes/Depot/Developer/glyph/.cache/held-preserved-20261018-combined-final`. `files.manifest.json` records source path, byte count and SHA-256 for 138 verified files. Full timing raw reports and run receipts are under `timing/combined-final/`; Wasms, package and gate receipts are under `artifacts/`; CI and codegen/contracts reviews are under `reviews/`.

## Decision and remaining work

Retain the correct work removals on the held branch; no isolated elapsed improvement or no-regression clearance is established. The eight-block whole-branch comparisons still expose dense and long-reflow gaps. Dense512 main/published/candidate p50/p95 are 8.561313/11.311709, 8.789959/10.305959 and 12.389646/27.171667 ms. Dense1024 is 20.246479/31.761458, 17.568771/19.394583 and 20.555042/22.682875 ms. Width inspection/publication is 7.223667/10.323833, 10.735917/11.684958 and 5.261000/6.237917 ms. These are absolute observations, with the reported per-row and whole-run clock limits retained; no spikes were trimmed or trials repeated.

The following separately gated wave integrates main's anchor/typography API and builds fully changed ordered roots directly into the same 32-record-leaf storage. It is not measured or accepted by this report. All seven fixed families, final current-main/API/ABI/peer/lifetime, browser/hero and whole-application physical peak requirements remain open. Keep #292 → #301 → #302 → draft #310 held and unmerged; no release, tag or demo merge.

The preservation task changed no source, Git history or CI state. Its full copied-file manifest remains local; the JSON here preserves the portable measurements and provenance.
