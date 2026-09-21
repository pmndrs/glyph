import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, Suspense } from 'react';
import { create, act } from '@react-three/test-renderer/webgpu';
import { glyph } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/react';
import { adapterBehavior, adapterFont } from '../support/adapter-behavior.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
await glyph.init();

async function mountReactAdapter(initial) {
  let object;
  let groupObject;
  let requests = 0;
  const ref = (value) => {
    if (value !== null) object = value;
  };
  const tree = ({ text, group, ...props }) => {
    const paragraph = createElement(Text, { ...props, ref }, text);
    return createElement(
      Suspense,
      { fallback: null },
      group === undefined
        ? paragraph
        : createElement(
            TextGroup,
            {
              ...group,
              ref: (value) => {
                groupObject = value;
              },
            },
            paragraph,
          ),
    );
  };
  const renderer = await create(tree(initial), {
    frameloop: 'demand',
    onCreated(state) {
      const invalidate = state.invalidate;
      state.set({
        invalidate: (...args) => {
          requests += 1;
          invalidate(...args);
        },
      });
    },
  });
  return {
    get text() {
      return object;
    },
    get group() {
      return groupObject;
    },
    get frameRequests() {
      return requests;
    },
    resetFrameRequests() {
      requests = 0;
    },
    update: (props) => renderer.update(tree(props)),
    async settle(promise) {
      await act(async () => {
        await promise;
      });
    },
    unmount: () => renderer.unmount(),
  };
}

adapterBehavior('React', mountReactAdapter);

test('React compares fresh props with accepted state after caller-owned input mutates in place', async () => {
  const font = await adapterFont();
  const style = { fontSize: 16, decoration: { underline: true } };
  const initial = { font: font.face, text: 'authoritative state', style };
  const host = await mountReactAdapter(initial);
  try {
    style.fontSize = 48;
    style.decoration.underline = false;
    await host.update(initial);
    assert.deepEqual(
      host.text.style,
      { fontSize: 16, decoration: { underline: true } },
      'mutating stable React props must not rewrite accepted engine state',
    );

    await host.update({
      ...initial,
      style: { fontSize: 48, decoration: { underline: false } },
    });
    assert.deepEqual(
      host.text.style,
      { fontSize: 48, decoration: { underline: false } },
      'a fresh legitimate update must not be swallowed by mutated caller input',
    );
  } finally {
    await host.unmount();
    font.dispose();
  }
});
