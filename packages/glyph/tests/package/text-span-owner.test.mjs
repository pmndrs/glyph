import assert from 'node:assert/strict';
import test from 'node:test';

import { mapTextSpanBindings, ownTextInput, ownTextSpanRecords } from '../../dist/config/text-span-owner.js';

const coreMode = { kind: 'core', textLength: 4 };

test('span ownership detaches caller records and styles while retaining binding values', () => {
  const font = {};
  const material = {};
  const input = {
    start: 0,
    end: 2,
    font,
    material,
    style: { color: '#ff0000', decoration: { underline: true } },
  };

  const [owned] = ownTextSpanRecords(undefined, [input], coreMode);
  input.start = 1;
  input.style.color = '#0000ff';
  input.style.decoration.underline = false;

  assert.notEqual(owned, input);
  assert.notEqual(owned.style, input.style);
  assert.equal(owned.start, 0);
  assert.equal(owned.font, font);
  assert.equal(owned.material, material);
  assert.deepEqual(owned.style, { color: '#ff0000', decoration: { underline: true } });
  assert.equal(Object.isFrozen(owned), true);
});

test('equal spans retain the exact prior array and records; a changed span preserves equal siblings', () => {
  const firstFont = { kind: 'font' };
  const firstMaterial = { kind: 'material' };
  const secondFont = { kind: 'font' };
  const secondMaterial = { kind: 'material' };
  const first = { start: 0, end: 1, font: firstFont, material: firstMaterial, style: { color: '#ff0000' } };
  const second = { start: 1, end: 2, font: secondFont, material: secondMaterial, style: { color: '#0000ff' } };
  const prior = ownTextSpanRecords(undefined, [first, second], coreMode);
  const equal = ownTextSpanRecords(
    prior,
    [
      { start: 0, end: 1, font: firstFont, material: firstMaterial, style: { color: '#ff0000' } },
      { start: 1, end: 2, font: secondFont, material: secondMaterial, style: { color: '#0000ff' } },
    ],
    coreMode,
  );
  assert.equal(equal, prior);

  const changed = ownTextSpanRecords(
    prior,
    [
      { start: 0, end: 1, font: firstFont, material: firstMaterial, style: { color: '#ff0000' } },
      { start: 1, end: 2, font: { kind: 'font' }, material: secondMaterial, style: { color: '#0000ff' } },
    ],
    coreMode,
  );
  assert.notEqual(changed, prior);
  assert.equal(changed[0], prior[0]);
  assert.notEqual(changed[1], prior[1]);
  assert.notEqual(changed[1].font, secondFont, 'equal-looking but distinct bindings replace only their span record');
  assert.deepEqual(changed[1].font, secondFont);
  assert.equal(Object.isFrozen(changed), true);
});

test('core validates each span style before reading a later span', () => {
  let firstFontReads = 0;
  const spans = [
    {
      start: 0,
      end: 1,
      style: { fontSize: 0 },
      get font() {
        firstFontReads += 1;
        return {};
      },
    },
    { start: 'invalid', end: 2 },
  ];

  assert.throws(
    () => ownTextSpanRecords(undefined, spans, coreMode),
    (error) => error instanceof RangeError && error.message === 'text span 0 style fontSize must be positive',
  );
  assert.equal(firstFontReads, 0);
});

test('core span object, integer, and bounds failures retain their exact boundary errors', () => {
  const cases = [
    { name: 'null span', span: null, ErrorType: TypeError, message: 'text span 0 must be an object' },
    { name: 'array span', span: [], ErrorType: TypeError, message: 'text span 0 must be an object' },
    {
      name: 'fractional bound',
      span: { start: 0.5, end: 1 },
      ErrorType: TypeError,
      message: 'text span 0 bounds must be safe integers',
    },
    {
      name: 'unsafe bound',
      span: { start: Number.MAX_SAFE_INTEGER + 1, end: Number.MAX_SAFE_INTEGER + 2 },
      ErrorType: TypeError,
      message: 'text span 0 bounds must be safe integers',
    },
    {
      name: 'negative bound',
      span: { start: -1, end: 1 },
      ErrorType: RangeError,
      message: 'text span 0 is outside the text',
    },
    {
      name: 'inverted bound',
      span: { start: 2, end: 1 },
      ErrorType: RangeError,
      message: 'text span 0 is outside the text',
    },
    {
      name: 'past-end bound',
      span: { start: 0, end: 5 },
      ErrorType: RangeError,
      message: 'text span 0 is outside the text',
    },
  ];

  for (const { name, span, ErrorType, message } of cases) {
    assert.throws(
      () => ownTextSpanRecords(undefined, [span], coreMode),
      (error) => error instanceof ErrorType && error.message === message,
      name,
    );
  }
});

test('Three owns only canonical fields and reads each binding/style getter once', () => {
  const font = {};
  let fontReads = 0;
  let styleReads = 0;
  const input = {
    start: 0,
    end: 1,
    get font() {
      fontReads += 1;
      return fontReads === 1 ? font : { changed: true };
    },
    get style() {
      styleReads += 1;
      return styleReads === 1 ? undefined : { fontSize: 0 };
    },
    extra: 'preserved',
  };

  const [owned] = ownTextSpanRecords(undefined, [input], { kind: 'three' });

  assert.equal(owned.font, font);
  assert.equal(owned.style, undefined);
  assert.equal(Object.hasOwn(owned, 'extra'), false);
  assert.equal(fontReads, 1);
  assert.equal(styleReads, 1);
});

