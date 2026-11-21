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
        },
        () => text,
      ),
    ),
  );
  return {
    texts: components.map((component) => {
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
      };
    }),
    // The traversal the renderer performs once per frame.
    frame: () => host.scene.updateMatrixWorld(true),
    unmount: async () => {
      await host.unmount();
      font.dispose();
    },
  };
});
