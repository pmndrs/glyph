import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const recipe = fileURLToPath(new URL('.', import.meta.url));

for (const mode of ['repository', 'installed-old', 'installed-new']) {
  test(`split migration: ${mode}`, async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'glyph-split-codemod-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const sourcePath =
      mode === 'repository' ? 'packages/glyph/src/text.ts' : 'node_modules/@pmndrs/glyph/dist/index.d.ts';
    const declarationPath = path.join(root, sourcePath);
    await mkdir(path.dirname(declarationPath), { recursive: true });
    const method = mode === 'installed-new' ? 'split' : 'breakApart';
    const declaration = `export interface Text { ${method}(): readonly [number, number | undefined]; }\n`;
    await writeFile(declarationPath, declaration);
    const specifier = mode === 'repository' ? './packages/glyph/src/text' : '@pmndrs/glyph';
    if (mode !== 'repository') {
      await writeFile(
        path.join(root, 'node_modules/@pmndrs/glyph/package.json'),
        JSON.stringify({ types: './dist/index.d.ts' }),
      );
    }
    const projectPath = path.join(root, 'tsconfig.json');
    await writeFile(
      projectPath,
      JSON.stringify({
        compilerOptions: { strict: true, module: 'commonjs', skipLibCheck: true },
        include: ['index.ts', 'packages/**/*.ts'],
      }),
    );
    const before = `import type { Text } from '${specifier}';
declare const text: Text;
declare const maybe: Text | undefined;
const [glyphs, decorations] = text.breakApart();
const optional: readonly [number, number | undefined] | undefined = maybe?.breakApart();
const method = text.breakApart;
const unrelated = { breakApart() { return 1; } };
unrelated.breakApart();
const protocol = 'breakApart';
// breakApart returns independent copies.
`;
    const entry = path.join(root, 'index.ts');
    await writeFile(entry, before);
    const options = { codemod: recipe, project: projectPath, target: root };
    const dry = await runCodemod(options);
    assert.ok(dry.changedFiles.includes(entry));
    assert.equal(await readFile(entry, 'utf8'), before);
    assert.equal(await readFile(declarationPath, 'utf8'), declaration);
    await runCodemod({ ...options, write: true });
    const after = await readFile(entry, 'utf8');
    assert.match(after, /text\.split\(\)/);
    assert.match(after, /maybe\?\.split\(\)/);
    assert.match(after, /const method = text\.split;/);
    assert.match(after, /unrelated\.breakApart\(\)/);
    assert.match(after, /const protocol = 'breakApart'/);
    if (mode === 'repository') {
      assert.match(await readFile(declarationPath, 'utf8'), /split\(\)/);
      assert.match(after, /\/\/ split returns/);
    } else {
      assert.equal(await readFile(declarationPath, 'utf8'), declaration);
      // Typecheck the migrated caller against the upgraded package without changing the migration's input proof.
      await writeFile(declarationPath, declaration.replace('breakApart', 'split'));
    }
    const project = new Project({ tsConfigFilePath: projectPath });
    assert.equal(
      project.getPreEmitDiagnostics().length,
      0,
      project.formatDiagnosticsWithColorAndContext(project.getPreEmitDiagnostics()),
    );
    assert.deepEqual((await runCodemod(options)).changedFiles, []);
  });
}