test('frozen caller data is not provenance for owned styles or core range proof', () => {
  const forgedStyle = Object.freeze({ fontSize: 0 });
  const forged = Object.freeze({ start: 0, end: 1, style: forgedStyle });
  const forgedArray = Object.freeze([forged]);
  const frozenRanges = Object.freeze([{ start: 0, end: 1 }]);

  assert.throws(
    () => ownTextSpanRecords(undefined, forgedArray, coreMode),
    (error) => error instanceof RangeError && error.message === 'text span 0 style fontSize must be positive',
  );
  assert.notEqual(ownTextSpanRecords(undefined, frozenRanges, coreMode), frozenRanges);
});

test('unowned previous arrays and records are never adopted', () => {
  const previousRecord = Object.freeze({ start: 0, end: 1, style: Object.freeze({ color: '#ff0000' }) });
  const previous = Object.freeze([previousRecord]);
  const actual = Object.freeze([{ start: 0, end: 1, style: Object.freeze({ color: '#ff0000' }) }]);

  const owned = ownTextSpanRecords(previous, actual, coreMode);

  assert.notEqual(owned, previous);
  assert.notEqual(owned[0], previousRecord);
  assert.equal(owned[0].style.color, '#ff0000');
});

test('Three compares a different owned array against its authenticated prior', () => {
  const prior = ownTextSpanRecords(undefined, [{ start: 0, end: 1, style: { color: '#ff0000' } }], {
    kind: 'three',
  });
  const candidate = ownTextSpanRecords(undefined, [{ start: 0, end: 1, style: { color: '#ff0000' } }], {
    kind: 'three',
  });

  assert.notEqual(candidate, prior);
  assert.equal(ownTextSpanRecords(prior, candidate, { kind: 'three' }), prior);
});

test('owned range proof is checked again when text length changes', () => {
  const owned = ownTextSpanRecords(undefined, [{ start: 2, end: 4 }], coreMode);

  assert.throws(
    () => ownTextSpanRecords(undefined, owned, { kind: 'core', textLength: 3 }),
    (error) => error instanceof RangeError && error.message === 'text span 0 is outside the text',
  );
});

test('feature-scope proof is optional for ordinary core input and labeled when requested', () => {
  const stated = [{ start: 0, end: 2, style: { features: [{ tag: 'kern', start: 1, end: 3 }] } }];
  const ordinary = ownTextSpanRecords(undefined, stated, { kind: 'core', textLength: 4 });

  assert.equal(ordinary.length, 1);
  assert.throws(
    () => ownTextSpanRecords(undefined, ordinary, { kind: 'core', textLength: 4, featureScopeLabel: 'span style' }),
    (error) => error instanceof RangeError && error.message === 'span style feature 0 (kern) must stay inside [0, 2)',
  );
  assert.throws(
    () =>
      ownTextSpanRecords(undefined, [{ start: 0, end: 1, style: { fontSize: 0 } }], {
        kind: 'core',
        textLength: 4,
        featureScopeLabel: 'span style',
      }),
    (error) => error instanceof RangeError && error.message === 'span style fontSize must be positive',
  );

  const valid = ownTextSpanRecords(
    undefined,
    [{ start: 1, end: 3, style: { features: [{ tag: 'kern', start: 1, end: 3 }] } }],
    { kind: 'core', textLength: 4 },
  );
  assert.equal(
    ownTextSpanRecords(undefined, valid, { kind: 'core', textLength: 4, featureScopeLabel: 'span style' }),
    valid,
  );

  const ownedStylesOnly = ownTextSpanRecords(
    undefined,
    [{ start: 0, end: 2, style: { features: [{ tag: 'kern', start: 1, end: 3 }] } }],
    { kind: 'three' },
  );
  assert.throws(
    () =>
      ownTextSpanRecords(undefined, ownedStylesOnly, {
        kind: 'core',
        textLength: 4,
        featureScopeLabel: 'span style',
      }),
    (error) => error instanceof RangeError && error.message === 'span style feature 0 (kern) must stay inside [0, 2)',
  );
  assert.throws(
    () =>
      ownTextSpanRecords(undefined, ownedStylesOnly, {
        kind: 'core',
        textLength: 4,
        featureScopeLabel: 'span style',
      }),
    (error) => error instanceof RangeError && error.message === 'span style feature 0 (kern) must stay inside [0, 2)',
  );
  const validated = ownTextSpanRecords(undefined, ownedStylesOnly, { kind: 'core', textLength: 4 });
  assert.equal(validated, ownedStylesOnly, 'owned styles are retained while missing bounds are proved');

  const validStylesOnly = ownTextSpanRecords(
    undefined,
    [{ start: 1, end: 3, style: { features: [{ tag: 'kern', start: 1, end: 3 }] } }],
    { kind: 'three' },
  );
  assert.equal(
    ownTextSpanRecords(undefined, validStylesOnly, {
      kind: 'core',
      textLength: 4,
      featureScopeLabel: 'span style',
    }),
    validStylesOnly,
    'scope validation upgrades the existing immutable records in place',
  );

  const provenScope = ownTextSpanRecords(
    undefined,
    [{ start: 0, end: 3, style: { features: [{ tag: 'kern', start: 0, end: 3 }] } }],
    { kind: 'core', textLength: 4, featureScopeLabel: 'span style' },
  );
  assert.throws(
    () =>
      ownTextSpanRecords(provenScope, [{ start: 0, end: 2, style: provenScope[0].style }], {
        kind: 'core',
        textLength: 4,
        featureScopeLabel: 'span style',
      }),
    (error) => error instanceof RangeError && error.message === 'span style feature 0 (kern) must stay inside [0, 2)',
  );
});

