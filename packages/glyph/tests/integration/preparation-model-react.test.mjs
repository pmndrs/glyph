import '../support/wasm-crossings.mjs';

import { createElement, Suspense } from 'react';
import { create } from '@react-three/test-renderer/webgpu';
import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { adapterFont } from '../support/adapter-behavior.mjs';
import { preparationModel } from '../support/preparation-model.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
await glyph.init();

preparationModel('React', async (labels) => {
  const font = await adapterFont();
  const objects = [];
  const renderer = await create(
    createElement(
      Suspense,
      { fallback: null },
      labels.map((text, index) =>
        createElement(
          Text,
          {
            key: index,
            font: font.face,
            ref: (value) => {
              if (value !== null) objects[index] = value;
            },
          },
          text,
        ),
      ),
    ),
    { frameloop: 'never' },
  );
  return {
    texts: objects.map((object) => ({
      object,
      value: () => object.text,
      set: (text) => {
        object.text = text;
      },
      setStyle: (style) => {
        object.style = style;
      },
      read: () => object.measure(),
      committed: () => object.commitState().status === 'committed',
    })),
    // The traversal `renderer.render(scene, camera)` performs once per frame.
    frame: () => renderer.scene.instance.updateMatrixWorld(true),
    unmount: async () => {
      await renderer.unmount();
      font.dispose();
    },
  };
});
