import { resolve } from 'node:path';

import { syncImmutableFixture } from './support/immutable-fixture.mts';

const commit = '523d033d6cb47f4a80c58a35753646f5c3608a78';
const directory = resolve('fixtures/fonts/noto-sans-cjk-2.004');
const check = process.argv.includes('--check');

await syncImmutableFixture({
  baseUrl: `https://raw.githubusercontent.com/notofonts/noto-cjk/${commit}`,
  check,
  directory,
  files: [
    {
      localName: 'NotoSansCJKjp-Regular.otf',
      remotePath: 'Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
      sha256: '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5',
    },
    {
      localName: 'LICENSE.txt',
      remotePath: 'LICENSE',
      sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2',
    },
  ],
});
/* @workflow
{
  "name": "font:cjk:sync",
  "summary": "Synchronize the authenticated Noto CJK fixture.",
  "requirements": "Network access to the pinned source.",
  "writes": "Checked-in font, metadata, and license."
}
*/
/* @workflow
{
  "name": "font:cjk:check",
  "summary": "Verify the authenticated Noto CJK fixture.",
  "requirements": "Checked-in authenticated fixture.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
