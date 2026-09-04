/** A name has exactly one home: `.` for the application vocabulary, `./config/*` for renderer-neutral integration helpers, `./three` for the Three.js integration. An integration re-exports a root name only when it appears in its own signatures. */
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
  assert.equal(manifest.exports['./loader'], null, 'the legacy low-level font loader must remain package-private');
  assert.equal(
    manifest.exports['./config/font-library'],
    null,
    'the internal FontLibrary must not become a second public font API',
  );
  assert.ok(manifest.exports['./config/*'], 'renderer-neutral integration leaves must be public');

  for (const name of ['GlyphConfig', 'Codec', 'TechniqueSchema', 'RasterFormat']) {
    assert.equal(root.has(name), true, `applications must be able to name ${name} from the root`);
  }
  for (const retiredRootName of ['loadFont', 'createFontLibrary', 'FontLibrary', 'createParagraph', 'Paragraph']) {
    assert.equal(root.has(retiredRootName), false, `root must not publish retired API ${retiredRootName}`);
  }

  const leaves = {
    'config/glyph.d.ts': ['defineGlyphConfig', 'defineGlyphSchema', 'resourceLease'],
    'config/codec.d.ts': ['compileCodec', 'createCodecProgram', 'id', 'normalizeCodecCapabilitySet'],
    'config/codec-program.d.ts': ['codecProgram', 'f32', 'techniqueProgram', 'u32'],
    'config/raster.d.ts': ['compileRasterFont', 'createRasterCodecProgram', 'isRasterCodec', 'registerRasterCodec'],
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

  const codecLeaf = published(await declaration('config/codec.d.ts'));
  for (const packageOwned of [
    'GlyphIdScope',
    'CodecIdScope',
    'assertGlyphId',
    'assertCodecIdFactory',
    'selectCodecCapabilitySet',
  ]) {
    assert.equal(codecLeaf.has(packageOwned), false, `config/codec.d.ts must not publish ${packageOwned}`);
  }

  const privateLeafHelpers = {
    'config/codec-program.d.ts': ['assertTechniqueCodecBody', 'normalizeCodecProgramSystemBuffers'],
    'config/raster.d.ts': ['registerGlyphRasterCodec', 'resolveRasterCodec'],
    'config/raster-format.d.ts': ['isRasterFormat', 'rasterFormatForKey', 'rasterFormatForReference'],
  };
  for (const [path, names] of Object.entries(privateLeafHelpers)) {
    const leaf = published(await declaration(path));
    for (const name of names) {
      assert.equal(leaf.has(name), false, `${path} must not publish package-owned helper ${name}`);
    }
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
