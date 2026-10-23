# Post-wave untimed Bitmap observer preparation

Prepared only; the observer and summarizer have **not** been run against the new package. No build, browser, GPU, timing, source edit, or original proof overwrite was performed. The original `../observe.mjs`, `../raw.json`, and `../summary.json` remain unchanged.

At preparation, HELD was clean at source HEAD `d94fa436d7e59c86aa284d22bec41031b34b477a`. Its Rust `rust/shaper/src` sourceIdentity, computed with the repository's path/NUL/content and JavaScript `localeCompare` ordering, was `bf7c65322c9f3e24b1f345b892c54592a18df197946be345dcc23645b3657840`. The archive path and SHA must come from the frozen new build; no old archive SHA is embedded.

Run once after the exact new archive is frozen (replace the two archive values from that build receipt):

```sh
node /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/post-wave/observe.mjs \
  --archive '<new-frozen-archive-path>' \
  --archive-sha256 '<new-frozen-archive-sha256>' \
  --source-head d94fa436d7e59c86aa284d22bec41031b34b477a \
  --rust-source-sha256 bf7c65322c9f3e24b1f345b892c54592a18df197946be345dcc23645b3657840 \
  --output /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/post-wave/raw.json
python3 /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/post-wave/summarize.py \
  --raw /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/post-wave/raw.json \
  --baseline /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/summary.json \
  --output /private/tmp/glyph-bug-review-20261017/bitmap-equal-patch-proof/post-wave/summary.json
```

`preflight.py` rejects a wrong HEAD or archive SHA, and requires every packed TypeScript source and dist member to equal the local package. `observe.mjs` separately checks Rust sourceIdentity before loading any package module or calling `glyph.init()`. New raw and summary files use exclusive creation. It repeats the original 6-digit replacement, paint edit, and 1,024 four-glyph label bulk edit (4,120 dense records), with independent cold host arrays. `summarize.py` uses the accepted cold physical declarations when retained updates omit declarations and counts only actual emitted writes and Three dirty ranges. It records formerly eligible color/page fields that now have no patch; it does not infer GPU uploads or timing.

Syntax validation only: `node --check observe.mjs` exit 0; Python AST parsing of `preflight.py` and `summarize.py` exit 0. SHA-256: `observe.mjs` `7b16b3386b8dab5cee4026dc4203e13ff5f665720a6f5b03dad835188a62a7b1`; `preflight.py` `9dee6413f1276e7c2d877d4c81b18f9eeeb5c80c8888e956410725fd2efa3fcb`; `summarize.py` `1078f91c9785335af42f9f16fcde27bf5c6ca5df8e821cf4e428ae4aa74c914e`.
