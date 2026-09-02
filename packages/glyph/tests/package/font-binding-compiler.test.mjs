import assert from 'node:assert/strict';
import test from 'node:test';

import { compileFontBinding, emptyFontBindingTable, schemaFieldTable } from '../../dist/internal/font-binding.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const MISSING_RESOURCE = 0xffff_ffff;
const MAX_U16 = 0xffff;
const abi = textShaperAbi;
const request = abi.layouts.fontBindingRequest;

function countingTable(rows, names, value) {
  const calls = [];
  const readers = Object.fromEntries(
    names.map((name) => [
      name,
      (row) => {
        calls.push(`${name}:${row}`);
        return typeof value === 'function' ? value(row) : value;
      },
    ]),
  );
  return { table: schemaFieldTable(names, rows, readers), calls };
}

function validDescriptor() {
  const glyphF32 = countingTable(3, ['bearingX'], () => 0.1);
  const strikeU32 = countingTable(3, ['page'], (row) => row);
  const resourceF32 = countingTable(2, ['opacity'], 0.25);
  return {
    descriptor: {
      techniqueId: 7,
      programVariant: 2,
      glyphCount: 3,
      strikes: [0],
      resources: [
        { key: 'alpha', id: 11, generation: 1, kind: 2, reference: 91 },
        { key: 'beta', id: 12, generation: 1, kind: 1, reference: 92 },
      ],
      resourceIndex: (row) => (row === 2 ? MISSING_RESOURCE : row),
      glyphF32: glyphF32.table,
      glyphU32: emptyFontBindingTable(3),
      strikeF32: emptyFontBindingTable(3),
      strikeU32: strikeU32.table,
      resourceF32: resourceF32.table,
      resourceU32: emptyFontBindingTable(2),
    },
    readers: { glyphF32: glyphF32.calls, strikeU32: strikeU32.calls, resourceF32: resourceF32.calls },
  };
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function scalarTableRange(bytes, name, rows) {
  const count = viewOf(bytes).getUint8(request[`${name}FieldCount`]);
  const offset = viewOf(bytes).getUint32(request[`${name}Offset`], true);
  return { count, offset, end: offset + count * rows * 4 };
}

test('a valid descriptor compiles header, tables, and reserved regions exactly as declared', () => {
  const { descriptor } = validDescriptor();
  const bytes = compileFontBinding(descriptor);
  const view = viewOf(bytes);

  assert.equal(view.getUint32(request.abiVersion, true), abi.version);
  assert.equal(view.getUint32(request.byteLength, true), bytes.byteLength);
  assert.equal(view.getUint32(request.techniqueId, true), 7);
  assert.equal(view.getUint16(request.programVariant, true), 2);
  assert.equal(view.getUint32(request.glyphCount, true), 3);
  assert.equal(view.getUint32(request.strikeCount, true), 1);
  assert.equal(view.getUint32(request.resourceCount, true), 2);
  assert.equal(view.getUint16(request.reserved0, true), 0);
  assert.equal(view.getUint16(request.reserved1, true), 0);
  assert.equal(view.getUint32(request.reserved2, true), 0);

  const strike = abi.layouts.fontBindingStrike;
  const strikesOffset = view.getUint32(request.strikesOffset, true);
  assert.equal(view.getUint32(strikesOffset + strike.ppem, true), 0);
  assert.equal(view.getUint32(strikesOffset + strike.reserved, true), 0);

  const resource = abi.layouts.fontBindingResource;
  const resourcesOffset = view.getUint32(request.resourcesOffset, true);
  const decodedResources = [0, 1].map((index) => {
    const offset = resourcesOffset + index * resource.size;
    return [
      view.getUint32(offset + resource.id, true),
      view.getUint32(offset + resource.generation, true),
      view.getUint16(offset + resource.kind, true),
      view.getUint32(offset + resource.reference, true),
    ];
  });
  assert.deepEqual(decodedResources, [
    [11, 1, 2, 91],
    [12, 1, 1, 92],
  ]);
  assert.equal(view.getUint16(resourcesOffset + resource.reserved, true), 0);

  const indicesOffset = view.getUint32(request.resourceIndicesOffset, true);
  assert.deepEqual(
    [0, 1, 2].map((row) => view.getUint32(indicesOffset + row * 4, true)),
    [0, 1, MISSING_RESOURCE],
  );
});

test('compiled field-major lanes round-trip every f32 through Math.fround', () => {
  const { descriptor } = validDescriptor();
  const bytes = compileFontBinding(descriptor);
  const glyphF32 = scalarTableRange(bytes, 'glyphF32', 3);
  assert.equal(glyphF32.count, 1);
  const lane = new Float32Array(bytes.buffer, bytes.byteOffset + glyphF32.offset, 3);
  assert.deepEqual([...lane], [Math.fround(0.1), Math.fround(0.1), Math.fround(0.1)]);

  const strikeU32 = scalarTableRange(bytes, 'strikeU32', 3);
  const pageLane = new Uint32Array(bytes.buffer, bytes.byteOffset + strikeU32.offset, 3);
  assert.deepEqual([...pageLane], [0, 1, 2]);

  const resourceF32 = scalarTableRange(bytes, 'resourceF32', 2);
  const opacityLane = new Float32Array(bytes.buffer, bytes.byteOffset + resourceF32.offset, 2);
  assert.equal(opacityLane[0], Math.fround(0.25));

  for (const name of ['glyphU32', 'strikeF32', 'resourceU32']) {
    assert.equal(scalarTableRange(bytes, name, 3).offset, 0);
    assert.equal(scalarTableRange(bytes, name, 3).count, 0);
  }
});

test('populated table ranges are aligned, disjoint, and inside the allocation', () => {
  const { descriptor } = validDescriptor();
  const bytes = compileFontBinding(descriptor);
  const ranges = [
    ['strikes', viewOf(bytes).getUint32(request.strikesOffset, true), 8],
    ['resources', viewOf(bytes).getUint32(request.resourcesOffset, true), 16],
    ['indices', viewOf(bytes).getUint32(request.resourceIndicesOffset, true), 12],
    ...['glyphF32', 'glyphU32', 'strikeF32', 'strikeU32', 'resourceF32', 'resourceU32'].map((name) => {
      const range = scalarTableRange(bytes, name, 3);
      return [name, range.offset, range.end - range.offset];
    }),
  ].filter(([, offset]) => offset !== 0);
  for (const [, offset] of ranges) {
    assert.equal(offset % 4, 0, `${offset} must stay aligned`);
    assert.ok(offset >= request.size, `${offset} must sit behind the request header`);
  }
  ranges.sort((left, right) => left[1] - right[1]);
  for (let index = 1; index < ranges.length; index += 1) {
    const previousEnd = ranges[index - 1][1] + ranges[index - 1][2];
    assert.ok(ranges[index][1] >= previousEnd, `${ranges[index][0]} overlaps ${ranges[index - 1][0]}`);
  }
});

test('each getter is read exactly once and each reader runs once per row on success', () => {
  const reads = {};
  const descriptor = {
    get techniqueId() {
      reads.techniqueId = (reads.techniqueId ?? 0) + 1;
      return 7;
    },
    get programVariant() {
      reads.programVariant = (reads.programVariant ?? 0) + 1;
      return 2;
    },
    get glyphCount() {
      reads.glyphCount = (reads.glyphCount ?? 0) + 1;
      return 2;
    },
    get strikes() {
      reads.strikes = (reads.strikes ?? 0) + 1;
      return [0];
    },
    get resources() {
      reads.resources = (reads.resources ?? 0) + 1;
      return [{ key: 'alpha', id: 5, generation: 1, kind: 1, reference: 9 }];
    },
  };
  for (const name of ['glyphF32', 'glyphU32', 'strikeF32', 'strikeU32']) {
    Object.defineProperty(descriptor, name, {
      get() {
        reads[name] = (reads[name] ?? 0) + 1;
        return emptyFontBindingTable(2);
      },
    });
  }
  for (const name of ['resourceF32', 'resourceU32']) {
    Object.defineProperty(descriptor, name, {
      get() {
        reads[name] = (reads[name] ?? 0) + 1;
        return emptyFontBindingTable(1);
      },
    });
  }
  const resourceRows = [];
  Object.defineProperty(descriptor, 'resourceIndex', {
    get() {
      reads.resourceIndex = (reads.resourceIndex ?? 0) + 1;
      return (row) => {
        resourceRows.push(row);
        return 0;
      };
    },
  });

  compileFontBinding(descriptor);
  for (const property of [...Object.keys(reads)]) {
    assert.equal(reads[property], 1, `${property} must be read exactly once`);
  }
  assert.deepEqual(resourceRows, [0, 1]);
});

test('each table reader runs exactly once per row on a successful compile', () => {
  const { descriptor, readers } = validDescriptor();
  compileFontBinding(descriptor);
  assert.deepEqual(readers.glyphF32, ['bearingX:0', 'bearingX:1', 'bearingX:2']);
  assert.deepEqual(readers.strikeU32, ['page:0', 'page:1', 'page:2']);
  assert.deepEqual(readers.resourceF32, ['opacity:0', 'opacity:1']);
});

test('table readers run exactly once per row with no retries when a later row fails', () => {
  const { descriptor, readers } = validDescriptor();
  descriptor.strikeU32 = schemaFieldTable(['page'], 3, {
    page: (row) => {
      readers.strikeU32.push(row);
      return row === 2 ? -7 : row;
    },
  });

  assert.throws(() => compileFontBinding(descriptor), /strikeU32\.page row 2/);
  assert.deepEqual(readers.glyphF32, ['bearingX:0', 'bearingX:1', 'bearingX:2']);
  assert.deepEqual(readers.strikeU32, [0, 1, 2]);
  assert.deepEqual(readers.resourceF32, []);
});

test('an invalid descriptor field rejects before any reader or resource reader runs', () => {
  const { descriptor, readers } = validDescriptor();
  descriptor.techniqueId = 0;
  let resourceReads = 0;
  descriptor.resourceIndex = () => {
    resourceReads += 1;
    return 0;
  };

  assert.throws(() => compileFontBinding(descriptor), /techniqueId/);
  assert.equal(resourceReads, 0);
  assert.deepEqual(readers.glyphF32, []);
  assert.deepEqual(readers.strikeU32, []);
  assert.deepEqual(readers.resourceF32, []);
});

test('all table shapes validate before the resource selector or any table reader runs', () => {
  const { descriptor, readers } = validDescriptor();
  let resourceReads = 0;
  descriptor.resourceIndex = () => {
    resourceReads += 1;
    return 0;
  };
  descriptor.resourceU32 = { rows: 2, fields: [null] };

  assert.throws(() => compileFontBinding(descriptor), /resourceU32 field 0 must be a function/);
  assert.equal(resourceReads, 0);
  assert.deepEqual(readers.glyphF32, []);
  assert.deepEqual(readers.strikeU32, []);
  assert.deepEqual(readers.resourceF32, []);
});

test('every numeric width and category is rejected with a named error', () => {
  const cases = [
    [['techniqueId', -1], /techniqueId must be a u32/],
    [['techniqueId', 1.5], /techniqueId must be a u32/],
    [['techniqueId', Number.NaN], /techniqueId must be a u32/],
    [['techniqueId', 2 ** 32], /techniqueId must be a u32/],
    [['techniqueId', 0], /reserved zero technique/],
    [['programVariant', -1], /programVariant must be a u16/],
    [['programVariant', 2.5], /programVariant must be a u16/],
    [['programVariant', MAX_U16 + 1], /programVariant must be a u16/],
    [['programVariant', Number.NaN], /programVariant must be a u16/],
    [['glyphCount', 0], /glyphCount must be positive/],
    [['glyphCount', -2], /glyphCount must be a u32/],
    [['glyphCount', 1.5], /glyphCount must be a u32/],
    [['glyphCount', MAX_U16 + 1], /exceeds the u16 wire maximum/],
    [['strikes', []], /strikes must contain between/],
    [['strikes', [-4]], /strikes\[0\] ppem must be a u32/],
    [['strikes', [16.5]], /strikes\[0\] ppem must be a u32/],
    [['strikes', [Number.NaN]], /strikes\[0\] ppem must be a u32/],
    [['strikes', [2 ** 32]], /strikes\[0\] ppem must be a u32/],
    [['strikes', [0, 16]], /sole scalable strike/],
    [['strikes', [16, 16]], /strictly increase/],
    [['strikes', [32, 16]], /strictly increase/],
    [['strikes', new Array(MAX_U16 + 1).fill(16)], /strikes must contain between/],
    [['resources', []], /resources must contain between/],
    [
      ['resources', new Array(MAX_U16 + 1).fill({ id: 1, generation: 1, kind: 1, reference: 1 })],
      /resources must contain between/,
    ],
    [['resources', 'nope'], /resources must be an array/],
    [
      ['resources', [{ id: 0, generation: 1, kind: 1, reference: 1 }]],
      /resources\[0\]\.id must not be the reserved zero identity/,
    ],
    [
      ['resources', [{ id: 1, generation: 0, kind: 1, reference: 1 }]],
      /resources\[0\]\.generation must not be the reserved zero generation/,
    ],
    [
      ['resources', [{ id: 1, generation: 1, kind: 0, reference: 1 }]],
      /resources\[0\]\.kind 0 must be between 1 and 32/,
    ],
    [
      ['resources', [{ id: 1, generation: 1, kind: 33, reference: 1 }]],
      /resources\[0\]\.kind 33 must be between 1 and 32/,
    ],
    [['resources', [{ id: 1, generation: 1, kind: -1, reference: 1 }]], /resources\[0\]\.kind must be a u16/],
    [['resources', [{ id: 1, generation: 1, kind: 1.5, reference: 1 }]], /resources\[0\]\.kind must be a u16/],
    [['resources', [{ id: 1, generation: 1, kind: 1, reference: -1 }]], /resources\[0\]\.reference must be a u32/],
    [['resources', [{ id: 1.5, generation: 1, kind: 1, reference: 1 }]], /resources\[0\]\.id must be a u32/],
    [
      [
        'resources',
        [
          { id: 5, generation: 1, kind: 1, reference: 1 },
          { id: 5, generation: 1, kind: 1, reference: 2 },
        ],
      ],
      /resources\[1\]\.id 5 must strictly increase/,
    ],
    [
      [
        'resources',
        [
          { id: 9, generation: 1, kind: 1, reference: 1 },
          { id: 4, generation: 1, kind: 1, reference: 2 },
        ],
      ],
      /resources\[1\]\.id 4 must strictly increase/,
    ],
    [['resources', ['x']], /resources\[0\] must be an object/],
    [['resourceIndex', undefined], /resourceIndex must be a function/],
  ];
  for (const [[field, value], pattern] of cases) {
    const { descriptor } = validDescriptor();
    descriptor[field] = value;
    assert.throws(() => compileFontBinding(descriptor), pattern, `${field} = ${String(value)}`);
  }
});

test('resource indexes outside the declared table are rejected by row', () => {
  const domainFailures = [
    [-1, /resourceIndex\(0\) must be a u32/],
    [1.5, /resourceIndex\(0\) must be a u32/],
    [Number.NaN, /resourceIndex\(0\) must be a u32/],
    [2 ** 32, /resourceIndex\(0\) must be a u32/],
    [2, /resourceIndex\(0\) selected resource 2 outside the 2 declared resources/],
    [MISSING_RESOURCE + 1, /resourceIndex\(0\) must be a u32/],
  ];
  for (const [selected, pattern] of domainFailures) {
    const { descriptor } = validDescriptor();
    descriptor.resourceIndex = () => selected;
    assert.throws(() => compileFontBinding(descriptor), pattern, `resourceIndex returning ${String(selected)}`);
  }
  const { descriptor } = validDescriptor();
  descriptor.resourceIndex = (row) => (row === 1 ? 9 : 0);
  assert.throws(() => compileFontBinding(descriptor), /resourceIndex\(1\) selected resource 9/);
});

test('f32 tables reject nonfinite values and doubles that overflow after fround, naming field and row', () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    const { descriptor } = validDescriptor();
    descriptor.glyphF32 = schemaFieldTable(['bearingX'], 3, { bearingX: (row) => (row === 1 ? value : 0) });
    const failure = (() => {
      try {
        compileFontBinding(descriptor);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(failure instanceof TypeError, `glyphF32 bearingX ${String(value)} must throw a TypeError`);
    assert.match(failure.message, /glyphF32\.bearingX row 1 produced a nonfinite value/);
  }

  const { descriptor } = validDescriptor();
  descriptor.resourceF32 = schemaFieldTable(['opacity'], 2, { opacity: () => Number.MAX_VALUE });
  assert.throws(
    () => compileFontBinding(descriptor),
    /resourceF32\.opacity row 0 produced .*, which is not a finite f32/,
  );
});

test('u32 tables reject negatives, fractions, nonfinite values, and overflow, naming field and row', () => {
  for (const value of [-1, 1.5, Number.NaN, 2 ** 32]) {
    const { descriptor } = validDescriptor();
    descriptor.strikeU32 = schemaFieldTable(['page'], 3, { page: (row) => (row === 2 ? value : 0) });
    const failure = (() => {
      try {
        compileFontBinding(descriptor);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    assert.ok(failure instanceof RangeError, `strikeU32 page ${String(value)} must throw a RangeError`);
    assert.match(failure.message, /font binding strikeU32\.page row 2 must be a u32/);
  }
});

test('unnamed fields are still named by table and field index', () => {
  const { descriptor } = validDescriptor();
  descriptor.glyphF32 = { rows: 3, fields: [(row) => (row === 1 ? Number.NaN : 0)] };
  assert.throws(() => compileFontBinding(descriptor), /font binding glyphF32 field 0 row 1 produced a nonfinite value/);
});

test('incorrect row domains are rejected for all six tables', () => {
  for (const name of ['glyphF32', 'glyphU32', 'strikeF32', 'strikeU32', 'resourceF32', 'resourceU32']) {
    const { descriptor } = validDescriptor();
    descriptor[name] = { ...descriptor[name], rows: descriptor[name].rows + 1 };
    assert.throws(
      () => compileFontBinding(descriptor),
      new RegExp(`${name} declares .* rows but this binding needs`),
      name,
    );
  }
});

test('excessive field counts and non-function readers are rejected', () => {
  const { descriptor } = validDescriptor();
  descriptor.glyphU32 = schemaFieldTable(
    Array.from({ length: 33 }, (_, index) => `f${index}`),
    3,
    Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`f${index}`, () => 0])),
  );
  assert.throws(() => compileFontBinding(descriptor), /glyphU32 has more than 32 fields/);

  const other = validDescriptor().descriptor;
  other.strikeF32 = { rows: 3, fields: [() => 0, null] };
  assert.throws(() => compileFontBinding(other), /strikeF32 field 1 must be a function/);
});
