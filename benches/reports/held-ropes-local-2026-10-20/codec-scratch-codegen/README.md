# Frozen codec scratch code generation inspection

The optimized named Wasm has repeated scratch zeroing in both the four-record SIMD group loop and the scalar tail loop. This is a static observation from the frozen `execute_program` function, not a claim about how often either loop runs or the time those fills cost.

The named input is SHA-256 `01464bdb0b8acd6a6882fbdf8b4a8fc2c4f9731bc5201f07e90fd667571dc53c` and the shipping `candidate.wasm` is SHA-256 `1f8d970cd74eafd2aedd5adb98abd64d002ac0ebd370fa40e936dc4dbd8a6fbf`. The profile manifest and package authentication manifest agree on both identities. The package member `package/dist/text-shaper.wasm` is `1f8d970cd74eafd2aedd5adb98abd64d002ac0ebd370fa40e936dc4dbd8a6fbf` bytes `1609232`. The named binary contains one `name` custom section; shipping has no custom section. All 10 standard section IDs appear in the same order and have byte-identical complete section encodings, including code section 10. So these files differ in the name custom section, while their executable/standard sections match byte for byte.

In the named disassembly, function index 497 is `_RNvNtNtCscGJfW8CR417_19pmndrs_glyph_shaper6engine5codec15execute_program`. The emitted function contains 4 static `memory.fill` instructions. Loop `$label7` contains two fills (512 + 1,024 bytes = 1,536 bytes per loop iteration) and its backedge decrements the group counter. Loop `$label11` contains two fills (128 + 256 bytes = 384 bytes per iteration) and its backedge advances the scalar record index. No separate `execute_record` function is named in the profile manifest; the scalar loop is inside `execute_program`. There are no explicit zero-valued stores in either loop body; store opcode counts are preserved in the receipt.

The same SIMD loop includes four `f32x4.extract_lane` operations for lanes 0 through 3, each followed by a sign-bit mask and scalar integer range comparison against the largest finite `f32` bit pattern. The four results are combined before the failure branch. That is the existing four-lane scalar finite check in emitted code, not a vector exponent classifier. The excerpt below is from the frozen named Wasm disassembly. No instruction count is a runtime-frequency estimate.

The command ran under pinned mise with the repository's Binaryen 129 executable. The first decode attempt is preserved in its receipt and failed because the destination directory did not yet exist; after creating that evidence directory, the same decode completed with exit 0. Successful command and output hashes are recorded in [`receipt.json`](./receipt.json).

Static inspection does not establish dynamic loop frequency, active output distribution, wall time, cache behavior, or stack high-water. The fill sizes describe the explicit initialization instructions only.

## Exact bounded disassembly excerpts

Function prologue and 1,536-byte frame:

```wat
318253:   (global.set $global$0
318254:    (local.tee $9
318255:     (i32.sub
318256:      (global.get $global$0)
318257:      (i32.const 1536)
318258:     )
318259:    )
318260:   )
318261:   (local.set $7
318262:    (i32.const 2)
318263:   )
```

SIMD group loop entry and fills:

```wat
318714:         (loop $label7
318715:          (memory.fill
318716:           (local.get $9)
318717:           (i32.const 0)
318718:           (i32.const 512)
318719:          )
318720:          (memory.fill
318721:           (i32.add
318722:            (local.get $9)
318723:            (i32.const 512)
318724:           )
318725:           (i32.const 0)
318726:           (i32.const 1024)
318727:          )
318728:          (if
318729:           (local.get $42)
318730:           (then
```

SIMD group counter backedge:

```wat
320788:           )
320789:          )
320790:          (br_if $label7
320791:           (local.tee $38
320792:            (i32.sub
320793:             (local.get $38)
320794:             (i32.const 1)
320795:            )
320796:           )
320797:          )
320798:         )
```

Scalar tail loop entry and fills:

```wat
320850:       (loop $label11
320851:        (memory.fill
320852:         (local.get $9)
320853:         (i32.const 0)
320854:         (i32.const 128)
320855:        )
320856:        (memory.fill
320857:         (i32.add
320858:          (local.get $9)
320859:          (i32.const 512)
320860:         )
320861:         (i32.const 0)
320862:         (i32.const 256)
320863:        )
320864:        (if
320865:         (local.get $26)
320866:         (then
```

Scalar record backedge:

```wat
322145:         )
322146:        )
322147:        (br_if $label11
322148:         (i32.gt_u
322149:          (local.get $24)
322150:          (local.tee $10
322151:           (i32.add
322152:            (local.get $10)
322153:            (i32.const 1)
322154:           )
322155:          )
322156:         )
322157:        )
322158:       )
```

Four-lane finite check:

```wat
319441:                             (f32x4.extract_lane 0
319442:                              (local.tee $45
319443:                               (v128.load
319444:                                (i32.add
319445:                                 (local.get $9)
319446:                                 (i32.shl
319447:                                  (local.get $10)
319448:                                  (i32.const 4)
319449:                                 )
319450:                                )
319451:                               )
319452:                              )
319453:                             )
319454:                            )
319455:                            (i32.const 2147483647)
319456:                           )
319457:                           (i32.const 2139095039)
319458:                          )
319459:                          (i32.gt_u
319460:                           (i32.and
319461:                            (i32.reinterpret_f32
319462:                             (f32x4.extract_lane 1
319463:                              (local.get $45)
319464:                             )
319465:                            )
319466:                            (i32.const 2147483647)
319467:                           )
319468:                           (i32.const 2139095039)
319469:                          )
319470:                         )
319471:                         (i32.or
319472:                          (i32.gt_u
319473:                           (i32.and
319474:                            (i32.reinterpret_f32
319475:                             (f32x4.extract_lane 2
319476:                              (local.get $45)
319477:                             )
319478:                            )
319479:                            (i32.const 2147483647)
319480:                           )
319481:                           (i32.const 2139095039)
319482:                          )
319483:                          (i32.ge_u
319484:                           (i32.and
319485:                            (i32.reinterpret_f32
319486:                             (f32x4.extract_lane 3
319487:                              (local.get $45)
319488:                             )
319489:                            )
319490:                            (i32.const 2147483647)
319491:                           )
319492:                           (i32.const 2139095040)
319493:                          )
319494:                         )
319495:                        )
319496:                       )
319497:                       (if
```
