# Bold word faces

The origin scene types one word per language at display size, so the letterforms need weight — a
Regular face leaves too little ink to show the clip through. None of the benchmark fixtures carry a
bold: all three are static Regular with no variable axis.

These are cut from the canonical upstream bold faces to exactly the characters the scene types.

| file                       | source                                                                      | notes                                                                                   |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cjk-bold-words.otf`       | `notofonts/noto-cjk` → `Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf`           | 17 MB source; carries JA, ZH, KO, Greek and Cyrillic                                    |
| `devanagari-bold-word.ttf` | `google/fonts` → `ofl/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf` | variable; instanced to `wght=700, wdth=100` while cutting                               |
| `amiri-bold-word.ttf`      | `google/fonts` → `ofl/amiri/Amiri-Bold.ttf`                                 | metric-compatible with Regular, so advances match — it is genuinely `usWeightClass=700` |

All three are SIL Open Font License 1.1. Both licence texts are alongside.

Cut with HarfBuzz `hb-subset` rather than glyph's own CLI. The CJK face has to be, because
`bake --unicodes` drops CFF outlines (pmndrs/glyph#180). The other two could go through the CLI, but
are cut here so all three stay consistent and the app commits kilobytes instead of a megabyte.

The codepoint set must include decomposed forms as well as composed ones: this Greek has
eta-with-tonos as base plus combining mark, and a subset holding only the composed codepoint renders
notdef.

    U=$(python3 -c "
    import sys, unicodedata
    w = sys.argv[1]
    pts = set(w) | set(unicodedata.normalize('NFD', w)) | set(unicodedata.normalize('NFC', w))
    print(','.join(sorted('U+%04X' % ord(c) for c in pts)))
    " "文字字形글자γράμμαбуква")
    hb-subset --unicodes="$U" --output-file=cjk-bold-words.otf NotoSansCJKjp-Bold.otf
    hb-subset --instance=wght=700 --instance=wdth=100 --unicodes="<अक्षर set>" \
      --output-file=devanagari-bold-word.ttf "NotoSansDevanagari[wdth,wght].ttf"
    hb-subset --unicodes="<حرف set>" --output-file=amiri-bold-word.ttf Amiri-Bold.ttf

Verified after cutting: every word shapes to the same glyph count as the full face, and each cut
reports `usWeightClass=700`.
