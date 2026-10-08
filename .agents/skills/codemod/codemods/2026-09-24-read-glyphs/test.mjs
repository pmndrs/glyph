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
  test(`readGlyphs migration: ${mode}`, async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'glyph-read-codemod-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const sourcePath =
      mode === 'repository' ? 'packages/glyph/src/text.ts' : 'node_modules/@pmndrs/glyph/dist/index.d.ts';
    const declarationPath = path.join(root, sourcePath);
    await mkdir(path.dirname(declarationPath), { recursive: true });
    const method = mode === 'installed-new' ? 'readGlyphs' : 'withGlyphs';
    const declaration = `export interface Text { ${method}<T>(read: (view: { glyphCount: number }) => T): T; }\n`;
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
const count: number = text.withGlyphs(view => view.glyphCount);
const optional: number | undefined = maybe?.withGlyphs(view => view.glyphCount);
const method = text.withGlyphs;
const unrelated = { withGlyphs() { return 1; } };
unrelated.withGlyphs();
const protocol = 'withGlyphs';
// withGlyphs preserves the callback result.
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
    assert.match(after, /text\.readGlyphs\(view => view.glyphCount\)/);
    assert.match(after, /maybe\?\.readGlyphs\(view => view.glyphCount\)/);
    assert.match(after, /const method = text\.readGlyphs;/);
    assert.match(after, /unrelated\.withGlyphs\(\)/);
    assert.match(after, /const protocol = 'withGlyphs'/);
    if (mode === 'repository') {
      assert.match(await readFile(declarationPath, 'utf8'), /readGlyphs<T>/);
      assert.match(after, /\/\/ readGlyphs preserves/);
    } else {
      assert.equal(await readFile(declarationPath, 'utf8'), declaration);
      // Typecheck the migrated caller against the upgraded package without changing the migration's input proof.
      await writeFile(declarationPath, declaration.replace('withGlyphs', 'readGlyphs'));
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
