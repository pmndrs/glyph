import { assert, bench, group } from '@pmndrs/labs';

import { createRawEngineSession, rawEngineCases } from '../../packages/glyph/scripts/support/raw-engine-session.mjs';

// Discoverable selectors: @engine @exhaustive @cold @no-op @publish-measurement @publish-inspection @font-size
// @column-resize @active-column-resize @measure-query @position-query @adopt-measure-query @adopt-position-query
// @suffix-edit @localized-edit @localized-splice @justify @bidi-resize @equivalent-width
const technique = process.env.GLYPH_LABS_TECHNIQUE ?? 'bitmap';
const corpus = process.env.GLYPH_LABS_CORPUS ?? 'latin';
const glyphs = Number(process.env.GLYPH_LABS_GLYPHS ?? '22000');
const wasmPath = process.env.GLYPH_LABS_WASM;

group(`raw retained engine ${technique}/${corpus} @engine @exhaustive`, () => {
  for (const name of rawEngineCases(corpus)) {
    bench(`${name} @${name}`, async function* () {
      const session = await createRawEngineSession({ techniqueName: technique, corpus, glyphs, wasmPath });
      const benchmarkCase = session.createCase(name);
      if (name !== 'cold') {
        for (let iteration = 0; iteration < 8; iteration += 1) benchmarkCase.warmup();
      }
      const result = yield () => benchmarkCase.run();
      assert(result >= 0, 'raw engine result must be nonnegative');
      benchmarkCase.dispose();
    });
  }
});
