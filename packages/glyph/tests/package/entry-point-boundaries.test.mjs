/**
 * Where a name lives, and why.
 *
 * The package publishes one root integration vocabulary and several renderer subpaths. A name has
 * exactly one home, so a reader never has to guess which subpath to import it from:
 *
 *   `.`        what text IS -- fonts, authoring, layout and measurement types, raster techniques,
 *              paint. Every consumer speaks it, whether they render with Three.js or drive the
 *              engine themselves.
 *   `.`        also carries the GlyphConfig, Codec, schema, and technique DSL required to build an
 *              integration. Backend/planner/wire implementation details have no package subpath.
 *   `./three`  the Three.js integration -- `Text`, `TextGroup`, `FontLoader`, materials.
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

test('GlyphConfig is the only public engine-integration surface', async () => {
  const root = published(await declaration('index.d.ts'));
  const manifest = JSON.parse(await declaration('../package.json'));
  assert.equal(manifest.exports['./core'], undefined, 'backend/planner internals must not have a public subpath');
  for (const name of [
    'defineGlyphConfig',
    'defineGlyphSchema',
    'compileCodec',
    'createRasterCodecProgram',
    'techniqueProgram',
  ]) {
    assert.equal(root.has(name), true, `the root integration DSL must publish ${name}`);
  }
  for (const retired of ['compileRenderPolicy', 'createRasterPolicyProgram', 'definePolicyBuffers', 'policyProgram']) {
    assert.equal(root.has(retired), false, `the root integration DSL must not publish retired ${retired}`);
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
            'three/font-loader.d.ts',
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
