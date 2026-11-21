// The editing API on a real Wasm build: five queries and one exact edit, on Three `Text`.
//
// The engine-side proofs (every fixture of the layout oracle, every caret rule) live in the shaper's
// `tests/editing_*.rs`. These check that the same answers cross the boundary: the record layout, the
// anchor, the errors, and that an application can drive an input-method composition with nothing but
// `replace` and `rangeRects`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { bitmap, span, txt, TextOffsetError } from '@pmndrs/glyph';
import { loadFont as loadGlyphFont } from '../../dist/loader.js';
import { rebaseSpanRange } from '../../dist/text-editing.js';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';
import { crossingsOf } from '../support/wasm-crossings.mjs';

const fixtures = {
  inter: ['inter-bitmap-16-32.font.glb', [16, 32]],
  amiri: ['amiri-bitmap-16-32.font.glb', [16, 32]],
  fredoka: ['fredoka-issue-216-bitmap-16.font.glb', [16]],
};
const loaded = new Map();

async function loadFont(name) {
  const existing = loaded.get(name);
  if (existing !== undefined) return existing;
  const [file, strikes] = fixtures[name];
  const bytes = await readFile(new URL(`../../../../benches/fixtures/rendering/${file}`, import.meta.url));
  const font = await loadGlyphFont({ baked: { bytes, ownership: 'copy' } }, bitmap({ strikes }));
  loaded.set(name, font);
  return font;
}

after(() => {
  for (const font of loaded.values()) font.dispose();
});

async function mount(testContext, fontName, text, properties = {}) {
  const three = await createThreeTestHandle(testContext);
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const node = three.createText({ font: await loadFont(fontName), style: { fontSize: 16 }, text, ...properties });
  scene.add(group);
  group.add(node);
  scene.updateMatrixWorld(true);
  testContext.after(() => {
    node.dispose();
    group.dispose();
  });
  return node;
}

const down = (offset) => ({ offset, affinity: 'downstream' });
const up = (offset) => ({ offset, affinity: 'upstream' });
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-3, `${message ?? 'value'}: ${actual} is not ${expected}`);

test('caret stands on the pen, in Text-local coordinates with the anchor applied', async (t) => {
  const text = await mount(t, 'inter', 'abc');
  const layout = text.glyphs();
  const line = layout.lines[0];
  for (let offset = 0; offset < 3; offset += 1) {
    const caret = text.caret(down(offset));
    near(caret.rect.x, layout.x[offset], `caret ${offset}`);
    assert.deepEqual(
      [caret.rect.y, caret.rect.width, caret.rect.height, caret.line, caret.level, caret.secondary, caret.clipped],
      [line.baseline - line.ascent, 0, line.lineHeight, 0, 0, undefined, false],
    );
    assert.ok(Object.isFrozen(caret) && Object.isFrozen(caret.rect));
  }
  near(text.caret(up(3)).rect.x, layout.x[2] + layout.glyphAdvances[2], 'end of text');

  // An anchor moves every answer by the same offset the summary reports, and a point is given in the same space.
  const plain = text.caret(down(2));
  text.constraints = { anchor: { x: 'center', y: 'middle' } };
  const offset = text.measure().anchorOffset;
  assert.ok(offset.x < 0 && offset.y < 0);
  const anchored = text.caret(down(2));
  near(anchored.rect.x, plain.rect.x + offset.x, 'anchored x');
  near(anchored.rect.y, plain.rect.y + offset.y, 'anchored y');
  assert.deepEqual(text.hitTest({ x: anchored.rect.x, y: anchored.rect.y + 1 }), down(2));
  near(text.rangeRects(0, 2)[0].x, offset.x, 'anchored range');
});

