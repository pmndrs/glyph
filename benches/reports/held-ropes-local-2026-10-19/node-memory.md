# Node application-memory evidence summary

Generated 2026-10-19T16:15:07.243Z from four completed raw Node arms. The raw reports, checkpoints, NDJSON, logs, and archives were read only.

The workload recorded 1,024 labels from `fixture.createTextBatch(1024)`, eight `scene.updateMatrixWorld(true)` update-and-publish cycles, and 1,024 cold oracle checks. Each arm has 12 checkpoints: initial publication, eight update checkpoints, cold-oracle completion, and two teardown checkpoints.

## Per-arm checkpoint evidence

| Arm          | Archive SHA-256                                                  | Status / cleanup                      | Checkpoints | Complete / incomplete sweeps | Max complete OS sweep sum |
| ------------ | ---------------------------------------------------------------- | ------------------------------------- | ----------: | ---------------------------: | ------------------------: |
| main         | bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20 | completed; cleanupProven=true; exit=0 |          12 |                       49 / 0 |    613821040 (585.39 MiB) |
| candidate    | 2e4342243c55edb56d3a1a32cbd730185c8d172fa5634da9c1f8fc3b0edd9558 | completed; cleanupProven=true; exit=0 |          12 |                       48 / 0 |    642879640 (613.10 MiB) |
| published010 | 6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b | completed; cleanupProven=true; exit=0 |          12 |                       44 / 0 |    635941648 (606.48 MiB) |
| prior328     | e453db3ed8e32bbdf8f8a46f2a7a1bfab6dba02c484933062b30ea842cd57dcd | completed; cleanupProven=true; exit=0 |          12 |                       47 / 0 |    548186784 (522.79 MiB) |

### Eight AFTER-UPDATE checkpoints

These maxima use only the eight update-and-publish checkpoints. They are independent diagnostics; no JavaScript, Wasm, or OS values are added together.

| Arm          |                               RSS |                    JS heap used |                          External |                   Array buffers |      Wasm capacity max |
| ------------ | --------------------------------: | ------------------------------: | --------------------------------: | ------------------------------: | ---------------------: |
| main         | 396902400 (378.52 MiB) (update 8) | 26386056 (25.16 MiB) (update 8) | 218007573 (207.91 MiB) (update 1) | 57526096 (54.86 MiB) (update 1) | 158662656 (151.31 MiB) |
| candidate    | 325877760 (310.78 MiB) (update 8) | 30804000 (29.38 MiB) (update 8) |  103954225 (99.14 MiB) (update 3) | 57371208 (54.71 MiB) (update 1) |   44630016 (42.56 MiB) |
| published010 | 393084928 (374.88 MiB) (update 8) | 31039032 (29.60 MiB) (update 8) | 217439361 (207.37 MiB) (update 2) | 57378568 (54.72 MiB) (update 1) | 158072832 (150.75 MiB) |
| prior328     | 325107712 (310.05 MiB) (update 8) | 31006304 (29.57 MiB) (update 8) |  103888689 (99.08 MiB) (update 2) | 57371208 (54.71 MiB) (update 1) |   44498944 (42.44 MiB) |

## All 12 phase checkpoints

Exact values are bytes, followed by converted MiB in parentheses. Wasm is the reported instance capacity; the raw JSON retains per-instance entries.

