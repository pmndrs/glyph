import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import * as THREE from 'three/webgpu';
import { Constraints, bitmap, createFontStack, txt, span } from '@pmndrs/glyph';
import { loadFont } from '../../dist/loader.js';
import { defineThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { PlanTransport } from '../../dist/internal/handle-state.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';

const fonts = new Map();
async function font(name = 'inter') {
  if (!fonts.has(name))
    fonts.set(
      name,
      await loadFont(
        {
          baked: {
            bytes: await readFile(
              new URL(`../../../../benches/fixtures/rendering/${name}-bitmap-16-32.font.glb`, import.meta.url),
            ),
          },
        },
        bitmap({ strikes: [16, 32] }),
      ),
    );
  return fonts.get(name);
}
after(() => {
  for (const value of fonts.values()) value.dispose();
});

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: ${actual} != ${expected}`);
function draws(scene) {
  const result = [];
  scene.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

function assertDrawTranslation(draw, transformMode, x, y, message) {
  if (transformMode === 'direct') {
    near(draw.matrix.elements[12], x, `${message} x`);
    near(draw.matrix.elements[13], y, `${message} y`);
  } else {
    const matrices = draw.geometry.getAttribute('_pmndrsGlyphTransforms').array;
    assert.ok(
      Array.from({ length: matrices.length / 16 }, (_, i) => i).some(
        (i) => Math.abs(matrices[i * 16 + 12] - x) < 0.0001 && Math.abs(matrices[i * 16 + 13] - y) < 0.0001,
      ),
      `${message}: indexed GPU storage has no expected translation ${x}, ${y}`,
    );
  }
}

async function make(t, properties = {}, config) {
  const handle = await createThreeTestHandle(t, config);
  const text = handle.createText({
    font: await font(),
    text: 'Cap x\nNext line',
    style: { fontSize: 20, lineHeight: 1.2 },
    ...properties,
  });
  t.after(() => text.dispose());
  return { handle, text };
}

test('measure exposes primary-face font dimensions and computed paragraph/line references without ink positioning', async (t) => {
  const { text } = await make(t, { layout: { spaceBefore: 7, spaceAfter: 9 } });
  const metrics = text.measure();
  assert.equal(metrics.inkBounds, undefined);
  assert.equal(metrics.lineCount, 2);
  assert.equal(text.measure(), metrics);
  const scale = 20 / 2048;
  near(metrics.fontMetrics.ascent, 1984 * scale, 'hhea ascender');
  near(metrics.fontMetrics.descent, 494 * scale, 'hhea descender');
  const leading = 24 - (1984 + 494) * scale;
  near(metrics.fontMetrics.leading, leading, 'authored line-height leading');
  near(metrics.firstBaseline, 7 + 1984 * scale + leading / 2, 'independent first baseline');
  near(metrics.ideographicBaseline, 31, 'independent first line bottom');
  near(metrics.height, 64, 'two authored lines plus paragraph spacing');
  near(metrics.fontMetrics.capHeight, 1490 * scale, 'OS/2 cap height');
  near(metrics.fontMetrics.xHeight, 1118 * scale, 'OS/2 x-height');
  assert.equal(metrics.fontMetrics.capHeightSource, 'font');
  assert.equal(metrics.fontMetrics.xHeightSource, 'font');
  assert.equal(metrics.fontMetrics, metrics.lines[0].fontMetrics);
  assert.equal(metrics.alphabeticBaseline, metrics.firstBaseline);
  for (const line of metrics.lines) {
    near(
      line.fontMetrics.leading,
      line.lineHeight - line.fontMetrics.ascent - line.fontMetrics.descent,
      'effective leading',
    );
    near(line.capHeightTop, line.baseline - line.fontMetrics.capHeight, 'cap top');
    near(line.xHeightTop, line.baseline - line.fontMetrics.xHeight, 'x-height top');
    near(line.ideographicBaseline, line.baseline - line.ascent + line.lineHeight, 'computed line bottom');
  }
  near(metrics.lastBaseline - metrics.firstBaseline, 24, 'baseline spacing');
  assert.ok(metrics.height > metrics.lines[1].ideographicBaseline, 'spaceAfter belongs to paragraph box, not baseline');
});

test('all anchor tokens resolve from measured box or named reference without reshaping on anchor changes', async (t) => {
  const { text } = await make(t, {
    constraints: { width: { mode: 'exact', size: 160 }, height: { mode: 'exact', size: 100 } },
  });
  const columns = text.glyphs();
  const initial = text.measure();
  let queries = 0;
  const measure = PlanTransport.prototype.measureParagraph;
  PlanTransport.prototype.measureParagraph = function (...args) {
    queries++;
    return measure.apply(this, args);
  };
  t.after(() => {
    PlanTransport.prototype.measureParagraph = measure;
  });
  const yReferences = {
    top: 0,
    middle: 50,
    bottom: 100,
    'first-baseline': initial.firstBaseline,
    'last-baseline': initial.lastBaseline,
    'alphabetic-baseline': initial.alphabeticBaseline,
    'ideographic-baseline': initial.ideographicBaseline,
    'cap-height-top': initial.capHeightTop,
    'x-height-top': initial.xHeightTop,
  };
  for (const [y, reference] of Object.entries(yReferences)) {
    for (const [x, inline] of [
      ['left', 0],
      ['center', 80],
      ['right', 160],
    ]) {
      text.constraints = {
        width: { mode: 'exact', size: 160 },
        height: { mode: 'exact', size: 100 },
        anchor: { x, y },
      };
      const next = text.measure();
      assert.deepEqual(next.anchorOffset, { x: inline === 0 ? 0 : -inline, y: reference === 0 ? 0 : -reference });
      assert.equal(next.width, initial.width);
      assert.equal(next.height, initial.height);
      assert.equal(next.lines, initial.lines, 'anchor changes reuse computed line records');
      const nextColumns = text.glyphs();
      assert.deepEqual(nextColumns.glyphIds, columns.glyphIds);
      assert.deepEqual(nextColumns.glyphStableIds, columns.glyphStableIds);
      assert.deepEqual(nextColumns.x, columns.x);
      assert.deepEqual(nextColumns.y, columns.y);
    }
  }
  assert.equal(queries, 0, 'anchor-only updates must not cross the layout/shape engine');
  text.constraints = { width: { mode: 'exact', size: 160 }, height: { mode: 'exact', size: 100 } };
  assert.deepEqual(text.measure().anchorOffset, { x: 0, y: 0 });
});

test('anchors use resolved at-most dimensions, wrapped lines and exact height including paragraph spacing', async (t) => {
  const { text } = await make(t, { text: 'abc' });
  const natural = text.measure();
  text.constraints = {
    width: { mode: 'at-most', size: 200 },
    anchor: { x: 'center', y: 'bottom' },
  };
  const shrink = text.measure();
  near(shrink.width, natural.width, 'at-most resolves to short content, not its maximum');
  assert.ok(shrink.width < 200);
  near(shrink.anchorOffset.x, -natural.width / 2, 'center uses the resolved short-content width');
  near(shrink.anchorOffset.y, -24, 'bottom uses one authored line');

  text.set({
    text: 'abc abc abc',
    constraints: { width: { mode: 'at-most', size: 60 }, anchor: { x: 'right', y: 'last-baseline' } },
  });
  const wrapped = text.measure();
  assert.equal(wrapped.lineCount, 3, 'constraint wraps three words into three lines');
  near(wrapped.height, 72, 'three authored line boxes');
  assert.ok(wrapped.width <= 60);
  near(wrapped.anchorOffset.x, -wrapped.width, 'right uses the resolved wrapped box');
  near(wrapped.anchorOffset.y, -(natural.firstBaseline + 48), 'last baseline follows constrained wrapping');

  text.set({
    text: 'abc\nabc',
    layout: { spaceBefore: 7, spaceAfter: 9 },
    constraints: {
      width: { mode: 'exact', size: 160 },
      height: { mode: 'exact', size: 100 },
      anchor: { x: 'center', y: 'bottom' },
    },
  });
  const fixed = text.measure();
  near(fixed.height, 100, 'exact height owns the box despite content and spacing');
  near(fixed.contentHeight, 64, 'content retains two lines plus before/after spacing');
  assert.deepEqual(fixed.anchorOffset, { x: -80, y: -100 });
  near(fixed.firstBaseline, natural.firstBaseline + 7, 'spaceBefore offsets the typographic reference');
  near(fixed.lastBaseline, natural.firstBaseline + 31, 'spaceAfter does not offset the last baseline');
  text.constraints = {
    width: { mode: 'exact', size: 160 },
    height: { mode: 'exact', size: 100 },
    anchor: { y: 'first-baseline' },
  };
  near(text.measure().anchorOffset.y, -(natural.firstBaseline + 7), 'baseline anchor includes spaceBefore');
});

test('shallow property lists replace the whole anchor and explicit spread composes one axis', () => {
  const presets = Constraints.create({ center: { anchor: { x: 'center', y: 'middle' } } });
  const composed = Constraints.create({
    shallow: [presets.center, { anchor: { y: 'first-baseline' } }],
    spread: [presets.center, { anchor: { ...presets.center.anchor, y: 'first-baseline' } }],
  });
  assert.deepEqual(composed.shallow.anchor, { y: 'first-baseline' });
  assert.deepEqual(composed.spread.anchor, { x: 'center', y: 'first-baseline' });
  assert.throws(() => Constraints.create({ invalid: { anchor: { y: 'baseline' } } }), /anchor y/);
});

test('empty, tight leading, sizing, dynamic text, mixed fonts and fallback retain the same metric contract', async (t) => {
  const primary = await font();
  const secondary = await font('amiri');
  const { handle, text } = await make(t, {
    font: createFontStack(primary, secondary),
    text: '',
    constraints: { anchor: { y: 'first-baseline' } },
  });
  assert.equal(text.measure().lineCount, 0);
  assert.deepEqual(text.measure().anchorOffset, { x: 0, y: 0 });
  text.text = 'x\n\nx';
  assert.equal(text.measure().lineCount, 3);
  for (const line of text.measure().lines)
    near(line.fontMetrics.capHeight, (1490 * 20) / 2048, 'empty line authored strut');
  text.set({ text: 'x\nx', style: { fontSize: 20, lineHeight: 0.5 } });
  assert.ok(text.measure().fontMetrics.leading < 0);
  near(text.measure().lastBaseline - text.measure().firstBaseline, 10, 'tight leading');
  text.set({
    text: 'abc',
    constraints: { width: { mode: 'at-most', size: 200 }, anchor: { x: 'center', y: 'cap-height-top' } },
  });
  const small = text.measure();
  assert.ok(small.width < 200);
  text.text = 'abc abc abc abc abc abc';
  assert.ok(text.measure().height > small.height);
  const primaryHandle = text.glyphs().fontHandles[0];
  text.set({ text: 'مرحبا', style: { fontSize: 20 } });
  const fallback = text.measure();
  assert.equal(fallback.missingGlyphCount, 0);
  assert.notEqual(text.glyphs().fontHandles[0], primaryHandle, 'Arabic actually selects the fallback face');
  near(fallback.fontMetrics.capHeight, (1490 * 20) / 2048, 'fallback glyphs keep authored primary face metrics');
  text.set({ text: txt`small ${span({ fontSize: 40 })`BIG`}` });
  near(text.measure().fontMetrics.capHeight, (1490 * 40) / 2048, 'mixed authored sizes aggregate cap height');
  const other = handle.createText({ font: secondary, text: 'مرحبا', style: { fontSize: 30 } });
  t.after(() => other.dispose());
  const otherMetrics = other.measure();
  text.set({ text: txt`Latin ${span(secondary, { fontSize: 30 })`مرحبا`}` });
  const mixed = text.measure();
  assert.equal(mixed.missingGlyphCount, 0);
  near(
    mixed.fontMetrics.capHeight,
    Math.max((1490 * 20) / 2048, otherMetrics.fontMetrics.capHeight),
    'mixed authored faces aggregate cap height',
  );
  near(
    mixed.fontMetrics.xHeight,
    Math.max((1118 * 20) / 2048, otherMetrics.fontMetrics.xHeight),
    'mixed authored faces aggregate x-height',
  );
});

test('Three draw transforms, bounds, glyph measures, carets, selection and split agree on anchoring', async (t) => {
  for (const transformMode of ['direct', 'indexed'])
    await t.test(transformMode, async (subtest) => {
      const { text } = await make(
        subtest,
        { text: 'Abc', style: { fontSize: 20, decoration: { underline: true } } },
        defineThreeConfig({ transformMode }),
      );
      const scene = new THREE.Scene();
      scene.add(text);
      scene.updateMatrixWorld(true);
      const base = text.measure();
      const ink = text.computeBoundingBox().clone();
      const glyphs = text.measureGlyphs();
      const caret = text.caretForOffset(1);
      const selection = text.selectionRects(0, 2);
      const beforeDraws = draws(scene).map((draw) => ({ draw, matrix: draw.matrix.clone() }));
      assert.ok(beforeDraws.length > 0);
      text.constraints = { anchor: { x: 'center', y: 'first-baseline' } };
      const anchored = text.measure();
      const offset = anchored.anchorOffset;
      assert.deepEqual(offset, { x: -base.width / 2, y: -base.firstBaseline });
      scene.updateMatrixWorld(true);
      const translation = new THREE.Vector3(offset.x, -offset.y, 0);
      assert.ok(text.computeBoundingBox().equals(ink.clone().translate(translation)));
      const changed = text.measureGlyphs();
      for (let i = 0; i < glyphs.length; i++)
        assert.ok(changed[i].drawnOrigin.equals(glyphs[i].drawnOrigin.clone().add(translation)));
      const changedCaret = text.caretForOffset(1);
      near(changedCaret.rect.x, caret.rect.x + offset.x, 'caret x');
      near(changedCaret.rect.y, caret.rect.y + offset.y, 'caret y');
      assert.equal(text.caretAt(changedCaret.rect.x, changedCaret.rect.y).offset, 1);
      const changedSelection = text.selectionRects(0, 2);
      near(changedSelection[0].x, selection[0].x + offset.x, 'selection x');
      near(changedSelection[0].y, selection[0].y + offset.y, 'selection y');
      if (transformMode === 'direct') {
        for (const { draw, matrix } of beforeDraws) {
          near(draw.matrix.elements[12] - matrix.elements[12], offset.x, 'direct draw x');
          near(draw.matrix.elements[13] - matrix.elements[13], -offset.y, 'direct draw y');
        }
      } else {
        const transforms = beforeDraws[0].draw.geometry.getAttribute('_pmndrsGlyphTransforms');
        assert.ok(transforms, 'indexed draw exposes its actual transform storage');
        assert.ok(
          Array.from({ length: transforms.array.length / 16 }, (_, i) => i).some(
            (i) =>
              Math.abs(transforms.array[i * 16 + 12] - offset.x) < 0.0001 &&
              Math.abs(transforms.array[i * 16 + 13] + offset.y) < 0.0001,
          ),
          'anchor translation must reach indexed GPU transform storage',
        );
      }
      const [detached, decorations] = text.split();
      subtest.after(() => {
        detached.dispose();
        decorations?.dispose();
      });
      near(detached.position.x, offset.x, 'split glyph origin x');
      near(detached.position.y, -offset.y, 'split glyph origin y');
      if (decorations) {
        near(decorations.position.x, offset.x, 'split decoration origin x');
        near(decorations.position.y, -offset.y, 'split decoration origin y');
      }
    });
});

test('a rejected Three publication preserves the accepted anchor transform', async (t) => {
  const { text } = await make(
    t,
    { constraints: { anchor: { x: 'center', y: 'first-baseline' } } },
    defineThreeConfig({ transformMode: 'direct' }),
  );
  const scene = new THREE.Scene();
  scene.add(text);
  scene.updateMatrixWorld(true);
  const before = draws(scene).map((draw) => ({ draw, matrix: draw.matrix.clone() }));
  assert.ok(before.length > 0);
  let rejectMaterial = true;
  const rejected = defineTextMaterial((context) => {
    if (rejectMaterial) throw new Error('intentional anchored material rejection');
    return context.createDefaultMaterial();
  });
  text.set({
    text: 'A much longer pending paragraph',
    constraints: { anchor: { x: 'right', y: 'bottom' } },
    material: rejected,
  });
  scene.updateMatrixWorld(true);
  assert.equal(text.commitState().status, 'failed');
  for (const { draw, matrix } of before)
    assert.ok(draw.matrix.equals(matrix), 'failed candidate retains accepted anchor placement');
  rejectMaterial = false;
  text.constraints = { anchor: { x: 'left', y: 'cap-height-top' } };
  scene.updateMatrixWorld(true);
  assert.equal(
    text.commitState().status,
    'committed',
    'an explicit anchor edit retries the rejected semantic publication',
  );
  near(draws(scene)[0].matrix.elements[13], -text.measure().anchorOffset.y, 'retried anchor placement');
});

test('inherited material rejection preserves accepted anchors in same-frame and previously failed updates', async (t) => {
  for (const transformMode of ['direct', 'indexed'])
    for (const owner of ['root', 'group'])
      for (const sequence of ['same-frame', 'already-rejected', 'query-staged'])
        await t.test(`${transformMode}/${owner}/${sequence}`, async (subtest) => {
          const handle = await createThreeTestHandle(subtest, defineThreeConfig({ transformMode }));
          const root = handle('inherited-anchor');
          const text = root.createText({
            font: await font(),
            text: 'Accepted',
            style: { fontSize: 20 },
            constraints: { anchor: { x: 'center', y: 'first-baseline' } },
          });
          const group = owner === 'group' ? root.createTextGroup() : undefined;
          subtest.after(() => {
            text.dispose();
            group?.dispose();
          });
          const scene = new THREE.Scene();
          if (group) {
            group.add(text);
            scene.add(group);
          } else scene.add(text);
          scene.updateMatrixWorld(true);
          const before = draws(scene).map((draw) => ({
            draw,
            matrix: draw.matrix.clone(),
            transforms: draw.geometry.getAttribute('_pmndrsGlyphTransforms')?.array.slice(),
          }));
          assert.ok(before.length > 0);
          let rejectMaterial = true;
          let materialAttempts = 0;
          (group ?? root).material = defineTextMaterial((context) => {
            materialAttempts++;
            if (rejectMaterial) throw new Error('intentional inherited material rejection');
            return context.createDefaultMaterial();
          });
          if (sequence === 'already-rejected') {
            scene.updateMatrixWorld(true);
            assert.equal(text.commitState().status, 'failed');
            assert.ok(materialAttempts > 0);
          }
          if (sequence === 'query-staged') {
            text.measureGlyphs();
            assert.equal(materialAttempts, 0, 'a placement query stages presentation without accepting its material');
          }
          text.constraints = { anchor: { x: 'right', y: 'bottom' } };
          scene.updateMatrixWorld(true);
          assert.equal(text.commitState().status, 'failed');
          assert.ok(materialAttempts > 0, 'candidate actually reached the rejecting material factory');
          for (const { draw, matrix, transforms } of before) {
            assert.ok(draw.matrix.equals(matrix), 'rejected inherited material retains the accepted draw matrix');
            if (transforms)
              assert.deepEqual(
                draw.geometry.getAttribute('_pmndrsGlyphTransforms').array,
                transforms,
                'rejected inherited material retains indexed GPU transform storage',
              );
          }
          if (group) {
            const acceptedOffset = { x: -text.measure().width / 2, y: -text.measure().firstBaseline };
            group.position.set(13, -7, 0);
            scene.updateMatrixWorld(true);
            assertDrawTranslation(
              draws(scene)[0],
              transformMode,
              acceptedOffset.x + 13,
              -acceptedOffset.y - 7,
              'accepted branch still follows live group motion while its new anchor is rejected',
            );
          }
          rejectMaterial = false;
          text.constraints = { anchor: { x: 'left', y: 'cap-height-top' } };
          scene.updateMatrixWorld(true);
          assert.equal(text.commitState().status, 'committed');
          const offset = text.measure().anchorOffset;
          assertDrawTranslation(
            draws(scene)[0],
            transformMode,
            offset.x + (group?.position.x ?? 0),
            -offset.y + (group?.position.y ?? 0),
            'accepted inherited candidate anchor',
          );
        });
});

test('inherited draw-order changes stay with a rejected material candidate', async (t) => {
  for (const transformMode of ['direct', 'indexed'])
    await t.test(transformMode, async (subtest) => {
      const handle = await createThreeTestHandle(subtest, defineThreeConfig({ transformMode }));
      const root = handle('ordered-anchor');
      const group = root.createTextGroup({ renderOrder: 1 });
      const text = root.createText({
        font: await font(),
        text: 'Ordered',
        constraints: { anchor: { x: 'center', y: 'first-baseline' } },
      });
      subtest.after(() => {
        text.dispose();
        group.dispose();
      });
      let rejectMaterial = true;
      group.add(text);
      const scene = new THREE.Scene();
      scene.add(group);
      scene.updateMatrixWorld(true);
      const accepted = text.measure().anchorOffset;
      root.material = defineTextMaterial((context) => {
        if (rejectMaterial) throw new Error('intentional draw-order material rejection');
        return context.createDefaultMaterial();
      });
      group.renderOrder = 3;
      text.constraints = { anchor: { x: 'right', y: 'bottom' } };
      scene.updateMatrixWorld(true);
      assert.equal(text.commitState().status, 'failed');
      assert.equal(draws(scene)[0].renderOrder, 1, 'draw order stays with the accepted material');
      assertDrawTranslation(draws(scene)[0], transformMode, accepted.x, -accepted.y, 'draw-order rejected anchor');
      rejectMaterial = false;
      text.constraints = { anchor: { x: 'left', y: 'cap-height-top' } };
      scene.updateMatrixWorld(true);
      assert.equal(text.commitState().status, 'committed');
      assert.equal(draws(scene)[0].renderOrder, 3);
      const offset = text.measure().anchorOffset;
      assertDrawTranslation(draws(scene)[0], transformMode, offset.x, -offset.y, 'accepted draw-order anchor');
      text.renderOrder = 7;
      text.constraints = { anchor: { x: 'center', y: 'first-baseline' } };
      scene.updateMatrixWorld(true);
      assert.equal(text.commitState().status, 'committed', 'a scoped rank plus anchor update still accepts normally');
      const rankedOffset = text.measure().anchorOffset;
      assertDrawTranslation(draws(scene)[0], transformMode, rankedOffset.x, -rankedOffset.y, 'accepted scoped rank');
    });
});

test('anchors compose in local axes under Three rotation and scale, including detached copies', async (t) => {
  for (const transformMode of ['direct', 'indexed'])
    await t.test(transformMode, async (subtest) => {
      const { text } = await make(
        subtest,
        { text: 'Rotated', constraints: { anchor: { x: 'right', y: 'cap-height-top' } } },
        defineThreeConfig({ transformMode }),
      );
      text.position.set(35, -17, 0);
      text.rotation.z = 0.37;
      text.scale.set(1.3, 0.8, 1);
      const scene = new THREE.Scene();
      scene.add(text);
      scene.updateMatrixWorld(true);
      const offset = text.measure().anchorOffset;
      const expected = text.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(offset.x, -offset.y, 0));
      const draw = draws(scene)[0];
      assert.ok(draw);
      if (transformMode === 'direct') {
        draw.matrix.elements.forEach((value, i) => near(value, expected.elements[i], `rotated direct matrix ${i}`));
      } else {
        const transforms = draw.geometry.getAttribute('_pmndrsGlyphTransforms');
        assert.ok(transforms);
        assert.ok(
          Array.from({ length: transforms.array.length / 16 }, (_, n) => n).some((n) =>
            expected.elements.every((value, i) => Math.abs(transforms.array[n * 16 + i] - value) < 0.0001),
          ),
          'rotated indexed matrix',
        );
      }
      const [glyphs, decorations] = text.split();
      subtest.after(() => {
        glyphs.dispose();
        decorations?.dispose();
      });
      glyphs.matrix.elements.forEach((value, i) => near(value, expected.elements[i], `detached anchor matrix ${i}`));
    });
});

test('explicit flow regions retain paragraph coordinates and anchored placement', async (t) => {
  const { text } = await make(
    t,
    {
      text: 'alpha beta gamma delta',
      constraints: { width: { mode: 'exact', size: 200 }, height: { mode: 'exact', size: 120 } },
      flow: { regions: [{ key: 'content', shape: { kind: 'rectangle', bounds: [10, 12, 180, 110] } }] },
    },
    defineThreeConfig({ transformMode: 'direct' }),
  );
  const scene = new THREE.Scene();
  scene.add(text);
  scene.updateMatrixWorld(true);
  const original = text.glyphs();
  const initial = text.measure();
  text.constraints = { ...text.constraints, anchor: { x: 'center', y: 'first-baseline' } };
  const measured = text.measure();
  scene.updateMatrixWorld(true);
  assert.equal(measured.width, initial.width);
  assert.equal(measured.height, initial.height);
  assert.deepEqual(text.glyphs().x, original.x);
  assert.deepEqual(text.glyphs().y, original.y);
  const draw = draws(scene)[0];
  assert.ok(draw);
  near(draw.matrix.elements[12], -measured.width / 2, 'flow anchor x');
  near(draw.matrix.elements[13], measured.firstBaseline, 'flow anchor y');
});
