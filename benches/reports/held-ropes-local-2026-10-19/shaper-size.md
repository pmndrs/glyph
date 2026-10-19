# Text shaper Wasm size accounting

Mode: named (authenticated executable match).
Release: 1601557 raw bytes, 596277 gzip bytes, SHA-256 `244078b186e9de0414331ff9de2632c8a57c4ec20f19b6e0a41ce964f8e1b30a`.
Defined functions: 1583; imported functions: 0.
Named bodies: 1288909 bytes; Binaryen generated/shared bodies: 12457 bytes; unnamed bodies: 0 bytes.
Generic-name hints: 275 functions, 275071 raw body bytes.
Baseline delta: +139552 raw bytes; +54914 whole-file gzip bytes; +696 defined functions.

## Raw sections

| Ordinal |  ID | Name | Raw bytes |
| ------: | --: | ---- | --------: |
|       0 |   1 |      |       799 |
|       1 |   3 |      |      1588 |
|       2 |   4 |      |         7 |
|       3 |   5 |      |         5 |
|       4 |   6 |      |        11 |
|       5 |   7 |      |      1472 |
|       6 |   9 |      |       261 |
|       7 |  12 |      |         4 |
|       8 |  10 |      |   1304011 |
|       9 |  11 |      |    293391 |

Eight-byte header plus sections: 1601557 bytes.
Code section: 1301366 body bytes + 2639 body-length prefix bytes + 2 count-prefix bytes + 4 section-framing bytes = 1304011 bytes.

## Largest defined bodies

| Index | Body bytes | Type index | Symbol hints        | Raw name                                                                                               |
| ----: | ---------: | ---------: | ------------------- | ------------------------------------------------------------------------------------------------------ |
|   568 |      31027 |          8 | pmndrs_glyph_shaper | `_RNvMs5_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_12PlannerState14prepare_upsert`      |
|   527 |      22730 |         25 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16prepa` |
|   357 |      19611 |         19 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state28append_paragraph_measurement`               |
|   920 |      18966 |          4 | harfrust            | `_RNvMs_NtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB4_14OtShapeContext16position_by_plan`                |
|   834 |      15219 |          5 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb9tag_table26tags_from_complex_language`                             |
|   597 |      14537 |         16 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState19prepare_flow_layo` |
|   919 |      14511 |          4 | harfrust            | `_RNvMs_NtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB4_14OtShapeContext14substitute_pre`                  |
|   959 |      13750 |          4 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb27ot_shaper_vowel_constraints33preprocess_text_vowel_constraints`   |
|   658 |      13190 |         16 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state23validate_planner_inputs`                    |
|   605 |      13044 |          7 | pmndrs_glyph_shaper | `_RNvNtCscGJfW8CR417_19pmndrs_glyph_shaper4bidi12analyze_into`                                         |
|   943 |      12846 |          1 | harfrust            | `_RNvNtNtNtCsbx9tMmkA0qL_8harfrust2hb3aat17layout_morx_table5apply`                                    |
|   588 |      11741 |          3 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState18prepare_positione` |
|   585 |      11338 |          3 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState16prepare_clusters`  |
|   483 |      11152 |          0 | pmndrs_glyph_shaper | `_RNvMs1_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5codecNtB5_14ValidatedCodec3new`                |
|   827 |      10773 |          0 | harfrust            | `_RNvMNtNtCsbx9tMmkA0qL_8harfrust2hb4faceNtB2_10ShaperData3new`                                        |
|   960 |      10755 |          5 | harfrust            | `_RNvNtNtCsbx9tMmkA0qL_8harfrust2hb13ot_shaper_use15setup_syllables`                                   |
|   833 |      10556 |          8 | harfrust            | `_RNvMNtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB2_21hb_ot_shape_planner_t3new`                         |
|   912 |      10378 |          8 | harfrust            | `_RNvMs4_NtNtCsbx9tMmkA0qL_8harfrust2hb4faceNtB5_9hb_font_t15shape_with_plan`                          |
|   760 |      10206 |          1 | harfrust            | `_RNvMs6_NtNtNtCsbx9tMmkA0qL_8harfrust2hb3aat17layout_morx_tableNtB5_17MorxSubtableCache3new`          |
|   837 |      10010 |          3 | harfrust            | `_RNvMNtNtCsbx9tMmkA0qL_8harfrust2hb8ot_shapeNtB2_21hb_ot_shape_planner_t7compile`                     |

## Nonexclusive crate markers in raw names

| Marker              | Functions | Raw body bytes |
| ------------------- | --------: | -------------: |
| pmndrs_glyph_shaper |       707 |         738528 |
| harfrust            |       313 |         411530 |
| read_fonts          |       443 |         192658 |
| font_types          |        14 |           5378 |
| alloc               |       141 |          47368 |
| core                |       270 |         164967 |
| talc                |         4 |           1677 |

## Largest bodies with own-crate symbol hints

| Index | Body bytes | Type index | Symbol hints        | Raw name                                                                                               |
| ----: | ---------: | ---------: | ------------------- | ------------------------------------------------------------------------------------------------------ |
|   568 |      31027 |          8 | pmndrs_glyph_shaper | `_RNvMs5_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_12PlannerState14prepare_upsert`      |
|   527 |      22730 |         25 | pmndrs_glyph_shaper | `_RNvMs_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine12ordered_planNtB4_19OrderedPlanCompiler16prepa` |
|   357 |      19611 |         19 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state28append_paragraph_measurement`               |
|   597 |      14537 |         16 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState19prepare_flow_layo` |
|   658 |      13190 |         16 | pmndrs_glyph_shaper | `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5state23validate_planner_inputs`                    |
|   605 |      13044 |          7 | pmndrs_glyph_shaper | `_RNvNtCscGJfW8CR417_19pmndrs_glyph_shaper4bidi12analyze_into`                                         |
|   588 |      11741 |          3 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState18prepare_positione` |
|   585 |      11338 |          3 | pmndrs_glyph_shaper | `_RNvMs7_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_14ParagraphState16prepare_clusters`  |
|   483 |      11152 |          0 | pmndrs_glyph_shaper | `_RNvMs1_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5codecNtB5_14ValidatedCodec3new`                |
|   539 |       9884 |          0 | pmndrs_glyph_shaper | `_RNvMs4_NtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5stateNtB5_10TextEngine11new_planner`           |

Exact duplicate candidate groups: 0. Full function rows and groups are in report.json.

## Interpretation limits

- Function bodies and section bytes are exact raw-byte accounting; gzip applies only to whole files.
- Names provide nonexclusive source hints, not exact ownership or dependency causality after inlining and linker merging.
- Owner-hint body-byte totals overlap when one mangled name contains multiple crate markers; they are not a partition.
- Rust generic-name patterns hint at instantiation; they do not prove generic expansion overhead.
- Exact duplicate candidates have equal declared type indexes and identical encoded bodies; deletion safety is unproven.
- An unnamed baseline supports whole-file and function-count deltas only, not owner/category deltas.
