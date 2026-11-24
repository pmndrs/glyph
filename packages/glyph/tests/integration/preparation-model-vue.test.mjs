import '../support/wasm-crossings.mjs';
import { mountTres } from '../support/vue-tres-host.mjs';

import { h } from 'vue';
import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/vue';
import { adapterFont } from '../support/adapter-behavior.mjs';
import { preparationModel } from '../support/preparation-model.mjs';
import { renderScene } from '../support/three-render.mjs';

await glyph.init();

preparationModel('Vue', async (labels) => {
  const font = await adapterFont();
  const components = [];
  const layoutListeners = [];
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
      };
    }),
    // Vue routes an exception thrown by an event handler to `onErrorCaptured` during the frame, never through the
    // emitting text; this host rethrows what its error handler captured as the frame's own.
    frame: () => {
      renderScene(host.scene);
      const [error] = host.errors.splice(0);
      if (error !== undefined) throw error;
    },
    prepare: () => glyph.prepare(),
    unmount: async () => {
      await host.unmount();
      font.dispose();
    },
  };
});
