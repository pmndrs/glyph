---
type: Log Entry
title: Adopted the agent docs baseline for every workspace package
verified_sources:
  '@pmndrs/glyph-examples': sha256:483bc1f4543e2698f0369061fccde16ff43946b181fde57c6c32f663f9678e63
  '@pmndrs/glyph-tres-playground': sha256:f3e243e8ac35d10c200396ef2d2a7b46c948b38b61df50d857ac61173b61143b
  '@pmndrs/glyph-typegpu-hello-world': sha256:00859237dfe619f272585950a9f3a7de2299e4456db280021064c040b7ef7d20
  '@pmndrs/glyph-benchmarks': sha256:54ce073fae6665b4edab75a48435d521f835a4bb2ac761a828c7c126697f9633
  '@pmndrs/glyph': sha256:837207278a6454693b4cce57eb6e84db6a09761f19d99bd5126715eaba345cc7
  '@pmndrs/glyph-example-raster': sha256:bfb8cf9c273c73ce91aeb0fbc73cee4e2c58398ffa65a9b87742cec56d050ee0
  '@pmndrs/glyph-example-renderer': sha256:23edb88113cbf1db7b2db7672b42a21e24391f3b75649f4fd8fa9b2f5e21e962
reviews: []
generated:
  by: process:docs-verify
  at: '2026-10-05T18:15:57Z'
---

Attestations start here, so no earlier change carries one. On `main` at `28707d5` every package concept still
passed the retired `source_digest` check, which only proved a digest was re-pinned, not that anyone reviewed the
docs. This entry adopts each package's source at that point, plus this pull request's changes, as the verified
baseline, so the audit tracks only changes from here on. This pull request's only package change is the benchmark package-size gate removal: its
benchmarks concept was reviewed against the diff and corrected, and that claim is attested separately for the first
real verification pass after merge.
