import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

// google/fonts ships only the variable build, which the baker rejects with
// UnsupportedVariableFont. The designers' own release carries static instances
// at the same commit google/fonts pins, so the fixture takes them from upstream
// and no font instancer enters the repository.
const commit = '02e4e15767f5b6c2109413429fc51879b9507ab4';
const directory = resolve('fixtures/fonts/playwrite-us-trad-1.003');
const check = process.argv.includes('--check');
const files = [
  {
    localName: 'PlaywriteUSTrad-Regular.ttf',
    remotePath: 'fonts/ttf/PlaywriteUSTrad-Regular.ttf',
    sha256: 'ac59d71c6487bee243777be1db788d8051d371e4d6ddf7798576e594908bfcf6',
  },
  {
    localName: 'PlaywriteUSTradGuides-Regular.ttf',
    remotePath: 'fonts/ttf/PlaywriteUSTradGuides-Regular.ttf',
    sha256: '1eac92a6a9349a33f9f6829ffc2c3c758ec91536e711427988a74099db395c82',
  },
  {
    localName: 'OFL.txt',
    remotePath: 'OFL.txt',
    sha256: '0370f5946020846b0ca65e44950d11411ea3bd3c4c0d755916470f9f96cd8cb8',
  },
] as const;

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/TypeTogether/Playwrite/${commit}`,
  check,
  directory,
  files,
});

/* @workflow
{
  "name": "font:playwrite:sync",
  "summary": "Synchronize the authenticated Playwrite US Trad fixture.",
  "requirements": "Network access to the pinned source.",
  "writes": "Checked-in static fonts and license."
}
*/
