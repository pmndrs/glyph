---
type: Decision
title: 'Remove the HarfBuzz command-line tools'
description: 'No check, test, workflow or CI job provisions, builds or runs a HarfBuzz binary; HarfBuzz output already in the repository stays as frozen, authenticated data.'
decision_status: Accepted
decided: '2026-11-24'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-25T02:01:23Z'
---

# Remove the HarfBuzz command-line tools

## Decision

The repository carries no HarfBuzz command-line tool and no workflow that needs one. HarfBuzz output already committed
is frozen data, checked without a binary:

- `benches/fixtures/shaping/*/harfbuzz.json` (HarfBuzz 13.0.0) stays. `src/benchmark/fixtures.test.ts` compares it
  with the HarfRust references, and the paragraph contracts keep it as their `independentOracle`. It cannot be
  regenerated in-repo.
- The Japanese showcase subset (`hb-subset` 13.0.0) stays byte-for-byte. `fixture:japanese-showcase:check`
  authenticates it against its manifest, source font and corpus instead of rebuilding it.
- Rust tests that cite `hb-subset` 14.4.0 glyph counts keep them as constants.
- The font-baker ABI report's `harfbuzzReference`/`harfbuzzReferenceVersion` fields are unchanged; whether to keep
  them is a separate decision.

Renderers are checked against each other (Three, TypeGPU, PixiJS 3D), not against a HarfBuzz tool.

## Why

The repository owner, 2026-11-24: depending on HarfBuzz is no longer worth it, the CI download takes too long, and the
comparisons should be between our renderers. Every CI job that checks out Git LFS fetched the 18,483,560 bytes of
HarfBuzz bundles (13.0.0 and 14.2.0, Linux x64 and macOS arm64), and the `check` job provisioned two versions. Only the
Japanese subset check and the HarfBuzz oracle workflows ran a binary. The `glyph glyphs` command already inspects fonts
in the font baker.

The baker's own Skera preparation cannot replace `hb-subset` for the showcase subset. Skera has no CFF subsetter, so
preparing the 74 showcase code points from Noto Sans CJK JP yields 15,986,844 bytes, against the committed 38,092.

## Consequences

This removes the `fixture:harfbuzz:provision|check|vendor` and `fixture:harfbuzz-oracle:generate|check` workflows,
`fixture:japanese-showcase:generate`, the vendoring recipe and bundle tests, and the CI provisioning step.
`benchmark:bake-check` no longer stops on a machine without the bundles.

Lost: a new shaping case cannot get a HarfBuzz reference in-repo, and the showcase corpus cannot change without a
subset made outside the repository. Open: whether to delete the frozen `harfbuzz.json` files too, and whether the ABI
report keeps its HarfBuzz reference fields.
