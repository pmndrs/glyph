/**
 * Where a name lives, and why.
 *
 * The package publishes one application vocabulary, renderer subpaths, and leaf integration helpers.
 * A name has exactly one home, so a reader never has to guess which subpath to import it from:
 *
 *   `.`        what text IS -- fonts, authoring, layout and measurement types, raster formats,
 *              paint. Every consumer speaks it, whether they render with Three.js or drive the
 *              engine themselves.
 *   `.`        also carries the types applications can encounter through GlyphConfig and handles.
 *   `./config/*` carries renderer-neutral construction helpers for integration authors without
 *              charging every application for the complete integration DSL.
 *   `./three`  the Three.js integration -- `ThreeConfig`, `Text`, `TextGroup`, materials.
 *
 * An integration may re-export a root name ONLY when that name appears in one of its own
 * signatures, because a caller should be able to name what `layout()` returns without
 * reaching for a second subpath. Re-exporting anything else duplicates the vocabulary and makes the
 * import site a coin toss.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const declaration = async (path) => readFile(new URL(`../../dist/${path}`, import.meta.url), 'utf8');

/** Every name a declaration file publishes, including re-exports. */
function published(source) {
  const names = new Set();
  for (const [, body] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gs)) {
    for (const part of body.split(',')) {
      const name = part.trim().split(' as ').at(-1)?.trim();
      if (name && name !== 'type') names.add(name);
    }
  }
  for (const [, name] of source.matchAll(
    /export\s+declare\s+(?:abstract\s+)?(?:class|function|const)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(name);
  }
  return names;
}

test('application types stay at root while integration construction lives on config leaves', async () => {
  const root = published(await declaration('index.d.ts'));
  const manifest = JSON.parse(await declaration('../package.json'));
  assert.equal(manifest.exports['./core'], undefined, 'handle/planner internals must not have a public subpath');
  assert.ok(manifest.exports['./config/*'], 'renderer-neutral integration leaves must be public');

  for (const name of ['GlyphConfig', 'Codec', 'TechniqueSchema', 'RasterFormat']) {
    assert.equal(root.has(name), true, `applications must be able to name ${name} from the root`);
  }

  const leaves = {
    'config/glyph.d.ts': ['defineGlyphConfig', 'defineGlyphSchema', 'resourceLease'],
    'config/codec.d.ts': ['compileCodec', 'createCodecProgram', 'id'],
    'config/codec-program.d.ts': ['codecProgram', 'f32', 'techniqueProgram', 'u32'],
    'config/raster.d.ts': ['compileRasterFont', 'createRasterCodecProgram', 'registerRasterPlanProgram'],
    'config/raster-format.d.ts': ['defineRasterFormat', 'defineRasterResourceId'],
    'config/resources.d.ts': ['assertPortableResource', 'definePortableVertexSemantic'],
    'config/schema.d.ts': ['defineCodecBuffers', 'defineTechniqueSchema'],
  };
  for (const [path, names] of Object.entries(leaves)) {
    const leaf = published(await declaration(path));
    for (const name of names) {
      assert.equal(leaf.has(name), true, `${path} must publish ${name}`);
      assert.equal(root.has(name), false, `runtime integration helper ${name} must not leak through the root`);
    }
  }
  for (const retired of ['compileRenderPolicy', 'createRasterPolicyProgram', 'definePolicyBuffers', 'policyProgram']) {
    assert.equal(root.has(retired), false, `the public integration surface must not publish retired ${retired}`);
  }
});

test('integrations re-export root names only when their own signatures use them', async () => {
  const root = published(await declaration('index.d.ts'));
  const entries = [
    {
      name: './three',
      entry: await declaration('three.d.ts'),
      body: (
        await Promise.all(
          [
            'three/text.d.ts',
            'three/glyphs.d.ts',
            'three/decorations.d.ts',
            'three/glyph-measurement.d.ts',
            'three/material.d.ts',
            'three/frame-error.d.ts',
          ].map(declaration),
        )
      ).join('\n'),
    },
    {
      name: './react',
      entry: await declaration('react.d.ts'),
      body: (await declaration('react.d.ts')).replaceAll(/export\s+(?:type\s+)?\{[^}]*\}\s+from\s+[^;]+;/gs, ''),
    },
  ];

  for (const { name, entry, body } of entries) {
    const gratuitous = [...published(entry)]
      .filter((exported) => root.has(exported))
      .filter((exported) => !new RegExp(`\\b${exported.replaceAll(/[$]/g, '\\$')}\\b`).test(body))
      .sort();
    assert.deepEqual(
      gratuitous,
      [],
      `\`${name}\` re-exports these root names without naming them in any of its own signatures, so ` +
        `they are a second home for the same vocabulary. Import them from \`@pmndrs/glyph\` instead: ` +
        gratuitous.join(', '),
    );
  }
});
