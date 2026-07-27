# Noto Sans CJK JP authored showcase subset

- Canonical source: `../noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf`
- Subsetter: repository-provisioned HarfBuzz `hb-subset` 13.0.0
- License: SIL Open Font License 1.1

This deterministic subset contains the authored Japanese text exercised by the
Advanced Shaping showcase. It gives the visual benchmark a conventional sans
face without pretending to solve complete CJK raster distribution. The full
Noto Sans CJK JP fixture remains the authoritative shaping and paragraph
oracle; complete raster coverage uses the roadmap's chunked paging design.

Run `pnpm --filter @pmndrs/text-benchmarks generate:japanese-showcase-subset`
after changing the CJK showcase corpus, then regenerate the checked bitmap and
MTSDF rendering fixtures.
