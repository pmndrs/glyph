/* @workflow {
  "name": "site:bake-wordmark",
  "summary": "Bake the landing wordmark face to the glyphs the mark draws, as Slug.",
  "requirements": "A built @pmndrs/glyph; pass --check to verify the checked-in artifact instead of writing it.",
  "writes": "site/landing/assets/playwrite-glyph.font.glb"
} */

import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The landing wordmark, `glÿph` set decomposed (y + U+0308) in Playwrite US Trad. The face is cursive, so the
 * subset closure pulls in the joining alternates the letters need; nothing else is kept.
 */
const run = promisify(execFile);
const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORDMARK = 'glÿph';
const unicodes = [...new Set([' ', ...WORDMARK])]
  .map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
  .join(',');

const { stdout } = await run(
  'pnpm',
  [
    'exec',
    'glyph',
    'bake',
    '--input',
    resolve(site, 'landing/sources/playwrite-us-trad-1.003/PlaywriteUSTrad-Regular.ttf'),
    '--output',
    resolve(site, 'landing/assets/playwrite-glyph.font.glb'),
    '--unicodes',
    unicodes,
    '--slug',
    ...(process.argv.includes('--check') ? ['--check'] : []),
  ],
  { cwd: site },
);
console.info(stdout.trim());
