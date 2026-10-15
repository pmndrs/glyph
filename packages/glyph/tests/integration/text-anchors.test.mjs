import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import * as THREE from 'three/webgpu';
import { Constraints, bitmap, createFontStack, glyph, txt, span } from '@pmndrs/glyph';
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
  assert.equal(
    metrics.lines[0].fontMetrics,
    metrics.lines[1].fontMetrics,
    'identical line struts share immutable metrics',
  );
  assert.ok(Object.isFrozen(metrics.fontMetrics));
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
  text.set({ text: txt`small\n${span({ fontSize: 40 })`BIG`}` });
  const [smallLine, largeLine] = text.measure().lines;
  near(smallLine.fontMetrics.capHeight, (1490 * 20) / 2048, 'first line keeps smaller strut');
  near(largeLine.fontMetrics.capHeight, (1490 * 40) / 2048, 'next line keeps larger strut');
  assert.notEqual(smallLine.fontMetrics, largeLine.fontMetrics, 'different line struts remain independent');
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
      near(detached.position.x, text.position.x, 'split keeps source pivot x');
      near(detached.position.y, text.position.y, 'split keeps source pivot y');
      if (decorations) {
        near(decorations.position.x, text.position.x, 'split decoration source pivot x');
        near(decorations.position.y, text.position.y, 'split decoration source pivot y');
      }
    });
});

