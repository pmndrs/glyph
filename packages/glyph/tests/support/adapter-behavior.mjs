import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bitmap, glyph } from '@pmndrs/glyph';
import { defineTextMaterial } from '@pmndrs/glyph/three';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

export async function adapterFont({ pending = false } = {}) {
  const bytes = await readFile(fontUrl);
  const gate = Promise.withResolvers();
  class Source extends Blob {
    async arrayBuffer() {
      await gate.promise;
      return super.arrayBuffer();
    }
  }
  const face = glyph.fontFace(new Source([bytes]), { format: bitmap({ strikes: [16] }) });
  if (!pending) {
    gate.resolve();
    await face.load();
  }
  return { face, release: () => gate.resolve(), dispose: () => face.dispose() };
}

// Both adapters run exactly these assertions through their real framework renderer.
// The host only translates props, flushes the framework, and observes frame requests.
export function adapterBehavior(name, mount) {
  test(`${name}: group material changes request an on-demand frame`, async () => {
    const font = await adapterFont();
    const first = defineTextMaterial((context) => context.createDefaultMaterial());
    const second = defineTextMaterial((context) => context.createDefaultMaterial());
    const props = { font: font.face, text: 'group', group: { material: first } };
    const host = await mount(props);
    try {
      host.resetFrameRequests();
      await host.update({ ...props, group: { material: second } });
      assert.equal(host.group.material, second);
      assert.ok(host.frameRequests > 0, 'an imperative group change must request a frame');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: replacing and removing paragraph props restores default state`, async () => {
    const font = await adapterFont();
    const material = defineTextMaterial((context) => context.createDefaultMaterial());
    const initial = {
      font: font.face,
      text: 'props',
      style: [{ fontSize: 16 }, false, { fontSize: 24, color: '#ff0000' }],
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 200 } },
      rasterPixelRatio: 2,
      material,
    };
    const host = await mount(initial);
    const object = host.text;
    try {
      assert.deepEqual(object.style, { fontSize: 24, color: '#ff0000' });
      assert.equal(object.material, material);
      await host.update({ font: font.face, text: 'reset' });
      assert.equal(host.text, object);
      assert.equal(object.text, 'reset');
      assert.deepEqual(object.style, {});
      assert.deepEqual(object.layout, {});
      assert.deepEqual(object.constraints, {});
      assert.equal(object.rasterPixelRatio, 1);
      assert.equal(object.material, undefined);
      await host.update(initial);
      assert.deepEqual(object.style, { fontSize: 24, color: '#ff0000' });
      assert.equal(object.material, material);
    } finally {
      await host.unmount();
      font.dispose();
    }
    assert.equal(object.disposed, true);
  });

  test(`${name}: paragraph changes request an on-demand frame`, async () => {
    const font = await adapterFont();
    const initial = { font: font.face, text: 'before' };
    const host = await mount(initial);
    try {
      for (const changed of [
        { text: 'after' },
        { style: { fontSize: 24 } },
        { constraints: { width: { mode: 'exact', size: 120 } } },
      ]) {
        host.resetFrameRequests();
        await host.update({ ...initial, ...changed });
        assert.ok(host.frameRequests > 0, 'an imperative paragraph change must request a frame');
      }
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: malformed PropertyList input throws at the framework update`, async () => {
    const font = await adapterFont();
    const initial = { font: font.face, text: 'invalid style' };
    const host = await mount(initial);
    try {
      await assert.rejects(
        () => host.update({ ...initial, style: 5 }),
        /Text style must be an object or property array/u,
      );
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: loaded and pending font switches retain a live paragraph and release leases`, async () => {
    const first = await adapterFont();
    const second = await adapterFont();
    const pending = await adapterFont({ pending: true });
    const host = await mount({ font: first.face, text: 'first' });
    const object = host.text;
    try {
      const firstLease = object.font;
      await host.update({ font: second.face, text: 'second' });
      assert.equal(host.text, object);
      assert.equal(firstLease.disposed, true);
      const secondLease = object.font;
      await host.update({ font: pending.face, text: 'third' });
      assert.equal(object.disposed, false);
      assert.equal(secondLease.disposed, false);
      assert.equal(object.text, 'second', 'pending input must not publish a partial paragraph');
      pending.release();
      await host.settle(pending.face.load());
      assert.equal(host.text.text, 'third');
      assert.equal(host.text.disposed, false);
      assert.equal(host.text.font.disposed, false);
      if (host.text !== object) assert.equal(object.disposed, true);
      assert.equal(secondLease.disposed, true);
    } finally {
      pending.release();
      await host.unmount();
      first.dispose();
      second.dispose();
      pending.dispose();
    }
    assert.equal(object.disposed, true);
  });

  test(`${name}: a re-render with an identical paragraph snapshot does not request a frame`, async () => {
    const font = await adapterFont();
    const initial = {
      font: font.face,
      text: 'same',
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 200 } },
    };
    const host = await mount(initial);
    try {
      host.resetFrameRequests();
      await host.update({ ...initial, style: { fontSize: 16 }, constraints: { width: { mode: 'exact', size: 200 } } });
      assert.equal(host.frameRequests, 0, 'an unchanged paragraph must not request a frame');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: equivalent PropertyList shapes do not republish paragraph state`, async () => {
    const font = await adapterFont();
    const initial = {
      font: font.face,
      text: 'same shape',
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 200 } },
    };
    const host = await mount(initial);
    const object = host.text;
    const set = object.set.bind(object);
    let semanticUpdates = 0;
    object.set = (update) => {
      semanticUpdates += 1;
      return set(update);
    };
    try {
      host.resetFrameRequests();
      await host.update({
        ...initial,
        style: [false, { fontSize: 12 }, { fontSize: 16 }],
        constraints: [{ width: { mode: 'at-most', size: 100 } }, initial.constraints],
      });
      assert.equal(semanticUpdates, 0);
      assert.equal(host.frameRequests, 0, 'equivalent merged properties must not request a frame');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: presentation-only changes do not republish semantic text state`, async () => {
    const font = await adapterFont();
    const initial = { font: font.face, text: 'position', style: { fontSize: 16 } };
    const host = await mount(initial);
    const object = host.text;
    const set = object.set.bind(object);
    let semanticUpdates = 0;
    object.set = (update) => {
      semanticUpdates += 1;
      return set(update);
    };
    try {
      await host.update({ ...initial, style: { fontSize: 16 }, position: [12, 24, 0] });
      assert.equal(host.text, object);
      assert.equal(object.position.x, 12);
      assert.equal(object.position.y, 24);
      assert.equal(semanticUpdates, 0, 'object presentation must not invalidate paragraph semantics');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: flow is paragraph state that survives unrelated updates and clears on removal`, async () => {
    const font = await adapterFont();
    const flow = { regions: [{ key: 'main', shape: { kind: 'rectangle', bounds: [0, 0, 200, 100] } }] };
    const initial = { font: font.face, text: 'flow', flow };
    const host = await mount(initial);
    const object = host.text;
    try {
      assert.deepEqual(object.flow, flow);
      await host.update({ ...initial, text: 'flow changed' });
      assert.equal(host.text, object);
      assert.deepEqual(object.flow, flow, 'an unrelated paragraph update must not clear flow');
      await host.update({ font: font.face, text: 'flow changed' });
      assert.equal(object.flow, undefined, 'removing the flow prop restores the default');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: removing group material and renderOrder restores the defaults`, async () => {
    const font = await adapterFont();
    const material = defineTextMaterial((context) => context.createDefaultMaterial());
    const initial = { font: font.face, text: 'group', group: { material, renderOrder: 3 } };
    const host = await mount(initial);
    const group = host.group;
    try {
      assert.equal(group.material, material);
      assert.equal(group.renderOrder, 3);
      host.resetFrameRequests();
      await host.update({ ...initial, group: {} });
      assert.equal(host.group, group, 'removing group props must not remount the group');
      assert.equal(group.material, undefined);
      assert.equal(group.renderOrder, 0);
      assert.ok(host.frameRequests > 0, 'a group change must request a frame');
      host.resetFrameRequests();
      await host.update({ ...initial, group: {} });
      assert.equal(host.frameRequests, 0, 'an unchanged group must not request a frame');
    } finally {
      await host.unmount();
      font.dispose();
    }
  });

  test(`${name}: nested property replacements publish new values without mutating prior state`, async () => {
    const font = await adapterFont();
    const initial = {
      font: font.face,
      text: 'snapshot',
      style: { fontSize: 16, decoration: { underline: true } },
      constraints: { width: { mode: 'exact', size: 200 } },
    };
    const host = await mount(initial);
    try {
      const oldStyle = host.text.style;
      const oldConstraints = host.text.constraints;
      await host.update({
        ...initial,
        style: { fontSize: 24, decoration: { underline: false } },
        constraints: { width: { mode: 'exact', size: 100 } },
      });
      assert.deepEqual(host.text.style, { fontSize: 24, decoration: { underline: false } });
      assert.equal(host.text.constraints.width.size, 100);
      assert.equal(oldStyle.fontSize, 16);
      assert.equal(oldStyle.decoration.underline, true);
      assert.equal(oldConstraints.width.size, 200);
    } finally {
      await host.unmount();
      font.dispose();
    }
  });
}