test('hitTest finds the nearest stop from anywhere and tells a line end from the next line start', async (t) => {
  const text = await mount(t, 'inter', 'aaaa bbbb cccc', {
    constraints: { width: { mode: 'exact', size: 50 } },
  });
  const lines = text.glyphs().lines;
  assert.equal(lines.length, 3);
  const y = (line) => lines[line].baseline - 1;
  assert.deepEqual(text.hitTest({ x: -100, y: -100 }), down(0));
  assert.deepEqual(text.hitTest({ x: 10_000, y: y(0) }), up(5), 'past the end of a wrapped line: its end');
  assert.deepEqual(text.hitTest({ x: -5, y: y(1) }), down(5), 'before the next line: its start');
  assert.deepEqual(text.hitTest({ x: 10_000, y: 10_000 }), up(14));
  // The two sides of the wrap are one offset and two carets.
  assert.equal(text.caret(up(5)).line, 0);
  assert.equal(text.caret(down(5)).line, 1);
  assert.throws(() => text.hitTest({ x: Number.NaN, y: 0 }), RangeError);
});

test('move steps logically, visually and by line with a goal column', async (t) => {
  const text = await mount(t, 'inter', 'aaaaaaaaaa\na\naaaaaaaaaa');
  assert.deepEqual(text.move(down(3), 'forward', 'grapheme').position, down(4));
  assert.deepEqual(text.move(down(3), 'left', 'grapheme').position, down(2));
  assert.deepEqual(text.move(down(3), 'forward', 'line').position, up(10));
  assert.deepEqual(text.move(down(3), 'backward', 'word').position, down(0));
  const column = text.caret(down(8)).rect.x;
  const first = text.move(down(8), 'down', 'line');
  assert.deepEqual(first, { position: up(12), goalX: column });
  assert.deepEqual(text.move(first.position, 'down', 'line', first.goalX), { position: down(21), goalX: column });
  assert.deepEqual(text.move(first.position, 'down', 'line').position, down(14), 'without the goal the column is lost');
  assert.throws(() => text.move(down(3), 'up', 'word'), RangeError);
  assert.throws(() => text.move(down(3), 'sideways', 'grapheme'), TypeError);
  assert.throws(() => text.move({ offset: 3, affinity: 'middle' }, 'forward', 'grapheme'), TypeError);
});

test('move crosses a bidi run in x order and the boundary has a caret on each side', async (t) => {
  // abc, space, four Arabic letters, space, def.
  const text = await mount(t, 'amiri', 'abc سلام def');
  const walk = [down(0)];
  for (;;) {
    const next = text.move(walk.at(-1), 'right', 'grapheme').position;
    if (next.offset === walk.at(-1).offset && next.affinity === walk.at(-1).affinity) break;
    walk.push(next);
  }
  assert.deepEqual(walk, [
    down(0),
    down(1),
    down(2),
    down(3),
    up(4),
    down(7),
    down(6),
    down(5),
    down(4),
    down(9),
    down(10),
    down(11),
    up(12),
  ]);
  const xs = walk.map((position) => text.caret(position).rect.x);
  assert.ok(
    xs.every((x, index) => index === 0 || x > xs[index - 1]),
    `${xs}`,
  );
  const start = text.caret(down(4));
  assert.equal(start.level, 1);
  assert.deepEqual(start.secondary, text.caret(up(4)).rect);
  assert.ok(start.rect.x > text.caret(up(4)).rect.x, 'the run starts at its right edge');
  // A range across the boundary is two rectangles.
  assert.equal(text.rangeRects(2, 6).length, 2);
});

test("boundary answers with the engine's graphemes, words, sentences and lines", async (t) => {
  const family = '\u{1f468}‍\u{1f469}‍\u{1f467}';
  const text = await mount(t, 'inter', `Hello, world! How ${family} are\nyou?`);
  assert.deepEqual(text.boundary(down(8), 'word'), { start: 7, end: 12 });
  assert.deepEqual(text.boundary(up(7), 'word'), { start: 6, end: 7 });
  assert.deepEqual(text.boundary(down(3), 'sentence'), { start: 0, end: 14 });
  assert.deepEqual(text.boundary(down(18), 'grapheme'), { start: 18, end: 26 }, 'an emoji ZWJ sequence is one unit');
  assert.deepEqual(text.boundary(down(3), 'line'), { start: 0, end: 31 });
  assert.deepEqual(text.boundary(down(31), 'line'), { start: 31, end: 35 });
  assert.deepEqual(text.move(down(18), 'forward', 'grapheme').position, down(26));
  assert.throws(() => text.boundary(down(3), 'paragraph'), TypeError);
});

