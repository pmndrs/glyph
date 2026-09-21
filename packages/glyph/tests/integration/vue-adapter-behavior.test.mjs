import { mountTres, nextTick } from '../support/vue-tres-host.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { h, reactive, shallowRef } from 'vue';
import { useTresContext } from '@tresjs/core';
import { glyph } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/vue';
import { adapterBehavior, adapterFont } from '../support/adapter-behavior.mjs';

await glyph.init();

adapterBehavior('Vue', async (initial) => {
  const current = shallowRef(initial);
  let component;
  let groupComponent;
  let requests = 0;
  const ref = (value) => {
    if (value !== null) component = value;
  };
  const Probe = {
    setup() {
      const { renderer } = useTresContext();
      const invalidate = renderer.invalidate;
      renderer.invalidate = (...args) => {
        requests += 1;
        invalidate(...args);
      };
      return () => {
        const { text, style, group, ...props } = current.value;
        const paragraph = () => h(Text, { ...props, textStyle: style, ref }, () => text);
        return group === undefined
          ? paragraph()
          : h(
              TextGroup,
              {
                ...group,
                ref: (value) => {
                  groupComponent = value;
                },
              },
              paragraph,
            );
      };
    },
  };
  const host = await mountTres(() => h(Probe));
  return {
    get text() {
      return component?.instance;
    },
    get group() {
      return groupComponent?.instance;
    },
    get frameRequests() {
      return requests;
    },
    resetFrameRequests() {
      requests = 0;
    },
    async update(props) {
      current.value = props;
      await nextTick();
      assert.deepEqual(host.errors, []);
    },
    async settle(promise) {
      await promise;
      await nextTick();
      assert.deepEqual(host.errors, []);
    },
    unmount: () => host.unmount(),
  };
});

test('Vue tracks in-place root and nested reactive property changes', async () => {
  const font = await adapterFont();
  const style = reactive({ fontSize: 16, decoration: { underline: true } });
  const constraints = reactive({ width: { mode: 'exact', size: 200 } });
  const inline = reactive({ fontSize: 18, decoration: { underline: true } });
  const revision = shallowRef(0);
  let component;
  const host = await mountTres(() =>
    h(
      Text,
      {
        font: font.face,
        name: `snapshot-${revision.value}`,
        textStyle: style,
        constraints,
        ref: (value) => {
          component = value;
        },
      },
      () => ['a', h(Text, { textStyle: inline }, () => '\u0301b')],
    ),
  );
  try {
    const object = component.instance;
    const previous = object.style;
    const acceptedMeasurement = object.measure();
    revision.value += 1;
    await nextTick();
    assert.equal(object.style, previous, 'an unrelated re-render must reuse the accepted reactive snapshot');
    assert.equal(
      object.measure(),
      acceptedMeasurement,
      'fresh equivalent nested text must retain accepted measurement',
    );
    style.fontSize = 24;
    style.decoration.underline = false;
    constraints.width.size = 100;
    inline.decoration.underline = false;
    inline.fontSize = 32;
    await nextTick();
    assert.deepEqual(host.errors, []);
    assert.deepEqual(object.style, { fontSize: 24, decoration: { underline: false } });
    assert.equal(object.constraints.width.size, 100);
    assert.equal(previous.decoration.underline, true);
    assert.equal(object.glyphs().glyphFontSizes.at(-1), 32);
  } finally {
    await host.unmount();
    font.dispose();
  }
});
