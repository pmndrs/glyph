---
type: Documentation Audit
title: Documentation consolidation audit
description: Classifies the planning corpus, records contradictions, and identifies the canonical home and disposition of every document.
status: complete
tags: [documentation, audit, okf, diataxis]
timestamp: 2026-07-23
---

# Documentation consolidation audit

## Outcome

The repository now has one API-first front door, one OKF bundle index, one active roadmap, and one artifact map. Detailed contracts remain separate reference concepts. Research and historical discussion remain available but are not allowed to override canonical planning artifacts.

Authority order:

1. accepted ADRs and versioned schemas once they exist;
2. current API and data contracts;
3. the [canonical roadmap](roadmap/ROADMAP.md) for implementation order;
4. the [project brief](planning/PROJECT_BRIEF.md) for product intent;
5. test, benchmark, and audit documents for evidence procedures;
6. historical synthesis and extracted discussion for provenance only.

## Contradictions resolved

| Ambiguity | Resolution | Canonical home |
| --- | --- | --- |
| Bitmap first versus MTSDF default | Bitmap is the lowest-risk first end-to-end proof, not a shippable renderer set. The first release requires bitmap, MTSDF, and Slug; MTSDF becomes the proposed general-purpose recommendation only after its benchmark gates. | [Roadmap](roadmap/ROADMAP.md), [README](../README.md) |
| One font versus multiple fonts | The integration slice runs one font. V1 adds a second-font registration and presentation-binding smoke fixture; mixed-font spans and fallback remain milestone 11. | [Roadmap](roadmap/ROADMAP.md) |
| All three presentations in V1 versus bitmap-only slice | Bitmap is the current integration proof. MTSDF and Slug are mandatory before the first release; color emoji and SVG icon-font baking retain their later lane without changing shaping or paragraph contracts. | [Roadmap](roadmap/ROADMAP.md) |
| Dense remapped IDs versus source IDs | V0 preserves source-local `u16` glyph IDs. Dense remapping is advanced compiler work and requires a declared format revision or compatible extension. | [Shaping contract](planning/SHAPING_DATA_CONTRACT.md) |
| No runtime parsing versus retained SFNT | The normal browser path performs no source-font parsing or JS object reconstruction. HarfRust still reads the reduced SFNT table structures in Wasm. | [Shaping contract](planning/SHAPING_DATA_CONTRACT.md) |
| Compiler required now versus later | A real minimal baker is required now. Subsetting, closure, remapping, compiled lookups, AOT/JIT, MLIR, and SIMD are later evidence-driven compiler units. | [Roadmap](roadmap/ROADMAP.md) |
| One GLB versus separate resources | The data model defines one core resource plus presentation resources; packaging may embed them together or load/attach them separately without changing records. | [Presentation contract](planning/PRESENTATION_DATA_CONTRACT.md) |
| Full reshape on resize versus cached layout | Width always triggers reflow. Broad shapes are reused when safe; boundary-sensitive ranges are reshaped in one batched Wasm call. | [API reference](planning/API_SHAPES.md) |
| Automatic renderer selection versus explicit choice | Callers select presentations explicitly. Recommendations may guide selection but the runtime does not silently switch. | [Renderer matrix](planning/RENDERER_CAPABILITIES.md) |

## Diátaxis classification and disposition

| Document | Primary role | Disposition |
| --- | --- | --- |
| `/README.md` | landing/routing page | Rewritten API-first; canonical project front door. |
| `/RESEARCH.md` | source bibliography | Retained outside the OKF bundle as the external research record. |
| `docs/tutorials/API_PREVIEW.md` | API guide | New canonical usage walkthrough; explicitly a pre-implementation fixture. |
| `docs/roadmap/ROADMAP.md` | roadmap | New and authoritative for implementation order. |
| `docs/roadmap/ARTIFACTS.md` | artifact reference | New and authoritative for outputs and ownership. |
| `PROJECT_BRIEF.md` | project explanation | Retained; revised to distinguish current slice from product horizon. |
| `ARCHITECTURE.md` | architecture reference | Retained as canonical system boundary. |
| `API_SHAPES.md` | API reference | Retained as canonical V0 interface fixture. |
| `DATA_DESIGN_V0.md` | data reference | Retained as overview; detailed contracts remain authoritative. |
| `SHAPING_DATA_CONTRACT.md` | data contract | Retained as canonical shaping payload and ABI. |
| `PRESENTATION_DATA_CONTRACT.md` | data contract | Retained as canonical presentation packaging and records. |
| `extensions/**` | extension reference | Retained as current draft schemas; changed only with the contracts. |
| `TOOLING_FIXTURES.md` | verification reference | Retained; fixtures now map to roadmap artifacts. |
| `CONFORMANCE_PLAN.md` | verification how-to | Retained as correctness procedure. |
| `BENCHMARK_PLAN.md` | verification how-to | Retained as measurement procedure. |
| `AUTORESEARCH.md` | optimization protocol | Retained but inactive until milestone 7 baselines exist. |
| `RENDERER_CAPABILITIES.md` | renderer reference | Retained as feature matrix, not implementation status. |
| `GPU_COMPRESSION.md` | technical explanation | Retained; adopted exact layouts defer to the presentation contract. |
| `PAYLOAD_BUDGET.md` | budget model | Retained; estimates remain labeled until generator reports replace them. |
| `IMPLEMENTATION_DIFFICULTY.md` | planning estimate | Retained as rationale; order is controlled by the roadmap. |
| `SLUG_AUDIT.md` | migration research | Retained as source-specific prior-art audit. |
| `DECISION_REGISTER.md` | governance register | Retained; accepted choices should graduate to ADRs. |
| `OPEN_QUESTIONS.md` | governance register | Retained; blocking questions are referenced by milestone 0. |
| `GLTF_EXTENSION_REGISTRATION.md` | submission draft | Retained but must not be submitted before maintainer review. |
| `ISSUE_BACKLOG.md` | issue catalog | Retained as decomposable work inventory; roadmap order wins. |
| `VERTICAL_SLICE_ROADMAP.md` | superseded plan | Preserved as planning history; replaced by the canonical roadmap. |
| `PHASED_PLAN.md` | superseded plan | Preserved as planning history; replaced by the canonical roadmap. |
| `SCOPE_LANES.md` | superseded plan | Preserved as rescoping history; replaced by the canonical roadmap. |
| `DESIGN_SYNTHESIS.md` | historical explanation | Preserved for rationale and hypotheses only. |
| `DISCUSSION_EXTRACTION.md` | historical record | Preserved as complete conversational provenance only. |

## Producer-quality audit

- Every Markdown concept under `docs/` must carry parseable YAML frontmatter with a non-empty `type`.
- `docs/index.md` and `docs/log.md` are the only reserved files at the bundle root.
- Internal links should resolve even though OKF consumers must tolerate broken links.
- Unknown frontmatter fields must be preserved.
- Historical documents must identify the current canonical replacement near their opening.
- Claims sourced externally belong in `/RESEARCH.md` or a final citations section.

# Citations

[1] [Open Knowledge Format v0.1 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)

[2] [Diátaxis documentation framework](https://diataxis.fr/)