test('a refused offset says what, where and what is nearest', async (t) => {
  const text = await mount(t, 'inter', 'a\u{1f44d}\u{1f3fd}b');
  const refused = (call, expected) =>
    assert.throws(call, (error) => {
      assert.ok(error instanceof TextOffsetError);
      assert.equal(error.code, 'invalid-offset');
      assert.deepEqual(
        {
          method: error.method,
          argument: error.argument,
          offset: error.offset,
          reason: error.reason,
          textLength: error.textLength,
          before: error.before,
          after: error.after,
        },
        expected,
      );
      return true;
    });
  const inside = { offset: 3, reason: 'inside-grapheme', textLength: 6, before: 1, after: 5 };
  refused(() => text.caret(down(3)), { method: 'caret', argument: 'offset', ...inside });
  refused(() => text.move(up(3), 'forward', 'word'), { method: 'move', argument: 'offset', ...inside });
  refused(() => text.boundary(down(3), 'line'), { method: 'boundary', argument: 'offset', ...inside });
  refused(() => text.rangeRects(1, 3), { method: 'rangeRects', argument: 'end', ...inside });
  refused(() => text.replace(3, 5, 'x'), { method: 'replace', argument: 'start', ...inside });
  refused(() => text.replace(5, 1, 'x'), {
    method: 'replace',
    argument: 'end',
    offset: 1,
    reason: 'reversed',
    textLength: 6,
    before: 1,
    after: 1,
  });
  refused(() => text.caret(down(7)), {
    method: 'caret',
    argument: 'offset',
    offset: 7,
    reason: 'out-of-range',
    textLength: 6,
    before: 6,
    after: undefined,
  });
  refused(() => text.rangeRects(-1, 2), {
    method: 'rangeRects',
    argument: 'start',
    offset: -1,
    reason: 'out-of-range',
    textLength: 6,
    before: undefined,
    after: 0,
  });
  refused(() => text.caret(down(2.5)), {
    method: 'caret',
    argument: 'offset',
    offset: 2.5,
    reason: 'not-integer',
    textLength: 6,
    before: 1,
    after: 5,
  });
  assert.equal(
    (() => {
      try {
        text.replace(1, 3, 'x');
      } catch (error) {
        return error.message;
      }
    })(),
    'replace(): end 3 is inside a grapheme; nearest boundaries are 1 and 5 (UTF-16 code units of the source text)',
  );
  assert.equal(text.text, 'a\u{1f44d}\u{1f3fd}b', 'a refused replace changes nothing');
  assert.throws(() => text.replace(0, 1, 7), /insert must be a string/);
});

test('each query is one engine call once the text is prepared', async (t) => {
  const text = await mount(t, 'inter', 'one two three');
  text.measure();
  const budget = (call) => Object.values(crossingsOf(call)).reduce((sum, count) => sum + count, 0);
  assert.equal(
    budget(() => text.caret(down(4))),
    1,
  );
  assert.equal(
    budget(() => text.hitTest({ x: 20, y: 5 })),
    1,
  );
  assert.equal(
    budget(() => text.move(down(4), 'forward', 'word')),
    1,
  );
  assert.equal(
    budget(() => text.boundary(down(4), 'sentence')),
    1,
  );
  assert.equal(
    budget(() => text.rangeRects(0, 7)),
    1,
  );
  assert.equal(
    budget(() => text.replace(4, 7, 'deux')),
    1,
    'the range check; the edit itself waits for a read or a frame',
  );
  // A query after an edit prepares the paragraph first, as any read does.
  assert.equal(
    budget(() => text.caret(down(8))),
    2,
  );
});

