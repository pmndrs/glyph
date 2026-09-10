const benchmarkCases = [
  'cold',
  'no-op',
  'publish-measurement',
  'publish-inspection',
  'font-size',
  'column-resize',
  'active-column-resize',
  'measure-query',
  'adopt-measure-query',
  'suffix-edit',
  'localized-edit',
  'localized-splice',
  'justify',
  'bidi-resize',
  'equivalent-width',
];

export function rustLayoutBenchmarkCases(corpus) {
  return corpus === 'bidi' ? benchmarkCases : benchmarkCases.filter((name) => name !== 'bidi-resize');
}

export function rustLayoutBenchmarkGeometry(name, index, base) {
  if (name === 'active-column-resize') {
    return {
      ...base,
      width: index % 2 === 0 ? 420 : 434,
      revision: index + 2,
    };
  }
  if (name === 'column-resize' || name === 'justify' || name === 'bidi-resize') {
    return {
      ...base,
      width: 420 + index * 7,
      revision: index + 2,
      ...(name === 'justify' ? { align: 'justify' } : {}),
    };
  }
  if (name === 'equivalent-width') {
    return {
      ...base,
      width: index % 2 === 0 ? base.width : nextFloat32(base.width),
      revision: index + 2,
    };
  }
  return base;
}

export function rustLayoutBenchmarkInitialGeometry(name, base) {
  if (name === 'justify') return { ...base, align: 'justify' };
  if (name === 'active-column-resize') return { ...base, width: 434 };
  return base;
}

export function assertRustLayoutBenchmarkResult(name, previous, next) {
  if (name === 'active-column-resize' && (next.patchCount === 0 || next.writeBytes === 0)) {
    throw new Error(
      `active-column-resize did not publish a changed layout at generation ${next.publicationGeneration}`,
    );
  }
  if (name === 'equivalent-width' && (next.patchCount !== 0 || next.writeBytes !== 0)) {
    throw new Error(
      `equivalent-width emitted ${next.patchCount} render-plan patches / ${next.writeBytes} bytes between publication generations ${previous.publicationGeneration} and ${next.publicationGeneration}`,
    );
  }
}

export function parseRustLayoutBenchmarkArguments(arguments_) {
  const readInteger = (name, fallback) => {
    const index = arguments_.indexOf(name);
    return index === -1 ? fallback : Number.parseInt(arguments_[index + 1], 10);
  };
  const readString = (name, fallback) => {
    const index = arguments_.indexOf(name);
    return index === -1 ? fallback : arguments_[index + 1];
  };
  const selectedCase = readBenchmarkCase(readString('--case'));
  const corpus = normalizeCorpus(readString('--corpus', selectedCase === 'bidi-resize' ? 'bidi' : 'latin'));
  if (selectedCase === 'bidi-resize' && corpus !== 'bidi') {
    throw new RangeError('bidi-resize requires the bidi corpus');
  }
  return {
    technique: normalizeTechnique(readString('--technique', 'bitmap')),
    allocation: readAllocation(readString('--allocation', 'ordered')),
    wasm: readString('--wasm'),
    corpus,
    case: selectedCase,
    glyphs: readInteger('--glyphs', 22_000),
    height: readInteger('--height', 100_000),
    repetitions: readInteger('--reps', 31),
    warmup: readInteger('--warmup', 8),
    jsonPath: readString('--json'),
    samplesPath: readString('--samples'),
  };
}

function readBenchmarkCase(value) {
  if (value !== undefined && !benchmarkCases.includes(value)) {
    throw new RangeError(`unknown benchmark case: ${value}`);
  }
  return value;
}

function readAllocation(value) {
  if (value !== 'ordered' && value !== 'stable') throw new RangeError(`unknown allocation strategy: ${value}`);
  return value;
}

function normalizeTechnique(value) {
  const name = value === 'msdf' ? 'mtsdf' : value;
  if (!['bitmap', 'mtsdf', 'slug'].includes(name)) {
    throw new RangeError('--technique must be bitmap, mtsdf, msdf, or slug');
  }
  return name;
}

function normalizeCorpus(name) {
  if (name !== 'latin' && name !== 'bidi' && name !== 'cjk') {
    throw new Error(`--corpus must be latin, bidi, or cjk, received ${name}`);
  }
  return name;
}

function nextFloat32(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value);
  const bits = view.getUint32(0);
  view.setUint32(0, bits + 1);
  return view.getFloat32(0);
}
