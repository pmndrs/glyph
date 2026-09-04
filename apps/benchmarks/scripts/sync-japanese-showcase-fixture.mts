import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = '9a6cc6b8ce992aff77b69c857c46af0b42cdff76';
const directory = resolve('fixtures/fonts/dot-gothic-16');
const check = process.argv.includes('--check');

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/dotgothic16`,
  check,
  directory,
  files: [
    {
      localName: 'DotGothic16-Regular.ttf',
      remotePath: 'DotGothic16-Regular.ttf',
      sha256: '3ad9af88726d42b40f7f365f0dcac785af73cf20ea6f1d5b44e57cc21150b8f1',
    },
    {
      localName: 'OFL.txt',
      remotePath: 'OFL.txt',
      sha256: 'b6630c61ea078cacd7fabe37d14ffe557a0b45b06683374a9aa9e24262993e33',
    },
    {
      localName: 'METADATA.pb',
      remotePath: 'METADATA.pb',
      sha256: 'ab13744709b98ba1196c45bc1bf9ba89e86df9620673e19ece14a8c6efe8c014',
    },
  ],
});
/* @workflow { "name": "font:japanese-showcase:sync", "summary": "Synchronize the Japanese showcase source fixture.", "requirements": "Authenticated source CJK font.", "writes": "Checked-in showcase fixture and metadata." } */
/* @workflow { "name": "font:japanese-showcase:check", "summary": "Verify the Japanese showcase source fixture.", "requirements": "Checked-in authenticated fixture.", "writes": "Nothing.", "args": ["--check"] } */
