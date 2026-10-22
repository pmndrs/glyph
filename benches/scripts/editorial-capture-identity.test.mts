import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertEditorialCaptureIdentity,
  type EditorialCaptureIdentity,
} from './support/editorial-capture-identity.mts';

const candidate: EditorialCaptureIdentity = {
  scenario: { editorialPixelRole: 'candidate', requestedBackend: 'webgpu', observedBackend: 'webgpu' },
  archive: { archiveSha256: 'c'.repeat(64), packageRoot: '/candidate/node_modules/@pmndrs/glyph' },
  editorialPixelCapture: { state: { backend: 'webgpu' } },
};
const reference: EditorialCaptureIdentity = {
  scenario: { editorialPixelRole: 'cold-main', requestedBackend: 'webgpu', observedBackend: 'webgpu' },
  archive: { archiveSha256: 'b'.repeat(64), packageRoot: '/main/node_modules/@pmndrs/glyph' },
  editorialPixelCapture: { state: { backend: 'webgpu' } },
};

test('editorial comparison binds both captures to externally pinned archive identities', () => {
  assert.doesNotThrow(() => assertEditorialCaptureIdentity(candidate, reference, 'c'.repeat(64), 'b'.repeat(64)));
  assert.throws(() => assertEditorialCaptureIdentity(candidate, reference, 'a'.repeat(64), 'b'.repeat(64)), /pinned/u);
  assert.throws(() => assertEditorialCaptureIdentity(candidate, reference, 'c'.repeat(64), 'a'.repeat(64)), /pinned/u);
  assert.throws(
    () =>
      assertEditorialCaptureIdentity(
        candidate,
        { ...reference, archive: candidate.archive },
        'c'.repeat(64),
        'c'.repeat(64),
      ),
    /distinct/u,
  );
});

test('editorial comparison rejects a mislabeled role or a backend that did not render', () => {
  assert.throws(
    () =>
      assertEditorialCaptureIdentity(
        { ...candidate, scenario: { ...candidate.scenario, editorialPixelRole: 'cold-main' } },
        reference,
        'c'.repeat(64),
        'b'.repeat(64),
      ),
    /roles/u,
  );
  assert.throws(
    () =>
      assertEditorialCaptureIdentity(
        { ...candidate, editorialPixelCapture: { state: { backend: 'webgl2' } } },
        reference,
        'c'.repeat(64),
        'b'.repeat(64),
      ),
    /backend/u,
  );
});
