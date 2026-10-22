# Reverse-order matched CPU repeat

One predetermined diagnostic repeat ran E6 → V3 → E4 → main using the exact previously frozen archive and authenticated named Wasm for each arm. The case, fixture, current harness, peer installation rules, and options stayed at 1,024 first-position bulk writes, scene publication, 10 warmups, 80 timed iterations and zero timed reads. All four captures and repository CPU summaries completed with exit 0. The original eight profiles remain intact. `repeat-index.json` binds every new raw profile, archive, named Wasm, capture window, summary, ancestry proof, and process snapshot; source/fixture hashes and the frozen source status stayed unchanged.

| Arm | Original callback p50 / p95 ms | Repeat callback p50 / p95 ms | Original setter / publication sampled self ms | Repeat setter / publication sampled self ms | Repeat V8 gaps >5 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| E6 | 14.74 / 16.79 | 15.84 / 25.12 | 764.5 / 380.0 | 971.9 / 473.6 | 5 |
| V3 | 20.13 / 148.51 | 15.89 / 45.38 | 2023.2 / 1024.1 | 1027.3 / 434.7 | 8 |
| E4 | 16.82 / 23.24 | 15.45 / 150.92 | 953.6 / 457.4 | 1611.5 / 1059.8 | 43 |
| main | 14.80 / 17.17 | 12.75 / 15.09 | 110.9 / 1019.4 | 89.3 / 906.3 | 1 |

Callback p50/p95 values are wall durations measured during these profiled runs. Phase self values are totals of exclusive sampled CPU across one profile. Fresh sibling phase anchors under `updateBulk` partition each repeat profile with detached samples separately; inclusive frame costs overlap and must not be summed. The original V3 had 39 V8 sampling gaps >5 ms. In the reverse repeat, E4 had 43 and a 150.92 ms callback p95 while V3 had 8 and a 45.38 ms p95. The large p95 and sampled CPU changes across runs show that one-shot performance ranking is unstable here. The call-tree phase location remains a useful observation: main primarily executes Wasm work under publication, whereas E4/V3/E6 primarily execute it under setter/preparation.

An initial process precheck found no external process at or above 50% CPU. The later immediately-before-arm snapshots revealed changing external load: a Playwright Chromium renderer at 140.8% before E6, `duetexpertd` at 89.9% before V3, `siriactionsd` at 83.7% and `fseventsd` at 52.2% before E4, and `BackgroundShortcutRunner` at 55.4% before main. Process snapshots at arm boundaries do not prove activity throughout each capture. The orchestration did **not** pause after those later snapshots; this is a procedural limitation of the repeat. No external process was stopped, and no arm was selectively retried. The results locate sampled functions but do not establish the cause of timing changes or satisfy the unprofiled acceptance matrix.
