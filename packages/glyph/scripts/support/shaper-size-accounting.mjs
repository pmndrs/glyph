import { gzipSync } from 'node:zlib';

import { authenticateNamedShaper, cursor, sha256, wasmSections } from './named-shaper.mjs';

const symbolMarkers = [
  ['pmndrs_glyph_shaper', '_19pmndrs_glyph_shaper'],
  ['harfrust', '_8harfrust'],
  ['read_fonts', '_10read_fonts'],
  ['font_types', '_10font_types'],
  ['alloc', '_5alloc'],
  ['core', '_4core'],
  ['talc', '_4talc'],
];

export function byteIdentity(bytes) {
  return { sha256: sha256(bytes), rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length };
}

export function accountShaper(release, named) {
  const proof = authenticateNamedShaper(release, named);
  const sections = wasmSections(release);
  const sectionRows = sections.map((section, ordinal) => ({
    ordinal,
    id: section.id,
    name: section.name ?? null,
    rawBytes: section.bytes.length,
    payloadBytes: section.payload.length,
    framingBytes: section.bytes.length - section.payload.length,
  }));
  if (8 + sectionRows.reduce((sum, section) => sum + section.rawBytes, 0) !== release.length) {
    throw new Error('Wasm section bytes do not reconcile with file length');
  }

  const functionSection = sections.find((section) => section.id === 3);
  const codeSection = sections.find((section) => section.id === 10);
  const types = functionSection === undefined ? [] : parseTypeIndexes(functionSection.payload);
  const bodies =
    codeSection === undefined ? emptyBodies(types) : parseBodies(codeSection.payload, codeSection.bytes.length);
  if (types.length !== bodies.rows.length) throw new Error('Function and code counts differ');
  const importedFunctionCount = proof.importedFunctionCount;
  const names = new Map(proof.functions.map(({ functionIndex, name }) => [functionIndex, name]));
  const functions = bodies.rows.map((body, ordinal) => {
    const functionIndex = importedFunctionCount + ordinal;
    const name = names.get(functionIndex) ?? null;
    return {
      functionIndex,
      declaredTypeIndex: types[ordinal],
      name,
      symbolClass: name === null ? 'unnamed' : name.startsWith('binaryen:') ? 'binaryen-generated-or-shared' : 'named',
      ownerHints: ownerHints(name),
      genericInstantiationHint: name?.startsWith('_RI') ?? false,
      rawBodyBytes: body.bytes.length,
      bodyLengthPrefixBytes: body.lengthPrefixBytes,
      bodySha256: sha256(body.bytes),
    };
  });
  const groups = new Map();
  for (const [ordinal, fn] of functions.entries()) {
    const key = `${fn.declaredTypeIndex}:${fn.bodySha256}`;
    const collisions = groups.get(key) ?? [];
    let group = collisions.find((candidate) => Buffer.from(candidate.bytes).equals(bodies.rows[ordinal].bytes));
    if (group === undefined) {
      group = { bytes: bodies.rows[ordinal].bytes, functionIndexes: [] };
      collisions.push(group);
    }
    group.functionIndexes.push(fn.functionIndex);
    groups.set(key, collisions);
  }
  const exactDuplicateCandidates = [...groups.entries()].flatMap(([key, collisions]) =>
    collisions
      .filter((group) => group.functionIndexes.length > 1)
      .map((group) => ({
        declaredTypeIndex: Number(key.slice(0, key.indexOf(':'))),
        bodySha256: key.slice(key.indexOf(':') + 1),
        functionIndexes: group.functionIndexes,
      })),
  );
  const symbolClasses = Object.fromEntries(
    ['named', 'binaryen-generated-or-shared', 'unnamed'].map((symbolClass) => {
      const selected = functions.filter((fn) => fn.symbolClass === symbolClass);
      return [
        symbolClass,
        { functionCount: selected.length, rawBodyBytes: selected.reduce((sum, fn) => sum + fn.rawBodyBytes, 0) },
      ];
    }),
  );
  const nonexclusiveOwnerHints = Object.fromEntries(
    symbolMarkers.map(([hint]) => {
      const selected = functions.filter((fn) => fn.ownerHints.includes(hint));
      return [
        hint,
        { functionCount: selected.length, rawBodyBytes: selected.reduce((sum, fn) => sum + fn.rawBodyBytes, 0) },
      ];
    }),
  );
  const genericHints = functions.filter((fn) => fn.genericInstantiationHint);
  return {
    executableSha256: proof.executableSha256,
    release: byteIdentity(release),
    named: byteIdentity(named),
    importedFunctionCount,
    definedFunctionCount: functions.length,
    sectionHeaderBytes: 8,
    sections: sectionRows,
    codeSection: bodies.accounting,
    symbolClasses,
    nonexclusiveOwnerHints,
    genericNameHints: {
      functionCount: genericHints.length,
      rawBodyBytes: genericHints.reduce((sum, fn) => sum + fn.rawBodyBytes, 0),
    },
    functions,
    exactDuplicateCandidates,
  };
}

export function baselineShaper(bytes) {
  const module = new WebAssembly.Module(bytes);
  const sections = wasmSections(bytes);
  const functionSection = sections.find((section) => section.id === 3);
  const definedFunctionCount = functionSection === undefined ? 0 : parseTypeIndexes(functionSection.payload).length;
  return {
    ...byteIdentity(bytes),
    importedFunctionCount: WebAssembly.Module.imports(module).filter((entry) => entry.kind === 'function').length,
    definedFunctionCount,
    sections: sections.map((section, ordinal) => ({
      ordinal,
      id: section.id,
      name: section.name ?? null,
      rawBytes: section.bytes.length,
      payloadBytes: section.payload.length,
      framingBytes: section.bytes.length - section.payload.length,
    })),
  };
}

function parseTypeIndexes(payload) {
  const reader = cursor(payload);
  const count = reader.u32();
  const indexes = [];
  for (let ordinal = 0; ordinal < count; ordinal++) indexes.push(reader.u32());
  if (reader.offset !== payload.length) throw new Error('Trailing function-section bytes');
  return indexes;
}

function emptyBodies(types) {
  if (types.length !== 0) throw new Error('Missing code section for defined functions');
  return { rows: [], accounting: null };
}

function parseBodies(payload, sectionRawBytes) {
  const reader = cursor(payload);
  const count = reader.u32();
  const countPrefixBytes = reader.offset;
  const rows = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const before = reader.offset;
    const length = reader.u32();
    const lengthPrefixBytes = reader.offset - before;
    rows.push({ bytes: reader.take(length), lengthPrefixBytes });
  }
  if (reader.offset !== payload.length) throw new Error('Trailing code-section bytes');
  const bodyBytes = rows.reduce((sum, row) => sum + row.bytes.length, 0);
  const bodyLengthPrefixBytes = rows.reduce((sum, row) => sum + row.lengthPrefixBytes, 0);
  const sectionFramingBytes = sectionRawBytes - payload.length;
  if (bodyBytes + bodyLengthPrefixBytes + countPrefixBytes + sectionFramingBytes !== sectionRawBytes) {
    throw new Error('Code section bytes do not reconcile');
  }
  return {
    rows,
    accounting: {
      rawBytes: sectionRawBytes,
      bodyBytes,
      bodyLengthPrefixBytes,
      countPrefixBytes,
      sectionFramingBytes,
    },
  };
}

function ownerHints(name) {
  if (name === null) return [];
  if (name.startsWith('binaryen:')) return ['binaryen-generated-or-shared'];
  return symbolMarkers.filter(([, marker]) => name.includes(marker)).map(([label]) => label);
}
