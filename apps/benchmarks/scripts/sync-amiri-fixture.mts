import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = '39d11bc313031c9f68e21a297ce5e4a15cc5365e';
const directory = resolve('fixtures/fonts/amiri-1.002');
const check = process.argv.includes('--check');
const files = [
  {
    localName: 'Amiri-Regular.ttf',
    remotePath: 'Amiri-Regular.ttf',
    sha256: 'ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7',
  },
  {
    localName: 'OFL.txt',
    remotePath: 'OFL.txt',
    sha256: '72de68e5954f4fdd24702292ef5a32f003ca960ec9330dc86e5eefb5dffb9b22',
  },
  {
    localName: 'METADATA.pb',
    remotePath: 'METADATA.pb',
    sha256: '3df4f62489d9b01bb900d36e73120c06dfed0c49b585ff4398fd8a11410fd114',
  },
] as const;

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/amiri`,
  check,
  directory,
  files,
});
