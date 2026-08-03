---
type: Explanation
title: Benchmark ipsum corpus
description: Explains the stable diagnostic and paragraph-scale text used by bitmap conformance and live benchmark workloads.
status: stable
tags: [benchmarks, corpus, shaping, typography]
sources:
  - id: corpus
    resource: ../../apps/benchmarks/src/workloads/benchmark-ipsum.ts
    title: Executable benchmark ipsum corpus
  - id: benchmark-plan
    resource: benchmark-plan.md
    title: Benchmark plan
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-27T13:18:38Z'
---

# Benchmark ipsum corpus

Status: active Milestone 6.4 fixture contract

Benchmark ipsum is stable product copy designed to expose font-system behavior without masquerading as a linguistic conformance corpus. It has two deliberately different forms that reuse the same diagnostic vocabulary.

| Form                | Surface     | Purpose                                                                                                                                                                                                               |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostic specimen | Conformance | Five short independent lines localize Latin rhythm, numerals, kerning pairs, punctuation, ligature candidates, and common mathematical-symbol failures. Exact pixel and structured comparisons use this bounded text. |
| Paragraph workload  | Benchmark   | More than 1,000 characters of readable prose exercise sustained shaping, layout, batching, and rendering while remaining visually inspectable. It repeats diagnostic sequences in realistic sentences and paragraphs. |

The corpus includes `AVATAR`, `To`, `Wa`, and `Yo` kerning pairs; `ff`, `fi`, `fl`, `ffi`, and `ffl` ligature candidates; tabular-looking numerals and decimal/range punctuation; quotation and bracket forms; superscripts, Greek, relations, arithmetic operators, roots, sums, and arrows. A candidate sequence is not labeled a substituted ligature unless the pinned font and shaping evidence actually produce that substitution.

The paragraph workload is not the universality oracle. Arabic joining, Indic reordering, bidi policy, CJK line breaking, emoji/ZWJ behavior, and other script-specific claims use their separately pinned fonts and fixtures. Those fixtures can later appear as live workloads, but they are not silently folded into a Latin font that lacks their coverage.

Selecting a font fixture never rewrites or shortens benchmark ipsum. Every selectable family receives the same source string so glyph count, line count, wrap behavior, missing-glyph count, and rendering cost remain comparable. Missing coverage is visible evidence rather than a reason to substitute easier copy; font fallback remains separate roadmap work.

The Advanced Shaping workload has a separate script-specific showcase corpus. Its live form contains paragraph-scale, grapheme-safe reveal units and types one unit at a time into a stable, viewport-centered measure from a fixed logical start edge, making joining, reordering, and line wrapping observable without moving the paragraph origin. Its bounded conformance form remains independently fixed so exact hashes and counts do not change merely because the human demonstration needs more copy.

Source text is code-owned and tested. Changes require reviewing affected glyph coverage, exact conformance hashes/counts, live layout behavior at 1× and 2× DPR, this concept, the benchmark package concept, and the canonical roadmap/log in the same commit.
