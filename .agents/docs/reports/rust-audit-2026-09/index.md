# Rust audit evidence

Supporting material for [the audit](../../planning/rust-audit.md). Kept because the conclusions
there are summaries, and anyone acting on them needs the file and line references underneath.

Line references are against `feat/glyph-config-api` @ `12738c23`, the tree that was audited. They
will drift on other branches; re-locate by symbol name rather than trusting the number.

## `codex/` — 391 researched rules

Ten domains, researched against primary sources (Rust RFCs, the Rustonomicon, the Unsafe Code
Guidelines, clippy's own source, release notes), each rule written to be checkable: a reviewer
opens a file and says violated or not violated.

| file | rules | covers |
| --- | --- | --- |
| `01-idiomatic.md` | 40 | API guidelines, edition-2024 semantics, error taxonomy, dispatch |
| `02-nostd-alloc.md` | 39 | feature discipline, fallible allocation, checked arithmetic, allocators |
| `03-wasm.md` | 37 | binary size, size attribution, C-ABI design, memory-growth hazards |
| `04-dod.md` | 38 | SoA when it pays, index handles, layout, bounds-check elision |
| `05-simd.md` | 40 | stable v128, the two-artifact rule, differential testing |
| `06-unsafe.md` | 40 | provenance, aliasing, guest-pointer validation, Miri's limits |
| `07-maintainability.md` | 50 | lint tables, module architecture, DRY, dependency hygiene |
| `08-types-errors.md` | 40 | error modeling, typestate, unit newtypes, boundary conversion |
| `09-arc-sharing.md` | 30 | clone mechanics, `Vec`→`Arc<[T]>` cost, wasm32 atomics |
| `10-memory-access.md` | 37 | allocation in hot loops, cache behaviour, AoS/SoA at a boundary |

Two rules are corrected by measurement against this repository and should not be applied as
written: **07-R20** ("don't bother enabling `missing_safety_doc`, it is on by default") is
misleading here, because the ABI lives in private modules where reachability-keyed lints do not
look; and **02-R24** ("cross a narrowing boundary with `try_from`") flags all 653 `as` casts when
only 60 narrow on `wasm32`, where `usize` is 32 bits.

## `systems/` — eight per-system reviews

Sixty findings with `file:line`, before/after snippets, and a confidence level. Anything not fully
traced is marked `speculative`; several reports also record false leads that were ruled out, which
is worth reading before re-deriving them.

| file | high | medium | low |
| --- | --- | --- | --- |
| `sys-abi.md` | 1 | 2 | 5 |
| `sys-bakers.md` | 1 | 4 | 5 |
| `sys-cluster.md` | 0 | 1 | 4 |
| `sys-layout.md` | 2 | 1 | 3 |
| `sys-mtsdf.md` | 1 | 5 | 10 |
| `sys-plan.md` | 1 | 2 | 3 |
| `sys-simd.md` | 0 | 2 | 2 |
| `sys-state.md` | 1 | 1 | 5 |

Two of the seven high findings are the same defect: `sys-abi.md` A1 and `sys-mtsdf.md` M1 both
describe the reentrancy hazard, found independently. One, `sys-layout.md` L2, was downgraded to
medium during adjudication because `src/text-properties.ts:250` already validates the field.

## `measured-facts.md`

The measurements the audit was built on, with the inference boundary marked. Produced by
`glyph:ast-facts` plus targeted probes rather than by grep, because loop scope and `#[cfg(test)]`
scope are not regular languages.