test('binding projection preserves canonical data and transfers only proven span data', () => {
  const sourceFont = {};
  const sourceMaterial = {};
  const boundFont = {};
  const boundMaterial = {};
  const source = ownTextSpanRecords(
    undefined,
    [
      { start: 0, end: 2, font: sourceFont, material: sourceMaterial, style: { color: '#00ff00' } },
      { start: 2, end: 3, font: sourceFont },
    ],
    coreMode,
  );
  const calls = [];
  const projected = mapTextSpanBindings(source, {
    font(font) {
      calls.push(['font', font]);
      return boundFont;
    },
    material(material) {
      calls.push(['material', material]);
      return boundMaterial;
    },
  });

  assert.deepEqual(calls, [
    ['font', sourceFont],
    ['material', sourceMaterial],
    ['font', sourceFont],
  ]);
  assert.notEqual(projected, source);
  assert.notEqual(projected[0], source[0]);
  assert.equal(projected[0].start, source[0].start);
  assert.equal(projected[0].end, source[0].end);
  assert.equal(projected[0].style, source[0].style);
  assert.equal(projected[0].font, boundFont);
  assert.equal(projected[0].material, boundMaterial);
  assert.equal(projected[1].font, boundFont);
  assert.equal(Object.hasOwn(projected[1], 'material'), false);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected[0]), true);
  assert.equal(ownTextSpanRecords(undefined, projected, coreMode), projected);

  const unowned = [{ start: 0, end: 5 }];
  const unownedProjection = mapTextSpanBindings(unowned, { font: (font) => font, material: (material) => material });
  assert.throws(
    () => ownTextSpanRecords(undefined, unownedProjection, coreMode),
    (error) => error instanceof RangeError && error.message === 'text span 0 is outside the text',
  );

  const order = [];
  const getterSource = [
    {
      get font() {
        order.push('read font');
        return sourceFont;
      },
      get material() {
        order.push('read material');
        return sourceMaterial;
      },
      get start() {
        order.push('read start');
        return 0;
      },
      get end() {
        order.push('read end');
        return 1;
      },
      get style() {
        order.push('read style');
        return undefined;
      },
    },
  ];
  mapTextSpanBindings(getterSource, {
    font(font) {
      order.push('bind font');
      return font;
    },
    material(material) {
      order.push('bind material');
      return material;
    },
  });
  assert.deepEqual(order, [
    'read font',
    'bind font',
    'read material',
    'bind material',
    'read start',
    'read end',
    'read style',
  ]);
});

test('ownTextInput snapshots strings and envelopes and keeps empty spans immutable', () => {
  const plain = ownTextInput('abc');
  const stated = { text: 'xy', spans: [] };
  const formatted = ownTextInput(stated);
  const frozenStated = Object.freeze({ text: 'z', spans: Object.freeze([]) });
  const frozenFormatted = ownTextInput(frozenStated);
  const forgedEmpty = Object.freeze([]);
  const ownedEmpty = ownTextSpanRecords(undefined, forgedEmpty, { kind: 'core', textLength: 0 });

  assert.deepEqual(plain, { text: 'abc', spans: [] });
  assert.equal(Object.isFrozen(plain), true);
  assert.equal(Object.isFrozen(plain.spans), true);
  assert.notEqual(formatted, stated);
  assert.equal(Object.isFrozen(formatted), true);
  assert.equal(Object.isFrozen(formatted.spans), true);
  assert.notEqual(frozenFormatted, frozenStated);
  assert.notEqual(frozenFormatted.spans, frozenStated.spans);
  assert.notEqual(ownedEmpty, forgedEmpty);
  assert.equal(Object.isFrozen(ownedEmpty), true);
  assert.throws(
    () => ownTextInput(null),
    (error) => error instanceof TypeError && error.message === 'text must be a string or formatted text value',
  );
  assert.throws(
    () => ownTextInput({ text: 1, spans: [] }),
    (error) => error instanceof TypeError && error.message === 'text must be a string or formatted text value',
  );
  assert.throws(
    () => ownTextInput({ text: 'x', spans: {} }),
    (error) => error instanceof TypeError && error.message === 'text must be a string or formatted text value',
  );
});