test('split preserves the source local frame, pivot and instance APIs through group motion', async (t) => {
  const face = glyph.fontFace(
    new Blob([
      await readFile(new URL('../../../../benches/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url)),
    ]),
    { format: bitmap({ strikes: [16, 32] }) },
  );
  await face.load();
  t.after(() => face.dispose());
  const matrixNear = (actual, expected, message) => {
    actual.elements.forEach((value, index) => near(value, expected.elements[index], `${message} matrix ${index}`));
  };
  for (const transformMode of ['direct', 'indexed'])
    for (const anchor of [undefined, { x: 'center', y: 'first-baseline' }])
      for (const motion of ['rotation', 'scale', 'combined'])
        await t.test(`${transformMode}/${anchor === undefined ? 'default' : 'anchored'}/${motion}`, async (subtest) => {
          const handle = await createThreeTestHandle(subtest, defineThreeConfig({ transformMode }));
          const text = handle.createText({
            font: face,
            text: 'Abc',
            style: { fontSize: 20, decoration: { underline: true } },
            constraints: anchor === undefined ? undefined : { anchor },
          });
          subtest.after(() => text.dispose());
          const scene = new THREE.Scene();
          const parent = new THREE.Group();
          parent.position.set(17, -9, 3);
          parent.rotation.set(0.1, -0.2, 0.35);
          parent.scale.set(1.6, 0.65, 1.1);
          text.position.set(-4, 7, 2);
          text.rotation.set(-0.15, 0.1, -0.25);
          text.scale.set(1.2, 0.8, 0.9);
          parent.add(text);
          scene.add(parent);
          scene.updateMatrixWorld(true);
          const paragraph = text.glyphs();
          const [detached, decorations] = text.split();
          assert.ok(decorations);
          subtest.after(() => {
            detached.dispose();
            decorations.dispose();
          });
          parent.add(detached, decorations);
          scene.updateMatrixWorld(true);
          const instance = new THREE.Matrix4();
          const assertSwap = () => {
            const source = text.measureGlyphs();
            assert.equal(detached.count, source.length);
            for (let index = 0; index < detached.count; index += 1) {
              const expected = text.matrixWorld.clone().multiply(source[index].originalMatrix);
              detached.getWorldMatrixAt(index, instance);
              matrixNear(instance, expected, `glyph ${index} world`);
              detached.getMatrixAt(index, instance);
              matrixNear(instance, source[index].originalMatrix, `glyph ${index} owner-local`);
              matrixNear(
                detached.measurements[index].originalMatrix,
                source[index].originalMatrix,
                'original snapshot',
              );
            }
            matrixNear(detached.matrix, text.matrix, 'Glyphs source transform/pivot');
            matrixNear(decorations.matrix, text.matrix, 'Decorations source transform/pivot');
            const offset = paragraph.anchorOffset;
            const expectedContent = new THREE.Matrix4().makeTranslation(offset.x, offset.y === 0 ? 0 : -offset.y, 0);
            for (const draw of draws(decorations)) {
              if (transformMode === 'direct') matrixNear(draw.matrix, expectedContent, 'decoration content anchor');
              else {
                const table = draw.geometry.getAttribute('_pmndrsGlyphTransforms').array;
                assert.ok(
                  Array.from({ length: table.length / 16 }, (_, i) => i).some((i) =>
                    expectedContent.elements.every((value, j) => Math.abs(table[i * 16 + j] - value) < 0.0001),
                  ),
                );
              }
            }
          };
          assertSwap();
          const initialGpuTransform = new THREE.Matrix4().makeTranslation(
            paragraph.anchorOffset.x,
            paragraph.anchorOffset.y === 0 ? 0 : -paragraph.anchorOffset.y,
            0,
          );
          for (const draw of draws(detached)) {
            const table = draw.geometry.getAttribute('_pmndrsGlyphInstanceTransforms').array;
            let initialized = 0;
            for (let record = 0; record < table.length / 16; record += 1) {
              if (table[record * 16 + 15] === 0) continue;
              matrixNear(
                new THREE.Matrix4().fromArray(table, record * 16),
                initialGpuTransform,
                'initial GPU transform',
              );
              initialized++;
            }
            assert.ok(initialized > 0, 'at least one copied glyph occupies this draw storage');
          }
          for (const object of [text, detached, decorations]) {
            if (motion !== 'scale') object.rotateZ(0.45);
            if (motion !== 'rotation') object.scale.multiply(new THREE.Vector3(1.3, 0.7, 1.1));
          }
          scene.updateMatrixWorld(true);
          assertSwap();

          const assertStorage = (index, local) => {
            const raw = new THREE.Matrix4().makeTranslation(-paragraph.x[index], paragraph.y[index], 0);
            const expected = local.clone().multiply(raw);
            assert.ok(
              draws(detached).some((draw) => {
                const table = draw.geometry.getAttribute('_pmndrsGlyphInstanceTransforms').array;
                return Array.from({ length: table.length / 16 }, (_, i) => i).some((i) =>
                  expected.elements.every((value, j) => Math.abs(table[i * 16 + j] - value) < 0.0001),
                );
              }),
              'public owner-local instance matrix reaches GPU storage with one raw-pen compensation',
            );
          };
          detached.getMatrixAt(0, instance);
          instance.multiply(new THREE.Matrix4().makeRotationZ(0.2));
          instance.elements[12] += 2;
          detached.setMatrixAt(0, instance);
          const localWrite = instance.clone();
          detached.getMatrixAt(0, instance);
          matrixNear(instance, localWrite, 'local setter round trip');
          assertStorage(0, localWrite);
          const worldWrite = detached.matrixWorld.clone().multiply(detached.measurements[1].originalMatrix);
          worldWrite.elements[13] += 3;
          detached.setWorldMatrixAt(1, worldWrite);
          detached.getWorldMatrixAt(1, instance);
          matrixNear(instance, worldWrite, 'world setter round trip');
          assertStorage(1, detached.matrixWorld.clone().invert().multiply(worldWrite));
          const frozenWorld = Array.from({ length: detached.count }, (_, index) => {
            const matrix = new THREE.Matrix4();
            detached.getWorldMatrixAt(index, matrix);
            return matrix;
          });
          text.set({ text: 'Different text', constraints: { anchor: { x: 'right', y: 'bottom' } } });
          scene.updateMatrixWorld(true);
          for (let index = 0; index < detached.count; index += 1) {
            detached.getWorldMatrixAt(index, instance);
            matrixNear(instance, frozenWorld[index], 'source-independent captured content');
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
      glyphs.matrix.elements.forEach((value, i) => near(value, text.matrix.elements[i], `detached source matrix ${i}`));
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
