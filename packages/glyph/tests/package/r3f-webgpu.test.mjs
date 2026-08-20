import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageManifest = new URL('../../package.json', import.meta.url);
const reactSource = new URL('../../src/react.ts', import.meta.url);

test('pins the R3F v10 WebGPU entry', async () => {
  // R3F is client-only: its WebGPU entry reaches three's Inspector, which reads `localStorage` at
  // module scope. The shim supplies that global so a Node process can load the entry at all.
  await import('../support/browser-globals.mjs');

  const fiber = await import('@react-three/fiber/webgpu');
  const testRenderer = await import('@react-three/test-renderer/webgpu');
  const [manifestText, source] = await Promise.all([readFile(packageManifest, 'utf8'), readFile(reactSource, 'utf8')]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.devDependencies['@react-three/fiber'], '10.0.0-alpha.3');
  assert.equal(manifest.peerDependencies['@react-three/fiber'], '>=10.0.0-alpha.3 <11');
  assert.equal(typeof fiber.createRoot, 'function');
  assert.equal(typeof testRenderer.default.create, 'function');
  assert.match(source, /from '@react-three\/fiber\/webgpu'/);
  assert.doesNotMatch(source, /from '@react-three\/fiber'/);
});
