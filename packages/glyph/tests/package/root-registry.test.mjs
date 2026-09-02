import assert from 'node:assert/strict';
import test from 'node:test';

import { createGlyphRootRegistry } from '../../dist/core.js';

test('a Glyph root registry owns one anonymous root and idempotent live named roots', () => {
  const created = [];
  const disposed = [];
  const roots = createGlyphRootRegistry((name, release) => {
    const root = {
      name,
      disposed: false,
      dispose() {
        if (root.disposed) return;
        root.disposed = true;
        disposed.push(root);
        release();
      },
    };
    created.push(root);
    return root;
  });

  assert.equal(created.length, 1, 'construction eagerly creates exactly the anonymous root');
  assert.equal(roots.anonymous.name, undefined);
  const hud = roots.get('hud');
  assert.equal(roots.get('hud'), hud, 'the same live name returns the same root');
  assert.notEqual(hud, roots.anonymous, 'named roots are siblings of the anonymous root');
  assert.throws(() => roots.get(''), /nonempty string/);
  assert.throws(() => roots.get('   '), /nonempty string/);

  hud.dispose();
  const replacement = roots.get('hud');
  assert.notEqual(replacement, hud, 'disposing a named root releases its lookup key for explicit recreation');
  assert.equal(replacement.name, 'hud');

  roots.dispose();
  assert.equal(roots.anonymous.disposed, true);
  assert.equal(replacement.disposed, true);
  assert.equal(disposed.length, 3);
  roots.dispose();
  assert.equal(disposed.length, 3, 'registry disposal is idempotent');
  assert.throws(() => roots.get('late'), /disposed/);
});

test('a Glyph root registry rejects factories that change the selected root identity', () => {
  assert.throws(
    () =>
      createGlyphRootRegistry((_name, _release) => ({
        name: 'wrong',
        disposed: false,
        dispose() {},
      })),
    /preserve the selected name/,
  );
});