test('replace edits the text and spans follow it', async (t) => {
  const big = span({ fontSize: 24 });
  const text = await mount(t, 'inter', txt`ab${big`cd`}ef`);
  const sizes = () => [...text.glyphs().glyphFontSizes];
  assert.deepEqual(sizes(), [16, 16, 24, 24, 16, 16]);
  // Typing at the end of the span continues it; typing at its start does not.
  text.replace(4, 4, 'X');
  assert.equal(text.text, 'abcdXef');
  assert.deepEqual(sizes(), [16, 16, 24, 24, 24, 16, 16]);
  text.replace(2, 2, 'Y');
  assert.equal(text.text, 'abYcdXef');
  assert.deepEqual(sizes(), [16, 16, 16, 24, 24, 24, 16, 16]);
  // The edited text lays out exactly as the same text set whole.
  const fresh = await mount(t, 'inter', txt`abY${big`cdX`}ef`);
  assert.deepEqual([...text.glyphs().x], [...fresh.glyphs().x]);
  assert.deepEqual(text.rangeRects(0, 8), fresh.rangeRects(0, 8));
  // Deleting a span's whole text drops it; the rest shifts.
  text.replace(3, 6, '');
  assert.equal(text.text, 'abYef');
  assert.deepEqual(sizes(), [16, 16, 16, 16, 16]);
});

test('replace tells the engine the range it was given, not one compared from the two texts', async (t) => {
  // Three equal letters with a span over the last two. Inserting another `a` at offset 1 is ambiguous to a
  // comparison of "aaa" and "aaaa" (it sees an append), but not to the caller: the new letter follows the
  // first, unstyled one, takes its style, and is the only new text unit.
  const big = span({ fontSize: 24 });
  const text = await mount(t, 'inter', txt`a${big`aa`}`);
  const before = [...text.glyphs().glyphStableIds];
  assert.deepEqual([...text.glyphs().glyphFontSizes], [16, 24, 24]);
  text.replace(1, 1, 'a');
  assert.equal(text.text, 'aaaa');
  const layout = text.glyphs();
  assert.deepEqual([...layout.glyphFontSizes], [16, 16, 24, 24], 'the insert takes the style of the letter before it');
  const ids = [...layout.glyphStableIds];
  assert.deepEqual([ids[0], ids[2], ids[3]], before, 'the three letters that were there keep their identity');
  assert.ok(!before.includes(ids[1]), 'the inserted letter is the new one');

  // The same edit at the end of the span continues the span, and is the last unit.
  text.replace(4, 4, 'a');
  assert.deepEqual([...text.glyphs().glyphFontSizes], [16, 16, 24, 24, 24]);
  assert.deepEqual([...text.glyphs().glyphStableIds].slice(0, 4), ids);

  // A whole-string setter states no range, so the same change made that way is compared, and reads as an
  // append: the control that shows the stated range is what told the engine otherwise.
  const compared = await mount(t, 'inter', 'aaa');
  const comparedBefore = [...compared.glyphs().glyphStableIds];
  compared.text = 'aaaa';
  const comparedAfter = [...compared.glyphs().glyphStableIds];
  assert.deepEqual(comparedAfter.slice(0, 3), comparedBefore);
  assert.ok(!comparedBefore.includes(comparedAfter[3]));
});

test('the span rule agrees with the engine on the shared vectors', async () => {
  const vectors = JSON.parse(await readFile(new URL('../fixtures/span-rebase-vectors.json', import.meta.url), 'utf8'));
  assert.ok(vectors.cases.length > 20);
  for (const {
    name,
    span: [start, end],
    replace,
    inserted,
    result,
  } of vectors.cases) {
    const rebased = rebaseSpanRange({ start, end }, replace[0], replace[1], inserted);
    assert.deepEqual(rebased === undefined ? null : [rebased.start, rebased.end], result, name);
  }
});

