# Text shaper Wasm size accounting

Mode: named (authenticated executable match).
Release: 1625526 raw bytes, 607475 gzip bytes, SHA-256 `8b594e2b123c35c0789a1e38ee15761e9a6a2245fdce6da1181efacbc0ab366a`.
Defined functions: 1608; imported functions: 0.
Named bodies: 1312522 bytes; Binaryen generated/shared bodies: 12558 bytes; unnamed bodies: 0 bytes.
Generic-name hints: 280 functions, 284265 raw body bytes.
Baseline delta: +163521 raw bytes; +66112 whole-file gzip bytes; +721 defined functions.

## Raw sections

| Ordinal |  ID | Name | Raw bytes |
| ------: | --: | ---- | --------: |
|       0 |   1 |      |       784 |
|       1 |   3 |      |      1613 |
|       2 |   4 |      |         7 |
|       3 |   5 |      |         5 |
|       4 |   6 |      |        11 |
|       5 |   7 |      |      1472 |
|       6 |   9 |      |       261 |
|       7 |  12 |      |         4 |
|       8 |  10 |      |   1327762 |
|       9 |  11 |      |    293599 |

Eight-byte header plus sections: 1625526 bytes.
Code section: 1325080 body bytes + 2676 body-length prefix bytes + 2 count-prefix bytes + 4 section-framing bytes = 1327762 bytes.

## Largest defined bodies

| Index | Body bytes | Type index | Symbol hints        | Raw name                                                                                               |
| ----: | ---------: | ---------: | ------------------- | ------------------------------------------------------------------------------------------------------ |
|   593 |      31027 |          7 | pmndrs_glyph_shaper | `_RNvMs9_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_12PlannerState14prepare_upsert`      |
|   375 |      19611 |         17 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state28append_paragraph_measurement`               |
|   944 |      18966 |          4 | harfrust            | `_RNvMs_NtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB4_14OtShapeContext16position_by_plan`                |
|   858 |      15219 |          5 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb9tag_table26tags_from_complex_language`                             |
|   682 |      15073 |         16 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state23validate_planner_inputs`                    |
|   664 |      14537 |         16 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState19prepare_flow_layo` |
|   943 |      14511 |          4 | harfrust            | `_RNvMs_NtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB4_14OtShapeContext14substitute_pre`                  |
|   983 |      13750 |          4 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb27ot_shaper_vowel_constraints33preprocess_text_vowel_constraints`   |
|   671 |      13044 |          8 | pmndrs_glyph_shaper | `_RNvNtCscGJfW8CR417_19pmndrs_glyph_shaper4bidi12analyze_into`                                         |
|   967 |      12846 |          1 | harfrust            | `_RNvNtNtNtCsbx9tMmkA0qL_8harfrust2hb3aat17layout_morx_table5apply`                                    |
|   659 |      11741 |          3 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState18prepare_positione` |
|   656 |      11338 |          3 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState16prepare_clusters`  |
|   506 |      11152 |          0 | pmndrs_glyph_shaper | `_RNvMs1_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5codecNtB5_14ValidatedCodec3new`                |
|   553 |      10921 |         16 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16prepa` |
|   851 |      10773 |          0 | harfrust            | `_RNvMNtNtCsbx9tMmkA0qL_8harfrust2hb4faceNtB2_10ShaperData3new`                                        |
|   984 |      10755 |          5 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb13ot_shaper_use15setup_syllables`                                   |
|   857 |      10556 |          7 | harfrust            | `_RNvMNtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB2_21hb_ot_shape_planner_t3new`                         |
|   614 |      10484 |          3 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16compi` |
|   936 |      10378 |          7 | harfrust            | `_RNvMs4_NtNtCsbx9tMmkA0qL_8harfrust2hb4faceNtB5_9hb_font_t15shape_with_plan`                          |
|   784 |      10206 |          1 | harfrust            | `_RNvMs6_NtNtNtCsbx9tMmkA0qL_8harfrust2hb3aat17layout_morx_tableNtB5_17MorxSubtableCache3new`          |

## Nonexclusive crate markers in raw names

| Marker              | Functions | Raw body bytes |
| ------------------- | --------: | -------------: |
| pmndrs_glyph_shaper |       731 |         762074 |
| harfrust            |       313 |         411530 |
| read_fonts          |       443 |         192658 |
| font_types          |        14 |           5378 |
| alloc               |       145 |          47519 |
| core                |       275 |         171463 |
| talc                |         4 |           1677 |

## Largest bodies with own-crate symbol hints

| Index | Body bytes | Type index | Symbol hints        | Raw name                                                                                               |
| ----: | ---------: | ---------: | ------------------- | ------------------------------------------------------------------------------------------------------ |
|   593 |      31027 |          7 | pmndrs_glyph_shaper | `_RNvMs9_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_12PlannerState14prepare_upsert`      |
|   375 |      19611 |         17 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state28append_paragraph_measurement`               |
|   682 |      15073 |         16 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state23validate_planner_inputs`                    |
|   664 |      14537 |         16 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState19prepare_flow_layo` |
|   671 |      13044 |          8 | pmndrs_glyph_shaper | `_RNvNtCscGJfW8CR417_19pmndrs_glyph_shaper4bidi12analyze_into`                                         |
|   659 |      11741 |          3 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState18prepare_positione` |
|   656 |      11338 |          3 | pmndrs_glyph_shaper | `_RNvMsb_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState16prepare_clusters`  |
|   506 |      11152 |          0 | pmndrs_glyph_shaper | `_RNvMs1_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5codecNtB5_14ValidatedCodec3new`                |
|   553 |      10921 |         16 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16prepa` |
|   614 |      10484 |          3 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16compi` |

Exact duplicate candidate groups: 0. Full function rows and groups are in report.json.

## Interpretation limits

- Function bodies and section bytes are exact raw-byte accounting; gzip applies only to whole files.
- Names provide nonexclusive source hints, not exact ownership or dependency causality after inlining and linker merging.
- Owner-hint body-byte totals overlap when one mangled name contains multiple crate markers; they are not a partition.
- Rust generic-name patterns hint at instantiation; they do not prove generic expansion overhead.
- Exact duplicate candidates have equal declared type indexes and identical encoded bodies; deletion safety is unproven.
- An unnamed baseline supports whole-file and function-count deltas only, not owner/category deltas.