| Arm          | Phase                      |                    RSS |              Heap used |               External |        Array buffers |       Wasm capacity(s) |
| ------------ | -------------------------- | ---------------------: | ---------------------: | ---------------------: | -------------------: | ---------------------: |
| main         | after-create-and-publish   | 387203072 (369.27 MiB) |   26023200 (24.82 MiB) | 216401621 (206.38 MiB) | 57361976 (54.70 MiB) | 157089792 (149.81 MiB) |
| main         | after-update-and-publish   | 396787712 (378.41 MiB) |   26385792 (25.16 MiB) | 218007573 (207.91 MiB) | 57526096 (54.86 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396640256 (378.27 MiB) |   26220256 (25.01 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396754944 (378.38 MiB) |   26238504 (25.02 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396787712 (378.41 MiB) |   26272312 (25.06 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396787712 (378.41 MiB) |   26259104 (25.04 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396853248 (378.47 MiB) |   26265384 (25.05 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396869632 (378.48 MiB) |   26239008 (25.02 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | after-update-and-publish   | 396902400 (378.52 MiB) |   26386056 (25.16 MiB) | 217991741 (207.89 MiB) | 57378568 (54.72 MiB) | 158662656 (151.31 MiB) |
| main         | cold-oracle-complete       | 633749504 (604.39 MiB) | 123844904 (118.11 MiB) | 218368944 (208.25 MiB) | 57610978 (54.94 MiB) | 158662656 (151.31 MiB) |
| main         | after-dispose              | 632848384 (603.53 MiB) |   23029368 (21.96 MiB) | 218021948 (207.92 MiB) | 56307008 (53.70 MiB) | 158662656 (151.31 MiB) |
| main         | after-fixture-font-dispose | 632881152 (603.56 MiB) |   22120248 (21.10 MiB) | 216809588 (206.77 MiB) | 30782023 (29.36 MiB) | 158662656 (151.31 MiB) |
| candidate    | after-create-and-publish   | 314032128 (299.48 MiB) |   30161864 (28.76 MiB) |   97645513 (93.12 MiB) | 57354616 (54.70 MiB) |   38338560 (36.56 MiB) |
| candidate    | after-update-and-publish   | 320897024 (306.03 MiB) |   30328632 (28.92 MiB) |  103446185 (98.65 MiB) | 57371208 (54.71 MiB) |   44105728 (42.06 MiB) |
| candidate    | after-update-and-publish   | 325369856 (310.30 MiB) |   30553632 (29.14 MiB) |  103953601 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325566464 (310.48 MiB) |   30611640 (29.19 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325779456 (310.69 MiB) |   30658472 (29.24 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325812224 (310.72 MiB) |   30693112 (29.27 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325812224 (310.72 MiB) |   30657176 (29.24 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325812224 (310.72 MiB) |   30618928 (29.20 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | after-update-and-publish   | 325877760 (310.78 MiB) |   30804000 (29.38 MiB) |  103954225 (99.14 MiB) | 57371208 (54.71 MiB) |   44630016 (42.56 MiB) |
| candidate    | cold-oracle-complete       | 656637952 (626.22 MiB) | 121157864 (115.55 MiB) | 106208600 (101.29 MiB) | 58553928 (55.84 MiB) |   45350912 (43.25 MiB) |
| candidate    | after-dispose              | 655884288 (625.50 MiB) |   23790120 (22.69 MiB) |  104702844 (99.85 MiB) | 56353024 (53.74 MiB) |   45350912 (43.25 MiB) |
| candidate    | after-fixture-font-dispose | 655376384 (625.02 MiB) |   22776352 (21.72 MiB) |  103490484 (98.70 MiB) | 30774663 (29.35 MiB) |   45350912 (43.25 MiB) |
| published010 | after-create-and-publish   | 381239296 (363.58 MiB) |   30542816 (29.13 MiB) | 215814281 (205.82 MiB) | 57361976 (54.70 MiB) | 156499968 (149.25 MiB) |
| published010 | after-update-and-publish   | 392822784 (374.63 MiB) |   30589608 (29.17 MiB) | 217420233 (207.35 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392642560 (374.45 MiB) |   30749688 (29.33 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392740864 (374.55 MiB) |   30803192 (29.38 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392855552 (374.66 MiB) |   30843440 (29.41 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392888320 (374.69 MiB) |   30855712 (29.43 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392970240 (374.77 MiB) |   30815632 (29.39 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 392986624 (374.78 MiB) |   30876184 (29.45 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | after-update-and-publish   | 393084928 (374.88 MiB) |   31039032 (29.60 MiB) | 217439361 (207.37 MiB) | 57378568 (54.72 MiB) | 158072832 (150.75 MiB) |
| published010 | cold-oracle-complete       | 653967360 (623.67 MiB) |   50797320 (48.44 MiB) | 217618584 (207.54 MiB) | 57557128 (54.89 MiB) | 158072832 (150.75 MiB) |
| published010 | after-dispose              | 652853248 (622.61 MiB) |   28045096 (26.75 MiB) | 217303664 (207.24 MiB) | 56297280 (53.69 MiB) | 158072832 (150.75 MiB) |
| published010 | after-fixture-font-dispose | 652886016 (622.64 MiB) |   27149168 (25.89 MiB) | 216287784 (206.27 MiB) | 30782023 (29.36 MiB) | 158072832 (150.75 MiB) |
| prior328     | after-create-and-publish   | 313589760 (299.06 MiB) |   30171152 (28.77 MiB) |   97645513 (93.12 MiB) | 57354616 (54.70 MiB) |   38338560 (36.56 MiB) |
| prior328     | after-update-and-publish   | 323764224 (308.77 MiB) |   30325376 (28.92 MiB) |  103839401 (99.03 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 324272128 (309.25 MiB) |   30525536 (29.11 MiB) |  103888689 (99.08 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 324599808 (309.56 MiB) |   30602112 (29.18 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 324747264 (309.70 MiB) |   30649256 (29.23 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 324943872 (309.89 MiB) |   30674848 (29.25 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 325042176 (309.98 MiB) |   30589456 (29.17 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 325091328 (310.03 MiB) |   30608992 (29.19 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | after-update-and-publish   | 325107712 (310.05 MiB) |   31006304 (29.57 MiB) |  103823153 (99.01 MiB) | 57371208 (54.71 MiB) |   44498944 (42.44 MiB) |
| prior328     | cold-oracle-complete       | 568573952 (542.23 MiB) | 121051608 (115.44 MiB) | 105029728 (100.16 MiB) | 57533256 (54.87 MiB) |   45350912 (43.25 MiB) |
| prior328     | after-dispose              | 567689216 (541.39 MiB) |   23695424 (22.60 MiB) |  104702844 (99.85 MiB) | 56311680 (53.70 MiB) |   45350912 (43.25 MiB) |
| prior328     | after-fixture-font-dispose | 567410688 (541.13 MiB) |   22680096 (21.63 MiB) |  103490484 (98.70 MiB) | 30774663 (29.35 MiB) |   45350912 (43.25 MiB) |

## Provenance and scope

The four arms have identical recorded harness input hash maps: **yes**. Installed package dist hashes are retained per arm and naturally differ where the archive differs. Each arm records whether its harness inputs remained unchanged after observation; direct bulk-memory harness source hash is also recorded in JSON.

The whole-command OS maximum comes from complete 25 ms non-atomic process-family sweeps. It includes bootstrap, all eight cycles, the 1,024 cold controls, and teardown; it is not an edit-only peak. The estimate is neither an exact simultaneous peak nor a strict lower bound. Incomplete sweeps remain counted and retained in raw NDJSON, and are excluded from the reported maximum.

JavaScript heap/external/array-buffer metrics, Wasm capacity, and OS physical footprint are separate measures. They are not summed, and these observations do not support a performance or causal claim.

The raw artifact SHA-256 values, full checkpoint data, sweep counts and intervals, cleanup status, source hash comparisons, and any log errors are preserved in `node-memory-summary.json`. The browser memory report was not read or polled; rerun with --browser-report <completed-report.json> to add it. The separate Node gzip inventory is `size-node-inventory.json`; gzip values are nested under `.distSizes` and are outside this memory summary.

### Shared observer limitations

- The maximum complete 25 ms sweep sum is an estimate: processes were sampled non-atomically and short peaks or children may be missed.
- The sum is neither an exact simultaneous peak nor a strict lower bound; incomplete sweeps are retained in NDJSON and excluded from the reported maximum.
- The Node OS maximum covers the entire observed command lifetime, including fixture bootstrap, all 1,024 cold controls, and teardown. It is not a bulk-edit-only peak.
- Only the launched command family is followed. Detached descendants discovered before reparenting remain tracked by PID and OS start time; undiscovered children and unrelated system processes are excluded.
- PID identity check and signal delivery are separate syscalls; cleanup is bounded and best effort, not an atomic handle-based kill guarantee.
- Darwin physical footprint includes process charges and may double-count shared memory across processes; JS heap and Wasm capacity are separate diagnostics.
- The observer scans the process table and can perturb runtime; these observations are not latency evidence.