// An input method composes by replacing its own provisional text until the user commits. An application needs
// nothing from the engine for that but `replace` and `rangeRects`: it tracks the composition as
// `[start, start + insert.length)` itself and underlines the rectangles of that range.
for (const [name, font, before, steps, committed] of [
  ['Latin', 'inter', 'I say  now', ['n', 'ni', 'nih', 'nihao', '你好'], 'hello'],
  ['Arabic', 'amiri', 'قال  هنا', ['س', 'سل', 'سلا', 'سلام'], 'سلام'],
  ['a ligature font', 'fredoka', 'an  desk', ['o', 'of', 'off', 'offi', 'offic'], 'office'],
]) {
  test(`an input-method composition needs only replace and rangeRects: ${name}`, async (t) => {
    const text = await mount(t, font, before);
    const start = before.indexOf('  ') + 1;
    let composition = { start, end: start };
    const compose = (insert) => {
      text.replace(composition.start, composition.end, insert);
      composition = { start: composition.start, end: composition.start + insert.length };
    };
    for (const step of steps) {
      compose(step);
      assert.equal(text.text, before.slice(0, start) + step + before.slice(start));
      // The underline: every rectangle of the composition is on a line and has the step's extent.
      const rects = text.rangeRects(composition.start, composition.end);
      assert.ok(rects.length >= 1, `"${step}" has no rectangle`);
      const caret = text.caret({ offset: composition.end, affinity: 'upstream' });
      const edges = rects.flatMap((rect) => [rect.x, rect.x + rect.width]);
      assert.ok(
        edges.some((edge) => Math.abs(edge - caret.rect.x) < 1e-3),
        `the caret after "${step}" is at an edge of its underline`,
      );
      assert.ok(rects.every((rect) => rect.width > 0 && rect.height === caret.rect.height));
      // Every boundary inside the composition is a valid offset with a caret, ligature or not.
      for (let offset = composition.start; offset <= composition.end; offset += 1) {
        assert.equal(typeof text.caret({ offset, affinity: 'upstream' }).rect.x, 'number');
      }
    }
    compose(committed);
    const expected = before.slice(0, start) + committed + before.slice(start);
    assert.equal(text.text, expected);
    // After the commit the paragraph is exactly the paragraph an application would have set whole.
    const fresh = await mount(t, font, expected);
    assert.deepEqual([...text.glyphs().x], [...fresh.glyphs().x]);
    assert.deepEqual([...text.glyphs().glyphIds], [...fresh.glyphs().glyphIds]);
    for (let offset = 0; offset <= expected.length; offset += 1) {
      assert.deepEqual(text.caret({ offset, affinity: 'downstream' }), fresh.caret({ offset, affinity: 'downstream' }));
    }
    assert.deepEqual(
      text.boundary({ offset: start, affinity: 'downstream' }, 'word'),
      fresh.boundary({ offset: start, affinity: 'downstream' }, 'word'),
    );
  });
}

test('the ligature a composition forms has a stop inside it', async (t) => {
  // Fredoka draws `ffi` as one glyph with GDEF carets at 285 and 569 of 1000 units.
  const text = await mount(t, 'fredoka', 'office');
  const layout = text.glyphs();
  assert.equal(layout.glyphCount, 4, 'o, ffi, c, e');
  const pen = layout.x[1];
  near(text.caret(down(2)).rect.x, pen + (285 / 1000) * 16, 'after the first f');
  near(text.caret(down(3)).rect.x, pen + (569 / 1000) * 16, 'after the second f');
  near(text.rangeRects(2, 3)[0].width, ((569 - 285) / 1000) * 16, 'the middle f');
  assert.deepEqual(text.move(down(1), 'forward', 'grapheme').position, down(2));
});
