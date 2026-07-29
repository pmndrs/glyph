import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = '5f220b17d27ed64873f22cde0dd593685387bd19';
const directory = resolve('fixtures/fonts/source-serif-4.005');
const check = process.argv.includes('--check');

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/adobe-fonts/source-serif/${commit}`,
  check,
  directory,
  files: [
    {
      localName: 'SourceSerif4-Regular.ttf',
      remotePath: 'TTF/SourceSerif4-Regular.ttf',
      sha256: 'e5a4ee6a3d87bb9024796be390c6771e2a0eb1883dae25effaf57ca01668e24b',
    },
    {
      localName: 'OFL.md',
      remotePath: 'LICENSE.md',
      sha256: 'c21d7293d87b6d7ab1d0229a2f55b77f33a7613a6a4e66f6693d68d7d8d09464',
    },
  ],
});
