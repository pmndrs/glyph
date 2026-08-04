import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = 'cac60972ca4d7d5e3b5bfae33e90b1e0e5267a66';
const directory = resolve('fixtures/fonts/noto-sans-devanagari');
const check = process.argv.includes('--check');

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/notosansdevanagari`,
  check,
  directory,
  files: [
    {
      localName: 'NotoSansDevanagari.ttf',
      remotePath: 'NotoSansDevanagari-Regular.ttf',
      sha256: '79a470365ccb210fa3c7d8d8ff2e005ef9d983cfd067f735a0caf7e15070ca9f',
    },
    {
      localName: 'OFL.txt',
      remotePath: 'OFL.txt',
      sha256: '5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6',
    },
    {
      localName: 'METADATA.pb',
      remotePath: 'METADATA.pb',
      sha256: '3c201abfcd49b2b8f8b8ae6041bad70cdeb2ef03a1c5c0870772e137f1f450c0',
    },
  ],
});
/* @workflow
{
  "name": "font:devanagari:sync",
  "summary": "Synchronize the authenticated Devanagari fixture.",
  "requirements": "Network access to the pinned source.",
  "writes": "Checked-in font, metadata, and license."
}
*/
/* @workflow
{
  "name": "font:devanagari:check",
  "summary": "Verify the authenticated Devanagari fixture.",
  "requirements": "Checked-in authenticated fixture.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
