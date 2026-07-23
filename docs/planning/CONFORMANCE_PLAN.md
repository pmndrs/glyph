# Shaping and layout conformance plan

Status: proposed  
Purpose: define correctness before implementation or optimization.

## Conformance target

Primary target:

> Match a pinned HarfRust release for valid, supported, statically instantiated OpenType fonts under identical shaping inputs.

Secondary target:

> Compare the same cases against the corresponding pinned HarfBuzz release and track every difference explicitly.

HarfRust is not assumed to equal HarfBuzz in every case. The project must never conceal a known difference by weakening comparisons globally.

## Version manifest

Every fixture run records:

```text
font SHA-256
font face index
HarfRust version and commit
HarfBuzz version and commit
Unicode version
pmndrs/text compiler version
PMNDRS_font format version
variation coordinates
shaping input options
```

Reference changes require a dedicated review containing the old/new output diff and upstream release notes.

## Comparison input

Each case specifies:

- exact source font bytes and face index;
- UTF-8 fixture text plus unambiguous code-point dump;
- input range and surrounding context range;
- direction;
- script;
- language;
- feature tags, values, and text ranges;
- variation coordinates;
- cluster level;
- buffer flags;
- replacement code point for invalid input;
- expected handling of malformed UTF-16 at the JS boundary.

Auto-guessed properties and explicit properties are separate cases.

## Comparison output

Compare all fields, not rendered appearance alone:

- output glyph count;
- packed/source glyph identity mapping;
- glyph IDs;
- cluster values;
- `xAdvance` and `yAdvance`;
- `xOffset` and `yOffset`;
- glyph flags, including unsafe-to-break/concat where exposed;
- direction and resolved segment properties;
- success/error category.

Design-unit integer outputs require exact equality. Floating presentation/layout coordinates are tested separately with documented tolerances.

## Three-way stages

### Stage A — HarfBuzz versus HarfRust

Purpose: establish upstream baseline differences independently of this project.

Output:

- passing cases;
- allowlisted semantic differences with upstream issue/document link;
- unsupported cases rejected before baking;
- malformed-font behavior tracked separately from valid-font conformance.

### Stage B — source font versus baked reference payload

Run the same pinned HarfRust path on:

1. original/static-instanced source font;
2. subsetted/remapped shaping reference data used by `PMNDRS_font`.

Purpose: prove subset closure, ID remapping, metrics, and retained layout tables before testing optimized data.

### Stage C — baked reference versus optimized operation

For each compiled operation family, run both executors from identical pre-operation buffer state and compare post-operation state where feasible, then compare final shaped output.

Operation families are enabled independently so failures identify the responsible compiler/executor.

### Stage D — shaped output versus paragraph integration

Verify that line fitting and boundary reshaping preserve:

- cluster-safe breaks;
- line-start/line-end shaping;
- source-to-glyph mapping;
- bidi visual order;
- inserted hyphen/ellipsis mapping;
- identical shaped glyphs across presentation selection.

## Required script/behavior matrix

| Area | Minimum cases |
| --- | --- |
| Latin | kerning, `liga`, `clig`, `calt`, marks, decomposed/composed text, stylistic feature ranges |
| Greek/Cyrillic | extended cmap, marks, language-specific substitutions where available |
| Arabic | joining forms, lam-alef, marks, cursive attachment, RTL clusters, line-boundary reshape |
| Hebrew | RTL order, marks, punctuation, mixed Latin |
| Devanagari | reordering, conjuncts, pre-base vowels, marks, cluster boundaries |
| USE script | at least one non-Devanagari USE font/script with syllable behavior |
| Thai/Lao | marks and line-break tailoring boundary cases |
| Hangul | precomposed and Jamo sequences |
| CJK | supplementary cmap, variation sequences, vertical-form data retained though vertical layout is deferred |
| Emoji | supplementary scalars, VS15/VS16, modifiers, ZWJ sequences, flags/keycaps |
| Icons | private-use cmap, missing glyph, no-GSUB fast/simple font |
| Controls | LF, CRLF, paragraph separator, tabs policy, default ignorables, ZWJ/ZWNJ, soft hyphen |
| Invalid input | unpaired UTF-16 surrogates and replacement policy at JS boundary |

## Cluster-specific cases

Fixtures must cover:

- many characters to one glyph;
- one character to multiple glyphs;
- reordered glyphs;
- combining-mark stacks;
- zero-advance marks;
- ligature clusters adjacent to legal line breaks;
- monotone cluster levels for LTR and RTL;
- style/feature boundaries inside words;
- caret and hit-test mapping around ligatures;
- unsafe-to-break and unsafe-to-concat flags;
- context range larger than emitted item range.

## Paragraph correctness matrix

### Unicode algorithms

- Run the version-matched Unicode `LineBreakTest.txt`.
- Run `GraphemeBreakTest.txt` for extended grapheme boundaries.
- Run `BidiTest.txt` and `BidiCharacterTest.txt` if bidi analysis is owned by the package.
- Record any tailoring as a named profile, never an undocumented deviation.

### Reflow cases

- empty paragraph and empty lines;
- explicit hard breaks including CRLF;
- trailing spaces and all-space lines;
- single cluster wider than the region;
- repeated width changes that converge on cached line boundaries;
- max lines with clip and ellipsis;
- soft hyphen hidden and selected;
- inserted hyphen in Arabic and Latin;
- mixed RTL/LTR text across lines;
- font fallback at grapheme/cluster boundaries;
- width change that needs zero reshapes;
- width change that batches several boundary reshapes into one call.

## Font corpus policy

The checked-in corpus must be redistributable and small enough for ordinary CI. Large or restricted corpora use download manifests with hashes and run in scheduled/manual jobs.

Each selected font records why it exists:

- script/feature coverage;
- source/license;
- exact file hash;
- expected reference engine behavior;
- subset used for repository fixtures;
- known upstream bugs.

No fixture may silently update by URL.

## Fuzzing

### Structured text generation

Bias generation toward:

- combining-mark chains;
- joining controls;
- virama/consonant sequences;
- emoji ZWJ and variation selectors;
- bidi isolates/embeddings;
- feature-range boundaries;
- invalid surrogate boundaries;
- very long clusters and repeated contexts.

### Binary inputs

Fuzz:

- GLB chunk lengths and order;
- JSON extension indexes;
- section offsets, lengths, counts, and alignments;
- integer overflow and overlapping ranges;
- capability/format enums;
- cmap page descriptors;
- operation records and trie/CSR indexes;
- atlas dimensions and row strides.

### Failure policy

- No crash, trap, out-of-bounds read, or unbounded allocation.
- Invalid baked data fails registration before shaping/upload.
- Differential mismatches save the source seed, options, and both outputs.
- Reduced reproductions become permanent regression fixtures.

## Visual tests

Shaping conformance is data equality; visual tests cover presentation and integration.

Required views:

- reference raster versus Slug/MTSDF/bitmap at representative sizes;
- extreme zoom/perspective for Slug;
- tiny text for bitmap and MTSDF;
- marks and cursive connections;
- clipping, ellipsis, alignment, and mixed direction;
- technique switching from one positioned run.

Snapshot comparison must use a perceptual metric and retain raw difference images. Exact pixel equality is required only for deterministic CPU-generated atlases or reference equations where appropriate.

## CI tiers

### Pull request tier

- format/unit tests;
- small licensed corpus;
- HarfRust differential fixtures;
- Unicode targeted subset;
- saved fuzz regressions;
- no network downloads.

Target duration: short enough to be required on every PR.

### Nightly tier

- full licensed/downloadable corpus by pinned hashes;
- HarfBuzz three-way comparison;
- Unicode conformance files;
- bounded differential fuzzing;
- native/Wasm baker parity;
- visual snapshots on reference GPU/software environment.

### Release tier

- all nightly checks;
- browser matrix;
- package and Wasm size gates;
- GLB backward/forward compatibility fixtures;
- Three Flatland downstream integration suite.

## Allowlist rules

Every allowlisted mismatch contains:

- stable case identifier;
- affected version range;
- exact differing fields;
- reason;
- upstream issue or source citation;
- owner;
- removal condition.

There is no wildcard allowlist by script, font, or output field.

## Exit criteria for Phase 1

- The initial corpus and licenses are documented.
- Stage A differences are understood and allowlisted narrowly.
- Stage B passes exactly for supported valid fonts.
- JS/Wasm handling of UTF-16 and clusters has dedicated fixtures.
- The conformance runner emits machine-readable and human-readable diffs.
- Saved fixtures include all comparison inputs and version metadata.
