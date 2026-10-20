# Wave2 main comparison: dense parity remains open

Completed full8block main/candidate arm; published and prior340 still pending. No fresh-prior effect claim.

| workload                                             |     main p50 / p95 ms | candidate p50 / p95 ms | p50 delta |
| ---------------------------------------------------- | --------------------: | ---------------------: | --------: |
| rewrite 512 labels in one group                      |   7.910395 / 8.935917 |  10.143000 / 11.442625 |   +28.22% |
| publish 1024 retained Text instances                 | 16.843542 / 18.395083 |  19.762229 / 22.340916 |   +17.33% |
| edit and sparsely borrow one of 1000 retained labels |   0.268500 / 0.495000 |    0.211875 / 0.416208 |   -21.09% |
| per-glyph inspection after width change              |  7.509792 / 10.065750 |    4.755979 / 6.188292 |   -36.67% |
| inspection then publication after width change       |   5.361896 / 9.781125 |    5.038771 / 6.357041 |    -6.03% |

All145 rows:89 faster,26 slower,24 neutral,2 clock exclusions and4 mode exclusions. No unclassified identities. Main/candidate software calibration drift10.139267/1.213498%; notGHz. N and per-block values are in main-result-summary.json and absolute-distributions-partial.json. Allraw samples retained; no favorable retry.

This result justifies planning a single fresh current-source1024 scene bulk-write diagnostic after all matrix arms finish if the complete evidence still leaves the dense gap. Existing698 profile cannot quantify current removable terms. Reuse authenticated current named/shipping executable and the named repository workflow with10warmups80iterations/no timedreads. No profile or implementation is started during the matrix.
