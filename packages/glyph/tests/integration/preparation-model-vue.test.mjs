import '../support/wasm-crossings.mjs';
import { mountTres } from '../support/vue-tres-host.mjs';

import { h } from 'vue';
import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/vue';
import { adapterFont } from '../support/adapter-behavior.mjs';
import { preparationModel } from '../support/preparation-model.mjs';

await glyph.init();

preparationModel('Vue', async (labels) => {
  const font = await adapterFont();
  const components = [];
  const layoutListeners = [];
  const errorListeners = [];
  const capturedListeners = [];
  const host = await mountTres(() =>
    labels.map((text, index) =>
      h(
        Text,
        {
          key: index,
          font: font.face,
          ref: (value) => {
            if (value !== null) components[index] = value;
          },
          onLayout: (_text, layout) => layoutListeners[index]?.(layout),
          onError: (error) => errorListeners[index]?.(error),
        },
        () => text,
      ),
    ),
  );
  return {
    texts: components.map((component, index) => {
      const object = component.instance;
      return {
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
        paint: (color) => {
          object.style = { ...object.style, color };
        },
        move: () => {
          object.position.x += 10;
        },
        onLayout: (listener) => {
          layoutListeners[index] = listener;
        },
        // Vue routes an exception thrown by an event handler to `onErrorCaptured`, not to the `error` event,
        // so this host's listener hears both.
        onError: (listener) => {
          errorListeners[index] = listener;
          capturedListeners.push(listener);
        },
      };
    }),
    // The traversal the renderer performs once per frame.
    frame: () => {
      host.scene.updateMatrixWorld(true);
      for (const error of host.errors.splice(0)) for (const listener of capturedListeners) listener(error);
    },
    prepare: () => glyph.prepare(),
    unmount: async () => {
      await host.unmount();
      font.dispose();
    },
  };
});
