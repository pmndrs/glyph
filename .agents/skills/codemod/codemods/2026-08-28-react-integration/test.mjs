import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-react-codemod-'));
try {
  await mkdir(path.join(root, 'recipe'));
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { jsx: 'react-jsx', module: 'preserve', moduleResolution: 'bundler' },
      include: ['*.tsx'],
    }),
  );
  await writeFile(
    path.join(root, 'usage.tsx'),
    [
      "import { createUseFont, Text, TextSpan, type BoundUseFont } from '@pmndrs/glyph/react';",
      "import { useBitmapFont } from '@pmndrs/glyph/react/bitmap';",
      "import { useMSDF } from '@pmndrs/glyph/react/msdf';",
      'const request = { input, raster: { technique, options } };',
      'const hook: BoundUseFont = createUseFont(library);',
      'const font = hook(request);',
      'useBitmapFont.preload(library, input, options);',
      'useMSDF.preload(input, options);',
      'const run = <Text><TextSpan paint={paint}>hello</TextSpan></Text>;',
      "const protocol = 'TextSpan';",
      '',
    ].join('\n'),
  );
  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-react-integration');
  const result = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.equal(result.changedFiles.length, 1);
  const output = await readFile(path.join(root, 'usage.tsx'), 'utf8');
  assert.match(output, /type UseFont/);
  assert.match(output, /const hook: UseFont = useFont/);
  assert.match(output, /useFont\(input, technique, options\)/);
  assert.match(output, /useBitmapFont\.preload\(input, options\)/);
  assert.match(output, /useMSDF\.preload\(input, options\)/);
  assert.match(output, /<Text paint=\{paint\}>hello<\/Text>/);
  assert.match(output, /'TextSpan'/);
  assert.doesNotMatch(output, /createUseFont/);
  const repeated = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(repeated.changedFiles, []);
} finally {
  await rm(root, { recursive: true, force: true });
}
