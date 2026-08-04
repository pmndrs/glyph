import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = '09b7abf420f296894dc6c878e7b0da4f9f8d27a6';
const directory = resolve('fixtures/fonts/dancing-script-3.000');
const check = process.argv.includes('--check');

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/impallari/DancingScript/${commit}`,
  check,
  directory,
  files: [
    {
      localName: 'DancingScript-Regular.otf',
      remotePath: 'fonts/DancingScript-Regular.otf',
      sha256: 'd71f864af9c13eeb740230fd67309c2390a902dba2326ae06f2275ca52663c6a',
    },
    {
      localName: 'OFL.txt',
      remotePath: 'OFL.txt',
      sha256: '6f090277c00af96651ce6dbcc38ff1591047a3bffef486e80b6a32e8276a8201',
    },
  ],
});
/* @workflow
{
  "name": "font:dancing-script:sync",
  "summary": "Synchronize the authenticated Dancing Script fixture.",
  "requirements": "Network access to the pinned source.",
  "writes": "Checked-in font, metadata, and license."
}
*/
/* @workflow
{
  "name": "font:dancing-script:check",
  "summary": "Verify the authenticated Dancing Script fixture.",
  "requirements": "Checked-in authenticated fixture.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
