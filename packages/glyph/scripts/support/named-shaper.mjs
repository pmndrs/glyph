import { createHash } from 'node:crypto';

const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const decoder = new TextDecoder('utf-8', { fatal: true });

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Keep original section encodings: semantic equality is insufficient for authenticating an optimized artifact.
export function wasmSections(bytes) {
  const reader = cursor(bytes);
  if (!Buffer.from(bytes.subarray(0, 8)).equals(header)) throw new Error('Invalid Wasm header');
  reader.offset = 8;
  const sections = [];
  while (reader.offset < bytes.length) {
    const start = reader.offset;
    const id = reader.byte();
    const payload = reader.take(reader.u32());
    const name = id === 0 ? cursor(payload).string() : undefined;
    sections.push({ id, name, payload, bytes: bytes.subarray(start, reader.offset) });
  }
  return sections;
}

export function authenticateNamedShaper(release, candidate) {
  const releaseSections = wasmSections(release);
  const candidateSections = wasmSections(candidate);
  const executable = (sections) => Buffer.concat([header, ...sections.filter((s) => s.id !== 0).map((s) => s.bytes)]);
  const original = executable(releaseSections);
  if (!original.equals(executable(candidateSections)))
    throw new Error('Named shaper executable sections differ from release');
  // The binary parser handles framing; the engine validates standard section ordering and executable structure.
  const module = new WebAssembly.Module(release);
  const names = candidateSections.filter((section) => section.name === 'name');
  if (names.length !== 1) throw new Error('Named shaper requires exactly one name section');
  const functions = functionNames(names[0].payload);
  if (functions.length === 0) throw new Error('Named shaper has no function names');
  const functionSection = releaseSections.find((section) => section.id === 3);
  const functionCount =
    WebAssembly.Module.imports(module).filter((entry) => entry.kind === 'function').length +
    (functionSection === undefined ? 0 : cursor(functionSection.payload).u32());
  if (functions.some((entry) => entry.functionIndex >= functionCount))
    throw new Error('Function name index out of range');
  return { executableSha256: sha256(original), functions, nameSection: names[0].bytes };
}

export function deriveNamedShaper(release, candidate) {
  const proof = authenticateNamedShaper(release, candidate);
  const sections = wasmSections(release).filter((section) => section.name !== 'name');
  return { bytes: Buffer.concat([header, ...sections.map((section) => section.bytes), proof.nameSection]), proof };
}

// Binaryen optimizes numeric internal identities exactly as in the stripped production input.
// Its final index map carries surviving identities; generated/merged functions remain explicitly labeled.
export function attachOptimizerFunctionNames(raw, optimized, symbolMap) {
  const nameSections = wasmSections(raw).filter((section) => section.name === 'name');
  if (nameSections.length !== 1) throw new Error('Raw shaper requires exactly one name section');
  const originalNames = new Map(
    functionNames(nameSections[0].payload).map((entry) => [entry.functionIndex, entry.name]),
  );
  const importCount = WebAssembly.Module.imports(new WebAssembly.Module(raw)).filter(
    (entry) => entry.kind === 'function',
  ).length;
  const entries = [];
  const seen = new Set();
  for (const line of symbolMap.trim().split('\n')) {
    const match = /^(\d+):(.+)$/.exec(line);
    if (!match) throw new Error('Invalid optimizer function map');
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index > 0xffffffff || seen.has(index))
      throw new Error('Invalid optimizer function index');
    seen.add(index);
    const identity = match[2];
    const name = /^\d+$/.test(identity) ? originalNames.get(Number(identity) + importCount) : `binaryen:${identity}`;
    if (!name) throw new Error('Optimizer function identity has no raw name');
    const encoded = Buffer.from(name);
    entries.push(Buffer.concat([u32(index), u32(encoded.length), encoded]));
  }
  const functionMap = Buffer.concat([u32(entries.length), ...entries]);
  const optimizedModule = new WebAssembly.Module(optimized);
  const defined = wasmSections(optimized).find((section) => section.id === 3);
  const count =
    WebAssembly.Module.imports(optimizedModule).filter((entry) => entry.kind === 'function').length +
    (defined === undefined ? 0 : cursor(defined.payload).u32());
  if (entries.length !== count || [...seen].some((index) => index >= count))
    throw new Error('Incomplete optimizer function map');
  const payload = Buffer.concat([Buffer.from([4, 110, 97, 109, 101, 1]), u32(functionMap.length), functionMap]);
  return Buffer.concat([optimized, Buffer.from([0]), u32(payload.length), payload]);
}

function u32(value) {
  const bytes = [];
  do {
    const low = value % 128;
    value = Math.floor(value / 128);
    bytes.push(low | (value > 0 ? 128 : 0));
  } while (value > 0);
  return Buffer.from(bytes);
}

function functionNames(payload) {
  const reader = cursor(payload);
  reader.string();
  const functions = [];
  let found = false;
  while (reader.offset < payload.length) {
    const id = reader.byte();
    const subsection = reader.take(reader.u32());
    if (id !== 1) continue;
    if (found) throw new Error('Duplicate function-name subsection');
    found = true;
    const names = cursor(subsection);
    const count = names.u32();
    const seen = new Set();
    for (let index = 0; index < count; index++) {
      const functionIndex = names.u32();
      const name = names.string();
      if (seen.has(functionIndex) || name.length === 0) throw new Error('Invalid function-name map');
      seen.add(functionIndex);
      functions.push({ functionIndex, name });
    }
    if (names.offset !== subsection.length) throw new Error('Trailing function-name bytes');
  }
  return functions;
}

function cursor(bytes) {
  return {
    offset: 0,
    byte() {
      if (this.offset >= bytes.length) throw new Error('Truncated Wasm section');
      return bytes[this.offset++];
    },
    u32() {
      let value = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        const byte = this.byte();
        if (shift === 28 && (byte & 240) !== 0) throw new Error('Invalid Wasm u32');
        value += (byte & 127) * 2 ** shift;
        if ((byte & 128) === 0) return value;
      }
      throw new Error('Invalid Wasm u32');
    },
    take(length) {
      if (length > bytes.length - this.offset) throw new Error('Truncated Wasm section');
      const result = bytes.subarray(this.offset, this.offset + length);
      this.offset += length;
      return result;
    },
    string() {
      return decoder.decode(this.take(this.u32()));
    },
  };
}
