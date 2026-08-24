/**
 * Where a name lives, and why.
 *
 * The package publishes one vocabulary and several integrations. A name has exactly one home, so a
 * reader never has to guess which subpath to import it from:
 *
 *   `.`        what text IS -- fonts, authoring, layout and measurement types, raster techniques,
 *              paint. Every consumer speaks it, whether they render with Three.js or drive the
 *              engine themselves.
 *   `./core`   how to DRIVE the engine -- the policy contract, the render plan, the frame wire and
 *              its handoff. Additive to the root rather than parallel to it: an integrator imports
 *              both. It shares no name with the root, and that is enforced below.
 *   `./three`  the Three.js integration -- `Text`, `TextGroup`, `FontLoader`, materials.
 *
 * An integration may re-export a root name ONLY when that name appears in one of its own
 * signatures, because a caller should be able to name what `measureLayout()` returns without
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
  for (const [, name] of source.matchAll(/export\s+declare\s+(?:abstract\s+)?(?:class|function|const)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(name);
  }
  return names;
}

test('the root vocabulary and the engine surface share no name', async () => {
  const root = published(await declaration('index.d.ts'));
  const core = published(await declaration('core.d.ts'));
  const shared = [...root].filter((name) => core.has(name)).sort();
  assert.deepEqual(
    shared,
    [],
    `\`.\` and \`./core\` must stay disjoint: the root says what text is, core says how to drive the ` +
      `engine, and an integrator imports both. Shared: ${shared.join(', ')}`,
  );
});

test('an integration re-exports a root name only when its own signatures use it', async () => {
  const root = published(await declaration('index.d.ts'));
  const entry = await declaration('three.d.ts');
  const signatures = await Promise.all(
    ['three/text.d.ts', 'three/font-loader.d.ts', 'three/material.d.ts', 'three/frame-error.d.ts'].map(declaration),
  );
  const body = signatures.join('\n');
  const gratuitous = [...published(entry)]
    .filter((name) => root.has(name))
    .filter((name) => !new RegExp(`\\b${name.replaceAll(/[$]/g, '\\$')}\\b`).test(body))
    .sort();
  assert.deepEqual(
    gratuitous,
    [],
    `\`./three\` re-exports these root names without naming them in any of its own signatures, so ` +
      `they are a second home for the same vocabulary. Import them from \`@pmndrs/glyph\` instead: ` +
      gratuitous.join(', '),
  );
});
